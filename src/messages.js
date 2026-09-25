// The standard format for every email and Slack message the app sends.
//
// Every message has the same parts, in the same order:
//   1. Title          one line, with an emoji that says what kind of message it is
//   2. Subtitle       the dates or the person it's about
//   3. Intro          one or two plain sentences saying what happened or what to do
//   4. Figures        (optional) a row of numbers, e.g. on-time rate
//   5. Details        (optional) a short list or table
//   6. Button         one action, e.g. "Open the check-in app"
//   7. Footer         a small note that explains terms or who to ask
//
// Emails get a plain-text version too, for email apps that don't show HTML.

import { esc } from './util.js';
import { slackSafe } from './notify.js';

const BRAND = '#008069';

// ---- Email ----

// figures: [{ label, value }]; details: HTML string; plainDetails: text version of the details.
export function email({ title, subtitle, greeting, intro, figures = [], details = '', plainDetails = '', button, footer = '' }) {
  const figuresHtml = figures.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr>${figures.map((f) =>
      `<td align="center" style="padding:10px 6px;background:#f3f7f6;border-radius:10px">
        <div style="font-size:22px;font-weight:800;color:#111b21">${esc(f.value)}</div>
        <div style="font-size:12px;color:#667781">${esc(f.label)}</div></td>`).join('<td width="8"></td>')}</tr></table>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#efeae2;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111b21">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efeae2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:${BRAND};padding:16px 24px;color:#ffffff;font-weight:800;font-size:16px">InoVA Check-in</td></tr>
  <tr><td style="padding:24px">
    <div style="font-size:22px;font-weight:800;margin:0 0 4px">${esc(title)}</div>
    ${subtitle ? `<div style="color:#667781;font-size:14px;margin-bottom:16px">${esc(subtitle)}</div>` : ''}
    ${greeting ? `<p style="margin:0 0 10px;font-size:15px">${esc(greeting)}</p>` : ''}
    <p style="margin:0 0 10px;font-size:15px;line-height:1.5">${intro}</p>
    ${figuresHtml}
    ${details}
    ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="background:#00a884;border-radius:99px">
      <a href="${esc(button.url)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-weight:800;text-decoration:none;font-size:15px">${esc(button.label)}</a></td></tr></table>` : ''}
    ${footer ? `<p style="color:#667781;font-size:13px;line-height:1.5;margin:18px 0 0">${footer}</p>` : ''}
  </td></tr>
</table></td></tr></table></body></html>`;

  const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [
    title, subtitle, '', greeting, strip(intro),
    figures.length ? `\n${figures.map((f) => `${f.label}: ${f.value}`).join(' | ')}` : '',
    plainDetails ? `\n${plainDetails}` : '',
    button ? `\n${button.label}: ${button.url}` : '',
    footer ? `\n${strip(footer)}` : '',
  ].filter((line) => line !== undefined && line !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { html, text };
}

// A simple table for email details. rows: arrays of cell strings (already escaped).
export function emailTable(headers, rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:6px 0">
    <tr>${headers.map((h) => `<th align="left" style="padding:8px;border-bottom:2px solid #e6e2dc;color:#667781;font-size:12px;text-transform:uppercase">${esc(h)}</th>`).join('')}</tr>
    ${rows.map((r) => `<tr>${r.map((c) => `<td style="padding:8px;border-bottom:1px solid #eeeae4;vertical-align:top">${c}</td>`).join('')}</tr>`).join('')}
  </table>`;
}

// ---- Slack (Block Kit) ----

// Returns { text, blocks }. text is what Slack shows in notifications.
export function slack({ title, subtitle, intro, figures = [], details = [], button, footer = '' }) {
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: title, emoji: true } }];
  if (subtitle) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: slackSafe(subtitle) }] });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: intro } });
  if (figures.length) {
    blocks.push({ type: 'section', fields: figures.slice(0, 10).map((f) => ({ type: 'mrkdwn', text: `*${slackSafe(f.label)}*\n${slackSafe(f.value)}` })) });
  }
  if (details.length) {
    blocks.push({ type: 'divider' });
    // Slack allows 3000 characters per block; split long lists.
    let chunk = '';
    for (const line of details) {
      if ((chunk + line).length > 2800) { blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } }); chunk = ''; }
      chunk += `${line}\n`;
    }
    if (chunk) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
  }
  if (button) {
    blocks.push({ type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: button.label, emoji: true }, url: button.url }] });
  }
  if (footer) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: footer }] });
  return { text: `${title}${subtitle ? ` · ${subtitle}` : ''}`, blocks };
}
