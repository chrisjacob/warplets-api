import { useEffect, useRef, useState, type RefObject } from "react";
import { SocialIcon } from "./SocialUI";
import { safeSocialUrl } from "../shared/social";
import { mediaKind, type CastPreview } from "../shared/socialEmbeds";
import { socialRequest } from "./socialClient";

function useNearby(ref: RefObject<HTMLElement | null>) {
  const [nearby, setNearby] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNearby(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return nearby;
}

function LinkCard({ url, label }: { url: string; label?: string }) {
  return (
    <a className="social-link-card" href={url} target="_blank" rel="noreferrer">
      <span>{label || new URL(url).hostname}</span>
      <SocialIcon name="external" />
      <small>{new URL(url).pathname.slice(0, 100)}</small>
    </a>
  );
}

import { AppViewport } from "./AppViewport";
import { hapticTap } from "./haptics";

function ImageViewer({
  urls,
  initial,
  onClose,
}: {
  urls: string[];
  initial: number;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(initial);
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const move = (delta: number) => {
    setSelected((i) => Math.max(0, Math.min(urls.length - 1, i + delta)));
    setZoomed(false);
    setFailed(false);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        move(e.key === "ArrowRight" ? 1 : -1);
      }
      if (e.key === "Tab") {
        const items = [
          ...panel.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href]",
          ),
        ].filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const focus = (e: FocusEvent) => {
      if (!panel.current?.contains(e.target as Node))
        closeButton.current?.focus();
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      requestAnimationFrame(
        () => previous?.isConnected && previous.focus({ preventScroll: true }),
      );
    };
  }, [urls.length]);
  return (
    <AppViewport
      className="app-modal-viewport social-image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Image ${selected + 1} of ${urls.length}`}
    >
      <div className="social-image-viewer-panel" ref={panel}>
        <header>
          <span aria-live="polite">
            {selected + 1} / {urls.length}
          </span>
          <a
            href={urls[selected]}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original image"
          >
            <SocialIcon name="external" />
          </a>
          <button
            ref={closeButton}
            onClick={onClose}
            aria-label="Close image viewer"
          >
            <SocialIcon name="close" />
          </button>
        </header>
        <div
          className={`social-image-stage${zoomed ? " is-zoomed" : ""}`}
          onTouchStart={(e) => {
            if (e.touches.length === 1)
              start.current = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
              };
            else start.current = null;
          }}
          onTouchEnd={(e) => {
            const s = start.current;
            start.current = null;
            if (!s || zoomed) return;
            const dx = e.changedTouches[0].clientX - s.x,
              dy = e.changedTouches[0].clientY - s.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
              move(dx < 0 ? 1 : -1);
          }}
        >
          {failed ? (
            <LinkCard
              url={urls[selected]}
              label="Image unavailable. Open original"
            />
          ) : (
            <button
              className="social-image-zoom"
              aria-label={zoomed ? "Zoom out" : "Zoom in"}
              onClick={() => setZoomed(!zoomed)}
            >
              <img
                key={urls[selected]}
                src={urls[selected]}
                alt={`Post attachment ${selected + 1}`}
                onError={() => setFailed(true)}
                draggable={false}
              />
            </button>
          )}
        </div>
        {urls.length > 1 && (
          <>
            <button
              className="social-viewer-prev"
              aria-label="Previous image"
              disabled={selected === 0}
              onClick={() => move(-1)}
            >
              <span className="social-arrow-prev">
                <SocialIcon name="chevron" />
              </span>
            </button>
            <button
              className="social-viewer-next"
              aria-label="Next image"
              disabled={selected === urls.length - 1}
              onClick={() => move(1)}
            >
              <span className="social-arrow-next">
                <SocialIcon name="chevron" />
              </span>
            </button>
            <nav aria-label="Choose image" className="social-viewer-thumbnails">
              {urls.map((url, i) => (
                <button
                  key={url}
                  aria-label={`Show image ${i + 1}`}
                  aria-current={selected === i ? "true" : undefined}
                  onClick={() => {
                    setSelected(i);
                    setZoomed(false);
                    setFailed(false);
                  }}
                >
                  <img src={url} alt="" />
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
    </AppViewport>
  );
}

function AttachmentImage({
  url,
  onOpen,
  index,
}: {
  url: string;
  onOpen: () => void;
  index: number;
}) {
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(1);
  return failed ? (
    <LinkCard url={url} label="Image unavailable. Open attachment" />
  ) : (
    <button
      className="social-image-attachment"
      style={{ aspectRatio: ratio, width: `${Math.round(220 * ratio)}px` }}
      onClick={() => {
        hapticTap();
        onOpen();
      }}
      aria-label={`Enlarge image ${index + 1}`}
    >
      <img
        src={url}
        loading="lazy"
        alt={`Post attachment ${index + 1}`}
        draggable={false}
        onLoad={(e) =>
          setRatio(
            Math.max(
              0.65,
              Math.min(
                1.9,
                e.currentTarget.naturalWidth / e.currentTarget.naturalHeight,
              ),
            ),
          )
        }
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function ImageGallery({ urls }: { urls: string[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [scrollable, setScrollable] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setScrollable(el.scrollWidth > el.clientWidth + 1),
    );
    observer.observe(el);
    [...el.children].forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [urls.length]);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(
    null,
  );
  const go = (index: number) => {
    const el = strip.current?.children[index] as HTMLElement | undefined;
    if (el)
      strip.current?.scrollTo({
        left: el.offsetLeft,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  };
  return (
    <div
      className={`social-gallery${urls.length === 1 ? " social-gallery-single" : ""}`}
    >
      <div
        className="social-image-strip"
        ref={strip}
        aria-label="Post images"
        onScroll={() => {
          const el = strip.current!;
          const max = el.scrollWidth - el.clientWidth;
          let nearest = 0,
            distance = Infinity;
          [...el.children].forEach((child, index) => {
            const delta = Math.abs(
              Math.min((child as HTMLElement).offsetLeft, max) - el.scrollLeft,
            );
            if (delta <= distance) {
              nearest = index;
              distance = delta;
            }
          });
          setActive(max > 0 ? nearest : 0);
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button === 0)
            drag.current = {
              x: e.clientX,
              scroll: e.currentTarget.scrollLeft,
              moved: false,
            };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 5) {
            d.moved = true;
            e.currentTarget.style.scrollSnapType = "none";
            e.currentTarget.scrollLeft = d.scroll - dx;
          }
        }}
        onPointerUp={(e) => {
          e.currentTarget.style.scrollSnapType = "";
          setTimeout(() => {
            drag.current = null;
          }, 0);
        }}
        onPointerLeave={(e) => {
          e.currentTarget.style.scrollSnapType = "";
          drag.current = null;
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
            drag.current = null;
          }
        }}
      >
        {urls.map((url, index) => (
          <AttachmentImage
            key={url}
            url={url}
            index={index}
            onOpen={() => setSelected(index)}
          />
        ))}
      </div>
      {scrollable && (
        <div className="social-gallery-controls">
          <button
            aria-label="Previous images"
            disabled={active === 0}
            onClick={() => go(active - 1)}
          >
            <span className="social-arrow-prev">
              <SocialIcon name="chevron" />
            </span>
          </button>
          <div className="social-gallery-dots">
            {urls.map((url, i) => (
              <button
                key={url}
                aria-label={`Scroll to image ${i + 1}`}
                aria-current={active === i ? "true" : undefined}
                onClick={() => go(i)}
              >
                <span />
              </button>
            ))}
          </div>
          <button
            aria-label="Next images"
            disabled={active === urls.length - 1}
            onClick={() => go(active + 1)}
          >
            <span className="social-arrow-next">
              <SocialIcon name="chevron" />
            </span>
          </button>
        </div>
      )}
      {selected !== null && (
        <ImageViewer
          urls={urls}
          initial={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

type TwitterWidgets = {
  widgets: {
    createTweet: (
      id: string,
      node: HTMLElement,
      options: Record<string, unknown>,
    ) => Promise<HTMLElement | undefined>;
  };
};
let twitterPromise: Promise<TwitterWidgets> | undefined;
function loadTwitter() {
  const win = window as Window & { twttr?: TwitterWidgets };
  if (win.twttr?.widgets) return Promise.resolve(win.twttr);
  return (twitterPromise ??= new Promise<TwitterWidgets>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error("X unavailable"));
    }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      win.twttr?.widgets
        ? resolve(win.twttr)
        : reject(new Error("X unavailable"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error("X unavailable"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    twitterPromise = undefined;
    throw error;
  }));
}
function Tweet({ id, url }: { id: string; url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const nearby = useNearby(ref);
  const [state, setState] = useState("loading");
  useEffect(() => {
    if (!nearby || !ref.current) return;
    let cancelled = false;
    const target = document.createElement("div");
    ref.current.appendChild(target);
    const timer = window.setTimeout(() => {
      if (!cancelled) setState("failed");
    }, 20000);
    void loadTwitter()
      .then((twitter) =>
        twitter.widgets.createTweet(id, target, {
          theme: "dark",
          dnt: true,
          conversation: "none",
          width: 550,
          align: "center",
        }),
      )
      .then((element) => {
        if (!cancelled) setState(element ? "ready" : "failed");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      target.remove();
    };
  }, [id, nearby]);
  return (
    <div className={`social-tweet social-tweet--${state}`}>
      <div ref={ref} />
      {state === "loading" && (
        <div className="social-embed-loading" role="status">
          Loading post from Xâ€¦
        </div>
      )}
      {state === "failed" && (
        <LinkCard url={url} label="Post unavailable here. View on X" />
      )}
    </div>
  );
}

function CastEmbed({ url, postId }: { url: string; postId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const nearby = useNearby(ref);
  const [cast, setCast] = useState<CastPreview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!nearby) return;
    let cancelled = false;
    void socialRequest<{ cast: CastPreview }>(
      `embed/cast?postId=${encodeURIComponent(postId)}&url=${encodeURIComponent(url)}`,
    )
      .then((data) => {
        if (!cancelled) setCast(data.cast);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nearby, postId, url]);
  return (
    <div ref={ref} className="social-cast-embed">
      {cast ? (
        <>
          <a
            className="social-cast-author"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {cast.avatar && (
              <img
                src={cast.avatar}
                alt=""
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <strong>{cast.username}</strong>
            <span>Farcaster</span>
            <SocialIcon name="external" />
          </a>
          <a
            className="social-cast-content"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            <p>{cast.text}</p>
          </a>
          <SocialMedia
            urls={cast.embeds.filter((u) =>
              ["image", "video", "youtube"].includes(mediaKind(u).kind),
            )}
          />
        </>
      ) : failed ? (
        <LinkCard url={url} label="Cast unavailable. View on Farcaster" />
      ) : (
        <div className="social-embed-loading" role="status">
          Loading castâ€¦
        </div>
      )}
    </div>
  );
}
function Video({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    const initialize = () => {
      if (cancelled) return;
      // Native HLS (including Safari) still needs its source assigned.
      if (
        !/\.m3u8(?:\?|$)/i.test(url) ||
        video.canPlayType("application/vnd.apple.mpegurl")
      ) {
        video.src = url;
        return;
      }
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setFailed(true);
            return;
          }
          // Load initial media so native controls can display duration and play.
          const hls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 20 });
          destroy = () => hls.destroy();
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) setFailed(true);
          });
        })
        .catch(() => setFailed(true));
    };
    // Only prepare videos near the viewport, rather than fetching the whole feed.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          initialize();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(video);
    return () => {
      cancelled = true;
      observer.disconnect();
      destroy?.();
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);
  return failed ? (
    <a className="social-link-card" href={url} target="_blank" rel="noreferrer">
      <span>Video unavailable. Open video</span>
      <SocialIcon name="external" />
    </a>
  ) : (
    <video
      ref={ref}
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    />
  );
}
export default function SocialMedia({
  urls,
  postId,
}: {
  urls: string[];
  postId?: string;
}) {
  const safe = [...new Set(urls)]
    .map(safeSocialUrl)
    .filter((url): url is string => !!url)
    .slice(0, 4);
  const images = safe.filter((url) => mediaKind(url).kind === "image");
  return (
    <div className="social-media">
      {safe.map((url) => {
        const media = mediaKind(url);
        if (media.kind === "image")
          return url === images[0] ? (
            <ImageGallery key={url} urls={images} />
          ) : null;
        if (media.kind === "video") return <Video key={url} url={url} />;
        if (media.kind === "youtube")
          return (
            <iframe
              className="social-youtube"
              key={url}
              title="YouTube video"
              loading="lazy"
              src={`https://www.youtube-nocookie.com/embed/${media.id}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          );
        if (media.kind === "tweet")
          return <Tweet key={url} url={url} id={media.id!} />;
        if (media.kind === "cast" && postId)
          return <CastEmbed key={url} url={url} postId={postId} />;
        return <LinkCard key={url} url={url} />;
      })}
    </div>
  );
}
