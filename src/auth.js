// Passwords and login sessions.

const ITERATIONS = 100000;
// "Keep me logged in": the login lasts a year and is extended each time the person uses the app.
// Without it, the login ends when the browser is closed (or after 12 hours).
const REMEMBER_DAYS = 365;
const SHORT_HOURS = 12;
const COOKIE = 'HttpOnly; Secure; SameSite=Lax; Path=/';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const enc = new TextEncoder();
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

// Passwords are never stored. Only a one-way scrambled version is kept.
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [, iter, salt, hash] = stored.split('$');
  const test = await derive(password, fromB64(salt), Number(iter));
  const expected = fromB64(hash);
  if (test.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < test.length; i++) diff |= test[i] ^ expected[i];
  return diff === 0;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return toB64(new Uint8Array(digest));
}

export function passwordProblem(password, confirm) {
  if (!password || password.length < 10) return 'Passwords must be at least 10 characters.';
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

// A random temporary password such as "kmtq-4hzr-p8wd".
export function temporaryPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

// Checks an email and password. Returns { user } or { error }.
export async function checkLogin(env, email, password) {
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || !user.password_hash) return { error: 'wrong' };
  if (user.locked_until && user.locked_until > new Date().toISOString()) return { error: 'locked' };

  if (!(await verifyPassword(password, user.password_hash))) {
    const failed = user.failed_logins + 1;
    const lockedUntil = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(lockedUntil ? 0 : failed, lockedUntil, user.id).run();
    return { error: lockedUntil ? 'locked' : 'wrong' };
  }
  if (!user.is_admin && !user.is_va) return { error: 'inactive' };

  await env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();
  return { user };
}

// Creates a session and returns the cookie header that keeps the person logged in.
export async function startSession(env, userId, remember = true) {
  const token = toB64(crypto.getRandomValues(new Uint8Array(32)));
  const ms = remember ? REMEMBER_DAYS * 86400000 : SHORT_HOURS * 3600000;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, new Date(Date.now() + ms).toISOString()).run();
  return sessionCookie(token, remember);
}

// With no Max-Age, the browser forgets the cookie when it is closed.
function sessionCookie(token, remember) {
  return `sid=${encodeURIComponent(token)}; ${COOKIE}${remember ? `; Max-Age=${REMEMBER_DAYS * 86400}` : ''}`;
}

// The email of the last person who logged in on this browser, to fill in the login form.
export function rememberedEmail(request) {
  const m = /(?:^|;\s*)last_email=([^;]+)/.exec(request.headers.get('Cookie') || '');
  return m ? decodeURIComponent(m[1]) : '';
}
export function rememberEmailCookie(email) {
  return `last_email=${encodeURIComponent(email)}; ${COOKIE}; Max-Age=${REMEMBER_DAYS * 86400}`;
}

// Logins that were extended during this request; index.js adds the new cookie to the response.
const renewed = new WeakMap();
export const renewedCookie = (request) => renewed.get(request);

function sessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function currentUser(request, env) {
  const token = sessionToken(request);
  if (!token) return null;
  const hash = await sha256(token);
  const user = await env.DB.prepare(
    `SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND (u.is_admin = 1 OR u.is_va = 1)`
  ).bind(hash, new Date().toISOString()).first();
  // Extend a "keep me logged in" login once a day, so people who use the app are never logged out.
  // Short logins (12 hours) are never extended.
  const daysLeft = user ? (Date.parse(user.session_expires) - Date.now()) / 86400000 : 0;
  if (daysLeft > 1 && daysLeft < REMEMBER_DAYS - 1) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(new Date(Date.now() + REMEMBER_DAYS * 86400000).toISOString(), hash).run();
    renewed.set(request, sessionCookie(token, true));
  }
  return user;
}

export async function endSession(request, env) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return `sid=; ${COOKIE}; Max-Age=0`;
}

export async function endAllSessions(env, userId) {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
