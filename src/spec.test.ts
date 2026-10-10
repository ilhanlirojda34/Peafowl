import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  completeSpec,
  internationalDigits,
  normalizeUrl,
  primaryActionHref,
  sectionsFor,
  type SiteSpec,
  type SiteSpecDraft,
} from './spec.ts';

function draft(overrides: Partial<SiteSpecDraft> = {}): SiteSpecDraft {
  return {
    kind: 'business',
    language: 'tr',
    subject: {
      name: 'Moda Kahve',
      category: 'kahve dükkanı',
      location: 'Kadıköy',
      summary: null,
      schedule: null,
    },
    items: [],
    contact: { phone: '0216 555 12 34', email: null, address: null, url: null },
    primaryAction: null,
    tone: 'friendly',
    ...overrides,
  };
}

function completed(input: SiteSpecDraft): SiteSpec {
  const result = completeSpec(input);
  assert.ok(result.complete, 'expected a complete spec');
  return result.spec;
}

describe('completeSpec', () => {
  it('completes a draft and picks the default action whose target is known', () => {
    const spec = completed(draft());

    assert.equal(spec.subject.name, 'Moda Kahve');
    assert.equal(spec.primaryAction, 'call');
    assert.equal(spec.schemaVersion, 1);
  });

  it('reports a missing name and category', () => {
    const result = completeSpec(
      draft({
        subject: { name: '  ', category: null, location: null, summary: null, schedule: null },
      }),
    );

    assert.deepEqual(result, { complete: false, missing: ['name', 'category'] });
  });

  it('asks for the target of an action the brief named', () => {
    const result = completeSpec(draft({ primaryAction: 'email' }));

    assert.deepEqual(result, { complete: false, missing: ['email'] });
  });

  it('asks for any contact channel when no action can be resolved', () => {
    const result = completeSpec(
      draft({ contact: { phone: null, email: null, address: null, url: null } }),
    );

    assert.deepEqual(result, { complete: false, missing: ['contact'] });
  });

  it('follows the kind-specific order of default actions', () => {
    const spec = completed(
      draft({
        kind: 'event',
        contact: { phone: '0532 000 00 00', email: null, address: 'Harbiye', url: 'devfest.tr' },
      }),
    );

    assert.equal(spec.primaryAction, 'link');
    assert.equal(spec.contact.url, 'https://devfest.tr/');
  });

  it('drops invalid contact values instead of trusting them', () => {
    const result = completeSpec(
      draft({
        primaryAction: 'email',
        contact: { phone: 'call us', email: 'not-an-email', address: null, url: null },
      }),
    );

    assert.deepEqual(result, { complete: false, missing: ['email'] });
  });

  it('drops items without a name', () => {
    const spec = completed(
      draft({
        items: [
          { name: 'Filtre kahve', description: null, price: '90 TL' },
          { name: ' ', description: 'x', price: null },
        ],
      }),
    );

    assert.deepEqual(spec.items, [{ name: 'Filtre kahve', description: null, price: '90 TL' }]);
  });
});

describe('sectionsFor', () => {
  it('only includes sections that have facts behind them', () => {
    assert.deepEqual(sectionsFor(completed(draft())), ['hero', 'contact']);

    const full = completed(
      draft({
        subject: {
          name: 'Moda Kahve',
          category: 'kahve dükkanı',
          location: null,
          summary: 'Kendi çekirdeğimizi kavuruyoruz.',
          schedule: null,
        },
        items: [{ name: 'Filtre kahve', description: null, price: null }],
      }),
    );
    assert.deepEqual(sectionsFor(full), ['hero', 'items', 'about', 'contact']);
  });
});

describe('primaryActionHref', () => {
  it('builds each action link from the contact data', () => {
    assert.equal(primaryActionHref(completed(draft())), 'tel:02165551234');
    assert.equal(
      primaryActionHref(completed(draft({ primaryAction: 'whatsapp' }))),
      'https://wa.me/902165551234',
    );
    assert.equal(
      primaryActionHref(
        completed(
          draft({
            primaryAction: 'visit',
            contact: { phone: null, email: null, address: 'Moda Cd. 1, Kadıköy', url: null },
          }),
        ),
      ),
      'https://www.google.com/maps/search/?api=1&query=Moda%20Cd.%201%2C%20Kad%C4%B1k%C3%B6y',
    );
  });
});

describe('normalisation helpers', () => {
  it('keeps an explicit country code and reads a leading 0 as Turkish', () => {
    assert.equal(internationalDigits('+44 20 7946 0000'), '442079460000');
    assert.equal(internationalDigits('0532 111 22 33'), '905321112233');
  });

  it('accepts only http(s) URLs', () => {
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUrl('ftp://example.com'), null);
    assert.equal(normalizeUrl('example.com/kayit'), 'https://example.com/kayit');
  });
});
