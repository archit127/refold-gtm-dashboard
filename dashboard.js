/* Refold AI GTM Pipeline Dashboard — vanilla JS, business-grade view */

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

function getAuthor() {
  let a = localStorage.getItem('dashboard:author');
  if (!a) {
    a = (prompt('Who are you? (Tejas / Maajid / Mani / Archit / Jugal / Rish / Tanmay)\nName attached to your notes so the team knows who said what.') || 'anonymous').trim();
    if (!a) a = 'anonymous';
    localStorage.setItem('dashboard:author', a);
  }
  return a;
}

const STAGE_CLASS = {
  'Cold': 'st-Cold', 'Reached': 'st-Reached', 'Aware': 'st-Aware',
  'Engaged': 'st-Engaged', 'SDR Contacted': 'st-SDR',
  'Opportunity': 'st-Opportunity',
  'SQL': 'st-SQL', 'Demo Done': 'st-DemoDone',
  'AE Introduced': 'st-AEIntroduced', 'Proposal': 'st-Proposal',
  'Won': 'st-Won', 'Lost': 'st-Lost',
};

const QUICK_TAGS = [
  '✓ good fit', '✗ not a real opp', '✓ contacted',
  '✗ wrong contact', '⏳ waiting on data', '★ high priority',
];

const WINDOW_LABELS = {
  'this_week': 'this week', 'this_month': 'this month',
  'this_quarter': 'this quarter', 'ytd': 'YTD',
  'last_30d': 'last 30d', 'all_time': 'all-time',
};

let DATA = null;
let SELECTED_STAGE = null;
let SELECTED_DOMAIN = null;
let SELECTED_WINDOW = 'all_time';
let PAGE = 0;
const PAGE_SIZE = 30;
let FEEDBACK_BY_SCOPE = {};

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
  const [res] = await Promise.all([
    fetch('dashboard.json?_=' + Date.now()),
    loadFeedback(),
  ]);
  if (!res.ok) {
    document.querySelector('main').innerHTML =
      '<div class="card"><h2 style="color:var(--red)">Could not load dashboard.json</h2></div>';
    return;
  }
  DATA = await res.json();
  getAuthor();
  SELECTED_WINDOW = localStorage.getItem('dashboard:window') || 'all_time';
  document.getElementById('generated-at').textContent =
    'Updated ' + formatTime(DATA.generated_at);
  wireWindowPills();
  renderAll();
}

function renderAll() {
  renderKPIs();
  renderMovement();
  renderFunnel();
  renderTopOpps();
  renderStalled();
  renderBySrcCamp();
  renderNotes();
  renderStagePanel();
  renderWindowMeta();
}

document.getElementById('refresh-btn').addEventListener('click', load);
document.getElementById('author-pill').addEventListener('click', () => {
  const cur = localStorage.getItem('dashboard:author') || '';
  const next = (prompt('Who are you?', cur) || '').trim();
  if (next) { localStorage.setItem('dashboard:author', next); location.reload(); }
});
document.addEventListener('DOMContentLoaded', () => {
  const a = getAuthor();
  document.getElementById('author-pill').textContent = '◉ ' + a;
  load();
});

function wireWindowPills() {
  document.querySelectorAll('.wpill').forEach(p => {
    p.classList.toggle('active', p.dataset.w === SELECTED_WINDOW);
    p.addEventListener('click', () => {
      SELECTED_WINDOW = p.dataset.w;
      localStorage.setItem('dashboard:window', SELECTED_WINDOW);
      document.querySelectorAll('.wpill').forEach(q =>
        q.classList.toggle('active', q.dataset.w === SELECTED_WINDOW));
      // Reset selected stage so user sees the new window's funnel cleanly
      PAGE = 0;
      renderAll();
    });
  });
}

function renderWindowMeta() {
  const meta = document.getElementById('window-meta');
  if (!meta) return;
  const f = DATA.funnel_by_window?.[SELECTED_WINDOW] || {};
  const totalActive = Object.values(f).reduce((a,b) => a+b, 0);
  const wstart = (DATA.window_starts || {})[SELECTED_WINDOW];
  if (SELECTED_WINDOW === 'all_time') {
    meta.textContent = `${fmt(totalActive)} active-target accounts · all-time snapshot`;
  } else {
    meta.textContent = `${fmt(totalActive)} accounts active in window · since ${wstart || '?'}`;
  }
}

