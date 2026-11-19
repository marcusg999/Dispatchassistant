/**
 * Domain vocabulary shared by the portal, the admin console and the functions.
 * Values match the Postgres enums in supabase/migrations exactly.
 */

export const CATEGORIES = ['safety', 'trucks_equipment', 'scheduling_dispatch', 'crating_shop', 'pay_policy', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  safety: 'Safety',
  trucks_equipment: 'Trucks & Equipment',
  scheduling_dispatch: 'Scheduling & Dispatch',
  crating_shop: 'Crating & Shop',
  pay_policy: 'Pay & Policy',
  other: 'Other',
};

/** Ascending urgency (matches the Postgres enum order). */
export const TAGS = ['just_sayin', 'casual', 'important', 'urgent', 'crucial'] as const;
export type Tag = (typeof TAGS)[number];
export const TAG_LABEL: Record<Tag, string> = {
  just_sayin: 'I’m just sayin’',
  casual: 'Casual',
  important: 'Important',
  urgent: 'Urgent',
  crucial: 'Crucial',
};
/** One-line plain-language hint shown under each choice on the form. */
export const TAG_HINT: Record<Tag, string> = {
  just_sayin: 'Just putting it out there. No action needed.',
  casual: 'Small thing. Whenever there’s time.',
  important: 'Worth fixing. No rush.',
  urgent: 'Causing problems now. Needs attention soon.',
  crucial: 'Someone could get hurt, or art could be damaged.',
};
/** Numeric rank for "sort by priority" (higher = more pressing). */
export const TAG_RANK: Record<Tag, number> = { just_sayin: 0, casual: 1, important: 2, urgent: 3, crucial: 4 };

export const STATUSES = ['new', 'reviewing', 'planned', 'done', 'declined'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  planned: 'Planned',
  done: 'Done',
  declined: 'Declined',
};
/** Plain-language explanation shown to submitters on the status screen. */
export const STATUS_HINT: Record<Status, string> = {
  new: 'Received. Not reviewed yet.',
  reviewing: 'The office is looking into it.',
  planned: 'A change is planned.',
  done: 'Handled.',
  declined: 'The office decided not to act on this one.',
};

export const BODY_MIN = 10;
export const BODY_MAX = 4000;
export const PHOTO_MAX_BYTES = 1_500_000;
export const PHOTO_MAX_EDGE = 1600;
/** Minimum time on the form before a submit is accepted (bot speed bump). */
export const MIN_FORM_MS = 3000;
