/* ══════════════════════════════════════════════════════════════════════════
   Wedding Budget — a static page that reads and writes an .xlsx workbook.

   The workbook holds two sheets:
     Budget    what a part of the wedding is expected to cost
     Payments  money actually handed over, by whom, against which item
   plus a generated Summary sheet with live formulas, for reading in Excel.

   Where that workbook lives is a choice, made in Settings. Everything above
   the store speaks in { items, payments } and never knows the difference:

     file     a real .xlsx on this device, opened through the File System
              Access API. No account, no token, no network. The default
              wherever the browser supports it.
     browser  kept inside this browser. No setup at all, and the only option
              on phones, where no browser can write to a chosen file.
     github   committed to a repository through the Contents API. Needs a
              token, and is the only mode that syncs devices by itself.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const LS = {
  token: 'wedding-budget.token',
  theme: 'wedding-budget.theme',
  currency: 'wedding-budget.currency',
  locale: 'wedding-budget.locale',
  mode: 'wedding-budget.store-mode',
};

const BUDGET_COLUMNS = ['ID', 'Item', 'Category', 'Estimated', 'Notes'];
const PAYMENT_COLUMNS = ['ID', 'Item ID', 'Item', 'Date', 'Amount', 'Paid By', 'Payment Method', 'Notes'];

/* Colour carries one job in this app: how much money. Everything is a single
   blue — the categorical palette is deliberately unused.

   "Who paid for what" was first drawn as a stacked bar with a hue per person.
   That fails honestly: different items draw different subsets of payers, so any
   two people can end up touching, which is the validator's all-pairs case, and
   no more than four of the reference hues clear it in both light and dark. Four
   named relatives with the rest folded into grey is exactly the information
   this app exists to keep. A grid of magnitudes wants a heatmap on one
   sequential hue instead — identity comes from the row and column labels, and
   any number of people fit. */
const HEAT_STEPS = 6;
const LABEL_FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';

/* ── Config ──────────────────────────────────────────────────────────────── */

function detectRepo() {
  const host = location.hostname;
  const seg = location.pathname.split('/').filter(Boolean);
  if (!host.endsWith('.github.io')) return { owner: null, repo: null };
  const owner = host.slice(0, -'.github.io'.length);
  // Project page → /<repo>/… ; user or org page → repo is "<owner>.github.io".
  const repo = seg.length && !/\.(html?|xlsx)$/i.test(seg[0]) ? seg[0] : host;
  return { owner, repo };
}

const cfg = (() => {
  const base = window.EXPENSE_CONFIG || {};
  const found = detectRepo();
  return {
    ...base,
    owner: base.owner || found.owner,
    repo: base.repo || found.repo,
    branch: base.branch || 'main',
    filePath: base.filePath || 'data/expenses.xlsx',
    budgetSheet: base.budgetSheet || 'Budget',
    paymentSheet: base.paymentSheet || 'Payments',
    locale: localStorage.getItem(LS.locale) || base.locale || 'en-IN',
    currency: localStorage.getItem(LS.currency) || base.currency || 'INR',
    categories: base.categories || ['Miscellaneous'],
    payers: base.payers || [],
    methods: base.methods || ['Other'],
    starterItems: base.starterItems || [],
    defaultMode: base.defaultMode || '',
  };
})();

const state = {
  items: [],       // {id, name, category, estimate, notes}
  payments: [],    // {id, itemId, date, amount, payer, method, notes}
  base: null,      // {items, payments} as last written — the github store's merge base
  sha: null,
  token: localStorage.getItem(LS.token) || '',
  mode: '',        // set during boot, once we know what this browser supports
  fileName: '',    // the chosen workbook's name, for the file store
  blocked: '',     // why we cannot write yet: 'permission' | 'nofile' | 'notoken'
  filters: { category: '', payer: '', search: '' },
  itemSort: { key: 'outstanding', dir: 'desc' },
  paySort: { key: 'date', dir: 'desc' },
  tab: 'items',
  expanded: new Set(),
  editingItem: null,
  editingPay: null,
  pendingDelete: null,
  sync: 'loading',
  syncNote: '',
};

/* ── Small helpers ───────────────────────────────────────────────────────── */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
  return n;
}

let money = null;
let moneyRound = null;

function rebuildFormatters() {
  try {
    money = new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency, maximumFractionDigits: 2 });
    moneyRound = new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency, maximumFractionDigits: 0 });
  } catch {
    money = moneyRound = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
  }
}

const fmtMoney = (n) => money.format(Number(n) || 0);
const fmtMoneyRound = (n) => moneyRound.format(Number(n) || 0);

/* Chart and tile labels get the short form people actually speak in. Indian
   currency counts in lakh and crore; everything else uses compact notation. */
function fmtShort(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (cfg.currency === 'INR') {
    const sym = '₹';
    if (a >= 1e7) return `${sign}${sym}${trimZero(a / 1e7)} Cr`;
    if (a >= 1e5) return `${sign}${sym}${trimZero(a / 1e5)} L`;
    if (a >= 1e3) return `${sign}${sym}${trimZero(a / 1e3)}K`;
    return `${sign}${sym}${Math.round(a)}`;
  }
  try {
    return new Intl.NumberFormat(cfg.locale, {
      style: 'currency', currency: cfg.currency, notation: 'compact', maximumFractionDigits: 1,
    }).format(v);
  } catch {
    return fmtMoneyRound(v);
  }
}

function trimZero(x) {
  const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
  return s.replace(/\.?0+$/, '');
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y) return iso || '';
  const date = new Date(y, (m || 1) - 1, d || 1);
  const showYear = y !== new Date().getFullYear();
  return date.toLocaleDateString(cfg.locale, { day: '2-digit', month: 'short', ...(showYear ? { year: 'numeric' } : {}) });
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ── Text measurement, so a label is never clipped ───────────────────────── */

const measureCtx = document.createElement('canvas').getContext('2d');

function textWidth(s, font = LABEL_FONT) {
  measureCtx.font = font;
  return measureCtx.measureText(String(s)).width;
}

