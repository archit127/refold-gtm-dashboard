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
  'this_week': 'this week', 'last_week': 'last week',
  'last_14d': 'last 14d',  'last_30d': 'last 30d',
  'this_month': 'this month', 'this_quarter': 'this quarter',
  'ytd': 'YTD', 'all_time': 'all-time',
};
function fmtRange(start, end) {
  // Formats 'YYYY-MM-DD' into 'MMM D'
  const f = s => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m-1, d)).toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const s = f(start);
  const e = end ? f(end) : (DATA && DATA.today ? f(DATA.today) : 'today');
  if (!s) return 'all-time';
  return `${s} – ${e}`;
}

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
  wireTabs();
  wirePipelineWindow();
  renderAll();
}

function renderAll() {
  // Overview
  renderKPIs();
  renderMovement();
  renderFunnel();
  renderTopOpps();
  renderStagePanel();
  renderWindowMeta();
  // SDR action
  renderSdrAction();
  // Campaigns
  renderCampaignPanels();
  // Meetings
  renderMeetings();
  renderStalled();
  // Pipeline Analytics
  renderUnifiedPipeline();
  renderPipelineAnalytics();
  renderChannelAttribution();
  renderAttributionHygiene();
}

// ============= PIPELINE ANALYTICS =============
// Window selector
let PA_WINDOW_MONTHS = 6;
function wirePipelineWindow() {
  document.querySelectorAll('.pa-win').forEach(b => {
    b.addEventListener('click', () => {
      PA_WINDOW_MONTHS = parseInt(b.dataset.paWin, 10);
      document.querySelectorAll('.pa-win').forEach(x =>
        x.classList.toggle('active', x === b));
      renderPipelineAnalytics();
    });
  });
}

function paMonthsList() {
  // Returns chronological list of YYYY-MM strings for the active window.
  // 0 = max → last 24 months; otherwise last N months ending current.
  const n = PA_WINDOW_MONTHS || 24;
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    out.push(`${d.getFullYear()}-${m}`);
  }
  return out;
}

// Color palettes — mirror leadership chart colors as closely as reasonable
const PA_COLORS_SOURCE = {
  'Event':                '#4A90E2',
  'Expansion':            '#E15554',
  'Inbound':              '#3FB570',
  'Outbound - Cold Call': '#F2A93B',
  'Outbound - Email':     '#7C5BC4',
  'Outbound - Linkedin':  '#D85B8A',
  'Partner':              '#3DB7C0',
  'Referral':             '#9CC551',
  'Untagged':             '#9AA0A6',
};
const PA_COLORS_BD = {
  'Archit A': '#4A90E2', 'Dave G':   '#E15554', 'Jugal A': '#3FB570',
  'Rish N':   '#F2A93B', 'Tanmay B': '#7C5BC4', 'Tejas N': '#D85B8A',
  'Untagged': '#9AA0A6',
};
const PA_COLORS_STAGE = {
  'Demo':           '#4A90E2',
  'POC - Planned':  '#7C5BC4',
  'POC - Ongoing':  '#D85B8A',
  'Verbal':         '#F2A93B',
  'Contract':       '#3FB570',
  'Closed Won':     '#1F8F4F',
  'Closed Lost':    '#9AA0A6',
};

function renderStackedBars(target, dataByMonth, keys, colorMap, opts) {
  opts = opts || {};
  // opts.dimension = 'source' | 'bd_owner' | 'stage'
  // opts.metric    = 'created' | 'closed' | 'post_disco'
  const months = paMonthsList();
  let maxTotal = 0;
  for (const m of months) {
    const row = dataByMonth[m] || {};
    let s = 0;
    for (const k of keys) s += (row[k] || 0);
    if (s > maxTotal) maxTotal = s;
  }
  if (maxTotal === 0) maxTotal = 1;
  const W = 60;
  const CHART_H = 220;
  const PAD_TOP = 24;
  const PAD_BOT = 36;
  const totalW = months.length * W + 20;
  const totalH = CHART_H + PAD_TOP + PAD_BOT;

  let svg = `<svg viewBox="0 0 ${totalW} ${totalH}" preserveAspectRatio="xMinYMid meet" class="pa-svg">`;
  months.forEach((m, i) => {
    const row = dataByMonth[m] || {};
    const total = keys.reduce((a, k) => a + (row[k] || 0), 0);
    const x = i * W + 14;
    const barW = W - 18;
    let yCursor = PAD_TOP + CHART_H;
    for (const k of keys) {
      const v = row[k] || 0;
      if (v <= 0) continue;
      const h = (v / maxTotal) * CHART_H;
      yCursor -= h;
      const fill = colorMap[k] || '#888';
      const clickable = opts.dimension ? ' class="pa-bar-clickable"' : '';
      const dataAttrs = opts.dimension
        ? ` data-month="${m}" data-key="${escapeAttr(k)}" data-dimension="${opts.dimension}" data-metric="${opts.metric || ''}"`
        : '';
      svg += `<rect x="${x}" y="${yCursor.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${fill}" rx="2"${clickable}${dataAttrs}><title>${k}: ${v}</title></rect>`;
    }
    if (total > 0) {
      svg += `<text x="${x + barW/2}" y="${PAD_TOP + CHART_H - (total/maxTotal*CHART_H) - 6}" text-anchor="middle" class="pa-bar-total">${total}</text>`;
    }
    const dt = new Date(m + '-01');
    const monthLbl = dt.toLocaleDateString('en-US', { month: 'short' });
    const yearLbl  = dt.getFullYear();
    svg += `<text x="${x + barW/2}" y="${PAD_TOP + CHART_H + 16}" text-anchor="middle" class="pa-bar-mlbl">${monthLbl}</text>`;
    svg += `<text x="${x + barW/2}" y="${PAD_TOP + CHART_H + 30}" text-anchor="middle" class="pa-bar-ylbl">${yearLbl}</text>`;
  });
  svg += `</svg>`;
  target.innerHTML = svg;
  // Wire bar clicks → drill panel
  if (opts.dimension) {
    target.querySelectorAll('rect.pa-bar-clickable').forEach(r => {
      r.addEventListener('click', () => {
        showPipelineDrill({
          month:     r.dataset.month,
          key:       r.dataset.key,
          dimension: r.dataset.dimension,
          metric:    r.dataset.metric,
          target:    target,
        });
      });
    });
  }
}

// In-place drill panel for Pipeline Analytics charts
function showPipelineDrill(spec) {
  // Remove any existing drill panel inside the same card
  const card = spec.target.closest('.card');
  if (!card) return;
  card.querySelectorAll('.pa-drill').forEach(el => el.remove());

  // Find matching deals from the deals_raw equivalent — we don't have raw deals
  // in DATA, but we have unified_pipeline.stages[].accounts which has source +
  // bd_owner. We'll filter accounts there for matching key+month.
  const up = DATA.unified_pipeline || {};
  const allAccs = [];
  (up.stages || []).forEach(st => (st.accounts || []).forEach(a => allAccs.push({...a, _stage: st.label})));

  // Filter by dimension + key + month
  const monthMatch = (a, month) => {
    // we don't have per-account create date here, so match all accounts that
    // satisfy the key dimension; UI will note this is dimension-filtered only
    return true;
  };
  let filtered = allAccs.filter(a => {
    if (spec.dimension === 'source')   return (a.source   || 'Untagged') === spec.key;
    if (spec.dimension === 'bd_owner') return (a.bd_owner || 'Untagged') === spec.key;
    if (spec.dimension === 'stage')    return (a.deal_stage || '') === spec.key;
    return false;
  });
  filtered.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
  filtered = filtered.slice(0, 50);

  const drill = document.createElement('div');
  drill.className = 'pa-drill';
  drill.innerHTML = `<div class="pa-drill-head">
      <b>${escapeHtml(spec.dimension)} = ${escapeHtml(spec.key)}</b>
      · ${escapeHtml(spec.month)} · ${filtered.length} accounts shown
      <button class="pa-drill-close">×</button>
    </div>` +
    (filtered.length === 0
      ? '<div class="dim small">No accounts match this slice.</div>'
      : `<table class="up-dd-table"><thead><tr>
          <th>Company</th><th>Tier</th><th>DG</th><th>Deal stage</th>
          <th class="num">$</th><th>BD</th><th>Source</th>
        </tr></thead><tbody>${filtered.map(a => `<tr data-domain="${escapeAttr(a.domain)}">
          <td><b>${escapeHtml(a.company)}</b></td>
          <td>${escapeHtml(a.tier || '')}</td>
          <td><span class="dim small">${escapeHtml(a.dg_stage || '')}</span></td>
          <td><span class="dim small">${escapeHtml(a.deal_stage || a._stage || '')}</span></td>
          <td class="num">${a.amount ? '$' + fmt(a.amount) : ''}</td>
          <td>${escapeHtml(a.bd_owner || '')}</td>
          <td>${escapeHtml(a.source || '')}</td>
        </tr>`).join('')}</tbody></table>`);
  card.appendChild(drill);
  drill.querySelector('.pa-drill-close')?.addEventListener('click', () => drill.remove());
  drill.querySelectorAll('tr[data-domain]').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => openAccountDetail(row.dataset.domain));
  });
  drill.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderLegend(target, keys, colorMap) {
  target.innerHTML = keys.map(k =>
    `<span class="pa-legend-item"><span class="pa-swatch" style="background:${colorMap[k] || '#888'}"></span>${escapeHtml(k)}</span>`
  ).join('');
}

