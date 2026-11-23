import { screen, within } from '@testing-library/react';
import { githubForge } from './forge';

export const queryForgeSidebar = () => screen.queryByRole('complementary', { name: githubForge.name });
export const forgeSidebar = () => screen.getByRole('complementary', { name: githubForge.name });
export const detailHeading = (root: HTMLElement, title: string, number: number) =>
  within(root).findByRole('heading', {
    name: name => name.startsWith(title) && name.endsWith(String(number)),
  });
