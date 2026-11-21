import { useLocalization } from '../common/Localization';
import type { Settings } from '../../shared/model';
import { workflows } from '../../shared/settings/workflows';
import { WorkflowFields } from './WorkflowFields';

export function WorkflowSettings({
  workflowValues,
  changeDraft,
}: {
  workflowValues: Settings['workflows'];
  changeDraft(patch: Partial<Settings>): void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <p className="muted">{t('workflowsHelp')}</p>
      {workflows.map(workflow => (
        <WorkflowFields
          key={workflow.id}
          workflow={workflow}
          value={workflowValues[workflow.id]}
          change={value => changeDraft({ workflows: { ...workflowValues, [workflow.id]: value } })}
        />
      ))}
    </>
  );
}