function renderPipelineAnalytics() {
  const pa = DATA.pipeline_analytics || {};
  // Source
  const sCreatedEl = document.getElementById('pa-source-created');
  const sClosedEl  = document.getElementById('pa-source-closed');
  if (sCreatedEl && sClosedEl) {
    renderStackedBars(sCreatedEl, pa.created_by_source || {}, pa.source_order || [], PA_COLORS_SOURCE,
      { dimension: 'source', metric: 'created' });
    renderStackedBars(sClosedEl,  pa.closed_by_source  || {}, pa.source_order || [], PA_COLORS_SOURCE,
      { dimension: 'source', metric: 'closed' });
    renderLegend(document.getElementById('pa-source-legend'), pa.source_order || [], PA_COLORS_SOURCE);
  }
  // BD owner
  const bCreatedEl = document.getElementById('pa-bd-created');
  const bClosedEl  = document.getElementById('pa-bd-closed');
  if (bCreatedEl && bClosedEl) {
    renderStackedBars(bCreatedEl, pa.created_by_bd || {}, pa.bd_order || [], PA_COLORS_BD,
      { dimension: 'bd_owner', metric: 'created' });
    renderStackedBars(bClosedEl,  pa.closed_by_bd  || {}, pa.bd_order || [], PA_COLORS_BD,
      { dimension: 'bd_owner', metric: 'closed' });
    renderLegend(document.getElementById('pa-bd-legend'), pa.bd_order || [], PA_COLORS_BD);
  }
  // Post-Disco
  const pdEl = document.getElementById('pa-post-disco');
  if (pdEl) {
    renderStackedBars(pdEl, pa.deals_post_disco || {}, pa.post_disco_stages || [], PA_COLORS_STAGE,
      { dimension: 'stage', metric: 'post_disco' });
    renderLegend(document.getElementById('pa-post-disco-legend'),
      pa.post_disco_stages || [], PA_COLORS_STAGE);
  }
  const meta = document.getElementById('pa-win-meta');
  if (meta) meta.textContent = `${pa.total_deals || 0} total deals · ${PA_WINDOW_MONTHS || 'Max'} ${PA_WINDOW_MONTHS ? 'months' : ''}`;
}

// ===== Unified pipeline (early ↔ late) =====
const UNIFIED_PHASE_COLORS = {
  demand_gen: '#7C5BC4',  // purple — demand-gen
  bridge:     '#F2A93B',  // gold — handoff
  sales:      '#4A90E2',  // blue — sales
  won:        '#1F8F4F',  // green — won
  lost:       '#9AA0A6',  // grey — lost
};
function renderUnifiedPipeline() {
  const wrap = document.getElementById('unified-pipeline');
  if (!wrap) return;
  const up = DATA.unified_pipeline || {};
  const stages = up.stages || [];
  if (!stages.length) {
    wrap.innerHTML = '<div class="dim small">No HS deal data yet — run routine_ingest_hs_deals.</div>';
    return;
  }
  const max = Math.max(1, ...stages.map(s => s.count));
  const totals = up.totals || {};
  // Phase header strip (Early | Bridge | Late)
  const phaseHeader = `
    <div class="up-phase-header">
      <div class="up-phase up-phase-dg">
        <span class="up-phase-lbl">DEMAND GEN</span>
        <span class="up-phase-count">${fmt(totals.demand_gen || 0)}</span>
        <span class="up-phase-sub dim small">accounts</span>
      </div>
      <div class="up-phase-arrow">→</div>
      <div class="up-phase up-phase-bridge">
        <span class="up-phase-lbl">SQL / DISCO</span>
        <span class="up-phase-count">${fmt(totals.bridge || 0)}</span>
        <span class="up-phase-sub dim small">handoff</span>
      </div>
      <div class="up-phase-arrow">→</div>
      <div class="up-phase up-phase-sales">
        <span class="up-phase-lbl">SALES PIPELINE</span>
        <span class="up-phase-count">${fmt(totals.sales || 0)}</span>
        <span class="up-phase-sub dim small">$${fmt(totals.sales_amount || 0)}</span>
      </div>
      <div class="up-phase-arrow">→</div>
      <div class="up-phase up-phase-won">
        <span class="up-phase-lbl">CLOSED WON</span>
        <span class="up-phase-count">${fmt(totals.won || 0)}</span>
        <span class="up-phase-sub dim small">$${fmt(totals.won_amount || 0)}</span>
      </div>
    </div>`;

  // Stage bars
  const stageBars = stages.map(s => {
    const pct = (s.count / max) * 100;
    const fill = UNIFIED_PHASE_COLORS[s.phase] || '#888';
    return `
      <div class="up-stage-row" data-stage-key="${s.key}">
        <span class="up-stage-lbl">${escapeHtml(s.label)}</span>
        <span class="up-stage-bar"><span class="up-stage-fill" style="width:${pct}%; background:${fill}"></span></span>
        <span class="up-stage-count">${fmt(s.count)}</span>
        <span class="up-stage-amt dim small">${s.amount > 0 ? '$' + fmt(s.amount) : ''}</span>
      </div>`;
  }).join('');
  wrap.innerHTML = phaseHeader + `<div class="up-bars">${stageBars}</div>` +
    `<div class="dim small up-hint">Click any stage to see accounts at that stage</div>`;

  // Wire stage click → drill in
  wrap.querySelectorAll('.up-stage-row').forEach(row => {
    row.addEventListener('click', () => {
      const key = row.dataset.stageKey;
      const stage = stages.find(s => s.key === key);
      if (!stage) return;
      // Toggle drilldown
      const existing = wrap.querySelector('.up-drilldown');
      if (existing) existing.remove();
      if (existing && existing.dataset.stageKey === key) return;
      const dd = document.createElement('div');
      dd.className = 'up-drilldown';
      dd.dataset.stageKey = key;
      const accs = stage.accounts || [];
      dd.innerHTML = `<div class="up-dd-head"><b>${escapeHtml(stage.label)}</b> · ${accs.length} of ${stage.count} shown</div>` +
        (accs.length === 0 ? '<div class="dim small">No accounts at this stage.</div>' :
        `<table class="up-dd-table"><thead><tr><th>Company</th><th>Tier</th><th>DG</th><th>Deal</th><th class="num">$</th><th>BD</th><th>Source</th></tr></thead><tbody>` +
        accs.map(a => `<tr data-domain="${escapeHtml(a.domain)}">
          <td><b>${escapeHtml(a.company)}</b></td>
          <td>${escapeHtml(a.tier || '')}</td>
          <td><span class="dim small">${escapeHtml(a.dg_stage || '')}</span></td>
          <td><span class="dim small">${escapeHtml(a.deal_stage || '')}</span></td>
          <td class="num">${a.amount ? '$' + fmt(a.amount) : ''}</td>
          <td>${escapeHtml(a.bd_owner || '')}</td>
          <td>${escapeHtml(a.source || '')}</td>
        </tr>`).join('') + `</tbody></table>`);
      row.after(dd);
    });
  });

  // Handoff leak panel
  const leak = document.getElementById('handoff-leak');
  if (leak) {
    const list = up.handoff_leak || [];
    if (!list.length) {
      leak.innerHTML = '';
    } else {
      leak.innerHTML = `
        <div class="leak-head">⚠️ <b>${list.length} accounts at SQL/Disco/Demo Done with no HubSpot deal record</b>
          <span class="dim small"> — sales handoff missed; AE may not have logged the disco</span>
        </div>
        <table class="up-dd-table"><thead><tr><th>Company</th><th>Tier</th><th>DG stage</th><th class="num">Score</th></tr></thead><tbody>` +
        list.map(a => `<tr><td><b>${escapeHtml(a.company)}</b></td><td>${escapeHtml(a.tier || '')}</td><td>${escapeHtml(a.dg_stage)}</td><td class="num">${fmt(a.priority_score)}</td></tr>`).join('') +
        `</tbody></table>`;
    }
  }
}

