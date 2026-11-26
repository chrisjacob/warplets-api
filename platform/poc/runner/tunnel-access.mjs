import {createHmac,timingSafeEqual} from 'node:crypto';

const equal=(a,b)=>{const x=Buffer.from(a??''),y=Buffer.from(b??'');return x.length===y.length&&timingSafeEqual(x,y);};
const cookieName='__Secure-poc-access';
const lifetime=12*60*60;

export function createTunnelAccess(config,now=()=>Date.now()) {
  if(!config)return null;
  const origin=new URL(config.origin),prefix=config.prefix??'/poc';
  if(origin.protocol!=='https:'||origin.origin!==config.origin||!/^\/[a-z][a-z0-9-]*$/.test(prefix)||!/^[A-Za-z0-9_-]{43}$/.test(config.accessKey??''))throw Error('Invalid tunnel origin, prefix or access key');
  const mac=expiry=>createHmac('sha256',config.accessKey).update(config.origin+prefix+'|'+expiry).digest('base64url');
  let windowStart=0,attempts=0;
  return {
    origin:origin.origin,host:origin.host,prefix,
    authenticated(req) {
      const values=(req.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(cookieName+'='));
      if(values.length!==1)return false;
      const [expiry,signature,...rest]=values[0].slice(cookieName.length+1).split('.');
      const seconds=Math.floor(now()/1000);
      return rest.length===0&&/^\d{10}$/.test(expiry??'')&&Number(expiry)>seconds&&Number(expiry)<=seconds+lifetime&&equal(signature,mac(expiry));
    },
    unlock(key) {
      if(now()-windowStart>60000){windowStart=now();attempts=0;}
      if(++attempts>30)throw Error('Too many unlock attempts; wait one minute');
      if(typeof key!=='string'||!equal(key,config.accessKey))return null;
      const expiry=String(Math.floor(now()/1000)+lifetime);
      return cookieName+'='+expiry+'.'+mac(expiry)+'; Path='+prefix+'/; HttpOnly; Secure; SameSite=Strict; Max-Age='+lifetime;
    },
  };
}
