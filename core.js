export const COLS = 19;
export const ROWS = 13;

export function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function createRng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function wallKey(x1, y1, x2, y2) {
  return x1 < x2 || (x1 === x2 && y1 < y2)
    ? `${x1},${y1},${x2},${y2}`
    : `${x2},${y2},${x1},${y1}`;
}

function makeWall(x1, y1, x2, y2) {
  return {
    x1,
    y1,
    x2,
    y2,
    key: wallKey(x1, y1, x2, y2),
    vertical: x1 === x2,
  };
}

export function buildMaze(seed, cols = COLS, rows = ROWS) {
  const random = createRng(seed);
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const open = new Set();
  const stack = [[0, 0]];
  visited[0][0] = true;

  while (stack.length) {
    const [x, y] = stack.at(-1);
    const options = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ].filter(
      ([nextX, nextY]) =>
        nextX >= 0 &&
        nextY >= 0 &&
        nextX < cols &&
        nextY < rows &&
        !visited[nextY][nextX],
    );

    if (!options.length) {
      stack.pop();
      continue;
    }

    const [nextX, nextY] = options[Math.floor(random() * options.length)];
    open.add(`${x},${y}:${nextX},${nextY}`);
    open.add(`${nextX},${nextY}:${x},${y}`);
    visited[nextY][nextX] = true;
    stack.push([nextX, nextY]);
  }

  const walls = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!y) walls.push(makeWall(x, y, x + 1, y));
      if (!x) walls.push(makeWall(x, y, x, y + 1));
      if (y === rows - 1) walls.push(makeWall(x, y + 1, x + 1, y + 1));
      if (x === cols - 1) walls.push(makeWall(x + 1, y, x + 1, y + 1));
      if (x < cols - 1 && !open.has(`${x},${y}:${x + 1},${y}`)) {
        walls.push(makeWall(x + 1, y, x + 1, y + 1));
      }
      if (y < rows - 1 && !open.has(`${x},${y}:${x},${y + 1}`)) {
        walls.push(makeWall(x, y + 1, x + 1, y + 1));
      }
    }
  }

  return {
    cols,
    rows,
    walls,
    wallByKey: new Map(walls.map((wall) => [wall.key, wall])),
    open,
    end: { x: cols - 0.5, y: rows - 0.5 },
  };
}

export function placeCrystals(seed, cols = COLS, rows = ROWS, count = 10) {
  const random = createRng(seed ^ 0x9e3779b9);
  const crystals = [];
  let attempts = 0;
  while (crystals.length < count && attempts++ < 5000) {
    const x = Math.floor(random() * cols) + 0.5;
    const y = Math.floor(random() * rows) + 0.5;
    if ((x < 2 && y < 2) || (x > cols - 2 && y > rows - 2)) continue;
    if (
      crystals.some((crystal) => Math.hypot(crystal.x - x, crystal.y - y) < 1.2)
    )
      continue;
    crystals.push({ x, y, picked: false });
  }
  return crystals;
}

export function placeItems(seed, crystals, cols = COLS, rows = ROWS) {
  const random = createRng(seed ^ 0x85ebca6b);
  const items = [];
  for (const type of ["beacon", "capacitor", "resonator"]) {
    let attempts = 0;
    while (attempts++ < 300) {
      const x = Math.floor(random() * cols) + 0.5;
      const y = Math.floor(random() * rows) + 0.5;
      const nearStart = x < 2 && y < 2;
      const nearEnd = x > cols - 2 && y > rows - 2;
      const nearCrystal = crystals.some(
        (crystal) => Math.hypot(crystal.x - x, crystal.y - y) < 1.35,
      );
      const nearItem = items.some(
        (item) => Math.hypot(item.x - x, item.y - y) < 2.2,
      );
      if (nearStart || nearEnd || nearCrystal || nearItem) continue;
      items.push({ x, y, type, picked: false });
      break;
    }
  }
  return items;
}

