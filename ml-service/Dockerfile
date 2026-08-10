# Dockerfile untuk ml-service (FastAPI + Whisper STT + extractor)
FROM python:3.11-slim

WORKDIR /app

# libsndfile1 dibutuhkan oleh soundfile/librosa untuk baca file audio
# ffmpeg dibutuhkan librosa untuk decode beberapa format audio
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Pakai CPU-only build torch (extra-index-url) biar image jauh lebih kecil
# daripada default build yang include CUDA (bisa >5GB kalau nggak di-pin ke CPU)
RUN pip install --no-cache-dir -r requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
