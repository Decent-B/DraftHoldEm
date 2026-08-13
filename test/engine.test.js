import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, evaluateBest, evaluateFive, compareEvaluated } from "../src/cards.js";
import {
  buildPots,
  DraftHoldemGame,
  marketLayout,
  NEXT_HAND_DELAY_SECONDS,
  resolveReverseBlindOrder,
} from "../src/engine.js";

const card = (rank, suit = "SPADES") => ({ id: `${rank}-${suit}`, rank, suit });

test("market layout follows X + 2 for all rounds and player counts", () => {
  for (const playerCount of [2, 3, 4, 5, 6]) {
    assert.deepEqual(marketLayout(playerCount, 1), { faceUp: playerCount, faceDown: 2, total: playerCount + 2 });
    assert.deepEqual(marketLayout(playerCount, 2), { faceUp: playerCount, faceDown: 2, total: playerCount + 2 });
    assert.deepEqual(marketLayout(playerCount, 3), { faceUp: playerCount + 1, faceDown: 1, total: playerCount + 2 });
    assert.deepEqual(marketLayout(playerCount, 4), { faceUp: playerCount + 2, faceDown: 0, total: playerCount + 2 });
  }
});

test("reverse blind order runs backward from BB through table seats", () => {
  const players = [
    { id: "a", seatIndex: 0 },
    { id: "b", seatIndex: 1 },
    { id: "c", seatIndex: 2 },
    { id: "d", seatIndex: 3 },
  ];
  assert.deepEqual(resolveReverseBlindOrder(players, 2, 4).map(({ id }) => id), ["c", "b", "a", "d"]);
});

test("all 52 cards are unique", () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(({ id }) => id)).size, 52);
});

test("five-card evaluator recognizes every category", () => {
  const hands = [
    ["ROYAL_FLUSH", [card("10", "HEARTS"), card("J", "HEARTS"), card("Q", "HEARTS"), card("K", "HEARTS"), card("A", "HEARTS")]],
    ["STRAIGHT_FLUSH", [card("5"), card("6"), card("7"), card("8"), card("9")]],
    ["FOUR_OF_A_KIND", [card("K"), card("K", "HEARTS"), card("K", "DIAMONDS"), card("K", "CLUBS"), card("2")]],
    ["FULL_HOUSE", [card("Q"), card("Q", "HEARTS"), card("Q", "CLUBS"), card("8"), card("8", "HEARTS")]],
    ["FLUSH", [card("2", "CLUBS"), card("5", "CLUBS"), card("8", "CLUBS"), card("J", "CLUBS"), card("K", "CLUBS")]],
    ["STRAIGHT", [card("5"), card("6", "HEARTS"), card("7"), card("8"), card("9")]],
    ["THREE_OF_A_KIND", [card("7"), card("7", "HEARTS"), card("7", "CLUBS"), card("2"), card("A")]],
    ["TWO_PAIR", [card("J"), card("J", "HEARTS"), card("4"), card("4", "CLUBS"), card("A")]],
    ["ONE_PAIR", [card("10"), card("10", "HEARTS"), card("3"), card("7", "CLUBS"), card("A")]],
    ["HIGH_CARD", [card("2"), card("5", "HEARTS"), card("8"), card("J", "CLUBS"), card("A")]],
  ];
  hands.forEach(([category, cards]) => assert.equal(evaluateFive(cards).category, category));
});

test("ace-low straight, kicker, split and best five of six work", () => {
  const wheel = evaluateFive([card("A"), card("2", "HEARTS"), card("3"), card("4", "CLUBS"), card("5")]);
  assert.equal(wheel.category, "STRAIGHT");
  assert.equal(wheel.score[1], 5);

  const pairAceKicker = evaluateFive([card("9"), card("9", "HEARTS"), card("A"), card("7"), card("3")]);
  const pairKingKicker = evaluateFive([card("9"), card("9", "DIAMONDS"), card("K"), card("7", "CLUBS"), card("3", "HEARTS")]);
  assert.equal(compareEvaluated(pairAceKicker, pairKingKicker), 1);
  assert.equal(compareEvaluated(pairAceKicker, { ...pairAceKicker }), 0);

  const six = [card("A", "HEARTS"), card("K", "HEARTS"), card("Q", "HEARTS"), card("J", "HEARTS"), card("10", "HEARTS"), card("2")];
  assert.equal(evaluateBest(six).category, "ROYAL_FLUSH");
});

test("side pots contain the correct amounts and eligibility", () => {
  const pots = buildPots([
    { id: "a", totalContribution: 20, folded: false },
    { id: "b", totalContribution: 50, folded: false },
    { id: "c", totalContribution: 50, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 60, eligiblePlayerIds: ["a", "b", "c"] },
    { amount: 60, eligiblePlayerIds: ["b", "c"] },
  ]);
});

