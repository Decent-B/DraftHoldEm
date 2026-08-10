# DRAFT HOLD'EM
## Complete Rulebook & Project Specification

> **Version:** 1.1  
> **Players:** 2–4  
> **Core idea:** Poker hand-building + secret drafting + Texas Hold'em-style betting  
> **Final hand:** 6 private cards → choose the best 5-card Poker hand

---

# 1. Project Overview

**Draft Hold'em** is a competitive Poker variant for **2 to 4 players**.

The game combines two separate strategic systems:

1. **Draft Phase**
   - Players spend a limited resource called **Draft Tokens**.
   - Draft Tokens are bid secretly.
   - The bid determines the order in which players choose cards from the market.

2. **Poker Betting Phase**
   - Players use normal **Poker Chips**.
   - Betting follows a Texas Hold'em-style structure:
     - Check
     - Bet
     - Call
     - Raise
     - Fold
     - All-in

The two economies are intentionally separate.

> **Draft Tokens determine how players build their hands.**  
> **Poker Chips determine how players represent, value, and bluff with those hands.**

The game is designed so that a player with a weak hand can still win through pressure and bluffing, while a player with strong cards must still manage Draft Tokens, betting decisions, position, and incomplete information.

---

# 2. Core Design Goals

The game should emphasize:

- Poker hand knowledge.
- Bluffing.
- Range reading.
- Resource management.
- Draft strategy.
- Denying useful cards to opponents.
- Risk versus reward.
- Hidden information.
- Public information.
- Position.
- Adaptation across multiple rounds.

The game should avoid:

- A player winning mostly because of two lucky starting cards.
- Draft bidding and Poker betting becoming the same system.
- Too many random effects.
- Early elimination caused purely by the draft system.
- Excessive rules that make the UI difficult to understand.

---

# 3. Player Count

Let:

```text
X = number of players who started the hand
```

Supported values:

```text
2 ≤ X ≤ 4
```

`X` remains fixed for the entire hand.

Even if one or more players Fold later, the number of market cards opened in future rounds is still based on the original value of `X`.

Example:

```text
4 players start the hand.
X = 4.

One player Folds after Round 2.

Round 3 still opens:
X + 1 face-up + 1 face-down
= 5 face-up + 1 face-down
= 6 market cards.
```

Folded players no longer draft. Therefore, more cards may remain unused after players have Folded.

---

# 4. Components

## 4.1 Standard Poker Deck

```text
52 cards
```

No Jokers.

## 4.2 Poker Chips

Poker Chips are used only for:

- Small Blind.
- Big Blind.
- Bet.
- Call.
- Raise.
- All-in.
- Pot settlement.

Poker Chips **cannot** be used for Draft bidding.

## 4.3 Draft Tokens

Draft Tokens are a separate resource.

Draft Tokens are used only for:

> Secret bidding to determine Draft order.

Draft Tokens:

- Never enter the Poker Pot.
- Cannot be converted into Poker Chips.
- Cannot be transferred to another player.
- Are permanently spent when bid.
- Are not refunded if the player loses Draft priority.

Recommended default:

```text
12 Draft Tokens / player
```

There is **no per-round Draft bid cap**.

A player's only Draft bid limit is the number of Draft Tokens that player currently owns:

```text
0 ≤ Draft bid ≤ remaining Draft Tokens
```

Therefore, a player may spend all remaining Draft Tokens in a single round.

The starting Draft Token amount should remain configurable.

---

# 5. Recommended Default Match Configuration

```yaml
players: 2-4

starting_poker_stack: 500
small_blind: 5
big_blind: 10

starting_draft_tokens: 12
draft_bid_cap: null # no cap; limited only by remaining Draft Tokens

rounds: 4

deck: standard_52
final_private_cards: 6
final_hand_size: 5

betting_mode: no_limit
allow_all_in: true
allow_side_pots: true
```

The default Poker stack is therefore:

```text
500 chips = 50 Big Blinds
```

This gives enough depth for four Poker Betting streets while still allowing meaningful pressure, raises, and bluffs.

---

# 6. Information Model

Every player begins with:

```text
1 face-up private card
+
1 face-down private card
```

The face-up card is visible to everyone.

The face-down card is visible only to its owner.

Both cards belong to the player's final six-card private pool.

Cards drafted face-up remain public.

Cards drafted face-down remain hidden from opponents.

---

# 7. Initial Setup

At the start of a hand:

1. Determine the Dealer/Button.
2. Determine Small Blind and Big Blind.
3. Post the blinds.
4. Shuffle the deck.
5. Deal each player:
   - 1 face-up private card.
   - 1 face-down private card.
6. Give each player the configured number of Draft Tokens.
7. Begin Round 1.

---

# 8. Poker Positions

The Dealer/Button remains fixed for the entire hand.

It moves clockwise between hands.

## 8.1 Two Players

```text
Player A = Button + Small Blind
Player B = Big Blind
```

For Poker Betting phases:

```text
Big Blind acts first.
Button acts last.
```

## 8.2 Three Players

Positions:

```text
Button
Small Blind
Big Blind
```

## 8.3 Four Players

Positions:

```text
Button
Small Blind
Big Blind
Under the Gun / First Seat
```

For all Poker Betting phases after a Draft:

> Action begins with the first active player clockwise to the left of the Button.

The Button therefore acts last whenever possible.

---

# 9. Draft Tie Order

Positive tied bids are resolved through another secret bid among only the tied players.

Every re-bid spends additional Draft Tokens. If the re-bid ties, position resolves it; there is no third bid.

Resolve tied groups from the highest initial bid to the lowest. A re-bid only changes order inside its original tied group.

Players tied at 0 do not re-bid. Both 0-token ties and tied re-bids follow reverse table-seat order:

```text
Big Blind → Small Blind → Cutoff / Dealer → Under the Gun
```

Folded players are skipped. If tied players have no Draft Tokens left, use the same reverse table-seat order.

---

# 10. Round Structure

Every round contains exactly two major phases:

```text
PHASE A — DRAFT
PHASE B — POKER BETTING
```

There are four rounds.

---

# 11. Market Card Formula

Every round begins with exactly:

```text
X + 2 market cards
```

This means that when all original players are still active:

```text
X players draft 1 card each
+
2 cards remain unused
```

The number of unused cards may increase after players Fold.

---

# 12. Round 1

Market:

```text
X face-up cards
+
2 face-down cards
```

Total:

```text
X + 2 cards
```

Examples:

| Players | Face-up | Face-down | Total |
|---:|---:|---:|---:|
| 2 | 2 | 2 | 4 |
| 3 | 3 | 2 | 5 |
| 4 | 4 | 2 | 6 |

