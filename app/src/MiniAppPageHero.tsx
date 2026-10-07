import type { ReactNode } from "react";
import "./MiniAppPageHero.css";

export default function MiniAppPageHero({ title, subtitle, tagline }: {
  title: string;
  subtitle: ReactNode;
  tagline: string;
}) {
  return (
    <header className="miniapp-page-hero">
      <h1>{title}</h1>
      <p className="miniapp-page-hero__subtitle">
        {subtitle}<br />{tagline}
      </p>
    </header>
  );
}