export function pointSegmentDistance(px, py, wall) {
  const vx = wall.x2 - wall.x1;
  const vy = wall.y2 - wall.y1;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((px - wall.x1) * vx + (py - wall.y1) * vy) / (vx * vx + vy * vy),
    ),
  );
  return Math.hypot(px - (wall.x1 + vx * t), py - (wall.y1 + vy * t));
}

export function collidesWithMaze(maze, x, y, radius) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      const cx = cellX + offsetX;
      const cy = cellY + offsetY;
      const candidates = [
        wallKey(cx, cy, cx + 1, cy),
        wallKey(cx, cy + 1, cx + 1, cy + 1),
        wallKey(cx, cy, cx, cy + 1),
        wallKey(cx + 1, cy, cx + 1, cy + 1),
      ];
      for (const key of candidates) {
        const wall = maze.wallByKey.get(key);
        if (wall && pointSegmentDistance(x, y, wall) < radius) return true;
      }
    }
  }
  return false;
}

function boundaryWall(maze, axis, boundary, cell) {
  return axis === "x"
    ? maze.wallByKey.get(wallKey(boundary, cell, boundary, cell + 1))
    : maze.wallByKey.get(wallKey(cell, boundary, cell + 1, boundary));
}

/** Cast through the maze grid in O(number of crossed cells), rather than scanning every wall. */
export function castGridRay(maze, x, y, dx, dy, maxDistance = 30) {
  const epsilon = 1e-9;
  const length = Math.hypot(dx, dy);
  if (length < epsilon || maxDistance <= 0) return null;
  dx /= length;
  dy /= length;

  let cellX = Math.floor(x);
  let cellY = Math.floor(y);
  const stepX = dx > epsilon ? 1 : dx < -epsilon ? -1 : 0;
  const stepY = dy > epsilon ? 1 : dy < -epsilon ? -1 : 0;
  const deltaX = stepX ? Math.abs(1 / dx) : Infinity;
  const deltaY = stepY ? Math.abs(1 / dy) : Infinity;
  let nextX = stepX > 0 ? cellX + 1 : cellX;
  let nextY = stepY > 0 ? cellY + 1 : cellY;
  let distanceX = stepX ? (nextX - x) / dx : Infinity;
  let distanceY = stepY ? (nextY - y) / dy : Infinity;

  while (Math.min(distanceX, distanceY) <= maxDistance + epsilon) {
    if (Math.abs(distanceX - distanceY) < epsilon) {
      const distance = distanceX;
      const wallX = boundaryWall(
        maze,
        "x",
        stepX > 0 ? cellX + 1 : cellX,
        cellY,
      );
      const wallY = boundaryWall(
        maze,
        "y",
        stepY > 0 ? cellY + 1 : cellY,
        cellX,
      );
      const wall = wallX || wallY;
      if (wall) {
        return {
          wall,
          x: x + dx * distance,
          y: y + dy * distance,
          distance,
          // A closed corner has two collision normals, so callers can reflect
          // both components rather than arbitrarily favouring one wall.
          normalX: Boolean(wallX),
          normalY: Boolean(wallY),
        };
      }
      cellX += stepX;
      cellY += stepY;
      distanceX += deltaX;
      distanceY += deltaY;
      continue;
    }

    if (distanceX < distanceY) {
      const distance = distanceX;
      const boundary = stepX > 0 ? cellX + 1 : cellX;
      const wall = boundaryWall(maze, "x", boundary, cellY);
      if (wall) {
        return {
          wall,
          x: x + dx * distance,
          y: y + dy * distance,
          distance,
          normalX: true,
          normalY: false,
        };
      }
      cellX += stepX;
      distanceX += deltaX;
    } else {
      const distance = distanceY;
      const boundary = stepY > 0 ? cellY + 1 : cellY;
      const wall = boundaryWall(maze, "y", boundary, cellX);
      if (wall) {
        return {
          wall,
          x: x + dx * distance,
          y: y + dy * distance,
          distance,
          normalX: false,
          normalY: true,
        };
      }
      cellY += stepY;
      distanceY += deltaY;
    }
  }
  return null;
}
