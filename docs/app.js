// TAC Growth Budget Tracker — cloned from the MadeGood/Moon Juice trackers
// 2026-09-24, Lumanu integration included from the start (see
// budget-tracker-lumanu-bridge). Deliberately only a handful of categories,
// not the usual a8_paid/{client}_paid/shipping 3 — Emmett's call: the
// campaigns themselves (Hair, Berberine, WLP-1) are the categories, each
// with its own budget cap (unlike every other tracker, which only tracks
// one combined total) — see MONTH_BUDGETS below.
//
// Month-aware budgets (Emmett, 2026-10-08) — September and October track
// completely different category splits: September has one combined
// Berberine+WLP-1 bucket ($100k, Michael never broke it down further that
// month), October tracks Berberine and WLP-1 separately ($52,854 / $88,090)
// per Michael's percentage breakdown, since there's now enough budget to
// make that split meaningful. October's total ($176,180) = $100,000 new
// allocation + $76,180 rolled over unspent from September.
//
// The old combined 'berberine_wlp1' category value is kept valid (not
// migrated away) so existing September rows don't need to be individually
// reclassified — September's combined card sums it alongside the new
// granular 'berberine'/'wlp1' values, should anyone use those for a
// September entry too. A row's own `month` field (not its category) is
// the real signal for which month's budget it counts against.
const MONTH_BUDGETS = {
  September: {
    total: 150_000,
    cats: {
      hair:           { label: 'Hair',              budget: 50_000,  match: ['hair'] },
      berberine_wlp1: { label: 'Berberine / WLP-1', budget: 100_000, match: ['berberine_wlp1', 'berberine', 'wlp1'] },
    },
  },
  October: {
    total: 176_180,
    cats: {
      hair:      { label: 'Hair',      budget: 35_236, match: ['hair'] },
      berberine: { label: 'Berberine', budget: 52_854, match: ['berberine'] },
      wlp1:      { label: 'WLP-1',     budget: 88_090, match: ['wlp1'] },
    },
  },
};
let currentMonth = 'October';   // defaults to the current real-world month

const CATS = {
  hair:           'Hair',
  berberine_wlp1: 'Berberine / WLP-1',
  berberine:      'Berberine',
  wlp1:           'WLP-1',
};
const PAID_CATS = ['hair', 'berberine_wlp1', 'berberine', 'wlp1'];   // all go through Lumanu — no separate non-influencer bucket here

const LUMANU_STATUSES = {
  not_sent:       'Not Sent',
  needs_approval: 'Needs Approval',
  approved:       'Approved',
  pending:        'Pending',
  issued:         'Issued',
  canceled:       'Canceled',
};

const API = `${SUPABASE_URL}/rest/v1/tacgrowth_budget_entries`;
const SB  = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

let rows        = [];
let catFilter   = null;
let search      = '';
let sortCol     = 'date';
let sortDir     = 'desc';
let view        = 'table';
let calY        = new Date().getFullYear();
let calM        = new Date().getMonth();
let deleteId    = null;
let editId      = null;
let pending     = [];   // DocuSign / invoice inbox items awaiting review (status = 'pending')
let selected    = new Set();   // ids checked off for Lumanu send

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindAll();
  load();
});

// ── Data ─────────────────────────────────────────────────────────────────────
async function load() {
  const r = await fetch(`${API}?order=date.desc,created_at.desc`, { headers: SB });
  const all = r.ok ? await r.json() : [];
  pending = all.filter(x => x.status === 'pending');   // inbox
  rows    = all.filter(x => x.status !== 'pending');   // everything else (totals/table/calendar)
  render();
}

async function insert(entry) {
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { ...SB, 'Prefer': 'return=minimal' },
      body: JSON.stringify(entry),
    });
    return r.ok;
  } catch { return false; }
}

async function remove(id) {
  try {
    const r = await fetch(`${API}?id=eq.${id}`, { method: 'DELETE', headers: SB });
    return r.ok;
  } catch { return false; }
}

