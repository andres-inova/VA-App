// Small shared helpers.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Makes text safe to place inside a web page.
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function redirect(location, cookie) {
  const headers = { Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

export function page(html, status = 200, cookie) {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(html, { status, headers });
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

// Whether two projects (or a project and a coverage row) are for the same client: the same client record when both
// have one (projects.client_record_id), otherwise the same client name (any case).
export const sameClient = (a, b) => (a.client_record_id && b.client_record_id
  ? Number(a.client_record_id) === Number(b.client_record_id)
  : (a.client || '').trim().toLowerCase() === (b.client || '').trim().toLowerCase());
