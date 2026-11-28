FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir "huggingface_hub<1.0" requests faster-whisper==1.1.1 fastapi==0.115.6 uvicorn==0.34.0 python-multipart==0.0.20
# The Hebrew model (ivrit.ai, Apache-2.0) is baked into the image so a cold start does not download it.
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('ivrit-ai/whisper-large-v3-turbo-ct2', device='cpu', compute_type='int8')"
COPY server.py .
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}"]
