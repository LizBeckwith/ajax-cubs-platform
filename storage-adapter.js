// Lets the existing tracker page keep calling window.storage.get('pto') / set('pto', json) while
// the data lives in real database tables.
//
//   get(key)  reads the rows and rebuilds the same JSON the old Google Sheet held.
//   set(key)  compares what the page now holds with what it last read, and sends ONLY the rows
//             that were added, changed, or removed.
//
// That second part is the whole point: the old design saved the entire list every time, so a
// stale or failed read could overwrite everyone's data with an empty list. Here a page can never
// touch a row it did not itself change.
//
// All database access goes through the small `db` object (select/insert/update/remove/upsert),
// so the same code runs against Supabase in the browser and an in-memory fake in tests.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID_RE.test(v);

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Same look as the page's own stamp(): "Sep 9 09:44 AM", in the viewer's local time.
export function stampText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------- field conversions (old JSON field <-> database column) ----------
const TYPES = {
  s: { from: v => (v == null ? '' : v), to: v => (v == null ? '' : String(v)) },
  d: { from: v => (v == null ? '' : v), to: v => (v ? String(v) : null) },
  t: { from: v => (v ? String(v).slice(0, 5) : ''), to: v => (v ? String(v) : null) },
  b: { from: v => !!v, to: v => v === true },
  n: { from: v => (v == null ? '' : Number(v)), to: v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; } },
  a: { from: v => (Array.isArray(v) ? v : []), to: v => (Array.isArray(v) ? v : []) },
  ts: { from: v => v || '', to: v => undefined }   // read-only timestamp
};
// fields: [[jsonName, column, type], ...]
const toRow = (fields, item) => {
  const row = {};
  for (const [f, c, ty] of fields) { const v = TYPES[ty].to(item[f]); if (v !== undefined) row[c] = v; }
  return row;
};
const fromRow = (fields, row) => {
  const item = {};
  for (const [f, c, ty] of fields) item[f] = TYPES[ty].from(row[c]);
  return item;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changedCols = (before, after) => {
  const patch = {};
  for (const c of Object.keys(after)) if (!same(before[c], after[c])) patch[c] = after[c];
  return patch;
};

// ---------- list codec: one table, rows <-> array of items, optional child tables ----------
// children: [{ prop, table, parentCol, fields, order }] e.g. a project's subtasks and comments.
function listCodec({ table, fields, where, order = 'created_at', children = [], archiveOnDelete = false, extraLoad, omitEmptyOnInsert = [], constants = {} }) {
  return {
    async load(db, key, st) {
      const rows = await db.select(table, { eq: where || {}, order });
      const kids = {};
      for (const ch of children) {
        let crow = await db.select(ch.table, { order: ch.order || 'created_at' });
        // a stable sort on the order column keeps rows with the same number in the order they were added
        if (ch.sortCol) crow = crow.slice().sort((x, y) => (Number(x[ch.sortCol]) || 0) - (Number(y[ch.sortCol]) || 0));
        kids[ch.prop] = crow;
      }
      st.rows = new Map(); st.kids = {};
      children.forEach(ch => { st.kids[ch.prop] = new Map(); });
      const items = rows.map(r => {
        const item = Object.assign({ id: r.id }, fromRow(fields, r));
        st.rows.set(r.id, toRow(fields, item));
        if (extraLoad) extraLoad(item, r);
        for (const ch of children) {
          item[ch.prop] = kids[ch.prop].filter(c => c[ch.parentCol] === r.id).map(c => {
            const ci = Object.assign({ id: c.id }, fromRow(ch.fields, c));
            const crowSnap = toRow(ch.fields, ci);
            if (ch.sortCol) crowSnap[ch.sortCol] = Number(c[ch.sortCol]) || 0;   // what the database holds now
            st.kids[ch.prop].set(c.id, { parent: r.id, row: crowSnap });
            return ci;
          });
        }
        return item;
      });
      return items;
    },
    async save(db, key, st, list) {
      if (!Array.isArray(list)) throw new Error('Expected a list for ' + key);
      const seen = new Set();
      const inserts = [], updates = [];
      for (const item of list) {
        if (!item || !isUuid(item.id)) { console.warn('Skipping an item without a database id in', key, item && item.id); continue; }
        seen.add(item.id);
        const row = toRow(fields, item);
        if (!st.rows.has(item.id)) inserts.push(Object.assign({ id: item.id }, row));
        else { const patch = changedCols(st.rows.get(item.id), row); if (Object.keys(patch).length) updates.push([item.id, patch, row]); }
      }
      if (inserts.length) {
        // optional columns left blank are not sent, so a table that has not been given the column yet still works
        const toSend = inserts.map(r => { const c = Object.assign({}, r, constants); omitEmptyOnInsert.forEach(col => { if (c[col] === '' || c[col] === null) delete c[col]; }); return c; });
        await db.insert(table, toSend);
        inserts.forEach(r => { const { id, ...rest } = r; st.rows.set(id, rest); });
      }
      for (const [id, patch, row] of updates) { await db.update(table, { id }, patch); st.rows.set(id, row); }

      // children of items that still exist
      for (const ch of children) {
        const known = st.kids[ch.prop];
        const cIns = [], cUpd = [], cSeen = new Set();
        for (const item of list) {
          if (!item || !isUuid(item.id)) continue;
          const kidList = Array.isArray(item[ch.prop]) ? item[ch.prop] : [];
          for (let pos = 0; pos < kidList.length; pos++) {
            const ci = kidList[pos];
            if (!ci || !isUuid(ci.id)) { console.warn('Skipping a', ch.prop, 'entry without a database id'); continue; }
            cSeen.add(ci.id);
            const row = toRow(ch.fields, ci);
            if (ch.sortCol) row[ch.sortCol] = pos;          // position in the list, so moving one up or down sticks
            if (!known.has(ci.id)) cIns.push(Object.assign({ id: ci.id, [ch.parentCol]: item.id }, row));
            else { const patch = changedCols(known.get(ci.id).row, row); if (Object.keys(patch).length) cUpd.push([ci.id, patch, row]); }
          }
        }
        if (cIns.length) {
          const toSend = cIns.map(r => { const c = Object.assign({}, r); (ch.omitEmptyOnInsert || []).forEach(col => { if (c[col] === '' || c[col] === null) delete c[col]; }); return c; });
          await db.insert(ch.table, toSend);
          cIns.forEach(r => { const { id, [ch.parentCol]: parent, ...rest } = r; known.set(id, { parent, row: rest }); });
        }
        for (const [id, patch, row] of cUpd) { await db.update(ch.table, { id }, patch); known.set(id, { parent: known.get(id).parent, row }); }
        for (const [id, info] of [...known]) {
          if (seen.has(info.parent) && !cSeen.has(id)) { await db.remove(ch.table, { id }); known.delete(id); }
        }
      }

      // removed items (their children go with them in the database)
      for (const id of [...st.rows.keys()]) {
        if (seen.has(id)) continue;
        if (archiveOnDelete) await db.update(table, { id }, { archived: true });
        else await db.remove(table, { id });
        st.rows.delete(id);
        for (const ch of children) for (const [cid, info] of [...st.kids[ch.prop]]) if (info.parent === id) st.kids[ch.prop].delete(cid);
      }
    }
  };
}

// ---------- plain list of names (project names, classrooms) ----------
function nameListCodec({ table, orderCol }) {
  return {
    async load(db, key, st) {
      const rows = await db.select(table, { order: orderCol, pk: 'name' });
      st.names = new Set(rows.map(r => r.name));
      return rows.map(r => r.name);
    },
    async save(db, key, st, list) {
      const names = (Array.isArray(list) ? list : []).map(n => String(n).trim()).filter(Boolean);
      const add = names.filter(n => !st.names.has(n));
      if (add.length) {
        const base = st.names.size;
        await db.insert(table, add.map((name, i) => ({ name, [orderCol]: base + i + 1 })));
        add.forEach(n => st.names.add(n));
      }
      for (const n of [...st.names]) {
        if (!names.includes(n)) { await db.remove(table, { name: n }); st.names.delete(n); }
      }
    }
  };
}

// ---------- the codecs, one per storage key ----------
const LISTS = {
  tasks: listCodec({ table: 'tasks', where: { archived: false }, archiveOnDelete: true, omitEmptyOnInsert: ['description', 'link'],
    fields: [['name', 'name', 's'], ['description', 'description', 's'], ['link', 'link', 's'], ['category', 'category', 's'], ['time', 'time_text', 's']] }),
  // pay (paid / half / unpaid, migration 021) stays blank until someone decides, so a blank is not sent on insert
  pto: listCodec({ table: 'pto_requests', omitEmptyOnInsert: ['pay'],
    fields: [['person', 'person', 's'], ['date', 'request_date', 'd'], ['dayType', 'day_type', 's'], ['classroom', 'classroom', 's'], ['coverage', 'coverage', 's'], ['approved', 'approved', 'b'], ['pay', 'pay', 's']] }),
  subrequests: listCodec({ table: 'sub_requests',
    fields: [['requestedBy', 'requested_by', 's'], ['date', 'request_date', 'd'], ['classroom', 'classroom', 's'], ['status', 'status', 's'], ['notes', 'notes', 's']] }),
  // correctedBy / correctedAt are stamped by the database (migration 018) when someone marks it corrected; read only here
  timecardcorrections: listCodec({ table: 'timecard_corrections',
    extraLoad: (item, r) => { item.correctedBy = r.corrected_by_name || ''; item.correctedAt = r.corrected_at || ''; },
    fields: [['person', 'person', 's'], ['date', 'correction_date', 'd'], ['correctionType', 'correction_type', 's'], ['time', 'time_value', 't'], ['notes', 'notes', 's'], ['corrected', 'corrected', 'b']] }),
  latepickups: listCodec({ table: 'late_pickups',
    fields: [['child', 'child', 's'], ['date', 'pickup_date', 'd'], ['time', 'pickup_time', 't'], ['notes', 'notes', 's']] }),
  dropins: listCodec({ table: 'drop_ins',
    fields: [['name', 'name', 's'], ['date', 'drop_date', 'd'], ['classroom', 'classroom', 's']] }),
  vacations: listCodec({ table: 'vacations',
    fields: [['childName', 'child_name', 's'], ['classroom', 'classroom', 's'], ['startDate', 'start_date', 'd'], ['endDate', 'end_date', 'd']] }),
  snackrequests: listCodec({ table: 'snack_requests',
    fields: [['person', 'person', 's'], ['text', 'request_text', 's'], ['date', 'request_date', 'd'], ['ordered', 'ordered', 'b']] }),
  workorders: listCodec({ table: 'work_orders',
    fields: [['person', 'person', 's'], ['classroom', 'classroom', 's'], ['date', 'order_date', 'd'], ['status', 'status', 's'], ['notes', 'notes', 's']] }),
  contactrequests: listCodec({ table: 'contact_requests',
    fields: [['type', 'type', 's'], ['person', 'person', 's'], ['date', 'request_date', 'd'], ['message', 'message', 's'], ['handled', 'handled', 'b'], ['submittedAt', 'created_at', 'ts']] }),
  schedulechanges: listCodec({ table: 'schedule_changes',
    fields: [['person', 'person', 's'], ['classroom', 'classroom', 's'], ['date', 'change_date', 'd'], ['type', 'change_type', 's'],
      ['arrivalTime', 'arrival_time', 't'], ['departureTime', 'departure_time', 't'], ['returnTime', 'return_time', 't'],
      ['notes', 'notes', 's'], ['coveredBy', 'covered_by', 's'], ['approved', 'approved', 'b']] }),
  specialdays: listCodec({ table: 'special_days',
    fields: [['type', 'type', 's'], ['date', 'day_date', 'd'], ['title', 'title', 's'], ['time', 'time_text', 's'], ['notes', 'notes', 's']] }),
  kids: listCodec({ table: 'kids',
    fields: [['name', 'name', 's'], ['birthday', 'birthday', 'd'], ['classroom', 'classroom', 's'], ['days', 'days', 'a']] }),
  newchildren: listCodec({ table: 'new_children',
    fields: [['name', 'name', 's'], ['birthday', 'birthday', 'd'], ['classroom', 'classroom', 's'], ['startDate', 'start_date', 'd'], ['notes', 'notes', 's'], ['days', 'days', 'a']] }),
  childtransitions: listCodec({ table: 'child_transitions',
    fields: [['childName', 'child_name', 's'], ['birthday', 'birthday', 'd'], ['category', 'category', 's'], ['currentClassroom', 'current_classroom', 's'],
      ['futureClassroom', 'future_classroom', 's'], ['transitionType', 'transition_type', 's'], ['transitionDate', 'transition_date', 'd'], ['notes', 'notes', 's'], ['status', 'status', 's']],
    children: [{ prop: 'thread', table: 'child_transition_comments', parentCol: 'transition_id',
      fields: [['name', 'author', 's'], ['text', 'body', 's']] }] }),
  goodtoknownotes: listCodec({ table: 'good_to_know',
    fields: [['classroom', 'classroom', 's'], ['date', 'note_date', 'd'], ['text', 'note', 's'], ['addedBy', 'added_by', 's'], ['retiredOn', 'retired_on', 'd'], ['retiredBy', 'retired_by', 's'], ['addedAt', 'created_at', 'ts']] }),
  classroomrequests: listCodec({ table: 'classroom_requests',
    fields: [['person', 'person', 's'], ['month', 'month', 's'], ['classroom', 'classroom', 's'], ['date', 'request_date', 'd'], ['price', 'price', 'n'], ['url', 'url', 's'], ['notes', 'notes', 's']] }),
  projecttasks: listCodec({ table: 'project_tasks', omitEmptyOnInsert: ['owner', 'urgency'],
    fields: [['title', 'title', 's'], ['project', 'project', 's'], ['owner', 'owner', 's'], ['startDate', 'start_date', 'd'], ['dueDate', 'due_date', 'd'], ['status', 'status', 's'],
      ['repeat', 'repeat', 's'], ['notes', 'notes', 's'], ['howTo', 'how_to', 's'], ['urgency', 'urgency', 's']],
    children: [
      { prop: 'subtasks', table: 'project_subtasks', parentCol: 'project_task_id', sortCol: 'sort_order', omitEmptyOnInsert: ['due_date'],
        fields: [['text', 'note', 's'], ['done', 'done', 'b'], ['assignee', 'assignee', 's'], ['howTo', 'how_to', 's'], ['dueDate', 'due_date', 'd']] },
      { prop: 'thread', table: 'project_comments', parentCol: 'project_task_id',
        fields: [['name', 'author', 's'], ['text', 'body', 's']] }] })
};

// Playground/gym entries keep their whole object in one JSON column.
const pgCodec = {
  async load(db, key, st) {
    const rows = await db.select('pg_entries', { order: 'created_at' });
    const clean = d => { const { id, ...rest } = d || {}; return rest; };   // an old sheet id may still sit inside the data
    st.rows = new Map(rows.map(r => [r.id, clean(r.data)]));
    return rows.map(r => Object.assign({}, clean(r.data), { id: r.id }));
  },
  async save(db, key, st, list) {
    const seen = new Set();
    for (const item of (Array.isArray(list) ? list : [])) {
      if (!item || !isUuid(item.id)) continue;
      seen.add(item.id);
      const { id, ...data } = item;
      if (!st.rows.has(id)) { await db.insert('pg_entries', [{ id, data }]); st.rows.set(id, data); }
      else if (!same(st.rows.get(id), data)) { await db.update('pg_entries', { id }, { data }); st.rows.set(id, data); }
    }
    for (const id of [...st.rows.keys()]) if (!seen.has(id)) { await db.remove('pg_entries', { id }); st.rows.delete(id); }
  }
};

// Newsletter: five lists in one table, told apart by `kind`.
const NEWS_KINDS = { overall: 'overall', dates: 'dates', coaching: 'coaching', classroomUpdates: 'classroom_updates', flyers: 'flyers' };
const newsletterCodec = {
  async load(db, key, st) {
    const rows = await db.select('newsletter_items', { order: 'created_at' });
    st.rows = new Map();
    const out = { overall: [], dates: [], coaching: [], classroomUpdates: [], flyers: [] };
    for (const r of rows) {
      const prop = Object.keys(NEWS_KINDS).find(p => NEWS_KINDS[p] === r.kind);
      if (!prop) continue;
      const item = { id: r.id, text: r.note, issue: r.issue || '', archived: !!r.archived };
      if (prop === 'dates') item.date = r.item_date || '';
      if (prop === 'classroomUpdates') item.classroom = r.classroom || '';
      out[prop].push(item);
      st.rows.set(r.id, { kind: r.kind, note: r.note, issue: r.issue || '', archived: !!r.archived, item_date: r.item_date || null, classroom: r.classroom || '' });
    }
    return out;
  },
  async save(db, key, st, obj) {
    const seen = new Set();
    for (const [prop, kind] of Object.entries(NEWS_KINDS)) {
      for (const item of ((obj && obj[prop]) || [])) {
        if (!item || !isUuid(item.id)) { console.warn('Skipping a newsletter item without a database id'); continue; }
        seen.add(item.id);
        const row = { kind, note: String(item.text || ''), issue: String(item.issue == null ? '' : item.issue), archived: item.archived === true,
          item_date: kind === 'dates' && item.date ? item.date : null, classroom: kind === 'classroom_updates' ? String(item.classroom || '') : '' };
        if (!st.rows.has(item.id)) { await db.insert('newsletter_items', [Object.assign({ id: item.id }, row)]); st.rows.set(item.id, row); }
        else { const patch = changedCols(st.rows.get(item.id), row); if (Object.keys(patch).length) { await db.update('newsletter_items', { id: item.id }, patch); st.rows.set(item.id, row); } }
      }
    }
    for (const id of [...st.rows.keys()]) if (!seen.has(id)) { await db.remove('newsletter_items', { id }); st.rows.delete(id); }
  }
};

// Small admin-only documents (laundry grid, category blurbs, ...).
function settingsCodec(settingKey, fallback) {
  return {
    async load(db, key, st) {
      const rows = await db.select('app_settings', { eq: { key: settingKey }, pk: 'key' });
      st.value = rows.length ? rows[0].value : undefined;
      return rows.length ? rows[0].value : fallback();
    },
    async save(db, key, st, value) {
      if (same(st.value, value)) return;
      await db.upsert('app_settings', [{ key: settingKey, value, updated_at: new Date().toISOString() }], 'key');
      st.value = value;
    }
  };
}

// The old shared passwords are gone (real logins replace them): reads see "nothing configured",
// writes are ignored.
const accessConfigCodec = {
  async load() { return { adminPassword: '', classroomPasswords: {} }; },
  async save() {}
};

// ---------- one day of check-offs and comments: entries:YYYY-MM-DD ----------
const entriesCodec = {
  async load(db, key, st) {
    const day = key.slice('entries:'.length);
    const log = await db.select('task_log', { eq: { log_date: day }, pk: 'task_id' });
    const comments = await db.select('task_comments', { eq: { log_date: day }, order: 'created_at' });
    st.log = new Map(log.map(r => [r.task_id, !!r.done]));
    st.comments = new Map(comments.map(c => [c.id, true]));
    const out = {};
    log.forEach(r => { out[r.task_id] = { done: !!r.done, at: r.done ? stampText(r.done_at) : '', thread: [] }; });
    comments.forEach(c => {
      out[c.task_id] = out[c.task_id] || { thread: [] };
      out[c.task_id].thread = out[c.task_id].thread || [];
      out[c.task_id].thread.push({ id: c.id, name: c.author, text: c.body, at: stampText(c.created_at) });
    });
    return out;
  },
  async save(db, key, st, obj) {
    const day = key.slice('entries:'.length);
    const seenComments = new Set(), newComments = [];
    for (const [taskId, e] of Object.entries(obj || {})) {
      if (!e || typeof e !== 'object') continue;
      if (!isUuid(taskId)) { console.warn('Skipping check-off for a task without a database id', taskId); continue; }
      const done = typeof e.done === 'boolean' ? e.done : !!((e.lb && e.lb.done) || (e.pt && e.pt.done));
      if (done !== (st.log.get(taskId) || false)) {
        await db.upsert('task_log', [{ task_id: taskId, log_date: day, done, done_at: done ? new Date().toISOString() : null }], 'task_id,log_date');
        st.log.set(taskId, done);
      }
      for (const m of (Array.isArray(e.thread) ? e.thread : [])) {
        if (!m || !isUuid(m.id)) { console.warn('Skipping a comment without a database id'); continue; }
        seenComments.add(m.id);
        if (!st.comments.has(m.id)) newComments.push({ id: m.id, task_id: taskId, log_date: day, author: String(m.name || m.author || ''), body: String(m.text || '') });
      }
    }
    if (newComments.length) { await db.insert('task_comments', newComments); newComments.forEach(c => st.comments.set(c.id, true)); }
    for (const id of [...st.comments.keys()]) if (!seenComments.has(id)) { await db.remove('task_comments', { id }); st.comments.delete(id); }
  }
};

// ---------- one week of Week Review: week:<monday> ----------
const WEEK_FIELDS = [['title', 'title', 's'], ['classroom', 'classroom', 's'], ['dayType', 'day_type', 's'], ['time', 'time_text', 's'], ['coveredBy', 'covered_by', 's'], ['notes', 'notes', 's'], ['extraSupport', 'extra_support', 's'], ['workTime', 'work_time', 'b']];
const weekCodec = {
  async load(db, key, st) {
    const monday = key.slice('week:'.length);
    const rows = await db.select('week_entries', { between: ['entry_date', monday, addDays(monday, 6)], order: 'created_at' });
    st.rows = new Map();
    const out = {};
    for (const r of rows) {
      const idx = Math.round((new Date(r.entry_date + 'T00:00:00Z') - new Date(monday + 'T00:00:00Z')) / 86400000);
      const dayKey = DAY_KEYS[idx];
      if (!dayKey) continue;
      const entry = Object.assign({ id: r.id }, fromRow(WEEK_FIELDS, r));
      out[dayKey] = out[dayKey] || {};
      (out[dayKey][r.task_id] = out[dayKey][r.task_id] || []).push(entry);
      st.rows.set(r.id, Object.assign({ task_id: r.task_id, entry_date: r.entry_date }, toRow(WEEK_FIELDS, entry)));
    }
    return out;
  },
  async save(db, key, st, obj) {
    const monday = key.slice('week:'.length);
    const seen = new Set(), inserts = [], updates = [];
    for (const [dayKey, byTask] of Object.entries(obj || {})) {
      const idx = DAY_KEYS.indexOf(dayKey);
      if (idx < 0) continue;
      for (const [taskId, val] of Object.entries(byTask || {})) {
        if (!isUuid(taskId)) { console.warn('Skipping Week Review entries for a task without a database id', taskId); continue; }
        for (const e of (Array.isArray(val) ? val : (val ? [val] : []))) {
          if (!e || !isUuid(e.id)) { console.warn('Skipping a Week Review entry without a database id'); continue; }
          seen.add(e.id);
          const row = Object.assign({ task_id: taskId, entry_date: addDays(monday, idx) }, toRow(WEEK_FIELDS, e));
          if (!st.rows.has(e.id)) inserts.push(Object.assign({ id: e.id }, row));
          else { const patch = changedCols(st.rows.get(e.id), row); if (Object.keys(patch).length) updates.push([e.id, patch, row]); }
        }
      }
    }
    if (inserts.length) { await db.insert('week_entries', inserts.map(r => { const c = Object.assign({}, r); if (c.extra_support === '') delete c.extra_support; if (c.work_time === false) delete c.work_time; return c; })); inserts.forEach(r => { const { id, ...rest } = r; st.rows.set(id, rest); }); }
    for (const [id, patch, row] of updates) { await db.update('week_entries', { id }, patch); st.rows.set(id, row); }
    for (const id of [...st.rows.keys()]) if (!seen.has(id)) { await db.remove('week_entries', { id }); st.rows.delete(id); }
  }
};

// ---------- attendance snapshots: { monday: { classroom: { mon: [names] } } } ----------
const snapKey = (w, c, d, n) => [w, c, d, n].join('\u0001');
const attendanceCodec = {
  async load(db, key, st) {
    const rows = await db.select('attendance_snapshots', { order: 'week_monday' });
    const weeks = await db.select('attendance_snapshot_weeks', { order: 'week_monday', pk: 'week_monday' });
    st.rows = new Set(); st.weeks = new Set(weeks.map(w => w.week_monday));
    const out = {};
    weeks.forEach(w => { out[w.week_monday] = {}; });
    for (const r of rows) {
      out[r.week_monday] = out[r.week_monday] || {};
      const room = out[r.week_monday][r.classroom] = out[r.week_monday][r.classroom] || {};
      (room[r.day_key] = room[r.day_key] || []).push(r.child_name);
      st.rows.add(snapKey(r.week_monday, r.classroom, r.day_key, r.child_name));
    }
    return out;
  },
  async save(db, key, st, obj) {
    const want = new Map(); // key -> row
    const newWeeks = [];
    for (const [monday, byRoom] of Object.entries(obj || {})) {
      if (!st.weeks.has(monday)) newWeeks.push({ week_monday: monday });
      for (const [room, byDay] of Object.entries(byRoom || {})) {
        for (const [dayKey, names] of Object.entries(byDay || {})) {
          if (!DAY_KEYS.includes(dayKey)) continue;
          for (const n of new Set((names || []).map(x => String(x).trim()).filter(Boolean)))
            want.set(snapKey(monday, room, dayKey, n), { week_monday: monday, classroom: room, day_key: dayKey, child_name: n });
        }
      }
    }
    if (newWeeks.length) { await db.upsert('attendance_snapshot_weeks', newWeeks, 'week_monday'); newWeeks.forEach(w => st.weeks.add(w.week_monday)); }
    const adds = [...want.entries()].filter(([k]) => !st.rows.has(k));
    if (adds.length) { await db.insert('attendance_snapshots', adds.map(([, r]) => r)); adds.forEach(([k]) => st.rows.add(k)); }
    // removals, grouped so a re-taken week is a handful of calls instead of one per child
    const gone = new Map();
    for (const k of st.rows) {
      if (want.has(k)) continue;
      const [w, c, d, n] = k.split('\u0001');
      const g = [w, c, d].join('\u0001');
      if (!gone.has(g)) gone.set(g, { match: { week_monday: w, classroom: c, day_key: d }, names: [] });
      gone.get(g).names.push(n);
    }
    for (const { match, names } of gone.values()) {
      await db.removeIn('attendance_snapshots', match, 'child_name', names);
      names.forEach(n => st.rows.delete(snapKey(match.week_monday, match.classroom, match.day_key, n)));
    }
  }
};

// ---------- key -> codec ----------
function codecFor(key) {
  if (LISTS[key]) return LISTS[key];
  if (key.startsWith('entries:')) return entriesCodec;
  if (key.startsWith('week:')) return weekCodec;
  if (key.startsWith('cardtasks:')) return cardTasksCodec(key.slice('cardtasks:'.length));
  switch (key) {
    case 'playgroundgymentries': return pgCodec;
    case 'newsletter': return newsletterCodec;
    case 'attendancesnapshots': return attendanceCodec;
    case 'projectslist': return PROJECT_NAMES;
    case 'projectdetails': return PROJECT_DETAILS;
    case 'materialclassrooms': return CLASSROOMS;
    case 'categorydescriptions': return CATEGORY_DESCRIPTIONS;
    case 'schedulerowmodes': return SCHEDULE_ROW_MODES;
    case 'scheduleseries': return SCHEDULE_SERIES;
    case 'scheduleroworder': return SCHEDULE_ROW_ORDER;
    case 'namelists': return NAME_LISTS;
    case 'sectiontext': return SECTION_TEXT;
    case 'staffnames': return STAFF_NAMES;
    case 'laundryschedule': return LAUNDRY;
    case 'playgroundgymschedule': return PG_SCHEDULE;
    case 'schedulesemesters': return SCHEDULE_SEMESTERS;
    case 'accessconfig': return accessConfigCodec;
    default: return null;
  }
}
// The tasks of one card made from a project ('cardtasks:<card key>'): the same shape as the Project tracker's tasks, tied to the card (migration 023)
function cardTasksCodec(cardKey) {
  return listCodec({ table: 'card_tasks', where: { card_key: cardKey }, constants: { card_key: cardKey }, omitEmptyOnInsert: ['owner', 'urgency'],
    fields: [['title', 'title', 's'], ['owner', 'owner', 's'], ['startDate', 'start_date', 'd'], ['dueDate', 'due_date', 'd'], ['status', 'status', 's'],
      ['repeat', 'repeat', 's'], ['notes', 'notes', 's'], ['howTo', 'how_to', 's'], ['urgency', 'urgency', 's']],
    children: [
      { prop: 'subtasks', table: 'card_subtasks', parentCol: 'card_task_id', sortCol: 'sort_order', omitEmptyOnInsert: ['due_date'],
        fields: [['text', 'note', 's'], ['done', 'done', 'b'], ['assignee', 'assignee', 's'], ['howTo', 'how_to', 's'], ['dueDate', 'due_date', 'd']] },
      { prop: 'thread', table: 'card_comments', parentCol: 'card_task_id',
        fields: [['name', 'author', 's'], ['text', 'body', 's']] }] });
}
const PROJECT_NAMES = nameListCodec({ table: 'project_names', orderCol: 'sort_order' });
// a description, owner, helpers and due date for each project, by project name (Settings > Projects)
const PROJECT_DETAILS = settingsCodec('project_details', () => ({}));
const CLASSROOMS = nameListCodec({ table: 'classrooms', orderCol: 'sort_order' });
const CATEGORY_DESCRIPTIONS = settingsCodec('category_descriptions', () => ({}));
const SECTION_TEXT = settingsCodec('section_text', () => ({}));
const STAFF_NAMES = settingsCodec('staff_names', () => []);
const SCHEDULE_ROW_MODES = settingsCodec('schedule_row_modes', () => ({}));
const SCHEDULE_SERIES = settingsCodec('schedule_series', () => []);
const SCHEDULE_ROW_ORDER = settingsCodec('schedule_row_order', () => []);
const NAME_LISTS = settingsCodec('name_lists', () => ({}));
const LAUNDRY = settingsCodec('laundry_schedule', () => ({ accessNote: '', grid: {} }));
const PG_SCHEDULE = settingsCodec('playground_gym_schedule', () => ({ locationTimes: {} }));
const SCHEDULE_SEMESTERS = settingsCodec('schedule_semesters', () => null);

// ---------- the window.storage object the page talks to ----------
// Keeps the old safety net: reads are retried; if every attempt fails but we have a good copy
// from earlier we hand that back, otherwise the key is marked unreadable and saving it is refused.
export function createStorage(db, { retries = 3, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const states = new Map();      // key -> codec working state (what this page last read/wrote)
  const lastGood = new Map();    // key -> last JSON string handed to the page
  const readFailed = new Set();

  // Reads and saves of the same list take turns. Without this, two quick actions (a new task and then a
  // subtask on it, say) would each compare against the same "what the database holds" snapshot and both
  // try to insert the new task, and the second would be refused as a duplicate (409). One at a time, each
  // save sees what the one before it wrote.
  const lines = new Map();       // key -> the last operation queued for it
  const inTurn = (key, work) => {
    const run = (lines.get(key) || Promise.resolve()).catch(() => {}).then(work);
    lines.set(key, run);
    return run;
  };

  async function getNow(key, shared) {
    {
      const codec = codecFor(key);
      if (!codec) { console.warn('No table for storage key', key); return null; }
      let lastErr;
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const st = {};
          const value = await codec.load(db, key, st);
          states.set(key, st);
          const json = JSON.stringify(value);
          lastGood.set(key, json);
          readFailed.delete(key);
          return { key, value: json, shared: !!shared };
        } catch (err) {
          lastErr = err;
          if (attempt < retries - 1) await wait(400 * (attempt + 1));
        }
      }
      if (lastGood.has(key)) { console.warn('Read of "' + key + '" failed; using the last copy this page saw.', lastErr); return { key, value: lastGood.get(key), shared: !!shared }; }
      readFailed.add(key);
      throw lastErr;
    }
  }

  async function setNow(key, value, shared) {
    {
      const codec = codecFor(key);
      if (!codec) { console.warn('No table for storage key', key); return null; }
      if (readFailed.has(key)) throw new Error('Not saving "' + key + '": it could not be read first.');
      const st = states.get(key);
      if (!st) throw new Error('Not saving "' + key + '": it has not been read yet, so there is nothing to compare against.');
      await codec.save(db, key, st, typeof value === 'string' ? JSON.parse(value) : value);
      lastGood.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      return { key, value: lastGood.get(key), shared: !!shared };
    }
  }

  return {
    get: (key, shared) => inTurn(key, () => getNow(key, shared)),
    set: (key, value, shared) => inTurn(key, () => setNow(key, value, shared))
  };
}