// ============= KPIs (all window-aware) =============
function renderKPIs() {
  const t = DATA.totals || {};
  const f = (DATA.funnel_by_window || {})[SELECTED_WINDOW] || {};
  const wlabel = WINDOW_LABELS[SELECTED_WINDOW] || SELECTED_WINDOW;

  // window-aware sums
  const totalActive  = Object.values(f).reduce((a, b) => a + b, 0);
  const inMotion     = totalActive - (f.Cold || 0);
  const engagedPlus  = (f.Engaged || 0) + (f['SDR Contacted'] || 0) +
                       (f.Opportunity || 0) + (f.SQL || 0) + (f['Demo Done'] || 0);
  const opportunity  = f.Opportunity || 0;
  const meetings     = (f.SQL || 0) + (f['Demo Done'] || 0);
  // Engaged → Opportunity conversion: of Engaged+ accounts, how many crossed into Opportunity+
  const engToOppDenom = (f.Engaged || 0) + (f['SDR Contacted'] || 0) +
                        (f.Opportunity || 0) + (f.SQL || 0) + (f['Demo Done'] || 0);
  const engToOppNum   = (f.Opportunity || 0) + (f.SQL || 0) + (f['Demo Done'] || 0);
  const engToOpp      = engToOppDenom > 0 ? (engToOppNum / engToOppDenom * 100).toFixed(1) : '0';
  const engagedPct    = totalActive > 0 ? (engagedPlus / totalActive * 100).toFixed(1) : '0';

  const items = [
    kpi(fmt(t.active_target_accounts || 0), 'Active target (ICP-fit)'),
    kpi(fmt(inMotion), `In motion (${wlabel})`),
    kpi(fmt(engagedPlus) + ` <span class="accent">·${engagedPct}%</span>`, `Engaged+ (${wlabel})`),
    kpi(fmt(opportunity), `In Opportunity (${wlabel})`),
    kpi(fmt(meetings), `Meetings booked (${wlabel})`),
    kpi(engToOpp + '%', `Engaged → Opportunity conversion`),
  ];
  document.getElementById('kpi-strip').innerHTML = items.join('');
}
function kpi(v, l) {
  return `<div class="kpi"><div class="v">${v}</div><div class="l">${escapeHtml(l)}</div></div>`;
}

