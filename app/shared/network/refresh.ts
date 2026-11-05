// Existing member records rotate monthly; missing records remain immediately
// eligible so daily discovery does not wait behind a new monthly cycle.
export const NETWORK_RECORD_REFRESH_HOURS = 30 * 24;
export const NETWORK_RECORD_REFRESH_MS = NETWORK_RECORD_REFRESH_HOURS * 3_600_000;
