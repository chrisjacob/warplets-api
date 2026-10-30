/** Outages reduce local read pressure; successful refreshes restore the normal cadence. */
export function pollDelay(failures: number) {
  if (!Number.isSafeInteger(failures) || failures < 0)
    throw Error("Invalid retry count");
  return Math.min(120000, 15000 * 2 ** Math.min(failures, 3));
}
