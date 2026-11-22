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

export interface ForgeListItems {
  issues: ListedIssue;
  pullRequests: PullRequestSummary;
}
export const forgeListTabs = ['issues', 'pullRequests'] as const;
export type ForgeListTab = (typeof forgeListTabs)[number];

export const forgeListViewSchema = z.object({
  tab: z.enum(forgeListTabs),
  filter: listQuerySchema.shape.filter,
});
export type ForgeListView = z.infer<typeof forgeListViewSchema>;

export type FailedPage = Extract<Page<unknown>, { ok: false }>;
export type LoadedList<Item> = ListPage<Item> & { filter: ListFilter };
export interface TabList<Item> {
  loaded: LoadedList<Item> | null;
  failed: FailedPage | null;
}
export type ForgeLists = { [T in ForgeListTab]: TabList<ForgeListItems[T]> } & { loading: boolean };

export type ShownRepositoryChoices = RepositoryChoices | null;

export const detailItemSchema = z.object({ kind: z.enum(['issue', 'pullRequest']), number: itemNumberSchema });
export type DetailItem = z.infer<typeof detailItemSchema>;
export const sameItem = (a: DetailItem | null, b: DetailItem | null) => a?.kind === b?.kind && a?.number === b?.number;
export type DetailResult = IssueDetailResult | PullRequestDetailResult;
export interface ShownDetail {
  item: DetailItem;
  result: DetailResult;
  failed: ForgeFailure | null;
}

export type ForgeSidebarEvent =
  | { kind: 'forgeLists'; projectId: string; lists: ForgeLists }
  | { kind: 'repositoryChoices'; projectId: string; choices: ShownRepositoryChoices }
  | { kind: 'forgeDetail'; projectId: string; detail: ShownDetail };

export const forgeSidebarPresenceSchema = z.object({
  visible: z.boolean(),
  foreground: z.boolean(),
  projectId: z.string().min(1),
});
export type ForgeSidebarPresence = z.infer<typeof forgeSidebarPresenceSchema>;
