// ===== TASKS AND PROJECTS · site/tasks-lib.js · the database calls and small helpers for Tasks and Projects (plan section 31) =====
// Kept apart from site/people-lib.js (already too long, running list item 20a). site/platform.js joins makeTasksApi into the same
// window.__peopleApi every card uses, and puts the helpers on window.__tasksLib. Tested by tests/tasks-lib.test.mjs.
import { clock as timeClock } from './time-lib.js';

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// A name tidied the way the database compares it (no spaces at the ends, any capitals).
const nameKey = name => String(name || '').trim().toLowerCase();

// Project names are unique (migration 073; Liz 2026-11-08): the plain sentence for a name that's taken.
export const takenName = name => 'There\'s already a project called "' + String(name || '').trim() + '".';
// Like must, but the database's "name already used" refusal reads as that sentence.
const mustName = ({ data, error }, name) => {
  if (error && (error.code === '23505' || /projects_name_unique/.test(error.message || ''))) throw new Error(takenName(name));
  return must({ data, error });
};

// ===== Settings › Task Categories =====

// null when the name can be used for a category, otherwise a sentence for the person. exceptId: the category being renamed.
// Used by Settings › Task Categories (tools/tracker-task-categories.js).
export function categoryNameProblem(name, categories, exceptId) {
  if (!nameKey(name)) return 'Give the category a name.';
  const same = (categories || []).find(c => c.id !== exceptId && nameKey(c.name) === nameKey(name));
  if (same) return same.archived ? 'There is already an archived category called "' + same.name + '". Bring it back instead.' : 'There is already a category called "' + same.name + '".';
  return null;
}

// The place for something new at the end of a list (categories, tasks): after the last one.
export function nextSortOrder(rows) {
  return (rows || []).reduce((m, c) => Math.max(m, Number(c.sort_order) || 0), 0) + 10;
}

// Moving one row up (-1) or down (+1) in a list kept by sort_order (archived rows are skipped and keep their place): the two rows that swap
// places, as [{ id, sort_order }], or [] when it is already at that end. Used by Settings › Task Categories and a task's Move up / down.
export function moveInList(rows, id, dir) {
  const open = (rows || []).filter(c => !c.archived);
  const i = open.findIndex(c => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= open.length) return [];
  const a = open[i], b = open[j];
  if (a.sort_order === b.sort_order) return [{ id: a.id, sort_order: b.sort_order + dir }, { id: b.id, sort_order: b.sort_order }];
  return [{ id: a.id, sort_order: b.sort_order }, { id: b.id, sort_order: a.sort_order }];
}

// ===== A project's tasks (pictures 78 and 79) =====
// A task's place: parent_id (null = straight under the project) and sort_order. Bullets or numbers ("steps") belongs to the parent and
// says how the tasks directly under it run: numbers in order (one can't start until the one before is done), bullets at the same time.

// Who a task is for (migration 074; Liz 2026-11-08): its Assigned to person, then the others it is shared with (also_assigned), each once.
export function peopleOf(t) {
  const out = [];
  for (const id of [t && t.assignee_id].concat((t && t.also_assigned) || [])) if (id && !out.includes(id)) out.push(id);
  return out;
}
// True when the task is for this person (alone or as one of a few).
export const isFor = (t, id) => !!id && peopleOf(t).includes(id);

// A task's priority (migration 090; Home step 3, picture 96): the picks in order, and the word for one ('' for None, the default).
// Used by + Add a task's extras, the task card and the tag on Home's My to-do rows.
export const PRIORITIES = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
export const priorityWords = p => (PRIORITIES.find(x => x[0] === p) || [, ''])[1];
// Their names for a chip or a line: "Ann, Tess" ('' for nobody). names: person id → name.
export const peopleNames = (t, names) => peopleOf(t).map(id => (names || {})[id] || 'Someone no longer on the list').join(', ');

// ===== + Add a task (picture 83, Liz 2026-11-08; the flow is picture 82) =====
// "Example Teacher's to-do" for one person, "the to-do of Ann, Bea and Tess" for a few. names: their names, in order.
export function toDoOf(names) {
  const n = (names || []).filter(Boolean);
  if (n.length <= 1) return (n[0] || 'Someone') + '\'s to-do';
  return 'the to-do of ' + n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}
