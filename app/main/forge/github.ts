import { execFile } from 'node:child_process';
import { executable } from '../../terminal/environment';
import { ForgeError, type Forge } from './forge';

/** Runs `gh`, found on PATH, with the account it has active. The Workbench never reads or stores a token. */
async function gh(args: string[]): Promise<string> {
  let program: string;
  try { program = await executable('gh', process.env as Record<string, string>); }
  catch { throw new ForgeError('notInstalled', ''); }
  return new Promise((resolve, reject) => {
    execFile(program, args, { env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
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

const outputLines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

export const github: Forge = {
  id: 'github',
  presentation: { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' },
  capabilities: {},
  async account() { return (await gh(['api', 'user', '--jq', '.login'])).trim(); },
  async repositories() {
    return outputLines(await gh(['api', '--paginate', 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100', '--jq', '.[].full_name']));
  },
  remotePath(url) {
    // owner/repo from a github.com remote URL in HTTPS, SSH or scp-like form.
    const match = url.trim().match(/^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|[^@/\s]+@github\.com:)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
    return match?.[1] ?? null;
  },
  find(path, repositories) {
    // GitHub repository paths are case-insensitive.
    return repositories.find(repository => repository.toLowerCase() === path.toLowerCase()) ?? null;
  },
};
