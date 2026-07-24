export function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function approach(value, target, rate, dt) {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

/**
 * Advances a player without depending on DOM or global game state.
 * The collision callback receives the candidate centre coordinates and radius.
 */
export function stepPlayer(player, input, viewMode, energy, dt, collides) {
  const next = { ...player };
  const empty = energy <= 0.01;
  let dx = 0;
  let dy = 0;

  if (viewMode === "2d") {
    const direction = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const topSpeed = empty ? 0.58 : 2.65;

    next.v = approach(next.v, direction * topSpeed, direction ? 8 : 4.2, dt);
    next.turnV = approach(next.turnV, turn * 2.9, turn ? 11 : 6, dt);
    if (Math.abs(next.v) < 0.006) next.v = 0;
    if (Math.abs(next.turnV) < 0.006) next.turnV = 0;

    next.angle = wrapAngle(next.angle + next.turnV * dt);
    dx = Math.cos(next.angle) * next.v * dt;
    dy = Math.sin(next.angle) * next.v * dt;
  } else {
    const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const length = Math.hypot(forward, strafe) || 1;
    const speed = empty ? 0.55 : 2.5;

    dx =
      ((Math.cos(next.angle) * forward - Math.sin(next.angle) * strafe) /
        length) *
      speed *
      dt;
    dy =
      ((Math.sin(next.angle) * forward + Math.cos(next.angle) * strafe) /
        length) *
      speed *
      dt;
  }

  if (!dx && !dy) return { player: next, moved: false, collided: false };

  // Try the intended diagonal position first. Falling back to one axis at a time
  // preserves useful wall sliding without giving the X axis permanent priority.
  if (!collides(next.x + dx, next.y + dy, next.r)) {
    next.x += dx;
    next.y += dy;
    return { player: next, moved: true, collided: false };
  }

  let collided = true;
  if (!collides(next.x + dx, next.y, next.r)) next.x += dx;
  if (!collides(next.x, next.y + dy, next.r)) next.y += dy;

  return {
    player: next,
    moved: next.x !== player.x || next.y !== player.y,
    collided,
  };
}
