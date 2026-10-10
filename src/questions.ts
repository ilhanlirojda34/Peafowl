import {
  cleanText,
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
  type ContactField,
  type Language,
  type MissingField,
  type SiteSpecDraft,
} from './spec.ts';

/** A value the user can type in answer to a question. */
export type AnswerField = 'name' | 'category' | ContactField;
export type Answers = Partial<Record<AnswerField, string>>;

export interface Question {
  readonly field: MissingField;
  readonly prompt: string;
  /** The inputs shown for this question. For `contact`, any one of them is enough. */
  readonly inputs: readonly AnswerField[];
}

const MAX_ANSWER_LENGTH: Readonly<Record<AnswerField, number>> = {
  name: 120,
  category: 120,
  phone: 30,
  email: 254,
  address: 300,
  url: 2048,
};

const PROMPTS: Readonly<Record<Language, Readonly<Record<MissingField, string>>>> = {
  tr: {
    name: 'Sitenin adı ne olsun? (işletme, kişi, ürün ya da etkinlik adı)',
    category:
      'Ne yapıyorsunuz? Kısaca yazın (ör. kahve dükkanı, grafik tasarımcı, yazılım konferansı).',
    phone: 'Telefon numaranız nedir?',
    email: 'E-posta adresiniz nedir?',
    address: 'Adresiniz nedir?',
    url: 'Ziyaretçileri hangi bağlantıya yönlendirelim? (kayıt, bağış, mağaza vb.)',
    contact: 'Ziyaretçiler size nasıl ulaşsın? En az birini doldurun.',
  },
  en: {
    name: 'What should the site be called? (business, person, product or event name)',
    category:
      'What do you do? Describe it briefly (e.g. coffee shop, graphic designer, developer conference).',
    phone: 'What is your phone number?',
    email: 'What is your email address?',
    address: 'What is your address?',
    url: 'Which link should visitors be sent to? (sign-up, donation, store, etc.)',
    contact: 'How should visitors reach you? Fill in at least one.',
  },
};

export const ANSWER_LABELS: Readonly<Record<Language, Readonly<Record<AnswerField, string>>>> = {
  tr: {
    name: 'Ad',
    category: 'Ne yapıyorsunuz',
    phone: 'Telefon',
    email: 'E-posta',
    address: 'Adres',
    url: 'Bağlantı',
  },
  en: {
    name: 'Name',
    category: 'What you do',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    url: 'Link',
  },
};

export const INVALID_ANSWER_MESSAGE: Readonly<Record<Language, string>> = {
  tr: 'Bu alanlardaki değerler geçersiz, lütfen kontrol edin',
  en: 'These values are not valid, please check them',
};

const CONTACT_INPUTS: readonly AnswerField[] = ['phone', 'email', 'address', 'url'];

export function questionsFor(missing: readonly MissingField[], language: Language): Question[] {
  return missing.map((field) => ({
    field,
    prompt: PROMPTS[language][field],
    inputs: field === 'contact' ? CONTACT_INPUTS : [field],
  }));
}

export type AnswerResult =
  | { readonly ok: true; readonly draft: SiteSpecDraft }
  | { readonly ok: false; readonly invalidFields: readonly AnswerField[] };

/**
 * Writes the user's answers into the draft. Answers are untrusted input: each one passes the same
 * normalisation as analysed values, and one invalid answer rejects the whole set unchanged.
 * Empty answers are ignored; whether the draft is now complete is decided by completeSpec.
 */
export function applyAnswers(draft: SiteSpecDraft, answers: Answers): AnswerResult {
  const accepted: Partial<Record<AnswerField, string>> = {};
  const invalidFields: AnswerField[] = [];

  for (const [field, raw] of Object.entries(answers) as [AnswerField, string | undefined][]) {
    if (raw === undefined || raw.trim() === '') continue;
    const value = raw.length > MAX_ANSWER_LENGTH[field] ? null : normalizeAnswer(field, raw);
    if (value === null) invalidFields.push(field);
    else accepted[field] = value;
  }

  if (invalidFields.length > 0) return { ok: false, invalidFields };

  return {
    ok: true,
    draft: {
      ...draft,
      subject: {
        ...draft.subject,
        name: accepted.name ?? draft.subject.name,
        category: accepted.category ?? draft.subject.category,
      },
      contact: {
        phone: accepted.phone ?? draft.contact.phone,
        email: accepted.email ?? draft.contact.email,
        address: accepted.address ?? draft.contact.address,
        url: accepted.url ?? draft.contact.url,
      },
    },
  };
}

function normalizeAnswer(field: AnswerField, value: string): string | null {
  switch (field) {
    case 'phone':
      return normalizePhone(value);
    case 'email':
      return normalizeEmail(value);
    case 'url':
      return normalizeUrl(value);
    case 'name':
    case 'category':
    case 'address':
      return cleanText(value);
  }
}
