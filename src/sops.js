// Coverage SOPs: one per project, so a backup VA knows how to run that client's day.
// A VA either fills in the template in the app (sections of tables they can add, rename and remove)
// or uploads their own file. Admins see which projects are done.

import { redirect, page } from './util.js';
import * as views from './views.js';

// The kinds of section and their columns. "text" is one free-text box.
export const KINDS = {
  steps: { label: 'Steps', columns: ['Location', 'Task', 'Instructions'] },
  logins: { label: 'Login information', columns: ['Location', 'Username', 'Password', 'Notes'] },
  notes: { label: 'Titles and notes', columns: ['Title', 'Notes'] },
  text: { label: 'Free text', columns: [] },
};

const blank = (kind, n = 2) => Array.from({ length: n }, () => KINDS[kind].columns.map(() => ''));

// The starting template, adapted from the "Coverage Checklist Template" Google Doc. The rows every
// InoVA VA does (Slack, Zoho) are filled in; the rest are left for the VA.
export function templateSections() {
  return [
    { kind: 'steps', title: 'Starting the day (start time and time zone, for example 8:30am CST)', rows: [
      ['Inova Slack', 'Say good morning', 'In the check-in thread'],
      ['Messaging system for your client', 'Say good morning', 'Let them know you are logged in and online'],
      ['Zoho', 'Log in', 'Log any time spent logging in or checking tasks under this client\'s project'],
      ...blank('steps', 3),
    ] },
    { kind: 'steps', title: 'Completing tasks in the marketing software', rows: blank('steps', 3) },
    { kind: 'steps', title: 'Customer calls asking for a quote or appointment: before booking', rows: blank('steps') },
    { kind: 'steps', title: 'If they are ready to book', rows: blank('steps') },
    { kind: 'steps', title: 'If they are NOT ready to book', rows: blank('steps') },
    { kind: 'steps', title: "Received a 'New Lead' notification from the CRM or marketing software", rows: blank('steps', 3) },
    { kind: 'steps', title: 'Customer calls asking for a reschedule', rows: blank('steps') },
    { kind: 'steps', title: 'End of day tasks (start time and time zone)', rows: [
      ...blank('steps', 2),
      ['Zoho', 'Log time', 'Log any time not logged yet today under this client\'s project'],
      ['Inova Slack', 'Say EOD', 'In the check-in thread'],
      ['Messaging system for your client', 'Tell them you are logging off', 'Share anything they need to know for the evening'],
    ] },
    { kind: 'logins', title: 'Login information', rows: [
      'Messaging system for your client', 'Client email system', 'Marketing system', 'CRM', 'Phone system', 'Any other relevant login',
    ].map((location) => [location, '', '', '']) },
    { kind: 'notes', title: 'Helpful resources', rows: [
      ['Sales scripts', ''], ['Other notes or scripts for sales', ''], ['Company website and contact information', ''],
    ] },
    { kind: 'notes', title: 'Do not dos', rows: [['Sales don\'ts', ''], ['Scheduling don\'ts', ''], ['Software and recordkeeping don\'ts', '']] },
  ];
}

// Checks and tidies an SOP sent from the editor. Returns { sections } or null if it can't be read.
export function cleanContent(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.sections)) return null;
  const text = (v, max) => String(v ?? '').slice(0, max);
  const sections = data.sections.slice(0, 60).filter((s) => s && KINDS[s.kind]).map((s) => {
    const cols = KINDS[s.kind].columns.length;
    return s.kind === 'text'
      ? { kind: 'text', title: text(s.title, 200), text: text(s.text, 20000) }
      : { kind: s.kind, title: text(s.title, 200), rows: (Array.isArray(s.rows) ? s.rows : []).slice(0, 200)
        .map((r) => Array.from({ length: cols }, (_, i) => text(Array.isArray(r) ? r[i] : '', 5000))) };
  });
  return { sections };
}

// True when at least one cell or text box has something typed in it (beyond the prefilled template).
function hasContent(content) {
  const template = JSON.stringify(templateSections().map((s) => s.rows));
  if (JSON.stringify(content.sections.map((s) => s.rows)) === template) return false;
  return content.sections.some((s) => (s.kind === 'text' ? s.text.trim() : s.rows.some((r) => r.some((c, i) => i > 0 && c.trim()))));
}

// A project's SOP state: done (uploaded or marked complete), and a label for the pages.
export function sopStatus(sop) {
  if (sop?.not_needed) return { key: 'not_needed', done: true, label: 'Not needed', tone: 'muted' };
  if (sop?.file_key && sop?.completed_at) return { key: 'both', done: true, label: 'Filled in and uploaded', tone: 'good' };
  if (sop?.file_key) return { key: 'uploaded', done: true, label: 'Uploaded', tone: 'good' };
  if (sop?.completed_at) return { key: 'complete', done: true, label: 'Filled in', tone: 'good' };
  if (sop?.content) return { key: 'draft', done: false, label: 'Started, not finished', tone: 'warn' };
  return { key: 'missing', done: false, label: 'Not started', tone: 'bad' };
}

