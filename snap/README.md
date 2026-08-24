# 10X Warplets Drop Snap archive

Read-only Farcaster Snap v2 archive for `https://snap.10x.meme/drop`.

The active historical implementation and its D1 data stay in the root Worker.
This isolated Worker never records new claims or poll votes; `/drop/poll` and
`/drop/claim` intentionally return the same retirement state as `/drop`.

```sh
pnpm --dir snap dev
pnpm --dir snap build
pnpm --dir snap deploy
```

Configure the `snap.10x.meme` custom domain before deployment. The preview
environment expects `snap-preview.10x.meme` unless `SNAP_PUBLIC_BASE_URL` is
overridden.
