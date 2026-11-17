# `require("events/custom")`

> Warning: this page covers mutable custom-event descriptors, payload assembly, resource generation, and native event dispatch. Use the contents list to keep descriptor lifetime and external event-field names distinct.

The [JavaScript wrapper](../../packages/sourcejs/events/custom.js) exposes the custom-event subset of [`events`](events.md) without listener registration; [native event operations](../../src/sourcejs/modules/ModuleBindings.cpp) assemble payloads, render Valve `.res` declarations, and fire real `IGameEvent` instances. Use engine-backed operations on the server/game thread while the plugin context and `IGameEventManager2` remain live.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Variable definitions](#variable-definitions)
- [`CreateCustomEvent`](#createcustomevent)
- [Custom-event descriptor](#custom-event-descriptor)
- [`CreateEventPayload`](#createeventpayload)
- [`CreateEventResourceText`](#createeventresourcetext)
- [`FireEvent`](#fireevent)
- [Errors and lifecycle](#errors-and-lifecycle)

## Import

```js
const {
	CreateCustomEvent,
	CreateEventPayload,
	CreateEventResourceText,
	FireEvent,
} = require("events/custom");
```

Importing requires the selected build's native `events/custom` module; an unavailable module throws instead of returning fallback functions. Descriptor creation, payload composition, and resource rendering do not require a live event-manager interface. Native firing and resource loading require `IGameEventManager2` at call time.

## Exports

| Export | Signature | Result | Responsibility |
| --- | --- | --- | --- |
| [`CreateCustomEvent`](#createcustomevent) | `CreateCustomEvent(strName, Variables?)` | custom-event descriptor | Define a reusable event, its defaults, and its `.res` text. |
| [`CreateEventPayload`](#createeventpayload) | `CreateEventPayload(Variables?, Overrides?)` | object | Build a new payload from descriptor defaults and overrides. |
| [`CreateEventResourceText`](#createeventresourcetext) | `CreateEventResourceText(strName, Variables?)` | `string` | Render one Source game-event resource block. |
| [`FireEvent`](#fireevent) | `FireEvent(strName, Payload?, bDoNotBroadcast?)` | `boolean` | Create and fire a real `IGameEvent`. |

These four canonical operations are the complete package surface. The native module supplies event behavior; the JavaScript wrapper adds convenience members to custom-event descriptors.

## Variable definitions

The `Variables` argument (and a descriptor's `EventVariables` object) maps event field names to one of three definition forms:

| Form | Example | Payload default | Resource type |
| --- | --- | --- | --- |
| Type only | `UserID: "long"` | none | exact declared type |
| Descriptor | `Map: { Type: "string", DefaultValue: "unknown" }` | `DefaultValue` | explicit or inferred type |
| Literal default | `Completed: false` | literal value | inferred from the value |

Supported Source resource types are exactly `bool`, `byte`, `short`, `long`, `float`, `string`, `local`, and `wstring`. Descriptor creation and resource rendering reject unknown type strings; payload composition alone does not validate them.

A string definition always names a resource type, not a literal string default. Use `{ Type: "string", DefaultValue: "unknown" }` for a string value. Resource rendering and payload assembly visit own enumerable string keys; inherited fields, non-enumerable fields, and symbol keys are ignored.

Use [`events/variable`](events-variable.md) when definitions should be built through typed JavaScript descriptor classes.

## `CreateCustomEvent`

```text
CreateCustomEvent(strName, Variables?) -> CustomEventDescriptor
```

`strName` must be a non-empty string; a missing or invalid name throws. `Variables`, when supplied, must be a non-array object. `CreateCustomEvent()` does not allocate or fire a native event; it returns a reusable descriptor. A definition getter or resource-generation failure propagates its original exception and stops descriptor construction before the native `FireEvent` method is created.

Creating a descriptor or rendering resource text does not register an event with the engine. Write and load its `.res` definition through [`events/resource`](events-resource.md) before firing a new event name. Native `bForce` bypasses the no-listener check, not the unknown-name check; a missing definition throws during event creation.

The executable firing examples below include resource initialization so they stand alone. They write files below `EVENT_ROOT` and call the engine loader synchronously; use dedicated generated filenames, initialize once, and reuse the loaded definitions for subsequent fires rather than doing file IO on every tick or event.

This descriptor models one private round summary, loads its resource definition, and fires it with current defaults:

```js
const { CreateCustomEvent } = require("events/custom");
const { EventResourceFile } = require("events/resource");
const { GetGlobalVariables } = require("globals");

const g_InitializeAndFirePrivateRoundSummaryEvent = () => {
	const strActiveMapName = GetGlobalVariables().MapName;
	if (!strActiveMapName) {
		throw new Error("The custom-event example requires an active map.");
	}

	const RoundSummaryEvent = CreateCustomEvent("SourceJSRoundSummary", {
		Completed: { Type: "bool", DefaultValue: false },
		Duration: { Type: "float", DefaultValue: 0.0 },
		Map: { Type: "string", DefaultValue: "unknown" },
		UserID: { Type: "long", DefaultValue: 0 },
	});
	const RoundSummaryResource = new EventResourceFile("examples/SourceJSRoundSummary.res", RoundSummaryEvent);
	RoundSummaryResource.WriteEventResourceFile();
	const nLoadedEventCount = RoundSummaryResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Unable to load the round summary event definition.");
	}

	const bRoundSummaryFired = RoundSummaryEvent.FireEvent({ Completed: true, Duration: 94.25, Map: strActiveMapName, UserID: 12 }, true);
	if (!bRoundSummaryFired) {
		throw new Error("The engine rejected SourceJSRoundSummary.");
	}
};

g_InitializeAndFirePrivateRoundSummaryEvent();
```

## Custom-event descriptor

`CreateCustomEvent()` returns an ordinary object with these public members:

The native descriptor creates `EventName`, `EventVariables`, `EventResourceText`, and `FireEvent` as own writable, enumerable, configurable data properties, without invoking inherited setters. The JavaScript wrapper adds the convenience members separately.

| Canonical member | Convenience member | Type | Behavior |
| --- | --- | --- | --- |
| `EventName` | `Name` | `string` | `EventName` is read by `FireEvent()` or `Fire()` at call time; `Name` initially copies that string. |
| `EventVariables` | `Variables` | object | `EventVariables` retains the supplied object; both members initially reference it. `FireEvent()` or `Fire()` reads defaults from `EventVariables`. |
| `EventResourceText` | `ResourceText` | `string` | Resource declaration generated once during `CreateCustomEvent()`; `ResourceText` initially copies that string. |
| [`FireEvent(Overrides?, bDoNotBroadcast?)`](#fireevent) | `Fire(Overrides?, bDoNotBroadcast?)` | method | Build a new payload and fire the native event. |

Convenience members are initial copies, not synchronized accessors: assigning `Name`, `Variables`, or `ResourceText` does not update the corresponding canonical member. Mutating a shared variables object updates the defaults used by `FireEvent()` or `Fire()`. The resource-text strings remain creation-time snapshots, which are not regenerated after a definition changes. The next example reports `MaximumClients`, the server's configured client capacity, not its current player population:

```js
const { CreateCustomEvent } = require("events/custom");
const { EventResourceFile } = require("events/resource");
const { GetGlobalVariables } = require("globals");

const g_InitializeAndVerifyPopulationEventDescriptor = () => {
	const EventVariables = {
		Map: { Type: "string", DefaultValue: "unknown" },
		MaximumClients: { Type: "long", DefaultValue: 0 },
	};
	const PopulationEvent = CreateCustomEvent("SourceJSPopulation", EventVariables);
	const strOriginalEventResourceText = PopulationEvent.EventResourceText;
	const RuntimeInformation = GetGlobalVariables();
	if (!RuntimeInformation.MapName) {
		throw new Error("The population event example requires an active map.");
	}

	EventVariables.Map.DefaultValue = RuntimeInformation.MapName;
	EventVariables.MaximumClients.DefaultValue = RuntimeInformation.MaximumClients;

	const PopulationResource = new EventResourceFile("examples/SourceJSPopulation.res", PopulationEvent);
	PopulationResource.WriteEventResourceFile();
	const nLoadedEventCount = PopulationResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Unable to load the population event definition.");
	}

	if (!PopulationEvent.FireEvent({}, true)) {
		throw new Error("The population event could not be fired.");
	}

	if ((PopulationEvent.EventVariables !== EventVariables) || (PopulationEvent.Variables !== EventVariables)) {
		throw new Error("The descriptor replaced its live variables object.");
	}

	if ((PopulationEvent.EventResourceText !== strOriginalEventResourceText) || (PopulationEvent.ResourceText !== strOriginalEventResourceText)) {
		throw new Error("The resource snapshot changed unexpectedly.");
	}
};

g_InitializeAndVerifyPopulationEventDescriptor();
```

Call canonical `FireEvent` or convenience `Fire` as a descriptor method. The native function reads `this.EventName` and `this.EventVariables`, so detaching either method from the descriptor loses the required receiver.

`CustomEventDescriptor.FireEvent()` and `CustomEventDescriptor.Fire()` return the same native boolean as top-level `FireEvent()`. `Overrides` and `bDoNotBroadcast` are both optional; supplied overrides must be an object and the broadcast flag must be an exact boolean.

## `CreateEventPayload`

```text
CreateEventPayload(Variables?, Overrides?) -> object
```

`CreateEventPayload()` creates a new object in two phases:

1. Visit own enumerable string-keyed definitions and copy descriptor defaults whose resolved `DefaultValue` is not `undefined`, plus literal defaults. Type-only string definitions contribute no value.
2. Copy own enumerable string-keyed override properties over those defaults, including keys absent from `Variables`.

This is useful for auditing or modifying the exact payload before it is fired:

```js
const { CreateEventPayload, FireEvent } = require("events/custom");
const { EventResourceFile } = require("events/resource");

const g_InitializeAndFireTeamSummaryEvent = () => {
	const EventVariables = {
		Reason: { Type: "string", DefaultValue: "round_end" },
		Score: { Type: "long", DefaultValue: 0 },
		Team: "long",
	};
	const strEventName = "SourceJSTeamSummary";
	const SummaryResource = new EventResourceFile("examples/SourceJSTeamSummary.res", { EventName: strEventName, EventVariables });
	SummaryResource.WriteEventResourceFile();
	const nLoadedEventCount = SummaryResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Unable to load the team summary event definition.");
	}

	const SummaryPayload = CreateEventPayload(EventVariables, { Score: 4, Team: 2 });
	if ((SummaryPayload.Reason !== "round_end") || (SummaryPayload.Score !== 4) || (SummaryPayload.Team !== 2)) {
		throw new Error("The custom payload was assembled incorrectly.");
	}

	if (!FireEvent(strEventName, SummaryPayload, true)) {
		throw new Error("The team summary could not be fired.");
	}
};

g_InitializeAndFireTeamSummaryEvent();
```

The container is new, but values are copied shallowly, not cloned or coerced to the declared resource type. A descriptor with a missing or `undefined` `DefaultValue` contributes no payload field; a literal `undefined` definition or override does create an own field with that value, which native firing rejects. Composition does not validate type strings or native payload values. Getters can run during both phases; a getter failure propagates without returning a partial payload. Use only native game-event scalar values if the result will be passed to `FireEvent()`.

## `CreateEventResourceText`

```text
CreateEventResourceText(strName, Variables?) -> string
```

`CreateEventResourceText()` renders one Valve game-event declaration. It preserves the enumeration order of own enumerable string keys and escapes quotes and backslashes in event and variable names. This is not full resource-grammar validation: use trusted, engine-valid names without NUL or line breaks. Rendering and descriptor creation can retain such invalid characters even though native firing later rejects NUL in the event name, payload keys, or string values.

```js
const { CreateEventResourceText } = require("events/custom");

const g_VerifyObjectiveResourceText = () => {
	const strEventResourceText = CreateEventResourceText("SourceJSObjective", {
		Completed: { Type: "bool", DefaultValue: false },
		Label: { Type: "string", DefaultValue: "objective" },
		Progress: { Type: "float", DefaultValue: 0.0 },
	});
	const vecExpectedResourceLines = [
		'"SourceJSObjective"',
		'\t"Completed"\t"bool"',
		'\t"Label"\t"string"',
		'\t"Progress"\t"float"',
	];
	for (const strExpectedLine of vecExpectedResourceLines) {
		if (!strEventResourceText.includes(strExpectedLine)) {
			throw new Error(`Missing resource declaration: ${strExpectedLine}`);
		}
	}
};

g_VerifyObjectiveResourceText();
```

This function only renders text. Use [`events/resource`](events-resource.md) to combine descriptors, write a `.res` file, and call `LoadEventsFromFile`.

## `FireEvent`

```text
FireEvent(strName, Payload?, bDoNotBroadcast?) -> boolean
```

Top-level `FireEvent()` is appropriate for one-off events that do not need reusable defaults:

```js
const { FireEvent } = require("events/custom");
const { EventResourceFile } = require("events/resource");

const g_InitializeAndFireCacheRebuiltEvent = () => {
	const strEventName = "SourceJSCacheRebuilt";
	const EventVariables = { Duration: "float", Entries: "long", Name: "string", Success: "bool" };
	const CacheResource = new EventResourceFile("examples/SourceJSCacheRebuilt.res", { EventName: strEventName, EventVariables });
	CacheResource.WriteEventResourceFile();
	const nLoadedEventCount = CacheResource.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("Unable to load the cache rebuild event definition.");
	}

	const bEventFired = FireEvent(strEventName, { Duration: 0.0375, Entries: 128, Name: "weapon_profiles", Success: true }, true);
	if (!bEventFired) {
		throw new Error("The cache rebuild event could not be fired.");
	}
};

g_InitializeAndFireCacheRebuiltEvent();
```

Payload values map directly to `IGameEvent::SetBool`, `SetInt`, `SetFloat`, `SetString`, and, on capable SDKs, `SetUint64`. See [the complete value table](events.md#event-values) for exact JavaScript types and UInt64 capability rules.

`bDoNotBroadcast: true` keeps the event server-side; it does not cancel listener dispatch. Register listeners through [`events`](events.md#registereventlistener-and-unregistereventlistener) or [`events/manager`](events-manager.md).

## Errors and lifecycle

- Names must be non-empty strings. There is no scalar string conversion.
- `Variables`, `Overrides`, and direct `Payload` arguments must be non-array objects. `null`, arrays, and functions are rejected.
- Optional arguments may be omitted or explicitly `undefined`; an omitted variables/overrides object becomes an empty object, and the broadcast flag defaults to `false`. This does not make `undefined` a valid individual payload value.
- `CreateEventPayload()` performs composition only. Native value validation occurs when the result reaches `FireEvent()`.
- An unknown event name fails native creation and throws; creating a descriptor does not auto-load its definition.
- `FireEvent()` rejects unsupported values and frees a newly created native event if payload conversion fails.
- UInt64 payload values require an unsigned `bigint` and an SDK with native UInt64 event methods.
- Direct firing also visits only own enumerable string-keyed payload fields; inherited, non-enumerable, and symbol properties are not sent.
- The descriptor owns no native allocation between calls. Every canonical `.FireEvent()` or convenience `.Fire()` call creates a new native event and transfers its normal lifecycle to `IGameEventManager2::FireEvent`.
- A descriptor can be kept for the plugin lifetime. Canonical `EventVariables` and convenience `Variables` initially reference the same plugin-local mutable JavaScript object; reassigning either member does not synchronize the other.
- For cross-plugin delivery, use the serialized [`plugins/bus`](plugins-bus.md) channel instead of sharing descriptor objects.
