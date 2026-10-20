import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {InboxRecoveryPanel} from "./InboxRecoveryPanel";
import {InboxRecoveryResponse,TRANSACTION_READER_VERSION} from "../../../discovery/src/inbox-recovery-model";
it("labels an interrupted reservation and a verified migration without implying eligibility or extra API allowance",()=>{
  const at="2026-10-21T00:00:00.000Z",entry={signature:"1".repeat(64),reader_version:TRANSACTION_READER_VERSION,expected_slot:100,prior_processed_at:at,started_at:at,finished_at:null,state:"reading",outcome:null,payload_hash:null};
  const data=InboxRecoveryResponse.shape.data.parse({at,reader_version:TRANSACTION_READER_VERSION,daily_limit:20,per_turn_limit:2,used_today:2,remaining_today:18,pending_recent:12,older_unsupported:3,recent:[entry,{...entry,signature:"2".repeat(88),state:"finished",finished_at:at,outcome:"migration_verified",payload_hash:"a".repeat(64)}],provider_requests:0,evidence_gates_changed:false});
  const html=renderToStaticMarkup(<InboxRecoveryPanel data={data} error=""/>);
  expect(html).toContain("completion not confirmed");expect(html).toContain("migration verified");expect(html).toContain("Every token must still pass");expect(html).toContain("don’t add a new daily API budget");expect(html).toContain("makes zero provider requests");expect(html).toContain('rel="noopener noreferrer"');
});
