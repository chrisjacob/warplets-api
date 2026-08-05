import { useEffect, useState } from "react";
import { NeynarAuthButton } from "@neynar/react";
import { WebConnectModal } from "./WebConnectModal";
import { loadAppSession } from "./appSession";
import { useWalletController } from "./walletController";

export default function BotLinkPage() {
  const params = new URLSearchParams(window.location.search);
  const provider = params.get("provider") === "discord" ? "Discord" : "Telegram";
  const challenge = params.get("challenge") ?? "";
  const platformVerified = params.get("platformVerified") === "1";
  const wallet = useWalletController();
  const [hasVerifiedWallet, setHasVerifiedWallet] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const refreshSession = () => loadAppSession().then((session) => setHasVerifiedWallet(Boolean(session.walletAddress)));
  useEffect(() => { void refreshSession(); }, [wallet.session?.address]);

  const confirm = async () => {
    setStatus("busy");
    try {
      const response = await fetch("/api/bot-links/confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge, confirm: true }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The bot link could not be confirmed.");
      setStatus("done");
      setMessage(`${provider} is linked to your verified wallet. You can return to the bot.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The bot link failed.");
    }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white">
      <WebConnectModal
        open={connectOpen}
        onClose={() => { setConnectOpen(false); void refreshSession(); }}
        farcasterControl={<NeynarAuthButton label="Connect Farcaster" />}
      />
      <section className="mx-auto max-w-md rounded-2xl border border-[#00FF00]/50 bg-[#001000] p-6">
        <h1 className="text-2xl font-black text-[#00FF00]">Link {provider}</h1>
        <p className="mt-3 text-sm leading-6 text-[#b7ffb7]">This links the {provider} account that requested this one-time URL to a wallet you verify with SIWE. It does not give the bot signing authority.</p>
        {!challenge && <p className="mt-4 text-sm text-red-300">This link is missing its one-time challenge.</p>}
        {!platformVerified && challenge && <a href={`/api/auth/${provider.toLowerCase()}/start?challenge=${encodeURIComponent(challenge)}`} className="mt-5 block w-full rounded-lg border border-[#00FF00] px-4 py-3 text-center font-black text-[#00FF00]">Verify the same {provider} account</a>}
        {platformVerified && !hasVerifiedWallet && challenge && <button type="button" onClick={() => setConnectOpen(true)} className="mt-5 w-full rounded-lg bg-[#00FF00] px-4 py-3 font-black text-[#003800]">Connect and verify wallet</button>}
        {platformVerified && hasVerifiedWallet && status !== "done" && <button type="button" disabled={status === "busy" || !challenge} onClick={() => void confirm()} className="mt-5 w-full rounded-lg bg-[#00FF00] px-4 py-3 font-black text-[#003800] disabled:opacity-50">{status === "busy" ? "Linking…" : `Confirm ${provider} link`}</button>}
        {message && <p className={`mt-4 text-sm ${status === "done" ? "text-[#00FF00]" : "text-red-300"}`}>{message}</p>}
        <a href="/" className="mt-5 block text-center text-sm font-bold text-[#8bbf8b]">Return to Search</a>
      </section>
    </main>
  );
}
