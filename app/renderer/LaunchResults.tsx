import { useLocalization } from './Localization';
import { agentNames, type LaunchResult } from '../shared/model';

/** One line per launch, numbered in launch order. */
export function LaunchResults({ launches }: { launches: LaunchResult[] }) {
  const { t, text } = useLocalization();
  return <ul className="project-launch-results">{launches.map((launch, index) => <li key={launch.run.panelId} className={launch.outcome === 'started' ? '' : 'error-text'}>{t('panelLaunchResult', {
    number: index + 1, agent: agentNames[launch.agent],
    result: launch.outcome === 'started' ? t('launchSuccess') : launch.outcome === 'failed' ? t('launchFailed') : text(launch.reason),
  })}</li>)}</ul>;
}