After the Draft:

```text
Each active player has 3 private cards.
```

Then Poker Betting Street 1 begins.

---

# 13. Round 2

Market:

```text
X face-up cards
+
2 face-down cards
```

Total:

```text
X + 2 cards
```

After the Draft:

```text
Each active player who has not Folded has 4 private cards.
```

Then Poker Betting Street 2 begins.

---

# 14. Round 3

Market:

```text
X + 1 face-up cards
+
1 face-down card
```

Total:

```text
X + 2 cards
```

After the Draft:

```text
Each active player has 5 private cards.
```

At this point, every remaining player already possesses a complete five-card Poker hand.

Then Poker Betting Street 3 begins.

This is expected to be one of the most strategically important betting streets because players can now evaluate a complete current hand while still having one final Draft remaining.

---

# 15. Round 4

Market:

```text
X + 2 face-up cards
+
0 face-down cards
```

Total:

```text
X + 2 cards
```

After the Draft:

```text
Each remaining player has exactly 6 private cards.
```

Then Poker Betting Street 4 begins.

If at least two non-Folded players remain after betting:

```text
SHOWDOWN
```

---

# 16. Market Progression Summary

| Round | Face-up | Face-down | Total |
|---|---:|---:|---:|
| Round 1 | X | 2 | X + 2 |
| Round 2 | X | 2 | X + 2 |
| Round 3 | X + 1 | 1 | X + 2 |
| Round 4 | X + 2 | 0 | X + 2 |

The information progression is intentional:

```text
Round 1 → high uncertainty
Round 2 → high uncertainty
Round 3 → medium uncertainty
Round 4 → complete market information
```

---

# 17. Draft Phase

Every Round begins with a Draft Phase.

The Draft Phase consists of:

1. Reveal the required market cards.
2. Ask every eligible player to choose a secret Draft Token bid.
3. Lock all bids.
4. Reveal all bids simultaneously.
5. Rank players by Draft bid.
6. Resolve positive tied bids through one secret re-bid, highest tied group first.
7. Resolve 0-token ties and tied re-bids by BB → SB → Cutoff/Dealer → UTG.
8. Players pick cards in the resulting order.
9. Discard unused market cards.
10. Spend every initial bid and re-bid.
11. Proceed to Poker Betting.

---

# 18. Who Is Eligible to Draft?

A player may Draft if the player is:

```text
not Folded
```

A Poker All-in player is still eligible to Draft.

Therefore:

```text
FOLDED:
No Draft.
No Betting.
No Showdown.

ALL-IN:
Yes Draft.
No additional Poker betting.
Yes Showdown.
```

This distinction is critical.

---

# 19. Secret Draft Bid

Every eligible player privately chooses:

```text
0 ≤ bid ≤ available Draft Tokens
```

There is no per-round cap. If a player has 12 Draft Tokens remaining, that player may bid all 12 in the current round.

Example:

```text
Player A: 4
Player B: 1
Player C: 5
Player D: 2
```

Reveal simultaneously.

Draft order:

```text
C → A → D → B
```

---

# 20. Draft Token Spending

All submitted Draft Tokens are spent, including every tie-break re-bid.

Example:

```text
A bids 5.
B bids 4.
C bids 0.

A gets Pick #1.
B gets Pick #2.
C gets Pick #3.

A loses 5 Draft Tokens.
B loses 4 Draft Tokens.
C loses 0 Draft Tokens.
```

A losing bid is not refunded.

This ensures every bid has a real opportunity cost.

---

# 21. Draft Tie Resolution

Example with two positive tied groups:

```text
Initial bids: A 4, B 4, C 2, D 2
Resolve A vs B first.
Resolve C vs D next.
Every re-bid is secret and spent.
```

Example with a 0-token tie:

```text
BB bids 2, SB bids 0, UTG bids 0
Draft order: BB → SB → UTG
```

---

# 22. Drafting a Face-Up Card

If a player chooses a face-up market card:

- The card becomes one of that player's private six-card pool.
- It remains face-up.
- All opponents continue to know that card.

Example:

```text
Player A starts with:
A♠ face-up
7♦ face-down

Round 1:
A drafts Q♠ face-up
```

Public information now includes:

```text
A♠
Q♠
```

The hidden 7♦ remains known only to Player A.

---

# 23. Drafting a Face-Down Card

If a player chooses a face-down market card:

1. The player selects the card.
2. Only that player may view it.
3. The card remains face-down to opponents.
4. It becomes part of that player's private six-card pool.

The selected hidden card is never automatically revealed before Showdown.

---

# 24. Unselected Market Cards

After every eligible player has selected one card:

> All remaining market cards are discarded face-down.

They are not returned to the deck.

If players have Folded, there may be more than two unused market cards.

---

# 25. Why Draft Tokens and Poker Chips Are Separate

The two resources must remain independent.

Draft Tokens answer:

> "How much do I value selection priority?"

Poker Chips answer:

> "How much money am I willing to risk on the strength I represent?"

If the same resource controlled both systems, bluffing would be weakened because a Poker Raise would also carry a direct Draft advantage.

Therefore:

```text
Draft Tokens ≠ Poker Chips
```

There is no conversion between them.

---

# 26. Poker Betting Phase

Immediately after each Draft Phase, begin a Poker Betting Phase.

Betting should feel close to Texas Hold'em.

Supported actions:

```text
CHECK
BET
CALL
RAISE
FOLD
ALL-IN
```

---

# 27. Betting Order

For 3–4 players:

> The first active player clockwise to the left of the Button acts first.

Action continues clockwise.

The Button acts last if still active.

For heads-up:

> The Big Blind acts first after the Draft.

---

# 28. Check

A player may Check if:

```text
currentBet == player's contribution to the current betting street
```

A Check keeps the player in the hand without adding Poker Chips.

---

# 29. Bet

If no wager currently exists on the street, a player may Bet.

Recommended minimum:

```text
minimumBet = Big Blind
```

---

# 30. Call

A player Calls by matching the current highest street contribution.

Example:

```text
Current bet = 8
Player has already contributed = 2
Call amount = 6
```

---

# 31. Raise

A player may increase the current bet.

For No-Limit mode:

```text
maximum raise = player's remaining Poker Chips
```

Minimum Raise follows full-raise logic.

Example:

```text
A bets 4.
B raises to 10.

Raise increment = 6.

Minimum next full Raise:
16
```

---

# 32. Fold

A Fold is permanent for the current hand.

After Folding, a player:

