import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJson} from '../security/canonical.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {readRecoveryV2SourceMetadata} from './v2-schema.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {parseRecoveryV2Checkpoint,packRecoveryV2Tables,packRecoveryV2CheckpointDelta} from './v2-checkpoint.mjs';
const table=name=>({name,columns:['id','body'],primaryKey:['id'],hasRowid:false,rowCount:0,pages:{identity:null,count:0},tableDigest:'a'.repeat(64)});
test('private tuple encoding preserves every descriptor value and old object checkpoints',()=>{
 const tables=[table('alpha'),table('beta')],legacy={revision:3,phase:'tables',tables},raw=canonicalJson(legacy),packed={...legacy,...packRecoveryV2CheckpointDelta({tables})};
 assert.deepEqual(parseRecoveryV2Checkpoint(raw),legacy);assert.deepEqual(parseRecoveryV2Checkpoint(canonicalJson(packed)),legacy);assert.equal(canonicalJson(legacy),raw);
 assert.deepEqual(packRecoveryV2CheckpointDelta({tables:null}),{tables:null,tablesPackedV1:null});
 assert.deepEqual(parseRecoveryV2Checkpoint(canonicalJson({...packed,tables:null,tablesPackedV1:null})),{...legacy,tables:null,tablesPackedV1:null});
});
test('unknown, ambiguous, malformed, reordered and extra-field checkpoint tuples fail closed',()=>{
 const tables=[table('alpha'),table('beta')],packed=packRecoveryV2Tables(tables),parse=value=>parseRecoveryV2Checkpoint(canonicalJson(value));
 for(const value of [{tables,tablesPackedV1:packed},{tablesPackedV2:packed},{tablesPackedV1:{}},{tablesPackedV1:[packed[0].slice(1)]},{tablesPackedV1:[[...packed[0],'extra']]},{tablesPackedV1:[packed[1],packed[0]]},{tablesPackedV1:[packed[0],packed[0]]},{tablesPackedV1:[[...packed[0].slice(0,3),'false',...packed[0].slice(4)]]}])assert.throws(()=>parse(value),/checkpoint|v2/);
 assert.throws(()=>packRecoveryV2Tables([{...table('alpha'),uncommitted:true}]),/descriptor fields/);assert.throws(()=>packRecoveryV2CheckpointDelta({tablesPackedV1:packed}),/direct packed/);
});
test('installed descriptor projection saves more than eight KiB without changing any commitment',async t=>{
 const db=openDatabase();t.after(()=>db.close());const crypto=createNodeCrypto(),schema=await readInstalledRecoverySchema(crypto),source=await readRecoveryV2SourceMetadata(createNodeAtomicDriver(db),{schema,crypto}),codec=createRecoveryV2Codec({crypto}),tables=[];
 for(const name of source.tableNames){const fields=db.prepare('SELECT name,pk FROM pragma_table_info(?) ORDER BY cid').all(name),definition=db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(name).sql;tables.push(await codec.tableDescriptor({name,columns:fields.map(v=>v.name),primaryKey:fields.filter(v=>v.pk>0).sort((a,b)=>a.pk-b.pk).map(v=>v.name),hasRowid:! /\bWITHOUT\s+ROWID\b/i.test(definition),rowCount:0,pages:{identity:null,count:0}}));}
 const legacy=canonicalJson({tables}),packed=canonicalJson(packRecoveryV2CheckpointDelta({tables})),saved=Buffer.byteLength(legacy)-Buffer.byteLength(packed);assert.deepEqual(parseRecoveryV2Checkpoint(packed),{tables});assert.ok(saved>8192);t.diagnostic(JSON.stringify({tables:tables.length,legacyBytes:Buffer.byteLength(legacy),packedBytes:Buffer.byteLength(packed),savedBytes:saved,projectionOnly:true}));
});
