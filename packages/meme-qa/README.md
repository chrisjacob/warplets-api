# Isolated launchpad QA

See [MAINNET-QA.md](../../docs/10x/MAINNET-QA.md) for custody, provenance, commands and pending gates. This package is development-only. Never import it into the browser, Worker, shared Connect, or production builds.

```sh
pnpm --dir packages/meme-qa check
pnpm --dir packages/meme-qa exec playwright install chromium
pnpm --dir packages/meme-qa test:browser
pnpm --dir packages/meme-qa test:chains
pnpm --dir packages/meme-qa benchmark:reads
```

Solana execution requires Linux x64. Windows reports those tests as **skipped**; the Ubuntu CI job must pass them. Anvil and the browser suite also run on Windows. Fixture tests never contact a live chain. Do not fund local simulator keys.

The captured deployed program archive is checksummed in `fixtures/programs.json`. It contains public executable data, not wallets or secrets. Any binary/authority change requires explicit review. Program source correspondence and production readiness remain unproven until independently checked.
