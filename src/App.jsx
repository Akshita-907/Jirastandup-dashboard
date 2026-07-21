import React, { useState, useEffect } from 'react';

import INITIAL_ISSUES from './issues.json';
import LAST_SPRINT from './lastSprint.json';
import DATA_META from './dataMeta.json';
import { Icon, StatusBadge, PriorityBadge, getStatusMeta, Verdict, TypeIcon } from './Icon.jsx';

// Complete list of G99PRODUCT active board members restructured by teams
const REAL_TEAM = [
  // DevOps Team
  { name: 'Lalit Suryan', code: 'LS', devGroup: 'DevOps' },
  { name: 'Akash Sharma', code: 'AS', devGroup: 'DevOps' },
  { name: 'Rashmi', code: 'RA', devGroup: 'DevOps' },
  { name: 'abhishek.h', code: 'AH', devGroup: 'DevOps', intern: true },
  { name: 'Sachin Tripathi', code: 'ST', devGroup: 'DevOps', intern: true },
  { name: 'Neha', code: 'NE', devGroup: 'DevOps', intern: true },

  // Dev 1 Team (Pushkar)
  { name: 'Pushkar Murkute', code: 'PM', devGroup: 'Dev 1 (Pushkar)' },
  { name: 'Kundan Kumar', code: 'KK', devGroup: 'Dev 1 (Pushkar)' },
  { name: 'Manish Patidar', code: 'MP', devGroup: 'Dev 1 (Pushkar)' },
  { name: 'Sai Somanath', code: 'SS', devGroup: 'Dev 1 (Pushkar)' },
  { name: 'Oam Chora', code: 'OC', devGroup: 'Dev 1 (Pushkar)', intern: true },

  // Dev 2 Team (Mehul/Monika)
  { name: 'Mehul Kothari', code: 'MK', devGroup: 'Dev 2 (Mehul/Monika)' },
  { name: 'Monika Desai', code: 'MD', devGroup: 'Dev 2 (Mehul/Monika)' },
  { name: 'Sujal', code: 'SU', devGroup: 'Dev 2 (Mehul/Monika)', intern: true },
  { name: 'Sachin Vendor', code: 'SV', devGroup: 'Dev 2 (Mehul/Monika)' },

  // Dev 3 Team (Somya)
  { name: 'Somya Mishra', code: 'SM', devGroup: 'Dev 3 (Somya)' },
  { name: 'Disha', code: 'DI', devGroup: 'Dev 3 (Somya)' },
  { name: 'gopesh.pandey', code: 'GP', devGroup: 'Dev 3 (Somya)' },

  // CRM Support Team
  { name: 'Yogesh Paygude', code: 'YP', devGroup: 'CRM Support' },
  { name: 'Akshay Dhole', code: 'AD', devGroup: 'CRM Support' },
  { name: 'Java Developer I', code: 'J1', devGroup: 'CRM Support' },
  { name: 'Java Developer II', code: 'J2', devGroup: 'CRM Support' },

  // QA Team
  { name: 'Rimsha Riyadh', code: 'RR', devGroup: 'QA Team' },
  { name: 'Shubhashis Swain', code: 'SS', devGroup: 'QA Team' },
  { name: 'akshita.garg', code: 'AG', devGroup: 'QA Team' },
  { name: 'Ajay Chafekarande', code: 'AC', devGroup: 'QA Team', intern: true },
  { name: 'Jahanvi', code: 'JA', devGroup: 'QA Team', intern: true },
  { name: 'Abhishek', code: 'AB', devGroup: 'QA Team' }
];

// Primary QA can hold one or more QAs (comma-joined). Split into individual names.
const issueQAs = (issue) => (
  issue.primaryQA && issue.primaryQA !== 'Unassigned'
    ? issue.primaryQA.split(',').map(s => s.trim()).filter(Boolean)
    : []
);

// QA owner tag — shown on any QA Review / QA BLOCKED ticket; red when no QA assigned.
function QAOwnerTag({ issue }) {
  if (issue.status !== 'QA Review' && issue.status !== 'QA BLOCKED') return null;
  const qas = issueQAs(issue);
  return qas.length
    ? <span className="qa-owner">QA: {qas.join(', ')}</span>
    : <span className="qa-owner qa-unassigned">QA unassigned</span>;
}

const INITIAL_ACTIONS = [];

// Today, from the real clock in local time (data staleness fields in issues.json are
// anchored to the last sync, but all live calculations use the actual current date).
const _now = new Date();
const TODAY = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
// Sprint #38 window (update on rollover, or derive from Jira sprint field once stored)
const SPRINT_START = '2026-07-16';
const SPRINT_END_DAY = '2026-07-30';
// Reporting window is scoped to the ELAPSED part of the sprint: start → today
// (clamped to the sprint end). Time-series charts and the headline framing cover
// Jul 16 → today rather than projecting empty days out to the sprint end. ISO date
// strings compare correctly with <, so no Date parsing is needed here.
const REPORT_END = TODAY < SPRINT_END_DAY ? TODAY : SPRINT_END_DAY;

// Count working days (Mon–Fri) strictly AFTER start, up to and including end.
function workingDaysBetween(startStr, endStr) {
  if (!startStr) return 0;
  const s = new Date(startStr + 'T00:00:00');
  const e = new Date(endStr + 'T00:00:00');
  if (e <= s) return 0;
  let count = 0;
  const cur = new Date(s);
  cur.setDate(cur.getDate() + 1);
  while (cur <= e) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// A ticket is "overdue" if it has been in flight (started, not done) longer than its
// story-point estimate in working days. Unestimated (0 SP) tickets get a 1-day allowance.
const OVERDUE_STATUSES = ['In Progress', 'Code Review', 'QA Review', 'QA BLOCKED'];
function overdueInfo(issue) {
  if (!OVERDUE_STATUSES.includes(issue.status) || !issue.inProgressDate) return { overdue: false, approaching: false };
  const expected = issue.storyPoints > 0 ? issue.storyPoints : 1;
  const elapsed = workingDaysBetween(issue.inProgressDate, TODAY);
  const overdue = elapsed > expected;
  // approaching = not yet over, but within 1 working day of its estimate
  const approaching = !overdue && (expected - elapsed) <= 1;
  return { overdue, approaching, expected, elapsed, overdueBy: elapsed - expected, remaining: expected - elapsed };
}

// ---- History-derived helpers (all from the changelog `history` array) ----
const DAY = 86400000;
const ACTIVE_STATUSES = ['In Progress', 'Code Review', 'QA Review', 'QA BLOCKED'];
const DEV_WORK = ['In Progress', 'Code Review'];
const QA_WORK = ['QA Review', 'QA BLOCKED'];
const dateStr = (d) => d.toISOString().slice(0, 10);
const YESTERDAY = dateStr(new Date(new Date(TODAY + 'T00:00:00').getTime() - DAY));
const calDays = (a, b) => (!a ? 0 : Math.max(0, Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY)));

// date of the most recent status transition
function lastMoveDate(issue) {
  const h = issue.history || [];
  return h.length ? h[h.length - 1].date : null;
}
// calendar days the ticket has sat in its current status
function daysInStatus(issue) {
  const d = lastMoveDate(issue);
  return d ? calDays(d, TODAY) : issue.staleDays || 0;
}
// status as of end of a given date (for day-over-day comparison)
function statusAsOf(issue, day) {
  const h = issue.history || [];
  let s = null;
  for (const t of h) { if (t.date <= day) s = t.status; }
  return s ?? (h[0] ? h[0].status : issue.status);
}
// did any transition happen on/after `day`?
function movedSince(issue, day) {
  return (issue.history || []).some(t => t.date >= day);
}
// stalled = active work sitting untouched since before yesterday (the "same as yesterday" flag)
function isStalled(issue) {
  return ACTIVE_STATUSES.includes(issue.status) && !movedSince(issue, YESTERDAY);
}
// split time spent in dev-side vs QA-side statuses (calendar days)
function devQaSplit(issue) {
  const h = issue.history || [];
  let dev = 0, qa = 0;
  for (let i = 0; i < h.length; i++) {
    const start = h[i].date;
    const end = i + 1 < h.length ? h[i + 1].date : TODAY;
    const span = calDays(start, end);
    if (DEV_WORK.includes(h[i].status)) dev += span;
    else if (QA_WORK.includes(h[i].status)) qa += span;
  }
  return { devDays: dev, qaDays: qa };
}
// who the ball is with right now
function waitingOn(status) {
  if (DEV_WORK.includes(status)) return 'Dev';
  if (status === 'QA Review') return 'QA';
  if (status === 'QA BLOCKED') return 'Blocked';
  if (status === 'To Do') return 'Unstarted';
  return 'Done';
}
// bounce count: how many times it re-entered In Progress after leaving it (rework signal)
function bounceCount(issue) {
  const ips = (issue.history || []).filter(t => t.status === 'In Progress').length;
  return Math.max(0, ips - 1);
}

// ---- Delivery SLA model ----
// Dev SLA: an N-SP ticket should move from In Progress to QA Review within N working
// days (unpointed = 1-day allowance). QA SLA: a ticket entering QA Review should be
// tested (Ready to Release / Done) within 24 hours.
function devSlaInfo(i, asOf = TODAY) {
  if (!i.inProgressDate || i.status === 'Rejected') return { state: 'na' };
  const budget = i.storyPoints > 0 ? i.storyPoints : 1;
  const target = i.qaEnteredDate || ((i.history || []).find(h => DONE_STATUSES.includes(h.status)) || {}).date || null;
  if (target) {
    const took = workingDaysBetween(i.inProgressDate, target);
    return { state: took <= budget ? 'ontime' : 'late', took, budget };
  }
  const elapsed = workingDaysBetween(i.inProgressDate, asOf);
  return { state: elapsed > budget ? 'flagged' : 'pending', took: elapsed, budget };
}
// Hours a ticket has spent (or spent) in QA. Completed tickets use the precise
// fractional qaCycleDays; ongoing ones are approximated from the QA-entry date.
function qaHoursInfo(i, asOfMs = Date.now()) {
  if (i.qaCycleDays != null) return { done: true, hours: Math.max(1, Math.round(i.qaCycleDays * 24)) };
  if (i.status === 'QA Review' || i.status === 'QA BLOCKED') {
    // most RECENT entry into QA (a bounced ticket restarts its QA clock)
    const lastQa = [...(i.history || [])].reverse().find(h => h.status === 'QA Review')?.date || i.qaEnteredDate;
    if (!lastQa) return null;
    const hours = Math.max(1, Math.round((asOfMs - new Date(lastQa + 'T00:00:00').getTime()) / 3600000));
    return { done: false, hours };
  }
  return null;
}
function fmtHours(h) {
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Statuses that count as completed work. Ready to Release / Released To Prod
// are treated the same as Done for all workload & completion metrics.
const DONE_STATUSES = ['Done', 'Released To Prod', 'Ready to Release'];
const isDone = (status) => DONE_STATUSES.includes(status);

// Canonical issue-type sort order (Story first, then Bug, …) used by type filters and grouping.
const TYPE_ORDER = { Story: 0, Bug: 1, Task: 2, Epic: 3 };
const pluralType = (t) => (t === 'Story' ? 'Stories' : `${t}s`);

// Reusable issue-type filter chips (All types / Stories / Bugs / …), built from the
// distinct types present in `scope`. `value` is the selected type ('All' = no filter);
// clicking the active chip again clears back to 'All'.
function TypeFilterChips({ scope, value, onChange }) {
  const types = [...new Set(scope.map(i => i.type))].sort((a, b) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9));
  // Nothing to filter when the scope is a single type — but keep chips visible if a
  // filter is currently active, so the user can always clear back to All.
  if (types.length < 2 && value === 'All') return null;
  return (
    <div className="filter-tabs">
      <button className={`filter-tab ${value === 'All' ? 'active' : ''}`} onClick={() => onChange('All')}>
        All types <span className="filter-tab-count">{scope.length}</span>
      </button>
      {types.map(t => (
        <button key={t} className={`filter-tab ${value === t ? 'active' : ''}`} onClick={() => onChange(value === t ? 'All' : t)}>
          <TypeIcon type={t} /> {pluralType(t)} <span className="filter-tab-count">{scope.filter(i => i.type === t).length}</span>
        </button>
      ))}
    </div>
  );
}

// SLA "stuck" thresholds — days a ticket can sit in an ACTIVE status without an update
// before it's flagged. Only statuses where work should be moving are tracked; To Do is
// deliberately excluded (an unstarted ticket is backlog, not a breach — its risk is
// spillover near sprint end, handled separately via SPILLOVER_WINDOW).
const SLA_LIMITS = {
  'In Progress': 3,
  'Code Review': 1,
  'QA Review': 2
};
// A To Do ticket is at risk of spilling over when this many days (or fewer) remain in the sprint.
const SPILLOVER_WINDOW = 3;
// ---- SmartTable: search + show-20/show-all wrapper for large ticket tables ----
function SmartTable({ rows, columns, renderRow, searchText, pageSize = 20 }) {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const norm = q.trim().toLowerCase();
  const filtered = norm ? rows.filter(r => searchText(r).toLowerCase().includes(norm)) : rows;
  const visible = showAll ? filtered : filtered.slice(0, pageSize);
  return (
    <div className="smart-table">
      {rows.length > 8 && (
        <div className="st-bar">
          <input
            className="st-search"
            placeholder="Filter by key, summary or person…"
            value={q}
            onChange={e => { setQ(e.target.value); setShowAll(false); }}
          />
          <span className="filter-count">{filtered.length} of {rows.length}</span>
        </div>
      )}
      <table className="aging-table">
        <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {visible.map(renderRow)}
          {filtered.length === 0 && <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No matching tickets.</td></tr>}
        </tbody>
      </table>
      {filtered.length > pageSize && (
        <button className="btn btn-secondary st-more" onClick={() => setShowAll(v => !v)}>
          {showAll ? `Show first ${pageSize}` : `Show all ${filtered.length}`}
        </button>
      )}
    </div>
  );
}

