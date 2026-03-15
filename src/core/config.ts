import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

/**
 * Agent types and client name mapping — re-exported from @s_s/agent-kit.
 */
export { AGENT_TYPES, CLIENT_NAME_MAP, type AgentType } from '@s_s/agent-kit';

export type StorageScope = 'global' | 'project';

/**
 * Memory type categories for the minimal constraint mechanism.
 * Each memory should be classified into one of these types before saving.
 */
export const MEMORY_TYPES = [
    'preference',
    'profile',
    'goal',
    'continuity',
    'fact',
    'decision',
    'rule',
    'experience',
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface StorageContext {
    scope: StorageScope;
    dataDir: string;
    notesDir: string;
    indexDir: string;
    configPath: string;
}

interface StorageConfigFile {
    version: number;
    scope: StorageScope;
    createdAt: string;
    eviction: EvictionConfig;
}

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
 * Get the global storage config path
 */
export function getGlobalConfigPath(): string {
    return path.join(getDataDir(), 'config.json');
}

/**
 * Get the project storage root directory
 */
export function getProjectDataDir(projectRoot: string): string {
    return path.join(projectRoot, '.mnemo');
}

/**
 * Get the project storage config path
 */
export function getProjectConfigPath(projectRoot: string): string {
    return path.join(getProjectDataDir(projectRoot), 'config.json');
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

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Write the storage initialization marker.
 * Includes eviction defaults so users can edit config.json directly.
 */
export async function writeStorageConfig(scope: StorageScope, projectRoot?: string): Promise<string> {
    const configPath = scope === 'project' ? getProjectConfigPath(projectRoot || process.cwd()) : getGlobalConfigPath();

    const config: StorageConfigFile = {
        version: 1,
        scope,
        createdAt: new Date().toISOString(),
        eviction: {
            enabled: true,
            maxNotes: 100,
            evictBatch: 10,
            archive: true,
        },
    };

    await ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, JSON.stringify(config, null, 4) + '\n', 'utf-8');

    return configPath;
}

/**
 * Read eviction config from the active config.json.
 * Requires setup to have been run (config.json must contain eviction section).
 */
export async function readEvictionConfig(): Promise<EvictionConfig> {
    const { configPath } = await resolveStorageContext();
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as StorageConfigFile;
    return parsed.eviction;
}

/**
 * Find the nearest project storage config by walking up from cwd.
 */
export async function findProjectConfig(startDir: string): Promise<string | null> {
    let current = path.resolve(startDir);

    while (true) {
        const configPath = getProjectConfigPath(current);
        if (await pathExists(configPath)) {
            return configPath;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

/**
 * Resolve the active storage context for the current working directory.
 * Project storage has priority over global storage.
 */
export async function resolveStorageContext(cwd: string = process.cwd()): Promise<StorageContext> {
    const projectConfigPath = await findProjectConfig(cwd);
    if (projectConfigPath) {
        const dataDir = path.dirname(projectConfigPath);
        return {
            scope: 'project',
            dataDir,
            notesDir: path.join(dataDir, 'notes'),
            indexDir: path.join(dataDir, 'index'),
            configPath: projectConfigPath,
        };
    }

    const globalConfigPath = getGlobalConfigPath();
    if (await pathExists(globalConfigPath)) {
        const dataDir = getDataDir();
        return {
            scope: 'global',
            dataDir,
            notesDir: path.join(dataDir, 'notes'),
            indexDir: path.join(dataDir, 'index'),
            configPath: globalConfigPath,
        };
    }

    throw new Error('Mnemo is not initialized in the current environment. Run `npx @s_s/mnemo setup` first.');
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
    type?: MemoryType;
    accessCount?: number;
    lastAccessed?: string;
}

/**
 * Memory note (metadata + content)
 */
export interface Note {
    meta: NoteMeta;
    content: string;
}

/**
 * Eviction configuration for passive memory lifecycle management.
 * When note count exceeds maxNotes, the lowest-scored notes are
 * archived (or deleted) to keep the active set focused.
 *
 * Stored in config.json under the "eviction" key. Users can edit directly.
 */
export interface EvictionConfig {
    /** Whether passive eviction is enabled. */
    enabled: boolean;
    /** Maximum number of active notes before eviction triggers. */
    maxNotes: number;
    /** Extra notes to evict beyond the overflow (reduces trigger frequency). */
    evictBatch: number;
    /** Move evicted notes to archive/ instead of deleting. */
    archive: boolean;
}
