/** Simulations never invoke a wallet, RPC, notification provider or social composer. */
import { useState, useEffect, useRef } from "react";
import { qaContext } from "./qaMode";
import { qaRequest } from "./QAWorkbench";
export function QAClaims({
  onChanged,
}: {
  onChanged?: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<
      {
        allocationId: string;
        symbol: string;
        amount: string;
        releaseAt: number;
        funded: number;
        claimed: number;
      }[]
    >([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const retry = useRef<{ path: string; body: Record<string, unknown> } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void qaRequest("claimable")
      .then((data) => {
        if (active) setItems(data.items);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const eligible = items.filter(
    (e) =>
      e.funded &&
      !e.claimed &&
      Math.ceil(e.releaseAt / 1000) * 1000 + 1000 <= (qaContext?.clock ?? 0),
  );
  async function claim(allocationId?: string) {
    setBusy(true);
    setMessage("");
    const path = allocationId ? "claim" : "claim-all";
    retry.current ??= {
      path: "actions/" + path,
      body: {
        key: crypto.randomUUID(),
        ...(allocationId ? { allocationId } : {}),
      },
    };
    try {
      const result = await qaRequest(retry.current.path, retry.current.body);
      setMessage(result.claimed + " allocations claimed locally.");
      retry.current = null;
      setItems((await qaRequest("claimable")).items);
      await onChanged?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="qa-actions">
      <p className="fine">
        {eligible.length} funded, released demo allocations available.
      </p>
      <div className="qa-buttons">
        <button
          disabled={busy || !eligible.length}
          onClick={() => void claim()}
        >
          Simulate claim all
        </button>
        <button
          disabled={busy || !eligible.length}
          onClick={() => void claim(eligible[0]?.allocationId)}
        >
          Simulate one claim
        </button>
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
export default function QATrade({
  marketId,
  symbol,
}: {
  marketId: string;
  symbol: string;
}) {
  const [quantity, setQuantity] = useState("10000"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const retry = useRef<Record<string, unknown> | null>(null);
  async function trade(side: string) {
    setBusy(true);
    setMessage("");
    retry.current ??= {
      key: crypto.randomUUID(),
      side,
      marketId,
      quantity: Number(quantity),
    };
    try {
      await qaRequest("actions/trade", retry.current);
      retry.current = null;
      setMessage("Trade simulated. Rankings updated.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="qa-actions">
      <summary>Simulate trading {symbol}</summary>
      <label>
        Whole tokens
        <input
          aria-label="Demo token quantity"
          type="number"
          min="1"
          max="1000000"
          value={quantity}
          disabled={busy || !!retry.current}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>
      <p className="fine">
        Synthetic prices · 0.3% + $0.01 demo fee. No signing or broadcast.
      </p>
      <div className="qa-buttons">
        <button
          disabled={busy || !qaContext?.person}
          onClick={() => void trade("buy")}
        >
          Simulate buy
        </button>
        <button
          disabled={busy || !qaContext?.person}
          onClick={() => void trade("sell")}
        >
          Simulate sell
        </button>
        {retry.current && (
          <button
            onClick={() => {
              retry.current = null;
              setMessage("");
            }}
          >
            Discard retry
          </button>
        )}
      </div>
      <p role="status">{message}</p>
    </details>
  );
}
