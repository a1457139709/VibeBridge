export type ProcessingState = 'ready' | 'busy' | 'needs-input' | 'done' | 'error';
export type AttentionState = 'needs-input' | 'done' | 'error';
export interface AttentionGroup { count: number; members: { panelId: string; runId: string }[] }
export interface ProcessingProjection {
  runs: Record<string, ProcessingState>;
  projects: Record<string, Record<AttentionState, AttentionGroup>>;
}
