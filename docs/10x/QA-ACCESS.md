# Restricted desktop and iOS QA

Prepared 30 October 2026. **No tunnel is started by these changes.** Public exposure needs owner review first. This gateway serves a compiled launchpad and a separate local database; existing 5194/8797 previews and all product/dev hostnames remain untouched. It is temporary QA infrastructure, not production.

## Access boundaries

- An exact `https://<random>.trycloudflare.com` origin must be configured in both gateway and Worker. Shared `10x.meme` hostnames and arbitrary origins are rejected. Forwarded host, principal and operator headers are not trusted.
- A separately generated server-only transport token authenticates gateway→Worker requests. The private Worker config loads it from its adjacent `.dev.vars`; it never appears in arguments, browser assets or responses. This preserves the pinned HTTPS proof/cookie origin even when the local dev transport rewrites Host. The browser's original Origin is still checked unchanged. The comparison is constant-time; a missing/forged token cannot opt a request into QA mode.
- Owner-issued 256-bit access codes grant at most eight hours; preparation defaults to two hours. Hashed codes live in the private gateway configuration. Plain codes live only in an owner-readable invitation file outside Git. Neither is logged or included in URLs. One active browser session per invitation; restarting the gateway revokes all sessions.
- An invitation is bound to a FID. Farcaster verification remains cryptographic, using the existing Connect UI. Participant reads/votes require a verified invited FID. Wallet-only login does not grant participant access. A wrong FID is rejected before participant mutations; uninvited Farcaster sessions are revoked.
- Gateway exposes auth, participant state/preview, cycle/settlement reads and voting only. Operator APIs, source imports, test principals, financial routes, source files, sourcemaps, dotfiles and arbitrary proxy destinations are blocked. Secrets and wallet vaults never enter this server.
- Cookies are Secure, HttpOnly, host-only and SameSite=Strict. Proofs bind to the public HTTPS origin. Access codes expire during a background/deep-link handoff too: return to the access screen and request a fresh invitation if necessary.
- Global access attempts are limited to ten/minute; auth also retains its existing local caps. This gateway is for supervised QA. It is not a production abuse-control or availability certification.

## Review and start procedure

From `.worktrees/10x-operations`, first run `pnpm --dir meme qa:build` and `pnpm --dir meme qa:migrate`. These create only compiled local output and `meme/.wrangler/restricted-qa-state`. Review the tests, public exposure and invited account list before proceeding.

After separate exposure approval, start a temporary Quick Tunnel to loopback port 8800. Never repoint an existing named tunnel. The gateway initially remains stopped and the tunnel fails closed. Record its generated HTTPS URL, then prepare private invitations:

```powershell
# Only after approval to expose this temporary QA service:
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --url http://127.0.0.1:8800

# A separate terminal; replace the example URL and private directory:
pnpm --dir packages/meme-qa gateway prepare C:/private/10x-qa https://example-qa.trycloudflare.com 1431382
pnpm --dir meme exec wrangler dev --config C:/private/10x-qa/wrangler.jsonc --local --ip 127.0.0.1 --port 8799 --persist-to .wrangler/restricted-qa-state

# Another terminal; no tunnel is launched by this command:
pnpm --dir packages/meme-qa gateway serve C:/private/10x-qa/gateway.json
```

Invite up to **100 reviewed FIDs** by listing them in `prepare`; the generated private Worker config pins that same roster and origin. Keep the generated `.dev.vars`, gateway config and invitations outside Git and backups/reports containing public evidence. The private config contains no remote database ID or route. Do not add balajis: the supplied account is read-only reference data. Use warpmoji only for owner-supervised local login/off-chain proofs. No external account links/settings or funds are changed. A new QA account is optional, not required. Prepare rounds and approved ownership evidence through the loopback operator tooling; no operator functionality is available over the tunnel. No synthetic test principal is inserted into this database.

