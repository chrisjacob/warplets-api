"""Local-only Social schema removal. Dry-run by default; never contacts Cloudflare.

Usage: python scripts/remove-retired-app-local.py --local --database PATH [--apply]
Backups and full verification reports remain in the ignored recovery directory.
"""
import argparse
import hashlib
import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
RECOVERY = ROOT / '.tmp/social-removal-recovery'
MIGRATIONS = {
    '0076_social.sql', '0080_social_daily_picks.sql', '0081_social_economy.sql',
    '0082_social_identity_attribution.sql', '0083_social_cohort_integrity.sql',
    '0084_social_review_hardening.sql', '0085_social_score_allocations.sql',
    '0086_social_read_efficiency.sql', '0087_social_reward_reads.sql',
    '0088_social_boosts.sql', '0089_social_boost_metadata.sql',
    '0090_social_resumable_scores.sql', '0091_social_monthly_merit.sql',
    '0092_social_metadata_versions.sql', '0093_social_allocation_adjustments.sql',
    '0094_social_reward_summary.sql',
}

def quote(name):
    return '"' + name.replace('"', '""') + '"'

def fingerprint(db):
    result = {}
    for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
        if name.startswith(('social_', 'sqlite_')):
            continue
        columns = {row[1] for row in db.execute('PRAGMA table_info(' + quote(name) + ')')}
        hashes = []
        cursor = db.execute('SELECT * FROM ' + quote(name))
        names = [column[0] for column in cursor.description]
        for row in cursor:
            record = dict(zip(names, row))
            if record.get('app_slug') == 'social' or (name == 'd1_migrations' and record.get('name') in MIGRATIONS):
                continue
            encoded = json.dumps(row, default=lambda v: {'blob': v.hex()}, separators=(',', ':')).encode()
            hashes.append(hashlib.sha256(encoded).digest())
        result[name] = {'count': len(hashes), 'sha256': hashlib.sha256(b''.join(sorted(hashes))).hexdigest()}
    return result

def run(target, apply=False):
    path = pathlib.Path(target).resolve(strict=True)
    allowed = [ROOT / '.wrangler/state', ROOT / 'app/.wrangler/state', RECOVERY]
    if path.suffix != '.sqlite' or not any(path.is_relative_to(base.resolve()) for base in allowed):
        raise ValueError('Only explicit local SQLite paths inside approved persistence/recovery directories are allowed')
    db = sqlite3.connect(path.as_uri() + '?mode=' + ('rw' if apply else 'ro'), uri=True, timeout=30)
    db.execute('PRAGMA cache_size=-131072')
    try:
        objects = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name GLOB 'social_*'").fetchall()
        all_tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        scoped = []
        for name in sorted(all_tables):
            if name.startswith(('social_', 'sqlite_')):
                continue
            if any(row[1] == 'app_slug' for row in db.execute('PRAGMA table_info(' + quote(name) + ')')):
                count = db.execute('SELECT count(*) FROM ' + quote(name) + " WHERE app_slug='social'").fetchone()[0]
                if count:
                    scoped.append((name, count))
        report = {'database': str(path.relative_to(ROOT)), 'objects': [row[:3] for row in objects], 'scoped_rows': scoped, 'applied': False}
        if not apply:
            return report
        pending = [] if 'd1_migrations' not in all_tables else [row[0] for row in db.execute('SELECT name FROM d1_migrations') if row[0] in MIGRATIONS]
        if not objects and not scoped and not pending:
            return dict(report, applied=True, already_clean=True)
        RECOVERY.mkdir(parents=True, exist_ok=True)
        # A reserved write lock briefly pauses other local writers, while readers remain usable.
        db.execute('PRAGMA foreign_keys=OFF')
        db.execute('BEGIN IMMEDIATE')
        print('Fingerprinting preserved tables under a write lock...', file=sys.stderr, flush=True)
        before = fingerprint(db)
        prior_fk = db.execute('PRAGMA foreign_key_check').fetchall()
        prior_integrity = db.execute('PRAGMA quick_check').fetchall()
        if prior_integrity != [('ok',)]:
            raise RuntimeError('Existing database integrity check failed')
        backup = RECOVERY / ('database-' + hashlib.sha256(str(path).encode()).hexdigest()[:16] + '.sqlite')
        if not backup.exists():
            print('Creating consistent recovery backup...', file=sys.stderr, flush=True)
            reader = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
            destination = sqlite3.connect(backup)
            try:
                reader.backup(destination)
            finally:
                destination.close(); reader.close()
        social_tables = {name for kind, name, _, _ in objects if kind == 'table'}
        print('Removing inventoried Social objects...', file=sys.stderr, flush=True)
        for table in all_tables - social_tables:
            for fk in db.execute('PRAGMA foreign_key_list(' + quote(table) + ')'):
                if fk[2] in social_tables:
                    raise RuntimeError('Preserved table references Social: ' + table)
        # Remove triggers on shared tables before any Social-owned table.
        for kind, name, _, _ in objects:
            if kind in ('trigger', 'view'):
                db.execute('DROP ' + kind.upper() + ' IF EXISTS ' + quote(name))
        for kind, name, _, sql in objects:
            if kind == 'table' and sql and 'CREATE VIRTUAL TABLE' in sql.upper():
                db.execute('DROP TABLE ' + quote(name))
        remaining = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'social_*'")]
        for name in remaining:
            db.execute('DROP TABLE ' + quote(name))
        for name, _ in scoped:
            db.execute('DELETE FROM ' + quote(name) + " WHERE app_slug='social'")
        if 'd1_migrations' in all_tables:
            db.executemany('DELETE FROM d1_migrations WHERE name=?', [(name,) for name in MIGRATIONS])
        after = fingerprint(db)
        print('Checking preserved data and database integrity...', file=sys.stderr, flush=True)
        if before != after:
            raise RuntimeError('Preserved data changed; transaction rolled back')
        after_fk = db.execute('PRAGMA foreign_key_check').fetchall()
        if any(row not in prior_fk for row in after_fk):
            raise RuntimeError('New foreign key violation; transaction rolled back')
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise RuntimeError('Integrity check failed')
        if db.execute("SELECT count(*) FROM sqlite_master WHERE name GLOB 'social_*'").fetchone()[0]:
            raise RuntimeError('Social schema remains')
        db.commit()
        report.update(applied=True, preserved=after, backup=str(backup.relative_to(ROOT)), existing_fk_violations=len(prior_fk))
        (RECOVERY / (backup.stem + '-report.json')).write_text(json.dumps(report, indent=2))
        return report
    finally:
        db.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local', action='store_true', required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(run(args.database, args.apply), indent=2))