// ============= MOVEMENT BANNER =============
function renderMovement() {
  const card = document.getElementById('movement-card');
  if (SELECTED_WINDOW === 'all_time') { card.hidden = true; return; }
  const m = (DATA.movement || {})[SELECTED_WINDOW] || {};
  const wlabel = WINDOW_LABELS[SELECTED_WINDOW] || SELECTED_WINDOW;
  document.getElementById('movement-title').textContent = `Activity ${wlabel}`;
  document.getElementById('movement-grid').innerHTML = [
    movementCell(fmt(m.sdr_actionable || 0), 'SDR-actionable'),
    movementCell(fmt(m.new_engaged_or_above || 0), 'Engaged or above'),
    movementCell(fmt(m.opportunities_active || 0), 'In Opportunity'),
    movementCell(fmt(m.meetings_booked || 0), 'Meetings booked (SQL+Demo)'),
  ].join('');
  card.hidden = false;
}
function movementCell(big, label, sub) {
  return `<div class="movement-cell"><div class="big">${big}</div><div class="lbl">${label}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

// ============= FUNNEL =============
function renderFunnel() {
  const funnel = DATA.funnel_by_window?.[SELECTED_WINDOW] || {};
  const conv = (DATA.conversions_by_window || {})[SELECTED_WINDOW] || {};
  const total = Object.values(funnel).reduce((a,b) => a+b, 0);
  const max = Math.max(...Object.values(funnel), 1);

  const rows = DATA.stage_order.map((st, i) => {
    const c = funnel[st] || 0;
    const pct = total > 0 ? (c / total * 100).toFixed(1) : '0';
    const w = max > 0 ? (c / max * 100).toFixed(1) : 0;
    const cls = STAGE_CLASS[st] || 'st-Cold';
    const convPct = (i < DATA.stage_order.length - 1) ? conv[st] : null;
    const convStr = convPct !== null && convPct > 0
      ? `<span class="fb-conv ${convPct >= 30 ? 'good' : (convPct >= 10 ? 'ok' : 'low')}">→ ${convPct}%</span>`
      : '<span></span>';
    return `<div class="fb-row" data-stage="${st}">
      <div class="fb-name">${st}</div>
      <div class="fb-bar-track"><div class="fb-bar-fill ${cls}" style="width:${w}%"></div></div>
      <div class="fb-count">${fmt(c)}</div>
      <div class="fb-pct">${pct}%</div>
      ${convStr}
    </div>`;
  }).join('');
  document.getElementById('funnel-bars').innerHTML = rows;
  const wlabel = WINDOW_LABELS[SELECTED_WINDOW] || SELECTED_WINDOW;
  document.getElementById('funnel-subtitle').textContent =
    SELECTED_WINDOW === 'all_time'
      ? `Snapshot of ${fmt(total)} accounts · arrows show conversion to next stage`
      : `${fmt(total)} accounts active in ${wlabel} · arrows show conversion`;

  document.querySelectorAll('.fb-row').forEach(row => {
    row.addEventListener('click', () => selectStage(row.dataset.stage));
  });
  // restore selection styling
  document.querySelectorAll('.fb-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.stage === SELECTED_STAGE);
  });
}

function selectStage(stage) {
  SELECTED_STAGE = stage;
  SELECTED_DOMAIN = null;
  PAGE = 0;
  document.querySelectorAll('.fb-row').forEach(r =>
    r.classList.toggle('selected', r.dataset.stage === stage));
  renderStagePanel();
  document.getElementById('stage-panel').scrollIntoView({behavior:'smooth', block:'start'});
}

// ============= STAGE PANEL =============
function renderStagePanel() {
  const panel = document.getElementById('stage-panel');
  if (!SELECTED_STAGE) { panel.hidden = true; return; }
  const data = (DATA.stages_by_window?.[SELECTED_WINDOW] || {})[SELECTED_STAGE] || { accounts: [] };
  panel.hidden = false;
  document.getElementById('stage-title').textContent = SELECTED_STAGE;
  let metaParts = [`${fmt(data.count || 0)} accounts`];
  if (data.pipeline_$ > 0) metaParts.push(`$${fmt(data.pipeline_$)} pipeline`);
  if (data.has_more) metaParts.push(`top ${data.accounts.length} shown of ${fmt(data.total_in_stage_active)}`);
  document.getElementById('stage-meta').textContent = metaParts.join(' · ');
  document.getElementById('stage-why').textContent = data.why_matters || '';
  document.getElementById('stage-suggested').textContent = data.suggested_action || '';
  renderAccountTable();
  renderAccountDetail();
}

function renderAccountTable() {
  const data = (DATA.stages_by_window?.[SELECTED_WINDOW] || {})[SELECTED_STAGE] || { accounts: [] };
  const accounts = data.accounts;
  const start = PAGE * PAGE_SIZE;
  const slice = accounts.slice(start, start + PAGE_SIZE);
  const tbody = document.getElementById('account-tbody');
  tbody.innerHTML = slice.map(a => {
    const tier = (a.tier || 'untiered').replace(/[^A-Z0-9]/g, '');
    return `<tr class="acct-row${a.domain === SELECTED_DOMAIN ? ' selected':''}" data-domain="${escapeAttr(a.domain)}">
      <td><div class="acct-name">${escapeHtml(a.company_name || a.domain)}</div>
          <div class="acct-domain">${escapeHtml(a.domain)}</div></td>
      <td><span class="tier-tag ${tier}">${escapeHtml(a.tier || '—')}</span></td>
      <td class="score-cell">${a.priority_score}</td>
      <td class="why-cell" title="${escapeAttr(a.why_now)}">${escapeHtml(a.why_now || '—')}</td>
      <td>${escapeHtml(a.ae_owner || '—')}</td>
      <td class="mono small dim">${escapeHtml(a.top_signal_date || '—')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="dim small" style="padding:24px;text-align:center;">No accounts in this stage / window.</td></tr>';

  const total = accounts.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const pagingDiv = document.getElementById('account-paging');
  if (total <= PAGE_SIZE) {
    pagingDiv.innerHTML = '';
  } else {
    pagingDiv.innerHTML = `
      <button id="prev-pg" ${PAGE === 0 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${PAGE + 1} of ${pages} · ${fmt(total)} accounts ${data.has_more ? `(top ${total} of ${fmt(data.total_in_stage_active)})` : ''}</span>
      <button id="next-pg" ${PAGE >= pages - 1 ? 'disabled' : ''}>Next →</button>`;
    document.getElementById('prev-pg').addEventListener('click', () => { PAGE--; renderAccountTable(); });
    document.getElementById('next-pg').addEventListener('click', () => { PAGE++; renderAccountTable(); });
  }

  document.querySelectorAll('.acct-row').forEach(row => {
    row.addEventListener('click', () => {
      SELECTED_DOMAIN = row.dataset.domain;
      renderAccountTable();
      renderAccountDetail();
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
  const data = (DATA.stages_by_window?.[SELECTED_WINDOW] || {})[SELECTED_STAGE] || { accounts: [] };
  const a = data.accounts.find(x => x.domain === SELECTED_DOMAIN);
  if (!a) { detailDiv.hidden = true; return; }
  detailDiv.hidden = false;

  const contactsHtml = (a.contacts || []).map(c => `
    <li class="contact-item">
      <div class="nm">${escapeHtml(c.name)} <span class="dim small">${escapeHtml(c.seniority || '')}</span></div>
      <div class="ti">${escapeHtml(c.title || '')}</div>
      <div class="em">${escapeHtml(c.email || '')}${c.phone ? ' · 📱 ' + escapeHtml(c.phone) : ''}</div>
    </li>`).join('') || '<li class="dim small">No contacts found at this account.</li>';

  const sigsHtml = (a.recent_signals || []).map(s => `
    <li class="signal-item">
      <span class="sig-date">${escapeHtml(s.date)}</span>
      <span class="sig-type">${escapeHtml(s.type)}</span>
      <span class="sig-source">· ${escapeHtml(s.source)}${s.channel ? ' / ' + escapeHtml(s.channel) : ''}</span>
      <div class="sig-details">${escapeHtml(s.details)}</div>
    </li>`).join('') || '<li class="dim small">No signals in window.</li>';

  const author = getAuthor();
  const scopeKey = `account:${SELECTED_DOMAIN}`;
  const allFb = FEEDBACK_BY_SCOPE[scopeKey] || [];
  const myFb = allFb.find(r => r.author === author) || {};
  const teamFb = allFb.filter(r => r.author !== author);
  const tags = QUICK_TAGS.map(t =>
    `<button class="qtag${(myFb.tags || []).includes(t) ? ' active' : ''}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`
  ).join('');

  detailDiv.innerHTML = `
    <div class="ad-head">
      <div>
        <h3>${escapeHtml(a.company_name || a.domain)}</h3>
        <div class="dim small">${escapeHtml(a.domain)} · ${escapeHtml(a.tier || '')} · ${escapeHtml(a.industry || '')} · ${escapeHtml(a.country || '')}</div>
      </div>
      <div class="ad-meta">${a.open_deals_amount > 0 ? '$' + fmt(a.open_deals_amount) + ' · ' : ''}score ${a.priority_score} · ${escapeHtml(SELECTED_STAGE)}</div>
    </div>
    ${a.why_now ? `<div class="why-matters" style="border:none;padding:0;margin-bottom:14px;"><strong style="color:var(--gold);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Why now:</strong> ${escapeHtml(a.why_now)}</div>` : ''}
    ${a.outreach_angle ? `<div class="why-matters" style="border:none;padding:0;margin-bottom:14px;"><strong style="color:var(--gold);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Outreach angle:</strong> ${escapeHtml(a.outreach_angle)}</div>` : ''}

    <div class="ad-grid">
      <div class="ad-section"><h4>Contacts (${(a.contacts || []).length})</h4><ul class="contacts-list">${contactsHtml}</ul></div>
      <div class="ad-section"><h4>Recent signals (${(a.recent_signals || []).length})</h4><ul class="signals-list">${sigsHtml}</ul></div>
    </div>

    <div class="ad-feedback">
      <h4>Your feedback (as ${escapeHtml(author)})</h4>
      <textarea id="fb-text" placeholder="What's right or wrong about this? What needs to happen for it to progress?">${escapeHtml(myFb.note || '')}</textarea>
      <div class="quick-tags">${tags}</div>
      <div id="fb-saved" class="saved-stamp" style="display:none">Saved.</div>
      ${teamFb.length ? `<h4 style="margin-top:18px">Team has said (${teamFb.length})</h4>
        <ul class="signals-list">${teamFb.map(t => `<li class="signal-item">
          <span class="sig-date">${escapeHtml(t.author || 'anon')}</span>
          <span class="sig-source">· ${escapeHtml((t.created_at || '').slice(0,10))}</span>
          ${(t.tags || []).length ? `<span class="dim small"> · ${escapeHtml((t.tags || []).join(', '))}</span>` : ''}
          ${t.note ? `<div class="sig-details">${escapeHtml(t.note)}</div>` : ''}
        </li>`).join('')}</ul>` : ''}
    </div>
  `;
  document.getElementById('fb-text').addEventListener('input', () => debouncedSaveFeedback('account', SELECTED_DOMAIN));
  document.querySelectorAll('.qtag').forEach(b => {
    b.addEventListener('click', () => { b.classList.toggle('active'); debouncedSaveFeedback('account', SELECTED_DOMAIN); });
  });
}

let __fbT = null;
function debouncedSaveFeedback(scope, sk) {
  clearTimeout(__fbT);
  __fbT = setTimeout(() => saveFeedbackToSupabase(scope, sk), 600);
}
async function saveFeedbackToSupabase(scope, sk) {
  const note = (document.getElementById('fb-text') || {}).value || '';
  const tags = Array.from(document.querySelectorAll('.qtag.active')).map(b => b.dataset.tag);
  const author = getAuthor();
  const k = `${scope}:${sk}`;
  const existing = (FEEDBACK_BY_SCOPE[k] || []).find(r => r.author === author);
  try {
    if (existing) {
      await sbRequest(`dashboard_feedback?id=eq.${existing.id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ note, tags, updated_at: new Date().toISOString() }),
      });
      Object.assign(existing, { note, tags });
    } else {
      const inserted = await sbRequest('dashboard_feedback', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify([{ scope, scope_key: sk, author, note, tags }]),
      });
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      (FEEDBACK_BY_SCOPE[k] = FEEDBACK_BY_SCOPE[k] || []).push(row);
    }
    const s = document.getElementById('fb-saved');
    if (s) { s.style.display = 'block'; clearTimeout(window.__fbS); window.__fbS = setTimeout(() => s.style.display='none', 1200); }
  } catch (e) { console.warn('save failed:', e); alert('Save failed: ' + e.message); }
}