// A task's website link (migration 076), tidied: "procare.com/login" → "https://procare.com/login". '' for nothing typed, null for
// something that isn't a website address (only http and https, never javascript: or data:; it needs a dot in the name).
export function cleanLink(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.') || /\s/.test(t)) return null;
    return u.href;
  } catch (e) { return null; }
}
// "Mon, Wed" from ['wed', 'mon'] (Monday first).
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export function dayNames(days) { return (days || []).slice().sort((x, y) => DAY_ORDER.indexOf(x) - DAY_ORDER.indexOf(y)).map(d => DAY_NAMES[d] || d).join(', '); }
// Where the answers so far put the task, or null while that isn't decided yet. a: { who: 'general' | [ids], repeat: 'no' | 'every' |
// 'days' | 'once', days, group (a Daily tasks group, '' for none), project: id | null | undefined, category: id | null | undefined, parent: id }. ctx: { names(ids) → [names],
// projectName(id), categoryName(id), parentTitle(id) }. Returns { kind: 'project' | 'category' | 'oneoff' | 'mine' | 'daily' | 'automation',
// text, ready } — ready is false for a daily task this person can't add (ctx.canDaily false) and for automations (not built).
export function goesTo(a, ctx) {
  if (!a || !a.who || !a.repeat) return null;
  const people = a.who === 'general' ? [] : a.who, names = people.length ? ctx.names(people) : [];
  if (a.repeat === 'every' || a.repeat === 'days') {
    // General + repeats: a daily task in a Daily tasks group (a.group: its name, '' for none; undefined while that's still asked)
    if (!people.length) {
      if (a.group === undefined) return null;
      const when = a.repeat === 'every' ? 'every day' : 'on ' + dayNames(a.days);
      return { kind: 'daily', text: 'A daily task on Daily Flow' + (a.group ? ' in ' + a.group : '') + ', ' + when, ready: ctx.canDaily !== false };
    }
    return { kind: 'automation', text: 'An automation for ' + names.join(' and '), ready: false };
  }
  if (a.repeat === 'once') return { kind: 'oneoff', text: 'One-off on ' + toDoOf(names) + ' (added once for now)', ready: true };
  if (a.project === undefined) return null;
  if (a.project) {
    const under = a.parent ? ', under ' + ctx.parentTitle(a.parent) : '';
    return { kind: 'project', text: 'Project task in ' + ctx.projectName(a.project) + under + (names.length ? ', for ' + names.join(' and ') : ''), ready: true };
  }
  if (a.category === undefined) return null;
  if (a.category) {
    const under = a.parent ? ', under ' + ctx.parentTitle(a.parent) : '';
    return { kind: 'category', text: 'Category task in ' + ctx.categoryName(a.category) + under + (names.length ? ' and on ' + toDoOf(names) : ''), ready: true };
  }
  if (!names.length) return { kind: 'mine', text: 'On your to-do until you assign it', ready: true };
  return { kind: 'oneoff', text: 'One-off on ' + toDoOf(names), ready: true };
}

export const STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', waiting_on: 'Waiting on', done: 'Done' };

// The tasks under each parent, in order ('' = straight under the project). Archived tasks are left out.
export function childrenOf(tasks) {
  const m = new Map();
  for (const t of tasks || []) {
    if (t.archived) continue;
    const k = t.parent_id || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  for (const list of m.values()) list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return m;
}

// The ids of tasks that are "Waiting its turn": under numbers, every task after one that isn't done; and everything under such a task.
export function waitingIds(tasks, projectSteps) {
  const kids = childrenOf(tasks), waiting = new Set();
  (function walk(parent, steps, parentWaits) {
    let blocked = false;
    for (const t of kids.get(parent) || []) {
      const waits = parentWaits || (steps === 'numbers' && blocked);
      if (waits && t.status !== 'done') waiting.add(t.id);
      if (steps === 'numbers' && t.status !== 'done') blocked = true;
      walk(t.id, t.steps, waits);
    }
  })('', projectSteps, false);
  return waiting;
}

// "Nov 12" from "2026-11-12" (read as a plain date, so no time zone can move it a day).
// A task's time (migration 083) in words: '15:30:00' → '3:30 PM'; '' for no time.
export function timeWords(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  if (!m) return '';
  return timeClock(time);      // site/time-lib.js
}
// The hour of a task's time as a number, for My day's hour rows: '15:30:00' → 15.5; null for no time.
export function timeHours(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  return m ? +m[1] + (+m[2]) / 60 : null;
}
// My day (running list item 34a): the open tasks for this person due on this date that have a time, soonest first. A task for a few
// people is on each one's day; done tasks leave it.
export function timedTasksOn(tasks, personId, date) {
  return (tasks || []).filter(t => t.status !== 'done' && t.due_time && String(t.due_date || '').slice(0, 10) === date && isFor(t, personId))
    .sort((a, b) => timeHours(a.due_time) - timeHours(b.due_time));
}

export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]);
}

