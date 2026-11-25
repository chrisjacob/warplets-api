import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
// Editorial examples attached only to an explicit six-month scenario. Never token metadata.
export function writeTimeline(directory,db,report){
 const ideas=[['10X','Think bigger.'],['ORBIT','Out of this world.'],['SEND','Take the leap.'],['AFTERHOURS','For the night people.'],['FULLSEND','All in on the idea.'],['ODYSSEY','Go a little further.'],['OVERDRIVE','Beyond the ordinary.']];
 const rows=db.prepare("SELECT id,season_start FROM collect_inventories WHERE kind='season' ORDER BY season_start").all();
 const editions=rows.map((row,i)=>({id:row.id,number:i,symbol:ideas[i][0],line:ideas[i][1],startsAt:new Date(row.season_start).toISOString(),current:i===rows.length-1,supply:1000}));
 writeFileSync(join(directory,'timeline.json'),JSON.stringify({mode:'six-months',historyDays:180,launchCount:report.core.markets,editions},null,2)+'\n');
}
