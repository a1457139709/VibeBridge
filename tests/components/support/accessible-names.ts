import type { ProcessingState } from '../../../app/shared/processing-status';
import { t } from './localization';

export const summaryEntryName = (count: number, state: ProcessingState, translate = t) =>
  translate('summaryEntry', { count, state: translate(state) });

export const nameIncluding = (text: string) => (name: string) => name.includes(text);
