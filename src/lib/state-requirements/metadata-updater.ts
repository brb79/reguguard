/**
 * Metadata File Updater
 * 
 * Updates metadata.json files in the knowledge/states directory
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type { StateMetadata } from './types';

export class MetadataUpdater {
    private basePath: string;

    constructor(basePath?: string) {
        // Default to knowledge/states relative to project root
        this.basePath = basePath || join(process.cwd(), 'knowledge', 'states');
    }

    /**
     * Read existing metadata for a state
     */
    async readMetadata(stateCode: string): Promise<StateMetadata | null> {
        try {
            const filePath = join(this.basePath, stateCode.toUpperCase(), 'metadata.json');
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content) as StateMetadata;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null; // File doesn't exist yet
            }
            throw error;
        }
    }

    /**
     * Write metadata to file
     */
    async writeMetadata(stateCode: string, metadata: StateMetadata): Promise<void> {
        const stateDir = join(this.basePath, stateCode.toUpperCase());
        const filePath = join(stateDir, 'metadata.json');

        // Ensure directory exists
        await fs.mkdir(stateDir, { recursive: true });

        // Update last_verified date
        metadata.last_verified = new Date().toISOString().split('T')[0];

        // Write file with pretty formatting
        await fs.writeFile(
            filePath,
            JSON.stringify(metadata, null, 2) + '\n',
            'utf-8'
        );
    }

    /**
     * Create a snapshot of current metadata (for change tracking)
     */
    async createSnapshot(stateCode: string): Promise<StateMetadata | null> {
        return this.readMetadata(stateCode);
    }
}

export const metadataUpdater = new MetadataUpdater();

