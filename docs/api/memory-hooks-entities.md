# `require("memory/hooks/entities")`

> AI processing note: this page documents the native entity-aware facade over the shared Detours hook registry. Keep entity/index normalization, hook definition types, call argument values and process-wide registry operations distinct.

`memory/hooks/entities` resolves entity method targets and installs real function or vtable hooks. It accepts entity indexes, supported entity wrappers or native entity addresses, normalizes them to current entity indexes and then delegates to the same x86/x86_64 Detours engine as [`memory/hooks`](memory-hooks.md).

Native addresses must be JavaScript `BigInt` values that fit the current architecture's address width; they are not `Number` values or strings. Hook IDs and entity/vtable indexes are separate integer values. There are no compatibility aliases, fallback hooks or SDK-specific guessed vtable indexes.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Entity Hook Options](#entity-hook-options)
- [Create Hook Handles](#create-hook-handles)
- [Register Callbacks](#register-callbacks)
- [Registry And Dispatch State](#registry-and-dispatch-state)
- [Call A Hook Target](#call-a-hook-target)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	AddPostEntityHook,
	AddPreEntityHook,
	CallFunction,
	CreateEntityHook,
	CreateEntityVTableHook,
	GetHookList,
	GetHooksDisabled,
	RemoveAllHooks,
	RemoveHook,
	SetHooksDisabled,
} = require("memory/hooks/entities");
```

## Exports

| Export | Signature | Purpose |
| --- | --- | --- |
| `CreateEntityHook` | `CreateEntityHook(Options)`, `CreateEntityHook(Entity, Options)`, `CreateEntityHook(Entity, unVTableIndex)` or `CreateEntityHook(Entity, unVTableIndex, Options)` | Selects a function or vtable hook from the supplied options. |
| `CreateEntityVTableHook` | `CreateEntityVTableHook(Options)`, `CreateEntityVTableHook(Entity, Options)`, `CreateEntityVTableHook(Entity, unVTableIndex)` or `CreateEntityVTableHook(Entity, unVTableIndex, Options)` | Forces entity/object vtable resolution. |
| `AddPreEntityHook` | `AddPreEntityHook(Options, Callback)`, `AddPreEntityHook(Entity, Options, Callback)` or `AddPreEntityHook(Entity, unVTableIndex, Options, Callback)` | Creates/reuses a hook and registers a pre callback. |
| `AddPostEntityHook` | `AddPostEntityHook(Options, Callback)`, `AddPostEntityHook(Entity, Options, Callback)` or `AddPostEntityHook(Entity, unVTableIndex, Options, Callback)` | Creates/reuses a hook and registers a post callback. |
| `GetHookList` | `GetHookList()` | Returns a fresh snapshot of the shared process hook registry. |
| `RemoveHook` | `RemoveHook(nHookID)` | Removes one positive integer hook ID supplied as a JavaScript `Number`. |
| `RemoveAllHooks` | `RemoveAllHooks()` | Removes every SourceJS memory hook in the process and returns whether all removals succeeded. |
| `GetHooksDisabled` | `GetHooksDisabled()` | Reads the process-wide callback-dispatch state. |
| `SetHooksDisabled` | `SetHooksDisabled(bDisabled)` | Changes callback dispatch without removing hooks and returns the applied boolean state. |
| `CallFunction` | `CallFunction(Options)` | Calls a function at a native `BigInt` address with explicit ABI values. |

## Entity Hook Options

When a positional overload includes an existing options object, the binding writes `Entity` and, when supplied, `Index` into that object before native validation. Entity normalization replaces a supplied `Entity` with its resolved index; vtable resolution also writes the resolved function `Address` before creating the function hook. A supplied `Entity` must normalize successfully even when `ObjectAddress` selects the vtable target. Without an options object, the `(Entity, unVTableIndex)` overload creates one with `Entity` and `Index` as own writable, enumerable, configurable data properties. Initializing these new fields bypasses inherited setters and inherited non-writable properties; writes to an existing options object still use its normal property semantics, including accessors. Pass a fresh object when caller-owned configuration must remain unchanged.

`CreateEntityHook()`, `CreateEntityVTableHook()`, `AddPreEntityHook()` and `AddPostEntityHook()` preserve an exception thrown while reading or writing options, including an entity wrapper's `Index` getter. They stop processing that failed read instead of trying an address fallback or creating a hook. Options are still caller-owned mutable objects: writes completed before a later failure are not rolled back. In callback overloads, the final callback is not part of the creation arguments, even though JavaScript functions are objects.

| Option | Purpose |
| --- | --- |
| `Entity` | Non-negative integer entity-index `Number`, supported entity wrapper or nonzero native entity address as `BigInt`. |
| `Index` | Zero-based vtable slot. A defined value undergoes numeric conversion, then finite/integral/int32 validation; takes precedence over `Offset`, including when `null` converts to zero. Supply a verified non-negative slot for the target SDK/game. |
| `Offset` | Byte offset into the vtable, used only when `Index` is `undefined`. Undergoes the same numeric conversion and int32 validation; supply a verified non-negative offset. |
| `Kind` | `"VTABLE"` or `"FUNCTION"` (case-insensitive) forces that hook kind. Otherwise, a defined, non-null `Address` selects function; absent that, defined `Entity`/`ObjectAddress` selects vtable. |
| `Address` | Nonzero, architecture-width `BigInt` executable address for an explicit function hook. |
| `ObjectAddress` | Architecture-width, non-negative `BigInt` used for vtable resolution. A nonzero value takes precedence over `Entity`; `0n` or `undefined` falls back to `Entity`. `null` and `Number` are invalid. |
| `Convention` | ABI convention such as `"thiscall"`, `"fastcall"` or `"cdecl"`. |
| `ReturnType` | Native return type consumed by the shared hook engine. |
| `Arguments` | Native argument type declarations for hook creation. |

The positional `unVTableIndex` argument must be a `Number`; the options fields above instead use JavaScript numeric conversion before range checks. For example, numeric strings, booleans and `null` can convert to valid indexes; `BigInt` and `Symbol` cannot. Prefer explicit integer `Number` values rather than relying on coercion. Conversion getters can throw; a defined invalid `Index` does not fall back to `Offset`.

The complete register, FPU/SIMD, argument, return-value and trampoline callback context is documented by [`memory/hooks`](memory-hooks.md).

## Create Hook Handles

`CreateEntityHook()` chooses the hook kind from `Kind` and target fields. `CreateEntityVTableHook()` always uses vtable resolution. Both return `null` when a validated target cannot be resolved; otherwise they return a JavaScript handle for the process-wide native hook record. Reusing an existing function target records the current V8 context as an owner if it does not already own that hook, and returns another handle with the same ID. An already registered target retains its original ABI signature: the existing-record fast path does not read or validate replacement `Convention`, `ReturnType`, or `Arguments` fields. Reuse is not an ABI-reconfiguration operation.

The native boundaries for `CreateEntityHook()`, `CreateEntityVTableHook()`, `AddPreEntityHook()`, `AddPostEntityHook()` and shared `GetHookList()` retrieval translate a C++ exception into a JavaScript error naming the callback, without exposing the original exception text. This does not recover from an invalid native address or ABI, guarantee rollback of a completed hook operation, or make these APIs thread-safe.

`ID` is a positive integer `Number`; `Address` and `TrampolineAddress` are `BigInt` values. The handle also exposes callback methods and `Remove()`.

```js
// The exported workflow shares the native function's name, so this import needs an alias.
const { CreateEntityHook, CreateEntityVTableHook: g_CreateNativeEntityVTableHook } = require("memory/hooks/entities");

function RequireEntityHook(Hook, strOperation) {
	if ((Hook === null) || !Number.isSafeInteger(Hook.ID) || (Hook.ID <= 0) || (typeof Hook.Address !== "bigint") || (Hook.Address <= 0n)) {
		throw new Error(`${strOperation} did not create a valid entity hook.`);
	}

	return Hook;
}

function CreateAutomaticEntityHook(Entity, unVTableIndex, Definition) {
	const Hook = CreateEntityHook(Entity, unVTableIndex, { ...Definition });

	return RequireEntityHook(Hook, "CreateEntityHook");
}

function CreateEntityVTableHook(Entity, unVTableIndex, Definition) {
	const Hook = g_CreateNativeEntityVTableHook(Entity, unVTableIndex, { ...Definition });

	return RequireEntityHook(Hook, "CreateEntityVTableHook");
}

module.exports = {
	CreateAutomaticEntityHook,
	CreateEntityVTableHook,
};
```

`Definition` must come from selected-game configuration or reviewed gamedata. Do not reuse a vtable slot from another SDK branch.

## Register Callbacks

`AddPreEntityHook()` and `AddPostEntityHook()` return booleans rather than handles. Supply fresh callback identities that no other registration uses. Since these APIs may reuse a process-wide hook, the example removes only the callbacks it confirmed registering and leaves the native hook installed. Call `RemoveHook()` separately only when no other subsystem relies on that hook; owner-context teardown also releases the current context's ownership. `Dispose()` attempts every confirmed removal in reverse order, returns whether all succeeded when no removal throws, and never retries after its first call. A thrown removal is rethrown alone or combined with other removal failures in an `AggregateError`; registration failures remain first when cleanup also fails. Unknown partial registration effects and failed removals still require context teardown or coordinated explicit recovery.

```js
const {
	AddPostEntityHook,
	AddPreEntityHook,
	CreateEntityVTableHook,
} = require("memory/hooks/entities");

function RegisterEntityMethodObservers(Entity, unVTableIndex, Definition, OnPre, OnPost) {
	if ((typeof OnPre !== "function") || (typeof OnPost !== "function")) {
		throw new TypeError("Entity hook observers must be functions.");
	}

	const Hook = CreateEntityVTableHook(Entity, unVTableIndex, { ...Definition });
	if (Hook === null) {
		throw new Error("Entity observer workflow could not resolve the target.");
	}

	let bPreCallbackRegistered = false;
	let bPostCallbackRegistered = false;
	let bDisposed = false;

	function RemoveRegisteredCallbacks() {
		const vecErrors = [];
		let bRemoved = true;
		let bHasException = false;

		if (bPostCallbackRegistered) {
			try {
				if (!Hook.RemovePost(OnPost)) {
					bRemoved = false;
					vecErrors.push(new Error("Entity post callback removal failed."));
				}
			} catch (CaughtError) {
				bRemoved = false;
				bHasException = true;
				vecErrors.push(CaughtError);
			}
		}

		if (bPreCallbackRegistered) {
			try {
				if (!Hook.RemovePre(OnPre)) {
					bRemoved = false;
					vecErrors.push(new Error("Entity pre callback removal failed."));
				}
			} catch (CaughtError) {
				bRemoved = false;
				bHasException = true;
				vecErrors.push(CaughtError);
			}
		}

		return { Removed: bRemoved, HasException: bHasException, Errors: vecErrors };
	}

	try {
		if (!AddPreEntityHook(Entity, unVTableIndex, { ...Definition }, OnPre)) {
			throw new Error("Entity pre callback registration failed.");
		}

		bPreCallbackRegistered = true;

		if (!AddPostEntityHook(Entity, unVTableIndex, { ...Definition }, OnPost)) {
			throw new Error("Entity post callback registration failed.");
		}

		bPostCallbackRegistered = true;

		return {
			Hook,
			Dispose() {
				if (bDisposed) {
					return false;
				}

				bDisposed = true;

				const Cleanup = RemoveRegisteredCallbacks();
				if (Cleanup.HasException) {
					if (Cleanup.Errors.length === 1) {
						throw Cleanup.Errors[0];
					}

					throw new AggregateError(Cleanup.Errors, "Entity observer removal failed.");
				}

				return Cleanup.Removed;
			},
		};
	} catch (CaughtError) {
		const Cleanup = RemoveRegisteredCallbacks();
		if (Cleanup.Errors.length !== 0) {
			throw new AggregateError([CaughtError, ...Cleanup.Errors], "Entity observer registration and cleanup failed.");
		}

		throw CaughtError;
	}
}

module.exports = { RegisterEntityMethodObservers };
```

Pre callbacks may edit the live invocation context or call `Payload.CallHookTrampoline({ Arguments, Registers })`. That call returns `{ ReturnValue, Registers }`; returning only `ReturnValue` forwards only the original result. Post callbacks observe the resulting return context. See [`memory/hooks`](memory-hooks.md) for the full payload contract.

## Registry And Dispatch State

The registry and disabled flag are shared with `memory/hooks`; they are not filtered to entity-created hooks.

`GetHookList()` returns a new array of snapshot records. Each record has a positive integer `ID` as a `Number` and native `Address`/`TrampolineAddress` values as `BigInt`.

```js
const {
	GetHookList,
	GetHooksDisabled,
	RemoveAllHooks,
	RemoveHook,
	SetHooksDisabled,
} = require("memory/hooks/entities");

function InspectEntityHookRegistry() {
	return GetHookList().map((Entry) => ({
		ID: Entry.ID,
		Address: Entry.Address,
		TrampolineAddress: Entry.TrampolineAddress,
	}));
}

function RemoveEntityHook(nHookID) {
	return RemoveHook(nHookID);
}

function WithEntityHookDispatchDisabled(Callback, bDisabled = true) {
	if (typeof Callback !== "function") {
		throw new TypeError("Entity hook dispatch callback must be a function.");
	}

	const bPreviousDisabled = GetHooksDisabled();
	const bRequestedDisabled = Boolean(bDisabled);
	const vecErrors = [];
	let CallbackResult = undefined;

	try {
		if (SetHooksDisabled(bRequestedDisabled) !== bRequestedDisabled) {
			throw new Error("Entity hook dispatch state did not change.");
		}

		CallbackResult = Callback();
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	} finally {
		try {
			if (SetHooksDisabled(bPreviousDisabled) !== bPreviousDisabled) {
				throw new Error("Entity hook dispatch state did not restore.");
			}
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "Entity hook dispatch operation and restoration failed.");
	}

	return CallbackResult;
}

function RemoveEveryMemoryHook(vecExpectedHookIDs) {
	const vecCurrentHookIDs = GetHookList().map((Entry) => Entry.ID).sort((nLeftHookID, nRightHookID) => nLeftHookID - nRightHookID);
	const vecSortedExpectedHookIDs = vecExpectedHookIDs.slice().sort((nLeftHookID, nRightHookID) => nLeftHookID - nRightHookID);
	if ((vecCurrentHookIDs.length !== vecSortedExpectedHookIDs.length) || vecCurrentHookIDs.some((nHookID, unIndex) => nHookID !== vecSortedExpectedHookIDs[unIndex])) {
		throw new Error("RemoveAllHooks refused because the process registry contains unexpected hook IDs.");
	}

	return RemoveAllHooks() && (GetHookList().length === 0);
}

module.exports = {
	InspectEntityHookRegistry,
	RemoveEntityHook,
	RemoveEveryMemoryHook,
	WithEntityHookDispatchDisabled,
};
```

`RemoveEveryMemoryHook()` checks an explicit hook-ID allowlist because `RemoveAllHooks()` can remove hooks owned by other plugins or subsystems. Matching IDs do not prove exclusive ownership; coordinate all owners before calling it. `RemoveAllHooks()` returns `false` while post-hook frames are pending or a removal fails. Earlier successful removals are not rolled back.

`WithEntityHookDispatchDisabled()` returns the callback's exact result and attempts restoration once after setup, even when setup fails. A lone operation/restoration exception is rethrown unchanged; concurrent failures are reported in that order through `AggregateError`. A failed restoration may leave the process-wide flag changed. This synchronous workflow does not isolate other owners or wait for an asynchronous callback's completion; coordinate access and use a synchronous callback.

## Call A Hook Target

`CallFunction()` is the shared ABI-aware address caller. It does not infer a call target from an entity index; use a created hook's `BigInt` `Address` and provide call argument values explicitly:

```js
const { CallFunction } = require("memory/hooks/entities");

function CallEntityHookTarget(Hook, CallOptions) {
	if ((Hook === null) || (typeof Hook.Address !== "bigint") || (Hook.Address <= 0n)) {
		throw new TypeError("A live entity hook with a BigInt address is required.");
	}

	return CallFunction({
		...CallOptions,
		Address: Hook.Address,
	});
}

module.exports = { CallEntityHookTarget };
```

For `CallFunction()`, `Arguments` contains runtime argument values rather than the type declarations used while creating a hook. Set `ReturnContext: true` to receive the complete post-call register/FPU/SIMD context with `ReturnValue` and `Registers`.

## Errors

- Unsupported overload shapes and malformed value types produce native validation errors.
- A validated target that the native hook manager cannot resolve produces `null` from `CreateEntityHook()`/`CreateEntityVTableHook()` and `false` from `AddPreEntityHook()`/`AddPostEntityHook()`.
- When building a new hook's signature, invalid ABI definitions, conventions or type declarations produce native validation errors; the existing-record fast path described above does not rebuild that signature. Negative vtable indexes/offsets fail resolution; positive indexes/offsets are not bounds-checked against the target's vtable and must be verified before use.
- `RemoveHook(nHookID)` returns `false` when the positive integer ID is absent or Detours cannot release the hook. A failed release retains the native record and its resources. Reusing a removed handle does not recreate the hook.
- `CallFunction()` propagates ABI definition and native invocation errors; a wrong convention, argument layout or object address can crash the game process.

## Lifecycle

Hook IDs, BigInt addresses, trampolines, registry values and callback contexts are live process-local state. Re-read `GetHookList()` after every create/remove action and never persist those values across map changes, plugin reloads or game restarts.

Explicitly remove owned handles and callbacks during plugin teardown. SourceJS also removes hooks and callbacks owned by a V8 context when that plugin context unloads, but explicit cleanup keeps ordinary reload and failure paths deterministic.

Entity deletion does not make a retained entity method target safe to call. Validate the entity immediately before an operation, and never retain callback payloads after the callback returns.

## Related Modules

- [`memory/hooks`](memory-hooks.md) documents the complete Detours handle, callback, trampoline and ABI context.
- [`memory/manager`](memory-manager.md) resolves symbols, signatures and native addresses as `BigInt` values.
- [`entities/entity`](entities-entity.md) provides live entity wrappers accepted by entity normalization.
- [`memory/gamedata`](memory-gamedata.md) selects reviewed per-game signatures, offsets and ABI metadata.
