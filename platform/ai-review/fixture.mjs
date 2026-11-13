import {dimensions,RUBRIC_VERSION} from './rubric.mjs';
import {createHash} from 'node:crypto';
/** Deliberately synthetic: stable UI/test data, not a quality estimator or language model. */
export const syntheticProvider=Object.freeze({id:'synthetic-local',model:'not-a-language-model',version:'1',kind:'synthetic',provenance:'local-fixture',async evaluate({untrustedData:{content}}){
 const digest=createHash('sha256').update(content).digest(),quote=content.slice(0,120).trimEnd();
 const injection=/ignore (?:all |previous )?instructions|give me (?:a |the )?(?:10|maximum)|system prompt/i.test(content);
 return {rubricVersion:RUBRIC_VERSION,verification:'provided-material-only',confidence:injection?'low':'medium',flags:injection?['prompt-injection']:[],summary:'Synthetic QA feedback only. This deterministic example demonstrates how a review will appear; it does not assess real content quality.',criteria:dimensions.map((d,index)=>({id:d.id,score:2+digest[index]%4,rationale:'SIMULATION: example '+d.label.toLowerCase()+' feedback tied to the provided excerpt.',improvement:'SIMULATION: add one concrete example that helps explain the project to a new reader.',evidence:[{start:0,end:quote.length,quote}]}))};
}});
export const exampleJob=Object.freeze({submissionId:'synthetic-ai-review-001',tokenId:'synthetic-att',url:'https://qa.invalid/submissions/synthetic-ai-review-001',capturedAt:'2026-11-13T00:00:00.000Z',contentType:'text',content:'SYNTHETIC QA CONTENT. Attention Tokens help communities support a project. Here is a simple explanation of how creating useful content connects to reviewed rewards. This is a local demonstration, not an investment recommendation.',projectContext:'SYNTHETIC PROJECT CONTEXT. Contributors publish original content, submit a link and qualify with the required corresponding-token stake. Content is reviewed. A submission does not guarantee a reward.'});

/** Public QA demonstration only; never reads or scores a wallet submission. */
export async function createSyntheticReviewPreview(){
 const {evaluateSubmission,creatorFeedback}=await import('./review.mjs');
 return creatorFeedback(await evaluateSubmission({job:exampleJob,provider:syntheticProvider,nowMs:Date.parse(exampleJob.capturedAt)+1000}));
}
