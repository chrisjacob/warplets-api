import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('operation hold renders without changing original awaiting-evidence status or claiming fulfillment',async t=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());
 const {CollectionOperationHold}=await vite.ssrLoadModule('/src/collection-operation.tsx'),{receiptModel}=await vite.ssrLoadModule('/src/models.ts');
 const base={id:'synthetic-operation',kind:'upgrade',inventoryId:'synthetic-season',owner:'synthetic-owner',status:'awaiting-evidence',createdAt:'2026-11-01T00:00:00.000Z',stageId:null,targetId:'target',materialId:'material',assetId:null,priceLamports:null,feeLamports:'10000000',costLamports:null};
 assert.equal(renderToStaticMarkup(React.createElement(CollectionOperationHold,{operation:receiptModel.parse(base)})),'');
 const operation=receiptModel.parse({...base,reconciliation:{status:'held',reason:'external-transfer',observedAt:'2026-10-31T23:59:59.000Z'}}),html=renderToStaticMarkup(React.createElement(CollectionOperationHold,{operation}));
 assert.match(html,/Held after an observed transfer; no fulfillment recorded/);assert.match(html,/original request remains awaiting evidence/);assert.equal(operation.status,'awaiting-evidence');assert.doesNotMatch(html,/fulfilled|refunded|cancelled/);
 assert.equal(receiptModel.safeParse({...base,reconciliation:{status:'resolved',reason:'external-transfer',observedAt:base.createdAt}}).success,false);
});
