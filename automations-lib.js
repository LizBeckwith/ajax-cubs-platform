// ===== SHARED · automations-lib.js · Automations: database calls and plain-words helpers (section 32, plan/automations.md; migration 077) =====
// The calls are joined into window.__peopleApi by site/platform.js; the helpers are window.__automationsLib.
// Used by: Settings › 8 · Automations, 9 · Holidays, the My automations tile, + New automation and opening one, and the notices on
// Home (tools/automations/). Next: the Automation tab on a card.

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "A, B and C"
export function andList(words) {
  const w = (words || []).filter(Boolean);
  return w.length > 1 ? w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1] : (w[0] || '');
}
// 1 → "1st", 16 → "16th", 22 → "22nd"
export function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
  return n + s;
}
// '01-31' → "Jan 31"; '2026-12-01' → "Dec 1, 2026"
export function dateWords(s) {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return '';
  return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + (m[1] ? ', ' + m[1] : '');
}

// When a date automation happens, in plain words (picture 84 / 87): "Every 1st and 16th", "Every Fri", "Every 2 weeks on Mon",
// "Every Jan 31", "Once, on Dec 1, 2026". An event automation: its event's label.
export function whenWords(a, events) {
  if (a.trigger === 'event') { const e = (events || []).find(x => x.key === a.event_key); return e ? e.label : 'An event'; }
  const days = (a.repeat_days || []).map(d => (DAYS.find(x => x[0] === d) || [d, d])[1]);
  if (a.repeat_kind === 'week_days') return days.length === 7 ? 'Every day' : 'Every ' + andList(days);
  if (a.repeat_kind === 'every_weeks') return (a.every_weeks === 1 ? 'Every week' : 'Every ' + a.every_weeks + ' weeks') + ' on ' + andList(days);
  if (a.repeat_kind === 'month_dates') return 'Every ' + andList((a.month_days || []).slice().sort((x, y) => x - y).map(ordinal));
  if (a.repeat_kind === 'yearly') return 'Every ' + andList((a.year_dates || []).slice().sort().map(dateWords));
  if (a.repeat_kind === 'once') return 'Once, on ' + dateWords(a.start_date);
  return '';
}
// The weekend-or-holiday rule and how early it shows: "the weekday before if it's a weekend or holiday, 2 days ahead".
export function whenExtras(a) {
  if (a.trigger !== 'date') return '';
  const bits = [];
  if (a.weekend_rule === 'before') bits.push('the weekday before if it\'s a weekend or holiday');
  if (a.weekend_rule === 'after') bits.push('the weekday after if it\'s a weekend or holiday');
  const n = a.show_days_before || 0;
  if (n) bits.push(n % 7 === 0 ? (n / 7 === 1 ? '1 week ahead' : n / 7 + ' weeks ahead') : (n === 1 ? '1 day ahead' : n + ' days ahead'));
  return bits.join(', ');
}

// The switched-on actions, in order.
export const liveActions = a => (a.automation_actions || []).filter(x => x.switched_on).sort((x, y) => x.sort_order - y.sort_order);

// A deadline's steps (step_order set; migration 080), in order.
export const stepsOf = a => liveActions(a).filter(x => x.step_order).sort((x, y) => x.step_order - y.step_order);
// "2 business days before", "on the day"
export const daysBeforeWords = n => !n ? 'on the day' : n === 1 ? '1 business day before' : n + ' business days before';

// What happens, short (picture 84's Then column): "Task: Process payroll in ADP", "Tasks: confirm timecards, process payroll",
// "Tell on Home, email, pin to Home".
export function thenWords(a) {
  const steps = stepsOf(a);
  if (steps.length) return 'Steps: ' + steps.map((x, i) => (i + 1) + '. ' + x.title).join(', ');
  const acts = liveActions(a);
  if (!acts.length) return 'Nothing switched on';
  const tasks = acts.filter(x => x.kind === 'make_task');
  if (tasks.length === acts.length) return (tasks.length === 1 ? 'Task: ' : 'Tasks: ') + tasks.map(x => x.title).join(', ');
  const words = [];
  acts.forEach(x => {
    if (x.kind === 'make_task') words.push('task: ' + x.title);
    if (x.kind === 'tell') { if (x.on_home) words.push('tell on Home'); if (x.by_email) words.push(x.email_ok ? 'email' : 'email (waiting for the OK)'); }
    if (x.kind === 'pin_home') words.push('pin to Home');
    if (x.kind === 'tell_main_admin') words.push('tell the main admin');
    if (x.kind === 'share') words.push('share it');
  });
  const uniq = words.filter((w, i) => words.indexOf(w) === i);
  return uniq.join(', ').replace(/^./, c => c.toUpperCase());
}

