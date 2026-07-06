# ClipGrab extractor — yt-dlp + ffmpeg behind a small FastAPI service.
FROM python:3.12-slim

# ffmpeg is required for merging video+audio streams (needed for 1080p+ / 4K).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

# Run as non-root
RUN useradd -m -u 10001 app && chown -R app /app
USER app

EXPOSE 8080

# Single worker keeps per-IP rate-limit state consistent. Scale horizontally
# by putting a real limiter (or your host's) in front if you need more.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1"]
