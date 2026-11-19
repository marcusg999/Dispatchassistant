/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BRAND CONFIG: the ONLY file you edit to re-skin Dispatch Buddy for a client.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Never put a company name anywhere else in the codebase. Everything that is
 *  shown to people (portal, admin console, 404 page, exports, flyer) reads from
 *  here. Colors become CSS variables (`--brand-*`) at build time, and Tailwind
 *  tokens point at those variables, so changing a hex here re-colors everything.
 *
 *  Contrast rules (WCAG 2.2 AA). Keep these true when you change colors:
 *    • `ink` and `muted` on `paper` and on `wall`    ≥ 4.5 : 1
 *    • `ink` on `accent` (text on orange buttons)    ≥ 4.5 : 1
 *    • `accentText` on `paper`                       ≥ 4.5 : 1
 *  Run `npm test` and the contrast test checks these for you.
 *
 *  See README → "Rebrand for a new client".
 */

export interface BrandConfig {
  /** Product name shown in titles, headers, exports. */
  appName: string;
  /** Optional client display name ("for <company>"). Leave "" for none. */
  companyName: string;
  /** Path (relative to /public) of a logo image, or "" to use the type-only wordmark. */
  logoPath: string;
  /** One line shown in the footer: how to reach a human. Never a person's name. */
  supportLine: string;
  /** Who reads submissions, in plain words. Default copy never names a company. */
  officeNoun: string;
  colors: {
    /** Page background: gallery wall / light concrete. */
    wall: string;
    /** Raised surfaces: fields, cards, label plates. */
    paper: string;
    /** Primary text and strong rules. */
    ink: string;
    /** Secondary text. */
    muted: string;
    /** Hairlines and borders. */
    line: string;
    /** Signal color for fills (buttons, tags, the success crate tag). Text on it is `ink`. */
    accent: string;
    /** The accent darkened enough to be used as TEXT on `paper`. */
    accentText: string;
    /** Focus ring color. */
    focus: string;
    /** Error text. */
    danger: string;
  };
  /** Priority tag colors. Used in admin chips and the Excel/Word export column. */
  tagColors: Record<'just_sayin' | 'casual' | 'important' | 'urgent' | 'crucial', { bg: string; fg: string }>;
  portal: {
    /** Small caps eyebrow above the headline, like an exhibition label number. */
    eyebrow: string;
    /** The big headline. */
    headline: string;
    /** One or two sentences under the headline. */
    welcome: string;
    /** The honest privacy promise. Do not claim "untraceable". */
    promise: string;
  };
}

export const brand: BrandConfig = {
  appName: 'Dispatch Buddy',
  companyName: '',
  logoPath: '',
  supportLine: 'Questions about this box? Ask the office for the printed flyer.',
  officeNoun: 'the office',
  colors: {
    wall: '#E9E6E0',
    paper: '#F8F7F4',
    ink: '#141413',
    muted: '#58554F',
    line: '#C4BFB5',
    accent: '#FF5A1F',
    accentText: '#A53A08',
    focus: '#1F4FFF',
    danger: '#A1160E',
  },
  tagColors: {
    just_sayin: { bg: '#F1EEE8', fg: '#141413' },
    casual: { bg: '#CFD8D1', fg: '#141413' },
    important: { bg: '#DCD8D0', fg: '#141413' },
    urgent: { bg: '#FF5A1F', fg: '#141413' },
    crucial: { bg: '#141413', fg: '#FFFFFF' },
  },
  portal: {
    eyebrow: 'Suggestion box',
    headline: 'Speak freely.',
    welcome:
      'Tell the office what would make the work safer, smoother or fairer. Big or small, it all gets read.',
    promise: 'Your name is never asked for or stored. Management sees only what you write.',
  },
};

/** "Dispatch Buddy" or "Dispatch Buddy · Client Co." */
export function displayName(b: BrandConfig = brand): string {
  return b.companyName ? `${b.appName} · ${b.companyName}` : b.appName;
}

/** CSS custom properties generated from the config. Injected into every HTML page at build time. */
export function brandCssVars(b: BrandConfig = brand): string {
  const c = b.colors;
  const t = b.tagColors;
  const tagVars = Object.entries(t).flatMap(([k, v]) => [`--tag-${k}-bg:${v.bg}`, `--tag-${k}-fg:${v.fg}`]);
  const lines = [
    `--brand-wall:${c.wall}`,
    `--brand-paper:${c.paper}`,
    `--brand-ink:${c.ink}`,
    `--brand-muted:${c.muted}`,
    `--brand-line:${c.line}`,
    `--brand-accent:${c.accent}`,
    `--brand-accent-text:${c.accentText}`,
    `--brand-focus:${c.focus}`,
    `--brand-danger:${c.danger}`,
    ...tagVars,
  ];
  return `:root{${lines.join(';')}}`;
}
