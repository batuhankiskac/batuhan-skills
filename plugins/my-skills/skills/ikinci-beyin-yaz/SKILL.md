---
name: ikinci-beyin-yaz
description: Batuhan'ın ikinci beynine (Obsidian vault ~/IkinciBeyin) herhangi bir projeden/oturumdan not yaz. "ikinci beyne yaz", "not al", "beyne kaydet", "bunu hatırla" isteklerinde ve anlamlı bir iş parçası bitip sonucu/kararı kalıcı kaydetmek gerektiğinde kullan. Vault içinde çalışıyorsan bunun yerine vault'un kendi `beyin` skill'i geçerlidir.
---

# İkinci beyne yazma (her oturumdan)

Vault: `~/IkinciBeyin` (CLI: `python3 ~/IkinciBeyin/beyin.py --vault ~/IkinciBeyin ...`).
Asıl ve ayrıntılı protokol: `~/IkinciBeyin/.agents/skills/beyin/SKILL.md`. Bu skill kısa yoldur; burada olmayan bir durumda (kişi notu ayrıntısı, görev sözleşmesi, compact, çakışma) onu oku.

## 1. Neyi nereye yazacağına karar ver

| Bilgi | Hedef |
|---|---|
| Proje özeti, mimari, yapılanlar, kalanlar, kararlar | `knowledge/<proje>-proje-ozeti.md` (`kind: fact`, `project: <proje>`) |
| Kullanıcının TEK projeye ait kuralı/düzeltmesi | `projects/<proje>/Kurallar.md` + `🔮 850-Companion/Kurallar.md`'ye tek satır işaretçi: `- [kapsam: <proje>] <proje> işinde önce projects/<proje>/Kurallar.md dosyasını oku.` |
| Her işte geçerli kullanıcı kuralı | `🔮 850-Companion/Kurallar.md` (tarihli, 1–2 satır) |
| Bu oturumun devir kartı | `🔮 850-Companion/Last-Session.md` en üstüne `## YYYY-MM-DD HH:MM · <etiket> · <session_id[:8]>`; ne yaptık / neden / `**Karar:**` satırları / açık / sonraki adım / bağlantılar. Yalnız KENDİ kartını düzenle, ≤3000 karakter. |
| Süren açık konu | `🔮 850-Companion/Threads.md` → `## Active Threads` altında `### <konu>`; sahip + durum + sonraki adım, yerinde güncelle. Biten konu `## Closed Threads`'e tek satır. |
| Kişi | `notes/kisiler/<ad-soyad>.md` (`kind: person`; ayrıntı asıl skill'de) |
| Görev | `beyin.py task-create` (asıl skill'deki şema) |
| Yeni knowledge notu | `knowledge/index.md`'ye tek satır ekle |

Kullanıcının doğrudan söylediği karar/tercih çıkarım değildir; beklemeden yaz. Senin tahminin olgu diye yazılmaz.

## 2. Yaz — yardımcı betikle

Var olan notları doğrudan dosya araçlarıyla DÜZENLEME. Betik sha'yı kendisi okur, `note-create` / `note-edit` çağırır, sonunda `sync` çalıştırır. Betik bu skill'in klasöründe `scripts/beyin_yaz.py`'dir (skill yüklenirken gösterilen base directory; yerel kurulumda `~/.agents/skills/ikinci-beyin-yaz`):

```bash
python3 <skill-klasörü>/scripts/beyin_yaz.py ops.json
```

`ops.json` bir işlem listesidir (geçici dosyayı scratchpad'de tut):

```json
[
  {"create": "knowledge/ornek-proje-ozeti.md", "text": "# Başlık\n\nGövde", "metadata": {"kind": "fact", "project": "ornek", "visibility": "internal"}},
  {"new": "projects/ornek/Kurallar.md", "content": "# Ornek kuralları\n\n- 2026-11-09: ...\n"},
  {"edit": "🔮 850-Companion/Threads.md", "edits": [{"old": "tam bir kez geçen metin", "new": "yeni metin"}]}
]
```

- `create`: yeni `knowledge/` veya `notes/` kaydı (varsa reddedilir).
- `new`: başka klasörde yeni dosya (ör. `projects/<proje>/Kurallar.md`); varsa reddedilir.
- `edit`: var olan not; her `old` dosyada tam bir kez geçmeli. Önce `python3 ~/IkinciBeyin/beyin.py --vault ~/IkinciBeyin note-read "<yol>"` ile güncel metni gör.
- Betik bir işlem başarısız olursa durur ve hangisi olduğunu söyler; çakışmada yeniden oku, metni koruyarak tekrar kur.

## 3. Kapanış: receipt

```bash
python3 ~/IkinciBeyin/beyin.py --vault ~/IkinciBeyin receipt --harness claude \
  --event-id <konu-tarih-benzersiz> \
  --summary "Ne kaydedildi ve sonuç.
Öğrenilen: <tek cümle> | yok (<gerekçe>)" \
  --ref <değişen vault-relative yol> --ref ...
```

`--harness` kullandığın istemciye göre (`claude`, `codex`, `opencode`...). Vault dışı sonuç varsa `--link https://...`. Çıktıda `"status": "succeeded"` görmeden kaydedildi deme.

## Yapma

- Token, şifre, API anahtarı, öğrenci numarası, ham log veya transkript yazma.
- Başka oturumların Last-Session kartını, eski bölümleri veya ilgisiz notları değiştirme.
- `daily/v3/`, `knowledge/v3/outcomes.md`, `receipts/` dosyalarını elle düzenleme (otomatik üretilir).
- Last-Session >3000 veya Threads >8000 karakteri aşıyorsa önce `beyin.py companion-compact` çalıştır.
- Kullanıcı "hafızaya yazma" dediyse hiçbir şey yazma.
