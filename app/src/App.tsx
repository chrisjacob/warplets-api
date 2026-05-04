import { Text } from "@neynar/ui/typography";

const APPS = [
  {
    title: "10X Warplets Drop",
    path: "/drop",
    description: "Live now. Buy, claim, and share your Warplet.",
    accent: "#00FF00",
  },
  {
    title: "10X Warplets Find",
    path: "/find",
    description: "Coming soon. Discover Warplets and rarity faster.",
    accent: "#67e8f9",
  },
  {
    title: "$1M Warplet",
    path: "/million",
    description: "Coming soon. Dedicated mission for the $1M run.",
    accent: "#fde047",
  },
];

function launch(path: string) {
  const url = `${window.location.origin}${path}`;
  window.location.href = url;
}

export default function App() {
  return (
    <div
      className="relative min-h-screen bg-black text-white flex flex-col items-center px-4 py-8"
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(0,255,0,0.15),_rgba(0,0,0,0.95)_60%)]" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <Text className="text-[2.4rem] font-bold text-center" style={{ color: "#00FF00" }}>
          10X
        </Text>
        <Text className="mt-2 text-center text-sm" style={{ color: "#b7ffb7" }}>
          Launchpad for all 10X mini apps.
        </Text>

        <div className="mt-6 space-y-3">
          {APPS.map(app => (
            <button
              key={app.path}
              type="button"
              onClick={() => launch(app.path)}
              className="w-full rounded-2xl border bg-black/40 px-4 py-4 text-left transition-colors hover:bg-black/60 cursor-pointer"
              style={{ borderColor: `${app.accent}80` }}
            >
              <Text className="text-lg font-bold" style={{ color: app.accent }}>
                {app.title}
              </Text>
              <Text className="mt-1 text-xs" style={{ color: "#d9d9d9" }}>
                {app.description}
              </Text>
              <Text className="mt-2 text-[11px] uppercase tracking-wide" style={{ color: "#9ca3af" }}>
                {app.path}
              </Text>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
