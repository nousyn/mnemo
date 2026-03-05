import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

/**
 * Supported agent tool types
 */
export const AGENT_TYPES = ['opencode', 'claude-code', 'openclaw', 'codex'] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

/**
 * Get platform-appropriate data directory for Mnemo.
 *
 * Follows platform conventions:
 * - macOS:   ~/Library/Application Support/mnemo
 * - Linux:   $XDG_DATA_HOME/mnemo  (defaults to ~/.local/share/mnemo)
 * - Windows: %APPDATA%/mnemo
 *
 * Can be overridden via MNEMO_DATA_DIR env var.
 */
export function getDataDir(): string {
    const envDir = process.env.MNEMO_DATA_DIR;
    if (envDir) return envDir;

    const platform = process.platform;
    const home = os.homedir();

    switch (platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'mnemo');
        case 'win32':
            return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'mnemo');
        default:
            // Linux and others: follow XDG Base Directory spec
            return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'mnemo');
    }
}

/**
 * Get the notes directory
 */
export function getNotesDir(): string {
    return path.join(getDataDir(), 'notes');
}

/**
 * Get the vector index directory
 */
export function getIndexDir(): string {
    return path.join(getDataDir(), 'index');
}

/**
 * Ensure a directory exists
 */
export async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

/**
 * Memory note metadata
 */
export interface NoteMeta {
    id: string;
    created: string;
    updated: string;
    tags: string[];
    source: string;
}

/**
 * Memory note (metadata + content)
 */
export interface Note {
    meta: NoteMeta;
    content: string;
}

/**
 * Compress trigger thresholds
 */
export const COMPRESS_THRESHOLDS = {
    /** Max number of notes before auto-compress suggestion */
    maxNotes: 50,
    /** Max total content size (chars) before auto-compress suggestion */
    maxTotalSize: 100_000,
} as const;
