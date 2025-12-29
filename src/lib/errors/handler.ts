/**
 * Centralized Error Handling
 * 
 * Provides structured error handling with proper HTTP status codes,
 * error tracking, and logging.
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

// Custom error classes
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(
    service: string,
    message: string,
    public originalError?: Error
  ) {
    super(`External service error (${service}): ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
    this.name = 'ExternalServiceError';
  }
}

/**
 * Generate correlation ID for request tracking
 */
export function generateCorrelationId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Structured error response
 */
export interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    details?: unknown;
    correlationId?: string;
  };
  timestamp: string;
}

/**
 * Handle errors and return appropriate response
 */
export function handleError(
  error: unknown,
  correlationId?: string
): NextResponse<ErrorResponse> {
  // Log error
  console.error(`[${correlationId || 'unknown'}] Error:`, error);

  // Handle known error types
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          message: error.message,
          code: error.code,
          details: error.details,
          correlationId,
        },
        timestamp: new Date().toISOString(),
      },
      { status: error.statusCode }
    );
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: error.errors,
          correlationId,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 }
    );
  }

  // Handle generic errors
  const message = error instanceof Error ? error.message : 'Internal server error';
  const isProduction = process.env.NODE_ENV === 'production';

  return NextResponse.json(
    {
      error: {
        message: isProduction ? 'Internal server error' : message,
        code: 'INTERNAL_ERROR',
        details: isProduction ? undefined : { stack: error instanceof Error ? error.stack : undefined },
        correlationId,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 500 }
  );
}

/**
 * Wrapper for API route handlers with error handling
 */
export function withErrorHandling<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>
) {
  return async (...args: T): Promise<NextResponse> => {
    const correlationId = generateCorrelationId();
    
    try {
      const response = await handler(...args);
      
      // Add correlation ID to response headers
      response.headers.set('x-correlation-id', correlationId);
      
      return response;
    } catch (error) {
      return handleError(error, correlationId);
    }
  };
}

