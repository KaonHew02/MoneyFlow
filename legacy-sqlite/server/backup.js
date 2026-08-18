/**
 * Backup — `npm run backup`.
 *
 * Uses SQLite's own VACUUM INTO rather than copying the file. That matters:
 * in WAL mode the newest writes live in `moneyflow.db-wal`, so a plain file
 * copy of `moneyflow.db` can miss the entries you made today, or catch the
 * database mid-write. VACUUM INTO produces a consistent, compacted copy and is
 * safe to run while the app is open.
 *
 * Backups land in `data/backups/moneyflow-YYYY-MM-DD-HHMM.db`. The last 30 are
 * kept; older ones are removed, because an unbounded backup folder is how a
 * disk quietly fills up.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = require('./db');

const KEEP = 30;
const BACKUP_DIR = path.join(path.dirname(db.DB_FILE), 'backups');

/** 2026-08-18-0930 — sorts chronologically as a filename. */
function timestamp(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
           `-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function backup() {
    if (!fs.existsSync(db.DB_FILE)) {
        console.error(`No database yet at ${db.DB_FILE} — run "npm start" and record something first.`);
        process.exit(1);
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, `moneyflow-${timestamp()}.db`);

    if (fs.existsSync(target)) fs.unlinkSync(target);   // same minute, run twice

    const source = new DatabaseSync(db.DB_FILE);
    source.prepare('VACUUM INTO ?').run(target);

    const entries = source.prepare('SELECT COUNT(*) AS n FROM txn').get().n;
    source.close();

    const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(2);
    console.log(`Backed up ${entries.toLocaleString()} transactions → ${target}  (${mb} MB)`);

    prune();
}

function prune() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('moneyflow-') && f.endsWith('.db'))
        .sort();

    const stale = files.slice(0, Math.max(0, files.length - KEEP));
    stale.forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    if (stale.length) console.log(`Removed ${stale.length} backup(s) older than the last ${KEEP}.`);
}

backup();
