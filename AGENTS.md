# Repository Guidelines

## Project Structure & Module Organization

An **Obsidian plugin** (TypeScript) combining project version management with a global task/todo system.

```
src/
├── main.ts              # Plugin entry point
├── types.ts             # Shared interfaces & types
├── services/            # Business logic (data, migration, import/export, reminders)
├── utils/               # Helpers (date, frontmatter, IDs, sorting, caching)
├── view/                # UI views, modals, components
└── styles/              # CSS

tests/                   # Mirrors src/; Vitest + jsdom
├── mocks/               # Mock modules (obsidian.ts)
└── setup.ts             # Global test setup
```

Build output: `main.js` (esbuild bundle, committed for distribution).

## Build, Test, and Development Commands

| Command | Description |
|---|---|
| `npm run dev` | Watch mode — rebuilds `main.js` on change |
| `npm run build` | Type-check + production bundle |
| `npm run deploy` | Build + copy to local Obsidian plugin dirs |
| `npm run test` | Run all tests once |
| `npm run test:watch` | Vitest watch mode |
| `npm run lint` / `lint:fix` | ESLint on `src/` and `tests/` |
| `npm run format` / `format:check` | Prettier write or check |
| `npm version` | Bump version, stage `manifest.json`/`versions.json` |

## Coding Style & Naming Conventions

- **TypeScript** with strict null checks and `noImplicitAny`.
- **Naming:** `PascalCase.ts` for classes (services, views); `camelCase.ts` for utilities. Classes and views follow `PascalCase` (e.g., `DataService`, `DualPaneView`).
- **Formatting:** Prettier (default config). **Linting:** ESLint with `@typescript-eslint`.
- **Data conventions:** ISO 8601 UTC timestamps (`createdAt`, `updatedAt`); data files named `{name}__{id}.md`.

## Testing Guidelines

- **Framework:** Vitest + `jsdom`. Tests live in `tests/` mirroring `src/`.
- **Naming:** `*.test.ts`. Obsidian API mocked via `tests/mocks/obsidian.ts` (aliased in `vitest.config.ts`).
- **Run:** `npm run test` (CI) or `npm run test:watch` (development).
- **Focus:** Service-layer logic and pure utilities.

## Commit & Pull Request Guidelines

- **Commit messages:** The existing history uses Chinese (`初始可用版本：...`). Match the project's working language.
- **PRs:** Include a change summary, data-migration impacts (see `docs/migration-rules.md`), and manual-test steps for Obsidian views/modals.
- **Releases:** Run `npm version` to bump before tagging.

## Architecture Overview

- **Storage:** Markdown + YAML frontmatter under `<vault>/workflow-hub/` (`apps/`, `versions/`, `projects/`, `todos/`, `categories/`).
- **Migration:** `MigrationService` auto-migrates legacy data on first load.
- **UI:** Three tabs (Projects, Todos, Released). Projects support dual-pane and table views; todos have category tabs + multi-dimensional filtering.
- **Data layer:** `DataService` is the central store; domain services (`CategoryService`, `TodoService`, `BackupService`, etc.) handle specific logic.

## 本地部署路径

- **Obsidian 插件路径：** `/Users/lilingtao/知识库/.obsidian/plugins/obsidian-workflow-hub`
- 修改完成后运行 `npm run deploy` 即可构建并部署到该路径
- 部署命令会将 `main.js`、`manifest.json`、`styles.css` 复制到插件目录
