import type { Payload, StatusAdapter } from '../../app/main/agent-status/adapter';
import type { ProcessingState } from '../../app/shared/processing-status';

/** One run's interpreter driven as ProcessingStatus drives it. Each call returns the state the
 * run now projects: Keep and discarded facts leave it unchanged, and every Error discards evidence.
 * `session()` is the current session ID the run reports.
 */
export function observe(adapter: StatusAdapter, defaults: Payload = {}) {
  const interpreter = adapter.observe();
  let state: ProcessingState | undefined;
  const accept = (payload: Payload) => {
    const outcome = interpreter.accept({ ...defaults, ...payload });
    if (outcome === 'error') interpreter.discardEvidence();
    if (outcome !== 'keep' && outcome !== 'discard') state = outcome;
    return state;
  };
  return Object.assign(accept, { session: () => interpreter.session() });
}
