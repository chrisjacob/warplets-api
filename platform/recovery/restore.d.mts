import type {RecoveryPorts,RecoveryService} from './types';
export function createPublicRecovery(ports:RecoveryPorts):RecoveryService;
export function createPrivateRecovery(ports:RecoveryPorts):RecoveryService;
