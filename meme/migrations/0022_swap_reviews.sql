-- Independent swap journal. Never masquerade as a reward claim or modify historical launch intents.
CREATE TABLE meme_swap_orders(id TEXT PRIMARY KEY,operation_key TEXT NOT NULL,network TEXT NOT NULL,wallet TEXT NOT NULL,plan_hash TEXT NOT NULL,packet_hash TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('prepared','awaiting_approval','submitted','unknown','confirmed','failed','cancelled')),simulation TEXT,signature TEXT UNIQUE,revision INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(network,wallet,operation_key));
CREATE UNIQUE INDEX meme_one_active_swap ON meme_swap_orders(network,wallet) WHERE state IN('prepared','awaiting_approval','submitted','unknown');
CREATE TABLE meme_swap_events(order_id TEXT NOT NULL REFERENCES meme_swap_orders(id),revision INTEGER NOT NULL,state TEXT NOT NULL,evidence TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(order_id,revision));
CREATE TABLE meme_swap_receipts(order_id TEXT PRIMARY KEY REFERENCES meme_swap_orders(id),signature TEXT NOT NULL UNIQUE,proof TEXT NOT NULL,confirmed_at INTEGER NOT NULL);
CREATE TRIGGER meme_swap_review_fixed BEFORE UPDATE OF id,operation_key,network,wallet,plan_hash,packet_hash,payload,created_at ON meme_swap_orders BEGIN SELECT RAISE(ABORT,'Immutable swap review');END;
CREATE TRIGGER meme_swap_review_kept BEFORE DELETE ON meme_swap_orders BEGIN SELECT RAISE(ABORT,'Immutable swap review');END;
CREATE TRIGGER meme_swap_event_fixed BEFORE UPDATE ON meme_swap_events BEGIN SELECT RAISE(ABORT,'Immutable swap event');END;
CREATE TRIGGER meme_swap_event_kept BEFORE DELETE ON meme_swap_events BEGIN SELECT RAISE(ABORT,'Immutable swap event');END;
CREATE TRIGGER meme_swap_receipt_fixed BEFORE UPDATE ON meme_swap_receipts BEGIN SELECT RAISE(ABORT,'Immutable swap receipt');END;
CREATE TRIGGER meme_swap_receipt_kept BEFORE DELETE ON meme_swap_receipts BEGIN SELECT RAISE(ABORT,'Immutable swap receipt');END;
