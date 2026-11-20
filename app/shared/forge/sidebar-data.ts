import { z } from 'zod';
import {
  listQuerySchema,
  type ListFilter,
  type ListPage,
  type ListedIssue,
  type Page,
  type PullRequestSummary,
  type RepositoryChoices,
} from './forge';

/** The Forge sidebar's lists, each a tab, with the item each one lists. */
export interface ForgeListItems {
  issues: ListedIssue;
  pullRequests: PullRequestSummary;
}
export const forgeListTabs = ['issues', 'pullRequests'] as const;
export type ForgeListTab = (typeof forgeListTabs)[number];

/** What the sidebar shows of a project's lists: the tab, and the filter its rows are asked for. */
export const forgeListViewSchema = z.object({
  tab: z.enum(forgeListTabs),
  filter: listQuerySchema.shape.filter,
});
export type ForgeListView = z.infer<typeof forgeListViewSchema>;

export type FailedPage = Extract<Page<unknown>, { ok: false }>;
/** A tab's rows, with the filter that produced them: Load more continues that filter. */
export type LoadedList<Item> = ListPage<Item> & { filter: ListFilter };
/** What a tab last loaded, and its failure since then. */
export interface TabList<Item> {
  loaded: LoadedList<Item> | null;
  failed: FailedPage | null;
}
/** A project's lists as the main process holds them (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md):
 * each tab's rows and failure, and whether a request is running. */
export type ForgeLists = { [T in ForgeListTab]: TabList<ForgeListItems[T]> } & { loading: boolean };

/** The repositories a project can bind as the sidebar's binding pages show them: the forge's answer, or the reason the
 * read itself failed; null while it is being read. */
export type ShownRepositoryChoices = RepositoryChoices | { ok: false; error: string } | null;

/** What the main process pushes about the Forge sidebar's data of a project. */
export type ForgeSidebarEvent =
  | { kind: 'forgeLists'; projectId: string; lists: ForgeLists }
  | { kind: 'repositoryChoices'; projectId: string; choices: ShownRepositoryChoices };
