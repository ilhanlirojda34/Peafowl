import { z } from 'zod';

export const SITE_KINDS = ['business', 'personal', 'product', 'event', 'organization'] as const;
export const LANGUAGES = ['tr', 'en'] as const;
export const PRIMARY_ACTIONS = ['call', 'whatsapp', 'email', 'visit', 'link'] as const;
export const TONES = ['professional', 'friendly', 'premium'] as const;

export type SiteKind = (typeof SITE_KINDS)[number];
export type Language = (typeof LANGUAGES)[number];
export type PrimaryAction = (typeof PRIMARY_ACTIONS)[number];
export type Tone = (typeof TONES)[number];
export type ContactField = 'phone' | 'email' | 'address' | 'url';

/** A field the user has to supply before generation can start. `contact` means "any contact channel". */
export type MissingField = 'name' | 'category' | ContactField | 'contact';

/**
 * What the analysis step extracts from a brief. Every fact is nullable: null means the brief does not
 * say it. Plain strings only (no transforms), so the schema can be sent to the model as JSON Schema.
 */
export const siteSpecDraftSchema = z.object({
  kind: z.enum(SITE_KINDS),
  language: z.enum(LANGUAGES),
  subject: z.object({
    name: z.string().nullable(),
    category: z.string().nullable(),
    location: z.string().nullable(),
    summary: z.string().nullable(),
    schedule: z.string().nullable(),
  }),
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      price: z.string().nullable(),
    }),
  ),
  contact: z.object({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    url: z.string().nullable(),
  }),
  primaryAction: z.enum(PRIMARY_ACTIONS).nullable(),
  tone: z.enum(TONES),
});

export type SiteSpecDraft = z.infer<typeof siteSpecDraftSchema>;

export interface SiteItem {
  readonly name: string;
  readonly description: string | null;
  readonly price: string | null;
}

export interface SiteSpec {
  readonly schemaVersion: 1;
  readonly kind: SiteKind;
  readonly language: Language;
  readonly subject: {
    readonly name: string;
    readonly category: string;
    readonly location: string | null;
    readonly summary: string | null;
    readonly schedule: string | null;
  };
  readonly items: readonly SiteItem[];
  readonly contact: Readonly<Record<ContactField, string | null>>;
  readonly primaryAction: PrimaryAction;
  readonly tone: Tone;
}

export type SpecCompletion =
  | { readonly complete: true; readonly spec: SiteSpec }
  | { readonly complete: false; readonly missing: readonly MissingField[] };

export const ACTION_TARGET: Readonly<Record<PrimaryAction, ContactField>> = {
  call: 'phone',
  whatsapp: 'phone',
  email: 'email',
  visit: 'address',
  link: 'url',
};

/** Used when the brief does not name a primary action: the first one whose target is known wins. */
const DEFAULT_ACTIONS: Readonly<Record<SiteKind, readonly PrimaryAction[]>> = {
  business: ['call', 'visit', 'email', 'link'],
  personal: ['email', 'link', 'call'],
  product: ['link', 'email'],
  event: ['link', 'visit', 'email'],
  organization: ['link', 'email', 'call', 'visit'],
};

/**
 * Turns an analysed draft into a spec, or reports what the user still has to answer.
 * Invalid contact values are dropped rather than trusted, so they surface as missing when they matter.
 */
export function completeSpec(draft: SiteSpecDraft): SpecCompletion {
  const name = cleanText(draft.subject.name);
  const category = cleanText(draft.subject.category);
  const contact = normalizeContact(draft.contact);

  const missing: MissingField[] = [];
  if (name === null) missing.push('name');
  if (category === null) missing.push('category');

  const action = resolvePrimaryAction(draft.kind, draft.primaryAction, contact);
  if (action.missing !== undefined) missing.push(action.missing);

  if (name === null || category === null || action.primaryAction === undefined) {
    return { complete: false, missing };
  }

  return {
    complete: true,
    spec: {
      schemaVersion: 1,
      kind: draft.kind,
      language: draft.language,
      subject: {
        name,
        category,
        location: cleanText(draft.subject.location),
        summary: cleanText(draft.subject.summary),
        schedule: cleanText(draft.subject.schedule),
      },
      items: draft.items.flatMap((item) => {
        const itemName = cleanText(item.name);
        if (itemName === null) return [];
        return [
          {
            name: itemName,
            description: cleanText(item.description),
            price: cleanText(item.price),
          },
        ];
      }),
      contact,
      primaryAction: action.primaryAction,
      tone: draft.tone,
    },
  };
}

