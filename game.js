/* 盲区协议：种子迷宫、扩张波前、2D/3D 锁定模式 */
import {
  COLS,
  ROWS,
  buildMaze,
  castGridRay,
  collidesWithMaze,
  hashSeed,
  placeCrystals,
  placeItems,
  wallKey,
} from "./core.js";
import {
  createGameState,
  sonarCooldownRemaining,
  startsTimerFromInput,
  SONAR,
  tryFireSonar,
  updateClockAndEnergy,
} from "./game-state.js";
import { stepPlayer, wrapAngle } from "./movement.js";
import {
  applyTouchLook,
  joystickState,
  requestLandscapeMode,
} from "./mobile-controls.js";
import { createPing, SONAR_TYPES, stepPing } from "./sonar.js";
import {
  clampReplayTime,
  createReplayRecorder,
  deleteReplay,
  exportReplayShare,
  exportReplayShareLink,
  importReplayShareInput,
  finishReplayRecord,
  loadReplays,
  replayEventCursor,
  replayDuration,
  recordReplaySample,
  recordReplaySonar,
  sampleReplay,
  saveReplay,
} from "./replay.js";
import { createSafeStorage } from "./storage.js";
import { createMusicController } from "./music.js";
import { attachTerminalScrollAll } from "./terminal-scroll.js";

const canvas = document.getElementById("game"),
  ctx = canvas.getContext("2d"),
  storage = createSafeStorage();
const launchMask = document.getElementById("launch-mask"),
  launchMode = launchMask.querySelector(".launch-mode"),
  launchSeed = launchMask.querySelector(".launch-seed"),
  launchLabel = launchMask.querySelector(".launch-label");
const TAU = Math.PI * 2,
  DEFAULT_FOV_DEGREES = 67;
const TYPES = {
  red: { color: "#ff6259", life: 9, speed: 9.5, spread: Math.PI / 6, rays: 21 },
  green: {
    color: "#a9ef68",
    life: 7,
    speed: 7.5,
    spread: Math.PI / 6,
    rays: 21,
  },
  blue: { color: "#5dddf1", life: 5, speed: 11, spread: Math.PI, rays: 72 },
  beacon: {
    color: "#e9b8ff",
    life: 1.4,
    speed: 5.5,
    spread: Math.PI,
    rays: 40,
  },
};
const ui = {
  title: document.getElementById("title"),
  replays: document.getElementById("replays"),
  replayList: document.getElementById("replay-list"),
  replayImport: document.getElementById("replay-import"),
  replayImportButton: document.getElementById("replay-import-btn"),
  replayImportStatus: document.getElementById("replay-import-status"),
  settings: document.getElementById("settings"),
  display: document.getElementById("display"),
  help: document.getElementById("help"),
  about: document.getElementById("about"),
  hud: document.getElementById("hud"),
  landscapePrompt: document.getElementById("landscape-prompt"),
  pause: document.getElementById("pause"),
  result: document.getElementById("result"),
  deleteConfirm: document.getElementById("delete-confirm"),
  deleteConfirmAccept: document.getElementById("delete-confirm-accept"),
  deleteConfirmCancel: document.getElementById("delete-confirm-cancel"),
  energyFill: document.getElementById("energy-fill"),
  energyText: document.getElementById("energy-text"),
  objective: document.getElementById("objective"),
  resultText: document.getElementById("result-text"),
  rank: document.getElementById("result-rank"),
  seedInput: document.getElementById("seed-input"),
  randomSeed: document.getElementById("random-seed-btn"),
  seedPreview: document.getElementById("seed-preview"),
  viewMode: document.getElementById("view-mode"),
  viewModeLabel: document.getElementById("view-mode-label"),
  sensitivity: document.getElementById("sensitivity"),
  sensitivityRow: document.getElementById("sensitivity-row"),
  sensitivityValue: document.getElementById("sensitivity-value"),
  fovRow: document.getElementById("fov-row"),
  fov: document.getElementById("fov"),
  fovValue: document.getElementById("fov-value"),
  crt: document.getElementById("crt-strength"),
  crtValue: document.getElementById("crt-value"),
  glow: document.getElementById("glow-strength"),
  glowValue: document.getElementById("glow-value"),
  musicVolume: document.getElementById("music-volume"),
  musicVolumeValue: document.getElementById("music-volume-value"),
  sfxVolume: document.getElementById("sfx-volume"),
  sfxVolumeValue: document.getElementById("sfx-volume-value"),
  adaptiveMobileUi: document.getElementById("adaptive-mobile-ui"),
  forceLandscape: document.getElementById("force-landscape"),
  customLayoutEnabled: document.getElementById("custom-layout-enabled"),
  customLayoutTools: document.getElementById("custom-layout-tools"),
  openLayoutEditor: document.getElementById("open-layout-editor"),
  layoutEditor: document.getElementById("layout-editor"),
  layoutEditorTitle: document.getElementById("layout-editor-title"),
  layoutSelectedLabel: document.getElementById("layout-selected-label"),
  layoutSize: document.getElementById("layout-size"),
  layoutSizeValue: document.getElementById("layout-size-value"),
  layoutEditorDone: document.getElementById("layout-editor-done"),
  layoutEditorReset: document.getElementById("layout-editor-reset"),
  sector: document.getElementById("sector-label"),
  controlGuide: document.getElementById("control-guide"),
  timer: document.getElementById("game-timer"),
  replayControls: document.getElementById("replay-controls"),
  replayPlay: document.getElementById("replay-play"),
  replaySpeed: document.getElementById("replay-speed"),
  redLegend: document.getElementById("red-legend"),
  greenLegend: document.getElementById("green-legend"),
  blueLegend: document.getElementById("blue-legend"),
  cooldown: {
    red: document.getElementById("red-cooldown"),
    green: document.getElementById("green-cooldown"),
    blue: document.getElementById("blue-cooldown"),
  },
};
const inputSources = {
  keyboard: { forward: false, back: false, left: false, right: false },
  buttons: { forward: false, back: false, left: false, right: false },
  joystick: { forward: false, back: false, left: false, right: false },
};
const input = {};
for (const direction of ["forward", "back", "left", "right"])
  Object.defineProperty(input, direction, {
    enumerable: true,
    get: () => Object.values(inputSources).some((source) => source[direction]),
  });
function clearInput() {
  for (const source of Object.values(inputSources))
    for (const direction of Object.keys(source)) source[direction] = false;
}
function isMobile() {
  return (
    matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0 ||
    /android|iphone|ipod|ipad|phone|mobile|windows phone/i.test(
      navigator.userAgent.toLowerCase(),
    )
  );
}
const isMobileBrowser = isMobile();
let mobileControlsTest =
  storage.getItem("blindspot-mobile-controls-test") === "true";
function mobileControlsEnabled() {
  return isMobileBrowser || mobileControlsTest;
}
function syncMobileControlsTest() {
  const enabled = mobileControlsEnabled();
  document.body.classList.toggle("mobile-browser", enabled);
  // Keep the test toggle visible on desktop after it enables the mobile preview.
  document.body.classList.toggle("mobile-controls-test-active", mobileControlsTest && !isMobileBrowser);
  document.body.classList.toggle("mobile-experiments-available", enabled);
  const button = document.getElementById("mobile-controls-test");
  button.classList.toggle("active", mobileControlsTest);
  button.setAttribute("aria-pressed", String(mobileControlsTest));
  button.textContent = mobileControlsTest
    ? "▣ 手机操作测试：开启"
    : "▣ 显示手机操作（测试）";
}
const viewport = { width: innerWidth, height: innerHeight };
const LAYOUT_IDS = [
  "game-timer", "topbar", "energy", "status", "objective", "sonar-console", "side",
  "mobile-fullscreen", "mobile-reset", "mobile-move", "mobile-joystick",
  "wave-red", "wave-green", "wave-blue", "mobile-look", "mobile-pause",
];
let maze = null,
  game = fresh("title"),
  last = performance.now(),
  viewMode = "3d",
  settingsViewMode = "3d",
  seedText = "",
  displayReturn = "title",
  settingsReturn = "title",
  audioContext = null,
  glowAmount = 0.55,
  crtAmount = 0.35,
  lookSensitivity = 1,
  fovDegrees = DEFAULT_FOV_DEGREES,
  musicVolume = 0.55,
  sfxVolume = 0.7,
  replayRecorder = null,
  activeGhostReplay = null,
  replaySpeed = 1,
  replayPaused = false;
const music = createMusicController({ getVolume: () => musicVolume });
function unlockAudioFromGesture() {
  // Title BGM is the default desired track; unlock starts it inside this gesture.
  music.unlock();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  if (!audioContext) audioContext = new AudioCtx();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
}
// Capture-phase so the first click/key still counts as a user gesture for audio.
for (const eventName of ["pointerdown", "keydown", "touchstart", "click"])
  window.addEventListener(eventName, unlockAudioFromGesture, {
    capture: true,
    passive: true,
  });
// Off-main-thread column raycasts for 3D. Latest completed buffer is drawn;
// a new cast is kicked each frame so the main thread only paints.
const raycastState = {
  worker: null,
  ready: false,
  failed: false,
  nextId: 1,
  pendingId: 0,
  hits: null,
  cols: 0,
  slice: 0,
};
function initRaycastWorker() {
  if (raycastState.worker || raycastState.failed) return;
  if (typeof Worker === "undefined") {
    raycastState.failed = true;
    return;
  }
  try {
    const worker = new Worker(new URL("./raycast-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === "error") {
        raycastState.failed = true;
        try {
          worker.terminate();
        } catch (_) {}
        raycastState.worker = null;
        raycastState.ready = false;
        return;
      }
      if (data.type !== "hits" || data.id !== raycastState.pendingId) return;
      raycastState.hits = new Float64Array(data.buffer);
      raycastState.pendingId = 0;
      raycastState.ready = true;
    };
    worker.onerror = () => {
      raycastState.failed = true;
      raycastState.worker = null;
      raycastState.ready = false;
    };
    raycastState.worker = worker;
  } catch (_) {
    raycastState.failed = true;
  }
}
function requestRaycastColumns(cols, fov, maxDistance = 26) {
  initRaycastWorker();
  if (!raycastState.worker || raycastState.failed || !seedText) return false;
  // A worker can trail a mobile frame; never queue another cast until its latest job returns.
  if (raycastState.pendingId) return true;
  const id = raycastState.nextId++;
  raycastState.pendingId = id;
  raycastState.cols = cols;
  raycastState.ready = false;
  raycastState.worker.postMessage({
    type: "cast",
    id,
    seed: seedText,
    x: game.player.x,
    y: game.player.y,
    angle: game.player.angle,
    fov,
    cols,
    maxDistance,
  });
  return true;
}
function wallFromPacked(hits, columnIndex) {
  const base = 1 + columnIndex * 8;
  if (!hits || hits[base] < 0.5) return null;
  const x1 = hits[base + 4],
    y1 = hits[base + 5],
    x2 = hits[base + 6],
    y2 = hits[base + 7];
  return {
    x: hits[base + 1],
    y: hits[base + 2],
    distance: hits[base + 3],
    wall: {
      x1,
      y1,
      x2,
      y2,
      key: wallKey(x1, y1, x2, y2),
      vertical: x1 === x2,
    },
  };
}
function fresh(state) {
  return createGameState(state);
}

const MENU_SCREENS = new Set([
  "title",
  "pause",
  "replays",
  "settings",
  "display",
  "help",
  "about",
]);
const PANEL_MENUS = new Set([
  "replays",
  "settings",
  "display",
  "help",
  "about",
]);
const ALL_UI_KEYS = [
  "title",
  "replays",
  "settings",
  "display",
  "help",
  "about",
  "hud",
  "landscapePrompt",
  "pause",
  "result",
  "deleteConfirm",
];
const TRANSITION_MS = 360;
const reduceMotionQuery =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };
let activeScreen = "title";
let screenTransition = null;
let screenTransitionToken = 0;

function prefersReducedMotion() {
  return Boolean(reduceMotionQuery.matches);
}

