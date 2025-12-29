import { createClient } from '@supabase/supabase-js';
import { Database } from './types';
import { getEnv } from '@/lib/env';

/**
 * Creates a Supabase client with the service role key.
 * This client bypasses Row Level Security (RLS) and should only
 * be used on the server for administrative operations.
 */
export function createAdminClient() {
    const env = getEnv();

    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
        console.warn('SUPABASE_SERVICE_ROLE_KEY is not set. Admin client will fallback to anon key and may be restricted by RLS.');
        return createClient<Database>(
            supabaseUrl,
            env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );
    }

    return createClient<Database>(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
