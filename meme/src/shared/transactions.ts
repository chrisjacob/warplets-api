/** A transaction intent is a review record, never a signer or broadcast instruction. */
export type TransactionNetwork =
  | "base-local"
  | "solana-local"
  | "base-mainnet"
  | "solana-mainnet";
export type TransactionOperation =
  | "launch"
  | "create-distributor"
  | "fund"
  | "claim";
export type TransactionState =
  | "prepared"
  | "awaiting_approval"
  | "unknown"
  | "submitted"
  | "confirmed"
  | "failed";
export interface TransactionPlan {
  version: 1;
  network: TransactionNetwork;
  operation: TransactionOperation;
  subject: string;
  /** Bound to immutable allocation/edition/claim identity, not a random retry nonce. */
  businessKey: string;
  signers: string[];
  instructions: {
    program: string;
    accounts: { address: string; signer: boolean; writable: boolean }[];
    data: string;
    description: string;
  }[];
  expected: Record<string, string>;
  maximumCost: string;
  costUnit: "wei" | "lamports";
  notBefore: number;
  expiresAt: number;
  simulated: boolean;
}
export interface SimulationEvidence {
  planHash: string;
  success: boolean;
  cost: string;
  context: string;
  expectedHash: string;
  observedAt: number;
}
export interface ChainObservation {
  status: "pending" | "confirmed" | "finalized" | "failed" | "absent";
  network: TransactionNetwork;
  planHash: string;
  signature: string | null;
  expectedHash: string;
  context: string;
  /** An absent result is decisive only after chain expiry and a complete intent search. */
  expired: boolean;
  complete: boolean;
}
export interface TransactionReadAdapter {
  simulate(
    plan: TransactionPlan,
    planHash: string,
  ): Promise<SimulationEvidence>;
  inspect(
    plan: TransactionPlan,
    planHash: string,
    signature: string | null,
  ): Promise<ChainObservation>;
}