// ---- Global search: key / summary / person -> ticket drill-down ----
function GlobalSearch({ issues, onPick }) {
  const [q, setQ] = useState('');
  const norm = q.trim().toLowerCase();
  const hits = norm.length >= 2
    ? issues.filter(i =>
        i.key.toLowerCase().includes(norm) ||
        i.summary.toLowerCase().includes(norm) ||
        (i.assignee || '').toLowerCase().includes(norm) ||
        (i.primaryQA || '').toLowerCase().includes(norm)
      ).slice(0, 8)
    : [];
  return (
    <div className="global-search">
      <Icon name="target" size={14} />
      <input
        value={q}
        placeholder="Search tickets…"
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && hits[0]) { onPick(hits[0]); setQ(''); }
          if (e.key === 'Escape') setQ('');
        }}
      />
      {hits.length > 0 && (
        <div className="gs-results">
          {hits.map(i => (
            <button key={i.key} className="gs-item" onClick={() => { onPick(i); setQ(''); }}>
              <span className="card-key">{i.key}</span>
              <span className="gs-sum">{i.summary}</span>
              <StatusBadge status={i.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Burnup chart: cumulative completed vs total scope across the sprint ----
function Burnup({ issues }) {
  const doneSet = new Set(DONE_STATUSES);
  const start = new Date(SPRINT_START + 'T00:00:00');
  // Elapsed window only: span start → today, not the full sprint end.
  const end = new Date(REPORT_END + 'T00:00:00');
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(dateStr(new Date(d)));
  const total = issues.length;
  const doneDateOf = (i) => { const t = (i.history || []).find(h => doneSet.has(h.status)); return t ? t.date : null; };
  const pts = days.map(day => {
    if (day > TODAY) return { day, done: null };
    const done = issues.filter(i => { const dd = doneDateOf(i); return dd && dd <= day; }).length;
    return { day, done };
  });
  const W = 640, H = 170, PAD = { l: 30, r: 10, t: 12, b: 22 };
  const x = (idx) => PAD.l + (idx / Math.max(1, days.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / Math.max(1, total)) * (H - PAD.t - PAD.b);
  const line = pts.filter(p => p.done != null).map((p, idx) => `${x(idx)},${y(p.done)}`).join(' ');
  const last = [...pts].reverse().find(p => p.done != null);
  const lastIdx = pts.findIndex(p => p === last);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="burnup" role="img" aria-label="Sprint burnup: completed vs scope">
      {/* scope line */}
      <line x1={x(0)} y1={y(total)} x2={x(days.length - 1)} y2={y(total)} className="bu-scope" />
      <text x={W - PAD.r} y={y(total) - 5} textAnchor="end" className="bu-lbl">Scope {total}</text>
      {/* baseline */}
      <line x1={x(0)} y1={y(0)} x2={x(days.length - 1)} y2={y(0)} className="bu-axis" />
      {/* completed line */}
      {line && <polyline points={line} className="bu-done" />}
      {pts.map((p, idx) => p.done != null && (
        <circle key={p.day} cx={x(idx)} cy={y(p.done)} r="3.5" className="bu-dot"><title>{p.day}: {p.done} completed</title></circle>
      ))}
      {last && <text x={x(lastIdx)} y={y(last.done) - 8} textAnchor="middle" className="bu-lbl bu-lbl-done">{last.done}</text>}
      {/* x labels: start, today, end */}
      <text x={x(0)} y={H - 6} className="bu-lbl">{days[0]?.slice(5)}</text>
      {lastIdx >= 0 && <text x={x(lastIdx)} y={H - 6} textAnchor="middle" className="bu-lbl">today</text>}
      <text x={x(days.length - 1)} y={H - 6} textAnchor="end" className="bu-lbl">{days[days.length - 1]?.slice(5)}</text>
    </svg>
  );
}

// ---- Donut: two-segment share (estimated vs not) ----
function Donut({ value, total, color, label }) {
  const pct = total ? value / total : 0;
  const R = 42, C = 2 * Math.PI * R;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 110 110" className="donut" role="img" aria-label={`${label}: ${Math.round(pct * 100)}%`}>
        <circle cx="55" cy="55" r={R} className="donut-track" />
        <circle cx="55" cy="55" r={R} className="donut-fill" style={{ stroke: color, strokeDasharray: `${pct * C} ${C}`, }} transform="rotate(-90 55 55)" />
        <text x="55" y="52" textAnchor="middle" className="donut-pct">{Math.round(pct * 100)}%</text>
        <text x="55" y="68" textAnchor="middle" className="donut-sub">{value}/{total}</text>
      </svg>
      <span className="donut-lbl">{label}</span>
    </div>
  );
}

// ---- Sortable developer stats table (click headers to sort, click rows to drill in) ----
function DevStatsTable({ rows, onPick, showSpill }) {
  const [sortKey, setSortKey] = useState('pct');
  const [dir, setDir] = useState(-1);
  const cols = [
    { k: 'name', l: 'Developer' },
    { k: 'assigned', l: 'Assigned' },
    { k: 'sp', l: 'Total SP' },
    { k: 'doneT', l: 'Completed' },
    { k: 'doneSP', l: 'Completed SP' },
    { k: 'flagged', l: 'SLA breaches' },
    { k: 'pending', l: 'Pending' },
    ...(showSpill ? [{ k: 'spill', l: 'Spillover' }] : []),
    { k: 'pct', l: 'Success rate' },
  ];
  const flip = (k) => { if (sortKey === k) setDir(d => -d); else { setSortKey(k); setDir(-1); } };
  const sorted = [...rows].sort((a, b) => {
    if (sortKey === 'name') return dir * a.name.localeCompare(b.name);
    return dir * ((a[sortKey] ?? -1) - (b[sortKey] ?? -1));
  });
  return (
    <table className="aging-table">
      <thead><tr>
        {cols.map(c => (
          <th key={c.k} className="th-sort" onClick={() => flip(c.k)} title="Click to sort">
            {c.l}{sortKey === c.k ? (dir === -1 ? ' ↓' : ' ↑') : ''}
          </th>
        ))}
        <th>On-time</th>
      </tr></thead>
      <tbody>
        {sorted.map(r => (
          <tr key={r.name} className="clickable-card" onClick={() => onPick(r.name)}>
            <td style={{ fontWeight: 600 }}>{r.name}</td>
            <td>{r.assigned}</td>
            <td>{r.sp}</td>
            <td>{r.doneT}</td>
            <td style={{ color: 'var(--color-success)', fontWeight: 600 }}>{r.doneSP}</td>
            <td>{r.flagged ? <span className="vchip vchip-bad">{r.flagged}</span> : '0'}</td>
            <td>{r.pending}</td>
            {showSpill && <td>{r.spill ? <span className="vchip vchip-warn">{r.spill}{r.spillRate != null ? ` (${r.spillRate}%)` : ''}</span> : '0'}</td>}
            <td>{r.pct != null
              ? <Verdict tone={r.pct >= 70 ? 'ok' : r.pct >= 40 ? 'warn' : 'bad'}>{r.pct}%</Verdict>
              : <span style={{ color: 'var(--text-muted)' }}>not measured</span>}</td>
            <td>{r.ontime}/{r.measured || 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Compact metric card with icon ----
function MetricCard({ icon, title, value, desc, color, onClick, active }) {
  return (
    <div
      className={`metric-card ${onClick ? 'clickable-card' : ''}`}
      onClick={onClick}
      style={active ? { borderColor: color || 'var(--color-primary)' } : undefined}
    >
      {icon && <span className="mc-icon" style={{ color: color || 'var(--color-primary)' }}><Icon name={icon} size={15} /></span>}
      <span className="mc-body">
        <span className="metric-title">{title}</span>
        <span className="metric-value" style={color ? { color } : undefined}>{value}</span>
        {desc && <span className="metric-desc">{desc}</span>}
      </span>
    </div>
  );
}

// ---- Aggregate delivery stats for a dataset (used by sprint-over-sprint) ----
function computeDeliveryStats(ds, asOf, asOfMs) {
  let onTime = 0, measured = 0, qaWithin = 0, qaMeasured = 0, done = 0, totalSP = 0, doneSP = 0;
  const cyc = [];
  ds.forEach(i => {
    totalSP += i.storyPoints || 0;
    if (isDone(i.status)) { done++; doneSP += i.storyPoints || 0; }
    const s = devSlaInfo(i, asOf);
    if (s.state === 'ontime') { onTime++; measured++; } else if (s.state === 'late' || s.state === 'flagged') measured++;
    const info = qaHoursInfo(i, asOfMs);
    if (info && info.done) { qaMeasured++; if (info.hours <= 24) qaWithin++; }
    if (i.qaCycleDays != null && i.qaCycleDays >= 0) cyc.push(i.qaCycleDays);
  });
  return {
    tickets: ds.length, done,
    completionPct: ds.length ? Math.round((done / ds.length) * 100) : 0,
    devOnTimePct: measured ? Math.round((onTime / measured) * 100) : null,
    qaWithinPct: qaMeasured ? Math.round((qaWithin / qaMeasured) * 100) : null,
    avgQaCycleH: cyc.length ? Math.round((cyc.reduce((a, b) => a + b, 0) / cyc.length) * 24) : null,
    totalSP, doneSP,
  };
}

// ---- Aging WIP: dots per WIP lane, y = % of that ticket's OWN SLA budget consumed.
// Dev lanes use the SP-day rule; QA lanes use the 24-hour rule — normalizing both to a
// percentage means one axis and one color rule apply consistently everywhere, and the
// dot's color always matches its position (100% line = the actual breach point).
function AgingWIP({ issues, onPick }) {
  const lanes = ['In Progress', 'Code Review', 'QA Review', 'QA BLOCKED'];
  const isQaLane = (status) => status === 'QA Review' || status === 'QA BLOCKED';
  const items = lanes.flatMap(l => issues.filter(i => i.status === l)).map(i => {
    let pct, detail;
    if (isQaLane(i.status)) {
      const q = qaHoursInfo(i);
      pct = q ? (q.hours / 24) * 100 : 0;
      detail = q ? `${fmtHours(q.hours)} of 24h QA SLA` : 'no QA-entry recorded';
    } else {
      const od = overdueInfo(i);
      pct = od.expected ? (od.elapsed / od.expected) * 100 : 0;
      detail = od.expected ? `${od.elapsed}d of ${od.expected}d budget (${i.storyPoints || 0} SP)` : 'not started';
    }
    return { i, pct, detail };
  });
  const maxPct = Math.max(160, ...items.map(x => x.pct));
  const W = 680, H = 300, PAD = { l: 38, r: 12, t: 14, b: 40 };
  const plotH = H - PAD.t - PAD.b, plotW = W - PAD.l - PAD.r;
  const laneX = (idx) => PAD.l + (idx + 0.5) * (plotW / lanes.length);
  const y = (pct) => PAD.t + plotH - (Math.min(pct, maxPct) / maxPct) * plotH;
  const dotColor = (pct) => pct > 100 ? 'var(--color-danger)' : pct >= 70 ? 'var(--color-warning)' : 'var(--color-primary)';
  const gridVals = [0, 50, 100, ...(maxPct > 150 ? [150] : [])];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="aging-wip" role="img" aria-label="Aging work in progress, by % of SLA budget consumed">
      {/* breach reference line at 100% */}
      <rect className="wip-band-bad" x={PAD.l} width={plotW} y={PAD.t} height={Math.max(0, y(100) - PAD.t)} />
      {gridVals.map(t => (
        <g key={t}>
          <line className={t === 100 ? 'wip-gridline-sla' : 'wip-gridline'} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
          <text className="wip-axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">{t}%</text>
        </g>
      ))}
      <text className="wip-lane-lbl" x={W - PAD.r} y={y(100) - 5} textAnchor="end" style={{ fill: 'var(--color-danger)' }}>SLA breached above this line</text>
      {lanes.map((l, idx) => {
        const laneItems = items.filter(x => x.i.status === l);
        return (
          <g key={l}>
            <text className="wip-lane-lbl" x={laneX(idx)} y={H - 22} textAnchor="middle">{l}</text>
            <text className="wip-lane-n" x={laneX(idx)} y={H - 8} textAnchor="middle">{laneItems.length}</text>
            {laneItems.map((x, di) => {
              const jitter = ((di % 5) - 2) * 9;
              return (
                <circle key={x.i.key} className="wip-dot" cx={laneX(idx) + jitter} cy={y(x.pct)} r="5"
                  style={{ fill: dotColor(x.pct) }} onClick={() => onPick(x.i)}>
                  <title>{x.i.key} · {x.i.assignee} · {Math.round(x.pct)}% · {x.detail}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// ---- Ticket drill-down modal ----
function TicketModal({ issue, onClose }) {
  if (!issue) return null;
  const h = issue.history || [];
  const timeline = h.map((t, i) => ({
    ...t,
    duration: calDays(t.date, i + 1 < h.length ? h[i + 1].date : TODAY),
  }));
  const split = devQaSplit(issue);
  const od = overdueInfo(issue);
  const wait = waitingOn(issue.status);
  const stalled = isStalled(issue);
  const bounces = bounceCount(issue);
  const chips = [];
  chips.push({ label: `Waiting: ${wait}`, tone: wait === 'Blocked' ? 'bad' : wait === 'QA' ? 'qa' : wait === 'Dev' ? 'dev' : 'muted' });
  if (od.overdue) chips.push({ label: `Overdue ${od.overdueBy}d`, tone: 'bad' });
  if (od.approaching) chips.push({ label: `Due ${od.remaining <= 0 ? 'today' : 'soon'}`, tone: 'warn' });
  if (stalled) chips.push({ label: `No movement since ${lastMoveDate(issue)}`, tone: 'warn' });
  if (bounces > 0) chips.push({ label: `${bounces}× reopened`, tone: 'warn' });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span className="card-key" style={{ fontSize: '13px' }}>{issue.key}</span>
              <StatusBadge status={issue.status} />
              <PriorityBadge priority={issue.priority} />
            </div>
            <h3 style={{ margin: '10px 0 0', fontSize: '16px', fontWeight: 600, lineHeight: 1.4 }}>{issue.summary}</h3>
          </div>
          <button className="btn btn-secondary" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>

        <div className="modal-chips">
          {chips.map((c, i) => <span key={i} className={`vchip vchip-${c.tone}`}>{c.label}</span>)}
        </div>

        <div className="modal-grid">
          <div><span className="mg-lbl">Assignee</span><span className="mg-val">{issue.assignee}</span></div>
          <div><span className="mg-lbl">Primary QA</span><span className="mg-val">{issue.primaryQA}</span></div>
          <div><span className="mg-lbl">Story Points</span><span className="mg-val">{issue.storyPoints || 0}</span></div>
          <div><span className="mg-lbl">In current status</span><span className="mg-val">{daysInStatus(issue)}d</span></div>
          <div><span className="mg-lbl">Time in Dev</span><span className="mg-val">{split.devDays}d</span></div>
          <div><span className="mg-lbl">Time in QA</span><span className="mg-val">{split.qaDays}d</span></div>
          {issue.qaCycleDays != null && <div><span className="mg-lbl">QA cycle</span><span className="mg-val">{issue.qaCycleDays}d</span></div>}
          {issue.lifecycleDays != null && <div><span className="mg-lbl">Lifecycle</span><span className="mg-val">{issue.lifecycleDays}d</span></div>}
        </div>

        {(issue.blockedBy?.length > 0 || issue.blocks?.length > 0) && (
          <div className="modal-section">
            <h4 className="modal-sub">Dependencies</h4>
            {issue.blockedBy?.map(d => <div key={d.key} className="dep-row"><span className="vchip vchip-bad">Blocked by</span> <span className="card-key">{d.key}</span> {d.summary}</div>)}
            {issue.blocks?.map(d => <div key={d.key} className="dep-row"><span className="vchip vchip-muted">Blocks</span> <span className="card-key">{d.key}</span> {d.summary}</div>)}
          </div>
        )}

        <div className="modal-section">
          <h4 className="modal-sub">Lifecycle timeline</h4>
          <div className="timeline">
            {timeline.map((t, i) => {
              const m = getStatusMeta(t.status);
              return (
                <div key={i} className="tl-row">
                  <span className="tl-dot" style={{ backgroundColor: m.color }} />
                  <span className="tl-status" style={{ color: m.color }}>{t.status}</span>
                  <span className="tl-date">{t.date}</span>
                  <span className="tl-dur">{t.duration}d{i === timeline.length - 1 ? ' (current)' : ''}</span>
                  <span className="tl-user">{t.user}</span>
                </div>
              );
            })}
          </div>
        </div>

        <a className="btn btn-secondary" href={`https://growth99.atlassian.net/browse/${issue.key}`} target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start' }}>Open in Jira ↗</a>
      </div>
    </div>
  );
}

function App() {
  const [issues, setIssues] = useState(INITIAL_ISSUES);
  const [actions, setActions] = useState(INITIAL_ACTIONS);
  const [selectedAssignee, setSelectedAssignee] = useState(null);
  const [currentTab, setCurrentTab] = useState('overview'); // 'overview', 'risks', 'standup', 'team-workload', 'release', 'settings'
  const [selectedTeam, setSelectedTeam] = useState('Dev 1 (Pushkar)');
  const [selectedDevFilter, setSelectedDevFilter] = useState(null);
  const [selectedQAFilter, setSelectedQAFilter] = useState(null);

  const [selectedIntern, setSelectedIntern] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showTeamSla, setShowTeamSla] = useState(false);
  const [showTeamOverdue, setShowTeamOverdue] = useState(false);
  const [teamMemberFilter, setTeamMemberFilter] = useState('All');
  const [teamStatusFilter, setTeamStatusFilter] = useState('');
  const [teamTypeFilter, setTeamTypeFilter] = useState('All'); // 'All' | 'Bug' | 'Story' | …
  const [capTeam, setCapTeam] = useState(null);
  const [analyticsRange, setAnalyticsRange] = useState('sprint');
  const [analyticsDev, setAnalyticsDev] = useState(null);
  const [analyticsDevStatus, setAnalyticsDevStatus] = useState('all');
  const [analyticsDevType, setAnalyticsDevType] = useState('All');
  const [analyticsQA, setAnalyticsQA] = useState(null);
  const [analyticsQAStatus, setAnalyticsQAStatus] = useState('all');
  const [analyticsQAType, setAnalyticsQAType] = useState('All');

  // When a person is drilled into on Analytics, the detail panel renders near the top
  // of the page — scroll it into view so the click visibly "does something".
  // Called from every drill-in click — an effect on state alone misses re-clicks of
  // the same person (same-value setState bails out and never re-fires the effect).
  const scrollToDetail = () => {
    setTimeout(() => document.getElementById('analytics-detail')?.scrollIntoView({ behavior: 'auto', block: 'start' }), 100);
  };
  const [presenter, setPresenter] = useState(false);
  const [presenterIdx, setPresenterIdx] = useState(0);
  const [discussed, setDiscussed] = useState(() => new Set());
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [personFilter, setPersonFilter] = useState('all');
  const [personTypeFilter, setPersonTypeFilter] = useState('All');
  const [qaFilter, setQaFilter] = useState('all');
  const [standupPerson, setStandupPerson] = useState('all');
  const [standupCat, setStandupCat] = useState('focus');

  // SLA Violations Register filters
  const [slaStatusFilter, setSlaStatusFilter] = useState('All');
  const [slaTeamFilter, setSlaTeamFilter] = useState('All');
  const [slaDevFilter, setSlaDevFilter] = useState('All');

  // Action Tracker inputs
  const [newActionText, setNewActionText] = useState('');
  const [newActionOwner, setNewActionOwner] = useState('Mehul Kothari');

  // Dynamic calculations
  const teamMembers = REAL_TEAM.map(member => {
    const activeTickets = issues.filter(i => i.assignee === member.name && !isDone(i.status));
    return {
      ...member,
      tickets: activeTickets.length,
      blocked: activeTickets.some(i => i.blocked)
    };
  });

  // QA engineers derived from the live Primary QA field (not hardcoded)
  const qaEngineers = [...new Set(issues.flatMap(issueQAs))].sort((a, b) => a.localeCompare(b));

  // Cycle-time aggregates from real changelog data
  const qaCycleValues = issues.map(i => i.qaCycleDays).filter(t => t != null && t >= 0);
  const avgQaCycle = qaCycleValues.length ? (qaCycleValues.reduce((a, b) => a + b, 0) / qaCycleValues.length).toFixed(1) : null;
  const lifecycleValues = issues.map(i => i.lifecycleDays).filter(t => t != null && t >= 0);
  const avgLifecycle = lifecycleValues.length ? (lifecycleValues.reduce((a, b) => a + b, 0) / lifecycleValues.length).toFixed(1) : null;

  const blockedIssues = issues.filter(i => i.blocked);
  const slaBreachedIssues = issues.filter(i => i.staleDays > (SLA_LIMITS[i.status] || 99));
  const overloadedMembers = teamMembers.filter(m => m.tickets >= 3);

  // ---- SLA Violations Register filtering (status tabs + team -> developer) ----
  const DEV_TEAMS = ['DevOps', 'Dev 1 (Pushkar)', 'Dev 2 (Mehul/Monika)', 'Dev 3 (Somya)', 'CRM Support', 'QA Team'];
  const teamOf = (name) => REAL_TEAM.find(m => m.name === name)?.devGroup || 'Other';
  const STATUS_ORDER = ['To Do', 'In Progress', 'Code Review', 'QA Review', 'QA BLOCKED', 'Ready to Release', 'Done', 'Released To Prod', 'Rejected'];
  const slaStatusTabs = ['All', ...STATUS_ORDER.filter(s => slaBreachedIssues.some(i => i.status === s))];
  const slaTeamDevs = slaTeamFilter === 'All'
    ? []
    : [...new Set(slaBreachedIssues.filter(i => teamOf(i.assignee) === slaTeamFilter).map(i => i.assignee))].sort();
  const filteredSlaIssues = slaBreachedIssues.filter(i =>
    (slaStatusFilter === 'All' || i.status === slaStatusFilter) &&
    (slaTeamFilter === 'All' || teamOf(i.assignee) === slaTeamFilter) &&
    (slaDevFilter === 'All' || i.assignee === slaDevFilter)
  ).sort((a, b) => b.staleDays - a.staleDays);

  // ---- Interns ----
  const interns = REAL_TEAM.filter(m => m.intern);
  const internTickets = (name) => issues.filter(i => i.assignee === name || issueQAs(i).includes(name));

  // ---- Dashboard headline stats + auto insights ----
  const SPRINT_END = new Date(SPRINT_END_DAY + 'T23:59:59');
  const daysLeft = Math.max(0, Math.round((SPRINT_END - new Date(TODAY + 'T23:59:59')) / 86400000));
  // Elapsed-window framing: which day of the sprint we're reporting through (inclusive).
  const sprintTotalDays = calDays(SPRINT_START, SPRINT_END_DAY) + 1;
  const sprintDayNum = Math.min(sprintTotalDays, calDays(SPRINT_START, TODAY) + 1);
  const reportEndLabel = new Date(REPORT_END + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const doneCount = issues.filter(i => isDone(i.status)).length;
  const completionPct = issues.length ? Math.round((doneCount / issues.length) * 100) : 0;
  const unassignedActive = issues.filter(i => i.assignee === 'Unassigned' && !isDone(i.status)).length;
  const inQACount = issues.filter(i => i.status === 'QA Review').length;
  const qaUnassigned = issues.filter(i => i.status === 'QA Review' && issueQAs(i).length === 0).length;
  // "Stuck" oldest ticket only considers active-work statuses (To Do aging is not meaningful)
  const WORK_STATUSES = ['In Progress', 'Code Review', 'QA Review'];
  const oldestStale = [...issues].filter(i => WORK_STATUSES.includes(i.status)).sort((a, b) => b.staleDays - a.staleDays)[0];
  const topLoaded = [...teamMembers].sort((a, b) => b.tickets - a.tickets)[0];
  // Spillover: unstarted (To Do) tickets when the sprint is nearly over
  const spilloverRiskIssues = daysLeft <= SPILLOVER_WINDOW ? issues.filter(i => i.status === 'To Do') : [];

  // Overdue: in-flight tickets past their story-point time budget
  const overdueIssues = issues
    .map(i => ({ issue: i, info: overdueInfo(i) }))
    .filter(x => x.info.overdue)
    .sort((a, b) => b.info.overdueBy - a.info.overdueBy);
  const approachingIssues = issues.filter(i => overdueInfo(i).approaching);

  const insights = [];
  insights.push({ tone: completionPct >= 60 ? 'ok' : completionPct >= 35 ? 'warn' : 'bad',
    text: `Sprint is ${completionPct}% complete (${doneCount}/${issues.length} done or ready) with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.` });
  if (blockedIssues.length) insights.push({ tone: 'bad', text: `${blockedIssues.length} ticket${blockedIssues.length === 1 ? ' is' : 's are'} QA-blocked and need unblocking today.` });
  if (spilloverRiskIssues.length) insights.push({ tone: 'warn', text: `${spilloverRiskIssues.length} tickets are still in To Do with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left — likely to spill over to next sprint.` });
  if (overdueIssues.length) insights.push({ tone: 'bad', text: `${overdueIssues.length} in-flight tickets are overdue — open longer than their story-point estimate and need a status update.` });
  if (approachingIssues.length) insights.push({ tone: 'warn', text: `${approachingIssues.length} tickets are approaching their estimate (due today/tomorrow) — watch these before they slip.` });
  if (slaBreachedIssues.length) insights.push({ tone: 'warn', text: `${slaBreachedIssues.length} active tickets are stuck past their aging limit (no movement) — see the Risks tab.` });
  if (oldestStale) insights.push({ tone: 'warn', text: `Oldest active ticket: ${oldestStale.key} (${oldestStale.assignee}) untouched for ${oldestStale.staleDays} days in ${oldestStale.status}.` });
  if (inQACount) insights.push({ tone: qaUnassigned ? 'warn' : 'ok', text: `${inQACount} tickets in QA${qaUnassigned ? `, ${qaUnassigned} with no QA assigned` : ''}; avg QA cycle ${avgQaCycle ?? 'N/A'}d.` });
  if (topLoaded && topLoaded.tickets >= 3) insights.push({ tone: 'warn', text: `${topLoaded.name} is the most loaded with ${topLoaded.tickets} active tickets.` });
  if (unassignedActive) insights.push({ tone: 'warn', text: `${unassignedActive} active tickets have no assignee.` });
  const activeIssuesAll = issues.filter(i => !isDone(i.status) && i.status !== 'Rejected');
  const unestimated = activeIssuesAll.filter(i => !i.storyPoints);
  if (unestimated.length) insights.push({ tone: 'warn', text: `${unestimated.length} of ${activeIssuesAll.length} active tickets (${Math.round((unestimated.length / activeIssuesAll.length) * 100)}%) have no story-point estimate — overdue detection guesses 1 day for them. Push the team to estimate.` });

  // ---- Waiting-on breakdown (where the sprint is jammed) ----
  const waitingCounts = { Dev: 0, QA: 0, Blocked: 0, Unstarted: 0 };
  issues.forEach(i => { if (!isDone(i.status)) { const w = waitingOn(i.status); if (waitingCounts[w] != null) waitingCounts[w]++; } });

  // ---- Stalled: active tickets with no movement since yesterday (anti-false-update) ----
  const stalledIssues = issues.filter(isStalled).sort((a, b) => daysInStatus(b) - daysInStatus(a));


  // ---- Per-person standup briefs ----
  const personBriefs = [...new Set(issues.filter(i => !isDone(i.status) && i.assignee !== 'Unassigned').map(i => i.assignee))]
    .map(name => {
      const its = issues.filter(i => i.assignee === name);
      const active = its.filter(i => !isDone(i.status));
      return {
        name,
        active,
        inProgress: active.filter(i => i.status === 'In Progress'),
        // "moved" = a REAL status transition on/after yesterday. To Do tickets carry only a
        // seeded (non-transition) history entry, so they're excluded — they haven't progressed.
        movedYesterday: its.filter(i => i.status !== 'To Do' && movedSince(i, YESTERDAY)),
        overdue: active.filter(i => overdueInfo(i).overdue),
        blocked: active.filter(i => i.status === 'QA BLOCKED'),
        stalled: active.filter(isStalled),
      };
    })
    .sort((a, b) => b.active.length - a.active.length);

  // Presenter keyboard nav: ←/→ move, d or Space = mark discussed & advance
  useEffect(() => {
    if (!presenter) return;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setPresenterIdx(i => Math.min(personBriefs.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setPresenterIdx(i => Math.max(0, i - 1));
      else if (e.key === 'd' || e.key === ' ') {
        e.preventDefault();
        const cur = personBriefs[Math.min(presenterIdx, personBriefs.length - 1)];
        if (cur) setDiscussed(prev => new Set(prev).add(cur.name));
        setPresenterIdx(i => Math.min(personBriefs.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenter, presenterIdx, personBriefs]);

  // ---- Completion throughput, last 14 days (from history done-events) ----
  const doneSet = new Set(DONE_STATUSES);
  const throughput = [];
  for (let k = 13; k >= 0; k--) {
    const day = dateStr(new Date(new Date(TODAY + 'T00:00:00').getTime() - k * DAY));
    let count = 0;
    issues.forEach(i => {
      const firstDone = (i.history || []).find(t => doneSet.has(t.status));
      if (firstDone && firstDone.date === day) count++;
    });
    throughput.push({ day, count });
  }
  const throughputMax = Math.max(1, ...throughput.map(t => t.count));

  // ---- Rework: reopened tickets + QA-blocked occurrences ----
  const reopened = issues.map(i => ({ issue: i, bounces: bounceCount(i) })).filter(x => x.bounces > 0).sort((a, b) => b.bounces - a.bounces);
  const qaBlockedNow = issues.filter(i => i.status === 'QA BLOCKED');

  // ---- Capacity: per-member active load (overloaded vs idle) ----
  const WIP_LIMIT = 4;
  const capacity = teamMembers
    .map(m => ({ ...m, overdue: issues.filter(i => i.assignee === m.name && overdueInfo(i).overdue).length }))
    .filter(m => m.tickets > 0 || !m.intern)
    .sort((a, b) => b.tickets - a.tickets);
  const overloaded = capacity.filter(m => m.tickets >= WIP_LIMIT);
  const idle = capacity.filter(m => m.tickets <= 1 && !m.intern);

  // Per-QA detail panel — metric cards + filterable ticket list
  const renderQAPanel = (qa) => {
    const tickets = qa
      ? issues.filter(i => issueQAs(i).includes(qa))
      : issues.filter(i => i.status === 'QA Review' || i.status === 'QA BLOCKED' || (isDone(i.status) && issueQAs(i).length > 0));
    const inQa = tickets.filter(i => i.status === 'QA Review');
    const blocked = tickets.filter(i => i.status === 'QA BLOCKED');
    const completed = tickets.filter(i => isDone(i.status));
    const cycles = completed.map(i => i.qaCycleDays).filter(t => t != null && t >= 0);
    const avgCycle = cycles.length ? (cycles.reduce((a, b) => a + b, 0) / cycles.length).toFixed(1) : null;
    const cards = [
      { label: 'Assigned', value: tickets.length, color: 'var(--color-primary)', icon: 'target' },
      { label: 'In QA now', value: inQa.length, color: '#7c3aed', icon: 'clock' },
      { label: 'QA Blocked', value: blocked.length, color: 'var(--color-danger)', icon: 'ban' },
      { label: 'Completed', value: completed.length, color: 'var(--color-success)', icon: 'check' },
      { label: 'Avg QA cycle', value: avgCycle != null ? `${avgCycle}d` : 'N/A', color: 'var(--text-primary)', icon: 'chart' },
    ];
    const statusCounts = {};
    tickets.forEach(i => { statusCounts[i.status] = (statusCounts[i.status] || 0) + 1; });
    let list = qaFilter === 'all' ? tickets : tickets.filter(i => i.status === qaFilter);
    list = [...list].sort((a, b) => daysInStatus(b) - daysInStatus(a));
    return (
      <div className="person-detail">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 650 }}>{qa ? `${qa} — QA workload` : 'All QA tickets'}</h3>
          {qa && <button className="btn btn-secondary" onClick={() => setSelectedQAFilter(null)}>Close</button>}
        </div>
        {qa && (
          <div className="summary-grid">
            {cards.map(c => (
              <MetricCard key={c.label} icon={c.icon} title={c.label} value={c.value} color={c.color} />
            ))}
          </div>
        )}
        {/* One filter row: All + each status actually present (no duplicate flag row) */}
        <div className="filter-tabs">
          <button className={`filter-tab ${qaFilter === 'all' ? 'active' : ''}`} onClick={() => setQaFilter('all')}>
            All <span className="filter-tab-count">{tickets.length}</span>
          </button>
          {['QA Review', 'QA BLOCKED', 'In Progress', 'Code Review', 'Ready to Release', 'Done', 'Released To Prod'].filter(s => statusCounts[s]).map(s => (
            <button key={s} className={`filter-tab ${qaFilter === s ? 'active' : ''}`} onClick={() => setQaFilter(qaFilter === s ? 'all' : s)}>
              <span className="chip-dot" style={{ backgroundColor: getStatusMeta(s).color }} />{s} <span className="filter-tab-count">{statusCounts[s]}</span>
            </button>
          ))}
        </div>
        <SmartTable
          key={(qa || 'all') + qaFilter}
          rows={list}
          columns={qa ? ['Key', 'Summary', 'Status', 'Developer', 'In status', 'QA cycle'] : ['Key', 'Summary', 'Status', 'Primary QA', 'Developer', 'In status', 'QA cycle']}
          searchText={(i) => `${i.key} ${i.summary} ${i.assignee} ${i.primaryQA} ${i.status}`}
          renderRow={(i) => (
            <tr key={i.key} className="clickable-card" onClick={() => setSelectedTicket(i)}>
              <td style={{ fontWeight: 600 }}>{i.key}</td>
              <td>{i.summary}</td>
              <td><StatusBadge status={i.status} /></td>
              {!qa && <td><QAOwnerTag issue={i} />{!['QA Review','QA BLOCKED'].includes(i.status) && (issueQAs(i).join(', ') || '—')}</td>}
              <td>{i.assignee}</td>
              <td>{daysInStatus(i)}d</td>
              <td>{i.qaCycleDays != null ? `${i.qaCycleDays}d` : (i.status === 'QA Review' ? `${daysInStatus(i)}d waiting` : '—')}</td>
            </tr>
          )}
        />
      </div>
    );
  };

  // Shared filterable per-person panel (used in presenter mode AND on person click)
  const STATUS_CHIP_ORDER = ['In Progress', 'Code Review', 'QA Review', 'QA BLOCKED', 'Ready to Release', 'Done', 'Released To Prod'];
  const renderPersonPanel = (p) => {
    const active = p.active;
    const statusCounts = {};
    active.forEach(i => { statusCounts[i.status] = (statusCounts[i.status] || 0) + 1; });
    // Behavioral flags only — "Blocked" removed (it duplicated the QA BLOCKED status chip below)
    const flagChips = [
      { key: 'all', label: 'All active', n: active.length, tone: 'dev' },
      { key: 'moved', label: 'Moved', n: p.movedYesterday.length, tone: 'good' },
      { key: 'overdue', label: 'Overdue', n: p.overdue.length, tone: 'bad' },
      { key: 'stalled', label: 'Stalled', n: p.stalled.length, tone: 'warn' },
    ];
    let list;
    if (personFilter === 'all') list = active;
    else if (personFilter === 'moved') list = p.movedYesterday;
    else if (personFilter === 'overdue') list = p.overdue;
    else if (personFilter === 'stalled') list = p.stalled;
    else if (personFilter === 'blocked') list = p.blocked;
    else list = active.filter(i => i.status === personFilter);
    if (personTypeFilter !== 'All') list = list.filter(i => i.type === personTypeFilter);
    list = [...list].sort((a, b) => daysInStatus(b) - daysInStatus(a));
    return (
      <>
        <div className="filter-tabs">
          {flagChips.map(c => (
            <button key={c.key} className={`filter-tab tone-${c.tone} ${personFilter === c.key ? 'active' : ''}`} onClick={() => setPersonFilter(c.key)}>
              {c.label} <span className="filter-tab-count">{c.n}</span>
            </button>
          ))}
        </div>
        <div className="filter-tabs">
          {STATUS_CHIP_ORDER.filter(s => statusCounts[s]).map(s => (
            <button key={s} className={`filter-tab ${personFilter === s ? 'active' : ''}`} onClick={() => setPersonFilter(personFilter === s ? 'all' : s)}>
              <span className="chip-dot" style={{ backgroundColor: getStatusMeta(s).color }} />{s} <span className="filter-tab-count">{statusCounts[s]}</span>
            </button>
          ))}
        </div>
        <TypeFilterChips scope={active} value={personTypeFilter} onChange={setPersonTypeFilter} />
        <table className="aging-table">
          <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>In status</th><th>Flags</th></tr></thead>
          <tbody>
            {list.map(i => (
              <tr key={i.key} className="clickable-card" onClick={() => setSelectedTicket(i)}>
                <td style={{ fontWeight: 600 }}>{i.key}</td>
                <td>{i.summary}</td>
                <td><StatusBadge status={i.status} /></td>
                <td>{daysInStatus(i)}d</td>
                <td>
                  {overdueInfo(i).overdue && <span className="vchip vchip-bad">overdue</span>}
                  {overdueInfo(i).approaching && <span className="vchip vchip-warn">due soon</span>}
                  {isStalled(i) && <span className="vchip vchip-warn">stalled</span>}
                  <QAOwnerTag issue={i} />
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No tickets for this filter.</td></tr>}
          </tbody>
        </table>
      </>
    );
  };
  const totalInProgress = issues.filter(i => i.status === 'In Progress').length;
  const totalInQA = issues.filter(i => i.status === 'QA Review').length;
  const totalToDo = issues.filter(i => i.status === 'To Do').length;

  // Board Health Index formula: less sensitive to avoid flat 0% with standard team sizing
  const calculatedBHI = Math.max(10, Math.round(100 - (10 * blockedIssues.length) - (1.5 * slaBreachedIssues.length) - (2.5 * overloadedMembers.length)));

  // Release safety metrics
  const totalDefects = issues.filter(i => i.type === 'Bug' && !isDone(i.status)).length;
  const criticalDefects = issues.filter(i => i.type === 'Bug' && i.priority === 'Highest' && !isDone(i.status)).length;
  const releaseConfidence = Math.max(15, Math.round(100 - (10 * criticalDefects) - (1.2 * totalDefects) - (3 * blockedIssues.length)));

  // Spillover forecasting (Active items with aging > SLA or In Progress near end of sprint)
  const likelySpillovers = issues.filter(i => !isDone(i.status) && (i.blocked || i.staleDays >= 3));

  // Focus list (Top Risks for Standup)
  const focusList = [...issues]
    .sort((a, b) => {
      if (a.blocked && !b.blocked) return -1;
      if (!a.blocked && b.blocked) return 1;
      const aSlaGap = a.staleDays - (SLA_LIMITS[a.status] || 0);
      const bSlaGap = b.staleDays - (SLA_LIMITS[b.status] || 0);
      if (aSlaGap !== bSlaGap) return bSlaGap - aSlaGap;
      return b.staleDays - a.staleDays;
    })
    .slice(0, 5);

  // Grouped In-Progress calculations
  const getGroupInProgressIssues = (groupName) => {
    if (groupName === 'QA Team') {
      return issues.filter(i => i.status === 'QA Review');
    }
    return issues.filter(i => {
      if (i.status !== 'In Progress') return false;
      const member = REAL_TEAM.find(m => m.name === i.assignee);
      return member && member.devGroup === groupName;
    });
  };

  // QA turnaround, computed from real Jira changelog (qaCycleDays / qaOngoingDays)
  const getQATimeDetail = (issue) => {
    if (issue.qaCycleDays != null) return `${issue.qaCycleDays}d (Completed)`;
    if (issue.qaOngoingDays != null) return `${issue.qaOngoingDays}d (In QA)`;
    return 'N/A';
  };

  // Handlers
  const handleToggleBlocker = (key, customReason = '') => {
    setIssues(prev => prev.map(issue => {
      if (issue.key === key) {
        const nextBlocked = !issue.blocked;
        return {
          ...issue,
          blocked: nextBlocked,
          blockerReason: nextBlocked ? (customReason || 'Blocked on dependency') : ''
        };
      }
      return issue;
    }));
  };

  const handleStatusChange = (key, nextStatus) => {
    const todayStr = new Date().toISOString().split('T')[0];
    setIssues(prev => prev.map(issue => {
      if (issue.key === key) {
        const newHistory = [
          ...issue.history,
          { status: nextStatus, date: todayStr, user: 'Project Manager' }
        ];
        return {
          ...issue,
          status: nextStatus,
          staleDays: 0, // reset age on update
          history: newHistory
        };
      }
      return issue;
    }));
  };

  const handleAddAction = () => {
    if (!newActionText.trim()) return;
    const newAction = {
      id: Date.now(),
      text: newActionText.trim(),
      owner: newActionOwner,
      completed: false
    };
    setActions(prev => [newAction, ...prev]);
    setNewActionText('');
  };

  const handleToggleActionCompleted = (id) => {
    setActions(prev => prev.map(act => 
      act.id === id ? { ...act, completed: !act.completed } : act
    ));
  };

  const handleDeleteAction = (id) => {
    setActions(prev => prev.filter(act => act.id !== id));
  };

  // Team Metrics Calculation Helper
  const getTeamMetrics = (teamName) => {
    let teamIssues = [];
    if (teamName === 'QA Team') {
      // QA Team tracks tickets currently in QA Review, or completed tickets tested by QAs
      teamIssues = issues.filter(i => i.status === 'QA Review' || (isDone(i.status) && issueQAs(i).length > 0));
    } else {
      const teamMemberNames = REAL_TEAM.filter(m => m.devGroup === teamName).map(m => m.name);
      teamIssues = issues.filter(i => teamMemberNames.includes(i.assignee));
    }

    const active = teamIssues.filter(i => !isDone(i.status));
    const completed = teamIssues.filter(i => isDone(i.status));
    const total = teamIssues.length;
    const successRate = total > 0 ? Math.round((completed.length / total) * 100) : 100;
    const slaBreachedList = active.filter(i => i.staleDays > (SLA_LIMITS[i.status] || 99)).sort((a, b) => b.staleDays - a.staleDays);
    const deliveredSP = completed.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
    const pendingSP = active.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
    const devCount = REAL_TEAM.filter(m => m.devGroup === teamName).length;

    return {
      activeCount: active.length,
      completedCount: completed.length,
      successRate,
      slaBreaches: slaBreachedList.length,
      slaBreachedList,
      deliveredSP,
      pendingSP,
      devCount,
      velocity: devCount > 0 ? +(deliveredSP / devCount).toFixed(1) : 0,
      allIssues: teamIssues
    };
  };

  // Kanban lanes mapping
  const columns = ['To Do', 'In Progress', 'Code Review', 'QA Review', 'QA BLOCKED', 'Ready to Release', 'Done', 'Released To Prod', 'Rejected'];
  
  // Filtered issues list based on active team member selection
  const getIssuesForColumn = (colName) => {
    let list = issues.filter(i => i.status === colName);
    if (selectedAssignee) {
      list = list.filter(i => i.assignee === selectedAssignee);
    }
    return list;
  };

  return (
    <div className="app-container">
      {selectedTicket && <TicketModal issue={selectedTicket} onClose={() => setSelectedTicket(null)} />}

      {/* LEFT NAVIGATION SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-logo">
            <div className="logo-icon">AI</div>
            <div className="logo-text">
              <h2>Control Tower</h2>
              <span>Growth99 Engineering</span>
            </div>
          </div>
          <nav className="sidebar-nav">
            {[
              { id: 'overview', label: 'Overview', icon: 'dashboard' },
              { id: 'standup', label: 'Standup', icon: 'clock' },
              { id: 'kanban', label: 'Kanban Board', icon: 'kanban' },
              { id: 'metrics', label: 'QA Performance', icon: 'chart' },
              { id: 'team-workload', label: 'Team Workload', icon: 'users' },
              { id: 'analytics', label: 'Analytics', icon: 'zap' },
              { id: 'capacity', label: 'Capacity', icon: 'target2' },
              { id: 'interns', label: 'Interns', icon: 'grad' },
              { id: 'release', label: 'Release Readiness', icon: 'rocket' },
            ].map(item => (
              <button
                key={item.id}
                className={`nav-item ${currentTab === item.id ? 'active' : ''}`}
                onClick={() => { setCurrentTab(item.id); setSelectedDevFilter(null); setSelectedQAFilter(null); }}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer-card">
          <h4>Top Insight</h4>
          <p>{insights[0] ? insights[0].text : 'All clear — nothing flagged right now.'}</p>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        
        {/* TOP HEADER SECTION */}
        <div className="top-header">
          <div className="header-title">
            <h1>Engineering Control Tower</h1>
            <p>{new Date(TODAY + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} • Sprint #38 • Jul 16 – {reportEndLabel} elapsed (day {sprintDayNum} of {sprintTotalDays}) • {daysLeft === 0 ? 'Final day' : `${daysLeft} days remaining`}</p>
          </div>
          <div className="header-actions">
            <GlobalSearch issues={issues} onPick={(i) => setSelectedTicket(i)} />
            <button className="btn btn-secondary" onClick={() => window.location.reload()} title="Reloads the page — data updates when npm run sync has run">
              <Icon name="refresh" size={15} /> Reload
            </button>
            <button className="btn btn-primary" onClick={() => setCurrentTab('standup')}>
              <Icon name="zap" size={15} /> Start Meeting Mode
            </button>
          </div>
        </div>

        {/* METRICS ROW SUMMARY — Overview only */}
        {currentTab === 'overview' && (
        <div className="summary-grid">
          <MetricCard icon="chart" title="Sprint Health Score" value={`${calculatedBHI}/100`}
            color={calculatedBHI >= 85 ? 'var(--color-success)' : calculatedBHI >= 70 ? 'var(--color-warning)' : 'var(--color-danger)'}
            desc="Heuristic — blockers, SLA & WIP" />
          <MetricCard icon="rocket" title="Release Confidence" value={`${releaseConfidence}%`} color="var(--color-primary)"
            desc="Heuristic — open & critical defects" />
          <MetricCard icon="ban" title="Active Blockers" value={blockedIssues.length}
            color={blockedIssues.length > 0 ? 'var(--color-danger)' : 'var(--text-primary)'} desc="High risk critical path items" />
          <MetricCard icon="clock" title="Stuck Tickets" value={slaBreachedIssues.length} color="var(--color-warning)"
            desc="No movement past aging limit" />
        </div>
        )}

        {/* TAB 1: EXECUTIVE OVERVIEW */}
        {currentTab === 'overview' && (() => {
          // ---- Data Health: freshness + reconciliation checks (no backend — a static
          // app can't call Jira from the browser, so "is my data correct?" becomes a
          // set of internal consistency checks + an honest "synced X ago" stamp). ----
          const syncedDate = new Date(DATA_META.syncedAt + 'T00:00:00');
          const daysStale = Math.round((new Date(TODAY + 'T00:00:00') - syncedDate) / DAY);
          const healthChecks = [];
          const noPrimaryQAfield = issues.filter(i => !i.primaryQA);
          if (noPrimaryQAfield.length) healthChecks.push({ level: 'bad', text: `${noPrimaryQAfield.length} tickets are missing the primaryQA field entirely (sync issue, not "unassigned").` });
          const badHistory = issues.filter(i => !Array.isArray(i.history) || i.history.length === 0);
          if (badHistory.length) healthChecks.push({ level: 'bad', text: `${badHistory.length} tickets have no history — status timeline unavailable for them.` });
          const inQaNoEnter = issues.filter(i => (i.status === 'QA Review' || i.status === 'QA BLOCKED') && !i.qaEnteredDate);
          if (inQaNoEnter.length) healthChecks.push({ level: 'warn', text: `${inQaNoEnter.length} tickets are in QA but have no recorded QA-entry date — their turnaround can't be timed precisely.` });
          const doneNoQaDone = issues.filter(i => isDone(i.status) && i.qaEnteredDate && !i.qaDoneDate);
          if (doneNoQaDone.length) healthChecks.push({ level: 'warn', text: `${doneNoQaDone.length} completed tickets entered QA but have no recorded QA-done date — cycle time missing for them.` });
          const spOutlier = issues.filter(i => i.storyPoints > 13);
          if (spOutlier.length) healthChecks.push({ level: 'warn', text: `${spOutlier.length} tickets carry a story-point value over 13 — verify these aren't data-entry errors.` });
          if (daysStale >= 2) healthChecks.push({ level: 'bad', text: `Data was last synced ${daysStale} days ago — statuses may have changed in Jira since. Run npm run sync.` });
          else if (daysStale === 1) healthChecks.push({ level: 'warn', text: `Data was synced yesterday — check for drift before trusting exact counts.` });

          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

            {/* DATA HEALTH */}
            <div className="section-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <h2 className="section-title">Data health</h2>
                <span className={`freshness-pill ${daysStale >= 2 ? 'fp-bad' : daysStale === 1 ? 'fp-warn' : 'fp-ok'}`}>
                  <Icon name="clock" size={13} /> Synced {daysStale === 0 ? 'today' : `${daysStale}d ago`} · {DATA_META.sprint}
                </span>
              </div>
              {healthChecks.length === 0
                ? <p style={{ margin: 0, color: 'var(--color-success)' }}>All reconciliation checks pass — no gaps found in the synced dataset.</p>
                : (
                  <div className="insights-list">
                    {healthChecks.map((c, idx) => (
                      <div key={idx} className={`insight-item insight-${c.level}`}>
                        <span className="insight-dot" /><span>{c.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-muted)' }}>
                This checks the synced dataset for internal gaps — it can't reach live Jira from the browser. For an authoritative refresh, run <code>npm run sync</code> or ask Claude to re-pull via the Jira MCP.
              </p>
            </div>

            {/* SPRINT PROGRESS + INSIGHTS */}
            <div className="section-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
                <h2 className="section-title">Sprint Progress</h2>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {doneCount} of {issues.length} done · day {sprintDayNum} of {sprintTotalDays} · {daysLeft} day{daysLeft === 1 ? '' : 's'} left
                </span>
              </div>
              {(() => {
                // Stacked composition bar — greens merged so identical hues never sit adjacent
                const segs = [
                  { label: 'Done / Ready', color: getStatusMeta('Done').color, n: doneCount },
                  { label: 'QA Review', color: getStatusMeta('QA Review').color, n: issues.filter(i => i.status === 'QA Review').length },
                  { label: 'QA Blocked', color: getStatusMeta('QA BLOCKED').color, n: issues.filter(i => i.status === 'QA BLOCKED').length },
                  { label: 'Code Review', color: getStatusMeta('Code Review').color, n: issues.filter(i => i.status === 'Code Review').length },
                  { label: 'In Progress', color: getStatusMeta('In Progress').color, n: issues.filter(i => i.status === 'In Progress').length },
                  { label: 'To Do', color: getStatusMeta('To Do').color, n: issues.filter(i => i.status === 'To Do').length },
                ].filter(s => s.n > 0);
                return (
                  <>
                    <div className="stacked-bar">
                      {segs.map(s => (
                        <div key={s.label} className="stacked-seg" title={`${s.label}: ${s.n}`} style={{ flexGrow: s.n, backgroundColor: s.color }} />
                      ))}
                    </div>
                    <div className="progress-legend">
                      {segs.map(s => (
                        <span key={s.label} className="progress-legend-item">
                          <span className="status-dot" style={{ backgroundColor: s.color }} />
                          {s.label} <strong>{s.n}</strong>
                        </span>
                      ))}
                    </div>
                  </>
                );
              })()}

              <div className="insights-list">
                {insights.map((ins, idx) => (
                  <div key={idx} className={`insight-item insight-${ins.tone}`}>
                    <span className="insight-dot" />
                    <span>{ins.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* WHERE THE SPRINT IS WAITING */}
            <div className="section-panel">
              <h2 className="section-title">Where the sprint is waiting</h2>
              <p>Every not-done ticket, grouped by who holds the ball right now.</p>
              <div className="waiting-grid">
                {[
                  { key: 'Dev', label: 'With Dev', color: 'var(--color-primary)' },
                  { key: 'QA', label: 'With QA', color: '#7c3aed' },
                  { key: 'Blocked', label: 'Blocked', color: 'var(--color-danger)' },
                  { key: 'Unstarted', label: 'Not started', color: '#6b7280' },
                ].map(w => (
                  <div key={w.key} className="waiting-box" style={{ borderTopColor: w.color }}>
                    <span className="waiting-val" style={{ color: w.color }}>{waitingCounts[w.key]}</span>
                    <span className="waiting-lbl">{w.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* SPRINT BURNUP */}
            <div className="section-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
                <h2 className="section-title">Sprint burnup</h2>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Completed (Done / Ready) vs total scope, by day · Jul 16 – {reportEndLabel}</span>
              </div>
              <Burnup issues={issues} />
            </div>

            {/* ESTIMATION COVERAGE */}
            <div className="section-panel">
              <h2 className="section-title">Estimation coverage</h2>
              <div className="est-row">
                <Donut
                  value={activeIssuesAll.length - unestimated.length}
                  total={activeIssuesAll.length}
                  color="var(--color-primary)"
                  label="Active tickets with a story-point estimate"
                />
                <div className="est-note">
                  <p style={{ margin: 0 }}>
                    {unestimated.length > 0
                      ? `${unestimated.length} active tickets have no estimate. Overdue detection falls back to a 1-day allowance for them, and team velocity under-reports until they're pointed.`
                      : 'Every active ticket is estimated — overdue and velocity numbers are fully trustworthy.'}
                  </p>
                  {unestimated.length > 0 && (
                    <div className="filter-tabs" style={{ marginTop: '10px' }}>
                      {[...new Set(unestimated.filter(i => i.assignee !== 'Unassigned').map(i => i.assignee))].slice(0, 8).map(n => (
                        <span key={n} className="filter-tab" style={{ cursor: 'default' }}>
                          {n} <span className="filter-tab-count">{unestimated.filter(i => i.assignee === n).length}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* TEAM WORKLOAD CHART */}
            <div className="section-panel">
              <h2 className="section-title">Workload by team</h2>
              <p>Each team's tickets by state — click a bar to open that team's deep-dive.</p>
              <div className="progress-legend">
                {[
                  { label: 'Done / Ready', color: getStatusMeta('Done').color },
                  { label: 'Active', color: 'var(--color-primary)' },
                  { label: 'To Do', color: getStatusMeta('To Do').color },
                ].map(l => (
                  <span key={l.label} className="progress-legend-item">
                    <span className="status-dot" style={{ backgroundColor: l.color }} />{l.label}
                  </span>
                ))}
              </div>
              <div className="team-chart">
                {(() => {
                  const rows = DEV_TEAMS.map(t => {
                    const m = getTeamMetrics(t);
                    const done = m.completedCount;
                    const todo = m.allIssues.filter(i => i.status === 'To Do').length;
                    const active = m.activeCount - todo;
                    return { t, done, active, todo, total: m.allIssues.length };
                  });
                  const max = Math.max(1, ...rows.map(r => r.total));
                  return rows.map(r => (
                    <div key={r.t} className="team-chart-row clickable-card" title={`${r.t}: ${r.done} done · ${r.active} active · ${r.todo} to do`}
                      onClick={() => { setSelectedTeam(r.t); setCurrentTab('team-workload'); }}>
                      <span className="tc-name">{r.t}</span>
                      <span className="tc-track">
                        <span className="tc-stack" style={{ width: `${(r.total / max) * 100}%` }}>
                          {r.done > 0 && <span className="tc-seg" style={{ flexGrow: r.done, backgroundColor: getStatusMeta('Done').color }} />}
                          {r.active > 0 && <span className="tc-seg" style={{ flexGrow: r.active, backgroundColor: 'var(--color-primary)' }} />}
                          {r.todo > 0 && <span className="tc-seg" style={{ flexGrow: r.todo, backgroundColor: getStatusMeta('To Do').color }} />}
                        </span>
                      </span>
                      <span className="tc-total">{r.total}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* COMPLETION THROUGHPUT */}
            <div className="section-panel">
              <h2 className="section-title">Completion throughput — last 14 days</h2>
              <p>Tickets that reached Done / Ready to Release each day (from status history).</p>
              <div className="throughput-chart">
                {throughput.map(t => (
                  <div key={t.day} className="tp-col" title={`${t.day}: ${t.count}`}>
                    <div className="tp-bar" style={{ height: `${(t.count / throughputMax) * 100}%` }}>
                      {t.count > 0 && <span className="tp-count">{t.count}</span>}
                    </div>
                    <span className="tp-day">{t.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* REWORK & RECURRING BLOCKERS */}
            <div className="section-panel">
              <h2 className="section-title">Rework & recurring blockers</h2>
              <p>{reopened.length} tickets were reopened (sent back to In Progress after moving on), {qaBlockedNow.length} are currently QA-blocked.</p>
              {reopened.length > 0 && (
                <table className="aging-table">
                  <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Assignee</th><th>Times reopened</th></tr></thead>
                  <tbody>
                    {reopened.slice(0, 10).map(({ issue, bounces }) => (
                      <tr key={issue.key} className="clickable-card" onClick={() => setSelectedTicket(issue)}>
                        <td style={{ fontWeight: 600 }}>{issue.key}</td>
                        <td>{issue.summary}</td>
                        <td><StatusBadge status={issue.status} /></td>
                        <td>{issue.assignee}</td>
                        <td><span className="vchip vchip-warn">{bounces}×</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* AGING WIP */}
            <div className="section-panel">
              <h2 className="section-title">Aging work in progress</h2>
              <p>Every ticket in a work lane, plotted by % of its own SLA budget consumed — SP-day budget for Dev/Code Review, the 24-hour rule for QA lanes. Above the red line means breached, regardless of lane. Click a dot for the ticket.</p>
              <AgingWIP issues={issues} onPick={(i) => setSelectedTicket(i)} />
              <div className="progress-legend">
                <span className="progress-legend-item"><span className="status-dot" style={{ backgroundColor: 'var(--color-danger)' }} />&gt;100% — breached</span>
                <span className="progress-legend-item"><span className="status-dot" style={{ backgroundColor: 'var(--color-warning)' }} />70–100% — due soon</span>
                <span className="progress-legend-item"><span className="status-dot" style={{ backgroundColor: 'var(--color-primary)' }} />&lt;70% — on track</span>
              </div>
            </div>

            {/* SPRINT-OVER-SPRINT COMPARISON */}
            {LAST_SPRINT.length > 0 && (() => {
              const cur = computeDeliveryStats(issues, TODAY, Date.now());
              const prev = computeDeliveryStats(LAST_SPRINT, '2026-07-15', new Date('2026-07-15T23:59:59').getTime());
              const rows = [
                { label: 'Tickets', a: prev.tickets, b: cur.tickets, fmt: (v) => v },
                { label: 'Completed', a: prev.done, b: cur.done, fmt: (v) => v },
                { label: 'Completion %', a: prev.completionPct, b: cur.completionPct, fmt: (v) => `${v}%` },
                { label: 'Dev on-time to QA', a: prev.devOnTimePct, b: cur.devOnTimePct, fmt: (v) => v != null ? `${v}%` : 'N/A' },
                { label: 'QA within 24h', a: prev.qaWithinPct, b: cur.qaWithinPct, fmt: (v) => v != null ? `${v}%` : 'N/A' },
                { label: 'Avg QA turnaround', a: prev.avgQaCycleH, b: cur.avgQaCycleH, fmt: (v) => v != null ? fmtHours(v) : 'N/A', lowerIsBetter: true },
                { label: 'Delivered SP', a: prev.doneSP, b: cur.doneSP, fmt: (v) => v },
              ];
              return (
                <div className="section-panel">
                  <h2 className="section-title">Sprint over sprint — #37 vs #38</h2>
                  <p>Last sprint (closed, Jul 1–15) vs current sprint so far (Jul 16–30, in progress).</p>
                  <table className="aging-table">
                    <thead><tr><th>Metric</th><th>#37 (last)</th><th>#38 (current)</th><th>Change</th></tr></thead>
                    <tbody>
                      {rows.map(r => {
                        const delta = (r.a != null && r.b != null) ? r.b - r.a : null;
                        const better = delta != null && (r.lowerIsBetter ? delta < 0 : delta > 0);
                        const worse = delta != null && (r.lowerIsBetter ? delta > 0 : delta < 0);
                        return (
                          <tr key={r.label}>
                            <td style={{ fontWeight: 600 }}>{r.label}</td>
                            <td>{r.fmt(r.a)}</td>
                            <td style={{ fontWeight: 600 }}>{r.fmt(r.b)}</td>
                            <td>
                              {delta == null ? '—' : (
                                <span style={{ color: better ? 'var(--color-success)' : worse ? 'var(--color-danger)' : 'var(--text-muted)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  {delta === 0 ? <Icon name="target2" size={12} /> : <Icon name={better ? 'zap' : 'alert'} size={12} />}
                                  {delta === 0 ? 'flat' : (r.label === 'Avg QA turnaround'
                                    ? `${delta > 0 ? '+' : ''}${fmtHours(Math.abs(delta))} ${delta > 0 ? 'slower' : 'faster'}`
                                    : `${delta > 0 ? '+' : ''}${delta}${r.fmt(0).toString().includes('%') ? '%' : ''}`)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
          );
        })()}

        {/* TAB 3: STANDUP — command center */}
        {currentTab === 'standup' && (() => {
          const cats = [
            { key: 'focus', label: 'Focus now', tone: 'dev' },
            { key: 'moved', label: 'Moved today', tone: 'good' },
            { key: 'overdue', label: 'Overdue', tone: 'bad' },
            { key: 'stalled', label: 'Stalled', tone: 'warn' },
            { key: 'blocked', label: 'Blocked', tone: 'bad' },
            { key: 'inqa', label: 'In QA', tone: 'qa' },
            { key: 'todo', label: 'To Do', tone: 'muted' },
          ];
          const pred = {
            focus: i => !isDone(i.status) && i.status !== 'To Do',
            moved: i => i.status !== 'To Do' && movedSince(i, YESTERDAY),
            overdue: i => overdueInfo(i).overdue,
            stalled: i => isStalled(i),
            blocked: i => i.status === 'QA BLOCKED',
            inqa: i => i.status === 'QA Review',
            todo: i => i.status === 'To Do',
          };
          const inScope = (i) => standupPerson === 'all' ? true : (i.assignee === standupPerson || issueQAs(i).includes(standupPerson));
          const scoped = issues.filter(inScope);
          const countFor = (k) => scoped.filter(pred[k]).length;
          let list = scoped.filter(pred[standupCat] || pred.focus);
          if (standupCat === 'focus') {
            list = [...list].sort((a, b) => {
              if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
              const ao = overdueInfo(a).overdue ? overdueInfo(a).overdueBy : -999;
              const bo = overdueInfo(b).overdue ? overdueInfo(b).overdueBy : -999;
              if (ao !== bo) return bo - ao;
              return daysInStatus(b) - daysInStatus(a);
            });
          } else {
            list = [...list].sort((a, b) => daysInStatus(b) - daysInStatus(a));
          }
          const activeCat = cats.find(c => c.key === standupCat) || cats[0];
          const scopeLabel = standupPerson === 'all' ? 'whole team' : standupPerson;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

              {/* CONTROL BAR + CATEGORY CARDS */}
              <div className="section-panel">
                <div className="standup-controlbar">
                  <div className="standup-person">
                    <label>Standup for</label>
                    <select className="filter-select" value={standupPerson} onChange={(e) => setStandupPerson(e.target.value)}>
                      <option value="all">Whole team · {personBriefs.length} people</option>
                      {Object.entries(personBriefs.reduce((acc, p) => { const t = teamOf(p.name); (acc[t] = acc[t] || []).push(p); return acc; }, {})).map(([team, members]) => (
                        <optgroup key={team} label={team}>
                          {members.map(p => <option key={p.name} value={p.name}>{p.name} · {p.active.length} active</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <button className="btn btn-primary" onClick={() => { setPresenter(!presenter); setPresenterIdx(0); setPersonFilter('all'); setPersonTypeFilter('All'); }}>
                    <Icon name="zap" size={15} /> {presenter ? 'Exit presenter' : 'Presenter mode'}
                  </button>
                </div>
                <div className="cat-cards">
                  {cats.map(c => (
                    <button key={c.key} className={`cat-card tone-${c.tone} ${standupCat === c.key ? 'active' : ''}`} onClick={() => setStandupCat(c.key)}>
                      <span className="cat-n">{countFor(c.key)}</span>
                      <span className="cat-l">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {presenter ? (
                <div className="section-panel">
                  {personBriefs.length > 0 && (() => {
                    const p = personBriefs[Math.min(presenterIdx, personBriefs.length - 1)];
                    return (
                      <div className="presenter">
                        <div className="presenter-nav">
                          <button className="btn btn-secondary" disabled={presenterIdx === 0} onClick={() => { setPresenterIdx(i => Math.max(0, i - 1)); setPersonFilter('all'); setPersonTypeFilter('All'); }}>← Prev</button>
                          <span className="presenter-count">{presenterIdx + 1} / {personBriefs.length} · {discussed.size} discussed</span>
                          <button className="btn btn-secondary" disabled={presenterIdx >= personBriefs.length - 1} onClick={() => { setPresenterIdx(i => Math.min(personBriefs.length - 1, i + 1)); setPersonFilter('all'); setPersonTypeFilter('All'); }}>Next →</button>
                          <button className="btn btn-primary" onClick={() => { setDiscussed(prev => new Set(prev).add(p.name)); setPresenterIdx(i => Math.min(personBriefs.length - 1, i + 1)); setPersonFilter('all'); setPersonTypeFilter('All'); }}>
                            <Icon name="check" size={15} /> Discussed &amp; next
                          </button>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>← → move · D / Space = discussed</span>
                        </div>
                        <h3 className="presenter-name">{discussed.has(p.name) ? '✓ ' : ''}{p.name}</h3>
                        {renderPersonPanel(p)}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="section-panel">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <h2 className="section-title">{activeCat.label} — {scopeLabel} ({list.length})</h2>
                    <span className="filter-count">Click any ticket for its full timeline</span>
                  </div>
                  <SmartTable
                    key={standupCat + standupPerson}
                    rows={list}
                    columns={['Key', 'Summary', 'Assignee', 'Status', 'In status', 'Flags']}
                    searchText={(i) => `${i.key} ${i.summary} ${i.assignee} ${i.primaryQA} ${i.status}`}
                    renderRow={(i) => (
                      <tr key={i.key} className="clickable-card" onClick={() => setSelectedTicket(i)}>
                        <td style={{ fontWeight: 600 }}>{i.key}</td>
                        <td>{i.summary}</td>
                        <td>{i.assignee}</td>
                        <td><StatusBadge status={i.status} /></td>
                        <td>{daysInStatus(i)}d</td>
                        <td>
                          {overdueInfo(i).overdue && <span className="vchip vchip-bad">overdue</span>}
                          {overdueInfo(i).approaching && <span className="vchip vchip-warn">due soon</span>}
                          {isStalled(i) && <span className="vchip vchip-warn">stalled</span>}
                          <QAOwnerTag issue={i} />
                        </td>
                      </tr>
                    )}
                  />
                </div>
              )}

              {/* ACTION ITEMS */}
              <div className="section-panel">
                <h2 className="section-title">Meeting Action Items</h2>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <input type="text" placeholder="Action description..." value={newActionText} onChange={(e) => setNewActionText(e.target.value)} style={{ flexGrow: 1, minWidth: '200px', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }} />
                  <select value={newActionOwner} onChange={(e) => setNewActionOwner(e.target.value)} className="filter-select">
                    {REAL_TEAM.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                  <button className="btn btn-primary" onClick={handleAddAction}>Add Action</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                  {actions.map(act => (
                    <div key={act.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-subtle)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input type="checkbox" checked={act.completed} onChange={() => handleToggleActionCompleted(act.id)} />
                        <span style={{ textDecoration: act.completed ? 'line-through' : 'none' }}>{act.text}</span>
                        <span style={{ fontSize: '11px', backgroundColor: 'var(--color-primary-glow)', color: 'var(--color-primary)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>{act.owner}</span>
                      </div>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => handleDeleteAction(act.id)}>Delete</button>
                    </div>
                  ))}
                  {actions.length === 0 && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>No action items logged yet.</p>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* TAB: CAPACITY & REBALANCING (individual) */}
        {currentTab === 'capacity' && (
          (() => {
            // team-level rollups
            const teamRows = DEV_TEAMS.map(t => {
              const m = getTeamMetrics(t);
              const overdueN = m.allIssues.filter(i => overdueInfo(i).overdue).length;
              return { t, m, overdueN };
            });
            const maxActive = Math.max(1, ...teamRows.map(r => r.m.activeCount));
            // member load within the selected team (QA team measures Primary-QA load, not assignee)
            const memberLoad = (name) => capTeam === 'QA Team'
              ? issues.filter(i => issueQAs(i).includes(name) && !isDone(i.status)).length
              : issues.filter(i => i.assignee === name && !isDone(i.status)).length;
            const members = capTeam
              ? REAL_TEAM.filter(mm => mm.devGroup === capTeam)
                  .map(mm => ({ ...mm, load: memberLoad(mm.name), overdue: issues.filter(i => (capTeam === 'QA Team' ? issueQAs(i).includes(mm.name) : i.assignee === mm.name) && overdueInfo(i).overdue).length }))
                  .sort((a, b) => b.load - a.load)
              : [];
            const sel = capTeam ? teamRows.find(r => r.t === capTeam) : null;
            return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

            {/* TEAM CAPACITY (top level) */}
            <div className="section-panel">
              <h2 className="section-title">Team capacity</h2>
              <p>Active load per team, with delivered velocity. Click a team to see its members.</p>
              <div className="team-chart">
                {teamRows.map(r => (
                  <div key={r.t} className={`team-chart-row clickable-card ${capTeam === r.t ? 'tc-active' : ''}`}
                    title={`${r.t}: ${r.m.activeCount} active · ${r.m.velocity} SP/dev · ${r.m.deliveredSP} SP delivered`}
                    onClick={() => setCapTeam(capTeam === r.t ? null : r.t)}>
                    <span className="tc-name">{r.t}</span>
                    <span className="tc-track">
                      <span className="tc-fill" style={{ width: `${(r.m.activeCount / maxActive) * 100}%` }} />
                    </span>
                    <span className="tc-total">{r.m.activeCount}</span>
                    <span className="tc-meta">{r.m.velocity} SP/dev · {r.m.deliveredSP} SP done · {r.m.devCount} devs{r.overdueN > 0 ? ` · ${r.overdueN} overdue` : ''}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* MEMBERS OF SELECTED TEAM */}
            {capTeam && sel && (
              <div className="section-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <h2 className="section-title">{capTeam} — member capacity</h2>
                  <button className="btn btn-secondary" onClick={() => setCapTeam(null)}>Close</button>
                </div>
                <div className="summary-grid">
                  {[
                    { label: 'Active', value: sel.m.activeCount, color: 'var(--color-primary)', icon: 'target' },
                    { label: 'Velocity', value: `${sel.m.velocity} SP/dev`, color: 'var(--text-primary)', icon: 'zap' },
                    { label: 'Delivered SP', value: sel.m.deliveredSP, color: 'var(--color-success)', icon: 'check' },
                    { label: 'Overdue', value: sel.overdueN, color: sel.overdueN > 0 ? 'var(--color-danger)' : 'var(--text-primary)', icon: 'alert' },
                  ].map(c => (
                    <MetricCard key={c.label} icon={c.icon} title={c.label} value={c.value} color={c.color} />
                  ))}
                </div>
                <div className="capacity-grid">
                  {members.map(m => {
                    const level = m.load >= WIP_LIMIT ? 'over' : m.load <= 1 ? 'idle' : 'ok';
                    return (
                      <div key={m.name} className={`capacity-row cap-${level}`}>
                        <span className="mini-avatar">{m.code}</span>
                        <span className="capacity-name">{m.name}{m.intern ? ' (intern)' : ''}</span>
                        <span className="capacity-bar-wrap"><span className="capacity-bar" style={{ width: `${Math.min(100, (m.load / 8) * 100)}%` }} /></span>
                        <span className="capacity-num">{m.load}</span>
                        {m.overdue > 0 && <span className="vchip vchip-bad">{m.overdue} overdue</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ALL INDIVIDUALS (when no team selected) */}
            {!capTeam && (
              <div className="section-panel">
                <h2 className="section-title">Individual capacity — whole sprint</h2>
                <p>{overloaded.length} overloaded (≥{WIP_LIMIT} active), {idle.length} with spare capacity. {overloaded.length > 0 && idle.length > 0 ? 'Consider moving work from the red rows to the green.' : ''}</p>
                <div className="capacity-grid">
                  {capacity.filter(m => m.tickets > 0).map(m => {
                    const level = m.tickets >= WIP_LIMIT ? 'over' : m.tickets <= 1 ? 'idle' : 'ok';
                    return (
                      <div key={m.name} className={`capacity-row cap-${level}`}>
                        <span className="mini-avatar">{m.code}</span>
                        <span className="capacity-name">{m.name}{m.intern ? ' (intern)' : ''}</span>
                        <span className="capacity-bar-wrap"><span className="capacity-bar" style={{ width: `${Math.min(100, (m.tickets / 8) * 100)}%` }} /></span>
                        <span className="capacity-num">{m.tickets}</span>
                        {m.overdue > 0 && <span className="vchip vchip-bad">{m.overdue} overdue</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ESTIMATE ACCURACY */}
            <div className="section-panel">
              <h2 className="section-title">Estimate accuracy — SP vs actual days</h2>
              <p>Completed, estimated tickets only: how many working days each person actually took per story point (1 SP ≈ 1 working day).</p>
              {(() => {
                const doneSet2 = new Set(DONE_STATUSES);
                const measured = issues.filter(i => i.storyPoints > 0 && isDone(i.status) && i.inProgressDate)
                  .map(i => {
                    const dt = (i.history || []).find(h => doneSet2.has(h.status));
                    if (!dt) return null;
                    const actual = Math.max(0.5, workingDaysBetween(i.inProgressDate, dt.date) || 0.5);
                    return { i, actual, ratio: actual / i.storyPoints };
                  }).filter(Boolean);
                if (!measured.length) return <p style={{ margin: 0, color: 'var(--text-muted)' }}>No completed estimated tickets yet this sprint — this report fills in as pointed work lands.</p>;
                const byPerson = {};
                measured.forEach(x => { (byPerson[x.i.assignee] = byPerson[x.i.assignee] || []).push(x); });
                return (
                  <table className="aging-table">
                    <thead><tr><th>Person</th><th>Measured</th><th>Total SP</th><th>Actual days</th><th>Days per SP</th><th>Verdict</th></tr></thead>
                    <tbody>
                      {Object.entries(byPerson).sort((a, b) => b[1].length - a[1].length).map(([name, xs]) => {
                        const sp = xs.reduce((s, x) => s + x.i.storyPoints, 0);
                        const days = +(xs.reduce((s, x) => s + x.actual, 0)).toFixed(1);
                        const perSp = +(days / sp).toFixed(2);
                        const tone = perSp <= 1.1 ? 'good' : perSp <= 1.75 ? 'warn' : 'bad';
                        const verdict = perSp <= 1.1 ? 'On estimate' : perSp <= 1.75 ? 'Running over' : 'Far over — re-estimate';
                        return (
                          <tr key={name}>
                            <td style={{ fontWeight: 600 }}>{name}</td>
                            <td>{xs.length} tickets</td>
                            <td>{sp}</td>
                            <td>{days}</td>
                            <td style={{ fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{perSp}</td>
                            <td><Verdict tone={tone === 'good' ? 'ok' : tone}>{verdict}</Verdict></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
            );
          })()
        )}

        {/* TAB: ANALYTICS — delivery SLA performance */}
        {currentTab === 'analytics' && (() => {
          // ---- Range selection ----
          const weekAgo = dateStr(new Date(new Date(TODAY + 'T00:00:00').getTime() - 7 * DAY));
          let ds, asOf, asOfMs, rangeNote;
          if (analyticsRange === 'last') {
            ds = LAST_SPRINT; asOf = '2026-07-15'; asOfMs = new Date('2026-07-15T23:59:59').getTime();
            rangeNote = LAST_SPRINT.length ? `Sprint #37 (Jul 1–15) · ${LAST_SPRINT.length} tickets` : 'Last-sprint data not loaded yet — run the fetch.';
          } else if (analyticsRange === 'week') {
            ds = issues.filter(i => movedSince(i, weekAgo)); asOf = TODAY; asOfMs = Date.now();
            rangeNote = `Tickets with activity since ${weekAgo} · ${ds.length} tickets`;
          } else {
            ds = issues; asOf = TODAY; asOfMs = Date.now();
            rangeNote = `Sprint #38 (Jul 16–30) · ${ds.length} tickets`;
          }

          // Spillover: current-sprint tickets that were already in last sprint
          const SPILL_KEYS = new Set(LAST_SPRINT.map(x => x.key));
          const isSpill = (i) => analyticsRange !== 'last' && SPILL_KEYS.has(i.key);
          const lastByDev = {};
          LAST_SPRINT.forEach(i => { if (i.assignee !== 'Unassigned' && i.status !== 'Rejected') lastByDev[i.assignee] = (lastByDev[i.assignee] || 0) + 1; });

          // Per-developer dev-SLA scores + workload stats
          const devMap = {};
          ds.forEach(i => {
            if (i.assignee === 'Unassigned') return;
            const d = devMap[i.assignee] = devMap[i.assignee] || { ontime: 0, late: 0, flagged: 0, pending: 0, assigned: 0, sp: 0, doneT: 0, doneSP: 0, spill: 0 };
            d.assigned++; d.sp += i.storyPoints || 0;
            if (isDone(i.status)) { d.doneT++; d.doneSP += i.storyPoints || 0; }
            if (isSpill(i)) d.spill++;
            const s = devSlaInfo(i, asOf);
            if (s.state !== 'na') d[s.state]++;
          });
          const devRows = Object.entries(devMap).map(([name, d]) => {
            const measured = d.ontime + d.late + d.flagged;
            const spillRate = analyticsRange !== 'last' && lastByDev[name] ? Math.round((d.spill / lastByDev[name]) * 100) : null;
            return { name, ...d, measured, spillRate, pct: measured ? Math.round((d.ontime / measured) * 100) : null };
          }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.measured - a.measured);
          const devBarRows = devRows.filter(r => r.measured > 0);

          // Per-QA 24h turnaround scores + workload stats
          const qaMap = {};
          ds.forEach(i => {
            issueQAs(i).forEach(q => {
              const d = qaMap[q] = qaMap[q] || { within: 0, over: 0, pendingOk: 0, assigned: 0, sp: 0, tested: 0, testedSP: 0, inNow: 0, cycles: [] };
              d.assigned++; d.sp += i.storyPoints || 0;
              if (isDone(i.status)) { d.tested++; d.testedSP += i.storyPoints || 0; }
              if (i.status === 'QA Review' || i.status === 'QA BLOCKED') d.inNow++;
              const info = qaHoursInfo(i, asOfMs);
              if (!info) return;
              if (info.done) { info.hours <= 24 ? d.within++ : d.over++; d.cycles.push(info.hours); }
              else { info.hours > 24 ? d.over++ : d.pendingOk++; }
            });
          });
          const qaRows = Object.entries(qaMap).map(([name, d]) => {
            const measured = d.within + d.over;
            const avgH = d.cycles.length ? Math.round(d.cycles.reduce((a, b) => a + b, 0) / d.cycles.length) : null;
            return { name, ...d, measured, avgH, pct: measured ? Math.round((d.within / measured) * 100) : null };
          }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.assigned - a.assigned);
          const qaBarRows = qaRows.filter(r => r.measured + r.pendingOk > 0);

          // SLA breach register (dev flagged + QA over 24h)
          const breaches = [];
          ds.forEach(i => {
            const s = devSlaInfo(i, asOf);
            if (s.state === 'flagged') breaches.push({ i, type: 'Dev — over SP budget', owner: i.assignee, sp: i.storyPoints || 0, elapsed: `${s.took}d`, over: `${s.took - s.budget}d over` });
            const q = qaHoursInfo(i, asOfMs);
            if (q && !q.done && q.hours > 24) breaches.push({ i, type: 'QA — over 24h', owner: issueQAs(i).join(', ') || 'QA unassigned', sp: i.storyPoints || 0, elapsed: fmtHours(q.hours), over: `${fmtHours(q.hours - 24)} over` });
          });
          const totOnTime = devRows.reduce((s, r) => s + r.ontime, 0);
          const totMeasured = devRows.reduce((s, r) => s + r.measured, 0);
          const qaWithin = qaRows.reduce((s, r) => s + r.within, 0);
          const qaMeasured = qaRows.reduce((s, r) => s + r.measured, 0);
          const inQaNow = ds.filter(i => i.status === 'QA Review');
          const allCycles = ds.map(i => i.qaCycleDays).filter(v => v != null && v >= 0);
          const avgTurnH = allCycles.length ? Math.round((allCycles.reduce((a, b) => a + b, 0) / allCycles.length) * 24) : null;
          const devBreachRows = devRows.filter(r => r.flagged > 0).sort((a, b) => b.flagged - a.flagged);
          const maxFlagged = Math.max(1, ...devBreachRows.map(r => r.flagged));

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              {/* RANGE FILTER */}
              <div className="section-panel" style={{ gap: '10px' }}>
                <div className="filter-tabs">
                  {[
                    { key: 'sprint', label: 'Current sprint' },
                    { key: 'week', label: 'Last 7 days' },
                    { key: 'last', label: 'Last sprint (#37)' },
                  ].map(r => (
                    <button key={r.key} className={`filter-tab ${analyticsRange === r.key ? 'active' : ''}`} onClick={() => { setAnalyticsRange(r.key); setAnalyticsDev(null); setAnalyticsDevStatus('all'); setAnalyticsDevType('All'); setAnalyticsQA(null); setAnalyticsQAStatus('all'); setAnalyticsQAType('All'); }}>
                      {r.label}
                    </button>
                  ))}
                  <span className="filter-count" style={{ alignSelf: 'center' }}>{rangeNote}</span>
                </div>
              </div>

              {/* DEV DETAIL DRILL-DOWN */}
              {analyticsDev && (() => {
                const r = devRows.find(x => x.name === analyticsDev);
                const tix = ds.filter(i => i.assignee === analyticsDev);
                if (!tix.length) return (
                  <div className="section-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <h2 className="section-title">{analyticsDev}</h2>
                      <button className="btn btn-secondary" onClick={() => setAnalyticsDev(null)}>Close</button>
                    </div>
                    <p style={{ margin: 0, color: 'var(--text-muted)' }}>No tickets in this range.</p>
                  </div>
                );
                const stCounts = {};
                tix.forEach(i => { stCounts[i.status] = (stCounts[i.status] || 0) + 1; });
                const shown = (analyticsDevStatus === 'all' ? tix : tix.filter(i => i.status === analyticsDevStatus))
                  .filter(i => analyticsDevType === 'All' || i.type === analyticsDevType)
                  .sort((a, b) => daysInStatus(b) - daysInStatus(a));
                return (
                  <div id="analytics-detail" className="section-panel" style={{ borderColor: 'var(--color-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <h2 className="section-title">{analyticsDev} — detailed analytics</h2>
                      <button className="btn btn-secondary" onClick={() => setAnalyticsDev(null)}>Close</button>
                    </div>
                    <div className="summary-grid">
                      <MetricCard icon="target" title="Assigned" value={r ? r.assigned : tix.length} />
                      <MetricCard icon="target" title="Total SP" value={r ? r.sp : 0} />
                      <MetricCard icon="check" title="Completed" value={r ? r.doneT : 0} color="var(--color-success)" />
                      <MetricCard icon="check" title="Completed SP" value={r ? r.doneSP : 0} color="var(--color-success)" />
                      <MetricCard icon="zap" title="On-time to QA" value={r ? `${r.ontime}/${r.measured || 0}` : '—'} color="var(--color-primary)" />
                      <MetricCard icon="chart" title="Success rate" value={r && r.pct != null ? `${r.pct}%` : 'N/A'}
                        color={r && r.pct != null ? (r.pct >= 70 ? 'var(--color-success)' : r.pct >= 40 ? 'var(--color-warning)' : 'var(--color-danger)') : 'var(--text-muted)'} />
                      <MetricCard icon="alert" title="Breaching now" value={r ? r.flagged : 0} color={r && r.flagged ? 'var(--color-danger)' : 'var(--text-primary)'} />
                      <MetricCard icon="clock" title="Pending" value={r ? r.pending : 0} desc="Started, within budget" />
                      {analyticsRange !== 'last' && (
                        <MetricCard icon="refresh" title="Spilled over" value={r ? r.spill : 0}
                          color={r && r.spill ? 'var(--color-warning)' : 'var(--text-primary)'}
                          desc={r && r.spillRate != null ? `${r.spillRate}% of their #37 load carried over` : 'carried from sprint #37'} />
                      )}
                    </div>
                    <div className="filter-tabs">
                      <button className={`filter-tab ${analyticsDevStatus === 'all' ? 'active' : ''}`} onClick={() => setAnalyticsDevStatus('all')}>
                        All <span className="filter-tab-count">{tix.length}</span>
                      </button>
                      {['To Do', 'In Progress', 'Code Review', 'QA Review', 'QA BLOCKED', 'Ready to Release', 'Done', 'Released To Prod', 'Rejected'].filter(s => stCounts[s]).map(s => (
                        <button key={s} className={`filter-tab ${analyticsDevStatus === s ? 'active' : ''}`} onClick={() => setAnalyticsDevStatus(analyticsDevStatus === s ? 'all' : s)}>
                          <span className="chip-dot" style={{ backgroundColor: getStatusMeta(s).color }} />{s} <span className="filter-tab-count">{stCounts[s]}</span>
                        </button>
                      ))}
                    </div>
                    <TypeFilterChips scope={tix} value={analyticsDevType} onChange={setAnalyticsDevType} />
                    <SmartTable
                      key={'devdetail' + analyticsDev + analyticsDevStatus + analyticsDevType}
                      rows={shown}
                      columns={['Key', 'Summary', 'Status', 'SP', 'In status', 'Dev SLA', 'QA time', 'Flags']}
                      searchText={(i) => `${i.key} ${i.summary} ${i.status}`}
                      renderRow={(i) => {
                        const s = devSlaInfo(i, asOf);
                        const q = qaHoursInfo(i, asOfMs);
                        return (
                          <tr key={i.key} className="clickable-card" onClick={() => setSelectedTicket(i)}>
                            <td style={{ fontWeight: 600 }}>{i.key}</td>
                            <td>{i.summary}</td>
                            <td><StatusBadge status={i.status} /></td>
                            <td>{i.storyPoints || 0}</td>
                            <td>{daysInStatus(i)}d</td>
                            <td>
                              {s.state === 'ontime' && <span className="vchip vchip-muted" style={{ color: 'var(--color-success)', background: 'var(--color-success-glow)' }}>on time · {s.took}d/{s.budget}</span>}
                              {s.state === 'late' && <span className="vchip vchip-warn">late · {s.took}d/{s.budget}</span>}
                              {s.state === 'flagged' && <span className="vchip vchip-bad">flagged · {s.took}d/{s.budget}</span>}
                              {s.state === 'pending' && <span className="vchip vchip-muted">pending · {s.took}d/{s.budget}</span>}
                              {s.state === 'na' && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                            <td>{q ? `${fmtHours(q.hours)}${q.done ? ' (tested)' : ' (in QA)'}` : '—'}</td>
                            <td>
                              {isSpill(i) && <span className="vchip vchip-warn">spilled over</span>}
                              {overdueInfo(i).overdue && <span className="vchip vchip-bad">overdue</span>}
                              <QAOwnerTag issue={i} />
                            </td>
                          </tr>
                        );
                      }}
                    />
                  </div>
                );
              })()}

              {/* QA DETAIL DRILL-DOWN */}
              {analyticsQA && (() => {
                const r = qaRows.find(x => x.name === analyticsQA);
                const tix = ds.filter(i => issueQAs(i).includes(analyticsQA));
                const stCounts = {};
                tix.forEach(i => { stCounts[i.status] = (stCounts[i.status] || 0) + 1; });
                const shown = (analyticsQAStatus === 'all' ? tix : tix.filter(i => i.status === analyticsQAStatus))
                  .filter(i => analyticsQAType === 'All' || i.type === analyticsQAType)
                  .sort((a, b) => daysInStatus(b) - daysInStatus(a));
                return (
                  <div id="analytics-detail" className="section-panel" style={{ borderColor: '#7c3aed' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <h2 className="section-title">{analyticsQA} — QA detailed analytics</h2>
                      <button className="btn btn-secondary" onClick={() => setAnalyticsQA(null)}>Close</button>
                    </div>
                    <div className="summary-grid">
                      <MetricCard icon="target" title="Assigned" value={r ? r.assigned : tix.length} color="#7c3aed" />
                      <MetricCard icon="target" title="Total SP" value={r ? r.sp : 0} />
                      <MetricCard icon="clock" title="In QA now" value={r ? r.inNow : 0} color="#7c3aed" />
                      <MetricCard icon="check" title="Tested (done)" value={r ? r.tested : 0} color="var(--color-success)" />
                      <MetricCard icon="check" title="Tested SP" value={r ? r.testedSP : 0} color="var(--color-success)" />
                      <MetricCard icon="chart" title="Avg turnaround" value={r && r.avgH != null ? fmtHours(r.avgH) : 'N/A'} />
                      <MetricCard icon="zap" title="Within 24h" value={r ? `${r.within}/${r.measured || 0}` : '—'} color="var(--color-primary)" />
                      <MetricCard icon="chart" title="Success rate" value={r && r.pct != null ? `${r.pct}%` : 'N/A'}
                        color={r && r.pct != null ? (r.pct >= 70 ? 'var(--color-success)' : r.pct >= 40 ? 'var(--color-warning)' : 'var(--color-danger)') : 'var(--text-muted)'} />
                    </div>
                    <div className="filter-tabs">
                      <button className={`filter-tab ${analyticsQAStatus === 'all' ? 'active' : ''}`} onClick={() => setAnalyticsQAStatus('all')}>
                        All <span className="filter-tab-count">{tix.length}</span>
                      </button>
                      {['QA Review', 'QA BLOCKED', 'In Progress', 'Code Review', 'To Do', 'Ready to Release', 'Done', 'Released To Prod', 'Rejected'].filter(s => stCounts[s]).map(s => (
                        <button key={s} className={`filter-tab ${analyticsQAStatus === s ? 'active' : ''}`} onClick={() => setAnalyticsQAStatus(analyticsQAStatus === s ? 'all' : s)}>
                          <span className="chip-dot" style={{ backgroundColor: getStatusMeta(s).color }} />{s} <span className="filter-tab-count">{stCounts[s]}</span>
                        </button>
                      ))}
                    </div>
                    <TypeFilterChips scope={tix} value={analyticsQAType} onChange={setAnalyticsQAType} />
                    <SmartTable
                      key={'qadetail' + analyticsQA + analyticsQAStatus + analyticsQAType}
                      rows={shown}
                      columns={['Key', 'Summary', 'Status', 'Developer', 'SP', 'In status', 'QA time', 'Flags']}
                      searchText={(i) => `${i.key} ${i.summary} ${i.assignee} ${i.status}`}
                      renderRow={(i) => {
                        const q = qaHoursInfo(i, asOfMs);
                        return (
                          <tr key={i.key} className="clickable-card" onClick={() => setSelectedTicket(i)}>
                            <td style={{ fontWeight: 600 }}>{i.key}</td>
                            <td>{i.summary}</td>
                            <td><StatusBadge status={i.status} /></td>
                            <td>{i.assignee}</td>
                            <td>{i.storyPoints || 0}</td>
                            <td>{daysInStatus(i)}d</td>
                            <td style={{ fontFeatureSettings: '"tnum"', fontWeight: 600 }}>{q ? `${fmtHours(q.hours)}${q.done ? ' (tested)' : q.hours > 24 ? ' (over SLA)' : ' (in QA)'}` : '—'}</td>
                            <td>
                              {isSpill(i) && <span className="vchip vchip-warn">spilled over</span>}
                              {q && !q.done && q.hours > 24 && <span className="vchip vchip-bad">over 24h</span>}
                            </td>
                          </tr>
                        );
                      }}
                    />
                  </div>
                );
              })()}

              <div className="summary-grid">
                <MetricCard icon="zap" title="Dev SLA compliance" value={totMeasured ? `${Math.round((totOnTime / totMeasured) * 100)}%` : 'N/A'}
                  color="var(--color-primary)" desc={`${totOnTime}/${totMeasured} tickets within SP budget`} />
                <MetricCard icon="check" title="QA within 24h" value={qaMeasured ? `${Math.round((qaWithin / qaMeasured) * 100)}%` : 'N/A'}
                  color="#7c3aed" desc={`${qaWithin}/${qaMeasured} tested inside a day`} />
                <MetricCard icon="clock" title="Avg QA turnaround" value={avgTurnH != null ? fmtHours(avgTurnH) : 'N/A'}
                  color="var(--text-primary)" desc={`across ${allCycles.length} tested tickets`} />
                <MetricCard icon="alert" title="Active SLA breaches" value={breaches.length}
                  color={breaches.length ? 'var(--color-danger)' : 'var(--color-success)'} desc="Dev over budget + QA over 24h" />
              </div>

              {/* DEV SUCCESS RATE */}
              <div className="section-panel">
                <h2 className="section-title">Developer success rate — on time to QA</h2>
                <p>Rule: an N-SP ticket should reach QA within N working days of starting (unpointed = 1 day). Ranked best first.</p>
                <div className="team-chart">
                  {devBarRows.map(r => (
                    <div key={r.name} className="team-chart-row clickable-card" title={`${r.name}: ${r.ontime} on time, ${r.late} late, ${r.flagged} flagged, ${r.pending} pending — click for detail`}
                      onClick={() => { setAnalyticsDev(r.name); setAnalyticsDevStatus('all'); setAnalyticsDevType('All'); setAnalyticsQA(null); scrollToDetail(); }}>
                      <span className="tc-name">{r.name}</span>
                      <span className="tc-track">
                        <span className="tc-fill" style={{ width: `${r.pct}%`, background: r.pct >= 70 ? 'var(--color-success)' : r.pct >= 40 ? 'var(--color-warning)' : 'var(--color-danger)' }} />
                      </span>
                      <span className="tc-total">{r.pct}%</span>
                      <span className="tc-meta">{r.ontime}/{r.measured} on time{r.flagged ? ` · ${r.flagged} flagged now` : ''}{r.pending ? ` · ${r.pending} pending` : ''}</span>
                    </div>
                  ))}
                  {devBarRows.length === 0 && <p style={{ margin: 0, color: 'var(--text-muted)' }}>No started tickets to measure yet.</p>}
                </div>
                <h4 style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Developer stats — click a header to sort, a row for detail</h4>
                <DevStatsTable key={'devstats' + analyticsRange} rows={devRows} showSpill={analyticsRange !== 'last'} onPick={(name) => { setAnalyticsDev(name); setAnalyticsDevStatus('all'); setAnalyticsDevType('All'); setAnalyticsQA(null); scrollToDetail(); }} />
              </div>

              {/* SLA BREACHES PER DEVELOPER */}
              {devBreachRows.length > 0 && (
                <div className="section-panel">
                  <h2 className="section-title">SLA breaches per developer</h2>
                  <p>Tickets currently past their story-point budget without reaching QA, by assignee.</p>
                  <div className="team-chart">
                    {devBreachRows.map(r => (
                      <div key={r.name} className="team-chart-row clickable-card" onClick={() => { setAnalyticsDev(r.name); setAnalyticsDevStatus('all'); setAnalyticsDevType('All'); setAnalyticsQA(null); scrollToDetail(); }}>
                        <span className="tc-name">{r.name}</span>
                        <span className="tc-track">
                          <span className="tc-fill" style={{ width: `${(r.flagged / maxFlagged) * 100}%`, background: 'var(--color-danger)' }} />
                        </span>
                        <span className="tc-total">{r.flagged}</span>
                        <span className="tc-meta">of {r.assigned} assigned</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* QA TURNAROUND */}
              <div className="section-panel">
                <h2 className="section-title">QA turnaround — 24-hour SLA</h2>
                <p>Rule: once a ticket enters QA Review it should be tested within 24 hours. Ranked best first.</p>
                <div className="team-chart">
                  {qaBarRows.map(r => (
                    <div key={r.name} className="team-chart-row clickable-card" title={`${r.name}: ${r.within} within 24h, ${r.over} over, ${r.pendingOk} in QA <24h — click for detail`}
                      onClick={() => { setAnalyticsQA(r.name); setAnalyticsQAStatus('all'); setAnalyticsQAType('All'); setAnalyticsDev(null); scrollToDetail(); }}>
                      <span className="tc-name">{r.name}</span>
                      <span className="tc-track">
                        {r.pct != null && <span className="tc-fill" style={{ width: `${r.pct}%`, background: r.pct >= 70 ? 'var(--color-success)' : r.pct >= 40 ? 'var(--color-warning)' : 'var(--color-danger)' }} />}
                      </span>
                      <span className="tc-total">{r.pct != null ? `${r.pct}%` : '—'}</span>
                      <span className="tc-meta">{r.within}/{r.measured} in 24h{r.pendingOk ? ` · ${r.pendingOk} in QA <24h` : ''}</span>
                    </div>
                  ))}
                  {qaBarRows.length === 0 && <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nothing has entered QA yet.</p>}
                </div>
                <h4 style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>QA stats</h4>
                <SmartTable
                  key={'qastats' + analyticsRange}
                  rows={qaRows}
                  columns={['QA', 'Assigned', 'Total SP', 'In QA now', 'Tested (done)', 'Tested SP', 'Avg turnaround', 'Within 24h', 'Success rate']}
                  searchText={(r) => r.name}
                  renderRow={(r) => (
                    <tr key={r.name} className="clickable-card" onClick={() => { setAnalyticsQA(r.name); setAnalyticsQAStatus('all'); setAnalyticsQAType('All'); setAnalyticsDev(null); scrollToDetail(); }}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.assigned}</td>
                      <td>{r.sp}</td>
                      <td>{r.inNow ? <span className="vchip vchip-qa">{r.inNow}</span> : '0'}</td>
                      <td>{r.tested}</td>
                      <td style={{ color: 'var(--color-success)', fontWeight: 600 }}>{r.testedSP}</td>
                      <td style={{ fontFeatureSettings: '"tnum"', fontWeight: 600 }}>{r.avgH != null ? fmtHours(r.avgH) : '—'}</td>
                      <td>{r.within}/{r.measured || 0}</td>
                      <td>{r.pct != null
                        ? <Verdict tone={r.pct >= 70 ? 'ok' : r.pct >= 40 ? 'warn' : 'bad'}>{r.pct}%</Verdict>
                        : <span style={{ color: 'var(--text-muted)' }}>not measured</span>}</td>
                    </tr>
                  )}
                />
              </div>

              {/* CURRENTLY IN QA — hour precision */}
              <div className="section-panel">
                <h2 className="section-title">In QA right now ({inQaNow.length})</h2>
                <SmartTable
                  key={'inqa' + analyticsRange}
                  rows={[...inQaNow].sort((a, b) => (qaHoursInfo(b, asOfMs)?.hours || 0) - (qaHoursInfo(a, asOfMs)?.hours || 0))}
                  columns={['Key', 'Summary', 'Primary QA', 'Developer', 'Time in QA', 'SLA']}
                  searchText={(i) => `${i.key} ${i.summary} ${i.assignee} ${i.primaryQA}`}
                  renderRow={(i) => {
                    const q = qaHoursInfo(i, asOfMs);
                    return (
                      <tr key={i.key} className="clickable-card" onClick={() => setSelectedTicket(i)}>
                        <td style={{ fontWeight: 600 }}>{i.key}</td>
                        <td>{i.summary}</td>
                        <td>{issueQAs(i).join(', ') || <span className="qa-owner qa-unassigned">QA unassigned</span>}</td>
                        <td>{i.assignee}</td>
                        <td style={{ fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{q ? fmtHours(q.hours) : '—'}</td>
                        <td>{q && q.hours > 24 ? <span className="vchip vchip-bad">over 24h</span> : <span className="vchip vchip-warn">{q ? `${24 - q.hours}h left` : '—'}</span>}</td>
                      </tr>
                    );
                  }}
                />
              </div>

              {/* SLA BREACH REGISTER */}
              <div className="section-panel">
                <h2 className="section-title">SLA breaches ({breaches.length})</h2>
                <p>Dev tickets past their story-point budget without reaching QA, and QA tickets held longer than 24 hours.</p>
                <SmartTable
                  key={'breach' + analyticsRange}
                  rows={breaches}
                  columns={['Key', 'Summary', 'Type', 'Owner', 'SP', 'Elapsed', 'Breached by', 'Status']}
                  searchText={(b) => `${b.i.key} ${b.i.summary} ${b.owner} ${b.type}`}
                  renderRow={(b) => (
                    <tr key={b.i.key + b.type} className="clickable-card" onClick={() => setSelectedTicket(b.i)}>
                      <td style={{ fontWeight: 600 }}>{b.i.key}</td>
                      <td>{b.i.summary}</td>
                      <td><span className={`vchip ${b.type.startsWith('Dev') ? 'vchip-warn' : 'vchip-bad'}`}>{b.type}</span></td>
                      <td>{b.owner}</td>
                      <td>{b.sp}</td>
                      <td style={{ fontFeatureSettings: '"tnum"', fontWeight: 600 }}>{b.elapsed}</td>
                      <td><span className="overdue-badge">{b.over}</span></td>
                      <td><StatusBadge status={b.i.status} /></td>
                    </tr>
                  )}
                />
              </div>
            </div>
          );
        })()}

        {/* TAB 4: TEAM WORKLOAD & WORKLOAD DEEP DIVE */}
        {currentTab === 'team-workload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

            {/* TEAMS MATRIX GRID */}
            <div className="teams-workload-grid">
              {['DevOps', 'Dev 1 (Pushkar)', 'Dev 2 (Mehul/Monika)', 'Dev 3 (Somya)', 'CRM Support', 'QA Team'].map(teamName => {
                const metrics = getTeamMetrics(teamName);
                const isTeamAtRisk = metrics.slaBreaches > 0 || metrics.activeCount >= 10;
                
                return (
                  <div 
                    key={teamName} 
                    className={`team-card ${selectedTeam === teamName ? 'active' : ''}`}
                    onClick={() => { setSelectedTeam(teamName); setShowTeamSla(false); setShowTeamOverdue(false); setSelectedDevFilter(null); setTeamMemberFilter('All'); setTeamStatusFilter(''); setTeamTypeFilter('All'); }}
                    style={{ 
                      borderColor: selectedTeam === teamName ? 'var(--color-primary)' : 'var(--border-color)',
                      boxShadow: selectedTeam === teamName ? '0 0 10px var(--color-primary-glow)' : 'none'
                    }}
                  >
                    <div className="team-card-header">
                      <h3 className="team-card-title">{teamName}</h3>
                      <span className={`team-badge ${isTeamAtRisk ? 'at-risk' : 'healthy'}`}>
                        {isTeamAtRisk ? 'At Risk' : 'Healthy'}
                      </span>
                    </div>

                    <div className="team-metrics-row">
                      <div className="team-metric-box">
                        <span className="team-metric-lbl">WIP LOAD</span>
                        <span className="team-metric-val">{metrics.activeCount} Active</span>
                      </div>
                      <div className="team-metric-box">
                        <span className="team-metric-lbl">SUCCESS %</span>
                        <span className="team-metric-val">{metrics.successRate}%</span>
                      </div>
                      <div className="team-metric-box">
                        <span className="team-metric-lbl">SLA BREACH</span>
                        <span className="team-metric-val" style={{ color: metrics.slaBreaches > 0 ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                          {metrics.slaBreaches}
                        </span>
                      </div>
                    </div>

                    <div className="sp-tracker-row">
                      <div className="sp-tracker-text">
                        <span>Story Points Progress</span>
                        <strong>{metrics.deliveredSP} / {metrics.deliveredSP + metrics.pendingSP} SP</strong>
                      </div>
                      <div className="progress-bar-bg">
                        <div 
                          className="progress-bar-fill" 
                          style={{ 
                            width: `${(metrics.deliveredSP + metrics.pendingSP) > 0 ? (metrics.deliveredSP / (metrics.deliveredSP + metrics.pendingSP)) * 100 : 100}%` 
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* CLICKED TEAM DETAILED metrics */}
            {selectedTeam && (() => {
              const metrics = getTeamMetrics(selectedTeam);
              const teamRoster = REAL_TEAM.filter(m => m.devGroup === selectedTeam);
              const teamOverdueAll = metrics.allIssues.map(i => ({ issue: i, info: overdueInfo(i) })).filter(x => x.info.overdue);
              // member of a ticket, respecting QA vs dev teams
              const memberOf = (iss) => selectedTeam === 'QA Team' ? issueQAs(iss) : [iss.assignee];
              const matchesMember = (iss) => teamMemberFilter === 'All' || memberOf(iss).includes(teamMemberFilter);
              // distinct members present in this team's tickets (for the filter chips)
              const teamMembersPresent = [...new Set(metrics.allIssues.flatMap(memberOf).filter(n => n && n !== 'Unassigned'))].sort();
              const teamOverdue = teamOverdueAll.filter(x => matchesMember(x.issue)).sort((a, b) => b.info.overdueBy - a.info.overdueBy);
              const teamSlaFiltered = metrics.slaBreachedList.filter(i => matchesMember(i));

              return (
                <div className="team-deep-dive-panel">
                  <div className="team-deep-dive-header">
                    <div className="team-deep-dive-title">
                      <h3>{selectedTeam} Detailed Metrics Deep-Dive</h3>
                      <p>Roster load analysis and active sprint execution checklist.</p>
                    </div>
                  </div>

                  {/* Team headline metric cards */}
                  <div className="summary-grid">
                    <MetricCard icon="zap" title="Velocity" value={`${metrics.velocity} SP/dev`}
                      desc={`${metrics.deliveredSP} SP delivered across ${metrics.devCount} devs`} />
                    <MetricCard icon="check" title="Done / Ready" value={metrics.completedCount} color="var(--color-success)"
                      desc={`of ${metrics.allIssues.length} team tickets`} />
                    <MetricCard icon="alert" title="SLA Breaches" value={metrics.slaBreaches}
                      color={metrics.slaBreaches > 0 ? 'var(--color-danger)' : 'var(--text-primary)'}
                      desc={metrics.slaBreaches > 0 ? (showTeamSla ? 'Click to hide tickets' : 'Click to view tickets') : 'No breaches'}
                      onClick={() => metrics.slaBreaches > 0 && setShowTeamSla(v => !v)}
                      active={showTeamSla && metrics.slaBreaches > 0} />
                    <MetricCard icon="clock" title="Overdue" value={teamOverdueAll.length}
                      color={teamOverdueAll.length > 0 ? 'var(--color-danger)' : 'var(--text-primary)'}
                      desc={teamOverdueAll.length > 0 ? (showTeamOverdue ? 'Click to hide tickets' : 'Past estimate — click to view') : 'None overdue'}
                      onClick={() => teamOverdueAll.length > 0 && setShowTeamOverdue(v => !v)}
                      active={showTeamOverdue && teamOverdueAll.length > 0} />
                  </div>

                  {/* Member filter — narrows the SLA & Overdue lists below */}
                  <div className="filter-tabs">
                    <button
                      className={`filter-tab ${teamMemberFilter === 'All' ? 'active' : ''}`}
                      onClick={() => setTeamMemberFilter('All')}
                    >
                      All members <span className="filter-tab-count">{teamMembersPresent.length}</span>
                    </button>
                    {teamMembersPresent.map(name => {
                      const wip = metrics.allIssues.filter(i => memberOf(i).includes(name) && !isDone(i.status)).length;
                      return (
                        <button
                          key={name}
                          className={`filter-tab ${teamMemberFilter === name ? 'active' : ''}`}
                          onClick={() => setTeamMemberFilter(teamMemberFilter === name ? 'All' : name)}
                        >
                          {name} <span className="filter-tab-count">{wip}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Status breakdown — clickable filter, scoped to the selected member */}
                  <div className="filter-tabs">
                    {['To Do', 'In Progress', 'Code Review', 'QA Review', 'QA BLOCKED', 'Ready to Release', 'Done', 'Released To Prod'].map(s => {
                      const n = metrics.allIssues.filter(i => matchesMember(i) && i.status === s).length;
                      if (!n) return null;
                      const m = getStatusMeta(s);
                      return (
                        <button key={s} className={`filter-tab ${teamStatusFilter === s ? 'active' : ''}`} onClick={() => setTeamStatusFilter(teamStatusFilter === s ? '' : s)}>
                          <span className="chip-dot" style={{ backgroundColor: m.color }} />{s} <span className="filter-tab-count">{n}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Issue-type breakdown — clickable filter (Stories / Bugs / …), scoped to the selected member */}
                  <TypeFilterChips scope={metrics.allIssues.filter(matchesMember)} value={teamTypeFilter} onChange={setTeamTypeFilter} />

                  {/* Member stat cards (when a member is selected) */}
                  {teamMemberFilter !== 'All' && (() => {
                    const mt = metrics.allIssues.filter(matchesMember);
                    const doneT = mt.filter(i => isDone(i.status));
                    const cnt = (fn) => mt.filter(fn).length;
                    const success = mt.length ? Math.round((doneT.length / mt.length) * 100) : 0;
                    const cards = [
                      { label: 'Total', value: mt.length, color: 'var(--text-primary)', icon: 'target' },
                      { label: 'In Progress', value: cnt(i => i.status === 'In Progress'), color: getStatusMeta('In Progress').color, icon: 'clock' },
                      { label: 'Code Review', value: cnt(i => i.status === 'Code Review'), color: getStatusMeta('Code Review').color, icon: 'kanban' },
                      { label: 'In QA', value: cnt(i => i.status === 'QA Review'), color: '#7c3aed', icon: 'chart' },
                      { label: 'Done / Ready', value: doneT.length, color: 'var(--color-success)', icon: 'check' },
                      { label: 'Success rate', value: `${success}%`, color: 'var(--color-primary)', icon: 'zap' },
                      { label: 'Overdue', value: cnt(i => overdueInfo(i).overdue), color: 'var(--color-danger)', icon: 'alert' },
                    ];
                    return (
                      <div className="summary-grid">
                        {cards.map(c => (
                          <MetricCard key={c.label} icon={c.icon} title={c.label} value={c.value} color={c.color} />
                        ))}
                      </div>
                    );
                  })()}

                  {/* Unified ticket table — always visible, grouped by assignee then status */}
                  {(() => {
                    let list = metrics.allIssues.filter(matchesMember);
                    if (teamStatusFilter) list = list.filter(i => i.status === teamStatusFilter);
                    if (teamTypeFilter !== 'All') list = list.filter(i => i.type === teamTypeFilter);
                    const ORD = { 'To Do': 0, 'In Progress': 1, 'Code Review': 2, 'QA Review': 3, 'QA BLOCKED': 4, 'Ready to Release': 5, 'Done': 6, 'Released To Prod': 7, 'Rejected': 8 };
                    const TYPE_ORD = TYPE_ORDER;
                    const ownerOf = (i) => (selectedTeam === 'QA Team' ? issueQAs(i)[0] : i.assignee) || 'zzz-Unassigned';
                    // Group: assignee together; within each person, by issue type (all Stories, then all
                    // Bugs, ...), then statuses clustered in workflow order within each type
                    list = [...list].sort((a, b) => {
                      const oa = ownerOf(a), ob = ownerOf(b);
                      if (oa !== ob) return oa.localeCompare(ob);
                      const to = (TYPE_ORD[a.type] ?? 9) - (TYPE_ORD[b.type] ?? 9);
                      if (to) return to;
                      const so = (ORD[a.status] ?? 9) - (ORD[b.status] ?? 9);
                      if (so) return so;
                      return daysInStatus(b) - daysInStatus(a);
                    });
                    const who = teamMemberFilter === 'All' ? `${selectedTeam} — all tickets` : teamMemberFilter;
                    // SP rollup for the CURRENT filter scope (recomputes on member/status selection)
                    const totalSP = list.reduce((s, i) => s + (i.storyPoints || 0), 0);
                    const doneSP = list.filter(i => isDone(i.status)).reduce((s, i) => s + (i.storyPoints || 0), 0);
                    const pendingSP = totalSP - doneSP;
                    const unpointed = list.filter(i => !i.storyPoints).length;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {who}{teamTypeFilter !== 'All' ? ' · ' + (teamTypeFilter === 'Story' ? 'Stories' : teamTypeFilter + 's') : ''}{teamStatusFilter ? ' · ' + teamStatusFilter : ''} ({list.length})
                        </h4>
                        <div className="summary-grid">
                          <MetricCard icon="target" title="Total SP" value={totalSP}
                            desc={`${list.length} tickets${unpointed ? ` · ${unpointed} unpointed` : ''}`} />
                          <MetricCard icon="check" title="Done SP" value={doneSP} color="var(--color-success)" desc="Done / Ready to Release" />
                          <MetricCard icon="clock" title="Pending SP" value={pendingSP}
                            color={pendingSP > 0 ? 'var(--color-warning)' : 'var(--text-primary)'} desc="In flight or unstarted" />
                        </div>
                        <SmartTable
                          key={selectedTeam + teamMemberFilter + teamStatusFilter + teamTypeFilter}
                          rows={list}
                          columns={['Type', 'Key', 'Summary', selectedTeam === 'QA Team' ? 'Primary QA' : 'Assignee', 'Status', 'SP', 'In status', 'Flags']}
                          searchText={(i) => `${i.key} ${i.summary} ${i.assignee} ${i.primaryQA} ${i.status} ${i.type}`}
                          renderRow={(i, idx, arr) => {
                            const prev = idx > 0 ? arr[idx - 1] : null;
                            const firstOfGroup = idx === 0 || ownerOf(prev) !== ownerOf(i);
                            const typeChanged = !firstOfGroup && prev && prev.type !== i.type;
                            return (
                              <tr key={i.key} className={`clickable-card ${firstOfGroup ? 'group-start' : ''} ${typeChanged ? 'type-start' : ''}`} onClick={() => setSelectedTicket(i)}>
                                <td><TypeIcon type={i.type} /></td>
                                <td style={{ fontWeight: 600 }}>{i.key}</td>
                                <td>{i.summary}</td>
                                <td style={{ fontWeight: firstOfGroup ? 650 : 400, color: firstOfGroup ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                  {selectedTeam === 'QA Team' ? (issueQAs(i).join(', ') || 'Unassigned') : i.assignee}
                                </td>
                                <td><StatusBadge status={i.status} /></td>
                                <td style={{ fontWeight: 600, color: i.storyPoints ? 'var(--text-primary)' : 'var(--text-muted)' }}>{i.storyPoints || '—'}</td>
                                <td>{daysInStatus(i)}d</td>
                                <td>
                                  {overdueInfo(i).overdue && <span className="vchip vchip-bad">overdue</span>}
                                  {isStalled(i) && <span className="vchip vchip-warn">stalled</span>}
                                  <QAOwnerTag issue={i} />
                                </td>
                              </tr>
                            );
                          }}
                        />
                      </div>
                    );
                  })()}

                  {/* Overdue ticket list (toggled, respects member filter) */}
                  {showTeamOverdue && teamOverdueAll.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--color-danger)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Overdue Tickets — {selectedTeam}{teamMemberFilter !== 'All' ? ` · ${teamMemberFilter}` : ''} ({teamOverdue.length})
                      </h4>
                      {teamOverdue.length === 0 && <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>None overdue for {teamMemberFilter}.</p>}
                      {teamOverdue.length > 0 && (
                        <table className="aging-table">
                          <thead>
                            <tr>
                              <th>Key</th>
                              <th>Summary</th>
                              <th>Status</th>
                              <th>{selectedTeam === 'QA Team' ? 'Primary QA' : 'Assignee'}</th>
                              <th>SP est</th>
                              <th>Overdue by</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teamOverdue.map(({ issue, info }) => (
                              <tr key={issue.key}>
                                <td style={{ fontWeight: 600 }}>{issue.key}</td>
                                <td>{issue.summary}</td>
                                <td><StatusBadge status={issue.status} /></td>
                                <td>{selectedTeam === 'QA Team' ? (issueQAs(issue).join(', ') || 'Unassigned') : issue.assignee}</td>
                                <td>{issue.storyPoints || 0}</td>
                                <td><span className="overdue-badge">{info.overdueBy}d over</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* SLA breach ticket list (toggled) */}
                  {showTeamSla && metrics.slaBreaches > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--color-danger)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        SLA-Breached Tickets — {selectedTeam}{teamMemberFilter !== 'All' ? ` · ${teamMemberFilter}` : ''} ({teamSlaFiltered.length})
                      </h4>
                      {teamSlaFiltered.length === 0 && <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>None for {teamMemberFilter}.</p>}
                      {teamSlaFiltered.length > 0 && (
                      <table className="aging-table">
                        <thead>
                          <tr>
                            <th>Key</th>
                            <th>Summary</th>
                            <th>Status</th>
                            <th>Assignee</th>
                            <th>Aging</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamSlaFiltered.map(i => (
                            <tr key={i.key}>
                              <td style={{ fontWeight: 600 }}>{i.key}</td>
                              <td>{i.summary}</td>
                              <td><StatusBadge status={i.status} /></td>
                              <td>{i.assignee}</td>
                              <td style={{ color: 'var(--color-warning)', fontWeight: 600 }}>{i.staleDays} days</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      )}
                    </div>
                  )}

                </div>
              );
            })()}

          </div>
        )}

        {/* TAB: KANBAN BOARD */}
        {currentTab === 'kanban' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            {/* Developer filter matrix */}
            <div className="section-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="section-title">Filter Kanban by Developer ({selectedAssignee || 'All Roster'})</h2>
                {selectedAssignee && (
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setSelectedAssignee(null)}>
                    Clear Filter
                  </button>
                )}
              </div>
              <div className="filter-tabs">
                <button className={`filter-tab ${!selectedAssignee ? 'active' : ''}`} onClick={() => setSelectedAssignee(null)}>
                  All roster <span className="filter-tab-count">{teamMembers.filter(m => m.tickets > 0).length}</span>
                </button>
                {teamMembers.filter(m => m.tickets > 0).map(member => (
                  <button
                    key={member.name}
                    className={`filter-tab ${selectedAssignee === member.name ? 'active' : ''} ${member.tickets >= 4 ? 'tone-bad' : ''}`}
                    onClick={() => setSelectedAssignee(selectedAssignee === member.name ? null : member.name)}
                  >
                    {member.name} <span className="filter-tab-count">{member.tickets}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Kanban Columns */}
            <div className="kanban-board">
              {columns.map(col => {
                const columnIssues = getIssuesForColumn(col);

                return (
                  <div key={col} className="kanban-column">
                    <div className="kanban-column-header">
                      <span>{col}</span>
                      <span>{columnIssues.length}</span>
                    </div>

                    <div className="kanban-cards">
                      {columnIssues.map(issue => {
                        const limit = SLA_LIMITS[issue.status] || 999;
                        const isBreached = issue.staleDays > limit;
                        const hasQA = issue.primaryQA && issue.primaryQA !== 'Unassigned';

                        const statusMeta = getStatusMeta(issue.status);
                        return (
                          <div key={issue.key} className="kanban-card clickable-card" onClick={() => setSelectedTicket(issue)}>
                            <div className="card-header">
                              <span className="card-key">{issue.key}</span>
                              <PriorityBadge priority={issue.priority} />
                            </div>

                            <p className="card-summary">{issue.summary}</p>

                            {issue.status === 'QA Review' && (
                              <div style={{ fontSize: '11px' }}>
                                {hasQA ? (
                                  <span style={{ color: 'var(--text-secondary)' }}>QA: <strong style={{ color: 'var(--text-primary)' }}>{issue.primaryQA}</strong></span>
                                ) : (
                                  <span className="warning-no-qa"><Icon name="alert" size={11} /> No QA Assigned</span>
                                )}
                              </div>
                            )}

                            {issue.blocked && (
                              <div className="blocker-note">
                                <Icon name="ban" size={12} />
                                <span><strong>Blocker:</strong> {issue.blockerReason}</span>
                              </div>
                            )}

                            <div className="card-footer">
                              <span className="card-meta-item" style={{ color: isBreached ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                                <Icon name="clock" size={12} /> {issue.staleDays}d
                              </span>
                              <span className="card-meta-item" style={{ color: 'var(--text-secondary)' }}>
                                <Icon name="target" size={12} /> {issue.storyPoints || 0} SP
                              </span>
                            </div>

                            <div className="card-assignee-row" onClick={(e) => e.stopPropagation()}>
                              <span className="card-assignee">
                                <span className="mini-avatar">{(issue.assignee || '?').split(' ').map(n => n[0]).slice(0, 2).join('')}</span>
                                {issue.assignee}
                              </span>
                              <select
                                className="status-select"
                                value={issue.status}
                                onChange={(e) => handleStatusChange(issue.key, e.target.value)}
                                style={{ color: statusMeta.color }}
                              >
                                {columns.map(c => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                      {columnIssues.length === 0 && (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', padding: '20px 0' }}>Empty</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB: QA PERFORMANCE */}
        {currentTab === 'metrics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            
            {/* QA TEAM SUMMARY METRICS */}
            <div className="section-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="section-title">QA Performance Metrics {selectedQAFilter ? `(Filtered: ${selectedQAFilter})` : ''}</h2>
                {selectedQAFilter && (
                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setSelectedQAFilter(null)}>
                    ✕ Clear QA Filter
                  </button>
                )}
              </div>
              <div className="cycle-summary">
                <div className="cycle-stat">
                  <span className="cycle-stat-lbl">Avg QA Cycle</span>
                  <span className="cycle-stat-val">{avgQaCycle != null ? `${avgQaCycle}d` : 'N/A'}</span>
                  <span className="cycle-stat-sub">{qaCycleValues.length} tickets measured</span>
                </div>
                <div className="cycle-stat">
                  <span className="cycle-stat-lbl">Avg Total Lifecycle</span>
                  <span className="cycle-stat-val">{avgLifecycle != null ? `${avgLifecycle}d` : 'N/A'}</span>
                  <span className="cycle-stat-sub">created → done</span>
                </div>
                <div className="cycle-stat">
                  <span className="cycle-stat-lbl">In QA Now</span>
                  <span className="cycle-stat-val">{issues.filter(i => i.status === 'QA Review').length}</span>
                  <span className="cycle-stat-sub">awaiting sign-off</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                {qaEngineers.map(qa => {
                  const qaIssues = issues.filter(i => issueQAs(i).includes(qa));
                  const testedDone = qaIssues.filter(i => isDone(i.status));
                  const currentlyTesting = qaIssues.filter(i => i.status === 'QA Review');

                  const cycleTimes = testedDone
                    .map(i => i.qaCycleDays)
                    .filter(t => t != null && t >= 0);

                  const avgTime = cycleTimes.length > 0
                    ? `${(cycleTimes.reduce((a,b)=>a+b,0) / cycleTimes.length).toFixed(1)}d`
                    : 'N/A';

                  const isQASelected = selectedQAFilter === qa;

                  return (
                    <div 
                      key={qa} 
                      onClick={() => { setSelectedQAFilter(isQASelected ? null : qa); setQaFilter('all'); }}
                      style={{ 
                        backgroundColor: 'var(--bg-deep)', 
                        border: isQASelected ? '1.5px solid var(--color-primary)' : '1px solid var(--border-color)', 
                        borderRadius: '12px', 
                        padding: '16px',
                        cursor: 'pointer',
                        boxShadow: isQASelected ? '0 0 10px var(--color-primary-glow)' : 'none',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <strong style={{ fontSize: '14px', color: 'var(--color-primary)' }}>{qa}</strong>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '10px' }}>
                        <span>WIP Load:</span>
                        <strong>{currentlyTesting.length} Active</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                        <span>Completed:</span>
                        <strong style={{ color: 'var(--color-success)' }}>{testedDone.length} Done</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '6px', marginTop: '6px', color: 'var(--text-muted)' }}>
                        <span>Avg QA Cycle:</span>
                        <strong>{avgTime}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
              {renderQAPanel(selectedQAFilter)}
            </div>

            {/* QA BLOCKED — with reasons */}
            {qaBlockedNow.length > 0 && (
              <div className="section-panel">
                <h2 className="section-title">QA Blocked — why QA can't test ({qaBlockedNow.length})</h2>
                <table className="aging-table">
                  <thead><tr><th>Key</th><th>Summary</th><th>Assignee</th><th>Blocked</th><th>Reason (latest comment)</th></tr></thead>
                  <tbody>
                    {qaBlockedNow.sort((a, b) => daysInStatus(b) - daysInStatus(a)).map(i => (
                      <tr key={i.key} className="clickable-card" onClick={() => setSelectedTicket(i)}>
                        <td style={{ fontWeight: 600 }}>{i.key}</td>
                        <td>{i.summary}</td>
                        <td>{i.assignee}</td>
                        <td style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{daysInStatus(i)}d</td>
                        <td style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '280px' }}>{i.blockerReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        )}
        {/* TAB: INTERNS */}
        {currentTab === 'interns' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div className="section-panel">
              <h2 className="section-title">Interns</h2>
              <p>Select an intern to see their live workload and what they're currently working on.</p>
              <div className="dev-list-grid">
                {interns.map(member => {
                  const its = internTickets(member.name);
                  const active = its.filter(i => !isDone(i.status)).length;
                  return (
                    <button
                      key={member.name}
                      className={`dev-badge-btn ${selectedIntern === member.name ? 'active' : ''}`}
                      onClick={() => setSelectedIntern(selectedIntern === member.name ? null : member.name)}
                    >
                      <div className="dev-avatar">{member.code}</div>
                      <span className="dev-badge-name">{member.name}</span>
                      <span className="dev-badge-wip">{active}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedIntern && (() => {
              const its = internTickets(selectedIntern);
              const member = REAL_TEAM.find(m => m.name === selectedIntern);
              const cnt = (fn) => its.filter(fn).length;
              const cards = [
                { label: 'To Do', value: cnt(i => i.status === 'To Do'), color: getStatusMeta('To Do').color, icon: 'kanban' },
                { label: 'In Progress', value: cnt(i => i.status === 'In Progress'), color: getStatusMeta('In Progress').color, icon: 'clock' },
                { label: 'In Review', value: cnt(i => i.status === 'Code Review' || i.status === 'QA Review'), color: getStatusMeta('QA Review').color, icon: 'chart' },
                { label: 'Done / Ready', value: cnt(i => isDone(i.status)), color: getStatusMeta('Done').color, icon: 'check' },
              ];
              const workingOn = its.filter(i => i.status === 'In Progress');
              const sps = its.reduce((s, i) => s + (i.storyPoints || 0), 0);
              return (
                <>
                  <div className="section-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div className="team-deep-dive-title">
                        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>{selectedIntern}</h3>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                          {member?.devGroup} · Intern · {its.length} tickets this sprint · {sps} SP
                        </p>
                      </div>
                      <button className="btn btn-secondary" onClick={() => setSelectedIntern(null)}>Clear</button>
                    </div>
                    <div className="summary-grid">
                      {cards.map(c => (
                        <MetricCard key={c.label} icon={c.icon} title={c.label} value={c.value} color={c.color} />
                      ))}
                    </div>
                  </div>

                  <div className="section-panel">
                    <h2 className="section-title">Currently Working On ({workingOn.length})</h2>
                    {workingOn.length === 0 && <p style={{ margin: 0 }}>No tickets in progress right now.</p>}
                    {workingOn.length > 0 && (
                      <div className="kanban-cards">
                        {workingOn.map(issue => (
                          <div key={issue.key} className="kanban-card clickable-card" onClick={() => setSelectedTicket(issue)}>
                            <div className="card-header">
                              <span className="card-key">{issue.key}</span>
                              <PriorityBadge priority={issue.priority} />
                            </div>
                            <p className="card-summary">{issue.summary}</p>
                            <div className="card-footer">
                              <span className="card-meta-item"><Icon name="clock" size={12} /> {issue.staleDays}d</span>
                              <span className="card-meta-item"><Icon name="target" size={12} /> {issue.storyPoints || 0} SP</span>
                            </div>
                            <QAOwnerTag issue={issue} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="section-panel">
                    <h2 className="section-title">All Tickets</h2>
                    <table className="aging-table">
                      <thead>
                        <tr>
                          <th>Key</th>
                          <th>Summary</th>
                          <th>Status</th>
                          <th>Priority</th>
                          <th>Age</th>
                          <th>SP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {its.sort((a, b) => b.staleDays - a.staleDays).map(i => (
                          <tr key={i.key}>
                            <td style={{ fontWeight: 600 }}>{i.key}</td>
                            <td>{i.summary}</td>
                            <td><StatusBadge status={i.status} /></td>
                            <td><PriorityBadge priority={i.priority} /></td>
                            <td>{i.staleDays}d</td>
                            <td style={{ fontWeight: 600 }}>{i.storyPoints || 0}</td>
                          </tr>
                        ))}
                        {its.length === 0 && (
                          <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No tickets assigned to this intern in the current sprint.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* TAB 5: RELEASE READINESS */}
        {currentTab === 'release' && (
          <div className="section-panel">
            <h2 className="section-title">Release Safety Checklists</h2>
            <p>Evaluating defect density, blockers, and SLA compliance on G99PRODUCT.</p>
            <table className="aging-table">
              <thead>
                <tr>
                  <th>Readiness Parameter</th>
                  <th>Metric Value</th>
                  <th>Assessment</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Release Confidence Score</strong></td>
                  <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{releaseConfidence}%</td>
                  <td>{releaseConfidence >= 80 ? <Verdict tone="ok">Safe to Release</Verdict> : releaseConfidence >= 60 ? <Verdict tone="warn">Watch (Medium Risk)</Verdict> : <Verdict tone="bad">Unsafe (Blockers / Defects)</Verdict>}</td>
                </tr>
                <tr>
                  <td><strong>Active Defects (Bugs)</strong></td>
                  <td style={{ fontWeight: 600, color: totalDefects > 0 ? 'var(--color-danger)' : 'var(--text-primary)' }}>{totalDefects} Bugs</td>
                  <td>{totalDefects === 0 ? <Verdict tone="ok">No open bugs</Verdict> : <Verdict tone="bad">Resolving bugs required prior to release</Verdict>}</td>
                </tr>
                <tr>
                  <td><strong>Critical Defects (Highest priority)</strong></td>
                  <td style={{ fontWeight: 600, color: criticalDefects > 0 ? 'var(--color-danger)' : 'var(--text-primary)' }}>{criticalDefects} Critical</td>
                  <td>{criticalDefects === 0 ? <Verdict tone="ok">No critical bottlenecks</Verdict> : <Verdict tone="bad">Blocked: Critical defects open</Verdict>}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
