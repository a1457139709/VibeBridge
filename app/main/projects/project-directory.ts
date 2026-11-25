import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { DirectoryInspection, Project } from '../../shared/model';

export async function inspectDirectory(path: string, projects: Project[]): Promise<DirectoryInspection> {
  let directory: string;
  try {
    directory = await realpath(path);
    if (!(await stat(directory)).isDirectory()) return { ok: false, problem: { kind: 'notDirectory' } };
  } catch {
    return { ok: false, problem: { kind: 'missing' } };
  }
  const existing = projects.find(project => project.directory === directory);
  if (existing)
    return { ok: false, problem: { kind: 'duplicate', projectId: existing.id, projectName: existing.name } };
  return { ok: true, directory, name: basename(directory) };
}
