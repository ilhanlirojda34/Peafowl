import { z } from 'zod';
import {
  ACTION_TARGET,
  cleanText,
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
  sectionsFor,
  type ContactField,
  type PrimaryAction,
  type SiteBrief,
} from './brief.ts';

// -----------------------------------------------------------------------------------------------
// SiteDesign: what a site looks like and says, apart from its facts.
//
// Facts (names, contact details, items, prices, schedule) live only in the SiteBrief. The design
// holds layout choices, design tokens and written copy, and refers to facts instead of copying
// them: a CTA names an action, never a URL; an items section lists the brief's items. So the model
// that writes a design cannot change a phone number, and links are only ever built from verified
// data. Rendering a sections design takes both the design and the brief.
//
// Tokens are closed choices, not CSS values, so the renderer owns every line of CSS. Colors are
// the one open value, because they carry most of a site's identity; they are checked for contrast.
// -----------------------------------------------------------------------------------------------

const COPY_LIMITS = {
  label: 32,
  title: 70,
  headline: 90,
  sentence: 220,
  metaDescription: 160,
} as const;

const copy = (max: number) => z.string().trim().min(1).max(max);
const optionalCopy = (max: number) => copy(max).nullable();

/** Fonts the renderer ships itself (no font CDN). Each covers Turkish (ç ğ ı İ ö ş ü). */
export const FONTS = [
  'inter',
  'manrope',
  'dm-sans',
  'ibm-plex-sans',
  'space-grotesk',
  'fraunces',
  'playfair-display',
  'lora',
] as const;

const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb color');

/** Where each color may be used is fixed by COLOR_USES below; the renderer must follow it. */
export const themeSchema = z.strictObject({
  colors: z.strictObject({
    background: color,
    surface: color,
    text: color,
    mutedText: color,
    primary: color,
    onPrimary: color,
    accent: color,
    border: color,
  }),
  typography: z.strictObject({
    headingFont: z.enum(FONTS),
    bodyFont: z.enum(FONTS),
    scale: z.enum(['compact', 'balanced', 'expressive']),
  }),
  spacing: z.enum(['compact', 'comfortable', 'airy']),
  radius: z.enum(['none', 'small', 'medium', 'large']),
  components: z.strictObject({
    button: z.enum(['solid', 'outline', 'soft']),
    card: z.enum(['flat', 'bordered', 'elevated']),
  }),
});

const sectionId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'Use a short lowercase anchor id');

/** Actions whose target is a contact detail in the brief (see CTA_TARGETS). */
const CONTACT_ACTIONS = [
  'call',
  'whatsapp',
  'email',
  'visit',
  'link',
] as const satisfies readonly PrimaryAction[];

/** A button. It names what it does; the target is resolved from the brief, never written here. */
const ctaSchema = z.union([
  z.strictObject({ action: z.enum(CONTACT_ACTIONS), label: copy(COPY_LIMITS.label) }),
  z.strictObject({ action: z.literal('section'), label: copy(COPY_LIMITS.label), sectionId }),
]);

/** Shown in the header navigation when set. */
const navLabel = optionalCopy(COPY_LIMITS.label);

/*
 * The section catalog. A new section type is a new member here, a rule in sectionsFor and its
 * renderer; nothing else changes. Each type carries only its copy. What it shows from the brief:
 *
 * | type    | present when (sectionsFor)                  | shows from the brief, unchanged             |
 * |---------|---------------------------------------------|--------------------------------------------|
 * | hero    | always                                      | subject.name (as the site's name)          |
 * | items   | brief.items is not empty                     | every item, in brief order: name,           |
 * |         |                                             | description and price when set             |
 * | about   | subject.summary is set                      | subject.summary                            |
 * | contact | a contact detail or subject.schedule is set | every contact detail that is set, location |
 * |         |                                             | and schedule                               |
 */
const heroSection = z.strictObject({
  type: z.literal('hero'),
  id: sectionId,
  variant: z.enum(['centered', 'split', 'minimal']),
  eyebrow: optionalCopy(COPY_LIMITS.label),
  headline: copy(COPY_LIMITS.headline),
  subheadline: optionalCopy(COPY_LIMITS.sentence),
  /** The first button is the brief's primary action. */
  ctas: z.array(ctaSchema).min(1).max(2),
});

