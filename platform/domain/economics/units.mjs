export const DAY_SECONDS = 86_400n;
export const U64_MAX = (1n << 64n) - 1n;

export function unsigned(value, name) {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new TypeError(`${name} must be a nonnegative bigint`);
  }
  return value;
}

export function tokenUnits(value, name) {
  unsigned(value, name);
  if (value > U64_MAX) throw new RangeError(`${name} exceeds u64`);
  return value;
}

export function indexInRange(value, name, start, end) {
  if (!Number.isInteger(value) || value < start || value > end) {
    throw new RangeError(`${name} must be an integer in [${start}, ${end}]`);
  }
  return value;
}

export function requireId(value, name) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value)) {
    throw new TypeError(`${name} must be a 1–128 character identifier`);
  }
  return value;
}
