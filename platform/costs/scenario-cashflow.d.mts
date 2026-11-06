import type {CostScenario,CostJson} from './packet-types.mjs';
import type {CashflowInput,CashflowResult} from './cashflow.mjs';
export interface ScenarioCashflow {readonly format:'10x.scenario-cashflow.v1';readonly scenarioId:number|string;readonly graph:CashflowInput;readonly result:CashflowResult;readonly receipts:readonly Readonly<{termId:CostJson;payer:CostJson;unit:CostJson;amount:CostJson;usdMicros:CostJson;problems:readonly CostJson[]}>[];readonly limitations:readonly string[];readonly financialExecution:false;readonly isAuthorization:false}
export function scenarioCashflow(scenario:CostScenario):ScenarioCashflow;
