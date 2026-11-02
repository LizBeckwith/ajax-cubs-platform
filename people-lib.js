// Small, plain helpers for logins, passwords and the People screen's database calls.
// Kept free of page code so it can be tested on its own (tests/people-lib.test.mjs).

// People with no email sign in with a login name; this address never receives mail.
// (Must match LOGIN_DOMAIN in supabase/functions/manage-people/index.ts.)
export const LOGIN_DOMAIN = 'login.ajaxcubs.com';

export function loginNameFrom(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}

// What to hand to the sign-in call: an email as typed, or a login name turned into its address.
export function loginFrom(typed) {
  const t = String(typed || '').trim();
  if (t.includes('@')) return t.toLowerCase();
  return loginNameFrom(t) + '@' + LOGIN_DOMAIN;
}

// null when the new password is fine, otherwise a sentence for the person.
export function passwordProblem(p1, p2) {
  if (!p1 || p1.length < 12) return 'Use at least 12 characters.';
  if (p1 !== p2) return 'The two passwords do not match.';
  if (/^(.)\1+$/.test(p1)) return 'Pick something less repetitive.';
  return null;
}

// Each area's level for a person: 0 Off, 1 View, 2 Edit. Admin always has Edit everywhere.
// defaults = the role's starting rows [{area_key, level}], own = the person's own rows (may say 0).
export function effectiveLevels(role, areaKeys, defaults, own) {
  const out = {};
  for (const k of areaKeys) out[k] = role === 'admin' ? 2 : 0;
  if (role === 'admin' || role === 'parent') return out;
  for (const r of defaults || []) if (r.area_key in out) out[r.area_key] = r.level;
  for (const r of own || []) if (r.area_key in out) out[r.area_key] = r.level;
  return out;
}

// What to save for a person's switches: only the ones that differ from the role's starting levels.
// Returns { set: [{area_key, level}], clear: [area_key] }  (clear = back to the starting level).
export function accessChanges(chosen, startLevels, existingOwnKeys) {
  const set = [], clear = [];
  for (const [key, level] of Object.entries(chosen)) {
    if (level !== (startLevels[key] || 0)) set.push({ area_key: key, level });
    else if ((existingOwnKeys || []).includes(key)) clear.push(key);
  }
  return { set, clear };
}

// The tabs of the page and the switches that open them (a tab shows if any of its areas is View or higher).
export const TAB_AREAS = {
  'Admin Tasks': ['daily_tasks', 'project_tracker', 'daily_flow', 'my_class'],   // Contact admin lives here too
  'Week Review': ['calendar'],
  'Staff Management': ['timecards', 'my_schedule', 'gear', 'my_class'],
  'Classroom Management': ['my_kids', 'my_class', 'daily_flow'],
  'Newsletter': ['newsletter', 'my_class'],
  'Settings': ['settings'],
  'People': ['people'],                     // admin assistants start at Edit (details only; roles, logins and access stay the admin's)
};
// The admin and admin-assistant layout (Daily Flow with its own pages, Timecards, Gear...). The same
// switches decide what shows, one tab or page at a time.
export const PAGE_AREAS = {
  'Tasks and projects': ['daily_tasks', 'project_tracker', 'daily_flow'],
  'Calendar': ['calendar'],
  'Timecards/Schedules': ['timecards', 'calendar'],
  'Playground, Gym and Laundry': ['playground_laundry', 'calendar'],
};
Object.assign(TAB_AREAS, {
  'Daily Flow': [].concat(...Object.values(PAGE_AREAS)),
  'Timecards': ['timecards'],
  'Gear': ['gear'],
  // the staff portal (staff and shared classroom logins): one tab per switch
  'My class': ['my_class', 'project_tracker', 'calendar', 'newsletter'],
  'My kids': ['my_kids'],
  'My schedule': ['my_schedule'],
  'My coaching': ['my_coaching'],
  'Coaching': ['coaching'],                 // the admin layout's tab (admin, admin assistant); coaches open My coaching
  'My information': ['my_information'],
});
// The pages inside My class.
export const STAFF_PAGE_AREAS = {
  'Class home': ['my_class', 'project_tracker'],
  'Requests': ['my_class'],
  'Class calendar': ['calendar', 'my_class'],
  'Playground and laundry': ['playground_laundry', 'my_class'],
  'Class newsletter': ['newsletter', 'my_class'],
};
export function tabAllowed(tabName, levels, role) {
  if (role === 'admin') return true;
  if (tabName === 'Staff records') return false;          // only the admin (People follows its own switch, since migration 029)
  const keys = TAB_AREAS[tabName];
  if (!keys) return true;
  return keys.some(k => (levels[k] || 0) >= 1);
}
export function pageAllowed(pageName, levels, role) {
  if (role === 'admin') return true;
  const keys = PAGE_AREAS[pageName] || STAFF_PAGE_AREAS[pageName];
  if (!keys) return true;
  return keys.some(k => (levels[k] || 0) >= 1);
}

