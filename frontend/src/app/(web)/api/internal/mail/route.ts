import { timingSafeEqual } from 'node:crypto';
import { createElement, type ComponentType } from 'react';
import { render } from '@react-email/render';
import { Resend } from 'resend';

import AccessRevokedEmail, { subject as accessRevokedSubject } from '@/emails/AccessRevokedEmail';
import ClaimVerifyEmail, { subject as claimVerifySubject } from '@/emails/ClaimVerifyEmail';
import InviteEmail, { subject as inviteSubject } from '@/emails/InviteEmail';
import MagicLinkEmail, { subject as magicLinkSubject } from '@/emails/MagicLinkEmail';
import PasswordResetEmail, {
  subjectFor as passwordResetSubjectFor,
} from '@/emails/PasswordResetEmail';
import WelcomeEmail, { subject as welcomeSubject } from '@/emails/WelcomeEmail';

// No `runtime` export on purpose. The Node.js runtime is the default, and render()
// pulls in react-dom/server — declaring `edge` here would break every send at build
// time. The path is also fully static: next.config.ts returns a plain array, so its
// rewrites are `afterFiles` and a filesystem route wins over the /api/:path* proxy.
// A dynamic segment would not win, and FastAPI would receive the shared secret.

/**
 * Ids are the contract with backend/app/services/mailer.py.
 *
 * `subject` may be a resolver because one template is two emails: password-reset's
 * `isFirstTime` variant goes to an owner who has never had a password, and heading it
 * "Reset your FRÈ password" would tell them something is wrong when nothing is.
 */
const TEMPLATES: Record<
  string,
  { component: ComponentType<any>; subject: string | ((props: any) => string) }
> = {
  invite: { component: InviteEmail, subject: inviteSubject },
  'magic-link': { component: MagicLinkEmail, subject: magicLinkSubject },
  'claim-verify': { component: ClaimVerifyEmail, subject: claimVerifySubject },
  welcome: { component: WelcomeEmail, subject: welcomeSubject },
  'password-reset': { component: PasswordResetEmail, subject: passwordResetSubjectFor },
  'access-revoked': { component: AccessRevokedEmail, subject: accessRevokedSubject },
};

interface MailRequest {
  template?: string;
  to?: string;
  props?: Record<string, unknown>;
}

function authorized(request: Request): boolean {
  const expected = process.env.INTERNAL_MAIL_SECRET;
  // An unconfigured secret authorises nothing — this route renders and sends mail on
  // behalf of anyone who can reach the container.
  if (!expected) return false;

  const provided = request.headers.get('x-internal-mail-secret');
  if (!provided) return false;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, so length is compared first. The
  // length of a secret is not the secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: MailRequest;
  try {
    body = (await request.json()) as MailRequest;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { template, to, props = {} } = body ?? {};
  const entry = template ? TEMPLATES[template] : undefined;
  if (!entry) {
    return Response.json({ error: 'unknown_template', template: template ?? null }, { status: 400 });
  }
  if (!to) {
    return Response.json({ error: 'missing_recipient' }, { status: 400 });
  }

  // Surfaced on every failure path: the backend logs it at WARNING so a self-hosted
  // instance with no mail provider can still be finished by hand.
  const actionUrl = typeof props.actionUrl === 'string' ? props.actionUrl : null;

  let html: string;
  let text: string;
  try {
    const element = createElement(entry.component, props);
    // render() has been async since @react-email/render 1.0. Forgetting the await
    // sends a body of literally "[object Promise]" and Resend still answers 200, so
    // nothing looks broken until someone opens the inbox.
    html = await render(element);
    text = await render(element, { plainText: true });
  } catch (error) {
    console.error(`[mail] failed to render "${template}"`, error);
    return Response.json({ delivered: false, reason: 'render_error', actionUrl }, { status: 500 });
  }

  // Resolved from the props rather than fixed to the id — password-reset is two
  // different emails under one template (see TEMPLATES).
  const subject = typeof entry.subject === 'function' ? entry.subject(props) : entry.subject;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Supported mode, not an error. The render above still ran, so a broken template
    // is caught here rather than in a recipient's inbox.
    console.warn(`[mail] RESEND_API_KEY unset — rendered "${template}" for ${to} without sending`);
    return Response.json({ delivered: false, reason: 'no_api_key', actionUrl });
  }

  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: process.env.MAIL_FROM ?? 'FRÈ <onboarding@resend.dev>',
      to,
      subject,
      html,
      text,
    });
    if (error) {
      // 200 on purpose: the backend reads `delivered` and treats this as undelivered
      // rather than a transport failure, and logs the action URL instead of 500ing.
      console.error(`[mail] Resend rejected "${template}" for ${to}:`, error);
      return Response.json({ delivered: false, reason: 'provider_error', actionUrl });
    }
  } catch (error) {
    console.error(`[mail] Resend threw sending "${template}" to ${to}:`, error);
    return Response.json({ delivered: false, reason: 'provider_error', actionUrl });
  }

  return Response.json({ delivered: true, actionUrl });
}
