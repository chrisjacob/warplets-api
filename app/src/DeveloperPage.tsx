import { useEffect, useState } from "react";

interface Credential {
  id: string;
  name: string;
  scopes_json: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const SCOPES = ["favourites:read", "favourites:write", "alerts:read", "alerts:write", "stats:shares"];

export default function DeveloperPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selected, setSelected] = useState(SCOPES);
  const [name, setName] = useState("My 10X integration");
  const [newToken, setNewToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch("/api/developer-tokens", { credentials: "same-origin" });
    const payload = await response.json() as { credentials?: Credential[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Developer credentials could not be loaded.");
    setCredentials(payload.credentials ?? []);
  };

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/developer-tokens", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, scopes: selected }),
      });
      const payload = await response.json() as { token?: string; error?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error || "Token creation failed.");
      setNewToken(payload.token);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/developer-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    await load();
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="text-sm font-bold text-[#00FF00]">← Back to Search</a>
        <h1 className="mt-5 text-3xl font-black text-[#00FF00]">Developer API</h1>
        <p className="mt-2 text-sm leading-6 text-[#b7ffb7]">Create revocable, least-privilege tokens for the 10X Agent API and MCP server. Farcaster identity and wallet signing are separate: connect and verify your wallet in Search before creating API tokens.</p>

        <section className="mt-6 rounded-2xl border border-[#00FF00]/40 bg-[#001000] p-4">
          <label className="block text-sm font-bold text-[#00FF00]">Token name
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-lg border border-[#00FF00]/50 bg-black px-3 py-2 text-white" />
          </label>
          <fieldset className="mt-4"><legend className="text-sm font-bold text-[#00FF00]">Scopes</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-[#b7ffb7]"><input type="checkbox" checked={selected.includes(scope)} onChange={() => setSelected((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])} />{scope}</label>
            ))}</div>
          </fieldset>
          <button type="button" disabled={busy || !selected.length} onClick={() => void create()} className="mt-5 rounded-lg bg-[#00FF00] px-4 py-2 font-black text-[#003800] disabled:opacity-50">Create token</button>
        </section>

        {newToken && <section className="mt-4 rounded-2xl border border-amber-400 bg-amber-950/30 p-4"><h2 className="font-black text-amber-300">Copy this token now</h2><p className="mt-1 text-xs text-amber-100">It cannot be retrieved again.</p><code className="mt-3 block break-all rounded bg-black p-3 text-xs text-[#00FF00]">{newToken}</code><button type="button" onClick={() => void navigator.clipboard.writeText(newToken)} className="mt-3 rounded bg-amber-300 px-3 py-2 text-sm font-black text-black">Copy token</button></section>}
        {error && <p className="mt-4 rounded-lg border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-300">{error}</p>}

        <section className="mt-6"><h2 className="text-xl font-black text-[#00FF00]">Your tokens</h2><div className="mt-3 space-y-2">{credentials.map((credential) => (
          <div key={credential.id} className="rounded-xl border border-[#00FF00]/30 bg-[#001000] p-3"><div className="flex items-center justify-between gap-3"><div><strong className="text-[#00FF00]">{credential.name}</strong><p className="mt-1 text-xs text-[#8bbf8b]">{credential.scopes_json}</p></div>{!credential.revoked_at && <button type="button" onClick={() => void revoke(credential.id)} className="rounded border border-red-400 px-3 py-1 text-xs font-bold text-red-300">Revoke</button>}</div></div>
        ))}{!credentials.length && !error && <p className="text-sm text-[#8bbf8b]">No developer tokens yet.</p>}</div></section>
      </div>
    </main>
  );
}
