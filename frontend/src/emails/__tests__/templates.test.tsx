/**
 * @vitest-environment node
 *
 * These assertions are the reason §7.3 demands literal inline styles. `vitest.config.ts`
 * sets `css: false`, so a stylesheet is inert here — exactly as it is in Gmail, which
 * strips <style> from many messages. What survives both is markup and inline style, and
 * that is all this file is allowed to look at.
 */
import { createElement, type ReactElement } from 'react';
import { render } from '@react-email/render';
import { beforeAll, describe, expect, it } from 'vitest';

import AccessRevokedEmail, {
  PreviewProps as accessRevokedProps,
  subject as accessRevokedSubject,
} from '../AccessRevokedEmail';
import ClaimVerifyEmail, {
  PreviewProps as claimVerifyProps,
  subject as claimVerifySubject,
} from '../ClaimVerifyEmail';
import InviteEmail, { PreviewProps as inviteProps, subject as inviteSubject } from '../InviteEmail';
import MagicLinkEmail, {
  PreviewProps as magicLinkProps,
  subject as magicLinkSubject,
} from '../MagicLinkEmail';
import PasswordResetEmail, {
  PreviewProps as passwordResetProps,
  subjectFor as passwordResetSubjectFor,
  type PasswordResetEmailProps,
} from '../PasswordResetEmail';
import WelcomeEmail, {
  PreviewProps as welcomeProps,
  subject as welcomeSubject,
} from '../WelcomeEmail';

interface TemplateCase {
  id: string;
  subject: string;
  /** The subject from spec §7.2, spelled out so a copy edit has to be deliberate. */
  expectedSubject: string;
  actionUrl: string | null;
  node: ReactElement;
}

/**
 * The one template that is really two emails. Both variants go through the whole
 * battery below, because `isFirstTime` swaps the eyebrow, the headline, the CTA label
 * and the closing note — every element the palette and gold-discipline rules cover.
 */
const passwordResetFirstTimeProps: PasswordResetEmailProps = {
  ...passwordResetProps,
  isFirstTime: true,
};

const cases: TemplateCase[] = [
  {
    id: 'invite',
    subject: inviteSubject,
    expectedSubject: "You're invited to FRÈ",
    actionUrl: inviteProps.actionUrl,
    node: createElement(InviteEmail, inviteProps),
  },
  {
    id: 'magic-link',
    subject: magicLinkSubject,
    expectedSubject: 'Your FRÈ sign-in link',
    actionUrl: magicLinkProps.actionUrl,
    node: createElement(MagicLinkEmail, magicLinkProps),
  },
  {
    id: 'claim-verify',
    subject: claimVerifySubject,
    expectedSubject: 'Confirm your FRÈ instance',
    actionUrl: claimVerifyProps.actionUrl,
    node: createElement(ClaimVerifyEmail, claimVerifyProps),
  },
  {
    id: 'welcome',
    subject: welcomeSubject,
    expectedSubject: 'Welcome to FRÈ',
    actionUrl: welcomeProps.actionUrl,
    node: createElement(WelcomeEmail, welcomeProps),
  },
  {
    id: 'password-reset',
    subject: passwordResetSubjectFor(passwordResetProps),
    expectedSubject: 'Reset your FRÈ password',
    actionUrl: passwordResetProps.actionUrl,
    node: createElement(PasswordResetEmail, passwordResetProps),
  },
  {
    id: 'password-reset-first-time',
    subject: passwordResetSubjectFor(passwordResetFirstTimeProps),
    expectedSubject: 'Set your FRÈ password',
    actionUrl: passwordResetFirstTimeProps.actionUrl,
    node: createElement(PasswordResetEmail, passwordResetFirstTimeProps),
  },
  {
    id: 'access-revoked',
    subject: accessRevokedSubject,
    expectedSubject: 'Your FRÈ access has ended',
    actionUrl: null,
    node: createElement(AccessRevokedEmail, accessRevokedProps),
  },
];

const withoutStylesheet = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '');

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/**
 * Copy with every URL removed. The reset link is `/auth/reset-password`, so the word
 * "reset" is in the markup of both variants whatever the prose says — and the prose is
 * what these assertions are about.
 */