async function update(id, data) {
  try {
    const r = await fetch(`${API}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...SB, 'Prefer': 'return=minimal' },
      body: JSON.stringify(data),
    });
    return r.ok;
  } catch { return false; }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  renderSummary();
  renderInbox();
  if (view === 'calendar')     renderCal();
  else if (view === 'invoice') renderInvoice();
  else if (view === 'sent')    renderSent();
  else                         renderTable();
}

function renderInbox() {
  const sec  = document.getElementById('inbox-section');
  const list = document.getElementById('inbox-list');
  if (!sec || !list) return;
  if (!pending.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  setText('inbox-count', `(${pending.length})`);

  // Describe what's actually pending, rather than a static blurb — see
  // madegood-budget-tracker/docs/app.js for why this is dynamic (2026-09-22).
  const invoiceCount  = pending.filter(e => e.source === 'invoice_email').length;
  const docusignCount = pending.length - invoiceCount;
  const whatsPending = invoiceCount && docusignCount
    ? 'Executed DocuSign contracts and submitted invoices'
    : invoiceCount
      ? (invoiceCount === 1 ? 'A submitted invoice' : 'Submitted invoices')
      : (docusignCount === 1 ? 'An executed DocuSign contract' : 'Executed DocuSign contracts');
  setHTML('inbox-desc', `${whatsPending} waiting to be logged${invoiceCount && docusignCount ? ' (each row is tagged which)' : ''}. Click <strong>Assign + add</strong> to set the campaign &amp; amount and post it to the budget.`);

  list.innerHTML = pending.map(e => {
    const who  = e.creator_handle ? '@' + esc(e.creator_handle.replace(/^@/, ''))
                                  : (e.description ? esc(e.description) : 'Contract');
    const raw  = (e.notes || '').trim();
    const isInvoice = e.source === 'invoice_email';
    const link = /^https?:\/\//.test(raw)
      ? `<a href="${esc(raw)}" target="_blank" style="color:#d29922">${isInvoice ? 'View invoice' : 'View contract'}</a>`
      : esc(raw);
    const kind = isInvoice
      ? '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#d29922;background:#2d2107;border-radius:4px;padding:2px 6px">Invoice</span>'
      : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #2a2a2a">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        ${kind}
        <span style="font-weight:600">${who}</span>
        <span style="color:#8b949e;font-size:12px">${fmtDate(e.date)}</span>
        ${link ? `<span style="font-size:12px">${link}</span>` : ''}
      </div>
      <div style="white-space:nowrap">
        <button class="btn-inbox-go" data-id="${e.id}" style="background:#d29922;color:#000;border:none;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer">Assign + add →</button>
        <button class="btn-inbox-x" data-id="${e.id}" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:14px;margin-left:4px">✕</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.btn-inbox-go').forEach(b =>
    b.addEventListener('click', () => {
      const entry = pending.find(r => String(r.id) === b.dataset.id);
      if (entry) openEditModal(entry);   // reuse the form to set campaign + amount
    })
  );
  list.querySelectorAll('.btn-inbox-x').forEach(b =>
    b.addEventListener('click', () => openDelete(b.dataset.id))
  );
}

function renderSummary() {
  const monthConfig = MONTH_BUDGETS[currentMonth];
  const monthRows = rows.filter(r => r.month === currentMonth);
  const tAct = sum(monthRows);

  setText('total-spent',     fmt(tAct));
  setText('total-of',        `spent of ${fmt(monthConfig.total)}`);
  setText('total-remaining', fmt(monthConfig.total - tAct) + ' remaining');

  const aPct = Math.min(tAct / monthConfig.total * 100, 100);
  setStyle('progress-actual', 'width', aPct + '%');

  document.querySelectorAll('.month-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.month === currentMonth));

  renderCatGrid(monthRows, monthConfig);
}

function renderCatGrid(monthRows, monthConfig) {
  const grid = document.getElementById('cat-grid');
  if (!grid) return;
  grid.innerHTML = Object.entries(monthConfig.cats).map(([key, cfg]) => {
    const ca = sum(monthRows.filter(r => cfg.match.includes(r.category)));
    const pct = Math.min(ca / cfg.budget * 100, 100);
    return `
      <div class="cat-card ${key}${catFilter === key ? ' selected' : ''}" data-cat="${key}">
        <div class="cc-label">${cfg.label}</div>
        <div class="cc-num">${fmt(ca)} of ${fmt(cfg.budget)}</div>
        <div class="cc-bar-wrap"><div class="cc-bar-fill" style="width:${pct}%"></div></div>
        <div class="cc-hint">${fmt(cfg.budget - ca)} remaining</div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.cat-card').forEach(card => card.addEventListener('click', () => {
    const key = card.dataset.cat;
    if (catFilter === key) {
      catFilter = null;
      document.getElementById('filter-banner').classList.add('hidden');
    } else {
      catFilter = key;
      setText('filter-banner-label', monthConfig.cats[key].label);
      document.getElementById('filter-banner').classList.remove('hidden');
      if (view !== 'table') switchView('table');
    }
    renderSummary();
    renderTable();
  }));
}