// "1 of 3 done" for the tasks straight under the project (or under one task).
export function doneCount(list) {
  const all = (list || []).filter(t => !t.archived);
  return { done: all.filter(t => t.status === 'done').length, total: all.length };
}

// Today as "2026-11-07", on this computer's clock (the school's own time: Mountain time).
export function todayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// True while an open task's Start date is still ahead (migration 071; Liz 2026-11-07): it says "Starts Nov 20" and isn't a next step yet.
export function notStartedYet(t, today) { return !!t.start_date && t.status !== 'done' && String(t.start_date).slice(0, 10) > (today || todayISO()); }

// Every row of List + All (picture 78), in order: the task, how deep it sits, its marker ("1." or "•"), whether it waits its turn, whether it
// is the next step (the first open one under numbers), whether it has sub-tasks (and is folded), and its status words. folded: task ids
// whose sub-tasks are hidden. names: person id → name, for "Waiting on Ann". today: "2026-11-07" (for Start dates; default today).
export function projectRows(project, tasks, folded, names, today) {
  const kids = childrenOf(tasks), waiting = waitingIds(tasks, project.steps), rows = [];
  folded = folded || new Set(); names = names || {};
  (function walk(parent, steps, depth) {
    const list = kids.get(parent) || [];
    const next = steps === 'numbers' ? list.find(t => t.status !== 'done' && !waiting.has(t.id) && !notStartedYet(t, today)) : null;
    list.forEach((t, i) => {
      const subs = kids.get(t.id) || [];
      const row = { task: t, depth, marker: steps === 'numbers' ? (i + 1) + '.' : '•', waiting: waiting.has(t.id), next: next === t,
        subs: subs.length, folded: subs.length > 0 && folded.has(t.id), starts: notStartedYet(t, today) };
      row.status = statusWords(t, subs, row, names, today);
      rows.push(row);
      if (subs.length && !row.folded) walk(t.id, t.steps, depth + 1);
    });
  })('', project.steps, 0);
  return rows;
}

// A task's status words in the list (picture 78): Done ✓, Waiting its turn, Starts Nov 20, "1 of 3 done · in order", Waiting on Ann,
// Next · due Nov 12, Open.
export function statusWords(t, subs, row, names, today) {
  if (t.status === 'done') return 'Done ✓';
  if (row.waiting) return 'Waiting its turn';
  if (notStartedYet(t, today)) return 'Starts ' + shortDate(t.start_date);
  let s;
  if (subs && subs.length) { const c = doneCount(subs); s = c.done + ' of ' + c.total + ' done · ' + (t.steps === 'numbers' ? 'in order' : 'same time'); }
  else if (t.status === 'waiting_on') s = 'Waiting on ' + ((names || {})[t.assignee_id] || 'someone');
  else if (row.next) s = 'Next';
  else if (t.status === 'in_progress') s = 'In progress';
  else s = 'Open';
  if (t.due_date && !(subs && subs.length)) s += ' · due ' + shortDate(t.due_date);
  return s;
}

