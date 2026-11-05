import type {RecoveryPorts,ExportOutcome,PublicRecoveryPin} from './types';
import type {ManifestCodec,VerifiedManifestArtifact} from '../artifacts/manifest-codec.mjs';
export function createRecoveryExporter(ports:Omit<RecoveryPorts,'ids'|'sourceArtifacts'>&{sourceCommit:string}):Readonly<{capturePublic():Promise<ExportOutcome>;capturePrivate():Promise<ExportOutcome>}>;
export function publicationPin(verified:VerifiedManifestArtifact,codec:ManifestCodec):Promise<PublicRecoveryPin>;
