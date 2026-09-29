const nameInput = document.getElementById('name');
const lobbyIdInput = document.getElementById('lobby-id');
const joinButton = document.getElementById('join');
const playersList = document.getElementById('players');
const readyButton = document.getElementById('ready');
const startButton = document.getElementById('start-game');
const startHelp = document.getElementById('start-help');
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const opponentHandsDiv = document.getElementById('opponent-hands');
const playerHandDiv = document.getElementById('player-hand');
const discardPileDiv = document.getElementById('discard-pile');
const drawCardButton = document.getElementById('draw-card');
const drawPrompt = document.getElementById('draw-prompt');

const turnIndicator = document.getElementById('turn-indicator');
const turnText = document.getElementById('turn-text');
const wildColorPicker = document.getElementById('wild-color-picker');
const colorOptions = document.getElementById('color-options');
const lobbyInfo = document.getElementById('lobby-info');
const telegramInviteButton = document.getElementById('invite-telegram');
const currentLobbyId = document.getElementById('current-lobby-id');

let myId;
let ws;
let currentTurn = -1;
let players = [];
let pendingWildCard = null;
let selectedCards = [];
let isSelectingMultiple = false;
let myHand = [];
let topCard = null;
let myLobbyId = null;

// Add these elements to the existing DOM references
const joinFormContainer = document.createElement('div');
joinFormContainer.id = 'join-form-container';

let joined = false;
let reconnectTimer;
let reconnectAttempts = 0;
let sessionToken = sessionStorage.getItem('unoSessionToken');
const statusText = document.getElementById('connection-status');
function setControls() {
    const inLobby = joined && gameDiv.style.display === 'none';
    const me = players.find(player => player.id === myId);
    startButton.hidden = !inLobby || !me?.isCreator;
    startButton.disabled = !inLobby || !me?.isCreator || !canSendMessage()
        || players.length < 2 || !players.every(player => player.ready && player.connected);
    readyButton.textContent = me?.ready ? 'Not Ready' : 'Ready';
    startHelp.textContent = !inLobby ? '' : me?.isCreator
        ? 'Wait until everyone has joined and is Ready, then press Start Game.'
        : 'When everyone is Ready, the lobby creator can start the game.';
    telegramInviteButton.disabled = !joined || !canSendMessage() || gameDiv.style.display !== 'none';
    readyButton.disabled = !joined || !canSendMessage() || gameDiv.style.display !== 'none';
    joinButton.disabled = !canSendMessage() || joined || !!sessionToken;
    drawCardButton.disabled = !joined || !canSendMessage();
    const needsDraw = joined && canSendMessage() && gameDiv.style.display !== 'none'
        && players[currentTurn]?.id === myId && topCard
        && !myHand.some(card => card.type === 'wild' || card.type === 'wild4'
            || card.color === topCard.color || card.type === topCard.type);
    drawPrompt.textContent = needsDraw ? 'You have no playable cards. Click Draw Card to take a card.' : '';
}
function connect() {
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host + '/ws');
    setControls();
    ws.onopen = () => {
        reconnectAttempts = 0;
        statusText.textContent = sessionToken ? 'Restoring your session…' : 'Connected. Join a lobby.';
        if (sessionToken) sendMessage({ action: 'rejoin', token: sessionToken });
        else { nameInput.disabled = false; lobbyIdInput.disabled = false; }
        setControls();
    };
    ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.action === 'error') {
            if (['SESSION_EXPIRED', 'SESSION_REPLACED', 'NOT_JOINED'].includes(message.code)) resetGameState();
            if (!joined) { nameInput.disabled = false; lobbyIdInput.disabled = false; }
            statusText.textContent = message.message;
            setControls();
            return;
        }
        if (message.action === 'joined') {
            joined = true; myId = message.id; myLobbyId = message.lobbyId;
            sessionToken = message.token;
            sessionStorage.setItem('unoSessionToken', sessionToken);
            nameInput.value = message.players.find(p => p.id === myId).name;
            statusText.textContent = 'Connected to lobby ' + myLobbyId;
        }
        if (['joined', 'players', 'start', 'update'].includes(message.action) && joined) {
            players = message.players; currentTurn = message.turn;
            selectedCards = []; isSelectingMultiple = false; hideWildColorPicker();
            lobbyDiv.style.display = message.started ? 'none' : 'block';
            gameDiv.style.display = message.started ? 'block' : 'none';
            updatePlayers(players, currentTurn); showLobbyInfo(message.lobbyId);
            if (message.started) {
                myHand = message.hand; updateHand(myHand); updateDiscardPile(message.discardPile);
            }
            updateTurnIndicator(); setControls();
        }
        if (message.action === 'game_ended') statusText.textContent = message.message;
        if (message.action === 'left') resetGameState();
        if (message.action === 'win') { alert(message.winner + ' wins!'); resetGameState(); }
    };
    ws.onclose = event => {
        joined = false; setControls();
        if (event.code === 4003) {
            statusText.textContent = 'Family access expired. Reload to sign in again.';
            return;
        }
        if (event.code === 4001) {
            resetGameState();
            statusText.textContent = 'This session was opened in another tab. Reload to join again.';
            return;
        }
        statusText.textContent = 'Disconnected. Reconnecting…';
        const delay = Math.min(15000, 1000 * 2 ** Math.min(reconnectAttempts++, 4));
        reconnectTimer = setTimeout(connect, delay + Math.random() * 500);
    };
    ws.onerror = () => { statusText.textContent = 'Connection interrupted. Retrying…'; };
}
function canSendMessage() { return ws && ws.readyState === WebSocket.OPEN; }
function sendMessage(message) {
    if (!canSendMessage() || (!joined && !['join', 'rejoin'].includes(message.action))) {
        statusText.textContent = 'Wait for your connection and lobby to be confirmed.';
        return false;
    }
    ws.send(JSON.stringify(message));
    return true;
}