function clearScreenTransitionClasses(el) {
  if (!el) return;
  el.classList.remove(
    "screen-enter",
    "screen-enter-active",
    "screen-leave",
    "screen-leave-active",
    "screen-fade-in",
    "screen-fade-in-active",
    "screen-fade-out",
    "screen-fade-out-active",
    "overlay-enter",
    "overlay-enter-active",
    "overlay-leave",
    "overlay-leave-active",
    "is-transitioning",
  );
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function applyMusicForScreen(name) {
  // Menu screens use the title theme. Pause/result keep the in-run BGM until
  // finish()/finishPk() crossfades, or the player returns to title.
  if (
    name === "title" ||
    name === "replays" ||
    name === "help" ||
    name === "about" ||
    (name === "settings" && settingsReturn !== "pause") ||
    (name === "display" && displayReturn !== "pause")
  )
    music.playTitle(name === "title" ? 1000 : 600);
}

function restartTitleGlitch() {
  const titleEl = ui.title;
  if (!titleEl) return;
  // Return uses the same sliced RGB glitch language as boot, but with a wider burst.
  titleEl.classList.remove("title-boot", "title-return", "title-return-glitch");
  void titleEl.offsetWidth;
  titleEl.classList.add("title-return-glitch");
}

function snapShow(name) {
  ui.replayControls.classList.toggle(
    "hidden",
    name !== "hud" || !game.playback,
  );
  for (const k of ALL_UI_KEYS) {
    const el = ui[k];
    if (!el) continue;
    clearScreenTransitionClasses(el);
    el.classList.toggle("hidden", k !== name);
  }
  activeScreen = name;
  if (name === "title") restartTitleGlitch();
  // Screens start as display:none; remeasure custom rails after they become visible.
  queueMicrotask(() => terminalScrolls.forEach((h) => h.refresh?.()));
  applyMusicForScreen(name);
}

/**
 * Animated menu transition:
 * - Enter panel from title: title fades out; panel fades in then expands vertically.
 * - Leave panel to title/parent: panel collapses + fades; parent fades in.
 * - Non-menu (hud/pause/result) and reduced-motion: instant snap.
 */
async function show(name, options = {}) {
  const force = Boolean(options.force);
  const from = activeScreen;
  if (!force && name === from && !screenTransition) {
    applyMusicForScreen(name);
    return;
  }

  // Cancel any in-flight transition by snapping the destination.
  screenTransitionToken += 1;
  const token = screenTransitionToken;
  if (screenTransition) {
    try {
      await screenTransition;
    } catch (_) {}
  }
  if (token !== screenTransitionToken) return;

  const useAnim =
    !force &&
    !prefersReducedMotion() &&
    MENU_SCREENS.has(from) &&
    MENU_SCREENS.has(name) &&
    from !== name;
  // Overlay screens (pause, result) entering/leaving gameplay also get animation.
  const overlayAnim =
    !force &&
    !prefersReducedMotion() &&
    ((name === "pause" && from === "hud") ||
     (from === "pause" && name === "hud") ||
     (name === "result" && from === "hud"));

  if (!useAnim && !overlayAnim) {
    snapShow(name);
    return;
  }

  const fromEl = ui[from];
  const toEl = ui[name];
  if (!fromEl || !toEl) {
    snapShow(name);
    return;
  }

  const enterPanel = PANEL_MENUS.has(name);
  const leavePanel = PANEL_MENUS.has(from);
  const run = (async () => {
    document.body.classList.add("ui-transitioning");
    ui.replayControls.classList.toggle(
      "hidden",
      name !== "hud" || !game.playback,
    );

    // Keep both screens painted during the crossfade / panel morph.
    clearScreenTransitionClasses(fromEl);
    clearScreenTransitionClasses(toEl);
    fromEl.classList.remove("hidden");
    /* Prevent the incoming screen from flashing at full opacity before the
       transition class (which sets opacity:0) is applied in the next lines. */
    toEl.style.opacity = "0";
    toEl.classList.remove("hidden");
    fromEl.classList.add("is-transitioning");
    toEl.classList.add("is-transitioning");

    if (overlayAnim && name === "pause") {
      // Entering pause from gameplay: overlay fades in, modal scales up.
      toEl.classList.add("overlay-enter");
    } else if (overlayAnim && from === "pause" && name === "hud") {
      // Leaving pause back to gameplay: overlay fades out.
      fromEl.classList.add("overlay-leave");
    } else if (overlayAnim && name === "result") {
      toEl.classList.add("overlay-enter");
    } else if (enterPanel && !PANEL_MENUS.has(from)) {
      // Overlay → panel: hide overlay immediately; panel enters with animation.
      if (!fromEl.classList.contains("overlay")) {
        fromEl.classList.add("screen-fade-out");
      }
      toEl.classList.add("screen-enter");
    } else if (leavePanel && (name === "title" || MENU_SCREENS.has(name))) {
      fromEl.classList.add("screen-leave");
      toEl.classList.add(
        name === "title" || !PANEL_MENUS.has(name)
          ? "screen-fade-in"
          : "screen-enter",
      );
    } else {
      fromEl.classList.add("screen-fade-out");
      toEl.classList.add("screen-fade-in");
    }

    /* Now that the CSS transition class (opacity:0) is in place, clear the
       inline guard so the CSS animation can take over. */
    toEl.style.opacity = "";

    await nextPaint();
    await nextPaint();
    if (token !== screenTransitionToken) return;

    fromEl.classList.add(
      fromEl.classList.contains("screen-leave")
        ? "screen-leave-active"
        : fromEl.classList.contains("overlay-leave")
          ? "overlay-leave-active"
          : "screen-fade-out-active",
    );
    toEl.classList.add(
      toEl.classList.contains("screen-enter")
        ? "screen-enter-active"
        : toEl.classList.contains("overlay-enter")
          ? "overlay-enter-active"
          : "screen-fade-in-active",
    );

    applyMusicForScreen(name);
    await waitMs(TRANSITION_MS);
    if (token !== screenTransitionToken) return;

    for (const k of ALL_UI_KEYS) {
      const el = ui[k];
      if (!el) continue;
      clearScreenTransitionClasses(el);
      el.classList.toggle("hidden", k !== name);
    }
    activeScreen = name;
    // Returning to title: re-trigger the boot-in glitch animation on h1.
    if (name === "title") restartTitleGlitch();
    queueMicrotask(() => terminalScrolls.forEach((h) => h.refresh?.()));
  })();

  screenTransition = run.finally(() => {
    document.body.classList.remove("ui-transitioning");
    if (screenTransition === run) screenTransition = null;
  });
  await screenTransition;
}
let seedRestrictionsDisabled = false, randomSeedHoldCount = 0, randomSeedHoldTimer = null, randomSeedLongPressed = false;
function sanitizeSeed(value) {
  const raw = String(value || "").trim();
  return seedRestrictionsDisabled
    ? raw
    : raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
}
function resetRandomSeedHold() {
  randomSeedHoldCount = 0;
  if (randomSeedHoldTimer) clearTimeout(randomSeedHoldTimer);
  randomSeedHoldTimer = null;
}
function randomSeed() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}
function normalizeSeed() {
  const raw = sanitizeSeed(ui.seedInput.value);
  seedText = raw || randomSeed();
  ui.seedInput.value = seedText;
  ui.seedPreview.textContent = seedText;
  return hashSeed(seedText);
}
function renderViewModeOption(mode) {
  ui.viewModeLabel.textContent = mode === "3d" ? "3D 第一人称" : "2D 俯视";
  ui.fovRow.hidden = mode !== "3d";
  ui.sensitivityRow.hidden = mode !== "3d";
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === mode));
}
function setViewMode(mode) {
  viewMode = mode;
  settingsViewMode = mode;
  document.body.dataset.viewMode = mode;
  renderViewModeOption(mode);
}
function setLegends() {
  const times =
    viewMode === "2d"
      ? { red: "永久", green: "3s", blue: "7s" }
      : { red: "9s", green: "7s", blue: "5s" };
  ui.redLegend.textContent = `直波 · ${times.red}`;
  ui.greenLegend.textContent = `反射 · ${times.green}`;
  ui.blueLegend.textContent = `环扫 · ${times.blue}`;
}
function openSettings(from = game.state === "pause" ? "pause" : "title") {
  // Every new wake-up/settings visit starts a fresh long-press sequence.
  resetRandomSeedHold();
  settingsReturn = from;
  settingsViewMode = viewMode;
  ui.seedInput.value = seedText || "";
  renderViewModeOption(settingsViewMode);
  ui.seedPreview.textContent = ui.seedInput.value || "随机生成";
  show("settings");
}
function isLandscape() {
  return innerWidth >= innerHeight;
}
function showLandscapePrompt() {
  if (isMobileBrowser && !isLandscape())
    ui.landscapePrompt.classList.remove("hidden");
}
function hideLandscapePrompt() {
  ui.landscapePrompt.classList.add("hidden");
}
async function requestMobileLandscape(fromGesture = false) {
  const result = await requestLandscapeMode({
    mobile: isMobileBrowser,
    fromGesture,
    documentRef: document,
    screenRef: screen,
    width: () => innerWidth,
    height: () => innerHeight,
  });
  if (result.dismissPrompt) hideLandscapePrompt();
  else showLandscapePrompt();
  if (result.failed && fromGesture)
    say("无法自动锁定横屏；可手动旋转设备，当前仍允许继续。", 4);
  return result.locked;
}
requestMobileLandscape();
window.addEventListener("orientationchange", () => {
  if (isLandscape()) hideLandscapePrompt();
  else showLandscapePrompt();
});
document.getElementById("enable-landscape-btn").onclick = () =>
  requestMobileLandscape(true);
function replayLabel(replay) {
  const when = new Date(replay.createdAt).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const mode = replay.mode === "3d" ? "3D" : "2D";
  const outcome = replay.success ? `完成 · ${replay.rank}` : "未完成";
  return `${mode} · ${replay.seed} · ${replay.duration.toFixed(1)}s · ${outcome} · ${when}`;
}
function renderReplayList(replays) {
  ui.replayList.replaceChildren();
  if (!replays.length) {
    const empty = document.createElement("p");
    empty.className = "replay-empty";
    empty.textContent = "暂无本地回放。完成或失败一局后，记录会自动加密保存。";
    ui.replayList.append(empty);
    queueMicrotask(() => terminalScrolls.forEach((h) => h.refresh?.()));
    return;
  }
  // Group by chainId
  const groups = new Map();
  for (const replay of replays) {
    const key = replay.chainId || replay.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(replay);
  }
  for (const [chainId, chain] of groups) {
    const opened = expandedChains.has(chainId);
    const isFolded = chain.length > 1;
    // Show the most recent entry as the primary row
    const primary = chain[0];
    const row = document.createElement("article");
    row.className = "replay-entry";
    row.dataset.chainId = chainId;
    const text = document.createElement("p");
    text.textContent = isFolded
      ? `${replayLabel(primary)}  (共 ${chain.length} 条 PK 链)`
      : replayLabel(primary);
    const actions = document.createElement("div");
    actions.className = "replay-entry-actions";
    for (const [action, label] of [
      ["watch", "观看回放"],
      ["challenge", "与它 PK"],
      ["export", "导出"],
      ["delete", "删除"],
    ]) {
      const button = document.createElement("button");
      button.className =
        action === "challenge" ? "primary" : action === "delete" ? "danger" : "ghost";
      button.dataset.replayAction = action;
      button.dataset.replayId = primary.id;
      button.textContent = label;
      actions.append(button);
    }
    if (isFolded) {
      const toggle = document.createElement("button");
      toggle.className = "ghost replay-toggle";
      toggle.textContent = opened ? "▲ 折叠" : `▼ 展开 (${chain.length})`;
      toggle.addEventListener("click", () => {
        if (opened) expandedChains.delete(chainId);
        else expandedChains.add(chainId);
        renderReplayList(replays);
      });
      actions.prepend(toggle);
    }
    row.append(text, actions);
    ui.replayList.append(row);
    // Show folded children
    if (opened && isFolded) {
      for (let i = 1; i < chain.length; i++) {
        const child = document.createElement("article");
        child.className = "replay-entry replay-child";
        child.style.paddingLeft = "28px";
        const childText = document.createElement("p");
        childText.textContent = replayLabel(chain[i]);
        const childActions = document.createElement("div");
        childActions.className = "replay-entry-actions";
        for (const [action, label] of [
          ["watch", "观看"],
          ["challenge", "PK"],
          ["export", "导出"],
          ["delete", "删除"],
        ]) {
          const button = document.createElement("button");
          button.className =
            action === "challenge"
              ? "primary"
              : action === "delete"
                ? "danger"
                : "ghost";
          button.dataset.replayAction = action;
          button.dataset.replayId = chain[i].id;
          button.textContent = label;
          childActions.append(button);
        }
        child.append(childText, childActions);
        ui.replayList.append(child);
      }
    }
  }
  queueMicrotask(() => terminalScrolls.forEach((h) => h.refresh?.()));
}
const expandedChains = new Set();
/** In-memory list cache so reopening PK does not re-decrypt every record. */
let replayListCache = null;
let replayListCachePromise = null;

