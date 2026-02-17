/**
 * Email Service - Sends transactional emails (OTP, password reset, etc.)
 * Uses Resend by default; can be extended for SendGrid/SMTP
 */

import { Resend } from 'resend';

export interface EmailServiceConfig {
  resendApiKey?: string;
  fromAddress: string;
  fromName?: string;
}

export interface IEmailService {
  sendOTP(to: string, otp: string): Promise<void>;
  isConfigured(): boolean;
}

export class EmailService implements IEmailService {
  private resend: Resend | null = null;
  private fromAddress: string;
  private fromName: string;

  constructor(config: EmailServiceConfig) {
    this.fromAddress = config.fromAddress;
    this.fromName = config.fromName || 'Your App';

    if (config.resendApiKey) {
      this.resend = new Resend(config.resendApiKey);
    }
  }

  isConfigured(): boolean {
    return this.resend !== null && !!this.fromAddress;
  }

  async sendOTP(to: string, otp: string): Promise<void> {
    if (!this.resend) {
      throw new Error(
        'Email service is not configured. Set RESEND_API_KEY, EMAIL_FROM_ADDRESS in your .env file.'
      );
    }

    const { error } = await this.resend.emails.send({
      from: `${this.fromName} <${this.fromAddress}>`,
      to,
      subject: 'Your password reset code',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2>Password Reset</h2>
          <p>You requested a password reset. Use the following code to reset your password:</p>
          <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #333;">${otp}</p>
          <p style="color: #666;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `
    });

    if (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }
}

export function createEmailService(config: EmailServiceConfig): IEmailService {
  return new EmailService(config);
}
