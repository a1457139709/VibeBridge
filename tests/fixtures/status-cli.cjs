const readline = require('node:readline');
const http = require('node:http');

// A real PTY program using the same reporting credentials as launch integrations.
const context = JSON.parse(process.env.VIBEBRIDGE_STATUS_CONTEXT || '{}');
function report(payload, overrides = {}, destination = context) {
  return new Promise(resolve => {
    if (!destination.url) return resolve('unavailable');
    const body = JSON.stringify({ runId: context.runId, token: context.token, agent: context.agent, payload, ...overrides });
    const request = http.request(destination.url, { method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', () => resolve('unavailable'));
    request.end(body);
  });
}
let pending = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', line => {
  pending = pending.then(async () => {
    const message = JSON.parse(line);
    if (message.exit !== undefined) process.exit(message.exit);
    if (message.context) process.stdout.write(`CONTEXT:${JSON.stringify(context)}\n`);
    // Native hook reporters always carry the CLI session identity.
    const payload = message.payload?.hook_event_name && !('session_id' in message.payload)
      ? { session_id: 'status-cli', ...message.payload } : message.payload;
    if (payload) await report(payload, message.overrides, message.destination);
    if (message.output) process.stdout.write(message.output);
    process.stdout.write(`ACK:${message.id}\n`);
  });
});
process.stdout.write('STATUS-CLI-READY\n');
