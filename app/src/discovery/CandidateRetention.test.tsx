import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {CandidateExpiryNotice,CandidateInventory} from "./CandidateRetention";
import {fixtureCandidates} from "../../../discovery/src/fixtures";
it("labels past tokens as history and keeps age, freshness and original evidence explicit",async()=>{
  const c=(await fixtureCandidates(new Date("2026-10-21T00:00:00Z")))[0]!;
  const html=renderToStaticMarkup(<CandidateExpiryNotice receipt={{version:"verified-creation-expiry-v1",address:c.address,creation:{...c.creation!,kind:"creation"},expired_at:"2026-10-22T00:00:00Z",receipt_hash:"a".repeat(64)}} />);
  for(const text of ["Past token","history retained","Saved observations may be stale","Expiry evidence",c.creation!.signature,"Receipt checksum"])expect(html).toContain(text);
});
it("discloses bounded active inventory, unresolved ages and retained history",()=>{
  const html=renderToStaticMarkup(<CandidateInventory inventory={{policy:"verified-creation-expiry-v1",retained:700,active:501,expired:199,active_limit:500,active_over_limit:true,last_expired_at:null}} />);
  for(const text of ["501 active observations","199 expired tokens","Unknown creation times remain unresolved","honors pause state","no provider requests","New rehearsals are held","existing snapshots keep their original inputs","long-term storage compaction remain open"])expect(html).toContain(text);
});
