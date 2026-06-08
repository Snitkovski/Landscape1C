#!/usr/bin/env python3
"""Проставляет logo (имя файла из app/logos/) карточкам по индексу.

1С-продукты → 1c.png (логотип фирмы 1С). Сторонние инструменты → их лого.
Где логотип не нашли (VSCode/MS SQL Server/Power BI — удалены из simple-icons;
нишевые сообщества) — оставляем null (карточка покажет заглушку «1С»).
Применяет к app/data.js и app/data.generated.js. Запуск: python3 tools/apply_logos.py
"""
import json
from pathlib import Path

ONEC = "1c.png"
LOGO = {
    # 1С-продукты
    0: ONEC, 1: ONEC, 2: ONEC, 3: ONEC, 4: ONEC, 6: ONEC, 7: ONEC, 14: ONEC,
    16: ONEC, 19: ONEC, 22: ONEC, 26: ONEC, 30: ONEC, 31: ONEC, 33: ONEC,
    35: ONEC, 41: ONEC, 42: ONEC, 52: ONEC, 54: ONEC,
    56: ONEC, 57: ONEC, 58: ONEC, 59: ONEC, 60: ONEC, 61: ONEC,
    # Сторонние — настоящие логотипы
    8: "vscode.svg",
    20: "postgresql.svg",
    21: "sqlserver.svg",
    23: "git.svg",
    32: "sonarqube.svg",
    36: "jenkins.svg",
    37: "gitlab.svg",
    38: "vagrant.svg",
    39: "docker.svg",
    40: "allure.png",
    44: "telegram.png",
    45: "curl.svg",
    46: "kafka.svg",
    49: "postman.svg",
    50: "swagger.svg",
    51: "ngrok.svg",
}


def apply(path: Path):
    js = path.read_text(encoding='utf-8')
    head = js[:js.index('window.LANDSCAPE')]
    data = json.loads(js[js.index('{'):js.rindex('}') + 1])
    items = data['items']
    assert len(items) == 63, f'{path}: ожидалось 63, найдено {len(items)}'
    for i, it in enumerate(items):
        it['logo'] = LOGO.get(i)          # отсутствующие → None (заглушка)
    out = head + 'window.LANDSCAPE = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n'
    path.write_text(out, encoding='utf-8')
    with_logo = sum(1 for it in items if it['logo'])
    print(f'{path}: логотип у {with_logo}/63, заглушка у {63 - with_logo}')


def main():
    for p in ('app/data.js', 'app/data.generated.js'):
        path = Path(p)
        if path.exists():
            apply(path)
    placeholders = [i for i in range(63) if i not in LOGO]
    print(f'Без логотипа (индексы): {placeholders}')


if __name__ == '__main__':
    main()