- Cannot Draft in later rounds.
- Cannot Bet.
- Cannot Call.
- Cannot Raise.
- Cannot win any Pot.
- Does not participate in Showdown.
- Does not reveal hidden cards unless voluntarily allowed by game settings.

A player who Folds may participate again in the next hand.

---

# 33. All-In

A player may commit all remaining Poker Chips.

An All-in player:

- Remains in the current hand.
- Cannot make future Poker betting actions.
- Continues Drafting in later rounds.
- Continues spending remaining Draft Tokens.
- Remains eligible for the Main Pot and appropriate Side Pots.
- Participates in Showdown.

This rule allows an All-in player to continue developing the six-card hand.

---

# 34. Betting Street Completion

A Poker Betting Phase ends when:

- Every active non-All-in player has acted.
- Every active non-All-in player has matched the highest required contribution.
- Or all but one player have Folded.

If only one player remains non-Folded:

> The hand ends immediately.

No additional Draft rounds are played.

The remaining player wins the Pot without needing to reveal hidden cards.

---

# 35. Blinds

Recommended:

```text
Small Blind = 1
Big Blind = 2
```

Blinds are posted once at the beginning of the hand.

They are not reposted every Draft round.

---

# 36. Pot

Poker Chips committed through:

- Small Blind.
- Big Blind.
- Bet.
- Call.
- Raise.
- All-in.

go into the Pot.

Draft Tokens never enter the Pot.

---

# 37. Side Pots

If All-in is supported, the engine should support Side Pots.

Example:

```text
Player A total committed: 20
Player B total committed: 50
Player C total committed: 50
```

Main Pot:

```text
20 × 3 = 60
```

Eligible:

```text
A, B, C
```

Side Pot:

```text
(50 - 20) × 2 = 60
```

Eligible:

```text
B, C
```

The UI should clearly show Main Pot, Side Pots, and eligible players.

---

# 38. Final Six Cards

A player who remains active through all four Draft rounds has:

```text
1 initial face-up card
+
1 initial face-down card
+
1 drafted card from Round 1
+
1 drafted card from Round 2
+
1 drafted card from Round 3
+
1 drafted card from Round 4
=
6 private cards
```

---

# 39. Final Poker Hand

At Showdown:

> Each player forms the strongest possible five-card Poker hand from the player's six private cards.

There are:

```text
C(6,5) = 6
```

possible five-card subsets.

The engine automatically evaluates all six combinations and selects the strongest.

---

# 40. Poker Hand Ranking

From strongest to weakest:

1. Royal Flush
2. Straight Flush
3. Four of a Kind
4. Full House
5. Flush
6. Straight
7. Three of a Kind
8. Two Pair
9. One Pair
10. High Card

Standard Poker kicker rules apply.

---

# 41. Ace Rules

Ace may be used as:

```text
High:
10 J Q K A

Low:
A 2 3 4 5
```

Ace cannot wrap.

Invalid:

```text
Q K A 2 3
```

---

# 42. Showdown

If at least two players remain after the final Poker Betting Phase:

```text
SHOWDOWN
```

The game engine:

1. Evaluates each remaining player's best five of six.
2. Determines Pot eligibility.
3. Awards Main Pot.
4. Awards Side Pots.
5. Handles Split Pots if necessary.

---

# 43. Reveal / Muck Rules

To preserve bluffing and long-term meta-game:

## Winner

A player who claims a Pot at Showdown must reveal the five cards used to form the winning hand.

The unused sixth card may remain hidden.

## Losing Player

A losing player may:

```text
Reveal
or
Muck
```

In a digital implementation, the server may evaluate hidden cards without sending them to opponents.

## Win by Fold

If all opponents Fold:

> The winner is not required to reveal any hidden card.

This is important for bluffing.

---

# 44. Bluffing Model

Draft Hold'em contains three different information layers.

## 44.1 Public Card Story

Players can see:

- Initial face-up cards.
- Face-up cards drafted by each opponent.

This creates visible hand narratives.

Example:

```text
A shows:
9♥
J♥
Q♥
```

Opponents may infer:

```text
Flush draw?
Straight draw?
Already holding hearts in hidden cards?
Deliberate misdirection?
```

## 44.2 Draft Bid Story

A large Draft bid may imply:

- A visible card is highly valuable.
- A face-down card is worth gambling for.
- The player wants to deny an opponent.
- The player is manipulating perceived range.

## 44.3 Poker Bet Story

Poker betting is where true Hold'em-style bluffing occurs.

A player may:

```text
Bet / Raise
```

with a weak hand in order to make a stronger opponent Fold.

Because Poker betting provides no direct Draft benefit, the action can credibly represent hand strength.

---

# 45. Example Bluff Sequence

Three players:

```text
A
B
C
```

Player B publicly owns:

```text
9♥
J♥
Q♥
```

but hidden cards are actually:

```text
2♣
7♠
```

B does not have a Flush.

After Round 3:

```text
A checks.
B bets 8.
C calls.
A folds.
```

On a later action, B raises aggressively.

C must evaluate:

- Did B draft hearts because B really has a Flush?
- Is B representing a Flush?
- Did B intentionally construct a fake visible range?
- Is B trying to steal the Pot?

If C Folds:

> B may win with a weak hand without revealing it.

---

# 46. Draft Denial

Players may select a card primarily to deny it to an opponent.

Example:

```text
Player A publicly shows:
K♠
K♦

Market:
K♥
10♣
8♠
4♥
Face-down
```

Player B may Draft K♥ even if K♥ barely improves B's own hand.

Draft denial is legal.

---

# 47. Draft Token Strategy

Players must decide how aggressively to spend a limited resource across four rounds.

Possible styles:

## Early Control

Spend heavily in Round 1–2.

Advantages:

- Strong early hand shaping.
- More control of public information.

Disadvantages:

- Weak Draft leverage in late rounds.

## Late Control

Spend little early.

Advantages:

- Large Draft stack in Round 3–4.
- Strong control when market information is clearer.

Disadvantages:

- Early picks may be poor.

## Balanced

Spread Tokens across all four rounds.

---

# 48. Recommended Draft Token Values

Initial playtest recommendation:

```text
12 Draft Tokens
```

Suggested practical range:

```text
10–16
```

There is no Draft bid cap. A player may bid any whole number from `0` up to all remaining Draft Tokens.

Example allocation patterns with 12 Draft Tokens:

```text
3 / 3 / 3 / 3   balanced
0 / 2 / 4 / 6   late control
8 / 1 / 1 / 2   early aggression
12 / 0 / 0 / 0  all-in Draft commitment
```

The project should expose the starting Draft Token amount in game configuration.

---