function updateTurnIndicator() {
    if (currentTurn === -1 || !players.length) {
        turnText.textContent = 'Waiting for game to start...';
        turnIndicator.classList.remove('my-turn');
        return;
    }

    const currentPlayer = players[currentTurn];
    const isMyTurn = currentPlayer && currentPlayer.id === myId;
    
    if (isMyTurn) {
        turnText.textContent = 'Your turn!';
        turnIndicator.classList.add('my-turn');
    } else {
        turnText.textContent = `${currentPlayer ? currentPlayer.name : 'Unknown'}'s turn`;
        turnIndicator.classList.remove('my-turn');
    }
}

function showLobbyInfo(lobbyId) {
    if (lobbyId) {
        currentLobbyId.textContent = lobbyId;
        
        // Find the creator and update the lobby info
        const creator = players.find(p => p.isCreator);
        const lobbyInfoTitle = document.querySelector('#lobby-info h3');
        lobbyInfoTitle.replaceChildren('Lobby: ');
        const code = document.createElement('span');
        code.id = 'current-lobby-id'; code.textContent = lobbyId;
        code.style.cursor = 'pointer'; code.title = 'Click to copy lobby ID';
        code.addEventListener('click', copyLobbyId); lobbyInfoTitle.append(code);
        if (creator) {
            const byline = document.createElement('small');
            byline.textContent = 'Created by ' + creator.name + ' 👑';
            lobbyInfoTitle.append(document.createElement('br'), byline);
        }
        lobbyInfo.style.display = 'block';
        hideJoinForm();
        
        localStorage.setItem('unoLobbyId', lobbyId);
        localStorage.setItem('unoPlayerName', nameInput.value);
    }
}

function attemptRejoin() {
    const savedLobbyId = localStorage.getItem('unoLobbyId');
    const savedPlayerName = localStorage.getItem('unoPlayerName');
    
    if (savedLobbyId && savedPlayerName) {
        lobbyIdInput.value = savedLobbyId;
        nameInput.value = savedPlayerName;
    }
}

