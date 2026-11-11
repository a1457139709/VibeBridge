import { z } from 'zod';
import { agentTypeSchema, type AgentType } from './model';
import type { ProcessingState } from './processing-status';
import type { RepositoryReference } from './code-hosting';
import type { Delivery } from './workflows';

/** A Dispatch Record as stored, append-only: which issue was handed to which session, when and with what text. */
export interface DispatchRecord {
  repository: RepositoryReference;
  issue: number;
  /** ISO 8601. */
  time: string;
  agent: AgentType;
  /** The full text sent to the terminal. */
  text: string;
  session: string;
}

/** The panel currently on a record's session, with what it displays. */
export interface DispatchLocation { projectId: string; panelId: string; runId: string; ephemeral: boolean; status?: ProcessingState; title?: string }

/** A Dispatch Record as the snapshot shows it: located by its session, or null when no panel is on that session now. */
export interface DispatchRecordView { issue: number; time: string; agent: AgentType; text: string; location: DispatchLocation | null }

/** A dispatch to a panel of the project, or to a new panel of an Agent type: an instruction of a built-in workflow for
 * one issue of the bound repository. `invert` flips the instruction's delivery for this dispatch only. */
export interface DispatchRequest {
  issue: { number: number; title: string };
  workflow: string;
  instruction: string;
  target: { panelId: string } | { agent: AgentType };
  invert: boolean;
}
export const dispatchRequestSchema = z.strictObject({
  issue: z.strictObject({ number: z.number().int().positive(), title: z.string() }),
  workflow: z.string(), instruction: z.string(),
  target: z.union([z.strictObject({ panelId: z.string() }), z.strictObject({ agent: agentTypeSchema })]),
  invert: z.boolean(),
});

// Control characters other than the line feed, and invisible format characters, which CLIs either act on or strip on submit.
const unsafe = /[\x00-\x09\x0b-\x1f\x7f-\x9f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** The bytes that deliver text to a running Agent's input box: one bracketed paste, then a return to submit.
 * The text cannot end the paste early, and a trailing backslash cannot turn the return into a new line. */
export function bracketedPaste(text: string, delivery: Delivery): string {
  let clean = text.replace(/\r\n?/g, '\n').replace(unsafe, '');
  if (clean.endsWith('\\')) clean += ' ';
  return `\x1b[200~${clean}\x1b[201~${delivery === 'submit' ? '\r' : ''}`;
}