// Where the actions land (picture 84's Lands on): "Home", "Payroll", or "Home, Payroll". labels: { key: label }.
export function landsOnWords(a, labels) {
  const where = liveActions(a).map(x => x.lands_on === 'home' ? 'Home' : ((labels || {})[x.lands_on] || x.lands_on));
  return where.filter((w, i) => where.indexOf(w) === i).join(', ') || 'Home';
}

// Who gets it (picture 84's Who): the people named, "whoever it's about" for an event, "main admin". names: { id: name } of the people
// who can be given a task now (task_people, migration 069).
export function whoWords(a, names) {
  const who = [];
  liveActions(a).forEach(x => {
    if (x.for_kind === 'them') who.push(a.event_key === 'step_ready' ? 'whoever\'s next' : 'whoever gets it');
    else if (x.for_kind === 'main_admin' || x.kind === 'tell_main_admin') who.push('main admin');
    else if (x.for_person) who.push((names || {})[x.for_person] || 'Someone who has left');
  });
  return andList(who.filter((w, i) => who.indexOf(w) === i));
}

// True when someone it's for has left (archived in People), or the person who made a no-card one has: it "Needs a new person"
// (section 32 part 2). names: as above (only people still here are in it).
export function needsNewPerson(a, names) {
  const here = id => !!(names || {})[id];
  if (liveActions(a).some(x => x.for_kind === 'person' && x.for_person && !here(x.for_person))) return true;
  return !a.place_key && !a.built_in && !!a.created_by && !here(a.created_by);
}

// Groups for Settings › Automations (picture 84): one per card (in the order of places), then "Not on a card yet" (areas such as People),
// then "None (dates only)". places: [{ key, label, kind }] in order; isCard(key): the place has its own card on the site.
// Returns [{ key, label, rows }] without empty groups; key is the card's key, 'areas' or 'none'.
export function automationGroups(list, places, isCard) {
  const label = k => ((places || []).find(p => p.key === k) || {}).label || k;
  const cards = [], byKey = {};
  const areas = { key: 'areas', label: 'Not on a card yet', rows: [] }, none = { key: 'none', label: 'None (dates only)', rows: [] };
  const order = k => { const i = (places || []).findIndex(p => p.key === k); return i < 0 ? 9999 : i; };
  (list || []).slice().sort((x, y) => order(x.place_key) - order(y.place_key) || String(x.name).localeCompare(String(y.name))).forEach(a => {
    if (!a.place_key) { (a.fixed ? areas : none).rows.push(a); return; }      // a built-in one with no card is "Not on a card yet"
    if (!isCard(a.place_key)) { areas.rows.push(a); return; }
    if (!byKey[a.place_key]) { byKey[a.place_key] = { key: a.place_key, label: label(a.place_key), rows: [] }; cards.push(byKey[a.place_key]); }
    byKey[a.place_key].rows.push(a);
  });
  return cards.concat([areas, none]).filter(g => g.rows.length);
}

