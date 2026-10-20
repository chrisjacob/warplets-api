import { contentCampaign, contentCampaigns, contentPage, contentRecord, createContentCampaign, submitContent, changeContent } from "./content";
import { ContentError } from "./content-url";
import { requireContentIdentity, contentIdentityBody } from "./identity";
import { API_HEADERS, adminJson } from "./request-security";
import {contentReportRecord,contentReports,reviewContentReport,submitContentReport} from "./content-reports";
import {holdReviewRecord,holdReviews,replyHoldReview,requestHoldReview} from "./content-holds";
export async function contentRoute(request: Request, db: D1Database, admin: boolean, at = new Date()): Promise<Response> {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, ""), cursor = url.searchParams.get("cursor");
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...API_HEADERS, vary: "Cookie" } });
  if (admin) {
    if(request.method==="POST"&&path==="/api/10x/admin/attention/hold-reviews/review")return json(await replyHoldReview(db,await adminJson(request),null,new Date()));
    if(request.method==="GET"&&path==="/api/10x/admin/attention/hold-reviews")return json(await holdReviews(db,{status:url.searchParams.get("status")??undefined,cursor},at));
    const hold=path.match(/^\/api\/10x\/admin\/attention\/hold-reviews\/([^/]+)$/);
    if(request.method==="GET"&&hold){const record=await holdReviewRecord(db,hold[1]!);if(!record)throw new ContentError("hold_review_not_found",404);return json(record);}
    // The Worker performs Bearer + browser admission before entering this branch.
    if (request.method === "POST" && path === "/api/10x/admin/attention/campaigns") return json(await createContentCampaign(db, await adminJson(request), new Date()));
    if (request.method === "POST" && path === "/api/10x/admin/attention/review") return json(await changeContent(db, await adminJson(request), null, new Date()));
    if(request.method==="POST"&&path==="/api/10x/admin/attention/reports/review")return json(await reviewContentReport(db,await adminJson(request),new Date()));
    if(request.method==="GET"&&path==="/api/10x/admin/attention/reports")return json(await contentReports(db,{status:url.searchParams.get("status")??undefined,cursor},at));
    const report=path.match(/^\/api\/10x\/admin\/attention\/reports\/([^/]+)$/);
    if(request.method==="GET"&&report){const record=await contentReportRecord(db,report[1]!);if(!record)throw new ContentError("content_report_not_found",404);return json(record);}
    if (request.method === "GET" && path === "/api/10x/admin/attention/queue") return json(await contentPage(db, { status: url.searchParams.get("status") ?? undefined, cursor }, at));
    const match = path.match(/^\/api\/10x\/admin\/attention\/submissions\/([^/]+)$/);
    if (request.method === "GET" && match) {
      const record = await contentRecord(db, match[1]!); if (!record) throw new ContentError("content_not_found", 404); return json(record);
    }
  } else {
    if (request.method === "GET" && path === "/api/10x/attention/campaigns") return json(await contentCampaigns(db, cursor, at));
    const campaign = path.match(/^\/api\/10x\/attention\/campaigns\/([^/]+)$/);
    if (request.method === "GET" && campaign) {
      const record = await contentCampaign(db, campaign[1]!); if (!record) throw new ContentError("content_campaign_not_found", 404);
      const { reason: _r, request_hash: _q, record_hash: _h, ...publicRecord } = record;
      return json({ campaign: publicRecord, feed: await contentPage(db, { campaign: record.id, public: true, cursor }, at) });
    }
    const p = await requireContentIdentity(request, db, at, request.method === "POST");
    if(request.method==="GET"&&path==="/api/10x/attention/hold-reviews/mine")return json(await holdReviews(db,{owner:p.identity_id,cursor},at));
    const hold=path.match(/^\/api\/10x\/attention\/hold-reviews\/([^/]+)$/);
    if(request.method==="GET"&&hold){const record=await holdReviewRecord(db,hold[1]!,p.identity_id);if(!record)throw new ContentError("hold_review_not_found",404);return json(record);}
    if(request.method==="GET"&&path==="/api/10x/attention/reports/mine")return json(await contentReports(db,{owner:p.identity_id,cursor},at));
    const report=path.match(/^\/api\/10x\/attention\/reports\/([^/]+)$/);
    if(request.method==="GET"&&report){const record=await contentReportRecord(db,report[1]!,p.identity_id);if(!record)throw new ContentError("content_report_not_found",404);return json(record);}
    if (request.method === "GET" && path === "/api/10x/attention/mine") return json(await contentPage(db, { owner: p.identity_id, cursor }, at));
    const mine = path.match(/^\/api\/10x\/attention\/mine\/([^/]+)$/);
    if (request.method === "GET" && mine) {
      const record = await contentRecord(db, mine[1]!, p.identity_id); if (!record) throw new ContentError("content_not_found", 404); return json(record);
    }
    if (request.method === "POST" && ["/api/10x/attention/submissions", "/api/10x/attention/appeals", "/api/10x/attention/reports", "/api/10x/attention/hold-reviews", "/api/10x/attention/hold-reviews/respond"].includes(path)) {
      const input = await contentIdentityBody(request), admittedAt = new Date();
      // A slowly streamed body cannot retain an expired session or backdate a
      // submission across the campaign's cutoff using request-start time.
      const principal = await requireContentIdentity(request, db, admittedAt, true);
      if(path.endsWith("/hold-reviews"))return json(await requestHoldReview(db,input,principal,admittedAt));
      if(path.endsWith("/hold-reviews/respond"))return json(await replyHoldReview(db,input,principal,admittedAt));
      return json(path.endsWith("/reports")?await submitContentReport(db,input,principal,admittedAt):path.endsWith("/submissions") ? await submitContent(db, input, principal, admittedAt) : await changeContent(db, input, principal, admittedAt));
    }
  }
  throw new ContentError("content_not_found", 404);
}
