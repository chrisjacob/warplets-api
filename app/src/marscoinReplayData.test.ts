import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import data from "./marscoinReplayData.json";
import { MARS_LAUNCH_PRICE, marsLaunchGain, marsAxisCeiling } from "./MarscoinReplay";

const source = JSON.parse(readFileSync(new URL("../../docs/marscoin-daily-pool-source.json", import.meta.url), "utf8"));
const metadata = JSON.parse(readFileSync(new URL("../../docs/marscoin-metadata-source.json", import.meta.url), "utf8"));
it("replays exactly the first 41 daily closes without substituting an intraday peak", () => {
  expect(source.response.meta.base.address.toLowerCase()).toBe("0xfe189e97832da1573e4e4ff034f4ffc3a15c7777");
  expect(data).toHaveLength(41);
  for (const [index, point] of data.entries()) {
    const candle = source.response.data.attributes.ohlcv_list.find((row: number[]) => row[0]! + 86399 === point.time);
    expect(candle?.[4]).toBe(point.price);
    if (index) expect(point.time - data[index - 1]!.time).toBe(86400);
  }
  expect(new Date(data[0]!.time * 1000).toISOString().slice(0, 10)).toBe("2026-07-27");
  expect(new Date(data.at(-1)!.time * 1000).toISOString().slice(0, 10)).toBe("2026-09-05");
  expect(metadata.response.market_data.circulating_supply).toBe(1_000_000_000);
  expect(data.some((point, index) => index > 0 && point.price < data[index - 1]!.price)).toBe(true);
});
it("uses the original pool open for gross launch gain and expands the axis from $10M", () => {
  const launch = source.response.data.attributes.ohlcv_list.find((row: number[]) => row[0]! + 86399 === data[0]!.time);
  expect(MARS_LAUNCH_PRICE).toBe(launch[1]);
  expect(marsLaunchGain(MARS_LAUNCH_PRICE)).toBe(0);
  expect(marsLaunchGain(MARS_LAUNCH_PRICE * 2)).toBe(100);
  expect(marsAxisCeiling(data[0]!.price * 1e9)).toBe(10e6);
  expect(marsAxisCeiling(60e6)).toBe(100e6);
  expect(marsAxisCeiling(240e6)).toBe(300e6);
});
