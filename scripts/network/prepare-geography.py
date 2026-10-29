"""Prepare canonical offline geography and optionally seed shared local D1.
Run: python scripts/network/prepare-geography.py --local
Production seeds are staged manually within actual D1 allowances.
"""
import argparse, sys, collections, hashlib, json, pathlib, re, sqlite3, unicodedata, urllib.request, zipfile
parser=argparse.ArgumentParser();parser.add_argument('--local',action='store_true');parser.add_argument('--maps-only',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2];base=root/'.tmp/network-geo';base.mkdir(parents=True,exist_ok=True)
sources={
 'cities500.zip':'https://download.geonames.org/export/dump/cities500.zip',
 'admin1.txt':'https://download.geonames.org/export/dump/admin1CodesASCII.txt',
 'PH.zip':'https://download.geonames.org/export/dump/PH.zip',
 'admin2.txt':'https://download.geonames.org/export/dump/admin2Codes.txt',
 'countryInfo.txt':'https://download.geonames.org/export/dump/countryInfo.txt',
 'states.json':'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'}
for filename,url in sources.items():
 if not (base/filename).exists():urllib.request.urlretrieve(url,base/filename)
def key(v):return re.sub(r'[^\w]+',' ',''.join(c for c in unicodedata.normalize('NFKD',v) if not unicodedata.combining(c)).lower(),flags=re.UNICODE).strip().replace('_',' ')
prefix=r'^(?:state of |republic of |respublika |province of |region of |federal territory of |special region of |metropolitan city of |citta metropolitana di |provincia di |provincia de |departamento del |departamento de |departement de |distrito capital de |estado de |estado do |estado da |county of |city of |municipality of |tinh |kota |kabupaten |quan |huyen |thanh pho )'
suffix=r' (?:province|state|republic|division|region|oblast|governorate|prefecture|regency|district|department|county|city|capital|capitale|capital territory|federal capital territory|d c|d f|f d)$'
def variants(v):
 result={key(v),key(re.sub(r'\([^)]{1,60}\)','',v))}
 for text in list(result):result.add(re.sub(suffix,'',re.sub(prefix,'',text)))
 return result-{''}
states={};state_index=collections.defaultdict(set)
for line in (base/'admin1.txt').read_text(encoding='utf8').splitlines():
 code,name,ascii_name,gid=line.split('\t');aliases=variants(name)|variants(ascii_name)
 states[code]={'id':code,'country':code[:2],'name':name,'gid':gid,'aliases':aliases}
 for alias in aliases:state_index[(code[:2],alias)].add(code)
# Targeted canonical ADM1 aliases for a measured coverage gap, verified by ID.
with zipfile.ZipFile(base/'PH.zip') as z:
 for line in z.read('PH.txt').decode('utf8').splitlines():
  c=line.split('\t');state=c[8]+'.'+c[10]
  if c[7]!='ADM1' or state not in states or c[0]!=states[state]['gid']:continue
  for value in [c[1],c[2],*c[3].split(',')]:
   for alias in variants(value):states[state]['aliases'].add(alias);state_index[(c[8],alias)].add(state)
parents={};parent_index=collections.defaultdict(set)
def add_parent_alias(code,alias):
 if not alias:return
 parents[code]['aliases'].add(alias);parent_index[(code[:2],alias)].add(code)
for line in (base/'admin2.txt').read_text(encoding='utf8').splitlines():
 code,name,ascii_name,gid=line.split('\t');state='.'.join(code.split('.')[:2])
 if state not in states:continue
 parents[code]={'state':state,'name':name,'aliases':set()}
 for v in [name,ascii_name]:
  for alias in variants(v):add_parent_alias(code,alias)
  # Source administrative types retain their distinction in English variants.
  for start,end in [('kota ',' city'),('kabupaten ',' regency'),('quan ',' district'),('huyen ',' district')]:
   if key(v).startswith(start):add_parent_alias(code,key(v)[len(start):]+end)
with zipfile.ZipFile(base/'cities500.zip') as z:city_rows=[l.split('\t') for l in z.read('cities500.txt').decode('utf8').splitlines()]
# Where a city and its recorded admin2 share the canonical name, attested
# translated city names can validate the translated parent name too (Rome/Roma).
for c in city_rows:
 state=c[8]+'.'+c[10];parent=state+'.'+c[11]
 if parent not in parents or not (variants(c[1])&variants(parents[parent]['name'])):continue
 for alt in [c[1],c[2],*c[3].split(',')]:
  if 3<=len(alt)<=100:
   for alias in variants(alt):add_parent_alias(parent,alias)
# Primary city/state name agreement validates their localized aliases too.
for c in city_rows:
 state=c[8]+'.'+c[10]
 if state not in states or not (variants(c[1])&variants(states[state]['name'])):continue
 for alt in [c[1],c[2],*c[3].split(',')]:
  alias=key(alt)
  if 4<=len(alias)<=100 and not re.search(r'\d|https?\b',alias):states[state]['aliases'].add(alias)
