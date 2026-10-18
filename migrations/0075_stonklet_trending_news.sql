-- Keep immutable archives; observe the new hourly news strategy before activation.
UPDATE stonklet_spotlight_control SET strategy_version='trending-news-v3',
  mode=CASE WHEN mode='off' THEN 'off' ELSE 'shadow' END, current_thesis_id=NULL,
  trial_started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
