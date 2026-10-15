import { deleteDocument } from '../documents/service.js'
import {
  createWorkspace,
  deleteWorkspaceRow,
  findOwnedWorkspace,
  listOwnerDocuments,
  listWorkspaceDocuments,
  listWorkspaces,
  renameWorkspace,
  workspaceDocIds,
  type DocSummary,
  type WorkspaceRow,
} from './store.js'

export type { DocSummary, WorkspaceRow }

export async function getWorkspaces(ownerId: string): Promise<WorkspaceRow[]> {
  return listWorkspaces(ownerId)
}

export async function addWorkspace(
  ownerId: string,
  name: string,
): Promise<WorkspaceRow> {
  return createWorkspace(ownerId, name)
}

export async function getWorkspace(
  id: string,
  ownerId: string,
): Promise<WorkspaceRow | null> {
  return findOwnedWorkspace(id, ownerId)
}

export async function updateWorkspace(
  id: string,
  ownerId: string,
  name: string,
): Promise<WorkspaceRow | null> {
  const owned = await findOwnedWorkspace(id, ownerId)
  if (!owned) return null
  await renameWorkspace(id, name)
  return { ...owned, name }
}

export async function getWorkspaceDocuments(
  id: string,
  ownerId: string,
): Promise<DocSummary[] | null> {
  const owned = await findOwnedWorkspace(id, ownerId)
  if (!owned) return null
  return listWorkspaceDocuments(id)
}

export async function getOwnerDocuments(ownerId: string): Promise<DocSummary[]> {
  return listOwnerDocuments(ownerId)
}

/**
 * Delete a workspace and every document in it. Docs are removed through the
 * same path as `DELETE /v1/documents/:docId` (artifact files + Postgres rows +
 * Qdrant vectors + chat memory) before the workspace row itself, because
 * Document.workspace uses onDelete: Restrict.
 */
export async function removeWorkspace(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const owned = await findOwnedWorkspace(id, ownerId)
  if (!owned) return false
  const docIds = await workspaceDocIds(id)
  for (const docId of docIds) {
    await deleteDocument(docId)
  }
  await deleteWorkspaceRow(id)
  return true
}
