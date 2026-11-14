import { execFile } from 'node:child_process';
import { z } from 'zod';
import { executable } from '../../terminal/environment';
import { ForgeError } from './forge';

// The GitHub adapter's only way to GitHub: the `gh` CLI, its failures sorted into the forge failure kinds.

/** Runs `gh`, found on PATH, with the account it has active, and returns its standard output. The Workbench never reads or stores a token. */
export async function gh(args: string[]): Promise<string> {
  return (await ghOutput(args)).stdout;
}

/** Runs `gh` and returns what it printed: a write subcommand reports on standard error. */
export async function ghOutput(args: string[]): Promise<{ stdout: string; stderr: string }> {
  let program: string;
  try { program = await executable('gh', process.env as Record<string, string>); }
  catch { throw new ForgeError('notInstalled', ''); }
  return new Promise((resolve, reject) => {
    execFile(program, args, { env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr });
        const code = (error as { code?: unknown }).code;
        reject(code === 'ENOENT' ? new ForgeError('notInstalled', '') : classifyFailure(typeof code === 'number' ? code : null, stdout, stderr || error.message));
      });
  });
}

/** Exit code 4 is gh's "authentication required"; 401 and 404 come from the REST API, NOT_FOUND from GraphQL. */
function classifyFailure(code: number | null, stdout: string, stderr: string) {
  const detail = stderr.trim() || stdout.trim();
  if (code === 4 || /\bHTTP 401\b/.test(stderr)) return new ForgeError('loggedOut', detail);
  if (/\bHTTP 404\b/.test(stderr) || /"type"\s*:\s*"NOT_FOUND"/.test(stdout + stderr)) return new ForgeError('inaccessible', detail);
  return new ForgeError('transient', detail);
}

/** Runs a GraphQL query and reads its data with `schema`; output gh did not fail on but that does not fit is a transient failure.
 * A number variable is sent as a GraphQL Int (`-F`), a string as a String (`-f`). */
export async function graphql<T>(query: string, variables: Record<string, string | number>, schema: z.ZodType<T>): Promise<T> {
  const output = await gh(['api', 'graphql', '-f', `query=${query}`,
    ...Object.entries(variables).flatMap(([key, value]) => [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`])]);
  let json: unknown;
  try { json = JSON.parse(output); } catch { throw new ForgeError('transient', output.trim()); }
  const parsed = z.object({ data: schema }).safeParse(json);
  if (!parsed.success) throw new ForgeError('transient', output.trim());
  return parsed.data.data;
}
