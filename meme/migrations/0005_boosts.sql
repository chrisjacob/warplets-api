CREATE TABLE meme_attribute_cycles(id TEXT PRIMARY KEY,start_day TEXT NOT NULL UNIQUE,seed TEXT NOT NULL,commitment TEXT NOT NULL,order_json TEXT NOT NULL,sealed_at INTEGER NOT NULL);
ALTER TABLE meme_rounds ADD COLUMN cycle_id TEXT REFERENCES meme_attribute_cycles(id);
ALTER TABLE meme_rounds ADD COLUMN cycle_index INTEGER;
CREATE UNIQUE INDEX meme_one_cycle_attribute_round ON meme_rounds(cycle_id,cycle_index) WHERE cycle_id IS NOT NULL;
CREATE TRIGGER meme_cycle_overlap BEFORE INSERT ON meme_attribute_cycles WHEN EXISTS(SELECT 1 FROM meme_attribute_cycles WHERE julianday(NEW.start_day)<julianday(start_day)+10 AND julianday(NEW.start_day)+10>julianday(start_day)) BEGIN SELECT RAISE(ABORT,'Attribute cycles overlap'); END;
CREATE TRIGGER meme_cycle_immutable BEFORE UPDATE ON meme_attribute_cycles BEGIN SELECT RAISE(ABORT,'Attribute cycles are sealed'); END;
CREATE TRIGGER meme_cycle_no_delete BEFORE DELETE ON meme_attribute_cycles BEGIN SELECT RAISE(ABORT,'Attribute cycles are sealed'); END;
