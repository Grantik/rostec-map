# Ростех × Маркетплейсы — интерактивная карта пересечений

Картирование трудовых зон пересечения между Ростех-предприятиями и РЦ маркетплейсов (WB, Ozon) в 2019-2028. Плюс слой М&A событий ВПК в гражданских секторах.

**Live**: https://YOUR-USERNAME.github.io/REPO-NAME/

## Архитектура

```
├── index.html               ← точка входа
├── src/
│   ├── map.js               ← вся логика
│   └── map.css              ← стили
├── data/                    ← ВСЕ обновляемые данные
│   ├── rostec.json          ← 143 предприятия
│   ├── marketplaces.json    ← 60 РЦ
│   ├── timelines.json       ← 26 событий-таймлайнов
│   ├── cities.json          ← 34 города-подписи
│   ├── acquisitions.json    ← M&A события
│   └── meta.json            ← версия + счётчики
├── scripts/
│   ├── update.py            ← CLI добавления записей
│   └── pre-commit           ← git-hook валидации
└── .github/workflows/
    └── deploy.yml           ← auto-deploy Pages
```

## Quick start

### Первый запуск (локально)

```bash
git clone git@github.com:YOUR/REPO.git
cd REPO

# Установить pre-commit hook (валидация + auto-bump meta)
cp scripts/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

# Локальный preview (нужен простой http-сервер, т.к. fetch не работает с file://)
python3 -m http.server 8000
# открыть http://localhost:8000
```

### GitHub Pages setup (один раз)

1. Settings → Pages → Source: **GitHub Actions**
2. Запушить main → через ~30 сек сайт доступен по https://YOUR.github.io/REPO

### Обновление данных

**Добавить М&A событие:**
```bash
./scripts/update.py acquisition add
# → интерактивно заполнить поля → валидируется
git add data/
git commit -m "acq: Триада-ТКО + фабрика Х"
git push
# → через 30 сек обновлено на live
```

**Добавить Ростех-предприятие:**
```bash
./scripts/update.py rostec add
```

**Добавить РЦ маркетплейса:**
```bash
./scripts/update.py mp add
```

**Валидация вручную:**
```bash
./scripts/update.py validate
```

### Ручное редактирование

Все JSON в `data/` можно править руками в любом редакторе. После правки:
```bash
./scripts/update.py validate   # проверить
./scripts/update.py bump       # обновить meta.json
git commit -am "data: описание изменения"
git push
```

Pre-commit hook сделает это автоматически.

## Форматы данных

### rostec.json — массив объектов
```json
{
  "n": 45, "name": "Калашников",
  "city": "Ижевск", "region": "Удмуртия",
  "lat": 56.85, "lng": 53.21,
  "staff": 12000,
  "status": "acute_def",        // acute_def | mod_def | neutral | mod_surp | strong_surp
  "mode": "3 смены",            // опц
  "news": "..."                 // опц — контекст
}
```

### marketplaces.json — массив объектов
```json
{
  "op": "WB",                   // WB | Ozon
  "location": "Коледино",
  "region": "Московская обл",
  "lat": 55.43, "lng": 37.55,
  "year": 2026,
  "date": "2026 H1",
  "planned": true,              // true = в плане/стройке
  "status": "under_construction",
  "area": 250,                  // тыс м² (опц)
  "jobs": 8000,                 // опц
  "inv": 35                     // млрд ₽ (опц)
}
```

### acquisitions.json — объект с events[]
```json
{
  "events": [
    {
      "id": "triada_2026_04_tula",
      "date": "2026-04",        // YYYY или YYYY-MM
      "acquirer": "Триада-ТКО / ГК Калашников",
      "acquirer_group": "rostec_kalashnikov",
      "asset": "...",
      "city": "...", "region": "...",
      "lat": ..., "lng": ...,
      "industry": "швейное / спецодежда",
      "stake_pct": 51,           // или null
      "staff_est": 400,          // оц
      "source_url": "https://...",
      "source_title": "...",
      "added_date": "2026-04-24",
      "notes": "..."             // опц
    }
  ]
}
```

### timelines.json — мэп {rostec_n: [events]}
```json
{
  "45": [
    {"year": 2022, "status": "mod_def", "event": "..."},
    {"year": 2024, "status": "acute_def", "event": "★ санкции + ГОЗ"}
  ]
}
```

### cities.json — массив
```json
{"name": "Ижевск", "lat": 56.85, "lng": 53.21, "kind": "hot"}  // major | hot
```

## Что на карте

- **Круги** — Ростех-предприятия, только те, у которых есть РЦ в ≤50 км в текущем году. Цвет = кадровый статус.
- **Квадраты** — РЦ WB (синий) / Ozon (бирюзовый). Штриховка = план/стройка.
- **Линии** — пары «предприятие ↔ РЦ». Красные = острый дефицит.
- **Ромбы (жёлто-оранжевые)** — M&A события. Конкурируют за ту же рабочую силу.
- **Таймлайн внизу** — 2019-2028. Перетягивая год, видно как росло число пересечений.

## Что меняется медленно, что быстро

| Что | Частота |
|---|---|
| `src/map.js`, `src/map.css`, `index.html` | Редко (раз в 2-4 недели) |
| `data/rostec.json` | Редко (новое предприятие — раз в месяц) |
| `data/marketplaces.json` | Умеренно (новые РЦ 1-2 в месяц) |
| `data/timelines.json` | По мере новостей по ключевым предприятиям |
| `data/acquisitions.json` | **Часто** (каждая M&A-новость) |
| `data/meta.json` | Автоматически при bump |

## Troubleshooting

**Карта не рендерится локально** — `file://` не пускает fetch. Запусти `python3 -m http.server 8000` и открывай через http://localhost:8000.

**GitHub Pages не обновилось** — проверь Actions в репе: зелёная галочка = деплой ОК. Если red — упала валидация.

**Телефон показывает код** — это Content URI проблема Android. Открывай через URL GitHub Pages (https://...), не скачанный файл.
