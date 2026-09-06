import { AppViewport } from "./AppViewport";
import confetti from "canvas-confetti";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { hapticSuccess, hapticTap } from "./haptics";

type SubscriberProfile = {
  fid: number;
  username: string | null;
  pfpUrl: string;
};

const SOCIAL_PROOF_AVATAR_COUNT = 15;
const SOCIAL_PROOF_AVATAR_SIZE_PX = 44;

function supportsDesktopAutofocus(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)").matches;
}

export function getSubscriberMilestone(subscriberCount: number, displayedAvatarCount: number): number {
  if (subscriberCount <= 0) return 0;
  return Math.max(0, subscriberCount - displayedAvatarCount - 1);
}

function normalizeSubscriberSocialProof(value: unknown): { profiles: SubscriberProfile[]; subscriberCount: number | null } {
  if (!value || typeof value !== "object") return { profiles: [], subscriberCount: null };
  const payload = value as { profiles?: unknown; subscriberCount?: unknown };
  const profiles = !Array.isArray(payload.profiles) ? [] : payload.profiles
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { fid?: unknown; username?: unknown; pfpUrl?: unknown };
      const fid = Number(row.fid);
      const pfpUrl = typeof row.pfpUrl === "string" ? row.pfpUrl.trim() : "";
      if (!Number.isInteger(fid) || fid <= 0 || !pfpUrl) return null;
      return {
        fid,
        username: typeof row.username === "string" && row.username.trim() ? row.username.trim() : null,
        pfpUrl,
      } satisfies SubscriberProfile;
    })
    .filter((profile): profile is SubscriberProfile => profile !== null)
    .slice(0, SOCIAL_PROOF_AVATAR_COUNT);
  const subscriberCount = Number(payload.subscriberCount);
  return {
    profiles,
    subscriberCount: Number.isInteger(subscriberCount) && subscriberCount >= 0 ? subscriberCount : null,
  };
}

function showSignupConfetti(): void {
  confetti({
    particleCount: 120,
    spread: 70,
    origin: { y: 0.72 },
    colors: ["#00FF00", "#FFFFFF", "#FFFF00"],
  });
}

function SubscriberSocialProof({ actionSessionToken, confirmationPending }: {
  actionSessionToken: string | null;
  confirmationPending: boolean;
}) {
  const [profiles, setProfiles] = useState<SubscriberProfile[]>([]);
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revealedProfileCount, setRevealedProfileCount] = useState(0);
  const readyProfileIndexes = useRef(new Set<number>());
  const nextProfileToReveal = useRef(0);
  const revealTimer = useRef<number | null>(null);
  const profileImageRefs = useRef<Array<HTMLImageElement | null>>([]);

  const revealReadyProfiles = () => {
    if (revealTimer.current != null) return;
    const revealNext = () => {
      const nextIndex = nextProfileToReveal.current;
      if (!readyProfileIndexes.current.has(nextIndex)) {
        revealTimer.current = null;
        return;
      }
      nextProfileToReveal.current = nextIndex + 1;
      setRevealedProfileCount(nextIndex + 1);
      revealTimer.current = window.setTimeout(revealNext, 75);
    };
    revealNext();
  };

  const markProfileReady = (index: number) => {
    readyProfileIndexes.current.add(index);
    revealReadyProfiles();
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadSocialProof = async () => {
      const request = (includeBearer: boolean) => fetch("/api/email/social-proof", {
        headers: {
          accept: "application/json",
          ...(includeBearer && actionSessionToken ? { authorization: `Bearer ${actionSessionToken}` } : {}),
        },
        signal: controller.signal,
      });

      let response = await request(Boolean(actionSessionToken));
      if (!response.ok && actionSessionToken) response = await request(false);
      if (!response.ok) throw new Error(`Subscriber social proof request failed (${response.status}).`);
      return response.json();
    };

    void loadSocialProof()
      .then((payload) => {
        if (controller.signal.aborted) return;
        const socialProof = normalizeSubscriberSocialProof(payload);
        setProfiles(socialProof.profiles);
        setSubscriberCount(socialProof.subscriberCount);
        setLoadFailed(socialProof.subscriberCount == null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
          console.warn("Subscriber social proof failed to load:", error);
        }
      });
    return () => {
      controller.abort();
      if (revealTimer.current != null) window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    };
  }, [actionSessionToken]);

  useEffect(() => {
    profileImageRefs.current.slice(0, profiles.length).forEach((image, index) => {
      if (!image?.complete) return;
      if (image.naturalWidth > 0) {
        markProfileReady(index);
        return;
      }

      const fallbackUrl = new URL("/farcaster.webp", window.location.href).href;
      if (image.src !== fallbackUrl) image.src = fallbackUrl;
      else {
        image.style.display = "none";
        markProfileReady(index);
      }
    });
  }, [profiles]);

  const visibleProfiles = profiles.length > 0 ? profiles : Array.from({ length: SOCIAL_PROOF_AVATAR_COUNT }, (_, index) => ({
    fid: -(index + 1),
    username: null,
    pfpUrl: "",
  }));
  const subscriberMilestone = subscriberCount == null
    ? null
    : getSubscriberMilestone(subscriberCount, profiles.length);

  return (
    <div className="mt-5 flex flex-col items-center" aria-label="Subscriber community">
      <div className="flex w-full items-center" aria-hidden={profiles.length === 0 || undefined}>
        {visibleProfiles.map((profile, index) => (
          <span
            key={profile.fid}
            className={`h-11 w-11 shrink-0 overflow-hidden rounded-full bg-[#071807] ${index < revealedProfileCount ? "subscriber-avatar-revealed" : "subscriber-avatar-placeholder"}`}
            style={{
              ...(index === 0 ? {} : {
                marginLeft: `calc((100% - ${SOCIAL_PROOF_AVATAR_COUNT * SOCIAL_PROOF_AVATAR_SIZE_PX}px) / ${SOCIAL_PROOF_AVATAR_COUNT - 1})`,
              }),
              ...(index < revealedProfileCount ? {} : { animationDelay: `${index * 90}ms` }),
            }}
          >
            {profile.pfpUrl ? (
              <img
                ref={(image) => { profileImageRefs.current[index] = image; }}
                src={profile.pfpUrl}
                alt={profile.username ? `@${profile.username}` : "10X subscriber"}
                className={`subscriber-avatar-image h-full w-full object-cover ${index < revealedProfileCount ? "subscriber-avatar-image--visible" : ""}`}
                loading="eager"
                decoding="async"
                onLoad={() => markProfileReady(index)}
                onError={(event) => {
                  if (event.currentTarget.src.endsWith("/farcaster.webp")) {
                    event.currentTarget.style.display = "none";
                    markProfileReady(index);
                    return;
                  }
                  event.currentTarget.src = "/farcaster.webp";
                }}
              />
            ) : <span className="block h-full w-full bg-[#0c2a0c]" />}
          </span>
        ))}
      </div>
      <p className={`mt-3 text-center text-[15px] font-black leading-5 text-[#b8d7b8] ${confirmationPending ? "" : "whitespace-nowrap"}`}>
        {confirmationPending
          ? "Check your inbox to confirm your subscription."
          : loadFailed
            ? "Subscriber count temporarily unavailable."
            : subscriberMilestone == null
            ? "Loading subscribers…"
            : `Over ${subscriberMilestone.toLocaleString("en-US")} Subscribed!`}
      </p>
    </div>
  );
}

