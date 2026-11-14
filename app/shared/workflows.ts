import type { MessageId } from './messages';
import type { AgentType } from './model';

/** One dispatch command: which skill to call and its argument template. */
export interface WorkflowCommand { id: string; skill: string; args: string; separatorBefore?: true }
export interface Workflow { id: string; name: MessageId; enabledByDefault: boolean; commands: readonly WorkflowCommand[] }

const issueCommand = (skill: string, args = '{url}') => ({ id: skill, skill, args });

// The built-in workflow catalog (#143). Users switch workflows on and off but never add, edit or reorder commands.
export const workflows = [
  { id: 'matt', name: 'workflowMatt', enabledByDefault: true, commands: [
    issueCommand('grill-with-docs'), issueCommand('to-spec'), issueCommand('to-tickets'), issueCommand('implement'),
    issueCommand('implement-spec'), issueCommand('wayfinder'), issueCommand('triage', 'look at {url}'),
    { ...issueCommand('diagnosing-bugs'), separatorBefore: true }, issueCommand('tdd'), issueCommand('prototype'),
    issueCommand('research'), issueCommand('grill-me'),
  ] },
] as const satisfies readonly Workflow[];

export type WorkflowId = typeof workflows[number]['id'];
export const deliveries = ['submit', 'fill'] as const;
/** Submit sends the command; fill only types it into the input. */
export type Delivery = typeof deliveries[number];
export const defaultDelivery: Delivery = 'submit';
export interface WorkflowSettings { enabled: boolean; commands: Record<string, { delivery: Delivery }> }

export const defaultWorkflowSettings = (): Record<WorkflowId, WorkflowSettings> => Object.fromEntries(workflows.map(workflow => [workflow.id, {
  enabled: workflow.enabledByDefault,
  commands: Object.fromEntries(workflow.commands.map(command => [command.id, { delivery: defaultDelivery }])),
}])) as Record<WorkflowId, WorkflowSettings>;

/** A command of a built-in workflow, or undefined when the catalog has no such workflow or command. */
export const workflowCommand = (workflowId: string, commandId: string) => {
  const workflow = workflows.find(workflow => workflow.id === workflowId);
  const command = workflow?.commands.find(command => command.id === commandId);
  return workflow && command && { workflow, command: command as WorkflowCommand };
};

/** A command's delivery, flipped: an inverted dispatch uses the other one for that dispatch only. */
export const invertedDelivery = (delivery: Delivery): Delivery => delivery === 'submit' ? 'fill' : 'submit';
/** How a command is delivered as set in the settings: submit when the settings do not say. */
export const commandDelivery = (settings: Record<WorkflowId, WorkflowSettings>, workflowId: string, commandId: string): Delivery =>
  settings[workflowId as WorkflowId]?.commands[commandId]?.delivery ?? defaultDelivery;

/** How each Agent type calls a skill from its input; a new Agent type adds its entry here. */
export const skillInvocations: Record<AgentType, (skill: string, args: string) => string> = {
  claude: (skill, args) => `/${skill} ${args}`,
  codex: (skill, args) => `$${skill} ${args}`,
  pi: (skill, args) => `/skill:${skill} ${args}`,
};

/** The values an argument template can name. `url` is the issue's URL in the bound repository. */
export interface CommandValues { url: string; number: number; title: string }

/** The text that calls a command's skill for one issue, written the way the target Agent type expects. */
export function commandText(agent: AgentType, command: WorkflowCommand, values: CommandValues): string {
  const args = command.args.replace(/\{(url|number|title)\}/g, (_, key: keyof CommandValues) => String(values[key]));
  return skillInvocations[agent](command.skill, args);
}