const copyOnly = (html: string) => withoutStylesheet(html).replace(/https?:\/\/[^\s"'<>]+/g, '');

describe.each(cases)('$id email', (testCase) => {
  let html = '';
  let text = '';

  beforeAll(async () => {
    html = await render(testCase.node);
    text = await render(testCase.node, { plainText: true });
  });

  it('uses the subject from spec §7.2', () => {
    expect(testCase.subject).toBe(testCase.expectedSubject);
  });

  it('shows the FRÈ wordmark', () => {
    expect(html).toContain('FRÈ');
  });

  it('inlines the palette as literal hex, not a stylesheet', () => {
    const inline = withoutStylesheet(html);
    expect(inline).toContain('#0A0A0B');
    expect(inline).toContain('#111113');
    expect(inline).toContain('#C9A86A');
  });

  it('never reaches for a CSS custom property', () => {
    // --color-* / --font-* are injected onto <html> by Tailwind and next/font. An
    // inbox has neither, so a var() here renders unstyled for every recipient.
    expect(html).not.toContain('var(--');
  });

  it('never uses background-clip', () => {
    // Outlook drops background-clip and keeps the transparent fill, which is how the
    // app's own Wordmark would arrive as a blank gap.
    expect(html).not.toMatch(/background-clip/i);
  });

  it('spends gold exactly once on an eyebrow', () => {
    expect(occurrences(html, 'class="fre-gold"')).toBe(1);
  });

  it('declares a dark colour scheme and defends it', () => {
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('name="supported-color-schemes"');
    expect(html).toContain('[data-ogsc]');
    expect(html).toContain('prefers-color-scheme: light');
  });

  it('renders a plain-text alternative', () => {
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('<td');
  });
});

describe.each(cases.filter((c) => c.actionUrl))('$id email call to action', (testCase) => {
  const actionUrl = testCase.actionUrl as string;
  let html = '';
  let text = '';

  beforeAll(async () => {
    html = await render(testCase.node);
    text = await render(testCase.node, { plainText: true });
  });

  it('links the button and the fallback at the action URL', () => {
    expect(occurrences(html, `href="${actionUrl}"`)).toBeGreaterThanOrEqual(2);
  });

  it('keeps the action URL in the plain-text alternative', () => {
    expect(text).toContain(actionUrl);
  });

  it('carries the Outlook VML fallback under a solid gold fill', () => {
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('v:roundrect');
    expect(html).toContain('fillcolor="#C9A86A"');
    expect(html).toContain('bgcolor="#C9A86A"');
  });

  it('spends the gold CTA exactly once', () => {
    expect(occurrences(html, 'class="fre-cta"')).toBe(1);
  });
});

describe('password-reset email variants', () => {
  it('calls it a reset only when there is a password to reset', async () => {
    const html = await render(createElement(PasswordResetEmail, passwordResetProps));
    expect(copyOnly(html)).toMatch(/reset/i);
  });

  it('never says "reset" to an owner who has never had one', async () => {
    // Nothing is wrong for a transferred owner, or one whose instance was claimed
    // before passwords existed. "Reset" would tell them something is.
    const html = await render(createElement(PasswordResetEmail, passwordResetFirstTimeProps));
    expect(copyOnly(html)).not.toMatch(/reset/i);
  });

  it('subjects the two variants apart', () => {
    expect(passwordResetSubjectFor({ isFirstTime: false })).toBe('Reset your FRÈ password');
    expect(passwordResetSubjectFor({ isFirstTime: true })).toBe('Set your FRÈ password');
  });

  it('states the expiry and the link\u2019s one power in both variants', async () => {
    for (const props of [passwordResetProps, passwordResetFirstTimeProps]) {
      const html = await render(createElement(PasswordResetEmail, props));
      expect(html).toContain('20 minutes');
      // The link is a door to one screen, not a session — the actual security property.
      expect(html).toMatch(/doesn\u2019t sign you in/);
    }
  });
});

describe('access-revoked email', () => {
  it('offers no call to action, because there is nothing to click', async () => {
    const html = await render(createElement(AccessRevokedEmail, accessRevokedProps));
    expect(html).not.toContain('v:roundrect');
    expect(html).not.toContain('class="fre-cta"');
  });
});
