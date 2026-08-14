const $ = (selector) => document.querySelector(selector);
const homeView = $("#home-view");
const lobbyView = $("#lobby-view");
const gameView = $("#game-view");
const connectionLabel = $("#connection-label");
const roomPill = $("#room-pill");
const toastElement = $("#toast");

const suitSymbols = { SPADES: "♠", HEARTS: "♥", DIAMONDS: "♦", CLUBS: "♣" };
const suitClasses = { SPADES: "spades", HEARTS: "hearts", DIAMONDS: "diamonds", CLUBS: "clubs" };
const handNames = {
  ROYAL_FLUSH: "Royal Flush",
  STRAIGHT_FLUSH: "Straight Flush",
  FOUR_OF_A_KIND: "Four of a Kind",
  FULL_HOUSE: "Full House",
  FLUSH: "Flush",
  STRAIGHT: "Straight",
  THREE_OF_A_KIND: "Three of a Kind",
  TWO_PAIR: "Two Pair",
  ONE_PAIR: "One Pair",
  HIGH_CARD: "High Card",
};
const avatarColors = ["#7364f2", "#d35c77", "#2aa68e", "#d3923e", "#438bc7", "#9b63c8"];
const phaseNames = {
  DRAFT_BIDDING: "DRAFT · SECRET BID",
  DRAFT_PICKING: "DRAFT · PICK A CARD",
  POKER_BETTING: "POKER BETTING",
  SHOWDOWN: "SHOWDOWN",
  HAND_COMPLETE: "HAND RESULT",
};

const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
// Shown when a game state arrives without fields this client expects, which means the
// deployed game server is older than this page.
const OUTDATED_VERSION_WARNING = '<div class="version-warning"><b>UPDATE REQUIRED</b><span>Reload this page, then create a new room. If it happens again, the game server needs redeploying.</span></div>';

let socket;
let currentState = null;
let currentSession = null;
let reconnectDelay = RECONNECT_BASE_MS;
let toastTimer;
let rulesLoaded = false;
let logHidden = localStorage.getItem("draft-holdem-hide-log") !== "false";
let previousGameState = null;
let guideSlides = [];
let guideSlideIndex = 0;
let pendingDraftBid = { key: null, value: 0 };
const soundSettingsKey = "draft-holdem-sound-settings";
const audioSources = {
  music: "/audio/background.mp3",
  chips: "/audio/placing-chip.mp3",
  cards: "/audio/placing-card.mp3",
  allIn: "/audio/all-in.mp3",
};

function loadSoundSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(soundSettingsKey) || "null");
    return {
      music: Math.max(0, Math.min(1, Number(saved?.music ?? 0.25))),
      effects: Math.max(0, Math.min(1, Number(saved?.effects ?? 0.75))),
    };
  } catch {
    return { music: 0.25, effects: 0.75 };
  }
}

const soundSettings = loadSoundSettings();
const backgroundMusic = new Audio();
const soundEffects = {
  chips: new Audio(audioSources.chips),
  cards: new Audio(audioSources.cards),
  allIn: new Audio(audioSources.allIn),
};
let audioUnlocked = false;
backgroundMusic.loop = true;
backgroundMusic.preload = "none";
backgroundMusic.src = audioSources.music;
Object.values(soundEffects).forEach((sound) => { sound.preload = "auto"; });

function syncBackgroundMusic() {
  backgroundMusic.volume = soundSettings.music;
  if (!audioUnlocked || soundSettings.music === 0) {
    if (soundSettings.music === 0) backgroundMusic.pause();
    return;
  }
  void backgroundMusic.play().catch(() => {});
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  syncBackgroundMusic();
}

function playSoundEffect(name) {
  const sound = soundEffects[name];
  if (!sound || soundSettings.effects === 0) return;
  sound.volume = soundSettings.effects;
  sound.currentTime = 0;
  void sound.play().catch(() => {});
}

function updateSoundSettingsUi() {
  const settings = [["music", "#music-volume", "#music-volume-output"], ["effects", "#effects-volume", "#effects-volume-output"]];
  for (const [key, inputSelector, outputSelector] of settings) {
    const percentage = Math.round(soundSettings[key] * 100);
    $(inputSelector).value = percentage;
    $(outputSelector).textContent = percentage === 0 ? "MUTED" : `${percentage}%`;
  }
}

function updateSoundSetting(key, percentage) {
  soundSettings[key] = Math.max(0, Math.min(1, percentage / 100));
  localStorage.setItem(soundSettingsKey, JSON.stringify(soundSettings));
  updateSoundSettingsUi();
  if (key === "music") syncBackgroundMusic();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;",
  })[character]);
}

function initials(name) {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.toggle("error", error);
  toastElement.classList.add("show");
  toastTimer = setTimeout(() => toastElement.classList.remove("show"), 3000);
}

function setConnection(status, label) {
  connectionLabel.className = `topbar-center ${status}`;
  connectionLabel.querySelector("span:last-child").textContent = label;
}

function send(type, payload = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("Connection to the host is unavailable", true);
    return;
  }
  socket.send(JSON.stringify({ type, ...payload }));
}

function sessionKey(code) {
  return `draft-holdem-session-${String(code).toUpperCase()}`;
}

function storedSession(code) {
  return JSON.parse(localStorage.getItem(sessionKey(code)) || "null");
}

// This page is served from Vercel while the game server runs on its own host, so the
// endpoint comes from public/config.js: the committed default points at `wrangler dev`
// and the Vercel build writes the deployed URL in.
function gameServerSocketUrl(path) {
  const configured = window.DRAFT_HOLDEM_CONFIG?.gameServerUrl;
  if (!configured) throw new Error("No game server is configured for this site");
  const { protocol, host } = new URL(configured);
  const scheme = protocol === "https:" || protocol === "wss:" ? "wss:" : "ws:";
  return `${scheme}//${host}${path}`;
}

