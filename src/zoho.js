// Copies active VAs from Zoho CRM and active projects from Zoho Projects.

import { parseStart } from './time.js';

// Zoho fields the app reads. "Slack_Management_ID" is the VA's management
// channel; "Slack_ID" is the VA's own Slack user ID (used to tag them). "VA_Company_Affiliation"
// decides whether the VA is checked at all (only "InoVA Local" VAs are).
const AFFILIATION = 'VA_Company_Affiliation';
const FIELDS = ['Name', 'Email', 'Time_Zone', 'Availability', 'VA_Status', 'Slack_ID', 'Slack_Management_ID', AFFILIATION];

async function accessToken(env) {
  const cached = await env.DB.prepare("SELECT value FROM settings WHERE key = 'zoho_token'").first();
  if (cached) {
    const { token, expires } = JSON.parse(cached.value);
    if (expires > Date.now() + 60000) return token;
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
  const value = JSON.stringify({ token: data.access_token, expires: Date.now() + data.expires_in * 1000 });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('zoho_token', ?)").bind(value).run();
  return data.access_token;
}

async function fetchVAs(env, token) {
  const records = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${env.ZOHO_API_URL}/crm/v8/Virtual_Assistants?fields=${FIELDS.join(',')}&per_page=200&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    if (res.status === 204) break;
    if (!res.ok) throw new Error(`Zoho sync failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    records.push(...(data.data || []));
    if (!data.info?.more_records) break;
  }
  return records;
}

const clean = (value) => (value || '').toString().trim() || null;

// Copies VAs from Zoho CRM, then projects from Zoho Projects (in that order,
// because projects are matched to VAs by name).
export async function syncFromZoho(env) {
  if (!env.ZOHO_REFRESH_TOKEN) {
    console.log('[Zoho not set up] Skipping sync.');
    return { skipped: true };
  }
  const token = await accessToken(env);
  const vas = await syncVAs(env, token);
  const projects = await syncProjects(env, token);
  return { vas, projects };
}

async function syncVAs(env, token) {
  const records = await fetchVAs(env, token);

  const active = records.filter((r) => r.VA_Status === 'Active' && r.Email);
  // Zoho leaves out fields that don't exist. If the affiliation field is missing entirely
  // (for example, renamed in Zoho), keep the saved values instead of making every VA exempt.
  const hasAffiliation = records.some((r) => AFFILIATION in r);
  if (!hasAffiliation) console.error(`Zoho sync: field ${AFFILIATION} not found; affiliations were not updated.`);
  const statements = active.map((r) =>
    env.DB.prepare(
      `INSERT INTO users (email, name, is_va, zoho_id, time_zone, availability, slack_channel_id, slack_user_id, affiliation)
       VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(email) DO UPDATE SET
         name = excluded.name, is_va = 1, zoho_id = excluded.zoho_id,
         time_zone = excluded.time_zone, availability = excluded.availability,
         slack_channel_id = excluded.slack_channel_id, slack_user_id = excluded.slack_user_id,
         affiliation = CASE WHEN ?9 THEN excluded.affiliation ELSE users.affiliation END`
    ).bind(
      r.Email.trim().toLowerCase(), r.Name, r.id, clean(r.Time_Zone), clean(r.Availability),
      clean(r.Slack_Management_ID), clean(r.Slack_ID), clean(r[AFFILIATION]), hasAffiliation ? 1 : 0
    )
  );
  // VAs who are no longer Active in Zoho lose VA access (admins keep admin access).
  const emails = JSON.stringify(active.map((r) => r.Email.trim().toLowerCase()));
  statements.push(
    env.DB.prepare('UPDATE users SET is_va = 0 WHERE is_va = 1 AND email NOT IN (SELECT value FROM json_each(?))').bind(emails)
  );
  // Everyone who can cover for another VA: Active or On Deck in Zoho.
  const candidates = records.filter((r) => ['Active', 'On Deck'].includes(r.VA_Status) && r.Name);
  statements.push(env.DB.prepare('DELETE FROM backup_candidates'));
  for (const r of candidates) {
    statements.push(env.DB.prepare('INSERT INTO backup_candidates (zoho_id, name, status, email) VALUES (?, ?, ?, ?)')
      .bind(String(r.id), r.Name.trim(), r.VA_Status, clean(r.Email)));
  }
  await env.DB.batch(statements);
  return active.length;
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

// "Pool Partners - Tracy Saeman" -> { client: "Pool Partners", vaName: "Tracy Saeman" }
export function splitProjectName(name) {
  const trimmed = name.trim();
  const at = trimmed.lastIndexOf(' - ');
  if (at === -1) return { client: trimmed, vaName: null };
  return { client: trimmed.slice(0, at).trim(), vaName: trimmed.slice(at + 3).trim() || null };
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
    const { client, vaName } = splitProjectName(p.name);
    return env.DB.prepare(
      `INSERT INTO projects (id, name, client, va_name, active) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, client = excluded.client, va_name = excluded.va_name, active = 1`
    ).bind(String(p.id), p.name.trim(), client, vaName);
  });
  // Projects that are no longer open in Zoho stop counting.
  const ids = JSON.stringify(projects.map((p) => String(p.id)));
  statements.push(env.DB.prepare('UPDATE projects SET active = 0 WHERE id NOT IN (SELECT value FROM json_each(?))').bind(ids));
  await env.DB.batch(statements);

  // Assign projects that have not been assigned yet to the VA named in them.
  const { results: open } = await env.DB.prepare(
    'SELECT * FROM projects WHERE active = 1 AND assignment_locked = 0 AND va_name IS NOT NULL'
  ).all();
  const { results: vas } = await env.DB.prepare('SELECT id, name, availability FROM users WHERE is_va = 1').all();
  let assigned = 0;
  for (const project of open) {
    const va = matchVA(project.va_name, vas);
    if (!va) continue;
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO assignments (project_id, user_id, start_time) VALUES (?, ?, ?)')
        .bind(project.id, va.id, defaultStartTime(va.availability)),
      env.DB.prepare('UPDATE projects SET assignment_locked = 1 WHERE id = ?').bind(project.id),
    ]);
    assigned++;
  }
  return { count: projects.length, assigned };
}
