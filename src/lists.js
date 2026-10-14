// The tools on the list pages (Clients, Contacts, VAs and Hiring): which columns show (chosen and saved per admin
// in the settings table, key list_cols:<user id>:<list>), sorting by a column, filters on fields, the fields that can
// be changed on many records at once (see bulkField in records.js) and the CSV export. Lists are a few hundred
// records, so filtering and sorting happen in memory after one query.

import { MODULES, formFields, plainValue } from './fields.js';
import { REPORT_ZONE } from './time.js';

// The fields that make up a record's name (the Name column is always first, so they are not offered as columns).
const NAME_KEYS = { clients: ['Account_Name'], vas: ['Name'], contacts: ['First_Name', 'Last_Name'], applicants: ['Name', 'Last_Name'] };

// Columns that are not fields: worked out from other tables, or the record's dates.
const EXTRA = {
  clients: [['_vas', 'VAs'], ['_tags', 'Tags'], ['_created', 'Created'], ['_updated', 'Last changed']],
  vas: [['_clients', 'Clients'], ['_tags', 'Tags'], ['_created', 'Created'], ['_updated', 'Last changed']],
  contacts: [['_client', 'Client'], ['_created', 'Created'], ['_updated', 'Last changed']],
  applicants: [['_scores', 'Scores'], ['_tags', 'Tags'], ['_created', 'Applied'], ['_updated', 'Last changed']],
};

// The columns a list has until an admin chooses others (what the lists showed before columns could be chosen).
const DEFAULTS = {
  clients: ['Status', 'Contact', 'Timezone', 'Shift', 'Package_Hours', '_vas', '_tags'],
  vas: ['VA_Status', 'Time_Zone', 'Availability', '_clients', '_tags'],
  contacts: ['Title', 'Email', 'Phone', '_client'],
  applicants: ['Email', 'Location', 'Time_zone', '_scores', '_tags', '_created'],
};
export const MAX_COLS = 12;

// Fields that can't be changed on many records at once: names, emails (VAs log in with theirs, so each must be
// different), Slack IDs (one per person), and kinds of fields that point at other records or hold files.
const NO_BULK = ['Email', 'Secondary_Email', 'Slack_ID', 'Slack_Management_ID'];
const BULK_TYPES = ['pick', 'owner', 'bool', 'text', 'int', 'num', 'money', 'date', 'multi'];
export const MAX_BULK = 200;

const NUMBER = ['int', 'num', 'money'];

// A day (YYYY-MM-DD, in the report time zone) from a saved time.
export function dayOf(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: REPORT_ZONE });
}

// Every column an admin can choose for a list: the fields in the order of Settings > Fields, then the extra ones.
// { key, label, type, x (the field, for fields) }
export function columnChoices(key) {
  const names = NAME_KEYS[key];
  const fields = formFields(key).filter((x) => !names.includes(x.key)).map((x) => ({ key: x.key, label: x.label, type: x.type, x }));
  return [...fields, ...EXTRA[key].map(([k, label]) => ({ key: k, label, type: k === '_created' || k === '_updated' ? 'date' : 'extra' }))];
}

const pick = (key, keys) => {
  const set = new Set(keys);
  return columnChoices(key).filter((c) => set.has(c.key)).slice(0, MAX_COLS);
};

// The columns this admin chose for this list (or the standard ones). { cols, custom (true when chosen) }
export async function savedColumns(env, userId, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`list_cols:${userId}:${key}`).first();
  let keys = null;
  try { keys = row ? JSON.parse(row.value) : null; } catch { keys = null; }
  return Array.isArray(keys) ? { cols: pick(key, keys), custom: true } : { cols: pick(key, DEFAULTS[key]), custom: false };
}

// Saves an admin's columns (reset: back to the standard ones).
export async function saveColumns(env, userId, key, keys, reset) {
  const id = `list_cols:${userId}:${key}`;
  if (reset) return env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(id).run();
  const chosen = pick(key, keys).map((c) => c.key);
  return env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(id, JSON.stringify(chosen)).run();
}

// A column's value for a record: the saved field value, or the extra value worked out for the list (r.extra).
export function cellValue(c, r) {
  if (c.key === '_created') return dayOf(r.created_at);
  if (c.key === '_updated') return dayOf(r.updated_at);
  if (c.key.startsWith('_')) return r.extra?.[c.key] ?? '';
  return r.data[c.key];
}

// A column's value as plain text (for sorting, text filters and the CSV file).
export function cellText(c, r, names) {
  const v = cellValue(c, r);
  return c.x ? plainValue(c.x, v, names) : String(v ?? '');
}

// ---- Sorting ----

// The sort in the address (?sort=<column>&dir=asc|desc), or null for the list's normal order.
export function sortOf(key, url) {
  const by = url.searchParams.get('sort');
  if (!by) return null;
  const c = by === 'name' ? { key: 'name', type: 'text' } : columnChoices(key).find((x) => x.key === by);
  return c ? { c, desc: url.searchParams.get('dir') === 'desc' } : null;
}

