import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, resolveStorageContext, type Note, type NoteMeta, type MemoryType, MEMORY_TYPES } from './config.js';

/**
 * Generate a timestamp-based unique ID.
 * Format: YYYYMMDD-HHmmss-xxxx (4-char random suffix to avoid same-second collisions)
 */
function generateId(): string {
    const d = new Date();
    const ts =
        d.getFullYear().toString() +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0') +
        '-' +
        String(d.getHours()).padStart(2, '0') +
        String(d.getMinutes()).padStart(2, '0') +
        String(d.getSeconds()).padStart(2, '0');
    const suffix = crypto.randomUUID().slice(0, 4);
    return `${ts}-${suffix}`;
}

/**
 * Get current ISO timestamp
 */
function now(): string {
    return new Date().toISOString();
}

/**
 * Parse a note markdown file into Note object
 */
export function parseNote(raw: string): Note | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const content = match[2].trim();

    const meta: Partial<NoteMeta> = {};

    for (const line of frontmatter.split('\n')) {
        const [key, ...rest] = line.split(': ');
        const value = rest.join(': ').trim();

        switch (key.trim()) {
            case 'id':
                meta.id = value;
                break;
            case 'created':
                meta.created = value;
                break;
            case 'updated':
                meta.updated = value;
                break;
            case 'source':
                meta.source = value;
                break;
            case 'type':
                if (MEMORY_TYPES.includes(value as MemoryType)) {
                    meta.type = value as MemoryType;
                }
                break;
            case 'tags':
                meta.tags = value
                    .replace(/^\[/, '')
                    .replace(/\]$/, '')
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean);
                break;
            case 'accessCount':
                meta.accessCount = parseInt(value, 10) || 0;
                break;
            case 'lastAccessed':
                meta.lastAccessed = value;
                break;
        }
    }

    if (!meta.id) return null;

    return {
        meta: {
            id: meta.id,
            created: meta.created || now(),
            updated: meta.updated || now(),
            tags: meta.tags || [],
            source: meta.source || 'unknown',
            ...(meta.type ? { type: meta.type } : {}),
            ...(meta.accessCount !== undefined ? { accessCount: meta.accessCount } : {}),
            ...(meta.lastAccessed ? { lastAccessed: meta.lastAccessed } : {}),
        },
        content,
    };
}

/**
 * Serialize a Note to markdown string
 */
export function serializeNote(note: Note): string {
    const lines = [
        '---',
        `id: ${note.meta.id}`,
        `created: ${note.meta.created}`,
        `updated: ${note.meta.updated}`,
        `tags: [${note.meta.tags.join(', ')}]`,
        `source: ${note.meta.source}`,
    ];
    if (note.meta.type) {
        lines.push(`type: ${note.meta.type}`);
    }
    if (note.meta.accessCount !== undefined && note.meta.accessCount > 0) {
        lines.push(`accessCount: ${note.meta.accessCount}`);
    }
    if (note.meta.lastAccessed) {
        lines.push(`lastAccessed: ${note.meta.lastAccessed}`);
    }
    lines.push('---', '', note.content);
    return lines.join('\n') + '\n';
}

/**
 * Save a new note to disk and return it
 */
export async function saveNote(
    content: string,
    tags: string[] = [],
    source: string = 'unknown',
    type?: MemoryType,
): Promise<Note> {
    const { notesDir } = await resolveStorageContext();
    await ensureDir(notesDir);

    const id = generateId();
    const timestamp = now();

    const note: Note = {
        meta: {
            id,
            created: timestamp,
            updated: timestamp,
            tags,
            source,
            ...(type ? { type } : {}),
        },
        content,
    };

    const filePath = path.join(notesDir, `${id}.md`);
    await fs.writeFile(filePath, serializeNote(note), 'utf-8');

    return note;
}

/**
 * Read a single note by ID
 */
export async function readNote(id: string): Promise<Note | null> {
    const { notesDir } = await resolveStorageContext();
    const filePath = path.join(notesDir, `${id}.md`);
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return parseNote(raw);
    } catch {
        return null;
    }
}

/**
 * Read all notes from disk
 */
export async function readAllNotes(): Promise<Note[]> {
    const { notesDir } = await resolveStorageContext();
    try {
        await ensureDir(notesDir);
        const files = await fs.readdir(notesDir);
        const mdFiles = files.filter((f) => f.endsWith('.md'));

        const notes: Note[] = [];
        for (const file of mdFiles) {
            const raw = await fs.readFile(path.join(notesDir, file), 'utf-8');
            const note = parseNote(raw);
            if (note) notes.push(note);
        }

        // Sort by created time, newest first
        notes.sort((a, b) => new Date(b.meta.created).getTime() - new Date(a.meta.created).getTime());

        return notes;
    } catch {
        return [];
    }
}

/**
 * Delete a note by ID
 */
export async function deleteNote(id: string): Promise<boolean> {
    const { notesDir } = await resolveStorageContext();
    const filePath = path.join(notesDir, `${id}.md`);
    try {
        await fs.unlink(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Delete multiple notes by ID
 */
export async function deleteNotes(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
        if (await deleteNote(id)) count++;
    }
    return count;
}

/**
 * Get note stats (count and total size)
 */
export async function getNoteStats(): Promise<{
    count: number;
    totalSize: number;
}> {
    const notes = await readAllNotes();
    let totalSize = 0;
    for (const note of notes) {
        totalSize += note.content.length;
    }
    return { count: notes.length, totalSize };
}

/**
 * Update metadata fields of an existing note on disk.
 * Reads the note, merges the provided meta fields, and writes it back.
 */
export async function updateNoteMeta(
    id: string,
    updates: Partial<Pick<NoteMeta, 'accessCount' | 'lastAccessed'>>,
): Promise<boolean> {
    const { notesDir } = await resolveStorageContext();
    const filePath = path.join(notesDir, `${id}.md`);
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const note = parseNote(raw);
        if (!note) return false;

        if (updates.accessCount !== undefined) {
            note.meta.accessCount = updates.accessCount;
        }
        if (updates.lastAccessed !== undefined) {
            note.meta.lastAccessed = updates.lastAccessed;
        }

        await fs.writeFile(filePath, serializeNote(note), 'utf-8');
        return true;
    } catch {
        return false;
    }
}

/**
 * Move a note file to the archive directory.
 * Returns true if moved successfully, false otherwise.
 */
export async function archiveNote(id: string): Promise<boolean> {
    const { dataDir, notesDir } = await resolveStorageContext();
    const srcPath = path.join(notesDir, `${id}.md`);
    const archiveDir = path.join(dataDir, 'archive');
    const destPath = path.join(archiveDir, `${id}.md`);
    try {
        await ensureDir(archiveDir);
        await fs.rename(srcPath, destPath);
        return true;
    } catch {
        return false;
    }
}