For the isolated operator terminal, set `$env:MEME_OPERATOR_TARGET = 'restricted-qa'` before `pnpm --dir meme operator init` or any operator request. This selects port 8799, the separate persistence directory and a separate operator token. The default target remains the original preview; arbitrary destinations are not supported. Do not run `demo` when recording real-account evidence: its data is simulated.

Privately open the invitation file on this workstation. Type its code on the QA access screen; do not paste it into chat, URLs, screenshots or reports. Verify unauthenticated/expired access, wrong FID, operator/financial rejection and HTTPS challenge URI before inviting anyone else. Stopping cloudflared removes exposure; stopping the gateway revokes access sessions. Keep both stopped when unattended. Delete or archive private invitations separately from the database; never commit them.

`gateway:probe <private-gateway.json>` verifies the actual local HTTP round-trip with a disposable EOA proof and an inert `isolated-qa.trycloudflare.com` hostname. It requires a separately started loopback Worker and never opens a tunnel or contacts that hostname. Local execution and Linux CI verify origin-bound Secure cookies, preserved 401 responses and blocked operator/financial/explorer/secret routes. This remains distinct from physical-phone or real-user signing evidence.

The service uses the documented [Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) temporary URL and lifecycle. Cloudflare email access can provide an additional layer if supported by the installed connector and explicitly configured; this implementation does not depend on that optional feature.

## Wallet recovery before funding

The existing QA vault remains under `%LOCALAPPDATA%/10x/qa-wallets/2026-10-30`, protected with CurrentUser DPAPI. Its public addresses remain unchanged. Run the following **yourself in a private terminal**, with a unique 20+ character passphrase stored separately in your password manager:

```powershell
./packages/meme-qa/src/recovery.ps1 backup "$env:LOCALAPPDATA/10x/qa-wallets/2026-10-30"
./packages/meme-qa/src/recovery.ps1 verify "$env:LOCALAPPDATA/10x/qa-wallets/2026-10-30"
# On a separate supported Windows profile/machine, copy only the encrypted
# portable envelope and public-manifest.json into a private source directory:
./packages/meme-qa/src/recovery.ps1 restore C:/private/qa-recovery C:/private/restored-qa-vault
pnpm --dir packages/meme-qa wallets verify C:/private/restored-qa-vault
```

Portable backup uses scrypt (N=131072,r=8,p=1), random salt and AES-256-GCM with a versioned authenticated purpose. Wrong passwords/tampering fail closed. Restores protect the same keys with the new profile's DPAPI; existing vaults are never replaced. Passphrases use hidden terminal input and stdin, never arguments/environment. No plaintext key file or key-printing CLI exists. Recovery tooling is tested with disposable keys; **the owner has not yet run a portable backup, cross-profile restore or wallet import/use check**. These remain funding gates, and no funding is requested. Copy the encrypted backup to separate secure storage and verify the public-address checksum independently before relying on it.

## Physical-device matrix

Record device/OS/browser/wallet versions, origin, build commit, FID and observed result. Never record signatures, passphrases, session cookies or private keys. Synthetic browser tests remain separate evidence.

| Journey | Desktop | Physical iOS | Android |
| --- | --- | --- | --- |
| Farcaster login, wrong-origin/expired proof, cancel/reconnect | Pending owner | Pending owner | Public-release gate |
| Base injected EOA, account/network change | Pending owner | Pending wallet handoff | Public-release gate |
| Base smart account / passkey (separate from EOA) | Pending owner | Pending owner | Public-release gate |
| Solana Wallet Standard proof, cancel/reconnect | Pending owner | Pending supported wallet | Public-release gate |
| App background, deep-link return, access expiry, logout | Pending owner | Pending owner | Public-release gate |
| Vote/change vote, freeze, selection/skip, rewards/history | Automated local fixtures; real-account pending | Pending owner | Public-release gate |

Off-chain message proofs do not spend gas. Any financial wallet prompt requires a separately reviewed transaction packet and human final confirmation. Physical iOS is available; Android remains blocked coverage and a general public release gate.
