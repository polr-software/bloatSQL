# BloatSQL Architecture Convention

## Purpose

This document defines the target architecture for BloatSQL.

It is intentionally opinionated:

- modular first
- feature-oriented
- clean boundaries over convenience
- thin UI
- thin Tauri commands
- business rules in explicit use-cases
- infrastructure isolated behind ports

The goal is not abstract "enterprise clean architecture".
The goal is a desktop product that stays elegant as it grows.

## Current Diagnosis

The project already has good raw material:

- clear runtime split: React frontend and Rust backend
- database drivers hidden behind a Rust trait
- some logic extracted into testable pure modules
- UI concerns mostly separated from database driver details

The main architectural problems are consistency and boundaries.

### What is working

- `src-tauri/src/db/connection.rs` already defines a stable backend port for drivers.
- `src-tauri/src/db/factory.rs` centralizes driver creation.
- Logic such as `addRowFlow`, `deleteRowsFlow`, `cellEditForm.logic`, and `useSchemaMutationSync.logic` is testable and worth expanding.
- `App.tsx` is composition-oriented and not overloaded with implementation details.

### What is not working

- Application orchestration is split across `useAppController`, many Zustand stores, component hooks, and direct `tauriCommands` calls.
- Stores are not only state containers. They also coordinate other stores, issue side effects, and encode use-cases.
- Frontend types are too global. `src/types/database.ts` mixes connection models, query models, export models, mutation models, and formatting helpers.
- Tauri mapping code is centralized in one large file instead of being colocated with each feature.
- Rust `commands.rs` is becoming a second application layer, DTO layer, and error formatting layer all at once.

## Architectural Decision

BloatSQL should use:

1. vertical feature modules
2. clean layers inside each feature
3. explicit use-cases for business flows
4. local state stores owned by a feature
5. shared infrastructure adapters instead of direct cross-feature calls

The architecture is not "store-driven".
It is "feature + use-case driven".

## Frontend Target Structure

```text
src/
  app/
    providers/
    routes/
    composition/
    startup/

  features/
    connections/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

    database-browser/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

    sql-runner/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

    table-data/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

    schema/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

    schema-editor/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

    diagram/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

    export/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

    preferences/
      domain/
      application/
      infrastructure/
      presentation/
      index.ts

  shared/
    ui/
    lib/
    types/
    test/
```

## Layer Rules

### `domain/`

Contains:

- entities
- value objects
- domain rules
- pure transformations
- feature-specific types

Must not contain:

- React
- Zustand
- Tauri
- notifications
- browser APIs

### `application/`

Contains:

- use-cases
- commands and queries
- orchestration between repositories/services
- app-level policies

Typical examples:

- `connectToDatabase`
- `changeCurrentDatabase`
- `executeSql`
- `openTableData`
- `applySchemaChanges`
- `loadDiagram`

This is where the real product behavior lives.

### `infrastructure/`

Contains:

- Tauri adapters
- DTO mappers
- repository implementations
- persistence bindings
- external API calls

This layer is allowed to know about transport details like `snake_case`, `invoke`, and backend payloads.

### `presentation/`

Contains:

- React components
- feature-local hooks for UI wiring
- feature-local view stores
- presenters / view models

Presentation may call application use-cases.
Presentation may not reach into another feature's store directly.

## State Management Rules

Zustand stays, but with stricter ownership.

### Allowed

- local UI state for a feature
- persisted UI preferences
- ephemeral selection state
- view-only cache that belongs to one feature

### Not allowed

- store A calling `storeB.getState()` to execute business flows
- stores directly coordinating other features
- stores mutating the query editor, table state, and edit state in one action
- side-effect heavy orchestration inside generic global stores

### Rule of thumb

If logic requires two or more subsystems, it belongs in `application/`, not in a store.

## Dependency Rules

Dependencies must point inward:

```text
presentation -> application -> domain
infrastructure -> application/domain
shared -> nobody depends on feature internals
```

Additional rules:

- one feature may import another feature only through its public `index.ts`
- no feature imports from another feature's `presentation/`
- no component imports another feature's store
- no shared module imports from `features/`
- `app/` is the only layer allowed to compose multiple features freely

## Public API Rule

Every feature exposes a narrow public surface:

```text
features/sql-runner/index.ts
features/schema-editor/index.ts
```

Only these files are imported outside the feature.

Inside a feature, internal folders are private by default.

## Frontend Ports

The frontend should stop depending on one global `tauriCommands` object.

Instead, each feature owns its port.

Examples:

- `features/connections/application/ports/ConnectionsRepository.ts`
- `features/sql-runner/application/ports/SqlExecutor.ts`
- `features/schema/application/ports/SchemaRepository.ts`
- `features/export/application/ports/ExportRepository.ts`

Then infrastructure implements those ports using Tauri.

This reduces blast radius and stops transport DTOs from leaking across the whole app.

## Type Ownership Rule

Do not keep growing `src/types/database.ts`.

Types must live with the feature that owns them.

Examples:

- connection form types inside `features/connections`
- query result types inside `features/sql-runner`
- schema mutation types inside `features/schema-editor`
- export types inside `features/export`

