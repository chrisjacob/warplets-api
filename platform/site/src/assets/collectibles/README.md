# Collectible preview artwork

Genesis uses six existing 10X Warplet images from the URLs recorded in `10x-warplets-metadata.csv`. Cached copies avoid remote browser image requests. These samples do not claim that a demo asset owns the corresponding original Warplet.

Season previews are original AI-generated CATE, PEPE, DOGE, WIF and ANSEM black-bull collectibles. The miniature collectible aesthetic is inspired by Telegram Gifts. Themes, dates and mint terms remain unapproved; no affiliation or endorsement is implied.

`provenance.json` records the built-in generator, prompt set, source URLs and delivery-file hashes. Original generated PNGs remain in untracked `work/nft-art-sources`; committed WebP derivatives are 640px and about23–43KB each. No external model API key was used.

`collection-art.tsx` selects stable presentation samples. Asset Levels, traits, reveal status, economic terms and database rows are not altered. Concealed assets never render a collectible image. Images are lazy-loaded from hashed, same-origin assets; no animation runs when reduced motion is requested.
