-- Representative current holding, refreshed from saved Warplets ownership only.
ALTER TABLE network_warplet_holders ADD COLUMN token_id INTEGER CHECK(token_id >= 0);
