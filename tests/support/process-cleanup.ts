import { errorCode } from '../../app/shared/caught-error';

export function killUnlessExited(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error;
  }
}
