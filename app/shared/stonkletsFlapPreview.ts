// Explicit local hosts only: never enable test markets on a production URL.
export function isStonkletsFlapPreview(url: URL): boolean {
  return url.searchParams.get("flap") === "1" && [
    "localhost", "127.0.0.1", "[::1]", "stonklet-local.10x.meme", "app-local.10x.meme",
  ].includes(url.hostname.toLowerCase());
}
