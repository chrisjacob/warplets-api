import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { buildGoldenScenario } from '../application/fixtures/earn-scenario.mjs';
import { exportBoard } from '../earn/archive.mjs';
test('upgrading populated migration021 fixture preserves every published commitment and award',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
 const directory=new URL('./',import.meta.url),files=readdirSync(directory).filter(name=>/^\d{3}-.*\.sql$/.test(name)).sort();
 for(const file of files.filter(name=>Number(name.slice(0,3))<=21))db.exec(readFileSync(new URL(file,directory),'utf8'));
 const before=await buildGoldenScenario(db);
 for(const file of files.filter(name=>Number(name.slice(0,3))>=22))db.exec(readFileSync(new URL(file,directory),'utf8'));
 assert.deepEqual(exportBoard(db,before.epoch),before.bundle);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n,3);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
