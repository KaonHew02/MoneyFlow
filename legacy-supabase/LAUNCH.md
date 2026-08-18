# Launching MoneyFlow on GitHub Pages + Supabase

Your project: **`https://uqzpufrxrxutpiucvcro.supabase.co`**

Work through these in order. Steps 1–5 get it running on your own machine;
steps 6–8 put it on the web. Budget about 30 minutes the first time.

---

## Step 1 — Create the tables

1. Open your Supabase project and click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase/schema.sql` from this project, copy **the whole file**, and
   paste it in.
4. Click **Run**.

You should see *Success. No rows returned*. That is what success looks like —
the script creates things, it does not select anything.

To check it worked, click **Table Editor** in the sidebar. You should see
`account`, `category`, `txn`, `bill`, `budget` and the rest. They are all
empty, which is correct — the tables fill up when you first sign in.

> Running this file a second time is safe. Every statement is `if not exists`
> or `create or replace`, so it will not wipe anything you have recorded.

---

## Step 2 — Switch email logins on

Go to **Authentication** → **Sign In / Providers** → **Email**.

**Two separate toggles, and they are easy to mix up:**

1. **Enable email provider** → **ON**. This decides whether email and password
   work at all. If it is off, signing in fails with *"Email logins are
   disabled"* no matter what else is configured.

2. **Confirm email** → **ON**. A new account must click a link in an email
   before it can sign in.

Save. **Minimum password length** of 6 matches what the sign-in screen checks
before it sends anything.

> **If you ran the gate-less build**, turn **Allow anonymous sign-ins** back
> **OFF** on this same page, or every visitor keeps minting an invisible
> account. The ones already made are in **Authentication** → **Users** with no
> email against them; deleting a row there deletes its seeded book with it, so
> check it holds nothing you want before you clear them out.

### Why confirmation is on

MoneyFlow is open to other people signing up, so it earns its keep:

- **Password reset only works if the address is real.** Someone who registers
  with a typo is locked out permanently, with no way back and no way for you to
  help them.
- **It stops bots and junk accounts.** A public sign-up form gets found.
- **It stops anyone registering with an address that is not theirs.**

What it does *not* do is protect anyone's data. That is Row Level Security,
which is already on every table — a confirmed stranger still only ever sees
their own book. Confirmation decides who gets an account; RLS decides what an
account can reach.

If you ever want MoneyFlow private again, the lever is **Allow new users to
sign up** → OFF, on the same page. Existing accounts keep working; no new ones
can be made. With the site already public at a findable address, this is worth
doing the moment your own account exists.

### The email limit you will hit

Supabase's built-in email service is for testing, not for real users. On the
free tier it sends only a **handful of messages per hour across the whole
project**. Past that, confirmation emails are silently dropped: the account is
created, the person never receives the link, and they cannot sign in. Nothing
in the dashboard shouts about it.

Fine while it is you and a few others. Before anyone real depends on it, set up
your own sending service:

**Authentication** (the main left sidebar, *not* the project Settings page)
→ **Emails** → the **SMTP Settings** tab. Enabling it raises the limit to
**30 emails an hour**.

> **Do not turn that toggle on until you have the credentials to hand.** Custom
> SMTP enabled with empty fields sends nothing at all — worse than the built-in
> service. Set it up in one sitting, or leave it off.

Which provider depends on whether you own a domain:

| | Resend | Brevo |
|---|---|---|
| Free tier | 3,000/month | 300/day |
| **Needs your own domain?** | **Yes** — without one it will only send to your own address | **No** — verify one email address and go |
| Host | `smtp.resend.com` | `smtp-relay.brevo.com` |
| Port | 465 | 587 |
| Username | `resend` | your Brevo login email |
| Password | the API key you create there | the SMTP key you create there |

**No domain of your own → use Brevo.** Resend's free tier would let you email
confirmation links to yourself and nobody else, which defeats the point of
opening sign-ups.

The **Sender email address** must match the domain or address you verified with
the provider. A mismatch is silently rejected as spam.

The send limit itself is on the same **Authentication** menu under **Rate
Limits**.

> Supabase moves things around between redesigns. If a path here does not
> match what you see, go by the **names** — anything about logins, users,
> emails or URLs is under **Authentication**; the anon key and the project URL
> are under **Project Settings → API Keys**.

> **Step 8 matters more with confirmation on.** The link in the email sends
> people to your **Site URL**. If that is not set, they land nowhere and the
> account stays unconfirmed. Do not skip it.

---

## Step 3 — Copy your anon key

1. **Project Settings** (the gear) → **API Keys**.
2. Find the key labelled **`anon` / `public`**. Copy it.

> Two warnings that matter.
>
> The `anon` key is **meant to be public** — it goes in your JavaScript and
> anyone can read it. It grants nothing on its own, because Step 1 put Row
> Level Security on every table: a request can only ever reach rows belonging
> to whoever is signed in.
>
> The key labelled **`service_role`** is the opposite. It bypasses every
> policy. **Never** put it in this project, and never paste it anywhere public.
> If you ever do, rotate it in Supabase immediately.

---

## Step 4 — Paste it into config.js

Open `config.js` in the project folder. Your project URL is already filled in.
Replace `YOUR-ANON-KEY`:

```js
const MF_CONFIG = {
    url: 'https://uqzpufrxrxutpiucvcro.supabase.co',
    anonKey: 'eyJhbGciOi...',      // the long anon key you just copied
};
```

Save.

---

## Step 5 — Try it on your own machine first

**Double-click `MoneyFlow.cmd`.** A black window opens and your browser goes to
`http://localhost:4780`.

