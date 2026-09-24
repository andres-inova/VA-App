// Creates the ClickUp checklist for an approved coverage request: a new list in the
// Checklists space, made from the "VA Backup Checklist" list template, with every task
// assigned to the VA Lead.

import { formatDate } from './time.js';

const API = 'https://api.clickup.com/api/v2';

// The template setting can be the template ID ("t-123abc") or a link that contains it.
function templateId(value) {
  const s = (value || '').trim();
  const m = /(t-[a-z0-9]+)/i.exec(s);
  if (m) return m[1];
  return /^\d+$/.test(s) ? `t-${s}` : s;
}

async function call(env, method, path, body) {
  const res = await fetch(`${env.CLICKUP_API_URL || API}${path}`, {
    method,
    headers: { Authorization: (env.CLICKUP_API_TOKEN || '').trim(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickUp ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

export function clickupReady(env) {
  return Boolean(env.CLICKUP_API_TOKEN && env.CLICKUP_TEMPLATE_ID && env.CLICKUP_SPACE_ID);
}

// request: a time_off_requests row with va_name and backup_name added. Returns the new list's link.
export async function createCoverageChecklist(env, request) {
  if (!clickupReady(env)) {
    throw new Error('ClickUp is not set up yet (CLICKUP_API_TOKEN or CLICKUP_TEMPLATE_ID is missing). See README.');
  }
  const dates = request.start_date === request.end_date
    ? formatDate(request.start_date)
    : `${formatDate(request.start_date)} to ${formatDate(request.end_date)}`;
  const name = `VA Backup Checklist - ${request.va_name} (${dates})`;
  const content = [
    `VA requesting coverage: ${request.va_name}`,
    `Backup VA: ${request.backup_name || 'not chosen yet'}`,
    `Dates: ${formatDate(request.start_date, true)} to ${formatDate(request.end_date, true)}`,
    request.details,
    request.note && `Extra notes: ${request.note}`,
    `In the VA App: ${env.APP_URL}/admin/time-off`,
  ].filter(Boolean).join('\n');

  const created = await call(env, 'POST', `/space/${env.CLICKUP_SPACE_ID}/list_template/${templateId(env.CLICKUP_TEMPLATE_ID)}`, {
    name,
    options: {
      return_immediately: false,
      content,
      subtasks: true,
      old_checklists: true,
      old_due_date: true,
      old_start_date: true,
      old_assignees: true,
      old_tags: true,
      custom_fields: true,
      comment: true,
      attachments: true,
    },
  });
  const listId = created.list?.id || created.id;
  if (!listId) throw new Error(`ClickUp created the list but did not return its id: ${JSON.stringify(created).slice(0, 300)}`);
  const url = `https://app.clickup.com/${env.CLICKUP_TEAM_ID}/v/l/li/${listId}`;

  // Assign every task in the new list to the VA Lead. If this part fails, the list still exists.
  if (env.CLICKUP_ASSIGNEE_ID) {
    try {
      const { tasks = [] } = await call(env, 'GET', `/list/${listId}/task?subtasks=true&include_closed=true`);
      for (const task of tasks.slice(0, 30)) {
        await call(env, 'PUT', `/task/${task.id}`, { assignees: { add: [Number(env.CLICKUP_ASSIGNEE_ID)], rem: [] } });
      }
    } catch (err) {
      console.error(`ClickUp list ${listId} was created, but assigning its tasks failed: ${err.message}`);
    }
  }
  return url;
}
