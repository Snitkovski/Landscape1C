#!/usr/bin/env python3
"""Парсер README каталога StackTechnologies1C → карточки ландшафта (Вариант B).

Достаёт автоматически: name, category (домен #), subcategory, description, why,
start (ссылки «С чего начать»), homepage/repo (из «Подробнее»). Доменные метки
(maturity/roles/contexts/origin/license) в README отсутствуют — оставляем пустыми
для ручной разметки. Зонтичные разделы (несколько инструментов в одном) помечаются
флагом umbrella: их нужно вручную раздробить на атомарные карточки.

Запуск:
    python3 tools/parse_readme.py [path/to/README.md] [out.js]
По умолчанию читает ../StackTechnologies1C/README.md, пишет app/data.generated.js.
"""
import json
import re
import sys
from pathlib import Path

HEADING = re.compile(r'^(#{1,4})\s+(.*?)\s*$')
LINK = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')        # [текст](url)
BARE_URL = re.compile(r'<(https?://[^>]+)>')          # <url>
MARKER = re.compile(r'^\*\*(.+?):\*\*\s*$')           # **Зачем нужно:**
IMAGE = re.compile(r'^!\[')
BACKLINK = re.compile(r'^\[В начало\]')

# Признаки «зонтичного» раздела (несколько инструментов в одном заголовке):
# перечисление через « и », запятая внутри скобок, либо «и другие».
AND_SEP = re.compile(r'\sи\s', re.IGNORECASE)
COMMA_IN_PARENS = re.compile(r'\([^)]*,[^)]*\)')


def is_umbrella(title):
    return bool(AND_SEP.search(title) or COMMA_IN_PARENS.search(title))


def split_sections(lines):
    """Разбивает на секции по заголовкам: (level, title, body_lines)."""
    sections, cur = [], None
    for line in lines:
        m = HEADING.match(line)
        if m:
            if cur:
                sections.append(cur)
            cur = [len(m.group(1)), m.group(2), []]
        elif cur:
            cur[2].append(line)
    if cur:
        sections.append(cur)
    return sections


def first_link(text):
    m = LINK.search(text)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    m = BARE_URL.search(text)
    if m:
        return m.group(1).strip(), m.group(1).strip()
    return None


def parse_blocks(body):
    """Делит тело секции на вступление (до первого **маркера**) и блоки-маркеры."""
    intro, blocks, key = [], {}, None
    for line in body:
        if IMAGE.match(line) or BACKLINK.match(line):
            continue
        m = MARKER.match(line.strip())
        if m:
            key = m.group(1).strip()
            blocks[key] = []
            continue
        (blocks[key] if key else intro).append(line)
    return intro, blocks


def clean_text(lines):
    return ' '.join(l.strip() for l in lines if l.strip()).strip()


def parse_list_links(lines):
    """Из нумерованного списка достаёт {label, url} по первой ссылке в строке."""
    out = []
    for l in lines:
        if not l.strip():
            continue
        fl = first_link(l)
        if fl:
            out.append({'label': fl[0], 'url': fl[1]})
    return out


def is_tool(blocks, intro):
    return 'Зачем нужно' in blocks or 'С чего начать' in blocks


def main():
    readme = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('../StackTechnologies1C/README.md')
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('app/data.generated.js')
    lines = readme.read_text(encoding='utf-8').splitlines()
    sections = split_sections(lines)

    domain = None       # текущий # — это category
    sub = None          # текущий ##/### контейнер — кандидат в subcategory
    items, categories = [], []

    for level, title, body in sections:
        intro, blocks = parse_blocks(body)
        tool = is_tool(blocks, intro)

        if not tool:
            # Контейнер: домен или подкатегория.
            if level == 1:
                domain = title
                if title not in categories:
                    categories.append(title)
                sub = None
            elif level == 2:
                sub = title
            # level 3 контейнер (напр. «Мониторинг и аналитика») — оставляем sub как есть,
            # его дети-инструменты (####) попадут с subcategory = этот заголовок:
            if level == 3:
                sub = title
            continue

        # Это инструмент.
        homepage = repo = None
        for fl in parse_list_links(blocks.get('Подробнее', [])):
            url = fl['url']
            if 'github.com' in url and not repo:
                repo = url
            elif not homepage:
                homepage = url
        if not homepage:
            homepage = repo  # на крайний случай

        subcategory = sub if level >= 3 else None

        items.append({
            'name': title,
            'category': domain,
            'subcategory': subcategory,
            'logo': None,
            'description': clean_text(intro),
            'why': clean_text(blocks.get('Зачем нужно', [])),
            'homepage': homepage,
            'repo': repo,
            'start': parse_list_links(blocks.get('С чего начать', [])),
            # Доменные метки — на ручную разметку:
            'maturity': '', 'origin': '', 'license': '',
            'roles': [], 'contexts': [],
            'umbrella': is_umbrella(title),
        })

    # Категории без инструментов — служебные заголовки (Благодарность и т.п.), убираем.
    categories = [c for c in categories if any(i['category'] == c for i in items)]

    # Сборка JS-файла в формате window.LANDSCAPE.
    axes = {
        'role': {'label': 'Роль', 'values': ['разработчик', 'devops', 'тестировщик', 'аналитик', 'администратор']},
        'context': {'label': 'Контекст работы', 'values': ['франчайзи', 'инхаус', 'продукты', 'проекты', 'фриланс']},
        'maturity': {'label': 'Зрелость', 'values': ['базовое', 'продвинутое', 'нишевое', 'устаревает']},
        'origin': {'label': 'Происхождение', 'values': ['отечественное', 'зарубежное']},
        'license': {'label': 'Лицензия', 'values': ['open-source', 'проприетарное', 'бесплатное']},
    }
    data = {'categories': categories, 'axes': axes, 'items': items}
    js = ('// СГЕНЕРИРОВАНО tools/parse_readme.py из README StackTechnologies1C.\n'
          '// Метки (maturity/roles/contexts/origin/license) пустые — требуют ручной разметки.\n'
          '// umbrella:true — зонтичный раздел, раздробить на атомарные карточки вручную.\n'
          'window.LANDSCAPE = '
          + json.dumps(data, ensure_ascii=False, indent=2) + ';\n')
    out_path.write_text(js, encoding='utf-8')

    # Сводка.
    umbrellas = [i['name'] for i in items if i['umbrella']]
    no_desc = [i['name'] for i in items if not i['description']]
    print(f'Категорий (доменов): {len(categories)} → {categories}')
    print(f'Инструментов извлечено: {len(items)}')
    print(f'Без описания: {len(no_desc)} {no_desc}')
    print(f'Зонтичные (раздробить вручную): {len(umbrellas)} {umbrellas}')
    print(f'\nЗаписано: {out_path}')
    print('\nПо категориям:')
    for c in categories:
        names = [i['name'] for i in items if i['category'] == c]
        print(f'  {c} ({len(names)}): {names}')


if __name__ == '__main__':
    main()
