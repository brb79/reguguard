-- ReguGuard Database Schema
-- Migration: 009_fix_security_definer_views.sql
-- Purpose: Fix "security definer" issues by explicitly setting security_invoker = true
-- This ensures views use the permissions of the querying user (preserving RLS)
-- rather than the view owner.

-- ============================================================================
-- Update views to use security_invoker = true
-- ============================================================================

-- Fix licenses_with_expiry view
ALTER VIEW licenses_with_expiry SET (security_invoker = true);

-- Fix pending_renewals_dashboard view
ALTER VIEW pending_renewals_dashboard SET (security_invoker = true);

-- Fix active_conversations view
ALTER VIEW active_conversations SET (security_invoker = true);