// ── Table view ────────────────────────────────────────────────────────────────
function filtered() {
  let data = rows.filter(r => r.month === currentMonth);
  if (catFilter) {
    const match = MONTH_BUDGETS[currentMonth].cats[catFilter]?.match || [catFilter];
    data = data.filter(r => match.includes(r.category));
  }
  if (search) {
    const q = search.toLowerCase();
    data = data.filter(r =>
      (r.creator_handle || '').toLowerCase().includes(q) ||
      (r.description    || '').toLowerCase().includes(q) ||
      (r.notes          || '').toLowerCase().includes(q)
    );
  }
  data.sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (sortCol === 'amount') { av = +av; bv = +bv; }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
  return data;
}

function renderTable() {
  // Update sort arrows in headers
  document.querySelectorAll('th.sh').forEach(th => {
    const col = th.dataset.col;
    const isSorted = col === sortCol;
    th.classList.toggle('sorted', isSorted);
    th.textContent = {
      date:     'Date',
      category: 'Category',
      amount:   'Amount',
    }[col] + (isSorted ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕');
  });

  const data = filtered();
  const tbody = document.getElementById('entries-tbody');

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-cell">No entries match your filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(e => {
    const h = e.creator_handle ? `<span class="handle-text">@${e.creator_handle.replace(/^@/, '')}</span>` : '';
    const d = e.description    ? `<span>${esc(e.description)}</span>` : '';
    let varianceHtml = '';
    if (e.planned_amount != null) {
      const delta = +e.amount - +e.planned_amount;
      if (delta !== 0) {
        const cls = delta < 0 ? 'under' : 'over';
        const label = delta < 0
          ? `↓ ${fmt(Math.abs(delta))} vs plan`
          : `↑ ${fmt(delta)} vs plan`;
        varianceHtml = `<div class="row-variance ${cls}">${label}</div>`;
      }
    }
    const invoiced = !!e.ready_to_invoice;
    const isPaid = PAID_CATS.includes(e.category);
    const isSendable = (e.source === 'invoice_email' || e.invoice_path) && !e.lumanu_payable_id;
    const lumanuCell = isPaid
      ? `<span class="badge-lumanu ${e.lumanu_status || 'not_sent'}">${LUMANU_STATUSES[e.lumanu_status] || 'Not Sent'}</span>`
      : '<span style="color:#444">—</span>';
    const checkCell = isSendable
      ? `<input type="checkbox" class="row-check" data-id="${e.id}" ${selected.has(String(e.id)) ? 'checked' : ''}>`
      : '';
    const invoiceBtn = e.invoice_path
      ? `<button class="btn-view-invoice" data-id="${e.id}" title="View attached invoice">📄 View</button>`
      : `<button class="btn-attach-invoice" data-id="${e.id}" title="Attach invoice PDF">📎 Add</button>`;
    const contractBtn = e.contract_link
      ? `<a href="${esc(e.contract_link)}" target="_blank" class="btn-view-contract" title="View contract">📄 View ↗</a>`
      : `<button class="btn-add-contract" data-id="${e.id}" title="Add a link to the signed contract">+ Add Link</button>`;
    return `<tr>
      <td>${checkCell}</td>
      <td style="white-space:nowrap;color:#8b949e">${fmtDate(e.date)}</td>
      <td><span class="badge-cat ${e.category}">${CATS[e.category] || e.category}</span></td>
      <td>${h}${d}</td>
      <td class="amount-actual" style="white-space:nowrap">${fmt(+e.amount)}${varianceHtml}</td>
      <td>${lumanuCell}</td>
      <td class="note-text">${esc(e.notes || '')}</td>
      <td><button class="btn-invoice${invoiced ? ' invoiced' : ''}" data-id="${e.id}" data-state="${invoiced}">${invoiced ? '✓ Ready' : 'Mark ready'}</button></td>
      <td style="white-space:nowrap">${invoiceBtn}</td>
      <td style="white-space:nowrap">${contractBtn}</td>
      <td style="white-space:nowrap"><button class="btn-edit" data-id="${e.id}" title="Edit">✏</button> <button class="btn-del" data-id="${e.id}">✕</button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-del').forEach(b =>
    b.addEventListener('click', () => openDelete(b.dataset.id))
  );
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => {
      const entry = rows.find(r => String(r.id) === b.dataset.id);
      if (entry) openEditModal(entry);
    })
  );
  tbody.querySelectorAll('.btn-invoice').forEach(b =>
    b.addEventListener('click', async () => {
      const newState = b.dataset.state === 'true' ? false : true;
      b.disabled = true;
      await update(b.dataset.id, { ready_to_invoice: newState });
      const row = rows.find(r => String(r.id) === b.dataset.id);
      if (row) row.ready_to_invoice = newState;
      b.dataset.state = newState;
      b.textContent   = newState ? '✓ Ready' : 'Mark ready';
      b.classList.toggle('invoiced', newState);
      b.disabled = false;
    })
  );
  tbody.querySelectorAll('.row-check').forEach(cb =>
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id);
      updateExportBar();
    })
  );
  tbody.querySelectorAll('.btn-attach-invoice').forEach(b =>
    b.addEventListener('click', () => attachInvoice(b.dataset.id))
  );
  tbody.querySelectorAll('.btn-view-invoice').forEach(b =>
    b.addEventListener('click', () => viewInvoice(b.dataset.id))
  );
  tbody.querySelectorAll('.btn-add-contract').forEach(b =>
    b.addEventListener('click', () => addContractLink(b.dataset.id))
  );
}

// ── Contract link ────────────────────────────────────────────────────────────
async function addContractLink(entryId) {
  const url = prompt('Paste the link to the signed contract (DocuSign or any URL):');
  if (!url) return;
  const ok = await update(entryId, { contract_link: url });
  if (!ok) { alert('Couldn\'t save the contract link — please try again.'); return; }
  const row = rows.find(r => String(r.id) === entryId);
  if (row) row.contract_link = url;
  render();
}

// ── Lumanu send (direct API, via the shared budget-tracker-lumanu-bridge service) ──
const BRIDGE_API = 'https://budget-tracker-lumanu-bridge.onrender.com';
const CLIENT_KEY = 'tacgrowth';   // must match the key in the bridge's config.py CLIENTS dict

function updateExportBar() {
  const bar = document.getElementById('lumanu-export-bar');
  if (!bar) return;
  bar.classList.toggle('hidden', selected.size === 0);
  setText('lumanu-export-count', `${selected.size} selected`);
}

async function sendSelectedToLumanu() {
  const chosenIds = [...selected];
  if (!chosenIds.length) return;

  const missingBilling = rows.filter(r => chosenIds.includes(String(r.id)) && !(r.billing_id || '').trim());
  if (missingBilling.length) {
    alert(`${missingBilling.length} selected entr${missingBilling.length === 1 ? 'y is' : 'ies are'} missing a Billing ID — fill that in first (edit the entry) before sending.`);
    return;
  }

  const pw = prompt('Enter the password to send to Lumanu:');
  if (!pw) return;

  const btn = document.getElementById('btn-export-lumanu');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await fetch(`${BRIDGE_API}/api/lumanu/send/${CLIENT_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': pw },
      body: JSON.stringify({ entry_ids: chosenIds }),
    });
    if (r.status === 401) { alert('Wrong password.'); return; }
    const { results } = await r.json();
    const okCount = results.filter(x => x.ok).length;
    const failed  = results.filter(x => !x.ok);
    let msg = `${okCount} of ${results.length} sent to Lumanu successfully.`;
    if (failed.length) msg += `\n\nFailed:\n` + failed.map(f => `• ${f.error}`).join('\n');
    alert(msg);
    selected.clear();
    await load();
  } catch (e) {
    alert('Error sending to Lumanu — please try again. ' + (e.message || ''));
  } finally {
    btn.disabled = false; btn.textContent = '⬇ Send to Lumanu';
  }
}

