# `require("engines/server")`

> Warning: this is a dense native API reference. Use the table of contents and the grouped export tables instead of reading it linearly when investigating one operation.

`engines/server` exposes low-level Source server operations selected and registered by the native bindings. Its JavaScript package forwards the native module; it does not reconstruct HL2SDK behavior or expose every SDK method automatically.

Root exports installed through selected-SDK capability checks are omitted when the compile-time check is false. For a module binding named `g_ServerAPI`, test export presence with `typeof g_ServerAPI.FunctionName === "function"`; this does not verify runtime interface availability, arguments, or lifecycle readiness. Always-registered callbacks and methods on an available native wrapper may instead throw an unsupported-operation error, as noted in the relevant section. Do not assume that an operation present on L4D2 is present on every other Source 1 branch.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import and safety](#import-and-safety)
- [Core state and native objects](#core-state-and-native-objects)
- [Commands and console output](#commands-and-console-output)
- [Visibility, areas, and level state](#visibility-areas-and-level-state)
- [Clients and identity](#clients-and-identity)
- [Entities, transmission, and spatial partitions](#entities-transmission-and-spatial-partitions)
- [Resources, sound, and presentation](#resources-sound-and-presentation)
- [Platform and branch capabilities](#platform-and-branch-capabilities)
- [Returned object contracts](#returned-object-contracts)
- [Practical workflows](#practical-workflows)
- [Lifecycle and ownership](#lifecycle-and-ownership)

## Location and purpose

[`packages/sourcejs/engines/server.js`](../../packages/sourcejs/engines/server.js) is a thin facade over the native `engines/server` module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). Use this module when a plugin needs direct server-engine, client, entity, or branch-specific operations and can own their validation and lifecycle explicitly.

## Import and safety

```js
const g_ServerAPI = require("engines/server");
```

Use `unAddress` for nonnegative BigInt native-address variables. The shared address parser accepts only BigInt values that fit native `uintptr_t`; individual operations may also reject zero. Returned address wrappers expose `Address` as BigInt and `Kind` as a string, preserving the native address exactly. Argument contracts are operation-specific: some require a raw BigInt, while the server-wrapper parser also accepts an object and reads its `Address` property (which can invoke a getter). Wrapper methods may require their original receiver. Neither BigInt validation nor wrapper metadata proves native type, accessible extent, ownership, or lifetime; do not fabricate or reuse stale addresses.

Use this module only from the initialized JavaScript/server-game-thread context. Its native calls and wrapper accessors run synchronously; they do not enqueue IO-worker requests. Do not move engine operations or borrowed wrappers onto request workers.

Several operations mutate engine-global state, transfer native ownership, disconnect clients, create edicts, or change levels. Keep those calls behind explicit administrator commands and validate the current map/client/entity before invoking them.

`IsDedicatedServer`, `GetEntityCount`, `GetMaximumClients`, `GetMaximumEntities`, `GetServerCount`, `GetServerTime`, `GetServerTick`, `GetServerTickInterval`, `GetMapName`, `GetGameDirectory`, and `GetClientCVarValue` translate native C++ preparation, lookup, dispatch, and result-construction failures into operation-specific JavaScript errors. `GetClientCVarValue` preserves an original entity `Index` getter error, including during native C++ unwinding, and stops before converting the name or querying the engine; successful argument validation order and result meanings are unchanged.

`GetServerVersion`, `EndMultiplayerGame`, `CreateFakeClientWithOptions`, `GetLaunchOptions`, and the `IsUserIDInUse` / `GetUserLoadingProgress` pair also translate native C++ preparation, dispatch, and result-construction failures into contextual JavaScript errors. This does not roll back a completed engine operation: game-ending requests and client creation may already have taken effect before result construction fails. A launch-options handle remains non-owning. User-ID conversion preserves an original JavaScript conversion error and stops before native dispatch.

`IsEngineLogEnabled`, `GetTimescale` / `SetTimescale`, branch boolean queries, split-screen queries, and `ForceFlushEntity` also translate native C++ failures into contextual JavaScript errors. Timescale and split-screen input conversions preserve an original JavaScript conversion error and stop before native dispatch. Split-screen indexes and slots use the same V8 `ToInt32` conversion as user IDs; returned edict wrappers borrow engine storage. With no earlier lookup or conversion error, missing setter/split-screen arguments return `undefined` without native dispatch; the two-argument split-screen lookup converts a supplied first index before checking for the slot. Neither the exception boundary nor a `true` result rolls back or independently confirms native effects.

`GetSinglePlayerSharedMemorySpace`, `SetPaused`, `ValidateHostSession` / `RefreshScreenIfNecessary`, `GetAchievementManager` / `SetAchievementManager`, `SetServerHibernation`, and `HasPaintMap` also translate native C++ preparation, dispatch, and result-construction failures into contextual JavaScript errors. The exception boundary does not undo a pause, host-session request, refresh, manager replacement, or hibernation request that already reached the engine. Shared-memory index conversion preserves an original JavaScript conversion error before native dispatch; the shared-memory and achievement-manager wrappers remain borrowed, not ownership or lifetime guarantees.

`RemoveAllPaint`, `PaintAllSurfaces`, `GetClientXUID`, `IsApplicationActive`, `SetNoClipEnabled`, `GetPaintMapDataRLE` / `LoadPaintMapDataRLE`, and `SendPaintMapDataToClient` also translate native C++ preparation, dispatch, and result-construction failures into contextual JavaScript errors. Client `Index` getter failures are preserved before edict lookup; paint-value and RLE-element conversions preserve original JavaScript errors before native mutation. RLE input length must fit both the SDK's signed `int` count and the native buffer byte-size representation. Storage is reserved and checked before reading entries, and a fully parsed buffer is transferred without a second allocation. These checks do not validate RLE structure or undo a native paint/no-clip operation that already ran.

`GetChoreographySoundLatency`, `GetClientCrossPlayPlatform`, `EnsureEntityInstanceBaseline`, `ReserveServerForQueuedGame`, `CreateEdict`, `RemoveEdict`, `EmitAmbientSound`, and `ExecuteClientCommand` also translate C++ preparation, lookup, dispatch, and result-construction failures into contextual JavaScript errors. Original JavaScript getter/conversion errors stop processing before the next native call. This does not roll back a reservation, edict change, baseline request, sound submission, or command that already reached the engine, or establish the lifetime of a borrowed edict.

`PrintToClientConsole(ClientOrIndex, strMessage)`, `FadeClientVolume`, the sentence operations, `SetLightStyle`, `PlaceStaticDecal`, `SetClientViewEntity`, `SetClientCrosshairAngle`, `SetNetworkStringTablesLocked`, and `CreateFakeClient` also translate C++ preparation, lookup, dispatch, and result-construction failures into contextual JavaScript errors. The shared no-argument callback does the same for `IsInEditMode`, `IsPaused`, `ClearSaveDirectoryAfterClientLoad`, `AllowImmediateEdictReuse`, `GetApplicationID`, `IsLowViolence`, `GetClusterCount`, and `GetMapEntitiesString`, subject to their documented SDK availability. An exception does not undo a completed engine operation. Ordinary native `false`, negative sentence indices, empty strings, and null-result meanings remain operation-specific, not exception indicators. The root console callback preserves an original `Index` getter error and stops before player lookup, message conversion, or printing.

## Core state and native objects

Concrete-use cells illustrate local statements inside a plugin-owned operation, with `g_ServerAPI` already imported. A snippet does not establish the lifecycle, current native object, or other prerequisites stated in its cell.

`ForceExactFile`, `ForceSimpleMaterial`, `PrintEngineLog`, `ForceModelBounds`, `SetFakeClientCVarValue`, `StartClientCVarQuery`, `GetServerConstants`, `IsClientFullyAuthenticated`, and `SetDedicatedServerBenchmarkMode` translate C++ preparation, lookup, dispatch, and result-construction failures into contextual JavaScript errors. This does not undo a consistency request, log write, CVar change/query, or benchmark-mode request already submitted to the engine. SDK-specific omission and unsupported-operation behavior remain unchanged; native authentication `false` and query-cookie sentinels retain their documented meanings. Constants installation preserves an existing JavaScript property-set error or execution termination instead of replacing it with a generic installation error; it does not undo property writes already completed.

| Export | Contract | Concrete use |
| --- | --- | --- |
| `GetServerConstants()` | Returns `MapLoadType` and, when compiled with query-status support, `QueryCVarStatus`. The outer object and both nested records are ordinary snapshot objects with own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable prototype fields. Selected-SDK integer values and established names remain unchanged: `NEW_GAME`, `LOAD_GAME`, `TRANSITION`, `BACKGROUND`; optional status fields are `Success`, `NotFound`, `Invalid`, and `Protected`. Does not return a partial constants object; preserves an original JavaScript installation exception, including during native unwinding. | `g_ServerAPI.GetServerConstants().QueryCVarStatus?.Success` |
| `GetGlobalVariables()` | Uses the same accessor-view factory as `globals.GetGlobalVariables()`; this is not a snapshot or an independently owned copy of engine state. | `const flCurrentTime = g_ServerAPI.GetGlobalVariables().CurrentTime;` |
| `GetMaximumClients()` | Reads `CGlobalVars::maxClients`. | `const nMaximumClients = g_ServerAPI.GetMaximumClients();` |
| `GetMaximumHumanClients()` | Reads the game-specific human slot limit from the selected SDK when available. Falls back to `GetMaximumClients()` if the game does not expose a valid override. Read it again after a mode or map change. | `const nMaximumHumanClients = g_ServerAPI.GetMaximumHumanClients();` |
| `GetMaximumEntities()` | Reads `CGlobalVars::maxEntities`. | `const nMaximumEntities = g_ServerAPI.GetMaximumEntities();` |
| `GetServerCount()` | Reads `CGlobalVars::serverCount`; omitted when the SDK has no field. | `const nServerCount = g_ServerAPI.GetServerCount();` |
| `GetServerTime()` | Reads `CGlobalVars::curtime`, not wall-clock time. | `const flCurrentTime = g_ServerAPI.GetServerTime();` |
| `GetServerTick()` | Reads `CGlobalVars::tickcount`. | `const nCurrentTick = g_ServerAPI.GetServerTick();` |
| `GetServerTickInterval()` | Reads `CGlobalVars::interval_per_tick`, in seconds per tick; validate a positive finite interval before deriving a rate. | `const flTickInterval = g_ServerAPI.GetServerTickInterval();` |
| `GetMapName()` | Reads `CGlobalVars::mapname`; a name alone does not establish map readiness. | `const strCurrentMapName = g_ServerAPI.GetMapName();` |
| `GetGameDirectory()` | Reads the active game directory through `GetGameDir` using a 260-byte buffer, then explicitly terminates its final byte before string conversion. At most 259 native bytes are passed to UTF-8 decoding; truncation is not reported separately. | `const strGameRoot = g_ServerAPI.GetGameDirectory();` |
| `GetGameDescription()` | Copies `IServerGameDLL::GetGameDescription()` into a JavaScript string; a native null string becomes `""`. Preserves a pending JavaScript exception and reports result-string construction failure or a C++ exception with context. | `const strGameDescription = g_ServerAPI.GetGameDescription();` |
| `IsDedicatedServer()` | Reports `IVEngineServer::IsDedicatedServer()`. | `const bDedicated = g_ServerAPI.IsDedicatedServer();` |
| `GetEntityCount()` | Returns `IVEngineServer::GetEntityCount()`; subtracting it from a limit is not a guarantee that an allocation will succeed. | `const nEntityCount = g_ServerAPI.GetEntityCount();` |
| `GetClusterCount()` | Returns the BSP cluster count; the export remains present but throws if the selected SDK interface lacks the operation. | `const nClusterCount = g_ServerAPI.GetClusterCount();` |
| `GetMapEntitiesString()` | Returns a JavaScript string copied from the map entity text, or `null` when the engine returns no text. | `const strEntityLump = g_ServerAPI.GetMapEntitiesString();` |
| `GetApplicationID()` | Returns the Steam application ID; omitted when the selected SDK lacks `GetAppID`. | `const unApplicationID = g_ServerAPI.GetApplicationID();` |
| `GetServerVersion()` | Returns the engine server version; omitted when the selected SDK lacks `GetServerVersion`. | `const nServerVersion = g_ServerAPI.GetServerVersion();` |
| `GetGameServerSteamID()` | Returns a copied server `SteamID` fields object, or `null` when the engine returns no ID; omitted when the selected SDK lacks `GetGameServerSteamID`. A build without `steam/steamclientpublic.h` support throws if this callback is exposed. | `const ServerSteamID = g_ServerAPI.GetGameServerSteamID();` |
| `GetLaunchOptions()` | Returns a non-owning native `KeyValues` handle, or `null` when the engine returns no launch options; omitted when the selected SDK lacks `GetLaunchOptions`. Handle-registration exhaustion returns `undefined`; an unavailable plugin context throws. The handle does not extend the engine-owned hierarchy's lifetime. | `const LaunchOptions = g_ServerAPI.GetLaunchOptions();` |
| `GetServer()` | Returns a borrowed `IServer` wrapper; omitted without `IServer` support. Wrapping does not transfer ownership or extend native lifetime. | `const Server = g_ServerAPI.GetServer();` |
| `GetServerFromAddress(unAddress)` | Wraps a nonzero BigInt `IServer` address within native `uintptr_t` range, or an object whose `Address` property contains one; omitted without `IServer` support. An exception from the `Address` getter propagates unchanged without constructing the server wrapper. BigInt validation does not establish a live `IServer` object. | Prefer `g_ServerAPI.GetServer()`. If `Server` is already a known live `IServer` view, rewrap its address on a branch that supports it: `const ServerView = g_ServerAPI.GetServerFromAddress(Server.Address);` |

Each successful `GetGlobalVariables()` call creates a different JavaScript object. Native property accessors resolve the current global storage when invoked rather than capturing a snapshot; holding the view does not guarantee that storage remains available. The following property contracts match [`globals.GetGlobalVariables()`](globals.md); SDK-dependent availability is noted per property:

| Property | Type | Access |
| --- | --- | --- |
| `Address` | bigint | Read-only native accessor for the current `CGlobalVars` address; exact numeric representation is not an ownership or lifetime token. |
| `SDKBranch` | string | Ordinary property initialized to the compiled SDK branch, not a live native accessor; changing this JavaScript value cannot change the compiled SDK. |
| `RealTime` | number | Live `realtime` access; writes require a finite primitive `Number` within native float range, with float rounding. |
| `FrameCount` | number (integer) | Live `framecount` access; writes require an exact native-range integer, not a string or `BigInt`. |
| `AbsoluteFrameTime` | number | Live `absoluteframetime` access; writes use the same finite-float validation as `RealTime`. |
| `CurrentTime` | number | Live `curtime` access; writes use finite-float validation, not engine timing-invariant validation. |
| `FrameTime` | number | Live `frametime` access; writes use finite-float validation without rejecting negative values. |
| `MaximumClients` | number (integer) | Live `maxClients` access; writes check integer representation, not valid client capacity. Do not treat this assignment as a supported server-resizing operation. |
| `TickCount` | number (integer) | Live `tickcount` access; writes require an exact native-range integer but do not enforce monotonic progression or nonnegativity. |
| `IntervalPerTick` | number | Live `interval_per_tick` access in seconds; writes use finite-float validation, without requiring a positive interval or updating other timing state. |
| `InterpolationAmount` | number | Live `interpolation_amount` access; writes use finite-float validation, with no application-specific interpolation bounds. |
| `SaveRestoreDataAddress` | bigint | Live `pSaveData` address; reads preserve it as an exact BigInt. Writes accept nonnegative BigInts within native `uintptr_t` range, including zero, and replace the native address without validating the target object or managing its lifetime. Do not assign fabricated or stale addresses. |
| `MapName` | string | Live current map name through a native getter with no native setter; reading it does not establish map readiness. |
| `MapVersion` | number (integer) | Live `mapversion` access; writes require an exact native-range integer but do not modify the map file. |
| `StartSpot` | string | Live `startspot` string through a native getter with no native setter. |
| `MapLoadType` | number (integer) | Live `eLoadType` access; writes require an integer from `MapLoad_NewGame` through `MapLoad_Background`, inclusive. Assigning the field does not initiate a map load. |
| `MapLoadFailed` | boolean | Optional native field accessor, installed only when the selected SDK declares `bMapLoadFailed`. When present, reads the current field; writes require a primitive boolean and supported native assignment, otherwise throw. Assigning it does not repair a failed map load. |
| `IsDeathmatch` | boolean | Live `deathmatch` access; writes require a primitive boolean and assign only the global field, without invoking game-mode setup. |
| `IsCooperative` | boolean | Live `coop` access; writes require a primitive boolean and assign only the global field, without invoking game-mode setup. |
| `IsTeamplay` | boolean | Live `teamplay` access; writes require a primitive boolean and assign only the global field, without invoking game-mode setup. |
| `MaximumEntities` | number (integer) | Live `maxEntities` access; writes require an exact native-range integer but do not resize entity storage or validate its capacity. |

Depending on the selected SDK, the view additionally exposes `AbsoluteFrameStartTimeStandardDeviation`, `ServerCount`, `EdictArrayAddress`, `MapGroupName`, `SimulatedTicksThisFrame`, `NetworkProtocol`, `IsClient()`, `IsRemoteClient()`, and `GetNetworkBase(nTick, nEntityIndex)`. Both network-base arguments are validated as native-range signed integers; that check does not establish a valid live entity. Test optional member availability before use. See the dedicated globals page for setter types, address limits, and ownership rules; representation checks alone do not establish safe engine-state changes.

## Commands and console output

| Export | Contract | Concrete use |
| --- | --- | --- |
| `ExecuteServerCommand(strCommand)` | Requires a nonempty string, appends a newline, calls `ServerCommand`, then `ServerExecute` on the command buffer, not an isolated single command. Returns `true` after those calls, not the command's success status. A C++ exception becomes a contextual JavaScript error without rolling back earlier calls. | `const bCommandSubmitted = g_ServerAPI.ExecuteServerCommand("status");` |
| `QueueServerCommand(strCommand)` | Requires a nonempty string, appends `;`, and calls `ServerCommand` without executing the buffer. Returns `true` after submission, not eventual command success. A C++ exception becomes a contextual JavaScript error without guaranteeing rollback. | `const bCommandQueued = g_ServerAPI.QueueServerCommand("exec sourcejs.cfg");` |
| `InsertServerCommand(strCommand)` | Requires a nonempty string, appends `;`, and calls native `InsertServerCommand` without executing the buffer. Returns `true` after submission, not eventual command success. A C++ exception becomes a contextual JavaScript error without guaranteeing rollback. | `const bCommandInserted = g_ServerAPI.InsertServerCommand("echo SourceJS ready");` |
| `ExecuteClientCommand(ClientOrIndex, strCommand, bServerSide?)` | Requires a primitive command string with a nonempty full UTF-8 conversion, then resolves a connected player from an index or index-bearing object. Native calls receive the string's NUL-terminated prefix; embedded NUL is not rejected, so that prefix can be empty. A failed index conversion or negative index returns `undefined` unless conversion raised an exception; an original `Index` getter error stops before command conversion or player lookup. Omitted/nullish `bServerSide` is false; other values must be primitive booleans. False prefers plugin helpers when available, otherwise the engine; true selects the engine directly. Returned `true` is not client execution confirmation. | For an already validated connected player at index 1: `const bClientCommandResult = g_ServerAPI.ExecuteClientCommand(1, "play ui/buttonclick.wav", true);` |
| `ExecuteClientCommandKeyValues(Client, KeyValues)` | Requires a connected player and a registered, owned root KeyValues handle belonging to the current plugin context; borrowed, unknown, and foreign handles are rejected. Captures the client's full native handle before reading KeyValues getters, then rechecks that same identity and connection after preparation. Only then releases hierarchy ownership to the engine immediately before `ClientCommandKeyValues`; returns `true`, not command success. A rejection before transfer keeps an otherwise still-valid hierarchy owned; getter code can itself destroy or change it. Do not reuse a transferred hierarchy. Omitted when the selected SDK lacks the method. | For a validated connected client `CurrentPlayer` and an owned `CommandHierarchy` prepared for that client: `const bSubmitted = g_ServerAPI.ExecuteClientCommandKeyValues(CurrentPlayer, CommandHierarchy);` Do not reuse the hierarchy after transfer. |
| `PrintToClientConsole(ClientOrIndex, strMessage)` | Requires a primitive string, permits empty strings, resolves a connected player, and calls `ClientPrintf` with the NUL-terminated UTF-8 prefix. The binding appends no newline; a failed index conversion or negative index returns `undefined` unless conversion raised an exception. Returned `true` confirms the native call, not visible delivery. | For an already validated connected player at index 1: `const bMessageResult = g_ServerAPI.PrintToClientConsole(1, "SourceJS diagnostics complete\n");` |
| `PrintDeveloperOverlayLine(nConsolePosition, strConsoleMessage)` | Calls `Con_NPrintf` and returns `true`; omitted without that SDK method. This basic callback does not require `con_nprint.h`. A successful call does not guarantee a visible overlay. | `const bOverlaySubmitted = g_ServerAPI.PrintDeveloperOverlayLine(2, "SourceJS: trace active");` |
| `PrintDeveloperOverlayLineExtended(DeveloperOverlayInformation, strConsoleMessage)` | Calls `Con_NXPrintf` with required `Index`, `TimeToLive`, Vector-compatible `Color`, and boolean `FixedWidthFont` fields; returns `true` after the call, not visibility confirmation. Omitted without the SDK method; an exposed callback throws without `con_nprint.h` support. | `const bExtendedOverlaySubmitted = g_ServerAPI.PrintDeveloperOverlayLineExtended({ Index: 3, TimeToLive: 2, Color: { X: 0, Y: 1, Z: 0 }, FixedWidthFont: true }, "SourceJS OK");` |
| `PrintEngineLog(strMessage)` | Requires a primitive message string whose native UTF-8 prefix before the first NUL is nonempty, and passes only that prefix to `LogPrint` without appending a newline. Returns `true` after the call, not confirmation of log persistence. | `const bLogSubmitted = g_ServerAPI.PrintEngineLog("[SourceJS] round initialized\n");` |

Command APIs forward text to engine command facilities without escaping or restricting it to one command; the server-buffer and client routes differ as described above. Native calls consume NUL-terminated text, so an embedded NUL ends the command or log text seen by the engine. Reject embedded NULs and use fixed, trusted command text; do not concatenate untrusted chat, player names, or other input into commands. Logging text does not execute commands, but untrusted newlines can forge log records, and secrets must not be logged.

## Visibility, areas, and level state

`ChangeLevel`, `IsMapValid`, `IsModelPrecached`, `IsDecalPrecached`, `IsGenericPrecached`, `GetClusterForOrigin`, `GetPVSForCluster`, `CheckOriginInPVS`, and `CheckBoxInPVS` translate C++ exceptions raised during preparation, interface lookup, and native dispatch into contextual JavaScript errors. The four map/precache checks share the `engines/server precache/map check` diagnostic. Vector parsing preserves original property-getter and numeric-parser errors and stops before native dispatch; this is not a recovery or rollback guarantee for engine calls that already started.

`GetMulticastRecipients`, `ResetPVS`, `AddOriginToPVS`, `SetAreaPortalState`, `IsHeadNodeVisible`, `AreAreasConnected`, and `GetAreaForOrigin` also translate C++ exceptions from preparation, interface lookup, native dispatch, and result construction. Original JavaScript argument errors propagate without native dispatch. A failed operation does not guarantee rollback of engine side effects or the shared PVS accumulator; returned byte arrays are independent copies, not ownership of native accumulator storage.

The same C++ exception boundary covers `GetAreaBits`, `GetAreaPortalPlane`, `SetAreaPortalStates`, `LoadGameState`, and `LoadAdjacentEntities`. Argument parsing stops at the original JavaScript error, before native dispatch. Bulk portal arrays are copied and validated before one native call. Native false/null results retain the contracts below; exception translation does not guarantee rollback of portal changes, saved-state loading, or entity transitions.

`GetTextMessage`, `GetPlayerInformation`, `PrintDeveloperOverlayLine`, and `PrintDeveloperOverlayLineExtended` also translate C++ exceptions from preparation, interface lookup, native dispatch, and result construction into operation-specific JavaScript errors. Original JavaScript property-getter and numeric-parser errors propagate before native dispatch. This does not guarantee native-memory validity, overlay visibility, or rollback of a native call that already started.

`ExecuteClientCommandKeyValues`, `NotifyEdictFlagsChange`, `GetEntityTransmitBitsForClient`, and `GetPreviousCheckTransmitInformation` have the same contextual C++ exception boundary. An original `Index` getter error stops before player/edict lookup, native notification, or KeyValues ownership transfer; it is not replaced by a generic argument error. KeyValues `Handle` getter errors, changed client identity, disconnection, or failure while collecting the hierarchy stop before ownership transfer and native dispatch; a hierarchy not independently invalidated by user code remains owned. Handle parsing is not repeated for transfer, but the recursive parser may revisit an object and re-read its getter; it stops before inspecting a value at depth 16 (the initial value is depth 0). A completed native-null transmit query returns `null`, distinct from an unsupported API error. Exception translation does not restore a transferred KeyValues hierarchy or roll back native effects, validate borrowed addresses, or confirm client delivery.

`GetSharedEdictChangeInformation`, `GetEntityChangeAccessor`, `CreateSpatialPartition`, `DestroySpatialPartition`, `DrawSpatialPartitionMapToScratchPad`, and `NotifySolidMoved` also translate C++ exceptions from preparation, interface/entity lookup, native calls, and result construction. Original JavaScript getter/conversion errors stop processing before the next native operation. This does not roll back earlier native effects, invalidate stale aliases, or validate native memory. Successfully returned spatial partitions still require explicit destruction; creation attempts cleanup only when it cannot return the newly allocated partition.

`NotifyTriggerMoved`, `BuildEntityClusterList`, and `CleanUpEntityClusterList` translate C++ exceptions from preparation, interface/entity/PVS lookup, native calls, and result construction. Original `Index` getter errors stop processing before the next native lookup, address fallback, or native submission. Cluster builds and cleanup are not rolled back if subsequent work fails; returned metadata is copied and does not establish native storage ownership or lifetime.

| Export | Contract | Concrete use |
| --- | --- | --- |
| `ChangeLevel(strMapName, strLandmark?)` | Calls native `ChangeLevel` with a nonempty map name; an omitted/nullish landmark becomes a null native string, while an empty string stays empty. Returns `true` after the call, not confirmation that loading succeeded. | Administrator-controlled use with a map installed for the current game: `const bLevelChangeRequested = g_ServerAPI.ChangeLevel("c1m2_streets");` |
| `IsMapValid(strResourceName)` | Returns whether native `IsMapValid` reports nonzero for a nonempty map name; does not initiate or guarantee a later successful load. | `const bMapValid = g_ServerAPI.IsMapValid("c1m2_streets");` |
| `GetInstalledMaps()` | Lists distinct valid map names in ascending order, without `.bsp`, from `maps/*.bsp` in the engine's `GAME` search path. Returns an empty array if none are found; throws if the engine filesystem is unavailable. Does not recurse into subdirectories. | `const vecMaps = g_ServerAPI.GetInstalledMaps();` |
| `IsInEditMode()` | Returns whether native `IsInEditMode` reports nonzero. | `const bEditing = g_ServerAPI.IsInEditMode();` |
| `GetClusterForOrigin(Origin)` | Parses a Vector-compatible position and returns the native signed cluster result unchanged; do not treat an unchecked result as an array index. An original coordinate-getter error is preserved, including during native C++ unwinding, without calling the cluster query. | Query a known position in the current map: `const nClusterIndex = g_ServerAPI.GetClusterForOrigin({ X: 0, Y: 0, Z: 0 });` |
| `GetPVSForCluster(nClusterIndex)` | Applies V8 `ToInt32` conversion (including coercion, truncation, and wrapping), then requires the converted cluster index to be inside the loaded BSP. Returns `{ RequiredBytes, Bytes }`, with copied `Uint8Array` storage sized to the final native-reported byte count; rejects sizes above 1 MiB and retries once if the initial buffer is too small. The record defines own enumerable, writable, configurable data fields in `RequiredBytes`, `Bytes` order; inherited setters are bypassed. | Given a validated current-map cluster: `const PVS = g_ServerAPI.GetPVSForCluster(nClusterIndex);` |
| `CheckOriginInPVS(Origin, PVSBytes)` | Copies an `ArrayBuffer` or view and returns the native point-in-PVS test. Requires nonempty storage fitting a native signed length, but does not verify its map provenance or map-required size. PVS membership is not a line-of-sight test. | With current-map `PVS` and a known world position: `const bOriginInPVS = g_ServerAPI.CheckOriginInPVS({ X: 0, Y: 0, Z: 0 }, PVS.Bytes);` |
| `CheckBoxInPVS(MinimumBounds, MaximumBounds, PVSBytes)` | Tests supplied world-space bounds against copied PVS bytes with the same buffer checks as the point test. The binding does not order bounds or transform entity-local bounds into world space. | Supply ordered world-space bounds and current-map PVS data; do not pass local entity extents as world bounds. |
| `GetMulticastRecipients(bUsePAS, Origin)` | Requires a primitive boolean and Vector-compatible origin; returns an array of set recipient indices from 1 through `ABSOLUTE_PLAYER_LIMIT - 1`. PAS/PVS selection does not confirm actual sound delivery or continued client connectivity. The installed callback throws without `bitvec.h` and `ABSOLUTE_PLAYER_LIMIT`. | For a known current-map position: `const vecPASRecipients = g_ServerAPI.GetMulticastRecipients(true, { X: 0, Y: 0, Z: 0 });` |
| `ResetPVS(nPVSByteCount?)` | Replaces the shared native accumulator storage, calls engine `ResetPVS`, and returns a copied `Uint8Array`, not a live view. Omitted/nullish size defaults to the current cluster count rounded up to bytes; a positive current cluster count is required even with an explicit size. An explicit non-nullish size uses V8 `ToInt32` conversion (including coercion, truncation, and wrapping); the converted size must be 1–1048576. An override is not checked against the map-required size. Omitted when the SDK lacks `ResetPVS`; this state is not plugin-local. | Prefer the map-derived size: `const arrAccumulatedPVS = g_ServerAPI.ResetPVS();` |
| `AddOriginToPVS(Origin)` | Requires a nonempty shared accumulator from `ResetPVS`, calls native `AddOriginToPVS`, and returns a copied `Uint8Array`; earlier returned arrays do not update. The nonempty check does not establish current-map provenance or exclusive ownership. Omitted when the SDK lacks the method. | After a successful current-map reset, without intervening accumulator users: `const arrUpdatedPVS = g_ServerAPI.AddOriginToPVS({ X: 0, Y: 0, Z: 0 });` |
| `SetAreaPortalState(nAreaPortalNumber, bIsAreaPortalOpen)` | Parses the portal number and requires a primitive boolean, mapped to native 0/1. Calls `SetAreaPortalState` and returns `true` without validating portal membership or confirming the resulting state. | Only for a verified portal in the current map: `const bPortalStateSubmitted = g_ServerAPI.SetAreaPortalState(12, true);` |
| `SetAreaPortalStates(vecAreaPortalNumbers, vecAreaPortalOpenStates)` | Requires nonempty, equally sized JavaScript arrays whose count fits native `int`; parses portal numbers and requires primitive boolean states, converted to 0/1. Copies both arrays before one native call; `true` does not confirm portal validity or resulting states. Omitted without the SDK bulk operation. | For verified current-map portals: `const bPortalStatesSubmitted = g_ServerAPI.SetAreaPortalStates([12, 13], [true, false]);` |
| `IsHeadNodeVisible(nHeadNodeIndex, PVSBytes)` | Parses the head-node index, copies a nonempty `ArrayBuffer` or view with length fitting native `int`, and returns whether `CheckHeadnodeVisible` reports nonzero. Does not validate the node against the BSP or the buffer against map-required size/provenance. | For a verified `nHeadNodeIndex` and matching current-map `arrPVSBytes`: `const bVisibleInPVS = g_ServerAPI.IsHeadNodeVisible(nHeadNodeIndex, arrPVSBytes);` This is not a line-of-sight test. |
| `AreAreasConnected(nFirstAreaNumber, nSecondAreaNumber)` | Parses both area numbers and returns whether native `CheckAreasConnected` reports nonzero; the binding does not validate area membership in the current BSP. Omitted when the selected SDK lacks the method. | For two verified current-map areas: `const bConnected = g_ServerAPI.AreAreasConnected(2, 5);` |
| `GetAreaForOrigin(Origin)` | Parses a Vector-compatible position and returns the signed native `GetArea` result unchanged; validate it before using it as an area or array index. | For a known current-map position: `const nAreaNumber = g_ServerAPI.GetAreaForOrigin({ X: 0, Y: 0, Z: 0 });` |
| `GetAreaBits(nAreaNumber)` | Parses the area number without checking BSP membership, calls the engine with zero-initialized `MAX_AREA_STATE_BYTES` storage, and returns a copied `Uint8Array` of that full size. Omitted without the SDK method; an installed callback throws without `MAX_AREA_STATE_BYTES`. | Given a verified current-map area: `const arrAreaBits = g_ServerAPI.GetAreaBits(nAreaNumber);` |
| `GetAreaPortalPlane(Origin, nAreaPortalKey)` | Parses a Vector-compatible origin and portal key without validating key membership in the BSP. Returns `{ Normal, Distance }` on native success or `null` on native failure; inspect the result before reading fields. The success record defines own enumerable, writable, configurable data fields in `Normal`, `Distance` order; inherited setters are bypassed. Omitted without the SDK method; an installed callback throws without `VPlane` support. | For a verified current-map portal and position: `const Plane = g_ServerAPI.GetAreaPortalPlane({ X: 0, Y: 0, Z: 0 }, 12);` |
| `LoadGameState(strMapName, bCreatePlayers?)` | Requires a nonempty map string and an optional primitive boolean; omitted/nullish `bCreatePlayers` defaults to true. Returns the native saved-state load result, not a transactional rollback guarantee. Omitted when unsupported by the SDK. | Only in the appropriate saved-state lifecycle for an installed map: `const bGameStateLoaded = g_ServerAPI.LoadGameState("d1_trainstation_01", true);` |
| `LoadAdjacentEntities(strOldLevelName, strLandmarkName)` | Requires two nonempty strings and calls native `LoadAdjacentEnts`; returns `true` after the call, not a separate success or entity-count result. Omitted when unsupported by the SDK. | Only during a valid transition with matching level and landmark: `const bAdjacentEntitiesRequested = g_ServerAPI.LoadAdjacentEntities("d1_trainstation_01", "landmark_a");` |
| `ClearSaveDirectoryAfterClientLoad()` | Calls native `ClearSaveDirAfterClientLoad` and returns `true` without inspecting the resulting save directory. The binding does not wait for client loading or validate that cleanup is appropriate. | At the reviewed engine post-load point, on a branch exposing this operation: `const bCleanupSubmitted = g_ServerAPI.ClearSaveDirectoryAfterClientLoad();` Do not use it as a generic file cleanup command. |
| `SetPaused(bPaused, bForcePauseState?)` | Requires primitive booleans; omitted/nullish `bForcePauseState` defaults to false. Calls native `Pause` and returns `true` without reading back the pause state; omitted when unsupported by the selected SDK. | Administrator-controlled request: `const bPauseRequested = g_ServerAPI.SetPaused(true, false);` |
| `IsPaused()` | Returns the native engine pause-state boolean at the time of the call. | `const bPaused = g_ServerAPI.IsPaused();` |
| `GetTimescale()` | Returns the native timescale as a JavaScript Number through a float intermediate, without validating the returned range or finiteness; omitted when unsupported by the SDK. | `const flPreviousTimescale = g_ServerAPI.GetTimescale();` |
| `SetTimescale(flTimescale)` | An omitted argument returns `undefined` without native dispatch; otherwise converts the argument to a finite native-range float, then calls `SetTimescale` or the SDK's `SetGameTimescale` fallback. Does not require a positive value or read back the result; `true` reports completion of the native call. Omitted when unsupported by the SDK. | Administrator-controlled request using a game-supported value: `const bTimescaleRequested = g_ServerAPI.SetTimescale(0.5);` |
| `ValidateHostSession()` | Calls native `HostValidateSession` and returns `true`; this is not a returned session-validity verdict. Omitted when unsupported by the SDK. | At the appropriate host-session lifecycle point: `const bSessionValidationRequested = g_ServerAPI.ValidateHostSession();` |
| `RefreshScreenIfNecessary()` | Calls native `RefreshScreenIfNecessary` and returns `true`; the binding does not confirm that a screen refresh occurred or control its timing. Omitted when unsupported by the SDK. | `const bScreenRefreshRequested = g_ServerAPI.RefreshScreenIfNecessary();` |
| `EndMultiplayerGame()` | Calls native `MultiplayerEndGame` and returns `true` without independently confirming game termination. Omitted when unsupported by the SDK. | Administrator-controlled request at an appropriate game lifecycle point: `const bGameEndRequested = g_ServerAPI.EndMultiplayerGame();` |
| `SetServerHibernation(bHibernating)` | Requires a primitive boolean and calls `IServerGameDLL::ServerHibernationUpdate`, or `SetServerHibernation` as a fallback. Returns `true` after the call without confirming engine hibernation state; omitted without either SDK method. | At the appropriate server lifecycle point: `const bHibernationRequested = g_ServerAPI.SetServerHibernation(false);` |
| `ReserveServerForQueuedGame(strQueuedGameReservationPayload)` | Requires a primitive string and forwards its NUL-terminated UTF-8 prefix, including an empty prefix; returns the native reservation boolean. Embedded NUL is not rejected. The binding neither parses JSON nor validates the payload schema. Omitted when unsupported by the SDK. | With a trusted payload matching the selected engine's reservation contract: `const strReservationPayload = "<trusted reservation payload>"; const bServerReserved = g_ServerAPI.ReserveServerForQueuedGame(strReservationPayload);` |

## Clients and identity

| Export | Contract | Concrete use |
| --- | --- | --- |
| `GetClientCVarValue(PlayerOrIndex, strCVarName)` | Reads an exact native-range integer Number or an object's `Index`; unrecognized selectors resolve to `-1`, while getter errors propagate. Requires a nonempty primitive string name; the native query consumes its NUL-terminated UTF-8 prefix, and embedded NUL is not rejected. Returns a copied native string; nonpositive indices and null native results produce an empty string, indistinguishable from an empty value. The binding does not check positive-index bounds or connectivity here. | For a verified connected player at index 1: `const strRate = g_ServerAPI.GetClientCVarValue(1, "rate");` |
| `GetPlayerInformation(Player)` | Resolves an index from a number or index-bearing object, rejects negative indices, and delegates the lookup to the engine without an upper-bound or connectivity check. Returns a copied fields object with own data properties on native success or `null` on native failure; it is not a live view or an authentication verdict. Omitted without the SDK method; an exposed callback throws without `player_info_t` support. | For a verified current player index, then check for `null`: `const PlayerInformation = g_ServerAPI.GetPlayerInformation(1);` |
| `GetClientSteamID(PlayerOrIndex, bValidatedOnly?)` | Resolves an index from a number or index-bearing object and requires an index in `1..maxClients` with a nonfree edict. An original `Index` getter error stops before native lookup. Returns copied SteamID fields or `null` for a null native result. Omitted/nullish `bValidatedOnly` defaults to false; a provided value must be boolean. The flag is passed only to the SDK's two-argument overload and is ignored by the one-argument fallback, so true alone does not prove validation. Omitted without the SDK method; an exposed callback throws without SteamID header support. | For a verified current client, then check for `null` and the SDK's authentication contract: `const SteamID = g_ServerAPI.GetClientSteamID(1, true);` |
| `GetClientXUID(ClientOrIndex)` | Resolves an index from a number or index-bearing object and requires a positive index with a nonfree edict; an original `Index` getter error is preserved before edict lookup. The callback does not separately verify `maxClients`, connectivity, or authentication. Returns the native result converted to unsigned 64-bit `bigint`, including zero if supplied by the engine. Omitted when unsupported by the SDK. | For a verified current client: `const unXUID = g_ServerAPI.GetClientXUID(1);` Keep it as `bigint` rather than converting to a potentially imprecise Number. |
| `GetPlayerNetworkChannelInformation(nPlayerIndex)` | Requires a positive signed-32-bit Number index and returns a borrowed native netchannel-info view, or `null` when `GetPlayerNetInfo` returns null. The binding does not separately check the maximum client index here. Accessors use the receiver's native address; retaining the JavaScript view does not retain the channel. Do not reuse it after disconnection or channel replacement. | For a verified current client: `const flOutgoingLatency = g_ServerAPI.GetPlayerNetworkChannelInformation(1)?.LatencyOutgoing;` A null view produces `undefined`, not zero latency; optional chaining does not protect against a stale native address. |
| `GetClientCrossPlayPlatform(nClientIndex)` | Applies V8 `ToInt32` conversion, including coercion, truncation and wrapping, then requires a positive result. Missing arguments are rejected; original conversion errors stop before native dispatch. No independent maximum-client-index or connectivity check. Returns the native platform code converted to `int`; interpret codes using the selected SDK, not a project-wide assumed enumeration. Omitted when unsupported by the SDK. | For a verified current client: `const nPlatform = g_ServerAPI.GetClientCrossPlayPlatform(1);` |
| `IsClientFullyAuthenticated(Client)` | Resolves an edict and returns the native engine authentication boolean. This is not a plugin permission check or a guarantee of later connectivity; pass a verified current client. Omitted without the SDK method; an exposed old-console callback throws as unsupported. | `const bClientFullyAuthenticated = g_ServerAPI.IsClientFullyAuthenticated(1);` |
| `StartClientCVarQuery(Client, strCVarName)` | Resolves an edict, requires a primitive name string with a nonempty native UTF-8 prefix before the first NUL, passes that prefix to the engine, and returns the signed native `StartQueryCvarValue` cookie unchanged, not the CVar value or completion status. Check the selected SDK's invalid-cookie sentinel and correlate asynchronous completion; this call does not install a JavaScript callback. Omitted without SDK support; an exposed Dark Messiah callback throws as unsupported. | For a verified current client with completion handling already arranged: `const nQueryCookie = g_ServerAPI.StartClientCVarQuery(1, "cl_language");` |
| `IsUserIDInUse(nUserID)` | Applies V8's signed 32-bit integer conversion (JavaScript `ToInt32` semantics) and returns the engine's current in-use boolean; the binding does not require a positive ID. Use a session user ID, not a client index or SteamID. This does not establish authentication or future connectivity. Omitted when unsupported by the SDK. | With `PlayerInformation` from `GetPlayerInformation`: `const bUserIDActive = PlayerInformation ? g_ServerAPI.IsUserIDInUse(PlayerInformation.UserID) : false;` |
| `GetUserLoadingProgress(nUserID)` | Applies the same signed 32-bit integer conversion to a user ID and returns native `GetLoadingProgressForUserID` as an integer, without normalizing its range or checking that the ID is active. Interpret progress and sentinel values using the selected SDK; do not assume a fraction or percentage. Omitted when unsupported by the SDK. | With `PlayerInformation` from `GetPlayerInformation`: `const nLoadingProgress = PlayerInformation ? g_ServerAPI.GetUserLoadingProgress(PlayerInformation.UserID) : null;` Null here means no player information, not zero progress. |
| `CreateFakeClient(strFakeClientName)` | Requires a primitive name string whose native UTF-8 prefix before the first NUL is nonempty, and passes only that prefix to native `CreateFakeClient`; returns an edict wrapper, or `null` for a null native result. Wrapper-construction failure propagates a pending JavaScript exception, or returns `undefined` when none is pending. Native creation precedes wrapper construction, and the callback does not remove the client if wrapping fails. The wrapper does not own the client's lifetime or guarantee game-specific bot setup. Native edict address records copy `Kind` and `ClassName` into owned JavaScript strings and create own data properties without invoking inherited setters; non-writable prototype fields do not block construction. This preserves the string snapshot, not the lifetime of the reported entity/address. | Administrator-controlled creation with lifecycle handling arranged: `const BotEdict = g_ServerAPI.CreateFakeClient("SourceJS Bot");` Check for a non-nullish object before use; a missing wrapper does not prove that no client was created. |
| `CreateFakeClientWithOptions(strFakeClientName, bReportFakeClient?)` | Requires a primitive string with a nonempty native UTF-8 prefix before any NUL; omitted/nullish reporting flag defaults to true, otherwise it must be a primitive boolean. Forwards to native `CreateFakeClientEx` and returns an edict wrapper or `null` for native creation failure. Like `CreateFakeClient`, wrapper-construction failure can throw or return `undefined`, and does not roll back native creation. Its edict record uses the same string-snapshot and borrowed-address lifetime policy as `CreateFakeClient`. Omitted when unsupported by the SDK. | With administrator approval and client lifecycle handling arranged: `const BotEdict = g_ServerAPI.CreateFakeClientWithOptions("Director Bot", false);` Check for a non-nullish object; reporting semantics depend on the selected engine. |
| `SetFakeClientCVarValue(Client, strCVarName, strCVarValue)` | Resolves an edict, then requires primitive name and value strings. Converts each to its UTF-8 prefix before the first NUL; the name prefix must be nonempty, while the value prefix may be empty. Calls `SetFakeClientConVarValue` with those prefixes. The callback does not independently verify fake-client status or read back the value; `true` reports the native call. | With `BotEdict` from creation and its current fake-client identity verified: `const bFakeClientCVarSubmitted = BotEdict ? g_ServerAPI.SetFakeClientCVarValue(BotEdict.Index, "name", "SourceJS Bot") : false;` |
| `FadeClientVolume(Client, flFadePercent, flFadeOutSeconds, flHoldTime, flFadeInSeconds)` | Resolves an edict and converts four finite, float-range numeric values before calling the engine. If any numeric argument is an object, conversion can run JavaScript: the callback captures the original full entity handle before conversion, then requires the same live entry/serial and refreshes the edict before dispatch. Removal, replacement, or an unavailable handle rejects the call after successful numeric conversion; original conversion errors take precedence. Primitive numeric arguments do not add a handle requirement. This identity check does not pin native storage or validate percentage/time policy or independently check client connectivity; `true` reports the native call, not playback or completion. | For a verified connected client, with the percentage chosen according to the target SDK and nonnegative times in seconds: `const bVolumeFadeSubmitted = g_ServerAPI.FadeClientVolume(1, 25, 0.5, 1, 0.5);` |
| `IsSplitScreenPlayer(nPlayerIndex)` | Applies V8 `ToInt32` conversion, including coercion, truncation and wrapping, and returns the native boolean. An omitted argument returns `undefined` without native dispatch. The callback does not independently check the player range or connectivity; omitted when unsupported by the selected SDK. | With a verified current player index: `const bSplitScreen = g_ServerAPI.IsSplitScreenPlayer(2);` |
| `GetSplitScreenPlayerAttachment(nPlayerIndex)` | Applies V8 `ToInt32` conversion, including coercion, truncation and wrapping, to `nPlayerIndex`, then wraps the result of `GetSplitScreenPlayerAttachToEdict`, or returns `null` for a null native result. An omitted argument returns `undefined` without native dispatch; conversion errors propagate without native dispatch. The wrapper borrows engine storage; the callback does not independently check the player range or connectivity. Omitted when unsupported by the selected SDK. | With a verified current player index, check the result before use and do not retain it past the edict's lifetime: `const ParentEdict = g_ServerAPI.GetSplitScreenPlayerAttachment(2);` |
| `GetSplitScreenPlayerForEntity(nEntityIndex, nSplitScreenSlot)` | Converts `nEntityIndex` first, then `nSplitScreenSlot`, using V8 `ToInt32` conversion, including coercion, truncation and wrapping, then wraps the result of `GetSplitScreenPlayerForEdict`, or returns `null` for a null native result. With no arguments returns `undefined`; with only the entity index it converts that argument before returning `undefined` for the missing slot. Conversion errors propagate without native dispatch. Neither entity nor slot bounds are independently checked; the wrapper borrows engine storage. Omitted when unsupported by the selected SDK. | With a verified current entity and valid attached slot, check the result before use and respect the edict's lifetime: `const ChildEdict = g_ServerAPI.GetSplitScreenPlayerForEntity(1, 0);` |
| `GetAttachedSplitScreenUserCount(nEntityIndex)` | Applies V8 `ToInt32` conversion, including coercion, truncation and wrapping, to `nEntityIndex` and returns the native integer from `GetNumSplitScreenUsersAttachedToEdict`. An omitted argument returns `undefined` without native dispatch; conversion errors propagate without native dispatch. The callback does not independently validate entity bounds or normalize the result; omitted when unsupported by the selected SDK. | With a verified current entity index: `const nAttachedUserCount = g_ServerAPI.GetAttachedSplitScreenUserCount(1);` |
| `SendPaintMapDataToClient(ClientOrIndex)` | Resolves a positive client index from a number or index-bearing object, requires a nonfree edict, and calls `SendPaintmapDataToClient`; an original `Index` getter error is preserved before edict lookup. There is no separate maximum-client or connectivity check; `true` reports the native call, not delivery. Omitted when unsupported by the selected SDK. | For a verified connected client during the appropriate paint-map lifecycle: `const bPaintMapSubmitted = g_ServerAPI.SendPaintMapDataToClient(1);` |

Treat `GetPlayerInformation()`, `GetClientSteamID()`, both fake-client creation functions, and split-screen attachment lookups as nullable. The edict-returning calls can also return `undefined` if wrapper construction fails without a pending JavaScript exception. Supply the required arguments, handle exceptions, and require a non-nullish object before reading fields or passing an edict to another operation. For fake-client creation, a missing wrapper is not proof that native creation failed. An edict wrapper does not keep the engine entity alive; reacquire and validate it after lifecycle changes.

### `IServer` object

`GetServer()` returns a cached non-null native address without rediscovery or lifetime validation. On a cache miss it requires the `IVEngineServer` interface, tries the selected SDK's direct `GetIServer()` when available, and continues to packaged discovery if that method is absent or returns null. Packaged discovery reads the `[IServer]` section from `SOURCE_DATA_ROOT/memory/<engine-group>/GlobalAddresses.ini`, resolves its loaded binary and symbol or byte pattern, applies its signed `offset`, and follows `level` native-width addresses. For each field, selection tries `<field>_<platform>64` on x64, then `<field>_<platform>`, then `<field>`; for example, `identifier_linux64` overrides `identifier_linux` and `identifier`. These lowercase keys are the external INI format, not JavaScript property names. Byte patterns on x64 require an explicit `identifier_<platform>64`; common or platform-only patterns are not reused on x64. The native loader rejects malformed or duplicate records, invalid offsets/counts, and accessor-based records. Pattern scans are restricted to readable mapped ranges, and each indirect address read must copy the complete native-width value.

If packaged discovery cannot resolve the server, SourceJS consults `sdktools.games` in the active [startup snapshot](memory-gamedata.md), or existing local GameData when no snapshot is available. On Windows x86, `master.games.txt` selects the file for the active game directory. The fallback requires that file's `CreateFakeClient_Windows` signature and `sv` offset, and a `CreateFakeClient` vtable slot derivable from the selected SDK. It verifies the method bytes before reading the embedded address and does not substitute another game's recipe. Other Windows architectures do not use this instruction format. The non-Windows fallback resolves `@`-prefixed symbols, not byte patterns. Discovery still depends on data matching the installed engine build: range checks do not establish that a signature identifies the intended native object. Successful discovery populates the cache; the stored address remains borrowed, and caching does not extend server lifetime.

`GetServer()` and `GetServerFromAddress()` create the same JavaScript wrapper shape around a borrowed `IServer` address, not an owned server or state snapshot. `Address` is the exact native address as a JavaScript `bigint`, and `Kind` is the descriptive string `"iserver"`; neither proves type or lifetime. Methods recover the address from their receiver, so keep calls qualified on the wrapper and do not replace its address or retain it beyond the native server's lifetime. Queries read current engine state; mutator results follow each method's contract and do not generally confirm completion. Prefer `GetServer()`; use `GetServerFromAddress()` only with an independently verified live `IServer` address, either as a `bigint` or in a supported wrapper's `Address` property, that fits native `std::uintptr_t`. A raw address does not establish object identity or lifetime.

The shared native address-record initializer installs `Address` and `Kind` as own writable, enumerable, configurable data properties, including in server and client wrappers. Inherited setters and non-writable prototype fields do not intercept those two initializers. This does not validate the native object or extend its lifetime.

The methods in the following `IServer` table are also installed as own writable, enumerable, configurable data properties. Inherited setters and non-writable prototype fields do not intercept their construction. These attributes do not imply native ownership or lifetime validation.

Numeric queries (`GetConnectedClientCount` through `GetRealPlayerCount`), boolean queries (`IsServerActive` through `IsReplayServer`), and string queries (`GetServerName`, `GetMapName`, `GetServerPassword`) translate caught C++ preparation, dispatch, and result-construction failures into contextual JavaScript `Error` exceptions, preserving any existing JavaScript exception. An exception from the receiver's `Address` getter stops the query before native dispatch. This does not protect against invalid-memory faults or prove that a nonzero address refers to a live server.

`GetClient`, `GetNetworkStatistics`, `SetServerPassword`, `SetServerPaused`, `SetServerTimescale`, `DisconnectClient`, `GetServer`, and `GetServerFromAddress` also translate caught C++ failures into operation-specific JavaScript `Error` exceptions without replacing an existing JavaScript exception. This does not undo a completed native mutation or disconnection when later work fails, and it does not protect against invalid-memory faults. Returned server and client wrappers remain borrowed. Checked V8 result-construction failures in `GetServer`, `GetServerFromAddress`, `GetClient`, and `GetNetworkStatistics` propagate a pending JavaScript exception, or can return `undefined` without one; they do not return a partial object or necessarily create a new exception. Require a non-nullish object before using these results.

| Method | Result or effect |
| --- | --- |
| `GetConnectedClientCount()` | Current native integer client count from `IServer::GetNumClients()`, not a count restricted to authenticated human players. |
| `GetProxyClientCount()` | Native integer count of attached HLTV proxies from `IServer::GetNumProxies()`. |
| `GetFakeClientCount()` | Native integer fake-client/bot count from `IServer::GetNumFakeClients()`. |
| `GetMaximumClients()` | Current native integer client limit from `IServer::GetMaxClients()`, not the number of free slots or allocated client objects. |
| `GetAllocatedClientCount()` | Native integer client-slot count from `IServer::GetClientCount()`, including used and unused slots; not the connected-client count. |
| `GetUDPPort()` | Native port converted to an integer, preferring `GetLocalUDPPort()` and falling back to `GetUDPPort()`. No independent port-range validation; throws when neither getter is supported by the selected SDK. |
| `GetServerTime()` | Current game-world time from `IServer::GetTime()`, returned from a native float; not wall-clock time or a cross-map monotonic clock. |
| `GetServerTick()` | Current game-world tick from `IServer::GetTick()`, returned as a native integer; not a lifetime-monotonic sequence identifier. |
| `GetServerTickInterval()` | Native float tick interval in seconds from `IServer::GetTickInterval()`. The binding does not validate positivity before returning it. |
| `GetServerTimescale()` | Current `IServer::GetTimescale()` value converted through a native float, without result-range validation; throws when the selected SDK lacks that getter. |
| `GetServerSpawnCount()` | Native integer from `IServer::GetSpawnCount()`. Do not treat this counter alone as proof that a retained native address is still valid. |
| `GetServerClassCount()` | Native integer class count from `IServer::GetNumClasses()`, not a JavaScript class inventory. |
| `GetServerClassBitCount()` | Native integer class-ID bit count from `IServer::GetClassBits()`. |
| `GetRealPlayerCount()` | Native integer from `IServer::GetNumPlayers()`. The binding does not independently filter clients or verify authentication; interpretation follows the target engine. |
| `GetServerName()` | Copies the public server name from `IServer::GetName()` into a JavaScript string; a null native string becomes `""`. |
| `GetMapName()` | Copies the current BSP map name from `IServer::GetMapName()` into a JavaScript string; a null native string becomes `""`. This query alone does not establish map readiness. |
| `GetServerPassword()` | Copies `IServer::GetPassword()` into a JavaScript string; a null native string becomes `""`. Treat the result as a secret: do not log, dump, or expose it to clients. |
| `IsServerActive()` | Current native `IServer::IsActive()` boolean; does not establish readiness of every subsystem. |
| `IsServerLoading()` | Current native `IServer::IsLoading()` boolean; querying does not wait for loading to finish. |
| `IsDedicatedServer()` | Native `IServer::IsDedicated()` boolean indicating dedicated-server mode. |
| `IsServerPaused()` | Current native `IServer::IsPaused()` boolean; a query, not a pause request. |
| `IsMultiplayerServer()` | Native `IServer::IsMultiplayer()` boolean, not a test that multiple clients are currently connected. |
| `IsServerPausable()` | Native `IServer::IsPausable()` boolean; does not itself change pause state. |
| `IsHLTVServer()` | Native `IServer::IsHLTV()` boolean describing this server, not the presence of attached HLTV clients. |
| `IsReplayServer()` | Native `IServer::IsReplay()` boolean describing this server; throws when the selected SDK lacks that method, rather than treating unsupported replay queries as `false`. |
| `GetClient(nClientIndex)` | Converts the argument using V8's signed 32-bit conversion and requires `(nClientIndex >= 0) && (nClientIndex < IServer::GetClientCount())` before wrapping the native client. An exception from argument conversion propagates unchanged; the binding does not query the native client state after that failure. Throws for a missing/invalid slot or null native client. Slots are zero-based, unlike player entity indices; the wrapper borrows storage and does not prove connectivity or preserve client identity after slot reuse. |
| `GetNetworkStatistics()` | Calls `IServer::GetNetStats()` once and copies its two native float outputs into own writable, enumerable, configurable data properties `{ Incoming, Outgoing }`, in that order. Inherited setters and non-writable prototype fields do not intercept their initialization. The TF2 SDK specifies total incoming/outgoing rates in bytes per second. This is a sample, not a live view; the binding neither normalizes units nor validates the returned values. |
| `SetServerPassword(strPassword)` | Requires a primitive string, permits an empty string, and passes its null-terminated representation to `IServer::SetPassword()`. Embedded NUL ends the native value. `true` reports the call, not a readback or verified access policy; keep passwords out of logs and examples containing real credentials. |
| `SetServerPaused(bPaused)` | Requires a primitive boolean and calls `IServer::SetPaused()`. `true` reports the call, not a readback confirming the resulting pause state. |
| `SetServerTimescale(dblServerTimescale)` | Converts a numeric argument, rejects nonfinite or out-of-float-range values, and calls `IServer::SetTimescale()` with the float conversion. An exception from argument conversion propagates unchanged; the binding does not call the native setter after that failure. Does not require positivity; choose a value supported by the target engine. `true` reports the call, not a readback. Throws for an invalid value or when the selected SDK lacks the setter. |
| `DisconnectClient(Client, strReason?)` | An Int32 Number selects a zero-based allocated slot and is range-checked; other supplied values must be a nonzero JavaScript `bigint` address fitting native `std::uintptr_t` or a supported wrapper with such an `Address`. An exception from the wrapper's `Address` getter propagates unchanged; the binding does not call native disconnection after that failure. This does not prove `IClient` type, ownership, or lifetime. Prefer a verified current slot or unmodified client wrapper belonging to this server. A missing or nullish reason uses `Disconnected by SourceJS.`; otherwise a primitive string is required, with empty strings permitted and embedded NUL ending the native reason. `true` reports `IServer::DisconnectClient()` being called, not confirmed disconnection. |

### `IClient` object

`Server.GetClient(nClientIndex)`, where `Server` is an `IServer` wrapper, returns a borrowed client wrapper for a zero-based slot. `Address` is a `bigint`, `Kind` is a string, and `Index` is a `number`; these are descriptive metadata, not validated identity tokens. Methods and native accessors resolve the receiver's address; preserve the receiver and do not alter its address or use it after disconnection, destruction, or slot reuse. The following properties query native state on every read: `PlayerSlot`, `UserID`, `Name`, `NetworkID`, `Rate`, `UpdateRate`, `MaximumAcknowledgedTickCount`, `Connected`, `Spawned`, `Active`, `FakeClient`, `IsHLTV`, and `NetworkChannelAddress`. A null native name or network ID becomes an empty string. Reading `Connected` itself dereferences the address, so it cannot safely validate an already stale wrapper. `NetworkChannelAddress` is the exact native channel address as a `bigint` (zero when no channel is present); it does not own or extend the referenced channel's lifetime.

`Index` and the six methods listed below are installed as own writable, enumerable, configurable data properties, in addition to the shared `Address` and `Kind` metadata. Inherited setters and non-writable prototype fields do not intercept these initializers. This construction rule does not change the live native accessors or establish native lifetime.

If reading `Address` throws, methods and native accessors propagate that original exception without invoking a native client operation. Missing, invalid, zero, or out-of-range addresses still produce an address diagnostic; this validation does not prove that a nonzero address is readable or belongs to a live `IClient`.

`IClient.DisconnectClient`, `IClient.ExecuteClientStringCommand`, `IClient.PrintToClientConsole`, `IClient.GetUserSetting`, `IClient.SetNetworkRate`, `IClient.SetUpdateRate`, and all native accessors also translate caught C++ preparation, dispatch, and result-construction failures through the JavaScript error boundary, preserving any existing JavaScript exception. This does not undo a completed native operation or protect against invalid-memory faults.

Both rate methods convert the required rate argument first, validate the optional `bForce` next, and resolve `Address` only after those checks. An original JavaScript rate-conversion error propagates unchanged; invalid arguments stop before address resolution and native dispatch.

| Method | Result or effect |
| --- | --- |
| `DisconnectClient(strReason?)` | Calls native `IClient::Disconnect()` and returns `true` without confirming completion. A missing/nullish reason uses `Disconnected by SourceJS.`; otherwise a primitive string is required, including an empty string. Embedded NUL ends the native reason. Do not reuse the wrapper after disconnecting. |
| `ExecuteClientStringCommand(strCommand)` | Requires a primitive string and returns the native `IClient::ExecuteStringCommand()` boolean. Empty strings are allowed; embedded NUL ends the native command. The binding performs no escaping or command authorization: use trusted commands, not concatenated untrusted input. |
| `PrintToClientConsole(strMessage)` | Requires a primitive string, permits empty strings, and calls `IClient::ClientPrintf()` with a fixed `%s` format. Embedded NUL ends the native text; no newline is appended. `true` reports the call, not client receipt. |
| `GetUserSetting(strName)` | Requires a primitive string and calls `IClient::GetUserSetting()` with its null-terminated representation; empty names are not rejected and embedded NUL ends the name. Copies the native value into a JavaScript string, mapping null to `""`, so an empty result does not distinguish missing from empty settings. Treat client-supplied settings as untrusted data, not authentication or authorization evidence. |
| `SetNetworkRate(nRate, bForce?)` | Applies V8's signed 32-bit conversion (`ToInt32`, including coercion, truncation, and wrapping) and calls `IClient::SetRate()`, without checking positivity or engine-specific limits. Omitted `bForce` defaults to `false`; any supplied value, including `null` or `undefined`, must be a primitive boolean. `true` reports the native call, not the effective rate after engine policy. |
| `SetUpdateRate(nUpdateRate, bForce?)` | Applies V8's signed 32-bit conversion (`ToInt32`, including coercion, truncation, and wrapping) and calls `IClient::SetUpdateRate()`, without checking positivity or engine-specific limits. Omitted `bForce` defaults to `false`; any supplied value, including `null` or `undefined`, must be a primitive boolean. `true` reports the native call, not the effective update rate. |

## Entities, transmission, and spatial partitions

| Export | Contract | Concrete use |
| --- | --- | --- |
| `CreateEdict(nForcedEntityIndex?)` | Calls `CreateEdict()` and returns a borrowed wrapper or `null` for a null native result. Omission/nullish passes `-1`; other values use V8 `ToInt32` conversion, including coercion, truncation, and wrapping, without independent slot-policy checks. Creation precedes wrapping, with no rollback if wrapping fails; checked wrapper-construction failure can propagate an exception or return `undefined` without one. | During an appropriate entity-creation phase, with an explicit cleanup plan: `const Edict = g_ServerAPI.CreateEdict();` This alone does not initialize a game entity. |
| `RemoveEdict(Edict)` | Resolves an edict and calls `RemoveEdict()`; `true` reports the call. Existing JavaScript aliases are not cleared or made safe by the callback: stop using all wrappers/views referring to the removed storage. | Only for the still-live edict created above, when engine lifecycle rules permit removal: `const bEdictRemovalSubmitted = Edict ? g_ServerAPI.RemoveEdict(Edict) : false;` |
| `AllowImmediateEdictReuse()` | Calls the engine-wide `AllowImmediateEdictReuse()` operation and returns `true`; this does not repair stale wrappers or validate retained addresses. Omitted when unsupported by the selected SDK; the Dark Messiah callback reports unsupported use. | Only at an engine-supported lifecycle point with no retained stale aliases: `const bImmediateReuseSubmitted = g_ServerAPI.AllowImmediateEdictReuse();` |
| `ForceFlushEntity(EntityOrIndex)` | Accepts a nonnegative signed 32-bit integer Number or an object whose `Index` resolves to one, then calls `IVEngineServer::ForceFlushEntity()`. An original `Index` getter error propagates without native dispatch. No independent entity-slot upper-bound/liveness check; `true` reports the call, not completed transmission. | With a verified live, fully initialized `Entity` appropriate for this operation: `const bEntityFlushSubmitted = g_ServerAPI.ForceFlushEntity(Entity.Index);` |
| `EnsureEntityInstanceBaseline(EntityOrIndex)` | Resolves an index or index-bearing object, rejects negative results, and calls `IVEngineServer::EnsureInstanceBaseline()`. An original `Index` getter error propagates without replacement or native dispatch. No independent upper-bound/liveness check; `true` reports the call without reading back baseline state. | With a verified live, fully initialized `Entity` during the appropriate baseline phase: `const bBaselineSubmitted = g_ServerAPI.EnsureEntityInstanceBaseline(Entity.Index);` |
| `NotifyEdictFlagsChange(Entity)` | Resolves an index, rejects negative results, and calls `IVEngineServer::NotifyEdictFlagsChange()` without independently checking upper bounds or liveness. Does not mutate flags itself; `true` reports the notification call. Omitted when unsupported by the selected SDK. | After a valid flag change on a verified live `Entity`: `const bFlagsChangeNotificationSubmitted = g_ServerAPI.NotifyEdictFlagsChange(Entity.Index);` |
| `GetEntityTransmitBitsForClient(nClientIndex)` | Uses JavaScript/V8 `ToInt32`, including numeric coercion, truncation, and wrapping; this is not strict integer validation. Conversion errors propagate before native dispatch. No independent client-range/connectivity checks; validate the client before calling. A null native bitset returns `null`; otherwise `{ Address, Kind, MaximumBits, Indexes }` contains the exact SDK-owned address as a `bigint`, kind `"CBitVec<MAX_EDICTS>"`, `MAX_EDICTS`, and a copied ascending array of set indices from zero through `MAX_EDICTS - 1`. Native bits are copied before filling the ordinary result object and index array with own writable, enumerable, configurable data properties; inherited setters and non-writable properties cannot intercept those writes. This copy neither validates nor extends the borrowed address's native lifetime. Do not write through or retain the address beyond its native lifetime; the array is not a live transmission view or proof of delivery. Omitted without the SDK method; missing bit-vector support reports an error. | For a verified current client index at an appropriate transmission phase: `const TransmitBits = g_ServerAPI.GetEntityTransmitBitsForClient(1);` Require a non-nullish object before reading `Indexes`. |
| `GetPreviousCheckTransmitInformation(Client)` | Requires a player/index-bearing object or positive index resolving to a nonfree edict, without a separate maximum-client/connectivity check. Returns `null` for a null native result, otherwise `{ Address, Kind, Client, PVSSize, PVS, TransmitEdicts, TransmitAlways, AreasNetworked, Areas, MapAreas, AreaFloodNumbers }`. `Address` is the exact native address as a `bigint`; the nullable `Client` wrapper is borrowed. Native fields, client index/class name, and both bitsets are copied before result construction. The ordinary result object defines all listed fields in order as own writable, enumerable, configurable data properties; copied arrays define their indices with the same attributes. Inherited setters and non-writable properties cannot intercept construction. These copies neither validate nor extend borrowed address lifetimes. PVS/area counts are clamped to their native storage capacities, not reported as malformed; absent transmit bitsets become empty index arrays. Omitted without the SDK method; required structure/bit-vector support may also be unavailable. | For a verified current player at the appropriate transmission phase: `const PreviousInformation = g_ServerAPI.GetPreviousCheckTransmitInformation(1);` Require a non-nullish object; do not retain or write through the native address, and do not interpret this historical sample as delivery confirmation. |
| `GetSharedEdictChangeInformation()` | Returns `null` for a null `GetSharedEdictChangeInfo()` result; otherwise `{ Address, Kind, SerialNumber, ChangeInformationCount? }` contains the exact native address as a `bigint` and copied integer fields. `Kind` is `"CSharedEdictChangeInfo"`; `ChangeInformationCount` is present only when the SDK record exposes `m_nChangeInfos`. Both available integer fields are copied before result construction. The ordinary result object defines all listed fields in order as own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable properties. Fields are not live accessors, and the copies do not validate or extend address lifetime. Omitted without the SDK method; missing change-info declarations report an error. | During a valid engine phase: `const SharedInformation = g_ServerAPI.GetSharedEdictChangeInformation();` Require a non-nullish object; do not retain or write through the native address. |
| `GetEntityChangeAccessor(Entity)` | Resolves an entity/index-bearing object or nonnegative index to a nonfree edict, then calls `GetChangeAccessor()`. A null native result becomes `null`; otherwise `{ Address, Kind, ChangeInformation, SerialNumber }` contains the exact native accessor address as a `bigint` and copied integer results from `GetChangeInfo()`/`GetChangeInfoSerialNumber()`. Both integer results are copied before result construction. The ordinary result object defines all listed fields in order as own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable properties. These fields are not live accessors or proof of address lifetime. Requires the SDK method and change-accessor declarations. | With a verified live `Entity`: `const ChangeAccessor = g_ServerAPI.GetEntityChangeAccessor(Entity.Index);` Require a non-nullish object; do not retain or write through the native address after entity/lifecycle changes. |
| `CreateSpatialPartition(WorldMinimum, WorldMaximum)` | Converts two Vector-compatible bounds and calls the engine without independently checking component ordering. A null native result becomes `null`; otherwise returns `{ Address, Kind }` with the exact native address as a `bigint` and `Kind` `"ISpatialPartition"`. A nonnull allocation stays under a temporary owner until its wrapper is returned. Reentrant public destruction of any partition still under construction on the callback thread is rejected before SDK dispatch, including outer nested constructions; the guard remains active during owning cleanup. An empty wrapper or C++ wrapping exception triggers a destruction attempt before returning `undefined` or propagating the error. Cleanup failure reports a contextual error unless an earlier JavaScript exception or termination must be preserved; a throwing SDK destructor cannot guarantee reclamation. Successfully returned address objects have no automatic native cleanup. Requires SDK spatial-partition support. | With validated, ordered world bounds and a matching `DestroySpatialPartition()` cleanup plan: `const Partition = g_ServerAPI.CreateSpatialPartition(WorldMinimum, WorldMaximum);` Check that the result is a nonnull object before reading `Address`. |
| `DestroySpatialPartition(unSpatialPartitionAddress)` | Requires a nonzero JavaScript `bigint` address fitting native `std::uintptr_t`, then calls `DestroySpatialPartition()` and returns `true`. Pass `Partition.Address`, not the wrapper itself. Addresses belonging to an active `CreateSpatialPartition()` result construction on this callback thread are rejected. Outside that narrow guard, it does not verify type, ownership, prior destruction, or lifetime, and does not clear JavaScript aliases. Destroy only a still-live partition created for this purpose, exactly once, and stop using all aliases afterward. Requires SDK spatial-partition support. | Once, for the owned `Partition` from creation above, after its final use: `const bPartitionDestructionSubmitted = Partition ? g_ServerAPI.DestroySpatialPartition(Partition.Address) : false;` |
| `DrawSpatialPartitionMapToScratchPad(unScratchPad3DAddress, unDrawFlags)` | Requires a nonzero JavaScript `bigint` address fitting native `std::uintptr_t` and converts flags with JavaScript/V8 `ToUint32`, including numeric coercion, truncation, and wrapping; conversion errors stop native dispatch. It then calls `IVEngineServer::DrawMapToScratchPad()` with an `unsigned long` conversion. Address validation proves neither a live `IScratchPad3D` nor valid SDK flag combinations. `true` reports the native call, not display completion; the scratchpad remains caller-managed and must stay alive across flag coercion, which can execute JavaScript. | With a verified live scratchpad and target-SDK drawing flags during a valid map phase: `const bPartitionMapDrawSubmitted = g_ServerAPI.DrawSpatialPartitionMapToScratchPad(unScratchPad3DAddress, unDrawFlags);` |
| `NotifySolidMoved(Entity, unCollideableAddress?, PreviousOrigin?, bTestSurroundingBoundsOnly?)` | Resolves a nonfree edict and requires a collideable. Missing/nullish optionals select the edict's collideable, no previous origin, and `false`; supplied values require a nonzero JavaScript `bigint` address fitting native `std::uintptr_t`, Vector-compatible value, and primitive boolean respectively. With a nonnullish previous origin, a full entity handle is captured before component getters/coercion; successful conversion requires that the same live entry and serial can still be resolved. A missing valid handle or changed entity prevents dispatch, while original getter errors are preserved. The edict and default collideable are refreshed after conversion. An explicit address is not checked for type, lifetime, or association with the entity and remains the caller's responsibility across conversion. Calls `SolidMoved()`; SDKs with only the three-argument overload ignore `bTestSurroundingBoundsOnly`. `true` reports the notification call, not a movement operation. | After a valid movement of a verified live `Entity`: `const bSolidMoveNotificationSubmitted = g_ServerAPI.NotifySolidMoved(Entity.Index);` |
| `NotifyTriggerMoved(Entity, bTestSurroundingBoundsOnly?)` | Resolves an entity/index-bearing object or nonnegative index to a nonfree edict, without independently verifying trigger type. Omitted/nullish `bTestSurroundingBoundsOnly` defaults to `false`; otherwise a primitive boolean is required. Calls `TriggerMoved()`; a one-argument SDK overload ignores the flag. `true` reports the notification call, not movement of the entity. | After a valid movement of a verified live trigger `Entity`: `const bTriggerMoveNotificationSubmitted = g_ServerAPI.NotifyTriggerMoved(Entity.Index);` |
| `BuildEntityClusterList(Entity, PVSInformation?)` | Requires a nonfree edict and native PVS storage. Missing/nullish storage uses the entity's networkable PVS record; an explicit value first resolves as an entity/index, then falls back to a nonzero JavaScript `bigint` PVS address fitting `std::uintptr_t`, without type/lifetime validation. Pass the direct `bigint` address, not an address wrapper. Original `Index` getter errors stop processing before address fallback or native submission. When explicit storage is object-valued, the first entity's full native handle is captured before reading the object's `Index`; successful parsing requires the same live entry and serial, then refreshes the first edict before native submission. A missing valid handle or changed first entity rejects this reentrant path. Getter/argument errors retain precedence over identity rejection. Primitive index, `bigint`, missing, and nullish storage paths do not add this handle requirement. Mutates native storage before returning `{ Address, Kind, HeadNode, ClusterCount, Area, SecondaryArea, Center, Clusters }`; `Address` is exact `bigint`, while native scalar fields, center, and bounded cluster storage are copied before result construction. The ordinary result object defines all listed fields in order as own writable, enumerable, configurable data properties; copied cluster indices have the same attributes on an ordinary array. Inherited setters and non-writable properties cannot intercept construction. These copies neither validate nor extend the borrowed address's lifetime. Wrapping failure does not undo the build. `Clusters` is capped at 65,536 entries and empty for nonpositive counts or a null cluster address; `ClusterCount` retains the native reported count. | With a verified live networkable `Entity` during an engine-approved PVS update phase: `const PVSInformation = g_ServerAPI.BuildEntityClusterList(Entity.Index);` Follow the native storage owner's cleanup protocol; do not treat the returned address as newly owned storage. |
| `CleanUpEntityClusterList(PVSInformationOrEntity)` | Resolves a networkable entity first, otherwise a nonzero JavaScript `bigint` PVS address fitting native `std::uintptr_t`, and calls the SDK's `CleanUpEntityClusterList()`. Pass the direct `bigint` address, not an address wrapper. Original `Index` getter errors stop processing before address fallback or native cleanup. The address fallback does not prove type, extent, ownership, or lifetime. `true` reports the call; copied JavaScript fields are not refreshed and native aliases may become invalid. Requires SDK PVS support. | Only when the native storage owner's lifecycle explicitly requires this cleanup, while its PVS record is still live: `const bClusterListCleanupSubmitted = g_ServerAPI.CleanUpEntityClusterList(PVSInformation.Address);` Do not repeat cleanup or free engine-owned data merely because a wrapper was returned. |
| `GetSinglePlayerSharedMemorySpace(strSharedMemoryName, nEntityIndex?)` | Requires a primitive string with a nonempty UTF-8 conversion. The native method receives its NUL-terminated prefix; embedded NUL characters are not rejected, so avoid them in names. Missing/nullish index uses `MAX_EDICTS` when declared; otherwise an explicit non-nullish value is required. A supplied index uses V8 `ToInt32` conversion, not strict integer validation; an original conversion error stops before native dispatch. No independent entity-range or single-player-mode check. Returns `null` for a null native result, otherwise `{ Address, Kind }` with the exact native address as a `bigint` and kind `"ISPSharedMemory"`; this supplies no buffer extent, layout, lifetime, or synchronization guarantee. | With a verified entity index and a known target-engine shared-memory contract: `const SharedMemory = g_ServerAPI.GetSinglePlayerSharedMemorySpace("SourceJS", Entity.Index);` Require a non-nullish object; do not dereference or free the address without that contract. |

For object-producing calls in this table, checked V8 result-construction failure can propagate a pending JavaScript exception or return `undefined` without one. Require a non-nullish object before reading fields or passing it to another operation; checking only for `null` is insufficient. `CreateEdict()` does not roll back native creation, while `CreateSpatialPartition()` attempts the owning cleanup described above.

The `Clusters` array is a copied snapshot capped at 65,536 entries even when the native `ClusterCount` is larger. Transmit-bit index arrays scan the fixed bitset; PVS/area arrays in previous-transmit results use counts clamped to the native fixed capacities. Copies do not refresh when native state changes. `Address` fields in transmit, change-info, PVS-info, and shared-memory results are exact `bigint` values referring to borrowed native storage; a nonnull wrapper or well-formed address does not prove native type, liveness, or safe dereferencing. A successfully returned `CreateSpatialPartition()` result requires caller-managed `DestroySpatialPartition()` cleanup exactly once, while the partition remains live. Never destroy a borrowed engine partition or infer ownership from an address object's shape.

`CreateEdict()` and `RemoveEdict()` are always registered. Every other export in this table, including `ForceFlushEntity()`, is omitted when its selected-SDK method capability check fails. Installed callbacks also throw when their supporting declarations are absent: `CBitVec`/`MAX_EDICTS` for transmit bits; `CCheckTransmitInfo`, `CBitVec`, and `MAX_EDICTS` for previous transmit information; edict change-info declarations for shared/change-accessor results; `ISpatialPartition` for partition creation/destruction; and `PVSInfo_t` for cluster-list operations.

Address-bearing structured returns expose exact native addresses as JavaScript `bigint` values in `Address`. Address-taking APIs such as `DestroySpatialPartition()`, `CleanUpEntityClusterList()`, and `SetAchievementManager()` accept a nonzero `bigint` fitting native `std::uintptr_t`; pass the address directly, for example `Partition.Address`, without converting it to `number` or passing the wrapper itself. Additional accepted inputs are documented per operation. `CleanUpEntityClusterList()` also accepts a networkable entity. `SetAchievementManager()` accepts an omitted or nullish value to pass a null native manager. A well-formed address does not establish native type, ownership, extent, or lifetime.

When `MAX_EDICTS` is available, omitted/nullish `nEntityIndex` in `GetSinglePlayerSharedMemorySpace()` defaults to `MAX_EDICTS`; otherwise the caller must supply an explicit index.

## Resources, sound, and presentation

| Export | Contract | Concrete use |
| --- | --- | --- |
| `IsModelPrecached(strResourceName)` | Requires a primitive string whose native NUL-terminated value is nonempty and returns `IVEngineServer::IsModelPrecached()`. Does not precache the model, verify disk contents, or establish client availability. | During a valid map phase: `const bModelPrecached = g_ServerAPI.IsModelPrecached("models/props_junk/wood_crate001a.mdl");` |
| `IsGenericPrecached(strResourceName)` | Requires a primitive string whose native NUL-terminated value is nonempty and returns `IVEngineServer::IsGenericPrecached()`. Does not precache the resource or add it to downloads. | During a valid map phase: `const bGenericPrecached = g_ServerAPI.IsGenericPrecached("scripts/sourcejs.txt");` |
| `IsDecalPrecached(strResourceName)` | Requires a primitive string whose native NUL-terminated value is nonempty and returns `IVEngineServer::IsDecalPrecached()`. Does not precache, apply, or download the decal. | During a valid map phase: `const bDecalPrecached = g_ServerAPI.IsDecalPrecached("decals/blood1");` |
| `PrecacheModel(strModelPath, bPreload?)` | Requires a primitive string with a nonempty native NUL-terminated path and returns the native integer model index unchanged. Omitted/`undefined` `bPreload` defaults to `false`; otherwise a primitive boolean is required. The TF2 SDK uses zero for failure. This does not add downloads or guarantee client availability. | During the permitted precache phase: `const nModelIndex = g_ServerAPI.PrecacheModel("models/props_junk/wood_crate001a.mdl", true);` Check the target SDK's failure sentinel before using the index. |
| `PrecacheGeneric(strFilePath, bPreload?)` | Requires a primitive string with a nonempty native NUL-terminated path and returns `IVEngineServer::PrecacheGeneric()`'s integer unchanged. Omitted/`undefined` `bPreload` defaults to `false`; otherwise a primitive boolean is required. Generic indices are not model indices: do not infer failure from zero without the target SDK contract. This callback does not add a download entry. | During the permitted precache phase: `const nGenericIndex = g_ServerAPI.PrecacheGeneric("scripts/sourcejs.txt", true);` Validate the native result before using it. |
| `PrecacheDecal(strDecalName, bPreload?)` | Requires a primitive string with a nonempty native NUL-terminated name and returns `IVEngineServer::PrecacheDecal()`'s integer unchanged. Omitted/`undefined` `bPreload` defaults to `false`; otherwise a primitive boolean is required. Decal indices are not model indices: zero is not a universal failure sentinel. This does not apply the decal or add downloads. | During the permitted precache phase: `const nDecalIndex = g_ServerAPI.PrecacheDecal("decals/blood1", true);` Validate the result using the target SDK's decal contract. |
| `PrecacheSound(strSample, bPreload?, bUISound?)` | Requires a primitive string with a nonempty native NUL-terminated sample and returns the `IEngineSound::PrecacheSound()` boolean, not an index. Omitted/`undefined` optionals default to `false`; other values must be primitive booleans. Old-console SDKs validate but ignore `bIsUISound`; missing `IEngineSound` reports an error. Does not play the sound or add downloads. | During the permitted precache phase: `const bSoundPrecached = g_ServerAPI.PrecacheSound("ui/buttonclick.wav", true, true);` Handle `false` before attempting playback. |
| `IsSoundPrecached(strSample)` | Requires a primitive string with a nonempty native NUL-terminated sample and returns `IEngineSound::IsSoundPrecached()`, without precaching or playing it. With a ready sound interface, omission returns `undefined`; interface availability is checked first and may throw even without an argument. | During a valid map phase: `const bSoundPrecached = g_ServerAPI.IsSoundPrecached("ui/buttonclick.wav");` This does not establish download or playback completion. |
| `PrefetchSound(strSample)` | Requires a primitive string with a nonempty native NUL-terminated sample and calls `IEngineSound::PrefetchSound()`. `true` reports submission, not completed loading; no completion callback or promise is returned. With a ready sound interface, omission returns `undefined`; availability checks can throw first. | During an appropriate resource-loading phase: `const bSoundPrefetchSubmitted = g_ServerAPI.PrefetchSound("ui/buttonclick.wav");` Do not use this result as playback readiness. |
| `IsLoopingSound(strSample)` | Requires a primitive string with a nonempty native NUL-terminated sample and returns the engine's looping-state boolean; does not start playback. With a ready sound interface, omission returns `undefined`, but availability checks can throw first. Omitted when the selected SDK lacks the method; missing `IEngineSound` reports an error. | During a valid resource phase: `const bLooping = g_ServerAPI.IsLoopingSound("ambient/alarms/klaxon1.wav");` Do not interpret this as proof that the sound is currently playing. |
| `GetSoundDuration(strSample)` | Requires a primitive string with a nonempty native NUL-terminated sample and returns the engine's duration in seconds without validating positivity or finiteness. With a ready sound interface, omission returns `undefined`; availability checks can throw first. This is not remaining playback time or completion notification. | During a valid resource phase: `const flSoundDuration = g_ServerAPI.GetSoundDuration("ui/buttonclick.wav");` Validate the result before using it in timing calculations. |
| `EmitSound(SoundOptions)` | Requires exactly one non-array options object using the [engines/sound options](engines-sound.md). `true` reports a supported native emission call, not receipt, audibility, or playback completion. Missing `IEngineSound` or an unsupported emission overload reports an error; preserve the exact public option keys. | With the sample precached and recipient/entity 1 verified for the current engine phase: `const bSoundEmissionSubmitted = g_ServerAPI.EmitSound({ Recipients: [1], Sample: "ui/buttonclick.wav", Entity: 1 });` |
| `StopSound(SoundOptions)` | Requires exactly one non-array [sound options object](engines-sound.md) with a nonempty native sample string, then calls `IEngineSound::StopSound()` for the resolved entity/channel/sample. Uses sound-entry hash zero on SDKs requiring that argument. `true` reports the call, not proof that a matching sound existed or stopped; missing `IEngineSound` reports an error. | For the same verified entity, channel, and sample used for emission: `const bSoundStopSubmitted = g_ServerAPI.StopSound({ Channel: 0, Sample: "ui/buttonclick.wav", Entity: 1 });` |
| `EmitAmbientSound(EntityOrIndex, Position, strSample, flVolume, nSoundLevel, nFlags, nPitch, flDelay?)` | Requires seven arguments: an entity or index resolving to a nonnegative index, a Vector-compatible position, a primitive sample string with a nonempty full UTF-8 conversion, finite native-float volume, and V8 `ToInt32` conversions for sound level, flags, and pitch (including coercion, truncation, and wrapping). Sound level must be in the SDK's regular `0`–`255` range before conversion to `soundlevel_t`; GoldSrc compatibility codes `256`–`511` are not accepted. The native sample is its prefix before the first NUL; embedded NUL is not rejected, so this prefix can be empty even when the full conversion is nonempty. Omitted or nullish delay defaults to `0`; otherwise it must convert to a finite native float. Original entity/vector getter and numeric-conversion errors propagate before sound submission. The binding does not establish entity liveness or validate other SDK-specific sound parameter ranges. `true` reports the native call, not client receipt or completed playback. | With a precached sample and parameters valid for the selected SDK: `const bAmbientSoundSubmitted = g_ServerAPI.EmitAmbientSound(0, { X: 0, Y: 0, Z: 0 }, "ambient/alarms/klaxon1.wav", 0.8, 75, 0, 100, 0);` |
| `ForceExactFile(strFilePath)` | Requires a primitive string whose native UTF-8 prefix before any NUL is nonempty, then calls `IVEngineServer::ForceExactFile()`. TF2's SDK requires marking the file after precaching it. `true` reports the call, not a completed consistency check or file transfer; missing engine interface reports an error. | After precaching the file in the appropriate SDK lifecycle phase: `const bConsistencyCheckRequested = g_ServerAPI.ForceExactFile("materials/sourcejs/status.vmt");` |
| `ForceSimpleMaterial(strMaterialName)` | Requires a primitive string whose native UTF-8 prefix before any NUL is nonempty, then calls `IVEngineServer::ForceSimpleMaterial()`. TF2's SDK marks the VMT for consistency checking: differing client content is restricted to `VertexLitGeneric` with only `$baseTexture` and `$bumpmap` variables. `true` reports the call, not completed client validation or a material rewrite; missing engine interface reports an error. | With a material name and lifecycle phase valid for the selected SDK: `const bMaterialConsistencyCheckRequested = g_ServerAPI.ForceSimpleMaterial("sourcejs/status");` |
| `ForceModelBounds(strModelPath, ModelMinimums, ModelMaximums)` | Requires a primitive string with a nonempty native UTF-8 prefix before any NUL and two Vector-compatible bounds, then calls `IVEngineServer::ForceModelBounds()`. The binding does not check minimum/maximum ordering or model availability. `true` reports the call, not readback of changed model geometry; missing engine interface reports an error. | With ordered bounds and a model valid for the selected SDK lifecycle: `const bModelBoundsSubmitted = g_ServerAPI.ForceModelBounds("models/props_junk/wood_crate001a.mdl", { X: -16, Y: -16, Z: -16 }, { X: 16, Y: 16, Z: 16 });` |
| `PlayTemporaryEntity(strTemporaryEntityName, PropertyValues?, Recipients?, flDelay?, bReliable?)` | Uses the same native callback as [`effects.CreateTempEntity()`](effects.md): resolves a nonempty native template name and prepares zero-initialized sender storage. Omitted/nullish `PropertyValues` leave it unchanged; otherwise this must be an object whose own properties are resolved and applied, with errors for unknown or invalid properties. `Recipients` accepts a player/recipient value, an array of recipient values, or a filter object with a `RecipientIndexes` array; omission or `null`/`undefined` selects all current players, including bots. Omitted/nullish delay and reliability default to `0` and `false`. Other delays must convert to finite native floats; reliability must be a primitive boolean. `true` reports submission, not client receipt or rendering. | With a supported template and verified current recipients: `const bTemporaryEntitySubmitted = g_ServerAPI.PlayTemporaryEntity("BeamPoints", {}, [1, 2], 0, true);` |
| `GetTextMessage(strTextMessageName)` | Requires a primitive string with a nonempty native UTF-8 prefix before any NUL. Returns `null` for no native message, or copied `{ Effect, ColorOne, ColorTwo, X, Y, FadeIn, FadeOut, HoldTime, EffectTime, FontName, Name, Message }` data with `{ Red, Green, Blue, Alpha }` colors. Builds without `SOURCEJS_OLD_CONSOLE_API` also copy `RoundedBackdrop`, `BoxSize`, `BoxColor`, and `ClearMessage`. Native fields and strings are copied before result construction. The result and nested colors retain ordinary object prototypes; fields are created in the listed order as own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable properties. Null native string fields become empty strings; modifying the returned object does not update the engine or display a message. The export is omitted when the SDK method is unavailable; an installed callback throws without `client_textmessage_t` support or the required engine interface. | `const TextMessage = g_ServerAPI.GetTextMessage("Game_connected");` Require a non-nullish object before reading its fields. |
| `SetLightStyle(nLightStyle, strLightPattern)` | Game-thread only. Requires an index and a primitive string, including an empty pattern. The index uses V8 `ToInt32` conversion, including coercion, truncation, and wrapping. String conversion keeps only the UTF-8 prefix before the first NUL. Copies that prefix and its terminator into immutable process-lifetime OS storage before calling `IVEngineServer::LightStyle()`, whose input address must remain stable. Identical converted prefixes reuse a cached address; distinct prefixes retain page-rounded storage until process exit, including after context or module unload. Avoid unbounded generation of unique patterns. Length or allocation failure reports an error before native dispatch. The binding does not validate the SDK's light-style index range or pattern grammar. `true` reports the call, not client rendering or readback; missing engine interface reports an error. | With index 32 available for this map and a pattern valid for the selected SDK: `const bLightStyleSubmitted = g_ServerAPI.SetLightStyle(32, "mmamammmmammamamaaamammma");` |
| `PlaceStaticDecal(Origin, nDecalIndex, nEntityIndex, nModelIndex, bLowPriority?)` | Requires a Vector-compatible origin and three index arguments; each index uses V8 `ToInt32` conversion, including coercion, truncation, and wrapping, before calling `IVEngineServer::StaticDecal()`. Omitted/nullish priority defaults to `false`; any other value must be a primitive boolean. The binding does not validate index ranges, resource availability, or entity/model correspondence. `true` reports the call, not confirmed client rendering; missing engine interface reports an error. | With an origin and indices verified for the current map, resources, and selected SDK: `const bStaticDecalSubmitted = g_ServerAPI.PlaceStaticDecal({ X: 0, Y: 0, Z: 0 }, 0, 1, 0, false);` |
| `SetClientViewEntity(ClientEntity, ViewEntity)` | Resolves both arguments through the entity-edict resolver, rejecting null results, then calls `IVEngineServer::SetView()`. When `ViewEntity` is an object, the callback copies the client's full entry/serial handle before looking up the view edict, then revalidates that identity and fetches a fresh client edict before `SetView()`. A missing initial identity or a removed/replaced client is rejected only after successful view lookup, preserving the original lookup error. Primitive view-entity inputs retain the original path without a new client-handle requirement. This is not a lifetime pin and does not separately establish a connected client. `true` reports the call, not client receipt or rendering; missing engine interface reports an error. | With a verified current client at index 1 and a live view entity at index 2: `const bClientViewSubmitted = g_ServerAPI.SetClientViewEntity(1, 2);` Keep the view entity valid for the engine's required lifetime. |
| `SetClientCrosshairAngle(ClientEntity, flPitch, flYaw)` | Resolves a non-null entity edict and converts both angles to finite native floats, then calls `IVEngineServer::CrosshairAngle()`. If either angle is object-valued, the callback copies the client's full entry/serial handle before numeric conversion, then revalidates that identity and fetches a fresh client edict after both conversions succeed. A missing initial identity or a removed/replaced client is rejected after conversion; original conversion errors and pitch-before-yaw order are preserved. Primitive arguments retain the original path without a new client-handle requirement. This is not a lifetime pin and does not separately verify a connected client or normalize/check SDK-specific angle ranges. `true` reports the call, not client receipt or displayed crosshair state; missing engine interface reports an error. | With a verified current client at index 1 and angles valid for the selected SDK: `const bCrosshairAngleSubmitted = g_ServerAPI.SetClientCrosshairAngle(1, 0, 90);` |
| `SetNetworkStringTablesLocked(bNetworkStringTablesLocked)` | Requires a primitive boolean, calls `IVEngineServer::LockNetworkStringTables()`, and returns the previous lock state, not a success flag. Missing, nullish, or non-boolean arguments are rejected; missing engine interface reports an error. Temporary changes must restore the returned state on every exit, as required by the SDK. This is engine table state, not a JavaScript mutex. | To begin a scoped change: `const bWereStringTablesLocked = g_ServerAPI.SetNetworkStringTablesLocked(true);` Restore it in `finally` with `g_ServerAPI.SetNetworkStringTablesLocked(bWereStringTablesLocked);`. |
| `PickSentenceFromGroup(nSentenceGroupIndex)` | Requires a group-index argument, converts it with V8 `ToInt32` (including coercion, truncation, and wrapping), and calls `IVEngineServer::SentenceGroupPick()` with a zero-initialized 256-byte name buffer. Rejects an unterminated buffer before constructing the result or reading the name as a C string. Otherwise returns an ordinary `{ Index, Name }` object, defining both fields in that order as own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable properties. Native failure indices are not converted to `null` or an exception; an empty name remains empty. The binding does not validate group existence and does not play the selected sentence; missing engine interface reports an error. | For a verified current sentence group: `const Sentence = g_ServerAPI.PickSentenceFromGroup(1);` Check the selected SDK's result contract before using `Sentence.Index` or `Sentence.Name`. |
| `PickSequentialSentenceFromGroup(nSentenceGroupIndex, nSentenceIndex, bResetSequence?)` | Requires two index arguments, converts both with V8 `ToInt32` (including coercion, truncation, and wrapping), and passes them to `IVEngineServer::SentenceGroupPickSequential()` with a zero-initialized 256-byte name buffer. Omitted/nullish `bResetSequence` defaults to `false`; other values must be primitive booleans. Rejects an unterminated buffer before constructing the result or reading the name as a C string. Otherwise returns an ordinary `{ Index, Name }` object, defining both fields in that order as own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable properties. Native failure indices are not translated; an empty name remains empty. Group membership, cursor semantics, and sequence completion follow the selected SDK; the binding does not validate them or play audio. Missing engine interface reports an error. | With a verified group and sequence cursor: `const NextSentence = g_ServerAPI.PickSequentialSentenceFromGroup(1, 0, false);` Interpret `NextSentence.Index` and `NextSentence.Name` using that SDK's sequence contract. |
| `GetSentenceIndexFromName(strSentenceName)` | Requires a primitive string with a nonempty native UTF-8 prefix before any NUL, then returns `IVEngineServer::SentenceIndexFromName()`'s signed result unchanged, including its failure sentinel. This lookup does not play a sentence; missing engine interface reports an error. | `const nSentenceIndex = g_ServerAPI.GetSentenceIndexFromName("CITIZEN_STOP");` Check the selected SDK's failure sentinel before using the index. |
| `GetSentenceNameFromIndex(nSentenceIndex)` | Requires an index argument, applies V8 `ToInt32` conversion (including coercion, truncation, and wrapping), and calls `IVEngineServer::SentenceNameFromIndex()` without validating sentence-table membership. Returns a copied string, or `null` when the native result is null; an empty native string remains empty. Missing engine interface reports an error. | With a verified current sentence index: `const strSentenceName = g_ServerAPI.GetSentenceNameFromIndex(0);` Require a string before using string methods. |
| `GetSentenceGroupIndexFromName(strSentenceGroupName)` | Requires a primitive string with a nonempty native UTF-8 prefix before any NUL, then returns `IVEngineServer::SentenceGroupIndexFromName()`'s signed result unchanged, including its failure sentinel. This looks up a group, not an individual sentence, and does not play audio; missing engine interface reports an error. | `const nSentenceGroupIndex = g_ServerAPI.GetSentenceGroupIndexFromName("CITIZEN");` Check the selected SDK's failure sentinel before using the group index. |
| `GetSentenceGroupNameFromIndex(nSentenceGroupIndex)` | Requires a group-index argument, applies V8 `ToInt32` conversion (including coercion, truncation, and wrapping), and calls `IVEngineServer::SentenceGroupNameFromIndex()` without validating group-table membership. Returns a copied string, or `null` when the native result is null; an empty native string remains empty. Missing engine interface reports an error. | With a verified current group index: `const strSentenceGroupName = g_ServerAPI.GetSentenceGroupNameFromIndex(1);` Require a string before using string methods. |
| `GetSentenceDuration(nSentenceIndex)` | Requires an index argument, applies V8 `ToInt32` conversion (including coercion, truncation, and wrapping), and returns the native float from `IVEngineServer::SentenceLength()` unchanged. The binding does not validate sentence-table membership, result finiteness, or positivity. This is a duration lookup, not remaining playback time or a completion signal; missing engine interface reports an error. | With a verified current sentence index: `const flSentenceDuration = g_ServerAPI.GetSentenceDuration(0);` Validate the result against the selected SDK's duration contract before using it for timing. |

Checked V8 result-construction failures in `GetTextMessage`, both sentence-picking calls, and both sentence-name queries can propagate a pending JavaScript exception or return `undefined` without one. Validate the expected object or string before using its members; a missing result does not undo a completed native query or selection. See [`engines/sound`](engines-sound.md) for the complete sound option object and channel/flag constants.

## Platform and branch capabilities

| Export | Contract | Concrete use |
| --- | --- | --- |
| `IsLevelMainMenuBackground()` | Returns the engine's current main-menu background-level flag. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error, not `false`. | `const bMainMenuBackground = g_ServerAPI.IsLevelMainMenuBackground();` |
| `IsAnyClientLowViolence()` | Returns the engine's boolean query for whether any client is low-violence, not a client list or permission decision. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const bAnyClientLowViolence = g_ServerAPI.IsAnyClientLowViolence();` |
| `IsOverrideLoadGameEntitiesEnabled()` | Returns `IVEngineServer::IsOverrideLoadGameEntsOn()` without changing the override state. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const bLoadGameEntitiesOverrideEnabled = g_ServerAPI.IsOverrideLoadGameEntitiesEnabled();` |
| `IsCreatingResourceList()` | Returns `IVEngineServer::IsCreatingReslist()` without starting generation or waiting for completion. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const bCreatingResourceList = g_ServerAPI.IsCreatingResourceList();` |
| `IsCreatingXboxResourceList()` | Returns `IVEngineServer::IsCreatingXboxReslist()` without starting generation or waiting for completion. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const bCreatingXboxResourceList = g_ServerAPI.IsCreatingXboxResourceList();` |
| `IsDedicatedServerForXbox()` | Returns the engine's Xbox dedicated-server flag without changing server mode. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const bDedicatedServerForXbox = g_ServerAPI.IsDedicatedServerForXbox();` |
| `IsDedicatedServerForPS3()` | Returns the engine's PS3 dedicated-server flag without changing server mode. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const bDedicatedServerForPS3 = g_ServerAPI.IsDedicatedServerForPS3();` |
| `IsLowViolence()` | Returns the engine's low-violence flag without changing it; this is distinct from `IsAnyClientLowViolence()`. Omitted when the selected SDK lacks the method. An installed callback reports an unsupported-operation error under `SOURCEJS_OLD_CONSOLE_API`; missing runtime engine interface also reports an error, not `false`. | `const bLowViolence = g_ServerAPI.IsLowViolence();` |
| `IsEngineLogEnabled()` | Returns `IVEngineServer::IsLogEnabled()` without enabling logging or confirming that any particular message was written. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error, not `false`. | `const bEngineLogEnabled = g_ServerAPI.IsEngineLogEnabled();` |
| `IsApplicationActive()` | Returns `IVEngineServer::IsActiveApp()` without changing application state. This is the engine's application flag, not a server-readiness or client-connectivity check. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error, not `false`. | `const bApplicationActive = g_ServerAPI.IsApplicationActive();` |
| `SetDedicatedServerBenchmarkMode(bBenchmarkModeEnabled)` | Requires a primitive boolean and calls `IVEngineServer::SetDedicatedServerBenchmarkMode()`. Missing/nullish/non-boolean arguments are rejected. `true` reports the call, not a benchmark result or mode readback. Omitted when the selected SDK lacks the method; an installed old-console callback reports unsupported operation, and missing runtime engine interface reports an error. | In a controlled benchmark session with an explicit restoration plan: `const bBenchmarkModeSubmitted = g_ServerAPI.SetDedicatedServerBenchmarkMode(true);` The return value is not the previous mode. |
| `SetNoClipEnabled(bNoClipEnabled)` | Requires a primitive boolean and calls `IVEngineServer::SetNoClipEnabled()`; missing/nullish/non-boolean arguments are rejected. `true` reports the call, not the previous state or a particular player's movement mode. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | When intentionally changing engine no-clip availability: `const bNoClipChangeSubmitted = g_ServerAPI.SetNoClipEnabled(false);` Temporary changes need an explicit restoration plan; the return value does not provide the previous setting. |
| `GetAchievementManager()` | Calls `IVEngineServer::GetAchievementMgr()` and returns `null` for a null native result, otherwise an ordinary `{ Address, Kind: "IAchievementMgr" }` wrapper whose `Address` is an exact `bigint`. The native manager is borrowed: this wrapper neither owns it nor keeps it alive. Neither the address nor the `Kind` label proves continued validity or ownership. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const AchievementManager = g_ServerAPI.GetAchievementManager();` Require a non-nullish object; checked wrapper-construction failure can return `undefined` without a pending exception; do not free the borrowed manager or retain its address beyond its native lifetime. |
| `SetAchievementManager(unAchievementManagerAddress?)` | Passes a nonzero `bigint` address representable by the native address width to `IVEngineServer::SetAchievementMgr()`, or passes native null when omitted/nullish. The binding does not verify that the address denotes a live `IAchievementMgr` or validate ownership/lifetime. `true` reports the call, not the previous manager or verified installation. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | Only with an independently verified live manager address and the SDK's ownership/lifetime contract established: `const AchievementManager = g_ServerAPI.GetAchievementManager(); const bAchievementManagerSubmitted = AchievementManager ? g_ServerAPI.SetAchievementManager(AchievementManager.Address) : false;` Clearing with `null` must be intentional, not a fallback for a failed lookup. |
| `HasPaintMap()` | Returns `IVEngineServer::HasPaintmap()` without loading, modifying, or returning paint-map data. The boolean is not proof that a particular surface has been painted. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error, not `false`. | `const bHasPaintMap = g_ServerAPI.HasPaintMap();` |
| `RemoveAllPaint()` | Calls `IVEngineServer::RemoveAllPaint()` with no per-entity or per-surface filter. `true` reports the call, not readback of cleared data or client rendering. The binding supplies no undo state. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | Only when intentionally clearing all paint covered by the engine operation: `const bPaintRemovalSubmitted = g_ServerAPI.RemoveAllPaint();` |
| `PaintAllSurfaces(unPaintColorValue)` | Applies V8 `ToUint32` conversion and requires its result to be from `0` through `255`, then passes it as an unsigned byte to `IVEngineServer::PaintAllSurfaces()`. This is not strict validation of the original input; an original conversion error stops before native dispatch. Byte-range validation does not establish an SDK-specific paint-color meaning. `true` reports the unfiltered native call, not readback or client rendering. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | When intentionally painting all surfaces covered by the engine operation, with a declared SDK-valid color: `const bSurfacePaintingSubmitted = g_ServerAPI.PaintAllSurfaces(128);` |
| `GetPaintMapDataRLE()` | Calls `IVEngineServer::GetPaintmapDataRLE()` and copies its output into a JavaScript array of unsigned 32-bit integer values. The ordinary array defines each copied index as an own writable, enumerable, configurable data property, bypassing inherited setters and non-writable properties. An empty native vector produces `[]`. A negative native count or checked V8 result-construction failure can return `undefined` without a pending exception; validate the result as an array before reuse. This is encoded data, not decoded surface colors or a live view; editing the array does not update the engine. Cross-map or cross-SDK compatibility is not established by the binding. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const vecPaintData = g_ServerAPI.GetPaintMapDataRLE();` Preserve the originating map and SDK context if retaining the data for later use. |
| `LoadPaintMapDataRLE(vecPaintMapDataRLE)` | Requires a JavaScript array whose length fits the SDK's signed `int` count and native buffer byte-size representation. It reserves native storage, checks the base of a nonempty buffer, and applies V8 `ToUint32` conversion to each entry before calling `IVEngineServer::LoadPaintmapDataRLE()`. These are conversion/representation checks, not strict validation of original element types or RLE structure, decoded size, or map/SDK compatibility. Fatal SDK-allocator or V8 OOM failures are not guaranteed to be recoverable. Original entry-getter/conversion errors stop before the loader; an empty array still reaches it. `true` reports the call, not validated decoding, readback, or client rendering. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | Only with trusted, schema-valid RLE data compatible with the current map and SDK: `const vecPaintData = g_ServerAPI.GetPaintMapDataRLE(); const bPaintDataLoadSubmitted = Array.isArray(vecPaintData) ? g_ServerAPI.LoadPaintMapDataRLE(vecPaintData) : false;` Do not treat arbitrary uint32 arrays as safe paint data. |
| `GetChoreographySoundLatency()` | Returns the native float from `IVEngineServer::GetLatencyForChoreoSounds()` without validating finiteness or range. This is the engine's choreography-sound latency query, not a per-client ping measurement or playback-completion signal. Omitted when the selected SDK lacks the method; missing runtime engine interface reports an error. | `const flChoreographySoundLatency = g_ServerAPI.GetChoreographySoundLatency();` Interpret units and validate the result using the selected SDK's contract before using it for timing. |

Every export in this table is omitted when its selected-SDK capability check fails.

## Returned object contracts

### Player information

`GetPlayerInformation(Player)` returns `null` or a copied object with `Name`, `UserID`, `GUID`, `FriendsID`, `FriendsName`, `IsFakePlayer`, `IsHLTV`, `FilesDownloaded`, and `CustomFiles`. `CustomFiles` is a copied numeric array, not file contents or paths. SDK records containing `xuid` also expose `XUID` as an unsigned 64-bit `bigint`; records containing `isreplay` expose `IsReplay` as a boolean. The result retains the ordinary object prototype and creates the listed fields, then available SDK additions, in that order as own writable, enumerable, configurable data properties. Custom-file indices have the same data-property attributes on an ordinary array; inherited setters and non-writable properties cannot intercept construction. Preserve these exact public property names. Checked V8 result-construction failure can propagate a pending JavaScript exception or return `undefined` without one. Require a non-nullish object before accessing fields; changing the result does not modify the player, and this snapshot does not establish continued entity identity or authentication.

### Steam IDs

`GetClientSteamID(PlayerOrIndex, bValidatedOnly?)` and `GetGameServerSteamID()` return `null` or a copied object with numeric `AccountID`, integer `AccountInstance`, integer `AccountType`, integer `Universe`, `bigint` `StaticAccountKey`, `bigint` `Value`, and boolean `Valid`. Preserve these exact public keys and keep the 64-bit values as `bigint` rather than converting them to potentially imprecise numbers. The client call requires a player index from `1` through the current native `maxClients`, resolving to a non-free edict. Omitted/nullish `bValidatedOnly` defaults to `false`; any other supplied value must be a primitive boolean, even when an SDK overload without that parameter ignores it. Each export is omitted when its method is unavailable in the selected SDK; if installed without `steam/steamclientpublic.h` support, its callback throws. `Valid` copies `CSteamID::IsValid()`, not a permission decision or proof of current client authentication. Require a non-nullish object before reading fields; modifying this snapshot does not update native identity. See [`steam`](steam.md) for account-type, universe, and construction semantics.

Both callbacks copy the native `CSteamID` value before allocating the JavaScript result. The result retains the ordinary object prototype and creates the listed fields in that order as own writable, enumerable, configurable data properties. Inherited setters and non-writable properties cannot intercept construction. The callbacks preserve JavaScript field-construction errors and translate C++ exceptions into operation-specific errors without replacing an already pending JavaScript error or termination. A checked result-construction failure without a pending exception can instead return `undefined`. Failed `Index` reads stop the client callback before edict lookup; successful snapshots remain detached copies and do not retain the native owner.

### Network information

`GetPlayerNetworkChannelInformation(nPlayerIndex)` returns `null` or a live native view with `PlayerIndex`, exact `bigint` `Address`, `Name`, `RemoteAddress`, `Time`, `TimeConnected`, `BufferSize`, writable `DataRate`, `Loopback`, `TimingOut`, `Playback`, `LatencyOutgoing`, `LatencyIncoming`, `AverageLatencyOutgoing`, `AverageLatencyIncoming`, `AverageLossOutgoing`, `AverageLossIncoming`, `AverageChokeOutgoing`, `AverageChokeIncoming`, `AverageDataOutgoing`, `AverageDataIncoming`, `AveragePacketsOutgoing`, `AveragePacketsIncoming`, `TotalDataOutgoing`, `TotalDataIncoming`, `SequenceOutgoing`, `SequenceIncoming`, `TimeSinceLastReceived`, and exact `bigint` `NetworkChannelAddress`. Optional `TotalPacketsOutgoing` and `TotalPacketsIncoming` fields appear only when declared by the selected SDK. `PlayerIndex` and `Address` are copied metadata; the native accessors resolve the receiver's current address on each read. Unlike the nullable snapshot builders, this callback translates checked result-construction failure into an error when no JavaScript exception is already pending and execution is not terminating.

Import `NetChannel` and `NetChannelInfo` directly from [`netchannel`](netchannel.md). With a declared, non-null `PlayerNetworkInformation` result, `NetChannelInfo.CreateNetChannelInfoFromAddress(PlayerNetworkInformation.Address)` wraps the same `INetChannelInfo*`; `NetChannel.CreateNetChannelFromAddress(PlayerNetworkInformation.NetworkChannelAddress)` instead wraps the underlying concrete channel. Preserve the exact public property names. These fields are exact, nonzero `bigint` native addresses. The package factories accept positive `bigint` values but do not validate native width, type, ownership, or lifetime; pass only these known engine-owned values. Neither wrapper keeps the channel alive: do not access either view after disconnect, native destruction, or slot reuse, and do not use a getter on a potentially stale view to test whether it is safe. On the server-returned view, assigning `DataRate` resolves its address before converting a finite, float-range numeric value. That conversion can execute JavaScript; the caller must keep the original channel alive throughout it. The setter does not pin or revalidate native lifetime after conversion.

### Text messages

`GetTextMessage(strTextMessageName)` returns `null` or a copied object with `Effect`, `{ Red, Green, Blue, Alpha }` objects in `ColorOne` and `ColorTwo`, `X`, `Y`, `FadeIn`, `FadeOut`, `HoldTime`, `EffectTime`, `FontName`, `Name`, and `Message`. Builds without `SOURCEJS_OLD_CONSOLE_API` additionally return `RoundedBackdrop`, `BoxSize`, RGBA `BoxColor`, and `ClearMessage`. Native fields and strings are copied before result construction. The result and nested colors retain ordinary object prototypes; fields are created in the listed order as own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable properties. Null native string fields become empty strings. Checked result-construction failure can propagate a pending exception or return `undefined` without one. Require a non-nullish object before accessing fields; modifying the object neither changes the native message nor displays it. Property spellings are public contracts and remain unchanged.

### Transmission and PVS records

The calls below copy scalar/array fields into JavaScript objects and include a non-owning exact `bigint` address of the native record. A nested `Client` record copies `Kind`, `Address`, `Index`, and `ClassName`, but its address still borrows the native edict; it is not a copy of the native entity. Checked result-construction failures can propagate a pending exception or return `undefined` without one; require a non-nullish result before reading its fields. A failed wrapper does not undo an already completed cluster-list build. Call the API again with valid current inputs when fresh copied fields matter; neither an old address nor a new wrapper establishes native lifetime, ownership, or completed network delivery.

- `GetEntityTransmitBitsForClient(nClientIndex)` returns `null` or an address object with exact `bigint` `Address`, string `Kind`, `MaximumBits`, and `Indexes`. Native bits are copied before filling the ordinary result object and index array with own writable, enumerable, configurable data properties; inherited setters and non-writable properties cannot intercept those writes. This copy neither validates nor extends the borrowed address's native lifetime.
- `GetPreviousCheckTransmitInformation(Client)` returns `null` or an address object with exact `bigint` `Address`, string `Kind`, nullable borrowed `Client`, `PVSSize`, `PVS`, `TransmitEdicts`, `TransmitAlways`, `AreasNetworked`, `Areas`, `MapAreas`, and `AreaFloodNumbers`. Native fields, client index/class name, and both bitsets are copied before result construction. The ordinary result object defines all listed fields in order as own writable, enumerable, configurable data properties; copied arrays define their indices with the same attributes. Inherited setters and non-writable properties cannot intercept construction. These copies neither validate nor extend borrowed address lifetimes. The arrays are copies; reported PVS/area counts are clamped to native field capacities, as described in the API table, rather than rejected when out of range.
- `GetSharedEdictChangeInformation()` returns `null` or an address object with exact `bigint` `Address`, string `Kind`, `SerialNumber`, and optional `ChangeInformationCount`. The ordinary result object defines all listed fields in order as own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable properties. Values are copies; the address remains borrowed and its lifetime is not extended.
- `GetEntityChangeAccessor(Entity)` returns `null` or an address object with exact `bigint` `Address`, string `Kind`, `ChangeInformation`, and `SerialNumber`. The ordinary result object defines all listed fields in order as own writable, enumerable, configurable data properties, bypassing inherited setters and non-writable properties. Values are copies; the address remains borrowed and its lifetime is not extended.
- `BuildEntityClusterList(Entity, PVSInformation?)` returns an address object with exact `bigint` `Address`, string `Kind`, `HeadNode`, `ClusterCount`, `Area`, `SecondaryArea`, `Center`, and `Clusters`; the optional value resolves through a networkable entity or a nonzero native-width `bigint` `PVSInfo_t` address. The address borrows the native record; native scalar fields, center, and bounded cluster storage are copied before result construction. The ordinary result object defines all listed fields in order as own writable, enumerable, configurable data properties; copied cluster indices have the same attributes on an ordinary array. Inherited setters and non-writable properties cannot intercept construction. This transfers no native ownership and neither validates nor extends the borrowed address's lifetime.

`GetPreviousCheckTransmitInformation(Client)` requires a nonzero player index resolving to a non-free edict, not the zero-based `IClient.Index`. `Clusters` contains at most 65,536 copied entries even if `ClusterCount` is larger, and is empty when the reported count is nonpositive or native cluster storage is null. Do not infer readable native extent from that count. Call `CleanUpEntityClusterList()` only when the native owner's lifecycle requires it, not merely because a wrapper was returned. For the returned PVS wrapper, pass its `bigint` `.Address`, not the wrapper itself; cleanup also accepts a resolvable networkable entity. Cleanup does not refresh copied fields or make retained addresses safe.

## Practical workflows

### Inspect realtime server and client state

```js
const { GetGlobalVariables, GetServer } = require("engines/server");
const { LogInfo } = require("loggers");
const { NET_FLOW, NetChannel } = require("netchannel");

if (typeof GetServer !== "function") {
	throw new Error("This SDK does not expose the native IServer wrapper.");
}

const g_GlobalVariables = GetGlobalVariables();
const g_Server = GetServer();
if (!g_Server) {
	throw new Error("The native IServer wrapper is not available.");
}

if (g_Server.GetAllocatedClientCount() <= 0) {
	throw new Error("Client slot 0 is not allocated.");
}

const g_Client = g_Server.GetClient(0);
if (!g_Client || !g_Client.Connected) {
	throw new Error("Client slot 0 is not connected.");
}

const g_unNetworkChannelAddress = g_Client.NetworkChannelAddress;
if ((typeof g_unNetworkChannelAddress !== "bigint") || (g_unNetworkChannelAddress <= 0n)) {
	throw new Error("Client slot 0 does not expose a valid network-channel address.");
}

// Use fresh wrappers synchronously while the native client/channel remain valid.
const g_NetChannelInstance = NetChannel.CreateNetChannelFromAddress(g_unNetworkChannelAddress);
LogInfo("%j", {
	CurrentTime: g_GlobalVariables.CurrentTime,
	IncomingLatency: g_NetChannelInstance.GetNetChannelLatency(NET_FLOW.Incoming),
	TickCount: g_GlobalVariables.TickCount,
	UserID: g_Client.UserID,
	ClientName: g_Client.Name,
	MapName: g_GlobalVariables.MapName,
	ServerName: g_Server.GetServerName(),
});
```

### Apply and restore writable native state

`IServer.GetServerTimescale()` and `IServer.SetServerTimescale()` are installed on every available `IServer` wrapper. On SDK branches whose `IServer` interface lacks the corresponding native method, the call throws an unsupported-operation error instead of being omitted. Use this pattern only in a controlled test, with the native server and client remaining valid throughout cleanup. Writing `CurrentTime` changes the engine clock field, not an isolated JavaScript snapshot; restoring it does not undo side effects of calls made while that value was changed.

```js
const { GetGlobalVariables, GetServer } = require("engines/server");

if (typeof GetServer !== "function") {
	throw new Error("This SDK does not expose the native IServer wrapper.");
}

const g_GlobalVariables = GetGlobalVariables();
const g_Server = GetServer();
if (!g_Server) {
	throw new Error("The native IServer wrapper is not available.");
}

if (g_Server.GetAllocatedClientCount() <= 0) {
	throw new Error("Client slot 0 is not allocated.");
}

const g_Client = g_Server.GetClient(0);
if (!g_Client || !g_Client.Connected) {
	throw new Error("Client slot 0 is not connected.");
}

const g_flPreviousCurrentTime = g_GlobalVariables.CurrentTime;
const g_nPreviousRate = g_Client.Rate;
const g_flPreviousTimescale = g_Server.GetServerTimescale();
const g_vecStateErrors = [];

try {
	g_GlobalVariables.CurrentTime = 0;

	if (!g_Client.SetNetworkRate(30000, true)) {
		throw new Error("SetNetworkRate() did not report success.");
	}

	if (!g_Server.SetServerTimescale(0.5)) {
		throw new Error("SetServerTimescale() did not report success.");
	}
} catch (ErrorValue) {
	g_vecStateErrors.push(ErrorValue);
} finally {
	try {
		if (!g_Server.SetServerTimescale(g_flPreviousTimescale)) {
			throw new Error("Timescale restoration call did not report success.");
		}
	} catch (ErrorValue) {
		g_vecStateErrors.push(ErrorValue);
	}

	try {
		if (!g_Client.SetNetworkRate(g_nPreviousRate, true)) {
			throw new Error("Network-rate restoration call did not report success.");
		}
	} catch (ErrorValue) {
		g_vecStateErrors.push(ErrorValue);
	}

	try {
		g_GlobalVariables.CurrentTime = g_flPreviousCurrentTime;
	} catch (ErrorValue) {
		g_vecStateErrors.push(ErrorValue);
	}
}

if (g_vecStateErrors.length > 0) {
	throw new AggregateError(g_vecStateErrors, "State update or restoration failed.");
}
```

### Build a visibility set for two players

Use verified current players and origins from the current map. The named netprops must exist in the selected game; adding origins to local bounds assumes unparented, world-aligned entities and does not resolve parent transforms or rotations. Nonnegative cluster and area numbers alone do not prove current-map membership.

```js
const {
	AddOriginToPVS,
	CheckBoxInPVS,
	GetAreaBits,
	GetAreaForOrigin,
	GetClusterForOrigin,
	GetPVSForCluster,
	ResetPVS,
} = require("engines/server");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

if ((typeof AddOriginToPVS !== "function") || (typeof GetAreaBits !== "function") || (typeof ResetPVS !== "function")) {
	throw new Error("This SDK does not expose the PVS accumulator and area-bit operations used by this example.");
}

function AddVectors(LeftVector, RightVector) {
	return {
		X: LeftVector.X + RightVector.X,
		Y: LeftVector.Y + RightVector.Y,
		Z: LeftVector.Z + RightVector.Z,
	};
}

const g_FirstPlayer = Player(1);
const g_SecondPlayer = Player(2);
if (!g_FirstPlayer || !g_SecondPlayer) {
	throw new Error("Both player entities must be available.");
}

const g_FirstOrigin = g_FirstPlayer.GetEntityPropertyVector("m_vecOrigin");
const g_SecondOrigin = g_SecondPlayer.GetEntityPropertyVector("m_vecOrigin");
const g_SecondMinimums = g_SecondPlayer.GetEntityPropertyVector("m_vecMins");
const g_SecondMaximums = g_SecondPlayer.GetEntityPropertyVector("m_vecMaxs");
const g_nClusterIndex = GetClusterForOrigin(g_FirstOrigin);
if (!Number.isInteger(g_nClusterIndex) || (g_nClusterIndex < 0)) {
	throw new Error("The first player origin does not resolve to a valid cluster.");
}

const g_ClusterPVS = GetPVSForCluster(g_nClusterIndex);
if (!g_ClusterPVS || !Number.isSafeInteger(g_ClusterPVS.RequiredBytes) || (g_ClusterPVS.RequiredBytes <= 0)) {
	throw new Error("GetPVSForCluster() did not return a usable PVS size.");
}

const g_arrResetPVS = ResetPVS(g_ClusterPVS.RequiredBytes);
if (!(g_arrResetPVS instanceof Uint8Array) || (g_arrResetPVS.byteLength < g_ClusterPVS.RequiredBytes)) {
	throw new Error("ResetPVS() did not return sufficient byte storage.");
}

const g_arrFirstOriginPVS = AddOriginToPVS(g_FirstOrigin);
if (!(g_arrFirstOriginPVS instanceof Uint8Array) || (g_arrFirstOriginPVS.byteLength < g_ClusterPVS.RequiredBytes)) {
	throw new Error("The first PVS accumulation did not return sufficient byte storage.");
}

const g_arrCombinedPVS = AddOriginToPVS(g_SecondOrigin);
if (!(g_arrCombinedPVS instanceof Uint8Array) || (g_arrCombinedPVS.byteLength < g_ClusterPVS.RequiredBytes)) {
	throw new Error("The combined PVS accumulation did not return sufficient byte storage.");
}

// Test the second player's bounds against the PVS accumulated for both origins.
const g_bVisible = CheckBoxInPVS(AddVectors(g_SecondOrigin, g_SecondMinimums), AddVectors(g_SecondOrigin, g_SecondMaximums), g_arrCombinedPVS);
const g_nAreaNumber = GetAreaForOrigin(g_SecondOrigin);
if (!Number.isInteger(g_nAreaNumber) || (g_nAreaNumber < 0)) {
	throw new Error("The second player origin does not resolve to a valid area.");
}

const g_arrAreaBits = GetAreaBits(g_nAreaNumber);
if (!(g_arrAreaBits instanceof Uint8Array)) {
	throw new Error("GetAreaBits() did not return an area-state byte array.");
}

LogInfo("%j", {
	Visible: g_bVisible,
	Area: g_nAreaNumber,
	AreaByteCount: g_arrAreaBits.byteLength,
});
```

### Inspect transmission without retaining snapshots

```js
const {
	GetEntityTransmitBitsForClient,
	GetPlayerNetworkChannelInformation,
	GetPreviousCheckTransmitInformation,
} = require("engines/server");
const { LogInfo } = require("loggers");

if ((typeof GetEntityTransmitBitsForClient !== "function") || (typeof GetPreviousCheckTransmitInformation !== "function")) {
	throw new Error("This SDK does not expose transmission snapshots.");
}

function LogTransmissionSnapshot(nPlayerIndex) {
	// Read the live metric before snapshot result setters can reenter JavaScript.
	const flClientLatency = GetPlayerNetworkChannelInformation(nPlayerIndex)?.LatencyOutgoing ?? null;

	const TransmitBits = GetEntityTransmitBitsForClient(nPlayerIndex);
	const PreviousTransmitInformation = GetPreviousCheckTransmitInformation(nPlayerIndex);

	LogInfo("%j", {
		ClientLatency: flClientLatency,
		PreviousEntityCount: PreviousTransmitInformation?.TransmitEdicts.length ?? null,
		TransmittedEntityCount: TransmitBits?.Indexes.length ?? null,
	});
}

// Call synchronously for a verified current player; counts do not prove delivery.
// Null counts indicate a missing snapshot result, not an empty entity set.
LogTransmissionSnapshot(1);
```

### Own a temporary spatial partition correctly

```js
const {
	CreateSpatialPartition,
	DestroySpatialPartition,
} = require("engines/server");
const { LogInfo } = require("loggers");
const { Vector } = require("mathlib");

if ((typeof CreateSpatialPartition !== "function") || (typeof DestroySpatialPartition !== "function")) {
	throw new Error("This SDK does not expose temporary spatial partitions.");
}

function UseTemporarySpatialPartition() {
	const flPartitionExtent = 16384;
	const WorldMinimum = new Vector(-flPartitionExtent, -flPartitionExtent, -flPartitionExtent);
	const WorldMaximum = new Vector(flPartitionExtent, flPartitionExtent, flPartitionExtent);
	const vecPartitionErrors = [];

	const SpatialPartition = CreateSpatialPartition(WorldMinimum, WorldMaximum);
	if (!SpatialPartition) {
		throw new Error("Unable to create a temporary spatial partition.");
	}

	try {
		LogInfo("%j", { Operation: "CreateSpatialPartition", Kind: SpatialPartition.Kind });
	} catch (ErrorValue) {
		vecPartitionErrors.push(ErrorValue);
	} finally {
		try {
			if (!DestroySpatialPartition(SpatialPartition.Address)) {
				throw new Error("Temporary spatial-partition destruction call did not report success.");
			}
		} catch (ErrorValue) {
			vecPartitionErrors.push(ErrorValue);
		}
	}

	if (vecPartitionErrors.length > 0) {
		throw new AggregateError(vecPartitionErrors, "Temporary spatial-partition use or cleanup failed.");
	}
}

UseTemporarySpatialPartition();
```

### Precache, play, and stop a sound resource

Submission and stop are separate native operations, not an atomic transaction. If emission throws after a native side effect, this example cannot prove ownership of that effect. Stopping matches the entity, channel, and sample rather than an exclusive playback instance.

```js
const {
	EmitSound,
	IsSoundPrecached,
	PrecacheSound,
	StopSound,
} = require("engines/server");
const { LogInfo } = require("loggers");

const g_nSoundEntityIndex = 1;
const g_nSoundChannel = 0;
const g_strSample = "ui/buttonclick.wav";

function PlayTemporarySound(strSample, nEntityIndex, nChannel) {
	const bPreload = true;
	const bIsUISound = true;
	if (!IsSoundPrecached(strSample) && !PrecacheSound(strSample, bPreload, bIsUISound)) {
		throw new Error(`Unable to precache sound: ${strSample}.`);
	}

	let bSoundEmissionSubmitted = false;
	const vecSoundErrors = [];

	try {
		bSoundEmissionSubmitted = EmitSound({
			Recipients: [nEntityIndex],
			Volume: 0.8,
			Channel: nChannel,
			Sample: strSample,
			Entity: nEntityIndex,
		});
		if (!bSoundEmissionSubmitted) {
			throw new Error(`Sound emission call did not report success: ${strSample}.`);
		}

		LogInfo("%j", { Operation: "EmitSound", Sample: strSample });
	} catch (ErrorValue) {
		vecSoundErrors.push(ErrorValue);
	} finally {
		try {
			if (bSoundEmissionSubmitted) {
				if (!StopSound({
					Channel: nChannel,
					Sample: strSample,
					Entity: nEntityIndex,
				})) {
					throw new Error(`Sound stop call did not report success: ${strSample}.`);
				}
			}
		} catch (ErrorValue) {
			vecSoundErrors.push(ErrorValue);
		}
	}

	if (vecSoundErrors.length > 0) {
		throw new AggregateError(vecSoundErrors, "Sound submission or stop failed.");
	}
}

// Use a verified current player and the SDK's permitted precache phase.
// Immediate stop demonstrates cleanup; it does not wait for audible playback.
PlayTemporarySound(g_strSample, g_nSoundEntityIndex, g_nSoundChannel);
```

### Preserve string-table lock state

The helper restores the prior lock state before returning the native index unchanged. Its failure sentinel depends on the selected SDK; validate that contract before using the resource. The final log records the index for diagnosis, not proof of successful precaching.

```js
const {
	PrecacheGeneric,
	SetNetworkStringTablesLocked,
} = require("engines/server");
const { LogInfo } = require("loggers");

const g_strGenericResourcePath = "scripts/sourcejs/runtime.txt";

function PrecacheGenericWithUnlockedStringTables(strResourcePath) {
	const bPreload = true;
	const vecPrecacheErrors = [];
	let nGenericIndex = 0;

	const bPreviousLockState = SetNetworkStringTablesLocked(false);

	try {
		nGenericIndex = PrecacheGeneric(strResourcePath, bPreload);
	} catch (ErrorValue) {
		vecPrecacheErrors.push(ErrorValue);
	} finally {
		try {
			// The return value is the lock state before restoration, not an operation status.
			SetNetworkStringTablesLocked(bPreviousLockState);
		} catch (ErrorValue) {
			vecPrecacheErrors.push(ErrorValue);
		}
	}

	if (vecPrecacheErrors.length > 0) {
		throw new AggregateError(vecPrecacheErrors, "Generic precache or string-table lock restoration failed.");
	}

	return nGenericIndex;
}

const g_nGenericIndex = PrecacheGenericWithUnlockedStringTables(g_strGenericResourcePath);
LogInfo("%j", { Operation: "PrecacheGeneric", GenericIndex: g_nGenericIndex });
```

### Keep destructive operations behind confirmation

Call this dispatcher only after a trusted administrator has confirmed the selected action; it does not implement a confirmation UI itself.

```js
const {
	ChangeLevel,
	EndMultiplayerGame,
	IsMapValid,
	RemoveAllPaint,
} = require("engines/server");

function RunConfirmedServerMaintenance(strAction, strValue) {
	if (strAction === "ClearPaint") {
		if (typeof RemoveAllPaint !== "function") {
			throw new Error("This SDK does not expose paint-map removal.");
		}

		if (!RemoveAllPaint()) {
			throw new Error("RemoveAllPaint() did not report success.");
		}

		return true;
	}

	if (strAction === "EndGame") {
		if (typeof EndMultiplayerGame !== "function") {
			throw new Error("This SDK does not expose EndMultiplayerGame().");
		}

		if (!EndMultiplayerGame()) {
			throw new Error("EndMultiplayerGame() did not report success.");
		}

		return true;
	}

	if (strAction === "ChangeLevel") {
		if ((typeof strValue !== "string") || (strValue.length === 0) || strValue.includes("\0") || !IsMapValid(strValue)) {
			throw new Error(`Invalid map: ${strValue}.`);
		}

		if (!ChangeLevel(strValue)) {
			throw new Error("ChangeLevel() did not report success.");
		}

		return true;
	}

	throw new Error(`Unknown maintenance action: ${strAction}.`);
}
```

## Lifecycle and ownership

- Each `GetGlobalVariables()` call creates a fresh live non-owning view over the same `CGlobalVars` storage. `GetServer()`, `IServer.GetClient()`, and `GetPlayerNetworkChannelInformation()` are also live non-owning views. Use them only while their native owners remain valid; client disconnection can invalidate a view before plugin unload or engine shutdown. Accessing a stale wrapper is not a safe validity test.
- `GetLaunchOptions()` is a non-owning engine `KeyValues` handle. Do not destroy it.
- `ExecuteClientCommandKeyValues(Client, KeyValues)` prepares the registered, owned root, refreshes the original client identity and connection after all KeyValues getters, and only then releases the hierarchy to the engine before the native call. Client rejection or a collection failure before release preserves ownership of a still-valid hierarchy. A later error does not reverse a completed transfer; once transferred, do not reuse or destroy the handle, even if the native call subsequently throws.
- A returned `CreateSpatialPartition(WorldMinimum, WorldMaximum)` object represents caller-managed native state; a `null` or `undefined` result transfers no ownership. Release it exactly once with `DestroySpatialPartition(SpatialPartition.Address)` and require a `true` result; wrappers and aliases are not automatically invalidated. Public destruction is rejected while temporary construction ownership is active, including nested scopes and owning cleanup. This narrow guard is not a general liveness or ownership registry after return.
- `BuildEntityClusterList(Entity, PVSInformation?)` may allocate cluster storage. Call `CleanUpEntityClusterList(PVSInformation.Address)` or the entity-based form only when the native ownership protocol requires your code to perform cleanup, not merely because a wrapper was returned. Check the returned boolean. Cleanup does not refresh copied fields or make surviving aliases safe. Copied output snapshots and temporary construction buffers transfer no ownership of the native PVS record or its original cluster storage.
- `CreateEdict()` and `CreateFakeClient()` return live non-owning edict views and mutate the world. Remove or disconnect only objects created by your plugin, using the lifecycle appropriate to that object, and do not cache a wrapper after its native object is gone.
- `Server.GetNetworkStatistics()` returns numeric samples; `GetPVSForCluster()` returns a required byte count and copied `Uint8Array`; `GetPaintMapDataRLE()` returns a copied array of unsigned 32-bit values; and `GetAreaBits()` (where exposed by the selected SDK) returns a copied `Uint8Array`. Request fresh results when current state matters.
- Check required capabilities at plugin load and optional ones before each selected operation. SDK-gated exports may be absent; always-registered callbacks or methods on available native wrappers may instead throw an unsupported-operation error when the selected SDK lacks the native method. Neither case is a reason to install a fallback implementation.