function resolvePrimaryAction(
  kind: SiteKind,
  stated: PrimaryAction | null,
  contact: Readonly<Record<ContactField, string | null>>,
): { primaryAction?: PrimaryAction; missing?: MissingField } {
  if (stated !== null) {
    const target = ACTION_TARGET[stated];
    return contact[target] === null ? { missing: target } : { primaryAction: stated };
  }
  const available = DEFAULT_ACTIONS[kind].find((action) => contact[ACTION_TARGET[action]] !== null);
  return available === undefined ? { missing: 'contact' } : { primaryAction: available };
}

export type SectionKind = 'hero' | 'items' | 'about' | 'contact';

/** Sections are derived from the data: a section without facts behind it is not rendered. */
export function sectionsFor(spec: SiteSpec): SectionKind[] {
  const hasContact =
    Object.values(spec.contact).some((value) => value !== null) || spec.subject.schedule !== null;
  return [
    'hero',
    ...(spec.items.length > 0 ? (['items'] as const) : []),
    ...(spec.subject.summary !== null ? (['about'] as const) : []),
    ...(hasContact ? (['contact'] as const) : []),
  ];
}

/** Peafowl targets the Turkish market: a national-format number (leading 0) is read as Turkish. */
const DEFAULT_COUNTRY_CODE = '90';

/** The link behind the primary button. Built by code so the model never writes a target itself. */
export function primaryActionHref(spec: SiteSpec): string {
  const target = spec.contact[ACTION_TARGET[spec.primaryAction]];
  // completeSpec guarantees the target exists; this guards against a hand-built spec.
  if (target === null) throw new Error(`Primary action "${spec.primaryAction}" has no target`);

  switch (spec.primaryAction) {
    case 'call':
      return `tel:${target.replace(/[^\d+]/g, '')}`;
    case 'whatsapp':
      return `https://wa.me/${internationalDigits(target)}`;
    case 'email':
      return `mailto:${target}`;
    case 'visit':
      return mapsSearchUrl(target);
    case 'link':
      return target;
  }
}

export function mapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function internationalDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+')) return digits;
  return digits.startsWith('0') ? DEFAULT_COUNTRY_CODE + digits.slice(1) : digits;
}

// ---------------------------------------------------------------------------------------------
// Normalisation. Shared by the analysis draft and by user answers, so both pass the same rules.
// ---------------------------------------------------------------------------------------------

const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;
const emailSchema = z.email();

export function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function normalizePhone(value: string | null): string | null {
  const text = cleanText(value);
  if (text === null || !/^\+?[\d\s().-]+$/.test(text)) return null;
  const digitCount = text.replace(/\D/g, '').length;
  return digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS ? text : null;
}

export function normalizeEmail(value: string | null): string | null {
  const text = cleanText(value);
  return text !== null && emailSchema.safeParse(text).success ? text : null;
}

/** Accepts "example.com" as https://example.com; only http(s) URLs survive. */
export function normalizeUrl(value: string | null): string | null {
  const text = cleanText(value);
  if (text === null) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeContact(
  contact: SiteSpecDraft['contact'],
): Readonly<Record<ContactField, string | null>> {
  return {
    phone: normalizePhone(contact.phone),
    email: normalizeEmail(contact.email),
    address: cleanText(contact.address),
    url: normalizeUrl(contact.url),
  };
}
