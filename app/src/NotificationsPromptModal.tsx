import { AppViewport } from "./AppViewport";
import { Text } from "@neynar/ui/typography";
import { useEffect, useRef, useState } from "react";
import { useOverlayScrollbars } from "overlayscrollbars-react";
import ProgressiveNotificationImage from "./ProgressiveNotificationImage";
import { getNotificationPromptConfirmLabel, getNotificationPromptText } from "./notificationPromptCopy";

const TYPEWRITER_MS_PER_CHARACTER = 38;
const TITLE = "FOMO? Don't Miss Out...";
const TITLE_HIGHLIGHT_LENGTH = "FOMO?".length;
const PREVIEW_IMAGE_SRC = "https://warplets.10x.meme/5019.png";
const PREVIEW_FALLBACK_IMAGE_SRC = "https://warplets.10x.meme/5019.jpg";
const PREVIEW_REVEAL_MS = 4800;
const PREVIEW_TO_TEXT_DELAY_MS = 180;
const PREVIEW_REVEAL_STOPS = [0, 40, 20, 65, 35, 85, 25, 100] as const;

function easeInOutProgress(progress: number): number {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return 0.5 - Math.cos(clampedProgress * Math.PI) / 2;
}

function getPreviewRevealPercent(elapsedMs: number): number {
  if (elapsedMs <= 0) return PREVIEW_REVEAL_STOPS[0];
  if (elapsedMs >= PREVIEW_REVEAL_MS) return 100;

  const segmentCount = PREVIEW_REVEAL_STOPS.length - 1;
  const segmentMs = PREVIEW_REVEAL_MS / segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(elapsedMs / segmentMs));
  const segmentProgress = easeInOutProgress((elapsedMs - segmentIndex * segmentMs) / segmentMs);
  const fromPercent = PREVIEW_REVEAL_STOPS[segmentIndex];
  const toPercent = PREVIEW_REVEAL_STOPS[segmentIndex + 1];
  return fromPercent + (toPercent - fromPercent) * segmentProgress;
}

export default function NotificationsPromptModal({
  notificationsOnlyPrompt,
  baseAppContext = false,
  appName = "10X.MEME",
  promptText,
  busy = false,
  onClose,
  onConfirm,
}: {
  notificationsOnlyPrompt: boolean;
  baseAppContext?: boolean;
  appName?: string;
  promptText?: string;
  busy?: boolean;
  onClose?: () => void;
  onConfirm: () => void;
}) {
  const [animationElapsedMs, setAnimationElapsedMs] = useState(0);
  const [isPreviewImageReady, setIsPreviewImageReady] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const notificationPromptText = promptText ?? getNotificationPromptText({
    appName,
    notificationsOnlyPrompt,
    baseAppContext,
  });
  const titleAnimationMs = TITLE.length * TYPEWRITER_MS_PER_CHARACTER;
  const previewStartMs = titleAnimationMs;
  const textStartMs = previewStartMs + PREVIEW_REVEAL_MS + PREVIEW_TO_TEXT_DELAY_MS;
  const totalAnimationMs = textStartMs + notificationPromptText.length * TYPEWRITER_MS_PER_CHARACTER;
  const [initializeScrollbars] = useOverlayScrollbars({
    options: {
      scrollbars: {
        theme: "os-theme-10x",
        autoHide: "scroll",
        clickScroll: true,
      },
    },
    defer: true,
  });

  useEffect(() => {
    const target = contentRef.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeScrollbars(target);
    return () => {
      target.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [initializeScrollbars]);

  useEffect(() => {
    let animationFrameId = 0;
    const startedAt = performance.now();

    setAnimationElapsedMs(0);
    setIsPreviewImageReady(false);

    const tick = (now: number) => {
      const nextElapsedMs = Math.min(totalAnimationMs, now - startedAt);
      setAnimationElapsedMs(nextElapsedMs);
      if (nextElapsedMs < totalAnimationMs) animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [notificationPromptText, totalAnimationMs]);

  const visibleTitleCharacters = Math.max(0, Math.min(TITLE.length, Math.floor(animationElapsedMs / TYPEWRITER_MS_PER_CHARACTER)));
  const visibleHighlightedTitle = TITLE.slice(0, Math.min(visibleTitleCharacters, TITLE_HIGHLIGHT_LENGTH));
  const visibleRestTitle = visibleTitleCharacters > TITLE_HIGHLIGHT_LENGTH
    ? TITLE.slice(TITLE_HIGHLIGHT_LENGTH, visibleTitleCharacters)
    : "";
  const previewRevealPercent = isPreviewImageReady
    ? getPreviewRevealPercent(animationElapsedMs - previewStartMs)
    : 0;
  const textAnimationElapsedMs = previewRevealPercent >= 100
    ? Math.max(0, animationElapsedMs - textStartMs)
    : 0;
  const visibleTextCharacters = Math.max(0, Math.min(
    notificationPromptText.length,
    Math.floor(textAnimationElapsedMs / TYPEWRITER_MS_PER_CHARACTER),
  ));

  return (
    <AppViewport className="app-modal-viewport fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-4 sm:items-center">
      <div className="app-modal-panel flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="app-modal-header border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text className="relative min-w-0 text-base font-bold" style={{ color: "rgb(139, 191, 139)" }}>
            <span className="invisible select-none" aria-hidden="true">{TITLE}</span>
            <span className="absolute inset-0 min-w-0 truncate">
              <span style={{ color: "#00FF00" }}>{visibleHighlightedTitle}</span>
              {visibleRestTitle}
            </span>
          </Text>
        </div>

        <div ref={contentRef} className="app-modal-scroll-body min-h-0 flex-1 overflow-y-auto p-4">
          <div className="relative mx-auto aspect-[9/8] w-full max-w-[min(100%,360px)] overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
            <ProgressiveNotificationImage
              highResolutionSrc={PREVIEW_IMAGE_SRC}
              fallbackSrc={PREVIEW_FALLBACK_IMAGE_SRC}
              revealPercent={previewRevealPercent}
              onReady={() => setIsPreviewImageReady(true)}
            />
          </div>

          <div className="mt-3">
            <div className="relative rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-2 text-sm leading-relaxed text-[#8bbf8b]">
              <div className="invisible select-none" aria-hidden="true">{notificationPromptText}</div>
              <div className="absolute inset-0 px-3 py-2">{notificationPromptText.slice(0, visibleTextCharacters)}</div>
            </div>
          </div>
        </div>

        <div className="app-modal-footer border-t border-[#00FF00]/20 bg-black p-4">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
          >
            {busy ? "Enabling notifications…" : getNotificationPromptConfirmLabel(baseAppContext)}
          </button>
          {onClose && <button type="button" disabled={busy} onClick={onClose} className="mt-3 w-full cursor-pointer bg-transparent py-2 text-sm text-[#8bbf8b]">Maybe later</button>}
        </div>
      </div>
    </AppViewport>
  );
}
