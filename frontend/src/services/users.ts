// frontend/src/services/users.ts
//
// The storage layer still calls these rows "users"; since the instance-claim work a
// row is a PROFILE owned by an Account. Every endpoint here is scoped to the caller's
// account server-side, so the client never has to filter.
import apiClient from './api-client';

export interface UserSettings {
  id: string;
  user_id: string;
  maturity_restriction: 'none' | 'pg' | 'pg13' | 'r';
  require_passcode: boolean;
  /**
   * The passcode itself never reaches the browser. `GET /users` used to return every
   * profile's plaintext code; the keypad only ever needed to know that one exists and
   * how many dots to draw — verification happens server-side via unlockProfile().
   */
  has_passcode: boolean;
  passcode_len: number | null;
  theme: 'dark' | 'light';
  default_quality: '720p' | '1080p' | '2160p';
  download_path?: string;
}

/** Write shape for PUT /users/{id}/settings. `passcode` is write-only. */
export interface UserSettingsUpdate {
  maturity_restriction?: 'none' | 'pg' | 'pg13' | 'r';
  require_passcode?: boolean;
  /** Hashed on arrival; send '' to clear. */
  passcode?: string;
  theme?: 'dark' | 'light';
  default_quality?: '720p' | '1080p' | '2160p';
  download_path?: string;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  account_id: string | null;
  created_at: string;
  settings?: UserSettings;
}

export interface UserCreate {
  // No `username`: it is minted server-side. The old client-side slug
  // (`${name}-${Date.now()}`) could collide on the instance-global UNIQUE constraint
  // and surfaced only as a generic failure toast.
  display_name: string;
  avatar?: string;
}

export interface UserUpdate {
  display_name?: string;
  avatar?: string;
}

export const usersService = {
  createUser: async (userData: UserCreate): Promise<User> => {
    const response = await apiClient.post('/users', userData);
    return response.data;
  },

  /** Already scoped to the signed-in account. */
  getUsers: async (): Promise<User[]> => {
    const response = await apiClient.get('/users');
    return response.data;
  },

  getUser: async (userId: string): Promise<User> => {
    const response = await apiClient.get(`/users/${userId}`);
    return response.data;
  },

  updateUser: async (userId: string, userData: UserUpdate): Promise<User> => {
    const response = await apiClient.put(`/users/${userId}`, userData);
    return response.data;
  },

  deleteUser: async (userId: string): Promise<void> => {
    await apiClient.delete(`/users/${userId}`);
  },

  getUserSettings: async (userId: string): Promise<UserSettings> => {
    const response = await apiClient.get(`/users/${userId}/settings`);
    return response.data;
  },

  updateUserSettings: async (
    userId: string,
    settings: UserSettingsUpdate,
  ): Promise<UserSettings> => {
    const response = await apiClient.put(`/users/${userId}/settings`, settings);
    return response.data;
  },

  /**
   * Records the unlock against the session row, so the lock the UI advertises is
   * actually enforced on every subsequent profile-scoped call. 423/403 means the code
   * was wrong.
   */
  unlockProfile: async (userId: string, passcode: string): Promise<{ ok: boolean }> => {
    const response = await apiClient.post(`/users/${userId}/unlock`, { passcode });
    return response.data;
  },
};
