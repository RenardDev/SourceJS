# `require("listeners")`

> AI agents: use the contents to find the relevant API, then verify its producer and package contract. This project-owned page is hand-maintained from `src/sourcejs/modules/ModuleBindings.cpp`, `packages/sourcejs/listeners.js`, and native VSP event producers; the automatic-event table is not proof that every manager has an automatic producer.

The `listeners` module exposes SourceJS runtime events, high-level listener managers, deterministic subscription objects, VSP lifecycle callbacks, and the managed entity-output hook. It is separate from engine game events in [`events`](events.md) and machine-code hooks in [`memory/hooks`](memory-hooks.md).

## Contents

- [Import](#import)
- [Event transport](#event-transport)
- [Low-level API](#low-level-api)
- [ListenerManager](#listenermanager)
- [ListenerManagerDecorator](#listenermanagerdecorator)
- [Automatic VSP events](#automatic-vsp-events)
- [Client connection control](#client-connection-control)
- [Server output control](#server-output-control)
- [Entity outputs](#entity-outputs)
- [Explicit channels](#explicit-channels)
- [Button transitions](#button-transitions)
- [Complete export inventory](#complete-export-inventory)
- [Ownership and errors](#ownership-and-errors)
- [Related modules](#related-modules)

## Import

Import only the operations used by the plugin:

```js
const {
	RegisterClientDisconnectListener,
	RegisterLevelInitListener,
	RegisterPluginUnloadingListener,
} = require("listeners");
const { LogInfo } = require("core/logger");

function HandleLevelInitialization(strMapName) {
	LogInfo(`Loading ${strMapName}.`);
}

function HandleClientDisconnect(nClientIndex) {
	LogInfo(`Client ${nClientIndex} disconnected.`);
}

function HandlePluginUnloading(strPluginName) {
	LogInfo(`Unloading ${strPluginName}.`);
}

const g_vecListenerSubscriptions = [];

function UnloadPlugin() {
	const vecCleanupFailures = [];
	for (const ListenerSubscription of g_vecListenerSubscriptions) {
		if (ListenerSubscription.Disposed) {
			continue;
		}

		try {
			if (!ListenerSubscription.DisposeListener()) {
				vecCleanupFailures.push(new Error(`Failed to dispose ${ListenerSubscription.ListenerManager.EventName}.`));
			}
		} catch (CleanupError) {
			vecCleanupFailures.push(CleanupError);
		}
	}

	if (vecCleanupFailures.length > 0) {
		throw new AggregateError(vecCleanupFailures, "Listener subscription cleanup failed.");
	}
}

try {
	g_vecListenerSubscriptions.push(RegisterLevelInitListener(HandleLevelInitialization));
	g_vecListenerSubscriptions.push(RegisterClientDisconnectListener(HandleClientDisconnect));
	g_vecListenerSubscriptions.push(RegisterPluginUnloadingListener(HandlePluginUnloading));
} catch (RegistrationError) {
	try {
		UnloadPlugin();
	} catch (CleanupError) {
		throw new AggregateError([RegistrationError, CleanupError], "Listener setup and cleanup failed.");
	}

	throw RegistrationError;
}

module.exports = { UnloadPlugin };
```

Each event-specific `Register...Listener` factory returns a `ListenerManagerDecorator`; the low-level `RegisterListener()` returns a boolean. Retain the decorator and call `DisposeListener()` when the owning feature is disabled. SourceJS also removes callbacks owned by a plugin context when that plugin unloads.

## Event transport

Every plugin runs in a separate V8 context. The low-level event channel therefore transports a string, not a JavaScript object reference:

```text
publisher value -> JSON string -> native runtime -> receiving plugin context
```

Native VSP producers and `ListenerManager.EmitListenerEvent()` use this envelope:

```json
{ "Arguments": ["first argument", 42] }
```

Low-level callbacks receive `(strEventName, strSerializedPayload)`. High-level managers require valid JSON containing a non-array object with its own `Arguments` array, then call their callbacks positionally. An inherited `Arguments` property is not accepted and its getter is not invoked. A raw string, empty payload, primitive, or array is not a valid manager envelope. A manager bridge ignores an event-name mismatch before decoding.

JavaScript publisher values must be JSON-serializable: ordinary `JSON.stringify()` does not serialize `bigint` values, including nested ones. Native producers encode addresses with the SourceJS `$SourceJSBigInt` marker. `ListenerManager` converts a top-level argument object with exactly that one key and a string value to `bigint`; it does not recursively convert nested records or arrays. An invalid marker string throws `TypeError`.

Native `Entity`, `Player`, `KeyValues`, memory-view, and hook objects cannot be shared between plugin contexts. Send stable data such as an entity index or network ID and reconstruct the live object in the receiver. A channel identifier is not proof that a retained native address is still valid.

## Low-level API

### `RegisterListener(strEventName, Callback)`

`RegisterListener` validates its arguments, calls native `AddListener`, and returns `true` when the runtime registers the callback or `false` when registration is rejected. `Callback` receives `(strEventName, strSerializedPayload)`. `strEventName` must be a non-empty string and `Callback` must be a function.

### `UnregisterListener(strEventName, Callback)`

`UnregisterListener` applies the same non-empty-string/function validation, then calls native `RemoveListener` for the exact function registered by `RegisterListener()`. It removes one matching registration and returns `true`, or returns `false` when no match exists. Low-level duplicate registrations are separate entries; high-level managers reject duplicates.

### `EmitListenerEvent(strEventName, Payload = "")`

`EmitListenerEvent` serializes the payload and calls native `Emit`. A string is forwarded unchanged; another serializable value is encoded with `JSON.stringify()`. `null` and `undefined` become an empty payload. Cycles and `bigint` values throw; values for which serialization produces no string also throw before dispatch.

The returned count is the number of low-level registrations sampled before dispatch, including duplicates and manager bridges, not the number of high-level callbacks or an acknowledgement of success. Native dispatch uses a snapshot and logs callback exceptions before continuing other low-level registrations; it does not return those callback results or await returned promises.

### `GetListenerCount(strEventName)`

Returns the process-wide number of low-level callbacks currently registered for the exact event name.

The underlying native `listeners.Emit(strEventName, strEventPayload?)` accepts a string payload or an omitted, empty payload; serialization by `EmitListenerEvent()` happens before that native call. Failed native string conversion/encoding prevents dispatch and reports `The event payload could not be converted to a native string.` The listener count is sampled before dispatch. C++ failures in native emission or counting become callback-specific JavaScript errors without exposing the underlying exception text, not recovery from invalid native memory or fatal V8 out-of-memory termination.

The following example implements a real serialized health channel without sharing a `Player` object:

```js
const {
	EmitListenerEvent,
	GetListenerCount,
	RegisterListener,
	UnregisterListener,
} = require("listeners");
const { GetAllPlayers } = require("filters/players");
const { Player } = require("players/entity");
const { LogInfo } = require("core/logger");

const g_RunHealthChannelExample = () => {
	const strEventName = "SourceJS:HealthChanged";
	const vecCurrentPlayers = GetAllPlayers();
	if (vecCurrentPlayers.length === 0) {
		throw new Error("Health-channel example requires a connected player.");
	}

	const SelectedPlayer = vecCurrentPlayers[0];

	function ReceiveHealthChange(strReceivedEventName, strSerializedPayload) {
		const Payload = JSON.parse(strSerializedPayload);
		const CurrentPlayer = Player(Payload.PlayerIndex);
		if ((CurrentPlayer === null) || (CurrentPlayer.UserID !== Payload.UserID)) {
			throw new Error(`Player #${Payload.PlayerIndex} changed before delivery.`);
		}

		LogInfo(`${strReceivedEventName}: ${CurrentPlayer.Name} now has ${Payload.Health} HP.`);
	}

	const bRegisteredCallback = RegisterListener(strEventName, ReceiveHealthChange);
	if (!bRegisteredCallback) {
		throw new Error("Health-channel callback registration failed.");
	}

	const vecFailures = [];
	try {
		const unSelectedCallbackCount = EmitListenerEvent(strEventName, {
			Health: SelectedPlayer.Health,
			PlayerIndex: SelectedPlayer.Index,
			UserID: SelectedPlayer.UserID,
		});
		const unCurrentListenerCount = GetListenerCount(strEventName);
		if ((unSelectedCallbackCount < 1) || (unCurrentListenerCount < 1)) {
			throw new Error("Health-channel event selected no callbacks.");
		}

		LogInfo(`Selected health update for ${unSelectedCallbackCount}/${unCurrentListenerCount} callbacks.`);
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		if (!UnregisterListener(strEventName, ReceiveHealthChange)) {
			throw new Error("Health-channel callback cleanup failed.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Health-channel dispatch or cleanup failed.");
	}
};

g_RunHealthChannelExample();
```

Use an application-specific prefix for custom event names. SourceJS-owned event and channel names use PascalCase; exact external/native/engine event-name values remain unchanged.

## `ListenerManager`

### Construction

`new ListenerManager(strEventName, ManagerOptions = {})`

`strEventName` is a non-empty string. `ManagerOptions` must be a non-null, non-array object. `AutoBridge` is the only accepted own key; unknown own keys, including symbols, throw. An own `AutoBridge` must be a strict boolean, so `{ AutoBridge: undefined }` is invalid. Inherited options are ignored, and an absent own option defaults to `true`.

An automatic manager installs one native low-level bridge when its first callback is registered and removes that bridge after its last callback is removed. With `AutoBridge: false`, `NotifyListeners()` is local-only unless a subclass supplies another source.

### Fields and getters

| Member | Access | Type | Meaning |
| --- | --- | --- | --- |
| `EventName` | Read/write field | `string` | Exact native/custom channel name. |
| `ListenerCallbacks` | Read/write field | `Set<Function>` | Live callbacks owned by this manager. |
| `AutoBridge` | Read/write field | `boolean` | Whether first/last registration owns a native bridge. |
| `RuntimeCallback` | Read/write field | `Function` | Low-level envelope decoder registered with the native runtime. |
| `Initialized` | Read/write field | `boolean` | Whether first-listener setup is active. |
| `ListenerCount` | Read-only getter | `number` | Current callback count. |
| `Empty` | Read-only getter | `boolean` | `true` when the callback count is zero. |

The fields are writable, but replacing them while subscribed or mutating `ListenerCallbacks` directly bypasses bridge/lifecycle ownership. Use registration and cleanup methods instead. The live set and its iterator are not stable snapshots.

### Methods

| Method | Result | Behavior |
| --- | --- | --- |
| [`RegisterListener(ListenerCallback)`](#registerlistenerstreventname-callback) | `Function` | Registers and returns `ListenerCallback`; duplicate registration or native bridge rejection throws. |
| [`UnregisterListener(ListenerCallback)`](#unregisterlistenerstreventname-callback) | `true` | Removes an existing callback; an unknown callback throws. |
| `HasListener(ListenerCallback)` | `boolean` | Tests exact callback identity. |
| `NotifyListeners(...vecCallbackArguments)` | `number` | Calls a snapshot of this manager's callbacks synchronously in insertion order and returns the invoked count. A throw stops the remaining callbacks and propagates; returned promises are not awaited. |
| [`EmitListenerEvent(...vecCallbackArguments)`](#emitlistenereventstreventname-payload--) | `number` | Sends `{ Arguments: vecCallbackArguments }` through the native channel and returns its pre-dispatch low-level registration count, not this manager's callback count. |
| `ClearListeners()` | `ListenerManager` | Unregisters a snapshot in order and returns this manager on success. Stops at the first failure; removals already completed are not rolled back. |
| `GetAllListeners()` | `Function[]` | Returns a point-in-time callback array. |
| `[Symbol.iterator]()` | iterator | Iterates the live callback `Set`. |

Subclasses may define `InitializeListenerManager()` and `FinalizeListenerManager()`. They run on the zero-to-one and one-to-zero callback transitions. An initializer that throws must clean its own partial resources: automatic rollback calls the finalizer only after initialization returned successfully.

Subscription changes on the same manager are non-reentrant: nested `RegisterListener()`, `UnregisterListener()`, or `ClearListeners()` during a registration/removal operation throw `Error`, including from lifecycle hooks or hook getters. The transition guard resets after success, validation failures, thrown hooks, and rollback, so the manager remains retryable according to the failure rules below. Ordinary notification callbacks may still add or remove subscriptions using the documented snapshot behavior; operations on other managers remain independent.

If native bridge registration returns `false`, no callback is added and completed initialization is rolled back through `FinalizeListenerManager()`. A cleanup failure is combined with the registration error in `AggregateError`. When rollback succeeds, the manager remains uninitialized, empty, and retryable.

During last-listener removal, a finalization error followed by rejected bridge restoration is reported as `AggregateError` containing both failures. The callback remains in the manager, but its native bridge could not be restored; handle this failure before reusing the manager.

The sample's decorator receives its own emission. Another plugin can subscribe to the same channel to receive the serialized arguments across contexts:

```js
const { GetAllPlayers } = require("filters/players");
const { GetGlobalVariables } = require("globals");
const { ListenerManager, ListenerManagerDecorator } = require("listeners");
const { LogInfo } = require("core/logger");

const g_RunRoundReadyExample = () => {
	const RoundReadyListenerManager = new ListenerManager("SourceJS:RoundReady");

	function HandleRoundReady(strMapName, unConnectedPlayerCount) {
		LogInfo(`${strMapName}: ${unConnectedPlayerCount} players connected.`);
	}

	const RoundReadyListenerSubscription = new ListenerManagerDecorator(RoundReadyListenerManager, HandleRoundReady);
	const vecFailures = [];
	try {
		const unSelectedCallbackCount = RoundReadyListenerManager.EmitListenerEvent(GetGlobalVariables().MapName, GetAllPlayers().length);
		if (unSelectedCallbackCount < 1) {
			throw new Error("Round-ready event selected no callbacks.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		if (!RoundReadyListenerSubscription.DisposeListener() || !RoundReadyListenerManager.Empty) {
			throw new Error("Round-ready subscription cleanup failed.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Round-ready dispatch or cleanup failed.");
	}
};

g_RunRoundReadyExample();
```

`NotifyListeners()` is the correct operation for a live local object:

```js
const { ListenerManager } = require("listeners");
const { GetAllPlayers } = require("filters/players");
const { Player } = require("players/entity");

const g_RunLocalPlayerListenerExample = () => {
	const vecCurrentPlayers = GetAllPlayers();
	if (vecCurrentPlayers.length === 0) {
		throw new Error("Local-player listener example requires a connected player.");
	}

	const CurrentPlayer = Player(vecCurrentPlayers[0].Index);
	if (CurrentPlayer === null) {
		throw new Error("Connected player could not be resolved.");
	}

	const LocalPlayerListenerManager = new ListenerManager("LocalPlayerChanged", { AutoBridge: false });

	function ReceivePlayer(ReceivedPlayer) {
		if (!ReceivedPlayer.Say("A local listener received your live Player object.")) {
			throw new Error(`Failed to send chat as player #${ReceivedPlayer.Index}.`);
		}
	}

	const RegisteredCallback = LocalPlayerListenerManager.RegisterListener(ReceivePlayer);
	const vecFailures = [];
	try {
		if ((RegisteredCallback !== ReceivePlayer) || (LocalPlayerListenerManager.NotifyListeners(CurrentPlayer) !== 1)) {
			throw new Error("Local-player listener delivery failed.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		if ((LocalPlayerListenerManager.ClearListeners() !== LocalPlayerListenerManager) || !LocalPlayerListenerManager.Empty) {
			throw new Error("Local-player listener cleanup failed.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Local-player delivery or cleanup failed.");
	}
};

g_RunLocalPlayerListenerExample();
```

Do not use `EmitListenerEvent(CurrentPlayer)` to transfer a live player. Send `CurrentPlayer.Index` and reconstruct the player in the receiving context.

## `ListenerManagerDecorator`

`new ListenerManagerDecorator(ListenerManagerValue, ListenerCallback)`

The constructor requires a `ListenerManager` value, stores it in `ListenerManager`, stores the validated callback as `ListenerCallback`, registers it immediately, and initializes `Disposed` to `false`. These are read/write fields, not read-only getters; leave them unchanged while the subscription owns a registration.

| Member | Behavior |
| --- | --- |
| `ListenerManager` | Manager that owns the callback. |
| `ListenerCallback` | Exact registered function. |
| `Disposed` | Becomes `true` only after `DisposeListener()` unregisters successfully. |
| `InvokeListenerCallback(...vecCallbackArguments)` | Calls the stored callback with the decorator as its receiver and returns its value, including after disposal; throws propagate and returned promises are not awaited. |
| `DisposeListener()` | Unregisters once; failures remain retryable, success returns `true`, and later calls return `false`. |

Direct invocation is useful when one code path must share the same behavior as the event callback:

```js
const { ListenerManager, ListenerManagerDecorator } = require("listeners");

const g_RunCacheInvalidationExample = () => {
	const CacheInvalidationListenerManager = new ListenerManager("SourceJS:CacheInvalidated");
	const setInvalidatedCacheKeys = new Set();

	function InvalidateCacheKey(strKey) {
		setInvalidatedCacheKeys.add(strKey);

		return setInvalidatedCacheKeys.size;
	}

	const CacheInvalidationListenerSubscription = new ListenerManagerDecorator(CacheInvalidationListenerManager, InvalidateCacheKey);
	const vecFailures = [];
	try {
		const unInvalidatedKeyCount = CacheInvalidationListenerSubscription.InvokeListenerCallback("weapons");
		const unSelectedCallbackCount = CacheInvalidationListenerManager.EmitListenerEvent("entities");
		if ((unInvalidatedKeyCount !== 1) || (unSelectedCallbackCount < 1) || !setInvalidatedCacheKeys.has("weapons") || !setInvalidatedCacheKeys.has("entities")) {
			throw new Error("Cache-invalidation listener delivery failed.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		const bFirstListenerDisposeResult = CacheInvalidationListenerSubscription.DisposeListener();
		const bSecondListenerDisposeResult = CacheInvalidationListenerSubscription.DisposeListener();
		if (!bFirstListenerDisposeResult || bSecondListenerDisposeResult || !CacheInvalidationListenerSubscription.Disposed || !CacheInvalidationListenerManager.Empty) {
			throw new Error("Cache-invalidation subscription cleanup failed.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Cache invalidation or cleanup failed.");
	}
};

g_RunCacheInvalidationExample();
```

The `Register...Listener` exports are factories for this same subscription type.

## Automatic VSP events

These managers receive events from VSP callbacks, native lifecycle, or the specified hook. The paired decorator is the normal plugin-facing API. VSP callbacks forwarded by `Application` require SourceJS to be loaded and unpaused; registering a manager does not make an absent SDK producer available. Manually emitting the channel is not the same as performing the corresponding engine action.

| Decorator exports | Manager exports | Callback signature | Native timing |
| --- | --- | --- | --- |
| `RegisterLevelInitListener` | `LevelInitManager` | `(strMapName)` | `LevelInit`; the map is beginning to load. |
| `RegisterServerActivateListener` | `ServerActivateManager` | `(vecEdictIndexes, nEdictCount, nMaximumClients)` | `ServerActivate`; contains indices `0` through `nEdictCount - 1`, or is empty when `nEdictCount <= 0`. |
| `RegisterTickListener` | `TickManager` | `()` | Each loaded, unpaused, simulating `GameFrame`; separate from the earlier async-result pump. |
| `RegisterLevelShutdownListener` | `LevelShutdownManager` | `()` | Forwarded VSP `LevelShutdown` calls while loaded and unpaused. |
| `RegisterLevelEndListener` | `LevelEndManager` | `()` | Once after shutdown for a level previously initialized by SourceJS. |
| `RegisterClientConnectListener` | `ClientConnectManager` | `(ClientConnectContext)` | Before the connection is accepted; can reject it. |
| `RegisterClientActiveListener` | `ClientActiveManager` | `(nClientIndex)` | Client has become active. |
| `RegisterClientDisconnectListener` | `ClientDisconnectManager` | `(nClientIndex)` | Client is disconnecting. |
| `RegisterClientPutInServerListener` | `ClientPutInServerManager` | `(nClientIndex, strPlayerName)` | Client receives a server entity. |
| `RegisterClientSettingsChangedListener` | `ClientSettingsChangedManager` | `(nClientIndex)` | Client settings changed. |
| `RegisterClientFullyConnectListener` | `ClientFullyConnectManager` | `(nClientIndex)` | Newer VSP callback reports a fully connected client. |
| `RegisterEdictAllocatedListener` | `EdictAllocatedManager` | `(nEdictIndex)` | An edict was allocated. |
| `RegisterEdictFreedListener` | `EdictFreedManager` | `(unEdictAddress)` | An edict is being freed; its process-local address is delivered as `bigint`, not as a live object, and must not be retained for later dereference. |
| `RegisterNetworkIDValidatedListener` | `NetworkIDValidatedManager` | `(strUserName, strNetworkID)` | Steam/network identity validation completed. |
| `RegisterQueryCVarValueFinishedListener` | `QueryCVarValueFinishedManager` | `(nQueryCookie, nClientIndex, nQueryStatus, strCVarName, strCVarValue)` | Client CVar query completed; the automatic VSP producer is absent on `darkm`. |
| `RegisterPluginLoadingListener` | `PluginLoadingManager` | `(strPluginName)` | Before the new plugin context executes. |
| `RegisterPluginLoadedListener` | `PluginLoadedManager` | `(strPluginName)` | After successful execution and registry insertion. |
| `RegisterPluginUnloadingListener` | `PluginUnloadingManager` | `(strPluginName)` | Before callback/context removal. |
| `RegisterPluginUnloadedListener` | `PluginUnloadedManager` | `(strPluginName)` | After context and registry removal. |
| `RegisterServerOutputListener` | `ServerOutputManager` | `(nSeverity, strMessage)` | Tier0 logging output when that SDK/runtime exposes the logging listener API. |
| `RegisterEntityOutputListener` | `EntityOutputManager` | `(strOutputName, ActivatorEntity, CallerEntity, OutputValue, flDelaySeconds, EntityOutputContext)` | Managed Detours pre-hook on `CBaseEntityOutput::FireOutput`. |

The plugin being loaded cannot receive its own `PluginLoading` event because its context does not exist yet. It can register during execution and receive its own `PluginLoaded`. An unloading plugin receives `PluginUnloading`, but its removed context cannot receive `PluginUnloaded`.

### Map and client state example

```js
const {
	RegisterClientActiveListener,
	RegisterClientDisconnectListener,
	RegisterLevelEndListener,
	RegisterLevelInitListener,
	RegisterServerActivateListener,
} = require("listeners");
const { Player } = require("players/entity");
const { LogInfo } = require("core/logger");

const g_setActivePlayerIndexes = new Set();

function HandleLevelInitialization(strMapName) {
	g_setActivePlayerIndexes.clear();
	LogInfo(`Initializing ${strMapName}.`);
}

function HandleServerActivate(vecEdictIndexes, nEdictCount, nMaximumClients) {
	LogInfo(`Activated ${nEdictCount} edicts for ${nMaximumClients} client slots.`);
	LogInfo(`World edict present: ${vecEdictIndexes.includes(0)}.`);
}

function HandleClientActive(nClientIndex) {
	g_setActivePlayerIndexes.add(nClientIndex);

	const CurrentPlayer = Player(nClientIndex);
	if ((CurrentPlayer === null) || !CurrentPlayer.Say("SourceJS is ready.")) {
		throw new Error(`Failed to greet active player #${nClientIndex}.`);
	}
}

function HandleClientDisconnect(nClientIndex) {
	g_setActivePlayerIndexes.delete(nClientIndex);
}

function HandleLevelEnd() {
	g_setActivePlayerIndexes.clear();
}

const g_vecListenerSubscriptions = [];

function UnloadPlugin() {
	const vecCleanupFailures = [];
	for (const ListenerSubscription of g_vecListenerSubscriptions) {
		if (ListenerSubscription.Disposed) {
			continue;
		}

		try {
			if (!ListenerSubscription.DisposeListener()) {
				vecCleanupFailures.push(new Error(`Failed to dispose ${ListenerSubscription.ListenerManager.EventName}.`));
			}
		} catch (CleanupError) {
			vecCleanupFailures.push(CleanupError);
		}
	}

	if (vecCleanupFailures.length > 0) {
		throw new AggregateError(vecCleanupFailures, "Listener subscription cleanup failed.");
	}
}

try {
	g_vecListenerSubscriptions.push(RegisterLevelInitListener(HandleLevelInitialization));
	g_vecListenerSubscriptions.push(RegisterServerActivateListener(HandleServerActivate));
	g_vecListenerSubscriptions.push(RegisterClientActiveListener(HandleClientActive));
	g_vecListenerSubscriptions.push(RegisterClientDisconnectListener(HandleClientDisconnect));
	g_vecListenerSubscriptions.push(RegisterLevelEndListener(HandleLevelEnd));
} catch (RegistrationError) {
	try {
		UnloadPlugin();
	} catch (CleanupError) {
		throw new AggregateError([RegistrationError, CleanupError], "Listener setup and cleanup failed.");
	}

	throw RegistrationError;
}

module.exports = { UnloadPlugin };
```

### Edict and identity example

```js
const {
	RegisterEdictAllocatedListener,
	RegisterEdictFreedListener,
	RegisterNetworkIDValidatedListener,
	RegisterQueryCVarValueFinishedListener,
} = require("listeners");
const { LogInfo } = require("core/logger");

const g_setAllocatedEdictIndexes = new Set();

function HandleEdictAllocated(nEdictIndex) {
	g_setAllocatedEdictIndexes.add(nEdictIndex);
}

function HandleEdictFreed(unEdictAddress) {
	LogInfo(`Freed edict Address=0x${unEdictAddress.toString(16).toUpperCase()}.`);
}

function HandleNetworkIDValidated(strUserName, strNetworkID) {
	LogInfo(`${strUserName}: ${strNetworkID}.`);
}

function HandleQueryCVarValueFinished(nQueryCookie, nClientIndex, nQueryStatus, strCVarName) {
	// The final native value argument is intentionally ignored; client CVar values can be sensitive.
	LogInfo(`QueryCVarValueFinished QueryCookie=${nQueryCookie}, ClientIndex=${nClientIndex}, CVarName=${strCVarName}, QueryStatus=${nQueryStatus}.`);
}

const g_vecListenerSubscriptions = [];

function UnloadPlugin() {
	const vecCleanupFailures = [];
	for (const ListenerSubscription of g_vecListenerSubscriptions) {
		if (ListenerSubscription.Disposed) {
			continue;
		}

		try {
			if (!ListenerSubscription.DisposeListener()) {
				vecCleanupFailures.push(new Error(`Failed to dispose ${ListenerSubscription.ListenerManager.EventName}.`));
			}
		} catch (CleanupError) {
			vecCleanupFailures.push(CleanupError);
		}
	}

	if (vecCleanupFailures.length > 0) {
		throw new AggregateError(vecCleanupFailures, "Listener subscription cleanup failed.");
	}
}

try {
	g_vecListenerSubscriptions.push(RegisterEdictAllocatedListener(HandleEdictAllocated));
	g_vecListenerSubscriptions.push(RegisterEdictFreedListener(HandleEdictFreed));
	g_vecListenerSubscriptions.push(RegisterNetworkIDValidatedListener(HandleNetworkIDValidated));
	g_vecListenerSubscriptions.push(RegisterQueryCVarValueFinishedListener(HandleQueryCVarValueFinished));
} catch (RegistrationError) {
	try {
		UnloadPlugin();
	} catch (CleanupError) {
		throw new AggregateError([RegistrationError, CleanupError], "Listener setup and cleanup failed.");
	}

	throw RegistrationError;
}

module.exports = { UnloadPlugin };
```

## Client connection control

`RegisterClientConnectListener(ListenerCallback)` receives one mutable context:

| Member | Type | Meaning |
| --- | --- | --- |
| `Allowed` | `boolean` | Current connection decision. |
| `ClientIndex` | `number` | Safe-integer entity index forwarded by VSP; the bridge preserves signed sentinel values. |
| `PlayerName` | `string` | Requested player name. |
| `NetworkAddress` | `string` | Remote network address text. |
| `MaximumRejectLength` | `number` | Non-negative safe-integer native rejection-buffer capacity in bytes, including the terminating NUL. The native message may be truncated to fit. |
| `RejectMessage` | `string` | Current rejection reason. |
| `AcceptClientConnection()` | function | Resets the decision to allowed, clears the message, and returns `true`. |
| `RejectClientConnection(strMessage = "")` | function | Rejects, stores the message, and returns `false`. |

A callback can use the context methods or return `false`, `0`, a rejection string (including `""`), or an object. For an object result, exactly `Allowed: false` rejects, and any string `RejectMessage` also rejects, even with `Allowed: true`. Unknown result properties and other primitive results are ignored; they are not validation errors.

One context is shared across the snapshot of this manager's callbacks. Rejection is sticky: a later `AcceptClientConnection()` cannot undo an earlier rejection. The last non-empty rejection message is retained, so a later empty message does not erase it. Keep writable decision fields boolean/string; arbitrary field mutations can break the bridge's expected types.

The native bridge decodes `(nClientIndex, strPlayerName, strNetworkAddress, unMaximumRejectLength)` before constructing the context. The ordinary `ClientConnectManager.NotifyListeners(...)` method does not construct it or aggregate connection decisions. Manual channel emission is not an engine connection attempt. Decide synchronously; returned promises and later mutations of a retained context cannot postpone or change the VSP decision.

Object property names are case-sensitive PascalCase; legacy lowercase spellings are not recognized.

```js
const { GetConVar } = require("cvars");
const { RegisterClientConnectListener } = require("listeners");

function HandleClientConnect(ClientConnectContext) {
	const strServerPassword = GetConVar("sv_password");
	if ((strServerPassword === null) || (strServerPassword.length === 0)) {
		return true;
	}

	if (ClientConnectContext.PlayerName.trim().length === 0) {
		return ClientConnectContext.RejectClientConnection("Choose a non-empty player name.");
	}

	if (ClientConnectContext.NetworkAddress.startsWith("192.0.2.")) {
		return "This test network is not allowed.";
	}

	return true;
}

const g_ClientConnectionListenerSubscription = RegisterClientConnectListener(HandleClientConnect);

function UnloadPlugin() {
	if (!g_ClientConnectionListenerSubscription.DisposeListener()) {
		throw new Error("Client-connect subscription cleanup failed.");
	}
}

module.exports = { UnloadPlugin };
```

Do not throw intentionally to reject a client. Native callback exceptions are logged and do not provide a rejection message.

## Server output control

`RegisterServerOutputListener(ListenerCallback)` activates the native logging hook lazily through the first low-level `ServerOutput` registration. For automatic engine output, its specialized bridge calls a snapshot of the manager callbacks with `(nSeverity, strMessage)`, where severity is an integer. A manually emitted envelope forwards its `Arguments` positionally without validating argument count, severity, or message types. Exactly `false` or `0` blocks the line; any other result, including a promise, does not block it. Rejection is sticky across the completed callbacks.

A thrown high-level callback aborts that manager's aggregation; the native runtime logs the bridge exception and continues other low-level registrations, without applying that failed bridge's decision. Do not throw as an intentional suppression mechanism. Ordinary `ServerOutputManager.NotifyListeners(...)` returns a callback count, not the aggregate output decision. Automatic output requires a loaded, initialized runtime and available Tier0 logging functions; unlike usual VSP callbacks, its producer does not check the paused flag.

The native input converter preserves narrow bytes. In a wide-character SDK build, it preserves ASCII code units and replaces each non-ASCII code unit with `?`; this compatibility mapping is not Unicode-to-UTF-8 conversion.

Automatic interception is suspended while a `ServerOutput` callback or the ordinary Tier0 listeners run, so logging from them does not recursively invoke this bridge. Removing or replacing the last listener during dispatch changes the requested hook state; native restoration applies its final state after dispatch, including blocked output and contained callback failures.

```js
const { OutputReturn } = require("core");
const { RegisterServerOutputListener } = require("listeners");

const g_vecSuppressedServerOutputPrefixes = ["Unknown command: sourcejs_internal_", "Ignoring unreasonable position"];

function HandleServerOutput(nSeverity, strMessage) {
	for (const strPrefix of g_vecSuppressedServerOutputPrefixes) {
		if (strMessage.startsWith(strPrefix)) {
			return OutputReturn.BLOCK;
		}
	}

	return OutputReturn.CONTINUE;
}

const g_ServerOutputListenerSubscription = RegisterServerOutputListener(HandleServerOutput);

function UnloadPlugin() {
	if (!g_ServerOutputListenerSubscription.DisposeListener()) {
		throw new Error("Server-output subscription cleanup failed.");
	}
}

module.exports = { UnloadPlugin };
```

Logging from this callback reaches ordinary Tier0 listeners while automatic interception is suspended; it does not recursively notify this bridge. Keep callback work short and avoid application-level logging feedback loops. On SDKs or runtime builds without the Tier0 logging listener functions, the manager remains usable as an explicit channel but receives no automatic engine output.

## Entity outputs

`EntityOutputListenerManager` extends `ListenerManager` with `AutoBridge: false`, a read/write `EntityOutputHook` field, and `InitializeListenerManager()` / `FinalizeListenerManager()` methods. The first managed listener creates or reuses the module-scoped `entities/outputs` Detours hook; the last removes that whole shared hook. Coordinate lifecycle ownership with direct `entities/outputs` subscribers: manager teardown can remove their callbacks too.

| Use | Example |
| --- | --- |
| Inspect the existing manager without starting another hook. Import both symbols from `listeners`. | `const bUsesSharedOutputHook = EntityOutputManager instanceof EntityOutputListenerManager;` |

The hook callback decodes the output context and skips an output whose name cannot be resolved, including one whose caller resolves to `null`. This is not a low-level `EntityOutput` runtime bridge. Native hook creation/registration may throw. Managed initialization enables `CreateEntityFireOutputHook()` rollback of a native record created by that attempt: successful rollback leaves no managed hook and the manager is empty and retryable. An existing cached or native hook is never removed by failed initialization, preserving foreign subscribers. If removal of a new record also fails, `AggregateError` contains the registration failure first and cleanup failure second, and the shared hook remains available for explicit `RemoveEntityFireOutputHook()` cleanup. An empty manager or null `EntityOutputHook` field therefore is not proof that no shared hook exists. Successful last-listener teardown still removes the entire shared hook as described above.

The callback arguments are:

1. `strOutputName`: resolved output name such as `OnTrigger`.
2. `ActivatorEntity`: live Entity or `null`.
3. `CallerEntity`: live Entity that owns the resolved output; the automatic manager skips unresolved callers rather than invoking this callback with `null`.
4. `OutputValue`: decoded Variant snapshot record with `Address`, `TypeID`, `Type`, and `Value`, or `null` when `ValueAddress` is `0n`. The record is not a writable native view; its `Address` remains callback-lifetime only.
5. `flDelaySeconds`: finite delay in seconds.
6. `EntityOutputContext`: decoded low-level record with `bigint` `OutputAddress`, `ValueAddress`, `ActivatorAddress`, and `CallerAddress`, normalized `Arguments`, and the values above. These process-local address snapshots do not extend native-object lifetimes; do not retain them for later dereference.

```js
const { LogInfo } = require("core/logger");
const { RegisterEntityOutputListener } = require("listeners");

function HandleEntityOutput(strOutputName, ActivatorEntity, CallerEntity, OutputValue, flDelaySeconds, EntityOutputContext) {
	if ((CallerEntity === null) || (CallerEntity.ClassName !== "trigger_once") || (strOutputName !== "OnTrigger")) {
		return;
	}

	let nActivatorIndex = null;
	let strVariantType = null;

	if (ActivatorEntity !== null) {
		nActivatorIndex = ActivatorEntity.Index;
	}

	if (OutputValue !== null) {
		strVariantType = OutputValue.Type;
	}

	LogInfo(`trigger_once ${CallerEntity.Index} fired for ${nActivatorIndex} after ${flDelaySeconds} seconds.`);
	LogInfo(`OutputAddress=0x${EntityOutputContext.OutputAddress.toString(16).toUpperCase()}, ValueAddress=0x${EntityOutputContext.ValueAddress.toString(16).toUpperCase()}, VariantType=${strVariantType}.`);
}

const g_EntityOutputListenerSubscription = RegisterEntityOutputListener(HandleEntityOutput);

function UnloadPlugin() {
	if (!g_EntityOutputListenerSubscription.DisposeListener()) {
		throw new Error("Entity-output subscription cleanup failed.");
	}
}

module.exports = { UnloadPlugin };
```

This high-level listener observes outputs. Use [`entities/outputs`](entities-outputs.md) or [`memory/hooks`](memory-hooks.md) when the callback must alter raw arguments, call the trampoline, or suppress the original output.

## Explicit channels

The following manager/decorator pairs are part of the SourceJS listener vocabulary but currently have no automatic VSP producer in this module. A subsystem, extension, or plugin must call `ListenerManager.NotifyListeners(...)` for local live values or `ListenerManager.EmitListenerEvent(...)` for serialized cross-context values. Ordinary `ListenerManager` does not aggregate blocking return values.

| Decorator exports | Manager exports | Conventional callback arguments |
| --- | --- | --- |
| `RegisterCombinerPreCacheListener` | `CombinerPreCacheManager` | `(strType, DataHandle)` |
| `RegisterConVarChangedListener` | `ConVarChangedManager` | `(ConVar, strOldValue)` |
| `RegisterDataLoadedListener` | `DataLoadedManager` | `(strType, DataHandle)` |
| `RegisterDataUnloadedListener` | `DataUnloadedManager` | `(strType, DataHandle)` |
| `RegisterEntityPreSpawnedListener` | `EntityPreSpawnedManager` | `(Entity)` |
| `RegisterNetworkedEntityPreSpawnedListener` | `NetworkedEntityPreSpawnedManager` | `(Entity)` |
| `RegisterEntityCreatedListener` | `EntityCreatedManager` | `(Entity)` |
| `RegisterNetworkedEntityCreatedListener` | `NetworkedEntityCreatedManager` | `(Entity)` |
| `RegisterEntitySpawnedListener` | `EntitySpawnedManager` | `(Entity)` |
| `RegisterNetworkedEntitySpawnedListener` | `NetworkedEntitySpawnedManager` | `(Entity)` |
| `RegisterEntityDeletedListener` | `EntityDeletedManager` | `(Entity)` |
| `RegisterNetworkedEntityDeletedListener` | `NetworkedEntityDeletedManager` | `(Entity)` |
| `RegisterEntityCollisionListener` | `EntityCollisionManager` | `(Entity, OtherEntity)` |
| `RegisterEntityTransmitListener` | `EntityTransmitManager` | `(Player, Entity)` |
| `RegisterPlayerCollisionListener` | `PlayerCollisionManager` | `(Player, OtherEntity)` |
| `RegisterPlayerTransmitListener` | `PlayerTransmitManager` | `(Player, OtherPlayer)` |
| `RegisterPlayerRunCommandListener` | `PlayerRunCommandManager` | `(Player, UserCommand)` |
| `RegisterPlayerPostRunCommandListener` | `PlayerPostRunCommandManager` | `(Player, UserCommand)` |
| `RegisterButtonStateChangedListener` | `ButtonStateChangedManager` | `(Player, nPreviousButtons, nCurrentButtons)` |
| `RegisterVersionUpdateListener` | `VersionUpdateManager` | `(strCurrentVersion, strLatestVersion)` |

This local entity-cache example preserves a live Entity without serializing it. Its publisher helpers are explicit same-context integration points; call them from the owning subsystem:

```js
const {
	NetworkedEntityCreatedManager,
	NetworkedEntityDeletedManager,
	RegisterNetworkedEntityCreatedListener,
	RegisterNetworkedEntityDeletedListener,
} = require("listeners");

const g_mapLiveEntities = new Map();

function HandleNetworkedEntityCreated(Entity) {
	g_mapLiveEntities.set(Entity.Index, Entity);
}

function HandleNetworkedEntityDeleted(Entity) {
	g_mapLiveEntities.delete(Entity.Index);
}

function PublishNetworkedEntityCreated(Entity) {
	return NetworkedEntityCreatedManager.NotifyListeners(Entity);
}

function PublishNetworkedEntityDeleted(Entity) {
	return NetworkedEntityDeletedManager.NotifyListeners(Entity);
}

const g_vecListenerSubscriptions = [];

function UnloadPlugin() {
	const vecCleanupFailures = [];
	for (const ListenerSubscription of g_vecListenerSubscriptions) {
		if (ListenerSubscription.Disposed) {
			continue;
		}

		try {
			if (!ListenerSubscription.DisposeListener()) {
				vecCleanupFailures.push(new Error(`Failed to dispose ${ListenerSubscription.ListenerManager.EventName}.`));
			}
		} catch (CleanupError) {
			vecCleanupFailures.push(CleanupError);
		}
	}

	g_mapLiveEntities.clear();

	if (vecCleanupFailures.length > 0) {
		throw new AggregateError(vecCleanupFailures, "Listener subscription cleanup failed.");
	}
}

try {
	g_vecListenerSubscriptions.push(RegisterNetworkedEntityCreatedListener(HandleNetworkedEntityCreated));
	g_vecListenerSubscriptions.push(RegisterNetworkedEntityDeletedListener(HandleNetworkedEntityDeleted));
} catch (RegistrationError) {
	try {
		UnloadPlugin();
	} catch (CleanupError) {
		throw new AggregateError([RegistrationError, CleanupError], "Listener setup and cleanup failed.");
	}

	throw RegistrationError;
}

module.exports = { UnloadPlugin };
```

These are explicit channels, not automatic engine hooks. Use the owning `entities`, `players`, `cvars`, or `memory/hooks` APIs when engine interception is required.

## Button transitions

`ButtonStatus` is frozen:

| Member | Value |
| --- | ---: |
| `ButtonStatus.RELEASED` | `0` |
| `ButtonStatus.PRESSED` | `1` |

`GetButtonCombinationStatus(nPreviousButtons, nCurrentButtons, nButtonCombination)` requires safe integers and uses JavaScript's signed 32-bit bitwise operations. Pass a bitwise-generated signed combination mask when bit 31 is set. It returns `ButtonStatus.PRESSED` when every bit in `nButtonCombination` changed from incomplete to present, `ButtonStatus.RELEASED` when it changed from present to incomplete, and `null` otherwise.

```js
const {
	ButtonStatus,
	GetButtonCombinationStatus,
	RegisterButtonStateChangedListener,
} = require("listeners");
const { PlayerButtons } = require("players/constants");

const g_nJumpAttackButtonCombination = PlayerButtons.Jump | PlayerButtons.Attack;

function HandleButtonStateChanged(Player, nPreviousButtons, nCurrentButtons) {
	const nButtonStatus = GetButtonCombinationStatus(nPreviousButtons, nCurrentButtons, g_nJumpAttackButtonCombination);
	let strMessage = null;
	if (nButtonStatus === ButtonStatus.PRESSED) {
		strMessage = "Jump + attack pressed.";

	} else if (nButtonStatus === ButtonStatus.RELEASED) {
		strMessage = "Jump + attack released.";
	}

	if ((strMessage !== null) && !Player.Say(strMessage)) {
		throw new Error(`Failed to send button state to player #${Player.Index}.`);
	}
}

const g_ButtonStateChangedListenerSubscription = RegisterButtonStateChangedListener(HandleButtonStateChanged);

function UnloadPlugin() {
	if (!g_ButtonStateChangedListenerSubscription.DisposeListener()) {
		throw new Error("Button-state subscription cleanup failed.");
	}
}

module.exports = { UnloadPlugin };
```

`RegisterButtonStateChangedListener` is an explicit-channel factory until an owning run-command subsystem publishes this event.

## Complete export inventory

The module has exactly 91 exports: nine core exports plus 41 manager/decorator pairs. It installs no renamed compatibility aliases.

### Core exports

| Export | Kind | Signature |
| --- | --- | --- |
| `ButtonStatus` | frozen object | `{ RELEASED, PRESSED }` |
| [`ListenerManager`](#listenermanager) | class | `new ListenerManager(strEventName, ManagerOptions = {})` |
| `EntityOutputListenerManager` | class | `new EntityOutputListenerManager()` |
| [`ListenerManagerDecorator`](#listenermanagerdecorator) | class | `new ListenerManagerDecorator(ListenerManagerValue, ListenerCallback)` |
| [`RegisterListener`](#registerlistenerstreventname-callback) | function | `RegisterListener(strEventName, Callback)` |
| [`UnregisterListener`](#unregisterlistenerstreventname-callback) | function | `UnregisterListener(strEventName, Callback)` |
| [`EmitListenerEvent`](#emitlistenereventstreventname-payload--) | function | `EmitListenerEvent(strEventName, Payload = "")` |
| [`GetListenerCount`](#getlistenercountstreventname) | function | `GetListenerCount(strEventName)` |
| `GetButtonCombinationStatus` | function | `GetButtonCombinationStatus(nPreviousButtons, nCurrentButtons, nButtonCombination)` |

### Manager and decorator pairs

Every decorator has the signature `RegisterNameListener(ListenerCallback)` and immediately returns a `ListenerManagerDecorator` after successful registration. Each manager export is a read-only getter returning the same live singleton `ListenerManager`, except `EntityOutputManager`, whose instance is an `EntityOutputListenerManager`. Getter exports are enumerable and configurable; the manager's documented writable fields are separate from export access.

The examples use named imports from `listeners`. Supply a synchronous `ListenerCallback` matching the event signature above. Retain the returned subscription for the feature lifetime, then call `Subscription.DisposeListener()` on the game thread. Read `ListenerCount` for diagnostics; it includes other listeners on the same manager.

| Decorator exports | Manager exports | Event name | Example |
| --- | --- | --- | --- |
| `RegisterButtonStateChangedListener` | `ButtonStateChangedManager` | `ButtonStateChanged` | `const Subscription = RegisterButtonStateChangedListener(ListenerCallback);` `const unListenerCount = ButtonStateChangedManager.ListenerCount;` |
| `RegisterClientActiveListener` | `ClientActiveManager` | `ClientActive` | `const Subscription = RegisterClientActiveListener(ListenerCallback);` `const unListenerCount = ClientActiveManager.ListenerCount;` |
| `RegisterClientConnectListener` | `ClientConnectManager` | `ClientConnect` | `const Subscription = RegisterClientConnectListener(ListenerCallback);` `const unListenerCount = ClientConnectManager.ListenerCount;` |
| `RegisterClientDisconnectListener` | `ClientDisconnectManager` | `ClientDisconnect` | `const Subscription = RegisterClientDisconnectListener(ListenerCallback);` `const unListenerCount = ClientDisconnectManager.ListenerCount;` |
| `RegisterClientFullyConnectListener` | `ClientFullyConnectManager` | `ClientFullyConnect` | `const Subscription = RegisterClientFullyConnectListener(ListenerCallback);` `const unListenerCount = ClientFullyConnectManager.ListenerCount;` |
| `RegisterClientPutInServerListener` | `ClientPutInServerManager` | `ClientPutInServer` | `const Subscription = RegisterClientPutInServerListener(ListenerCallback);` `const unListenerCount = ClientPutInServerManager.ListenerCount;` |
| `RegisterClientSettingsChangedListener` | `ClientSettingsChangedManager` | `ClientSettingsChanged` | `const Subscription = RegisterClientSettingsChangedListener(ListenerCallback);` `const unListenerCount = ClientSettingsChangedManager.ListenerCount;` |
| `RegisterCombinerPreCacheListener` | `CombinerPreCacheManager` | `CombinerPreCache` | `const Subscription = RegisterCombinerPreCacheListener(ListenerCallback);` `const unListenerCount = CombinerPreCacheManager.ListenerCount;` |
| `RegisterConVarChangedListener` | `ConVarChangedManager` | `ConVarChanged` | `const Subscription = RegisterConVarChangedListener(ListenerCallback);` `const unListenerCount = ConVarChangedManager.ListenerCount;` |
| `RegisterDataLoadedListener` | `DataLoadedManager` | `DataLoaded` | `const Subscription = RegisterDataLoadedListener(ListenerCallback);` `const unListenerCount = DataLoadedManager.ListenerCount;` |
| `RegisterDataUnloadedListener` | `DataUnloadedManager` | `DataUnloaded` | `const Subscription = RegisterDataUnloadedListener(ListenerCallback);` `const unListenerCount = DataUnloadedManager.ListenerCount;` |
| `RegisterEdictAllocatedListener` | `EdictAllocatedManager` | `EdictAllocated` | `const Subscription = RegisterEdictAllocatedListener(ListenerCallback);` `const unListenerCount = EdictAllocatedManager.ListenerCount;` |
| `RegisterEdictFreedListener` | `EdictFreedManager` | `EdictFreed` | `const Subscription = RegisterEdictFreedListener(ListenerCallback);` `const unListenerCount = EdictFreedManager.ListenerCount;` |
| `RegisterEntityCollisionListener` | `EntityCollisionManager` | `EntityCollision` | `const Subscription = RegisterEntityCollisionListener(ListenerCallback);` `const unListenerCount = EntityCollisionManager.ListenerCount;` |
| `RegisterEntityCreatedListener` | `EntityCreatedManager` | `EntityCreated` | `const Subscription = RegisterEntityCreatedListener(ListenerCallback);` `const unListenerCount = EntityCreatedManager.ListenerCount;` |
| `RegisterEntityDeletedListener` | `EntityDeletedManager` | `EntityDeleted` | `const Subscription = RegisterEntityDeletedListener(ListenerCallback);` `const unListenerCount = EntityDeletedManager.ListenerCount;` |
| `RegisterEntityOutputListener` | `EntityOutputManager` | `EntityOutput` | `const Subscription = RegisterEntityOutputListener(ListenerCallback);` `const unListenerCount = EntityOutputManager.ListenerCount;` |
| `RegisterEntityPreSpawnedListener` | `EntityPreSpawnedManager` | `EntityPreSpawned` | `const Subscription = RegisterEntityPreSpawnedListener(ListenerCallback);` `const unListenerCount = EntityPreSpawnedManager.ListenerCount;` |
| `RegisterEntitySpawnedListener` | `EntitySpawnedManager` | `EntitySpawned` | `const Subscription = RegisterEntitySpawnedListener(ListenerCallback);` `const unListenerCount = EntitySpawnedManager.ListenerCount;` |
| `RegisterEntityTransmitListener` | `EntityTransmitManager` | `EntityTransmit` | `const Subscription = RegisterEntityTransmitListener(ListenerCallback);` `const unListenerCount = EntityTransmitManager.ListenerCount;` |
| `RegisterLevelEndListener` | `LevelEndManager` | `LevelEnd` | `const Subscription = RegisterLevelEndListener(ListenerCallback);` `const unListenerCount = LevelEndManager.ListenerCount;` |
| `RegisterLevelInitListener` | `LevelInitManager` | `LevelInit` | `const Subscription = RegisterLevelInitListener(ListenerCallback);` `const unListenerCount = LevelInitManager.ListenerCount;` |
| `RegisterLevelShutdownListener` | `LevelShutdownManager` | `LevelShutdown` | `const Subscription = RegisterLevelShutdownListener(ListenerCallback);` `const unListenerCount = LevelShutdownManager.ListenerCount;` |
| `RegisterNetworkIDValidatedListener` | `NetworkIDValidatedManager` | `NetworkIDValidated` | `const Subscription = RegisterNetworkIDValidatedListener(ListenerCallback);` `const unListenerCount = NetworkIDValidatedManager.ListenerCount;` |
| `RegisterNetworkedEntityCreatedListener` | `NetworkedEntityCreatedManager` | `NetworkedEntityCreated` | `const Subscription = RegisterNetworkedEntityCreatedListener(ListenerCallback);` `const unListenerCount = NetworkedEntityCreatedManager.ListenerCount;` |
| `RegisterNetworkedEntityDeletedListener` | `NetworkedEntityDeletedManager` | `NetworkedEntityDeleted` | `const Subscription = RegisterNetworkedEntityDeletedListener(ListenerCallback);` `const unListenerCount = NetworkedEntityDeletedManager.ListenerCount;` |
| `RegisterNetworkedEntityPreSpawnedListener` | `NetworkedEntityPreSpawnedManager` | `NetworkedEntityPreSpawned` | `const Subscription = RegisterNetworkedEntityPreSpawnedListener(ListenerCallback);` `const unListenerCount = NetworkedEntityPreSpawnedManager.ListenerCount;` |
| `RegisterNetworkedEntitySpawnedListener` | `NetworkedEntitySpawnedManager` | `NetworkedEntitySpawned` | `const Subscription = RegisterNetworkedEntitySpawnedListener(ListenerCallback);` `const unListenerCount = NetworkedEntitySpawnedManager.ListenerCount;` |
| `RegisterPlayerCollisionListener` | `PlayerCollisionManager` | `PlayerCollision` | `const Subscription = RegisterPlayerCollisionListener(ListenerCallback);` `const unListenerCount = PlayerCollisionManager.ListenerCount;` |
| `RegisterPlayerPostRunCommandListener` | `PlayerPostRunCommandManager` | `PlayerPostRunCommand` | `const Subscription = RegisterPlayerPostRunCommandListener(ListenerCallback);` `const unListenerCount = PlayerPostRunCommandManager.ListenerCount;` |
| `RegisterPlayerRunCommandListener` | `PlayerRunCommandManager` | `PlayerRunCommand` | `const Subscription = RegisterPlayerRunCommandListener(ListenerCallback);` `const unListenerCount = PlayerRunCommandManager.ListenerCount;` |
| `RegisterPlayerTransmitListener` | `PlayerTransmitManager` | `PlayerTransmit` | `const Subscription = RegisterPlayerTransmitListener(ListenerCallback);` `const unListenerCount = PlayerTransmitManager.ListenerCount;` |
| `RegisterPluginLoadedListener` | `PluginLoadedManager` | `PluginLoaded` | `const Subscription = RegisterPluginLoadedListener(ListenerCallback);` `const unListenerCount = PluginLoadedManager.ListenerCount;` |
| `RegisterPluginLoadingListener` | `PluginLoadingManager` | `PluginLoading` | `const Subscription = RegisterPluginLoadingListener(ListenerCallback);` `const unListenerCount = PluginLoadingManager.ListenerCount;` |
| `RegisterPluginUnloadedListener` | `PluginUnloadedManager` | `PluginUnloaded` | `const Subscription = RegisterPluginUnloadedListener(ListenerCallback);` `const unListenerCount = PluginUnloadedManager.ListenerCount;` |
| `RegisterPluginUnloadingListener` | `PluginUnloadingManager` | `PluginUnloading` | `const Subscription = RegisterPluginUnloadingListener(ListenerCallback);` `const unListenerCount = PluginUnloadingManager.ListenerCount;` |
| `RegisterQueryCVarValueFinishedListener` | `QueryCVarValueFinishedManager` | `QueryCVarValueFinished` | `const Subscription = RegisterQueryCVarValueFinishedListener(ListenerCallback);` `const unListenerCount = QueryCVarValueFinishedManager.ListenerCount;` |
| `RegisterServerActivateListener` | `ServerActivateManager` | `ServerActivate` | `const Subscription = RegisterServerActivateListener(ListenerCallback);` `const unListenerCount = ServerActivateManager.ListenerCount;` |
| `RegisterServerOutputListener` | `ServerOutputManager` | `ServerOutput` | `const Subscription = RegisterServerOutputListener(ListenerCallback);` `const unListenerCount = ServerOutputManager.ListenerCount;` |
| `RegisterTickListener` | `TickManager` | `Tick` | `const Subscription = RegisterTickListener(ListenerCallback);` `const unListenerCount = TickManager.ListenerCount;` |
| `RegisterVersionUpdateListener` | `VersionUpdateManager` | `VersionUpdate` | `const Subscription = RegisterVersionUpdateListener(ListenerCallback);` `const unListenerCount = VersionUpdateManager.ListenerCount;` |

The practical pattern for every row is identical:

```js
const { ClientPutInServerManager, RegisterClientPutInServerListener } = require("listeners");
const { LogInfo } = require("core/logger");

const g_RunClientPutInServerExample = () => {
	function HandleClientPutInServer(nClientIndex, strPlayerName) {
		LogInfo(`${strPlayerName} entered as entity ${nClientIndex}.`);
	}

	const ClientPutInServerListenerSubscription = RegisterClientPutInServerListener(HandleClientPutInServer);
	const vecFailures = [];
	try {
		LogInfo(`EventName=${ClientPutInServerManager.EventName}.`);
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		if (!ClientPutInServerListenerSubscription.DisposeListener() || !ClientPutInServerListenerSubscription.Disposed) {
			throw new Error("Client-put-in-server subscription cleanup failed.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Client-put-in-server inspection or cleanup failed.");
	}
};

g_RunClientPutInServerExample();
```

## Ownership and errors

- Event names, callbacks, constructor options, payload envelopes, and button values have documented type checks. Specialized client/output callbacks recognize only their listed decision forms; unsupported return values can be ignored rather than rejected. Do not substitute arbitrary values into writable context fields.
- High-level native payloads must be valid JSON objects with their own `Arguments` array; inherited properties are not payload data. Malformed producer payloads throw at the manager bridge.
- Registering the same manager callback twice or removing an unknown manager callback throws. Low-level `UnregisterListener()` instead returns `false` for an unknown callback.
- `NotifyListeners()` and `EmitListenerEvent()` dispatch synchronously and do not await callback promises. A long callback can stall its engine producer; returning a promise cannot defer a connection or output decision.
- Native dispatch logs a bridge exception and continues other low-level registrations, not the remaining high-level callbacks inside that failed bridge. Direct `NotifyListeners()` propagates a throw and stops its snapshot at that callback.
- `GetAllListeners()` returns a point-in-time copy of callback identities. `ListenerCallbacks`, `ListenerCount`, `Empty`, and iteration remain live.
- Native addresses exposed by this module are process-local JavaScript `bigint` values; do not treat them as portable identifiers or live object references. Do not retain an edict address for dereference after its freed callback returns.
- Attach subscriptions as each registration succeeds and roll them back if later setup fails. Dispose all owned subscriptions when a feature is disabled, collecting failures so cleanup can be retried. Use `ClearListeners()` only when the caller owns the whole manager; it can partially complete before throwing. Coordinate shared entity-output-hook teardown with direct subscribers.

## Related modules

Related modules are [`listeners/tick`](listeners-tick.md), [`events`](events.md), [`entities/outputs`](entities-outputs.md), [`memory/hooks`](memory-hooks.md), and [`plugins`](plugins.md).
