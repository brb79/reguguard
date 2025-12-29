import twilio from 'twilio';
import { envChecks, getEnv } from '@/lib/env';

export interface SMSMessage {
    to: string;
    body: string;
}

export interface SMSResult {
    success: boolean;
    messageSid?: string;
    error?: string;
}

function splitSmsMessage(body: string, maxLength: number): string[] {
    const trimmed = body.trim();
    if (trimmed.length <= maxLength) {
        return [trimmed];
    }

    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    const parts: string[] = [];
    let current = '';

    for (const sentence of sentences) {
        if (!sentence) continue;
        if (sentence.length > maxLength) {
            if (current) {
                parts.push(current.trim());
                current = '';
            }
            for (let i = 0; i < sentence.length; i += maxLength) {
                parts.push(sentence.slice(i, i + maxLength).trim());
            }
            continue;
        }

        if (!current) {
            current = sentence;
            continue;
        }

        if (current.length + sentence.length + 1 <= maxLength) {
            current = `${current} ${sentence}`;
        } else {
            parts.push(current.trim());
            current = sentence;
        }
    }

    if (current.trim()) {
        parts.push(current.trim());
    }

    return parts.length > 0 ? parts : [trimmed];
}

class SMSService {
    private client: twilio.Twilio | null = null;
    private fromNumber: string;

    constructor() {
        try {
            const env = getEnv();
            const accountSid = env.TWILIO_ACCOUNT_SID;
            const authToken = env.TWILIO_AUTH_TOKEN;
            this.fromNumber = env.TWILIO_PHONE_NUMBER || '';

            if (accountSid && authToken) {
                this.client = twilio(accountSid, authToken);
            }
        } catch (error) {
            // Environment not validated yet, use process.env as fallback
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';

            if (accountSid && authToken) {
                this.client = twilio(accountSid, authToken);
            }
        }
    }

    /**
     * Send an SMS message
     */
    async send(message: SMSMessage): Promise<SMSResult> {
        if (!this.client) {
            console.warn('Twilio not configured, SMS not sent');
            return { success: false, error: 'Twilio not configured' };
        }

        try {
            const result = await this.client.messages.create({
                body: message.body,
                from: this.fromNumber,
                to: message.to,
            });

            return {
                success: true,
                messageSid: result.sid,
            };
        } catch (error) {
            console.error('SMS send error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Send a long message split into multiple SMS segments.
     */
    async sendLong(message: SMSMessage, maxLength: number = 153): Promise<SMSResult[]> {
        const parts = splitSmsMessage(message.body, maxLength);
        const results: SMSResult[] = [];

        for (const part of parts) {
            results.push(await this.send({ ...message, body: part }));
        }

        return results;
    }

    /**
     * Check if SMS is configured
     */
    isConfigured(): boolean {
        return envChecks.isTwilioConfigured() && this.client !== null && this.fromNumber !== '';
    }
}

// Export singleton
export const smsService = new SMSService();

// Alert message templates
export const alertTemplates = {
    expiring_30d: (data: { licenseName: string; days: number; expirationDate: string }) =>
        `ReguGuard Alert: Your ${data.licenseName} expires in ${data.days} days (${data.expirationDate}). ` +
        `Start your renewal process now to avoid lapses. Reply HELP for renewal steps.`,

    expiring_14d: (data: { licenseName: string; days: number; expirationDate: string }) =>
        `ReguGuard REMINDER: Your ${data.licenseName} expires in ${data.days} days (${data.expirationDate}). ` +
        `Please contact your supervisor to complete renewal. Reply HELP for assistance.`,

    expiring_7d: (data: { licenseName: string; days: number; expirationDate: string }) =>
        `URGENT ReguGuard: Your ${data.licenseName} expires in ${data.days} days! ` +
        `Contact your supervisor IMMEDIATELY to complete renewal. Reply HELP for assistance.`,

    expired: (data: { licenseName: string; expirationDate: string }) =>
        `ALERT ReguGuard: Your ${data.licenseName} has EXPIRED as of ${data.expirationDate}. ` +
        `You cannot work until renewed. Contact HR immediately.`,
};