// ===== Channel attribution table =====
function renderChannelAttribution() {
  const wrap = document.getElementById('channel-attribution-table');
  if (!wrap) return;
  const rows = DATA.channel_attribution || [];
  const win = DATA.attribution_window_days || {};
  if (!rows.length) {
    wrap.innerHTML = '<div class="dim small">No attribution data yet — needs deals + signal channel mapping.</div>';
    return;
  }
  wrap.innerHTML = `<table class="ch-table">
    <thead><tr>
      <th>Channel</th>
      <th class="num">Originated accts</th>
      <th class="num">Sourced deals (${win.sourced || 60}d)</th>
      <th class="num">Sourced $</th>
      <th class="num">Won (sourced)</th>
      <th class="num">Won $</th>
      <th class="num">Influenced deals (${win.influenced || 90}d)</th>
      <th class="num">Cost</th>
      <th class="num">CAC/sourced</th>
      <th class="num">ROI (won$/cost)</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr class="ch-row" data-channel="${escapeAttr(r.channel)}">
      <td><b>${escapeHtml(r.channel)}</b></td>
      <td class="num">${fmt(r.originated_accounts)}</td>
      <td class="num">${fmt(r.sourced_deals)}</td>
      <td class="num">${r.sourced_amount ? '$' + fmt(r.sourced_amount) : ''}</td>
      <td class="num">${fmt(r.won_sourced_deals)}</td>
      <td class="num">${r.won_sourced_amount ? '$' + fmt(r.won_sourced_amount) : ''}</td>
      <td class="num">${fmt(r.influenced_deals)}</td>
      <td class="num">${r.cost_usd ? '$' + fmt(r.cost_usd) : '<span class="dim">—</span>'}</td>
      <td class="num">${r.cac_per_sourced_deal ? '$' + fmt(r.cac_per_sourced_deal) : '<span class="dim">—</span>'}</td>
      <td class="num">${r.roi_won_sourced ? r.roi_won_sourced + 'x' : '<span class="dim">—</span>'}</td>
    </tr>`).join('')}</tbody>
  </table>
  <div class="dim small">Click a channel row to see the accounts attributed to it · Once agency invoice $ is loaded into <code>agency_costs</code>, CAC and ROI fill in.</div>`;
  // Wire row clicks → show accounts attributed to that channel
  wrap.querySelectorAll('tr.ch-row').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const ch = row.dataset.channel;
      // Find accounts where the unified pipeline source matches this channel,
      // OR accounts where any signal-channel hit was this channel.
      // Easiest proxy: filter unified pipeline by source = channel.
      const up = DATA.unified_pipeline || {};
      const matches = [];
      (up.stages || []).forEach(st => (st.accounts || []).forEach(a => {
        if ((a.source || '') === ch) matches.push({...a, _stage: st.label});
      }));
      matches.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
      const card = wrap.closest('.card');
      card.querySelectorAll('.pa-drill').forEach(el => el.remove());
      const drill = document.createElement('div');
      drill.className = 'pa-drill';
      drill.innerHTML = `<div class="pa-drill-head">
          <b>Channel = ${escapeHtml(ch)}</b> · ${matches.length} accounts (showing top 50 by score)
          <button class="pa-drill-close">×</button>
        </div>` + (matches.length === 0
          ? '<div class="dim small">No accounts directly tagged with this HS source. Channel attribution flows through signal history — drill into specific accounts via SDR or Overview tab to see signal channels.</div>'
          : `<table class="up-dd-table"><thead><tr>
              <th>Company</th><th>Tier</th><th>DG</th><th>Deal stage</th><th class="num">$</th><th>BD</th>
            </tr></thead><tbody>${matches.slice(0,50).map(a => `<tr data-domain="${escapeAttr(a.domain)}">
              <td><b>${escapeHtml(a.company)}</b></td>
              <td>${escapeHtml(a.tier || '')}</td>
              <td><span class="dim small">${escapeHtml(a.dg_stage || '')}</span></td>
              <td><span class="dim small">${escapeHtml(a.deal_stage || a._stage || '')}</span></td>
              <td class="num">${a.amount ? '$' + fmt(a.amount) : ''}</td>
              <td>${escapeHtml(a.bd_owner || '')}</td>
            </tr>`).join('')}</tbody></table>`);
      card.appendChild(drill);
      drill.querySelector('.pa-drill-close')?.addEventListener('click', () => drill.remove());
      drill.querySelectorAll('tr[data-domain]').forEach(r => {
        r.style.cursor = 'pointer';
        r.addEventListener('click', () => openAccountDetail(r.dataset.domain));
      });
      drill.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

function renderAttributionHygiene() {
  const wrap = document.getElementById('attribution-hygiene');
  if (!wrap) return;
  const summary = DATA.channel_hygiene_summary || [];
  const rules = DATA.attribution_hygiene_rules || [];
  if (!summary.length) {
    wrap.innerHTML = '<div class="dim small">No attribution hygiene rejections — all channels are clean (or no agency channels touched any deals yet).</div>';
    return;
  }

  // Rule legend (collapsible)
  const ruleLegend = `<details class="hygiene-rules">
    <summary><b>How the cleaning rules work</b> · ${rules.length} rules applied to agency channels (Leadgenerator, Recotap)</summary>
    <ul class="hygiene-rule-list">
      ${rules.map(r => `<li><b>${escapeHtml(r.rule)}</b>: ${escapeHtml(r.description)}</li>`).join('')}
    </ul>
  </details>`;

  // Per-channel side-by-side
  const cards = summary.map(s => {
    const rejList = (s.rejection_reasons || []).map(r =>
      `<li><span class="rej-count">${r.count}</span> ${escapeHtml(r.rule)}</li>`).join('');
    const sourcedCleanPct = s.raw_sourced_deals > 0
      ? Math.round(s.clean_sourced_deals / s.raw_sourced_deals * 100) : 100;
    const wonCleanPct = s.raw_won_sourced_amount > 0
      ? Math.round(s.clean_won_sourced_amount / s.raw_won_sourced_amount * 100) : 100;
    return `<div class="hygiene-card${s.is_agency ? ' is-agency' : ''}">
      <div class="hygiene-head">
        <h3>${escapeHtml(s.channel)}${s.is_agency ? ' <span class="agency-pill">AGENCY</span>' : ''}</h3>
        <div class="dim small">${s.sourced_credits_rejected} sourcing credits rejected · $${fmt(s.sourced_amount_rejected)} stripped</div>
      </div>
      <table class="hygiene-table"><thead><tr>
        <th>Metric</th><th class="num">Raw (naive)</th><th class="num">Clean</th><th class="num">% kept</th>
      </tr></thead><tbody>
        <tr><td>Originated accounts</td>
          <td class="num">${fmt(s.raw_originated_accounts)}</td>
          <td class="num"><b>${fmt(s.clean_originated_accounts)}</b></td>
          <td class="num">${s.raw_originated_accounts > 0 ? Math.round(s.clean_originated_accounts/s.raw_originated_accounts*100)+'%' : '—'}</td></tr>
        <tr><td>Sourced deals</td>
          <td class="num">${fmt(s.raw_sourced_deals)}</td>
          <td class="num"><b>${fmt(s.clean_sourced_deals)}</b></td>
          <td class="num">${sourcedCleanPct}%</td></tr>
        <tr><td>Sourced $</td>
          <td class="num">${s.raw_sourced_amount > 0 ? '$'+fmt(s.raw_sourced_amount) : '—'}</td>
          <td class="num"><b>${s.clean_sourced_amount > 0 ? '$'+fmt(s.clean_sourced_amount) : '$0'}</b></td>
          <td class="num">${s.raw_sourced_amount > 0 ? Math.round(s.clean_sourced_amount/s.raw_sourced_amount*100)+'%' : '—'}</td></tr>
        <tr><td>Won (sourced) $</td>
          <td class="num">${s.raw_won_sourced_amount > 0 ? '$'+fmt(s.raw_won_sourced_amount) : '—'}</td>
          <td class="num"><b>${s.clean_won_sourced_amount > 0 ? '$'+fmt(s.clean_won_sourced_amount) : '$0'}</b></td>
          <td class="num">${wonCleanPct}%</td></tr>
      </tbody></table>
      ${rejList ? `<div class="rej-section">
        <div class="cc-section-title">What was stripped</div>
        <ul class="rej-list">${rejList}</ul>
      </div>` : ''}
    </div>`;
  }).join('');

  wrap.innerHTML = ruleLegend + `<div class="hygiene-grid">${cards}</div>`;
}

// ============= TAB NAV =============
let SELECTED_TAB = 'overview';
function wireTabs() {
  const persisted = localStorage.getItem('dashboard:tab');
  if (persisted && ['overview','sdr','campaigns','meetings','pipeline'].includes(persisted)) {
    SELECTED_TAB = persisted;
  }
  applyTab();
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      SELECTED_TAB = t.dataset.tab;
      localStorage.setItem('dashboard:tab', SELECTED_TAB);
      applyTab();
    });
  });
}
function applyTab() {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === SELECTED_TAB));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.hidden = p.dataset.panel !== SELECTED_TAB);
  // scroll to top on tab change
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ============= SDR ACTION VIEW =============
// Per-SDR card with their target list, AE shield, top accounts to call.
// Sources: campaign_panels (one panel per SDR-focus tag).
function renderSdrAction() {
  const wrap = document.getElementById('sdr-action-grid');
  if (!wrap) return;

  // PRIMARY DATA SOURCE: strategic allocation v2 (sdr_assignment_v2)
  const allocV2 = DATA.sdr_alloc_v2 || {};
  const aeLocked = DATA.sdr_alloc_v2_ae_locked || [];
  const sdrEntries = Object.entries(allocV2);

  if (sdrEntries.length === 0) {
    wrap.innerHTML = '<div class="dim small">No SDR allocation yet — run routine_allocate_to_sdr_v2.</div>';
    return;
  }

  // Cross-SDR header strip showing system-wide capacity utilization
  const totalCap = sdrEntries.reduce((s, [_, p]) => s + (p.capacity || 0), 0);
  const totalUsed = sdrEntries.reduce((s, [_, p]) => s + (p.used || 0), 0);
  const headerStrip = `<div class="sdr-strategic-header">
    <div class="ssh-title">
      <h2>Strategic SDR Queue</h2>
      <div class="dim small">Auto-allocated nightly · capacity-aware · AE-shielded · plays attached</div>
    </div>
    <div class="ssh-stats">
      <div class="ssh-stat"><span class="ssh-big">${totalUsed} / ${totalCap}</span><span class="ssh-lbl">seats filled</span></div>
      <div class="ssh-stat"><span class="ssh-big">${aeLocked.length}</span><span class="ssh-lbl">AE-locked (skipped)</span></div>
    </div>
  </div>`;

  // Per-SDR cards
  const cards = sdrEntries.map(([sdrName, p]) => {
    const queue = (p.queue || []).filter(x => x.status === 'active');
    const byPlay = p.by_play || {};
    const playPills = Object.entries(byPlay)
      .filter(([play]) => play !== 'ae_locked')
      .map(([play, n]) => {
        const cls = 'play-' + play.replace(/_/g, '-');
        return `<span class="play-pill ${cls}"><b>${n}</b> ${escapeHtml(play.replace(/_/g, ' '))}</span>`;
      }).join('');

    // No queue (e.g. Mani who's LinkedIn-only)
    if (p.capacity === 0) {
      return `<div class="sdr-action-card sdr-mode-li">
        <div class="sdr-action-head">
          <h3>${escapeHtml(sdrName)} <span class="sdr-mode-pill">${escapeHtml(p.modes)}</span></h3>
          <div class="dim small">${escapeHtml(p.note || '')}</div>
        </div>
        <div class="dim small">No call/email queue — runs LinkedIn sequences separately.</div>
      </div>`;
    }

    // Today's queue: show all active assignments grouped by play priority
    const rows = queue.slice(0, 30).map(a => {
      const la = a.last_activity || {};
      const pt = a.past_touches || {};
      const laCell = la.date
        ? `<div class="mono small">${escapeHtml(la.date)} · <b>${escapeHtml(la.source || la.type)}</b></div>` +
          (la.by ? `<div class="dim small">by ${escapeHtml(la.by)}</div>` : '')
        : '<span class="dim small">—</span>';
      const ptCell = pt.last_date
        ? `<b>${escapeHtml(pt.last_by || '?')}</b> · ${escapeHtml(pt.last_date)}` +
          (pt.count > 1 ? ` <span class="dim">(${pt.count})</span>` : '')
        : '<span class="dim small">—</span>';
      const nextAction = nextActionFor(a);
      const playCls = 'play-' + (a.play || 'list_cold_open').replace(/_/g, '-');
      return `<tr class="acct-row" data-domain="${escapeHtml(a.domain)}">
        <td><b>${escapeHtml(a.company)}</b><div class="dim mono small">${escapeHtml(a.domain)}</div></td>
        <td>${tier_pill(a.tier)}</td>
        <td class="num"><b>${a.priority_score}</b></td>
        <td><span class="play-pill ${playCls}" title="${escapeHtml(a.play_reason || '')}">${a.play_icon} ${escapeHtml(a.play_label || a.play)}</span></td>
        <td>${escapeHtml(a.stage || '—')}</td>
        <td class="past-cell">${ptCell}</td>
        <td class="last-act-cell">${laCell}</td>
        <td class="next-action-cell"><b>${escapeHtml(nextAction)}</b></td>
        <td class="action-buttons">
          <button class="btn-action btn-connected" data-domain="${escapeHtml(a.domain)}" data-action="connected">✓ Connected</button>
          <button class="btn-action btn-noanswer" data-domain="${escapeHtml(a.domain)}" data-action="no_answer">No answer</button>
          <button class="btn-action btn-snooze" data-domain="${escapeHtml(a.domain)}" data-action="snoozed">Snooze</button>
        </td>
      </tr>`;
    }).join('');

    const utilPct = p.capacity ? Math.round(p.used / p.capacity * 100) : 0;
    return `<div class="sdr-action-card">
      <div class="sdr-action-head">
        <h3>${escapeHtml(sdrName)} <span class="sdr-mode-pill">${escapeHtml(p.modes || '')}</span></h3>
        <div class="dim small">${escapeHtml(p.note || '')}</div>
        <div class="sdr-action-stats">
          <span class="kbit ok"><b>${p.used}/${p.capacity}</b> seats (${utilPct}%)</span>
          <span class="kbit"><b>${queue.length}</b> active in queue</span>
        </div>
        ${playPills ? `<div class="sdr-play-strip">${playPills}</div>` : ''}
      </div>
      <table class="account-table sdr-action-table">
        <thead><tr>
          <th>Account</th><th>Tier</th><th class="num">Score</th><th>Play</th><th>Stage</th>
          <th>Past touch</th><th>Last activity</th><th>Next action</th><th>Log</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="dim small">No active assignments. Capacity available — load fresh accounts or wait for nightly allocator.</td></tr>'}</tbody>
      </table>
    </div>`;
  }).join('');

  // AE-locked roll-up (manager view)
  const aeBlock = aeLocked.length > 0 ? `<details class="sdr-action-card ae-shield-collapsible">
    <summary>🛑 ${aeLocked.length} accounts AE-locked — SDRs locked out</summary>
    <ul class="ae-shield-list">
      ${aeLocked.slice(0, 20).map(a =>
        `<li><b>${escapeHtml(a.company)}</b> <span class="dim">· ${escapeHtml(a.tier || '')} · score ${a.priority_score}</span><br>
        <span class="dim small">${escapeHtml(a.play_reason || '')}</span></li>`
      ).join('')}
      ${aeLocked.length > 20 ? `<li class="dim">+${aeLocked.length - 20} more</li>` : ''}
    </ul>
  </details>` : '';

  wrap.innerHTML = headerStrip + cards + aeBlock;

  // Wire row clicks → open account detail (drilldown into signals/contacts)
  wrap.querySelectorAll('.sdr-action-card .acct-row').forEach(row => {
    row.addEventListener('click', e => {
      // Don't fire if user clicked an action button or other interactive child
      if (e.target.closest('.btn-action')) return;
      const dom = row.dataset.domain;
      if (dom && typeof openAccountDetail === 'function') {
        openAccountDetail(dom);
        // Switch to overview tab where the drilldown lives
        const overviewTab = document.querySelector('.tab[data-tab="overview"]');
        if (overviewTab) overviewTab.click();
      }
    });
    row.style.cursor = 'pointer';
  });

  // Wire log buttons (placeholder — writes to console for now; needs backend endpoint)
  wrap.querySelectorAll('.btn-action').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dom = btn.dataset.domain;
      const action = btn.dataset.action;
      console.log('[SDR action]', dom, action);
      btn.textContent = '✓ logged';
      btn.disabled = true;
      // TODO: POST to /log_action endpoint → writes to signals + sdr_assignment_v2.last_action
      alert(`Logged "${action}" on ${dom}.\nBackend endpoint not yet wired — currently console-only.`);
    });
  });

  // Wire row clicks
  wrap.querySelectorAll('.acct-row').forEach(row =>
    row.addEventListener('click', () => {
      const dom = row.dataset.domain;
      if (dom && typeof openAccountDetail === 'function') openAccountDetail(dom);
    })
  );
}

// Compose a "why now" string from recent_signals_7d (truncated, prioritised).
function whyNow(a) {
  if (a.ae_engaged) return 'AE handling — skip';
  const s = a.recent_signals || '';
  if (!s) {
    if ((a.priority_score || 0) >= 50) return 'High priority score';
    if (a.stage === 'Engaged' || a.stage === 'Aware') return 'In motion, no recent signals';
    return 'Cold — research first';
  }
  // Take the most-distinctive signals (skip generic email_open noise)
  const parts = s.split(',').map(x => x.trim());
  const high = parts.filter(p =>
    /meeting_booked|email_reply|call_connected|funding_raised|new_hire|score_delta|tech_stack_change|icp_score_jump/i.test(p)
  );
  return (high.length ? high : parts).slice(0, 2).join(', ');
}

// Concrete next-action verb derived from stage + last activity recency.
function nextActionFor(a) {
  if (a.ae_engaged) return 'Skip — AE owns';
  const la = a.last_activity || {};
  const today = new Date();
  let daysSince = 999;
  if (la.date) {
    const d = new Date(la.date + 'T00:00:00Z');
    daysSince = Math.round((today - d) / 86400000);
  }
  // Recent reply / connect = high-priority follow-up
  if (la.type === 'email_reply' && daysSince <= 7) return 'Reply now';
  if (la.type === 'call_connected' && daysSince <= 7) return 'Send follow-up email';
  if (la.type === 'meeting_booked' && daysSince <= 14) return 'Confirm + prep';
  // Stage-based defaults
  if (a.stage === 'Opportunity') return 'Push for next meeting';
  if (a.stage === 'SDR Contacted') return 'Call + LinkedIn DM';
  if (a.stage === 'Engaged')      return 'Multi-thread to 2nd persona';
  if (a.stage === 'Aware')        return 'Send personalized email';
  if (a.stage === 'Reached')      return 'Try a call';
  if (a.stage === 'Cold' || !a.stage) return 'Cold open';
  return 'Standard outreach';
}

// Suggest a conversation angle based on stage + signals.
function outreachAngle(a) {
  const s = a.recent_signals || '';
  if (/meeting_booked/i.test(s)) return 'Reference recent meeting — re-engage';
  if (/email_reply/i.test(s))   return 'Respond to reply — book demo';
  if (/funding_raised/i.test(s)) return 'Lead w/ funding congrats + use case';
  if (/new_hire/i.test(s) || /job_promotion/i.test(s)) return 'New stakeholder — intro Refold';
  if (/tech_stack_change/i.test(s)) return 'Stack change = integration pain';
  if (/score_delta/i.test(s) || /icp_score_jump/i.test(s)) return 'Recotap signal up — they\'re looking';
  if (a.stage === 'Engaged') return 'Multi-thread — try second persona';
  if (a.stage === 'SDR Contacted') return 'Follow up — try call + LI';
  if (a.stage === 'Opportunity') return 'Push for next meeting';
  if (a.stage === 'Cold' || !a.stage) return 'Cold open — lead w/ pain hypothesis';
  return 'Standard outreach';
}

// ============= CAMPAIGN DEEP-DIVE PANELS =============
function formatRec(rec) {
  const map = {
    scale:           '⬆ Scale',
    continue:        '→ Continue',
    hold:            '◇ Hold',
    fix_messaging:   '✎ Fix messaging',
    fix_targeting:   '◎ Fix targeting',
    increase_touch:  '+ Increase touch',
    kill:            '✕ Kill',
  };
  return map[rec] || rec || '—';
}

function renderCampaignPanels() {
  const grid = document.getElementById('campaign-grid');
  if (!grid) return;
  const panels = DATA.campaign_panels || {};
  const stageOrder = DATA.stage_order || [];
  // Filter out empty campaigns — they're noise on a manager view
  const entries = Object.entries(panels).filter(([_, p]) =>
    (p.unique_accounts || 0) > 0 || (p.signals_total || 0) > 0
  );

  // ===== Comparison ranking strip (cold lists only) =====
  const coldEntries = entries
    .filter(([_, p]) => !(p.metrics || {}).is_deal_list && (p.unique_accounts || 0) >= 50)
    .map(([n, p]) => ({ name: n, m: p.metrics || {}, accts: p.unique_accounts }))
    .sort((a, b) => (b.m.mtgs_per_100 || 0) - (a.m.mtgs_per_100 || 0));
  // Extended compare strip: include outcomes ($ pipeline, $ won) alongside TOFU
  const compareStrip = coldEntries.length >= 2 ? `
    <div class="campaign-compare card">
      <div class="card-head"><h2>Campaign scorecard · ranked by mtgs/100</h2>
        <div class="dim small">Cold lists 50+ accts · TOFU efficiency + late-funnel $ outcomes (HS deals)</div></div>
      <table class="compare-table"><thead><tr>
        <th>#</th><th>Campaign</th><th class="num">Accts</th>
        <th class="num" colspan="3">TOFU · 30d</th>
        <th class="num" colspan="3">Outcomes (HS deals)</th>
        <th>Verdict</th><th>Recommendation</th>
      </tr><tr class="sub-head">
        <th></th><th></th><th></th>
        <th class="num">Mtgs/100</th><th class="num">Reply%</th><th class="num">LI accept%</th>
        <th class="num">Open deals</th><th class="num">Pipe $</th><th class="num">Won $</th>
        <th></th><th></th>
      </tr></thead><tbody>
        ${coldEntries.map((e, i) => `<tr>
          <td class="rank">#${i+1}</td>
          <td><b>${escapeHtml(e.name)}</b></td>
          <td class="num">${fmt(e.accts)}</td>
          <td class="num"><b>${fmt(e.m.mtgs_per_100 || 0)}</b></td>
          <td class="num">${fmt(e.m.reply_rate || 0)}</td>
          <td class="num">${fmt(e.m.li_accept_rate || 0)}</td>
          <td class="num">${fmt(e.m.pipeline_deals || 0)}</td>
          <td class="num">${e.m.pipeline_amount > 0 ? '$'+fmt(e.m.pipeline_amount) : '<span class="dim">—</span>'}</td>
          <td class="num">${e.m.won_amount > 0 ? '$'+fmt(e.m.won_amount) : '<span class="dim">—</span>'}</td>
          <td><span class="verdict-pill verdict-${e.m.verdict}">${escapeHtml(e.m.verdict || '')}</span></td>
          <td><span class="rec-pill rec-${e.m.recommendation || 'hold'}">${escapeHtml(formatRec(e.m.recommendation))}</span></td>
        </tr>`).join('')}
      </tbody></table>
    </div>` : '';

  const cards = entries.map(([name, p]) => {
    const accts = p.unique_accounts || 0;
    const m = p.metrics || {};
    const verdictMap = {
      working: { cls: 'verdict-green', icon: '🟢', label: 'Working' },
      mixed:   { cls: 'verdict-yellow', icon: '🟡', label: 'Mixed' },
      cold:    { cls: 'verdict-grey',  icon: '⚪', label: 'Cold' },
      kill:    { cls: 'verdict-red',   icon: '🔴', label: 'Kill candidate' },
      stalled: { cls: 'verdict-yellow',icon: '🟠', label: 'Stalled' },
    };
    const v = verdictMap[m.verdict] || verdictMap.cold;
    const isDeal = !!m.is_deal_list;
    // Sparkline (8 weeks of signal counts)
    const spark = m.sparkline_8w || [];
    const sparkMax = Math.max(1, ...spark);
    const sparkBars = spark.map(n => {
      const h = Math.round((n / sparkMax) * 100);
      return `<span class="spark-bar" style="height:${h}%" title="${n}"></span>`;
    }).join('');
    // Top movers
    const movers = m.top_movers || [];
    const moversBlock = movers.length > 0 ? `
      <div class="cc-movers">
        <div class="cc-section-title">Top accounts moving · 30d</div>
        <ul class="movers-list">
          ${movers.map(mv => `<li class="mover-row" data-domain="${escapeHtml(mv.domain)}">
            <span class="mover-co"><b>${escapeHtml(mv.company)}</b></span>
            <span class="mover-stage stage-pill ${STAGE_CLASS[mv.stage] || ''}">${escapeHtml(mv.stage)}</span>
            <span class="mover-tier">${escapeHtml(mv.tier || '')}</span>
            <span class="mover-meta dim small">${escapeHtml(mv.last_signal_type || '')} · ${escapeHtml(mv.last_signal_date || '')}</span>
          </li>`).join('')}
        </ul>
      </div>` : '';
    // Funnel mini-bars per stage
    const totalAtStages = Object.values(p.by_stage || {}).reduce((a,b)=>a+b, 0);
    const stageBars = stageOrder.map(st => {
      const n = (p.by_stage || {})[st] || 0;
      if (n === 0) return '';
      const pct = totalAtStages > 0 ? (n / totalAtStages * 100).toFixed(0) : 0;
      const cls = STAGE_CLASS[st] || 'st-Cold';
      return `<div class="cc-stage-row">
        <span class="cc-stage-label">${escapeHtml(st)}</span>
        <span class="cc-stage-bar"><span class="cc-stage-fill ${cls}" style="width:${pct}%"></span></span>
        <span class="cc-stage-count">${fmt(n)}</span>
      </div>`;
    }).filter(Boolean).join('') || '<div class="dim small">No funnel data yet.</div>';

    // Top signal types
    const topTypes = Object.entries(p.by_signal_type || {})
      .slice(0, 5)
      .map(([t, n]) => `<span class="cc-type-pill">${escapeHtml(t)} <span class="dim">${fmt(n)}</span></span>`)
      .join('');

    // AE-shield conflict banner
    const conflicts = p.ae_conflicts || [];
    const conflictBanner = conflicts.length > 0
      ? `<div class="ae-shield-banner">
          🛑 <b>${conflicts.length} of ${accts}</b> AE-engaged — SDRs should skip:
          <ul class="ae-shield-list">
            ${conflicts.slice(0, 5).map(c =>
              `<li><b>${escapeHtml(c.company)}</b> · <span class="dim">${escapeHtml(c.detail)}</span></li>`
            ).join('')}
            ${conflicts.length > 5 ? `<li class="dim">+${conflicts.length - 5} more</li>` : ''}
          </ul>
        </div>`
      : '';

    // Account list (top by priority, with AE flag) — only show for SDR-focus panels
    // Show full account list for SDR-focus + leadership-curated panels;
    // skip for big agency-fed lists (TAM, Bay Area, Recotap) which would
    // be too long to render usefully here.
    const showList = (p.accounts_list && p.accounts_list.length > 0
                      && (name.startsWith('Tejas') ||
                          name.startsWith('Maajid') ||
                          name.startsWith('Mani') ||
                          name === 'Priority accounts' ||
                          name === 'Must + Core' ||
                          name.startsWith('Mani')));
    const acctRows = showList
      ? p.accounts_list.map(a => `
          <tr class="acct-row${a.ae_engaged ? ' ae-engaged' : ''}" data-domain="${escapeHtml(a.domain)}">
            <td>${a.ae_engaged ? '🛑 ' : ''}${escapeHtml(a.company)}</td>
            <td>${escapeHtml(a.tier || '')}</td>
            <td>${escapeHtml(a.stage || '')}</td>
            <td class="num">${fmt(a.priority_score)}</td>
            <td class="dim small">${escapeHtml(a.ae_engaged ? a.ae_evidence : (a.recent_signals || ''))}</td>
          </tr>`).join('')
      : '';
    const acctTable = acctRows
      ? `<table class="account-table sdr-mini-table"><thead><tr>
          <th>Account</th><th>Tier</th><th>Stage</th><th class="num">Score</th><th>Signal / AE flag</th>
        </tr></thead><tbody>${acctRows}</tbody></table>`
      : '';

    // TWO KPI ROWS: TOFU (early funnel) + OUTCOMES (HS deals)
    // Cold lists show reply%/LI accept%; deal lists show meetings/coverage.
    const tofuRow = isDeal ? `
      <div class="cc-stats cc-tofu-stats">
        <div class="cc-stat"><span class="cc-big">${fmt(m.meetings_30d || 0)}</span><span class="cc-lbl">meetings · 30d</span></div>
        <div class="cc-stat"><span class="cc-big">${fmt(m.mtgs_per_100 || 0)}</span><span class="cc-lbl">mtgs / 100</span></div>
        <div class="cc-stat"><span class="cc-big">${fmt(m.engaged_pct || 0)}<span class="cc-pct">%</span></span><span class="cc-lbl">engaged+ rate</span></div>
        <div class="cc-stat"><span class="cc-big">${fmt(m.sdr_coverage_pct || 0)}<span class="cc-pct">%</span></span><span class="cc-lbl">SDR coverage</span></div>
      </div>` : `
      <div class="cc-stats cc-tofu-stats">
        <div class="cc-stat"><span class="cc-big">${fmt(m.reply_rate || 0)}<span class="cc-pct">%</span></span><span class="cc-lbl">email reply<br><span class="dim">${fmt(m.email_replied_30d||0)}/${fmt(m.email_sent_30d||0)}</span></span></div>
        <div class="cc-stat"><span class="cc-big">${fmt(m.li_accept_rate || 0)}<span class="cc-pct">%</span></span><span class="cc-lbl">LI accept<br><span class="dim">${fmt(m.li_replied_30d||0)}/${fmt(m.li_sent_30d||0)}</span></span></div>
        <div class="cc-stat"><span class="cc-big">${fmt(m.mtgs_per_100 || 0)}</span><span class="cc-lbl">mtgs / 100</span></div>
        <div class="cc-stat"><span class="cc-big">${fmt(m.engaged_pct || 0)}<span class="cc-pct">%</span></span><span class="cc-lbl">engaged+ rate</span></div>
      </div>`;

    // Outcomes row (HS deals) — shows business $ when present
    // For agency campaigns, show CLEAN numbers + raw delta indicator
    const hasDeals = (m.pipeline_deals || 0) + (m.won_deals || 0) + (m.lost_deals || 0) > 0;
    const showCleanLabel = m.attribution_clean;
    const cleanLabel = showCleanLabel
      ? `<span class="cc-clean-pill" title="Hygiene-applied: pre-existing deals & hard HS source tags excluded">CLEAN</span>`
      : '';
    const pipeRawDelta = (m.pipeline_amount_raw || 0) - (m.pipeline_amount || 0);
    const wonRawDelta  = (m.won_amount_raw || 0)      - (m.won_amount || 0);
    const dealsRawDelta = (m.pipeline_deals_raw || 0)  - (m.pipeline_deals || 0);
    const wonDealsRawDelta = (m.won_deals_raw || 0)    - (m.won_deals || 0);
    const subDelta = (raw, delta, currency) => {
      if (!showCleanLabel || delta <= 0) return '';
      return `<br><span class="dim cc-raw-delta" title="Raw (no hygiene): ${currency}${fmt(raw)}">−${currency}${fmt(delta)} stripped</span>`;
    };
    const outcomesRow = `
      <div class="cc-stats cc-outcomes-stats">
        <div class="cc-stat"><span class="cc-big">${fmt(m.pipeline_deals || 0)}</span><span class="cc-lbl">open deals ${cleanLabel}<br><span class="dim">post-Disco</span>${subDelta(m.pipeline_deals_raw, dealsRawDelta, '')}</span></div>
        <div class="cc-stat"><span class="cc-big">${m.pipeline_amount > 0 ? '$'+fmt(m.pipeline_amount) : '$0'}</span><span class="cc-lbl">pipeline $${subDelta(m.pipeline_amount_raw, pipeRawDelta, '$')}</span></div>
        <div class="cc-stat"><span class="cc-big">${fmt(m.won_deals || 0)}</span><span class="cc-lbl">won deals<br><span class="dim">${fmt(m.win_rate || 0)}% win rate</span>${subDelta(m.won_deals_raw, wonDealsRawDelta, '')}</span></div>
        <div class="cc-stat"><span class="cc-big">${m.won_amount > 0 ? '$'+fmt(m.won_amount) : '$0'}</span><span class="cc-lbl">won $${subDelta(m.won_amount_raw, wonRawDelta, '$')}</span></div>
      </div>`;
    const kpiBlock = tofuRow + outcomesRow;

    // SDR efforts on this campaign (last 30d)
    const sdrEfforts = m.sdr_efforts || {};
    const sdrEffortRows = Object.entries(sdrEfforts)
      .filter(([_, s]) => s.touches > 0)
      .sort((a, b) => b[1].touches - a[1].touches)
      .map(([sdr, s]) => `<tr>
        <td><b>${escapeHtml(sdr)}</b></td>
        <td class="num">${fmt(s.touches)}</td>
        <td class="num">${fmt(s.calls)}</td>
        <td class="num">${fmt(s.emails)}</td>
        <td class="num">${fmt(s.li)}</td>
        <td class="num">${fmt(s.replies)}</td>
        <td class="num"><b>${fmt(s.meetings)}</b></td>
      </tr>`).join('');
    const sdrEffortsBlock = sdrEffortRows ? `
      <div class="cc-sdr-efforts">
        <div class="cc-section-title">SDR efforts · last 30d</div>
        <table class="sdr-effort-table"><thead><tr>
          <th>SDR</th><th class="num">Touches</th><th class="num">Calls</th><th class="num">Emails</th><th class="num">LI</th><th class="num">Replies</th><th class="num">Mtgs</th>
        </tr></thead><tbody>${sdrEffortRows}</tbody></table>
      </div>` : `<div class="cc-sdr-efforts"><div class="dim small">No SDR effort on this list in last 30d</div></div>`;

    const rankBadge = (m.rank_mtgs_per_100 && m.rank_total)
      ? `<span class="rank-badge">#${m.rank_mtgs_per_100} of ${m.rank_total}</span>`
      : '';

    return `<div class="campaign-card${isDeal ? ' is-deal' : ''}">
      <div class="cc-head">
        <div class="cc-name">${escapeHtml(name)} ${rankBadge}</div>
        <div class="cc-verdict ${v.cls}" title="${escapeHtml(m.verdict_reason || '')}">
          ${v.icon} ${v.label}
        </div>
      </div>
      ${m.verdict_reason ? `<div class="cc-verdict-reason dim small">${escapeHtml(m.verdict_reason)}</div>` : ''}
      ${m.recommendation ? `<div class="cc-rec-banner rec-${m.recommendation}">
        <span class="rec-pill rec-${m.recommendation}">${escapeHtml(formatRec(m.recommendation))}</span>
        <span class="cc-rec-reason">${escapeHtml(m.recommendation_reason || '')}</span>
      </div>` : ''}
      ${conflictBanner}
      ${kpiBlock}
      <div class="cc-meta dim small">
        ${fmt(accts)} accounts · ${fmt(p.unique_contacts || 0)} contacts ·
        ${fmt(m.calls_attempted_30d || 0)} calls (${fmt(m.connect_rate || 0)}% connect) ·
        ${fmt(m.multithread_rate || 0)}% multi-thread
      </div>
      <div class="cc-spark-row">
        <span class="cc-spark-lbl dim small">Activity · 8w</span>
        <div class="sparkline">${sparkBars}</div>
      </div>
      ${moversBlock}
      ${sdrEffortsBlock}
      <details class="cc-details">
        <summary class="dim small">Funnel breakdown · signal mix · accounts</summary>
        <div class="cc-stages">${stageBars}</div>
        ${topTypes ? `<div class="cc-types">${topTypes}</div>` : ''}
        ${acctTable}
      </details>
    </div>`;
  }).join('');
  // Wire row clicks
  setTimeout(() => {
    grid.querySelectorAll('.campaign-card .acct-row, .campaign-card .mover-row').forEach(row => {
      row.addEventListener('click', () => {
        const dom = row.dataset.domain;
        if (dom && typeof openAccountDetail === 'function') openAccountDetail(dom);
      });
    });
  }, 0);
  // Top-level SDR Efforts summary (last 30d, across all campaigns)
  const sdrSummary = DATA.sdr_efforts_summary || {};
  const sdrSummaryEntries = Object.entries(sdrSummary).filter(([_, s]) => s.touches > 0);
  const sdrSummaryStrip = sdrSummaryEntries.length > 0 ? `
    <div class="sdr-effort-summary card">
      <div class="card-head"><h2>SDR Effort breakdown · last 30d</h2>
        <div class="dim small">Where each SDR is spending their time (across all campaigns) · click an SDR row to see their campaign mix</div>
      </div>
      <table class="sdr-effort-summary-table"><thead><tr>
        <th>SDR</th><th class="num">Total touches</th><th class="num">Calls</th>
        <th class="num">Emails</th><th class="num">LinkedIn</th>
        <th class="num">Replies</th><th class="num">Meetings booked</th>
        <th class="num">Campaigns active</th>
      </tr></thead><tbody>
      ${sdrSummaryEntries.map(([sdr, s]) => `<tr class="sdr-summary-row" data-sdr="${escapeAttr(sdr)}">
        <td><b>${escapeHtml(sdr)}</b></td>
        <td class="num"><b>${fmt(s.touches)}</b></td>
        <td class="num">${fmt(s.calls)}</td>
        <td class="num">${fmt(s.emails)}</td>
        <td class="num">${fmt(s.li)}</td>
        <td class="num">${fmt(s.replies)}</td>
        <td class="num"><b>${fmt(s.meetings)}</b></td>
        <td class="num">${(s.campaigns || []).length}</td>
      </tr>`).join('')}
      </tbody></table>
    </div>` : '';

  grid.innerHTML = (sdrSummaryStrip + compareStrip + (cards || '<div class="dim small">No campaign data yet.</div>'));

  // Wire SDR summary row clicks → expand to show campaign breakdown
  grid.querySelectorAll('.sdr-summary-row').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const sdr = row.dataset.sdr;
      // Toggle existing expansion
      const next = row.nextElementSibling;
      if (next && next.classList.contains('sdr-summary-expand')) {
        next.remove(); return;
      }
      // Remove other expansions
      grid.querySelectorAll('.sdr-summary-expand').forEach(el => el.remove());
      const data = sdrSummary[sdr];
      if (!data) return;
      const tr = document.createElement('tr');
      tr.className = 'sdr-summary-expand';
      tr.innerHTML = `<td colspan="8"><div class="sdr-camp-breakdown">
        <div class="cc-section-title">${escapeHtml(sdr)} · campaign mix (30d)</div>
        ${(data.campaigns || []).length === 0 ? '<div class="dim small">No campaign-attributed touches.</div>' :
          `<table class="sdr-camp-mix-table"><thead><tr>
            <th>Campaign</th><th class="num">Touches</th><th class="num">Calls</th>
            <th class="num">Emails</th><th class="num">LI</th><th class="num">Replies</th><th class="num">Mtgs</th>
          </tr></thead><tbody>${data.campaigns.map(c => `<tr>
            <td>${escapeHtml(c.campaign)}</td>
            <td class="num">${fmt(c.touches)}</td>
            <td class="num">${fmt(c.calls)}</td>
            <td class="num">${fmt(c.emails)}</td>
            <td class="num">${fmt(c.li)}</td>
            <td class="num">${fmt(c.replies)}</td>
            <td class="num"><b>${fmt(c.meetings)}</b></td>
          </tr>`).join('')}</tbody></table>`}
      </div></td>`;
      row.after(tr);
    });
  });
}

