/* Refold AI GTM Dashboard — vanilla JS
   Persistent feedback writes to Supabase via PostgREST.
   Anon key is intentionally public (RLS-protected). */

const SUPABASE_URL  = 'https://ezgzvebkainfblczysmb.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6Z3p2ZWJrYWluZmJsY3p5c21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTg3MjUsImV4cCI6MjA5Mjc3NDcyNX0.-sqZ29HDBQ37yN7Xspy1hc2aQG9D0StmODQTcV9IxCQ';

async function sbRequest(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_ANON,
    'Authorization': `Bearer ${SUPABASE_ANON}`,
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

// ============= IDENTITY =============
function getAuthor() {
  let author = localStorage.getItem('dashboard:author');
  if (!author) {
    author = (prompt('Who are you? (Tejas / Maajid / Mani / Archit / Jugal / Rish / Tanmay)\nThis name is attached to your notes so the team knows who said what.') || 'anonymous').trim();
    if (!author) author = 'anonymous';
    localStorage.setItem('dashboard:author', author);
  }
  return author;
}

const STAGE_COLOR_CLASS = {
  'Cold': 'st-Cold', 'Reached': 'st-Reached', 'Aware': 'st-Aware',
  'Engaged': 'st-Engaged', 'SDR Contacted': 'st-SDR',
  'Opportunity': 'st-Opportunity',
  'SQL': 'st-SQL',
  'Demo Done': 'st-DemoDone', 'AE Introduced': 'st-AEIntroduced',
  'Proposal': 'st-Proposal', 'Won': 'st-Won', 'Lost': 'st-Lost',
};

const QUICK_TAGS = [
  '✓ good fit', '✗ not a real opp', '✓ contacted',
  '✗ wrong contact', '⏳ waiting on data', '★ high priority',
];

let DATA = null;
let SELECTED_STAGE = null;
let SELECTED_DOMAIN = null;
let PAGE = 0;
const PAGE_SIZE = 30;

// ============= INIT =============
let FEEDBACK_BY_SCOPE = {}; // {scope:scope_key: [{...}]} loaded once at startup

async function loadFeedback() {
  try {
    const rows = await sbRequest('dashboard_feedback?select=*&order=created_at.desc');
    FEEDBACK_BY_SCOPE = {};
    for (const r of rows) {
      const k = `${r.scope}:${r.scope_key}`;
      (FEEDBACK_BY_SCOPE[k] = FEEDBACK_BY_SCOPE[k] || []).push(r);
    }
  } catch (e) {
    console.warn('feedback load failed:', e);
    FEEDBACK_BY_SCOPE = {};
  }
}

async function load() {
  // cache-bust to always pull latest dashboard.json
  const [res, _] = await Promise.all([
    fetch('dashboard.json?_=' + Date.now()),
    loadFeedback(),
  ]);
  if (!res.ok) {
    document.querySelector('main').innerHTML =
      '<div class="card"><h2 style="color:var(--red)">Could not load dashboard.json</h2>' +
      '<p class="dim">Run <code>routine_dashboard_data</code> first.</p></div>';
    return;
  }
  DATA = await res.json();
  // ensure identity exists
  getAuthor();
  document.getElementById('generated-at').textContent =
    'Updated ' + formatTime(DATA.generated_at);
  renderKPIs();
  renderFunnel();
  renderAxes();
  renderWeeklyChart();
  renderWindows();
  renderNotes();
}

document.getElementById('refresh-btn').addEventListener('click', load);
document.getElementById('author-pill').addEventListener('click', () => {
  const cur = localStorage.getItem('dashboard:author') || '';
  const next = (prompt('Who are you? (Tejas / Maajid / Mani / Archit / Jugal / Rish / Tanmay)', cur) || '').trim();
  if (next) {
    localStorage.setItem('dashboard:author', next);
    location.reload();
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const a = getAuthor();
  document.getElementById('author-pill').textContent = '◉ ' + a;
  load();
});

// ============= KPIs =============
function renderKPIs() {
  const t = DATA.totals;
  const f = DATA.funnel_active_target;
  const engagedPct = ((f.Engaged || 0) / Math.max(1, t.active_target_accounts) * 100).toFixed(1);
  const html = [
    kpi(fmt(t.tam_accounts), 'TAM accounts'),
    kpi(fmt(t.active_target_accounts), 'Active target (ICP-fit)'),
    kpi(fmt(t.signals_30d), 'Signals (30d)'),
    kpi(fmt(f.Engaged || 0) + ` <span class="accent">·${engagedPct}%</span>`, 'Engaged accounts'),
    kpi(fmt((f.SQL || 0) + (f['Demo Done'] || 0)), 'Meeting+ booked'),
    kpi(fmt((f['AE Introduced'] || 0) + (f.Proposal || 0)), 'Active opps'),
  ].join('');
  document.getElementById('kpi-strip').innerHTML = html;
}
function kpi(v, l) {
  return `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
}

// ============= FUNNEL =============
function renderFunnel() {
  const total = DATA.totals.active_target_accounts;
  const max = Math.max(...Object.values(DATA.funnel_active_target));
  const rows = DATA.stage_order.map(st => {
    const c = DATA.funnel_active_target[st] || 0;
    const pct = total > 0 ? (c / total * 100).toFixed(1) : '0';
    const w = max > 0 ? (c / max * 100).toFixed(1) : 0;
    const cls = STAGE_COLOR_CLASS[st] || 'st-Cold';
    return `<div class="fb-row" data-stage="${st}">
      <div class="fb-name">${st}</div>
      <div class="fb-bar-track"><div class="fb-bar-fill ${cls}" style="width:${w}%"></div></div>
      <div class="fb-count">${fmt(c)}</div>
      <div class="fb-pct">${pct}%</div>
    </div>`;
  }).join('');
  document.getElementById('funnel-bars').innerHTML = rows;
  document.getElementById('funnel-subtitle').textContent =
    `${fmt(total)} ICP-fit accounts · ${fmt(DATA.totals.tam_accounts)} TAM total`;

  // wire clicks
  document.querySelectorAll('.fb-row').forEach(row => {
    row.addEventListener('click', () => selectStage(row.dataset.stage));
  });
}

function selectStage(stage) {
  SELECTED_STAGE = stage;
  SELECTED_DOMAIN = null;
  PAGE = 0;
  document.querySelectorAll('.fb-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.stage === stage);
  });
  renderStagePanel();
  document.getElementById('stage-panel').scrollIntoView({behavior:'smooth', block:'start'});
}

// ============= STAGE PANEL =============
function renderStagePanel() {
  const panel = document.getElementById('stage-panel');
  if (!SELECTED_STAGE) { panel.hidden = true; return; }
  const data = DATA.stages[SELECTED_STAGE] || {accounts:[]};
  panel.hidden = false;
  document.getElementById('stage-title').textContent = SELECTED_STAGE;
  document.getElementById('stage-meta').textContent =
    `${fmt(data.count || 0)} accounts at this stage` +
    (data.has_more ? ` · top ${data.accounts.length} shown` : '');
  document.getElementById('stage-why').textContent = data.why_matters || '';
  document.getElementById('stage-suggested').textContent = data.suggested_action || '';
  renderAccountTable();
  renderAccountDetail();
}

function renderAccountTable() {
  const data = DATA.stages[SELECTED_STAGE] || {accounts:[]};
  const accounts = data.accounts;
  const start = PAGE * PAGE_SIZE;
  const slice = accounts.slice(start, start + PAGE_SIZE);
  const tbody = document.getElementById('account-tbody');
  tbody.innerHTML = slice.map(a => {
    const tier = (a.tier || 'untiered').replace(/[^A-Z0-9]/g, '');
    return `<tr class="acct-row${a.domain === SELECTED_DOMAIN ? ' selected':''}" data-domain="${escapeAttr(a.domain)}">
      <td>
        <div class="acct-name">${escapeHtml(a.company_name || a.domain)}</div>
        <div class="acct-domain">${escapeHtml(a.domain)}</div>
      </td>
      <td><span class="tier-tag ${tier}">${escapeHtml(a.tier || '—')}</span></td>
      <td class="score-cell">${a.priority_score}</td>
      <td class="why-cell" title="${escapeAttr(a.why_now)}">${escapeHtml(a.why_now || '—')}</td>
      <td>${escapeHtml(a.ae_owner || '—')}</td>
      <td class="mono small dim">${escapeHtml(a.top_signal_date || '—')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="dim small" style="padding:24px;text-align:center;">No accounts in this stage.</td></tr>';

  // paging
  const total = accounts.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pagingDiv = document.getElementById('account-paging');
  if (total <= PAGE_SIZE) {
    pagingDiv.innerHTML = '';
  } else {
    pagingDiv.innerHTML = `
      <button id="prev-pg" ${PAGE === 0 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${PAGE + 1} of ${totalPages} — ${fmt(total)} accounts ${data.has_more ? `(top ${total} of ${fmt(data.total_in_stage_active)})` : ''}</span>
      <button id="next-pg" ${PAGE >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
    `;
    document.getElementById('prev-pg').addEventListener('click', () => { PAGE--; renderAccountTable(); });
    document.getElementById('next-pg').addEventListener('click', () => { PAGE++; renderAccountTable(); });
  }

  document.querySelectorAll('.acct-row').forEach(row => {
    row.addEventListener('click', () => {
      SELECTED_DOMAIN = row.dataset.domain;
      renderAccountTable();
      renderAccountDetail();
      // Scroll the detail panel into view (small delay for render)
      setTimeout(() => {
        const d = document.getElementById('account-detail');
        if (d && !d.hidden) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    });
  });
}

function renderAccountDetail() {
  const detailDiv = document.getElementById('account-detail');
  if (!SELECTED_DOMAIN) { detailDiv.hidden = true; return; }
  const data = DATA.stages[SELECTED_STAGE] || {accounts:[]};
  const a = data.accounts.find(x => x.domain === SELECTED_DOMAIN);
  if (!a) { detailDiv.hidden = true; return; }
  detailDiv.hidden = false;

  const contactsHtml = (a.contacts || []).map(c => `
    <li class="contact-item">
      <div class="nm">${escapeHtml(c.name)} <span class="dim small">${escapeHtml(c.seniority || '')}</span></div>
      <div class="ti">${escapeHtml(c.title || '')}</div>
      <div class="em">${escapeHtml(c.email || '')}${c.phone ? ' · 📱 ' + escapeHtml(c.phone) : ''}</div>
    </li>
  `).join('') || '<li class="dim small">No contacts found at this account.</li>';

  const sigsHtml = (a.recent_signals || []).map(s => `
    <li class="signal-item">
      <span class="sig-date">${escapeHtml(s.date)}</span>
      <span class="sig-type">${escapeHtml(s.type)}</span>
      <span class="sig-source">· ${escapeHtml(s.source)}${s.channel ? ' / ' + escapeHtml(s.channel) : ''}</span>
      <div class="sig-details">${escapeHtml(s.details)}</div>
    </li>
  `).join('') || '<li class="dim small">No signals in window.</li>';

  // pull feedback for this account from team
  const author = getAuthor();
  const scopeKey = `account:${SELECTED_DOMAIN}`;
  const allFeedback = FEEDBACK_BY_SCOPE[scopeKey] || [];
  const myFeedback = allFeedback.find(r => r.author === author) || {};
  const teamFeedback = allFeedback.filter(r => r.author !== author);
  const tagButtons = QUICK_TAGS.map(t =>
    `<button class="qtag${(myFeedback.tags || []).includes(t) ? ' active' : ''}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`
  ).join('');

  detailDiv.innerHTML = `
    <div class="ad-head">
      <div>
        <h3>${escapeHtml(a.company_name || a.domain)}</h3>
        <div class="dim small">${escapeHtml(a.domain)} · ${escapeHtml(a.tier || '')} · ${escapeHtml(a.industry || '')} · ${escapeHtml(a.country || '')}</div>
      </div>
      <div class="ad-meta">score ${a.priority_score} · stage ${escapeHtml(SELECTED_STAGE)}</div>
    </div>

    ${a.why_now ? `<div class="why-matters" style="border:none;padding:0;margin-bottom:14px;"><strong style="color:var(--gold);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Why now:</strong> ${escapeHtml(a.why_now)}</div>` : ''}
    ${a.outreach_angle ? `<div class="why-matters" style="border:none;padding:0;margin-bottom:14px;"><strong style="color:var(--gold);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Outreach angle:</strong> ${escapeHtml(a.outreach_angle)}</div>` : ''}

    <div class="ad-grid">
      <div class="ad-section">
        <h4>Contacts (${(a.contacts || []).length})</h4>
        <ul class="contacts-list">${contactsHtml}</ul>
      </div>
      <div class="ad-section">
        <h4>Recent signals (${(a.recent_signals || []).length})</h4>
        <ul class="signals-list">${sigsHtml}</ul>
      </div>
    </div>

    <div class="ad-feedback">
      <h4>Your feedback (as ${escapeHtml(author)})</h4>
      <textarea id="fb-text" placeholder="What's right or wrong about this? What needs to happen for it to progress?">${escapeHtml(myFeedback.note || '')}</textarea>
      <div class="quick-tags">${tagButtons}</div>
      <div id="fb-saved" class="saved-stamp" style="display:none">Saved to team.</div>

      ${teamFeedback.length ? `
        <h4 style="margin-top:18px">Team has said (${teamFeedback.length})</h4>
        <ul class="signals-list">
          ${teamFeedback.map(t => `<li class="signal-item">
            <span class="sig-date">${escapeHtml(t.author || 'anonymous')}</span>
            <span class="sig-source">· ${escapeHtml((t.created_at || '').slice(0, 10))}</span>
            ${(t.tags || []).length ? `<span class="dim small"> · ${escapeHtml((t.tags || []).join(', '))}</span>` : ''}
            ${t.note ? `<div class="sig-details">${escapeHtml(t.note)}</div>` : ''}
          </li>`).join('')}
        </ul>` : ''}
    </div>
  `;

  // wire feedback save (debounced to Supabase)
  const ta = document.getElementById('fb-text');
  ta.addEventListener('input', () => debouncedSaveFeedback('account', SELECTED_DOMAIN));
  document.querySelectorAll('.qtag').forEach(b => {
    b.addEventListener('click', () => { b.classList.toggle('active'); debouncedSaveFeedback('account', SELECTED_DOMAIN); });
  });
}

let __fbDebounce = null;
function debouncedSaveFeedback(scope, scopeKey) {
  clearTimeout(__fbDebounce);
  __fbDebounce = setTimeout(() => saveFeedbackToSupabase(scope, scopeKey), 600);
}

async function saveFeedbackToSupabase(scope, scopeKey) {
  const note = (document.getElementById('fb-text') || {}).value || '';
  const tags = Array.from(document.querySelectorAll('.qtag.active')).map(b => b.dataset.tag);
  const author = getAuthor();
  const k = `${scope}:${scopeKey}`;
  const existing = (FEEDBACK_BY_SCOPE[k] || []).find(r => r.author === author);

  try {
    if (existing) {
      // update
      await sbRequest(`dashboard_feedback?id=eq.${existing.id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ note, tags, updated_at: new Date().toISOString() }),
      });
      Object.assign(existing, { note, tags, updated_at: new Date().toISOString() });
    } else {
      // insert
      const inserted = await sbRequest('dashboard_feedback', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify([{ scope, scope_key: scopeKey, author, note, tags }]),
      });
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      (FEEDBACK_BY_SCOPE[k] = FEEDBACK_BY_SCOPE[k] || []).push(row);
    }
    const s = document.getElementById('fb-saved');
    if (s) {
      s.style.display = 'block';
      clearTimeout(window.__fbStampTO);
      window.__fbStampTO = setTimeout(() => { s.style.display = 'none'; }, 1200);
    }
  } catch (e) {
    console.warn('save failed:', e);
    alert('Could not save feedback: ' + e.message);
  }
}

