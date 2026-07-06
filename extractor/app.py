"""
ClipGrab extractor service.

Wraps yt-dlp + ffmpeg behind a small REST API that the ClipGrab frontend's
TanStack server routes proxy to. Auth is a shared Bearer token.

Endpoints
---------
GET  /health           -> {"ok": true}
POST /info             -> {url} -> normalized metadata + available formats
POST /download         -> {url, quality} -> streams the muxed media file back

`quality` is one of: "2160p", "1440p", "1080p", "720p", "audio".
"""
from __future__ import annotations

import os
import re
import shutil
import tempfile
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

TOKEN = os.environ.get("EXTRACTOR_TOKEN", "").strip()
if not TOKEN:
    raise RuntimeError("EXTRACTOR_TOKEN env var is required")

YDL_ANTIBOT_OPTS: dict[str, Any] = {
    "extractor_args": {
        "youtube": {"player_client": ["ios", "tv", "web_safari", "web"]},
        "youtubepot-bgutilscript": {"server_home": ["/app/bgutil/server"]},
    },
}

# --- URL sanitization -------------------------------------------------------
YT_RE = re.compile(
    r"^https?://(?:www\.|m\.)?"
    r"(?:youtube\.com/(?:watch\?v=|shorts/|embed/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})"
)


def canonical_url(raw: str) -> str:
    m = YT_RE.match(raw.strip())
    if not m:
        raise HTTPException(400, "invalid_youtube_url")
    return f"https://www.youtube.com/watch?v={m.group(1)}"


# --- Rate limiting (per-IP, in-memory) --------------------------------------
RATE_WINDOW = 60          # seconds
RATE_MAX = 20             # requests per window per IP
_hits: dict[str, deque[float]] = defaultdict(deque)


def check_rate(ip: str) -> None:
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_MAX:
        raise HTTPException(429, "rate_limited")
    q.append(now)


# --- Auth -------------------------------------------------------------------
def check_auth(authorization: str | None) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing_bearer")
    if authorization.removeprefix("Bearer ").strip() != TOKEN:
        raise HTTPException(401, "invalid_token")


# --- App --------------------------------------------------------------------
app = FastAPI(title="ClipGrab extractor", version="1.0.0")


class InfoBody(BaseModel):
    url: str = Field(min_length=5, max_length=500)


class DownloadBody(BaseModel):
    url: str = Field(min_length=5, max_length=500)
    quality: str = Field(pattern=r"^(2160p|1440p|1080p|720p|audio)$")


QUALITY_HEIGHT = {"2160p": 2160, "1440p": 1440, "1080p": 1080, "720p": 720}


def _friendly_error(e: Exception) -> tuple[int, str]:
    msg = str(e).lower()
    if "private" in msg:
        return 403, "private_video"
    if "age" in msg and "restrict" in msg:
        return 403, "age_restricted"
    if "unavailable" in msg or "removed" in msg or "not exist" in msg:
        return 404, "video_unavailable"
    if "sign in" in msg or "confirm" in msg:
        return 403, "sign_in_required"
    return 502, "extraction_failed"


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/version")
def version() -> dict[str, str]:
    import yt_dlp
    return {"yt_dlp": yt_dlp.version.__version__}


@app.post("/info")
def info(body: InfoBody, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    check_auth(authorization)
    check_rate(request.client.host if request.client else "unknown")
    url = canonical_url(body.url)

    ydl_opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        **YDL_ANTIBOT_OPTS,
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            data: dict[str, Any] = ydl.extract_info(url, download=False)
    except DownloadError as e:
        code, key = _friendly_error(e)
        raise HTTPException(code, key)

    heights = {
        f.get("height")
        for f in data.get("formats") or []
        if f.get("vcodec") and f.get("vcodec") != "none" and f.get("height")
    }
    available = []
    for q, h in QUALITY_HEIGHT.items():
        if any(vh and vh >= h - 20 for vh in heights):
            available.append(q)
    available.append("audio")

    def estimate(quality: str) -> int | None:
        formats = data.get("formats") or []
        if quality == "audio":
            audio = max(
                (f for f in formats if f.get("acodec") not in (None, "none") and f.get("vcodec") == "none"),
                key=lambda f: f.get("abr") or 0,
                default=None,
            )
            return int(audio.get("filesize") or audio.get("filesize_approx") or 0) if audio else None
        h = QUALITY_HEIGHT[quality]
        video = max(
            (f for f in formats if f.get("vcodec") not in (None, "none") and (f.get("height") or 0) <= h + 20),
            key=lambda f: f.get("height") or 0,
            default=None,
        )
        audio = max(
            (f for f in formats if f.get("acodec") not in (None, "none") and f.get("vcodec") == "none"),
            key=lambda f: f.get("abr") or 0,
            default=None,
        )
        v = int((video or {}).get("filesize") or (video or {}).get("filesize_approx") or 0)
        a = int((audio or {}).get("filesize") or (audio or {}).get("filesize_approx") or 0)
        return (v + a) or None

    formats_out = [
        {"quality": q, "hasAudio": True, "sizeEstimate": estimate(q)} for q in available
    ]

    return JSONResponse(
        {
            "id": data.get("id"),
            "title": data.get("title"),
            "channel": data.get("uploader") or data.get("channel"),
            "duration": data.get("duration"),
            "thumbnail": data.get("thumbnail"),
            "formats": formats_out,
        }
    )


def _safe_filename(name: str) -> str:
    name = re.sub(r"[^\w\-. ]+", "_", name).strip() or "video"
    return name[:120]


@app.post("/download")
def download(body: DownloadBody, request: Request, authorization: str | None = Header(None)):
    check_auth(authorization)
    check_rate(request.client.host if request.client else "unknown")
    url = canonical_url(body.url)

    tmpdir = Path(tempfile.mkdtemp(prefix="clipgrab_"))
    cleanup = BackgroundTask(shutil.rmtree, tmpdir, ignore_errors=True)

    if body.quality == "audio":
        fmt = "bestaudio/best"
        outtmpl = str(tmpdir / "%(title).100s.%(ext)s")
        postprocessors = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "m4a", "preferredquality": "192"}
        ]
        ext_hint = "m4a"
        mime = "audio/mp4"
    else:
        h = QUALITY_HEIGHT[body.quality]
        fmt = f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={h}]+bestaudio/best[height<={h}]"
        outtmpl = str(tmpdir / "%(title).100s.%(ext)s")
        postprocessors = [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}]
        ext_hint = "mp4"
        mime = "video/mp4"

    ydl_opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "format": fmt,
        "outtmpl": outtmpl,
        "merge_output_format": "mp4" if body.quality != "audio" else None,
        "postprocessors": postprocessors,
        "noplaylist": True,
        **YDL_ANTIBOT_OPTS,
    }

    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            path = Path(ydl.prepare_filename(info)).with_suffix(f".{ext_hint}")
            if not path.exists():
                candidates = list(tmpdir.iterdir())
                if not candidates:
                    raise HTTPException(502, "extraction_failed")
                path = candidates[0]
    except HTTPException:
        cleanup()
        raise
    except DownloadError as e:
        cleanup()
        code, key = _friendly_error(e)
        raise HTTPException(code, key)
    except Exception:
        cleanup()
        raise HTTPException(500, "internal_error")

    filename = f"{_safe_filename(info.get('title') or 'video')}.{ext_hint}"
    return FileResponse(
        path,
        media_type=mime,
        filename=filename,
        background=cleanup,
    )
