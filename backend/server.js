/**
 * server.js
 * Warung Suara Express backend.
 *
 * Flow: voice note (audio file) -> forwarded to FastAPI /transcribe
 * (Whisper STT + rule-based/fuzzy extractor) -> structured
 * {item, qty, unit, action} -> applied to in-memory stock state.
 *
 * A manual/bypass endpoint is included so the Express layer can be
 * tested in isolation without needing the FastAPI service running.
 */

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const cors = require("cors");

const stockStore = require("./stockStore");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

// Store uploaded audio in memory; kita cuma stream langsung ke FastAPI, gak perlu simpen ke disk.
const upload = multer({ storage: multer.memoryStorage() });

// --- Health check ---
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "warung-suara-backend" });
});

/**
 * POST /voice-transaction
 * Terima file audio multipart/form-data di field "audio".
 * Forward ke FastAPI /transcribe, lalu apply hasil ekstraksi ke stock store.
 */
app.post("/voice-transaction", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded (expected field 'audio')" });
    }

    const form = new FormData();
    form.append("audio", req.file.buffer, {
      filename: req.file.originalname || "voice-note.wav",
      contentType: req.file.mimetype || "audio/wav",
    });

    const fastApiResponse = await axios.post(`${FASTAPI_URL}/transcribe`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const { transcript, extraction } = fastApiResponse.data;
    const { item, qty, unit, action } = extraction;

    let updated;
    try {
      updated = stockStore.applyTransaction({ item, qty, unit, action });
    } catch (err) {
      return res.status(422).json({
        error: err.message,
        transcript,
        extraction,
      });
    }

    res.json({
      transcript,
      extracted: { item, qty, unit, action },
      stock: updated,
    });
  } catch (err) {
    if (err.response) {
      return res.status(502).json({
        error: "FastAPI service error",
        detail: err.response.data,
      });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /voice-transaction/manual
 * Bypass Whisper/FastAPI — terima field hasil ekstraksi langsung sebagai JSON.
 * Body: { item, qty, unit, action }
 */
app.post("/voice-transaction/manual", (req, res) => {
  try {
    const { item, qty, unit, action } = req.body;
    const updated = stockStore.applyTransaction({ item, qty, unit, action });
    res.json({ extracted: { item, qty, unit, action }, stock: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /stock
 * Return full current stock state.
 */
app.get("/stock", (req, res) => {
  res.json(stockStore.getStock());
});

/**
 * GET /stock/low
 * Return item-item yang qty-nya <= threshold.
 */
app.get("/stock/low", (req, res) => {
  res.json(stockStore.getLowStock());
});

/**
 * POST /stock/threshold
 * Body: { item, threshold }
 */
app.post("/stock/threshold", (req, res) => {
  try {
    const { item, threshold } = req.body;
    const updated = stockStore.setThreshold(item, threshold);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /stock/reset
 * Clear seluruh stock state (buat demo).
 */
app.post("/stock/reset", (req, res) => {
  res.json(stockStore.resetStock());
});

app.listen(PORT, () => {
  console.log(`Warung Suara backend running on http://localhost:${PORT}`);
  console.log(`Forwarding voice transcription to FastAPI at ${FASTAPI_URL}`);
});