That is the only way to run it locally. Do **not** double-click `index.html` —
a page opened that way has a `file://` address, which is not a web address, and
Supabase refuses to talk to it. The app would sit at the sign-in screen failing
for a reason that looks like nothing at all.

`MoneyFlow.cmd` runs `serve.js`, a small static web server that comes with the
project. It needs no install and works offline, and it serves your files
exactly the way GitHub Pages will. Leave the black window open while you use
the app; `Ctrl+C` stops it.

> If you prefer a terminal: `node serve.js --open` does the same thing.
> `npx serve .` also works but downloads a package every time.

You should see the jade sign-in screen.

1. Click **No account yet? Create one**.
2. Enter your email and a password of at least 6 characters.
3. Click **Create account**.

The moment your account is created, the database seeds it with your starter
accounts (Cash, Bank, Touch 'n Go, Credit card), the nine spending categories,
the income categories, sub-categories and payment methods. Check **Table
Editor** → `account` in Supabase — four rows, all carrying your `user_id`.

If something goes wrong, the sign-in screen says what in plain words rather
than failing silently.

---

## Step 6 — Bring your old records across

Only if you have been using the old version in this browser, and only after you
can sign in.

Open the browser console (`F12` → **Console**) on the signed-in app and run:

```js
await MF.migration.check()
```

It reports how many entries are sitting in this browser and whether they have
been imported yet. If `hasLocal` is true and `alreadyImported` is false:

```js
await MF.migration.run()
```

It returns a report — accounts, entries, and anything it refused, with the
reason. Entries pointing at an account that no longer exists, or transfers that
lost their far side, are skipped rather than stored, because one bad row would
throw off every balance.

It will not run twice. A second pass would double every balance.

Once you have checked the figures look right, and only then:

```js
MF.migration.clearLocal()
```

Until you run that, the old copy stays in this browser as your fallback.

---

## Step 7 — Put it on GitHub Pages

In the project folder:

```bash
git init
git add .
git commit -m "MoneyFlow on Supabase"
```

Check what you are about to publish — `git status` should **not** list
anything under `legacy-sqlite/data/`. That is your old SQLite database with
real figures in it, and `.gitignore` keeps it out. If you see it, stop and fix
that before pushing.

Then create an empty repository on GitHub (no README, no .gitignore) and:

```bash
git remote add origin https://github.com/YOUR-NAME/moneyflow.git
git branch -M main
git push -u origin main
```

Now switch Pages on:

1. On GitHub, open the repo → **Settings** → **Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Branch **main**, folder **/ (root)**. Save.

Wait a minute or two. Your site appears at

    https://YOUR-NAME.github.io/moneyflow/

---

## Step 8 — Tell Supabase about the new address

Password reset and confirmation links need to know where to send people back
to. Your site is already live, so these are your real values:

1. **Authentication** → **URL Configuration**.
2. **Site URL**: `https://kaonhew02.github.io/MoneyFlow/`
3. **Redirect URLs**: add both
   `https://kaonhew02.github.io/MoneyFlow/**` and `http://localhost:4780/**`
4. Save.

Open your Pages URL, sign in with the account you made in Step 5, and your data
is there — same database, different screen. This is the part a login buys you
that a device-bound session cannot.

---

## Living with it

**Updating the site.** Edit the files, then:

```bash
git add . && git commit -m "what changed" && git push
```

Pages redeploys in a minute or so. If you do not see the change, hard-refresh
with `Ctrl+Shift+R` — browsers cache aggressively.

**The 7-day pause.** Free Supabase projects pause after a week with no
activity, and the app will fail to load until you wake it up from the
dashboard. If you use MoneyFlow most weeks you will never notice. If you go
quiet for a month, expect to click **Restore** once.

**Backups.** Supabase keeps its own, but they are not yours. Once in a while:
**Table Editor** → a table → **Export** → **CSV**. The one that matters is
`txn`; everything else can be rebuilt from the schema.

**Your data is per-login.** Everything is scoped to the account you signed up
with. Signing up with a second email gives you a completely separate, empty
book — useful for testing, and it cannot see the first one.

---

## When something breaks

**"MoneyFlow is not connected to a database yet"** — `config.js` still has the
placeholder in it, or the file is not being loaded. Check Step 4.

**"Email logins are disabled"** — **Enable email provider** is off in
Supabase. Step 2, first toggle.

**Signed up but the confirmation email never arrived** — check
**Authentication** → **Users**: if the account is there marked *Waiting for
verification*, the account was created and only the email failed. Usually the
free tier's hourly send limit (Step 2). Wait an hour, or set up SMTP. To let
someone in meanwhile, delete the user, turn **Confirm email** off, have them
sign up again, then turn it back on.

**The confirmation link goes somewhere broken** — **Site URL** is wrong or
unset. Step 8.

**"That email and password do not match"** — no account with that email, or a
wrong password. Use **Forgot password**, which needs Step 8 done first.

**Signed in but nothing loads** — the project is probably paused. Open the
Supabase dashboard and restore it.

**The tables are empty after signing up** — the seed trigger did not fire. Rerun
`supabase/schema.sql` (Step 1), then sign up with a fresh email to test.

**Everything worked locally but not on Pages** — check the browser console. A
404 on `config.js` means it was not committed; a CORS or redirect complaint
means Step 8 is incomplete.