function truncate(s, maxW, font = LABEL_FONT) {
  s = String(s);
  if (textWidth(s, font) <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(`${s.slice(0, mid)}…`, font) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

/* ── Excel serial dates ──────────────────────────────────────────────────── */

const EPOCH = Date.UTC(1899, 11, 30);

function serialToISO(serial) {
  const d = new Date(EPOCH + Math.round(serial) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isoToSerial(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
}

function coerceDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && isFinite(v)) return serialToISO(v);
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return '';
}

const num = (v) => Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')) || 0;

/* ── Workbook ↔ rows ─────────────────────────────────────────────────────── */

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  if (!aoa.length) return { head: [], body: [] };
  return {
    head: (aoa[0] || []).map((h) => String(h == null ? '' : h).trim().toLowerCase()),
    body: aoa.slice(1),
  };
}

const indexer = (head) => (names) => {
  for (const n of names) {
    const i = head.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
};

const cell = (r, i) => (i >= 0 && r[i] != null ? r[i] : '');
const str = (r, i) => String(cell(r, i)).trim();

function parseWorkbook(u8) {
  const wb = XLSX.read(u8, { type: 'array', cellDates: false });

  const budget = sheetRows(wb, cfg.budgetSheet);
  const pays = sheetRows(wb, cfg.paymentSheet);

  // Nothing in the new shape — an older single-sheet expense list may be here.
  if (!budget && !pays) return migrateLegacy(wb);

  const items = [];
  if (budget) {
    const at = indexer(budget.head);
    const ix = {
      id: at(['id']),
      name: at(['item', 'name', 'description']),
      category: at(['category']),
      estimate: at(['estimated', 'estimate', 'budget', 'estimated cost']),
      notes: at(['notes', 'note']),
    };
    for (const r of budget.body) {
      if (!r || !r.length) continue;
      const name = str(r, ix.name);
      const estimate = num(cell(r, ix.estimate));
      if (!name && !estimate) continue;
      items.push({
        id: str(r, ix.id) || newId(),
        name: name || 'Untitled item',
        category: str(r, ix.category) || 'Miscellaneous',
        estimate,
        notes: str(r, ix.notes),
      });
    }
  }

  const byId = new Map(items.map((it) => [it.id, it]));
  const byName = new Map(items.map((it) => [it.name.toLowerCase(), it]));

  const payments = [];
  if (pays) {
    const at = indexer(pays.head);
    const ix = {
      id: at(['id']),
      itemId: at(['item id', 'itemid']),
      itemName: at(['item', 'towards']),
      date: at(['date']),
      amount: at(['amount', 'paid', 'value']),
      payer: at(['paid by', 'payer', 'person']),
      method: at(['payment method', 'method']),
      notes: at(['notes', 'note']),
    };
    for (const r of pays.body) {
      if (!r || !r.length) continue;
      const amount = num(cell(r, ix.amount));
      const date = coerceDate(cell(r, ix.date));
      const rawName = str(r, ix.itemName);
      if (!amount && !date && !rawName) continue;

      // Match on ID first; fall back to the item name so a row typed straight
      // into Excel still lands, and create the item if it is genuinely new.
      let item = byId.get(str(r, ix.itemId)) || byName.get(rawName.toLowerCase());
      if (!item && rawName) {
        item = { id: newId(), name: rawName, category: 'Miscellaneous', estimate: 0, notes: '' };
        items.push(item);
        byId.set(item.id, item);
        byName.set(item.name.toLowerCase(), item);
      }
      if (!item) continue;

      payments.push({
        id: str(r, ix.id) || newId(),
        itemId: item.id,
        date,
        amount,
        payer: str(r, ix.payer) || 'Unrecorded',
        method: str(r, ix.method),
        notes: str(r, ix.notes),
      });
    }
  }

  return { items, payments };
}

/* An earlier version of this app kept a flat "Expenses" sheet. Rather than drop
   that history, fold each old row into a payment against an item named for its
   category, so nothing typed in before is lost. */
function migrateLegacy(wb) {
  const name = wb.SheetNames.find((n) => {
    const s = sheetRows(wb, n);
    return s && s.head.includes('amount') && s.head.includes('description');
  });
  if (!name) return { items: [], payments: [] };

  const sheet = sheetRows(wb, name);
  const at = indexer(sheet.head);
  const ix = {
    date: at(['date']),
    category: at(['category']),
    description: at(['description', 'desc']),
    amount: at(['amount', 'value']),
    method: at(['payment method', 'method']),
    notes: at(['notes', 'note']),
  };

  const items = [];
  const byName = new Map();
  const payments = [];

  for (const r of sheet.body) {
    if (!r || !r.length) continue;
    const amount = num(cell(r, ix.amount));
    const description = str(r, ix.description);
    const date = coerceDate(cell(r, ix.date));
    if (!amount && !description && !date) continue;

    const cat = str(r, ix.category) || 'Miscellaneous';
    let item = byName.get(cat.toLowerCase());
    if (!item) {
      item = { id: newId(), name: cat, category: cat, estimate: 0, notes: '' };
      items.push(item);
      byName.set(cat.toLowerCase(), item);
    }
    payments.push({
      id: newId(),
      itemId: item.id,
      date,
      amount,
      payer: 'Unrecorded',
      method: str(r, ix.method),
      notes: [description, str(r, ix.notes)].filter(Boolean).join(' — '),
    });
  }
  return { items, payments };
}

function buildWorkbook(data) {
  const items = data.items.slice().sort((a, b) => a.name.localeCompare(b.name));
  const payments = data.payments.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const nameOf = new Map(items.map((it) => [it.id, it.name]));

  /* Budget sheet */
  const bAoa = [BUDGET_COLUMNS];
  for (const it of items) bAoa.push([it.id, it.name, it.category, Number(it.estimate) || 0, it.notes || '']);
  const wsB = XLSX.utils.aoa_to_sheet(bAoa);
  for (let i = 0; i < items.length; i++) {
    const c = wsB[`D${i + 2}`];
    if (c) { c.t = 'n'; c.z = '#,##0.00'; }
  }
  wsB['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 22 }, { wch: 14 }, { wch: 34 }];
  wsB['!autofilter'] = { ref: `A1:E${Math.max(1, items.length + 1)}` };

  /* Payments sheet */
  const pAoa = [PAYMENT_COLUMNS];
  for (const p of payments) {
    pAoa.push([
      p.id,
      p.itemId,
      nameOf.get(p.itemId) || '',
      p.date ? isoToSerial(p.date) : '',
      Number(p.amount) || 0,
      p.payer || '',
      p.method || '',
      p.notes || '',
    ]);
  }
  const wsP = XLSX.utils.aoa_to_sheet(pAoa);
  for (let i = 0; i < payments.length; i++) {
    const row = i + 2;
    const d = wsP[`D${row}`];
    if (d && typeof d.v === 'number') { d.t = 'n'; d.z = 'yyyy-mm-dd'; }
    const a = wsP[`E${row}`];
    if (a) { a.t = 'n'; a.z = '#,##0.00'; }
  }
  wsP['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 34 }];
  wsP['!autofilter'] = { ref: `A1:H${Math.max(1, payments.length + 1)}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsB, cfg.budgetSheet);
  XLSX.utils.book_append_sheet(wb, wsP, cfg.paymentSheet);
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(items, payments), 'Summary');
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

/* Formulas, not frozen numbers, so the workbook stays correct if someone edits
   the Payments sheet in Excel. Cached values are written alongside so readers
   that do not evaluate formulas still show the right figures. */
function buildSummarySheet(items, payments) {
  const paidBy = new Map();
  for (const p of payments) paidBy.set(p.itemId, (paidBy.get(p.itemId) || 0) + (Number(p.amount) || 0));

  const ws = XLSX.utils.aoa_to_sheet([['Item', 'Category', 'Estimated', 'Paid', 'Still to pay']]);
  // A sheet reference is single-quoted in Excel, with any inner quote doubled.
  // Double quotes would make it a string literal and the formula invalid.
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

  items.forEach((it, i) => {
    const row = i + 2;
    const est = Number(it.estimate) || 0;
    const paid = paidBy.get(it.id) || 0;
    ws[`A${row}`] = { t: 's', v: it.name };
    ws[`B${row}`] = { t: 's', v: it.category };
    ws[`C${row}`] = { t: 'n', v: est, z: '#,##0.00' };
    ws[`D${row}`] = { t: 'n', v: paid, z: '#,##0.00', f: `SUMIF(${q(cfg.paymentSheet)}!$C:$C,$A${row},${q(cfg.paymentSheet)}!$E:$E)` };
    ws[`E${row}`] = { t: 'n', v: est - paid, z: '#,##0.00', f: `C${row}-D${row}` };
  });

  const last = items.length + 1;
  const totalRow = last + 1;
  if (items.length) {
    ws[`A${totalRow}`] = { t: 's', v: 'Total' };
    for (const col of ['C', 'D', 'E']) {
      const vals = items.reduce((t, it, i) => {
        const est = Number(it.estimate) || 0;
        const paid = paidBy.get(it.id) || 0;
        return t + (col === 'C' ? est : col === 'D' ? paid : est - paid);
      }, 0);
      ws[`${col}${totalRow}`] = { t: 'n', v: vals, z: '#,##0.00', f: `SUM(${col}2:${col}${last})` };
    }
  }

  ws['!ref'] = `A1:E${Math.max(1, items.length ? totalRow : 1)}`;
  ws['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  return ws;
}

/* ── base64 ──────────────────────────────────────────────────────────────── */

function u8ToBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

function base64ToU8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* ── A little IndexedDB ──────────────────────────────────────────────────────
   localStorage holds strings only, and a file handle is neither a string nor
   something we may re-create ourselves — it is a capability the user granted,
   and only IndexedDB can keep it. The workbook bytes ride along in the same
   store so the browser mode needs no second mechanism. */

const IDB_NAME = 'wedding-budget';
const IDB_STORE = 'kv';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ── Store: a real .xlsx on this device ──────────────────────────────────────
   No account and no network. The browser hands back a handle to the file the
   user picked; we keep it so the same file reopens next time. The permission
   attached to it does not survive a browser restart, and re-requesting it must
   happen inside a click — hence the reconnect prompt rather than a silent
   retry on load. */

const HANDLE_KEY = 'file-handle';

const fileStore = {
  id: 'file',
  label: 'Excel file on this device',
  available: () => typeof window.showOpenFilePicker === 'function',

  handle: null,

  async restore() {
    this.handle = (await idbGet(HANDLE_KEY)) || null;
    if (!this.handle) return 'nofile';
    const perm = await this.handle.queryPermission({ mode: 'readwrite' });
    return perm === 'granted' ? '' : 'permission';
  },

  // Must be called from a user gesture.
  async grant() {
    if (!this.handle) return false;
    const perm = await this.handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted';
  },

  async pickExisting() {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
      multiple: false,
    });
    await this.adopt(handle);
  },

  async pickNew(suggestedName = 'wedding-budget.xlsx') {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
    });
    await this.adopt(handle);
  },

  async adopt(handle) {
    this.handle = handle;
    await idbSet(HANDLE_KEY, handle);
    state.fileName = handle.name;
  },

  async forget() {
    this.handle = null;
    await idbDel(HANDLE_KEY);
    state.fileName = '';
  },

  async read() {
    if (!this.handle) throw new Error('No workbook chosen yet.');
    state.fileName = this.handle.name;
    const file = await this.handle.getFile();
    // A freshly created file is zero bytes — that is an empty budget, not a fault.
    if (!file.size) return { data: { items: [], payments: [] } };
    return { data: parseWorkbook(new Uint8Array(await file.arrayBuffer())) };
  },

  async write(data) {
    if (!this.handle) throw new Error('No workbook chosen yet.');
    const writable = await this.handle.createWritable();
    await writable.write(buildWorkbook(data));
    await writable.close();
  },
};

/* ── Store: inside this browser ──────────────────────────────────────────────
   The fallback where no file can be written — every phone, and Firefox. The
   bytes are a real .xlsx, so Export hands back a file Excel opens. */

const BYTES_KEY = 'workbook-bytes';

const browserStore = {
  id: 'browser',
  label: 'This browser',
  available: () => true,

  async restore() { return ''; },

  async read() {
    const bytes = await idbGet(BYTES_KEY);
    if (!bytes) return { data: { items: [], payments: [] } };
    return { data: parseWorkbook(new Uint8Array(bytes)) };
  },

  async write(data) {
    await idbSet(BYTES_KEY, buildWorkbook(data).buffer);
  },
};

/* ── Store: a GitHub repository ─────────────────────────────────────────────
   Kept because it is the only mode that syncs devices without being asked to.
   It is the one mode that needs a token: GitHub refuses anonymous writes to any
   repository, including your own. */

const contentsUrl = () =>
  `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.filePath.split('/').map(encodeURIComponent).join('/')}`;

async function gh(url, opts = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
  };
  const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
  if (!res.ok && res.status !== 404) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.message) detail = j.message;
    } catch { /* keep status */ }
    if (res.status === 401) detail = 'Token rejected (401). Check or regenerate it in Settings.';
    if (res.status === 403 && /rate limit/i.test(detail)) detail = 'GitHub rate limit reached — try again shortly.';
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function fetchViaApi() {
  const res = await gh(`${contentsUrl()}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`);
  if (res.status === 404) return { data: { items: [], payments: [] }, sha: null, missing: true };
  const json = await res.json();
  let u8;
  if (json.content) {
    u8 = base64ToU8(json.content);
  } else if (json.download_url) {
    const raw = await fetch(json.download_url, { cache: 'no-store' });
    if (!raw.ok) throw new Error(`Could not download the file (HTTP ${raw.status})`);
    u8 = new Uint8Array(await raw.arrayBuffer());
  } else {
    throw new Error('GitHub returned no file content');
  }
  return { data: parseWorkbook(u8), sha: json.sha };
}

async function fetchPublished() {
  const url = new URL(cfg.filePath, document.baseURI);
  url.searchParams.set('t', Date.now());
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${cfg.filePath} (HTTP ${res.status})`);
  return { data: parseWorkbook(new Uint8Array(await res.arrayBuffer())), sha: null };
}

async function putFile(data, sha, message) {
  const body = { message, content: u8ToBase64(buildWorkbook(data)), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await gh(contentsUrl(), { method: 'PUT', body: JSON.stringify(body) });
  const json = await res.json();
  return json.content && json.content.sha;
}

const githubStore = {
  id: 'github',
  label: 'GitHub repository',
  available: () => !!(cfg.owner && cfg.repo),

  async restore() {
    if (!state.token) return 'notoken';
    return '';
  },

  async read() {
    if (state.token) return fetchViaApi();
    // No token: fall back to the copy published beside this page, read-only.
    return fetchPublished();
  },

  /* Writes carry their own conflict handling: GitHub rejects a PUT whose sha is
     not current, which is how another device announces it got there first. */
  async write(data, ops) {
    const message = commitMessage(ops);
    try {
      const sha = state.base && state.sha ? state.sha : (await fetchViaApi()).sha;
      state.sha = await putFile(data, sha, message);
    } catch (err) {
      if (!isConflict(err)) throw err;
      const fresh = await fetchViaApi();
      const merged = applyOps(fresh.data, ops);
      state.sha = await putFile(merged, fresh.sha, message);
      state.items = merged.items;
      state.payments = merged.payments;
      toast('info', 'Merged a change made elsewhere.');
      return merged;
    }
    return null;
  },
};

/* ── Choosing a store ────────────────────────────────────────────────────── */

const STORES = { file: fileStore, browser: browserStore, github: githubStore };

const activeStore = () => STORES[state.mode] || browserStore;

/* What a browser that has never chosen should use: the configured preference
   when this browser can honour it, else the best thing it can actually do. */
function defaultMode() {
  const wanted = cfg.defaultMode;
  if (wanted && STORES[wanted] && STORES[wanted].available()) return wanted;
  if (fileStore.available()) return 'file';
  if (state.token && githubStore.available()) return 'github';
  return 'browser';
}

function resolveMode() {
  const saved = localStorage.getItem(LS.mode);
  if (saved && STORES[saved] && STORES[saved].available()) return saved;
  return defaultMode();
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem(LS.mode, mode);
}

const canWrite = () => !state.blocked;

/* ── Commit queue ────────────────────────────────────────────────────────── */

const queue = [];
let flushing = false;
let attempts = 0;
let retryTimer = null;

function applyOps(data, ops) {
  let items = data.items.slice();
  let payments = data.payments.slice();

  for (const op of ops) {
    if (op.kind === 'item') {
      const i = items.findIndex((r) => r.id === op.row.id);
      if (i >= 0) items[i] = op.row;
      else items.push(op.row);
    } else if (op.kind === 'item-del') {
      items = items.filter((r) => r.id !== op.id);
      payments = payments.filter((p) => p.itemId !== op.id);   // an item's payments go with it
    } else if (op.kind === 'pay') {
      const i = payments.findIndex((r) => r.id === op.row.id);
      if (i >= 0) payments[i] = op.row;
      else payments.push(op.row);
    } else if (op.kind === 'pay-del') {
      payments = payments.filter((r) => r.id !== op.id);
    }
  }
  return { items, payments };
}

function commitMessage(ops) {
  if (ops.length === 1) {
    const op = ops[0];
    if (op.kind === 'item') return `${op.isNew ? 'Add' : 'Update'} budget item: ${op.row.name} — ${fmtMoney(op.row.estimate)}`;
    if (op.kind === 'item-del') return `Delete budget item ${op.label || op.id}`;
    if (op.kind === 'pay') return `${op.isNew ? 'Record' : 'Update'} payment: ${fmtMoney(op.row.amount)} by ${op.row.payer} for ${op.itemName}`;
    if (op.kind === 'pay-del') return `Delete payment ${op.label || op.id}`;
    if (op.kind === 'switch') return 'Move the wedding budget into this repository';
    if (op.kind === 'import') return 'Import wedding budget from a workbook';
  }
  return `Update wedding budget (${ops.length} changes)`;
}

function enqueue(op) {
  queue.push(op);
  if (!canWrite()) {
    setSync('blocked');
    return;
  }
  flush();
}

// GitHub rejects a PUT whose sha is not the file's current one — that is the
// signal another writer got there first (or that our cached sha is stale).
function isConflict(err) {
  return err.status === 409 || err.status === 422 || /does not match|but expected/i.test(err.message || '');
}

async function flush() {
  if (flushing || !queue.length || !canWrite()) return;
  clearTimeout(retryTimer);
  flushing = true;
  setSync('saving');

  try {
    while (queue.length) {
      const batch = queue.splice(0, queue.length);
      try {
        // The screen already shows the result of these ops; writing what is on
        // screen is what keeps the workbook and the view the same thing.
        const next = { items: state.items, payments: state.payments };
        const merged = await activeStore().write(next, batch);
        state.base = merged || next;
        renderAll();
      } catch (err) {
        queue.unshift(...batch);                          // keep the work
        state.sha = null;                                 // force a re-read next try
        state.base = null;
        throw err;
      }
    }
    attempts = 0;
    setSync('ok');
  } catch (err) {
    attempts++;
    setSync('error', err.message);
    if (attempts <= 2) {
      toast('error', `Save failed — retrying. ${err.message}`);
      retryTimer = setTimeout(flush, 4000);
    } else {
      toast('error', `Save failed: ${err.message}`);
    }
  } finally {
    flushing = false;
  }
}

/* ── Mutations ───────────────────────────────────────────────────────────── */

function saveItem(row, isNew) {
  const i = state.items.findIndex((r) => r.id === row.id);
  if (i >= 0) state.items = state.items.map((r) => (r.id === row.id ? row : r));
  else state.items = state.items.concat([row]);
  renderAll();
  enqueue({ kind: 'item', row, isNew });
}

function removeItem(id) {
  const gone = state.items.find((r) => r.id === id);
  state.items = state.items.filter((r) => r.id !== id);
  state.payments = state.payments.filter((p) => p.itemId !== id);
  renderAll();
  enqueue({ kind: 'item-del', id, label: gone ? `"${gone.name}"` : id });
}

function savePayment(row, isNew) {
  const i = state.payments.findIndex((r) => r.id === row.id);
  if (i >= 0) state.payments = state.payments.map((r) => (r.id === row.id ? row : r));
  else state.payments = state.payments.concat([row]);
  renderAll();
  const item = state.items.find((it) => it.id === row.itemId);
  enqueue({ kind: 'pay', row, isNew, itemName: item ? item.name : 'an item' });
}

function removePayment(id) {
  const gone = state.payments.find((r) => r.id === id);
  state.payments = state.payments.filter((r) => r.id !== id);
  renderAll();
  enqueue({ kind: 'pay-del', id, label: gone ? `${fmtMoney(gone.amount)} by ${gone.payer}` : id });
}

function createStarterItems() {
  const rows = cfg.starterItems.map((s) => ({
    id: newId(), name: s.name, category: s.category, estimate: 0, notes: '',
  }));
  if (!rows.length) return;
  state.items = state.items.concat(rows);
  renderAll();
  queue.push(...rows.map((row) => ({ kind: 'item', row, isNew: true })));
  if (!canWrite()) setSync('blocked');
  else flush();
  toast('info', `Added ${plural(rows.length, 'item', 'items')} — set an estimated cost on each.`);
}

/* ── Derived data ────────────────────────────────────────────────────────── */

const itemById = () => new Map(state.items.map((it) => [it.id, it]));

function matchesItem(it, q) {
  return `${it.name} ${it.category} ${it.notes}`.toLowerCase().includes(q);
}

function matchesPayment(p, itemName, q) {
  return `${itemName} ${p.payer} ${p.method} ${p.notes}`.toLowerCase().includes(q);
}

/* One filter row scopes every chart and both tables. A payer filter narrows
   payments, never budgets — so the labels below say whose money is shown. */
function slice() {
  const { category, payer, search } = state.filters;
  const q = search.trim().toLowerCase();
  const map = itemById();

  const payments = state.payments.filter((p) => {
    const it = map.get(p.itemId);
    if (!it) return false;
    if (category && it.category !== category) return false;
    if (payer && p.payer !== payer) return false;
    if (q && !matchesPayment(p, it.name, q) && !matchesItem(it, q)) return false;
    return true;
  });

  const paidItemIds = new Set(payments.map((p) => p.itemId));

  const items = state.items.filter((it) => {
    if (category && it.category !== category) return false;
    // With a person selected, only what that person actually paid towards.
    if (payer) return paidItemIds.has(it.id);
    if (q) return matchesItem(it, q) || paidItemIds.has(it.id);
    return true;
  });

  return { items, payments };
}

function rollUp(view) {
  const paid = new Map();
  const count = new Map();
  for (const p of view.payments) {
    paid.set(p.itemId, (paid.get(p.itemId) || 0) + (Number(p.amount) || 0));
    count.set(p.itemId, (count.get(p.itemId) || 0) + 1);
  }
  return view.items.map((it) => {
    const est = Number(it.estimate) || 0;
    const pd = paid.get(it.id) || 0;
    return {
      ...it,
      estimate: est,
      paid: pd,
      outstanding: Math.max(0, est - pd),
      over: Math.max(0, pd - est),
      payCount: count.get(it.id) || 0,
    };
  });
}

const total = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

/* A payer's colour is fixed the first time they pay and never moves after —
   filtering the view must never repaint the people who survive it. */
function payerOrder() {
  const first = new Map();
  for (const p of state.payments) {
    const name = p.payer || 'Unrecorded';
    const prev = first.get(name);
    if (!prev || (p.date && p.date < prev)) first.set(name, p.date || '9999-12-31');
  }
  return [...first.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0].localeCompare(b[0])))
    .map(([name]) => name);
}

/* Which step of the sequential ramp a value lands on. Step 1 is nearest the
   surface, step 6 furthest — "more is darker" on light, "more is brighter" on
   dark, each selected for its own surface in the stylesheet. */
function heatStep(value, max) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(HEAT_STEPS, Math.max(1, Math.ceil((value / max) * HEAT_STEPS)));
}

function payerTotals(payments) {
  const map = new Map();
  for (const p of payments) {
    const name = p.payer || 'Unrecorded';
    const e = map.get(name) || { name, total: 0, count: 0 };
    e.total += Number(p.amount) || 0;
    e.count++;
    map.set(name, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/* ── Chart primitives ────────────────────────────────────────────────────── */

const ROW_H = 30;
const BAR_H = 14;
const AXIS_BAND = 26;
const TOP_PAD = 8;

function barPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  if (rr <= 0.5) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y}h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 ${-rr},${rr}h${-(w - rr)}z`;
}

function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = 0; v <= max + step * 1e-6; v += step) out.push(v);
  return out;
}

function emptyChart(host, message) {
  host.textContent = '';
  host.append(el('p', 'chart-empty', message));
}

/* A category label in the left gutter: truncated to fit, with the full string
   kept in a <title> so nothing is lost to the ellipsis. */
function gutterLabel(text, gutter, cy) {
  const node = sv('text', { class: 'cat-text', x: gutter - 10, y: cy + 4, 'text-anchor': 'end' });
  node.textContent = truncate(text, gutter - 16);
  const t = sv('title');
  t.textContent = text;
  node.append(t);
  return node;
}

/* Value labels ride outside the bar end, so the room they need is reserved up
   front — never letting one spill past the edge of the chart. */
function reserveRight(labels, width) {
  const widest = labels.reduce((m, s) => Math.max(m, textWidth(s)), 0);
  return Math.min(Math.round(widest) + 12, Math.round(width * 0.38));
}

/* Vertical gridlines + an x-axis of money ticks, drawn once per bar chart. */
function drawXAxis(g, x0, plotW, plotH, max) {
  const ticks = niceTicks(max);
  for (const t of ticks) {
    const x = x0 + (max > 0 ? (t / max) * plotW : 0);
    g.append(sv('line', { class: 'grid-line', x1: x, y1: TOP_PAD, x2: x, y2: plotH }));
    const label = sv('text', { class: 'axis-text', x, y: plotH + 16, 'text-anchor': t === 0 ? 'start' : 'middle' });
    label.textContent = fmtShort(t);
    g.append(label);
  }
}

/* ── Chart: budget vs paid, per item ─────────────────────────────────────── */

function renderItemsChart() {
  const host = $('#chart-items');
  const rows = rollUp(slice()).sort((a, b) => (b.outstanding - a.outstanding) || (b.estimate - a.estimate));

  $('#items-sub').textContent = sliceLabel();

  if (!rows.length) {
    emptyChart(host, state.items.length ? 'No items match these filters.' : 'No budget items yet.');
    return;
  }

  const width = Math.max(320, host.clientWidth || 640);
  const max = Math.max(...rows.map((r) => Math.max(r.estimate, r.paid)), 1);

  // The warning glyph is measured with the label, or the row that needs it most
  // is the one that gets truncated.
  const valueLabels = rows.map((r) => `${r.over > 0 ? '⚠ ' : ''}${fmtShort(r.paid)} of ${fmtShort(r.estimate)}`);
  const rightPad = reserveRight(valueLabels, width);
  const gutter = Math.min(200, Math.max(96, Math.round(width * 0.26)));
  const plotW = Math.max(60, width - gutter - rightPad);
  const plotH = TOP_PAD + rows.length * ROW_H;
  const height = plotH + AXIS_BAND;

  host.textContent = '';
  const svg = sv('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  svg.setAttribute('aria-label', `Budget versus paid across ${plural(rows.length, 'item', 'items')}`);

  drawXAxis(svg, gutter, plotW, plotH, max);

  rows.forEach((r, i) => {
    const y = TOP_PAD + i * ROW_H;
    const barY = y + (ROW_H - BAR_H) / 2;
    const estW = (r.estimate / max) * plotW;
    const paidW = (r.paid / max) * plotW;

    const g = sv('g', { class: 'bar-group', tabindex: '0', role: 'button' });
    g.setAttribute('aria-label',
      `${r.name}: ${fmtMoney(r.paid)} paid of ${fmtMoney(r.estimate)} estimated, ${Math.round(pct(r.paid, r.estimate))} percent`
      + (r.over ? `, ${fmtMoney(r.over)} over budget` : '') + '. Record a payment.');

    // Hit area spans the whole row, so the target is never the bar's 14px.
    g.append(sv('rect', { class: 'row-hit', x: 0, y, width, height: ROW_H }));

    // The track is the estimate — a lighter step of the same ramp as the fill.
    if (estW > 0.5) g.append(sv('path', { class: 'track', d: barPath(gutter, barY, Math.max(2, estW), BAR_H, 4) }));

    if (paidW > 0.5) {
      g.append(sv('path', {
        class: r.over > 0 ? 'fill-over' : 'fill-paid',
        d: barPath(gutter, barY, Math.max(2, paidW), BAR_H, 4),
      }));
    }

    g.append(gutterLabel(r.name, gutter, y + ROW_H / 2));

    const val = sv('text', {
      class: r.over > 0 ? 'value-text is-over' : 'value-text',
      x: gutter + Math.max(estW, paidW) + 8,
      y: y + ROW_H / 2 + 4,
    });
    val.textContent = truncate(valueLabels[i], rightPad - 10);
    g.append(val);

    const enter = (e) => showTooltip(e, itemTip(r));
    g.addEventListener('mouseenter', enter);
    g.addEventListener('mousemove', moveTooltip);
    g.addEventListener('mouseleave', hideTooltip);
    g.addEventListener('focus', () => showTooltipAt(g, itemTip(r)));
    g.addEventListener('blur', hideTooltip);
    g.addEventListener('click', () => openPayment(null, r.id));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPayment(null, r.id); }
    });

    svg.append(g);
  });

  host.append(svg);
}

function itemTip(r) {
  const lines = [
    `${fmtMoney(r.paid)} paid of ${fmtMoney(r.estimate)}`,
    r.over > 0
      ? { warn: true, text: `${fmtMoney(r.over)} over budget` }
      : `${fmtMoney(r.outstanding)} still to pay · ${Math.round(pct(r.paid, r.estimate))}% funded`,
    `${plural(r.payCount, 'payment', 'payments')} · ${r.category}`,
  ];
  return { title: r.name, lines };
}

/* ── Chart: contributions by person ──────────────────────────────────────── */

function renderPayersChart() {
  const host = $('#chart-payers');
  const view = slice();
  const rows = payerTotals(view.payments);
  const grand = rows.reduce((t, r) => t + r.total, 0);

  $('#payers-sub').textContent = rows.length ? plural(rows.length, 'person', 'people') : '';

  if (!rows.length) {
    emptyChart(host, 'No payments recorded yet.');
    return;
  }

  const width = Math.max(280, host.clientWidth || 420);
  const max = Math.max(...rows.map((r) => r.total), 1);
  const valueLabels = rows.map((r) => `${fmtShort(r.total)} · ${Math.round(pct(r.total, grand))}%`);
  const rightPad = reserveRight(valueLabels, width);
  const gutter = Math.min(170, Math.max(84, Math.round(width * 0.3)));
  const plotW = Math.max(50, width - gutter - rightPad);
  const plotH = TOP_PAD + rows.length * ROW_H;
  const height = plotH + AXIS_BAND;

  host.textContent = '';
  const svg = sv('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  svg.setAttribute('aria-label', `Amount contributed by each of ${plural(rows.length, 'person', 'people')}`);

  drawXAxis(svg, gutter, plotW, plotH, max);

  rows.forEach((r, i) => {
    const y = TOP_PAD + i * ROW_H;
    const barY = y + (ROW_H - BAR_H) / 2;
    const w = Math.max(2, (r.total / max) * plotW);

    const g = sv('g', { class: 'bar-group', tabindex: '0', role: 'button' });
    g.setAttribute('aria-label',
      `${r.name} contributed ${fmtMoney(r.total)}, ${Math.round(pct(r.total, grand))} percent, across ${plural(r.count, 'payment', 'payments')}. Filter by this person.`);
    g.append(sv('rect', { class: 'row-hit', x: 0, y, width, height: ROW_H }));
    // One series, one colour — the bar's length already carries the magnitude.
    g.append(sv('path', { class: 'fill-paid', d: barPath(gutter, barY, w, BAR_H, 4) }));

    g.append(gutterLabel(r.name, gutter, y + ROW_H / 2));

    const val = sv('text', { class: 'value-text', x: gutter + w + 8, y: y + ROW_H / 2 + 4 });
    val.textContent = truncate(valueLabels[i], rightPad - 10);
    g.append(val);

    const tip = { title: r.name, lines: [
      `${fmtMoney(r.total)} · ${pct(r.total, grand).toFixed(1)}% of everything paid`,
      `${plural(r.count, 'payment', 'payments')} · ${fmtMoney(r.total / r.count)} average`,
    ] };
    g.addEventListener('mouseenter', (e) => showTooltip(e, tip));
    g.addEventListener('mousemove', moveTooltip);
    g.addEventListener('mouseleave', hideTooltip);
    g.addEventListener('focus', () => showTooltipAt(g, tip));
    g.addEventListener('blur', hideTooltip);
    const toggle = () => {
      state.filters.payer = state.filters.payer === r.name ? '' : r.name;
      $('#f-payer').value = state.filters.payer;
      renderAll();
    };
    g.addEventListener('click', toggle);
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    svg.append(g);
  });

  host.append(svg);
}

/* ── Chart: who paid for what ────────────────────────────────────────────── */

const HEAT_CELL_H = 26;
const HEAT_ROW_H = 30;
const HEAT_HEAD_H = 24;
const HEAT_MIN_COL = 74;

function renderSplitChart() {
  const host = $('#chart-split');
  const note = $('#split-note');
  const view = slice();
  const map = itemById();

  // A cell per (item, person). Columns follow the order people first paid in,
  // so a column never moves as more payments arrive.
  const cols = payerOrder().filter((name) => view.payments.some((p) => (p.payer || 'Unrecorded') === name));
  const byItem = new Map();
  for (const p of view.payments) {
    if (!byItem.has(p.itemId)) byItem.set(p.itemId, new Map());
    const seg = byItem.get(p.itemId);
    const name = p.payer || 'Unrecorded';
    seg.set(name, (seg.get(name) || 0) + (Number(p.amount) || 0));
  }

  const rows = [...byItem.entries()]
    .map(([itemId, seg]) => {
      const it = map.get(itemId);
      return {
        name: it ? it.name : 'Unknown',
        cells: cols.map((name) => ({ name, amount: seg.get(name) || 0 })),
        total: [...seg.values()].reduce((t, v) => t + v, 0),
      };
    })
    .sort((a, b) => b.total - a.total);

  const skipped = view.items.length - rows.length;
  note.hidden = skipped <= 0;
  if (skipped > 0) {
    note.textContent = `${plural(skipped, 'item has', 'items have')} no payments yet, so no row here — every item is in the table below.`;
  }

  $('#split-sub').textContent = rows.length
    ? `${plural(rows.length, 'item', 'items')} · ${plural(cols.length, 'person', 'people')}`
    : '';

  if (!rows.length || !cols.length) {
    $('#split-legend').textContent = '';
    emptyChart(host, 'No payments recorded yet.');
    return;
  }

  const maxCell = Math.max(...rows.flatMap((r) => r.cells.map((c) => c.amount)), 1);
  renderHeatLegend(maxCell);

  const avail = Math.max(320, host.clientWidth || 640);
  const gutter = Math.min(200, Math.max(96, Math.round(avail * 0.24)));
  const totalW = Math.max(58, Math.round(reserveRight(rows.map((r) => fmtShort(r.total)), avail)));
  // Columns keep a floor width so labels stay readable; the panel scrolls if
  // there are more relatives than fit.
  const colW = Math.max(HEAT_MIN_COL, Math.floor((avail - gutter - totalW) / cols.length));
  const width = gutter + colW * cols.length + totalW;
  const height = HEAT_HEAD_H + rows.length * HEAT_ROW_H + 6;

  host.textContent = '';
  const svg = sv('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  svg.setAttribute('aria-label',
    `Grid of how much each of ${plural(cols.length, 'person', 'people')} has paid towards each of ${plural(rows.length, 'item', 'items')}`);

  cols.forEach((name, ci) => {
    const x = gutter + ci * colW + colW / 2;
    const head = sv('text', { class: 'axis-text head-text', x, y: HEAT_HEAD_H - 8, 'text-anchor': 'middle' });
    head.textContent = truncate(name, colW - 8);
    const t = sv('title');
    t.textContent = name;
    head.append(t);
    svg.append(head);
  });

  const totalHead = sv('text', { class: 'axis-text head-text', x: width, y: HEAT_HEAD_H - 8, 'text-anchor': 'end' });
  totalHead.textContent = 'Total';
  svg.append(totalHead);

  rows.forEach((r, ri) => {
    const y = HEAT_HEAD_H + ri * HEAT_ROW_H;
    const cy = y + HEAT_ROW_H / 2;
    const g = sv('g');

    g.append(gutterLabel(r.name, gutter, cy));

    r.cells.forEach((c, ci) => {
      // 2px of surface on every side is what separates touching cells.
      const x = gutter + ci * colW + 1;
      const w = colW - 2;
      const step = heatStep(c.amount, maxCell);
      const rect = sv('rect', {
        class: `heat-cell heat-${step}`,
        x, y: y + (HEAT_ROW_H - HEAT_CELL_H) / 2,
        width: w, height: HEAT_CELL_H, rx: 4,
      });
      if (c.amount > 0) {
        rect.setAttribute('tabindex', '0');
        rect.setAttribute('role', 'img');
        rect.setAttribute('aria-label',
          `${c.name} paid ${fmtMoney(c.amount)} towards ${r.name}, ${Math.round(pct(c.amount, r.total))} percent of what that item has received.`);
        const tip = { title: `${c.name} → ${r.name}`, lines: [
          fmtMoney(c.amount),
          `${pct(c.amount, r.total).toFixed(0)}% of the ${fmtMoney(r.total)} paid on this item`,
        ] };
        rect.addEventListener('mouseenter', (e) => showTooltip(e, tip));
        rect.addEventListener('mousemove', moveTooltip);
        rect.addEventListener('mouseleave', hideTooltip);
        rect.addEventListener('focus', () => showTooltipAt(rect, tip));
        rect.addEventListener('blur', hideTooltip);
      }
      g.append(rect);

      // The value goes in the cell only when it genuinely fits; otherwise the
      // tooltip and the table carry it. Ink or white, by the fill's lightness.
      if (c.amount > 0) {
        const label = fmtShort(c.amount);
        if (textWidth(label) <= w - 10) {
          const txt = sv('text', {
            class: `heat-label heat-label-${step}`, x: x + w / 2, y: cy + 4, 'text-anchor': 'middle',
          });
          txt.textContent = label;
          g.append(txt);
        }
      }
    });

    const tot = sv('text', { class: 'value-text', x: width, y: cy + 4, 'text-anchor': 'end' });
    tot.textContent = fmtShort(r.total);
    g.append(tot);

    svg.append(g);
  });

  host.append(svg);
}

/* A sequential scale always ships its legend — colour is the only channel here. */
function renderHeatLegend(maxCell) {
  const host = $('#split-legend');
  host.textContent = '';
  host.append(el('span', 'scale-label', 'Less paid'));
  const ramp = el('span', 'scale-ramp');
  for (let s = 1; s <= HEAT_STEPS; s++) {
    const sw = el('span', `scale-step heat-${s}`);
    ramp.append(sw);
  }
  host.append(ramp);
  host.append(el('span', 'scale-label', `More · up to ${fmtShort(maxCell)}`));
}

/* ── Chart: funding over time ────────────────────────────────────────────── */

function renderTimeChart() {
  const host = $('#chart-time');
  const view = slice();
  const dated = view.payments.filter((p) => p.date).sort((a, b) => (a.date < b.date ? -1 : 1));

  $('#time-sub').textContent = dated.length ? 'Cumulative' : '';

  if (dated.length < 2) {
    emptyChart(host, dated.length ? 'One payment so far — the trend needs at least two.' : 'No dated payments yet.');
    return;
  }

  // Collapse to one point per day, then run the total forward.
  const perDay = [];
  for (const p of dated) {
    const last = perDay[perDay.length - 1];
    if (last && last.date === p.date) last.amount += Number(p.amount) || 0;
    else perDay.push({ date: p.date, amount: Number(p.amount) || 0 });
  }
  let run = 0;
  const pts = perDay.map((d) => ({ date: d.date, t: Date.parse(d.date), day: d.amount, y: (run += d.amount) }));

  const budget = total(rollUp(view), 'estimate');
  const width = Math.max(280, host.clientWidth || 420);
  const padL = 58;
  const padR = 18;
  const padT = 14;
  const padB = 26;
  const plotH = 190;
  const height = plotH + padT + padB;
  const plotW = Math.max(60, width - padL - padR);

  const maxY = Math.max(pts[pts.length - 1].y, budget, 1);
  const ticks = niceTicks(maxY);
  // A little headroom, so the budget line and its label never sit on the edge.
  const yMax = Math.max(ticks[ticks.length - 1], maxY * 1.06);
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const span = Math.max(1, t1 - t0);

  const X = (t) => padL + ((t - t0) / span) * plotW;
  const Y = (v) => padT + plotH - (v / yMax) * plotH;

  host.textContent = '';
  const svg = sv('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  svg.setAttribute('aria-label',
    `Cumulative amount paid from ${fmtDate(pts[0].date)} to ${fmtDate(pts[pts.length - 1].date)}, reaching ${fmtMoney(pts[pts.length - 1].y)}`);

  for (const t of ticks) {
    const y = Y(t);
    svg.append(sv('line', { class: 'grid-line', x1: padL, y1: y, x2: padL + plotW, y2: y }));
    const lab = sv('text', { class: 'axis-text', x: padL - 8, y: y + 4, 'text-anchor': 'end' });
    lab.textContent = fmtShort(t);
    svg.append(lab);
  }

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  svg.append(sv('path', {
    class: 'area-fill',
    d: `${line}L${X(t1).toFixed(1)},${Y(0).toFixed(1)}L${X(t0).toFixed(1)},${Y(0).toFixed(1)}Z`,
  }));
  svg.append(sv('path', { class: 'area-line', d: line }));

  // The budget is a threshold, not a gridline — dashed, and always labelled.
  if (budget > 0 && budget <= yMax) {
    const by = Y(budget);
    svg.append(sv('line', { class: 'threshold', x1: padL, y1: by, x2: padL + plotW, y2: by }));
    const lab = sv('text', { class: 'threshold-text', x: padL + plotW, y: by - 6, 'text-anchor': 'end' });
    lab.textContent = `Budget ${fmtShort(budget)}`;
    svg.append(lab);
  }

  for (const p of [pts[0], pts[pts.length - 1]]) {
    svg.append(sv('circle', { class: 'end-dot', cx: X(p.t), cy: Y(p.y), r: 5 }));
  }
  const endLab = sv('text', { class: 'value-text', x: X(t1), y: Y(pts[pts.length - 1].y) - 12, 'text-anchor': 'end' });
  endLab.textContent = fmtShort(pts[pts.length - 1].y);
  svg.append(endLab);

  for (const [i, p] of [[0, pts[0]], [1, pts[pts.length - 1]]]) {
    const lab = sv('text', { class: 'axis-text', x: X(p.t), y: height - 8, 'text-anchor': i ? 'end' : 'start' });
    lab.textContent = fmtDate(p.date);
    svg.append(lab);
  }

  /* Crosshair — the value at any date, without hunting for a 5px dot. */
  const cross = sv('line', { class: 'crosshair', y1: padT, y2: padT + plotH, x1: padL, x2: padL, opacity: 0 });
  const hoverDot = sv('circle', { class: 'hover-dot', r: 5, opacity: 0, cx: padL, cy: padT });
  svg.append(cross, hoverDot);

  const hit = sv('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' });
  hit.addEventListener('mousemove', (e) => {
    const box = svg.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = pts[0];
    let bestD = Infinity;
    for (const p of pts) {
      const d = Math.abs(X(p.t) - px);
      if (d < bestD) { bestD = d; best = p; }
    }
    cross.setAttribute('x1', X(best.t));
    cross.setAttribute('x2', X(best.t));
    cross.setAttribute('opacity', 1);
    hoverDot.setAttribute('cx', X(best.t));
    hoverDot.setAttribute('cy', Y(best.y));
    hoverDot.setAttribute('opacity', 1);
    showTooltip(e, { title: fmtDate(best.date), lines: [
      `${fmtMoney(best.y)} paid in total by this date`,
      `${fmtMoney(best.day)} paid on the day`,
      budget > 0 ? `${Math.round(pct(best.y, budget))}% of the ${fmtShort(budget)} budget` : null,
    ].filter(Boolean) });
  });
  hit.addEventListener('mouseleave', () => {
    cross.setAttribute('opacity', 0);
    hoverDot.setAttribute('opacity', 0);
    hideTooltip();
  });
  svg.append(hit);

  host.append(svg);
}

/* ── Render: hero + tiles ────────────────────────────────────────────────── */

function sliceLabel() {
  const bits = [];
  if (state.filters.category) bits.push(state.filters.category);
  if (state.filters.payer) bits.push(`paid by ${state.filters.payer}`);
  if (state.filters.search) bits.push(`matching “${state.filters.search.trim()}”`);
  return bits.length ? bits.join(' · ') : 'Everything';
}

function renderHero() {
  const view = slice();
  const rows = rollUp(view);
  const budget = total(rows, 'estimate');
  const paid = total(rows, 'paid');
  const outstanding = Math.max(0, budget - paid);
  const over = Math.max(0, paid - budget);
  const byPayer = !!state.filters.payer;

  const allPaid = state.payments.reduce((t, p) => t + (Number(p.amount) || 0), 0);
  const share = byPayer ? pct(paid, allPaid) : pct(paid, budget);

  $('#hero-label').textContent = byPayer ? `Paid by ${state.filters.payer}` : 'Paid so far';
  $('#hero-paid').textContent = fmtMoneyRound(paid);
  $('#hero-sub').textContent = byPayer
    ? `${share.toFixed(0)}% of everything paid · across ${plural(rows.length, 'item', 'items')}`
    : `of ${fmtMoneyRound(budget)} budgeted across ${plural(rows.length, 'item', 'items')}`;

  const fill = $('#hero-fill');
  fill.style.width = `${Math.min(100, Math.max(paid > 0 ? 1.5 : 0, share))}%`;
  fill.classList.toggle('is-over', over > 0);
  $('#hero-scale-end').textContent = byPayer ? fmtShort(allPaid) : fmtShort(budget);
  $('#hero-legend-over').hidden = over <= 0;
  $('#hero-meter').setAttribute('role', 'img');
  $('#hero-meter').setAttribute('aria-label',
    byPayer
      ? `${fmtMoney(paid)} of the ${fmtMoney(allPaid)} paid in total`
      : `${fmtMoney(paid)} paid of ${fmtMoney(budget)} budgeted, ${Math.round(share)} percent`);

  $('#fact-budget').textContent = fmtShort(budget);
  $('#fact-outstanding').textContent = over > 0 ? `${fmtShort(over)} over` : fmtShort(outstanding);
  $('#fact-outstanding').classList.toggle('is-over', over > 0);
  $('#fact-pct').textContent = budget > 0 ? `${Math.round(pct(paid, budget))}%` : '—';
  $('#fact-count').textContent = String(view.payments.length);
}

function renderTiles() {
  const view = slice();
  const rows = rollUp(view);

  const gap = rows.slice().sort((a, b) => b.outstanding - a.outstanding)[0];
  if (gap && gap.outstanding > 0) {
    $('#kpi-gap').textContent = gap.name;
    $('#kpi-gap-foot').textContent = `${fmtShort(gap.outstanding)} still to pay · ${Math.round(pct(gap.paid, gap.estimate))}% funded`;
  } else {
    $('#kpi-gap').textContent = rows.length ? 'Nothing outstanding' : '—';
    $('#kpi-gap-foot').textContent = rows.length ? 'Every item is fully paid' : 'Add a budget item to begin';
  }

  const payers = payerTotals(view.payments);
  const grand = payers.reduce((t, p) => t + p.total, 0);
  if (payers.length) {
    $('#kpi-payer').textContent = payers[0].name;
    $('#kpi-payer-foot').textContent = `${fmtShort(payers[0].total)} · ${Math.round(pct(payers[0].total, grand))}% of all payments`;
  } else {
    $('#kpi-payer').textContent = '—';
    $('#kpi-payer-foot').textContent = 'No payments recorded';
  }

  const settled = rows.filter((r) => r.estimate > 0 && r.paid >= r.estimate).length;
  const overCount = rows.filter((r) => r.over > 0).length;
  $('#kpi-settled').textContent = rows.length ? `${settled} / ${rows.length}` : '—';
  $('#kpi-settled-foot').textContent = overCount
    ? `⚠ ${plural(overCount, 'item is', 'items are')} over budget`
    : (rows.length ? 'items paid in full' : 'No items yet');
  $('#kpi-settled-foot').classList.toggle('is-over', overCount > 0);

  const last = view.payments.filter((p) => p.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (last) {
    const it = itemById().get(last.itemId);
    $('#kpi-last').textContent = fmtShort(last.amount);
    $('#kpi-last-foot').textContent = `${last.payer} · ${it ? it.name : '—'} · ${fmtDate(last.date)}`;
  } else {
    $('#kpi-last').textContent = '—';
    $('#kpi-last-foot').textContent = 'Nothing recorded yet';
  }
}

/* ── Render: tables ──────────────────────────────────────────────────────── */

function sortRows(rows, sort) {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    let d;
    if (typeof av === 'number' && typeof bv === 'number') d = av - bv;
    else d = String(av ?? '').localeCompare(String(bv ?? ''));
    if (d === 0) d = String(a.id).localeCompare(String(b.id));
    return d * sign;
  });
}

function renderItemsTable() {
  const tbody = $('#rows-items');
  tbody.textContent = '';
  const view = slice();
  const rows = sortRows(rollUp(view), state.itemSort);
  const paysByItem = new Map();
  for (const p of view.payments) {
    if (!paysByItem.has(p.itemId)) paysByItem.set(p.itemId, []);
    paysByItem.get(p.itemId).push(p);
  }

  $('#count-items').textContent = String(rows.length);
  $('#foot-estimate').textContent = fmtMoney(total(rows, 'estimate'));
  $('#foot-paid').textContent = fmtMoney(total(rows, 'paid'));
  $('#foot-outstanding').textContent = fmtMoney(total(rows, 'outstanding'));

  const empty = $('#empty-items');
  if (!rows.length) {
    empty.hidden = false;
    empty.textContent = '';
    if (state.items.length) {
      empty.append(el('strong', null, 'No items match these filters'),
        el('span', null, 'Try clearing the category, person, or search filter.'));
    } else {
      empty.append(el('strong', null, 'No budget items yet'),
        el('span', null, 'Add what the wedding is expected to cost — hall, catering, decoration — then record payments against each.'));
      if (cfg.starterItems.length) {
        const b = el('button', 'btn btn-primary', `Create ${cfg.starterItems.length} typical items`);
        b.type = 'button';
        b.style.marginTop = '14px';
        b.addEventListener('click', createStarterItems);
        empty.append(b);
      }
    }
  } else {
    empty.hidden = true;
  }

  for (const r of rows) {
    const tr = el('tr');
    const open = state.expanded.has(r.id);
    const pays = paysByItem.get(r.id) || [];

    const tog = el('td', 'col-toggle');
    if (pays.length) {
      const b = el('button', 'icon-btn icon-btn-sm disclose', open ? '▾' : '▸');
      b.type = 'button';
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      b.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the ${plural(pays.length, 'payment', 'payments')} on ${r.name}`);
      b.addEventListener('click', () => {
        if (open) state.expanded.delete(r.id); else state.expanded.add(r.id);
        renderItemsTable();
      });
      tog.append(b);
    }
    tr.append(tog);

    const nameCell = el('td', 'cell-desc');
    nameCell.append(document.createTextNode(r.name));
    if (r.notes) nameCell.append(el('span', 'cell-notes', r.notes));
    tr.append(nameCell);

    const cat = el('td');
    cat.append(el('span', 'tag', r.category));
    tr.append(cat);

    tr.append(el('td', 'num', fmtMoney(r.estimate)));

    const paidCell = el('td', 'num');
    paidCell.append(document.createTextNode(fmtMoney(r.paid)));
    paidCell.append(el('span', 'cell-sub', `${Math.round(pct(r.paid, r.estimate))}%`));
    tr.append(paidCell);

    const outCell = el('td', 'num cell-amount');
    if (r.over > 0) {
      outCell.append(el('span', 'over-flag', `⚠ ${fmtMoney(r.over)} over`));
    } else {
      outCell.append(document.createTextNode(fmtMoney(r.outstanding)));
    }
    tr.append(outCell);

    const act = el('td', 'col-actions');
    const box = el('div', 'row-actions');
    box.append(
      iconBtn('₹', `Record a payment towards ${r.name}`, () => openPayment(null, r.id)),
      iconBtn('✎', `Edit ${r.name}`, () => openItem(r)),
      iconBtn('🗑', `Delete ${r.name}`, () => confirmDeleteItem(r)),
    );
    act.append(box);
    tr.append(act);
    tbody.append(tr);

    if (open) {
      for (const p of pays.slice().sort((a, b) => (a.date < b.date ? 1 : -1))) {
        const sub = el('tr', 'subrow');
        sub.append(el('td'));
        const who = el('td');
        who.setAttribute('colspan', '2');
        who.append(el('span', 'sub-date', fmtDate(p.date)), document.createTextNode(` · ${p.payer}`));
        if (p.method) who.append(el('span', 'cell-sub', p.method));
        sub.append(who);
        const amt = el('td', 'num');
        amt.setAttribute('colspan', '3');
        amt.textContent = fmtMoney(p.amount);
        sub.append(amt);
        const a = el('td', 'col-actions');
        const bx = el('div', 'row-actions');
        bx.append(
          iconBtn('✎', `Edit this payment by ${p.payer}`, () => openPayment(p)),
          iconBtn('🗑', `Delete this payment by ${p.payer}`, () => confirmDeletePayment(p)),
        );
        a.append(bx);
        sub.append(a);
        tbody.append(sub);
      }
    }
  }
}

