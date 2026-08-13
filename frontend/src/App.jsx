import { useState, useRef, useEffect, useCallback } from "react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

// A neat little spark icon for the AI
const SparkIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l1.6 5.2 5.4 1.6-5.4 1.6L12 15.6l-1.6-5.2-5.4-1.6 5.4-1.6L12 2zm0 13.6l1.2 4 4 1.2-4 1.2-1.2 4-1.2-4-4-1.2 4-1.2 1.2-4z" />
  </svg>
);

function StockRow({ item, onDelete }) {
  const isOut = item.qty <= 0;
  const isLow = !isOut && item.qty <= item.threshold;

  let lineFill = "bg-gray-200";
  if (isOut) lineFill = "bg-red-400";
  else if (isLow) lineFill = "bg-yellow-400";
  else lineFill = "bg-[#B4F090]";

  // Fake a little barcode/chart look like in the reference
  const renderMiniChart = () => {
    return (
      <div className="flex items-end gap-[2px] h-6 opacity-60">
        {[...Array(6)].map((_, i) => (
          <div key={i} className={`w-1 rounded-full ${lineFill}`} style={{ height: `${Math.max(20, Math.random() * 100)}%` }}></div>
        ))}
      </div>
    );
  };

  return (
    <div className="glass-panel p-4 rounded-3xl flex flex-col justify-between mb-4 interactive hover:scale-[1.02] relative group">
      <button 
        onClick={() => onDelete(item.item)}
        className="absolute top-3 right-3 p-1.5 bg-gray-100/50 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10"
        title="Hapus Barang"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
      </button>
      <div>
        {renderMiniChart()}
        <h4 className="font-semibold text-lg mt-3 capitalize">{item.item}</h4>
        <p className="text-sm font-medium text-gray-500">
          Sisa: {item.qty} {item.unit}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("Tekan mic untuk bicara...");
  const [lastResult, setLastResult] = useState(null);
  const [stockList, setStockList] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState(null);
  
  const [showHistory, setShowHistory] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [customPrompts, setCustomPrompts] = useState(() => {
    const saved = localStorage.getItem('ws_quick_prompts');
    let parsed = saved ? JSON.parse(saved) : [];
    if (parsed.length === 0) {
      parsed = [
        { t: "Catat Aqua keluar", item: "Aqua", qty: 1, unit: "botol", action: "keluar", icon: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" },
        { t: "Tambah stok gula", item: "gula", qty: 5, unit: "kg", action: "masuk", icon: "M12 4v16m8-8H4" },
        { t: "Jual Indomie", item: "indomie", qty: 1, unit: "bungkus", action: "keluar", icon: "M13 10V3L4 14h7v7l9-11h-7z" }
      ];
    } else if (parsed.length === 2) {
      parsed.push({ t: "Jual Indomie", item: "indomie", qty: 1, unit: "bungkus", action: "keluar", icon: "M13 10V3L4 14h7v7l9-11h-7z" });
    }
    return parsed;
  });
  const [newItemName, setNewItemName] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("pcs");
  const [isAddingItem, setIsAddingItem] = useState(false);
  
  // Chat History State
  const [chatLog, setChatLog] = useState([
    { role: 'ai', text: "Hai Juragan! Ada yang bisa saya bantu catat hari ini? (Misal: 'Barang masuk gula 5 kg')" }
  ]);
  const chatEndRef = useRef(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const fetchStock = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/stock`);
      if (!res.ok) throw new Error("Gagal mengambil data stok");
      const data = await res.json();
      setStockList(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/transactions`);
      if (!res.ok) throw new Error("Gagal mengambil data riwayat");
      const data = await res.json();
      setTransactions(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchStock();
    fetchTransactions();
  }, [fetchStock, fetchTransactions]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog]);

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
      setStatus("Mendengarkan...");
    } catch (err) {
      setError("Izin mikrofon diperlukan: " + err.message);
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

      if (data.transcript) {
        setLastResult(data);
        // Add to chat log
        const newLog = [...chatLog, { role: 'user', text: data.transcript }];
        
        let aiReply = "";
        if (data.extracted) {
          aiReply = `Sip, dicatat! ${data.extracted.action === 'keluar' ? 'Keluar' : 'Masuk'} ${data.extracted.item} sebanyak ${data.extracted.qty} ${data.extracted.unit}.`;
          if (data.stock?.warning) {
            aiReply += `\n⚠️ Peringatan: ${data.stock.warning}`;
          }
        } else {
          aiReply = "Maaf, saya tidak menangkap maksud transaksinya. Bisa diulangi?";
        }
        
        newLog.push({ role: 'ai', text: aiReply });
        setChatLog(newLog);
      }
      
      if (!res.ok) {
        throw new Error(data.error || "Gagal memproses suara.");
      }
      
      await fetchStock();
      await fetchTransactions();
      setStatus("Tekan mic untuk bicara...");
    } catch (err) {
      setError(err.message);
      setStatus("Tekan mic untuk bicara...");
    }
  }

  function handleMicClick() {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function savePromptSettings(newPrompts) {
    setCustomPrompts(newPrompts);
    localStorage.setItem('ws_quick_prompts', JSON.stringify(newPrompts));
    setShowPromptSettings(false);
  }

  async function sendManualTransaction(item, qty, unit, action) {
    const normalizedItem = item.trim().toLowerCase();
    const text = action === 'keluar' ? `Catat ${normalizedItem} keluar` : `Tambah stok ${normalizedItem}`;
    setChatLog(prev => [...prev, { role: 'user', text }]);
    setStatus("Memproses...");
    try {
      const res = await fetch(`${BACKEND_URL}/voice-transaction/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: normalizedItem, qty, unit, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mencatat");
      
      setChatLog(prev => [...prev, { role: 'ai', text: `Sip, dicatat! ${action === 'keluar' ? 'Keluar' : 'Masuk'} ${normalizedItem} sebanyak ${qty} ${unit}.` }]);
      await fetchStock();
      await fetchTransactions();
    } catch (err) {
      setError(err.message);
      setChatLog(prev => [...prev, { role: 'ai', text: "Maaf, terjadi kesalahan saat mencatat." }]);
    }
    setStatus("Tekan mic untuk bicara...");
  }

  async function handleAddCustomItem(e) {
    e.preventDefault();
    if (!newItemName.trim()) return;
    setIsAddingItem(true);
    setError(null);

    const normalizedItem = newItemName.trim().toLowerCase();

    try {
      const res = await fetch(`${BACKEND_URL}/stock/item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: normalizedItem,
          unit: newItemUnit || "pcs",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan");

      setNewItemName("");
      setNewItemUnit("pcs");
      setShowAddForm(false);
      await fetchStock();
      
      setChatLog(prev => [...prev, { role: 'ai', text: `Barang kustom '${data.item}' berhasil ditambahkan ke inventaris!` }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsAddingItem(false);
    }
  }

  async function handleDeleteItem(itemName) {
    if (!confirm(`Yakin ingin menghapus '${itemName}' dari inventaris?`)) return;
    try {
      const res = await fetch(`${BACKEND_URL}/stock/item/${encodeURIComponent(itemName)}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Gagal menghapus barang");
      }
      
      setChatLog(prev => [...prev, { role: 'ai', text: `Barang '${itemName}' telah dihapus dari inventaris.` }]);
      await fetchStock();
    } catch (err) {
      setError(err.message);
    }
  }

  const renderBottomBar = (isMobileLayout) => (
    <div className={isMobileLayout ? 
      "fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-2xl p-4 pb-6 border-t border-white/60 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] rounded-t-[32px] block lg:hidden" : 
      "absolute bottom-6 left-6 right-6 hidden lg:block"
    }>
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-white/60 backdrop-blur-md border border-white p-2 pl-6 pr-2 rounded-[28px] shadow-sm flex justify-between items-center">
          <span className="text-sm font-medium text-gray-400">
            {status}
          </span>
          
          <button
            onClick={handleMicClick}
            className={`w-12 h-12 rounded-[20px] flex items-center justify-center interactive shadow-md transition-colors ${
              recording ? 'bg-red-400 text-white animate-pulse' : 'bg-[#B4F090] text-[#1E1E1E]'
            }`}
          >
            {recording ? (
               <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                 <rect x="6" y="4" width="4" height="16" rx="1"></rect>
                 <rect x="14" y="4" width="4" height="16" rx="1"></rect>
               </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        </div>
      </div>
      
      {/* Quick Actions below input */}
      <div className="flex justify-between items-end mt-4 px-2">
         <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Saran Aksi</span>
         <button onClick={() => setShowPromptSettings(true)} className="text-gray-400 hover:text-gray-700 interactive p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
         </button>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-2">
         {customPrompts.slice(0, 3).map((p, i) => (
           <div key={i} onClick={() => sendManualTransaction(p.item, p.qty, p.unit, p.action)} className="bg-white/50 backdrop-blur border border-white p-3 rounded-2xl flex flex-col justify-between h-20 interactive cursor-pointer hover:bg-white/70">
             <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={p.icon || "M13 10V3L4 14h7v7l9-11h-7z"}/></svg>
             <span className="text-[11px] font-semibold text-gray-700 leading-tight">{p.t}</span>
           </div>
         ))}
      </div>
    </div>
  );

  const today = new Date().setHours(0,0,0,0);
  const todayTrx = transactions.filter(t => new Date(t.timestamp).setHours(0,0,0,0) === today);
  const totalTrxToday = todayTrx.length;
  
  return (
    <div className="min-h-screen py-8 px-4 md:px-8 font-sans selection:bg-[#B4F090] selection:text-[#1E1E1E]">
      
      {/* Global Error */}
      {error && (
        <div className="max-w-6xl mx-auto mb-6 p-4 rounded-3xl bg-red-100/80 backdrop-blur border border-red-200 text-red-700 text-center font-medium shadow-sm z-50 relative">
          Peringatan: {error}
        </div>
      )}

      {/* Settings Modal */}
      {showPromptSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-md p-6 rounded-[32px] shadow-xl border border-white relative bg-white/70">
            <h3 className="text-xl font-bold mb-4">Atur Saran Aksi</h3>
            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 chat-scroll">
              {[0, 1, 2].map(index => (
                <div key={index} className="p-4 bg-white/60 rounded-2xl space-y-3">
                  <h4 className="text-xs font-bold text-gray-500 uppercase">Tombol {index + 1}</h4>
                  <input
                    type="text"
                    value={customPrompts[index]?.t || ""}
                    onChange={e => {
                      const newPrompts = [...customPrompts];
                      newPrompts[index].t = e.target.value;
                      setCustomPrompts(newPrompts);
                    }}
                    placeholder="Label Teks (Misal: Jual Rokok)"
                    className="w-full bg-white/80 px-3 py-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#B4F090]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={customPrompts[index]?.item || ""}
                      onChange={e => {
                        const newPrompts = [...customPrompts];
                        newPrompts[index].item = e.target.value;
                        const sel = stockList.find(s => s.item === e.target.value);
                        if(sel) newPrompts[index].unit = sel.unit;
                        setCustomPrompts(newPrompts);
                      }}
                      className="bg-white/80 px-3 py-2 rounded-xl text-sm outline-none"
                    >
                      <option value="">Pilih Barang...</option>
                      {stockList.map(s => <option key={s.item} value={s.item}>{s.item}</option>)}
                    </select>
                    <select
                      value={customPrompts[index]?.action || "keluar"}
                      onChange={e => {
                        const newPrompts = [...customPrompts];
                        newPrompts[index].action = e.target.value;
                        setCustomPrompts(newPrompts);
                      }}
                      className="bg-white/80 px-3 py-2 rounded-xl text-sm outline-none"
                    >
                      <option value="keluar">Keluar (Jual)</option>
                      <option value="masuk">Masuk (Stok)</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    value={customPrompts[index]?.qty || 1}
                    onChange={e => {
                      const newPrompts = [...customPrompts];
                      newPrompts[index].qty = parseInt(e.target.value) || 1;
                      setCustomPrompts(newPrompts);
                    }}
                    placeholder="Jumlah (Qty)"
                    className="w-full bg-white/80 px-3 py-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#B4F090]"
                  />
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowPromptSettings(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200">Batal</button>
              <button onClick={() => savePromptSettings(customPrompts)} className="px-5 py-2.5 rounded-xl font-bold text-[#1E1E1E] bg-[#B4F090] hover:bg-[#a1d97f]">Simpan</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 lg:h-[calc(100vh-64px)]">
        
        {/* LEFT COLUMN: The Dashboard App (like left reference image) */}
        <div className="flex flex-col h-full overflow-y-auto pb-8 chat-scroll pr-2">
          
          {/* Header */}
          <header className="flex justify-between items-center mb-8 shrink-0 relative">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-200 shadow-inner">
                <img src="https://api.dicebear.com/7.x/notionists/svg?seed=Juragan&backgroundColor=B4F090" alt="Avatar" className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-gray-500">Welcome Back</p>
                <h1 className="text-xl font-bold">Juragan</h1>
              </div>
            </div>
            
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="w-12 h-12 rounded-[20px] bg-white shadow-sm flex items-center justify-center interactive relative"
              >
                {stockList.filter(s => s.qty <= s.threshold).length > 0 && (
                  <span className="absolute top-3 right-3.5 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                )}
                {stockList.filter(s => s.qty <= s.threshold).length > 0 && (
                  <span className="absolute top-3 right-3.5 w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
                )}
                <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
              </button>

              {/* Notification Dropdown */}
              {showNotifications && (
                <div className="absolute right-0 mt-3 w-80 bg-white/90 backdrop-blur-xl border border-white shadow-2xl rounded-3xl overflow-hidden z-[100]">
                  <div className="p-4 bg-gray-50/50 border-b border-gray-100 flex justify-between items-center">
                    <h4 className="font-bold text-gray-800">Notifikasi</h4>
                    <span className="text-xs font-semibold bg-[#B4F090] text-[#1E1E1E] px-2 py-1 rounded-lg">Real-time</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto p-2">
                    {stockList.filter(s => s.qty <= s.threshold).length > 0 ? (
                      stockList.filter(s => s.qty <= s.threshold).map(s => (
                        <div key={s.item} className="flex gap-3 p-3 hover:bg-gray-50/50 rounded-2xl cursor-pointer transition-colors">
                          <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">Stok {s.item} Menipis</p>
                            <p className="text-[11px] font-medium text-gray-500 mt-0.5">Tersisa {s.qty} {s.unit}. Segera restock!</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-6 text-center">
                        <div className="w-12 h-12 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                        </div>
                        <p className="text-sm font-semibold text-gray-800">Semua Terpantau Aman</p>
                        <p className="text-xs font-medium text-gray-500 mt-1">Belum ada peringatan stok baru.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </header>

          {/* Main "Lumen Balance" Card */}
          <div className="glass-panel p-6 rounded-[32px] mb-8 relative overflow-hidden shrink-0">
            <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/40 rounded-full blur-3xl"></div>
            
            <div className="flex justify-between items-start mb-6 relative z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[#B4F090] flex items-center justify-center shadow-lg shadow-[#B4F090]/40">
                  <SparkIcon className="w-6 h-6 text-[#1E1E1E]" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-gray-800">Aktivitas Hari Ini</h2>
                  <p className="text-[13px] text-gray-500">Transaksi Total</p>
                </div>
              </div>
              <div className="px-4 py-2 rounded-full glass-input text-xs font-semibold">
                Utama
              </div>
            </div>

            <div className="text-center my-8 relative z-10">
              <div className="flex items-start justify-center gap-2">
                <span className="text-2xl font-medium text-gray-400 mt-2">Σ</span>
                <span className="text-6xl font-bold tracking-tight">{totalTrxToday}</span>
              </div>
            </div>

            <div className="glass-input mx-[-8px] mb-[-8px] p-4 rounded-3xl flex justify-between items-center z-10 relative">
              <span className="text-sm font-semibold">+{transactions.length} dalam bulan ini</span>
              <div className="flex -space-x-2">
                <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs font-bold">+</div>
              </div>
            </div>
          </div>

          {/* Icon Buttons (Send, Add, Bills, Stats equivalent) */}
          <div className="flex justify-between gap-4 mb-10 shrink-0">
            {[
              { icon: 'M4 6h16M4 12h16m-7 6h7', label: 'Semua', action: () => { setShowHistory(false); setShowAddForm(false); setShowStats(false); } },
              { icon: 'M12 4v16m8-8H4', label: 'Tambah', action: () => { setShowAddForm(true); setShowHistory(false); setShowStats(false); } },
              { icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2', label: 'Riwayat', action: () => { setShowHistory(true); setShowAddForm(false); setShowStats(false); } },
              { icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z', label: 'Statistik', action: () => { setShowStats(true); setShowHistory(false); setShowAddForm(false); } },
            ].map((btn, i) => (
              <div key={i} className="flex flex-col items-center gap-3">
                <button onClick={btn.action} className="w-16 h-16 rounded-[24px] bg-white shadow-sm flex items-center justify-center interactive hover:bg-gray-50">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={btn.icon}/></svg>
                </button>
                <span className="text-[13px] font-medium text-gray-600">{btn.label}</span>
              </div>
            ))}
          </div>

          {/* Lists Area (Spaces / Recent Activity) */}
          <div className="mb-4 flex justify-between items-end shrink-0">
            <h3 className="text-xl font-bold">
              {showStats ? "Laporan Statistik" : showAddForm ? "Tambah Barang" : showHistory ? "Riwayat Terbaru" : "Inventaris (Spaces)"}
            </h3>
            <span className="text-xs font-semibold text-gray-400">See all</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {showStats ? (
              <div className="col-span-2 space-y-4">
                 
                 <div className="grid grid-cols-2 gap-4">
                    <div className="glass-panel p-5 rounded-3xl flex flex-col justify-between">
                       <div className="w-10 h-10 rounded-2xl bg-white/70 flex items-center justify-center shadow-sm mb-4">
                          <svg className="w-5 h-5 text-[#10B981]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
                       </div>
                       <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Barang Masuk</p>
                       <h4 className="text-3xl font-bold text-[#1E1E1E] mt-1">{transactions.filter(t => t.action === 'masuk' && new Date(t.timestamp).setHours(0,0,0,0) === today).length} <span className="text-sm font-medium text-gray-400">trx</span></h4>
                    </div>
                    
                    <div className="glass-panel p-5 rounded-3xl flex flex-col justify-between">
                       <div className="w-10 h-10 rounded-2xl bg-white/70 flex items-center justify-center shadow-sm mb-4">
                          <svg className="w-5 h-5 text-[#EF4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>
                       </div>
                       <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Barang Keluar</p>
                       <h4 className="text-3xl font-bold text-[#1E1E1E] mt-1">{transactions.filter(t => t.action === 'keluar' && new Date(t.timestamp).setHours(0,0,0,0) === today).length} <span className="text-sm font-medium text-gray-400">trx</span></h4>
                    </div>
                 </div>

                 <div className="glass-panel p-6 rounded-3xl">
                    <div className="flex items-center gap-2 mb-5">
                       <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse shadow-[0_0_8px_rgba(248,113,113,0.8)]"></div>
                       <h4 className="font-bold text-sm uppercase tracking-widest text-gray-800">Perlu Restock</h4>
                    </div>
                    
                    <div className="space-y-2">
                       {stockList.filter(s => s.qty <= s.threshold).length === 0 ? (
                         <div className="flex items-center justify-center p-8 border-2 border-dashed border-gray-300/50 rounded-2xl">
                            <p className="text-sm font-medium text-gray-400">Semua stok terpantau aman ✨</p>
                         </div>
                       ) : (
                         stockList.filter(s => s.qty <= s.threshold).map(s => (
                           <div key={s.item} className="flex justify-between items-center bg-white/40 p-4 rounded-2xl hover:bg-white/60 transition-colors">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center font-bold text-xs uppercase shadow-sm">{s.item.substring(0,2)}</div>
                                <span className="font-semibold capitalize text-gray-800 text-lg">{s.item}</span>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Tersisa</span>
                                <span className="text-base font-bold text-red-500 bg-red-50 px-3 py-1 rounded-lg">{s.qty} {s.unit}</span>
                              </div>
                           </div>
                         ))
                       )}
                    </div>
                 </div>
              </div>
            ) : showAddForm ? (
              <div className="col-span-2 glass-panel p-6 rounded-3xl">
                <form onSubmit={handleAddCustomItem} className="flex flex-col gap-4">
                  <input
                    type="text"
                    placeholder="Nama Barang..."
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    className="glass-input px-5 py-4 rounded-2xl font-medium focus:outline-none focus:ring-2 focus:ring-[#B4F090]"
                  />
                  <input
                    type="text"
                    placeholder="Satuan (pcs)..."
                    value={newItemUnit}
                    onChange={(e) => setNewItemUnit(e.target.value)}
                    className="glass-input px-5 py-4 rounded-2xl font-medium focus:outline-none focus:ring-2 focus:ring-[#B4F090]"
                  />
                  <button type="submit" disabled={isAddingItem} className="bg-[#1E1E1E] text-white py-4 rounded-2xl font-bold interactive mt-2">
                    {isAddingItem ? "Menyimpan..." : "Simpan Barang Baru"}
                  </button>
                </form>
              </div>
            ) : showHistory ? (
              <div className="col-span-2 space-y-3">
                {transactions.length === 0 && <p className="text-gray-500 text-center py-8">Belum ada riwayat hari ini.</p>}
                {transactions.map(trx => (
                  <div key={trx.id} className="glass-panel p-4 rounded-2xl flex justify-between items-center">
                    <div>
                      <h4 className="font-semibold capitalize">{trx.item}</h4>
                      <p className="text-xs text-gray-500 mt-1">{new Date(trx.timestamp).toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div className="text-sm font-bold bg-white px-3 py-1.5 rounded-xl">
                      {trx.action === 'keluar' ? '-' : '+'}{trx.qty} {trx.unit}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              stockList.length === 0 ? (
                <p className="col-span-2 text-gray-500 text-center py-8">Inventaris kosong.</p>
              ) : (
                stockList.map(item => <StockRow key={item.item} item={item} onDelete={handleDeleteItem} />)
              )
            )}
          </div>

        </div>


        {/* RIGHT COLUMN: Chat Interface (like right reference image) */}
        <div className="glass-panel rounded-[40px] flex flex-col min-h-[600px] lg:min-h-0 lg:h-full overflow-hidden shadow-sm relative">
          
          <div className="px-8 pt-10 pb-4">
            <p className="text-sm font-medium text-gray-500 mb-1">Hai, Juragan</p>
            <h2 className="text-4xl font-normal leading-tight tracking-tight text-[#1E1E1E]">
              Ada yang bisa saya bantu catat hari ini?
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-[200px] chat-scroll flex flex-col gap-6 pt-4">
            {chatLog.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'ai' ? 'justify-start' : 'justify-end'} gap-3 w-full`}>
                {msg.role === 'ai' && (
                  <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm mt-1">
                    <SparkIcon className="w-4 h-4 text-[#B4F090]" />
                  </div>
                )}
                
                <div className={`p-4 rounded-3xl max-w-[80%] whitespace-pre-line text-[15px] leading-relaxed shadow-sm ${
                  msg.role === 'ai' 
                    ? 'bg-white text-gray-800 rounded-tl-sm' 
                    : 'bg-[#1E1E1E] text-white rounded-tr-sm'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Bottom Floating Input Bar (Desktop View) */}
          {renderBottomBar(false)}
        </div>

      </div>
      
      {/* Fixed Bottom Input Bar (Mobile View) */}
      {renderBottomBar(true)}
    </div>
  );
}