function invalidateReplayListCache() {
  replayListCache = null;
  replayListCachePromise = null;
}

async function getReplayList(force = false) {
  if (!force && replayListCache) return replayListCache;
  if (!force && replayListCachePromise) return replayListCachePromise;
  replayListCachePromise = loadReplays()
    .then((list) => {
      replayListCache = list;
      replayListCachePromise = null;
      return list;
    })
    .catch((error) => {
      replayListCachePromise = null;
      throw error;
    });
  return replayListCachePromise;
}

async function openReplays() {
  // Paint the menu immediately; decrypt in the background so the transition is not blocked.
  if (!replayListCache) ui.replayList.textContent = "正在读取本地加密回放…";
  else renderReplayList(replayListCache);
  const transition = show("replays");
  try {
    const list = await getReplayList();
    if (activeScreen === "replays" || !ui.replays.classList.contains("hidden"))
      renderReplayList(list);
  } catch (_) {
    if (!replayListCache)
      ui.replayList.textContent = "无法读取本地回放。";
  }
  await transition;
}
async function startSavedReplay(id, challenge) {
  const replay = (await getReplayList()).find((entry) => entry.id === id);
  if (!replay) {
    invalidateReplayListCache();
    return openReplays();
  }
  seedText = replay.seed;
  ui.seedInput.value = seedText;
  settingsViewMode = replay.mode;
  if (!challenge) {
    // Replay playback uses the stored route as the only active robot.
    activeGhostReplay = replay;
    start(replay, true);
    return;
  }
  start(replay);
}
function updateReplayControls() {
  ui.replaySpeed.textContent = `${replaySpeed}×`;
  ui.replayPlay.textContent = replayPaused ? "▶ 播放" : "Ⅱ 暂停";
  document
    .querySelectorAll("[data-replay-speed]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        Number(button.dataset.replaySpeed) === replaySpeed,
      ),
    );
}
function rebuildPlaybackWorld(time) {
  const samples = activeGhostReplay.samples.filter(
    (sample) => sample.t <= time,
  );
  game.beacons = [];
  game.picked = 0;
  for (const crystal of game.crystals) {
    crystal.picked = samples.some(
      (sample) => Math.hypot(sample.x - crystal.x, sample.y - crystal.y) < 0.38,
    );
    if (crystal.picked) game.picked++;
  }
  for (const item of game.items) {
    item.picked = samples.some(
      (sample) => Math.hypot(sample.x - item.x, sample.y - item.y) < 0.4,
    );
    if (item.picked && item.type === "beacon")
      game.beacons.push({ x: item.x, y: item.y });
  }

  game.pings = [];
  game.trails = [];
  game.revealed.clear();
  // Re-simulate every prior wave in small time slices. Besides rebuilding the
  // green bounce path, this preserves the true wall-hit time used for expiry.
  for (const event of activeGhostReplay.events) {
    if (event.t > time) break;
    const ping = createPing(event.type, event.x, event.y, event.a);
    const elapsed = time - event.t;
    const slice = 1 / 60;
    for (let progressed = 0; progressed < elapsed && !ping.dead; progressed += slice) {
      const dt = Math.min(slice, elapsed - progressed);
      game.time = event.t + progressed + dt;
      stepPing(ping, maze, SONAR_TYPES[event.type].speed * dt, reveal);
    }
    if (!ping.dead) game.pings.push(ping);
  }
  game.time = time;
  for (const [key, revealed] of game.revealed)
    if (revealed.until <= time) game.revealed.delete(key);
}
function seekReplay(offset) {
  if (!game.playback || !activeGhostReplay) return;
  const time = clampReplayTime(activeGhostReplay, game.scoreTime + offset);
  const state = sampleReplay(activeGhostReplay, time);
  if (!state) return;
  game.time = time;
  game.scoreTime = time;
  game.player = { ...game.player, x: state.x, y: state.y, angle: state.a };
  game.energy = state.e;
  rebuildPlaybackWorld(time);
  game.replayEventIndex = replayEventCursor(activeGhostReplay, time);
  updateHud();
}
/** Wrap each character in a <span> with a random animation-delay for per-char flicker. */
function setFlickerText(el, text) {
  el.textContent = "";
  const frag = document.createDocumentFragment();
  for (const ch of text) {
    const span = document.createElement("span");
    span.textContent = ch;
    span.className = "flicker-char";
    span.style.setProperty("--fd", `${(Math.random() * 1.0).toFixed(3)}s`);
    frag.appendChild(span);
  }
  el.appendChild(frag);
}
function start(ghostReplay = null, playback = false) {
  // Playback is passive: always restore the browser cursor even if a previous
  // first-person session left Pointer Lock active. Leave "play" first so the
  // unlock is not treated as an ESC pause by pointerlockchange.
  if (playback && document.pointerLockElement === canvas) {
    if (game.state === "play") game.state = "title";
    document.exitPointerLock();
  }
  canvas.style.cursor = playback ? "default" : "";
  clearInput();
  resetMobilePointers();
  replaySpeed = 1;
  replayPaused = false;
  updateReplayControls();
  setViewMode(settingsViewMode);
  applyLayout(settingsViewMode);
  // Resolve the seed now so the mask can display it, but defer heavy work.
  const seed = normalizeSeed();
  const isPK = Boolean(ghostReplay && !playback);
  const modeLabel = isPK ? "对战" : playback ? "回放" : "标准";
  const modeClass = isPK ? "mode-pk" : playback ? "mode-replay" : "mode-standard";
  const viewLabel = settingsViewMode === "3d" ? "3D" : "2D";
  launchLabel.textContent = "BLINDSPOT PROTOCOL";
  setFlickerText(launchMode, `MODE · ${modeLabel} · ${viewLabel}`);
  launchSeed.textContent = "VISUAL MODULE FAILURE · NAVIGATION PROTOCOL 03";

  if (prefersReducedMotion()) {
    // Reduced motion: load game immediately, no mask.
    buildAndStartGame(seed, ghostReplay, playback);
    return;
  }

  // ── Phase 1: show launch mask, bars expand from corners ──
  game.launching = true;
  launchMask.className = `launch-mask ${modeClass}`;
  launchMask.classList.remove("hidden");
  launchMask.classList.add("launch-start");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      launchMask.classList.remove("launch-start");
      launchMask.classList.add("launch-load");
    });
  });

  // Phase 2: after bars cover the screen, build the game behind the mask.
  const EXPAND_MS  = 1050;
  const HOLD_MS    = 1000;
  const SHRINK_MS  = 550;

  setTimeout(() => {
    buildAndStartGame(seed, ghostReplay, playback);
  }, EXPAND_MS);

  // Phase 3: after hold, shrink the mask away.
  setTimeout(() => {
    launchMask.classList.remove("launch-load");
    launchMask.classList.add("launch-hide");
  }, EXPAND_MS + HOLD_MS);

  // Phase 4: clean up mask DOM — unlock input only after shrink completes.
  setTimeout(() => {
    launchMask.classList.add("hidden");
    launchMask.classList.remove("launch-hide", modeClass);
    game.launching = false;
  }, EXPAND_MS + HOLD_MS + SHRINK_MS);
}

/** Heavy game setup that runs while the launch mask covers the screen. */
function buildAndStartGame(seed, ghostReplay, playback) {
  maze = buildMaze(seed);
  game = fresh("play");
  game.playback = playback;
  game.challenge = Boolean(ghostReplay && !playback);
  game.launching = true;  // will be cleared by the shrink timeout
  game.replayEventIndex = 0;
  activeGhostReplay = ghostReplay;
  replayRecorder = playback
    ? null
    : createReplayRecorder(
        seedText,
        viewMode,
        ghostReplay?.chainId || ghostReplay?.id || null,
      );
  // Anchor the route at spawn before the first simulation frame. Without this,
  // a hitchy first move (dt up to 0.04s) records the player already past the
  // spawn epsilon and saveReplay rejects the whole run.
  if (replayRecorder)
    recordReplaySample(replayRecorder, 0, game.player, game.energy, true);
  game.crystals = placeCrystals(seed);
  game.items = placeItems(seed, game.crystals);
  // Never reuse packed rays from a prior maze/view when a mobile game first appears.
  raycastState.hits = null;
  raycastState.ready = false;
  raycastState.pendingId = 0;
  ui.sector.textContent = `SEED · ${seedText}`;
  ui.controlGuide.textContent =
    viewMode === "3d"
      ? "3D：WASD / 方向键移动 · 鼠标控制视角"
      : "2D：W/S 前后 · A/D / ←→ 转向";
  setLegends();
  snapShow("hud");
  // PK uses the race theme; normal runs and passive playback use background.
  if (game.challenge) music.playRace(800);
  else music.playBackground(800);
  say("视觉模块离线。声波会随传播扩宽；寻找能源补给站。");
  updateHud();
  if (
    viewMode === "3d" &&
    !mobileControlsEnabled() &&
    !playback &&
    canvas.requestPointerLock
  )
    canvas.requestPointerLock().catch(() => {});
}

/**
 * Yellow launch mask played when returning to the title screen from pause.
 * Covers the screen, runs the onCover callback (to switch screens), then shrinks.
 */
