import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { DirectoryResult, Project } from '../shared/model';

/** Whether the path is a directory that can be a Project Directory, by its real path, and which project already has it. */
export async function inspectDirectory(path: string, projects: Project[]): Promise<DirectoryResult> {
  try {
    const directory = await realpath(path);
    if (!(await stat(directory)).isDirectory()) return { valid: false };
    const existing = projects.find(project => project.directory === directory);
    return { valid: true, directory, name: basename(directory), existingProjectId: existing?.id, existingProjectName: existing?.name };
  } catch { return { valid: false }; }
}
