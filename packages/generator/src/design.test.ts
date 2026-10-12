import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  sectionsDesignSchema,
  validateDesign,
  type Cta,
  type Section,
  type SectionsDesign,
  type Theme,
} from './design.ts';
import type { SiteBrief } from './brief.ts';

// Three sectors with different facts, tone and layout. They double as renderer fixtures.

const CAFE_BRIEF: SiteBrief = {
  schemaVersion: 1,
  kind: 'business',
  language: 'tr',
  subject: {
    name: 'Moda Kahve',
    category: 'kahve dükkanı',
    location: 'Kadıköy, İstanbul',
    summary: 'Moda sahiline iki sokak mesafede, filtre kahve ve espresso sunan küçük bir dükkan.',
    schedule: 'Her gün 08:00–20:00',
  },
  items: [
    { name: 'Filtre kahve', description: null, price: '90 TL' },
    { name: 'Espresso', description: null, price: '75 TL' },
  ],
  contact: { phone: '0216 555 12 34', email: null, address: 'Moda Cad. 12, Kadıköy', url: null },
  primaryAction: 'call',
  tone: 'friendly',
};

const CAFE_DESIGN: SectionsDesign = {
  format: 'sections',
  version: 1,
  theme: {
    colors: {
      background: '#fbf7f2',
      surface: '#ffffff',
      text: '#2b1d14',
      mutedText: '#6b5848',
      primary: '#8a3b12',
      onPrimary: '#ffffff',
      accent: '#b0661a',
      border: '#eadfd3',
    },
    typography: { headingFont: 'fraunces', bodyFont: 'dm-sans', scale: 'balanced' },
    spacing: 'comfortable',
    radius: 'large',
    components: { button: 'solid', card: 'flat' },
  },
  pages: [
    {
      path: '/',
      meta: {
        title: 'Moda Kahve — Kadıköy',
        description: "Kadıköy Moda'da filtre kahve ve espresso.",
      },
      sections: [
        {
          type: 'hero',
          id: 'top',
          variant: 'split',
          eyebrow: 'Kadıköy, Moda',
          headline: 'Sahile iki sokak kala, iyi bir kahve',
          subheadline: 'Filtre kahve ve espresso, her gün sabahtan akşama.',
          ctas: [
            { action: 'call', label: 'Ara' },
            { action: 'section', label: 'Menüye bak', sectionId: 'menu' },
          ],
        },
        { type: 'items', id: 'menu', navLabel: 'Menü', variant: 'menu', title: 'Menü' },
        { type: 'about', id: 'about', navLabel: 'Hakkımızda', variant: 'text', title: 'Biz kimiz' },
        {
          type: 'contact',
          id: 'contact',
          navLabel: 'İletişim',
          variant: 'split',
          title: 'Bizi bulun',
          ctas: [
            { action: 'call', label: 'Ara' },
            { action: 'visit', label: 'Yol tarifi al' },
          ],
        },
      ],
    },
  ],
};

const LAW_BRIEF: SiteBrief = {
  schemaVersion: 1,
  kind: 'business',
  language: 'tr',
  subject: {
    name: 'Aydın Hukuk Bürosu',
    category: 'hukuk bürosu',
    location: 'Ankara',
    summary: 'İş hukuku ve ticaret hukuku alanlarında danışmanlık veren bir hukuk bürosu.',
    schedule: null,
  },
  items: [],
  contact: {
    phone: '0312 444 55 66',
    email: 'iletisim@aydinhukuk.com.tr',
    address: null,
    url: null,
  },
  primaryAction: 'email',
  tone: 'professional',
};

