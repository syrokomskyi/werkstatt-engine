# @warpgogol/werkstatt

Українська | [English](README.md)

Рушій Werkstatt — незалежна від стеку платформа життєвого циклу (RFC-0769/0772).

Рушій надає kernel runtime, оркестрацію місій, управління дзеркалами Sternsystem, пайплайни релізів, оркестрацію розгортання Leitstand, Bordbuch-журнал змін, Notausgang аварійний експорт, сховище артефактів, синхронізацію evidence, цілісність, спостереження, fingerprint, agent-gate та операційні схеми. Специфічна для стеку логіка (Astro, Phaser, Godot) надається плагінами, що реалізують контракт `werkstatt/plugin@1` (RFC-0770).

> Розроблено в [Warpgogol](https://warpgogol.com) · Опубліковано як open source.

---

## Що робить цей пакет

Це **рушій runtime** платформи Warpgogol. Він керує повним життєвим циклом проєкту:

- **Місії** — матеріалізація, валідація, реконсіляція, закриття
- **Sternsystem** — дзеркала, синхронізація, валідація
- **Релізи** — підготовка, evidence, розгортання
- **Leitstand** — оркестрація розгортання (dev → Axiom → Alt → Main)
- **Bordbuch** — append-only hash-chained журнал операцій
- **Notausgang** — аварійний експорт
- **Сертифікація** — канонічна JSON-ідентичність, діагностика, авторитет розгортання
- **Сховище артефактів** — content-addressed dossier-репозиторій
- **Цілісність** — fingerprint, підписування, верифікація
- **Спостереження** — метрики, OTLP-конвертація
- **Agent-gate** — перевірки безпеки для агентів

Рушій стек-агностичний (DNA-64). Він НЕ ПОВИНЕН імпортувати стек-плагіни.

---

## Встановлення

```sh
pnpm add @warpgogol/werkstatt
```

Для проєктів з управлінням життєвим циклом встановіть також відповідний плагін стеку:

```sh
# Браузерна гра
pnpm add -D @warpgogol/werkstatt @warpgogol/werkstatt-phaser-game

# Гра Godot
pnpm add -D @warpgogol/werkstatt @warpgogol/werkstatt-godot-game

# Система знань
pnpm add -D @warpgogol/werkstatt @warpgogol/werkstatt-knowledge
```

---

## Як це вписується в екосистему Werkstatt

| Пакет | Роль |
| --- | --- |
| `@warpgogol/forge` | Шар управління — навички, RFC/ADR робочі процеси, CLI, скаффолд проєктів |
| `@warpgogol/werkstatt` | **Цей пакет** — рушій runtime (місії, релізи, розгортання, сертифікація) |
| `@warpgogol/werkstatt-shared` | Спільна інфраструктура — перевірки, інтеграція, онтологія, паспорт |
| `@warpgogol/werkstatt-phaser-game` | Плагін Phaser — валідатори, збірка Vite, адаптери деплою |
| `@warpgogol/werkstatt-godot-game` | Плагін Godot — валідатори, збірка dotnet, деплой itch.io |
| `@warpgogol/werkstatt-knowledge` | Плагін системи знань — джерела, канонічна верифікація, матеріалізація |

**Forge** створює проєкт і налаштовує управління. **Werkstatt** керує життєвим циклом. **Плагіни стеку** надають специфічні валідатори, хуки збірки та адаптери деплою.

---

## Точки входу

| Експорт                               | Модуль                          |
| ------------------------------------- | ------------------------------- |
| `@warpgogol/werkstatt`                | `./src/index.ts`                |
| `@warpgogol/werkstatt/kernel`         | `./src/kernel/index.ts`         |
| `@warpgogol/werkstatt/mission`        | `./src/mission/index.ts`        |
| `@warpgogol/werkstatt/sternsystem`    | `./src/sternsystem/index.ts`    |
| `@warpgogol/werkstatt/release`        | `./src/release/index.ts`        |
| `@warpgogol/werkstatt/leitstand`      | `./src/leitstand/index.ts`      |
| `@warpgogol/werkstatt/bordbuch`       | `./src/bordbuch/index.ts`       |
| `@warpgogol/werkstatt/notausgang`     | `./src/notausgang/index.ts`     |
| `@warpgogol/werkstatt/artifact-store` | `./src/artifact-store/index.ts` |
| `@warpgogol/werkstatt/evidence`       | `./src/evidence/index.ts`       |
| `@warpgogol/werkstatt/integrity`      | `./src/integrity/index.ts`      |
| `@warpgogol/werkstatt/signing`        | `./src/signing/index.ts`        |
| `@warpgogol/werkstatt/observability`  | `./src/observability/index.ts`  |
| `@warpgogol/werkstatt/fingerprint`    | `./src/fingerprint/index.ts`    |
| `@warpgogol/werkstatt/agent-gate`     | `./src/agent-gate/index.ts`     |
| `@warpgogol/werkstatt/changelog`      | `./src/changelog/index.ts`      |
| `@warpgogol/werkstatt/schemas`        | `./src/schemas/index.ts`        |
| `@warpgogol/werkstatt/certification`  | `./src/certification/index.ts`  |
| `@warpgogol/werkstatt/component`      | `./src/component/index.ts`      |
| `@warpgogol/werkstatt/handoff`        | `./src/handoff/index.ts`        |

---

## Контракт плагіна

Контракт плагіна визначено в `src/plugin-contract.ts` (`werkstatt/plugin@1`). Плагін декларує `schema`, `id`, `profileId`, `moduleLoaders`, опціональні `pipelines`, `deployAdapters`, `hooks`, `paths` та `invariants`. Рушій відмовляється запускатися з нулем або кількома плагінами. Валідація — через `werkstatt.plugin.validate` (PLUGIN-01..05). Див. RFC-0770 для повної специфікації контракту.

---

## Архітектура

| Директорія               | Призначення                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `src/kernel/`            | Kernel runtime, CLI, реєстр команд                              |
| `src/mission/`           | Оркестрація місій (materialize, validate, reconcile, close)     |
| `src/sternsystem/`       | Дзеркала Sternsystem, синхронізація, валідація                  |
| `src/release/`           | Пайплайн релізів, evidence, розгортання                         |
| `src/leitstand/`         | Оркестрація розгортання (dev → Axiom → Alt → Main)              |
| `src/bordbuch/`          | Append-only hash-chained журнал операцій                        |
| `src/notausgang/`        | Аварійний експорт                                               |
| `src/certification/`     | Канонічна JSON-ідентичність, діагностика, авторитет розгортання |
| `src/artifact-store/`    | Content-addressed dossier-репозиторій                           |
| `src/evidence/`          | Синхронізація evidence                                          |
| `src/integrity/`         | Fingerprint, підписування, верифікація                          |
| `src/observability/`     | Метрики, OTLP-конвертація                                       |
| `src/agent-gate/`        | Перевірки безпеки для агентів                                   |
| `src/schemas/`           | Операційні схеми (Diagnostic, тощо)                             |
| `src/plugin-contract.ts` | Контракт `werkstatt/plugin@1`                                   |
| `src/plugin-registry.ts` | Реєстр плагінів                                                 |

---

## Публікація в npm

Цей пакет публікується в реєстр npm як `@warpgogol/werkstatt`. Публікація автоматизована через GitHub Actions CI.

### Як це працює

1. Вихідний код знаходиться в монорепозиторії [warpgogol/werkstatt](https://github.com/syrokomskyi/werkstatt) у `packages/werkstatt/`.
2. [`@warpgogol/repo-extract`](https://github.com/syrokomskyi/repo-extract) витягує пакет у автономний репозиторій [syrokomskyi/werkstatt](https://github.com/syrokomskyi/werkstatt), вирівнюючи його до кореня репозиторію та видаляючи залежності робочого простору.
3. Згенерований GitHub Actions CI-воркфлоу запускається при кожному пуші в `main`: lint → typecheck → build → test → `npm publish --provenance --access public`.
4. Секрет `NPM_TOKEN` має бути встановлений у [налаштуваннях репозиторію](https://github.com/syrokomskyi/werkstatt/settings/secrets/actions).

### Запуск нового релізу

З кореня монорепозиторію werkstatt:

```sh
# 1. Підняти версію в packages/werkstatt/package.json
# 2. Запустити екстракцію (витягує + комітить + пушить в github.com:syrokomskyi/werkstatt.git)
pnpm exec repo-extract --config packages/werkstatt/extract.config.yaml --verbose

# 3. CI підхоплює пуш і публікує в npm автоматично
```

Після завершення CI перевірте нову версію на [npmjs.com/package/@warpgogol/werkstatt](https://www.npmjs.com/package/@warpgogol/werkstatt).

---

## Ліцензія

Apache-2.0

## Відкрита інженерія

Цей пакет походить із виробничої інженерної роботи в [Warpgogol](https://warpgogol.com), інженерній студії в Німеччині.

Ми публікуємо багаторазові частини нашої інфраструктури, коли вони можуть бути корисними поза нашими власними проєктами. Він публікується незалежно від будь-якого комерційного сервісу Warpgogol. Використання цього пакету не створює жодної залежності від Warpgogol.

Створено для реальних систем. Поширюється відкрито.
