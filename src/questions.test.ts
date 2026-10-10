import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyAnswers, questionsFor } from './questions.ts';
import { completeSpec, type SiteSpecDraft } from './spec.ts';

const DRAFT: SiteSpecDraft = {
  kind: 'personal',
  language: 'tr',
  subject: {
    name: null,
    category: 'grafik tasarımcı',
    location: null,
    summary: null,
    schedule: null,
  },
  items: [],
  contact: { phone: null, email: null, address: null, url: null },
  primaryAction: null,
  tone: 'professional',
};

describe('questionsFor', () => {
  it('asks one question per missing field, offering every channel for contact', () => {
    const questions = questionsFor(['name', 'contact'], 'tr');

    assert.deepEqual(
      questions.map((q) => q.inputs),
      [['name'], ['phone', 'email', 'address', 'url']],
    );
    assert.ok(questions.every((q) => q.prompt.length > 0));
  });
});

describe('applyAnswers', () => {
  it('writes valid answers into the draft so it can be completed', () => {
    const result = applyAnswers(DRAFT, { name: ' Ayşe Yılmaz ', email: 'ayse@example.com' });

    assert.ok(result.ok);
    const completion = completeSpec(result.draft);
    assert.ok(completion.complete);
    assert.equal(completion.spec.subject.name, 'Ayşe Yılmaz');
    assert.equal(completion.spec.primaryAction, 'email');
  });

  it('rejects the whole set when one answer is invalid', () => {
    const result = applyAnswers(DRAFT, { name: 'Ayşe', email: 'ayse-at-example' });

    assert.deepEqual(result, { ok: false, invalidFields: ['email'] });
  });

  it('rejects over-long answers and non-http links', () => {
    const result = applyAnswers(DRAFT, { name: 'x'.repeat(121), url: 'javascript:alert(1)' });

    assert.deepEqual(result, { ok: false, invalidFields: ['name', 'url'] });
  });

  it('ignores empty answers', () => {
    const result = applyAnswers(DRAFT, { phone: '   ' });

    assert.ok(result.ok);
    assert.equal(result.draft.contact.phone, null);
  });
});
