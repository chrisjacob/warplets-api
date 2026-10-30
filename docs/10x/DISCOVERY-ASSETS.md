# Root mini-app discovery assets

Prepared and visually checked local PNGs: `icon.png` (512×512), `social-mini.png` (1200×800), `social-og.png` (1200×630). They use the app's existing dark/lime wordmark and the pinned offline font/renderer. No token performance or fabricated live launch appears on the root card.

```text
node meme/scripts/brand-assets.mjs
```

Vite emits escaped Open Graph and Farcaster Mini App metadata using its exact loopback origin during development. A build only includes canonical/image/embed URLs when `MEME_PUBLIC_ORIGIN` is explicitly supplied as an exact HTTPS origin without a trailing slash. With no approved origin, the build does not guess a production domain or publish an embed/canonical URL. Icon and source-derived per-result card assets remain independently available in the local bundle.

The manifest stays a template in `meme/config`; association values and origin remain owner placeholders. Its image and webhook paths now match the implemented assets/disabled registration route. No `/.well-known/farcaster.json` is published, no Base project is registered, and no application ID or credential is copied from another product. Current framing restrictions remain intact. Production host/frame allowlists, canonical-origin association, Base/web registration, notification permission and physical host wallet QA remain explicit activation gates.

Base uses the existing repository's standard web/Base Account surface. That does not imply an EVM wallet can sign Solana trades or that tokens were bridged. See [mini-app runtime](MINI-APP.md), [shared Base/web setup](../BASE_WEB_APP_SETUP.md), [social cards](SOCIAL-SHARING.md) and [notification gates](NOTIFICATIONS.md).
