# Current membership and OG boundary

The live dashboard, directory, portfolio queue, location backfill and activity importer use `NETWORK_CURRENT_COHORT`: a saved official-client `opted_in` status plus original chain acceptance or tracker-backed official confirmation. Other statuses are excluded. Source events and the minimal status record remain private audit evidence so a later refresh can detect re-entry; they are not published members. Ordinary profile refresh still checks candidate/status changes.

## OG boundary

The operational boundary is the first verified original `OptInMinted` event, not contract deployment or NFT ownership. Earliest event in the reconciled scan from deployment block 52,601,136:

- Base block **52,606,050**, timestamp **2026-10-14 18:10:47 UTC**, transaction `0xdc37161c321d017ade09a4f23c0407887e52339f49a7456a0ab8b1ad85770aa4`.
- Last Optimism block strictly before that timestamp: **158,201,334**, timestamp **2026-10-14 18:10:45 UTC**.
- Optimism block hash: `0x17abbd032229734666daea0a3ef513b3b20d50d95d6b4d9a2c51a1fea4579c80`.
- Registry `0x00000000fc6c5f01fc30151999387bb99a9f489b`, `idCounter()` at that historical block: **3,354,552**.
- Read via the public Optimism RPC on 21 October 2026, without Alchemy or Neynar credits. The registry address and sequential registration semantics are documented in the [official contracts repository](https://github.com/farcasterxyz/contracts) and [IdRegistry source](https://github.com/farcasterxyz/contracts/blob/main/src/IdRegistry.sol).

This boundary uses the first onchain signature as the start of signing; it does not claim an independently verified public announcement time. OG means FID <= 3,354,552, not present-day ownership of an old account or a unique human.

A member contributes to OG or New in the original signing month, then Continuing in later UTC months with observed Farcaster protocol activity. The three segments reconcile to monthly active members. Missing signing dates remain undated, and legacy snapshots with no classification remain unclassified rather than being assumed New. All chart groups use today's selected, currently opted-in cohort.

## Local preview isolation

`vite.network.config.ts` also bundles `scripts/network/preview-worker.ts` into the ignored local preview's `_worker.js`. This uses the same dashboard, member and history handlers and shared security headers as Pages production code, without compiling unrelated apps. The tunnel only serves allowlisted public GET/HEAD routes, existing country/state map assets and built JS/CSS/PNG files. Worker source, admin endpoints and secrets remain blocked. Production routing is unchanged.

The local proxy holds a short read lease while public API responses are in flight. The Node importer yields before writes (including `RETURNING` budget reservations), so the local emulator can finish its reads. The lease expires after 30 seconds if the proxy exits. This only coordinates local SQLite connections; production D1 and provider caps are unchanged.
