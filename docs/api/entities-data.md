# `require("entities/data")`

> AI-processing note: this page is a hand-maintained reference for the complete entity-profile loader. The returned records are live cached JavaScript objects, not native entity instances or immutable documentation snapshots.

The [`entities/data` package](../../packages/sourcejs/entities/data.js) loads SourceJS entity metadata from `addons/sourcejs/data/sourcejs/entities`. It merges the required common files with the groups selected for one exact Source 1 SDK branch and exposes the resulting class, property, input, KeyValue, function, virtual-function, instance-attribute, and based-attribute descriptors.

## Table of contents

- [Import](#import)
- [Ownership and lifecycle](#ownership-and-lifecycle)
- [Files and SDK routing](#files-and-sdk-routing)
- [Class records](#class-records)
- [Descriptor records](#descriptor-records)
- [API reference](#api-reference)
- [Practical workflows](#practical-workflows)
- [Errors and common mistakes](#errors-and-common-mistakes)

## Import

The module has exactly these 17 exports:

```js
const {
	ClearEntityDataCache,
	GetEntityBasedAttributeDescriptor,
	GetEntityClassData,
	GetEntityClassDataNames,
	GetEntityDataGroups,
	GetEntityDataPath,
	GetEntityDataSection,
	GetEntityFunctionDescriptor,
	GetEntityInputDescriptor,
	GetEntityInstanceAttributeDescriptor,
	GetEntityKeyValueDescriptor,
	GetEntityPropertyDescriptor,
	GetEntityVirtualFunctionDescriptor,
	GetSupportedEntityDataGroups,
	GetSupportedEntityDataSDKBranches,
	HasEntityClassData,
	LoadEntityData,
} = require("entities/data");
```

## Ownership and lifecycle

The module owns two module-local caches inside the current isolated plugin context:

- one parsed `index.json` object;
- one merged class map per SDK branch.

`LoadEntityData(strSDKBranch)` returns the same live object until `ClearEntityDataCache()` is called. `GetEntityClassData()`, `GetEntityDataSection()`, and every descriptor getter return references inside that object. Changes are immediately visible through later reads in the same plugin context.

Index and profile cache misses perform synchronous filesystem reads. The loader does not schedule background work; coordinate reload timing with the consumers that must reacquire their records.

`ClearEntityDataCache()` removes the module's references to every branch map and the parsed index. It does not mutate objects already held by plugin code. The next index- or branch-backed read reparses the required files from disk; object-returning APIs then expose new objects.

Use cache edits for deliberate runtime metadata overrides. Restore temporary edits in `finally`, and call `ClearEntityDataCache()` only when every consumer is ready to reacquire its records.

## Files and SDK routing

### Data root

`GetEntityDataPath(strEntityDataPath = "index.json")` joins `paths.SOURCE_DATA_ROOT`, `entities`, and `strEntityDataPath` with forward slashes.

The join normalizes slashes while preserving a valid leading UNC pair (`//server/share`); it does not reject `..` or establish containment within the entity-data directory. Supply trusted relative profile paths rather than untrusted fragments.

Typical installed paths are:

```text
addons/sourcejs/data/sourcejs/entities/index.json
addons/sourcejs/data/sourcejs/entities/CBaseEntity.ini
addons/sourcejs/data/sourcejs/entities/orangebox/CBaseEntity.ini
addons/sourcejs/data/sourcejs/entities/csgo/CCSPlayer.ini
```

The index and every group and INI file on the selected branch route are mandatory. A missing selected entry or file throws; there is no empty-profile fallback. Files belonging only to unselected groups are not read during that load.

### Supported branches

`GetSupportedEntityDataSDKBranches()` returns the frozen canonical branch array:

```text
bgt, blade, bms, contagion, csgo, css, darkm, dods, doi, episode1,
eye, gmod, hl2dm, insurgency, l4d, l4d2, mcv, nucleardawn,
orangebox, portal2, pvkii, sdk2013, swarm, tf2
```

Source 2 branches are not accepted because this project is a Source 1 VSP.

### Group order

`GetEntityDataGroups(strSDKBranch)` always prepends `common`, then appends the exact groups configured for the branch. Files are merged in that order, so later game-specific fields override matching common fields.

| Branches | Groups after `common` |
| --- | --- |
| `bms` | `bms` |
| `csgo` | `csgo` |
| `css` | `orangebox`, `orangebox/cstrike` |
| `dods` | `orangebox`, `orangebox/dod` |
| `gmod` | `gmod` |
| `hl2dm` | `orangebox`, `orangebox/hl2mp` |
| `l4d2` | `l4d2` |
| `orangebox`, `sdk2013` | `orangebox` |
| `tf2` | `orangebox`, `orangebox/tf` |
| Other supported branches | no branch-specific group |

`GetSupportedEntityDataGroups()` returns every group key currently defined in `index.json`, including groups that are not selected by one of the active branch routes.

## Class records

`LoadEntityData(strSDKBranch)` returns an object keyed by SDK class name. Every class record has this shape:

| Field | Type | Meaning |
| --- | --- | --- |
| `ClassName` | string | Class name derived from the INI filename. |
| `Binary` | string | Binary used by function descriptors; defaults to `server`. |
| `ServerCheckEnabled` | boolean | Whether server-side signature checking is enabled; defaults to `true`. |
| `BasedAttributes` | object | Normalized `based_attribute` descriptors. |
| `Functions` | object | Signature/symbol-based function descriptors. |
| `Inputs` | object | Entity input names and optional type metadata. |
| `InstanceAttributes` | object | Typed fields at fixed byte offsets from the native entity address. |
| `KeyValues` | object | Hammer/engine KeyValue descriptors. |
| `Properties` | object | Sendprop/datamap property paths. |
| `VirtualFunctions` | object | Virtual-table offsets and call metadata. |

The seven descriptor containers are always objects, even when the selected profile contributes no members to one section.

For example, the TF2 `CBaseEntity` record merges the common, `orangebox`, and `orangebox/tf` files in that order. The common file contributes inputs and KeyValues, `orangebox/CBaseEntity.ini` adds virtual functions and another input, and `orangebox/tf/CBaseEntity.ini` overrides TF2-specific virtual-function offsets.

Descriptor maps merge by name, and matching descriptors merge shallowly: later supplied fields replace earlier fields while omitted fields remain. Class-level `Binary` and `ServerCheckEnabled` are different: every contributing file assigns them after applying its own defaults. A later file that omits these settings resets them to `server` and `true`; it does not inherit an earlier file's values.

## Descriptor records

`#` starts a comment only outside a double-quoted value. Inside quotes, escaped quotes do not end the value; `\"` and `\\` decode to `"` and `\`, respectively. A comment after the closing quote is discarded.

### Simple entries

An INI entry such as:

```ini
[input]
	AddContext = AddContext
```

becomes:

```js
const g_InputDescriptor = { Name: "AddContext", Section: "Input" };
```

### Nested entries

Nested INI fields are converted to their documented PascalCase API names and retained on one live descriptor. For example:

```ini
[virtual_function]
	[[SetModel]]
		offset_linux = 27
		offset_windows = 26
		arguments = string
```

becomes:

```js
const g_VirtualFunctionDescriptor = { Name: "SetModel", Section: "VirtualFunction", Arguments: ["string"], OffsetLinux: 27, OffsetWindows: 26 };
```

Every normalized descriptor contains `Name` and `Section`. The remaining fields are present only when the INI entry supplies their source values:

| Field | Type | Meaning |
| --- | --- | --- |
| `Name` | string | Public descriptor name or underlying property/input name. |
| `Section` | string | `BasedAttribute`, `Function`, `Input`, `InstanceAttribute`, `KeyValue`, `Property`, or `VirtualFunction`. |
| `Type` | string | Data type for a property, input, KeyValue, instance attribute, or based attribute. |
| `ReturnType` | string | Function or virtual-function return data type. |
| `Arguments` | string[] | Ordered function or virtual-function argument data types. |
| `Documentation` | string | Human-readable descriptor documentation. |
| `IdentifierWindows` | string | Windows signature or symbol identifier. |
| `IdentifierLinux` | string | Linux signature or symbol identifier. |
| `OffsetWindows` | number | Windows virtual-table index, or byte offset for an instance attribute. |
| `OffsetLinux` | number | Linux virtual-table index, or byte offset for an instance attribute. |
| `Base` | string | Base property used by a based attribute. |
| `Offset` | number | Byte offset relative to `Base` for a based attribute, or relative to the entity instance for an instance attribute. |

Normalized descriptors expose only the documented fields above. Unknown INI fields are not retained.

The types above describe valid profile metadata, not comprehensive validation of every field. The loader validates data-type names, argument lists, and instance-attribute offsets, but passes through other descriptor metadata such as function identifiers, based-attribute offsets, and virtual-table offsets. Validate the selected metadata against the current platform and native ABI before using it for a memory call.

### Instance attributes

The `[instance_attribute]` source section exposes typed fields at fixed offsets from an entity's native address. For example, the CS:GO sensor grenade timer uses:

```ini
[instance_attribute]
	[[Timer]]
		offset_windows = 0x570
		offset_linux = 0x588
		type = float
```

```js
const { GetEntityInstanceAttributeDescriptor } = require("entities/data");
const { LogInfo } = require("loggers");

const g_TimerInstanceAttributeDescriptor = GetEntityInstanceAttributeDescriptor("CSensorGrenadeProjectile", "Timer", "csgo");
if (g_TimerInstanceAttributeDescriptor === null) {
	throw new Error("The CS:GO sensor grenade profile has no Timer descriptor.");
}

LogInfo("%j", {
	Operation: "InspectEntityInstanceAttribute",
	LinuxByteOffset: g_TimerInstanceAttributeDescriptor.OffsetLinux,
	Type: g_TimerInstanceAttributeDescriptor.Type,
	WindowsByteOffset: g_TimerInstanceAttributeDescriptor.OffsetWindows,
});
```

Instance-attribute offsets accept nonnegative safe-integer numbers or hexadecimal integer strings and are returned as numbers. Negative, fractional, non-finite, malformed, and out-of-range values throw. These offsets count bytes, not virtual-table slots or absolute addresses; convert an offset to `BigInt` before adding it to a native address. The loader returns metadata only: it does not read entity memory, validate an entity's allocation bounds, or extend its lifetime. Select the current platform's offset and keep the entity alive before using a memory API.

### Type normalization

Project-owned profiles use the compact lowercase descriptor values below as type names, such as `short` and `string`. The loader also accepts the exact legacy profile spellings for imported data. Section tags and nested metadata keys retain their existing file-format spelling.

| Legacy profile type | Canonical profile type / descriptor value |
| --- | --- |
| `BOOL` | `bool` |
| `Color` | `color` |
| `FLOAT` | `float` |
| `INT` | `int` |
| `ADDRESS` | `address` |
| `QAngle` | `qangle` |
| `SHORT` | `short` |
| `STRING` | `string` |
| `STRING_ARRAY` | `stringarray` |
| `UINT` | `uint` |
| `Vector` | `vector` |

Unknown type names throw while the profile is loading. Function and virtual-function argument lists are normalized to arrays in declared order.

The CS:GO `CBaseEntity.Teleport` virtual-function descriptor declares `["address", "address", "address", "bool"]`: position, angles, velocity, and the engine's fourth boolean parameter. This is a native ABI requirement, not a fourth coordinate. Callers of the CS:GO raw descriptor must provide it explicitly; do not reuse a three-argument descriptor from an older SDK branch. This metadata does not supply a default value.

## API reference

### Cache and paths

| Function | Result |
| --- | --- |
| `GetEntityDataPath(strEntityDataPath = "index.json")` | Joined Source filesystem path using the entity-data prefix; not a containment check. |
| `ClearEntityDataCache()` | Evicts every cached branch map and drops the parsed-index reference; returns `undefined`. |

### Inventory and loading

| Function | Result |
| --- | --- |
| `GetSupportedEntityDataSDKBranches()` | Frozen array of all 24 supported Source 1 branch names. |
| `GetSupportedEntityDataGroups()` | Current group names from the required index. |
| `GetEntityDataGroups(strSDKBranch?)` | Ordered `common` plus branch-specific groups. |
| `LoadEntityData(strSDKBranch?)` | Live merged class map for the branch. |
| `GetEntityClassDataNames(strSDKBranch?)` | Current class-map keys. |

When `strSDKBranch` is omitted, the active global SDK branch is used. Branch arguments are trimmed and lowercased before lookup. Non-string or empty normalized names throw `TypeError`; other unsupported normalized names throw `RangeError`. Use `l4d2`, not `left4dead2`.

### Class and section lookup

| Function | Result |
| --- | --- |
| `HasEntityClassData(strEntityClassName, strSDKBranch?)` | Whether the merged map owns the exact class key. |
| `GetEntityClassData(strEntityClassName, strSDKBranch?)` | Live class record or `null`. |
| `GetEntityDataSection(strEntityClassName, strEntityDataSectionName, strSDKBranch?)` | Live section object or `null`. Recognized logical names are `BasedAttributes`, `Functions`, `Inputs`, `InstanceAttributes`, `KeyValues`, `Properties`, and `VirtualFunctions`; snake-case inputs normalize to those names. |

Class names are case-sensitive and are not trimmed or otherwise normalized. Class and section lookup names must be non-empty strings; an unknown class or logical section returns `null`. Only the registered own section names above are recognized; inherited aliases cannot select a section or another class-record field.

### Descriptor lookup

| Function | Section | Result |
| --- | --- | --- |
| `GetEntityBasedAttributeDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch?)` | `BasedAttributes` | Live descriptor or `null`. |
| `GetEntityFunctionDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch?)` | `Functions` | Live descriptor or `null`. |
| `GetEntityInputDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch?)` | `Inputs` | Live descriptor or `null`. |
| `GetEntityInstanceAttributeDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch?)` | `InstanceAttributes` | Live instance-attribute descriptor or `null`. |
| `GetEntityKeyValueDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch?)` | `KeyValues` | Live descriptor or `null`. |
| `GetEntityPropertyDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch?)` | `Properties` | Live descriptor or `null`. |
| `GetEntityVirtualFunctionDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch?)` | `VirtualFunctions` | Live descriptor or `null`. |

Descriptor lookup names are trimmed, leading underscores are removed, and snake-case segments are converted to PascalCase. Prefer the canonical public names returned by `Object.keys(EntityDataSection)`.

## Practical workflows

### Inspect installed paths and profile coverage

```js
const {
	GetEntityDataGroups,
	GetEntityDataPath,
	GetSupportedEntityDataGroups,
	GetSupportedEntityDataSDKBranches,
} = require("entities/data");
const { LogInfo } = require("loggers");

const g_vecSDKBranches = GetSupportedEntityDataSDKBranches();
LogInfo("%j", {
	Operation: "InspectEntityDataCoverage",
	EntityDataGroups: GetSupportedEntityDataGroups(),
	IndexPath: GetEntityDataPath(),
	L4D2EntityDataGroups: GetEntityDataGroups("l4d2"),
	SDKBranchCount: g_vecSDKBranches.length,
	TF2EntityDataGroups: GetEntityDataGroups("tf2"),
});
```

### Load one branch and inspect its classes

```js
const {
	GetEntityClassData,
	GetEntityClassDataNames,
	HasEntityClassData,
	LoadEntityData,
} = require("entities/data");
const { LogInfo } = require("loggers");

const g_EntityClasses = LoadEntityData("tf2");
const g_vecEntityClassNames = GetEntityClassDataNames("tf2");
const g_BaseEntity = GetEntityClassData("CBaseEntity", "tf2");
if (!HasEntityClassData("CBaseEntity", "tf2") || !g_BaseEntity) {
	throw new Error("The required CBaseEntity profile is missing.");
}

LogInfo("%j", {
	Operation: "InspectEntityClassData",
	Binary: g_BaseEntity.Binary,
	EntityClassCount: g_vecEntityClassNames.length,
	SameRecord: g_EntityClasses.CBaseEntity === g_BaseEntity,
	ServerCheckEnabled: g_BaseEntity.ServerCheckEnabled,
});
```

### Read input, KeyValue, property, and section metadata

```js
const {
	GetEntityDataSection,
	GetEntityInputDescriptor,
	GetEntityKeyValueDescriptor,
	GetEntityPropertyDescriptor,
} = require("entities/data");
const { LogInfo } = require("loggers");

const g_EntityInputs = GetEntityDataSection("CBaseEntity", "Inputs", "tf2");
const g_AddContextDescriptor = GetEntityInputDescriptor("CBaseEntity", "AddContext", "tf2");
const g_RenderAmountDescriptor = GetEntityKeyValueDescriptor("CBaseEntity", "RenderAmount", "tf2");
const g_MaximumSpeedDescriptor = GetEntityPropertyDescriptor("CFuncRotating", "MaximumSpeed", "l4d2");
if (!g_EntityInputs || !g_AddContextDescriptor || !g_RenderAmountDescriptor || !g_MaximumSpeedDescriptor) {
	throw new Error("The required TF2/L4D2 entity descriptors are incomplete.");
}

LogInfo("%j", {
	Operation: "InspectEntityDescriptors",
	AddContextDescriptor: g_AddContextDescriptor,
	InputCount: Object.keys(g_EntityInputs).length,
	MaximumSpeedDescriptor: g_MaximumSpeedDescriptor,
	RenderAmountDescriptor: g_RenderAmountDescriptor,
});
```

### Resolve function and based-attribute metadata

```js
const {
	GetEntityBasedAttributeDescriptor,
	GetEntityFunctionDescriptor,
	GetEntityVirtualFunctionDescriptor,
} = require("entities/data");
const { LogInfo } = require("loggers");

const g_SwitchTeamFunctionDescriptor = GetEntityFunctionDescriptor("CCSPlayer", "SwitchTeam", "csgo");
const g_ScoreBasedAttributeDescriptor = GetEntityBasedAttributeDescriptor("CCSPlayer", "Score", "csgo");
const g_SetModelVirtualFunctionDescriptor = GetEntityVirtualFunctionDescriptor("CBaseEntity", "SetModel", "tf2");
if (!g_SwitchTeamFunctionDescriptor || !g_ScoreBasedAttributeDescriptor || !g_SetModelVirtualFunctionDescriptor) {
	throw new Error("The selected entity metadata is incomplete.");
}

LogInfo("%j", {
	Operation: "InspectEntityCallableMetadata",
	ScoreBase: g_ScoreBasedAttributeDescriptor.Base,
	ScoreOffset: g_ScoreBasedAttributeDescriptor.Offset,
	SetModelArguments: g_SetModelVirtualFunctionDescriptor.Arguments,
	SetModelOffsets: { Linux: g_SetModelVirtualFunctionDescriptor.OffsetLinux, Windows: g_SetModelVirtualFunctionDescriptor.OffsetWindows },
	SwitchTeamArguments: g_SwitchTeamFunctionDescriptor.Arguments,
	SwitchTeamLinuxIdentifier: g_SwitchTeamFunctionDescriptor.IdentifierLinux,
});
```

These descriptors are metadata, not callable functions or properties. A consumer must select the current platform's function identifier or virtual-table index, or resolve the based property plus byte offset, and pass the required fields to a memory API or higher-level entity wrapper.

### Apply a temporary live metadata override

```js
const { GetEntityVirtualFunctionDescriptor, LoadEntityData } = require("entities/data");
const { LogInfo } = require("loggers");

const g_EntityClassMap = LoadEntityData("tf2");
const g_SetModelVirtualFunctionDescriptor = GetEntityVirtualFunctionDescriptor("CBaseEntity", "SetModel", "tf2");
if (!g_SetModelVirtualFunctionDescriptor) {
	throw new Error("The TF2 CBaseEntity.SetModel descriptor is unavailable.");
}

const g_bHadSetModelDocumentation = Object.hasOwn(g_SetModelVirtualFunctionDescriptor, "Documentation");
const g_PreviousSetModelDocumentation = g_bHadSetModelDocumentation ? g_SetModelVirtualFunctionDescriptor.Documentation : undefined;

try {
	g_SetModelVirtualFunctionDescriptor.Documentation = "Temporary plugin-local note";
	if (g_EntityClassMap.CBaseEntity.VirtualFunctions.SetModel.Documentation !== g_SetModelVirtualFunctionDescriptor.Documentation) {
		throw new Error("Entity metadata is no longer a live cache view.");
	}

	LogInfo("%j", { Operation: "OverrideEntityMetadata", Documentation: g_SetModelVirtualFunctionDescriptor.Documentation });
} finally {
	if (!g_bHadSetModelDocumentation) {
		delete g_SetModelVirtualFunctionDescriptor.Documentation;
	} else {
		g_SetModelVirtualFunctionDescriptor.Documentation = g_PreviousSetModelDocumentation;
	}
}
```

### Re-read profile files after clearing all entity-data caches

```js
const { ClearEntityDataCache, LoadEntityData } = require("entities/data");
const { LogInfo } = require("loggers");

const g_PreviousEntityClassMap = LoadEntityData("blade");

ClearEntityDataCache();

const g_CurrentEntityClassMap = LoadEntityData("blade");
if (g_CurrentEntityClassMap === g_PreviousEntityClassMap) {
	throw new Error("ClearEntityDataCache() did not evict the branch-cache entry.");
}

LogInfo("%j", { Operation: "ReloadEntityMetadata", ClassNames: Object.keys(g_CurrentEntityClassMap) });
```

### Require metadata before installing a feature

```js
const { GetEntityFunctionDescriptor, GetEntityVirtualFunctionDescriptor } = require("entities/data");
const { LogInfo } = require("loggers");

const g_RequireEntityDataDescriptor = function RequireEntityDataDescriptor(EntityDataDescriptor, strDescriptorLabel) {
	if (!EntityDataDescriptor) {
		throw new Error(`Required entity descriptor is missing: ${strDescriptorLabel}`);
	}

	return EntityDataDescriptor;
};

const g_SwitchTeamFunctionDescriptor = g_RequireEntityDataDescriptor(GetEntityFunctionDescriptor("CCSPlayer", "SwitchTeam", "csgo"), "csgo/CCSPlayer.SwitchTeam");
const g_SetModelVirtualFunctionDescriptor = g_RequireEntityDataDescriptor(GetEntityVirtualFunctionDescriptor("CBaseEntity", "SetModel", "tf2"), "tf2/CBaseEntity.SetModel");
LogInfo("%j", { Operation: "RequireEntityMetadata", SetModelVirtualFunctionDescriptor: g_SetModelVirtualFunctionDescriptor, SwitchTeamFunctionDescriptor: g_SwitchTeamFunctionDescriptor });
```

## Errors and common mistakes

- Do not use a Source 2 branch or an unsupported game alias; only values that normalize to one of the 24 supported Source 1 branch identifiers are accepted. Input is trimmed and lowercased.
- Do not assume every branch has a game-specific group; `common` can be the complete route.
- Do not treat `GetSupportedEntityDataGroups()` as the active branch route; use `GetEntityDataGroups(strSDKBranch)` for that.
- Do not mutate the frozen array returned by `GetSupportedEntityDataSDKBranches()`.
- Do not treat `LoadEntityData()` or descriptor getters as snapshots; they return shared live cache objects.
- Do not keep using cache records after a coordinated `ClearEntityDataCache()` when identity matters; reacquire them.
- Do not call a function or virtual-function descriptor directly; resolve it through the owning memory/entity API.
- Do not silently continue after a missing required descriptor. Throw during feature initialization.
- Do not add unknown type names to INI files; profile loading rejects them.
- Do not edit installed profile files for temporary runtime behavior; mutate and restore the plugin-local cache instead.

Related modules: [`entities/datamaps`](entities-datamaps.md), [`entities/outputs`](entities-outputs.md), [`entities/props`](entities-props.md), [`memory/gamedata`](memory-gamedata.md), and [`memory/manager`](memory-manager.md).
