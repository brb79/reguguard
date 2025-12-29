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
