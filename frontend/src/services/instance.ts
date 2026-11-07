// frontend/src/services/instance.ts
//
// Owner-only instance administration (every call 403s for a member) — except getPlayback, which any signed-in session reads.
import apiClient from './api-client';
import type { Account, InstanceStatus, MailOutcome } from './auth';

export interface Member {
  account: Account;
  profile_count: number;
  profile_names: string[];
  is_you: boolean;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
}

export interface MembersPayload {
  members: Member[];
  invites: Invite[];
}

export type InviteSendResult = { invite: Invite } & MailOutcome;

export interface OwnerSettings {
  autovacuum_enabled: boolean; autovacuum_days: number; autovacuum_watched_gate: boolean;
  autovacuum_watched_pct: number; auto_next_enabled: boolean; auto_next_pct: number;
}

export interface PlaybackSettings { auto_next_enabled: boolean; auto_next_pct: number }

export const instanceService = {
  members: async (): Promise<MembersPayload> => {
    const response = await apiClient.get<MembersPayload>('/instance/members');
    return response.data;
  },

  /**
   * `accountId` attaches the invite to an existing `pending_email` account minted by
   * the upgrade migration, so that household member keeps their profiles, watch
   * progress and watchlist instead of starting over.
   */
  createInvite: async (email: string, accountId?: string): Promise<InviteSendResult> => {
    const response = await apiClient.post<InviteSendResult>('/instance/invites', {
      email,
      account_id: accountId,
    });
    return response.data;
  },

  revokeInvite: async (id: string): Promise<void> => {
    await apiClient.delete(`/instance/invites/${id}`);
  },

  resendInvite: async (id: string): Promise<InviteSendResult> => {
    const response = await apiClient.post<InviteSendResult>(`/instance/invites/${id}/resend`);
    return response.data;
  },

  revokeMember: async (accountId: string): Promise<void> => {
    await apiClient.post(`/instance/members/${accountId}/revoke`);
  },

  restoreMember: async (accountId: string): Promise<void> => {
    await apiClient.post(`/instance/members/${accountId}/restore`);
  },

  /** Hard delete — cascades the account's profiles, settings, progress and watchlist. */
  removeMember: async (accountId: string): Promise<void> => {
    await apiClient.delete(`/instance/members/${accountId}`);
  },

  transfer: async (accountId: string): Promise<void> => {
    await apiClient.post('/instance/transfer', { account_id: accountId });
  },

  updateSettings: async (patch: { instance_name?: string }): Promise<InstanceStatus> => {
    const response = await apiClient.put<InstanceStatus>('/instance/settings', patch);
    return response.data;
  },

  getOwnerSettings: async (): Promise<OwnerSettings> => {
    const response = await apiClient.get<OwnerSettings>('/instance/owner-settings');
    return response.data;
  },

  updateOwnerSettings: async (patch: Partial<OwnerSettings>): Promise<OwnerSettings> => {
    const response = await apiClient.put<OwnerSettings>('/instance/owner-settings', patch);
    return response.data;
  },

  /** Readable by any signed-in session (the player's next-episode threshold). */
  getPlayback: async (): Promise<PlaybackSettings> => {
    const response = await apiClient.get<PlaybackSettings>('/instance/playback');
    return response.data;
  },
};
