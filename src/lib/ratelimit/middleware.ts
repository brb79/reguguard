/**
 * Rate Limiting Middleware
 * 
 * Provides rate limiting for API routes to prevent abuse.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Initialize Redis client (optional - falls back to in-memory if not configured)
let redis: Redis | null = null;
let ratelimit: Ratelimit | null = null;

try {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    redis = new Redis({
      url: upstashUrl,
      token: upstashToken,
    });

    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '10 s'), // Default: 10 requests per 10 seconds
      analytics: true,
    });
  }
} catch (error) {
  console.warn('Rate limiting not configured. UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required.');
}

/**
 * In-memory rate limiter fallback (for development)
 */
class InMemoryRateLimiter {
  private requests: Map<string, number[]> = new Map();

  async limit(
    identifier: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const key = identifier;

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const timestamps = this.requests.get(key)!;
    
    // Remove old timestamps outside the window
    const cutoff = now - windowMs;
    const recent = timestamps.filter((ts) => ts > cutoff);
    
    if (recent.length >= limit) {
      const oldest = Math.min(...recent);
      const reset = oldest + windowMs;
      return {
        success: false,
        limit,
        remaining: 0,
        reset: Math.floor(reset / 1000),
      };
    }

    recent.push(now);
    this.requests.set(key, recent);

    // Clean up old entries periodically
    if (Math.random() < 0.01) {
      for (const [k, v] of this.requests.entries()) {
        const filtered = v.filter((ts) => ts > cutoff);
        if (filtered.length === 0) {
          this.requests.delete(k);
        } else {
          this.requests.set(k, filtered);
        }
      }
    }

    return {
      success: true,
      limit,
      remaining: limit - recent.length,
      reset: Math.floor((now + windowMs) / 1000),
    };
  }
}

const inMemoryLimiter = new InMemoryRateLimiter();

/**
 * Get identifier for rate limiting (IP address or user ID)
 */
function getIdentifier(request: NextRequest): string {
  // Try to get user ID from headers (set by auth middleware)
  const userId = request.headers.get('x-user-id');
  if (userId) {
    return `user:${userId}`;
  }

  // Fall back to IP address
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 
             request.headers.get('x-real-ip') || 
             'unknown';
  
  return `ip:${ip}`;
}

/**
 * Rate limit middleware
 */
export async function rateLimit(
  request: NextRequest,
  options: {
    limit?: number;
    windowSeconds?: number;
    identifier?: string;
  } = {}
): Promise<NextResponse | null> {
  const limit = options.limit || 10;
  const windowSeconds = options.windowSeconds || 10;
  const identifier = options.identifier || getIdentifier(request);

  let result;

  if (ratelimit) {
    // Use Upstash Redis
    result = await ratelimit.limit(identifier);
  } else {
    // Use in-memory fallback
    result = await inMemoryLimiter.limit(identifier, limit, windowSeconds);
  }

  if (!result.success) {
    return NextResponse.json(
      {
        error: {
          message: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          limit: result.limit,
          reset: result.reset,
        },
        timestamp: new Date().toISOString(),
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': result.limit.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': result.reset.toString(),
          'Retry-After': Math.ceil(result.reset - Date.now() / 1000).toString(),
        },
      }
    );
  }

  // Add rate limit headers to successful requests
  const response = new NextResponse();
  response.headers.set('X-RateLimit-Limit', result.limit.toString());
  response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
  response.headers.set('X-RateLimit-Reset', result.reset.toString());

  return null; // Continue to next handler
}

/**
 * Pre-configured rate limiters for different endpoints
 */
export const rateLimiters = {
  // Webhook endpoints (more lenient)
  webhook: (request: NextRequest) => rateLimit(request, { limit: 100, windowSeconds: 60 }),
  
  // Standard API endpoints
  standard: (request: NextRequest) => rateLimit(request, { limit: 30, windowSeconds: 60 }),
  
  // Strict endpoints (sync, etc.)
  strict: (request: NextRequest) => rateLimit(request, { limit: 10, windowSeconds: 60 }),
};

