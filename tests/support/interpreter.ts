import type { Payload, StatusAdapter } from '../../app/main/agent-status/adapter';
import type { ProcessingState } from '../../app/shared/processing-status';

/** One run's interpreter driven as ProcessingStatus drives it. Each call returns the state the
 * run now projects: Keep and discarded facts leave it unchanged, and every Error discards evidence.
 */
export function observe(adapter: StatusAdapter, defaults: Payload = {}) {
  const interpreter = adapter.observe();
  let state: ProcessingState | undefined;
  return (payload: Payload) => {
    const outcome = interpreter.accept({ ...defaults, ...payload });
    if (outcome === 'error') interpreter.discardEvidence();
    if (outcome !== 'keep' && outcome !== 'discard') state = outcome;
    return state;
  };
}
