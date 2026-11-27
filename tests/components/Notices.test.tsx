import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Localization } from '../../app/renderer/common/Localization';
import { Notices, useNotices, type ReportNotice } from '../../app/renderer/common/Notices';
import { t } from './support/localization';

afterEach(cleanup);

function renderNotices(context: TestContext) {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let report: ReportNotice = () => {};
  function Harness() {
    const shown = useNotices();
    report = shown.report;
    return (
      <Localization language="en">
        <Notices notices={shown.notices} dismiss={shown.dismiss} />
      </Localization>
    );
  }
  render(<Harness />);
  return {
    report: (message: string) => act(() => report(message)),
    tick: (milliseconds: number) => act(() => context.mock.timers.tick(milliseconds)),
    alert: () => within(screen.getByRole('region', { name: t('notices') })).getByRole('alert'),
    shown: () => within(screen.getByRole('region', { name: t('notices') })).queryByRole('alert') !== null,
  };
}

test('hovering a notice pauses its expiry, and leaving it resumes with the time that was left', context => {
  const notices = renderNotices(context);
  notices.report('Disk full');
  notices.tick(3000);
  const notice = notices.alert();
  fireEvent.mouseEnter(notice);
  notices.tick(10000);
  assert.equal(notices.shown(), true);
  fireEvent.mouseLeave(notice);
  notices.tick(1999);
  assert.equal(notices.shown(), true);
  notices.tick(1);
  assert.equal(notices.shown(), false);
});

test('reporting a shown message again restarts its expiry', context => {
  const notices = renderNotices(context);
  notices.report('Disk full');
  notices.tick(4000);
  notices.report('Disk full');
  notices.tick(4999);
  assert.equal(notices.shown(), true);
  notices.tick(1);
  assert.equal(notices.shown(), false);
});
