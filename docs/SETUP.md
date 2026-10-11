# ControlPad — Setup Guide

The accounts and keys **you** need to create. Claude Code can't make accounts or handle your secrets, so this is the part that's on you — it's mostly copy-and-paste. Exact button labels on these third-party sites change occasionally; the official docs (linked) are the final word.

> Twilio is optional until you want texts to actually go out — until then every alert is logged on the Messages page.

---

## 0. Prerequisites

- A **GitHub** account (your code repo lives here; Vercel deploys from it).
- **Node.js** installed (Claude Code will tell you the version it wants).
- Official docs: GitHub <https://docs.github.com> · Node <https://nodejs.org>

## 1. Supabase (database + auth)

1. Create an account and a new **project** at <https://supabase.com>. Pick a strong database password and save it.
2. Choose a region close to Massachusetts (e.g. US East).
3. Once the project is ready, go to **Project Settings → API** and copy three values:
   - **Project URL**
   - **anon public** key
   - **service_role** key  ← secret, server-only, never in the browser
4. Docs: <https://supabase.com/docs>

## 2. Vercel (hosting)

1. Create an account at <https://vercel.com> and sign in with GitHub.
2. **Import** your ControlPad repo when you're ready to deploy (Claude Code will have created it).
3. You'll add environment variables here (next section) under the project's **Settings → Environment Variables**.
4. Docs: <https://vercel.com/docs>

## 3. Twilio (SMS) — can wait until you're ready to text

ControlPad works without Twilio: every alert is generated and logged on the **Messages** page (admin sidebar) as "Not sent (dry run)". Nothing is texted until the three Twilio variables below are set. You can buy the number whenever you're ready.

**When you're ready:**

1. Create an account at <https://www.twilio.com> and upgrade from trial (trial accounts can only text numbers you've verified).
2. Buy an SMS-capable number (Phone Numbers → Buy a number). Rough cost: ~$1–2/month plus well under a cent per text — check current pricing.
3. **Register for A2P 10DLC** (Messaging → Regulatory Compliance). US carriers block automated texts from local numbers that aren't registered. You register your organization ("brand") and describe the use case ("campaign", e.g. school attendance and account notifications to parents who provided their number). Approval usually takes days to a couple of weeks and has small one-time and monthly fees — start this early. A toll-free number is an alternative with its own verification step. Docs: <https://www.twilio.com/docs/messaging/compliance/a2p-10dlc>
4. Copy the **Account SID**, **Auth Token** (secret), and your number in E.164 format (e.g. `+1413...`).
5. In Vercel, add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, plus `SMS_MODE=test` and `SMS_TEST_NUMBER=<your cell>`. Redeploy.
6. **Incoming texts (parent-reported absences):** in Twilio → Phone Numbers → your number → *Messaging configuration*, set **"A message comes in"** to Webhook, `https://control-pad.vercel.app/api/sms/inbound`, HTTP **POST**. Save. ControlPad checks Twilio's signature on every request using `TWILIO_AUTH_TOKEN`, so nothing else is needed. (Only if your public URL ever differs from what the app sees, set `TWILIO_INBOUND_URL` to the exact URL entered in Twilio.) Before this is set up you can try it from **Messages → Incoming texts → Simulate text**.
7. On **Messages**, press **Send me a test text** (uses your phone from the Staff page). In test mode every alert goes to your cell, labelled with who it was meant for. Watch it for a few school days.
8. When it looks right, change `SMS_MODE` to `live` (or delete it) and redeploy. Parents start receiving texts.

To stop all texting at any time, set `SMS_MODE=off` and redeploy.

---

## 4. Environment variables

Put these in a local `.env.local` (must be gitignored) **and** in Vercel's project settings. Claude Code will reference exactly these names.

| Variable | Where from | Public? |
|----------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → API → Project URL | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → anon public | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → service_role | **NO — secret** |
| `TWILIO_ACCOUNT_SID` | Twilio Console | **NO — secret** |
| `TWILIO_AUTH_TOKEN` | Twilio Console | **NO — secret** |
| `TWILIO_PHONE_NUMBER` | your Twilio number | yes-ish (keep with the rest) |
| `CRON_SECRET` | you invent a long random string | **NO — secret** |
| `SMS_MODE` | `off`, `test`, or `live` (defaults to `live` once Twilio is set, `off` before) | no |
| `SMS_TEST_NUMBER` | your cell in E.164; all texts go here when `SMS_MODE=test` | keep private |
| `TWILIO_INBOUND_URL` | optional — only if Twilio's webhook URL differs from the app's own URL | no |

`STRIPE_*` variables come later, only if/when you add online payments.

> **Rule of thumb:** anything starting with `NEXT_PUBLIC_` is visible in the browser. Never give a secret that prefix. The `service_role` key and Twilio token must stay server-side only.

---

## 5. Attendance scheduler (Supabase, every 10 minutes)

Vercel's free plan only allows once-a-day jobs, but attendance alerts depend on each schedule group's times. So Supabase calls `/api/cron/attendance-tick` every 10 minutes (set up by migration `20261010000100_attendance_tick_scheduler.sql`). It needs two secrets stored in Supabase Vault — do this once, yourself, in **Supabase → SQL Editor**:

```sql
select vault.create_secret('https://YOUR-APP.vercel.app', 'controlpad_app_url');
select vault.create_secret('PASTE-THE-SAME-VALUE-AS-CRON_SECRET', 'controlpad_cron_secret');
```

- No trailing slash on the URL. Use your production domain.
- `CRON_SECRET` must also be set in Vercel (the other daily crons use it too).
- To change a value later: `select vault.update_secret((select id from vault.secrets where name = 'controlpad_app_url'), 'https://new-url');`
- To check it's running: **Integrations → Cron** in Supabase (job `controlpad-attendance-tick`) shows each run; `select * from net._http_response order by created desc limit 5;` shows the app's replies.

## 6. Deploying a change that includes migrations

Apply database migrations **before** the new code goes live, or pages that read new columns will error:

```
supabase db push
```

then merge/push to `main` so Vercel deploys.

---

## Quick checklist

- [ ] GitHub account ready
- [ ] Supabase project created; URL + anon + service_role keys copied
- [ ] `.env.local` created and gitignored
- [ ] Vercel account connected to the repo (when deploying)
- [ ] `supabase db push` run for the latest migrations
- [ ] Vault secrets `controlpad_app_url` + `controlpad_cron_secret` created (§5)
- [ ] Twilio account + number + A2P 10DLC registration + SID/token (when ready to text)
- [ ] `SMS_MODE=test` + `SMS_TEST_NUMBER` tried before switching to live
- [ ] `CRON_SECRET` generated
- [ ] All variables added to Vercel project settings