// The active projects a VA works on, with their SOPs.
export async function vaSops(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.client, p.name, s.content IS NOT NULL AS has_content, s.completed_at, s.file_key, s.file_name,
       s.uploaded_at, s.not_needed, s.updated_at
     FROM assignments a JOIN projects p ON p.id = a.project_id LEFT JOIN sops s ON s.project_id = p.id
     WHERE a.user_id = ? AND p.active = 1 ORDER BY p.client`
  ).bind(userId).all();
  return results.map((r) => ({ ...r, status: sopStatus({ ...r, content: r.has_content ? '1' : null }) }));
}

// Every active project that has a VA, with its VAs and SOP state (for admins and the Time off pages).
export async function allSops(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.client, p.name, GROUP_CONCAT(u.name, ', ') AS va_names, s.content IS NOT NULL AS has_content,
       s.completed_at, s.file_key, s.file_name, s.uploaded_at, s.not_needed, s.updated_at, e.name AS updated_by_name
     FROM projects p JOIN assignments a ON a.project_id = p.id JOIN users u ON u.id = a.user_id
     LEFT JOIN sops s ON s.project_id = p.id LEFT JOIN users e ON e.id = s.updated_by
     WHERE p.active = 1 GROUP BY p.id ORDER BY p.client`
  ).all();
  return results.map((r) => ({ ...r, status: sopStatus({ ...r, content: r.has_content ? '1' : null }) }));
}

// How many of a VA's SOPs still need doing (for the menu badge).
export async function sopsToDo(env, userId) {
  return (await vaSops(env, userId)).filter((s) => !s.status.done).length;
}

// Files a VA may upload, by extension: the type the file is served with.
const FILE_TYPES = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', txt: 'text/plain',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
const MAX_FILE = 15 * 1024 * 1024;

// Approved coverage a VA is the backup for, from now until a day after it ends, with each project's SOP.
export async function coveringSops(env, user) {
  if (!user.zoho_id) return [];
  const { results } = await env.DB.prepare(
    `SELECT cp.project_id AS id, cp.client, u.name AS va_name, r.start_date, r.end_date, s.content IS NOT NULL AS has_content,
       s.completed_at, s.file_key, s.file_name, s.not_needed
     FROM coverage_projects cp JOIN time_off_requests r ON r.id = cp.request_id JOIN users u ON u.id = r.user_id
     LEFT JOIN sops s ON s.project_id = cp.project_id
     WHERE cp.backup_zoho_id = ? AND cp.project_id != '' AND r.status = 'approved' AND r.kind != 'emergency'
       AND r.end_date >= date('now', '-1 day')
     ORDER BY r.start_date`
  ).bind(user.zoho_id).all();
  return results.map((r) => ({ ...r, status: sopStatus({ ...r, content: r.has_content ? '1' : null }) }));
}

// Who may open a project's SOP: 'edit' for admins and the project's VAs, 'view' for a VA covering
// that project now or soon, otherwise false.
async function access(env, user, projectId) {
  if (user.is_admin) return 'edit';
  if (await env.DB.prepare('SELECT 1 FROM assignments WHERE project_id = ? AND user_id = ?').bind(projectId, user.id).first()) return 'edit';
  return (await coveringSops(env, user)).some((c) => c.id === projectId) ? 'view' : false;
}

