import { handleStatsMarketGet, type StatsEnv } from "../../_lib/stats.js";

export const onRequestGet: PagesFunction<StatsEnv> = async (context) =>
  handleStatsMarketGet(context);
