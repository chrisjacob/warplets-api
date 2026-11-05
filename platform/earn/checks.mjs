import { createHash } from 'node:crypto';

export { EarnError, requireValue, conflict, name, nat, decimal } from './validation.mjs';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
