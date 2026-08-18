/**
 * MoneyFlow — a tiny static web server for working on the app locally.
 *
 * Why this still exists now that nothing talks to a server: a page opened by
 * double-clicking has a `file://` address, and browsers treat that as a single
 * shared origin for every local file — so `localStorage` there is not really
 * yours, and some browsers refuse it outright in private windows. Served over
 * http:// the app gets its own origin, and behaves exactly as it will on
 * GitHub Pages.
 *
 * No dependencies and nothing to install — `node:http` is in the runtime. This
 * file is for local work only; it is not part of what gets published.
 *
 *     node serve.js            →  http://localhost:4780
 *     node serve.js --open     →  the same, and opens your browser
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4780;

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

/** Never serve the archived build or its data, whatever the URL asks for. */
const FORBIDDEN = ['legacy-sqlite', 'data', '.git'];

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const rel = url.pathname === '/' ? 'index.html'
        : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);

    // The resolved path is checked to still be inside the project, so a
    // crafted `../` cannot walk out and read the rest of your disk.
    const inside = file.startsWith(path.resolve(ROOT) + path.sep);
    const blocked = FORBIDDEN.some((dir) => rel === dir || rel.startsWith(dir + '/'));

    if (!inside || blocked) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('Not found: ' + rel);
            return;
        }
        res.writeHead(200, {
            'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'content-length': stat.size,
            // No caching, or an edit to app.js would not show up on refresh.
            'cache-control': 'no-store',
        });
        fs.createReadStream(file).pipe(res);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} is already in use — MoneyFlow is probably already running.`);
        console.error(`  Open http://localhost:${PORT}, or close the other window first.\n`);
        process.exit(1);
    }
    throw err;
});

server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n  MoneyFlow  →  ${url}`);
    console.log('\n  Leave this window open while you use the app. Ctrl+C to stop.\n');

    if (process.argv.includes('--open')) {
        const { spawn } = require('node:child_process');
        const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
                  : process.platform === 'darwin' ? ['open', [url]]
                  : ['xdg-open', [url]];
        spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
    }
});