function playReturnMask(onCover) {
  game.launching = true;
  launchLabel.textContent = "BLINDSPOT PROTOCOL";
  const returnMode = game.challenge ? "对战" : game.playback ? "回放" : "标准";
  const returnView = viewMode === "3d" ? "3D" : "2D";
  setFlickerText(launchMode, `EXIT · 退出`);
  launchSeed.textContent = "VISUAL MODULE FAILURE · NAVIGATION PROTOCOL 03";
  launchMask.className = "launch-mask mode-return";
  launchMask.classList.remove("hidden");
  launchMask.classList.add("launch-start");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      launchMask.classList.remove("launch-start");
      launchMask.classList.add("launch-load");
    });
  });

  const EXPAND_MS  = 1050;
  const HOLD_MS    = 800;
  const SHRINK_MS  = 550;

  setTimeout(() => {
    onCover();
  }, EXPAND_MS);

  setTimeout(() => {
    launchMask.classList.remove("launch-load");
    launchMask.classList.add("launch-hide");
  }, EXPAND_MS + HOLD_MS);

  setTimeout(() => {
    launchMask.classList.add("hidden");
    launchMask.classList.remove("launch-hide", "mode-return");
    game.launching = false;
  }, EXPAND_MS + HOLD_MS + SHRINK_MS);
}
function resetMap() {
  if (!seedText) return;
  start(activeGhostReplay, game.playback);
}
function say(t, duration = 2.7) {
  ui.objective.textContent = t;
  game.toastUntil = game.time + duration;
}
function collides(x, y, r = game.player.r) {
  return collidesWithMaze(maze, x, y, r);
}
function movePlayer(dt) {
  if (game.playback) {
    const state = sampleReplay(activeGhostReplay, game.scoreTime + dt);
    if (state)
      game.player = {
        ...game.player,
        x: state.x,
        y: state.y,
        angle: state.a,
      };
    if (state) game.energy = state.e;
    return;
  }
  game.player = stepPlayer(
    game.player,
    input,
    viewMode,
    game.energy,
    dt,
    collides,
  ).player;
}
function ghostPlayer() {
  if (!activeGhostReplay || game.playback) return null;
  return sampleReplay(activeGhostReplay, game.scoreTime);
}
function playPingSound(type) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || sfxVolume <= 0.001) return;
  if (!audioContext) audioContext = new AudioCtx();
  if (audioContext.state === "suspended") audioContext.resume();
  const ac = audioContext,
    now = ac.currentTime,
    gain = ac.createGain(),
    osc = ac.createOscillator(),
    s = sfxVolume;
  gain.connect(ac.destination);
  osc.connect(gain);
  if (type === "red") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.22);
    gain.gain.setValueAtTime(0.12 * s, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.start(now);
    osc.stop(now + 0.25);
  } else if (type === "green") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(310, now);
    osc.frequency.linearRampToValueAtTime(510, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.46);
    gain.gain.setValueAtTime(0.075 * s, now);
    gain.gain.linearRampToValueAtTime(0.11 * s, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.51);
  } else {
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.55);
    gain.gain.setValueAtTime(0.035 * s, now);
    gain.gain.linearRampToValueAtTime(0.065 * s, now + 0.09);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
    osc.start(now);
    osc.stop(now + 0.63);
  }
}
function emitPing(type) {
  game.pings.push(
    createPing(type, game.player.x, game.player.y, game.player.angle),
  );
}
function shoot(type) {
  if (game.playback) return;
  const result = tryFireSonar(game, type);
  if (!result.ok) {
    if (result.reason === "silent") say("静默电容工作中：声呐暂时禁用。");
    else if (result.reason === "cooldown") flashCooldownChannel(type);
    else if (result.reason === "energy") say("能源不足，无法发射。");
    return;
  }
  playPingSound(type);
  emitPing(type);
  if (replayRecorder)
    recordReplaySonar(replayRecorder, game.scoreTime, type, game.player);
}
function reveal(w, type) {
  const life =
    viewMode === "2d"
      ? { red: Infinity, green: 3, blue: 7 }[type]
      : TYPES[type].life;
  const old = game.revealed.get(w.key);
  const until = life === Infinity ? Infinity : game.time + life;
  if (!old || old.until < until)
    game.revealed.set(w.key, {
      wall: w,
      until,
      color: TYPES[type].color,
      type,
    });
}
const BEACON_REVEAL_RADIUS = 2.35;
function beaconWallColor(w) {
  return game.beacons.some(
    (beacon) =>
      Math.hypot((w.x1 + w.x2) / 2 - beacon.x, (w.y1 + w.y2) / 2 - beacon.y) <=
      BEACON_REVEAL_RADIUS,
  )
    ? TYPES.beacon.color
    : null;
}
function pathToEnd() {
  const startX = Math.floor(game.player.x),
    startY = Math.floor(game.player.y),
    endX = Math.floor(maze.end.x),
    endY = Math.floor(maze.end.y),
    start = `${startX},${startY}`,
    goal = `${endX},${endY}`,
    queue = [[startX, startY]],
    previous = new Map([[start, null]]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (`${x},${y}` === goal) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        key = `${nx},${ny}`;
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= maze.cols ||
        ny >= maze.rows ||
        previous.has(key) ||
        !maze.open.has(`${x},${y}:${nx},${ny}`)
      )
        continue;
      previous.set(key, `${x},${y}`);
      queue.push([nx, ny]);
    }
  }
  const path = [];
  for (let key = goal; key; key = previous.get(key)) {
    const [x, y] = key.split(",").map(Number);
    path.push({ x: x + 0.5, y: y + 0.5 });
  }
  return path.reverse();
}
function emitReplayPings() {
  if (!game.playback) return;
  const events = activeGhostReplay?.events || [];
  while (
    game.replayEventIndex < events.length &&
    events[game.replayEventIndex].t <= game.scoreTime
  ) {
    const event = events[game.replayEventIndex++];
    game.pings.push(createPing(event.type, event.x, event.y, event.a));
  }
}
function updatePings(dt) {
  emitReplayPings();
  for (const ping of game.pings) {
    stepPing(ping, maze, SONAR_TYPES[ping.type].speed * dt, reveal);
    for (const ray of ping.rays) {
      if (
        ray.active &&
        Math.hypot(ray.x - game.player.x, ray.y - game.player.y) > 30
      )
        ray.active = false;
    }
    ping.dead = ping.rays.every((ray) => !ray.active);
  }
  for (const ping of game.pings) {
    if (ping.dead)
      game.trails.push({
        rays: ping.rays,
        color: TYPES[ping.type].color,
        until: game.time + 0.75,
      });
  }
  game.pings = game.pings.filter((ping) => !ping.dead);
  game.trails = game.trails.filter((trail) => trail.until > game.time);
  for (const [key, revealed] of game.revealed)
    if (revealed.until <= game.time) game.revealed.delete(key);
}
function collectCrystals() {
  for (const c of game.crystals)
    if (
      !c.picked &&
      Math.hypot(c.x - game.player.x, c.y - game.player.y) < 0.38
    ) {
      c.picked = true;
      game.picked++;
      game.energy = Math.min(100, game.energy + 18);
      say("小型能源已接入：+18% 能源");
    }
}
function activateItem(item) {
  item.picked = true;
  if (item.type === "beacon") {
    game.beacons.push({ x: item.x, y: item.y });
    say("回声信标已部署：更大范围内的迷宫墙壁将始终显影。", 3.4);
  } else if (item.type === "capacitor") {
    game.silentUntil = game.time + 8;
    say("静默电容已接入：8 秒内移动也会恢复能源，声呐暂时禁用。", 3.4);
  } else if (viewMode === "3d") {
    game.pathHint = pathToEnd();
    game.pathFlashStarted = game.time;
    game.pathFlashUntil = game.time + 2.4;
    say("闪域谐振器已触发：通往终点的路径将闪烁 3 次。", 3.2);
  } else {
    game.flashStarted = game.time;
    game.flashUntil = game.time + 1.5;
    say("闪域谐振器已触发：迷宫墙体正在闪烁。", 3.2);
  }
}
function collectItems() {
  for (const item of game.items)
    if (
      !item.picked &&
      Math.hypot(item.x - game.player.x, item.y - game.player.y) < 0.4
    )
      activateItem(item);
}
function update(dt) {
  if (game.state !== "play" || game.launching) return;
  if (game.playback && replayPaused) {
    updateHud();
    return;
  }
  if (game.playback) dt *= replaySpeed;
  const inputActive = game.playback
    ? activeGhostReplay?.samples.length > 1
    : startsTimerFromInput(input, viewMode);
  const previous = { x: game.player.x, y: game.player.y };
  movePlayer(dt);
  const moving =
    Math.hypot(game.player.x - previous.x, game.player.y - previous.y) >
      0.0001 || Math.abs(game.player.turnV) > 0.025;
  const { silentActive } = updateClockAndEnergy(game, dt, {
    moving,
    inputActive,
  });
  if (replayRecorder)
    recordReplaySample(
      replayRecorder,
      game.scoreTime,
      game.player,
      game.energy,
    );
  updatePings(dt);
  collectCrystals();
  collectItems();
  if (game.playback && game.scoreTime >= replayDuration(activeGhostReplay)) {
    let rank = activeGhostReplay.rank;
    // Convert PK ranks to completion ratings for replay viewing.
    if (typeof rank === "string" && rank.startsWith("PK-")) {
      const time = replayDuration(activeGhostReplay);
      rank = activeGhostReplay.success
        ? (time <= 50 ? "S" : time <= 70 ? "A" : time <= 100 ? "B" : "C")
        : "D";
    }
    finish(rank, activeGhostReplay.success);
    return;
  }
  const playerReached =
    !game.playback &&
    Math.hypot(game.player.x - maze.end.x, game.player.y - maze.end.y) < 0.38;
  if (game.challenge) {
    const rivalTime = replayDuration(activeGhostReplay);
    const rivalReached =
      activeGhostReplay?.success && game.scoreTime >= rivalTime;
    if (playerReached || rivalReached) {
      const playerWon =
        playerReached && (!rivalReached || game.scoreTime <= rivalTime);
      finishPk(playerWon ? "player" : "rival", playerWon ? game.scoreTime : rivalTime);
      return;
    }
  } else if (playerReached) {
    complete();
    return;
  }
  if (game.scoreTime >= 200) {
    if (game.challenge) finishPk("draw", game.scoreTime);
    else fail();
    return;
  }
  if (game.toastUntil < game.time)
    ui.objective.textContent = silentActive
      ? `静默电容 ${Math.ceil(game.silentUntil - game.time)} 秒 · 声呐禁用，移动恢复能源。`
      : "寻找能源补给站。墙壁只会在声波波前命中后短暂显影。";
  updateHud();
}
function flashCooldownChannel(type) {
  const channel = document.querySelector(`[data-sonar-channel="${type}"]`);
  channel?.classList.remove("alert");
  requestAnimationFrame(() => channel?.classList.add("alert"));
}
function updateSonarConsole() {
  for (const type of ["red", "green", "blue"]) {
    const remaining = sonarCooldownRemaining(game, type);
    const channel = document.querySelector(`[data-sonar-channel="${type}"]`);
    const label = ui.cooldown[type];
    if (!channel || !label) continue;
    const progress = Math.max(0, Math.min(1, remaining / SONAR[type].cooldown));
    label.textContent = remaining > 0 ? `${remaining.toFixed(1)}S` : "READY";
    channel.classList.toggle("cooling", remaining > 0);
    channel.style.setProperty("--cooldown-progress", String(progress));
  }
}
function updateHud() {
  ui.energyFill.style.width = game.energy.toFixed(1) + "%";
  ui.energyText.textContent = Math.floor(game.energy) + "%";
  ui.energyFill.style.background =
    game.energy < 25 ? "var(--red)" : "var(--green)";
  const total = Math.max(0, game.scoreTime),
    minutes = Math.floor(total / 60),
    seconds = (total % 60).toFixed(1).padStart(4, "0");
  ui.timer.textContent = `${String(minutes).padStart(2, "0")}:${seconds}`;
  updateSonarConsole();
}
function saveCurrentReplay(rank, success) {
  if (!replayRecorder) return;
  // Always stamp the final pose so duration/route validation stays consistent.
  recordReplaySample(
    replayRecorder,
    game.scoreTime,
    game.player,
    game.energy,
    true,
  );
  const record = finishReplayRecord(
    replayRecorder,
    game.scoreTime,
    success,
    rank,
  );
  // Detach the live recorder before the async write so a second finish cannot
  // mutate the payload mid-encrypt.
  replayRecorder = null;
  saveReplay(record)
    .then(() => {
      invalidateReplayListCache();
      const note = "\n回放已加密保存到本地档案。";
      if (ui.resultText && !ui.resultText.textContent.includes("回放已"))
        ui.resultText.textContent += note;
    })
    .catch((error) => {
      console.warn("Failed to save local replay:", error?.message || error);
      const note = `\n回放保存失败：${error?.message || "存储不可用"}`;
      if (ui.resultText && !ui.resultText.textContent.includes("回放保存失败"))
        ui.resultText.textContent += note;
    });
}
function finish(rank, success) {
  if (game.state !== "play") return;
  saveCurrentReplay(rank, success);
  // Leave play before unlocking so pointerlockchange does not re-enter pause.
  game.state = "done";
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  canvas.style.cursor = "default";
  clearInput();
  resetMobilePointers();
  const total = game.shots.red + game.shots.green + game.shots.blue;
  document.getElementById("result-signal").textContent = success
    ? "ENERGY LINK ESTABLISHED"
    : "NAVIGATION WINDOW EXPIRED";
  document.getElementById("result-heading").textContent = success
    ? "补给完成"
    : "导航失败";
  ui.rank.hidden = false;
  ui.rank.textContent = rank;
  ui.rank.dataset.rank = rank;
  ui.resultText.textContent = `地图种子 ${seedText}\n导航耗时 ${game.scoreTime.toFixed(1)} 秒 · 能源拾取 ${game.picked}/10\n声波发射 ${total} 次`;
  show("result");
  // Game BGM fades out while title theme fades in.
  music.playTitle(1600);
}
function finishPk(winner, winningTime) {
  if (game.state !== "play") return;
  const playerWon = winner === "player";
  const rivalWon = winner === "rival";
  const resultRank = playerWon ? "PK-W" : rivalWon ? "PK-L" : "PK-D";
  if (!rivalWon) saveCurrentReplay(resultRank, playerWon);
  // Leave play before unlocking so pointerlockchange does not re-enter pause.
  game.state = "done";
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  canvas.style.cursor = "default";
  clearInput();
  resetMobilePointers();
  document.getElementById("result-signal").textContent = "RACE LINK TERMINATED";
  document.getElementById("result-heading").textContent =
    playerWon ? "PK 胜利" : rivalWon ? "PK 失败" : "PK 平局";
  ui.rank.hidden = true;
  ui.resultText.textContent =
    `${playerWon ? "你先抵达终点" : rivalWon ? "对手先抵达终点" : "双方未能完成导航"}` +
    `\n获胜方用时 ${winningTime.toFixed(1)} 秒` +
    `\n地图种子 ${seedText}`;
  show("result");
  music.playTitle(1600);
}
function complete() {
  const rank =
    game.scoreTime <= 50
      ? "S"
      : game.scoreTime <= 70
        ? "A"
        : game.scoreTime <= 100
          ? "B"
          : "C";
  finish(rank, true);
}
function fail() {
  finish("D", false);
}
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2),
    renderScale = Math.max(0.65, dpr * (1 - crtAmount * 0.45)),
    backingWidth = Math.round(innerWidth * renderScale),
    backingHeight = Math.round(innerHeight * renderScale);
  if (
    viewport.width !== innerWidth ||
    viewport.height !== innerHeight ||
    canvas.width !== backingWidth ||
    canvas.height !== backingHeight
  ) {
    viewport.width = innerWidth;
    viewport.height = innerHeight;
    canvas.width = backingWidth;
    canvas.height = backingHeight;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  }
}
function view() {
  const mobile = mobileControlsEnabled(),
    pad = mobile ? 16 : 48,
    top = mobile ? 68 : 120,
    bottom = mobile ? 16 : 55,
    cell = Math.min(
      (viewport.width - pad * 2) / COLS,
      (viewport.height - top - bottom) / ROWS,
    );
  return {
    cell,
    ox: (viewport.width - COLS * cell) / 2,
    oy: top + (viewport.height - top - bottom - ROWS * cell) / 2,
  };
}
function world(x, y, v) {
  return { x: v.ox + x * v.cell, y: v.oy + y * v.cell };
}
function scheduleDraw() {
  // Full rate only during live play. Pause still draws the frozen scene behind
  // the menu, but at a low rate; pure GUI / background tabs go even lower.
  // Skip canvas drawing entirely during UI transitions to avoid frame contention.
  if (document.hidden || document.body.classList.contains("ui-transitioning"))
    setTimeout(() => requestAnimationFrame(draw), 1000 / 5);
  else if (game.state === "play") requestAnimationFrame(draw);
  else setTimeout(() => requestAnimationFrame(draw), 1000 / 15);
}
function draw() {
  resize();
  drawBackground();
  if (
    maze &&
    (game.state === "play" || game.state === "pause" || game.state === "done")
  ) {
    if (viewMode === "3d") draw3D();
    else draw2D();
  }
  scheduleDraw();
}
function drawBackground() {
  const g = ctx.createRadialGradient(
    viewport.width / 2,
    viewport.height / 2,
    0,
    viewport.width / 2,
    viewport.height / 2,
    Math.max(viewport.width, viewport.height) * 0.7,
  );
  g.addColorStop(0, "#10252a");
  g.addColorStop(0.5, "#071519");
  g.addColorStop(1, "#03090c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  ctx.strokeStyle = "#c6eee908";
  ctx.lineWidth = 2;
  for (let x = 0; x < viewport.width; x += 52) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewport.height);
    ctx.stroke();
  }
  for (let y = 0; y < viewport.height; y += 52) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(viewport.width, y);
    ctx.stroke();
  }
}
function glow(px) {
  return Math.max(0, px * glowAmount * (1 + glowAmount * 1.8));
}
function draw2D() {
  const v = view(),
    now = game.time;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const flash =
    game.flashUntil > now &&
    Math.floor((now - game.flashStarted) * 4) % 2 === 0;
  for (const r of game.revealed.values())
    drawWall2D(r.wall, r.color, Math.min(1, (r.until - now) / 0.45), v);
  for (const w of maze.walls) {
    const color = beaconWallColor(w);
    if (color) drawWall2D(w, color, 1, v);
  }
  if (flash) for (const w of maze.walls) drawWall2D(w, "#f4fff9", 1, v);
  for (const p of game.pings) drawWave2D(p, v);
  for (const t of game.trails)
    drawWaterFront2D(
      t.rays,
      t.color,
      v,
      Math.min(1, (t.until - game.time) * 1.8) * 0.34,
    );
  ctx.globalAlpha = 1;
  drawCrystals2D(v);
  drawItems2D(v);
  drawStation2D(v);
  const ghost = ghostPlayer();
  if (ghost) drawRobot2D(v, ghost, "#ffbf69", "#ff7a59");
  drawRobot2D(v);
  ctx.restore();
}
function drawWall2D(w, color, fade, v) {
  const a = world(w.x1, w.y1, v),
    b = world(w.x2, w.y2, v);
  ctx.globalAlpha = 0.18 + 0.82 * fade;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow(12);
  ctx.lineWidth = mobileControlsEnabled() ? 2.5 : 4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}