// ============= TOP DEMAND-GEN ACCOUNTS =============
function renderTopOpps() {
  const opps = DATA.top_demand_gen_accounts || DATA.top_opportunities || [];
  const html = opps.length === 0
    ? '<div class="dim small" style="padding:14px 0;">No accounts in active demand-gen stages yet.</div>'
    : `<table class="account-table">
        <thead><tr><th>Account</th><th>Stage</th><th>Tier</th><th>Score</th><th>Last sig</th><th>Why now</th></tr></thead>
        <tbody>${opps.map(o => `<tr>
          <td><div class="acct-name">${escapeHtml(o.company_name)}</div><div class="acct-domain">${escapeHtml(o.domain)}</div></td>
          <td><span class="tier-tag">${escapeHtml(o.stage)}</span></td>
          <td><span class="tier-tag ${escapeHtml((o.tier || '').replace(/[^A-Z0-9]/g,''))}">${escapeHtml(o.tier || '—')}</span></td>
          <td class="score-cell">${o.priority_score}</td>
          <td class="mono small dim">${escapeHtml(o.top_signal_date || '—')}</td>
          <td class="why-cell" title="${escapeAttr(o.why_now)}">${escapeHtml(o.why_now || '—')}</td>
        </tr>`).join('')}</tbody></table>`;
  document.getElementById('top-opps-table').innerHTML = html;
}

