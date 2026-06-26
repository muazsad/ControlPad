# ControlPad — Setup Guide

The accounts and keys **you** need to create. Claude Code can't make accounts or handle your secrets, so this is the part that's on you — it's mostly copy-and-paste. Exact button labels on these third-party sites change occasionally; the official docs (linked) are the final word.

> **Order:** do GitHub + Supabase before Phase 1. Twilio is only needed at Phase 3 (grades/SMS). Vercel can be connected at Phase 1 or whenever you first want a live URL.

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

## 3. Twilio (SMS) — needed at Phase 3

1. Create an account at <https://www.twilio.com>.
2. Buy a phone number capable of SMS (Phone Numbers → Buy a number). Cost is roughly ~$1–2/month plus well under a cent per text — check current pricing.
3. From the Console dashboard, copy:
   - **Account SID**
   - **Auth Token**  ← secret
   - your **Twilio phone number** (E.164, e.g. `+1413...`)
4. Note: trial accounts can only text *verified* numbers until you upgrade. Plan to add a little credit before going live.
5. Docs: <https://www.twilio.com/docs>

---

## Environment variables

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

`STRIPE_*` variables come later, only if/when you add online payments.

> **Rule of thumb:** anything starting with `NEXT_PUBLIC_` is visible in the browser. Never give a secret that prefix. The `service_role` key and Twilio token must stay server-side only.

---

## Quick checklist

- [ ] GitHub account ready
- [ ] Supabase project created; URL + anon + service_role keys copied
- [ ] `.env.local` created and gitignored
- [ ] Vercel account connected to the repo (when deploying)
- [ ] Twilio account + number + SID/token (by Phase 3)
- [ ] `CRON_SECRET` generated
- [ ] All variables added to Vercel project settings

When these are done, you're ready to hand the matching phase prompt from `docs/BUILD_PROMPTS.md` to Claude Code.
