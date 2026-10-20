import { instructions, TOKEN, WSOL } from "./pump";
import { Reader } from "./solana";
import { keys, signer, type WalletTransaction } from "./wallet-rpc";
type Ix = ReturnType<typeof instructions>[number];
const before = (a: Ix, b: Ix) => a.top < b.top || a.top === b.top && a.inner !== null && b.inner !== null && a.inner < b.inner;

// For a successfully finalized transaction already validated by the caller.
// Zero pre/post balances alone never establish transient account ownership.
export function temporaryWsolOwner(tx: WalletTransaction, account: string, wallet: string, trade: Ix): boolean {
  const index = keys(tx).indexOf(account), meta = tx.meta;
  if (index < 0 || !meta || meta.err !== null || !signer(tx, wallet) || meta.preBalances[index] !== 0 || meta.postBalances[index] !== 0 || [...meta.preTokenBalances, ...meta.postTokenBalances].some(b => b.accountIndex === index)) return false;
  const ops = instructions(tx).filter(ix => ix.program === TOKEN && ix.accounts[0] === account);
  if (ops.some(ix => ix.data[0] === 6)) return false; // No owner/close-authority changes.
  const initializers = ops.filter(ix => [1, 16, 18].includes(ix.data[0]!)), closes = ops.filter(ix => ix.data[0] === 9);
  if (initializers.length !== 1 || closes.length !== 1) return false;
  const init = initializers[0]!, close = closes[0]!;
  if (init.accounts[1] !== WSOL || !before(init, trade) || !before(trade, close) || close.data.length !== 1 || close.accounts[1] !== wallet || close.accounts[2] !== wallet) return false;
  if (init.data[0] === 1) return init.data.length === 1 && init.accounts[2] === wallet;
  return init.data.length === 33 && new Reader(init.data, 1).key() === wallet;
}