function resetGameState() {
    joined = false; sessionToken = null;
    sessionStorage.removeItem('unoSessionToken');
    readyButton.disabled = true;
    // Reset to lobby
    lobbyDiv.style.display = 'block';
    gameDiv.style.display = 'none';
    
    // Reset form
    nameInput.value = '';
    nameInput.disabled = false;
    joinButton.disabled = false;
    lobbyIdInput.disabled = false;
    
    // Clear game state
    myId = null;
    currentTurn = -1;
    players = [];
    pendingWildCard = null;
    selectedCards = [];
    isSelectingMultiple = false;
    myHand = [];
    topCard = null;
    myLobbyId = null;
    
    // Hide wild color picker and lobby info
    wildColorPicker.style.display = 'none';
    hideLobbyInfo();
    
    // Clear players list
    playersList.innerHTML = '';
    
    // Reset turn indicator
    turnText.textContent = 'Waiting for game to start...';
    turnIndicator.classList.remove('my-turn');
    
    // Clear localStorage
    localStorage.removeItem('unoLobbyId');
    localStorage.removeItem('unoPlayerName');
    setControls();
}

function updatePlayers(players, turn) {
    opponentHandsDiv.innerHTML = '';
    playersList.innerHTML = '';
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        const playerDiv = document.createElement('div');
        playerDiv.classList.add('player');
        if (i === turn) {
            playerDiv.classList.add('active');
        }
        
        // Check for UNO condition (1 card or multiple same-number cards)
        if (player.uno) {
            playerDiv.classList.add('uno');
        }
        
        // Add creator styling to opponent display too
        if (player.isCreator) {
            playerDiv.classList.add('creator');
        }
        
        let displayText = player.name;
        if (player.isCreator) {
            displayText += ' 👑';
        }
        
        if (Number.isInteger(player.cardCount)) {
            playerDiv.textContent = `${displayText} (${player.cardCount} cards)`;
        } else {
            playerDiv.textContent = displayText;
        }

        if (player.id !== myId) {
            opponentHandsDiv.appendChild(playerDiv);
        }

        const li = document.createElement('li');
        let playerText = player.name;
        
        // Add creator indicator
        if (player.isCreator) {
            playerText += ' 👑';
        }
        
        // Add ready status
        if (player.connected === false) {
            playerText += ' (Reconnecting…)';
        } else if (player.ready) {
            playerText += ' (Ready)';
        }
        
        li.textContent = playerText;
        
        if (i === turn) {
            li.style.fontWeight = 'bold';
        }
        
        // Add special styling for creator
        if (player.isCreator) {
            li.classList.add('creator');
        }
        
        playersList.appendChild(li);
    }
}

function isUnoCondition(hand) {
    if (hand.length === 1) return true;
    
    // Check if all cards have the same number/type
    if (hand.length > 1) {
        const firstCard = hand[0];
        return hand.every(card => card.type === firstCard.type && card.type !== 'wild' && card.type !== 'wild4');
    }
    
    return false;
}

function updateHand(hand) {
    playerHandDiv.innerHTML = '';
    
    for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        const cardDiv = createCard(card);
        
        // Add card index for identification
        cardDiv.dataset.cardIndex = i;
        
        // Check if card is selected
        if (selectedCards.some(selected => selected.index === i)) {
            cardDiv.classList.add('selected');
        }
        
        cardDiv.addEventListener('click', () => handleCardClick(card, i, hand));
        playerHandDiv.appendChild(cardDiv);
    }
    
    // Add play selected cards button if multiple cards are selected (below the hand)
    if (selectedCards.length > 1) {
        const playButton = document.createElement('button');
        playButton.textContent = `Play ${selectedCards.length} cards`;
        playButton.classList.add('play-multiple-btn');
        playButton.addEventListener('click', playSelectedCards);
        playerHandDiv.appendChild(playButton);
        
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel Selection';
        cancelButton.classList.add('cancel-selection-btn');
        cancelButton.addEventListener('click', clearSelection);
        playerHandDiv.appendChild(cancelButton);
    }
}

