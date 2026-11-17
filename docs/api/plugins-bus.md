# `require("plugins/bus")`

> AI processing note: this page documents serialized cross-context delivery. Keep channel normalization, callback ownership, envelope metadata and decoded payload copies distinct.

`plugins/bus` is the serialized communication channel between isolated SourceJS plugin contexts. A sender publishes a JSON-compatible payload under a channel name. Each receiver gets a decoded payload and envelope in its own V8 context.

Use the bus for cross-plugin messages. Delivery is synchronous on the calling runtime's game thread, not a worker request or deferred callback. Receivers can reenter the bus, so publish only after committing sender state. Do not transfer JavaScript object identity, callbacks, native handles or memory views between plugins; serializing an address does not establish ownership or a valid lifetime.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Envelope](#envelope)
- [Channel Names](#channel-names)
- [Direct Operations](#direct-operations)
- [`PluginBusChannel`](#pluginbuschannel)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	EVENT_PREFIX,
	PluginBusChannel,
	CreateChannel,
	Emit,
	GetEventName,
	GetListenerCount,
	Off,
	On,
} = require("plugins/bus");
```

## Exports

| Export | Purpose |
| --- | --- |
| [`EVENT_PREFIX`](#event_prefix) | Internal listener-event prefix, currently `SourceJS:Plugins:`. |
| [`PluginBusChannel`](#new-pluginbuschannelstrchannelname-pluginbusoptions) | Channel object with optional default source and target names. |
| `CreateChannel(strChannelName, PluginBusOptions?)` | Creates a `PluginBusChannel` with validated defaults. |
| [`Emit(strChannelName, PluginBusPayload?, PluginBusOptions?)`](#emitstrchannelname-pluginbuspayload-pluginbusoptions) | Serializes and publishes one envelope; returns the pre-dispatch registered listener count. |
| [`GetEventName(strChannelName)`](#geteventnamestrchannelname) | Returns the internal listener event name for a channel. |
| [`GetListenerCount(strChannelName)`](#getlistenercountstrchannelname) | Returns the current listener count for a channel. |
| [`Off(strChannelName, PluginBusCallback)`](#offstrchannelname-pluginbuscallback) | Removes the wrapper associated with an exact callback; returns `boolean`. |
| [`On(strChannelName, PluginBusCallback)`](#onstrchannelname-pluginbuscallback) | Registers a payload callback once; returns `boolean`. |

## Envelope

Callbacks receive `(PluginBusPayload, PluginBusEnvelope)`. The envelope has this shape:

```js
function InspectConfigurationEnvelope(PluginBusPayload, PluginBusEnvelope) {
	if ((PluginBusPayload === null) || (typeof PluginBusPayload !== "object") || Array.isArray(PluginBusPayload) || (typeof PluginBusPayload.Name !== "string") || !Object.hasOwn(PluginBusPayload, "Value")) {
		throw new TypeError("Configuration payload must contain a string Name and a Value.");
	}

	if ((PluginBusEnvelope === null) || (typeof PluginBusEnvelope !== "object") || Array.isArray(PluginBusEnvelope)) {
		throw new TypeError("Configuration envelope must be an object.");
	}

	if (PluginBusEnvelope.Channel !== "ConfigurationChanged") {
		throw new Error(`Unexpected channel: ${PluginBusEnvelope.Channel}.`);
	}

	if ((PluginBusEnvelope.Source !== "AdminSettings") || (PluginBusEnvelope.Target !== "MatchController")) {
		throw new Error("Unexpected configuration routing metadata.");
	}

	if ((PluginBusEnvelope.Type !== "setting") || !Number.isFinite(PluginBusEnvelope.Timestamp)) {
		throw new Error("Invalid configuration envelope metadata.");
	}

	return {
		Channel: PluginBusEnvelope.Channel,
		Name: PluginBusPayload.Name,
		Source: PluginBusEnvelope.Source,
		Target: PluginBusEnvelope.Target,
		Timestamp: PluginBusEnvelope.Timestamp,
		Type: PluginBusEnvelope.Type,
		Value: PluginBusPayload.Value,
	};
}

module.exports = { InspectConfigurationEnvelope };
```

`Channel`, `Source`, `Target` and optional `Type` have string values. `Timestamp` is assigned with `Date.now()`; it is a wall-clock timestamp, not a monotonic sequence or authentication proof. `PluginBusOptions` must be a non-null, non-array object. Emission validates own `Source`, `Target` and `Type` properties as strings when provided; an absent or `undefined` property is treated as omitted. Channel construction validates only `Source` and `Target`, not `Type`. Direct `Emit()` defaults `Source` and `Target` to `""` and omits `Type`.

`Source` and `Target` are sender-supplied metadata, not trusted identities or access control. `Target` does not filter delivery: receivers must apply any target policy themselves. A channel object's default `Target` only affects envelopes it emits. The examples accept an empty target as a broadcast; do not use this policy for privileged actions without an independent authorization check. Project-owned `Type` tags use compact lowercase values such as `"setting"`; the runtime checks their string type, not an application schema.

`PluginBusPayload` must be JSON-compatible because the bus deliberately serializes it before crossing a plugin boundary. Omitted or `undefined` payload arguments default to `{}`. Cycles and `bigint` values throw before publication. JSON also drops unsupported object fields and prototypes, changes non-finite numbers to `null`, and applies `toJSON()` hooks; do not rely on preserving those values or behaviors. The receiver gets a decoded copy, so mutating it cannot modify the sender's object. Each receiver decodes independently; receiver schemas still need validation.

## Channel Names

### `EVENT_PREFIX`

The prefix is useful for diagnostics. Plugin code should normally use `GetEventName()` instead of assembling internal names itself.

```js
const { EVENT_PREFIX, GetEventName } = require("plugins/bus");

function InspectEventPrefix() {
	const strInternalName = GetEventName("RoundReady");
	if (strInternalName !== `${EVENT_PREFIX}RoundReady`) {
		throw new Error("Plugin bus event naming is inconsistent.");
	}

	return { EventPrefix: EVENT_PREFIX, InternalName: strInternalName };
}

module.exports = { InspectEventPrefix };
```

### `GetEventName(strChannelName)`

`strChannelName` must be a string. The runtime trims surrounding whitespace first, then rejects an empty name or embedded NUL, LF or CR in the remaining name. Names are case-sensitive; trimming is normalization, not a case conversion. Project-owned channel names use PascalCase. Preserve the exact internal `SourceJS:Plugins:` prefix and use `GetEventName()` to construct it.

```js
const { GetEventName } = require("plugins/bus");

function GetInternalEventName(strChannelName) {
	return GetEventName(strChannelName);
}

module.exports = { GetInternalEventName };
```

## Direct Operations

### `On(strChannelName, PluginBusCallback)`

Register the receiving plugin during load. Keep the exact callback identity for cleanup.

```js
const { Off, On } = require("plugins/bus");

let g_CurrentConfiguration = null;

function OnConfigurationChanged(PluginBusPayload, PluginBusEnvelope) {
	if (PluginBusEnvelope.Target && (PluginBusEnvelope.Target !== "MatchController")) {
		return false;
	}

	if ((PluginBusPayload === null) || (typeof PluginBusPayload !== "object") || Array.isArray(PluginBusPayload) || (typeof PluginBusPayload.Name !== "string") || !Object.hasOwn(PluginBusPayload, "Value") || (PluginBusEnvelope.Type !== "setting")) {
		return false;
	}

	g_CurrentConfiguration = {
		Name: PluginBusPayload.Name,
		Source: PluginBusEnvelope.Source,
		Value: PluginBusPayload.Value,
	};

	return true;
}

function Load() {
	if (On("ConfigurationChanged", OnConfigurationChanged) !== true) {
		throw new Error("ConfigurationChanged listener could not be registered or is already registered.");
	}

	return true;
}

function GetCurrentConfiguration() {
	return g_CurrentConfiguration;
}

function Unload() {
	if (Off("ConfigurationChanged", OnConfigurationChanged) !== true) {
		return false;
	}

	g_CurrentConfiguration = null;

	return true;
}

module.exports = { GetCurrentConfiguration, Load, Unload };
```

Registering the same callback on the same normalized channel twice returns `false` without adding another native listener. Registration can also return `false` if the native registration fails; a non-boolean native result throws. The configuration getter returns the stored receiver-owned record, not an immutable snapshot.

### `Emit(strChannelName, PluginBusPayload?, PluginBusOptions?)`

The return value is the nonnegative safe-integer count of registered native callbacks before dispatch, not an acknowledgment or a successful receiver count. A receiver returning `false` does not stop other listeners. The native runtime logs receiver exceptions and continues dispatch; they do not become sender-side delivery failures. Serialization, envelope validation and native result errors can still throw in the sender. Do not retry automatically based only on the count: callbacks may already have produced side effects.

```js
const { Emit } = require("plugins/bus");

function PublishConfigurationChanged(strName, Value) {
	if ((typeof strName !== "string") || (strName.length === 0)) {
		throw new TypeError("strName must be a non-empty string.");
	}

	return Emit("ConfigurationChanged", {
		Name: strName,
		Value,
	}, {
		Source: "AdminSettings",
		Target: "MatchController",
		Type: "setting",
	});
}

module.exports = { PublishConfigurationChanged };
```

### `GetListenerCount(strChannelName)`

Use the count for diagnostics, not as delivery synchronization or an atomic count-and-publish operation. Reentrant callbacks can change registrations.

```js
const { GetListenerCount } = require("plugins/bus");

function GetConfigurationListenerCount() {
	return GetListenerCount("ConfigurationChanged");
}

module.exports = { GetConfigurationListenerCount };
```

### `Off(strChannelName, PluginBusCallback)`

Remove the same callback during plugin unload. The result is `true` only when native removal succeeds for an active wrapper. `false` can mean no active registration or a failed native removal; it does not prove cleanup. On failure or exception the module retains an active wrapper for retry. Keep callback identity and receiver state until successful cleanup; changing the function or discarding its owner can prevent retry.

```js
const { Off, On } = require("plugins/bus");

let g_unReadyRound = null;

function OnRoundReady(PluginBusPayload) {
	if ((PluginBusPayload === null) || (typeof PluginBusPayload !== "object") || Array.isArray(PluginBusPayload) || !Number.isSafeInteger(PluginBusPayload.Round) || (PluginBusPayload.Round < 0)) {
		return false;
	}

	g_unReadyRound = PluginBusPayload.Round;

	return true;
}

function Load() {
	if (On("RoundReady", OnRoundReady) !== true) {
		throw new Error("RoundReady listener could not be registered or is already registered.");
	}

	return true;
}

function GetReadyRound() {
	return g_unReadyRound;
}

function Unload() {
	if (Off("RoundReady", OnRoundReady) !== true) {
		return false;
	}

	g_unReadyRound = null;

	return true;
}

module.exports = { GetReadyRound, Load, Unload };
```

## `PluginBusChannel`

### `new PluginBusChannel(strChannelName, PluginBusOptions?)`

`PluginBusOptions.Source` and `PluginBusOptions.Target` provide defaults for messages emitted through this object. `CreateChannel(strChannelName, PluginBusOptions)` is the ordinary factory for the same class.

```js
const { PluginBusChannel, CreateChannel } = require("plugins/bus");

function CreateBusChannels() {
	const DirectChannel = new PluginBusChannel("RoundState", {
		Source: "RoundController",
	});
	const CreatedChannel = CreateChannel("PlayersRespawn", {
		Source: "RespawnManager",
		Target: "Statistics",
	});

	return {
		Created: {
			Name: CreatedChannel.Name,
			Source: CreatedChannel.Source,
			Target: CreatedChannel.Target,
		},
		Direct: {
			Name: DirectChannel.Name,
			Source: DirectChannel.Source,
			Target: DirectChannel.Target,
		},
	};
}

module.exports = { CreateBusChannels };
```

Instances expose getter-only `Name`, `Source` and `Target` properties; the object is not frozen. Construction validates the channel name and source/target defaults. It ignores `Type` entirely, without reading or validating that property, and stores no `Type` default. `On()` and `Off()` delegate by channel name; source/target defaults do not constrain incoming messages. `Emit()` validates per-message metadata, including `Type`.

### `PluginBusChannel.GetEventName()`

```js
const { CreateChannel } = require("plugins/bus");

function GetMatchEventName() {
	const MatchChannel = CreateChannel("MatchState");

	return MatchChannel.GetEventName();
}

module.exports = { GetMatchEventName };
```

### `PluginBusChannel.On(PluginBusCallback)` and `Off(PluginBusCallback)`

```js
const { CreateChannel } = require("plugins/bus");

let g_LastSample = null;
let g_StatisticsChannel = null;

function OnSample(PluginBusPayload, PluginBusEnvelope) {
	if (PluginBusEnvelope.Target && (PluginBusEnvelope.Target !== "Statistics")) {
		return false;
	}

	if ((PluginBusPayload === null) || (typeof PluginBusPayload !== "object") || Array.isArray(PluginBusPayload) || !Number.isFinite(PluginBusPayload.Damage) || (PluginBusPayload.Damage < 0) || !Number.isSafeInteger(PluginBusPayload.PlayerIndex) || (PluginBusPayload.PlayerIndex <= 0)) {
		return false;
	}

	g_LastSample = {
		Damage: PluginBusPayload.Damage,
		PlayerIndex: PluginBusPayload.PlayerIndex,
	};

	return true;
}

function Load() {
	if (g_StatisticsChannel !== null) {
		return false;
	}

	const StatisticsChannel = CreateChannel("StatisticsSample", {
		Target: "Statistics",
	});
	if (StatisticsChannel.On(OnSample) !== true) {
		throw new Error("StatisticsSample listener could not be registered.");
	}

	g_StatisticsChannel = StatisticsChannel;

	return true;
}

function GetLastSample() {
	return g_LastSample;
}

function Unload() {
	if (g_StatisticsChannel === null) {
		return false;
	}

	if (g_StatisticsChannel.Off(OnSample) !== true) {
		return false;
	}

	g_LastSample = null;
	g_StatisticsChannel = null;

	return true;
}

module.exports = { GetLastSample, Load, Unload };
```

### `PluginBusChannel.Emit(PluginBusPayload?, PluginBusOptions?)`

Per-message options override channel defaults. An absent or `undefined` source/target property keeps its default; `""` explicitly clears it. `Type` is per-message metadata only. A `Target` default does not restrict subscriptions.

```js
const { CreateChannel } = require("plugins/bus");

function PublishAuditEntry(strAction, strMapName) {
	const AuditChannel = CreateChannel("AuditEntry", {
		Source: "AdminTools",
		Target: "AuditLog",
	});

	return AuditChannel.Emit({
		Action: strAction,
		Map: strMapName,
	}, {
		Type: "adminaction",
	});
}

module.exports = { PublishAuditEntry };
```

### `PluginBusChannel.GetListenerCount()`

```js
const { CreateChannel } = require("plugins/bus");

function GetHealthListenerCount() {
	const HealthChannel = CreateChannel("ServiceHealth");

	return HealthChannel.GetListenerCount();
}

module.exports = { GetHealthListenerCount };
```

## Errors

- Channel names are trimmed first. The remaining name must be non-empty and cannot contain NUL, LF or CR. Names remain case-sensitive.
- `PluginBusOptions` must be a non-null, non-array object. Own `Source` and `Target` metadata properties must be strings unless omitted or `undefined`; emission applies the same rule to per-message `Type`. Channel construction ignores `Type`.
- Payloads must be JSON-compatible. Cycles and `bigint` values throw before publication unless explicitly converted by application serialization. JSON omits unsupported object fields and turns unsupported array entries or non-finite numbers into `null`; functions, symbols and `undefined` are not lossless payload data. Omitted or `undefined` payload arguments default to `{}`.
- A malformed serialized envelope, mismatched channel or invalid metadata throws in the receiving wrapper. SourceJS does not replace invalid data with an empty payload. During native dispatch, a receiver exception is logged and other receivers continue; the sender's listener count is not a success report.
- Native registration/removal results must be booleans; native listener counts must be nonnegative safe integers. Invalid result types throw rather than being coerced.
- `Source`, `Target` and `Type` are metadata only; the bus does not filter them automatically.

## Lifecycle

Register callbacks during plugin `Load()` and remove the same callback identity during `Unload()`. Duplicate `On()` calls for one normalized channel return `false`, as can unsuccessful native registration. `Off()` returns `false` for an absent/inactive wrapper or unsuccessful native removal. A failed removal or exception retains the active wrapper for retry: do not clear receiver state or discard the owning channel until removal succeeds.

The examples export `Load` and `Unload`, the runtime's case-sensitive SourceJS-owned lifecycle keys; there are no lowercase aliases. The host ignores their return values, so the examples throw when initial registration fails to abort loading. Returning `false` or throwing during `Unload` does not stop host cleanup or context teardown. Retry removal manually only while the context is still live, before host unload; a failed unload does not preserve a context for later retries.

Each plugin context keeps its callback-to-wrapper `WeakMap`. Another context cannot remove a receiver's wrapper even when it has a function with similar source text. Weak keys do not automatically unregister native listeners; retain the original callback for explicit cleanup.

Every emission builds an envelope, serializes it to JSON and passes only the string through the native listener channel. Each receiving context parses its own decoded payload copy, so receiver mutation cannot modify sender state.

`GetListenerCount()` reports the count at the moment of the call; it is diagnostic information, not delivery synchronization.

## Related Modules

- [`listeners`](listeners.md) provides the native string-payload channel used underneath the bus.
- [`events`](events.md) handles Source game events rather than plugin-private messages.
- [`plugins`](plugins.md) documents isolated plugin contexts and lifecycle ownership.
