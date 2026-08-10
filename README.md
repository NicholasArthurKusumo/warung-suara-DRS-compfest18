# Warung Suara

**AI-powered voice bookkeeping untuk warung & UMKM Indonesia.**

Warung Suara memungkinkan pemilik warung mencatat transaksi cukup dengan mengucapkan kalimat natural: misalnya *"laku indomie satu bungkus"*: dan sistem otomatis mengubahnya menjadi entri stok terstruktur, lengkap dengan peringatan stok menipis.

Dikembangkan oleh tim **DRS** untuk **COMPFEST 18 AIC** (kategori Smart Commerce).

---

## Kenapa Warung Suara?

Banyak pemilik warung kecil di Indonesia mencatat transaksi secara manual di buku, atau bahkan tidak mencatat sama sekali karena repot. Warung Suara menghilangkan friksi itu: tidak perlu mengetik, tidak perlu buka aplikasi rumit, cukup rekam suara seperti mengirim voice note.

## Fitur Utama

- 🎙️ **Rekam suara langsung dari browser**: tanpa perlu instal aplikasi tambahan
- 🧠 **Speech-to-text Bahasa Indonesia**: model Whisper yang di-*fine-tune* khusus untuk konteks transaksi warung
- 📦 **Ekstraksi transaksi otomatis**: dari kalimat natural menjadi `{item, qty, unit, aksi}`
- ⚠️ **Peringatan stok menipis**: threshold dapat disesuaikan per item
- 🐳 **Fully containerized**: satu perintah `docker compose up` untuk menjalankan seluruh sistem

---

## Arsitektur

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────────────┐
│   Frontend   │      │  Backend (Express) │      │  ML Service (FastAPI) │
│  React + Vite │ ───▶ │  Stock state +     │ ───▶ │  Whisper STT +        │
│  + Tailwind  │◀──── │  transaction logic │◀──── │  rule-based extractor │
└─────────────┘      └──────────────────┘      └─────────────────────┘
   :5173                    :3000                        :8000
```

**Alur voice transaction:**
1. Pengguna merekam voice note lewat browser (`MediaRecorder` API)
2. Audio dikirim ke backend Express (`/voice-transaction`)
3. Backend meneruskan audio ke ML service FastAPI (`/transcribe`)
4. FastAPI: audio → transkripsi (Whisper) → ekstraksi terstruktur (rule-based + fuzzy fallback)
5. Backend menerapkan hasil ekstraksi ke state stok in-memory
6. Frontend menampilkan transkrip, hasil ekstraksi, dan stok terbaru

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| **Frontend** | React 18, Vite, Tailwind CSS v4 |
| **Backend** | Express (Node.js 20), Multer, Axios |
| **ML Service** | FastAPI (Python 3.11), Whisper (fine-tuned), Transformers, Librosa |
| **STT Model** | [`IcedB/warung-suara-whisper-id`](https://huggingface.co/IcedB/warung-suara-whisper-id): fine-tuned dari `cahya/whisper-small-id` |
| **Containerization** | Docker, Docker Compose |

---

## Struktur Folder

```
warung-suara/
├── docker-compose.yml
├── backend/                 # Express API + stock state management
│   ├── server.js
│   ├── stockStore.js
│   ├── package.json
│   └── Dockerfile
├── ml-service/               # FastAPI STT + extraction service
│   ├── main.py
│   ├── extractor.py
│   ├── batchTest.py
│   ├── generateDataset.ipynb
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/                 # React voice-recording UI
    ├── src/
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── index.css
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## Menjalankan Proyek

### Opsi A: Docker Compose (direkomendasikan)

Menjalankan seluruh backend + ML service dalam satu perintah:

```bash
docker compose up --build
```

Setelah semua container siap (ditandai log `Model siap.` dan `backend running on...`), jalankan frontend secara terpisah:

```bash
cd frontend
npm install
npm run dev
```

Buka `http://localhost:5173` di browser.

### Opsi B: Manual (tanpa Docker)

**1. ML Service**
```bash
cd ml-service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**2. Backend**
```bash
cd backend
npm install
node server.js
```

**3. Frontend**
```bash
cd frontend
npm install
npm run dev
```

---

## API Endpoints

### ML Service (`:8000`)

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/health` | Cek status service & device (CPU/GPU) |
| `POST` | `/transcribe` | Terima file audio, kembalikan transkrip + hasil ekstraksi |

### Backend (`:3000`)

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/voice-transaction` | Terima audio (`multipart/form-data`, field `audio`), proses via ML service, update stok |
| `POST` | `/voice-transaction/manual` | Bypass STT: terima `{item, qty, unit, action}` langsung sebagai JSON (untuk testing) |
| `GET` | `/stock` | Ambil seluruh state stok saat ini |
| `GET` | `/stock/low` | Ambil item yang berada di/bawah threshold |
| `POST` | `/stock/threshold` | Set threshold custom per item: body: `{item, threshold}` |
| `POST` | `/stock/reset` | Reset seluruh state stok (untuk demo) |

**Contoh response `/voice-transaction`:**
```json
{
  "transcript": "laku indomie satu bungkus",
  "extracted": {
    "item": "indomie",
    "qty": 1,
    "unit": "bungkus",
    "action": "keluar"
  },
  "stock": {
    "item": "indomie",
    "qty": 0,
    "unit": "bungkus",
    "threshold": 5,
    "warning": "Stok tidak cukup, qty dikurangi sampai 0"
  }
}
```

---

## Model Machine Learning

Model STT (`IcedB/warung-suara-whisper-id`) di-*fine-tune* dari base model `cahya/whisper-small-id` menggunakan dataset sintetik 5.600 sampel suara Bahasa Indonesia bertema transaksi warung (dihasilkan dengan `facebook/mms-tts-ind`, dengan augmentasi speed & noise).

- **WER (Word Error Rate) pada eval set:** 16.15%
- **Akurasi ekstraksi (batch test 50 sampel):** 100% pada seluruh field (item/qty/unit/aksi)

> Model dan dataset besar **tidak** disertakan dalam repo ini (melebihi batas GitHub 100MB). Model dimuat otomatis dari Hugging Face Hub saat `ml-service` pertama kali dijalankan. Dataset dapat digenerate ulang lewat `ml-service/generateDataset.ipynb`.

---

## Tim

**DRS**: COMPFEST 18 AIC, kategori Smart Commerce

---

## Lisensi

Proyek ini dikembangkan untuk keperluan kompetisi COMPFEST 18 AIC.