import { remoteErrorText } from '../shared/localization';
import { useLocalization } from './Localization';
import { useCallback, useEffect, useRef, useState } from 'react';

export type NoticeKind = 'success' | 'error';
export type ReportNotice = (message: string, kind?: NoticeKind) => void;
interface Notice { id: number; revision: number; message: string; kind: NoticeKind }

export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const sequence = useRef(0);
  const report: ReportNotice = useCallback((message, kind = 'error') => {
    const text = remoteErrorText(message);
    if (!text) return;
    const revision = ++sequence.current;
    setNotices(previous => previous.some(notice => notice.message === text)
      ? previous.map(notice => notice.message === text ? { ...notice, kind, revision } : notice)
      : [...previous, { id: revision, revision, message: text, kind }]);
  }, []);
  const dismiss = useCallback((id: number) => setNotices(previous => previous.filter(notice => notice.id !== id)), []);
  return { notices, report, dismiss };
}

function NoticeItem({ notice, dismiss }: { notice: Notice; dismiss(id: number): void }) {
  const { t, text } = useLocalization();
  const hovered = useRef(false);
  const remaining = useRef(0);
  const started = useRef(0);
  const timeout = useRef<number | undefined>(undefined);
  const stopTimer = () => { window.clearTimeout(timeout.current); timeout.current = undefined; };
  const startTimer = () => {
    started.current = performance.now();
    timeout.current = window.setTimeout(() => dismiss(notice.id), remaining.current);
  };
  useEffect(() => {
    remaining.current = notice.kind === 'success' ? 2000 : 5000;
    if (!hovered.current) startTimer();
    return stopTimer;
  }, [notice.id, notice.kind, notice.revision, dismiss]);
  return <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} onMouseEnter={() => {
    hovered.current = true;
    if (timeout.current !== undefined) remaining.current = Math.max(0, remaining.current - (performance.now() - started.current));
    stopTimer();
  }} onMouseLeave={() => { hovered.current = false; startTimer(); }}>
    <span className="notice-icon" aria-hidden="true">{notice.kind === 'success' ? '✓' : '!'}</span>
    <span>{text(notice.message)}</span><button aria-label={t('dismissNotice')} onMouseDown={event => event.preventDefault()} onClick={() => dismiss(notice.id)}>×</button>
  </div>;
}

export function Notices({ notices, dismiss }: Pick<ReturnType<typeof useNotices>, 'notices' | 'dismiss'>) {
  const { t } = useLocalization();
  return <div className="notices" aria-label={t('notices')}>{notices.map(notice => <NoticeItem key={notice.id} notice={notice} dismiss={dismiss} />)}</div>;
}
