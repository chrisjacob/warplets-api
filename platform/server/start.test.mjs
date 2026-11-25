import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalServer} from './start.mjs';
test('local adapter preserves independent Set-Cookie headers during timeline/session changes',async t=>{
 const server=createLocalServer(()=>{
  const headers=new Headers({location:'/'});
  headers.append('set-cookie','timeline=season-0; Path=/; HttpOnly');
  headers.append('set-cookie','session=; Path=/; Max-Age=0');
  return new Response(null,{status:303,headers});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const response=await fetch('http://127.0.0.1:'+server.address().port,{redirect:'manual'});
 assert.equal(response.status,303);
 assert.deepEqual(response.headers.getSetCookie(),['timeline=season-0; Path=/; HttpOnly','session=; Path=/; Max-Age=0']);
});
