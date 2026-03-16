import ffmpeg from 'fluent-ffmpeg';
// @ts-ignore
import FFT from 'fft.js';
import * as mm from 'music-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
        
        const genreStr = (Array.isArray(tags.genre) ? tags.genre[0] : tags.genre) || 'Unknown Genre';
        const artistStr = tags.artist || tags.albumartist || 'Unknown Artist';
        
        const safeGenre = genreStr.replace(/[/\\?%*:|"<>]/g, '').trim() || 'Unknown Genre';
        const safeArtist = artistStr.replace(/[/\\?%*:|"<>]/g, '').trim() || 'Unknown Artist';
        
        const baseDir = path.dirname(localPath);
        const targetDir = path.join(baseDir, safeGenre, safeArtist);
        
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
    } catch (e) {
        // Fallback to original path if metadata or move fails
    }
    return localPath;
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
     * Reads PCM s16le chunks from a file path and processes the FFT incrementally.
     */
    function processSpectralStream(inputPath: string, targetSampleRate: number, throughMp3: boolean): Promise<number> {
        return new Promise(async (resolve, reject) => {
            const runFFTStream = (srcPath: string) => {
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
                        .on('error', rej);

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
                        if (globalMaxPower < -80) {
                            return res(0);
                        }
                        numBlocks++;
                    }
                    leftoverBuffer = currentBuffer;
                });
                
                stream.on('end', () => {
                    if (numBlocks === 0) return res(0);

                    // Average over blocks, convert to dB
                    const dbSpectrum = new Float32Array(fftSize / 2);
                    for (let j = 0; j < fftSize / 2; j++) {
                        dbSpectrum[j] = 10 * Math.log10(powerSpectrum[j] / numBlocks + 1e-10);
                    }

                        // Use mid-frequencies as reference to avoid sub-bass dominance
                        const referencePower = Math.max(midFreqMaxPower, -80);

                        // Threshold: Generally 15dB below the 10k-15k peak.
                        // For Hi-Res, we are much more lenient (-40dB) to catch weaker ultrasonic peaks.
                        const dropoff = targetSampleRate > 48000 ? 40 : 18;
                        const SIGNAL_THRESHOLD = Math.max(referencePower - dropoff, -85);
                        
                        let maxBin = 0;
                        for (let j = fftSize / 2 - 1; j >= 0; j--) {
                            if (dbSpectrum[j] > SIGNAL_THRESHOLD) {
                                maxBin = j;
                                break;
                            }
                        }
                    }

                        const freq = (maxBin * targetSampleRate) / fftSize;
                        res(freq);
                    });
                });
            });
        };

        if (!throughMp3) {
            return runFFTStream(inputPath);
        }

            // Fake check comparison: re-encode to 320k MP3 (up to 48kHz)
            const mp3SampleRate = Math.min(targetSampleRate, 48000);
            const tmpMp3 = path.join(os.tmpdir(), `slsk_fakecheck_${Date.now()}.mp3`);
            try {
                await new Promise<void>((res, rej) => {
                    ffmpeg(inputPath)
                        .noVideo()
                        .audioChannels(1)
                        .audioFrequency(mp3SampleRate)
                        .toFormat('mp3')
                        .audioBitrate('320k')
                        .on('error', rej)
                        .on('end', () => res())
                        .save(tmpMp3);
                });

            return await runFFTStream(tmpMp3);
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

/**
 * Converts an audio file to the target format while preserving metadata.
 */
export async function convertAudio(
    inputPath: string,
    config: AppConfig,
    analysis?: { isHighQuality: boolean }
): Promise<{ outputPath: string; format: string }> {
    if (!config.autoConvert.enabled) return { outputPath: inputPath, format: 'original' };

    const metadata = await mm.parseFile(inputPath);
    
    // Determine target format
    let targetFormat = config.autoConvert.targetFormat;
    if (config.autoConvert.smartMode && analysis) {
        targetFormat = analysis.isHighQuality ? 'aiff' : 'mp3';
    }

    const ext = targetFormat === 'mp3' ? '.mp3' : '.aif';
    const outputPath = inputPath.replace(/\.[^/.]+$/, "") + ext;

    // Only skip conversion if we aren't compressing a fake track
    if (inputPath.toLowerCase().endsWith(ext)) {
        // If it's already the target format, we only skip if we are NOT downsampling a fake track
        // OR if volume normalization is off. If volume normalization is ON, we must process it.
        if (!config.autoConvert.normalizeVolume && (!config.autoConvert.smartMode || (analysis && analysis.isHighQuality))) {
            return { outputPath: inputPath, format: targetFormat };
        }
    }

    const tempPath = inputPath === outputPath ? outputPath + '.tmp' : outputPath;

    return new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath).noVideo();

        if (targetFormat === 'mp3') {
            command = command.toFormat('mp3').audioBitrate(config.autoConvert.mp3Bitrate);
        } else {
            // High quality AIFF for CDJs (pcm_s16be is standard for AIFF, but big-endian is preferred)
            command = command.toFormat('aiff').audioCodec('pcm_s16be');
        }

        if (config.autoConvert.normalizeVolume) {
            command = command.audioFilters(`loudnorm=I=${config.autoConvert.targetLufs}:LRA=11:TP=-1.5`);
        }

        // Apply metadata tags
        const tags = metadata.common;
        if (tags.title) command = command.outputOptions('-metadata', `title=${tags.title}`);
        if (tags.artist) command = command.outputOptions('-metadata', `artist=${tags.artist}`);
        if (tags.album) command = command.outputOptions('-metadata', `album=${tags.album}`);
        if (tags.year) command = command.outputOptions('-metadata', `date=${tags.year}`);
        if (tags.genre) {
            const genreStr = Array.isArray(tags.genre) ? tags.genre.join(', ') : tags.genre;
            command = command.outputOptions('-metadata', `genre=${genreStr}`);
        }
        if (tags.track.no) command = command.outputOptions('-metadata', `track=${tags.track.no}`);

        command
            .on('end', () => {
                if (inputPath === outputPath) {
                    try {
                        fs.renameSync(tempPath, outputPath);
                    } catch (e) {
                        return reject(e);
                    }
                } else if (config.autoConvert.deleteOriginal && inputPath !== outputPath) {
                    try { fs.unlinkSync(inputPath); } catch (e) {}
                }
                resolve({ outputPath, format: targetFormat });
            })
            .on('error', (err) => {
                try { fs.unlinkSync(tempPath); } catch (e) {}
                reject(err);
            })
            .save(tempPath);
    });
}
