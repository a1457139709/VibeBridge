export type ProcessingState = 'ready' | 'busy' | 'needs-input' | 'done' | 'error';
/** States the project summary counts, in display order; Busy is shown only on panels and navigation. */
export const summaryStates = ['ready', 'needs-input', 'done', 'error'] as const satisfies readonly ProcessingState[];
export type SummaryState = typeof summaryStates[number];
export const isSummaryState = (state: ProcessingState): state is SummaryState => (summaryStates as readonly ProcessingState[]).includes(state);
export interface SummaryGroup { count: number; members: { panelId: string; runId: string }[] }
export interface ProcessingProjection {
  runs: Record<string, ProcessingState>;
  projects: Record<string, Record<SummaryState, SummaryGroup>>;
}
