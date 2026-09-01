/* db.js — shared IndexedDB storage + text-normalization helpers.
   Loaded by index.html, chassis.html and history.html so all three
   pages share the exact same local, on-device database. */

const DB_NAME = 'plateSearchDB';
const DB_VERSION = 1;
const STORE_RECORDS = 'records';
const STORE_META = 'meta';
const STORE_HISTORY = 'history';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        db.createObjectStore(STORE_RECORDS, { keyPath: 'dedupeKey' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = () => reject(req.error);
  });
}

async function setMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, 'readonly');
    const req = tx.objectStore(STORE_RECORDS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function putRecords(records) {
  if (!records || !records.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, 'readwrite');
    const store = tx.objectStore(STORE_RECORDS);
    records.forEach(r => store.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearAllRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, 'readwrite');
    tx.objectStore(STORE_RECORDS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function addHistoryEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    tx.objectStore(STORE_HISTORY).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readonly');
    const req = tx.objectStore(STORE_HISTORY).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function clearAllHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    tx.objectStore(STORE_HISTORY).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Wipes EVERYTHING (base + extra records, and the search log) and marks the
// device as "seeded" with zero records so the base dataset is NOT
// automatically re-downloaded from the server on the next page load —
// a plain refresh will show an empty database until the person explicitly
// re-adds data (Excel upload) or clears their browser storage entirely.
async function clearEverything() {
  await clearAllRecords();
  await clearAllHistory();
  await setMeta('seeded', true);
}

// ---- Normalization helpers (shared across pages) ----
const arabicIndicDigits = '٠١٢٣٤٥٦٧٨٩';
const easternIndicDigits = '۰۱۲۳۴۵۶۷۸۹';

function normalizeDigits(str) {
  return str.replace(/[٠-٩]/g, d => String(arabicIndicDigits.indexOf(d)))
             .replace(/[۰-۹]/g, d => String(easternIndicDigits.indexOf(d)));
}

function stripTashkeel(str) {
  return str.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
}

function normalizeArabicLetters(str) {
  return str
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ٱ/g, 'ا');
}

function normalizeText(str) {
  if (!str) return '';
  str = normalizeDigits(str);
  str = stripTashkeel(str);
  str = normalizeArabicLetters(str);
  str = str.replace(/\s+/g, '');
  str = str.toLowerCase();
  return str;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function vibrateFound() {
  if (navigator.vibrate) {
    try { navigator.vibrate(10000); } catch (e) { /* ignore */ }
  }
}