const itemsSection = z.strictObject({
  type: z.literal('items'),
  id: sectionId,
  navLabel,
  variant: z.enum(['grid', 'list', 'menu']),
  title: copy(COPY_LIMITS.title),
});

const aboutSection = z.strictObject({
  type: z.literal('about'),
  id: sectionId,
  navLabel,
  variant: z.enum(['text', 'highlight']),
  title: copy(COPY_LIMITS.title),
});

const contactSection = z.strictObject({
  type: z.literal('contact'),
  id: sectionId,
  navLabel,
  variant: z.enum(['card', 'split']),
  title: copy(COPY_LIMITS.title),
  ctas: z.array(ctaSchema).max(3),
});

export const sectionSchema = z.discriminatedUnion('type', [
  heroSection,
  itemsSection,
  aboutSection,
  contactSection,
]);

/** The schema has the multi-page shape; how many pages a version may have is a validation rule. */
const pageSchema = z.strictObject({
  path: z.string().regex(/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/, 'Use a lowercase path such as /menu'),
  meta: z.strictObject({
    title: copy(COPY_LIMITS.title),
    description: copy(COPY_LIMITS.metaDescription),
  }),
  sections: z.array(sectionSchema).min(1),
});

export const sectionsDesignSchema = z.strictObject({
  format: z.literal('sections'),
  version: z.literal(1),
  theme: themeSchema,
  pages: z.array(pageSchema).min(1),
});

export type Theme = z.infer<typeof themeSchema>;
export type Cta = z.infer<typeof ctaSchema>;
export type CtaAction = Cta['action'];
export type Section = z.infer<typeof sectionSchema>;
export type SectionType = Section['type'];
export type SectionsDesign = z.infer<typeof sectionsDesignSchema>;
type Page = SectionsDesign['pages'][number];

/**
 * The stored design of a site version: everything, besides the brief, needed to produce its HTML
 * without a model call. `format` selects how it is rendered:
 *
 * - `html`: a page the model wrote in full (paid plan, D13); shown as stored.
 * - `sections`: a structured design rendered by code (free plan, D13).
 */
export type SiteDesign = { readonly format: 'html'; readonly html: string } | SectionsDesign;

export function renderDesign(design: SiteDesign): string {
  switch (design.format) {
    case 'html':
      return design.html;
    case 'sections':
      // The renderer will take the brief as well: renderDesign(design, brief).
      throw new Error('The sections renderer is not implemented yet');
  }
}

// -----------------------------------------------------------------------------------------------
// Rules the schema cannot express because they depend on the brief or on several fields at once.
// -----------------------------------------------------------------------------------------------

export interface DesignIssue {
  readonly path: string;
  readonly problem: string;
}

/** Version 1 sites are one page at "/". */
const MAX_PAGES = 1;
const HOME_PATH = '/';

/** What each button needs from the brief. A missing or malformed target makes the design invalid. */
export const CTA_TARGETS: Readonly<Record<CtaAction, ContactField | 'section'>> = {
  ...ACTION_TARGET,
  section: 'section',
};

/** A target is usable only in the normalized form completeBrief produces. */
const isUsableTarget: Readonly<Record<ContactField, (value: string) => boolean>> = {
  phone: (value) => normalizePhone(value) === value,
  email: (value) => normalizeEmail(value) === value,
  address: (value) => cleanText(value) === value,
  url: (value) => normalizeUrl(value) === value,
};

/**
 * WCAG 2.1 AA minimums (1.4.3). "large" is text of at least 24px, or 18.66px bold; the renderer
 * uses a color with a "large" minimum only at that size or for non-text graphics (1.4.11).
 */
const MIN_CONTRAST = { body: 4.5, large: 3 } as const;

type ColorName = keyof Theme['colors'];

/**
 * Every place a color is drawn as text or a meaningful graphic, and the size it is used at.
 * `border` is decorative only. The renderer must not use a color anywhere not listed here.
 */
const COLOR_USES: readonly {
  readonly foreground: ColorName;
  readonly on: readonly ColorName[];
  readonly size: keyof typeof MIN_CONTRAST;
}[] = [
  { foreground: 'text', on: ['background', 'surface'], size: 'body' },
  { foreground: 'mutedText', on: ['background', 'surface'], size: 'body' },
  // Links and outline/soft button labels.
  { foreground: 'primary', on: ['background', 'surface'], size: 'body' },
  // Solid button labels.
  { foreground: 'onPrimary', on: ['primary'], size: 'body' },
  // Display headings and decorative graphics only.
  { foreground: 'accent', on: ['background', 'surface'], size: 'large' },
];

