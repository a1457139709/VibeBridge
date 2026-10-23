import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Language } from '../shared/model';
import { localize } from '../shared/localization';

const LocalizationContext = createContext(localize('en'));
export function Localization({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo(() => localize(language), [language]);
  return <LocalizationContext value={value}>{children}</LocalizationContext>;
}
export const useLocalization = () => useContext(LocalizationContext);
