/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BRAND CONFIG: the ONLY file you edit to re-skin Air Ride Op for a client.
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
 *    • `onAccent` on `accent`                        ≥ 4.5 : 1
 *  The same rules apply to `darkColors` and `darkTagColors` (night mode in the admin console).
 *  Run `npm test` and the contrast test checks these for you.
 *
 *  See README → "Rebrand for a new client".
 */

export type TagColors = Record<'just_sayin' | 'casual' | 'important' | 'urgent' | 'crucial', { bg: string; fg: string }>;

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
    /** Signal color for fills (buttons, tags, the success crate tag). */
    accent: string;
    /** Text drawn ON the accent fill. Stays dark in both modes. */
    onAccent: string;
    /** The accent darkened enough to be used as TEXT on `paper`. */
    accentText: string;
    /** Focus ring color. */
    focus: string;
    /** Error text. */
    danger: string;
  };
  /** Priority tag colors. Used in admin chips and the Excel/Word export column. */
  tagColors: TagColors;
  /** Night-mode palette (admin console). Same keys as `colors`; the accent stays signal orange. */
  darkColors: BrandConfig['colors'];
  /** Night-mode priority tag colors. */
  darkTagColors: TagColors;
  portal: {
    /** Small caps eyebrow above the headline, like an exhibition label number. */
    eyebrow: string;
    /** The big headline. */
    headline: string;
    /** One or two sentences under the headline. */
    welcome: string;
    /** The honest privacy promise. Do not claim "untraceable". */
    promise: string;
    /** The NAMED "HR eyes only" section for personal issues. */
    hr: {
      /** Short name of the reader, e.g. "HR". */
      noun: string;
      /** Label of the mode switch option. */
      option: string;
      /** One-line explanation under the option. */
      optionHint: string;
      /** The not-anonymous notice shown at the top of the HR form. */
      notice: string;
    };
  };
}

export const brand: BrandConfig = {
  appName: 'Air Ride Op',
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
    onAccent: '#141413',
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
  darkColors: {
    wall: '#0F0F0E',
    paper: '#1A1A18',
    ink: '#F2F0EB',
    muted: '#A8A49B',
    line: '#3D3B36',
    accent: '#FF5A1F',
    onAccent: '#141413',
    accentText: '#FF8A57',
    focus: '#7C9BFF',
    danger: '#FF7A6E',
  },
  darkTagColors: {
    just_sayin: { bg: '#262521', fg: '#F2F0EB' },
    casual: { bg: '#2B3A31', fg: '#F2F0EB' },
    important: { bg: '#3A3832', fg: '#F2F0EB' },
    urgent: { bg: '#FF5A1F', fg: '#141413' },
    crucial: { bg: '#F2F0EB', fg: '#141413' },
  },
  portal: {
    eyebrow: 'Suggestion box',
    headline: 'Speak freely.',
    welcome:
      'Tell the office what would make the work safer, smoother or fairer. Big or small, it all gets read.',
    promise: 'Your name is never asked for or stored. Management sees only what you write.',
    hr: {
      noun: 'HR',
      option: 'Personal issue · HR eyes only',
      optionHint: 'Not anonymous. Your name goes to HR only.',
      notice:
        'This is not anonymous. Your name is required so HR can follow up with you. Only the HR team can read it: managers and other office staff can’t.',
    },
  },
};

/** "Air Ride Op" or "Air Ride Op · Client Co." */
export function displayName(b: BrandConfig = brand): string {
  return b.companyName ? `${b.appName} · ${b.companyName}` : b.appName;
}

function varLines(c: BrandConfig['colors'], t: TagColors): string {
  const tagVars = Object.entries(t).flatMap(([k, v]) => [`--tag-${k}-bg:${v.bg}`, `--tag-${k}-fg:${v.fg}`]);
  return [
    `--brand-wall:${c.wall}`,
    `--brand-paper:${c.paper}`,
    `--brand-ink:${c.ink}`,
    `--brand-muted:${c.muted}`,
    `--brand-line:${c.line}`,
    `--brand-accent:${c.accent}`,
    `--brand-on-accent:${c.onAccent}`,
    `--brand-accent-text:${c.accentText}`,
    `--brand-focus:${c.focus}`,
    `--brand-danger:${c.danger}`,
    ...tagVars,
  ].join(';');
}

/** Night-mode rules only: explicit `data-theme="dark"`, or the device preference unless light is forced. */
export function brandDarkCssVars(b: BrandConfig = brand): string {
  const v = `color-scheme:dark;${varLines(b.darkColors, b.darkTagColors)}`;
  return `:root[data-theme="dark"]{${v}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${v}}}`;
}

/**
 * CSS custom properties generated from the config. Injected into every HTML page at build time.
 * `dark: false` omits night mode (the public portal and quote page stay light).
 */
export function brandCssVars(b: BrandConfig = brand, opts: { dark?: boolean } = {}): string {
  const light = `:root{color-scheme:light;${varLines(b.colors, b.tagColors)}}`;
  return opts.dark === false ? light : light + brandDarkCssVars(b);
}