// Where a task sits, for the opened card (picture 79): the tasks above it, top first, and "step 2 of 3, in order" or "one of 3, same time".
export function taskPlace(project, tasks, id) {
  const byId = new Map((tasks || []).map(t => [t.id, t])), kids = childrenOf(tasks);
  const t = byId.get(id); if (!t) return null;
  const above = [];
  for (let p = t.parent_id ? byId.get(t.parent_id) : null; p; p = p.parent_id ? byId.get(p.parent_id) : null) above.unshift(p);
  const parent = above[above.length - 1];
  const steps = parent ? parent.steps : project.steps;
  const sibs = kids.get(t.parent_id || '') || [];
  const n = sibs.findIndex(s => s.id === id) + 1;
  const where = steps === 'numbers' ? 'step ' + n + ' of ' + sibs.length + ', in order' : (sibs.length > 1 ? 'one of ' + sibs.length + ', same time' : 'the only task here');
  return { above, steps, number: n, count: sibs.length, where };
}

// The tasks a task can be put under with Edit ▾ › Put under: every other task in the project except its own sub-tasks (and its parent now).
export function possibleParents(tasks, id) {
  const kids = childrenOf(tasks), mine = new Set([id]);
  (function walk(p) { for (const c of kids.get(p) || []) { mine.add(c.id); walk(c.id); } })(id);
  const me = (tasks || []).find(t => t.id === id);
  return (tasks || []).filter(t => !t.archived && !mine.has(t.id) && (!me || t.id !== me.parent_id));
}

// null when the New project form can be saved, otherwise a sentence (part 3: a name and a category; an end date or No end date).
// projects: the ones this person can see; a name another of them already has is refused (p.id: the project being edited).
// The database refuses it too (migration 073), for projects this person can't see.
export function projectProblem(p, projects) {
  if (!String(p.name || '').trim()) return 'Give the project a name.';
  if ((projects || []).some(x => x.id !== p.id && nameKey(x.name) === nameKey(p.name))) return takenName(p.name);
  if (!p.category_id) return 'Pick a category.';
  // the end date is a date or none: "No end date" (picture 81, agreed 2026-11-08)
  if (p.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.end_date))) return 'Pick an end date, or No end date.';
  return null;
}

// ===== Next steps (picture 79, panels 1 and 2) =====

// What can be worked on now: for every open task that isn't waiting its turn, down to the lowest level, one item per "card":
//   { task, open: [its open sub-tasks that can start now], label } — a task with only plain sub-tasks shows the ones that can start
//   ("Gear Inventory › 2. Count helmets", "Area Clean-Up › Bins, Floor"); a task with no sub-tasks is its own item ("Toy Labels");
//   a task whose sub-tasks have sub-tasks of their own is looked into instead. Done and waiting tasks are left out.
export function nextSteps(project, tasks, today) {
  const kids = childrenOf(tasks), waiting = waitingIds(tasks, project.steps), items = [];
  const canStart = t => t.status !== 'done' && !waiting.has(t.id) && !notStartedYet(t, today);
  (function walk(parent) {
    for (const t of kids.get(parent) || []) {
      if (!canStart(t)) continue;
      const subs = kids.get(t.id) || [];
      if (!subs.length) { items.push({ task: t, open: [], label: t.title }); continue; }
      if (subs.some(s => (kids.get(s.id) || []).length)) { walk(t.id); continue; }
      const open = subs.filter(canStart);
      if (!open.length) { items.push({ task: t, open: [], label: t.title }); continue; }     // its sub-tasks are done: the task itself is next
      const words = t.steps === 'numbers' ? open.map(s => (subs.indexOf(s) + 1) + '. ' + s.title).join(', ') : open.map(s => s.title).join(', ');
      items.push({ task: t, open, label: t.title + ' › ' + words });
    }
  })('');
  return items;
}

// What comes after (Expand ▾): the open tasks still waiting their turn or their Start date, in list order.
export function laterSteps(project, tasks, today) {
  const waiting = waitingIds(tasks, project.steps);
  return projectRows(project, tasks, null, null, today).map(r => r.task).filter(t => t.status !== 'done' && (waiting.has(t.id) || notStartedYet(t, today)));
}

// ===== Home and the card (build step 6) =====

