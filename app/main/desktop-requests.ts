import { z } from 'zod';
import type { DesktopAPI, DesktopRequest } from '../shared/api';
import { dispatchRequestSchema } from '../shared/dispatch';
import { directActionSchema, repositoryReferenceSchema } from '../shared/forge/forge';
import { detailItemSchema, forgeListViewSchema, forgeSidebarPresenceSchema } from '../shared/forge/sidebar-data';
import { agentTypeSchema, layoutSchema, sidebarPreferencesSchema, sidebarSchema } from '../shared/model';
import { settingsPatchSchema } from '../shared/settings/settings';

// The renderer's arguments are data entering the main process: each request's are parsed here, by the types the
// DesktopAPI contract gives them, before a handler sees them. What a value means (a name that is too long, a layout
// that places other panels) is for the Workbench to judge; these schemas check its shape.

const id = z.string();
const projectDraftSchema = z.object({
  name: z.string(),
  directory: z.string(),
  total: z.number(),
  counts: z.record(agentTypeSchema, z.number()),
});
const projectEditSchema = z.object({ name: z.string(), directory: z.string() });
const itemNumbersSchema = z.array(z.number());

/** The schema of each request's arguments, as a tuple in the contract's order. */
export const desktopRequestArguments: { [R in DesktopRequest]: z.ZodType<Parameters<DesktopAPI[R]>> } = {
  fetchSnapshot: z.tuple([]),
  createProject: z.tuple([projectDraftSchema]),
  editProject: z.tuple([id, projectEditSchema, z.boolean()]),
  deleteProject: z.tuple([id]),
  inspectDirectory: z.tuple([z.string()]),
  fetchRepositoryChoices: z.tuple([id, z.string()]),
  bindRepository: z.tuple([id, repositoryReferenceSchema]),
  unbindRepository: z.tuple([id]),
  showForgeList: z.tuple([id, forgeListViewSchema]),
  reportForgeSidebarPresence: z.tuple([forgeSidebarPresenceSchema]),
  loadMoreForgeList: z.tuple([id]),
  showForgeRows: z.tuple([id, itemNumbersSchema]),
  refreshForgeList: z.tuple([id]),
  showRepositoryChoices: z.tuple([id]),
  showForgeDetail: z.tuple([id, detailItemSchema.nullable()]),
  reportForgeRowResting: z.tuple([id, detailItemSchema.nullable()]),
  reportForgeItemChanged: z.tuple([id, detailItemSchema]),
  performDirectAction: z.tuple([id, directActionSchema]),
  dispatch: z.tuple([id, dispatchRequestSchema]),
  chooseDirectory: z.tuple([]),
  activateProject: z.tuple([id]),
  addPanel: z.tuple([id, agentTypeSchema]),
  closePanel: z.tuple([id, id]),
  placeInLayout: z.tuple([id, id, layoutSchema]),
  moveToTray: z.tuple([id, id]),
  saveLayout: z.tuple([id, layoutSchema.nullable()]),
  saveSidebar: z.tuple([sidebarSchema, sidebarPreferencesSchema]),
  saveSettings: z.tuple([settingsPatchSchema]),
  checkCommand: z.tuple([z.string()]),
  sendInput: z.tuple([id, z.string()]),
  resizeRun: z.tuple([id, z.number(), z.number()]),
  acknowledgeOutput: z.tuple([id, z.number()]),
  reportRendererReady: z.tuple([]),
  quit: z.tuple([]),
};
