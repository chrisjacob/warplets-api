import worker from '../../src/worker';
import fixture from './refresh-repository-worker';
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){return new URL(request.url).pathname==='/__fixture'?fixture.fetch(request,env):worker.fetch(request,env,ctx);}};
