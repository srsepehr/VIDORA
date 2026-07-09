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

# Pre-download the STT + translation models into the image so no job ever
# re-downloads. Defaults match the private zero-cost phase (base whisper +
# self-hosted NLLB-200); override the build args for the public phase.
ARG STT_MODEL=base
ARG STT_COMPUTE_TYPE=int8
ARG NLLB_MODEL=facebook/nllb-200-distilled-600M
ENV STT_MODEL=${STT_MODEL} STT_COMPUTE_TYPE=${STT_COMPUTE_TYPE} \
    NLLB_MODEL=${NLLB_MODEL} TRANSLATION_PROVIDER=local_nllb \
    MAX_DURATION_SECONDS=120 MAX_SOURCE_BYTES=104857600
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${STT_MODEL}', device='cpu', compute_type='${STT_COMPUTE_TYPE}', download_root='/models')"
RUN python -c "from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; AutoTokenizer.from_pretrained('${NLLB_MODEL}', cache_dir='/models'); AutoModelForSeq2SeqLM.from_pretrained('${NLLB_MODEL}', cache_dir='/models')"

COPY app ./app

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "app.main"]
