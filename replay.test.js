import assert from "node:assert/strict";
import test from "node:test";
import {
  clampReplayTime,
  createReplayRecorder,
  exportReplayShare,
  exportReplayShareLink,
  finishReplayRecord,
  importReplayShare,
  importReplayShareInput,
  parseReplayImportInput,
  pasteUrlForKey,
  recordReplaySample,
  recordReplaySonar,
  replayEventCursor,
  replayDuration,
  sampleReplay,
  saveReplay,
  loadReplays,
  uploadReplayShare,
  validateReplayRoute,
} from "./replay.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function stationaryReplay(seed, createdAt) {
  const replay = createReplayRecorder(seed, "2d", null, createdAt);
  recordReplaySample(replay, 0, { x: 0.5, y: 0.5, angle: 0 }, 100);
  recordReplaySample(replay, 1, { x: 0.5, y: 0.5, angle: 0 }, 100);
  return finishReplayRecord(replay, 1, false, "D");
}

test("replay samples are rate-limited and interpolate position and heading", () => {
  const replay = createReplayRecorder("ALPHA", "2d", 1);
  assert.equal(
    recordReplaySample(replay, 0, { x: 0.5, y: 0.5, angle: 0 }, 100),
    true,
  );
  assert.equal(
    recordReplaySample(replay, 0.02, { x: 0.6, y: 0.5, angle: 0 }, 99),
    false,
  );
  recordReplaySample(replay, 0.1, { x: 1.5, y: 0.5, angle: Math.PI / 2 }, 90);

  const sample = sampleReplay(replay, 0.05);
  assert.equal(sample.x, 1);
  assert.equal(sample.y, 0.5);
  assert.ok(Math.abs(sample.a - Math.PI / 4) < 0.0001);
});

test("encrypted share strings round-trip and reject tampering", async () => {
  const replay = createReplayRecorder("SHARE", "2d", 4);
  recordReplaySample(replay, 0, { x: 0.5, y: 0.5, angle: 0 }, 100);
  recordReplaySample(replay, 1, { x: 0.5, y: 0.5, angle: 0 }, 90);
  finishReplayRecord(replay, 1, false, "D");

  const share = await exportReplayShare(replay);
  assert.match(share, /^BSP1\.[A-Za-z0-9_-]+$/);
  const imported = await importReplayShare(share);
  assert.deepEqual(imported, replay);
  await assert.rejects(() => importReplayShare(`${share}x`));
});

test("parseReplayImportInput accepts BSP1 codes, paste URLs, and bare keys", () => {
  assert.deepEqual(parseReplayImportInput("BSP1.abc"), {
    kind: "share",
    share: "BSP1.abc",
  });
  assert.deepEqual(parseReplayImportInput("https://pastes.dev/AbCd12"), {
    kind: "paste",
    key: "AbCd12",
  });
  assert.deepEqual(parseReplayImportInput("https://api.pastes.dev/AbCd12"), {
    kind: "paste",
    key: "AbCd12",
  });
  assert.deepEqual(parseReplayImportInput("https://paste.lucko.me/raw/AbCd12"), {
    kind: "paste",
    key: "AbCd12",
  });
  assert.deepEqual(parseReplayImportInput("AbCd12"), {
    kind: "paste",
    key: "AbCd12",
  });
  assert.equal(pasteUrlForKey("AbCd12"), "https://pastes.dev/AbCd12");
  assert.equal(
    pasteUrlForKey("AbCd12", true),
    "https://api.pastes.dev/AbCd12",
  );
  assert.throws(() => parseReplayImportInput("https://example.com/x"), /paste/);
  assert.throws(() => parseReplayImportInput(""), /Empty/);
});

