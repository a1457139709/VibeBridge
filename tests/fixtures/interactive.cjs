const { spawn } = require('node:child_process');
process.stdin.setRawMode(true);
process.stdout.write(`READY:${process.pid}:${process.cwd()}\r\n`);
process.stdin.on('data', data => {
  const text = data.toString();
  if (text.includes('exit')) process.exit(0);
  if (text.includes('host')) process.stdout.write(`HOST:${process.ppid}\r\n`);
  if (text.includes('child')) {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    process.stdout.write(`CHILD:${child.pid}\r\n`);
  }
  process.stdout.write(`INPUT:${text}\r\n`);
});
process.on('SIGWINCH', () => process.stdout.write(`SIZE:${process.stdout.columns}x${process.stdout.rows}\r\n`));