function wavePoint(ray, lag) {
  return { x: ray.x - ray.dx * lag, y: ray.y - ray.dy * lag };
}
function smoothCanvasPath(points, closed = false) {
  if (points.length < 2) return false;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    };
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  ctx.lineTo(points.at(-1).x, points.at(-1).y);
  if (closed) ctx.closePath();
  return true;
}
function drawWaterFront2D(rays, color, v, alpha = 0.62) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow(15);
  for (let band = 0; band < 3; band++) {
    const lag = band * 0.12,
      points = rays
        .map((ray) => wavePoint(ray, lag))
        .map((q) => world(q.x, q.y, v));
    ctx.globalAlpha = alpha * (1 - band * 0.25);
    ctx.lineWidth = band ? 1 : 2.2;
    if (smoothCanvasPath(points, rays.length > 40)) ctx.stroke();
  }
  ctx.restore();
}
function drawWave2D(p, v) {
  drawWaterFront2D(p.rays, TYPES[p.type].color, v, 0.68);
}
function drawCrystals2D(v) {
  for (const c of game.crystals)
    if (!c.picked) {
      const p = world(c.x, c.y, v),
        pulse = 1 + Math.sin(game.time * 5 + c.x) * 0.18;
      ctx.fillStyle = "#a9ef68";
      ctx.shadowColor = "#a9ef68";
      ctx.shadowBlur = glow(12);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(game.time);
      ctx.fillRect(-4 * pulse, -4 * pulse, 8 * pulse, 8 * pulse);
      ctx.restore();
      ctx.shadowBlur = 0;
    }
}
function itemColor(type) {
  return type === "beacon"
    ? "#e9b8ff"
    : type === "capacitor"
      ? "#ffd166"
      : "#f4fff9";
}
function drawItems2D(v) {
  for (const item of game.items)
    if (!item.picked) {
      const p = world(item.x, item.y, v),
        color = itemColor(item.type),
        pulse = 1 + Math.sin(game.time * 6 + item.x) * 0.13;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(item.type === "resonator" ? game.time * 0.8 : 0);
      ctx.strokeStyle = color;
      ctx.fillStyle = "#071317";
      ctx.shadowColor = color;
      ctx.shadowBlur = glow(16);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (item.type === "beacon") {
        ctx.arc(0, 0, 8 * pulse, 0, TAU);
        ctx.moveTo(-11, 0);
        ctx.lineTo(11, 0);
        ctx.moveTo(0, -11);
        ctx.lineTo(0, 11);
      } else if (item.type === "capacitor") {
        ctx.rect(-8, -6, 16, 12);
        ctx.moveTo(-3, -10);
        ctx.lineTo(-3, 10);
        ctx.moveTo(3, -10);
        ctx.lineTo(3, 10);
      } else {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU,
            x = Math.cos(a) * 10 * pulse,
            y = Math.sin(a) * 10 * pulse;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.moveTo(-6, 0);
        ctx.lineTo(6, 0);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
}
function drawStation2D(v) {
  const p = world(maze.end.x, maze.end.y, v),
    pulse = 1 + Math.sin(game.time * 4) * 0.12;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(game.time * 0.25);
  ctx.strokeStyle = "#a9ef68";
  ctx.shadowColor = "#a9ef68";
  ctx.shadowBlur = glow(22);
  ctx.lineWidth = 2;
  for (const radius of [12, 22, 31]) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * pulse, 0, TAU);
    ctx.stroke();
  }
  ctx.rotate(-game.time * 0.7);
  ctx.fillStyle = "#dffff0";
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2,
      x = Math.cos(a) * 10,
      y = Math.sin(a) * 10;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#a9ef68";
  ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();
}
function drawRobot2D(
  v,
  robot = game.player,
  bodyColor = "#e8f4ef",
  accentColor = "#5dddf1",
) {
  const p = world(robot.x, robot.y, v),
    r = v.cell * 0.2;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(robot.angle ?? robot.a ?? 0);
  ctx.fillStyle = bodyColor;
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = glow(13);
  ctx.beginPath();
  ctx.roundRect(-r, -r, r * 2, r * 2, 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#050d11";
  ctx.fillRect(r * 0.15, -r * 0.55, r * 0.55, r * 0.25);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r * 0.35, 0);
  ctx.lineTo(r * 1.45, 0);
  ctx.stroke();
  ctx.restore();
}
function rayCast(angle, max = 26) {
  return castGridRay(
    maze,
    game.player.x,
    game.player.y,
    Math.cos(angle),
    Math.sin(angle),
    max,
  );
}
function drawPerspectiveBackgroundFloor(horizon) {
  const w = viewport.width,
    h = viewport.height,
    floorHeight = h - horizon;
  // Flat fills are much cheaper than a radial gradient every frame.
  ctx.fillStyle = "#071519";
  ctx.fillRect(0, horizon, w, floorHeight);
  ctx.fillStyle = "#0b1d22";
  ctx.fillRect(0, 0, w, horizon);
}
function paintWallColumn(i, slice, horizon, h, angle, hit, flash) {
  if (!hit) return;
  const wall = hit.wall;
  const reveal = game.revealed.get(wall.key),
    beaconColor = beaconWallColor(wall);
  if (!reveal && !flash && !beaconColor) return;
  const cos = Math.cos(angle - game.player.angle);
  const rawDist =
    hit.distance != null
      ? hit.distance
      : Math.hypot(hit.x - game.player.x, hit.y - game.player.y);
  const d = Math.max(0.08, rawDist * cos),
    wallH = Math.min(h * 1.6, (h / d) * 0.68),
    fade =
      flash || beaconColor
        ? 1
        : Math.min(1, (reveal.until - game.time) / 0.45),
    shade = Math.max(0.16, 1 - d / 14) * fade,
    color = flash ? "#f4fff9" : beaconColor || reveal.color;
  ctx.globalAlpha = 0.15 + 0.85 * shade;
  ctx.fillStyle = color;
  // Skip per-column shadowBlur (major canvas cost); objects/overlay still glow.
  ctx.fillRect(i * slice, horizon - wallH / 2, slice + 1, wallH);
}
function castColumnsMainThread(cols, fov, maxDistance = 26) {
  const stride = 8;
  const out = new Float64Array(1 + cols * stride);
  out[0] = cols;
  const px = game.player.x,
    py = game.player.y;
  for (let i = 0; i < cols; i++) {
    const ratio = cols === 1 ? 0 : i / (cols - 1) - 0.5;
    const angle = game.player.angle + ratio * fov;
    const hit = castGridRay(
      maze,
      px,
      py,
      Math.cos(angle),
      Math.sin(angle),
      maxDistance,
    );
    const base = 1 + i * stride;
    if (!hit) {
      out[base] = 0;
      continue;
    }
    out[base] = 1;
    out[base + 1] = hit.x;
    out[base + 2] = hit.y;
    out[base + 3] = hit.distance;
    out[base + 4] = hit.wall.x1;
    out[base + 5] = hit.wall.y1;
    out[base + 6] = hit.wall.x2;
    out[base + 7] = hit.wall.y2;
  }
  return out;
}
function draw3D() {
  const w = viewport.width,
    h = viewport.height,
    pitch = game.player.pitch || 0,
    pitchOffset = Math.sin(pitch) * h * 0.45,
    horizon = h * 0.5 + pitchOffset,
    fov = (fovDegrees * Math.PI) / 180,
    flash =
      game.flashUntil > game.time &&
      Math.floor((game.time - game.flashStarted) * 4) % 2 === 0;
  // Adaptive column density: fewer rays on large/high-DPR canvases.
  const colStep = w > 1400 ? 4 : w > 900 ? 3 : 2;
  const cols = Math.max(80, Math.ceil(w / colStep)),
    slice = w / cols;
  drawPerspectiveBackgroundFloor(horizon);

  // Kick worker cast for next frame; draw latest completed hits (or sync now).
  const usingWorker = requestRaycastColumns(cols, fov);
  let hits = raycastState.hits;
  if (!usingWorker || !hits || hits[0] !== cols) {
    hits = castColumnsMainThread(cols, fov);
    raycastState.hits = hits;
    raycastState.ready = true;
    raycastState.cols = cols;
  }

  ctx.save();
  for (let i = 0; i < cols; i++) {
    const ratio = cols === 1 ? 0 : i / (cols - 1) - 0.5;
    const angle = game.player.angle + ratio * fov;
    const packed = wallFromPacked(hits, i);
    if (!packed) continue;
    paintWallColumn(i, slice, horizon, h, angle, packed, flash);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  draw3DObjects();
  draw3DOverlay();
}
function project(x, y) {
  const dx = x - game.player.x,
    dy = y - game.player.y,
    dist = Math.hypot(dx, dy),
    a = wrapAngle(Math.atan2(dy, dx) - game.player.angle),
    fov = (fovDegrees * Math.PI) / 180,
    h = viewport.height;
  if (Math.abs(a) > fov * 0.62 || dist < 0.05) return null;
  const pitch = game.player.pitch || 0;
  const horizon = h * 0.5 + Math.sin(pitch) * h * 0.45;
  return {
    x: viewport.width / 2 + ((a / (fov / 2)) * viewport.width) / 2,
    y: horizon + h / (dist * 2.5),
    size: Math.min(400, h / (dist * 1.5)),
    dist,
  };
}
function draw3DObjects() {
  const objects = [];
  for (const c of game.crystals)
    if (!c.picked) objects.push({ ...c, type: "crystal" });
  for (const item of game.items)
    if (!item.picked)
      objects.push({ ...item, itemType: item.type, type: "item" });
  objects.push({ ...maze.end, type: "station" });
  const ghost = ghostPlayer();
  if (ghost) objects.push({ ...ghost, type: "ghost" });
  objects.sort(
    (a, b) =>
      Math.hypot(b.x - game.player.x, b.y - game.player.y) -
      Math.hypot(a.x - game.player.x, a.y - game.player.y),
  );
  for (const o of objects) {
    const p = project(o.x, o.y);
    if (!p) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    const color =
        o.type === "item"
          ? itemColor(o.itemType)
          : o.type === "ghost"
            ? "#ffbf69"
            : "#a9ef68",
      alpha = Math.max(0.3, 1 - p.dist / 15);
    ctx.globalAlpha = alpha;
    if (o.type === "ghost") {
      const s = p.size * 0.18;
      // Check if a wall occludes the ghost from the player's view
      const ghostDx = o.x - game.player.x;
      const ghostDy = o.y - game.player.y;
      const ghostDist = Math.hypot(ghostDx, ghostDy);
      const hit = castGridRay(
        maze,
        game.player.x,
        game.player.y,
        ghostDx / ghostDist,
        ghostDy / ghostDist,
        ghostDist,
      );
      const wallOccludes = hit && Math.hypot(hit.x - game.player.x, hit.y - game.player.y) < ghostDist - 0.05;
      if (wallOccludes) {
        // Behind a wall → diamond ping icon
        ctx.fillStyle = color;
        ctx.shadowColor = "#ff7a59";
        ctx.shadowBlur = glow(20);
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.3);
        ctx.lineTo(s * 1.3, 0);
        ctx.lineTo(0, s * 1.3);
        ctx.lineTo(-s * 1.3, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#2a1010";
        ctx.fillRect(-s * 0.18, -s * 0.18, s * 0.36, s * 0.36);
        ctx.strokeStyle = "#ff7a59";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.6);
        ctx.lineTo(0, s * 0.6);
        ctx.moveTo(-s * 0.6, 0);
        ctx.lineTo(s * 0.6, 0);
        ctx.stroke();
      } else {
        // Visible → original robot body
        ctx.fillStyle = color;
        ctx.shadowColor = "#ff7a59";
        ctx.shadowBlur = glow(13);
        ctx.beginPath();
        ctx.roundRect(-s * 0.9, -s * 0.9, s * 1.8, s * 1.8, 5);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#2a1010";
        ctx.fillRect(s * 0.1, -s * 0.5, s * 0.5, s * 0.25);
        ctx.strokeStyle = "#ff7a59";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s * 0.3, 0);
        ctx.lineTo(s * 1.3, 0);
        ctx.stroke();
      }
    } else if (o.type === "station") {
      const bw = Math.max(12, p.size * 0.42),
        top = -viewport.height * 0.58,
        beam = ctx.createLinearGradient(0, top, 0, p.y);
      beam.addColorStop(0, "#a9ef6800");
      beam.addColorStop(0.5, "#a9ef6855");
      beam.addColorStop(1, "#dffff0c8");
      ctx.fillStyle = beam;
      ctx.shadowColor = color;
      ctx.shadowBlur = glow(26);
      ctx.fillRect(-bw / 2, top, bw, viewport.height * 0.64);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-bw / 2, top);
      ctx.lineTo(-bw / 2, p.size * 0.08);
      ctx.moveTo(bw / 2, top);
      ctx.lineTo(bw / 2, p.size * 0.08);
      ctx.stroke();
      const s = p.size * 0.3;
      ctx.rotate(game.time * 0.4);
      ctx.strokeStyle = "#dffff0";
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU - Math.PI / 2,
          x = (Math.cos(a) * s) / 2,
          y = (Math.sin(a) * s) / 2;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(-s * 0.13, -s * 0.13, s * 0.26, s * 0.26);
    } else {
      const s = p.size * (o.type === "item" ? 0.17 : 0.14);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = glow(18);
      ctx.rotate(game.time * 1.5);
      if (o.type === "item") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, s, 0, TAU);
        ctx.stroke();
        ctx.fillRect(-s * 0.35, -s * 0.35, s * 0.7, s * 0.7);
      } else ctx.fillRect(-s / 2, -s / 2, s, s);
    }
    ctx.restore();
  }
}
function drawWaterFront3D(rays, color, alpha) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow(14);
  for (let band = 0; band < 3; band++) {
    const lag = band * 0.12,
      points = [];
    for (const ray of rays) {
      const q = wavePoint(ray, lag),
        screen = project(q.x, q.y);
      if (screen) points.push(screen);
    }
    ctx.globalAlpha = alpha * (1 - band * 0.24);
    ctx.lineWidth = band ? 1 : 2.1;
    if (smoothCanvasPath(points, rays.length > 40)) ctx.stroke();
  }
  ctx.restore();
}
function draw3DPathHint() {
  if (
    game.pathFlashUntil <= game.time ||
    Math.floor((game.time - game.pathFlashStarted) / 0.4) % 2
  )
    return;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "#a9ef68";
  ctx.shadowColor = "#a9ef68";
  ctx.shadowBlur = glow(20);
  ctx.lineWidth = 4;
  for (let i = 1; i < game.pathHint.length; i++) {
    const a = project(game.pathHint[i - 1].x, game.pathHint[i - 1].y),
      b = project(game.pathHint[i].x, game.pathHint[i].y);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}
function draw3DOverlay() {
  const cx = viewport.width / 2,
    cy = viewport.height / 2;
  for (const p of game.pings)
    drawWaterFront3D(p.rays, TYPES[p.type].color, 0.74);
  for (const t of game.trails)
    drawWaterFront3D(
      t.rays,
      t.color,
      Math.min(1, (t.until - game.time) * 1.5) * 0.38,
    );
  draw3DPathHint();
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = "#5dddf1";
  ctx.shadowColor = "#5dddf1";
  ctx.shadowBlur = glow(8);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 19, cy);
  ctx.lineTo(cx - 6, cy);
  ctx.moveTo(cx + 6, cy);
  ctx.lineTo(cx + 19, cy);
  ctx.moveTo(cx, cy - 19);
  ctx.lineTo(cx, cy - 6);
  ctx.moveTo(cx, cy + 6);
  ctx.lineTo(cx, cy + 19);
  ctx.stroke();
  ctx.restore();
}
function loop(now) {
  const dt = Math.min(0.04, (now - last) / 1000);
  last = now;
  update(dt);
  // Only live play needs a full-rate simulation loop. Pause / menus / background
  // can tick slowly — draw() has its own schedule for rendering.
  if (document.hidden || game.state !== "play")
    setTimeout(() => requestAnimationFrame(loop), 1000 / 15);
  else requestAnimationFrame(loop);
}
draw();
requestAnimationFrame(loop);
function isInteractiveTarget(target) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, button, [contenteditable="true"]',
      ),
    )
  );
}
function setKey(e, value) {
  const code = e.key.toLowerCase();
  let k = null;
  if (code === "w" || e.key === "ArrowUp") k = "forward";
  else if (code === "s" || e.key === "ArrowDown") k = "back";
  else if (code === "a" || e.key === "ArrowLeft") k = "left";
  else if (code === "d" || e.key === "ArrowRight") k = "right";
  if (!k) return;
  if (value && (game.state !== "play" || game.launching || isInteractiveTarget(e.target))) return;
  inputSources.keyboard[k] = value;
  e.preventDefault();
}
document.addEventListener("keydown", (e) => {
  setKey(e, true);
  if (!e.repeat && game.state === "play" && !game.launching) {
    const code = e.key.toLowerCase();
    if (code === "q") shoot("red");
    if (code === "e") shoot("green");
    if (code === "f") shoot("blue");
    if (code === "r") resetMap();
    if (e.key === "Escape") pauseGame();
    if (e.key === " " && game.playback) {
      replayPaused = !replayPaused;
      updateReplayControls();
      e.preventDefault();
    }
  }
});
document.addEventListener("keyup", (e) => setKey(e, false));
function pauseGame() {
  if (game.state !== "play") return;
  // Leave play first so intentional unlocks (finish/title/pause) and the
  // browser's Escape unlock share one path: pointerlockchange only pauses
  // while state is still "play".
  game.state = "pause";
  document.exitPointerLock();
  canvas.style.cursor = "default";
  clearInput();
  resetMobilePointers();
  show("pause");
}
// Chromium exits pointer lock on Escape and often suppresses the keydown.
// Treat any unlock during live play as an intentional pause (ESC / Alt-Tab).
document.addEventListener("pointerlockchange", () => {
  if (!document.pointerLockElement && game.state === "play") pauseGame();
});
window.addEventListener("blur", pauseGame);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGame();
});
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());
canvas.addEventListener("click", () => {
  if (
    game.state === "play" &&
    viewMode === "3d" &&
    !game.playback &&
    !mobileControlsEnabled() &&
    canvas.requestPointerLock
  )
    canvas.requestPointerLock().catch(() => {});
});
document.addEventListener("mousemove", (e) => {
  if (
    game.state === "play" &&
    viewMode === "3d" &&
    document.pointerLockElement === canvas
  ) {
    game.player.angle = wrapAngle(
      game.player.angle + e.movementX * 0.003 * lookSensitivity,
    );
    game.player.pitch = Math.max(-0.4, Math.min(0.4,
      (game.player.pitch || 0) - e.movementY * 0.003 * lookSensitivity,
    ));
  }
});
let lookPointer = null,
  lastLookX = 0,
  lastLookY = 0;
