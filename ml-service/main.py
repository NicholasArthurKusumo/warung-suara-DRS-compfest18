"""
Warung Suara - FastAPI Model Service
=======================================
Endpoint tunggal (sesuai batasan MVP rulebook: synchronous request-response,
tanpa background job) yang menyatukan:
  1. STT: transkripsi audio -> teks, pakai model Whisper hasil fine-tuning
     (di-load dari Hugging Face Hub, bukan file lokal - lihat MODEL_REPO).
  2. Extraction: teks -> entri terstruktur {item, qty, unit, action},
     pakai extractor.py (rule-based + fuzzy fallback).

Dipanggil dari backend Express lewat HTTP POST (multipart/form-data berisi
file audio) ke endpoint /transcribe.

Jalankan lokal:
    uvicorn main:app --host 0.0.0.0 --port 8000

Install dependency:
    pip install fastapi uvicorn python-multipart transformers torch soundfile librosa
"""

import io
import logging
import subprocess

import numpy as np
import soundfile as sf
import librosa
import torch
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from transformers import WhisperForConditionalGeneration, WhisperProcessor

from extractor import extract

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("warung-suara-stt")

# =============================================================================
# KONFIGURASI
# =============================================================================

MODEL_REPO = "IcedB/warung-suara-whisper-id"   # model fine-tuned di HF Hub
TARGET_SAMPLE_RATE = 16000                      # sample rate yang dibutuhkan Whisper
LANGUAGE = "indonesian"
TASK = "transcribe"

# =============================================================================
# LOAD MODEL SEKALI SAAT SERVICE START (bukan per-request - penting untuk latency)
# =============================================================================

app = FastAPI(title="Warung Suara - STT & Extraction Service")

device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Loading model dari {MODEL_REPO} (device={device}) ...")

processor = WhisperProcessor.from_pretrained(MODEL_REPO)
model = WhisperForConditionalGeneration.from_pretrained(MODEL_REPO).to(device)
model.eval()

logger.info("Model siap.")


# =============================================================================
# HELPER: CONVERT AUDIO FORMAT APAPUN KE WAV PAKAI FFMPEG (FALLBACK)
# =============================================================================

def convert_to_wav_bytes(file_bytes: bytes) -> bytes:
    """
    Convert audio bytes format apapun (webm, ogg, mp3, dll dari browser MediaRecorder)
    ke WAV mono 16kHz pakai ffmpeg, sebagai fallback kalau soundfile gagal baca langsung.
    """
    process = subprocess.run(
        [
            "ffmpeg", "-i", "pipe:0",
            "-f", "wav",
            "-ar", str(TARGET_SAMPLE_RATE),
            "-ac", "1",
            "pipe:1",
        ],
        input=file_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.returncode != 0:
        raise ValueError(f"ffmpeg gagal convert audio: {process.stderr.decode(errors='ignore')[:300]}")
    return process.stdout


# =============================================================================
# HELPER: BACA & RESAMPLE AUDIO DARI UPLOAD
# =============================================================================

def load_audio_from_upload(file_bytes: bytes) -> np.ndarray:
    """
    Baca bytes audio (format apapun yang didukung soundfile: wav, flac, ogg;
    fallback ke ffmpeg untuk format lain seperti webm dari browser MediaRecorder)
    dan resample ke 16kHz mono - format yang dibutuhkan Whisper.
    """
    try:
        data, sr = sf.read(io.BytesIO(file_bytes))
    except Exception:
        # Format tidak didukung soundfile langsung (mis. webm dari browser MediaRecorder)
        # -> convert dulu ke wav pakai ffmpeg, baru dicoba baca lagi.
        try:
            wav_bytes = convert_to_wav_bytes(file_bytes)
            data, sr = sf.read(io.BytesIO(wav_bytes))
        except Exception as e:
            raise ValueError(f"Gagal membaca file audio: {e}")

    # kalau stereo, jadikan mono (rata-rata channel)
    if data.ndim > 1:
        data = data.mean(axis=1)

    if sr != TARGET_SAMPLE_RATE:
        data = librosa.resample(data.astype(np.float32), orig_sr=sr, target_sr=TARGET_SAMPLE_RATE)

    return data.astype(np.float32)


# =============================================================================
# HELPER: TRANSKRIPSI
# =============================================================================

def transcribe(audio_array: np.ndarray) -> str:
    inputs = processor(audio_array, sampling_rate=TARGET_SAMPLE_RATE, return_tensors="pt")
    input_features = inputs.input_features.to(device)

    with torch.no_grad():
        predicted_ids = model.generate(
            input_features,
            language=LANGUAGE,
            task=TASK,
            max_new_tokens=128,
        )

    text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
    return text.strip()


# =============================================================================
# ENDPOINTS
# =============================================================================

@app.get("/health")
def health():
    """Endpoint sederhana untuk cek service hidup (dipakai docker compose healthcheck)."""
    return {"status": "ok", "device": device, "model": MODEL_REPO}


@app.post("/transcribe")
async def transcribe_endpoint(audio: UploadFile = File(...)):
    """
    Terima file audio (voice note), kembalikan transkripsi + entri terstruktur.

    Response:
        {
          "transcript": "laku indomie lima bungkus",
          "extraction": {
            "item": "indomie", "qty": 5, "unit": "bungkus", "action": "keluar",
            "raw_text": "...", "method": "rule_based", "needs_review": false
          }
        }
    """
    if audio.content_type and not audio.content_type.startswith("audio"):
        logger.warning(f"Content-type tidak biasa: {audio.content_type}, tetap dicoba diproses.")

    file_bytes = await audio.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="File audio kosong.")

    try:
        audio_array = load_audio_from_upload(file_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if len(audio_array) == 0:
        raise HTTPException(status_code=400, detail="Audio tidak mengandung data suara.")

    try:
        transcript = transcribe(audio_array)
    except Exception as e:
        logger.exception("Gagal transkripsi")
        raise HTTPException(status_code=500, detail=f"Gagal transkripsi: {e}")

    extraction_result = extract(transcript)

    return JSONResponse({
        "transcript": transcript,
        "extraction": extraction_result,
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)