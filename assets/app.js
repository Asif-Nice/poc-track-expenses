/* ══════════════════════════════════════════════════════════════════════════
   Expense Tracker — a static page that reads and writes an .xlsx file
   committed in this repository, through the GitHub Contents API.

   Read  : GitHub API when a token is present (always fresh), otherwise the
           copy published alongside this page (read-only).
   Write : serialize the workbook in the browser → PUT /contents → one commit
           per change. The commit triggers the Pages deploy workflow.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const LS = {
  token: 'expense-tracker.token',
  theme: 'expense-tracker.theme',
  currency: 'expense-tracker.currency',
  locale: 'expense-tracker.locale',
};

const COLUMNS = ['ID', 'Date', 'Category', 'Description', 'Amount', 'Payment Method', 'Notes'];

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
    sheetName: base.sheetName || 'Expenses',
    locale: localStorage.getItem(LS.locale) || base.locale || 'en-IN',
    currency: localStorage.getItem(LS.currency) || base.currency || 'INR',
    categories: base.categories || ['Other'],
    methods: base.methods || ['Other'],
  };
})();

const state = {
  rows: [],        // what the UI shows, including changes not yet committed
  baseRows: null,  // the rows as last committed, paired with sha
  sha: null,
  token: localStorage.getItem(LS.token) || '',
  filters: { month: '', category: '', search: '' },
  sort: { key: 'date', dir: 'desc' },
  editing: null,
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

let money = new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency, maximumFractionDigits: 2 });
let moneyRound = new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency, maximumFractionDigits: 0 });

function rebuildFormatters() {
  try {
    money = new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency, maximumFractionDigits: 2 });
    moneyRound = new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency, maximumFractionDigits: 0 });
  } catch {
    money = moneyRound = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
  }
}

const fmtMoney = (n) => money.format(Number(n) || 0);
const fmtMoneyShort = (n) => moneyRound.format(Number(n) || 0);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const monthOf = (iso) => (iso || '').slice(0, 7);

function fmtDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y) return iso || '';
  const date = new Date(y, (m || 1) - 1, d || 1);
  const showYear = y !== new Date().getFullYear();
  return date.toLocaleDateString(cfg.locale, { day: '2-digit', month: 'short', ...(showYear ? { year: 'numeric' } : {}) });
}

function fmtMonth(ym) {
  if (!ym) return 'All time';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(cfg.locale, { month: 'long', year: 'numeric' });
}

const prevMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
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

/* ── Workbook ↔ rows ─────────────────────────────────────────────────────── */

function parseWorkbook(u8) {
  const wb = XLSX.read(u8, { type: 'array', cellDates: false });
  const ws = wb.Sheets[cfg.sheetName] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  if (!aoa.length) return [];

  const head = (aoa[0] || []).map((h) => String(h || '').trim().toLowerCase());
  const at = (names) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const ix = {
    id: at(['id']),
    date: at(['date']),
    category: at(['category']),
    description: at(['description', 'desc']),
    amount: at(['amount', 'value']),
    method: at(['payment method', 'method']),
    notes: at(['notes', 'note']),
  };

  const pick = (r, i) => (i >= 0 && r[i] != null ? r[i] : '');
  const out = [];

  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || !r.length) continue;
    const date = coerceDate(pick(r, ix.date));
    const amount = Number(String(pick(r, ix.amount)).replace(/[^0-9.\-]/g, '')) || 0;
    const description = String(pick(r, ix.description)).trim();
    if (!date && !amount && !description) continue;
    out.push({
      id: String(pick(r, ix.id)).trim() || newId(),
      date,
      category: String(pick(r, ix.category)).trim() || 'Other',
      description,
      amount,
      method: String(pick(r, ix.method)).trim(),
      notes: String(pick(r, ix.notes)).trim(),
    });
  }
  return out;
}

