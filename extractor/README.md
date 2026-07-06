# ClipGrab extractor

Small FastAPI service that wraps [`yt-dlp`](https://github.com/yt-dlp/yt-dlp)
and `ffmpeg`. The ClipGrab frontend proxies to it via its own server routes;
this service is never exposed directly to the browser.

## API

All non-health endpoints require `Authorization: Bearer $EXTRACTOR_TOKEN`.

### `GET /health`
```json
{ "ok": true }
```

### `POST /info`
Request:
```json
{ "url": "https://youtu.be/dQw4w9WgXcQ" }
```
Response:
```json
{
  "id": "dQw4w9WgXcQ",
  "title": "…",
  "channel": "…",
  "duration": 213,
  "thumbnail": "https://…",
  "formats": [
    { "quality": "2160p", "hasAudio": true, "sizeEstimate": 123456789 },
    { "quality": "1080p", "hasAudio": true, "sizeEstimate": 45678901 },
    { "quality": "720p",  "hasAudio": true, "sizeEstimate": 23456789 },
    { "quality": "audio", "hasAudio": true, "sizeEstimate":  3456789 }
  ]
}
```

### `POST /download`
Request:
```json
{ "url": "https://youtu.be/dQw4w9WgXcQ", "quality": "1080p" }
```
Response: streams the muxed file (`video/mp4` or `audio/mp4`) with
`Content-Disposition: attachment; filename="…"`. Video + audio streams are
merged server-side, so 1080p / 1440p / 4K always arrive with sound.

`quality` must be one of `2160p`, `1440p`, `1080p`, `720p`, `audio`.

### Error shape
FastAPI's standard `{ "detail": "<key>" }` with these keys:
`invalid_youtube_url`, `private_video`, `age_restricted`, `video_unavailable`,
`sign_in_required`, `rate_limited`, `missing_bearer`, `invalid_token`,
`extraction_failed`, `internal_error`.

## Local development

```bash
cd extractor
docker build -t clipgrab-extractor .
docker run --rm -p 8080:8080 -e EXTRACTOR_TOKEN=dev-token clipgrab-extractor
curl -s localhost:8080/health
curl -s -X POST localhost:8080/info \
  -H "Authorization: Bearer dev-token" \
  -H "content-type: application/json" \
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ"}' | jq
```

## Deploy to Fly.io

Requires the [`flyctl`](https://fly.io/docs/hands-on/install-flyctl/) CLI.

```bash
cd extractor
fly launch --no-deploy --copy-config --name clipgrab-extractor
fly secrets set EXTRACTOR_TOKEN=$(openssl rand -hex 32)
fly deploy
fly status              # shows the https://clipgrab-extractor.fly.dev URL
```

Take note of the generated token and the app URL — you'll paste them into
ClipGrab as `EXTRACTOR_TOKEN` and `EXTRACTOR_URL`.

Notes:
- `fly.toml` uses `auto_stop_machines` so the machine sleeps when idle.
  Cold starts add ~2s to the first request; downloads themselves are the
  slow part anyway.
- 4K muxing benefits from more RAM. If you hit OOMs, bump the `[[vm]]`
  block to `memory_mb = 2048`.

## Deploy to Render.com

1. Push this `extractor/` folder to a Git repo (GitHub / GitLab).
2. In Render, click **New → Blueprint**, point it at the repo, and select
   `extractor/render.yaml`.
3. After the service is created, open **Environment** and set
   `EXTRACTOR_TOKEN` to a long random string
   (`openssl rand -hex 32`).
4. Copy the service URL (`https://clipgrab-extractor.onrender.com`) — this
   is your `EXTRACTOR_URL`.

Render's free tier sleeps aggressively and has a hard request timeout that
can cut off long 4K downloads. Use at least the **Starter** plan for real
use, and **Standard** if you download a lot of 4K.

## Wiring it into ClipGrab

Once the service is up, tell the Lovable agent:

> Add secrets: `EXTRACTOR_URL=https://…` and `EXTRACTOR_TOKEN=…`

The frontend's `/api/info` and `/api/download` server routes will start
forwarding to it automatically.

## Legal

This service downloads content from YouTube, which violates YouTube's Terms
of Service unless you have explicit rights to the content. Run it only for
material you own, have licensed, or are legally permitted to archive.
