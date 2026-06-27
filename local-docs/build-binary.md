# Сборка SOBA в бинарный файл

SOBA можно собрать в самостоятельный executable со встроенным Bun runtime. Основная поддерживаемая цель:
macOS на Apple Silicon (`arm64`, процессоры M1/M2/M3/M4 и новее).

## Требования к машине сборки

- Bun и зависимости проекта установлены: `bun install`.
- Для надёжной сборки OpenTUI под Apple Silicon рекомендуется собирать на Mac с Apple Silicon. OpenTUI использует
  платформенный native runtime из optional dependencies.
- Бинарник не содержит пользовательскую конфигурацию и API-ключи. На целевой машине SOBA создаст или прочитает
  `~/.soba/config.json`.

## macOS Apple Silicon

```bash
bun install
bun run build:binary:mac-arm64
file dist/bin/soba-darwin-arm64
dist/bin/soba-darwin-arm64 --version
```

Результат: `dist/bin/soba-darwin-arm64`.

В бинарник встроены Bun runtime, код приложения и базовые локали. При запуске он не загружает внешний `bunfig.toml`
или Bun-managed `.env`; обычный `.env` проекта по-прежнему читает конфигурационный loader SOBA.

Передача на другой Mac:

```bash
scp dist/bin/soba-darwin-arm64 user@other-mac:~/bin/soba
ssh user@other-mac 'chmod +x ~/bin/soba && ~/bin/soba --version'
```

При первом запуске macOS может заблокировать неподписанный бинарник. Для внутренней разработки пользователь может
разрешить запуск в System Settings → Privacy & Security. Для публичного распространения нужен обычный Apple flow:
Developer ID signing и notarization.

## Другие цели

Универсального macOS-бинарника этот script не создаёт. Каждая архитектура собирается отдельно:

```bash
bun run build:binary -- bun-darwin-x64
bun run build:binary -- bun-linux-arm64
bun run build:binary -- bun-linux-x64
```

Для проверки Linux x64 есть отдельная короткая команда:

```bash
bun run build:binary:linux-x64
file dist/bin/soba-linux-x64-v$(bun -p "require('./package.json').version")
```

Эта команда запускает сборку в Docker-контейнере `linux/amd64`, делает временную копию репозитория без `node_modules`,
копирует её внутрь container filesystem и кладёт готовый бинарник обратно в `dist/bin/`. Это нужно, потому что OpenTUI
использует платформенные native packages, а Linux optional dependencies не устанавливаются в macOS `node_modules`.

Поддерживаемые значения: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-arm64`, `bun-linux-x64`.

Кросс-компиляция Bun поддерживается, но OpenTUI требует native package целевой платформы. Если нужная optional dependency
не установлена, собирайте на целевой ОС/архитектуре или установите соответствующий пакет OpenTUI перед сборкой.

## Проверка перед распространением

```bash
bun test
bun run lint
bun run build
bun run build:binary:mac-arm64
dist/bin/soba-darwin-arm64 --help
```

Проверяйте бинарник на чистой машине без репозитория рядом: конфигурация, локали и запуск TUI не должны зависеть от
исходников проекта.
