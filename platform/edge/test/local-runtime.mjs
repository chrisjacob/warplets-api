import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync,readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function localRuntime(t,entry,{nodeCompat=false}={}) {
  const bundle=await build({entryPoints:[fileURLToPath(entry)],bundle:true,platform:'browser',format:'esm',write:false,target:'es2022',...(nodeCompat?{external:['node:*']}:{})});
  const mf=new Miniflare({workers:[{config:{name:'tenx-atomic-test',type:'worker',compatibilityDate:'2026-08-25',
    ...(nodeCompat?{compatibilityFlags:['nodejs_compat']}:{}),manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},
    env:{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000001'},MANIFESTS:{type:'r2',name:'tenx-local-manifests'}}}}]});
  t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
  const directory=new URL('../../storage/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()) {
    const statements=[];let current='';
    for(const line of readFileSync(new URL(name,directory),'utf8').replace(/^--.*$/gm,'').split(/\r?\n/)) {
      current+=(current?'\n':'')+line;const value=current.trim();
      if(value.endsWith(';')&&(!value.startsWith('CREATE TRIGGER')||/\bEND;$/i.test(value))) {statements.push(db.prepare(value));current='';}
    }
    if(current.trim())throw Error('Incomplete migration '+name);
    await db.batch(statements);
  }
  return {mf,db};
}