function renderPaymentsTable() {
  const tbody = $('#rows-payments');
  tbody.textContent = '';
  const view = slice();
  const map = itemById();
  const rows = sortRows(view.payments, state.paySort);

  $('#count-pay').textContent = String(rows.length);
  $('#count-pay-all').textContent = String(state.payments.length);
  $('#foot-pay-total').textContent = fmtMoney(rows.reduce((t, p) => t + (Number(p.amount) || 0), 0));

  const empty = $('#empty-payments');
  if (!rows.length) {
    empty.hidden = false;
    empty.textContent = '';
    if (state.payments.length) {
      empty.append(el('strong', null, 'No payments match these filters'),
        el('span', null, 'Try clearing the category, person, or search filter.'));
    } else {
      empty.append(el('strong', null, 'No payments yet'),
        el('span', null, state.items.length
          ? 'Record what has actually been handed over — press N for a shortcut.'
          : 'Add a budget item first, then record payments against it.'));
    }
  } else {
    empty.hidden = true;
  }

  for (const p of rows) {
    const it = map.get(p.itemId);
    const tr = el('tr');
    tr.append(el('td', 'cell-date', fmtDate(p.date)));

    const itemCell = el('td', 'cell-desc');
    itemCell.append(document.createTextNode(it ? it.name : '—'));
    if (p.notes) itemCell.append(el('span', 'cell-notes', p.notes));
    tr.append(itemCell);

    const who = el('td');
    who.append(el('span', 'tag', p.payer));
    tr.append(who);

    tr.append(el('td', 'method col-method', p.method || '—'));
    tr.append(el('td', 'num cell-amount', fmtMoney(p.amount)));

    const act = el('td', 'col-actions');
    const box = el('div', 'row-actions');
    box.append(
      iconBtn('✎', `Edit this payment by ${p.payer}`, () => openPayment(p)),
      iconBtn('🗑', `Delete this payment by ${p.payer}`, () => confirmDeletePayment(p)),
    );
    act.append(box);
    tr.append(act);
    tbody.append(tr);
  }
}

