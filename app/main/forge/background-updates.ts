/** How often the data the sidebar shows in the foreground updates in the background. */
export const updateInterval = 5 * 60_000;

/** When the Forge sidebar's data updates in the background (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md):
 * at once when a project comes to show in the foreground, then every 5 minutes while it shows there. An update asked
 * while one of the project's runs joins it. */
export class BackgroundUpdates {
  /** Each project's running update. */
  private running = new Map<string, Promise<void>>();
  /** Updates the watched project every 5 minutes; none while no project is watched. */
  private schedule: ReturnType<typeof setInterval> | null = null;
  constructor(private updateNow: (projectId: string) => Promise<void>) {}

  /** Watches the project the sidebar now shows in the foreground, or none when null: a project updates at once and
   * every 5 minutes after, until another or none is watched. Resolves once the first update settled. */
  watch(projectId: string | null) {
    if (this.schedule) clearInterval(this.schedule);
    this.schedule = null;
    if (projectId === null) return Promise.resolve();
    this.schedule = setInterval(() => void this.startOrJoin(projectId), updateInterval);
    // The schedule alone keeps no process running.
    this.schedule.unref();
    return this.startOrJoin(projectId);
  }
  /** Starts an update of the project, or joins its update already running. */
  private startOrJoin(projectId: string) {
    const running = this.running.get(projectId);
    if (running) return running;
    const updating = this.updateNow(projectId).finally(() => {
      if (this.running.get(projectId) === updating) this.running.delete(projectId);
    });
    this.running.set(projectId, updating);
    return updating;
  }
  /** Lets the next update of the project ask again, not join the one running: what it read is no longer kept. */
  forget(projectId: string) {
    this.running.delete(projectId);
  }
}
