import { useRef, useState, type ReactNode } from 'react';
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

/** Why a read from the platform failed: the platform's failure, or an error before it was reached. */
export type ReadFailure = { ok: false; failure: PlatformFailure } | { ok: false; error: string };

/**
 * Starts reads whose answers may arrive out of order: only the latest read's answer reaches its `settle`, and a read
 * that throws answers with the error's message.
 */
export function useLatestRead() {
  const latest = useRef(0);
  return <Result,>(read: Promise<Result>, settle: (result: Result | { ok: false; error: string }) => void) => {
    const current = ++latest.current;
    read.then(result => result, (error: Error) => ({ ok: false, error: error.message }) as const)
      .then(result => { if (current === latest.current) settle(result); });
  };
}

/** Why a read failed, filling the area it was for, with a retry and, for a platform failure, `actions` after it. */
export function ReadFailureState({ failure, unreachable, retry, actions }: { failure: ReadFailure; unreachable: string; retry(): void; actions?: ReactNode }) {
  const { t, text } = useLocalization();
  if ('error' in failure) return <div className="issue-sidebar-state" role="alert"><p>{text(failure.error)}</p><button onClick={retry}>{t('retry')}</button></div>;
  const { platform } = failure.failure;
  return <div className="issue-sidebar-state" role="alert">
    <p>{platformFailureReason(t, failure.failure, { unreachable, failed: reason => t('platformReadFailed', { platform: platform.name, reason }) })}</p>
    <div className="issue-state-actions"><PlatformFailureHelp failure={failure.failure} /><button onClick={retry}>{t('retry')}</button>{actions}</div>
  </div>;
}
