import { lazy, Suspense, useState } from "react";
const Preferences = lazy(() => import("./NotificationSettings"));
/** No preference request or settings chunk until the user actually opens this section. */
export default function NotificationDisclosure({
  fid,
  onReconnect,
}: {
  fid: number;
  onReconnect: () => void;
}) {
  const [activated, setActivated] = useState(false);
  return (
    <details
      className="card"
      onToggle={(event) => {
        if (event.currentTarget.open) setActivated(true);
      }}
    >
      <summary>Notifications</summary>
      {activated && (
        <Suspense fallback={<p role="status">Loading preferences…</p>}>
          <Preferences fid={fid} onReconnect={onReconnect} />
        </Suspense>
      )}
    </details>
  );
}
