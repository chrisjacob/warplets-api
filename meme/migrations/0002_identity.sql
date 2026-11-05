CREATE TABLE meme_sessions(token_hash TEXT PRIMARY KEY,origin TEXT NOT NULL,fid INTEGER,wallet TEXT,expires_at INTEGER NOT NULL);
CREATE TABLE meme_challenges(nonce TEXT PRIMARY KEY,kind TEXT NOT NULL,origin TEXT NOT NULL,address TEXT,fid INTEGER,role TEXT,session_hash TEXT,message TEXT,issued_at TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER);
CREATE TABLE meme_wallet_links(fid INTEGER NOT NULL,chain TEXT NOT NULL,address TEXT NOT NULL,role TEXT NOT NULL,verified_at INTEGER NOT NULL,revoked_at INTEGER,proof_hash TEXT NOT NULL,PRIMARY KEY(fid,chain,address));
CREATE UNIQUE INDEX meme_one_reward_wallet ON meme_wallet_links(fid) WHERE chain='solana' AND role='reward' AND revoked_at IS NULL;
CREATE TABLE meme_channels(token TEXT PRIMARY KEY,recovery_hash TEXT NOT NULL,nonce TEXT NOT NULL,uri TEXT NOT NULL,origin TEXT NOT NULL,expires_at INTEGER NOT NULL,started_at INTEGER,verified_fid INTEGER);
CREATE TABLE meme_auth_limits(bucket TEXT NOT NULL,window INTEGER NOT NULL,attempts INTEGER NOT NULL,PRIMARY KEY(bucket,window));
CREATE TABLE meme_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL,detail TEXT NOT NULL);
CREATE TABLE meme_operator_tokens(token_hash TEXT PRIMARY KEY,label TEXT NOT NULL,created_at INTEGER NOT NULL);

CREATE TABLE meme_nonce_uses(nonce TEXT PRIMARY KEY NOT NULL REFERENCES meme_challenges(nonce));