/**
 * Every room has its own address on the game server, so a socket belongs to exactly one
 * room: `/room/new` mints a code and `/room/CODE` joins or resumes an existing one.
 * `announce` runs once the socket opens and states this connection's intent.
 */
function connect(path, announce) {
  let url;
  try {
    url = gameServerSocketUrl(path);
  } catch (error) {
    setConnection("offline", "No game server");
    showToast(error.message, true);
    return;
  }
  setConnection("", "Connecting…");
  socket = new WebSocket(url);
  let opened = false;
  socket.addEventListener("open", () => {
    opened = true;
    reconnectDelay = RECONNECT_BASE_MS;
    setConnection("online", "Connected to host");
    announce();
  });
  socket.addEventListener("close", () => {
    // Only an established seat reconnects by itself: replaying create_room or join_room
    // would mint a second room or claim a second seat.
    if (!currentSession) {
      // A socket that never opened could not reach the server; one that opened and has no
      // session was ended on purpose, by a kick or a session that could not be restored.
      setConnection("offline", opened ? "Not connected" : "Could not reach the game server");
      return;
    }
    const { roomCode } = currentSession;
    setConnection("offline", "Disconnected — reconnecting");
    setTimeout(() => {
      const saved = storedSession(roomCode);
      if (saved?.token) connect(`/room/${roomCode}`, () => send("resume", { token: saved.token }));
      else setConnection("offline", "Not connected");
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "session") {
      currentSession = message;
      localStorage.setItem(sessionKey(message.roomCode), JSON.stringify({ token: message.token, playerId: message.playerId }));
      history.replaceState(null, "", `/?room=${message.roomCode}`);
    } else if (message.type === "state") {
      previousGameState = currentState?.mode === "GAME" ? currentState.game : null;
      currentState = message.state;
      render();
      if (previousGameState
        && currentState.mode === "GAME"
        && previousGameState.handNumber === currentState.game.handNumber
        && previousGameState.phase !== "HAND_COMPLETE"
        && currentState.game.phase === "HAND_COMPLETE") {
        playSoundEffect("chips");
      }
    } else if (message.type === "kicked") {
      localStorage.removeItem(sessionKey(message.roomCode));
      currentState = null;
      currentSession = null;
      history.replaceState(null, "", "/");
      render();
      showToast(message.message, true);
    } else if (message.type === "error") {
      showToast(message.message, true);
      if (message.message.includes("restore")) {
        const code = new URLSearchParams(location.search).get("room");
        if (code) localStorage.removeItem(sessionKey(code));
        currentState = null;
        currentSession = null;
        history.replaceState(null, "", "/");
        render();
      }
    }
  });
}

function showView(view) {
  [homeView, lobbyView, gameView].forEach((candidate) => candidate.classList.toggle("hidden", candidate !== view));
}

function render() {
  if (!currentState) {
    roomPill.classList.add("hidden");
    showView(homeView);
    return;
  }
  roomPill.classList.remove("hidden");
  roomPill.querySelector("b").textContent = currentState.roomCode;
  if (currentState.mode === "LOBBY") renderLobby(currentState);
  else renderGame(currentState);
}

function renderLobby(state) {
  showView(lobbyView);
  const isHost = state.viewerId === state.hostId;
  const viewer = state.players.find((player) => player.id === state.viewerId);
  $("#lobby-code").textContent = state.roomCode;

  // Players load the client from this same origin, wherever they are.
  $("#share-address").textContent = `${location.origin}/?room=${state.roomCode}`;

  const seats = [...state.players];
  while (seats.length < 6) seats.push(null);
  $("#lobby-seats").innerHTML = seats.map((player, index) => {
    if (!player) return `<div class="lobby-seat open"><span>＋ OPEN SEAT</span></div>`;
    const readyClass = !player.connected ? "offline" : player.ready ? "ready" : "";
    const readyText = !player.connected ? "OFFLINE" : player.ready ? "READY" : "NOT READY";
    const kickButton = isHost && player.id !== state.viewerId
      ? `<button class="kick-player-button" type="button" data-kick-player="${escapeHtml(player.id)}" data-player-name="${escapeHtml(player.name)}" aria-label="Remove ${escapeHtml(player.name)}">KICK</button>`
      : "";
    return `<div class="lobby-seat">
      <div class="avatar" style="--avatar:${avatarColors[index]}">${escapeHtml(initials(player.name))}</div>
      <div class="seat-info"><b>${escapeHtml(player.name)}${player.id === state.viewerId ? " (You)" : ""}</b><small>${player.id === state.hostId ? "Host · " : ""}Seat ${index + 1}</small></div>
      <span class="ready-state ${readyClass}">${readyText}</span>
      ${kickButton}
    </div>`;
  }).join("");

  const readyButton = $("#ready-button");
  readyButton.classList.toggle("active", Boolean(viewer?.ready));
  readyButton.querySelector("span:last-child").textContent = viewer?.ready ? "Ready" : "I'm ready";

  const everyoneReady = state.players.length >= 2 && state.players.every((player) => player.ready && player.connected);
  const startButton = $("#start-button");
  startButton.classList.toggle("hidden", !isHost);
  startButton.disabled = !everyoneReady;

  const settingMap = {
    "#setting-stack": state.config.startingStack,
    "#setting-tokens": state.config.draftTokens,
    "#setting-small-blind": state.config.smallBlind,
    "#setting-big-blind": state.config.bigBlind,
    "#setting-draft-time": state.config.draftTimeSeconds ?? 30,
    "#setting-bet-time": state.config.betTimeSeconds ?? 30,
  };
  Object.entries(settingMap).forEach(([selector, value]) => {
    const input = $(selector);
    input.value = value;
    input.disabled = !isHost;
  });
  $(".host-only-badge").textContent = isHost ? "HOST" : "HOST ONLY";
}

function cardHtml(card, { small = false, clickableId = null, label = "", visibilityLabel = null } = {}) {
  if (!card) {
    const tag = clickableId ? "button" : "div";
    const attributes = clickableId ? `type="button" data-card-id="${escapeHtml(clickableId)}" aria-label="${escapeHtml(label || "Pick hidden card")}"` : "";
    return `<${tag} class="playing-card card-back${small ? " small" : ""}" ${attributes}></${tag}>`;
  }
  const suit = suitSymbols[card.suit];
  const tag = clickableId ? "button" : "div";
  const attributes = clickableId ? `type="button" data-card-id="${escapeHtml(clickableId)}" aria-label="Pick ${escapeHtml(card.rank)} ${suit}"` : "";
  const visibilityClass = visibilityLabel ? ` visibility-${visibilityLabel.toLowerCase()}` : "";
  const visibilityIndicator = visibilityLabel ? `<span class="card-visibility">${visibilityLabel}</span>` : "";
  return `<${tag} class="playing-card ${suitClasses[card.suit]}${small ? " small" : ""}${visibilityClass}" ${attributes}>
    <span class="corner">${escapeHtml(card.rank)}<i>${suit}</i></span><span class="suit-main">${suit}</span>
    ${visibilityIndicator}
  </${tag}>`;
}

function relativePosition(seatIndex, viewerSeat, count) {
  const relative = (seatIndex - viewerSeat + count) % count;
  if (relative === 0) return "bottom";
  if (count === 2) return "top";
  if (count === 3) return relative === 1 ? "left" : "right";
  if (count === 4) return ["bottom", "left", "top", "right"][relative];
  if (count === 5) return ["bottom", "lower-left", "upper-left", "upper-right", "lower-right"][relative];
  return ["bottom", "lower-left", "upper-left", "top", "upper-right", "lower-right"][relative];
}

function pokerChipPile(amount, { animate = false, className = "" } = {}) {
  if (amount <= 0) {
    return `<div class="poker-chip-pile chips empty${className ? ` ${className}` : ""}">
      <span class="poker-chip-stacks"></span><span class="chip-pile-caption"><b>0</b><small>CHIPS</small></span>
    </div>`;
  }
  const totalChips = Math.min(20, Math.max(1, Math.ceil(Math.log2(amount + 1)) * 2 - 2));
  const stackCount = Math.ceil(totalChips / 5);
  const denominations = [1, 5, 25, 100, 500].filter((value) => value <= amount);
  let chipsLeft = totalChips;
  const stacks = Array.from({ length: stackCount }, (_, stackIndex) => {
    const chipCount = Math.min(5, chipsLeft);
    chipsLeft -= chipCount;
    const denominationIndex = Math.min(
      denominations.length - 1,
      Math.floor(((stackIndex + 1) * denominations.length - 1) / stackCount),
    );
    const denomination = denominations[Math.max(0, denominationIndex)] ?? 1;
    const chips = Array.from({ length: chipCount }, (_, chipIndex) => (
      `<i style="--chip-index:${chipIndex}" aria-hidden="true"></i>`
    )).join("");
    return `<span class="poker-chip-stack denomination-${denomination}" style="--chip-count:${chipCount}" title="${denomination}-chip stack">${chips}</span>`;
  }).join("");
  return `<div class="poker-chip-pile chips${animate ? " animate-in" : ""}${className ? ` ${className}` : ""}">
    <span class="poker-chip-stacks">${stacks}</span>
    <span class="chip-pile-caption"><b>${escapeHtml(amount)}</b><small>CHIPS</small></span>
  </div>`;
}

function renderPlayerSeats(state) {
  const game = state.game;
  const viewer = game.players.find((player) => player.id === state.viewerId);
  const activeTurn = game.phase === "DRAFT_PICKING" ? game.currentPickerId : game.betting?.actingPlayerId;
  $("#player-seats").innerHTML = game.players.map((player, index) => {
    const position = relativePosition(player.seatIndex, viewer.seatIndex, game.players.length);
    const visibleCards = player.cards.filter(({ card }) => card);
    const hiddenCount = player.cards.length - visibleCards.length;
    const cards = visibleCards.map(({ card, visibility }) => cardHtml(card, {
      small: true,
      visibilityLabel: player.id === state.viewerId ? (visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE") : null,
    })).join("")
      + (hiddenCount ? `${cardHtml(null, { small: true })}<span class="hidden-count">+${hiddenCount}</span>` : "");
    const badges = [
      player.seatIndex === game.dealerSeatIndex ? '<span class="seat-badge dealer">D</span>' : "",
      player.seatIndex === game.smallBlindSeatIndex ? '<span class="seat-badge blind">SB</span>' : "",
      player.seatIndex === game.bigBlindSeatIndex ? '<span class="seat-badge blind">BB</span>' : "",
      player.folded ? '<span class="seat-badge fold">FOLD</span>' : "",
      player.allIn && !player.folded ? '<span class="seat-badge allin">ALL-IN · STILL DRAFTS</span>' : "",
      player.sittingOut
        ? `<span class="seat-badge sitout">${game.phase === "HAND_COMPLETE" || !player.inHand ? "SITTING OUT" : "SIT OUT NEXT"}</span>`
        : "",
      player.refillCount > 0 ? `<span class="seat-badge refill">REFILL ×${player.refillCount}</span>` : "",
      game.phase === "HAND_COMPLETE" && Number.isFinite(player.handChipDelta) && player.handChipDelta !== 0
        ? `<span class="seat-badge chip-delta ${player.handChipDelta > 0 ? "win" : "loss"}">HAND ${player.handChipDelta > 0 ? "+" : ""}${player.handChipDelta}</span>`
        : "",
    ].join("");
    const classes = ["player-seat", activeTurn === player.id ? "is-turn" : "", player.folded ? "is-folded" : "", !player.inHand ? "is-sitting-out" : ""].join(" ");
    return `<div class="${classes}" data-position="${position}" data-player-id="${escapeHtml(player.id)}">
      <div class="seat-badges">${badges}</div>
      <div class="seat-shell">
        <div class="avatar" style="--avatar:${avatarColors[index]}">${escapeHtml(initials(player.name))}</div>
        <div class="seat-chip-stack">${pokerChipPile(player.chips, { className: "bankroll-pile" })}</div>
        <div><div class="seat-name ${player.id === state.viewerId ? "you" : ""}">${escapeHtml(player.name)}</div>
          <div class="resource-line"><span class="token-value">◆ ${player.draftTokens}</span></div>
        </div>
      </div>
      <div class="seat-cards">${cards}</div>
    </div>`;
  }).join("");
}

function contributionWasAdded(game, player, key) {
  if (!previousGameState || previousGameState.handNumber !== game.handNumber) return player[key] > 0;
  const previousPlayer = previousGameState.players.find((candidate) => candidate.id === player.id);
  if (!previousPlayer) return player[key] > 0;
  if (key === "streetContribution" && previousGameState.round !== game.round) return player[key] > 0;
  return player[key] > previousPlayer[key];
}

function contributionStack(type, amount, label, animate) {
  if (type === "chips") return pokerChipPile(amount, { animate });
  return `<div class="contribution-stack ${type}${animate ? " animate-in" : ""}">
    <span class="contribution-pieces"><i></i><i></i><i></i></span><b>${escapeHtml(amount)}</b><small>${escapeHtml(label)}</small>
  </div>`;
}

function renderTableContributions(state) {
  const game = state.game;
  const viewer = game.players.find((player) => player.id === state.viewerId);
  const draftActive = game.phase === "DRAFT_BIDDING" || game.phase === "DRAFT_PICKING";
  const initialSecretBid = game.phase === "DRAFT_BIDDING" && game.draftBidStage === "INITIAL";
  const tieBreakBid = game.phase === "DRAFT_BIDDING" && game.draftBidStage === "TIEBREAK";

  const contributions = game.players.map((player) => {
    const position = relativePosition(player.seatIndex, viewer.seatIndex, game.players.length);
    const stacks = [];
    const previousPlayer = previousGameState?.players.find((candidate) => candidate.id === player.id);

    if (player.streetContribution > 0) {
      stacks.push(contributionStack(
        "chips",
        player.streetContribution,
        "CHIPS",
        contributionWasAdded(game, player, "streetContribution"),
      ));
    }

    if (initialSecretBid && player.draftBidLocked) {
      const ownBid = player.id === state.viewerId ? player.currentDraftBid : "?";
      stacks.push(contributionStack("tokens secret", ownBid, "LOCKED BID", !previousPlayer?.draftBidLocked));
    } else if (draftActive && player.draftSpentThisRound > 0) {
      stacks.push(contributionStack(
        "tokens",
        player.draftSpentThisRound,
        "DRAFT",
        contributionWasAdded(game, player, "draftSpentThisRound"),
      ));
      if (tieBreakBid && player.draftBidLocked) {
        const ownRebid = player.id === state.viewerId ? `+${player.currentDraftBid}` : "+?";
        stacks.push(contributionStack("tokens secret", ownRebid, "RE-BID", !previousPlayer?.draftBidLocked));
      }
    }

    return stacks.length
      ? `<div class="table-contribution" data-position="${position}" data-player-id="${escapeHtml(player.id)}">${stacks.join("")}</div>`
      : "";
  }).join("");
  const showPayout = game.phase === "HAND_COMPLETE"
    && previousGameState?.handNumber === game.handNumber
    && previousGameState.phase !== "HAND_COMPLETE";
  const payoutFlights = showPayout ? game.result.winnerIds.map((playerId, index) => {
    const winner = game.players.find((player) => player.id === playerId);
    const position = relativePosition(winner.seatIndex, viewer.seatIndex, game.players.length);
    const visualAmount = Math.max(1, Math.floor(game.result.amount / game.result.winnerIds.length));
    return `<div class="winner-chip-flight" data-position="${position}" style="--flight-delay:${index * 0.12}s">
      ${pokerChipPile(visualAmount, { className: "payout-pile" })}
    </div>`;
  }).join("") : "";
  $("#table-contributions").innerHTML = contributions + payoutFlights;
}

function marketDescription(game) {
  if (game.phase === "DRAFT_BIDDING") {
    return game.draftBidStage === "TIEBREAK" ? "Tied players re-bid in secret" : "Choose tokens, then lock your bid";
  }
  if (game.phase === "DRAFT_PICKING") {
    const picker = game.players.find((player) => player.id === game.currentPickerId);
    return picker ? `${picker.name} is picking` : "Resolving draft order";
  }
  if (game.phase === "POKER_BETTING") {
    const actor = game.players.find((player) => player.id === game.betting?.actingPlayerId);
    return actor ? `${actor.name}'s turn` : "Closing the betting round";
  }
  return game.result?.type === "FOLD" ? "Won without showing" : "Best five cards play";
}

function renderGame(state) {
  showView(gameView);
  applyLogVisibility();
  const game = state.game;
  const isPicking = game.phase === "DRAFT_PICKING" && game.currentPickerId === state.viewerId;
  const me = game.players.find((player) => player.id === state.viewerId);
  $(".poker-table").dataset.playerCount = game.players.length;
  $(".poker-table").dataset.phase = game.phase;
  $("#round-label").textContent = `ROUND ${game.round} / 4 · HAND ${game.handNumber}`;
  $("#phase-label").textContent = game.phase === "DRAFT_BIDDING" && game.draftBidStage === "TIEBREAK"
    ? "DRAFT · TIE-BREAK"
    : phaseNames[game.phase] ?? game.phase;
  $("#phase-label").style.color = game.phase === "POKER_BETTING" ? "var(--red)" : game.phase === "HAND_COMPLETE" ? "var(--gold)" : "var(--cyan)";
  $("#market-instruction").textContent = marketDescription(game);
  $("#market-kicker").textContent = game.phase === "POKER_BETTING" ? `CURRENT BET · ${game.betting?.currentBet ?? 0}` : "CARD MARKET";
  $("#phase-progress").innerHTML = [1, 2, 3, 4].map((round) => `<i class="${round < game.round ? "done" : round === game.round ? "current" : ""}"></i>`).join("");
  const seatToggle = $("#seat-toggle-button");
  seatToggle.textContent = me.sittingOut ? "Sit in next hand" : "Sit out next hand";
  seatToggle.classList.toggle("active", me.sittingOut);
  seatToggle.setAttribute("aria-pressed", String(me.sittingOut));

  $("#market-cards").innerHTML = game.market.map(({ id, card }) => cardHtml(card, {
    clickableId: isPicking ? id : null,
    label: card ? `Pick ${card.rank} ${suitSymbols[card.suit]}` : "Pick a hidden card",
  })).join("");

  const order = $("#draft-order");
  if (game.pickOrder.length && game.phase === "DRAFT_PICKING") {
    order.classList.remove("hidden");
    order.innerHTML = game.pickOrder.map((id, index) => {
      const player = game.players.find((candidate) => candidate.id === id);
      return `<span><b>#${index + 1}</b> ${escapeHtml(player.name)} · ${player.draftBid}</span>`;
    }).join('<span aria-hidden="true">›</span>');
  } else order.classList.add("hidden");

  $("#pot-stack").querySelector("b").textContent = game.pot;
  renderPlayerSeats(state);
  renderTableContributions(state);
  renderActionDock(state);
  renderSidebar(game);
  updateTurnTimer();
}

function applyLogVisibility() {
  gameView.classList.toggle("log-hidden", logHidden);
  const button = $("#log-toggle-button");
  button.setAttribute("aria-pressed", String(logHidden));
  button.querySelector("span").textContent = logHidden ? "Show log" : "Hide log";
}

function updateTurnTimer() {
  const timer = $("#turn-timer");
  const game = currentState?.mode === "GAME" ? currentState.game : null;
  const deadline = game?.turnDeadline;
  if (!deadline) {
    timer.setAttribute("aria-live", "off");
    timer.classList.remove("warning", "danger");
    timer.classList.add("hidden");
    return;
  }
  const remainingMs = Math.max(0, deadline - Date.now());
  const seconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const durationSeconds = game.phase === "POKER_BETTING"
    ? game.config.betTimeSeconds
    : game.phase === "HAND_COMPLETE" ? 5 : game.config.draftTimeSeconds;
  const turnProgress = Math.max(0, Math.min(1, remainingMs / (durationSeconds * 1000)));
  const danger = seconds > 0 && seconds <= 3;
  const warning = !danger && turnProgress <= 0.5;
  const activeSeat = $(".player-seat.is-turn");
  const activeAvatar = activeSeat?.querySelector(".avatar");
  if (activeAvatar) {
    activeAvatar.style.setProperty("--turn-progress", turnProgress.toFixed(4));
    activeAvatar.style.setProperty("--turn-angle", `${(turnProgress * 360).toFixed(2)}deg`);
    activeSeat.classList.toggle("turn-warning", warning);
    activeSeat.classList.toggle("turn-danger", danger);
  }
  timer.querySelector("strong").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  timer.querySelector("span").textContent = game.phase === "HAND_COMPLETE" ? "NEXT HAND" : "TIME";
  timer.classList.toggle("warning", warning);
  timer.classList.toggle("danger", danger);
  timer.setAttribute("aria-live", danger ? "assertive" : "off");
  timer.classList.remove("hidden");
}

function waitingHtml(message) {
  return `<div class="waiting-action"><i></i><span>${escapeHtml(message)}</span></div>`;
}

function renderActionDock(state) {
  const game = state.game;
  const me = game.players.find((player) => player.id === state.viewerId);
  const dock = $("#action-dock");

  if (game.players.some((player) => player.handChipDelta === undefined || player.sittingOut === undefined || player.refillCount === undefined)) {
    dock.innerHTML = OUTDATED_VERSION_WARNING;
    return;
  }
  if (game.phase === "DRAFT_BIDDING" && game.draftBidStage === undefined) {
    dock.innerHTML = OUTDATED_VERSION_WARNING;
    return;
  }
  if (game.phase === "HAND_COMPLETE") {
    renderResult(state, dock);
    return;
  }
  if (!me.inHand) {
    dock.innerHTML = waitingHtml(me.sittingOut ? "You are sitting out · use Sit in next hand when ready" : "You are watching this hand");
    return;
  }
  if (game.phase === "DRAFT_BIDDING") {
    const tieBreak = game.draftBidStage === "TIEBREAK";
    if (!me.draftBidEligible) {
      const tiedNames = game.draftTieGroupIds
        .map((id) => game.players.find((player) => player.id === id)?.name)
        .filter(Boolean)
        .join(" & ");
      dock.innerHTML = waitingHtml(`Tie-break ${game.draftTieRound}: ${tiedNames} are re-bidding…`);
      return;
    }
    if (me.draftBidLocked) {
      const waiting = game.players.filter((player) => player.draftBidEligible && !player.draftBidLocked).length;
      dock.innerHTML = `<div class="locked-panel"><span>✓</span><div><b>${tieBreak ? "RE-BID" : "BID"} ${me.currentDraftBid} LOCKED</b><small>Waiting for ${waiting} player${waiting === 1 ? "" : "s"}…</small></div></div>`;
    } else {
      const pendingBidKey = `${state.roomCode}:${state.viewerId}:${game.handNumber}:${game.round}:${game.draftBidStage}:${game.draftTieRound ?? 0}`;
      if (pendingDraftBid.key !== pendingBidKey) pendingDraftBid = { key: pendingBidKey, value: 0 };
      pendingDraftBid.value = Math.max(0, Math.min(me.draftTokens, pendingDraftBid.value));
      const existingRange = $("#bid-range");
      const existingNumber = $("#bid-number");
      if (dock.dataset.draftBidKey === pendingBidKey && existingRange && existingNumber && $("#lock-bid-button")) {
        existingRange.max = me.draftTokens;
        existingNumber.max = me.draftTokens;
        return;
      }
      dock.dataset.draftBidKey = pendingBidKey;
      dock.innerHTML = `<div class="draft-controls">
        <div class="control-heading"><span>${tieBreak ? `TIE-BREAK ${game.draftTieRound}` : "DRAFT BID"} · SECRET</span><b>${tieBreak ? "Re-bid to break the tie" : "How many Draft Tokens do you want to bid?"}</b><small>0–${me.draftTokens} tokens · ${tieBreak ? "additional bids" : "every bid"} are spent</small></div>
        <div class="bid-input-wrap"><input id="bid-range" type="range" min="0" max="${me.draftTokens}" value="${pendingDraftBid.value}"><input class="number-box" id="bid-number" type="number" min="0" max="${me.draftTokens}" value="${pendingDraftBid.value}" aria-label="Draft Token bid"></div>
        <button class="lock-bid-button" id="lock-bid-button" type="button">${tieBreak ? "LOCK RE-BID" : "LOCK BID"}</button>
      </div>`;
      const range = $("#bid-range");
      const number = $("#bid-number");
      const rememberBid = (value) => {
        pendingDraftBid.value = Math.max(0, Math.min(me.draftTokens, Number(value) || 0));
        return pendingDraftBid.value;
      };
      range.addEventListener("input", () => { number.value = rememberBid(range.value); });
      number.addEventListener("input", () => { range.value = rememberBid(number.value); });
      $("#lock-bid-button").addEventListener("click", () => {
        const bid = Number(number.value);
        if (Number.isInteger(bid) && bid >= 0 && bid <= me.draftTokens) pendingDraftBid.value = bid;
        if (Number.isInteger(bid) && bid > 0 && bid <= me.draftTokens) playSoundEffect("chips");
        send("draft_bid", { bid });
      });
    }
    return;
  }
  if (game.phase === "DRAFT_PICKING") {
    dock.innerHTML = game.currentPickerId === state.viewerId
      ? `<div class="waiting-action"><i></i><span><b style="color:var(--cyan)">YOUR PICK</b> · Choose one market card</span></div>`
      : waitingHtml(`Waiting for ${game.players.find((player) => player.id === game.currentPickerId)?.name ?? "a player"}…`);
    return;
  }
  if (game.phase === "POKER_BETTING") {
    if (!game.legalActions) {
      const actor = game.players.find((player) => player.id === game.betting?.actingPlayerId);
      dock.innerHTML = waitingHtml(actor ? `Waiting for ${actor.name}…` : "Closing the betting round…");
      return;
    }
    renderBettingControls(game, dock);
    return;
  }
  dock.innerHTML = waitingHtml("Evaluating hands…");
}

function renderBettingControls(game, dock) {
  const legal = game.legalActions;
  const wager = legal.wager;
  const wagerHtml = wager ? `<div class="wager-control">
    <input id="wager-range" type="range" min="${wager.minTo}" max="${wager.maxTo}" value="${wager.minTo}">
    <input id="wager-number" class="number-box" type="number" min="${wager.minTo}" max="${wager.maxTo}" value="${wager.minTo}">
    <div class="quick-bets"><button data-size="min">MIN</button><button data-size="half">1/2 POT</button><button data-size="pot">POT</button><button data-size="max">MAX</button></div>
  </div>` : `<div></div>`;
  const buttons = [
    legal.actions.includes("FOLD") ? '<button class="poker-button fold" data-poker-action="FOLD">FOLD</button>' : "",
    legal.actions.includes("CHECK") ? '<button class="poker-button check" data-poker-action="CHECK">CHECK</button>' : "",
    legal.actions.includes("CALL") ? `<button class="poker-button call" data-poker-action="CALL">CALL ${legal.toCall}</button>` : "",
    wager ? `<button class="poker-button ${wager.type.toLowerCase()}" data-poker-action="${wager.type}">${wager.type}</button>` : "",
    legal.actions.includes("ALL_IN") ? '<button class="poker-button allin" data-poker-action="ALL_IN">ALL-IN</button>' : "",
  ].join("");
  dock.innerHTML = `<div class="betting-controls">
    <div class="control-heading"><span>POKER CHIPS</span><b>Your action</b><small>Bet ${game.betting.currentBet} · Min raise +${game.betting.minimumRaiseIncrement}</small></div>
    ${wagerHtml}<div class="poker-actions">${buttons}</div>
  </div>`;

  if (wager) {
    const range = $("#wager-range");
    const number = $("#wager-number");
    const setWager = (value) => {
      const normalized = Math.max(wager.minTo, Math.min(wager.maxTo, Math.round(value)));
      range.value = normalized;
      number.value = normalized;
    };
    range.addEventListener("input", () => { number.value = range.value; });
    number.addEventListener("input", () => setWager(Number(number.value) || wager.minTo));
    dock.querySelectorAll("[data-size]").forEach((button) => button.addEventListener("click", () => {
      const sizes = {
        min: wager.minTo,
        half: game.betting.currentBet + Math.max(game.betting.minimumRaiseIncrement, Math.round(game.pot / 2)),
        pot: game.betting.currentBet + Math.max(game.betting.minimumRaiseIncrement, game.pot),
        max: wager.maxTo,
      };
      setWager(sizes[button.dataset.size]);
    }));
  }
  dock.querySelectorAll("[data-poker-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.pokerAction;
    const to = ["BET", "RAISE"].includes(action) ? Number($("#wager-number")?.value) : undefined;
    if (["CALL", "BET", "RAISE", "ALL_IN"].includes(action)) playSoundEffect(action === "ALL_IN" ? "allIn" : "chips");
    send("poker_action", { action, to });
  }));
}

