# `require("events/listener")`

> Warning: callbacks receive a live native event view that expires when dispatch returns. Copy scalar values needed by delayed work; never retain the address for later use.

The [JavaScript wrapper](../../packages/sourcejs/events/listener.js) is the focused game-event listener surface. It registers callbacks owned by the current plugin's V8 context through a real shared server-side `IGameEventListener2`; the [native runtime](../../src/sourcejs/V8Runtime.cpp) dispatches live `IGameEvent` views. Use registration, removal, and firing on the game/server thread with a live plugin context. Their engine-facing steps require the native event manager; not every local callback-list update queries it.

## Contents

- [Import](#import)
- [Exports](#exports)
- [`RegisterEventListener`](#registereventlistener)
- [Callback event](#callback-event)
- [Write-through and ordering](#write-through-and-ordering)
- [`UnregisterEventListener`](#unregistereventlistener)
- [`FireEvent`](#fireevent)
- [Plugin lifecycle](#plugin-lifecycle)
- [Errors and capability rules](#errors-and-capability-rules)

## Import

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/listener");
```

`FireEvent` binds the native function directly. The registration functions keep callback wrappers so duplicate registrations of the same JavaScript function can be removed individually. Importing requires the selected build's native `events/listener` module; an unavailable module throws instead of returning fallback functions. The live event manager is checked by engine-facing operations, not by this import.

## Exports

| Export | Signature | Result | Responsibility |
| --- | --- | --- | --- |
| [`FireEvent`](#fireevent) | `FireEvent(strName, Payload?, bDoNotBroadcast?)` | `boolean` | Create and fire a real `IGameEvent`. |
| [`RegisterEventListener`](#registereventlistener) | `RegisterEventListener(strEventName, Callback)` | `boolean` | Register a callback through `IGameEventManager2::AddListener`. |
| [`UnregisterEventListener`](#unregistereventlistener) | `UnregisterEventListener(strEventName, Callback)` | `boolean` | Remove the first matching callback owned by this plugin runtime. |

These three canonical functions are the complete package surface. No lowercase aliases are installed.

Use [`events/manager`](events-manager.md) when JavaScript-owned listener collections and JSON dispatch are useful. Use [`memory/hooks/events`](memory-hooks-events.md) when `FireEvent` must be intercepted before normal listener dispatch.

## `RegisterEventListener`

```text
RegisterEventListener(strEventName, Callback) -> boolean
```

The first callback for an event name calls `IGameEventManager2::AddListener`. Additional callbacks in the same SourceJS runtime share that engine listener. Native registration returns `false` for an uninitialized runtime, an unavailable manager when a new engine listener is needed, or a rejected runtime/engine registration. Appending to an existing callback group does not query the manager again. Invalid arguments or missing callback-runtime data throw synchronously, and native C++ failures are translated to errors; do not treat every failure as a `false` result.

The package commits its callback-wrapper record only after native registration succeeds. A failed registration or thrown validation error does not leave a pending wrapper ahead of a subsequent retry.

This example observes player disconnects and copies only values safe to retain:

```js
const {
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/listener");

const g_vecPlayerDisconnects = [];

const g_RecordPlayerDisconnect = (EventValue) => {
	g_vecPlayerDisconnects.push({
		Bot: EventValue.GetEventBoolean("bot", false),
		UserID: EventValue.GetEventInteger("userid", 0),
		PlayerName: EventValue.GetEventString("name", "unknown"),
		DisconnectReason: EventValue.GetEventString("reason", "no reason supplied"),
	});
};

if (!RegisterEventListener("player_disconnect", g_RecordPlayerDisconnect)) {
	throw new Error("Could not register player_disconnect.");
}

function UnloadPlugin() {
	if (!UnregisterEventListener("player_disconnect", g_RecordPlayerDisconnect)) {
		throw new Error("Could not unregister player_disconnect.");
	}
}

module.exports = { Unload: UnloadPlugin };
```

The case-sensitive `Unload` export is a SourceJS-owned lifecycle property; use it directly, without lowercase aliases. In contrast, `player_disconnect` and its lowercase field keys are exact external engine names. The callback runs in the V8 context that registered it. SourceJS catches ordinary JavaScript callback exceptions, reports them through the runtime logger, and continues dispatching the remaining callbacks. A successful `FireEvent()` result does not prove every callback succeeded.

## Callback event

Every callback receives a new JavaScript view over the same native event currently being dispatched.

### Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `EventName` | `string` | Native event name. |
| `Reliable` | `boolean` | Snapshot of `IGameEvent::IsReliable()` when this view is created. |
| `Local` | `boolean` | Snapshot of `IGameEvent::IsLocal()` when this view is created. |
| `Address` | `bigint` | Borrowed native address represented losslessly as a JavaScript `bigint`. |

### Methods

| Method | Result | Native behavior |
| --- | --- | --- |
| `IsEventEmpty(strKey?)` | `boolean` | Query the event or one non-empty string key. |
| `GetEventBoolean(strKey, bDefaultValue?)` | `boolean` | Call `GetBool`; default must be boolean. |
| `GetEventInteger(strKey, nDefaultValue?)` | `number` | Call `GetInt`; default must fit `int32`. |
| `GetEventUInt64(strKey, unDefaultValue?)` | `bigint` | Call `GetUint64`; omitted when the SDK lacks UInt64 methods. |
| `GetEventFloat(strKey, dblDefaultValue?)` | `number` | Call `GetFloat`; default must be finite and fit native `float`. |
| `GetEventString(strKey, strDefaultValue?)` | `string` | Call `GetString`; default must be a string. |
| `SetEventBoolean(strKey, bValue)` | `true` | Write an exact boolean with `SetBool`. |
| `SetEventInteger(strKey, nValue)` | `true` | Write an `int32` with `SetInt`. |
| `SetEventUInt64(strKey, unValue)` | `true` | Write an unsigned 64-bit `bigint`; omitted with the UInt64 getter. |
| `SetEventFloat(strKey, dblValue)` | `true` | Write a finite native-float value. |
| `SetEventString(strKey, strValue)` | `true` | Write an exact string. |

The custom-event probes below initialize dedicated definitions through [`events/resource`](events-resource.md) before registering or firing. Resource writing and loading are synchronous filesystem/engine operations on the game thread: initialize once during plugin startup, then reuse the loaded definitions; do not run these initialization probes on every tick. Writing needs permission under `paths.EVENT_ROOT`, and a positive integer load count is required. Forced event creation does not invent unknown definitions.

This custom event exercises every always-available typed accessor and requires both UInt64 methods from the selected SDK. `Sequence` is a server-only `local` field, not a networked 64-bit field; its absent-value default and subsequent write use `bigint`. The capability guard runs before any field writes:

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/listener");

const { EventResourceFile } = require("events/resource");

function InitializeAndVerifyMetricEvent() {
	const EventResource = new EventResourceFile("examples/SourceJSListenerMetric.res", { EventName: "SourceJSListenerMetric", EventVariables: { Active: "bool", Count: "long", Duration: "float", Label: "string", Sequence: "local" } });
	EventResource.WriteEventResourceFile();

	const nLoadedEventCount = EventResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the SourceJSListenerMetric event definition.");
	}

	let bMetricInspected = false;

	const InspectMetricEvent = (EventValue) => {
		const bEventNameValid = EventValue.EventName === "SourceJSListenerMetric";
		const bEventAddressValid = (typeof EventValue.Address === "bigint") && (EventValue.Address > 0n);
		if (!bEventNameValid || !bEventAddressValid) {
			throw new Error("Invalid live event metadata.");
		}

		if ((typeof EventValue.GetEventUInt64 !== "function") || (typeof EventValue.SetEventUInt64 !== "function")) {
			throw new Error("The selected SDK does not expose UInt64 event accessors.");
		}

		const bActive = EventValue.GetEventBoolean("Active", false);
		const nMetricCount = EventValue.GetEventInteger("Count", 0);
		const flMetricDuration = EventValue.GetEventFloat("Duration", 0.0);
		const strMetricLabel = EventValue.GetEventString("Label", "unknown");
		if (!EventValue.SetEventBoolean("Active", bActive)) {
			throw new Error("Could not write the active event field.");
		}

		if (!EventValue.SetEventInteger("Count", nMetricCount + 1)) {
			throw new Error("Could not write the count event field.");
		}

		if (!EventValue.SetEventFloat("Duration", Math.max(flMetricDuration, 0.0))) {
			throw new Error("Could not write the duration event field.");
		}

		if (!EventValue.SetEventString("Label", strMetricLabel.trim())) {
			throw new Error("Could not write the label event field.");
		}

		const unMetricSequence = EventValue.GetEventUInt64("Sequence", 0n);
		if (!EventValue.SetEventUInt64("Sequence", unMetricSequence + 1n)) {
			throw new Error("Could not write the sequence event field.");
		}

		if (EventValue.IsEventEmpty("Label") || EventValue.IsEventEmpty()) {
			throw new Error("The event unexpectedly lost its payload.");
		}

		bMetricInspected = (typeof EventValue.Reliable === "boolean") && (typeof EventValue.Local === "boolean");
	};

	if (!RegisterEventListener("SourceJSListenerMetric", InspectMetricEvent)) {
		throw new Error("Could not register the metric listener.");
	}

	try {
		if (!FireEvent("SourceJSListenerMetric", { Active: true, Count: 4, Duration: 2.5, Label: "dispatch" }, true)) {
			throw new Error("Could not fire the metric event.");
		}
	} finally {
		if (!UnregisterEventListener("SourceJSListenerMetric", InspectMetricEvent)) {
			throw new Error("Could not unregister the metric listener.");
		}
	}

	if (!bMetricInspected) {
		throw new Error("The metric listener did not complete its inspection.");
	}
}

InitializeAndVerifyMetricEvent();
```

Typed methods resolve the active event through an internal dispatch token. Once the callback chain returns, the metadata fields remain ordinary JavaScript values, but every method throws rather than touching stale memory:

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/listener");

const { EventResourceFile } = require("events/resource");

function InitializeAndVerifyEventViewExpiry() {
	const EventResource = new EventResourceFile("examples/SourceJSExpiryProbe.res", { EventName: "SourceJSExpiryProbe", EventVariables: { State: "string" } });
	EventResource.WriteEventResourceFile();

	const nLoadedEventCount = EventResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the SourceJSExpiryProbe event definition.");
	}

	let RetainedEvent = null;

	const RetainEventView = (EventValue) => {
		RetainedEvent = EventValue;
	};

	if (!RegisterEventListener("SourceJSExpiryProbe", RetainEventView)) {
		throw new Error("Could not register the expiry probe.");
	}

	try {
		if (!FireEvent("SourceJSExpiryProbe", { State: "live" }, true)) {
			throw new Error("Could not fire the expiry probe.");
		}
	} finally {
		if (!UnregisterEventListener("SourceJSExpiryProbe", RetainEventView)) {
			throw new Error("Could not unregister the expiry probe.");
		}
	}

	if ((RetainedEvent === null) || (RetainedEvent.EventName !== "SourceJSExpiryProbe")) {
		throw new Error("Detached metadata is incorrect.");
	}

	try {
		RetainedEvent.GetEventString("State");
		throw new Error("The detached event remained callable.");
	} catch (ErrorValue) {
		if (!String(ErrorValue.message).includes("after its callback has returned")) {
			throw ErrorValue;
		}
	}
}

InitializeAndVerifyEventViewExpiry();
```

## Write-through and ordering

Setter calls modify the same native `IGameEvent`. Later callbacks registered in the same SourceJS runtime currently observe those writes in registration order:

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/listener");

const { EventResourceFile } = require("events/resource");

function InitializeAndVerifyListenerWriteThrough() {
	const EventResource = new EventResourceFile("examples/SourceJSOrderProbe.res", { EventName: "SourceJSOrderProbe", EventVariables: { Count: "long" } });
	EventResource.WriteEventResourceFile();

	const nLoadedEventCount = EventResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the SourceJSOrderProbe event definition.");
	}

	let nObservedEventCount = -1;

	const NormalizeEventCount = (EventValue) => {
		if (!EventValue.SetEventInteger("Count", Math.max(EventValue.GetEventInteger("Count", 0), 0))) {
			throw new Error("Could not normalize the count field.");
		}
	};

	const ConsumeEventCount = (EventValue) => {
		nObservedEventCount = EventValue.GetEventInteger("Count", -1);
	};

	let bCountNormalizerRegistered = false;
	let bCountConsumerRegistered = false;

	try {
		if (!RegisterEventListener("SourceJSOrderProbe", NormalizeEventCount)) {
			throw new Error("Could not register the count normalizer.");
		}

		bCountNormalizerRegistered = true;

		if (!RegisterEventListener("SourceJSOrderProbe", ConsumeEventCount)) {
			throw new Error("Could not register the count consumer.");
		}

		bCountConsumerRegistered = true;

		if (!FireEvent("SourceJSOrderProbe", { Count: -9 }, true)) {
			throw new Error("Could not fire the ordering probe.");
		}
	} finally {
		try {
			if (bCountConsumerRegistered && !UnregisterEventListener("SourceJSOrderProbe", ConsumeEventCount)) {
				throw new Error("Could not remove the count consumer.");
			}
		} finally {
			if (bCountNormalizerRegistered && !UnregisterEventListener("SourceJSOrderProbe", NormalizeEventCount)) {
				throw new Error("Could not remove the count normalizer.");
			}
		}
	}

	if (nObservedEventCount !== 0) {
		throw new Error("The second callback did not see the normalized count.");
	}
}

InitializeAndVerifyListenerWriteThrough();
```

Do not extend this ordering assumption to engine listeners outside SourceJS. Their position relative to SourceJS is controlled by the engine.

The runtime snapshots its callback list when dispatch begins. Registering or unregistering a callback during that dispatch does not rewrite the current snapshot: a removed callback already captured in it can still run, and a newly registered callback is eligible for a later dispatch, including a nested synchronous one. The snapshot spans registered plugin contexts in the same runtime; their separate JavaScript views still borrow the same native event.

## `UnregisterEventListener`

```text
UnregisterEventListener(strEventName, Callback) -> boolean
```

`UnregisterEventListener()` compares callback identity in the current plugin context and removes the first matching registration. Registering the same function twice creates two registrations, so two successful removals are required:

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events/listener");

const { EventResourceFile } = require("events/resource");

function InitializeAndVerifyDuplicateRegistrationRemoval() {
	const EventResource = new EventResourceFile("examples/SourceJSDuplicateProbe.res", { EventName: "SourceJSDuplicateProbe", EventVariables: {} });
	EventResource.WriteEventResourceFile();

	const nLoadedEventCount = EventResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the SourceJSDuplicateProbe event definition.");
	}

	let unDispatchCallCount = 0;
	let unActiveRegistrationCount = 0;

	const CountEventDispatch = () => {
		unDispatchCallCount += 1;
	};

	try {
		if (!RegisterEventListener("SourceJSDuplicateProbe", CountEventDispatch)) {
			throw new Error("Could not create the first duplicate registration.");
		}

		unActiveRegistrationCount += 1;

		if (!RegisterEventListener("SourceJSDuplicateProbe", CountEventDispatch)) {
			throw new Error("Could not create the second duplicate registration.");
		}

		unActiveRegistrationCount += 1;

		if (!FireEvent("SourceJSDuplicateProbe", {}, true)) {
			throw new Error("Could not fire the first duplicate probe.");
		}

		if ((unDispatchCallCount !== 2) || !UnregisterEventListener("SourceJSDuplicateProbe", CountEventDispatch)) {
			throw new Error("The first duplicate registration was not removed.");
		}

		unActiveRegistrationCount -= 1;

		if (!FireEvent("SourceJSDuplicateProbe", {}, true)) {
			throw new Error("Could not fire the second duplicate probe.");
		}

		if (unDispatchCallCount !== 3) {
			throw new Error("The remaining duplicate listener did not run exactly once.");
		}
	} finally {
		while (unActiveRegistrationCount > 0) {
			if (!UnregisterEventListener("SourceJSDuplicateProbe", CountEventDispatch)) {
				throw new Error("Could not remove a duplicate listener registration.");
			}

			unActiveRegistrationCount -= 1;
		}
	}
}

InitializeAndVerifyDuplicateRegistrationRemoval();
```

Passing a newly created arrow function to `UnregisterEventListener()` does not remove an earlier arrow, even if both contain identical source text.

An unsuccessful removal leaves the package's wrapper record available for retry. Successful removal discards one wrapper; after the last callback is removed, the package also releases the empty per-event registry. Removing the final runtime callback for an event can require rebuilding the shared engine listeners. A rejected rebuild returns `false`; native C++ exceptions are translated to errors after a best-effort rollback attempt. Treat either as a lifecycle failure, not proof that engine delivery remains healthy.

## `FireEvent`

```text
FireEvent(strName, Payload?, bDoNotBroadcast?) -> boolean
```

`FireEvent()` creates a real event with forced creation, writes own enumerable string-keyed payload fields through the matching native setters, and calls `IGameEventManager2::FireEvent`. Inherited fields, non-enumerable fields, and symbol keys are ignored. The definition must already be known to the native manager; forcing only permits creation without listeners.

```js
const { FireEvent } = require("events/listener");

const { EventResourceFile } = require("events/resource");

function InitializeAndVerifyListenerHealthEvent() {
	const EventResource = new EventResourceFile("examples/SourceJSListenerHealth.res", { EventName: "SourceJSListenerHealth", EventVariables: { Callbacks: "long", Duration: "float", Healthy: "bool", Module: "string" } });
	EventResource.WriteEventResourceFile();

	const nLoadedEventCount = EventResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the SourceJSListenerHealth event definition.");
	}

	const bEventFired = FireEvent("SourceJSListenerHealth", { Callbacks: 3, Duration: 0.004, Healthy: true, Module: "events/listener" }, true);
	if (!bEventFired) {
		throw new Error("The listener health event was rejected.");
	}
}

InitializeAndVerifyListenerHealthEvent();
```

Payload types and UInt64 capability rules are listed in [`events`](events.md#event-values). `bDoNotBroadcast: true` suppresses client broadcast, not server listener dispatch.

## Plugin lifecycle

Store callback functions in module-scope `g_` bindings and unregister them from the plugin's exact `Unload` export. Local probes use `try`/`finally` around registrations, including setup of a second listener, and track only successful registrations. SourceJS also removes stored callback entries owned by a V8 context during plugin destruction. Removal does not cancel callbacks already captured by an in-progress dispatch snapshot; avoid destroying plugin state that such a callback still needs.

The native listener is shared inside one runtime. Plugin JavaScript contexts are separate, but native game events are not private plugin messages: callbacks in other registered contexts or engine listeners can observe the event and its writes. For structured plugin-to-plugin messages rather than native game events or shared JavaScript objects, use the serialized [`plugins/bus`](plugins-bus.md) API.

## Errors and capability rules

- Event names and field keys must be non-empty strings without NUL; string payloads and string accessor values/defaults must also be NUL-free. SourceJS encodes input text and decodes native text as UTF-8; these APIs are not a binary channel.
- Callbacks must be functions. `UnregisterEventListener()` requires the exact function object and current V8 context.
- Payloads must be non-array objects. Values must be boolean, int32 `number`, finite float-range `number`, string, or supported unsigned `bigint`.
- Getter defaults and setter values use exact types; no truthy, numeric, or string coercion is performed.
- UInt64 methods are absent, rather than throw-only, when the selected SDK does not declare them.
- `Address` exposes the borrowed native address as a JavaScript `bigint`. Do not convert it to `number` or dereference it after dispatch.
- `UnregisterEventListener()` returns `false` for an unknown event/callback pair. Check lifecycle results during plugin load and unload.
- Normal listeners cannot prevent an event that has already entered dispatch. Use [`memory/hooks/events`](memory-hooks-events.md) for blocking or trampoline control.
