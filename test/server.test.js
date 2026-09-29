// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { createGameServer } from '../server.js';

let server, peers;
async function peer() {
    const ws = new WebSocket(`ws://127.0.0.1:${server.wss.address().port}`);
    const messages = [];
    ws.on('message', data => messages.push(JSON.parse(data)));
    await once(ws, 'open');
    const client = { ws, messages, send: m => ws.send(JSON.stringify(m)), async next(action) {
        for (let i = 0; i < 200; i++) {
            const index = messages.findIndex(m => m.action === action);
            if (index >= 0) return messages.splice(index, 1)[0];
            await new Promise(r => setTimeout(r, 5));
        }
        throw new Error(`Missing ${action}: ${JSON.stringify(messages)}`);
    }, async disconnect() { ws.close(); await once(ws, 'close'); } };
    peers.push(client);
    return client;
}
async function join(client, name = 'Alice', lobbyId) {
    client.send({ action: 'join', name, ...(lobbyId ? { lobbyId } : {}) });
    return client.next('joined');
}
async function game() {
    const a = await peer(), b = await peer();
    const seat = await join(a);
    await join(b, 'Boris', seat.lobbyId);
    a.send({ action: 'ready' }); b.send({ action: 'ready' });
    const start = await a.next('start'); await b.next('start');
    a.messages.length = b.messages.length = 0;
    return { a, b, seat, start, lobby: server.lobbies.get(seat.lobbyId) };
}
beforeEach(async () => {
    peers = []; server = createGameServer({ port: 0, graceMs: 100 });
    await once(server.wss, 'listening');
});
afterEach(async () => { await server.close(); });