// Pages and actions under /sops/<project id> (the editor, saving, uploads), for VAs and admins.
export async function sopRoutes(env, user, path, method, field, form, message) {
  const m = path.match(/^\/sops\/([^/]+)(?:\/(save|upload|file|remove-file))?$/);
  if (!m) return redirect(user.is_va ? '/va/sops' : '/admin/sops');
  const projectId = decodeURIComponent(m[1]);
  const action = m[2];
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
  const can = project ? await access(env, user, projectId) : false;
  if (!can || (can === 'view' && method !== 'GET')) return redirect(user.is_va ? '/va/sops' : '/admin/sops');
  const sop = await env.DB.prepare('SELECT * FROM sops WHERE project_id = ?').bind(projectId).first();
  const here = `/sops/${encodeURIComponent(projectId)}`;
  const now = new Date().toISOString();
  // Creates the row the first time anything is saved.
  const ensureRow = () => env.DB.prepare('INSERT OR IGNORE INTO sops (project_id) VALUES (?)').bind(projectId).run();

  if (!action && method === 'GET') {
    const { results: vas } = await env.DB.prepare(
      'SELECT u.name FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.project_id = ? ORDER BY u.name'
    ).bind(projectId).all();
    const content = sop?.content ? JSON.parse(sop.content) : { sections: templateSections() };
    return page(views.sopEditPage({ user, project, sop, status: sopStatus(sop), content, kinds: KINDS, readOnly: can === 'view', vas: vas.map((v) => v.name), message }));
  }

  // Saves the in-app SOP. "complete=1" also marks it complete; an SOP that was complete stays complete.
  if (action === 'save' && method === 'POST') {
    const content = cleanContent(field('content'));
    if (!content) return redirect(`${here}?msg=sop-unreadable`);
    const complete = field('complete') === '1' || Boolean(sop?.completed_at);
    if (complete && !hasContent(content)) {
      await ensureRow();
      await env.DB.prepare('UPDATE sops SET content = ?, updated_by = ?, updated_at = ? WHERE project_id = ?')
        .bind(JSON.stringify(content), user.id, now, projectId).run();
      return redirect(`${here}?msg=sop-empty`);
    }
    await ensureRow();
    await env.DB.prepare('UPDATE sops SET content = ?, completed_at = ?, updated_by = ?, updated_at = ? WHERE project_id = ?')
      .bind(JSON.stringify(content), complete ? sop?.completed_at || now : null, user.id, now, projectId).run();
    return redirect(`${here}?msg=${complete ? (sop?.completed_at ? 'saved' : 'sop-complete') : 'sop-draft'}`);
  }

  if (action === 'upload' && method === 'POST') {
    const file = form?.get('file');
    if (!file || typeof file === 'string' || !file.size) return redirect(`${here}?msg=sop-no-file`);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!FILE_TYPES[ext]) return redirect(`${here}?msg=sop-file-type`);
    if (file.size > MAX_FILE) return redirect(`${here}?msg=sop-file-big`);
    const key = `sops/${projectId}/${Date.now()}.${ext}`;
    await env.SOP_FILES.put(key, file.stream(), { httpMetadata: { contentType: FILE_TYPES[ext] } });
    await ensureRow();
    await env.DB.prepare(
      'UPDATE sops SET file_key = ?, file_name = ?, file_type = ?, file_size = ?, uploaded_at = ?, updated_by = ?, updated_at = ? WHERE project_id = ?'
    ).bind(key, file.name.slice(0, 200), FILE_TYPES[ext], file.size, now, user.id, now, projectId).run();
    if (sop?.file_key) await env.SOP_FILES.delete(sop.file_key);
    return redirect(`${here}?msg=sop-uploaded`);
  }

  if (action === 'remove-file' && method === 'POST') {
    if (sop?.file_key) {
      await env.SOP_FILES.delete(sop.file_key);
      await env.DB.prepare(
        'UPDATE sops SET file_key = NULL, file_name = NULL, file_type = NULL, file_size = NULL, uploaded_at = NULL, updated_by = ?, updated_at = ? WHERE project_id = ?'
      ).bind(user.id, now, projectId).run();
    }
    return redirect(`${here}?msg=removed`);
  }

  // The uploaded file. PDFs and pictures open in the browser; other files download.
  if (action === 'file' && method === 'GET' && sop?.file_key) {
    const object = await env.SOP_FILES.get(sop.file_key);
    if (!object) return redirect(`${here}?msg=sop-file-missing`);
    const inline = /^(application\/pdf|image\/)/.test(sop.file_type);
    const name = sop.file_name.replace(/[^\w .()-]/g, '_');
    return new Response(object.body, {
      headers: {
        'Content-Type': sop.file_type,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  return redirect(here);
}

// Admin page: every project's SOP, and marking a project as not needing one.
export async function adminSopRoutes(env, user, path, method, field, message) {
  if (path === '/admin/sops' && method === 'GET') {
    return page(views.adminSopsPage({ user, sops: await allSops(env), message }));
  }
  const m = path.match(/^\/admin\/sops\/([^/]+)\/needed$/);
  if (m && method === 'POST') {
    const projectId = decodeURIComponent(m[1]);
    if (await env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(projectId).first()) {
      await env.DB.prepare('INSERT OR IGNORE INTO sops (project_id) VALUES (?)').bind(projectId).run();
      await env.DB.prepare('UPDATE sops SET not_needed = ?, updated_by = ?, updated_at = ? WHERE project_id = ?')
        .bind(field('not_needed') === '1' ? 1 : 0, user.id, new Date().toISOString(), projectId).run();
    }
    return redirect('/admin/sops?msg=saved');
  }
  return redirect('/admin/sops');
}
