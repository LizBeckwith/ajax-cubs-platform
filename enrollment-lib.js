// The My kids week grid, worked out from the dated changes (migration 044/045). Plain functions with no page code in them, so they can be
// tested on their own (tests/enrollment-lib.test.mjs).
import { dateRange, ageFromMonths } from './time-lib.js';
//
//   enrollment_overview() gives: kids (each with entries [{field, value, starts_on, until}]), drop_ins, vacations, transitions, dens, settings.
//   weekGrid(overview, den, monday)   one den, one week: rows (with each child's age), day totals (enrolled, coming, open), the footnote of children on hold
//   monthSummary(overview, den, ym)   one den, one month: the totals of every school day
//   notesFor(overview, den, today)    the cards above the grid: transitions to confirm, holds from Family bills, age checks, holds ending
// Dates are 'YYYY-MM-DD' text. A child's den, days, schedule and status on a day are the latest entry that started on or before it
// (a hold's entry stops at its return day and the value before it comes back), the same rule as enrollment_value() in the database.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const PROGRAM_DAYS = { '5-Day': ['mon', 'tue', 'wed', 'thu', 'fri'], '4-Day': ['mon', 'tue', 'wed', 'thu'], '3-Day': ['mon', 'wed', 'fri'], '2-Day': ['tue', 'thu'] };

