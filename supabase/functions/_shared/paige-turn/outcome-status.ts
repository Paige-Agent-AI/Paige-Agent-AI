export interface ExecutorStatus { executor?: string | null; terminal?: boolean; stopped?: boolean }
export interface OutcomeObservation { outcome: string; verified_readback: boolean }
export async function readInteractiveOutcomeStatus(input: {
  state(): Promise<ExecutorStatus>;
  readOutcome?: () => Promise<OutcomeObservation>;
}): Promise<{ executor_active: boolean; settled: boolean; original_operation?: OutcomeObservation }> {
  let state = await input.state();
  let original_operation: OutcomeObservation | undefined;
  if (input.readOutcome) {
    try { original_operation = await input.readOutcome(); }
    catch { original_operation = { outcome: 'outcome_unknown', verified_readback: false }; }
    // Outcome evidence never settles an executor. Re-read ownership after all
    // awaited evidence reads, including a failed observation.
    state = await input.state();
  }
  return { executor_active: state.executor !== null,
    settled: state.executor === null && (state.terminal === true || state.stopped === true),
    ...(original_operation ? { original_operation } : {}) };
}
