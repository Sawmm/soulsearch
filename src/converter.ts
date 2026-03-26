import ffmpeg from 'fluent-ffmpeg';
// @ts-ignore
import FFT from 'fft.js';
import * as mm from 'music-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { performance } from 'perf_hooks';
import { AppConfig } from './types.js';

/**
 * Parses ID3 tags from a downloaded audio file and moves it strictly into a `Genre/Artist/Filename` directory struct.
 */
export async function applySmartFolders(localPath: string, config: AppConfig): Promise<string> {
    if (!config.autoConvert.smartFolders || !fs.existsSync(localPath)) {
        return localPath;
    }
    
    try {
        const metadata = await mm.parseFile(localPath);
        const tags = metadata.common;

        const genreRaw = (Array.isArray(tags.genre) ? tags.genre[0] : tags.genre) || '';
        const artistRaw = tags.artist || tags.albumartist || '';

        const safeGenre = genreRaw.replace(/[/\\?%*:|"<>]/g, '').trim() || 'Unknown Genre';
        const safeArtist = artistRaw.replace(/[/\\?%*:|"<>]/g, '').trim() || 'Unknown Artist';

        const targetDir = path.join(config.downloadPath, safeGenre, safeArtist);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const finalPath = path.join(targetDir, path.basename(localPath));
        if (localPath !== finalPath) {
            try {
                fs.renameSync(localPath, finalPath);
            } catch (renameErr: any) {
                // If EXDEV (cross-device link not permitted), fallback to copy+delete
                if (renameErr.code === 'EXDEV') {
                    fs.copyFileSync(localPath, finalPath);
                    fs.unlinkSync(localPath);
                } else {
                    throw renameErr;
                }
            }
            return finalPath;
        }
        return localPath;
    } catch (e) {
        console.warn('applySmartFolders failed, keeping original path:', e);
        return localPath;
    }
}

/**
 * Detects the "actual" bitrate of an audio file using the FakeFLAC method:
 * Re-encodes the file to 320k MP3 and back, then compares the max frequency
 * above 14kHz between the original and the re-encoded version.
 * If they match → it's a fake lossless. If original is higher → genuine.
 */
export async function detectActualBitrate(filePath: string): Promise<{ maxFrequency: number; estimatedBitrate: string; isHighQuality: boolean }> {
    const fftSize = 8192; // Higher resolution for better frequency estimation

    /**
     * Reads PCM s16le chunks from srcPath, runs the FFT, and returns the max significant frequency.
     * Clears fluent-ffmpeg's perf_hooks entries after completion to prevent the
     * MaxPerformanceEntryBufferExceededWarning during concurrent multi-song downloads.
     */
    function runFFTStream(srcPath: string, targetSampleRate: number): Promise<number> {
        return new Promise<number>((res, rej) => {
            const fft = new FFT(fftSize);
            const powerSpectrum = new Float32Array(fftSize / 2).fill(0);
            let numBlocks = 0;

            let leftoverBuffer = Buffer.alloc(0);
            const blockSizeBytes = fftSize * 2; // 16-bit PCM = 2 bytes per sample

            const cmd = ffmpeg(srcPath)
                .noVideo()
                .audioChannels(1)
                .audioFrequency(targetSampleRate)
                .toFormat('s16le')
                .on('error', (err) => {
                    performance.clearMeasures();
                    performance.clearMarks();
                    rej(err);
                });

            const stream = cmd.pipe();

            stream.on('data', (chunk: Buffer) => {
                let currentBuffer = Buffer.concat([leftoverBuffer, chunk]);

                while (currentBuffer.length >= blockSizeBytes) {
                    const blockRaw = currentBuffer.subarray(0, blockSizeBytes);
                    currentBuffer = currentBuffer.subarray(blockSizeBytes);

                    const samples = new Float32Array(fftSize);
                    for (let i = 0; i < fftSize; i++) {
                        samples[i] = blockRaw.readInt16LE(i * 2) / 32768;
                    }

                    const out = fft.createComplexArray();
                    fft.realTransform(out, samples);

                    for (let j = 0; j < fftSize / 2; j++) {
                        const real = out[j * 2];
                        const imag = out[j * 2 + 1];
                        powerSpectrum[j] += real * real + imag * imag;
                    }
                    numBlocks++;
                }
                leftoverBuffer = currentBuffer;
            });

            stream.on('end', () => {
                // Clear fluent-ffmpeg's perf_hooks entries to prevent memory leak
                // when many files are being analyzed concurrently.
                performance.clearMeasures();
                performance.clearMarks();

                if (numBlocks === 0) return res(0);

                // Average over blocks, convert to dB
                const dbSpectrum = new Float32Array(fftSize / 2);
                let globalMaxPower = -Infinity;
                let midFreqMaxPower = -Infinity; // max power in 10kHz-15kHz range

                const bin10k = Math.floor(10000 * fftSize / targetSampleRate);
                const bin15k = Math.floor(15000 * fftSize / targetSampleRate);

                for (let j = 0; j < fftSize / 2; j++) {
                    const avgPower = powerSpectrum[j] / numBlocks;
                    const db = 10 * Math.log10(avgPower + 1e-12);
                    dbSpectrum[j] = db;
                    if (db > globalMaxPower) globalMaxPower = db;
                    if (j >= bin10k && j <= bin15k && db > midFreqMaxPower) {
                        midFreqMaxPower = db;
                    }
                }

                // If the entire track is too quiet
                if (globalMaxPower < -80) return res(0);

                // Use mid-frequencies as reference to avoid sub-bass dominance
                const referencePower = Math.max(midFreqMaxPower, -80);

                // Threshold: Generally 18dB below the 10k-15k peak.
                // For Hi-Res, we are more lenient (-40dB) to catch weaker ultrasonic peaks.
                const dropoff = targetSampleRate > 48000 ? 40 : 18;
                const SIGNAL_THRESHOLD = Math.max(referencePower - dropoff, -85);

                let maxBin = 0;
                for (let j = fftSize / 2 - 1; j >= 0; j--) {
                    if (dbSpectrum[j] > SIGNAL_THRESHOLD) {
                        maxBin = j;
                        break;
                    }
                }

                const freq = (maxBin * targetSampleRate) / fftSize;
                res(freq);
            });
        });
    }

    /**
     * Optionally re-encodes the file through a 320k MP3 transcode first (for fake-lossless detection),
     * then runs the FFT spectral analysis.
     * Uses crypto.randomBytes for the temp filename to prevent collisions during concurrent downloads.
     */
    async function processSpectralStream(inputPath: string, targetSampleRate: number, throughMp3: boolean): Promise<number> {
        if (!throughMp3) {
            return runFFTStream(inputPath, targetSampleRate);
        }

        // Re-encode to 320k MP3 (cap at 48kHz) then analyse
        const mp3SampleRate = Math.min(targetSampleRate, 48000);
        // Use random bytes to avoid temp-file collisions when multiple songs are analyzed at once
        const randomSuffix = crypto.randomBytes(8).toString('hex');
        const tmpMp3 = path.join(os.tmpdir(), `slsk_fakecheck_${randomSuffix}.mp3`);
        try {
            await new Promise<void>((res, rej) => {
                ffmpeg(inputPath)
                    .noVideo()
                    .audioChannels(1)
                    .audioFrequency(mp3SampleRate)
                    .toFormat('mp3')
                    .audioBitrate('320k')
                    .on('error', rej)
                    .on('end', () => {
                        // Clear perf entries from the encode step too
                        performance.clearMeasures();
                        performance.clearMarks();
                        res();
                    })
                    .save(tmpMp3);
            });

            return await runFFTStream(tmpMp3, mp3SampleRate);
        } finally {
            try { fs.unlinkSync(tmpMp3); } catch (_) {}
        }
    }

    try {
        const metadata = await mm.parseFile(filePath);
        const nativeSampleRate = metadata.format.sampleRate || 44100;

        // Run both analyses in parallel
        const [originalMaxFreq, fakeMaxFreq] = await Promise.all([
            processSpectralStream(filePath, nativeSampleRate, false),
            processSpectralStream(filePath, nativeSampleRate, true)
        ]);

        const freqDiff = originalMaxFreq - fakeMaxFreq;
        
        // Quality Logic:
        // 1. If it's Hi-Res (> 48kHz) and original > 22kHz, it's definitely high quality.
        // 2. If original > 18.5kHz or has a significant treble gain over MP3 transcode.
        const isHiRes = nativeSampleRate > 48000 && originalMaxFreq > 21000;
        const isHighQuality = isHiRes || originalMaxFreq > 18500 || freqDiff > 1000;

        let estimatedBitrate: string;
        if (isHiRes) {
            estimatedBitrate = 'Hi-Res Lossless';
        } else if (!isHighQuality) {
            if (originalMaxFreq < 15500) estimatedBitrate = 'Low Quality / Fake';
            else if (originalMaxFreq < 17500) estimatedBitrate = 'Medium (128k)';
            else estimatedBitrate = 'Good (160k-192k)';
        } else {
            estimatedBitrate = originalMaxFreq > 19500 ? 'High Quality (Lossless)' : 'Good (256k-320k)';
        }

        return { maxFrequency: originalMaxFreq, estimatedBitrate, isHighQuality };
    } catch (e) {
        return { maxFrequency: 0, estimatedBitrate: 'Error', isHighQuality: false };
    }
}

interface MBData {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    label?: string;
    genre?: string;
    coverArtPath?: string | null;
}

async function fetchCoverArtForMbid(mbid: string): Promise<string | null> {
    try {
        const artUrl = `https://coverartarchive.org/release/${mbid}/front-250`;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(artUrl, { signal: controller.signal, redirect: 'follow' });
        clearTimeout(t);
        if (!res.ok) return null;
        const imgBuffer = Buffer.from(await res.arrayBuffer());
        const ext = (res.headers.get('content-type') || '').includes('png') ? '.png' : '.jpg';
        const tmpPath = path.join(os.tmpdir(), `slsk_cover_${crypto.randomBytes(8).toString('hex')}${ext}`);
        fs.writeFileSync(tmpPath, imgBuffer);
        return tmpPath;
    } catch {
        return null;
    }
}

async function fetchMusicBrainzData(title: string, artist: string): Promise<MBData | null> {
    try {
        const terms: string[] = [];
        if (title) terms.push(`recording:"${title}"`);
        if (artist) terms.push(`artist:"${artist}"`);
        const query = terms.length > 0 ? terms.join(' AND ') : [title, artist].filter(Boolean).join(' ');
        if (!query) return null;

        const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1&inc=releases+tags`;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'SoulSearch/1.0.0 (https://github.com/user/soulsearch)' }
        });
        clearTimeout(t);
        if (!res.ok) return null;

        const data = await res.json() as any;
        const rec = data.recordings?.[0];
        if (!rec) return null;

        const release = rec.releases?.[0];
        const topTag = [...(rec.tags ?? [])].sort((a: any, b: any) => b.count - a.count)[0]?.name;
        const mbid: string | undefined = release?.id;

        const result: MBData = {
            title: rec.title,
            artist: rec['artist-credit']?.[0]?.artist?.name,
            album: release?.title,
            year: release?.date?.substring(0, 4),
            label: release?.['label-info']?.[0]?.label?.name,
            genre: topTag,
            coverArtPath: mbid ? await fetchCoverArtForMbid(mbid) : null,
        };
        return result;
    } catch {
        return null;
    }
}

/**
 * Converts an audio file to the target format while preserving metadata.
 * Returns { outputPath, format, kill } where kill() terminates the ffmpeg process immediately.
 */
export async function convertAudio(
    inputPath: string,
    config: AppConfig,
    analysis?: { isHighQuality: boolean },
    onKillReady?: (kill: () => void) => void
): Promise<{ outputPath: string; format: string; kill: () => void }> {
    if (!config.autoConvert.enabled) return { outputPath: inputPath, format: 'original', kill: () => {} };

    const metadata = await mm.parseFile(inputPath);

    // Determine target format
    let targetFormat = config.autoConvert.targetFormat;
    if (config.autoConvert.smartMode && analysis) {
        targetFormat = analysis.isHighQuality ? 'aiff' : 'mp3';
    }

    const ext = targetFormat === 'mp3' ? '.mp3' : '.aif';
    const outputPath = inputPath.replace(/\.[^/.]+$/, '') + ext;

    // Only skip conversion if we aren't compressing a fake track
    if (inputPath.toLowerCase().endsWith(ext)) {
        if (!config.autoConvert.normalizeVolume && (!config.autoConvert.smartMode || (analysis && analysis.isHighQuality))) {
            return { outputPath: inputPath, format: targetFormat, kill: () => {} };
        }
    }

    const tempPath = inputPath === outputPath ? outputPath + '.tmp' : outputPath;

    // Check if source already has embedded cover art
    const hasCoverArt = (metadata.common.picture?.length ?? 0) > 0;

    // Fetch MusicBrainz data: cover art (if not embedded) and metadata overrides (if autoTag enabled)
    let mbData: MBData | null = null;
    if (!hasCoverArt || config.autoConvert.autoTag) {
        const title = metadata.common.title || '';
        const artist = metadata.common.artist || '';
        if (title || artist) {
            mbData = await fetchMusicBrainzData(title, artist);
        }
    }
    const coverArtTempPath: string | null = hasCoverArt ? null : (mbData?.coverArtPath ?? null);

    const cleanupCoverArt = () => {
        if (coverArtTempPath) { try { fs.unlinkSync(coverArtTempPath); } catch (_) {} }
    };

    // killRef is populated inside the Promise executor once the ffmpeg command is available
    const killRef: { kill: () => void } = { kill: () => {} };

    const promise = new Promise<{ outputPath: string; format: string; kill: () => void }>((resolve, reject) => {
        let command = ffmpeg(inputPath);

        // Add external cover art as a second input if we fetched one
        if (coverArtTempPath) {
            command = command.input(coverArtTempPath);
        }

        // Set audio codec/format
        if (targetFormat === 'mp3') {
            command = command.toFormat('mp3').audioBitrate(config.autoConvert.mp3Bitrate);
        } else {
            command = command.toFormat('aiff').audioCodec('pcm_s16be');
        }

        if (config.autoConvert.normalizeVolume) {
            command = command.audioFilters(`loudnorm=I=${config.autoConvert.targetLufs}:LRA=11:TP=-1.5`);
        }

        // Map audio from primary input
        command = command.outputOptions('-map', '0:a');

        // Map cover art: prefer source-embedded art, then externally fetched art
        if (hasCoverArt) {
            command = command.outputOptions('-map', '0:v').outputOptions('-c:v', 'copy');
        } else if (coverArtTempPath) {
            command = command.outputOptions('-map', '1:v').outputOptions('-c:v', 'copy');
        }

        // Copy ALL metadata from source (replaces manual per-field copying)
        command = command.outputOptions('-map_metadata', '0');

        // AIFF requires explicit ID3v2 mode for tag embedding
        if (targetFormat === 'aiff') {
            command = command.outputOptions('-write_id3v2', '1');
        }

        // Override tags with MusicBrainz data when autoTag is enabled
        if (config.autoConvert.autoTag && mbData) {
            if (mbData.title)  command = command.outputOptions('-metadata', `title=${mbData.title}`);
            if (mbData.artist) command = command.outputOptions('-metadata', `artist=${mbData.artist}`);
            if (mbData.album)  command = command.outputOptions('-metadata', `album=${mbData.album}`);
            if (mbData.year)   command = command.outputOptions('-metadata', `date=${mbData.year}`);
            if (mbData.genre)  command = command.outputOptions('-metadata', `genre=${mbData.genre}`);
            if (mbData.label)  command = command.outputOptions('-metadata', `organization=${mbData.label}`);
        }

        // Populate killRef and notify caller immediately so cancel works during conversion
        killRef.kill = () => {
            command.kill('SIGKILL');
            try { fs.unlinkSync(tempPath); } catch (_) {}
            cleanupCoverArt();
        };
        onKillReady?.(killRef.kill);

        command
            .on('end', () => {
                cleanupCoverArt();
                if (inputPath === outputPath) {
                    try {
                        fs.renameSync(tempPath, outputPath);
                    } catch (e) {
                        return reject(e);
                    }
                } else if (config.autoConvert.deleteOriginal && inputPath !== outputPath) {
                    try { fs.unlinkSync(inputPath); } catch (e) {}
                }
                resolve({ outputPath, format: targetFormat, kill: () => {} });
            })
            .on('error', (err) => {
                cleanupCoverArt();
                try { fs.unlinkSync(tempPath); } catch (e) {}
                reject(err);
            })
            .save(tempPath);
    });

    return promise.then(result => ({ ...result, kill: killRef.kill }));
}

/**
 * Remuxes an audio file (no re-encoding) to update its tags from MusicBrainz
 * and optionally embed cover art fetched from the Cover Art Archive.
 * Returns the (unchanged) file path, or the original on failure.
 */
export async function tagAudioFile(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) return filePath;

    let srcMeta: mm.IAudioMetadata;
    try {
        srcMeta = await mm.parseFile(filePath);
    } catch {
        return filePath;
    }

    const title  = srcMeta.common.title  || '';
    const artist = srcMeta.common.artist || '';
    if (!title && !artist) return filePath;

    const mbData = await fetchMusicBrainzData(title, artist);
    if (!mbData) return filePath;

    const hasCoverArt = (srcMeta.common.picture?.length ?? 0) > 0;
    const coverArtPath = hasCoverArt ? null : (mbData.coverArtPath ?? null);

    const cleanupCover = () => {
        if (mbData.coverArtPath) { try { fs.unlinkSync(mbData.coverArtPath); } catch (_) {} }
    };

    const tempPath = filePath + '.tagtmp';
    const ext = path.extname(filePath).toLowerCase();

    try {
        await new Promise<void>((resolve, reject) => {
            let command = ffmpeg(filePath);
            if (coverArtPath) command = command.input(coverArtPath);

            // Copy audio without re-encoding
            command = command.outputOptions('-map', '0:a').outputOptions('-c:a', 'copy');

            if (hasCoverArt) {
                command = command.outputOptions('-map', '0:v').outputOptions('-c:v', 'copy');
            } else if (coverArtPath) {
                command = command.outputOptions('-map', '1:v').outputOptions('-c:v', 'copy');
            }

            // Preserve existing tags, then override with MusicBrainz data
            command = command.outputOptions('-map_metadata', '0');
            if (mbData.title)  command = command.outputOptions('-metadata', `title=${mbData.title}`);
            if (mbData.artist) command = command.outputOptions('-metadata', `artist=${mbData.artist}`);
            if (mbData.album)  command = command.outputOptions('-metadata', `album=${mbData.album}`);
            if (mbData.year)   command = command.outputOptions('-metadata', `date=${mbData.year}`);
            if (mbData.genre)  command = command.outputOptions('-metadata', `genre=${mbData.genre}`);
            if (mbData.label)  command = command.outputOptions('-metadata', `organization=${mbData.label}`);

            if (ext === '.aif' || ext === '.aiff') {
                command = command.outputOptions('-write_id3v2', '1');
            }

            command
                .on('end', () => resolve())
                .on('error', (err) => {
                    performance.clearMeasures();
                    performance.clearMarks();
                    reject(err);
                })
                .save(tempPath);
        });

        fs.renameSync(tempPath, filePath);
        cleanupCover();
        return filePath;
    } catch (e) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
        cleanupCover();
        console.warn('tagAudioFile failed:', e);
        return filePath;
    }
}
