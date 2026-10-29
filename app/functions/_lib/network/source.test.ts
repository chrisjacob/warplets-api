import {createServer} from 'node:http';
import {once} from 'node:events';
import {expect,it} from 'vitest';
import {networkFetchJson} from './source';

it('rejects redirects without following them and still reads bounded JSON',async()=>{
 const paths:string[]=[];
 const server=createServer((request,response)=>{
  paths.push(request.url!);
  if(request.url==='/redirect'){response.writeHead(302,{location:'/target'});response.end();}
  else{response.setHeader('content-type','application/json');response.end('{"ok":true}');}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing test port');
  const base=`http://127.0.0.1:${address.port}`;
  await expect(networkFetchJson(base+'/redirect')).rejects.toThrow('HTTP 302');
  expect(paths).toEqual(['/redirect']);
  await expect(networkFetchJson(base+'/target')).resolves.toEqual({ok:true});
  await expect(networkFetchJson(base+'/target',{},2)).rejects.toThrow('too large');
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
