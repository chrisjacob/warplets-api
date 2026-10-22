import {expect,it} from "vitest";
import {describeGmgnActivity,GmgnActivityShape} from "./gmgn-activity-shape";

it("distinguishes missing, null, misplaced and oversized arrays without interpreting events",()=>{
 expect(describeGmgnActivity({})).toMatchObject({root:"object",activities:"missing",activities_count:null,data_activities:"missing"});
 expect(describeGmgnActivity({activities:null})).toMatchObject({activities:"null",activities_count:null});
 expect(describeGmgnActivity({activities:[]})).toMatchObject({activities:"array",activities_count:0});
 expect(describeGmgnActivity({data:{activities:Array(21).fill(null),next:"private-cursor"}})).toMatchObject({activities:"missing",data:"object",data_activities:"array",data_activities_count:21,data_next:"string"});
 expect(describeGmgnActivity({activities:"bad",list:[{}]})).toMatchObject({activities:"string",list:"array",list_count:1});
 expect(()=>GmgnActivityShape.parse({...describeGmgnActivity({}),activities_count:0})).toThrow();
});
it("never copies messages, arbitrary keys, row values, cursors, identifiers or numeric scalars",()=>{
 const marker="credential-or-provider-instruction-never-retain",raw={activities:[{address:marker,tx_hash:marker,token_amount:12345}],next:marker,data:{activities:marker,next:marker},list:[marker],[marker]:marker,message:marker};
 const text=JSON.stringify(describeGmgnActivity(raw));expect(text).not.toContain(marker);expect(text).not.toContain("12345");expect(text).not.toContain("address");expect(text.length).toBeLessThan(400);
 expect(describeGmgnActivity(Object.create({activities:[marker]})).activities).toBe("missing");
});
