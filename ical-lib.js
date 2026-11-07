// Google Calendar events out of a calendar's "secret address in iCal format" (.ics text). Plain functions with no page code in them, so they can be
// tested on their own (tests/ical-lib.test.mjs). Used by the Review calendar events box on the Daily tasks tab (tools/tracker-calendar-review.js).
//
//   parseEvents(ics, { from, to, zone })   every event that STARTS from..to (YYYY-MM-DD, both included), repeating events expanded, cancelled ones and
//                                          deleted single days left out. Times are shown in `zone` (default America/Denver).
//     -> [{ key, uid, title, date, endDate, allDay, start, end, timeText, location, description, hash }]
//        key   stays the same when the event is edited in Google (the event's id; for a repeating event also which day of it), so a decision sticks
//        hash  changes when the title, day, time or place changes: that is how a later change in Google is noticed
//        start / end  "HH:MM" for a timed event, '' for an all-day one; endDate is the last day of a multi-day event
//   reviewList(feedId, events, decisions)  sorts a feed's events into what is new, skipped, added and unchanged, added and changed in Google
//   timeLabel(start, end)                  "6:00 pm" / "6:00 - 7:30 pm", the same words the Add entry popup stores
//
// Not supported (Google does not use them for ordinary calendars): RRULE with BYWEEKNO / BYYEARDAY / BYHOUR, and a repeating event whose first day is not
// one of its own repeat days. Repeats that go on forever are cut off at `to`.

const DEFAULT_ZONE = 'America/Denver';
const DAYNUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// ---------- dates (YYYY-MM-DD text, worked out in UTC so a daylight-saving change never moves a day) ----------
const pad = n => (n < 10 ? '0' : '') + n;
const ymd = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const toUtc = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUtc = ms => { const d = new Date(ms); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
export const addDays = (s, n) => fromUtc(toUtc(s) + n * 86400000);
const weekday = s => new Date(toUtc(s)).getUTCDay();
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const isWeekend = s => { const w = weekday(s); return w === 0 || w === 6; };

// ---------- time zones ----------
const fmtCache = {};
function wallFields(ms, tz) {                       // the clock on a wall in `tz` at this moment: { y, m, d, h, mi }
  let f = fmtCache[tz];
  if (!f) f = fmtCache[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = {}; f.formatToParts(new Date(ms)).forEach(p => { o[p.type] = +p.value; });
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute };
}
function wallToUtc(y, m, d, h, mi, tz) {            // the moment a wall in `tz` shows this time
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 3; i++) { const w = wallFields(t, tz); t += guess - Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi); }
  return t;
}
function validZone(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (e) { return false; } }

// ---------- reading the file ----------
function unfold(text) { return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, ''); }
function unescapeText(v) { return String(v || '').replace(/\\([nN])/g, '\n').replace(/\\([,;\\])/g, '$1'); }
function parseLine(line) {                          // NAME;PARAM=value;PARAM="v:v":value
  let inQ = false, colon = -1;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') inQ = !inQ; else if (c === ':' && !inQ) { colon = i; break; } }
  if (colon < 0) return null;
  const head = line.slice(0, colon), value = line.slice(colon + 1);
  const parts = []; let cur = '', q = false;
  for (const c of head) { if (c === '"') q = !q; if (c === ';' && !q) { parts.push(cur); cur = ''; } else cur += c; }
  parts.push(cur);
  const params = {};
  parts.slice(1).forEach(p => { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, ''); });
  return { name: parts[0].toUpperCase(), params, value };
}
function rawEvents(ics) {                           // every VEVENT as { props: { NAME: [{ params, value }] } }
  const out = []; let cur = null, depth = 0;
  for (const line of unfold(ics).split('\n')) {
    const up = line.trim().toUpperCase();
    if (up === 'BEGIN:VEVENT') { cur = { props: {} }; depth = 0; continue; }
    if (!cur) continue;
    if (up === 'END:VEVENT') { out.push(cur); cur = null; continue; }
    if (up.startsWith('BEGIN:')) { depth++; continue; }       // a reminder inside the event: ignore everything in it
    if (up.startsWith('END:')) { depth--; continue; }
    if (depth > 0) continue;
    const p = parseLine(line); if (!p) continue;
    (cur.props[p.name] = cur.props[p.name] || []).push({ params: p.params, value: p.value });
  }
  return out;
}
const first = (ev, name) => (ev.props[name] && ev.props[name][0]) || null;

