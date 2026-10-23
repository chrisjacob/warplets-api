import { useEffect, useRef } from "react";

const primary = [
  { href: "/trending", label: "Trending", matches: (path: string) => path === "/trending" },
  { href: "/discover", label: "Discover", matches: (path: string) => path === "/discover" || path.startsWith("/token/") },
  { href: "/attention", label: "Content", matches: (path: string) => path === "/attention" || path === "/submit" || path.startsWith("/campaign/") },
  { href: "/wallets", label: "My wallets", matches: (path: string) => path === "/wallets" },
];
const groups = [
  { label: "Research & information", links: [
    { href: "/research", label: "Daily review" },
    { href: "/transparency", label: "Rules & methodology" },
    { href: "/status", label: "Data status" },
    { href: "/history", label: "Retained token directory" },
    { href: "/thesis", label: "The 10X Thesis" },
  ] },
  { label: "Tools · local simulations", links: [
    { href: "/elections", label: "Selection rehearsals" },
    { href: "/backing", label: "Backing lab" },
    { href: "/launch-lab", label: "Curve lab" },
    { href: "/launch-recovery", label: "Recovery lab" },
    { href: "/rewards", label: "Reward lab" },
    { href: "/admin/10x", label: "Admin controls" },
  ] },
];

export function DiscoveryNav({ path }: { path: string }) {
  const more = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && more.current && !more.current.contains(event.target)) more.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const secondary = groups.flatMap(group => group.links).find(link => path === link.href || (link.href === "/elections" && path.startsWith("/elections/")));
  return <nav aria-label="10X discovery navigation" className="tenx-nav tenx-nav--compact">
    {primary.map(link => <a key={link.href} href={link.href} aria-current={link.matches(path) ? "page" : undefined}>{link.label}</a>)}
    <details ref={more} className="tenx-more" data-active={secondary ? true : undefined} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
    }} onKeyDown={event => {
      if (event.key === "Escape" && more.current?.open) {
        more.current.open = false;
        more.current.querySelector("summary")?.focus();
      }
    }} onClick={event => {
      if (event.target instanceof Element && event.target.closest("a") && more.current) more.current.open = false;
    }}>
      <summary aria-label={secondary ? `More navigation, current section: ${secondary.label}` : "More navigation"}>More</summary>
      <div className="tenx-more-links">{groups.map(group => <section key={group.label} aria-label={group.label}>
        <h2>{group.label}</h2>{group.links.map(link => <a key={link.href} href={link.href} aria-current={secondary?.href === link.href ? "page" : undefined}>{link.label}</a>)}
      </section>)}</div>
    </details>
  </nav>;
}
