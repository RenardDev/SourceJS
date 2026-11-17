# `require("engines")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents and linked child-module pages to navigate directly to the relevant surface.

The [`engines` package](../../packages/sourcejs/engines.js) exports the native runtime module registered in [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). It exposes a small set of direct `IVEngineServer`, `IEngineSound`, and `IEngineTrace` operations, without aggregating `engines/server`, `engines/sound`, `engines/trace`, `engines/precache`, or `engines/gamerules` into nested properties.

The SDK-probed `IsLoopingSound` export is omitted when unavailable. Other root functions are registered without that capability gate; their presence does not guarantee that a required engine interface or compile-time feature is available. Check each operation's requirements and failure contract below. Map-dependent operations require an active level.

Related modules:

- [`engines/server`](engines-server.md) for the extended server API exposed by the selected SDK binding.
- [`engines/precache`](engines-precache.md) for managed resource classes.
- [`engines/sound`](engines-sound.md) for sound constants and the extended sound API.
- [`engines/trace`](engines-trace.md) for trace constants and specialized queries.
- [`engines/gamerules`](engines-gamerules.md) for live game-rules memory.

## Table of contents

- [Import](#import)
- [API](#api)
- [Server State](#server-state)
- [Server Commands](#server-commands)
- [Client CVars](#client-cvars)
- [Resource Precache](#resource-precache)
- [Sound State](#sound-state)
- [Emit And Stop Sound](#emit-and-stop-sound)
- [Point Contents](#point-contents)
- [Ray Traces](#ray-traces)
- [Entity Enumeration](#entity-enumeration)
- [Lifecycle Notes](#lifecycle-notes)

## Import

```js
const { ServerCommand, EmitSound, TraceRay } = require("engines");
const { LogInfo } = require("loggers");

LogInfo("%j", {
	Operation: "ImportEngines",
	ServerCommandExported: typeof ServerCommand === "function",
	EmitSoundExported: typeof EmitSound === "function",
	TraceRayExported: typeof TraceRay === "function",
});
```

The exported object is the native module object for the current plugin context. Import constants from the owning child module instead of expecting them on this root.

`PrecacheModel`, `PrecacheGeneric`, and `PrecacheDecal` share the `engines/precache` native callbacks and operation-specific C++ exception diagnostics. Preparation, interface lookup, dispatch, and result construction are covered; a completed precache call is not rolled back, and ordinary native integer results are not converted into exceptions.

## API

| Function | Result | Purpose |
| --- | --- | --- |
| `ServerCommand(strCommand)` | `boolean` | Append a newline to a non-empty string, submit it to the engine command buffer, then call `ServerExecute`. Returns `true` after dispatch, not command-level success; invalid input or an unavailable `IVEngineServer` throws. This is command text, not a validated single-command representation. |
| `QueueServerCommand(strCommand)` | `boolean` | Append a semicolon to a non-empty string and append it to the engine command buffer without calling `ServerExecute`. Returns `true` after submission; invalid input or an unavailable interface throws. |
| `InsertServerCommand(strCommand)` | `boolean` | Append a semicolon to a non-empty string and insert it at the front of the engine command buffer without calling `ServerExecute`. Returns `true` after submission; invalid input or an unavailable interface throws. |
| `GameDescription()` | `string` | Read `IServerGameDLL::GetGameDescription()` as UTF-8; a null native string becomes an empty string. An unavailable `IServerGameDLL` throws. |
| `IsDedicatedServer()` | `boolean` | Return `IVEngineServer::IsDedicatedServer()`. An unavailable `IVEngineServer` throws; it is not reported as `false`. |
| `EntityCount()` | `number` | Return `IVEngineServer::GetEntityCount()` without filtering to players. An unavailable `IVEngineServer` throws; it is not reported as zero. |
| `GameDirectory()` | `string` | Read `IVEngineServer::GetGameDir()` through a 260-byte buffer and convert it to UTF-8. An unavailable `IVEngineServer` throws. The binding does not detect truncation. |
| `GetClientCVarValue(PlayerOrIndex, strCVarName)` | `string` | Read a client CVar using an integral `Number` within the native `int` range or an object's matching `Index`. Requires a non-empty string name and `IVEngineServer`; missing arguments, invalid names, or an unavailable interface throw. Unresolved/nonpositive indices and null native strings produce an empty string, which is not a distinct success indicator. Positive indices are passed to the engine without a client-range or connection check; supply a valid connected client. |
| `PrecacheModel(strModelPath, bPreload = false)` | `number` | Pass a non-empty string path to `IVEngineServer::PrecacheModel` and return its integer result unchanged. Omitted/`undefined` preload defaults to `false`; any supplied non-boolean, including `null`, throws. Missing/non-string/empty path arguments or an unavailable interface throw; the binding does not check file existence. |
| `PrecacheGeneric(strFilePath, bPreload = false)` | `number` | Call `IVEngineServer::PrecacheGeneric` and return its integer result unchanged. Requires a non-empty string path; preload follows `PrecacheModel`'s strict boolean/default rules. Invalid arguments or an unavailable interface throw; the binding does not check file existence. |
| `PrecacheDecal(strDecalName, bPreload = false)` | `number` | Call `IVEngineServer::PrecacheDecal` and return its integer result unchanged. Requires a non-empty string name; preload follows `PrecacheModel`'s strict boolean/default rules. Invalid arguments or an unavailable interface throw; the binding does not validate decal availability. |
| `PrecacheSound(strSample, bPreload = false, bUISound = false)` | `boolean` | Return `IEngineSound::PrecacheSound`'s result. Requires a string with a non-empty UTF-8 C-string prefix; both optional flags accept only booleans or omitted/`undefined` (default `false`). Old-console SDK bindings validate but do not pass `bUISound` to the engine. Invalid arguments, missing compile-time sound support, or an unavailable interface throw. |
| `IsSoundPrecached(strSample)` | `boolean` / `undefined` | Return `IEngineSound::IsSoundPrecached`'s result for a non-empty string sample. With sound support and an available interface, no argument returns `undefined`; explicitly supplied `undefined`, non-string, or empty values throw. Missing compile-time sound support or an unavailable interface throws, not `false`. |
| `PrefetchSound(strSample)` | `boolean` / `undefined` | Submit a non-empty string sample to `IEngineSound::PrefetchSound`; `true` means dispatch, not completed loading. No argument returns `undefined` when the interface is available. Explicitly supplied invalid samples, missing sound support, or an unavailable interface throw. |
| `IsLoopingSound(strSample)` | `boolean` / `undefined` | Return the sample's native looping state; this export is omitted when the SDK lacks the operation. With an available interface, no argument returns `undefined`; explicitly supplied non-string/empty samples or an unavailable interface throw. |
| `SoundDuration(strSample)` | `number` / `undefined` | Return the native duration in seconds without validating its range. With sound support and an available interface, no argument returns `undefined`; explicitly supplied non-string/empty samples, missing sound support, or an unavailable interface throw. |
| `EmitSound(Options)` | `boolean` | Requires exactly one non-array options object, including a non-empty `Sample`. Dispatch sound with recipients, source and playback options; `true` confirms dispatch, not audible playback. Invalid argument shape/sample, unavailable `IEngineSound`, or an unsupported SDK emission signature throws. |
| `StopSound(Options)` | `boolean` | Requires exactly one non-array options object with a non-empty `Sample`; `Entity` and `Channel` select the source and channel. Returns `true` after `IEngineSound::StopSound`, not confirmation that a playing sound was found. Invalid argument shape/sample, missing sound support, or an unavailable interface throws. SDKs requiring a sound-entry hash receive zero. |
| `GetPointContents(Position, unContentsMask = MASK_ALL)` | `PointContentsResult` | Query point contents and return `{ Contents, Mask, Entity, Entities }`; `Entities` contains at most one non-negative index, not every entity at the point. Omitted/nullish mask defaults to `MASK_ALL`; other masks must be unsigned 32-bit integers. SDKs with only the maskless overload reject non-`MASK_ALL` masks. Invalid inputs or missing trace support/interface throw. |
| `TraceRay(Ray, unContentsMask = MASK_ALL, FilterValue = null, TraceTarget = null)` | `TraceResult` | Trace a line or swept box with the supplied filter. Omitted/nullish mask defaults to `MASK_ALL`; other masks must be unsigned 32-bit integers. A supplied non-nullish target must be a non-array object and is populated and returned; otherwise a new result is created. Invalid ray/mask/target or unavailable trace support/interface throws. |
| `ClipRayToEntity(Ray, unContentsMask, EntityValue, TraceTarget = null)` | `TraceResult` | Requires at least three arguments and clips only against the resolved entity, without a trace filter. Pass an integer entity index or an object with `Index`; it must resolve to a non-free edict with a server entity. A nullish mask uses `MASK_ALL`; other masks require unsigned 32-bit integers. Target rules match `TraceRay`. Invalid inputs or unavailable trace support/interface throw. |
| `EnumerateEntities(Ray, bIncludeTriggers = false, EnumeratorValue = null)` | `number[]` | Collect visited non-negative entity indexes in engine order without deduplication. Omitted/`undefined` trigger flag defaults to `false`; supplied non-booleans, including `null`, throw. An optional function or object's `EnumEntity` callback must return a boolean: `false` stops after recording that entity's valid index. Callback exceptions propagate; invalid inputs or unavailable trace support/interface throw. |
| `IsPointOutsideWorld(Position)` | `boolean` | Return `IEngineTrace::PointOutsideWorld` for the required position vector. Missing/invalid positions or unavailable trace support/interface throw rather than returning `false`. |

`Ray` uses `{ Start, End }` for a line trace or `{ Start, End, Minimums, Maximums }` for a swept box. Both endpoints must contain a vector; parsed bounds must be present together. Vectors read array indexes `0`–`2` or object properties `X`, `Y`, `Z`; a nullish primary property falls back to `Pitch`, `Yaw`, or `Roll`, respectively. At least one non-nullish component is required; absent/nullish components default to zero. Present components undergo JavaScript numeric conversion and must be finite and within the native float range before conversion to float. Getters and conversion hooks can execute JavaScript. Supply plain finite numeric data and ordered bounds. The binding validates the derived direction, hull extent, bounds sum, and centered start against the finite float range, but does not check bound ordering or world limits.

Checked construction of trace-result records and enumeration arrays can return `undefined` without a pending exception. Validate results before reading fields or iterating; a missing result is not a normal no-hit result or an empty enumeration. Original exceptions still propagate, and completed engine effects or partial target writes are not rolled back.

## Server State

This example builds a runtime diagnostic without relying on copied module metadata:

```js
const { GameDescription, IsDedicatedServer, EntityCount, GameDirectory } = require("engines");
const { LogInfo } = require("loggers");

LogInfo("%j", {
	Operation: "QueryServerState",
	Description: GameDescription(),
	Dedicated: IsDedicatedServer(),
	EntityCount: EntityCount(),
	GameDirectory: GameDirectory(),
});
```

`EntityCount()` changes as entities are created and removed. Do not cache it as a map-wide limit; use `GetMaximumEntities()` from `engines/server` for that purpose.

## Server Commands

The three command operations differ in execution order:

```js
const { ServerCommand, QueueServerCommand, InsertServerCommand } = require("engines");

const g_bCommandDispatched = ServerCommand("echo [SourceJS] command executed immediately");
const g_bCommandQueued = QueueServerCommand("echo [SourceJS] queued after existing buffered commands");
const g_bCommandInserted = InsertServerCommand("echo [SourceJS] inserted before existing buffered commands");
if (!g_bCommandDispatched || !g_bCommandQueued || !g_bCommandInserted) {
	throw new Error("One or more SourceJS example commands were not accepted by the engine.");
}
```

Commands must be non-empty strings. Invalid input or an unavailable engine interface throws; a successful handoff returns `true`. Prefer direct module APIs for structured operations; command strings are appropriate when the engine exposes no equivalent function.

The engine consumes a UTF-8 C-string prefix: an embedded NUL terminates its input before the appended delimiter, while semicolons and newlines retain engine syntax. Use NUL-free trusted command text; do not interpolate untrusted input.

## Client CVars

`GetClientCVarValue(PlayerOrIndex, strCVarName)` accepts an integral `Number` within the selected SDK's native `int` range, or an object whose `Index` meets that contract. Primitive strings, `BigInt`, fractional numbers, and out-of-range numbers do not resolve to indexes. Supply a valid connected client: the native binding does not validate positive indices against the client range or connection state. It returns the engine's CVar string without parsing it as a number or boolean.

```js
const { GetClientCVarValue } = require("engines");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_FirstPlayer = Player(1);
if (!g_FirstPlayer.IsConnected()) {
	throw new Error("Player slot 1 is not connected.");
}

const g_strFirstPlayerLanguage = GetClientCVarValue(g_FirstPlayer, "cl_language");
LogInfo("%j", { Operation: "QueryClientCVar", PlayerIndex: g_FirstPlayer.Index, CVarName: "cl_language", Value: g_strFirstPlayerLanguage });
```

`Player(1)` can throw when the slot cannot be resolved: the package rejects a null native player result. For a returned player, check `IsConnected()` before querying the CVar. An empty CVar string is ambiguous: the binding also returns it for unresolved/nonpositive indices or a null native result. It is not proof that a client or CVar exists. Use NUL-free names because the engine consumes a UTF-8 C-string prefix. An `Index` getter runs after the CVar name's string-type check but before its non-empty UTF-8-string check; a getter exception aborts lookup unchanged.

## Resource Precache

Precache resources during map initialization, before an entity or message first references them:

```js
const { PrecacheModel, PrecacheGeneric, PrecacheDecal, PrecacheSound } = require("engines");
const { LogInfo } = require("loggers");

const g_ResourcePrecacheResults = {
	SoundReady: PrecacheSound("ambient/alarms/klaxon1.wav", true, false),
	DecalIndex: PrecacheDecal("decals/blood1", true),
	GenericIndex: PrecacheGeneric("scripts/sourcejs/example.txt", true),
	ModelIndex: PrecacheModel("models/props_junk/wood_crate001a.mdl", true),
};
if ((g_ResourcePrecacheResults.DecalIndex < 0) || (g_ResourcePrecacheResults.GenericIndex < 0) || (g_ResourcePrecacheResults.ModelIndex <= 0) || !g_ResourcePrecacheResults.SoundReady) {
	throw new Error("One or more SourceJS example resources could not be precached.");
}

LogInfo("%j", { Operation: "PrecacheResources", Results: g_ResourcePrecacheResults });
```

Model indices are one-based: zero indicates failure. Generic and decal indices are zero-based. Paths and names are read as UTF-8 C-string prefixes: an embedded NUL truncates them, and an empty prefix is rejected. Use NUL-free paths and names. Use resources that exist in the selected game and install the example's custom text file before running it. Precaching does not automatically add custom files to client downloads; use [`stringtables/downloads`](stringtables-downloads.md) for that operation.

## Sound State

```js
const {
	PrecacheSound,
	IsSoundPrecached,
	PrefetchSound,
	IsLoopingSound,
	SoundDuration,
} = require("engines");
const { LogInfo } = require("loggers");

const g_strAlarmSoundSample = "ambient/alarms/klaxon1.wav";

if (typeof IsLoopingSound !== "function") {
	throw new Error("This SDK does not expose IEngineSound::IsLoopingSound.");
}

if (!IsSoundPrecached(g_strAlarmSoundSample) && !PrecacheSound(g_strAlarmSoundSample, true, false)) {
	throw new Error(`Unable to precache sound: ${g_strAlarmSoundSample}.`);
}

if (!PrefetchSound(g_strAlarmSoundSample)) {
	throw new Error(`Unable to prefetch sound: ${g_strAlarmSoundSample}.`);
}

LogInfo("%j", {
	Operation: "QuerySoundState",
	Looping: IsLoopingSound(g_strAlarmSoundSample),
	Precached: IsSoundPrecached(g_strAlarmSoundSample),
	DurationSeconds: SoundDuration(g_strAlarmSoundSample),
});
```

`PrefetchSound()` starts loading but does not replace precaching. `IsLoopingSound()` exists only where the selected SDK exposes the query.

## Emit And Stop Sound

The options form keeps source, recipients, playback parameters and later cleanup together:

```js
const { EmitSound, StopSound, IsSoundPrecached, PrecacheSound } = require("engines");
const { Channel, Attenuation, SoundFlags, Pitch } = require("engines/sound");
const { Player } = require("players/entity");

const g_FirstPlayer = Player(1);
const g_strButtonSoundSample = "buttons/button14.wav";

if (!g_FirstPlayer.IsConnected()) {
	throw new Error("Player slot 1 is not connected.");
}

if (!IsSoundPrecached(g_strButtonSoundSample) && !PrecacheSound(g_strButtonSoundSample, true, false)) {
	throw new Error(`Unable to precache sound: ${g_strButtonSoundSample}.`);
}

const g_ButtonSoundOptions = {
	Recipients: [g_FirstPlayer.Index],
	Sample: g_strButtonSoundSample,
	Entity: g_FirstPlayer,
	Channel: Channel.ITEM,
	Volume: 0.8,
	Attenuation: Attenuation.NORMAL,
	Flags: SoundFlags.NO_FLAGS,
	Pitch: Pitch.NORMAL,
	UpdatePositions: true,
	Reliable: true,
};

const g_nSoundPlayerUserID = g_FirstPlayer.UserID;
if (g_nSoundPlayerUserID < 0) {
	throw new Error("Player slot 1 has no valid user ID.");
}

if (!EmitSound(g_ButtonSoundOptions)) {
	throw new Error(`Unable to emit sound: ${g_strButtonSoundSample}.`);
}

function UnloadPlugin() {
	if ((g_FirstPlayer.UserID !== g_nSoundPlayerUserID) || !g_FirstPlayer.IsConnected()) {
		return;
	}

	if (!StopSound({
		Sample: g_ButtonSoundOptions.Sample,
		Entity: g_ButtonSoundOptions.Entity,
		Channel: g_ButtonSoundOptions.Channel,
	})) {
		throw new Error(`Unable to stop sound: ${g_ButtonSoundOptions.Sample}.`);
	}
}

module.exports = { Unload: UnloadPlugin };
```

Run this example during an active level and unload it before changing maps. The user-ID/connection check avoids stopping a replacement client's sound in the same slot, but is not a persistent identity guarantee across map changes or server restarts. A plugin that survives those transitions needs level-lifecycle cleanup and fresh player/resource state. The runtime invokes the case-sensitive SourceJS-owned `Unload` export, without a lowercase alias; errors from stopping the sound remain visible.

`EmitSound()` also accepts `Origin`, `Direction`, `Origins`, `SoundTime`, and `SpeakerEntity` in its canonical options object.

## Point Contents

`GetPointContents()` returns signed integer `Contents`, the effective unsigned `Mask`, `Entity` as `null` or a copied `{ Index, Handle, Exists }` descriptor, and `Entities` as an array containing zero or one non-negative entity index.

```js
const { GetPointContents, IsPointOutsideWorld } = require("engines");
const { ContentMasks } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_PointContentsPosition = { X: 0, Y: 0, Z: 64 };
const g_PointContentsResult = GetPointContents(g_PointContentsPosition, ContentMasks.All);
if (!g_PointContentsResult) {
	throw new Error("GetPointContents() did not return a result.");
}

LogInfo("%j", {
	Operation: "QueryPointContents",
	Contents: g_PointContentsResult.Contents,
	PrimaryEntityIndex: g_PointContentsResult.Entity?.Index ?? -1,
	EntityIndexes: g_PointContentsResult.Entities,
	OutsideWorld: IsPointOutsideWorld(g_PointContentsPosition),
});
```

Use bitwise tests against `ContentFlags` or `CONTENTS_*` values from `engines/trace` to interpret `Contents`. Masks require V8's strict unsigned-32-bit `Number` check; strings, boxed numbers, and `BigInt` masks are not coerced.

## Ray Traces

A `TraceResult` contains `StartPosition`, `EndPosition`, `Plane`, `Fraction`, `Contents`, `DisplacementFlags`, `AllSolid`, `StartSolid`, `Hit`, `HitWorld`, `HitNonWorldEntity`, `EntityIndex`, `FractionLeftSolid`, `Surface`, `HitGroup`, `PhysicsBone`, `Hitbox`, and `Entity`. Trace measurements and nested geometry records are copied, not live views into native trace storage. `StartPosition`, `EndPosition`, and `Plane.Normal` are plain `{ X, Y, Z }` records, not `mathlib.Vector` instances. However, `Entity` is a native entity wrapper or `null`, not an immutable entity snapshot; retaining the result does not preserve the entity's lifetime or prevent index reuse.

```js
const { TraceRay, ClipRayToEntity } = require("engines");
const { ContentMasks } = require("engines/trace");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_RayInput = {
	Start: { X: 0, Y: 0, Z: 64 },
	End: { X: 1024, Y: 0, Z: 64 },
};
const g_ClipEntity = Entity(1);
if (!g_ClipEntity) {
	throw new Error("Entity index 1 is unavailable.");
}

const g_SceneTraceResult = TraceRay(g_RayInput, ContentMasks.Shot);
if (!g_SceneTraceResult) {
	throw new Error("TraceRay() did not return a trace result.");
}

const g_EntityTraceResult = ClipRayToEntity(g_RayInput, ContentMasks.Shot, g_ClipEntity);
if (!g_EntityTraceResult) {
	throw new Error("ClipRayToEntity() did not return a trace result.");
}

LogInfo("%j", {
	Operation: "TraceSceneAndEntity",
	EntityWasHit: g_EntityTraceResult.Hit,
	EntityTraceFraction: g_EntityTraceResult.Fraction,
	SceneTraceFraction: g_SceneTraceResult.Fraction,
	SceneSurfaceName: g_SceneTraceResult.Surface.Name,
	SceneEntityIndex: g_SceneTraceResult.EntityIndex,
});
```

The first call uses the default filter, so its `Scene*` diagnostics include eligible entities, not just world geometry. Pass a plain `TraceTarget` object as the fourth argument to fill and return an existing object. Writes are sequential and can leave the supplied target partially updated if result construction fails. A trace filter may be a callback or an object implementing the filter methods documented by [`engines/trace`](engines-trace.md).

## Entity Enumeration

The result contains each non-negative index before the optional callback runs, including the index whose callback returns `false`. Pass a function or an object with the exact `EnumEntity(EntityInformation)` method; it receives a copied `{ Index, Handle, Exists }` descriptor for each native handle and must return a boolean. The array preserves engine order and duplicates. If a later callback or result-construction step fails, already executed callback side effects are not rolled back.

```js
const { EnumerateEntities } = require("engines");
const { LogInfo } = require("loggers");

const g_unMaximumObservedEntityCount = 32;

const g_EnumerationRay = {
	Start: { X: -256, Y: -256, Z: 0 },
	End: { X: 256, Y: 256, Z: 128 },
	Minimums: { X: -16, Y: -16, Z: -16 },
	Maximums: { X: 16, Y: 16, Z: 16 },
};

const g_vecObservedEntityIndexes = [];
const g_vecEnumeratedEntityIndexes = EnumerateEntities(g_EnumerationRay, false, {
	EnumEntity(EntityInformation) {
		if (!EntityInformation.Exists) {
			return true;
		}

		g_vecObservedEntityIndexes.push(EntityInformation.Index);

		return g_vecObservedEntityIndexes.length < g_unMaximumObservedEntityCount;
	},
});
if (!Array.isArray(g_vecEnumeratedEntityIndexes)) {
	throw new Error("EnumerateEntities() did not return an index array.");
}

LogInfo("%j", {
	Operation: "EnumerateTraceEntities",
	EnumeratedEntityIndexes: g_vecEnumeratedEntityIndexes,
	ObservedEntityIndexes: g_vecObservedEntityIndexes,
});
```

Set `bIncludeTriggers` to `true` only when trigger volumes should participate.

## Lifecycle Notes

- Run these engine operations on the server thread. Trace filters and enumerators run synchronously inside the native call; keep callbacks short. The dedicated Redis/HTTP/SQL/socket request workers do not execute these engine operations.
- Server commands and sound emission mutate engine state immediately or through the command buffer; clean up long-running sounds during plugin unload.
- Precache before first use and repeat map-owned registration after the next level starts.
- Point-query and enumeration descriptors copy `Exists`, `Index`, and `Handle`, which can become stale. A trace result's `Entity` is instead a native entity wrapper. Neither representation owns the engine entity or prevents slot reuse; resolve and validate current identity before later operations, and discard map-dependent state at level transitions.
- Import constants and specialized operations from their direct child modules. The root intentionally contains no namespace snapshots or gamerules exports.
