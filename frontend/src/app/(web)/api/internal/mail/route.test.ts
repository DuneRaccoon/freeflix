/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from './route';

const ACTION_URL = 'https://fre.example.com/auth/reset-passcode?token=t';

describe('POST /api/internal/mail', () => {
  let secret: string | undefined;
  let apiKey: string | undefined;

  beforeEach(() => {
    secret = process.env.INTERNAL_MAIL_SECRET;
    apiKey = process.env.RESEND_API_KEY;
    process.env.INTERNAL_MAIL_SECRET = 'test-secret';
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    if (secret === undefined) delete process.env.INTERNAL_MAIL_SECRET;
    else process.env.INTERNAL_MAIL_SECRET = secret;
    if (apiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = apiKey;
  });

  it('has the passcode-reset template registered', async () => {
    const response = await POST(
      new Request('http://x/api/internal/mail', {
        method: 'POST',
        headers: {
          'x-internal-mail-secret': 'test-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          template: 'passcode-reset',
          to: 'm@example.com',
          props: { actionUrl: ACTION_URL, profileName: 'Kids', expiresInMinutes: 20 },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      delivered: false,
      reason: 'no_api_key',
      actionUrl: ACTION_URL,
    });
  });
});