// ============= STALLED =============
function renderStalled() {
  const list = DATA.stalled || [];
  const html = list.length === 0
    ? '<div class="dim small" style="padding:14px 0;">No stalled accounts — nice.</div>'
    : `<table class="account-table">
        <thead><tr><th>Account</th><th>Stage</th><th>Tier</th><th>Score</th><th>Last signal</th><th>Days stalled</th><th>Why</th></tr></thead>
        <tbody>${list.map(s => `<tr>
          <td><div class="acct-name">${escapeHtml(s.company_name)}</div><div class="acct-domain">${escapeHtml(s.domain)}</div></td>
          <td><span class="tier-tag">${escapeHtml(s.stage)}</span></td>
          <td><span class="tier-tag ${escapeHtml((s.tier || '').replace(/[^A-Z0-9]/g,''))}">${escapeHtml(s.tier || '—')}</span></td>
          <td class="score-cell">${s.priority_score}</td>
          <td class="mono small dim">${escapeHtml(s.last_signal_date)}</td>
          <td class="score-cell" style="color:var(--red)">${s.days_since}d</td>
          <td class="why-cell" title="${escapeAttr(s.why_now)}">${escapeHtml(s.why_now || '—')}</td>
        </tr>`).join('')}</tbody></table>`;
  document.getElementById('stalled-table').innerHTML = html;
}

