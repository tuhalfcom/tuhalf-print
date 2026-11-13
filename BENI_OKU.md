# Tuhalf Print

Shopify siparişlerinin baskı dosyalarını indirir, rulo sayfalara dizer, Photoshop ile PSD oluşturup basar.

## Personel için kullanım
1. **Tuhalf Print**'i aç (bilgisayar açılınca kendiliğinden de başlar, saatin yanındaki simgede durur).
2. Sol panel **Siparişler**: yeni siparişler 30 dakikada bir kendiliğinden iner.
3. Sağ panel **Baskı** → **Sıradaki yerleşim**: inen dosyaların rulo üzerindeki dizilimi.
4. **Sayfaları hazırla** → Photoshop arka planda PSD sayfaları oluşturur.
5. **Hazır sayfalar** → her sayfada **Print** (veya **Basılmamışları bas**). Photoshop, en son kullanılan yazdırma ayarlarıyla basar.

> İlk kurulumda Photoshop'ta bir sayfayı **Dosya > Yazdır** ile elle bir kez bas (yazıcı: Canon GP-2600S, 609,6 mm rulo, %100 ölçek, üst/alt boşlukları basma). Photoshop bu ayarları hatırlar; Print butonu hep bunları kullanır.

## Kurallar
- Sayfa (canvas) her zaman **609,6 x 720,01 mm**. Kenar boşluğu 3 mm, tasarımlar arası **1 mm**.
- Siparişler eskiden yeniye dizilir. Tüm ebatlar gerekirse 90° döner. Örneğin tek başına basılan 30x42 yatay yerleşir. Hiç dönmemesi gereken ebat varsa Ayarlar > Baskı'ya yazılır.
- Tasarımlar sayfa genişliğini dolduran satırlar halinde dizilir (ör. 30x42 + yanında 2 × 15x21 ve yatay 21x30).
- Tam satır oluşturamayan **fazla tasarım bekletilir** ve sonra gelen siparişlerin yanına dizilir. **"Bekleyenleri de diz"** seçilirse hepsi hemen dizilir.
- Sayfada kalan her boşluğa (sayfanın altı, 50x70'in yanı vb.) **teşekkür kartı** otomatik yerleşir. Kart **Ayarlar > Teşekkür kartı**'ndan yüklenir. Ölçüsü 300 dpi'ye göre otomatik okunur, elle de girilebilir.
- **Sayfaları hazırla** ile oluşan PSD'ler Photoshop'ta açık kalır, operatör kontrol eder. Baskı yalnızca uygulamadaki **Print** ile alınır. Açık sayfada düzeltme yapıldıysa önce kaydedilip öyle basılır.
- Basılan sayfadaki siparişler, Siparişler listesinde yeşil **Basıldı** olur. Photoshop'tan elle basılan sayfa, sayfa kartındaki **Basıldı** butonuyla işaretlenir.
- 18:00'den sonra inenler ertesi günün klasörüne yazılır.
- Klasörler: `Masaüstü\BASKI\GG-AA-YY-SIPARISLER\`: `_Dizildi` (dizilen kaynaklar), `_Sayfalar` (PSD sayfalar).

## Derleme (geliştirici)
```
npm install
npm test            # 18 test: adlandırma, yerleşim, klasörler, Shopify (sahte sunucu)
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
