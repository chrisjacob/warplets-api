import { failure, json } from '../server/api.mjs';
import { previewLaunchPlan } from './planner.mjs';
import { launchPlanTerms } from './schema.mjs';

const base = '/api/v1/launch-plans';
const maxBytes = 32 * 1024;
class Oversize extends Error {}

async function readPreview(request) {
  const length = request.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) throw new Oversize();
  if (!request.body) throw new SyntaxError('JSON body required');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Oversize();
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export async function handleLaunchPlans(request, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const path = new URL(request.url).pathname;
  if (path !== base && path !== base + '/preview') return null;
  const method = path === base ? 'GET' : 'POST';
  if (request.method !== method) return failure(405, 'method_not_allowed', `This resource supports ${method}.`, { allow: method });
  if (method === 'GET') return json({ items: [], terms: launchPlanTerms });
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return failure(415, 'unsupported_media_type', 'Send a JSON preview request.');
  }
  let input;
  try {
    input = await readPreview(request);
  } catch (error) {
    if (error instanceof Oversize) return failure(413, 'body_too_large', 'Limit the preview to 32 KiB.');
    return failure(400, 'invalid_json', 'Send valid UTF-8 JSON.');
  }
  try {
    return json(previewLaunchPlan(input, nowSeconds));
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
    return failure(400, 'invalid_plan', error.message);
  }
}
