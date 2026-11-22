import type { Payload, StatusAdapter } from '../../app/main/agent-status/adapter';
import type { ProcessingState } from '../../app/shared/processing-status';

export function observe(adapter: StatusAdapter, defaults: Payload = {}) {
  const interpreter = adapter.createInterpreter();
  let state: ProcessingState | undefined;
  const accept = (payload: Payload) => {
    const outcome = interpreter.accept({ ...defaults, ...payload });
    if (outcome === 'error') interpreter.discardEvidence();
    if (outcome !== 'keep' && outcome !== 'discard') state = outcome;
    return state;
  };
  return Object.assign(accept, { session: () => interpreter.sessionId() });
}
