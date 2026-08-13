"""
Warung Suara - Extractor (Rule-Based + Fuzzy Fallback)
=========================================================
Tahap 3 dari pipeline: teks hasil transkripsi Whisper -> entri stok
terstruktur {item, qty, unit, action}.

ALUR EKSTRAKSI (untuk proposal - bagian Metodologi):
  1. Normalisasi teks (lowercase, strip whitespace berlebih).
  2. RULE-BASED (utama): cocokkan kata per kata terhadap kamus ITEM_VOCAB,
     QTY_VOCAB, ACTION_VOCAB via regex/exact match. Ini cepat dan akurat
     untuk kasus umum (item/angka/aksi terucap sesuai kamus).
  3. FUZZY FALLBACK: kalau exact match gagal (misal typo transkripsi Whisper
     seperti "gass" alih-alih "gas", atau variasi pengucapan yang tidak ada
     di kamus), coba cocokkan pakai fuzzy string matching (SequenceMatcher)
     dengan threshold similarity tertentu.
  4. FAILED: kalau baik rule-based maupun fuzzy tidak berhasil menemukan
     minimal item+qty, entri ditandai method="failed" dan needs_review=True
     - artinya butuh intervensi manual/tidak bisa diproses otomatis
     (misal input bukan transaksi sama sekali, seperti "halo test doang").

Kenapa kombinasi ini dipakai (bukan NLP murni / LLM):
  Domain transaksi warung itu terbatas dan terstruktur (vocab item/qty/unit
  cenderung tetap), jadi rule-based sudah menangkap mayoritas kasus dengan
  akurat & murah secara komputasi. Fuzzy fallback menutup celah error
  transkripsi Whisper (yang realistis terjadi, terutama untuk kata yang
  jarang/nama produk spesifik) tanpa perlu model NLP tambahan yang berat.

Install dependency:
    (tidak ada dependency eksternal - hanya modul Python bawaan)
"""

import re
from difflib import SequenceMatcher
from dataclasses import dataclass, asdict
from typing import Optional


# =============================================================================
# VOCAB (konsisten dengan generate_dataset_v2.py - sumber ground truth yang sama)
# =============================================================================

ITEM_UNIT_MAP = {
    "indomie":           "bungkus",
    "indomi":            "bungkus",   # varian ejaan spoken (lihat ITEM_SPOKEN_OVERRIDES di generate_dataset_v2.py)
    "telor":             "kg",
    "telur":             "kg",
    "gula":              "kg",
    "beras":             "kg",
    "minyak goreng":     "liter",
    "kecap":             "botol",
    "sabun mandi":       "batang",
    "rokok":             "bungkus",
    "aqua gelas":        "dus",
    "gas elpiji":        "tabung",
    "kopi sachet":       "renceng",
    "susu kental manis": "kaleng",
    "mie sedaap":        "bungkus",
    "teh celup":         "kotak",
    "sabun cuci piring": "botol",
    "garam":             "bungkus",
    "tepung terigu":     "kg",
    "saos sambal":       "botol",
    "bumbu masak":       "sachet",
    "korek api":         "kotak",
    "tissue":            "pack",
    "air mineral botol": "dus",
    "roti tawar":        "bungkus",
    "margarin":          "bungkus",
    "deterjen":          "bungkus",
}
# urutkan dari nama terpanjang -> match multi-kata lebih dulu sebelum kata tunggal
ITEM_NAMES_SORTED = sorted(ITEM_UNIT_MAP.keys(), key=len, reverse=True)

# item "kanonik" yang dikembalikan sebagai label (indomi -> indomie, telur -> telor, dst)
ITEM_CANONICAL = {
    "indomi": "indomie",
    "telur": "telor",
}

QTY_WORD_TO_NUM = {
    "satu": 1, "se": 1, "dua": 2, "tiga": 3, "empat": 4, "lima": 5,
    "enam": 6, "tujuh": 7, "delapan": 8, "sembilan": 9, "sepuluh": 10,
    "sebelas": 11, "dua belas": 12, "tiga belas": 13, "lima belas": 15,
    "dua puluh": 20, "dua puluh lima": 25, "lima puluh": 50, "seratus": 100,
}

ACTION_WORDS = {
    "keluar": ["laku", "kejual", "terjual", "abis dibeli", "keluar", "diambil pembeli"],
    "masuk":  ["masuk", "stok masuk", "baru dateng", "restock", "nambah stok", "kiriman dateng"],
}
# balik jadi lookup: kata -> tipe aksi, urutkan frasa lebih panjang duluan
ACTION_WORD_TO_TYPE = {}
for action_type, words in ACTION_WORDS.items():
    for w in words:
        ACTION_WORD_TO_TYPE[w] = action_type
ACTION_WORDS_SORTED = sorted(ACTION_WORD_TO_TYPE.keys(), key=len, reverse=True)

FUZZY_THRESHOLD = 0.75   # similarity minimum buat fuzzy fallback diterima


# =============================================================================
# STRUKTUR OUTPUT
# =============================================================================

