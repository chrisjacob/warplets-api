// Build a reviewable Stonklets-only artifact from the combined development commit.
// Social remains committed on the development branch but is not deployed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const baseline = '10aa4291a71cfff6f247cbbea8900524dc416572';
const revision = process.argv[2] || 'HEAD';
const root = process.cwd();
const commit = execFileSync('git', ['rev-parse', revision], {encoding:'utf8'}).trim();
const output = path.join(root, '.tmp', `stonklets-release-${commit.slice(0,12)}`);
if (existsSync(output)) throw new Error(`Release already exists: ${output}`);
const restored = new Set(['app/functions/_lib/appSlug.ts','app/functions/_lib/authValidation.ts','app/functions/_lib/security.ts','app/functions/api/auth/wallet/challenge.ts','app/functions/webhook.ts','app/functions/webhook/[appSlug].ts','app/shared/favicons.ts','app/src/main.tsx','app/src/miniAppChrome.tsx','app/src/SearchApp.tsx','app/functions/index.ts']);
const omitted = file => /^(?:contracts\/|scripts\/social-|scripts\/dev-tunnel-social|docs\/social-|migrations\/0076_social|app\/functions\/api\/social\/|app\/functions\/api\/admin\/social\.|app\/functions\/_lib\/social|app\/shared\/social|app\/src\/(?:Social|socialClient|MiniAppPageHero)|app\/public\/(?:embed_social|favicon-social|icon_social|manifest-social|splash_social))/.test(file);
const files = execFileSync('git',['ls-tree','-r','--name-only',commit],{encoding:'utf8'}).trim().split('\n');
const excluded=[];
for (const file of files) {
  if (omitted(file)) {excluded.push(file);continue;}
  let contents=execFileSync('git',['show',`${restored.has(file)?baseline:commit}:${file}`],{maxBuffer:100*1024*1024});
  if(file==='app/functions/index.ts') contents=Buffer.from(contents.toString().replace('parseStonkletChangeRange(requestUrl.searchParams.get("change")) ?? "24h")','parseStonkletChangeRange(requestUrl.searchParams.get("change")) ?? "24h", requestUrl.searchParams.get("news") ?? requestUrl.searchParams.get("thesis"))'));
  if(file==='src/production-scheduler.ts') contents=Buffer.from(contents.toString().replace(/^import .*social(?:Ingestion|Store).*\r?\n/gm,'').replace(' & SocialEnv','').replace(/^  \/\/ Separate opt-in task.*\r?\n/gm,'').replace(/^  ctx.waitUntil\(ingestSocial.*\r?\n/gm,''));
  if(file==='app/vite.config.ts') contents=Buffer.from(contents.toString().replace(/^import .*socialMetadata.*\r?\n/gm,'').replace(/          if \(pathname === "\/\.well-known\/farcaster.json" && isSocialRoute[\s\S]*?\n          }\r?\n/,'').replace(/^        if \(isSocialRoute.*\r?\n/gm,'').replace(/^      "social-local.10x.meme",\r?\n/gm,'').replace('requestHost === "social-local.10x.meme" || ',''));
  if(file==='app/package.json') {const pkg=JSON.parse(contents);delete pkg.scripts['local:tunnel:social'];contents=Buffer.from(JSON.stringify(pkg,null,2)+'\n');}
  const target=path.join(output,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,contents);
}
for(const file of ['app/src/main.tsx','app/functions/index.ts','src/production-scheduler.ts','app/vite.config.ts']) {
  if(/SocialApp|socialMetadata|ingestSocial|SOCIAL_CSP/.test(readFileSync(path.join(output,file),'utf8'))) throw new Error(`Social reference remains: ${file}`);
}
writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({commit,baseline,restored:[...restored],excluded,scope:'Stonklets; Social excluded'},null,2));
console.log(output);
