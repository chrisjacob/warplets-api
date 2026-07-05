# Random Search Terms Review

Generated from `random-search-terms.txt` plus repeated phrases found in the Warplets metadata CSV.

Applied final pass:

- Final applied list: 360 rows, 360 unique terms.
- The final active list is in `random-search-terms.txt` and mirrored in `SearchApp.tsx`.
- Kept your requested exceptions from the discard bucket: `Lit`, `Neon`, `Hot`, `Dressed`, `Revealing`, `Pattern`, `Simple`, `Crisp`, `Demeanor`, `Tone`, `Energy`.
- Added the stronger suggested metadata phrases.
- Removed duplicates, trailing `Warplet/Warplets` terms, weak generic terms, and secondary one-word colour searches such as `Tan`, `Beige`, `Cream`, `Magenta`, `Lavender`, `Maroon`, `Cyan`, `Indigo`, `Peach`, `Olive`, `Mint`, `Lime`, `Navy`, `Sage`, and `Mustard`.

Original review notes:

- Current list size: 299 rows, 295 unique terms.
- Duplicate current terms: `Quirky`, `Furry`, `Spotted`, `Striped`.
- The app displays random results as `[Topic] Warplets...`, so the best terms read naturally in that sentence.
- The app normalizes FTS as prefix terms. For example, `Bumpy` becomes `"Bumpy"*`. Without stemming, `Bumpy` and `Bumps` are different searches.
- Candidate addition counts below are observed matches in structured metadata/description fields, not a live SQLite FTS count, but every listed candidate was selected because it appears 10+ times and should be useful for FTS.

## Keep Current Terms

These read naturally as `[Topic] Warplets...` and/or are strong search intents.

```txt
Wizard Hat
Pink Bunny
Sharp Teeth
Wide Eyes
Open Mouth
Pink Tongue
Wide Mouth
"Purple Background"
"Black Background"
"Grey Background"
"Light Blue Background"
"Blue Background"
"Teal Background"
"Orange Background"
"Pink Background"
"Red Background"
"White Background"
"Dark Blue Background"
"Dark Grey Background"
"Green Background"
"Yellow Background"
"Brown Background"
Solid Purple
Solid Black
Solid Blue
Solid Teal
Solid Orange
Solid Red
Solid Grey
Sunglasses
Round Glasses
Black Sunglasses
Black T-Shirt
White T-Shirt
Collared Shirt
Baseball Cap
Backward Cap
Cigarette
Lit Cigarette
Fangs
Toothy Grin
Wide Grin
Gaping Mouth
Huge Open Mouth
Wide Open Mouth
Closed Eyes
Droopy Eyes
Glowing Eyes
Bulging Eyes
Half-Closed Eyes
Winking Eye
Heavy-Lidded Eyes
Furrowed Brows
Dark Eye Circles
Grumpy Expression
Excited Expression
Mischievous Expression
Neutral Expression
Smiling Expression
Subtle Smile
Chill Vibe
Playful Monster
Cartoon Monster
Cartoon Creature
Playful Creature
Quirky
Furry
Spotted
Striped
Bumpy Skin
Textured Skin
Purple Skin
Green Skin
Blue Skin
Brown Skin
Dark Grey Skin
Pink Skin
Green Bumpy Skin
Pointed Ears
Clawed Feet
Clawed Hands
Small Clawed Feet
Small Clawed Hands
Small Black Pupils
Black Pupils
Wide White Eyes
Large White Eyes
Large Wide Eyes
Sharp White Teeth
Sharp Pointed Teeth
Downturned Mouth
Closed Mouth
Smiling Mouth
Black Suit Jacket
Black Hoodie
White Collared Shirt
Rainbow
Neon Green
Hot Pink
Red
Blue
Green
Yellow
Orange
Purple
Pink
Black
White
Grey
Brown
Gold
Silver
Teal
Tan
Beige
Cream
Magenta
Lavender
Maroon
Cyan
Indigo
Peach
Olive
Mint
Lime
Navy
Sage
Mustard
Dog
Cat
Robot
Bunny
Rabbit
Bird
Frog
Bear
Alien
Wizard
Dragon
Fish
Duck
Monkey
Happy
Sad
Angry
Grumpy
Excited
Sleepy
Chill
Cool
Playful
Mischievous
Quirky
Dapper
Neutral
Smiling
Winking
Serious
Intense
Surprised
Confident
Hat
Cap
Beanie
Helmet
Hoodie
Shirt
Jacket
Suit
Tie
Glasses
Coffee
Crown
Hood
Collar
Bumpy
Textured
Hair
Smoke
Vibrant
Sharp
Striking
Pointed
Sports
Standout
Expressive
Bold
Stylish
Sleek
Iconic
Massive
Captivating
Clawed
Eye-catching
Glowing
Formidable
Bright
Cartoon
Wild
Memorable
Gaping
Energetic
Impressive
Classic
Aesthetic
Closed
Aura
Rare
Casual
Powerful
Sporting
Collared
Stripes
Personality
Charming
Mysterious
Lumpy
```

## Consider Discarding Or Replacing

These are duplicated, too generic, awkward before `Warplets...`, or likely to create weak/random-feeling previews.

