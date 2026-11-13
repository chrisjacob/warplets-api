import {canonicalJson,utf8} from '../security/canonical.mjs';
import {systemPrompt} from './rubric.mjs';
import {requireReview,freeze,checkReportEnvelope,checkReportBody,checkEvidenceHashes,feedbackProjection,appealPayload,checkAppealShape} from './review-core.mjs';

/** Async WebCrypto-compatible codec. Hashes preserve the existing Node artifact bytes. */
export function createPortableReviewCodec({crypto}){
 if(typeof crypto?.sha256!=='function')throw new TypeError('SHA-256 port is required.');
 const hash=value=>crypto.sha256(utf8(typeof value==='string'?value:canonicalJson(value)));
 async function verifyReport(value){
  const report=freeze(structuredClone(value));checkReportEnvelope(report);
  requireReview(await hash(report.payload)===report.reportId,'Review artifact integrity check failed.');
  const job=checkReportBody(report);
  checkEvidenceHashes(report,await Promise.all([hash(job),hash(job.content),hash(job.projectContext),hash(systemPrompt)]));
  return report;
 }
 async function verifyAppeal(value){const appeal=freeze(structuredClone(value));checkAppealShape(appeal);requireReview(await hash(appeal.payload)===appeal.appealId,'Appeal artifact integrity check failed.');return appeal;}
 return Object.freeze({verifyReport,verifyAppeal,
  async creatorFeedback(report){return feedbackProjection(await verifyReport(report));},
  async createAppeal({report,reason,createdAt}){const payload=appealPayload(await verifyReport(report),reason,createdAt);return freeze({appealId:await hash(payload),payload});},
 });
}
