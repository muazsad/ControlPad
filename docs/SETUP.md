# ControlPad — Setup Guide

The accounts and keys **you** need to create. Claude Code can't make accounts or handle your secrets, so this is the part that's on you — it's mostly copy-and-paste. Exact button labels on these third-party sites change occasionally; the official docs (linked) are the final word.

> Twilio is optional until a school wants texts to actually go out — until then every alert is logged on that school's Messages page. Each school sets up its own Twilio (§3).

---

## 0. Prerequisites

- A **GitHub** account (your code repo lives here; Vercel deploys from it).
- **Node.js** installed (Claude Code will tell you the version it wants).
- Official docs: GitHub <https://docs.github.com> · Node <https://nodejs.org>

## 1. Supabase (database + auth)

1. Create an account and a new **project** at <https://supabase.com>. Pick a strong database password and save it.
2. Choose a US region (e.g. US East).
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

## 3. Twilio (SMS) — each school brings its own

Every school texts from **its own** Twilio account and number. Nothing goes in Vercel for this: a school's admin enters the details in **Settings → Texting**, and ControlPad stores the Auth Token encrypted (with `SMS_CREDENTIALS_KEY`, §4). Until a school does this, its alerts are only logged on its **Messages** page as dry runs.

**For each school (its admin does this):**

1. Create an account at <https://www.twilio.com> and upgrade from trial (trial accounts can only text numbers you've verified).
2. Buy an SMS-capable number (Phone Numbers → Buy a number). Rough cost: ~$1–2/month plus well under a cent per text — check current pricing.
3. **Register for A2P 10DLC** (Messaging → Regulatory Compliance) — the school is the "brand", the use case ("campaign") is attendance and account notifications to parents who gave their number. US carriers block unregistered automated texts. Approval takes days to a couple of weeks and has small fees. A toll-free number with toll-free verification is the alternative. Docs: <https://www.twilio.com/docs/messaging/compliance/a2p-10dlc>
4. In ControlPad, **Settings → Texting**: paste the **Account SID**, **Auth Token**, the number, and a test number (your cell). **Save & verify** checks the details with Twilio and that the number belongs to that account.
5. **Incoming texts:** in Twilio → Phone Numbers → the number → *Messaging configuration*, set **"A message comes in"** to Webhook, `https://control-pad.vercel.app/api/sms/inbound` (the Texting card shows the exact URL), HTTP **POST**. ControlPad finds the school by the number texted and checks Twilio's signature with that school's token. (Only if the public URL ever differs from what the app sees, set `TWILIO_INBOUND_URL` in Vercel to the exact URL entered in Twilio.)
6. Choose **Test** on the Texting card and press **Send me a test text** on **Messages**. In test mode every alert goes to the test number, labelled with who it was meant for.
7. Choose **Live**. Texts keep going to the test number until a **platform admin approves** the school on `/platform` (§7) — do that once the A2P registration is approved.

**Emergency stop for every school:** set `SMS_MODE=off` in Vercel and redeploy (`SMS_MODE=test` holds every school at test). Unset, each school's own mode applies.

---

## 4. Environment variables

Put these in a local `.env.local` (must be gitignored) **and** in Vercel's project settings. Claude Code will reference exactly these names.

