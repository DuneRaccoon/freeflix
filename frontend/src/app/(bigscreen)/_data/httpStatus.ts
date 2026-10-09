/**
 * The HTTP status behind a rejected `apiClient` call, or `undefined` when there is none.
 *
 * ONE DEFINITION, because every screen on this surface branches on it and the branches are
 * not cosmetic: **423** means the profile is passcode-locked and the viewer must be sent
 * back to the picker (never "your list is empty"), **409** means already-saved and **404**
 * already-gone — both of which are what the viewer asked for, not failures. A copy of this
 * one-liner with the reasoning written on only one copy is a defect class this project has
 * already been bitten by, and there were four copies of it under `(bigscreen)` before this
 * module existed.
 *
 * Deliberately NOT `@/components/auth/helpers`, which has the same function: nothing under
 * `(bigscreen)` may import from `@/components` (`legacy-target.test.ts` enforces it, direct
 * and one hop deep), because that tree is the pointer-first web design system.
 *
 * Structural, not `axios.isAxiosError`: the shape is all that is read, so a hand-rolled
 * `{ response: { status } }` in a test behaves exactly like a real rejection, and a null or
 * a string rejection answers `undefined` instead of throwing inside a `catch` block.
 */
export const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status;
