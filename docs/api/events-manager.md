# `require("events/manager")`

> Warning: native callbacks receive borrowed live `IGameEvent` views that expire when callback dispatch returns. Copy scalar values needed by delayed work, and never retain `EventValue.Address`.

The [JavaScript wrapper](../../packages/sourcejs/events/manager.js) adds JavaScript-owned `EventListener` collections and an `EventManager` registry around the direct native game-event API. It is useful when code needs callback inspection, deterministic collection cleanup, or local JSON dispatch without firing an engine event. Use native registration, removal, and firing on the game/server thread with a live plugin context. Their engine-facing steps need the selected native manager; purely local callback-list updates do not necessarily query it.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Choosing an event layer](#choosing-an-event-layer)
- [`EventListener`](#eventlistener)
- [Callback event objects](#callback-event-objects)
- [`EventManager`](#eventmanager)
- [`EVENT_MANAGER`, `RegisterEventListener`, and `UnregisterEventListener`](#event_manager-registereventlistener-and-unregistereventlistener)
- [`FireEvent`](#fireevent)
- [Native listener adapters](#native-listener-adapters)
- [Local `DispatchEvent`](#local-dispatchevent)
- [Cleanup and failure behavior](#cleanup-and-failure-behavior)
- [Errors and capability rules](#errors-and-capability-rules)

## Import

```js
const {
	EVENT_MANAGER,
	EventListener,
	EventManager,
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/manager");
```

Importing requires the selected build's native `events/manager` module and its `FireEvent` function; missing capabilities throw instead of installing fallback functions. The live `IGameEventManager2` interface is checked by engine-facing operations, not by this import.

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| `EVENT_MANAGER` | live `EventManager` singleton | callbacks registered through top-level `RegisterEventListener` |
| [`EventListener`](#eventlistener) | `new EventListener(strEventName)` | JavaScript callback array for one event |
| [`EventManager`](#eventmanager) | `new EventManager()` | independent managed listener map |
| [`FireEvent`](#fireevent) | `FireEvent(strName, Payload?, bDoNotBroadcast?)` | native success `boolean` |
| `RegisterEventListener` | `RegisterEventListener(strEventName, Callback)` | `true`, or an exception when registration fails |
| `UnregisterEventListener` | `UnregisterEventListener(strEventName, Callback)` | `true`, or an exception when no exact registration exists |

Only these six names are exported. The classes are implemented in JavaScript; `FireEvent` and engine-listener registration behind each manager call the native `events/manager` module directly.

## Choosing an event layer

| Requirement | Module or operation |
| --- | --- |
| Direct native listener functions only | [`events/listener`](events-listener.md) |
| Managed callback arrays and automatic last-listener removal | `events/manager` |
| Local object or JSON dispatch without an engine event | `EventManager.DispatchEvent` |
| Intercept `IGameEventManager2::FireEvent` before listeners | [`memory/hooks/events`](memory-hooks-events.md) |
| Declare payload schemas and build event resources | [`events/custom`](events-custom.md) |

`EventManager.DispatchEvent` and `FireEvent` are deliberately different. `DispatchEvent` invokes one manager's JavaScript callbacks only. Setting up that manager through `RegisterEventListener` or `GetEventListener` still registers a native listener; use a standalone `EventListener.DispatchGameEvent` when no engine registration is wanted. `FireEvent` allocates and fires a real engine event, so other registered native listeners can observe it; it is not a private plugin message.

## `EventListener`

```text
new EventListener(strEventName)
```

`EventListener` extends `Array`. The constructor requires one non-empty string event name and creates a stable engine callback for that name.

### Fields and inherited state

| Field | Type | Meaning |
| --- | --- | --- |
| `EventName` | `string` | Validated event name owned by this listener. |
| `EngineCallback` | `function` | Stable function passed to native `RegisterEventListener` and `UnregisterEventListener`. |
| `length` | `number` | Current callback count inherited from `Array`. |
| `[index]` | `function` | Callback at an array index. |

Iteration and non-mutating `Array` methods work normally. Derived arrays created by `map`, `filter`, `slice`, and similar methods are plain arrays because `EventListener[Symbol.species]` is `Array`.

Use `AppendEventCallback`/`RemoveEventCallback` for mutation. Calling inherited `push`, `splice`, or assigning indices bypasses callback validation and can break manager ownership.

### Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `AppendEventCallback(Callback)` | the same callback | Requires a function and rejects duplicate identity. |
| `RemoveEventCallback(Callback)` | the same callback | Removes the exact callback or throws when absent. |
| `DispatchGameEvent(GameEvent)` | `true` | Dispatches a snapshot of the current callback array. |

`DispatchGameEvent` accepts a live native event or an object exposing `EventName` plus `GetEventValue`/`GetEventString`. This is a shape check, not validation that the event name matches this listener or that a native view remains active. Each callback exception is reported through `EXCEPTION_HOOKS.PrintException(EventError, { Source: "events/manager" })`; later callbacks run if reporting succeeds. If the exception reporter itself throws, that failure escapes this managed dispatch and stops its remaining callbacks. Adding or removing callbacks during dispatch affects a later dispatch because the current callback list is copied first.

Callbacks within one managed listener receive the same event object, not separate clones. Separate native registrations can receive different JavaScript views over the same native event; neither form extends the event's dispatch lifetime.

This standalone listener can drive application-level tests without registering an engine listener:

```js
const { EventListener } = require("events/manager");

const g_VerifyStandaloneEventListener = () => {
	const vecObservedEventValues = [];
	const vecStandaloneEventListener = new EventListener("SourceJSLocalProbe");

	const ObserveEventValue = (EventValue) => {
		vecObservedEventValues.push(EventValue.GetEventValue("Value", 0));
	};

	if (vecStandaloneEventListener.EventName !== "SourceJSLocalProbe") {
		throw new Error("The standalone listener exposed an unexpected event name.");
	}

	if (vecStandaloneEventListener.AppendEventCallback(ObserveEventValue) !== ObserveEventValue) {
		throw new Error("The standalone listener did not retain the callback identity.");
	}

	if (!vecStandaloneEventListener.DispatchGameEvent({
		EventName: "SourceJSLocalProbe",
		GetEventValue(strEventKey, DefaultValue) {
			return (strEventKey === "Value") ? 7 : DefaultValue;
		},
	})) {
		throw new Error("The standalone event dispatch failed.");
	}

	if (vecStandaloneEventListener.RemoveEventCallback(ObserveEventValue) !== ObserveEventValue) {
		throw new Error("The standalone listener removed a different callback.");
	}

	if ((vecObservedEventValues[0] !== 7) || (vecStandaloneEventListener.length !== 0)) {
		throw new Error("Standalone event dispatch failed.");
	}
};

g_VerifyStandaloneEventListener();
```

## Callback event objects

Callbacks reached through a real native `FireEvent` or normal engine dispatch receive the same live native event shape documented by [`events/listener`](events-listener.md).

### Native fields

| Field | Type | Meaning |
| --- | --- | --- |
| `EventName` | `string` | Snapshot of the native event name when this view is created. |
| `Reliable` | `boolean` | Snapshot of `IGameEvent::IsReliable()` when this view is created. |
| `Local` | `boolean` | Snapshot of `IGameEvent::IsLocal()` when this view is created. |
| `Address` | `bigint` | Borrowed native `IGameEvent*` address represented losslessly as a JavaScript `bigint`. |

### Native methods

| Method | Result |
| --- | --- |
| `IsEventEmpty(strKey?)` | event/key emptiness `boolean` |
| `GetEventBoolean(strKey, bDefaultValue?)` | `boolean` |
| `GetEventInteger(strKey, nDefaultValue?)` | signed `number` |
| `GetEventUInt64(strKey, unDefaultValue?)` | unsigned `bigint`; omitted on older SDKs |
| `GetEventFloat(strKey, dblDefaultValue?)` | native `float` represented as a `number`; finiteness is not checked on reads |
| `GetEventString(strKey, strDefaultValue?)` | `string` |
| `SetEventBoolean(strKey, bValue)` | `true` |
| `SetEventInteger(strKey, nValue)` | `true` |
| `SetEventUInt64(strKey, unValue)` | `true`; omitted with the UInt64 getter |
| `SetEventFloat(strKey, dblValue)` | `true` |
| `SetEventString(strKey, strValue)` | `true` |

Provided key names are non-empty strings. Defaults and writes use their exact JavaScript types; float defaults and writes must fit the native finite `float` range. The float getter returns the native value without a finiteness check; validate it before calculations that require finite inputs. Native setter changes are write-through: later callbacks in the same SourceJS dispatch observe earlier changes. Ordering relative to listeners outside SourceJS is engine-controlled.

This example normalizes the string value of Source's built-in `server_cvar` event before another callback consumes it:

```js
const { EventManager, FireEvent } = require("events/manager");

const g_VerifyManagedWriteThrough = () => {
	const mapConVarEvents = new EventManager();
	const vecObservedConVarValues = [];
	let bConVarNormalizerRegistered = false;
	let bConVarCollectorRegistered = false;

	const NormalizeConVarValue = (EventValue) => {
		if (!EventValue.SetEventString("cvarvalue", EventValue.GetEventString("cvarvalue", "").trim())) {
			throw new Error("Could not normalize the cvarvalue event field.");
		}
	};

	const CollectConVarValue = (EventValue) => {
		vecObservedConVarValues.push(EventValue.GetEventString("cvarvalue", ""));
	};

	try {
		if (!mapConVarEvents.RegisterEventListener("server_cvar", NormalizeConVarValue)) {
			throw new Error("Could not register the server-cvar normalizer.");
		}

		bConVarNormalizerRegistered = true;

		if (!mapConVarEvents.RegisterEventListener("server_cvar", CollectConVarValue)) {
			throw new Error("Could not register the server-cvar collector.");
		}

		bConVarCollectorRegistered = true;

		if (!FireEvent("server_cvar", { cvarname: "sourcejs_manager_metric", cvarvalue: " -4 " }, true)) {
			throw new Error("The engine rejected the server_cvar event.");
		}
	} finally {
		try {
			if (bConVarCollectorRegistered && !mapConVarEvents.UnregisterEventListener("server_cvar", CollectConVarValue)) {
				throw new Error("Could not remove the server-cvar collector.");
			}
		} finally {
			if (bConVarNormalizerRegistered && !mapConVarEvents.UnregisterEventListener("server_cvar", NormalizeConVarValue)) {
				throw new Error("Could not remove the server-cvar normalizer.");
			}
		}
	}

	if (vecObservedConVarValues[0] !== "-4") {
		throw new Error("The normalized value did not reach the second callback.");
	}
};

g_VerifyManagedWriteThrough();
```

Native views expire after callback dispatch. `EventValue.Address` is diagnostic only; copy fields such as `nUserID`, weapon name, or team number for delayed work.

## `EventManager`

```text
new EventManager()
```

`EventManager` extends `Map<string, EventListener>`. Its inherited `size`, `has`, `get`, `keys`, `values`, `entries`, and iteration operations reflect the currently managed event names and listeners.

Do not use inherited `set` or `delete` for normal registration. They bypass native listener ownership. Use `RegisterEventListener`, `UnregisterEventListener`, and `Clear`. The standard `Map.clear()` name is deliberately overridden to perform the same native-listener cleanup as `Clear()`; calling `Map.prototype.clear` directly would bypass ownership.

### Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `GetEventListener(strEventName)` | `EventListener` | Returns the existing listener, or creates one and stores it after successful native registration. |
| `RegisterEventListener(strEventName, Callback)` | `true` | Adds one exact callback; creates a native registration only when this manager has no listener for the name. `GetEventListener` can already have registered an empty collection. |
| `UnregisterEventListener(strEventName, Callback)` | `true` | Removes one exact callback; the last callback removes the native listener and map entry. |
| `DispatchEvent(strEventName, Payload = {})` | `boolean` | Locally dispatches to this manager; returns `false` when the name has no listener. |
| `AddNativeEventListener(ListenerDescriptor)` | native `boolean` | Registers an object exposing `EventName` and `EngineCallback`. |
| `RemoveNativeEventListener(ListenerDescriptor)` | native `boolean` | Unregisters an object exposing `EventName` and `EngineCallback`. |
| `Clear()` | `true` | Removes every native listener owned by this manager, then empties it. |

Independent managers are useful when one component needs a self-contained lifecycle:

```js
const { EventManager } = require("events/manager");

const g_VerifyIndependentEventManager = () => {
	const mapRoundEvents = new EventManager();
	const vecRoundWinners = [];

	const RecordRoundWinner = (EventValue) => {
		vecRoundWinners.push(EventValue.GetEventValue("winner", 0));
	};

	if (!mapRoundEvents.RegisterEventListener("round_end", RecordRoundWinner)) {
		throw new Error("Could not register the managed round listener.");
	}

	try {
		if (!mapRoundEvents.DispatchEvent("round_end", { winner: 2 })) {
			throw new Error("Could not dispatch the local round event.");
		}
	} finally {
		if (!mapRoundEvents.UnregisterEventListener("round_end", RecordRoundWinner)) {
			throw new Error("Could not unregister the managed round listener.");
		}
	}

	if ((vecRoundWinners[0] !== 2) || (mapRoundEvents.size !== 0)) {
		throw new Error("The managed round listener was not cleaned up.");
	}
};

g_VerifyIndependentEventManager();
```

`GetEventListener` returns stable identity while the registration exists:

```js
const { EventManager } = require("events/manager");

const g_VerifyStableListenerIdentity = () => {
	const mapIdentityEvents = new EventManager();
	const RecordPlayerDisconnectIdentity = () => {
	};
	if (!mapIdentityEvents.RegisterEventListener("player_disconnect", RecordPlayerDisconnectIdentity)) {
		throw new Error("Could not register the identity probe.");
	}

	try {
		const vecFirstEventListener = mapIdentityEvents.GetEventListener("player_disconnect");
		const vecSecondEventListener = mapIdentityEvents.GetEventListener("player_disconnect");
		if ((vecFirstEventListener !== vecSecondEventListener) || (vecFirstEventListener[0] !== RecordPlayerDisconnectIdentity)) {
			throw new Error("The managed listener identity changed.");
		}
	} finally {
		if (!mapIdentityEvents.UnregisterEventListener("player_disconnect", RecordPlayerDisconnectIdentity)) {
			throw new Error("Could not unregister the identity probe.");
		}
	}
};

g_VerifyStableListenerIdentity();
```

## `EVENT_MANAGER`, `RegisterEventListener`, and `UnregisterEventListener`

Top-level `RegisterEventListener`/`UnregisterEventListener` delegate to the plugin context's live `EVENT_MANAGER` singleton. Callback identity matters: removal must receive the same function object passed during registration.

```js
const {
	EVENT_MANAGER,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/manager");

const g_vecPlayerDisconnects = [];

const g_RecordPlayerDisconnect = (EventValue) => {
	g_vecPlayerDisconnects.push({ PlayerName: EventValue.GetEventString("name", "unknown"), DisconnectReason: EventValue.GetEventString("reason", "unknown"), UserID: EventValue.GetEventInteger("userid", 0) });
};

if (!RegisterEventListener("player_disconnect", g_RecordPlayerDisconnect)) {
	throw new Error("Could not register player_disconnect.");
}

if (!EVENT_MANAGER.has("player_disconnect")) {
	throw new Error("The callback was not added to EVENT_MANAGER.");
}

const g_UnloadPlugin = () => {
	if (!UnregisterEventListener("player_disconnect", g_RecordPlayerDisconnect)) {
		throw new Error("Could not unregister player_disconnect.");
	}
};

module.exports = { Unload: g_UnloadPlugin };
```

SourceJS also removes callbacks owned by an unloading plugin runtime, but an explicit `Unload` export keeps component lifecycle and test cleanup visible. This case-sensitive SourceJS-owned lifecycle name matches the dispatcher; no lowercase alias is installed.

## `FireEvent`

```text
FireEvent(strName, Payload = {}, bDoNotBroadcast = false) -> boolean
```

`FireEvent` delegates directly to the native module. The name is a non-empty string, the payload is a non-array object, and `bDoNotBroadcast` is an exact boolean. Boolean values use `SetBool`; numbers recognized by V8 as signed `int32` values use `SetInt`, while other numbers must convert to a finite in-range native `float`; strings use `SetString`. Unsigned `bigint` values use `SetUint64` only when the selected SDK supports UInt64. Unsupported values fail before `IGameEventManager2::FireEvent`; an event allocated before a conversion failure is freed.

Native payload enumeration includes only own enumerable string keys, not inherited fields, non-enumerable fields, or symbols. The built-in `server_cvar`, `cvarname`, and `cvarvalue` spellings below are exact external engine names, not project-owned keys to rename.

The event name must exist in the engine's loaded event resource. For custom schemas, define the event through [`events/custom`](events-custom.md) and package/load its generated resource before firing it.

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/manager");

const g_VerifyNativeEventFire = () => {
	let ReceivedConVarPayload = null;

	const RecordServerConVar = (EventValue) => {
		ReceivedConVarPayload = { ConVarName: EventValue.GetEventString("cvarname", ""), ConVarValue: EventValue.GetEventString("cvarvalue", "") };
	};

	if (!RegisterEventListener("server_cvar", RecordServerConVar)) {
		throw new Error("Could not register the server_cvar listener.");
	}

	try {
		if (!FireEvent("server_cvar", { cvarname: "sourcejs_documented_metric", cvarvalue: "3" }, true)) {
			throw new Error("The engine rejected the server_cvar event.");
		}
	} finally {
		if (!UnregisterEventListener("server_cvar", RecordServerConVar)) {
			throw new Error("Could not unregister the server_cvar listener.");
		}
	}

	if ((ReceivedConVarPayload === null) || (ReceivedConVarPayload.ConVarName !== "sourcejs_documented_metric") || (ReceivedConVarPayload.ConVarValue !== "3")) {
		throw new Error("The native event payload was not delivered.");
	}
};

g_VerifyNativeEventFire();
```

## Native listener adapters

`AddNativeEventListener`/`RemoveNativeEventListener` are the low-level ownership pair used by `GetEventListener` and `Clear`. They are public for custom manager implementations, but they do not add or remove map entries themselves. Adapter objects must expose `EventName` and `EngineCallback`.

```js
const {
	EventListener,
	EventManager,
	FireEvent,
} = require("events/manager");

const g_VerifyNativeListenerAdapters = () => {
	const mapAdapterEvents = new EventManager();
	const vecAdapterEventListener = new EventListener("server_cvar");
	let strObservedConVarValue = null;

	const ObserveConVarValue = (EventValue) => {
		strObservedConVarValue = EventValue.GetEventString("cvarvalue", "");
	};

	if (vecAdapterEventListener.AppendEventCallback(ObserveConVarValue) !== ObserveConVarValue) {
		throw new Error("The adapter listener did not retain its callback.");
	}

	if (!mapAdapterEvents.AddNativeEventListener(vecAdapterEventListener)) {
		throw new Error("Could not register the native adapter listener.");
	}

	try {
		if (!FireEvent("server_cvar", { cvarname: "sourcejs_adapter_probe", cvarvalue: "9" }, true)) {
			throw new Error("The engine rejected the adapter probe.");
		}
	} finally {
		if (!mapAdapterEvents.RemoveNativeEventListener(vecAdapterEventListener)) {
			throw new Error("Could not remove the native adapter listener.");
		}
	}

	if (vecAdapterEventListener.RemoveEventCallback(ObserveConVarValue) !== ObserveConVarValue) {
		throw new Error("The adapter listener did not release its callback.");
	}

	if ((strObservedConVarValue !== "9") || (mapAdapterEvents.size !== 0)) {
		throw new Error("The adapter listener did not preserve manual ownership.");
	}
};

g_VerifyNativeListenerAdapters();
```

The native examples use the built-in `server_cvar` schema so they do not depend on an uninstalled custom resource. `bDoNotBroadcast` suppresses client delivery only; other server-side listeners still observe these diagnostic events.

Removal requires the same `EventName` value and `EngineCallback` function identity used for registration; adapter object identity itself is not the native key. Keep both fields stable while the registration is active.

## Local `DispatchEvent`

```text
mapEventListeners.DispatchEvent(strEventName, Payload = {}) -> boolean
```

`DispatchEvent` does not call native `FireEvent`. It invokes only the listener currently stored under `strEventName` in that manager.

Payload handling is exact:

- omitted, `undefined`, `null`, and `""` become `{}`;
- a non-empty string is parsed with `JSON.parse` and parse errors propagate;
- a live/dispatched event object exposing `EventName` plus `GetEventValue`/`GetEventString` is passed through unchanged;
- every other value becomes the synthetic event's `EventPayload` unchanged.

A synthetic local event has these fields and method:

| Member | Type | Meaning |
| --- | --- | --- |
| `EventName` | `string` | Name passed to `DispatchEvent`. |
| `EventPayload` | any | Parsed or original payload. |
| `RawEventPayload` | any | Effective payload before JSON parsing; omitted/`undefined` arguments have already defaulted to `{}`. |
| `GetEventValue(strEventKey, DefaultValue = undefined)` | function | Reads an own property, including a non-enumerable one, from an object payload or returns the default. |

It deliberately has no native `Address`, reliability/local flags, typed getters, or setters. The payload is not cloned: object values retain identity, and an own-property getter runs when `GetEventValue` reads it. Inherited keys are ignored. `null` and `""` remain distinguishable in `RawEventPayload` even though both produce an empty `EventPayload`. A passed-through event retains its original name and methods; local dispatch does not revive an expired native view. Use `GetEventValue` for synthetic local payloads; code shared with native dispatch must account for its typed getters or provide an explicit adapter.

```js
const { EventManager } = require("events/manager");

const g_VerifyLocalJSONDispatch = () => {
	const mapCacheEvents = new EventManager();
	const vecCacheStates = [];

	const RecordCacheRefresh = (EventValue) => {
		vecCacheStates.push({ RefreshReason: EventValue.GetEventValue("Reason", "manual"), Revision: EventValue.GetEventValue("Revision", 0), RawEventPayload: EventValue.RawEventPayload });
	};

	if (!mapCacheEvents.RegisterEventListener("server_cvar", RecordCacheRefresh)) {
		throw new Error("Could not register the local cache-refresh listener.");
	}

	try {
		if (!mapCacheEvents.DispatchEvent("server_cvar", "{\"Reason\":\"config\",\"Revision\":4}")) {
			throw new Error("No local listener received the refresh event.");
		}
	} finally {
		if (!mapCacheEvents.UnregisterEventListener("server_cvar", RecordCacheRefresh)) {
			throw new Error("Could not unregister the local cache-refresh listener.");
		}
	}

	if ((vecCacheStates.length !== 1) || (vecCacheStates[0].Revision !== 4) || (typeof vecCacheStates[0].RawEventPayload !== "string")) {
		throw new Error("The local JSON event was not parsed correctly.");
	}
};

g_VerifyLocalJSONDispatch();
```

Dispatching an unknown name returns `false` without parsing the payload:

```js
const { EventManager } = require("events/manager");

const g_VerifyUnknownLocalEvent = () => {
	const mapMissingListeners = new EventManager();
	if (mapMissingListeners.DispatchEvent("SourceJSMissingLocalListener", "{") !== false) {
		throw new Error("An unknown local event should not be dispatched.");
	}
};

g_VerifyUnknownLocalEvent();
```

## Cleanup and failure behavior

The manager preserves ownership at each native boundary:

- `GetEventListener` stores a new listener only after native `RegisterEventListener` succeeds;
- invalid or duplicate callbacks do not create an extra native listener;
- removal of the last callback calls native `UnregisterEventListener` before changing the listener or map;
- failed last-listener removal leaves the callback and map entry intact;
- removing a non-final callback does not touch the native listener;
- `Clear` removes and deletes entries one at a time; the standard `Map.clear()` override performs the same cleanup.

Because cleanup is sequential, a failed removal leaves the failing and later JavaScript entries owned by the manager while earlier entries remain removed. A `false` native result becomes an exception identifying the event name; a thrown exception propagates. It is not an all-or-nothing transaction. Retained JavaScript entries do not prove that native engine delivery remains healthy; treat failed native registration/removal as a lifecycle failure.

Use `Clear` when an isolated component owns every listener in its manager:

```js
const { EventManager } = require("events/manager");

const g_VerifyEventManagerClear = () => {
	const mapComponentEvents = new EventManager();
	const HandleServerConVarEvent = () => {
	};
	const HandlePlayerDisconnectEvent = () => {
	};

	try {
		if (!mapComponentEvents.RegisterEventListener("server_cvar", HandleServerConVarEvent)) {
			throw new Error("Could not register the component cvar listener.");
		}

		if (!mapComponentEvents.RegisterEventListener("player_disconnect", HandlePlayerDisconnectEvent)) {
			throw new Error("Could not register the component disconnect listener.");
		}

		if (mapComponentEvents.size !== 2) {
			throw new Error("The component listeners were not registered.");
		}
	} finally {
		if ((mapComponentEvents.size > 0) && !mapComponentEvents.Clear()) {
			throw new Error("The component manager did not clear its listeners.");
		}
	}

	if (mapComponentEvents.size !== 0) {
		throw new Error("The component listeners were not cleared.");
	}
};

g_VerifyEventManagerClear();
```

Do not call `EVENT_MANAGER.Clear()` or its standard `Map.clear()` override from ordinary plugin code unless that plugin intentionally owns every top-level managed callback. Either operation removes all callbacks registered through this module in the current isolated plugin context.

## Errors and capability rules

- Event names must be non-empty strings.
- Callbacks must be functions, and duplicate callback identity is rejected.
- `UnregisterEventListener`/`EventManager.UnregisterEventListener` throw for unknown event names or callbacks.
- `EventListener.DispatchGameEvent` requires `EventName` plus `GetEventValue`/`GetEventString` and rejects other object shapes.
- Local JSON syntax errors propagate from `JSON.parse` only when a matching listener exists.
- Native listener registration/removal failures throw; JavaScript ownership is committed only after success. This is not a guarantee of native engine-listener recovery.
- Callback exceptions do not stop later managed callbacks while exception reporting succeeds; a failure in the exception reporter propagates from the managed dispatcher.
- Native event methods reject detached views after the SourceJS callback dispatch returns.
- Native `GetEventUInt64` and `SetEventUInt64` methods are omitted when the selected SDK lacks those `IGameEvent` methods.
- Importing requires the installed native `events/manager` module and its `FireEvent` function; there is no JavaScript fallback. Live `IGameEventManager2` availability is a separate requirement of engine-facing operations.

For payload type details and the full native event lifecycle, see [`events`](events.md). For pre-dispatch suppression or trampoline control, see [`memory/hooks/events`](memory-hooks-events.md).
