function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch (_) {
    return null;
  }
}

/**
 * Wrap Web Storage so privacy modes, disabled storage, and quota failures do
 * not stop the game. Failed writes behave as a no-op; callers can still keep
 * using the in-memory game state.
 */
export function createSafeStorage(storage = null) {
  const target = resolveStorage(storage);
  return {
    getItem(key) {
      try {
        return target?.getItem(key) ?? null;
      } catch (_) {
        return null;
      }
    },
    setItem(key, value) {
      try {
        target?.setItem(key, value);
        return Boolean(target);
      } catch (_) {
        return false;
      }
    },
    removeItem(key) {
      try {
        target?.removeItem(key);
        return Boolean(target);
      } catch (_) {
        return false;
      }
    },
  };
}