function iconBtn(glyph, label, onClick) {
  const b = el('button', 'icon-btn icon-btn-sm', glyph);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

/* ── Render: filters & tabs ──────────────────────────────────────────────── */

function renderFilterOptions() {
  const cats = [...new Set([...state.items.map((it) => it.category || 'Miscellaneous'), ...cfg.categories])].sort();
  fillFilter($('#f-category'), cats, 'All categories', 'category');

  const payers = payerOrder();
  fillFilter($('#f-payer'), payers, 'Everyone', 'payer');

  const list = $('#payer-list');
  list.textContent = '';
  for (const name of [...new Set([...cfg.payers, ...payers])]) {
    const o = el('option');
    o.value = name;
    list.append(o);
  }
}

function fillFilter(sel, values, allLabel, key) {
  const keep = state.filters[key];
  sel.textContent = '';
  const all = el('option', null, allLabel);
  all.value = '';
  sel.append(all);
  for (const v of values) {
    const o = el('option', null, v);
    o.value = v;
    sel.append(o);
  }
  sel.value = values.includes(keep) ? keep : '';
  state.filters[key] = sel.value;
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.setAttribute('aria-selected', t.dataset.tab === state.tab ? 'true' : 'false');
  });
  $('#pane-items').hidden = state.tab !== 'items';
  $('#pane-payments').hidden = state.tab !== 'payments';
}

