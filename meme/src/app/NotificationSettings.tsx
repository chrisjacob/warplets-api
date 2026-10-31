import { useEffect, useState } from "react";
import { api } from "./client";
export default function NotificationSettings({ fid }: { fid: number }) {
  const [settings, setSettings] = useState({
      enabled: 0,
      voting: 1,
      launch: 1,
      rewards: 1,
      milestones: 0,
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setMessage("");
    void api("/api/meme/notifications", undefined, "GET", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setSettings((value as { settings: typeof settings }).settings);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Preferences unavailable.");
      });
    return () => controller.abort();
  }, [fid, revision]);
  async function change(
    key: "voting" | "launch" | "rewards" | "milestones",
    enabled: boolean,
  ) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const next = { ...settings, enabled: 0, [key]: enabled ? 1 : 0 };
    const previous = settings;
    setSettings(next);
    try {
      await api("/api/meme/notifications", next);
      setSettings(next);
      setMessage("Preferences saved.");
    } catch (e) {
      setSettings(previous);
      setMessage(e instanceof Error ? e.message : "Couldn’t save preferences.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card">
      <summary>Notifications</summary>
      <p className="fine">
        Up to 3 updates a day. Available after mini-app registration.
      </p>
      <fieldset disabled={busy || loading}>
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
              onChange={(e) => void change(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <button disabled>Enable notifications · not registered</button>
      <p className="fine">Farcaster or Base · separate opt-in.</p>
      <p role="status">{message}</p>
      {loading && message && (
        <button onClick={() => setRevision((n) => n + 1)}>
          Retry preferences
        </button>
      )}
    </details>
  );
}
