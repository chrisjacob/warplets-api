export function helpText(): string {
  return [
    "10X Warplets commands",
    "",
    "/search <terms> — search Warplets",
    "/random — show a random Warplet",
    "/item <token id> — item details",
    "/warpmoji <emoji> — match one emoji to a Warplet",
    "/stats [overview|market|activity|holders]",
    "/favourites — your linked-wallet favourites",
    "/favourite add|remove <token id>",
    "/alerts enable|disable <topic>",
    "/link — securely link a verified wallet",
    "/ask <question> — grounded read-only query",
    "",
    "Trading actions always open the 10X app for review and wallet signature.",
  ].join("\n");
}

export function localCommandReply(name: string): string | null {
  return name === "help" ? helpText() : null;
}
