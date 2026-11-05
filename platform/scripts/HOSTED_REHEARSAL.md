# Local hosted Earn rehearsal

Run from the repository root with the installed pinned dependencies. Build the React client first:

```powershell
Push-Location platform/site
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
Pop-Location
node platform/scripts/rehearse-hosted-slice.mjs
```

The command prints one `http://127.0.0.1:<port>/earn` URL and stays running. `PORT` optionally selects a loopback port; otherwise the OS chooses a free port. Ctrl+C closes the server and disposable local workerd/D1/R2 instance. Every run seeds a fresh fixture. There is no remote resource, deployment, funding or transaction broadcast.

The printed fixture clock is frozen for deterministic evidence. Restart this disposable rehearsal after five minutes to refresh wallet challenges and entry evidence. The browser preview remains readable after that interval, but the frozen challenge timestamps are unsuitable for a new real-time browser sign-in.

## Automated core rehearsal

Supply an installed Playwright module and browser executable. The recorded Windows environment uses these existing local installations:

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/cjacob/Documents/GitHub/WarpletsAPI/.worktrees/10x-operations/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core'
$env:BROWSER_EXE='C:/Users/cjacob/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe'
$env:SCREENSHOT_DIR='work/b20-browser'
node platform/scripts/rehearse-hosted-slice.mjs --verify
```

`SCREENSHOT_DIR` is optional. The verification command closes its resources on completion and prints structured browser and core evidence. Run the `.mjs` entry point directly: Node's `--input-type=module -e` evaluation arguments interfere with the installed Miniflare proxy worker and can stall startup.

The dispatcher serves compiled React assets and forwards `/api/v1/` requests to the actual local Worker without rewriting their browser origin or cookies. It rejects private fixture control paths and unrecognized Host headers. Public initial HTML uses the same capability-aware transport, so unsupported reads are not issued through rendering either. The Vite-to-Node development proxy is not used.

Browser acceptance uses an isolated, synthetic Wallet Standard provider with only message signing. Generated Ed25519 signatures pass the production Worker challenge verification; sessions and admission are recorded in D1. There are no mocked capability, authentication or admission responses in the successful journey. Separate, explicitly labeled UI fault cases cover declined signing, delayed capacity loading and unavailable capability discovery. Responsive checks run at 360, 390, 768 and 1440 pixels.

All transcript history, ownership, pricing and moderation inputs are labeled synthetic. This demonstrates local service composition and recovery, not real-chain end-to-end evidence, physical-wallet compatibility, production performance or approval for financial execution. B20-core evidence does not complete B20's separately gated full profile.
