"""Audited Network-only bootstrap. Artifacts contain public profile/wallet data: keep private.

export --source SOURCE.sqlite --out DIR
verify --bundle DIR
restore-test --bundle DIR --target NEW.sqlite
import --bundle DIR --account ID --database ID --wrangler PATH [--write-budget N]

Production import is explicit, resumable and preserves all unrelated tables.
The full source history stays in the preservation archive; bootstrap keeps one snapshot per UTC day.
"""
import argparse, base64, gzip, hashlib, json, os, pathlib, re, sqlite3, subprocess, time, tomllib, urllib.error, urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[2]
TABLES=('network_events','network_candidates','network_confirmed','network_profiles',
 'network_profile_failures','network_member_profiles','network_wallet_associations','network_wallet_links',
 'network_wallet_values','network_wallet_retries','network_asset_prices','network_credit_budgets',
 'network_activity_months','network_activity_checks','network_alchemy_budgets','network_alchemy_metadata',
 'network_geo_states','network_geo_cities','network_geo_aliases','network_geo_primary_names',
 'network_geo_parent_names','network_geo_city_admin','network_profile_locations','network_budgets','network_sync')
BUDGETS={'network_budgets':'attempts','network_credit_budgets':'reserved','network_alchemy_budgets':'reserved'}
SYNC_KEYS=('scan','candidate_refresh','chain_retry_after','wallet_cooldown','activity_cooldown')
MIGRATIONS=('0095_network.sql','0096_network_members.sql','0097_network_wallets.sql','0098_network_activity.sql',
 '0099_network_alchemy.sql','0100_network_geography.sql','0101_network_geography_matching.sql',
 '0102_network_warplet_holders.sql','0103_network_warplet_images.sql')
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as stream:
  for b in iter(lambda:stream.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def literal(value):
 if value is None:return 'NULL'
 if isinstance(value,(int,float)):return str(value)
 if not isinstance(value,str) or '\x00' in value:raise ValueError('Unsupported SQLite value')
 return "'"+value.replace("'","''")+"'"
def columns(db,table):return [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
def snapshots(db):
 for row in db.execute('SELECT id,created_at,day,complete,payload FROM network_snapshots WHERE created_at IN (SELECT MAX(created_at) FROM network_snapshots GROUP BY day) ORDER BY created_at'):
  data=json.loads(row[4]);cells=data.get('cells')
  if data.get('cellsEncoding')=='gzip-json-v1':
   compressed=base64.b64decode(data['cellsGzip'],validate=True)
   with gzip.GzipFile(fileobj=__import__('io').BytesIO(compressed)) as stream:raw=stream.read(16_000_001)
   if len(raw)>16_000_000:raise ValueError('Snapshot decompression exceeds budget')
   cells=json.loads(raw)
  elif data.get('cellsEncoding') is not None:raise ValueError('Unknown snapshot encoding')
  if not isinstance(cells,list) or sum(c['count'] for c in cells)!=data['population']:raise ValueError('Snapshot population mismatch')
  if len(row[4].encode())>1_800_000:raise ValueError('Snapshot storage budget exceeded')
  yield row
def export(source,out):
 out.mkdir(parents=True,exist_ok=False)
 db=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);db.execute('BEGIN')
 manifest={'version':1,'createdAt':int(time.time()*1000),'tables':{},'chunks':[],'historyPolicy':'latest snapshot per UTC day; full history retained in private preservation archive'}
 try:
  if db.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('Source foreign-key violation')
  for table in TABLES:
   cols=columns(db,table)
   if not cols:raise ValueError('Missing source table '+table)
   query=f'SELECT * FROM "{table}"'
   if table=='network_sync':query+=' WHERE key IN ('+','.join(literal(k) for k in SYNC_KEYS)+')'
   keycols=[r[1] for r in sorted(db.execute(f'PRAGMA table_info("{table}")'),key=lambda r:r[5]) if r[5]]
   query+=' ORDER BY '+','.join('"'+c+'"' for c in keycols)
   suffix=' ON CONFLICT DO NOTHING;\n'
   if table in BUDGETS:
    counter=BUDGETS[table];suffix=f' ON CONFLICT DO UPDATE SET {counter}=MAX({table}.{counter},excluded.{counter});\n'
   prefix='INSERT INTO "'+table+'"('+','.join('"'+c+'"' for c in cols)+') VALUES '
   statements=[];chunkbytes=0;rowcount=0;statementrows=[];statementbytes=len(prefix);chunkrows=0
   def flush_chunk():
    nonlocal statements,chunkbytes,chunkrows
    if not statements:return
    name=f'{len(manifest["chunks"]):04d}-{table}.sql';path=out/name
    path.write_text(''.join(statements),encoding='utf8',newline='\n')
    manifest['chunks'].append({'file':name,'sha256':sha(path),'table':table,'rows':chunkrows,'bytes':path.stat().st_size})
    statements=[];chunkbytes=0;chunkrows=0
   def flush_statement():
    nonlocal statementrows,statementbytes,chunkbytes,chunkrows
    if not statementrows:return
    text=prefix+','.join(statementrows)+suffix
    if chunkbytes+len(text.encode())>4_000_000:flush_chunk()
    statements.append(text);chunkbytes+=len(text.encode());chunkrows+=len(statementrows)
    statementrows=[];statementbytes=len(prefix)
   for row in db.execute(query):
    item='('+','.join(literal(v) for v in row)+')';size=len(item.encode())+1
    if size+len(prefix)+len(suffix)>90_000:raise ValueError('Row exceeds SQL transfer budget in '+table)
    if statementbytes+size+len(suffix)>90_000 or len(statementrows)>=500:flush_statement()
    statementrows.append(item);statementbytes+=size;rowcount+=1
   flush_statement();flush_chunk();manifest['tables'][table]={'columns':cols,'rows':rowcount}
   print(json.dumps({'exported':table,'rows':rowcount}),flush=True)
  history=out/'snapshots.jsonl.gz';count=0
  with gzip.open(history,'wt',encoding='utf8') as stream:
   for row in snapshots(db):stream.write(json.dumps(row,separators=(',',':'))+'\n');count+=1
  manifest['snapshots']={'file':history.name,'sha256':sha(history),'rows':count}
  manifest['schema']={name:sha(ROOT/'migrations'/name) for name in MIGRATIONS}
  (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
 finally:db.close()
 verify(out)
def verify(bundle):
 manifest=json.loads((bundle/'manifest.json').read_text())
 if manifest['version']!=1 or set(manifest['tables'])!=set(TABLES):raise ValueError('Unexpected handoff schema')
 for item in [*manifest['chunks'],manifest['snapshots']]:
  name=item['file'];path=(bundle/name).resolve()
  if path.parent!=bundle.resolve() or sha(path)!=item['sha256']:raise ValueError('Artifact checksum mismatch')
 for name,digest in manifest['schema'].items():
  if name not in MIGRATIONS or sha(ROOT/'migrations'/name)!=digest:raise ValueError('Migration checksum mismatch')
 return manifest
def restore_test(bundle,target):
 manifest=verify(bundle)
 if target.exists():raise ValueError('Restore target must be new')
 db=sqlite3.connect(target)
 try:
  db.execute('CREATE TABLE unrelated_sentinel(value TEXT)');db.execute("INSERT INTO unrelated_sentinel VALUES('preserved')");db.commit()
  for name in MIGRATIONS:db.executescript((ROOT/'migrations'/name).read_text())
  for chunk in manifest['chunks']:db.executescript((bundle/chunk['file']).read_text(encoding='utf8'))
  with gzip.open(bundle/manifest['snapshots']['file'],'rt',encoding='utf8') as stream:
   db.executemany('INSERT INTO network_snapshots VALUES(?,?,?,?,?)',(json.loads(line) for line in stream))
  db.commit()
  # Replay proves idempotence and budget preservation; does not replace tables.
  for chunk in manifest['chunks']:db.executescript((bundle/chunk['file']).read_text(encoding='utf8'))
  for table,info in manifest['tables'].items():
   if db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]!=info['rows']:raise ValueError('Restore count mismatch: '+table)
  if db.execute('PRAGMA foreign_key_check').fetchone() or db.execute('PRAGMA quick_check').fetchone()!=('ok',):raise ValueError('Restore integrity failure')
  if db.execute('SELECT value FROM unrelated_sentinel').fetchone()!=('preserved',):raise ValueError('Unrelated records changed')
  if len(list(snapshots(db)))!=manifest['snapshots']['rows']:raise ValueError('Snapshot restore mismatch')
 finally:db.close()
 (bundle/'restore-verification.json').write_text(json.dumps({'passed':True,'manifestSha256':sha(bundle/'manifest.json'),'tables':len(TABLES),'snapshots':manifest['snapshots']['rows'],'replayVerified':True}))
 print(json.dumps({'restoreVerified':True,'target':str(target)}),flush=True)
def token():
 if os.environ.get('CLOUDFLARE_API_TOKEN'):return os.environ['CLOUDFLARE_API_TOKEN']
 candidates=[pathlib.Path(os.environ.get('APPDATA',''))/'xdg.config/.wrangler/config/default.toml',pathlib.Path.home()/'.config/.wrangler/config/default.toml']
 for path in candidates:
  if path.exists():return tomllib.loads(path.read_text())['oauth_token']
 raise ValueError('Run wrangler login or provide CLOUDFLARE_API_TOKEN')
def remote_query(account,database,sql,params=None):
 request=urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database}/query',data=json.dumps({'sql':sql,'params':params or []}).encode(),headers={'Authorization':'Bearer '+token(),'Content-Type':'application/json'})
 with urllib.request.urlopen(request,timeout=90) as response:data=json.load(response)
 if not data.get('success') or any(not r.get('success') for r in data['result']):raise RuntimeError('D1 query failed')
 return data['result']
