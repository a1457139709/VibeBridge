import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { DirectoryResult, Project } from '../shared/model';

/** Whether `path` names a directory: its real path and name, and the project among `projects` that already uses it. */
export async function inspectDirectory(path: string, projects: Project[]): Promise<DirectoryResult> {
  try {
    const directory = await realpath(path);
    if (!(await stat(directory)).isDirectory()) return { valid: false };
    const existing = projects.find(project => project.directory === directory);
    return { valid: true, directory, name: basename(directory), existingProjectId: existing?.id, existingProjectName: existing?.name };
  } catch { return { valid: false }; }
}
