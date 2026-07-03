// Outbound mail. Deliberately tiny: an HTTP mail API keyed by env
// (Resend-compatible by default), no SMTP stack, plain-text bodies only.
// When unconfigured, sends nothing and says so — combined with
// DEV_SHOW_MAGIC_LINK=0 that means magic-link sign-in is safely inert
// rather than silently broken, and every other email is simply skipped.
const MAIL_API_URL = process.env.MAIL_API_URL ?? 'https://api.resend.com/emails';
const MAIL_API_KEY = process.env.MAIL_API_KEY ?? '';
const MAIL_FROM = process.env.MAIL_FROM ?? 'BOMwiki <signin@bomwiki.com>';
export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://bomwiki.com';

export function mailerConfigured(): boolean {
  return Boolean(MAIL_API_KEY);
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

export async function sendEmail(mail: Mail): Promise<boolean> {
  if (!mailerConfigured()) return false;
  try {
    const res = await fetch(MAIL_API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${MAIL_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.headers ? { headers: mail.headers } : {}),
      }),
    });
    if (!res.ok) console.error(`mailer: ${res.status} ${await res.text()}`);
    return res.ok;
  } catch (err) {
    console.error('mailer failed:', err);
    return false;
  }
}

export async function sendMagicLinkEmail(to: string, linkPath: string): Promise<boolean> {
  const link = `${SITE_ORIGIN}${linkPath}`;
  return sendEmail({
    to,
    subject: 'Sign in to BOMwiki',
    text: `Click to sign in to BOMwiki:\n\n${link}\n\nThe link works once and expires in 30 minutes. If you didn't request this, ignore it.`,
  });
}