function renderSortIndicators() {
  document.querySelectorAll('#pane-items th.sortable').forEach((th) => {
    if (th.dataset.sort === state.itemSort.key) th.dataset.dir = state.itemSort.dir;
    else delete th.dataset.dir;
  });
  document.querySelectorAll('#pane-payments th.sortable').forEach((th) => {
    if (th.dataset.sort === state.paySort.key) th.dataset.dir = state.paySort.dir;
    else delete th.dataset.dir;
  });
}

function renderCharts() {
  renderItemsChart();
  renderPayersChart();
  renderTimeChart();
  renderSplitChart();
}

function renderAll() {
  renderFilterOptions();
  renderHero();
  renderTiles();
  renderCharts();
  renderTabs();
  renderItemsTable();
  renderPaymentsTable();
  renderSortIndicators();
  renderSync();
}

/* ── Sync status ─────────────────────────────────────────────────────────── */

function setSync(kind, note = '') {
  state.sync = kind;
  state.syncNote = note;
  renderSync();
}

/* What "saved" means depends on where the workbook lives, so the pill says
   where — a wedding budget you believe is saved but is not would be the worst
   failure this app could have. */
const SAVED_LABEL = {
  file: () => (state.fileName ? `Saved to ${state.fileName}` : 'Saved to file'),
  browser: () => 'Saved in this browser',
  github: () => 'Saved to repo',
};

