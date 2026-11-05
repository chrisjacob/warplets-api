import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { readApi, failure } from './api.mjs';

export function createLocalServer(handler = readApi) {
  return createServer(async (req,res) => {
    try {
      // Pin the origin. Incoming Host and proxy headers never determine API authority.
      const target = req.url ?? '/';
      if (!target.startsWith('/') || target.startsWith('//')) throw new Error('Invalid URL');
      const request = new Request('http://localhost'+target, {method:req.method});
      const response = await handler(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      const response = failure(400,'invalid_request','Invalid request.');
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const server = createLocalServer();
  server.listen(port,'127.0.0.1',()=>console.log('10X validation API at http://127.0.0.1:'+port+'/api/v1/policy'));
}
