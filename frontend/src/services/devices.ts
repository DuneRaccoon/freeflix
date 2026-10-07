import apiClient from './api-client';

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type DevicePollStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface DeviceSession {
  id: string;
  device_name: string | null;
  device_kind: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  current: boolean;
}

export const devicesService = {
  async start(): Promise<DeviceStart> {
    const response = await apiClient.post<DeviceStart>('/auth/device/start');
    return response.data;
  },

  // The device_code travels in the BODY. middleware/error_handler.py logs
  // request.url.path to stdout and to a retained file, so a secret in a path is a
  // secret in the logs.
  async poll(deviceCode: string): Promise<DevicePollStatus> {
    const response = await apiClient.post<{ status: DevicePollStatus }>(
      '/auth/device/poll',
      { device_code: deviceCode },
      // The TV is unauthenticated until this call succeeds; a 401 here is the normal
      // state, not a reason to bounce the page.
      { __allow401: true },
    );
    return response.data.status;
  },

  async approve(userCode: string, deviceName: string): Promise<void> {
    await apiClient.post('/auth/device/approve', {
      user_code: userCode,
      device_name: deviceName,
    });
  },

  async list(): Promise<DeviceSession[]> {
    const response = await apiClient.get<DeviceSession[]>('/auth/devices');
    return response.data;
  },

  async revoke(sessionId: string): Promise<void> {
    await apiClient.delete(`/auth/devices/${sessionId}`);
  },
};