# 49. Early Fold Design Consideration

Because there are four Poker Betting streets, shallow Poker stacks may cause players to Fold too early.

Recommended baseline:

```text
500 starting Poker Chips
5 / 10 blinds
= 50 Big Blinds
```

This stack depth is intended to support four Poker Betting streets without making early All-ins or early Folds excessively common.

---

# 50. Hand State Machine

```text
SETUP
  ↓
POST_BLINDS
  ↓
DEAL_INITIAL_CARDS
  ↓
ROUND_1_MARKET
  ↓
ROUND_1_DRAFT_BID
  ↓
ROUND_1_DRAFT_REVEAL
  ↓
ROUND_1_DRAFT_PICK
  ↓
ROUND_1_BETTING
  ↓
ROUND_2_MARKET
  ↓
ROUND_2_DRAFT_BID
  ↓
ROUND_2_DRAFT_REVEAL
  ↓
ROUND_2_DRAFT_PICK
  ↓
ROUND_2_BETTING
  ↓
ROUND_3_MARKET
  ↓
ROUND_3_DRAFT_BID
  ↓
ROUND_3_DRAFT_REVEAL
  ↓
ROUND_3_DRAFT_PICK
  ↓
ROUND_3_BETTING
  ↓
ROUND_4_MARKET
  ↓
ROUND_4_DRAFT_BID
  ↓
ROUND_4_DRAFT_REVEAL
  ↓
ROUND_4_DRAFT_PICK
  ↓
ROUND_4_BETTING
  ↓
SHOWDOWN
  ↓
PAYOUT
  ↓
HAND_COMPLETE
```

At every Poker Betting state:

```text
if activeNonFoldedPlayers == 1:
    PAYOUT
    HAND_COMPLETE
```

---

# 51. Recommended Game Phase Enum

```ts
export enum GamePhase {
  SETUP = "SETUP",
  POST_BLINDS = "POST_BLINDS",
  DEAL_INITIAL = "DEAL_INITIAL",

  ROUND_MARKET = "ROUND_MARKET",
  DRAFT_BIDDING = "DRAFT_BIDDING",
  DRAFT_REVEAL = "DRAFT_REVEAL",
  DRAFT_PICKING = "DRAFT_PICKING",

  POKER_BETTING = "POKER_BETTING",

  SHOWDOWN = "SHOWDOWN",
  PAYOUT = "PAYOUT",
  HAND_COMPLETE = "HAND_COMPLETE",
}
```

```ts
type RoundNumber = 1 | 2 | 3 | 4;
```

---

# 52. Card Model

```ts
export type Suit =
  | "SPADES"
  | "HEARTS"
  | "DIAMONDS"
  | "CLUBS";

export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
}
```

---

# 53. Owned Card Model

```ts
export interface OwnedCard {
  card: Card;
  ownerId: string;

  source:
    | "INITIAL_FACE_UP"
    | "INITIAL_FACE_DOWN"
    | "ROUND_1"
    | "ROUND_2"
    | "ROUND_3"
    | "ROUND_4";

  visibility:
    | "PUBLIC"
    | "OWNER_ONLY";
}
```

A card drafted face-up receives:

```ts
visibility: "PUBLIC"
```

A card drafted face-down receives:

```ts
visibility: "OWNER_ONLY"
```

---

# 54. Player State

```ts
export interface PlayerState {
  id: string;
  name: string;
  seatIndex: number;

  pokerChips: number;
  draftTokens: number;

  cards: OwnedCard[];

  folded: boolean;
  allIn: boolean;

  currentStreetContribution: number;
  totalHandContribution: number;

  draftBid: number | null;
  hasActedThisStreet: boolean;
}
```

---

# 55. Market Card Model

```ts
export interface MarketCard {
  id: string;
  card: Card;

  visibility:
    | "FACE_UP"
    | "FACE_DOWN";

  selectedByPlayerId?: string;
  marketSlot: number;
}
```

Important:

> For network multiplayer, the actual value of a FACE_DOWN market card must not be sent to unauthorized clients.

---

# 56. Pot Model

```ts
export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}
```

For Side Pots:

```ts
pots: Pot[];
```

---

# 57. Draft State

```ts
export interface DraftState {
  round: RoundNumber;
  market: MarketCard[];
  prioritySeatIndex: number;
  bidsLocked: boolean;
  revealedBids: Record<string, number>;
  pickOrder: string[];
  currentPickerIndex: number;
}
```

---

# 58. Betting State

```ts
export interface BettingState {
  currentBet: number;
  minimumRaiseIncrement: number;
  actingPlayerId: string | null;
  lastAggressorId: string | null;
  streetComplete: boolean;
}
```

---

# 59. Full Hand State

```ts
export interface HandState {
  handId: string;
  playerCountAtStart: number;
  dealerSeatIndex: number;
  round: RoundNumber;
  phase: GamePhase;
  deck: Card[];
  players: PlayerState[];
  draft: DraftState | null;
  betting: BettingState | null;
  pots: Pot[];
  winnerIds: string[];
}
```

---

# 60. Market Generation Function

```ts
function getMarketLayout(
  playerCountAtStart: number,
  round: RoundNumber
) {
  const X = playerCountAtStart;

  switch (round) {
    case 1:
    case 2:
      return {
        faceUp: X,
        faceDown: 2,
        total: X + 2,
      };

    case 3:
      return {
        faceUp: X + 1,
        faceDown: 1,
        total: X + 2,
      };

    case 4:
      return {
        faceUp: X + 2,
        faceDown: 0,
        total: X + 2,
      };
  }
}
```

---

# 61. Draft Order Algorithm

```ts
function resolveDraftOrder(
  eligiblePlayers,
  bigBlindSeat
) {
  group players by initial bid, descending

  for each tied group, highest bid first:
    if bid == 0:
      order backward from bigBlindSeat
    else:
      request secret re-bids
      spend every re-bid
      if the re-bid ties, order that subgroup backward from bigBlindSeat

  return flattened groups
}
```

---

# 62. Draft Phase Algorithm

```text
openMarket()

eligiblePlayers =
    players where folded == false

requestSecretDraftBids()

wait until all eligible players lock bid

revealDraftBids()

pickOrder =
    initial bid groups descending
    positive ties resolved by one secret paid re-bid
    0-token ties and tied re-bids ordered BB → SB → Cutoff/Dealer → UTG

for player in pickOrder:
    player chooses one remaining market card
    transfer card to player

discard all remaining market cards

deduct all initial bids and re-bids

start Poker Betting
```

---

# 63. Poker Betting Engine

Betting action order:

