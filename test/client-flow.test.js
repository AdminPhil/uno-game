// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const html = readFileSync('index.html', 'utf8');
const script = readFileSync('client.js', 'utf8');
const windows = [];
async function browser(token) {
    const dom = new JSDOM(html, { url: 'http://localhost:3000', runScripts: 'outside-only' });
    const w = dom.window, sockets = [];
    windows.push(w);
    await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve));
    w.WebSocket = class {
        static OPEN = 1;
        readyState = 0;
        send = vi.fn();
        constructor(url) { this.url = url; sockets.push(this); }
    };
    w.alert = vi.fn(); w.confirm = () => true;
    if (token) w.sessionStorage.setItem('unoSessionToken', token);
    w.eval(script);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const socket = sockets[0]; socket.readyState = 1; socket.onopen();
    return { w, socket, el: id => w.document.getElementById(id),
        receive: m => socket.onmessage({ data: JSON.stringify(m) }) };
}
const seat = { action: 'joined', id: 'me', token: 'secret', lobbyId: 'ABC123', started: false, turn: -1,
    players: [{ id: 'me', name: 'Alice', isCreator: true, ready: false, uno: false, cardCount: 0 }] };
afterEach(() => { for (const w of windows.splice(0)) w.close(); });
describe('actual browser client script', () => {
    it('prompts drawing only on your connected turn without a playable card', async () => {
        const b = await browser();
        const game = { ...seat, started: true, turn: 0,
            hand: [{ color: 'red', type: '5' }],
            discardPile: [{ color: 'blue', type: '9' }],
            players: [...seat.players, { id: 'other', name: 'Boris', cardCount: 7 }] };
        b.receive(game);
        expect(b.el('draw-prompt').textContent).toContain('no playable cards');
        b.el('draw-card').click();
        expect(JSON.parse(b.socket.send.mock.calls.at(-1)[0])).toEqual({ action: 'draw' });
        b.receive({ ...game, action: 'update', turn: 1 });
        expect(b.el('draw-prompt').textContent).toBe('');
        b.receive({ ...game, action: 'update' });
        expect(b.el('draw-prompt').textContent).toContain('Draw Card');
        b.socket.readyState = 3; b.socket.onclose({ code: 1006 });
        expect(b.el('draw-prompt').textContent).toBe('');
    });
    it.each([
        { color: 'blue', type: '5' },
        { color: 'red', type: '9' },
        { color: 'black', type: 'wild' },
        { color: 'black', type: 'wild4' },
    ])('does not prompt drawing with a playable $color $type', async card => {
        const b = await browser();
        b.receive({ ...seat, started: true, turn: 0, hand: [card],
            discardPile: [{ color: 'blue', type: '9' }] });
        expect(b.el('draw-prompt').textContent).toBe('');
    });
    it('keeps Ready disabled until explicit join acknowledgement', async () => {
        const b = await browser();
        expect(b.socket.url).toBe('ws://localhost:3000/ws');
        expect(b.el('ready').disabled).toBe(true);
        b.el('name').value = 'Alice'; b.el('join').click();
        expect(JSON.parse(b.socket.send.mock.calls[0][0])).toEqual({ action: 'join', name: 'Alice' });
        b.receive({ ...seat, action: 'players' });
        expect(b.el('ready').disabled).toBe(true);
        b.receive(seat); expect(b.el('ready').disabled).toBe(false);
        b.el('ready').click(); expect(JSON.parse(b.socket.send.mock.calls.at(-1)[0])).toEqual({ action: 'ready' });
    });
    it('uses the saved token on refresh and restores the game from the acknowledgement', async () => {
        const b = await browser('secret');
        expect(JSON.parse(b.socket.send.mock.calls[0][0])).toEqual({ action: 'rejoin', token: 'secret' });
        expect(b.el('ready').disabled).toBe(true);
        b.receive({ ...seat, started: true, turn: 0, hand: [{ color: 'red', type: '5' }],
            discardPile: [{ color: 'blue', type: '5' }], players: [...seat.players,
                { id: 'other', name: 'Boris', cardCount: 4, uno: true }] });
        expect(b.el('game').style.display).toBe('block');
        expect(b.el('player-hand').querySelectorAll('.card')).toHaveLength(1);
        expect(b.el('opponent-hands').textContent).toContain('Boris (4 cards)');
        expect(b.el('opponent-hands').querySelector('.uno')).toBeTruthy();
        expect(b.el('turn-text').textContent).toBe('Your turn!');
        b.socket.readyState = 3; b.socket.onclose({ code: 1006 });
        expect(b.el('ready').disabled).toBe(true); expect(b.el('draw-card').disabled).toBe(true);
        expect(b.w.sessionStorage.getItem('unoSessionToken')).toBe('secret');
    });
    it('clears an expired token and returns to the usable join flow', async () => {
        const b = await browser('stale'); b.receive({ action: 'error', code: 'SESSION_EXPIRED', message: 'Please join again.' });
        expect(b.w.sessionStorage.getItem('unoSessionToken')).toBeNull();
        expect(b.el('join').disabled).toBe(false); expect(b.el('ready').disabled).toBe(true);
        expect(b.el('connection-status').textContent).toBe('Please join again.');
    });
    it('renders creator names as text instead of executable HTML', async () => {
        const b = await browser(); b.receive({ ...seat, players: [{ ...seat.players[0], name: '<img src=x>' }] });
        expect(b.el('lobby-info').querySelector('img')).toBeNull();
        expect(b.el('lobby-info').textContent).toContain('<img src=x>');
    });
    it('waits for leave acknowledgement and then disables Ready', async () => {
        const b = await browser(); b.receive(seat); b.el('leave-lobby').click();
        expect(JSON.parse(b.socket.send.mock.calls.at(-1)[0])).toEqual({ action: 'leave' });
        b.receive({ action: 'left' }); expect(b.el('ready').disabled).toBe(true);
        expect(b.w.sessionStorage.getItem('unoSessionToken')).toBeNull();
    });
});
