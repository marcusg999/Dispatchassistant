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

/**
 * "HR eyes only" personal-issue report. NOT anonymous: a name is required.
 * Stored in a separate table that only the HR list can read.
 */
export const hrFieldsSchema = z.object({
  full_name: z
    .string('Please enter your name.')
    .check(z.trim(), z.minLength(2, 'Please enter your name.'), z.maxLength(120, 'Please keep your name under 120 characters.')),
  contact: z.optional(
    z.string().check(z.trim(), z.maxLength(200, 'Please keep contact details under 200 characters.')),
  ),
  body: z
    .string()
    .check(
      z.trim(),
      z.minLength(BODY_MIN, `Please write at least ${BODY_MIN} characters.`),
      z.maxLength(BODY_MAX, `Please keep it under ${BODY_MAX} characters.`),
    ),
  tracking_hash: trackingHashSchema,
  website: z.optional(z.string().check(z.maxLength(0))),
  elapsed_ms: z.coerce.number().check(z.int(), z.nonnegative()),
});
export type HrFields = z.infer<typeof hrFieldsSchema>;

function issuesByField(r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  const out: Record<string, string> = {};
  if (r.success || !r.error) return out;
  for (const issue of r.error.issues) {
    const k = String(issue.path[0] ?? '');
    if (k && !out[k]) out[k] = issue.message;
  }
  return out;
}

/** Field-level messages for the anonymous portal form. */
export function fieldErrors(input: unknown): Partial<Record<keyof SubmitFields, string>> {
  return issuesByField(submitFieldsSchema.safeParse(input));
}

/** Field-level messages for the HR form. */
export function hrFieldErrors(input: unknown): Partial<Record<keyof HrFields, string>> {
  return issuesByField(hrFieldsSchema.safeParse(input));
}