export default function EmailWaitlistCta({ actionSessionToken, joinedToPrevious = false, autoFocusEmail = false }: {
  actionSessionToken: string | null;
  viewerFid: number | null;
  authenticatedSession?: boolean;
  joinedToPrevious?: boolean;
  autoFocusEmail?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "pending" | "error">("idle");
  const [message, setMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const emailInputRef = useRef<HTMLInputElement>(null);
  const hasAutoFocusedEmail = useRef(false);
  const shouldAutoFocusEmail = autoFocusEmail && supportsDesktopAutofocus();

  useEffect(() => {
    if (!shouldAutoFocusEmail || hasAutoFocusedEmail.current) return;
    emailInputRef.current?.focus();
    hasAutoFocusedEmail.current = true;
  }, [shouldAutoFocusEmail]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(""), 8_000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === "submitting") return;
    void hapticTap();
    setState("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/email/subscribe-10x", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "content-type": "application/json",
          ...(actionSessionToken ? { authorization: `Bearer ${actionSessionToken}` } : {}),
        },
        body: JSON.stringify({ email: email.trim() }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Could not join the waitlist.");
      const successMessage = payload.message || "Check your inbox to confirm your subscription.";
      setState("pending");
      setToastMessage(successMessage);
      setEmail("");
      void hapticSuccess();
      showSignupConfetti();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    }
  };
  return (
    <>
      {toastMessage && (
        <AppViewport className="trade-toast" role="status" aria-live="polite">
          <div className="flex w-full items-center gap-3">
            <span className="min-w-0 flex-1">{toastMessage}</span>
            <button
              type="button"
              aria-label="Close message"
              onClick={() => setToastMessage("")}
              className="trade-toast__close"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          </div>
        </AppViewport>
      )}
      <section className={`${joinedToPrevious ? "mt-0 rounded-b-xl border-x border-b" : "mt-5 rounded-xl border"} border-[#00FF00]/25 bg-black/70 px-3 pb-6 pt-6`}>
        <h2 className="text-center text-xl font-black text-[#00FF00]">You're Just One Trade Away...</h2>
        <form onSubmit={submit} className="mt-4 flex items-stretch gap-2">
          <label htmlFor="waitlist-email" className="sr-only">Email address</label>
          <input
            ref={emailInputRef}
            id="waitlist-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus={shouldAutoFocusEmail}
            required
            maxLength={254}
            value={email}
            onChange={(event) => { setEmail(event.target.value); if (state === "error") setState("idle"); }}
            disabled={state === "submitting" || state === "pending"}
            placeholder="Email"
            className="min-w-0 flex-1 rounded-lg border border-[#00FF00]/40 bg-[#061006] px-3 py-3 text-base font-bold text-[#dfffe0] outline-none placeholder:text-[#6f9f6f] focus:border-[#00FF00] disabled:opacity-65"
          />
          <button
            type="submit"
            disabled={state === "submitting" || state === "pending"}
            className="shrink-0 cursor-pointer rounded-xl border border-[#0a990a] bg-[#00FF00] px-3 py-3 text-sm font-black text-[rgb(0,80,0)] shadow-[2px_3px_0_#0a990a] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[1.5px] active:shadow-[1px_1px_0_#0a990a] disabled:cursor-default disabled:opacity-65"
          >
            {state === "submitting"
                ? "Joining..."
                : state === "pending"
                  ? "Confirmation Sent"
                  : "Join Waitlist"}
          </button>
        </form>
        {state === "error" && message && (
          <p role="status" aria-live="polite" className="mt-4 text-center text-xs font-bold leading-5 text-[#ff8f8f]">
            {message}
          </p>
        )}
        <SubscriberSocialProof actionSessionToken={actionSessionToken} confirmationPending={state === "pending"} />
      </section>
    </>
  );
}
