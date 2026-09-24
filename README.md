# InoVA VA App: check-in tracker

A web app where InoVA Local VAs check in at the start of each work day, call out, and request time off. Check-ins come from the projects each VA is assigned to. Admins see who checked in on time, approve time off, and get Slack alerts and reports.

**Live address:** https://inova-va-app.andres-261.workers.dev

---

## Setup status

### Already done

| What | Details |
|---|---|
| Cloudflare app | Online as `inova-va-app` in andres@inovalocal.com's Cloudflare account. Runs a scheduled job every minute. |
| Database | `inova-checkin` (Cloudflare D1), with all tables and the 4 admins: Andres, Pratap, Kelli, Stephany |
| Zoho fields | The Virtual Assistants module already has **Slack Management ID** and **Slack ID**, filled in for all 12 active VAs. The app reads both. |
| Zoho Projects | The app reads active projects from the `inovalocalprojects` portal (id `890895306`). 15 of the 18 active projects match an active VA by name and are assigned automatically at the first sync. |
| Admin password | Set |
| Slack IDs | Checked: #check-in-tracker (`C0AT17VS51S`), Stephany Baldwin (`U079G0RQCBG`), Kelli Joy (`U014WK8DMC6`) |
| Email sender | Set to inovaagent@inovalocal.com, sent through Google Workspace. No DNS changes needed. |

### Still to do, in this order

