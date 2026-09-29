// @vitest-environment node
import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createHostingServer } from '../hosting.js';
let app, directory, base;
const origin = 'https://family.example';
const password = 'test-only-family-password';
beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'uno-hosting-'));
    writeFileSync(join(directory, 'index.html'), '<h1>UNO</h1>');
    writeFileSync(join(directory, 'app.js'), '/* game */');
});
afterEach(async () => { if (app) await app.close(); app = null; rmSync(directory, { recursive: true, force: true }); });
async function start(options = {}) {
    app = createHostingServer({ port: 0, production: true, publicOrigin: origin, familyPassword: password, distDir: directory, ...options });
    await once(app.http, 'listening'); base = `http://127.0.0.1:${app.http.address().port}`;
}
async function login(value = password, from = origin) {
    return fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { Origin: from, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: value }) });
}
async function cookie() { return (await login()).headers.get('set-cookie').split(';')[0]; }
function connect(headers = {}) { return new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers }); }
async function rejected(headers) {
    const ws = connect(headers); ws.on('error', () => {});
    return new Promise(resolve => ws.once('unexpected-response', (_, response) => {
        const status = response.statusCode; response.resume(); ws.terminate(); resolve(status);
    }));
}
it('fails closed without production credentials or a secure canonical origin', () => {
    expect(() => createHostingServer({ production: true })).toThrow('Production requires');
    expect(() => createHostingServer({ production: true, publicOrigin: 'http://family.example', familyPassword: password })).toThrow('HTTPS');
});
it('serves only a login page without authentication and exposes a minimal health check', async () => {
    await start();
    const response = await fetch(base); expect(response.status).toBe(200);
    expect(response.url).toBe(base + '/login');
    expect(await response.text()).toContain('Family password');
    expect(await (await fetch(base + '/healthz')).text()).toBe('ok');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self' wss://family.example");
    expect(response.headers.get('strict-transport-security')).toBeTruthy();
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
});
it('issues a secure HttpOnly cookie, serves assets and never serves repository files', async () => {
    await start(); const response = await login(); expect(response.status).toBe(303);
    const value = response.headers.get('set-cookie');
    for (const flag of ['__Host-uno-access=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(value).toContain(flag);
    const headers = { Cookie: value.split(';')[0] };
    expect(await (await fetch(base, { headers })).text()).toContain('<h1>UNO</h1>');
    expect((await fetch(base + '/app.js', { headers })).status).toBe(200);
    for (const path of ['/.env', '/server.js', '/package.json', '/%2e%2e/.git/config']) expect((await fetch(base + path, { headers })).status).toBe(404);
});
it('rejects incorrect passwords, cross-origin login and tampered cookies', async () => {
    await start(); expect(await (await login('wrong')).text()).toContain('Incorrect password');
    expect((await login(password, 'https://attacker.example')).status).toBe(403);
    expect((await fetch(base, { redirect: 'manual', headers: { Cookie: '__Host-uno-access=9999999999999.' + '0'.repeat(64) } })).status).toBe(303);
});
it('limits password attempts', async () => {
    await start({ loginLimit: 2 }); await login('wrong'); await login('wrong');
    expect((await login()).status).toBe(429);
});
it('requires both family authentication and exact Origin for WebSockets', async () => {
    await start();
    expect(await rejected({ Origin: origin })).toBe(401);
    const Cookie = await cookie();
    expect(await rejected({ Cookie, Origin: 'https://attacker.example' })).toBe(403);
    expect(await rejected({ Cookie })).toBe(403);
    const ws = connect({ Cookie, Origin: origin }); await once(ws, 'open');
    ws.send(JSON.stringify({ action: 'join', name: 'Alice' }));
    const [data] = await once(ws, 'message'); expect(JSON.parse(data).action).toBe('joined');
    ws.close(); await once(ws, 'close');
});
it('expires family access on existing sockets and rejects expired cookies', async () => {
    await start({ accessTtlMs: 300 }); const Cookie = await cookie();
    const ws = connect({ Cookie, Origin: origin }); await once(ws, 'open');
    const [code] = await once(ws, 'close'); expect(code).toBe(4003);
    expect((await fetch(base, { redirect: 'manual', headers: { Cookie } })).status).toBe(303);
});
it('caps simultaneous WebSockets', async () => {
    await start({ maxConnections: 1 }); const headers = { Cookie: await cookie(), Origin: origin };
    const ws = connect(headers); await once(ws, 'open');
    expect(await rejected(headers)).toBe(503); ws.close(); await once(ws, 'close');
});
it('bounds message floods without bringing down the service', async () => {
    await start(); const ws = connect({ Cookie: await cookie(), Origin: origin }); await once(ws, 'open');
    const closed = once(ws, 'close');
    for (let i = 0; i < 65; i++) ws.send('{}');
    expect((await closed)[0]).toBe(4008);
    expect((await fetch(base + '/healthz')).status).toBe(200);
});
