import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usersService } from './users';
import apiClient from './api-client';

vi.mock('./api-client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const post = apiClient.post as ReturnType<typeof vi.fn>;
const put = apiClient.put as ReturnType<typeof vi.fn>;

describe('usersService profile lock', () => {
  beforeEach(() => vi.resetAllMocks());

  it('select sends the code when there is one', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    await usersService.selectProfile('p1', '4821');
    expect(post).toHaveBeenCalledWith('/users/p1/select', { passcode: '4821' });
  });

  it('select sends an empty JSON body without a code', async () => {
    // Part A accepts no body too (`payload: Optional[...] = None`); `{}` keeps one request shape.
    post.mockResolvedValue({ data: { ok: true } });
    await usersService.selectProfile('p1');
    expect(post).toHaveBeenCalledWith('/users/p1/select', {});
    // toHaveBeenCalledWith treats `{ passcode: undefined }` as `{}`; this does not.
    expect(post.mock.calls[0]).toStrictEqual(['/users/p1/select', {}]);
  });

  it('deselect posts with no body', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    await usersService.deselectProfile();
    expect(post.mock.calls[0]).toEqual(['/users/deselect']);
  });

  it('changePasscode PUTs the dedicated route and returns the settings row', async () => {
    put.mockResolvedValue({ data: { id: 's', has_passcode: true } });
    const r = await usersService.changePasscode('p1', { current_passcode: '1111', new_passcode: '2222' });
    expect(put).toHaveBeenCalledWith('/users/p1/passcode', { current_passcode: '1111', new_passcode: '2222' });
    expect(r).toEqual({ id: 's', has_passcode: true });
  });

  it('resets with the password in the body', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    await usersService.resetPasscodeWithPassword('p1', 'hunter22');
    expect(post).toHaveBeenCalledWith('/users/p1/passcode/reset', { password: 'hunter22' });
  });

  it('asks for a reset link with no body', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    await usersService.requestPasscodeResetLink('p1');
    expect(post.mock.calls[0]).toEqual(['/users/p1/passcode/reset-link']);
  });
});