1. ~~Set your admin password~~ (done)
2. ~~Create the Slack bot and invite it to the channels~~ (done)
3. ~~Create the Zoho key~~ (done)
4. ~~Create the Gmail key~~ (done)
5. [Connect the time-off/coverage Google Form](#connect-the-timeoffcoverage-google-form): 10 minutes
6. [Test everything](#5-test-everything): 5 minutes

Steps 2 to 4 each end with `npx wrangler secret put` commands. Each command asks you to paste a key, which Cloudflare stores encrypted. **Run them yourself, and never paste the keys into a chat, email or file.** Every key starts working as soon as it's saved, so there's no need to deploy again.

Run all commands in PowerShell, from this folder:
```bash
cd C:\Users\acali\Desktop\work\inovalocal\inova-va-app
```

---

## Why the connectors aren't enough

The connectors added to Claude (Cloudflare, Slack, Zoho CRM, Gmail) let **Claude** read and set things up while you work together. They were used to create the database, put the app online, and check the Slack and Zoho IDs above.

The **app** runs on its own on Cloudflare, even when nobody is chatting with Claude, so it can't use those connectors. It needs its own keys: a Slack bot token, a Zoho key and a Gmail key. Each key gives the app one limited permission:

| Key | What the app can do with it |
|---|---|
| Slack bot token | Post messages, only in channels the bot has been invited to |
| Zoho key | Read the Virtual Assistants module in Zoho CRM and the project list in Zoho Projects. It can't change anything. |
| Gmail key | Send email as inovaagent@inovalocal.com. It can't read the inbox. |

---

## 1. Set your admin password

Done. Other admins get a temporary password from the **People** page (step 5 below).

## 2. Slack bot

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**. Name it **VA App** and choose the Inova Local workspace.
2. Go to **OAuth & Permissions → Scopes → Bot Token Scopes** and add `chat:write`.
3. Click **Install to Workspace** at the top of the same page. A Slack admin may need to approve it.
4. Copy the **Bot User OAuth Token**. It starts with `xoxb-`. Then run:
   ```bash
   npx wrangler secret put SLACK_BOT_TOKEN
   ```
5. **Invite the bot to these channels.** All of them are private, so the bot can't post in them until it's invited. In each channel, type `/invite @VA App`:

   | Channel | Used for |
   |---|---|
   | #check-in-tracker | Late alerts, follow-ups, weekly and monthly reports |
   | #andrew-management | Andrew Villa |
   | #beatrix-management | Beatrix Burger |
   | #carisa-management | Carisa Miller |
   | #crystal-naramore_management | Crystal Naramore |
   | #estefani-resendiz_management | Estefani Resendiz Lopez |
   | #julie-rugenski_management | Julie Rugenski |
   | #kayla-cousins_management | Kayla Cousins |
   | #maria-cabatas_management | Maria Cabatas |
   | #nika-davis_management | Nika Kegbe-Davis |
   | #stephany-baldwin_management | Stephany Baldwin |
   | #tracy-curvin-management | Tracy Curvin |
   | #tracy-saeman_management | Tracy Saeman |

## 3. Zoho key

1. Go to https://api-console.zoho.com → **Add Client** → **Self Client** → **Create**.
2. On the **Generate Code** tab, enter these two scopes, separated by a comma and no spaces:
   ```
   ZohoCRM.modules.custom.READ,ZohoProjects.projects.READ
   ```
   Choose **10 minutes**, type any description, and click **Create**. Copy the code. Use an account that can see both the Virtual Assistants module in Zoho CRM and all projects in Zoho Projects, for example a Zoho admin.
3. On the **Client Secret** tab, copy the **Client ID** and **Client Secret**.
4. Within 10 minutes, swap the code for a long-lasting refresh token. In the command below, replace the three `YOUR_...` values, then run it:
   ```bash
   curl.exe -X POST "https://accounts.zoho.com/oauth/v2/token" -d "grant_type=authorization_code" -d "client_id=YOUR_CLIENT_ID" -d "client_secret=YOUR_CLIENT_SECRET" -d "code=YOUR_CODE"
   ```
   Copy the `refresh_token` value from the reply. If the reply says `invalid_code`, the 10 minutes ran out. Repeat step 2.
5. Save the three values:
   ```bash
   npx wrangler secret put ZOHO_CLIENT_ID
   ```
   ```bash
   npx wrangler secret put ZOHO_CLIENT_SECRET
   ```
   ```bash
   npx wrangler secret put ZOHO_REFRESH_TOKEN
   ```

## 4. Gmail key

Do these steps signed in as **inovaagent@inovalocal.com**.

1. At https://console.cloud.google.com, open the **VA App** project.
2. Search for **Gmail API**, open it, and click **Enable**.
3. Search for **Google Auth Platform**. If it isn't set up yet, click **Get started**: app name **VA App**, support email inovaagent@inovalocal.com, audience **Internal**.
4. **Data Access → Add or remove scopes**: add `https://www.googleapis.com/auth/gmail.send`, then save.
5. **Clients → Create client → Web application**. Under **Authorized redirect URIs**, add `https://developers.google.com/oauthplayground`. Click **Create**, then copy the **Client ID** and **Client Secret**.
6. Go to https://developers.google.com/oauthplayground:
   - Click the gear icon at the top right. Tick **Use your own OAuth credentials**, and paste the Client ID and Client Secret.
   - In the box at the bottom of Step 1, type `https://www.googleapis.com/auth/gmail.send` and click **Authorize APIs**.
   - Sign in as **inovaagent@inovalocal.com** and click **Allow**. This account becomes the sender.
   - In Step 2, click **Exchange authorization code for tokens**, then copy the **Refresh token**.
7. Save the three values:
   ```bash
   npx wrangler secret put GMAIL_CLIENT_ID
   ```
   ```bash
   npx wrangler secret put GMAIL_CLIENT_SECRET
   ```
   ```bash
   npx wrangler secret put GMAIL_REFRESH_TOKEN
   ```

If step 6 says the app is blocked, a Google Workspace admin can allow it at admin.google.com under **Security → Access and data control → API controls**.

## Connect the time-off/coverage Google Form

VAs request time off and coverage with the Google Form **IL Coverage/Time-Off Request**. A small script attached to the form sends each new response to the app. The app matches the **Name** answer to a VA (small typos are allowed) and lists it on the **Time off** page for an admin to approve or deny. If the name matches nobody, the response still appears under **Requests waiting for a decision**, marked "No VA matched". An admin picks the VA, and that VA's projects appear with all of them ticked. The admin unticks any project the request does not cover, clicks **Assign**, and then approves or denies it as usual.

The script and the app share a secret code, so nobody else can send fake requests to the app. Do these steps signed in as the owner of the form.

**1. Make the secret code.** In PowerShell, run:
```bash
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```
It prints a long random code. Keep this window open. You paste the code in two places below, and nowhere else.

**2. Give the code to the app.** In the project folder, run this and paste the code when asked:
```bash
npx wrangler secret put FORM_SECRET
```

**3. Add the script to the form.**
1. Open the form in edit mode. Click the three-dot menu at the top right, then **Apps Script**.
2. Delete the sample code, paste in everything from `google-form-script.js` in this project, and click **Save**. Name the project "VA App form link".
3. Click the gear icon (**Project Settings**). At the bottom, under **Script Properties**, click **Add script property**. Property: `APP_SECRET`. Value: the code from step 1. Click **Save script properties**.
4. Click the clock icon (**Triggers**) → **Add Trigger**. Function: `onFormSubmit`. Event source: **From form**. Event type: **On form submit**. Click **Save**.
5. Google asks you to allow the script to read the form and connect to an external service. Choose your account. If you see "Google hasn't verified this app", click **Advanced**, then **Go to VA App form link**, then **Allow**. This is your own script, so this warning is expected.

**4. Send the responses that already exist (optional).** In the script editor, pick `sendAllResponses` in the function menu at the top and click **Run**. Responses the app already has are skipped, so running it again is safe.

**5. Test it.** Submit the form once with a real VA's name. Within a few seconds it should appear on the app's **Time off** page, and the admins with notifications on should get an email. If it doesn't appear, open **Executions** (the list icon) in the script editor to see the error.

## 5. Test everything

1. Log in and go to **Projects → Sync with Zoho now**. The 18 active projects should appear. 15 should have a VA, and 3 should be listed under "Projects with no VA": Shianne Catalano's two projects (she is On Deck in Zoho, not Active) and InoVA Local - Internal.
2. On the **Projects** page, check each VA's start time and days, and fix any that are wrong. Andrew Villa (InoVA Closer) and Nika Kegbe-Davis (EcoVita) have "Open availability" in Zoho, so their projects start with **no start time**. Until you add one, they get no late alerts.
3. On the **People** page, all 12 active VAs should appear, each with a Slack channel ID and their projects.
4. Go to **Settings → Send weekly report now**. A report should appear in #check-in-tracker, and everyone chosen under "Who gets the report emails" (all admins until changed) should get one email from inovaagent@inovalocal.com. Right after setup it will say nobody missed a check-in, which is expected.
5. On the **People** page, click **Set temporary password** for each VA and admin, and send them their temporary password privately. They choose their own password the first time they log in.
6. Add company holidays on the **Holidays** page.

If something doesn't work, open the Cloudflare dashboard → **Workers & Pages → inova-va-app → Logs**. Errors from Slack, Zoho and Gmail appear there with the reason.

---

## What the app does

**VAs**
- Log in with email and password. The email is the VA's email in Zoho.
- See **today's projects** and the time they need to check in by.
- **Check in** once per day. One check-in covers all of that day's projects. The app records whether it was on time.
- **Call out** with a required reason. The reason is posted in the VA's management channel.
- **Request time off or coverage** with a button that opens the Google Form. Their requests and the admins' decisions then show on their page.
- See their own time-off requests and the last 30 days of check-ins.

**Admins**
- **Today**: every VA's projects today, their check-in time and their status right now.
- **History**: a month grid showing each VA's status per work day, with totals.
- **Projects**: the active projects from Zoho Projects and who is assigned to each, with a start time and work days per assignment. Admins can add, change or remove assignments.
- **Time off**: approve or deny requests from the Google Form. Each new request sends one email to the admins who have notifications turned on. Admins can also add a **time-off or coverage period** for any VA directly, which applies right away, and cancel it later.
- **People**: sync from Zoho, see each VA's projects and whether the app checks them, exempt a VA, set temporary passwords, add or remove admins.
- **Holidays**: dates when nobody is expected to check in.
- **Settings**: turn your time-off emails on or off, set the grace period, choose who gets the report emails, send a report now, and see the last email error.

**Automatic (the job runs every minute)**
- **10 minutes** after a VA's earliest project start with no check-in: #check-in-tracker gets a message tagging Stephany (VA Lead), and the VA's management channel gets a message tagging the VA.
- **15 minutes** after: #check-in-tracker gets a message tagging Kelli.
- If the VA checks in after an alert, #check-in-tracker gets a "checked in at…" message.
- **Weekly report**, Mondays at 9:00 AM Eastern: VAs with 2 or more missed check-ins in the previous Monday–Sunday. Posted in #check-in-tracker and sent as one email to the report recipients.
- **Monthly report**, the 1st at 9:00 AM Eastern: VAs with 3 or more missed check-ins in the previous month. Posted and emailed the same way.
- **Report recipients** are chosen on the Settings page: any of the admins, plus other email addresses. Until someone saves a choice, all admins get them.
- **Zoho sync** every hour: VAs with VA Status "Active" can log in as VAs, and VAs who stop being Active lose access. Active projects are copied from Zoho Projects, and new ones are assigned by name (see below). Projects that are completed or closed in Zoho stop counting.

## Rules the app follows

- **Check-ins come from projects.** Each assignment of a VA to a project has a start time and work days. Days default to Monday to Friday.
- **One check-in per day:** if a VA has several projects on the same day, they check in once, by the **earliest** start time, and that check-in counts for all of them. For example, Pool Partners at 9:00 and Rise & Shine at 11:00 means one check-in due by 9:00.
- **No projects that day, or no start times**, means no check-in is expected and no late alerts are sent. The VA can still check in.
- **Holidays**: no check-in is expected on dates listed under Holidays.
- **Exempt VAs are never checked.** A VA is exempt when their Zoho **VA Company Affiliation** is anything other than "InoVA Local" (for example "Closers", or empty), or when an admin clicks **Exempt this VA** on the People page. Exempt VAs get no expected check-in, no late alerts, and don't appear in reports. They can still log in, check in and request time off. An empty affiliation shows a warning on the People page.
- **Time-off and coverage periods**: on any day inside an approved request or a period added by an admin, the VA is not expected to check in. A request assigned from an unknown name can cover only some of the VA's projects: on those days the VA is off only for the ticked projects, and still checks in by the earliest start among their other projects that day. If all their projects are ticked, it covers the whole day. The day shows as "Time off" or "Coverage" in History. If a period is cancelled, check-ins are expected again from that day on.
- **Start times** are in the VA's Zoho **Time Zone** (PST, MST, CST or EST, with daylight saving time applied). If Time Zone is empty, the app uses Eastern.
- **Automatic assignment:** when a new project appears in Zoho Projects, the app reads the name after the last " - " (for example "Pool Partners - **Tracy Saeman**") and assigns the project to the active VA with that name. Small differences are allowed: "Estefani Resendiz" matches "Estefani Resendiz Lopez", and "Nika Kedgbe-Davis" matches "Nika Kegbe-Davis". The first name must match, plus at least one other part of the name. If two VAs could match, nothing is assigned. The start time is taken from the VA's Zoho **Availability**, for example "8:30am - 4:30pm" means 8:30 AM. "Open availability" gives no start time.
- **After a project is assigned** (automatically or by an admin), the sync leaves it alone, so an admin's changes are kept. A project that no VA matched is tried again at each sync, for example when an On Deck VA becomes Active.
- **On time** means checking in no later than the start time plus the grace period. The grace period starts at 0 minutes and can be changed in Settings.
- **Missed**, in reports, means late or no check-in at all. Call-outs and approved time off are not counted as missed.
- A shift with no check-in 12 hours after its start is marked "No check-in".

## Adding a new VA

1. In Zoho, set their **VA Status** to **Active**. Fill in **Email**, **Time Zone**, **Availability**, **Slack ID** and **Slack Management ID**.
2. In Slack, invite the bot to their management channel: `/invite @VA App`.
3. In the app, go to **Projects → Sync with Zoho now**. The app also syncs by itself every hour. Their projects in Zoho Projects are assigned to them if the name after " - " matches. Check the start times on the Projects page.
4. On the **People** page, click **Set temporary password** for them.

## Keeping things working

- **Forgotten password:** an admin clicks **Set temporary password** for that person.
- **If the inovaagent@inovalocal.com password changes,** Google cancels the Gmail key and emails stop. Repeat step 4.6 and the `GMAIL_REFRESH_TOKEN` command.
- **Slack IDs** for the check-in channel, VA Lead or Kelli are in `vars` in `wrangler.jsonc`. After editing them, run `npm run deploy`.
- **Alert times (10 and 15 minutes)** are in `src/jobs.js`.
- **Report thresholds (2 weekly, 3 monthly)** are in `buildReport` in `src/jobs.js`.

## Files

| File | What it is |
|---|---|
| `src/index.js` | Handles each page and each button press |
| `src/views.js` | The HTML and styling of every page |
| `src/jobs.js` | The every-minute job: late alerts, reports, Zoho sync |
| `src/auth.js` | Passwords and login sessions |
| `src/forms.js` | Receives responses from the time-off/coverage Google Form |
| `google-form-script.js` | The script to paste into the Google Form (not part of the app itself) |
| `src/zoho.js` | Reads active VAs from Zoho CRM and active projects from Zoho Projects, and assigns new projects by name |
| `src/notify.js` | Sends Slack messages, and emails through Gmail |
| `src/time.js` | Time zone and date calculations |
| `schema.sql` | The database tables, plus the 4 starting admins (used to create a new database) |
| `migrations/` | Changes to apply to an existing database. Already applied to the online database. |
| `wrangler.jsonc` | Cloudflare settings: app name, database, schedule, Slack IDs, sender email |

## Testing on this computer

```bash
npm run db:local
```
```bash
npm run dev
```
Open http://localhost:8787. Slack messages and emails aren't sent while testing. They're written in the terminal instead. To run the every-minute job once by hand, open http://localhost:8787/__scheduled.

After changing the code, put the new version online with:
```bash
npm run deploy
```