// What the site already does by itself, written into its cards before Automations existed (running list item 21; plan part 6).
// View only in Settings › Automations: no pause switch, "Always on (built into the card)". They move into the full system card by
// card (plan part 9). The "ready" notice when a project step opens up is a real automation already, so it is not here.
// place_key '' = Not on a card yet. lands: where it shows. where: where it lives on the site.
export const BUILT_IN_AUTOMATIONS = [
  { id: 'builtin-daily-tasks', name: 'Daily tasks', place_key: 'daily_flow',
    when: 'every school day, or the days picked for the task', then: 'the day\'s tasks on Daily Flow', lands: ['Daily Flow'], who: 'no one person',
    where: 'Daily Flow › Daily tasks. Each task\'s days are set with Edit task (⋯ on its row).' },
  // step 3b of the calendar build (migration 085, tools/tracker-timeoff-check.js)
  { id: 'builtin-time-off-check', name: 'Time off check', place_key: 'daily_flow',
    when: 'every school day', then: 'the day\'s PTO, sick leave and late / early, each with its status and cover, under the Time off check task', lands: ['Daily Flow'], who: 'no one person',
    where: 'Daily Flow › Daily tasks › Time off check, with + Add time off.' },
  // step 4 of the calendar build (migration 088, tools/tracker-calendar-requests.js)
  { id: 'builtin-staff-calendar-request', name: 'Staff calendar requests', place_key: 'daily_flow',
    when: 'a staff member adds a Field trip or Classroom support request from My class', then: 'it shows on the Calendar right away, marked Waiting for OK, and goes to Approvals with Approve', lands: ['Daily Flow', 'Home'], who: 'the admin team (Calendar Edit)',
    where: 'Approvals › Calendar requests (and Home\'s tasks). Click it to change or remove it. Which rows staff may add to: Settings › Daily Flow, Staff can add.' },
  // listed 2026-11-10 (Liz: every built automation shows here; docs/plan/automations.md, running list items 55 and 60)
  { id: "builtin-cccap-task", name: "CCCAP task", place_key: "daily_flow",
    when: "every school day", then: "the CCCAP task lists the CCCAP children scheduled today, by den", lands: ["Daily Flow"], who: "no one person",
    where: "Daily Flow › Daily tasks, under the CCCAP task." },
  { id: "builtin-classroom-check-in", name: "Classroom Check-in", place_key: "daily_flow",
    when: "every school day", then: "each Classroom Check-in task lists that den's open tasks and projects, which can be changed in place", lands: ["Daily Flow"], who: "no one person",
    where: "Daily Flow › Daily tasks, under each Classroom Check-in task." },
  { id: "builtin-review-calendar-events", name: "Review calendar events", place_key: "daily_flow",
    when: "a Google calendar event is new or changed", then: "a Review calendar events row, with Add or Skip for each event", lands: ["Home","Daily Flow"], who: "the admin, and an admin assistant who can edit Daily Flow",
    where: "Daily Flow › Calendar view, at the top, and a row on Home. The calendars are picked in Settings › Calendars." },
  { id: "builtin-time-off-added", name: "Time off is added", place_key: "daily_flow",
    when: "PTO, sick leave or late / early is added", then: "it shows on the Calendar right away, marked Waiting for OK, and goes to Needs approval on Home", lands: ["Daily Flow","Home"], who: "the main admin and admins with Timecards",
    where: "The Calendar and Home. Added with + Add time off." },
  { id: "builtin-needs-a-cover", name: "Needs a cover", place_key: "daily_flow",
    when: "a calendar entry or time off is saved with part of its time uncovered", then: "that part shows Needs a cover and counts in the coverage flags", lands: ["Daily Flow"], who: "no one person",
    where: "The Calendar, on the entry's card, and Daily tasks › Time off check." },
  { id: 'builtin-cccap-updates', name: 'CCCAP updates to approve', place_key: 'family_bills',
    when: 'a new or changed CCCAP document is read from Drive each day', then: 'a row on Home with Approve', lands: ['Home', 'Family bills'], who: 'main admin',
    where: 'Home\'s CCCAP updates. Approving one changes the child\'s CCCAP details on Family bills.' },
  { id: 'builtin-cccap-renewals', name: 'CCCAP renewals', place_key: 'family_bills',
    when: 'an authorization ends within 30 days, or a fiscal agreement within 60', then: 'a flag on Home', lands: ['Home'], who: 'main admin',
    where: 'Worked out from the CCCAP authorizations and fiscal agreements on Family bills.' },
  { id: 'builtin-registration-fee', name: 'Registration Fee request', place_key: 'family_bills',
    when: 'a CCCAP child in Pitkin or Eagle needs the registration fee', then: '"Request registration fee from [county]…" on Home', lands: ['Home'], who: 'main admin',
    where: 'Made from the child\'s Registration fee choice on Family bills.' },
  { id: 'builtin-update-procare', name: 'Update Procare', place_key: '',
    when: 'a child\'s schedule, den, hold, start or withdrawal changes', then: 'a task on Home', lands: ['Home'], who: 'main admin and the Procare helper picked in Settings',
    where: 'Made from three places (My kids, Family bills and child transitions), so it is not on one card yet.' },
  // Kids and Enrollment: under Not on a card yet until that card has an Automation tab (Liz, 2026-11-10)
  { id: "builtin-new-child", name: "A new child is saved", place_key: "",
    when: "a new child is saved", then: "a Family bills Roster card marked NEW, with its set-up questions, and an Update Procare task", lands: ["Family bills","Home"], who: "main admin",
    where: "My kids and Family bills › Roster (+ New Child). Belongs to Kids and Enrollment." },
  { id: "builtin-hold", name: "A hold from Family bills", place_key: "",
    when: "Family bills puts a child on hold", then: "a blue note on My kids; the child leaves the week grid and the count", lands: ["My kids"], who: "the admin team",
    where: "My kids › Needs you. Belongs to Kids and Enrollment." },
  { id: "builtin-back-from-hold", name: "Back from hold", place_key: "",
    when: "a hold's return date arrives", then: "the child is back on the week grid, and a note asks to confirm they're back", lands: ["My kids"], who: "the admin team",
    where: "My kids › Needs you. Belongs to Kids and Enrollment." },
  { id: "builtin-transition-soon", name: "A transition 2 weeks away", place_key: "",
    when: "a transition is 2 weeks away", then: "an orange note with Yes, Confirm · Change · Cancel It", lands: ["My kids","Home"], who: "the admin team",
    where: "My kids › Needs you, and Home. Belongs to Kids and Enrollment." },
  { id: "builtin-age-check", name: "Age check", place_key: "",
    when: "a child will reach the top of their den's age range within 3 months, with no transition scheduled", then: "a red Age check note", lands: ["My kids"], who: "the admin team",
    where: "My kids › Needs you. The age ranges are in Settings › Dens. Belongs to Kids and Enrollment." },
  { id: "builtin-teacher-note", name: "A teacher's note or question", place_key: "",
    when: "a teacher adds a note or question to a new child's start or a transition", then: "a row in Needs you with Reply and Mark reviewed; the teacher sees the reply on the same event", lands: ["My kids"], who: "the admin team, and the teacher for the reply",
    where: "My kids › Needs you. Belongs to Kids and Enrollment." },
  { id: 'builtin-coverage-flags', name: 'Coverage flags', place_key: '',
    when: 'approved time off has no cover, a month and a week ahead', then: '"Request a Kids First Dynamic Sub?" or "Who\'s covering?"', lands: ['Home', 'Calendar'], who: 'admin and assistants',
    where: 'On Home and the Daily Flow calendar. Not on a card yet: Timecards or Daily Flow is still to be decided.' },
  { id: 'builtin-welcome-email', name: 'Welcome email', place_key: '',
    when: 'a new person is added with "Send a welcome email" ticked', then: 'an email with their sign-in', lands: ['Email'], who: 'the new person',
    where: 'People › + Add Person.' },
];
// The built-in rows, ready for the Settings table (fixed: view only).
export const builtInRows = () => BUILT_IN_AUTOMATIONS.map(b => ({ ...b, lands: b.lands.slice(), fixed: true, built_in: true, trigger: 'built_in' }));

