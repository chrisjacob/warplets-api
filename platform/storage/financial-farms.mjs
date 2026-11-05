import {sql} from './atomic-driver.mjs';
import {utf8} from '../security/canonical.mjs';
import {FinancialReadError} from '../financial/cursor.mjs';
const version=sql("SELECT CAST(revision AS TEXT) revision FROM app_revisions WHERE name='source'");
const eventsSql='SELECT * FROM stake_fixture_events WHERE market_id=? AND at_ms<=? ORDER BY at_ms,seq LIMIT 1001';
const checked=value=>{if(utf8(JSON.stringify(value)).length>2*1024*1024)throw new FinancialReadError('read_byte_bound','Financial read exceeds the bounded local snapshot.');return value;};
export function createFinancialFarmRepository(driver){
 return Object.freeze({
  async sourceRevision(){const [r]=await driver.batch([version]);return String(r.rows[0].revision);},
  async readFarm({marketId,evaluatedAtMs}){
   const [revision,farms,events]=await driver.batch([version,sql('SELECT * FROM stake_fixture_farms WHERE market_id=?',marketId),sql(eventsSql,marketId,evaluatedAtMs)]);
   return checked({sourceRevision:String(revision.rows[0].revision),marketId,evaluatedAtMs,farm:farms.rows[0]??null,events:events.rows});
  },
  async readPositions({wallet,after,evaluatedAtMs}){
   // Bound both dimensions in a single atomic read. Fetching1001 is a sentinel,
   // never permission to run a partial1000-event accounting simulation.
   const [revision,farms,events]=await driver.batch([version,
    sql(`SELECT f.* FROM stake_fixture_farms f JOIN (SELECT DISTINCT market_id FROM stake_fixture_events WHERE wallet=? AND market_id>? AND at_ms<=? ORDER BY market_id LIMIT 26) p ON p.market_id=f.market_id ORDER BY f.market_id`,wallet,after,evaluatedAtMs),
    sql(`SELECT selected.market_id,(SELECT json_group_array(json_object('seq',seq,'id',id,'market_id',market_id,'kind',kind,'wallet',wallet,'at_ms',at_ms,'amount',amount))
     FROM (SELECT * FROM stake_fixture_events WHERE market_id=selected.market_id AND at_ms<=? ORDER BY at_ms,seq LIMIT 1001)) AS events_json
     FROM (SELECT DISTINCT market_id FROM stake_fixture_events WHERE wallet=? AND market_id>? AND at_ms<=? ORDER BY market_id LIMIT 25) selected ORDER BY selected.market_id`,evaluatedAtMs,wallet,after,evaluatedAtMs),
   ]);
   checked(events.rows);
   return checked({sourceRevision:String(revision.rows[0].revision),wallet,after,evaluatedAtMs,farms:farms.rows,events:events.rows.flatMap(r=>JSON.parse(r.events_json))});
  },
 });
}