def simplify(ring,tolerance=.018):
 points=[(round(x,4),round(y,4)) for x,y,*_ in ring]
 if len(points)<5:return points
 keep={0,len(points)-1};stack=[(0,len(points)-1)]
 while stack:
  a,b=stack.pop();x,y=points[a];dx,dy=points[b][0]-x,points[b][1]-y;denom=dx*dx+dy*dy;best,index=tolerance*tolerance,None
  for i in range(a+1,b):
   px,py=points[i];t=max(0,min(1,((px-x)*dx+(py-y)*dy)/denom)) if denom else 0;d=(px-x-t*dx)**2+(py-y-t*dy)**2
   if d>best:best,index=d,i
  if index is not None:keep.add(index);stack.extend([(a,index),(index,b)])
 result=[points[i] for i in sorted(keep)]
 return result if len(result)>=4 else points[:3]+[points[0]]
shapes=collections.defaultdict(dict);rejected=0;parent_shapes=0
for f in json.loads((base/'states.json').read_text(encoding='utf8'))['features']:
 p=f['properties'];country=p.get('iso_a2');state_candidates=set();parent_candidates=set()
 for field in ['name','name_en','gn_name']:
  if not p.get(field):continue
  for alias in variants(p[field]):
   state_candidates.update(state_index.get((country,alias),set()));parent_candidates.update(parent_index.get((country,alias),set()))
 code=p.get('gn_a1_code');at_state_level=False
 # A canonical initialism such as FCT needs explicit expansion, not a code-only join.
 if code in states and re.fullmatch(r'[A-Z]{2,4}',states[code]['name']):
  for field in ['name','name_en','gn_name']:
   words=re.findall(r'[A-Za-z]+',p.get(field) or '')
   if len(words)>=2 and ''.join(w[0] for w in words).upper()==states[code]['name']:state_candidates.add(code)

 if code in state_candidates:at_state_level=True
 elif len(state_candidates)==1:code=next(iter(state_candidates));at_state_level=True
 else:
  iso=(p.get('iso_3166_2') or '').split('-')[-1]
  if len(parent_candidates)>1:
   coded={c for c in parent_candidates if c.split('.')[-1]==iso}
   if len(coded)==1:parent_candidates=coded
  if len(parent_candidates)==1:
   parent=next(iter(parent_candidates));code=parents[parent]['state'];parent_shapes+=1
   for field in ['name','name_en','name_alt','gn_name']:
    if p.get(field):
     for v in str(p[field]).split('|'):
      for alias in variants(v):add_parent_alias(parent,alias)
   if p.get('region'):
    states[code]['aliases'].update(variants(p['region']))
  else:rejected+=1;continue
 s=states[code]
 if s['country']!=country:rejected+=1;continue
 # Never merge names or reuse codes across different administrative levels.
 if at_state_level:
  for field in ['name','name_en','name_alt','gn_name','postal','iso_3166_2']:
   if p.get(field):
    for v in str(p[field]).split('|'):s['aliases'].update(variants(v) if field not in ['postal','iso_3166_2'] else {key(v)})
  if p.get('iso_3166_2'):s['aliases'].add(key(p['iso_3166_2'].split('-')[-1]))
 g=f['geometry'];polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates'];converted=[[simplify(r) for r in poly] for poly in polys]
 if code not in shapes[country]:shapes[country][code]={'code':code,'name':s['name'],'center':[p['longitude'],p['latitude']],'geometry':{'type':'MultiPolygon','coordinates':[]}}
 shapes[country][code]['geometry']['coordinates'].extend(converted)
# Known canonical states remain selectable when no boundary can be verified.
# Points/extent come from the gazetteer, not from inferred individual residence.
state_points=collections.defaultdict(list)
for c in city_rows:
 state=c[8]+'.'+c[10]
 if state in states:state_points[state].append((float(c[5]),float(c[4])))
for code,points in state_points.items():
 s=states[code];country=s['country']
 if code in shapes[country]:continue
 xs=[p[0] for p in points];ys=[p[1] for p in points]
 shapes[country][code]={'code':code,'name':s['name'],'center':[round(sum(xs)/len(xs),4),round(sum(ys)/len(ys),4)],'extent':[min(xs),min(ys),max(xs),max(ys)],'geometry':{'type':'MultiPolygon','coordinates':[]}}
output=root/'app/public/network/states';output.mkdir(parents=True,exist_ok=True)
for country,rows in shapes.items():
 for s in rows.values():
  pts=[p for poly in s['geometry']['coordinates'] for p in poly[0]]
  if len(pts)>2 and max(p[0] for p in pts)-min(p[0] for p in pts)<180:s['center']=[round((min(p[0] for p in pts)+max(p[0] for p in pts))/2,4),round((min(p[1] for p in pts)+max(p[1] for p in pts))/2,4)]
 (output/(country+'.json')).write_text(json.dumps(list(rows.values()),ensure_ascii=False,separators=(',',':')),encoding='utf8')
if args.maps_only:
 print(json.dumps({'mapsOnly':True,'countries':len(shapes),'pointOnlyStates':sum(not s['geometry']['coordinates'] for group in shapes.values() for s in group.values())}));sys.exit(0)
