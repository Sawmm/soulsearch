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
 * Detects the "actual" bitrate of an audio file using the FakeFLAC method:
 * Re-encodes the file to 320k MP3 and back, then compares the max frequency
 * above 14kHz between the original and the re-encoded version.
 * If they match → it's a fake lossless. If original is higher → genuine.
 */
export async function detectActualBitrate(filePath: string): Promise<{ maxFrequency: number; estimatedBitrate: string; isHighQuality: boolean }> {
    const sampleRate = 44100;
    const fftSize = 4096;
    const MIN_ANALYSIS_FREQ = 14000; // FakeFLAC scans from 14kHz upwards

    /**
     * Reads raw PCM s16le samples from a file path into a Float32Array.
     * Optionally re-encodes through 320k MP3 first (the "fake lossless" path).
     */
    function getPCMData(inputPath: string, throughMp3: boolean): Promise<Float32Array> {
        return new Promise((resolve, reject) => {
            let srcCommand = ffmpeg(inputPath).noVideo().audioChannels(1).audioFrequency(sampleRate);

            // If we need the "fake lossless" version, pipe through MP3 encoding first
            if (throughMp3) {
                // Chain: original → MP3 320k → PCM s16le
                const mp3Pipe = ffmpeg(inputPath)
                    .noVideo()
                    .audioChannels(1)
                    .audioFrequency(sampleRate)
                    .toFormat('mp3')
                    .audioBitrate('320k')
                    .pipe();

                srcCommand = ffmpeg(mp3Pipe as any)
                    .noVideo()
                    .inputFormat('mp3')
                    .audioChannels(1)
                    .audioFrequency(sampleRate);
            }

            const chunks: Buffer[] = [];
            const stream = srcCommand.toFormat('s16le').pipe();

            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('error', reject);
            stream.on('end', () => {
                const raw = Buffer.concat(chunks);
                const samples = new Float32Array(raw.length / 2);
                for (let i = 0; i < samples.length; i++) {
                    samples[i] = raw.readInt16LE(i * 2) / 32768;
                }
                resolve(samples);
            });
        });
    }

    /**
     * Given PCM samples, compute average power spectrum and find the max
     * frequency that has meaningful signal above 14kHz (FakeFLAC method).
     */
    function getMaxHighFrequency(samples: Float32Array): number {
        const fft = new FFT(fftSize);
        const powerSpectrum = new Float32Array(fftSize / 2).fill(0);
        let numBlocks = 0;

        for (let offset = 0; offset + fftSize <= samples.length; offset += fftSize) {
            const block = samples.subarray(offset, offset + fftSize);
            const out = fft.createComplexArray();
            fft.realTransform(out, block);

            for (let j = 0; j < fftSize / 2; j++) {
                const real = out[j * 2];
                const imag = out[j * 2 + 1];
                powerSpectrum[j] += real * real + imag * imag; // accumulate power
            }
            numBlocks++;
        }

        if (numBlocks === 0) return 0;

        // Average over blocks, convert to dB
        const dbSpectrum = new Float32Array(fftSize / 2);
        for (let j = 0; j < fftSize / 2; j++) {
            dbSpectrum[j] = 10 * Math.log10(powerSpectrum[j] / numBlocks + 1e-10);
        }

        // Find threshold: mean power of all bins above 14kHz
        const minBin = Math.floor(MIN_ANALYSIS_FREQ * fftSize / sampleRate);
        let sum = 0;
        for (let j = minBin; j < fftSize / 2; j++) sum += dbSpectrum[j];
        const meanDb = sum / (fftSize / 2 - minBin);

        // Max useful frequency: highest bin above 14kHz that is significantly
        // above the mean (i.e. has actual signal, not just noise floor)
        const SIGNAL_THRESHOLD = meanDb + 10; // 10dB above noise
        let maxBin = minBin;
        for (let j = fftSize / 2 - 1; j >= minBin; j--) {
            if (dbSpectrum[j] > SIGNAL_THRESHOLD) {
                maxBin = j;
                break;
            }
        }

        return (maxBin * sampleRate) / fftSize;
    }

    try {
        // Run both analyses in parallel (FakeFLAC approach)
        const [originalSamples, fakeSamples] = await Promise.all([
            getPCMData(filePath, false),
            getPCMData(filePath, true)
        ]);

        const originalMaxFreq = getMaxHighFrequency(originalSamples);
        const fakeMaxFreq = getMaxHighFrequency(fakeSamples);

        // Key FakeFLAC logic: compare the two max frequencies.
        // If original ≈ fake → the file was already lossy (fake lossless).
        // If original > fake by a meaningful margin → it's genuinely lossless.
        const freqDiff = originalMaxFreq - fakeMaxFreq;
        const isHighQuality = freqDiff > 1000; // >1kHz gap means genuine high-freq content

        let estimatedBitrate: string;
        if (!isHighQuality) {
            // Original and fake match → already a lossy source
            if (fakeMaxFreq < 15500) estimatedBitrate = 'Low Quality / Fake';
            else if (fakeMaxFreq < 18000) estimatedBitrate = 'Medium (128k-192k)';
            else estimatedBitrate = 'Good (256k)';
        } else {
            estimatedBitrate = 'High Quality (320k/Lossless)';
        }

        return { maxFrequency: originalMaxFreq, estimatedBitrate, isHighQuality };
    } catch (e) {
        // Fallback if FFmpeg pipe chaining fails
        return { maxFrequency: 0, estimatedBitrate: 'Unknown', isHighQuality: false };
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
