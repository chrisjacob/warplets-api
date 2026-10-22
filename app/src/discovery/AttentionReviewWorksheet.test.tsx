import { expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionReviewWorksheet } from "./AttentionReviewWorksheet";

it("renders a personal unsynced worksheet without accessing storage or providers during rendering",()=>{
 const fetcher=vi.spyOn(globalThis,"fetch"),html=renderToStaticMarkup(<AttentionReviewWorksheet context={null} onClose={()=>{}}/>);
 for(const text of["My attention reviews","not synced","do not change scores","Export review history","Reload local history"])expect(html).toContain(text);
 expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();
});
