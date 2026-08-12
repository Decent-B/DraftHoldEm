import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const port = 4397;
const baseUrl = `http://127.0.0.1:${port}`;
const browserPath = process.env.BROWSER_PATH || [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!browserPath) throw new Error("Microsoft Edge or Google Chrome is required for the UI test");
const server = spawn(process.execPath, ["src/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Server did not become ready");
}

let browser;
try {
  await waitForServer();
  const appResponse = await fetch(`${baseUrl}/app.js`);
  if (appResponse.headers.get("cache-control") !== "no-store") throw new Error("Frontend assets must not be cached during local updates");
  for (const audioFile of ["background.mp3", "placing-chip.mp3", "placing-card.mp3", "all-in.mp3"]) {
    const response = await fetch(`${baseUrl}/audio/${audioFile}`);
    if (!response.ok || response.headers.get("content-type") !== "audio/mpeg" || Number(response.headers.get("content-length")) < 1000) {
      throw new Error(`Audio asset is not served correctly: ${audioFile}`);
    }
  }
  const networkAddresses = (await (await fetch(`${baseUrl}/network`)).json()).addresses ?? [];
  const lanOrigin = networkAddresses.find((address) => !address.includes("localhost")) ?? baseUrl;
  await mkdir("artifacts", { recursive: true });
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const extraPlayer = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  await desktop.addInitScript(() => {
    window.__playedAudio = [];
    HTMLMediaElement.prototype.play = function play() {
      window.__playedAudio.push(this.currentSrc || this.src);
      return Promise.resolve();
    };
  });
  const host = await desktop.newPage();
  const guest = await mobile.newPage();
  const removable = await extraPlayer.newPage();
  const pageErrors = [];
  host.on("pageerror", (error) => pageErrors.push(`host: ${error.message}`));
  guest.on("pageerror", (error) => pageErrors.push(`guest: ${error.message}`));
  removable.on("pageerror", (error) => pageErrors.push(`removable: ${error.message}`));

  await host.goto(lanOrigin, { waitUntil: "networkidle" });
  await host.screenshot({ path: "artifacts/home-desktop.png", fullPage: true });
  await host.click("#rules-button");
  await host.waitForSelector("#rules-content h1");
  const ruleText = await host.locator("#rules-content").textContent();
  if (ruleText.length > 7500) throw new Error(`Rulebook is still too long: ${ruleText.length} characters`);
  for (const requiredRule of ["The whole game", "Fold is not all-in", "Showdown"]) {
    if (!ruleText.includes(requiredRule)) throw new Error(`Missing rule section: ${requiredRule}`);
  }
  if (await host.locator(".rules-nav").count()) throw new Error("Rulebook still contains a left navigation panel");
  const visualGuideCoverage = await host.evaluate(() => [...document.querySelectorAll(".guide-section")].map((section) => ({
    title: section.querySelector("h2")?.textContent.trim(),
    hasExample: Boolean(section.querySelector(".step-example-hand")),
    cardCount: section.querySelectorAll(".guide-hand-card, .guide-playing-card, .market-dots .up, .market-dots .down, .example-poker-card").length,
  })));
  if (visualGuideCoverage.length !== 8 || visualGuideCoverage.some((step) => !step.hasExample || step.cardCount < 2)) {
    throw new Error(`Every numbered guide step needs a visual hand: ${JSON.stringify(visualGuideCoverage)}`);
  }
  await host.waitForSelector("#guide-slide-controls:not(.hidden)");
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-desktop.png" });
  await host.click("#guide-next-button");
  await host.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "The whole game");
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-flow-desktop.png" });
  await host.click("#guide-next-button");
  await host.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "Your starting hand");
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-starting-hand-desktop.png" });
  await host.click("#guide-next-button");
  await host.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "The four markets");
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-markets-desktop.png" });
  await host.click("#guide-next-button");
  await host.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "Secret draft");
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-draft-tiebreak-desktop.png" });
  await host.click("#guide-next-button");
  await host.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "Poker betting");
  if (!(await host.locator("#rules-content").innerText()).includes("3–6 PLAYERS · FIRST ACTION")) {
    throw new Error("Poker guide does not show the first 3–6 player actor after the big blind");
  }
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-betting-order-desktop.png" });
  await host.click("#guide-next-button");
  await host.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "Fold is not all-in");
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-fold-allin-desktop.png" });
  await host.click("#guide-next-button");
  await host.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "Showdown");
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-showdown-desktop.png" });
  await host.click("#guide-slide-dots button:last-child");
  await host.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "One example hand");
  const guideExample = await host.evaluate(() => ({
    cards: document.querySelectorAll(".example-poker-card").length,
    winningCards: document.querySelectorAll(".example-poker-card.best").length,
    sectionCopySize: parseFloat(getComputedStyle(document.querySelector(".guide-section-head p")).fontSize),
    flowCopySize: parseFloat(getComputedStyle(document.querySelector(".guide-flow p")).fontSize),
    cardWidth: document.querySelector(".example-poker-card").getBoundingClientRect().width,
  }));
  if (guideExample.cards !== 6 || guideExample.winningCards !== 5 || guideExample.sectionCopySize < 17 || guideExample.flowCopySize < 15 || guideExample.cardWidth < 55) {
    throw new Error(`Help example is not visual or readable enough: ${JSON.stringify(guideExample)}`);
  }
  await host.waitForTimeout(300);
  await host.screenshot({ path: "artifacts/rules-example-hand-desktop.png" });
  await host.click("#close-rules-button");
  await host.click("#sound-settings-button");
  await host.waitForSelector("#sound-settings-popover:not(.hidden)");
  const initialSoundSettings = await host.evaluate(() => ({
    music: document.querySelector("#music-volume").value,
    effects: document.querySelector("#effects-volume").value,
    backgroundStarted: window.__playedAudio.some((source) => source.endsWith("/audio/background.mp3")),
  }));
  if (initialSoundSettings.music !== "25" || initialSoundSettings.effects !== "75" || !initialSoundSettings.backgroundStarted) {
    throw new Error(`Default sound settings or music unlock failed: ${JSON.stringify(initialSoundSettings)}`);
  }
  await host.locator("#music-volume").evaluate((element) => {
    element.value = "40";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await host.locator("#effects-volume").evaluate((element) => {
    element.value = "60";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const savedSoundSettings = await host.evaluate(() => ({
    musicOutput: document.querySelector("#music-volume-output").textContent,
    effectsOutput: document.querySelector("#effects-volume-output").textContent,
    saved: JSON.parse(localStorage.getItem("draft-holdem-sound-settings")),
  }));
  if (savedSoundSettings.musicOutput !== "40%" || savedSoundSettings.effectsOutput !== "60%"
    || savedSoundSettings.saved.music !== 0.4 || savedSoundSettings.saved.effects !== 0.6) {
    throw new Error(`Sound settings were not persisted: ${JSON.stringify(savedSoundSettings)}`);
  }
  await host.screenshot({ path: "artifacts/sound-settings-desktop.png" });
  await host.click("#sound-settings-button");

  await guest.goto(baseUrl, { waitUntil: "networkidle" });
  await guest.click("#rules-button");
  await guest.waitForSelector("#rules-content h1");
  await guest.click("#guide-next-button");
  await guest.click("#guide-next-button");
  await guest.click("#guide-next-button");
  await guest.click("#guide-next-button");
  await guest.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "Secret draft");
  const mobileHelpLayout = await guest.evaluate(() => {
    const strip = document.querySelector(".guide-slide.active .guide-hand-strip").getBoundingClientRect();
    const nextBlock = document.querySelector(".guide-slide.active .tie-break-example").getBoundingClientRect();
    return {
      blocksOverlap: strip.bottom > nextBlock.top,
      draftRuleColumns: getComputedStyle(document.querySelector(".guide-slide.active .draft-rule-row")).gridTemplateColumns.split(" ").length,
    };
  });
  if (mobileHelpLayout.blocksOverlap || mobileHelpLayout.draftRuleColumns !== 1) {
    throw new Error(`Larger mobile help text is not laid out cleanly: ${JSON.stringify(mobileHelpLayout)}`);
  }
  await guest.waitForTimeout(300);
  await guest.screenshot({ path: "artifacts/rules-mobile.png" });
  await guest.click("#guide-prev-button");
  await guest.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "The four markets");
  await guest.waitForTimeout(300);
  await guest.screenshot({ path: "artifacts/rules-markets-mobile.png" });
  await guest.click("#guide-slide-dots button:last-child");
  await guest.waitForFunction(() => document.querySelector("#guide-slide-title")?.textContent === "One example hand");
  const mobileExampleOverflow = await guest.locator(".example-hand-cards").evaluate((element) => element.scrollWidth - element.clientWidth);
  if (mobileExampleOverflow > 1) throw new Error(`Example hand overflows mobile help panel by ${mobileExampleOverflow}px`);
  await guest.waitForTimeout(300);
  await guest.screenshot({ path: "artifacts/rules-example-hand-mobile.png" });
  await guest.click("#close-rules-button");
  await guest.click("#sound-settings-button");
  const mobileSoundPanel = await guest.locator("#sound-settings-popover").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, viewportWidth: innerWidth };
  });
  if (mobileSoundPanel.left < 0 || mobileSoundPanel.right > mobileSoundPanel.viewportWidth || mobileSoundPanel.top < 0) {
    throw new Error(`Mobile sound settings are clipped: ${JSON.stringify(mobileSoundPanel)}`);
  }
  await guest.screenshot({ path: "artifacts/sound-settings-mobile.png" });
  await guest.click("#sound-settings-button");

  const sixPlayerContexts = await Promise.all(Array.from({ length: 6 }, () => browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  })));
  await Promise.all(sixPlayerContexts.map((context) => context.addInitScript(() => {
    localStorage.setItem("draft-holdem-sound-settings", JSON.stringify({ music: 0, effects: 0 }));
  })));
  const sixPlayers = await Promise.all(sixPlayerContexts.map((context) => context.newPage()));
  await Promise.all(sixPlayers.map((page) => page.goto(baseUrl, { waitUntil: "networkidle" })));
  await sixPlayers[0].fill("#player-name", "Seat 1");
  await sixPlayers[0].click("#create-room-button");
  await sixPlayers[0].waitForSelector("#lobby-view:not(.hidden)");
  const sixPlayerCode = (await sixPlayers[0].textContent("#lobby-code")).trim();
  for (let index = 1; index < sixPlayers.length; index += 1) {
    await sixPlayers[index].goto(`${baseUrl}/?room=${sixPlayerCode}`, { waitUntil: "networkidle" });
    await sixPlayers[index].fill("#player-name", `Seat ${index + 1}`);
    await sixPlayers[index].click("#join-room-button");
    await sixPlayers[index].waitForSelector("#lobby-view:not(.hidden)");
  }
  await sixPlayers[0].waitForFunction(() => document.querySelectorAll(".lobby-seat:not(.open)").length === 6);
  await Promise.all(sixPlayers.map((page) => page.click("#ready-button")));
  await sixPlayers[0].waitForFunction(() => !document.querySelector("#start-button").disabled);
  await sixPlayers[0].click("#start-button");
  await Promise.all(sixPlayers.map((page) => page.waitForSelector("#game-view:not(.hidden)")));
  const sixPlayerLayout = await sixPlayers[0].evaluate(() => {
    const seats = [...document.querySelectorAll(".player-seat")];
    const rects = seats.map((seat) => {
      const box = seat.getBoundingClientRect();
      return { position: seat.dataset.position, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
    const overlaps = [];
    for (let left = 0; left < rects.length; left += 1) {
      for (let right = left + 1; right < rects.length; right += 1) {
        const a = rects[left];
        const b = rects[right];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          overlaps.push(`${a.position}/${b.position}`);
        }
      }
    }
    const cardRows = [...document.querySelectorAll(".seat-cards")].map((row) => row.getBoundingClientRect());
    return {
      count: seats.length,
      positions: rects.map(({ position }) => position),
      overlaps,
      clippedCardRows: cardRows.filter((box) => box.left < 0 || box.right > innerWidth || box.top < 0 || box.bottom > innerHeight).length,
      marketCards: document.querySelectorAll("#market-cards .playing-card").length,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  const expectedSixPositions = ["bottom", "lower-left", "upper-left", "top", "upper-right", "lower-right"];
  if (sixPlayerLayout.count !== 6
    || sixPlayerLayout.positions.join(",") !== expectedSixPositions.join(",")
    || sixPlayerLayout.overlaps.length
    || sixPlayerLayout.clippedCardRows
    || sixPlayerLayout.marketCards !== 8
    || sixPlayerLayout.horizontalOverflow > 1) {
    throw new Error(`Six-player table is not fully visible: ${JSON.stringify(sixPlayerLayout)}`);
  }
  await sixPlayers[0].screenshot({ path: "artifacts/game-six-player-desktop.png", fullPage: true });
  await sixPlayers[1].setViewportSize({ width: 390, height: 844 });
  await sixPlayers[1].evaluate(() => window.scrollTo(0, 0));
  await sixPlayers[1].waitForTimeout(200);
  const sixPlayerMobileLayout = await sixPlayers[1].evaluate(() => ({
    clippedCardRows: [...document.querySelectorAll(".seat-cards")].filter((row) => {
      const box = row.getBoundingClientRect();
      return box.left < 0 || box.right > innerWidth || box.top < 0 || box.bottom > innerHeight;
    }).length,
    clippedSeatShells: [...document.querySelectorAll(".seat-shell")].filter((shell) => {
      const box = shell.getBoundingClientRect();
      return box.left < 0 || box.right > innerWidth || box.top < 0 || box.bottom > innerHeight;
    }).length,
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (sixPlayerMobileLayout.clippedCardRows || sixPlayerMobileLayout.clippedSeatShells || sixPlayerMobileLayout.horizontalOverflow > 1) {
    throw new Error(`Six-player mobile table is clipped: ${JSON.stringify(sixPlayerMobileLayout)}`);
  }
  await sixPlayers[1].screenshot({ path: "artifacts/game-six-player-mobile.png", fullPage: true });
  await Promise.all(sixPlayerContexts.map((context) => context.close()));

  await host.fill("#player-name", "An");
  await host.click("#create-room-button");
  await host.waitForSelector("#lobby-view:not(.hidden)");
  const code = (await host.textContent("#lobby-code")).trim();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new Error(`Unexpected room code: ${code}`);
  const inviteUrl = (await host.textContent("#share-address")).trim();
  if (inviteUrl !== `${lanOrigin}/?room=${code}`) throw new Error(`Invite URL does not match the active LAN origin: ${inviteUrl}`);

  await guest.goto(`${baseUrl}/?room=${code}`, { waitUntil: "networkidle" });
  await guest.fill("#player-name", "Ben");
  await guest.click("#join-room-button");
  await guest.waitForSelector("#lobby-view:not(.hidden)");
  await host.waitForFunction(() => document.querySelectorAll(".lobby-seat:not(.open)").length === 2);

  await removable.goto(`${baseUrl}/?room=${code}`, { waitUntil: "networkidle" });
  await removable.fill("#player-name", "Cara");
  await removable.click("#join-room-button");
  await removable.waitForSelector("#lobby-view:not(.hidden)");
  await host.waitForFunction(() => document.querySelectorAll(".lobby-seat:not(.open)").length === 3);
  if (await host.locator(".kick-player-button").count() !== 2) throw new Error("Host does not have kick controls for every guest");
  if (await guest.locator(".kick-player-button").count() !== 0) throw new Error("A non-host can see kick controls");
  await host.screenshot({ path: "artifacts/lobby-kick-controls.png", fullPage: true });
  host.once("dialog", (dialog) => dialog.accept());
  await host.locator(".lobby-seat", { hasText: "Cara" }).locator(".kick-player-button").click();
  await removable.waitForSelector("#home-view:not(.hidden)");
  await host.waitForFunction(() => document.querySelectorAll(".lobby-seat:not(.open)").length === 2);

  await removable.waitForSelector("#connection-label.offline");
  await removable.waitForSelector("#connection-label.online");
  await removable.fill("#player-name", "Dave");
  await removable.fill("#room-code-input", code);
  await removable.click("#join-room-button");
  await removable.waitForSelector("#lobby-view:not(.hidden)");
  await host.waitForFunction(() => document.querySelectorAll(".lobby-seat:not(.open)").length === 3);
  await removable.close();
  await host.waitForFunction(() => document.querySelectorAll(".lobby-seat:not(.open)").length === 2, null, { timeout: 15_000 });

  await host.fill("#setting-draft-time", "10");
  await host.locator("#setting-draft-time").press("Tab");
  await guest.waitForFunction(() => document.querySelector("#setting-draft-time")?.value === "10");
  await host.fill("#setting-bet-time", "20");
  await host.locator("#setting-bet-time").press("Tab");
  try {
    await guest.waitForFunction(() => (
      document.querySelector("#setting-draft-time")?.value === "10"
      && document.querySelector("#setting-bet-time")?.value === "20"
    ), null, { timeout: 5_000 });
  } catch {
    const timerSync = await Promise.all([host, guest].map((page) => page.evaluate(() => ({
      draft: document.querySelector("#setting-draft-time")?.value,
      bet: document.querySelector("#setting-bet-time")?.value,
      connection: document.querySelector("#connection-label")?.textContent.replace(/\s+/g, " ").trim(),
      toast: document.querySelector("#toast")?.textContent,
    }))));
    throw new Error(`Lobby timer settings did not synchronize: ${JSON.stringify(timerSync)}`);
  }
  await host.click("#ready-button");
  await guest.click("#ready-button");
  await host.waitForFunction(() => !document.querySelector("#start-button").disabled);
  await host.screenshot({ path: "artifacts/lobby-desktop.png", fullPage: true });
  await host.click("#start-button");

  await host.waitForSelector("#game-view:not(.hidden)");
  await guest.waitForSelector("#game-view:not(.hidden)");
  await host.waitForSelector("#lock-bid-button");
  const bidPrompt = (await host.locator(".control-heading b").first().innerText()).trim();
  if (bidPrompt !== "How many Draft Tokens do you want to bid?") throw new Error(`Unexpected bid prompt: ${bidPrompt}`);
  await host.waitForSelector("#turn-timer:not(.hidden)");
  const draftSeconds = await host.locator("#turn-timer strong").evaluate((element) => {
    const [minutes, seconds] = element.textContent.split(":").map(Number);
    return minutes * 60 + seconds;
  });
  if (draftSeconds < 1 || draftSeconds > 10) throw new Error(`Draft timer ignored host setting: ${draftSeconds}s`);
  const compactChrome = await host.evaluate(() => ({
    topbar: document.querySelector(".topbar").getBoundingClientRect().height,
    actionDock: document.querySelector("#action-dock").getBoundingClientRect().height,
  }));
  if (compactChrome.topbar > 60 || compactChrome.actionDock > 84) {
    throw new Error(`Game chrome is not compact enough: ${JSON.stringify(compactChrome)}`);
  }
  const ownCardWidth = await host.locator('.player-seat[data-position="bottom"] .playing-card.small').first().evaluate((element) => element.getBoundingClientRect().width);
  if (ownCardWidth < 53) throw new Error(`Player cards are still too small: ${ownCardWidth}px`);
  const tableRatio = await host.locator(".poker-table").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.width / box.height;
  });
  if (tableRatio < 1.85) throw new Error(`Poker table is not wide enough: ${tableRatio.toFixed(2)}:1`);
  const ownCardVisibility = await host.locator('.player-seat[data-position="bottom"] .card-visibility').allTextContents();
  if (ownCardVisibility.join(",") !== "PUBLIC,PRIVATE") {
    throw new Error(`Own cards do not clearly show opponent visibility: ${ownCardVisibility.join(",")}`);
  }
  const opponentHiddenIndicator = await host.locator('.player-seat[data-position="top"] .hidden-count').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    label: getComputedStyle(element, "::after").content,
  }));
  if (opponentHiddenIndicator.width < 33 || !opponentHiddenIndicator.label.includes("HIDDEN")) {
    throw new Error(`Opponent hidden-card indicator is unclear: ${JSON.stringify(opponentHiddenIndicator)}`);
  }
  const blindChipPiles = await host.evaluate(() => {
    const count = (position) => document.querySelector(`.table-contribution[data-position="${position}"] .poker-chip-pile`)?.querySelectorAll(".poker-chip-stack i").length ?? 0;
    return {
      smallBlindChips: count("bottom"),
      bigBlindChips: count("top"),
      denominations: new Set([...document.querySelectorAll(".poker-chip-stack")].map((stack) => stack.className)).size,
      legacyChipFrames: document.querySelectorAll(".contribution-stack.chips").length,
    };
  });
  if (blindChipPiles.smallBlindChips < 1
    || blindChipPiles.bigBlindChips <= blindChipPiles.smallBlindChips
    || blindChipPiles.denominations < 2
    || blindChipPiles.legacyChipFrames) {
    throw new Error(`Chip piles do not scale or change denomination color: ${JSON.stringify(blindChipPiles)}`);
  }
  const ownBankrollLayout = await host.evaluate(() => {
    const stack = document.querySelector('.player-seat[data-position="bottom"] .seat-chip-stack').getBoundingClientRect();
    const avatar = document.querySelector('.player-seat[data-position="bottom"] .avatar').getBoundingClientRect();
    const badges = document.querySelector('.player-seat[data-position="bottom"] .seat-badges').getBoundingClientRect();
    const shell = document.querySelector('.player-seat[data-position="bottom"] .seat-shell').getBoundingClientRect();
    const overlaps = (left, right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    return {
      insideSeat: stack.left >= shell.left && stack.right <= shell.right && stack.top >= shell.top && stack.bottom <= shell.bottom,
      besideAvatar: stack.left >= avatar.right - 1,
      overlapsAvatar: overlaps(stack, avatar),
      overlapsBadges: overlaps(stack, badges),
      amount: document.querySelector('.player-seat[data-position="bottom"] .bankroll-pile .chip-pile-caption b').textContent.trim(),
      legacyMoneyIcon: document.querySelector('.player-seat[data-position="bottom"] .resource-line').textContent.includes("◉"),
    };
  });
  if (!ownBankrollLayout.insideSeat || !ownBankrollLayout.besideAvatar || ownBankrollLayout.overlapsAvatar || ownBankrollLayout.overlapsBadges || ownBankrollLayout.amount !== "495" || ownBankrollLayout.legacyMoneyIcon) {
    throw new Error(`Player bankroll pile is not contained beside the avatar: ${JSON.stringify(ownBankrollLayout)}`);
  }
  if (await host.locator(".game-sidebar").evaluate((element) => getComputedStyle(element).display !== "none")) throw new Error("Action log is not hidden by default");
  await host.click("#log-toggle-button");
  if (await host.locator(".game-sidebar").evaluate((element) => getComputedStyle(element).display === "none")) throw new Error("Action log did not open");
  await host.click("#log-toggle-button");
  await host.waitForSelector("#turn-timer.warning", { timeout: 7_000 });
  await host.waitForSelector("#turn-timer.danger", { timeout: 4_000 });
  const dangerTimer = await host.locator("#turn-timer").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      position: style.position,
      color: getComputedStyle(element.querySelector("strong")).color,
      text: element.querySelector("strong").textContent,
    };
  });
  if (dangerTimer.position === "fixed" || dangerTimer.color !== "rgb(255, 97, 115)" || !/^00:0[123]$/.test(dangerTimer.text)) {
    throw new Error(`Final countdown did not stay red in the top timer: ${JSON.stringify(dangerTimer)}`);
  }
  await host.screenshot({ path: "artifacts/game-urgent-timer-desktop.png" });
  await host.evaluate(() => { window.__playedAudio = []; });
  await host.fill("#bid-number", "2");
  await host.click("#lock-bid-button");
  await host.waitForSelector('.table-contribution[data-position="bottom"] .tokens.secret');
  if (!(await host.evaluate(() => window.__playedAudio.some((source) => source.endsWith("/audio/placing-chip.mp3"))))) {
    throw new Error("Locking a positive Draft Token bid did not play the token placement sound");
  }
  if ((await host.locator('.table-contribution[data-position="bottom"] .tokens.secret b').innerText()).trim() !== "2") {
    throw new Error("The viewer's locked Draft Token pile does not show its amount");
  }
  if ((await guest.locator('.table-contribution[data-position="top"] .tokens.secret b').innerText()).trim() !== "?") {
    throw new Error("A secret opponent bid amount was revealed on the table");
  }
  await guest.waitForSelector("#lock-bid-button");
  await guest.fill("#bid-number", "2");
  await guest.click("#lock-bid-button");
  await host.waitForFunction(() => document.querySelector(".control-heading b")?.textContent === "Re-bid to break the tie");
  await guest.waitForFunction(() => document.querySelector(".control-heading b")?.textContent === "Re-bid to break the tie");
  if (await host.locator(".contribution-stack.tokens:not(.secret)").count() !== 2) {
    throw new Error("Revealed Draft Token piles are not visible for both players");
  }
  await host.screenshot({ path: "artifacts/game-rebid-desktop.png" });
  await host.fill("#bid-number", "1");
  await host.click("#lock-bid-button");
  await guest.fill("#bid-number", "0");
  await guest.click("#lock-bid-button");
  await host.waitForSelector("#market-cards [data-card-id]");
  await guest.waitForSelector(".player-seat.is-turn .avatar");
  const turnRingStart = await host.locator(".player-seat.is-turn .avatar").evaluate((element) => ({
    progress: Number(getComputedStyle(element).getPropertyValue("--turn-progress")),
    ring: getComputedStyle(element, "::before").backgroundImage,
    radius: getComputedStyle(element).borderRadius,
    state: element.closest(".player-seat").className,
  }));
  await host.waitForTimeout(450);
  const turnRingEnd = await host.locator(".player-seat.is-turn .avatar").evaluate((element) => Number(getComputedStyle(element).getPropertyValue("--turn-progress")));
  if (!turnRingStart.ring.includes("rgb(82, 218, 160)") || turnRingStart.radius !== "50%" || turnRingStart.state.includes("turn-warning") || turnRingEnd >= turnRingStart.progress - 0.02) {
    throw new Error(`Active-player avatar countdown is not shrinking: ${JSON.stringify({ turnRingStart, turnRingEnd })}`);
  }
  if (await guest.locator(".player-seat.is-turn .avatar").count() !== 1) {
    throw new Error("The active-player avatar countdown is not visible to every player");
  }
  await host.waitForSelector(".player-seat.is-turn.turn-warning", { timeout: 7_000 });
  const warningRing = await host.locator(".player-seat.is-turn .avatar").evaluate((element) => getComputedStyle(element, "::before").backgroundImage);
  if (!warningRing.includes("rgb(242, 197, 108)") || !(await host.locator("#turn-timer").evaluate((element) => element.classList.contains("warning")))) {
    throw new Error(`Timer bars did not turn yellow at 50%: ${warningRing}`);
  }
  await host.screenshot({ path: "artifacts/game-timer-warning-desktop.png" });
  await host.waitForSelector(".player-seat.is-turn.turn-danger", { timeout: 4_000 });
  const dangerRing = await host.locator(".player-seat.is-turn .avatar").evaluate((element) => getComputedStyle(element, "::before").backgroundImage);
  if (!dangerRing.includes("rgb(255, 97, 115)") || !(await host.locator("#turn-timer").evaluate((element) => element.classList.contains("danger")))) {
    throw new Error(`Timer bars did not turn red for the final three seconds: ${dangerRing}`);
  }
  const tableClearance = await host.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const progress = rect("#phase-progress");
    const topSeat = rect('.player-seat[data-position="top"] .seat-shell');
    const bottomCards = rect('.player-seat[data-position="bottom"] .seat-cards');
    const actionDock = rect("#action-dock");
    return {
      progressBottom: progress.bottom,
      topSeatTop: topSeat.top,
      bottomCardsBottom: bottomCards.bottom,
      actionDockTop: actionDock.top,
    };
  });
  if (tableClearance.topSeatTop < tableClearance.progressBottom + 8) {
    throw new Error(`Top seat overlaps the progress bar: ${JSON.stringify(tableClearance)}`);
  }
  if (tableClearance.bottomCardsBottom > tableClearance.actionDockTop - 8) {
    throw new Error(`Player cards overlap the action dock: ${JSON.stringify(tableClearance)}`);
  }
  await host.screenshot({ path: "artifacts/game-draft-desktop.png" });
  await host.evaluate(() => { window.__playedAudio = []; });
  await host.locator("#market-cards [data-card-id]").first().click();
  if (!(await host.evaluate(() => window.__playedAudio.some((source) => source.endsWith("/audio/placing-card.mp3"))))) {
    throw new Error("Drafting a card did not play the supplied card sound");
  }
  await guest.waitForSelector("#market-cards [data-card-id]");
  await guest.locator("#market-cards [data-card-id]").first().click();
  await host.waitForSelector('[data-poker-action="CALL"]');
  const betSeconds = await host.locator("#turn-timer strong").evaluate((element) => {
    const [minutes, seconds] = element.textContent.split(":").map(Number);
    return minutes * 60 + seconds;
  });
  if (betSeconds < 1 || betSeconds > 20) throw new Error(`Bet timer ignored host setting: ${betSeconds}s`);
  const overflow = await host.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    vertical: document.documentElement.scrollHeight - window.innerHeight,
  }));
  if (overflow.horizontal > 1 || overflow.vertical > 1) {
    throw new Error(`Desktop game overflowed viewport: ${JSON.stringify(overflow)}`);
  }
  const hostBlind = (await host.locator('.player-seat[data-position="bottom"] .seat-badge.blind').innerText()).trim();
  if (hostBlind !== "SB") throw new Error(`Round 1 host must be SB, got ${hostBlind}`);
  await host.evaluate(() => {
    window.__playedAudio = [];
    window.__originalWebSocketSend = WebSocket.prototype.send;
    WebSocket.prototype.send = () => {};
  });
  await host.click('[data-poker-action="ALL_IN"]');
  if (!(await host.evaluate(() => window.__playedAudio.some((source) => source.endsWith("/audio/all-in.mp3"))))) {
    throw new Error("All-in did not play the supplied all-in sound");
  }
  await host.evaluate(() => {
    WebSocket.prototype.send = window.__originalWebSocketSend;
    window.__playedAudio = [];
  });
  await host.click('[data-poker-action="CALL"]');
  if (!(await host.evaluate(() => window.__playedAudio.some((source) => source.endsWith("/audio/placing-chip.mp3"))))) {
    throw new Error("Committing poker chips did not play the chip placement sound");
  }
  await guest.waitForSelector('.table-contribution[data-position="top"] .chips.animate-in');
  if ((await guest.locator('.table-contribution[data-position="top"] .chips b').innerText()).trim() !== "10") {
    throw new Error("The called chip pile does not show the player's full street contribution");
  }
  const contributionAnimation = await guest.locator('.table-contribution[data-position="top"] .chips.animate-in').evaluate((element) => getComputedStyle(element).animationName);
  if (contributionAnimation !== "contribution-to-table") throw new Error(`Chip pile animation is not active: ${contributionAnimation}`);
  await guest.waitForSelector('[data-poker-action="CHECK"]');
  const mobileLayout = await guest.evaluate(() => {
    const contribution = document.querySelector('.table-contribution[data-position="top"]').getBoundingClientRect();
    const marketTitle = document.querySelector(".market-title").getBoundingClientRect();
    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      dockHeight: document.querySelector("#action-dock").getBoundingClientRect().height,
      contributionOverlapsTitle: contribution.left < marketTitle.right
        && contribution.right > marketTitle.left
        && contribution.top < marketTitle.bottom
        && contribution.bottom > marketTitle.top,
    };
  });
  if (mobileLayout.horizontalOverflow > 1 || mobileLayout.dockHeight > 150 || mobileLayout.contributionOverlapsTitle) {
    throw new Error(`Mobile betting layout is not compact and clear: ${JSON.stringify(mobileLayout)}`);
  }
  await guest.evaluate(() => window.scrollTo(0, 0));
  await guest.screenshot({ path: "artifacts/game-betting-mobile.png", fullPage: true });
  await guest.click('[data-poker-action="CHECK"]');
  await host.waitForSelector("#lock-bid-button");

  await host.fill("#bid-number", "0");
  await host.click("#lock-bid-button");
  await guest.waitForSelector("#lock-bid-button");
  await guest.fill("#bid-number", "0");
  await guest.click("#lock-bid-button");
  await host.waitForSelector("#market-cards [data-card-id]");
  const roundTwoDraftOrder = (await host.locator("#draft-order > span").allTextContents())
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text.startsWith("#"));
  if (roundTwoDraftOrder[0] !== "#1 An · 0" || roundTwoDraftOrder[1] !== "#2 Ben · 0") {
    throw new Error(`Round 2 zero-bid order must be BB then SB: ${roundTwoDraftOrder.join(" → ")}`);
  }
  await host.locator("#market-cards [data-card-id]").first().click();
  await guest.waitForSelector("#market-cards [data-card-id]");
  await guest.locator("#market-cards [data-card-id]").first().click();
  await guest.waitForSelector('[data-poker-action="CHECK"]');
  const guestBlind = (await guest.locator('.player-seat[data-position="bottom"] .seat-badge.blind').innerText()).trim();
  if (guestBlind !== "SB") throw new Error(`Round 2 guest must be SB, got ${guestBlind}`);
  await guest.evaluate(() => window.scrollTo(0, 0));
  await guest.screenshot({ path: "artifacts/game-round2-action-mobile.png", fullPage: true });
  await host.evaluate(() => { window.__playedAudio = []; });
  await guest.click('[data-poker-action="FOLD"]');
  await host.waitForSelector(".result-panel");
  const payoutFeedback = await host.evaluate(() => ({
    animation: getComputedStyle(document.querySelector(".winner-chip-flight")).animationName,
    deltas: [...document.querySelectorAll(".seat-badge.chip-delta")].map((badge) => badge.textContent.trim()).sort(),
  }));
  if (payoutFeedback.animation !== "pot-to-winner" || payoutFeedback.deltas.join(",") !== "HAND +10,HAND -10") {
    throw new Error(`Winner payout feedback is incomplete: ${JSON.stringify(payoutFeedback)}`);
  }
  if (!(await host.evaluate(() => window.__playedAudio.some((source) => source.endsWith("/audio/placing-chip.mp3"))))) {
    throw new Error("Awarding the pot did not play the supplied chip sound");
  }
  await host.waitForTimeout(350);
  await host.screenshot({ path: "artifacts/game-result-chip-payout.png" });
  const nextHandTimer = await host.locator("#turn-timer").evaluate((element) => ({
    label: element.querySelector("span").textContent,
    seconds: Number(element.querySelector("strong").textContent.split(":")[1]),
  }));
  if (nextHandTimer.label !== "NEXT HAND" || nextHandTimer.seconds < 1 || nextHandTimer.seconds > 5) {
    throw new Error(`Completed-hand countdown is not five seconds: ${JSON.stringify(nextHandTimer)}`);
  }
  await host.click("#seat-toggle-button");
  await host.waitForFunction(() => document.querySelector("#seat-toggle-button")?.textContent === "Sit in next hand");
  await host.waitForFunction(() => document.querySelector("#turn-timer")?.classList.contains("hidden"));
  const pausedResult = await host.evaluate(() => ({
    nextDisabled: document.querySelector("#next-hand-button")?.disabled,
    resultText: document.querySelector(".winner-info")?.textContent.replace(/\s+/g, " ").trim(),
    sitOutBadge: document.querySelector('.player-seat[data-position="bottom"] .seat-badge.sitout')?.textContent.trim(),
    potOverlapsBankroll: (() => {
      const pot = document.querySelector("#pot-stack").getBoundingClientRect();
      const bankroll = document.querySelector('.player-seat[data-position="bottom"] .seat-chip-stack').getBoundingClientRect();
      return pot.left < bankroll.right && pot.right > bankroll.left && pot.top < bankroll.bottom && pot.bottom > bankroll.top;
    })(),
  }));
  if (!pausedResult.nextDisabled || !pausedResult.resultText.includes("2 seated players with chips are required") || pausedResult.sitOutBadge !== "SITTING OUT" || pausedResult.potOverlapsBankroll) {
    throw new Error(`Paused next-hand state is unclear: ${JSON.stringify(pausedResult)}`);
  }
  await guest.click("#refill-chips-button");
  await host.waitForFunction(() => document.querySelector('.player-seat[data-position="top"] .seat-badge.refill')?.textContent.includes("×1"));
  const refilledGuest = await host.evaluate(() => ({
    chips: document.querySelector('.player-seat[data-position="top"] .bankroll-pile .chip-pile-caption b')?.textContent.trim(),
    delta: document.querySelector('.player-seat[data-position="top"] .seat-badge.chip-delta')?.textContent.trim(),
    refill: document.querySelector('.player-seat[data-position="top"] .seat-badge.refill')?.textContent.trim(),
  }));
  if (refilledGuest.chips !== "500" || refilledGuest.delta !== "HAND -10" || refilledGuest.refill !== "REFILL ×1") {
    throw new Error(`Refill stack or counter is incorrect: ${JSON.stringify(refilledGuest)}`);
  }
  await host.screenshot({ path: "artifacts/game-result-sit-out-refill.png" });
  await host.click("#seat-toggle-button");
  await host.waitForSelector("#turn-timer:not(.hidden)");
  await host.waitForFunction(() => document.querySelector("#round-label")?.textContent.includes("HAND 2"), null, { timeout: 7_000 });
  await host.waitForSelector("#lock-bid-button");

  if (pageErrors.length) throw new Error(pageErrors.join("\n"));
  console.log(`UI smoke passed for room ${code}; screenshots saved in artifacts/.`);
} finally {
  await browser?.close();
  server.kill();
}
