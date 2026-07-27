/**
 * Custom industrial-terminal scrollbars.
 * Native overlay scrollbars (Windows/macOS/mobile) often ignore ::-webkit-scrollbar
 * styling and can be undraggable on touch. This draws a fixed rail + thumb that
 * works with mouse and touch pointer events on every platform.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {HTMLElement} viewport scrollable element
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function attachTerminalScroll(viewport) {
  if (!(viewport instanceof HTMLElement)) return { destroy() {}, refresh() {} };
  if (viewport.dataset.termScroll === "1") return { destroy() {}, refresh() {} };

  const parent = viewport.parentElement;
  if (!parent) return { destroy() {}, refresh() {} };

  const wrap = document.createElement("div");
  wrap.className = "term-scroll";
  parent.insertBefore(wrap, viewport);
  wrap.append(viewport);

  viewport.classList.add("term-scroll-viewport");
  viewport.dataset.termScroll = "1";

  const rail = document.createElement("div");
  rail.className = "term-scroll-rail";
  rail.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "term-scroll-thumb";
  rail.append(thumb);
  wrap.append(rail);

  /** @type {number | null} */
  let dragPointer = null;
  let dragStartY = 0;
  let dragStartScroll = 0;
  let dragFromRail = false;

  function railPointerY(event, rect) {
    return event.clientY - rect.top;
  }
  let frame = 0;
  let docListening = false;

  function metrics() {
    const viewH = viewport.clientHeight;
    const scrollH = viewport.scrollHeight;
    const maxScroll = Math.max(0, scrollH - viewH);
    // Prefer rail height; fall back to viewport when rail is display:none (0).
    const railH = rail.clientHeight || viewH || 1;
    const minThumb = 28;
    const thumbH =
      scrollH <= viewH + 1
        ? railH
        : clamp((viewH / scrollH) * railH, minThumb, railH);
    const maxThumbTop = Math.max(0, railH - thumbH);
    const thumbTop =
      maxScroll <= 0 ? 0 : (viewport.scrollTop / maxScroll) * maxThumbTop;
    return { viewH, scrollH, maxScroll, railH, thumbH, maxThumbTop, thumbTop };
  }

  function refresh() {
    const m = metrics();
    // Hysteresis: avoid flapping active state when scrollH ≈ viewH (1px noise,
    // subpixel rounding, or font metric shifts). Rail visibility must not
    // change layout — CSS always reserves padding-right for the rail.
    const wasActive = wrap.classList.contains("term-scroll-active");
    const needed = wasActive
      ? m.scrollH > m.viewH + 0.5
      : m.scrollH > m.viewH + 2;
    if (needed !== wasActive) wrap.classList.toggle("term-scroll-active", needed);
    if (!needed) {
      thumb.style.height = "0px";
      thumb.style.transform = "translateY(0)";
      return;
    }
    // Re-measure after rail becomes visible (clientHeight was 0 while display:none).
    const m2 = metrics();
    const nextH = `${m2.thumbH}px`;
    const nextY = `translateY(${m2.thumbTop}px)`;
    // Skip style writes that don't change — reduces ResizeObserver churn.
    if (thumb.style.height !== nextH) thumb.style.height = nextH;
    if (thumb.style.transform !== nextY) thumb.style.transform = nextY;
  }

  function scheduleRefresh() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  }

  function onScroll() {
    scheduleRefresh();
  }

  function scrollFromThumbTop(thumbTop) {
    const m = metrics();
    if (m.maxScroll <= 0 || m.maxThumbTop <= 0) return;
    const ratio = clamp(thumbTop, 0, m.maxThumbTop) / m.maxThumbTop;
    viewport.scrollTop = ratio * m.maxScroll;
  }

  function onDocPointerMove(event) {
    if (dragPointer !== event.pointerId) return;
    event.preventDefault();
    const m = metrics();
    if (m.maxScroll <= 0 || m.maxThumbTop <= 0) return;

    if (dragFromRail) {
      // Scrub relative to rail geometry (rail click-jump + drag).
      const rect = rail.getBoundingClientRect();
      const y = railPointerY(event, rect) - m.thumbH / 2;
      scrollFromThumbTop(y);
      return;
    }

    // The rail is visually vertical in every mode, including the rotated
    // fallback, so horizontal drags must never affect the scroll position.
    const delta = event.clientY - dragStartY;
    const scrollPerPx = m.maxScroll / m.maxThumbTop;
    viewport.scrollTop = clamp(
      dragStartScroll + delta * scrollPerPx,
      0,
      m.maxScroll,
    );
  }

  function endDrag(event) {
    if (dragPointer == null) return;
    if (event && dragPointer !== event.pointerId) return;
    const id = dragPointer;
    dragPointer = null;
    dragFromRail = false;
    thumb.classList.remove("dragging");
    wrap.classList.remove("term-scroll-dragging");
    stopDocListeners();
    try {
      thumb.releasePointerCapture?.(id);
    } catch (_) {}
    try {
      rail.releasePointerCapture?.(id);
    } catch (_) {}
  }

  function startDocListeners() {
    if (docListening) return;
    docListening = true;
    // Document capture phase: keeps drag alive even if pointer leaves the thumb
    // or setPointerCapture fails (common on some mobile WebViews).
    document.addEventListener("pointermove", onDocPointerMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener("pointerup", endDrag, { capture: true });
    document.addEventListener("pointercancel", endDrag, { capture: true });
    document.addEventListener("lostpointercapture", endDrag, { capture: true });
  }

  function stopDocListeners() {
    if (!docListening) return;
    docListening = false;
    document.removeEventListener("pointermove", onDocPointerMove, {
      capture: true,
    });
    document.removeEventListener("pointerup", endDrag, { capture: true });
    document.removeEventListener("pointercancel", endDrag, { capture: true });
    document.removeEventListener("lostpointercapture", endDrag, {
      capture: true,
    });
  }

  function onThumbPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragPointer = event.pointerId;
    dragStartY = event.clientY;
    dragStartScroll = viewport.scrollTop;
    dragFromRail = false;
    thumb.classList.add("dragging");
    wrap.classList.add("term-scroll-dragging");
    startDocListeners();
    try {
      thumb.setPointerCapture?.(event.pointerId);
    } catch (_) {}
  }

  function onRailPointerDown(event) {
    if (event.target === thumb || thumb.contains(/** @type {Node} */ (event.target)))
      return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = rail.getBoundingClientRect();
    const m = metrics();
    const y = railPointerY(event, rect) - m.thumbH / 2;
    scrollFromThumbTop(y);
    // Begin continuous scrub from this position.
    dragPointer = event.pointerId;
    dragStartY = event.clientY;
    dragStartScroll = viewport.scrollTop;
    dragFromRail = true;
    thumb.classList.add("dragging");
    wrap.classList.add("term-scroll-dragging");
    startDocListeners();
    try {
      rail.setPointerCapture?.(event.pointerId);
    } catch (_) {}
  }

  // Block touch scrolling of the page while interacting with the rail.
  function onRailTouchGuard(event) {
    event.preventDefault();
  }

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleRefresh)
      : null;
  resizeObserver?.observe(viewport);
  resizeObserver?.observe(wrap);

  const mutationObserver =
    typeof MutationObserver === "function"
      ? new MutationObserver(scheduleRefresh)
      : null;
  mutationObserver?.observe(viewport, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  viewport.addEventListener("scroll", onScroll, { passive: true });
  thumb.addEventListener("pointerdown", onThumbPointerDown);
  rail.addEventListener("pointerdown", onRailPointerDown);
  // Non-passive touchstart so preventDefault actually stops native scroll.
  rail.addEventListener("touchstart", onRailTouchGuard, { passive: false });
  thumb.addEventListener("touchstart", onRailTouchGuard, { passive: false });
  window.addEventListener("resize", scheduleRefresh);

  // Double-rAF: first paint applies display:block on the rail, second measures.
  requestAnimationFrame(() => {
    refresh();
    requestAnimationFrame(refresh);
  });

  return {
    refresh,
    destroy() {
      endDrag();
      viewport.removeEventListener("scroll", onScroll);
      thumb.removeEventListener("pointerdown", onThumbPointerDown);
      rail.removeEventListener("pointerdown", onRailPointerDown);
      rail.removeEventListener("touchstart", onRailTouchGuard);
      thumb.removeEventListener("touchstart", onRailTouchGuard);
      window.removeEventListener("resize", scheduleRefresh);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      rail.remove();
      if (wrap.parentNode) {
        wrap.parentNode.insertBefore(viewport, wrap);
        wrap.remove();
      }
      viewport.classList.remove("term-scroll-viewport");
      delete viewport.dataset.termScroll;
    },
  };
}

/** Attach to every matching element currently in the document. */
export function attachTerminalScrollAll(selector) {
  const handles = [];
  for (const el of document.querySelectorAll(selector))
    handles.push(attachTerminalScroll(el));
  return handles;
}
