import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TradeSampleCell, nativeQuote } from "./TradeSample";
import { reviewTradeSample, unavailableTradeSample } from "../../../discovery/src/trade-sample";
import { acquisitionInput, acquisitionWallet } from "../../../discovery/src/holder-acquisition-fixtures.test-helper";
import { holderHistoryFixture } from "../../../discovery/src/holder-history-fixtures.test-helper";
import { participationTrade } from "../../../discovery/src/holder-participation-fixtures.test-helper";

it("formats native quantities exactly, preserving zero and unknown separately", () => {
  expect(nativeQuote(null)).toBe("Unknown"); expect(nativeQuote("0")).toBe("0 SOL"); expect(nativeQuote("10000000")).toBe("0.01 SOL");
  expect(nativeQuote("18014398509481986")).toBe("18014398.509481986 SOL");
});
it("shows supported breadth and quantities with explicit sample boundaries and no wash or score claim", async () => {
  const report = await reviewTradeSample(await acquisitionInput(await holderHistoryFixture(), await acquisitionWallet([await participationTrade({ time: "2026-10-21T09:00:00Z" })])));
  const html = renderToStaticMarkup(<TradeSampleCell report={report} minutes={5} />);
  for (const text of ["1 buyers / 0 sellers", "1 buy / 0 sell instructions", "0.01 SOL", "Largest equal known quote group", "fresh", "1 matched finalized", "not verified independent participants", "do not prove wash trading", "not the current time", "Policy checksum:", "No population"]) expect(html).toContain(text);
  expect(html).not.toContain("<button"); expect(html).not.toContain("$0");
});
it("distinguishes missing, rejected, simulation and held intervals without fabricated zero flow", async () => {
  const inputs = await acquisitionInput(await holderHistoryFixture(), await acquisitionWallet([await participationTrade({ time: "2026-10-21T09:00:00Z" })]));
  const wallet = inputs.wallet!.evidence as Awaited<ReturnType<typeof acquisitionWallet>>; wallet.histories = [];
  const held = await reviewTradeSample(await acquisitionInput(inputs.history, wallet));
  expect(renderToStaticMarkup(<TradeSampleCell report={held} minutes={5} />)).toContain("Unknown · held");
  const address = inputs.history.address, at = new Date(inputs.history.cutoff_at);
  expect(renderToStaticMarkup(<TradeSampleCell report={await unavailableTradeSample(address, at, "simulation", "synthetic")} minutes={5} />)).toContain("Simulation");
  expect(renderToStaticMarkup(<TradeSampleCell report={await unavailableTradeSample(address, at, "rejected", "corrupt")} minutes={5} />)).toContain("rejected");
  expect(renderToStaticMarkup(<TradeSampleCell report={undefined} minutes={5} />)).toContain("Unknown");
});
