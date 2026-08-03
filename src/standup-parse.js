// standup-parse.js — turn a day's Gemini standup notes into per-person,
// structured commitments so the dashboard can show "said vs. did".
//
// The notes have no rigid schema, but every call Gemini produces a
// "Next steps" section whose lines are reliably person-attributed:
//
//   [Yogesh] Resolve bugs: Resolve identified Jira 3874 and 3865 ... end of day.
//   [Akshita Garg] : Prepare a progress report regarding the multi-rag work ...
//   [Ankur Singh, Akash S] Check Multi-rag Issues: Investigate and provide ...
//   [The group] Test Jira 3852: Verify the fix ...
//
// We also sweep person-attributed prose elsewhere ("Pushkar Murkute developing
// inbox contact ordering ...") as a secondary signal. Everything is matched to
// a canonical Jira assignee name and any ticket numbers are extracted.
//
// Pure functions, no imports — safe to run in the browser or in a node script.

const PROJECT_PREFIX = 'G99PRODUCT-';

// Gemini sometimes misspells or shortens names that don't first-name-match a
// roster entry. Map the spoken form (lowercased) to the canonical Jira name.
const NAME_ALIASES = {
  monica: 'Monika Desai',
  'monica desai': 'Monika Desai',
};

// Bracket groups we should never treat as a person (collective assignments
// like "The group", "Q team", "QA Team", "Interns" — nobody to hold to it).
const NON_PERSON = new Set(['the group', 'group', 'team', 'everyone', 'all', 'interns', 'intern']);
function isNonPerson(key) {
  return NON_PERSON.has(key) || /\bteam\b/.test(key) || /\bgroup\b/.test(key);
}

// ---- name resolution -------------------------------------------------------

// Build a lookup from any spoken name form → canonical full name, using the
// people we actually know: Jira assignees/QAs plus the attendee roster line.
export function buildNameIndex(knownNames = []) {
  const canonical = new Set();
  for (const n of knownNames) if (n && n.trim()) canonical.add(n.trim());

  const byFirst = new Map();   // "pushkar" -> "Pushkar Murkute"
  const byFull = new Map();    // "pushkar murkute" -> "Pushkar Murkute"
  for (const full of canonical) {
    byFull.set(full.toLowerCase(), full);
    const first = full.split(/\s+/)[0].toLowerCase();
    // First name only maps if it's unambiguous; if two people share a first
    // name we keep the first seen and let the full-name path disambiguate.
    if (!byFirst.has(first)) byFirst.set(first, full);
  }
  return { byFirst, byFull, canonical };
}

// Resolve one spoken name token (e.g. "Yogesh", "Akshita Garg", "Monica") to a
// canonical name, or null if we genuinely can't place it.
export function resolveName(raw, index) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key || isNonPerson(key)) return null;
  if (NAME_ALIASES[key]) return NAME_ALIASES[key];
  if (index.byFull.has(key)) return index.byFull.get(key);
  const first = key.split(/\s+/)[0];
  if (index.byFirst.has(first)) return index.byFirst.get(first);
  // Unknown but non-group: return a Title-cased version so it still surfaces.
  return raw.trim().replace(/\s+/g, ' ');
}

// ---- ticket extraction -----------------------------------------------------

// Pull ticket keys out of a chunk of text. Matches "Jira 3874", "3865", "693",
// "G99PRODUCT-3786". Returns canonical keys, de-duped, in order of appearance.
export function extractTickets(text) {
  if (!text) return [];
  const keys = [];
  const seen = new Set();
  const add = (num) => {
    const k = PROJECT_PREFIX + num;
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  };
  // Explicit project keys first.
  for (const m of text.matchAll(/G99PRODUCT-(\d{2,5})/gi)) add(m[1]);
  // "Jira 3874", "Jira 383", optionally chained "3874 and 3865".
  for (const m of text.matchAll(/\bJira\s+(\d{2,5})(?:\s*(?:,|and)\s*(\d{2,5}))*/gi)) {
    // capture every number inside the matched span
    for (const n of m[0].matchAll(/\d{2,5}/g)) add(n[0]);
  }
  // Bare parenthesised numbers: "(3786)", "(3713)".
  for (const m of text.matchAll(/\((\d{3,5})\)/g)) add(m[1]);
  return keys;
}

