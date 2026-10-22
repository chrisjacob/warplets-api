import{expect,it}from"vitest";import{renderToStaticMarkup}from"react-dom/server";
import{describeGmgnActivity}from"../../../discovery/src/gmgn-activity-shape";
import{GmgnActivityShapeDetails}from"./GmgnActivityShape";
it("keeps legacy failures unchanged and explains missing versus nested rows without accepting them",()=>{
 expect(renderToStaticMarkup(<GmgnActivityShapeDetails shape={undefined}/>)).toBe("");
 const html=renderToStaticMarkup(<GmgnActivityShapeDetails shape={describeGmgnActivity({data:{activities:[{private:"value-never-displayed"}]}})}/>);
 for(const text of["held attempt","Expected event array: missing","Nested event array: 1 row","does not validate events","establish zero activity"])expect(html).toContain(text);
 expect(html).not.toContain("value-never-displayed");
});
it("explains an oversized response without truncating it or reporting an accepted event sample",()=>{
 const html=renderToStaticMarkup(<GmgnActivityShapeDetails shape={describeGmgnActivity({activities:Array(50).fill({})})}/>);
 expect(html).toContain("GMGN returned 50 events; this validator accepts at most 20");expect(html).toContain("whole page was held");expect(html).toContain("no rows were discarded");
});
