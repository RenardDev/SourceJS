# `require("memory/hooks/exceptions")`

> AI processing warning: this module connects native exception transport, JavaScript callback ownership and process-level error reporting. Preserve both channels and deterministic callback cleanup when changing examples.

`memory/hooks/exceptions` normalizes thrown JavaScript values, emits them through the native SourceJS exception channel, invokes plugin-local observers and writes the final diagnostic through `loggers.LogError()`.

The module lives at `packages/sourcejs/memory/hooks/exceptions.js`. Generic callback containers are documented in [`memory/hooks`](memory-hooks-callbacks.md), warnings in [`memory/hooks/warnings`](memory-hooks-warnings.md), and native detours in [`memory/hooks`](memory-hooks.md).

## Contents

- [Import](#import)
- [Runtime model](#runtime-model)
- [Exports](#exports)
- [Class members](#class-members)
- [Examples](#examples)
- [Errors and lifecycle](#errors-and-lifecycle)

## Import

```js
const {
	EXCEPTION_HOOKS,
	ExceptionHook,
	ExceptionHooks,
	Emit,
	Off,
	On,
} = require("memory/hooks/exceptions");

if (!(EXCEPTION_HOOKS instanceof ExceptionHooks) || (ExceptionHook.ClassInstance !== EXCEPTION_HOOKS)) {
	throw new Error("memory/hooks/exceptions did not expose its default live collection.");
}

if ((typeof Emit !== "function") || (typeof Off !== "function") || (typeof On !== "function")) {
	throw new Error("memory/hooks/exceptions did not expose its native-channel operations.");
}
```

## Runtime model

- `On()`, `Off()` and `Emit()` operate on the native `memory/hooks/exceptions` channel. Payloads cross isolated plugin contexts as JSON, so native observers receive decoded copies rather than shared object references.
- `EXCEPTION_HOOKS` is the plugin-local JavaScript callback collection used by `ExceptionHook`.
- `PrintException()` normalizes a value, emits the normalized record to the native channel, optionally invokes local callbacks and logs the exception.
- A normalized local record contains `Name`, `Message`, `Stack` and the original `Error` value. Fields from `Extra` are merged last; the serialized native copy does not preserve `Error` identity.
- Omitted or explicit `undefined` is replaced with a new `Error("Unknown exception")`. Other non-`Error` values are converted to a diagnostic `Message`, but the original value remains in `Error`. The complete record must still be JSON-serializable: a `bigint` or circular value in `Error` or `Extra` makes reporting throw before native emission, local callbacks and logging. `Extra` must be a non-array object, and `bCallbacks` must be an actual boolean.
- If reporting succeeds after a local exception callback throws, its error is reported once with `Source: "exception-callback"` and without recursively invoking the same local callbacks.
- Normalization, serialization, native emission, local dispatch and logging are ordered, not transactional. A thrown failure stops later phases without undoing earlier effects. If reporting a local callback failure itself throws, remaining local callbacks and the original log are skipped.
- Dispose every `ExceptionHook` and pass the exact function identity to `Off()` during plugin unload.

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`EXCEPTION_HOOKS`](#exception_hooks) | Singleton | Live plugin-local `ExceptionHooks` collection. |
| [`ExceptionHook`](#exceptionhook-1) | Class | `new ExceptionHook(Callback, ClassInstance = EXCEPTION_HOOKS)` |
| [`ExceptionHooks`](#exceptionhooks-1) | Class | `new ExceptionHooks()` |
| [`Emit`](#emit) | Function | `Emit(Payload)` |
| [`Off`](#off) | Function | `Off(Callback)` |
| [`On`](#on) | Function | `On(Callback)` |

## Class members

### `ExceptionHooks`

`ExceptionHooks` inherits `length`, `ClassName`, `Append()`, `Remove()` and `Clear()` from `HookBase`.

| Member | Kind | Description |
| --- | --- | --- |
| [`PrintException(Value = undefined, Extra = {}, bCallbacks = true)`](#exceptionhooksprintexception) | Method | Normalizes, emits, optionally dispatches and logs one exception; returns the normalized record. |

### `ExceptionHook`

`ExceptionHook` inherits `Callback`, `ClassInstance`, `Call()` and `Dispose()` from `HookDecorator`. Its default owner is `EXCEPTION_HOOKS`.

## Examples

Run these examples with exclusive ownership of their callback registrations and without unrelated mutation of the shared collections. Shared registrations are removed only after confirmation; a thrown setup call does not prove ownership of a partially completed operation. A separately owned collection can always be cleared. Each example preserves a single thrown value unchanged, including primitives, and combines a main failure with a cleanup failure in `AggregateError.errors`, in that order. Cleanup is attempted once: a failed removal does not prove that the registration is gone and needs investigation by its owner.

### `EXCEPTION_HOOKS`

Register directly when one owner already controls the collection and can remove the exact callback itself.

```js
const { EXCEPTION_HOOKS } = require("memory/hooks/exceptions");

const g_unCallbackCountBefore = EXCEPTION_HOOKS.length;
const g_vecObservedMessages = [];
const g_OriginalError = new Error("Unable to load command_tools");
const g_vecErrors = [];
let g_bCallbackRegistered = false;

function ObserveException(Exception) {
	g_vecObservedMessages.push(Exception.Message);
}

try {
	const RegisteredCallback = EXCEPTION_HOOKS.Append(ObserveException);
	if (RegisteredCallback !== ObserveException) {
		throw new Error("The exception collection did not retain the callback identity.");
	}

	g_bCallbackRegistered = true;

	const Exception = EXCEPTION_HOOKS.PrintException(g_OriginalError, { Source: "plugin-load" });
	if ((Exception.Error !== g_OriginalError) || (Exception.Name !== "Error") || (Exception.Message !== g_OriginalError.message) || (Exception.Source !== "plugin-load")) {
		throw new Error("PrintException() did not preserve the local Error record.");
	}

	if ((g_vecObservedMessages.length !== 1) || (g_vecObservedMessages[0] !== g_OriginalError.message)) {
		throw new Error("The local exception observer received the wrong record.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bCallbackRegistered) {
		try {
			if ((EXCEPTION_HOOKS.Remove(ObserveException) !== ObserveException) || (EXCEPTION_HOOKS.length !== g_unCallbackCountBefore)) {
				throw new Error("The exception collection did not restore its callback state.");
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
	throw new AggregateError(g_vecErrors, "Exception observation and cleanup failed.");
}
```

### `ExceptionHook`

`ExceptionHook` owns one callback registration and removes it through `Dispose()`.

```js
const { EXCEPTION_HOOKS, ExceptionHook } = require("memory/hooks/exceptions");

const g_unCallbackCountBefore = EXCEPTION_HOOKS.length;
const g_vecObservedSources = [];
const g_vecErrors = [];

function ObserveSource(Exception) {
	g_vecObservedSources.push(Exception.Source);
}

const g_Observer = new ExceptionHook(ObserveSource);

try {
	if (g_Observer.Call({ Source: "manual-dispatch" }) !== undefined) {
		throw new Error("ExceptionHook.Call() returned an unexpected callback result.");
	}

	const Exception = EXCEPTION_HOOKS.PrintException(new TypeError("player index must be an integer"), { Source: "command:sjs_player" });
	if ((g_Observer.Callback !== ObserveSource) || (g_Observer.ClassInstance !== EXCEPTION_HOOKS) || (EXCEPTION_HOOKS.length !== (g_unCallbackCountBefore + 1))) {
		throw new Error("ExceptionHook did not own exactly one default registration.");
	}

	if ((Exception.Name !== "TypeError") || (g_vecObservedSources.length !== 2) || (g_vecObservedSources[0] !== "manual-dispatch") || (g_vecObservedSources[1] !== "command:sjs_player")) {
		throw new Error("ExceptionHook did not receive the normalized exception.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if ((g_Observer.Dispose() !== ObserveSource) || (EXCEPTION_HOOKS.length !== g_unCallbackCountBefore)) {
			throw new Error("ExceptionHook did not release its callback.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "ExceptionHook dispatch and cleanup failed.");
}
```

### `ExceptionHooks`

Create a separate collection when a subsystem needs independent local observers but the same native/logging path.

```js
const { ExceptionHooks } = require("memory/hooks/exceptions");

const g_vecCommandExceptions = new ExceptionHooks();
const g_vecObservedNames = [];
const g_vecErrors = [];

function ObserveName(Exception) {
	g_vecObservedNames.push(Exception.Name);
}

try {
	if ((g_vecCommandExceptions.Append(ObserveName) !== ObserveName) || (g_vecCommandExceptions.ClassName !== "ExceptionHooks")) {
		throw new Error("The independent exception collection did not register its observer.");
	}

	const Exception = g_vecCommandExceptions.PrintException(new RangeError("duration must be non-negative"), { Source: "ban-command" });
	if ((Exception.Message !== "duration must be non-negative") || (Exception.Source !== "ban-command") || (g_vecObservedNames.length !== 1) || (g_vecObservedNames[0] !== "RangeError")) {
		throw new Error("The independent collection did not normalize and dispatch the exception.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		g_vecCommandExceptions.Clear();

		if (g_vecCommandExceptions.length !== 0) {
			throw new Error("The independent exception collection did not clear its observer.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Independent exception dispatch and cleanup failed.");
}
```

### `Emit`

`Emit(Payload)` sends an existing object through the low-level native channel without normalizing or logging it. The observer receives a decoded JSON copy.

```js
const { Emit, Off, On } = require("memory/hooks/exceptions");

const g_vecObservedPayloads = [];
const g_vecErrors = [];
let g_bCallbackRegistered = false;

function ObserveNativeException(Payload) {
	g_vecObservedPayloads.push(Payload);
}

try {
	const RegisteredCallback = On(ObserveNativeException);
	if (RegisteredCallback !== ObserveNativeException) {
		throw new Error("The native exception channel did not retain callback identity.");
	}

	g_bCallbackRegistered = true;

	const Payload = {
		Name: "Error",
		Message: "Native callback failed",
		Source: "memory-hook",
	};
	if (Emit(Payload) !== undefined) {
		throw new Error("The native exception emitter returned an unexpected value.");
	}

	if ((g_vecObservedPayloads.length !== 1) || (g_vecObservedPayloads[0] === Payload) || (JSON.stringify(g_vecObservedPayloads[0]) !== JSON.stringify(Payload))) {
		throw new Error("The native exception channel did not deliver an independent JSON copy.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bCallbackRegistered) {
		try {
			if (!Off(ObserveNativeException)) {
				throw new Error("The native exception channel did not remove its callback.");
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
	throw new AggregateError(g_vecErrors, "Native exception emission and cleanup failed.");
}
```

### `Off`

`Off(Callback)` removes the exact native-channel callback and returns whether it was registered.

```js
const { Off, On } = require("memory/hooks/exceptions");

const g_vecErrors = [];
let g_bCallbackRegistered = false;

function ObserveNativeException() {
}

try {
	const RegisteredCallback = On(ObserveNativeException);
	if (RegisteredCallback !== ObserveNativeException) {
		throw new Error("The native exception channel did not register the callback.");
	}

	g_bCallbackRegistered = true;

	const bRemoved = Off(RegisteredCallback);
	if (bRemoved) {
		g_bCallbackRegistered = false;
	}

	if (!bRemoved || (Off(ObserveNativeException) !== false)) {
		throw new Error("Off() did not report exact callback ownership.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bCallbackRegistered) {
		try {
			if (!Off(ObserveNativeException)) {
				throw new Error("The native exception callback could not be cleaned up after the Off() check.");
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
	throw new AggregateError(g_vecErrors, "Native exception removal and cleanup failed.");
}
```

### `On`

`On(Callback)` returns the registered callback, allowing one local variable to own registration and cleanup.

```js
const { Emit, Off, On } = require("memory/hooks/exceptions");

let g_unCallbackCount = 0;
const g_vecErrors = [];
let g_bObserverRegistered = false;

function ObserveConnectionFailure(Payload) {
	if ((Payload.Name !== "Error") || (Payload.Message !== "Connection failed")) {
		throw new Error("The native exception channel changed the emitted payload.");
	}

	g_unCallbackCount += 1;
}

try {
	const Observer = On(ObserveConnectionFailure);
	if (Observer !== ObserveConnectionFailure) {
		throw new Error("On() did not return the registered callback.");
	}

	g_bObserverRegistered = true;

	if ((Emit({ Name: "Error", Message: "Connection failed" }) !== undefined) || (g_unCallbackCount !== 1)) {
		throw new Error("The native exception callback was not invoked exactly once.");
	}

	if (!Off(Observer)) {
		throw new Error("The native exception channel did not remove the observer.");
	}

	g_bObserverRegistered = false;
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bObserverRegistered) {
		try {
			if (!Off(ObserveConnectionFailure)) {
				throw new Error("The native exception callback could not be removed during cleanup.");
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
	throw new AggregateError(g_vecErrors, "Native exception observation and cleanup failed.");
}
```

### `ExceptionHooks.PrintException`

Set `bCallbacks` to `false` when a diagnostic must still reach the native channel and logger without invoking local observers.

```js
const { EXCEPTION_HOOKS, Off, On } = require("memory/hooks/exceptions");

const g_Cause = new Error("Database transaction rolled back");
const g_unCallbackCountBefore = EXCEPTION_HOOKS.length;
const g_vecErrors = [];
let g_unLocalCallbackCount = 0;
let g_NativeException = null;
let g_bLocalObserverRegistered = false;
let g_bNativeObserverRegistered = false;

function ObserveLocalException() {
	g_unLocalCallbackCount += 1;
}

function ObserveNativeException(Payload) {
	g_NativeException = Payload;
}

try {
	const RegisteredLocalObserver = EXCEPTION_HOOKS.Append(ObserveLocalException);
	if (RegisteredLocalObserver !== ObserveLocalException) {
		throw new Error("The local exception collection did not register its observer.");
	}

	g_bLocalObserverRegistered = true;

	const RegisteredNativeObserver = On(ObserveNativeException);
	if (RegisteredNativeObserver !== ObserveNativeException) {
		throw new Error("The native exception channel did not register its observer.");
	}

	g_bNativeObserverRegistered = true;

	const Exception = EXCEPTION_HOOKS.PrintException(g_Cause, { Source: "soci", Operation: "save-settings" }, false);
	if ((Exception.Error !== g_Cause) || (Exception.Name !== "Error") || (Exception.Message !== g_Cause.message) || (Exception.Source !== "soci") || (Exception.Operation !== "save-settings")) {
		throw new Error("PrintException() did not return the complete local record.");
	}

	if ((g_unLocalCallbackCount !== 0) || (g_NativeException === null) || (g_NativeException.Message !== g_Cause.message) || (g_NativeException.Source !== "soci")) {
		throw new Error("bCallbacks=false did not isolate local dispatch from the native channel.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bNativeObserverRegistered) {
		try {
			if (!Off(ObserveNativeException)) {
				throw new Error("The native exception channel did not remove its observer.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	if (g_bLocalObserverRegistered) {
		try {
			if ((EXCEPTION_HOOKS.Remove(ObserveLocalException) !== ObserveLocalException) || (EXCEPTION_HOOKS.length !== g_unCallbackCountBefore)) {
				throw new Error("The local exception collection did not restore its state.");
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
	throw new AggregateError(g_vecErrors, "Exception reporting and observer cleanup failed.");
}
```

## Errors and lifecycle

- `Emit()` requires a non-array object whose `JSON.stringify()` result is a string. Circular records and unsupported top-level values throw before native emission. Native observers require that string to decode to a non-array object; custom `toJSON()` results that decode to null, a primitive or an array are rejected by the observer.
- `On()` requires a function and rejects duplicate callback identity. `Off()` returns `false` for an absent callback and retains its wrapper when native removal fails, allowing a later retry.
- `PrintException()` requires a non-array `Extra` object and an exact boolean `bCallbacks` value. Extra fields intentionally override normalized fields because they are merged last, including `Name`, `Message`, `Stack` and `Error`. A JSON-safe `Extra.Error` can replace an unserializable original value, but also replaces it in the returned local record.
- When reporting succeeds, a local callback failure produces one additional native/logged record with `Source: "exception-callback"`. That report disables local callback dispatch, not the native channel; native observers must avoid recursive reporting.
- `ExceptionHook.Dispose()` returns its callback and removes it exactly once. A repeated call throws because ownership has already ended.
- `PrintException()` emits first, invokes a snapshot of local callbacks when enabled, then logs. A later failure does not undo earlier side effects. Process-level failure handlers swallow reporting errors so those errors do not escape the handler; successful logging is not guaranteed.
- Native callbacks and local decorators belong to the current plugin context. Remove or dispose them explicitly during reloadable component teardown instead of relying on eventual context destruction.
