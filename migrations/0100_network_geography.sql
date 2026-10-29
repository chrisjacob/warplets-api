-- Network-only canonical public geography; safe to replay locally.
CREATE TABLE IF NOT EXISTS network_geo_states(id TEXT PRIMARY KEY,country TEXT NOT NULL,name TEXT NOT NULL,aliases TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS network_geo_states_country ON network_geo_states(country);
CREATE TABLE IF NOT EXISTS network_geo_cities(id TEXT PRIMARY KEY,country TEXT NOT NULL,state TEXT NOT NULL,name TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL);
CREATE TABLE IF NOT EXISTS network_geo_aliases(country TEXT NOT NULL,alias TEXT NOT NULL,city TEXT NOT NULL,PRIMARY KEY(country,alias,city));
CREATE INDEX IF NOT EXISTS network_geo_cities_state ON network_geo_cities(state);
CREATE TABLE IF NOT EXISTS network_profile_locations(fid INTEGER PRIMARY KEY,description TEXT NOT NULL,place_id TEXT, country TEXT,state TEXT,city TEXT,observed_at INTEGER NOT NULL,source TEXT NOT NULL DEFAULT 'official-client+geonames');
CREATE INDEX IF NOT EXISTS network_profile_locations_state ON network_profile_locations(state,fid);
CREATE INDEX IF NOT EXISTS network_profile_locations_city ON network_profile_locations(city,fid);
