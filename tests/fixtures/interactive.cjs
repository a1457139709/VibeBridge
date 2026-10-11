const { spawn } = require('node:child_process');
function stream() {
  let chunks = 0;
  const chunk = `\x1b[32m${'output '.repeat(580)}\x1b[0m\r\n`;
  const write = () => {
    if (++chunks > 2048) { process.stdout.write(`\x1b[2J\x1b[HFINAL:${process.pid}\r\n\x1b[6n`); return; }
    if (process.stdout.write(chunk)) setImmediate(write);
    else process.stdout.once('drain', write);
  };
  write();
}
if (process.argv[2] === 'stream-child') { stream(); return; }
if (process.argv[2] === 'orphan-parent') {
  spawn(process.execPath, [__filename, 'orphan-child'], { detached: true, stdio: ['ignore', process.stdout, 'ignore'] }).unref();
  process.exit(0);
}
if (process.argv[2] === 'orphan-child') {
  process.stdout.write(`ORPHAN:${process.pid}\r\n`);
  setInterval(() => {}, 1000);
  return;
}
process.stdin.setRawMode(true);
const cwd = process.argv.includes('--encode-cwd') ? Buffer.from(process.cwd()).toString('hex') : process.cwd();
process.stdout.write(`READY:${process.pid}:${cwd}\r\n`);
process.stdin.on('data', data => {
  const text = data.toString();
  if (text.includes('resist')) {
    process.on('SIGTERM', () => {
      if (process.argv[2] === '--termination-file') require('node:fs').writeFileSync(process.argv[3], 'TERM:received');
      process.stdout.write('TERM:received\r\n');
    });
    process.on('SIGHUP', () => {});
  }
  if (text.includes('stream')) {
    // Keep the signal-handler fixture responsive even when macOS blocks a synchronous TTY writer.
    if (process.argv[2] === '--termination-file') spawn(process.execPath, [__filename, 'stream-child'], { stdio: ['ignore', process.stdout, 'ignore'] });
    else stream();
  }
  if (text.includes('exit')) process.exit(0);
  if (text.includes('host')) process.stdout.write(`HOST:${process.ppid}\r\n`);
  if (text.includes('later')) setTimeout(() => process.stdout.write('BACKGROUND:completed\r\n'), 300);
  if (text === 'cursor-normal') process.stdout.write('\x1b[?1l');
  if (text === 'cursor-application') process.stdout.write('\x1b[?1h');
  if (text === 'palette') process.stdout.write('\x1b[2J\x1b[H\x1b[90mANSI-GRAY\x1b[0m\r\n\x1b[38;5;242mINDEXED-GRAY\x1b[0m\r\n\x1b[38;2;102;102;102mPI-FOOTER\x1b[0m\r\n\x1b[38;2;138;190;183mACCENT\x1b[0m\r\nTEXT\r\n\x1b[2mDIM\x1b[0m\r\n\x1b[38;2;102;102;102m\u2588\u2588\x1b[0m\r\n');
  if (text.includes('orphan')) {
    const child = spawn(process.execPath, [__filename, 'orphan-parent'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', data => process.stdout.write(data));
  }
  if (text.includes('linger')) {
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    process.stdout.write(`LINGER:${child.pid}\r\n`);
  }
  if (text.includes('child')) {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    process.stdout.write(`CHILD:${child.pid}\r\n`);
  }
  process.stdout.write(`INPUT:${text}\r\n`);
  process.stdout.write(`BYTES:${data.toString('hex')}\r\n`);
});
process.on('SIGWINCH', () => process.stdout.write(`SIZE:${process.stdout.columns}x${process.stdout.rows}\r\n`));
