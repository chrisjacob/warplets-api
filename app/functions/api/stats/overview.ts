import { handleStatsOverviewGet, type StatsEnv } from "../../_lib/stats.js";

export const onRequestGet: PagesFunction<StatsEnv> = async (context) =>
  handleStatsOverviewGet(context);