// The grey "where it's from" line under a task on Home's My to-do (picture 76; Liz 2026-11-08): a project task gives the project and the
// tasks above it ("Building Organization › Sort and Clean"), a category task its category ("Lions Den"), a one-off "One-off · from Ann".
// home: the task's project, or the stand-in for its category ({ standIn, category_id, name }) or the one-off tasks ({ id: 'one-off' }).
// addedBy: who made it, when that's someone else.
export function todoFrom(home, task, tasks, addedBy) {
  if (!home || home.id === 'one-off') return 'One-off' + (addedBy ? ' · from ' + addedBy : '');
  let where = home.name;
  if (!home.standIn) {
    const place = taskPlace(home, tasks, task.id);
    if (place) where = [home.name].concat(place.above.map(t => t.title)).join(' › ');
  }
  return where + (addedBy ? ' · added by ' + addedBy : '');
}

// Home's Helper column (Liz 2026-11-08): the people on a task's open sub-tasks, at any level below it, each once, leaving out the person
// whose to-do it is. names: person id → name. Returns "Ann, Tess" or ''.
export function subtaskHelpers(tasks, id, names, exceptId) {
  const kids = childrenOf(tasks), out = [];
  (function walk(parent) {
    for (const t of kids.get(parent) || []) {
      if (t.status !== 'done') for (const pid of peopleOf(t)) {
        const n = pid !== exceptId ? (names || {})[pid] || '' : '';
        if (n && !out.includes(n)) out.push(n);
      }
      walk(t.id);
    }
  })(id);
  return out.join(', ');
}

// The line under a pinned project's next steps on Home (picture 76): the first numbered task still waiting its turn, and what it waits
// for: "3. Set Up Toy Libraries waits until Sort and Clean is done". The one nearest the top wins. '' when nothing is waiting its turn.
export function waitingNote(project, tasks) {
  const kids = childrenOf(tasks), waiting = waitingIds(tasks, project.steps);
  let best = null;
  (function walk(parent, steps, depth) {
    const list = kids.get(parent) || [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (waiting.has(t.id)) {
        const before = steps === 'numbers' ? list.slice(0, i).filter(b => b.status !== 'done').map(b => b.title) : [];
        if (before.length && (!best || depth < best.depth)) best = { depth, text: (i + 1) + '. ' + t.title + ' waits until ' + before.join(' and ') + (before.length > 1 ? ' are' : ' is') + ' done' };
        break;      // everything after it here waits too, and so does everything under it
      }
      walk(t.id, t.steps, depth + 1);
    }
  })('', project.steps, 0);
  return best ? best.text : '';
}

// "Where did I leave off?" (part 3, On Home): the task in this project the person last changed or commented on (touches: newest first,
// [{ task_id, at }]); null when they haven't touched it yet.
export function leftOffTask(tasks, touches) {
  const here = new Map((tasks || []).filter(t => !t.archived).map(t => [t.id, t]));
  for (const x of touches || []) if (here.has(x.task_id)) return here.get(x.task_id);
  return null;
}

// The card's list (picture 80, panel 3): open projects grouped by category, in the categories' order, then any with no category.
// Returns [{ category: { id, name } | null, projects: [...] }], each group sorted by name.
export function projectsByCategory(projects, categories) {
  const open = (projects || []).filter(p => p.status !== 'completed');
  const groups = (categories || []).map(c => ({ category: c, projects: open.filter(p => p.category_id === c.id) }));
  const known = new Set((categories || []).map(c => c.id));
  groups.push({ category: null, projects: open.filter(p => !known.has(p.category_id)) });
  groups.forEach(g => g.projects.sort((a, b) => String(a.name).localeCompare(String(b.name))));
  return groups.filter(g => g.projects.length);
}

