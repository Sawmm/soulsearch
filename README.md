# ♫ Soulseek Browser TUI

A high-performance, standalone Terminal User Interface (TUI) for the Soulseek network. Built with Node.js, React (Ink), and `slsk-client`.

Designed for crate diggers and DJs who want a fast, focused, and visually pleasing way to discover music without leaving the terminal. Optimized for **Ghostty** and high-contrast terminal environments.

```text
 ♫ SOULSEEK BROWSER
 ╭──────────────────────────────────────────────────────────────────╮
 │ SEARCH artist, album, or song...                                 │
 ╰──────────────────────────────────────────────────────────────────╯
 ● Results: 45 users found for "Boards of Canada"
 ╭──────────────────────────────────────────────────────────────────╮
 │ USER          FILENAME                        SIZE ↓    SLOTS    │
 │ music_fan     01 - Wildlife Analysis.mp3      2.4 MB    OPEN     │
 │ idm_lover     02 - An Eagle In Your Mind.flac 34.1 MB   OPEN     │
 ╰──────────────────────────────────────────────────────────────────╯
 [j/k] Scroll  [Enter] DL  [y] YouTube  [d] Discogs  [Tab] Downloads
```

## Features

- **Direct Network Access:** Connects directly to the Soulseek network (no `slskd` daemon required).
- **Instant Search:** Results stream live as they are found on the network using throttled updates for smooth performance.
- **Audio-Only Focus:** Automatically filters for music files (`.mp3`, `.flac`, `.wav`, `.m4a`, `.ogg`, `.aiff`, etc.).
- **Smart Sorting:** Automatically sorts results by file size (quality first) or bitrate.
- **Discogs Integration:** View real release metadata (Label, Genre, Year, Style) directly in the TUI without a browser.
- **YouTube Integration:** Instantly search for a track on YouTube to preview.
- **Advanced Download Manager:** 
    - Track active downloads with real-time, byte-accurate progress bars.
    - **Visual Strikethrough:** Cancelled or previously downloaded files are visually marked to prevent duplicates.
    - **Background Transfers:** Multiple downloads can run simultaneously while you continue searching.
- **Smart Auto-Conversion (DJ Focused):** 
    - Automatically converts downloads to **Rekordbox/CDJ compatible AIFF** (`pcm_s16be`) or **MP3**.
    - **Dynamic Quality Logic:** High-quality sources (>= 19.5kHz) are kept lossless (AIFF), while upscaled or low-quality files are converted to MP3 to save space.
- **Spectral Analysis:** Uses Fast Fourier Transform (FFT) to detect "fake" high-bitrate files by analyzing the actual frequency cutoff.
- **File Sharing:** Share your own collection with the community by specifying a folder in the config.
- **Ghostty Optimized:** Custom Dracula-inspired theme designed for readability on dark backgrounds.

## Requirements

- **Node.js:** v18 or higher.
- **FFmpeg:** Required for audio conversion and spectral analysis.
    - macOS: `brew install ffmpeg`
    - Linux: `sudo apt install ffmpeg`

## Installation

1.  **Clone the repo:**
    ```bash
    git clone https://github.com/yourusername/soulseek-browser-tui.git
    cd soulseek-browser-tui
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Build the project:**
    ```bash
    npm run build
    ```

4.  **Link the command:**
    ```bash
    npm link
    ```
    Now you can run it anywhere using `soulsearch`.

## Configuration

The app stores its configuration at `~/.config/soulseekbrowser/config.json`. 

```json
{
  "username": "your_soulseek_username",
  "password": "your_soulseek_password",
  "downloadPath": "~/Music/SoulseekDownloads",
  "sharePath": "~/Music/MySharedFolders",
  "portForwarded": false,
  "discogsToken": "OPTIONAL_DISCOGS_TOKEN",
  "autoConvert": {
    "enabled": true,
    "smartMode": true,
    "targetFormat": "mp3",
    "mp3Bitrate": "320k",
    "detectFakeBitrate": true,
    "deleteOriginal": true,
    "normalizeVolume": false,
    "targetLufs": -14.0,
    "smartFolders": false
  },
  "search": {
    "minBitrate": 320,
    "sortBy": "size",
    "sortOrder": "desc",
    "wishlist": ["joy orbison unreleased", "rare track"]
  },
  "ui": {
    "viewportSize": 15
  }
}
```

### Key Settings Explained:
- `portForwarded`: Set to `false` (Restricted Mode) if you haven't opened port **2234** on your router. The app will only show results with "OPEN" slots to ensure downloads actually start.
- `autoConvert.smartMode`: If true, high-quality sources become AIFF (CDJ compatible) and low-quality sources become MP3.
- `autoConvert.detectFakeBitrate`: Uses the **FakeFLAC method** to detect upscaled fake lossless files. The file is re-encoded through 320k MP3 and back, then both versions are spectrally analysed above 14kHz. If the original and the re-encoded version have the same max frequency, the source was already lossy (fake). The *actual* quality is shown in the Downloads `CONVERSION` column.
- `autoConvert.normalizeVolume`: If `true`, runs the file through FFmpeg's `loudnorm` filter to equalize it to `targetLufs` (default `-14.0`). Essential for DJs so all downloaded tracks play at the exact same perceived volume.
- `autoConvert.smartFolders`: Automatically parses ID3 metadata and sorts finished files into a `Downloads/Genre/Artist/` hierarchy block.
- `search.wishlist`: An array of search queries. The app quietly searches for these every 10 minutes in the background and silently snatches >320CBR HQ matches if found.
- `discogsToken`: (Optional) Generate one at [Discogs Developer Settings](https://www.discogs.com/settings/developers) for 60 req/min limits.

### Ghostty / macOS Troubleshooting
If `Cmd + Backspace` doesn't clear the search line correctly, add this to your Ghostty config (`~/.config/ghostty/config`):
```bash
# Map Cmd+Backspace to standard "kill line" sequence
keybind = cmd+backspace=text:\x15
```

## Keybindings

### Global
- **`Tab`**: Toggle between **Search Results** and **Downloads Manager**.
- **`Esc`**: Toggle focus between **Search Bar** and **Results Table**.

### Search Bar
- **`Enter`**: Submit search query.
- **`Alt + Backspace`**: Delete previous word.
- **`Cmd + Backspace`** (or `Ctrl + U`): Clear entire line.

### Results View
- **`j` / `k`** (or Arrows): Scroll through files.
- **`g` / `G`**: Jump to Top / Bottom.
- **`f` / `/`**: Open inline secondary text filter.
- **`Enter`**: Download selected file.
- **`y`**: Search track on **YouTube** (browser).
- **`d`**: View **Discogs** release info (in-app overlay).

### Downloads View
- **`j` / `k`**: Scroll through download list.
- **`Spacebar`**: Locally stream/play a downloaded track (requires `ffplay` or macOS `afplay`).
- **`x`**: Cancel selected active download or conversion.
- **`c`**: Clear finished/error downloads from the list.

## License

MIT
