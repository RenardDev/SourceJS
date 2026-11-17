# `require("memory/hooks/warnings")`

> AI processing warning: this module joins serialized native warning transport, plugin-local callback ownership, process warning capture and logger output. Preserve both callback channels, strict record fields and deterministic cleanup when changing examples.

`memory/hooks/warnings` reports structured SourceJS warnings. A high-level warning is sent through the native cross-plugin channel, delivered to the current plugin's local observers and written through `loggers.LogWarning()`.

The module lives at `packages/sourcejs/memory/hooks/warnings.js`. Generic callback containers are documented in [`memory/hooks`](memory-hooks-callbacks.md), callback failures are routed through [`memory/hooks/exceptions`](memory-hooks-exceptions.md), and native detours are documented in [`memory/hooks`](memory-hooks.md).

## Contents

- [Import](#import)
- [Runtime model](#runtime-model)
- [Exports](#exports)
- [Warning records](#warning-records)
- [Class members](#class-members)
- [Examples](#examples)
- [Errors and lifecycle](#errors-and-lifecycle)

## Import

```js
const {
	WARNING_HOOKS,
	WarningHook,
	WarningHooks,
	Emit,
	Off,
	On,
	Warning,
} = require("memory/hooks/warnings");

if (!(WARNING_HOOKS instanceof WarningHooks) || (typeof WarningHook !== "function") || (typeof Emit !== "function") || (typeof Off !== "function") || (typeof On !== "function") || (typeof Warning !== "function")) {
	throw new Error("memory/hooks/warnings did not expose its complete API.");
}
```

## Runtime model

- `On()`, `Off()` and `Emit()` own the native `Warning` event channel. Payloads are serialized as JSON so isolated plugin contexts receive independent objects instead of shared JavaScript references.
- `WARNING_HOOKS` is the current plugin's local callback collection. `WarningHook` registers one callback in that collection and owns its removal.
- `Warning()` and `WarningHooks.PrintWarning()` normalize one record, emit its serialized copy to native observers, invoke local observers with the original record and write one logger diagnostic. The record is returned only after these stages succeed; later failures do not roll back delivery or earlier observer effects.
- Native observers run before local observers. A native observer receives a decoded copy; mutating it does not modify the record later delivered to local observers.
- A throwing native observer is logged by the V8 runtime and later native observers continue. `Emit()` still returns `undefined` because the native channel has no delivery-status result.
- Local observers run from a stable callback snapshot taken after native emission. A removed callback can still run if it was already in that snapshot. Local observers share the same record: their mutations affect later local observers, the logger and the returned record, not the native copy already serialized.
- A local observer that throws is reported through `EXCEPTION_HOOKS` with `Source: "warning-callback"`. Later local observers continue only if that exception report succeeds; a reporting failure stops local dispatch and prevents the final warning log.
- When the host provides Node-compatible `process.on`, process warnings are forwarded through `WARNING_HOOKS`. The process handler catches reporting failures, so failed normalization or serialization need not produce a warning record or log. Source game plugin contexts may omit `process`; the public warning API does not depend on it.
- Delivery and logging are synchronous. Do not perform blocking database or network work in a warning observer.
- Native-channel observers in other plugin contexts can receive warning payloads. Never include passwords, tokens or full sensitive buffers in the message or extra diagnostic context.

High-level warning arguments are strict:

- `strMessage` and `strFilename` must be strings;
- `strCategory` must be a non-empty string;
- `unLineNumber` must be a safe non-negative integer;
- `Extra` must be a non-null, non-array object;
- Canonical `Message`, `Category`, `Filename` and `LineNumber` values are assigned after spreading `Extra`; conflicting extra fields are overwritten, not rejected.

## Exports

| Export | Kind | Signature | Description |
| --- | --- | --- | --- |
| [`WARNING_HOOKS`](#warning_hooks) | Singleton | `WarningHooks` | Plugin-local warning callback owner. |
| [`WarningHook`](#warninghook-1) | Class | `new WarningHook(Callback, ClassInstance = WARNING_HOOKS)` | Owns one local callback registration. |
| [`WarningHooks`](#warninghooks-1) | Class | `new WarningHooks()` | Local callback collection and warning reporter. |
| [`Emit`](#emit) | Function | `Emit(Payload)` | Serializes and sends an existing object through the native channel; returns `undefined`. |
| [`Off`](#off) | Function | `Off(Callback)` | Removes an exact native-channel callback and returns whether it was registered. |
| [`On`](#on) | Function | `On(Callback)` | Registers a native-channel callback and returns that callback. |
| [`Warning`](#warning) | Function | `Warning(strMessage, strCategory = "Warning", strFilename = "", unLineNumber = 0, Extra = {})` | Reports and returns one normalized warning record. |

## Warning records

| Field | Type | Description |
| --- | --- | --- |
| `Message` | `string` | Warning text. |
| `Category` | `string` | Stable warning category, such as `ConfigurationWarning`. |
| `Filename` | `string` | Related source or configuration file, or an empty string. |
| `LineNumber` | `number` | Safe non-negative source line; zero means no line was supplied. |
| Additional fields | JSON-compatible values | Caller-owned diagnostic context from `Extra`. |

The native channel carries JSON data. Functions, symbols and object identity do not cross plugin contexts; cyclic values, `bigint` values and throwing getters or `toJSON()` can prevent serialization. Serialization occurs after argument normalization and before native emission, local callbacks and logging; getters can also fail while normalization spreads `Extra`. A custom `toJSON()` must produce an object for native observers: decoded `null`, arrays and scalar values are rejected by the receiver; `undefined` is rejected by the sender. Successful `Emit()` is not proof that every observer accepted the payload.

The normalized record, including retained `Extra` fields, must be JSON-serializable. Local observers can alter the original record after serialization; use them for observation rather than changing canonical diagnostic fields.

## Class members

### `WarningHooks`

`WarningHooks` inherits the ordered callback collection from `HookBase`.

| Member | Kind | Description |
| --- | --- | --- |
| `length` | Live field | Current number of local callbacks. |
| `ClassName` | Getter | Runtime collection class name. |
| `Append(Callback)` | Method | Registers one unique local callback. |
| `Remove(Callback)` | Method | Removes the exact local callback or throws. |
| `Clear()` | Method | Removes all local callbacks. |
| [`PrintWarning(strMessage, strCategory = "Warning", strFilename = "", unLineNumber = 0, Extra = {})`](#warninghooksprintwarning) | Method | Emits, dispatches and logs one warning; returns its normalized record. |

### `WarningHook`

`WarningHook` inherits its lifecycle from `HookDecorator`.

| Member | Kind | Description |
| --- | --- | --- |
| `Callback` | Field | Registered local callback. |
| `ClassInstance` | Field | Owning `WarningHooks` collection. |
| `Call(...vecCallbackArguments)` | Method | Invokes the callback directly without reporting a warning. |
| `Dispose()` | Method | Removes and returns the callback; a second call throws. |

## Examples

Run the examples without unrelated mutation of their callback collections. Remove only confirmed native registrations and dispose each owned decorator once. A failed removal is reported rather than silently retried: a thrown cleanup can follow partial effects, while a `false` native removal retains its wrapper for an explicit owner-controlled retry. The examples preserve a single thrown value unchanged and aggregate multiple failures in occurrence order. Repeated removal is checked only after successful cleanup, when it cannot disguise a failed first attempt.

### `WARNING_HOOKS`

Observe one high-level warning through the plugin-local singleton and release the registration during unload.

```js
const { WARNING_HOOKS, WarningHook, Warning } = require("memory/hooks/warnings");

const g_vecErrors = [];
let g_strObservedCategory = null;
let g_ObservedRecord = null;

function ObserveCapacityWarning(Record) {
	g_strObservedCategory = Record.Category;
	g_ObservedRecord = Record;
}

const g_unInitialCallbackCount = WARNING_HOOKS.length;
const g_Observer = new WarningHook(ObserveCapacityWarning);

try {
	const Record = Warning("Entity profile cache is nearly full", "CapacityWarning", "entities.ini", 48, { Percent: 90 });
	if ((WARNING_HOOKS.length !== (g_unInitialCallbackCount + 1)) || (g_ObservedRecord !== Record) || (g_strObservedCategory !== "CapacityWarning") || (Record.Percent !== 90)) {
		throw new Error("WARNING_HOOKS did not receive the original normalized record.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (g_Observer.Dispose() !== ObserveCapacityWarning) {
			throw new Error("The local warning observer did not release its callback.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		if (WARNING_HOOKS.length !== g_unInitialCallbackCount) {
			throw new Error("The singleton warning callback collection did not return to its starting size.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Local warning dispatch and cleanup failed.");
}
```

### `WarningHook`

Use a decorator when one object should own one callback for its complete lifetime.

```js
const { WARNING_HOOKS, WarningHook, Warning } = require("memory/hooks/warnings");

const g_vecErrors = [];
let g_unCallbackCount = 0;

function CountWarning(Record) {
	if (Record.Category !== "TranslationWarning") {
		throw new Error("WarningHook received an unexpected warning category.");
	}

	g_unCallbackCount += 1;
}

const g_unInitialCallbackCount = WARNING_HOOKS.length;
const g_Registration = new WarningHook(CountWarning);

try {
	if ((g_Registration.Callback !== CountWarning) || (g_Registration.ClassInstance.ClassName !== "WarningHooks") || (g_Registration.Call({ Category: "TranslationWarning" }) !== undefined)) {
		throw new Error("WarningHook did not retain or directly invoke its callback.");
	}

	Warning("Missing optional translation", "TranslationWarning");

	if (g_unCallbackCount !== 2) {
		throw new Error("WarningHook did not observe both direct and reported calls.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (g_Registration.Dispose() !== CountWarning) {
			throw new Error("WarningHook did not return its callback during disposal.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		if (WARNING_HOOKS.length !== g_unInitialCallbackCount) {
			throw new Error("The singleton warning callback collection did not return to its starting size.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Local warning dispatch and cleanup failed.");
}
```

### `WarningHooks`

Create an isolated local collection when a subsystem needs its own observers while retaining native transport and logger routing.

```js
const { WarningHook, WarningHooks } = require("memory/hooks/warnings");

const g_vecErrors = [];
const g_vecConfigurationWarnings = new WarningHooks();
let g_strObservedFile = null;

function ObserveConfigurationWarning(Record) {
	g_strObservedFile = Record.Filename;
}

const g_Registration = new WarningHook(ObserveConfigurationWarning, g_vecConfigurationWarnings);

try {
	const Record = g_vecConfigurationWarnings.PrintWarning("Unknown configuration key", "ConfigurationWarning", "sourcejs.cfg", 12, { Key: "old_option" });
	if ((g_vecConfigurationWarnings.ClassName !== "WarningHooks") || (g_vecConfigurationWarnings.length !== 1) || (Record.Key !== "old_option") || (g_strObservedFile !== "sourcejs.cfg")) {
		throw new Error("The isolated warning collection did not dispatch its normalized record.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (g_Registration.Dispose() !== ObserveConfigurationWarning) {
			throw new Error("The isolated warning collection did not release its observer.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		if (g_vecConfigurationWarnings.length !== 0) {
			throw new Error("The isolated warning collection retained a callback.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Isolated warning dispatch and cleanup failed.");
}
```

### `Emit`

Send a prebuilt record through the native channel. The observer receives a decoded copy suitable for cross-plugin diagnostics.

```js
const { Emit, Off, On } = require("memory/hooks/warnings");

const g_vecErrors = [];
let g_Received = null;
let g_bRegistered = false;

function ObserveNativeWarning(Payload) {
	g_Received = Payload;
}

try {
	if (On(ObserveNativeWarning) !== ObserveNativeWarning) {
		throw new Error("On() did not return the public callback token.");
	}

	g_bRegistered = true;

	const Payload = {
		Category: "NetworkWarning",
		Message: "Upstream request timed out",
		TimeoutMilliseconds: 1500,
	};
	if (Emit(Payload) !== undefined) {
		throw new Error("Emit() returned an unexpected value.");
	}

	if ((g_Received === null) || (g_Received === Payload) || (g_Received.Category !== "NetworkWarning") || (g_Received.TimeoutMilliseconds !== 1500)) {
		throw new Error("The native warning channel did not deliver an independent JSON copy.");
	}

	g_Received.TimeoutMilliseconds = 1;

	if (Payload.TimeoutMilliseconds !== 1500) {
		throw new Error("The native warning observer mutated the sender's object.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bRegistered) {
		try {
			if (!Off(ObserveNativeWarning)) {
				throw new Error("The native warning observer was not removed.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Native warning emission and cleanup failed.");
}

if (Off(ObserveNativeWarning) !== false) {
	throw new Error("Off() reported a duplicate native callback removal.");
}
```

### `Off`

Removal uses the original public callback, not the internal serialized-channel wrapper.

```js
const { Emit, Off, On } = require("memory/hooks/warnings");

const g_vecErrors = [];
let g_unCallbackCount = 0;
let g_bRegistered = false;
let g_bRemovalAttempted = false;

function ObserveNativeWarning() {
	g_unCallbackCount += 1;
}

try {
	if (On(ObserveNativeWarning) !== ObserveNativeWarning) {
		throw new Error("On() did not return the registered callback.");
	}

	g_bRegistered = true;

	if ((Emit({ Category: "RegistrationWarning", Message: "Observer registered" }) !== undefined) || (g_unCallbackCount !== 1)) {
		throw new Error("The warning observer did not receive its registration probe.");
	}

	g_bRemovalAttempted = true;

	const bRemoved = Off(ObserveNativeWarning);
	if (!bRemoved || (Emit({ Category: "CleanupWarning", Message: "Observer already removed" }) !== undefined) || (g_unCallbackCount !== 1)) {
		throw new Error("Off() did not suppress delivery to the removed callback.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bRegistered && !g_bRemovalAttempted) {
		try {
			if (!Off(ObserveNativeWarning)) {
				throw new Error("The fallback native warning cleanup failed.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Native warning removal and verification failed.");
}

if (Off(ObserveNativeWarning) !== false) {
	throw new Error("Off() reported a second removal.");
}
```

### `On`

Keep the returned callback as the registration token and remove it in `finally`.

```js
const { Emit, Off, On } = require("memory/hooks/warnings");

const g_vecErrors = [];
let g_strReceivedMessage = null;
let g_Observer = null;
let g_bRegistered = false;

function ObserveWarning(Payload) {
	g_strReceivedMessage = Payload.Message;
}

try {
	g_Observer = On(ObserveWarning);
	if (g_Observer !== ObserveWarning) {
		throw new Error("On() did not return the registered callback identity.");
	}

	g_bRegistered = true;

	if (Emit({ Category: "PluginWarning", Message: "Dependency is outdated" }) !== undefined) {
		throw new Error("Emitting the registered warning returned an unexpected value.");
	}

	if (g_strReceivedMessage !== "Dependency is outdated") {
		throw new Error("The native warning observer did not receive the emitted message.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bRegistered) {
		try {
			if (!Off(g_Observer)) {
				throw new Error("The native warning callback token was not removed.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Native warning observation and cleanup failed.");
}

if (Off(g_Observer) !== false) {
	throw new Error("The native warning callback token was removed twice.");
}
```

### `Warning`

Attach structured context while preserving the canonical warning fields.

```js
const { Warning } = require("memory/hooks/warnings");

const g_Record = Warning("Database retry scheduled", "DatabaseWarning", "database.js", 73, { Attempt: 2, DelayMilliseconds: 500 });
if ((g_Record.Message !== "Database retry scheduled") || (g_Record.Category !== "DatabaseWarning") || (g_Record.Filename !== "database.js") || (g_Record.LineNumber !== 73) || (g_Record.Attempt !== 2) || (g_Record.DelayMilliseconds !== 500)) {
	throw new Error("Warning() did not preserve the canonical and additional fields.");
}
```

### `WarningHooks.PrintWarning`

Call the singleton method directly when code already owns the collection object.

The logger diagnostic uses `Category="..."` and `Message="..."`; a non-empty filename adds the canonical `Path="..."` and `Line=...` fields. This diagnostic spelling does not rename the record's `Filename` or `LineNumber` properties.

```js
const { WARNING_HOOKS, WarningHook } = require("memory/hooks/warnings");

const g_vecErrors = [];
let g_strObservedMessage = null;

function ObserveMapCycleWarning(Record) {
	g_strObservedMessage = Record.Message;
}

const g_unInitialCallbackCount = WARNING_HOOKS.length;
const g_Observer = new WarningHook(ObserveMapCycleWarning);

try {
	const Record = WARNING_HOOKS.PrintWarning("Invalid map rotation entry", "MapCycleWarning", "mapcycle.txt", 9);
	if ((g_strObservedMessage !== Record.Message) || (Record.LineNumber !== 9) || (WARNING_HOOKS.length !== (g_unInitialCallbackCount + 1))) {
		throw new Error("WarningHooks.PrintWarning() did not synchronously dispatch its record.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (g_Observer.Dispose() !== ObserveMapCycleWarning) {
			throw new Error("The direct singleton observer did not release its callback.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		if (WARNING_HOOKS.length !== g_unInitialCallbackCount) {
			throw new Error("The direct warning collection did not return to its starting size.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Direct warning dispatch and cleanup failed.");
}
```

## Errors and lifecycle

- `On()` accepts only functions and rejects duplicate registration of the same callback. `Off()` returns `false` when the public callback is absent or native removal fails; a failed native removal retains the wrapper so cleanup can be retried.
- `Emit()` accepts a non-null, non-array object that must serialize to JSON. Serialization failures propagate to the caller; successful native emission returns `undefined` rather than a delivery status.
- `Warning()` and `PrintWarning()` enforce their string, category, line-number and `Extra` object contracts before either callback channel runs.
- Native observers receive independent decoded objects. Local observers receive the original normalized record returned by `Warning()` or `PrintWarning()`.
- Ordinary native-observer exceptions are handled by the V8 runtime. Local-observer exceptions are reported through `EXCEPTION_HOOKS`; later local observers continue only if that reporting succeeds. Callback return values are ignored and Promises are not awaited.
- `WarningHook.Dispose()` removes and returns its exact callback. A second disposal throws because the decorator no longer owns a registration.
