# SourceJS API Reference

> Warning: the API directory is large. Start with this index and open only the
> module page needed for the current task.

This directory documents SourceJS's public CommonJS modules, including the native CPR, Redis, SOCI and socket modules. Import the exact module path shown on each page.

Use the module pages to look up signatures, exports, constructors, methods, properties and resource-lifetime requirements. The current JavaScript declarations and native V8 validation define the runtime contract; examples must use direct imports and explicit cleanup where the API owns a handle.

See [SDK support](../sdk-support.md) for the complete Source 1 branch and architecture matrix.

## Contents

- [Runtime Discovery](#runtime-discovery)
- [CommonJS Package Root](#commonjs-package-root)
- [Maintenance](#maintenance)
- [Bundled UI and Data Example](#bundled-ui-and-data-example)
- [Modules](#modules)

## Runtime Discovery

`autodoc.GetModuleNames()` returns the names of non-function object entries in the current runtime's `sourcejs` object, excluding root-level helper functions such as `RegisterCommand`. This is the native runtime inventory, not a list of every JavaScript package file; it depends on the selected SDK and installed extensions. Ordinary JavaScript reflection shows the exports that actually exist in the current runtime:

```js
const { GetModuleNames } = require("autodoc");

function InspectRuntimeModules() {
	return GetModuleNames().map((strModuleName) => {
		const ModuleAPI = require(strModuleName);
		const vecExportNames = Reflect.ownKeys(ModuleAPI).filter((KeyValue) => typeof KeyValue === "string");

		return { ExportNames: vecExportNames, ModuleName: strModuleName };
	});
}

module.exports = { InspectRuntimeModules };
```

The whole-module import is deliberate here because this workflow inventories a runtime-selected module whose name is not known statically. Reflection is useful for capability checks, but it does not explain argument semantics, ownership or lifetime. Use the owning module page for exact signatures and practical examples.

Discovery can evaluate property getters, and `require` can initialize a module. Run this example on the server thread; it is not a sandboxed or side-effect-free inspection.

## CommonJS Package Root

The [CommonJS package entry](../../packages/sourcejs/index.js) exposes the following enumerable, read-only PascalCase properties. Each getter loads its exact module path on access and returns that module's exports without wrapping them. Importing the entry alone does not load the underlying modules. Lowercase root-property aliases are not retained; for example, use `Core`, not `core`.

| Root property | Module path |
| --- | --- |
| `Auth` | `auth` |
| `Autodoc` | `autodoc` |
| `BitBuffers` | `bitbuffers` |
| `Colors` | `colors` |
| `Commands` | `commands` |
| `Config` | `config` |
| `Core` | `core` |
| `CVars` | `cvars` |
| `Effects` | `effects` |
| `Engines` | `engines` |
| `Entities` | `entities` |
| `Events` | `events` |
| `Extensions` | `extensions` |
| `FileSystem` | `filesystem` |
| `Filters` | `filters` |
| `Globals` | `globals` |
| `Interfaces` | `interfaces` |
| `KeyValues` | `keyvalues` |
| `Listeners` | `listeners` |
| `Loggers` | `loggers` |
| `MathLibrary` | `mathlib` |
| `Memory` | `memory` |
| `Menus` | `menus` |
| `Messages` | `messages` |
| `NetChannel` | `netchannel` |
| `Paths` | `paths` |
| `Physics` | `physics` |
| `Players` | `players` |
| `Plugins` | `plugins` |
| `Public` | `public` |
| `Settings` | `settings` |
| `Steam` | `steam` |
| `StringTables` | `stringtables` |
| `Studio` | `studio` |
| `Translations` | `translations` |
| `Weapons` | `weapons` |

For Node.js tooling with `packages` on its module search path, `Object.keys(require("sourcejs"))` lists these properties without accessing their getters or requiring a native SourceJS runtime. Accessing a property can still fail when its module or native dependencies are unavailable; the loader error propagates to the caller.

These property names do not rename module paths. Game plugins should continue using direct named imports from the exact paths documented below. Native-only `cpr`, `redis`, `soci` and `socket` are not root-package properties; import them directly in a supporting SourceJS runtime. Run [the runtime-facade smoke test](../../tools/smoke_runtime_facades.js) to check the root inventory, lazy loading, module identity and property descriptors with isolated module-loader doubles.

## Maintenance

This reference is maintained by hand. When a public JavaScript export, class member, native registration or validation signature changes, update the owning module page in the same change.

Every API entry must include a practical JavaScript example with valid, declared inputs, concrete game objects where needed and explicit cleanup for owned resources. Run `python tools/verify_project.py` to check the public SourceJS packages and their documentation. Also verify argument semantics and run examples in a supported runtime.

Run `python tools/audit_api_docs.py` to list modules without a reference page and exported names without a recognizable description or JavaScript example. Add `--module memory/hooks` to focus on one module, `--json` for a machine-readable report, or `--strict` to return a failing exit status for gaps. The project verifier runs the strict audit. The source scan recognizes literal JavaScript facades and C++ registrations, including common installer patterns, across SDK branches. Computed exports, unusual registration patterns, and ambiguous documentation can still require a runtime snapshot or review.

For the actual installed surface of a specific SDK, generate a temporary plugin entry with `python tools/audit_api_docs.py --emit-collector > index.js`. Use that entry in a test-server plugin manifest, with autoload disabled, and load it after a map starts. It writes `addons/sourcejs/data/plugins/api-documentation/Inventory.json`. Unload the temporary plugin after capturing the inventory. The collector records properties, own class methods and bounded plain-object namespaces without instantiating classes or invoking getters; it cannot observe properties created only on class instances. Failed module imports are reported separately. Run `python tools/audit_api_docs.py --inventory Inventory.json`; repeat `--inventory` to combine snapshots from different SDKs. A matching example name is not proof that the example runs or that its signature is correct.

Run `python tools/audit_api_docs.py --links-only` to preview table links, or `--write-links` to add unambiguous links to existing sections on the same page. Neither command adds links to section headings or the table of contents.

## Bundled UI and Data Example

The [`api-ui-data` plugin](../../examples/plugins/disabled/api-ui-data/index.js) exercises messages, menus, configuration, settings, translations, authentication, string tables, temporary entities, physics and studio models. Move it out of `disabled` before loading it explicitly on a supported server. Run `sjs_api_ui inspect` after a map has loaded so map-dependent interfaces and resources are available. These are live demonstrations: they temporarily modify physics and hitbox values, use demonstration storage names and register temporary settings. They are not read-only inventory queries.

The three settings/storage demonstrations and the SQL/authentication demonstration pass required `Options` with `Blocking: false` and a callback to each request. They report results after their callback chains finish, attempt cleanup after failures and reject another `inspect` while those workflows are pending. Do not close a store immediately after scheduling a request or replace these callbacks with assumed synchronous return values. `sjs_api_ui show <unPlayerIndex>` sends the message/menu demonstrations to a connected human player.

Run [`node tools/smoke_api_ui_data.js`](../../tools/smoke_api_ui_data.js) for isolated JavaScript regression checks of callback ordering, required options, cleanup, registration rollback and current translation/authentication contracts. The test loads the complete plugin but skips unrelated synchronous SDK inspections. It does not exercise native IO, worker threads or engine-resource lifetimes; server-runtime testing is still required.

## Modules

| Module | Reference |
| --- | --- |
| `auth` | [Runtime API](auth.md), [backend class](auth-backend.md) |
| `auth/backends/flatfile` | [API](auth-backends-flatfile.md) |
| `auth/backends/sql` | [API](auth-backends-sql.md) |
| `auth/manager` | [API](auth-manager.md) |
| `auth/permissions` | [API](auth-permissions.md) |
| `autodoc` | [API](autodoc.md) |
| `bitbuffers` | [API](bitbuffers.md) |
| `colors` | [API](colors.md) |
| `commands` | [API](commands.md) |
| `commands/auth` | [API](commands-auth.md) |
| `commands/client` | [API](commands-client.md) |
| `commands/command` | [API](commands-command.md) |
| `commands/filter` | [API](commands-filter.md) |
| `commands/manager` | [API](commands-manager.md) |
| `commands/player` | [API](commands-player.md) |
| `commands/say` | [API](commands-say.md) |
| `commands/server` | [API](commands-server.md) |
| `commands/typed` | [API](commands-typed.md) |
| `config` | [API](config.md) |
| `config/command` | [API](config-command.md) |
| `config/cvar` | [API](config-cvar.md) |
| `config/manager` | [API](config-manager.md) |
| `config/section` | [API](config-section.md) |
| `core` | [API](core.md) |
| `core/cache` | [API](core-cache.md) |
| `core/command` | [API](core-command.md) |
| `core/command/auth` | [API](core-command-auth.md) |
| `core/command/docs` | [API](core-command-docs.md) |
| `core/command/dump` | [API](core-command-dump.md) |
| `core/command/plugin` | [API](core-command-plugin.md) |
| `core/dumps` | [API](core-dumps.md) |
| `core/logger` | [API](core-logger.md) |
| `core/settings` | [API](core-settings.md) |
| `core/table` | [API](core-table.md) |
| `core/update` | [API](core-update.md) |
| `core/version` | [API](core-version.md) |
| `cpr` | [API](cpr.md) |
| `cvars` | [API](cvars.md) |
| `cvars/convar` | [API](cvars-convar.md) |
| `cvars/flags` | [API](cvars-flags.md) |
| `cvars/public` | [API](cvars-public.md) |
| `cvars/tags` | [API](cvars-tags.md) |
| `effects` | [Runtime API](effects.md), [`TemporaryEntity`](effects-temp-entity.md) |
| `effects/fields` | [API](effects-fields.md) |
| `effects/hooks` | [API](effects-hooks.md) |
| `effects/templates` | [API](effects-templates.md) |
| `engines` | [API](engines.md) |
| `engines/gamerules` | [API](engines-gamerules.md) |
| `engines/precache` | [API](engines-precache.md) |
| `engines/server` | [API](engines-server.md) |
| `engines/sound` | [API](engines-sound.md) |
| `engines/trace` | [API](engines-trace.md) |
| `entities` | [API](entities.md) |
| `entities/classes` | [API](entities-classes.md) |
| `entities/collisions` | [API](entities-collisions.md) |
| `entities/constants` | [API](entities-constants.md) |
| `entities/data` | [API](entities-data.md) |
| `entities/datamaps` | [API](entities-datamaps.md) |
| `entities/dictionary` | [API](entities-dictionary.md) |
| `entities/engines` | [API](entities-engines.md) |
| `entities/engines/csgo/csgo` | [API](entities-engines-csgo-csgo.md) |
| `entities/animation` | [API](entities-animation.md) |
| `entities/entity` | [API](entities-entity.md) |
| `entities/factories` | [API](entities-factories.md) |
| `entities/helpers` | [API](entities-helpers.md) |
| `entities/outputs` | [API](entities-outputs.md) |
| `entities/props` | [API](entities-props.md) |
| `entities/transmit` | [API](entities-transmit.md) |
| `events` | [API](events.md) |
| `events/custom` | [API](events-custom.md) |
| `events/listener` | [API](events-listener.md) |
| `events/manager` | [API](events-manager.md) |
| `events/resource` | [API](events-resource.md) |
| `events/variable` | [API](events-variable.md) |
| `extensions` | [API](extensions.md) |
| `filesystem` | [API](filesystem.md) |
| `filters` | [API](filters.md) |
| `filters/entities` | [API](filters-entities.md) |
| `filters/iterator` | [API](filters-iterator.md) |
| `filters/players` | [API](filters-players.md) |
| `filters/recipients` | [API](filters-recipients.md) |
| `filters/weapons` | [API](filters-weapons.md) |
| `globals` | [API](globals.md) |
| `interfaces` | [API](interfaces.md) |
| `keyvalues` | [API](keyvalues.md) |
| `listeners` | [API](listeners.md) |
| `listeners/tick` | [API](listeners-tick.md) |
| `loggers` | [API](loggers.md) |
| `mathlib` | [API](mathlib.md) |
| `memory` | [API](memory.md) |
| `memory/gamedata` | [API](memory-gamedata.md) |
| `memory/helpers` | [API](memory-helpers.md) |
| `memory/hooks` | [Native hooks](memory-hooks.md), [callback classes](memory-hooks-callbacks.md) |
| `memory/hooks/entities` | [API](memory-hooks-entities.md) |
| `memory/hooks/events` | [API](memory-hooks-events.md) |
| `memory/hooks/exceptions` | [API](memory-hooks-exceptions.md) |
| `memory/hooks/messages` | [API](memory-hooks-messages.md) |
| `memory/hooks/warnings` | [API](memory-hooks-warnings.md) |
| `memory/manager` | [API](memory-manager.md) |
| `menus` | [Native transport](menus.md), [menu objects](menus-objects.md) |
| `menus/esc` | [API](menus-esc.md) |
| `menus/queue` | [API](menus-queue.md) |
| `menus/radio` | [API](menus-radio.md) |
| `messages` | [Native transport](messages.md), [typed messages](messages-types.md) |
| `messages/colors` | [API](messages-colors.md) |
| `messages/colors/saytext2` | [API](messages-colors-saytext2.md) |
| `messages/dialog` | [API](messages-dialog.md) |
| `messages/implementation` | [API](messages-implementation.md) |
| `netchannel` | [API](netchannel.md) |
| `paths` | [API](paths.md) |
| `physics` | [API](physics.md) |
| `players` | [API](players.md) |
| `players/baseclient` | [API](players-baseclient.md) |
| `players/bots` | [API](players-bots.md) |
| `players/constants` | [API](players-constants.md) |
| `players/dictionary` | [API](players-dictionary.md) |
| `players/dropweapon` | [API](players-dropweapon.md) |
| `players/engines` | [API](players-engines.md) |
| `players/engines/bms` | [API](players-engines-bms.md) |
| `players/engines/csgo` | [API](players-engines-csgo.md) |
| `players/engines/l4d2` | [API](players-engines-l4d2.md) |
| `players/engines/orangebox` | [API](players-engines-orangebox.md) |
| `players/engines/orangebox/cstrike` | [API](players-engines-orangebox-cstrike.md) |
| `players/entity` | [API](players-entity.md) |
| `players/helpers` | [API](players-helpers.md) |
| `players/language` | [API](players-language.md) |
| `players/language/cache` | [Internal cache](players-language.md#internal-language-cache) |
| `players/teams` | [API](players-teams.md) |
| `players/voice` | [API](players-voice.md) |
| `plugins` | [API](plugins.md) |
| `plugins/bus` | [API](plugins-bus.md) |
| `plugins/command` | [API](plugins-command.md) |
| `plugins/info` | [API](plugins-info.md) |
| `plugins/instance` | [API](plugins-instance.md) |
| `plugins/manager` | [API](plugins-manager.md) |
| `public` | [API](public.md) |
| `redis` | [API](redis.md) |
| `settings` | [API](settings.md) |
| `settings/menu` | [API](settings-menu.md) |
| `settings/player` | [API](settings-player.md) |
| `settings/storage` | [API](settings-storage.md) |
| `settings/types` | [API](settings-types.md) |
| `soci` | [API](soci.md) |
| `socket` | [API](socket.md) |
| `steam` | [API](steam.md) |
| `stringtables` | [API](stringtables.md) |
| `stringtables/downloads` | [API](stringtables-downloads.md) |
| `studio` | [API](studio.md) |
| `studio/animation` | [API](studio-animation.md) |
| `studio/cache` | [API](studio-cache.md) |
| `studio/constants` | [API](studio-constants.md) |
| `translations` | [API](translations.md) |
| `translations/catalog` | [API](translations-catalog.md) |
| `translations/manager` | [API](translations-manager.md) |
| `translations/strings` | [API](translations-strings.md) |
| `weapons` | [API](weapons.md) |
| `weapons/constants` | [API](weapons-constants.md) |
| `weapons/data` | [API](weapons-data.md) |
| `weapons/dictionary` | [API](weapons-dictionary.md) |
| `weapons/engines` | [API](weapons-engines.md) |
| `weapons/engines/csgo` | [API](weapons-engines-csgo.md) |
| `weapons/entity` | [API](weapons-entity.md) |
| `weapons/instance` | [API](weapons-instance.md) |
| `weapons/manager` | [API](weapons-manager.md) |
| `weapons/restrictions` | [API](weapons-restrictions.md) |
| `weapons/scripts` | [API](weapons-scripts.md) |
