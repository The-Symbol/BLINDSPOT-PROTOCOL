/**
 * Looping BGM with crossfades between title / gameplay / PK tracks.
 * HTMLAudioElement streams mp3 without decoding the whole file into memory.
 */

const TRACK_URLS = {
  title: "music/title.mp3",
  background: "music/background.mp3",
  race: "music/race.mp3",
};

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function createMusicController(options = {}) {
  const getVolume = options.getVolume || (() => 1);
  const tracks = {};
  for (const [name, url] of Object.entries(TRACK_URLS)) {
    const audio = new Audio(url);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    tracks[name] = audio;
  }

  /** Relative gain 0..1 before master volume. */
  const relative = Object.fromEntries(Object.keys(tracks).map((k) => [k, 0]));
  let current = null;
  let unlocked = false;
  let fadeToken = 0;
  let desired = "title";

  function masterVolume() {
    return clamp01(getVolume());
  }

  function syncVolumes() {
    const master = masterVolume();
    for (const [name, audio] of Object.entries(tracks))
      audio.volume = clamp01(relative[name]) * master;
  }

  function startTrack(name) {
    const audio = tracks[name];
    if (!audio || !unlocked) return;
    // Always clear mute — unlock warm-up may have left a track muted.
    audio.muted = false;
    if (!audio.paused) return;
    const playResult = audio.play();
    if (playResult && typeof playResult.catch === "function")
      playResult.catch(() => {});
  }

  function pauseSilent(exceptName) {
    for (const [name, audio] of Object.entries(tracks)) {
      if (name === exceptName) continue;
      if (relative[name] > 0.001) continue;
      if (audio.paused) continue;
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch (_) {}
    }
  }

  function snapTo(name) {
    desired = name;
    current = name;
    for (const key of Object.keys(tracks)) relative[key] = key === name ? 1 : 0;
    syncVolumes();
    if (!unlocked) return;
    startTrack(name);
    pauseSilent(name);
  }

  function crossfadeTo(name, durationMs = 1200) {
    desired = name;
    if (!tracks[name]) return;
    if (!unlocked) return;

    // Instant cut when duration is 0 or already fully on this track.
    if (durationMs <= 0 || (current === name && relative[name] >= 0.99)) {
      snapTo(name);
      return;
    }

    const token = ++fadeToken;
    const from = { ...relative };
    const to = Object.fromEntries(
      Object.keys(tracks).map((key) => [key, key === name ? 1 : 0]),
    );

    startTrack(name);
    for (const [key, level] of Object.entries(from))
      if (level > 0.01) startTrack(key);

    current = name;
    const started = performance.now();
    const duration = Math.max(80, durationMs);

    function step(now) {
      if (token !== fadeToken) return;
      const t = Math.min(1, (now - started) / duration);
      const ease = t * t * (3 - 2 * t);
      for (const key of Object.keys(tracks)) {
        const a = from[key] ?? 0;
        const b = to[key] ?? 0;
        relative[key] = a + (b - a) * ease;
      }
      syncVolumes();
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      for (const key of Object.keys(tracks)) relative[key] = to[key];
      syncVolumes();
      startTrack(name);
      pauseSilent(name);
    }
    requestAnimationFrame(step);
  }

  return {
    /**
     * Must run from a user gesture. Starts the desired track in the same
     * call stack as the gesture so browsers do not block autoplay after await.
     */
    unlock() {
      if (unlocked) {
        // Already unlocked: make sure the intended track is actually audible.
        if (desired) startTrack(desired);
        return;
      }
      unlocked = true;
      const target = desired || "title";
      for (const key of Object.keys(tracks))
        relative[key] = key === target ? 1 : 0;
      syncVolumes();
      current = target;
      // Play the menu track immediately while still inside the gesture.
      startTrack(target);

      // Warm other tracks in the background (may fail; not required for BGM).
      for (const [name, audio] of Object.entries(tracks)) {
        if (name === target) continue;
        try {
          audio.muted = true;
          const warm = audio.play();
          if (warm && typeof warm.then === "function") {
            warm
              .then(() => {
                audio.pause();
                audio.muted = false;
                try {
                  audio.currentTime = 0;
                } catch (_) {}
              })
              .catch(() => {
                audio.muted = false;
              });
          } else {
            audio.muted = false;
          }
        } catch (_) {
          audio.muted = false;
        }
      }
    },
    isUnlocked() {
      return unlocked;
    },
    playTitle(fadeMs = 1200) {
      crossfadeTo("title", fadeMs);
    },
    playBackground(fadeMs = 900) {
      crossfadeTo("background", fadeMs);
    },
    playRace(fadeMs = 900) {
      crossfadeTo("race", fadeMs);
    },
    refreshVolume() {
      syncVolumes();
    },
    getDesired() {
      return desired;
    },
  };
}
