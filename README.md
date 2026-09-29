# 🃏 UNO Web Game

A modern, real-time multiplayer UNO card game built with WebSockets, featuring beautiful UI, advanced lobby system, and smooth gameplay experience.

![UNO Game](https://img.shields.io/badge/Game-UNO-red?style=for-the-badge)
![WebSocket](https://img.shields.io/badge/WebSocket-Real--time-blue?style=for-the-badge)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow?style=for-the-badge)

## 🎮 Features

### 🏆 Core Game Features

- **Real-time multiplayer** gameplay with WebSocket connections
- **Multiple concurrent lobbies** with unique 6-character lobby IDs
- **Automatic UNO detection** - no manual UNO button needed
- **Visual wild card color picker** with intuitive click interface
- **Multiple card play** - select and play multiple cards of the same number
- **Smart turn indicators** with pulsing animations for active players
- **Automatic game state management** and win detection

### 🎨 Modern UI/UX

- **Beautiful gradient design** with smooth animations
- **Responsive layout** that works on desktop and mobile
- **Click-to-copy lobby IDs** for easy sharing
- **Form validation** with helpful error messages
- **Smooth transitions** between game states
- **Professional card animations** and hover effects

### 🏠 Advanced Lobby System

- **Unique lobby IDs** for private games with friends
- **Rejoin capability** using a secret sessionStorage token
- **Lobby creator indicators** with crown emoji (👑)
- **Name uniqueness validation** within each lobby
- **Leave lobby functionality** with confirmation
- **Real-time player status updates**

### 🃏 Game Mechanics

- **Standard UNO rules** with all special cards
- **Pick-up card logic** (Draw 2, Wild +4) with turn skipping
- **Reverse and Skip cards** with proper turn management
- **Wild card color selection** with visual feedback
- **Automatic card validation** and move checking

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v16 or higher)
- **pnpm** package manager

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd uno
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Start the game server**

   ```bash
   pnpm start
   ```

4. **Start the frontend in a second terminal**

   Run `pnpm serve`, then open `http://localhost:3000`.

### Quick Start

1. Enter your name (2-20 characters, must be unique in lobby)
2. Leave lobby ID empty to create a new lobby, or enter an existing lobby ID
3. Click "Join Game"
4. Share the lobby ID with friends
5. Click "Ready" when all players have joined
6. Game starts automatically when all players are ready!

## 📋 Game Rules

### 🎯 Objective

Be the first player to get rid of all your cards!

### 🃏 Card Types

- **Number Cards (0-9)**: Match color or number
- **Skip Cards**: Next player loses their turn
- **Reverse Cards**: Reverse the direction of play
- **Draw 2 Cards**: Next player draws 2 cards and loses their turn
- **Wild Cards**: Change the color, can be played anytime
- **Wild +4 Cards**: Change color AND next player draws 4 cards and loses their turn

### 🎮 Gameplay

1. **Starting**: Each player gets 7 cards
2. **Playing**: Match the top card by color, number, or play a wild card
3. **Drawing**: If you can't play, draw a card from the deck
4. **UNO**: Automatically announced when you have 1 card left
5. **Multiple Cards**: You can play multiple cards of the same number in one turn

6. **Winning**: First player to play all cards wins!

### 🔄 Special Card Effects

- **Skip**: Skips the next player's turn
- **Reverse**: Changes direction of play
- **Draw 2**: Next player draws 2 cards and is skipped
- **Wild**: Choose any color to continue play
- **Wild +4**: Choose color, next player draws 4 cards and is skipped

## 🛠 Development

### 📁 Project Structure

```
uno/
├── client.js          # Frontend game logic and UI
├── server.js          # WebSocket server and game engine
├── index.html         # Game interface
├── style.css          # Modern UI styling
├── package.json       # Dependencies and scripts
├── vite.config.js     # Vite configuration
└── test/
    ├── setup.js       # Test environment setup
    └── client.test.js # Frontend tests
```

### 🔧 Available Scripts

```bash
# Start the WebSocket server
pnpm start

# Run tests once
pnpm test:run

# Run tests in watch mode
pnpm test

# Run tests with UI
pnpm test:ui
```

### 🧪 Testing

The project uses **Vitest** for testing with comprehensive coverage of:

- HTML structure validation
- Form element functionality
- WebSocket connection mocking
- UI component presence
- Game feature validation

Run tests with: `pnpm test:run`

### 🏗 Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend**: Node.js with WebSocket Server
- **Testing**: Vitest + JSDOM for DOM testing
- **Build Tool**: Vite for modern development experience
- **Package Manager**: pnpm for fast, efficient installs

### 🔌 WebSocket API

#### Client → Server Messages

```javascript
{ action: 'join', name: 'PlayerName', lobbyId?: 'ABC123' }
{ action: 'ready' }
{ action: 'play', card: { color: 'red', type: '5' } }
{ action: 'play_multiple', cards: [...], indices: [...] }
{ action: 'draw' }

{ action: 'leave' }
```

#### Server → Client Messages

```javascript
{ action: 'players', players: [...], turn: 0, lobbyId: 'ABC123' }
{ action: 'start', players: [...], hand: [...], discardPile: [...] }
{ action: 'update', players: [...], hand: [...], discardPile: [...] }
{ action: 'win', winner: 'PlayerName' }
{ action: 'error', message: 'Error description' }
```

### 🎨 Styling Architecture

- **Modern CSS** with custom properties and gradients
- **Flexbox layouts** for responsive design
- **CSS animations** for smooth interactions
- **Component-based styling** for maintainability
- **Mobile-first responsive design** with breakpoints

### 🔧 Special Features

#### Multiple Card Selection

Players can select and play multiple cards of the same number in a single turn:

1. Click a card that has duplicates → prompted to select multiple
2. Enter selection mode → click cards to select/deselect
3. "Play X cards" and "Cancel Selection" buttons appear below hand
4. Choose play order for selected cards

#### Auto-UNO System

- Automatically detects when player has 1 card
- Also detects when player has multiple cards of same number (can play all)
- No manual UNO button needed
- Visual indicators show UNO status

#### Lobby Persistence

- Uses sessionStorage for the reconnect token; localStorage remembers form hints
- Automatic rejoin attempt on page reload
- Lobby IDs persist until manually cleared

#### Smart Card Validation

- Server validates all moves before applying
- Prevents cheating and invalid plays
- Handles edge cases like empty deck, invalid cards
- Proper turn management with skip/reverse logic

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Enjoy playing UNO!** 🎉🃏

## Multiplayer foundation

The vanilla JavaScript frontend is served by Vite; Node owns all lobby, player,
session and game state in memory using the existing ws dependency. No database
is required. Start both processes in separate terminals with `pnpm start` and
`pnpm serve`, then open http://localhost:3000 in two tabs.

### Joining and reconnecting

- A blank code creates a lobby. A supplied code must identify an existing waiting
  lobby. Names are 2–20 characters and unique within the lobby.
- The server sends a `joined` acknowledgement with the player ID, lobby snapshot
  and a cryptographically random bearer token. Ready stays disabled until then.
- The client sends `{ action: 'rejoin', token }` on refresh or network reconnect.
  Success restores the same seat, ready state, hand and turn.
- The secret token lives in sessionStorage, surviving refresh while allowing
  independent tabs to play separately. localStorage holds only name/code hints.
- A copied token takes over the same seat: the old socket is detached and closed,
  and its client stops retrying. Repeated reconnects never add duplicate players.
- A disconnected seat is reserved for 60 seconds after disconnect detection.
  A 15-second heartbeat detects broken connections. An absent player's turn waits
  until they return or their reservation expires.
- Expiry/leave removes the seat and repairs the turn index. With fewer than two
  players, the game ends and the remaining player returns to the waiting lobby.
  Empty lobbies and expired tokens are removed. Winning invalidates all sessions
  and returns everyone to joining, preserving the original end-of-game flow.
- Server restarts lose games and tokens. Closing a tab loses its session token.
  Expired or otherwise unrestorable sessions return cleanly to the join form.

### Protocol and privacy

Public player records contain only id, name, ready, isCreator, connected, uno and
cardCount. Full hands appear only in the owning player's private snapshot.
The joined, players, start and update snapshots include started and turn; active
snapshots include the recipient's hand and discard pile. Tokens appear only in
that player's joined acknowledgement.

Actions require valid membership and the appropriate phase/turn. Single and
multiple plays are checked against the actual hand, including duplicate counts,
before any mutation. Extra browser-supplied card properties never enter game
state. Wild colors must be red, yellow, green or blue. Existing same-type multiple
plays, multiplied effects and auto-UNO behavior remain. Discards are recycled
when the deck empties, and every played card is retained. Lobbies are limited to
ten players so the 108-card deck can deal every starting hand.

Errors contain action `error`, a machine-readable code and a user-facing message.
Malformed JSON/envelopes and oversized messages are covered by regression tests;
transport/protocol errors disconnect only the affected socket.

### Validation and hosting limits

Run `pnpm test:run` and `pnpm build`. Tests execute the actual client script in
JSDOM and use real WebSocket connections with isolated ephemeral-port servers.
Manual verification used two browser tabs: create, join by code, ready, start,
refresh and continue taking turns.

The browser connects to its current hostname on port 8080, using ws for HTTP and
wss for HTTPS. PORT configures the backend listener; changing the public port
also requires changing the frontend URL or providing a proxy. Public hosting
needs HTTPS and a TLS WebSocket reverse proxy at that endpoint. Vite's development
server is not a production host. Bearer tokens must remain private.

Still outside this change: durable games, deployment configuration, rate limits,
origin restrictions and stronger lobby access controls. Lobby codes are simple
invitations, not account authentication. No UI redesign or new house rules were
introduced.