canvas.addEventListener("pointerdown", (e) => {
  if (
    !mobileControlsEnabled() ||
    viewMode !== "3d" ||
    game.state !== "play" ||
    e.clientX < innerWidth * 0.38
  )
    return;
  if (lookPointer !== null) return;
  lookPointer = e.pointerId;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
  e.preventDefault();
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== lookPointer || viewMode !== "3d" || game.state !== "play")
    return;
  const dx = e.clientX - lastLookX;
  const dy = e.clientY - lastLookY;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
  game.player.angle = applyTouchLook(
    game.player.angle,
    dx,
    lookSensitivity,
  );
  game.player.pitch = Math.max(-0.4, Math.min(0.4,
    (game.player.pitch || 0) - dy * 0.005 * lookSensitivity,
  ));
  e.preventDefault();
});
function endTouchLook(e) {
  if (e.pointerId === lookPointer) lookPointer = null;
}
canvas.addEventListener("pointerup", endTouchLook);
canvas.addEventListener("pointercancel", endTouchLook);
canvas.addEventListener("lostpointercapture", endTouchLook);
function bindMobileInput(button) {
  const key = button.dataset.mobileInput,
    set = (value) => {
      inputSources.buttons[key] = value;
      button.classList.toggle("pressed", value);
    };
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    set(true);
    button.setPointerCapture?.(e.pointerId);
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(event, () => set(false));
}
document.querySelectorAll("[data-mobile-input]").forEach(bindMobileInput);
const joystick = document.querySelector(".mobile-joystick"),
  joystickKnob = document.querySelector(".joystick-knob");