`shared/types` is only for primitives reused by multiple features without creating coupling.

## UI Composition Rule

`App.tsx` and `app/composition` should compose features, not implement behavior.

Good:

- wire providers
- place layout regions
- inject feature entry components

Bad:

- orchestrate database changes
- manage modal business rules
- coordinate editing resets across several stores

If composition needs logic, create an application-level use-case and call that.

## Backend Target Structure

```text
src-tauri/src/
  app/
    state/
    bootstrap/

  interfaces/
    tauri/
      commands/
      dto/
      mappers/

  application/
    connections/
    sql/
    schema/
    export/
    browser/

  domain/
    db/
    connections/
    schema/

  infrastructure/
    db/
      postgresql/
      mariadb/
    storage/
```

## Backend Layer Rules

### `interfaces/tauri`

Contains only:

- command handlers
- request/response DTOs
- mapping from DTO to application input

Tauri commands must stay thin.
They should delegate immediately to application services.

### `application/`

Contains:

- use-cases like connect, execute query, list tables, apply schema operations, export database
- session coordination
- transaction policies
- error normalization

### `domain/`

Contains:

- core contracts such as `DatabaseConnection`
- domain result models
- schema operation semantics

### `infrastructure/`

Contains:

- MariaDB/PostgreSQL driver implementations
- SQLite-backed connection storage
- filesystem adapters

## Rust Specific Conventions

- `commands.rs` should be split by feature, not grow forever as one transport file.
- Request/response DTOs must not double as domain models.
- Session state such as `ActiveConnection` should live in `app/state`.
- Repeated "no active connection" branches should be centralized in an application service or helper, not copied per command.
- Error mapping should happen once per boundary.

## Naming Convention

Use names that reveal intent.

Prefer:

- `executeSqlUseCase`
- `changeDatabaseUseCase`
- `schemaRepository`
- `ConnectionSession`
- `SqlResultPresenter`

Avoid vague names like:

- `utils`
- `helpers`
- `manager`
- `controller`
- `store` for things that are not mostly state

`Controller` is allowed only at integration boundaries if it truly coordinates UI events, but use-cases are preferred.

## Testing Convention

Tests should follow the same architectural seams.

### High value tests

- domain rule tests
- application use-case tests
- mapper tests
- driver contract tests
- flow tests for mutations and schema sync

### Lower value tests

- snapshot-heavy presentational tests
- tests that only assert Zustand setter behavior

The strongest default is:

- pure logic in `domain/` and `application/`
- thin UI wrappers around that logic

## Recommended Feature Map For This Project

Use these feature boundaries:

- `connections`
  - saved connections
  - connect/disconnect
  - ping

- `database-browser`
  - databases list
  - tables list
  - current database context

- `sql-runner`
  - editor text
  - execute SQL
  - query history
  - result metadata

- `table-data`
  - selected table data
  - cell edit
  - add row
  - delete rows
  - row selection

- `schema`
  - table columns
  - relationships
  - schema cache

- `schema-editor`
  - pending operations
  - draft column editing
  - apply schema changes

- `diagram`
  - graph projection
  - layout preferences
  - diagram UI state

- `export`
  - export config
  - export execution

- `preferences`
  - theme
  - persisted UI settings
  - layout preferences

## Current-to-Target Mapping

Map current code like this:

- `src/stores/connectionStore.ts` -> split into `connections/presentation` state and `connections/application` use-cases
- `src/stores/databaseBrowserStore.ts` -> `database-browser/application` plus feature-local presentation state
- `src/stores/queryExecutionStore.ts` -> split into `sql-runner/application` and `table-data/application`
- `src/stores/schemaStore.ts` -> `schema/application` cache + repository
- `src/stores/structureEditStore.ts` -> `schema-editor/presentation`
- `src/hooks/useAppController.ts` -> dissolve into feature entry hooks and a small app composition layer
- `src/tauri/commands.ts` -> split into per-feature infrastructure adapters
- `src/types/database.ts` -> distribute into feature-owned models
- `src-tauri/src/commands.rs` -> split into `interfaces/tauri/commands/*`

## Migration Order

Refactor in this order:

1. define feature folders and public APIs
2. move types into owning features
3. extract frontend use-cases from Zustand stores
4. reduce `useAppController` into app composition only
5. split `tauriCommands` into per-feature repositories/adapters
6. split Rust `commands.rs` by feature
7. introduce backend application services between Tauri and drivers

This order keeps the app shippable during migration.

## Non-Negotiable Rules

- no cross-feature `getState()` orchestration
- no new global catch-all `types` files
- no new giant transport files
- no direct component-to-Tauri integration outside feature infrastructure
- no business logic hidden in layout components
- every feature must have a public API and private internals

## What "Apple Level" Means Here

For this project, "high level" architecture means:

- every module has one owner and one reason to change
- the UI reads like composition, not a wiring accident
- data contracts are local and obvious
- state is calm and predictable
- changing one feature does not destabilize five others
- drivers and transport can evolve without touching domain rules

Minimal surface area. Strong boundaries. Predictable behavior.
