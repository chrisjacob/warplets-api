import { useEffect, useState } from "react";
import type { StonkletVoter, StonkletVotersPage } from "../shared/stonkletsVotes";
import { VoterAvatar } from "./StonkletLaunchVotes";

export default function StonkletShareFavourites({ id, asset, count }: { id: string; asset: "stonklet" | "stock"; count: number }) {
  const [voters, setVoters] = useState<StonkletVoter[]>([]);
  const [ready, setReady] = useState(count === 0);
  useEffect(() => {
    const controller = new AbortController();
    setVoters([]);
    setReady(count === 0);
    if (count === 0) return () => controller.abort();
    const params = new URLSearchParams({ id, asset, stack: "1" });
    void fetch(`/api/stonklets/voters?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Favourites unavailable");
        const page = await response.json() as StonkletVotersPage;
        if (!controller.signal.aborted) setVoters(page.voters.filter(voter => voter.image).slice(0, 10));
      }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setReady(true); });
    return () => controller.abort();
  }, [id, asset, count]);
  return <div className="stonklet-share-avatars" data-voters-ready={ready} aria-label="Farcaster users who favourited this token">
    {voters.map((voter, index) => <span key={voter.wallet} style={{ right: voters.length === 10 ? `calc((100% - 28px) * ${index / 9})` : `${index * 16}px`, zIndex: 10 - index }}><VoterAvatar voter={voter} stack /></span>)}
  </div>;
}
