/**
 * Q&A Cache Service - Persistent caching for compliance Q&A responses
 *
 * Caches high-confidence answers to reduce API costs and improve response speed.
 * Uses Supabase for persistent storage with configurable TTL.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { createHash } from 'crypto';
import type { ComplianceQAResult } from './compliance-qa-service';

// ============================================================================
// Types
// ============================================================================

export interface CachedQAResponse {
    answer: string;
    sources: string[];
    confidence: number;
    hitCount: number;
    createdAt: Date;
}

export interface CacheStats {
    hitRate: number;
    totalCached: number;
    avgConfidence: number;
}

// ============================================================================
// Service Class
// ============================================================================

class QACacheService {
    private supabase = createAdminClient();
    private static instance: QACacheService;

    private constructor() {}

    /**
     * Get singleton instance
     */
    static getInstance(): QACacheService {
        if (!QACacheService.instance) {
            QACacheService.instance = new QACacheService();
        }
        return QACacheService.instance;
    }

    /**
     * Generate a cache key fingerprint from question components
     * Normalizes question text to improve cache hit rate
     */
    private generateCacheKey(
        question: string,
        stateCode: string,
        licenseType?: string
    ): string {
        // Normalize question: lowercase, remove punctuation, trim whitespace
        const normalized = question
            .toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ')     // Normalize whitespace
            .trim();

        // Create composite key
        const compositeKey = `${normalized}|${stateCode.toUpperCase()}|${licenseType || ''}`;

        // Hash using SHA-256 and take first 16 characters
        const hash = createHash('sha256').update(compositeKey).digest('hex');
        return hash.substring(0, 16);
    }

    /**
     * Get cached response if it exists and hasn't expired
     */
    async get(
        question: string,
        stateCode: string,
        licenseType?: string
    ): Promise<CachedQAResponse | null> {
        try {
            const fingerprint = this.generateCacheKey(question, stateCode, licenseType);

            let query = this.supabase
                .from('compliance_qa_cache')
                .select('answer, sources, confidence, hit_count, created_at, expires_at')
                .eq('question_fingerprint', fingerprint)
                .eq('state_code', stateCode.toUpperCase())
                .gt('expires_at', new Date().toISOString());

            if (licenseType) {
                query = query.eq('license_type', licenseType);
            } else {
                query = query.is('license_type', null);
            }

            const { data, error } = await query.single();

            if (error || !data) {
                return null;
            }

            // Increment hit counter asynchronously (don't await)
            this.recordHit(fingerprint, stateCode, licenseType).catch(err =>
                console.error('[QACache] Failed to record hit:', err)
            );

            const typedData = data as any;
            return {
                answer: typedData.answer,
                sources: Array.isArray(typedData.sources) ? typedData.sources : [],
                confidence: typedData.confidence,
                hitCount: typedData.hit_count,
                createdAt: new Date(typedData.created_at),
            };
            };
        } catch (error) {
            console.error('[QACache] Error getting cached response:', error);
            return null;
        }
    }

    /**
     * Store a response in the cache
     * Only caches responses with confidence >= 0.6
     */
    async set(
        question: string,
        stateCode: string,
        result: ComplianceQAResult,
        licenseType?: string,
        ttlDays: number = 7
    ): Promise<void> {
        try {
            // Only cache successful, high-confidence responses
            if (!result.success || result.confidence < 0.6) {
                return;
            }

            const fingerprint = this.generateCacheKey(question, stateCode, licenseType);
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + ttlDays);

            const { error } = await this.supabase
                .from('compliance_qa_cache')
                .upsert(
                    {
                        question_fingerprint: fingerprint,
                        state_code: stateCode.toUpperCase(),
                        license_type: licenseType || null,
                        answer: result.answer,
                        sources: result.sources,
                        confidence: result.confidence,
                        expires_at: expiresAt.toISOString(),
                        last_accessed_at: new Date().toISOString(),
                        hit_count: 0,
                    } as any,
                    {
                        onConflict: 'question_fingerprint,state_code,license_type',
                        ignoreDuplicates: false,
                    }
                );

            if (error) {
                console.error('[QACache] Error caching response:', error);
            }
        } catch (error) {
            console.error('[QACache] Error in set():', error);
        }
    }

    /**
     * Increment hit counter when cached response is used
     */
    async recordHit(
        fingerprint: string,
        stateCode: string,
        licenseType?: string
    ): Promise<void> {
        try {
            await (this.supabase as any).rpc('increment_qa_cache_hit', {
                p_fingerprint: fingerprint,
                p_state_code: stateCode.toUpperCase(),
                p_license_type: licenseType || null,
            });
        } catch (error) {
            // Fallback to manual increment if RPC doesn't exist
            let updateQuery = this.supabase
                .from('compliance_qa_cache')
                .update({
                    last_accessed_at: new Date().toISOString(),
                })
                .eq('question_fingerprint', fingerprint)
                .eq('state_code', stateCode.toUpperCase());

            if (licenseType) {
                updateQuery = updateQuery.eq('license_type', licenseType);
            } else {
                updateQuery = updateQuery.is('license_type', null);
            }

            const { error: updateError } = await updateQuery;

            if (updateError) {
                console.error('[QACache] Error recording hit:', updateError);
            }
        }
    }

    /**
     * Clean up expired cache entries
     * Returns number of entries deleted
     */
    async cleanup(): Promise<number> {
        try {
            const { data, error } = await this.supabase
                .from('compliance_qa_cache')
                .delete()
                .lt('expires_at', new Date().toISOString())
                .select('id');

            if (error) {
                console.error('[QACache] Error during cleanup:', error);
                return 0;
            }

            return data?.length || 0;
        } catch (error) {
            console.error('[QACache] Error in cleanup():', error);
            return 0;
        }
    }

    /**
     * Get cache statistics for analytics
     */
    async getStats(): Promise<CacheStats> {
        try {
            const { data: totalData } = await this.supabase
                .from('compliance_qa_cache')
                .select('id, confidence, hit_count')
                .gt('expires_at', new Date().toISOString());

            if (!totalData || totalData.length === 0) {
                return { hitRate: 0, totalCached: 0, avgConfidence: 0 };
            }

            const data: any[] = totalData;
            const totalCached = data.length;
            const totalHits = data.reduce((sum: number, row: any) => sum + row.hit_count, 0);
            const avgConfidence =
                data.reduce((sum: number, row: any) => sum + row.confidence, 0) / totalCached;

            // Hit rate = (total hits) / (total cached entries + total hits)
            // This represents cache effectiveness
            const hitRate = totalCached + totalHits > 0
                ? (totalHits / (totalCached + totalHits)) * 100
                : 0;

            return {
                hitRate: Math.round(hitRate * 100) / 100,
                totalCached,
                avgConfidence: Math.round(avgConfidence * 100) / 100,
            };
        } catch (error) {
            console.error('[QACache] Error getting stats:', error);
            return { hitRate: 0, totalCached: 0, avgConfidence: 0 };
        }
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const qaCacheService = QACacheService.getInstance();
