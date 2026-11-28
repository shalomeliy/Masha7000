FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "huggingface_hub<1.0" requests sherpa-onnx soundfile numpy fastapi==0.115.6 uvicorn==0.34.0 python-multipart==0.0.20
# Hebrew streaming model (66M params, CC-BY-4.0, ivrit.ai / Yakov Kolani) baked into the image.
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('thewh1teagle/zipformer2-66m-streaming-he', allow_patterns=['sherpa-onnx/*'], local_dir='/app/model')"
COPY server.py .
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}"]