/**
 * Checks a schema-valid design against the brief it was made for. An empty list means the
 * renderer can draw it; otherwise the design must not be rendered.
 */
export function validateDesign(design: SectionsDesign, brief: SiteBrief): DesignIssue[] {
  return [
    ...themeIssues(design.theme),
    ...pageCountIssues(design.pages),
    ...design.pages.flatMap((page, index) => pageIssues(page, index, brief)),
  ];
}

function themeIssues({ colors }: Theme): DesignIssue[] {
  return COLOR_USES.flatMap(({ foreground, on, size }) =>
    on.flatMap((background) => {
      const ratio = contrastRatio(colors[foreground], colors[background]);
      return ratio >= MIN_CONTRAST[size]
        ? []
        : [
            {
              path: `theme.colors.${foreground}`,
              problem: `${foreground} on ${background} has contrast ${ratio.toFixed(2)}, below ${MIN_CONTRAST[size]} for ${size} text`,
            },
          ];
    }),
  );
}

function pageCountIssues(pages: readonly Page[]): DesignIssue[] {
  return pages.length <= MAX_PAGES && pages.every((page) => page.path === HOME_PATH)
    ? []
    : [{ path: 'pages', problem: `Version 1 supports a single page at "${HOME_PATH}"` }];
}

function pageIssues(page: Page, pageIndex: number, brief: SiteBrief): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const at = (path: string) => `pages.${pageIndex}.${path}`;
  const { sections } = page;

  const [hero] = sections;
  if (hero?.type !== 'hero') {
    issues.push({ path: at('sections.0'), problem: 'The first section must be the hero' });
  } else if (hero.ctas[0]?.action !== brief.primaryAction) {
    issues.push({
      path: at('sections.0.ctas.0'),
      problem: `The first hero button must be the primary action "${brief.primaryAction}"`,
    });
  }

  const ids = new Set<string>();
  const types = new Set<SectionType>();
  sections.forEach((section, index) => {
    if (ids.has(section.id)) {
      issues.push({
        path: at(`sections.${index}.id`),
        problem: `Duplicate section id "${section.id}"`,
      });
    }
    if (types.has(section.type)) {
      issues.push({
        path: at(`sections.${index}.type`),
        problem: `Duplicate ${section.type} section`,
      });
    }
    ids.add(section.id);
    types.add(section.type);
  });

  // Every section the brief has facts for is shown, and none without facts is invented.
  const expected = new Set<SectionType>(sectionsFor(brief));
  for (const type of expected) {
    if (!types.has(type)) issues.push({ path: at('sections'), problem: `Missing ${type} section` });
  }
  sections.forEach((section, index) => {
    if (!expected.has(section.type)) {
      issues.push({
        path: at(`sections.${index}`),
        problem: `The brief has no content for the ${section.type} section`,
      });
    }
  });

  sections.forEach((section, sectionIndex) => {
    if (section.type !== 'hero' && section.type !== 'contact') return;
    section.ctas.forEach((cta, ctaIndex) => {
      const problem = ctaProblem(cta, brief, ids, section.id);
      if (problem !== null) {
        issues.push({ path: at(`sections.${sectionIndex}.ctas.${ctaIndex}`), problem });
      }
    });
  });
  return issues;
}

function ctaProblem(
  cta: Cta,
  brief: SiteBrief,
  sectionIds: ReadonlySet<string>,
  ownSectionId: string,
): string | null {
  if (cta.action === 'section') {
    if (!sectionIds.has(cta.sectionId)) return `No section with id "${cta.sectionId}"`;
    return cta.sectionId === ownSectionId ? 'A button must not point at its own section' : null;
  }
  const field = ACTION_TARGET[cta.action];
  const target = brief.contact[field];
  if (target === null) return `"${cta.action}" needs a ${field} in the brief`;
  return isUsableTarget[field](target)
    ? null
    : `"${cta.action}" needs a valid ${field} in the brief`;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Relative luminance as defined by WCAG 2. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