function handleCardClick(card, cardIndex, hand) {
    // Check if we're selecting multiple cards
    if (isSelectingMultiple) {
        toggleCardSelection(card, cardIndex, hand);
    } else {
        // Check if this card can be played with others of the same type
        const sameTypeCards = hand.filter((c, i) => 
            c.type === card.type && 
            c.type !== 'wild' && 
            c.type !== 'wild4' && 
            i !== cardIndex
        );
        
        if (sameTypeCards.length > 0) {
            // Ask user if they want to play multiple cards
            if (confirm(`You have ${sameTypeCards.length + 1} cards of type "${card.type}". Do you want to select multiple cards to play?`)) {
                startMultipleSelection(card, cardIndex);
                return;
            }
        }
        
        // Single card play
        if (card.type === 'wild' || card.type === 'wild4') {
            showWildColorPicker(card);
        } else {
            sendMessage({ action: 'play', card: card });
        }
    }
}

function startMultipleSelection(card, cardIndex) {
    isSelectingMultiple = true;
    selectedCards = [{ card, index: cardIndex }];
    updateHand(getCurrentHand());
}

function toggleCardSelection(card, cardIndex, hand) {
    const existingIndex = selectedCards.findIndex(selected => selected.index === cardIndex);
    
    if (existingIndex >= 0) {
        // Remove from selection
        selectedCards.splice(existingIndex, 1);
    } else {
        // Add to selection if same type as first selected card
        if (selectedCards.length === 0 || selectedCards[0].card.type === card.type) {
            selectedCards.push({ card, index: cardIndex });
        } else {
            alert('You can only select cards of the same type!');
            return;
        }
    }
    
    // If no cards selected, exit multiple selection mode
    if (selectedCards.length === 0) {
        isSelectingMultiple = false;
    }
    
    updateHand(hand);
}

function playSelectedCards() {
    if (selectedCards.length === 0) return;
    
    const firstCard = selectedCards[0].card;
    if (firstCard.type === 'wild' || firstCard.type === 'wild4') {
        // For wild cards, we need to pick a color first
        pendingWildCard = selectedCards.map(s => s.card);
        wildColorPicker.style.display = 'block';
    } else {
        // Send multiple cards to server
        sendMessage({ 
            action: 'play_multiple', 
            cards: selectedCards.map(s => s.card),
            indices: selectedCards.map(s => s.index)
        });
        clearSelection();
    }
}

function clearSelection() {
    selectedCards = [];
    isSelectingMultiple = false;
    updateHand(getCurrentHand());
}

function getCurrentHand() {
    return myHand;
}

function showWildColorPicker(card) {
    pendingWildCard = card;
    wildColorPicker.style.display = 'block';
}

function hideWildColorPicker() {
    wildColorPicker.style.display = 'none';
    pendingWildCard = null;
}

function updateDiscardPile(discardPile) {
    discardPileDiv.innerHTML = '';
    const card = discardPile[discardPile.length - 1];
    topCard = card;
    const cardDiv = createCard(card);
    discardPileDiv.appendChild(cardDiv);
}

