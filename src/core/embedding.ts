import { LocalIndex } from 'vectra';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, resolveStorageContext, type Note } from './config.js';
import { readAllNotes } from './notes.js';

let embedder: any = null;
let embedderLoading: Promise<any> | null = null;
const indexInstances = new Map<string, LocalIndex>();
/** Track dirs where integrity check has already passed */
const integrityChecked = new Set<string>();

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
 * Get or create the vector index.
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
 * Run index integrity check once per data dir per process lifetime.
 * Should be called at read-path entry points (search, findSimilar)
 * rather than write-path (save/indexNote) to avoid false positives
 * during the normal save flow where a note is written to disk
 * before being indexed.
 */
async function ensureIndexIntegrity(): Promise<void> {
    const { indexDir } = await resolveStorageContext();
    if (integrityChecked.has(indexDir) || !isEmbeddingReady()) return;
    integrityChecked.add(indexDir);
    try {
        const index = await getIndex();
        await checkAndRepairIndex(index, indexDir);
    } catch (err) {
        console.error('Mnemo: integrity check failed:', err instanceof Error ? err.message : String(err));
    }
}

/**
 * Compare notes on disk with entries in the vector index.
 * If any inconsistency is found, rebuild the entire index.
 *
 * Inconsistency means:
 * - A note file exists on disk but has no corresponding index entry
 * - An index entry exists but its note file is missing from disk
 */
async function checkAndRepairIndex(index: LocalIndex, indexDir: string): Promise<void> {
    const { notesDir } = await resolveStorageContext();

    // Collect note IDs from disk
    let noteFiles: string[];
    try {
        noteFiles = (await fs.readdir(notesDir)).filter((f) => f.endsWith('.md'));
    } catch {
        noteFiles = [];
    }
    const diskIds = new Set(noteFiles.map((f) => f.replace(/\.md$/, '')));

    // Collect note IDs from index (stored in external metadata JSON files)
    const items = await index.listItems();
    const indexIds = new Set<string>();
    for (const item of items) {
        // When metadata_config.indexed is set, the real metadata (including id)
        // lives in an external JSON file. We need to read it.
        let noteId: string | undefined = (item.metadata as any).id;
        if (!noteId && item.metadataFile) {
            try {
                const metaPath = path.join(indexDir, item.metadataFile);
                const raw = await fs.readFile(metaPath, 'utf-8');
                const meta = JSON.parse(raw);
                noteId = meta.id;
            } catch {
                // metadata file missing or corrupt — definitely inconsistent
            }
        }
        if (noteId) {
            indexIds.add(noteId);
        }
    }

    // Check consistency: both sets must match exactly
    const missingFromIndex = [...diskIds].filter((id) => !indexIds.has(id));
    const orphanInIndex = [...indexIds].filter((id) => !diskIds.has(id));

    if (missingFromIndex.length === 0 && orphanInIndex.length === 0) {
        return; // All good
    }

    console.error(
        `Mnemo: index inconsistency detected — ` +
            `${missingFromIndex.length} notes missing from index, ` +
            `${orphanInIndex.length} orphan entries in index. Rebuilding...`,
    );

    await rebuildIndex(index, indexDir);
}

/**
 * Rebuild the vector index from scratch.
 * 1. Delete the existing index (including all external metadata JSON files)
 * 2. Re-create an empty index
 * 3. Re-index all notes currently on disk
 *
 * Also exported for manual/CLI use.
 */
export async function rebuildIndex(
    existingIndex?: LocalIndex,
    indexDir?: string,
): Promise<{ indexed: number; errors: number }> {
    if (!indexDir) {
        const ctx = await resolveStorageContext();
        indexDir = ctx.indexDir;
    }

    // Step 1: Clean up — remove all external metadata JSON files
    try {
        const files = await fs.readdir(indexDir);
        const metaJsonFiles = files.filter((f) => f.endsWith('.json') && f !== 'index.json');
        for (const f of metaJsonFiles) {
            await fs.unlink(path.join(indexDir, f)).catch(() => {});
        }
    } catch {
        // index dir might not exist yet
    }

    // Step 2: Delete and re-create the index
    const index = existingIndex || new LocalIndex(indexDir);
    if (await index.isIndexCreated()) {
        await index.deleteIndex();
    }
    await ensureDir(indexDir);
    await index.createIndex({
        version: 1,
        metadata_config: { indexed: ['source'] },
    });

    // Update cached instance
    indexInstances.set(indexDir, index);

    // Step 3: Re-index all notes from disk
    const allNotes = await readAllNotes();
    let indexed = 0;
    let errors = 0;

    for (const note of allNotes) {
        try {
            const vector = await embed(note.content);
            await index.insertItem({
                id: note.meta.id,
                vector,
                metadata: {
                    id: note.meta.id,
                    text: note.content.slice(0, 500),
                    tags: note.meta.tags.join(','),
                    source: note.meta.source,
                    created: note.meta.created,
                    type: note.meta.type || '',
                },
            });
            indexed++;
        } catch (err) {
            errors++;
            console.error(
                `Mnemo: failed to re-index note ${note.meta.id}:`,
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    console.error(`Mnemo: index rebuilt — ${indexed} notes indexed, ${errors} errors`);
    return { indexed, errors };
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

    await ensureIndexIntegrity();

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
 * Remove a note from the vector index.
 * Also cleans up the external metadata JSON file if one exists.
 */
export async function removeFromIndex(noteId: string): Promise<void> {
    const index = await getIndex();
    const item = await index.getItem(noteId);
    if (item) {
        const metadataFile = (item as any).metadataFile as string | undefined;
        await index.deleteItem(noteId);

        // Clean up external metadata JSON file (vectra doesn't do this)
        if (metadataFile) {
            const { indexDir } = await resolveStorageContext();
            await fs.unlink(path.join(indexDir, metadataFile)).catch(() => {});
        }
    } else {
        console.error(`Mnemo: removeFromIndex — note ${noteId} not found in index (may already be removed)`);
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
    // Run integrity check on first search call
    await ensureIndexIntegrity();

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

        // Filter out results whose note files no longer exist on disk.
        // This guards against stale index entries (e.g. after failed compress/eviction).
        const { notesDir } = await resolveStorageContext();
        const verified: SearchResult[] = [];
        for (const r of vectorResults) {
            try {
                await fs.access(path.join(notesDir, `${r.id}.md`));
                verified.push(r);
            } catch {
                // Note file missing — skip this stale index entry
            }
        }
        vectorResults = verified;
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
