import assert from "node:assert/strict";
import test from "node:test";
import { wallKey } from "./core.js";
import {
  createGameState,
  SONAR,
  startsTimerFromInput,
  tryFireSonar,
  updateClockAndEnergy,
} from "./game-state.js";
import { stepPlayer } from "./movement.js";
import { createPing, stepPing } from "./sonar.js";

function wall(x1, y1, x2, y2) {
  return { x1, y1, x2, y2, key: wallKey(x1, y1, x2, y2), vertical: x1 === x2 };
}

function mazeFromWalls(walls) {
  return { wallByKey: new Map(walls.map((entry) => [entry.key, entry])) };
}

test("sonar cooldowns reject a second pulse until their configured duration expires", () => {
  const game = createGameState("play");
  assert.equal(tryFireSonar(game, "red").ok, true);
  assert.equal(tryFireSonar(game, "red").reason, "cooldown");
  game.time = 1;
  assert.equal(tryFireSonar(game, "red").ok, true);

  game.energy = 100;
  assert.equal(tryFireSonar(game, "green").ok, true);
  game.time += 4.99;
  assert.equal(tryFireSonar(game, "green").reason, "cooldown");
  game.time += 0.01;
  game.energy = 100;
  assert.equal(tryFireSonar(game, "green").ok, true);
});

test("blue sonar uses the updated 10 energy cost", () => {
  assert.equal(SONAR.blue.cost, 10);
  const game = createGameState("play");
  assert.equal(tryFireSonar(game, "blue").ok, true);
  assert.equal(game.energy, 90);
});

test("the score clock begins on movement and sonar use, not passive waiting", () => {
  const game = createGameState("play");
  updateClockAndEnergy(game, 10, { moving: false, inputActive: false });
  assert.equal(game.scoreTime, 0);
  updateClockAndEnergy(game, 0.5, { moving: true, inputActive: true });
  assert.equal(game.timerStarted, true);
  assert.equal(game.scoreTime, 0.5);
});

test("2D turning alone does not start the timer", () => {
  const turnOnly = { forward: false, back: false, left: true, right: false };
  assert.equal(startsTimerFromInput(turnOnly, "2d"), false);
  assert.equal(
    startsTimerFromInput({ ...turnOnly, forward: true }, "2d"),
    true,
  );
  assert.equal(startsTimerFromInput(turnOnly, "3d"), true);
});

test("movement attempts a diagonal move before falling back to wall sliding", () => {
  const player = { x: 0.5, y: 0.5, r: 0.2, angle: 0, v: 0, turnV: 0 };
  const input = { forward: true, back: false, left: false, right: true };
  const free = stepPlayer(player, input, "3d", 100, 0.1, () => false);
  assert.ok(free.player.x > player.x);
  assert.ok(free.player.y > player.y);
  assert.equal(free.collided, false);

  const blockedDiagonal = stepPlayer(
    player,
    input,
    "3d",
    100,
    0.1,
    (x, y) => x > 0.6 && y > 0.6,
  );
  assert.equal(blockedDiagonal.collided, true);
  assert.equal(blockedDiagonal.moved, true);
});

test("green sonar reveals only the contacted wall and reflects both axes at a closed corner", () => {
  const vertical = wall(1, 0, 1, 1);
  const horizontal = wall(0, 1, 1, 1);
  const nearbyButUntouched = wall(1, 1, 2, 1);
  const maze = mazeFromWalls([vertical, horizontal, nearbyButUntouched]);
  const ping = createPing("green", 0.5, 0.5, Math.PI / 4);
  const hits = [];

  // Use the centre ray for a deterministic diagonal corner collision.
  const ray = ping.rays[Math.floor(ping.rays.length / 2)];
  ping.rays = [ray];
  stepPing(ping, maze, 1, (hitWall) => hits.push(hitWall.key));

  assert.deepEqual(hits, [vertical.key]);
  assert.equal(hits.includes(nearbyButUntouched.key), false);
  assert.ok(ray.dx < 0, "closed corner flips horizontal direction");
  assert.ok(ray.dy < 0, "closed corner flips vertical direction");
});