@dataclass
class ExtractionResult:
    item: Optional[str]
    qty: Optional[int]
    unit: Optional[str]
    action: Optional[str]
    raw_text: str
    method: str            # "rule_based" | "fuzzy_fallback" | "failed"
    needs_review: bool

    def to_dict(self):
        return asdict(self)


# =============================================================================
# HELPER: FUZZY MATCH
# =============================================================================

def _fuzzy_best_match(token: str, candidates, threshold: float = FUZZY_THRESHOLD):
    """Cari kandidat dengan similarity tertinggi terhadap token, di atas threshold."""
    best_score, best_candidate = 0.0, None
    for cand in candidates:
        score = SequenceMatcher(None, token, cand).ratio()
        if score > best_score:
            best_score, best_candidate = score, cand
    if best_score >= threshold:
        return best_candidate, best_score
        
    # FALLBACK: Substring Match (untuk mengatasi user yang menyingkat barang kustom)
    # Contoh: token "odol" dicari di dalam candidate "odol pepsodent"
    for cand in candidates:
        if len(token) > 2 and (token in cand or cand in token):
            return cand, 0.70 # Beri skor sebagai partial match
            
    return None, best_score


# =============================================================================
# TAHAP-TAHAP EKSTRAKSI
# =============================================================================

def _extract_item(text: str, item_names_sorted, item_unit_map):
    """Coba exact match dulu (multi-kata, terpanjang duluan), lalu fuzzy per token/window."""
    for name in item_names_sorted:
        if re.search(rf"\b{re.escape(name)}\b", text):
            canonical = ITEM_CANONICAL.get(name, name)
            return canonical, item_unit_map[name], "rule_based"

    # fuzzy fallback: coba tiap token tunggal & bigram terhadap daftar nama item
    tokens = text.split()
    windows = list(tokens)
    windows += [f"{tokens[i]} {tokens[i+1]}" for i in range(len(tokens) - 1)]
    for window in windows:
        match, score = _fuzzy_best_match(window, item_names_sorted)
        if match:
            canonical = ITEM_CANONICAL.get(match, match)
            return canonical, item_unit_map[match], "fuzzy_fallback"

    return None, None, "failed"


def _extract_qty(text: str):
    """Cari angka digit dulu (paling reliable), lalu kata bilangan."""
    digit_match = re.search(r"\b(\d+)\b", text)
    if digit_match:
        return int(digit_match.group(1)), "rule_based"

    # coba frasa qty terpanjang dulu (mis. "dua puluh lima" sebelum "dua puluh")
    for word in sorted(QTY_WORD_TO_NUM.keys(), key=len, reverse=True):
        if re.search(rf"\b{re.escape(word)}\b", text):
            return QTY_WORD_TO_NUM[word], "rule_based"

    return None, "failed"


def _extract_action(text: str):
    for word in ACTION_WORDS_SORTED:
        if re.search(rf"\b{re.escape(word)}\b", text):
            return ACTION_WORD_TO_TYPE[word], "rule_based"

    # fuzzy fallback per token terhadap kata aksi
    tokens = text.split()
    for token in tokens:
        match, score = _fuzzy_best_match(token, ACTION_WORDS_SORTED)
        if match:
            return ACTION_WORD_TO_TYPE[match], "fuzzy_fallback"

    return None, "failed"


# =============================================================================
# ENTRY POINT
# =============================================================================

def extract(raw_text: str, custom_items: list = None) -> dict:
    """
    Ekstrak entri terstruktur dari teks transkripsi Whisper.
    Menerima custom_items list dari database (berisi dict {name, unit}).
    """
    text = raw_text.strip().lower()
    text = re.sub(r"\s+", " ", text)

    current_item_unit_map = ITEM_UNIT_MAP.copy()
    if custom_items:
        for ci in custom_items:
            name = ci.get("name", "").strip().lower()
            if name:
                current_item_unit_map[name] = ci.get("unit", "pcs")
    
    current_item_names_sorted = sorted(current_item_unit_map.keys(), key=len, reverse=True)

    item, unit, item_method = _extract_item(text, current_item_names_sorted, current_item_unit_map)
    qty, qty_method = _extract_qty(text)
    action, action_method = _extract_action(text)

    methods_used = [item_method, qty_method, action_method]

    if item is None or qty is None:
        result = ExtractionResult(
            item=None, qty=None, unit=None, action=None,
            raw_text=raw_text, method="failed", needs_review=True,
        )
    elif "fuzzy_fallback" in methods_used:
        result = ExtractionResult(
            item=item, qty=qty, unit=unit, action=action,
            raw_text=raw_text, method="fuzzy_fallback", needs_review=False,
        )
    else:
        result = ExtractionResult(
            item=item, qty=qty, unit=unit, action=action,
            raw_text=raw_text, method="rule_based", needs_review=False,
        )

    return result.to_dict()


# =============================================================================
# QUICK TEST
# =============================================================================

if __name__ == "__main__":
    test_cases = [
        "laku indomi lima bungkus",
        "telor masuk 10 kg",
        "eh kecap kejual 2 botol",
        "gass elpiji abis dibeli satu tabung",
        "halo test doang",
    ]
    for t in test_cases:
        print(t, "->", extract(t))