import { report, reportingContext } from '../reporter';

type Payload = Record<string, unknown>;
interface Context { isIdle(): boolean; hasPendingMessages(): boolean }
interface ExtensionAPI { on(name: string, handler: (event: Payload, context: Context) => Promise<void>): void }
interface Delivery { pending: Promise<void>; lost: boolean }
const key = Symbol.for('vibebridge.pi.status.delivery');
const runtime = globalThis as typeof globalThis & { [key]?: Map<string, Delivery> };

/** Loaded only by this invocation's --extension. No tools, UI, commands, hook
 * decisions or child-session subscriptions are installed by this observer.
 */
export default function install(pi: ExtensionAPI) {
  const context = reportingContext('pi');
  if (!context) return;
  // Pi /reload can replace the extension module within the same process. Keep
  // one delivery queue for this launch across those loads, so reports stay in order.
  const deliveries = runtime[key] ??= new Map();
  let delivery = deliveries.get(context.token);
  if (!delivery) { delivery = { pending: Promise.resolve(), lost: false }; deliveries.set(context.token, delivery); }
  const source = delivery;
  const send = (payload: Payload) => report(context, payload);
  const events = ['session_start', 'session_switch', 'session_fork', 'session_tree', 'session_shutdown',
    'agent_start', 'agent_end', 'agent_settled', 'message_end', 'ui_prompt_start', 'ui_prompt_end',
    'tool_execution_start', 'tool_execution_end', 'session_before_compact', 'session_compact', 'session_compact_failed'];
  for (const name of events) pi.on(name, (event, ctx) => {
    let payload: Payload;
    try {
      payload = { type: event.type, isIdle: ctx.isIdle(), hasPendingMessages: ctx.hasPendingMessages() };
      if (name === 'message_end') {
        const message = event.message as Payload | undefined;
        payload.message = { role: message?.role, stopReason: message?.stopReason };
      }
      if (name === 'agent_end') {
        // Later user extensions can replace message_end.message. This loop's
        // agent_end messages have passed those handlers; never read old history.
        const messages = Array.isArray(event.messages) ? event.messages : [];
        const assistant = messages.findLast(message => message?.role === 'assistant');
        payload.finalStopReason = typeof assistant?.stopReason === 'string' ? assistant.stopReason : null;
      }
      if (name === 'agent_settled') payload.aborted = event.aborted;
      if (name.startsWith('session_') && name.includes('compact')) {
        payload.reason = event.reason; payload.willRetry = event.willRetry; payload.aborted = event.aborted;
      }
      if (name === 'session_shutdown') payload = { observation: 'unavailable' };
    } catch { payload = { observation: 'lost' }; }
    // UI lifecycle callbacks are not awaited by Pi. Enqueue synchronously so
    // their delivery cannot overtake agent/tool callbacks from this instance.
    source.pending = source.pending.then(async () => {
      if (source.lost && !await send({ observation: 'lost' })) return;
      source.lost = !await send(payload);
    }).catch(() => { source.lost = true; });
    return source.pending;
  });
}