function renderResult(state, dock) {
  const game = state.game;
  const winnerNames = game.result.winnerIds.map((id) => game.players.find((player) => player.id === id)?.name).join(" & ");
  const firstHand = game.result.winningHands?.[0];
  const cards = firstHand?.bestFive?.map((card) => cardHtml(card, { small: true })).join("") ?? "";
  const category = firstHand ? handNames[firstHand.category] : "All opponents folded";
  const me = game.players.find((player) => player.id === state.viewerId);
  const eligibleCount = game.players.filter((player) => player.chips > 0 && !player.sittingOut).length;
  const canContinue = eligibleCount >= 2;
  const nextHandMessage = canContinue
    ? "Next hand starts automatically in 5 seconds"
    : `Next hand paused · 2 seated players with chips are required (${eligibleCount}/2 ready)`;
  const hostButton = state.viewerId === state.hostId
    ? `<button class="primary-button next-hand-button" id="next-hand-button" type="button"${canContinue ? "" : " disabled"}>${canContinue ? "Next hand now →" : "Next hand unavailable"}</button>`
    : "";
  const refillButton = me.chips < game.config.startingStack
    ? `<button class="refill-button" id="refill-chips-button" type="button">Refill to ${game.config.startingStack}<small>${me.refillCount} refill${me.refillCount === 1 ? "" : "s"} so far</small></button>`
    : "";
  dock.innerHTML = `<div class="result-panel">
    <div class="winner-info"><p class="overline">${canContinue ? "HAND RESULT" : "TABLE PAUSED"}</p><h3>${escapeHtml(winnerNames)} wins ${game.result.amount} chips</h3><p>${escapeHtml(category)} · ${escapeHtml(nextHandMessage)}</p></div>
    <div class="winning-cards">${cards}</div><div class="result-actions">${refillButton}${hostButton}</div>
  </div>`;
  $("#next-hand-button")?.addEventListener("click", () => send("next_hand"));
  $("#refill-chips-button")?.addEventListener("click", () => send("refill_chips"));
}

