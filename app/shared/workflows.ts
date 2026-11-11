import type { AgentType } from './model';

/** One dispatchable step: which skill to call and its argument template. No CLI spelling lives here. */
export interface WorkflowInstruction { id: string; skill: string; template: string; separatorBefore: boolean }
export interface Workflow { id: string; name: string; instructions: readonly WorkflowInstruction[] }
export type Delivery = 'submit' | 'fill';
export const deliveries = ['submit', 'fill'] as const satisfies readonly Delivery[];
/** How an instruction is delivered until the user chooses otherwise. */
export const defaultDelivery: Delivery = 'submit';

/** The `workflows` entry of settings.json, keyed by workflow ID and then instruction ID. */
export interface WorkflowSetting { enabled: boolean; instructions: Record<string, { delivery: Delivery }> }
export type WorkflowSettings = Record<string, WorkflowSetting>;

/** How the instruction is delivered under these settings; `invert` swaps submit and fill for one dispatch. */
export function instructionDelivery(settings: WorkflowSettings, workflow: string, instruction: string, invert = false): Delivery {
  const configured = settings[workflow]?.instructions[instruction]?.delivery ?? defaultDelivery;
  return invert ? (configured === 'submit' ? 'fill' : 'submit') : configured;
}

/** The values a template may use; `url` is the issue's HTML URL in the bound repository. */
export interface InstructionValues { url: string; number: number; title: string }

const instruction = (skill: string, template = '{url}', separatorBefore = false): WorkflowInstruction =>
  ({ id: skill, skill, template, separatorBefore });

/** Built-in workflows. Users switch them on and choose each instruction's delivery; they cannot add, edit or reorder instructions. */
export const workflowCatalog: readonly Workflow[] = [
  { id: 'matt', name: 'mattpocock/skills', instructions: [
    instruction('grill-with-docs'), instruction('to-spec'), instruction('to-tickets'), instruction('implement'),
    instruction('implement-spec'), instruction('wayfinder'), instruction('triage', 'look at {url}'),
    instruction('diagnosing-bugs', '{url}', true), instruction('tdd'), instruction('prototype'), instruction('research'), instruction('grill-me'),
  ] },
];

/** Every built-in workflow starts switched on, with each instruction submitted. */
export const defaultWorkflowSettings = (): WorkflowSettings => Object.fromEntries(workflowCatalog.map(workflow => [workflow.id, {
  enabled: true, instructions: Object.fromEntries(workflow.instructions.map(instruction => [instruction.id, { delivery: defaultDelivery }])),
}]));

/** How each Agent type invokes a skill. Skill names are written as built in. */
const skillInvocations: Record<AgentType, (skill: string, args: string) => string> = {
  claude: (skill, args) => `/${skill} ${args}`,
  codex: (skill, args) => `$${skill} ${args}`,
  pi: (skill, args) => `/skill:${skill} ${args}`,
};

export function instructionText(agent: AgentType, instruction: WorkflowInstruction, values: InstructionValues): string {
  const args = instruction.template.replace(/\{(url|number|title)\}/g, (_, key: keyof InstructionValues) => String(values[key]));
  return skillInvocations[agent](instruction.skill, args);
}
