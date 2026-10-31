export const ADMIN_ACTION_SCOPES = {
  "draft.save": "meme:rounds",
  "round.publish": "meme:rounds",
  "round.outcome": "meme:rounds",
  "control.set": "meme:ops",
  "job.retry": "meme:ops",
  "metrics.refresh": "meme:ops",
  "gmgn.refresh": "meme:rounds",
  "social.save": "meme:comms",
  "social.approve": "meme:comms",
  "social.open": "meme:comms",
  "comms.pause": "meme:comms",
  "comms.refresh": "meme:comms",
  "milestone.save": "meme:comms",
  "launch.prepare": "meme:launch",
  "launch.simulate": "meme:launch",
  "launch.handoff": "meme:launch",
  "launch.reconcile": "meme:launch",
} as const;
export type AdminAction = keyof typeof ADMIN_ACTION_SCOPES;
export type AdminSection = "overview" | "performance" | "comms" | "health";
export interface AdminActor {
  id: string;
  scopes: readonly string[];
}
export interface AdminCommand {
  id: string;
  action: AdminAction;
  expectedVersion: number;
  reason: string;
  payload: Record<string, unknown>;
}
export interface AdminQuery {
  section: AdminSection;
  date?: string;
  range?: "day" | "previous" | "30d" | "overall";
}
export type AdminReply =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string };
export interface MemeAdminBinding {
  read(query: AdminQuery, actor: AdminActor): Promise<AdminReply>;
  command(command: AdminCommand, actor: AdminActor): Promise<AdminReply>;
}
export interface AdminCandidate {
  name: string;
  symbol: string;
  ogMint: string;
  origin: "manual" | "gmgn";
  reviewed: boolean;
  snapshotId?: string;
}
export function commandScope(action: unknown) {
  return typeof action === "string" &&
    Object.prototype.hasOwnProperty.call(ADMIN_ACTION_SCOPES, action)
    ? ADMIN_ACTION_SCOPES[action as AdminAction]
    : null;
}
