/* Off-main-thread DDA raycasts for 3D columns. Falls back is handled by game.js. */
import { buildMaze, castGridRay, hashSeed } from "./core.js";

let maze = null;
let mazeSeed = null;

function ensureMaze(seed) {
  if (maze && mazeSeed === seed) return maze;
  mazeSeed = seed;
  maze = buildMaze(hashSeed(seed));
  return maze;
}

/**
 * Packs hits as a flat Float64Array:
 * [count, then for each column: hit(0/1), x, y, dist, wallX1, wallY1, wallX2, wallY2]
 * 8 values per column after the count.
 */
function castColumns(seed, px, py, angle, fov, cols, maxDistance) {
  const m = ensureMaze(seed);
  const stride = 8;
  const out = new Float64Array(1 + cols * stride);
  out[0] = cols;
  for (let i = 0; i < cols; i++) {
    const ratio = cols === 1 ? 0 : i / (cols - 1) - 0.5;
    const a = angle + ratio * fov;
    const hit = castGridRay(m, px, py, Math.cos(a), Math.sin(a), maxDistance);
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

self.onmessage = (event) => {
  const data = event.data;
  if (!data || data.type !== "cast") return;
  try {
    const packed = castColumns(
      data.seed,
      data.x,
      data.y,
      data.angle,
      data.fov,
      data.cols,
      data.maxDistance ?? 26,
    );
    self.postMessage(
      { type: "hits", id: data.id, buffer: packed.buffer },
      [packed.buffer],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      id: data.id,
      message: error?.message || String(error),
    });
  }
};