const iso = v => (v ? String(v).slice(0, 10) : '');
const utc = s => { const [y, m, d] = iso(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = t => new Date(t).toISOString().slice(0, 10);
export function addDays(s, n) { return fromUtc(utc(s) + n * 864e5); }
export function weekdayOf(s) { return WEEKDAYS[new Date(utc(s)).getUTCDay()]; }
export function mondayOf(s) { const w = new Date(utc(s)).getUTCDay(); return addDays(s, w === 0 ? -6 : 1 - w); }
export function weekDates(monday) { return DAYS.map((_, i) => addDays(monday, i)); }
export function prettyDate(s) { if (!iso(s)) return ''; const [, m, d] = iso(s).split('-').map(Number); return MONTHS[m - 1] + ' ' + d; }
export function prettyLong(s) { return iso(s) ? DAY_LABELS[weekdayOf(s)] + ' ' + prettyDate(s) : ''; }
export function weekLabel(monday) {
  const fri = addDays(monday, 4), [y, m1, d1] = monday.split('-').map(Number), [, m2, d2] = fri.split('-').map(Number);
  return 'Week of ' + dateRange(MONTHS[m1 - 1], d1, MONTHS[m2 - 1], d2) + ', ' + y;      // "Week of Nov 16–20, 2026"
}
export function shortWeek(monday) {
  const fri = addDays(monday, 4), [, m1, d1] = monday.split('-').map(Number), [, m2, d2] = fri.split('-').map(Number);
  return 'Week of ' + dateRange(MONTHS[m1 - 1], d1, MONTHS[m2 - 1], d2);
}

// ---------- names ----------
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
export const denKey = s => { const k = norm(s).replace(/\s*den$/, '').replace(/['’]s$/, ''); return k.length > 4 ? k.replace(/s$/, '') : k; };
export function sameDen(a, b) { const x = denKey(a), y = denKey(b); return !!x && x === y; }
export function denShort(s) { return String(s || '').replace(/\s*Den$/i, ''); }

// ---------- one child on one day ----------
export function valueOn(entries, field, on) {
  let best = null;
  for (const e of entries || []) {
    if (e.field !== field) continue;
    const s = iso(e.starts_on); if (!s || s > on) continue;
    if (e.until && on >= iso(e.until)) continue;
    if (!best || s > iso(best.starts_on) || (s === iso(best.starts_on) && String(e.entered_at || '') > String(best.entered_at || ''))) best = e;
  }
  return best ? best.value : null;
}
function entryOn(entries, field, on) {
  let best = null;
  for (const e of entries || []) {
    if (e.field !== field) continue;
    const s = iso(e.starts_on); if (!s || s > on) continue;
    if (e.until && on >= iso(e.until)) continue;
    if (!best || s >= iso(best.starts_on)) best = e;
  }
  return best;
}
export function daysList(text) { return String(text || '').split(',').map(x => x.trim()).filter(x => DAYS.includes(x)); }
export function programText(program, days) {
  if (program) return program;
  const n = days.length; return n ? n + '-Day' : '';
}
// the state of a child on a day: { status, den, days, program } (null parts when nothing is recorded)
export function stateOn(kid, on) {
  const e = kid.entries || [];
  const days = valueOn(e, 'days', on);
  return { status: valueOn(e, 'status', on), den: valueOn(e, 'den', on), days: days === null ? null : daysList(days), program: valueOn(e, 'program', on) };
}
function firstEntry(kid, field) {
  let best = null;
  for (const e of kid.entries || []) if (e.field === field && (!best || iso(e.starts_on) < iso(best.starts_on))) best = e;
  return best;
}

// ---------- age ----------
export function ageMonths(birthday, on) {
  const b = iso(birthday); if (!b) return null;
  const [by, bm, bd] = b.split('-').map(Number), [y, m, d] = iso(on).split('-').map(Number);
  let n = (y - by) * 12 + (m - bm); if (d < bd) n--;
  return n;
}
// a child's age in words: "2y 10m" under 3, "4y" from 3 ('' with no birthday); site/time-lib.js, style pass step 4
export function ageWords(birthday, on) {
  const n = ageMonths(birthday, on); if (n === null || n < 0) return '';
  return ageFromMonths(n);
}
// the day a child reaches a number of months
export function dayAtMonths(birthday, months) {
  const [by, bm, bd] = iso(birthday).split('-').map(Number);
  const t = new Date(Date.UTC(by, bm - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(bd, last)));
}

// ---------- the week ----------
// cells: { kind: 'here'|'vacation'|'dropin'|'moved'|'hold'|'none', label }
export function weekGrid(ov, den, monday) {
  const dates = weekDates(monday), vac = ov.vacations || [], drops = ov.drop_ins || [];
  const denInfo = (ov.dens || []).find(d => sameDen(d.name, den)) || {};
  const rows = [], holds = [];
  const vacationOn = (name, d) => vac.some(v => norm(v.child_name) === norm(name) && iso(v.start_date) <= d && d <= iso(v.end_date));
  const weekStart = addDays(monday, -3);                       // a move or start over the weekend counts for this Monday
  for (const kid of ov.kids || []) {
    const states = dates.map(d => stateOn(kid, d));
    const inDen = states.map(s => s.status === 'active' && sameDen(s.den, den));
    const holdDays = states.map(s => s.status === 'on_hold' && sameDen(s.den, den));
    const inAny = inDen.some(Boolean), holdAny = holdDays.some(Boolean);
    if (!inAny && !holdAny) continue;
    if (holdAny) {
      const he = (kid.entries || []).filter(e => e.field === 'status' && e.value === 'on_hold').sort((a, b) => iso(b.starts_on).localeCompare(iso(a.starts_on)))[0];
      holds.push({ id: kid.id, name: kid.name, from: he ? iso(he.starts_on) : '', back: he && he.until ? iso(he.until) : (kid.hold_return ? iso(kid.hold_return) : '') });
    }
    if (!inAny) continue;
    let movedLabelShown = false, startLabel = '', schedule = '';
    const cells = dates.map((d, i) => {
      const st = states[i], dow = DAYS[i];
      if (inDen[i]) {
        const scheduled = (st.days || []).includes(dow);
        if (!scheduled) return { kind: 'none' };
        if (vacationOn(kid.name, d)) return { kind: 'vacation', label: 'Vacation' };
        let label = '';
        if (!startLabel) {                                       // the first day here this week: "New · Starts" or "From Panda"
          startLabel = 'x';
          const de = entryOn(kid.entries, 'den', d), first = firstEntry(kid, 'den');
          if (de && iso(de.starts_on) >= weekStart) {
            if (first && first.id === de.id) label = 'New · Starts';
            else { const before = valueOn(kid.entries, 'den', addDays(iso(de.starts_on), -1)); if (before && !sameDen(before, den)) label = 'From ' + denShort(before); }
          }
        }
        if (!schedule) schedule = programText(st.program, st.days || []);
        return { kind: 'here', label };
      }
      if (holdDays[i]) return { kind: 'hold', label: '' };
      if (st.status === 'active' && st.den && !sameDen(st.den, den)) {                  // moved to another den this week
        if (inDen.slice(0, i).some(Boolean)) { const out = { kind: 'moved', label: movedLabelShown ? '' : '→ ' + st.den }; movedLabelShown = true; return out; }
        return { kind: 'none' };
      }
      return { kind: 'none' };
    });
    if (!schedule) { const st = states[inDen.indexOf(true)]; schedule = programText(st.program, st.days || []); }
    rows.push({ id: kid.id, name: kid.name, schedule, cells, drop: false });
  }
  // drop-ins: on the child's own row when they are on the grid and not there that day, else a row of their own
  const weekDrops = drops.filter(x => sameDen(x.classroom, den) && dates.includes(iso(x.date)));
  const dropRows = new Map();
  for (const x of weekDrops) {
    const i = dates.indexOf(iso(x.date));
    const own = rows.find(r => !r.drop && norm(r.name) === norm(x.name));
    if (own && own.cells[i].kind === 'none') { own.cells[i] = { kind: 'dropin', label: 'Drop-in' }; continue; }
    if (own && own.cells[i].kind === 'here') continue;           // already coming that day
    let r = dropRows.get(norm(x.name));
    if (!r) { r = { id: 'drop:' + norm(x.name), name: x.name, schedule: 'Drop-in', cells: DAYS.map(() => ({ kind: 'none' })), drop: true }; dropRows.set(norm(x.name), r); }
    r.cells[i] = { kind: 'dropin', label: 'Drop-in' };
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const all = rows.concat([...dropRows.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))));
  // each child's age on the Monday shown, next to their name (a drop-in visitor's from their own record when they have one)
  for (const r of all) { const k = (ov.kids || []).find(x => x.id === r.id) || (ov.kids || []).find(x => norm(x.name) === norm(r.name)); r.age = k ? ageWords(k.birthday, monday) : ''; }
  const max = denInfo.daily_max == null ? null : Number(denInfo.daily_max);
  // The Total row means something different for each person (Liz, 2026-11-09; section 30 item 5, running list item 68):
  //   enrolled (the admin team): children whose space it is that day, vacations counted (the space is still theirs), drop-ins left out;
  //   coming (teachers): children who will be in the room, vacations left out, drop-ins counted.
  //   Open Spaces (admin team only) = the den's maximum minus enrolled.
  const totals = dates.map((d, i) => {
    let here = 0, vacations = 0, dropins = 0;
    for (const r of all) { const k = r.cells[i].kind; if (k === 'here') here++; else if (k === 'vacation') vacations++; else if (k === 'dropin') dropins++; }
    const enrolled = here + vacations, open = max === null ? null : max - enrolled;
    return { date: d, here, vacations, dropins, enrolled, coming: here + dropins, open, level: open === null ? '' : open >= 2 ? 'ok' : open === 1 ? 'low' : 'full' };
  });
  return { den, monday, dates, max, rows: all, totals, holds };
}

// one den, one month: the totals of every school day, in weeks
export function monthSummary(ov, den, ym) {
  const first = ym + '-01', mondays = [];
  const [y, m] = ym.split('-').map(Number), lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = ym + '-' + String(lastDay).padStart(2, '0');
  for (let mon = mondayOf(first); mon <= last; mon = addDays(mon, 7)) mondays.push(mon);
  const weeks = mondays.map(mon => {
    const g = weekGrid(ov, den, mon);
    return { monday: mon, label: shortWeek(mon), totals: g.totals.map(t => (t.date < first || t.date > last) ? null : t), max: g.max };
  });
  return { den, ym, weeks };
}
export function weeksOfMonth(ym) { return monthSummary({ kids: [], dens: [], vacations: [], drop_ins: [] }, '', ym).weeks.map(w => ({ monday: w.monday, label: w.label })); }

// ---------- the cards above the grid ----------
// ---------- the icon row of My kids (picture 99, section 30 item 3, migration 091) ----------
// What each icon lists today for the dens shown (one den, or every den on All Dens). An item shows from the Monday that is
// N weeks before its date's week (Settings: moveIconWeeks 3, vacationIconWeeks 1, dropInIconWeeks 0 = the week of) until its date
// (a vacation until its last day). newChildren = the page's New child list ({ id, name, birthday, classroom, startDate, days }).
// Each item: { kind, id, name, den, date, end, age, schedule, toDen, source }.
export const ICON_KINDS = ['vacation', 'dropin', 'newchild', 'tin', 'tout'];
export function iconLists(ov, dens, today, newChildren) {
  const st = ov.settings || {}, wk = (v, d) => (v === null || v === undefined || isNaN(Number(v)) ? d : Number(v));
  const W = { move: wk(st.moveIconWeeks, 3), vacation: wk(st.vacationIconWeeks, 1), dropin: wk(st.dropInIconWeeks, 0) };
  const showing = (date, weeks, last) => !!iso(date) && addDays(mondayOf(iso(date)), -7 * weeks) <= today && today <= iso(last || date);
  const mine = den => (dens || []).some(d => sameDen(d, den));
  const kidNamed = name => (ov.kids || []).find(k => norm(k.name) === norm(name));
  const ageOf = (name, on, birthday) => { const k = birthday ? { birthday } : kidNamed(name); return k ? ageWords(k.birthday, on) : ''; };
  const out = { vacation: [], dropin: [], newchild: [], tin: [], tout: [] };
  for (const v of ov.vacations || []) {
    if (!mine(v.classroom) || !showing(v.start_date, W.vacation, v.end_date)) continue;
    out.vacation.push({ kind: 'vacation', id: v.id, name: v.child_name, den: v.classroom, date: iso(v.start_date), end: iso(v.end_date), age: ageOf(v.child_name, iso(v.start_date)), schedule: '' });
  }
  for (const x of ov.drop_ins || []) {
    if (!mine(x.classroom) || !showing(x.date, W.dropin)) continue;
    out.dropin.push({ kind: 'dropin', id: x.id, name: x.name, den: x.classroom, date: iso(x.date), age: ageOf(x.name, iso(x.date)), schedule: '' });
  }
  // a new child: a child on the roster whose start date is still ahead, or one on the page's New child list (once each, by name)
  const seen = new Set();
  for (const k of ov.kids || []) {
    const s = iso(k.start_date); if (!s || s <= today || !mine(k.classroom) || !showing(s, W.move)) continue;
    seen.add(norm(k.name));
    out.newchild.push({ kind: 'newchild', id: k.id, name: k.name, den: k.classroom, date: s, age: ageWords(k.birthday, s), schedule: programText(k.program, k.days || []), days: k.days || [], source: 'kid' });
  }
  for (const n of newChildren || []) {
    const s = iso(n.startDate); if (!s || s < today || seen.has(norm(n.name)) || !mine(n.classroom) || !showing(s, W.move)) continue;
    seen.add(norm(n.name));
    out.newchild.push({ kind: 'newchild', id: n.id, name: n.name, den: n.classroom, date: s, age: ageWords(n.birthday, s), schedule: programText('', n.days || []), days: n.days || [], source: 'new' });
  }
  // transitions not cancelled: out of the den they leave, into the den they join (a withdrawal or graduation has only an out)
  for (const t of ov.transitions || []) {
    if (t.status === 'cancelled' || !showing(t.transition_date, W.move)) continue;
    const d = iso(t.transition_date), item = { id: t.id, name: t.child_name, date: d, age: ageOf(t.child_name, d, t.birthday), schedule: programText(t.future_program || '', t.future_days || []), toDen: t.future_classroom || '', fromDen: t.current_classroom || '' };
    if (mine(t.current_classroom)) out.tout.push(Object.assign({ kind: 'tout', den: t.current_classroom }, item));
    if (t.future_classroom && mine(t.future_classroom)) out.tin.push(Object.assign({ kind: 'tin', den: t.future_classroom }, item));
  }
  for (const k of ICON_KINDS) out[k].sort((a, b) => a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)));
  return out;
}

export function nextDen(dens, name) {
  const list = (dens || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const me = list.find(d => sameDen(d.name, name)); if (!me || me.age_max_months == null) return null;
  const i = list.indexOf(me);
  return list.slice(i + 1).find(d => d.age_min_months != null && d.age_min_months >= me.age_max_months) || null;
}
export function notesFor(ov, den, today) {
  const st = ov.settings || {}, weeks = Number(st.transitionConfirmWeeks) || 2, leadMonths = Number(st.ageCheckMonths) || 3;
  const out = [], dens = ov.dens || [];
  const me = dens.find(d => sameDen(d.name, den)) || {};
  const live = (ov.transitions || []).filter(t => t.status !== 'cancelled' && iso(t.transition_date));
  // 1. transitions coming up that have not been confirmed
  for (const t of live) {
    if (!(sameDen(t.current_classroom, den) || sameDen(t.future_classroom, den))) continue;
    const d = iso(t.transition_date);
    if (t.status === 'confirmed' || d < today || d > addDays(today, weeks * 7)) continue;
    const sched = [t.future_program, (t.future_days || []).length ? '(' + t.future_days.map(x => DAY_LABELS[x]).join(', ') + ')' : ''].filter(Boolean).join(' ');
    out.push({ type: 'transition', id: t.id, child: t.child_name, date: d,
      title: 'Transition coming up: ' + t.child_name + ' moves to ' + t.future_classroom + ' ' + prettyLong(d) + (sched ? ', ' + sched : ''), sub: 'Still happening this way?' });
  }
  // 2. a hold put on from Family bills that has not been seen
  for (const k of ov.kids || []) {
    if (!k.billing_at || !k.billing_note) continue;
    const dn = valueOn(k.entries, 'den', today) || k.classroom; if (!sameDen(dn, den)) continue;
    const he = (k.entries || []).filter(e => e.field === 'status' && e.value === 'on_hold' && e.source === 'family_bills').sort((a, b) => iso(b.starts_on).localeCompare(iso(a.starts_on)))[0];
    if (!he) continue;
    out.push({ type: 'hold', id: k.id, child: k.name, title: 'Put on hold from Family bills: ' + k.name + ', from ' + prettyDate(he.starts_on) + (he.until ? ', back about ' + prettyDate(he.until) : ''),
      sub: 'Not on the grid while on hold; comes back on the return date.' });
  }
  // 3. on hold with the return day come and gone: are they back?
  for (const k of ov.kids || []) {
    if (k.status !== 'on_hold') continue;
    const dn = valueOn(k.entries, 'den', today) || k.classroom; if (!sameDen(dn, den)) continue;
    const he = (k.entries || []).filter(e => e.field === 'status' && e.value === 'on_hold').sort((a, b) => iso(b.starts_on).localeCompare(iso(a.starts_on)))[0];
    if (he && he.until && iso(he.until) <= today) out.push({ type: 'back', id: k.id, child: k.name, title: 'Is ' + k.name + ' back? The hold was to end ' + prettyDate(he.until) + '.', sub: 'They are on the grid again; this brings them back on the Kids roster and Family bills too.' });
  }
  // 4. age checks: a child turning the top of this den's range (or a milestone) soon, with no transition scheduled
  const scheduled = new Set(live.filter(t => iso(t.transition_date) >= today).map(t => norm(t.child_name)));
  const horizon = (() => { const [y, m, d] = today.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + leadMonths, d)); return fromUtc(t.getTime()); })();
  const next = nextDen(dens, den);
  for (const k of ov.kids || []) {
    if (k.status !== 'active' || !k.birthday) continue;
    const dn = valueOn(k.entries, 'den', today) || k.classroom; if (!sameDen(dn, den)) continue;
    const marks = [];
    const milestones = Array.isArray(me.milestones) ? me.milestones : [];
    for (const ms of milestones) marks.push({ months: Number(ms.months), label: ms.label || 'Milestone', kind: 'milestone' });
    if (me.age_max_months != null && !marks.some(x => x.months === Number(me.age_max_months))) marks.push({ months: Number(me.age_max_months), label: '', kind: 'top' });
    for (const mk of marks) {
      const day = dayAtMonths(k.birthday, mk.months);
      if (day > horizon) continue;
      if (mk.kind === 'top' && (scheduled.has(norm(k.name)) || !next)) continue;
      if (day < addDays(today, -60)) continue;
      const past = day <= today;
      out.push({ type: 'age', id: k.id, child: k.name, den: den, date: day, kind: mk.kind, months: mk.months,
        next: mk.kind === 'top' && next ? next.name : '', expectations: mk.kind === 'top' && next ? (next.expectations || '') : '',
        title: 'Age check: ' + k.name + (past ? ' turned ' : ' turns ') + mk.months + ' months on ' + prettyDate(day) + (mk.kind === 'milestone' ? ' — ' + mk.label : '. ' + denShort(den) + ' is ' + (me.age_min_months != null ? me.age_min_months + '–' : 'up to ') + me.age_max_months + ' months.'),
        sub: mk.kind === 'top' ? 'No transition scheduled yet.' + (next ? ' See what ' + next.name + ' looks for before moving.' : '') : 'Check what this means for ' + k.name + ' (field trips, financial aid, graduation).' });
    }
  }
  return out;
}

// ---------- words for changes ----------
export function describeChange(changes, den) {
  const bits = [];
  if (changes.den) bits.push('moves to ' + changes.den);
  if (changes.program) bits.push(changes.den ? changes.program : 'schedule now ' + changes.program);
  if (changes.days) bits.push(changes.den || changes.program ? '(' + changes.days.map(d => DAY_LABELS[d]).join(', ') + ')' : 'days now ' + changes.days.map(d => DAY_LABELS[d]).join(', '));
  return bits.join(' ');
}
