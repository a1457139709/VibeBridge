import { useLocalization } from './Localization';
import type { ForgeLabel, ListCounts, ListFilter } from '../shared/forge';
import { Label } from './ForgeDisplay';
import { usePopover } from './popover';

/** A list's search, its open and closed switch with their counts, and the label filter: every chosen label must be present. */
export function FilterBar({ searchLabel, filter, setFilter, labels, counts }: {
  /** The search field's name, after the list it searches. */
  searchLabel: string; filter: ListFilter; setFilter(update: (filter: ListFilter) => ListFilter): void;
  labels: ForgeLabel[]; counts: ListCounts | null;
}) {
  const { t } = useLocalization();
  const { open: choosing, setOpen: setChoosing, root } = usePopover<HTMLDivElement>();
  const toggle = (name: string) => setFilter(f => ({ ...f, labels: f.labels.includes(name) ? f.labels.filter(label => label !== name) : [...f.labels, name] }));
  const colors = new Map(labels.map(label => [label.name, label.color]));
  return <div className="forge-filters">
    <input type="search" className="forge-search" aria-label={searchLabel} placeholder={t('searchListPlaceholder')}
      autoComplete="off" value={filter.search} onChange={event => { const search = event.target.value; setFilter(f => ({ ...f, search })); }} />
    <div className="forge-filter-row">
      {(['open', 'closed'] as const).map(state => <button key={state} className={`forge-state ${filter.state === state ? 'on' : ''}`} aria-pressed={filter.state === state}
        onClick={() => setFilter(f => ({ ...f, state }))}>{t(state === 'open' ? 'filterOpen' : 'filterClosed')}{counts && <> <span>{counts[state]}</span></>}</button>)}
      <span className="forge-spacer" />
      <div className="forge-popover-root" ref={root}>
        <button className={`forge-text-button ${filter.labels.length ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={choosing} onClick={() => setChoosing(open => !open)}>
          {t('labelsFilter')}{filter.labels.length ? ` ${filter.labels.length}` : ''} ▾</button>
        {choosing && <div className="forge-popover" role="menu" aria-label={t('labelsFilter')}>
          {labels.map(label => <button key={label.name} role="menuitemcheckbox" aria-checked={filter.labels.includes(label.name)} onClick={() => toggle(label.name)}>
            <span className="forge-swatch" style={{ background: `#${label.color}` }} /><span className="forge-ellipsis">{label.name}</span><b>{filter.labels.includes(label.name) ? '✓' : ''}</b></button>)}
          {!!filter.labels.length && <button className="forge-popover-clear" role="menuitem" onClick={() => setFilter(f => ({ ...f, labels: [] }))}>{t('clearLabels')}</button>}
        </div>}
      </div>
    </div>
    {!!filter.labels.length && <div className="forge-active-labels">
      {filter.labels.map(name => <Label key={name} label={{ name, color: colors.get(name) ?? '888888' }} onClick={() => toggle(name)} />)}<span>{t('removeLabelHint')}</span></div>}
  </div>;
}