test("upload and import via mocked pastes.dev API", async () => {
  const replay = createReplayRecorder("PASTE", "2d", 5);
  recordReplaySample(replay, 0, { x: 0.5, y: 0.5, angle: 0 }, 100);
  recordReplaySample(replay, 1, { x: 0.5, y: 0.5, angle: 0 }, 90);
  finishReplayRecord(replay, 1, false, "D");

  const share = await exportReplayShare(replay);
  const store = new Map();

  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/post") && options.method === "POST") {
      const key = "mockKey9";
      store.set(key, String(options.body));
      return {
        ok: true,
        status: 201,
        headers: { get: (name) => (String(name).toLowerCase() === "location" ? key : null) },
        json: async () => ({ key }),
        text: async () => JSON.stringify({ key }),
      };
    }
    // Official read: GET https://api.pastes.dev/{key}
    const api = href.match(/api\.pastes\.dev\/([A-Za-z0-9]+)$/);
    if (api && (!options.method || options.method === "GET")) {
      const body = store.get(api[1]);
      if (body == null) {
        return { ok: false, status: 404, text: async () => "not found" };
      }
      return { ok: true, status: 200, text: async () => body };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  const url = await uploadReplayShare(share, fetchImpl);
  assert.equal(url, "https://pastes.dev/mockKey9");

  const linked = await exportReplayShareLink(replay, fetchImpl);
  assert.equal(linked.url, "https://pastes.dev/mockKey9");
  assert.match(linked.share, /^BSP1\./);

  const fromUrl = await importReplayShareInput(url, fetchImpl);
  assert.deepEqual(fromUrl, replay);
  const fromApi = await importReplayShareInput(
    "https://api.pastes.dev/mockKey9",
    fetchImpl,
  );
  assert.deepEqual(fromApi, replay);
  const fromKey = await importReplayShareInput("mockKey9", fetchImpl);
  assert.deepEqual(fromKey, replay);
  const fromShare = await importReplayShareInput(share, fetchImpl);
  assert.deepEqual(fromShare, replay);

  await assert.rejects(() => uploadReplayShare("not-a-share", fetchImpl));
  await assert.rejects(() =>
    importReplayShareInput("https://pastes.dev/missing", fetchImpl),
  );
});

test("replay route validation rejects impossible speed, wall crossing, and fake completion", () => {
  const fast = stationaryReplay("ROUTE-FAST", 10);
  fast.samples[1].x = 10;
  assert.throws(() => validateReplayRoute(fast), /too fast/);

  const wallCrossing = stationaryReplay("ROUTE-WALL", 11);
  wallCrossing.samples[1] = { t: 1, x: 0.1, y: 0.5, a: 0, e: 100 };
  assert.throws(() => validateReplayRoute(wallCrossing), /wall|too fast/);

  const forgedSuccess = stationaryReplay("ROUTE-END", 12);
  forgedSuccess.success = true;
  forgedSuccess.rank = "S";
  assert.throws(() => validateReplayRoute(forgedSuccess), /result/);
});

test("serialized replay saves retain concurrent records in the local index", async () => {
  const storage = memoryStorage();
  const one = stationaryReplay("QUEUE-ONE", 1000);
  const two = stationaryReplay("QUEUE-TWO", 2000);
  await Promise.all([saveReplay(one, storage), saveReplay(two, storage)]);
  const stored = await loadReplays(storage);
  assert.deepEqual(new Set(stored.map((replay) => replay.id)), new Set([one.id, two.id]));
});

test("replay controls clamp seeks and resume sonar events after the selected time", () => {
  const replay = createReplayRecorder("GAMMA", "3d", 3);
  replay.duration = 12;
  replay.events = [
    { t: 1, type: "red" },
    { t: 5, type: "green" },
    { t: 9, type: "blue" },
  ];

  assert.equal(replayDuration(replay), 12);
  assert.equal(clampReplayTime(replay, -4), 0);
  assert.equal(clampReplayTime(replay, 15), 12);
  assert.equal(replayEventCursor(replay, 0), 0);
  assert.equal(replayEventCursor(replay, 5), 2);
  assert.equal(replayEventCursor(replay, 8.9), 2);
});

