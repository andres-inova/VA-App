// Passwords and login sessions.

const ITERATIONS = 100000;
const SESSION_DAYS = 30;
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
export async function startSession(env, userId) {
  const token = toB64(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, expires).run();
  return `sid=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

function sessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function currentUser(request, env) {
  const token = sessionToken(request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND (u.is_admin = 1 OR u.is_va = 1)`
  ).bind(await sha256(token), new Date().toISOString()).first();
}

export async function endSession(request, env) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return 'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

export async function endAllSessions(env, userId) {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
