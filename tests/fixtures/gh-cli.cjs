const { readFileSync } = require('node:fs');

// External CLI double for GitHub's `gh`: answers `gh api graphql` for the viewer and the
// viewer's repositories from a state file the test writes. A state `failure` makes every
// call end with the given exit code, stdout and stderr, as `gh` does when the API refuses.
// Pages hold at most `pageSize` repositories, whatever the query asks for, so a caller
// that reads only the first page sees an incomplete list.
module.exports = function gh(stateFile, args) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.failure) {
    process.stdout.write(state.failure.stdout ?? '');
    process.stderr.write(state.failure.stderr ?? '');
    process.exit(state.failure.exit);
  }
  const fields = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '-f' || args[index] === '-F') {
      const [key, ...value] = args[++index].split('=');
      fields[key] = value.join('=');
    }
  }
  if (args[0] !== 'api' || args[1] !== 'graphql' || !fields.query?.includes('viewer')) {
    process.stderr.write(`gh double: unsupported call ${JSON.stringify(args)}\n`);
    process.exit(1);
  }
  const viewer = { login: state.login };
  if (fields.query.includes('repositories')) {
    const size = state.pageSize ?? 2;
    const start = fields.cursor ? Number(fields.cursor) : 0;
    const page = state.repositories.slice(start, start + size);
    const end = start + page.length;
    viewer.repositories = {
      nodes: page.map(path => ({ nameWithOwner: path, url: `https://github.com/${path}` })),
      pageInfo: { hasNextPage: end < state.repositories.length, endCursor: String(end) },
    };
  }
  process.stdout.write(JSON.stringify({ data: { viewer } }));
};
