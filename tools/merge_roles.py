#!/usr/bin/env python3
"""Объединяет роли devops и администратор в одну роль «администратор».

Меняет axes.role.values и роли во всех карточках (с дедупликацией, сохраняя
порядок). Применяет к app/data.js и app/data.generated.js.
Запуск: python3 tools/merge_roles.py
"""
import json
from pathlib import Path

OLD = "devops"          # роль, которую вливаем
MERGED = "администратор"  # итоговое название общей роли


def dedup(seq):
    seen, out = set(), []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def apply(path: Path):
    js = path.read_text(encoding='utf-8')
    head = js[:js.index('window.LANDSCAPE')]
    data = json.loads(js[js.index('{'):js.rindex('}') + 1])

    # axes.role.values: devops → администратор, убрать дубль
    vals = [MERGED if v == OLD else v for v in data['axes']['role']['values']]
    data['axes']['role']['values'] = dedup(vals)

    # роли карточек
    for it in data['items']:
        it['roles'] = dedup(MERGED if r == OLD else r for r in it['roles'])

    out = head + 'window.LANDSCAPE = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n'
    path.write_text(out, encoding='utf-8')
    left = sum(1 for it in data['items'] if OLD in it['roles'])
    print(f"{path}: role.values={data['axes']['role']['values']} | осталось '{OLD}': {left}")


def main():
    for p in ('app/data.js', 'app/data.generated.js'):
        path = Path(p)
        if path.exists():
            apply(path)


if __name__ == '__main__':
    main()
