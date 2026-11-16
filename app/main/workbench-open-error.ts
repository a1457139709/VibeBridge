import type { Language } from '../shared/model';

export class WorkbenchOpenError extends Error {
  constructor(error: unknown, readonly language: Language) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
  }
}
