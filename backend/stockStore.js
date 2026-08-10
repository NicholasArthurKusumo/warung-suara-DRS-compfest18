/**
 * stockStore.js
 * In-memory stock state management for Warung Suara.
 * Nggak pakai database sesuai batasan MVP rulebook, state hidup di
 * memory dan reset kalau server restart (kecuali dipanggil manual via /stock/reset).
 */

const DEFAULT_THRESHOLD = 5;

// stock[itemName] = { qty: number, unit: string, threshold: number }
let stock = {};

function ensureItem(item, unit = "pcs") {
  if (!stock[item]) {
    stock[item] = {
      qty: 0,
      unit,
      threshold: DEFAULT_THRESHOLD,
    };
  }
  return stock[item];
}

/**
 * Apply hasil voice-transaction ke stock state.
 * action: "masuk" (stock in) atau "keluar" (stock out)
 */
function applyTransaction({ item, qty, unit, action }) {
  if (!item || typeof qty !== "number" || qty < 0) {
    throw new Error("Invalid transaction payload: item and non-negative qty are required");
  }

  const entry = ensureItem(item, unit || "pcs");

  if (unit) entry.unit = unit;

  if (action === "masuk") {
    entry.qty += qty;
  } else if (action === "keluar") {
    entry.qty -= qty;
  } else {
    throw new Error(`Unknown action: ${action}. Expected "masuk" or "keluar".`);
  }

  const wentNegative = entry.qty < 0;
  if (wentNegative) {
    entry.qty = 0;
  }

  return {
    item,
    ...entry,
    warning: wentNegative ? "Stok tidak cukup, qty dikurangi sampai 0" : null,
  };
}

function getStock() {
  return Object.entries(stock).map(([item, data]) => ({ item, ...data }));
}

function getLowStock() {
  return getStock().filter((entry) => entry.qty <= entry.threshold);
}

function setThreshold(item, threshold) {
  if (typeof threshold !== "number" || threshold < 0) {
    throw new Error("Threshold must be a non-negative number");
  }
  const entry = ensureItem(item);
  entry.threshold = threshold;
  return { item, ...entry };
}

function resetStock() {
  stock = {};
  return { message: "Stock state reset" };
}

module.exports = {
  applyTransaction,
  getStock,
  getLowStock,
  setThreshold,
  resetStock,
};