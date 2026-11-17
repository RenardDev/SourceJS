# `require("cvars/flags")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Flag constants](#flag-constants)
- [Functions](#functions)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

[`packages/sourcejs/cvars/flags.js`](../../packages/sourcejs/cvars/flags.js) returns the native `cvars/flags` module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp).

Use this module for the `FCVAR_*` integer constants declared by the selected Source SDK. The native, branch-specific values let plugins create ConVars and inspect or update ConVar and ConCommand masks without hardcoding flag values that may differ or be absent across SDK branches.

## Import

```js
const { NOTIFY, REPLICATED, CHEAT } = require("cvars/flags");
```

Every exported flag constant is a number, not a namespace object. Native initialization creates own writable, enumerable, configurable data properties without invoking inherited setters or being blocked by inherited non-writable properties. `GetConVarFlagConstant` is the module's only function. Constants unavailable in the selected HL2SDK branch are omitted.

## Flag constants

The examples inspect the integer mask `nFlags` of an existing ConVar. Import the flag named in the row from `cvars/flags`; check its availability before testing a bit.

| Export | Source constant | Typical engine meaning | Example |
| --- | --- | --- | --- |
| `NONE` | `FCVAR_NONE` | No flags. | `(typeof NONE === "number") && (nFlags === NONE)` |
| `UNREGISTERED` | `FCVAR_UNREGISTERED` | Keep out of the engine's command/ConVar registration lists. | `(typeof UNREGISTERED === "number") && ((nFlags & UNREGISTERED) !== 0)` |
| `DEVELOPMENT_ONLY` | `FCVAR_DEVELOPMENTONLY` | Hidden in released products; the engine removes the flag when `ALLOW_DEVELOPMENT_CVARS` is defined. | `(typeof DEVELOPMENT_ONLY === "number") && ((nFlags & DEVELOPMENT_ONLY) !== 0)` |
| `GAME_DLL` | `FCVAR_GAMEDLL` | Defined by the server game DLL. | `(typeof GAME_DLL === "number") && ((nFlags & GAME_DLL) !== 0)` |
| `CLIENT_DLL` | `FCVAR_CLIENTDLL` | Defined by the client DLL. | `(typeof CLIENT_DLL === "number") && ((nFlags & CLIENT_DLL) !== 0)` |
| `HIDDEN` | `FCVAR_HIDDEN` | Omitted from find and autocomplete; unlike the `DEVELOPMENT_ONLY` export, it cannot be compiled out. | `(typeof HIDDEN === "number") && ((nFlags & HIDDEN) !== 0)` |
| `PROTECTED` | `FCVAR_PROTECTED` | Hide a sensitive server value from normal transmission; the SDK describes sending `0` for a blank/zero value and `1` otherwise. Not a general secrecy boundary. | `(typeof PROTECTED === "number") && ((nFlags & PROTECTED) !== 0)` |
| `SINGLE_PLAYER_ONLY` | `FCVAR_SPONLY` | Prevent clients connected to a multiplayer server from changing the ConVar. | `(typeof SINGLE_PLAYER_ONLY === "number") && ((nFlags & SINGLE_PLAYER_ONLY) !== 0)` |
| `ARCHIVE` | `FCVAR_ARCHIVE` | Mark the ConVar for saving to the engine's configuration file. | `(typeof ARCHIVE === "number") && ((nFlags & ARCHIVE) !== 0)` |
| `NOTIFY` | `FCVAR_NOTIFY` | Notify clients when the value changes. | `(typeof NOTIFY === "number") && ((nFlags & NOTIFY) !== 0)` |
| `USER_INFO` | `FCVAR_USERINFO` | Include the client ConVar in the client's user-info string. | `(typeof USER_INFO === "number") && ((nFlags & USER_INFO) !== 0)` |
| `PRINTABLE_ONLY` | `FCVAR_PRINTABLEONLY` | Restrict the value to printable characters. | `(typeof PRINTABLE_ONLY === "number") && ((nFlags & PRINTABLE_ONLY) !== 0)` |
| `UNLOGGED` | `FCVAR_UNLOGGED` | Suppress server ConVar change logging to the log file and console. | `(typeof UNLOGGED === "number") && ((nFlags & UNLOGGED) !== 0)` |
| `NEVER_AS_STRING` | `FCVAR_NEVER_AS_STRING` | Suppress ordinary engine printing of the ConVar; this does not prevent direct reads through exposed properties. | `(typeof NEVER_AS_STRING === "number") && ((nFlags & NEVER_AS_STRING) !== 0)` |
| `REPLICATED` | `FCVAR_REPLICATED` | Replicate the server value to clients. | `(typeof REPLICATED === "number") && ((nFlags & REPLICATED) !== 0)` |
| `CHEAT` | `FCVAR_CHEAT` | Restrict use to the SDK's single-player, debug, or multiplayer cheat-enabled conditions. | `(typeof CHEAT === "number") && ((nFlags & CHEAT) !== 0)` |
| `DEMO` | `FCVAR_DEMO` | Record the ConVar when starting a demo file. | `(typeof DEMO === "number") && ((nFlags & DEMO) !== 0)` |
| `DO_NOT_RECORD` | `FCVAR_DONTRECORD` | Exclude commands from demo recording. | `(typeof DO_NOT_RECORD === "number") && ((nFlags & DO_NOT_RECORD) !== 0)` |
| `NOT_CONNECTED` | `FCVAR_NOT_CONNECTED` | Prevent a client connected to a server from changing the ConVar. | `(typeof NOT_CONNECTED === "number") && ((nFlags & NOT_CONNECTED) !== 0)` |
| `ARCHIVE_XBOX` | `FCVAR_ARCHIVE_XBOX` | Save the ConVar in Xbox's `config.cfg` on branches that define the flag. | `(typeof ARCHIVE_XBOX === "number") && ((nFlags & ARCHIVE_XBOX) !== 0)` |
| `SERVER_CAN_EXECUTE` | `FCVAR_SERVER_CAN_EXECUTE` | Allow the server to execute this command on clients through the engine's client-command path. | `(typeof SERVER_CAN_EXECUTE === "number") && ((nFlags & SERVER_CAN_EXECUTE) !== 0)` |
| `SERVER_CANNOT_QUERY` | `FCVAR_SERVER_CANNOT_QUERY` | Prevent server queries through `IServerPluginHelpers::StartQueryCvarValue`. | `(typeof SERVER_CANNOT_QUERY === "number") && ((nFlags & SERVER_CANNOT_QUERY) !== 0)` |
| `CLIENT_COMMAND_CAN_EXECUTE` | `FCVAR_CLIENTCMD_CAN_EXECUTE` | Allow `IVEngineClient::ClientCmd` to execute this command; this flag does not restrict `ClientCmd_Unrestricted`. | `(typeof CLIENT_COMMAND_CAN_EXECUTE === "number") && ((nFlags & CLIENT_COMMAND_CAN_EXECUTE) !== 0)` |

