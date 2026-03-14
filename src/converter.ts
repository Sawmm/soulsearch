import ffmpeg from 'fluent-ffmpeg';
// @ts-ignore
import FFT from 'fft.js';
import * as mm from 'music-metadata';
import * as fs from 'fs';
import * as path from 'path';
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
            fs.renameSync(localPath, finalPath);
            return finalPath;
        }
    } catch (e) {
        // Fallback to original path if metadata completely fails
    }
    return localPath;
}

/**
 * Detects the "actual" bitrate of an audio file using spectral analysis.
 */
export async function detectActualBitrate(filePath: string): Promise<{ maxFrequency: number; estimatedBitrate: string; isHighQuality: boolean }> {
    return new Promise((resolve, reject) => {
        const sampleRate = 44100;
        const fftSize = 4096;
        const fft = new FFT(fftSize);
        const threshold = -65; // dB threshold for cutoff

        const averageSpectrum = new Float32Array(fftSize / 2);
        let numBlocks = 0;
        let leftOver = Buffer.alloc(0);

        const stream = ffmpeg(filePath)
            .noVideo() // Prevent video/cover-art stream errors
            .format('s16le') // Raw 16-bit PCM
            .audioChannels(1)
            .audioFrequency(sampleRate)
            .on('error', reject)
            .pipe();

        stream.on('data', (chunk: Buffer) => {
            const currentBuffer = Buffer.concat([leftOver, chunk]);
            const bytesPerBlock = fftSize * 2; // 16-bit = 2 bytes per sample
            let offset = 0;

            while (offset + bytesPerBlock <= currentBuffer.length) {
                const blockBuffer = currentBuffer.subarray(offset, offset + bytesPerBlock);
                const pcmData = new Float32Array(fftSize);
                for (let i = 0; i < fftSize; i++) {
                    pcmData[i] = blockBuffer.readInt16LE(i * 2) / 32768;
                }

                const out = fft.createComplexArray();
                fft.realTransform(out, pcmData);

                for (let j = 0; j < fftSize / 2; j++) {
                    const real = out[j * 2];
                    const imag = out[j * 2 + 1];
                    averageSpectrum[j] += Math.sqrt(real * real + imag * imag);
                }
                numBlocks++;
                offset += bytesPerBlock;
            }
            leftOver = currentBuffer.subarray(offset);
        });

        stream.on('end', () => {
            if (numBlocks === 0) {
                return resolve({ maxFrequency: 0, estimatedBitrate: 'Unknown', isHighQuality: false });
            }

            // Average the spectrum across all blocks, convert to dB
            const dbSpectrum = new Float32Array(fftSize / 2);
            for (let j = 0; j < fftSize / 2; j++) {
                const avgMag = averageSpectrum[j] / numBlocks;
                dbSpectrum[j] = 20 * Math.log10(avgMag + 1e-6);
            }

            // 1. Compute a stable reference level from the mid-frequency range (1kHz - 5kHz).
            //    This range always has strong signal for music and is unaffected by lossy cutoffs.
            const refBinStart = Math.floor(1000 * fftSize / sampleRate);
            const refBinEnd = Math.floor(5000 * fftSize / sampleRate);
            let refSum = 0;
            for (let j = refBinStart; j <= refBinEnd; j++) {
                refSum += dbSpectrum[j];
            }
            const refLevel = refSum / (refBinEnd - refBinStart + 1);

            // 2. Scan from the top (Nyquist) downwards to find the first bin that is
            //    within 30dB of the mid-frequency reference.
            //    - For a genuine FLAC peaking at 22kHz: the very first bin (top) will be
            //      within 30dB of the reference → cutoff detected near 22kHz → High Quality.
            //    - For a fake FLAC (MP3→FLAC): bins above ~16kHz will be >30dB below the
            //      reference (just residual noise) → cutoff detected much lower → Fake.
            const DROP_THRESHOLD_DB = 30;
            let detectedCutoffBin = 0;
            const topBin = Math.floor(22000 * fftSize / sampleRate);

            for (let j = topBin; j >= 0; j--) {
                if (dbSpectrum[j] > refLevel - DROP_THRESHOLD_DB) {
                    detectedCutoffBin = j;
                    break;
                }
            }

            const maxFrequency = (detectedCutoffBin * sampleRate) / fftSize;

            let estimated = 'Unknown';
            let isHighQuality = false;
            
            if (maxFrequency >= 19500) {
                estimated = 'High Quality (320k/Lossless)';
                isHighQuality = true;
            } else if (maxFrequency >= 18000) {
                estimated = 'Good (256k)';
            } else if (maxFrequency >= 15500) {
                estimated = 'Medium (128k-192k)';
            } else {
                estimated = 'Low Quality / Fake';
            }

            resolve({ maxFrequency, estimatedBitrate: estimated, isHighQuality });
        });
    });
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
