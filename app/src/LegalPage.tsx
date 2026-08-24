import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppHeader, MiniAppMenuPage, useMiniAppChrome } from "./miniAppChrome.tsx";
import MiniAppShell from "./MiniAppShell";
import SiteFooter from "./SiteFooter";

type LegalDocument = "privacy" | "terms";

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "rule" };

type LegalHistoryState = {
  legalNavigation?: {
    from10x?: boolean;
    fromPath?: string;
  };
};

const DOCUMENT_CONFIG: Record<LegalDocument, { title: string; source: string }> = {
  privacy: { title: "Privacy Policy", source: "/legal/privacy.md" },
  terms: { title: "Terms of Service", source: "/legal/terms.md" },
};

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (line === "---") {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      index += 1;
      continue;
    }

    const unordered = line.match(/^[*-]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const itemLine = lines[index]!.trim();
        const item = orderedList
          ? itemLine.match(/^\d+\.\s+(.+)$/)
          : itemLine.match(/^[*-]\s+(.+)$/);
        if (item) {
          items.push(item[1]!);
          index += 1;
          continue;
        }

        if (!itemLine) {
          let nextIndex = index + 1;
          while (nextIndex < lines.length && !lines[nextIndex]!.trim()) nextIndex += 1;
          const nextLine = lines[nextIndex]?.trim() ?? "";
          const nextItem = orderedList ? /^\d+\.\s+/.test(nextLine) : /^[*-]\s+/.test(nextLine);
          if (nextItem) {
            index = nextIndex;
            continue;
          }
        }
        break;
      }
      blocks.push({ type: "list", ordered: orderedList, items });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index]!.trim();
      if (
        !next
        || next === "---"
        || /^(#{1,6})\s+/.test(next)
        || /^[*-]\s+/.test(next)
        || /^\d+\.\s+/.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|<br\s*\/?>)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (/^<br\s*\/?>$/i.test(token)) {
      nodes.push(<br key={`${match.index}-break`} />);
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${match.index}-strong`} className="font-black text-[#E0E3FF]">
          {renderInline(token.slice(2, -2))}
        </strong>,
      );
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const href = link[2]!;
        const external = /^https?:\/\//i.test(href);
        nodes.push(
          <a
            key={`${match.index}-link`}
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="font-bold text-[#00FF00] underline decoration-[#00FF00]/55 underline-offset-2 hover:text-[#8bff8b]"
          >
            {link[1]}
          </a>,
        );
      }
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function LegalArticle({ blocks }: { blocks: MarkdownBlock[] }) {
  return (
    <article className="rounded-2xl border border-[#00FF00]/25 bg-black/80 px-5 py-6 shadow-[0_0_20px_rgba(0,255,0,0.1)] sm:px-6">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "rule") return <hr key={key} className="my-7 border-0 border-t border-[#00FF00]/20" />;
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List
              key={key}
              className={`my-4 space-y-2 pl-6 text-sm leading-6 text-[#b8d7b8] marker:font-black marker:text-[#00FF00] ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item)}</li>)}
            </List>
          );
        }
        if (block.type === "heading") {
          const content = renderInline(block.text);
          if (block.level === 1) return <h1 key={key} className="mb-5 mt-2 text-xl font-black leading-tight text-[#00FF00] first:mt-0">{content}</h1>;
          if (block.level === 2) return <h2 key={key} className="mb-3 mt-7 text-lg font-black leading-tight text-[#E0E3FF]">{content}</h2>;
          return <h3 key={key} className="mb-2 mt-6 text-base font-black leading-tight text-[#E0E3FF]">{content}</h3>;
        }
        return <p key={key} className="my-4 text-sm leading-6 text-[#b8d7b8]">{renderInline(block.text)}</p>;
      })}
    </article>
  );
}

export default function LegalPage({ document: legalDocument }: { document: LegalDocument }) {
  const config = DOCUMENT_CONFIG[legalDocument];
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { isMenuRoute, actions } = useMiniAppChrome("app");
  const arrivedFrom10x = Boolean((window.history.state as LegalHistoryState | null)?.legalNavigation?.from10x);
  const blocks = useMemo(() => markdown == null ? [] : parseMarkdown(markdown), [markdown]);

  useEffect(() => {
    document.title = `${config.title} — 10X.MEME`;
    const controller = new AbortController();
    setMarkdown(null);
    setLoadError(false);
    void fetch(config.source, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Legal document request failed (${response.status})`);
        return response.text();
      })
      .then(setMarkdown)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error(`Failed to load ${config.title}:`, error);
        setLoadError(true);
      });
    return () => controller.abort();
  }, [config.source, config.title]);

  const handleBack = () => {
    if (isMenuRoute) {
      actions.goBack();
      return;
    }
    window.history.back();
  };

  return (
    <MiniAppShell>
      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="app"
          title={isMenuRoute ? "Menu" : config.title}
          canGoBack={isMenuRoute || arrivedFrom10x}
          onBack={handleBack}
          onLogo={() => { void actions.openHubRoot(); }}
          onMenu={actions.openMenu}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="app" />
        ) : (
          <main className="mx-auto w-full max-w-md px-4 pb-4 pt-5">
            {markdown != null && <LegalArticle blocks={blocks} />}
            {markdown == null && !loadError && (
              <div className="rounded-2xl border border-[#00FF00]/25 bg-black/80 px-5 py-12 text-center text-sm font-bold text-[#8bbf8b]" role="status">
                Loading {config.title.toLowerCase()}…
              </div>
            )}
            {loadError && (
              <div className="rounded-2xl border border-red-500/40 bg-black/80 px-5 py-8 text-center text-sm font-bold text-red-300" role="alert">
                The {config.title.toLowerCase()} could not be loaded. Please refresh and try again.
              </div>
            )}
          </main>
        )}
        <SiteFooter />
      </div>
    </MiniAppShell>
  );
}