| Variable | Where from | Public? |
|----------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → API → Project URL | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → anon public | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → service_role | **NO — secret** |
| `SMS_CREDENTIALS_KEY` | you generate it: `openssl rand -base64 32` (32 random bytes, base64). Encrypts every school's Twilio token. Losing it means each school re-enters its token; leaking it with a database dump exposes their Twilio accounts. Never change it casually. | **NO — secret** |
| `CRON_SECRET` | you invent a long random string | **NO — secret** |
| `SMS_MODE` | optional ceiling for every school: `off` or `test`. Unset = each school's own setting. | no |
| `TWILIO_INBOUND_URL` | optional — only if Twilio's webhook URL differs from the app's own URL | no |

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` and `SMS_TEST_NUMBER` are **no longer used** (each school's Twilio lives in Settings → Texting). Delete them from Vercel after the multi-school release.

> **Rule of thumb:** anything starting with `NEXT_PUBLIC_` is visible in the browser. Never give a secret that prefix. The `service_role` key and `SMS_CREDENTIALS_KEY` must stay server-side only.

---

## 5. Attendance scheduler (Supabase, every 10 minutes)

Vercel's free plan only allows once-a-day jobs, but attendance alerts depend on each schedule group's times. So Supabase calls `/api/cron/attendance-tick` every 10 minutes, around the clock (migration `20261010000100_attendance_tick_scheduler.sql`, made 24-hour by `20261103000300_tick_all_day.sql`); each call runs every school on its own local time. It needs two secrets stored in Supabase Vault — do this once, yourself, in **Supabase → SQL Editor**:

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

## 7. Platform admins (who approves live texting)

Anyone can sign up and create a school. Live texting stays off until a **platform admin** approves it on `/platform`. Add yourself once, after you've signed in at least once, in **Supabase → SQL Editor** (this is data, not a schema change):

```sql
insert into platform_admins (user_id)
select id from auth.users where email = 'you@example.com';
```

`/platform` lists every school (counts only — no student or message data) with **Approve live** / **Revoke**.

## 8. Sign-up emails

`/signup` sends a confirmation email. Supabase's built-in mailer only sends a few emails an hour, so before announcing sign-up, set **Authentication → Emails → SMTP Settings** to a real provider (e.g. Resend, Postmark). Also add your site URL and `https://YOUR-APP/auth/callback` under **Authentication → URL Configuration → Redirect URLs**. Docs: <https://supabase.com/docs/guides/auth/auth-smtp>

## 9. Testing migrations safely (multi-school release)

The multi-school migrations (`20261103*`) rewrite every security rule. Try them on a copy first:

1. Docker running, then in the repo: `supabase start` and `supabase test db` — runs `supabase/tests/tenant_isolation.test.sql` (two schools; checks neither can see or write the other's data).
2. Make a scratch Supabase project, restore a recent backup of production into it (Database → Backups, or `supabase db dump` / `psql`), point a Vercel preview at it, then `supabase db push` there.
3. On the preview: sign up, create a school, add a student — and check the old data is invisible.
4. Then `supabase db push` to production and deploy straight away (existing logins see "Set up your school" until the new code is live).

Existing data moves into a hidden **"Pre-multi-tenant archive"** school that nobody can see. Recreate your school by signing in with your existing account and going through onboarding.

Old staff and parent logins stay parked in the archive, so their emails can't be added to the new school yet. Once your own school exists and you're sure the old data isn't needed:

```
node --env-file=.env.local scripts/delete-archive-school.mjs --with-logins
```

It prints counts, asks you to type `DELETE`, deletes the archive school, then deletes the parked logins (never platform admins), so you can re-add those people from Staff and Guardians. Leave off `--with-logins` to keep the logins.

---

## Quick checklist

- [ ] GitHub account ready
- [ ] Supabase project created; URL + anon + service_role keys copied
- [ ] `.env.local` created and gitignored
- [ ] Vercel account connected to the repo (when deploying)
- [ ] `SMS_CREDENTIALS_KEY` generated and added to Vercel + `.env.local`
- [ ] `supabase db push` run for the latest migrations (after testing on a copy, §9)
- [ ] Vault secrets `controlpad_app_url` + `controlpad_cron_secret` created (§5)
- [ ] Custom SMTP + redirect URLs set in Supabase Auth (§8)
- [ ] Yourself added to `platform_admins` (§7)
- [ ] `CRON_SECRET` generated
- [ ] All variables added to Vercel project settings
- [ ] Per school: Twilio number + A2P registration, details entered in Settings → Texting, tested, approved on `/platform`
