import { useEffect, useRef, useState } from "react";
import { hapticTap } from "./haptics";
import sdk from "@farcaster/miniapp-sdk";
import { currentAppSurface } from "./surfaceAdapter";

export default function StonkletsAirdropsCta() {
  const panel = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [loadVideo, setLoadVideo] = useState(false);

  useEffect(() => {
    if (!panel.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setLoadVideo(true);
      observer.disconnect();
    }, { rootMargin: "200px" });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element || !loadVideo) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void element.play().catch(() => {});
      else element.pause();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadVideo]);

  return <section ref={panel} className="mt-5 rounded-xl border border-[#00FF00]/40 bg-black/70 px-3 pb-6 pt-3">
    <h2 className="text-center text-xl font-black text-[#00FF00]">Want 10X Airdrops?</h2>
    <video ref={video} src={loadVideo ? "https://warplets.10x.meme/760.mp4" : undefined}
      className="mt-4 aspect-square w-full rounded-xl bg-black object-cover"
      aria-label="10X Warplet NFT animation" loop muted playsInline preload="none" disablePictureInPicture />
    <a href="https://warplet.10x.meme/" target="_blank" rel="noopener noreferrer"
      onClick={(event) => {
        void hapticTap();
        if (currentAppSurface() !== "farcaster-miniapp") return;
        event.preventDefault();
        void sdk.actions.openMiniApp({ url: "https://warplet.10x.meme/" })
          .catch(() => sdk.actions.openUrl("https://warplet.10x.meme/"))
          .catch(() => { window.location.href = "https://warplet.10x.meme/"; });
      }}
      className="mt-4 flex w-full cursor-pointer items-center justify-center rounded-[20px] border border-[#0a990a] bg-[#00FF00] px-4 py-3 text-center text-sm font-black text-[rgb(0,80,0)] shadow-[3px_6px_0_#0a990a] active:translate-y-0.5">
      Get Your 10X Warplet NFT
    </a>
  </section>;
}
