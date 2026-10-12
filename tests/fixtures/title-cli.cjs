// Controlled terminal-title producer, exercised only through the public Workbench API.
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdout.write(`READY:${process.pid}\r\n`);
if (process.argv[2] === '--initial-title') process.stdout.write(`\x1b]2;${process.argv[3]}\x07`);
let input = '';
let commands = Promise.resolve();
process.stdin.on('data', data => {
  if (!input && !data.toString().startsWith('{')) { process.stdout.write(`INPUT:${data}\r\nBYTES:${Buffer.from(data).toString('hex')}\r\n`); return; }
  input += data;
  let newline;
  while ((newline = input.indexOf('\n')) !== -1) {
    const line = input.slice(0, newline); input = input.slice(newline + 1);
    commands = commands.then(async () => {
      const command = JSON.parse(line);
      if (command.host) process.stdout.write(`HOST:${process.ppid}\r\n`);
      if (command.onTerminate) {
        process.on('SIGHUP', () => {});
        process.on('SIGTERM', () => { process.stdout.write(`\x1b]2;${command.onTerminate}\x07`); setTimeout(() => process.exit(0), 80); });
      }
      for (const chunk of command.chunks ?? []) {
        process.stdout.write(chunk);
        if (command.delay) await new Promise(resolve => setTimeout(resolve, command.delay));
      }
      process.stdout.write(`DONE:${command.id}\r\n`);
    });
  }
});