const LAW_DESIGN: SectionsDesign = {
  format: 'sections',
  version: 1,
  theme: {
    colors: {
      background: '#ffffff',
      surface: '#f4f6f9',
      text: '#14213d',
      mutedText: '#4a5568',
      primary: '#1f3a5f',
      onPrimary: '#ffffff',
      accent: '#94703c',
      border: '#d9dee7',
    },
    typography: { headingFont: 'lora', bodyFont: 'ibm-plex-sans', scale: 'compact' },
    spacing: 'comfortable',
    radius: 'small',
    components: { button: 'solid', card: 'bordered' },
  },
  pages: [
    {
      path: '/',
      meta: {
        title: 'Aydın Hukuk Bürosu — Ankara',
        description: 'Ankara’da iş hukuku ve ticaret hukuku danışmanlığı.',
      },
      sections: [
        {
          type: 'hero',
          id: 'top',
          variant: 'minimal',
          eyebrow: 'Hukuk bürosu · Ankara',
          headline: 'İş ve ticaret hukukunda danışmanlık',
          subheadline: null,
          ctas: [
            { action: 'email', label: 'E-posta gönderin' },
            { action: 'call', label: 'Arayın' },
          ],
        },
        { type: 'about', id: 'about', navLabel: 'Büro', variant: 'highlight', title: 'Büromuz' },
        {
          type: 'contact',
          id: 'contact',
          navLabel: 'İletişim',
          variant: 'card',
          title: 'İletişim',
          ctas: [{ action: 'email', label: 'E-posta gönderin' }],
        },
      ],
    },
  ],
};

const PORTFOLIO_BRIEF: SiteBrief = {
  schemaVersion: 1,
  kind: 'personal',
  language: 'en',
  subject: {
    name: 'Elif Demir',
    category: 'product designer',
    location: null,
    summary: null,
    schedule: null,
  },
  items: [
    { name: 'Mobile banking redesign', description: 'Onboarding and payments flows.', price: null },
    { name: 'Design system', description: null, price: null },
  ],
  contact: {
    phone: null,
    email: 'elif@example.com',
    address: null,
    url: 'https://dribbble.com/elif',
  },
  primaryAction: 'email',
  tone: 'premium',
};

const PORTFOLIO_DESIGN: SectionsDesign = {
  format: 'sections',
  version: 1,
  theme: {
    colors: {
      background: '#0f0f10',
      surface: '#1a1a1d',
      text: '#f2f0eb',
      mutedText: '#a8a59d',
      primary: '#e8c872',
      onPrimary: '#1a1405',
      accent: '#7c9cbf',
      border: '#2c2c31',
    },
    typography: { headingFont: 'playfair-display', bodyFont: 'inter', scale: 'expressive' },
    spacing: 'airy',
    radius: 'none',
    components: { button: 'outline', card: 'elevated' },
  },
  pages: [
    {
      path: '/',
      meta: { title: 'Elif Demir — Product Designer', description: 'Selected work by Elif Demir.' },
      sections: [
        {
          type: 'hero',
          id: 'top',
          variant: 'centered',
          eyebrow: 'Product designer',
          headline: 'Elif Demir',
          subheadline: null,
          ctas: [
            { action: 'email', label: 'Get in touch' },
            { action: 'section', label: 'See work', sectionId: 'work' },
          ],
        },
        { type: 'items', id: 'work', navLabel: 'Work', variant: 'grid', title: 'Selected work' },
        {
          type: 'contact',
          id: 'contact',
          navLabel: 'Contact',
          variant: 'card',
          title: 'Contact',
          ctas: [
            { action: 'email', label: 'Email' },
            { action: 'link', label: 'Dribbble' },
          ],
        },
      ],
    },
  ],
};

const EXAMPLES = [
  ['café', CAFE_BRIEF, CAFE_DESIGN],
  ['law firm', LAW_BRIEF, LAW_DESIGN],
  ['portfolio', PORTFOLIO_BRIEF, PORTFOLIO_DESIGN],
] as const;

function withSections(design: SectionsDesign, sections: SectionsDesign['pages'][0]['sections']) {
  return { ...design, pages: [{ ...design.pages[0]!, sections }] } satisfies SectionsDesign;
}

function problems(design: SectionsDesign, brief: SiteBrief): string[] {
  return validateDesign(design, brief).map((issue) => issue.problem);
}

describe('SiteDesign examples', () => {
  for (const [sector, brief, design] of EXAMPLES) {
    it(`accepts the ${sector} design`, () => {
      assert.ok(sectionsDesignSchema.safeParse(design).success);
      assert.deepEqual(validateDesign(design, brief), []);
    });
  }
});

