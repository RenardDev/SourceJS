# `require("events")`

> Warning: this page documents live engine event objects. Read the lifecycle section before retaining an event object or mutating one in a callback.

The `events` module creates and fires Source game events through `IGameEventManager2` and subscribes the current plugin runtime as a real server-side `IGameEventListener2`. Use native operations on the game/server thread with a live plugin context. Engine-facing steps require the live game-event manager; importing the module and constructing descriptors do not query that interface.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Event values](#event-values)
- [`FireEvent`](#fireevent)
- [`RegisterEventListener` and `UnregisterEventListener`](#registereventlistener-and-unregistereventlistener)
- [Live `GameEvent` object](#live-gameevent-object)
- [`CreateCustomEvent`](#createcustomevent)
- [`CreateEventPayload`](#createeventpayload)
- [`CreateEventResourceText`](#createeventresourcetext)
- [Plugin lifecycle](#plugin-lifecycle)
- [Errors and common mistakes](#errors-and-common-mistakes)
- [Related modules](#related-modules)

## Import

Import the operations directly from the CommonJS module:

```js
const {
	CreateCustomEvent,
	CreateEventPayload,
	CreateEventResourceText,
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events");
```

SourceJS does not install fallback functions. Importing requires the installed native `events` module and its immediately bound `CreateEventPayload`, `CreateEventResourceText`, and `FireEvent` functions. Other required native functions are checked when their wrappers resolve them. Live game-event-manager availability is checked by engine-facing operations, not by this import.

## Exports

| Export | Signature | Result | Responsibility |
| --- | --- | --- | --- |
| [`CreateCustomEvent`](#createcustomevent) | `CreateCustomEvent(strName, Variables?)` | custom-event descriptor | Define a reusable event, its defaults and its `.res` text. |
| [`CreateEventPayload`](#createeventpayload) | `CreateEventPayload(Variables?, Overrides?)` | object | Build a new payload from descriptor defaults and overrides. |
| [`CreateEventResourceText`](#createeventresourcetext) | `CreateEventResourceText(strName, Variables?)` | `string` | Render one Source game-event resource block. |
| [`FireEvent`](#fireevent) | `FireEvent(strName, Payload?, bDoNotBroadcast?)` | `boolean` | Create and fire a real `IGameEvent`. |
| `RegisterEventListener` | `RegisterEventListener(strEventName, Callback)` | `boolean` | Register a callback through `IGameEventManager2::AddListener`. |
| `UnregisterEventListener` | `UnregisterEventListener(strEventName, Callback)` | `boolean` | Remove the first matching callback owned by this plugin runtime. |

These six operations are the complete root package surface; lowercase aliases are not exported. Typed variable helpers live in [`events/variable`](events-variable.md), resource-file ownership lives in [`events/resource`](events-resource.md), and pre-fire interception lives in [`memory/hooks/events`](memory-hooks-events.md).

## Event values

`FireEvent()` writes each own enumerable string-keyed payload property with the matching native `IGameEvent` setter. Inherited properties, non-enumerable properties, and symbol keys are ignored:

| JavaScript value | Native operation | Notes |
| --- | --- | --- |
| `boolean` | `SetBool` | No truthy/falsy coercion. |
| `number` recognized by V8 as signed `int32` | `SetInt` | Values outside `int32` are not silently narrowed. |
| other finite `number` within the native `float` range | `SetFloat` | Includes negative zero, fractional numbers, and larger finite numbers; values are narrowed to native single precision. |
| `string` | `SetString` | Empty strings are valid values; embedded NUL characters are rejected. |
| unsigned 64-bit `bigint` | `SetUint64` | Must be in `[0n, 18446744073709551615n]`; present only on SDK branches whose `IGameEvent` provides UInt64 accessors. |

Objects, arrays, functions, symbols, `null`, `undefined`, non-finite numbers and unsupported `bigint` values are rejected. Payload property names must be non-empty strings without embedded NUL characters.

## `FireEvent`

```text
FireEvent(strName, Payload?, bDoNotBroadcast?) -> boolean
```

`FireEvent()` requires a non-empty event name without embedded NUL characters and validates the complete payload before handing the event to the engine. The event schema must already be loaded; forced creation does not define an unknown event. It creates the event with forced creation enabled, applies the payload, and calls `IGameEventManager2::FireEvent`. SourceJS owns the created event until that call: failed property enumeration, getters, key/string encoding, validation or C++ unwinding during payload construction release it. A getter or proxy exception stops processing; later properties are not read. The public callback translates C++ exceptions to JavaScript errors without replacing an already pending JavaScript exception. This does not guarantee allocator/OOM recovery or safe use of expired native objects.

Set `bDoNotBroadcast` to `true` for an event intended only for server-side listeners. Omitting it or passing `undefined` selects `false`; any other supplied value must be an actual boolean. The custom descriptor's `FireEvent()` method uses the same flag rule.

Run these resource-writing examples during plugin startup, on the game thread, and reuse loaded schemas. Writing and loading are synchronous; they are not appropriate work for every tick. Unregistering callbacks does not delete the written files or unload the engine schemas.

This example records an administrative action without broadcasting it to clients:

```js
const { FireEvent } = require("events");
const { EventResourceFile } = require("events/resource");

const g_FireAdministrativeActionEvent = () => {
	const AdminActionResource = new EventResourceFile("sourcejs/documentation/events_admin_action", { EventName: "SourceJSAdminAction", EventVariables: { AdminUserID: "long", Action: "string", Elapsed: "float", Success: "bool" } });
	AdminActionResource.WriteEventResourceFile();

	const nLoadedEventCount = AdminActionResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the administrative-action resource.");
	}

	const bAdminActionEventFired = FireEvent("SourceJSAdminAction", { AdminUserID: 7, Action: "reload_plugins", Elapsed: 0.125, Success: true }, true);
	if (!bAdminActionEventFired) {
		throw new Error("The engine rejected SourceJSAdminAction.");
	}
};

g_FireAdministrativeActionEvent();
```

Use an unsigned `bigint` only after establishing that the selected SDK exposes UInt64 event accessors. The example declares `Sequence` as `local` and always disables broadcast; this is server-only UInt64 data, not a promise that `.res` provides a portable networked UInt64 type. A live callback object exposes `GetEventUInt64` and `SetEventUInt64` when that capability exists:

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events");

const { EventResourceFile } = require("events/resource");

let g_bUInt64EventAccessSupported = false;

const g_InspectEventCapabilities = (EventValue) => {
	g_bUInt64EventAccessSupported = (typeof EventValue.GetEventUInt64 === "function") && (typeof EventValue.SetEventUInt64 === "function");
};

const g_VerifyUInt64EventAccess = () => {
	g_bUInt64EventAccessSupported = false;

	const CapabilityResource = new EventResourceFile("sourcejs/documentation/events_capabilities", { EventName: "SourceJSCapabilityProbe", EventVariables: {} }, { EventName: "SourceJSSequence", EventVariables: { Sequence: "local" } });
	CapabilityResource.WriteEventResourceFile();

	const nLoadedEventCount = CapabilityResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the capability-probe resource.");
	}

	if (!RegisterEventListener("SourceJSCapabilityProbe", g_InspectEventCapabilities)) {
		throw new Error("Could not register the capability probe.");
	}

	let OperationFailure = null;
	try {
		if (!FireEvent("SourceJSCapabilityProbe", {}, true)) {
			throw new Error("Could not fire the capability probe.");
		}
	} catch (ErrorValue) {
		OperationFailure = { Value: ErrorValue };
	} finally {
		try {
			if (!UnregisterEventListener("SourceJSCapabilityProbe", g_InspectEventCapabilities)) {
				throw new Error("Could not remove the capability probe.");
			}
		} catch (CleanupError) {
			if (OperationFailure !== null) {
				throw new AggregateError([OperationFailure.Value, CleanupError], "Event operation and listener cleanup both failed.");
			}

			throw CleanupError;
		}
	}

	if (OperationFailure !== null) {
		throw OperationFailure.Value;
	}

	if (!g_bUInt64EventAccessSupported) {
		throw new Error("The selected SDK does not expose UInt64 event values.");
	}

	if (!FireEvent("SourceJSSequence", { Sequence: 18446744073709551615n }, true)) {
		throw new Error("The engine rejected the UInt64 event payload.");
	}
};

g_VerifyUInt64EventAccess();
```

## `RegisterEventListener` and `UnregisterEventListener`

```text
RegisterEventListener(strEventName, Callback) -> boolean
UnregisterEventListener(strEventName, Callback) -> boolean
```

`RegisterEventListener()` adds a callback owned by the current plugin context. The first callback group for an event name requires the live manager and installs one native engine listener; additional callbacks share that listener without querying the manager again. Each registration creates a JavaScript wrapper passed to the native registration, so registering the same JavaScript function more than once creates separate registrations.

`UnregisterEventListener()` requires the same function object passed to `RegisterEventListener()`. It removes the first matching registration and returns `false` when no matching registration exists; call it once per repeated registration. Successfully removing the last callback rebuilds the native listener set so the engine no longer dispatches that event to the runtime. A rejected rebuild returns `false`, while native C++ failures can throw; restoring engine delivery after a failed rebuild is best-effort, not a transactional guarantee.

Both functions reject an event name containing an embedded NUL character with `Error` before native registration or removal. The engine consumes a null-terminated name; rejecting NUL prevents a truncated name from disagreeing with the runtime's listener key. Preserve exact engine names such as `player_death`; this validation does not rename them.

If registration returns `false` or throws, its JavaScript wrapper is discarded without removing other successful registrations, including one created reentrantly during that call. Failed unregistration keeps the wrapper available for a retry. Successfully removing the final registration also releases the JavaScript bookkeeping for that event name. The JavaScript package wrappers do not catch or rewrite errors reported by the native calls.

The following workflow validates and enriches a server-only custom event while it is live. Disabling client broadcast does not make it a private plugin message: other server-side engine listeners can still observe it.

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events");
const { GetGlobalVariables } = require("globals");
const { EventResourceFile } = require("events/resource");

const g_VerifyRoundMetricEvent = () => {
	let ObservedRoundMetric = null;

	const strActiveMapName = GetGlobalVariables().MapName;
	if (!strActiveMapName) {
		throw new Error("The event example requires an active map.");
	}

	const ValidateRoundMetricEvent = (EventValue) => {
		if (EventValue.EventName !== "SourceJSRoundMetric") {
			throw new Error(`Received an unexpected event: ${EventValue.EventName}.`);
		}

		if ((typeof EventValue.Address !== "bigint") || (EventValue.Address <= 0n)) {
			throw new Error("The engine event has no positive BigInt address.");
		}

		const nRound = EventValue.GetEventInteger("Round", -1);
		const flDuration = EventValue.GetEventFloat("Duration", 0.0);
		const strMapName = EventValue.GetEventString("Map", "unknown");
		const bCompleted = EventValue.GetEventBoolean("Completed", false);

		if (!Number.isFinite(flDuration)) {
			throw new RangeError("The round-metric duration must be finite before normalization.");
		}

		if (!EventValue.SetEventInteger("Round", Math.max(nRound, 0))) {
			throw new Error("Could not normalize the round field.");
		}

		if (!EventValue.SetEventFloat("Duration", Math.max(flDuration, 0.0))) {
			throw new Error("Could not normalize the duration field.");
		}

		if (!EventValue.SetEventString("Map", strMapName.trim())) {
			throw new Error("Could not normalize the map field.");
		}

		if (!EventValue.SetEventBoolean("Completed", bCompleted)) {
			throw new Error("Could not normalize the completed field.");
		}

		ObservedRoundMetric = { Empty: EventValue.IsEventEmpty(), Local: EventValue.Local, Reliable: EventValue.Reliable, Round: EventValue.GetEventInteger("Round"), MapName: EventValue.GetEventString("Map") };
	};

	const RoundMetricResource = new EventResourceFile("sourcejs/documentation/events_round_metric", { EventName: "SourceJSRoundMetric", EventVariables: { Completed: "bool", Duration: "float", Map: "string", Round: "long" } });
	RoundMetricResource.WriteEventResourceFile();

	const nLoadedEventCount = RoundMetricResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the round-metric resource.");
	}

	if (!RegisterEventListener("SourceJSRoundMetric", ValidateRoundMetricEvent)) {
		throw new Error("Could not register SourceJSRoundMetric.");
	}

	let OperationFailure = null;
	try {
		if (!FireEvent("SourceJSRoundMetric", { Completed: true, Duration: 83.75, Map: strActiveMapName, Round: 3 }, true)) {
			throw new Error("Could not fire SourceJSRoundMetric.");
		}

		if ((ObservedRoundMetric === null) || (ObservedRoundMetric.MapName !== strActiveMapName)) {
			throw new Error("The event callback did not observe the fired payload.");
		}
	} catch (ErrorValue) {
		OperationFailure = { Value: ErrorValue };
	} finally {
		try {
			if (!UnregisterEventListener("SourceJSRoundMetric", ValidateRoundMetricEvent)) {
				throw new Error("Could not remove SourceJSRoundMetric.");
			}
		} catch (CleanupError) {
			if (OperationFailure !== null) {
				throw new AggregateError([OperationFailure.Value, CleanupError], "Event operation and listener cleanup both failed.");
			}

			throw CleanupError;
		}
	}

	if (OperationFailure !== null) {
		throw OperationFailure.Value;
	}
};

g_VerifyRoundMetricEvent();
```

## Live `GameEvent` object

Each callback receives a live view over the same native `IGameEvent` currently being dispatched.

View fields, installed methods and private callback metadata are created as checked own properties. Inherited setters and non-writable inherited properties do not intercept construction; this does not extend the native event's lifetime.

### Fields

| Field | Type | Behavior |
| --- | --- | --- |
| `EventName` | `string` | Event name captured for this callback object. |
| `Reliable` | `boolean` | Result of `IGameEvent::IsReliable()`. |
| `Local` | `boolean` | Result of `IGameEvent::IsLocal()`. |
| `Address` | `bigint` | Borrowed native address as a lossless integer; it is metadata, not an ownership transfer. |

These captured metadata fields remain readable if the JavaScript object is retained. The saved `bigint` remains ordinary JavaScript data, but the view's native borrow ends with the runtime's dispatch. This is not a promise about when the engine destroys the event; never dereference that address later.

### Methods

| Method | Signature | Result | Strict contract |
| --- | --- | --- | --- |
| `IsEventEmpty` | `IsEventEmpty(strKey?)` | `boolean` | With no key, query the event; with a key, require a non-empty string. |
| `GetEventBoolean` | `GetEventBoolean(strKey, bDefaultValue?)` | `boolean` | `bDefaultValue` must be a boolean. |
| `GetEventInteger` | `GetEventInteger(strKey, nDefaultValue?)` | `number` | `nDefaultValue` must be an `int32`. |
| `GetEventUInt64` | `GetEventUInt64(strKey, unDefaultValue?)` | `bigint` | Omitted when the selected SDK has no UInt64 accessors; the optional default must be an unsigned 64-bit `bigint`. |
| `GetEventFloat` | `GetEventFloat(strKey, dblDefaultValue?)` | `number` | Default must be finite and fit native `float`; the native result is returned without a finiteness check. |
| `GetEventString` | `GetEventString(strKey, strDefaultValue?)` | `string` | Default must be a string. |
| `SetEventBoolean` | `SetEventBoolean(strKey, bValue)` | `true` | Require an exact boolean. |
| `SetEventInteger` | `SetEventInteger(strKey, nValue)` | `true` | Require an `int32`. |
| `SetEventUInt64` | `SetEventUInt64(strKey, unValue)` | `true` | Omitted with the UInt64 getter; require an unsigned 64-bit `bigint`. |
| `SetEventFloat` | `SetEventFloat(strKey, dblValue)` | `true` | Require a finite value in native `float` range. |
| `SetEventString` | `SetEventString(strKey, strValue)` | `true` | Require a string. |

Keys and string defaults/values must not contain embedded NUL (`\0`). The Source SDK consumes C strings, so these inputs are rejected rather than silently truncated; empty string values remain valid.

Typed getter defaults use argument presence: omission selects `false`, `0`, `0n`, or `""` as appropriate, but explicit `undefined` is rejected. This differs from the broadcast flag and from `IsEventEmpty(undefined)`, which uses the no-key query. Float defaults are narrowed to native single precision.

Read and mutate the view synchronously during dispatch. Its token remains active across the current runtime's callback snapshot and expires when that dispatch finishes, not immediately when the first callback returns. Calling a typed method after dispatch ends throws instead of dereferencing a stale native event:

```js
const {
	FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events");

const { EventResourceFile } = require("events/resource");

const g_VerifyGameEventLifecycle = () => {
	let RetainedGameEvent = null;

	const RetainGameEventForLifecycleCheck = (EventValue) => {
		RetainedGameEvent = EventValue;

		if (EventValue.GetEventString("Phase") !== "live") {
			throw new Error("Unexpected event phase.");
		}
	};

	const LifecycleResource = new EventResourceFile("sourcejs/documentation/events_lifecycle", { EventName: "SourceJSLifecycleProbe", EventVariables: { Phase: "string" } });
	LifecycleResource.WriteEventResourceFile();

	const nLoadedEventCount = LifecycleResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the lifecycle-probe resource.");
	}

	if (!RegisterEventListener("SourceJSLifecycleProbe", RetainGameEventForLifecycleCheck)) {
		throw new Error("Could not register the lifecycle probe.");
	}

	let OperationFailure = null;
	try {
		if (!FireEvent("SourceJSLifecycleProbe", { Phase: "live" }, true)) {
			throw new Error("Could not fire the lifecycle probe.");
		}
	} catch (ErrorValue) {
		OperationFailure = { Value: ErrorValue };
	} finally {
		try {
			if (!UnregisterEventListener("SourceJSLifecycleProbe", RetainGameEventForLifecycleCheck)) {
				throw new Error("Could not remove the lifecycle probe.");
			}
		} catch (CleanupError) {
			if (OperationFailure !== null) {
				throw new AggregateError([OperationFailure.Value, CleanupError], "Event operation and listener cleanup both failed.");
			}

			throw CleanupError;
		}
	}

	if (OperationFailure !== null) {
		throw OperationFailure.Value;
	}

	if ((RetainedGameEvent === null) || (RetainedGameEvent.EventName !== "SourceJSLifecycleProbe")) {
		throw new Error("Detached metadata was not retained.");
	}

	try {
		RetainedGameEvent.GetEventString("Phase");
		throw new Error("A detached event unexpectedly remained callable.");
	} catch (ErrorValue) {
		if (!String(ErrorValue.message).includes("after its callback has returned")) {
			throw ErrorValue;
		}
	}
};

g_VerifyGameEventLifecycle();
```

Setter calls mutate the native event itself. Later SourceJS callbacks in the same dispatch observe those writes. Registration changes affect future dispatches, not the callback snapshot already being processed. Ordinary listener exceptions are logged by the runtime and do not become `FireEvent()` exceptions or prove engine failure; track an explicit observed result when callback success matters. Engine listeners outside SourceJS may run before or after SourceJS, so do not use cross-system listener ordering as a protocol.

## `CreateCustomEvent`

```text
CreateCustomEvent(strName, Variables?) -> {
	EventName,
	EventVariables,
	EventResourceText,
	FireEvent(Overrides?, bDoNotBroadcast?),
}
```

`CreateCustomEvent()` returns a reusable descriptor, not a native event allocation. It exposes `EventName`, `EventVariables`, `EventResourceText`, and `FireEvent`. `EventVariables` references the object supplied by the caller, and `EventResourceText` is initialized once when the descriptor is created. Calling `FireEvent()` builds a fresh payload from the current variable defaults, applies overrides, and delegates to the real native `FireEvent()` operation. Call it on the descriptor: it reads the receiver's current `EventName` and `EventVariables`, so an extracted standalone call is not equivalent. Replacing these fields changes later firing but does not regenerate the creation-time `EventResourceText`.

A variable definition can be:

- a type string such as `"long"` or `"string"`, which declares a resource type without a default;
- an object with `Type` and optional `DefaultValue`;
- a literal default value, whose type is inferred.

This example keeps defaults live while treating the generated resource text as a creation-time snapshot:

```js
const {
	CreateCustomEvent,
	RegisterEventListener,
	UnregisterEventListener,
} = require("events");
const { GetGlobalVariables } = require("globals");
const { EventResourceFile } = require("events/resource");

const g_VerifyCustomEventDefaults = () => {
	const RoundSummaryEventVariables = {
		Active: { Type: "bool", DefaultValue: true },
		Duration: { Type: "float", DefaultValue: 0.0 },
		Map: { Type: "string", DefaultValue: "unknown" },
		UserID: { Type: "long", DefaultValue: 0 },
	};
	const RoundSummaryCustomEvent = CreateCustomEvent("SourceJSRoundSummary", RoundSummaryEventVariables);
	const strOriginalRoundSummaryEventResourceText = RoundSummaryCustomEvent.EventResourceText;
	const strActiveMapName = GetGlobalVariables().MapName;
	let strReceivedMapName = null;
	if (!strActiveMapName) {
		throw new Error("The custom-event example requires an active map.");
	}

	const ReceiveRoundSummaryEvent = (EventValue) => {
		strReceivedMapName = EventValue.GetEventString("Map");
	};

	const RoundSummaryResource = new EventResourceFile("sourcejs/documentation/events_round_summary", RoundSummaryCustomEvent);
	RoundSummaryResource.WriteEventResourceFile();

	const nLoadedEventCount = RoundSummaryResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Could not load the round-summary resource.");
	}

	if (!RegisterEventListener(RoundSummaryCustomEvent.EventName, ReceiveRoundSummaryEvent)) {
		throw new Error("Could not listen for the custom round summary.");
	}

	let OperationFailure = null;
	try {
		RoundSummaryEventVariables.Map.DefaultValue = strActiveMapName;
		if (!RoundSummaryCustomEvent.FireEvent({ Duration: 91.5, UserID: 12 }, true)) {
			throw new Error("Could not fire the custom round summary.");
		}
	} catch (ErrorValue) {
		OperationFailure = { Value: ErrorValue };
	} finally {
		try {
			if (!UnregisterEventListener(RoundSummaryCustomEvent.EventName, ReceiveRoundSummaryEvent)) {
				throw new Error("Could not remove the custom round-summary listener.");
			}
		} catch (CleanupError) {
			if (OperationFailure !== null) {
				throw new AggregateError([OperationFailure.Value, CleanupError], "Event operation and listener cleanup both failed.");
			}

			throw CleanupError;
		}
	}

	if (OperationFailure !== null) {
		throw OperationFailure.Value;
	}

	if (strReceivedMapName !== strActiveMapName) {
		throw new Error("The current variable default was not used.");
	}

	if (RoundSummaryCustomEvent.EventResourceText !== strOriginalRoundSummaryEventResourceText) {
		throw new Error("EventResourceText unexpectedly changed after creation.");
	}
};

g_VerifyCustomEventDefaults();
```

## `CreateEventPayload`

```text
CreateEventPayload(Variables?, Overrides?) -> object
```

`CreateEventPayload()` creates a new plain object. It reads each descriptor object's `DefaultValue` through ordinary property lookup, including inherited properties, copies a non-`undefined` default or a literal default, skips type-only string definitions, and then applies overrides. Only own enumerable string-keyed entries in `Variables` and `Overrides` are processed; non-enumerable and symbol-keyed entries are ignored. Indexed keys are preserved as string property names.

Copied values become own writable, enumerable, configurable data properties. A key such as `__proto__` does not change the payload's prototype, and inherited setters are not invoked. If property enumeration or a getter throws, the original exception propagates immediately: later entries are not read and no partial payload is returned.

The private default-reading helper also retains an existing JavaScript exception during C++ unwinding. The public `CreateEventPayload` callback translates C++ exceptions to JavaScript errors and does not publish a partial payload. This is not an allocator/OOM recovery guarantee.

Use it when several operations need the exact payload that a custom descriptor would fire:

```js
const { CreateEventPayload } = require("events");

const g_VerifyEventPayloadAssembly = () => {
	const WinningTeamEventVariables = {
		Reason: { Type: "string", DefaultValue: "round_end" },
		Score: { Type: "long", DefaultValue: 0 },
		Team: "long",
	};
	const WinningTeamEventPayload = CreateEventPayload(WinningTeamEventVariables, { Score: 4, Team: 2 });
	if ((WinningTeamEventPayload.Reason !== "round_end") || (WinningTeamEventPayload.Score !== 4) || (WinningTeamEventPayload.Team !== 2)) {
		throw new Error("The event payload was not assembled correctly.");
	}

	if (Object.hasOwn(WinningTeamEventVariables, "Team") && !Object.hasOwn(WinningTeamEventPayload, "Team")) {
		throw new Error("The explicit team override was lost.");
	}
};

g_VerifyEventPayloadAssembly();
```

The result has independent top-level bindings. Later assignments to it do not rewrite descriptor defaults, but object-valued defaults and overrides retain their references rather than being deep-cloned. A payload can contain values that `FireEvent()` subsequently rejects; assembly is not native event validation.

## `CreateEventResourceText`

```text
CreateEventResourceText(strName, Variables?) -> string
```

`CreateEventResourceText()` renders one Valve game-event resource block. It preserves own enumerable string-key property order, excludes inherited and non-enumerable properties and symbol keys, escapes quotes and backslashes, and requires exact supported event-variable types. It is not a full resource-grammar or event-name sanitizer: use trusted engine-valid names without NUL characters or line breaks. The function does not write or load a file; [`events/resource`](events-resource.md) owns those operations.

```js
const { CreateEventResourceText } = require("events");

const g_VerifyEventResourceText = () => {
	const strObjectiveEventResourceText = CreateEventResourceText("SourceJSObjective", {
		Completed: { Type: "bool", DefaultValue: false },
		Label: { Type: "string", DefaultValue: "objective" },
		Progress: { Type: "float", DefaultValue: 0.0 },
	});
	if (!strObjectiveEventResourceText.includes('"SourceJSObjective"') || !strObjectiveEventResourceText.includes('"Completed"\t"bool"') || !strObjectiveEventResourceText.includes('"Progress"\t"float"')) {
		throw new Error("The generated game-event resource is incomplete.");
	}
};

g_VerifyEventResourceText();
```

## Plugin lifecycle

For long-lived registrations, keep callback identities at module scope and explicitly unregister them. Short-lived operations can use local callbacks with `try`/`finally`, as above. The runtime calls the case-sensitive SourceJS-owned lifecycle export `Unload`; no lowercase alias is installed, and `UnloadPlugin` is not a recognized replacement. SourceJS removes remaining game-event callbacks when a plugin context is destroyed, but explicit cleanup makes reload behavior deterministic and lets failures surface immediately.

```js
const { RegisterEventListener, UnregisterEventListener } = require("events");
const { LogInfo } = require("loggers");

const g_LogPlayerDisconnectEvent = (EventValue) => {
	const strPlayerName = EventValue.GetEventString("name", "unknown");
	const strDisconnectReason = EventValue.GetEventString("reason", "no reason supplied");
	LogInfo(`PlayerDisconnect PlayerName=${JSON.stringify(strPlayerName)} Reason=${JSON.stringify(strDisconnectReason)}`);
};

if (!RegisterEventListener("player_disconnect", g_LogPlayerDisconnectEvent)) {
	throw new Error("Could not register player_disconnect.");
}

const g_UnloadPlugin = () => {
	if (!UnregisterEventListener("player_disconnect", g_LogPlayerDisconnectEvent)) {
		throw new Error("Could not unregister player_disconnect.");
	}
};

module.exports = { Unload: g_UnloadPlugin };
```

Each plugin has its own V8 context and owns its callback registrations. Ownership is isolated, but engine event dispatch is shared: callbacks in other plugins can observe the same event. Use the serialized internal channel from [`plugins/bus`](plugins-bus.md) for explicit cross-plugin messages rather than treating an engine event as private delivery.

The examples retain any event-operation failure until listener cleanup has been attempted. If both fail, they throw `AggregateError` with the original operation failure followed by the cleanup failure. A cleanup failure does not mean the registration was removed; report it and resolve the remaining ownership before reusing that plugin state.

## Errors and common mistakes

- Native event names, typed getter/setter keys, and payload keys passed to `FireEvent` must be non-empty strings. SourceJS does not call `String(value)` for these inputs; payload assembly itself is not event validation.
- Non-`undefined` `Payload`, `Variables`, and `Overrides` arguments must be non-array, non-function objects. `null`, arrays, and functions are rejected.
- `UnregisterEventListener()` compares callback identity. A new function with the same source text is a different callback and will not unregister the original.
- `RegisterEventListener()` and `UnregisterEventListener()` return native lifecycle success. Check the result instead of assuming the engine listener was installed or rebuilt.
- Do not call a retained `GameEvent` method after synchronous dispatch finishes. Copy only the scalar values needed later.
- Do not convert `Address` to `number` or pass a formatted string as a native address, and do not dereference it after dispatch finishes. It exposes a borrowed native address as `bigint`; the engine owns the event.
- Do not assume UInt64 methods exist on every SDK. Test the method itself and keep `bigint` payloads behind the same capability check.
- `bDoNotBroadcast` does not cancel an event. It prevents client broadcast while server-side listener dispatch still occurs.
- `events` observes events after the engine starts dispatching them. Use [`memory/hooks/events`](memory-hooks-events.md) when the original `FireEvent` call must be blocked, its arguments replaced, or its Detours trampoline invoked.

## Related modules

- [`events/custom`](events-custom.md): provides custom-event operations without listener functions; unlike the root wrapper, it also initializes `Name`, `Variables`, `ResourceText`, and `Fire` convenience fields on each custom descriptor. They are initial value/function-reference copies, not synchronized accessors.
- [`events/listener`](events-listener.md): exposes only `FireEvent`, `RegisterEventListener`, and `UnregisterEventListener` for listener-focused code.
- [`events/manager`](events-manager.md): adds managed callback ownership and JSON dispatch helpers.
- [`events/resource`](events-resource.md): owns ordered resource descriptors, file writes, and engine resource loading.
- [`events/variable`](events-variable.md): owns typed variable descriptors and coercion helpers.
- [`memory/hooks/events`](memory-hooks-events.md): owns pre-fire Detours interception and raw native event addresses.
