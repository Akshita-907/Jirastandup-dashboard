import React from 'react';

// Lucide-style stroke icons. Single source of truth for all iconography.
const PATHS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  alert: (
    <>
      <path d="m10.29 3.86-8.48 14.14a2 2 0 0 0 1.71 3h16.96a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  kanban: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18" />
    </>
  ),
  git: (
    <>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  rocket: (
    <>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  refresh: (
    <>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>
  ),
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  target: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  target2: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </>
  ),
  grad: (
    <>
      <path d="M22 10 12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1 2.5 3 6 3s6-2 6-3v-5" />
    </>
  ),
  bookmark: <path d="M6 3a1 1 0 0 0-1 1v16l7-4 7 4V4a1 1 0 0 0-1-1H6z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  bug: (
    <>
      <rect x="8" y="7" width="8" height="11" rx="4" />
      <path d="M12 3v4M8.5 6 6 3.5M15.5 6 18 3.5M6 12H3M21 12h-3M6 16.5l-2 2M20 16.5l-2 2M9.5 18v2.5M14.5 18v2.5" />
    </>
  ),
};

export function Icon({ name, size = 16, strokeWidth = 2, style, className }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

// ---- Status colour system ----
export const STATUS_META = {
  'To Do':             { color: '#6b7280', bg: 'rgba(107,114,128,0.10)', label: 'To Do' },
  'In Progress':       { color: '#4f46e5', bg: 'rgba(79,70,229,0.10)',  label: 'In Progress' },
  'Code Review':       { color: '#b26a00', bg: 'rgba(178,106,0,0.11)',  label: 'Code Review' },
  'QA Review':         { color: '#7c3aed', bg: 'rgba(124,58,237,0.10)', label: 'QA Review' },
  'QA BLOCKED':        { color: '#d11a2a', bg: 'rgba(209,26,42,0.10)',  label: 'QA Blocked' },
  'Ready to Release':  { color: '#12813f', bg: 'rgba(18,129,63,0.11)',  label: 'Ready to Release' },
  'Done':              { color: '#12813f', bg: 'rgba(18,129,63,0.11)',  label: 'Done' },
  'Released To Prod':  { color: '#12813f', bg: 'rgba(18,129,63,0.11)',  label: 'Released' },
  'Rejected':          { color: '#d11a2a', bg: 'rgba(209,26,42,0.10)',  label: 'Rejected' },
};

export function getStatusMeta(status) {
  return STATUS_META[status] || { color: '#6b7280', bg: 'rgba(107,114,128,0.10)', label: status };
}

export function StatusBadge({ status }) {
  const m = getStatusMeta(status);
  return (
    <span className="status-badge" style={{ color: m.color, backgroundColor: m.bg }}>
      <span className="status-dot" style={{ backgroundColor: m.color }} />
      {m.label}
    </span>
  );
}

// ---- Verdict (traffic-light) text with a colour dot ----
const VERDICT_COLORS = { ok: '#12813f', warn: '#b26a00', bad: '#d11a2a' };

export function Verdict({ tone, children }) {
  const color = VERDICT_COLORS[tone] || VERDICT_COLORS.warn;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', color, fontWeight: 500 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
      {children}
    </span>
  );
}

// ---- Issue type icon (Story/Bug distinctly colored; others neutral) ----
export const TYPE_META = {
  Story: { icon: 'bookmark', color: '#12813f' },
  Bug: { icon: 'bug', color: '#d11a2a' },
  Task: { icon: 'check', color: '#4f46e5' },
  Epic: { icon: 'zap', color: '#7c3aed' },
};

export function TypeIcon({ type }) {
  const m = TYPE_META[type] || { icon: 'target', color: '#6b7280' };
  return (
    <span title={type} style={{ color: m.color, display: 'inline-flex', alignItems: 'center' }}>
      <Icon name={m.icon} size={15} />
    </span>
  );
}

// ---- Priority colour system ----
export const PRIORITY_META = {
  Highest: { color: '#d11a2a', bg: 'rgba(209,26,42,0.10)' },
  High:    { color: '#b26a00', bg: 'rgba(178,106,0,0.12)' },
  Medium:  { color: '#4f46e5', bg: 'rgba(79,70,229,0.10)' },
  Low:     { color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
};

export function PriorityBadge({ priority }) {
  const m = PRIORITY_META[priority] || PRIORITY_META.Medium;
  return (
    <span className="priority-badge" style={{ color: m.color, backgroundColor: m.bg }}>
      {priority}
    </span>
  );
}
