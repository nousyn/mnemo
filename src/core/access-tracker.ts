import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveStorageContext } from './config.js';
import { readNote, updateNoteMeta } from './notes.js';

const QUEUE_FILE = 'access_queue.tsv';
const PROCESSING_FILE = 'access_queue.processing.tsv';

/**
 * Record a memory access event by appending to the queue file.
 * Called by search/get when a note is returned to the agent.
 * Uses appendFile which auto-creates the file if missing.
 */
export async function recordAccess(noteId: string): Promise<void> {
    try {
        const { dataDir } = await resolveStorageContext();
        const queuePath = path.join(dataDir, QUEUE_FILE);
        const line = `${noteId}\t${new Date().toISOString()}\n`;
        await fs.appendFile(queuePath, line, 'utf-8');
    } catch {
        // Best effort — don't block the calling tool
    }
}

/**
 * Record multiple memory access events at once.
 * More efficient than calling recordAccess() in a loop.
 */
export async function recordAccessBatch(noteIds: string[]): Promise<void> {
    if (noteIds.length === 0) return;
    try {
        const { dataDir } = await resolveStorageContext();
        const queuePath = path.join(dataDir, QUEUE_FILE);
        const now = new Date().toISOString();
        const lines = noteIds.map((id) => `${id}\t${now}\n`).join('');
        await fs.appendFile(queuePath, lines, 'utf-8');
    } catch {
        // Best effort
    }
}

/**
 * Flush the access queue: atomically rename the queue file, parse it,
 * and batch-update each note's accessCount and lastAccessed.
 *
 * Concurrency safe: rename is atomic. If another process renames first,
 * this call gets ENOENT and returns gracefully (nothing to flush).
 *
 * Returns the number of notes updated.
 */
export async function flushAccessQueue(): Promise<number> {
    const { dataDir } = await resolveStorageContext();
    const queuePath = path.join(dataDir, QUEUE_FILE);
    const processingPath = path.join(dataDir, PROCESSING_FILE);

    // Step 1: Atomically grab the queue file
    try {
        await fs.rename(queuePath, processingPath);
    } catch {
        // ENOENT = no queue file (empty or grabbed by another process)
        return 0;
    }

    // Step 2: Parse the processing file
    let content: string;
    try {
        content = await fs.readFile(processingPath, 'utf-8');
    } catch {
        return 0;
    }

    // Aggregate access counts per note ID and track latest timestamp
    const accessMap = new Map<string, { count: number; lastAccessed: string }>();

    for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const [id, timestamp] = line.split('\t');
        if (!id) continue;

        const existing = accessMap.get(id);
        if (existing) {
            existing.count++;
            if (timestamp && timestamp > existing.lastAccessed) {
                existing.lastAccessed = timestamp;
            }
        } else {
            accessMap.set(id, { count: 1, lastAccessed: timestamp || new Date().toISOString() });
        }
    }

    // Step 3: Batch update notes
    let updated = 0;
    for (const [id, access] of accessMap) {
        // Read current note to get existing accessCount
        const note = await readNote(id);
        if (!note) continue;

        const currentCount = note.meta.accessCount || 0;
        const success = await updateNoteMeta(id, {
            accessCount: currentCount + access.count,
            lastAccessed: access.lastAccessed,
        });
        if (success) updated++;
    }

    // Step 4: Remove the processing file
    try {
        await fs.unlink(processingPath);
    } catch {
        // Best effort
    }

    return updated;
}
