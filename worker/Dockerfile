# Vidora video-processing worker.
# CPU faster-whisper + FFmpeg/ffprobe. The STT model is baked into the image at
# build time so no job pays a cold model download (a persistent volume can also
# be mounted at /models to share the cache across restarts).
FROM python:3.11-slim

# ffmpeg provides both ffmpeg and ffprobe. tini gives us correct signal
# forwarding for graceful shutdown (SIGTERM -> worker.request_stop).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    STT_DOWNLOAD_ROOT=/models \
    WORK_DIR=/tmp/vidora-worker \
    HEALTH_PORT=8080

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the STT model into the image. STT_MODEL is a build arg so the
# baked model matches the runtime model (default: small / int8 on CPU).
ARG STT_MODEL=small
ARG STT_COMPUTE_TYPE=int8
ENV STT_MODEL=${STT_MODEL} STT_COMPUTE_TYPE=${STT_COMPUTE_TYPE}
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${STT_MODEL}', device='cpu', compute_type='${STT_COMPUTE_TYPE}', download_root='/models')"

COPY app ./app

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "app.main"]
