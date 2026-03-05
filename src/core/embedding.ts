import { LocalIndex } from 'vectra';
import { getIndexDir, ensureDir, type Note } from './config.js';
import { readAllNotes } from './notes.js';

let embedder: any = null;
let embedderLoading: Promise<any> | null = null;
let indexInstance: LocalIndex | null = null;

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
    if (!indexInstance) {
        const indexDir = getIndexDir();
        await ensureDir(indexDir);

        indexInstance = new LocalIndex(indexDir);

        if (!(await indexInstance.isIndexCreated())) {
            await indexInstance.createIndex({
                version: 1,
                metadata_config: { indexed: ['source'] },
            });
            console.error('Mnemo: vector index created');
        }
    }
    return indexInstance;
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
 * Merge vector search and keyword search results.
 * Deduplicates by ID, takes weighted combination for items found by both.
 */
function mergeResults(
    vectorResults: SearchResult[],
    keywordResults: Array<{ id: string; score: number; note: Note }>,
    vectorWeight: number = 0.7,
    textWeight: number = 0.3,
): SearchResult[] {
    const merged = new Map<string, SearchResult>();

    // Add vector results
    for (const r of vectorResults) {
        merged.set(r.id, { ...r, score: r.score * vectorWeight });
    }

    // Merge keyword results
    for (const kr of keywordResults) {
        const existing = merged.get(kr.id);
        if (existing) {
            // Found in both — combine scores
            existing.score += kr.score * textWeight;
        } else {
            // Only found by keyword search
            merged.set(kr.id, {
                id: kr.id,
                score: kr.score * textWeight,
                text: kr.note.content.slice(0, 500),
                tags: kr.note.meta.tags.join(','),
                source: kr.note.meta.source,
                created: kr.note.meta.created,
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
        // Keyword-only fallback
        return keywordResults.slice(0, topK).map((kr) => ({
            id: kr.id,
            score: kr.score,
            text: kr.note.content.slice(0, 500),
            tags: kr.note.meta.tags.join(','),
            source: kr.note.meta.source,
            created: kr.note.meta.created,
        }));
    }

    const merged = mergeResults(vectorResults, keywordResults);
    return merged.slice(0, topK);
}
