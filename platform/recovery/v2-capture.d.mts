import type {RecoveryV2CaptureService,RecoveryV2Ports} from './v2-contracts';
export function createRecoveryV2Capture(ports:Omit<RecoveryV2Ports,'ids'>):RecoveryV2CaptureService;
