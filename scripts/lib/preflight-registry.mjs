const registry = new Map();

export function registerPreflight(source, fn) {
  if (typeof fn !== 'function') throw new TypeError(`preflight for ${source} must be a function`);
  registry.set(source, fn);
}

export async function runPreflight(source) {
  const fn = registry.get(source);
  if (!fn) return { ran: false, source };
  try {
    const result = await fn();
    return { ran: true, source, result };
  } catch (err) {
    return { ran: true, source, error: err.message || String(err) };
  }
}

export function listPreflights() {
  return [...registry.keys()];
}