// A date or date-time property as { date, min (minutes after midnight, null for all-day), allDay }, shown on the wall of `zone`.
function readWhen(p, zone) {
  if (!p) return null;
  const v = String(p.value).trim(), m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (m[4] === undefined || (p.params.VALUE || '').toUpperCase() === 'DATE') return { date: ymd(y, mo, d), min: null, allDay: true };
  const h = +m[4], mi = +m[5];
  if (m[7]) { const w = wallFields(Date.UTC(y, mo - 1, d, h, mi), zone); return { date: ymd(w.y, w.m, w.d), min: w.h * 60 + w.mi, allDay: false }; }
  const tz = p.params.TZID;
  if (tz && tz !== zone && validZone(tz)) { const w = wallFields(wallToUtc(y, mo, d, h, mi, tz), zone); return { date: ymd(w.y, w.m, w.d), min: w.h * 60 + w.mi, allDay: false }; }
  return { date: ymd(y, mo, d), min: h * 60 + mi, allDay: false };
}
function parseDuration(v) {                          // PT1H30M, P1D, P1W -> minutes
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const mins = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0));
  return m[1] === '-' ? -mins : mins;
}
function readRule(v) {
  const r = {}; String(v || '').split(';').forEach(kv => { const i = kv.indexOf('='); if (i > 0) r[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1); });
  return r;
}
const dayList = s => String(s || '').split(',').map(x => { const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim()); return m ? { n: m[1] ? +m[1] : 0, wd: DAYNUM[m[2].toUpperCase()] } : null; }).filter(Boolean);
const numList = s => String(s || '').split(',').map(x => parseInt(x, 10)).filter(n => !isNaN(n));

// ---------- repeating events ----------
// Every date a rule produces from its first day until `to` (never more than `cap` of them).
function expandRule(rule, startDate, to, zone) {
  const freq = (rule.FREQ || '').toUpperCase(), interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1), count = rule.COUNT ? parseInt(rule.COUNT, 10) : Infinity;
  let until = to;
  if (rule.UNTIL) { const u = readWhen({ params: {}, value: rule.UNTIL }, zone); if (u && u.date < until) until = u.date; }
  const byday = dayList(rule.BYDAY), bymd = numList(rule.BYMONTHDAY), bymo = numList(rule.BYMONTH), bysetpos = numList(rule.BYSETPOS);
  const wkst = rule.WKST && DAYNUM[rule.WKST.toUpperCase()] !== undefined ? DAYNUM[rule.WKST.toUpperCase()] : 1;
  const sy = +startDate.slice(0, 4), sm = +startDate.slice(5, 7), sd = +startDate.slice(8, 10), swd = weekday(startDate);
  const out = []; let guard = 0;
  const push = ds => { if (ds >= startDate && ds <= until && out.length < count) out.push(ds); };
  const monthDays = (y, m) => {                      // the days of one month the rule picks
    const last = daysInMonth(y, m); let days = [];
    if (bymd.length) bymd.forEach(n => { const dd = n > 0 ? n : last + 1 + n; if (dd >= 1 && dd <= last) days.push(dd); });
    if (byday.length) {
      const hit = [];
      byday.forEach(b => {
        const all = []; for (let dd = 1; dd <= last; dd++) if (weekday(ymd(y, m, dd)) === b.wd) all.push(dd);
        if (!b.n) hit.push(...all); else { const i = b.n > 0 ? b.n - 1 : all.length + b.n; if (all[i]) hit.push(all[i]); }
      });
      days = bymd.length ? days.filter(dd => hit.includes(dd)) : hit;
    }
    if (!bymd.length && !byday.length) days = sd <= last ? [sd] : [];
    days = [...new Set(days)].sort((a, b) => a - b);
    if (bysetpos.length) days = bysetpos.map(p => days[p > 0 ? p - 1 : days.length + p]).filter(Boolean).sort((a, b) => a - b);
    return days;
  };
  if (freq === 'DAILY') {
    for (let ds = startDate; ds <= until && out.length < count && guard++ < 40000; ds = addDays(ds, interval)) {
      if (byday.length && !byday.some(b => b.wd === weekday(ds))) continue;
      if (bymo.length && !bymo.includes(+ds.slice(5, 7))) continue;
      push(ds);
    }
  } else if (freq === 'WEEKLY') {
    const wds = byday.length ? byday.map(b => b.wd) : [swd];
    let weekStart = addDays(startDate, -((swd - wkst + 7) % 7));
    for (; weekStart <= until && out.length < count && guard++ < 6000; weekStart = addDays(weekStart, 7 * interval)) {
      wds.map(w => (w - wkst + 7) % 7).sort((a, b) => a - b).forEach(off => push(addDays(weekStart, off)));
    }
  } else if (freq === 'MONTHLY') {
    let y = sy, m = sm;
    for (; ymd(y, m, 1) <= until && out.length < count && guard++ < 2400; m += interval) {
      while (m > 12) { m -= 12; y++; }
      if (bymo.length && !bymo.includes(m)) continue;
      monthDays(y, m).forEach(dd => push(ymd(y, m, dd)));
    }
  } else if (freq === 'YEARLY') {
    const months = bymo.length ? bymo : [sm];
    for (let y = sy; ymd(y, 1, 1) <= until && out.length < count && guard++ < 400; y += interval) {
      months.slice().sort((a, b) => a - b).forEach(m => monthDays(y, m).forEach(dd => push(ymd(y, m, dd))));
    }
  } else push(startDate);
  return out;
}

