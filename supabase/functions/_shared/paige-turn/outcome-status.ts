export interface ExecutorStatus { executor?: string | null; terminal?: boolean; stopped?: boolean }
export interface OutcomeObservation { outcome: string; verified_readback: boolean }
export async function readInteractiveOutcomeStatus(input: {
  state(): Promise<ExecutorStatus>;
  readOutcome?: () => Promise<OutcomeObservation | undefined>;
  readWork?: () => Promise<Readonly<Record<string, unknown>> | null>;
}): Promise<{ executor_active: boolean; settled: boolean; original_operation?: OutcomeObservation; durable_work?: Readonly<Record<string, unknown>> | null }> {
  let state = await input.state();
  let original_operation: OutcomeObservation | undefined;
  let durable_work: Readonly<Record<string, unknown>> | null = null;
  if (input.readOutcome) {
    try { original_operation = await input.readOutcome(); }
    catch { original_operation = { outcome: 'outcome_unknown', verified_readback: false }; }
  }
  if (input.readWork) {
    try { durable_work = await input.readWork(); }
    catch { durable_work = null; }
  }
  // Observations never settle an executor. Re-read ownership after every
  // awaited observation, including unavailable work or failed evidence.
  if (input.readOutcome || input.readWork) state = await input.state();
  return { executor_active: state.executor !== null,
    settled: state.executor === null && (state.terminal === true || state.stopped === true),
    ...(original_operation ? { original_operation } : {}),
    ...(input.readWork ? { durable_work } : {}) };
}
