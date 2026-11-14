// The site's shared word helpers: the one way it writes a time, a child's age (style pass step 4) and Title Case (step 5), at the end.
// Times (skill Style rules, "Real times"; Liz, style pass step 3, 2026-11-13). The brand format:
// "8:00 AM", "8:00 AM–12:30 PM" (uppercase, an en dash with no spaces), Late / Early as "Arrives 9:30 AM" / "Leaves 2:00 PM",
// timeline hours as "8:00 AM", and date ranges with no spaces ("Nov 16–20", "Nov 30–Dec 4").
// Plain functions with no page code, tested on their own (tests/time-lib.test.mjs). The site's other helper files import it, and
// tools/build-tracker.mjs also puts it into the page as window.__timeLib, so the cards use the same one.
//
//   clock("13:15")            -> "1:15 PM"         (also takes "7:45", "07:45:00"; '' when there is no time)
//   range("13:15", "14:30")   -> "1:15 PM–2:30 PM" (just the start when there is no end)
//   hour(8)                   -> "8:00 AM"         (a timeline's hour label)
//   arrives("09:30")          -> "Arrives 9:30 AM"
//   leaves("14:00")           -> "Leaves 2:00 PM"
//   dateRange(month1, day1, month2, day2) -> "Nov 16–20" or "Nov 30–Dec 4" (months as short names)

export const DASH = '–';

export function clock(t) {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(t == null ? '' : t));
  if (!m) return '';
  const h = +m[1];
  if (h > 23 || +m[2] > 59) return '';
  return ((h % 12) || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}

export function range(start, end) {
  const a = clock(start), b = clock(end);
  if (!a) return '';
  return b ? a + DASH + b : a;
}

export function hour(h) {
  const n = Math.floor(Number(h));
  if (!(n >= 0 && n <= 23)) return '';
  return ((n % 12) || 12) + ':00 ' + (n < 12 ? 'AM' : 'PM');
}

export function arrives(t) { const c = clock(t); return c ? 'Arrives ' + c : 'Arrives'; }
export function leaves(t) { const c = clock(t); return c ? 'Leaves ' + c : 'Leaves'; }

export function dateRange(month1, day1, month2, day2) {
  return month1 + ' ' + day1 + DASH + (month2 && month2 !== month1 ? month2 + ' ' : '') + day2;
}

// A child's age (skill Style rules, "A child's age"; Liz, style pass step 4): under 3 years and months, "2y 10m"; under 1, months
// only, "5m"; a whole year with no months, "2y" (Liz, 2026-11-13); from 3, years only, "4y".
// The page shows it in grey after the name, in brackets: "Example Child (2y 10m)".
//   ageInMonths("2024-01-10", "2026-11-16") -> 34      ageFromMonths(34) -> "2y 10m"      childAge("2022-05-01", "2026-11-16") -> "4y"
const isoDay = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : '');
function todayIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function ageInMonths(birthday, on) {
  const b = isoDay(birthday), o = isoDay(on) || todayIso(); if (!b) return null;
  const [by, bm, bd] = b.split('-').map(Number), [y, m, d] = o.split('-').map(Number);
  let n = (y - by) * 12 + (m - bm); if (d < bd) n--;
  return n;
}
export function ageFromMonths(n) {
  if (n === null || n === undefined || !(Number(n) >= 0)) return '';
  const y = Math.floor(Number(n) / 12), m = Number(n) % 12;
  if (y === 0) return m + 'm';                // under 1: "5m"
  if (y >= 3 || m === 0) return y + 'y';      // from 3, or a whole year: "4y", "2y"
  return y + 'y ' + m + 'm';                  // "2y 10m"
}
export function childAge(birthday, on) { return ageFromMonths(ageInMonths(birthday, on)); }

// Title Case for names: titles, tabs, card titles, column headers and buttons that name a thing (skill Style rules, "Capitals";
// style pass step 5). The little words stay small (and, the, of, a...) except first; AM and PM are always capitals; numbers and
// acronyms stay as typed. Sentence case (instructions, messages) does not use this.
//   titleCase("rates and settings") -> "Rates and Settings"     titleCase("closing time 5:15 pm") -> "Closing Time 5:15 PM"
const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'on', 'or', 'in', 'to', 'for', 'at']);
const ACRONYMS = { upk: 'UPK', cccap: 'CCCAP', hq: 'HQ', ach: 'ACH', pdf: 'PDF', pto: 'PTO', am: 'AM', pm: 'PM', ok: 'OK' };
export function titleCase(text) {
  return String(text == null ? '' : text).split(' ').map((w, i) => {
    if (!w) return w;
    if (/\d/.test(w) || /^[A-Z/&]{2,}[,.:;)]*$/.test(w)) return w;                 // 5-Day, 4:15, UPK, CCCAP stay as typed
    const pre = (w.match(/^[("'‘“‹›]*/) || [''])[0], rest = w.slice(pre.length), core = rest.replace(/[,.:;)?!]+$/, '').toLowerCase();
    if (ACRONYMS[core]) return pre + ACRONYMS[core] + rest.slice(core.length);
    if (!rest || (i > 0 && SMALL_WORDS.has(core))) return w;
    return pre + rest.charAt(0).toUpperCase() + rest.slice(1);
  }).join(' ');
}
