# `require("cvars")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

`cvars` exposes the selected Source SDK's `ICvar`, `ConVar`, and `ConCommandBase` state. Value operations access native variables; writes can invoke engine validation, clamping, and callbacks. Live wrappers borrow native objects. Registry enumeration also returns native-backed entries, not detached value snapshots.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Live ConVar objects](#live-convar-objects)
- [Lookup examples](#lookup-examples)
- [Typed values](#typed-values)
- [Creation](#creation)
- [Flags](#flags)
- [Registry introspection](#registry-introspection)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

[`packages/sourcejs/cvars.js`](../../packages/sourcejs/cvars.js) returns the native `cvars` module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp).

Use it when a plugin must inspect or change the live Source console registry, read typed ConVar values, create a ConVar on supported SDK branches, manipulate flags, or enumerate ConVar and ConCommand metadata. A live wrapper does not own or extend the native object's lifetime; do not retain or use it beyond that lifetime. Availability and failure results depend on the operation and SDK branch.

## Import

```js
const { DoesConVarExist, GetConVar, SetConVar } = require("cvars");
```

## Exports

`FindConVar`, `RequireConVar`, `DoesConVarExist`, `GetConCommandBaseRecords` and the four value getters (`GetConVar`, `GetConVarInteger`, `GetConVarFloat`, `GetConVarBoolean`) translate C++ exceptions at their native callback boundaries into contextual JavaScript errors without exposing the exception text. This does not guarantee native lifetime safety or recovery from an invalid ABI.

`SetConVar`, `RevertConVarToDefault`, `SetConVarFlags`, `AddConVarFlags`, `RemoveConVarFlags`, `CreateConVar`, `GetConVarNumericConstant` and `GetConVarObjectConstant` also translate C++ exceptions at their native callback boundaries. Completed native writes, registration or receiver getter side effects are not rolled back by a later error.

New ConVars keep their SDK-borrowed name, default-value and help strings in stable owned storage until DLL teardown. Creation storage and registration are game-thread-confined. A constructor failure removes only its provisional storage entry; a later registration or result-wrapper failure keeps the constructed native object alive for retry. SourceJS explicitly registers owned variables unless `FCVAR_UNREGISTERED` is set, while the selected SDK's own constructor behavior still applies. Runtime shutdown unregisters owned ConVars before engine interfaces disconnect, without deleting objects that SDK pending lists may still borrow. Modern console APIs use individual unregister operations; legacy builds use the existing SourceJS ownership flag and SDK unlink/re-register route. Externally owned variables are not adopted or removed.

`FindConVar`, `RequireConVar`, `GetConVar`, `CreateConVar` and command-record enumeration check result construction before publishing it. They preserve an existing JavaScript exception or report construction failure, including when a C++ failure occurs during result construction or append. Enumeration creates own writable, enumerable, configurable array elements without invoking inherited setters or respecting inherited non-writable elements; native order is preserved. It stops on a failed record or array write, advances its index only after a successful write, and rejects index overflow rather than returning a partial array. These checks do not extend the lifetime of borrowed native records or roll back completed registration.

`FindConVar`, `DoesConVarExist`, the four value getters, `RequireConVar`, `SetConVar`, `RevertConVarToDefault`, the three flag operations and `CreateConVar` require a primitive string name. They preserve its complete UTF-8 bytes without case normalization, reject embedded NUL characters, and throw on encoding failure before native lookup, writes or registration. Argument-type and unavailable-interface errors retain their earlier precedence. `CreateConVar` also rejects an empty name; other empty-name lookups and missing-name results keep their documented native/error policies. Flag operations accept either a ConVar or a command and use command-name diagnostics. These name restrictions do not change the existing C-string semantics of values, descriptions or default values.

| Export | Signature | Result |
| --- | --- | --- |
| [`FindConVar`](#findconvarstrconvarname) | `FindConVar(strConVarName)` | Live ConVar object or `{ Exists: false }`. |
| [`RequireConVar`](#requireconvarstrconvarname) | `RequireConVar(strConVarName)` | Live ConVar object; throws if missing. |
| [`DoesConVarExist`](#doesconvarexiststrconvarname) | `DoesConVarExist(strConVarName)` | Whether native `FindVar` finds a ConVar; a command is not a ConVar. Invalid argument types or unavailable native interface throw, not `false`. |
| [`GetConCommandBaseRecords`](#getconcommandbaserecords) | `GetConCommandBaseRecords()` | Array in native enumeration order, containing live ConVar wrappers and command records with live existence/flags but copied name/help/address metadata. Does not own native lifetimes; throws when the selected `ICvar` interface cannot enumerate. |
| [`GetConVar`](#getconvarstrconvarname) | `GetConVar(strConVarName)` | Native current string value; `null` if the variable is missing, not for an unavailable interface or invalid argument type. |
| [`GetConVarInteger`](#getconvarintegerstrconvarname) | `GetConVarInteger(strConVarName)` | Native `GetInt()` value as a JavaScript Number; throws if the variable is missing. This reads the engine's integer representation, not a JavaScript string parse. |
| [`GetConVarFloat`](#getconvarfloatstrconvarname) | `GetConVarFloat(strConVarName)` | Native `GetFloat()` result as a JavaScript Number; throws if the variable is missing. |
| [`GetConVarBoolean`](#getconvarbooleanstrconvarname) | `GetConVarBoolean(strConVarName)` | Native `GetBool()` result; throws if the variable is missing. Not JavaScript string truthiness. |
| [`SetConVar`](#setconvarstrconvarname-value) | `SetConVar(strConVarName, Value)` | `true` after the native setter call, without read-back verification. Int32 values use the integer setter; other Numbers must be finite and fit the native float range before narrowing; booleans become `1`/`0`. Other values use ordinary JavaScript string conversion; a conversion error reaches the caller unchanged and stops the write. Missing variables throw. |
| [`RevertConVarToDefault`](#revertconvartodefaultstrconvarname) | `RevertConVarToDefault(strConVarName)` | `true` after passing `GetDefault()` to the native setter, without read-back verification; throws if missing. Does not restore flags, bounds, or an earlier runtime value. |
| [`CreateConVar`](#createconvarstrconvarname-value-strdescription-nflags-flminimumvalue-flmaximumvalue) | `CreateConVar(strConVarName, Value?, strDescription?, nFlags?, flMinimumValue?, flMaximumValue?)` | Existing or newly created live wrapper. Existing variables ignore creation options; a command-name collision throws. New creation requires SDK support. New flags use JavaScript `ToInt32`; supplied bounds use numeric conversion before finite/native-float checks, with ordering checked by the caller. Default-value and description string-conversion errors stop creation and reach the caller unchanged. |
| [`SetConVarFlags`](#setconvarflagsstrcommandbasename-nflags) | `SetConVarFlags(strCommandBaseName, nFlags)` | `true` after requesting the signed 32-bit flag mask for a ConVar or ConCommand. Uses JavaScript `ToInt32`, including coercion, truncation, and wrapping; missing names, conversion errors, or unsupported required flag removal throw. No read-back verification. |
| [`AddConVarFlags`](#addconvarflagsstrcommandbasename-nflags) | `AddConVarFlags(strCommandBaseName, nFlags)` | `true` after requesting addition of the JavaScript `ToInt32`-converted mask for a ConVar or ConCommand; missing names or conversion errors throw. Coercion, truncation, and wrapping follow `ToInt32`; no read-back verification. |
| [`RemoveConVarFlags`](#removeconvarflagsstrcommandbasename-nflags) | `RemoveConVarFlags(strCommandBaseName, nFlags)` | `true` after requesting removal of the JavaScript `ToInt32`-converted mask from a ConVar or ConCommand. Coercion, truncation, and wrapping follow `ToInt32`; missing names, conversion errors, or an unsupported removal path throw. No read-back verification. |
| [`GetConVarNumericConstant`](#getconvarnumericconstantstrconstantname) | `GetConVarNumericConstant(strConstantName)` | Finite Number property from the call receiver; requires a non-empty primitive string name and rejects missing/nullish, non-numeric, or non-finite values. Does not authenticate native constants. |
| [`GetConVarObjectConstant`](#getconvarobjectconstantstrconstantname) | `GetConVarObjectConstant(strConstantName)` | Object-valued property from the call receiver, returned by reference rather than copied. Requires a non-empty primitive string name; missing/nullish or non-object values throw. Does not authenticate native constants. |
| [`CVAR_DLL_IDENTIFIER`](#cvar_dll_identifier) | Constant | Integer captured from `ConCommandBase().GetDLLIdentifier()` during installation; absent when built with `SOURCEJS_OLD_CONSOLE_API`. |
| [`FLAGS`](#flags-1) | Object | Selected SDK's exported flag constants; individual properties depend on available SDK macros. This is an ordinary JavaScript object, not an immutable or authenticated constant registry. |

## Live ConVar objects

`FindConVar`, `RequireConVar`, and `CreateConVar` return a native-backed object with live properties:

| Property | Writable | Meaning |
| --- | --- | --- |
| `Exists` | No | Native `IsRegistered()` result. The getter dereferences the borrowed object; it cannot validate an expired native address. |
| `Name` | No | Engine ConVar name. |
| `Help` | No | Help text. |
| `Value` | Yes | Native string value; assignment converts the supplied value to a null-terminated native string. A conversion exception propagates unchanged, before the native setter is called. A nonthrowing conversion/encoding failure reports `ConVar.Value could not convert the supplied value to a native string.` |
| `DefaultValue` | No | Default string value. |
| `IntValue` | Yes | Native integer view; assignment requires an Int32 value. |
| `FloatValue` | Yes | Native float view as a JavaScript Number; assignment requires a finite Number within the native float range before narrowing. NaN, infinities, and overflow throw before the native setter is called. |
| `BooleanValue` | Yes | Native boolean view; assignment requires a boolean and writes integer `1` or `0`. |
| [`Flags`](#flags) | Yes when supported | Native `FCVAR_*` mask; assignment requires a signed 32-bit integer and can throw when required flag removal is unsupported. |
| `Address` | No | Borrowed native address returned as a JavaScript `bigint`; this is not a lifetime guarantee or an owning handle. |

Builds with `SOURCEJS_HAS_CONVAR_CREATION` also expose read-only `HasMinimum`, `HasMaximum`, `MinimumValue`, and `MaximumValue`. Check `HasMinimum` or `HasMaximum` before interpreting the corresponding bound. `MinimumValue` and `MaximumValue` return `undefined` when the native `GetMin`/`GetMax` call reports no bound; they do not substitute zero.

Native wrapper creation preserves a live-property installation exception and never returns a partially installed object. Nonthrowing failures report `Failed to install ConVar live properties.` or, for the optional bound fields, `Failed to install ConVar range properties.` These checks do not extend the borrowed native lifetime. The string-conversion catch ends before `SetValue()`; exceptions from native-setter callbacks are not swallowed by it.

Native live-property reads translate C++ failures into `Error("ConVar property failed because a native C++ exception occurred.")`; writes use `Error("ConVar property write failed because a native C++ exception occurred.")`. Existing JavaScript exceptions, including a thrown `Value.toString()` result, propagate unchanged. Numeric/boolean/flag writes require primitive values of the documented types, not boxed values or coercible strings. `Value` does perform string conversion; an embedded NUL ends the C string passed to the SDK. A write already performed, including native callback side effects, is not rolled back. Keep borrowed native objects alive throughout conversion and callbacks; `Address` and `Exists` cannot prove external native lifetime.

## Lookup examples

### `DoesConVarExist(strConVarName)`

Use `DoesConVarExist` to check for an optional game-specific ConVar before reading it. This is a point-in-time lookup, not a lifetime guarantee: the later read performs another native lookup and can still throw if the ConVar has been unregistered or the `ICvar` interface is unavailable.

```js
const { DoesConVarExist, GetConVarInteger } = require("cvars");

if (DoesConVarExist("sv_visiblemaxplayers")) {
	console.log(`Visible player limit: ${GetConVarInteger("sv_visiblemaxplayers")}`);
}
```

### `FindConVar(strConVarName)`

`FindConVar` represents an absent variable with `{ Exists: false }`; invalid arguments or an unavailable native interface still throw. The missing result owns one writable, enumerable, configurable data property, `Exists`, with value `false`; inherited setters and non-writable inherited properties cannot intercept or suppress its initialization. This sentinel is not a live native wrapper.

Use a returned live wrapper only while its native target remains alive:

```js
const { FindConVar } = require("cvars");

const g_HostNameConVar = FindConVar("hostname");
if (g_HostNameConVar.Exists) {
	console.log(`Current hostname: ${g_HostNameConVar.Value}`);
} else {
	console.log("hostname was not found or is not registered.");
}
```

### `RequireConVar(strConVarName)`

Use `RequireConVar` for a required dependency. A missing ConVar throws a native error; the caller's error handling determines whether initialization stops. The wrapper borrows the native variable rather than extending its lifetime:

```js
const { RequireConVar } = require("cvars");

const g_GravityConVar = RequireConVar("sv_gravity");
console.log(`${g_GravityConVar.Name}=${g_GravityConVar.FloatValue}, default=${g_GravityConVar.DefaultValue}`);
```

### `GetConVar(strConVarName)`

Read the current string without constructing a live ConVar wrapper. `null` means the variable was not found; an empty string is still a value. Invalid arguments or an unavailable native interface throw rather than returning `null`.

```js
const { GetConVar } = require("cvars");

const g_strHostName = GetConVar("hostname");
if (g_strHostName !== null) {
	console.log(`Server hostname: ${g_strHostName}`);
}
```

`GetConVar()` is the only value getter that returns a missing-value sentinel. The typed getters throw when the ConVar does not exist.

## Typed values

### `GetConVarBoolean(strConVarName)`

```js
const { GetConVarBoolean } = require("cvars");

if (GetConVarBoolean("sv_cheats")) {
	console.log("The native boolean value of sv_cheats is true.");
}
```

### `GetConVarFloat(strConVarName)`

```js
const { GetConVarFloat } = require("cvars");

const g_flLowGravityThreshold = 400;
const g_flGravity = GetConVarFloat("sv_gravity");
if (g_flGravity < g_flLowGravityThreshold) {
	console.log(`sv_gravity is below the example's threshold: ${g_flGravity}.`);
}
```

### `GetConVarInteger(strConVarName)`

```js
const { GetConVarInteger } = require("cvars");

const g_nCheatMode = GetConVarInteger("sv_cheats");
console.log(`sv_cheats integer value: ${g_nCheatMode}`);
```

### `SetConVar(strConVarName, Value)`

`SetConVar` sends JavaScript Int32 values to the integer setter, other Numbers through a narrowing conversion to native float, booleans as `1` or `0`, and other values through string conversion. The Number path rejects non-finite and out-of-float-range values before narrowing or calling the native setter; accepted values can still lose precision or underflow when converted to float. String writes use a null-terminated native string, so avoid embedded NUL characters.

Run this temporary change only with exclusive control of `hostname`. Restoration is attempted and checked, not guaranteed: callbacks can observe intermediate state, another writer's changes can be overwritten, and restoration failure can mask the original error.

```js
const { GetConVar, SetConVar } = require("cvars");

const g_strPreviousHostName = GetConVar("hostname");
if (g_strPreviousHostName === null) {
	throw new Error("hostname is required by this plugin.");
}

try {
	if (!SetConVar("hostname", "SourceJS event server")) {
		throw new Error("Failed to set the temporary hostname.");
	}

	if (GetConVar("hostname") !== "SourceJS event server") {
		throw new Error("The temporary hostname was not applied.");
	}

	console.log("Temporary event hostname is active.");
} finally {
	if (!SetConVar("hostname", g_strPreviousHostName) || (GetConVar("hostname") !== g_strPreviousHostName)) {
		throw new Error("Failed to restore the hostname.");
	}
}
```

### `RevertConVarToDefault(strConVarName)`

With exclusive control of the chosen name, temporarily change a ConVar and attempt to reset it to its native declared default, not its previous runtime value. Existing variables keep their original default and bounds; creation does not acquire ownership. A newly created variable is not deleted by this example. Reset or read-back can fail, and a reset error can mask the original error.

```js
const { SetConVar, RevertConVarToDefault, CreateConVar } = require("cvars");

const g_RoundDelayConVar = CreateConVar("sjs_round_end_delay", "5.0", "Delay before SourceJS advances the rotation.", 0, 0, 60);

try {
	if (!SetConVar(g_RoundDelayConVar.Name, 12.5)) {
		throw new Error("Failed to set sjs_round_end_delay.");
	}
} finally {
	if (!RevertConVarToDefault(g_RoundDelayConVar.Name)) {
		throw new Error("Failed to restore the sjs_round_end_delay default.");
	}

	if (g_RoundDelayConVar.Value !== g_RoundDelayConVar.DefaultValue) {
		throw new Error("sjs_round_end_delay did not return to its default value.");
	}
}
```

## Creation

### `CreateConVar(strConVarName, Value?, strDescription?, nFlags?, flMinimumValue?, flMaximumValue?)`

Create a ConVar under a stable plugin-prefixed name, or obtain the existing variable. Use a name the plugin exclusively manages: the assignment below intentionally changes its runtime value and does not restore it. Keep the wrapper only while the native object remains alive.

```js
const { CreateConVar } = require("cvars");

const g_VoteThresholdConVar = CreateConVar("sjs_vote_threshold", "0.60", "Fraction of eligible players required to pass a SourceJS vote.", 0, 0.0, 1.0);
g_VoteThresholdConVar.FloatValue = 0.66;
console.log(`Vote threshold is now ${g_VoteThresholdConVar.FloatValue}.`);
```

An existing ConVar retains its value, default, help text, flags, and bounds during `CreateConVar`; only the explicit assignment changes its value here. Existing bounds can clamp that assignment, and native float precision affects the read-back. A command-name collision throws; creating a new variable requires SDK support. This module provides no native deletion API, and unloading the plugin does not undo creation. The example declares a setting but does not implement voting behavior.

Unloading a JavaScript plugin does not remove its created variables. Unloading the SourceJS runtime does unregister its owned variables; their cached objects and backing strings survive until DLL teardown. A subsequent `CreateConVar()` for the same owned name reuses the cached object and its previous value, default, help, flags and bounds. Optional-value conversion can execute JavaScript, so the name is checked again before construction: a new command collision throws and a newly registered ConVar is reused.

## Flags

### `FLAGS`

The native installer populates `FLAGS` with the supported subset of selected-SDK `FCVAR_*` constants, using `UPPER_SNAKE_CASE` members. Each installed member requires its corresponding SDK macro; this is not an exhaustive list of every SDK flag. The following check verifies integer values, not their native provenance after JavaScript mutation:

```js
const { FLAGS } = require("cvars");

const g_nReplicatedFlag = FLAGS.REPLICATED;
const g_nNotifyFlag = FLAGS.NOTIFY;

if (!Number.isInteger(g_nReplicatedFlag) || !Number.isInteger(g_nNotifyFlag)) {
	throw new Error("This Source SDK does not expose the required ConVar flags.");
}

const g_nReplicatedAndNotifiedFlags = g_nReplicatedFlag | g_nNotifyFlag;
console.log(`Combined engine flag mask: ${g_nReplicatedAndNotifiedFlags}`);
```

Do not assume every SDK declares every flag. An unavailable member is omitted.

Legacy console-API builds reserve `0x80000000` on SourceJS-created ConVars for owned-registration cleanup. The bit may appear in the signed `Flags` result; preserve it when combining masks and do not reuse it for a plugin-specific flag. SourceJS skips an explicit registration request for `FCVAR_UNREGISTERED`; native visibility still follows the selected SDK, so do not assume that variable is discoverable by name.

### `AddConVarFlags(strCommandBaseName, nFlags)`

Add `NOTIFY` to a ConVar under an exclusively managed name. The native operation adds bits rather than replacing the mask; callbacks or other writers can still change it. This example intentionally leaves the flag enabled and does not undo creation or implement an event mode.

```js
const { CreateConVar, AddConVarFlags, FLAGS } = require("cvars");

const g_nNotifyFlag = FLAGS.NOTIFY;
if (!Number.isInteger(g_nNotifyFlag)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_EventModeConVar = CreateConVar("sjs_event_mode", "0", "Enable the SourceJS event mode.");
if (!AddConVarFlags(g_EventModeConVar.Name, g_nNotifyFlag)) {
	throw new Error("Failed to add FCVAR_NOTIFY to sjs_event_mode.");
}

if ((g_EventModeConVar.Flags & g_nNotifyFlag) === 0) {
	throw new Error("Notify was not applied to sjs_event_mode.");
}
```

### `RemoveConVarFlags(strCommandBaseName, nFlags)`

On an SDK branch known to support flag removal, remove `NOTIFY` from an exclusively managed ConVar if the bit is set. Exporting `NOTIFY` alone does not prove removal support. This example intentionally leaves the bit cleared, does not undo creation, and does not disable the setting's associated feature.

```js
const { CreateConVar, RemoveConVarFlags, FLAGS } = require("cvars");

const g_nNotifyFlag = FLAGS.NOTIFY;
if (!Number.isInteger(g_nNotifyFlag)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_EventModeConVar = CreateConVar("sjs_event_mode", "0", "Enable the SourceJS event mode.");
if ((g_EventModeConVar.Flags & g_nNotifyFlag) !== 0) {
	if (!RemoveConVarFlags(g_EventModeConVar.Name, g_nNotifyFlag)) {
		throw new Error("Failed to remove FCVAR_NOTIFY from sjs_event_mode.");
	}

	if ((g_EventModeConVar.Flags & g_nNotifyFlag) !== 0) {
		throw new Error("Notify was not removed from sjs_event_mode.");
	}
}
```

On Source SDK branches without flag-removal support, `RemoveConVarFlags` throws for any nonzero mask, even when those bits are already clear; a zero mask succeeds without removing anything.

### `SetConVarFlags(strCommandBaseName, nFlags)`

On an SDK branch known to support flag removal, temporarily replace the complete mask under exclusive control of the chosen name. Saving a mask does not establish ownership: restoration can overwrite another writer's changes, fail, or mask an earlier error. Creation is not undone by restoring flags.

```js
const { CreateConVar, SetConVarFlags, FLAGS } = require("cvars");

const g_nNotifyFlag = FLAGS.NOTIFY;
if (!Number.isInteger(g_nNotifyFlag)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_EventModeConVar = CreateConVar("sjs_event_mode", "0", "Enable the SourceJS event mode.");
const g_nPreviousFlags = g_EventModeConVar.Flags;
const g_nTemporaryFlags = g_nPreviousFlags | g_nNotifyFlag;

try {
	if (!SetConVarFlags(g_EventModeConVar.Name, g_nTemporaryFlags)) {
		throw new Error("Failed to set the temporary sjs_event_mode flags.");
	}

	if (g_EventModeConVar.Flags !== g_nTemporaryFlags) {
		throw new Error("The temporary mask was not applied to sjs_event_mode.");
	}

	console.log(`Temporary flag mask: ${g_EventModeConVar.Flags}`);
} finally {
	if (!SetConVarFlags(g_EventModeConVar.Name, g_nPreviousFlags) || (g_EventModeConVar.Flags !== g_nPreviousFlags)) {
		throw new Error("Failed to restore the sjs_event_mode flags.");
	}
}
```

`AddConVarFlags`, `RemoveConVarFlags`, and `SetConVarFlags` also accept a ConCommand name.

## Registry introspection

### `GetConCommandBaseRecords()`

Build a name-and-flags report from the current `ICvar` registry. The `sjs_` prefix is a naming filter, not proof of ownership. Values are omitted because a matching name does not establish that a value is safe to log. Consume native-backed entries only while their native targets remain alive.

Command records retain live `Exists` and `Flags` accessors; `Name`, `Help`, `Address`, `Type`, and `IsCommand` are copied own data properties, writable, enumerable, and configurable. The copied `Type` and `IsCommand` fields on ConVar entries have the same own-property descriptors. Initializing these fields bypasses inherited setters and inherited non-writable properties. Creating the live accessors preserves an installation exception; a nonthrowing installation failure reports `Failed to install ConCommand live properties.` No partial command record is returned. These checks do not validate or extend the native target's lifetime.

`Exists` is read-only. `Flags` writes require a primitive signed 32-bit integer and a supported SDK flag-update path; they do not coerce strings, booleans, boxed numbers, or `bigint` values. Native C++ failures become contextual `Error` values: `ConCommand.Exists read failed because a native C++ exception occurred.`, `ConCommand.Flags read failed because a native C++ exception occurred.`, or `ConCommand.Flags write failed because a native C++ exception occurred.` A C++ failure while reporting a read-only write uses `ConCommand read-only property write failed because a native C++ exception occurred.` Existing JavaScript exceptions propagate unchanged. Already performed native writes are not rolled back, and none of these accessors grants ownership or extends the borrowed lifetime.

```js
const { GetConCommandBaseRecords } = require("cvars");

function HasSourceJSConVarName(ConCommandBaseRecord) {
	return !ConCommandBaseRecord.IsCommand && ConCommandBaseRecord.Name.startsWith("sjs_");
}

function CreateConVarReportEntry(ConVarRecord) {
	return { Name: ConVarRecord.Name, Flags: ConVarRecord.Flags };
}

function CompareConVarReportEntries(LeftConVarReport, RightConVarReport) {
	return LeftConVarReport.Name.localeCompare(RightConVarReport.Name);
}

const g_vecSourceJSVariables = GetConCommandBaseRecords().filter(HasSourceJSConVarName).map(CreateConVarReportEntry).sort(CompareConVarReportEntries);
console.log(g_vecSourceJSVariables);
```

If a selected SDK's `ICvar` interface exposes neither supported enumeration form (`Iterator` or `GetCommands()`), `GetConCommandBaseRecords()` throws instead of returning a fabricated empty array.

### `CVAR_DLL_IDENTIFIER`

Inspect the module's captured DLL identifier for diagnostics. It is not a per-variable ownership query; JavaScript can modify the property, so checking its type does not authenticate its origin.

```js
const g_CVarsModule = require("cvars");
if (!Object.prototype.hasOwnProperty.call(g_CVarsModule, "CVAR_DLL_IDENTIFIER")) {
	console.log("This Source SDK does not expose a CVar DLL identifier.");
} else if (!Number.isInteger(g_CVarsModule.CVAR_DLL_IDENTIFIER)) {
	throw new Error("SourceJS received an invalid CVar DLL identifier.");
} else {
	console.log(`SourceJS CVar DLL identifier: ${g_CVarsModule.CVAR_DLL_IDENTIFIER}`);
}
```

### `GetConVarNumericConstant(strConstantName)`

Reflection tools can read a finite numeric property by its exact name. This example checks an own export first; equality with that property does not authenticate native provenance.

```js
const g_CVarsModule = require("cvars");
if (Object.prototype.hasOwnProperty.call(g_CVarsModule, "CVAR_DLL_IDENTIFIER")) {
	const nReflectedCVarDLLIdentifier = g_CVarsModule.GetConVarNumericConstant("CVAR_DLL_IDENTIFIER");
	if (nReflectedCVarDLLIdentifier !== g_CVarsModule.CVAR_DLL_IDENTIFIER) {
		throw new Error("CVar numeric constant lookup returned inconsistent metadata.");
	}
}
```

Ordinary plugins can import an available named constant directly. Call `GetConVarNumericConstant` as a module method: it reads from its receiver, requires a non-empty primitive string name, and throws for a missing/nullish, non-numeric, or non-finite property. It does not require an integer result or restrict lookup to native exports; inherited properties and getters participate in the underlying lookup. Constant-property names preserve embedded NUL bytes through explicit-length UTF-8 lookup; they are not native ConVar names.

### `GetConVarObjectConstant(strConstantName)`

Read the module's `FLAGS` object through the reflection method. The identity check compares JavaScript references, not native provenance or immutability:

```js
const g_CVarsModule = require("cvars");

const g_ReflectedConVarFlags = g_CVarsModule.GetConVarObjectConstant("FLAGS");
if (g_ReflectedConVarFlags !== g_CVarsModule.FLAGS) {
	throw new Error("CVar object constant lookup did not preserve object identity.");
}
```

Call both reflection functions as module methods because they inspect their call receiver. `GetConVarObjectConstant` requires a non-empty primitive string name and throws for a missing/nullish or non-object property. Arrays and functions also satisfy the native object check. It returns the same object reference, not a copy; inherited properties and getters participate in lookup. Do not mutate the returned object merely to inspect it.

## Safe use

- Perform these operations in the live SourceJS game-thread context. Native value and flag writes are synchronous and can invoke callbacks that reenter plugin code; they are not asynchronous requests.
- Treat all exported names and live-object properties as stable public compatibility keys. Guard `Exists` before reading any other property from a `FindConVar()` miss object.
- Live wrappers borrow native objects without extending their lifetime; even `Exists` dereferences the target and cannot validate a dangling address. Coordinate writers and callbacks before changing shared state. Attempt temporary restoration in `finally` and verify read-back when needed; cleanup can fail or mask an earlier error.
- `CreateConVar()` returns an existing ConVar without applying creation options, throws for a command-name collision, and requires SDK support for new creation. This module has no native deletion API; plugin unload does not undo creation. New bounds must be finite, fit native float, and have caller-validated ordering. SourceJS runtime shutdown does unregister owned variables before disconnect; their native storage survives until DLL teardown and is reused on subsequent creation.
- Flags are signed 32-bit masks exposed through the `Flags` property. Do not assume every `FLAGS` member exists; removing or replacing flags may throw on older SDK branches. Preserve the legacy SourceJS ownership bit `0x80000000` on owned variables; it supports safe unlinking during cleanup.
- `CVAR_DLL_IDENTIFIER` is absent when the selected SDK uses the old console API. Check the module property before reading the value or passing its name to reflection.
- `GetConCommandBaseRecords()` may throw when the selected `ICvar` interface exposes neither supported enumeration form (`Iterator` or `GetCommands()`). ConVar entries are live wrappers; command records mix live existence/flags with copied metadata. Filter `IsCommand` before accessing ConVar-only fields, respect native lifetimes, and do not infer ownership or safe-to-log values from a name prefix.
- `Address` is exposed as a `bigint` diagnostic address. It preserves the integer address value, but does not extend the native object's lifetime or make dereferencing safe from JavaScript.
- The non-Int32 Number path in `SetConVar()` and the `FloatValue` setter reject non-finite and out-of-float-range values before narrowing or calling the native setter. Accepted Numbers can still lose precision or underflow to zero. String setters use null-terminated native strings; avoid embedded NUL characters.
- Call `GetConVarNumericConstant()` and `GetConVarObjectConstant()` as module methods because they inspect their receiver. Lookup can access inherited properties/getters and does not authenticate native exports; reflected objects are shared references, not copies.

## Related files

- [`packages/sourcejs/cvars.js`](../../packages/sourcejs/cvars.js) — JavaScript entry point that returns the native module unchanged.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — live properties, callbacks, SDK feature gates, constants, and registry iteration.
- [`cvars-convar.md`](cvars-convar.md) — focused live ConVar lookup API.
- [`cvars-flags.md`](cvars-flags.md) — flag constants for the selected SDK.
- [`cvars-public.md`](cvars-public.md) — public-visibility controls for ConVars.
- [`cvars-tags.md`](cvars-tags.md) — server-tag helpers built on ConVar state.
