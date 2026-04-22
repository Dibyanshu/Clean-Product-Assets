/**
 * Chroma-compatible in-memory vector store using TF-IDF cosine similarity.
 *
 * Interface mirrors the ChromaDB JS client so it can be swapped for a real
 * ChromaDB HTTP connection (localhost:8000) without touching call-sites:
 *
 *   createOrGetCollection(projectId)     → POST /api/v1/collections
 *   upsertDocuments(projectId, docs)     → POST /api/v1/collections/{id}/upsert
 *   queryDocuments(projectId, q)         → POST /api/v1/collections/{id}/query
 *   deleteCollection(projectId)          → DELETE /api/v1/collections/{id}
 *
 * Data flow:
 *   Ingestion → upsert code chunks   ─┐
 *   DB Schema → upsert schema text   ─┼─► collection[projectId] ──► queryDocuments
 *   Analysis  → inject top results   ─┘
 */

import { logger } from "../lib/logger.js";

export interface InputDocument {
  id: string;
  content: string;
  metadata: {
    type: "code" | "schema" | "api";
    file?: string;
    [key: string]: string | undefined;
  };
}

export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, string | undefined>;
  score: number;
}

interface StoredDocument {
  id: string;
  content: string;
  metadata: Record<string, string | undefined>;
}

interface Collection {
  documents: Map<string, StoredDocument>;
}

const store = new Map<string, Collection>();

const STOP_WORDS = new Set([
  "a","an","the","and","or","in","of","to","is","it","as","at","by","for","on",
  "with","this","that","from","be","are","was","were","has","have","had","will",
  "would","could","should","not","but","if","then","than","so","do","does","did",
  "can","may","we","i","you","he","she","they","our","your","its","return","const",
  "let","var","function","class","export","import","new","true","false","null",
]);

function tokenize(text: string): Map<string, number> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

function buildVector(text: string, vocab: string[], idf: Map<string, number>): number[] {
  const freq = tokenize(text);
  const total = Math.max(Array.from(freq.values()).reduce((s, v) => s + v, 0), 1);
  return vocab.map((term) => {
    const tf = (freq.get(term) ?? 0) / total;
    return tf * (idf.get(term) ?? 0);
  });
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function createOrGetCollection(projectId: string): void {
  if (!store.has(projectId)) {
    store.set(projectId, { documents: new Map() });
    logger.debug({ projectId }, "[ChromaService] Collection created");
  }
}

export function upsertDocuments(projectId: string, documents: InputDocument[]): void {
  createOrGetCollection(projectId);
  const coll = store.get(projectId)!;
  for (const doc of documents) {
    coll.documents.set(doc.id, {
      id: doc.id,
      content: doc.content,
      metadata: doc.metadata as Record<string, string | undefined>,
    });
  }
  logger.info({ projectId, count: documents.length, total: coll.documents.size }, "[ChromaService] Documents upserted");
}

export function queryDocuments(projectId: string, query: string, nResults = 5): SearchResult[] {
  const coll = store.get(projectId);
  if (!coll || coll.documents.size === 0) {
    logger.debug({ projectId }, "[ChromaService] Query on empty collection");
    return [];
  }

  const docs = Array.from(coll.documents.values());

  const vocabSet = new Set<string>();
  for (const doc of docs) for (const term of tokenize(doc.content).keys()) vocabSet.add(term);
  const vocab = Array.from(vocabSet);

  const idf = new Map<string, number>();
  for (const term of vocab) {
    const df = docs.filter((d) => tokenize(d.content).has(term)).length;
    idf.set(term, Math.log((docs.length + 1) / (df + 1)) + 1);
  }

  const queryVec = buildVector(query, vocab, idf);

  const scored = docs
    .map((doc) => ({ ...doc, score: cosine(queryVec, buildVector(doc.content, vocab, idf)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, nResults)
    .filter((d) => d.score > 0);

  logger.debug({ projectId, query, hits: scored.length }, "[ChromaService] Query complete");

  return scored.map((d) => ({
    id: d.id,
    content: d.content,
    metadata: d.metadata,
    score: Math.round(d.score * 1000) / 1000,
  }));
}

export function deleteCollection(projectId: string): void {
  store.delete(projectId);
  logger.debug({ projectId }, "[ChromaService] Collection deleted");
}

export function getDocumentCount(projectId: string): number {
  return store.get(projectId)?.documents.size ?? 0;
}

export function getAllDocuments(projectId: string): StoredDocument[] {
  const coll = store.get(projectId);
  if (!coll) return [];
  return Array.from(coll.documents.values());
}
