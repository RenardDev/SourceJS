# `require("public")`

> AI processing note: this page documents mutable symbol metadata attached to caller-owned values and export
> targets. Keep value marking, target membership and CommonJS property assignment distinct.

`public` marks JavaScript objects and functions with normalized public names. Leading underscores are removed,
duplicate target names are avoided and `MarkPublic()` returns the exact input value.

The module stores metadata with global symbols rather than aliases or enumerable string fields.
`GetExportedNames(ExportTarget)` intentionally returns the live writable array owned by that target; edits affect later
`IsPublic(PublicValue, ExportTarget)` calls immediately.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Mark A Function](#mark-a-function)
- [Explicit Object Name](#explicit-object-name)
- [Symbols And Live Names](#symbols-and-live-names)
- [Query Public State](#query-public-state)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	PUBLIC_NAME,
	PUBLIC_NAMES,
	GetExportedNames,
	IsPublic,
	MarkPublic,
} = require("public");
```

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `PUBLIC_NAME` | Global `symbol` | Stores one value's normalized public name. |
| `PUBLIC_NAMES` | Global `symbol` | Stores one target's live public-name array. |
| [`MarkPublic(PublicValue, PublicOptions = undefined)`](#markpublicpublicvalue-publicoptions--undefined) | Function | Marks a value and optionally registers its name. |
| `GetExportedNames(ExportTarget)` | Function | Creates or returns the target's live writable name array. |
| [`IsPublic(PublicValue, ExportTarget = null)`](#ispublicpublicvalue-exporttarget--null) | Function | Tests value metadata or current target membership. |

Both symbols come from `Symbol.for()`, so imports in the same JavaScript symbol registry receive the same keys. Their compatibility registry strings are `sourcejs.public.name` and `sourcejs.public.names`; these are not CommonJS property names. Properties created by this module are non-enumerable, configurable and writable. Existing caller-supplied name-array metadata is checked for array type, not rewritten to enforce those descriptor flags.

## Mark A Function

### `MarkPublic(PublicValue, PublicOptions = undefined)`

When options have no own `Name`, `MarkPublic()` uses `PublicValue.name` and removes every leading underscore.
`PublicOptions.Target` appends the normalized name to that target's `PUBLIC_NAMES` array. The function does not assign
a CommonJS string property; module code owns that step.

Only own `Name` and `Target` option properties are read. An own `Name: undefined` is invalid rather than a request for inference. `Target: undefined` skips registration; `Target: null` is invalid. Normalization removes leading underscores only: it does not validate identifier syntax, change casing or turn arbitrary caller names into PascalCase. Author project-owned public names in PascalCase.

```js
const { GetExportedNames, MarkPublic } = require("public");

function CreatePluginStatusExports() {
	const ModuleExports = {};

	// The reflective fixture name starts with an underscore to demonstrate normalization.
	const LoadedPluginNames = function () {
		const { GetPluginRecords } = require("plugins");
		const vecPluginRecords = GetPluginRecords();
		const vecLoadedPluginNamesResult = [];
		for (const PluginRecord of vecPluginRecords) {
			vecLoadedPluginNamesResult.push(PluginRecord.Name);
		}

		return vecLoadedPluginNamesResult;
	};

	Object.defineProperty(LoadedPluginNames, "name", { value: "_LoadedPluginNames" });

	MarkPublic(LoadedPluginNames, { Target: ModuleExports });
	MarkPublic(LoadedPluginNames, { Target: ModuleExports });
	ModuleExports.LoadedPluginNames = LoadedPluginNames;

	return { ModuleExports, PublicNames: GetExportedNames(ModuleExports) };
}

module.exports = { CreatePluginStatusExports };
```

Calling `MarkPublic()` again with the same normalized name does not add a duplicate. A name made only of underscores
is invalid because normalization would produce an empty export name.

Every call infers or reads the requested name again; it does not reuse existing `PUBLIC_NAME` metadata. Re-marking a value under another name or target does not remove previous target registrations.

## Explicit Object Name

Use `PublicOptions.Name` for objects without a useful built-in `name` property:

```js
const { GetExportedNames, MarkPublic } = require("public");

function CreatePluginRegistry(vecPluginRecords) {
	const ModuleExports = {};
	const mapPluginRegistry = MarkPublic(new Map(), { Name: "PluginRegistry", Target: ModuleExports });
	for (const PluginRecord of vecPluginRecords) {
		mapPluginRegistry.set(PluginRecord.Name, PluginRecord);
	}

	ModuleExports.PluginRegistry = mapPluginRegistry;

	return {
		ModuleExports,
		PublicNames: GetExportedNames(ModuleExports),
	};
}

module.exports = { CreatePluginRegistry };
```

The returned `Map` and `ModuleExports.PluginRegistry` are the same object. `MarkPublic()` does not copy, freeze or
proxy the value.

## Symbols And Live Names

`PUBLIC_NAME` and `PUBLIC_NAMES` expose the underlying metadata. Deliberate writes are visible immediately, but
changing one symbol does not synchronize the other automatically:

```js
const {
	PUBLIC_NAME,
	PUBLIC_NAMES,
	GetExportedNames,
	MarkPublic,
} = require("public");

function InspectPublicSymbols() {
	const PublicExportTarget = {};
	const MatchService = MarkPublic({}, { Name: "_MatchService", Target: PublicExportTarget });
	const vecLivePublicNames = GetExportedNames(PublicExportTarget);
	vecLivePublicNames.push("ManualExport");

	return {
		LiveNames: GetExportedNames(PublicExportTarget),
		NameEnumerable: Object.prototype.propertyIsEnumerable.call(MatchService, PUBLIC_NAME),
		PublicName: MatchService[PUBLIC_NAME],
		SameArray: PublicExportTarget[PUBLIC_NAMES] === vecLivePublicNames,
		TargetNamesEnumerable: Object.prototype.propertyIsEnumerable.call(PublicExportTarget, PUBLIC_NAMES),
	};
}

module.exports = { InspectPublicSymbols };
```

Replacing `PublicExportTarget[PUBLIC_NAMES]` with a non-array makes `GetExportedNames()` and later target registrations
throw. Deleting the configurable property makes the next `GetExportedNames()` call create a new empty array.

Inherited name-array metadata is ignored; each target receives its own array when needed. Array elements and method overrides are not continuously validated. Keep normalized string names and standard array behavior; direct edits can introduce duplicates or names that do not correspond to any assigned export.

## Query Public State

### `IsPublic(PublicValue, ExportTarget = null)`

Without `ExportTarget`, `IsPublic()` requires an object or function with its own non-empty string `PUBLIC_NAME`.
With an export target, `PublicValue` may also be a string. An own `PUBLIC_NAME` is authoritative for objects and
functions; inherited metadata is ignored, and the ordinary `name` property is read only when own metadata is absent.
A malformed own `PUBLIC_NAME` returns `false` instead of falling back to `name`. The selected name has its leading
underscores removed before the target's current live array is checked.

`null` or omitted/`undefined` `ExportTarget` selects standalone checking. With a valid non-empty name and a non-null target, `IsPublic()` calls `GetExportedNames()` and can create an empty metadata array even when membership is `false`. Invalid values or names may return `false` before touching the target; accessors, proxies or invalid target metadata can throw. These are synchronous caller-thread operations, not pure or background queries.

```js
const { IsPublic, MarkPublic } = require("public");

function InspectPublicState() {
	const PublicExportTarget = {};

	// Fixture name intentionally begins with an underscore to demonstrate normalization.
	const StatusCommandWithLeadingUnderscore = function () {
	};

	Object.defineProperty(StatusCommandWithLeadingUnderscore, "name", { value: "_StatusCommand" });

	const MarkedStatusCommand = MarkPublic(StatusCommandWithLeadingUnderscore, { Target: PublicExportTarget });

	// Fixture name intentionally matches the normalized target name without metadata.
	const StatusCommand = function () {
	};

	Object.defineProperty(StatusCommand, "name", { value: "StatusCommand" });

	return {
		MarkedValue: IsPublic(MarkedStatusCommand),
		MarkedValueInTarget: IsPublic(MarkedStatusCommand, PublicExportTarget),
		MissingNameInTarget: IsPublic("MissingCommand", PublicExportTarget),
		PrimitiveWithoutTarget: IsPublic("StatusCommand"),
		SameOrdinaryNameInTarget: IsPublic(StatusCommand, PublicExportTarget),
		StringNameInTarget: IsPublic("StatusCommand", PublicExportTarget),
	};
}

module.exports = { InspectPublicState };
```

Target membership is name-based, not object-identity based. Therefore an unmarked function whose ordinary `name`
matches a registered target name returns `true` for `IsPublic(OrdinaryFunction, ExportTarget)` while remaining
`false` without the export target.

## Errors

- `MarkPublic()` throws `TypeError` for primitive values, missing names and names that normalize to an empty string.
- `PublicOptions` must be a non-null, non-array object when provided.
- A defined `PublicOptions.Target` and `GetExportedNames(ExportTarget)` require an object or function; arrays are allowed as values and targets when the other contracts are met.
- An existing `ExportTarget[PUBLIC_NAMES]` value must remain an array.
- Frozen, sealed or otherwise non-configurable caller-owned values may make metadata definition throw a native
  JavaScript error.
- Marking is not transactional: target metadata can be created before defining `PUBLIC_NAME`. If that definition fails, a new empty target array remains, without the requested name being appended. If appending fails, for example because a new name must be added to a frozen array, the value can already be marked. Earlier effects and caller accessor/proxy side effects are not rolled back.

Errors propagate synchronously; the module does not log, catch or replace them.

## Lifecycle

Metadata is stored on caller-owned values and targets; the module has no disposal or revocation operation. Reachability keeps the objects available, but callers can edit or delete metadata while they remain alive. Symbol identity and name membership are not an authorization or object-identity boundary.

`GetExportedNames(ExportTarget)` returns one mutable array, not a snapshot. Retaining it is intentional live access:
pushing, removing or replacing names changes target-membership queries immediately. Replacing or deleting
`PUBLIC_NAMES`, or editing `PUBLIC_NAME`, is also immediate and can separate value metadata from target membership.
After the target array is replaced or deleted, a retained old array is no longer connected to that target's current membership queries.

The symbols identify metadata only. They do not export CommonJS properties, preserve objects across destroyed plugin
V8 contexts or create cross-plugin communication. Isolated plugins must exchange serialized data through
[`plugins/bus`](plugins-bus.md).

## Related Modules

- [`plugins`](plugins.md) supplies current plugin records for the function example.
- [`plugins/bus`](plugins-bus.md) provides serialized communication between isolated plugin contexts.
