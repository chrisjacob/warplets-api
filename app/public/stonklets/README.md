# Stonklets artwork

The UI uses the supplied artwork directly:

- `chip.png`
- `orbit.png`
- `core.png`
- `volt.png`

`chip.png` is also the temporary app icon, splash, share preview, manifest
image, and ecosystem-menu art. The remaining catalog entries continue to use
stable existing Warplet images as placeholders.

`stocks/` contains local, unmodified stock-side artwork. The 39 Binance
bStock icons were downloaded from Binance's official static CDN using the
icon paths returned by its public RWA metadata API. `tether-gold.png` is the
official circular Tether Gold mark because XAUT is not a Binance bStock.
Original URLs are recorded in `asset-sources.json`.
