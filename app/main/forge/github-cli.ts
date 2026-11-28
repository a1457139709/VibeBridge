import { execFile } from 'node:child_process';
import { parseJsonText } from '../../shared/json-text';
import { z } from 'zod';
import { resolveExecutable } from '../../terminal/environment';
import { ForgeError } from './forge';

export async function gh(host: string, args: string[]): Promise<string> {
  return (await ghOutput(host, args)).stdout;
}

export async function ghOutput(host: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { failure, stdout, stderr } = await run(host, args);
  if (failure) throw failure;
  return { stdout, stderr };
}

async function run(
  host: string,
  args: string[],
): Promise<{ failure: ForgeError | null; stdout: string; stderr: string }> {
  let program: string;
  try {
    program = await resolveExecutable('gh', process.env);
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
        const code = error.code;
        const failure =
          code === 'ENOENT'
            ? new ForgeError('notInstalled', '')
            : classifyFailure(typeof code === 'number' ? code : null, stdout, stderr || error.message);
        resolve({ failure, stdout, stderr });
      },
    );
  });
}

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

export async function graphql<T>(
  host: string,
  query: string,
  variables: GraphqlVariables,
  schema: z.ZodType<T>,
): Promise<T> {
  const { failure, stdout } = await run(host, graphqlArgs(query, variables));
  if (failure) throw failure;
  return graphqlData(stdout, schema);
}

export async function graphqlAllowingMissing<T>(
  host: string,
  query: string,
  variables: GraphqlVariables,
  schema: z.ZodType<T>,
): Promise<T> {
  const { failure, stdout } = await run(host, graphqlArgs(query, variables));
  if (failure && !onlyMissingItems(stdout)) throw failure;
  return graphqlData(stdout, schema);
}

type GraphqlVariables = Record<string, string | number | undefined>;

const graphqlArgs = (query: string, variables: GraphqlVariables) => [
  'api',
  'graphql',
  '-f',
  `query=${query}`,
  ...Object.entries(variables).flatMap(([key, value]) =>
    value === undefined ? [] : [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`],
  ),
];

const missingItemsSchema = z.object({
  data: z.record(z.string(), z.object({}).passthrough()),
  errors: z.array(z.object({ type: z.literal('NOT_FOUND'), path: z.array(z.unknown()).min(2) })).min(1),
});
const onlyMissingItems = (output: string) => parseJsonText(output, missingItemsSchema).success;

function graphqlData<T>(output: string, schema: z.ZodType<T>): T {
  const parsed = parseJsonText(output, z.object({ data: schema }));
  if (!parsed.success) throw new ForgeError('transient', output.trim());
  return parsed.data.data;
}
