import { LocalIndex } from 'vectra';
import { getIndexDir, ensureDir, type Note } from './config.js';

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

/**
 * Search for similar notes by query text
 */
export async function searchNotes(
    query: string,
    topK: number = 5,
    sourceFilter?: string,
): Promise<
    Array<{
        id: string;
        score: number;
        text: string;
        tags: string;
        source: string;
        created: string;
    }>
> {
    const index = await getIndex();
    const vector = await embed(query);

    const filter = sourceFilter ? { source: { $eq: sourceFilter } } : undefined;
    const results = await index.queryItems(vector, '', topK, filter);

    return results.map((r) => ({
        id: r.item.metadata.id as string,
        score: r.score,
        text: r.item.metadata.text as string,
        tags: r.item.metadata.tags as string,
        source: r.item.metadata.source as string,
        created: r.item.metadata.created as string,
    }));
}