// ---- Partners (migration 028): the items that can be tagged, and how each one is shown on the Partners page ----
// Each kind: the table it lives in, the columns to read, the words for its heading, where to open it (tab, page), and how to turn a row into
// { kind, id, title, date, status, who }. Adding a card to tagging later = one more entry here (and its kind in migration 028's list).
const words = s => { const t = String(s || '').replace(/_/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
export const PARTNER_KINDS = {
  week_entry: {
    label: 'Calendar entries', table: 'week_entries', columns: 'id, entry_date, title, classroom, covered_by, notes', dateColumn: 'entry_date',
    open: ['Daily Flow', 'Calendar'],
    item: r => ({ title: r.title || r.classroom || 'Calendar entry', date: r.entry_date || '', status: '', who: r.covered_by || '' }),
  },
  project_task: {
    label: 'Project tracker tasks', table: 'project_tasks', columns: 'id, title, project, due_date, status', dateColumn: 'due_date',
    open: ['Daily Flow', 'Tasks and projects'],
    item: r => ({ title: r.title + (r.project ? ' (' + r.project + ')' : ''), date: r.due_date || '', status: words(r.status), who: '' }),
  },
  sub_request: {
    label: 'Dynamic Sub requests', table: 'sub_requests', columns: 'id, requested_by, request_date, classroom, status, notes', dateColumn: 'request_date',
    open: ['Timecards', null],
    item: r => ({ title: 'Sub for ' + (r.classroom || 'a classroom') + (r.notes ? ': ' + clip(r.notes, 50) : ''), date: r.request_date || '', status: words(r.status), who: r.requested_by || '' }),
  },
  work_order: {
    label: 'Work orders', table: 'work_orders', columns: 'id, person, classroom, order_date, status, notes', dateColumn: 'order_date',
    open: ['Gear', null],
    item: r => ({ title: (r.classroom ? r.classroom + ': ' : 'Work order: ') + (clip(r.notes, 60) || '(no description)'), date: r.order_date || '', status: words(r.status), who: r.person || '' }),
  },
  coaching_session: {
    label: 'Coaching sessions', table: 'coaching_sessions', columns: 'id, classroom, coach_pair, session_date, focus, follow_up_status', dateColumn: 'session_date',
    open: ['Coaching', null],
    item: r => ({ title: (r.classroom || 'Coaching') + (r.focus ? ': ' + clip(r.focus, 60) : ''), date: r.session_date || '', status: r.follow_up_status || '', who: r.coach_pair || '' }),
  },
};
export const PARTNER_KIND_ORDER = Object.keys(PARTNER_KINDS);
export function partnerItem(kind, row) {
  const k = PARTNER_KINDS[kind]; if (!k || !row) return null;
  return { kind, id: row.id, ...k.item(row) };
}
// Tagged items grouped by card in the order above; inside a card, soonest date first, undated last. `missing` = tags whose item the
// person cannot see (or that is gone): counted, not listed.
export function groupPartnerItems(tags, itemsByKind) {
  const groups = [];
  let missing = 0;
  for (const kind of PARTNER_KIND_ORDER) {
    const have = itemsByKind[kind] || {};
    const items = [];
    for (const t of tags.filter(t => t.item_kind === kind)) {
      const it = have[t.item_id];
      if (it) items.push({ ...it, tagId: t.id }); else missing++;
    }
    items.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title));
    if (items.length) groups.push({ kind, label: PARTNER_KINDS[kind].label, items });
  }
  return { groups, missing };
}

// The Kids First part of the Partners page (admin only): worked out from the Family bills children, never typed in.
// Children who are archived are left out; a child on hold is listed and marked.
export function kidsFirstLists(profiles, families) {
  const fam = {}; (families || []).forEach(f => { fam[f.id] = f; });
  const line = p => {
    const f = fam[p.family_id];
    return {
      id: p.id, name: ((p.child_first || '') + ' ' + (p.child_last || '')).trim() || '(no name)', parent: f ? ((f.parent_first || '') + ' ' + (f.parent_last || '')).trim() : '',
      room: p.room || '', program: p.program || '', onHold: p.status === 'on_hold',
      dailyRate: p.subsidy1_daily_rate == null ? null : Number(p.subsidy1_daily_rate),
      subsidy: [p.subsidy1_org, p.subsidy2_org].filter(Boolean).join(' + '),
    };
  };
  const live = (profiles || []).filter(p => p.status !== 'archived');
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    kidsFirst: live.filter(p => p.subsidy1_org === 'Kids First').map(line).sort(byName),
    financialAid: live.filter(p => p.financial_aid).map(line).sort(byName),
  };
}

export const ROLE_LABELS = {
  admin: 'Admin', assistant: 'Admin assistant', staff: 'Staff', coach: 'Coach',
  classroom: 'Classroom login (shared)', parent: 'Parent (later)',
};