// ---------- one event ----------
function hashOf(parts) { const s = parts.join('\u0001'); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + s.length.toString(36); }
export function timeLabel(start, end) {              // "13:15", "14:15" -> "1:15 - 2:15 pm"
  const one = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); if (!m) return null; const h = +m[1]; return { clock: ((h % 12) || 12) + ':' + m[2], period: h >= 12 ? 'pm' : 'am' }; };
  const a = one(start), b = one(end);
  if (!a) return '';
  if (!b) return a.clock + ' ' + a.period;
  return a.period === b.period ? a.clock + ' – ' + b.clock + ' ' + b.period : a.clock + ' ' + a.period + ' – ' + b.clock + ' ' + b.period;
}
const hhmm = min => pad(Math.floor(min / 60)) + ':' + pad(min % 60);

function shape(base, uid, key, date, nameDate) {      // one finished event from its (possibly overridden) properties
  const title = (unescapeText(first(base.ev, 'SUMMARY') && first(base.ev, 'SUMMARY').value).trim()) || '(no title)';
  const location = unescapeText(first(base.ev, 'LOCATION') && first(base.ev, 'LOCATION').value).trim();
  const description = unescapeText(first(base.ev, 'DESCRIPTION') && first(base.ev, 'DESCRIPTION').value).trim();
  const allDay = base.when.allDay;
  let endDate = date, start = '', end = '';
  if (allDay) { if (base.spanDays > 1) endDate = addDays(date, base.spanDays - 1); }
  else {
    start = hhmm(base.when.min);
    const endMin = base.when.min + base.durMin;
    if (base.durMin > 0 && endMin < 1440) end = hhmm(endMin);
    else if (base.durMin >= 1440) endDate = addDays(date, Math.floor(endMin / 1440));
  }
  return { key, uid, title, date, endDate, allDay, start, end, timeText: allDay ? '' : timeLabel(start, end), location, description, hash: hashOf([title, date, endDate, start, end, location]) };
}
function baseOf(ev, zone) {
  const when = readWhen(first(ev, 'DTSTART'), zone);
  if (!when) return null;
  let durMin = 0, spanDays = 1;
  const endP = first(ev, 'DTEND'), durP = first(ev, 'DURATION');
  if (endP) {
    const e = readWhen(endP, zone);
    if (e) {
      if (when.allDay) spanDays = Math.max(1, Math.round((toUtc(e.date) - toUtc(when.date)) / 86400000));
      else if (!e.allDay) durMin = Math.max(0, Math.round((toUtc(e.date) - toUtc(when.date)) / 60000) + e.min - when.min);
    }
  } else if (durP) {
    const m = parseDuration(durP.value);
    if (m !== null) { if (when.allDay) spanDays = Math.max(1, Math.round(m / 1440)); else durMin = Math.max(0, m); }
  }
  return { ev, when, durMin, spanDays };
}

