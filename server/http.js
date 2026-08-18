/**
 * Tiny HTTP helpers — a router and JSON plumbing, so the API modules stay
 * about money and not about streams. No framework: `node:http` is enough for
 * a single-user app, and it keeps the install at zero dependencies.
 */

const MAX_BODY = 4 * 1024 * 1024;   // an import of years of records, not more

/** Thrown by handlers to answer with a status other than 500. */
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const bad      = (msg) => { throw new HttpError(400, msg); };
const notFound = (msg) => { throw new HttpError(404, msg); };

function json(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(text);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new HttpError(413, 'Body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) return resolve({});
            try { resolve(JSON.parse(raw)); }
            catch (err) { reject(new HttpError(400, 'Body is not valid JSON')); }
        });
        req.on('error', reject);
    });
}

/**
 * Routes are declared as `['GET', '/api/accounts/:id', handler]`. The path is
 * matched segment by segment; `:name` segments land in `ctx.params`.
 */
function compile(pattern) {
    const parts = pattern.split('/').filter(Boolean);
    return (pathname) => {
        const segs = pathname.split('/').filter(Boolean);
        if (segs.length !== parts.length) return null;
        const params = {};
        for (let i = 0; i < parts.length; i += 1) {
            if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
            else if (parts[i] !== segs[i]) return null;
        }
        return params;
    };
}

function router(routes) {
    const table = routes.map(([method, pattern, handler]) =>
        ({ method, match: compile(pattern), handler }));

    return async function dispatch(req, res, url) {
        for (const route of table) {
            if (route.method !== req.method) continue;
            const params = route.match(url.pathname);
            if (!params) continue;

            const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
            const out = await route.handler({ params, query: url.searchParams, body, req, res });
            if (!res.writableEnded) json(res, out === undefined ? 204 : 200, out ?? null);
            return true;
        }
        return false;
    };
}

module.exports = { HttpError, bad, notFound, json, readBody, router };
