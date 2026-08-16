/**
 * stockStore.js
 * Database-backed stock state management for Warung Suara using Prisma.
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

const DEFAULT_THRESHOLD = 5;

async function registerItem(item, unit, threshold) {
  if (!item) throw new Error("Item name is required");
  const itemName = item.trim().toLowerCase();
  const itemUnit = unit || "pcs";
  const itemThreshold = threshold !== undefined ? parseInt(threshold, 10) : DEFAULT_THRESHOLD;

  let existing = await prisma.stock.findUnique({ where: { item: itemName } });
  if (existing) {
    throw new Error(`Item ${itemName} already exists`);
  }

  return await prisma.stock.create({
    data: {
      item: itemName,
      qty: 0,
      unit: itemUnit,
      threshold: itemThreshold,
    }
  });
}

/**
 * Apply hasil voice-transaction ke stock state.
 * action: "masuk" (stock in) atau "keluar" (stock out)
 */
async function applyTransaction({ item, qty, unit, action }) {
  if (!item || typeof qty !== "number" || qty < 0) {
    throw new Error("Invalid transaction payload: item and non-negative qty are required");
  }
  
  const normalizedItem = item.trim().toLowerCase();

  const finalAction = action || "keluar"; // Default ke keluar (terjual)
  if (finalAction !== "masuk" && finalAction !== "keluar") {
    throw new Error(`Unknown action: ${finalAction}. Expected "masuk" or "keluar".`);
  }

  // 1. Catat ke TransactionHistory
  await prisma.transactionHistory.create({
    data: {
      item: normalizedItem,
      action: finalAction,
      qty,
      unit: unit || "pcs"
    }
  });

  // 2. Dapatkan item saat ini atau buat baru
  let stockItem = await prisma.stock.findUnique({
    where: { item: normalizedItem }
  });

  if (!stockItem) {
    stockItem = await prisma.stock.create({
      data: {
        item: normalizedItem,
        qty: 0,
        unit: unit || "pcs",
        threshold: DEFAULT_THRESHOLD,
      }
    });
  }

  // Jika ada unit baru yang diberikan, perbarui unit
  const finalUnit = unit ? unit : stockItem.unit;

  let newQty = stockItem.qty;
  if (finalAction === "masuk") {
    newQty += qty;
  } else if (finalAction === "keluar") {
    newQty -= qty;
  }

  const wentNegative = newQty < 0;
  if (wentNegative) {
    newQty = 0;
  }

  // 3. Update stock
  const updatedStock = await prisma.stock.update({
    where: { item: normalizedItem },
    data: {
      qty: newQty,
      unit: finalUnit
    }
  });

  return {
    item: updatedStock.item,
    qty: updatedStock.qty,
    unit: updatedStock.unit,
    threshold: updatedStock.threshold,
    warning: wentNegative ? "Stok tidak cukup, qty dikurangi sampai 0" : null,
  };
}

async function getStock() {
  const stocks = await prisma.stock.findMany();
  return stocks.map(s => ({
    item: s.item,
    qty: s.qty,
    unit: s.unit,
    threshold: s.threshold
  }));
}

async function getLowStock() {
  const stocks = await prisma.stock.findMany();
  return stocks
    .filter(s => s.qty <= s.threshold)
    .map(s => ({
      item: s.item,
      qty: s.qty,
      unit: s.unit,
      threshold: s.threshold
    }));
}

async function setThreshold(item, threshold) {
  if (typeof threshold !== "number" || threshold < 0) {
    throw new Error("Threshold must be a non-negative number");
  }
  
  const normalizedItem = item.trim().toLowerCase();
  
  const stockItem = await prisma.stock.upsert({
    where: { item: normalizedItem },
    update: { threshold },
    create: {
      item: normalizedItem,
      qty: 0,
      unit: "pcs",
      threshold: threshold
    }
  });

  return { 
    item: stockItem.item, 
    qty: stockItem.qty,
    unit: stockItem.unit,
    threshold: stockItem.threshold 
  };
}

async function resetStock() {
  await prisma.stock.deleteMany({});
  await prisma.transactionHistory.deleteMany({});
  return { message: "Stock and transaction history reset (database cleared)" };
}

async function deleteItem(item) {
  if (!item) throw new Error("Item name is required");
  const normalizedItem = item.trim().toLowerCase();
  
  await prisma.stock.delete({
    where: { item: normalizedItem }
  });
  
  return { message: `Item ${normalizedItem} successfully deleted` };
}

async function getTransactionHistory() {
  return await prisma.transactionHistory.findMany({
    orderBy: { timestamp: 'desc' }
  });
}

module.exports = {
  applyTransaction,
  getStock,
  getLowStock,
  setThreshold,
  deleteItem,
  resetStock,
  getTransactionHistory,
  registerItem
};