// ============= AXES =============
function renderAxes() {
  const grid = document.getElementById('axes-grid');
  const axes = [
    { key: 'by_source',   label: 'By source / agency' },
    { key: 'by_channel',  label: 'By channel' },
    { key: 'by_campaign', label: 'By campaign' },
    { key: 'by_sdr',      label: 'By SDR' },
  ];
  grid.innerHTML = axes.map(({key, label}) => {
    const data = DATA.axes[key] || {};
    const totals = Object.entries(data)
      .map(([k, stages]) => [k, Object.values(stages).reduce((a, b) => a + b, 0)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (totals.length === 0) return `<div class="axis-card"><h3>${label}</h3><div class="dim small">No data.</div></div>`;
    const max = Math.max(...totals.map(t => t[1]));
    const rows = totals.map(([k, n]) => {
      const w = (n / max * 100).toFixed(0);
      return `<div class="axis-row">
        <div class="axis-label" title="${escapeAttr(k)}">${escapeHtml(truncate(k, 22))}</div>
        <div class="axis-bar"><div class="axis-bar-fill" style="width:${w}%"></div></div>
        <div class="axis-count">${fmt(n)}</div>
      </div>`;
    }).join('');
    return `<div class="axis-card"><h3>${label}</h3>${rows}</div>`;
  }).join('');
}

// ============= WEEKLY CHART =============
function renderWeeklyChart() {
  const wk = DATA.weekly_volume_by_source || {};
  const weeks = Object.keys(wk).sort();
  if (weeks.length === 0) return;
  const sources = new Set();
  weeks.forEach(w => Object.keys(wk[w]).forEach(s => sources.add(s)));
  const palette = ['#d4a24c', '#4a8074', '#4a5c7a', '#b5495c', '#72a3c9', '#9b6dba', '#c98c4a', '#5fa860'];
  const datasets = Array.from(sources).map((s, i) => ({
    label: s,
    data: weeks.map(w => wk[w][s] || 0),
    backgroundColor: palette[i % palette.length],
    borderWidth: 0,
  }));
  const ctx = document.getElementById('weekly-chart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: { labels: weeks.map(w => w.slice(5)), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { color: '#a89c8a' }, grid: { color: '#2c354a' } },
        y: { stacked: true, ticks: { color: '#a89c8a' }, grid: { color: '#2c354a' } },
      },
      plugins: {
        legend: { labels: { color: '#a89c8a', font: { size: 11 } } },
        tooltip: { mode: 'index' }
      }
    }
  });
}