const BLOCKED_LABEL = {
  permission: 'Reconnect file',
  nofile: 'Choose a file',
  notoken: 'Read-only',
};

function renderSync() {
  const pill = $('#sync-pill');
  const text = $('#sync-text');
  const pending = queue.length;
  pill.dataset.state = state.sync;

  const savedFor = SAVED_LABEL[state.mode] || SAVED_LABEL.browser;
  const label = {
    loading: 'Loading…',
    ok: savedFor(),
    saving: pending > 1 ? `Saving ${pending} changes…` : 'Saving…',
    error: 'Save failed — retry',
    blocked: BLOCKED_LABEL[state.blocked] || 'Not saving',
  }[state.sync] || state.sync;

  text.textContent = pending && state.sync === 'blocked' ? `${label} · ${pending} unsaved` : label;

  const where = {
    file: () => (state.fileName ? `Workbook: ${state.fileName}` : 'No workbook chosen yet'),
    browser: () => 'Stored in this browser only — export a copy to keep it safe',
    github: () => `${cfg.owner || '?'}/${cfg.repo || '?'} · ${cfg.branch}`,
  }[state.mode];
  pill.title = state.syncNote || (where ? where() : '');
}

/* ── Toasts & tooltip ────────────────────────────────────────────────────── */

function toast(kind, message, ms = 5000) {
  const t = el('div', 'toast');
  t.dataset.kind = kind;
  t.append(el('span', null, message));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

function fillTooltip(spec) {
  const tip = $('#tooltip');
  tip.textContent = '';
  const head = el('div');
  head.append(el('b', null, spec.title));
  tip.append(head);
  for (const line of spec.lines) {
    if (!line) continue;
    if (typeof line === 'string') tip.append(el('div', 't-row', line));
    else tip.append(el('div', `t-row${line.warn ? ' t-warn' : ''}`, `${line.warn ? '⚠ ' : ''}${line.text}`));
  }
  tip.hidden = false;
}

function showTooltip(e, spec) {
  fillTooltip(spec);
  moveTooltip(e);
}

/* Keyboard focus must show what hover shows, so charts are not mouse-only. */
function showTooltipAt(node, spec) {
  fillTooltip(spec);
  const box = node.getBoundingClientRect();
  placeTooltip(box.left + box.width / 2, box.bottom);
}

function moveTooltip(e) {
  placeTooltip(e.clientX, e.clientY);
}

function placeTooltip(cx, cy) {
  const tip = $('#tooltip');
  if (tip.hidden) return;
  const pad = 14;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let x = cx + pad;
  let y = cy + pad;
  if (x + w > innerWidth - 8) x = cx - w - pad;
  if (y + h > innerHeight - 8) y = cy - h - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() { $('#tooltip').hidden = true; }

/* ── Dialogs ─────────────────────────────────────────────────────────────── */

function fillSelect(sel, values, selected) {
  sel.textContent = '';
  for (const v of values) {
    const o = el('option', null, v);
    o.value = v;
    sel.append(o);
  }
  if (selected && !values.includes(selected)) {
    const o = el('option', null, selected);
    o.value = selected;
    sel.append(o);
  }
  sel.value = selected || values[0] || '';
}

function openItem(row) {
  state.editingItem = row || null;
  const f = $('#form-item');
  const cats = [...new Set([...cfg.categories, ...state.items.map((it) => it.category).filter(Boolean)])];

  $('#item-title').textContent = row ? 'Edit budget item' : 'Add budget item';
  $('#item-submit').textContent = row ? 'Save changes' : 'Add item';
  $('#item-error').hidden = true;

  f.name.value = row ? row.name : '';
  f.estimate.value = row ? row.estimate : '';
  fillSelect($('#item-category'), cats, row ? row.category : (state.filters.category || cfg.categories[0]));
  f.notes.value = row ? row.notes : '';

  $('#dlg-item').showModal();
  setTimeout(() => (row ? f.estimate : f.name).focus(), 30);
}

function submitItem(e) {
  e.preventDefault();
  const f = $('#form-item');
  const err = $('#item-error');
  const name = f.name.value.trim();
  const estimate = Number(f.estimate.value);

  if (!name) return fail('Give the item a name.');
  if (!isFinite(estimate) || estimate < 0) return fail('Enter an estimated cost of zero or more.');

  const row = {
    id: state.editingItem ? state.editingItem.id : newId(),
    name,
    category: f.category.value || 'Miscellaneous',
    estimate: Math.round(estimate * 100) / 100,
    notes: f.notes.value.trim(),
  };

  saveItem(row, !state.editingItem);
  if (!canWrite()) toast('info', 'Showing on screen only — nowhere to save it yet.');
  state.editingItem = null;
  $('#dlg-item').close();

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
  }
}

function openPayment(row, presetItemId) {
  if (!state.items.length) {
    toast('info', 'Add a budget item first — a payment is always recorded against one.');
    openItem(null);
    return;
  }
  state.editingPay = row || null;
  const f = $('#form-pay');

  $('#pay-title').textContent = row ? 'Edit payment' : 'Record a payment';
  $('#pay-submit').textContent = row ? 'Save changes' : 'Add payment';
  $('#pay-error').hidden = true;

  const sel = $('#pay-item');
  sel.textContent = '';
  for (const it of state.items.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const o = el('option', null, `${it.name} · ${fmtShort(it.estimate)}`);
    o.value = it.id;
    sel.append(o);
  }
  sel.value = row ? row.itemId : (presetItemId || sel.options[0].value);

  f.amount.value = row ? row.amount : '';
  f.date.value = row ? row.date : todayISO();
  f.payer.value = row ? row.payer : '';
  fillSelect($('#pay-method'), cfg.methods, row ? row.method : cfg.methods[0]);
  f.notes.value = row ? row.notes : '';

  updatePayContext();
  $('#dlg-pay').showModal();
  setTimeout(() => (row ? f.amount : f.amount).focus(), 30);
}

/* Standing beside the amount field: what this item costs and what is left. */
function updatePayContext() {
  const box = $('#pay-context');
  const id = $('#pay-item').value;
  const it = state.items.find((r) => r.id === id);
  if (!it) { box.hidden = true; return; }
  const paid = state.payments
    .filter((p) => p.itemId === id && (!state.editingPay || p.id !== state.editingPay.id))
    .reduce((t, p) => t + (Number(p.amount) || 0), 0);
  const left = Math.max(0, (Number(it.estimate) || 0) - paid);
  box.textContent = `${it.name}: ${fmtMoney(it.estimate)} estimated · ${fmtMoney(paid)} already paid · ${fmtMoney(left)} still to pay.`;
  box.hidden = false;
}

function submitPayment(e) {
  e.preventDefault();
  const f = $('#form-pay');
  const err = $('#pay-error');
  const itemId = $('#pay-item').value;
  const amount = Number(f.amount.value);
  const date = f.date.value;
  const payer = f.payer.value.trim();

  if (!itemId) return fail('Choose what this payment is towards.');
  if (!isFinite(amount) || amount <= 0) return fail('Enter an amount greater than zero.');
  if (!date) return fail('Pick a date.');
  if (!payer) return fail('Say who paid — that is the point of tracking it.');

  const row = {
    id: state.editingPay ? state.editingPay.id : newId(),
    itemId,
    date,
    amount: Math.round(amount * 100) / 100,
    payer,
    method: f.method.value || '',
    notes: f.notes.value.trim(),
  };

  savePayment(row, !state.editingPay);
  if (!canWrite()) toast('info', 'Showing on screen only — nowhere to save it yet.');
  state.editingPay = null;
  $('#dlg-pay').close();

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
  }
}