function renderSidebar(game) {
  const log = $("#action-log");
  log.innerHTML = [...game.logs].reverse().map((item) => `<div class="log-item ${escapeHtml(item.tone)}">${escapeHtml(item.message)}</div>`).join("");
  const pots = game.pots.length ? game.pots : [{ amount: game.pot, eligiblePlayerIds: [] }];
  $("#pots-list").innerHTML = pots.map((pot, index) => `<div class="pot-row"><span>${index === 0 ? "Main pot" : `Side pot ${index}`}</span><b>${pot.amount}</b></div>`).join("");
}

$("#create-room-button").addEventListener("click", () => {
  const name = $("#player-name").value;
  connect("/room/new", () => send("create_room", { name }));
});
$("#join-room-button").addEventListener("click", () => {
  const code = $("#room-code-input").value.trim().toUpperCase();
  // Checked here so a mistyped code reports itself instead of failing as a dead socket.
  if (!ROOM_CODE_PATTERN.test(code)) {
    showToast("Enter the 8-character room code", true);
    return;
  }
  const name = $("#player-name").value;
  connect(`/room/${code}`, () => send("join_room", { name }));
});
$("#room-code-input").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 8); });
$("#room-code-input").addEventListener("keydown", (event) => { if (event.key === "Enter") $("#join-room-button").click(); });
$("#player-name").addEventListener("keydown", (event) => { if (event.key === "Enter") $("#create-room-button").click(); });
$("#ready-button").addEventListener("click", () => {
  const viewer = currentState?.players?.find((player) => player.id === currentState.viewerId);
  if (viewer) send("set_ready", { ready: !viewer.ready });
});
$("#lobby-seats").addEventListener("click", (event) => {
  const button = event.target.closest("[data-kick-player]");
  if (!button) return;
  if (window.confirm(`Remove ${button.dataset.playerName} from this room?`)) {
    send("kick_player", { playerId: button.dataset.kickPlayer });
  }
});
$("#start-button").addEventListener("click", () => send("start_game"));
$("#seat-toggle-button").addEventListener("click", () => {
  const me = currentState?.game?.players.find((player) => player.id === currentState.viewerId);
  if (me) send("set_sitting_out", { sittingOut: !me.sittingOut });
});