// ============= TIME WINDOWS =============
function renderWindows() {
  const w = DATA.time_windows || {};
  const items = [
    { k: 'month_to_date', label: 'Month to date', sub: w.month_to_date && `since ${w.month_to_date.start}` },
    { k: 'last_week',     label: 'Last week',     sub: w.last_week && `${w.last_week.start} → ${w.last_week.end}` },
    { k: 'this_week',     label: 'This week',     sub: w.this_week && `since ${w.this_week.start}` },
  ];
  document.getElementById('windows-grid').innerHTML = items.map(i => {
    const v = (w[i.k] && w[i.k].signals) || 0;
    return `<div class="window-card">
      <div class="label">${i.label}</div>
      <div class="value">${fmt(v)}</div>
      <div class="sub">${i.sub || ''}</div>
    </div>`;
  }).join('');
}

// ============= NOTES (stage-level, persisted to Supabase) =============
function renderNotes() {
  const grid = document.getElementById('notes-grid');
  const author = getAuthor();
  grid.innerHTML = DATA.stage_order.map(st => {
    const data = DATA.stages[st] || {};
    const k = `stage:${st}`;
    const all = FEEDBACK_BY_SCOPE[k] || [];
    const mine = all.find(r => r.author === author) || {};
    const team = all.filter(r => r.author !== author);
    return `<div class="note-card">
      <h4>${st} · ${fmt(data.count || 0)}</h4>
      <div class="stage-suggested">${escapeHtml(data.suggested_action || '')}</div>
      <textarea data-stage="${escapeAttr(st)}" placeholder="What needs to happen for this stage…">${escapeHtml(mine.note || '')}</textarea>
      ${team.length ? `<div class="dim small" style="margin-top:6px;">Team: ${team.map(t => `<span title="${escapeAttr(t.note || '')}" style="margin-right:8px;border-bottom:1px dotted var(--ink-dim)">${escapeHtml(t.author || '?')}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  document.querySelectorAll('.note-card textarea').forEach(ta => {
    ta.addEventListener('input', () => {
      clearTimeout(ta.__t);
      ta.__t = setTimeout(() => saveStageNote(ta.dataset.stage, ta.value), 600);
    });
  });
  document.getElementById('export-notes-btn').addEventListener('click', exportNotes);
  document.getElementById('clear-notes-btn').addEventListener('click', clearMyNotes);
}

async function saveStageNote(stage, note) {
  const author = getAuthor();
  const k = `stage:${stage}`;
  const existing = (FEEDBACK_BY_SCOPE[k] || []).find(r => r.author === author);
  try {
    if (existing) {
      await sbRequest(`dashboard_feedback?id=eq.${existing.id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ note, updated_at: new Date().toISOString() }),
      });
      existing.note = note;
    } else {
      const inserted = await sbRequest('dashboard_feedback', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify([{ scope: 'stage', scope_key: stage, author, note, tags: [] }]),
      });
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      (FEEDBACK_BY_SCOPE[k] = FEEDBACK_BY_SCOPE[k] || []).push(row);
    }
  } catch (e) { console.warn('stage note save failed:', e); }
}

