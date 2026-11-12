// Client portal: what a client's contact sees after logging in. A client login is a users row with is_client = 1,
// linked by record_id to the client's contact record; the contact's parent_id is the client. A client sees only
// that client's projects. Later steps add the time pages, time off and holidays, projected bill and invoices.

import { layout, section, empty, chip, avatar } from './views.js';
import { esc, page, redirect } from './util.js';
import { clientTimeRoutes } from './client-time.js';
import { clientCalendarRoutes } from './client-calendar.js';

// The client record this login belongs to, or null (no contact linked, contact has no client, or offboarded).
export async function clientOf(env, user) {
  if (!user.record_id) return null;
  return env.DB.prepare(
    `SELECT c.id, c.name, c.status FROM records k JOIN records c ON c.id = k.parent_id AND c.module = 'clients'
     WHERE k.id = ? AND k.module = 'contacts'`
  ).bind(user.record_id).first();
}

// The client's active projects (not coverage ones) with the VAs assigned to each.
export async function clientProjects(env, clientId) {
  const { results: projects } = await env.DB.prepare(
    'SELECT id, name FROM projects WHERE client_record_id = ? AND active = 1 AND is_coverage = 0 ORDER BY name'
  ).bind(clientId).all();
  if (!projects.length) return [];
  const { results: vas } = await env.DB.prepare(
    `SELECT a.project_id, u.name FROM assignments a JOIN users u ON u.id = a.user_id
     WHERE u.is_va = 1 AND a.project_id IN (${projects.map(() => '?').join(',')}) ORDER BY u.name`
  ).bind(...projects.map((p) => p.id)).all();
  return projects.map((p) => ({ ...p, vas: vas.filter((v) => v.project_id === p.id).map((v) => v.name) }));
}

export async function clientRoutes(env, user, path, method, field, message, url) {
  const client = await clientOf(env, user);
  if (!client || client.status === 'Offboarded') {
    return page(layout({ title: 'Your account', user, active: '/client', message, body:
      '<div class="card"><h1>Your account</h1><p class="lead">Your login is not linked to an active client right now. Please contact your InoVA Local team.</p></div>' }));
  }
  if (path === '/client/time' || path.startsWith('/client/time/')) return method === 'GET' ? clientTimeRoutes(env, user, client, path, url, message) : redirect('/client/time');
  if (path === '/client/calendar') return method === 'GET' ? clientCalendarRoutes(env, user, client, path, message) : redirect('/client/calendar');
  if (path === '/client' && method === 'GET') {
    const projects = await clientProjects(env, client.id);
    const body = `<div class="card"><h2>${esc(client.name)}</h2>
      <p class="lead">Welcome, ${esc(user.name.split(' ')[0])}. See the hours your VAs log on the <a href="/client/time">Time</a> page. See your VAs’ upcoming <a href="/client/calendar">time off</a>, holidays and credits. Your projected bill and invoices are coming soon.</p></div>
      ${section({ title: 'Your projects', count: projects.length, open: true, body: projects.length
        ? projects.map((p) => `<div class="item flat"><div class="item-head">${avatar(p.vas[0] || p.name)}<div class="grow"><div class="title">${esc(p.name)}</div>
            <div class="sub">${p.vas.length ? esc(p.vas.join(', ')) : 'No VA assigned yet'}</div></div>${chip('Active', 'good')}</div></div>`).join('')
        : empty('No active projects yet.') })}`;
    return page(layout({ title: 'Overview', user, active: '/client', message, body }));
  }
  return redirect('/client');
}
