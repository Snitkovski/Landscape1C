#!/usr/bin/env python3
"""Проставляет ОЧЕВИДНЫЕ метки в app/data.generated.js по индексам карточек.

Заполняет только бесспорное: origin (почти всегда объективно), license (явный
OSS / 1С-проприетарный / бесплатный), roles (явная роль), maturity (только
бесспорные). contexts НЕ трогаем — самая оценочная ось, остаётся за куратором.
Спорные поля оставлены пустыми. Запуск: python3 tools/apply_markup.py
ВНИМАНИЕ: повторный запуск parse_readme.py перезатрёт эти метки.
"""
import json
from pathlib import Path

# o=origin, l=license, m=maturity, r=roles. Отсутствующий ключ = оставить пустым.
OT, ZAR = 'отечественное', 'зарубежное'
OSS, PROP, FREE = 'open-source', 'проприетарное', 'бесплатное'
DEV, OPS, QA, AN, ADM = 'разработчик', 'devops', 'тестировщик', 'аналитик', 'администратор'

MARKUP = {
    0:  dict(o=OT, l=PROP, r=[DEV], m='базовое'),
    1:  dict(o=OT, l=PROP, r=[DEV], m='базовое'),
    2:  dict(o=OT, l=PROP, r=[DEV], m='нишевое'),
    3:  dict(o=OT, l=PROP, r=[DEV]),
    4:  dict(o=OT, l=PROP, r=[DEV, OPS]),
    5:  dict(o=OT, l=OSS,  r=[DEV, OPS], m='продвинутое'),
    6:  dict(o=OT, l=PROP, r=[DEV], m='базовое'),
    7:  dict(o=OT, l=PROP, r=[DEV], m='продвинутое'),
    8:  dict(o=ZAR, l=OSS, r=[DEV, OPS], m='продвинутое'),
    9:  dict(o=OT, l=PROP, r=[DEV]),
    10: dict(o=OT, l=FREE, r=[DEV]),
    11: dict(o=OT, l=FREE, r=[DEV]),
    12: dict(o=OT, l=PROP, r=[DEV]),
    13: dict(o=OT, l=OSS,  r=[DEV]),
    14: dict(o=OT, l=PROP, r=[DEV]),
    15: dict(o=OT, l=OSS,  r=[DEV]),
    16: dict(o=OT, l=OSS,  r=[DEV]),
    17: dict(o=OT, l=OSS,  r=[DEV, OPS]),
    18: dict(o=OT, l=OSS,  r=[DEV]),
    19: dict(o=OT, l=PROP, r=[ADM, DEV], m='базовое'),
    20: dict(o=ZAR, l=OSS, r=[ADM], m='продвинутое'),
    21: dict(o=ZAR, l=PROP, r=[ADM], m='продвинутое'),
    22: dict(o=OT, l=PROP, r=[DEV], m='устаревает'),
    23: dict(o=ZAR, l=OSS, r=[DEV, OPS], m='базовое'),
    24: dict(o=OT, r=[AN, DEV]),
    25: dict(o=OT, r=[AN, DEV]),
    26: dict(o=OT, l=PROP, r=[QA], m='продвинутое'),
    27: dict(o=OT, l=OSS,  r=[QA, OPS], m='продвинутое'),
    28: dict(o=OT, l=OSS,  r=[QA]),
    29: dict(o=OT, l=OSS,  r=[QA, DEV], m='продвинутое'),
    30: dict(o=OT, l=PROP, r=[DEV], m='базовое'),
    31: dict(o=OT, l=PROP, r=[DEV], m='продвинутое'),
    32: dict(o=OT, l=OSS,  r=[DEV, OPS], m='продвинутое'),
    33: dict(o=OT, l=PROP, r=[AN, DEV]),
    34: dict(r=[DEV]),
    35: dict(o=OT, r=[DEV], m='базовое'),
    36: dict(o=ZAR, l=OSS, r=[OPS], m='продвинутое'),
    37: dict(o=ZAR, l=OSS, r=[OPS], m='продвинутое'),
    38: dict(o=ZAR, l=OSS, r=[OPS], m='нишевое'),
    39: dict(o=ZAR, l=OSS, r=[OPS], m='продвинутое'),
    40: dict(o=ZAR, l=OSS, r=[OPS, QA], m='нишевое'),
    41: dict(o=OT, l=PROP, r=[DEV, AN], m='продвинутое'),
    42: dict(o=OT, l=PROP, r=[DEV, OPS]),
    43: dict(o=OT, l=OSS,  r=[DEV]),
    44: dict(o=ZAR, r=[DEV]),
    45: dict(o=OT, l=OSS,  r=[DEV, OPS]),
    46: dict(o=ZAR, l=OSS, r=[DEV, OPS], m='продвинутое'),
    47: dict(o=ZAR, r=[DEV, ADM], m='продвинутое'),
    48: dict(o=ZAR, l=FREE, r=[DEV, QA]),
    49: dict(o=ZAR, l=FREE, r=[DEV, QA], m='продвинутое'),
    50: dict(o=ZAR, l=OSS, r=[DEV]),
    51: dict(o=ZAR, l=FREE, r=[DEV, OPS]),
    52: dict(o=OT, l=PROP, r=[AN]),
    53: dict(o=ZAR, l=PROP, r=[AN], m='продвинутое'),
    54: dict(o=OT, l=PROP, r=[ADM], m='продвинутое'),
    55: dict(o=OT, l=OSS,  r=[OPS, ADM]),
    56: dict(o=OT), 57: dict(o=OT), 58: dict(o=OT), 59: dict(o=OT),
    60: dict(o=OT), 61: dict(o=OT), 62: dict(o=OT),
}


def main():
    path = Path('app/data.generated.js')
    js = path.read_text(encoding='utf-8')
    head = js[:js.index('window.LANDSCAPE')]
    data = json.loads(js[js.index('{'):js.rindex('}') + 1])
    items = data['items']

    assert len(items) == 63, f'Ожидалось 63 карточки, найдено {len(items)}'
    for idx, mk in MARKUP.items():
        it = items[idx]
        if 'o' in mk: it['origin'] = mk['o']
        if 'l' in mk: it['license'] = mk['l']
        if 'm' in mk: it['maturity'] = mk['m']
        if 'r' in mk: it['roles'] = mk['r']

    out = head + 'window.LANDSCAPE = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n'
    path.write_text(out, encoding='utf-8')

    # Сводка.
    def filled(f, arr=False):
        return sum(1 for i in items if (i[f] if not arr else len(i[f])))
    print(f'Карточек: {len(items)}')
    print(f'  origin:   {filled("origin")}/63')
    print(f'  license:  {filled("license")}/63')
    print(f'  maturity: {filled("maturity")}/63')
    print(f'  roles:    {filled("roles", True)}/63')
    print(f'  contexts: {filled("contexts", True)}/63  (намеренно не заполняли)')
    need = [i['name'] for i in items if not i['license']]
    print(f'\nБез license (решить вручную): {need}')
    nomat = [i['name'] for i in items if not i['maturity']]
    print(f'Без maturity (решить вручную): {len(nomat)} шт.')


if __name__ == '__main__':
    main()