// A person's own automations with no card (the My automations tile on My responsibilities).
export const myAutomations = (list, me) => (list || []).filter(a => !a.place_key && a.created_by === me);

// Settings › 9 · Holidays: null when a holiday can be added, otherwise a sentence.
export function holidayProblem(h, list) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(h.day || ''))) return 'Pick the date.';
  if (!String(h.name || '').trim()) return 'Give the holiday a name.';
  if ((list || []).some(x => x.day === h.day)) return dateWords(h.day) + ' is already on the list.';
  return null;
}

// ===== + New automation and opening one (pictures 86 and 87; build step 4) =====

// What a date automation's repeat still needs, or null (the "How often?" question).
export function repeatProblem(a) {
  const k = a.repeat_kind;
  if (!k) return 'Pick how often.';
  if ((k === 'week_days' || k === 'every_weeks') && !(a.repeat_days || []).length) return 'Tick the days.';
  if (k === 'every_weeks' && !(a.every_weeks >= 1 && a.every_weeks <= 52)) return 'Say every how many weeks (1 to 52).';
  if (k === 'every_weeks' && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.start_date || ''))) return 'Pick the first date it happens.';
  if (k === 'month_dates' && !(a.month_days || []).length) return 'Tick the dates of the month.';
  if (k === 'yearly' && !((a.year_dates || []).length && a.year_dates.every(d => /^\d\d-\d\d$/.test(d)))) return 'Pick the dates.';
  if (k === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.start_date || ''))) return 'Pick the date.';
  return null;
}
// What an action still needs, or null.
export function actionProblem(x) {
  if ((x.kind === 'make_task' || x.kind === 'tell') && !String(x.title || '').trim()) return x.kind === 'make_task' ? 'Say what the task is.' : 'Say what to tell them.';
  if (x.for_kind === 'person' && !x.for_person && x.kind !== 'tell_main_admin') return 'Pick who it\'s for.';
  if (!x.on_home && !x.by_email) return 'Tick Home or Email.';
  return null;
}

