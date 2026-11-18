import { useEffect, useRef, useState } from 'react';
import { useLocalization } from '../common/Localization';
import { agentIcons } from '../common/agent-icons';
import { agentNames, agentTypes, type AgentCommand, type CommandCheck, type Settings } from '../../shared/model';

function AgentFields({
  type,
  value,
  change,
  error,
  argsError,
}: {
  error?: string;
  argsError?: string;
  type: (typeof agentTypes)[number];
  value: AgentCommand;
  change(value: AgentCommand): void;
}) {
  const { t, text } = useLocalization();
  const [check, setCheck] = useState<CommandCheck>();
  const [checking, setChecking] = useState(false);
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  async function checkCommand() {
    const request = ++revision.current;
    setChecking(true);
    setCheck(undefined);
    try {
      const result = await window.workbench.checkCommand(value.command);
      if (request === revision.current) setCheck(result);
    } catch (error) {
      if (request === revision.current) setCheck({ available: false, message: (error as Error).message });
    } finally {
      if (request === revision.current) setChecking(false);
    }
  }
  return (
    <section className={`agent-settings ${type}`}>
      <div className="settings-row-heading">
        <h2>
          <span className="agent-mark">{agentIcons[type]}</span>
          {agentNames[type]}
        </h2>
        <button type="button" disabled={checking || !value.command.trim()} onClick={() => void checkCommand()}>
          {checking ? t('checkingCommand') : t('checkCommand')}
        </button>
      </div>
      <label htmlFor={`command-${type}`}>{t('launchCommand')}</label>
      <input
        id={`command-${type}`}
        data-settings-field={`agents.${type}.command`}
        className="command-input"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `command-error-${type}` : undefined}
        value={value.command}
        spellCheck={false}
        onChange={event => {
          revision.current++;
          setCheck(undefined);
          setChecking(false);
          change({ ...value, command: event.target.value });
        }}
      />
      <div id={`command-error-${type}`} className="error-text" role={error ? 'alert' : undefined}>
        {error}
      </div>
      <div className={`command-result ${check && !check.available ? 'error-text' : 'muted'}`} aria-live="polite">
        {check ? (check.available ? t('commandAvailable', { path: check.path }) : text(check.message)) : null}
      </div>
      <label htmlFor={`arguments-${type}`}>
        {t('launchArguments')} <span className="muted">{t('argumentsHelp')}</span>
      </label>
      <textarea
        id={`arguments-${type}`}
        data-settings-field={`agents.${type}.args`}
        aria-invalid={!!argsError || undefined}
        aria-describedby={argsError ? `arguments-error-${type}` : undefined}
        className="command-input"
        rows={2}
        value={value.args.join('\n')}
        spellCheck={false}
        onChange={event => change({ ...value, args: event.target.value ? event.target.value.split('\n') : [] })}
      />
      {argsError && (
        <p id={`arguments-error-${type}`} className="error-text" role="alert">
          {argsError}
        </p>
      )}
    </section>
  );
}

export function AgentSettings({
  agents,
  agentRevision,
  fieldError,
  changeDraft,
  submit,
}: {
  agents: Settings['agents'];
  agentRevision: number;
  fieldError(field: string): string;
  changeDraft(patch: Partial<Settings>): void;
  submit(): void;
}) {
  const { t } = useLocalization();
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="muted">{t('agentSettingsHelp')}</p>
      {agentTypes.map(type => (
        <AgentFields
          key={`${type}-${agentRevision}`}
          type={type}
          value={agents[type]}
          error={fieldError(`agents.${type}.command`)}
          argsError={fieldError(`agents.${type}.args`)}
          change={value => changeDraft({ agents: { ...agents, [type]: value } })}
        />
      ))}
    </form>
  );
}
