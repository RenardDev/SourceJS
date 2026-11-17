# `require("engines/precache")`

> Warning: this page documents direct engine precache calls and managed JavaScript resources that repeat precaching on map events. Native indexes and download tables remain map-dependent. Read the table of contents and the lifecycle and download sections before generating plugin code.

`engines/precache` exposes the selected Source 1 SDK's model, generic-file, decal, and sound precache operations. Its managed JavaScript classes attempt precaching during construction when the engine reports a nonempty map name, then register for later `server_spawn` events and optionally create a `Downloadables` collection. Construction and later event handling can fail; a nonempty map name does not prove every required engine service is ready. Their `Unload()` method unregisters the event listener and disposes the optional collection; ensure the plugin lifecycle invokes it.

Precache operations do not install files on the server. Referenced custom files must already be available through the game's resource search paths before precaching; adding a download-table entry does not supply missing server files.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import and native availability](#import-and-native-availability)
- [Direct precache functions](#direct-precache-functions)
- [Managed resource lifecycle](#managed-resource-lifecycle)
- [PrecacheResourceBase](#precacheresourcebase)
- [Resource classes](#resource-classes)
- [String-table indexes and errors](#string-table-indexes-and-errors)
- [Download ownership](#download-ownership)
- [Practical plugin workflow](#practical-plugin-workflow)
- [Custom resource classes](#custom-resource-classes)
- [Safety and lifetime](#safety-and-lifetime)
- [Related modules](#related-modules)

## Location and purpose

[`packages/sourcejs/engines/precache.js`](../../packages/sourcejs/engines/precache.js) builds the public managed-resource layer over the native `engines/precache` module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). The package coordinates native precache calls with [`events/manager`](events-manager.md), [`stringtables`](stringtables.md), and [`engines/server`](engines-server.md).

Use direct functions for one call inside a lifecycle the plugin already owns. Use managed resource classes to repeat the call on subsequent `server_spawn` events and optionally manage a download-table entry. Arrange for `Unload()` during plugin cleanup; it attempts listener removal before disposing the download collection and still attempts disposal if removal throws.

Native calls, managed construction, map-event handling, index lookup and cleanup run synchronously in the initialized JavaScript/server-game-thread context. They do not schedule IO-worker requests; do not move engine or string-table operations onto an IO worker.

## Import and native availability

```js
const g_Precache = require("engines/precache");
console.log(Object.keys(g_Precache).sort());
```

Successful native module installation registers all four direct functions; an export's presence does not prove that it can run. Model, generic-file, and decal calls require `IVEngineServer`; sound calls require compiled `SOURCEJS_HAS_ENGINE_SOUND` support and an available `IEngineSound`. Calls throw JavaScript errors when the required interface or sound support is unavailable. The sound callback is shared with `engines/sound`, so its diagnostics use that module name. JavaScript wrappers supply default boolean arguments and forward native results without synthesizing success or fallback values.

The exact export set is:

| Export | Kind |
| --- | --- |
| `PrecacheModel`, `PrecacheGeneric`, `PrecacheDecal`, `PrecacheSound` | JavaScript wrappers forwarding to native functions. |
| `ModelPrecacheResource`, `GenericPrecacheResource`, `DecalPrecacheResource`, `SoundPrecacheResource` | Managed concrete resource classes. |
| [`PrecacheResourceBase`](#precacheresourcebase) | Managed-resource base class; subclasses must implement its throwing `Precache()` and `GetPrecacheTableName()` methods. JavaScript does not prevent constructing the base class. |
| `PrecacheResourceError` | Error thrown by `GetPrecacheIndex()` when its current string-table search returns no matching index, including when the table is missing. It is not automatically raised for every unsuccessful native precache result. |

## Direct precache functions

| Function | Return | Native operation |
| --- | --- | --- |
| `PrecacheModel(strFilePath, bPreload = false)` | `number` | Calls `IVEngineServer::PrecacheModel` and returns its native integer result unchanged. The wrapper does not validate that the result is a usable model-precache index. |
| `PrecacheGeneric(strFilePath, bPreload = false)` | `number` | Calls `IVEngineServer::PrecacheGeneric` and returns its native integer result unchanged, without converting an engine failure sentinel into an exception. |
| `PrecacheDecal(strDecalName, bPreload = false)` | `number` | Calls `IVEngineServer::PrecacheDecal` and returns its native integer result unchanged, without converting an engine failure sentinel into an exception. |
| `PrecacheSound(strSample, bPreload = false, bUISound = false)` | `boolean` | Returns the result of `IEngineSound::PrecacheSound`, including `false`; it is not a sound-table index. With `SOURCEJS_OLD_CONSOLE_API`, `bUISound` is validated but not passed to the SDK's two-argument call. Otherwise all three arguments are passed. |

Paths, decal names, and sound samples must be strings whose converted UTF-8 prefix before the first NUL is nonempty. The current native conversion truncates at embedded NUL rather than rejecting it; reject NUL in plugin input to avoid precaching a different name than intended. Optional flags must be primitive booleans when supplied; `null`, numbers, strings, and Boolean objects are rejected. Omission or `undefined` selects `false`.

Model, generic-file, and decal callbacks translate C++ preparation, interface lookup, dispatch, and result-construction failures into operation-specific JavaScript errors. The diagnostic module name is `engines/precache`, including calls forwarded through `engines`. This boundary does not undo precaching that already reached the engine; ordinary native integer failure sentinels remain unchanged.

The paths below are illustrative, not guaranteed assets in every Source game. Verify them against the selected game and invoke the example only during a valid precache lifecycle phase. The bundled TF2 and L4D2 SDK headers document model indexes as one-based, with zero indicating failure, while generic and decal indexes are zero-based. The calls are sequential, not transactional: an exception or later failure does not undo earlier precaching.

```js
const { PrecacheModel, PrecacheGeneric, PrecacheDecal, PrecacheSound } = require("engines/precache");

function PrecacheSelectedGameResources() {
	const nModelIndex = PrecacheModel("models/props_junk/wood_crate001a.mdl", true);
	const nGenericIndex = PrecacheGeneric("scripts/game_sounds_manifest.txt", false);
	const nDecalIndex = PrecacheDecal("decals/blood1", false);
	const bSoundReady = PrecacheSound("ui/buttonclick.wav", true, true);

	if ((nModelIndex <= 0) || (nGenericIndex < 0) || (nDecalIndex < 0) || !bSoundReady) {
		throw new Error("One or more selected-game resources could not be precached.");
	}

	console.log({
		ModelIndex: nModelIndex,
		GenericIndex: nGenericIndex,
		DecalIndex: nDecalIndex,
		SoundReady: bSoundReady,
	});
}

PrecacheSelectedGameResources();
```

After successful interface and argument validation, each direct function performs one engine precache call. The wrappers do not register a map listener, add a download-table entry, or remove anything during plugin unload. Use them inside a known map lifecycle callback when the plugin owns that lifecycle itself.

## Managed resource lifecycle

The concrete resource classes inherit this constructor shape (shown with `ModelPrecacheResource`); option keys use PascalCase:

```text
new ModelPrecacheResource(strResourcePath, { Preload: false, Download: false, UISound: false });
```

All three options are optional strict booleans. An absent own property defaults to `false`; an explicitly supplied `undefined` or `null` is rejected, unlike omitted/`undefined` positional flags in direct calls. The options value must be a non-null, non-array object. An omitted or `undefined` options argument uses an empty object.

The base constructor checks only that `strResourcePath` is a nonempty string; it does not reject embedded NUL or normalize the stored path. Supply NUL-free reviewed resource names. Native calls use the UTF-8 prefix before NUL, while `GetPrecacheIndex()` still searches the unchanged `GetPrecacheTableValue()` text; a successful native call does not prove that those names match.

| Option | Effect |
| --- | --- |
| `Preload` | Passes the preload flag to the native precache call. |
| `Download` | Creates a `Downloadables` collection and calls `Add(GetDownloadPath())` after listener registration. The constructor does not check the `Add()` return value; thrown errors enter its cleanup path. |
| `UISound` | `SoundPrecacheResource` forwards this flag to the sound wrapper; other classes preserve the field but do not pass it to their native call. The native old-console branch validates but ignores it. |

After validating the resource path/options and initializing its state, construction enters a guarded setup sequence:

1. Read the live `engines/server.GetGlobalVariables().MapName`.
2. If the reported map name is nonempty, call the concrete `Precache()` method immediately. Its return value is not checked by the base constructor.
3. Register one `server_spawn` callback.
4. If `Download` is enabled, create a `Downloadables` collection and call `Add(GetDownloadPath())`. The return value of `Add()` is not checked.

If a guarded setup phase throws, construction calls `Unload()` and rethrows the original value unchanged when cleanup returns normally. If cleanup also throws, construction throws `AggregateError([SetupError, CleanupError], ...)`, preserving both failures in that order, including falsy thrown values. When both cleanup operations fail, `CleanupError` is itself an `AggregateError` containing the listener-removal and collection-disposal failures in order. This does not undo native precaching. Validation failures before the guarded sequence do not call `Unload()`.

The class can defer precaching while `MapName` is empty, provided global-state lookup and event registration are available. This is a map-name check, not a main-menu detector. A later `server_spawn` callback attempts precaching. The runtime invokes the case-sensitive SourceJS-owned lifecycle key `Unload`; no lowercase alias is installed:

```js
const { ModelPrecacheResource } = require("engines/precache");
const { GetGlobalVariables } = require("engines/server");

const g_CrateModel = new ModelPrecacheResource("models/props_junk/wood_crate001a.mdl", { Preload: true });

function UnloadPlugin() {
	return g_CrateModel.Unload();
}

try {
	if (GetGlobalVariables().MapName.length === 0) {
		console.log("The model is scheduled for a precache attempt on server_spawn.");
	}
} catch (ErrorValue) {
	try {
		if (!UnloadPlugin()) {
			throw new Error("Model resource cleanup returned failure.");
		}
	} catch (CleanupError) {
		throw new AggregateError([ErrorValue, CleanupError], "Model resource setup and cleanup failed.");
	}

	throw ErrorValue;
}

module.exports = {
	Unload: UnloadPlugin,
};
```

The resource does not unregister its callback on a map transition. While that listener remains active, each delivered `server_spawn` calls `OnServerSpawn(GameEvent)`, whose base implementation returns `Precache(GameEvent)`. This is an attempt, not a guarantee of a usable index or successful resource load. `Unload()` stops subsequent calls only when listener removal succeeds.

## PrecacheResourceBase

`PrecacheResourceBase` is abstract by convention: its `GetPrecacheTableName()` and `Precache()` methods throw unless overridden. JavaScript permits base-class construction when immediate precaching is skipped, but later use can then fail. Instantiate `ModelPrecacheResource`, `GenericPrecacheResource`, `DecalPrecacheResource`, or `SoundPrecacheResource`, or derive a class implementing both methods. The base constructor can call the overridden `Precache()` before the derived constructor has initialized its own fields.

### Live fields and getters

| Member | Type | Meaning |
| --- | --- | --- |
| `ResourcePath` | `string` | Initialized from the engine resource path or decal name; ordinary writable state, not an immutable snapshot. |
| `Preload` | `boolean` | Flag passed to the concrete native precache call. |
| `Download` | `boolean` | Constructor option requesting a download collection; not proof that the current table contains an entry. Changing it later does not create or dispose a collection. |
| `UISound` | `boolean` | UI-sound flag used by `SoundPrecacheResource`. |
| `Downloadables` | `Downloadables` or `null` | Collection created when download tracking is requested; cleared after `Dispose()` returns normally during `Unload()`. A disposal failure leaves this reference available for retry, independently of listener cleanup. |
| `Registered` | `boolean` | Local registration bookkeeping, set after the registration call returns and cleared after removal returns. Those calls' return values are not checked; this flag is not an independent query of event-manager state. |
| `ServerSpawnCallback` | `Function` | Stable callback passed to `RegisterEventListener()` and `UnregisterEventListener()`. Do not replace it. |
| `GetDownloadPath()` | `string` | Value supplied to the optional collection's `Add()` during construction. The base getter returns `ResourcePath`; calling it does not insert anything. |
| `GetPrecacheIndex()` | `number` | Searches the current table for the first exact match of `GetPrecacheTableValue()`; throws `PrecacheResourceError` when no index is found, including a missing table. Lookup errors can propagate separately. Does not cache or preserve an index across maps. |
| `GetPrecacheTableName()` | `string` | Required subclass implementation returning the precache string-table name; the base implementation throws. |
| `GetPrecacheTableValue()` | `string` | Value searched by `GetPrecacheIndex()`; defaults to `ResourcePath`. |

The fields are ordinary JavaScript instance state, not independently validated engine status. This example reports them and then attempts cleanup; a cleanup exception can replace a reporting error. Verify the sample path and engine lifecycle before running it. The reported download path is computed even though this example does not enable downloads:

```js
const { SoundPrecacheResource } = require("engines/precache");

const g_Notification = new SoundPrecacheResource("ui/buttonclick.wav", { Preload: true, UISound: true });

try {
	console.log({
		Preload: g_Notification.Preload,
		Registered: g_Notification.Registered,
		UISound: g_Notification.UISound,
		DownloadPath: g_Notification.GetDownloadPath(),
		ResourcePath: g_Notification.ResourcePath,
		Sample: g_Notification.GetSoundSample(),
	});
} finally {
	if (!g_Notification.Unload()) {
		throw new Error("Could not unload the notification sound resource.");
	}
}
```

### Methods

| Method | Return | Behavior |
| --- | --- | --- |
| `RegisterServerSpawnListener()` | `true` on normal return | Returns immediately when `Registered` is true; otherwise calls event registration, then sets the flag. It ignores the registration result and can throw. Repeated calls avoid registration while the local flag remains true. |
| `OnServerSpawn(GameEvent)` | concrete result | Returns `Precache(GameEvent)` and propagates its errors. Built-in classes ignore the event argument. |
| `Precache()` | concrete result | Base implementation throws; built-in overrides forward their native call's result, including failure values. |
| `Unload()` | `true` on normal return | Attempts listener removal and collection disposal independently, in that order; successful steps clear their own state, and failed steps remain recorded for retry. One thrown value is rethrown unchanged; two failures produce `AggregateError([ListenerError, DisposalError], ...)`. Cleanup-call return values remain ignored. After normal cleanup, repeated calls have no remaining local work. |

`Unload()` attempts listener and download-collection cleanup; it does not destroy the JavaScript object or prohibit later method calls. It makes no native unprecache call and cannot remove a string already inserted into a map's precache table. A normal return reflects completed local bookkeeping, not independent verification of event-manager or download-table state.

This example exercises local registration bookkeeping with the same callback. Run it only in a valid precache lifecycle phase with the manifest available: the explicit `OnServerSpawn()` call invokes precaching immediately, not through event dispatch. Normal return values and `Registered` do not independently confirm event-manager state. Downloads are disabled; re-registering a listener after `Unload()` would not recreate a disposed download collection. Final cleanup is attempted even if the body throws and can replace an earlier error:

```js
const { GenericPrecacheResource } = require("engines/precache");

const g_Manifest = new GenericPrecacheResource("scripts/game_sounds_manifest.txt");

try {
	if (!g_Manifest.RegisterServerSpawnListener() || !g_Manifest.RegisterServerSpawnListener()) {
		throw new Error("Server-spawn registration returned failure.");
	}

	console.log(g_Manifest.Registered);

	if (!g_Manifest.Unload() || !g_Manifest.RegisterServerSpawnListener()) {
		throw new Error("Could not re-register the manifest resource listener.");
	}

	const nManifestIndex = g_Manifest.OnServerSpawn({ EventName: "server_spawn" });
	if (nManifestIndex < 0) {
		throw new Error("Could not precache the manifest after restarting its lifecycle.");
	}
} finally {
	if (!g_Manifest.Unload()) {
		throw new Error("Could not unload the manifest resource.");
	}
}
```

## Resource classes

All concrete classes use the base constructor and inherit its state and lifecycle methods. Each overrides `GetPrecacheTableName()` and `Precache()`; the sound class also overrides `GetDownloadPath()` and adds `GetSoundSample()`.

| Class | `GetPrecacheTableName()` | Native call | Additional members |
| --- | --- | --- | --- |
| `ModelPrecacheResource` | `modelprecache` | `PrecacheModel(this.ResourcePath, this.Preload)` | None beyond the overrides described above. |
| `GenericPrecacheResource` | `genericprecache` | `PrecacheGeneric(this.ResourcePath, this.Preload)` | None beyond the overrides described above. |
| `DecalPrecacheResource` | `decalprecache` | `PrecacheDecal(this.ResourcePath, this.Preload)` | None beyond the overrides described above. |
| `SoundPrecacheResource` | `soundprecache` | `PrecacheSound(this.ResourcePath, this.Preload, this.UISound)` | `GetSoundSample()` and sound-aware `GetDownloadPath()`. |

`SoundPrecacheResource.GetSoundSample()` and the inherited `GetPrecacheTableValue()` return the current `ResourcePath` unchanged; `Precache()` forwards that value to the native sound call. `GetDownloadPath()` replaces backslashes with forward slashes and prepends `sound/` unless the resulting string already starts with that exact case-sensitive prefix. It does not modify the stored sample or validate filesystem containment. Before running this example, install the custom sound for the selected game and choose a valid lifecycle phase. `Array.from()` reports the JavaScript collection, not proof of client delivery:

```js
const { SoundPrecacheResource } = require("engines/precache");

const g_CustomSound = new SoundPrecacheResource("sourcejs/round_ready.wav", { Preload: true, Download: true });

try {
	console.log(g_CustomSound.GetSoundSample());
	console.log(g_CustomSound.GetDownloadPath());
	console.log(Array.from(g_CustomSound.Downloadables));
} finally {
	if (!g_CustomSound.Unload()) {
		throw new Error("SoundPrecacheResource.Unload failed.");
	}
}
```

Do not pass `sound/sourcejs/round_ready.wav` to the native sound precache call unless that exact sample spelling is required by the selected game. The class keeps the engine sample and client download path separate.

## String-table indexes and errors

`GetPrecacheIndex()` calls `GetPrecacheTableName()` and `GetPrecacheTableValue()`, then resolves the table through `stringtables.Find()`, not `FindStringTable()`. The helper checks `StringCount` on each loop iteration and reads entries through `stringtables.GetString(strTableName, unStringIndex)`, returning the first exact string match. These separate reads are not an atomic snapshot. It does not cache an index across maps or trigger precaching. A missing table or no match produces `PrecacheResourceError`; underlying lookup/getter errors can propagate separately.

```js
const { ModelPrecacheResource, PrecacheResourceError } = require("engines/precache");

const g_CrateModel = new ModelPrecacheResource("models/props_junk/wood_crate001a.mdl");

try {
	console.log(`modelprecache index: ${g_CrateModel.GetPrecacheIndex()}`);
} catch (ErrorValue) {
	if (!(ErrorValue instanceof PrecacheResourceError)) {
		throw ErrorValue;
	}

	console.log(`${ErrorValue.ResourcePath} was not found in ${ErrorValue.TableName}; the table itself may be unavailable.`);
} finally {
	if (!g_CrateModel.Unload()) {
		throw new Error("ModelPrecacheResource.Unload failed.");
	}
}
```

`PrecacheResourceError` extends `Error` and exposes:

| Field | Value |
| --- | --- |
| `name` | `"PrecacheResourceError"` |
| `message` | Formats the supplied resource value and table name; does not establish why lookup failed. |
| `ResourcePath` | Resource value supplied to the error constructor. `GetPrecacheIndex()` obtains it by calling `GetPrecacheTableValue()` again after an unsuccessful search. |
| `TableName` | Table name supplied to the error constructor. `GetPrecacheIndex()` calls `GetPrecacheTableName()` again on its error path; this field is not evidence that the entire table is missing. |

An index lookup can fail before the first map starts, after a map transition, when the selected branch omits the expected table, or when the native precache call rejected the resource. A failed search alone does not distinguish those causes. Keep custom table-name/value getters stable and side-effect-free: they are called again to construct the error, and can return different diagnostic values or throw a different error.

## Download ownership

After successful construction with `Download: true`, `Downloadables` is a `stringtables.Downloadables` instance extending `Set`. `Add()` requires a nonnegative safe-integer native tracking index before adding a new normalized local value. `delete()` first calls native untracking if no other registered collection in that package instance contains the same value, ignores its return value, then removes the local value. A thrown untracking error retains that local value. This is shared local bookkeeping, not exclusive ownership of an engine table entry. `clear()` repeats deletion, and `Dispose()` clears before removing the collection from that registry. Errors can leave partial changes. `Restore()` re-adds remaining values through the same checked tracking path and can throw; it does not re-register a disposed collection. Directory operations affect multiple values without rollback, while `has()` normalizes its lookup. Do not use inherited `add()` or bypass overrides through `Set.prototype`: those operations change only local membership and bypass tracking.

```js
const { GenericPrecacheResource } = require("engines/precache");

const g_PanelMaterial = new GenericPrecacheResource("materials/sourcejs/status_panel.vmt", { Download: true });

try {
	g_PanelMaterial.Downloadables.Add("materials/sourcejs/status_panel.vtf");

	if (!g_PanelMaterial.Downloadables.has("materials/sourcejs/status_panel.vtf")) {
		throw new Error("The status panel texture is missing from the local download collection.");
	}
} finally {
	if (!g_PanelMaterial.Unload()) {
		throw new Error("GenericPrecacheResource.Unload failed.");
	}
}
```

Only enable downloads for files that the server actually ships and intends to distribute. Determine the selected model's complete dependency set for that game; companion vertex, material, texture, and other files vary by asset and branch. `ModelPrecacheResource` passes only its single `GetDownloadPath()` value to the optional collection, without discovering dependencies. Add reviewed companion files explicitly, or use a separately managed `Downloadables` collection for a reviewed asset-only directory. Directory registration is not dependency discovery and can include unintended files; keep private configuration and unrelated server content outside it.

## Practical plugin workflow

Create resources once at module load when the required engine services and assets are available. Release them in reverse order through the case-sensitive plugin lifecycle export `Unload`, implemented by `UnloadPlugin`. If initialization fails partway through, attempt cleanup of every resource already acquired; cleanup must also continue past individual resource failures:

```js
const { ModelPrecacheResource, GenericPrecacheResource, DecalPrecacheResource, SoundPrecacheResource } = require("engines/precache");

const g_vecResources = [];

function CleanupResources() {
	const vecErrors = [];
	while (g_vecResources.length > 0) {
		const Resource = g_vecResources.pop();
		try {
			if (!Resource.Unload()) {
				vecErrors.push(new Error(`Resource cleanup returned failure: ${Resource.ResourcePath}.`));
			}
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}
	}

	return vecErrors;
}

function UnloadPlugin() {
	const vecErrors = CleanupResources();
	if (vecErrors.length > 0) {
		throw new AggregateError(vecErrors, "Resource cleanup failed.");
	}

	return true;
}

try {
	g_vecResources.push(new ModelPrecacheResource("models/props_junk/wood_crate001a.mdl", { Preload: true }));
	g_vecResources.push(new GenericPrecacheResource("scripts/game_sounds_manifest.txt"));
	g_vecResources.push(new DecalPrecacheResource("decals/blood1"));
	g_vecResources.push(new SoundPrecacheResource("ui/buttonclick.wav", { Preload: true, UISound: true }));
} catch (ErrorValue) {
	const vecCleanupErrors = CleanupResources();
	if (vecCleanupErrors.length > 0) {
		throw new AggregateError([ErrorValue, ...vecCleanupErrors], "Resource initialization and cleanup failed.");
	}

	throw ErrorValue;
}

module.exports = {
	Unload: UnloadPlugin,
};
```

The constructor's map-name check chooses immediate or deferred precaching; it does not establish service readiness or guarantee native success. The example attempts cleanup of every successfully recorded resource once, in reverse order, and reports failures using `AggregateError`. It removes each resource from its local array before attempting cleanup, so failed cleanup is not retried by a later unload call. The constructor remains responsible for its own partial acquisition if it throws before returning. Neither cleanup path rolls back native precache effects.

## Custom resource classes

A custom class must provide a real engine table and a matching native operation available in the selected SDK. Do not derive a class merely to rename an existing class. An override called by the base constructor must not depend on fields initialized only after `super()` returns; validate such prerequisites before `super()` or use state the base constructor has already established.

The following example adds a manifest filename policy before invoking generic precaching. That policy is not proof of file existence, filesystem containment, successful precaching, or manifest parsing by the engine:

```js
const { PrecacheGeneric, PrecacheResourceBase } = require("engines/precache");

class ParticleManifestPrecacheResource extends PrecacheResourceBase {
	GetPrecacheTableName() {
		return "genericprecache";
	}

	Precache() {
		if ((typeof this.ResourcePath !== "string") || this.ResourcePath.includes("\0") || !this.ResourcePath.endsWith(".txt")) {
			throw new TypeError("A particle manifest must be a NUL-free .txt path string.");
		}

		const nPrecacheIndex = PrecacheGeneric(this.ResourcePath, this.Preload);
		if (nPrecacheIndex < 0) {
			throw new Error(`Unable to precache particle manifest: ${this.ResourcePath}.`);
		}

		return nPrecacheIndex;
	}
}

const g_ParticleManifest = new ParticleManifestPrecacheResource("particles/particles_manifest.txt", { Preload: true });

try {
	console.log(g_ParticleManifest.GetPrecacheTableName());
} finally {
	if (!g_ParticleManifest.Unload()) {
		throw new Error("ParticleManifestPrecacheResource.Unload failed.");
	}
}
```

The base constructor may call the overridden `Precache()` before the derived constructor body runs. An override must therefore use base fields such as `ResourcePath` and `Preload`, not fields initialized after `super()`.

## Safety and lifetime

- Precache only resources that exist in the selected game's search paths.
- Retain a reference while the resource is in use so its lifecycle owner can call `Unload()`. Dropping that reference is not cleanup: the registered callback captures the instance and can keep it alive.
- Attempt `Unload()` for every acquired resource, including resources created in partially completed plugin setup. Continue cleaning other resources after individual failures and report those failures; cleanup is not a native precache rollback.
- Do not cache `GetPrecacheIndex()` across map changes. Read it from the live table when needed.
- Treat native indices as map-local engine data, not persistent IDs.
- Do not use `Download: true` as file validation or proof of client delivery. It requests tracking of a computed path; registration can fail and does not install missing files.
- Avoid direct precache calls from arbitrary hot paths. Use a lifecycle phase permitted by the selected game and SDK; plugin initialization alone does not establish engine readiness or permission to precache.
- Successful native module installation registers all four functions. `PrecacheModel()`, `PrecacheGeneric()`, and `PrecacheDecal()` require `IVEngineServer`; `PrecacheSound()` requires compiled sound support and an available `IEngineSound`. Export presence does not establish availability.
- `PrecacheSound()` shares the callback installed by `engines/sound`, so its missing-interface and argument errors currently name `engines/sound.PrecacheSound()` even when the call came through `engines/precache`.

## Related modules

- [`engines`](engines.md) exposes the same four native precache operations as part of the root engine object.
- [`engines/server`](engines-server.md) exposes the live `GetGlobalVariables().MapName` used by managed construction.
- [`engines/sound`](engines-sound.md) controls precached sound playback and inspection.
- [`stringtables`](stringtables.md) documents live precache tables and `Downloadables` ownership.
- [`events/manager`](events-manager.md) owns the `server_spawn` callback lifecycle used internally.
