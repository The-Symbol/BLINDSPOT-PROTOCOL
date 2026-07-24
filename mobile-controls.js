import { wrapAngle } from "./movement.js";

export function isLandscapeViewport(width, height) {
  return width >= height;
}

export function applyTouchLook(angle, deltaX, sensitivity = 1) {
  return wrapAngle(angle + deltaX * 0.006 * sensitivity);
}

export function joystickState(clientX, clientY, rect, max = 36, dead = 12) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  const length = Math.hypot(dx, dy) || 1;
  const scale = Math.min(1, max / length);
  const x = dx * scale;
  const y = dy * scale;
  return {
    x,
    y,
    forward: y < -dead,
    back: y > dead,
    left: x < -dead,
    right: x > dead,
  };
}

/**
 * Browser-facing orientation helper kept injectable so its success, fallback,
 * and unsupported paths can be exercised without a real phone.
 */
export async function requestLandscapeMode({
  mobile,
  fromGesture,
  documentRef,
  screenRef,
  width,
  height,
}) {
  if (!mobile) return { locked: false, dismissPrompt: true, unsupported: true };
  try {
    if (
      fromGesture &&
      !documentRef.fullscreenElement &&
      documentRef.documentElement.requestFullscreen
    )
      await documentRef.documentElement.requestFullscreen({ navigationUI: "hide" });
    if (screenRef.orientation?.lock)
      await screenRef.orientation.lock("landscape");
    const landscape = isLandscapeViewport(width(), height());
    return { locked: landscape, dismissPrompt: landscape || fromGesture };
  } catch (_) {
    const landscape = isLandscapeViewport(width(), height());
    return { locked: false, dismissPrompt: landscape || fromGesture, failed: true };
  }
}