describe('sectionsDesignSchema', () => {
  it('rejects CSS values and unknown fields', () => {
    const cssButton = {
      ...CAFE_DESIGN,
      theme: { ...CAFE_DESIGN.theme, components: { button: 'padding: 14px', card: 'flat' } },
    };
    const extraField = { ...CAFE_DESIGN, script: 'alert(1)' };

    assert.equal(sectionsDesignSchema.safeParse(cssButton).success, false);
    assert.equal(sectionsDesignSchema.safeParse(extraField).success, false);
  });

  it('rejects a URL as a button target', () => {
    const [hero] = CAFE_DESIGN.pages[0]!.sections;
    const withUrl = withSections(CAFE_DESIGN, [
      { ...hero!, ctas: [{ action: 'call', label: 'Ara', href: 'tel:000' }] } as never,
    ]);

    assert.equal(sectionsDesignSchema.safeParse(withUrl).success, false);
  });

  it('has the multi-page shape, with lowercase paths', () => {
    const twoPages = { ...CAFE_DESIGN, pages: [CAFE_DESIGN.pages[0], CAFE_DESIGN.pages[0]] };
    const badPath = { ...CAFE_DESIGN, pages: [{ ...CAFE_DESIGN.pages[0]!, path: '/Menü' }] };

    assert.ok(sectionsDesignSchema.safeParse(twoPages).success);
    assert.equal(sectionsDesignSchema.safeParse(badPath).success, false);
  });
});