let joystickPointer = null;
function resetJoystick(event = null) {
  if (event && event.pointerId !== joystickPointer) return;
  joystickPointer = null;
  for (const direction of Object.keys(inputSources.joystick))
    inputSources.joystick[direction] = false;
  if (joystickKnob) joystickKnob.style.transform = "translate(-50%,-50%)";
}
function resetMobilePointers() {
  lookPointer = null;
  lastLookX = 0;
  lastLookY = 0;
  resetJoystick();
}
function moveJoystick(e) {
  if (e.pointerId !== joystickPointer || !joystick) return;
  const state = joystickState(
    e.clientX,
    e.clientY,
    joystick.getBoundingClientRect(),
  );
  const { x, y } = state;
  inputSources.joystick.forward = state.forward;
  inputSources.joystick.back = state.back;
  inputSources.joystick.left = state.left;
  inputSources.joystick.right = state.right;
  if (joystickKnob)
    joystickKnob.style.transform = `translate(calc(-50% + ${x}px),calc(-50% + ${y}px))`;
  e.preventDefault();
}
if (joystick) {
  joystick.addEventListener("pointerdown", (e) => {
    if (!mobileControlsEnabled() || viewMode !== "3d" || game.state !== "play")
      return;
    if (joystickPointer !== null) return;
    joystickPointer = e.pointerId;
    joystick.setPointerCapture?.(e.pointerId);
    moveJoystick(e);
    e.preventDefault();
  });
  joystick.addEventListener("pointermove", moveJoystick);
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    joystick.addEventListener(event, resetJoystick);
}
document.querySelectorAll("[data-mobile-wave]").forEach((button) =>
  button.addEventListener("pointerdown", (e) => {
    if (!mobileControlsEnabled()) return;
    e.preventDefault();
    shoot(button.dataset.mobileWave);
  }),
);
// Fullscreen toggle for mobile
(function () {
  const btn = document.getElementById("mobile-fullscreen-btn");
  if (!btn) return;
  function updateFsLabel() {
    btn.textContent = document.fullscreenElement ? "⊡" : "⛶";
    btn.setAttribute(
      "aria-label",
      document.fullscreenElement ? "退出全屏" : "进入全屏",
    );
  }
  btn.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    }
  });
  document.addEventListener("fullscreenchange", updateFsLabel);
  updateFsLabel();
})();
// Mobile reset button
(function () {
  const resetBtn = document.getElementById("mobile-reset-btn");
  if (resetBtn) resetBtn.addEventListener("click", resetMap);
})();
syncMobileControlsTest();
document.getElementById("mobile-controls-test").onclick = () => {
  mobileControlsTest = !mobileControlsTest;
  storage.setItem("blindspot-mobile-controls-test", mobileControlsTest);
  syncMobileControlsTest();
};
document
  .querySelectorAll("[data-replay-seek]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      seekReplay(Number(button.dataset.replaySeek)),
    ),
  );
ui.replayPlay.addEventListener("click", () => {
  if (!game.playback) return;
  replayPaused = !replayPaused;
  updateReplayControls();
});
document.querySelectorAll("[data-replay-speed]").forEach((button) =>
  button.addEventListener("click", () => {
    if (!game.playback) return;
    replaySpeed = Number(button.dataset.replaySpeed);
    button.closest("details")?.removeAttribute("open");
    updateReplayControls();
  }),
);
async function exportReplay(id) {
  const replay = (await getReplayList()).find((entry) => entry.id === id);
  if (!replay) throw new Error("Replay not found");
  ui.replayImportStatus.textContent = "正在上传加密回放到 pastes.dev…";
  try {
    const { url } = await exportReplayShareLink(replay);
    ui.replayImport.value = url;
    try {
      await navigator.clipboard?.writeText(url);
      ui.replayImportStatus.textContent = `已上传并复制分享链接：${url}`;
    } catch (_) {
      ui.replayImportStatus.textContent = `已上传分享链接，请手动复制：${url}`;
    }
  } catch (error) {
    // Network / CORS / paste downtime: fall back to the local BSP1 string.
    try {
      const shareCode = await exportReplayShare(replay);
      ui.replayImport.value = shareCode;
      try {
        await navigator.clipboard?.writeText(shareCode);
        ui.replayImportStatus.textContent =
          "粘贴服务不可用，已导出并复制加密回放字符串（本地回退）。";
      } catch (_) {
        ui.replayImportStatus.textContent =
          "粘贴服务不可用，已生成加密回放字符串，请手动复制。";
      }
    } catch (_) {
      ui.replayImportStatus.textContent =
        error?.message?.includes("upload") || error?.message?.includes("Network")
          ? "导出失败：无法上传到 pastes.dev，且本地加密也失败。"
          : "无法导出该回放。";
      throw error;
    }
  }
}
async function importReplay() {
  const input = ui.replayImport.value;
  const looksLikeLink =
    /pastes\.dev|paste\.lucko\.me/i.test(input) ||
    (/^[A-Za-z0-9]{4,32}$/.test(String(input).trim()) &&
      !String(input).trim().startsWith("BSP1."));
  ui.replayImportStatus.textContent = looksLikeLink
    ? "正在从 pastes.dev 拉取加密回放…"
    : "正在验证加密回放…";
  try {
    const replay = await importReplayShareInput(input);
    await saveReplay(replay);
    invalidateReplayListCache();
    ui.replayImport.value = "";
    ui.replayImportStatus.textContent =
      "导入成功：可在下方观看或与该玩家 PK。";
    renderReplayList(await getReplayList(true));
  } catch (error) {
    const message = String(error?.message || "");
    if (/paste|download|upload|Network|fetch|Only paste/i.test(message)) {
      ui.replayImportStatus.textContent =
        "导入失败：无法从链接获取内容，或链接不是 pastes.dev。";
    } else {
      ui.replayImportStatus.textContent =
        "导入失败：字符串已损坏、被篡改、版本不兼容，或链接内容无效。";
    }
  }
}
ui.replayImportButton.addEventListener("click", importReplay);
let pendingReplayDeletion = null;
function closeDeleteConfirmation() {
  pendingReplayDeletion = null;
  show("replays");
}
ui.deleteConfirmCancel.addEventListener("click", closeDeleteConfirmation);
ui.deleteConfirmAccept.addEventListener("click", () => {
  if (!pendingReplayDeletion) return closeDeleteConfirmation();
  const id = pendingReplayDeletion;
  pendingReplayDeletion = null;
  deleteReplay(id)
    .then(() => {
      invalidateReplayListCache();
      return getReplayList(true);
    })
    .then((replays) => {
      renderReplayList(replays);
      show("replays");
    })
    .catch(() => openReplays());
});
ui.replayList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-replay-action]");
  if (!button) return;
  const action = button.dataset.replayAction;
  if (action === "export")
    exportReplay(button.dataset.replayId).catch(() => {
      ui.replayImportStatus.textContent = "无法导出该回放。";
    });
  else if (action === "delete") {
    pendingReplayDeletion = button.dataset.replayId;
    show("deleteConfirm");
  } else
    startSavedReplay(button.dataset.replayId, action === "challenge").catch(
      () => openReplays(),
    );
});
document.querySelectorAll("[data-action]").forEach(
  (b) =>
    (b.onclick = () => {
      const a = b.dataset.action;
      if (a === "start") start();
      else if (a === "restart") resetMap();
      else if (a === "settings") openSettings();
      else if (a === "replays") openReplays();
      else if (a === "display") {
        displayReturn = game.state === "pause" ? "pause" : "title";
        renderViewModeOption(viewMode);
        show("display");
      } else if (a === "display-back") {
        show(displayReturn);
      } else if (a === "settings-back") {
        if (settingsReturn === "pause") {
          game.state = "pause";
          show("pause");
        } else {
          clearInput();
          resetMobilePointers();
          game.state = "title";
          show("title");
        }
      } else if (a === "title") {
        // Leave play/pause before unlocking so pointerlockchange does not pause.
        const fromPause = activeScreen === "pause";
        const fromResult = activeScreen === "result";
        game.state = "title";
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        canvas.style.cursor = "default";
        clearInput();
        resetMobilePointers();
        if ((fromPause || fromResult) && !prefersReducedMotion()) {
          playReturnMask(() => show("title"));
        } else {
          show("title");
        }
      } else if (a === "how") {
        game.state = "help";
        show("help");
      } else if (a === "about") {
        game.state = "about";
        show("about");
      } else if (a === "pause") {
        pauseGame();
      } else if (a === "resume") {
        game.state = "play";
        canvas.style.cursor = "";
        show("hud");
        if (
          viewMode === "3d" &&
          !game.playback &&
          !mobileControlsEnabled() &&
          canvas.requestPointerLock
        )
          canvas.requestPointerLock().catch(() => {});
      }
    }),
);
ui.randomSeed.onclick = () => {
  if (randomSeedLongPressed) {
    randomSeedLongPressed = false;
    return;
  }
  ui.seedInput.value = randomSeed();
  ui.seedPreview.textContent = ui.seedInput.value;
};
ui.randomSeed.addEventListener("pointerdown", (event) => {
  if (event.button != null && event.button !== 0) return;
  randomSeedHoldTimer = setTimeout(() => {
    randomSeedHoldTimer = null;
    randomSeedLongPressed = true;
    randomSeedHoldCount += 1;
    if (randomSeedHoldCount === 7) {
      seedRestrictionsDisabled = true;
      ui.seedInput.removeAttribute("maxlength");
      ui.seedPreview.textContent = "种子限制已解除";
    } else if (randomSeedHoldCount === 8) {
      seedRestrictionsDisabled = false;
      randomSeedHoldCount = 0;
      ui.seedInput.maxLength = 16;
      ui.seedInput.value = sanitizeSeed(ui.seedInput.value);
      ui.seedPreview.textContent = "种子限制已恢复";
    }
  }, 650);
});
for (const type of ["pointerup", "pointercancel", "pointerleave"])
  ui.randomSeed.addEventListener(type, () => {
    if (randomSeedHoldTimer) clearTimeout(randomSeedHoldTimer);
    randomSeedHoldTimer = null;
  });
