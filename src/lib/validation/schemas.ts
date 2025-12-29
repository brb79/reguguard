/**
 * Request Validation Schemas
 * 
 * Zod schemas for validating API request payloads
 */

import { z } from 'zod';

// Common schemas
export const uuidSchema = z.string().uuid();
export const phoneNumberSchema = z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

// Client schemas
export const clientIdSchema = uuidSchema;
export const createClientSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  winteam_tenant_id: z.string().min(1, 'WinTeam tenant ID is required'),
  location_ids: z.array(z.number()).default([]),
  alert_config: z.object({
    thresholds: z.array(z.number().positive()).default([30, 14, 7]),
    escalationEmails: z.array(z.string().email()).default([]),
    reminderFrequency: z.enum(['daily', 'weekly']).default('daily'),
  }).optional(),
  sms_enabled: z.boolean().default(false),
});

// Employee schemas
export const employeeIdSchema = uuidSchema;
export const employeeNumberSchema = z.number().int().positive();

// License schemas
export const licenseIdSchema = uuidSchema;
export const complianceIdSchema = z.number().int().positive();

// Alert schemas
export const alertIdSchema = uuidSchema;
export const alertTypeSchema = z.enum(['expiring_30d', 'expiring_14d', 'expiring_7d', 'expired']);
export const alertStatusSchema = z.enum(['pending', 'sent', 'acknowledged', 'failed']);

export const sendAlertsSchema = z.object({
  client_id: clientIdSchema,
  alert_ids: z.array(alertIdSchema).optional(),
  dry_run: z.boolean().default(false),
});

// Sync schemas
export const syncRequestSchema = z.object({
  client_id: clientIdSchema,
});

// Renewal schemas
export const renewalIdSchema = uuidSchema;
export const renewalActionSchema = z.enum(['approve', 'reject', 'retry_sync']);

export const renewalActionRequestSchema = z.object({
  renewalId: renewalIdSchema,
  action: renewalActionSchema,
  notes: z.string().optional(),
});

// Query parameter schemas
export const expiringLicensesQuerySchema = z.object({
  client_id: clientIdSchema,
  days: z.coerce.number().int().positive().max(365).default(30),
});

export const pendingRenewalsQuerySchema = z.object({
  client_id: clientIdSchema.optional(),
  status: z.enum(['pending', 'confirmed', 'synced', 'all']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// SMS webhook schemas
export const twilioWebhookSchema = z.object({
  MessageSid: z.string(),
  AccountSid: z.string(),
  From: phoneNumberSchema,
  To: phoneNumberSchema,
  Body: z.string().optional(),
  NumMedia: z.string().optional(),
});

