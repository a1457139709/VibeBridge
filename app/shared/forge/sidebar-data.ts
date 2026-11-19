import { z } from 'zod';
import {
  itemNumberSchema,
  listQuerySchema,
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

/** The repositories a project can bind as the sidebar's binding pages show them: the forge's answer, or the reason the
 * read itself failed; null while it is being read. */
export type ShownRepositoryChoices = RepositoryChoices | { ok: false; error: string } | null;

/** An issue or pull request of the bound repository, as the detail opens it. */
export const detailItemSchema = z.object({ kind: z.enum(['issue', 'pullRequest']), number: itemNumberSchema });
export type DetailItem = z.infer<typeof detailItemSchema>;
/** What the forge answered for the detail's item: the issue or pull request, or the forge failure. */
export type DetailResult = IssueDetailResult | PullRequestDetailResult;
/** An item the sidebar's detail shows, and the forge's answer for it. */
export interface ShownDetail {
  item: DetailItem;
  result: DetailResult;
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
