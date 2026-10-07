-- A different selection strategy requires a fresh unpublished observation period.
-- Archived theses and run history remain intact.
ALTER TABLE stonklet_spotlight_control ADD COLUMN strategy_version TEXT NOT NULL DEFAULT 'daily-catalyst-v2';
UPDATE stonklet_spotlight_control
SET mode=CASE WHEN mode='off' THEN 'off' ELSE 'shadow' END,
    trial_started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), current_thesis_id=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