const settingSelectors = ["#setting-stack", "#setting-tokens", "#setting-small-blind", "#setting-big-blind", "#setting-draft-time", "#setting-bet-time"];
settingSelectors.forEach((selector) => $(selector).addEventListener("change", () => send("update_config", {
  config: {
    startingStack: Number($("#setting-stack").value),
    draftTokens: Number($("#setting-tokens").value),
    smallBlind: Number($("#setting-small-blind").value),
    bigBlind: Number($("#setting-big-blind").value),
    draftTimeSeconds: Number($("#setting-draft-time").value),
    betTimeSeconds: Number($("#setting-bet-time").value),
  },
})));

$("#copy-link-button").addEventListener("click", async () => {
  const link = $("#share-address").textContent;
  try {
    await navigator.clipboard.writeText(link);
    showToast("Invite link copied");
  } catch {
    showToast(`Invite link: ${link}`);
  }
});

$("#market-cards").addEventListener("click", (event) => {
  const card = event.target.closest("[data-card-id]");
  if (card) {
    playSoundEffect("cards");
    send("draft_pick", { cardId: card.dataset.cardId });
  }
});

$("#brand-button").addEventListener("click", () => {
  if (!currentState || window.confirm("Leave the table and return home?")) location.href = "/";
});

function showGuideSlide(index) {
  if (!guideSlides.length) return;
  guideSlideIndex = Math.max(0, Math.min(guideSlides.length - 1, index));
  guideSlides.forEach((slide, slideIndex) => {
    const active = slideIndex === guideSlideIndex;
    slide.classList.toggle("active", active);
    slide.setAttribute("aria-hidden", String(!active));
    if (active) slide.scrollTop = 0;
  });
  const heading = guideSlides[guideSlideIndex].querySelector("h1, h2");
  $("#guide-slide-title").textContent = heading?.textContent.replace(/\s+/g, " ").trim() || "Overview";
  $("#guide-slide-count").textContent = `${guideSlideIndex + 1} / ${guideSlides.length}`;
  $("#guide-prev-button").disabled = guideSlideIndex === 0;
  $("#guide-next-button").disabled = guideSlideIndex === guideSlides.length - 1;
  $("#guide-slide-dots").querySelectorAll("button").forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === guideSlideIndex);
    dot.setAttribute("aria-current", dotIndex === guideSlideIndex ? "step" : "false");
  });
}

