# onlineMusic

A local-first music workbench: collect audio, video, and images into your own media library, read embedded tags and cover art, then preview, inspect waveforms, and edit metadata right in the browser. The interface is a fully hand-built frosted glass system (backdrop-filter + edge refraction + ink colour that adapts to the backdrop), with no external services.

![onlineMusic interface](docs/screenshot.jpg)

## Features

- **Local accounts** — email + password sign-up and sign-in, salted `scrypt` hashes, sessions in an HttpOnly cookie valid for one year. All data stays on your own disk.
- **Media ingestion** — audio `wav / mp3 / flac / aiff / m4a / ogg`, video `mp4 / mov / webm`, images `png / jpg / jpeg / webp`, up to 10000 assets per account.
- **Automatic tag reading** — embedded title, artist, album, and cover art are parsed in the browser on import.
- **Waveform and playback controls** — drag the waveform to seek, adjustable gain and playback rate, shuffle / previous / next / loop, plus a fullscreen Now Playing view.
- **Metadata editing** — title, artist, album, genre, lyrics, description, and tags.
- **Library views** — grouped by album; the index streams line by line as NDJSON and covers are fetched on demand, so even large libraries show their first rows immediately.
- **Responsive** — sidebar + workbench on desktop; a bottom pill navigation and fullscreen lyrics on narrow screens.

## Tech stack

| | |
|---|---|
| Framework | Next.js 14 (App Router, standalone output) |
| Language | TypeScript |
| UI | React 18 + hand-written CSS (`styles/`), icons from lucide-react |
| Tag parsing | music-metadata |
| Storage | JSON index on the file system + media directory |
| Deployment | Docker / docker-compose, named volume `music_data` |

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

For production, use Docker:

```bash
./build.sh             # docker-compose build && docker-compose up -d
```

## Desktop app (macOS)

The same interface packages as a `.app`: an Electron shell (`desktop/`) around the static export
of the UI. The app is a pure client — it bundles no server and no data; accounts and media are
fetched from the API server named in Settings → Server.

```bash
npm install
npm run package:mac    # builds the static export and assembles dist/onlineMusic.app
```

The shell serves the UI from a privileged `app://bundle` scheme, so its origin is stable and the
server can allowlist it. For the app to reach the server:

1. Allow the app's origin on the server (uncomment in `docker-compose.yml`):
   `ALLOWED_ORIGINS: app://bundle`
2. Point the app at the server in **Settings → Server** (empty means the local
   `http://localhost:3000`, where cookies work because localhost is a trustworthy origin).

Any other client can be hosted the same way: `npm run build:client` produces the static export
in `out/`, and the server answers whichever origins `ALLOWED_ORIGINS` lists (comma-separated,
credentials included). A client on a *different machine* needs the API behind HTTPS — the
commented `proxy` service in `docker-compose.yml` puts Caddy in front (`tls internal` self-signs
for LAN use; see `Caddyfile`) — because cross-origin session cookies are `SameSite=None; Secure`,
and browsers only store Secure cookies over https (localhost excepted).

The UI itself is unchanged between the browser and the desktop app.

## Where data lives

All state lives under the directory pointed to by `AUTH_DATA_DIR` (default `./data`):

```
data/
├── accounts.json      # accounts, password hashes, sessions
├── assets.json        # media index and metadata
└── media/             # uploaded original files, named by uuid
```

In a Docker deployment that directory is the named volume `music_data`, so rebuilding the container does not lose data.

## Directory structure

```
app/
├── page.tsx           # main workbench: library, editor, player state
├── bottom-pill.tsx    # narrow-screen bottom navigation
├── layout.tsx
└── api/
    ├── auth/          # register / login / logout / current session
    └── assets/        # list (NDJSON streaming index), upload, detail, cover, original file
features/
├── glass/             # the Liquid Glass system (engine, settings, markers)
├── lyrics/            # lyrics editor and playback rendering
├── now-playing/       # fullscreen Now Playing view
├── player/            # waveform seek bar and media clock
├── appearance/        # theme and appearance settings
├── parameters/        # playback parameter controls
└── video/             # video overlay
lib/
├── accounts.ts        # account and session storage
├── assets.ts          # media index storage
├── asset-validation.ts# input validation
├── embedded-tags.ts   # embedded tag and cover parsing
├── glassEdge.ts       # glass edge refraction (SVG displacement filter)
├── glassWebgl.ts      # WebGL take on the glass
└── inkSampler.ts      # samples the backdrop to derive the text ink colour
styles/
├── shared.css         # shared tokens and primitives
├── shell.css          # app shell styles
└── now.css            # now playing / lyrics styles
shared/
├── lyrics/            # karaoke parse / timeline / edit, shared code
├── types/             # shared media types
└── utilities/         # media, settings, and time helpers
```
