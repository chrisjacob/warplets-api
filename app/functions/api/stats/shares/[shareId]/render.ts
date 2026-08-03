import { handleStatsShareRender, type StatsSharesEnv } from "../../../../_lib/statsShares.js";

export const onRequestPost: PagesFunction<StatsSharesEnv, "shareId"> = async (context) =>
  handleStatsShareRender(context);
