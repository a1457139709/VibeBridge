const settledEitherWay = (result: Promise<unknown>): Promise<void> =>
  result.then(
    () => undefined,
    () => undefined,
  );

export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = settledEitherWay(result);
    return result;
  }
  drained(): Promise<void> {
    return this.tail;
  }
}
