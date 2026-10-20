import type { ReactNode } from "react";
import type { z } from "zod";
import type { PublicContentCampaign } from "../../../discovery/src/content-model";
import { solanaSignInHref } from "./walletReturn";

export type ReviewCampaign = z.infer<typeof PublicContentCampaign>;
export function campaignPhase(campaign: ReviewCampaign, now = Date.now()) {
  return now < Date.parse(campaign.starts_at) ? "upcoming" : now >= Date.parse(campaign.ends_at) ? "closed" : "open";
}
export function ContentPreviewNotice() {
  return <aside className="tenx-preview-notice"><strong>Local preview · submissions earn no rewards.</strong><details><summary>How review works</summary><p>Links are reviewed before featuring. Wallet sign-in identifies the submitter; it does not verify authorship, rights, a unique person or engagement. Review windows are separate from real spotlights. No tokens, scores, entitlements or claims are enabled. Links open only when you choose them; media is not embedded or fetched automatically.</p></details></aside>;
}
export function ContentEmptyState({ loading }: { loading: boolean }) {
  return loading ? <p role="status">Loading campaigns…</p> : <section className="tenx-empty"><h2>No campaigns yet</h2><p>Campaigns will appear here when submissions open.</p><a href="/discover">Explore tokens →</a></section>;
}
export function SubmissionJourney({ campaign, campaigns, loaded, signedIn, selected, children, now = Date.now() }: { campaign: ReviewCampaign | null; campaigns: ReviewCampaign[]; loaded: boolean; signedIn: boolean; selected: string; children: ReactNode; now?: number }) {
  if (selected && !campaign) return <section className="tenx-panel"><h2>{loaded ? "Campaign unavailable" : "Loading campaign…"}</h2><p>{loaded ? "Choose an available campaign to contribute." : "Checking submission availability."}</p><a href="/attention">View campaigns →</a></section>;
  if (!campaign) {
    const available = campaigns.filter(item => campaignPhase(item, now) === "open");
    return <section className="tenx-panel"><h2>{!loaded ? "Loading campaigns…" : available.length ? "Choose a campaign" : "No open campaigns"}</h2>{available.length ? <ul>{available.map(item => <li key={item.id}><a href={`/submit?campaign=${item.id}`}>{item.title}</a></li>)}</ul> : <p>Choose an open campaign before submitting content.</p>}<a href="/attention">View all campaigns →</a></section>;
  }
  if (campaignPhase(campaign, now) !== "open") return <section className="tenx-panel"><h2>{campaignPhase(campaign, now) === "closed" ? "Submissions closed" : "Submissions are not open yet"}</h2><a href={`/campaign/${campaign.id}`}>View campaign →</a></section>;
  if (!signedIn) return <section className="tenx-panel"><h2>Sign in to submit</h2><p>Use your Solana wallet. After sign-in, you’ll return to this campaign.</p><a className="tenx-button" href={solanaSignInHref(`/submit?campaign=${campaign.id}`)}>Sign in with Solana</a></section>;
  return <>{children}</>;
}