async function clearMyNotes() {
  const author = getAuthor();
  if (!confirm(`Delete all your (${author}) feedback from the team log? This is permanent.`)) return;
  try {
    await sbRequest(`dashboard_feedback?author=eq.${encodeURIComponent(author)}`, { method: 'DELETE' });
    location.reload();
  } catch (e) { alert('Delete failed: ' + e.message); }
}

function exportNotes() {
  const lines = ['# Refold GTM Dashboard — Team Feedback Export', '',
                 `Generated: ${new Date().toISOString()}`, ''];
  // group by scope
  lines.push('## Stage notes (all team)\n');
  DATA.stage_order.forEach(st => {
    const all = FEEDBACK_BY_SCOPE[`stage:${st}`] || [];
    if (!all.length) return;
    lines.push(`### ${st}`);
    all.forEach(r => {
      lines.push(`**${r.author || 'anon'}** (${(r.created_at || '').slice(0,10)}):`);
      if (r.note) lines.push(r.note);
      lines.push('');
    });
  });
  lines.push('## Per-account feedback (all team)\n');
  Object.entries(FEEDBACK_BY_SCOPE)
    .filter(([k]) => k.startsWith('account:'))
    .forEach(([k, all]) => {
      const dom = k.replace('account:', '');
      lines.push(`### ${dom}`);
      all.forEach(r => {
        lines.push(`**${r.author || 'anon'}** (${(r.created_at || '').slice(0,10)})${r.tags && r.tags.length ? ` — ${r.tags.join(', ')}` : ''}:`);
        if (r.note) lines.push(r.note);
        lines.push('');
      });
    });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `refold-gtm-team-feedback-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
}

// ============= UTIL =============
function fmt(n) { return (n || 0).toLocaleString('en-US'); }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function formatTime(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}
