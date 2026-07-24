import assert from "node:assert/strict";
import test from "node:test";
import {
  COLS,
  ROWS,
  buildMaze,
  castGridRay,
  collidesWithMaze,
  hashSeed,
  placeCrystals,
  placeItems,
} from "./core.js";

test("same seed creates the same maze and placements", () => {
  const seed = hashSeed("ECHO-42");
  const firstMaze = buildMaze(seed);
  const secondMaze = buildMaze(seed);
  assert.deepEqual(firstMaze.walls, secondMaze.walls);

  const firstCrystals = placeCrystals(seed);
  const secondCrystals = placeCrystals(seed);
  assert.deepEqual(firstCrystals, secondCrystals);
  assert.deepEqual(
    placeItems(seed, firstCrystals),
    placeItems(seed, secondCrystals),
  );
});

test("every generated maze connects the spawn and energy station", () => {
  for (const label of [
    "ALPHA",
    "BETA",
    "GAMMA",
    "DELTA",
    "ECHO",
    "42",
    "测试种子",
  ]) {
    const maze = buildMaze(hashSeed(label));
    const queue = [[0, 0]];
    const seen = new Set(["0,0"]);
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [nextX, nextY] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nextX < 0 || nextY < 0 || nextX >= COLS || nextY >= ROWS) continue;
        if (!maze.open.has(`${x},${y}:${nextX},${nextY}`)) continue;
        const key = `${nextX},${nextY}`;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push([nextX, nextY]);
        }
      }
    }
    assert.ok(
      seen.has(`${COLS - 1},${ROWS - 1}`),
      `${label} should be solvable`,
    );
  }
});

test("DDA raycast finds a nearby wall and respects its maximum distance", () => {
  const maze = buildMaze(hashSeed("RAY-TEST"));
  const hit = castGridRay(maze, 0.5, 0.5, -1, 0, 30);
  assert.ok(hit);
  assert.equal(hit.wall.vertical, true);
  assert.ok(Math.abs(hit.distance - 0.5) < 1e-8);
  assert.equal(castGridRay(maze, 0.5, 0.5, -1, 0, 0.49), null);
});

test("maze collision checks only local wall candidates without losing boundary collisions", () => {
  const maze = buildMaze(hashSeed("COLLISION-TEST"));
  assert.equal(collidesWithMaze(maze, 0.1, 0.5, 0.2), true);
  assert.equal(collidesWithMaze(maze, 0.5, 0.5, 0.1), false);
});

test("placements are complete and avoid the protected start/end zones", () => {
  const seed = hashSeed("PLACEMENTS");
  const crystals = placeCrystals(seed);
  const items = placeItems(seed, crystals);
  assert.equal(crystals.length, 10);
  assert.equal(items.length, 3);
  for (const object of [...crystals, ...items]) {
    assert.equal(object.x < 2 && object.y < 2, false);
    assert.equal(object.x > COLS - 2 && object.y > ROWS - 2, false);
  }
});