// ---- blocker detection -----------------------------------------------------

const BLOCK_RE = /\b(block(?:ed|ing|er)?|waiting on|waiting for|depends on|dependency|stuck|blocked by|pending confirmation|awaiting)\b/i;
export function detectBlocker(text) {
  return BLOCK_RE.test(text || '');
}

// ---- section slicing -------------------------------------------------------

// Return the lines of the "Next steps" block (everything after the heading up
// to the Gemini footer / end).
function nextStepsLines(content) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*next steps\s*$/i.test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    // Stop at Gemini's boilerplate footer.
    if (/review Gemini's notes|Take a short survey|How is the quality/i.test(l)) break;
    out.push(l);
  }
  return out;
}

// ---- main parse ------------------------------------------------------------

// Parse one transcript entry into per-person commitments.
//   entry:  { date, title, content, viewUrl }
//   index:  from buildNameIndex(...)
// Returns { date, viewUrl, people: [{ person, commitments:[{text, tickets[], blocked}], tickets[], blocked }] }
export function parseTranscript(entry, index) {
  const byPerson = new Map(); // canonical name -> { commitments, ticketSet }

  const record = (person, text) => {
    if (!person) return;
    if (!byPerson.has(person)) byPerson.set(person, { commitments: [], ticketSet: new Set() });
    const bucket = byPerson.get(person);
    const tickets = extractTickets(text);
    const blocked = detectBlocker(text);
    bucket.commitments.push({ text: text.trim(), tickets, blocked });
    tickets.forEach((t) => bucket.ticketSet.add(t));
  };

  // 1) Next steps — the primary, reliably attributed signal.
  for (const line of nextStepsLines(entry.content)) {
    // [Name] rest   or   [Name, Name2] rest
    const m = /^\[([^\]]+)\]\s*:?\s*(.*)$/.exec(line);
    if (!m) continue;
    const names = m[1].split(/\s*,\s*/);
    const rest = m[2].trim();
    for (const nm of names) {
      const person = resolveName(nm, index);
      if (person) record(person, rest);
    }
  }

  // 2) Secondary sweep: prose lines that begin with a known FULL name, e.g.
  //    "Pushkar Murkute developing inbox contact ordering ..." or the older
  //    "Monica: R&D for transfer call (3624) ..." bullet style.
  const seenTexts = new Set(
    [...byPerson.values()].flatMap((b) => b.commitments.map((c) => c.text.toLowerCase())),
  );
  for (const rawLine of entry.content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('[')) continue;
    // Skip the attendee roster line (a run of names + emails, no real update).
    if (line.includes('@')) continue;
    // "Name: text"  (first token(s) before a colon)
    let mm = /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s*:\s*(.+)$/.exec(line);
    let person = null;
    let text = null;
    if (mm) {
      person = resolveName(mm[1], index);
      text = mm[2];
      // Only accept if the name actually resolved to someone on the roster
      // (avoid capturing section headings like "Next steps:").
      if (person && !index.byFull.has(mm[1].toLowerCase()) && !index.byFirst.has(mm[1].split(/\s+/)[0].toLowerCase()) && !NAME_ALIASES[mm[1].toLowerCase()]) {
        person = null;
      }
    } else {
      // "Full Name <verb> ..." — must start with a known full name.
      const words = line.split(/\s+/);
      const two = words.slice(0, 2).join(' ');
      if (index.byFull.has(two.toLowerCase())) {
        person = index.byFull.get(two.toLowerCase());
        text = words.slice(2).join(' ');
      }
    }
    if (person && text && text.length > 3 && !seenTexts.has(text.trim().toLowerCase())) {
      record(person, text);
      seenTexts.add(text.trim().toLowerCase());
    }
  }

  const people = [...byPerson.entries()]
    .map(([person, b]) => ({
      person,
      commitments: b.commitments,
      tickets: [...b.ticketSet],
      blocked: b.commitments.some((c) => c.blocked),
    }))
    .sort((a, b) => a.person.localeCompare(b.person));

  return { date: entry.date, viewUrl: entry.viewUrl, title: entry.title, people };
}
