import { useState } from 'react';
import type { PlatformFailure } from '../shared/code-hosting';
import type { localize } from '../shared/localization';
import { useLocalization } from './Localization';

type Translate = ReturnType<typeof localize>['t'];

/**
 * Why the platform could not be used, in one sentence. A missing or signed-out CLI reads the same wherever it
 * shows; an unreachable target and any other failure read as the caller words them for what it was reading,
 * `failed` receiving the platform's own output.
 */
export function platformFailureReason(t: Translate, { kind, platform, output }: PlatformFailure,
  { unreachable, failed }: { unreachable?: string; failed(reason: string): string }): string {
  if (kind === 'notInstalled') return t('platformCliMissing', { platform: platform.name });
  if (kind === 'signedOut') return t('platformSignInNeeded', { platform: platform.name });
  return kind === 'unreachable' && unreachable ? unreachable : failed(output || kind);
}

/** What lets the user fix a missing or signed-out CLI: where to install it, or its sign-in command to copy. */
export function PlatformFailureHelp({ failure: { kind, platform } }: { failure: PlatformFailure }) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  if (kind === 'notInstalled') return <span>{t('installFrom')} <a href={platform.installUrl} target="_blank" rel="noreferrer">{platform.installUrl}</a></span>;
  if (kind !== 'signedOut') return null;
  return <button type="button" aria-label={t('copyCommand', { command: platform.signInCommand })}
    onClick={() => { void navigator.clipboard.writeText(platform.signInCommand).then(() => setCopied(true)); }}>
    <code>{platform.signInCommand}</code>{copied ? ` · ${t('copied')}` : ''}</button>;
}
