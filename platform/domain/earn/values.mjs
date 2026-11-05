export const DAY_MS = 86_400_000;
export const MIN_STAKE_MICRO_USD = 10_000_000n;

export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function units(value, name) {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new RangeError(`${name} must be a non-negative bigint`);
  }
  return value;
}

export function id(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be a non-empty identifier`);
  }
  return value;
}

export function epochAt(timestampMs) {
  return Math.floor(integer(timestampMs, 'timestampMs') / DAY_MS);
}

export function compareIds(a, b) {
  // Locale-independent across browsers, Node and Workers.
  return a < b ? -1 : a > b ? 1 : 0;
}
