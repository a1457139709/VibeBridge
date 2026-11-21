import { execFile } from 'node:child_process';
import { z } from 'zod';
import { executable } from '../../terminal/environment';
import { ForgeError } from './forge';

// The GitHub adapter's only way to GitHub: the `gh` CLI, its failures sorted into the forge failure kinds.

/** Runs `gh`, found on PATH, against `host` with the account it has active there, and returns its standard output.
 * The Workbench never reads or stores a token. */
export async function gh(host: string, args: string[]): Promise<string> {
  return (await ghOutput(host, args)).stdout;
}

/** Runs `gh` against `host` and returns what it printed: a write subcommand reports on standard error. */
export async function ghOutput(host: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { failure, stdout, stderr } = await run(host, args);
  if (failure) throw failure;
  return { stdout, stderr };
}

/** Runs `gh` against `host`: what it printed, and the failure it ended in, if any. */
async function run(
  host: string,
  args: string[],
): Promise<{ failure: ForgeError | null; stdout: string; stderr: string }> {
  let program: string;
  try {
    program = await executable('gh', process.env as Record<string, string>);
  } catch {
    throw new ForgeError('notInstalled', '');
  }
  return new Promise(resolve => {
    execFile(
      program,
      args,
      {
        env: { ...process.env, GH_HOST: host, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ failure: null, stdout, stderr });
        const code = (error as { code?: unknown }).code;
        const failure =
          code === 'ENOENT'
            ? new ForgeError('notInstalled', '')
            : classifyFailure(typeof code === 'number' ? code : null, stdout, stderr || error.message);
        resolve({ failure, stdout, stderr });
      },
    );
  });
}

/** Exit code 4 is gh's "authentication required"; 401 and 404 come from the REST API, NOT_FOUND from GraphQL. A write
 * subcommand prints only GraphQL's message, which names a repository the account cannot see. */
function classifyFailure(code: number | null, stdout: string, stderr: string) {
  const detail = stderr.trim() || stdout.trim();
  if (code === 4 || /\bHTTP 401\b/.test(stderr)) return new ForgeError('loggedOut', detail);
  if (
    /\bHTTP 404\b/.test(stderr) ||
    /"type"\s*:\s*"NOT_FOUND"/.test(stdout + stderr) ||
    /^GraphQL: Could not resolve to a Repository\b/m.test(stderr)
  )
    return new ForgeError('inaccessible', detail);
  return new ForgeError('transient', detail);
}

/** Runs a GraphQL query on `host` and reads its data with `schema`; output gh did not fail on but that does not fit is a transient failure.
 * A number variable is sent as a GraphQL Int (`-F`), a string as a String (`-f`). */
export async function graphql<T>(
  host: string,
  query: string,
  variables: Record<string, string | number>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { failure, stdout } = await run(host, graphqlArgs(query, variables));
  if (failure) throw failure;
  return graphqlData(stdout, schema);
}

/** Runs a GraphQL query on `host` whose fields under the top-level one may each name an item the forge does not have,
 * and reads its data with `schema`. GitHub answers such a field with null and a NOT_FOUND error beside the data, and `gh`
 * fails on it: those errors alone leave the data standing. Any other failure stands. */
export async function graphqlAllowingMissing<T>(
  host: string,
  query: string,
  variables: Record<string, string | number>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { failure, stdout } = await run(host, graphqlArgs(query, variables));
  if (failure && !onlyMissingItems(stdout)) throw failure;
  return graphqlData(stdout, schema);
}

const graphqlArgs = (query: string, variables: Record<string, string | number>) => [
  'api',
  'graphql',
  '-f',
  `query=${query}`,
  ...Object.entries(variables).flatMap(([key, value]) => [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`]),
];

const missingItemsSchema = z.object({
  data: z.record(z.string(), z.object({}).passthrough()),
  errors: z.array(z.object({ type: z.literal('NOT_FOUND'), path: z.array(z.unknown()).min(2) })).min(1),
});
/** Whether a failed GraphQL answer holds its data, failing only on fields under the top-level one that found nothing. */
function onlyMissingItems(output: string) {
  try {
    return missingItemsSchema.safeParse(JSON.parse(output)).success;
  } catch {
    return false;
  }
}

function graphqlData<T>(output: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    throw new ForgeError('transient', output.trim());
  }
  const parsed = z.object({ data: schema }).safeParse(json);
  if (!parsed.success) throw new ForgeError('transient', output.trim());
  return parsed.data.data;
}
