// The VA training program (moved here from the separate training tracker app).
//
// A training pairs a trainee with a trainer (a current VA) and works through the same day-by-day
// checklist. The trainer marks each item Covered or Carried over (it then shows again on the next
// days until covered) and keeps notes; the trainee keeps their own notes. Both sign off each day,
// or an admin signs a day off for them. Only admins start trainings and change the checklist.
//
// "Onboarding Training" is for new hires: while it runs, they see only their training in the app,
// and they can log in even before they are an Active VA. Back-Up and After-Hours trainings are for
// current VAs, who keep all their usual pages.
//
// Hiring link: an admin can start an Onboarding Training from an applicant's page (Hiring). The
// training remembers the applicant (trainings.applicant_id); starting it moves the applicant to
// "In training", and marking it complete moves them to "Training done" (see applicantEvent in records.js).
//
// Self-paced modules: before Day 1 of an Onboarding Training, the trainee goes through short online
// modules (iSpring links, table training_modules, edited by admins on the checklist page). The links
// cannot tell the app who finished them, so the trainee (or an admin) presses "I finished this module".
// Unfinished modules never block Day 1; the trainer and admins just see a warning.

import { redirect, page, isDate } from './util.js';
import { partsIn, addDays, weekdayOf, REPORT_ZONE } from './time.js';
import { sendInvite } from './invites.js';
import { applicantEvent } from './records.js';
import * as tv from './training-views.js';

export const ONBOARDING = 'Onboarding Training';
export const KINDS = [ONBOARDING, 'Back-Up', 'After-Hours'];
const STATUSES = ['active', 'paused', 'completed', 'cancelled'];
const ITEM_STATUSES = ['not_started', 'covered', 'carried_over'];
// A training still active after this many workdays (Monday to Friday, counting the first day) is late.
const DUE_WORKDAYS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Hiring steps from which "Start training" moves an applicant to In training, and from which completing
// their training moves them to Training done. Applicants at later steps (or closed) are not moved.
const BEFORE_TRAINING = ['Offer sent', 'Training pending'];
const BEFORE_DONE = [...BEFORE_TRAINING, 'In training'];

const today = () => partsIn(REPORT_ZONE).date;

// Only Onboarding Trainings have the self-paced modules.
export const hasModules = (t) => t.kind === ONBOARDING;

// A link typed by an admin, kept only when it is a full http(s) address.
function httpLink(text) {
  try {
    const u = new URL(String(text || '').trim());
    return ['http:', 'https:'].includes(u.protocol) && u.href.length <= 2000 ? u.href : null;
  } catch {
    return null;
  }
}

// Workdays from the start date to today, counting both.
export function workdaysSince(start, end = today()) {
  if (!isDate(start) || start > end) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!['Sat', 'Sun'].includes(weekdayOf(d))) n++;
  return n;
}

export const isLate = (t) => t.status === 'active' && workdaysSince(t.start_date) > DUE_WORKDAYS;

// ---- Reading ----

const TRAINING_SQL = `SELECT t.*, te.name AS trainee_name, te.email AS trainee_email, tr.name AS trainer_name, ap.name AS applicant_name
  FROM trainings t JOIN users te ON te.id = t.trainee_id JOIN users tr ON tr.id = t.trainer_id
  LEFT JOIN records ap ON ap.id = t.applicant_id AND ap.module = 'applicants'`;

// Trainings a person is in right now (active or paused), as trainee or trainer. index.js adds them
// to the logged-in person, for the menu and to show new hires only their training.
export async function myTrainings(env, userId) {
  const { results } = await env.DB.prepare(
    `${TRAINING_SQL} WHERE (t.trainee_id = ?1 OR t.trainer_id = ?1) AND t.status IN ('active', 'paused') ORDER BY t.start_date`
  ).bind(userId).all();
  return results;
}

// The checklist: [{ id, day_number, title, items: [...] }], in order.
export async function checklist(env) {
  const [{ results: days }, { results: items }] = await Promise.all([
    env.DB.prepare('SELECT * FROM training_days ORDER BY day_number').all(),
    env.DB.prepare('SELECT * FROM training_items ORDER BY day_id, position, id').all(),
  ]);
  return days.map((d) => ({ ...d, items: items.filter((i) => i.day_id === d.id) }));
}

