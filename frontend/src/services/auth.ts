// frontend/src/services/auth.ts
import apiClient from './api-client';
import type { User } from './users';

export interface Account {
  id: string;
  email: string | null;
  role: 'owner' | 'member';
  status: 'pending_email' | 'invited' | 'active' | 'revoked';
  display_name: string | null;
  last_login_at: string | null;
  created_at: string | null;
}

export interface InstanceStatus {
  claimed: boolean;
  needs_claim: boolean;
  instance_name: string | null;
  claimed_at: string | null;
}

export interface SessionPayload {
  account: Account;
  profiles: User[];
}

/**
 * What every mail-sending endpoint answers with. `sent` is always true — it is
 * deliberately identical for known, unknown, revoked and rate-limited addresses so
 * the sign-in form cannot be used to enumerate accounts. `delivered` says whether a
 * provider actually accepted it, and `action_url` carries the link itself when the
 * instance has no mail provider configured, so a self-hosted operator is never locked
 * out of their own box.
 */
export interface MailOutcome {
  sent: boolean;
  delivered: boolean;
  action_url?: string | null;
}

export interface VerifyResult {
  ok: boolean;
  redirect: string;
  claimed: boolean;
}

/**
 * Published sign-in rules, identical for every caller — nothing here varies by
 * address, so it is safe to read before anyone has identified themselves. The
 * minimum length lives here rather than in the pages so the client and the server
 * cannot drift into rejecting different passwords.
 */
export interface AuthCapabilities {
  password_min_length: number;
}

export interface InvitePreview {
  email: string;
  invited_by: string | null;
  instance_name: string | null;
  expires_at: string | null;
}

export const authService = {
  /**
   * The single session bootstrap call. A 401 here is the ordinary signed-out state,
   * not a failure, so it opts out of the global redirect — SessionContext and
   * AuthenticatedLayout decide where a signed-out visitor goes.
   */
  me: async (): Promise<SessionPayload> => {
    const response = await apiClient.get<SessionPayload>('/auth/me', { __allow401: true });
    return response.data;
  },

  instanceStatus: async (): Promise<InstanceStatus> => {
    const response = await apiClient.get<InstanceStatus>('/instance/status', { __allow401: true });
    return response.data;
  },

  capabilities: async (): Promise<AuthCapabilities> => {
    const response = await apiClient.get<AuthCapabilities>('/auth/capabilities');
    return response.data;
  },

  /**
   * The password is chosen here, at claim time, but only takes effect once the emailed
   * link proves the address — so this still answers with a MailOutcome, not a session.
   */
  claim: async (claimCode: string, email: string, password: string): Promise<MailOutcome> => {
    const response = await apiClient.post<MailOutcome>('/claim', {
      claim_code: claimCode,
      email,
      password,
    });
    return response.data;
  },

  /** Members only. The owner's address silently gets nothing back — the response is
   *  constant either way, so the caller cannot tell which address is which. */
  requestLink: async (email: string): Promise<MailOutcome> => {
    const response = await apiClient.post<MailOutcome>('/auth/request-link', { email });
    return response.data;
  },

  /**
   * The owner's sign-in. `__allow401` is load-bearing: a 401 here is the ANSWER — one
   * constant "email or password is incorrect" covering every failure, including a
   * throttled attempt — not an expired session, so the global interceptor must not
   * bounce the caller to /signin and swallow it.
   */
  passwordSignIn: async (email: string, password: string): Promise<VerifyResult> => {
    const response = await apiClient.post<VerifyResult>(
      '/auth/password-signin',
      { email, password },
      { __allow401: true },
    );
    return response.data;
  },

  /**
   * Emails the owner a set-a-new-password link. Also the FIRST-password path, for an
   * owner who has none yet (an ownership transfer, or an instance claimed before
   * passwords existed), which is why nothing about the caller is asserted here.
   */
  requestPasswordReset: async (email: string): Promise<MailOutcome> => {
    const response = await apiClient.post<MailOutcome>('/auth/request-password-reset', { email });
    return response.data;
  },

  /** Burns the reset token AND sets the new password in one call — the link alone
   *  grants no session, which is what keeps the owner password-only. */
  resetPassword: async (token: string, password: string): Promise<VerifyResult> => {
    const response = await apiClient.post<VerifyResult>('/auth/reset-password', {
      token,
      password,
    });
    return response.data;
  },

  /** The token travels in the body, never the path — request paths are written to a
   *  persisted log file, query strings and bodies are not. */
  verify: async (token: string): Promise<VerifyResult> => {
    const response = await apiClient.post<VerifyResult>('/auth/verify', { token });
    return response.data;
  },

  invitePreview: async (token: string): Promise<InvitePreview> => {
    const response = await apiClient.post<InvitePreview>('/auth/invite/preview', { token });
    return response.data;
  },

  inviteAccept: async (
    token: string,
    displayName: string,
    avatar?: string,
  ): Promise<{ ok: boolean }> => {
    const response = await apiClient.post<{ ok: boolean }>('/auth/invite/accept', {
      token,
      display_name: displayName,
      avatar,
    });
    return response.data;
  },

  signOut: async (): Promise<void> => {
    await apiClient.post('/auth/signout', undefined, { __allow401: true });
  },
};
