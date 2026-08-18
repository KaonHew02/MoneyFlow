/**
 * MoneyFlow — the local server.
 *
 * Serves the app's own files and the JSON API from one origin, so the page
 * keeps working exactly as it did when it was opened straight off disk. There
 * is no framework and no dependency: `node:http` and `node:sqlite` are both in
 * the runtime.
 *
 *     npm start          →  http://localhost:4780
 *
 * It binds to 127.0.0.1 on purpose. This is your money; it does not need to be
 * reachable from the rest of the network.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./db');
const { HttpError, json, router } = require('./http');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4780;
const HOST = process.env.HOST || '127.0.0.1';

const routes = [
    ...require('./api/core').routes,
    ...require('./api/txn').routes,
    ...require('./api/import').routes,
];

const dispatch = router(routes);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.woff2': 'font/woff2',
};

/**
 * Static files. The resolved path is checked to still be inside the app
 * folder, so a crafted `../` cannot read the database file or anything else
 * off the disk.
 */
function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);

    if (!file.startsWith(path.resolve(ROOT) + path.sep) || rel.startsWith('data')) {
        json(res, 403, { error: 'Forbidden' });
        return;
    }

    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            json(res, 404, { error: 'Not found' });
            return;
        }
        res.writeHead(200, {
            'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'content-length': stat.size,
            'cache-control': 'no-cache',
        });
        fs.createReadStream(file).pipe(res);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);

    try {
        if (url.pathname.startsWith('/api/')) {
            const handled = await dispatch(req, res, url);
            if (!handled) json(res, 404, { error: 'No such endpoint: ' + url.pathname });
            return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            json(res, 405, { error: 'Method not allowed' });
            return;
        }
        serveStatic(req, res, url.pathname);
    } catch (err) {
        if (err instanceof HttpError) {
            json(res, err.status, { error: err.message });
            return;
        }
        // A constraint the schema refused is the user's mistake, not a crash.
        const constraint = /constraint|CHECK|UNIQUE|FOREIGN KEY/i.test(err.message || '');
        console.error(err);
        json(res, constraint ? 400 : 500, { error: err.message || 'Server error' });
    }
});

/** `npm run open` / the desktop shortcut: bring the browser up once we know
 *  the port is actually listening, so it never lands on a refused connection. */
function openBrowser(url) {
    const { spawn } = require('node:child_process');
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
              : process.platform === 'darwin' ? ['open', [url]]
              : ['xdg-open', [url]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
}

db.open();
server.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n  MoneyFlow  →  ${url}`);
    console.log(`  database   →  ${db.DB_FILE}`);
    console.log('\n  Leave this window open while you use the app. Ctrl+C to stop.\n');
    if (process.argv.includes('--open')) openBrowser(url);
});

/** A port left behind by a previous run is the one error worth explaining. */
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} is already in use — MoneyFlow is probably already running.`);
        console.error(`  Open http://localhost:${PORT}, or close the other window first.\n`);
        process.exit(1);
    }
    throw err;
});
