-- ReguGuard Database Schema
-- Migration: 010_fix_search_path.sql
-- Purpose: Fix "mutable search_path" warning by explicitly setting search_path
-- This prevents potential security issues where the function could be tricked
-- into using objects from a malicious schema.

-- ============================================================================
-- Update function to have a fixed search_path
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql' SET search_path = public;