# Remove obsolete generated files only inside the verified Network states folder.
for old in output.glob('*.json'):
 if old.stem not in shapes and re.fullmatch('[A-Z]{2}',old.stem):old.unlink()
tables=['network_geo_states','network_geo_cities','network_geo_aliases','network_geo_primary_names','network_geo_parent_names','network_geo_city_admin']
seed=sqlite3.connect(base/'gazetteer.sqlite')
for table in tables:seed.execute('DROP TABLE IF EXISTS '+table)
for migration in ['0100_network_geography.sql','0101_network_geography_matching.sql']:seed.executescript((root/'migrations'/migration).read_text())
for s in states.values():seed.execute('INSERT INTO network_geo_states VALUES(?,?,?,?)',(s['id'],s['country'],s['name'],json.dumps(sorted(s['aliases']),ensure_ascii=False)))
for code,p in parents.items():
 seed.executemany('INSERT OR IGNORE INTO network_geo_parent_names VALUES(?,?,?,?)',[(code[:2],alias,p['state'],code) for alias in p['aliases']])
for c in city_rows:
 state=c[8]+'.'+c[10]
 if state not in states:continue
 cid='gn:'+c[0];seed.execute('INSERT INTO network_geo_cities VALUES(?,?,?,?,?,?)',(cid,c[8],state,c[1],float(c[4]),float(c[5])))
 seed.executemany('INSERT OR IGNORE INTO network_geo_primary_names VALUES(?,?,?)',[(c[8],alias,cid) for alias in {key(c[1]),key(c[2])} if alias])
 aliases={key(c[1]),key(c[2])}
 for alt in c[3].split(','):
  alias=key(alt)
  if (4<=len(alias)<=100 or 2<=len(alias)<=100 and re.search(r'[^a-z \-]',alias)) and not re.search(r'\d|https?\b',alias):aliases.add(alias)
 seed.executemany('INSERT OR IGNORE INTO network_geo_aliases VALUES(?,?,?)',[(c[8],alias,cid) for alias in aliases if alias])
 parent=state+'.'+c[11]
 if parent in parents:seed.execute('INSERT INTO network_geo_city_admin VALUES(?,?)',(cid,parent))
seed.commit()
# Generate the bounded postcode validator from the same versioned source.
patterns={}
for line in (base/'countryInfo.txt').read_text(encoding='utf8').splitlines():
 if line and not line.startswith('#'):
  c=line.split('\t')
  if len(c)>14 and c[14].strip():patterns[c[0]]=c[14].strip()
postal=root/'app/shared/network/postal.ts';s=postal.read_text(encoding='utf8');start=s.index('const patterns:Record<string,string>=');end=s.index(';\nconst expressions',start)
s=s[:start]+'const patterns:Record<string,string>='+json.dumps(patterns,ensure_ascii=False,separators=(',',':'))+s[end:];postal.write_bytes(s.encode('utf8'))
sql_dir=base/'sql';sql_dir.mkdir(exist_ok=True)
def literal(v):return 'NULL' if v is None else str(v) if isinstance(v,(float,int)) else "'"+str(v).replace("'","''")+"'"
for country in sorted({s['country'] for s in states.values()}):
 with (sql_dir/(country+'.sql')).open('w',encoding='utf8') as out:
  for table in tables:
   query='SELECT * FROM '+table+' WHERE country=?' if table!='network_geo_city_admin' else 'SELECT a.city,a.admin2 FROM network_geo_city_admin a JOIN network_geo_cities c ON c.id=a.city WHERE c.country=?'
   for row in seed.execute(query,(country,)):out.write('INSERT OR REPLACE INTO '+table+' VALUES('+','.join(map(literal,row))+');\n')

if args.local:
 files=[p for p in (root/'app/.wrangler/state/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite') if re.fullmatch(r'[a-f0-9]{64}\.sqlite',p.name)]
 if len(files)!=1:raise RuntimeError('Expected one shared local D1 database')
 local=sqlite3.connect(files[0],timeout=30)
 for migration in ['0100_network_geography.sql','0101_network_geography_matching.sql']:local.executescript((root/'migrations'/migration).read_text())
 local.execute('ATTACH DATABASE ? AS gazetteer',(str(base/'gazetteer.sqlite'),));local.execute('BEGIN IMMEDIATE')
 for table in tables:local.execute('DELETE FROM '+table);local.execute('INSERT INTO '+table+' SELECT * FROM gazetteer.'+table)
 local.commit();local.close()
metadata={name:{'url':url,'sha256':hashlib.sha256((base/name).read_bytes()).hexdigest()} for name,url in sources.items()}
(root/'app/public/network/geography-sources.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps({'countries':len(shapes),'states':len(states),'cities':seed.execute('SELECT COUNT(*) FROM network_geo_cities').fetchone()[0],'aliases':seed.execute('SELECT COUNT(*) FROM network_geo_aliases').fetchone()[0],'rejectedBoundaryFeatures':rejected,'verifiedParentBoundaries':parent_shapes,'mapBytes':sum(p.stat().st_size for p in output.glob('*.json'))}))
seed.close()