- With 3–4 players, the first eligible seat after the Big Blind acts first (Under the Gun), then action continues around the table.
- Every Draft round, the current Small Blind and Big Blind exchange roles; other positions stay unchanged.
- Heads-up, the current Small Blind acts first.

The Poker engine should track:

```text
current street contribution
current highest bet
minimum raise increment
remaining stack
all-in state
fold state
acted state
```

A betting street is complete only when every non-All-in active player:

```text
has acted
AND
has matched the current bet
```

unless only one player remains.

---

# 64. Poker Action Validation

## Check

Legal if:

```ts
player.currentStreetContribution === betting.currentBet
```

## Call

Legal if:

```ts
player.currentStreetContribution < betting.currentBet
```

Call amount:

```ts
Math.min(
  betting.currentBet - player.currentStreetContribution,
  player.pokerChips
)
```

If player cannot fully Call:

```text
player becomes All-in
```

## Bet

Legal if:

```text
betting.currentBet === 0
```

## Raise

Legal if:

```text
betting.currentBet > 0
```

and the player has enough chips for a legal raise or is going All-in.

## Fold

Legal whenever the rules allow surrendering the hand.

Recommended UI protection:

- If Check is legal, visually de-emphasize Fold to reduce accidental Fold.

---

# 65. All-In and Future Drafts

Unique rule:

> Poker All-in does not freeze the player's cards.

If Player A goes All-in in Round 2:

```text
Round 3:
A still Secret Bids Draft Tokens.
A still Drafts one card.

Poker Betting:
A takes no action.

Round 4:
A still Drafts one card.
```

Suggested UI badge:

```text
ALL-IN — STILL DRAFTING
```

---

# 66. Fold and Future Drafts

If Player B Folds in Round 2:

```text
Round 3:
B submits no Draft bid.
B picks no card.

Round 4:
B submits no Draft bid.
B picks no card.
```

B's cards remain hidden/mucked unless reveal rules say otherwise.

---

# 67. Hand Evaluation

The evaluator should accept:

```ts
Card[6]
```

and test all six possible five-card subsets.

Suggested API:

```ts
interface EvaluatedHand {
  category:
    | "ROYAL_FLUSH"
    | "STRAIGHT_FLUSH"
    | "FOUR_OF_A_KIND"
    | "FULL_HOUSE"
    | "FLUSH"
    | "STRAIGHT"
    | "THREE_OF_A_KIND"
    | "TWO_PAIR"
    | "ONE_PAIR"
    | "HIGH_CARD";

  score: number[];
  bestFive: Card[];
}
```

Comparison should use lexicographic score arrays.

---

# 68. Suggested Project Modes

The UI may support:

## Local Hot-Seat

One shared device.

Hidden information requires a privacy handoff screen.

## Local Multiplayer

Multiple devices on the same network.

One authoritative host/server.

## Online Multiplayer

Server-authoritative state.

Recommended for the cleanest hidden-information implementation.

---

# 69. Security Rule for Multiplayer

Never trust clients with hidden information.

The server should own:

- Deck order.
- Face-down market cards.
- Face-down player cards.
- Secret Draft bids before reveal.
- Hand evaluation.
- Pot settlement.

Bad architecture:

```text
Send every card to every browser
and hide cards with CSS.
```

Do not do this.

Correct architecture:

```text
Server filters game state per viewer.
```

---

# 70. Viewer-Specific State

Recommended function:

```ts
function getPublicStateForViewer(
  state: HandState,
  viewerPlayerId: string
): ViewerState
```

Rules:

- Public cards → visible to all.
- Owner-only cards → visible only to owner.
- Secret Draft bids → hidden until reveal.
- Folded hidden cards → never sent unless revealed.
- Face-down unselected market cards → never revealed.

---

# 71. UI Design Direction

Recommended aesthetic:

> Premium casino table + modern competitive strategy game.

Avoid making the screen look like a generic online Poker clone.

Suggested visual language:

- Dark felt table.
- Deep charcoal background.
- Warm gold separators.
- High-contrast white typography.
- Red accents for aggressive Poker actions.
- Blue/cyan visual language for Draft Tokens.
- Smooth card movement.
- Strong focus glow around current actor.
- Minimal glass effects.
- Large readable cards.

---

# 72. Main Game Screen Layout

Desktop suggestion:

```text
┌──────────────────────────────────────────────────────────┐
│ Hand #12          POT 46        ROUND 3 / 4             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                   PLAYER NORTH                           │
│                 stack / tokens                           │
│                 public cards                             │
│                                                          │
│          ┌──────────────────────────────┐                │
│          │         MARKET AREA          │                │
│          │  [Q♥] [9♠] [??] [A♣] [7♦]   │                │
│          └──────────────────────────────┘                │
│                                                          │
│ PLAYER LEFT                           PLAYER RIGHT        │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ YOUR CARDS                                               │
│ [A♠] [??] [Q♠] [??] [8♦]                                │
│                                                          │
│ Poker Chips: 72       Draft Tokens: 5                    │
│                                                          │
│ [CHECK] [BET] [RAISE] [FOLD]                             │
└──────────────────────────────────────────────────────────┘
```

---

# 73. Market UI

Market cards should be centered and visually dominant during Draft.

Face-up card:

```text
normal Poker card
```

Face-down card:

```text
ornamental back design
subtle pulse / mystery glow
```

When Draft order is known:

```text
#1 Player A
#2 Player C
#3 Player B
```

Display Draft pick order above the market.

---

# 74. Draft Bid UI

Before reveal:

```text
DRAFT BID

Tokens available: 7

[-]  3  [+]

[LOCK BID]
```

After lock:

```text
BID LOCKED
Waiting for 2 players...
```

Never show another player's bid before every eligible player has locked.

---

# 75. Draft Reveal Animation

Suggested sequence:

1. Dim market slightly.
2. Show each player's closed Draft Token stack.
3. Countdown:
   ```text
   3
   2
   1
   REVEAL
   ```
4. Flip all bid indicators simultaneously.
5. Highlight ranking.
6. Animate Draft Order numbers.
7. Restore focus to the market.

Target duration:

```text
1.5–2.5 seconds
```

---

# 76. Draft Pick Animation

When a player selects a card:

1. Selected card rises slightly.
2. Other market cards dim.
3. Card moves toward player's area.
4. If face-up:
   - stays visible.
5. If face-down:
   - remains face-down for opponents.
   - flips privately on owner's screen.

---

# 77. Poker Betting UI

During Poker Betting, Draft controls disappear.

Primary actions:

```text
CHECK
CALL X
BET
RAISE
FOLD
ALL-IN
```