test("replay records retain mode, sonar events, and the final result", () => {
  const replay = createReplayRecorder("BETA", "3d", 2);
  recordReplaySonar(replay, 3.25, "blue", { x: 2.25, y: 3.5, angle: 1 });
  // Route validation requires at least one sample; success is left false so a
  // stationary pose does not claim a forged completion.
  recordReplaySample(replay, 0, { x: 0.5, y: 0.5, angle: 0 }, 100, true);
  recordReplaySample(replay, 45.8, { x: 0.5, y: 0.5, angle: 0 }, 100, true);
  const completed = finishReplayRecord(replay, 45.8, false, "D");

  assert.equal(completed.mode, "3d");
  assert.equal(completed.duration, 45.8);
  assert.equal(completed.success, false);
  assert.equal(completed.rank, "D");
  assert.deepEqual(completed.events[0], {
    t: 3.25,
    type: "blue",
    x: 2.25,
    y: 3.5,
    a: 1,
  });
});

test("finishReplayRecord aligns duration with the last sample", () => {
  const replay = createReplayRecorder("ALIGN", "2d", null, 50);
  recordReplaySample(replay, 0, { x: 0.5, y: 0.5, angle: 0 }, 100, true);
  recordReplaySample(replay, 1.23456, { x: 0.5, y: 0.5, angle: 0 }, 100, true);
  const finished = finishReplayRecord(replay, 1.3, false, "D");
  assert.equal(finished.samples.at(-1).t, finished.duration);
  assert.doesNotThrow(() => validateReplayRoute(finished));
});

test("hitch first-move without a spawn sample is rejected, with spawn it saves", async () => {
  const storage = memoryStorage();
  const bare = createReplayRecorder("HIT-BARE", "3d", null, 60);
  // Mimic a 40ms hitch before the first sample: already past spawn epsilon.
  recordReplaySample(bare, 0.04, { x: 0.6, y: 0.5, angle: 0 }, 100);
  recordReplaySample(bare, 1, { x: 0.6, y: 0.5, angle: 0 }, 100, true);
  finishReplayRecord(bare, 1, false, "D");
  await assert.rejects(() => saveReplay(bare, storage), /spawn/);

  const anchored = createReplayRecorder("HIT-OK", "3d", null, 61);
  recordReplaySample(anchored, 0, { x: 0.5, y: 0.5, angle: 0 }, 100, true);
  recordReplaySample(anchored, 0.04, { x: 0.6, y: 0.5, angle: 0 }, 100);
  recordReplaySample(anchored, 1, { x: 0.6, y: 0.5, angle: 0 }, 100, true);
  finishReplayRecord(anchored, 1, false, "D");
  await saveReplay(anchored, storage);
  const stored = await loadReplays(storage);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, anchored.id);
});

test("wall-sliding routes from real movement still save and load", async () => {
  const { stepPlayer } = await import("./movement.js");
  const { buildMaze, collidesWithMaze, hashSeed } = await import("./core.js");
  const storage = memoryStorage();
  const seed = "SLIDE-RUN";
  const maze = buildMaze(hashSeed(seed));
  const collides = (x, y, r = 0.2) => collidesWithMaze(maze, x, y, r);
  let player = { x: 0.5, y: 0.5, r: 0.2, angle: 0, v: 0, turnV: 0 };
  const replay = createReplayRecorder(seed, "3d", null, 70);
  recordReplaySample(replay, 0, player, 100, true);
  let scoreTime = 0;
  for (let i = 0; i < 900; i++) {
    const before = { x: player.x, y: player.y };
    player = stepPlayer(
      player,
      { forward: true, back: false, left: false, right: false },
      "3d",
      100,
      1 / 60,
      collides,
    ).player;
    if (Math.hypot(player.x - before.x, player.y - before.y) < 0.0005)
      player.angle += 0.55;
    scoreTime += 1 / 60;
    recordReplaySample(replay, scoreTime, player, 100);
  }
  recordReplaySample(replay, scoreTime, player, 100, true);
  finishReplayRecord(replay, scoreTime, false, "D");
  assert.doesNotThrow(() => validateReplayRoute(replay));
  await saveReplay(replay, storage);
  const stored = await loadReplays(storage);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].seed, seed);
  assert.ok(stored[0].samples.length > 10);
});
