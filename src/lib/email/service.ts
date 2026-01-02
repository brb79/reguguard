import { Resend } from 'resend';
import { envChecks, getEnv } from '@/lib/env';

export interface EmailMessage {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
    replyTo?: string;
    attachments?: Array<{
        filename: string;
        content: Buffer | string;
        contentType?: string;
    }>;
}

export interface EmailResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

class EmailService {
    private client: Resend | null = null;
    private fromEmail: string;

    constructor() {
        try {
            const env = getEnv();
            const apiKey = env.RESEND_API_KEY;
            this.fromEmail = env.FROM_EMAIL || 'noreply@reguguard.com';

            if (apiKey) {
                this.client = new Resend(apiKey);
            }
        } catch (error) {
            // Environment not validated yet, use process.env as fallback
            const apiKey = process.env.RESEND_API_KEY;
            this.fromEmail = process.env.FROM_EMAIL || 'noreply@reguguard.com';

            if (apiKey) {
                this.client = new Resend(apiKey);
            }
        }
    }

    /**
     * Send an email message
     */
    async send(message: EmailMessage): Promise<EmailResult> {
        if (!this.client) {
            console.warn('Resend not configured, email not sent');
            return { success: false, error: 'Resend not configured' };
        }

        try {
            const emailOptions: any = {
                from: message.from || this.fromEmail,
                to: message.to,
                subject: message.subject,
            };

            if (message.html) emailOptions.html = message.html;
            if (message.text) emailOptions.text = message.text;
            if (message.replyTo) emailOptions.replyTo = message.replyTo;
            if (message.attachments) emailOptions.attachments = message.attachments;

            const result = await this.client.emails.send(emailOptions);

            if (result.error) {
                console.error('Email send error:', result.error);
                return {
                    success: false,
                    error: result.error.message,
                };
            }

            return {
                success: true,
                messageId: result.data?.id,
            };
        } catch (error) {
            console.error('Email send error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Check if email service is configured
     */
    isConfigured(): boolean {
        return envChecks.isResendConfigured() && this.client !== null;
    }
}

// Export singleton
export const emailService = new EmailService();

// Email templates for renewal workflows
export const renewalEmailTemplates = {
    submissionReady: (data: {
        employeeName: string;
        stateCode: string;
        licenseType: string;
        portalUrl: string;
        instructions: string[];
        daysRemaining: number;
        submitByDate: string;
    }) => ({
        subject: `Your ${data.stateCode} ${data.licenseType} License Renewal - Ready to Submit`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Hi ${data.employeeName},</h2>

                <p>Great news! I've prepared everything for your license renewal. All documents have been validated and are ready to submit.</p>

                <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">📋 What's Included</h3>
                    <ul>
                        <li>License photo ✓ Validated</li>
                        <li>Training certificate ✓ Validated</li>
                        <li>Pre-filled form data ✓ Verified</li>
                    </ul>
                </div>

                <div style="background: #fff4e6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">🔗 Portal Link</h3>
                    <p><a href="${data.portalUrl}" style="color: #0066cc; font-weight: bold;">${data.portalUrl}</a></p>
                </div>

                <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">📝 Step-by-Step Guide</h3>
                    <ol>
                        ${data.instructions.map(step => `<li>${step}</li>`).join('')}
                    </ol>
                </div>

                <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">⏰ Timeline</h3>
                    <p>Your license expires in <strong>${data.daysRemaining} days</strong>. Please submit by <strong>${data.submitByDate}</strong>.</p>
                </div>

                <p style="margin-top: 30px;">💡 <strong>Tips:</strong></p>
                <ul>
                    <li>Set aside 10-15 minutes when you have good internet</li>
                    <li>Have the attached documents ready to upload</li>
                    <li>Save your confirmation number when done</li>
                </ul>

                <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666;">
                    Need help? Just reply to this email or text me.
                </p>
            </div>
        `,
        text: `Hi ${data.employeeName},

Great news! I've prepared everything for your license renewal. All documents have been validated and are ready to submit.

📋 WHAT'S INCLUDED:
- License photo ✓ Validated
- Training certificate ✓ Validated
- Pre-filled form data ✓ Verified

🔗 PORTAL LINK:
${data.portalUrl}

📝 STEP-BY-STEP GUIDE:
${data.instructions.map((step, i) => `${i + 1}. ${step}`).join('\n')}

💡 TIPS:
- Set aside 10-15 minutes when you have good internet
- Have the attached documents ready to upload
- Save your confirmation number when done

⏰ TIMELINE:
Your license expires in ${data.daysRemaining} days. Please submit by ${data.submitByDate}.

Need help? Just reply to this email or text me.`,
    }),

    documentRequest: (data: {
        employeeName: string;
        documentType: string;
        instructions: string;
    }) => ({
        subject: `Document Needed: ${data.documentType}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Hi ${data.employeeName},</h2>
                <p>${data.instructions}</p>
                <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666;">
                    Reply to this email if you have any questions.
                </p>
            </div>
        `,
        text: `Hi ${data.employeeName},\n\n${data.instructions}\n\nReply to this email if you have any questions.`,
    }),

    confirmationReceived: (data: {
        employeeName: string;
        confirmationNumber: string;
        followUpDate: string;
    }) => ({
        subject: 'Renewal Submitted Successfully',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Hi ${data.employeeName},</h2>
                <p>Perfect! I've recorded your confirmation number: <strong>${data.confirmationNumber}</strong></p>
                <p>Your renewal should be approved within 2 weeks. I'll check in with you on <strong>${data.followUpDate}</strong> to confirm everything went through.</p>
                <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666;">
                    If you receive your renewed license before then, just let me know!
                </p>
            </div>
        `,
        text: `Hi ${data.employeeName},\n\nPerfect! I've recorded your confirmation number: ${data.confirmationNumber}\n\nYour renewal should be approved within 2 weeks. I'll check in with you on ${data.followUpDate} to confirm everything went through.\n\nIf you receive your renewed license before then, just let me know!`,
    }),
};