Bet/Raise uses:

- Slider.
- Numeric input.
- Quick sizes.

Recommended quick sizes:

```text
1/3 Pot
1/2 Pot
2/3 Pot
Pot
All-In
```

These are UI shortcuts only.

---

# 78. Information Panel

The UI should always show:

```text
Round
Current Phase
Pot
Main / Side Pots
Current actor
Current bet
Minimum raise
Player stacks
Draft Tokens remaining
Number of hidden cards per player
Number of public cards per player
```

Do **not** show inferred hand strength automatically during live play unless an assistance mode explicitly enables it.

---

# 79. Player Panel

Each Player Panel should include:

```text
Avatar
Name
Poker Chip stack
Draft Tokens
Position
Folded / All-In status
Public cards
Number of hidden cards
Current street bet
Turn timer
```

Do not display hidden cards of opponents.

---

# 80. Public Card Layout

Public cards belonging to a player should form a visible row near that player.

Example:

```text
PLAYER B

Visible:
9♥  J♥  Q♥

Hidden:
● ●
```

This creates the visual range-reading layer.

---

# 81. Local Hot-Seat Privacy Mode

If all players use one screen:

Before showing a player's hidden information:

```text
PASS DEVICE TO PLAYER B
```

Require:

```text
PRESS AND HOLD TO VIEW
```

On release:

```text
hidden cards disappear
```

Draft bid entry should use the same privacy handoff.

---

# 82. Responsive Mobile UI

Mobile should prioritize:

1. Market.
2. Player's own cards.
3. Current action.
4. Pot.
5. Opponent public information.

Opponent panels may collapse into compact seats around the table.

Avoid tiny card ranks.

---

# 83. Animation Principles

Animations should communicate state, not decorate everything.

Use animation for:

- Card dealing.
- Draft bid reveal.
- Draft card selection.
- Poker Chips entering the Pot.
- Fold.
- All-in.
- Showdown.
- Pot payout.

Avoid constant ambient animation that reduces readability.

---

# 84. Sound Design

Optional sounds:

- Card deal.
- Chip stack.
- Draft lock.
- Draft reveal.
- Check.
- Fold.
- All-in.
- Showdown.
- Win.

All sounds must have:

```text
mute control
volume control
```

---

# 85. Recommended Color Semantics

Example UI semantics:

```text
Blue / Cyan:
Draft system

Red:
Bet / Raise / aggression

Green:
Check / Call

Gold:
Pot / winner / priority

Gray:
Folded / inactive

Purple:
All-in
```

Exact colors should remain theme-configurable.

---

# 86. Suggested Front-End Stack

Recommended:

```text
Next.js
React
TypeScript
Tailwind CSS
Framer Motion
Zustand or Redux Toolkit
```

For card interactions:

```text
dnd-kit
```

For multiplayer:

```text
WebSocket / Socket.IO
```

Alternative:

```text
React + Vite
```

is sufficient for a local-only implementation.

---

# 87. Suggested Back-End Stack

For online multiplayer:

```text
Node.js
TypeScript
WebSocket / Socket.IO
```

Optional database:

```text
PostgreSQL
```

Optional ORM:

```text
Prisma
```

Game state should remain server-authoritative.

---

# 88. Suggested Folder Structure

```text
src/
├── app/
│   ├── game/
│   ├── lobby/
│   └── settings/
│
├── components/
│   ├── cards/
│   │   ├── PokerCard.tsx
│   │   ├── CardBack.tsx
│   │   └── CardFan.tsx
│   │
│   ├── draft/
│   │   ├── DraftBidPanel.tsx
│   │   ├── DraftReveal.tsx
│   │   ├── DraftOrder.tsx
│   │   └── Market.tsx
│   │
│   ├── poker/
│   │   ├── BettingControls.tsx
│   │   ├── PotDisplay.tsx
│   │   ├── ChipStack.tsx
│   │   └── Showdown.tsx
│   │
│   ├── players/
│   │   ├── PlayerSeat.tsx
│   │   ├── PlayerPublicCards.tsx
│   │   └── PlayerStatus.tsx
│   │
│   └── layout/
│       └── PokerTable.tsx
│
├── game/
│   ├── engine/
│   │   ├── gameState.ts
│   │   ├── phaseMachine.ts
│   │   ├── draftEngine.ts
│   │   ├── bettingEngine.ts
│   │   ├── potEngine.ts
│   │   └── showdownEngine.ts
│   │
│   ├── poker/
│   │   ├── evaluateFive.ts
│   │   ├── evaluateSix.ts
│   │   └── compareHands.ts
│   │
│   ├── deck/
│   │   ├── createDeck.ts
│   │   ├── shuffleDeck.ts
│   │   └── deal.ts
│   │
│   └── rules/
│       ├── roundConfig.ts
│       ├── draftRules.ts
│       └── bettingRules.ts
│
├── store/
│   └── gameStore.ts
│
├── types/
│   ├── cards.ts
│   ├── player.ts
│   ├── game.ts
│   └── actions.ts
│
└── utils/
```

---

# 89. Game Events

Recommended event model:

```ts
type GameEvent =
  | { type: "HAND_STARTED" }
  | { type: "BLINDS_POSTED" }
  | { type: "INITIAL_CARDS_DEALT" }
  | { type: "MARKET_OPENED"; round: RoundNumber }
  | { type: "DRAFT_BID_SUBMITTED"; playerId: string }
  | { type: "DRAFT_BIDS_REVEALED" }
  | { type: "CARD_DRAFTED"; playerId: string; marketCardId: string }
  | { type: "POKER_CHECK"; playerId: string }
  | { type: "POKER_BET"; playerId: string; amount: number }
  | { type: "POKER_CALL"; playerId: string; amount: number }
  | { type: "POKER_RAISE"; playerId: string; amount: number }
  | { type: "POKER_FOLD"; playerId: string }
  | { type: "POKER_ALL_IN"; playerId: string }
  | { type: "SHOWDOWN_STARTED" }
  | { type: "POT_AWARDED" }
  | { type: "HAND_COMPLETED" };
```

Event-based game logic makes replay, debugging, spectator mode, match history, and reconnect easier.

---

# 90. Action Log

The UI should keep a readable action log.

Example:

```text
Round 3

A bid 2 Draft Tokens.
B bid 5 Draft Tokens.
C bid 1 Draft Token.

Draft order:
B → A → C

B drafted Q♥.
A drafted a hidden card.
C drafted 8♣.

Poker Betting:
A checks.
B bets 6.
C calls 6.
A raises to 18.
B folds.
C calls.
```

