import type { ProcessingState } from '../../../app/shared/processing-status';
import { t } from './localization';

export const summaryEntry = (count: number, state: ProcessingState, translate = t) =>
  translate('summaryEntry', { count, state: translate(state) });

export const including = (text: string) => (name: string) => name.includes(text);