function confirmDeleteItem(r) {
  const pays = state.payments.filter((p) => p.itemId === r.id);
  state.pendingDelete = { kind: 'item', id: r.id };
  $('#del-title').textContent = 'Delete this budget item?';
  $('#del-summary').textContent = `${r.name} — ${fmtMoney(r.estimate)} estimated`;
  $('#del-note').textContent = pays.length
    ? `Its ${plural(pays.length, 'payment', 'payments')} (${fmtMoney(pays.reduce((t, p) => t + p.amount, 0))}) will be removed too. This is saved straight away.`
    : 'This removes the row from the workbook and saves straight away.';
  $('#dlg-delete').showModal();
}

function confirmDeletePayment(p) {
  const it = state.items.find((r) => r.id === p.itemId);
  state.pendingDelete = { kind: 'payment', id: p.id };
  $('#del-title').textContent = 'Delete this payment?';
  $('#del-summary').textContent = `${fmtMoney(p.amount)} by ${p.payer} towards ${it ? it.name : 'an item'} on ${fmtDate(p.date)}`;
  $('#del-note').textContent = 'This removes the row from the workbook and saves straight away.';
  $('#dlg-delete').showModal();
}

function openSettings() {
  $('#set-mode').value = state.mode;
  $('#opt-file').disabled = !fileStore.available();
  $('#opt-github').disabled = !githubStore.available();
  $('#set-repo').textContent = cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : 'not detected';
  $('#set-branch').textContent = cfg.branch;
  $('#set-path').textContent = cfg.filePath;
  $('#set-token').value = state.token;
  $('#set-currency').value = cfg.currency;
  $('#set-locale').value = cfg.locale;
  $('#set-error').hidden = true;
  renderModePanels();
  $('#dlg-settings').showModal();
}

/* Only the chosen mode's controls are on screen — the others are noise, and a
   token field visible in file mode is exactly the confusion to avoid. */
function renderModePanels() {
  const mode = $('#set-mode').value;
  $('#panel-file').hidden = mode !== 'file';
  $('#panel-browser').hidden = mode !== 'browser';
  $('#panel-github').hidden = mode !== 'github';

  $('#set-file-name').textContent = state.fileName || 'No file chosen yet';
  $('#set-file-forget').hidden = !state.fileName;

  const unsupported = $('#set-file-unsupported');
  unsupported.hidden = fileStore.available();
}

async function chooseFile(kind) {
  const err = $('#set-error');
  try {
    if (kind === 'new') await fileStore.pickNew();
    else await fileStore.pickExisting();

    setMode('file');
    state.blocked = '';
    err.hidden = true;
    renderModePanels();

    // A brand-new file is empty; an existing one replaces what is on screen.
    const carry = kind === 'new' ? { items: state.items, payments: state.payments } : null;
    if (carry && (carry.items.length || carry.payments.length)) {
      await fileStore.write(carry);
      state.base = carry;
      setSync('ok');
      toast('ok', `Saving to ${state.fileName} from now on.`);
    } else {
      await load();
      toast('ok', `Connected to ${state.fileName}.`);
    }
    showBanner(false);
    if (queue.length) flush();
    renderAll();
  } catch (ex) {
    if (ex && ex.name === 'AbortError') return;      // the picker was dismissed
    err.textContent = ex.message;
    err.hidden = false;
  }
}

async function reconnectFile() {
  const ok = await fileStore.grant();
  if (!ok) {
    toast('error', 'Permission declined — changes cannot be saved to the file.');
    return;
  }
  state.blocked = '';
  showBanner(false);
  await load();
  if (queue.length) flush();
}

