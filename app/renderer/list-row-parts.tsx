import type { CSSProperties } from 'react';
import type { IssueLabel } from '../shared/code-hosting';
import type { Language } from '../shared/model';
import { useLocalization } from './Localization';

// Pieces every list row shows the same way, whatever it lists.

/** Which item's detail is open, and how a row opens one. */
export interface DetailOpening { opened?: number; open(number: number): void }

/** Each label as a button that adds it to the list filter. */
export function LabelButtons({ labels, addLabel }: { labels: IssueLabel[]; addLabel(name: string): void }) {
  const { t } = useLocalization();
  return labels.map(label => <button key={label.name} className="issue-label" style={{ '--label-color': `#${label.color}` } as CSSProperties}
    aria-label={t('filterByLabel', { label: label.name })} onClick={() => addLabel(label.name)}>{label.name}</button>);
}

export function relativeTime(date: Date, language: Language) {
  const seconds = (date.getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, 'minute');
}