// ── Retroactive invoice attachment ──────────────────────────────────────────
function attachInvoice(entryId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { alert('Please choose a PDF file.'); return; }

    const pw = prompt('Enter the password to attach this invoice:');
    if (!pw) return;

    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`${BRIDGE_API}/api/invoice/upload/${CLIENT_KEY}?entry_id=${entryId}`, {
        method: 'POST',
        headers: { 'X-Bridge-Secret': pw },
        body: form,
      });
      if (r.status === 401) { alert('Wrong password.'); return; }
      if (!r.ok) { alert('Upload failed — please try again.'); return; }
      await load();
    } catch (e) {
      alert('Error uploading invoice — please try again. ' + (e.message || ''));
    }
  });
  input.click();
}

async function viewInvoice(entryId) {
  const pw = prompt('Enter the password to view this invoice:');
  if (!pw) return;
  try {
    const r = await fetch(`${BRIDGE_API}/api/invoice/url/${CLIENT_KEY}/${entryId}`, {
      headers: { 'X-Bridge-Secret': pw },
    });
    if (r.status === 401) { alert('Wrong password.'); return; }
    if (!r.ok) { alert('Could not load invoice.'); return; }
    const { url } = await r.json();
    window.open(url, '_blank');
  } catch (e) {
    alert('Error loading invoice. ' + (e.message || ''));
  }
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function renderCal() {
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  setText('cal-title', `${MONTHS[calM]} ${calY}`);

  const todayStr   = new Date().toISOString().split('T')[0];
  const firstDow   = new Date(calY, calM, 1).getDay();
  const daysInMo   = new Date(calY, calM + 1, 0).getDate();

  // Group entries by YYYY-MM-DD
  const byDay = {};
  rows.forEach(e => {
    const dt = new Date(e.date + 'T12:00:00');
    if (dt.getFullYear() === calY && dt.getMonth() === calM) {
      (byDay[e.date] = byDay[e.date] || []).push(e);
    }
  });

  let html = '';
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day faded"></div>`;

  for (let d = 1; d <= daysInMo; d++) {
    const ds  = `${calY}-${pad(calM + 1)}-${pad(d)}`;
    const es  = byDay[ds] || [];
    const cls = [
      'cal-day',
      ds === todayStr ? 'is-today' : '',
      es.length       ? 'clickable' : '',
    ].filter(Boolean).join(' ');

    // One pill per category that has entries, colored by category.
    const catPills = Object.keys(CATS).map(cat => {
      const catEs = es.filter(e => e.category === cat);
      if (!catEs.length) return '';
      return `<div class="cal-dot ${cat}">${fmt(sum(catEs))}</div>`;
    }).join('');

    html += `<div class="${cls}" data-date="${ds}">
      <div class="cal-day-num">${d}</div>
      ${catPills}
    </div>`;
  }

  document.getElementById('cal-days').innerHTML = html;
  document.getElementById('cal-detail').classList.add('hidden');

  document.querySelectorAll('.cal-day.clickable').forEach(cell => {
    cell.addEventListener('click', () => {
      const ds = cell.dataset.date;
      showCalDetail(ds, byDay[ds] || []);
    });
  });
}

function showCalDetail(ds, entries) {
  const detail = document.getElementById('cal-detail');
  setText('cal-detail-date', fmtDateLong(ds));

  document.getElementById('cal-detail-tbody').innerHTML = entries.map(e => {
    const h = e.creator_handle ? `<span class="handle-text">@${e.creator_handle.replace(/^@/, '')}</span>` : '';
    const d = e.description    ? `<span>${esc(e.description)}</span>` : '';
    let varianceHtml = '';
    if (e.planned_amount != null) {
      const delta = +e.amount - +e.planned_amount;
      if (delta !== 0) {
        const cls   = delta < 0 ? 'under' : 'over';
        const label = delta < 0 ? `↓ ${fmt(Math.abs(delta))} vs plan` : `↑ ${fmt(delta)} vs plan`;
        varianceHtml = `<div class="row-variance ${cls}">${label}</div>`;
      }
    }
    return `<tr>
      <td><span class="badge-cat ${e.category}">${CATS[e.category] || e.category}</span></td>
      <td>${h}${d}</td>
      <td class="amount-actual">${fmt(+e.amount)}${varianceHtml}</td>
      <td class="note-text">${esc(e.notes || '')}</td>
    </tr>`;
  }).join('');

  detail.classList.remove('hidden');
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Bind events ───────────────────────────────────────────────────────────────
function bindAll() {

  // Add entry
  document.getElementById('btn-add-entry').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.getElementById('entry-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn    = document.getElementById('btn-submit');
    const isEdit = !!editId;
    btn.disabled = true; btn.textContent = 'Saving…';
    const cat  = document.getElementById('f-category').value;
    const paid = PAID_CATS.includes(cat);
    const payload = {
      date:           document.getElementById('f-date').value,
      month:          document.getElementById('f-month').value,
      entry_type:     'actual',
      category:       cat,
      creator_handle: paid ? (document.getElementById('f-handle').value.trim().replace(/^@/,'') || null) : null,
      description:    document.getElementById('f-description').value.trim() || null,
      amount:         parseFloat(document.getElementById('f-amount').value),
      notes:          document.getElementById('f-notes').value.trim() || null,
      billing_id:     paid ? (document.getElementById('f-billing-id').value.trim() || null) : null,
      due_date:       paid ? (document.getElementById('f-due-date').value || null) : null,
      po_number:      paid ? (document.getElementById('f-po').value.trim() || null) : null,
      lumanu_status:  paid ? document.getElementById('f-lumanu-status').value : 'not_sent',
      status:         'confirmed',   // saving always confirms (incl. completing an inbox item)
    };
    const ok = isEdit ? await update(editId, payload) : await insert(payload);
    btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Add Entry';
    if (!ok) { alert('Error saving — please try again.'); return; }
    closeModal();
    await load();
  });

  // Show/hide handle + Lumanu fields based on category
  document.getElementById('f-category').addEventListener('change', e => {
    const show = PAID_CATS.includes(e.target.value);
    document.getElementById('field-handle').classList.toggle('hidden', !show);
    document.getElementById('field-lumanu').classList.toggle('hidden', !show);
  });

  // Send to Lumanu (direct API)
  document.getElementById('btn-export-lumanu').addEventListener('click', sendSelectedToLumanu);
  document.getElementById('btn-clear-selection').addEventListener('click', () => {
    selected.clear();
    updateExportBar();
    renderTable();
  });

  // Delete
  document.getElementById('delete-cancel').addEventListener('click', closeDelete);
  document.getElementById('delete-overlay').addEventListener('click', e => {
    if (e.target.id === 'delete-overlay') closeDelete();
  });
  document.getElementById('delete-confirm').addEventListener('click', async () => {
    if (!deleteId) return;
    await remove(deleteId);
    closeDelete();
    await load();
  });

  // Category cards are rendered dynamically (their count/labels change per
  // month) — their click-to-filter wiring lives in renderCatGrid() instead
  // of here, re-wired fresh every time the grid re-renders.

  // Month toggle (September / October)
  document.querySelectorAll('.month-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMonth = btn.dataset.month;
      catFilter = null;
      document.getElementById('filter-banner').classList.add('hidden');
      renderSummary();
      renderTable();
    });
  });

  // Clear filter banner
  document.getElementById('filter-clear').addEventListener('click', () => {
    catFilter = null;
    document.getElementById('filter-banner').classList.add('hidden');
    renderSummary();
    renderTable();
  });

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    search = e.target.value;
    renderTable();
  });

  // Sort — click column header
  document.querySelectorAll('th.sh').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = col === 'amount' ? 'desc' : 'asc';
      }
      renderTable();
    });
  });

  // View toggle
  document.getElementById('vt-table').addEventListener('click',    () => switchView('table'));
  document.getElementById('vt-calendar').addEventListener('click', () => switchView('calendar'));
  document.getElementById('vt-invoice').addEventListener('click',  () => switchView('invoice'));
  document.getElementById('vt-sent').addEventListener('click',     () => switchView('sent'));

  // Calendar nav
  document.getElementById('cal-prev').addEventListener('click', () => {
    if (--calM < 0) { calM = 11; calY--; }
    renderCal();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    if (++calM > 11) { calM = 0; calY++; }
    renderCal();
  });
  document.getElementById('cal-detail-close').addEventListener('click', () => {
    document.getElementById('cal-detail').classList.add('hidden');
  });
}

