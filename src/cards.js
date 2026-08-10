import { randomInt } from "node:crypto";

export const SUITS = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 2]));

export function createDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({
    id: `${suit[0]}-${rank}`,
    rank,
    suit,
  })));
}

export function shuffleDeck(deck = createDeck()) {
  const shuffled = deck.map((card) => ({ ...card }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function straightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique[index] - unique[index + 4] === 4) return unique[index];
  }
  return null;
}

export function evaluateFive(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error("evaluateFive requires exactly five cards");
  }

  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => b - a);
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const highStraight = straightHigh(values);

  let category;
  let rank;
  let score;

  if (flush && highStraight) {
    category = highStraight === 14 ? "ROYAL_FLUSH" : "STRAIGHT_FLUSH";
    rank = 9;
    score = [rank, highStraight];
  } else if (groups[0][1] === 4) {
    category = "FOUR_OF_A_KIND";
    rank = 8;
    score = [rank, groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = "FULL_HOUSE";
    rank = 7;
    score = [rank, groups[0][0], groups[1][0]];
  } else if (flush) {
    category = "FLUSH";
    rank = 6;
    score = [rank, ...values];
  } else if (highStraight) {
    category = "STRAIGHT";
    rank = 5;
    score = [rank, highStraight];
  } else if (groups[0][1] === 3) {
    category = "THREE_OF_A_KIND";
    rank = 4;
    score = [rank, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    category = "TWO_PAIR";
    rank = 3;
    score = [rank, ...pairs, groups[2][0]];
  } else if (groups[0][1] === 2) {
    category = "ONE_PAIR";
    rank = 2;
    score = [rank, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  } else {
    category = "HIGH_CARD";
    rank = 1;
    score = [rank, ...values];
  }

  return { category, score, bestFive: cards.map((card) => ({ ...card })) };
}

export function compareEvaluated(left, right) {
  const length = Math.max(left.score.length, right.score.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.score[index] ?? 0) - (right.score[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function evaluateBest(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 6) {
    throw new Error("evaluateBest requires five or six cards");
  }
  if (cards.length === 5) return evaluateFive(cards);

  let best = null;
  for (let omitted = 0; omitted < cards.length; omitted += 1) {
    const evaluated = evaluateFive(cards.filter((_, index) => index !== omitted));
    if (!best || compareEvaluated(evaluated, best) > 0) best = evaluated;
  }
  return best;
}
