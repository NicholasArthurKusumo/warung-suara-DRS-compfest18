"""
Warung Suara - Batch Test Extractor Robustness
=================================================
Ambil N sampel random dari dataset (yang punya ground truth label di
manifest_clean.jsonl), kirim tiap audio ke endpoint /transcribe yang lagi
jalan (uvicorn di localhost:8000), lalu bandingkan hasil ekstraksi vs label
asli. Menghasilkan laporan akurasi per field + daftar kasus yang gagal.

PENTING: jalankan ini di terminal BARU, biarkan server (uvicorn main:app)
tetap jalan di terminal lain.

Install dependency:
    pip install requests
"""

import json
import random
from pathlib import Path

import requests

MANIFEST_CLEAN_PATH = Path("dataset_warung_suara/manifest_clean.jsonl")
MANIFEST_PATH = Path("dataset_warung_suara/manifest.jsonl")   # fallback kalau versi clean belum diunduh dari Drive
AUDIO_DIR = Path("dataset_warung_suara/audio")
API_URL = "http://localhost:8000/transcribe"
N_SAMPLES = 50   # jumlah sampel yang mau ditest, naikkan kalau mau lebih menyeluruh
SEED = 123


def load_manifest():
    path = MANIFEST_CLEAN_PATH if MANIFEST_CLEAN_PATH.exists() else MANIFEST_PATH
    print(f"Memuat manifest dari: {path}")
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def resolve_audio_path(raw_path: str) -> Path:
    parts = Path(raw_path).parts
    if "audio" in parts:
        idx = parts.index("audio")
        return AUDIO_DIR.parent.joinpath(*parts[idx:])
    return Path(raw_path)


def main():
    random.seed(SEED)
    rows = load_manifest()
    sample = random.sample(rows, min(N_SAMPLES, len(rows)))

    print(f"Testing {len(sample)} sampel random dari {len(rows)} total ...")

    correct_item = correct_qty = correct_unit = correct_action = 0
    all_correct = 0
    failed_requests = []
    mismatches = []
    needs_review_count = 0
    method_counts = {"rule_based": 0, "fuzzy_fallback": 0, "failed": 0}

    for i, row in enumerate(sample, 1):
        audio_path = resolve_audio_path(row["audio_path"])
        ground_truth = {
            "item": row["item"],
            "qty": row["qty"],
            "unit": row["unit"],
            "action": row["action"],
        }

        try:
            with open(audio_path, "rb") as f:
                resp = requests.post(API_URL, files={"audio": f}, timeout=60)
            resp.raise_for_status()
            result = resp.json()
        except FileNotFoundError:
            failed_requests.append((str(audio_path), "file tidak ditemukan"))
            continue
        except Exception as e:
            failed_requests.append((str(audio_path), str(e)))
            continue

        extraction = result["extraction"]
        method_counts[extraction["method"]] = method_counts.get(extraction["method"], 0) + 1
        if extraction["needs_review"]:
            needs_review_count += 1

        item_match = extraction["item"] == ground_truth["item"]
        qty_match = extraction["qty"] == ground_truth["qty"]
        unit_match = extraction["unit"] == ground_truth["unit"]
        action_match = extraction["action"] == ground_truth["action"]

        correct_item += item_match
        correct_qty += qty_match
        correct_unit += unit_match
        correct_action += action_match

        if item_match and qty_match and unit_match and action_match:
            all_correct += 1
        else:
            mismatches.append({
                "audio": audio_path.name,
                "transcript": result["transcript"],
                "ground_truth": ground_truth,
                "extracted": {k: extraction[k] for k in ["item", "qty", "unit", "action"]},
            })

        if i % 10 == 0:
            print(f"  {i}/{len(sample)} diproses ...")

    n = len(sample) - len(failed_requests)
    print("\n" + "=" * 60)
    print("HASIL BATCH TEST")
    print("=" * 60)
    print(f"Total ditest        : {len(sample)}")
    print(f"Request gagal       : {len(failed_requests)}")
    print(f"Berhasil diproses   : {n}")
    print()
    if n > 0:
        print(f"Akurasi item        : {correct_item}/{n} ({100*correct_item/n:.1f}%)")
        print(f"Akurasi qty         : {correct_qty}/{n} ({100*correct_qty/n:.1f}%)")
        print(f"Akurasi unit        : {correct_unit}/{n} ({100*correct_unit/n:.1f}%)")
        print(f"Akurasi action      : {correct_action}/{n} ({100*correct_action/n:.1f}%)")
        print(f"Akurasi SEMUA field : {all_correct}/{n} ({100*all_correct/n:.1f}%)")
        print()
        print(f"Method breakdown    : {method_counts}")
        print(f"needs_review=True   : {needs_review_count}")

    if failed_requests:
        print("\n--- Request gagal (maks 5 ditampilkan) ---")
        for path, err in failed_requests[:5]:
            print(f"  {path}: {err}")

    if mismatches:
        print(f"\n--- Contoh mismatch (maks 10 dari {len(mismatches)} total) ---")
        for m in mismatches[:10]:
            print(f"\n  Audio      : {m['audio']}")
            print(f"  Transcript : {m['transcript']}")
            print(f"  Expected   : {m['ground_truth']}")
            print(f"  Got        : {m['extracted']}")


if __name__ == "__main__":
    main()