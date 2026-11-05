import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
let savepointNumber=0;
export function transaction(db, fn) {
  if(db.isTransaction) {
    const name='platform_sp_'+(++savepointNumber);
    db.exec('SAVEPOINT '+name);
    try {const result=fn();db.exec('RELEASE '+name);return result;}
    catch(error){db.exec('ROLLBACK TO '+name);db.exec('RELEASE '+name);throw error;}
  }
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn(); db.exec('COMMIT'); return result; }
  catch(error) { db.exec('ROLLBACK'); throw error; }
}
export function openDatabase(path=':memory:') {
  const db=new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL');
    db.exec('CREATE TABLE IF NOT EXISTS schema_versions(version TEXT PRIMARY KEY) STRICT');
    const directory=new URL('./',import.meta.url);
    for(const name of readdirSync(directory).filter(n=>/^\d{3}-[\w-]+\.sql$/.test(n)).sort()) {
      transaction(db,()=>{
        if(db.prepare('SELECT 1 FROM schema_versions WHERE version=?').get(name)) return;
        db.exec(readFileSync(new URL(name,directory),'utf8'));
        db.prepare('INSERT INTO schema_versions VALUES(?)').run(name);
      });
    }
    return db;
  } catch(error) { db.close(); throw error; }
}
