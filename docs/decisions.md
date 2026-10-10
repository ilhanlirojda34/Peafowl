# Mimari kararlar

Peafowl'un mimari ve teknoloji kararları. Her karar, alındığı andaki bilgiyle verilmiş en iyi tahmindir; bağlayıcı değildir. Gerekçesi geçersiz kalan bir karar, bu dosyada güncellenerek değiştirilir. Eski karar silinmez, durumu `Değiştirildi` yapılır ve yerine geçen karara bağlantı verilir.

Durumlar: `Kabul` · `Değerlendiriliyor` · `Önerildi` · `Değiştirildi`

Yeni bir teknoloji önerisi şu iki soruya cevap vermeden eklenmez: hangi problemi çözüyor, ve mevcut çözümler neden yetmiyor.

---

## D1. Kodu LLM değil, sistem yönetir

- **Durum:** Kabul
- **Karar:** Kullanıcının girdisi kodla analiz edilir, eksik bilgiler tamamlanır ve sabit bir forma (SiteSpec) dönüştürülür. LLM yalnızca bu formu uygular. Detay: [generation.md](generation.md).
- **Neden:** Serbest brief'ten doğrudan üretimde model eksik bilgiyi uyduruyor ve İngilizceden çeviri gibi duran metinler yazıyor. Kalite, modele bırakılmayıp sistem tarafından yönetilmeli.
- **Ne zaman değişir:** Değişmesi beklenmiyor. Ürünün temel ilkesi.

## D2. Monorepo; web, API ve worker ayrı uygulamalar

- **Durum:** Kabul
- **Karar:**
  ```
  apps/web       Next.js, sadece UI
  apps/api       Fastify, HTTP API
  apps/worker    Arka plan üretim işleri
  packages/generator   Site üretim çekirdeği (bugünkü src/)
  packages/db          Şema ve migration'lar
  ```
- **Neden:** Faz 2 bir backend ürünü (kullanıcı sitelerine DB, auth, otomasyon). İş mantığı UI framework'ünün içinde büyümemeli. Worker zaten ayrı bir process olmak zorunda (üretim dakikalar sürüyor); API de ayrı olunca ikisi aynı paketleri doğal olarak paylaşıyor. Cal.com (`apps/web` + `apps/api`) ve Twenty (`twenty-front` + `twenty-server`) aynı ayrımı kullanıyor.
- **Alternatif:** API'yi Next.js route handler'larında tutmak. Daha az servis demek, ama iş mantığıyla UI arasındaki sınır bulanıklaşıyor.
- **Bedel:** Üç ayrı deploy birimi (aynı sunucuda çalışabilirler). Web ve API farklı origin'de olursa CORS ve cookie ayarı gerekir.
- **Ne zaman değişir:** Faz 1'de bile ayrı API'nin bakım yükü kazancından ağır basarsa.

## D3. API: Fastify, domain'e göre modüler monolith

- **Durum:** Kabul
- **Karar:** Modüller domain'e göre bölünür: `auth`, `projects`, `generations`, `quota`. Her modül bir Fastify plugin'idir. Modüller birbirinin tablolarını doğrudan okumaz, bilinçli açılmış fonksiyonlar üzerinden konuşur.
- **Neden:** Fastify'ın plugin encapsulation'ı modül sınırlarını framework seviyesinde destekliyor. Şema tabanlı istek doğrulaması yerleşik.
- **Alternatif:** NestJS. ASP.NET'e en yakın yapı (modüller, DI, controller'lar), ama decorator ve DI katmanı bu ölçek için gereğinden fazla soyutlama.
- **Ne zaman değişir:** Modül sayısı ve ekip büyüdüğünde Fastify'da elle kurulan yapı yetersiz kalırsa.

## D4. Ana veritabanı: PostgreSQL

- **Durum:** Kabul
- **Karar:** Tüm kalıcı veri (kullanıcılar, projeler, generation kayıtları, SiteSpec, üretilen HTML) PostgreSQL'de.
- **Neden:** İlişkisel veri, transaction ihtiyacı ve `jsonb` desteği (SiteSpec için) tek veritabanında karşılanıyor.
- **Ne zaman değişir:** Somut bir ihtiyaç Postgres'in karşılayamayacağı noktaya gelirse.

## D5. Arka plan işleri: pg-boss

