# The local SQLite version (superseded)

This is the Node + SQLite build of MoneyFlow, kept intact after the app moved
to GitHub Pages + Supabase on 2026-08-18. Nothing here runs as part of the
live app.

It is kept for two reasons: your original database is in `data/`, and if
Supabase ever disappoints — the free tier pausing, or the login getting in the
way — this is a working fallback that needs no internet.

To run it:

    cd legacy-sqlite
    npm start          # then open http://localhost:4780

`npm run backup` still works too. Note that the browser files it serves
(`index.html`, `app.js`, `api.js`) now live one folder up and talk to
Supabase, so this server currently serves the *new* front end, which will not
match. Treat this folder as an archive of the server and the data, not as a
runnable app, unless you restore the matching front end from a backup.

The schema that matters was carried forward: `supabase/schema.sql` in the
parent folder is this same design translated to Postgres, with `user_id` and
row-level security added.