The exact semantics are defined by the selected Source SDK. SourceJS exposes the listed native values without recreating or translating them in JavaScript. This is a selected export list, not every `FCVAR_*` macro in the SDK; an SDK-defined macro can still have no SourceJS export.

## Functions

| Export | Signature | Result |
| --- | --- | --- |
| [`GetConVarFlagConstant`](#getconvarflagconstantstrflagname) | `GetConVarFlagConstant(strFlagName)` | Returns the named finite Number property from the call receiver. Requires a non-empty primitive string name; throws for a nullish, non-numeric, or non-finite property. |

Call this function as a method of the `cvars/flags` module, or explicitly supply that module as its receiver. It reads `this[strFlagName]`, not an immutable native constant table: ordinary property lookup includes inherited properties and getters. It does not validate flag membership, integer representation, or an unmodified SDK value. A detached call does not automatically select the module. The flag name is case-sensitive and is preserved through explicit-length UTF-8 conversion, including embedded NUL bytes; it is not a ConVar name such as `"sv_cheats"`.

The native callback translates C++ exceptions into contextual JavaScript errors without exposing exception text. An error does not undo side effects from a receiver property getter.

## Examples

### Create a replicated ConVar

Use direct constant imports for ordinary plugin code:

```js
const { CreateConVar } = require("cvars/convar");
const { GAME_DLL, NOTIFY, REPLICATED } = require("cvars/flags");

if (!Number.isInteger(GAME_DLL) || !Number.isInteger(NOTIFY) || !Number.isInteger(REPLICATED)) {
	throw new Error("This Source SDK does not expose every required ConVar flag.");
}

const g_nRequiredFlags = GAME_DLL | NOTIFY | REPLICATED;
const g_EventModeConVar = CreateConVar("sjs_event_mode", "0", "Enable the synchronized SourceJS event mode.", g_nRequiredFlags);
if ((g_EventModeConVar.Flags & g_nRequiredFlags) !== g_nRequiredFlags) {
	throw new Error("sjs_event_mode does not have every required flag.");
}

console.log(`sjs_event_mode flags: ${g_EventModeConVar.Flags}`);
```

This example intentionally fails during initialization if the selected SDK omits one of the required flags; it does not substitute a fake value. Creating a missing ConVar also requires SDK creation support; the flag checks do not establish that capability. `CreateConVar` preserves an existing ConVar's flags, so the returned mask is checked too. A failed check does not undo creation. Use an exclusive plugin-owned name; setting `REPLICATED` alone does not create a matching client-side ConVar or implement event-mode behavior.

### Test a flag

Inspect the live mask returned by a ConVar object:

```js
const { RequireConVar } = require("cvars/convar");
const { CHEAT } = require("cvars/flags");

if (!Number.isInteger(CHEAT)) {
	throw new Error("This Source SDK does not expose FCVAR_CHEAT.");
}

const g_CheatsConVar = RequireConVar("sv_cheats");
const g_bHasCheatFlag = (g_CheatsConVar.Flags & CHEAT) !== 0;

console.log(`sv_cheats has FCVAR_CHEAT: ${g_bHasCheatFlag}`);
```

### Preserve a complete mask

On an SDK branch known to support flag removal, retain a shared ConVar's original flags and restore them afterward:

```js
const { RequireConVar, SetConVarFlags } = require("cvars");
const { NOTIFY } = require("cvars/flags");

const g_HostNameConVar = RequireConVar("hostname");
const g_nPreviousFlags = g_HostNameConVar.Flags;

if (!Number.isInteger(NOTIFY)) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

try {
	if (!SetConVarFlags(g_HostNameConVar.Name, g_nPreviousFlags | NOTIFY)) {
		throw new Error("Unable to apply the temporary hostname flags.");
	}

	if ((g_HostNameConVar.Flags & NOTIFY) === 0) {
		throw new Error("Notify was not applied to hostname.");
	}

	console.log(`Temporary hostname flags: ${g_HostNameConVar.Flags}`);
} finally {
	if (!SetConVarFlags(g_HostNameConVar.Name, g_nPreviousFlags)) {
		throw new Error("Unable to restore the original hostname flags.");
	}
}
```

When a requested replacement would remove flags on an SDK without removal support, `SetConVarFlags` throws rather than silently leaving an incorrect mask.

Restoration is attempted in `finally`, but a restoration exception can mask an earlier error. Restoring the whole saved mask can overwrite changes made by other plugins or callbacks. Use this pattern only while the native ConVar remains alive and you control changes to its flags; it is not a transaction.

### Discover selected SDK flags

A diagnostics command can enumerate integer-valued own enumerable properties of the module, excluding its function export. On an unmodified module these are the installed flags; added or changed numeric properties are not authenticated SDK constants:

```js
const g_CVarFlagsModule = require("cvars/flags");

function IsConVarFlagEntry(vecConVarFlagEntry) {
	return Number.isInteger(vecConVarFlagEntry[1]);
}

function CreateConVarFlagRecord(vecConVarFlagEntry) {
	return { Name: vecConVarFlagEntry[0], Value: vecConVarFlagEntry[1] };
}

const g_vecAvailableConVarFlags = Object.entries(g_CVarFlagsModule).filter(IsConVarFlagEntry).map(CreateConVarFlagRecord);
console.log(g_vecAvailableConVarFlags);
```

This is capability discovery, not a fallback. A plugin that requires a particular flag should check it and throw if it is absent.

### `GetConVarFlagConstant(strFlagName)`

Generic API inspectors can resolve a flag by its exact public name:

```js
const g_CVarFlagsModule = require("cvars/flags");

if (!Object.prototype.hasOwnProperty.call(g_CVarFlagsModule, "NOTIFY")) {
	throw new Error("This Source SDK does not expose FCVAR_NOTIFY.");
}

const g_nNotifyFlag = g_CVarFlagsModule.GetConVarFlagConstant("NOTIFY");
if (!Number.isInteger(g_nNotifyFlag) || (g_nNotifyFlag !== g_CVarFlagsModule.NOTIFY)) {
	throw new Error("CVar flag reflection returned inconsistent module data.");
}
```

Call `GetConVarFlagConstant` as a module method because the native function inspects its receiver. Ordinary plugins should import the named constant directly.

## Safe use

- Treat exported constant names as stable public keys, but check property presence before using a flag that is not available on every SDK branch. Do not substitute guessed values for absent constants.
- Flag values and combined masks use signed 32-bit JavaScript integer semantics even though the established live ConVar property is named `Flags`. Use `n`-prefixed project variables and do not assume a mask is non-negative.
- When changing flags on a shared ConVar, first require an SDK branch that supports flag removal, retain the complete original mask, and restore it in a `finally` block. `SetConVarFlags()` throws when a requested replacement needs unsupported removal.
- A plugin that requires a particular `FCVAR_*` capability should fail clearly during initialization when the corresponding property is absent.
- Call `GetConVarFlagConstant()` as a method of the `cvars/flags` module because it inspects its receiver and throws for a missing, non-numeric, or non-finite property.
- ConVar lookup, creation, and flag changes are synchronous native operations on the server/game thread; they are not background network requests. Borrowed ConVar objects do not keep their native records alive.

## Related files

- [`packages/sourcejs/cvars/flags.js`](../../packages/sourcejs/cvars/flags.js) — JavaScript entry point for the selected SDK's flag module.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — conditional native flag installation and reflective lookup callback.
- [`cvars.md`](cvars.md) — full ConVar value, flag mutation, constant, and registry API.
- [`cvars-convar.md`](cvars-convar.md) — native-backed ConVar lookup and creation objects.
- [`cvars-public.md`](cvars-public.md) — controls for public ConVars.
