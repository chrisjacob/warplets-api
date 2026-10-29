import { NETWORK_ACCEPTANCE_TOPIC, NETWORK_CONTRACT, NETWORK_TRANSFER_TOPIC } from '../../../shared/network/model';

export interface AcceptanceEvent { tx: string; logIndex: number; block: number; blockHash: string; at: number; fid: number; recipient: string }
interface Log { address: string; topics: string[]; data: string; blockNumber: string; blockHash: string; blockTimestamp?: string; transactionHash: string; logIndex: string; removed?: boolean }
const WORD = /^0x[0-9a-f]{64}$/i, HASH = WORD;
export function decodeAcceptanceLogs(input: unknown): { events: AcceptanceEvent[]; missingTimestamps: number[] } {
  if (!Array.isArray(input) || input.length > 5000) throw new Error('Invalid event response');
  const logs = input as Log[], events: AcceptanceEvent[] = [], missing = new Set<number>();
  for (const log of logs) {
    if (log.removed || log.address?.toLowerCase() !== NETWORK_CONTRACT || log.topics?.[0]?.toLowerCase() !== NETWORK_ACCEPTANCE_TOPIC) continue;
    if (log.topics.length !== 3 || !log.topics.slice(1).every(t => WORD.test(t)) || log.data !== '0x' || !HASH.test(log.transactionHash) || !HASH.test(log.blockHash)) throw new Error('Invalid acceptance event');
    if (!/^0x0{24}[a-f0-9]{40}$/i.test(log.topics[2])) throw new Error('Invalid recipient topic');
    const fid = Number(BigInt(log.topics[1])), block = Number(BigInt(log.blockNumber)), logIndex = Number(BigInt(log.logIndex));
    if (![fid, block, logIndex].every(Number.isSafeInteger) || fid < 1 || block < 0 || logIndex < 0) throw new Error('Invalid event integers');
    const recipient = `0x${log.topics[2].slice(-40)}`.toLowerCase();
    // Pair with the original mint in the SAME receipt, never a later transfer.
    const mint = logs.find(m => !m.removed && m.address?.toLowerCase() === NETWORK_CONTRACT && m.transactionHash?.toLowerCase() === log.transactionHash.toLowerCase() && m.blockHash?.toLowerCase() === log.blockHash.toLowerCase()
      && m.topics?.length === 4 && m.topics[0].toLowerCase() === NETWORK_TRANSFER_TOPIC && /^0x0{64}$/.test(m.topics[1])
      && m.topics[2].toLowerCase() === log.topics[2].toLowerCase() && m.topics[3].toLowerCase() === log.topics[1].toLowerCase());
    if (!mint) throw new Error('Acceptance has no matching original mint');
    const at = log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) * 1000 : 0;
    if (at && !Number.isSafeInteger(at)) throw new Error('Invalid event timestamp');
    if (!at) missing.add(block);
    events.push({ tx: log.transactionHash.toLowerCase(), logIndex, block, blockHash: log.blockHash.toLowerCase(), at, fid, recipient });
  }
  return { events, missingTimestamps: [...missing] };
}

export async function networkFetchJson(url: string, init: RequestInit = {}, maxBytes = 2_000_000): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    headers: { 'user-agent': 'Mozilla/5.0', ...init.headers } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Network source HTTP ${response.status}`); }
  if (!response.body) throw new Error('Empty source response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > maxBytes) throw new Error('Source response too large'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
