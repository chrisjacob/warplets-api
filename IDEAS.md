# Ideas

## Leverage The Best Friends Social Graph For Marketing

Use Neynar Best Friends data, buyer activity, notifications, and email to create social-proof-driven campaigns.

### 1. Best-Friend-Aware Buyer Avatars

For the `Buyers:` avatar row:

- Start with the 100 latest buyers.
- Compare those buyers to the viewer's roughly 100 Best Friends.
- Keep any matches and sort them by `mutual_affinity_score` descending.
- If there are 10 or more matches, show the top 10 matching friends.
- If there are fewer than 10 matches, show those matching friends first, then fill the remaining avatar slots from the top latest buyers by Neynar score.

Example: if 3 of my Best Friends are in the past 100 buyers, show those 3 first on the left, then fill the remaining 7 spots from the top 10 latest buyers by Neynar score.

### 2. Daily Social-Proof Notifications For Matched Non-Buyers

Send one targeted daily notification to users who:

- Had a Warplet match.
- Have not bought yet.
- Had one or more of their top 100 Best Friends purchase in the past 24 hours.

The notification could list the Best Friend usernames as social proof.

### 3. Friend-Bought Notifications For Non-Matched Users

Send targeted notifications to users who do not have a match when one of their Best Friends buys.

This likely becomes more useful once the first 1,000 NFT batch moves from private sale to public sale, because non-matched users could then buy a public NFT.

### 4. Rarity-Based Friend Nudges

For high-rarity NFTs that have not sold:

- Find `warplets_users` who have a high `mutual_affinity_score` with the matched owner.
- Notify those friends and suggest they tell the owner that their NFT is high ranked and will increase in price soon.

### 5. Private-To-Public Batch Deadline Nudges

Before the next 1,000 NFTs move from private sale to public sale:

- Find friends with high `mutual_affinity_score` to users whose private allocation is about to become public.
- Notify those friends and suggest they tell the matched user to act quickly.

### Future Build Surface

These ideas could become campaigns in the notifications admin area, and later expand to email campaigns as well.

## Warplets EVERYWHERE

A mini app where users can create Warplet-themed GIFs and upload them to Giphy and Tenor.

This should support GIFs for both 10X Warplets and the original The Warplets collection. Use the Emerge mini app on Farcaster to generate the image, animation, and GIF output.

This would turn fans into creators and create user-generated content that helps Warplets spread across social media. Pudgy Penguins used a similar strategy and now have thousands of GIFs that people use every day across social platforms.

## Mini App Haptics

The Farcaster SDK supports haptic feedback for user interactions:

https://miniapps.farcaster.xyz/docs/sdk/haptics

Use haptics to bring a more tactile feeling to the mini app experience. Good moments for this include success states, error states, ticking off reward tasks, completing a purchase, unlocking a reward, or any interaction where a subtle physical response would make the app feel more alive.
