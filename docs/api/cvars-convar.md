# `require("cvars/convar")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Live ConVar objects](#live-convar-objects)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

[`packages/sourcejs/cvars/convar.js`](../../packages/sourcejs/cvars/convar.js) returns the focused native ConVar module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp).

Use `cvars/convar` when a plugin needs native-backed ConVar lookup and creation objects but does not need the value, flag, constant, and registry helpers exported by the root [`cvars`](cvars.md) module. The narrow surface keeps object-returning operations together while preserving the same live engine state and public properties as the root module.

## Import

```js
const { FindConVar, RequireConVar, CreateConVar } = require("cvars/convar");
```

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| [`FindConVar`](#findconvarstrconvarname) | `FindConVar(strConVarName)` | Live ConVar object or `{ Exists: false }`. |
| [`RequireConVar`](#requireconvarstrconvarname) | `RequireConVar(strConVarName)` | Live ConVar object; throws when missing. |
| [`CreateConVar`](#createconvarstrconvarname-value-strdescription-nflags-flminimumvalue-flmaximumvalue) | `CreateConVar(strConVarName, Value?, strDescription?, nFlags?, flMinimumValue?, flMaximumValue?)` | Existing or newly created live ConVar object. An existing ConVar is returned without applying the optional creation arguments; a conflicting command name throws. Creating a missing ConVar requires SDK support. |

## Live ConVar objects

The returned objects expose the same live properties documented for [`cvars`](cvars.md). Writes to `Value`, `IntValue`, `FloatValue`, `BooleanValue`, and supported `Flags` update the native ConVar immediately; selected SDK range metadata remains live and read-only.

Use that live-property contract for primitive-value requirements, string conversion, native-exception translation, and borrowed-object lifetime. These wrappers do not turn a native address into an owning handle or make callback side effects transactional.

## Examples

### `FindConVar(strConVarName)`

Probe an optional game-specific ConVar without treating absence as an error:

```js
const { FindConVar } = require("cvars/convar");

const g_AllTalkConVar = FindConVar("sv_alltalk");
if (g_AllTalkConVar.Exists) {
	console.log(`sv_alltalk is ${g_AllTalkConVar.BooleanValue ? "enabled" : "disabled"}.`);
} else {
	console.log("The selected game does not expose sv_alltalk.");
}
```

The missing result is not `null`. It owns one writable, enumerable, configurable data property, `Exists`, with value `false`; inherited setters and non-writable inherited properties cannot intercept or suppress its initialization. This sentinel is distinct from a live ConVar wrapper's native `Exists` accessor.

### `RequireConVar(strConVarName)`

Use `RequireConVar` for mandatory engine state and restore temporary changes through the same live object:

```js
const { RequireConVar } = require("cvars/convar");

const g_HostNameConVar = RequireConVar("hostname");
const g_strPreviousHostName = g_HostNameConVar.Value;

try {
	g_HostNameConVar.Value = "SourceJS tournament server";
	if (g_HostNameConVar.Value !== "SourceJS tournament server") {
		throw new Error("The tournament hostname was not applied.");
	}

	console.log(`Temporary hostname: ${g_HostNameConVar.Value}`);
} finally {
	g_HostNameConVar.Value = g_strPreviousHostName;
}
```

`RequireConVar` throws `ConVar not found: <name>` when the selected game does not register the requested ConVar.

The preceding example attempts restoration in `finally`; it does not verify the restored value. A restoration exception can replace an earlier error. Use it only while the native ConVar remains alive and you control changes to it: restoring a saved value can overwrite changes made by callbacks or other plugins.

### `CreateConVar(strConVarName, Value?, strDescription?, nFlags?, flMinimumValue?, flMaximumValue?)`

Create one stable, plugin-prefixed configuration variable and update it through its live numeric view:

```js
const { CreateConVar } = require("cvars/convar");

const g_DamageScaleConVar = CreateConVar("sjs_damage_scale", "1.0", "Damage multiplier used by the SourceJS event plugin.", 0, 0.1, 5.0);
g_DamageScaleConVar.FloatValue = 1.25;
if (g_DamageScaleConVar.FloatValue !== 1.25) {
	throw new Error("sjs_damage_scale did not update its native ConVar.");
}
```

If the name already belongs to a ConVar, `CreateConVar` returns that object without replacing its original value, description, flags, or range. It throws when the name belongs to a command. For a missing name, it also throws when the selected SDK cannot create ConVars. This API has no deletion operation for SourceJS-created ConVars; plugin unload does not undo their creation.

Unloading the SourceJS runtime unregisters its created ConVars before engine interfaces disconnect. Their native objects and backing strings remain alive until DLL teardown because SDK pending lists can still borrow them. A later `CreateConVar()` for the same owned name reuses that cached object rather than reconstructing it; its previous value and creation metadata are retained. This does not retain or unregister externally owned ConVars.

## Safe use

- This is a synchronous server-thread API. Lookup, creation, reads, and writes use the live engine interface; they are not background requests.
- Treat the live-object properties as stable public keys. A `FindConVar()` miss exposes only `Exists: false`, so check it before reading any other property. PascalCase property names do not rename external engine ConVar names such as `sv_alltalk`.
- ConVar names must be JavaScript strings, and `CreateConVar()` also requires a non-empty name; an embedded NUL is rejected before engine lookup. Avoid embedded NUL characters in values and descriptions: the native engine consumes null-terminated strings, so text after a NUL is not preserved at that boundary.
- When creating a missing ConVar, omitted, `null`, or `undefined` optional arguments retain their defaults: value `"0"`, description `""`, flags `0`, and no bounds. Supplied value and description arguments use JavaScript string conversion, which can run user code and throw. Existing ConVars bypass these conversions and other optional-argument validation. Lookup is repeated after conversion: a command created by conversion code still conflicts, while a newly registered ConVar is reused.
- Live properties expose native engine state; assignments to writable properties update it. Change only ConVars your plugin owns or whose lifecycle contract you understand, and restore temporary values in `finally` blocks.
- Use a stable plugin-specific prefix for created names. Plugin unload does not delete SourceJS-created ConVars through this API. A JavaScript wrapper borrows the native object; retaining the wrapper does not keep an externally owned ConVar alive.
- `CreateConVar()` returns an existing ConVar unchanged when the name is already registered, throws when the name belongs to a command, and cannot create a new variable on unsupported SDK branches.
- `nFlags` is a signed 32-bit mask even though the established live property is named `Flags`. Creation applies JavaScript's signed 32-bit integer conversion to supplied flags; validate inputs first if coercion, truncation, or wraparound is unacceptable. Do not assume every flag or flag-removal operation is available on every SDK branch. On legacy console-API branches, SourceJS adds the reserved ownership bit `0x80000000` to its created ConVars so the SDK can unlink them safely. That bit can appear in the signed `Flags` result; preserve it in masks and do not assign it a plugin-specific meaning.
- SourceJS does not add an explicit engine registration when `FCVAR_UNREGISTERED` is set. Visibility still follows the selected SDK's constructor/registration behavior; do not assume such a variable is discoverable by name.
- Range properties exist only on SDK branches with native ConVar creation support. For a new ConVar, supplied bounds undergo JavaScript number conversion and must then be finite and fit the native float range; validate minimum/maximum ordering yourself. Native float rounding and range clamping can affect `FloatValue`; verify a write when its exact result matters. Existing ConVars bypass validation of the optional creation arguments.

## Related files

- [`packages/sourcejs/cvars/convar.js`](../../packages/sourcejs/cvars/convar.js) — JavaScript entry point for this focused native module.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — native callbacks, live-property bindings, SDK feature gates, and module installation.
- [`cvars.md`](cvars.md) — full ConVar value, flag, constant, and registry API.
- [`cvars-flags.md`](cvars-flags.md) — `FCVAR_*` constants for the selected SDK.
- [`cvars-public.md`](cvars-public.md) — public-visibility controls for ConVars.
