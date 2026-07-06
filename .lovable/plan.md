# ClipGrab — Plan

## Scope split

**I build:** the full frontend + a TanStack server route that proxies to your self-hosted yt-dlp extractor.
**You provide:** a running yt-dlp + ffmpeg HTTP service (VPS, Fly.io, Render, etc.) exposing two endpoints:
- `POST /info` → `{ url }` returns `{ title, channel, duration, thumbnail, formats: [{ quality, hasAudio, sizeEstimate }] }`
- `POST /download` → `{ url, quality }` streams the muxed file back (or returns a signed URL)

Once you have the service URL + a shared secret, I'll wire it in via two secrets: `EXTRACTOR_URL` and `EXTRACTOR_TOKEN`.

## Design

- **Font:** Inter (via `@fontsource/inter`), tight tracking on headings.
- **Palette (tokens in `src/styles.css`):**
  - Accent: `#2563EB` (cobalt) → `--primary`
  - Light: bg `#FAFAFA`, fg `#0A0A0A`, muted `#737373`, border `#E5E5E5`
  - Dark: bg `#0A0A0A`, fg `#FAFAFA`, muted `#A3A3A3`, border `#1F1F1F`
- **Layout:** single centered column, max-width ~640px, generous vertical rhythm, no nav chrome. Logo wordmark top-left, theme toggle top-right.
- **Motion:** subtle — 150ms ease for state changes, spring on preview card entrance, progress bar fills smoothly.

## Screens / states (single page)

```text
┌─────────────────────────────────┐
│ ClipGrab              [☀/🌙]   │
│                                 │
│      Paste a YouTube link       │
│  ┌───────────────────────────┐  │
│  │ https://…            [📋] │  │  ← auto-paste chip
│  └───────────────────────────┘  │
│         inline hint text        │
│                                 │
│  ┌─── preview card ─────────┐   │
│  │ [thumb] Title            │   │
│  │        Channel · 4:32    │   │
│  │  [4K][1440][1080][720]   │   │
│  │  [ Audio only ]          │   │
│  │  ────── Download ──────  │   │
│  └──────────────────────────┘   │
│                                 │
│  Queue (if >1):                 │
│  • item 1 — 43% ▓▓▓░░           │
│  • item 2 — queued              │
│                                 │
│  For personal use only. …       │
└─────────────────────────────────┘
```

## Core behaviors

- URL validation regex covers `youtube.com/watch`, `youtu.be/<id>`, `youtube.com/shorts/<id>`, `m.youtube.com`.
- Debounce input 400ms → auto-fetch metadata when valid; cancel in-flight if URL changes.
- On mount, request clipboard read permission; if a valid YouTube URL is on clipboard, show a one-tap "Paste detected link" chip (never auto-fill silently).
- Quality selector shows only formats returned by the extractor. Last-used quality stored in `localStorage` and pre-selected when available.
- Duplicate URL in queue → toast, no re-add.
- Queue processes one at a time; each item shows: thumbnail, title, quality, progress %, status (queued / downloading / done / error + retry).
- Errors mapped to friendly text: invalid link, private/age-restricted, unavailable, network, rate-limited.

## Tech

**Frontend**
- TanStack Start route `src/routes/index.tsx` — the whole app.
- Components: `UrlInput`, `PreviewCard`, `QualitySelector`, `QueueItem`, `ThemeToggle`, `Footer`.
- Theme: class-based dark mode, defaults to system, toggle persisted in localStorage.
- State: local React state + Zustand-free (single `useReducer` for the queue).

**Server (TanStack server routes, not Supabase Edge Functions)**
- `src/routes/api/info.ts` (POST) — validates URL, forwards to `${EXTRACTOR_URL}/info` with `Authorization: Bearer ${EXTRACTOR_TOKEN}`, returns normalized metadata.
- `src/routes/api/download.ts` (POST) — validates URL + quality, forwards to extractor, streams response back with `Content-Disposition` set from title. If your extractor returns a signed URL instead, this returns `{ url }` and the browser fetches it directly.
- Zod validation on both. Simple in-memory IP rate limit (10 req/min) — noted as best-effort since Workers are stateless; real limiting needs Durable Objects or your extractor enforcing it.
- Input sanitization: strip to canonical `youtube.com/watch?v=<id>` or `youtu.be/<id>` before forwarding.

**No Lovable Cloud / no database.** Queue lives in memory; nothing persisted server-side.

## Secrets I'll ask you to add after the plan is approved

- `EXTRACTOR_URL` — your service base URL
- `EXTRACTOR_TOKEN` — shared bearer token

## Out of scope

- Actual yt-dlp/ffmpeg execution (you host it).
- User accounts, history, cloud storage.
- Playlist / channel batch downloads (single videos only, though queue lets you paste many).

## Footer

`For personal use only. Respect content owners' rights and YouTube's Terms of Service.`

---

Approve to build. After the plan is approved I'll scaffold the UI + proxy routes and prompt you for `EXTRACTOR_URL` / `EXTRACTOR_TOKEN`.
