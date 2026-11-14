// BUILT from tools/people-lib/ by tools/build-tracker.mjs: edit the pieces there, not this file.
// ===== PEOPLE-LIB · people-lib-01 · logins, passwords, the welcome email, Settings › Roles, which tabs and pages a person may open =====
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

// What is shown for a login: just the name (rosa.beltran), never the made-up address behind it. A real email is shown as it is.
export function loginShow(login) {
  const t = String(login || '').trim();
  const tail = '@' + LOGIN_DOMAIN;
  return t.toLowerCase().endsWith(tail) ? t.slice(0, -tail.length) : t;
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
  // A shared classroom login is not a person (no schedule, no information page) and a coach has no onboarding; the database says the same (migration 033).
  for (const k of NOT_FOR_ROLE[role] || []) if (k in out) out[k] = 0;
  return out;
}
export const NOT_FOR_ROLE = { classroom: ['my_schedule', 'my_information'], coach: ['my_information'] };

// ---- the welcome email (People plan step 7) ----
// True when a login is a real email address, so a welcome email can go to it (not a made-up login-name address).
export function hasEmailLogin(login) {
  const l = String(login || '').toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l) && !l.endsWith('@' + LOGIN_DOMAIN);
}
// What the address bar says after someone opens the email's link: 'welcome' (a working set-your-password link),
// 'expired' (the link ran out or was used already), or null (they came some other way).
export function linkResult(hash) {
  const h = String(hash || '');
  if (/error_code=otp_expired|error=access_denied/.test(h)) return 'expired';
  if (/type=(recovery|invite)/.test(h)) return 'welcome';
  return null;
}

