import { z } from "zod";
import { Address } from "./model";
import { GmgnTraderSourceId } from "./gmgn-receipt-id";

const Time = z.string().datetime();
export const GmgnCandleSeriesSchema = z.object({ id: z.uuid(), start_at: Time, end_at: Time, part: z.number().int().min(0).max(3) }).strict()
  .refine(v => Date.parse(v.end_at) - Date.parse(v.start_at) === 21_600_000 && Date.parse(v.start_at) % 60_000 === 0, "gmgn_series_six_closed_hours");
export function gmgnCandlePart(series: z.infer<typeof GmgnCandleSeriesSchema>) {
  const start = Date.parse(series.start_at) + Math.min(series.part * 100, 260) * 60_000;
  return { start_at: new Date(start).toISOString(), end_at: new Date(Math.min(start + 6_000_000, Date.parse(series.end_at))).toISOString() };
}
export const GmgnRequestSchema = z.union([
  z.object({kind:z.literal("gmgn_wallet_activity"),address:Address,wallet:Address,selection_id:GmgnTraderSourceId,selection_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({ kind: z.enum(["gmgn_token_info", "gmgn_token_security", "gmgn_token_pool", "gmgn_token_traders"]), address: Address }).strict(),
  z.object({ kind: z.literal("gmgn_token_candles"), address: Address, start_at: Time, end_at: Time, series: GmgnCandleSeriesSchema.optional() }).strict()
    .refine(v => Date.parse(v.end_at) > Date.parse(v.start_at) && Date.parse(v.end_at) - Date.parse(v.start_at) <= 21_600_000 &&
      Date.parse(v.start_at) % 60_000 === 0 && Date.parse(v.end_at) % 60_000 === 0, "gmgn_closed_six_hour_window_required")
    .refine(v => !v.series || v.start_at === gmgnCandlePart(v.series).start_at && v.end_at === gmgnCandlePart(v.series).end_at, "gmgn_series_part_mismatch"),
]);
export type GmgnRequest = z.infer<typeof GmgnRequestSchema>;
export function gmgnDescriptor(raw: unknown, now: Date) {
  const request = GmgnRequestSchema.parse(raw);
  const paths = { gmgn_token_info: "/v1/token/info", gmgn_token_security: "/v1/token/security", gmgn_token_pool: "/v1/token/pool_info", gmgn_token_candles: "/v1/market/token_kline", gmgn_token_traders: "/v1/market/token_top_traders",gmgn_wallet_activity:"/v1/user/wallet_activity" };
  const url = new URL(paths[request.kind], "https://openapi.gmgn.ai");
  url.searchParams.set("chain", "sol"); url.searchParams.set("address", request.address);
  if(request.kind==="gmgn_wallet_activity"){
    url.searchParams.delete("address");url.searchParams.set("wallet_address",request.wallet);url.searchParams.set("token_address",request.address);url.searchParams.set("limit","20");
  }
  if(request.kind==="gmgn_token_traders"){
    url.searchParams.set("limit","100");url.searchParams.set("order_by","buy_volume_cur");url.searchParams.set("direction","desc");
  }
  if (request.kind === "gmgn_token_candles") {
    if (Date.parse(request.series?.end_at ?? request.end_at) > Math.floor(now.getTime() / 60_000) * 60_000) throw new Error("gmgn_open_candle_window");
    // The official CLI converts its seconds arguments to milliseconds for HTTP.
    url.searchParams.set("resolution", "1m");
    url.searchParams.set("from", String(Date.parse(request.start_at)));
    // Our end is exclusive. Do not ask an inclusive provider for the currently
    // opening minute at end_at and then mistake it for a closed observation.
    url.searchParams.set("to", String(Date.parse(request.end_at) - 1));
  }
  return { request, provider: "gmgn" as const, url: url.href, method: "GET" as const,
    headers: { Accept: "application/json" }, weight: request.kind === "gmgn_token_traders" ? 5 : request.kind === "gmgn_wallet_activity" ? 3 : request.kind === "gmgn_token_candles" ? 2 : 1 };
}
export function gmgnEnvelope(raw: unknown) {
  const envelope = z.object({ code: z.union([z.number(), z.string()]), data: z.unknown() }).parse(raw);
  if (envelope.code !== 0 && envelope.code !== "0") throw new Error("gmgn_application_error");
  if (envelope.data === null || envelope.data === undefined) throw new Error("gmgn_empty_data");
  return envelope.data;
}
