// Connects the tracker page (tracker.html) to the new database:
//  - sign in with email (or a login name) + password (real accounts), then tell the page who the person is
//  - a person who was given a temporary password must choose their own before anything else
//  - work out what the person may open (the Off / View / Edit switches) and tell the page
//  - hand the page its window.storage, backed by the database tables
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { createStorage, supabaseDb } from './storage-adapter.js';
import * as peopleLib from './people-lib.js';
import * as billingLib from './billing-lib.js';
import * as enrollmentLib from './enrollment-lib.js';
import * as icalLib from './ical-lib.js';
import * as tasksLib from './tasks-lib.js';
import * as automationsLib from './automations-lib.js';
const { loginFrom, effectiveLevels, passwordProblem, makePeopleApi } = peopleLib;
window.__billingLib = billingLib;   // the Family bills rules (site/billing-lib.js)
window.__calendarLib = icalLib;   // Google Calendar events out of .ics text (site/ical-lib.js)
window.__enrollmentLib = enrollmentLib;   // the My kids week grid (site/enrollment-lib.js)
window.__peopleLib = peopleLib;   // the People screen and the tab layout use these

// Read before the sign-in library tidies the address bar: did they come from the welcome email's link (People plan step 7)?
const cameFrom = peopleLib.linkResult(location.hash + location.search);
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const showError = text => { $('loginError').textContent = text || ''; };
let entered = false;

// Notification emails to the admin are not wired up yet (the old version used Google's mail).
// Until they are, the live Google tracker keeps sending them; here we only log.
window.__platformNotify = (subject, body) => { console.info('[notification not sent yet]', subject, body); };

// The People screen talks to the database through this (so it can be tested without one).
// Tasks and Projects (site/tasks-lib.js) and Automations (site/automations-lib.js) add their own calls to the same object, so cards reach every call one way.
window.__peopleApi = Object.assign(makePeopleApi(sb), tasksLib.makeTasksApi(sb), automationsLib.makeAutomationsApi(sb));
window.__tasksLib = tasksLib;
window.__automationsLib = automationsLib;

async function enter(session) {
  if (entered) return;
  if (session.user.user_metadata && session.user.user_metadata.must_change_password) { askNewPassword(session); return; }
  const { data: prof, error } = await sb.from('profiles')
    .select('display_name, role, custom_role_id, classroom, dens, scope, person_name, active, days_view').eq('id', session.user.id).maybeSingle();
  if (error) { showError('Could not check your account: ' + error.message); return; }
  if (!prof) { showError('You are signed in, but have no access yet. Ask the admin to set you up.'); await sb.auth.signOut(); return; }
  if (!prof.active) { showError('This login is switched off. Ask the admin.'); await sb.auth.signOut(); return; }
  if (prof.role === 'parent') { showError('The parent area is not open yet.'); await sb.auth.signOut(); return; }
  if ((prof.role === 'classroom' || prof.role === 'staff') && prof.scope === 'den' && !prof.classroom) {
    showError('Your account is not linked to a den yet. Ask the admin.'); await sb.auth.signOut(); return;
  }

  // What this person may open: their role's starting levels (or their custom role's pages, migration 066), then their own switches on top.
  const [areas, defaults, own] = await Promise.all([
    sb.from('access_areas').select('key'),
    prof.custom_role_id ? sb.from('custom_role_pages').select('area_key, level').eq('role_id', prof.custom_role_id)
      : sb.from('role_defaults').select('area_key, level').eq('role', prof.role),
    sb.from('person_access').select('area_key, level').eq('profile_id', session.user.id),
  ]);
  const failed = [areas, defaults, own].find(r => r.error);
  if (failed) { showError('Could not check your access: ' + failed.error.message); return; }
  const access = effectiveLevels(prof.role, areas.data.map(a => a.key), defaults.data, own.data);

  // Someone with more than one den (migration 064) works in one at a time: the one they picked on the top bar this session,
  // or their first den. tools/tracker-den-switch.js draws the switcher.
  const dens = peopleLib.densOf(prof);
  let saved = null; try { saved = sessionStorage.getItem('ajaxCubsActiveDen'); } catch (e) {}
  const den = peopleLib.activeDen(dens, saved);
  entered = true;
  window.__who = {
    id: session.user.id, name: prof.display_name, role: prof.role, den, dens, scope: prof.scope,
    personName: prof.person_name || '', daysView: prof.days_view, access, customRoleId: prof.custom_role_id || null,
  };
  window.__platformResolve(createStorage(supabaseDb(sb)));
  // The page has two ways of looking: the full one (admin, admin assistant) and the one-den one
  // (everyone else). What each person can actually open and change is decided by their switches.
  const full = prof.role === 'admin' || prof.role === 'assistant';
  window.unlockApp(full ? { role: 'admin' } : { role: 'classroom', classroom: den });
  if (window.__lockName) window.__lockName();   // someone with their own login signs comments as themselves
}

