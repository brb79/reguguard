/**
 * Web Scraper for State Regulatory Websites
 * 
 * Fetches content from state regulatory websites for AI extraction
 */

import type { WebScrapingResult } from './types';

export class StateRequirementsScraper {
    /**
     * Fetch content from a regulatory website URL
     */
    async scrapeUrl(url: string): Promise<WebScrapingResult> {
        try {
            // Fetch the webpage
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ReguGuard/1.0; +https://reguguard.com/bot)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                // Add timeout
                signal: AbortSignal.timeout(30000), // 30 second timeout
            });

            if (!response.ok) {
                return {
                    url,
                    success: false,
                    content: '',
                    error: `HTTP ${response.status}: ${response.statusText}`,
                };
            }

            const html = await response.text();

            // Extract text content (basic HTML stripping)
            const textContent = this.extractTextFromHtml(html);

            return {
                url,
                success: true,
                content: textContent,
            };
        } catch (error) {
            return {
                url,
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Scrape multiple URLs in parallel
     */
    async scrapeUrls(urls: string[]): Promise<WebScrapingResult[]> {
        const results = await Promise.all(
            urls.map(url => this.scrapeUrl(url))
        );
        return results;
    }

    /**
     * Extract text content from HTML (basic implementation)
     * For production, consider using a proper HTML parser like cheerio or jsdom
     */
    private extractTextFromHtml(html: string): string {
        // Remove script and style tags
        let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

        // Remove HTML tags but preserve structure
        text = text
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Decode common HTML entities
        text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        return text;
    }

    /**
     * Get primary sources for a state based on metadata
     */
    getSourcesForState(metadata: { regulatory_body?: { website?: string; licensing_portal?: string }; sources?: Array<{ url: string }> }): string[] {
        const sources: string[] = [];

        if (metadata.regulatory_body?.website) {
            sources.push(metadata.regulatory_body.website);
        }

        if (metadata.regulatory_body?.licensing_portal) {
            sources.push(metadata.regulatory_body.licensing_portal);
        }

        if (metadata.sources) {
            for (const source of metadata.sources) {
                if (source.url && !sources.includes(source.url)) {
                    sources.push(source.url);
                }
            }
        }

        return sources;
    }
}

export const stateRequirementsScraper = new StateRequirementsScraper();

