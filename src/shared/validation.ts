/**
 * Validation schemas (zod/mini: small enough for the portal bundle).
 * Used on the client for friendly errors AND in the functions as the real gate.
 * The database CHECK constraints are the last line behind both.
 */
import * as z from 'zod/mini';
import { BODY_MAX, BODY_MIN, CATEGORIES, TAGS } from './domain';

export const trackingHashSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/, 'Invalid tracking hash'));

/** Fields of the multipart submit request (the optional photo is checked separately). */
export const submitFieldsSchema = z.object({
  body: z
    .string()
    .check(
      z.trim(),
      z.minLength(BODY_MIN, `Please write at least ${BODY_MIN} characters.`),
      z.maxLength(BODY_MAX, `Please keep it under ${BODY_MAX} characters.`),
    ),
  category: z.enum(CATEGORIES, 'Pick a category.'),
  tag: z.enum(TAGS, 'Pick how pressing this is.'),
  tracking_hash: trackingHashSchema,
  /** Honeypot: humans never see this field, so it must be empty. */
  website: z.optional(z.string().check(z.maxLength(0))),
  /** Milliseconds the form was open before submit (client-measured). */
  elapsed_ms: z.coerce.number().check(z.int(), z.nonnegative()),
});
export type SubmitFields = z.infer<typeof submitFieldsSchema>;

/** Field-level messages for the portal form. */
export function fieldErrors(input: unknown): Partial<Record<keyof SubmitFields, string>> {
  const r = submitFieldsSchema.safeParse(input);
  if (r.success) return {};
  const out: Partial<Record<keyof SubmitFields, string>> = {};
  for (const issue of r.error.issues) {
    const k = issue.path[0] as keyof SubmitFields;
    if (k && !out[k]) out[k] = issue.message;
  }
  return out;
}
