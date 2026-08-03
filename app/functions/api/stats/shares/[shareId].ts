import { handleStatsShareGet, type StatsSharesEnv } from "../../../_lib/statsShares.js";

export const onRequestGet: PagesFunction<StatsSharesEnv, "shareId"> = async (context) =>
  handleStatsShareGet(context);
