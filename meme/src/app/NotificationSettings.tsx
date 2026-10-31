import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client";
type Settings = {
  enabled: number;
  voting: number;
  launch: number;
  rewards: number;
  milestones: number;
};
const defaults: Settings = {
  enabled: 0,
  voting: 1,
  launch: 1,
  rewards: 1,
  milestones: 0,
};
function readSettings(value: unknown, fid: number): Settings {
  if (!value || typeof value !== "object")
    throw Error("Invalid preferences response");
  const response = value as { viewerFid?: unknown; settings?: unknown };
  if (response.viewerFid !== fid)
    throw new ApiError("Account changed. Reconnect to continue.", 409);
  if (!response.settings || typeof response.settings !== "object")
    throw Error("Invalid preferences response");
  const settings = response.settings as Record<string, unknown>;
  if (
    Object.keys(defaults).some(
      (key) => settings[key] !== 0 && settings[key] !== 1,
    )
  )
    throw Error("Invalid preferences response");
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, settings[key]]),
  ) as Settings;
}
export default function NotificationSettings({
  fid,
  onReconnect,
}: {
  fid: number;
  onReconnect: () => void;
}) {
  const [settings, setSettings] = useState(defaults),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true),
    [accountChanged, setAccountChanged] = useState(false),
    [revision, setRevision] = useState(0);
  const mounted = useRef(false),
    mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setLoading(true);
    setSettings(defaults);
    setMessage("");
    void api(
      "/api/meme/notifications",
      undefined,
      "GET",
      controller.signal,
      fid,
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setSettings(readSettings(value, fid));
        setLoading(false);
        setAccountChanged(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (
          error instanceof ApiError &&
          [401, 403, 409].includes(error.status)
        ) {
          setSettings(defaults);
          setAccountChanged(true);
          setMessage("Account changed or expired. Reconnect to continue.");
        } else setMessage("Preferences unavailable.");
      });
    return () => {
      mounted.current = false;
      controller.abort();
      mutation.current?.abort();
    };
  }, [fid, revision]);
  async function change(
    key: "voting" | "launch" | "rewards" | "milestones",
    enabled: boolean,
  ) {
    if (busy || loading || accountChanged) return;
    const controller = new AbortController();
    mutation.current = controller;
    const next = { ...settings, enabled: 0, [key]: enabled ? 1 : 0 },
      previous = settings;
    setBusy(true);
    setMessage("");
    setSettings(next);
    try {
      const value = await api(
        "/api/meme/notifications",
        next,
        "POST",
        controller.signal,
        fid,
      );
      if (!mounted.current || controller.signal.aborted) return;
      setSettings(readSettings(value, fid));
      setMessage("Preferences saved.");
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setSettings(previous);
      if (error instanceof ApiError && [401, 403, 409].includes(error.status)) {
        setSettings(defaults);
        setAccountChanged(true);
        setMessage("Account changed or expired. Reconnect to continue.");
      } else setMessage("Couldn’t save preferences. Try again.");
    } finally {
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Notification preferences"
      aria-busy={loading && !message}
    >
      <p className="fine">
        Up to 3 updates a day. Available after mini-app registration.
      </p>
      {loading && !message && <p role="status">Loading preferences…</p>}
      <fieldset disabled={busy || loading || accountChanged}>
        <legend>Updates you want</legend>
        {(
          [
            ["voting", "Voting opens"],
            ["launch", "Launch confirmed"],
            ["rewards", "Rewards released"],
            ["milestones", "FDV milestones · all editions"],
          ] as const
        ).map(([key, label]) => (
          <label className="notification-choice" key={key}>
            <input
              type="checkbox"
              checked={settings[key] === 1}
              onChange={(event) => void change(key, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <button disabled>Enable notifications · not registered</button>
      <p className="fine">Farcaster or Base · separate opt-in.</p>
      <p role={accountChanged ? "alert" : "status"}>{message}</p>
      {accountChanged ? (
        <button onClick={onReconnect}>Reconnect</button>
      ) : loading && message ? (
        <button onClick={() => setRevision((n) => n + 1)}>
          Retry preferences
        </button>
      ) : null}
    </section>
  );
}
