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

async function putRecords(records, onProgress) {
  if (!records || !records.length) return;
  const CHUNK = 800;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, 'readwrite');
      const store = tx.objectStore(STORE_RECORDS);
      for (let j = 0; j < slice.length; j++) store.put(slice[j]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB abort'));
    });
    if (typeof onProgress === 'function') {
      onProgress(Math.min(records.length, i + slice.length), records.length);
    }
    // Yield so the UI can paint between chunks.
    await new Promise(r => setTimeout(r, 0));
  }
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

let _alarmCtx = null;
let _alarmStopTimer = null;

function stopAlarm() {
  clearTimeout(_alarmStopTimer);
  _alarmStopTimer = null;
  if (_alarmCtx) {
    try { _alarmCtx.close(); } catch (e) { /* ignore */ }
    _alarmCtx = null;
  }
  if (navigator.vibrate) {
    try { navigator.vibrate(0); } catch (e) { /* ignore */ }
  }
}

// Strong vibrating alert when an exact plate/chassis match is found.
function vibrateFound(durationMs) {
  const ms = typeof durationMs === 'number' ? durationMs : 5000;
  stopAlarm();

  const runVibrate = () => {
    if (!navigator.vibrate) return;
    try {
      // Long strong pulses so the phone is unmistakable in-hand / pocket.
      const pulse = [];
      for (let t = 0; t < ms; t += 500) {
        pulse.push(400, 100);
      }
      navigator.vibrate(pulse);
    } catch (e) { /* ignore */ }
  };

  runVibrate();
  // Re-kick vibration a couple times — some WebViews drop the first pattern.
  try {
    setTimeout(runVibrate, 50);
    setTimeout(runVibrate, 600);
  } catch (e) { /* ignore */ }

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    _alarmCtx = ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.28;
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 880;
    osc.connect(gain);
    osc.start();

    const start = ctx.currentTime;
    const end = start + ms / 1000;
    let t = start;
    while (t < end) {
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(1175, t + 0.18);
      t += 0.36;
    }
    gain.gain.setValueAtTime(0.28, start);
    gain.gain.setValueAtTime(0.28, end - 0.05);
    gain.gain.linearRampToValueAtTime(0.0001, end);

    _alarmStopTimer = setTimeout(() => {
      try { osc.stop(); } catch (e) { /* ignore */ }
      stopAlarm();
    }, ms + 50);
  } catch (e) { /* ignore audio failures */ }
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error((label || 'عملية') + ' تجاوزت الوقت'));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function resolveAssetUrl(path) {
  try {
    return new URL(path, window.location.href).href;
  } catch (e) {
    return path;
  }
}

function isCapacitorNative() {
  try {
    if (typeof window !== 'undefined' && window.__LAMMAH_APP_SHELL__) return true;
    return typeof window.Capacitor !== 'undefined' &&
      typeof window.Capacitor.getPlatform === 'function' &&
      window.Capacitor.getPlatform() !== 'web';
  } catch (e) {
    return false;
  }
}

function recordFromParts(plate, type, bank, chassis, source) {
  const normPlate = normalizeText(plate || '');
  return {
    dedupeKey: normPlate + '|' + normalizeText(chassis || '') + '|' + normalizeText(bank || ''),
    plate: plate || '',
    type: type || '',
    bank: bank || '',
    chassis: chassis || '',
    normPlate,
    source: source || 'base'
  };
}

async function loadRecordsFromDataJson() {
  const resp = await fetch(resolveAssetUrl('data.json'));
  if (!resp.ok) throw new Error('data.json HTTP ' + resp.status);
  const rows = await resp.json();
  if (!Array.isArray(rows)) throw new Error('data.json غير صالح');
  return rows.map(row => recordFromParts(row[0], row[1], row[2], row[3], 'base'));
}

async function loadRecordsFromPlatesGz() {
  const resp = await fetch(resolveAssetUrl('plates.txt.gz'));
  if (!resp.ok) throw new Error('plates.txt.gz HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isGzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text;
  if (isGzipped) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('فك ضغط gzip غير مدعوم');
    }
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  const lines = text.split('\n').filter(Boolean);
  return lines.map(line => {
    const parts = line.split('|');
    return recordFromParts(parts[0], parts[1], parts[2], parts[3], 'base');
  });
}

async function loadBaseRecordsFromAssets(onStatus) {
  const preferJson = isCapacitorNative();
  const attempts = preferJson
    ? [loadRecordsFromDataJson, loadRecordsFromPlatesGz]
    : [loadRecordsFromPlatesGz, loadRecordsFromDataJson];
  const errors = [];
  for (const loader of attempts) {
    try {
      if (typeof onStatus === 'function') onStatus('جارٍ قراءة ملف البيانات...');
      return await withTimeout(loader(), 45000, 'قراءة الملف');
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }
  throw new Error(errors.join(' | '));
}

function persistRecordsInBackground(records) {
  Promise.resolve().then(async () => {
    try {
      await putRecords(records);
      await setMeta('seeded', true);
    } catch (e) {
      try { console.warn('background persist failed', e); } catch (ignore) {}
    }
  });
}

async function ensureBaseRecordsSeeded(onStatus) {
  const report = (msg) => {
    if (typeof onStatus === 'function') onStatus(msg);
  };

  // 1) Try IndexedDB cache — but never hang forever.
  try {
    report('جارٍ فتح قاعدة البيانات المحلية...');
    const alreadySeeded = await withTimeout(getMeta('seeded'), 2000, 'meta');
    if (alreadySeeded) {
      report('جارٍ قراءة السجلات المحفوظة...');
      const cached = await withTimeout(getAllRecords(), 4000, 'getAll');
      if (cached && cached.length) {
        report('');
        return cached;
      }
    }
  } catch (e) {
    report('التخزين المحلي بطيء — جارٍ التحميل من الملف...');
  }

  // 2) Load into memory from bundled assets (this unblocks search).
  const seeded = await loadBaseRecordsFromAssets(report);
  report('جاهز — ' + seeded.length.toLocaleString('ar-EG') + ' سجل');

  // 3) Persist in background so next open can use cache (non-blocking).
  persistRecordsInBackground(seeded);
  return seeded;
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-lammah-src="' + src + '"]');
    if (existing) {
      if (existing.getAttribute('data-loaded') === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('فشل تحميل ' + src)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.setAttribute('data-lammah-src', src);
    s.onload = () => { s.setAttribute('data-loaded', '1'); resolve(); };
    s.onerror = () => reject(new Error('فشل تحميل ' + src));
    document.head.appendChild(s);
  });
}

async function ensureXlsxLoaded() {
  if (typeof XLSX !== 'undefined') return;
  const localSrc = resolveAssetUrl('vendor/xlsx.full.min.js');
  try {
    await loadExternalScript(localSrc);
  } catch (e) {
    try {
      await loadExternalScript('vendor/xlsx.full.min.js');
    } catch (e2) {
      await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    }
  }
  if (typeof XLSX === 'undefined') throw new Error('مكتبة الإكسيل لم تُحمَّل');
}

async function ensureTesseractLoaded() {
  if (typeof Tesseract !== 'undefined') return;
  await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js');
  if (typeof Tesseract === 'undefined') throw new Error('مكتبة القراءة البصرية لم تُحمَّل — محتاج إنترنت');
}

const APP_VERSION = '0.1.30';
const APP_VERSION_CODE = 31;
