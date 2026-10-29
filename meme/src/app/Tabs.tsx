export type Tab = "Today" | "Rewards" | "History";
export function Tabs({
  value,
  onChange,
}: {
  value: Tab;
  onChange: (value: Tab) => void;
}) {
  const tabs: Tab[] = ["Today", "Rewards", "History"];
  return (
    <nav aria-label="Launchpad">
      <div role="tablist" aria-label="Launchpad views">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            id={"tab-" + tab}
            role="tab"
            aria-selected={tab === value}
            aria-controls="launchpad-panel"
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => {
              let next: number | undefined;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              if (event.key === "Home") next = 0;
              if (event.key === "End") next = tabs.length - 1;
              if (next !== undefined) {
                event.preventDefault();
                onChange(tabs[next]);
                document.getElementById("tab-" + tabs[next])?.focus();
              }
            }}
          >
            {tab}
          </button>
        ))}
      </div>
    </nav>
  );
}