// ============= BY SOURCE / CAMPAIGN =============
function renderBySrcCamp() {
  const grid = document.getElementById('src-camp-grid');
  const src = DATA.by_source_opps || {};
  const camp = DATA.by_campaign_opps || {};

  function panel(label, data) {
    const sorted = Object.entries(data).sort((a, b) =>
      (b[1].engaged_plus + b[1].sql_demo * 5 + b[1].opportunity * 3) -
      (a[1].engaged_plus + a[1].sql_demo * 5 + a[1].opportunity * 3));
    const rows = sorted.slice(0, 8).map(([k, v]) => `
      <tr>
        <td>${escapeHtml(k)}</td>
        <td class="mono small">${v.unique_accounts || 0}</td>
        <td class="mono small">${v.engaged_plus || 0}</td>
        <td class="mono small">${v.sdr_actionable || 0}</td>
        <td class="mono small">${v.opportunity || 0}</td>
        <td class="mono small">${v.sql_demo || 0}</td>
      </tr>`).join('');
    return `<div class="src-camp-card">
      <h3>${label}</h3>
      <table class="account-table">
        <thead><tr><th>${label.includes('source') ? 'Source' : 'Campaign'}</th><th>Acct</th><th>Eng+</th><th>SDR-act</th><th>Opp</th><th>SQL+</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="dim small" style="padding:14px;text-align:center;">No data.</td></tr>'}</tbody>
      </table></div>`;
  }
  grid.innerHTML = panel('By source / agency', src) + panel('By campaign', camp);
}

// ============= NOTES =============
function renderNotes() {
  const grid = document.getElementById('notes-grid');
  const author = getAuthor();
  grid.innerHTML = DATA.stage_order.map(st => {
    const data = (DATA.stages_by_window?.[SELECTED_WINDOW] || {})[st] || {};
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
  if (!confirm(`Delete all your (${author}) feedback from the team log? Permanent.`)) return;
  try {
    await sbRequest(`dashboard_feedback?author=eq.${encodeURIComponent(author)}`, { method: 'DELETE' });
    location.reload();
  } catch (e) { alert('Delete failed: ' + e.message); }
}

function exportNotes() {
  const lines = ['# Refold GTM Dashboard — Team Feedback Export', '',
                 `Generated: ${new Date().toISOString()}`, ''];
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
function formatTime(iso) {
  if (!iso) return '?';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}
