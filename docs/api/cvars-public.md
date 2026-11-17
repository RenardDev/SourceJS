# `require("cvars/public")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Registration options](#registration-options)
- [`PublicConVarRegistration`](#publicconvarregistration)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

[`packages/sourcejs/cvars/public.js`](../../packages/sourcejs/cvars/public.js) extends the native `cvars/public` module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp).

Use this module to mark ConVars with the selected SDK's notification flag and track registrations in a module-instance map. A registration remembers the previous value and public state for explicit restoration attempts; it does not own the native variable, guarantee exclusive access, or provide transactional rollback. Destroying the JavaScript context alone does not unregister a native ConVar or restore its flags.

## Import

```js
const { GetPublicConVars, RegisterPublicConVar, UnregisterPublicConVar } = require("cvars/public");
```

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| [`NOTIFY`](#notify) | Constant | Selected SDK `FCVAR_NOTIFY` integer when the branch defines it. |
| [`GetPublicConVarConstant`](#getpublicconvarconstantstrflagname) | `GetPublicConVarConstant(strFlagName)` | Finite Number property read from the call receiver; the native constant export is `NOTIFY` when available. Requires a non-empty primitive string name and rejects nullish, non-numeric, or non-finite values; does not verify native provenance. |
| [`FindConVar`](#findconvarstrconvarname) | `FindConVar(strConVarName)` | Live ConVar object or `{ Exists: false }`. |
| [`SetConVarPublic`](#setconvarpublicstrconvarname-benabled) | `SetConVarPublic(strConVarName, bEnabled?)` | `true` after requesting the native flag state, including an already-set state. Throws for a missing ConVar, missing SDK `FCVAR_NOTIFY`, or unsupported removal. Nullish enabled values default to `true`; other values use JavaScript truthiness. |
| [`IsConVarPublic`](#isconvarpublicstrconvarname) | `IsConVarPublic(strConVarName)` | Whether the ConVar exists and has `NOTIFY`; missing names return `false` on supported SDKs. Throws if the SDK lacks `FCVAR_NOTIFY`. |
| [`GetPublicConVarRegistration`](#getpublicconvarregistrationstrconvarname) | `GetPublicConVarRegistration(strConVarName)` | Managed registration or `null`. |
| [`GetPublicConVarRegistrationRecords`](#getpublicconvarregistrationrecords) | `GetPublicConVarRegistrationRecords()` | Live `Map` values iterator over this module instance's managed registrations, not a snapshot or an owner-filtered result. |
| [`GetPublicConVars`](#getpublicconvars) | `GetPublicConVars()` | Array of engine registry records filtered to existing non-command entries with `NOTIFY`; not limited to managed registrations. Registry enumeration or public-state checks may throw. |
| [`PublicConVarRegistration`](#publicconvarregistration-1) | Class | Registration returned by `RegisterPublicConVar`. |
| [`RegisterPublicConVar`](#registerpublicconvarstrconvarname-value--0-description---options--) | `RegisterPublicConVar(strConVarName, Value = "0", Description = "", Options = {})` | New managed registration; forwards value and description without package-level string conversion. |
| [`UnregisterPublicConVar`](#unregisterpublicconvarstrconvarname-brestoreconvar--true) | `UnregisterPublicConVar(strConVarName, bRestoreConVar = true)` | Whether a managed registration was removed. |

`NOTIFY` through `IsConVarPublic` are the exact native exports installed by `ModuleBindings.cpp`. The remaining six exports are added to that same object by the JavaScript wrapper.

The four native functions translate C++ exceptions into contextual JavaScript errors without exposing exception text. `FindConVar` checks result construction before returning a wrapper, preserving an existing JavaScript exception or reporting construction failure, including when a C++ failure occurs during construction. These checks do not extend borrowed native lifetimes or roll back completed native flag changes.

`FindConVar`, `SetConVarPublic`, and `IsConVarPublic` require primitive string names, preserve their complete UTF-8 bytes without trimming or case normalization, and reject embedded NUL characters or encoding failure before SDK lookup or flag changes. Earlier argument, interface and context errors keep their precedence. On SDKs without `FCVAR_NOTIFY`, `SetConVarPublic` and `IsConVarPublic` report feature unavailability before argument or name validation; `FindConVar` remains available. The managed registration functions validate and normalize their own names before reaching this boundary.

## Registration options

`RegisterPublicConVar` accepts these optional fields:

| Option | Type | Meaning |
| --- | --- | --- |
| `Flags` | `number` | Public key for the initial signed 32-bit native ConVar flags; nullish values default to `0`. |
| `MinimumValue` | `number \| null` | Optional minimum for a new ConVar; nullish values omit the bound. |
| `MaximumValue` | `number \| null` | Optional maximum for a new ConVar; nullish values omit the bound. |

Managed registration names must be non-empty strings without NUL bytes and are trimmed. `RegisterPublicConVar`, `GetPublicConVarRegistration`, and the module-level `UnregisterPublicConVar` reject invalid names before native calls or map changes. A name already present in this module instance's registration map is rejected. Options must be a non-null, non-array object; omitting them uses `{}`.

Registry keys retain the trimmed requested spelling and are case-sensitive JavaScript map keys; the package does not resolve aliases or fold case. A registration's `Name` is copied separately from the returned native object and may differ from its lookup key. Instance cleanup locates that exact registration by identity, not by the native name, without another native lookup. It scans the managed map; a stale or directly constructed instance cannot delete a different registration. Optional restoration still occurs before this check and may change native state, so do not reuse stale instances for cleanup.

Creation flags, description, and bounds do not replace those of an existing ConVar. Registration still sets its value and enables `NOTIFY`. For a new ConVar, supplied bounds must be finite and fit a native float; validate their ordering yourself.

Registration is not transactional: native mutations occur before the registration enters the map, with no rollback if a later step fails. A `false` result from `SetConVar` or `SetConVarPublic` throws a contextual `Error` without adding a managed registration; a failed value write also skips the public-flag write. Native exceptions propagate unchanged. Do not treat a missing registration record after failure as proof that the engine state was unchanged: creation or an earlier value write may already have succeeded. A later registration attempt can retry the name.

## `PublicConVarRegistration`

Registrations returned by `RegisterPublicConVar()` expose these read-only getter properties:

| Property | Meaning |
| --- | --- |
| `ConVar` | Live native ConVar object. |
| `Name` | Name copied from the returned native ConVar object. |
| `OriginallyExisted` | Whether the ConVar existed before registration. |
| `OriginalValue` | Previous string value, or `null`. |
| `OriginallyPublic` | Previous `NOTIFY` state. |

| Method | Signature | Meaning |
| --- | --- | --- |
| [`RestoreOriginalConVarState`](#publicconvarregistrationrestoreoriginalconvarstate) | `RestoreOriginalConVarState()` | Restore the saved value for a pre-existing ConVar, then its saved public state. For a newly created ConVar, request non-public state without resetting its value. Returns a boolean; native errors may throw. Does not remove the registration. |
| [`UnregisterPublicConVar`](#publicconvarregistrationunregisterpublicconvarbrestoreconvar--true) | `UnregisterPublicConVar(bRestoreConVar = true)` | Requires a boolean. Optionally restore state, then remove the map entry for this exact registration instance; returns `false` if restoration returns `false` or the instance is no longer managed. Native errors may throw. |

This API does not delete the native ConVar. On SDK branches with flag-removal support, restoring a newly created public ConVar clears its public flag but leaves the variable registered; unsupported removal throws. Restoration can partially succeed: restoring the value precedes restoring the public flag.

The current wrapper deletes registrations by name, not object identity. Do not reuse a stale registration object after its name has been registered again: it can restore old state and delete the newer registration. Do not modify the wrapper's backing state or shadow its read-only properties. `ConVar` is a borrowed live object; read-only property access does not make its native contents immutable.

## Examples

### `NOTIFY`

Check availability, then compare the two modules' `NOTIFY` values. On unmodified modules both exports come from `FCVAR_NOTIFY`; equality alone does not validate their type or prove that neither module was modified:

```js
const g_PublicCVarsModule = require("cvars/public");
const g_CVarFlagsModule = require("cvars/flags");

if (!Object.prototype.hasOwnProperty.call(g_PublicCVarsModule, "NOTIFY") || !Object.prototype.hasOwnProperty.call(g_CVarFlagsModule, "NOTIFY")) {
	console.log("The selected SDK does not expose FCVAR_NOTIFY.");
} else if (g_PublicCVarsModule.NOTIFY !== g_CVarFlagsModule.NOTIFY) {
	throw new Error("The selected SDK exposed inconsistent FCVAR_NOTIFY values.");
}
```

### `RegisterPublicConVar(strConVarName, Value = "0", Description = "", Options = {})`

Register a public ConVar with optional bounds, then attempt restoration and map-entry removal through explicit cleanup:

```js
const { GAME_DLL } = require("cvars/flags");
const { NOTIFY, RegisterPublicConVar } = require("cvars/public");

if (!Number.isInteger(GAME_DLL) || !Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose the required public ConVar flags.");
}

const g_EventIntensityRegistration = RegisterPublicConVar("sjs_event_intensity", "1.0", "Public SourceJS event intensity multiplier.", { Flags: GAME_DLL, MinimumValue: 0.0, MaximumValue: 5.0 });

try {
	g_EventIntensityRegistration.ConVar.FloatValue = 1.5;
	console.log(`Event intensity: ${g_EventIntensityRegistration.ConVar.FloatValue}`);
} finally {
	if (!g_EventIntensityRegistration.UnregisterPublicConVar(true)) {
		throw new Error("sjs_event_intensity registration cleanup failed.");
	}
}
```

For a newly created ConVar, `UnregisterPublicConVar(true)` removes the public flag and removes only the JavaScript registration record. Restoring that state requires an SDK branch with flag-removal support; otherwise cleanup throws.

Use an exclusively owned name and an SDK with native creation support when the name is missing and flag-removal support for cleanup. Existing ConVars keep their original bounds, so the logged value may be clamped. Registration failures occur before the `try` block and may leave native changes behind; cleanup failures can mask the error that triggered `finally`.

### `PublicConVarRegistration`

Use the exported class for type checks; obtain normal instances from `RegisterPublicConVar()` so they are tracked correctly:

```js
const { NOTIFY, PublicConVarRegistration, RegisterPublicConVar } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_Registration = RegisterPublicConVar("sjs_public_status", "ready", "Current SourceJS service status.");

try {
	if (!(g_Registration instanceof PublicConVarRegistration)) {
		throw new Error("RegisterPublicConVar() returned an invalid public ConVar registration.");
	}
} finally {
	if (!g_Registration.UnregisterPublicConVar(true)) {
		throw new Error("sjs_public_status registration cleanup failed.");
	}
}
```

Direct construction takes a live ConVar object and three saved-state arguments: whether it existed, its original string value, and whether it was public. It does not insert the instance into the managed registry or acquire ownership of the native ConVar. Prefer `RegisterPublicConVar()` for managed use.

This cleanup example requires flag-removal support when the ConVar was not already public; a missing ConVar name also requires native creation support.

### `FindConVar(strConVarName)`

Look up the live ConVar first, then test its public state separately:

```js
const { NOTIFY, FindConVar, IsConVarPublic } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_HostNameConVar = FindConVar("hostname");
if (g_HostNameConVar.Exists) {
	console.log(`hostname=${g_HostNameConVar.Value}, public=${IsConVarPublic(g_HostNameConVar.Name)}`);
}
```

`FindConVar()` does not filter by `NOTIFY`; it mirrors the native ConVar lookup.

### `IsConVarPublic(strConVarName)`

Require a public variable as a plugin precondition:

```js
const { NOTIFY, IsConVarPublic } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

if (!IsConVarPublic("hostname")) {
	throw new Error("hostname must be public before this plugin can start.");
}
```

Missing ConVars return `false` when the SDK supports `FCVAR_NOTIFY`; a branch without that flag throws instead.

### `SetConVarPublic(strConVarName, bEnabled?)`

On an SDK branch known to support flag removal, temporarily publish changes to an existing shared ConVar and attempt to restore its previous value and public flag. This is not a transaction: callbacks can observe intermediate states, restoration can fail, and other changes can be overwritten:

```js
const { GetConVar, SetConVar } = require("cvars");
const { NOTIFY, SetConVarPublic, IsConVarPublic } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_strPreviousHostName = GetConVar("hostname");
if (g_strPreviousHostName === null) {
	throw new Error("hostname is required by this plugin.");
}

const g_bWasHostNamePublic = IsConVarPublic("hostname");

try {
	if (!SetConVarPublic("hostname", true)) {
		throw new Error("Unable to make hostname public.");
	}

	if (!SetConVar("hostname", "SourceJS public event server")) {
		throw new Error("Unable to apply the temporary public hostname.");
	}

	if (!IsConVarPublic("hostname") || (GetConVar("hostname") !== "SourceJS public event server")) {
		throw new Error("The temporary public hostname was not applied.");
	}
} finally {
	try {
		if (!SetConVar("hostname", g_strPreviousHostName)) {
			throw new Error("Unable to restore the original hostname.");
		}
	} finally {
		if (!SetConVarPublic("hostname", g_bWasHostNamePublic)) {
			throw new Error("Unable to restore the original hostname public state.");
		}
	}
}
```

`SetConVarPublic()` throws when the ConVar is missing. `SetConVarPublic(strConVarName, false)` also throws when the selected SDK lacks flag-removal support, even if the notification flag is already clear: the native helper receives the nonzero `FCVAR_NOTIFY` mask rather than only the currently set bits.

### `GetPublicConVars()`

Build a name-only administrative report from currently public engine ConVars. `NOTIFY` is not a guarantee that a value is safe to log; this example omits values:

```js
const { NOTIFY, GetPublicConVars } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

function CreatePublicConVarRecord(PublicConVar) {
	return { Name: PublicConVar.Name };
}

function ComparePublicConVarRecords(LeftPublicConVarRecord, RightPublicConVarRecord) {
	return LeftPublicConVarRecord.Name.localeCompare(RightPublicConVarRecord.Name);
}

const g_vecPublicConVarRecords = GetPublicConVars().map(CreatePublicConVarRecord).sort(ComparePublicConVarRecords);
console.log(g_vecPublicConVarRecords);
```

This list includes engine-owned public ConVars and public variables created by plugins; it is not an ownership filter.

### `GetPublicConVarRegistration(strConVarName)`

On an SDK branch known to support flag removal, look up a registration and verify that it is the same object this example created. Lookup alone is not proof of plugin ownership; it searches this module instance's map:

```js
const { NOTIFY, GetPublicConVarRegistration, RegisterPublicConVar } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_MatchPhaseRegistration = RegisterPublicConVar("sjs_match_phase", "warmup", "Current managed match phase.");

try {
	const LookupRegistration = GetPublicConVarRegistration("sjs_match_phase");
	if (LookupRegistration !== g_MatchPhaseRegistration) {
		throw new Error("sjs_match_phase no longer refers to this example's registration.");
	}

	LookupRegistration.ConVar.Value = "live";
} finally {
	if ((GetPublicConVarRegistration("sjs_match_phase") === g_MatchPhaseRegistration) && !g_MatchPhaseRegistration.UnregisterPublicConVar(true)) {
		throw new Error("sjs_match_phase registration cleanup failed.");
	}
}
```

### `GetPublicConVarRegistrationRecords()`

On an SDK branch known to support flag removal, copy the names from this module instance's registration map into a sorted snapshot. Use names exclusively managed by this example; enumeration itself does not check plugin ownership.

```js
const { NOTIFY, GetPublicConVarRegistrationRecords, RegisterPublicConVar } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

function GetPublicConVarRegistrationName(Registration) {
	return Registration.Name;
}

const g_PhaseRegistration = RegisterPublicConVar("sjs_phase", "warmup", "Current SourceJS phase.");

try {
	const RegionRegistration = RegisterPublicConVar("sjs_region", "eu", "Current SourceJS region.");

	try {
		const vecPublicConVarNames = Array.from(GetPublicConVarRegistrationRecords(), GetPublicConVarRegistrationName).sort();
		console.log(vecPublicConVarNames);
	} finally {
		if (!RegionRegistration.UnregisterPublicConVar(true)) {
			throw new Error("sjs_region registration cleanup failed.");
		}
	}
} finally {
	if (!g_PhaseRegistration.UnregisterPublicConVar(true)) {
		throw new Error("sjs_phase registration cleanup failed.");
	}
}
```

`GetPublicConVarRegistrationRecords()` returns a live `Map` values iterator, not a snapshot: later additions can be visited before exhaustion, and entries deleted before visitation are skipped. Each yielded registration retains its native-backed ConVar wrapper, not ownership of the native variable's lifetime.

### `UnregisterPublicConVar(strConVarName, bRestoreConVar = true)`

On an SDK branch known to support flag removal, unregister by normalized name when cleanup code does not retain the registration object. Use an exclusively managed name: this function selects the current map entry, even if another registration has replaced the original.

```js
const { NOTIFY, RegisterPublicConVar, UnregisterPublicConVar } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

RegisterPublicConVar("sjs_cleanup_state", "active", "Temporary SourceJS cleanup state.");

if (!UnregisterPublicConVar("sjs_cleanup_state", true)) {
	throw new Error("sjs_cleanup_state registration cleanup failed.");
}
```

This example requires native creation support if `sjs_cleanup_state` is absent and flag-removal support to restore its public state.

The function returns `false` when the normalized name is absent from this module's map or restoration returns `false`; native restoration can also throw. A missing entry is not proof that no plugin registered the native ConVar. Registration failure can leave native changes before a map entry exists.

### `GetPublicConVarConstant(strFlagName)`

Read the notification property through the module's reflection method. Equality with the property checks consistency, not native provenance; JavaScript can modify the module object.

```js
const g_PublicCVarsModule = require("cvars/public");
if (!Object.prototype.hasOwnProperty.call(g_PublicCVarsModule, "NOTIFY")) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_nNotifyFlag = g_PublicCVarsModule.GetPublicConVarConstant("NOTIFY");
if (!Number.isInteger(g_nNotifyFlag) || (g_nNotifyFlag !== g_PublicCVarsModule.NOTIFY)) {
	throw new Error("Public ConVar reflection returned inconsistent module data.");
}
```

Call `GetPublicConVarConstant()` as a module method because the native function inspects its receiver and throws for a missing, non-numeric, or non-finite property. The case-sensitive flag name selects a property, not a ConVar: ordinary lookup includes inherited properties and getters. The lookup preserves embedded NUL bytes through explicit-length UTF-8 conversion. It accepts any finite primitive Number, including fractions, and does not authenticate SDK membership or require a signed 32-bit mask. A detached call does not automatically select the module. Receiver getters can have side effects or throw; an error does not undo those effects.

### `PublicConVarRegistration.RestoreOriginalConVarState()`

On an SDK branch known to support flag removal, restore an existing ConVar while retaining the map entry. Run this example only with exclusive control of `hostname`: both restoration attempts can overwrite intervening changes, and restoration is not atomic. The read-back below checks only the value, not the public flag.

```js
const { NOTIFY, FindConVar, RegisterPublicConVar } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_ExistingHostNameConVar = FindConVar("hostname");
if (!g_ExistingHostNameConVar.Exists) {
	throw new Error("hostname is required by this example.");
}

const g_HostNameRegistration = RegisterPublicConVar("hostname", "SourceJS maintenance", "Temporary public hostname.");

try {
	g_HostNameRegistration.ConVar.Value = "SourceJS maintenance in progress";
	if (!g_HostNameRegistration.RestoreOriginalConVarState()) {
		throw new Error("hostname state could not be restored.");
	}

	if (g_HostNameRegistration.ConVar.Value !== g_HostNameRegistration.OriginalValue) {
		throw new Error("hostname was not restored.");
	}
} finally {
	if (!g_HostNameRegistration.UnregisterPublicConVar(true)) {
		throw new Error("hostname registration cleanup failed.");
	}
}
```

### `PublicConVarRegistration.UnregisterPublicConVar(bRestoreConVar = true)`

Pass `false` only after restoring manually or when leaving the current native state unchanged is intentional. Use an exclusively managed name. This example removes its map entry even if the value assignment throws; it does not restore native state or promise that the current value persists against later engine changes.

```js
const { NOTIFY, RegisterPublicConVar } = require("cvars/public");

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_PersistentStateRegistration = RegisterPublicConVar("sjs_persistent_state", "ready", "Persistent SourceJS state.");

try {
	g_PersistentStateRegistration.ConVar.Value = "draining";
} finally {
	if (!g_PersistentStateRegistration.UnregisterPublicConVar(false)) {
		throw new Error("sjs_persistent_state registration cleanup failed.");
	}
}
```

`UnregisterPublicConVar(false)` only attempts to remove this registration instance from the module's map; it does not change the native value or public flag. This example also requires native creation support if the name is absent. After successful cleanup in this example, the saved record is no longer discoverable through the map. A retained stale or directly constructed instance returns `false` rather than deleting another instance. Do not reuse stale references with restoration enabled: native restoration occurs before the identity check.

## Safe use

- Treat `NOTIFY`, all exported names, the `Flags` options key, and registration getter properties as stable public keys. `Flags` is a signed 32-bit mask.
- The native `NOTIFY` property is absent when the selected SDK does not define `FCVAR_NOTIFY`; `SetConVarPublic` and `IsConVarPublic` then throw, and `GetPublicConVarConstant("NOTIFY")` reports a missing property. `FindConVar` remains an ordinary lookup. Check the property when supporting such branches.
- Managed registrations are stored in this JavaScript module instance's map, not an engine ownership registry. Names must be non-empty primitive strings without NUL bytes and are trimmed; an existing map entry rejects another registration under that name. Direct `PublicConVarRegistration` construction does not insert an entry or acquire native ownership.
- Live registration objects change native engine state. Explicitly call `UnregisterPublicConVar()` during cleanup and check its result; destroying the JavaScript context alone does not restore values or flags.
- Passing `true` attempts to restore an existing ConVar's previous value and public state before deleting the map entry. It can fail or throw after partial restoration; unsupported flag removal throws. For a newly created variable it only attempts to clear the public flag before deleting the entry, without resetting its value or deleting the native variable. This module provides no native deletion API.
- Pass `false` only when leaving the current native value and public state unchanged is intentional. Successful deletion removes map discoverability, not retained references or the native variable. Do not reuse stale registration objects: the current implementation deletes by name without verifying object identity.
- Registration is not transactional: it can change native state before throwing and before inserting a map entry. Keep names exclusively managed, handle errors, and do not treat a missing map entry as proof that no native changes occurred.
- `GetPublicConVarRegistrationRecords()` returns a live `Map` values iterator. `GetPublicConVars()` returns matching engine records, not registration objects; it is not owner-filtered and may throw when the engine registry cannot be enumerated.
- Call `GetPublicConVarConstant()` as a method of the module because the native function inspects its receiver and throws for a missing, non-numeric, or non-finite property.
- Run these synchronous APIs on the server/game thread while the borrowed native ConVar remains alive. They do not use the background request workers for network or database operations.

## Related files

- [`packages/sourcejs/cvars/public.js`](../../packages/sourcejs/cvars/public.js) — managed registration class, module-instance map, normalization, and JavaScript exports.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — native `NOTIFY`, lookup, public-state, and reflection bindings.
- [`cvars.md`](cvars.md) — full ConVar value, flag, constant, and registry API.
- [`cvars-convar.md`](cvars-convar.md) — native-backed ConVar lookup and creation objects.
- [`cvars-flags.md`](cvars-flags.md) — `FCVAR_*` constants for the selected SDK.
