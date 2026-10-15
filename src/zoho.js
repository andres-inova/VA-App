// The hourly sync: VA logins and the backup list from the VA records kept in the app (Team -> VAs), then active
// projects from Zoho Projects.

import { parseStart, ZONES } from './time.js';

// A short piece of the saved Zoho key, so a new key (with new permissions) is used right away.
const keyTag = (env) => (env.ZOHO_REFRESH_TOKEN || '').trim().slice(-8);

export async function accessToken(env) {
  const cached = await env.DB.prepare("SELECT value FROM settings WHERE key = 'zoho_token'").first();
  if (cached) {
    const { token, expires, key } = JSON.parse(cached.value);
    if (expires > Date.now() + 60000 && key === keyTag(env)) return token;
  }
  const params = new URLSearchParams({
    refresh_token: (env.ZOHO_REFRESH_TOKEN || '').trim(),
    client_id: (env.ZOHO_CLIENT_ID || '').trim(),
    client_secret: (env.ZOHO_CLIENT_SECRET || '').trim(),
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`, { method: 'POST', body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Zoho login failed: ${JSON.stringify(data)}`);
  const value = JSON.stringify({ token: data.access_token, expires: Date.now() + data.expires_in * 1000, key: keyTag(env) });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('zoho_token', ?)").bind(value).run();
  return data.access_token;
}

const clean = (value) => (value || '').toString().trim() || null;

// Updates VA logins from the app's VA records, then copies projects from Zoho Projects (in that order,
// because projects are matched to VAs by name). Without a Zoho key, only the VA logins are updated.
export async function syncVAsAndProjects(env) {
  const vas = await applyVaRecords(env);
  if (!env.ZOHO_REFRESH_TOKEN) {
    await linkProjectClients(env); // syncProjects does this when Zoho Projects is set up
    console.log('[Zoho not set up] Skipping the Zoho Projects sync.');
    return { vas, skipped: true };
  }
  const token = await accessToken(env);
  const projects = await syncProjects(env, token);
  // Needs the newer Zoho key (with Zoho Projects user access); the rest of the sync works without it.
  let projectUsers = null;
  try {
    projectUsers = await syncProjectsUserIds(env, token);
  } catch (err) {
    console.log(`[Zoho Projects users] ${err.message}`);
  }
  return { vas, projects, projectUsers };
}

// Updates VA logins and the backup list from the VA records kept in the app. Runs at every sync and right after
// a VA record is added, changed or deleted.
// Each login (users row) is linked to its VA record by users.record_id, so a new email on the record changes the
// email of the same login, and the VA keeps their projects, check-ins, time off and trainings. A record without a
// login yet is linked to an existing login with its key (old Zoho CRM id, or "app-<record id>") or, failing that,
// its email (not an admin's login). Only Active VAs with an email get VA access (is_va); the logins of other VAs
// stay, with their details kept up to date.
export async function applyVaRecords(env) {
  const { results } = await env.DB.prepare("SELECT id, zoho_id, status, data FROM records WHERE module = 'vas'").all();
  // No VA records at all is more likely a mistake than every VA leaving, so change nothing.
  if (!results.length) return 0;
  const { results: users } = await env.DB.prepare(
    'SELECT id, email, name, is_va, is_admin, zoho_id, record_id, time_zone, availability, slack_channel_id, slack_user_id, affiliation FROM users'
  ).all();
  const byRecord = new Map(users.filter((u) => u.record_id).map((u) => [u.record_id, u]));
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  // Field names are the keys in fields.js (Name, Email, Time_Zone, Availability, Slack_ID, ...).
  const records = results.map((r) => ({ ...JSON.parse(r.data), rid: r.id, key: r.zoho_id || `app-${r.id}`, status: r.status }));
  const statements = [];
  const active = [];
  for (const r of records) {
    const email = (r.Email || '').trim().toLowerCase();
    const isActive = r.VA_Status === 'Active' && Boolean(email);
    let u = byRecord.get(r.rid);
    if (!u) {
      const sameKey = users.filter((x) => !x.record_id && x.zoho_id === r.key);
      const sameEmail = email ? byEmail.get(email) : null;
      u = sameKey.length === 1 ? sameKey[0] : sameEmail && !sameEmail.record_id && !sameEmail.is_admin ? sameEmail : null;
      if (u) {
        u.record_id = r.rid;
        byRecord.set(r.rid, u);
        statements.push(env.DB.prepare('UPDATE users SET record_id = ? WHERE id = ? AND record_id IS NULL').bind(r.rid, u.id));
      }
    }
    const want = {
      name: (r.Name || '').trim() || email || (u ? u.name : ''), zoho_id: r.key, time_zone: clean(r.Time_Zone), availability: clean(r.Availability),
      slack_channel_id: clean(r.Slack_Management_ID), slack_user_id: clean(r.Slack_ID), affiliation: clean(r.VA_Company_Affiliation),
      is_va: isActive ? 1 : 0,
    };
    if (u) {
      // A new email is used only when no other login has it (checked when the record is saved, too).
      const other = email ? byEmail.get(email) : null;
      if (email && email !== u.email.toLowerCase() && !other) {
        byEmail.delete(u.email.toLowerCase());
        byEmail.set(email, u);
        want.email = email;
      }
      const changed = Object.keys(want).filter((k) => (u[k] ?? null) !== want[k]);
      if (changed.length) {
        statements.push(env.DB.prepare(`UPDATE users SET ${changed.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${changed.length + 1}`)
          .bind(...changed.map((k) => want[k]), u.id));
      }
    } else if (isActive && !byEmail.has(email)) {
      statements.push(env.DB.prepare(
        `INSERT INTO users (email, name, is_va, zoho_id, record_id, time_zone, availability, slack_channel_id, slack_user_id, affiliation)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`
      ).bind(email, want.name, want.zoho_id, r.rid, want.time_zone, want.availability, want.slack_channel_id, want.slack_user_id, want.affiliation));
    }
    if (isActive) active.push(r.rid);
  }
  // Logins whose VA record is gone or not Active (or has no email) lose VA access (admins keep admin access).
  statements.push(env.DB.prepare(
    'UPDATE users SET is_va = 0 WHERE is_va = 1 AND (record_id IS NULL OR record_id NOT IN (SELECT value FROM json_each(?)))'
  ).bind(JSON.stringify(active)));
  // Everyone who can cover for another VA: VA Status Active or On Deck.
  const candidates = records.filter((r) => ['Active', 'On Deck'].includes(r.VA_Status) && r.Name);
  statements.push(env.DB.prepare('DELETE FROM backup_candidates'));
  for (const r of candidates) {
    statements.push(env.DB.prepare(
      'INSERT INTO backup_candidates (zoho_id, name, status, email, time_zone, availability) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(r.key, r.Name.trim(), r.VA_Status, clean(r.Email), clean(r.Time_Zone), clean(r.Availability)));
  }
  await env.DB.batch(statements);
  return active.length;
}

// Projects whose client is still empty (and not chosen by an admin) get the client record with the same name as
// the part before " - " in the project name (any case), when exactly one client has that name.
export async function linkProjectClients(env) {
  await env.DB.prepare(
    `UPDATE projects SET client_record_id = (
       SELECT r.id FROM records r WHERE r.module = 'clients' AND lower(trim(r.name)) = lower(trim(projects.client)))
     WHERE client_record_id IS NULL AND client_set = 0
       AND (SELECT COUNT(*) FROM records r WHERE r.module = 'clients' AND lower(trim(r.name)) = lower(trim(projects.client))) = 1`
  ).run();
}

// ---- Zoho Projects ----

async function fetchProjects(env, token) {
  const projects = [];
  const perPage = 100;
  for (let page = 1; page <= 20; page++) {
    const url = `${env.ZOHO_PROJECTS_API_URL}/api/v3/portal/${env.ZOHO_PORTAL_ID}/projects?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    if (res.status === 204) break;
    if (!res.ok) throw new Error(`Zoho Projects sync failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const list = Array.isArray(body) ? body : body.projects || body.result || body.data || [];
    projects.push(...list);
    if (list.length < perPage) break;
  }
  // Only projects that are open (not completed or closed).
  return projects.filter((p) => !p.is_completed && !p.status?.is_closed_type);
}

// "Pool Partners - Tracy Saeman" -> { client: "Pool Partners", vaName: "Tracy Saeman", coverage: false }
// "Pool Partners - Ana Diaz - Coverage" -> { client: "Pool Partners", vaName: "Ana Diaz", coverage: true }
// (a coverage project: Ana logs the time she spends covering Pool Partners there).
export function splitProjectName(name) {
  let trimmed = name.trim();
  const ending = trimmed.match(/\s+[-–]\s*\(?coverage\)?$/i);
  const coverage = Boolean(ending) && ending.index > 0;
  if (coverage) trimmed = trimmed.slice(0, ending.index).trim();
  const at = trimmed.lastIndexOf(' - ');
  if (at === -1) return { client: trimmed, vaName: null, coverage };
  return { client: trimmed.slice(0, at).trim(), vaName: trimmed.slice(at + 3).trim() || null, coverage };
}

const nameParts = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z]+/).filter(Boolean);

// How many single-letter changes turn one word into another ("rugenskii" -> "rugenski" is 1).
function letterChanges(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// Two last-name parts count as the same if they are equal, or if they are 5+ letters long
// and differ by at most 2 letters (a typo such as "Rugenskii" for "Rugenski").
const closeEnough = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && letterChanges(a, b) <= 2);

// Finds the one VA whose name matches a name typed in a project or the request form.
// The first names must be the same, and at least one other part must match (allowing a small typo).
// This lets "Estefani Resendiz" match "Estefani Resendiz Lopez" and "Nika Kedgbe-Davis" match
// "Nika Kegbe-Davis". Returns null when there is no match or more than one.
export function matchVA(vaName, vas) {
  const want = nameParts(vaName);
  if (!want.length) return null;
  const hits = vas.filter((v) => {
    const have = nameParts(v.name);
    if (have[0] !== want[0]) return false;
    if (want.length === 1) return true;
    return want.slice(1).some((part) => have.slice(1).some((h) => closeEnough(part, h)));
  });
  return hits.length === 1 ? hits[0] : null;
}

// "9am - 5pm" -> "09:00", used as the starting value for a new assignment.
export function defaultStartTime(availability) {
  const start = parseStart(availability);
  return start ? `${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}` : null;
}

async function syncProjects(env, token) {
  const projects = await fetchProjects(env, token);
  const statements = projects.map((p) => {
    const { client, vaName, coverage } = splitProjectName(p.name);
    return env.DB.prepare(
      `INSERT INTO projects (id, name, client, va_name, is_coverage, active) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, client = excluded.client, va_name = excluded.va_name,
         is_coverage = excluded.is_coverage, active = 1`
    ).bind(String(p.id), p.name.trim(), client, vaName, coverage ? 1 : 0);
  });
  // Projects that are no longer open in Zoho stop counting. Projects made in the app (ids "p-<n>") are left alone.
  const ids = JSON.stringify(projects.map((p) => String(p.id)));
  statements.push(env.DB.prepare("UPDATE projects SET active = 0 WHERE id NOT LIKE 'p-%' AND id NOT IN (SELECT value FROM json_each(?))").bind(ids));
  await env.DB.batch(statements);
  await linkProjectClients(env);

  // Assign projects that have not been assigned yet to the VA named in them (normal projects first, so coverage projects can copy their start time).
  const { results: open } = await env.DB.prepare(
    'SELECT * FROM projects WHERE active = 1 AND assignment_locked = 0 AND va_name IS NOT NULL ORDER BY is_coverage'
  ).all();
  const { results: vas } = await env.DB.prepare('SELECT id, name, availability FROM users WHERE is_va = 1').all();
  let assigned = 0;
  for (const project of open) {
    const va = matchVA(project.va_name, vas);
    if (!va) continue;
    // A coverage project starts when the client's regular VA starts (in that VA's time zone);
    // otherwise, and for normal projects, at the start of the VA's availability (on their VA record).
    let start = defaultStartTime(va.availability);
    let zone = null;
    if (project.is_coverage) {
      // The same client: the same client record when the project has one, otherwise the same name.
      const regular = await env.DB.prepare(
        `SELECT a.start_time, a.time_zone, u.time_zone AS va_zone FROM assignments a
         JOIN projects p ON p.id = a.project_id JOIN users u ON u.id = a.user_id
         WHERE p.active = 1 AND p.is_coverage = 0 AND a.start_time IS NOT NULL
           AND (CASE WHEN ?1 IS NOT NULL THEN p.client_record_id = ?1 ELSE lower(p.client) = lower(?2) END)
         ORDER BY a.start_time LIMIT 1`
      ).bind(project.client_record_id, project.client).first();
      if (regular) {
        start = regular.start_time;
        zone = ZONES[regular.time_zone] ? regular.time_zone : ZONES[regular.va_zone] ? regular.va_zone : null;
      }
    }
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO assignments (project_id, user_id, start_time, time_zone) VALUES (?, ?, ?, ?)')
        .bind(project.id, va.id, start, zone),
      env.DB.prepare('UPDATE projects SET assignment_locked = 1 WHERE id = ?').bind(project.id),
    ]);
    assigned++;
  }
  return { count: projects.length, assigned };
}

// Finds each VA's user ID in Zoho Projects (by email, or else by name), so time logs from the app
// are saved under the VA's own name.
async function syncProjectsUserIds(env, token) {
  const people = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${env.ZOHO_PROJECTS_API_URL}/api/v3.1/portal/${env.ZOHO_PORTAL_ID}/users?page=${page}&per_page=200`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    if (res.status === 204) break;
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const body = await res.json();
    const list = body.users || [];
    people.push(...list.map((u) => ({ id: String(u.id || u.zpuid), email: (u.email || '').toLowerCase(), name: u.full_name || u.name || '' })));
    if (!body.page_info?.has_next_page || !list.length) break;
  }
  const { results: vas } = await env.DB.prepare('SELECT id, email, name FROM users WHERE is_va = 1').all();
  const statements = [];
  for (const va of vas) {
    const match = people.find((p) => p.email && p.email === va.email.toLowerCase()) || matchVA(va.name, people);
    if (match) statements.push(env.DB.prepare('UPDATE users SET zoho_projects_user_id = ? WHERE id = ?').bind(match.id, va.id));
  }
  if (statements.length) await env.DB.batch(statements);
  return { found: statements.length, of: vas.length };
}
