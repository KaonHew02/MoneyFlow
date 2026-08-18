# Running MoneyFlow day to day

## Starting it

Double-click **`MoneyFlow.cmd`** in the project folder. A black window opens,
the app opens in your browser, and you're in.

Or from a terminal in the project folder:

    npm start        # starts the server
    npm run open     # starts it and opens the browser too

Either way the app is at <http://localhost:4780>.

**Leave the black window open while you use the app.** It is the server; the
page in your browser talks to it. Closing that window closes the database —
your data is safe on disk, but the page stops working until you start it again.
Press `Ctrl+C` in the window to stop cleanly.

If it says the port is already in use, MoneyFlow is already running — just open
<http://localhost:4780> in your browser.

### Starting it automatically when Windows starts

Press `Win+R`, type `shell:startup`, press Enter. Drag a shortcut to
`MoneyFlow.cmd` into the folder that opens. From then on it is always running
and the browser tab always works.

## Where your data lives

    data/moneyflow.db          the entire book — every transaction, ever
    data/moneyflow.db-wal      writes not yet folded into the main file
    data/moneyflow.db-shm      shared-memory index for the above

All three belong together. `data/` is in `.gitignore`, so your financial
records are never committed to a repository by accident.

## Backing up

    npm run backup

Writes `data/backups/moneyflow-YYYY-MM-DD-HHMM.db` and keeps the most recent
30. Safe to run while the app is open — it uses SQLite's own `VACUUM INTO`,
which takes a consistent snapshot. **Do not** back up by copying
`moneyflow.db` by hand while the app is running: the newest entries live in
the `-wal` file and a hand copy can miss them.

Once in a while, copy the newest file out of `data/backups/` to somewhere that
is not this computer — a USB stick, Google Drive, anywhere. A backup sitting on
the same disk as the original does not survive that disk dying.

### Restoring

Stop the app. Delete `moneyflow.db`, `moneyflow.db-wal` and `moneyflow.db-shm`.
Copy the backup in and rename it to `moneyflow.db`. Start the app.

## Looking inside the database directly

You never need to, but when you want to:

**A GUI** — [DB Browser for SQLite](https://sqlitebrowser.org) is free. Open
`data/moneyflow.db` and browse the tables. Close it before using the app again;
two writers at once is the one thing SQLite does not like.

**The command line** — no install needed, since Node has SQLite built in:

    node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/moneyflow.db');console.table(d.prepare('SELECT * FROM v_account_balance').all())"

Some queries worth knowing:

    -- every account and its balance, in sen
    SELECT name, balance_sen / 100.0 AS balance FROM v_account_balance;

    -- what August 2026 cost, by category
    SELECT c.label, SUM(t.amount_sen) / 100.0 AS spent
      FROM txn t JOIN category c ON c.id = t.category_id
     WHERE t.type = 'expense' AND t.txn_date LIKE '2026-08-%'
     GROUP BY c.label ORDER BY spent DESC;

    -- how many records you have
    SELECT COUNT(*) FROM txn;

Remember every amount is stored in **sen**, so divide by 100 to read ringgit.

## Moving the app to another computer

Copy the whole folder. Install Node 24 or newer on the new machine. Run
`MoneyFlow.cmd`. That's the entire migration — the database travels inside
`data/`.
