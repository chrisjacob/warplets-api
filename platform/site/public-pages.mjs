const idPattern='([A-Za-z0-9._:-]{1,128})';
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const pct=value=>Number.isInteger(value)?new Intl.NumberFormat('en-US').format(value/100)+'%':'Unavailable';
const numeric=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US').format(n):'Unavailable';
const knownDates=s=>/^\d{4}-\d{2}-\d{2}$/.test(s) && Date.parse(s)>=0 && new Date(s).toISOString().startsWith(s);

const routes={
  '/':{title:'Markets',description:'Curated Solana attention tokens and the original tokens they pair with.',canonical:'/markets',type:'markets'},
  '/markets':{title:'Markets',description:'Curated Solana attention tokens and the original tokens they pair with.',type:'markets'},
  '/vault':{title:'Vault',description:'NFT allocations, vesting and historical ATT claims.',private:true},
  '/stake':{title:'Stake',description:'Continuous same-token campaign rewards and recorded staking positions.',private:true},
  '/earn':{title:'Earn',description:'Global daily content scores and reward allocations.',private:true},
  '/collect':{title:'Collect',description:'Explore permanent Genesis and monthly Season collections.',private:true},
  '/collections/genesis':{title:'Genesis',description:'Collection terms, release stages and permanent Genesis membership.',type:'genesis'},
};
const dynamic=[
  ['market',new RegExp('^/markets/'+idPattern+'$'),'ATT market'],
  ['season',new RegExp('^/seasons/'+idPattern+'$'),'Season collection'],
  ['nft',new RegExp('^/nfts/'+idPattern+'$'),'NFT details'],
  ['board',/^\/earn\/(\d{4}-\d{2}-\d{2})$/,'Earn leaderboard'],
];
export function routeFor(url){
  const path=url.pathname;
  if(routes[path]){
    const result={...routes[path],canonical:routes[path].canonical??path};
    // Keep query-based links usable while publishing the stable public URL.
    const legacyMarket=url.searchParams.get('market'),legacyDate=url.searchParams.get('date');
    if(result.type==='markets' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(legacyMarket??'')) {
      result.canonical='/markets/'+legacyMarket;result.type='market';result.id=legacyMarket;
    }
    if(path==='/earn' && knownDates(legacyDate??'')){
      result.canonical='/earn/'+legacyDate;result.type='board';result.id=legacyDate;
    }
    return result;
  }
  for(const [type,pattern,title] of dynamic){
    const match=pattern.exec(path);
    if(match)return {type,title,id:match[1],canonical:path,description:title+' · '+match[1],
      invalid:type==='board'&&!knownDates(match[1])};
  }
  if(/^\/(markets|nfts|seasons|earn|collections)\//.test(path))return {invalid:true,canonical:path,title:'Page not found',description:'Unknown public resource.'};
  return null;
}
function summaryList(items){
  return '<dl class="facts">'+items.map(([label,value])=>'<div><dt>'+html(label)+'</dt><dd>'+html(value)+'</dd></div>').join('')+'</dl>';
}
function links(items){
  return '<ul class="rows">'+items.map(([label,path])=>'<li><a href="'+html(path)+'">'+html(label)+'</a></li>').join('')+'</ul>';
}
function describe(route,record){
  if(route.type==='markets'){
    const items=Array.isArray(record.items)?record.items:[];
    return {content:items.length?links(items.map(m=>[m.symbol+' / '+m.ogSymbol,'/markets/'+encodeURIComponent(m.id)])):'<p>No market campaigns have been recorded.</p>'};
  }
  if(route.type==='genesis')return {content:summaryList([['Maximum supply',numeric(record.genesis.cap)],['Tranche size',numeric(record.genesis.trancheSize)],
    ['First whitelist price',record.genesis.firstWhitelistPriceSol+' SOL'],['Vote length',record.genesis.ballotHours+' hours']])};
  if(route.type==='market')return {title:record.symbol+' / '+record.ogSymbol,description:record.symbol+' pairs with '+record.ogSymbol+' in the Solana preview.',
    content:summaryList([['Campaign status',record.status],['Activated',record.activatedAt],['Opening fee',pct(record.feeBps)],['ATT mint',record.attMint],['OG mint',record.ogMint]])};
  if(route.type==='season'){
    if(record.kind!=='season')return {missing:true};
    return {title:'Season · '+record.id,content:summaryList([['Season start',record.seasonStart],['Capacity',numeric(record.capacity)],
      ['Slots available',numeric(record.counts.unsold)],['Priced-stage allocations',numeric(record.counts.paid)]])};
  }
  if(route.type==='nft'){
    const revealed=record.revealStatus==='revealed';
    return {title:'NFT · '+record.id,content:summaryList([['Collection',record.inventoryId],['Reveal status',record.revealStatus],
      ...(revealed?[['Level',record.level],['Model',record.traits.model],['Backdrop',record.traits.backdrop],['Symbol',record.traits.symbol]]:[])])};
  }
  if(route.type==='board'){
    return {title:'Earn board · '+record.date,description:'UTC leaderboard for '+record.date+'.',content:record.status==='pending'
      ?'<p>Awaiting final scores.</p>':record.items.length?summaryList(record.items.map(r=>['Rank '+r.rank,r.pointsTenths/10+' points']))
      :'<p>Final board · no winners.</p>'};
  }
  return {};
}
/** Selection is restricted to known public reads. Input headers, cookies and
 * query strings never enter this callback. Keep member data out of initial HTML.
 */
export async function initialPage(route,url,readPublic){
  let title=route.title,description=route.description,content='',status=200;
  const endpoints={markets:'/markets?limit=10',genesis:'/policy',market:'/markets/',season:'/collect/inventories/',
    nft:'/collect/assets/',board:'/earn/epochs/'};
  if(route.invalid){status=404;}
  else if(readPublic && route.type && endpoints[route.type]){
    const target=endpoints[route.type]+(route.id?encodeURIComponent(route.id):'')+(route.type==='board'?'/leaderboard':'');
    try{
      const result=await readPublic('/api/v1'+target);
      if(result.status===404)status=404;
      else if(!result.ok)status=503;
      else {
        const data=await result.json(),info=describe(route,data.data??data);
        if(info.missing)status=404;
        else {title=info.title??title;description=info.description??description;content=info.content??'';}
      }
    }catch{status=503;}
  }
  if(status===404){title='Page not found';description='This resource could not be found.';content='';}
  if(status===503){description='Public data is temporarily unavailable.';content='';}
  const canonical=new URL(route.canonical,url.origin).href;
  const privatePage=route.private||status!==200;
  const metadata='<meta name="description" content="'+html(description)+'"><link rel="canonical" href="'+html(canonical)+'">'
    +'<meta name="robots" content="'+(privatePage?'noindex, nofollow':'noindex, follow')+'">'
    +'<meta property="og:type" content="website"><meta property="og:title" content="'+html(title+' · 10X.MEME')+'">'
    +'<meta property="og:description" content="'+html(description)+'"><meta property="og:url" content="'+html(canonical)+'">'
    +'<meta property="og:image" content="'+html(url.origin+'/social-card.png')+'"><meta name="twitter:card" content="summary_large_image">';
  const fallback='<div class="frame main"><nav aria-label="Public sections">'+links([['Markets','/markets'],['Genesis','/collections/genesis'],['Earn','/earn']])
    +'</nav><main class="page-hero"><h1>'+html(title)+'</h1><p>'+html(description)+'</p>'+content+'</main></div>';
  return {title:title+' · 10X.MEME',metadata,content:fallback,status};
}
export function renderInitialPage(template,page){
  return template.replace(/<title>[^<]*<\/title>/,()=>'<title>'+html(page.title)+'</title>')
    .replace(/<meta name="description"[^>]*>/,()=>page.metadata)
    .replace(/<!--initial:start-->[\s\S]*?<!--initial:end-->/,()=>'<!--initial:start-->'+page.content+'<!--initial:end-->');
}
