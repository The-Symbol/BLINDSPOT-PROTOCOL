import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTouchLook,
  isLandscapeViewport,
  joystickState,
  requestLandscapeMode,
} from "./mobile-controls.js";

test("mobile landscape integration requests fullscreen and orientation from a gesture", async () => {
  let fullscreen = 0;
  let locked = "";
  const result = await requestLandscapeMode({
    mobile: true,
    fromGesture: true,
    documentRef: {
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: async () => {
          fullscreen++;
        },
      },
    },
    screenRef: { orientation: { lock: async (value) => (locked = value) } },
    width: () => 900,
    height: () => 500,
  });
  assert.equal(fullscreen, 1);
  assert.equal(locked, "landscape");
  assert.deepEqual(result, { locked: true, dismissPrompt: true });
  assert.equal(isLandscapeViewport(500, 900), false);
});

test("mobile landscape integration allows a manual fallback when orientation lock fails", async () => {
  const result = await requestLandscapeMode({
    mobile: true,
    fromGesture: true,
    documentRef: { fullscreenElement: null, documentElement: {} },
    screenRef: { orientation: { lock: async () => { throw new Error("blocked"); } } },
    width: () => 500,
    height: () => 900,
  });
  assert.equal(result.failed, true);
  assert.equal(result.dismissPrompt, true);
});

test("touch look wraps heading and joystick maps touch coordinates to movement", () => {
  const angle = applyTouchLook(Math.PI - 0.01, 10, 1);
  assert.ok(angle < -3.05);
  const rect = { left: 100, top: 200, width: 100, height: 100 };
  assert.deepEqual(joystickState(150, 150, rect), {
    x: 0,
    y: -36,
    forward: true,
    back: false,
    left: false,
    right: false,
  });
  const right = joystickState(250, 250, rect);
  assert.equal(right.right, true);
  assert.equal(right.forward, false);
});
