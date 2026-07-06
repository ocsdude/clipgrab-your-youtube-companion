# ClipGrab extractor — yt-dlp + ffmpeg + bgutil PO-token provider.
FROM python:3.12-slim

# ffmpeg for muxing; nodejs + git to build the bgutil PO-token script provider.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl gnupg git \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    BGUTIL_VERSION=1.3.1

WORKDIR /app

# Build the bgutil PO-token generation script (option "b" from upstream README).
RUN git clone --depth 1 --single-branch --branch ${BGUTIL_VERSION} \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /tmp/bgutil \
 && cd /tmp/bgutil/server \
 && npm ci \
 && npx tsc \
 && mkdir -p /app/bgutil \
 && cp -r /tmp/bgutil/server /app/bgutil/server \
 && rm -rf /tmp/bgutil

COPY requirements.txt .
RUN pip install -r requirements.txt \
 && pip install -U --pre "yt-dlp[default]" \
 && pip install "bgutil-ytdlp-pot-provider"

COPY app.py .

RUN useradd -m -u 10001 app && chown -R app /app
USER app

EXPOSE 8080

CMD ["sh", "-c", "node /app/bgutil/server/build/main.js --port 4416 & uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1"]