// The database calls (migrations 067 to 072).
export function makeTasksApi(sb) {
  return {
    // ---- Settings › Task Categories (migration 067; read by everyone, changed by the main admin) ----
    async taskCategories() {
      return must(await sb.from('task_categories').select('id, name, description, sort_order, archived').order('sort_order').order('name'));
    },
    async addTaskCategory(c) {
      return must(await sb.from('task_categories').insert({ name: c.name.trim(), description: (c.description || '').trim(), sort_order: c.sort_order }).select('id').single());
    },
    async saveTaskCategory(id, patch) { must(await sb.from('task_categories').update(patch).eq('id', id)); },

    // ---- who can be given a task (migration 069): [{ id, name, role }] ----
    async taskPeople() { return must(await sb.rpc('task_people')) || []; },

    // ---- projects (migration 068; the database shows each person only the projects they may see) ----
    async projects() {
      return must(await sb.from('projects').select('id, name, description, category_id, end_date, owner_id, sharing, steps, on_daily_flow, link, card_key, status, completed_at, completed_by, created_by, created_at')
        .eq('archived', false).order('end_date', { nullsFirst: false }).order('name'));
    },
    async addProject(p) { return mustName(await sb.from('projects').insert(p).select('id').single(), p.name); },
    async saveProject(id, patch) { mustName(await sb.from('projects').update(patch).eq('id', id), patch.name); },
    // Every share the person may see (of the projects they see): [{ project_id, profile_id, level }].
    async projectShares() { return must(await sb.from('project_shares').select('project_id, profile_id, level')); },
    // Replaces who a project is shared with: [{ profile_id, level: 'view' | 'edit' }].
    async setProjectShares(projectId, shares) {
      must(await sb.from('project_shares').delete().eq('project_id', projectId));
      if (shares && shares.length) must(await sb.from('project_shares').insert(shares.map(s => ({ project_id: projectId, profile_id: s.profile_id, level: s.level }))));
    },

    // ---- tasks: every task the person may see (project, category and one-off tasks; the database decides) ----
    async workTasks() {
      return must(await sb.from('work_tasks').select('id, title, project_id, category_id, parent_id, steps, sort_order, status, assignee_id, also_assigned, start_date, due_date, due_time, priority, description, how_to, notes, link, done_at, done_by, created_by, created_at')
        .eq('archived', false));
    },
    async addWorkTask(t) { return must(await sb.from('work_tasks').insert(t).select('id').single()); },
    async saveWorkTask(id, patch) { must(await sb.from('work_tasks').update(patch).eq('id', id)); },
    // Status goes through the database (Waiting on hands the task to the person picked; the person it is assigned to may always change it).
    async setTaskStatus(id, status, personId) { must(await sb.rpc('set_task_status', { p_task: id, p_status: status, p_person: personId || null })); },
    // Priority (migration 090): 'high', 'medium', 'low' or '' for None; the people a task is for may set it too (My to-do's tag).
    async setTaskPriority(id, priority) { must(await sb.rpc('set_task_priority', { p_task: id, p_priority: priority || '' })); },
    async taskComments(taskId) { return must(await sb.from('work_task_comments').select('id, author_id, body, created_at').eq('task_id', taskId).order('created_at')); },
    async addTaskComment(taskId, body) { must(await sb.from('work_task_comments').insert({ task_id: taskId, body: String(body || '').trim() })); },
    // ---- a project on someone's Home (project_pins, migration 068): their own, or the main admin pins it for them ----
    async myProjectPins(me) { return (must(await sb.from('project_pins').select('project_id').eq('profile_id', me)) || []).map(r => r.project_id); },
    async projectPinnedFor(projectId) { return (must(await sb.from('project_pins').select('profile_id').eq('project_id', projectId)) || []).map(r => r.profile_id); },
    async pinProject(projectId, personId) { must(await sb.from('project_pins').insert({ project_id: projectId, profile_id: personId })); },
    async unpinProject(projectId, personId) { must(await sb.from('project_pins').delete().eq('project_id', projectId).eq('profile_id', personId)); },
    // What this person last changed or commented on, newest first: [{ task_id, at }] (for "Where did I leave off?").
    async myTaskTouches(me) {
      const [h, c] = await Promise.all([
        sb.from('work_task_history').select('task_id, changed_at').eq('changed_by', me).order('changed_at', { ascending: false }).limit(200),
        sb.from('work_task_comments').select('task_id, created_at').eq('author_id', me).order('created_at', { ascending: false }).limit(200)]);
      return must(h).map(r => ({ task_id: r.task_id, at: r.changed_at })).concat(must(c).map(r => ({ task_id: r.task_id, at: r.created_at })))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },
    async myTaskPins() { return (must(await sb.from('work_task_pins').select('task_id')) || []).map(r => r.task_id); },
    async pinTask(taskId, me) { must(await sb.from('work_task_pins').insert({ task_id: taskId, profile_id: me })); },
    async unpinTask(taskId, me) { must(await sb.from('work_task_pins').delete().eq('task_id', taskId).eq('profile_id', me)); },
  };
}
