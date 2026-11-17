# `require("entities/transmit")`

> Warning: this is a large reference for a low-level, selected-SDK API. Changing an edict transmit state affects every client and can be overwritten later by game DLL code that recalculates `UpdateTransmitState()`. Use the table of contents to keep availability, mutation, and restoration rules together.

`entities/transmit` exposes the current Source SDK edict transmission flags. It reads the live `edict_t::m_fStateFlags` value and, on supported branches, changes the transmit mode and marks the edict changed. It notifies `IVEngineServer` when the interface is available and the edict's current index can be resolved. The package entry point is [packages/sourcejs/entities/transmit.js](../../packages/sourcejs/entities/transmit.js); the native implementation is [src/sourcejs/modules/ModuleBindings.cpp](../../src/sourcejs/modules/ModuleBindings.cpp).

Call these engine-memory APIs on the server/game thread while the entity remains live. JavaScript entity wrappers resolve current state and do not pin native lifetime.

## Table of contents

- [Import](#import)
- [Availability](#availability)
- [State model](#state-model)
- [Constants](#constants)
- [Reading flags](#reading-flags)
- [Changing the transmit mode](#changing-the-transmit-mode)
- [Clearing the transmit mode](#clearing-the-transmit-mode)
- [Replacing state flags](#replacing-state-flags)
- [Practical workflows](#practical-workflows)
- [Errors and lifetime](#errors-and-lifetime)
- [Related modules](#related-modules)

## Import

```js
const {
	ALWAYS,
	ClearTransmitState,
	DONT_SEND,
	FULL_CHECK,
	GetTransmitStateFlags,
	PVS_CHECK,
	SetTransmitState,
	SetTransmitStateFlags,
} = require("entities/transmit");
const { LogInfo } = require("loggers");

const g_ReportEntityTransmitSurface = function ReportEntityTransmitSurface() {
	LogInfo("ReportEntityTransmitFunctions Result=%j", { ClearTransmitStateType: typeof ClearTransmitState, GetTransmitStateFlagsType: typeof GetTransmitStateFlags, SetTransmitStateFlagsType: typeof SetTransmitStateFlags, SetTransmitStateType: typeof SetTransmitState });
	LogInfo("ReportEntityTransmitConstants Result=%j", { AlwaysTransmitState: ALWAYS, DoNotSendTransmitState: DONT_SEND, FullCheckTransmitState: FULL_CHECK, PVSTransmitState: PVS_CHECK });
};

g_ReportEntityTransmitSurface();
```

The returned value is the exact native module object for the current plugin context. There is no `default`, `moduleName`, `runtime`, availability snapshot, alternate path, or lower-camel compatibility export.

## Availability

Every supported Source 1 branch exposes:

| Export | Signature | Result |
| --- | --- | --- |
| `FULL_CHECK` | constant | Selected-SDK `FL_EDICT_FULLCHECK`. |
| `ALWAYS` | constant | Selected-SDK `FL_EDICT_ALWAYS`. |
| `DONT_SEND` | constant | Selected-SDK `FL_EDICT_DONTSEND`. |
| `PVS_CHECK` | constant | Selected-SDK `FL_EDICT_PVSCHECK`. |
| [`GetTransmitStateFlags`](#gettransmitstateflagsentity) | `GetTransmitStateFlags(Entity)` | Current complete `m_fStateFlags` integer. |

All branches except `darkm` also expose:

| Export | Signature | Result |
| --- | --- | --- |
| [`SetTransmitStateFlags`](#settransmitstateflagsentity-nstateflags) | `SetTransmitStateFlags(Entity, nStateFlags)` | `true` after replacing the complete flag word. |
| [`SetTransmitState`](#settransmitstateentity-ntransmitstate) | `SetTransmitState(Entity, nTransmitState)` | `true` after selecting one transmit mode. |
| [`ClearTransmitState`](#cleartransmitstateentity) | `ClearTransmitState(Entity)` | `true` after returning to full-check mode. |

`GetTransmitStateFlags(Entity)` and `SetTransmitStateFlags(Entity, nStateFlags)` preserve an exception thrown while reading an entity record's `Index`; they do not replace it with a generic invalid-entity error. A failed read performs no flag mutation or change notification. The setter validates `nStateFlags` as a V8 `Int32` before reading the entity.

`SetTransmitState(Entity, nTransmitState)` and `ClearTransmitState(Entity)` also preserve `Index` getter exceptions without mutation or notification. `SetTransmitState()` resolves the entity first, then requires a V8 `Int32` equal to one of the four supported modes; numeric strings, booleans, fractional numbers, `BigInt`, and overflowing values are not coerced. Both functions retain existing non-transmit bits and add the SDK's changed/full-changed markers.

Native C++ failures become `Error` without replacing an already pending JavaScript exception, including one captured while resolving `Index`. Mutators are not transactions: a failure in the SDK change notification can occur after the native flag word has already changed.

Unavailable mutators are omitted. A cross-SDK plugin can branch on the actual function it needs:

```js
const { Entity } = require("entities/entity");
const {
	ALWAYS,
	GetTransmitStateFlags,
	SetTransmitState,
	SetTransmitStateFlags,
} = require("entities/transmit");
const { LogInfo } = require("loggers");

const g_LogForcedEntity = function LogForcedEntity(EntityValue) {
	LogInfo("LogForcedEntity EntityIndex=%d", EntityValue.Index);
};

const g_WithForcedEntityTransmission = function WithForcedEntityTransmission(nEntityIndex, Callback) {
	if ((typeof SetTransmitStateFlags !== "function") || (typeof SetTransmitState !== "function")) {
		throw new Error("The selected SDK does not expose mutable edict transmit state.");
	}

	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	if (!EntityValue.Valid || (typeof Callback !== "function")) {
		throw new TypeError("Temporary transmission requires a live Entity and a synchronous callback.");
	}

	const nEntityHandleValue = EntityValue.HandleValue;
	const nEntityNetworkSerialNumber = EntityValue.NetworkSerialNumber;
	if (!Number.isInteger(nEntityHandleValue) || !Number.isInteger(nEntityNetworkSerialNumber)) {
		throw new TypeError("The live Entity must expose its handle and network serial number.");
	}

	const nPreviousEntityStateFlags = GetTransmitStateFlags(EntityValue);

	try {
		if (!SetTransmitState(EntityValue, ALWAYS)) {
			throw new Error("The temporary transmit-state write failed.");
		}

		return Callback(EntityValue);
	} finally {
		if (EntityValue.Valid && (EntityValue.HandleValue === nEntityHandleValue) && (EntityValue.NetworkSerialNumber === nEntityNetworkSerialNumber)) {
			if (!SetTransmitStateFlags(EntityValue, nPreviousEntityStateFlags)) {
				throw new Error("The original edict state flags could not be restored.");
			}
		}
	}
};

const g_RunForcedEntityTransmissionExample = function RunForcedEntityTransmissionExample() {
	const nEntityIndex = 1;
	g_WithForcedEntityTransmission(nEntityIndex, g_LogForcedEntity);
};

g_RunForcedEntityTransmissionExample();
```

The callback helpers in this reference require a live `Entity` object with integer `HandleValue` and `NetworkSerialNumber`, and invoke callbacks synchronously without awaiting results. Do not pass asynchronous callbacks or retain borrowed state beyond the call. Restoration on return or exception is skipped if the entity is invalid or either saved identity field differs, preventing writes through a wrapper whose index now identifies a replacement. These finite-generation checks are not permanent lifetime pins. In real plugin code, retain enough information to restore the prior transmit mode before unload. The focused function above passes the captured flags back through `SetTransmitStateFlags()`, which also re-adds the engine's changed/full-changed markers; the workflows below show the safer mode-only pattern.

Keep the initial write inside `try`: its change notification can throw after committing the flag word. Both `g_WithForcedEntityTransmission()` and `g_WithEntityTransmitState()` then attempt restoration in `finally` even if the initial write throws, provided the saved identity still matches. Restoration is best-effort, not a transaction; if it also throws, that cleanup error takes precedence over the initial error, callback exception, or callback result.

## State model

`GetTransmitStateFlags()` returns the entire `edict_t::m_fStateFlags` word, not only its three real transmit bits. The word can also contain engine-owned state such as changed, free/full-edict, dormant/PVS-dirty, and full-change markers.

The transmission mask is:

```js
const { Entity } = require("entities/entity");
const {
	ALWAYS,
	DONT_SEND,
	FULL_CHECK,
	GetTransmitStateFlags,
	PVS_CHECK,
} = require("entities/transmit");
const { LogInfo } = require("loggers");

const g_nEntityTransmitStateMask = ALWAYS | DONT_SEND | PVS_CHECK;

const g_GetEntityTransmitState = function GetEntityTransmitState(nEntityStateFlags) {
	const nEntityTransmitState = nEntityStateFlags & g_nEntityTransmitStateMask;
	switch (nEntityTransmitState) {
		case FULL_CHECK:
			return FULL_CHECK;

		case ALWAYS:
			return ALWAYS;

		case DONT_SEND:
			return DONT_SEND;

		case PVS_CHECK:
			return PVS_CHECK;

		default:
			throw new Error(`Edict has conflicting transmit bits: ${nEntityTransmitState}.`);
	}
};

const g_InspectCurrentEntityTransmitState = function InspectCurrentEntityTransmitState(nEntityIndex) {
	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const nEntityStateFlags = GetTransmitStateFlags(EntityValue);
	const nEntityTransmitState = g_GetEntityTransmitState(nEntityStateFlags);
	LogInfo("InspectCurrentEntityTransmitState Result=%j", { EntityStateFlags: nEntityStateFlags, EntityTransmitState: nEntityTransmitState, EntityTransmitStateMask: g_nEntityTransmitStateMask });
};

const g_RunCurrentEntityTransmitStateExample = function RunCurrentEntityTransmitStateExample() {
	const nEntityIndex = 1;
	g_InspectCurrentEntityTransmitState(nEntityIndex);
};

g_RunCurrentEntityTransmitStateExample();
```

`FULL_CHECK` is a zero-valued state constant rather than a set bit. It means none of the three nonzero transmit bits is selected, so the game DLL's `ShouldTransmit()` decision is evaluated normally. Do not test it with `nEntityStateFlags & FULL_CHECK`; mask the three nonzero states and compare the result with zero.

## Constants

| Constant | HL2SDK identifier | Meaning |
| --- | --- | --- |
| `FULL_CHECK` | `FL_EDICT_FULLCHECK` | Call the game DLL transmit decision for each client. This value is zero. |
| `ALWAYS` | `FL_EDICT_ALWAYS` | Consider the entity for every client without normal `ShouldTransmit()` filtering. |
| `DONT_SEND` | `FL_EDICT_DONTSEND` | Do not transmit the entity. |
| `PVS_CHECK` | `FL_EDICT_PVSCHECK` | Consider the entity but cull it against the client's potentially visible set. |

Use one state at a time. `SetTransmitState()` enforces this rule; `SetTransmitStateFlags()` does not.

## Reading flags

### `GetTransmitStateFlags(Entity)`

Returns the current signed 32-bit `m_fStateFlags` value for a live edict.

`Entity` accepts an `Int32` entity index, an object with an integer `Index` such as a live Entity object, or a non-negative `bigint` address within `uintptr_t` range that resolves to a live `edict_t*` or `CBaseEntity*`. An `Int32` Number is always resolved as an index; other Number values are not address inputs. Prefer a live Entity object because it keeps index intent and ownership clear.

```js
const { Entity } = require("entities/entity");
const {
	ALWAYS,
	DONT_SEND,
	GetTransmitStateFlags,
	PVS_CHECK,
} = require("entities/transmit");
const { LogInfo } = require("loggers");

const g_InspectEntityTransmissionByIndex = function InspectEntityTransmissionByIndex(nEntityIndex) {
	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const nEntityStateFlags = GetTransmitStateFlags(EntityValue);

	return { Always: (nEntityStateFlags & ALWAYS) !== 0, DoNotSend: (nEntityStateFlags & DONT_SEND) !== 0, PVSCheck: (nEntityStateFlags & PVS_CHECK) !== 0, EntityStateFlags: nEntityStateFlags };
};

const g_RunEntityTransmissionInspectionExample = function RunEntityTransmissionInspectionExample() {
	const nEntityIndex = 1;
	LogInfo("InspectEntityTransmission Result=%j", g_InspectEntityTransmissionByIndex(nEntityIndex));
};

g_RunEntityTransmissionInspectionExample();
```

The value is a real-time read. SourceJS does not cache it.

## Changing the transmit mode

### `SetTransmitState(Entity, nTransmitState)`

Selects exactly one of `FULL_CHECK`, `ALWAYS`, `DONT_SEND`, or `PVS_CHECK`.

The native operation:

1. resolves a current live edict;
2. validates the state as an exact integer constant;
3. clears `ALWAYS`, `DONT_SEND`, and `PVS_CHECK`;
4. sets the requested nonzero bit;
5. marks the edict changed and, when the engine interface and current index are available, asks `IVEngineServer` to refresh its edict flags.

It returns `true`. This is a global edict policy, not a per-client visibility filter.

```js
const { Entity } = require("entities/entity");
const {
	ALWAYS,
	DONT_SEND,
	FULL_CHECK,
	GetTransmitStateFlags,
	PVS_CHECK,
	SetTransmitState,
} = require("entities/transmit");
const { LogInfo } = require("loggers");

const g_nEntityTransmitStateMask = ALWAYS | DONT_SEND | PVS_CHECK;

const g_GetCurrentEntityTransmitState = function GetCurrentEntityTransmitState(EntityValue) {
	const nEntityStateFlags = GetTransmitStateFlags(EntityValue);
	const nEntityTransmitState = nEntityStateFlags & g_nEntityTransmitStateMask;
	switch (nEntityTransmitState) {
		case FULL_CHECK:
			return FULL_CHECK;

		case ALWAYS:
			return ALWAYS;

		case DONT_SEND:
			return DONT_SEND;

		case PVS_CHECK:
			return PVS_CHECK;

		default:
			throw new Error(`Edict has conflicting transmit bits: ${nEntityTransmitState}.`);
	}
};

const g_WithEntityTransmitState = function WithEntityTransmitState(EntityValue, nEntityTransmitState, Callback) {
	if ((EntityValue === null) || (typeof EntityValue !== "object") || !EntityValue.Valid || (typeof Callback !== "function")) {
		throw new TypeError("Temporary transmission requires a live Entity and a synchronous callback.");
	}

	const nEntityHandleValue = EntityValue.HandleValue;
	const nEntityNetworkSerialNumber = EntityValue.NetworkSerialNumber;
	if (!Number.isInteger(nEntityHandleValue) || !Number.isInteger(nEntityNetworkSerialNumber)) {
		throw new TypeError("The live Entity must expose its handle and network serial number.");
	}

	const nPreviousEntityTransmitState = g_GetCurrentEntityTransmitState(EntityValue);

	try {
		if (!SetTransmitState(EntityValue, nEntityTransmitState)) {
			throw new Error("The temporary transmit-state write failed.");
		}

		return Callback(EntityValue);
	} finally {
		if (EntityValue.Valid && (EntityValue.HandleValue === nEntityHandleValue) && (EntityValue.NetworkSerialNumber === nEntityNetworkSerialNumber)) {
			if (!SetTransmitState(EntityValue, nPreviousEntityTransmitState)) {
				throw new Error("The previous transmit state could not be restored.");
			}
		}
	}
};

const g_VerifyTemporaryAlwaysTransmitState = function VerifyTemporaryAlwaysTransmitState() {
	const nEntityIndex = 1;

	if (typeof SetTransmitState !== "function") {
		throw new Error("The selected SDK does not expose mutable edict transmit state.");
	}

	const ObjectiveEntity = Entity(nEntityIndex);
	if (ObjectiveEntity === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const VerifyAlwaysTransmitState = function VerifyAlwaysTransmitState(EntityValue) {
		if (g_GetCurrentEntityTransmitState(EntityValue) !== ALWAYS) {
			throw new Error("The entity did not enter ALWAYS transmit mode.");
		}

		LogInfo("VerifyAlwaysTransmitState EntityIndex=%d", EntityValue.Index);
	};

	g_WithEntityTransmitState(ObjectiveEntity, ALWAYS, VerifyAlwaysTransmitState);
};

g_VerifyTemporaryAlwaysTransmitState();
```

`ALWAYS` can increase bandwidth substantially. Use it for short-lived entities whose global visibility is intentional, then restore the previous mode.

The next example demonstrates temporary suppression and restoration. In a real plugin, place the short server-side operation inside the `try` block:

```js
const { Entity } = require("entities/entity");
const {
	ALWAYS,
	DONT_SEND,
	FULL_CHECK,
	GetTransmitStateFlags,
	PVS_CHECK,
	SetTransmitState,
} = require("entities/transmit");
const { LogInfo } = require("loggers");

const g_nEntityTransmitStateMask = ALWAYS | DONT_SEND | PVS_CHECK;

const g_GetEntityTransmitStateFromFlags = function GetEntityTransmitStateFromFlags(nEntityStateFlags) {
	const nEntityTransmitState = nEntityStateFlags & g_nEntityTransmitStateMask;
	switch (nEntityTransmitState) {
		case FULL_CHECK:
			return FULL_CHECK;

		case ALWAYS:
			return ALWAYS;

		case DONT_SEND:
			return DONT_SEND;

		case PVS_CHECK:
			return PVS_CHECK;

		default:
			throw new Error(`Edict has conflicting transmit bits: ${nEntityTransmitState}.`);
	}
};

const g_SuppressEntityDuringServerStateUpdate = function SuppressEntityDuringServerStateUpdate() {
	const nEntityIndex = 1;

	if (typeof SetTransmitState !== "function") {
		throw new Error("The selected SDK does not expose mutable edict transmit state.");
	}

	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const nEntityStateFlags = GetTransmitStateFlags(EntityValue);
	const nPreviousEntityTransmitState = g_GetEntityTransmitStateFromFlags(nEntityStateFlags);
	const nEntityHandleValue = EntityValue.HandleValue;
	const nEntityNetworkSerialNumber = EntityValue.NetworkSerialNumber;
	if (!EntityValue.Valid || !Number.isInteger(nEntityHandleValue) || !Number.isInteger(nEntityNetworkSerialNumber)) {
		throw new TypeError("Temporary transmission requires a live Entity with handle and network serial identity.");
	}

	try {
		if (!SetTransmitState(EntityValue, DONT_SEND)) {
			throw new Error("The temporary DONT_SEND write failed.");
		}

		LogInfo("SuppressEntityDuringServerStateUpdate EntityIndex=%d", EntityValue.Index);
	} finally {
		if (EntityValue.Valid && (EntityValue.HandleValue === nEntityHandleValue) && (EntityValue.NetworkSerialNumber === nEntityNetworkSerialNumber)) {
			if (!SetTransmitState(EntityValue, nPreviousEntityTransmitState)) {
				throw new Error("The previous transmit state could not be restored.");
			}
		}
	}
};

g_SuppressEntityDuringServerStateUpdate();
```

Do not use this as an access-control boundary: the state affects networking, not entity existence or server-side interaction.

## Clearing the transmit mode

### `ClearTransmitState(Entity)`

Clears `ALWAYS`, `DONT_SEND`, and `PVS_CHECK` without clearing existing non-transmit flags. The resulting mode is `FULL_CHECK`, and the SDK's changed/full-changed markers are added. The engine is notified when its interface and the current index are available.

```js
const { Entity } = require("entities/entity");
const {
	ALWAYS,
	ClearTransmitState,
	DONT_SEND,
	FULL_CHECK,
	GetTransmitStateFlags,
	PVS_CHECK,
	SetTransmitState,
} = require("entities/transmit");

const g_nEntityTransmitStateMask = ALWAYS | DONT_SEND | PVS_CHECK;

const g_GetEntityTransmitStateFromFlags = function GetEntityTransmitStateFromFlags(nEntityStateFlags) {
	const nEntityTransmitState = nEntityStateFlags & g_nEntityTransmitStateMask;
	switch (nEntityTransmitState) {
		case FULL_CHECK:
			return FULL_CHECK;

		case ALWAYS:
			return ALWAYS;

		case DONT_SEND:
			return DONT_SEND;

		case PVS_CHECK:
			return PVS_CHECK;

		default:
			throw new Error(`Edict has conflicting transmit bits: ${nEntityTransmitState}.`);
	}
};

const g_VerifyClearTransmitState = function VerifyClearTransmitState() {
	const nEntityIndex = 1;

	if ((typeof ClearTransmitState !== "function") || (typeof SetTransmitState !== "function")) {
		throw new Error("The selected SDK does not expose mutable edict transmit state.");
	}

	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const nPreviousEntityStateFlags = GetTransmitStateFlags(EntityValue);
	const nPreviousEntityTransmitState = g_GetEntityTransmitStateFromFlags(nPreviousEntityStateFlags);
	const nEntityHandleValue = EntityValue.HandleValue;
	const nEntityNetworkSerialNumber = EntityValue.NetworkSerialNumber;
	if (!EntityValue.Valid || !Number.isInteger(nEntityHandleValue) || !Number.isInteger(nEntityNetworkSerialNumber)) {
		throw new TypeError("Temporary transmission requires a live Entity with handle and network serial identity.");
	}

	try {
		if (!SetTransmitState(EntityValue, PVS_CHECK)) {
			throw new Error("The temporary PVS_CHECK write failed.");
		}

		if (!ClearTransmitState(EntityValue)) {
			throw new Error("Clearing the transmit state failed.");
		}

		if ((GetTransmitStateFlags(EntityValue) & g_nEntityTransmitStateMask) !== FULL_CHECK) {
			throw new Error("The edict did not return to FULL_CHECK mode.");
		}
	} finally {
		if (EntityValue.Valid && (EntityValue.HandleValue === nEntityHandleValue) && (EntityValue.NetworkSerialNumber === nEntityNetworkSerialNumber)) {
			if (!SetTransmitState(EntityValue, nPreviousEntityTransmitState)) {
				throw new Error("The previous transmit state could not be restored.");
			}
		}
	}
};

g_VerifyClearTransmitState();
```

Because `FULL_CHECK` is zero, `ClearTransmitState(EntityValue)` and `SetTransmitState(EntityValue, FULL_CHECK)` select the same transmission mode.

## Replacing state flags

### `SetTransmitStateFlags(Entity, nStateFlags)`

Replaces the complete signed 32-bit `m_fStateFlags` word, then adds the engine changed/full-changed markers and notifies `IVEngineServer` when the interface and current index are available. It returns `true`.

This function is intentionally lower-level than `SetTransmitState()`. A careless value can erase engine-owned `FL_EDICT_FULL`, dirty-PVS, dormant, or change-tracking bits. Use it only when you have reviewed the selected SDK's `edict.h` and preserve every unrelated bit.

```js
const { Entity } = require("entities/entity");
const {
	ALWAYS,
	DONT_SEND,
	GetTransmitStateFlags,
	PVS_CHECK,
	SetTransmitStateFlags,
} = require("entities/transmit");
const { LogInfo } = require("loggers");

const g_nEntityTransmitStateMask = ALWAYS | DONT_SEND | PVS_CHECK;

const g_WithEntityPVSCheck = function WithEntityPVSCheck(EntityValue, Callback) {
	if ((EntityValue === null) || (typeof EntityValue !== "object") || !EntityValue.Valid || (typeof Callback !== "function")) {
		throw new TypeError("Temporary transmission requires a live Entity and a synchronous callback.");
	}

	const nEntityHandleValue = EntityValue.HandleValue;
	const nEntityNetworkSerialNumber = EntityValue.NetworkSerialNumber;
	if (!Number.isInteger(nEntityHandleValue) || !Number.isInteger(nEntityNetworkSerialNumber)) {
		throw new TypeError("The live Entity must expose its handle and network serial number.");
	}

	const nPreviousEntityStateFlags = GetTransmitStateFlags(EntityValue);
	const nPVSCheckEntityStateFlags = (nPreviousEntityStateFlags & ~g_nEntityTransmitStateMask) | PVS_CHECK;

	try {
		if (!SetTransmitStateFlags(EntityValue, nPVSCheckEntityStateFlags)) {
			throw new Error("The temporary edict flag write failed.");
		}

		return Callback(GetTransmitStateFlags(EntityValue));
	} finally {
		if (EntityValue.Valid && (EntityValue.HandleValue === nEntityHandleValue) && (EntityValue.NetworkSerialNumber === nEntityNetworkSerialNumber)) {
			if (!SetTransmitStateFlags(EntityValue, nPreviousEntityStateFlags)) {
				throw new Error("The original edict state flags could not be restored.");
			}
		}
	}
};

const g_VerifyCompleteEntityStateFlagWrite = function VerifyCompleteEntityStateFlagWrite() {
	const nEntityIndex = 1;

	if (typeof SetTransmitStateFlags !== "function") {
		throw new Error("The selected SDK does not expose complete edict flag writes.");
	}

	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const VerifyPVSCheck = function VerifyPVSCheck(nEntityStateFlags) {
		if ((nEntityStateFlags & g_nEntityTransmitStateMask) !== PVS_CHECK) {
			throw new Error("The complete flag write did not select PVS_CHECK mode.");
		}

		LogInfo("VerifyCompleteEntityStateFlagWrite Result=%j", { EntityStateFlags: nEntityStateFlags });
	};

	g_WithEntityPVSCheck(EntityValue, VerifyPVSCheck);
};

g_VerifyCompleteEntityStateFlagWrite();
```

All `With...` helpers in these examples invoke callbacks synchronously and do not await Promise results. Do not pass asynchronous callbacks: restoration is attempted on immediate return or exception, before any returned Promise settles, and only while the entity is valid and its saved handle and network serial still match. Restoring a previous word still adds the changed markers. The engine notification occurs only when its interface and the current edict index are available.

The PVS helper keeps its first write inside `try`, so a notification error after flag commit still triggers an identity-checked restoration attempt. A restoration error takes precedence over an earlier failure or callback result. The standalone suppression and clear examples also guard restoration with saved identity fields; none of these checks pins the entity or makes a sequence of native calls transactional.

`g_WithEntityPVSCheck()` restores the captured complete word, so it can overwrite non-transmit changes made during the callback. Prefer a mode-only helper when those current bits must survive.

## Practical workflows

### Choosing a mode

| Goal | Preferred operation |
| --- | --- |
| Return control to game DLL `ShouldTransmit()` | `SetTransmitState(Entity, FULL_CHECK)` or `ClearTransmitState(Entity)` |
| Make a short-lived global network entity | `SetTransmitState(Entity, ALWAYS)` with deterministic restoration |
| Stop transmitting an entity globally | `SetTransmitState(Entity, DONT_SEND)` with deterministic restoration |
| Use normal PVS culling without a full per-client check | `SetTransmitState(Entity, PVS_CHECK)` |
| Preserve non-transmit edict bits while changing one mode | `SetTransmitState()`; it already clears only the transmit mask |
| Replace the entire reviewed edict flag word | `SetTransmitStateFlags()` only after inspecting the selected SDK |

### Plugin unload

SourceJS does not automatically restore an edict mode changed by a plugin. Save a serial-aware entity handle or the entity's handle value and network serial, then revalidate the current entity against that snapshot before each restoration. Prefer restoring only the transmit mode, preserving current non-transmit bits. Skip restoration if the entity has been freed or replaced; a live wrapper by itself is not identity proof. Handle generations are finite, not permanent lifetime pins, so do not retain restoration state across expired engine lifetimes.

### Per-client decisions

This module does not implement a per-client transmit hook. All mutators change the shared edict state. Do not present `DONT_SEND` or `ALWAYS` as a player-specific visibility rule.

## Errors and lifetime

- Missing, removed, free, or otherwise invalid entities throw.
- `SetTransmitStateFlags()` requires a V8 `Int32`; strings, booleans, `bigint`, and fractional values are rejected.
- `SetTransmitState()` accepts only the four exported state constants. Arbitrary bit combinations throw.
- Mutators are absent on SDK branches that do not expose the required edict mutation contract.
- Game DLL code may recalculate the state later. Treat these operations as live engine writes, not permanent configuration.
- Do not retain an Entity object solely for later restoration without handling entity deletion and index reuse.

## Related modules

- [`entities/entity`](entities-entity.md): create and resolve Entity values by their current index without pinning native lifetime.
- [`entities/props`](entities-props.md): read and write networked entity properties.
- [`entities/outputs`](entities-outputs.md): attach and invoke entity output handlers.
- [`entities/constants`](entities-constants.md): documents other entity and edict-related selected-SDK constants.
- [`engines/server`](engines-server.md): exposes server/client and selected-SDK transmission inspection operations.
- [`listeners`](listeners.md): supports plugin lifecycle handling; restore while the edict is still live, and discard stale restoration state on level shutdown or unload.