function switchView(v) {
  view = v;
  document.getElementById('vt-table').classList.toggle('active',    v === 'table');
  document.getElementById('vt-calendar').classList.toggle('active', v === 'calendar');
  document.getElementById('vt-invoice').classList.toggle('active',  v === 'invoice');
  document.getElementById('vt-sent').classList.toggle('active',     v === 'sent');
  document.getElementById('view-table').classList.toggle('hidden',    v !== 'table');
  document.getElementById('view-calendar').classList.toggle('hidden', v !== 'calendar');
  document.getElementById('view-invoice').classList.toggle('hidden',  v !== 'invoice');
  document.getElementById('view-sent').classList.toggle('hidden',     v !== 'sent');
  if (v === 'calendar') renderCal();
  else if (v === 'invoice') renderInvoice();
  else if (v === 'sent') renderSent();
  else renderTable();
}

function renderInvoice() {
  const data = rows.filter(r => r.ready_to_invoice);
  const total = sum(data);

  const summary = document.getElementById('invoice-summary');
  if (data.length > 0) {
    summary.innerHTML = `
      <div class="invoice-total">
        <span class="invoice-total-label">Total ready to invoice</span>
        <span class="invoice-total-amt">${fmt(total)}</span>
        <span class="invoice-total-count">${data.length} entr${data.length === 1 ? 'y' : 'ies'}</span>
      </div>`;
  } else {
    summary.innerHTML = '';
  }

  const tbody = document.getElementById('invoice-tbody');
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No entries marked ready to invoice.</td></tr>`;
    return;
  }

  const sorted = [...data].sort((a, b) => a.date < b.date ? 1 : -1);
  tbody.innerHTML = sorted.map(e => {
    const h = e.creator_handle ? `<span class="handle-text">@${e.creator_handle.replace(/^@/, '')}</span>` : '';
    const d = e.description    ? `<span>${esc(e.description)}</span>` : '';
    return `<tr>
      <td style="white-space:nowrap;color:#8b949e">${fmtDate(e.date)}</td>
      <td><span class="badge-cat ${e.category}">${CATS[e.category] || e.category}</span></td>
      <td>${h}${d}</td>
      <td class="amount-actual" style="white-space:nowrap">${fmt(+e.amount)}</td>
      <td class="note-text">${esc(e.notes || '')}</td>
      <td><button class="btn-unmark" data-id="${e.id}">Unmark</button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-unmark').forEach(b =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      await update(b.dataset.id, { ready_to_invoice: false });
      const row = rows.find(r => String(r.id) === b.dataset.id);
      if (row) row.ready_to_invoice = false;
      renderInvoice();
    })
  );
}