For hidden Draft cards, never log the card value publicly.

Use:

```text
A drafted a hidden card.
```

---

# 91. Spectator Mode

Spectators should see only public information during live play.

Optional administrator/debug mode may see complete state.

Never expose administrator information through normal client state.

---

# 92. Reconnect Logic

A reconnecting player should receive:

- Current public state.
- Their own private cards.
- Their own remaining Draft Tokens.
- Their own locked Draft bid if reveal has not occurred.
- Their legal actions.
- Current timers.

They must not receive:

- Other players' secret bids.
- Other players' hidden cards.
- Face-down market card values.

---

# 93. Turn Timers

Suggested default:

```text
Draft bid: 20 seconds
Draft pick: 20 seconds
Poker action: 25 seconds
```

Configurable.

On Draft bid timeout:

```text
auto-bid 0
```

On Draft pick timeout:

```text
randomly choose one remaining legal market card
```

On Poker timeout:

```text
Check if Check is legal.
Otherwise Fold.
```

---

# 94. Disconnection

Recommended:

Short disconnect:

```text
pause timer for configurable grace period
```

Long disconnect:

- Draft bid → 0.
- Draft pick → random.
- Poker action → Check if possible, otherwise Fold.

---

# 95. Validation Rules

The server must validate:

- Correct player turn.
- Correct phase.
- Draft bid is a whole number from 0 through the player's remaining Draft Tokens.
- Market card still available.
- Player not Folded.
- Poker action legal.
- Poker Chip amount legal.
- Minimum Raise legal.
- All-in state.
- Pot eligibility.
- Deck card uniqueness.

---

# 96. Critical Invariants

The engine should assert:

```text
No card exists in two locations.
No player's Draft Tokens become negative.
No player's Poker Chips become negative.
A Folded player never Drafts.
An All-in player never performs a later Poker betting action.
An All-in player may continue Drafting.
Every non-Folded player receives at most one card per Draft round.
A player who reaches Round 4 without Folding has exactly 6 cards.
All secret Draft bids remain hidden until every eligible player has locked.
Only authorized viewers receive hidden card values.
```

---

# 97. Unit Tests — Market

For X = 2:

```text
R1 = 2 up + 2 down
R2 = 2 up + 2 down
R3 = 3 up + 1 down
R4 = 4 up
```

For X = 3:

```text
R1 = 3 up + 2 down
R2 = 3 up + 2 down
R3 = 4 up + 1 down
R4 = 5 up
```

For X = 4:

```text
R1 = 4 up + 2 down
R2 = 4 up + 2 down
R3 = 5 up + 1 down
R4 = 6 up
```

---

# 98. Unit Tests — Draft

Test:

- Higher bid picks earlier.
- Positive tie triggers another secret, paid re-bid.
- Re-bid tie resolves BB → SB → Cutoff/Dealer → UTG without another bid.
- 0-token tie uses the same positional order.
- Draft Tokens are spent.
- Bid 0 is legal.
- Face-down card remains private.
- Face-up drafted card stays public.
- Folded player excluded.
- All-in player included.

---

# 99. Unit Tests — Poker

Test:

- Check legality.
- Bet legality.
- Call amount.
- Raise minimum.
- Fold.
- All-in.
- Betting street completion.
- Side Pot creation.
- Win by Fold.
- Multiway Showdown.

---

# 100. Unit Tests — Hand Evaluation

Test every category:

```text
Royal Flush
Straight Flush
Four of a Kind
Full House
Flush
Straight
Three of a Kind
Two Pair
One Pair
High Card
```

Also test:

```text
A-2-3-4-5 Straight
10-J-Q-K-A Straight
Kicker comparison
6-card best-five selection
Split Pot
```

---

# 101. Example Complete Hand

Three players:

```text
X = 3
```

Starting cards:

```text
A:
A♠ public
7♦ hidden

B:
9♥ public
K♣ hidden

C:
Q♠ public
Q♦ hidden
```

## Round 1 Market

```text
J♥
5♣
2♠
[hidden]
[hidden]
```

Secret Draft bids:

```text
A = 2
B = 4
C = 1
```

Draft order:

```text
B → A → C
```

B chooses:

```text
J♥
```

A chooses:

```text
hidden card
```

C chooses:

```text
5♣
```

Unused cards are discarded.

## Round 1 Poker Betting

```text
A checks.
B bets 4.
C calls.
A folds.
```

A is now permanently out of the hand.

## Round 2 Market

`X` remains 3.

Therefore market is still:

```text
3 face-up
+
2 face-down
```

Only B and C Draft.

Suppose:

```text
B bid 1
C bid 3
```

Draft order:

```text
C → B
```

Three market cards remain unused after both active players choose.

## Later All-In Example

Suppose B goes All-in during Round 3 Poker Betting.

B remains active.

In Round 4:

```text
B still submits a Draft Token bid.
B still picks one card.
B takes no Poker betting action.
```

At Showdown:

```text
B remains eligible for the appropriate Pot.
```

---

# 102. Match / Session Rules

The project may support multiple hands.

Between hands:

1. Award Pot.
2. Display hand result.
3. Move Dealer/Button clockwise.
4. Reset Draft Tokens to configured starting amount.
5. Keep Poker Chip stacks if playing tournament/cash-session mode.
6. Shuffle a new deck.
7. Begin next hand.

---

# 103. Optional Tournament Mode

Players begin with a fixed Poker Chip stack.

Draft Tokens reset every hand.

A player is eliminated from the match only when:

```text
Poker Chip stack == 0
```

Tournament blind levels may increase over time.

---

# 104. Optional Single-Hand Game Mode

For party/game-show use:

- Every player gets the same Poker Chip stack.
- Play exactly one hand.
- Winner of the Pot wins the game.
- Draft Tokens are fully disposable.
- No tournament elimination system is required.

---

# 105. Settings Screen

Recommended settings:

```text
Player count
Player names
Starting Poker Chips
Small Blind
Big Blind
Starting Draft Tokens
Turn timer
All-in enabled
Side Pots enabled
Sound enabled
Animation speed
Reveal/muck mode
Game mode
```

---

# 106. Lobby UI

The lobby should show:

- Seats 1–4.
- Player ready state.
- Host badge.
- Configuration summary.
- Start button.

Example:

```text
DRAFT HOLD'EM

Players: 3 / 4

A      READY
B      READY
C      READY
[OPEN SEAT]

Blinds: 5 / 10
Stack: 500
Draft Tokens: 12
Draft Bid Cap: NONE

[START GAME]
```

---

# 107. Round Header

The game should clearly communicate:

