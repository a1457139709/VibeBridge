import { z } from 'zod';
import {
  itemNumberSchema,
  listQuerySchema,
  type ForgeFailure,
  type IssueDetailResult,
  type ListFilter,
  type ListPage,
  type ListedIssue,
  type Page,
  type PullRequestDetailResult,
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

/** The repositories a project can bind as the sidebar's binding pages show them: the forge's answer, a failure of the
 * read itself standing as a transient one; null while it is being read. */
export type ShownRepositoryChoices = RepositoryChoices | null;

/** An issue or pull request of the bound repository, as the detail opens it. */
export const detailItemSchema = z.object({ kind: z.enum(['issue', 'pullRequest']), number: itemNumberSchema });
export type DetailItem = z.infer<typeof detailItemSchema>;
/** Whether two items are the same issue or pull request; no item is the same as no item. */
export const sameItem = (a: DetailItem | null, b: DetailItem | null) => a?.kind === b?.kind && a?.number === b?.number;
/** What the forge answered for the detail's item: the issue or pull request, or the forge failure. */
export type DetailResult = IssueDetailResult | PullRequestDetailResult;
/** An item the sidebar's detail shows, the forge's answer for it, and the failure of a later read, which leaves that
 * answer showing: the data may be stale. */
export interface ShownDetail {
  item: DetailItem;
  result: DetailResult;
  failed: ForgeFailure | null;
}

/** What the main process pushes about the Forge sidebar's data of a project. */
export type ForgeSidebarEvent =
  | { kind: 'forgeLists'; projectId: string; lists: ForgeLists }
  | { kind: 'repositoryChoices'; projectId: string; choices: ShownRepositoryChoices }
  | { kind: 'forgeDetail'; projectId: string; detail: ShownDetail };

/** Whether the Forge sidebar shows a project's lists, and whether its window is in the foreground: the main process
 * updates the data in the background when they come to show (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md). */
export const forgeSidebarPresenceSchema = z.object({
  visible: z.boolean(),
  foreground: z.boolean(),
  projectId: z.string().min(1),
});
export type ForgeSidebarPresence = z.infer<typeof forgeSidebarPresenceSchema>;
