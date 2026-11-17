# `require("memory/hooks/events")`

> Warning: event addresses are borrowed native `IGameEvent*` values. An address received by a pre-hook is valid only until that `FireEvent` call is continued, blocked or invoked through the `TrampolineAddress`. Never retain it for delayed work.

The `memory/hooks/events` module exposes direct `IGameEvent` access and a managed pre-hook for `IGameEventManager2::FireEvent`. Use it when an event must be inspected, rewritten, hidden from clients or blocked before ordinary game-event listeners run.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Choosing an event API](#choosing-an-event-api)
- [Addresses and hook metadata](#addresses-and-hook-metadata)
- [Direct event access](#direct-event-access)
- [Firing an event](#firing-an-event)
- [Runtime event channel](#runtime-event-channel)
- [`EventAction`](#eventaction)
- [Managed pre-event context](#managed-pre-event-context)
- [Registration and cleanup](#registration-and-cleanup)
- [Stopping broadcast](#stopping-broadcast)
- [Blocking an event](#blocking-an-event)
- [Callback ordering](#callback-ordering)
- [Raw vtable hook](#raw-vtable-hook)
- [Calling the trampoline](#calling-the-trampoline)
- [Trampoline register context](#trampoline-register-context)
- [Errors and capability rules](#errors-and-capability-rules)

## Import

```js
const {
	EventAction,
	EventAddress,
	ManagerAddress,
} = require("memory/hooks/events");

const g_unEventManagerAddress = ManagerAddress();
if ((typeof g_unEventManagerAddress !== "bigint") || (g_unEventManagerAddress <= 0n)) {
	throw new Error("memory/hooks/events did not expose the event-manager address");
}

if ((EventAddress() !== 0n) || (EventAddress(g_unEventManagerAddress) !== g_unEventManagerAddress)) {
	throw new Error("memory/hooks/events did not preserve BigInt event addresses");
}

if (!Object.isFrozen(EventAction)) {
	throw new Error("memory/hooks/events did not freeze its event-action namespace");
}

if ((EventAction.Continue === EventAction.StopBroadcast) || (EventAction.Continue === EventAction.Block) || (EventAction.StopBroadcast === EventAction.Block)) {
	throw new Error("memory/hooks/events did not expose distinct event actions");
}
```

`GetUInt64` and `SetUInt64` are additional exports only on SDK branches whose `IGameEvent` declares `GetUint64` and `SetUint64`. They are own writable, enumerable, configurable function properties; installation bypasses inherited setters and non-writable prototype properties. Test the export before using it.

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| [`EventAction`](#eventaction) | frozen namespace | `Continue`, `StopBroadcast`, `Block` |
| `ClearPreEvents` | `ClearPreEvents(strEventName?)` | removal `boolean` |
| `EnsurePreEventHook` | `EnsurePreEventHook()` | stable native hook handle |
| `EventInfo` | `EventInfo(unEventAddress)` | point-in-time event metadata |
| `EventName` | `EventName(unEventAddress)` | event-name `string` |
| `EventAddress` | `EventAddress(unEventAddress?)` | normalized BigInt address, or `0n` when omitted or invalid |
| `Fire` | `Fire(strEventName, Payload?, bDoNotBroadcast?)` | native success `boolean` |
| `FireEventHookOptions` | `FireEventHookOptions()` | `CreateVTableHook` options for the selected SDK/ABI; the `FireEvent` slot accounts for `AddListenerGlobal` when that SDK declares it |
| `FreeEvent` | `FreeEvent(unEventAddress)` | `true` after native release |
| `GetBool` | `GetBool(unEventAddress, strKeyName, bDefaultValue?)` | `boolean` |
| `GetFloat` | `GetFloat(unEventAddress, strKeyName, dblDefaultValue?)` | `number`; the default must fit a finite native float |
| `GetInt` | `GetInt(unEventAddress, strKeyName, nDefaultValue?)` | signed `number` |
| `GetPreEventHook` | `GetPreEventHook()` | hook handle or `null` |
| `GetString` | `GetString(unEventAddress, strKeyName, strDefaultValue?)` | `string` |
| `GetUInt64` | `GetUInt64(unEventAddress, strKeyName, unDefaultValue?)` | unsigned `bigint`; optional |
| `IsEmpty` | `IsEmpty(unEventAddress, strKeyName?)` | event/key emptiness `boolean` |
| `IsPreEventHookInstalled` | `IsPreEventHookInstalled()` | `boolean` |
| `ManagerAddress` | `ManagerAddress()` | positive BigInt address of `IGameEventManager2` |
| `Off` | `Off(strEventName, Callback)` | runtime-channel removal `boolean` |
| `OffPre` | `OffPre(strEventName, Callback)` | `true`, or an exception when absent |
| `On` | `On(strEventName, Callback)` | runtime-channel registration `boolean` |
| `OnPre` | `OnPre(strEventName, Callback)` | the registered callback |
| `RemovePreEventHook` | `RemovePreEventHook()` | native removal `boolean` |
| `SetBool` | `SetBool(unEventAddress, strKeyName, bValue)` | `true` |
| `SetFloat` | `SetFloat(unEventAddress, strKeyName, dblValue)` | `true` |
| `SetInt` | `SetInt(unEventAddress, strKeyName, nValue)` | `true` |
| `SetString` | `SetString(unEventAddress, strKeyName, strValue)` | `true` |
| `SetUInt64` | `SetUInt64(unEventAddress, strKeyName, unValue)` | `true`; optional with `GetUInt64` |

The minimum selected-SDK surface contains 26 exports. A branch with UInt64 event methods contains 28.

## Choosing an event API

| Requirement | API |
| --- | --- |
| Observe a fired event after normal engine dispatch begins | [`events`](events.md) or [`events/manager`](events-manager.md) |
| Inspect or rewrite an event before ordinary listeners | `OnPre` |
| Prevent network broadcast but keep server-side dispatch | `EventAction.StopBroadcast` |
| Suppress dispatch completely | `EventAction.Block` |
| Build a custom event schema/resource | [`events/custom`](events-custom.md) and [`events/resource`](events-resource.md) |
| Install an unmanaged Detours hook | [`memory/hooks`](memory-hooks.md) with `FireEventHookOptions()` |

Do not install the managed and raw `FireEvent` hooks for the same plugin at the same time. They target the same vtable function and create ambiguous ownership.

## Addresses and hook metadata

`ManagerAddress()` returns the current `IGameEventManager2` address as a JavaScript BigInt. `FireEventHookOptions()` returns this exact object shape, with own writable, enumerable, configurable data properties and own data elements in `Arguments`; construction bypasses inherited setters and non-writable prototype properties:

| Field | Value |
| --- | --- |
| `ObjectAddress` | current event-manager address |
| `Index` | `7` on Windows or `8` on Linux, plus one when the selected SDK declares `AddListenerGlobal`; use the returned slot, never guess it |
| `Convention` | `"thiscall"` |
| `ReturnType` | `"bool"` |
| `Arguments` | `["address", "address", "bool"]` |

The arguments are manager `this`, `IGameEvent*` and `bDoNotBroadcast` in that order.

```js
const { FireEventHookOptions, ManagerAddress } = require("memory/hooks/events");

const g_unEventManagerAddress = ManagerAddress();
const g_HookOptions = FireEventHookOptions();
const g_vecExpectedArguments = ["address", "address", "bool"];
if ((typeof g_unEventManagerAddress !== "bigint") || (g_unEventManagerAddress <= 0n) || (g_HookOptions.ObjectAddress !== g_unEventManagerAddress) || !Number.isInteger(g_HookOptions.Index) || (g_HookOptions.Index < 0)) {
	throw new Error("FireEvent hook metadata does not match the active event manager.");
}

if ((g_HookOptions.Convention !== "thiscall") || (g_HookOptions.ReturnType !== "bool") || (g_HookOptions.Arguments.length !== g_vecExpectedArguments.length)) {
	throw new Error("Unexpected IGameEventManager2::FireEvent ABI.");
}

if (!g_HookOptions.Arguments.every((strTypeName, unIndex) => strTypeName === g_vecExpectedArguments[unIndex])) {
	throw new Error("Unexpected IGameEventManager2::FireEvent argument types.");
}
```

`EventAddress(unEventAddress)` accepts a nonzero, architecture-width BigInt and returns it unchanged; omitted, zero or invalid input returns `0n`. This validates only the numeric representation, not mapped storage, the native object type, or event lifetime. A nonzero result does not prove that it is safe to pass the address to event readers, setters, or `FreeEvent()`.
Pass `Event.EventAddress` or a pre-event context's `Address`; it does not turn arbitrary JavaScript objects into native events.

## Direct event access

`EventInfo(unEventAddress)` returns four scalar fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `EventName` | `string` | current `IGameEvent::GetName()` |
| `Reliable` | `boolean` | current `IsReliable()` result |
| `Local` | `boolean` | current `IsLocal()` result |
| `EventAddress` | `bigint` | the same borrowed event address |

The metadata object contains own writable, enumerable, configurable data properties; construction bypasses inherited setters and non-writable prototype properties. It is point-in-time because the SDK provides no write path for its reliability/local flags. Event values are different: all setters write directly to the borrowed native event, so later pre-hooks and normal listeners see the change.

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const {
	EventInfo,
	EventName,
	EventAddress,
	Fire,
	GetBool,
	GetFloat,
	GetInt,
	GetString,
	IsEmpty,
	OffPre,
	OnPre,
	SetBool,
	SetFloat,
	SetInt,
	SetString,
} = require("memory/hooks/events");

const g_strEventName = "SourceJSMemoryAccess";
const g_strResourcePath = "sourcejs/examples/memory_hooks_access";
const g_ResourceFile = new EventResourceFile(g_strResourcePath);
const g_vecErrors = [];
let g_bHandled = false;
let g_bCallbackRegistered = false;

function NormalizeMemoryAccess(Context) {
	const unEventAddress = EventAddress(Context.Address);
	const EventInformation = EventInfo(unEventAddress);

	if ((EventInformation.EventAddress !== unEventAddress) || (EventInformation.EventName !== g_strEventName) || (EventName(unEventAddress) !== g_strEventName) || (typeof EventInformation.Reliable !== "boolean") || (typeof EventInformation.Local !== "boolean")) {
		throw new Error("The borrowed event identity changed inside its callback.");
	}

	if (IsEmpty(unEventAddress) || !IsEmpty(unEventAddress, "Label")) {
		throw new Error("The event did not preserve its declared empty label.");
	}

	const unDamage = Math.max(0, GetInt(unEventAddress, "Damage", 0));
	const flScale = Math.max(0, GetFloat(unEventAddress, "Scale", 1.0));
	const bChecked = !GetBool(unEventAddress, "Checked", false);
	const strLabel = GetString(unEventAddress, "Label", "ready");
	if (!SetInt(unEventAddress, "Damage", unDamage) || !SetFloat(unEventAddress, "Scale", flScale) || !SetBool(unEventAddress, "Checked", bChecked) || !SetString(unEventAddress, "Label", (strLabel.length === 0) ? "ready" : strLabel.toLowerCase())) {
		throw new Error("An IGameEvent setter rejected the borrowed event.");
	}

	if ((GetInt(unEventAddress, "Damage") !== 0) || (GetFloat(unEventAddress, "Scale") !== 1.5) || !GetBool(unEventAddress, "Checked") || (GetString(unEventAddress, "Label") !== "ready")) {
		throw new Error("The event writes were not visible through the borrowed address.");
	}

	g_bHandled = true;
}

g_ResourceFile.SetEventResource(g_strEventName, {
	Checked: "bool",
	Damage: "long",
	Label: "string",
	Scale: "float",
});

if (DoesFileExist(g_ResourceFile.FullEventResourceFilePath)) {
	throw new Error(`The example refuses to overwrite ${g_ResourceFile.FullEventResourceFilePath}.`);
}

g_ResourceFile.WriteEventResourceFile();

try {
	const nLoadedEventCount = g_ResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 1)) {
		throw new Error("The engine did not load the example event declaration.");
	}

	if (OnPre(g_strEventName, NormalizeMemoryAccess) !== NormalizeMemoryAccess) {
		throw new Error("The example could not register its event-access callback.");
	}

	g_bCallbackRegistered = true;

	const bFired = Fire(g_strEventName, {
		Checked: false,
		Damage: -8,
		Label: "",
		Scale: 1.5,
	}, true);
	if (!bFired || !g_bHandled) {
		throw new Error("The private event did not pass through the managed pre-hook.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bCallbackRegistered) {
		try {
			if (!OffPre(g_strEventName, NormalizeMemoryAccess)) {
				throw new Error("The example could not remove its event-access callback.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	try {
		if (!RemoveFile(g_ResourceFile.FullEventResourceFilePath)) {
			throw new Error(`Unable to remove ${g_ResourceFile.FullEventResourceFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Event access and cleanup failed.");
}
```

Input event names and key names must be non-empty strings. Boolean/string defaults and values require their exact JavaScript types. Integer inputs use JavaScript `ToInt32`: numeric conversion followed by truncation and signed 32-bit wrapping, not range rejection; non-finite results become zero. Float inputs undergo numeric conversion, then must be finite and fit a native `float`; native storage/defaults narrow to float precision. Numeric strings, booleans and `null` therefore coerce; `BigInt` and `Symbol` cannot convert, and conversion exceptions propagate unchanged. Omitted/`undefined` numeric defaults use zero. Prefer explicit in-range integer/float `Number` values instead of relying on coercion. Setters return `true` after calling the SDK.

The resource examples attempt every confirmed cleanup in reverse acquisition order. A lone failure is rethrown unchanged; multiple operation/removal failures use `AggregateError` in that order. A failed registration may have unknown partial effects, and a failed removal may leave its callback/file behind. Context teardown releases remaining owned callbacks, not files; coordinate file recovery separately. Choose private unused resource paths: the existence check is not atomic exclusive creation. A failed write can leave a partial file; these examples claim ownership only after `WriteEventResourceFile()` succeeds and do not guess whether an unconfirmed artifact is safe to delete.

### UInt64 event values

UInt64 access is capability-shaped and uses `bigint`, not `Number`. These integer values are distinct from borrowed native event addresses:

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const g_EventsHooks = require("memory/hooks/events");

const g_bHasGetUInt64 = typeof g_EventsHooks.GetUInt64 === "function";
const g_bHasSetUInt64 = typeof g_EventsHooks.SetUInt64 === "function";
if (g_bHasGetUInt64 !== g_bHasSetUInt64) {
	throw new Error("The selected SDK exposed an incomplete UInt64 event API.");
}

if (g_bHasGetUInt64) {
	const strEventName = "SourceJSMemoryUInt64";
	const strResourcePath = "sourcejs/examples/memory_hooks_uint64";
	const ResourceFile = new EventResourceFile(strResourcePath);
	const vecErrors = [];
	let unObservedSequence = 0n;
	let bCallbackRegistered = false;

	function IncrementSequence(Context) {
		const unSequence = g_EventsHooks.GetUInt64(Context.Address, "Sequence", 0n);
		if (!g_EventsHooks.SetUInt64(Context.Address, "Sequence", unSequence + 1n)) {
			throw new Error("IGameEvent::SetUint64 rejected the borrowed event.");
		}

		unObservedSequence = g_EventsHooks.GetUInt64(Context.Address, "Sequence");
	}

	ResourceFile.SetEventResource(strEventName);

	if (DoesFileExist(ResourceFile.FullEventResourceFilePath)) {
		throw new Error(`The example refuses to overwrite ${ResourceFile.FullEventResourceFilePath}.`);
	}

	ResourceFile.WriteEventResourceFile();

	try {
		const nLoadedEventCount = ResourceFile.LoadEventsFromFile();
		if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 1)) {
			throw new Error("The engine did not load the UInt64 probe event.");
		}

		if (g_EventsHooks.OnPre(strEventName, IncrementSequence) !== IncrementSequence) {
			throw new Error("The example could not register its UInt64 callback.");
		}

		bCallbackRegistered = true;

		if (!g_EventsHooks.Fire(strEventName, { Sequence: 41n }, true) || (unObservedSequence !== 42n)) {
			throw new Error("The UInt64 event value did not round-trip through the pre-hook.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	} finally {
		if (bCallbackRegistered) {
			try {
				if (!g_EventsHooks.OffPre(strEventName, IncrementSequence)) {
					throw new Error("The example could not remove its UInt64 callback.");
				}
			} catch (CaughtError) {
				vecErrors.push(CaughtError);
			}
		}

		try {
			if (!RemoveFile(ResourceFile.FullEventResourceFilePath)) {
				throw new Error(`Unable to remove ${ResourceFile.FullEventResourceFilePath}.`);
			}
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "UInt64 event access and cleanup failed.");
	}
}
```

If the branch omits these exports, calling them without a capability check produces a normal JavaScript missing-property error.

## Firing an event

`Fire(strEventName, Payload?, bDoNotBroadcast?)` requests forced creation of a real engine event, copies the payload into it and calls `IGameEventManager2::FireEvent`. A loaded game-event resource is not required for this binding to create the event; use one when the event needs a declared schema for other engine consumers. `bDoNotBroadcast` must be a boolean when provided.

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const { Fire } = require("memory/hooks/events");

const g_strEventName = "SourceJSMemoryMetric";
const g_strResourcePath = "sourcejs/examples/memory_hooks_metric";
const g_ResourceFile = new EventResourceFile(g_strResourcePath);
const g_vecErrors = [];

g_ResourceFile.SetEventResource(g_strEventName, {
	Count: "long",
	Label: "string",
});

if (DoesFileExist(g_ResourceFile.FullEventResourceFilePath)) {
	throw new Error(`The example refuses to overwrite ${g_ResourceFile.FullEventResourceFilePath}.`);
}

g_ResourceFile.WriteEventResourceFile();

try {
	const nLoadedEventCount = g_ResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 1)) {
		throw new Error("The engine did not load the metric event declaration.");
	}

	const bFired = Fire(g_strEventName, {
		Count: 3,
		Label: "ready",
	}, true);
	if (!bFired) {
		throw new Error(`The engine rejected ${g_strEventName}.`);
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (!RemoveFile(g_ResourceFile.FullEventResourceFilePath)) {
			throw new Error(`Unable to remove ${g_ResourceFile.FullEventResourceFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Metric event dispatch and cleanup failed.");
}
```

Payload validation completes before the event is handed to engine dispatch. If conversion fails after native allocation, SourceJS frees the event before throwing.

## Runtime event channel

`On` and `Off` bind SourceJS runtime events, not `IGameEventManager2` events. Their names and callback identities are exact. Use [`events.RegisterEventListener`](events.md) for ordinary game-event listeners and [`plugins/bus`](plugins-bus.md) for serialized cross-plugin messages.

```js
const { Emit } = require("listeners");
const { Off, On } = require("memory/hooks/events");

const g_strChannelName = "SourceJSMemoryHooksProbe";
const g_vecErrors = [];
let g_ObservedPayload = null;

function OnProbe(strEventName, strSerializedPayload) {
	if ((strEventName !== g_strChannelName) || (typeof strSerializedPayload !== "string")) {
		throw new Error("The runtime channel changed its callback contract.");
	}

	g_ObservedPayload = JSON.parse(strSerializedPayload);
}

if (!On(g_strChannelName, OnProbe)) {
	throw new Error("The runtime channel rejected the probe callback.");
}

try {
	const unListenerCount = Emit(g_strChannelName, {
		RequestID: 17,
		State: "ready",
	});
	if (!Number.isInteger(unListenerCount) || (unListenerCount < 1)) {
		throw new Error("The runtime channel did not invoke its registered callback.");
	}

	if ((g_ObservedPayload === null) || (g_ObservedPayload.RequestID !== 17) || (g_ObservedPayload.State !== "ready")) {
		throw new Error("The runtime event did not preserve its serialized payload.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (!Off(g_strChannelName, OnProbe)) {
			throw new Error("The runtime channel did not remove the probe callback.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Runtime channel dispatch and cleanup failed.");
}
```

The callback is owned by the current plugin context and is removed automatically when that plugin unloads. Explicit removal is still preferred for reloadable components.

## `EventAction`

| Member | Value | Effect |
| --- | --- | --- |
| `EventAction.Continue` | `0` | keep the current broadcast flag and continue original dispatch |
| `EventAction.StopBroadcast` | `1` | set `bDoNotBroadcast` to `true`, then continue original dispatch |
| `EventAction.Block` | `2` | free the event, return `false` and skip original dispatch |

Callbacks may return one member or `undefined`. The convenience methods on the context return the corresponding member.

## Managed pre-event context

Every callback registered by `OnPre` receives one shared context for the current native `FireEvent` call.

### Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `Action` | `EventAction` number | strongest completed-callback action on callback entry; action methods update it immediately within that callback |
| `DoNotBroadcast` | `boolean` | current third `FireEvent` argument |
| `Name` | `string` | event name resolved from the native address |
| `Address` | `bigint` | borrowed native event address |

### Methods

| Method | Result | Effect |
| --- | --- | --- |
| `Continue()` | `EventAction.Continue` | requests normal dispatch; cannot lower a stronger prior callback action |
| `StopBroadcast()` | `EventAction.StopBroadcast` | marks the event server-only |
| `Block()` | `EventAction.Block` | marks the event for native release and suppression |
| `CallHookTrampoline(Options?)` | `{ ReturnValue, Registers }` | immediately calls the real Detours trampoline |
| `SetHookReturnValue(Value)` | native setter result | writes the raw hook return and suppresses the pending original call |

After each callback returns, the dispatcher combines its result and current `Action` with the strongest earlier callback action. `Continue()` can reset the current context field, but cannot lower that accumulated result. Treat `Name` and `Address` as borrowed observation fields; writing them does not retarget the native invocation. Use the action methods rather than assigning `Action` directly.

`SetHookReturnValue(false)` alone skips `FireEvent` without freeing its event address. That leaks native ownership. Use `Block()` or return `EventAction.Block` for suppression. Use `SetHookReturnValue` only after a `TrampolineAddress` call when replacing the already-produced return value.

A trampoline call can consume the borrowed event before later managed callbacks run. Coordinate all callbacks for that target before using it; no later callback may read, write or free that consumed address. The shared context is not an owning event copy and does not extend native lifetime.

## Registration and cleanup

`OnPre(strEventName, Callback)` installs one shared vtable hook lazily. Callbacks are stored in insertion order per exact event name. Duplicate function identity for the same event throws.

`OffPre` removes one exact registration and attempts native hook removal after the final callback disappears. `ClearPreEvents(strEventName)` deletes one event's callback set and returns whether that set existed. `ClearPreEvents()` clears every event and returns `true`, including when already empty. These booleans do not confirm native hook removal: a failed removal retains the handle for `RemovePreEventHook()` to retry. `RemovePreEventHook()` removes only the native hook; it does not erase callback sets.

If registration and rollback both fail, `EnsurePreEventHook()` throws an `AggregateError` containing both errors and retains the native handle for cleanup. `GetPreEventHook()` exposes that retained handle, while `IsPreEventHookInstalled()` returns `false` until registration succeeds. `RemovePreEventHook()` can retry cleanup explicitly. A subsequent `EnsurePreEventHook()` retries pending cleanup before creating another handle; failed cleanup never creates an additional hook or discards the retained handle.

Callback sets and the managed handle cache are local to the current JavaScript context, but the native target belongs to the process-wide hook registry. The handle's `Remove()` used by `RemovePreEventHook()` and final-callback cleanup removes that shared record and its callbacks for every owner, not just the current plugin. Coordinate all users of the target across plugin contexts before allowing this cleanup. Context teardown is different: it releases that context's callbacks and ownership, retaining the record while other owners or callbacks remain.

Run the following lifecycle probe only in a dedicated plugin context with no other users of its callback sets, and coordinate ownership of the shared native target. It deliberately tests global callback clearing and manual native-hook removal; it is not a teardown helper for an arbitrary shared component. Its final cleanup targets the probe's event and retries a retained native handle, while preserving operation and cleanup failures.

```js
const {
	ClearPreEvents,
	EnsurePreEventHook,
	GetPreEventHook,
	IsPreEventHookInstalled,
	OffPre,
	OnPre,
	RemovePreEventHook,
} = require("memory/hooks/events");

const g_strEventName = "SourceJSCleanupProbe";
const g_vecErrors = [];

function Observe() {
}

try {
	if (OnPre(g_strEventName, Observe) !== Observe) {
		throw new Error("OnPre() did not return the registered callback.");
	}

	const FirstHook = GetPreEventHook();
	const SecondHook = EnsurePreEventHook();
	if ((FirstHook !== SecondHook) || !IsPreEventHookInstalled()) {
		throw new Error("The managed hook did not preserve stable identity.");
	}

	if (!OffPre(g_strEventName, Observe)) {
		throw new Error("OffPre() did not remove the registered callback.");
	}

	if (IsPreEventHookInstalled() || (GetPreEventHook() !== null)) {
		throw new Error("The final callback did not release the native hook.");
	}

	const ManualHook = EnsurePreEventHook();
	if ((GetPreEventHook() !== ManualHook) || !RemovePreEventHook() || IsPreEventHookInstalled()) {
		throw new Error("Manual hook removal did not clear the managed handle.");
	}

	if (OnPre(g_strEventName, Observe) !== Observe) {
		throw new Error("OnPre() did not return the callback before global cleanup.");
	}

	if (!ClearPreEvents() || IsPreEventHookInstalled() || (GetPreEventHook() !== null)) {
		throw new Error("Global pre-event cleanup did not release its callbacks and hook.");
	}

	if ((RemovePreEventHook() !== false) || (ClearPreEvents(g_strEventName) !== false)) {
		throw new Error("Empty cleanup should report that nothing was removed.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		// False means this event already has no callback set; native removal is checked separately.
		ClearPreEvents(g_strEventName);
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		if ((GetPreEventHook() !== null) && !RemovePreEventHook()) {
			throw new Error("The lifecycle probe could not release its retained native hook.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Managed hook lifecycle and cleanup failed.");
}
```

If native hook removal returns `false`, SourceJS retains the handle so a later cleanup attempt can retry. If registering the raw pre callback fails and rollback succeeds, `EnsurePreEventHook()` rethrows the original error without caching that new handle. If rollback also fails, it retains the handle and reports both errors as described above.

## Stopping broadcast

`StopBroadcast` does not cancel server-side event dispatch. It changes argument index `2` to `true` before the original function runs.

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const { EventAction, Fire, OffPre, OnPre } = require("memory/hooks/events");

const g_strEventName = "SourceJSPrivateMetric";
const g_strResourcePath = "sourcejs/examples/memory_hooks_private";
const g_ResourceFile = new EventResourceFile(g_strResourcePath);
const g_vecErrors = [];
let g_bObservedStop = false;
let g_bBroadcastCallbackRegistered = false;
let g_bPrivacyCallbackRegistered = false;

function HideDiagnosticEvent(Context) {
	if (Context.DoNotBroadcast) {
		return EventAction.Continue;
	}

	return Context.StopBroadcast();
}

function ObservePrivacy(Context) {
	if ((Context.Action !== EventAction.StopBroadcast) || !Context.DoNotBroadcast) {
		throw new Error("The shared pre-event context did not expose the broadcast change.");
	}

	g_bObservedStop = true;
}

g_ResourceFile.SetEventResource(g_strEventName, { Count: "long" });

if (DoesFileExist(g_ResourceFile.FullEventResourceFilePath)) {
	throw new Error(`The example refuses to overwrite ${g_ResourceFile.FullEventResourceFilePath}.`);
}

g_ResourceFile.WriteEventResourceFile();

try {
	const nLoadedEventCount = g_ResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 1)) {
		throw new Error("The engine did not load the private metric event.");
	}

	if (OnPre(g_strEventName, HideDiagnosticEvent) !== HideDiagnosticEvent) {
		throw new Error("The example could not register its broadcast callback.");
	}

	g_bBroadcastCallbackRegistered = true;

	if (OnPre(g_strEventName, ObservePrivacy) !== ObservePrivacy) {
		throw new Error("The example could not register its privacy observer.");
	}

	g_bPrivacyCallbackRegistered = true;

	if (!Fire(g_strEventName, { Count: 1 }, false) || !g_bObservedStop) {
		throw new Error("The event was not converted to server-only dispatch.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bPrivacyCallbackRegistered) {
		try {
			if (!OffPre(g_strEventName, ObservePrivacy)) {
				throw new Error("The example could not remove its privacy observer.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	if (g_bBroadcastCallbackRegistered) {
		try {
			if (!OffPre(g_strEventName, HideDiagnosticEvent)) {
				throw new Error("The example could not remove its broadcast callback.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	try {
		if (!RemoveFile(g_ResourceFile.FullEventResourceFilePath)) {
			throw new Error(`Unable to remove ${g_ResourceFile.FullEventResourceFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Private event dispatch and cleanup failed.");
}
```

Returning `EventAction.StopBroadcast` also requests server-only dispatch. `Context.StopBroadcast()` additionally updates `Context.DoNotBroadcast` immediately for later callbacks; the dispatcher applies the native broadcast argument after the managed callback loop finishes.

## Blocking an event

`Block` calls `FreeEvent(unEventAddress)` exactly once and returns `false` from the raw pre-hook. The Detours bridge writes that boolean return and does not call the original `FireEvent`. Do not manually release the same event, or request `Block` after a trampoline call has already consumed it.

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const { Fire, OffPre, OnPre } = require("memory/hooks/events");

const g_strEventName = "SourceJSDebugOnly";
const g_strResourcePath = "sourcejs/examples/memory_hooks_block";
const g_ResourceFile = new EventResourceFile(g_strResourcePath);
const g_vecErrors = [];
let g_bCallbackRegistered = false;

function BlockDebugEvent(Context) {
	if (Context.Name === g_strEventName) {
		return Context.Block();
	}
}

g_ResourceFile.SetEventResource(g_strEventName, { Message: "string" });

if (DoesFileExist(g_ResourceFile.FullEventResourceFilePath)) {
	throw new Error(`The example refuses to overwrite ${g_ResourceFile.FullEventResourceFilePath}.`);
}

g_ResourceFile.WriteEventResourceFile();

try {
	const nLoadedEventCount = g_ResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 1)) {
		throw new Error("The engine did not load the block-probe event.");
	}

	if (OnPre(g_strEventName, BlockDebugEvent) !== BlockDebugEvent) {
		throw new Error("The example could not register its blocking callback.");
	}

	g_bCallbackRegistered = true;

	const bFired = Fire(g_strEventName, { Message: "hidden" }, false);
	if (bFired !== false) {
		throw new Error("The blocked event unexpectedly reached engine dispatch.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bCallbackRegistered) {
		try {
			if (!OffPre(g_strEventName, BlockDebugEvent)) {
				throw new Error("The example could not remove its blocking callback.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	try {
		if (!RemoveFile(g_ResourceFile.FullEventResourceFilePath)) {
			throw new Error(`Unable to remove ${g_ResourceFile.FullEventResourceFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Blocked event dispatch and cleanup failed.");
}
```

Do not call `FreeEvent` after the `TrampolineAddress` or normal dispatch has consumed the event. The public function exists for raw-hook ownership; managed `Block` performs the safe sequence for pre-events.

## Callback ordering

Completed-callback actions are monotonic: `Continue < StopBroadcast < Block`. A later callback can inspect the shared `Context.Action`, but `Continue()` cannot undo a stronger action chosen earlier. Dispatch stops immediately after `Block`.

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const { EventAction, Fire, OffPre, OnPre } = require("memory/hooks/events");

const g_strEventName = "SourceJSOrderProbe";
const g_strResourcePath = "sourcejs/examples/memory_hooks_order";
const g_ResourceFile = new EventResourceFile(g_strResourcePath);
const g_vecOrder = [];
const g_vecErrors = [];
let g_bOrderingCallbackRegistered = false;
let g_bOrderingObserverRegistered = false;

function MakeServerOnly() {
	g_vecOrder.push("privacy");

	return EventAction.StopBroadcast;
}

function TryToContinue(Context) {
	g_vecOrder.push(`audit:${Context.Action}`);

	return Context.Continue();
}

g_ResourceFile.SetEventResource(g_strEventName);

if (DoesFileExist(g_ResourceFile.FullEventResourceFilePath)) {
	throw new Error(`The example refuses to overwrite ${g_ResourceFile.FullEventResourceFilePath}.`);
}

g_ResourceFile.WriteEventResourceFile();

try {
	const nLoadedEventCount = g_ResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 1)) {
		throw new Error("The engine did not load the callback-order probe event.");
	}

	if (OnPre(g_strEventName, MakeServerOnly) !== MakeServerOnly) {
		throw new Error("The example could not register its ordering callback.");
	}

	g_bOrderingCallbackRegistered = true;

	if (OnPre(g_strEventName, TryToContinue) !== TryToContinue) {
		throw new Error("The example could not register its ordering observer.");
	}

	g_bOrderingObserverRegistered = true;

	if (!Fire(g_strEventName, {}, false)) {
		throw new Error("The server-only event did not reach engine dispatch.");
	}

	if (g_vecOrder.join(",") !== `privacy,audit:${EventAction.StopBroadcast}`) {
		throw new Error("Pre-event callback order or action aggregation changed.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bOrderingObserverRegistered) {
		try {
			if (!OffPre(g_strEventName, TryToContinue)) {
				throw new Error("The example could not remove its ordering observer.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	if (g_bOrderingCallbackRegistered) {
		try {
			if (!OffPre(g_strEventName, MakeServerOnly)) {
				throw new Error("The example could not remove its ordering callback.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	try {
		if (!RemoveFile(g_ResourceFile.FullEventResourceFilePath)) {
			throw new Error(`Unable to remove ${g_ResourceFile.FullEventResourceFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Event callback ordering and cleanup failed.");
}
```

Callbacks added or removed while a `Set` is being iterated follow normal JavaScript `Set` iteration rules. Change registrations outside active dispatch whenever possible.

## Raw vtable hook

For full payload access, build the hook directly with `memory/hooks.CreateVTableHook`. The returned native handle has:

| Member | Type |
| --- | --- |
| `ID` | numeric hook ID |
| `Address` | patched function address as `bigint` |
| `TrampolineAddress` | executable Detours trampoline address as `bigint` |
| `Pre(Callback)` | register pre callback, return `boolean` |
| `Post(Callback)` | register post callback, return `boolean` |
| `RemovePre(Callback)` | remove pre callback, return `boolean` |
| `RemovePost(Callback)` | remove post callback, return `boolean` |
| `Remove()` | remove the hook, return `boolean` |

A raw pre payload contains `HookID`, `Type`, `Arguments`, `TrampolineAddress`, `CallHookTrampoline`, `SetHookReturnValue` and `SetHookArgument`. A raw post payload contains `HookID`, `Type`, `Arguments`, `ReturnValue` and `SetHookReturnValue`.

The event address in a post payload's `Arguments[1]` does not extend native lifetime: the engine or a blocking pre-hook may already have freed the event. Do not pass that address to event getters/setters or `FreeEvent()`.

Use this raw-hook probe only with coordinated teardown authority over the target. Creating a handle can reuse a process-wide hook; its ID does not prove exclusive ownership, and `Remove()` can affect other owners. In a shared component, remove only your callbacks and let the coordinated owner release the native hook instead.

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const { CreateVTableHook } = require("memory/hooks");
const {
	EventInfo,
	Fire,
	FireEventHookOptions,
	FreeEvent,
} = require("memory/hooks/events");

const g_strBlockEventName = "SourceJSRawBlock";
const g_strProbeEventName = "SourceJSRawProbe";
const g_strResourcePath = "sourcejs/examples/memory_hooks_raw";
const g_ResourceFile = new EventResourceFile(g_strResourcePath);
const g_vecErrors = [];
let g_Hook = null;
let g_bPreCallbackRegistered = false;
let g_bPostCallbackRegistered = false;
let g_bBlockedEventObserved = false;
let g_unPostCount = 0;
let g_bProbeEventObserved = false;

function InspectEventHookPayload(Payload) {
	const EventValue = EventInfo(Payload.Arguments[1]);
	if ((Payload.Type !== "pre") || (Payload.HookID !== g_Hook.ID) || (Payload.TrampolineAddress !== g_Hook.TrampolineAddress)) {
		throw new Error("Unexpected raw pre-hook payload.");
	}

	if (EventValue.EventName === g_strBlockEventName) {
		if (!FreeEvent(EventValue.EventAddress)) {
			throw new Error("The raw pre-hook could not release the blocked event.");
		}

		g_bBlockedEventObserved = true;
		return false;
	}

	if (EventValue.EventName === g_strProbeEventName) {
		if (Payload.SetHookArgument(2, true) !== true) {
			throw new Error("The raw pre-hook could not replace bDoNotBroadcast.");
		}

		g_bProbeEventObserved = true;
	}
}

function HandleEventHookPostPayload(Payload) {
	if ((Payload.Type !== "post") || (Payload.HookID !== g_Hook.ID) || (typeof Payload.ReturnValue !== "boolean")) {
		throw new Error("Unexpected raw post-hook payload.");
	}

	if (Payload.SetHookReturnValue(Payload.ReturnValue) !== Payload.ReturnValue) {
		throw new Error("The raw post-hook could not preserve the native return value.");
	}

	g_unPostCount += 1;
}

g_ResourceFile.SetEventResource(g_strBlockEventName);
g_ResourceFile.SetEventResource(g_strProbeEventName, { Value: "long" });

if (DoesFileExist(g_ResourceFile.FullEventResourceFilePath)) {
	throw new Error(`The example refuses to overwrite ${g_ResourceFile.FullEventResourceFilePath}.`);
}

g_ResourceFile.WriteEventResourceFile();

try {
	const nLoadedEventCount = g_ResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 2)) {
		throw new Error("The engine did not load both raw-hook probe events.");
	}

	g_Hook = CreateVTableHook(FireEventHookOptions());
	if (g_Hook === null) {
		throw new Error("The raw FireEvent hook target could not be resolved.");
	}

	if (!Number.isSafeInteger(g_Hook.ID) || (g_Hook.ID <= 0) || (typeof g_Hook.Address !== "bigint") || (g_Hook.Address <= 0n) || (typeof g_Hook.TrampolineAddress !== "bigint") || (g_Hook.TrampolineAddress <= 0n)) {
		throw new Error("The hook handle did not expose positive BigInt addresses and a numeric ID.");
	}

	if (!g_Hook.Pre(InspectEventHookPayload)) {
		throw new Error("Unable to register the raw FireEvent pre callback.");
	}

	g_bPreCallbackRegistered = true;

	if (!g_Hook.Post(HandleEventHookPostPayload)) {
		throw new Error("Unable to register the raw FireEvent post callback.");
	}

	g_bPostCallbackRegistered = true;

	if (!Fire(g_strProbeEventName, { Value: 7 }, false)) {
		throw new Error("The raw probe event did not reach engine dispatch.");
	}

	if (Fire(g_strBlockEventName, {}, false) !== false) {
		throw new Error(`The raw hook did not block ${g_strBlockEventName}.`);
	}

	if (!g_bProbeEventObserved || !g_bBlockedEventObserved || (g_unPostCount < 1)) {
		throw new Error("The raw FireEvent callbacks did not observe both dispatch paths.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bPostCallbackRegistered) {
		try {
			if (!g_Hook.RemovePost(HandleEventHookPostPayload)) {
				throw new Error("The raw FireEvent post callback could not be removed.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	if (g_bPreCallbackRegistered) {
		try {
			if (!g_Hook.RemovePre(InspectEventHookPayload)) {
				throw new Error("The raw FireEvent pre callback could not be removed.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	if (g_Hook !== null) {
		try {
			if (!g_Hook.Remove()) {
				throw new Error("The raw FireEvent hook could not be removed.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	try {
		if (!RemoveFile(g_ResourceFile.FullEventResourceFilePath)) {
			throw new Error(`Unable to remove ${g_ResourceFile.FullEventResourceFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Raw event hook operations and cleanup failed.");
}
```

The handle represents executable patch state. The probe attempts every confirmed callback removal, native handle removal and file removal independently; a lone failure is rethrown unchanged, while multiple failures use `AggregateError` in that order. A failed removal can retain native state and needs coordinated retry or context teardown; file recovery remains separate. The managed `OnPre` layer tracks its shared handle and pending cleanup, but does not make native removal infallible.

## Calling the trampoline

`Context.CallHookTrampoline()` invokes the real Detours trampoline immediately, including instructions overwritten by the patch. The raw hook is then marked as already handled, so the bridge does not invoke the original a second time.

Options may replace the complete argument array and selected input registers:

Coordinate callback ownership before running this trampoline probe: its sole pre callback consumes the event, so later callbacks must not access that address. The checks below inspect returned register values, not the consumed native event.

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const { ADDRESS_SIZE } = require("memory/helpers");
const { Fire, ManagerAddress, OffPre, OnPre } = require("memory/hooks/events");

const g_strEventName = "SourceJSTrampolineProbe";
const g_strResourcePath = "sourcejs/examples/memory_hooks_trampoline";
const g_vecIntegerRegisterNames = (ADDRESS_SIZE === 8) ? ["RAX", "RCX", "RDX", "RBX", "RSP", "RBP", "RSI", "RDI", "R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15", "RFLAGS"] : ["EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI", "EFLAGS"];
const g_strCustomRegisterName = (ADDRESS_SIZE === 8) ? "RBX" : "EBX";
const g_strObservedRegisterName = (ADDRESS_SIZE === 8) ? "RDX" : "EDX";
const g_unCustomRegisterValue = 0x1234n;
const g_unX87RegisterCount = 8;
const g_unX87RegisterByteCount = 10;
const g_unXMMRegisterByteCount = 16;
const g_unFXStateByteCount = 512;
const g_unXMMRegisterCount = (ADDRESS_SIZE === 8) ? 16 : 8;
const g_ResourceFile = new EventResourceFile(g_strResourcePath);
const g_vecErrors = [];
let g_bCallbackRegistered = false;
let g_bTrampolineReturnValuePreserved = false;
let g_TrampolineContext = null;

function CallOriginalNow(Context) {
	g_TrampolineContext = Context.CallHookTrampoline({
		Arguments: [ManagerAddress(), Context.Address, true],
		Registers: {
			[g_strCustomRegisterName]: g_unCustomRegisterValue,
		},
	});
	g_bTrampolineReturnValuePreserved = Context.SetHookReturnValue(g_TrampolineContext.ReturnValue) === g_TrampolineContext.ReturnValue;
	if (!g_bTrampolineReturnValuePreserved) {
		throw new Error("The trampoline callback could not preserve the native return value.");
	}
}

g_ResourceFile.SetEventResource(g_strEventName, { Value: "long" });

if (DoesFileExist(g_ResourceFile.FullEventResourceFilePath)) {
	throw new Error(`The example refuses to overwrite ${g_ResourceFile.FullEventResourceFilePath}.`);
}

g_ResourceFile.WriteEventResourceFile();

try {
	const nLoadedEventCount = g_ResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 1)) {
		throw new Error("The engine did not load the trampoline probe event.");
	}

	if (OnPre(g_strEventName, CallOriginalNow) !== CallOriginalNow) {
		throw new Error("The example could not register its trampoline callback.");
	}

	g_bCallbackRegistered = true;

	if (!Fire(g_strEventName, { Value: 9 }, false)) {
		throw new Error("The trampoline did not preserve successful FireEvent dispatch.");
	}

	if (!g_bTrampolineReturnValuePreserved) {
		throw new Error("The trampoline callback could not preserve the native return value.");
	}

	if ((g_TrampolineContext === null) || (typeof g_TrampolineContext.ReturnValue !== "boolean") || (g_TrampolineContext.Registers === null) || (g_TrampolineContext.Registers === undefined)) {
		throw new Error("The trampoline did not return its complete call context.");
	}

	const Registers = g_TrampolineContext.Registers;
	if (!g_vecIntegerRegisterNames.every((strRegisterName) => typeof Registers[strRegisterName] === "bigint")) {
		throw new Error("The trampoline omitted an architecture integer register.");
	}

	if ((Registers[g_strCustomRegisterName] !== g_unCustomRegisterValue) || (typeof Registers[g_strObservedRegisterName] !== "bigint")) {
		throw new Error("The trampoline did not preserve the custom register or capture EDX/RDX.");
	}

	if (!["FPUControlWord", "FPUStatusWord", "FPUTagWord", "MXCSR"].every((strRegisterName) => Number.isSafeInteger(Registers[strRegisterName]))) {
		throw new Error("The trampoline omitted floating-point control state.");
	}

	for (let unRegisterIndex = 0; unRegisterIndex < g_unX87RegisterCount; unRegisterIndex += 1) {
		if (!(Registers[`ST${unRegisterIndex}`] instanceof Uint8Array) || (Registers[`ST${unRegisterIndex}`].length !== g_unX87RegisterByteCount)) {
			throw new Error(`The trampoline returned an invalid ST${unRegisterIndex} register.`);
		}
	}

	for (let unRegisterIndex = 0; unRegisterIndex < g_unXMMRegisterCount; unRegisterIndex += 1) {
		if (!(Registers[`XMM${unRegisterIndex}`] instanceof Uint8Array) || (Registers[`XMM${unRegisterIndex}`].length !== g_unXMMRegisterByteCount)) {
			throw new Error(`The trampoline returned an invalid XMM${unRegisterIndex} register.`);
		}
	}

	if (!(Registers.FXState instanceof Uint8Array) || (Registers.FXState.length !== g_unFXStateByteCount)) {
		throw new Error("The trampoline did not return the 512-byte FX snapshot.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bCallbackRegistered) {
		try {
			if (!OffPre(g_strEventName, CallOriginalNow)) {
				throw new Error("The example could not remove its trampoline callback.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	try {
		if (!RemoveFile(g_ResourceFile.FullEventResourceFilePath)) {
			throw new Error(`Unable to remove ${g_ResourceFile.FullEventResourceFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Trampoline dispatch, context validation and cleanup failed.");
}
```

On both architectures, returned machine words are `bigint`; use canonical uppercase input names, for example `{ RDX: 0x1234n }` on x86_64 or `{ EDX: 0x1234n }` on x86. `CallerCleanup` may also be supplied for an x86 `cdecl` call when the caller must reclaim stack arguments; `FireEvent` itself uses `thiscall`, so the default is correct.

After `CallHookTrampoline`, the event may already have been dispatched and released by the engine. Do not call `Block`, `StopBroadcast`, `FreeEvent` or event getters/setters afterward. Read needed event data before the call, then use only the returned call context and `SetHookReturnValue`.

Managed pre-event callbacks return `EventAction`, not the native `bool`. To publish only the original boolean result, ignore the register object and pass the boolean to `SetHookReturnValue`:

```js
const { EventResourceFile } = require("events/resource");
const { DoesFileExist, RemoveFile } = require("filesystem");
const { Fire, OffPre, OnPre } = require("memory/hooks/events");

const g_strEventName = "SourceJSReturnProbe";
const g_strResourcePath = "sourcejs/examples/memory_hooks_return";
const g_ResourceFile = new EventResourceFile(g_strResourcePath);
const g_vecErrors = [];
let g_bObservedOriginal = false;
let g_bCallbackRegistered = false;
let g_bReturnValuePreserved = false;

function PreserveSuccessfulOriginal(Context) {
	const bReturnValue = Context.CallHookTrampoline().ReturnValue;
	const bFinalResult = bReturnValue === true;

	g_bObservedOriginal = bReturnValue;
	g_bReturnValuePreserved = Context.SetHookReturnValue(bFinalResult) === bFinalResult;
	if (!g_bReturnValuePreserved) {
		throw new Error("The return-value callback could not preserve the native return value.");
	}
}

g_ResourceFile.SetEventResource(g_strEventName);

if (DoesFileExist(g_ResourceFile.FullEventResourceFilePath)) {
	throw new Error(`The example refuses to overwrite ${g_ResourceFile.FullEventResourceFilePath}.`);
}

g_ResourceFile.WriteEventResourceFile();

try {
	const nLoadedEventCount = g_ResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount < 1)) {
		throw new Error("The engine did not load the return-value probe event.");
	}

	if (OnPre(g_strEventName, PreserveSuccessfulOriginal) !== PreserveSuccessfulOriginal) {
		throw new Error("The example could not register its return-value callback.");
	}

	g_bCallbackRegistered = true;

	const bFinalResult = Fire(g_strEventName, {}, false);
	if ((g_bObservedOriginal !== true) || (bFinalResult !== true)) {
		throw new Error("The original trampoline result did not become FireEvent's return value.");
	}

	if (!g_bReturnValuePreserved) {
		throw new Error("The return-value callback could not preserve the native return value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bCallbackRegistered) {
		try {
			if (!OffPre(g_strEventName, PreserveSuccessfulOriginal)) {
				throw new Error("The example could not remove its return-value callback.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	try {
		if (!RemoveFile(g_ResourceFile.FullEventResourceFilePath)) {
			throw new Error(`Unable to remove ${g_ResourceFile.FullEventResourceFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Original return-value publication and cleanup failed.");
}
```

## Trampoline register context

Every `CallHookTrampoline` call returns all captured state. There is no `CaptureRegisters` selector.

### x86 integer state

`EAX`, `ECX`, `EDX`, `EBX`, `ESP`, `EBP`, `ESI`, `EDI` and `EFLAGS` are unsigned BigInts.

### x86_64 integer state

`RAX`, `RCX`, `RDX`, `RBX`, `RSP`, `RBP`, `RSI`, `RDI`, `R8` through `R15` and `RFLAGS` are unsigned BigInts.

### Floating-point and SIMD state

Both architectures return:

- `FPUControlWord`, `FPUStatusWord`, `FPUTagWord` and `MXCSR` as unsigned Numbers;
- `ST0` through `ST7` as ten-byte `Uint8Array` values;
- `XMM0` through `XMM7` on x86 and through `XMM15` on x86_64 as sixteen-byte `Uint8Array` values;
- `FXState` as a synthesized 512-byte FXSAVE-shaped `Uint8Array`, not a complete raw CPU save image. It contains legacy x87 metadata with 32-bit instruction/data address fields, an abridged occupancy tag, ST slots, `MXCSR`, and the documented XMM slots; remaining bytes are zero. `FPUTagWord` is the abridged tag, not the original sixteen-bit classification word. `MXCSR_MASK` and upper YMM/ZMM state are not captured; do not restore a CPU context from this snapshot.

Input `Registers` may contain only the values that need replacing. The result still contains all documented post-call snapshot fields.

## Errors and capability rules

- Event and manager addresses are BigInts; `EventAddress()` returns `0n` when omitted or invalid, including Numbers, strings and `{ EventAddress }` wrappers. It never coerces these values into a native address. Event accessors require a valid borrowed address.
- Supplied pre-event addresses must be positive BigInts.
- Event names and value keys are non-empty strings. Direct-access value keys are encoded completely and reject embedded NUL characters instead of passing a truncated key to the SDK.
- `bDoNotBroadcast` and boolean values are actual booleans.
- Direct `GetInt` defaults and `SetInt` values retain V8's `Int32Value` conversion, including numeric coercion and 32-bit truncation. UInt64 values require unsigned 64-bit BigInts and return `bigint`.
- Supplied float defaults and setter values must be finite and fit the native float conversion; numeric coercion retains V8's `NumberValue` semantics. An exception from that coercion is propagated unchanged. Native stored float results are not normalized.
- `GetString` defaults and `SetString` values must be primitive strings. Empty strings are allowed; complete UTF-8 encoding is checked, and embedded NUL characters are rejected before SDK access. An unavailable native string is returned as `""`.
- `OnPre` rejects duplicate callback identity; `OffPre` rejects absent registrations.
- Managed pre-callback returns other than `undefined` or an exact `EventAction` member throw.
- Calls that require a disconnected `IGameEventManager2` or unavailable memory-hook runtime throw a native error. SDKs without UInt64 event methods omit only `GetUInt64` and `SetUInt64`; no case installs a fallback stub.
- Throwing from a managed pre callback aborts its JavaScript dispatcher; it is not equivalent to `EventAction.Block`. The native hook may still continue original dispatch unless it was already consumed or explicitly suppressed. Catch expected callback failures locally and clean up registrations in `finally` blocks.

Related references: [`events`](events.md), [`events/manager`](events-manager.md), [`listeners`](listeners.md), [`memory/hooks`](memory-hooks.md), and [`plugins/bus`](plugins-bus.md).

The native callbacks behind `ManagerAddress`, `FireEventHookOptions`, `EventAddress`, `EventName`, `EventInfo`, `IsEmpty`, the typed getters/setters and `FreeEvent` translate C++ failures to JavaScript errors. The public `events.FireEvent` callback likewise translates C++ failures without replacing an existing JavaScript exception. UInt64 callbacks remain conditional on the selected SDK. Hook-options, event-name, event-information and string-result construction retain an existing JavaScript exception rather than replacing it or returning a partial result. `EventInfo` reads native reliability/locality flags before writing its result properties, so those writes cannot cause later flag reads through the borrowed event address. These guards do not make arbitrary or expired native addresses safe; callers must preserve the event lifetime, including during argument coercion.
