#!/usr/bin/env python3
"""
update.py — добавить/изменить запись в data/*.json

Usage:
  ./scripts/update.py acquisition add   # М&A событие (интерактивно)
  ./scripts/update.py rostec add        # Ростех-предприятие
  ./scripts/update.py mp add            # РЦ WB/Ozon
  ./scripts/update.py rostec fix <n>    # поправить запись по номеру
  ./scripts/update.py validate          # проверить целостность всех JSON
  ./scripts/update.py bump              # обновить meta.json версии

После любого add/fix — запустит validate и предложит git commit.
"""
import json
import sys
import os
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / 'data'

GREEN = '\033[92m'; RED = '\033[91m'; YELLOW = '\033[93m'; DIM = '\033[2m'; END = '\033[0m'

def load(name):
    with open(DATA_DIR / f'{name}.json', encoding='utf-8') as f:
        return json.load(f)

def save(name, data, indent=None):
    """Для больших файлов (rostec, marketplaces, timelines) — без indent для компактности.
       Для маленьких (acquisitions, meta, cities) — с indent=2 для читаемости в git."""
    if indent is None:
        indent = 2 if name in ('acquisitions', 'meta', 'cities') else 0
    with open(DATA_DIR / f'{name}.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)

def ask(prompt, default=None, typ=str, required=True):
    hint = f' [{default}]' if default is not None else ''
    while True:
        v = input(f'{prompt}{hint}: ').strip()
        if not v and default is not None:
            return default
        if not v and not required:
            return None
        if not v:
            print(f'{RED}обязательное поле{END}')
            continue
        try:
            return typ(v) if typ != str else v
        except ValueError:
            print(f'{RED}неверный формат{END}')

def ask_float(prompt, default=None, required=True):
    return ask(prompt, default, float, required)

def ask_int(prompt, default=None, required=True):
    return ask(prompt, default, int, required)

def ask_yes(prompt, default=False):
    hint = 'Y/n' if default else 'y/N'
    v = input(f'{prompt} [{hint}]: ').strip().lower()
    if not v: return default
    return v in ('y', 'yes', 'да', 'д')

# ==========================================================
# ACQUISITION
# ==========================================================
def add_acquisition():
    data = load('acquisitions')
    print(f'\n{GREEN}=== Добавляем M&A-событие ==={END}')
    print(f'{DIM}Текущее число событий: {len(data["events"])}{END}\n')

    ev = {}
    ev['date'] = ask('Дата (YYYY-MM или YYYY)')
    ev['acquirer'] = ask('Покупатель', 'Триада-ТКО / ГК Калашников')
    ev['acquirer_group'] = ask('Группа (rostec_kalashnikov / rostec_other / other)', 'rostec_kalashnikov')
    ev['asset'] = ask('Название актива')
    ev['city'] = ask('Город')
    ev['region'] = ask('Регион')
    ev['lat'] = ask_float('Широта (lat)')
    ev['lng'] = ask_float('Долгота (lng)')
    ev['industry'] = ask('Отрасль', 'швейное / спецодежда')
    ev['stake_pct'] = ask('Доля % (или N/A если не раскрыто)', 'N/A', required=False)
    if ev['stake_pct'] in ('N/A', 'n/a', ''):
        ev['stake_pct'] = None
    ev['staff_est'] = ask_int('Оценка штата', required=False)
    ev['source_url'] = ask('URL источника')
    ev['source_title'] = ask('Заголовок источника')
    ev['notes'] = ask('Заметки (опц)', required=False) or None
    ev['added_date'] = date.today().isoformat()

    # id — из acquirer+date+город
    slug = (ev['acquirer_group'] or 'other').split('/')[0].strip().lower()
    city_slug = ev['city'].lower().replace(' ', '_').replace('-', '_')[:15]
    ev['id'] = f'{slug}_{ev["date"].replace("-","_")}_{city_slug}'
    # если такой ID уже есть — добавляем суффикс
    existing_ids = {e['id'] for e in data['events']}
    if ev['id'] in existing_ids:
        i = 2
        while f'{ev["id"]}_{i}' in existing_ids:
            i += 1
        ev['id'] = f'{ev["id"]}_{i}'

    # Удаляем None-ключи
    ev = {k: v for k, v in ev.items() if v is not None}

    print(f'\n{YELLOW}Проверка:{END}')
    for k, v in ev.items():
        print(f'  {k}: {v}')

    if not ask_yes('\nДобавить?', True):
        print('Отменено.')
        return
    data['events'].append(ev)
    save('acquisitions', data)
    print(f'{GREEN}✓ Добавлено. Всего теперь: {len(data["events"])}{END}')
    bump_meta()

# ==========================================================
# ROSTEC
# ==========================================================
def add_rostec():
    data = load('rostec')
    print(f'\n{GREEN}=== Добавляем Ростех-предприятие ==={END}')
    max_n = max(r['n'] for r in data)
    print(f'{DIM}Текущие: {len(data)}, максимальный n: {max_n}{END}\n')

    r = {}
    r['n'] = max_n + 1
    r['name'] = ask('Название')
    r['city'] = ask('Город', required=False) or None
    r['region'] = ask('Регион')
    r['lat'] = ask_float('Широта')
    r['lng'] = ask_float('Долгота')
    r['staff'] = ask_int('Численность', required=False)
    r['status'] = ask('Статус (acute_def/mod_def/neutral/mod_surp/strong_surp)', 'mod_def')
    r['mode'] = ask('Режим работы (2 смены / 3 смены / ...)', required=False) or None
    r['news'] = ask('Контекстная заметка', required=False) or None

    r = {k: v for k, v in r.items() if v is not None}

    print(f'\n{YELLOW}Проверка:{END}')
    for k, v in r.items(): print(f'  {k}: {v}')
    if not ask_yes('\nДобавить?', True):
        print('Отменено.'); return
    data.append(r)
    save('rostec', data)
    print(f'{GREEN}✓ Добавлено. Всего: {len(data)}{END}')
    bump_meta()

# ==========================================================
# MARKETPLACE
# ==========================================================
def add_mp():
    data = load('marketplaces')
    print(f'\n{GREEN}=== Добавляем РЦ маркетплейса ==={END}')
    print(f'{DIM}Текущие: {len(data)}{END}\n')

    m = {}
    m['op'] = ask('Оператор (WB / Ozon)')
    m['location'] = ask('Локация (обычно — город + район)')
    m['region'] = ask('Регион')
    m['lat'] = ask_float('Широта')
    m['lng'] = ask_float('Долгота')
    m['year'] = ask_int('Год запуска/планируемого')
    m['date'] = ask('Точная дата (2025 H1 / 2026 Q3 / дата)', str(m['year']))
    m['planned'] = ask_yes('Планируемый/строящийся?', default=(m['year'] >= 2026))
    m['status'] = ask('Статус (opened/opened_partial/under_construction/planned)', 'opened' if not m['planned'] else 'planned')
    m['area'] = ask_float('Площадь (тыс м², опц)', required=False)
    m['jobs'] = ask_int('Рабочих мест (опц)', required=False)
    m['inv'] = ask_float('Инвестиции (млрд ₽, опц)', required=False)

    m = {k: v for k, v in m.items() if v is not None}

    print(f'\n{YELLOW}Проверка:{END}')
    for k, v in m.items(): print(f'  {k}: {v}')
    if not ask_yes('\nДобавить?', True):
        print('Отменено.'); return
    data.append(m)
    save('marketplaces', data)
    print(f'{GREEN}✓ Добавлено. Всего: {len(data)}{END}')
    bump_meta()

# ==========================================================
# VALIDATE
# ==========================================================
def validate():
    print(f'{GREEN}=== Валидация всех данных ==={END}')
    errors = []
    warns = []

    rostec = load('rostec')
    mp = load('marketplaces')
    tl = load('timelines')
    cities = load('cities')
    acq = load('acquisitions')
    meta = load('meta')

    # Duplicates in rostec n
    ns = [r['n'] for r in rostec]
    if len(ns) != len(set(ns)): errors.append(f'rostec: дубликаты n')

    # Coords in RU bounds
    def check_coords(items, name, lat_key='lat', lng_key='lng'):
        for i, it in enumerate(items):
            lat, lng = it.get(lat_key), it.get(lng_key)
            if lat is None or lng is None:
                errors.append(f'{name}[{i}]: нет координат'); continue
            if not (41 <= lat <= 82): warns.append(f'{name}[{i}] ({it.get("name") or it.get("location") or it.get("asset")}): lat={lat} вне РФ')
            if not (19 <= lng <= 180): warns.append(f'{name}[{i}] ({it.get("name") or it.get("location") or it.get("asset")}): lng={lng} вне РФ')

    check_coords(rostec, 'rostec')
    check_coords(mp, 'marketplaces')
    check_coords(cities, 'cities')
    check_coords(acq['events'], 'acquisitions')

    # Timeline keys referencing real rostec
    for k in tl:
        try: n = int(k)
        except: errors.append(f'timelines: ключ "{k}" не число'); continue
        if not any(r['n'] == n for r in rostec):
            warns.append(f'timelines: ключ {k} не ссылается на rostec')

    # Acquisitions — unique ids
    ids = [e['id'] for e in acq['events']]
    if len(ids) != len(set(ids)): errors.append('acquisitions: дубликат id')

    # Valid status
    valid_st = {'acute_def', 'mod_def', 'neutral', 'mod_surp', 'strong_surp'}
    for r in rostec:
        if r.get('status') not in valid_st:
            errors.append(f'rostec[n={r["n"]}]: invalid status "{r.get("status")}"')

    # Meta counts match
    if meta['datasets']['rostec']['count'] != len(rostec):
        warns.append(f'meta.rostec.count ({meta["datasets"]["rostec"]["count"]}) ≠ реальное ({len(rostec)})')
    if meta['datasets']['marketplaces']['count'] != len(mp):
        warns.append(f'meta.marketplaces.count ≠ реальное')
    if meta['datasets']['acquisitions']['count'] != len(acq['events']):
        warns.append(f'meta.acquisitions.count ≠ реальное')

    print(f'\n{GREEN}Записи:{END}')
    print(f'  rostec:         {len(rostec)}')
    print(f'  marketplaces:   {len(mp)}')
    print(f'  timelines:      {len(tl)}')
    print(f'  cities:         {len(cities)}')
    print(f'  acquisitions:   {len(acq["events"])}')

    if warns:
        print(f'\n{YELLOW}Предупреждения ({len(warns)}):{END}')
        for w in warns: print(f'  ⚠ {w}')
    if errors:
        print(f'\n{RED}Ошибки ({len(errors)}):{END}')
        for e in errors: print(f'  ✗ {e}')
        return False
    print(f'\n{GREEN}✓ Валидация пройдена{END}')
    return True

# ==========================================================
# BUMP META
# ==========================================================
def bump_meta():
    meta = load('meta')
    rostec = load('rostec'); mp = load('marketplaces'); tl = load('timelines'); cities = load('cities'); acq = load('acquisitions')
    meta['last_updated'] = date.today().isoformat()
    meta['datasets']['rostec']['count'] = len(rostec)
    meta['datasets']['marketplaces']['count'] = len(mp)
    meta['datasets']['marketplaces']['planned_count'] = sum(1 for m in mp if m.get('planned'))
    meta['datasets']['timelines']['count'] = len(tl)
    meta['datasets']['cities']['count'] = len(cities)
    meta['datasets']['acquisitions']['count'] = len(acq['events'])
    save('meta', meta)
    print(f'{GREEN}✓ meta.json обновлён ({meta["last_updated"]}){END}')

# ==========================================================
# MAIN
# ==========================================================
def main():
    if len(sys.argv) < 2:
        print(__doc__); return
    cmd = sys.argv[1]
    sub = sys.argv[2] if len(sys.argv) > 2 else None

    if cmd == 'validate':
        validate()
    elif cmd == 'bump':
        bump_meta()
    elif cmd == 'acquisition' and sub == 'add':
        add_acquisition(); validate()
    elif cmd == 'rostec' and sub == 'add':
        add_rostec(); validate()
    elif cmd == 'mp' and sub == 'add':
        add_mp(); validate()
    else:
        print(__doc__)

if __name__ == '__main__':
    main()
