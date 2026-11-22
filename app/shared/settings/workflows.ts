import type { MessageId } from '../messages';
import type { AgentType } from '../model';

export interface WorkflowCommand {
  id: string;
  skill: string;
  args: string;
  separatorBefore?: true;
}
export interface Workflow {
  id: string;
  name: MessageId;
  enabledByDefault: boolean;
  commands: readonly WorkflowCommand[];
}

const issueCommand = (skill: string, args = '{url}') => ({ id: skill, skill, args });

const matt = {
  id: 'matt',
  name: 'workflowMatt',
  enabledByDefault: true,
  commands: [
    issueCommand('grill-with-docs'),
    issueCommand('to-spec'),
    issueCommand('to-tickets'),
    issueCommand('implement'),
    issueCommand('implement-spec'),
    issueCommand('wayfinder'),
    issueCommand('triage', 'look at {url}'),
    { ...issueCommand('diagnosing-bugs'), separatorBefore: true },
    issueCommand('tdd'),
    issueCommand('prototype'),
    issueCommand('research'),
    issueCommand('grill-me'),
  ],
} as const satisfies Workflow;

export const workflows = [matt] as const satisfies readonly Workflow[];
export type WorkflowId = (typeof workflows)[number]['id'];
export const workflowsById = { matt } satisfies { [W in (typeof workflows)[number] as W['id']]: W };
export const deliveries = ['submit', 'fill'] as const;
export type Delivery = (typeof deliveries)[number];
export const defaultDelivery: Delivery = 'submit';
export type WorkflowSettings = {
  enabled: boolean;
  commands: Record<string, { delivery: Delivery }>;
};

const workflowDefaults = (workflow: Workflow): WorkflowSettings => ({
  enabled: workflow.enabledByDefault,
  commands: Object.fromEntries(workflow.commands.map(command => [command.id, { delivery: defaultDelivery }])),
});
export const defaultWorkflowSettings = (): Record<WorkflowId, WorkflowSettings> => ({
  matt: workflowDefaults(workflowsById.matt),
});
const isWorkflowId = (id: string): id is WorkflowId => workflows.some(workflow => workflow.id === id);

export const workflowCommand = (workflowId: string, commandId: string) => {
  const workflow = workflows.find(workflow => workflow.id === workflowId);
  const command: WorkflowCommand | undefined = workflow?.commands.find(command => command.id === commandId);
  return workflow && command && { workflow, command };
};

export const invertedDelivery = (delivery: Delivery): Delivery => (delivery === 'submit' ? 'fill' : 'submit');
export const commandDelivery = (
  settings: Record<WorkflowId, WorkflowSettings>,
  workflowId: string,
  commandId: string,
): Delivery =>
  (isWorkflowId(workflowId) ? settings[workflowId]?.commands[commandId]?.delivery : undefined) ?? defaultDelivery;

export const skillInvocations: Record<AgentType, (skill: string, args: string) => string> = {
  claude: (skill, args) => `/${skill} ${args}`,
  codex: (skill, args) => `$${skill} ${args}`,
  pi: (skill, args) => `/skill:${skill} ${args}`,
};

export interface CommandValues {
  url: string;
  number: number;
  title: string;
}

export function commandText(agent: AgentType, command: WorkflowCommand, values: CommandValues): string {
  const args = command.args.replace(/\{(url|number|title)\}/g, (_, key: keyof CommandValues) => String(values[key]));
  return skillInvocations[agent](command.skill, args);
}