async function submitSettings(e) {
  e.preventDefault();
  const err = $('#set-error');
  const btn = $('#set-submit');
  const mode = $('#set-mode').value;
  const token = $('#set-token').value.trim();
  const currency = ($('#set-currency').value.trim() || 'INR').toUpperCase();
  const locale = $('#set-locale').value.trim() || 'en-IN';

  cfg.currency = currency;
  cfg.locale = locale;
  localStorage.setItem(LS.currency, currency);
  localStorage.setItem(LS.locale, locale);
  rebuildFormatters();

  if (mode === 'github') {
    if (!cfg.owner || !cfg.repo) {
      return fail('Repository not detected. Set owner and repo in assets/config.js.');
    }
    if (!token) return fail('A token is required for the GitHub mode — GitHub refuses anonymous writes.');

    btn.disabled = true;
    btn.textContent = 'Verifying…';
    const previous = state.token;
    state.token = token;
    try {
      const res = await gh(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`);
      if (res.status === 404) {
        throw new Error(`Cannot see ${cfg.owner}/${cfg.repo}. Check the token is scoped to that repository.`);
      }
      const repo = await res.json();
      localStorage.setItem(LS.token, token);
      // Reported permissions vary by token type, so this is advisory — the real
      // test is the first save, which reports its own error if write is missing.
      const writable = repo.permissions && repo.permissions.push;
      toast(writable ? 'ok' : 'info',
        writable
          ? 'Token verified — changes will be committed.'
          : 'Token accepted, but write access could not be confirmed. If saving fails, grant Contents: Read and write.');
    } catch (ex) {
      state.token = previous;
      btn.disabled = false;
      btn.textContent = 'Save';
      return fail(ex.message);
    }
    btn.disabled = false;
    btn.textContent = 'Save';
  }

  if (mode === 'file' && !fileStore.handle) {
    return fail('Choose a workbook file first, or pick a different place to keep the data.');
  }

  const switched = mode !== state.mode;
  setMode(mode);
  err.hidden = true;
  $('#dlg-settings').close();

  // Always re-ask the store whether it can write. Staying in the same mode and
  // supplying the missing token is the ordinary case, and only recomputing this
  // on a mode change left it stuck read-only with the token sitting right there.
  state.blocked = await activeStore().restore();

  if (switched) {
    // Carry what is on screen into the new home rather than silently losing it.
    const carry = { items: state.items, payments: state.payments };
    if (canWrite() && (carry.items.length || carry.payments.length)) {
      try {
        await activeStore().write(carry, [{ kind: 'switch' }]);
        state.base = carry;
        setSync('ok');
        toast('ok', `Now keeping the budget in: ${activeStore().label.toLowerCase()}.`);
      } catch (ex) {
        setSync('error', ex.message);
        toast('error', `Could not write to the new location: ${ex.message}`);
      }
    } else {
      await load();
    }
  } else if (canWrite()) {
    await load();                       // newly authorised — read the real thing
  } else {
    setSync('blocked');
  }

  renderBlockedBanner();
  renderAll();
  if (queue.length) flush();

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
  }
}

async function forgetFile() {
  await fileStore.forget();
  state.blocked = 'nofile';
  setSync('blocked');
  renderModePanels();
  toast('info', 'Forgot that file. Choose another to start saving again.');
}

function forgetToken() {
  state.token = '';
  localStorage.removeItem(LS.token);
  $('#set-token').value = '';
  if (state.mode === 'github') {
    state.blocked = 'notoken';
    setSync('blocked');
  }
  toast('info', 'Token removed from this browser.');
}

/* ── Banner ──────────────────────────────────────────────────────────────── */

const BANNER = {
  permission: {
    text: () => `Reconnect ${state.fileName || 'your workbook'} to save changes — browsers ask again each time they restart.`,
    action: 'Reconnect',
    run: reconnectFile,
  },
  nofile: {
    text: () => 'Choose where to keep your budget — a file on this device, or this browser.',
    action: 'Choose',
    run: openSettings,
  },
  notoken: {
    text: () => 'Read-only. This browser is set to save to GitHub, which needs a token.',
    action: 'Settings',
    run: openSettings,
  },
};

let bannerAction = null;

function showBanner(show, message, actionLabel, run) {
  const b = $('#banner');
  if (!show) { b.hidden = true; bannerAction = null; return; }
  $('#banner-text').textContent = message || '';
  $('#banner-action').textContent = actionLabel || 'Settings';
  $('#banner-action').hidden = false;
  bannerAction = run || openSettings;
  b.hidden = false;
}

function renderBlockedBanner() {
  const spec = BANNER[state.blocked];
  if (!spec) { showBanner(false); return; }
  showBanner(true, spec.text(), spec.action, spec.run);
}

/* ── Theme ───────────────────────────────────────────────────────────────── */

function initTheme() {
  const saved = localStorage.getItem(LS.theme);
  if (saved) document.documentElement.dataset.theme = saved;
  $('#btn-theme').addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme === 'dark'
      || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(LS.theme, next);
    renderCharts();   // SVG fills read CSS variables; re-measure for the new mode
  });
}

/* ── Export & import ─────────────────────────────────────────────────────────
   The bridge between devices when the store is local: export here, import
   there. It is also the browser mode's backup, which matters because clearing
   site data would otherwise take the budget with it. */

function downloadXlsx() {
  const blob = new Blob([buildWorkbook({ items: state.items, payments: state.payments })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = state.fileName || cfg.filePath.split('/').pop() || 'wedding-budget.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function importXlsx(file) {
  if (!file) return;
  try {
    const data = parseWorkbook(new Uint8Array(await file.arrayBuffer()));
    const had = state.items.length || state.payments.length;
    if (had && !confirm(
      `Replace the ${plural(state.items.length, 'item', 'items')} and `
      + `${plural(state.payments.length, 'payment', 'payments')} on screen with `
      + `${plural(data.items.length, 'item', 'items')} and `
      + `${plural(data.payments.length, 'payment', 'payments')} from ${file.name}?`)) return;

    state.items = data.items;
    state.payments = data.payments;
    renderAll();

    if (canWrite()) {
      await activeStore().write(data, [{ kind: 'import' }]);
      state.base = data;
      setSync('ok');
    }
    toast('ok', `Imported ${plural(data.items.length, 'item', 'items')} from ${file.name}.`);
  } catch (err) {
    toast('error', `Could not read that file: ${err.message}`);
  }
}

/* ── Load ────────────────────────────────────────────────────────────────── */

async function load() {
  setSync('loading');
  try {
    const result = await activeStore().read();
    state.items = result.data.items;
    state.payments = result.data.payments;
    state.base = result.data;
    state.sha = result.sha || null;

    renderAll();
    setSync(canWrite() ? 'ok' : 'blocked');
    renderBlockedBanner();
    if (result.missing) toast('info', `${cfg.filePath} does not exist yet — it will be created on your first save.`);
  } catch (err) {
    renderAll();
    setSync('error', err.message);
    toast('error', err.message);
  }
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

async function boot() {
  setMode(resolveMode());
  try {
    state.blocked = await activeStore().restore();
  } catch {
    state.blocked = 'nofile';
  }

  // A first visit in file mode has nothing to open yet. Rather than an empty
  // error, read whatever ships beside the page so the user sees the app work,
  // then let them choose where their own copy should live.
  if (state.mode === 'file' && state.blocked === 'nofile') {
    try {
      const seeded = await fetchPublished();
      state.items = seeded.data.items;
      state.payments = seeded.data.payments;
    } catch { /* nothing published — the empty state is the right first screen */ }
    renderAll();
    setSync('blocked');
    renderBlockedBanner();
    return;
  }

  await load();
}

/* ── Wire up ─────────────────────────────────────────────────────────────── */

function init() {
  initTheme();
  rebuildFormatters();

  $('#foot-path').textContent = cfg.filePath;
  $('#foot-repo').textContent = cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : 'this repository';

  $('#btn-add-item').addEventListener('click', () => openItem(null));
  $('#btn-add-pay').addEventListener('click', () => openPayment(null));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-download').addEventListener('click', downloadXlsx);
  $('#btn-import').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', (e) => {
    importXlsx(e.target.files[0]);
    e.target.value = '';                                 // so the same file can be picked twice
  });
  $('#sync-pill').addEventListener('click', () => {
    if (state.sync === 'error') flush();
    else if (state.blocked === 'permission') reconnectFile();
    else if (state.sync === 'blocked') openSettings();
    else load();
  });

  $('#form-item').addEventListener('submit', submitItem);
  $('#form-pay').addEventListener('submit', submitPayment);
  $('#form-settings').addEventListener('submit', submitSettings);
  $('#pay-item').addEventListener('change', updatePayContext);
  $('#set-mode').addEventListener('change', renderModePanels);
  $('#set-file-open').addEventListener('click', () => chooseFile('existing'));
  $('#set-file-new').addEventListener('click', () => chooseFile('new'));
  $('#set-file-forget').addEventListener('click', forgetFile);
  $('#set-forget').addEventListener('click', forgetToken);

  $('#del-confirm').addEventListener('click', () => {
    const p = state.pendingDelete;
    if (p && p.kind === 'item') removeItem(p.id);
    else if (p && p.kind === 'payment') removePayment(p.id);
    state.pendingDelete = null;
    $('#dlg-delete').close();
  });
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  $('#banner-action').addEventListener('click', () => (bannerAction || openSettings)());
  $('#banner-close').addEventListener('click', () => showBanner(false));

  $('#f-category').addEventListener('change', (e) => { state.filters.category = e.target.value; renderAll(); });
  $('#f-payer').addEventListener('change', (e) => { state.filters.payer = e.target.value; renderAll(); });
  let searchTimer;
  $('#f-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => { state.filters.search = v; renderAll(); }, 160);
  });
  $('#f-clear').addEventListener('click', () => {
    state.filters = { category: '', payer: '', search: '' };
    $('#f-search').value = '';
    renderAll();
  });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => { state.tab = t.dataset.tab; renderTabs(); });
  });

  document.querySelectorAll('#pane-items th.sortable').forEach((th) => bindSort(th, 'itemSort', renderItemsTable));
  document.querySelectorAll('#pane-payments th.sortable').forEach((th) => bindSort(th, 'paySort', renderPaymentsTable));

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'n') { e.preventDefault(); openPayment(null); }
    if (e.key === 'b') { e.preventDefault(); openItem(null); }
  });

  // The charts are drawn at real pixel widths, so a resize means a redraw.
  let resizeTimer;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCharts, 120);
  });
  ro.observe(document.querySelector('main'));

  addEventListener('beforeunload', (e) => {
    if (queue.length) { e.preventDefault(); e.returnValue = ''; }
  });

  boot();
}

function bindSort(th, sortKey, rerender) {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    const s = state[sortKey];
    if (s.key === key) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
    else state[sortKey] = { key, dir: key === 'name' ? 'asc' : 'desc' };
    rerender();
    renderSortIndicators();
  });
}

document.addEventListener('DOMContentLoaded', init);