// ---------- the real database access (Supabase) ----------
export function supabaseDb(sb) {
  const PK = { task_log: 'task_id', classrooms: 'name', project_names: 'name', app_settings: 'key', attendance_snapshot_weeks: 'week_monday' };
  const fail = (error, what) => { if (error) { const e = new Error(what + ': ' + error.message); e.code = error.code; throw e; } };
  return {
    async select(table, { eq = {}, between, order, pk } = {}) {
      const tie = pk === undefined ? (table in PK ? PK[table] : 'id') : pk;
      const all = [];
      for (let from = 0; ; from += 1000) {
        let q = sb.from(table).select('*');
        for (const [c, v] of Object.entries(eq)) q = q.eq(c, v);
        if (between) q = q.gte(between[0], between[1]).lte(between[0], between[2]);
        if (order) q = q.order(order, { ascending: true });
        if (tie && tie !== order) q = q.order(tie, { ascending: true });
        const { data, error } = await q.range(from, from + 999);
        fail(error, 'Reading ' + table);
        all.push(...data);
        if (data.length < 1000) break;
      }
      return all;
    },
    async insert(table, rows) { const { error } = await sb.from(table).insert(rows); fail(error, 'Saving to ' + table); },
    async update(table, match, patch) {
      let q = sb.from(table).update(patch);
      for (const [c, v] of Object.entries(match)) q = q.eq(c, v);
      const { data, error } = await q.select();
      fail(error, 'Updating ' + table);
      if (!data || !data.length) throw new Error('Updating ' + table + ': nothing was changed (you may not have permission, or the row is gone).');
    },
    async remove(table, match) {
      let q = sb.from(table).delete();
      for (const [c, v] of Object.entries(match)) q = q.eq(c, v);
      const { data, error } = await q.select();
      fail(error, 'Removing from ' + table);
      if (!data || !data.length) throw new Error('Removing from ' + table + ': nothing was removed (you may not have permission).');
    },
    async removeIn(table, match, col, values) {
      for (let i = 0; i < values.length; i += 100) {
        let q = sb.from(table).delete();
        for (const [c, v] of Object.entries(match)) q = q.eq(c, v);
        const { error } = await q.in(col, values.slice(i, i + 100));
        fail(error, 'Removing from ' + table);
      }
    },
    async upsert(table, rows, onConflict) { const { error } = await sb.from(table).upsert(rows, { onConflict }); fail(error, 'Saving to ' + table); }
  };
}
