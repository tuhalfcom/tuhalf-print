# Tuhalf Print

Shopify siparişlerinin baskı dosyalarını indirir, rulo sayfalara dizer, Photoshop ile PSD oluşturup basar.

## Personel için kullanım
1. **Tuhalf Print**'i aç (bilgisayar açılınca kendiliğinden de başlar, saatin yanındaki simgede durur).
2. Sol panel **Siparişler**: yeni siparişler 30 dakikada bir kendiliğinden iner.
3. Sağ panel **Baskı** → **Sıradaki yerleşim**: inen dosyaların rulo üzerindeki dizilimi.
4. **Sayfaları hazırla** → Photoshop arka planda PSD sayfaları oluşturur.
5. **Hazır sayfalar** → her sayfada **Print** (veya **Basılmamışları bas**). Photoshop, en son kullanılan yazdırma ayarlarıyla basar.

> İlk kurulumda Photoshop'ta bir sayfayı **Dosya > Yazdır** ile elle bir kez bas (yazıcı: Canon GP-2600S, 609,6 mm rulo, %100 ölçek, üst/alt boşlukları basma). Photoshop bu ayarları hatırlar; Print butonu hep bunları kullanır.

## Ekranlar
Soldaki tek menü: **Bugün** (günün işleri 1→4 ve uyarılar), **Baskı sırası**, **Hazır sayfalar**, **Siparişler**, **Kargo fişleri**, **Adres hataları**, **Tercihler**. Bir bağlantı eksikse Bugün ekranında kurulum listesi ve “Ayar dosyasını içe aktar” butonu çıkar.