- **Durum:** Değerlendiriliyor
- **Karar:** Üretim job'ları pg-boss ile PostgreSQL üzerinde kuyruğa alınır. Kullanıcıyı bekleten işler ile toplu işler (eval vb.) ayrı kuyruklarda tutulur.
- **Neden:** Ek servis gerektirmiyor. `Generation` kaydı ile job aynı transaction'da yazılıyor; kayıt var ama job yok durumu oluşmuyor. Bizim yükümüz düşük (dakikada birkaç job, her biri dakikalar süren tek LLM çağrısı).
- **Alternatif:** Redis + BullMQ. Yüksek hacim, global rate limiter ve job flow'ları için daha güçlü, ama ek servis ve outbox ihtiyacı getiriyor.
- **Bilinen riskler (Basedash'in production deneyimi):** singleton/dedup ayarı job'ları hatasız sessizce düşürebilir → kullanılırsa alarm konur; bağlantı havuzu yük patlamalarında tükenebilir → boyutu bilinçli ayarlanır.
- **Ne zaman değişir:** Saniyede yüzlerce job, birden çok worker arasında global rate limit ihtiyacı ya da karmaşık job flow'ları. Kuyruk çağrısı yalnızca `generations` modülünde durur, geçiş o modülle sınırlı kalır.

## D6. Redis ve NoSQL veritabanı yok

- **Durum:** Kabul
- **Karar:** Faz 1'de Redis, MongoDB veya başka bir NoSQL eklenmez.
- **Neden:** Bunların çözeceği somut bir problem yok. Kuyruk (D5) ve esnek veri (`jsonb`) Postgres'te karşılanıyor.
- **Ne zaman değişir:** Ölçülmüş bir ihtiyaç (cache, rate limit, hacim) Postgres ile çözülemezse.

## D7. LLM erişimi: Vercel AI SDK + Gemini, streaming

- **Durum:** Kabul
- **Karar:** LLM'i yalnızca generator çekirdeği çağırır. Model dışarıdan enjekte edilir. Yanıt stream edilir ve idle timeout uygulanır: yavaş ama ilerleyen model bitirebilir, takılan model kesilir.
- **Neden:** Sabit bir toplam timeout, yavaş modeli takılan modelden ayıramıyor. Model enjeksiyonu testlerde gerçek API'ye gitmeden mock kullanmayı ve ileride provider/key kaynağını (secret manager, BYOK) tek noktadan değiştirmeyi sağlıyor.
- **Ne zaman değişir:** Gemini kalite veya maliyet açısından yetersiz kalırsa provider değişir; mimari değişmez.

## D8. Sahiplik ilk şemadan itibaren var

- **Durum:** Kabul
- **Karar:** `Project` ve ona bağlı her kayıt ilk migration'dan itibaren bir sahibe bağlıdır. Her sorgu sahibe göre filtrelenir. Login ekranları sonra gelebilir, şemadaki sahiplik gelemez.
- **Neden:** Sahipliği sonradan eklemek her tabloya, sorguya ve endpoint'e geri dönmek demek.

## D9. Faz 1'de üretilen HTML PostgreSQL'de saklanır

- **Durum:** Kabul
- **Karar:** Tek sayfalık çıktı (yaklaşık 50 KB) `Generation` kaydında tutulur. Object storage eklenmez.
- **Ne zaman değişir:** Çok dosyalı çıktılar, görsel yükleme veya büyük dosyalar geldiğinde.

## D10. Önizleme izolasyonu

- **Durum:** Kabul
- **Karar:** Üretilen site, uygulamadan ayrı bir origin'den servis edilir ve `allow-same-origin` olmadan `sandbox` iframe içinde gösterilir.
- **Neden:** Üretilen HTML içindeki JavaScript'in kullanıcının uygulama oturumuna erişmemesi gerekiyor. Tek başına iframe bunu garanti etmiyor.

## D11. Secret'lar ve loglar

- **Durum:** Kabul
- **Karar:** `.env*` dosyaları commit'lenmez (`.env.example` hariç). API key, kullanıcı brief'i ve LLM request body'si loglara yazılmaz. Config hataları değişken adını verir, değeri vermez.
- **Neden:** Bir key daha önce git geçmişine sızdı. Provider hataları request body'yi (system prompt + kullanıcı brief'i) taşıyor.

## D12. Geliştirici araçları uygulama config'inden ayrı

- **Durum:** Kabul
- **Karar:** CLI ve eval gibi araçların ayarları (ör. `EVAL_CONCURRENCY`) kendi giriş noktalarında okunur, uygulama config'ine girmez.
- **Neden:** Uygulama config'i web, API ve worker tarafından paylaşılacak; ürünle ilgisiz ayar taşımamalı.
