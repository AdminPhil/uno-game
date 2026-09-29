import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from './server.js';

const hash = value => createHash('sha256').update(value).digest();
const loginPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Family UNO — Sign in</title><body><main><h1>Family UNO</h1><p>Enter the family password to play.</p>
<form method="post" action="/login"><label>Family password <input name="password" type="password" autocomplete="current-password" maxlength="256" required></label>
<button type="submit">Sign in</button></form></main></body></html>`;

// A bounded global budget avoids trusting spoofable forwarded-IP headers or
// accumulating an unbounded per-IP map. Appropriate for a small private game.
function budget(limit, windowMs = 60000) {
    let start = Date.now(), count = 0;
    return () => {
        if (Date.now() - start >= windowMs) { start = Date.now(); count = 0; }
        return ++count <= limit;
    };
}

export function createHostingServer({ port = 8080, host = '127.0.0.1',
    production = false, publicOrigin, familyPassword = '', distDir = resolve('dist'),
    accessTtlMs = 12 * 60 * 60 * 1000, loginLimit = 30, maxConnections = 64 } = {}) {
    if (production && (!publicOrigin || !familyPassword || familyPassword.length < 16 || familyPassword.length > 256))
        throw new Error('Production requires PUBLIC_ORIGIN and a FAMILY_PASSWORD of 16–256 characters.');
    if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin ||
        (production && new URL(publicOrigin).protocol !== 'https:')))
        throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin without a trailing slash.');
    const files = new Map();
    function load(directory, prefix = '') {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name), url = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) load(path, url);
            else if (entry.isFile()) files.set(url, readFileSync(path));
        }
    }
    // Serve only built artifacts, never the repository, .env, or dependencies.
    load(distDir);
    if (!files.has('/index.html')) throw new Error('Run npm run build before starting the hosting server.');
    const key = randomBytes(32), expectedPassword = hash(familyPassword);
    const cookieName = production ? '__Host-uno-access' : 'uno-access';
    const signature = value => createHmac('sha256', key).update(value).digest('hex');
    function accessExpiry(req) {
        if (!familyPassword) return Infinity;
        const value = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
        if (!value || !/^\d{13}\.[a-f0-9]{64}$/.test(value)) return 0;
        const [expires, mac] = value.split('.');
        if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(expires), 'hex'))) return 0;
        return Number(expires) > Date.now() ? Number(expires) : 0;
    }
    const allowLogin = budget(loginLimit), allowUpgrade = budget(120);
    const websocketSource = publicOrigin ? publicOrigin.replace(/^http/, 'ws') : 'ws://localhost:* ws://127.0.0.1:*';
    const game = createGameServer({ noServer: true });
    let closing = false;
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
    const originAllowed = req => publicOrigin ? req.headers.origin === publicOrigin :
        ['http://localhost:3000', 'http://127.0.0.1:3000', `http://localhost:${http.address()?.port}`, `http://127.0.0.1:${http.address()?.port}`].includes(req.headers.origin);
    function respond(res, status, body, type = 'text/plain; charset=utf-8') {
        res.writeHead(status, { 'Content-Type': type }); res.end(body);
    }
    const http = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        // no-referrer makes form POST Origin null, breaking same-origin login.
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' ${websocketSource}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
        if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
        if (req.url === '/healthz' && req.method === 'GET') return respond(res, closing ? 503 : 200, closing ? 'stopping' : 'ok');
        if (req.url === '/login' && req.method === 'POST') {
            if (!originAllowed(req)) return respond(res, 403, 'Invalid request origin.');
            if (!allowLogin()) { res.setHeader('Retry-After', '60'); return respond(res, 429, 'Too many attempts. Please wait a minute.'); }
            if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return respond(res, 415, 'Invalid form.');
            try {
                let body = '', size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 2048) { respond(res, 413, 'Form too large.'); req.destroy(); return; }
                    body += chunk.toString();
                }
                const password = new URLSearchParams(body).get('password') || '';
                if (!familyPassword || !timingSafeEqual(hash(password), expectedPassword))
                    return respond(res, 200, loginPage.replace('Enter the family password to play.', 'Incorrect password. Please try again.'), mime['.html']);
                const expires = String(Date.now() + accessTtlMs);
                res.setHeader('Set-Cookie', `${cookieName}=${expires}.${signature(expires)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(accessTtlMs / 1000)}${production ? '; Secure' : ''}`);
                res.writeHead(303, { Location: '/' }); res.end(); return;
            } catch { if (!res.headersSent) respond(res, 400, 'Invalid request.'); return; }
        }
        if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, 'Method not allowed.');
        if (req.url === '/login') return respond(res, 200, loginPage, mime['.html']);
        if (!accessExpiry(req)) { res.writeHead(303, { Location: '/login' }); res.end(); return; }
        let path;
        try { path = new URL(req.url, 'http://localhost').pathname; } catch { return respond(res, 400, 'Invalid path.'); }
        const body = files.get(path === '/' ? '/index.html' : path);
        if (!body) return respond(res, 404, 'Not found.');
        respond(res, 200, req.method === 'HEAD' ? undefined : body, mime[extname(path === '/' ? '/index.html' : path)] || 'application/octet-stream');
    });
    http.requestTimeout = 15000;
    http.headersTimeout = 10000;
    http.maxConnections = 128;
    http.on('upgrade', (req, socket, head) => {
        socket.on('error', () => {});
        function reject(status) { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
        if (closing || game.wss.clients.size >= maxConnections || !allowUpgrade()) return reject('503 Service Unavailable');
        if (req.url !== '/ws') return reject('404 Not Found');
        if (!originAllowed(req)) return reject('403 Forbidden');
        const expires = accessExpiry(req);
        if (!expires) return reject('401 Unauthorized');
        game.wss.handleUpgrade(req, socket, head, ws => {
            game.wss.emit('connection', ws, req);
            if (Number.isFinite(expires)) {
                const timer = setTimeout(() => ws.close(4003, 'Family access expired'), Math.max(1, expires - Date.now()));
                timer.unref(); ws.once('close', () => clearTimeout(timer));
            }
        });
    });
    http.listen(port, host);
    return { http, game, async close() {
        closing = true;
        const stopped = new Promise(resolve => http.close(resolve));
        await game.close();
        http.closeAllConnections();
        await stopped;
    } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const production = process.env.NODE_ENV === 'production';
    const app = createHostingServer({ port: Number(process.env.PORT || 8080),
        host: production ? '0.0.0.0' : '127.0.0.1', production,
        publicOrigin: process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL,
        familyPassword: process.env.FAMILY_PASSWORD });
    app.http.on('listening', () => console.log(`UNO listening on port ${app.http.address().port}`));
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
        if (stopping) return; stopping = true;
        await app.close(); process.exit(0);
    });
}
