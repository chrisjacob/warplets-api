import { handleStatsShareCreate, type StatsSharesEnv } from "../../_lib/statsShares.js";

export const onRequestPost: PagesFunction<StatsSharesEnv> = async (context) =>
  handleStatsShareCreate(context);
