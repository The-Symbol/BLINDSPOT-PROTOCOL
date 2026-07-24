import assert from "node:assert/strict";
import test from "node:test";
import {
  clampReplayTime,
  createReplayRecorder,
  exportReplayShare,
  finishReplayRecord,
  importReplayShare,
  recordReplaySample,
  recordReplaySonar,
  replayEventCursor,
  replayDuration,
  sampleReplay,
  saveReplay,
  loadReplays,
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
