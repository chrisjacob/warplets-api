import {
  calculateBoost,
  validateSocialConfig,
  type BoostEvidence,
} from "../../../shared/social.js";
import {
  FAMILY,
  socialConfig,
  SocialError,
  type SocialEnv,
} from "../../_lib/socialStore.js";
import { ingestSocial } from "../../_lib/socialIngestion.js";
import {
  jsonSecure,
  readJsonBodyWithLimit,
  requireAdminScope,
} from "../../_lib/security.js";
import { requireSameOrigin } from "../../_lib/authValidation.js";

export const onRequest: PagesFunction<SocialEnv> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "social:admin" });
  if (!auth.ok) return auth.response;
  const db = context.env.WARPLETS;
  try {
    if (context.request.method === "GET") {
      const [current, versions, reports, members, jobs, audit] =
        await Promise.all([
          socialConfig(db),
          db
            .prepare(
              "SELECT version,actor,created_at FROM social_config ORDER BY version DESC LIMIT 30",
            )
            .all(),
          db
            .prepare(
              "SELECT r.*,p.text FROM social_reports r JOIN social_posts p ON p.id=r.post_id ORDER BY r.created_at DESC LIMIT 100",
            )
            .all(),
          db
            .prepare(
              "SELECT m.*,GROUP_CONCAT(i.identity) AS identities FROM social_members m LEFT JOIN social_identities i ON i.member_id=m.id GROUP BY m.id ORDER BY m.created_at DESC LIMIT 100",
            )
            .all(),
          db.prepare("SELECT * FROM social_jobs").all(),
          db
            .prepare(
              "SELECT * FROM social_audit ORDER BY created_at DESC LIMIT 50",
            )
            .all(),
        ]);
      return jsonSecure({
        ...current,
        versions: versions.results,
        reports: reports.results,
        members: members.results,
        jobs: jobs.results,
        audit: audit.results,
      });
    }
    if (context.request.method !== "POST")
      return jsonSecure({ error: "Method not allowed" }, { status: 405 });
    const origin = requireSameOrigin(context.request);
    if (origin) return origin;
    const parsed = await readJsonBodyWithLimit<Record<string, unknown>>(
      context.request,
      32_768,
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;
    if (!body || typeof body !== "object")
      throw new SocialError("Invalid request");
    const action = String(body.action),
      target = String(body.target ?? "");
    const log = db
      .prepare(
        "INSERT INTO social_audit(id,actor,action,target,details,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        auth.keyId,
        action,
        target,
        JSON.stringify({
          reason: body.reason ?? null,
          version: body.version ?? null,
        }),
        Date.now(),
      );
    if (action === "preview") {
      const config = validateSocialConfig(body.config);
      const input = body.evidence as Partial<BoostEvidence> | undefined;
      const evidence: BoostEvidence = {
        connection: input?.connection === true,
        context: input?.context === true,
        notifications: input?.notifications === true,
        signer: input?.signer === true,
        follow: input?.follow === true,
        email: input?.email === true,
        streak: Math.max(0, Number(input?.streak) || 0),
        warpletLevel: Math.max(0, Number(input?.warpletLevel) || 0),
        stonklets: Math.max(0, Number(input?.stonklets) || 0),
      };
      return jsonSecure(calculateBoost(config, evidence));
    }
    if (action === "config" || action === "restore") {
      let input = body.config;
      if (action === "restore") {
        const old = await db
          .prepare("SELECT config_json FROM social_config WHERE version=?")
          .bind(Number(body.version))
          .first<{ config_json: string }>();
        if (!old) throw new SocialError("Version not found", 404);
        input = JSON.parse(old.config_json);
      }
      const config = validateSocialConfig(input);
      await db.batch([
        db
          .prepare(
            "INSERT INTO social_config(config_json,actor,created_at) VALUES(?,?,?)",
          )
          .bind(JSON.stringify(config), auth.keyId, Date.now()),
        log,
      ]);
      return jsonSecure(await socialConfig(db));
    }
    if (action === "ingest") {
      await log.run();
      return jsonSecure(await ingestSocial(context.env, true));
    }
    if (!target || target.length > 100)
      throw new SocialError("Choose a target");
    if (action === "hide" || action === "show")
      await db.batch([
        db
          .prepare(
            "UPDATE social_posts SET status=? WHERE id=? AND status!='deleted'",
          )
          .bind(action === "hide" ? "hidden" : "visible", target),
        log,
      ]);
    else if (action === "suspend" || action === "restore-member")
      await db.batch([
        db
          .prepare(
            "UPDATE social_members SET status=? WHERE group_id=(SELECT group_id FROM social_members WHERE id=?)",
          )
          .bind(action === "suspend" ? "suspended" : "active", target),
        log,
      ]);
    else if (action === "reverse-rewards") {
      if (typeof body.reason !== "string" || body.reason.trim().length < 3)
        throw new SocialError("A correction reason is required");
      await db.batch([
        db
          .prepare(
            `INSERT OR IGNORE INTO social_rewards(id,member_id,event_key,action,post_id,day,base,multiplier,points,config_version,evidence_json,created_at)
        SELECT 'reverse:'||id,member_id,'reverse:'||id,'correction',post_id,day,-base,multiplier,-points,config_version,?,? FROM social_rewards WHERE post_id=? AND action!='correction' AND points>0`,
          )
          .bind(
            JSON.stringify({ reason: body.reason, actor: auth.keyId }),
            Date.now(),
            target,
          ),
        log,
      ]);
    } else throw new SocialError("Unknown admin action");
    return jsonSecure({ ok: true });
  } catch (error) {
    return jsonSecure(
      {
        error: error instanceof Error ? error.message : "Administration failed",
      },
      { status: error instanceof SocialError ? error.status : 400 },
    );
  }
};