test("viewer state never leaks other hidden cards, market cards, or bids", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  const stateA = game.stateFor("a");
  const playerA = stateA.players.find(({ id }) => id === "a");
  const playerB = stateA.players.find(({ id }) => id === "b");
  assert.equal(playerA.handChipDelta, -5);
  assert.equal(playerB.handChipDelta, -10);
  assert.ok(playerA.cards.find(({ visibility }) => visibility === "OWNER_ONLY").card);
  assert.equal(playerB.cards.find(({ visibility }) => visibility === "OWNER_ONLY").card, null);
  assert.ok(stateA.market.filter(({ visibility }) => visibility === "FACE_DOWN").every(({ card: hidden }) => hidden === null));

  game.submitDraftBid("a", 2);
  assert.equal(game.stateFor("b").players.find(({ id }) => id === "a").draftBid, null);
  game.submitDraftBid("b", 1);
  assert.equal(game.stateFor("b").players.find(({ id }) => id === "a").draftBid, 2);
});

test("an all-zero initial draft starts at BB and runs backward around the table", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
    { id: "d", name: "D" },
  ]);
  for (const id of ["a", "b", "c", "d"]) game.submitDraftBid(id, 0);
  assert.equal(game.bigBlindSeatIndex, 2);
  assert.deepEqual(game.pickOrder, ["c", "b", "a", "d"]);
  assert.equal(game.phase, "DRAFT_PICKING");
});

test("zero-bid players follow reverse seat order behind a higher bidder", () => {
  const game = new DraftHoldemGame([
    { id: "utg", name: "UTG" },
    { id: "sb", name: "SB" },
    { id: "bb", name: "BB" },
  ]);
  game.submitDraftBid("utg", 0);
  game.submitDraftBid("sb", 0);
  game.submitDraftBid("bb", 2);
  assert.equal(game.phase, "DRAFT_PICKING");
  assert.deepEqual(game.pickOrder, ["bb", "sb", "utg"]);
});

test("tied bid groups re-bid sequentially and positional order breaks a re-bid tie", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
    { id: "d", name: "D" },
  ]);
  game.submitDraftBid("a", 4);
  game.submitDraftBid("b", 4);
  game.submitDraftBid("c", 2);
  game.submitDraftBid("d", 2);

  assert.equal(game.draftBidStage, "TIEBREAK");
  assert.deepEqual(game.draftTieGroup.playerIds, ["a", "b"]);
  assert.equal(game.stateFor("c").players.find(({ id }) => id === "a").draftBid, 4);
  game.submitDraftBid("a", 1);
  assert.equal(game.stateFor("b").players.find(({ id }) => id === "a").currentDraftBid, null);
  game.submitDraftBid("b", 2);

  assert.deepEqual(game.draftTieGroup.playerIds, ["c", "d"]);
  game.submitDraftBid("c", 1);
  game.submitDraftBid("d", 1);

  assert.equal(game.phase, "DRAFT_PICKING");
  assert.deepEqual(game.pickOrder, ["b", "a", "c", "d"]);
  assert.deepEqual(game.players.map(({ draftTokens }) => draftTokens), [7, 6, 9, 9]);
});

test("a tied group with no tokens left falls back to reverse blind order", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ], { draftTokens: 2 });
  game.submitDraftBid("a", 2);
  game.submitDraftBid("b", 2);
  assert.equal(game.phase, "DRAFT_PICKING");
  assert.deepEqual(game.pickOrder, ["b", "a"]);
});

function pickAllMarketCards(game) {
  while (game.phase === "DRAFT_PICKING") {
    const picker = game.pickOrder[game.currentPickerIndex];
    const available = game.market.find(({ selectedByPlayerId }) => !selectedByPlayerId);
    game.draftCard(picker, available.id);
  }
}

function completeDraft(game, bids = {}) {
  for (const player of game.activePlayers()) game.submitDraftBid(player.id, bids[player.id] ?? 0);
  pickAllMarketCards(game);
}

test("three- and four-player betting starts under the gun after the big blind", () => {
  const threePlayerGame = new DraftHoldemGame([
    { id: "utg", name: "UTG" },
    { id: "sb", name: "SB" },
    { id: "bb", name: "BB" },
  ]);
  completeDraft(threePlayerGame);
  assert.equal(threePlayerGame.betting.actingPlayerId, "utg");

  const fourPlayerGame = new DraftHoldemGame([
    { id: "dealer", name: "Dealer" },
    { id: "sb", name: "SB" },
    { id: "bb", name: "BB" },
    { id: "utg", name: "UTG" },
  ]);
  completeDraft(fourPlayerGame);
  assert.equal(fourPlayerGame.betting.actingPlayerId, "utg");
});

