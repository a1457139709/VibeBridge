type Payload = Record<string, unknown>;

/** Native identity checks run after capability authentication. Independent hook
 * processes cannot invent a shared sequence; only recognizable stale facts drop.
 */
export class ClaudeEvents {
  private session?: string;
  private retired = new Set<string>();
  private prompt?: string;
  private oldPrompts = new Set<string>();
  private seen = new Set<string>();
  private completedTools = new Set<string>();
  private activeTools = new Map<string, unknown>();

  accept(event: Payload): Payload | undefined {
    if (event.observation) {
      if (event.observation === 'lost' || event.observation === 'unavailable') this.activeTools.clear();
      return event;
    }
    const name = event.hook_event_name;
    if (event.agent_id || name === 'SubagentStart' || name === 'SubagentStop') return;
    const session = event.session_id;
    if (typeof session !== 'string' || !session) return { observation: 'lost' };
    if (name === 'SessionStart') {
      if (this.retired.has(session) && event.source !== 'resume') return;
      if (this.session !== session) {
        if (this.session) this.retired.add(this.session);
        this.session = session;
        this.retired.delete(session);
        this.prompt = undefined;
        this.oldPrompts.clear();
        this.seen.clear();
        this.completedTools.clear();
        this.activeTools.clear();
      }
      return event;
    }
    if (this.retired.has(session) || (this.session && this.session !== session)) return;
    this.session ??= session;
    if (name === 'SessionEnd') {
      this.retired.add(session);
      this.session = undefined;
      return event;
    }
    const prompt = typeof event.prompt_id === 'string' ? event.prompt_id : undefined;
    if (prompt) {
      if (this.oldPrompts.has(prompt)) return;
      if (this.prompt && this.prompt !== prompt) {
        if (name !== 'UserPromptSubmit') return;
        this.oldPrompts.add(this.prompt);
      }
      this.prompt = prompt;
    }
    if (name === 'UserPromptSubmit' && prompt) {
      const key = JSON.stringify([session, name, prompt]);
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    if ((name === 'Elicitation' || name === 'ElicitationResult') && typeof event.elicitation_id === 'string' && event.elicitation_id) {
      const identity = [session, event.mcp_server_name, event.elicitation_id];
      const key = JSON.stringify([name, ...identity]);
      if (this.seen.has(key) || (name === 'Elicitation' && this.seen.has(JSON.stringify(['ElicitationResult', ...identity])))) return;
      this.seen.add(key);
    }
    if (typeof event.tool_use_id === 'string' && event.tool_use_id) {
      const tool = JSON.stringify([session, event.tool_use_id]);
      const key = JSON.stringify([session, name, event.tool_use_id]);
      if (this.seen.has(key) || (name === 'PreToolUse' && this.completedTools.has(tool))) return;
      this.seen.add(key);
      if (name === 'PreToolUse') this.activeTools.set(event.tool_use_id, event.tool_input_hash);
      if (name === 'PostToolUse' || name === 'PostToolUseFailure') {
        this.completedTools.add(tool);
        this.activeTools.delete(event.tool_use_id);
      }
    }
    if (name === 'UserPromptSubmit' || name === 'Stop' || name === 'StopFailure') this.activeTools.clear();
    if (name === 'PermissionRequest' && !event.tool_use_id) {
      const candidates = typeof event.tool_input_hash === 'string'
        ? [...this.activeTools].filter(([, hash]) => hash === event.tool_input_hash) : [];
      // Never resolve an unidentified wait by tool name or by an ambiguous
      // input match. A later main-turn fact can still establish a fresh state.
      const { tool_input_hash: _hash, ...unidentified } = event;
      return candidates.length === 1 ? { ...unidentified, tool_use_id: candidates[0][0] } : unidentified;
    }
    return event;
  }
}