```text
ROUND 2 / 4

DRAFT PHASE
3 FACE-UP + 2 HIDDEN
```

Then:

```text
ROUND 2 / 4

POKER BETTING
CURRENT BET: 8
```

Never make the player guess which resource is currently usable.

---

# 108. Resource Separation in UI

Poker Chips and Draft Tokens should never share the same visual component.

Recommended:

```text
Poker Chips:
stacked casino chips

Draft Tokens:
flat metallic tokens / gems / coins
```

The Draft Bid panel should never accept Poker Chip values.

The Poker Betting panel should never display Draft Token controls.

---

# 109. Result Screen

Show:

```text
Winner
Winning five-card hand
Hand category
Pot won
Optional sixth card status
```

Example:

```text
PLAYER B WINS

FULL HOUSE
Q♠ Q♦ Q♥ 8♣ 8♦

POT: 74
```

If winner wins by Fold:

```text
PLAYER B WINS

ALL OPPONENTS FOLDED

CARDS NOT SHOWN
```

---

# 110. Recommended MVP Scope

For the first playable version, implement:

1. 2–4 local players.
2. 52-card deck.
3. Initial 1 face-up + 1 face-down.
4. Four market rounds.
5. Draft Tokens.
6. Secret bid.
7. Draft order.
8. Face-up / face-down ownership.
9. Poker Chips.
10. Check / Bet / Call / Raise / Fold.
11. All-in.
12. Best 5 of 6 evaluation.
13. Pot settlement.
14. Clean responsive UI.

Optional for V2:

- Online multiplayer.
- Match history.
- Replay.
- Spectator.
- Tournament levels.
- Statistics.
- AI opponents.

---

# 111. Recommended Development Order

## Phase 1 — Pure Engine

Implement without UI:

- Deck.
- Round market.
- Draft order.
- Player card ownership.
- Poker hand evaluator.
- Poker betting.
- Fold.
- All-in.
- Pot.

## Phase 2 — Minimal UI

Implement:

- Table.
- Player seats.
- Cards.
- Market.
- Draft bidding.
- Draft pick.
- Poker actions.

## Phase 3 — Visual Polish

Add:

- Animations.
- Sound.
- Responsive design.
- Action log.
- Pot animations.
- Showdown sequence.

## Phase 4 — Multiplayer

Move authority to server.

Add:

- Lobby.
- Private state filtering.
- WebSocket events.
- Reconnect.
- Timers.

---

# 112. Balance Metrics to Record During Playtesting

The game should record:

```text
Average Draft Token bid by round
Average Poker Pot size
Fold frequency by round
Average number of players reaching Showdown
Win-by-Fold percentage
Win-at-Showdown percentage
Average Draft Tokens remaining after Round 4
First-pick win correlation
Face-down Draft frequency
Public-card Draft frequency
All-in frequency
Average hand category at Showdown
```

These statistics help determine whether:

- Draft order is too powerful.
- Draft Tokens are too abundant.
- Bluffing happens often enough.
- Players Fold too early.
- Final hands are too strong.
- Hidden cards are too attractive or too weak.

---

# 113. Initial Balance Hypotheses

Recommended first playtest:

```text
Poker stack: 500
Blinds: 5 / 10
Draft Tokens: 12
Draft bid cap: NONE
```

Expected behavior:

```text
Round 1:
moderate Draft spending
light Poker pressure

Round 2:
range starts becoming readable

Round 3:
strong strategic Draft spending
meaningful bluffing

Round 4:
highest-information Draft
largest Poker pressure
```

If players consistently spend all Draft Tokens before Round 3:

```text
increase starting Draft Tokens
or
reconsider the reward structure for early Draft control
```

If everyone saves everything for Round 4:

```text
reduce total Draft Tokens
or
increase the relative value of early Draft control
```

If too many players Fold in Round 1:

```text
increase Poker starting stack
reduce blinds
or
reduce common opening Bet sizes
```

---

# 114. Rule Summary

```text
2–4 players.

Each player starts with:
1 face-up private card
1 face-down private card.

There are 4 rounds.

Every round has:
1. Draft Phase.
2. Poker Betting Phase.

Round 1:
X face-up + 2 hidden.

Round 2:
X face-up + 2 hidden.

Round 3:
X + 1 face-up + 1 hidden.

Round 4:
X + 2 face-up.

Every market contains:
X + 2 cards.

Players secretly bid Draft Tokens.

Higher Draft bid:
earlier Draft pick.

Positive tie:
one secret paid re-bid; a draw uses position.

0-token tie:
Big Blind → Small Blind → Cutoff/Dealer → Under the Gun.

Every active player drafts at most 1 card per round.

Draft Tokens:
do not enter the Pot.

After the Draft:
Texas Hold'em-style Poker betting.

Poker Chips:
Check / Bet / Call / Raise / Fold / All-in.

Fold:
player leaves the hand and stops Drafting.

All-in:
player stops Poker betting but continues Drafting.

After Round 4:
remaining players have 6 cards.

Choose best 5 of 6.

Best Poker hand wins the Pot.

A player may also win immediately if every opponent Folds.
```

---

# 115. Core Identity of the Game

The key identity of Draft Hold'em is:

> **Visible cards create a story.**  
> **Hidden cards create uncertainty.**  
> **Draft Tokens determine access.**  
> **Poker Chips create pressure.**  
> **Bluffing determines whether opponents believe the story.**

The project should preserve this separation in both rules and UI.

---

# 116. Final Recommended Rule Formula

```text
START

X = 2–4 players

Each player:
1 PUBLIC PRIVATE CARD
+
1 HIDDEN PRIVATE CARD

↓

ROUND 1
X PUBLIC + 2 HIDDEN MARKET
→ SECRET DRAFT BID
→ DRAFT
→ POKER BETTING

↓

ROUND 2
X PUBLIC + 2 HIDDEN MARKET
→ SECRET DRAFT BID
→ DRAFT
→ POKER BETTING

↓

ROUND 3
X+1 PUBLIC + 1 HIDDEN MARKET
→ SECRET DRAFT BID
→ DRAFT
→ POKER BETTING

↓

ROUND 4
X+2 PUBLIC MARKET
→ SECRET DRAFT BID
→ DRAFT
→ POKER BETTING

↓

6 PRIVATE CARDS / REMAINING PLAYER

↓

BEST 5 OF 6

↓

SHOWDOWN
OR
WIN BY FOLD
```

---

# 117. Product Tagline

Recommended:

> **Build the hand. Sell the story.**

Alternatives:

> **Draft your cards. Bluff your opponents.**

> **Every card tells a story. Not every story is true.**
