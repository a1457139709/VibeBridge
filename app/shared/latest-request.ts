export class RequestTicket {
  readonly #issued = true;
}

export class LatestRequest {
  private latest: RequestTicket | null = null;
  start(): RequestTicket {
    this.latest = new RequestTicket();
    return this.latest;
  }
  isLatest(ticket: RequestTicket): boolean {
    return this.latest === ticket;
  }
  finish(ticket: RequestTicket): boolean {
    if (!this.isLatest(ticket)) return false;
    this.latest = null;
    return true;
  }
  get pending(): boolean {
    return this.latest !== null;
  }
}