test("six-player games deal an eight-card market and act after the big blind", () => {
  const game = new DraftHoldemGame([
    { id: "dealer", name: "Dealer" },
    { id: "sb", name: "SB" },
    { id: "bb", name: "BB" },
    { id: "utg", name: "UTG" },
    { id: "middle", name: "Middle" },
    { id: "cutoff", name: "Cutoff" },
  ]);
  assert.equal(game.market.length, 8);
  assert.equal(game.market.filter(({ visibility }) => visibility === "FACE_UP").length, 6);
  completeDraft(game);
  assert.equal(game.betting.actingPlayerId, "utg");
});

test("four-player blind indicators follow A/B → B/C → C/D → D/A", () => {
  const game = new DraftHoldemGame([
    { id: "c", name: "C" },
    { id: "b", name: "B" },
    { id: "a", name: "A" },
    { id: "d", name: "D" },
  ]);
  const rounds = [
    { smallBlind: "b", bigBlind: "a", firstActor: "d", zeroBidOrder: ["a", "b", "c", "d"] },
    { smallBlind: "c", bigBlind: "b", firstActor: "a", zeroBidOrder: ["b", "c", "d", "a"] },
    { smallBlind: "d", bigBlind: "c", firstActor: "b", zeroBidOrder: ["c", "d", "a", "b"] },
    { smallBlind: "a", bigBlind: "d", firstActor: "c", zeroBidOrder: ["d", "a", "b", "c"] },
  ];

  for (const [index, expected] of rounds.entries()) {
    const publicState = game.stateFor("a");
    assert.equal(publicState.players.find((player) => player.seatIndex === publicState.smallBlindSeatIndex).name, expected.smallBlind.toUpperCase(), `round ${index + 1} displayed SB`);
    assert.equal(publicState.players.find((player) => player.seatIndex === publicState.bigBlindSeatIndex).name, expected.bigBlind.toUpperCase(), `round ${index + 1} displayed BB`);
    for (const player of game.activePlayers()) game.submitDraftBid(player.id, 0);
    assert.deepEqual(game.pickOrder, expected.zeroBidOrder, `round ${index + 1} zero-bid order`);
    pickAllMarketCards(game);
    assert.equal(game.betting.actingPlayerId, expected.firstActor, `round ${index + 1} first actor`);
    if (index < rounds.length - 1) game.finishBettingStreet();
  }
});

test("draft timeouts submit zero bids and auto-pick an available card", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  game.handleTimeout();
  assert.equal(game.phase, "DRAFT_PICKING");
  assert.ok(game.players.every((player) => player.draftBid === 0 && player.draftTokens === game.config.draftTokens));
  assert.deepEqual(game.pickOrder, ["b", "a"]);

  const pickerId = game.pickOrder[game.currentPickerIndex];
  const cardsBefore = game.player(pickerId).cards.length;
  game.handleTimeout();
  assert.equal(game.player(pickerId).cards.length, cardsBefore + 1);
});

test("unpicked market cards return to the deck and are reshuffled for later rounds", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  for (const player of game.activePlayers()) game.submitDraftBid(player.id, 0);
  const marketCardIds = game.market.map(({ card: marketCard }) => marketCard.id);
  const pickedCardIds = [];
  while (game.phase === "DRAFT_PICKING") {
    const picker = game.pickOrder[game.currentPickerIndex];
    const available = game.market.find(({ selectedByPlayerId }) => !selectedByPlayerId);
    pickedCardIds.push(available.card.id);
    game.draftCard(picker, available.id);
  }

  const unpickedCardIds = marketCardIds.filter((id) => !pickedCardIds.includes(id));
  assert.equal(game.deck.length, 46);
  assert.ok(unpickedCardIds.every((id) => game.deck.some((card) => card.id === id)));
  assert.ok(pickedCardIds.every((id) => !game.deck.some((card) => card.id === id)));
  assert.ok(game.logs.some(({ message }) => /2 unpicked cards returned to the deck and reshuffled/.test(message)));
});

test("bet timeout checks when legal and folds when facing a bet", () => {
  const facingBlind = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  completeDraft(facingBlind);
  facingBlind.handleTimeout();
  assert.equal(facingBlind.phase, "HAND_COMPLETE");
  assert.equal(facingBlind.result.type, "FOLD");

  const canCheck = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  completeDraft(canCheck);
  canCheck.pokerAction("a", "CALL");
  canCheck.handleTimeout();
  assert.equal(canCheck.phase, "DRAFT_BIDDING");
  assert.equal(canCheck.round, 2);
});

