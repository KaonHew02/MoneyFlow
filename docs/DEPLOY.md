# Going live

## Why GitHub Pages alone cannot host this

GitHub Pages is a **static file host**. It serves HTML, CSS, JavaScript and
images exactly as committed. It does not run Node, PHP, Python or anything
else, and it has no writable disk.

Two things follow, and both are fatal for a finance app:

1. **Nothing can be saved.** There is no server to receive a new transaction
   and no disk to write it to. Every visit starts from whatever is in the
   repository.
2. **A committed database is a published database.** If you commit
   `moneyflow.db` to a public repo to get data onto the site, your account
   balances, salary, and every transaction become readable by anyone who finds
   the URL. `data/` is in `.gitignore` for this reason — leave it there.

This is not a limitation of how the app is written. Any application that saves
data needs somewhere that runs code and can write. Pages is neither.

## The three real options

### Option A — Keep it local (what you have now)

Runs on your PC. Free, completely private, already working, no accounts to
create. Your data never leaves the machine.

Loses: access from your phone, and access from anywhere but that one computer.

### Option B — Put the whole app on a host that runs Node

Render, Railway, Fly.io and similar run exactly what you have. The server code
does not change; only the port comes from the environment, which it already
does.

Gains: one URL, works on the phone, custom domain, everything stays in one
piece.

Costs: roughly **US$5–7/month**, and here is the catch to watch — free tiers on
these hosts use *ephemeral* disks that are wiped on every restart, which would
delete `moneyflow.db`. A persistent volume is the paid part. Do not run this on
a free tier without one.

This is the least work by a wide margin: the schema, the API and all eight
modules move across untouched.

### Option C — GitHub Pages for the screens + Supabase for the data

Supabase is hosted Postgres with a login system and row-level security, built
for exactly this shape: a static site talking straight to a database, with each
user seeing only their own rows.

Gains: genuinely free at this size, keeps the `github.io` address you want,
works from any device, and someone else handles the backups.

Costs: real rework. The schema ports to Postgres nearly verbatim — the table
design carries over — but every `db.all(...)` call becomes a Supabase call, so
the API layer is rewritten rather than moved. You also need a session on every
request, because a public site whose rows belong to nobody is a public
database.

## What was chosen — Option C, on 2026-08-18

Pages + Supabase as the only database. Step-by-step setup is in
[LAUNCH.md](LAUNCH.md).

Sign-in started as email and password and was taken back out on the same day:
for an app one person uses, a login screen was a lock on a door only its owner
knocks at. What replaced it is an **anonymous session** — Supabase issues the
browser a real user row with no email and no password, and every policy below
keeps working untouched, because they compare rows against a session, and never
cared how that session was obtained.

The swap cost exactly what it was supposed to: `api.js` was rewritten and the
modules were not touched. That is the whole return on having built a client
layer in the first place.

What changed:

| | Before | After |
|---|---|---|
| Database | SQLite file on your PC | Postgres at Supabase |
| Schema | `server/schema.sql` | `supabase/schema.sql` — same design, plus `user_id` and row-level security |
| API | `server/api/*.js` over `node:http` | gone; the browser queries Supabase directly |
| Security | nothing could reach it but you | an anonymous session, and a policy on every table |
| Running it | `MoneyFlow.cmd` | any static web server, or the live Pages URL |

The old build is kept in `legacy-sqlite/`, database and all, as a working
fallback that needs no internet. It is not part of the live app.

## What this route costs you

**The session is not optional, even without a login.** A static site has no
secrets — the Supabase key is in the JavaScript and anyone can read it. It
grants nothing on its own, because every table carries `user_id` and a policy
restricting rows to the session asking for them. That policy *is* the security,
which is why the gate could go and the policies could not. Which is also why
`supabase/schema.sql`
enables row-level security on all fourteen tables and why the balance view is
declared `security_invoker` — a view without it would run with its owner's
rights and hand every user everyone's balances.

**The session is the only key, and it lives in one browser.** No password means
no password reset. Cleared site data, a different device, or a different
address is a different book. Export `txn` to CSV now and then.

**The free tier pauses after 7 days of no activity.** The app will fail to load
until you restore it from the dashboard. If you use MoneyFlow most weeks you
will not notice; if you go quiet for a month, expect one extra click.

**Never commit `legacy-sqlite/data/`.** A Pages repo is public. That folder has
your real figures in it and is in `.gitignore` — leave it there.