ui.seedInput.oninput = () => {
  const cleaned = sanitizeSeed(ui.seedInput.value);
  if (ui.seedInput.value !== cleaned) ui.seedInput.value = cleaned;
  ui.seedPreview.textContent = cleaned || "随机生成";
};
document.querySelectorAll("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      settingsViewMode = b.dataset.view;
      renderViewModeOption(settingsViewMode);
      ui.viewMode.removeAttribute("open");
    }),
);
setViewMode(viewMode);
function setSensitivity(value) {
  const n = Math.max(20, Math.min(200, Number(value) || 100));
  lookSensitivity = n / 100;
  ui.sensitivityValue.textContent = `${n}%`;
  storage.setItem("blindspot-sensitivity", n);
}
function setFov(value) {
  const n = Math.max(60, Math.min(110, Number(value) || DEFAULT_FOV_DEGREES));
  fovDegrees = n;
  ui.fovValue.textContent = `${n}°`;
  storage.setItem("blindspot-fov", n);
}
function setCrt(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  crtAmount = n / 100;
  document.documentElement.style.setProperty("--crt", crtAmount.toFixed(2));
  ui.crtValue.textContent = `${n}%`;
  storage.setItem("blindspot-crt", n);
}
function setGlow(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0)),
    scale = n / 100,
    boost = 1 + scale * 1.8;
  glowAmount = scale;
  const root = document.documentElement.style;
  root.setProperty("--glow", (scale * boost).toFixed(2));
  root.setProperty("--glow-10", `${10 * scale * boost}px`);
  root.setProperty("--glow-12", `${12 * scale * boost}px`);
  root.setProperty("--glow-14", `${14 * scale * boost}px`);
  // UI text glow (menus / HUD labels) tracks the same slider as canvas glow.
  root.setProperty("--text-glow", `${(scale * boost * 7).toFixed(2)}px`);
  root.setProperty(
    "--text-glow-color",
    `rgba(93, 221, 241, ${(scale * 0.32).toFixed(3)})`,
  );
  ui.glowValue.textContent = `${n}%`;
  storage.setItem("blindspot-glow", n);
}
function setMusicVolume(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  musicVolume = n / 100;
  ui.musicVolumeValue.textContent = `${n}%`;
  storage.setItem("blindspot-music-volume", n);
  music.refreshVolume();
}
function setSfxVolume(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  sfxVolume = n / 100;
  ui.sfxVolumeValue.textContent = `${n}%`;
  storage.setItem("blindspot-sfx-volume", n);
}
function syncAdaptiveMobileUiScale() {
  if (!document.body.classList.contains("adaptive-mobile-ui")) return;
  const scale = Math.max(0.82, Math.min(1.16, Math.min(innerWidth / 844, innerHeight / 390)));
  document.documentElement.style.setProperty("--adaptive-mobile-ui-scale", scale.toFixed(3));
}
function setAdaptiveMobileUi(enabled) {
  document.body.classList.toggle("adaptive-mobile-ui", enabled);
  ui.adaptiveMobileUi.checked = enabled;
  if (enabled) syncAdaptiveMobileUiScale();
  else document.documentElement.style.removeProperty("--adaptive-mobile-ui-scale");
  storage.setItem("blindspot-adaptive-mobile-ui", enabled);
}
let layoutEditMode = "2d", layoutEditing = false, selectedLayoutId = null, layoutPointer = null;
function layoutStorageKey(mode = viewMode) { return `blindspot-hud-layout-${mode}`; }
function setLayoutPreviewMode(mode) {
  layoutEditMode = mode;
  // Preview only changes HUD visibility/layout. It must never mutate the active run's mode.
  if (layoutEditing) document.body.dataset.viewMode = mode;
  document.querySelectorAll("[data-layout-mode]").forEach((item) =>
    item.classList.toggle("active", item.dataset.layoutMode === mode),
  );
  applyLayout(mode);
}
function loadLayout(mode = viewMode) {
  try { return JSON.parse(storage.getItem(layoutStorageKey(mode)) || "{}"); } catch (_) { return {}; }
}
function applyLayout(mode = viewMode) {
  const layout = loadLayout(mode);
  for (const id of LAYOUT_IDS) {
    const el = document.querySelector(`[data-layout-id="${id}"]`);
    if (!el) continue;
    const item = layout[id] || {};
    el.style.translate = item.x || item.y ? `${item.x || 0}px ${item.y || 0}px` : "";
    el.style.scale = item.scale || "";
  }
}
function saveLayoutItem(id, patch) {
  const layout = loadLayout(layoutEditMode);
  layout[id] = { ...(layout[id] || {}), ...patch };
  storage.setItem(layoutStorageKey(layoutEditMode), JSON.stringify(layout));
  applyLayout(layoutEditMode);
}
function setCustomLayoutEnabled(enabled) {
  ui.customLayoutEnabled.checked = enabled;
  ui.customLayoutTools.classList.toggle("hidden", !enabled);
  storage.setItem("blindspot-custom-layout-enabled", enabled);
}
function setForceLandscape(enabled, fromGesture = false) {
  ui.forceLandscape.checked = enabled;
  storage.setItem("blindspot-force-landscape", enabled);
  if (enabled && fromGesture) requestMobileLandscape(true);
}
function openLayoutEditor() {
  if (!ui.customLayoutEnabled.checked) return;
  const selectedMode = document.querySelector("[data-layout-mode].active")?.dataset.layoutMode;
  layoutEditMode = selectedMode || viewMode;
  // The editor is a static HUD preview: never build or start a maze here.
  if (game.state === "play") return;
  snapShow("hud");
  // The preview is intentionally inert: moving a layout item cannot fire HUD actions.
  clearInput();
  layoutEditing = true;
  selectedLayoutId = null;
  document.body.classList.add("layout-editing");
  ui.layoutEditor.classList.remove("hidden");
  ui.layoutEditorTitle.textContent = `编辑 ${layoutEditMode.toUpperCase()} HUD`;
  ui.layoutSelectedLabel.textContent = "点击元素后拖动；下方滑块调整大小";
  setLayoutPreviewMode(layoutEditMode);
}
function closeLayoutEditor() {
  layoutEditing = false;
  layoutPointer = null;
  document.body.classList.remove("layout-editing");
  // Restore the actual game mode after an in-pause editor preview.
  document.body.dataset.viewMode = viewMode;
  ui.layoutEditor.classList.add("hidden");
  show("display");
}
function resetLayout() {
  storage.removeItem(layoutStorageKey(layoutEditMode));
  selectedLayoutId = null;
  applyLayout(layoutEditMode);
  ui.layoutSelectedLabel.textContent = "已重置此模式布局";
}
function beginLayoutDrag(event) {
  if (!layoutEditing || !mobileControlsEnabled()) return;
  const el = event.target.closest("[data-layout-id]");
  if (!el || el.closest("#layout-editor") || !LAYOUT_IDS.includes(el.dataset.layoutId)) return;
  event.preventDefault();
  event.stopPropagation();
  selectedLayoutId = el.dataset.layoutId;
  const item = loadLayout(layoutEditMode)[selectedLayoutId] || {};
  layoutPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: item.x || 0, oy: item.y || 0 };
  ui.layoutSelectedLabel.textContent = `已选择：${selectedLayoutId}`;
  ui.layoutSize.value = Math.round((item.scale || 1) * 100);
  ui.layoutSizeValue.textContent = `${ui.layoutSize.value}%`;
}
function moveLayoutDrag(event) {
  if (!layoutPointer || event.pointerId !== layoutPointer.id) return;
  saveLayoutItem(selectedLayoutId, { x: Math.round(layoutPointer.ox + event.clientX - layoutPointer.x), y: Math.round(layoutPointer.oy + event.clientY - layoutPointer.y) });
}
function endLayoutDrag(event) { if (!event || event.pointerId === layoutPointer?.id) layoutPointer = null; }
const savedCrt = storage.getItem("blindspot-crt"),
  savedGlow = storage.getItem("blindspot-glow"),
  savedSensitivity = storage.getItem("blindspot-sensitivity"),
  savedFov = storage.getItem("blindspot-fov"),
  savedMusicVolume = storage.getItem("blindspot-music-volume"),
  savedSfxVolume = storage.getItem("blindspot-sfx-volume"),
  savedAdaptiveMobileUi = storage.getItem("blindspot-adaptive-mobile-ui"),
  savedForceLandscape = storage.getItem("blindspot-force-landscape"),
  savedCustomLayoutEnabled = storage.getItem("blindspot-custom-layout-enabled");
if (savedCrt !== null) ui.crt.value = savedCrt;
if (savedGlow !== null) ui.glow.value = savedGlow;
if (savedSensitivity !== null) ui.sensitivity.value = savedSensitivity;
if (savedFov !== null) ui.fov.value = savedFov;
if (savedMusicVolume !== null) ui.musicVolume.value = savedMusicVolume;
if (savedSfxVolume !== null) ui.sfxVolume.value = savedSfxVolume;
setSensitivity(ui.sensitivity.value);
setFov(ui.fov.value);
setCrt(ui.crt.value);
setGlow(ui.glow.value);
setMusicVolume(ui.musicVolume.value);
setSfxVolume(ui.sfxVolume.value);
setAdaptiveMobileUi(savedAdaptiveMobileUi === "true");
setForceLandscape(savedForceLandscape === "true");
setCustomLayoutEnabled(savedCustomLayoutEnabled === "true");
applyLayout(viewMode);
ui.sensitivity.oninput = () => setSensitivity(ui.sensitivity.value);
ui.fov.oninput = () => setFov(ui.fov.value);
ui.crt.oninput = () => setCrt(ui.crt.value);
ui.glow.oninput = () => setGlow(ui.glow.value);
ui.musicVolume.oninput = () => setMusicVolume(ui.musicVolume.value);
ui.sfxVolume.oninput = () => setSfxVolume(ui.sfxVolume.value);
ui.adaptiveMobileUi.onchange = () => setAdaptiveMobileUi(ui.adaptiveMobileUi.checked);
ui.forceLandscape.onchange = () => setForceLandscape(ui.forceLandscape.checked, true);
ui.customLayoutEnabled.onchange = () => setCustomLayoutEnabled(ui.customLayoutEnabled.checked);
document.querySelectorAll("[data-layout-mode]").forEach((button) => button.onclick = () => {
  setLayoutPreviewMode(button.dataset.layoutMode);
});
ui.openLayoutEditor.onclick = openLayoutEditor;
ui.layoutEditorDone.onclick = closeLayoutEditor;
ui.layoutEditorReset.onclick = resetLayout;
ui.layoutSize.oninput = () => {
  if (!selectedLayoutId) return;
  const value = Number(ui.layoutSize.value);
  ui.layoutSizeValue.textContent = `${value}%`;
  saveLayoutItem(selectedLayoutId, { scale: value / 100 });
};
document.addEventListener("pointerdown", beginLayoutDrag, true);
document.addEventListener("pointermove", moveLayoutDrag, true);
document.addEventListener("pointerup", endLayoutDrag, true);
document.addEventListener("pointercancel", endLayoutDrag, true);
window.addEventListener("resize", () => { syncAdaptiveMobileUiScale(); applyLayout(viewMode); });
document.getElementById("restart-btn").onclick = resetMap;
document.getElementById("pause-btn").onclick = pauseGame;
// Keep panel headings fixed outside of their scroll viewport. This gives the
// terminal rail one stable, untransformed element to measure on every screen.
function prepareScrollablePanels() {
  // Put every menu return control in its card header so mobile can lock it to
  // the actual panel's top-right corner rather than the viewport edge.
  document.querySelectorAll(".screen").forEach((screen) => {
    const card = screen.querySelector(":scope > .settings-card");
    const back = screen.querySelector(":scope > .back");
    if (card && back) card.prepend(back);
  });
  document.querySelectorAll(".settings-card:not(.replay-card)").forEach((card) => {
    if (card.querySelector(":scope > .panel-scroll-content")) return;
    const content = document.createElement("div");
    content.className = "panel-scroll-content";
    for (const child of [...card.children]) {
      if (!child.matches("em, h2, .back")) content.append(child);
    }
    card.append(content);
  });
}
prepareScrollablePanels();
// Industrial scroll rails (desktop + mobile) — native overlay bars ignore CSS.
const terminalScrolls = attachTerminalScrollAll(
  ".replay-list, .panel-scroll-content",
);
// Prefetch encrypted replays after first paint so "回放与 PK" opens without a stall.
setTimeout(() => {
  getReplayList().catch(() => {});
}, 800);
// Desired track is title by default; actual playback starts on first user gesture.
