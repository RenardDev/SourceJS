# `require("memory/hooks")`

> AI processing warning: this page documents low-level executable-memory operations. Review one section at a time and preserve every ownership and ABI condition when changing examples.

`memory/hooks` installs Detours function and vtable hooks, performs ABI-aware native calls and exposes the captured x86/x86_64 callback context. Use it when an SDK interface does not provide the interception point directly. Prefer ordinary SourceJS listeners and SDK calls when they already own the operation.

The module lives at `packages/sourcejs/memory/hooks.js`; native hook creation, invocation and context capture live in `src/sourcejs/MemoryHookManager.cpp`. Runtime listener APIs are documented in [`listeners`](listeners.md).

Selected-SDK rule: unavailable native operations are omitted. Calling an absent export throws a normal JavaScript error; SourceJS does not install fallback stubs. Every native address exposed as `Address`, `ObjectAddress`, `StackAddress`, or `TrampolineAddress` is a JavaScript `bigint`, including 64-bit addresses.

## Contents

- [Import](#import)
- [Runtime model](#runtime-model)
- [Exports](#exports)
- [Callback payload](#callback-payload)
- [Class members](#class-members)
- [Examples](#examples)

## Import

```js
const {
	HookType,
	GetHooksDisabled,
	WithHooksDisabled,
} = require("memory/hooks");

const g_bDisabledBefore = GetHooksDisabled();
const g_ReadDisabledState = () => GetHooksDisabled();
const g_bObservedDisabled = WithHooksDisabled(g_ReadDisabledState, !g_bDisabledBefore);
if ((g_bObservedDisabled !== !g_bDisabledBefore) || (GetHooksDisabled() !== g_bDisabledBefore) || (HookType.Pre === HookType.Post)) {
	throw new Error("memory/hooks import check failed");
}
```

## Runtime model

- `CreateFunctionHook()` hooks the executable address in a hook-definition object. `CreateVTableHook()` resolves a function from an object's vtable by `Index` or byte `Offset` and returns the same native handle shape.
- A hook definition's `Arguments` is an array of ABI type names. `CallFunction()` instead takes actual argument values in `Options.Arguments`; `CallHookTrampoline()` accepts replacement values in `Arguments` and optional register state in `Registers`.
- A native hook handle owns `Pre` and `Post` callbacks. Remove callbacks first when they are registered through decorators, then call `Hook.Remove()` or `RemoveHook(Hook.ID)`.
- A pre-hook may call the real Detours trampoline; do so at most once to avoid invoking the original function repeatedly. On success, `CallHookTrampoline({ Arguments, Registers })` returns `{ ReturnValue, Registers }`; a failed native call can produce `undefined`, and invalid options can throw. A non-`null`, non-`undefined` callback result skips automatic original invocation only when accepted for the declared return type. The initial pre-hook payload has no `ReturnValue` field; read it from the returned trampoline record instead. A completed trampoline call already suppresses automatic original invocation even if the callback returns nothing.
- A pre-hook payload's `StackAddress` is the borrowed native entry-stack address, at the return-address slot. It is not an argument value or an owned allocation. Only inspect storage during that callback using the actual platform/architecture layout; never retain or free it. Post-hook payloads do not expose this field. [Entity-output decoding](entities-outputs.md#abi-arguments) uses it to locate the inline Windows x86 Variant rather than treating the Variant's type word as an address.
- Plugin unload removes hooks and callbacks owned by that plugin context. Explicit cleanup remains preferable for reloadable resources.
- Installing a hook on the wrong function signature can corrupt the stack or crash the server. Resolve a known symbol/signature and declare its real ABI.

Hook definitions default to `Convention: "thiscall"`, `ReturnType: "void"`, and no arguments. A provided `Arguments` must be an array of recognized type names or numeric `DataType` values; `"void"` is valid only as a return type. Its initial array length determines the signature even if getters extend the array while it is read. Convention parsing is case-insensitive, strips leading underscores, and maps `"c"` to `"cdecl"`; only `"cdecl"`, `"stdcall"`, `"thiscall"`, and `"fastcall"` are accepted. A failed getter or conversion stops signature reading before later fields and preserves the original JavaScript exception. These hook defaults differ from `CallFunction()`'s default convention below.

Vtable resolution uses `ObjectAddress` (BigInt), or falls back to `Entity` when no nonzero object address is supplied. `Index` takes precedence over byte `Offset`. The `Entity`, `Index`, and `Offset` fields retain JavaScript numeric conversion, but the result must be finite, integral, and within int32 range: fractions and wrapped integers are rejected. Negative indices/offsets, missing `Index`/`Offset`, or a null object/table/entry produce no target. Complete native address ranges and index multiplication are checked before reading; byte copies also support unaligned slots. These arithmetic checks do not establish memory readability, object lifetime, table bounds, or a valid function ABI. The caller must keep the object and vtable storage live and readable during resolution, and the executable target valid until the hook is removed.

The native `CreateFunctionHook`, `CreateVTableHook`, `AddPreHook`, `AddPostHook`, and `RemoveHook` callbacks translate C++ exceptions to callback-specific JavaScript errors without exposing the original exception text. This boundary does not roll back operations that already completed, validate an arbitrary address or ABI, or recover from invalid native memory or fatal V8 out-of-memory termination. Hook ownership and explicit cleanup still follow the lifecycle above.

Payload methods `SetHookArgument`, `SetHookReturnValue`, and `CallHookTrampoline` run inside a shared exception boundary. It rethrows captured JavaScript exceptions and translates unexpected C++ exceptions only when no JavaScript exception or execution termination is pending. Failed reads of the supplied top-level `Arguments`, `Registers`, or `CallerCleanup` trampoline options stop before invoking native code. A completed trampoline call remains recorded even if subsequent cleanup or JavaScript result construction fails, so the hook does not automatically invoke the original a second time. Calling the trampoline explicitly again still invokes it again. `SetHookArgument` accepts only an int32 Number index; fractional, out-of-int32, BigInt, and string indices are rejected instead of being coerced. Negative or unavailable indices leave the arguments unchanged. Byte snapshots use recoverable backing-store allocation where V8 supports it, but this does not make all V8 allocation failures recoverable.

For `"float"` and `"double"` hook arguments/results, setters perform JavaScript numeric conversion and preserve a thrown conversion exception. Finite values outside the native float range are rejected before narrowing or changing native state; accepted float values round to native precision. NaN, infinity, and signed zero remain valid. A failed string conversion preserves its JavaScript exception and does not store an empty replacement or change the native argument/result. Stored strings retain their UTF-8 bytes, including embedded NUL bytes, but a native C-string consumer sees only the prefix before the first NUL.

Stored hook strings belong to the manager and are released when that hook's callbacks/storage are reset, including successful hook removal or shutdown. Their native addresses borrow this storage; keep the hook alive while native code may consume it, including a callback-supplied string result. Returning a string does not transfer ownership to the native caller.

When decoding a raw x86 x87 float result, finite values outside the native float range become signed infinity without an overflowing narrowing conversion. Valid float values, signed zero, infinity, and NaN retain their usual decoding. This reader policy does not change the setters' rejection of oversized finite inputs, or validate a target address or function prototype.

Native addresses and typed 64-bit integers require BigInt in these setters. Addresses must be nonnegative and fit the selected native address width; signed/unsigned 64-bit values must fit their corresponding range. Native boolean results are decoded from the low ABI byte, ignoring unspecified upper register bits; boolean setters use JavaScript truthiness.

Hook argument reads and writes follow the selected ABI. Windows x64 uses positional register slots; Linux x64 tracks general and floating register arguments separately. On x86, `"cdecl"`/`"stdcall"` arguments use the stack and `"thiscall"` places the first argument in ECX. For `"fastcall"`, floating arguments remain on the stack rather than consuming ECX/EDX slots. GCC i386 also closes the remaining fastcall register window after a 64-bit integer argument; floating arguments do not close it. Correct hook-definition types are still required: these rules do not discover or validate the actual target prototype.

`node tools/smoke_memory_hook_argument_locations.js` compiles the actual signature and argument-location resolver for x86 and x64, with ABI-specific expectations and compiled negative controls. `--profile X86` or `--profile X64` selects one architecture. It checks classification, invalid indices, mixed floating/integer arguments, wide stack slots and register spills; it does not execute a native callee, install hooks, or run a game server. The optional `--source-file <CPP>` checks a historical source snapshot without mutation controls.

Native hook-list construction retains an ordered snapshot of registry records before creating JavaScript entries. Reentrant property setters can change the live registry without truncating or leaving holes in that in-progress list. The snapshot does not guarantee that every listed hook remains installed afterward.

`node tools/smoke_memory_hook_setters_v8.js --build-tree <configured-production-build>` checks extracted setters/readers, signature parsing, vtable resolution, record lookup, result decoding, and hook-list construction with that build's real V8 library and Detours context layouts. It uses the actual signature declaration and constructor. The fixture substitutes hook records, native-hook handles, entity lookup, the string owner, and the native argument writer; it does not install hooks or run a game server. Compiled negative controls verify that conversion, range, signature, boolean-decoding, and reentrant-inventory regressions fail at runtime. It also extracts the actual hook call-context record, constructor, private data factory, scope guard, and resolver. Real-V8 callback probes check active/expired contexts, garbage collection, reuse of the same native frame address, nested callbacks, explicit expiry, and C++ unwinding; an additional compiled mutation retains an expired address and must fail a runtime assertion. These probes do not dispatch a live native hook.

Hook object methods `Pre`, `Post`, `RemovePre`, `RemovePost`, and `Remove` use the same preserving exception boundary. For a new function address, signature-reading exceptions or execution termination stop creation before allocating or installing a hook; captured JavaScript exceptions are rethrown. Hook IDs remain positive native `int` values; exhaustion rejects new hooks instead of overflowing, while existing hooks can still be reused. Initialization remains incomplete if the required post-hook thunk cannot be created. Address and signature readers can execute JavaScript. Creation rechecks manager initialization after these reads, reuses a record registered reentrantly for the same address, and chooses a new ID only after signature processing. A nested registration that consumes the final ID prevents a second new target, but the same target remains reusable. Existing-target and already-exhausted fast paths do not read the signature.

`node tools/smoke_memory_hook_lifecycle.js` compiles the actual manager declaration, constructor, creation and lifecycle methods with V8/Detours doubles. Reader actions test reentrant same/different-address creation, final-ID exhaustion and shutdown; MSVC also injects a map-allocation failure during actual manager construction. Compiled negative controls check the registration and lifetime invariants. The fixture does not install a real Detours hook, execute JavaScript getters or run a game server; real-V8 signature conversion is covered separately above.

`CallFunction()` and trampoline invocation recheck manager initialization and pending/terminating JavaScript after all option, argument, and register reads, before native context preparation. If a reader shuts down the manager or stops JavaScript, no native call is made and no completed invocation is recorded. The source-wiring checks in `tools/smoke_memory_hook_value_contracts.js` verify each condition and its placement with mutation controls; those checks do not execute shutdown from a live JavaScript getter or establish target-address validity.

Unexpected C++ failures at native dispatch boundaries are logged rather than escaping the injected callback. Post-hook frames transfer ownership without allocating, and a failed post-return callback preserves the saved native return address. These boundaries do not catch native memory faults or undo completed native side effects.

Pre-hook dispatch also preserves its original-call decision across C++ failures during argument replay, later callbacks, or a skipped-original post snapshot. Once a callback has completed a trampoline call, that completion is committed before replaying its arguments. An accepted callback return override is committed afterward. A subsequent failure is logged and stops that dispatch without automatically invoking the original again; a failure before any completion or override retains the normal original-call fallback.

Pending JavaScript exceptions or observed V8 termination also stop pre-hook and skipped-original post dispatch. No remaining argument getters, return conversions, or later callbacks are executed after the stopped state is detected. The dispatcher preserves the exception/termination and the already-committed original-call decision; it neither catches and replaces the JavaScript error nor cancels termination. Without a completed trampoline call or accepted override, the native bridge retains its original-call fallback. No new post frame is scheduled by that stopped dispatch. A termination request may be observed only at a later V8 execution boundary; this is not cancellation of an already-running native operation.

Post-return dispatch follows the same pending-exception/observed-termination rule: it stops before constructing another payload or converting a stopped callback's result, without replacing the original JavaScript error or cancelling termination. It still stores any native return override accepted before the failure, including `Payload.SetHookReturnValue()` within the failing callback or a previous callback's result. An initially stopped isolate leaves the saved native return context unchanged.

The real-V8 setter fixture also executes the complete extracted `HandleHook()` and callback-snapshot implementations. It checks callback/getter/conversion failures, observed termination, payload invalidation, original-call decisions, and successful callback phase ordering. Runtime availability, hook records, native argument reads/writes, trampoline completion, and post-frame installation are explicit adapters; it does not install a Detours hook or execute a native trampoline. Compiled negative controls reject ignored pending exceptions, a lost completion decision, and continuation after argument replay failures.

The same fixture executes the complete extracted `RunPostCallbacks()`, `LoadReturnContext()`, and `StoreReturnContext()` with the actual post-context/frame declarations. It checks post-return callback, payload-setter and return-conversion failures; initial pending errors; observed termination; expired payload methods; preserved native overrides; and successful callback order. Compiled negative controls reject ignored pending exceptions, discarded accepted overrides, and continuation into another payload. The native hook/runtime adapters above remain in place; no live hook is installed.

The lifecycle fixture includes a reduced native failure-policy oracle using the actual dispatch commit and catch statements. Explicit adapters inject allocation failures before the callback, during argument replay, and during a post snapshot; checks cover normal fallback, completed trampoline calls, and return overrides. Compiled mutations must fail native assertions. Source-wiring guards verify the statements' placement in the complete dispatcher. This oracle does not execute that complete V8 dispatcher, install a hook, or run a game server.

On x86, the post-return thunk saves the complete x87 state before calling C++/JavaScript and restores the updated state afterward, so float/double results are available to post callbacks without narrowing an unchanged native return value through a double. The bridge calls preserve the caller frame and satisfy the platform's stack alignment; integer return registers are restored from the post context. On x64, floating results use the saved XMM0 representation instead.

`node tools/smoke_memory_hook_thunks.js` compiles and executes extracted production thunk instructions on both x86 and x64; `--profile X86` or `--profile X64` selects one architecture. It checks embedded hook IDs, bridge stack alignment, continuation stack/frame restoration, integer/float/double result edits, and release-failure diagnostics with real executable memory and assembly probes. Deliberate release failures and Linux zero-address mapping/cleanup outcomes are injected by adapters; other allocations and releases use the real OS. No synthetic address reaches an OS unmap. Zero-address cases check the cleanup attempt, unchanged failed-allocation result and size output, captured `errno`, and diagnostic fields. Compiled negative controls must fail runtime assertions. The fixture also uses explicit bridge adapters and does not install Detours hooks, execute V8 callbacks, or run a game server; the real-V8 fixture above covers a separate boundary. OS thunk-release failures, including failed cleanup of an unusable zero-address mapping, are logged; this does not roll back completed hook teardown. Release-failure checks also render the diagnostic and verify the captured OS error in the canonical zero-padded hexadecimal `Error` field on Windows and Linux; compiled controls reject a lost error code or decimal field formatting.

Hook payloads and their methods borrow the active hook frame. Use them synchronously on the game thread during that callback only; do not retain them, invoke them later from asynchronous callbacks, or call them from worker threads. The native dispatchers do not provide cross-thread JavaScript scheduling. Each invocation has distinct private V8 data whose frame address is cleared immediately after the JavaScript callback returns, with scope cleanup covering exceptional exits. Saved payload methods then return `undefined` without accessing native frame state; a later callback reusing the same stack address does not reactivate them. This guard does not extend the lifetime of payload addresses or permit asynchronous/cross-thread use.

`Payload.Type` retains the callback contract's phase tags `"pre"` and `"post"`. These string values are distinct from the numeric `HookType.Pre` and `HookType.Post` registration constants; the public property name remains `Type`.

An active dispatcher retains its hook record independently of registry changes. Each dispatched pre/post phase takes an ordered snapshot with independent callback/context handles. Removing a callback, including during plugin-context cleanup, does not cancel its place in that already-started phase; callbacks added during a phase join a later snapshot. A post phase is scheduled only if post callbacks existed at native entry. If scheduled, it takes its own snapshot when post dispatch begins, reflecting intervening registration/removal. This is synchronous reentrancy support, not thread safety or permission to retain payloads.

Complete hook removal still depends on Detours releasing the native hook; an active native wrapper can make removal return `false`, leaving ownership available for retry. `RemoveAllHooks()` also returns `false` without beginning teardown while a native post-return frame is pending or dispatching. Shutdown retains the post thunk in that case so the original return address remains usable; retry cleanup after the call has returned.

## Exports

| Export | Kind | Signature | Result |
| --- | --- | --- | --- |
| [`HookBase`](#hookbase-1) | Class | `new HookBase()` | Ordered callback collection. |
| [`HookDecorator`](#hookdecorator-1) | Class | `new HookDecorator(Callback, ClassInstance = new.target.ClassInstance)` | Decorator instance registered with the collection. |
| [`HookType`](#hooktype) | Frozen namespace | `Pre` and `Post` phase constants. | Frozen object. |
| `PRE` | Constant | Native pre-hook phase. | Same number as `HookType.Pre`. |
| `POST` | Constant | Native post-hook phase. | Same number as `HookType.Post`. |
| [`MemoryHookDecorator`](#memoryhookdecorator-1) | Class | `new MemoryHookDecorator(Hook, nHookType, Callback = null)` | Decorator instance. |
| [`PostHook`](#posthook-1) | Class | `new PostHook(Hook, Callback = null)` | Post-hook decorator instance. |
| [`PreHook`](#prehook-1) | Class | `new PreHook(Hook, Callback = null)` | Pre-hook decorator instance. |
| [`AddPostHook`](#addposthook) | Function | `AddPostHook(HookDefinition, Callback)` | `true` if the post callback was added; otherwise `false`. |
| [`AddPreHook`](#addprehook) | Function | `AddPreHook(HookDefinition, Callback)` | `true` if the pre callback was added; otherwise `false`. |
| [`CallFunction`](#callfunction) | Function | `CallFunction(Options)` | Typed return value, `null` on failure; with `ReturnContext`, `{ ReturnValue, Registers }`. |
| [`CreateFunctionHook`](#createfunctionhook) | Function | `CreateFunctionHook(HookDefinition)` | Live hook handle, or `null` on failure. |
| [`CreateVTableHook`](#createvtablehook) | Function | `CreateVTableHook(HookDefinition)` | Live hook handle, or `null` on failure. |
| `GetHookList` | Function | `GetHookList()` | Array of hook snapshot records. |
| `GetHooksDisabled` | Function | `GetHooksDisabled()` | Current disabled state. |
| [`RemoveAllHooks`](#removeallhooks) | Function | `RemoveAllHooks()` | Whether all hooks were removed. |
| [`RemoveHook`](#removehook) | Function | `RemoveHook(nHookID)` | Whether the hook was removed. |
| [`SetHooksDisabled`](#sethooksdisabled) | Function | `SetHooksDisabled(bDisabled)` | Applied disabled state. |
| [`WithHooksDisabled`](#withhooksdisabled) | Function | `WithHooksDisabled(Callback, bHooksDisabled = true)` | Callback result; restores the prior state synchronously and does not await promises. |

## Callback payload

Both phases call `Callback(Payload)` synchronously. These members also apply to callbacks registered with `Hook.Pre()`, `Hook.Post()`, or the pre/post decorator classes. The payload methods borrow the active hook frame and must not be used after the callback exits.

| Member | Phase | Contract |
| --- | --- | --- |
| `HookID` | Both | Integer ID of the hook record. |
| `Type` | Both | String phase tag: `"pre"` or `"post"`. |
| `Arguments` | Both | Array of values decoded using the hook definition. For post callbacks, changes to the array do not affect the completed call. |
| `SetHookReturnValue(Value)` | Both | Sets the native return value using the declared return type; does not return a success boolean. |
| `StackAddress` | Pre | Borrowed native entry-stack address as `bigint`. |
| `TrampolineAddress` | Pre | Address of the original-call trampoline as `bigint`. |
| `SetHookArgument(nArgumentIndex, Value)` | Pre | Sets a zero-based argument using the declared type. |
| `CallHookTrampoline(Options)` | Pre | Calls the original and returns `{ ReturnValue, Registers }` on success. |
| `ReturnValue` | Post | Current typed return value at callback entry, which can include an override from an earlier callback. Assigning the property does not change the native result; use `SetHookReturnValue(Value)` or return a replacement value. |

## Class members

### `HookBase`

| Member | Kind | Description |
| --- | --- | --- |
| `ClassName` | Getter | Current constructor name used in registration errors. |
| `length` | Live field | Number of callbacks currently stored by the inherited array. |
| `Append(Callback)` | Method | Adds one unique callback and returns it. |
| `Remove(Callback)` | Method | Removes one registered callback and returns it; throws if it is not registered. |
| `Clear()` | Method | Removes every callback from this collection. |

### `HookDecorator`

| Member | Kind | Description |
| --- | --- | --- |
| `Callback` | Live field | Callback registered with the owning `HookBase` collection. |
| `ClassInstance` | Live field | Owning callback collection. |
| `Call(...vecCallbackArguments)` | Method | Invokes the callback directly and returns its result. |
| `Dispose()` | Method | Removes and returns the callback. |

### `MemoryHookDecorator`

| Member | Kind | Description |
| --- | --- | --- |
| `Hook` | Live field | Native hook handle selected for the next registration. |
| `HookType` | Live field | `HookType.Pre` or `HookType.Post` selected for the next registration. |
| `Callback` | Live field | Successfully registered callback, or `null`. |
| [`Register(Callback)`](#memoryhookdecoratorregister) | Method | Adds the replacement before removing the old registration and returns the new callback; failure attempts rollback and can throw `AggregateError` if rollback also fails. |
| [`Dispose()`](#memoryhookdecoratordispose) | Method | Removes the exact owned registration and returns its strict native boolean result. |

### `PostHook`

`PostHook` fixes `HookType` to `HookType.Post` and inherits every `MemoryHookDecorator` field and method.

### `PreHook`

`PreHook` fixes `HookType` to `HookType.Pre` and inherits every `MemoryHookDecorator` field and method.

### Native hook handle

`CreateFunctionHook()` and `CreateVTableHook()` return the same live handle shape. Each result is built with own data properties, without invoking inherited property setters. Their `Created` field reports whether that call created a native record; existing records, including records registered reentrantly while reading the signature, report `false`. This snapshot is not an ownership lease and must not justify removal after another subsystem has acquired or subscribed to the hook. If result construction fails, a record created by that call is released; an existing record is retained. The field is not added to handles returned by the separate entity-hook creation APIs.

`GetHookList()` returns an array of snapshot records containing `ID`, `Address` and `TrampolineAddress`; those snapshot records do not include `Created` or the live handle methods below. Do not infer creation ownership from that list.

| Member | Kind | Description |
| --- | --- | --- |
| `ID` | Field | Process-local integer hook ID. |
| `Created` | Field | `true` only when this `CreateFunctionHook()` or `CreateVTableHook()` call created the native record; otherwise `false`. |
| `Address` | Field | Executable function address as `bigint`. |
| `TrampolineAddress` | Field | Detours trampoline address as `bigint`. |
| `Pre(Callback)` | Method | Registers one pre-hook callback; returns whether it was added. |
| `Post(Callback)` | Method | Registers one post-hook callback; returns whether it was added. |
| `RemovePre(Callback)` | Method | Removes one pre-hook callback and returns whether it was removed. |
| `RemovePost(Callback)` | Method | Removes one post-hook callback and returns whether it was removed. |
| `Remove()` | Method | Removes the complete hook record and returns whether it was removed. |

## Examples

The `HookBase` and `HookDecorator` examples own private collections. They attempt cleanup once and preserve both operation and cleanup errors, including thrown primitive values; failed cleanup is not silently retried. Do not clear collections owned by other subsystems.

### `HookBase`

Use `HookBase` for an ordered callback collection owned by one subsystem. `Append()` rejects duplicates and non-functions; inherited array mutation methods bypass those checks. Iteration and direct callback calls are synchronous and do not await promises.

```js
const { HookBase } = require("memory/hooks");

const g_vecCallbacks = new HookBase();
const g_vecObservedReturns = [];
const g_vecErrors = [];

function ObserveReturn(Context) {
	g_vecObservedReturns.push(Context.ReturnValue);
}

try {
	if ((g_vecCallbacks.Append(ObserveReturn) !== ObserveReturn) || (g_vecCallbacks.length !== 1)) {
		throw new Error("HookBase.Append did not register the callback");
	}

	for (const Callback of g_vecCallbacks) {
		Callback({ ReturnValue: 64 });
	}

	const strClassName = g_vecCallbacks.ClassName;
	if ((strClassName !== g_vecCallbacks.constructor.name) || (g_vecObservedReturns.length !== 1) || (g_vecObservedReturns[0] !== 64)) {
		throw new Error("HookBase iteration did not invoke the registered callback");
	}

	if ((g_vecCallbacks.Remove(ObserveReturn) !== ObserveReturn) || (g_vecCallbacks.length !== 0)) {
		throw new Error("HookBase.Remove did not return and remove the callback");
	}

	if (g_vecCallbacks.Append(ObserveReturn) !== ObserveReturn) {
		throw new Error("HookBase.Append did not return the registered callback");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_vecCallbacks.Clear() !== undefined) {
			throw new Error("HookBase.Clear did not return undefined");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	if (g_vecCallbacks.length !== 0) {
		g_vecErrors.push(new Error("HookBase.Clear did not empty the callback collection"));
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "HookBase example and cleanup failed");
}
```

### `HookDecorator`

Subclass `HookDecorator` and assign one class-level `HookBase`; each instance then registers and disposes exactly one callback. Do not change its public `Callback` or `ClassInstance` while registered: `Call()` and `Dispose()` read their current values. `Dispose()` is not idempotent; removing an absent callback throws. `Call()` propagates callback errors and returns promises without awaiting them.

```js
const { HookBase, HookDecorator } = require("memory/hooks");

class ReturnObserver extends HookDecorator {
}

ReturnObserver.ClassInstance = new HookBase();

function GetReturnValue(Context) {
	return Context.ReturnValue;
}

const g_Observer = new ReturnObserver(GetReturnValue);
const g_vecErrors = [];

try {
	if ((g_Observer.ClassInstance.length !== 1) || (g_Observer.Call({ ReturnValue: 81 }) !== 81)) {
		throw new Error("HookDecorator did not register or invoke its callback");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_Observer.Dispose() !== g_Observer.Callback) {
			throw new Error("HookDecorator.Dispose did not return its callback");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	if (g_Observer.ClassInstance.length !== 0) {
		g_vecErrors.push(new Error("HookDecorator.Dispose did not remove its callback"));
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "HookDecorator example and cleanup failed");
}
```

### `HookType`

`HookType.Pre` runs before the target function and can change arguments or call the trampoline. `HookType.Post` runs after the final return value exists. Native initialization creates own data properties without invoking inherited setters; the `memory/hooks` package then freezes the `HookType` namespace before exporting it.

```js
const { HookType, POST, PRE } = require("memory/hooks");

if (!Object.isFrozen(HookType) || (PRE === POST) || (PRE !== HookType.Pre) || (POST !== HookType.Post)) {
	throw new Error("The flat hook constants must match the distinct frozen phases.");
}
```

### `MemoryHookDecorator`

`MemoryHookDecorator` binds one callback to an existing native handle and selected phase. It captures the exact successful registration, so later edits to `Hook` or `HookType` affect only the next registration and cannot strand the current callback. `Callback` is a public mirror, not the ownership record. Disposing it leaves the hook itself installed; a native `false` result retains ownership for a retry.

Replacement adds the new callback first, then removes the previous one. If removal fails, it attempts to remove the new registration and retains ownership of the previous one. If that rollback also fails, it throws `AggregateError`; the new callback can remain registered without being owned by the decorator, so clean it up explicitly using the attempted handle, phase, and callback. This is not guaranteed atomic rollback of arbitrary native side effects.

The following three interface-hook examples require a target with no existing hook. They check the registry before creation and remove only their own hook; do not run them concurrently with another installer for that address. Callback removal and complete-hook removal are attempted independently once, and operation/cleanup errors are preserved in order. A failed removal is reported, not silently retried; retain the exact handle for an explicit retry when the native call is no longer active.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const {
	HookType,
	MemoryHookDecorator,
	CallFunction,
	CreateFunctionHook,
	GetHookList,
} = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("the current SDK does not expose a ServerGameDLL interface");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_unRegisteredAddress = GetInterfaceRecord(g_strInterfaceName).Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
const g_vecObservedNames = [];
const g_vecErrors = [];
let g_Hook = null;
let g_Decorator = null;

function ObserveInterfaceCall(Payload) {
	g_vecObservedNames.push(Payload.Arguments[0]);
}

function IsRegisteredHook(Record) {
	return Record.ID === g_Hook.ID;
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_Decorator = new MemoryHookDecorator(g_Hook, HookType.Pre);
	g_Decorator.Register(ObserveInterfaceCall);
	const unInterfaceAddress = CallFunction({ ...g_Definition, Arguments: [g_strInterfaceName, 0n] });
	if (unInterfaceAddress !== g_unRegisteredAddress) {
		throw new Error("MemoryHookDecorator changed the CreateInterface return address");
	}

	if ((g_vecObservedNames.length !== 1) || (g_vecObservedNames[0] !== g_strInterfaceName)) {
		throw new Error("MemoryHookDecorator did not observe the CreateInterface call");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Decorator !== null) && (g_Decorator.Callback !== null)) {
		try {
			if ((g_Decorator.Dispose() !== true) || (g_Decorator.Callback !== null) || !GetHookList().some(IsRegisteredHook)) {
				throw new Error("MemoryHookDecorator callback cleanup failed");
			}
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("MemoryHookDecorator hook cleanup failed");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "MemoryHookDecorator example and cleanup failed");
}
```

### `PostHook`

`PostHook` is the post-phase specialization. Its callback receives `ReturnValue` and may replace it with `SetHookReturnValue(Value)`.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { PostHook, CallFunction, CreateFunctionHook, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_unReplacementAddress = GetInterfaceRecord(g_strInterfaceName).Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unReplacementAddress !== "bigint") || (g_unReplacementAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
const g_vecOriginalAddresses = [];
const g_vecErrors = [];
let g_Hook = null;
let g_Decorator = null;

function ObservePostCall(Payload) {
	g_vecOriginalAddresses.push(Payload.ReturnValue);

	Payload.SetHookReturnValue(g_unReplacementAddress);
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_Decorator = new PostHook(g_Hook);
	g_Decorator.Register(ObservePostCall);
	const unInterfaceAddress = CallFunction({ ...g_Definition, Arguments: ["SourceJSMissingInterface999", 0n] });
	if (unInterfaceAddress !== g_unReplacementAddress) {
		throw new Error("PostHook did not replace the original return address");
	}

	if ((g_vecOriginalAddresses.length !== 1) || (g_vecOriginalAddresses[0] !== 0n)) {
		throw new Error("PostHook did not observe the original null address");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Decorator !== null) && (g_Decorator.Callback !== null)) {
		try {
			if ((g_Decorator.Dispose() !== true) || (g_Decorator.Callback !== null)) {
				throw new Error("PostHook callback cleanup failed");
			}
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("PostHook hook cleanup failed");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "PostHook example and cleanup failed");
}
```

### `PreHook`

`PreHook` is the pre-phase specialization. This example changes the requested interface name before the native function runs.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { PreHook, CallFunction, CreateFunctionHook, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_unRegisteredAddress = GetInterfaceRecord(g_strInterfaceName).Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
const g_vecOriginalNames = [];
const g_vecErrors = [];
let g_Hook = null;
let g_Decorator = null;

function RewriteInterfaceName(Payload) {
	g_vecOriginalNames.push(Payload.Arguments[0]);

	Payload.SetHookArgument(0, g_strInterfaceName);
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_Decorator = new PreHook(g_Hook);
	g_Decorator.Register(RewriteInterfaceName);
	const unInterfaceAddress = CallFunction({ ...g_Definition, Arguments: ["SourceJSMissingInterface999", 0n] });
	if (unInterfaceAddress !== g_unRegisteredAddress) {
		throw new Error("PreHook did not redirect CreateInterface to the registered interface");
	}

	if ((g_vecOriginalNames.length !== 1) || (g_vecOriginalNames[0] !== "SourceJSMissingInterface999")) {
		throw new Error("PreHook did not receive the original interface-name argument");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Decorator !== null) && (g_Decorator.Callback !== null)) {
		try {
			if ((g_Decorator.Dispose() !== true) || (g_Decorator.Callback !== null)) {
				throw new Error("PreHook callback cleanup failed");
			}
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("PreHook hook cleanup failed");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "PreHook example and cleanup failed");
}
```

### `CallFunction`

`CallFunction(Options)` invokes a native address with explicit ABI values. Set `ReturnContext: true` to receive the post-call register/FPU/SIMD context together with `ReturnValue` and `Registers`.

Raw addresses require nonnegative BigInt values that fit the native address width. Typed signed/unsigned 64-bit arguments and return replacements also require lossless BigInt values. Other integer arguments, integer return replacements, and register overrides accept integral Numbers from signed int32 minimum through unsigned uint32 maximum, or BigInt values that fit a signed or unsigned native machine word. Negative values preserve their native two's-complement bit pattern. Wider Number values, fractions, non-finite values, and out-of-width BigInt values throw before the converted word is committed; use BigInt for wider words rather than relying on Number rounding or x86 truncation. Individual ABI types may impose narrower ranges.

`Convention` defaults to `"cdecl"`; after case/underscore normalization, only `"cdecl"`, `"stdcall"`, `"thiscall"`, and `"fastcall"` are accepted. Omitted `Arguments` means no explicit arguments; a supplied value must be an array. `ThisObject`, when supplied, is prepended as a native-address argument. A typed argument uses `{ Type, Value }`; `"void"` is not a valid argument type. Smaller integer arguments are native-word bit patterns, not an additional checked conversion to each narrower C++ type: the caller must ensure that they fit the actual function signature.

Typed `"float"` and `"double"` arguments use JavaScript numeric conversion while preserving conversion exceptions. Finite float values exceeding the native float range are rejected before narrowing; representable values round to native precision. Native IEEE NaN and infinity values remain valid floating arguments. Use explicit typed arguments for floating and 64-bit values; a plain Number is not an implicit floating argument.

Argument placement follows the selected native ABI: Windows x64 uses the first four positional GPR/XMM slots and register-home space; Linux x64 uses independent six-integer/eight-SIMD register budgets before stack spill. Windows x64 floating register arguments are mirrored into the corresponding GPRs, and Linux x64 sets `AL` for variadic calls. On x86, floating and 64-bit arguments remain whole on the stack; `thiscall` uses the first integer-class argument in `ECX`, and `fastcall` uses eligible integer arguments in `ECX`/`EDX`. GCC i386 closes the remaining fastcall register window at a 64-bit integer argument, unlike MSVC. Calling-convention names do not select a foreign platform ABI on x64.

Stack arguments must fit the range Detours actually mirrors, not merely the allocated source page. With the current dependency defaults, that range is 1024 bytes including the return-address slot and any ABI register-home space; register arguments do not consume additional copied-stack slots. An oversized call returns `null` before stack argument writes or native invocation. This bound does not validate an arbitrary target's own stack requirements or memory accesses.

For variadic targets, the caller must supply the promoted native types explicitly, including `"double"` rather than `"float"`; SourceJS does not infer the target prototype or perform C/C++ default argument promotions. Register overrides apply after ABI argument preparation; overriding Linux x64 `RAX` also replaces the variadic `AL` count. An incorrect signature, promotion, override, or calling convention can corrupt memory or crash the server even when every JavaScript input passes validation.

Register names use their canonical uppercase acronyms, such as `EAX`, `RAX`, `ST0`, and `XMM0`. Input names are not case-normalized. Returned general-purpose registers and `EFLAGS`/`RFLAGS` are unsigned BigInts on both x86 and x86_64, including the stack address in `ESP`/`RSP`. FPU control/status/tag words and `MXCSR` remain Numbers; `ST0` through `ST7`, the available `XMM` registers, and `FXState` are byte snapshots. Returned `ESP`/`RSP` values are numeric snapshots, not ownership handles. The returned object does not keep the native call's temporary stack storage alive; do not dereference those saved stack addresses after the call returns.

Input `Registers` overrides support only the selected architecture's general-purpose registers, excluding `ESP`/`RSP`, which belong to the call's owned stack. Unsupported names, flags, FPU/SIMD snapshots, and stack-register entries are ignored without reading their values or invoking their getters. Passing an entire returned register snapshot therefore does not restore the full CPU context. Supported entries accept a machine word directly or through a `Value` property; failed getters or invalid words stop before native invocation.

Failed conversion of `Convention`, `ReturnType`, typed argument `Type`, floating arguments, string arguments, or register keys stops the call before native invocation. Captured JavaScript exceptions are rethrown, and execution termination is preserved; a failed UTF-8 conversion is not silently treated as an empty string. Strings are kept alive until the native call returns. They are null-terminated native arguments, so embedded NUL bytes terminate the string seen by the callee.

`FXState` is a synthesized 512-byte FXSAVE-shaped snapshot, not a complete raw CPU save image. It contains the native context's legacy x87 metadata (including 32-bit instruction/data address fields), abridged occupancy tag, ten-byte ST values in sixteen-byte slots, `MXCSR`, and the documented XMM registers; other bytes are zero. `FPUTagWord` exposes that abridged occupancy tag, not the original sixteen-bit classification word. The snapshot omits `MXCSR_MASK` and upper YMM/ZMM state and must not be treated as a complete restorable CPU context.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { ADDRESS_SIZE } = require("memory/helpers");
const { CallFunction } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_unRegisteredAddress = GetInterfaceRecord(g_strInterfaceName).Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Invocation = CallFunction({
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: [g_strInterfaceName, 0n],
	ReturnContext: true,
});
if ((g_Invocation === null) || (typeof g_Invocation !== "object")) {
	throw new Error("CallFunction could not return the native call context.");
}

if ((g_Invocation.Registers === null) || (typeof g_Invocation.Registers !== "object")) {
	throw new Error("CallFunction did not return the register context.");
}

const g_strStackRegisterName = (ADDRESS_SIZE === 8) ? "RSP" : "ESP";
const g_unStackAddress = g_Invocation.Registers[g_strStackRegisterName];
if (g_Invocation.ReturnValue !== g_unRegisteredAddress) {
	throw new Error("CallFunction returned the wrong ServerGameDLL address.");
}

if ((typeof g_unStackAddress !== "bigint") || (g_unStackAddress <= 0n)) {
	throw new Error(`CallFunction did not return the ${g_strStackRegisterName} register.`);
}
```

### `CreateFunctionHook`

`CreateFunctionHook(HookDefinition)` installs or reuses a hook for one executable address and returns its live handle, or `null` if creation fails. Reuse adds the current context as an owner but keeps the existing signature; it does not reread or replace that signature. The pre callback below calls the real Detours trampoline once and forwards only its return value.

These standalone installation examples remove the complete hook during cleanup, including every registered callback and ownership share. They require an unhooked target and check its registry before installation; this synchronous check is not an atomic reservation. Do not interleave another installer for that address. For a shared handle, remove only your own callback and coordinate complete teardown with its other owners. Cleanup attempts each owned callback, hook, and allocation independently once and preserves all operation/cleanup errors; a failed operation is reported rather than silently retried.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { ADDRESS_SIZE } = require("memory/helpers");
const { CallFunction, CreateFunctionHook, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_unRegisteredAddress = GetInterfaceRecord(g_strInterfaceName).Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
let g_Hook = null;
const g_vecErrors = [];
const g_strStackRegisterName = (ADDRESS_SIZE === 8) ? "RSP" : "ESP";
let g_TrampolineContext = null;
let g_bCallbackRegistered = false;

function CallOriginal(Payload) {
	g_TrampolineContext = Payload.CallHookTrampoline({ Arguments: Payload.Arguments, Registers: Payload.Registers });
	if ((g_TrampolineContext === undefined) || (g_TrampolineContext === null)) {
		throw new Error("CallHookTrampoline did not return an execution context.");
	}

	return g_TrampolineContext.ReturnValue;
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	if (!Number.isSafeInteger(g_Hook.ID) || (g_Hook.ID <= 0) || (g_Hook.Address !== g_unCreateInterfaceAddress)) {
		throw new Error("CreateFunctionHook returned an invalid hook identity.");
	}

	if ((typeof g_Hook.TrampolineAddress !== "bigint") || (g_Hook.TrampolineAddress <= 0n) || (g_Hook.TrampolineAddress === g_unCreateInterfaceAddress)) {
		throw new Error("CreateFunctionHook returned an invalid trampoline address.");
	}

	if (g_Hook.Pre(CallOriginal) !== true) {
		throw new Error("CreateFunctionHook could not register the pre-hook callback.");
	}

	g_bCallbackRegistered = true;

	const unInterfaceAddress = CallFunction({ ...g_Definition, Arguments: [g_strInterfaceName, 0n] });
	if ((g_TrampolineContext === null) || (typeof g_TrampolineContext !== "object")) {
		throw new Error("CallHookTrampoline did not return an execution context");
	}

	if ((g_TrampolineContext.Registers === null) || (typeof g_TrampolineContext.Registers !== "object")) {
		throw new Error("CallHookTrampoline did not return the register context");
	}

	const unStackAddress = g_TrampolineContext.Registers[g_strStackRegisterName];
	if ((unInterfaceAddress !== g_unRegisteredAddress) || (g_TrampolineContext.ReturnValue !== g_unRegisteredAddress)) {
		throw new Error("CallHookTrampoline did not return the original ServerGameDLL address");
	}

	if ((typeof unStackAddress !== "bigint") || (unStackAddress <= 0n)) {
		throw new Error(`CallHookTrampoline did not return the ${g_strStackRegisterName} register.`);
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Hook !== null) && g_bCallbackRegistered) {
		try {
			if (g_Hook.RemovePre(CallOriginal) !== true) {
				throw new Error("CreateFunctionHook callback cleanup failed.");
			}

			g_bCallbackRegistered = false;
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("CreateFunctionHook hook cleanup failed.");
			}

			g_Hook = null;
			g_bCallbackRegistered = false;
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "CreateFunctionHook example and cleanup failed.");
}
```

### `CreateVTableHook`

`CreateVTableHook(HookDefinition)` resolves the target from a real object vtable. This self-contained example builds a plugin-owned one-slot object whose slot points to `CreateInterface`, so no game-specific vtable index is guessed. Its object/vtable storage is used only for synchronous target resolution; the installed hook targets the resolved executable function, not this allocation. The allocation can therefore be released even if removing that hook fails. Do not infer the same lifetime for a real game object or another API.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { Allocate, Deallocate } = require("memory");
const { ADDRESS_SIZE, Add, WriteAddress } = require("memory/helpers");
const { CallFunction, CreateVTableHook, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unFunctionAddress = GetBinarySymbol("server", "CreateInterface");
const g_unRegisteredAddress = GetInterfaceRecord(g_strInterfaceName).Address;

if ((typeof g_unFunctionAddress !== "bigint") || (g_unFunctionAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

let g_unStorageAddress = 0n;
let g_Hook = null;
const g_vecErrors = [];
let g_strObservedName = null;
let g_bCallbackRegistered = false;

function ObserveCall(Payload) {
	g_strObservedName = Payload.Arguments[0];
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unFunctionAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	const unAllocatedAddress = Allocate(ADDRESS_SIZE * 2);
	if ((typeof unAllocatedAddress !== "bigint") || (unAllocatedAddress <= 0n)) {
		throw new Error("CreateVTableHook object allocation failed.");
	}

	g_unStorageAddress = unAllocatedAddress;
	const unObjectAddress = g_unStorageAddress;
	const unVTableAddress = Add(g_unStorageAddress, BigInt(ADDRESS_SIZE));
	if ((WriteAddress(unVTableAddress, g_unFunctionAddress) !== true) || (WriteAddress(unObjectAddress, unVTableAddress) !== true)) {
		throw new Error("CreateVTableHook object layout setup failed.");
	}

	const Definition = {
		ObjectAddress: unObjectAddress,
		Index: 0,
		Convention: "cdecl",
		ReturnType: "address",
		Arguments: ["string", "address"],
	};
	g_Hook = CreateVTableHook(Definition);
	if (g_Hook === null) {
		throw new Error("CreateVTableHook could not create the vtable hook.");
	}

	if (!Number.isSafeInteger(g_Hook.ID) || (g_Hook.ID <= 0) || (g_Hook.Address !== g_unFunctionAddress)) {
		throw new Error("CreateVTableHook returned an invalid hook identity");
	}

	if ((typeof g_Hook.TrampolineAddress !== "bigint") || (g_Hook.TrampolineAddress <= 0n)) {
		throw new Error("CreateVTableHook returned an invalid trampoline address");
	}

	if (g_Hook.Pre(ObserveCall) !== true) {
		throw new Error("CreateVTableHook could not register the pre-hook callback");
	}

	g_bCallbackRegistered = true;

	const unInterfaceAddress = CallFunction({ Address: g_unFunctionAddress, Convention: "cdecl", ReturnType: "address", Arguments: [g_strInterfaceName, 0n] });
	if ((unInterfaceAddress !== g_unRegisteredAddress) || (g_strObservedName !== g_strInterfaceName)) {
		throw new Error("CreateVTableHook did not observe the CreateInterface call");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Hook !== null) && g_bCallbackRegistered) {
		try {
			if (g_Hook.RemovePre(ObserveCall) !== true) {
				throw new Error("CreateVTableHook callback cleanup failed.");
			}

			g_bCallbackRegistered = false;
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("CreateVTableHook hook cleanup failed.");
			}

			g_Hook = null;
			g_bCallbackRegistered = false;
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}

	if (g_unStorageAddress !== 0n) {
		try {
			if (Deallocate(g_unStorageAddress) !== true) {
				throw new Error("CreateVTableHook storage cleanup failed.");
			}

			g_unStorageAddress = 0n;
		} catch (StorageCleanupError) {
			g_vecErrors.push(StorageCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "CreateVTableHook example and cleanup failed.");
}
```

### `AddPreHook`

`AddPreHook(HookDefinition, Callback)` creates or reuses the function hook, registers the callback in the `pre` phase, and returns whether registration succeeded. Creation precedes registration; a failed registration does not automatically remove a successfully created hook. Keep a handle from `CreateFunctionHook()` for explicit cleanup, and apply the shared-ownership precautions above. To inspect the result instead, use [`AddPostHook`](#addposthook).

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { ADDRESS_SIZE } = require("memory/helpers");
const { AddPreHook, CallFunction, CreateFunctionHook, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_unRegisteredAddress = GetInterfaceRecord(g_strInterfaceName).Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
let g_Hook = null;
const g_vecErrors = [];
const g_strCustomRegisterName = (ADDRESS_SIZE === 8) ? "RBX" : "EBX";
const g_strObservedRegisterName = (ADDRESS_SIZE === 8) ? "RDX" : "EDX";
const g_unCustomRegisterValue = 0x1234n;
let g_TrampolineContext = null;
let g_bCallbackRegistered = false;

function CallReplacement(Payload) {
	g_TrampolineContext = Payload.CallHookTrampoline({
		Arguments: [g_strInterfaceName, 0n],
		Registers: {
			...Payload.Registers,
			[g_strCustomRegisterName]: g_unCustomRegisterValue,
		},
	});
	if ((g_TrampolineContext === null) || (typeof g_TrampolineContext !== "object")) {
		throw new Error("CallHookTrampoline did not return an execution context.");
	}

	return g_TrampolineContext.ReturnValue;
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	if (AddPreHook(g_Definition, CallReplacement) !== true) {
		throw new Error("AddPreHook could not register the callback.");
	}

	g_bCallbackRegistered = true;

	const unInterfaceAddress = CallFunction({ ...g_Definition, Arguments: ["SourceJSMissingInterface999", 0n] });
	if ((g_TrampolineContext === null) || (typeof g_TrampolineContext !== "object")) {
		throw new Error("AddPreHook callback did not return the trampoline context.");
	}

	if ((g_TrampolineContext.Registers === null) || (typeof g_TrampolineContext.Registers !== "object")) {
		throw new Error("AddPreHook callback did not return the trampoline register context.");
	}

	if ((unInterfaceAddress !== g_unRegisteredAddress) || (g_TrampolineContext.ReturnValue !== g_unRegisteredAddress)) {
		throw new Error("AddPreHook did not forward the trampoline return value.");
	}

	if (g_TrampolineContext.Registers[g_strCustomRegisterName] !== g_unCustomRegisterValue) {
		throw new Error(`AddPreHook did not preserve the custom ${g_strCustomRegisterName} value.`);
	}

	if (typeof g_TrampolineContext.Registers[g_strObservedRegisterName] !== "bigint") {
		throw new Error(`AddPreHook did not return the post-trampoline ${g_strObservedRegisterName} value.`);
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Hook !== null) && g_bCallbackRegistered) {
		try {
			if (g_Hook.RemovePre(CallReplacement) !== true) {
				throw new Error("AddPreHook callback cleanup failed.");
			}

			g_bCallbackRegistered = false;
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("AddPreHook hook cleanup failed.");
			}

			g_Hook = null;
			g_bCallbackRegistered = false;
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "AddPreHook example and cleanup failed.");
}
```

### `RemoveHook`

`RemoveHook(nHookID)` removes one process-local hook record by its positive integer ID and returns whether removal succeeded. An existing record can remain installed when native release fails; `false` does not mean that the record was absent. Successful removal clears all of that hook's callbacks and ownership shares; existing handle objects do not become reusable.

The removal examples make one removal attempt for their owned record and do not silently retry a failed explicit removal. The exact handle remains available for diagnosis or a deliberate retry after native activity has ended. Independent cleanup/state-restoration failures are preserved alongside the operation error, including thrown primitive values.

```js
const { CreateFunctionHook, GetHookList, RemoveHook } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

let g_Hook = null;
const g_vecErrors = [];
let g_nHookID = 0;
let g_bRemovalAttempted = false;

function IsInstalledHook(Record) {
	return Record.ID === g_nHookID;
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook({
		Address: g_unCreateInterfaceAddress,
		Convention: "cdecl",
		ReturnType: "address",
		Arguments: ["string", "address"],
	});
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_nHookID = g_Hook.ID;
	if (!Number.isSafeInteger(g_nHookID) || (g_nHookID <= 0)) {
		throw new Error("CreateFunctionHook returned an invalid hook ID.");
	}

	g_bRemovalAttempted = true;
	if (RemoveHook(g_nHookID) !== true) {
		throw new Error("RemoveHook did not remove the installed hook.");
	}

	if (GetHookList().some(IsInstalledHook)) {
		throw new Error("RemoveHook left the hook in the installed-hook list.");
	}

	if ((RemoveHook(g_nHookID) !== false) || (g_Hook.Remove() !== false)) {
		throw new Error("RemoveHook did not invalidate repeated removal attempts.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Hook !== null) && !g_bRemovalAttempted) {
		try {
			g_bRemovalAttempted = true;
			if (g_Hook.Remove() !== true) {
				throw new Error("RemoveHook owned-hook cleanup failed.");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "RemoveHook example and cleanup failed.");
}
```

### `RemoveAllHooks`

`RemoveAllHooks()` attempts to remove every SourceJS memory hook in the process and returns whether all removals succeeded. A pending post-return frame rejects teardown before removals; otherwise a later native release failure can leave partial progress, with already removed hooks still removed. It is an administrative operation, not ordinary per-plugin cleanup; coordinate teardown with every owner.

The example initially refuses a non-empty registry and checks for its sole expected record before teardown. These checks are not an ownership reservation or lock: do not allow unrelated or reentrant hook registration during the example.

```js
const { CreateFunctionHook, GetHookList, RemoveAllHooks } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

if (GetHookList().length !== 0) {
	throw new Error("RemoveAllHooks example refuses to remove hooks owned by other subsystems.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

let g_Hook = null;
const g_vecErrors = [];
let g_bRemovalAttempted = false;

try {
	g_Hook = CreateFunctionHook({
		Address: g_unCreateInterfaceAddress,
		Convention: "cdecl",
		ReturnType: "address",
		Arguments: ["string", "address"],
	});
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	const vecInstalledRecords = GetHookList();
	if ((vecInstalledRecords.length !== 1) || (vecInstalledRecords[0].ID !== g_Hook.ID)) {
		throw new Error("RemoveAllHooks example did not own the complete hook registry.");
	}

	g_bRemovalAttempted = true;
	if (RemoveAllHooks() !== true) {
		throw new Error("RemoveAllHooks could not remove every hook.");
	}

	if ((GetHookList().length !== 0) || (g_Hook.Remove() !== false)) {
		throw new Error("RemoveAllHooks left an installed or reusable hook handle.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Hook !== null) && !g_bRemovalAttempted) {
		try {
			g_bRemovalAttempted = true;
			if (g_Hook.Remove() !== true) {
				throw new Error("RemoveAllHooks owned-hook cleanup failed.");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "RemoveAllHooks example and cleanup failed.");
}
```

### `SetHooksDisabled`

`SetHooksDisabled(bDisabled)` changes the process-wide callback-dispatch state and returns the exact boolean state. Hooks remain installed and native targets still run. Always restore the previous state.

```js
const { GetHooksDisabled, SetHooksDisabled } = require("memory/hooks");

const g_bPreviousDisabled = GetHooksDisabled();
if (typeof g_bPreviousDisabled !== "boolean") {
	throw new TypeError("GetHooksDisabled did not return a boolean state.");
}

const g_bRequestedDisabled = !g_bPreviousDisabled;
const g_vecErrors = [];

try {
	if ((SetHooksDisabled(g_bRequestedDisabled) !== g_bRequestedDisabled) || (GetHooksDisabled() !== g_bRequestedDisabled)) {
		throw new Error("SetHooksDisabled did not apply the requested callback-dispatch state.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (SetHooksDisabled(g_bPreviousDisabled) !== g_bPreviousDisabled) {
			throw new Error("The previous callback-dispatch state could not be restored.");
		}
	} catch (StateApplicationError) {
		g_vecErrors.push(StateApplicationError);
	}

	try {
		if (GetHooksDisabled() !== g_bPreviousDisabled) {
			throw new Error("The previous callback-dispatch state was not observed after cleanup.");
		}
	} catch (StateVerificationError) {
		g_vecErrors.push(StateVerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "SetHooksDisabled example and cleanup failed.");
}
```

### `WithHooksDisabled`

`WithHooksDisabled(Callback, bHooksDisabled = true)` applies one exact boolean state for a synchronous callback and attempts to restore the prior state even when the callback throws. Native state results must be strict booleans matching the requested value. Callback or restoration errors propagate; if both fail, it throws an `AggregateError` containing both failures. A returned promise is not awaited: restoration runs when the callback returns, not when its asynchronous work finishes. The example proves that native calls continue while hook callbacks are suppressed.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { CallFunction, CreateFunctionHook, GetHooksDisabled, SetHooksDisabled, WithHooksDisabled, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_unRegisteredAddress = GetInterfaceRecord(g_strInterfaceName).Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
const g_bPreviousDisabled = GetHooksDisabled();
if (typeof g_bPreviousDisabled !== "boolean") {
	throw new TypeError("GetHooksDisabled did not return a boolean state.");
}

let g_bStateChangeAttempted = false;
let g_Hook = null;
const g_vecErrors = [];
const g_vecObservedNames = [];
let g_bCallbackRegistered = false;

function ObserveName(Payload) {
	g_vecObservedNames.push(Payload.Arguments[0]);
}

function CallWhileDisabled() {
	if (GetHooksDisabled() !== true) {
		throw new Error("WithHooksDisabled did not apply the requested state");
	}

	return CallFunction({ ...g_Definition, Arguments: [g_strInterfaceName, 0n] });
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_bStateChangeAttempted = true;
	if (SetHooksDisabled(false) !== false) {
		throw new Error("WithHooksDisabled could not establish an enabled baseline");
	}

	if (g_Hook.Pre(ObserveName) !== true) {
		throw new Error("WithHooksDisabled could not register the pre-hook callback");
	}

	g_bCallbackRegistered = true;

	const unSuppressedAddress = WithHooksDisabled(CallWhileDisabled);
	const unObservedAddress = CallFunction({ ...g_Definition, Arguments: [g_strInterfaceName, 0n] });
	if ((unSuppressedAddress !== g_unRegisteredAddress) || (unObservedAddress !== g_unRegisteredAddress)) {
		throw new Error("WithHooksDisabled prevented the native target from running");
	}

	if ((GetHooksDisabled() !== false) || (g_vecObservedNames.length !== 1) || (g_vecObservedNames[0] !== g_strInterfaceName)) {
		throw new Error("WithHooksDisabled did not suppress and restore callback dispatch");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Hook !== null) && g_bCallbackRegistered) {
		try {
			if (g_Hook.RemovePre(ObserveName) !== true) {
				throw new Error("WithHooksDisabled callback cleanup failed.");
			}
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("WithHooksDisabled hook cleanup failed.");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}

	if (g_bStateChangeAttempted) {
		try {
			if (SetHooksDisabled(g_bPreviousDisabled) !== g_bPreviousDisabled) {
				throw new Error("The previous callback-dispatch state could not be restored.");
			}
		} catch (StateApplicationError) {
			g_vecErrors.push(StateApplicationError);
		}

		try {
			if (GetHooksDisabled() !== g_bPreviousDisabled) {
				throw new Error("The previous callback-dispatch state was not observed after cleanup.");
			}
		} catch (StateVerificationError) {
			g_vecErrors.push(StateVerificationError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "WithHooksDisabled example and cleanup failed.");
}
```

### `MemoryHookDecorator.Dispose`

`Dispose()` unregisters the decorator's exact captured callback without removing the native hook. A native `false` result leaves ownership intact for retry; after success, a second call returns `false` because no callback remains.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { CallFunction, CreateFunctionHook, HookType, MemoryHookDecorator, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if ((g_InterfaceRecord === null) || (typeof g_InterfaceRecord !== "object")) {
	throw new Error(`The ${g_strInterfaceName} interface record is unavailable.`);
}

const g_unRegisteredAddress = g_InterfaceRecord.Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
let g_Hook = null;
const g_vecErrors = [];
let g_Decorator = null;
let g_bCallbackRemovalAttempted = false;
const g_vecObservedNames = [];

function ObserveDecoratorCall(Payload) {
	g_vecObservedNames.push(Payload.Arguments[0]);
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_Decorator = new MemoryHookDecorator(g_Hook, HookType.Pre);
	g_Decorator.Register(ObserveDecoratorCall);
	const unFirstAddress = CallFunction({ ...g_Definition, Arguments: [g_strInterfaceName, 0n] });

	g_bCallbackRemovalAttempted = true;
	if ((g_Decorator.Dispose() !== true) || (g_Decorator.Callback !== null)) {
		throw new Error("MemoryHookDecorator.Dispose did not remove its callback.");
	}

	const unSecondAddress = CallFunction({ ...g_Definition, Arguments: ["SourceJSMissingInterface999", 0n] });
	if ((unFirstAddress !== g_unRegisteredAddress) || (unSecondAddress !== 0n)) {
		throw new Error("MemoryHookDecorator.Dispose example returned unexpected interface addresses.");
	}

	if ((g_vecObservedNames.length !== 1) || (g_vecObservedNames[0] !== g_strInterfaceName) || (g_Decorator.Dispose() !== false)) {
		throw new Error("MemoryHookDecorator.Dispose retained or removed the callback twice.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Decorator !== null) && !g_bCallbackRemovalAttempted && (g_Decorator.Callback !== null)) {
		try {
			g_bCallbackRemovalAttempted = true;
			if ((g_Decorator.Dispose() !== true) || (g_Decorator.Callback !== null)) {
				throw new Error("MemoryHookDecorator.Dispose callback cleanup failed.");
			}
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("MemoryHookDecorator.Dispose hook cleanup failed.");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "MemoryHookDecorator.Dispose example and cleanup failed.");
}
```

### `MemoryHookDecorator.Register`

`Register(Callback)` installs the callback and returns it. A replacement is registered before the previous callback is removed; if previous removal fails, rollback is attempted and the original ownership remains available for retry. Rollback can also fail, producing `AggregateError` and leaving the replacement registered; see the replacement failure and explicit cleanup conditions above.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { CallFunction, CreateFunctionHook, HookType, MemoryHookDecorator, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if ((g_InterfaceRecord === null) || (typeof g_InterfaceRecord !== "object")) {
	throw new Error(`The ${g_strInterfaceName} interface record is unavailable.`);
}

const g_unRegisteredAddress = g_InterfaceRecord.Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
let g_Hook = null;
const g_vecErrors = [];
let g_Decorator = null;
const g_vecObservedCallbacks = [];

function ObserveFirst() {
	g_vecObservedCallbacks.push("first");
}

function ObserveSecond() {
	g_vecObservedCallbacks.push("second");
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_Decorator = new MemoryHookDecorator(g_Hook, HookType.Pre);
	if ((g_Decorator.Register(ObserveFirst) !== ObserveFirst) || (g_Decorator.Callback !== ObserveFirst)) {
		throw new Error("MemoryHookDecorator.Register did not install the first callback.");
	}

	const unMissingAddress = CallFunction({ ...g_Definition, Arguments: ["SourceJSMissingInterface999", 0n] });
	const CurrentCallback = g_Decorator.Register(ObserveSecond);
	const unInterfaceAddress = CallFunction({ ...g_Definition, Arguments: [g_strInterfaceName, 0n] });

	if ((CurrentCallback !== ObserveSecond) || (g_Decorator.Callback !== ObserveSecond)) {
		throw new Error("MemoryHookDecorator.Register did not replace the owned callback.");
	}

	if ((unMissingAddress !== 0n) || (unInterfaceAddress !== g_unRegisteredAddress)) {
		throw new Error("MemoryHookDecorator.Register example returned unexpected interface addresses.");
	}

	if ((g_vecObservedCallbacks.length !== 2) || (g_vecObservedCallbacks[0] !== "first") || (g_vecObservedCallbacks[1] !== "second")) {
		throw new Error("MemoryHookDecorator.Register did not replace callback dispatch.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Decorator !== null) && (g_Decorator.Callback !== null)) {
		try {
			if ((g_Decorator.Dispose() !== true) || (g_Decorator.Callback !== null)) {
				throw new Error("MemoryHookDecorator.Register callback cleanup failed.");
			}
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("MemoryHookDecorator.Register hook cleanup failed.");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "MemoryHookDecorator.Register example and cleanup failed.");
}
```

### `PostHook.Register`

`PostHook.Register(Callback)` registers or replaces the current post callback. Use `Payload.SetHookReturnValue(Value)` when the hook intentionally overrides the native result.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { CallFunction, CreateFunctionHook, PostHook, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if ((g_InterfaceRecord === null) || (typeof g_InterfaceRecord !== "object")) {
	throw new Error(`The ${g_strInterfaceName} interface record is unavailable.`);
}

const g_unRegisteredAddress = g_InterfaceRecord.Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
let g_Hook = null;
const g_vecErrors = [];
let g_Decorator = null;
let g_unOriginalAddress = 0n;

function OverrideReturn(Payload) {
	g_unOriginalAddress = Payload.ReturnValue;

	Payload.SetHookReturnValue(0n);
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_Decorator = new PostHook(g_Hook);
	if ((g_Decorator.Register(OverrideReturn) !== OverrideReturn) || (g_Decorator.Callback !== OverrideReturn)) {
		throw new Error("PostHook.Register did not own the supplied callback.");
	}

	const unInterfaceAddress = CallFunction({ ...g_Definition, Arguments: [g_strInterfaceName, 0n] });
	if ((g_unOriginalAddress !== g_unRegisteredAddress) || (unInterfaceAddress !== 0n)) {
		throw new Error("PostHook.Register did not expose and replace the native return address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Decorator !== null) && (g_Decorator.Callback !== null)) {
		try {
			if ((g_Decorator.Dispose() !== true) || (g_Decorator.Callback !== null)) {
				throw new Error("PostHook.Register callback cleanup failed.");
			}
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("PostHook.Register hook cleanup failed.");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "PostHook.Register example and cleanup failed.");
}
```

### `PreHook.Register`

`PreHook.Register(Callback)` registers or replaces the current pre callback. This callback changes one live argument before the original function is called.

```js
const { GetInterfaceRecord, GetAllInterfaceNames } = require("interfaces");
const { CallFunction, CreateFunctionHook, PreHook, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

function IsServerGameDLLInterface(strInterfaceName) {
	return strInterfaceName.startsWith("ServerGameDLL");
}

const g_strInterfaceName = GetAllInterfaceNames().find(IsServerGameDLLInterface);
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if ((g_InterfaceRecord === null) || (typeof g_InterfaceRecord !== "object")) {
	throw new Error(`The ${g_strInterfaceName} interface record is unavailable.`);
}

const g_unRegisteredAddress = g_InterfaceRecord.Address;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary");
}

if ((typeof g_unRegisteredAddress !== "bigint") || (g_unRegisteredAddress <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry address is invalid.`);
}

const g_Definition = {
	Address: g_unCreateInterfaceAddress,
	Convention: "cdecl",
	ReturnType: "address",
	Arguments: ["string", "address"],
};
let g_Hook = null;
const g_vecErrors = [];
let g_Decorator = null;
let g_strOriginalName = null;

function ReplaceArgument(Payload) {
	g_strOriginalName = Payload.Arguments[0];

	Payload.SetHookArgument(0, g_strInterfaceName);
}

function IsInterfaceTargetHook(Record) {
	return Record.Address === g_unCreateInterfaceAddress;
}

try {
	if (GetHookList().some(IsInterfaceTargetHook)) {
		throw new Error("The interface-hook example requires an unhooked target.");
	}

	g_Hook = CreateFunctionHook(g_Definition);
	if (g_Hook === null) {
		throw new Error("CreateFunctionHook could not create the interface hook.");
	}

	g_Decorator = new PreHook(g_Hook);
	if ((g_Decorator.Register(ReplaceArgument) !== ReplaceArgument) || (g_Decorator.Callback !== ReplaceArgument)) {
		throw new Error("PreHook.Register did not own the supplied callback.");
	}

	const unInterfaceAddress = CallFunction({ ...g_Definition, Arguments: ["SourceJSMissingInterface999", 0n] });
	if ((g_strOriginalName !== "SourceJSMissingInterface999") || (unInterfaceAddress !== g_unRegisteredAddress)) {
		throw new Error("PreHook.Register did not expose and replace the live argument.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if ((g_Decorator !== null) && (g_Decorator.Callback !== null)) {
		try {
			if ((g_Decorator.Dispose() !== true) || (g_Decorator.Callback !== null)) {
				throw new Error("PreHook.Register callback cleanup failed.");
			}
		} catch (CallbackCleanupError) {
			g_vecErrors.push(CallbackCleanupError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (g_Hook.Remove() !== true) {
				throw new Error("PreHook.Register hook cleanup failed.");
			}
		} catch (HookCleanupError) {
			g_vecErrors.push(HookCleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "PreHook.Register example and cleanup failed.");
}
```

### `AddPostHook`

`AddPostHook(HookDefinition, Callback)` takes the same function definition as `CreateFunctionHook()`. It creates or reuses the hook for that address and registers `Callback(Payload)` for the `post` phase. It returns a boolean, not a hook handle. An invalid definition or callback can throw; a failed registration does not undo hook creation.

Use a post callback to observe the outcome without invoking the original again. It runs after the native call returns, or after the pre phase has supplied the result instead. Read `Payload.ReturnValue`; leave the callback result `undefined` or `null` to preserve the native value unless you already changed it with `Payload.SetHookReturnValue(Value)`. The post payload has no `CallHookTrampoline()` or `SetHookArgument()` methods. See [Callback payload](#callback-payload).

To remove only your registration, keep the function handle and call `Hook.RemovePost(Callback)` with the same function object. Remove the entire hook only if you own the record and no other subsystem uses it. If you already have a live handle and do not need address-based creation or reuse, use `Hook.Post(Callback)` directly.

This example observes the result of querying a deliberately nonexistent interface. Use it only with an unshared target in a test server.

```js
const { AddPostHook, CallFunction, CreateFunctionHook, GetHookList } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

const g_Definition = { Address: GetBinarySymbol("server", "CreateInterface"), Convention: "cdecl", ReturnType: "address", Arguments: ["string", "address"] };
const g_strInterfaceName = "SourceJSMissingInterface999";
const g_vecObservedResults = [];
const g_vecErrors = [];

function ObserveResult(Payload) {
	if (Payload.Arguments[0] === g_strInterfaceName) {
		g_vecObservedResults.push(Payload.ReturnValue);
	}
}

if ((typeof g_Definition.Address !== "bigint") || (g_Definition.Address <= 0n) || GetHookList().some((Record) => Record.Address === g_Definition.Address)) {
	throw new Error("The post-hook example requires an unhooked CreateInterface target.");
}

const g_Hook = CreateFunctionHook(g_Definition);
if (!g_Hook || !g_Hook.Created) {
	throw new Error("CreateFunctionHook did not create the example hook.");
}

let g_bRegistered = false;
try {
	g_bRegistered = AddPostHook(g_Definition, ObserveResult);
	if (!g_bRegistered) {
		throw new Error("AddPostHook could not register the callback.");
	}

	const unResultAddress = CallFunction({ ...g_Definition, Arguments: [g_strInterfaceName, 0n] });
	if ((unResultAddress !== 0n) || (g_vecObservedResults.length !== 1) || (g_vecObservedResults[0] !== unResultAddress)) {
		throw new Error("The post hook did not observe the unchanged return value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	if (g_bRegistered) {
		try {
			if (!g_Hook.RemovePost(ObserveResult)) {
				throw new Error("AddPostHook callback cleanup failed.");
			}
		} catch (CleanupError) {
			g_vecErrors.push(CleanupError);
		}
	}

	try {
		if (!g_Hook.Remove()) {
			throw new Error("AddPostHook hook cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "AddPostHook example and cleanup failed.");
}
```
