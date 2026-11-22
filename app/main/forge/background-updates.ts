export const updateInterval = 5 * 60_000;

export class BackgroundUpdates {
  private running = new Map<string, Promise<void>>();
  private schedule: ReturnType<typeof setInterval> | null = null;
  constructor(private updateNow: (projectId: string) => Promise<void>) {}

  watch(projectId: string | null) {
    if (this.schedule) clearInterval(this.schedule);
    this.schedule = null;
    if (projectId === null) return Promise.resolve();
    this.schedule = setInterval(() => void this.startOrJoin(projectId), updateInterval);
    this.schedule.unref();
    return this.startOrJoin(projectId);
  }
  private startOrJoin(projectId: string) {
    const running = this.running.get(projectId);
    if (running) return running;
    const updating = this.updateNow(projectId).finally(() => {
      if (this.running.get(projectId) === updating) this.running.delete(projectId);
    });
    this.running.set(projectId, updating);
    return updating;
  }
  forget(projectId: string) {
    this.running.delete(projectId);
  }
}
