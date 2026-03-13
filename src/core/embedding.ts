import { LocalIndex } from 'vectra';
import { ensureDir, resolveStorageContext, type Note } from './config.js';
import { readAllNotes } from './notes.js';

let embedder: any = null;
let embedderLoading: Promise<any> | null = null;
const indexInstances = new Map<string, LocalIndex>();

/**
 * Load the embedding model.
 * Uses all-MiniLM-L6-v2 (384 dims, ~33MB, good quality/speed tradeoff).
 * Deduplicates concurrent calls so the model is only loaded once.
 */
async function getEmbedder(): Promise<any> {
    if (embedder) return embedder;

    if (!embedderLoading) {
        embedderLoading = (async () => {
            console.error('Mnemo: loading embedding model...');
            const { pipeline } = await import('@huggingface/transformers');
            embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            console.error('Mnemo: embedding model loaded');
            return embedder;
        })();
    }

    return embedderLoading;
}

/**
 * Pre-warm the embedding model in the background.
 * Call this at server startup so the model is ready before the first tool call.
 */
export function preloadEmbedding(): void {
    getEmbedder().catch((err) => {
        console.error('Mnemo: failed to preload embedding model:', err);
    });
}

/**
 * Check if the embedding model is ready
 */
export function isEmbeddingReady(): boolean {
    return embedder !== null;
}

/**
 * Generate embedding vector for text
 */
