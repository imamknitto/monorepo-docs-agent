import type { EmbeddingModel } from "@anvia/core/embeddings";
import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments, vectorFilter } from "@anvia/core/vector-store";
import { QdrantVectorClient } from "@anvia/qdrant";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";
import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  QDRANT_API_KEY,
  QDRANT_COLLECTION,
  QDRANT_URL,
} from "../config.js";
import type { RetrievedPage } from "@halodocs/agent";

export type PageMetadata = {
  documentId: string;
  documentName: string;
  pageNumber: number;
};

let modelPromise: Promise<EmbeddingModel | null> | null = null;

/** Lazy local embedding model (Xenova/all-MiniLM-L6-v2 by default). */
export function getEmbeddingModel(): Promise<EmbeddingModel | null> {
  if (!modelPromise) {
    console.log(`[rag:embedding] loading model ${EMBEDDING_MODEL} ...`);
    const started = Date.now();
    modelPromise = loadTransformersEmbeddingModel({ modelId: EMBEDDING_MODEL })
      .then((model) => {
        console.log(
          `[rag:embedding] model ready ${EMBEDDING_MODEL} elapsed=${Date.now() - started}ms`,
        );
        return model;
      })
      .catch((err: unknown) => {
        console.warn(
          `[rag:embedding] model unavailable id=${EMBEDDING_MODEL} err=${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : "",
        );
        return null;
      });
  }
  return modelPromise;
}

/** New store handle each call (cheap; Qdrant client is stateless per call). */
export function getVectorStore() {
  const client = new QdrantVectorClient({
    url: QDRANT_URL,
    ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
  });
  return client.vectorStore<RetrievedPage, PageMetadata>({
    collectionName: QDRANT_COLLECTION,
    dimensions: EMBEDDING_DIMS,
    metric: "cosine",
  });
}

export function pointId(docId: string, pageNumber: number): string {
  return `${docId}-page-${pageNumber - 1}`;
}

/** Embed + upsert pages. Returns false when embeddings are unavailable. */
export async function indexPages(
  docId: string,
  name: string,
  pages: RetrievedPage[],
): Promise<boolean> {
  const started = Date.now();
  console.log(
    `[rag:index] doc=${docId} start pages=${pages.length} model=${EMBEDDING_MODEL}`,
  );
  const model = await getEmbeddingModel();
  if (!model) {
    console.warn(
      `[rag:index] doc=${docId} SKIP embedding model unavailable — keyword fallback active`,
    );
    return false;
  }
  try {
    const store = getVectorStore();
    await store.ensure();
    console.log(
      `[rag:index] doc=${docId} store ready collection=${QDRANT_COLLECTION}`,
    );
    const { documents } = await embedDocuments<RetrievedPage, PageMetadata>({
      model,
      documents: pages,
      id: (page) => pointId(docId, page.pageNumber),
      content: (page) => page.content,
      metadata: (page) => ({
        documentId: docId,
        documentName: name,
        pageNumber: page.pageNumber,
      }),
    });
    console.log(
      `[rag:index] doc=${docId} embedded=${documents.length} elapsed=${Date.now() - started}ms`,
    );
    await store.upsert({ documents });
    console.log(
      `[rag:index] doc=${docId} upsert ok elapsed=${Date.now() - started}ms`,
    );
    return true;
  } catch (err) {
    console.error(
      `[rag:index] doc=${docId} FAILED err=${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : "",
    );
    throw err;
  }
}

/** Delete all Qdrant points of one document. Best-effort: logs and swallows errors. */
export async function deleteDocVectors(
  docId: string,
  pageNumbers: number[],
): Promise<void> {
  if (pageNumbers.length === 0) return;
  const ids = pageNumbers.map((n) => pointId(docId, n));
  console.log(`[rag:delete] doc=${docId} deleting ${ids.length} points`);
  try {
    const store = getVectorStore();
    await store.delete({ documentIds: ids });
    console.log(`[rag:delete] doc=${docId} ok`);
  } catch (err) {
    console.warn(
      `[rag:delete] doc=${docId} FAILED err=${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : "",
    );
  }
}

/** Vector retrieval scoped to one document. Null when embeddings are unavailable. */
export async function retrieveForDoc(
  docId: string,
  question: string,
  topK = 4,
): Promise<RetrievedPage[] | null> {
  const model = await getEmbeddingModel();
  if (!model) return null;
  const store = getVectorStore();
  const results = await retrieveDocuments<RetrievedPage, PageMetadata>({
    store,
    model,
    query: question,
    topK,
    filter: vectorFilter.eq("documentId", docId),
  });
  return results.map((r) => ({
    pageNumber: r.metadata?.pageNumber ?? r.document.pageNumber ?? 0,
    content: r.document.content,
  }));
}