async function openRules() {
  $("#sound-settings-popover").classList.add("hidden");
  $("#sound-settings-button").setAttribute("aria-expanded", "false");
  const dialog = $("#rules-dialog");
  dialog.showModal();
  if (rulesLoaded) {
    showGuideSlide(guideSlideIndex);
    return;
  }
  try {
    // A static fragment served from this origin, so it needs no game server.
    const response = await fetch("/rules-guide.html");
    if (!response.ok) throw new Error("Could not load the player guide");
    const content = $("#rules-content");
    content.innerHTML = await response.text();
    guideSlides = [...content.querySelectorAll(":scope > .guide-hero, :scope > .guide-section")];
    guideSlides.forEach((slide) => slide.classList.add("guide-slide"));
    $("#guide-slide-dots").innerHTML = guideSlides.map((slide, index) => {
      const heading = slide.querySelector("h1, h2")?.textContent.replace(/\s+/g, " ").trim() || `Slide ${index + 1}`;
      return `<button type="button" data-guide-slide="${index}" aria-label="Open ${escapeHtml(heading)}"></button>`;
    }).join("");
    $("#guide-slide-controls").classList.remove("hidden");
    rulesLoaded = true;
    showGuideSlide(0);
  } catch (error) {
    $("#rules-content").textContent = error.message;
  }
}

