# `require("entities/helpers")`

> Warning: this page documents low-level identities for live Source entities. An address, edict, or handle is valid only while the same entity occupies that engine slot. Use the table of contents to keep conversions and lifetime rules together.

The [package](../../packages/sourcejs/entities/helpers.js) exposes the native entity-conversion helpers installed by [ModuleBindings.cpp](../../src/sourcejs/modules/ModuleBindings.cpp). Use it when an SDK callback, datamap field, extension, or memory hook gives one entity representation and another native API requires a different representation.

## Table of contents

- [Import and capabilities](#import-and-capabilities)
- [Entity representations](#entity-representations)
- [Queries](#queries)
- [Conversion matrix](#conversion-matrix)
- [Output names](#output-names)
- [Practical workflows](#practical-workflows)
- [Lifetime and errors](#lifetime-and-errors)
- [Related modules](#related-modules)

## Import and capabilities

```js
const g_EntityHelpers = require("entities/helpers");
const { LogInfo } = require("loggers");

const g_ReportEntityHelperCapabilities = function ReportEntityHelperCapabilities() {
	LogInfo("ReportEntityHelperCapabilities Result=%j", { FindEntityOutputNameByAddressAvailable: typeof g_EntityHelpers.FindEntityOutputNameByAddress === "function", ExportNames: Object.keys(g_EntityHelpers).sort() });
};

g_ReportEntityHelperCapabilities();
```

The whole-module import is intentional in this capability inventory because the example inspects the exact runtime export set. Operational examples below import each function directly.

The 32 query and conversion functions are always installed on supported Source 1 builds. `FindEntityOutputNameByAddress` is present only when the selected HL2SDK exposes datamaps. SourceJS omits the unavailable function; it does not install a JavaScript fallback or a `findOutputName` alias.

Native address inputs must be non-negative JavaScript `BigInt` values within the native `uintptr_t` range. Address inputs are not coerced from Numbers, strings, bare `{ Address }` wrappers, or arbitrary objects.

Use these helpers on the game thread. World-dependent conversions require a live map and entity list. Records, addresses, and handles borrow engine identity; they do not retain an entity or make native memory safe to use after removal.

## Entity representations

The conversion functions describe one live entity through six representations:

| Representation | JavaScript shape | Meaning |
| --- | --- | --- |
| Index | signed `Int32` number | Current engine edict index. |
| Edict | object | Point-in-time identity record for an `edict_t*`. |
| Base entity | object | Point-in-time identity record for a `CBaseEntity*`. |
| Base handle | object | Serial-aware `CBaseHandle` identity record. |
| Integer handle | `Number` in `0..0xFFFFFFFF` | Unsigned 32-bit `CBaseHandle::ToInt()` value. |
| Address | non-negative `BigInt` | Current `CBaseEntity*` address within the native `uintptr_t` range. |

### Edict record

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | string | Always `"edict"`. |
| `Address` | `BigInt` | Native `edict_t*` address. |
| `Index` | number | Entity index at conversion time. |
| `ClassName` | string | Snapshot of `IServerNetworkable::GetClassName()`, or `""` when unavailable. |

Only the four PascalCase fields in the table are installed. The record does not expose lower-camel aliases.

### Base-entity record

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | string | Always `"baseentity"`. |
| `Address` | `BigInt` | Native `CBaseEntity*` address. |
| `Index` | number | Entity index at conversion time. |
| `ClassName` | string | Snapshot of `IServerNetworkable::GetClassName()`, or `""` when unavailable. |

Only the four PascalCase fields in the table are installed. The record does not expose lower-camel aliases.

### Base-handle record

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | string | Always `"basehandle"`. |
| `Value` | number | Unsigned integer handle value. |
| `EntryIndex` | number | Entity-slot portion of the handle. |
| `SerialNumber` | number | Serial portion used to reject index reuse. |
| `Valid` | boolean | `CBaseHandle::IsValid()` at conversion time, not a permanent liveness guarantee. |

Only the five PascalCase fields in the table are installed. The record does not expose lower-camel aliases.

Native edict, base-entity, and base-handle records create own writable, enumerable, configurable data properties. Inherited setters and non-writable prototype fields do not intercept construction. A property-construction failure returns no partial record and preserves an existing JavaScript exception; this does not pin native entity/address lifetime.

`BaseHandle.Value` and the integer-handle conversion results are unsigned 32-bit Numbers, including values above the signed `Int32` maximum. They differ from the live Entity wrapper's signed `HandleValue`; use the helpers to obtain the required representation instead of passing a negative signed handle to an unsigned-handle conversion.

These records are identity records, not writable native-memory views. Changing `Record.Address`, `Record.Index`, or `Record.Value` changes only that JavaScript object. Strict representation conversions resolve the supplied address or packed handle against the current engine world; the record's descriptive `Index`, `ClassName`, `EntryIndex`, `SerialNumber`, and `Valid` fields are not authoritative inputs to those conversions. The shape-only `GetEntityIndex()` query described below instead reads `Index`.

Address-only records do not carry a serial number. If an edict or base-entity address is reused, its old record can resolve the replacement entity, even when its saved index and class name describe the original. Keep a base handle or integer handle for deferred identity checks within the same map. Handle resolution checks the packed serial; finite-generation handles can wrap and do not provide permanent or cross-map identity.

An edict, base-entity, or base-handle record input must have its own `Kind` property with the exact discriminator and its own `Address` or `Value` property; arrays and inherited-only fields are rejected. `Address` must be a primitive non-negative `BigInt` within the native `uintptr_t` range. A base handle's `Value`, like an integer handle, must be a `Number` in `0..0xFFFFFFFF`; a `BigInt` or fractional value is not an unsigned 32-bit handle. Index, integer-handle, and address conversion inputs are primitive values, not such records.

The example below uses six exact PascalCase exports. Lower-camel names such as `baseEntityFromIndex`, `baseHandleFromIndex`, `edictFromIndex`, `addressFromIndex`, `intHandleFromIndex`, and `isValid` are not exported.

Diagnostic snapshots below format addresses as lossless uppercase hexadecimal strings only for logging. Actual API records and conversion inputs retain their `BigInt` addresses.

```js
const {
	GetBaseEntityFromEntityIndex,
	GetBaseHandleFromEntityIndex,
	GetEdictFromEntityIndex,
	GetEntityAddressFromEntityIndex,
	GetIntegerHandleFromEntityIndex,
	IsEntityValid,
} = require("entities/helpers");
const { LogInfo } = require("loggers");

const g_FormatEntityIdentityRecord = function FormatEntityIdentityRecord(IdentityRecord) {
	return { Kind: IdentityRecord.Kind, Address: `0x${IdentityRecord.Address.toString(16).toUpperCase()}`, Index: IdentityRecord.Index, ClassName: IdentityRecord.ClassName };
};

const g_ReportEntityIdentities = function ReportEntityIdentities() {
	const nEntityIndex = 1;
	if (!IsEntityValid(nEntityIndex)) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const EntityIdentities = {
		BaseEntity: g_FormatEntityIdentityRecord(GetBaseEntityFromEntityIndex(nEntityIndex)),
		BaseHandle: GetBaseHandleFromEntityIndex(nEntityIndex),
		Edict: g_FormatEntityIdentityRecord(GetEdictFromEntityIndex(nEntityIndex)),
		EntityAddress: `0x${GetEntityAddressFromEntityIndex(nEntityIndex).toString(16).toUpperCase()}`,
		IntegerHandle: GetIntegerHandleFromEntityIndex(nEntityIndex),
	};
	LogInfo("ReportEntityIdentities Result=%j", EntityIdentities);
};

g_ReportEntityIdentities();
```

## Queries

### `GetEntityIndex(EntityReference?)`

Extracts an entity index with the shared SourceJS index resolver. A finite signed `Int32` number is returned unchanged; an Entity-like object must provide an `Index` value with the same numeric contract. Missing or unrecognized values return `-1`. Only the public `Index` property is read. This is a shape query and does not prove that the entity is live.

### `IsEntityValid(EntityReference?)`

Resolves an index with the same rules and returns whether the current edict slot exists and is not free. It returns `false` for missing, malformed, out-of-range, and free values.

The query family exports `GetEntityIndex` and `IsEntityValid`; the strict representation conversions below are separate operations.

```js
const { Entity } = require("entities/entity");
const { GetEntityIndex, IsEntityValid } = require("entities/helpers");
const { LogInfo } = require("loggers");

const g_ReportEntityQueries = function ReportEntityQueries() {
	const nEntityIndex = 1;
	const EntityInstance = Entity(nEntityIndex);
	if (EntityInstance === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	LogInfo("ReportEntityQueries Result=%j", { EntityIndexValid: IsEntityValid(EntityInstance.Index), MissingEntityValid: IsEntityValid(), EntityIndex: GetEntityIndex(EntityInstance), MissingEntityIndex: GetEntityIndex() });
};

g_ReportEntityQueries();
```

Ordinary query failures return `-1` from `GetEntityIndex` and `false` from `IsEntityValid`, rather than the resolution errors used by strict conversions. An exception thrown by an input object's `Index` getter propagates unchanged instead of becoming a query sentinel; `IsEntityValid` stops before the native edict lookup in that case.

Native queries and representation conversions translate C++ exceptions into JavaScript errors. If a getter or conversion already raised a JavaScript exception, that original value is preserved even when a subsequent C++ failure unwinds the conversion's local exception handler. No partial conversion result is returned; these boundaries do not pin an entity or guarantee allocator/OOM recovery.

## Conversion matrix

Every conversion requires exactly the representation named after `From`. A failed type check, address with no current entity, free edict, mismatched packed-handle serial, or unresolved base entity throws a native JavaScript `Error`. Address reuse is different: an address-only input can resolve the new occupant, not throw for the original entity's removal.

### Convert to an index

| Function | Required input | Result |
| --- | --- | --- |
| `GetEntityIndexFromEdict(Edict)` | Edict record | Current signed `Int32` entity index. |
| `GetEntityIndexFromBaseEntity(BaseEntity)` | Base-entity record | Current signed `Int32` entity index. |
| `GetEntityIndexFromBaseHandle(BaseHandle)` | Base-handle record | Current signed `Int32` entity index. |
| `GetEntityIndexFromIntegerHandle(unIntegerHandle)` | Integer handle | Current signed `Int32` entity index. |
| `GetEntityIndexFromEntityAddress(unEntityAddress)` | BigInt `CBaseEntity*` address | Current signed `Int32` entity index. |

Only the five PascalCase functions above are exported. Lower-camel conversion aliases are not installed.

```js
const {
	GetBaseEntityFromEntityIndex,
	GetBaseHandleFromEntityIndex,
	GetEdictFromEntityIndex,
	GetEntityIndexFromBaseEntity,
	GetEntityIndexFromBaseHandle,
	GetEntityIndexFromEdict,
	GetEntityIndexFromEntityAddress,
	GetEntityIndexFromIntegerHandle,
	GetEntityAddressFromEntityIndex,
	GetIntegerHandleFromEntityIndex,
	IsEntityValid,
} = require("entities/helpers");

const g_VerifyEntityIndexConversions = function VerifyEntityIndexConversions() {
	const nExpectedEntityIndex = 1;
	if (!IsEntityValid(nExpectedEntityIndex)) {
		throw new Error(`Entity index ${nExpectedEntityIndex} is not live.`);
	}

	const vecResolvedEntityIndices = [
		GetEntityIndexFromEdict(GetEdictFromEntityIndex(nExpectedEntityIndex)),
		GetEntityIndexFromBaseEntity(GetBaseEntityFromEntityIndex(nExpectedEntityIndex)),
		GetEntityIndexFromBaseHandle(GetBaseHandleFromEntityIndex(nExpectedEntityIndex)),
		GetEntityIndexFromIntegerHandle(GetIntegerHandleFromEntityIndex(nExpectedEntityIndex)),
		GetEntityIndexFromEntityAddress(GetEntityAddressFromEntityIndex(nExpectedEntityIndex)),
	];
	for (const nResolvedEntityIndex of vecResolvedEntityIndices) {
		if (nResolvedEntityIndex !== nExpectedEntityIndex) {
			throw new Error("Entity identities resolved to different slots.");
		}
	}
};

g_VerifyEntityIndexConversions();
```

### Convert to an edict

| Function | Required input | Result |
| --- | --- | --- |
| `GetEdictFromEntityIndex(nEntityIndex)` | Current signed `Int32` index | Edict record. |
| `GetEdictFromBaseEntity(BaseEntity)` | Base-entity record | Edict record. |
| `GetEdictFromBaseHandle(BaseHandle)` | Base-handle record | Edict record. |
| `GetEdictFromIntegerHandle(unIntegerHandle)` | Integer handle | Edict record. |
| `GetEdictFromEntityAddress(unEntityAddress)` | BigInt `CBaseEntity*` address | Edict record. |

Only the five PascalCase functions above are exported. Lower-camel conversion aliases are not installed.

```js
const {
	GetBaseEntityFromEntityIndex,
	GetBaseHandleFromEntityIndex,
	GetEdictFromBaseEntity,
	GetEdictFromBaseHandle,
	GetEdictFromEntityIndex,
	GetEdictFromEntityAddress,
	GetEdictFromIntegerHandle,
	GetIntegerHandleFromEntityIndex,
	GetEntityAddressFromEntityIndex,
	IsEntityValid,
} = require("entities/helpers");
const { LogInfo } = require("loggers");

const g_FormatEdictSummary = function FormatEdictSummary(Edict) {
	return { Address: `0x${Edict.Address.toString(16).toUpperCase()}`, ClassName: Edict.ClassName, Index: Edict.Index };
};

const g_ReportEdictConversions = function ReportEdictConversions() {
	const nEntityIndex = 1;
	if (!IsEntityValid(nEntityIndex)) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const vecEdicts = [
		GetEdictFromEntityIndex(nEntityIndex),
		GetEdictFromBaseEntity(GetBaseEntityFromEntityIndex(nEntityIndex)),
		GetEdictFromBaseHandle(GetBaseHandleFromEntityIndex(nEntityIndex)),
		GetEdictFromIntegerHandle(GetIntegerHandleFromEntityIndex(nEntityIndex)),
		GetEdictFromEntityAddress(GetEntityAddressFromEntityIndex(nEntityIndex)),
	];
	LogInfo("ReportEdictConversions Result=%j", vecEdicts.map(g_FormatEdictSummary));
};

g_ReportEdictConversions();
```

### Convert to a base entity

| Function | Required input | Result |
| --- | --- | --- |
| `GetBaseEntityFromEntityIndex(nEntityIndex)` | Current signed `Int32` index | Base-entity record. |
| `GetBaseEntityFromEdict(Edict)` | Edict record | Base-entity record. |
| `GetBaseEntityFromBaseHandle(BaseHandle)` | Base-handle record | Base-entity record. |
| `GetBaseEntityFromIntegerHandle(unIntegerHandle)` | Integer handle | Base-entity record. |
| `GetBaseEntityFromEntityAddress(unEntityAddress)` | BigInt `CBaseEntity*` address | Base-entity record. |

Only the five PascalCase functions above are exported. Lower-camel conversion aliases are not installed.

```js
const {
	GetBaseEntityFromBaseHandle,
	GetBaseEntityFromEdict,
	GetBaseEntityFromEntityIndex,
	GetBaseEntityFromEntityAddress,
	GetBaseEntityFromIntegerHandle,
	GetBaseHandleFromEntityIndex,
	GetEdictFromEntityIndex,
	GetEntityAddressFromEntityIndex,
	GetIntegerHandleFromEntityIndex,
	IsEntityValid,
} = require("entities/helpers");
const { LogInfo } = require("loggers");

const g_FormatBaseEntityAddress = function FormatBaseEntityAddress(BaseEntity) {
	return `0x${BaseEntity.Address.toString(16).toUpperCase()}`;
};

const g_ReportBaseEntityConversions = function ReportBaseEntityConversions() {
	const nEntityIndex = 1;
	if (!IsEntityValid(nEntityIndex)) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const vecBaseEntities = [
		GetBaseEntityFromEntityIndex(nEntityIndex),
		GetBaseEntityFromEdict(GetEdictFromEntityIndex(nEntityIndex)),
		GetBaseEntityFromBaseHandle(GetBaseHandleFromEntityIndex(nEntityIndex)),
		GetBaseEntityFromIntegerHandle(GetIntegerHandleFromEntityIndex(nEntityIndex)),
		GetBaseEntityFromEntityAddress(GetEntityAddressFromEntityIndex(nEntityIndex)),
	];
	LogInfo("ReportBaseEntityConversions Result=%j", vecBaseEntities.map(g_FormatBaseEntityAddress));
};

g_ReportBaseEntityConversions();
```

### Convert to a base handle

| Function | Required input | Result |
| --- | --- | --- |
| `GetBaseHandleFromEntityIndex(nEntityIndex)` | Current signed `Int32` index | Base-handle record. |
| `GetBaseHandleFromEdict(Edict)` | Edict record | Base-handle record. |
| `GetBaseHandleFromBaseEntity(BaseEntity)` | Base-entity record | Base-handle record. |
| `GetBaseHandleFromIntegerHandle(unIntegerHandle)` | Integer handle | Base-handle record. |
| `GetBaseHandleFromEntityAddress(unEntityAddress)` | BigInt `CBaseEntity*` address | Base-handle record. |

Only the five PascalCase functions above are exported. Lower-camel conversion aliases are not installed.

```js
const {
	GetBaseEntityFromEntityIndex,
	GetBaseHandleFromBaseEntity,
	GetBaseHandleFromEdict,
	GetBaseHandleFromEntityIndex,
	GetBaseHandleFromEntityAddress,
	GetBaseHandleFromIntegerHandle,
	GetEdictFromEntityIndex,
	GetEntityAddressFromEntityIndex,
	GetIntegerHandleFromEntityIndex,
	IsEntityValid,
} = require("entities/helpers");
const { LogInfo } = require("loggers");

const g_FormatBaseHandleSummary = function FormatBaseHandleSummary(BaseHandle) {
	return { EntryIndex: BaseHandle.EntryIndex, SerialNumber: BaseHandle.SerialNumber, Value: BaseHandle.Value };
};

const g_ReportBaseHandleConversions = function ReportBaseHandleConversions() {
	const nEntityIndex = 1;
	if (!IsEntityValid(nEntityIndex)) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const vecBaseHandles = [
		GetBaseHandleFromEntityIndex(nEntityIndex),
		GetBaseHandleFromEdict(GetEdictFromEntityIndex(nEntityIndex)),
		GetBaseHandleFromBaseEntity(GetBaseEntityFromEntityIndex(nEntityIndex)),
		GetBaseHandleFromIntegerHandle(GetIntegerHandleFromEntityIndex(nEntityIndex)),
		GetBaseHandleFromEntityAddress(GetEntityAddressFromEntityIndex(nEntityIndex)),
	];
	LogInfo("ReportBaseHandleConversions Result=%j", vecBaseHandles.map(g_FormatBaseHandleSummary));
};

g_ReportBaseHandleConversions();
```

### Convert to an integer handle

| Function | Required input | Result |
| --- | --- | --- |
| `GetIntegerHandleFromEntityIndex(nEntityIndex)` | Current signed `Int32` index | Unsigned 32-bit `Number` in `0..0xFFFFFFFF`. |
| `GetIntegerHandleFromEdict(Edict)` | Edict record | Unsigned 32-bit `Number` in `0..0xFFFFFFFF`. |
| `GetIntegerHandleFromBaseEntity(BaseEntity)` | Base-entity record | Unsigned 32-bit `Number` in `0..0xFFFFFFFF`. |
| `GetIntegerHandleFromBaseHandle(BaseHandle)` | Base-handle record | Unsigned 32-bit `Number` in `0..0xFFFFFFFF`. |
| `GetIntegerHandleFromEntityAddress(unEntityAddress)` | BigInt `CBaseEntity*` address | Unsigned 32-bit `Number` in `0..0xFFFFFFFF`. |

Only the five PascalCase functions above are exported. Lower-camel conversion aliases are not installed.

```js
const {
	GetBaseEntityFromEntityIndex,
	GetBaseHandleFromEntityIndex,
	GetEdictFromEntityIndex,
	GetEntityAddressFromEntityIndex,
	GetIntegerHandleFromBaseEntity,
	GetIntegerHandleFromBaseHandle,
	GetIntegerHandleFromEdict,
	GetIntegerHandleFromEntityIndex,
	GetIntegerHandleFromEntityAddress,
	IsEntityValid,
} = require("entities/helpers");

const g_VerifyIntegerHandleConversions = function VerifyIntegerHandleConversions() {
	const nEntityIndex = 1;
	if (!IsEntityValid(nEntityIndex)) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const vecIntegerHandles = [
		GetIntegerHandleFromEntityIndex(nEntityIndex),
		GetIntegerHandleFromEdict(GetEdictFromEntityIndex(nEntityIndex)),
		GetIntegerHandleFromBaseEntity(GetBaseEntityFromEntityIndex(nEntityIndex)),
		GetIntegerHandleFromBaseHandle(GetBaseHandleFromEntityIndex(nEntityIndex)),
		GetIntegerHandleFromEntityAddress(GetEntityAddressFromEntityIndex(nEntityIndex)),
	];
	if (new Set(vecIntegerHandles).size !== 1) {
		throw new Error("Entity handle conversion lost its serial number.");
	}
};

g_VerifyIntegerHandleConversions();
```

### Convert to an address

| Function | Required input | Result |
| --- | --- | --- |
| `GetEntityAddressFromEntityIndex(nEntityIndex)` | Current signed `Int32` index | BigInt representing the live `CBaseEntity*` address. |
| `GetEntityAddressFromEdict(Edict)` | Edict record | BigInt representing the live `CBaseEntity*` address. |
| `GetEntityAddressFromBaseEntity(BaseEntity)` | Base-entity record | BigInt representing the live `CBaseEntity*` address. |
| `GetEntityAddressFromBaseHandle(BaseHandle)` | Base-handle record | BigInt representing the live `CBaseEntity*` address. |
| `GetEntityAddressFromIntegerHandle(unIntegerHandle)` | Integer handle | BigInt representing the live `CBaseEntity*` address. |

Only the five PascalCase functions above are exported. Lower-camel conversion aliases are not installed.

```js
const {
	GetBaseEntityFromEntityIndex,
	GetBaseHandleFromEntityIndex,
	GetEdictFromEntityIndex,
	GetEntityAddressFromBaseEntity,
	GetEntityAddressFromBaseHandle,
	GetEntityAddressFromEdict,
	GetEntityAddressFromEntityIndex,
	GetEntityAddressFromIntegerHandle,
	GetIntegerHandleFromEntityIndex,
	IsEntityValid,
} = require("entities/helpers");

const g_VerifyAddressConversions = function VerifyAddressConversions() {
	const nEntityIndex = 1;
	if (!IsEntityValid(nEntityIndex)) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const vecEntityAddresses = [
		GetEntityAddressFromEntityIndex(nEntityIndex),
		GetEntityAddressFromEdict(GetEdictFromEntityIndex(nEntityIndex)),
		GetEntityAddressFromBaseEntity(GetBaseEntityFromEntityIndex(nEntityIndex)),
		GetEntityAddressFromBaseHandle(GetBaseHandleFromEntityIndex(nEntityIndex)),
		GetEntityAddressFromIntegerHandle(GetIntegerHandleFromEntityIndex(nEntityIndex)),
	];
	if (new Set(vecEntityAddresses).size !== 1) {
		throw new Error("Entity address conversion is inconsistent.");
	}
};

g_VerifyAddressConversions();
```

## Output names

### `FindEntityOutputNameByAddress(Entity, unOutputAddress)`

When datamaps are available, this function resolves `Entity` with the same index rules as `GetEntityIndex`: a signed `Int32` number or an object with a matching `Index` value. The resolved entity must be live. It traverses direct fields in that entity's datamap and base maps, compares `caller CBaseEntity* + field offset` with `unOutputAddress`, and returns the first matching field's non-empty `ExternalName`. It skips negative offsets, empty external names, and overflowing address additions; embedded datamaps are not recursively searched. A non-matching address returns `null`.

The lookup does not filter `FTYPEDESC_OUTPUT`: a named non-output field at the same address can match. Supply storage discovered from an actual output field; this helper does not validate the storage's native type or lifetime.

If an entity property getter throws, the original exception is propagated before output-address validation or any datamap lookup. No SDK lookup follows that failed resolution.

Native C++ failures become an operation-specific JavaScript `Error`. A JavaScript exception already captured during entity resolution is rethrown before its native `TryCatch` owner unwinds, so a later C++ failure does not replace it.

The second argument is a BigInt address to the `CBaseEntityOutput` storage inside the entity. It must be within the native `uintptr_t` range and non-zero (`0n` is invalid); malformed values throw. It is not the field record's `Address`, which points to `typedescription_t` metadata.

No `findOutputName` compatibility alias is installed.

```js
const { Entity } = require("entities/entity");
const { FindEntityOutputNameByAddress } = require("entities/helpers");
const { LogInfo } = require("loggers");

const g_VerifyEntityOutputName = function VerifyEntityOutputName() {
	if (typeof FindEntityOutputNameByAddress !== "function") {
		throw new Error("The selected SDK does not expose datamap output lookup.");
	}

	const nEntityIndex = 1;
	const EntityInstance = Entity(nEntityIndex);
	if (EntityInstance === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const OutputField = EntityInstance.GetEntityOutputs().find(Field => Field.ExternalName.length > 0);
	if (OutputField === undefined) {
		throw new Error(`Entity ${EntityInstance.Index} has no named reflected output fields.`);
	}

	const unOutputAddress = EntityInstance.Address + BigInt(OutputField.Offset);
	const strEntityOutputName = FindEntityOutputNameByAddress(EntityInstance, unOutputAddress);
	if (strEntityOutputName !== OutputField.ExternalName) {
		throw new Error("Datamap output lookup returned a different field name.");
	}

	LogInfo("VerifyEntityOutputName Result=%j", { EntityOutputAddress: `0x${unOutputAddress.toString(16).toUpperCase()}`, EntityOutputName: strEntityOutputName });
};

g_VerifyEntityOutputName();
```

The caller must resolve to a live entity, and `unOutputAddress` must be a non-zero BigInt address. Those argument failures throw. A valid address that does not match a named direct field in the datamap/base-map chain returns `null`.

## Practical workflows

### Keep a serial-aware reference across callbacks

An entity index can be reused after deletion. Store an integer handle when later work must refer to the same entity, then resolve it immediately before use:

```js
const { Entity } = require("entities/entity");
const {
	GetEntityIndexFromIntegerHandle,
	GetIntegerHandleFromEntityIndex,
	IsEntityValid,
} = require("entities/helpers");
const { LogInfo } = require("loggers");

const g_TryResolveEntityFromIntegerHandle = function TryResolveEntityFromIntegerHandle(unIntegerHandle) {
	try {
		return Entity(GetEntityIndexFromIntegerHandle(unIntegerHandle));
	} catch {
		return null;
	}
};

const g_ReportTrackedEntity = function ReportTrackedEntity() {
	const nEntityIndex = 1;
	if (!IsEntityValid(nEntityIndex)) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const unTrackedIntegerHandle = GetIntegerHandleFromEntityIndex(nEntityIndex);
	const EntityInstance = g_TryResolveEntityFromIntegerHandle(unTrackedIntegerHandle);
	LogInfo("ReportTrackedEntity Result=%j", { Resolved: EntityInstance !== null, EntityIndex: EntityInstance ? EntityInstance.Index : null, ClassName: EntityInstance ? EntityInstance.ClassName : null });
};

g_ReportTrackedEntity();
```

If the slot is deleted and reused, its serial number changes; while the packed serial differs, `GetEntityIndexFromIntegerHandle` throws instead of resolving the replacement entity. Finite serial numbers can wrap, so do not keep stored handles as permanent or cross-map identities.

This local best-effort resolver maps any conversion or Entity-factory exception to `null`; an unresolved result alone does not prove deletion. Propagate or report the original exception instead when diagnosing native failures.

### Inspect every identity from a server command

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/server");
const {
	GetBaseEntityFromEntityIndex,
	GetBaseHandleFromEntityIndex,
	GetEdictFromEntityIndex,
	GetEntityAddressFromEntityIndex,
	GetIntegerHandleFromEntityIndex,
	IsEntityValid,
} = require("entities/helpers");
const { LogInfo, LogWarning } = require("loggers");

const g_strCommandName = "sjs_entity_identity";

const g_FormatCommandEntityIdentityRecord = function FormatCommandEntityIdentityRecord(IdentityRecord) {
	return { Kind: IdentityRecord.Kind, Address: `0x${IdentityRecord.Address.toString(16).toUpperCase()}`, Index: IdentityRecord.Index, ClassName: IdentityRecord.ClassName };
};

const g_InspectEntityCommand = function InspectEntityCommand(CommandInput) {
	const nDefaultEntityIndex = 1;
	const unEntityIndexArgumentPosition = 1;
	const ParsedCommand = new Command(CommandInput);
	const nEntityIndex = (ParsedCommand.Length > unEntityIndexArgumentPosition) ? Number(ParsedCommand.GetArgument(unEntityIndexArgumentPosition)) : nDefaultEntityIndex;
	if (!Number.isInteger(nEntityIndex) || !IsEntityValid(nEntityIndex)) {
		LogWarning("InspectEntityCommand Result=%j", { Valid: false, EntityIndexArgument: ParsedCommand.GetArgument(unEntityIndexArgumentPosition) ?? String(nDefaultEntityIndex) });
		return HANDLED;
	}

	LogInfo("InspectEntityCommand Result=%j", {
		BaseEntity: g_FormatCommandEntityIdentityRecord(GetBaseEntityFromEntityIndex(nEntityIndex)),
		BaseHandle: GetBaseHandleFromEntityIndex(nEntityIndex),
		Edict: g_FormatCommandEntityIdentityRecord(GetEdictFromEntityIndex(nEntityIndex)),
		EntityAddress: `0x${GetEntityAddressFromEntityIndex(nEntityIndex).toString(16).toUpperCase()}`,
		IntegerHandle: GetIntegerHandleFromEntityIndex(nEntityIndex),
	});

	return HANDLED;
};

const g_UnloadPlugin = function UnloadPlugin() {
	if (!UnregisterCommand(g_strCommandName, g_InspectEntityCommand)) {
		throw new Error("Unable to unregister the entity-identity command.");
	}
};

if (!RegisterCommand(g_strCommandName, g_InspectEntityCommand)) {
	throw new Error("Unable to register the entity-identity command.");
}

module.exports.Unload = g_UnloadPlugin;
```

Run `sjs_entity_identity 1` to inspect client slot 1 when it is occupied, or pass any other live entity index. The command validates the user-provided index before invoking strict conversions. Export cleanup under the case-sensitive SourceJS-owned `Unload` lifecycle key, which the runtime calls without a lowercase alias; exporting only `UnloadPlugin` does not register an unload callback.

## Lifetime and errors

- Conversion inputs must use the exact source representation named by the function.
- Edict and base-entity records must own `Kind` and `Address`; base-handle records must own `Kind` and `Value`. Inherited lookalikes are rejected.
- Record `Kind` values are exact and case-sensitive.
- If an own-property Proxy trap or a record getter throws, the conversion propagates the original exception and stops reading further fields.
- Integer handles and base-handle `Value` fields must be unsigned 32-bit `Number` values in `0..0xFFFFFFFF`, not `BigInt` values.
- A handle conversion validates both its entry index and serial number against the current entity.
- An address conversion scans the current entity list; an address with no matching live entity throws. A recycled address can resolve a replacement entity because address-only records carry no serial.
- Conversion records are not retained native handles and do not extend an entity's lifetime.
- Re-resolve a stored integer handle immediately before use on the game thread, within the same map. Discard stored identities at map teardown. Do not cache a converted address across deletion, map changes, or plugin reloads.
- `FindEntityOutputNameByAddress` is capability-omitted on SDKs without datamaps.

## Related modules

- [`entities/entity`](entities-entity.md) creates and decorates live Entity objects.
- [`entities/datamaps`](entities-datamaps.md) exposes field records and their effective offsets.
- [`entities/outputs`](entities-outputs.md) loads output ABI descriptors and installs output hooks.
- [`players/helpers`](players-helpers.md) provides the player-specific conversion matrix.
- [`memory/hooks`](memory-hooks.md) provides the base Detours API used by entity-aware hooks.