// Sorts the records by one column; empty values always go last.
export function sortRows(rows, { c, desc }, names) {
  const num = NUMBER.includes(c.type);
  const val = (r) => {
    if (c.key === 'name') return (r.name || '').toLowerCase();
    if (num) { const v = cellValue(c, r); return v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v); }
    const t = cellText(c, r, names).toLowerCase();
    return t || null;
  };
  const keyed = rows.map((r) => [val(r), r]);
  keyed.sort((a, b) => {
    if (a[0] === null || b[0] === null) return a[0] === b[0] ? 0 : a[0] === null ? 1 : -1;
    const d = num ? a[0] - b[0] : String(a[0]).localeCompare(String(b[0]), 'en', { numeric: true });
    return desc ? -d : d;
  });
  return keyed.map(([, r]) => r);
}

// ---- Filters on fields ----

// What kind of filter a column gets: any (pick lists), text (contains), num or date (between), bool (yes/no).
function filterKind(c) {
  if (c.type === 'pick' || c.type === 'owner' || c.type === 'multi') return 'any';
  if (NUMBER.includes(c.type)) return 'num';
  if (c.type === 'date') return 'date';
  if (c.type === 'bool') return 'bool';
  if (['lookup', 'lookups', 'file', 'tags'].includes(c.type) || c.key === '_tags' || c.key === '_scores') return null;
  return 'text';
}

// The fields of a list for the page's script: the Filter box and "Change a field" in the bulk bar.
// { k, l (label), f (filter kind), t (field type), o (choices), min, max, step, b (can be changed on many), req }
export function fieldsForScript(key, owners) {
  const bulk = new Set(bulkFields(key).map((x) => x.key));
  return columnChoices(key).filter((c) => filterKind(c) || bulk.has(c.key)).map((c) => {
    const x = c.x || {};
    const out = { k: c.key, l: c.label, f: filterKind(c), t: c.type };
    if (c.type === 'owner') out.o = owners;
    else if (x.options) out.o = x.options;
    for (const p of ['min', 'max', 'step']) if (x[p] !== undefined) out[p] = x[p];
    if (bulk.has(c.key)) { out.b = 1; if (c.key === MODULES[key].statusKey) out.req = 1; }
    return out;
  });
}

const OPS = { any: ['any'], text: ['has'], num: ['btw'], date: ['btw'], bool: ['yes', 'no'] };

// The filters in the address: f=<column>:<how>:<value>, as many as wanted (all must match). How: any (value: choices
// separated by |), has (text), btw (from..to), yes, no, empty, set (not empty).
export function filtersOf(key, url) {
  const choices = columnChoices(key);
  const out = [];
  for (const raw of url.searchParams.getAll('f').slice(0, 20)) {
    const [k, op, ...rest] = raw.split(':');
    const value = rest.join(':');
    const c = choices.find((x) => x.key === k);
    const kind = c && filterKind(c);
    if (!kind || !(OPS[kind].includes(op) || op === 'empty' || op === 'set')) continue;
    if (op === 'any') { const vals = value.split('|').filter(Boolean); if (vals.length) out.push({ c, op, vals }); continue; }
    if (op === 'has') { if (value.trim()) out.push({ c, op, text: value.trim().toLowerCase() }); continue; }
    if (op === 'btw') {
      const [from = '', to = ''] = value.split('..');
      const ok = (v) => (kind === 'num' ? v !== '' && !Number.isNaN(Number(v)) : /^\d{4}-\d{2}-\d{2}$/.test(v));
      if (ok(from) || ok(to)) out.push({ c, op, from: ok(from) ? from : null, to: ok(to) ? to : null, num: kind === 'num' });
      continue;
    }
    out.push({ c, op });
  }
  return out;
}

const blank = (v) => v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length);

// Does a record match every filter?
export function matchesAll(r, filters, names) {
  return filters.every((f) => {
    const v = cellValue(f.c, r);
    switch (f.op) {
      case 'empty': return blank(v);
      case 'set': return !blank(v);
      case 'yes': return Boolean(v);
      case 'no': return !v;
      case 'any': return Array.isArray(v) ? v.some((x) => f.vals.includes(x)) : f.vals.includes(String(v ?? ''));
      case 'has': return cellText(f.c, r, names).toLowerCase().includes(f.text);
      case 'btw': {
        if (blank(v)) return false;
        const n = f.num ? Number(v) : String(v);
        if (f.num && Number.isNaN(n)) return false;
        const lo = f.from === null ? null : f.num ? Number(f.from) : f.from;
        const hi = f.to === null ? null : f.num ? Number(f.to) : f.to;
        return (lo === null || n >= lo) && (hi === null || n <= hi);
      }
      default: return true;
    }
  });
}

// ---- Changing a field on many records ----

export const bulkFields = (key) => formFields(key).filter((x) => BULK_TYPES.includes(x.type) && !NAME_KEYS[key].includes(x.key) && !NO_BULK.includes(x.key));

// ---- CSV ----

// One cell: numbers as they are; text that a spreadsheet could run as a formula (starting with = + - @, a tab or a
// line break) gets a ' in front; quotes around anything with a comma, quote or line break.
function csvCell(v) {
  if (typeof v === 'number') return String(v);
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The CSV file: UTF-8 with a byte order mark (so Excel shows accents correctly), Windows line ends.
export const toCsv = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

// A column's value for the CSV file: numbers stay numbers, the rest as plain text.
export function csvValue(c, r, names) {
  const v = cellValue(c, r);
  if (NUMBER.includes(c.type) && typeof v === 'number') return v;
  return cellText(c, r, names);
}

// Every column for "All fields" in the export (also the ones not chosen).
export const allColumns = (key) => columnChoices(key);
