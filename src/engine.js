import { randomInt, randomUUID } from "node:crypto";
import { compareEvaluated, evaluateBest, shuffleDeck } from "./cards.js";

export const DEFAULT_CONFIG = Object.freeze({
  startingStack: 500,
  smallBlind: 5,
  bigBlind: 10,
  draftTokens: 12,
  draftTimeSeconds: 30,
  betTimeSeconds: 30,
});

export const NEXT_HAND_DELAY_SECONDS = 5;

export function marketLayout(playerCount, round) {
  if (![2, 3, 4, 5, 6].includes(playerCount) || ![1, 2, 3, 4].includes(round)) {
    throw new Error("Invalid market layout input");
  }
  if (round <= 2) return { faceUp: playerCount, faceDown: 2, total: playerCount + 2 };
  if (round === 3) return { faceUp: playerCount + 1, faceDown: 1, total: playerCount + 2 };
  return { faceUp: playerCount + 2, faceDown: 0, total: playerCount + 2 };
}

function reverseSeatDistance(seatIndex, bigBlindSeatIndex, seatCount) {
  return (bigBlindSeatIndex - seatIndex + seatCount) % seatCount;
}

function seatDistance(seatIndex, startingSeatIndex, seatCount) {
  return (seatIndex - startingSeatIndex + seatCount) % seatCount;
}

export function resolveReverseBlindOrder(players, bigBlindSeatIndex, seatCount = players.length) {
  return [...players].sort((left, right) => (
    reverseSeatDistance(left.seatIndex, bigBlindSeatIndex, seatCount)
    - reverseSeatDistance(right.seatIndex, bigBlindSeatIndex, seatCount)
  ));
}

function groupPlayersByBid(players, field) {
  const groups = new Map();
  for (const player of players) {
    const bid = player[field];
    if (!groups.has(bid)) groups.set(bid, []);
    groups.get(bid).push(player);
  }
  return [...groups.entries()]
    .sort(([leftBid], [rightBid]) => rightBid - leftBid)
    .map(([bid, groupedPlayers]) => ({ bid, players: groupedPlayers }));
}

function flattenDraftResolution(part) {
  if (typeof part === "string") return [part];
  if (Array.isArray(part)) return part.flatMap(flattenDraftResolution);
  return flattenDraftResolution(part.parts ?? []);
}