function createCard(card) {
    const cardDiv = document.createElement('div');
    cardDiv.classList.add('card');
    
    // Set data attributes for CSS styling
    cardDiv.setAttribute('data-color', card.color || 'black');
    cardDiv.setAttribute('data-type', card.type);
    
    // Create card content structure
    const cardContent = document.createElement('div');
    cardContent.classList.add('card-content');
    
    // Determine card display values
    let cornerNumber, cornerSymbol, centerContent;
    
    if (card.type === 'wild') {
        cornerNumber = 'W';
        cornerSymbol = '★';
        centerContent = 'W';
    } else if (card.type === 'wild4') {
        cornerNumber = '+4';
        cornerSymbol = '★';
        centerContent = '+4';
    } else if (card.type === 'draw2') {
        cornerNumber = '+2';
        cornerSymbol = '2';
        centerContent = '+2';
    } else if (card.type === 'skip') {
        cornerNumber = 'Ø';
        cornerSymbol = 'Ø';
        centerContent = 'Ø';
    } else if (card.type === 'reverse') {
        cornerNumber = '⇄';
        cornerSymbol = '⇄';
        centerContent = '⇄';
    } else {
        cornerNumber = card.type.toUpperCase();
        cornerSymbol = card.type.toUpperCase();
        centerContent = card.type.toUpperCase();
    }
    
    // Create top-left corner
    const topLeftCorner = document.createElement('div');
    topLeftCorner.classList.add('card-corner', 'top-left');
    
    const topLeftNumber = document.createElement('div');
    topLeftNumber.classList.add('card-corner-number');
    topLeftNumber.textContent = cornerNumber;
    
    topLeftCorner.appendChild(topLeftNumber);
    
    // Create bottom-right corner
    const bottomRightCorner = document.createElement('div');
    bottomRightCorner.classList.add('card-corner', 'bottom-right');
    
    const bottomRightNumber = document.createElement('div');
    bottomRightNumber.classList.add('card-corner-number');
    bottomRightNumber.textContent = cornerNumber;
    
    bottomRightCorner.appendChild(bottomRightNumber);
    
    // Create center ellipse
    const cardCenter = document.createElement('div');
    cardCenter.classList.add('card-center');
    
    const cardCenterContent = document.createElement('div');
    cardCenterContent.classList.add('card-center-content');
    
    const centerElement = document.createElement('div');
    centerElement.classList.add('card-center-number');
    centerElement.textContent = centerContent;
    
    cardCenterContent.appendChild(centerElement);
    cardCenter.appendChild(cardCenterContent);
    
    // Assemble the card
    cardContent.appendChild(topLeftCorner);
    cardContent.appendChild(bottomRightCorner);
    cardContent.appendChild(cardCenter);
    cardDiv.appendChild(cardContent);
    
    return cardDiv;
}

// Update the color picker to handle multiple wild cards
colorOptions.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-option')) {
        const color = e.target.dataset.color;
        if (pendingWildCard) {
            if (Array.isArray(pendingWildCard)) {
                // Multiple wild cards
                sendMessage({ 
                    action: 'play_multiple', 
                    cards: pendingWildCard.map(card => ({ ...card, color: color })),
                    indices: selectedCards.map(s => s.index)
                });
                clearSelection();
            } else {
                // Single wild card
                sendMessage({ action: 'play', card: { ...pendingWildCard, color: color } });
            }
            hideWildColorPicker();
        }
    }
});

joinButton.addEventListener('click', () => {
    if (!canSendMessage() || joined || sessionToken) return;
    const name = nameInput.value.trim();
    const lobbyId = lobbyIdInput.value.trim().toUpperCase();
    
    if (!name) {
        alert('Please enter your name');
        return;
    }
    
    if (name.length < 2) {
        alert('Name must be at least 2 characters long');
        return;
    }
    
    if (name.length > 20) {
        alert('Name must be 20 characters or less');
        return;
    }
    
    // Disable form to prevent multiple submissions
    nameInput.disabled = true;
    lobbyIdInput.disabled = true;
    joinButton.disabled = true;
    
    const message = { action: 'join', name: name };
    if (lobbyId) {
        message.lobbyId = lobbyId;
    }
    sendMessage(message);
});

readyButton.addEventListener('click', () => {
    sendMessage({ action: 'ready' });
});
startButton.addEventListener('click', () => {
    if (!startButton.disabled) sendMessage({ action: 'start' });
});

