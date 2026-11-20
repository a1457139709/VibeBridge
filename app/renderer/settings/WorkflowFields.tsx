import { useState } from 'react';
import { useLocalization } from '../common/Localization';
import { deliveries, type workflows, type WorkflowSettings } from '../../shared/settings/workflows';
import './workflow-settings.css';

/** One built-in workflow in the Workflows settings: its switch, and a delivery toggle per command. */
export function WorkflowFields({
  workflow,
  value,
  change,
}: {
  workflow: (typeof workflows)[number];
  value: WorkflowSettings;
  change(value: WorkflowSettings): void;
}) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState(true);
  const name = t(workflow.name);
  return (
    <section className="workflow-settings">
      <div className="workflow-heading">
        <button
          type="button"
          className="text-button workflow-expand"
          aria-expanded={expanded}
          aria-label={t('showWorkflowCommands', { workflow: name })}
          onClick={() => setExpanded(open => !open)}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="workflow-text">
          <b id={`workflow-${workflow.id}`}>{name}</b>
          <span className="muted">
            {t('workflowSummary', { count: workflow.commands.length, placeholder: '{url}' })}
          </span>
        </div>
        <span className="workflow-switch">
          <span className={value.enabled ? '' : 'muted'}>
            {t(value.enabled ? 'workflowEnabled' : 'workflowDisabled')}
          </span>
          <button
            type="button"
            role="switch"
            className="switch"
            data-settings-field={`workflows.${workflow.id}.enabled`}
            aria-labelledby={`workflow-${workflow.id}`}
            aria-checked={value.enabled}
            onClick={() => change({ ...value, enabled: !value.enabled })}
          >
            <span className="switch-knob" />
          </button>
        </span>
      </div>
      {expanded && (
        <div className={`workflow-commands ${value.enabled ? '' : 'off'}`}>
          {workflow.commands.map(command => {
            const label = `${command.skill} ${command.args}`;
            return (
              <div key={command.id}>
                {'separatorBefore' in command && <hr />}
                <div className="workflow-command">
                  <code>{label}</code>
                  <span
                    className="delivery-toggle"
                    role="radiogroup"
                    aria-label={label}
                    data-settings-field={`workflows.${workflow.id}.commands.${command.id}.delivery`}
                  >
                    {deliveries.map(delivery => (
                      <label key={delivery}>
                        <input
                          type="radio"
                          name={`delivery-${workflow.id}-${command.id}`}
                          value={delivery}
                          checked={value.commands[command.id]?.delivery === delivery}
                          onChange={() =>
                            change({
                              ...value,
                              commands: {
                                ...value.commands,
                                [command.id]: { ...value.commands[command.id], delivery },
                              },
                            })
                          }
                        />
                        <span>{t(({ submit: 'deliverySubmit', fill: 'deliveryFill' } as const)[delivery])}</span>
                      </label>
                    ))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
