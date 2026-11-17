# `require("memory/hooks")`

> AI processing warning: this page documents callback-container primitives used by hook modules. Preserve callback identity and missing-registration behavior in examples.

The `HookBase` and `HookDecorator` exports provide JavaScript callback-container primitives. `HookBase` is an ordered `Array` subclass, and `HookDecorator` associates a callback with one collection. These classes do not themselves install native Detours hooks.

The public module entry point is `packages/sourcejs/memory/hooks.js`; it re-exports these classes from `packages/sourcejs/memory/hooks/index.js` and also exposes the native hook API documented in [Native memory hooks](memory-hooks.md).

## Contents

- [Import](#import)
- [Runtime model](#runtime-model)
- [Exports](#exports)
- [Class members](#class-members)
- [Examples](#examples)

## Import

```js
const { HookBase, HookDecorator } = require("memory/hooks");

const g_vecCallbacks = new HookBase();
const g_Decorator = new HookDecorator((nValue) => nValue * 2, g_vecCallbacks);

const g_vecErrors = [];

try {
	if ((g_vecCallbacks.length !== 1) || (g_Decorator.Call(21) !== 42)) {
		throw new Error("memory/hooks import check failed");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((g_Decorator.Dispose() !== g_Decorator.Callback) || (g_vecCallbacks.length !== 0)) {
			throw new Error("memory/hooks import cleanup failed");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Hook example and callback cleanup failed.");
}
```

## Runtime model

- `HookBase.Append()` rejects non-functions and callback identities already present in the collection. Other inherited `Array` mutation methods retain their native behavior and do not apply this validation.
- `HookBase.Remove()` uses `Array#indexOf`-style strict equality and removes the first matching entry. It does not revalidate callability, so values added by inherited `Array` mutators can also be removed. An absent value throws an `Error`; `NaN` does not match itself.
- `HookDecorator` delegates registration to its owner's `Append(Callback)`. The constructor checks that `Append` is callable; `Dispose()` also needs a callable `Remove`. Use a `HookBase` owner for the documented identity validation, supplied explicitly or through a subclass's static `ClassInstance`.
- With a `HookBase` owner, `HookDecorator.Dispose()` removes and returns the current callback. Calling it again without re-registering that callback throws because it is no longer present.
- These classes are local to one JavaScript context. They do not provide cross-plugin communication; use the serialized plugin bus for that purpose.

Registration, removal, and decorator calls run synchronously in the calling context. Exceptions from owner methods, callback invocation, or diagnostic name reads and string conversions propagate unchanged. In particular, a user-defined diagnostic getter or conversion can throw before the usual validation `TypeError` or registration `Error` is constructed.

The example event labels are project-owned demonstration values, not native engine event names.

## Exports

This page lists the callback-container classes; the same public module also exposes the native hook API documented in [Native memory hooks](memory-hooks.md).

| Export | Kind | Signature |
| --- | --- | --- |
| [`HookBase`](#hookbase-1) | Class | `new HookBase()` |
| [`HookDecorator`](#hookdecorator-1) | Class | `new HookDecorator(Callback, ClassInstance = new.target.ClassInstance)` |

## Class members

### `HookBase`

| Member | Kind | Description |
| --- | --- | --- |
| `length` | Live field | Inherited array length; it can include holes or non-callback values introduced through ordinary array mutation. |
| [`ClassName`](#hookbaseclassname) | Getter | Runtime constructor name used by registration diagnostics. |
| [`Append(Callback)`](#hookbaseappend) | Method | Registers and returns a function; throws a `TypeError` for non-functions or an `Error` for a duplicate identity. |
| [`Remove(Callback)`](#hookbaseremove) | Method | Removes and returns the first strict-equality match without a separate callable check; throws an `Error` if no match is registered. |
| [`Clear()`](#hookbaseclear) | Method | Removes every entry and returns `undefined`. |

### `HookDecorator`

| Member | Kind | Description |
| --- | --- | --- |
| `Callback` | Live field | Current callback registered with `ClassInstance`; do not replace it while registered. |
| `ClassInstance` | Live field | Callback owner with `Append` and `Remove`; use `HookBase` for identity validation, and do not replace the owner while registered. |
| [`Call(...vecCallbackArguments)`](#hookdecoratorcall) | Method | Invokes the current callback as a method of this decorator and returns its result; arrow and bound functions retain their own receiver semantics. |
| [`Dispose()`](#hookdecoratordispose) | Method | Calls the owner's `Remove` and returns the current `Callback`; a `HookBase` owner throws if that exact callback is not registered. |

## Examples

### `HookBase`

Use `HookBase` when callback order and exact function identity are part of the subsystem contract.

```js
const { HookBase } = require("memory/hooks");

const g_vecCallbacks = new HookBase();
const g_vecObservedStages = [];
const g_vecErrors = [];

function ValidateEvent(Payload) {
	g_vecObservedStages.push(`validate:${Payload.Name}`);
}

function DispatchEvent(Payload) {
	g_vecObservedStages.push(`dispatch:${Payload.Name}`);
}

try {
	if ((g_vecCallbacks.Append(ValidateEvent) !== ValidateEvent) || (g_vecCallbacks.Append(DispatchEvent) !== DispatchEvent)) {
		throw new Error("HookBase.Append did not return the registered callbacks");
	}

	for (const Callback of g_vecCallbacks) {
		Callback({ Name: "ServerActivate" });
	}

	if ((g_vecCallbacks.length !== 2) || (g_vecObservedStages.length !== 2) || (g_vecObservedStages[0] !== "validate:ServerActivate") || (g_vecObservedStages[1] !== "dispatch:ServerActivate")) {
		throw new Error("HookBase did not preserve callback registration order");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		const ClearResult = g_vecCallbacks.Clear();
		if ((ClearResult !== undefined) || (g_vecCallbacks.length !== 0)) {
			throw new Error("HookBase cleanup did not empty the callback collection");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Hook example and callback cleanup failed.");
}
```

### `HookDecorator`

A subclass can publish one class-level callback collection for every decorator instance.

```js
const { HookBase, HookDecorator } = require("memory/hooks");

class EventObserver extends HookDecorator {
}

EventObserver.ClassInstance = new HookBase();

const g_Observer = new EventObserver((Payload) => Payload.Name.toUpperCase());

const g_vecErrors = [];

try {
	if ((EventObserver.ClassInstance.length !== 1) || (g_Observer.Call({ Name: "PlayerSpawn" }) !== "PLAYERSPAWN")) {
		throw new Error("HookDecorator did not register or invoke its callback");
	}

	if ((g_Observer.Dispose() !== g_Observer.Callback) || (EventObserver.ClassInstance.length !== 0)) {
		throw new Error("HookDecorator.Dispose did not remove and return its callback");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (EventObserver.ClassInstance.includes(g_Observer.Callback)) {
			if (g_Observer.Dispose() !== g_Observer.Callback) {
				throw new Error("HookDecorator cleanup failed");
			}
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Hook example and callback cleanup failed.");
}
```

### `HookBase.Append`

`Append(Callback)` returns the exact callback, which is useful when registration and local ownership happen in one expression.

```js
const { HookBase } = require("memory/hooks");

const g_vecCallbacks = new HookBase();
const g_vecErrors = [];

function DoubleValue(Payload) {
	return Payload.Value * 2;
}

try {
	if ((g_vecCallbacks.Append(DoubleValue) !== DoubleValue) || (g_vecCallbacks.length !== 1) || (DoubleValue({ Value: 21 }) !== 42)) {
		throw new Error("HookBase.Append did not register and return the supplied callback");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((g_vecCallbacks.Remove(DoubleValue) !== DoubleValue) || (g_vecCallbacks.length !== 0)) {
			throw new Error("HookBase.Append example cleanup failed");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Hook example and callback cleanup failed.");
}
```

### `HookBase.ClassName`

Subclasses automatically provide a semantic name for duplicate and missing-registration errors.

```js
const { HookBase } = require("memory/hooks");

class DamageHooks extends HookBase {
}

const g_vecCallbacks = new DamageHooks();
if (g_vecCallbacks.ClassName !== "DamageHooks") {
	throw new Error("HookBase.ClassName did not return the runtime constructor name");
}
```

### `HookBase.Clear`

Use `Clear()` for deterministic teardown when one owner controls the complete collection.

```js
const { HookBase } = require("memory/hooks");

const g_vecCallbacks = new HookBase();
const g_FirstCallback = g_vecCallbacks.Append(() => "first");
const g_SecondCallback = g_vecCallbacks.Append(() => "second");
if ((typeof g_FirstCallback !== "function") || (typeof g_SecondCallback !== "function") || (g_vecCallbacks.length !== 2)) {
	throw new Error("HookBase.Clear example setup failed");
}

if ((g_vecCallbacks.Clear() !== undefined) || (g_vecCallbacks.length !== 0)) {
	throw new Error("HookBase.Clear did not empty the callback collection");
}
```

### `HookBase.Remove`

Removal uses function identity and returns the removed callback.

```js
const { HookBase } = require("memory/hooks");

const g_vecCallbacks = new HookBase();

function ObserveServerActivate(Payload) {
	return Payload.MapName;
}

if (g_vecCallbacks.Append(ObserveServerActivate) !== ObserveServerActivate) {
	throw new Error("HookBase.Remove example registration failed");
}

const g_RemovedCallback = g_vecCallbacks.Remove(ObserveServerActivate);
if ((g_RemovedCallback !== ObserveServerActivate) || (g_RemovedCallback({ MapName: "test_map" }) !== "test_map") || (g_vecCallbacks.length !== 0)) {
	throw new Error("HookBase.Remove did not remove and return the exact callback");
}
```

### `HookDecorator.Call`

Pass an explicit owner when a dedicated subclass would not add useful meaning.

```js
const { HookBase, HookDecorator } = require("memory/hooks");

const g_vecCallbacks = new HookBase();
const g_Decorator = new HookDecorator((strEventName, unPlayerIndex) => `${strEventName}:${unPlayerIndex}`, g_vecCallbacks);

const g_vecErrors = [];

try {
	if ((g_vecCallbacks.length !== 1) || (g_Decorator.Call("PlayerDisconnect", 3) !== "PlayerDisconnect:3")) {
		throw new Error("HookDecorator.Call did not forward the callback arguments");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((g_Decorator.Dispose() !== g_Decorator.Callback) || (g_vecCallbacks.length !== 0)) {
			throw new Error("HookDecorator.Call example cleanup failed");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Hook example and callback cleanup failed.");
}
```

### `HookDecorator.Dispose`

`Dispose()` returns the owned callback after removing it from the collection.

```js
const { HookBase, HookDecorator } = require("memory/hooks");

const g_vecCallbacks = new HookBase();

function ObserveLevelEnd() {
	return "LevelEnd";
}

const g_Decorator = new HookDecorator(ObserveLevelEnd, g_vecCallbacks);
const g_unCallbackCountBeforeDisposal = g_vecCallbacks.length;
const g_RemovedCallback = g_Decorator.Dispose();
let g_RepeatedDisposeError = null;

try {
	g_Decorator.Dispose();
} catch (CaughtError) {
	g_RepeatedDisposeError = CaughtError;
}

if ((g_RemovedCallback !== ObserveLevelEnd) || (g_unCallbackCountBeforeDisposal !== 1) || (g_vecCallbacks.length !== 0)) {
	throw new Error("HookDecorator.Dispose did not remove and return the owned callback");
}

if (g_RepeatedDisposeError === null) {
	throw new Error("HookDecorator.Dispose did not reject repeated disposal");
}
```
