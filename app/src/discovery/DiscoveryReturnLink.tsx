import {tokenDiscoveryReturn} from "./discovery-return";

export function DiscoveryReturnLink({search,mode}:{search:string;mode:"live"|"fixture"}){
  return <a href={tokenDiscoveryReturn(search,mode)} className="tenx-back">← Back to Discovery</a>;
}
