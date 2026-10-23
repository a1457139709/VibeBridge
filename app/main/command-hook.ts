import { request } from 'node:http';

type Payload = Record<string, unknown>;

async function report(agent: 'codex' | 'claude', payload: Payload) {
  const context = JSON.parse(process.env.VIBEBRIDGE_STATUS_CONTEXT ?? '{}');
  const url = new URL(context.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || context.agent !== agent) return;
  const body = JSON.stringify({ ...context, version: 1, source: `${agent}-hook`, scope: 'main', payload });
  await new Promise<void>(resolve => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
      response.resume(); response.once('end', resolve);
    });
    const timer = setTimeout(() => req.destroy(), 1500);
    req.once('close', () => { clearTimeout(timer); resolve(); });
    req.once('error', () => resolve());
    req.end(body);
  });
}

async function readAndReport(agent: 'codex' | 'claude', select: (raw: Payload) => Payload) {
  let input = '', size = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk);
    if (size <= 8 * 1024 * 1024) input += chunk;
  }
  if (size > 8 * 1024 * 1024) { await report(agent, { observation: 'lost' }); return; }
  let payload: Payload;
  try {
    const raw = JSON.parse(input);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid hook input');
    payload = select(raw);
    if (Buffer.byteLength(JSON.stringify(payload)) > 60 * 1024) throw new Error('Hook identity too large');
  } catch { payload = { observation: 'lost' }; }
  await report(agent, payload);
}

/** Short-lived observer: no hook decisions, output, model context or background
 * process. Observation failure never rejects input or keeps a turn alive.
 */
export function commandHook(agent: 'codex' | 'claude', select: (raw: Payload) => Payload) {
  void readAndReport(agent, select).catch(() => {}).finally(() => process.exit(0));
}
