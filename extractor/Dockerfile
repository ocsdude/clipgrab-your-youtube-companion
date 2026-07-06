# ClipGrab extractor — yt-dlp + ffmpeg + bgutil PO-token provider.
FROM python:3.12-slim

# ffmpeg for muxing; nodejs for the bgutil PO-token script provider.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Install the bgutil PO-token provider (script mode — no sidecar needed).
RUN mkdir -p /app/bgutil \
 && curl -fsSL https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/generate_once.js \
      -o /app/bgutil/generate_once.js \
 && chmod +x /app/bgutil/generate_once.js

COPY requirements.txt .
RUN pip install -r requirements.txt \
 && pip install -U --pre "yt-dlp[default]" \
 && pip install bgutil-ytdlp-pot-provider

COPY app.py .

RUN useradd -m -u 10001 app && chown -R app /app
USER app

EXPOSE 8080

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1"]