export async function embed(text: string): Promise<number[]> {
    const model = await getEmbedder();
    const output = await model(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
}

/**
 * Get or create the vector index
 */
async function getIndex(): Promise<LocalIndex> {
    const { indexDir } = await resolveStorageContext();
    let indexInstance = indexInstances.get(indexDir) || null;

    if (!indexInstance) {
        await ensureDir(indexDir);

        indexInstance = new LocalIndex(indexDir);

        if (!(await indexInstance.isIndexCreated())) {
            await indexInstance.createIndex({
                version: 1,
                metadata_config: { indexed: ['source'] },
            });
            console.error('Mnemo: vector index created');
        }

        indexInstances.set(indexDir, indexInstance);
    }
    return indexInstance;
}

/**
 * Dedup detection threshold — cosine similarity above this is considered near-duplicate.
 * MiniLM-L6-v2 cosine similarity: 0.85+ generally means semantically near-identical content.
 */
export const DEDUP_SIMILARITY_THRESHOLD = 0.85;

export interface SimilarNote {
    id: string;
    score: number;
    text: string;
}

/**
 * Find notes similar to the given content.
 * Returns matches above the threshold, sorted by descending similarity.
 * Returns empty array if embedding model is not ready.
 */
export async function findSimilar(
    content: string,
    threshold: number = DEDUP_SIMILARITY_THRESHOLD,
    topK: number = 3,
): Promise<SimilarNote[]> {
    if (!isEmbeddingReady()) return [];

    const index = await getIndex();
    const vector = await embed(content);
    const results = await index.queryItems(vector, '', topK);

    return results
        .filter((r) => r.score >= threshold)
        .map((r) => ({
            id: r.item.metadata.id as string,
            score: r.score,
            text: r.item.metadata.text as string,
        }));
}

/**
 * Index a note (generate embedding and store in vector index)
 */
export async function indexNote(note: Note): Promise<void> {
    const index = await getIndex();
    const vector = await embed(note.content);

    await index.insertItem({
        id: note.meta.id,
        vector,
        metadata: {
            id: note.meta.id,
            text: note.content.slice(0, 500), // store truncated text for quick access
            tags: note.meta.tags.join(','),
            source: note.meta.source,
            created: note.meta.created,
            type: note.meta.type || '',
        },
    });
}

/**
 * Remove a note from the vector index
 */
export async function removeFromIndex(noteId: string): Promise<void> {
    const index = await getIndex();
    const item = await index.getItem(noteId);
    if (item) {
        await index.deleteItem(noteId);
    }
}

/**
 * Remove multiple notes from the vector index
 */
export async function removeMultipleFromIndex(noteIds: string[]): Promise<void> {
    for (const id of noteIds) {
        await removeFromIndex(id);
    }
}

export interface SearchResult {
    id: string;
    score: number;
    text: string;
    tags: string;
    source: string;
    created: string;
    type: string;
}

/**
 * Keyword search: split query into terms, score each note by match ratio.
 * Case-insensitive substring matching.
 */
function keywordSearch(
    notes: Note[],
    query: string,
    sourceFilter?: string,
): Array<{ id: string; score: number; note: Note }> {
    const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1);
    if (terms.length === 0) return [];

    const results: Array<{ id: string; score: number; note: Note }> = [];

    for (const note of notes) {
        if (sourceFilter && note.meta.source !== sourceFilter) continue;

        const contentLower = note.content.toLowerCase();
        let matched = 0;

        for (const term of terms) {
            if (contentLower.includes(term)) {
                matched++;
            }
        }

        if (matched > 0) {
            const score = matched / terms.length;
            results.push({ id: note.meta.id, score, note });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

/**
 * Time decay half-life in days.
 * After this many days, a memory's recency score drops to ~0.5.
 * 7 days: last week ≈ 0.5, two weeks ≈ 0.25, one month ≈ 0.06
 */
export const TIME_DECAY_HALF_LIFE_DAYS = 7;

/**
 * Calculate time-based recency score using exponential decay.
 * Returns a value in [0, 1] where 1 = just now, approaching 0 = very old.
 */
export function recencyScore(created: string, halfLifeDays: number = TIME_DECAY_HALF_LIFE_DAYS): number {
    const ageMs = Date.now() - new Date(created).getTime();
    const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
    return Math.pow(2, -ageDays / halfLifeDays);
}

/**
 * Merge vector search and keyword search results with time decay.
 * Deduplicates by ID, takes weighted combination for items found by both.
 * Final score = semantic * 0.6 + keyword * 0.2 + recency * 0.2
 */
function mergeResults(
    vectorResults: SearchResult[],
    keywordResults: Array<{ id: string; score: number; note: Note }>,
    vectorWeight: number = 0.6,
    textWeight: number = 0.2,
    recencyWeight: number = 0.2,
): SearchResult[] {
    const merged = new Map<string, SearchResult>();

    // Add vector results
    for (const r of vectorResults) {
        const recency = recencyScore(r.created);
        merged.set(r.id, { ...r, score: r.score * vectorWeight + recency * recencyWeight });
    }

    // Merge keyword results
    for (const kr of keywordResults) {
        const existing = merged.get(kr.id);
        const recency = recencyScore(kr.note.meta.created);
        if (existing) {
            // Found in both — combine scores
            existing.score += kr.score * textWeight;
        } else {
            // Only found by keyword search
            merged.set(kr.id, {
                id: kr.id,
                score: kr.score * textWeight + recency * recencyWeight,
                text: kr.note.content.slice(0, 500),
                tags: kr.note.meta.tags.join(','),
                source: kr.note.meta.source,
                created: kr.note.meta.created,
                type: kr.note.meta.type || '',
            });
        }
    }

    const results = Array.from(merged.values());
    results.sort((a, b) => b.score - a.score);
    return results;
}

/**
 * Search for similar notes using hybrid search (vector + keyword).
 * Falls back to keyword-only if embedding is not ready.
 */
export async function searchNotes(query: string, topK: number = 5, sourceFilter?: string): Promise<SearchResult[]> {
    // Vector search
    let vectorResults: SearchResult[] = [];
    if (isEmbeddingReady()) {
        const index = await getIndex();
        const vector = await embed(query);
        const filter = sourceFilter ? { source: { $eq: sourceFilter } } : undefined;
        const results = await index.queryItems(vector, '', topK, filter);

        vectorResults = results.map((r) => ({
            id: r.item.metadata.id as string,
            score: r.score,
            text: r.item.metadata.text as string,
            tags: r.item.metadata.tags as string,
            source: r.item.metadata.source as string,
            created: r.item.metadata.created as string,
            type: (r.item.metadata.type as string) || '',
        }));
    }

    // Keyword search
    const allNotes = await readAllNotes();
    const keywordResults = keywordSearch(allNotes, query, sourceFilter);

    // Merge
    if (vectorResults.length === 0 && keywordResults.length === 0) {
        return [];
    }

    if (vectorResults.length === 0) {
        // Keyword-only fallback (with recency boost)
        const results = keywordResults.map((kr) => ({
            id: kr.id,
            score: kr.score * 0.8 + recencyScore(kr.note.meta.created) * 0.2,
            text: kr.note.content.slice(0, 500),
            tags: kr.note.meta.tags.join(','),
            source: kr.note.meta.source,
            created: kr.note.meta.created,
            type: kr.note.meta.type || '',
        }));
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    const merged = mergeResults(vectorResults, keywordResults);
    return merged.slice(0, topK);
}
