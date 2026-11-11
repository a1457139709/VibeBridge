const { readFileSync } = require('node:fs');

// A `gh` CLI double. The test writes the account's state to the JSON file named by
// VIBEBRIDGE_GH_DOUBLE: { account, repositories: ["owner/repo", …], failure?: { code, stdout?, stderr? } }.
// A failure answers every command the way `gh` fails, with that exit code and output.
const state = JSON.parse(readFileSync(process.env.VIBEBRIDGE_GH_DOUBLE, 'utf8'));
const args = process.argv.slice(2);
if (state.failure) {
  process.stdout.write(state.failure.stdout ?? '');
  process.stderr.write(state.failure.stderr ?? '');
  process.exit(state.failure.code);
}
if (args[0] === 'api' && args.includes('user')) process.stdout.write(`${state.account}\n`);
else if (args[0] === 'api' && args.some(arg => arg.startsWith('user/repos'))) process.stdout.write(state.repositories.map(path => `${path}\n`).join(''));
else { process.stderr.write(`gh double: unsupported command ${args.join(' ')}\n`); process.exit(1); }