export function buildPots(players) {
  const levels = [...new Set(players.map((player) => player.totalContribution).filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  return levels.map((level) => {
    const contributors = players.filter((player) => player.totalContribution >= level);
    const pot = {
      amount: (level - previous) * contributors.length,
      eligiblePlayerIds: contributors.filter((player) => !player.folded).map((player) => player.id),
    };
    previous = level;
    return pot;
  }).filter((pot) => pot.amount > 0);
}

function clampInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  return Math.max(minimum, Math.min(maximum, number));
}

export class DraftHoldemGame {
  constructor(roomPlayers, config = {}) {
    if (roomPlayers.length < 2 || roomPlayers.length > 6) throw new Error("A game requires 2–6 players");
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.players = roomPlayers.map((player, seatIndex) => ({
      id: player.id,
      name: player.name,
      seatIndex,
      chips: this.config.startingStack,
      chipsAtHandStart: this.config.startingStack,
      handChipDelta: 0,
      sittingOut: false,
      refillCount: 0,
      draftTokens: 0,
      cards: [],
      folded: false,
      allIn: false,
      inHand: false,
      draftBid: null,
      draftTieBid: null,
      draftSpentThisRound: 0,
      streetContribution: 0,
      totalContribution: 0,
      acted: false,
      raiseAllowed: true,
    }));
    this.handNumber = 0;
    this.dealerSeatIndex = 0;
    this.logs = [];
    this.phase = "LOBBY";
    this.startHand(true);
  }

  activePlayers() {
    return this.players.filter((player) => player.inHand && !player.folded);
  }

  eligiblePlayers() {
    return this.players.filter((player) => player.chips > 0 && !player.sittingOut);
  }

  player(playerId) {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error("Player not found");
    return player;
  }

  nextSeat(fromSeat, predicate = () => true) {
    for (let offset = 1; offset <= this.players.length; offset += 1) {
      const seat = (fromSeat + offset) % this.players.length;
      const player = this.players.find((candidate) => candidate.seatIndex === seat);
      if (player && predicate(player)) return player;
    }
    return null;
  }

  previousSeat(fromSeat, predicate = () => true) {
    for (let offset = 1; offset <= this.players.length; offset += 1) {
      const seat = (fromSeat - offset + this.players.length) % this.players.length;
      const player = this.players.find((candidate) => candidate.seatIndex === seat);
      if (player && predicate(player)) return player;
    }
    return null;
  }

  addLog(message, tone = "neutral") {
    this.logs.push({ id: randomUUID(), message, tone });
    if (this.logs.length > 80) this.logs.shift();
  }

  startHand(firstHand = false) {
    const eligible = this.eligiblePlayers();
    if (eligible.length < 2) throw new Error("At least 2 players need chips to start a new hand");
    if (!firstHand) {
      const nextDealer = this.nextSeat(this.dealerSeatIndex, (player) => player.chips > 0 && !player.sittingOut);
      this.dealerSeatIndex = nextDealer.seatIndex;
    }

    this.handNumber += 1;
    this.round = 1;
    this.playerCountAtStart = eligible.length;
    this.deck = shuffleDeck();
    this.market = [];
    this.pickOrder = [];
    this.currentPickerIndex = 0;
    this.betting = null;
    this.result = null;
    this.turnDeadline = null;
    this.logs = [];

    for (const player of this.players) {
      player.chipsAtHandStart = player.chips;
      player.handChipDelta = 0;
      player.inHand = player.chips > 0 && !player.sittingOut;
      player.cards = [];
      player.folded = false;
      player.allIn = false;
      player.draftTokens = player.inHand ? this.config.draftTokens : 0;
      player.draftBid = null;
      player.draftTieBid = null;
      player.draftSpentThisRound = 0;
      player.streetContribution = 0;
      player.totalContribution = 0;
      player.acted = false;
      player.raiseAllowed = true;
    }

    this.addLog(`Hand ${this.handNumber} begins`, "gold");
    this.postBlinds();
    this.dealInitialCards();
    this.openMarket(1);
  }

  setSittingOut(playerId, sittingOut) {
    const player = this.player(playerId);
    player.sittingOut = Boolean(sittingOut);
    this.addLog(`${player.name} will ${player.sittingOut ? "sit out" : "sit in"} next hand`, "muted");
  }

  refillChips(playerId) {
    if (this.phase !== "HAND_COMPLETE") throw new Error("Chips can only be refilled between hands");
    const player = this.player(playerId);
    if (player.chips >= this.config.startingStack) throw new Error("Your stack is already full");
    player.chips = this.config.startingStack;
    player.refillCount += 1;
    this.addLog(`${player.name} refills to ${this.config.startingStack} chips`, "green");
  }

  recordHandChipDeltas() {
    for (const player of this.players) player.handChipDelta = player.chips - player.chipsAtHandStart;
  }

  commitChips(player, amount) {
    const committed = Math.min(player.chips, Math.max(0, amount));
    player.chips -= committed;
    player.streetContribution += committed;
    player.totalContribution += committed;
    if (player.chips === 0) player.allIn = true;
    return committed;
  }

  postBlinds() {
    const inHand = (player) => player.inHand;
    let smallBlindPlayer;
    let bigBlindPlayer;
    if (this.playerCountAtStart === 2) {
      smallBlindPlayer = this.players.find((player) => player.seatIndex === this.dealerSeatIndex);
      bigBlindPlayer = this.nextSeat(this.dealerSeatIndex, inHand);
    } else {
      smallBlindPlayer = this.nextSeat(this.dealerSeatIndex, inHand);
      bigBlindPlayer = this.nextSeat(smallBlindPlayer.seatIndex, inHand);
    }
    this.initialSmallBlindSeatIndex = smallBlindPlayer.seatIndex;
    this.initialBigBlindSeatIndex = bigBlindPlayer.seatIndex;
    this.smallBlindSeatIndex = smallBlindPlayer.seatIndex;
    this.bigBlindSeatIndex = bigBlindPlayer.seatIndex;
    const small = this.commitChips(smallBlindPlayer, this.config.smallBlind);
    const big = this.commitChips(bigBlindPlayer, this.config.bigBlind);
    this.addLog(`${smallBlindPlayer.name} posts Small Blind ${small}`);
    this.addLog(`${bigBlindPlayer.name} posts Big Blind ${big}`);
  }

  dealInitialCards() {
    for (const player of this.players.filter((candidate) => candidate.inHand)) {
      player.cards.push({ card: this.deck.pop(), visibility: "PUBLIC", source: "INITIAL_FACE_UP" });
    }
    for (const player of this.players.filter((candidate) => candidate.inHand)) {
      player.cards.push({ card: this.deck.pop(), visibility: "OWNER_ONLY", source: "INITIAL_FACE_DOWN" });
    }
    this.addLog("Each player gets 1 face-up + 1 hidden card");
  }

  openMarket(round) {
    this.round = round;
    const inHand = (player) => player.inHand;
    let smallBlindPlayer = this.players.find((player) => player.seatIndex === this.initialSmallBlindSeatIndex);
    let bigBlindPlayer = this.players.find((player) => player.seatIndex === this.initialBigBlindSeatIndex);
    for (let positionRound = 1; positionRound < round; positionRound += 1) {
      smallBlindPlayer = this.nextSeat(smallBlindPlayer.seatIndex, inHand);
      bigBlindPlayer = this.nextSeat(bigBlindPlayer.seatIndex, inHand);
    }
    this.smallBlindSeatIndex = smallBlindPlayer.seatIndex;
    this.bigBlindSeatIndex = bigBlindPlayer.seatIndex;
    const layout = marketLayout(this.playerCountAtStart, round);
    this.market = [];
    for (let index = 0; index < layout.total; index += 1) {
      this.market.push({
        id: randomUUID(),
        card: this.deck.pop(),
        visibility: index < layout.faceUp ? "FACE_UP" : "FACE_DOWN",
        selectedByPlayerId: null,
        marketSlot: index,
      });
    }
    for (const player of this.players) {
      player.draftBid = null;
      player.draftTieBid = null;
      player.draftSpentThisRound = 0;
    }
    this.pickOrder = [];
    this.currentPickerIndex = 0;
    this.draftBidStage = "INITIAL";
    this.draftBidCycle = 0;
    this.draftTieGroup = null;
    this.draftTieTasks = [];
    this.draftResolutionTree = [];
    this.phase = "DRAFT_BIDDING";
    this.addLog(`Round ${round}: ${layout.faceUp} face-up + ${layout.faceDown} hidden`, "cyan");
  }

  submitDraftBid(playerId, rawBid) {
    if (this.phase !== "DRAFT_BIDDING") throw new Error("Draft bidding is not active");
    const player = this.player(playerId);
    if (!player.inHand || player.folded) throw new Error("You are not eligible to draft");
    const tieBreak = this.draftBidStage === "TIEBREAK";
    if (tieBreak && !this.draftTieGroup.playerIds.includes(playerId)) throw new Error("You are not in this tie-break group");
    const bidField = tieBreak ? "draftTieBid" : "draftBid";
    if (player[bidField] !== null) throw new Error("Your draft bid is locked");
    const bid = clampInteger(rawBid, 0, player.draftTokens);
    if (bid === null || Number(rawBid) !== bid) throw new Error("Your bid must be a whole number within your remaining tokens");
    player[bidField] = bid;

    const eligible = tieBreak
      ? this.draftTieGroup.playerIds.map((id) => this.player(id))
      : this.activePlayers();
    if (!eligible.every((candidate) => candidate[bidField] !== null)) return;
    if (tieBreak) this.finishTieBreakBidding(eligible);
    else this.finishInitialDraftBidding(eligible);
  }

  reverseBlindOrder(players) {
    const currentBlinds = [this.bigBlindSeatIndex, this.smallBlindSeatIndex]
      .map((seatIndex) => players.find((player) => player.seatIndex === seatIndex))
      .filter(Boolean);
    const blindIds = new Set(currentBlinds.map((player) => player.id));
    const remaining = resolveReverseBlindOrder(
      players.filter((player) => !blindIds.has(player.id)),
      this.bigBlindSeatIndex,
      this.players.length,
    );
    return [...currentBlinds, ...remaining].map((player) => player.id);
  }

  finishInitialDraftBidding(eligible) {
    for (const player of eligible) {
      player.draftTokens -= player.draftBid;
      player.draftSpentThisRound += player.draftBid;
      this.addLog(`${player.name} bid ${player.draftBid} token${player.draftBid === 1 ? "" : "s"}`, "cyan");
    }

    if (eligible.every((player) => player.draftBid === 0)) {
      this.draftResolutionTree = this.reverseBlindOrder(eligible);
      this.addLog("All bids are 0 · order runs backward from Big Blind", "purple");
      this.finalizeDraftOrder();
      return;
    }

    this.draftResolutionTree = groupPlayersByBid(eligible, "draftBid").map(({ bid, players }) => {
      if (players.length === 1) return players[0].id;
      if (bid === 0) return this.reverseBlindOrder(players);
      const node = { parts: null };
      this.draftTieTasks.push({ node, playerIds: players.map((player) => player.id), originalBid: bid, tieRound: 1 });
      return node;
    });
    this.advanceDraftResolution();
  }

  finishTieBreakBidding(eligible) {
    const task = this.draftTieGroup;
    for (const player of eligible) {
      player.draftTokens -= player.draftTieBid;
      player.draftSpentThisRound += player.draftTieBid;
      this.addLog(`${player.name} re-bid ${player.draftTieBid} token${player.draftTieBid === 1 ? "" : "s"}`, "purple");
    }

    task.node.parts = groupPlayersByBid(eligible, "draftTieBid").map(({ players }) => {
      if (players.length === 1) return players[0].id;
      const order = this.reverseBlindOrder(players);
      this.addLog(`Re-bid tied · position order ${order.map((id) => this.player(id).name).join(" → ")}`, "purple");
      return order;
    });
    this.draftTieGroup = null;
    this.advanceDraftResolution();
  }

  advanceDraftResolution() {
    while (this.draftTieTasks.length) {
      const task = this.draftTieTasks.shift();
      const players = task.playerIds.map((id) => this.player(id));
      if (players.every((player) => player.draftTokens === 0)) {
        task.node.parts = this.reverseBlindOrder(players);
        continue;
      }
      for (const player of this.players) player.draftTieBid = null;
      this.draftTieGroup = task;
      this.draftBidStage = "TIEBREAK";
      this.draftBidCycle += 1;
      this.addLog(
        `Tie-break ${task.tieRound}: ${players.map((player) => player.name).join(" & ")} re-bid`,
        "purple",
      );
      return;
    }
    this.finalizeDraftOrder();
  }

  finalizeDraftOrder() {
    this.pickOrder = flattenDraftResolution(this.draftResolutionTree);
    this.currentPickerIndex = 0;
    this.draftBidStage = "COMPLETE";
    this.draftTieGroup = null;
    for (const player of this.players) player.draftTieBid = null;
    this.phase = "DRAFT_PICKING";
    this.addLog(`Draft order: ${this.pickOrder.map((id) => this.player(id).name).join(" → ")}`, "gold");
  }

  draftCard(playerId, marketCardId) {
    if (this.phase !== "DRAFT_PICKING") throw new Error("Draft picking is not active");
    if (this.pickOrder[this.currentPickerIndex] !== playerId) throw new Error("It is not your draft turn");
    const marketCard = this.market.find((candidate) => candidate.id === marketCardId && !candidate.selectedByPlayerId);
    if (!marketCard) throw new Error("That card is no longer in the market");
    const player = this.player(playerId);
    marketCard.selectedByPlayerId = playerId;
    player.cards.push({
      card: marketCard.card,
      visibility: marketCard.visibility === "FACE_UP" ? "PUBLIC" : "OWNER_ONLY",
      source: `ROUND_${this.round}`,
    });
    this.addLog(
      marketCard.visibility === "FACE_UP"
        ? `${player.name} drafts ${marketCard.card.rank} ${marketCard.card.suit}`
        : `${player.name} drafts a hidden card`,
      marketCard.visibility === "FACE_UP" ? "neutral" : "cyan",
    );
    this.currentPickerIndex += 1;

    if (this.currentPickerIndex >= this.pickOrder.length) {
      const unpickedCards = this.market
        .filter((card) => !card.selectedByPlayerId)
        .map((marketCard) => marketCard.card);
      this.deck = shuffleDeck([...this.deck, ...unpickedCards]);
      this.market = [];
      this.addLog(`${unpickedCards.length} unpicked cards returned to the deck and reshuffled`);
      this.startBettingStreet();
    }
  }

  startBettingStreet() {
    if (this.round > 1) {
      for (const player of this.players) player.streetContribution = 0;
    }
    for (const player of this.players) {
      player.acted = false;
      player.raiseAllowed = true;
    }
    this.betting = {
      currentBet: Math.max(0, ...this.activePlayers().map((player) => player.streetContribution)),
      minimumRaiseIncrement: this.config.bigBlind,
      actingPlayerId: null,
    };
    if (this.playerCountAtStart === 2) {
      const smallBlind = this.players.find((player) => player.seatIndex === this.smallBlindSeatIndex);
      const bigBlind = this.players.find((player) => player.seatIndex === this.bigBlindSeatIndex);
      this.addLog(`Positions: ${smallBlind.name} SB · ${bigBlind.name} BB`);
    }
    this.phase = "POKER_BETTING";
    this.addLog(`Betting round ${this.round} begins`, "red");

    const nonAllIn = this.activePlayers().filter((player) => !player.allIn);
    if (nonAllIn.length < 2 && nonAllIn.every((player) => player.streetContribution >= this.betting.currentBet)) {
      nonAllIn.forEach((player) => { player.acted = true; });
      this.finishBettingStreet();
      return;
    }
    const firstActor = this.playerCountAtStart === 2
      ? this.players.find((player) => (
        player.seatIndex === this.smallBlindSeatIndex && player.inHand && !player.folded && !player.allIn
      )) ?? this.nextSeat(this.smallBlindSeatIndex, (player) => player.inHand && !player.folded && !player.allIn)
      : this.nextSeat(this.bigBlindSeatIndex, (player) => player.inHand && !player.folded && !player.allIn);
    this.betting.actingPlayerId = firstActor?.id ?? null;
    if (!firstActor) this.finishBettingStreet();
  }

  legalActions(playerId) {
    if (this.phase !== "POKER_BETTING" || this.betting.actingPlayerId !== playerId) return null;
    const player = this.player(playerId);
    const toCall = Math.max(0, this.betting.currentBet - player.streetContribution);
    const maxTo = player.streetContribution + player.chips;
    const actions = ["FOLD"];
    if (toCall === 0) actions.push("CHECK");
    else actions.push("CALL");
    if (player.chips > 0) actions.push("ALL_IN");

    let wager = null;
    if (this.betting.currentBet === 0 && player.chips > 0) {
      wager = { type: "BET", minTo: Math.min(this.config.bigBlind, maxTo), maxTo };
      actions.push("BET");
    } else if (maxTo > this.betting.currentBet && player.raiseAllowed) {
      const fullRaiseTo = this.betting.currentBet + this.betting.minimumRaiseIncrement;
      if (maxTo >= fullRaiseTo) {
        wager = { type: "RAISE", minTo: fullRaiseTo, maxTo };
        actions.push("RAISE");
      }
    }
    return { actions, toCall: Math.min(toCall, player.chips), wager };
  }

  pokerAction(playerId, action, rawTo) {
    const legal = this.legalActions(playerId);
    if (!legal) throw new Error("It is not your betting turn");
    const player = this.player(playerId);
    const normalizedAction = String(action).toUpperCase();
    if (!legal.actions.includes(normalizedAction)) throw new Error("That action is not legal");

    if (normalizedAction === "FOLD") {
      player.folded = true;
      player.acted = true;
      this.addLog(`${player.name} · Fold`, "muted");
    } else if (normalizedAction === "CHECK") {
      player.acted = true;
      player.raiseAllowed = false;
      this.addLog(`${player.name} · Check`, "green");
    } else if (normalizedAction === "CALL") {
      const amount = this.commitChips(player, legal.toCall);
      player.acted = true;
      player.raiseAllowed = false;
      this.addLog(`${player.name} · Call ${amount}`, "green");
    } else {
      let target;
      if (normalizedAction === "ALL_IN") {
        target = player.streetContribution + player.chips;
      } else {
        target = clampInteger(rawTo, legal.wager.minTo, legal.wager.maxTo);
        if (target === null || Number(rawTo) !== target) throw new Error("Invalid bet amount");
      }
      this.applyWager(player, target, normalizedAction === "ALL_IN");
    }

    if (this.activePlayers().length === 1) {
      this.finishByFold(this.activePlayers()[0]);
      return;
    }
    const next = this.findNextActor(player.seatIndex);
    if (next) this.betting.actingPlayerId = next.id;
    else this.finishBettingStreet();
  }

  applyWager(player, target, explicitlyAllIn) {
    if (target <= player.streetContribution) throw new Error("The wager must increase your committed chips");
    const previousBet = this.betting.currentBet;
    const amount = target - player.streetContribution;
    const isAllIn = amount === player.chips;
    if (explicitlyAllIn && !isAllIn) throw new Error("All-in must commit your full stack");
    if (target > previousBet) {
      const increment = target - previousBet;
      const fullRaise = previousBet === 0
        ? target >= this.config.bigBlind
        : increment >= this.betting.minimumRaiseIncrement;
      if (!fullRaise && !isAllIn) throw new Error("Raise is below the minimum");
      if (fullRaise) {
        if (previousBet > 0) this.betting.minimumRaiseIncrement = increment;
        for (const other of this.activePlayers()) {
          if (other.id !== player.id && !other.allIn) {
            other.acted = false;
            other.raiseAllowed = true;
          }
        }
      }
      this.betting.currentBet = target;
    }
    this.commitChips(player, amount);
    player.acted = true;
    player.raiseAllowed = false;
    const verb = previousBet === 0 ? "Bet" : target > previousBet ? "Raise" : "Call";
    this.addLog(`${player.name} · ${verb} ${target}${isAllIn ? " · ALL-IN" : ""}`, isAllIn ? "purple" : "red");
  }

  needsAction(player) {
    return player.inHand
      && !player.folded
      && !player.allIn
      && (!player.acted || player.streetContribution < this.betting.currentBet);
  }

  findNextActor(fromSeat) {
    for (let offset = 1; offset <= this.players.length; offset += 1) {
      const seat = (fromSeat + offset) % this.players.length;
      const player = this.players.find((candidate) => candidate.seatIndex === seat);
      if (player && this.needsAction(player)) return player;
    }
    return null;
  }

  finishBettingStreet() {
    this.betting.actingPlayerId = null;
    if (this.round < 4) this.openMarket(this.round + 1);
    else this.showdown();
  }

  totalPot() {
    return this.players.reduce((total, player) => total + player.totalContribution, 0);
  }

  timerKey() {
    if (this.phase === "DRAFT_BIDDING") return `${this.handNumber}:${this.round}:bid:${this.draftBidCycle}`;
    if (this.phase === "DRAFT_PICKING") {
      return `${this.handNumber}:${this.round}:pick:${this.currentPickerIndex}:${this.pickOrder[this.currentPickerIndex]}`;
    }
    if (this.phase === "POKER_BETTING" && this.betting?.actingPlayerId) {
      return `${this.handNumber}:${this.round}:bet:${this.betting.actingPlayerId}:${this.logs.length}`;
    }
    if (this.phase === "HAND_COMPLETE" && this.eligiblePlayers().length >= 2) {
      return `${this.handNumber}:complete`;
    }
    return null;
  }

  timerDurationSeconds() {
    if (this.phase === "HAND_COMPLETE") return NEXT_HAND_DELAY_SECONDS;
    return this.phase === "POKER_BETTING" ? this.config.betTimeSeconds : this.config.draftTimeSeconds;
  }

  handleTimeout() {
    if (this.phase === "DRAFT_BIDDING") {
      const pending = this.draftBidStage === "TIEBREAK"
        ? this.draftTieGroup.playerIds.map((id) => this.player(id)).filter((player) => player.draftTieBid === null)
        : this.activePlayers().filter((player) => player.draftBid === null);
      if (pending.length) this.addLog("Draft time expired · missing bids set to 0", "muted");
      for (const player of pending) {
        if (this.phase === "DRAFT_BIDDING") this.submitDraftBid(player.id, 0);
      }
      return;
    }
    if (this.phase === "DRAFT_PICKING") {
      const playerId = this.pickOrder[this.currentPickerIndex];
      const available = this.market.filter((card) => !card.selectedByPlayerId);
      if (!playerId || !available.length) return;
      this.addLog(`${this.player(playerId).name} timed out · card auto-picked`, "muted");
      this.draftCard(playerId, available[randomInt(available.length)].id);
      return;
    }
    if (this.phase === "POKER_BETTING" && this.betting.actingPlayerId) {
      const playerId = this.betting.actingPlayerId;
      const legal = this.legalActions(playerId);
      const action = legal?.actions.includes("CHECK") ? "CHECK" : "FOLD";
      this.addLog(`${this.player(playerId).name} timed out · ${action === "CHECK" ? "checked" : "folded"}`, "muted");
      this.pokerAction(playerId, action);
      return;
    }
    if (this.phase === "HAND_COMPLETE" && this.eligiblePlayers().length >= 2) this.startHand();
  }

  finishByFold(winner) {
    const amount = this.totalPot();
    winner.chips += amount;
    this.phase = "HAND_COMPLETE";
    this.betting.actingPlayerId = null;
    this.result = {
      type: "FOLD",
      winnerIds: [winner.id],
      amount,
      pots: [{ amount, winnerIds: [winner.id] }],
      winningHands: [],
    };
    this.recordHandChipDeltas();
    this.addLog(`${winner.name} wins ${amount} chips without showing`, "gold");
  }

  showdown() {
    this.phase = "SHOWDOWN";
    const contenders = this.activePlayers();
    const evaluations = new Map(contenders.map((player) => [player.id, evaluateBest(player.cards.map(({ card }) => card))]));
    const pots = buildPots(this.players);
    const awardedPots = [];
    const winnerIds = new Set();

    for (const pot of pots) {
      const eligible = pot.eligiblePlayerIds.filter((id) => evaluations.has(id));
      if (eligible.length === 0) continue;
      let bestIds = [eligible[0]];
      for (const id of eligible.slice(1)) {
        const comparison = compareEvaluated(evaluations.get(id), evaluations.get(bestIds[0]));
        if (comparison > 0) bestIds = [id];
        else if (comparison === 0) bestIds.push(id);
      }
      const share = Math.floor(pot.amount / bestIds.length);
      let remainder = pot.amount % bestIds.length;
      const orderedWinners = [...bestIds].sort((a, b) => (
        seatDistance(this.player(a).seatIndex, (this.dealerSeatIndex + 1) % this.players.length, this.players.length)
        - seatDistance(this.player(b).seatIndex, (this.dealerSeatIndex + 1) % this.players.length, this.players.length)
      ));
      for (const id of orderedWinners) {
        this.player(id).chips += share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        winnerIds.add(id);
      }
      awardedPots.push({ amount: pot.amount, winnerIds: bestIds });
    }

    const winningHands = [...winnerIds].map((id) => ({
      playerId: id,
      category: evaluations.get(id).category,
      bestFive: evaluations.get(id).bestFive,
    }));
    this.phase = "HAND_COMPLETE";
    this.result = {
      type: "SHOWDOWN",
      winnerIds: [...winnerIds],
      amount: this.totalPot(),
      pots: awardedPots,
      winningHands,
    };
    this.recordHandChipDeltas();
    this.addLog(`${[...winnerIds].map((id) => this.player(id).name).join(" & ")} wins at showdown`, "gold");
  }

  stateFor(viewerId) {
    const initialBidsRevealed = this.phase !== "DRAFT_BIDDING" || this.draftBidStage === "TIEBREAK";
    const finalDraftOrder = this.phase !== "DRAFT_BIDDING";
    const winningCardIds = new Set((this.result?.winningHands ?? []).flatMap((hand) => hand.bestFive.map((card) => card.id)));
    const viewer = this.players.find((player) => player.id === viewerId);
    const publicPlayers = this.players.map((player) => {
      const draftBidEligible = this.phase === "DRAFT_BIDDING" && (
        this.draftBidStage === "INITIAL"
          ? player.inHand && !player.folded
          : this.draftTieGroup?.playerIds.includes(player.id)
      );
      const currentDraftBid = this.draftBidStage === "TIEBREAK" ? player.draftTieBid : player.draftBid;
      return {
        id: player.id,
        name: player.name,
        seatIndex: player.seatIndex,
        chips: player.chips,
        handChipDelta: this.phase === "HAND_COMPLETE" ? player.handChipDelta : player.chips - player.chipsAtHandStart,
        sittingOut: player.sittingOut,
        refillCount: player.refillCount,
        draftTokens: player.draftTokens,
        folded: player.folded,
        allIn: player.allIn,
        inHand: player.inHand,
        streetContribution: player.streetContribution,
        totalContribution: player.totalContribution,
        draftBidEligible,
        draftBidLocked: draftBidEligible && currentDraftBid !== null,
        currentDraftBid: player.id === viewerId ? currentDraftBid : null,
        draftBid: initialBidsRevealed || player.id === viewerId ? player.draftBid : null,
        draftSpentThisRound: player.draftSpentThisRound,
        cards: player.cards.map(({ card, visibility, source }) => {
        const canSee = visibility === "PUBLIC" || player.id === viewerId || winningCardIds.has(card.id);
        return canSee
          ? { card, visibility, source }
          : { card: null, visibility: "OWNER_ONLY", source };
        }),
      };
    });
    const publicMarket = this.market.filter((card) => !card.selectedByPlayerId).map((marketCard) => ({
      id: marketCard.id,
      marketSlot: marketCard.marketSlot,
      visibility: marketCard.visibility,
      card: marketCard.visibility === "FACE_UP" ? marketCard.card : null,
    }));

    const displayedPots = this.players.some((player) => player.allIn) || this.phase === "HAND_COMPLETE"
      ? buildPots(this.players)
      : [{ amount: this.totalPot(), eligiblePlayerIds: this.activePlayers().map((player) => player.id) }];

    return {
      phase: this.phase,
      handNumber: this.handNumber,
      round: this.round,
      playerCountAtStart: this.playerCountAtStart,
      dealerSeatIndex: this.dealerSeatIndex,
      smallBlindSeatIndex: this.smallBlindSeatIndex,
      bigBlindSeatIndex: this.bigBlindSeatIndex,
      draftBidStage: this.draftBidStage,
      draftTieGroupIds: this.draftTieGroup?.playerIds ?? [],
      draftTieRound: this.draftTieGroup?.tieRound ?? null,
      players: publicPlayers,
      market: publicMarket,
      pickOrder: finalDraftOrder ? this.pickOrder : [],
      currentPickerId: this.phase === "DRAFT_PICKING" ? this.pickOrder[this.currentPickerIndex] : null,
      betting: this.betting ? {
        currentBet: this.betting.currentBet,
        minimumRaiseIncrement: this.betting.minimumRaiseIncrement,
        actingPlayerId: this.betting.actingPlayerId,
      } : null,
      legalActions: viewer ? this.legalActions(viewerId) : null,
      pot: this.totalPot(),
      pots: displayedPots,
      result: this.result,
      logs: this.logs,
      config: this.config,
      turnDeadline: this.turnDeadline,
    };
  }
}
