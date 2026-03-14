import { readAllNotes, archiveNote, deleteNote } from './notes.js';
import { removeFromIndex, recencyScore } from './embedding.js';
import { flushAccessQueue } from './access-tracker.js';
import { DEFAULT_EVICTION_CONFIG, type EvictionConfig } from './config.js';

/**
 * Eviction score weights.
 * Access frequency is weighted higher because it directly indicates
 * whether a memory is actively useful.
 */
const RECENCY_WEIGHT = 0.4;
const ACCESS_WEIGHT = 0.6;

/**
 * Calculate the eviction score for a note.
 * Higher score = more valuable = less likely to be evicted.
 *
 * @param created - ISO timestamp of note creation
 * @param accessCount - cumulative access count (0 if never accessed)
 * @param maxAccessCount - the highest accessCount across all notes (for normalization)
 */
export function evictionScore(created: string, accessCount: number, maxAccessCount: number): number {
    const recency = recencyScore(created);
    const normalizedAccess = maxAccessCount > 0 ? accessCount / maxAccessCount : 0;
    return recency * RECENCY_WEIGHT + normalizedAccess * ACCESS_WEIGHT;
}

/**
 * Run passive eviction if note count exceeds the configured maximum.
 *
 * Flow:
 * 1. Flush the access queue to ensure accessCount is up-to-date
 * 2. Read all notes and check if count exceeds maxNotes
 * 3. Score each note (recency + access frequency)
 * 4. Evict the lowest-scored notes (archive or delete)
 *
 * Returns the number of notes evicted, or 0 if eviction was not needed.
 */
export async function runEviction(config: EvictionConfig = DEFAULT_EVICTION_CONFIG): Promise<number> {
    if (!config.enabled) return 0;

    // Step 1: Flush access queue to get accurate counts
    await flushAccessQueue();

    // Step 2: Read all notes
    const allNotes = await readAllNotes();
    if (allNotes.length <= config.maxNotes) return 0;

    // Step 3: Calculate eviction scores
    const maxAccessCount = Math.max(1, ...allNotes.map((n) => n.meta.accessCount || 0));

    const scored = allNotes.map((note) => ({
        id: note.meta.id,
        score: evictionScore(note.meta.created, note.meta.accessCount || 0, maxAccessCount),
    }));

    // Sort ascending — lowest score = first to be evicted
    scored.sort((a, b) => a.score - b.score);

    // Step 4: Determine how many to evict
    const overflow = allNotes.length - config.maxNotes;
    const toEvict = Math.min(overflow + config.evictBatch, scored.length);

    // Step 5: Evict
    let evicted = 0;
    for (let i = 0; i < toEvict; i++) {
        const { id } = scored[i];

        // Remove from vector index
        try {
            await removeFromIndex(id);
        } catch {
            // Best effort — continue with disk operations
        }

        // Archive or delete from disk
        let success: boolean;
        if (config.archive) {
            success = await archiveNote(id);
        } else {
            success = await deleteNote(id);
        }

        if (success) evicted++;
    }

    if (evicted > 0) {
        console.error(`Mnemo: evicted ${evicted} notes (${config.archive ? 'archived' : 'deleted'})`);
    }

    return evicted;
}