// ---- the People screen's database calls (the page gets one of these as window.__peopleApi) ----
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ---- stored documents (migration 016): what may be uploaded, and how a file is named in storage ----
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  txt: 'text/plain', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const NO_SLIDES = ['ppt', 'pptx'];       // the staff bucket takes the same files except slide decks
const extOf = name => { const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
// The type to store the file as (some computers report none for a .heic).
export function fileType(file) { return FILE_TYPES[extOf(file && file.name)] || (file && file.type) || 'application/octet-stream'; }
// null when the file is fine, otherwise a sentence for the person.
export function fileProblem(file, bucket) {
  if (!file || !file.name) return 'Choose a file first.';
  const ext = extOf(file.name);
  if (!FILE_TYPES[ext] || (bucket === 'staff-documents' && NO_SLIDES.includes(ext))) return 'That kind of file cannot be stored. Use a PDF, a picture (PNG, JPG, HEIC), or a Word or Excel file.';
  if (file.size > MAX_FILE_BYTES) return 'That file is bigger than 10 MB. Make it smaller (for a photo, lower its size) and try again.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}
// A file name that is safe as part of a storage path: letters, numbers, dots, dashes; the ending kept; never empty.
export function storedName(name) {
  const base = String(name || '').split(/[\\/]/).pop().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const ext = extOf(base), stem = ext ? base.slice(0, -(ext.length + 1)) : base;
  const clean = stem.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return ext ? clean + '.' + ext : clean;
}
const newId = () => (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ---- Schedules (migration 017): who works which shift where, and the AM / PM hours ----
// A shift row = one person, one room (a den, Office or Float), AM / PM / Custom hours, from a start date to an optional end date,
// repeating Monday to Friday. The hours of AM and PM live in shift_types so changing them changes every row.
export const SHIFT_EXTRA_ROOMS = ['Office', 'Float'];
export const DEFAULT_SHIFT_TYPES = [
  { shift: 'AM', start_time: '07:45', end_time: '16:30', lunch_minutes: 45 },
  { shift: 'PM', start_time: '08:45', end_time: '17:30', lunch_minutes: 45 },
];
export const hhmm = t => String(t || '').slice(0, 5);
// "07:45" -> "7:45 AM"
export function clockText(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return '';
  const h = +m[1]; return (h % 12 === 0 ? 12 : h % 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}
const weekdayOf = date => { const p = String(date).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getDay(); };
// The hours of a row: AM and PM follow shift_types, Custom carries its own.
export function shiftHours(row, types) {
  if (row.shift === 'Custom') return { start: hhmm(row.start_time), end: hhmm(row.end_time), lunch: row.lunch_minutes == null ? 45 : row.lunch_minutes };
  const t = (types || DEFAULT_SHIFT_TYPES).find(x => x.shift === row.shift) || DEFAULT_SHIFT_TYPES.find(x => x.shift === row.shift);
  return t ? { start: hhmm(t.start_time), end: hhmm(t.end_time), lunch: t.lunch_minutes } : { start: '', end: '', lunch: 0 };
}
// "7:45 AM – 4:30 PM"
export function hoursText(row, types) { const h = shiftHours(row, types); return h.start ? clockText(h.start) + ' – ' + clockText(h.end) : ''; }
// The week strip has an AM row and a PM row. A Custom shift counts as AM when it starts before the middle of the two (8:15 by default).
export function shiftSlot(row, types) {
  if (row.shift === 'AM' || row.shift === 'PM') return row.shift;
  const am = shiftHours({ shift: 'AM' }, types).start, pm = shiftHours({ shift: 'PM' }, types).start;
  const mins = t => { const m = /^(\d+):(\d+)/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0; };
  return mins(hhmm(row.start_time)) < (mins(am) + mins(pm)) / 2 ? 'AM' : 'PM';
}
// Is this row working on that day? (a weekday between its start and end dates)
export function shiftActiveOn(row, date) {
  const d = weekdayOf(date);
  if (d === 0 || d === 6) return false;
  return String(row.start_date) <= date && (!row.end_date || date <= String(row.end_date));
}
const sameName = (a, b) => { const n = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); return n(a) !== '' && n(a) === n(b); };
export { sameName as sameShiftName };
// Everyone working one day, with what they are doing: { person, room, shift, slot, hours, out, half, cover }.
//   leaveOf(person, date) -> null | { kind: 'out' | 'half', cover: 'name' | 'not needed' | '' } (time off, sick days)
export function dayRoster(rows, date, types, leaveOf) {
  return rows.filter(r => shiftActiveOn(r, date)).map(r => {
    const lv = leaveOf ? leaveOf(r.person, date) : null;
    return { person: r.person, room: r.room, shift: r.shift, slot: shiftSlot(r, types), hours: hoursText(r, types), id: r.id,
      out: !!lv && lv.kind === 'out', half: !!lv && lv.kind === 'half', cover: lv ? String(lv.cover || '').trim() : '' };
  }).sort((a, b) => a.room.localeCompare(b.room) || (a.slot === b.slot ? 0 : a.slot === 'AM' ? -1 : 1) || a.person.localeCompare(b.person));
}
// One room's AM or PM on one day: who is there, who is out (and who covers), and whether it needs flagging.
//   gap: 'nobody'  no one is on that shift at all
//        'out'     everyone on it is out and no cover is named (cover "not needed" counts as covered)
export function slotCoverage(roster, room, slot) {
  const here = roster.filter(r => r.room === room && r.slot === slot);
  const present = here.filter(r => !r.out), out = here.filter(r => r.out);
  const covers = out.map(r => r.cover).filter(c => c && !/^not needed$/i.test(c));
  const noNeed = out.some(r => /^not needed$/i.test(r.cover));
  let gap = null;
  if (!here.length) gap = 'nobody';
  else if (!present.length && !covers.length && !noNeed) gap = 'out';
  return { present, out, covers, gap };
}
// Rows that overlap for the same person and room (to warn before saving): same person, same room, same slot, overlapping dates.
export function shiftOverlap(rows, row, types) {
  const slot = shiftSlot(row, types), a1 = row.start_date, a2 = row.end_date || '9999-12-31';
  return rows.find(r => r.id !== row.id && sameName(r.person, row.person) && r.room === row.room && shiftSlot(r, types) === slot
    && String(r.start_date) <= a2 && (r.end_date || '9999-12-31') >= a1) || null;
}

// ---- Time off: how a day is paid (migration 021) ----
// A time-off day is paid, half paid or unpaid. New approved time off starts unpaid and a sick day starts paid; a day with nothing
// chosen yet (older rows) counts as paid, so the numbers that were already there do not change.
export const PAY_LABELS = { paid: 'Paid', half: 'Half paid', unpaid: 'Unpaid' };
export const payDefault = dayType => (dayType === 'sick' ? 'paid' : 'unpaid');
export function payFraction(req) {
  const p = req && req.pay;
  return p === 'unpaid' ? 0 : p === 'half' ? 0.5 : 1;
}

// ---- Gear: budgets and the order log (migration 020) ----
// A budget has an amount per period (a month, or a year counted from the month it starts), may carry unused money into the next
// period, and is charged by orders (order.budget_id). Nothing here orders anything: it only adds up what was logged.
export const GEAR_DEN_BUDGET = 100;      // every den starts at $100 a month, no carry over
export const GEAR_KINDS = { den: 'Den', snacks: 'Snacks', other: 'Other', subscription: 'Subscription' };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dparts = d => String(d).slice(0, 10).split('-').map(Number);                 // [year, month, day]
const dstr = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();                    // days in month m (1-12)
const monthsBetween = (a, b) => { const x = dparts(a), z = dparts(b); return (z[0] - x[0]) * 12 + (z[1] - x[1]); };
const dayBefore = d => { const p = dparts(d), t = new Date(Date.UTC(p[0], p[1] - 1, p[2] - 1)); return dstr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
const cents = n => Math.round((Number(n) || 0) * 100) / 100;

// The period a date falls in for a budget: its first and last day, a label, and how many whole periods came before it.
export function budgetPeriod(budget, date) {
  const [y, m] = dparts(date);
  if (budget.period !== 'year') {
    return { start: dstr(y, m, 1), end: dstr(y, m, dim(y, m)), label: MONTH_NAMES[m - 1] + ' ' + y, index: monthsBetween(budget.starts_on, date) };
  }
  const sm = dparts(budget.starts_on)[1], sy = m >= sm ? y : y - 1;
  const em = sm === 1 ? 12 : sm - 1, ey = sm === 1 ? sy : sy + 1;
  return {
    start: dstr(sy, sm, 1), end: dstr(ey, em, dim(ey, em)),
    label: sm === 1 ? String(sy) : MONTH_NAMES[sm - 1] + ' ' + sy + ' – ' + MONTH_NAMES[em - 1] + ' ' + ey,
    index: Math.floor(monthsBetween(budget.starts_on, date) / 12),
  };
}
// How a budget stands on a date: spent this period, carried in from earlier periods (if it carries), available, remaining.
export function budgetStatus(budget, orders, date) {
  const p = budgetPeriod(budget, date), mine = orders.filter(o => o.budget_id === budget.id);
  const sum = (from, to) => cents(mine.filter(o => String(o.order_date) >= from && String(o.order_date) <= to).reduce((s, o) => s + (Number(o.amount) || 0), 0));
  const amount = cents(budget.amount), spent = sum(p.start, p.end), before = Math.max(0, p.index);
  const earlier = before > 0 ? sum(String(budget.starts_on).slice(0, 10), dayBefore(p.start)) : 0;
  const carried = budget.carry_over && before > 0 ? cents(amount * before - earlier) : 0;
  const available = cents(amount + carried), remaining = cents(available - spent);
  return { amount, spent, carried, available, remaining, over: remaining < 0, label: p.label, start: p.start, end: p.end };
}
// A den's budget row by name (case and spacing do not matter), or null.
export function denBudget(den, budgets) {
  const k = String(den || '').trim().toLowerCase();
  return k ? budgets.find(b => b.kind === 'den' && String(b.name).trim().toLowerCase() === k) || null : null;
}
// A subscription is charged by itself each month: the months since it started (the last few), how much was logged in each, and
// which are missing a charge (a month counts as due once its charge day has come, or the month is over).
export function subscriptionMonths(budget, orders, today, limit = 6) {
  const start = String(budget.starts_on).slice(0, 10), n = monthsBetween(start, today), mine = orders.filter(o => o.budget_id === budget.id);
  const [ty, tm, td] = dparts(today), sy = dparts(start)[0], sm = dparts(start)[1], out = [];
  for (let i = 0; i <= n; i++) {
    const y = sy + Math.floor((sm - 1 + i) / 12), m = ((sm - 1 + i) % 12) + 1, key = dstr(y, m, 1).slice(0, 7);
    const here = mine.filter(o => String(o.order_date).slice(0, 7) === key);
    const current = y === ty && m === tm, due = !current || td >= (budget.charge_day || 1);
    out.push({ month: key, label: MONTH_NAMES[m - 1] + ' ' + y, count: here.length, total: cents(here.reduce((s, o) => s + (Number(o.amount) || 0), 0)), due, missing: due && budget.active !== false && here.length === 0 });
  }
  return n < 0 ? [] : out.slice(-limit);
}

export function makePeopleApi(sb) {
  return {
    profiles: async () => must(await sb.from('profiles')
      .select('id, display_name, role, classroom, scope, person_name, phone, contact_email, active, days_view, created_at').order('display_name')),
    areas: async () => must(await sb.from('access_areas').select('key, label, group_name, kind, status, sort_order').order('sort_order')),
    roleDefaults: async () => must(await sb.from('role_defaults').select('role, area_key, level')),
    personAccess: async id => must(await sb.from('person_access').select('area_key, level').eq('profile_id', id)),
    dens: async () => must(await sb.from('classrooms').select('name').order('sort_order')).map(r => r.name),
    dayViewers: async id => must(await sb.from('day_viewers').select('person_name').eq('viewer_id', id)).map(r => r.person_name),
    cards: async () => must(await sb.from('cards').select('key, assigned_to')),
    // who owns each card, with the owner's name (migration 012). Until 012 is run, falls back to the ids alone.
    cardOwners: async () => {
      const r = await sb.rpc('card_owners');
      if (!r.error) return r.data || [];
      return must(await sb.from('cards').select('key, assigned_to')).map(c => ({ key: c.key, assigned_to: c.assigned_to, owner_name: '' }));
    },

    // The signed-in person's own copy of their Staff Tracker information (migration 013), or null if none is linked to them.
    async myInformation() {
      const id = must(await sb.rpc('my_staff_id'));
      if (!id) return null;
      const [staff, tasks, progress, credentials, pdis] = await Promise.all([
        sb.from('staff_records').select('*').eq('id', id),
        sb.from('onboarding_tasks').select('*').order('sort_order'),
        sb.from('onboarding_progress').select('*').eq('staff_id', id),
        sb.from('staff_credentials').select('*').eq('staff_id', id),
        sb.from('pdis_records').select('*').eq('staff_id', id),
      ]);
      const rec = must(staff)[0];
      if (!rec) return null;
      return { staff: rec, tasks: must(tasks), progress: must(progress), credentials: must(credentials), pdis: must(pdis)[0] || null };
    },
    // Mark one of my own checklist items In progress / Done (migration 014). The database allows only my own, non-admin-only items.
    async setMyTask(taskKey, status, completed) { must(await sb.rpc('set_my_task', { p_task: taskKey, p_status: status, p_completed: completed || null })); },
    // Admin only: checklist items staff marked that nobody has checked yet, with names.
    async staffChecks() {
      const [prog, staff, tasks] = await Promise.all([
        sb.from('onboarding_progress').select('staff_id, task_key, status, date_completed, staff_marked_at, reviewed_at').not('staff_marked_at', 'is', null),
        sb.from('staff_records').select('id, first_name, last_name'), sb.from('onboarding_tasks').select('task_key, name')]);
      const who = {}, what = {};
      must(staff).forEach(s => { who[s.id] = (s.first_name.trim() + ' ' + s.last_name.trim()).trim(); });
      must(tasks).forEach(t => { what[t.task_key] = t.name; });
      return must(prog).filter(p => !p.reviewed_at || p.reviewed_at < p.staff_marked_at)
        .map(p => ({ staff_id: p.staff_id, name: who[p.staff_id] || '', task: what[p.task_key] || p.task_key, status: p.status, date_completed: p.date_completed, marked_at: p.staff_marked_at }))
        .sort((x, y) => String(y.marked_at).localeCompare(String(x.marked_at)));
    },
    // Admin only: every credential with the person's name and employment status (for the expiring flag on Home).
    async credentialAlerts() {
      const [staff, creds] = await Promise.all([
        sb.from('staff_records').select('id, first_name, last_name, employment_status'),
        sb.from('staff_credentials').select('staff_id, credential_type, expiration_date'),
      ]);
      const by = {};
      must(staff).forEach(s => { by[s.id] = s; });
      return must(creds).filter(c => by[c.staff_id]).map(c => ({
        name: (by[c.staff_id].first_name.trim() + ' ' + by[c.staff_id].last_name.trim()).trim(),
        employment_status: by[c.staff_id].employment_status, credential_type: c.credential_type, expiration_date: c.expiration_date,
      }));
    },

    // Admin only: the Staff Tracker roster, so a login can be linked to its record on the People tab (migration 013).
    // Throws the database's message if it cannot be read, so the form can say why the picker is missing.
    async staffRecords() {
      const r = await sb.from('staff_records').select('id, legacy_id, first_name, last_name, role, employment_status, profile_id');
      if (r.error) throw new Error(r.error.message);
      return (r.data || []).slice().sort((a, b) =>
        (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || ''));
    },
    // ---- the Staff records screen (admin only; migration 013's tables, where only the admin can write) ----
    // The database hands back at most 1000 rows a request, and the checklist alone is more than that, so read in pages (ordered by something unique, so no row is skipped or repeated).
    async staffAdminLoad() {
      const pages = async (table, order) => {
        let all = [];
        for (let from = 0; ; from += 1000) {
          let q = sb.from(table).select('*');
          [].concat(order || []).forEach(o => { q = q.order(o); });
          const rows = must(await q.range(from, from + 999)) || [];
          all = all.concat(rows);
          if (rows.length < 1000) return all;
        }
      };
      const [staff, tasks, progress, credentials, pdis] = await Promise.all([
        pages('staff_records', 'legacy_id'), pages('onboarding_tasks', ['sort_order', 'task_key']), pages('onboarding_progress', ['staff_id', 'task_key']),
        pages('staff_credentials', 'id'), pages('pdis_records', 'staff_id')]);
      return { staff, tasks, progress, credentials, pdis };
    },
    async saveStaffRecord(id, patch) { must(await sb.from('staff_records').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)); },
    async addStaffRecord(rec) {
      const legacy = 'W' + Date.now().toString(36).toUpperCase();     // the Staff Tracker's ids look like S006; new people made here start with W
      return must(await sb.from('staff_records').insert({ ...rec, legacy_id: legacy }).select().single());
    },
    async saveCredential(c) {
      const { id, ...fields } = c;
      if (id) { must(await sb.from('staff_credentials').update(fields).eq('id', id)); return { id, ...fields }; }
      return must(await sb.from('staff_credentials').insert(fields).select().single());
    },
    async deleteCredential(id) { must(await sb.from('staff_credentials').delete().eq('id', id)); },
    async saveProgress(row) { must(await sb.from('onboarding_progress').upsert(row, { onConflict: 'staff_id,task_key' })); },
    // the master list of onboarding tasks (admin only)
    async saveTask(t) { must(await sb.from('onboarding_tasks').upsert(t, { onConflict: 'task_key' })); },
    async deleteTask(key) { must(await sb.from('onboarding_tasks').delete().eq('task_key', key)); },
    async setTaskOrder(pairs) { for (const p of pairs) must(await sb.from('onboarding_tasks').update({ sort_order: p.sort_order }).eq('task_key', p.task_key)); },
    // put tasks on people's checklists; ones they already have are left alone
    async addProgressRows(rows) {
      for (let i = 0; i < rows.length; i += 400) must(await sb.from('onboarding_progress').upsert(rows.slice(i, i + 400), { onConflict: 'staff_id,task_key', ignoreDuplicates: true }));
    },
    async deleteProgress(staffId, taskKey) { must(await sb.from('onboarding_progress').delete().eq('staff_id', staffId).eq('task_key', taskKey)); },
    async savePdis(row) { must(await sb.from('pdis_records').upsert(row, { onConflict: 'staff_id' })); },

    // ---- Coaching card / My coaching (migration 015). The database hands back only the dens this person may see. ----
    async coachingLoad() {
      const [goals, links, comments, sessions, meta, actions, items] = await Promise.all([
        sb.from('coaching_goals').select('*'),
        sb.from('coaching_links').select('*').order('created_at'),
        sb.from('coaching_comments').select('*').order('created_at'),
        sb.from('coaching_sessions').select('*').order('session_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
        sb.from('coaching_plan_meta').select('*'),
        sb.from('coaching_plan_actions').select('*').order('sort_order').order('created_at'),
        sb.from('coaching_plan_items').select('*').order('sort_order').order('created_at'),
      ]);
      return { goals: must(goals), links: must(links), comments: must(comments), sessions: must(sessions), meta: must(meta), actions: must(actions), items: must(items) };
    },
    async saveCoachingGoal(classroom, goal) { must(await sb.from('coaching_goals').upsert({ classroom, goal, updated_at: new Date().toISOString() }, { onConflict: 'classroom' })); },
    async saveCoachingPlanMeta(row) { must(await sb.from('coaching_plan_meta').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'classroom' })); },
    // one call per kind of thing: no id = add it, an id = change it
    async saveCoachingRow(table, row) {
      const { id, ...fields } = row;
      if (id) { must(await sb.from(table).update(fields).eq('id', id)); return { id, ...fields }; }
      return must(await sb.from(table).insert(fields).select().single());
    },
    async deleteCoachingRow(table, id) { must(await sb.from(table).delete().eq('id', id)); },

    // ---- Stored documents (migration 016). Files go to private buckets and are opened through short-lived links. ----
    // A person's staff files (the database hands back only what this person may see; no id = everyone's, for the admin).
    async staffDocuments(staffId) {
      let q = sb.from('staff_documents').select('*').order('created_at', { ascending: false });
      if (staffId) q = q.eq('staff_id', staffId);
      return must(await q);
    },
    // Upload a file and record whose it is. If the record cannot be saved, the file is taken out again.
    async addStaffDocument(d) {
      const bad = fileProblem(d.file, 'staff-documents'); if (bad) throw new Error(bad);
      const path = d.staffId + '/' + newId() + '-' + storedName(d.file.name);
      const up = await sb.storage.from('staff-documents').upload(path, d.file, { contentType: fileType(d.file), upsert: false });
      if (up.error) throw new Error(up.error.message);
      const row = { staff_id: d.staffId, kind: d.kind || 'other', title: String(d.title || '').trim() || d.file.name, credential_id: d.credentialId || null,
        task_key: d.taskKey || null, file_name: d.file.name, content_type: fileType(d.file), size_bytes: d.file.size, storage_path: path, uploaded_by_name: d.byName || '' };
      const ins = await sb.from('staff_documents').insert(row).select().single();
      if (ins.error) { try { await sb.storage.from('staff-documents').remove([path]); } catch (e) { /* nothing more to do */ } throw new Error(ins.error.message); }
      return ins.data;
    },
    async saveStaffDocument(id, patch) { must(await sb.from('staff_documents').update(patch).eq('id', id)); },
    async deleteStaffDocument(doc) {
      must(await sb.from('staff_documents').delete().eq('id', doc.id));
      try { await sb.storage.from('staff-documents').remove([doc.storage_path]); } catch (e) { /* the record is gone; a stray file is harmless */ }
    },
    // A link that opens a stored file for two minutes.
    async fileLink(bucket, path) {
      const r = await sb.storage.from(bucket).createSignedUrl(path, 120);
      if (r.error) throw new Error(r.error.message);
      return r.data.signedUrl;
    },
    // A file for a coaching session, kept in the den's folder. Returns what to save on the session.
    async addCoachingFile(classroom, file) {
      const bad = fileProblem(file, 'coaching-files'); if (bad) throw new Error(bad);
      const path = classroom + '/' + newId() + '-' + storedName(file.name);
      const up = await sb.storage.from('coaching-files').upload(path, file, { contentType: fileType(file), upsert: false });
      if (up.error) throw new Error(up.error.message);
      return { attachment_path: path, attachment_name: file.name, attachment_url: '' };
    },
    async removeCoachingFile(path) { if (path) { try { await sb.storage.from('coaching-files').remove([path]); } catch (e) { /* a stray file is harmless */ } } },

    // ---- Schedules (migration 017) ----
    async shiftTypes() { return must(await sb.from('shift_types').select('shift, start_time, end_time, lunch_minutes').order('shift')); },
    async saveShiftType(shift, patch) { must(await sb.from('shift_types').update({ ...patch, updated_at: new Date().toISOString() }).eq('shift', shift)); },
    async shifts() { return must(await sb.from('staff_shifts').select('*').order('start_date')); },
    // no id = add it, an id = change it
    async saveShift(row) {
      const { id, ...fields } = row;
      if (id) { must(await sb.from('staff_shifts').update(fields).eq('id', id)); return { id, ...fields }; }
      return must(await sb.from('staff_shifts').insert(fields).select().single());
    },
    async deleteShift(id) { must(await sb.from('staff_shifts').delete().eq('id', id)); },
    // ---- Shift requests (migration 019) ----
    async shiftRequests() { return must(await sb.from('shift_requests').select('*').order('created_at', { ascending: false })); },
    async requestShift(row) { return must(await sb.from('shift_requests').insert(row).select().single()); },
    // status 'approved' (the database adds the shift to the schedule) or 'declined'
    async decideShiftRequest(id, status) { must(await sb.from('shift_requests').update({ status }).eq('id', id)); },
    async cancelShiftRequest(id) { must(await sb.from('shift_requests').delete().eq('id', id)); },
    // ---- Gear (migration 020) ----
    async gearBudgets() { return must(await sb.from('gear_budgets').select('*').order('name')); },
    // no id = add it, an id = change it
    async saveGearBudget(row) {
      const { id, ...fields } = row;
      if (id) { must(await sb.from('gear_budgets').update(fields).eq('id', id)); return { id, ...fields }; }
      return must(await sb.from('gear_budgets').insert(fields).select().single());
    },
    async deleteGearBudget(id) { must(await sb.from('gear_budgets').delete().eq('id', id)); },
    async gearOrders() { return must(await sb.from('gear_orders').select('*').order('order_date', { ascending: false })); },
    async saveGearOrder(row) {
      const { id, ...fields } = row;
      if (id) { must(await sb.from('gear_orders').update(fields).eq('id', id)); return { id, ...fields }; }
      return must(await sb.from('gear_orders').insert(fields).select().single());
    },
    async deleteGearOrder(id) { must(await sb.from('gear_orders').delete().eq('id', id)); },
    // Point one staff record at this login (or, with no record, remove the login's link). A login has one record.
    async linkStaffRecord(profileId, staffId) {
      must(await sb.from('staff_records').update({ profile_id: null }).eq('profile_id', profileId));
      if (staffId) must(await sb.from('staff_records').update({ profile_id: profileId }).eq('id', staffId));
    },
    async updateProfile(id, patch) { must(await sb.from('profiles').update(patch).eq('id', id)); },
    async saveAccess(id, changes) {
      if (changes.set.length) must(await sb.from('person_access').upsert(changes.set.map(r => ({ profile_id: id, ...r })), { onConflict: 'profile_id,area_key' }));
      if (changes.clear.length) must(await sb.from('person_access').delete().eq('profile_id', id).in('area_key', changes.clear));
    },
    async saveDayViewers(id, names) {
      must(await sb.from('day_viewers').delete().eq('viewer_id', id));
      if (names.length) must(await sb.from('day_viewers').insert(names.map(n => ({ viewer_id: id, person_name: n }))));
    },
    // Cards made from projects (migration 023): their rows in the list of switchable areas (key "pc_...") with the project's description
    projectCards: async () => {
      const [areas, cards] = await Promise.all([sb.from('access_areas').select('key, label, sort_order').like('key', 'pc_%').order('sort_order'), sb.from('cards').select('key, notes, assigned_to')]);
      const by = {}; must(cards).forEach(c => { by[c.key] = c; });
      return must(areas).filter(a => String(a.key).startsWith('pc_')).map(a => ({ key: a.key, label: a.label, notes: (by[a.key] && by[a.key].notes) || '', assigned_to: (by[a.key] && by[a.key].assigned_to) || null }));
    },
    // ---- Partners (migration 028) ----
    // false until migration 028 has been run
    partnersReady: async () => !(await sb.from('partners').select('id').limit(1)).error,
    partners: async () => must(await sb.from('partners').select('*').order('sort_order').order('name')),
    async addPartner(name, sortOrder) { return must(await sb.from('partners').insert({ name: String(name).trim(), sort_order: sortOrder || 0 }).select().single()); },
    async renamePartner(id, name) { must(await sb.from('partners').update({ name: String(name).trim() }).eq('id', id)); },
    async deletePartner(id) { must(await sb.from('partners').delete().eq('id', id)); },
    partnerTags: async () => must(await sb.from('partner_tags').select('*').order('tagged_at')),
    async tagItem(partnerId, kind, itemId) { return must(await sb.from('partner_tags').insert({ partner_id: partnerId, item_kind: kind, item_id: itemId }).select().single()); },
    async untagItem(tagId) { must(await sb.from('partner_tags').delete().eq('id', tagId)); },
    // The tagged items of each kind, read through the item's own table (so what a person may see is still decided there).
    // wanted = { kind: [ids] } -> { kind: { id: item } }
    async partnerItemsById(wanted) {
      const out = {};
      for (const kind of Object.keys(wanted)) {
        const ids = [...new Set(wanted[kind])]; out[kind] = {};
        if (!PARTNER_KINDS[kind] || !ids.length) continue;
        const rows = must(await sb.from(PARTNER_KINDS[kind].table).select(PARTNER_KINDS[kind].columns).in('id', ids));
        rows.forEach(r => { out[kind][r.id] = partnerItem(kind, r); });
      }
      return out;
    },
    // Recent items of one kind to pick from when tagging (newest first), optionally narrowed by a word in the shown text.
    async partnerPickList(kind, text) {
      const k = PARTNER_KINDS[kind]; if (!k) return [];
      const rows = must(await sb.from(k.table).select(k.columns).order(k.dateColumn, { ascending: false, nullsFirst: false }).limit(200));
      const want = String(text || '').trim().toLowerCase();
      return rows.map(r => partnerItem(kind, r)).filter(it => !want || [it.title, it.who, it.status, it.date].join(' ').toLowerCase().includes(want)).slice(0, 40);
    },
    // ---- Family bills (migration 024; admin only) ----
    // false until migration 024 (the family bills tables) has been run
    billingReady: async () => !(await sb.from('billing_profiles').select('id').limit(1)).error,
    billingProfiles: async () => must(await sb.from('billing_profiles').select('*').order('child_last').order('child_first')),
    billingFamilies: async () => must(await sb.from('families').select('id, parent_first, parent_last')),
    billingRates: async () => {
      const [rateCards, cccap, upk, settings, closures] = await Promise.all([
        sb.from('billing_rate_cards').select('*').order('sort_order'), sb.from('billing_cccap_rates').select('*').order('county'),
        sb.from('billing_upk_rates').select('*').order('org').order('tier').order('program'), sb.from('billing_settings').select('key, value').order('key'),
        sb.from('billing_closures').select('closure_date').order('closure_date')]);
      return { rateCards: must(rateCards), cccap: must(cccap), upk: must(upk), settings: must(settings), closures: must(closures).map(r => r.closure_date) };
    },
    // the children in My kids, for the match screen
    billingKids: async () => must(await sb.from('kids').select('id, name, classroom, birthday').order('name')),
    // pair a billing child with a My kids child (kidId null = unpair)
    async matchBillingProfile(profileId, kidId) {
      must(await sb.from('billing_profiles').update({ kid_id: kidId || null, updated_at: new Date().toISOString() }).eq('id', profileId));
    },
    // add the billing child to My kids (name, birthday, den and the weekdays of the program) and pair them
    async addKidFromProfile(profile) {
      const DAYS = { '5-Day': ['mon', 'tue', 'wed', 'thu', 'fri'], '4-Day': ['mon', 'tue', 'wed', 'thu'], '3-Day': ['mon', 'wed', 'fri'], '2-Day': ['tue', 'thu'] };
      const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const days = profile.day_count_custom && (profile.custom_days || []).length ? (profile.custom_days || []).map(n => KEYS[n]).filter(k => k && k !== 'sun' && k !== 'sat') : (DAYS[profile.program] || []);
      const row = must(await sb.from('kids').insert({ name: (profile.child_first + ' ' + profile.child_last).trim(), birthday: profile.dob || null, classroom: profile.room || '', days }).select('id').single());
      must(await sb.from('billing_profiles').update({ kid_id: row.id, updated_at: new Date().toISOString() }).eq('id', profile.id));
      return row.id;
    },
    // ---- Family bills, editing the children and rates (migration 026; admin only) ----
    // false until migration 026 has been run (editing is switched off until then, because the HQ import must be told when the platform is edited)
    billingEditReady: async () => !(await sb.from('billing_meta').select('key').limit(1)).error,
    // Notes that the platform has been edited, so the HQ import refuses to overwrite it
    async markBillingEdited() { must(await sb.from('billing_meta').upsert({ key: 'edited_in_platform', value: 'yes', updated_at: new Date().toISOString() }, { onConflict: 'key' })); },
    // A parent's name -> the family's id (an existing family with that name, or a new one); both blank -> null
    async familyIdFor(first, last) {
      const f = String(first || '').trim(), l = String(last || '').trim();
      if (!f && !l) return null;
      const all = must(await sb.from('families').select('id, parent_first, parent_last'));
      const hit = all.find(x => String(x.parent_first).trim().toLowerCase() === f.toLowerCase() && String(x.parent_last).trim().toLowerCase() === l.toLowerCase());
      if (hit) return hit.id;
      return must(await sb.from('families').insert({ parent_first: f, parent_last: l }).select('id').single()).id;
    },
    // Adds a child (id null) or changes one; row = billing_profiles columns; parent = { first, last } to pair with a family
    async saveBillingProfile(id, row, parent) {
      await this.markBillingEdited();
      const body = { ...row, family_id: parent ? await this.familyIdFor(parent.first, parent.last) : (row.family_id ?? null), updated_at: new Date().toISOString() };
      return id ? must(await sb.from('billing_profiles').update(body).eq('id', id).select('*').single()) : must(await sb.from('billing_profiles').insert(body).select('*').single());
    },
    async deleteBillingProfile(id) { await this.markBillingEdited(); must(await sb.from('billing_profiles').delete().eq('id', id)); },
    async saveBillingRateCard(row) {
      await this.markBillingEdited();
      must(await sb.from('billing_rate_cards').upsert({ program: row.program, monthly_rate: row.monthly_rate, daily_rate: row.daily_rate, default_days: row.default_days, sort_order: row.sort_order || 0 }, { onConflict: 'program' }));
    },
    async saveBillingCccap(row) {
      await this.markBillingEdited();
      must(await sb.from('billing_cccap_rates').upsert({ ...row, date_updated: new Date().toISOString().slice(0, 10) }, { onConflict: 'county' }));
    },
    async deleteBillingCccap(county) { await this.markBillingEdited(); must(await sb.from('billing_cccap_rates').delete().eq('county', county)); },
    async saveBillingUpk(rows) { await this.markBillingEdited(); must(await sb.from('billing_upk_rates').upsert(rows, { onConflict: 'org,tier,program' })); },
    async saveBillingSettings(values) {
      await this.markBillingEdited();
      must(await sb.from('billing_settings').upsert(Object.keys(values).map(key => ({ key, value: Number(values[key]) })), { onConflict: 'key' }));
    },
    // ---- Family bills, monthly bills (migration 025; admin only) ----
    // false until migration 025 (the monthly bills table) has been run
    billsReady: async () => !(await sb.from('billing_bills').select('id').limit(1)).error,
    // the months that have bills, newest first
    async billMonths() {
      const rows = must(await sb.from('billing_bills').select('month_key'));
      return [...new Set(rows.map(r => r.month_key))].sort().reverse();
    },
    billsForMonth: async monthKey => must(await sb.from('billing_bills').select('*').eq('month_key', monthKey)),
    // every earlier bill (the details a new month carries forward)
    billsBefore: async monthKey => must(await sb.from('billing_bills').select('*').lt('month_key', monthKey)),
    billsInsert: async rows => must(await sb.from('billing_bills').insert(rows).select('*')),
    billSave: async (id, row) => must(await sb.from('billing_bills').update(row).eq('id', id).select('*').single()),
    // Invoiced: freezes the bill together with a copy of the child's details (the database then refuses any change)
    billInvoice: async (id, row, snapshot) => must(await sb.from('billing_bills').update({ ...row, invoiced: true, roster_snapshot: snapshot }).eq('id', id).select('*').single()),
    billUninvoice: async id => must(await sb.from('billing_bills').update({ invoiced: false }).eq('id', id).select('*').single()),
    async addClosure(date) { must(await sb.from('billing_closures').upsert({ closure_date: date }, { onConflict: 'closure_date' })); },
    async removeClosure(date) { must(await sb.from('billing_closures').delete().eq('closure_date', date)); },
    // false until migration 023 (the tables that hold a card's tasks) has been run
    cardTasksReady: async () => !(await sb.from('card_tasks').select('id').limit(1)).error,
    // Admin only: a new card in the list of switchable areas, with its owner and the project's description
    async createProjectCard({ key, label, notes, ownerId, sortOrder }) {
      must(await sb.from('access_areas').insert({ key, label, group_name: 'Projects', kind: 'card', status: 'in_progress', sort_order: sortOrder || 500 }));
      must(await sb.from('cards').upsert({ key, notes: notes || '', assigned_to: ownerId || null }, { onConflict: 'key' }));
    },
    async assignCard(key, personId) { must(await sb.from('cards').update({ assigned_to: personId || null, updated_at: new Date().toISOString() }).eq('key', key)); },

    // Creating a login and resetting a password go through the server function (it holds the secret key).
    async manage(action, body) {
      const { data, error } = await sb.functions.invoke('manage-people', { body: { action, ...body } });
      if (error) {
        let msg = error.message, answered = false;
        try { const j = await error.context.json(); if (j && j.error) { msg = j.error; answered = true; } } catch (e) { /* no answer from the function */ }
        if (!answered) msg = 'The login service did not answer. Check that the manage-people function is switched on in Supabase. (' + msg + ')';
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    },
  };
}
