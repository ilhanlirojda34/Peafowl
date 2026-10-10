import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SiteSpec } from './spec.ts';
import { findUnsupportedFacts } from './verify.ts';

const SPEC: SiteSpec = {
  schemaVersion: 1,
  kind: 'business',
  language: 'tr',
  subject: {
    name: 'Moda Kahve',
    category: 'kahve dükkanı',
    location: 'Kadıköy',
    summary: 'Aylık abonelik 300 ile başlar.',
    schedule: 'Her gün 08.00 - 20.00',
  },
  items: [{ name: 'Filtre kahve', description: null, price: '₺90' }],
  contact: {
    phone: '0216 555 12 34',
    email: 'merhaba@modakahve.com',
    address: 'Moda Cd. 1, Kadıköy',
    url: 'https://modakahve.com/',
  },
  primaryAction: 'call',
  tone: 'friendly',
};

function page(body: string): string {
  return `<!doctype html><html lang="tr"><head><style>.p{margin:0 2025px}</style></head><body>${body}<script>const x = 12345678901;</script></body></html>`;
}

describe('findUnsupportedFacts', () => {
  it('accepts a page that only uses facts from the spec', () => {
    const html = page(`
      <a href="tel:02165551234">+90 216 555 12 34</a>
      <a href="mailto:merhaba@modakahve.com">merhaba@modakahve.com</a>
      <a href="https://www.modakahve.com/menu">Menü</a>
      <a href="https://www.google.com/maps/search/?api=1&amp;query=Moda">Yol tarifi</a>
      <a href="#iletisim">İletişim</a>
      <p>Filtre kahve 90 TL · Abonelik 300 TL</p>
      <p>Her gün 08.00 - 20.00</p>
      <svg><path d="M12 345.6 789 1011 1213 1415 1617"/></svg>`);

    assert.deepEqual(findUnsupportedFacts(html, SPEC), []);
  });

  it('flags invented contact details, links and prices', () => {
    const html = page(`
      <a href="tel:+902129998877">Ara</a>
      <p>info@modakahve.com.tr</p>
      <a href="https://instagram.com/modakahve">Instagram</a>
      <p>Espresso ₺75,00</p>`);

    assert.deepEqual(findUnsupportedFacts(html, SPEC), [
      { kind: 'phone', value: '+902129998877' },
      { kind: 'email', value: 'info@modakahve.com.tr' },
      { kind: 'link', value: 'https://instagram.com/modakahve' },
      { kind: 'price', value: '₺75,00' },
    ]);
  });

  it('does not join numbers from neighbouring elements into a phone number', () => {
    const html = page('<p>0216 555 12 34</p><p>2024</p>');

    assert.deepEqual(findUnsupportedFacts(html, SPEC), []);
  });

  it('allows a WhatsApp link only for the spec phone number', () => {
    const allowed = page('<a href="https://wa.me/902165551234">WhatsApp</a>');
    const invented = page('<a href="https://wa.me/905550000000">WhatsApp</a>');

    assert.deepEqual(findUnsupportedFacts(allowed, SPEC), []);
    assert.equal(findUnsupportedFacts(invented, SPEC).length, 1);
  });
});
