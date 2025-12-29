/**
 * Environment Variable Validation
 * 
 * Validates all required environment variables at application startup.
 * Fails fast with descriptive errors if any required variables are missing.
 */

import { z } from 'zod';

// Schema for environment variables
const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required').optional(),

  // Twilio (optional for development)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Google Gemini (optional for development)
  GOOGLE_AI_API_KEY: z.string().optional(),

  // WinTeam (optional - can be per-client)
  WINTEAM_API_URL: z.string().url().optional().or(z.literal('')),
  WINTEAM_TENANT_ID: z.string().optional(),

  // App URL (optional for development)
  NEXT_PUBLIC_APP_URL: z.string().url().optional().or(z.literal('')),

  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Type-safe environment variables
export type Env = z.infer<typeof envSchema>;

// Validated environment variables (will throw if invalid)
let validatedEnv: Env | null = null;

/**
 * Get validated environment variables
 * Validates on first call and caches the result
 */
export function getEnv(): Env {
  if (validatedEnv) {
    return validatedEnv;
  }

  const rawEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
    WINTEAM_API_URL: process.env.WINTEAM_API_URL,
    WINTEAM_TENANT_ID: process.env.WINTEAM_TENANT_ID,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NODE_ENV: process.env.NODE_ENV || 'development',
  };

  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const errors = result.error.errors.map((err) =>
      `  - ${err.path.join('.')}: ${err.message}`
    ).join('\n');

    throw new Error(
      `❌ Invalid environment variables:\n${errors}\n\n` +
      `Please check your .env file or environment configuration.`
    );
  }

  validatedEnv = result.data;
  return validatedEnv;
}

/**
 * Check if a service is configured
 */
export const envChecks = {
  isSupabaseConfigured: () => {
    const env = getEnv();
    return !!env.NEXT_PUBLIC_SUPABASE_URL && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  },

  isTwilioConfigured: () => {
    const env = getEnv();
    return !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN && !!env.TWILIO_PHONE_NUMBER;
  },

  isVisionConfigured: () => {
    const env = getEnv();
    return !!env.GOOGLE_AI_API_KEY;
  },

  isWinTeamConfigured: () => {
    const env = getEnv();
    return !!env.WINTEAM_API_URL && !!env.WINTEAM_TENANT_ID;
  },

  isProduction: () => {
    const env = getEnv();
    return env.NODE_ENV === 'production';
  },
};

/**
 * Validate environment on module load (for server-side code)
 * This will throw immediately if environment is invalid
 */
if (typeof window === 'undefined') {
  try {
    getEnv();
  } catch (error) {
    // In development, log the error but don't crash
    // In production, we want to fail fast
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
    console.warn('⚠️  Environment validation warning:', error instanceof Error ? error.message : error);
  }
}