// The name a new automation gets: the event's name, or the first action's words (picture 84 shows it in the Automation column).
export function automationName(a, events) {
  if (stepsOf(a).length && String(a.name || '').trim()) return a.name.trim();     // a deadline is named by the person ("Payday")
  if (a.trigger === 'event') { const e = (events || []).find(x => x.key === a.event_key); return e ? e.label : 'An event'; }
  const first = (a.automation_actions || []).find(x => String(x.title || '').trim());
  return first ? first.title.trim() : 'A reminder';
}

// Who an action is for, in a sentence: a name, "whoever it's about" ("whoever's next" for a step opening up), "the main admin".
function forWords(a, x, names) {
  if (x.kind === 'tell_main_admin' || x.for_kind === 'main_admin') return 'the main admin';
  if (x.for_kind === 'them') return a.event_key === 'step_ready' ? 'whoever\'s next' : 'whoever it\'s about';
  return (names || {})[x.for_person] || 'someone';
}
// "on Home", "by email", "on Home and by email", plus "(Payroll card)" when it lands on a card.
function whereWords(x, labels) {
  const how = [x.on_home ? 'on Home' : '', x.by_email ? 'by email' : ''].filter(Boolean).join(' and ');
  return how + (x.lands_on && x.lands_on !== 'home' ? ' (' + ((labels || {})[x.lands_on] || x.lands_on) + ' card)' : '');
}
// The plain "What will happen" sentence (picture 87, panel 5): "Every 1st and 16th (the weekday before if it's a weekend or holiday),
// 3 days ahead: Example Director gets “Process payroll in ADP” on Home (Payroll card)." o: { events, names, labels }.
export function happenSentence(a, o) {
  o = o || {};
  let when;
  if (a.trigger === 'event') {
    const e = (o.events || []).find(x => x.key === a.event_key);
    when = 'When ' + (e ? e.description || e.label.toLowerCase() : 'it happens');
  } else {
    const rule = a.weekend_rule === 'before' ? 'the weekday before if it\'s a weekend or holiday' : a.weekend_rule === 'after' ? 'the weekday after if it\'s a weekend or holiday' : '';
    const n = a.show_days_before || 0;
    const early = !n ? '' : n % 7 === 0 ? (n === 7 ? '1 week ahead' : n / 7 + ' weeks ahead') : (n === 1 ? '1 day ahead' : n + ' days ahead');
    when = whenWords(a) + (rule ? ' (' + rule + ')' : '') + (early ? ', ' + early : '');
  }
  const steps = stepsOf(a);
  if (steps.length) {
    const list = steps.map((x, i) => (i + 1) + '. ' + forWords(a, x, o.names) + ' gets "' + x.title.trim() + '" (' + daysBeforeWords(x.days_before) + ')');
    return when + ': "' + String(a.name || 'The deadline').trim() + '" is made with its steps in order: ' + list.join('; ') + '. Each step waits for the one before it.';
  }
  const acts = liveActions(a).map(x => {
    const who = forWords(a, x, o.names), where = whereWords(x, o.labels);
    if (x.kind === 'make_task') return who + ' gets "' + x.title.trim() + '" ' + where;
    if (x.kind === 'tell') return who + ' is told "' + x.title.trim() + '" ' + where;
    if (x.kind === 'pin_home') return 'it is pinned to ' + (who === 'whoever it\'s about' ? 'their' : who + '\'s') + ' Home';
    if (x.kind === 'tell_main_admin') return 'the main admin is told' + (x.title ? ' "' + x.title.trim() + '"' : '') + ' ' + where;
    if (x.kind === 'share') return 'it is shared with ' + who;
    return '';
  }).filter(Boolean);
  return when + ': ' + (acts.length ? andList(acts) : 'nothing happens (every action is switched off)') + '.';
}