// ---- Settings › Roles (migration 065) ----
// The built-in roles that can be changed there, in the order of the tabs. Sub has a tab too, but follows Classroom login.
export const ROLE_TABS = ['staff', 'sub', 'coach', 'assistant', 'classroom'];
// One role's levels for every page: {area_key: 0 | 1 | 2} from the role_defaults rows (no row = 0, Hide).
export function roleLevels(role, areaKeys, defaults) {
  const out = {};
  for (const k of areaKeys) out[k] = 0;
  for (const r of defaults || []) if (r.role === role && r.area_key in out) out[r.area_key] = r.level;
  return out;
}
// The pages whose level was changed: {area_key: new level}. Empty when nothing changed.
export function roleChanges(before, after) {
  const out = {};
  for (const [k, v] of Object.entries(after || {})) if ((before || {})[k] !== undefined && v !== before[k]) out[k] = v;
  return out;
}
// A custom role's levels for every page: {area_key: 0 | 1 | 2} from the custom_role_pages rows (migration 066).
export function customLevels(roleId, areaKeys, pages) {
  return roleLevels('x', areaKeys, (pages || []).filter(r => r.role_id === roleId).map(r => ({ role: 'x', area_key: r.area_key, level: r.level })));
}
// The starting rows a person follows: their custom role's pages if they have one, otherwise their role's ([{area_key, level}]).
export function startRowsFor(profile, defaults, customPages) {
  if (profile && profile.custom_role_id) return (customPages || []).filter(r => r.role_id === profile.custom_role_id).map(r => ({ area_key: r.area_key, level: r.level }));
  return (defaults || []).filter(r => r.role === (profile && profile.role)).map(r => ({ area_key: r.area_key, level: r.level }));
}
// "Edit 4 · View 1" for a group of pages; "Hidden" when every page in it is on Hide.
export function levelSummary(levels, keys) {
  let e = 0, v = 0;
  for (const k of keys) { if (levels[k] === 2) e++; else if (levels[k] === 1) v++; }
  const parts = [];
  if (e) parts.push('Edit ' + e);
  if (v) parts.push('View ' + v);
  return parts.length ? parts.join(' · ') : 'Hidden';
}
// The people with this role who have their own setting for a changed page (those keep it): [{name, areas: [area_key]}].
// people = [{id, name}], own = person_access rows [{profile_id, area_key, level}].
export function keepOwn(people, own, changedKeys) {
  const out = [];
  for (const p of people || []) {
    const areas = (own || []).filter(r => r.profile_id === p.id && changedKeys.includes(r.area_key)).map(r => r.area_key);
    if (areas.length) out.push({ name: p.name, areas });
  }
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
  'Timecards/Schedules': ['timecards', 'calendar', 'daily_flow'],
  'Playground, Gym and Laundry': ['playground_laundry', 'calendar'],
};
Object.assign(TAB_AREAS, {
  'Daily Flow': [].concat(...Object.values(PAGE_AREAS)),
  'Timecards': ['timecards'],
  'Gear': ['gear'],
  // the staff portal (staff and shared classroom logins): one tab per switch
  'My class': ['my_class', 'project_tracker', 'calendar', 'newsletter'],
  'My kids': ['my_kids', 'daily_flow'],      // the admin layout's My kids tab (admin assistants have Daily Flow); the database rules read both switches too
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

// ===== PEOPLE-LIB · people-lib-02 · Partners, the two lists of children, role names, dens =====
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

// The names roles go by on screen (People plan, picture 67; renamed 2026-11-06: "staff" is shown as Teacher, "admin" as Main admin).
export const ROLE_LABELS = {
  admin: 'Main admin', assistant: 'Admin assistant', staff: 'Teacher', sub: 'Sub', coach: 'Coach',
  classroom: 'Classroom login', parent: 'Parent (later)',
};

// ---- dens (migration 064): a person can work in more than one den ----
// Their dens as a list: the saved list, or their one den from before 064.
export function densOf(profile) {
  const list = (profile && Array.isArray(profile.dens) ? profile.dens : []).map(d => String(d || '').trim()).filter(Boolean);
  if (list.length) return list.filter((d, i) => list.indexOf(d) === i);
  const one = profile && String(profile.classroom || '').trim();
  return one ? [one] : [];
}
// Which den the page opens on: the one they picked this session if it is still theirs, otherwise their first den.
export function activeDen(dens, saved) {
  if (!dens || !dens.length) return '';
  return saved && dens.indexOf(saved) >= 0 ? saved : dens[0];
}

// ===== PEOPLE-LIB · people-lib-03 · stored documents, Schedules, how a day off is paid, Gear budgets =====
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
// "07:45" -> "7:45 AM", and "7:45 AM–4:30 PM": the one time helper (site/time-lib.js, style pass step 3)
import { clock as timeClock, range as timeRange } from './time-lib.js';
export function clockText(t) { return timeClock(t); }
const weekdayOf = date => { const p = String(date).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getDay(); };
// The hours of a row: AM and PM follow shift_types, Custom carries its own.
export function shiftHours(row, types) {
  if (row.shift === 'Custom') return { start: hhmm(row.start_time), end: hhmm(row.end_time), lunch: row.lunch_minutes == null ? 45 : row.lunch_minutes };
  const t = (types || DEFAULT_SHIFT_TYPES).find(x => x.shift === row.shift) || DEFAULT_SHIFT_TYPES.find(x => x.shift === row.shift);
  return t ? { start: hhmm(t.start_time), end: hhmm(t.end_time), lunch: t.lunch_minutes } : { start: '', end: '', lunch: 0 };
}
// "7:45 AM–4:30 PM"
export function hoursText(row, types) { const h = shiftHours(row, types); return h.start ? timeRange(h.start, h.end) : ''; }
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
// Everyone working one day, with what they are doing: { person, room, shift, slot, hours, out, half, cover, ... }.
//   leaveOf(person, date) -> null | { kind: 'out' | 'half', cover: 'name' | 'not needed' | '' } (time off, sick days)
//   changes: that day's changes for one day only (migration 086, Timecards/Schedules › Change ▾), applied after the shifts:
//     move   their shift (shift_id, or every shift they have that day) is in another den: room changes, movedFrom = the den it was in
//     hours  their shift's hours that day: hours and slot change, hoursChanged = true
//     cover  someone covers a den's AM or PM that day: a row of its own, dayCover = true
//   A change's own id is on the row as changeId (to take it back).
export function dayRoster(rows, date, types, leaveOf, changes) {
  const out = rows.filter(r => shiftActiveOn(r, date)).map(r => {
    const lv = leaveOf ? leaveOf(r.person, date) : null;
    return { person: r.person, room: r.room, shift: r.shift, slot: shiftSlot(r, types), hours: hoursText(r, types), id: r.id,
      out: !!lv && lv.kind === 'out', half: !!lv && lv.kind === 'half', cover: lv ? String(lv.cover || '').trim() : '' };
  });
  (changes || []).filter(c => String(c.change_date).slice(0, 10) === date).forEach(c => {
    const mine = out.filter(r => !r.dayCover && sameName(r.person, c.person) && (!c.shift_id || r.id === c.shift_id));
    if (c.kind === 'move') mine.forEach(r => { r.movedFrom = r.room; r.room = c.room; if (c.slot) r.slot = c.slot; r.changeId = c.id; });
    else if (c.kind === 'hours') mine.forEach(r => {
      r.hours = timeRange(c.start_time, c.end_time);
      r.slot = shiftSlot({ shift: 'Custom', start_time: c.start_time }, types); r.hoursChanged = true; r.changeId = c.id;
    });
    else if (c.kind === 'cover') {
      const h = c.start_time && c.end_time ? timeRange(c.start_time, c.end_time) : '';
      out.push({ person: c.person, room: c.room, shift: 'Cover', slot: c.slot || 'AM', hours: h, id: null, out: false, half: false, cover: '', dayCover: true, changeId: c.id });
    }
  });
  return out.sort((a, b) => a.room.localeCompare(b.room) || (a.slot === b.slot ? 0 : a.slot === 'AM' ? -1 : 1) || a.person.localeCompare(b.person));
}
// Several people covering, each with their own time (migration 087): covers = [{ person, start, end }] ("HH:MM"; empty = the whole time).
// The parts of start–end that nobody covers: [{ start, end }] ([] = all of it is covered). With no times (a whole day) start/end are ''.
export function coverGaps(start, end, covers) {
  const m = t => { const x = /^(\d{1,2}):(\d{2})/.exec(t || ''); return x ? +x[1] * 60 + +x[2] : null; };
  const hm = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const list = (covers || []).filter(c => c && String(c.person || '').trim());
  if (!list.length) return [{ start: start || '', end: end || '' }];
  const s = m(start), e = m(end);
  if (s === null || e === null) return list.some(c => !c.start) ? [] : [{ start: '', end: '' }];      // a whole day: someone for the whole of it
  const parts = list.map(c => [m(c.start) === null ? s : m(c.start), m(c.end) === null ? e : m(c.end)]).sort((a, b) => a[0] - b[0]);
  const gaps = []; let at = s;
  parts.forEach(([a, b]) => { if (a > at) gaps.push({ start: hm(at), end: hm(Math.min(a, e)) }); at = Math.max(at, b); });
  if (at < e) gaps.push({ start: hm(at), end: hm(e) });
  return gaps.filter(g => g.start < g.end);
}
// "Ann 1:45 PM–2:00 PM, Bea 2:00 PM–2:30 PM" (or just "Ann, Bea" when they cover the whole time)
export function coverWords(covers) {
  return (covers || []).filter(c => c && String(c.person || '').trim()).map(c => c.person + (c.start ? ' ' + timeRange(c.start, c.end) : '')).join(', ');
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
// The Calendar's "Working: n ▸" for one day (picture 90): each den with who is there AM and PM, then Floating and Office (listed, not
// counted as rooms). count = people working that day (out for the whole day not counted); short = den slots with a gap.
//   { dens: [{ room, AM: { names, gap }, PM: { names, gap } }], floating: { AM, PM }, office: { AM, PM }, count, short }
// names: 'Name', or 'Name (out) · Covered: Cover' when out with a cover; gap 'out' = out and no cover, 'nobody' = no one on that shift.
export function workingDay(roster, dens) {
  const slot = (room, s) => {
    const c = slotCoverage(roster, room, s);
    const names = c.present.map(r => (r.dayCover || r.movedFrom ? '↻ ' : '') + r.person + (r.half ? ' (½ day off)' : ''))      // ↻ here for the day only (086)
      .concat(c.out.filter(r => r.cover && !/^not needed$/i.test(r.cover)).map(r => r.cover + ' (for ' + r.person + ')'));
    return { names, gap: c.gap };
  };
  const both = room => ({ AM: slot(room, 'AM'), PM: slot(room, 'PM') });
  const denRows = (dens || []).map(room => Object.assign({ room }, both(room)));
  const count = new Set(roster.filter(r => !r.out).map(r => sameNameKey(r.person))).size;
  const short = denRows.reduce((n, d) => n + (d.AM.gap === 'out' ? 1 : 0) + (d.PM.gap === 'out' ? 1 : 0), 0);
  return { dens: denRows, floating: both('Float'), office: both('Office'), count, short };
}
const sameNameKey = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
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

// ===== PEOPLE-LIB · people-lib-04 · makePeopleApi (the database calls) starts: people, roles, cards, My information, Staff records, Coaching =====
export function makePeopleApi(sb) {
  return {
    profiles: async () => must(await sb.from('profiles')
      .select('id, display_name, role, custom_role_id, classroom, dens, scope, person_name, phone, contact_email, active, days_view, created_at').order('display_name')),
    areas: async () => must(await sb.from('access_areas').select('key, label, group_name, kind, status, sort_order').order('sort_order')),
    roleDefaults: async () => must(await sb.from('role_defaults').select('role, area_key, level')),
    personAccess: async id => must(await sb.from('person_access').select('area_key, level').eq('profile_id', id)),
    // Settings › Roles (migration 065): everyone's own switches for these people, saving a role's pages, and the role's recent changes
    accessOverrides: async ids => ids.length ? must(await sb.from('person_access').select('profile_id, area_key, level').in('profile_id', ids)) : [],
    saveRolePages: async (role, levels) => must(await sb.rpc('save_role_pages', { p_role: role, p_levels: levels })),
    // the recent changes of a built-in role, or of one custom role when customId is given (migration 066)
    roleChangeLog: async (role, limit, customId) => {
      let q = sb.from('role_change_log').select('changed_at, changed_by_name, area_key, old_level, new_level, people');
      q = customId ? q.eq('custom_role_id', customId) : q.eq('role', role);
      return must(await q.order('changed_at', { ascending: false }).limit(limit || 8));
    },
    // custom roles (migration 066): the roles, every role's pages, and making, changing and deleting one (main admin only)
    customRoles: async () => must(await sb.from('custom_roles').select('id, name, base_role, dens').order('name')),
    customRolePages: async () => must(await sb.from('custom_role_pages').select('role_id, area_key, level')),
    createCustomRole: async (name, base, dens) => must(await sb.rpc('create_custom_role', { p_name: name, p_base: base, p_dens: dens })),
    saveCustomRole: async (id, name, dens, levels) => must(await sb.rpc('save_custom_role', { p_id: id, p_name: name, p_dens: dens, p_levels: levels })),
    async deleteCustomRole(id) { must(await sb.rpc('delete_custom_role', { p_id: id })); },
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
      const coaches = new Set(await this.coachStaffIds());       // coaches have no onboarding checklist
      return must(prog).filter(p => !coaches.has(p.staff_id) && (!p.reviewed_at || p.reviewed_at < p.staff_marked_at))
        .map(p => ({ staff_id: p.staff_id, name: who[p.staff_id] || '', task: what[p.task_key] || p.task_key, status: p.status, date_completed: p.date_completed, marked_at: p.staff_marked_at }))
        .sort((x, y) => String(y.marked_at).localeCompare(String(x.marked_at)));
    },
    // Admin only: every credential with the person's name and employment status (for the expiring flag on Home).
    async credentialAlerts() {
      const [staff, creds] = await Promise.all([
        sb.from('staff_records').select('id, first_name, last_name, employment_status'),
        sb.from('staff_credentials').select('staff_id, credential_type, expiration_date'),
      ]);
      const coaches = new Set(await this.coachStaffIds());       // coaches have no credential tracking
      const by = {};
      must(staff).forEach(s => { by[s.id] = s; });
      return must(creds).filter(c => by[c.staff_id] && !coaches.has(c.staff_id)).map(c => ({
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
      const coachIds = await this.coachStaffIds();       // coaches: no checklist, credentials, PDIS or onboarding documents
      return { staff, tasks, progress, credentials, pdis, coachIds };
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
      // the Classroom checklist (migration 036); until that has been run these come back empty and the page says so
      const [cl, cs, cc] = await Promise.all([
        sb.from('coaching_checklist').select('*').order('created_at'),
        sb.from('coaching_checklist_subtasks').select('*').order('sort_order').order('created_at'),
        sb.from('coaching_checklist_comments').select('*').order('created_at'),
      ]);
      const checklistReady = !cl.error && !cs.error && !cc.error;
      return { goals: must(goals), links: must(links), comments: must(comments), sessions: must(sessions), meta: must(meta), actions: must(actions), items: must(items),
        checklist: checklistReady ? cl.data : [], checkSubs: checklistReady ? cs.data : [], checkComments: checklistReady ? cc.data : [], checklistReady };
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

// ===== PEOPLE-LIB · people-lib-05 · database calls: documents, Schedules, shift requests, Gear, Partners, Delegation =====
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
    // ---- Changes for one day only (migration 086): move / hours / cover, from a date on (Timecards/Schedules › Change ▾) ----
    async dayChanges(from) { return must(await sb.from('staff_day_changes').select('*').gte('change_date', from).order('change_date')); },
    async addDayChange(row) { return must(await sb.from('staff_day_changes').insert(row).select().single()); },
    async removeDayChange(id) { must(await sb.from('staff_day_changes').delete().eq('id', id)); },
    // ---- Staff calendar requests (migration 088): entries waiting for an admin's OK, from a date on; Approve; tools/tracker-calendar-requests.js ----
    async waitingEntries(from) { return must(await sb.from('week_entries').select('id, task_id, entry_date, classroom, title, notes').eq('waiting', true).gte('entry_date', from).order('entry_date')); },
    async approveEntry(id) { must(await sb.from('week_entries').update({ waiting: false }).eq('id', id)); },
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
    // ---- Delegation (migration 031) ----
    // false until migration 031 has been run
    delegationsReady: async () => !(await sb.from('delegations').select('id').limit(1)).error,
    // every row this person may see (the giver and the main admin see what they handed out, the receiver sees what was handed to them)
    delegations: async () => must(await sb.from('delegations').select('*').order('created_at', { ascending: false })),
    // the main admin hands a piece of work to an admin assistant; the names are filled in by the database
    async handOver(w) {
      return must(await sb.from('delegations').insert({
        title: String(w.title || '').trim(), note: String(w.note || '').trim(), due_date: w.dueDate || null,
        link_kind: w.linkKind || '', link_name: w.linkKind ? String(w.linkName || '').trim() : '', to_id: w.toId,
      }).select().single());
    },
    // status 'open' | 'done' | 'handed_back' (handing back needs a reason)
    async setDelegationStatus(id, status, reason) {
      must(await sb.from('delegations').update({ status, back_reason: status === 'handed_back' ? String(reason || '').trim() : '' }).eq('id', id));
    },
    // the giver hands the work to someone else: it re-opens
    async reassignDelegation(id, toId) { must(await sb.from('delegations').update({ to_id: toId }).eq('id', id)); },
    async takeBackDelegation(id) { must(await sb.from('delegations').delete().eq('id', id)); },
// ===== PEOPLE-LIB · people-lib-06 · database calls: Family bills (fees, tags, children, rates, CCCAP) =====
    // ---- Family bills (migration 024; admin only) ----
    // false until migration 024 (the family bills tables) has been run
    billingReady: async () => !(await sb.from('billing_profiles').select('id').limit(1)).error,
    billingProfiles: async () => must(await sb.from('billing_profiles').select('*').order('child_last').order('child_first')),
    billingFamilies: async () => must(await sb.from('families').select('id, parent_first, parent_last')),
    // ---- Registration fee requests (migration 043; admin only): the fee asked of the county for a new CCCAP child ----
    feeRequests: async () => must(await sb.from('billing_fee_requests').select('*')),
    async saveFeeRequest(profileId, f) {
      const row = { profile_id: profileId, fee: 'registration', county: f.county || '', amount: f.amount == null ? null : Number(f.amount), status: f.status, bill_family: !!f.bill_family, updated_at: new Date().toISOString() };
      if (f.requested_on) row.requested_on = f.requested_on;       // paid / denied keep the date it was asked
      if (f.decided_on) row.decided_on = f.decided_on;
      if (!['requested', 'paid', 'denied'].includes(row.status)) throw new Error('Choose Requested, Paid by County or Denied.');
      return must(await sb.from('billing_fee_requests').upsert(row, { onConflict: 'profile_id,fee' }).select().single());
    },
    // closed days come from the School calendar (Settings); before migration 038 they came from the list kept on Family bills
    billingRates: async () => {
      const [rateCards, cccap, upk, settings, oldClosures, cal, rules, plans, terms] = await Promise.all([
        sb.from('billing_rate_cards').select('*').order('sort_order'), sb.from('billing_cccap_rates').select('*').order('county'),
        sb.from('billing_upk_rates').select('*').order('org').order('tier').order('program'), sb.from('billing_settings').select('key, value').order('key'),
        sb.from('billing_closures').select('closure_date').order('closure_date'),
        sb.from('special_days').select('day_date, title, type').in('type', ['closure', 'holiday']).order('day_date'),
        sb.from('billing_rules').select('*').order('sort_order'),
        sb.from('billing_cccap_plans').select('*').order('county').order('starts', { ascending: false }), sb.from('billing_cccap_terms').select('*').order('county')]);       // migration 042: an older database has neither
      const hasRules = !rules.error, items = cal.error ? [] : cal.data.map(r => ({ date: String(r.day_date).slice(0, 10), title: r.title || '', type: r.type }));
      const closures = hasRules ? [...new Set(items.map(i => i.date))].sort() : must(oldClosures).map(r => r.closure_date);
      return { rateCards: must(rateCards), cccap: must(cccap), upk: must(upk), settings: must(settings), closures, closureItems: items, rules: hasRules ? rules.data : [], cccapReady: !plans.error && !terms.error, cccapPlans: plans.error ? undefined : plans.data, cccapTerms: terms.error ? undefined : terms.data };
    },
    // ---- Family bills, tags and rules (migration 038; admin only) ----
    billingTagDefs: async () => must(await sb.from('billing_tag_defs').select('*').order('sort_order').order('name')),
    billingProfileTags: async () => must(await sb.from('billing_profile_tags').select('*')),
    // a new tag (id null) or a changed one. Only a name, wording, colour and "how long" are free; a rule is chosen from the list
    async saveTagDef(id, v) {
      const row = { name: String(v.name || '').trim(), usually: v.usually || 'month', color: v.color === 'orange' ? 'orange' : 'blue', does_text: String(v.does_text || '').trim(),
        how_long: String(v.how_long || '').trim(), rule: v.rule || '' };
      if (!row.name) throw new Error('A tag needs a name.');
      return id ? must(await sb.from('billing_tag_defs').update(row).eq('id', id).select('*').single())
        : must(await sb.from('billing_tag_defs').insert({ ...row, added_by: v.added_by || 'You', manual: true, system: false }).select('*').single());
    },
    async retireTagDef(id, retired) { must(await sb.from('billing_tag_defs').update({ retired: retired !== false }).eq('id', id)); },
    // puts a tag on a child: scope 'month' (this month only; monthKey), 'every' (every month) or 'until' (untilDate)
    async addProfileTag(profileId, tagId, o) {
      const { scope, monthKey, untilDate, note, amount, staffName } = o || {};
      const row = { profile_id: profileId, tag_id: tagId, scope: scope || 'every', month_key: scope === 'month' ? monthKey : null, until_date: scope === 'until' ? untilDate || null : null, note: note || '', source: 'manual' };
      if (amount !== undefined && amount !== null) { row.amount = Number(amount); row.staff_name = String(staffName || ''); }          // the Staff child discount (migration 059)
      return must(await sb.from('billing_profile_tags').insert(row).select('*').single());
    },
    async removeProfileTag(id) { must(await sb.from('billing_profile_tags').delete().eq('id', id)); },
    // a tag that ends: the day it stops (Recurring payment stays until you give it an end date)
    async endProfileTag(id, untilDate) { must(await sb.from('billing_profile_tags').update({ scope: 'until', month_key: null, until_date: untilDate }).eq('id', id)); },
    async saveRule(key, patch) {
      const row = {}; if ('enabled' in patch) row.enabled = !!patch.enabled; if ('months' in patch) row.months = (patch.months || []).map(Number);
      must(await sb.from('billing_rules').update(row).eq('key', key));
    },
    // the late pick-ups (school year to date) and drop-ins logged on My kids, by the child's name as written there
    async billingLogged(monthKey) {
      const y = Number(monthKey.slice(0, 4)), m = Number(monthKey.slice(5, 7)), sy = (m >= 9 ? y : y - 1) + '-09-01';
      const next = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01', first = monthKey + '-01';
      const [late, drops] = await Promise.all([
        sb.from('late_pickups').select('*').gte('pickup_date', sy).lt('pickup_date', next),          // all columns: id, and waived once migration 060 has been run
        sb.from('drop_ins').select('name, drop_date').gte('drop_date', first).lt('drop_date', next)]);
      return { late: must(late), drops: must(drops) };
    },
    // a late pick-up's fee is waived (or the waiver is taken back): it still counts toward the school year's number (migration 060)
    async setLatePickupWaived(id, waived) { must(await sb.from('late_pickups').update({ waived: !!waived }).eq('id', id)); },
    // every drop-in logged from a date on (a family on hold with one coming gets a bill that month)
    async billingDropInsFrom(date) { return must(await sb.from('drop_ins').select('name, drop_date').gte('drop_date', date)); },
    // ---- the two lists of children: flags and confirming (migration 037) ----
    async ackKidFlag(kidId) { must(await sb.rpc('ack_kid_flag', { p_kid: kidId })); },
    async confirmChildRoster(kidId) { must(await sb.rpc('confirm_child_roster', { p_kid: kidId })); },
    // siblings: linked children share a group; the younger ones get the Sibling discount by themselves (migration 049)
    async linkSibling(profileId, otherId) { must(await sb.rpc('billing_link_sibling', { p_a: profileId, p_b: otherId })); },
    async unlinkSibling(profileId) { must(await sb.rpc('billing_unlink_sibling', { p_id: profileId })); },
    // the days picked on the Kids roster, confirmed on the Roster record (migration 048); days = ['mon'..'fri'], null = the ones the Kids roster has
    async confirmChildDays(profileId, days) { must(await sb.rpc('billing_confirm_days', { p_profile: profileId, p_days: days || null })); },
    // one child's Change History: the dated changes (den, days, schedule, status), the Update Procare tasks, and who made them (migrations 044, 045)
    async childHistory(kidId) {
      if (!kidId) return { changes: [], procare: [], names: {} };
      const [c, t, n] = await Promise.all([
        sb.from('child_enrollment_changes').select('id, field, value, starts_on, until, note, source, entered_by, entered_at').eq('kid_id', kidId).order('entered_at', { ascending: false }),
        sb.from('procare_tasks').select('id, what, starts_on, done_at, created_at').eq('kid_id', kidId),
        sb.from('profiles').select('id, display_name, person_name')]);
      const names = {}; (n.data || []).forEach(x => { names[x.id] = x.person_name || x.display_name || ''; });
      return { changes: c.error ? [] : (c.data || []), procare: t.error ? [] : (t.data || []), names };
    },
    // archives the children whose Last month has passed; returns who was moved
    async runMonthlyRules() { return must(await sb.rpc('billing_run_monthly_rules')) || []; },
    // the children in My kids, for the match screen
    billingKids: async () => must(await sb.from('kids').select('id, name, classroom, birthday, days, program, start_date, status, confirm_roster, billing_changed_note, billing_changed_at').order('name')),
    // pair a billing child with a My kids child (kidId null = unpair)
    async matchBillingProfile(profileId, kidId) {
      must(await sb.from('billing_profiles').update({ kid_id: kidId || null, updated_at: new Date().toISOString() }).eq('id', profileId));
    },
    // add the billing child to My kids (name, birthday, den and the weekdays of the program) and pair them
    async addKidFromProfile(profile) {
      // the database makes the My kids side and links it (migrations 037 and 038)
      const D2 = { '5-Day': ['mon', 'tue', 'wed', 'thu', 'fri'], '4-Day': ['mon', 'tue', 'wed', 'thu'], '3-Day': ['mon', 'wed', 'fri'], '2-Day': ['tue', 'thu'] };
      const K2 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const days2 = (profile.custom_days || []).length ? (profile.custom_days || []).map(n => K2[n]).filter(k => k && k !== 'sun' && k !== 'sat') : (D2[profile.program] || []);
      return must(await sb.rpc('billing_add_kid_from_profile', { p_profile: profile.id, p_days: days2 }));
    },
    // change the details a My kids child and the matched billing child share (the Match children bar on My kids; admin only): only these four
    async updateBillingProfile(profileId, patch) {
      const row = { updated_at: new Date().toISOString() };
      for (const k of ['child_first', 'child_last', 'room', 'dob']) if (k in (patch || {})) row[k] = k === 'dob' ? (patch[k] || null) : String(patch[k] || '').trim();
      must(await sb.from('billing_profiles').update(row).eq('id', profileId));
      // the HQ import must be told that the platform has been edited (migration 026); before that migration there is nothing to tell
      try { await sb.from('billing_meta').upsert({ key: 'edited_in_platform', value: 'yes', updated_at: new Date().toISOString() }, { onConflict: 'key' }); } catch (e) { /* migration 026 not run yet */ }
    },
    // ---- Family bills, editing the children and rates (migration 026; admin only) ----
    // false until migration 026 has been run (editing is switched off until then, because the HQ import must be told when the platform is edited)
    // billing_meta: small named notes (admin only)
    billingMetaGet: async key => { const rows = must(await sb.from('billing_meta').select('value').eq('key', key).limit(1)); return rows && rows[0] ? rows[0].value : null; },
    async billingMetaSet(key, value) { must(await sb.from('billing_meta').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })); },
    // bill notes and the log of edits (migration 052): a note is its own row, saved when it is added
    billingNotes: async () => must(await sb.from('billing_notes').select('*').order('created_at', { ascending: false })),
    async addBillingNote(n) { return must(await sb.from('billing_notes').insert({ profile_id: n.profile_id, month_key: n.month_key || '', body: n.body, carry: !!n.carry, created_by_name: n.by || '' }).select('*').single()); },
    async saveBillingNote(id, patch, quiet) { return must(await sb.from('billing_notes').update(quiet ? patch : { ...patch, edited_at: new Date().toISOString() }).eq('id', id).select('*').single()); },
    // a note ticked "Show on next month's bill" sets that child's next open bill to Needs Review (if Liz had marked it Ready); returns the bill it changed, or null
    async billingBillToReview(profileId, afterMonth) {
      const rows = must(await sb.from('billing_bills').select('id, month_key, billing_status').eq('profile_id', profileId).eq('invoiced', false).gt('month_key', afterMonth).order('month_key', { ascending: true }).limit(1));
      const r = rows && rows[0]; if (!r || r.billing_status !== 'Ready') return null;
      return must(await sb.from('billing_bills').update({ billing_status: 'Not Started' }).eq('id', r.id).select('*').single());
    },
    async removeBillingNote(id) { must(await sb.from('billing_notes').delete().eq('id', id)); },
    // one line in the Change History: kind (credit, fee, note, drop-in ...), action (added | edited | removed), what, before and after
    async logBillingChange(e) { must(await sb.from('billing_edit_log').insert({ profile_id: e.profile_id || null, child_name: e.child_name || '', month_key: e.month_key || '', kind: e.kind || '', action: e.action, what: e.what || '', before_text: e.before || '', after_text: e.after || '', by_name: e.by || '' })); },
    billingEditLog: async () => must(await sb.from('billing_edit_log').select('*').order('created_at', { ascending: false }).limit(1000)),
    // corrections on invoiced bills (migration 053) and the CCCAP renewal tracker (migration 054)
    billingCorrections: async () => must(await sb.from('billing_corrections').select('*').order('made_at', { ascending: true })),
    async addBillingCorrection(c) { return must(await sb.from('billing_corrections').insert({ profile_id: c.profile_id, from_month: c.from_month, kind: c.kind, amount: c.amount, reason: c.reason, mode: c.mode || 'next_bill', made_by_name: c.by || '' }).select('*').single()); },
    async saveBillingCorrection(id, patch) { return must(await sb.from('billing_corrections').update(patch).eq('id', id).select('*').single()); },
    // Office Events (migration 055): read and written by the people on them and the admin team (the database decides who sees what)
    officeEventsOn: async day => must(await sb.from('office_events').select('*').eq('event_date', day).order('start_time', { ascending: true })),
    async addOfficeEvent(e) { const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : undefined; must(await sb.from('office_events').insert({ ...(id ? { id } : {}), title: e.title, people: e.people, event_date: e.event_date, all_day: !!e.all_day, start_time: e.start_time || '', end_time: e.end_time || '', notes: e.notes || '', created_by_name: e.by || '' })); return id; },
    async saveOfficeEvent(id, e) { must(await sb.from('office_events').update({ title: e.title, people: e.people, event_date: e.event_date, all_day: !!e.all_day, start_time: e.start_time || '', end_time: e.end_time || '', notes: e.notes || '', updated_at: new Date().toISOString() }).eq('id', id)); },
    async deleteOfficeEvent(id) { must(await sb.from('office_events').delete().eq('id', id)); },
    // Office events paired with tasks (migration 089; tools/office-event/): the pairs of some blocks, the blocks from a date on that some
    // tasks are in (for My to-do's "In [block] · [day time]"), and setting a block's tasks
    async officeEventTasks(eventIds) { return eventIds.length ? must(await sb.from('office_event_tasks').select('event_id, task_id').in('event_id', eventIds)) : []; },
    async officeBlocksOfTasks(taskIds, from) {
      if (!taskIds.length) return [];
      const pairs = must(await sb.from('office_event_tasks').select('event_id, task_id').in('task_id', taskIds));
      const ids = [...new Set(pairs.map(p => p.event_id))];
      if (!ids.length) return [];
      const evs = must(await sb.from('office_events').select('id, title, event_date, start_time, all_day').in('id', ids).gte('event_date', from));
      return pairs.map(p => ({ task_id: p.task_id, ev: evs.find(e => e.id === p.event_id) })).filter(p => p.ev);
    },
    async setOfficeEventTasks(eventId, taskIds) {
      const had = must(await sb.from('office_event_tasks').select('task_id').eq('event_id', eventId)).map(r => r.task_id);
      const gone = had.filter(t => !taskIds.includes(t)), add = taskIds.filter(t => !had.includes(t));
      if (gone.length) must(await sb.from('office_event_tasks').delete().eq('event_id', eventId).in('task_id', gone));
      if (add.length) must(await sb.from('office_event_tasks').insert(add.map(t => ({ event_id: eventId, task_id: t }))));
    },
    cccapRenewals: async () => must(await sb.from('cccap_renewals').select('*').order('auth_ends', { ascending: true })),
    async saveCccapRenewal(r) { return must(await sb.from('cccap_renewals').upsert(r, { onConflict: 'profile_id,auth_ends' }).select('*').single()); },
    async addProcareTask(t) { must(await sb.rpc('add_procare_task', { p_kid: t.kid || null, p_name: t.name || '', p_what: t.what || '', p_starts: t.starts || null })); },
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
    // changes only the columns given (the Family bills Roster and a bill's Pays by use this); the flags are cleared with ackProfileFlag
    async patchBillingProfile(id, patch) { await this.markBillingEdited(); return must(await sb.from('billing_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()); },
    async ackProfileFlag(id) { must(await sb.from('billing_profiles').update({ kids_changed_note: '', kids_changed_at: null, kids_changed_by: null }).eq('id', id)); },
    async deleteBillingProfile(id) { await this.markBillingEdited(); must(await sb.from('billing_profiles').delete().eq('id', id)); },
    async saveBillingRateCard(row) {
      await this.markBillingEdited();
      must(await sb.from('billing_rate_cards').upsert({ program: row.program, monthly_rate: row.monthly_rate, daily_rate: row.daily_rate, default_days: row.default_days, sort_order: row.sort_order || 0 }, { onConflict: 'program' }));
    },
    async saveBillingCccap(row) {
      await this.markBillingEdited();
      must(await sb.from('billing_cccap_rates').upsert({ ...row, date_updated: new Date().toISOString().slice(0, 10) }, { onConflict: 'county' }));
    },
    // ---- CCCAP county rates by start date, what each county pays, authorizations, the Drive updates (migration 042; admin only) ----
    async saveCccapPlan(row) {
      await this.markBillingEdited();
      const r = { county: String(row.county || '').trim(), rate_type: row.rate_type === 'Out-of-County' ? 'Out-of-County' : 'Regular', starts: row.starts, tier: Number(row.tier) || 4, plan_url: String(row.plan_url || ''),
        infant_rate: Number(row.infant_rate) || 0, toddler_rate: Number(row.toddler_rate) || 0, preschool_rate: Number(row.preschool_rate) || 0, school_age_rate: Number(row.school_age_rate) || 0 };
      if (!r.county || !r.starts) throw new Error('A rate plan needs a county and the date it starts.');
      return must(await sb.from('billing_cccap_plans').upsert(r, { onConflict: 'county,starts' }).select('*').single());
    },
    async deleteCccapPlan(id) { await this.markBillingEdited(); must(await sb.from('billing_cccap_plans').delete().eq('id', id)); },
    async saveCccapTerms(row) {
      await this.markBillingEdited();
      const n = v => (v === '' || v == null) ? null : Number(v);
      const r = { county: row.county, absences_per_month: Number(row.absences_per_month) || 0, paid_holidays: row.paid_holidays || [], drop_in_per_month: n(row.drop_in_per_month), hold_slots: n(row.hold_slots),
        registration_fee_year: n(row.registration_fee_year), activity_fee_year: n(row.activity_fee_year), transportation: !!row.transportation, agreement_ends: row.agreement_ends || null };
      must(await sb.from('billing_cccap_terms').upsert(r, { onConflict: 'county' }));
    },
    // what the daily Drive reader found: waiting for approval (newest first), and the links that match a name on a PDF to a child
    cccapUpdates: async () => must(await sb.from('cccap_updates').select('*').in('status', ['pending', 'unreadable']).order('found_at', { ascending: false })),
    cccapNameLinks: async () => must(await sb.from('cccap_name_links').select('*')),
    cccapReminders: async () => must(await sb.from('cccap_reminders').select('*')),
    async decideCccapUpdate(id, status, userId) { must(await sb.from('cccap_updates').update({ status, decided_at: new Date().toISOString(), decided_by: userId || null }).eq('id', id)); },
    async linkCccapName(alias, profileId) { must(await sb.from('cccap_name_links').upsert({ alias, profile_id: profileId }, { onConflict: 'alias' })); },
    async saveCccapReminder(key, remindOn, done) { must(await sb.from('cccap_reminders').upsert({ key, remind_on: remindOn || null, done: !!done }, { onConflict: 'key' })); },
    async deleteBillingCccap(county) { await this.markBillingEdited(); must(await sb.from('billing_cccap_rates').delete().eq('county', county)); },
    async saveBillingUpk(rows) { await this.markBillingEdited(); must(await sb.from('billing_upk_rates').upsert(rows, { onConflict: 'org,tier,program' })); },
    async saveBillingSettings(values) {
      await this.markBillingEdited();
      must(await sb.from('billing_settings').upsert(Object.keys(values).map(key => ({ key, value: Number(values[key]) })), { onConflict: 'key' }));
    },
// ===== PEOPLE-LIB · people-lib-07 · database calls: monthly bills, My kids week grid, Google Calendar import, Subs, and the end =====
    // ---- Family bills, monthly bills (migration 025; admin only) ----
    // the months that have bills, newest first
    async billMonths() {
      const rows = must(await sb.from('billing_bills').select('month_key'));
      return [...new Set(rows.map(r => r.month_key))].sort().reverse();
    },
    billsForMonth: async monthKey => must(await sb.from('billing_bills').select('*').eq('month_key', monthKey)),
    // every earlier bill (the details a new month carries forward)
    billsBefore: async monthKey => must(await sb.from('billing_bills').select('*').lt('month_key', monthKey)),
    // who has a bill in which month, from a month on (the "no bill yet" notice looks at every open month, not just the one on screen)
    billChildMonths: async fromMonth => must(await sb.from('billing_bills').select('month_key, profile_id, invoiced').gte('month_key', fromMonth)),
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

    // What is on file for a person, as [{label, count}] (migration 033). Empty means they can be deleted; anything else means archive instead.
    async personHistory(id) { const h = must(await sb.rpc('person_history', { p_id: id })); return Array.isArray(h) ? h : []; },
    // The Staff Tracker records that belong to coaches (migration 033); they get no checklist, credentials or PDIS. Empty before 033 is run.
    async coachStaffIds() { try { const { data, error } = await sb.rpc('coach_staff_ids'); return error ? [] : (data || []).map(x => (x && typeof x === 'object') ? Object.values(x)[0] : x); } catch (e) { return []; } },
    // Every list of names (Your name, Covered by, Assigned to, the Daily Flow rows) reads People (migration 034): [{name, role}] for active admins,
    // admin assistants, staff and coaches with a "Name on the schedule". Returns null when it cannot be read (034 not run yet), so the page keeps its old list.
    async schedulePeople() {
      const { data, error } = await sb.rpc('schedule_people');
      if (error || !Array.isArray(data)) return null;
      return data.filter(r => r && String(r.name || '').trim()).map(r => ({ name: String(r.name).trim(), role: r.role }));
    },
    // The five dens with their ages and daily maximums, for the Settings page (migration 034; view only).
    async densInfo() { return must(await sb.from('classrooms').select('name, age_range, daily_max').order('sort_order')); },
    // ---- My kids week grid, dated changes and Update Procare tasks (migrations 044, 045) ----
    async enrollmentOverview() { return must(await sb.rpc('enrollment_overview')); },
    // brings the roster up to date: a change that has reached its day is put on the Kids roster
    async applyDueEnrollment() { try { const r = await sb.rpc('apply_due_enrollment'); return r.error ? 0 : (r.data || 0); } catch (e) { return 0; } },
    // changes: { den, days: ['mon'..], program, status: 'on_hold'|'active'|'archived' }; startsOn 'YYYY-MM-DD'; until = tentative return day of a hold; what = words for the Procare task ('' = no task)
    async saveEnrollmentChanges(kidId, changes, startsOn, opts) {
      const o = opts || {};
      must(await sb.rpc('save_enrollment_changes', { p_kid: kidId, p_changes: changes, p_starts_on: startsOn || null, p_until: o.until || null, p_note: o.note || '', p_what: o.what || null, p_source: o.source || 'my_kids', p_transition: o.transition || null }));
    },
    async cancelEnrollmentChange(id) { must(await sb.rpc('cancel_enrollment_change', { p_id: id })); },
    async confirmTransition(id) { must(await sb.rpc('confirm_transition', { p_id: id })); },
    async procareTasks() { const r = await sb.from('procare_tasks').select('id, child_name, what, starts_on, source, created_at, done_at').is('done_at', null).order('starts_on').order('created_at'); return r.error ? [] : (r.data || []); },
    async markProcareDone(id) { must(await sb.rpc('mark_procare_done', { p_id: id })); },
    async setProcareOwner(profileId) { must(await sb.rpc('set_procare_owner', { p_id: profileId || null })); },
    // Settings: what a den's ages are and what the next den looks for
    async saveDenAges(name, v) {
      must(await sb.from('classrooms').update({ age_min_months: v.ageMin === '' || v.ageMin == null ? null : Number(v.ageMin), age_max_months: v.ageMax === '' || v.ageMax == null ? null : Number(v.ageMax),
        expectations: String(v.expectations || ''), milestones: Array.isArray(v.milestones) ? v.milestones : [] }).eq('name', name));
    },
    async denAges() { const r = await sb.from('classrooms').select('name, sort_order, daily_max, age_min_months, age_max_months, expectations, milestones').order('sort_order'); return r.error ? [] : (r.data || []); },
    async saveEnrollmentLeadTimes(weeks, months) {
      must(await sb.from('app_settings').upsert([{ key: 'transitionConfirmWeeks', value: Number(weeks) || 2 }, { key: 'ageCheckMonths', value: Number(months) || 3 }], { onConflict: 'key' }));
    },
    // My kids notes and questions on a new child's start or a transition (migration 092): teachers add, the admin team replies and marks reviewed.
    // kind = 'new_child' | 'transition'; eventId = the child's or the transition's id. The database decides who sees and does what.
    async myKidsNotes() { const r = await sb.from('my_kids_event_notes').select('*').order('created_at'); if (r.error) throw r.error; return r.data || []; },
    async addMyKidsNote(kind, eventId, child, den, body) { const r = await sb.rpc('add_my_kids_note', { p_kind: kind, p_event_id: String(eventId), p_child: child || '', p_den: den || '', p_body: body }); if (r.error) throw r.error; return r.data; },
    async replyMyKidsNote(id, reply) { must(await sb.rpc('reply_my_kids_note', { p_id: id, p_reply: reply })); },
    async reviewMyKidsNote(id) { must(await sb.rpc('review_my_kids_note', { p_id: id })); },
    // Settings › Dens: how many weeks ahead each My kids icon shows (migration 091). 0 = the week of; blank keeps Liz's starting numbers.
    async saveMyKidsIconWeeks(move, vacation, dropIn) {
      const n = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Math.max(0, Math.round(Number(v))));
      must(await sb.from('app_settings').upsert([{ key: 'myKidsMoveIconWeeks', value: n(move, 3) }, { key: 'myKidsVacationIconWeeks', value: n(vacation, 1) }, { key: 'myKidsDropInIconWeeks', value: n(dropIn, 0) }], { onConflict: 'key' }));
    },
    // ----- Google Calendar import (migration 046; the Edge Function calendar-feeds) -----
    // Settings (admin only): the links are written and removed here, never read back. A calendar is listed by name only.
    async calendarFeeds() { const r = await sb.from('calendar_feeds').select('id, name, enabled, created_at').order('created_at'); return r.error ? null : (r.data || []); },      // null = 046 not run yet
    async addCalendarFeed(name, url) { must(await sb.from('calendar_feeds').insert({ name: String(name || '').trim(), url: String(url || '').trim() })); },
    async saveCalendarFeed(id, v) {
      const patch = {};
      if (v.name !== undefined) patch.name = String(v.name).trim();
      if (v.enabled !== undefined) patch.enabled = !!v.enabled;
      if (v.url) patch.url = String(v.url).trim();
      must(await sb.from('calendar_feeds').update(patch).eq('id', id));
    },
    async removeCalendarFeed(id) { must(await sb.from('calendar_feeds').delete().eq('id', id)); },
    // The review box: who may review, what was decided, the events themselves (through the Edge Function), and the decisions
    async calendarFeedNames() { const r = await sb.rpc('calendar_feed_names'); return r.error ? [] : (r.data || []); },
    async canReviewCalendar() { const { data, error } = await sb.rpc('can_review_calendar'); return !error && data === true; },
    async calendarDecisions() { const r = await sb.from('calendar_events').select('feed_id, event_key, status, entry_id, title, event_date, time_text, hash, changed, new_title, new_date, new_time, new_hash'); return r.error ? [] : (r.data || []); },
    async calendarEvents(from, to) {
      const { data, error } = await sb.functions.invoke('calendar-feeds', { body: { from, to } });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* no answer from the function */ }
        throw new Error(msg);
      }
      if (!data || data.ok === false) throw new Error((data && data.error) || 'The calendar service did not answer');
      return data.feeds || [];
    },
    async calendarDecide(feed, key, status, entryId, ev) {
      must(await sb.rpc('calendar_decide', { p_feed: feed, p_key: key, p_status: status, p_entry: entryId || null, p_title: ev.title || '', p_date: ev.date || null, p_time: ev.timeText || '', p_hash: ev.hash || '' }));
    },
    async calendarUnskip(feed, key) { must(await sb.rpc('calendar_unskip', { p_feed: feed, p_key: key })); },
    async calendarFlagChange(feed, key, ev) { must(await sb.rpc('calendar_flag_change', { p_feed: feed, p_key: key, p_hash: ev.hash, p_title: ev.title, p_date: ev.date, p_time: ev.timeText || '' })); },
    async calendarResolve(feed, key, action) { must(await sb.rpc('calendar_resolve', { p_feed: feed, p_key: key, p_action: action })); },
    async adminTeam() { const r = await sb.from('profiles').select('id, display_name, person_name, role, active').in('role', ['admin', 'assistant']).eq('active', true).order('display_name'); return r.error ? [] : (r.data || []); },
    // Children with CCCAP who are scheduled to attend on a weekday (mon..fri), names and dens only (migration 036; admin and admin assistants only).
    // Returns null when it cannot be read (036 not run yet, or this person may not see it).
    async cccapToday(dayKey) {
      const { data, error } = await sb.rpc('cccap_children_today', { day_key: dayKey });
      if (error || !Array.isArray(data)) return null;
      return data.map(r => ({ name: String(r.child_name || '').trim(), den: String(r.den || '').trim(), unsure: !!r.days_unknown })).filter(r => r.name);
    },
    // The cards on a person's Home bookshelf (migration 035): an array of card names (up to 5, maybe none), or null when they have not chosen yet
    // (or 035 has not been run), so the page falls back to the first cards they hold.
    async homeShelf(id) {
      const { data, error } = await sb.from('home_shelf').select('cards').eq('profile_id', id).maybeSingle();
      if (error || !data || !Array.isArray(data.cards)) return null;
      return data.cards.map(String);
    },
    async saveHomeShelf(id, cards) {
      const list = (cards || []).map(String).filter(Boolean).slice(0, 5);
      must(await sb.from('home_shelf').upsert({ profile_id: id, cards: list, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' }));
      return list;
    },
    // Archive: the login is switched off and the person leaves the lists; everything stays and they can be brought back.
    async archivePerson(id) { must(await sb.from('profiles').update({ active: false }).eq('id', id)); },
    async restorePerson(id) { must(await sb.from('profiles').update({ active: true }).eq('id', id)); },
    // Delete for good: person and login (server function; it checks the history again and refuses if there is any).
    async deletePerson(id) { return this.manage('delete', { id }); },

    // ---- Subs (migration 063, People plan step 2): a name, a phone and the dens they usually cover; no login ----
    // Every sub, archived ones too (the People page; People on View).
    async subs() { return must(await sb.from('subs').select('id, name, phone, dens, active').order('name')); },
    // The names of active subs, for the Covered by drop-downs and the Your name box (everyone signed in).
    async subNames() {
      const { data, error } = await sb.rpc('sub_names');
      if (error || !Array.isArray(data)) return [];
      return data.map(r => String(r.name || '').trim()).filter(Boolean);
    },
    async addSub(s) { return must(await sb.from('subs').insert({ name: s.name, phone: s.phone || null, dens: s.dens || [] }).select('id').single()); },
    async updateSub(id, patch) { must(await sb.from('subs').update(patch).eq('id', id)); },
    async archiveSub(id) { must(await sb.from('subs').update({ active: false }).eq('id', id)); },
    async restoreSub(id) { must(await sb.from('subs').update({ active: true }).eq('id', id)); },
    async deleteSub(id) { must(await sb.from('subs').delete().eq('id', id)); },

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
