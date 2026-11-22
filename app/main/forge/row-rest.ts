const restBeforeActing = 150;

export class RowRest {
  private resting: { cancel(): void } | null = null;

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
