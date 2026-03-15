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
    const sampleRate = 44100;
    const fftSize = 8192; // Higher resolution for better frequency estimation

    /**
     * Reads PCM s16le chunks from a file path and processes the FFT incrementally.
     * If throughMp3 is true, first re-encodes to 320k MP3 via a temp file.
     * This chunked streaming prevents Out Of Memory (OOM) errors on large 24-bit FLACs.
     */
    function processSpectralStream(inputPath: string, throughMp3: boolean): Promise<number> {
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
                        .audioFrequency(sampleRate)
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
                        if (numBlocks === 0) return res(0);

                        // Average over blocks, convert to dB
                        const dbSpectrum = new Float32Array(fftSize / 2);
                        let globalMaxPower = -Infinity;
                        
                        for (let j = 0; j < fftSize / 2; j++) {
                            const avgPower = powerSpectrum[j] / numBlocks;
                            const db = 10 * Math.log10(avgPower + 1e-12);
                            dbSpectrum[j] = db;
                            if (db > globalMaxPower) globalMaxPower = db;
                        }

                        // If globalMaxPower is extremely low, it's silence or near-silence
                        if (globalMaxPower < -80) return res(0);

                        // Threshold: -18dB from peak, but not lower than -65dB.
                        // This helps distinguish genuine signal from lossy quantization noise.
                        const SIGNAL_THRESHOLD = Math.max(globalMaxPower - 18, -65);
                        
                        let maxBin = 0;
                        for (let j = fftSize / 2 - 1; j >= 0; j--) {
                            if (dbSpectrum[j] > SIGNAL_THRESHOLD) {
                                maxBin = j;
                                break;
                            }
                        }

                        const freq = (maxBin * sampleRate) / fftSize;
                        res(freq);
                    });
                });
            };

            if (!throughMp3) {
                try {
                    resolve(await runFFTStream(inputPath));
                } catch (e) { reject(e); }
                return;
            }

            // Two-stage: encode to a temp MP3 on disk, then decode and stream to FFT.
            const tmpMp3 = path.join(os.tmpdir(), `slsk_fakecheck_${Date.now()}.mp3`);
            try {
                await new Promise<void>((res, rej) => {
                    ffmpeg(inputPath)
                        .noVideo()
                        .audioChannels(1)
                        .audioFrequency(sampleRate)
                        .toFormat('mp3')
                        .audioBitrate('320k') // FakeFLAC comparison point
                        .on('error', rej)
                        .on('end', () => res())
                        .save(tmpMp3);
                });

                const maxFreq = await runFFTStream(tmpMp3);
                resolve(maxFreq);
            } catch (e) {
                reject(e);
            } finally {
                try { fs.unlinkSync(tmpMp3); } catch (_) {}
            }
        });
    }

    try {
        // Run both analyses in parallel
        const [originalMaxFreq, fakeMaxFreq] = await Promise.all([
            processSpectralStream(filePath, false),
            processSpectralStream(filePath, true)
        ]);

        // Key FakeFLAC logic: compare the two max frequencies.
        const freqDiff = originalMaxFreq - fakeMaxFreq;
        
        // Lenient check: If it's > 18.5kHz, it's likely "Good enough" or Genuine.
        // Genuine lossless usually goes to 20-22kHz.
        // 320k MP3 cuts at 20.5kHz.
        // 256k MP3 cuts at 19kHz.
        // 192k MP3 cuts at 18kHz.
        // 128k MP3 cuts at 16kHz.
        const isHighQuality = originalMaxFreq > 18500 || freqDiff > 1000;

        let estimatedBitrate: string;
        if (!isHighQuality) {
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