## Kurallar
- Sayfa (canvas) her zaman **609,6 x 720,01 mm**. Kenar boşluğu 3 mm. Yan yana ya da üst üste gelen tasarımlar arasında **her zaman en az 1 mm** boşluk bırakılır (ayara 0 yazılsa bile).
- Siparişler eskiden yeniye dizilir. Tüm ebatlar gerekirse 90° döner. Örneğin tek başına basılan 30x42 yatay yerleşir. Hiç dönmemesi gereken ebat varsa Ayarlar > Baskı'ya yazılır.
- Tasarımlar sayfa genişliğini dolduran satırlar halinde dizilir (ör. 30x42 + yanında 2 × 15x21 ve yatay 21x30).
- Tam satır oluşturamayan **fazla tasarım bekletilir** ve sonra gelen siparişlerin yanına dizilir. **"Bekleyenleri de diz"** seçilirse hepsi hemen dizilir.
- Sayfada kalan her boşluğa (sayfanın altı, 50x70'in yanı vb.) **teşekkür kartı** otomatik yerleşir. Kart **Ayarlar > Teşekkür kartı**'ndan yüklenir. Ölçüsü 300 dpi'ye göre otomatik okunur, elle de girilebilir.
- **Sayfaları hazırla** ile oluşan PSD'ler Photoshop'ta açık kalır, operatör kontrol eder. Baskı yalnızca uygulamadaki **Print** ile alınır. Açık sayfada düzeltme yapıldıysa önce kaydedilip öyle basılır.
- Basılan sayfadaki siparişler, Siparişler listesinde yeşil **Basıldı** olur. Photoshop'tan elle basılan sayfa, sayfa kartındaki **Basıldı** butonuyla işaretlenir.
- 18:00'den sonra inenler ertesi günün klasörüne yazılır.
- **Hazır sayfalar**'da her sayfa için **Photoshop'ta aç** butonu PSD'yi doğrudan Photoshop'ta açar.
- **Ödemesi beklenen havale siparişleri basılmaz.** Shopify'da ödeme durumu “Ödenmedi”, kargo “Standart” ve ödeme yöntemi kapıda ödeme değilse sipariş havale sayılır. Dosyası iner ama dizilmez, “Ödeme bekleniyor” alanında durur, “Bekleyenleri de diz” ile de basılmaz. Operatör Shopify'da siparişi “Ödendi” yapınca bir sonraki kontrolde (veya **Şimdi kontrol et** ile) baskı sırasına girer. İptal ya da iade edilen siparişler de basılmaz. Böyle bir sipariş hazırlanmış bir sayfadaysa o sayfa Print ile basılmaz, uyarı verilir.
- **Siparişler sayfası** (üst menü > Siparişler): son 14 günün siparişleri; müşteri, şehir, ödeme durumu (kapıda ödeme / havale), kargo yöntemi ve durumu, tutar, baskı dosyaları ve baskı durumu. Arama ve filtre var. Müşteri adı için Shopify uygulamasında “korunan müşteri verisi” izni gerekir; izin yoksa o sütun boş kalır.
- Yeni sipariş inince **Siparişler** menüsünde ve panelde yeşil nokta yanar; Siparişler sayfası açılınca söner.
- **Dosyaları resetle** (Tercihler > Sıfırlama): programın oluşturduğu sipariş klasörlerini (indirilenler, _Dizildi, _Sayfalar) onay sorduktan sonra **kalıcı olarak siler**, indirme ve baskı geçmişini sıfırlar. Sonrasında eski siparişler otomatik inmez; **Yeniden indir** ile istenen siparişten itibaren temiz başlanır.
- **Kargo fişleri** (üst menü > Kargo fişleri): iki sekme.
  - **Kapıda ödeme (DHL):** Kapıda ödeme siparişleri, tuhalf etiket sunucusundan (Cloudflare `tuhalf-etiket`) gelir. **Bas** dediğinde sunucu siparişi DHL'e kaydeder ve 100×100 fişi verir; fiş etiket yazıcısına basılır. Bu, Shopify yöneticisindeki “DHL Kapıda Ödeme Etiketi” ile aynı iştir.
  - **Geliver:** Geliver'de etiketi alınmış (kod alınmış) gönderilerin fişleri buradan basılır. “Teklif alındı” durumundakiler için önce Geliver'de teklif kabul edilmelidir. Kapıda ödeme siparişleri Geliver listesinde gösterilmez.
  - Basılanlar “Basıldı” olur, ↺ ile geri alınır. Fişler Tercihler > Kargo fişleri'nde seçilen yazıcıya 100×100 mm, kenar boşluksuz basılır.
- **Adres hataları** (üst menü > Adres hataları): kargo fişi alınamayan siparişler (DHL: il/ilçe bulunamadı, telefon geçersiz; Geliver: gönderi hatası, eksik il/ilçe) ayrı ekranda durur. **Shopify'da düzelt** siparişi açar. Kapıda ödeme siparişleri Shopify'da düzeltilip **Yenile** denince listeden düşer. Geliver gönderilerinde adres Geliver'de ayrıca kayıtlıdır ve Shopify'dan kendiliğinden güncellenmez: Shopify'da düzeltip **Yenile** deyince satırda yeşil “Shopify'da düzeltilmiş” yazar, **Geliver'e aktar** ile Geliver'deki gönderi düzeltilir. Aktarmadan önce yazılacak adres onaya gelir. Müşteri ili yanlış seçip adrese doğrusunu yazdıysa (ör. İl: Afyonkarahisar, adres: Fatih İstanbul) adresteki il/ilçe kullanılır ve uyarı gösterilir.
- **Kargo fişi basma:** “Bas / Tekrar bas” önce **önizleme penceresi** açar: fişler ekranda görünür, yazıcı (ZJ-9210 kendiliğinden seçilir) ve kağıt seçilir, **Yazdır** ile basılır. Geliver fişleri 100×130 mm gelir; 100×100 kağıda küçültülerek sığdırılır (istenirse “Kağıt”tan fişin kendi ölçüsü seçilir). Sessiz baskı olmazsa “Yazdırma penceresiyle…” Windows penceresini açar. Seçilen yazıcı ve kağıt hatırlanır.
- **Eski fişler:** “Tümü / eski fişler” sekmesinde kargoya verilmiş siparişler de seçilip tekrar basılabilir (Geliver: ücretsiz; DHL: kayıtlı siparişte yeni kayıt açılmaz). Sağdaki listeden 14/30/60/90 gün seçilir. DHL'e henüz kayıtlı olmayan kapıda ödeme siparişi seçildiğinde önce “DHL'e kaydedilecek” onayı sorulur.
- **Geliver “Teklif bekleyen”:** Her gönderide Shopify ödeme durumu görünür. Havalesi gelmemiş sipariş kırmızı satırla “Havale gelmeden kargo SATIN ALMAYIN” diye işaretlenir ve satın alma düğmesi çıkmaz. Ödemesi alınmış (ör. PayTR) siparişte **HepsiJet ile satın al** düğmesi vardır: tutar ve bakiye onaya gelir, onaylanınca etiket alınır ve fiş önizlemesi açılır. Program satın almadan hemen önce Shopify'dan ödemeyi tekrar kontrol eder.
- **Geliver bakiyesi** Geliver kartının içinde görünür. Geliver anahtarı bakiyeye izin vermediği için bakiye Geliver panelinin Ödemeler sayfasından okunur: her bilgisayarda bir kez kartta “Giriş yap”a basıp Geliver'e giriş yapılır, oturum hatırlanır. Bakiye (≈ kaç kargo gönderilebileceğiyle; HepsiJet ortalaması 167,19 ₺ KDV dahil). 500 ₺'nin altına düşünce “Bakiye ekle” uyarısı çıkar.
- **Deneme fişi** (Kargo fişleri ekranı): kargo firmasına hiçbir şey göndermeden önizleme penceresinde örnek 100×100 fiş açar; yazıcıyı ve ölçüyü denemek içindir.
- **Dosyaları resetle** BASKI klasörünün kendisini silmez, sadece içindeki sipariş klasörlerini siler.
- **Ayar dosyası** (Tercihler > Kargo fişleri): bir bilgisayarda “Dışa aktar”, diğerlerinde “İçe aktar” ile tüm bilgisayarlar aynı ayarlarla kurulur. Dosyada anahtarlar var; paylaşmayın, iş bitince silin.
- **Yeni bilgisayara kurulum / sıfırlama:** Tercihler > Sıfırlama'da sipariş numarasını girip **Yeniden indir** de. O sipariş ve sonrasındaki baskı dosyaları tekrar iner (son 120 gün). Klasörde zaten olan dosyalar tekrar inmez.
- Klasörler: `Masaüstü\BASKI\GG-AA-YY-SIPARISLER\`: `_Dizildi` (dizilen kaynaklar), `_Sayfalar` (PSD sayfalar).

## Derleme (geliştirici)
```
npm install
npm test            # 43 test: adlandırma, yerleşim, klasörler, Shopify (sahte sunucu)
npm start           # geliştirme modunda aç
npm run dist:win    # dist/Tuhalf-Print-Kurulum-1.1.0.exe
npm run dist:mac    # dist/Tuhalf-Print-1.1.0-mac.dmg (Mac'te)
```
## Güncellemeler
Program açılışta ve 4 saatte bir GitHub Releases'ta yeni sürüm arar. Yeni sürüm bulunca arka planda indirir, üst çubukta **"vX.Y.Z hazır · Güncelle"** butonu çıkar. **Ayarlar > Uygulama** bölümünde sürüm numarası, **Güncellemeleri kontrol et** ve **Yeniden başlat ve güncelle** butonları var. Tepsi menüsünde de **Güncellemeleri kontrol et** bulunur. Photoshop işi sürerken kurulum başlamaz. Program kapanırken indirilmiş güncelleme varsa o da kurulur.

**Yeni sürüm yayınlamak için:**
1. `package.json` içindeki `"version"` değerini artır (ör. `1.0.1`).
2. Değişikliği GitHub'a gönder (`git commit -am "v1.1.1"` ve `git push`).
3. GitHub'da **Actions > Derle ve yayınla > Run workflow** de (ya da `git tag v1.1.1` ve `git push --tags`). Windows kurulumu derlenip `v1.1.1` adlı Release olarak yayınlanır (5-10 dk).

Elle yayınlamak için: `GH_TOKEN=<token> npm run release:win`

Depo: https://github.com/tuhalfcom/tuhalf-print. Adres `package.json > build.publish` (`owner` / `repo`) ve `repository` alanlarında. Depo farklıysa ikisini de değiştir.
Güncelleme kontrolünün şifresiz çalışması için Releases'ın bulunduğu depo **herkese açık** olmalı. Kaynak kod gizli kalacaksa kodu özel bir depoda tut, `publish` ayarını sadece sürümlerin yüklendiği ayrı ve herkese açık bir depoya (ör. `tuhalf-print-surumler`) yönlendir.
Mac sürümü imzasız olduğu için kendini güncelleyemez; Mac'te buton indirme sayfasını açar.

Ayarlar ilk açılışta `Belgeler\tuhalf-baski\ayarlar.json` dosyasından otomatik aktarılır; eski zamanlanmış görev kaldırılır.
Mac sürümü imzasızdır: ilk açılışta sağ tık > Aç.
