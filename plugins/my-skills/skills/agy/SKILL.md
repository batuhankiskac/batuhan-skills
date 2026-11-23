---
name: agy
description: Batuhan'ın makinesindeki agy (Antigravity CLI) kodlama ajanına mesaj gönder veya iş yaptır. "agy'ye sor", "agy'ye yaptır", "agy ile yap", "agy tarafındaki modele söyle/selam ver", "işi agy'ye ver", "Gemini'ye yaptır (agy)" gibi isteklerde kullan. agy kendi modelini kullanır (varsayılan Gemini 4 Hydrogen); Claude'un kendi alt ajanlarıyla veya omp ile karıştırma.
---

# agy'ye iş yaptırma

`agy` = `/opt/homebrew/bin/agy`, Antigravity'nin kodlama ajanı CLI'si (kendi modeli, kendi araçları: dosya okuma/yazma, terminal vb.). Claude ona yazdırma modunda (`-p`) iş verir ve çıktısını okur. `--cwd` bayrağı yok: agy, komutun çalıştığı klasörde çalışır, bu yüzden önce `cd` yap.

## 1. Model

Varsayılan model Gemini 4 Hydrogen. Kullanıcı belli bir model isterse `--model <id>` ver; id'yi tahmin etme, `agy models` ile listele (ör. `gemini-4-hydrogen-high`, `gemini-3.8-flash-medium`, `claude-sonnet-5-5-medium`). Akıl yürütme seviyesi için `--effort low|medium|high|xhigh|max`.

## 2. İşi gönder

Tek seferlik soru / selam:

```bash
agy -p "<mesaj>" --print-timeout 90s 2>&1 | tail -40
```

Bir klasörde iş yaptırma (dosya yazar, komut çalıştırır):

```bash
cd "<mutlak klasör yolu>" && agy -p "<görev>" --mode auto --print-timeout 10m --output-format json 2>&1 | tail -c 4000
```

- İzin modları (başsız modda agy onay soramaz, izin gerekmeyen araç otomatik reddedilir):
  - `--mode plan`: sadece okusun/planlasın.
  - `--mode accept-edits`: dosya düzenleyebilir ama terminal komutu çalıştıramaz ("no output produced — a tool required the "command" permission" hatası verir).
  - `--mode auto`: dosya yazar ve komut çalıştırır. Kod işi için genelde bu gerekir.
  - `--dangerously-skip-permissions`: her şeyi onaylar; kullanıcı açıkça istemedikçe kullanma.
- `--output-format json` çıktısında `conversation_id`, `status`, `response`, `usage` gelir; işi sürdürmek için `conversation_id`'yi not et.
- `--add-dir <klasör>` ile ek klasör erişimi verilebilir.
- Bash çağrısına `timeout` ver (600000'e kadar); 2 dakikayı geçebilecek işleri `run_in_background: true` ile çalıştır ve bildirim bekle.
- Görevi agy'ye bağlamı olmayan biri gibi yaz: klasör, dosyalar, ne yapılacak, "bitti" ne demek, sonunda kısa özet istendiği.
- `auto` modda agy onay sormadan araç kullanır. Bu yüzden daima işin yapılacağı klasörde çalıştır; kullanıcının açıkça istemediği bir projede veya geri alınamaz işlerde (silme, push, deploy, para) agy'ye iş verme.

Aynı işe devam ettirmek:

```bash
cd "<aynı klasör>" && agy --conversation <conversation_id> -p "<ek talimat>" --mode auto --print-timeout 10m 2>&1 | tail -60
```

Dikkat: `-p`'den hemen sonra prompt gelmeli; `-p --conversation ...` yazarsan agy bayrağı prompt sanar ve hata verir.

(`-c` aynı klasördeki en son konuşmayı sürdürür; araya başka agy çağrısı girdiyse `--conversation` daha güvenli.)

## 3. Sonucu doğrula ve aktar

- agy'nin "yaptım" demesi kanıt değil: değişen dosyaları (`git diff`, `ls`, `cat`) kendin kontrol et.
- Kullanıcıya agy'nin cevabını (gerekirse alıntı olarak) ve senin doğruladığın şeyi ayrı ayrı söyle.

## Bilinen hatalar

| Çıktı | Anlamı / çözüm |
|---|---|
| `no output produced — a tool required the "command" permission ...` | Mod komut çalıştırmaya izin vermiyor; `--mode auto` ile tekrar çalıştır. |
| Komut asılı kalıyor | `--print-timeout` ver (ör. `10m`); 0 sınırsız bekler. |
