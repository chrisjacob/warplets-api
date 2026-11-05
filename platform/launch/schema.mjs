const object = (properties, required = Object.keys(properties)) =>
  ({ type: 'object', additionalProperties: false, properties, required });
const text = { type: 'string', minLength: 1, maxLength: 120 };
const units = { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$', description: 'Canonical unsigned base-unit integer.' };
const time = { type: 'string', format: 'date-time', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.0{1,3})?Z$',
  description: 'UTC RFC 3339 timestamp with whole-second precision, at or after 1970-01-01.' };
const cents = { type: 'integer', minimum: 0, maximum: 1_000_000_000, description: 'USD cents.' };
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const enumeration = (...values) => ({ type: 'string', enum: values });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });

const og = object({
  mint: { type: 'string', minLength: 32, maxLength: 44, pattern: '^[1-9A-HJ-NP-Za-km-z]+$' },
  decimals: integer(0, 255),
  compatibility: enumeration('unknown', 'unsupported', 'reviewed'),
  source: text, priceUsdMicros: units, observedAt: time,
}, ['mint', 'decimals', 'compatibility']);

export const launchPreviewRequest = object({
  proposedActivation: time,
  supplyBaseUnits: units,
  activeSeasonWeight: units,
  og,
  history: object({ observedAt: time, coversFrom: time, launches: array(object({ id: text, activatedAt: time }), 64) }),
  firstPilotCost: object({ availableCashCents: cents, networkCents: cents, rentCents: cents,
    protocolCents: cents, retryCents: cents, otherCents: cents }),
  swapSimulation: object({ ogSpentUnits: units, attReceivedUnits: units, observedAt: time, source: text }),
}, ['proposedActivation', 'supplyBaseUnits', 'activeSeasonWeight']);

export const launchPlanTerms = Object.freeze({
  mode: 'offline-validation', signsTransactions: false, persistsPlans: false,
  executable: false, maxEvidenceAgeSeconds: 60, launchDayTimeZone: 'Australia/Sydney',
  defaultWindow: null, priceEvidencePolicy: 'provisional-pilot-fixture',
});

const status = enumeration('pass', 'blocked', 'review', 'unknown');
const gate = object({ id: text, status, detail: { type: 'string' } });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const preview = object({
  mode: { const: 'offline-validation' }, executable: { const: false }, proposedActivation: time,
  sydneyLaunchDay: { type: 'string', format: 'date' }, assessedAt: time,
  allocationBaseUnits: object(Object.fromEntries(['liquidity','earn','dailyEarn','stake','genesisVault','seasonVault'].map(k => [k, units]))),
  feeSchedule: array(object({ elapsedSeconds: integer(0, 90), feeBps: integer(100, 9000) }), 7),
  simulatedFdvUsdMicros: nullable({ type: 'string', pattern: '^[0-9]+$' }),
  activeCampaigns: nullable(integer(0, 64)),
  pilotCost: nullable(object({ totalCents: integer(0, 5_000_000_000), availableCashCents: cents,
    ordinaryTargetCents: cents, reserveGuidelineMet: { type: 'boolean' }, founderExceptionNeeded: { type: 'boolean' } })),
  gates: array(gate, 20),
});
const jsonContent = schema => ({ 'application/json': { schema } });
export const launchPlanPaths = {
  '/launch-plans': { get: { operationId: 'listLaunchPlans', summary: 'Read local launch-planning terms.',
    responses: { 200: { description: 'Stateless planning resource.', content: jsonContent(object({
      items: { type: 'array', maxItems: 0, items: {} }, terms: { type: 'object', properties: {
        mode: { const: 'offline-validation' }, executable: { const: false }, maxEvidenceAgeSeconds: integer(1, 3600),
      } },
    })) } } } },
  '/launch-plans/preview': { post: { operationId: 'previewLaunchPlan', summary: 'Evaluate an operator-supplied scenario offline.',
    requestBody: { required: true, content: jsonContent(launchPreviewRequest) }, responses: {
      200: { description: 'Planning calculation with evidence gates.', content: jsonContent(preview) },
      400: { description: 'Malformed or unsupported scenario.' }, 413: { description: 'Body exceeds 32 KiB.' },
      415: { description: 'Send application/json.' },
    } } },
};

// Validate the small, closed request schema above, also published verbatim
// in OpenAPI. Keeping these in sync prevents undocumented money inputs.
export function validateInput(value, schema = launchPreviewRequest, field = 'body') {
  function invalid(rule) { throw new RangeError(`${field} ${rule}`); }
  switch (schema.type) {
    case 'object':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('must be an object');
      for (const key of schema.required) if (!Object.hasOwn(value, key)) invalid(`is missing ${key}`);
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) invalid('contains an unknown property');
        validateInput(value[key], schema.properties[key], field + '.' + key);
      }
      break;
    case 'array':
      if (!Array.isArray(value) || value.length > schema.maxItems) invalid('is not a bounded list');
      value.forEach((item, i) => validateInput(item, schema.items, field + '[' + i + ']'));
      break;
    case 'integer':
      if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) invalid('is outside its integer range');
      break;
    case 'string':
      if (typeof value !== 'string' || value.length < (schema.minLength ?? 1) ||
        value.length > (schema.maxLength ?? 120) || (schema.pattern && !new RegExp(schema.pattern).test(value)) ||
        (schema.enum && !schema.enum.includes(value))) invalid('has an invalid value');
      break;
    default: throw Error('Unsupported launch input schema.');
  }
}
