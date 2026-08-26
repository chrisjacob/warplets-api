export type SpaHistoryMode = "push" | "replace";

type SpaHistoryWriter = Pick<History, "pushState" | "replaceState">;

/**
 * Some embedded iOS hosts observe pushState as a new Mini App navigation and
 * recreate the WebView, which replays the host splash screen. Keep the URL in
 * sync for deep links, but replace the current entry while embedded so React
 * remains mounted. Browser launches retain normal back-button history.
 */
export function writeSpaHistory(
  history: SpaHistoryWriter,
  state: unknown,
  url: string,
  options: { mode: SpaHistoryMode; embedded: boolean },
): SpaHistoryMode {
  const effectiveMode = options.embedded || options.mode === "replace" ? "replace" : "push";
  if (effectiveMode === "replace") {
    history.replaceState(state, "", url);
  } else {
    history.pushState(state, "", url);
  }
  return effectiveMode;
}
