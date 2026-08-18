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
empty, which is correct — they fill up the first time the app loads.

> Running this file a second time is safe. Every statement is `if not exists`
> or `create or replace`, so it will not wipe anything you have recorded.

---

## Step 2 — Switch anonymous sign-ins on

MoneyFlow has no login screen and no accounts to create. It does still need a
*session*, because Step 1 put Row Level Security on every table and a request
with no session reaches nothing at all. So on first load the app quietly claims
an **anonymous account**: a real user row, seeded like any other, with no email
and no password in front of it.

Go to **Authentication** → **Sign In / Providers** and turn on **Allow
anonymous sign-ins**. Save.

That is the only switch this app needs. Email provider, confirmation, SMTP,
password rules — none of it applies any more. Leave email logins off.

### What you are trading away, in plain words

The session lives in **this browser's storage**, and that is the whole catch:

- Clearing site data, "forget about this site", or a fresh browser profile
  gives you a **new anonymous account and an empty book**. Your old rows are
  still sitting in the database — nothing can reach them any more.
- Your phone and your laptop are **two separate books**, not one. Nothing
  syncs between them.
- There is no password reset, because there is no password.

So take the backups in *Living with it* seriously. Losing the session is the
one realistic way to lose your records.

### Strangers, and what they can and cannot do

Anyone who opens the site gets their own anonymous account and their own seeded
starter rows. That costs nothing and they still cannot see a single row of
yours — RLS compares every row against the session asking for it, and theirs is
a different session. Expect the odd extra row under **Authentication** →
**Users** if you share the URL; delete them whenever you like.

**Authentication** → **Rate Limits** caps how many anonymous sign-ins one IP
address can make per hour. The default is far above anything one person does,
and it is the lever if the address ever gets hammered.

---

## Step 3 — Copy your anon key

1. **Project Settings** (the gear) → **API Keys**.
2. Find the key labelled **`anon` / `public`**. Copy it.

> Two warnings that matter.
>
> The `anon` key is **meant to be public** — it goes in your JavaScript and
> anyone can read it. It grants nothing on its own, because Step 1 put Row
> Level Security on every table: a request can only ever reach rows belonging
> to the session doing the asking.
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
Supabase refuses to talk to it. The app would load with a red strip across the
top and save nothing.

`MoneyFlow.cmd` runs `serve.js`, a small static web server that comes with the
project. It needs no install and works offline, and it serves your files
exactly the way GitHub Pages will. Leave the black window open while you use
the app; `Ctrl+C` stops it.

> If you prefer a terminal: `node serve.js --open` does the same thing.
> `npx serve .` also works but downloads a package every time.

MoneyFlow opens straight into **Expenses**. There is nothing to sign into.

Behind that first load, the database seeded your session with the starter
accounts (Cash, Bank, Touch 'n Go, Credit card), the nine spending categories,
the income categories, sub-categories and payment methods. Check **Table
Editor** → `account` in Supabase — four rows, all carrying the same `user_id`.

If anything is wrong, a red strip across the top of the app says what, in plain
words, rather than failing silently.

---

## Step 6 — Bring your old records across

Only if you have been using the old version in this browser, and only after
Step 5 has loaded cleanly.

Open the browser console (`F12` → **Console**) on the running app and run:

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

## Step 8 — Open it on the new address

Visit your Pages URL. The app loads, claims an anonymous session for that
browser, seeds it, and you are in.

**It will be an empty book.** The session you made in Step 5 belongs to
`localhost:4780`; this is a different address, so it is a different session.
That is worth knowing *before* you have a month of records on one of them —
pick the address you intend to keep and use that one from the start.

> Nothing needs setting under **Authentication** → **URL Configuration**. Site
> URL and redirect URLs exist for the links in confirmation and password-reset
> emails, and this app sends neither.

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

**Backups, and here they matter more.** Supabase keeps its own, but they are
not yours, and with no password there is no way back into a session you have
lost. Once a month: **Table Editor** → a table → **Export** → **CSV**. The one
that matters is `txn`; everything else can be rebuilt from the schema.

**Your data is per-browser.** Everything is scoped to the anonymous session
this browser holds. A different browser, a different device, or cleared site
data means a separate, empty book — it cannot see this one, and this one cannot
see it. Use one browser on one address and keep it that way.

---

## When something breaks

**"MoneyFlow is not connected to a database yet"** — `config.js` still has the
placeholder in it, or the file is not being loaded. Check Step 4.

**"Anonymous sign-ins are switched off for this project"** — the toggle in
Step 2 is off. Turn it on and reload.

**Everything is empty and it used to have records** — this browser is on a new
session. Clearing site data does it, so does a different browser or device, and
so does switching between `localhost` and the Pages URL. The old rows are still
in **Table Editor** under their own `user_id`; reaching them again means
copying them onto the `user_id` the app is using now, in the SQL editor.

**Nothing loads at all** — the project is probably paused. Open the Supabase
dashboard and restore it.

**The tables are empty on a brand new session** — the seed trigger did not
fire. Rerun `supabase/schema.sql` (Step 1), then clear the site data and reload
to test with a fresh session.

**Everything worked locally but not on Pages** — check the browser console. A
404 on `config.js` means it was not committed; a CORS or redirect complaint
means Step 8 is incomplete.
