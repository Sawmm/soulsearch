# ♫ Soulseek Browser TUI

A high-performance, standalone Terminal User Interface (TUI) for the Soulseek network. Built with Node.js, React (Ink), and `slsk-client`.

Designed for crate diggers who want a fast, focused, and visually pleasing way to discover music without leaving the terminal.

![Soulseek TUI Screenshot Placeholder](https://via.placeholder.com/800x400.png?text=Soulseek+TUI+Browser)

## Features

- **Direct Network Access:** Connects directly to the Soulseek network (no `slskd` daemon required).
- **Instant Search:** Results stream live as they are found on the network.
- **Audio-Only Focus:** Automatically filters for music files (`.mp3`, `.flac`, `.wav`, etc.).
- **Smart Sorting:** Automatically sorts results by file size (quality first).
- **Discogs Integration:** View real release metadata (Label, Genre, Year) directly in the TUI using the Discogs API.
- **YouTube Integration:** Instantly search for a track on YouTube to preview.
- **Download Manager:** Track multiple downloads with real-time progress bars.
- **File Sharing:** Share your own collection with the community.
- **High Contrast:** Optimized for modern terminals like **Ghostty**.

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

4.  **Link the command (Optional):**
    ```bash
    npm link
    ```
    Now you can run it anywhere using `soulsearch`.

## Configuration

Create a configuration file at `~/.config/soulseekbrowser/config.json`:

```json
{
  "username": "your_soulseek_username",
  "password": "your_soulseek_password",
  "downloadPath": "~/Music/SoulseekDownloads",
  "sharePath": "~/Music/MySharedFolders",
  "portForwarded": false,
  "discogsToken": "YOUR_DISCOGS_PERSONAL_ACCESS_TOKEN",
  "search": {
    "minBitrate": 320,
    "sortBy": "size",
    "sortOrder": "desc"
  },
  "ui": {
    "viewportSize": 15
  }
}
```

### Key Settings:
- `portForwarded`: Set to `false` (Restricted Mode) if you haven't opened port **2234** on your router. The app will only show "OPEN" slots to ensure downloads actually start.
- `discogsToken`: Generate one at [Discogs Developer Settings](https://www.discogs.com/settings/developers).

## Keybindings

### Global
- **`Tab`**: Toggle between **Search Results** and **Downloads Manager**.
- **`Esc`**: Refocus the **Search Bar**.

### Search Bar
- **`Enter`**: Submit search query.
- **`Alt + Backspace`**: Delete previous word.
- **`Cmd + Backspace`** (or `Ctrl + U`): Clear entire line.

### Results View
- **`j` / `k`** (or Arrows): Scroll through files.
- **`g` / `G`**: Jump to Top / Bottom.
- **`Enter`**: Download selected file.
- **`y`**: Search track on **YouTube** (browser).
- **`d`**: View **Discogs** release info (in-app).

### Downloads View
- **`x`**: Cancel selected active download.
- **`c`**: Clear finished/error downloads from the list.

## License

MIT
