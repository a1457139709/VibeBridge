import { request } from 'node:http';

// Short-lived command hook. Never writes hook decisions or model context, and always
// exits successfully so observation cannot reject a prompt or keep a turn alive.
async function report(payload: Record<string, unknown>) {
  const context = JSON.parse(process.env.VIBEBRIDGE_STATUS_CONTEXT ?? '{}');
  const url = new URL(context.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || context.agent !== 'codex') return;
  const body = JSON.stringify({ ...context, version: 1, source: 'codex-hook', scope: 'main', payload });
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

async function main() {
  let input = '', size = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk);
    if (size <= 8 * 1024 * 1024) input += chunk;
  }
  if (size > 8 * 1024 * 1024) { await report({ observation: 'lost' }); return; }
  let payload: Record<string, unknown>;
  try {
    const raw = JSON.parse(input);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid hook input');
    // Prompts, transcripts and tool output can be large and are not needed for status.
    payload = Object.fromEntries(['hook_event_name', 'session_id', 'source', 'turn_id', 'agent_id', 'agent_type',
      'tool_name', 'tool_use_id', 'permission_mode'].filter(key => key in raw).map(key => [key, raw[key]]));
    if (Buffer.byteLength(JSON.stringify(payload)) > 60 * 1024) throw new Error('Hook identity too large');
  } catch { payload = { observation: 'lost' }; }
  await report(payload);
}
void main().catch(() => {}).finally(() => process.exit(0));
