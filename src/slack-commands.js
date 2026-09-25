// Slack slash commands: /checkin and /callout <reason>.
// Slack sends each command here; the app checks it really came from Slack (SLACK_SIGNING_SECRET),
// finds the VA by their Slack ID (the "Slack ID" field in Zoho), and replies privately to them.

import { checkIn, callOut } from './actions.js';
import { STATUS } from './views.js';

const reply = (text) => new Response(JSON.stringify({ response_type: 'ephemeral', text }), {
  headers: { 'Content-Type': 'application/json' },
});

async function signedBySlack(env, request, body) {
  const secret = (env.SLACK_SIGNING_SECRET || '').trim();
  const timestamp = request.headers.get('X-Slack-Request-Timestamp') || '';
  const signature = request.headers.get('X-Slack-Signature') || '';
  if (!secret || !timestamp || !signature) return false;
  // Refuse requests older than 5 minutes, so an old request can't be replayed.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${timestamp}:${body}`));
  const expected = `v0=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export async function handleSlackCommand(request, env) {
  const body = await request.text();
  if (!(await signedBySlack(env, request, body))) return new Response('Not from Slack.', { status: 401 });
  const form = new URLSearchParams(body);
  const command = form.get('command') || '';
  const text = form.get('text') || '';
  const user = await env.DB.prepare('SELECT * FROM users WHERE slack_user_id = ? AND is_va = 1').bind(form.get('user_id')).first();
  if (!user) {
    return reply("I couldn't find you in the InoVA check-in app. Please ask your VA Lead to check that your Slack ID is filled in on Zoho.");
  }

  if (command === '/checkin') {
    const r = await checkIn(env, user);
    if (r.result === 'already-in') return reply(`You already checked in today at ${r.time} ${r.day.zoneLabel}. ✅`);
    const label = (STATUS[r.status] || ['Checked in'])[0];
    const note = r.status === 'late' ? ' Your check-in was after your start time, so it counts as late.' : '';
    return reply(`✅ You're checked in at ${r.time} ${r.day.zoneLabel} (${label}).${note} Have a good shift!`);
  }

  if (command === '/callout') {
    const r = await callOut(env, user, text);
    if (r.result === 'reason-needed') return reply('Please add a short reason, for example: `/callout I have a fever`');
    return reply('Your call-out was sent to your management channel. Feel better soon. 💙');
  }

  return reply('I only know `/checkin` and `/callout <reason>`.');
}
