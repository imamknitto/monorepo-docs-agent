import {
  deleteArtifact,
  listArtifacts,
  readPublicFile,
  type ArtifactMeta,
  type StoredFile,
} from './artifacts.js'
import { deleteDocCascade } from './store.js'

export async function listDocuments(): Promise<ArtifactMeta[]> {
  return listArtifacts()
}

export async function getMarkdownDownload(docId: string): Promise<StoredFile | null> {
  return readPublicFile(`${docId}/doc.md`)
}

/** Delete files first, then best-effort database and vector cleanup. */
export async function deleteDocument(docId: string): Promise<void> {
  await deleteArtifact(docId)
  try {
    await deleteDocCascade(docId)
  } catch (err) {
    console.warn('cascade delete failed', err)
  }
}
