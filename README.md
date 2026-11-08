# batuhan-skills

Kişisel Claude Code skill'lerim, plugin marketplace olarak.

## Kurulum (yerel)

```
/plugin marketplace add batuhankiskac/batuhan-skills
/plugin install my-skills@batuhan-skills
```

Güncelleme: `/plugin marketplace update batuhan-skills`

## Bulut session'lar / bir projede otomatik yükleme

Projenin `.claude/settings.json` dosyasına ekle:

```json
{
  "extraKnownMarketplaces": {
    "batuhan-skills": {
      "source": { "source": "github", "repo": "batuhankiskac/batuhan-skills" }
    }
  },
  "enabledPlugins": {
    "my-skills@batuhan-skills": true
  }
}
```

## Yeni skill eklemek

`plugins/my-skills/skills/<isim>/SKILL.md` oluştur, `plugin.json` içindeki `version`'ı artır, push'la.
