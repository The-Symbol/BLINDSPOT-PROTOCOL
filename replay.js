import { buildMaze, collidesWithMaze, hashSeed } from "./core.js";
import { createSafeStorage } from "./storage.js";

const STORAGE_INDEX = "blindspot-replay-index-v1";
const STORAGE_PREFIX = "blindspot-replay-v1:";
const SHARE_PREFIX = "BSP1.";
export const MAX_REPLAYS = 100;
const SAMPLE_INTERVAL = 0.05;
const KEY_MATERIAL = "BLINDSPOT_PROTOCOL_LOCAL_REPLAY_V1::03";
const PLAYER_RADIUS = 0.2;
/** Soft radius for route probes — samples are rounded to 4dp and wall-slide
 *  positions often sit flush on the collision boundary (distance ≈ r). Full
 *  radius endpoint checks then false-positive "crosses a wall" after rounding. */
const ROUTE_RADIUS = PLAYER_RADIUS * 0.86;
const MAX_SPEED = { "2d": 2.75, "3d": 2.6 };
const POSITION_EPSILON = 0.06;
const START_EPSILON = 0.08;
let replayWriteQueue = Promise.resolve();

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function createReplayRecorder(
  seed,
  mode,
  chainIdOrCreatedAt = null,
  createdAt = Date.now(),
) {
  const isLegacy = typeof chainIdOrCreatedAt === "number";
  const chainId = isLegacy ? null : chainIdOrCreatedAt;
  if (isLegacy) createdAt = chainIdOrCreatedAt;
  const id = `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    version: 1,
    id,
    chainId: chainId || id,
    seed,
    mode,
    createdAt,
    duration: 0,
    success: false,
    rank: "—",
    samples: [],
    events: [],
  };
}

export function recordReplaySample(replay, time, player, energy, force = false) {
  const last = replay.samples.at(-1);
  if (!force && last && time - last.t < SAMPLE_INTERVAL) return false;
  replay.samples.push({
    t: round(time, 3),
    x: round(player.x),
    y: round(player.y),
    a: round(player.angle),
    e: round(energy, 2),
  });
  return true;
}

export function recordReplaySonar(replay, time, type, player) {
  replay.events.push({
    t: round(time, 3),
    type,
    x: round(player.x),
    y: round(player.y),
    a: round(player.angle),
  });
}

export function finishReplayRecord(replay, duration, success, rank) {
  // Keep duration locked to the last sample so validation does not reject
  // records whose final forced sample was rounded differently from scoreTime.
  const lastSampleTime = replay.samples?.at(-1)?.t;
  const resolved =
    lastSampleTime === undefined
      ? duration
      : Math.max(Number(duration) || 0, lastSampleTime);
  replay.duration = round(resolved, 3);
  if (lastSampleTime !== undefined && lastSampleTime < replay.duration) {
    const last = replay.samples.at(-1);
    replay.samples.push({
      t: replay.duration,
      x: last.x,
      y: last.y,
      a: last.a,
      e: last.e,
    });
  }
  replay.success = Boolean(success);
  replay.rank = rank;
  return replay;
}

function interpolateAngle(a, b, amount) {
  let delta = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * amount;
}

export function replayDuration(replay) {
  return Math.max(0, Number(replay?.duration) || replay?.samples?.at(-1)?.t || 0);
}

export function clampReplayTime(replay, time) {
  return Math.max(0, Math.min(replayDuration(replay), Number(time) || 0));
}

export function replayEventCursor(replay, time) {
  const events = replay?.events || [];
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].t <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function sampleReplay(replay, time) {
  const samples = replay?.samples;
  if (!samples?.length) return null;
  if (time <= samples[0].t) return { ...samples[0] };
  if (time >= samples.at(-1).t) return { ...samples.at(-1) };
  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].t <= time) low = middle;
    else high = middle;
  }
  const from = samples[low];
  const to = samples[high];
  const span = Math.max(0.0001, to.t - from.t);
  const amount = Math.max(0, Math.min(1, (time - from.t) / span));
  return {
    t: time,
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    a: interpolateAngle(from.a, to.a, amount),
    e: from.e + (to.e - from.e) * amount,
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function base64UrlEncode(text) {
  return bytesToBase64(new TextEncoder().encode(text)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Malformed share code");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder().decode(base64ToBytes(padded));
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validates the encrypted payload's structural shape before it is trusted. */
export function validateReplay(replay) {
  if (
    !replay || replay.version !== 1 || typeof replay.id !== "string" || !replay.id.length || replay.id.length > 100 ||
    (replay.chainId !== undefined && (typeof replay.chainId !== "string" || !replay.chainId.length || replay.chainId.length > 100)) ||
    typeof replay.seed !== "string" || !replay.seed.length || replay.seed.length > 32 || !["2d", "3d"].includes(replay.mode) ||
    !isFiniteNumber(replay.createdAt) || !isFiniteNumber(replay.duration) || replay.duration < 0 || replay.duration > 200.1 ||
    typeof replay.success !== "boolean" || typeof replay.rank !== "string" || !Array.isArray(replay.samples) || !Array.isArray(replay.events) ||
    replay.samples.length < 1 || replay.samples.length > 5000 || replay.events.length > 500
  ) throw new Error("Invalid replay data");

  let previousTime = -1;
  for (const sample of replay.samples) {
    if (!sample || ![sample.t, sample.x, sample.y, sample.a, sample.e].every(isFiniteNumber) || sample.t < previousTime || sample.t < 0 || sample.t > replay.duration + 0.001 || sample.x < 0 || sample.x > 19 || sample.y < 0 || sample.y > 13 || sample.e < 0 || sample.e > 100) throw new Error("Invalid replay samples");
    previousTime = sample.t;
  }
  previousTime = -1;
  for (const event of replay.events) {
    if (!event || ![event.t, event.x, event.y, event.a].every(isFiniteNumber) || !["red", "green", "blue"].includes(event.type) || event.t < previousTime || event.t < 0 || event.t > replay.duration + 0.001) throw new Error("Invalid replay events");
    previousTime = event.t;
  }
  return replay;
}

function pathClear(maze, x1, y1, x2, y2, radius = PLAYER_RADIUS) {
  const distance = Math.hypot(x2 - x1, y2 - y1);
  if (distance < 1e-9) return !collidesWithMaze(maze, x1, y1, radius);
  const steps = Math.max(1, Math.ceil(distance / 0.03));
  for (let index = 0; index <= steps; index++) {
    const amount = index / steps;
    const x = x1 + (x2 - x1) * amount;
    const y = y1 + (y2 - y1) * amount;
    if (collidesWithMaze(maze, x, y, radius)) return false;
  }
  return true;
}

/**
 * Movement can wall-slide (axis-separated fallbacks). A straight chord between
 * two legal samples often clips a corner and is not proof of cheating.
 * Accept the direct path, either L-shaped path, or a 2-step zigzag that can
 * appear when several slide frames are collapsed into one sample interval.
 */
function segmentReachable(maze, from, to, mode) {
  const duration = to.t - from.t;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const maximum = MAX_SPEED[mode] * duration + POSITION_EPSILON;
  if (distance > maximum) throw new Error("Replay moves too fast");
  // Soft endpoints: rounded samples can sit exactly on the collision shell.
  if (collidesWithMaze(maze, from.x, from.y, ROUTE_RADIUS))
    throw new Error("Replay crosses a wall");
  if (collidesWithMaze(maze, to.x, to.y, ROUTE_RADIUS))
    throw new Error("Replay crosses a wall");
  const probe = ROUTE_RADIUS;
  if (pathClear(maze, from.x, from.y, to.x, to.y, probe)) return;
  if (
    pathClear(maze, from.x, from.y, to.x, from.y, probe) &&
    pathClear(maze, to.x, from.y, to.x, to.y, probe)
  )
    return;
  if (
    pathClear(maze, from.x, from.y, from.x, to.y, probe) &&
    pathClear(maze, from.x, to.y, to.x, to.y, probe)
  )
    return;
  // Zigzag (two L-steps) covering multi-frame corner slides within one interval.
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const mids = [
    { x: midX, y: from.y },
    { x: from.x, y: midY },
    { x: midX, y: to.y },
    { x: to.x, y: midY },
    { x: midX, y: midY },
  ];
  for (const mid of mids) {
    if (collidesWithMaze(maze, mid.x, mid.y, probe)) continue;
    if (
      pathClear(maze, from.x, from.y, mid.x, mid.y, probe) &&
      pathClear(maze, mid.x, mid.y, to.x, to.y, probe)
    )
      return;
  }
  throw new Error("Replay crosses a wall");
}

/**
 * Verifies that a replay can occur in the seeded maze. This is intentionally
 * separate from format validation so imported and locally persisted records
 * both go through the same anti-corruption/anti-cheat gate.
 */
export function validateReplayRoute(replay) {
  validateReplay(replay);
  const maze = buildMaze(hashSeed(replay.seed));
  const first = replay.samples[0];
  if (first.t > 0.1 || Math.hypot(first.x - 0.5, first.y - 0.5) > START_EPSILON) throw new Error("Replay does not start at spawn");
  if (collidesWithMaze(maze, first.x, first.y, ROUTE_RADIUS)) throw new Error("Replay starts inside a wall");
  for (let index = 1; index < replay.samples.length; index++)
    segmentReachable(maze, replay.samples[index - 1], replay.samples[index], replay.mode);
  const finalSample = replay.samples.at(-1);
  if (Math.abs(finalSample.t - replay.duration) > 0.06) throw new Error("Replay duration does not match its route");
  const reachedEnd = Math.hypot(finalSample.x - maze.end.x, finalSample.y - maze.end.y) < 0.38;
  if (replay.success !== reachedEnd) throw new Error("Replay result does not match its route");
  return replay;
}

function hasSubtleCrypto() {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto.getRandomValues);
}

async function replayKey() {
  const material = new TextEncoder().encode(KEY_MATERIAL);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptReplay(replay) {
  validateReplayRoute(replay);
  if (!hasSubtleCrypto()) {
    // file:// / restricted contexts: still persist with a lightweight envelope.
    return JSON.stringify({
      version: 1,
      plain: true,
      data: bytesToBase64(new TextEncoder().encode(JSON.stringify(replay))),
    });
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(replay));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await replayKey(), plaintext);
  return JSON.stringify({ version: 1, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ciphertext)) });
}
export async function decryptReplay(payload) {
  const envelope = JSON.parse(payload);
  if (envelope.version !== 1) throw new Error("Unsupported replay version");
  if (envelope.plain) {
    const json = new TextDecoder().decode(base64ToBytes(envelope.data));
    return validateReplayRoute(JSON.parse(json));
  }
  if (!hasSubtleCrypto()) throw new Error("Secure crypto is unavailable");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv) }, await replayKey(), base64ToBytes(envelope.data));
  return validateReplayRoute(JSON.parse(new TextDecoder().decode(plaintext)));
}
export async function exportReplayShare(replay) {
  return SHARE_PREFIX + base64UrlEncode(await encryptReplay(replay));
}
export async function importReplayShare(shareCode) {
  const value = String(shareCode).trim();
  if (!value.startsWith(SHARE_PREFIX)) throw new Error("Unsupported share code");
  return decryptReplay(base64UrlDecode(value.slice(SHARE_PREFIX.length)));
}

function safeStorage(storage) {
  return storage && typeof storage.getItem === "function" ? createSafeStorage(storage) : createSafeStorage();
}
function readIndex(storage) {
  try {
    const ids = JSON.parse(storage.getItem(STORAGE_INDEX) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch (_) {
    return [];
  }
}
function queueReplayOperation(operation) {
  const run = replayWriteQueue.then(operation, operation);
  replayWriteQueue = run.catch(() => {});
  return run;
}
export async function waitForReplayStorage() {
  await replayWriteQueue;
}
export function saveReplay(replay, storage = null) {
  const target = safeStorage(storage);
  return queueReplayOperation(async () => {
    validateReplayRoute(replay);
    const payload = await encryptReplay(replay);
    const ids = readIndex(target).filter((id) => id !== replay.id);
    if (!target.setItem(`${STORAGE_PREFIX}${replay.id}`, payload)) throw new Error("Replay storage is unavailable");
    ids.unshift(replay.id);
    for (const staleId of ids.slice(MAX_REPLAYS)) target.removeItem(`${STORAGE_PREFIX}${staleId}`);
    if (!target.setItem(STORAGE_INDEX, JSON.stringify(ids.slice(0, MAX_REPLAYS)))) throw new Error("Replay storage is unavailable");
    return replay;
  });
}
export async function loadReplays(storage = null) {
  await waitForReplayStorage();
  const target = safeStorage(storage);
  const ids = readIndex(target);
  const replays = [];
  const validIds = [];
  for (const id of ids) {
    const payload = target.getItem(`${STORAGE_PREFIX}${id}`);
    if (!payload) continue;
    try {
      const replay = await decryptReplay(payload);
      if (replay.id === id) {
        replays.push(replay);
        validIds.push(id);
      }
    } catch (_) {
      // Ignore corrupt, incompatible, or physically impossible local records.
    }
  }
  if (validIds.length !== ids.length) target.setItem(STORAGE_INDEX, JSON.stringify(validIds));
  return replays;
}
export function deleteReplay(id, storage = null) {
  const target = safeStorage(storage);
  return queueReplayOperation(async () => {
    const ids = readIndex(target).filter((storedId) => storedId !== id);
    target.removeItem(`${STORAGE_PREFIX}${id}`);
    if (!target.setItem(STORAGE_INDEX, JSON.stringify(ids))) throw new Error("Replay storage is unavailable");
  });
}
