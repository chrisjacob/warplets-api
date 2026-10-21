import type { SourcePilotReadiness } from "../../../discovery/src/source-pilot-readiness";

export function SourcePilotPanel({ data, error = "" }: { data: SourcePilotReadiness | null; error?: string }) {
  return <section className="tenx-panel" id="source-pilot">
    <h2>Jupiter &amp; GeckoTerminal pilot</h2>
    {error && <p role="alert">Source pilot status could not refresh. {data ? "The last response remains visible." : "Live collection status is unavailable."}</p>}
    {data ? <>
      <p><strong>Offline preparation · new collection is held.</strong> Request plans, response validation and replay are ready for local file review. This pilot makes zero provider requests and does not change token scores or evidence gates.</p>
      <ul>{data.providers.map(provider => <li key={provider.id}><strong>{provider.id === "jupiter" ? "Jupiter Tokens V2" : "GeckoTerminal public API"}</strong>: {provider.data}.<p>{provider.rights}. {provider.access}.</p></li>)}</ul>
      <details><summary>What remains before collection</summary>
        <p>Confirm permitted use, retention and Free endpoint access, collect real response fixtures, then bind canonical pools and connect collection. There is no activation control or paid fallback in this build.</p>
        {data.prepared_collection && <p>Atomic shared-budget reservations, bounded read-only transport and sampled-trade review are implemented and tested. They are not connected to live collection. Each HTTP attempt uses one shared slot; failures count too.</p>}
        <p>Proposed pilot limit: at most {data.future_admission.market_daily_subset} market calls/day inside the existing allowance. Research shares {data.future_admission.shared_research_records} records / {data.future_admission.shared_research_bytes / 1_000_000} MB per day across all models and comparisons. No capacity is reserved by this view.</p>
        <p>Local reviews allow up to {data.limits.mints} mints per Jupiter batch and {data.limits.candles} closed one-minute candles per GeckoTerminal file. Synthetic examples and file checks do not authenticate a source, establish wash trading or reconstruct opening market cap.</p>
      </details>
      <p className="tenx-muted">Existing price and on-chain collection retain their normal settings. This panel reads the local status response only.</p>
    </> : !error && <p role="status">Pilot readiness has not been reported by the local service.</p>}
  </section>;
}