test("a completed hand automatically starts the next hand after five seconds", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  completeDraft(game);
  game.pokerAction("a", "FOLD");
  assert.equal(game.phase, "HAND_COMPLETE");
  assert.equal(game.stateFor("a").players.find(({ id }) => id === "a").handChipDelta, -5);
  assert.equal(game.stateFor("b").players.find(({ id }) => id === "b").handChipDelta, 5);
  assert.equal(game.timerKey(), "1:complete");
  assert.equal(game.timerDurationSeconds(), NEXT_HAND_DELAY_SECONDS);
  game.handleTimeout();
  assert.equal(game.handNumber, 2);
  assert.equal(game.phase, "DRAFT_BIDDING");
});

test("sitting out pauses the next hand until two funded players sit in", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  game.setSittingOut("a", true);
  completeDraft(game);
  game.pokerAction("a", "FOLD");

  assert.equal(game.phase, "HAND_COMPLETE");
  assert.equal(game.timerKey(), null);
  assert.equal(game.stateFor("a").players.find(({ id }) => id === "a").sittingOut, true);

  game.setSittingOut("a", false);
  assert.equal(game.timerKey(), "1:complete");
  game.handleTimeout();
  assert.equal(game.handNumber, 2);
  assert.ok(game.players.every((player) => player.inHand));
});

test("refilling restores the starting stack and preserves the last hand result", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  completeDraft(game);
  game.pokerAction("a", "FOLD");
  const handDelta = game.player("a").handChipDelta;

  game.refillChips("a");

  const player = game.stateFor("a").players.find(({ id }) => id === "a");
  assert.equal(player.chips, game.config.startingStack);
  assert.equal(player.refillCount, 1);
  assert.equal(player.handChipDelta, handDelta);
  assert.throws(() => game.refillChips("a"), /already full/);
});

test("a complete four-round hand gives each contender six cards and settles chips", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ]);
  for (let round = 1; round <= 4; round += 1) {
    completeDraft(game);
    assert.equal(game.market.length, 0, "unused market cards must return to the deck before betting");
    const firstActor = round % 2 === 1 ? "a" : "b";
    const secondActor = firstActor === "a" ? "b" : "a";
    assert.equal(game.betting.actingPlayerId, firstActor, `round ${round} must rotate the heads-up first actor`);
    game.pokerAction(firstActor, round === 1 ? "CALL" : "CHECK");
    game.pokerAction(secondActor, "CHECK");
  }
  assert.equal(game.phase, "HAND_COMPLETE");
  assert.ok(game.players.every((player) => player.cards.length === 6));
  assert.equal(game.players.reduce((total, player) => total + player.chips, 0), 1000);
  assert.equal(game.result.amount, 20);
});

test("all-in players keep bidding and drafting through later rounds", () => {
  const game = new DraftHoldemGame([
    { id: "a", name: "An" },
    { id: "b", name: "Ben" },
  ], { startingStack: 100 });
  completeDraft(game);
  game.pokerAction("a", "ALL_IN");
  game.pokerAction("b", "CALL");
  assert.ok(game.players.every((player) => player.allIn));
  for (let round = 2; round <= 4; round += 1) completeDraft(game);
  assert.equal(game.phase, "HAND_COMPLETE");
  assert.ok(game.players.every((player) => player.cards.length === 6));
  assert.equal(game.players.reduce((total, player) => total + player.chips, 0), 200);
});

test("heads-up blinds and zero-bid pick priority switch between draft rounds", () => {
  const game = new DraftHoldemGame([
    { id: "b", name: "Ben" },
    { id: "a", name: "An" },
  ]);
  assert.equal(game.round, 1);
  assert.equal(game.bigBlindSeatIndex, game.player("a").seatIndex);
  assert.equal(game.smallBlindSeatIndex, game.player("b").seatIndex);
  game.submitDraftBid("a", 0);
  game.submitDraftBid("b", 0);
  assert.deepEqual(game.pickOrder, ["a", "b"]);
  pickAllMarketCards(game);
  assert.ok(game.players.every((player) => player.cards.length === 3));
  assert.equal(game.betting.actingPlayerId, "b");
  game.pokerAction("b", "CALL");
  game.pokerAction("a", "CHECK");

  assert.equal(game.round, 2);
  assert.equal(game.bigBlindSeatIndex, game.player("b").seatIndex);
  assert.equal(game.smallBlindSeatIndex, game.player("a").seatIndex);
  game.submitDraftBid("a", 0);
  game.submitDraftBid("b", 0);
  assert.deepEqual(game.pickOrder, ["b", "a"]);
  pickAllMarketCards(game);
  assert.ok(game.players.every((player) => player.cards.length === 4));
  assert.equal(game.betting.actingPlayerId, "a");
});
