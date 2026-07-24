export const SONAR = {
  red: { cost: 1.2, cooldown: 1, label: "红色 60° 扇形波" },
  green: { cost: 21, cooldown: 5, label: "绿色 60° 反射波" },
  blue: { cost: 10, cooldown: 3, label: "蓝色全域环扫" },
};

export function createGameState(state = "title") {
  return {
    state,
    time: 0,
    scoreTime: 0,
    timerStarted: false,
    player: { x: 0.5, y: 0.5, r: 0.2, angle: 0, v: 0, turnV: 0, pitch: 0 },
    energy: 100,
    pings: [],
    trails: [],
    revealed: new Map(),
    shots: { red: 0, green: 0, blue: 0 },
    sonarReadyAt: { red: 0, green: 0, blue: 0 },
    crystals: [],
    picked: 0,
    items: [],
    beacons: [],
    pathHint: [],
    pathFlashUntil: 0,
    pathFlashStarted: 0,
    silentUntil: 0,
    flashUntil: 0,
    flashStarted: 0,
    toastUntil: 0,
  };
}

export function anyInputActive(input) {
  return Object.values(input).some(Boolean);
}

export function startsTimerFromInput(input, viewMode) {
  return viewMode === "2d"
    ? input.forward || input.back
    : anyInputActive(input);
}

export function updateClockAndEnergy(game, dt, { moving, inputActive }) {
  game.time += dt;
  if (inputActive) game.timerStarted = true;
  if (game.timerStarted) game.scoreTime += dt;

  const silentActive = game.silentUntil > game.time;
  if (!moving || silentActive)
    game.energy = Math.min(100, game.energy + dt * 1.95);

  return { silentActive };
}

export function sonarCooldownRemaining(game, type) {
  return Math.max(0, game.sonarReadyAt[type] - game.time);
}

export function tryFireSonar(game, type) {
  if (game.state !== "play") return { ok: false, reason: "inactive" };
  if (game.silentUntil > game.time) return { ok: false, reason: "silent" };

  const spec = SONAR[type];
  if (!spec) return { ok: false, reason: "unknown" };

  const cooldown = sonarCooldownRemaining(game, type);
  if (cooldown > 0) return { ok: false, reason: "cooldown", cooldown };
  if (game.energy < spec.cost) return { ok: false, reason: "energy" };

  game.timerStarted = true;
  game.energy -= spec.cost;
  game.shots[type] += 1;
  game.sonarReadyAt[type] = game.time + spec.cooldown;
  return { ok: true, spec };
}