telegramInviteButton.addEventListener('click', () => {
    if (!joined || !canSendMessage() || !myLobbyId || gameDiv.style.display !== 'none') return;
    const shareUrl = new URL('https://t.me/share/url');
    // Share only the public game address and lobby code, never session credentials.
    shareUrl.searchParams.set('url', location.origin + '/');
    shareUrl.searchParams.set('text', `Anyone up for UNO? Come join my lobby!\nLobby code: ${myLobbyId}\nEnter the family password, join with this code, and press Ready.`);
    window.open(shareUrl.href, '_blank', 'noopener,noreferrer');
});

drawCardButton.addEventListener('click', () => {
    sendMessage({ action: 'draw' });
});

document.addEventListener('DOMContentLoaded', () => {
    connect();
    attemptRejoin();
    
    // Create form container and move elements
    const nameDiv = nameInput.parentNode;
    const lobbyDiv = lobbyIdInput.parentNode;
    
    joinFormContainer.appendChild(nameDiv);
    joinFormContainer.appendChild(lobbyDiv);
    joinFormContainer.appendChild(joinButton);
    
    // Insert before players list
    const playersUl = document.getElementById('players');
    playersUl.parentNode.insertBefore(joinFormContainer, playersUl);
    
    // Add click-to-copy functionality to lobby ID
    const lobbyIdSpan = document.getElementById('current-lobby-id');
    if (lobbyIdSpan) {
        lobbyIdSpan.style.cursor = 'pointer';
        lobbyIdSpan.title = 'Click to copy lobby ID';
        lobbyIdSpan.addEventListener('click', copyLobbyId);
    }
});

function copyLobbyId() {
    const lobbyIdSpan = document.getElementById('current-lobby-id');
    const lobbyId = lobbyIdSpan.textContent;
    
    // Use the modern clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lobbyId).then(() => {
            showCopyFeedback(lobbyIdSpan);
        }).catch(() => {
            // Fallback for older browsers
            fallbackCopyToClipboard(lobbyId, lobbyIdSpan);
        });
    } else {
        // Fallback for older browsers
        fallbackCopyToClipboard(lobbyId, lobbyIdSpan);
    }
}

function fallbackCopyToClipboard(text, element) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showCopyFeedback(element);
    } catch (err) {
        console.error('Failed to copy lobby ID:', err);
    }
    
    document.body.removeChild(textArea);
}

function showCopyFeedback(element) {
    const originalText = element.textContent;
    element.textContent = 'COPIED!';
    element.style.background = 'rgba(72, 187, 120, 0.3)';
    
    setTimeout(() => {
        element.textContent = originalText;
        element.style.background = 'rgba(255,255,255,0.2)';
    }, 1000);
}

function createLeaveLobbyButton() {
    const leaveLobbyBtn = document.createElement('button');
    leaveLobbyBtn.id = 'leave-lobby';
    leaveLobbyBtn.textContent = 'Leave Lobby';
    leaveLobbyBtn.classList.add('leave-lobby-btn');
    leaveLobbyBtn.addEventListener('click', leaveLobby);
    return leaveLobbyBtn;
}

function leaveLobby() {
    if (confirm('Are you sure you want to leave the lobby?')) sendMessage({ action: 'leave' });
}

function showJoinForm() {
    joinFormContainer.style.display = 'block';
    
    // Remove leave lobby button if it exists
    const existingLeaveBtn = document.getElementById('leave-lobby');
    if (existingLeaveBtn) {
        existingLeaveBtn.remove();
    }
}

function hideJoinForm() {
    joinFormContainer.style.display = 'none';
    
    // Add leave lobby button if it doesn't exist
    let leaveLobbyBtn = document.getElementById('leave-lobby');
    if (!leaveLobbyBtn) {
        leaveLobbyBtn = createLeaveLobbyButton();
        // Insert after lobby info
        const lobbyInfo = document.getElementById('lobby-info');
        lobbyInfo.parentNode.insertBefore(leaveLobbyBtn, lobbyInfo.nextSibling);
    }
}

function hideLobbyInfo() {
    lobbyInfo.style.display = 'none';
    showJoinForm();
}
