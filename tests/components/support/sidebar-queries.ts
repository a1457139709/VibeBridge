import { screen, within } from '@testing-library/react';
import { requireValue } from '../../../app/renderer/common/required';
import { githubForge } from './forge';
import { selectElement } from './elements';
import { t } from './localization';

export const queryForgeSidebar = () => screen.queryByRole('complementary', { name: githubForge.name });
export const forgeSidebar = () => screen.getByRole('complementary', { name: githubForge.name });
export const queryIssueDetail = () => screen.queryByRole('region', { name: t('issueDetail') });
export const queryPullRequestDetail = () => screen.queryByRole('region', { name: t('pullRequestDetail') });
export const repositoryTitle = () =>
  requireValue(within(forgeSidebar()).getAllByRole('heading').at(0), 'the sidebar heading').textContent;
export const detailHeading = (root: HTMLElement, title: string, number: number) =>
  within(root).findByRole('heading', {
    name: name => name.startsWith(title) && name.endsWith(String(number)),
  });

const texts = (elements: HTMLElement[]) => elements.map(element => element.textContent);
export const statusMessages = (root: HTMLElement = forgeSidebar()) => texts(within(root).queryAllByRole('status'));
export const alertMessages = (root: HTMLElement = forgeSidebar()) => texts(within(root).queryAllByRole('alert'));
export const staleRetry = (root: HTMLElement = forgeSidebar()) =>
  within(root).getByRole('button', { name: t('retry'), description: t('dataMayBeStale') });

export const repositoryOption = (path: string, root: HTMLElement = forgeSidebar()) =>
  requireValue(
    within(root)
      .queryAllByRole('option')
      .find(option => option.dataset.path === path),
    `the option for ${path}`,
  );
export const currentlyBoundPath = (root: HTMLElement = forgeSidebar()) =>
  selectElement('.binding-now b', root).textContent;
