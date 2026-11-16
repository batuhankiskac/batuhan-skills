---
name: omp
description: Batuhan'ın makinesindeki omp (oh-my-pi) kodlama ajanına mesaj gönder veya iş yaptır. "omp'ye sor", "omp'ye yaptır", "omp tarafındaki modele söyle/selam ver", "işi omp'ye ver", "omp ile dene" gibi isteklerde kullan. omp kendi modelini (config'deki varsayılan) kullanır; Claude'un kendi alt ajanlarıyla karıştırma.
---

# omp'ye iş yaptırma

`omp` = `/opt/homebrew/bin/omp`, ayrı bir kodlama ajanı CLI'si (kendi modeli, kendi araçları: dosya okuma/yazma, bash vb.). Claude ona komut satırından, yazdırma modunda (`-p`) iş verir ve çıktısını okur.

## 1. Hangi modelin çalışacağını kontrol et

```bash
sed -n '/modelRoles:/,/^[a-zA-Z]/p' ~/.omp/agent/config.yml | head -5
```

`default:` satırı omp'nin kullanacağı modeldir. Kullanıcı belli bir model isterse `--model "<sağlayıcı/model>"` ver; model adını bilmiyorsan `omp models find <desen>` ile ara, tahmin etme.

## 2. İşi gönder

Tek seferlik soru / selam (oturum kaydı bırakmaz):

```bash
omp -p --no-session "<mesaj>" 2>&1 | tail -40
```

Bir klasörde iş yaptırma (dosya okur/yazar, komut çalıştırır):

```bash
omp -p --cwd "<mutlak klasör yolu>" --max-time 10m "<görev>" 2>&1 | tail -60
```

- Bash çağrısına `timeout` ver (iş uzunsa 600000'e kadar); 2 dakikayı geçebilecek işleri `run_in_background: true` ile çalıştır ve bildirim bekle.
- Görevi omp'ye bağlamı olmayan biri gibi yaz: klasör, dosyalar, ne yapılacak, "bitti" ne demek, sonunda kısa özet istendiği.
- Yazdırma modunda omp onay sormadan araç kullanır (dosya yazar, komut çalıştırır). Bu yüzden `--cwd`'yi daima işin yapılacağı klasöre ver; kullanıcının açıkça istemediği bir projede, geri alınamaz işlerde (silme, push, deploy, para) omp'ye iş verme.
- `--max-cost <USD>` ile harcamayı sınırlayabilirsin; ücretli bir model varsayılansa kullan.

Aynı işe devam ettirmek (son oturumu sürdürür; `--no-session` ile başlatılmış işler devam ettirilemez):

```bash
omp -p -c --cwd "<aynı klasör>" "<ek talimat>" 2>&1 | tail -60
```

## 3. Sonucu doğrula ve aktar

- omp'nin "yaptım" demesi kanıt değil: değişen dosyaları (`git diff`, `ls`, `cat`) kendin kontrol et.
- Kullanıcıya omp'nin cevabını (gerekirse alıntı olarak) ve senin doğruladığın şeyi ayrı ayrı söyle.

## Bilinen hatalar

| Çıktı | Anlamı / çözüm |
|---|---|
| `403 An active OpenCode Go subscription is required` | Varsayılan model `opencode-go/...` aboneliği istiyor (`*-free` olanlar dahil). Kullanıcıdan omp'de modeli değiştirmesini iste veya `--model` ile çalışan bir model ver. |
| `Model "..." not found` | Model adı yanlış; `omp models find <desen>` ile doğrusunu bul. |
| `ENAMETOOLONG ... mkdir ~/.omp/agent/sessions/...` | Klasör yolu çok uzun (ör. Claude scratch/scratchpad klasörleri), oturum klasörü adı sığmıyor. `--no-session` kullan ya da işi kısa yollu bir klasörde yaptır. |
| `~` içinde başlatınca geçici klasöre geçiyor | `--cwd` ver (ya da bilerek `--allow-home`). |
