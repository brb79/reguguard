/**
 * Authentication & Authorization Middleware
 * 
 * Provides middleware functions for protecting API routes with authentication
 * and authorization checks.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEnv } from '@/lib/env';

// API Key for service-to-service authentication
const API_KEY_HEADER = 'x-api-key';
const API_KEY = process.env.REGUGUARD_API_KEY;

/**
 * Authentication result
 */
export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  clientId?: string;
  error?: string;
  statusCode?: number;
}

/**
 * Authenticate request using Supabase session or API key
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<AuthResult> {
  // Check for API key first (service-to-service)
  const apiKey = request.headers.get(API_KEY_HEADER);
  if (API_KEY && apiKey === API_KEY) {
    return { authenticated: true };
  }

  // Check for Supabase session
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        authenticated: false,
        error: 'Unauthorized: Invalid or missing authentication',
        statusCode: 401,
      };
    }

    // Get user's client_id from metadata or profile
    // This assumes you have a user profile table or store client_id in user metadata
    const clientId = user.user_metadata?.client_id;

    return {
      authenticated: true,
      userId: user.id,
      clientId,
    };
  } catch (error) {
    return {
      authenticated: false,
      error: 'Authentication error',
      statusCode: 500,
    };
  }
}

/**
 * Middleware to require authentication
 */
export function requireAuth() {
  return async (request: NextRequest): Promise<NextResponse | null> => {
    const auth = await authenticateRequest(request);

    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: auth.statusCode || 401 }
      );
    }

    // Attach auth info to request headers for downstream use
    const requestHeaders = new Headers(request.headers);
    if (auth.userId) {
      requestHeaders.set('x-user-id', auth.userId);
    }
    if (auth.clientId) {
      requestHeaders.set('x-client-id', auth.clientId);
    }

    return null; // Continue to next handler
  };
}

/**
 * Middleware to require specific client access
 */
export function requireClientAccess(clientIdParam: string = 'client_id') {
  return async (request: NextRequest): Promise<NextResponse | null> => {
    const auth = await authenticateRequest(request);

    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: auth.statusCode || 401 }
      );
    }

    // Get client_id from request (query param, body, or auth context)
    const url = new URL(request.url);
    const clientIdFromQuery = url.searchParams.get(clientIdParam);

    let requestClientId: string | null = null;
    try {
      const body = await request.clone().json().catch(() => ({}));
      requestClientId = body[clientIdParam] || clientIdFromQuery;
    } catch {
      requestClientId = clientIdFromQuery;
    }

    // If client_id is specified, verify user has access to it
    if (requestClientId) {
      // If user has a client_id, they can only access that client
      if (auth.clientId && auth.clientId !== requestClientId) {
        return NextResponse.json(
          { error: 'Forbidden: Access denied to this client' },
          { status: 403 }
        );
      }
    }

    // Attach auth info to request
    const requestHeaders = new Headers(request.headers);
    if (auth.userId) {
      requestHeaders.set('x-user-id', auth.userId);
    }
    if (auth.clientId) {
      requestHeaders.set('x-client-id', auth.clientId);
    }

    return null;
  };
}

/**
 * Helper to get authenticated user info from request
 */
export async function getAuthContext(request: NextRequest): Promise<{
  userId?: string;
  clientId?: string;
  isApiKey: boolean;
}> {
  const userId = request.headers.get('x-user-id');
  const clientId = request.headers.get('x-client-id');
  const apiKey = request.headers.get(API_KEY_HEADER);

  return {
    userId: userId || undefined,
    clientId: clientId || undefined,
    isApiKey: !!apiKey && apiKey === API_KEY,
  };
}

