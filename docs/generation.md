# Site üretimi: SiteSpec ve generation akışı

**Durum:** Önerildi — açık soru: kritik alanlara telefon da girsin mi?

İlke ([D1](decisions.md#d1-kodu-llm-değil-sistem-yönetir)): kullanıcının verdiği gerçek bilgiler sabit bir forma (SiteSpec) konur. Üretim adımındaki LLM yalnızca bu formdaki bilgileri kullanır.

## Akış

```
brief
  │
  ▼
1. Analiz (LLM, yapılandırılmış çıktı) → SiteSpec taslağı
  │
  ▼
2. Kod: zod ile doğrula → kritik alan eksik mi?
  │            └─ evet → sabit Türkçe sorular (kod üretir) → awaiting_input
  │                         kullanıcı cevabı → kod spec'e yazar → 2'ye dön
  ▼
3. Üretim (LLM) → spec'ten HTML; spec dışında bilgi yasak
  │
  ▼
4. Kod: kontroller (yapı + bilgi tutarlılığı) → completed / failed
```

- Sorular LLM'e değil koda aittir. Eksik alan listesi deterministik, soru metinleri sabittir; cevap doğrudan ilgili spec alanına yazılır. Cevaplar için ikinci bir LLM çağrısı yapılmaz.

## SiteSpec — Faz 1

```ts
const siteSpecSchema = z.object({
  schemaVersion: z.literal(1),
  language: z.enum(['tr', 'en']),
  business: z.object({
    name: z.string().min(1), // kritik
    type: z.string().min(1), // kritik: "kahve kavurucusu", "diş kliniği"
    city: z.string().nullable(),
    summary: z.string().nullable(), // kullanıcının kendi anlatımı
  }),
  offerings: z.array(
    z.object({
      // ürün/hizmet, kullanıcının verdiği kadar
      name: z.string().min(1),
      description: z.string().nullable(),
      price: z.string().nullable(),
    }),
  ),
  contact: z.object({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    hours: z.string().nullable(),
  }),
  primaryAction: z.enum(['call', 'whatsapp', 'email', 'visit', 'booking']),
  tone: z.enum(['professional', 'friendly', 'premium']),
  sections: z.array(z.enum(['hero', 'offerings', 'about', 'faq', 'contact'])),
});
```

Kurallar:

- **`null` = bilinmiyor.** Üretim adımı `null` alan için içerik yazmaz, ilgili bölümü atlar.
- **Kritik alanlar:** `business.name`, `business.type`. Eksikse üretim başlamaz, kullanıcıya sorulur. Diğer alanlar eksikse sorulmaz; ilgili bölüm sitede yer almaz.
- **`tone` ve `sections`** brief'te yoksa koddaki sektör varsayılanlarından gelir, LLM tahminine bırakılmaz.
- **Testimonial ve istatistik bölümü yoktur.** Kullanıcı vermediyse içerikleri her zaman uydurma olur.
- **`schemaVersion`:** Spec veritabanında `jsonb` olarak saklanır; şema değişince eski kayıtların hangi sürümle okunacağı buradan bilinir.

## Kontroller (adım 4)

- Mevcut yapısal HTML kontrolleri (`evals/checks.ts`).
- **Bilgi tutarlılığı:** HTML'de geçen her telefon numarası ve e-posta spec'te bulunmalı. Bulunmuyorsa model uydurmuştur, üretim başarısız sayılır.

## Generation kaydı

| Alan                            | Neden                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`, `projectId` (→ `ownerId`) | Sahiplik ve yetki kontrolü ([D8](decisions.md#d8-sahiplik-ilk-şemadan-itibaren-var))             |
| `status`                        | `queued` → `analyzing` → `awaiting_input` → `generating` → `validating` → `completed` / `failed` |
| `brief`                         | Kullanıcının orijinal girdisi                                                                    |
| `spec` (jsonb)                  | Üretimin kaynağı, yeniden üretilebilirlik                                                        |
| `missingFields`                 | `awaiting_input` durumunda sorulacak alanlar                                                     |
| `html`                          | Çıktı ([D9](decisions.md#d9-faz-1de-üretilen-html-postgresqlde-saklanır))                        |
| `model`, `promptVersion`        | Kalite takibi                                                                                    |
| `inputTokens`, `outputTokens`   | Kota ve maliyet                                                                                  |
| `errorCode`, zaman damgaları    | Hata takibi                                                                                      |

## İleride (Faz 1'de yok)

- Spec'i form üzerinden düzenleyip tek bölümü yeniden üretme
- Görsel ve logo yükleme
- Çok sayfalı siteler
- Sektöre özel zengin şablon kütüphanesi
- Spec'ten backend üretimi (Faz 2)

Mevcut şema bunların hiçbirini engellemez; hepsi yeni alan ve yeni adım olarak eklenir.
