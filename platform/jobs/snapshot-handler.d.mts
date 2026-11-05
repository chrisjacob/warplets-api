import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {CutoffSnapshotService} from '../earn/snapshot.mjs';
import type {CutoffFreezeRepository} from '../storage/cutoff-freeze.mjs';
import type {Handler} from './runner.mjs';
export function cutoffJobKey(epoch:number,configurationDigest:string):string;
export function createSnapshotHandler(options:{service:CutoffSnapshotService;freezeRepository:CutoffFreezeRepository;store:ArtifactStore;
 crypto:CanonicalCrypto;clock:{nowMs():number};principal:OperatorPrincipal}):Handler;
