import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {handleNotifications} from './http.mjs';

test('Node inbox consent shares the SQLite guard clock when HTTP time leads by one millisecond',async t=>{
 const db=openDatabase();t.after(()=>db.close());
 const sqlMs=1794484171000,httpMs=sqlMs+1;
 db.function('unixepoch',_modifier=>sqlMs/1000);
 const origin='http://localhost',token='synthetic-clock-skew',wallet='11111111111111111111111111111111';
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),wallet,origin,httpMs+60000);
 for(const [revision,enabled] of [[0,true],[1,false]]){
  const request=new Request(origin+'/api/v1/notifications/subscriptions',{method:'POST',headers:{origin,cookie:'tenx_local_session='+token,'content-type':'application/json','idempotency-key':'synthetic-clock-'+revision},body:JSON.stringify({channel:'local-inbox',terms:'10x-notice-local-inbox-v1',enabled,topics:enabled?['launch']:[],expectedRevision:revision})});
  const response=await handleNotifications(db,request,'127.0.0.1',httpMs);
  assert.equal(response.status,200,await response.clone().text());
  const row=db.prepare('SELECT revision,enabled,changed_ms FROM notice_preferences').get();
  assert.equal(row.revision,revision+1);assert.equal(row.enabled,Number(enabled));assert.equal(row.changed_ms,sqlMs);
 }
});
