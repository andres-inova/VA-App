# InoVA VA App

Check-in tracker for InoVA Local VAs: a Cloudflare Worker (`src/`) with a D1 database (`inova-checkin`), live at https://inova-va-app.andres-261.workers.dev. `README.md` explains setup and every feature.

## Working rules
- Explain things to the user in plain, simple language, with no similes or metaphors. The user is new to building apps.
- Deploy by committing and running `git push origin main`; Cloudflare Workers Builds deploys it. Do not run `wrangler deploy`.
- Database changes: add a file in `migrations/`, update `schema.sql`, and run the migration once with `npx wrangler d1 execute inova-checkin --remote --file=migrations/<file>` before pushing code that needs it.
- Test on this computer before pushing (see "Testing" in HANDOFF.md), then stop leftover `node`/`workerd` processes.
- Secrets live only in Cloudflare (`npx wrangler secret put NAME`). Never put them in files or ask for them in chat.
- Every email and Slack message uses the standard format in `src/messages.js`.

## Handoff notes
After each completed step, update HANDOFF.md with: goal, current status, files changed, key decisions, open issues, and the next step. Keep it short.
After a compaction or at the start of a session, read HANDOFF.md before continuing (if its contents aren't already in context).