describe('validateDesign', () => {
  const [hero, menu, about, contact] = CAFE_DESIGN.pages[0]!.sections;

  const withContactCta = (cta: Cta) =>
    withSections(CAFE_DESIGN, [hero!, menu!, about!, { ...contact!, ctas: [cta] } as Section]);
  const emptyContact = { phone: null, email: null, address: null, url: null };

  it('requires each button’s target in the brief', () => {
    const cases = [
      ['call', 'phone'],
      ['whatsapp', 'phone'],
      ['email', 'email'],
      ['visit', 'address'],
      ['link', 'url'],
    ] as const;
    // Keeps the schedule so the contact section stays expected, and the address for the hero's
    // primary action unless the address itself is the target under test.
    for (const [action, field] of cases) {
      const brief: SiteBrief = {
        ...CAFE_BRIEF,
        primaryAction: 'visit',
        contact: { ...emptyContact, address: field === 'address' ? null : 'Moda Cad. 12' },
      };
      const heroVisit = { ...hero!, ctas: [{ action: 'visit', label: 'Gel' }] } as Section;
      const design = withSections(CAFE_DESIGN, [
        heroVisit,
        menu!,
        about!,
        { ...contact!, ctas: [{ action, label: 'Git' }] } as Section,
      ]);

      assert.ok(
        problems(design, brief).includes(`"${action}" needs a ${field} in the brief`),
        `${action} without ${field}`,
      );
    }
  });

  it('rejects a target that is present but not usable', () => {
    const malformed = [
      ['call', { ...CAFE_BRIEF.contact, phone: 'arayın' }, 'phone'],
      ['email', { ...CAFE_BRIEF.contact, email: 'info@' }, 'email'],
      ['link', { ...CAFE_BRIEF.contact, url: 'modakahve.com' }, 'url'],
      ['visit', { ...CAFE_BRIEF.contact, address: '  Moda Cad. 12 ' }, 'address'],
    ] as const;
    for (const [action, contactDetails, field] of malformed) {
      const brief: SiteBrief = { ...CAFE_BRIEF, contact: contactDetails };

      assert.ok(
        problems(withContactCta({ action, label: 'Git' }), brief).includes(
          `"${action}" needs a valid ${field} in the brief`,
        ),
        `${action} with a malformed ${field}`,
      );
    }
  });

  it('makes the brief’s primary action the first hero button', () => {
    const [primary, secondary] = (hero as Extract<Section, { type: 'hero' }>).ctas;
    const swapped = withSections(CAFE_DESIGN, [
      { ...hero!, ctas: [secondary!, primary!] } as Section,
      menu!,
      about!,
      contact!,
    ]);

    assert.ok(
      problems(swapped, CAFE_BRIEF).includes(
        'The first hero button must be the primary action "call"',
      ),
    );
  });

  it('maps the about section to the brief’s summary', () => {
    const noSummary: SiteBrief = {
      ...CAFE_BRIEF,
      subject: { ...CAFE_BRIEF.subject, summary: null },
    };
    const withoutAbout = withSections(CAFE_DESIGN, [hero!, menu!, contact!]);

    assert.ok(
      problems(CAFE_DESIGN, noSummary).includes('The brief has no content for the about section'),
    );
    assert.ok(problems(withoutAbout, CAFE_BRIEF).includes('Missing about section'));
    assert.deepEqual(problems(withoutAbout, noSummary), []);
  });

  it('maps the items section to the brief’s items', () => {
    const noItems: SiteBrief = { ...CAFE_BRIEF, items: [] };
    const withoutItems = withSections(CAFE_DESIGN, [
      { ...hero!, ctas: [{ action: 'call', label: 'Ara' }] } as Section,
      about!,
      contact!,
    ]);

    assert.ok(
      problems(CAFE_DESIGN, noItems).includes('The brief has no content for the items section'),
    );
    assert.ok(problems(withoutItems, CAFE_BRIEF).includes('Missing items section'));
    assert.deepEqual(problems(withoutItems, noItems), []);
  });

  it('allows only a single page at "/" in version 1', () => {
    const page = CAFE_DESIGN.pages[0]!;
    const twoPages = { ...CAFE_DESIGN, pages: [page, { ...page, path: '/menu' }] };
    const notHome = { ...CAFE_DESIGN, pages: [{ ...page, path: '/menu' }] };
    const message = 'Version 1 supports a single page at "/"';

    assert.ok(problems(twoPages, CAFE_BRIEF).includes(message));
    assert.ok(problems(notHome, CAFE_BRIEF).includes(message));
  });

  it('requires every section the brief has content for, and nothing else', () => {
    const withoutContact = withSections(CAFE_DESIGN, [hero!, menu!, about!]);
    const noItems: SiteBrief = { ...CAFE_BRIEF, items: [] };

    assert.ok(problems(withoutContact, CAFE_BRIEF).includes('Missing contact section'));
    assert.ok(
      problems(CAFE_DESIGN, noItems).includes('The brief has no content for the items section'),
    );
  });

  it('requires the hero first and unique section ids', () => {
    const reordered = withSections(CAFE_DESIGN, [
      menu!,
      hero!,
      about!,
      { ...contact!, id: 'menu' },
    ]);

    const found = problems(reordered, CAFE_BRIEF);
    assert.ok(found.includes('The first section must be the hero'));
    assert.ok(found.includes('Duplicate section id "menu"'));
  });

  it('rejects a button pointing at a missing section', () => {
    const withoutMenu = withSections(CAFE_DESIGN, [hero!, about!, contact!]);

    assert.ok(
      problems(withoutMenu, { ...CAFE_BRIEF, items: [] }).includes('No section with id "menu"'),
    );
  });

  it('rejects unreadable color pairs', () => {
    const faint = {
      ...CAFE_DESIGN,
      theme: { ...CAFE_DESIGN.theme, colors: { ...CAFE_DESIGN.theme.colors, text: '#d0c8c0' } },
    };

    assert.ok(
      validateDesign(faint, CAFE_BRIEF).some((issue) => issue.path === 'theme.colors.text'),
    );
  });

  it('judges contrast by the size the color is used at', () => {
    // 3.46 on the background: enough for large text (3), not for body text (4.5).
    const midTone = '#b8763a';
    const asAccent = { ...CAFE_DESIGN.theme.colors, accent: midTone };
    const asMutedText = { ...CAFE_DESIGN.theme.colors, mutedText: midTone };
    const issuesWith = (colors: Theme['colors']) =>
      validateDesign({ ...CAFE_DESIGN, theme: { ...CAFE_DESIGN.theme, colors } }, CAFE_BRIEF);

    assert.deepEqual(issuesWith(asAccent), []);
    assert.ok(issuesWith(asMutedText).some((issue) => issue.path === 'theme.colors.mutedText'));
  });

  it('requires readable labels on primary buttons and primary-colored links', () => {
    const colors = CAFE_DESIGN.theme.colors;
    const issuesWith = (changes: Partial<Theme['colors']>) =>
      validateDesign(
        { ...CAFE_DESIGN, theme: { ...CAFE_DESIGN.theme, colors: { ...colors, ...changes } } },
        CAFE_BRIEF,
      ).map((issue) => issue.path);

    assert.ok(issuesWith({ onPrimary: '#a0522d' }).includes('theme.colors.onPrimary'));
    assert.ok(issuesWith({ primary: '#e0b090' }).includes('theme.colors.primary'));
  });
});
