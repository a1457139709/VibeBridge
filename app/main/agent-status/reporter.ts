import { request } from 'node:http';

type Payload = Record<string, unknown>;
export interface ReportingContext {
  url: string;
  runId: string;
  agent: string;
  token: string;
}

export function reportingContext(agent: string): ReportingContext | undefined {
  try {
    const context = JSON.parse(process.env.VIBEBRIDGE_STATUS_CONTEXT ?? '{}');
    const url = new URL(context.url);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      context.agent !== agent ||
      typeof context.runId !== 'string' ||
      typeof context.token !== 'string'
    )
      return;
    return context;
  } catch {
    return;
  }
}

export function report(context: ReportingContext, payload: Payload): Promise<boolean> {
  const body = JSON.stringify({ runId: context.runId, agent: context.agent, token: context.token, payload });
  return new Promise(resolve => {
    const req = request(context.url, { method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode === 204));
    });
    const timer = setTimeout(() => req.destroy(), 1500);
    req.once('close', () => {
      clearTimeout(timer);
      resolve(false);
    });
    req.once('error', () => resolve(false));
    req.end(body);
  });
}

async function readAndReport(context: ReportingContext, select: (raw: Payload) => Payload) {
  let input = '',
    size = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk);
    if (size <= 8 * 1024 * 1024) input += chunk;
  }
  if (size > 8 * 1024 * 1024) {
    await report(context, { observation: 'lost' });
    return;
  }
  let payload: Payload;
  try {
    const raw = JSON.parse(input);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid hook input');
    payload = select(raw);
    if (Buffer.byteLength(JSON.stringify(payload)) > 60 * 1024) throw new Error('Hook identity too large');
  } catch {
    payload = { observation: 'lost' };
  }
  await report(context, payload);
}

export function runCommandHookReporter(agent: string, select: (raw: Payload) => Payload) {
  const context = reportingContext(agent);
  void (context ? readAndReport(context, select) : Promise.resolve()).catch(() => {}).finally(() => process.exit(0));
}
