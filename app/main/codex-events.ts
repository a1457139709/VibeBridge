type Payload = Record<string, unknown>;

export class CodexEvents {
  private session?: string;
  private retired = new Set<string>();
  private turn?: string;
  private oldTurns = new Set<string>();
  private seen = new Set<string>();

  /** Interpret identity only after the outer run capability was authenticated.
   * No receipt-time sequence is invented: only identifiable retired sessions,
   * turns and repeated source boundaries can be excluded.
   */
  accept(event: Payload): Payload | undefined {
    if (event.observation) return event;
    if (event.agent_id || event.hook_event_name === 'SubagentStart' || event.hook_event_name === 'SubagentStop') return;
    const session = event.session_id;
    if (typeof session !== 'string' || !session) return { observation: 'lost' };
    const name = event.hook_event_name;
    if (name === 'SessionStart') {
      if (this.session !== session) {
        if (this.session) this.retired.add(this.session);
        this.session = session;
        this.retired.delete(session);
        this.turn = undefined;
        this.oldTurns.clear();
        this.seen.clear();
      }
      return event;
    }
    if (this.retired.has(session) || (this.session && this.session !== session)) return;
    // A user may trust hooks after startup. A fresh main event can establish the
    // association; directory, session ID and parent ID never authorize a run.
    this.session ??= session;
    if (name === 'SessionEnd') {
      this.retired.add(session);
      this.session = undefined;
      this.turn = undefined;
      return event;
    }
    const turn = typeof event.turn_id === 'string' ? event.turn_id : undefined;
    if (turn) {
      if (this.oldTurns.has(turn)) return;
      if (this.turn !== turn) {
        if (this.turn) this.oldTurns.add(this.turn);
        this.turn = turn;
      }
      const tool = typeof event.tool_use_id === 'string' ? event.tool_use_id : undefined;
      // Stop hooks can request continuation and submit again within a turn.
      // A turn ID alone is not a unique event ID.
      if (tool) {
        const key = JSON.stringify([session, turn, name, tool]);
        if (this.seen.has(key)) return;
        this.seen.add(key);
      }
    }
    // Native Interrupt is root-only and dispatched after detaching the active
    // turn. Generic reports still require explicit confirmation annotations.
    if (name === 'Interrupt' && turn) return { ...event, confirmed: true, can_accept_input: true };
    return event;
  }
}