// The columns an action keeps (what the database stores).
const ACTION_FIELDS = ['sort_order', 'kind', 'title', 'for_kind', 'for_person', 'lands_on', 'on_home', 'by_email', 'email_ok', 'switched_on', 'step_order', 'days_before'];
const actionRow = x => { const r = {}; ACTION_FIELDS.forEach(k => { if (x[k] !== undefined) r[k] = x[k]; }); return r; };
// What changed between the actions an automation had and the ones it has now: { add: [...], change: [{ id, patch }], remove: [ids] }.
export function diffActions(before, after) {
  const was = {}; (before || []).forEach(x => { was[x.id] = x; });
  const add = [], change = [], keep = {};
  (after || []).forEach(x => {
    if (!x.id || !was[x.id]) { add.push(actionRow(x)); return; }
    keep[x.id] = true;
    const patch = {}; ACTION_FIELDS.forEach(k => { if (x[k] !== undefined && x[k] !== was[x.id][k]) patch[k] = x[k]; });
    if (Object.keys(patch).length) change.push({ id: x.id, patch });
  });
  return { add, change, remove: (before || []).filter(x => !keep[x.id]).map(x => x.id) };
}

// The database calls (migration 077; the database shows each person only the automations they may see).
export function makeAutomationsApi(sb) {
  return {
    // + New automation: the automation, then its actions; hands back its id.
    async addAutomation(a) {
      const row = {}; ['name', 'place_key', 'trigger', 'event_key', 'repeat_kind', 'repeat_days', 'every_weeks', 'month_days', 'year_dates', 'start_date', 'weekend_rule', 'show_days_before']
        .forEach(k => { if (a[k] !== undefined) row[k] = a[k]; });
      const made = must(await sb.from('automations').insert(row).select('id').single());
      const acts = (a.automation_actions || []).map((x, i) => ({ ...actionRow(x), sort_order: (i + 1) * 10, automation_id: made.id }));
      if (acts.length) must(await sb.from('automation_actions').insert(acts));
      return made;
    },
    async saveAutomation(id, patch) { must(await sb.from('automations').update(patch).eq('id', id)); },
    // Saves the actions as they are now: new ones added, changed ones changed, removed ones taken off (each kept in the history).
    async saveAutomationActions(id, before, after) {
      const d = diffActions(before, after);
      for (const x of d.remove) must(await sb.from('automation_actions').delete().eq('id', x));
      for (const c of d.change) must(await sb.from('automation_actions').update(c.patch).eq('id', c.id));
      if (d.add.length) must(await sb.from('automation_actions').insert(d.add.map(x => ({ ...x, automation_id: id }))));
    },
    async automations() {
      return must(await sb.from('automations').select('*, automation_actions(*)').order('name')) || [];
    },
    async automationEvents() { return must(await sb.from('automation_events').select('key, label, description, place_key, sort_order').order('sort_order')) || []; },
    // the switch on a row: paused or on (kept in its history by the database)
    async setAutomationPaused(id, paused) { must(await sb.from('automations').update({ paused: !!paused }).eq('id', id)); },
    // Home notices (migration 078): this person's own that aren't ticked off yet, newest first; ticking one off.
    async myNotices() { return must(await sb.from('home_notices').select('id, body, task_id, project_id, created_at').is('read_at', null).order('created_at', { ascending: false }).limit(50)) || []; },
    async tickNotice(id) { must(await sb.from('home_notices').update({ read_at: new Date().toISOString() }).eq('id', id)); },
    async holidays() { return must(await sb.from('holidays').select('day, name').order('day')) || []; },
    async addHoliday(h) { must(await sb.from('holidays').insert({ day: h.day, name: String(h.name).trim() })); },
    async removeHoliday(day) { must(await sb.from('holidays').delete().eq('day', day)); },
  };
}
