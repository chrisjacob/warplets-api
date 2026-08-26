import {
  handleStatsShareImageGet,
  handleStatsShareImageHead,
  type StatsSharesEnv,
} from "../../../_lib/statsShares.js";

export const onRequestGet: PagesFunction<StatsSharesEnv, "shareId"> = async (context) =>
  handleStatsShareImageGet(context);

export const onRequestHead: PagesFunction<StatsSharesEnv, "shareId"> = async (context) =>
  handleStatsShareImageHead(context);
