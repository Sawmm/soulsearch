# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # TypeScript compile (tsc) → dist/
npm start           # Run compiled app: node dist/index.js
npm test            # Run tests with Vitest
npm run test:ci     # Type check + test (CI)
```

To run a single test file:
```bash
npx vitest run test/converter.test.ts
```

After `npm link`, the app is available as the global `soulsearch` CLI command.

## Architecture

**SoulSearch** is a Terminal UI (TUI) for the Soulseek P2P network, built with React + [Ink](https://github.com/vadimdemedes/ink) and TypeScript (ES modules). No backend server — it connects directly to Soulseek peers via `slsk-client`.

### Data Flow

```
src/index.tsx          Entry point — renders <App /> via Ink
src/App.tsx            Root component: connection, state, keyboard routing
  ├── src/api.ts       Soulseek + Discogs API, config loading, download streams
  ├── src/hooks/
  │   ├── useSearch.ts       Real-time search results + file stats
  │   ├── useDownloads.ts    Download lifecycle: queue → download → convert → organize
  │   └── useWishlistDaemon  Background 10-min timer for wishlist queries
  └── src/components/
      ├── SearchInput.tsx    Custom text input with word-delete shortcuts
      ├── ResultTable.tsx    Scrollable results with sort/filter/actions
      ├── DownloadView.tsx   Progress bars, playback, cancellation
      └── DiscogsView.tsx    Release metadata overlay
src/converter.ts       FFT spectral analysis + FFmpeg conversion
src/types.ts           All shared TypeScript interfaces
src/theme.ts           Dracula-based color constants
```

### Key Architectural Points

**Focus system:** App has 4 focus modes (`search`, `results`, `downloads`, `discogs`). `Tab` switches between results/downloads; `Esc` toggles search ↔ results or dismisses overlays. Keyboard events are delegated to the focused component.

**Config:** Loaded from `~/.config/soulsearch/config.json` on startup via `loadConfig()`. Credentials are stored as `b64:`-prefixed base64 strings. `getAppConfig()` returns the cached config after initialization.

**Restricted vs Full mode:** If `portForwarded: false`, results are filtered to only show peers with open upload slots. Status bar shows "RESTRICTED" or "FULL".

**Download pipeline:** `handleDownload` in `useDownloads.ts` orchestrates: stream from peer → write to disk → `detectActualBitrate()` (FFT analysis) → `convertAudio()` (FFmpeg, smart AIFF/MP3 selection) → `applySmartFolders()` (ID3 tag → `Genre/Artist/` structure). Each step is cancellable.

**Fake lossless detection:** `detectActualBitrate()` in `converter.ts` runs FFT on the original file and a 320k MP3 re-encode, compares max frequency above 14kHz. A >1000Hz difference indicates genuine lossless content. Results drive smart format selection (AIFF for real lossless, MP3 for upscaled lossy).

**Playback:** macOS uses `afplay`, Linux uses `ffplay`. Spawned as child processes stored in refs so they can be killed.

**UI throttling:** `performSearch` in `api.ts` batches result callbacks to max every 200ms to prevent terminal lag from rapid Ink re-renders.

### Testing

Tests in `test/` use Vitest and generate real audio files via FFmpeg (white noise, 128k→FLAC fakes, tagged MP3s). Tests have elevated timeouts (10–40s) due to FFmpeg processing. Tests cover: spectral analysis accuracy, config validation/encoding, smart folder organization, and format conversion.
