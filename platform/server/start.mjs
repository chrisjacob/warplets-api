import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { failure } from './api.mjs';
import { openDatabase } from '../storage/database.mjs';
import { createApp } from './application.mjs';
import {nodeArtifactStore} from '../artifacts/node.mjs';

export function createLocalServer(handler) {
  const ownedDb=handler?null:openDatabase();
  handler??=createApp(ownedDb);
  const server=createServer(async (req,res) => {
    try {
      const port=server.address().port;
      const allowed=['127.0.0.1:'+port,'localhost:'+port];
      if(!allowed.includes(req.headers.host)) {res.writeHead(403);res.end();return;}
      const target=req.url??'/';
      if(!target.startsWith('/')||target.startsWith('//')||target.includes('\\')) {res.writeHead(400);res.end();return;}
      const chunks=[];let bytes=0;
      for await(const chunk of req) {
        bytes+=chunk.length;
        if(bytes>32768) {res.writeHead(413);res.end();return;}
        chunks.push(chunk);
      }
      if(bytes&&['GET','HEAD'].includes(req.method)) {res.writeHead(400);res.end();return;}
      const request=new Request('http://'+req.headers.host+target,{method:req.method,headers:req.headers,
        body:bytes?Buffer.concat(chunks):undefined});
      const response=await handler(request,req.socket.remoteAddress);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      const response = failure(500,'internal_error','Request could not be completed.');
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    }
  });
  server.requestTimeout=15000; server.headersTimeout=10000;
  if(ownedDb) server.once('close',()=>ownedDb.close());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const dir=new URL('../.local/',import.meta.url);
  mkdirSync(dir,{recursive:true});
  const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
  const server=createLocalServer(createApp(db,{artifactStore:nodeArtifactStore(fileURLToPath(new URL('artifacts/',dir)))}));
  server.once('close',()=>db.close());
  server.listen(port,'127.0.0.1',()=>console.log('10X validation API at http://127.0.0.1:'+port+'/api/v1/policy'));
}
