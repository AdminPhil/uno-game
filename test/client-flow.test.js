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
    it('celebrates the winner and lets players accept a rematch or leave', async () => {
        const b = await browser();
        const result = { ...seat, roundWinner: { id: 'me', name: 'Alice' } };
        b.receive(result);
        expect(b.el('round-result').hidden).toBe(false);
        expect(b.el('winner-message').textContent).toContain('You won');
        expect(b.w.sessionStorage.getItem('unoSessionToken')).toBe('secret');
        b.el('play-again').click();
        expect(JSON.parse(b.socket.send.mock.calls.at(-1)[0])).toEqual({ action: 'play_again' });
        b.receive({ ...result, action: 'players', players: [{ ...seat.players[0], ready: true }] });
        expect(b.el('play-again').disabled).toBe(true);
        expect(b.el('rematch-status').textContent).toContain('ready for another round');
        b.receive({ ...result, action: 'players', roundWinner: { id: 'other', name: '<img src=x>' } });
        expect(b.el('winner-message').textContent).toContain('<img src=x> wins');
        expect(b.el('winner-message').querySelector('img')).toBeNull();
        b.el('leave-after-round').click();
        expect(JSON.parse(b.socket.send.mock.calls.at(-1)[0])).toEqual({ action: 'leave' });
        b.receive({ action: 'left' });
        expect(b.el('round-result').hidden).toBe(true);
    });
    it.each(['wild', 'wild4'])('announces the chosen color for %s and clears it on the next card', async type => {
        const b = await browser();
        const game = { ...seat, started: true, turn: 0, hand: [{ color: 'red', type: 'skip' }] };
        for (const color of ['red', 'blue', 'green', 'yellow']) {
            b.receive({ ...game, discardPile: [{ type, color }] });
            expect(b.el('discard-description').textContent).toContain(`chosen color: ${color[0].toUpperCase() + color.slice(1)}`);
        }
        b.receive({ ...game, action: 'update', discardPile: [{ type: 'skip', color: 'red' }] });
        expect(b.el('discard-description').textContent).toBe('Current color: Red • Skip: the next player misses a turn.');
        expect(b.el('discard-pile').querySelector('.card-center-number').textContent).toBe('SKIP');
        expect(b.el('player-hand').querySelector('.card-center-number').textContent).toBe('SKIP');
        b.receive({ ...game, action: 'update', discardPile: [{ type: '5', color: 'blue' }] });
        expect(b.el('discard-description').textContent).toBe('Current color: Blue');
        b.receive({ action: 'left' });
        expect(b.el('discard-description').textContent).toBe('');
    });
    it('lets only the connected host start once all players are ready', async () => {
        const b = await browser();
        expect(b.el('start-game').hidden).toBe(true);
        const ready = { ...seat, players: [
            { ...seat.players[0], ready: true, connected: true },
            { id: 'other', name: 'Boris', ready: true, connected: true },
            { id: 'third', name: 'Chris', ready: true, connected: false },
        ] };
        b.receive(ready);
        expect(b.el('start-game').hidden).toBe(false);
        expect(b.el('start-game').disabled).toBe(true);
        expect(b.el('players').textContent).toContain('Chris (Reconnecting');
        b.receive({ ...ready, action: 'players', players: ready.players.map(p => ({ ...p, connected: true })) });
        expect(b.el('start-game').disabled).toBe(false);
        expect(b.el('ready').textContent).toBe('Not Ready');
        b.el('start-game').click();
        expect(JSON.parse(b.socket.send.mock.calls.at(-1)[0])).toEqual({ action: 'start' });
        b.receive({ ...ready, action: 'players', players: ready.players.map(p => ({ ...p, connected: true, isCreator: p.id === 'other' })) });
        expect(b.el('start-game').hidden).toBe(true);
        expect(b.el('start-game').disabled).toBe(true);
    });
    it('shares only the game URL and acknowledged lobby code through Telegram', async () => {
        const b = await browser();
        b.w.open = vi.fn();
        expect(b.el('invite-telegram').disabled).toBe(true);
        b.receive(seat);
        b.el('invite-telegram').click();
        const [url, target, features] = b.w.open.mock.calls[0];
        const share = new URL(url);
        expect(share.origin + share.pathname).toBe('https://t.me/share/url');
        expect(share.searchParams.get('url')).toBe('http://localhost:3000/');
        expect(share.searchParams.get('text')).toContain('Lobby code: ABC123');
        expect(url).not.toContain(seat.token);
        expect(target).toBe('_blank');
        expect(features).toBe('noopener,noreferrer');
        b.receive({ ...seat, action: 'start', started: true, turn: 0,
            hand: [{ color: 'red', type: '5' }], discardPile: [{ color: 'blue', type: '5' }] });
        expect(b.el('invite-telegram').disabled).toBe(true);
        b.el('invite-telegram').click();
        expect(b.w.open).toHaveBeenCalledTimes(1);
        b.receive({ action: 'left' });
        expect(b.el('invite-telegram').disabled).toBe(true);
    });
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
