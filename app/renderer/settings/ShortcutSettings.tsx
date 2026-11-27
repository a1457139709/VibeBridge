import { useLocalization } from '../common/Localization';
import {
  defaultShortcuts,
  displayShortcut,
  shortcutActions,
  shortcutFromEvent,
  shortcutConflicts,
  shortcutNames,
  withoutShortcutModifier,
  type ShortcutAction,
} from '../../shared/settings/shortcuts';
import type { Settings } from '../../shared/model';

export function ShortcutSettings({
  shortcuts,
  search,
  setSearch,
  recording,
  setRecording,
  fieldError,
  changeDraft,
}: {
  shortcuts: Settings['shortcuts'];
  search: string;
  setSearch(search: string): void;
  recording: ShortcutAction | undefined;
  setRecording(action?: ShortcutAction): void;
  fieldError(field: string): string;
  changeDraft(patch: Partial<Settings>): void;
}) {
  const { t, text } = useLocalization();
  const defaults = defaultShortcuts();
  const conflicts = shortcutConflicts(shortcuts);
  const conflictColors = ['#bb493b', '#8960b4', '#33778f', '#927127', '#b14178', '#467944', '#5559b4', '#b56722'];
  const query = search.trim().toLowerCase();
  const actions = shortcutActions.filter(action =>
    `${text(shortcutNames[action])} ${shortcuts[action]} ${displayShortcut(shortcuts[action])}`
      .toLowerCase()
      .includes(query),
  );
  return (
    <>
      <p className="muted">{t('shortcutHelp')}</p>
      <div className="shortcut-search">
        <input
          aria-label={t('shortcutSearch')}
          placeholder={t('shortcutSearch')}
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>
      <p className="muted">{t('shortcutCount', { count: actions.length })}</p>
      {actions.map(action => {
        const groupIndex = conflicts.findIndex(group => group.actions.includes(action));
        const conflict = conflicts[groupIndex];
        const issue = fieldError(`shortcuts.${action}`);
        return (
          <div
            className={`shortcut-row ${conflict ? 'shortcut-conflict' : ''}`}
            key={action}
            style={conflict ? { '--conflict-color': conflictColors[groupIndex] } : undefined}
          >
            <div>
              <label htmlFor={`shortcut-${action}`}>{text(shortcutNames[action])}</label>
              <small>{t('shortcutDefault', { binding: displayShortcut(defaults[action]) })}</small>
              {issue && (
                <p id={`conflict-${action}`} className="shortcut-conflict-message error-text">
                  {issue}
                </p>
              )}
            </div>
            <input
              id={`shortcut-${action}`}
              data-settings-field={`shortcuts.${action}`}
              data-shortcut-recorder
              aria-invalid={!!issue || undefined}
              aria-describedby={issue ? `conflict-${action}` : undefined}
              data-hint={shortcuts[action]}
              readOnly
              value={recording === action ? t('shortcutRecording') : displayShortcut(shortcuts[action])}
              onFocus={() => setRecording(action)}
              onBlur={() => setRecording(undefined)}
              onKeyDown={event => {
                if (event.key === 'Tab' && withoutShortcutModifier(event)) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') {
                  setRecording(undefined);
                  event.currentTarget.blur();
                  return;
                }
                if (event.repeat) return;
                const binding = shortcutFromEvent(event.nativeEvent);
                if (!binding) return;
                changeDraft({ shortcuts: { ...shortcuts, [action]: binding } });
                setRecording(undefined);
                event.currentTarget.blur();
              }}
            />
          </div>
        );
      })}
      <p className="muted shortcut-help">{t('shortcutScope')}</p>
    </>
  );
}
