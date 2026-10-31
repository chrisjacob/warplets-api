import { WorkerEntrypoint } from "cloudflare:workers";
import {
  adminRead,
  adminCommand,
  adminReply,
  type AdminOptions,
} from "./admin";
import type {
  AdminActor,
  AdminQuery,
  AdminCommand,
} from "../shared/adminContracts";
export { default } from "./index";
/** Reachable through an explicitly configured private service binding only. */
export class MemeAdmin extends WorkerEntrypoint<Env> {
  #options(): AdminOptions {
    const key: unknown = Reflect.get(this.env, "GMGN_API_KEY"),
      origin: unknown = Reflect.get(this.env, "MEME_PUBLIC_ORIGIN");
    return {
      environment:
        this.env.LOCAL_PREVIEW_ONLY === "true" ? "local" : "production",
      ...(typeof key === "string" && key.trim() ? { gmgnKey: key } : {}),
      ...(typeof origin === "string" && origin ? { publicOrigin: origin } : {}),
    };
  }
  async read(query: AdminQuery, actor: AdminActor) {
    return adminReply(() =>
      adminRead(this.env.MEME_DB, query, actor, this.#options()),
    );
  }
  async command(command: AdminCommand, actor: AdminActor) {
    return adminReply(() =>
      adminCommand(this.env.MEME_DB, command, actor, this.#options()),
    );
  }
}
