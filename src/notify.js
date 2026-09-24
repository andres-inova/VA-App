// Sending Slack messages and emails.
// When the Slack key or Gmail keys are missing (for example while testing on
// your own computer), the message is written to the log instead of being sent.

// Slack gives <, > and & special meaning. Use this on any text a person typed.
export const slackSafe = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function postToSlack(env, channel, text) {
  if (!channel) return;
  if (!env.SLACK_BOT_TOKEN) {
    console.log(`[Slack not set up] #${channel}: ${text}`);
    return;
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  const data = await res.json();
  if (!data.ok) console.error(`Slack error for channel ${channel}: ${data.error}`);
}

// ---- Email through Gmail (sent from the EMAIL_FROM account, inovaagent@inovalocal.com) ----

// Turns text into base64, handling accented letters and emoji correctly.
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

// Builds the email in the standard format Gmail expects, with a plain-text and an HTML version.
export function buildMessage({ from, fromName, to, subject, text, html }) {
  const boundary = `b_${crypto.randomUUID()}`;
  const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: "${fromName}" <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${base64(subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function gmailAccessToken(env) {
  const cached = await env.DB.prepare("SELECT value FROM settings WHERE key = 'gmail_token'").first();
  if (cached) {
    const { token, expires } = JSON.parse(cached.value);
    if (expires > Date.now() + 60000) return token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Gmail login failed: ${data.error} ${data.error_description || ''}`);
  const value = JSON.stringify({ token: data.access_token, expires: Date.now() + data.expires_in * 1000 });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('gmail_token', ?)").bind(value).run();
  return data.access_token;
}

// Returns true if the email was sent. A failure is logged and saved as "last_email_error",
// which the Settings page shows, so problems are visible without watching the logs.
export async function sendEmail(env, to, subject, text, html) {
  if (!env.GMAIL_REFRESH_TOKEN || !env.EMAIL_FROM) {
    console.log(`[Email not set up] To ${to}: ${subject}\n${text}`);
    return false;
  }
  let problem;
  try {
    const message = buildMessage({ from: env.EMAIL_FROM, fromName: 'InoVA Check-in Tracker', to, subject, text, html });
    const raw = base64(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await gmailAccessToken(env)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (res.ok) return true;
    problem = `Gmail refused the email: ${res.status} ${(await res.text()).slice(0, 500)}`;
  } catch (err) {
    problem = err.message.slice(0, 500);
  }
  console.error(`Email to ${to} failed: ${problem}`);
  const value = JSON.stringify({ at: new Date().toISOString(), to, problem });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_email_error', ?)").bind(value).run();
  return false;
}
