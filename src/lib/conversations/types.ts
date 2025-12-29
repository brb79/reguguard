/**
 * Conversation Types
 */

import { ConversationStatus } from '../supabase/types';
import type { ConversationMessage } from '../ai/nlp-service';

export interface ConversationContext {
    conversationId: string;
    employeeId: string;
    licenseId: string;
    clientId: string;
    phoneNumber: string;
    employeeName: string;
    licenseName: string;
    winteamEmployeeNumber: number;
    winteamComplianceId: number;
}

export interface ProcessPhotoResult {
    success: boolean;
    expirationDate: string | null;
    licenseNumber: string | null;
    confidence: number;
    error?: string;
}

export interface SyncResult {
    success: boolean;
    error?: string;
    winteamResponse?: object;
}

export interface ConversationStateTransition {
    from: ConversationStatus;
    to: ConversationStatus;
    trigger: string;
    timestamp: Date;
}

// Valid state transitions
export const VALID_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
    'awaiting_photo': ['processing', 'expired', 'failed'],
    'processing': ['awaiting_confirmation', 'rejected', 'failed'],
    'awaiting_confirmation': ['confirmed', 'rejected', 'expired', 'failed'],
    'confirmed': ['completed', 'failed'],
    'completed': [], // Terminal state
    'rejected': ['processing', 'expired', 'failed'], // Can submit new photo
    'expired': [], // Terminal state
    'failed': [], // Terminal state
};

// Re-export types from NLP service for convenience
export type { ConversationMessage } from '../ai/nlp-service';
