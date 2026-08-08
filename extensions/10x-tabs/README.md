# 10X Tabs (experimental)

Chrome-only Developer Mode experiment built with Extension.js `4.0.28`. It has
zero declared permissions and zero host permissions.

- New Tab immediately navigates top-level to
  `https://warplet.10x.meme/tabs?display=newtab&source=10x-tabs`.
- Clicking the toolbar action opens the same HTTPS application in an
  approximately Farcaster-sized top-level popup window.
- It does not iframe the site, inject content scripts, load remote extension
  code, auto-update itself or attest usage.

## Build and inspect

```sh
pnpm --dir extensions/10x-tabs stamp
pnpm --dir extensions/10x-tabs build
```

Create a release from an exact clean commit, publish the generated Chrome ZIP,
its SHA-256 and build provenance, then install by extracting it and choosing
Chrome → Extensions → Developer mode → Load unpacked. Updates are manual.

This redirect-only experiment is intentionally not submitted to the Chrome Web
Store. A future store build should wait for the Attention feed and bundle a
meaningful New Tab experience.