function renderSent() {
  const data = rows.filter(r => r.lumanu_payable_id);
  const total = sum(data);

  const summary = document.getElementById('sent-summary');
  if (data.length > 0) {
    const counts = {};
    data.forEach(e => { counts[e.lumanu_status] = (counts[e.lumanu_status] || 0) + 1; });
    const breakdown = Object.entries(counts)
      .map(([status, n]) => `<span class="badge-lumanu ${status}">${n} ${LUMANU_STATUSES[status] || status}</span>`)
      .join(' ');
    summary.innerHTML = `
      <div class="invoice-total">
        <span class="invoice-total-label">Total sent to Lumanu</span>
        <span class="invoice-total-amt">${fmt(total)}</span>
        <span class="invoice-total-count">${data.length} entr${data.length === 1 ? 'y' : 'ies'}</span>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${breakdown}</div>`;
  } else {
    summary.innerHTML = '';
  }

  const tbody = document.getElementById('sent-tbody');
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No invoices sent to Lumanu yet.</td></tr>`;
    return;
  }

  const sorted = [...data].sort((a, b) => a.date < b.date ? 1 : -1);
  tbody.innerHTML = sorted.map(e => {
    const h = e.creator_handle ? `<span class="handle-text">@${e.creator_handle.replace(/^@/, '')}</span>` : '';
    const d = e.description    ? `<span>${esc(e.description)}</span>` : '';
    return `<tr>
      <td style="white-space:nowrap;color:#8b949e">${fmtDate(e.date)}</td>
      <td><span class="badge-cat ${e.category}">${CATS[e.category] || e.category}</span></td>
      <td>${h}${d}</td>
      <td class="amount-actual" style="white-space:nowrap">${fmt(+e.amount)}</td>
      <td>${esc(e.billing_id || '')}</td>
      <td><span class="badge-lumanu ${e.lumanu_status || 'not_sent'}">${LUMANU_STATUSES[e.lumanu_status] || 'Not Sent'}</span></td>
    </tr>`;
  }).join('');
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal() {
  editId = null;
  document.getElementById('modal-title').textContent = 'Add Entry';
  document.getElementById('btn-submit').textContent  = 'Add Entry';
  document.getElementById('entry-form').reset();
  document.getElementById('f-date').value = todayStr();
  document.getElementById('f-month').value = currentMonth;
  document.getElementById('f-lumanu-status').value = 'not_sent';
  document.getElementById('field-handle').classList.remove('hidden');
  document.getElementById('field-lumanu').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function openEditModal(entry) {
  editId = entry.id;
  document.getElementById('modal-title').textContent = 'Edit Entry';
  document.getElementById('btn-submit').textContent  = 'Save Changes';
  document.getElementById('entry-form').reset();
  document.getElementById('f-date').value        = entry.date;
  document.getElementById('f-month').value       = entry.month || 'September';
  document.getElementById('f-category').value    = entry.category || '';
  document.getElementById('f-handle').value      = entry.creator_handle || '';
  document.getElementById('f-description').value = entry.description || '';
  document.getElementById('f-amount').value      = entry.amount;
  document.getElementById('f-notes').value       = entry.notes || '';
  document.getElementById('f-billing-id').value  = entry.billing_id || '';
  document.getElementById('f-due-date').value    = entry.due_date || '';
  document.getElementById('f-po').value          = entry.po_number || '';
  document.getElementById('f-lumanu-status').value = entry.lumanu_status || 'not_sent';
  const showHandle = PAID_CATS.includes(entry.category);
  document.getElementById('field-handle').classList.toggle('hidden', !showHandle);
  document.getElementById('field-lumanu').classList.toggle('hidden', !showHandle);
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  editId = null;
  document.getElementById('modal-overlay').classList.add('hidden');
}
function openDelete(id) {
  deleteId = id;
  document.getElementById('delete-overlay').classList.remove('hidden');
}
function closeDelete() {
  deleteId = null;
  document.getElementById('delete-overlay').classList.add('hidden');
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sum(arr) { return arr.reduce((s, r) => s + Number(r.amount), 0); }
function fmt(n)   { return '$' + Math.round(n).toLocaleString('en-US'); }
function pad(n)   { return String(n).padStart(2, '0'); }
function todayStr() { return new Date().toISOString().split('T')[0]; }

function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${+m}/${+d}/${y}`;
}
function fmtDateLong(s) {
  if (!s) return '';
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setHTML(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = val;
}
function setStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