// ---- first sign-in with a temporary password: choose your own ----
function askNewPassword(session) {
  const box = document.createElement('div');
  box.id = 'newPasswordOverlay';
  box.style.cssText = 'position:fixed; inset:0; background:var(--paper); z-index:1100; display:flex; align-items:center; justify-content:center; padding:20px;';
  box.innerHTML = '<div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:24px; width:100%; max-width:360px;">' +
    (cameFrom === 'welcome'
      ? '<h2 style="margin:0 0 6px; font-size:20px;">Welcome to Ajax Cubs</h2>' +
        '<p class="sub" style="margin:0 0 14px;">Choose your password (at least 12 characters). After this you sign in with your email and this password.</p>'
      : '<h2 style="margin:0 0 6px; font-size:20px;">Choose your own password</h2>' +
        '<p class="sub" style="margin:0 0 14px;">You signed in with a temporary password. Pick a new one that only you know (at least 12 characters).</p>') +
    '<input type="password" id="newPw1" placeholder="New password" autocomplete="new-password" style="width:100%; font-size:15px; padding:9px 10px; border:1px solid var(--line); border-radius:6px; margin-bottom:10px; box-sizing:border-box;">' +
    '<input type="password" id="newPw2" placeholder="Type it again" autocomplete="new-password" style="width:100%; font-size:15px; padding:9px 10px; border:1px solid var(--line); border-radius:6px; margin-bottom:10px; box-sizing:border-box;">' +
    '<button class="primary" id="newPwBtn" style="width:100%;">Save and continue</button>' +
    '<div id="newPwError" style="color:var(--amber); font-size:13px; margin-top:10px; min-height:16px;"></div></div>';
  document.body.appendChild(box);
  const err = t => { $('newPwError').textContent = t || ''; };
  async function save() {
    err('');
    const p1 = $('newPw1').value, p2 = $('newPw2').value;
    const problem = passwordProblem(p1, p2);
    if (problem) { err(problem); return; }
    $('newPwBtn').disabled = true;
    const { data, error } = await sb.auth.updateUser({ password: p1, data: { must_change_password: false } });
    $('newPwBtn').disabled = false;
    if (error) { err(error.message); return; }
    box.remove();
    const { data: { session: fresh } } = await sb.auth.getSession();
    await enter(fresh || { ...session, user: data.user });
  }
  $('newPwBtn').addEventListener('click', save);
  ['newPw1', 'newPw2'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') save(); }));
  $('newPw1').focus();
}

async function signIn() {
  showError('');
  const typed = $('loginEmailInput').value.trim();
  const password = $('loginPasswordInput').value;
  if (!typed || !password) { showError('Enter your login and password.'); return; }
  $('loginSubmitBtn').disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email: loginFrom(typed), password });
  $('loginSubmitBtn').disabled = false;
  if (error) { showError('Sign-in failed: ' + error.message); return; }
  $('loginPasswordInput').value = '';
  await enter(data.session);
}

$('loginSubmitBtn').addEventListener('click', signIn);
['loginEmailInput', 'loginPasswordInput'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); }));

// A reload resets the page completely (the role restrictions hide elements in place and have no "undo").
$('logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

// The welcome email's link ran out or was used already: say what to do.
if (cameFrom === 'expired') showError('That set-your-password link has run out or was used already. Ask the office to send a new welcome email.');

// Already signed in on this browser: skip the form.
sb.auth.getSession().then(({ data: { session } }) => { if (session) enter(session); });
