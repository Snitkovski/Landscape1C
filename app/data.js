// Данные ландшафта (Вариант B). Конвертированы из data/landscape.yml.
// Глобальный объект, чтобы работать и через file://, и на GitHub Pages без fetch.
window.LANDSCAPE = {
  categories: ["IDE", "CI/CD", "Системы хранения версий"],
  // Порядок и подписи осей фильтрации
  axes: {
    role: { label: "Роль", values: ["разработчик", "devops", "тестировщик", "аналитик", "администратор"] },
    context: { label: "Контекст работы", values: ["франчайзи", "инхаус", "продукты", "проекты", "фриланс"] },
    maturity: { label: "Зрелость", values: ["базовое", "продвинутое", "нишевое", "устаревает"] },
    origin: { label: "Происхождение", values: ["отечественное", "зарубежное"] },
    license: { label: "Лицензия", values: ["open-source", "проприетарное", "бесплатное"] }
  },
  items: [
    {
      name: "Конфигуратор", category: "IDE", subcategory: "Среды разработки",
      description: "Классическая среда разработки, входящая в состав платформы 1С:Предприятие.",
      why: "Базовая среда, с которой начинает почти каждый разработчик 1С.",
      homepage: "https://v8.1c.ru/platforma/",
      maturity: "базовое", origin: "отечественное", license: "проприетарное",
      roles: ["разработчик"], contexts: ["франчайзи", "инхаус", "продукты", "проекты", "фриланс"]
    },
    {
      name: "1C:Enterprise Development Tools (EDT)", category: "IDE", subcategory: "Среды разработки",
      description: "Современная среда разработки 1С на базе Eclipse.",
      why: "Современный инструментарий, git-ориентированная разработка, рефакторинг.",
      homepage: "https://edt.1c.ru",
      maturity: "продвинутое", origin: "отечественное", license: "проприетарное",
      roles: ["разработчик"], contexts: ["инхаус", "продукты", "проекты"]
    },
    {
      name: "Visual Studio Code (VSCode)", category: "IDE", subcategory: "Среды разработки",
      description: "Лёгкий кроссплатформенный редактор кода для около-1С технологий.",
      why: "Удобен для OneScript, Vanessa и просмотра модулей; много расширений.",
      homepage: "https://code.visualstudio.com",
      maturity: "продвинутое", origin: "зарубежное", license: "open-source",
      roles: ["разработчик", "devops"], contexts: ["продукты", "инхаус", "фриланс"]
    },
    {
      name: "Jenkins", category: "CI/CD", subcategory: "Сборка и доставка",
      description: "Сервер автоматизации сборок и пайплайнов.",
      why: "Классика CI для сборки и прогона тестов 1С.",
      homepage: "https://www.jenkins.io", repo: "https://github.com/jenkinsci/jenkins",
      maturity: "продвинутое", origin: "зарубежное", license: "open-source",
      roles: ["devops"], contexts: ["продукты", "инхаус"]
    },
    {
      name: "GitLab CI", category: "CI/CD", subcategory: "Сборка и доставка",
      description: "Встроенная в GitLab система непрерывной интеграции.",
      why: "CI/CD рядом с репозиторием, без отдельного сервера сборки.",
      homepage: "https://docs.gitlab.com/ee/ci/",
      maturity: "продвинутое", origin: "зарубежное", license: "open-source",
      roles: ["devops"], contexts: ["продукты", "инхаус"]
    },
    {
      name: "Vagrant", category: "CI/CD", subcategory: "Сборка и доставка",
      description: "Инструмент управления воспроизводимыми виртуальными окружениями.",
      why: "Быстрое поднятие одинаковых тестовых стендов 1С.",
      homepage: "https://www.vagrantup.com", repo: "https://github.com/hashicorp/vagrant",
      maturity: "нишевое", origin: "зарубежное", license: "open-source",
      roles: ["devops"], contexts: ["продукты", "инхаус"]
    },
    {
      name: "Docker", category: "CI/CD", subcategory: "Сборка и доставка",
      description: "Платформа контейнеризации приложений и окружений.",
      why: "Изолированные окружения для сборки, тестов и сервисов вокруг 1С.",
      homepage: "https://www.docker.com", repo: "https://github.com/moby/moby",
      maturity: "продвинутое", origin: "зарубежное", license: "open-source",
      roles: ["devops"], contexts: ["продукты", "инхаус"]
    },
    {
      name: "Allure", category: "CI/CD", subcategory: "Сборка и доставка",
      description: "Фреймворк формирования наглядных отчётов о тестировании.",
      why: "Читаемые отчёты по результатам автотестов в пайплайне.",
      homepage: "https://allurereport.org", repo: "https://github.com/allure-framework/allure2",
      maturity: "нишевое", origin: "зарубежное", license: "open-source",
      roles: ["devops", "тестировщик"], contexts: ["продукты"]
    },
    {
      name: "git", category: "Системы хранения версий", subcategory: "Версионирование",
      description: "Распределённая система контроля версий — индустриальный стандарт.",
      why: "Стандарт версионирования; основа CI/CD и командной работы.",
      homepage: "https://git-scm.com",
      maturity: "базовое", origin: "зарубежное", license: "open-source",
      roles: ["разработчик", "devops"], contexts: ["продукты", "инхаус", "проекты", "фриланс"]
    },
    {
      name: "Хранилище конфигурации", category: "Системы хранения версий", subcategory: "Версионирование",
      description: "Штатный механизм платформы для совместной разработки.",
      why: "Постепенно вытесняется связкой git + выгрузка конфигурации в файлы.",
      homepage: "https://its.1c.ru",
      maturity: "устаревает", origin: "отечественное", license: "проприетарное",
      roles: ["разработчик"], contexts: ["франчайзи", "инхаус"]
    }
  ]
};
