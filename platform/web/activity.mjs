import { compactAddress, escapeHtml, percent } from './views.mjs';

const e=escapeHtml;
const section=(title, body)=>'<section class="card"><h2>'+e(title)+'</h2>'+body+'</section>';
const notice=message=>'<p class="notice" role="status">'+e(message)+'</p>';
const openWallet='<button type="button" data-connect>Connect wallet</button>';
const when=value=>{
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toISOString().slice(0,16).replace('T',' ')+' UTC';
};
const cursorLink=(path,params,cursor,label)=>{
  if(cursor==null) return '';
  const qs=new URLSearchParams({...params,cursor:String(cursor)});
  return '<a class="text-link" href="'+e(path+'?'+qs)+'">'+e(label)+' →</a>';
};

export function ownerVaultPanel({me,assets,loading,assetId,detail}) {
  let body;
  if(!me) body='<p>Connect a wallet to see its Genesis and Season assets.</p>'+openWallet;
  else if(loading) body='<p role="status">Loading NFT holdings…</p>';
  else if(!assets) body=notice('Your NFT holdings could not be loaded.');
  else {
    body='<p>Local holdings for '+e(compactAddress(me.wallet))+'</p>';
    body+=assets.items.length?'<ul class="market-list">'+assets.items.map(a=>'<li><a href="/vault?asset='+encodeURIComponent(a.id)
      +'"><strong>'+e(a.id)+'</strong><span>View allocations ↗</span></a></li>').join('')+'</ul>'
      :'<p>No NFT holdings for this wallet in the local ledger.</p>';
    if(!assetId) body+=cursorLink('/vault',{},assets.nextCursor,'Next holdings');
  }
  let details='';
  if(assetId) {
    if(!detail) details=section('NFT allocations',notice('This NFT could not be found or its allocations are unavailable.'));
    else {
      const rows=detail.items.map(item=>'<tr>'+[item.marketId,item.allocated,item.vested,item.claimed,item.claimable]
        .map(val=>'<td>'+e(val)+'</td>').join('')+'</tr>').join('');
      const table=rows?'<div class="table-scroll"><table><caption>Token base units · '+e(when(detail.asOf))+'</caption>'
        +'<thead><tr><th>Campaign</th><th>Allocation</th><th>Vested</th><th>Claimed</th><th>Available</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
        :'<p>No launch allocation rows for this NFT.</p>';
      details=section('Allocations for '+detail.assetId,table+cursorLink('/vault',{asset:assetId},detail.nextCursor,'Next allocations'));
    }
  }
  return section('Your NFTs',body)+details;
}

function submitForm(markets) {
  if(!markets) return notice('Campaigns could not be loaded.');
  const active=markets.items.filter(row=>row.status==='active');
  if(!active.length) return '<p>No active campaign is available for a contribution.</p>';
  return '<form class="member-form" id="submission-form"><label>ATT campaign<select name="tokenId" required>'
    +active.map(m=>'<option value="'+e(m.id)+'">'+e(m.symbol)+'</option>').join('')+'</select></label>'
    +'<label>Content URL<input type="url" name="url" maxlength="2048" required placeholder="https://…"></label>'
    +'<p>The local preview checks your recorded stake when the contribution is submitted.</p>'
    +'<button>Submit contribution</button><output class="form-status" aria-live="polite"></output></form>';
}

export function earnActivity({me,markets,submissions,claims,loading,date}) {
  const form=section('Submit content',me?submitForm(markets):'<p>Sign in with your Solana wallet to submit a contribution.</p>'+openWallet);
  if(!me) return form;
  if(loading) return form+section('Your activity','<p role="status">Loading wallet activity…</p>');
  let entries=submissions?.items?.map(item=>'<li><strong>'+e(item.tokenId)+'</strong>'
    +'<span>'+e(item.status)+(item.score==null?'':' · score '+e(item.score))+'</span><small>'+e(item.url)+'</small></li>').join('');
  let awards=claims?.items?.map(item=>'<li><strong>'+e(item.tokenId)+' · day '+e(item.day)+'</strong>'
    +'<span>'+e(item.vestedUnits)+' of '+e(item.awardUnits)+' base units vested</span></li>').join('');
  const more=(field,next)=>{
    if(next==null) return '';
    const qs=new URLSearchParams({date,[field]:String(next)});
    return '<a class="text-link" href="/earn?'+e(qs.toString())+'">Next '+(field==='submissions'?'submissions':'awards')+' →</a>';
  };
  const activity=submissions?'<ul class="activity-list">'+(entries||'<li>No submissions from this wallet.</li>')+'</ul>'
    +more('submissions',submissions.nextCursor):notice('Submissions could not be loaded.');
  const reward=claims?'<ul class="activity-list">'+(awards||'<li>No settled awards for this wallet.</li>')+'</ul>'
    +more('awards',claims.nextCursor):notice('Awards could not be loaded.');
  return form+'<div class="two-up">'+section('Your submissions',activity)+section('Your vested awards',reward)+'</div>';
}

export function farmActivity({me,markets,farmId,farm,positions,loading}) {
  let directory;
  if(!markets) directory=notice('Market data could not be loaded.');
  else if(!markets.items.length) directory='<p>No market campaigns are available.</p>';
  else directory='<ul class="market-list">'+markets.items.map(row=>'<li><a href="/stake?farm='+encodeURIComponent(row.id)
    +'"><strong>'+e(row.symbol)+'</strong><span>Inspect farm ↗</span></a></li>').join('')+'</ul>';
  if(farmId) {
    if(farm?.missing) directory+='<p>No local farm has been recorded for this campaign.</p>';
    else if(!farm) directory+=notice('Farm details are currently unavailable.');
    else directory+='<h3>'+e(farm.marketId)+' · '+e(farm.status)+'</h3><dl class="breakdown">'
      +[['Funded units',farm.fundedUnits],['Total staked units',farm.totalStakedUnits ?? 'Pending'],
        ['Harvest treasury fee',percent(farm.treasuryFeeBps)],['Emissions end',when(farm.emissionEnd)]]
        .map(([label,value])=>'<div><dt>'+e(label)+'</dt><dd>'+e(value)+'</dd></div>').join('')+'</dl>';
  }
  let own;
  if(!me) own='<p>Connect a wallet to view its recorded stake and harvests.</p>'+openWallet;
  else if(loading) own='<p role="status">Loading wallet positions…</p>';
  else if(!positions) own=notice('Wallet positions could not be loaded.');
  else if(!positions.items.length) own='<p>No recorded staking positions for this wallet.</p>';
  else own='<div class="table-scroll"><table><caption>Local positions · amounts in token base units</caption>'
    +'<thead><tr><th>Campaign</th><th>Principal</th><th>Earned gross</th><th>Available gross</th><th>Harvested gross</th></tr></thead><tbody>'
    +positions.items.map(p=>'<tr><td><a href="/stake?farm='+encodeURIComponent(p.marketId)+'">'+e(p.marketId)+'</a></td>'
      +[p.principalUnits,p.earnedGrossUnits,p.claimableGrossUnits,p.harvestedGrossUnits].map(v=>'<td>'+e(v)+'</td>').join('')
      +'</tr>').join('')+'</tbody></table></div>'+cursorLink('/stake',{},positions.nextCursor,'Next positions');
  return section('Farm directory',directory)+section('Your positions',own);
}