// Progress of one training against the checklist: counts, which days are signed off, and the
// current day (the first day not signed off yet, or the last day when all are).
export function summarize(days, progress, signoffs) {
  const items = days.flatMap((d) => d.items);
  const status = (id) => progress.get(id)?.status || 'not_started';
  const signed = (d) => {
    const s = signoffs.get(d.id);
    return Boolean(s && (s.admin_at || (s.trainer_at && s.trainee_at)));
  };
  const current = days.find((d) => !signed(d)) || days[days.length - 1] || null;
  return {
    total: items.length,
    covered: items.filter((i) => status(i.id) === 'covered').length,
    carried: items.filter((i) => status(i.id) === 'carried_over').length,
    daysSigned: days.filter(signed).length,
    allSigned: days.length > 0 && days.every(signed),
    currentDay: current?.day_number || 1,
    signed,
  };
}

// The self-paced modules, in order.
export async function modulesList(env) {
  const { results } = await env.DB.prepare('SELECT * FROM training_modules ORDER BY position, id').all();
  return results;
}

// Finished modules of each training: Map(training id -> Map(module id -> { finished_at, finished_by })).
async function moduleProgressOf(env, ids) {
  const done = new Map(ids.map((id) => [id, new Map()]));
  if (!ids.length) return done;
  const { results } = await env.DB.prepare('SELECT * FROM training_module_progress WHERE training_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids)).all();
  for (const r of results) done.get(r.training_id)?.set(r.module_id, r);
  return done;
}

// How many of the modules a training has finished, or null when it has none (not an Onboarding Training,
// or no modules on the list).
function moduleCount(t, modules, done) {
  if (!hasModules(t) || !modules.length) return null;
  return { done: modules.filter((m) => done?.has(m.id)).length, total: modules.length };
}

async function progressOf(env, ids) {
  const progress = new Map();
  const signoffs = new Map();
  if (!ids.length) return { progress, signoffs };
  const list = JSON.stringify(ids);
  const [{ results: p }, { results: s }] = await Promise.all([
    env.DB.prepare('SELECT * FROM training_progress WHERE training_id IN (SELECT value FROM json_each(?))').bind(list).all(),
    env.DB.prepare('SELECT * FROM training_signoffs WHERE training_id IN (SELECT value FROM json_each(?))').bind(list).all(),
  ]);
  for (const id of ids) { progress.set(id, new Map()); signoffs.set(id, new Map()); }
  for (const r of p) progress.get(r.training_id).set(r.item_id, r);
  for (const r of s) signoffs.get(r.training_id).set(r.day_id, r);
  return { progress, signoffs };
}

// Trainings with their progress summary, for lists.
async function withSummaries(env, trainings, days) {
  const ids = trainings.map((t) => t.id);
  const [{ progress, signoffs }, modules, done] = await Promise.all([progressOf(env, ids), modulesList(env), moduleProgressOf(env, ids)]);
  return trainings.map((t) => ({
    ...t, late: isLate(t), workdays: workdaysSince(t.start_date), sum: summarize(days, progress.get(t.id), signoffs.get(t.id)),
    mods: moduleCount(t, modules, done.get(t.id)),
  }));
}

// The trainings started from an applicant's page, newest first, with their progress (for that page).
export async function applicantTrainings(env, applicantId) {
  const days = await checklist(env);
  const { results } = await env.DB.prepare(`${TRAINING_SQL} WHERE t.applicant_id = ? ORDER BY t.id DESC`).bind(applicantId).all();
  return { trainings: await withSummaries(env, results, days), dayCount: days.length };
}

// The person's part in a training: trainer, trainee, admin (anyone else who is an admin), or null.
function roleIn(t, user) {
  if (t.trainer_id === user.id) return 'trainer';
  if (t.trainee_id === user.id) return 'trainee';
  return user.is_admin ? 'admin' : null;
}

// ---- Pages for everyone in a training: /training and /training/<id> ----

export async function trainingRoutes(env, user, path, method, field, message, url) {
  let m;

  if (path === '/training' && method === 'GET') {
    const mine = user.trainings || [];
    if (!mine.length && user.is_admin) return redirect('/admin/training');
    const { results: finished } = await env.DB.prepare(
      `${TRAINING_SQL} WHERE (t.trainee_id = ?1 OR t.trainer_id = ?1) AND t.status IN ('completed', 'cancelled') ORDER BY t.finished_at DESC LIMIT 20`
    ).bind(user.id).all();
    // Just one training and nothing finished (for example a new hire): open it directly.
    if (mine.length === 1 && (!finished.length || user.in_training)) {
      return redirect(`/training/${mine[0].id}${message ? `?msg=${encodeURIComponent(message)}` : ''}`);
    }
    const days = await checklist(env);
    return page(tv.myTrainingsPage({ user, trainings: await withSummaries(env, mine, days), finished, dayCount: days.length, message }));
  }

  if (!(m = path.match(/^\/training\/(\d+)(\/.*)?$/))) return redirect('/training');
  const t = await env.DB.prepare(`${TRAINING_SQL} WHERE t.id = ?`).bind(m[1]).first();
  const role = t ? roleIn(t, user) : null;
  if (!role) return redirect('/training');
  const rest = m[2] || '';

  if (!rest && method === 'GET') return page(await trainingPage(env, user, t, role, Number(url.searchParams.get('day')) || 0, message));

  if (method !== 'POST') return redirect(`/training/${t.id}`);
  const day = Number(field('day')) || '';
  const back = (msg, anchor = '') => redirect(`/training/${t.id}?${new URLSearchParams({ ...(day ? { day } : {}), ...(msg ? { msg } : {}) })}${anchor}`);
  // Finished or paused trainings can be read, not changed.
  if (t.status !== 'active') return back('training-not-active');

  // A self-paced module: the trainee (or an admin) marks it finished, or not finished again (done=0).
  if ((m = rest.match(/^\/module\/(\d+)$/))) {
    const mod = await env.DB.prepare('SELECT id FROM training_modules WHERE id = ?').bind(m[1]).first();
    if (!mod || !hasModules(t) || (role !== 'trainee' && !user.is_admin)) return back();
    if (field('done') === '1') {
      await env.DB.prepare(
        `INSERT INTO training_module_progress (training_id, module_id, finished_at, finished_by) VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT (training_id, module_id) DO NOTHING`
      ).bind(t.id, mod.id, user.id).run();
      return back('module-finished', '#modules');
    }
    await env.DB.prepare('DELETE FROM training_module_progress WHERE training_id = ? AND module_id = ?').bind(t.id, mod.id).run();
    return back('module-not-finished', '#modules');
  }

  // An item: the trainer sets its status and their notes; the trainee saves their own notes.
  if ((m = rest.match(/^\/item\/(\d+)$/))) {
    const item = await env.DB.prepare('SELECT id FROM training_items WHERE id = ?').bind(m[1]).first();
    if (!item || role === 'admin') return back();
    const notes = field('notes').slice(0, 5000) || null;
    if (role === 'trainer') {
      const chosen = field('status');
      const status = ITEM_STATUSES.includes(chosen) ? chosen : null; // "keep" saves only the notes
      await env.DB.prepare(
        `INSERT INTO training_progress (training_id, item_id, status, trainer_notes, updated_by, updated_at)
         VALUES (?1, ?2, COALESCE(?3, 'not_started'), ?4, ?5, datetime('now'))
         ON CONFLICT (training_id, item_id) DO UPDATE SET status = COALESCE(?3, status), trainer_notes = ?4,
           updated_by = ?5, updated_at = datetime('now')`
      ).bind(t.id, item.id, status, notes, user.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO training_progress (training_id, item_id, trainee_notes, updated_by, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT (training_id, item_id) DO UPDATE SET trainee_notes = ?3, updated_by = ?4, updated_at = datetime('now')`
      ).bind(t.id, item.id, notes, user.id).run();
    }
    return back('', `#item-${item.id}`);
  }

  // Signing off a day (trainer or trainee, each for themselves).
  if (rest === '/signoff' && role !== 'admin') {
    const d = await env.DB.prepare('SELECT id FROM training_days WHERE id = ?').bind(field('day_id')).first();
    if (!d) return back();
    const column = role === 'trainer' ? 'trainer_at' : 'trainee_at';
    await env.DB.prepare(
      `INSERT INTO training_signoffs (training_id, day_id, ${column}) VALUES (?, ?, datetime('now'))
       ON CONFLICT (training_id, day_id) DO UPDATE SET ${column} = COALESCE(${column}, excluded.${column})`
    ).bind(t.id, d.id).run();
    return back('day-signed');
  }

  return back();
}

// One training: its days as tabs, the chosen day's items (plus items carried over from earlier days),
// and the day's sign-off. dayNumber: the day asked for in the address (0 = the current day).
async function trainingPage(env, user, t, role, dayNumber, message, extra = {}) {
  const days = await checklist(env);
  const { progress, signoffs } = await progressOf(env, [t.id]);
  const sum = summarize(days, progress.get(t.id), signoffs.get(t.id));
  const wanted = dayNumber || sum.currentDay;
  const day = days.find((d) => d.day_number === wanted) || days.find((d) => d.day_number === sum.currentDay) || days[0];
  const p = progress.get(t.id);
  // Items from earlier days that were carried over and are not covered yet.
  const carried = days.filter((d) => day && d.day_number < day.day_number)
    .flatMap((d) => d.items.filter((i) => p.get(i.id)?.status === 'carried_over').map((i) => ({ ...i, fromDay: d.day_number })));
  const trainee = await env.DB.prepare('SELECT id, name, email, password_hash, must_change_password, invited_at, is_va FROM users WHERE id = ?').bind(t.trainee_id).first();
  const trainers = role === 'admin' ? (await peopleChoices(env)).trainers : [];
  // The self-paced modules, each with its finished row (or null), for Onboarding Trainings.
  let modules = [];
  if (hasModules(t)) {
    const [list, done] = await Promise.all([modulesList(env), moduleProgressOf(env, [t.id])]);
    modules = list.map((mod) => ({ ...mod, done: done.get(t.id).get(mod.id) || null }));
  }
  return tv.trainingPage({
    user, t: { ...t, late: isLate(t), workdays: workdaysSince(t.start_date) }, role, days, day, carried,
    progress: p, signoff: day ? signoffs.get(t.id).get(day.id) || null : null, sum, trainee, trainers, modules, message, ...extra,
  });
}

// ---- Admin pages: /admin/training ----

export async function adminTrainingRoutes(env, user, path, method, field, message, url) {
  let m;
  const days = await checklist(env);

  if (path === '/admin/training' && method === 'GET') {
    const { results: open } = await env.DB.prepare(`${TRAINING_SQL} WHERE t.status IN ('active', 'paused') ORDER BY t.start_date`).all();
    const { results: finished } = await env.DB.prepare(
      `${TRAINING_SQL} WHERE t.status IN ('completed', 'cancelled') ORDER BY t.finished_at DESC LIMIT 50`
    ).all();
    return page(tv.adminTrainingPage({ user, open: await withSummaries(env, open, days), finished, days, choices: await peopleChoices(env), today: today(), message }));
  }

  // Starting a training: from the form on this page, or from an applicant's page (Hiring), which sends
  // applicant_id and always starts an Onboarding Training for the applicant (their name and email).
  if (path === '/admin/training/start' && method === 'POST') {
    const applicantId = Number(field('applicant_id')) || null;
    const applicant = applicantId
      ? await env.DB.prepare("SELECT id, name, email, status FROM records WHERE id = ? AND module = 'applicants'").bind(applicantId).first() : null;
    if (applicantId && !applicant) return redirect('/admin/applicants');
    const fail = (msg) => redirect(applicant ? `/admin/applicants/${applicant.id}?msg=${msg}#training` : `/admin/training?msg=${msg}`);
    const kind = applicant ? ONBOARDING : KINDS.includes(field('kind')) ? field('kind') : null;
    const trainer = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND (is_va = 1 OR is_admin = 1)').bind(field('trainer_id')).first();
    const start = isDate(field('start_date')) ? field('start_date') : null;
    if (!kind || !trainer || !start) return fail('training-missing');
    const trainee = applicant ? await personFor(env, applicant.name, (applicant.email || '').trim().toLowerCase()) : await traineeFromForm(env, field);
    if (!trainee) return fail(applicant ? 'training-no-email' : 'training-no-trainee');
    if (trainee.id === trainer.id) return fail('training-same-person');
    const dup = await env.DB.prepare("SELECT id, applicant_id FROM trainings WHERE trainee_id = ? AND kind = ? AND status IN ('active', 'paused')").bind(trainee.id, kind).first();
    if (dup) {
      // Already in training (for example started on the Training page before): link it to the applicant.
      if (applicant && !dup.applicant_id) {
        await env.DB.prepare('UPDATE trainings SET applicant_id = ? WHERE id = ?').bind(applicant.id, dup.id).run();
        await applicantEvent(env, user, applicant.id, 'Linked to their training', 'In training', BEFORE_TRAINING);
      }
      return redirect(`/training/${dup.id}?msg=training-exists`);
    }
    const res = await env.DB.prepare('INSERT INTO trainings (kind, trainee_id, trainer_id, start_date, created_by, applicant_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(kind, trainee.id, trainer.id, start, user.id, applicant?.id || null).run();
    if (applicant) await applicantEvent(env, user, applicant.id, 'Training started', 'In training', BEFORE_TRAINING);
    return redirect(`/training/${res.meta.last_row_id}?msg=training-started`);
  }

  // Checklist editor.
  if (path === '/admin/training/checklist' || path.startsWith('/admin/training/checklist/')) {
    return checklistRoutes(env, user, path, method, field, message, days);
  }

  if (!(m = path.match(/^\/admin\/training\/(\d+)\/(status|signoff|invite|trainer)$/)) || method !== 'POST') return redirect('/admin/training');
  const t = await env.DB.prepare(`${TRAINING_SQL} WHERE t.id = ?`).bind(m[1]).first();
  if (!t) return redirect('/admin/training');
  const day = Number(field('day')) || '';
  const back = (msg) => redirect(`/training/${t.id}?${new URLSearchParams({ ...(day ? { day } : {}), msg })}`);

  if (m[2] === 'status') {
    const status = STATUSES.includes(field('status')) ? field('status') : null;
    if (!status) return back('saved');
    const finished = ['completed', 'cancelled'].includes(status);
    await env.DB.prepare('UPDATE trainings SET status = ?, finished_at = CASE WHEN ? THEN datetime(\'now\') ELSE NULL END WHERE id = ?')
      .bind(status, finished ? 1 : 0, t.id).run();
    // A training started from an applicant: its end goes in the applicant's history, and completing it
    // moves them to Training done. Cancelling leaves their hiring step as it is.
    if (t.applicant_id && finished && t.status !== status) {
      const moved = await applicantEvent(env, user, t.applicant_id, status === 'completed' ? 'Training completed' : 'Training cancelled',
        status === 'completed' ? 'Training done' : null, BEFORE_DONE);
      if (moved) return back('training-completed-applicant');
    }
    return back(`training-${status}`);
  }

  // An admin signs off a day for both the trainer and the trainee.
  if (m[2] === 'signoff') {
    const d = await env.DB.prepare('SELECT id FROM training_days WHERE id = ?').bind(field('day_id')).first();
    if (d) {
      await env.DB.prepare(
        `INSERT INTO training_signoffs (training_id, day_id, admin_at, admin_by) VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT (training_id, day_id) DO UPDATE SET admin_at = excluded.admin_at, admin_by = excluded.admin_by`
      ).bind(t.id, d.id, user.id).run();
    }
    return back('day-signed');
  }

  if (m[2] === 'trainer') {
    const trainer = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND (is_va = 1 OR is_admin = 1)').bind(field('trainer_id')).first();
    if (!trainer || trainer.id === t.trainee_id) return back('training-missing');
    await env.DB.prepare('UPDATE trainings SET trainer_id = ? WHERE id = ?').bind(trainer.id, t.id).run();
    return back('saved');
  }

  // Login invite for the trainee (a new temporary password by email, and Slack when they have a Slack ID).
  const person = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(t.trainee_id).first();
  const sent = await sendInvite(env, { ...person, in_training: t.kind === ONBOARDING && !person.is_admin });
  const fresh = await env.DB.prepare(`${TRAINING_SQL} WHERE t.id = ?`).bind(t.id).first();
  return page(await trainingPage(env, user, fresh, roleIn(fresh, user), Number(day) || 0, null, {
    invite: { name: person.name, email: person.email, ...sent },
  }));
}

// Who can be chosen when starting a training. Trainers: VAs and admins with a login.
// Trainees: current VAs, plus Active and On Deck VAs from the VA list who have no login yet.
async function peopleChoices(env) {
  const [{ results: users }, { results: candidates }] = await Promise.all([
    env.DB.prepare('SELECT id, name, email, is_va, is_admin FROM users WHERE is_va = 1 OR is_admin = 1 ORDER BY name').all(),
    env.DB.prepare("SELECT zoho_id, name, email, status FROM backup_candidates WHERE COALESCE(email, '') != '' ORDER BY name").all(),
  ]);
  const vas = users.filter((u) => u.is_va);
  const emails = new Set(vas.map((u) => u.email));
  return {
    trainers: users,
    vas,
    others: candidates.filter((c) => !emails.has(c.email.trim().toLowerCase())),
  };
}

// The trainee chosen on the start form: "u:<user id>", "c:<VA list id>", or "new" with a name and email.
// People without a login get one (not a VA login; they can log in while their training runs).
async function traineeFromForm(env, field) {
  const pick = field('trainee');
  if (pick.startsWith('u:')) return env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(pick.slice(2)).first();
  let name, email, key = null;
  if (pick.startsWith('c:')) {
    const c = await env.DB.prepare('SELECT * FROM backup_candidates WHERE zoho_id = ?').bind(pick.slice(2)).first();
    if (!c?.email) return null;
    [name, email, key] = [c.name, c.email.trim().toLowerCase(), c.zoho_id];
  } else if (pick === 'new') {
    [name, email] = [field('new_name').slice(0, 200), field('new_email').toLowerCase()];
    if (!name || !EMAIL.test(email)) return null;
  } else {
    return null;
  }
  return personFor(env, name, email, key);
}

// The login (users row) with this email, or a new one (not a VA login) with this name. Null without a valid email.
async function personFor(env, name, email, key = null) {
  if (!EMAIL.test(email || '')) return null;
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return existing;
  const res = await env.DB.prepare('INSERT INTO users (email, name, zoho_id) VALUES (?, ?, ?)').bind(email, name.slice(0, 200), key).run();
  return { id: res.meta.last_row_id };
}

// ---- Checklist editor: /admin/training/checklist ----

async function checklistRoutes(env, user, path, method, field, message, days) {
  let m;
  const modules = await modulesList(env);
  if (path === '/admin/training/checklist' && method === 'GET') {
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM trainings').first();
    return page(tv.checklistPage({ user, days, modules, used: used?.n || 0, message }));
  }
  if (method !== 'POST') return redirect('/admin/training/checklist');
  const back = (msg, anchor = '') => redirect(`/admin/training/checklist?msg=${msg}${anchor}`);
  const text = (name, max = 300) => field(name).slice(0, max);
  const title = text('title', 200);

  if (path === '/admin/training/checklist/day/add') {
    if (!title) return back('training-name-needed');
    const next = (days[days.length - 1]?.day_number || 0) + 1;
    const res = await env.DB.prepare('INSERT INTO training_days (day_number, title) VALUES (?, ?)').bind(next, title).run();
    return back('saved', `#day-${res.meta.last_row_id}`);
  }

  if ((m = path.match(/^\/admin\/training\/checklist\/day\/(\d+)(\/delete)?$/))) {
    const day = days.find((d) => d.id === Number(m[1]));
    if (!day) return back('saved');
    if (m[2]) {
      // Only an empty day can be removed; the days after it move up one number.
      if (day.items.length) return back('training-day-not-empty');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM training_signoffs WHERE day_id = ?').bind(day.id),
        env.DB.prepare('DELETE FROM training_days WHERE id = ?').bind(day.id),
        env.DB.prepare('UPDATE training_days SET day_number = day_number - 1 WHERE day_number > ?').bind(day.day_number),
      ]);
      return back('removed');
    }
    if (!title) return back('training-name-needed');
    await env.DB.prepare('UPDATE training_days SET title = ? WHERE id = ?').bind(title, day.id).run();
    return back('saved', `#day-${day.id}`);
  }

  // Self-paced modules (before Day 1 of an Onboarding Training): name, link, short description.
  const moduleValues = () => [text('name', 200), httpLink(field('url')), text('description', 500)];
  if (path === '/admin/training/checklist/module/add') {
    const [name, link, description] = moduleValues();
    if (!name) return back('training-name-needed', '#modules');
    if (!link) return back('module-link-bad', '#modules');
    const position = Math.max(0, ...modules.map((x) => x.position)) + 1;
    const res = await env.DB.prepare('INSERT INTO training_modules (position, name, url, description) VALUES (?, ?, ?, ?)')
      .bind(position, name, link, description).run();
    return back('saved', `#module-${res.meta.last_row_id}`);
  }
  if ((m = path.match(/^\/admin\/training\/checklist\/module\/(\d+)(?:\/(delete|up|down))?$/))) {
    const index = modules.findIndex((x) => x.id === Number(m[1]));
    if (index < 0) return back('saved', '#modules');
    const mod = modules[index];
    if (m[2] === 'delete') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM training_module_progress WHERE module_id = ?').bind(mod.id),
        env.DB.prepare('DELETE FROM training_modules WHERE id = ?').bind(mod.id),
      ]);
      return back('removed', '#modules');
    }
    if (m[2]) {
      // Move up or down: number the modules again in the new order.
      const order = [...modules];
      const to = m[2] === 'up' ? index - 1 : index + 1;
      if (to < 0 || to >= order.length) return back('saved', `#module-${mod.id}`);
      [order[index], order[to]] = [order[to], order[index]];
      await env.DB.batch(order.map((x, i) => env.DB.prepare('UPDATE training_modules SET position = ? WHERE id = ?').bind(i + 1, x.id)));
      return back('saved', `#module-${mod.id}`);
    }
    const [name, link, description] = moduleValues();
    if (!name) return back('training-name-needed', `#module-${mod.id}`);
    if (!link) return back('module-link-bad', `#module-${mod.id}`);
    await env.DB.prepare('UPDATE training_modules SET name = ?, url = ?, description = ? WHERE id = ?').bind(name, link, description, mod.id).run();
    return back('saved', `#module-${mod.id}`);
  }

  const values = () => [text('location', 200), text('name'), text('trainer_text', 5000), text('trainee_text', 5000)];

  if (path === '/admin/training/checklist/item/add') {
    const day = days.find((d) => d.id === Number(field('day_id')));
    const [location, name, trainerText, traineeText] = values();
    if (!day || !name) return back('training-name-needed');
    const position = Math.max(0, ...day.items.map((i) => i.position)) + 1;
    const res = await env.DB.prepare('INSERT INTO training_items (day_id, position, location, name, trainer_text, trainee_text) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(day.id, position, location, name, trainerText, traineeText).run();
    return back('saved', `#item-${res.meta.last_row_id}`);
  }

  if ((m = path.match(/^\/admin\/training\/checklist\/item\/(\d+)(?:\/(delete|up|down))?$/))) {
    const day = days.find((d) => d.items.some((i) => i.id === Number(m[1])));
    if (!day) return back('saved');
    const index = day.items.findIndex((i) => i.id === Number(m[1]));
    const it = day.items[index];
    if (m[2] === 'delete') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM training_progress WHERE item_id = ?').bind(it.id),
        env.DB.prepare('DELETE FROM training_items WHERE id = ?').bind(it.id),
      ]);
      return back('removed', `#day-${day.id}`);
    }
    if (m[2]) {
      // Move up or down within the day: number the day's items again in the new order.
      const order = [...day.items];
      const to = m[2] === 'up' ? index - 1 : index + 1;
      if (to < 0 || to >= order.length) return back('saved', `#item-${it.id}`);
      [order[index], order[to]] = [order[to], order[index]];
      await env.DB.batch(order.map((x, i) => env.DB.prepare('UPDATE training_items SET position = ? WHERE id = ?').bind(i + 1, x.id)));
      return back('saved', `#item-${it.id}`);
    }
    const [location, name, trainerText, traineeText] = values();
    if (!name) return back('training-name-needed', `#item-${it.id}`);
    await env.DB.prepare('UPDATE training_items SET location = ?, name = ?, trainer_text = ?, trainee_text = ? WHERE id = ?')
      .bind(location, name, trainerText, traineeText, it.id).run();
    return back('saved', `#item-${it.id}`);
  }

  return back('saved');
}

// How many trainings are past their 7 workdays (for "Needs your attention" on Today).
export async function lateTrainings(env) {
  const { results } = await env.DB.prepare("SELECT status, start_date FROM trainings WHERE status = 'active'").all();
  return results.filter(isLate).length;
}
