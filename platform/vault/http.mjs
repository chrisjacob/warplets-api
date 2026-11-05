import {currentSession} from '../server/auth.mjs';
import {json,failure} from '../server/api.mjs';
import {readAsset} from './ledger.mjs';
export function handleVault(db,request,now){
 const {pathname,searchParams}=new URL(request.url);
 const match=pathname.match(/^\/api\/v1\/nfts\/([a-zA-Z0-9._:-]{1,128})\/vault$/);
 if(pathname!=='/api/v1/vault'&&!match)return null;
 if(request.method!=='GET')return failure(405,'method_not_allowed','Use GET.',{allow:'GET'});
 const cursor=searchParams.get('cursor')??'';
 if([...searchParams.keys()].some(k=>k!=='cursor'||searchParams.getAll(k).length!==1)||!/^[a-zA-Z0-9._:-]{0,128}$/.test(cursor))
   return failure(400,'invalid_cursor','Invalid Vault cursor.');
 if(match){
  const asset=db.prepare('SELECT reveal_ms FROM collect_assets WHERE id=?').get(match[1]);
  if(asset&&(asset.reveal_ms===null||asset.reveal_ms>now))
    return failure(409,'metadata_unrevealed','Vault detail becomes available after the collection reveal.');
  const result=readAsset(db,match[1],now,cursor);
  return result?json(result):failure(404,'asset_not_found','Unknown NFT.');
 }
 const session=currentSession(db,request,now);if(!session)return failure(401,'authentication_required','Connect your wallet.');
 const rows=db.prepare('SELECT id FROM vault_assets WHERE owner=? AND id>? ORDER BY id LIMIT 26').all(session.wallet,cursor);
 return json({items:rows.slice(0,25).map(({id})=>({id,detail:'/api/v1/nfts/'+encodeURIComponent(id)+'/vault'})),nextCursor:rows.length>25?rows[24].id:null,source:'local-fixture',asOf:new Date(now).toISOString()});
}
export const vaultPaths={
 '/vault':{get:{operationId:'getMyVault',responses:{200:{description:'Owner-scoped list of fixture assets'},401:{description:'Session required'}}}},
 '/nfts/{id}/vault':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],get:{operationId:'getNftVault',responses:{200:{description:'Public token quantities, with decimal strings in base units'},404:{description:'Unknown NFT'}}}}
};