describe('multiplayer protocol', () => {
    it('rejects ready before joining without creating a lobby', async () => {
        const a = await peer(); a.send({ action: 'ready' });
        expect((await a.next('error')).code).toBe('NOT_JOINED');
        expect(server.lobbies.size).toBe(0);
        await join(a); a.messages.length = 0; a.send({ action: 'ready' });
        expect((await a.next('players')).players[0].ready).toBe(true);
    });
    it('disconnect before joining has no side effects', async () => {
        const a = await peer(); await a.disconnect();
        expect(server.lobbies.size).toBe(0); expect(server.sessions.size).toBe(0);
    });
    it('restores a joined player and ready state with the same token', async () => {
        const a = await peer(), seat = await join(a);
        a.send({ action: 'ready' }); await a.next('players');
        await a.disconnect();
        const b = await peer(); b.send({ action: 'rejoin', token: seat.token });
        const restored = await b.next('joined');
        expect(restored.id).toBe(seat.id); expect(restored.token).toBe(seat.token);
        expect(restored.players).toHaveLength(1); expect(restored.players[0].ready).toBe(true);
    });
    it('restores an active hand and turn and continues play', async () => {
        const { a, b, seat, start, lobby } = await game();
        await a.disconnect();
        const resumed = await peer(); resumed.send({ action: 'rejoin', token: seat.token });
        const restored = await resumed.next('joined');
        expect(restored.hand).toEqual(start.hand); expect(restored.turn).toBe(start.turn);
        expect(restored.players).toHaveLength(2);
        resumed.messages.length = 0; resumed.send({ action: 'draw' });
        const update = await resumed.next('update');
        expect(update.hand).toHaveLength(8); expect(lobby.game.turn).toBe(1);
        b.send({ action: 'draw' }); await b.next('update');
    });
    it('duplicate reconnects replace sockets without duplicate seats or stale close removal', async () => {
        const a = await peer(), seat = await join(a), b = await peer();
        b.send({ action: 'rejoin', token: seat.token }); await b.next('joined');
        expect((await a.next('error')).code).toBe('SESSION_REPLACED');
        b.send({ action: 'rejoin', token: seat.token }); await b.next('joined');
        await new Promise(r => setTimeout(r, 140));
        expect(server.lobbies.get(seat.lobbyId).players).toHaveLength(1);
        b.send({ action: 'ready' });
        expect((await b.next('players')).players).toHaveLength(1);
    });
    it('rejects invalid and expired tokens and cleans empty lobbies', async () => {
        const a = await peer(); a.send({ action: 'rejoin', token: {} });
        expect((await a.next('error')).code).toBe('SESSION_EXPIRED');
        const seat = await join(a); await a.disconnect();
        await new Promise(r => setTimeout(r, 140));
        expect(server.lobbies.size).toBe(0); expect(server.sessions.size).toBe(0);
        const b = await peer(); b.send({ action: 'rejoin', token: seat.token });
        expect((await b.next('error')).code).toBe('SESSION_EXPIRED');
        await join(b);
    });
    it('does not attach failed joins and rejects midgame joins', async () => {
        const { seat } = await game(), c = await peer();
        c.send({ action: 'join', name: 'Chris', lobbyId: seat.lobbyId });
        expect((await c.next('error')).code).toBe('GAME_STARTED');
        c.send({ action: 'ready' }); expect((await c.next('error')).code).toBe('NOT_JOINED');
        await c.disconnect(); expect(server.lobbies.get(seat.lobbyId).players).toHaveLength(2);
    });
    it('never sends opponents hands or session secrets in snapshots', async () => {
        const { a, b, seat, start } = await game();
        expect(start.hand).toHaveLength(7);
        a.send({ action: 'draw' });
        const updates = [start, await a.next('update'), await b.next('update')];
        const c = await peer(); c.send({ action: 'rejoin', token: seat.token });
        updates.push(await c.next('joined'));
        for (const update of updates) for (const p of update.players) {
            expect(Object.keys(p).sort()).toEqual(['cardCount','connected','id','isCreator','name','ready','uno'].sort());
        }
    });
    it('rejects fabricated cards and overclaimed duplicates atomically', async () => {
        const { a, lobby } = await game();
        lobby.players[0].hand = [{ color: 'red', type: '5' }, { color: 'blue', type: '7' }];
        lobby.game.discardPile = [{ color: 'red', type: '1' }];
        const before = JSON.stringify({ game: lobby.game, hand: lobby.players[0].hand });
        for (const m of [{ action: 'play', card: { color: 'red', type: '8' } },
            { action: 'play_multiple', cards: [{ color: 'red', type: '5' }, { color: 'red', type: '5' }] },
            { action: 'play_multiple', cards: [] }, { action: 'play', card: null }]) {
            a.send(m); expect((await a.next('error')).code).toBe('INVALID_PLAY');
            expect(JSON.stringify({ game: lobby.game, hand: lobby.players[0].hand })).toBe(before);
        }
        a.send({ action: 'play', card: { color: 'red', type: '5', injected: true } });
        await a.next('update'); expect(lobby.game.discardPile.at(-1)).toEqual({ color: 'red', type: '5' });
    });
    it('preserves multiple-card effects including reverse-direction skip wraparound', async () => {
        const { a, lobby } = await game();
        lobby.players[0].hand = [...Array.from({ length: 4 }, () => ({ color: 'red', type: 'skip' })), { color: 'blue', type: '2' }];
        lobby.game.direction = -1; lobby.game.discardPile = [{ color: 'red', type: '1' }];
        a.send({ action: 'play_multiple', cards: lobby.players[0].hand.slice(0, 4) });
        await a.next('update'); expect(lobby.game.turn).toBe(1); expect(lobby.players[0].hand).toHaveLength(1);
    });
    it('recycles discards without producing undefined cards', async () => {
        const { a, lobby } = await game();
        lobby.game.deck = []; lobby.game.discardPile = [{ type: 'wild', color: 'blue' }, { color: 'red', type: '1' }];
        a.send({ action: 'draw' }); const update = await a.next('update');
        expect(update.hand.at(-1)).toEqual({ type: 'wild' }); expect(update.discardPile).toHaveLength(1);
    });
    it('expires an absent player and safely returns the remaining player to the lobby', async () => {
        const { a, b, lobby } = await game(); await a.disconnect();
        await b.next('game_ended');
        expect(lobby.game.started).toBe(false); expect(lobby.players).toHaveLength(1);
        b.send({ action: 'ready' }); expect((await b.next('players')).players).toHaveLength(1);
    });
    it('handles malformed and out-of-order messages without mutation or crashing', async () => {
        const a = await peer();
        for (const raw of ['{', 'null', '[]', '42', '{}', '{"action":{}}', '{"action":"join","name":null}']) {
            a.ws.send(raw); await a.next('error'); expect(server.lobbies.size).toBe(0);
        }
        await join(a);
        for (const action of ['play','play_multiple','draw','unknown']) {
            a.send({ action }); await a.next('error');
        }
        a.send({ action: 'ready' }); expect((await a.next('players')).players).toHaveLength(1);
    });
    it('handles oversized transport messages without crashing the server', async () => {
        const a = await peer(); a.ws.send('x'.repeat(17000)); await once(a.ws, 'close');
        const b = await peer(); expect((await join(b)).id).toBeTruthy();
    });
});
