import { prisma } from '../../utils/prisma.js'

export interface WorkspaceRow {
  id: string
  ownerId: string
  name: string
  createdAt: Date
  documentCount?: number
}

/** Document summary shape shared by workspace + owner listings (platform-facing). */
export interface DocSummary {
  doc_id: string
  markdown_url: string
  filename: string
  created_at: string
  expires_at: string | null
  stats: unknown
  isProcessed: boolean
  workspace_id: string | null
}

export async function listWorkspaces(ownerId: string): Promise<WorkspaceRow[]> {
  const rows = await prisma.workspace.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { documents: true } } },
  })
  return rows.map((w) => ({
    id: w.id,
    ownerId: w.ownerId,
    name: w.name,
    createdAt: w.createdAt,
    documentCount: w._count.documents,
  }))
}

export async function createWorkspace(
  ownerId: string,
  name: string,
): Promise<WorkspaceRow> {
  const w = await prisma.workspace.create({ data: { ownerId, name } })
  return { id: w.id, ownerId: w.ownerId, name: w.name, createdAt: w.createdAt, documentCount: 0 }
}

/** Fetch a workspace only if it belongs to `ownerId` (else null → 404). */
export async function findOwnedWorkspace(
  id: string,
  ownerId: string,
): Promise<WorkspaceRow | null> {
  const w = await prisma.workspace.findFirst({ where: { id, ownerId } })
  if (!w) return null
  return { id: w.id, ownerId: w.ownerId, name: w.name, createdAt: w.createdAt }
}

export async function renameWorkspace(
  id: string,
  name: string,
): Promise<void> {
  await prisma.workspace.update({ where: { id }, data: { name } })
}

export async function deleteWorkspaceRow(id: string): Promise<void> {
  await prisma.workspace.delete({ where: { id } })
}

function toSummary(doc: {
  id: string
  name: string
  createdAt: Date
  stats: unknown
  isProcessed: boolean
  workspaceId: string | null
}): DocSummary {
  return {
    doc_id: doc.id,
    markdown_url: `/public/${doc.id}/doc.md`,
    filename: doc.name,
    created_at: doc.createdAt.toISOString(),
    expires_at: null,
    stats: doc.stats ?? {},
    isProcessed: doc.isProcessed,
    workspace_id: doc.workspaceId,
  }
}

/** Documents inside one workspace, newest first. */
export async function listWorkspaceDocuments(
  workspaceId: string,
): Promise<DocSummary[]> {
  const docs = await prisma.document.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  })
  return docs.map(toSummary)
}

/** All documents owned by a user across every workspace, newest first. */
export async function listOwnerDocuments(
  ownerId: string,
): Promise<DocSummary[]> {
  const docs = await prisma.document.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
  })
  return docs.map(toSummary)
}

/** docIds currently inside a workspace — used by cascade delete. */
export async function workspaceDocIds(workspaceId: string): Promise<string[]> {
  const docs = await prisma.document.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  return docs.map((d) => d.id)
}
