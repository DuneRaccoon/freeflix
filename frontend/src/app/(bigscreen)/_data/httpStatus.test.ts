import { describe, it, expect } from 'vitest';
import { statusOf } from './httpStatus';

describe('statusOf', () => {
  it('reads the status off a rejected request', () => {
    expect(statusOf({ response: { status: 423 } })).toBe(423);
    expect(statusOf(Object.assign(new Error('nope'), { response: { status: 404 } }))).toBe(404);
  });

  it('answers undefined rather than throwing for anything without one', () => {
    // Every caller runs this inside a `catch`, where the value can be anything at all: a
    // network error with no response, a string, or null. A throw in there would replace a
    // handled refusal with an unhandled rejection.
    for (const err of [null, undefined, 'boom', 0, new Error('no response'), {}, { response: {} }]) {
      expect(statusOf(err)).toBeUndefined();
    }
  });
});
