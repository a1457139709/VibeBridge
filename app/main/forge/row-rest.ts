/** How long the pointer or keyboard focus rests on a list row before the row is acted on. */
const restBeforeActing = 150;

/** The list row the pointer or keyboard focus rests on: a row is acted on once it rested 150ms, and resting on another
 * row or on none before then cancels it. */
export class RowRest {
  private resting: { cancel(): void } | null = null;

  /** Rests on a row, `act` running once it rested long enough, or on none when null. Resolves once `act` settled, or
   * the rest ended without it. */
  restOn(act: (() => Promise<void>) | null) {
    this.resting?.cancel();
    this.resting = null;
    if (!act) return Promise.resolve();
    return new Promise<void>(settled => {
      const timer = setTimeout(() => {
        this.resting = null;
        void act().then(settled);
      }, restBeforeActing);
      this.resting = {
        cancel() {
          clearTimeout(timer);
          settled();
        },
      };
    });
  }
}
