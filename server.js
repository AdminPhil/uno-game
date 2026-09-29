import { WebSocket, WebSocketServer } from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const colors = ['red', 'yellow', 'green', 'blue'];
const wild = c => c.type === 'wild' || c.type === 'wild4';
const mod = (n, size) => ((n % size) + size) % size;
const emptyGame = () => ({ deck: [], discardPile: [], turn: 0, direction: 1, started: false });

export function createGameServer({ port = 8080, noServer = false, graceMs = 60000,
    heartbeatMs = 15000, maxMessages = 60, messageWindowMs = 10000, maxSessions = 100 } = {}) {
    const wss = new WebSocketServer({ ...(noServer ? { noServer: true } : { port }), maxPayload: 16384 });
    const lobbies = new Map(), sessions = new Map(), clients = new Map();
    const send = (ws, message) => {
        if (ws?.bufferedAmount > 1024 * 1024) { ws.terminate(); return; }
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message), () => {});
    };
    const error = (ws, code, message) => send(ws, { action: 'error', code, message });
    function snapshot(lobby, p, action) {
        return { action, id: p.id, lobbyId: lobby.id, started: lobby.game.started,
            roundWinner: lobby.roundWinner || null,
            players: lobby.players.map(p => ({ id: p.id, name: p.name, ready: p.ready,
                isCreator: p.isCreator, connected: !!p.ws, uno: p.uno, cardCount: p.hand.length })),
            turn: lobby.game.started ? lobby.game.turn : -1,
            ...(lobby.game.started ? { hand: p.hand, discardPile: lobby.game.discardPile } : {}) };
    }
    function broadcast(lobby, action = lobby.game.started ? 'update' : 'players') {
        for (const p of lobby.players) p.uno = p.hand.length === 1 ||
            (p.hand.length > 1 && !wild(p.hand[0]) && p.hand.every(c => c.type === p.hand[0].type));
        for (const p of lobby.players) send(p.ws, snapshot(lobby, p, action));
    }
    const acknowledge = p => send(p.ws, { ...snapshot(lobbies.get(p.lobbyId), p, 'joined'), token: p.token });
    function invalidate(p) {
        clearTimeout(p.timer);
        sessions.delete(p.token);
        if (p.ws) clients.set(p.ws, null);
    }
    function remove(p) {
        const lobby = lobbies.get(p.lobbyId);
        invalidate(p);
        if (!lobby || !lobby.players.includes(p)) return;
        const { game, players } = lobby;
        const current = players[game.turn];
        const next = players[mod(game.turn + game.direction, players.length)];
        game.deck.push(...p.hand.map(c => wild(c) ? { type: c.type } : c));
        players.splice(players.indexOf(p), 1);
        if (!players.length) { lobbies.delete(lobby.id); return; }
        game.turn = Math.max(0, players.indexOf(current === p ? next : current));
        if (p.isCreator) players[0].isCreator = true;
        if (game.started && players.length < 2) {
            lobby.game = emptyGame();
            for (const remaining of players) {
                remaining.ready = false; remaining.hand = []; remaining.uno = false;
                send(remaining.ws, { action: 'game_ended', message: 'The other players left. Waiting in the lobby.' });
            }
        }
        broadcast(lobby);
    }
    function shuffle(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
    }
    function startGame(lobby) {
        lobby.roundWinner = null;
        const game = lobby.game = emptyGame();
        for (const color of colors) for (const type of [...'0123456789', 'skip', 'reverse', 'draw2']) {
            game.deck.push({ color, type });
            if (type !== '0') game.deck.push({ color, type });
        }
        for (let i = 0; i < 4; i++) game.deck.push({ type: 'wild' }, { type: 'wild4' });
        shuffle(game.deck);
        for (const p of lobby.players) p.hand = game.deck.splice(0, 7);
        game.discardPile.push(game.deck.splice(game.deck.findIndex(c => !wild(c)), 1)[0]);
        game.started = true;
        broadcast(lobby, 'start');
    }
    function draw(game, count) {
        const result = [];
        for (let i = 0; i < count; i++) {
            if (!game.deck.length) {
                game.deck = game.discardPile.splice(0, game.discardPile.length - 1).map(c => wild(c) ? { type: c.type } : c);
                shuffle(game.deck);
            }
            if (!game.deck.length) break;
            result.push(game.deck.pop());
        }
        return result;
    }
    function play(ws, lobby, p, requested) {
        if (!Array.isArray(requested) || !requested.length || requested.length > p.hand.length)
            return error(ws, 'INVALID_PLAY', 'Choose cards from your hand.');
        const remaining = [...p.hand], cards = [];
        // Validate the complete multiset before mutation, using only server-owned cards.
        for (const card of requested) {
            if (!card || typeof card !== 'object' || Array.isArray(card) || !colors.includes(card.color) || typeof card.type !== 'string')
                return error(ws, 'INVALID_PLAY', 'Invalid card or wild color.');
            const i = remaining.findIndex(c => c.type === card.type && (wild(c) || c.color === card.color));
            if (i < 0) return error(ws, 'INVALID_PLAY', 'That card is no longer in your hand.');
            const owned = remaining.splice(i, 1)[0];
            cards.push(wild(owned) ? { type: owned.type, color: card.color } : owned);
        }
        const { game, players } = lobby;
        const first = cards[0], last = cards.at(-1), top = game.discardPile.at(-1);
        if (!cards.every(c => c.type === first.type) || !(wild(first) || first.color === top.color || first.type === top.type))
            return error(ws, 'INVALID_PLAY', 'Those cards cannot be played on the top card.');
        p.hand = remaining;
        game.discardPile.push(...cards);
        let steps = 1;
        if (last.type === 'skip') steps = cards.length + 1;
        if (last.type === 'reverse' && cards.length % 2) game.direction *= -1;
        if (last.type === 'draw2' || last.type === 'wild4') {
            players[mod(game.turn + game.direction, players.length)].hand.push(...draw(game, cards.length * (last.type === 'draw2' ? 2 : 4)));
            steps = 2;
        }
        game.turn = mod(game.turn + steps * game.direction, players.length);
        broadcast(lobby);
        if (!p.hand.length) {
            lobby.roundWinner = { id: p.id, name: p.name };
            lobby.game = emptyGame();
            for (const player of players) {
                player.ready = false; player.hand = []; player.uno = false;
            }
            broadcast(lobby);
        }
    }
    function receive(ws, data, binary) {
        let m;
        try { m = JSON.parse(data.toString()); } catch { return error(ws, 'BAD_MESSAGE', 'Invalid message.'); }
        if (binary || !m || typeof m !== 'object' || Array.isArray(m) || typeof m.action !== 'string')
            return error(ws, 'BAD_MESSAGE', 'Invalid message.');
        const p = clients.get(ws);
        if (m.action === 'rejoin') {
            const restored = typeof m.token === 'string' && sessions.get(m.token);
            if (!restored || !lobbies.has(restored.lobbyId) || (restored.expiresAt && restored.expiresAt <= Date.now()))
                return error(ws, 'SESSION_EXPIRED', 'Your session expired. Please join a lobby again.');
            if (p && p !== restored) return error(ws, 'ALREADY_JOINED', 'Leave your current lobby first.');
            // One token owns one seat and one socket; the latest connection takes over.
            if (restored.ws && restored.ws !== ws) {
                const old = restored.ws;
                clients.set(old, null);
                error(old, 'SESSION_REPLACED', 'This session was opened in another tab.');
                old.close(4001, 'Session replaced');
            }
            clearTimeout(restored.timer);
            restored.expiresAt = null; restored.ws = ws;
            clients.set(ws, restored);
            acknowledge(restored);
            const lobby = lobbies.get(restored.lobbyId);
            broadcast(lobby);
            return;
        }
        if (m.action === 'join') {
            if (p) return error(ws, 'ALREADY_JOINED', 'Leave your current lobby first.');
            if (sessions.size >= maxSessions) return error(ws, 'SERVER_FULL', 'The server is full. Please try again shortly.');
            if (typeof m.name !== 'string' || m.name.trim().length < 2 || m.name.trim().length > 20 ||
                (m.lobbyId !== undefined && (typeof m.lobbyId !== 'string' || !/^[A-Z0-9]{6}$/.test(m.lobbyId))))
                return error(ws, 'INVALID_JOIN', 'Enter a name of 2–20 characters and a valid lobby code.');
            let lobby = lobbies.get(m.lobbyId);
            if (m.lobbyId && !lobby) return error(ws, 'LOBBY_NOT_FOUND', 'Lobby not found. Check the code or create a new lobby.');
            if (lobby?.game.started) return error(ws, 'GAME_STARTED', 'That game has already started.');
            if (lobby?.players.length >= 10) return error(ws, 'LOBBY_FULL', 'This lobby is full.');
            if (lobby?.players.some(p => p.name.toLowerCase() === m.name.trim().toLowerCase()))
                return error(ws, 'NAME_TAKEN', 'A player with that name already exists in this lobby.');
            if (!lobby) {
                let id;
                do { id = randomBytes(3).toString('hex').toUpperCase(); } while (lobbies.has(id));
                lobby = { id, players: [], game: emptyGame() }; lobbies.set(id, lobby);
            }
            const joined = { id: randomUUID(), token: randomBytes(32).toString('hex'), lobbyId: lobby.id,
                name: m.name.trim(), ready: false, isCreator: !lobby.players.length, uno: false, hand: [], ws };
            lobby.players.push(joined); sessions.set(joined.token, joined); clients.set(ws, joined);
            acknowledge(joined); broadcast(lobby);
            return;
        }
        const lobby = p && lobbies.get(p.lobbyId);
        if (!lobby || p.ws !== ws || !lobby.players.includes(p)) return error(ws, 'NOT_JOINED', 'Join a lobby before using game controls.');
        if (m.action === 'leave') { remove(p); send(ws, { action: 'left' }); return; }
        if (m.action === 'start') {
            if (lobby.game.started) return error(ws, 'GAME_STARTED', 'The game has already started.');
            if (!p.isCreator) return error(ws, 'NOT_HOST', 'The lobby creator starts the game.');
            if (lobby.players.length < 2 || !lobby.players.every(player => player.ready && player.ws?.readyState === WebSocket.OPEN))
                return error(ws, 'NOT_READY', 'Wait for at least two players and for everyone to be connected and Ready.');
            startGame(lobby); return;
        }
        if (m.action === 'play_again') {
            if (lobby.game.started || !lobby.roundWinner) return error(ws, 'NOT_FINISHED', 'Wait until the round has finished.');
            p.ready = true; broadcast(lobby); return;
        }
        if (m.action === 'ready') {
            if (lobby.game.started) return error(ws, 'GAME_STARTED', 'The game has already started.');
            p.ready = !p.ready; broadcast(lobby); return;
        }
        if (!['play', 'play_multiple', 'draw', 'uno'].includes(m.action)) return error(ws, 'BAD_MESSAGE', 'Unknown action.');
        if (!lobby.game.started) return error(ws, 'NOT_STARTED', 'Wait for the game to start.');
        if (m.action === 'uno') { broadcast(lobby); return; }
        if (lobby.players[lobby.game.turn] !== p) return error(ws, 'NOT_YOUR_TURN', 'Please wait for your turn.');
        if (m.action === 'draw') {
            p.hand.push(...draw(lobby.game, 1));
            lobby.game.turn = mod(lobby.game.turn + lobby.game.direction, lobby.players.length); broadcast(lobby);
        } else play(ws, lobby, p, m.action === 'play' ? [m.card] : m.cards);
    }
    wss.on('connection', ws => {
        clients.set(ws, null); ws.alive = true;
        let count = 0, windowStart = Date.now();
        ws.on('pong', () => { ws.alive = true; });
        ws.on('error', () => {}); // ws protocol/transport errors must not become uncaught events.
        ws.on('message', (data, binary) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (Date.now() - windowStart >= messageWindowMs) { count = 0; windowStart = Date.now(); }
            if (++count > maxMessages) { ws.close(4008, 'Too many messages'); return; }
            receive(ws, data, binary);
        });
        ws.on('close', () => {
            const p = clients.get(ws); clients.delete(ws);
            if (!p || p.ws !== ws) return;
            p.ws = null; p.expiresAt = Date.now() + graceMs;
            p.timer = setTimeout(() => remove(p), graceMs); p.timer.unref();
            const lobby = lobbies.get(p.lobbyId); if (lobby) broadcast(lobby);
        });
    });
    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.alive) ws.terminate();
            else { ws.alive = false; ws.ping(() => {}); }
        }
    }, heartbeatMs);
    heartbeat.unref();
    return { wss, lobbies, sessions, async close() {
        clearInterval(heartbeat);
        for (const p of sessions.values()) invalidate(p);
        for (const ws of wss.clients) ws.terminate();
        await new Promise(resolve => wss.close(resolve));
    } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { wss } = createGameServer({ port: Number(process.env.PORT || 8080) });
    wss.on('listening', () => console.log(`UNO server listening on ${wss.address().port}`));
}
