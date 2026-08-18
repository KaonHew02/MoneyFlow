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
the API layer is rewritten rather than moved. You also need a login, because a
public site with no login is a public database.

## Recommendation

**Do not decide now.** Keep building on SQLite locally. Nothing is wasted
either way — the asset is the schema and the eight modules, and both survive
any of these choices.

What *does* matter is that the browser code never talks to the database
directly. Every module goes through one small client file that speaks to the
API. When you pick a destination, that one file changes and the modules do not
notice. That is how the choice stays cheap right up until you make it.

## If you want a public demo on github.io

There is a middle path worth knowing about: publish a **demo build** to Pages
that runs entirely in the browser on sample data, with no real records in it —
a shop window for the project. Your actual money stays in the local copy. This
costs one build script, not an architecture.
