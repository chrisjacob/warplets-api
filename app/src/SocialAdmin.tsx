import { SocialReasonDialog, SocialDropdown } from "./SocialUI";
import { useState } from "react";
import { DEFAULT_SOCIAL_CONFIG } from "../shared/social";
interface AdminState {
  config: typeof DEFAULT_SOCIAL_CONFIG;
  version: number;
  versions: Array<{ version: number; actor: string; created_at: number }>;
  reports: Array<{ id: string; post_id: string; text: string; reason: string }>;
  members: Array<{
    id: string;
    username: string;
    status: string;
    identities: string;
  }>;
  jobs: unknown[];
  audit: unknown[];
}
export default function SocialAdmin() {
  const [moderation, setModeration] = useState<{
    action: string;
    target?: string;
  } | null>(null);
  const [postAction, setPostAction] = useState("hide");
  const [token, setToken] = useState(""),
    [session, setSession] = useState(""),
    [nonce, setNonce] = useState(""),
    [code, setCode] = useState(""),
    [state, setState] = useState<AdminState | null>(null),
    [config, setConfig] = useState(
      JSON.stringify(DEFAULT_SOCIAL_CONFIG, null, 2),
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function api(body?: unknown) {
    const r = await fetch("/api/admin/social", {
      method: body ? "POST" : "GET",
      headers: {
        "x-admin-token": token,
        "x-admin-session": session,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await r.json()) as AdminState & {
      error?: string;
      multiplier?: number;
      ranking?: number;
    };
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  async function twoFactor(verify = false) {
    const response = await fetch(
      `/api/admin/2fa/${verify ? "verify" : "request"}`,
      {
        method: "POST",
        headers: { "x-admin-token": token, "content-type": "application/json" },
        body: JSON.stringify(verify ? { nonce, code } : {}),
      },
    );
    const data = (await response.json()) as {
      error?: string;
      nonce?: string;
      sessionToken?: string;
    };
    if (!response.ok)
      throw new Error(data.error || "Two-factor verification failed");
    if (verify && data.sessionToken) {
      setSession(data.sessionToken);
      setMessage("Verified. Load administration to continue.");
    } else {
      setNonce(data.nonce || "");
      setMessage("Enter the code sent to the configured admin email.");
    }
  }
  function updateNumber(
    group: "points" | "limits" | "boosts",
    key: string,
    value: number,
  ) {
    const next = JSON.parse(config);
    next[group][key] = value;
    setConfig(JSON.stringify(next, null, 2));
  }
  let parsedConfig: typeof DEFAULT_SOCIAL_CONFIG | null = null;
  try {
    parsedConfig = JSON.parse(config);
  } catch {
    /* Keep invalid JSON editable. */
  }
  async function load() {
    const data = (await api()) as AdminState;
    setState(data);
    setConfig(JSON.stringify(data.config, null, 2));
  }
  function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    void fn()
      .catch((e) => setMessage(e.message))
      .finally(() => setBusy(false));
  }
  function action(action: string, target?: string) {
    if (["hide", "suspend", "reverse-rewards"].includes(action)) {
      setModeration({ action, target });
      return;
    }
    run(async () => {
      await api({ action, target });
      await load();
      setMessage("Saved to the audit log.");
    });
  }
  return (
    <div className="social-admin">
      {moderation && (
        <SocialReasonDialog
          title="Moderation action"
          submitLabel="Save action"
          onClose={() => setModeration(null)}
          onSubmit={async (reason) => {
            await api({ ...moderation, reason });
            await load();
            setMessage("Saved to the audit log.");
          }}
        />
      )}
      <section className="social-panel">
        <span className="social-eyebrow">SOCIAL ADMINISTRATION</span>
        <h1>Rules & community</h1>
        <p className="social-muted">
          Use an existing admin key with the social:admin scope and a valid
          two-factor session. Credentials remain in memory only.
        </p>
        <label>
          Admin key
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="social-secondary"
          disabled={busy || !token}
          onClick={() => run(() => twoFactor())}
        >
          Send sign-in code
        </button>
        {nonce && (
          <label>
            Six-digit code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
            <button
              disabled={busy || code.length !== 6}
              onClick={() => run(() => twoFactor(true))}
            >
              Verify code
            </button>
          </label>
        )}
        <label>
          Admin session
          <input
            type="password"
            value={session}
            onChange={(e) => setSession(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="social-primary"
          disabled={busy}
          onClick={() => run(load)}
        >
          Load administration
        </button>
        {message && (
          <p role="status" className="social-notice">
            {message}
          </p>
        )}
      </section>
      {state && (
        <>
          <section className="social-panel">
            <h2>Reward configuration · v{state.version}</h2>
            <p className="social-muted">
              Changes apply to future awards. Existing ledger entries retain
              their original calculation. Asset thresholds are token quantities,
              not USD values.
            </p>
            {parsedConfig &&
              (["points", "limits", "boosts"] as const).map((group) => (
                <details key={group} open={group === "points"}>
                  <summary>
                    {group === "points"
                      ? "Points per action"
                      : group === "limits"
                        ? "Daily earning limits"
                        : "Multipliers and caps"}
                  </summary>
                  <div className="social-admin-fields">
                    {Object.entries(parsedConfig![group]).map(
                      ([key, value]) => (
                        <label key={key}>
                          {key.replace(/([A-Z])/g, " $1")}
                          <input
                            type="number"
                            min="0"
                            max={group === "boosts" ? 10 : 1000}
                            step={group === "limits" ? 1 : 0.25}
                            value={value}
                            onChange={(e) =>
                              updateNumber(group, key, Number(e.target.value))
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                </details>
              ))}
            <details>
              <summary>Advanced configuration and approved assets</summary>
              <textarea
                aria-label="Reward configuration JSON"
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              />
            </details>
            <button
              className="social-secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await api({
                    action: "preview",
                    config: JSON.parse(config),
                    evidence: {
                      connection: true,
                      context: true,
                      notifications: true,
                      signer: true,
                      follow: true,
                      email: true,
                      streak: 10,
                      warpletLevel: 10,
                      stonklets: 10,
                    },
                  });
                  setMessage(
                    `Fully qualified member: ${result.multiplier}× points, ${result.ranking}× ranking`,
                  );
                })
              }
            >
              Preview maximum
            </button>{" "}
            <button
              className="social-primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api({ action: "config", config: JSON.parse(config) });
                  await load();
                  setMessage("New configuration published.");
                })
              }
            >
              Publish configuration
            </button>
            <details>
              <summary>Version history</summary>
              {state.versions.map((v) => (
                <div className="social-admin-row" key={v.version}>
                  v{v.version} · {v.actor} ·{" "}
                  {new Date(v.created_at).toLocaleString()}{" "}
                  <button
                    onClick={() =>
                      run(async () => {
                        await api({ action: "restore", version: v.version });
                        await load();
                      })
                    }
                  >
                    Restore as new version
                  </button>
                </div>
              ))}
            </details>
          </section>
          <section className="social-panel">
            <h2>Ingestion</h2>
            <pre>{JSON.stringify(state.jobs, null, 2)}</pre>
            <button
              className="social-secondary"
              disabled={busy}
              onClick={() => action("ingest")}
            >
              Refresh submitted cast counts
            </button>
          </section>
          <section className="social-panel">
            <h2>Reports</h2>
            {state.reports.length ? (
              state.reports.map((r) => (
                <div key={r.id} className="social-admin-row">
                  <p>{r.text}</p>
                  <small>{r.reason}</small>
                  <div>
                    <button onClick={() => action("hide", r.post_id)}>
                      Hide
                    </button>
                    <button onClick={() => action("show", r.post_id)}>
                      Restore
                    </button>
                    <button
                      onClick={() => action("reverse-rewards", r.post_id)}
                    >
                      Reverse post rewards
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="social-muted">No reports.</p>
            )}
            <h2>Moderate any post</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                action(postAction, String(data.get("target")));
              }}
            >
              <input
                name="target"
                aria-label="Post ID"
                placeholder="Post ID"
                required
              />
              <SocialDropdown
                label="Moderation action"
                value={postAction}
                onChange={setPostAction}
                options={[
                  { value: "hide", label: "Hide" },
                  { value: "show", label: "Restore" },
                  { value: "reverse-rewards", label: "Reverse rewards" },
                ]}
              />
              <button className="social-secondary">Apply</button>
            </form>
          </section>
          <section className="social-panel">
            <h2>Members</h2>
            {state.members.map((m) => (
              <div className="social-admin-row" key={m.id}>
                <strong>{m.username}</strong>
                <small> · {m.status}</small>
                <p className="social-fine">{m.identities}</p>
                <button
                  onClick={() =>
                    action(
                      m.status === "active" ? "suspend" : "restore-member",
                      m.id,
                    )
                  }
                >
                  {m.status === "active"
                    ? "Suspend linked identities"
                    : "Restore member"}
                </button>
              </div>
            ))}
          </section>
          <section className="social-panel">
            <h2>Audit history</h2>
            <pre>{JSON.stringify(state.audit, null, 2)}</pre>
          </section>
        </>
      )}
    </div>
  );
}
