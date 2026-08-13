# AGENTS.md

Drop-in operating instructions for coding agents. Read this file before every task.

**Working code only. Finish the job. Plausibility is not correctness.**

This file follows the [AGENTS.md](https://agents.md) open standard (Linux Foundation / Agentic AI Foundation). Claude Code, Codex, Cursor, Windsurf, Copilot, Aider, Devin, Amp read it natively. For tools that look elsewhere, symlink:

```bash
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md GEMINI.md
```

---

## 0. Non-negotiables

These rules override everything else in this file when in conflict:

1. **No flattery, no filler.** Skip openers like "Great question", "You're absolutely right", "Excellent idea", "I'd be happy to". Start with the answer or the action.
2. **Disagree when you disagree.** If the user's premise is wrong, say so before doing the work. Agreeing with false premises to be polite is the single worst failure mode in coding agents.
3. **Never fabricate.** Not file paths, not commit hashes, not API names, not test results, not library functions. If you don't know, read the file, run the command, or say "I don't know, let me check."
4. **Stop when confused.** If the task has two plausible interpretations, ask. Do not pick silently and proceed.
5. **Touch only what you must.** Every changed line must trace directly to the user's request. No drive-by refactors, reformatting, or "while I was in there" cleanups.

---

## 1. Before writing code

**Goal: understand the problem and the codebase before producing a diff.**

- State your plan in one or two sentences before editing. For anything non-trivial, produce a numbered list of steps with a verification check for each.
- Read the files you will touch. Read the files that call the files you will touch. Claude Code: use subagents for exploration so the main context stays clean.
- Match existing patterns in the codebase. If the project uses pattern X, use pattern X, even if you'd do it differently in a greenfield repo.
- Surface assumptions out loud: "I'm assuming you want X, Y, Z. If that's wrong, say so." Do not bury assumptions inside the implementation.
- If two approaches exist, present both with tradeoffs. Do not pick one silently. Exception: trivial tasks (typo, rename, log line) where the diff fits in one sentence.

---

## 2. Writing code: simplicity first

**Goal: the minimum code that solves the stated problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code. No configurability, flexibility, or hooks that were not requested.
- No error handling for impossible scenarios. Handle the failures that can actually happen.
- If the solution runs 200 lines and could be 50, rewrite it before showing it.
- If you find yourself adding "for future extensibility", stop. Future extensibility is a future decision.
- Bias toward deleting code over adding code. Shipping less is almost always better.

The test: would a senior engineer reading the diff call this overcomplicated? If yes, simplify.

---

## 3. Surgical changes

**Goal: clean, reviewable diffs. Change only what the request requires.**

- Do not "improve" adjacent code, comments, formatting, or imports that are not part of the task.
- Do not refactor code that works just because you are in the file.
- Do not delete pre-existing dead code unless asked. If you notice it, mention it in the summary.
- Do clean up orphans created by your own changes (unused imports, variables, functions your edit made obsolete).
- Match the project's existing style exactly: indentation, quotes, naming, file layout.

The test: every changed line traces directly to the user's request. If a line fails that test, revert it.

---

## 4. Goal-driven execution

**Goal: define success as something you can verify, then loop until verified.**

Rewrite vague asks into verifiable goals before starting:

- "Add validation" becomes "Write tests for invalid inputs (empty, malformed, oversized), then make them pass."
- "Fix the bug" becomes "Write a failing test that reproduces the reported symptom, then make it pass."
- "Refactor X" becomes "Ensure the existing test suite passes before and after, and no public API changes."
- "Make it faster" becomes "Benchmark the current hot path, identify the bottleneck with profiling, change it, show the benchmark is faster."

For every task:

1. State the success criteria before writing code.
2. Write the verification (test, script, benchmark, screenshot diff) where practical.
3. Run the verification. Read the output. Do not claim success without checking.
4. If the verification fails, fix the cause, not the test.

---

## 5. Tool use and verification

- Prefer running the code to guessing about the code. If a test suite exists, run it. If a linter exists, run it. If a type checker exists, run it.
- Never report "done" based on a plausible-looking diff alone. Plausibility is not correctness.
- When debugging, address root causes, not symptoms. Suppressing the error is not fixing the error.
- For UI changes, verify visually: screenshot before, screenshot after, describe the diff.
- Use CLI tools (gh, aws, gcloud, kubectl) when they exist. They are more context-efficient than reading docs or hitting APIs unauthenticated.
- When reading logs, errors, or stack traces, read the whole thing. Half-read traces produce wrong fixes.

---

## 6. Session hygiene

- Context is the constraint. Long sessions with accumulated failed attempts perform worse than fresh sessions with a better prompt.
- After two failed corrections on the same issue, stop. Summarize what you learned and ask the user to reset the session with a sharper prompt.
- Use subagents (Claude Code: "use subagents to investigate X") for exploration tasks that would otherwise pollute the main context with dozens of file reads.
- When committing, write descriptive commit messages (subject under 72 chars, body explains the why). No "update file" or "fix bug" commits. No "Co-Authored-By: Claude" attribution unless the project explicitly wants it.

---

## 7. Communication style

- Direct, not diplomatic. "This won't scale because X" beats "That's an interesting approach, but have you considered...".
- Concise by default. Two or three short paragraphs unless the user asks for depth. No padding, no restating the question, no ceremonial closings.
- When a question has a clear answer, give it. When it does not, say so and give your best read on the tradeoffs.
- Celebrate only what matters: shipping, solving genuinely hard problems, metrics that moved. Not feature ideas, not scope creep, not "wouldn't it be cool if".
- No excessive bullet points, no unprompted headers, no emoji. Prose is usually clearer than structure for short answers.

---

## 8. When to ask, when to proceed

**Ask before proceeding when:**
- The request has two plausible interpretations and the choice materially affects the output.
- The change touches something you've been told is load-bearing, versioned, or has a migration path.
- You need a credential, a secret, or a production resource you don't have access to.
- The user's stated goal and the literal request appear to conflict.

**Proceed without asking when:**
- The task is trivial and reversible (typo, rename a local variable, add a log line).
- The ambiguity can be resolved by reading the code or running a command.
- The user has already answered the question once in this session.

---

## 9. Self-improvement loop

**This file is living. Keep it short by keeping it honest.**

After every session where the agent did something wrong:

1. Ask: was the mistake because this file lacks a rule, or because the agent ignored a rule?
2. If lacking: add the rule under "Project Learnings" below, written as concretely as possible ("Always use X for Y" not "be careful with Y").
3. If ignored: the rule may be too long, too vague, or buried. Tighten it or move it up.
4. Every few weeks, prune. For each line, ask: "Would removing this cause the agent to make a mistake?" If no, delete. Bloated AGENTS.md files get ignored wholesale.

Boris Cherny (creator of Claude Code) keeps his team's file around 100 lines. Under 300 is a good ceiling. Over 500 and you are fighting your own config.

---

## 10. Project context

**Fill this in per project. Keep it specific. Delete sections that don't apply.**

### Stack
- Language and version: JavaScript, ES modules, Node 20+ for tooling
- Framework(s): none. No build step for the client, no runtime dependencies
- Package manager: npm
- Runtime / deployment target: Cloudflare Workers + Durable Objects for the game server; Vercel static hosting for `public/`, deployed from `main`

### Commands
- Install: `npm install`
- Build: none for the client beyond `scripts/build-client-config.mjs`, which Vercel runs
- Test (all): `npm test`
- Test (single file): `node --test test/engine.test.js`
- Lint / typecheck: none configured
- Run locally: `npm run dev` (client on 4173, Worker on 8787)
- Deploy the game server: `npm run deploy`

Prefer single-file or single-test runs during iteration. Full suites are for the final verification pass.

### Layout
- Source lives in: `src/` (`worker.js` routing, `room.js` Durable Object, `engine.js` and `cards.js` rules, `security.js` limits)
- Client lives in: `public/`, served as static files
- Tests live in: `test/`; browser flows in `scripts/ui-smoke.mjs`
- Do not modify: `public/config.js` for a deployment — it is generated from `GAME_SERVER_URL`

### Conventions specific to this repo
- Naming: descriptive camelCase; no abbreviations in identifiers
- Import style: explicit `node:` prefixes, relative paths with extensions
- Error handling pattern: `throw new Error("player-facing sentence")`; the room catches and returns it as an `error` message on that socket
- Testing pattern and framework: `node:test` with `node:assert/strict`; the Worker tests drive a real `wrangler dev` over real WebSockets

### Forbidden
- Do not put the WebSocket server behind Vercel Functions or any serverless request model: room state, hidden cards and turn timers need one stateful process per room.
- Do not use the Durable Object Hibernation API here: it forbids `setTimeout`, which the turn timers depend on.
- Do not add runtime dependencies to the game server; the Workers runtime provides WebSockets natively.

---

## 11. Project Learnings

**Accumulated corrections. This section is for the agent to maintain, not just the human.**

When the user corrects your approach, append a one-line rule here before ending the session. Write it concretely ("Always use X for Y"), never abstractly ("be careful with Y"). If an existing line already covers the correction, tighten it instead of adding a new one. Remove lines when the underlying issue goes away (model upgrades, refactors, process changes).

- Present the in-game rulebook as a visual slide guide; do not use Markdown-document styling or a left navigation panel.
- When the game is opened through a LAN IP, use that exact browser origin for the invite URL instead of another network adapter.
- Resolve zero-token Draft ties and tied re-bids by BB → SB → Cutoff/Dealer → UTG; positive initial ties get exactly one paid secret re-bid and never use Draft Priority.
- When frontend state fields change, show an explicit outdated-host warning and serve local assets with no-store caching instead of leaving controls blank.
- Label every card in the viewer's hand as PUBLIC or PRIVATE; never rely on card position alone to communicate what opponents can see.
- Start 3–4 player Poker betting with the first eligible seat after the Big Blind (UTG); only heads-up betting starts with the Small Blind.
- At every player count, rotate all positions clockwise each Draft round: the current BB becomes SB, the next clockwise eligible player becomes BB, and UTG/Cutoff and first action are recalculated from the new BB; at 0 bids let the current BB pick before the current SB.
- Preserve the current game-table visual baseline: wide centered felt, compact seats, current card/market scale, bottom action dock, and optional hidden action log; do not rearrange or restyle it unless explicitly requested.
- Never place timer text over the table; keep the top timer and active-avatar ring green above 50%, yellow at 50% remaining, and red for the final three seconds.
- Keep guidance supporting copy at least 15px on desktop and section summaries at least 17px; compact game-table typography does not apply to the help panel.
- Keep table contribution chip values clear of the total-pot readout and seat badges, and use the active-avatar ring instead of a center Poker turn indicator.
- Keep the table, seats, cards, and action dock inside supported 320x568-and-larger viewports without requiring browser zoom or fullscreen.
- A socket belongs to one room: connect to `/room/new` to create or `/room/CODE` to join, and never auto-replay `create_room` or `join_room` on reconnect — only `resume`.
- Pixel thresholds in `scripts/ui-smoke.mjs` shift with the browser's font metrics; confirm a layout failure against unmodified `main` in the same browser before treating it as a regression.
- Preserve the unlocked Draft Token input node, focus, selected value, and remaining-token display across synchronized state updates; another player's action must never reset or interrupt it.
- Hide the completed Draft-order strip during `HAND RESULT` so it cannot collide with the winner panel; keep the bottom hand clear of that panel at desktop and mobile widths.

---

## 12. How this file was built

This boilerplate synthesizes:
- Sean Donahoe's IJFW ("It Just F\*cking Works") principles: one install, working code, no ceremony.
- Andrej Karpathy's observations on LLM coding pitfalls (the four principles: think-first, simplicity, surgical changes, goal-driven execution).
- Boris Cherny's public Claude Code workflow (reactive pruning, keep it ~100 lines, only rules that fix real mistakes).
- Anthropic's official Claude Code best practices (explore-plan-code-commit, verification loops, context as the scarce resource).
- Community anti-sycophancy patterns (explicit banned phrases, direct-not-diplomatic).
- The AGENTS.md open standard (cross-tool portability via symlinks).

Read once. Edit sections 10 and 11 for your project. Prune the rest over time. This file gets better the more you use it.