```txt
Furry (duplicate; keep one)
Quirky (duplicate; keep one)
Spotted (duplicate; keep one)
Striped (duplicate; keep one)
Gray (duplicate-ish with Grey; dataset appears to prefer Grey)
Almost
Lit
Rectangular
Pale
Neon
Hot
Teeth
Tongue
Mouth
Eyes
Pupils
Ears
Nose
Brows
Feet
Hands
Claws
Smile
Grin
Fur
Expression
Wide
Open
Prominent
Adorned
Dressed
Charm
Subtle
Revealing
Presence
Slightly
Clean
Texture
Perfectly
Touch
Pop
Pattern
Embodying
Simple
Crisp
Gaze
Demeanor
Tone
Showcasing
Numerous
Energy
Round
Hand
Setting
Collection
Spots
Matching
Standing
Covered
Attire
Excitement
Downturned
Uniquely
Tiny
Statement
Eye
Complete
Huge
Color
Style
Spirit
Blend
Plain
Stand
Front
Deep
Left
Feature
Surprise
Pure
Right
Hue
```

## New Terms To Consider Adding

These were selected because they read naturally as `[Topic] Warplets...` and appeared 10+ times in the metadata. Counts are observed metadata matches.

```txt
Wide-Set Eyes (577)
Unimpressed (568)
Wide-Open White Eyes (340)
Furrowed Brow (307)
Furry Body (265)
Goggles (245)
Straight Mouth (236)
Closed-Mouth Smile (228)
White Fur (222)
Blue Eyes (218)
Warrior (211)
Lumpy Skin Texture (208)
Brown Spots (208)
Red Tongue (203)
Headphones (195)
Yellow Eyes (192)
Formal Attire (192)
Sleepy Expression (189)
Top Hat (187)
Sharp Fangs (184)
Gold Trim (180)
Streetwear (178)
Curious Expression (163)
Cat Ears (163)
Black Baseball Cap (162)
Playful Expression (162)
Grey Bumpy Skin (160)
Cool Vibe (157)
Bumpy Texture (155)
Mottled Skin (155)
Striped Body (151)
Grey Hoodie (148)
Menacing Expression (146)
Purple Monster (142)
Tired Eyes (140)
Neutral Mouth (139)
Gentle Smile (136)
Blue T-Shirt (136)
Blue Hoodie (136)
Large Eyes (136)
Fedora Hat (134)
Plain White Background (134)
Light Green Background (133)
Wide-Eyed Monster (132)
Cat-Like Ears (132)
Black Glasses (132)
Round Sunglasses (130)
Fierce Expression (128)
Short Sleeves (126)
Bow Tie (122)
Dark Purple Background (120)
Cracked Skin (119)
Smartphone (118)
Happy Expression (118)
Black Jacket (123)
Dark Grey Hoodie (118)
Gold Chain (112)
Small Pupils (109)
Striped Fur (109)
Plain Background (108)
Small Fangs (108)
Stoic Expression (107)
Startled Expression (105)
Long Pink Tongue (105)
Hood Up (105)
Light Blue Skin (105)
Front Pouch Pocket (105)
Pale Skin (105)
Silver Zipper (103)
Smooth Skin (102)
Wide-Eyed Creature (102)
Heavy Eyelids (100)
Black Top Hat (98)
Goofy Expression (98)
Smug Expression (96)
Speckled Skin (96)
Street Style (95)
Red Skin (95)
Gold Crown (94)
Straight Line Mouth (92)
Glowing Red Eyes (91)
Manic Expression (91)
White Dress Shirt (91)
Casual Outfit (90)
Blue Baseball Cap (90)
Orange Spots (90)
Hooded Cloak (89)
Green Frog (88)
Big Eyes (87)
Beige Skin (87)
Unique Skin (87)
White Hoodie (84)
Blue Shirt (85)
Red Tie (82)
Lavender Background (82)
Scaly Skin (82)
Droopy Eyelids (82)
Flat Mouth (82)
Gold Buttons (82)
Worried Expression (81)
Dapper Monster (81)
Pink Inner Ears (80)
Reddish-Brown Skin (80)
Backward Baseball Cap (80)
Straw Hat (79)
Wide Bulging Eyes (79)
White Collar (77)
Suit Jacket (77)
Light Beige Skin (77)
Round Black-Rimmed Glasses (75)
Peach Skin (75)
Large Round Eyes (75)
Relaxed Expression (74)
Formal Wear (74)
Quirky Monster (73)
Black Tank Top (73)
Black Shirt (72)
Whiskers (71)
Small Smile (70)
Grey T-Shirt (70)
Sharp Teeth Monster (70)
Furry Monster (70)
Cartoon Character (69)
Goofy Monster (69)
Pink Tongue With Teeth (68)
Huge Gaping Mouth (68)
Squinted Eyes (68)
White Belly (67)
Red Baseball Cap (67)
Light Blue Irises (67)
Edgy (66)
Red Hoodie (65)
Large Bulging Eyes (65)
Stern Expression (64)
Closed Smile (63)
Plaid Shirt (62)
Blue-Grey Background (62)
Dark Grey Bumpy Skin (61)
Glowing Blue Eyes (60)
Extremely Wide Open Mouth (59)
Glowing Yellow Eyes (59)
Dark Grey Pants (59)
White Tank Top (55)
Red T-Shirt (55)
White Sclera (56)
Pink Bumpy Tongue (56)
Speckled Skin (55)
Dark Blue Skin (55)
Sharp-Toothed Creature (54)
Purple Top Hat (52)
Smoking Pipe (52)
Orange Beak (51)
Lime Green Background (45)
Blue Jeans (45)
Black Beanie (39)
Red Bandana (35)
Yellow T-Shirt (35)
```

## Recommended Next Pass

If applying this:

1. De-dupe the current list first.
2. Remove the discard/replacement bucket unless you specifically want occasional chaotic/random copy.
3. Add the strongest new multi-word phrases first.
4. Prefer multi-word phrases over one-word grammar terms because they read better and tend to produce more intentional FTS results.
5. Keep the final list around 350-425 terms. That gives variety without flooding the random picker with weak phrases.
