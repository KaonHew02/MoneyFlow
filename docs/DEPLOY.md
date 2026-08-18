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

## The options that were on the table

### Option A — Keep it local (where this started)

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
the API layer is rewritten rather than moved. You also need a login, because a
public site with no login is a public database.

## What was chosen — Option D, on 2026-08-18

**GitHub Pages for the screens, and this browser's `localStorage` for the
data.** No database, no accounts, no server, no keys. The site is live at
https://kaonhew02.github.io/MoneyFlow/ and the whole app is `index.html`,
`style.css` and `app.js`.

That was not the plan at the start of the day. The route was Option C, and it
got built: a Postgres schema with fourteen tables and row-level security, an
`api.js` client, and an email-and-password gate. Then the gate came out (a
login felt like a lock on a door only its owner knocks at), went back in (a
device-bound session cannot follow you to your phone) — and the whole database
came out behind it.

The reasoning that settled it: **`app.js` had never been wired to `api.js`.**
Every module still read and wrote `localStorage`, so Supabase was holding
nothing. The choice was not "move the data" but "do the migration at all", and
it stopped being worth doing for one person's ledger on one machine.

What that costs, stated plainly, because it is the whole trade:

- **The records live in one browser, on one address.** `localhost:4780` and the
  Pages URL are separate stores. Your phone is a third.
- **Clearing browsing data deletes everything** unless a copy is elsewhere —
  which is what Export and the Drive buttons are for. See [DRIVE.md](DRIVE.md).
- **`localStorage` caps at about 5 MB** — thousands of entries, not millions.
- Nothing syncs, nothing backs up, and nobody can recover it for you.

**Export and Import in the topbar are what make this survivable.** Export
writes every store into one `moneyflow-YYYY-MM-DD.json`; Import reads it back,
on this machine or another one. That file is the backup, the way onto a new
laptop, and the way out of MoneyFlow entirely if you ever want your figures
elsewhere. Import replaces rather than merges — merging two ledgers means
guessing which entries are the same, and guessing wrong doubles a balance
quietly — so it states what is in the file and what is about to go, and waits.

The Supabase build is archived intact in `legacy-supabase/` — schema, client,
gate and setup guide — and the old Node/SQLite build in `legacy-sqlite/`. Both
are out of the running app; neither is deleted. If MoneyFlow ever needs to
follow you between devices, Option C is written and waiting rather than
imagined.

## What this route costs you

**Your data has exactly one copy, and you are holding it.** No server means no
backup, no sync, and nobody to ask. Export regularly, or accept that a cleared
browser is a cleared ledger.

**A public repo is still public.** Nothing sensitive ships in the app now —
there are no keys left to leak — but `legacy-sqlite/data/` holds your real
figures and is in `.gitignore`. Leave it there.

**If you ever want it on your phone**, that is Option C again, and the pieces
are in `legacy-supabase/`. The one piece that was never written is the part
that connects the modules to `api.js`.