export function parseEvents(ics, opts) {
  const o = opts || {}, zone = o.zone && validZone(o.zone) ? o.zone : DEFAULT_ZONE, from = o.from || '0000-01-01', to = o.to || '9999-12-31';
  const evs = rawEvents(ics), masters = [], overrides = {}, out = [];
  evs.forEach(ev => {
    const uid = (first(ev, 'UID') || {}).value; if (!uid) return;
    const rid = first(ev, 'RECURRENCE-ID');
    if (rid) { const w = readWhen(rid, zone); if (w) overrides[uid + '|' + w.date] = ev; } else masters.push({ ev, uid });
  });
  const used = new Set();
  masters.forEach(({ ev, uid }) => {
    const base = baseOf(ev, zone); if (!base) return;
    const cancelled = ((first(ev, 'STATUS') || {}).value || '').toUpperCase() === 'CANCELLED';
    const rrule = first(ev, 'RRULE'), rdates = (ev.props.RDATE || []);
    if (!rrule && !rdates.length) {
      if (cancelled || base.when.date < from || base.when.date > to) return;
      out.push(shape(base, uid, uid, base.when.date));
      return;
    }
    let dates = rrule ? expandRule(readRule(rrule.value), base.when.date, to, zone) : [base.when.date];
    rdates.forEach(r => String(r.value).split(',').forEach(v => { const w = readWhen({ params: r.params, value: v }, zone); if (w) dates.push(w.date); }));
    const skip = new Set();
    (ev.props.EXDATE || []).forEach(x => String(x.value).split(',').forEach(v => { const w = readWhen({ params: x.params, value: v }, zone); if (w) skip.add(w.date); }));
    [...new Set(dates)].sort().forEach(dt => {
      if (skip.has(dt)) return;
      const okey = uid + '|' + dt, over = overrides[okey];
      if (over) {
        used.add(okey);
        if (((first(over, 'STATUS') || {}).value || '').toUpperCase() === 'CANCELLED') return;
        const ob = baseOf(over, zone); if (!ob) return;
        if (ob.when.date >= from && ob.when.date <= to) out.push(shape(ob, uid, okey, ob.when.date));
        return;
      }
      if (cancelled || dt < from || dt > to) return;
      out.push(shape({ ev, when: base.when, durMin: base.durMin, spanDays: base.spanDays }, uid, okey, dt));
    });
  });
  // a changed day of a repeating event whose original day was not in the list (a day added by hand in Google)
  Object.keys(overrides).forEach(k => {
    if (used.has(k)) return;
    const ev = overrides[k];
    if (((first(ev, 'STATUS') || {}).value || '').toUpperCase() === 'CANCELLED') return;
    if (masters.some(m => m.uid === k.split('|')[0])) return;       // belongs to a repeat that was cut off: not in the window
    const base = baseOf(ev, zone); if (!base || base.when.date < from || base.when.date > to) return;
    out.push(shape(base, k.split('|')[0], k, base.when.date));
  });
  return out.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')) || a.title.localeCompare(b.title));
}

// ---------- sorting a feed's events against what was decided ----------
// decisions: rows of calendar_events ({ feed_id, event_key, status, hash, changed, new_hash, ... }).
// -> { fresh: [event], skipped: [event], added: [event], changed: [{ event, decision }], flag: [{ event, decision }] }
//    flag = added events that look different in Google now and have not been flagged yet (the page tells the database, then they show up under changed)
export function reviewList(feedId, events, decisions) {
  const byKey = {}; (decisions || []).forEach(d => { if (d.feed_id === feedId) byKey[d.event_key] = d; });
  const r = { fresh: [], skipped: [], added: [], changed: [], flag: [] };
  (events || []).forEach(ev => {
    const d = byKey[ev.key];
    if (!d) r.fresh.push(ev);
    else if (d.status === 'skipped') r.skipped.push(ev);
    else if (d.hash === ev.hash) r.added.push(ev);                              // looks the way it did when added (or went back to it)
    else if (d.changed && d.new_hash === ev.hash) r.changed.push({ event: ev, decision: d });
    else r.flag.push({ event: ev, decision: d });                               // new look, not flagged yet (or changed again since)
  });
  return r;
}
