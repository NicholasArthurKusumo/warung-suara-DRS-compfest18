import { useState, useRef, useEffect, useCallback } from "react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

const colors = {
  bg: "#F3ECDD",
  card: "#FFFFFF",
  border: "#E8DFCC",
  text: "#3A322C",
  textMuted: "#8A7F6E",
  textFaint: "#B0A48F",
  accent: "#D6572B",
  accentDark: "#B23A24",
  dangerBg: "#FBE6E1",
  dangerText: "#B23A24",
  warningBg: "#FBF0DA",
  warningText: "#8A5B0B",
  avatarBg: "#F0DDC4",
  avatarText: "#8A4E1D",
};

function StockRow({ item }) {
  const isOut = item.qty <= 0;
  const isLow = !isOut && item.qty <= item.threshold;

  let badgeStyle = { fontSize: 13, color: colors.textMuted };
  let label = `${item.qty} ${item.unit}`;

  if (isOut) {
    badgeStyle = {
      fontSize: 13,
      background: colors.dangerBg,
      color: colors.dangerText,
      padding: "2px 8px",
      borderRadius: 8,
    };
  } else if (isLow) {
    badgeStyle = {
      fontSize: 13,
      background: colors.warningBg,
      color: colors.warningText,
      padding: "2px 8px",
      borderRadius: 8,
    };
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <span style={{ fontSize: 14, color: colors.text, textTransform: "capitalize" }}>
        {item.item}
      </span>
      <span style={badgeStyle}>{label}</span>
    </div>
  );
}

export default function App() {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("Tekan lalu ucapkan catatan");
  const [lastResult, setLastResult] = useState(null); // { transcript, extracted, stock, warning }
  const [stockList, setStockList] = useState([]);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const fetchStock = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/stock`);
      if (!res.ok) throw new Error("Gagal ambil data stok");
      const data = await res.json();
      setStockList(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendRecording(blob);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      setStatus("Merekam... tekan lagi untuk berhenti");
    } catch (err) {
      setError("Tidak bisa akses mikrofon: " + err.message);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      setStatus("Memproses...");
    }
  }

  async function sendRecording(blob) {
    try {
      const formData = new FormData();
      formData.append("audio", blob, "voice-note.webm");

      const res = await fetch(`${BACKEND_URL}/voice-transaction`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Gagal memproses suara");
      }

      setLastResult(data);
      await fetchStock();
      setStatus("Tekan lalu ucapkan catatan");
    } catch (err) {
      setError(err.message);
      setStatus("Tekan lalu ucapkan catatan");
    }
  }

  function handleMicClick() {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: colors.bg,
          borderRadius: 20,
          padding: "1.25rem",
          border: `1px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1rem",
          }}
        >
          <div>
            <p style={{ fontWeight: 500, fontSize: 16, margin: 0, color: colors.text }}>
              Warung Suara
            </p>
            <p style={{ fontSize: 12, color: colors.textMuted, margin: 0 }}>
              Catat transaksi lewat suara
            </p>
          </div>
        </div>

        <div
          style={{
            background: colors.card,
            borderRadius: 16,
            padding: "1.5rem 1rem",
            textAlign: "center",
            border: `1px solid ${colors.border}`,
            marginBottom: "1rem",
          }}
        >
          <button
            onClick={handleMicClick}
            aria-label={recording ? "Berhenti merekam" : "Rekam catatan suara"}
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: recording ? colors.accentDark : colors.accent,
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 0.75rem",
              cursor: "pointer",
            }}
          >
            <MicIcon />
          </button>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: 0 }}>{status}</p>
        </div>

        {error && (
          <div
            style={{
              background: colors.dangerBg,
              color: colors.dangerText,
              borderRadius: 12,
              padding: "0.75rem 1rem",
              fontSize: 13,
              marginBottom: "1rem",
            }}
          >
            {error}
          </div>
        )}

        {lastResult && (
          <div style={{ marginBottom: "1rem" }}>
            <div
              style={{
                background: colors.card,
                borderRadius: 12,
                padding: "0.75rem 1rem",
                border: `1px solid ${colors.border}`,
                marginBottom: 8,
              }}
            >
              <p style={{ fontSize: 11, color: colors.textFaint, margin: "0 0 4px" }}>
                Transkrip
              </p>
              <p style={{ fontSize: 14, margin: 0, color: colors.text }}>
                "{lastResult.transcript}"
              </p>
            </div>
            <div
              style={{
                background: colors.card,
                borderRadius: 12,
                padding: "0.75rem 1rem",
                border: `1px solid ${colors.border}`,
              }}
            >
              <p style={{ fontSize: 11, color: colors.textFaint, margin: "0 0 8px" }}>
                Tercatat
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 14,
                  color: colors.text,
                  textTransform: "capitalize",
                }}
              >
                <span>{lastResult.extracted.item}</span>
                <span
                  style={{
                    color: lastResult.extracted.action === "keluar" ? colors.dangerText : "#3B6D11",
                    fontWeight: 500,
                  }}
                >
                  {lastResult.extracted.action === "keluar" ? "-" : "+"}
                  {lastResult.extracted.qty} {lastResult.extracted.unit}
                </span>
              </div>
              {lastResult.stock.warning && (
                <p style={{ fontSize: 12, color: colors.textMuted, margin: "4px 0 0" }}>
                  {lastResult.stock.warning}
                </p>
              )}
            </div>
          </div>
        )}

        <div>
          <p style={{ fontSize: 12, color: colors.textMuted, margin: "0 0 8px" }}>
            Stok saat ini
          </p>
          <div style={{ borderTop: `1px solid ${colors.border}` }}>
            {stockList.length === 0 ? (
              <p style={{ fontSize: 13, color: colors.textFaint, padding: "12px 0" }}>
                Belum ada data stok. Rekam transaksi pertama kamu.
              </p>
            ) : (
              stockList.map((item) => <StockRow key={item.item} item={item} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}