function buildWorkbook(rows) {
  const sorted = rows.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const aoa = [COLUMNS];
  for (const r of sorted) {
    aoa.push([
      r.id,
      r.date ? isoToSerial(r.date) : '',
      r.category || '',
      r.description || '',
      Number(r.amount) || 0,
      r.method || '',
      r.notes || '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Real Excel date + currency number formats, so the file reads well in Excel.
  for (let i = 0; i < sorted.length; i++) {
    const row = i + 2;
    const dateCell = ws[`B${row}`];
    if (dateCell && typeof dateCell.v === 'number') { dateCell.t = 'n'; dateCell.z = 'yyyy-mm-dd'; }
    const amtCell = ws[`E${row}`];
    if (amtCell) { amtCell.t = 'n'; amtCell.z = '#,##0.00'; }
  }

  ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 38 }, { wch: 12 }, { wch: 16 }, { wch: 34 }];
  ws['!autofilter'] = { ref: `A1:G${Math.max(1, sorted.length + 1)}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cfg.sheetName);
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
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

/* ── GitHub API ──────────────────────────────────────────────────────────── */

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
  if (res.status === 404) return { rows: [], sha: null, missing: true };
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
  return { rows: parseWorkbook(u8), sha: json.sha };
}

async function fetchPublished() {
  const url = new URL(cfg.filePath, document.baseURI);
  url.searchParams.set('t', Date.now());
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${cfg.filePath} (HTTP ${res.status})`);
  return { rows: parseWorkbook(new Uint8Array(await res.arrayBuffer())), sha: null };
}

async function putFile(rows, sha, message) {
  const body = { message, content: u8ToBase64(buildWorkbook(rows)), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await gh(contentsUrl(), { method: 'PUT', body: JSON.stringify(body) });
  const json = await res.json();
  return json.content && json.content.sha;
}

/* ── Commit queue ────────────────────────────────────────────────────────── */

const queue = [];
let flushing = false;
let attempts = 0;
let retryTimer = null;

function applyOps(rows, ops) {
  let out = rows.slice();
  for (const op of ops) {
    if (op.kind === 'delete') {
      out = out.filter((r) => r.id !== op.id);
    } else {
      const i = out.findIndex((r) => r.id === op.row.id);
      if (i >= 0) out[i] = op.row;
      else out.push(op.row);
    }
  }
  return out;
}

function commitMessage(ops) {
  if (ops.length === 1) {
    const op = ops[0];
    if (op.kind === 'delete') return `Delete expense ${op.label || op.id}`;
    const verb = op.kind === 'add' ? 'Add' : 'Update';
    return `${verb} expense: ${op.row.description} — ${fmtMoney(op.row.amount)} (${op.row.date})`;
  }
  return `Update expenses (${ops.length} changes)`;
}

function enqueue(op) {
  queue.push(op);
  if (!state.token) {
    setSync('readonly');
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
  if (flushing || !queue.length || !state.token) return;
  clearTimeout(retryTimer);
  flushing = true;
  setSync('saving');

  try {
    while (queue.length) {
      const batch = queue.splice(0, queue.length);
      try {
        // Prefer the sha our own last PUT returned. Re-reading here would cost a
        // request and can hit a lagging read replica, which returns stale content
        // with a stale sha — a read we would only have to discard.
        let base = state.baseRows && state.sha
          ? { rows: state.baseRows, sha: state.sha }
          : await fetchViaApi();

        let next = applyOps(base.rows, batch);
        try {
          state.sha = await putFile(next, base.sha, commitMessage(batch));
        } catch (err) {
          if (!isConflict(err)) throw err;
          // Someone else wrote in the meantime: take their version and replay
          // this batch on top, so both sets of changes survive.
          const fresh = await fetchViaApi();
          next = applyOps(fresh.rows, batch);
          state.sha = await putFile(next, fresh.sha, commitMessage(batch));
          toast('info', 'Merged a change made elsewhere.');
        }

        state.baseRows = next;
        state.rows = next;
        renderAll();
      } catch (err) {
        queue.unshift(...batch);                          // keep the work
        state.sha = null;                                 // force a re-read next try
        state.baseRows = null;
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

function addExpense(row) {
  state.rows = state.rows.concat([row]);
  renderAll();
  enqueue({ kind: 'add', row });
}

function updateExpense(row) {
  state.rows = state.rows.map((r) => (r.id === row.id ? row : r));
  renderAll();
  enqueue({ kind: 'update', row });
}

function deleteExpense(id) {
  const gone = state.rows.find((r) => r.id === id);
  state.rows = state.rows.filter((r) => r.id !== id);
  renderAll();
  enqueue({ kind: 'delete', id, label: gone ? `"${gone.description}"` : id });
}

/* ── Derived data ────────────────────────────────────────────────────────── */

function monthScope() {
  const m = state.filters.month;
  const q = state.filters.search.trim().toLowerCase();
  return state.rows.filter((r) => {
    if (m && monthOf(r.date) !== m) return false;
    if (q) {
      const hay = `${r.description} ${r.notes} ${r.method} ${r.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function visibleRows() {
  const c = state.filters.category;
  const rows = monthScope().filter((r) => !c || r.category === c);
  const { key, dir } = state.sort;
  const sign = dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    let d;
    if (key === 'amount') d = (Number(a.amount) || 0) - (Number(b.amount) || 0);
    else d = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (d === 0) d = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return d * sign;
  });
}

const sum = (rows) => rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

/* ── Render: KPIs ────────────────────────────────────────────────────────── */

function renderKpis() {
  const scope = monthScope();
  const month = state.filters.month;
  const total = sum(scope);

  $('#kpi-period-label').textContent = month ? fmtMonth(month) : 'All time';
  $('#kpi-month').textContent = fmtMoneyShort(total);

  // Delta vs the previous month — expenses up reads as adverse, with an arrow
  // and a worded label so the colour is never carrying it alone.
  const deltaEl = $('#kpi-month-delta');
  deltaEl.textContent = '';
  deltaEl.className = 'tile-foot';
  if (month) {
    const pm = prevMonth(month);
    const prevTotal = sum(state.rows.filter((r) => monthOf(r.date) === pm));
    if (prevTotal > 0) {
      const pct = ((total - prevTotal) / prevTotal) * 100;
      const up = pct >= 0;
      const span = el('span', up ? 'delta-up' : 'delta-down',
        `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% ${up ? 'more' : 'less'}`);
      deltaEl.append(span, document.createTextNode(` than ${fmtMonth(pm).split(' ')[0]}`));
    } else {
      deltaEl.textContent = `${scope.length} ${scope.length === 1 ? 'entry' : 'entries'}`;
    }
  } else {
    deltaEl.textContent = `${scope.length} ${scope.length === 1 ? 'entry' : 'entries'} in total`;
  }

  const t = todayISO();
  const todays = state.rows.filter((r) => r.date === t);
  $('#kpi-today').textContent = fmtMoneyShort(sum(todays));
  $('#kpi-today-count').textContent = todays.length
    ? `${todays.length} ${todays.length === 1 ? 'entry' : 'entries'} today`
    : 'Nothing logged yet';

  // Daily average — days elapsed for the running month, full month for past ones.
  let days, avgFoot;
  if (month) {
    const nowM = monthOf(t);
    days = month === nowM ? new Date().getDate() : daysInMonth(month);
    avgFoot = month === nowM ? `over ${days} ${days === 1 ? 'day' : 'days'} so far` : `over ${days} days`;
  } else {
    const uniq = new Set(scope.map((r) => r.date).filter(Boolean));
    days = Math.max(1, uniq.size);
    avgFoot = `across ${days} ${days === 1 ? 'day' : 'days'} with spend`;
  }
  $('#kpi-avg').textContent = fmtMoneyShort(total / Math.max(1, days));
  $('#kpi-avg-foot').textContent = avgFoot;

  const byCat = categoryTotals(scope);
  if (byCat.length) {
    const top = byCat[0];
    $('#kpi-top').textContent = top.name;
    $('#kpi-top-foot').textContent = `${fmtMoneyShort(top.total)} · ${Math.round((top.total / total) * 100)}% of spend`;
  } else {
    $('#kpi-top').textContent = '—';
    $('#kpi-top-foot').textContent = 'No expenses in range';
  }
}

/* ── Render: category bars ───────────────────────────────────────────────── */

function categoryTotals(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.category || 'Other';
    const e = map.get(k) || { name: k, total: 0, count: 0 };
    e.total += Number(r.amount) || 0;
    e.count++;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function renderBreakdown() {
  const host = $('#breakdown');
  host.textContent = '';
  const rows = categoryTotals(monthScope());
  const total = rows.reduce((t, r) => t + r.total, 0);

  $('#breakdown-sub').textContent = state.filters.month ? fmtMonth(state.filters.month) : 'All time';

  if (!rows.length) {
    host.append(el('p', 'empty', 'No expenses in this range yet.'));
    return;
  }

  const max = rows[0].total || 1;
  for (const r of rows) {
    const row = el('div', 'bar-row');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    const share = total ? (r.total / total) * 100 : 0;
    row.setAttribute('aria-label',
      `${r.name}: ${fmtMoney(r.total)}, ${share.toFixed(0)} percent, ${r.count} entries. Filter by this category.`);
    if (state.filters.category === r.name) row.dataset.active = '1';

    row.append(el('span', 'bar-name', r.name));

    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${Math.max(1.5, (r.total / max) * 100)}%`;
    track.append(fill);
    row.append(track);

    const val = el('span', 'bar-value', fmtMoneyShort(r.total));
    const wrap = el('span');
    wrap.append(val, document.createTextNode(' '), el('span', 'bar-share', `${share.toFixed(0)}%`));
    row.append(wrap);

    const toggle = () => {
      state.filters.category = state.filters.category === r.name ? '' : r.name;
      $('#f-category').value = state.filters.category;
      renderAll();
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    row.addEventListener('mouseenter', (e) => showTooltip(e, r, total));
    row.addEventListener('mousemove', moveTooltip);
    row.addEventListener('mouseleave', hideTooltip);

    host.append(row);
  }
}

/* ── Render: table ───────────────────────────────────────────────────────── */

function renderTable() {
  const tbody = $('#rows');
  tbody.textContent = '';
  const rows = visibleRows();

  $('#count').textContent = rows.length;
  $('#count-all').textContent = state.rows.length;
  $('#foot-total').textContent = fmtMoney(sum(rows));

  const empty = $('#empty');
  if (!rows.length) {
    empty.hidden = false;
    empty.textContent = '';
    const has = state.rows.length > 0;
    if (has) {
      empty.append(
        el('strong', null, 'No expenses match these filters'),
        el('span', null, 'Try clearing the month, category, or search filter.')
      );
    } else if (!state.token) {
      empty.append(
        el('strong', null, 'No expenses yet'),
        el('span', null, 'Add a GitHub token in Settings to start recording expenses.')
      );
    } else {
      empty.append(
        el('strong', null, 'No expenses yet'),
        el('span', null, 'Add your first expense to get started — press N for a shortcut.')
      );
    }
  } else {
    empty.hidden = true;
  }

  for (const r of rows) {
    const tr = el('tr');

    tr.append(el('td', 'cell-date', fmtDate(r.date)));

    const desc = el('td', 'cell-desc');
    desc.append(document.createTextNode(r.description || '—'));
    if (r.notes) desc.append(el('span', 'cell-notes', r.notes));
    tr.append(desc);

    const cat = el('td');
    cat.append(el('span', 'tag', r.category || 'Other'));
    tr.append(cat);

    const meth = el('td', 'method col-method', r.method || '—');
    tr.append(meth);

    tr.append(el('td', 'num cell-amount', fmtMoney(r.amount)));

    const act = el('td', 'col-actions');
    const box = el('div', 'row-actions');
    const edit = el('button', 'icon-btn icon-btn-sm', '✎');
    edit.type = 'button';
    edit.title = 'Edit';
    edit.setAttribute('aria-label', `Edit ${r.description}`);
    edit.addEventListener('click', () => openEntry(r));
    const del = el('button', 'icon-btn icon-btn-sm', '🗑');
    del.type = 'button';
    del.title = 'Delete';
    del.setAttribute('aria-label', `Delete ${r.description}`);
    del.addEventListener('click', () => openDelete(r));
    box.append(edit, del);
    act.append(box);
    tr.append(act);

    tbody.append(tr);
  }

  document.querySelectorAll('.grid th.sortable').forEach((th) => {
    if (th.dataset.sort === state.sort.key) th.dataset.dir = state.sort.dir;
    else delete th.dataset.dir;
  });
}

/* ── Render: filters ─────────────────────────────────────────────────────── */

function renderFilterOptions() {
  const months = [...new Set(state.rows.map((r) => monthOf(r.date)).filter(Boolean))].sort().reverse();
  const sel = $('#f-month');
  const keep = state.filters.month;
  sel.textContent = '';
  const all = el('option', null, 'All time');
  all.value = '';
  sel.append(all);
  for (const m of months) {
    const o = el('option', null, fmtMonth(m));
    o.value = m;
    sel.append(o);
  }
  sel.value = months.includes(keep) ? keep : (keep === '' ? '' : '');
  state.filters.month = sel.value;

  const cats = [...new Set([...state.rows.map((r) => r.category || 'Other'), ...cfg.categories])].sort();
  const csel = $('#f-category');
  const keepC = state.filters.category;
  csel.textContent = '';
  const allC = el('option', null, 'All categories');
  allC.value = '';
  csel.append(allC);
  for (const c of cats) {
    const o = el('option', null, c);
    o.value = c;
    csel.append(o);
  }
  csel.value = cats.includes(keepC) ? keepC : '';
  state.filters.category = csel.value;
}

function renderAll() {
  renderFilterOptions();
  renderKpis();
  renderBreakdown();
  renderTable();
  renderSync();
}

/* ── Sync status ─────────────────────────────────────────────────────────── */

function setSync(kind, note = '') {
  state.sync = kind;
  state.syncNote = note;
  renderSync();
}

function renderSync() {
  const pill = $('#sync-pill');
  const text = $('#sync-text');
  const pending = queue.length;
  pill.dataset.state = state.sync;

  const label = {
    loading: 'Loading…',
    ok: 'Saved to repo',
    saving: pending > 1 ? `Saving ${pending} changes…` : 'Saving…',
    error: 'Save failed — retry',
    readonly: 'Read-only',
  }[state.sync] || state.sync;

  text.textContent = pending && state.sync === 'readonly' ? `Read-only · ${pending} unsaved` : label;
  pill.title = state.syncNote || (state.sync === 'readonly'
    ? 'Connect a GitHub token to save changes'
    : `${cfg.owner || '?'}/${cfg.repo || '?'} · ${cfg.branch}`);
}

/* ── Toasts & tooltip ────────────────────────────────────────────────────── */

function toast(kind, message, ms = 5000) {
  const t = el('div', 'toast');
  t.dataset.kind = kind;
  t.append(el('span', null, message));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

function showTooltip(e, r, total) {
  const tip = $('#tooltip');
  tip.textContent = '';
  tip.append(el('div', null, ''));
  tip.firstChild.append(el('b', null, r.name));
  tip.append(el('div', 't-row', `${fmtMoney(r.total)} · ${total ? ((r.total / total) * 100).toFixed(1) : 0}% of range`));
  tip.append(el('div', 't-row', `${r.count} ${r.count === 1 ? 'entry' : 'entries'} · ${fmtMoney(r.total / r.count)} avg`));
  tip.hidden = false;
  moveTooltip(e);
}

function moveTooltip(e) {
  const tip = $('#tooltip');
  if (tip.hidden) return;
  const pad = 14;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
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

function openEntry(row) {
  state.editing = row || null;
  const f = $('#form-entry');
  const cats = [...new Set([...cfg.categories, ...state.rows.map((r) => r.category).filter(Boolean)])];

  $('#entry-title').textContent = row ? 'Edit expense' : 'Add expense';
  $('#entry-submit').textContent = row ? 'Save changes' : 'Add expense';
  $('#entry-error').hidden = true;

  f.date.value = row ? row.date : todayISO();
  f.amount.value = row ? row.amount : '';
  f.description.value = row ? row.description : '';
  fillSelect($('#entry-category'), cats, row ? row.category : (state.filters.category || cfg.categories[0]));
  fillSelect($('#entry-method'), cfg.methods, row ? row.method : cfg.methods[0]);
  f.notes.value = row ? row.notes : '';

  $('#dlg-entry').showModal();
  setTimeout(() => (row ? f.amount : f.description).focus(), 30);
}

function submitEntry(e) {
  e.preventDefault();
  const f = $('#form-entry');
  const err = $('#entry-error');
  const date = f.date.value;
  const amount = Number(f.amount.value);
  const description = f.description.value.trim();

  if (!date) return fail('Pick a date.');
  if (!isFinite(amount) || amount <= 0) return fail('Enter an amount greater than zero.');
  if (!description) return fail('Add a short description.');

  const row = {
    id: state.editing ? state.editing.id : newId(),
    date,
    category: f.category.value || 'Other',
    description,
    amount: Math.round(amount * 100) / 100,
    method: f.method.value || '',
    notes: f.notes.value.trim(),
  };

  if (state.editing) updateExpense(row);
  else addExpense(row);

  if (!state.token) toast('info', 'Saved locally only — connect a token to commit it.');
  state.editing = null;
  $('#dlg-entry').close();

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
  }
}

function openDelete(row) {
  state.pendingDelete = row.id;
  $('#del-summary').textContent = `${row.description} — ${fmtMoney(row.amount)} on ${fmtDate(row.date)}`;
  $('#dlg-delete').showModal();
}

function openSettings() {
  $('#set-repo').textContent = cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : 'not detected';
  $('#set-branch').textContent = cfg.branch;
  $('#set-path').textContent = cfg.filePath;
  $('#set-token').value = state.token;
  $('#set-currency').value = cfg.currency;
  $('#set-locale').value = cfg.locale;
  $('#set-error').hidden = true;
  $('#dlg-settings').showModal();
}

async function submitSettings(e) {
  e.preventDefault();
  const err = $('#set-error');
  const btn = $('#set-submit');
  const token = $('#set-token').value.trim();
  const currency = ($('#set-currency').value.trim() || 'INR').toUpperCase();
  const locale = $('#set-locale').value.trim() || 'en-IN';

  cfg.currency = currency;
  cfg.locale = locale;
  localStorage.setItem(LS.currency, currency);
  localStorage.setItem(LS.locale, locale);
  rebuildFormatters();

  if (!token) {
    state.token = '';
    localStorage.removeItem(LS.token);
    setSync('readonly');
    renderAll();
    $('#dlg-settings').close();
    return;
  }

  if (!cfg.owner || !cfg.repo) {
    err.textContent = 'Repository not detected. Set owner and repo in assets/config.js.';
    err.hidden = false;
    return;
  }

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
    err.hidden = true;
    $('#dlg-settings').close();

    // Reported permissions vary by token type, so this is advisory — the real
    // test is the first save, which reports its own error if write is missing.
    const writable = repo.permissions && repo.permissions.push;
    toast(writable ? 'ok' : 'info',
      writable
        ? 'Token verified — changes will be committed.'
        : 'Token accepted, but write access could not be confirmed. If saving fails, grant Contents: Read and write.');
    showBanner(false);
    await load();
    if (queue.length) flush();
  } catch (ex) {
    state.token = previous;
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & verify';
  }
}

function forgetToken() {
  state.token = '';
  localStorage.removeItem(LS.token);
  $('#set-token').value = '';
  setSync('readonly');
  toast('info', 'Token removed from this browser.');
  showBanner(true);
  $('#dlg-settings').close();
}

/* ── Banner ──────────────────────────────────────────────────────────────── */

function showBanner(show, message, actionLabel) {
  const b = $('#banner');
  if (!show) { b.hidden = true; return; }
  $('#banner-text').textContent = message || 'Read-only. Connect a GitHub token to add, edit, or delete expenses.';
  $('#banner-action').textContent = actionLabel || 'Connect';
  $('#banner-action').hidden = false;
  b.hidden = false;
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
  });
}

/* ── Download ────────────────────────────────────────────────────────────── */

function downloadXlsx() {
  const blob = new Blob([buildWorkbook(state.rows)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = cfg.filePath.split('/').pop() || 'expenses.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ── Load ────────────────────────────────────────────────────────────────── */

async function load() {
  setSync('loading');
  try {
    let result;
    if (state.token) {
      result = await fetchViaApi();
    } else {
      // Without a token, read the copy published alongside the page. If it is
      // missing (never deployed, or excluded from the artifact), fall back to an
      // empty read-only view rather than an error.
      try {
        result = await fetchPublished();
      } catch {
        renderAll();
        setSync('readonly');
        showBanner(true, 'Connect a GitHub token to load and edit your expenses.', 'Connect');
        return;
      }
    }
    state.rows = result.rows;
    state.baseRows = result.sha ? result.rows : null;
    state.sha = result.sha;

    // Default to the current month when it has data, else the newest month.
    const months = [...new Set(state.rows.map((r) => monthOf(r.date)).filter(Boolean))].sort().reverse();
    const now = monthOf(todayISO());
    state.filters.month = months.includes(now) ? now : (months[0] || '');

    renderAll();
    setSync(state.token ? 'ok' : 'readonly');
    if (result.missing) toast('info', `${cfg.filePath} does not exist yet — it will be created on your first save.`);
  } catch (err) {
    renderAll();
    setSync('error', err.message);
    toast('error', err.message);
  }
}

/* ── Wire up ─────────────────────────────────────────────────────────────── */

function init() {
  initTheme();
  rebuildFormatters();

  $('#foot-path').textContent = cfg.filePath;
  $('#foot-repo').textContent = cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : 'this repository';

  $('#btn-add').addEventListener('click', () => openEntry(null));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-download').addEventListener('click', downloadXlsx);
  $('#sync-pill').addEventListener('click', () => {
    if (state.sync === 'error') flush();
    else if (state.sync === 'readonly') openSettings();
    else load();
  });

  $('#form-entry').addEventListener('submit', submitEntry);
  $('#form-settings').addEventListener('submit', submitSettings);
  $('#set-forget').addEventListener('click', forgetToken);
  $('#del-confirm').addEventListener('click', () => {
    if (state.pendingDelete) deleteExpense(state.pendingDelete);
    state.pendingDelete = null;
    $('#dlg-delete').close();
  });
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  $('#banner-action').addEventListener('click', openSettings);
  $('#banner-close').addEventListener('click', () => showBanner(false));

  $('#f-month').addEventListener('change', (e) => { state.filters.month = e.target.value; renderAll(); });
  $('#f-category').addEventListener('change', (e) => { state.filters.category = e.target.value; renderAll(); });
  let searchTimer;
  $('#f-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => { state.filters.search = v; renderAll(); }, 160);
  });
  $('#f-clear').addEventListener('click', () => {
    state.filters = { month: '', category: '', search: '' };
    $('#f-search').value = '';
    renderAll();
  });

  document.querySelectorAll('.grid th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { key, dir: key === 'date' ? 'desc' : 'desc' };
      renderTable();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)
        && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      openEntry(null);
    }
  });

  addEventListener('beforeunload', (e) => {
    if (queue.length) { e.preventDefault(); e.returnValue = ''; }
  });

  if (!cfg.owner || !cfg.repo) {
    showBanner(true, 'Repository not detected — set owner and repo in assets/config.js to enable saving.', 'Settings');
  } else if (!state.token) {
    showBanner(true);
  }

  load();
}

document.addEventListener('DOMContentLoaded', init);
