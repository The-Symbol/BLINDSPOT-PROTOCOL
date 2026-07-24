import { castGridRay } from "./core.js";

export const SONAR_TYPES = {
  red: { color: "#ff6259", life: 9, speed: 9.5, spread: Math.PI / 6, rays: 21 },
  green: {
    color: "#a9ef68",
    life: 7,
    speed: 7.5,
    spread: Math.PI / 6,
    rays: 21,
  },
  blue: { color: "#5dddf1", life: 5, speed: 11, spread: Math.PI, rays: 72 },
};

const TAU = Math.PI * 2;
const EPSILON = 0.0001;

export function createPing(type, x, y, angle) {
  const spec = SONAR_TYPES[type];
  const rays = [];

  for (let index = 0; index < spec.rays; index += 1) {
    const ratio = spec.rays === 1 ? 0.5 : index / (spec.rays - 1);
    const rayAngle =
      type === "blue"
        ? ratio * TAU
        : angle - spec.spread + ratio * spec.spread * 2;
    rays.push({
      x,
      y,
      dx: Math.cos(rayAngle),
      dy: Math.sin(rayAngle),
      angle: rayAngle,
      bounces: type === "green" ? 3 : 0,
      active: true,
      trail: [{ x, y }],
    });
  }

  return { type, rays, segments: [], dead: false };
}

function reflect(ray, hit) {
  if (hit.normalX) ray.dx *= -1;
  if (hit.normalY) ray.dy *= -1;
  ray.angle = Math.atan2(ray.dy, ray.dx);
  ray.x += ray.dx * EPSILON;
  ray.y += ray.dy * EPSILON;
}

/**
 * Advances a ping precisely by its configured distance. `onWallHit` receives
 * exactly the wall touched by each ray; green waves deliberately do not reveal
 * adjacent walls.
 */
export function stepPing(ping, maze, distance, onWallHit) {
  for (const ray of ping.rays) {
    if (!ray.active) continue;
    let remaining = distance;

    while (remaining > EPSILON && ray.active) {
      const hit = castGridRay(maze, ray.x, ray.y, ray.dx, ray.dy, remaining);
      if (!hit) {
        ray.x += ray.dx * remaining;
        ray.y += ray.dy * remaining;
        break;
      }

      ray.x = hit.x;
      ray.y = hit.y;
      ray.trail.push({ x: hit.x, y: hit.y });
      ping.segments.push({ x: hit.x, y: hit.y, angle: ray.angle });
      onWallHit(hit.wall, ping.type);
      remaining = Math.max(0, remaining - hit.distance);

      if (ping.type === "green" && ray.bounces > 0) {
        reflect(ray, hit);
        ray.bounces -= 1;
      } else {
        ray.active = false;
      }
    }
  }

  ping.dead = ping.rays.every((ray) => !ray.active);
  return ping;
}
