import type { ReactNode } from "react";
export function SimulationNotice({ children }: { children?: ReactNode }) {
  return <aside className="tenx-notice tenx-simulation"><strong>Simulation — no real votes or rewards.</strong><p>No tokens are launched or funds moved.</p>{children && <details><summary>About this simulation</summary>{children}</details>}</aside>;
}
