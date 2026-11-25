import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export class Store {
  constructor(file=':memory:') {
    if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    const saved=this.db.prepare('SELECT body FROM state WHERE id=1').get();
    this.value=saved?JSON.parse(saved.body):{version:1,id:randomUUID(),createdAt:new Date().toISOString(),wallet:null,artifacts:{},attempts:[],checks:[],notes:[],spentUsd:0,spentLamports:0,budgetUsd:10};
    // An interrupted local child process is never a pass.
    for(const job of this.value.checks)if(job.status==='running'){job.status='interrupted';job.finishedAt=new Date().toISOString();}
    this.save();
  }
  save() {this.db.prepare('INSERT INTO state(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(this.value));}
  close() {this.db.close();}
}
