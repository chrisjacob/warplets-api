-- Indexed canonical name tiers and administrative parent evidence.
CREATE TABLE IF NOT EXISTS network_geo_primary_names(country TEXT NOT NULL,alias TEXT NOT NULL,city TEXT NOT NULL,PRIMARY KEY(country,alias,city));
CREATE TABLE IF NOT EXISTS network_geo_parent_names(country TEXT NOT NULL,alias TEXT NOT NULL,state TEXT NOT NULL,admin2 TEXT NOT NULL,PRIMARY KEY(country,alias,admin2));
CREATE TABLE IF NOT EXISTS network_geo_city_admin(city TEXT PRIMARY KEY,admin2 TEXT NOT NULL);
