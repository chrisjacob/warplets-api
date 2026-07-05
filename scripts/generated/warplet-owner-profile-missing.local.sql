
    SELECT wallet, fid, username
    FROM wallet_farcaster_links
    WHERE wallet IS NOT NULL
      AND fid IS NOT NULL
      AND (pfp_url IS NULL OR profile_bio_text IS NULL OR follower_count IS NULL OR following_count IS NULL)
    ORDER BY fid ASC
    LIMIT 10000
  