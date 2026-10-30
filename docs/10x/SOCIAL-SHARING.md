# Share cards and social actions

Cards for candidates, launches, performance, rank and P&L are derived from server-published market/trading snapshots. A caller cannot supply a gain, rank or identity label. Corrections create new source/card IDs; existing cards and PNGs remain immutable. No wallet addresses or private reward destinations enter cards. Simulated mode, window, as-of time, coverage and fee treatment travel with the image. Ranking is trading performance, not reward allocation.

The authenticated loopback operator publishes a card and both images:

```text
pnpm --dir meme operator share-publish performance <market-id> 24h
pnpm --dir meme operator share-publish pnl trading 24h <fid>
```

The offline renderer reuses patched Satori 0.33.5/resvg with the pinned bundled Inter font. It fetches no fonts, images or remote URLs. Rendering occurs before publication, outside public requests. PNGs are 1200×800 (Farcaster) and 1200×630 (Open Graph); the Worker serves immutable bytes, ETags and escaped crawlable HTML. Uploads are operator-only and trusted as rendering output; independent adversarial operator-image certification is outside this local adapter. Public lookup only returns cards after both images exist. Missing/pending images return uncached errors.

The Share button opens the host composer only when supported, otherwise the system share sheet or clipboard. The user always initiates sharing. No posts are sent by a scheduled job or a test. No sharing reward exists. Local URLs cannot be crawled publicly; no tunnel was opened. Production needs its approved canonical origin, account association, registration and crawler access before host embed QA.

References: [Farcaster sharing and PNG requirements](https://miniapps.farcaster.xyz/docs/guides/sharing), [existing mini-app operations](MINI-APP.md).
