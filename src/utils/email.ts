import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config/index.js';

/**
 * Transactional email.
 *
 * The transporter is created once, lazily, and reused - opening an SMTP
 * connection per message is slow and gets an account rate limited. Every send
 * is wrapped so a mail failure surfaces as a result rather than an exception:
 * an invoice that was saved must not appear to have failed because the mail
 * server was briefly unreachable.
 */

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (transporter) return transporter;
  if (!config.smtp.isConfigured) return null;

  const isGmail =
    config.smtp.host?.includes('gmail') || config.smtp.user?.endsWith('@gmail.com');

  const common = {
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: { user: config.smtp.user as string, pass: config.smtp.pass as string }
  };

  transporter = isGmail
    ? nodemailer.createTransport({ service: 'gmail', ...common })
    : nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        ...common
      });

  return transporter;
};

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendEmailInput {
  to: string | string[];
  cc?: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  /** Shown as the sender name, e.g. the business rather than the SaaS. */
  fromName?: string;
}

export interface SendEmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

export const isEmailConfigured = (): boolean => config.smtp.isConfigured;

export const sendEmail = async (input: SendEmailInput): Promise<SendEmailResult> => {
  const mailer = getTransporter();

  if (!mailer) {
    return {
      sent: false,
      error: 'Email is not configured on this server. Add SMTP credentials to enable sending.'
    };
  }

  try {
    const from = input.fromName
      ? `"${input.fromName.replace(/"/g, '')}" <${config.smtp.from}>`
      : config.smtp.from;

    const info = await mailer.sendMail({
      from,
      to: input.to,
      cc: input.cc,
      replyTo: input.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text ?? stripHtml(input.html),
      attachments: input.attachments
    });

    return { sent: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email error';
    console.error('Email send failed:', message);
    return { sent: false, error: message };
  }
};

/** Plain-text fallback so the message is readable in clients that block HTML. */
const stripHtml = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Escapes user-supplied values before they go into an HTML template. */
export const escapeHtml = (value: string | null | undefined): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Shared shell for every outbound message.
 *
 * Table-based and inline-styled on purpose: that is the only layout that
 * renders consistently across Outlook, Gmail and Apple Mail.
 */
export const renderEmailShell = (options: {
  heading: string;
  body: string;
  accent?: string;
  footer?: string;
  cta?: { label: string; url: string };
}): string => {
  const accent = /^#[0-9a-fA-F]{6}$/.test(options.accent ?? '') ? options.accent : '#7c4a27';

  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:0;background-color:#f7f4ef;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b180d;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f4ef;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e6dfd5;">
            <tr>
              <td style="background-color:${accent};padding:20px 28px;">
                <h1 style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">${escapeHtml(
                  options.heading
                )}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-size:14px;line-height:1.6;color:#2b180d;">
                ${options.body}
                ${
                  options.cta
                    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;">
                         <tr><td style="background-color:${accent};">
                           <a href="${escapeHtml(options.cta.url)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;">${escapeHtml(
                             options.cta.label
                           )}</a>
                         </td></tr>
                       </table>`
                    : ''
                }
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #e6dfd5;background-color:#faf8f5;font-size:11px;color:#948375;">
                ${options.footer ?? 'This is an automated message, please do not reply directly to it.'}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

/** Key/value rows used inside email bodies for invoice summaries. */
export const renderDetailRows = (rows: Array<[string, string]>): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e6dfd5;">
    ${rows
      .map(
        ([label, value], index) => `<tr style="background-color:${
          index % 2 ? '#faf8f5' : '#ffffff'
        };">
          <td style="padding:9px 14px;font-size:12px;color:#6b5a4e;border-bottom:1px solid #f3ede5;">${escapeHtml(
            label
          )}</td>
          <td style="padding:9px 14px;font-size:12px;font-weight:600;color:#2b180d;text-align:right;border-bottom:1px solid #f3ede5;">${escapeHtml(
            value
          )}</td>
        </tr>`
      )
      .join('')}
  </table>`;