def import_remote(bundle,args):
 manifest=verify(bundle)
 proof=bundle/'restore-verification.json'
 if not proof.exists() or json.loads(proof.read_text())['manifestSha256']!=sha(bundle/'manifest.json'):raise ValueError('Verified restoration required before remote import')
 # The operator must keep ingestion and public serving disabled until verification.
 for table,info in manifest['tables'].items():
  actual=[r['name'] for r in remote_query(args.account,args.database,f'PRAGMA table_info("{table}")')[0]['results']]
  if actual!=info['columns']:raise ValueError('Production schema mismatch: '+table)
 statepath=bundle/'remote-progress.json';state=json.loads(statepath.read_text()) if statepath.exists() else {'chunks':[],'snapshots':[],'rowsWritten':0,'day':time.strftime('%Y-%m-%d',time.gmtime())}
 today=time.strftime('%Y-%m-%d',time.gmtime())
 if state['day']!=today:state['day']=today;state['rowsWritten']=0
 def save():statepath.write_text(json.dumps(state,indent=2))
 for chunk in manifest['chunks']:
  key='bootstrap:'+chunk['sha256']
  existing=remote_query(args.account,args.database,'SELECT value FROM network_sync WHERE key=?',[key])[0]['results']
  if existing:continue
  if state['rowsWritten']+chunk['rows']*4>args.write_budget:save();raise RuntimeError('Configured daily bootstrap write budget reached; resume next UTC day')
  command=['node',str(args.wrangler),'d1','execute','warplets','--remote','--file',str(bundle/chunk['file']),'--json','--yes']
  result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
  (bundle/'last-import.log').write_text(result.stdout+result.stderr)
  if result.returncode:raise RuntimeError('Wrangler import failed; inspect private last-import.log')
  try:reported=sum(r.get('meta',{}).get('rows_written',0) for r in json.loads(result.stdout))
  except (ValueError,TypeError):reported=chunk['rows']*4
  state['rowsWritten']+=max(reported,chunk['rows'])
  remote_query(args.account,args.database,'INSERT INTO network_sync(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING',[key,json.dumps({'file':chunk['file'],'rows':chunk['rows']}),int(time.time()*1000)])
  state['chunks'].append(chunk['file']);save();print(json.dumps({'imported':chunk['file'],'rowsWrittenToday':state['rowsWritten']}),flush=True)
 with gzip.open(bundle/manifest['snapshots']['file'],'rt',encoding='utf8') as stream:
  for line in stream:
   row=json.loads(line)
   remote_query(args.account,args.database,'INSERT INTO network_snapshots(id,created_at,day,complete,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING',row)
   if row[0] not in state['snapshots']:state['snapshots'].append(row[0]);save()
 counts={}
 for table,info in manifest['tables'].items():
  if table=='network_sync':continue
  counts[table]=remote_query(args.account,args.database,f'SELECT COUNT(*) n FROM "{table}"')[0]['results'][0]['n']
  if counts[table]<info['rows']:raise ValueError('Production row count mismatch: '+table)
 (bundle/'remote-verification.json').write_text(json.dumps({'manifestSha256':sha(bundle/'manifest.json'),'counts':counts,'verifiedAt':int(time.time()*1000)},indent=2))
 remote_query(args.account,args.database,'INSERT INTO network_sync(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',['bootstrap:ready',json.dumps({'manifestSha256':sha(bundle/'manifest.json'),'verifiedAt':int(time.time()*1000)}),int(time.time()*1000)])
 print(json.dumps({'remoteImportVerified':True,'tables':len(counts)}),flush=True)
def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['export','verify','restore-test','import']);p.add_argument('--source',type=pathlib.Path);p.add_argument('--out',type=pathlib.Path);p.add_argument('--bundle',type=pathlib.Path);p.add_argument('--target',type=pathlib.Path);p.add_argument('--account');p.add_argument('--database');p.add_argument('--wrangler',type=pathlib.Path);p.add_argument('--write-budget',type=int,default=4_000_000);a=p.parse_args()
 if a.action=='export':export(a.source.resolve(),a.out.resolve())
 elif a.action=='verify':print(json.dumps({'verified':True,'chunks':len(verify(a.bundle)['chunks'])}))
 elif a.action=='restore-test':restore_test(a.bundle,a.target)
 else:
  if not re.fullmatch(r'[a-f0-9]{32}',a.account or '') or not re.fullmatch(r'[a-f0-9-]{36}',a.database or '') or not a.wrangler:raise ValueError('Explicit account, database and Wrangler path required')
  if a.database!='45a4cc4c-788e-48dd-89bf-7b504b17655d':raise ValueError('This release targets the existing warplets database only')
  import_remote(a.bundle.resolve(),a)
if __name__=='__main__':main()