// ============= MEETINGS BOOKED =============
let MEETINGS_SDR_FILTER = '';
function renderMeetings() {
  const wrap = document.getElementById('meetings-table');
  if (!wrap) return;
  const wlabel = WINDOW_LABELS[SELECTED_WINDOW] || SELECTED_WINDOW;
  const lbl = document.getElementById('meetings-window-label');
  if (lbl) lbl.textContent = `· ${wlabel}`;

  const allLists = DATA.meetings_list_by_window || {};
  let list = (allLists[SELECTED_WINDOW] || []).slice();
  const winCount = (DATA.meetings_by_window || {})[SELECTED_WINDOW] || 0;
  const allTime = (allLists['all_time'] || []);

  // Empty-state fallback: show all-time when window has none
  let usingFallback = false;
  if (list.length === 0 && allTime.length > 0) {
    list = allTime.slice(0, 10);
    usingFallback = true;
  }

  // Build SDR filter options from "by" tag in details
  const sdrSet = new Set();
  for (const m of allTime) {
    const tag = (m.title || '').match(/^\[(SDR|AE|CSM|OTHER)·([^\]]+)\]/);
    if (tag && tag[1] === 'SDR') sdrSet.add(tag[2]);
  }
  const sdrOptions = ['', ...Array.from(sdrSet).sort()];
  if (MEETINGS_SDR_FILTER) {
    list = list.filter(m => (m.title || '').includes(`[SDR·${MEETINGS_SDR_FILTER}]`));
  }

  // Header meta + filter UI
  const meta = document.getElementById('meetings-meta');
  if (meta) {
    let txt;
    if (usingFallback) {
      txt = `0 booked in ${wlabel} · showing latest ${list.length} all-time as fallback`;
    } else if (winCount === 0) {
      txt = 'No meetings booked.';
    } else {
      txt = `${winCount} meeting${winCount === 1 ? '' : 's'} booked` +
            (list.length < winCount ? ` · showing latest ${list.length}` : '');
    }
    const filterUI = sdrSet.size > 0
      ? ` · <select class="inline-filter" id="meetings-sdr-filter">` +
        sdrOptions.map(o => `<option value="${escapeHtml(o)}"${o === MEETINGS_SDR_FILTER ? ' selected' : ''}>${o ? escapeHtml(o) : 'All SDRs'}</option>`).join('') +
        `</select>`
      : '';
    meta.innerHTML = txt + filterUI;
  }

  if (list.length === 0) {
    wrap.innerHTML = '<div class="dim small">No meetings match the current filter.</div>';
  } else {
    const rows = list.map(m => {
      // Strip the [SDR·Name] / [AE·Name] tag from title for display, surface as a separate column
      const tag = (m.title || '').match(/^\[(SDR|AE|CSM|OTHER)·([^\]]+)\]\s*/);
      const role = tag ? tag[1] : '';
      const who = tag ? tag[2] : '';
      const cleanTitle = tag ? m.title.slice(tag[0].length) : (m.title || '');
      const roleClass = role === 'SDR' ? 'role-sdr' : role === 'AE' ? 'role-ae' : 'role-other';
      return `<tr class="acct-row" data-domain="${escapeHtml(m.domain)}">
        <td class="mono small">${escapeHtml(m.date)}</td>
        <td><b>${escapeHtml(m.company_name)}</b></td>
        <td>${tier_pill(m.tier)}</td>
        <td>${who ? `<span class="role-pill ${roleClass}">${escapeHtml(role)}·${escapeHtml(who)}</span>` : '<span class="dim">—</span>'}</td>
        <td>${escapeHtml(m.stage || '—')}</td>
        <td class="dim small">${escapeHtml(cleanTitle)}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<table class="account-table">
      <thead><tr>
        <th>Date</th><th>Account</th><th>Tier</th><th>Booked by</th><th>Stage</th><th>Title</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    wrap.querySelectorAll('.acct-row').forEach(row => {
      row.addEventListener('click', () => {
        const dom = row.dataset.domain;
        if (dom && typeof openAccountDetail === 'function') openAccountDetail(dom);
      });
    });
  }

  // Wire SDR filter
  const sel = document.getElementById('meetings-sdr-filter');
  if (sel) {
    sel.addEventListener('change', e => {
      MEETINGS_SDR_FILTER = e.target.value || '';
      renderMeetings();
    });
  }
}

// Shared tier-pill helper (cross-tab consistency — Step 5 polish too)
function tier_pill(tier) {
  if (!tier) return '<span class="dim small">—</span>';
  const cls = (tier || '').replace(/[^A-Za-z0-9_]/g, '');
  const label = (tier || '').replace('TIER_', 'T').replace('_', ' ');
  return `<span class="tier-pill tier-${cls}">${escapeHtml(label)}</span>`;
}

// ============= COLD OUTBOUND SENDER PANELS =============
function renderSdrPanels() {
  const grid = document.getElementById('sdr-grid');
  if (!grid) return;
  const panels = DATA.sdr_panels || {};
  const stageOrder = DATA.stage_order || [];
  const entries = Object.entries(panels)
    .filter(([k]) => k !== 'Unassigned')
    .sort((a, b) => (b[1].active_accounts || 0) - (a[1].active_accounts || 0));
  if (entries.length === 0) {
    grid.innerHTML = '<div class="dim small">No outbound-sender attribution yet. Bay Area Leadgen cadences populate this.</div>';
    return;
  }
  grid.innerHTML = entries.map(([owner, p]) => {
    const totalAtStages = Object.values(p.by_stage || {}).reduce((a,b)=>a+b, 0);
    const stageBars = stageOrder.map(st => {
      const n = (p.by_stage || {})[st] || 0;
      if (n === 0) return '';
      const pct = totalAtStages > 0 ? (n / totalAtStages * 100).toFixed(0) : 0;
      const cls = STAGE_CLASS[st] || 'st-Cold';
      return `<div class="cc-stage-row">
        <span class="cc-stage-label">${escapeHtml(st)}</span>
        <span class="cc-stage-bar"><span class="cc-stage-fill ${cls}" style="width:${pct}%"></span></span>
        <span class="cc-stage-count">${fmt(n)}</span>
      </div>`;
    }).filter(Boolean).join('');
    const topRows = (p.top_accounts || []).map(a => `
      <tr class="acct-row" data-domain="${escapeHtml(a.domain)}">
        <td>${escapeHtml(a.company_name)}</td>
        <td>${escapeHtml(a.tier || '')}</td>
        <td>${escapeHtml(a.stage || '')}</td>
        <td class="num">${fmt(a.priority_score)}</td>
      </tr>`).join('');
    return `<div class="campaign-card">
      <div class="cc-name">${escapeHtml(owner)}</div>
      <div class="cc-stats">
        <div><span class="cc-big">${fmt(p.unique_accounts || 0)}</span><span class="cc-lbl">accounts touched</span></div>
        <div><span class="cc-big">${fmt(p.active_accounts || 0)}</span><span class="cc-lbl">active in funnel</span></div>
        <div><span class="cc-big">${fmt(p.signals_30d || 0)}</span><span class="cc-lbl">signals · 30d</span></div>
        <div><span class="cc-big">${fmt(p.signals_total || 0)}</span><span class="cc-lbl">signals total</span></div>
      </div>
      <div class="cc-stages">${stageBars || '<div class="dim small">No active funnel data.</div>'}</div>
      ${topRows ? `<table class="account-table sdr-mini-table"><thead><tr>
          <th>Top active account</th><th>Tier</th><th>Stage</th><th class="num">Score</th>
        </tr></thead><tbody>${topRows}</tbody></table>` : ''}
    </div>`;
  }).join('');
  // Wire row clicks to drilldown
  grid.querySelectorAll('.acct-row').forEach(row => {
    row.addEventListener('click', () => {
      const dom = row.dataset.domain;
      if (dom && typeof openAccountDetail === 'function') openAccountDetail(dom);
    });
  });
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
  const bounds = (DATA.window_bounds || {})[SELECTED_WINDOW] || {};
  const range = fmtRange(bounds.start, bounds.end);
  if (SELECTED_WINDOW === 'all_time') {
    meta.textContent = `${fmt(totalActive)} active-target accounts · all-time snapshot`;
  } else {
    meta.textContent = `${range} · ${fmt(totalActive)} accounts active in window`;
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
  // Meetings booked = COUNT of meeting_booked signals in window (a flow),
  // not stage-stock at SQL/Demo Done.
  const meetings = (DATA.meetings_by_window || {})[SELECTED_WINDOW] || 0;
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
    kpi(fmt(meetings), `SDR meetings booked (${wlabel})`),
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

// ============= GLOBAL ACCOUNT DRILLDOWN =============
// Cross-tab: any row that has data-domain can call this.
// Finds the stage for the domain in current window, switches to Overview tab,
// opens the stage panel, selects the row, and scrolls to the detail panel.
function openAccountDetail(domain) {
  if (!domain) return;
  const win = SELECTED_WINDOW || 'all_time';
  const stagesData = DATA.stages_by_window?.[win] || {};
  // Find which stage holds this domain
  let targetStage = null;
  for (const [stage, info] of Object.entries(stagesData)) {
    if ((info.accounts || []).some(a => a.domain === domain)) {
      targetStage = stage; break;
    }
  }
  // Fallback: try all_time if current window doesn't have it
  if (!targetStage && win !== 'all_time') {
    const altStages = DATA.stages_by_window?.all_time || {};
    for (const [stage, info] of Object.entries(altStages)) {
      if ((info.accounts || []).some(a => a.domain === domain)) {
        targetStage = stage;
        SELECTED_WINDOW = 'all_time';
        // refresh window pills so user can see we shifted
        document.querySelectorAll('.wpill').forEach(p =>
          p.classList.toggle('active', p.dataset.w === 'all_time'));
        break;
      }
    }
  }
  if (!targetStage) {
    alert(`Account ${domain} not in any stage in this window. Try the All-time window.`);
    return;
  }
  // Switch to Overview tab if not already
  if (SELECTED_TAB !== 'overview') {
    SELECTED_TAB = 'overview';
    localStorage.setItem('dashboard:tab', 'overview');
    applyTab();
  }
  SELECTED_STAGE = targetStage;
  SELECTED_DOMAIN = domain;
  renderStagePanel();
  // Scroll
  setTimeout(() => {
    const d = document.getElementById('account-detail');
    if (d && !d.hidden) {
      d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      document.getElementById('stage-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 120);
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
      <div class="ad-meta">${a.open_deals_amount > 0 ? '$' + fmt(a.open_deals_amount) + ' · ' : ''}score ${a.priority_score} · ${escapeHtml(SELECTED_STAGE)}${a.committee_score > 0 ? ` · committee ${committeeBadge(a.committee_score, a.committee_levels)}` : ''}</div>
    </div>
    ${a.why_now ? `<div class="why-matters" style="border:none;padding:0;margin-bottom:14px;"><strong style="color:var(--gold);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Why now:</strong> ${escapeHtml(a.why_now)}</div>` : ''}
    ${a.outreach_angle ? `<div class="why-matters" style="border:none;padding:0;margin-bottom:14px;"><strong style="color:var(--gold);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Outreach angle:</strong> ${escapeHtml(a.outreach_angle)}</div>` : ''}

    ${renderAttribution(a.attribution)}

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

// ============= TOP ACCOUNTS — single panel with stage tabs =============
let TOP_STAGE = 'Engaged';
function renderTopOpps() {
  const split = DATA.top_by_stage || {};
  const stages = ['Engaged', 'SDR Contacted', 'Opportunity', 'SQL'];

  // Update counts on each tab
  stages.forEach(s => {
    const cnt = document.getElementById(`cnt-${s}`);
    if (cnt) cnt.textContent = (split[s] || []).length;
  });

  // Wire tab clicks (idempotent)
  document.querySelectorAll('#top-stage-tabs .stage-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.stage === TOP_STAGE);
    if (!t.dataset.bound) {
      t.dataset.bound = '1';
      t.addEventListener('click', () => {
        TOP_STAGE = t.dataset.stage;
        renderTopOpps();
      });
    }
  });

  const empties = {
    'Engaged': 'No accounts at Engaged yet.',
    'SDR Contacted': 'No SDR-contacted accounts yet.',
    'Opportunity': 'No Opportunity-stage accounts yet.',
    'SQL': 'No SQL-stage accounts yet.',
  };
  renderStageTopTable('top-stage-table', TOP_STAGE,
                      split[TOP_STAGE] || [], empties[TOP_STAGE]);
}

function renderStageTopTable(elId, stage, rows, emptyMsg) {
  const target = document.getElementById(elId);
  if (!target) return;
  if (rows.length === 0) {
    target.innerHTML = `<div class="dim small" style="padding:14px 0;">${emptyMsg}</div>`;
    return;
  }
  target.innerHTML = `<table class="account-table">
    <thead><tr><th>Account</th><th>Tier</th><th>Score</th><th>Committee</th><th>Last sig</th><th>Why now</th></tr></thead>
    <tbody>${rows.map(o => `<tr class="acct-row" data-domain="${escapeAttr(o.domain)}" data-stage="${escapeAttr(stage)}">
      <td><div class="acct-name">${escapeHtml(o.company_name)}</div><div class="acct-domain">${escapeHtml(o.domain)}</div></td>
      <td><span class="tier-tag ${escapeHtml((o.tier || '').replace(/[^A-Z0-9]/g,''))}">${escapeHtml(o.tier || '—')}</span></td>
      <td class="score-cell">${o.priority_score}</td>
      <td class="committee-cell" title="${escapeAttr((o.committee_levels || []).join(' · '))}">${committeeBadge(o.committee_score || 0, o.committee_levels)}</td>
      <td class="mono small dim">${escapeHtml(o.top_signal_date || '—')}</td>
      <td class="why-cell" title="${escapeAttr(o.why_now)}">${escapeHtml(o.why_now || '—')}</td>
    </tr>`).join('')}</tbody></table>`;

  // Wire clicks → open same drilldown the funnel-row uses
  target.querySelectorAll('.acct-row').forEach(row => {
    row.addEventListener('click', () => {
      SELECTED_STAGE  = row.dataset.stage;
      SELECTED_DOMAIN = row.dataset.domain;
      PAGE = 0;
      // mirror selectStage UI: highlight funnel row + render stage panel
      document.querySelectorAll('.fb-row').forEach(r =>
        r.classList.toggle('selected', r.dataset.stage === SELECTED_STAGE));
      renderStagePanel();
      setTimeout(() => {
        const d = document.getElementById('account-detail');
        if (d && !d.hidden) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    });
  });
}

function renderAttribution(attr) {
  if (!attr || !attr.total_signals_60d) return '';
  const total = attr.total_signals_60d;
  function bars(obj, max) {
    const entries = Object.entries(obj || {}).slice(0, max || 5);
    if (entries.length === 0) return '<span class="dim small">—</span>';
    const top = entries[0][1];
    return entries.map(([k, n]) => {
      const w = top > 0 ? (n / top * 100).toFixed(0) : 0;
      return `<div class="attr-row">
        <span class="attr-label">${escapeHtml(k)}</span>
        <span class="attr-bar"><span class="attr-fill" style="width:${w}%"></span></span>
        <span class="attr-count">${fmt(n)}</span>
      </div>`;
    }).join('');
  }
  return `
    <div class="attribution-panel">
      <div class="attr-header">
        <span class="attr-title">Why this account is here</span>
        <span class="dim small">${fmt(total)} signals · last 60d</span>
      </div>
      <div class="attr-grid">
        <div class="attr-col">
          <h5>By source</h5>
          ${bars(attr.by_source, 6)}
        </div>
        <div class="attr-col">
          <h5>By signal type</h5>
          ${bars(attr.by_type, 6)}
        </div>
        ${Object.keys(attr.by_campaign || {}).length ? `<div class="attr-col">
          <h5>By campaign</h5>
          ${bars(attr.by_campaign, 6)}
        </div>` : ''}
        ${Object.keys(attr.by_sdr || {}).length ? `<div class="attr-col">
          <h5>By SDR / owner</h5>
          ${bars(attr.by_sdr, 6)}
        </div>` : ''}
      </div>
    </div>
  `;
}

function committeeBadge(score, levels) {
  if (!score) return '<span class="dim">—</span>';
  let cls = 'committee-1';
  if (score >= 3) cls = 'committee-3';
  else if (score >= 2) cls = 'committee-2';
  const dots = '●'.repeat(Math.min(score, 4));
  const tooltip = (levels || []).join(' · ');
  return `<span class="committee-badge ${cls}" title="${escapeAttr(tooltip)}">${dots} <span class="dim small">${score}</span></span>`;
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
