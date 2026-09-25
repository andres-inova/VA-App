// Login invites: a temporary password sent to the person by email (and Slack, for VAs with a Slack ID),
// in the standard message format (see messages.js).

import * as messages from './messages.js';
import { sendEmail, postToSlack } from './notify.js';
import { hashPassword, temporaryPassword, endAllSessions } from './auth.js';
import { esc } from './util.js';

// Gives the person a new temporary password. They must choose their own at their first log-in.
export async function newTemporaryPassword(env, person) {
  const password = temporaryPassword();
  await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?')
    .bind(await hashPassword(password), person.id).run();
  await endAllSessions(env, person.id);
  return password;
}

export function inviteMessage(env, person, password) {
  const first = person.name.split(' ')[0];
  const url = `${env.APP_URL}/login`;
  const role = person.is_va
    ? 'You will use it to check in at the start of each work day, call out if you cannot work, and see your time-off requests.'
    : 'You will use it to see who has checked in, handle time-off requests, and manage VAs and projects.';
  const steps = [
    `Open ${url}`,
    `Log in with your email (${person.email}) and the temporary password above.`,
    'Choose your own password. The temporary one stops working after that.',
  ];
  const tips = [
    'Add it to your phone: on iPhone, open the link in Safari, tap Share, then "Add to Home Screen". On Android, open it in Chrome, tap the three dots, then "Install app".',
    person.is_va && person.slack_user_id ? 'You can also check in from Slack: type /checkin in any channel. To call out, type /callout and a short reason.' : '',
  ].filter(Boolean);
  const footer = 'Questions? Ask your VA Lead on Slack. If you didn\'t expect this message, you can ignore it.';

  const mail = messages.email({
    title: '👋 Welcome to InoVA Check-in',
    subtitle: 'Your login details',
    greeting: `Hi ${first},`,
    intro: `You now have an account in the InoVA Check-in app. ${esc(role)}`,
    details: `
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f3f7f6;border-radius:12px;width:100%;margin:12px 0"><tr><td style="padding:14px 16px;font-size:15px;line-height:1.7">
        <div><span style="color:#667781">Email:</span> <strong>${esc(person.email)}</strong></div>
        <div><span style="color:#667781">Temporary password:</span> <strong style="font-family:Consolas,monospace;font-size:17px;letter-spacing:.5px">${esc(password)}</strong></div>
      </td></tr></table>
      <ol style="padding-left:20px;margin:10px 0;line-height:1.6">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${tips.map((t) => `<p style="font-size:14px;color:#3b4a54;margin:8px 0">💡 ${esc(t)}</p>`).join('')}`,
    plainDetails: `Email: ${person.email}\nTemporary password: ${password}\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n${tips.join('\n')}`,
    button: { label: 'Log in now', url },
    footer: esc(footer),
  });
  const slackMsg = messages.slack({
    title: '👋 Welcome to InoVA Check-in',
    subtitle: 'Your login details',
    intro: `Hi ${first}! You now have an account in the InoVA Check-in app. ${role}`,
    figures: [{ label: 'Email', value: person.email }, { label: 'Temporary password', value: password }],
    details: steps.map((s, i) => `${i + 1}. ${s}`).concat(tips.map((t) => `💡 ${t}`)),
    button: { label: 'Log in now', url },
    footer,
  });
  return { subject: 'Your InoVA Check-in login', email: mail, slack: slackMsg };
}

// Sends the invite. Returns { password, emailed, slacked }.
export async function sendInvite(env, person) {
  const password = await newTemporaryPassword(env, person);
  const msg = inviteMessage(env, person, password);
  const emailed = await sendEmail(env, person.email, msg.subject, msg.email.text, msg.email.html);
  // Slack: a direct message from the app to the VA (only VAs have a Slack ID in Zoho).
  const slacked = person.slack_user_id ? await postToSlack(env, person.slack_user_id, msg.slack.text, msg.slack.blocks) : false;
  await env.DB.prepare('UPDATE users SET invited_at = ? WHERE id = ?').bind(new Date().toISOString(), person.id).run();
  return { password, emailed, slacked };
}