$("#rules-button").addEventListener("click", openRules);
$("#close-rules-button").addEventListener("click", () => $("#rules-dialog").close());
$("#rules-dialog").addEventListener("click", (event) => {
  if (event.target === $("#rules-dialog")) $("#rules-dialog").close();
});
$("#guide-prev-button").addEventListener("click", () => showGuideSlide(guideSlideIndex - 1));
$("#guide-next-button").addEventListener("click", () => showGuideSlide(guideSlideIndex + 1));
$("#guide-slide-dots").addEventListener("click", (event) => {
  const dot = event.target.closest("[data-guide-slide]");
  if (dot) showGuideSlide(Number(dot.dataset.guideSlide));
});
$("#rules-dialog").addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") showGuideSlide(guideSlideIndex - 1);
  if (event.key === "ArrowRight") showGuideSlide(guideSlideIndex + 1);
});
$("#log-toggle-button").addEventListener("click", () => {
  logHidden = !logHidden;
  localStorage.setItem("draft-holdem-hide-log", String(logHidden));
  applyLogVisibility();
});

$("#sound-settings-button").addEventListener("click", () => {
  const popover = $("#sound-settings-popover");
  const opening = popover.classList.contains("hidden");
  popover.classList.toggle("hidden", !opening);
  $("#sound-settings-button").setAttribute("aria-expanded", String(opening));
});
$("#music-volume").addEventListener("input", (event) => updateSoundSetting("music", Number(event.target.value)));
$("#effects-volume").addEventListener("input", (event) => updateSoundSetting("effects", Number(event.target.value)));
document.addEventListener("click", (event) => {
  if (event.target.closest(".sound-settings-wrap")) return;
  $("#sound-settings-popover").classList.add("hidden");
  $("#sound-settings-button").setAttribute("aria-expanded", "false");
});
document.addEventListener("keydown", (event) => {
  unlockAudio();
  if (event.key === "Escape") {
    $("#sound-settings-popover").classList.add("hidden");
    $("#sound-settings-button").setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("pointerdown", unlockAudio, { capture: true });

updateSoundSettingsUi();

// An invite link carries the room code. A stored token means this browser already holds
// a seat in that room, so it goes straight back in; otherwise the code is pre-filled and
// the player joins with a name of their own.
const invitedRoomCode = new URLSearchParams(location.search).get("room")?.trim().toUpperCase() ?? "";
if (ROOM_CODE_PATTERN.test(invitedRoomCode)) {
  const saved = storedSession(invitedRoomCode);
  if (saved?.token) connect(`/room/${invitedRoomCode}`, () => send("resume", { token: saved.token }));
  else $("#room-code-input").value = invitedRoomCode;
}
setInterval(updateTurnTimer, 100);
