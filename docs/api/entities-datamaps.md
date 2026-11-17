# `require("entities/datamaps")`

> AI-processing note: this page is a hand-maintained reference for the complete native datamap API. Reflection records describe HL2SDK memory layouts; property operations read and write real entity memory.

The [`entities/datamaps` facade](../../packages/sourcejs/entities/datamaps.js) exposes the native API in [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) for Source 1 `datamap_t`, `typedescription_t`, `variant_t`, input-function, and typed property operations. Use it when a value is saved, restored, keyed, or dispatched through a datamap rather than a network send table.

## Table of contents

- [Import](#import)
- [Availability and ownership](#availability-and-ownership)
- [Datamap records](#datamap-records)
- [Field records](#field-records)
- [Constants](#constants)
- [Selectors](#selectors)
- [Reflection API](#reflection-api)
- [Variant and interval records](#variant-and-interval-records)
- [Input functions](#input-functions)
- [Generic property API](#generic-property-api)
- [Typed property API](#typed-property-api)
- [Live structured values](#live-structured-values)
- [Practical workflows](#practical-workflows)
- [Errors and memory safety](#errors-and-memory-safety)

## Import

The maximum selected-SDK surface contains two namespaces and 52 functions:

```js
const {
	FieldType,
	TypeDescriptionFlags,
	CallEntityInputFunction,
	CreateEntityDataMapInterval,
	CreateEntityDataMapVariant,
	CreateEntityDataMapVariantFromAddress,
	FindEntityDataMapField,
	FindEntityDataMapFieldOffset,
	GetEntityDataMap,
	GetEntityDataMapField,
	GetEntityDataMapFields,
	GetEntityDataMapProperty,
	GetEntityDataMapPropertyBoolean,
	GetEntityDataMapPropertyCharacter,
	GetEntityDataMapPropertyColor,
	GetEntityDataMapPropertyDouble,
	GetEntityDataMapPropertyEntity,
	GetEntityDataMapPropertyFloat,
	GetEntityDataMapPropertyInteger,
	GetEntityDataMapPropertyInterval,
	GetEntityDataMapPropertyLong,
	GetEntityDataMapPropertyLongLong,
	GetEntityDataMapPropertyAddress,
	GetEntityDataMapPropertyShort,
	GetEntityDataMapPropertyString,
	GetEntityDataMapPropertyStringArray,
	GetEntityDataMapPropertyUnsignedCharacter,
	GetEntityDataMapPropertyUnsignedInteger,
	GetEntityDataMapPropertyUnsignedLong,
	GetEntityDataMapPropertyUnsignedLongLong,
	GetEntityDataMapPropertyUnsignedShort,
	GetEntityDataMapPropertyVector,
	GetEntityInputFunction,
	SetEntityDataMapProperty,
	SetEntityDataMapPropertyBoolean,
	SetEntityDataMapPropertyCharacter,
	SetEntityDataMapPropertyColor,
	SetEntityDataMapPropertyDouble,
	SetEntityDataMapPropertyEntity,
	SetEntityDataMapPropertyFloat,
	SetEntityDataMapPropertyInteger,
	SetEntityDataMapPropertyInterval,
	SetEntityDataMapPropertyLong,
	SetEntityDataMapPropertyLongLong,
	SetEntityDataMapPropertyAddress,
	SetEntityDataMapPropertyShort,
	SetEntityDataMapPropertyString,
	SetEntityDataMapPropertyStringArray,
	SetEntityDataMapPropertyUnsignedCharacter,
	SetEntityDataMapPropertyUnsignedInteger,
	SetEntityDataMapPropertyUnsignedLong,
	SetEntityDataMapPropertyUnsignedLongLong,
	SetEntityDataMapPropertyUnsignedShort,
	SetEntityDataMapPropertyVector,
} = require("entities/datamaps");
```

## Availability and ownership

The module is native and context-local. It is installed only when the selected SDK enables `SOURCEJS_HAS_DATAMAPS`; otherwise requiring the package throws. It is not a JavaScript recreation of HL2SDK structures and has no fallback object, default export, or raw `FTYPEDESC_*` exports.

Perform native reflection, property access, and input dispatch on the server thread, not arbitrary worker threads.

`CallEntityInputFunction` is omitted on Dark Messiah because that SDK does not expose the required callable input member in the supported layout. `FieldType.Vector2D` and the extended type-description flags are present only on branches whose HL2SDK declares them. Test a capability by checking its actual member:

```js
const { CallEntityInputFunction, FieldType } = require("entities/datamaps");
const { LogInfo } = require("loggers");

const g_Capabilities = { DirectInputDispatchSupported: typeof CallEntityInputFunction === "function", Vector2DSupported: Object.hasOwn(FieldType, "Vector2D") };

LogInfo("%j", { Operation: "InspectDataMapCapabilities", Capabilities: g_Capabilities });
```

Datamap and field records are ordinary JavaScript metadata snapshots produced from the current native layout. Their address fields refer to engine-owned native records that SourceJS neither owns nor frees. Editing the copied metadata fields does not modify those native records. Structured property values returned by `GetEntityDataMapPropertyVector`, `GetEntityDataMapPropertyColor`, and `GetEntityDataMapPropertyInterval` are live write-through views and must not outlive the entity or field storage.

Color snapshots contain own integer-valued `Red`, `Green`, `Blue`, and `Alpha` fields; inherited JavaScript setters are not called while producing them. A live color view has an own `Address` field and native component properties bound to the borrowed color storage. Floating-component access rejects null or misaligned component addresses, but cannot establish whether the borrowed memory is still live and readable.

Datamap and field snapshots also contain own properties. The native module's exported functions are installed as own properties without invoking inherited JavaScript setters; callback data is preserved. Interval snapshots have own numeric `Start` and `Range` fields. Live vector and interval views have an own `Address` and native component properties; view creation checks alignment before component arithmetic or typed member access. SDK vector component offsets are checked at compile time, and vector address ranges reject integer overflow before component addresses are calculated. These checks prove neither storage extent nor lifetime: use only the matching live native field storage.

## Datamap records

`GetEntityDataMap(Value)` returns `null` when no map can be resolved. The receiver method `Entity.GetEntityDataMap()` instead rejects an invalid entity and returns `null` when a valid entity has no map. Both paths preserve getter-thrown JavaScript errors, including when native C++ unwinding also occurs; failed entity selection stops address fallback and record creation. Both entry points check the resolved final map's alignment and address range before building its snapshot, and translate native C++ exceptions into an operation-specific JavaScript error only when no JavaScript error is already pending. This final-record check does not protect the entity lookup or class-name scan that precedes it, or establish engine-owned storage lifetime. Those paths require an already valid native entity and metadata graph. A successful result has these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `Address` | bigint | Native `datamap_t*` address. |
| `ClassName` | string | SDK data-class name. |
| `FieldCount` | number | Number of fields declared directly by this map. |
| `PackedSize` | number | SDK packed data size. |
| `ChainsValidated` | boolean | Current SDK chain-validation state. |
| `PackedOffsetsComputed` | boolean | Whether packed offsets were computed. |
| `BaseAddress` | bigint | Base `datamap_t*` address, or `0n`. |

The base map is resolved explicitly:

```js
const { GetEntityDataMap } = require("entities/datamaps");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_PlayerEntity = Player(1);
if (!g_PlayerEntity) {
	throw new Error("Expected player 1 to exist.");
}

const g_PlayerDataMap = GetEntityDataMap(g_PlayerEntity);
if (!g_PlayerDataMap) {
	throw new Error("The selected player has no datamap on this SDK.");
}

let g_BaseDataMap = null;
if (g_PlayerDataMap.BaseAddress !== 0n) {
	g_BaseDataMap = GetEntityDataMap(g_PlayerDataMap.BaseAddress);
	if (!g_BaseDataMap) {
		throw new Error("The base datamap address could not be resolved.");
	}
}

LogInfo("%j", { Operation: "InspectDataMapInheritance", ClassName: g_PlayerDataMap.ClassName, FieldCount: g_PlayerDataMap.FieldCount, BaseClassName: g_BaseDataMap ? g_BaseDataMap.ClassName : null });
```

## Field records

`GetEntityDataMapField`, `FindEntityDataMapField`, and `GetEntityDataMapFields` return `typedescription_t` metadata records:

| Field | Type | Meaning |
| --- | --- | --- |
| `Address` | bigint | Native `typedescription_t*` address. |
| `OwnerClassName` | string | Datamap that directly owns the field. |
| `Index` | number | Index in the owning map, or `-1` for an address-only input record. |
| `Offset` | number | Effective byte offset, including embedded parents. |
| `LocalOffset` | number | Offset declared by this field. |
| `FlatOffset` | number | SDK flat offset. |
| `PackedOffset` | number | SDK packed offset. |
| `TypeID` | number | Numeric `fieldtype_t`. |
| `Type` | string | Canonical compact lowercase field-type name. |
| `Name` | string | Internal field name. |
| `Path` | string | Dot-separated embedded-field path. |
| `ElementCount` | number | Element count from `fieldSize`. |
| `Flags` | number | Combined `TypeDescriptionFlags` mask. |
| `ExternalName` | string | Key/input/output name, or an empty string. |
| `SizeInBytes` | number | Declared storage size. |
| `OverrideCount` | number | SDK override count. |
| `Tolerance` | number | Prediction/network tolerance. |
| `Input` | boolean | Whether `TypeDescriptionFlags.Input` is set. |
| `Output` | boolean | Whether `TypeDescriptionFlags.Output` is set. |
| `Key` | boolean | Whether `TypeDescriptionFlags.Key` is set. |
| `Embedded` | boolean | Whether the field type is `FIELD_EMBEDDED`. |
| `SaveRestoreAddress` | bigint | Native save/restore operations address, or `0n`. |
| `OverrideFieldAddress` | bigint | Overridden field address, or `0n`. |
| `InputFunctionAddress` | bigint | Address-sized descriptive word copied from the native input member-function representation, or `0n`; not a portable callable address. |
| `EmbeddedDatamapAddress` | bigint | Embedded `datamap_t*` address, or `0n`. |

Metadata records are descriptive snapshots. Re-run reflection after a map transition or after native code changes the underlying layout state.

## Constants

### `FieldType`

`FieldType` maps PascalCase members to the selected SDK's `FIELD_*` values:

| Members | Meaning |
| --- | --- |
| `Void`, `Float`, `String`, `Vector`, `Quaternion` | Basic value types. |
| `Integer`, `Boolean`, `Short`, `Character`, `Color32` | Scalar and color storage. |
| `Embedded`, `Custom`, `ClassAddress`, `EntityHandle`, `Edict` | Compound, custom, address, and entity storage. |
| `PositionVector`, `Time`, `Tick` | Engine-specialized numeric/vector types. |
| `ModelName`, `SoundName`, `ModelIndex`, `MaterialIndex` | Engine resource identifiers. |
| `Input`, `Function` | Callable/function metadata. |
| `VMatrix`, `VMatrixWorldSpace`, `Matrix3x4WorldSpace` | Matrix storage. |
| `Interval` | `interval_t`. |
| `Vector2D` | Optional two-component vector storage. |
| `TypeCount` | SDK sentinel; not a field value. |

### `TypeDescriptionFlags`

`TypeDescriptionFlags` is the only public flag namespace:

| Members | HL2SDK flags |
| --- | --- |
| `Global`, `Save`, `Key`, `Input`, `Output` | `FTYPEDESC_GLOBAL`, `FTYPEDESC_SAVE`, `FTYPEDESC_KEY`, `FTYPEDESC_INPUT`, `FTYPEDESC_OUTPUT`. |
| `FunctionTable`, `Address`, `Override`, `InSendTable`, `Private` | `FTYPEDESC_FUNCTIONTABLE`, `FTYPEDESC_PTR`, `FTYPEDESC_OVERRIDE`, `FTYPEDESC_INSENDTABLE`, `FTYPEDESC_PRIVATE`. |
| `NoErrorCheck`, `ModelIndex` | `FTYPEDESC_NOERRORCHECK`, `FTYPEDESC_MODELINDEX`. |
| `Index`, `ViewOtherPlayer`, `ViewOwnTeam`, `ViewNever` | Optional `FTYPEDESC_INDEX`, `FTYPEDESC_VIEW_OTHER_PLAYER`, `FTYPEDESC_VIEW_OWN_TEAM`, `FTYPEDESC_VIEW_NEVER`. |

Use masks normally:

```js
const {
	FieldType,
	FindEntityDataMapField,
	GetEntityDataMap,
	TypeDescriptionFlags,
} = require("entities/datamaps");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_PlayerEntity = Player(1);
if (!g_PlayerEntity) {
	throw new Error("Expected player 1 to exist.");
}

const g_PlayerDataMap = GetEntityDataMap(g_PlayerEntity);
if (!g_PlayerDataMap) {
	throw new Error("The selected player has no datamap on this SDK.");
}

const g_HealthDataMapField = FindEntityDataMapField(g_PlayerDataMap, "m_iHealth");
if (!g_HealthDataMapField) {
	throw new Error("This SDK does not expose m_iHealth in the player datamap.");
}

LogInfo("%j", { Operation: "InspectDataMapFieldFlags", Integer: g_HealthDataMapField.TypeID === FieldType.Integer, Saved: (g_HealthDataMapField.Flags & TypeDescriptionFlags.Save) !== 0, Key: (g_HealthDataMapField.Flags & TypeDescriptionFlags.Key) !== 0 });
```

## Selectors

### Datamap selectors

Reflection functions accept any of these map selectors:

- an `Entity` or native `CBaseEntity` object;
- a signed-32-bit integer `Number` entity index;
- an exact SDK class-name string such as `"CBasePlayer"`;
- a datamap record containing `ClassName` or a `BigInt` `Address`;
- a `BigInt` `datamap_t*` address.

A raw datamap address must fit `uintptr_t` and satisfy the selected SDK's `datamap_t` alignment. The resolver does not validate storage extent or lifetime. Use only a live engine-owned address from a current datamap record; an arbitrary or stale address can terminate the process. Raw `typedescription_t` selectors likewise require their SDK alignment.

Resolution first tries the entity selector, then a primitive class-name string or an object's string-valued `ClassName`, and finally a `BigInt` `Address`. A non-string or unresolved `ClassName` allows address fallback; a failed entity, class-name, or address getter stops resolution rather than trying later properties.

An exception captured while resolving the entity is preserved even if native C++ code also fails during that resolution. The original JavaScript exception is rethrown before its native `TryCatch` owner unwinds; failed entity resolution never proceeds to class-name or address fallback.

### Property selectors

Property functions accept:

- an internal field name, embedded path, or `ExternalName` string;
- a nonnegative signed-32-bit integer `Number` byte offset;
- a field record containing `Offset`, `Path`, `Name`, or `ExternalName`.

A String selector, or an object without a valid integer `Offset` whose selected name resolves through reflection, retains type metadata. A numeric offset or a field record with a valid integer `Offset` is consumed as an offset, so an omitted generic type defaults to native `int` and string-array reads and writes use a 256-byte default capacity. Supply an explicit generic type or choose a typed accessor only after validating reflected metadata; pass the field's `Path` whenever `Vector2D` handling, entity representation, or buffer extent depends on metadata.

The entity selector must resolve to a real live `CBaseEntity`. It may be an entity object, a signed-32-bit integer `Number` entity index, or a non-negative `BigInt` address that fits `uintptr_t`. `Number` values are not interpreted as raw addresses. An arbitrary allocation is not an entity and is rejected.

Object selectors try a signed-32-bit integer `Number` `Offset` first, then the first primitive String among `Path`, `Name`, and `ExternalName`. A negative integer offset is selected and rejected, not skipped in favor of a name. An empty String is likewise selected and rejected. A getter exception stops access and propagates unchanged. Both entity and property selectors preserve the original JavaScript exception if native C++ code also fails while their `TryCatch` owner is active; failed entity resolution never proceeds to raw-address fallback. Before native access after selector getters, the entity's handle serial and address must still match. Failed selection leaves the native output parameters unchanged; successful selection transfers metadata without allocation before committing the scalar address output.

## Reflection API

| Function | Result |
| --- | --- |
| `GetEntityDataMap(Value)` | Datamap record or `null`. |
| `GetEntityDataMapField(DataMap, nFieldIndex)` | Direct field by zero-based index, or `null`. |
| `FindEntityDataMapField(DataMap, strFieldName)` | Recursive field/base-map lookup by internal name, path, or external name; returns a field record or `null`. |
| `FindEntityDataMapFieldOffset(DataMap, strFieldName)` | Effective byte offset or `-1`. |
| `GetEntityDataMapFields(DataMap, bRecursive = true)` | Field records; recursive mode includes embedded and base maps. |

Reflection preserves exceptions thrown by selector getters; native C++ failures become operation-specific JavaScript errors. A null/unresolved map keeps the documented `null`, `-1`, or empty-array result. Index access requires a signed-32-bit integer `Number`, never `BigInt`. Field traversal checks record/table alignment and address-range/multiplication overflow before access. The field-finding functions stop on a repeated map in the root's base-map chain; recursive collection uses the separate depth limit described below. These checks do not protect the preceding class-name scan or prove that caller-supplied addresses refer to live, sufficiently large SDK allocations: the complete metadata graph must remain valid for the call.

A useful map inspector:

```js
const {
	FindEntityDataMapField,
	FindEntityDataMapFieldOffset,
	GetEntityDataMap,
	GetEntityDataMapField,
	GetEntityDataMapFields,
} = require("entities/datamaps");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_PlayerEntity = Player(1);
if (!g_PlayerEntity) {
	throw new Error("Expected player 1 to exist.");
}

const g_PlayerDataMap = GetEntityDataMap(g_PlayerEntity);
if (!g_PlayerDataMap) {
	throw new Error("The selected player has no datamap on this SDK.");
}

const g_GetEntityDataMapFieldExternalName = function GetEntityDataMapFieldExternalName(EntityDataMapField) {
	return EntityDataMapField.ExternalName;
};

const g_IsEntityDataMapInputField = function IsEntityDataMapInputField(EntityDataMapField) {
	return EntityDataMapField.Input;
};

const g_DirectFirstDataMapField = GetEntityDataMapField(g_PlayerDataMap, 0);
const g_HealthDataMapField = FindEntityDataMapField(g_PlayerDataMap, "m_iHealth");
const g_nHealthOffset = FindEntityDataMapFieldOffset(g_PlayerDataMap, "m_iHealth");
const g_vecEntityDataMapFields = GetEntityDataMapFields(g_PlayerDataMap, true);
if (!g_DirectFirstDataMapField || !g_HealthDataMapField || (g_nHealthOffset < 0)) {
	throw new Error("The player datamap reflection is incomplete.");
}

LogInfo("%j", {
	Operation: "InspectDataMapFields",
	InputNames: g_vecEntityDataMapFields.filter(g_IsEntityDataMapInputField).map(g_GetEntityDataMapFieldExternalName),
	HealthOffset: g_nHealthOffset,
	DataMapClassName: g_PlayerDataMap.ClassName,
	DirectFirstFieldName: g_DirectFirstDataMapField.Name,
	FieldCount: g_vecEntityDataMapFields.length,
});

if (g_HealthDataMapField.Offset !== g_nHealthOffset) {
	throw new Error("Datamap offset lookup is inconsistent.");
}
```

`GetEntityDataMapFields(DataMap, false)` returns only fields declared directly by the selected map.

Recursive collection starts at depth `0` and visits embedded and base maps through depth `32`. A deeper branch is silently omitted rather than reported as an error, so the returned list can be partial; a cyclic graph can also produce duplicate records before reaching that limit. Field finding searches the root's base-map chain and recursively declared embedded fields, but does not search an embedded map's own base-map chain. Do not treat an incomplete collection or an unfound embedded-base field as proof that the native field does not exist.

## Variant and interval records

### `CreateEntityDataMapVariant(ValueFieldType?, Value?)`

Creates a descriptive JavaScript record with `TypeID`, `Type`, and `Value`. It does not allocate a native `variant_t` and has no native address.

`ValueFieldType` may be a numeric `FieldType` value or one canonical string: `void`, `bool`, `color32`, `float`, `int`, `string`, `vector`, `positionvector`, or `classaddress`.

The factory retains `Value` unchanged, including an object or array reference; it does not coerce or validate that value against `TypeID`. Omitting `Value` stores `null`, while an explicitly supplied `undefined` stays `undefined`. Omit the type argument to select `void`; an explicit `undefined` type is rejected.

```js
const { CreateEntityDataMapVariant, FieldType } = require("entities/datamaps");
const { LogInfo } = require("loggers");

const g_IntegerVariant = CreateEntityDataMapVariant(FieldType.Integer, 25);
const g_VectorVariant = CreateEntityDataMapVariant("positionvector", { X: 128, Y: 64, Z: 32 });
const g_EmptyVariant = CreateEntityDataMapVariant();
LogInfo("%j", { Operation: "CreateDataMapVariants", IntegerVariant: g_IntegerVariant, VectorType: g_VectorVariant.Type, VectorZ: g_VectorVariant.Value.Z, EmptyType: g_EmptyVariant.Type });
```

### `CreateEntityDataMapVariantFromAddress(unVariantAddress)`

Reads a real non-zero `variant_t*` and returns its `Address` as `BigInt`, along with `TypeID`, `Type`, and decoded `Value`. The decoded value is a read-time value; it is not a writable view over the variant.

Only SDK `FIELD_EHANDLE` variants decode `Value` as a borrowed native entity address (`BigInt`, or `0n` when unresolved), not an Entity wrapper. `FIELD_CLASSPTR` and `FIELD_EDICT` tags do not select the SDK's entity-handle member and decode to `null`, even if the variant retains an earlier handle. Other unsupported payload kinds likewise decode to `null`; inspect `TypeID` and `Type` rather than treating every null value as an empty native variant.

The binding rejects addresses that are zero, negative, outside `uintptr_t`, misaligned for the selected SDK's `variant_t`, or too close to the address-space limit for a complete record. It copies the live variant through the SDK's ordinary copy constructor; it does not reinterpret it as a project-defined layout or take ownership of it. These checks cannot establish whether memory is live and readable. Pass only an engine-supplied `variant_t*`, use callback-owned addresses synchronously, and do not retain them after the callback returns. An arbitrary or stale address can terminate the process. The variant and interval factories check the constructed V8 handle before returning a record; native C++ exceptions become operation-specific JavaScript errors.

Entity output hooks provide a legitimate `variant_t*`:

```js
const { CreateEntityDataMapVariantFromAddress } = require("entities/datamaps");
const {
	CreateEntityFireOutputHook,
	GetEntityFireOutputContext,
	RemoveEntityFireOutputHook,
} = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_OnEntityOutputFired = function OnEntityOutputFired(Payload) {
	const EntityFireOutputContext = GetEntityFireOutputContext(Payload);
	if (EntityFireOutputContext.ValueAddress === 0n) {
		throw new Error("The FireOutput callback did not provide a variant address.");
	}

	const Variant = CreateEntityDataMapVariantFromAddress(EntityFireOutputContext.ValueAddress);
	const strVariantValueText = (typeof Variant.Value === "bigint") ? `0x${Variant.Value.toString(16).toUpperCase()}` : String(Variant.Value);
	LogInfo("%j", { Operation: "InspectOutputVariant", OutputName: EntityFireOutputContext.OutputName, Type: Variant.Type, ValueText: strVariantValueText });
};

const g_UnloadPlugin = function UnloadPlugin() {
	if (!RemoveEntityFireOutputHook()) {
		throw new Error("Unable to remove the FireOutput hook.");
	}
};

const g_EntityFireOutputHook = CreateEntityFireOutputHook(g_OnEntityOutputFired);
if ((typeof g_EntityFireOutputHook.Address !== "bigint") || (g_EntityFireOutputHook.Address === 0n)) {
	throw new Error("The FireOutput hook did not expose a non-zero BigInt address.");
}

module.exports.Unload = g_UnloadPlugin;
```

The runtime calls the case-sensitive SourceJS-owned `module.exports.Unload` lifecycle export; no lowercase alias is installed. The diagnostic converts an entity-valued variant address to lossless hexadecimal text rather than passing a BigInt to JSON serialization.

### `CreateEntityDataMapInterval(flStart?, flRange?)`

Returns an ordinary `{ Start, Range }` value record. With no arguments, both components are zero. One scalar value accepted by V8's finite `float` conversion sets `Start` and leaves `Range` at zero; a second such value sets `Range`. An object or array must provide both components, which use the same conversion.

Object and array decoding reads and validates `Start` before `Range`, then commits the complete interval. Missing or nullish components are rejected. A component getter or conversion exception is propagated unchanged, stops later reads, and does not publish a partially decoded interval.

```js
const { CreateEntityDataMapInterval } = require("entities/datamaps");
const { LogInfo } = require("loggers");

const g_RespawnInterval = CreateEntityDataMapInterval(5, 10);
const g_CopiedInterval = CreateEntityDataMapInterval(g_RespawnInterval);
const g_ArrayInterval = CreateEntityDataMapInterval([2.5, 7.5]);
LogInfo("%j", { Operation: "CreateDataMapIntervals", CopiedStart: g_CopiedInterval.Start, ArrayRange: g_ArrayInterval.Range });
```

## Input functions

`GetEntityInputFunction(Entity, Field)` resolves an input from its external/internal string name or a field record. It returns:

| Field | Type | Meaning |
| --- | --- | --- |
| `Address` | bigint | Input `typedescription_t*`. |
| `Entity` | bigint | Borrowed native address of the resolved target entity. |
| `Description` | object | Full field record. |

Unresolved targets, absent/non-input fields, and invalid description storage raise an error rather than returning `null`.

The target may be a live Entity object, a signed-32-bit integer `Number` entity index, or a non-negative `BigInt` `CBaseEntity*` address that resolves to a currently registered entity. A field selector may also be a `BigInt` `typedescription_t*`, although a fresh field record is safer. `GetEntityInputFunction` preserves original entity/field selector-getter exceptions even when native C++ resolution also fails; the outer field selector owner rethrows the pending error before C++ leaves its scope. It rechecks the target's handle serial and base address after reading the field selector, before native metadata access. Removed, replaced, or moved targets are rejected. Description storage is checked for alignment and address-range overflow, but these checks do not prove that the allocation is live or large enough. Use only a live engine-owned address from a current field record. The returned `Address` and every field-record `Address` are borrowed engine metadata as `BigInt` values: do not invent or retain them beyond the owning datamap's lifetime. The returned `Entity` is likewise a borrowed `BigInt` target address, not an owning JavaScript entity wrapper. Native C++ failures without a pending JavaScript error become operation-specific JavaScript errors.

`CallEntityInputFunction(Entity, Field, Value?, Activator?, Caller?)` invokes the native input member directly on the game thread and returns `true`. Omitted activator/caller arguments default to the target; explicitly supplied nullish or unresolved values become null native addresses. The optional value is converted according to the input field type. The input member and field type are captured before activator/caller getters and value conversion. The target is revalidated before native metadata lookup, and every resolved participant's serial and base address are revalidated after conversion, before dispatch; removed, replaced, or moved participants cause an error without invoking the input. Original JavaScript getter errors are preserved through entity, field, and value-conversion owners even if native C++ also fails; selection or conversion failure prevents dispatch. Native C++ exceptions without a pending JavaScript error are translated into an operation-specific JavaScript error. A supplied native description must remain a live, aligned SDK record with sufficient storage; alignment and overflow checks do not prove an arbitrary address valid. Resolve descriptors from the target's own datamap hierarchy or a compatible native class. Direct dispatch does not check declaring-class compatibility; reusing a descriptor from an unrelated class can corrupt memory or terminate the process.

Unlike the target, `Activator` and `Caller` use Entity/index resolution only; a raw `BigInt` entity address is unresolved and becomes null. An omitted, `undefined`, or `null` `Value` skips input-value conversion and leaves the SDK-default variant; it is not converted to the selected field's zero value.

This creates a temporary entity, inspects its `Kill` input, and invokes it:

```js
const { CallEntityInputFunction, GetEntityInputFunction } = require("entities/datamaps");
const { CreateAndSpawnEntityByClassName } = require("entities/factories");
const { LogInfo } = require("loggers");

if (typeof CallEntityInputFunction !== "function") {
	throw new Error("This SDK does not expose direct datamap input dispatch.");
}

const g_TargetEntity = CreateAndSpawnEntityByClassName("info_target");
if (!g_TargetEntity) {
	throw new Error("The selected SDK could not create info_target.");
}

try {
	const InputFunction = GetEntityInputFunction(g_TargetEntity, "Kill");
	LogInfo("%j", { Operation: "InspectEntityInput", ExternalName: InputFunction.Description.ExternalName, Type: InputFunction.Description.Type });

	if (!CallEntityInputFunction(g_TargetEntity, InputFunction.Description)) {
		throw new Error("The direct Kill input call failed.");
	}
} finally {
	if (g_TargetEntity.Valid && !g_TargetEntity.RemoveEntity()) {
		throw new Error("Unable to remove the temporary info_target.");
	}
}
```

Input-value conversion depends on the selected native field type:

| Native field type | Accepted JavaScript value |
| --- | --- |
| `FIELD_BOOLEAN` | A Boolean primitive. |
| `FIELD_FLOAT`, `FIELD_TIME` | A value that V8 can convert to a finite number within the native `float` range. |
| `FIELD_INTEGER`, `FIELD_TICK`, `FIELD_MODELINDEX`, `FIELD_MATERIALINDEX` | A value that V8 can convert with its signed 32-bit integer conversion. |
| `FIELD_STRING`, `FIELD_MODELNAME`, `FIELD_SOUNDNAME` | A String primitive. |
| `FIELD_VECTOR`, `FIELD_POSITION_VECTOR` | An array `[X, Y, Z]`, an object with `X`/`Y`/`Z`, or an object with `Pitch`/`Yaw`/`Roll`. At least one component is required; omitted components become zero. |
| `FIELD_COLOR32` | An array `[Red, Green, Blue, Alpha?]` or an object with `Red`, `Green`, `Blue`, and optional `Alpha`. Components must be integer `Number` primitives in `[0, 255]`; omitted or nullish alpha becomes `255`. Strings, booleans, BigInts, objects, fractions, non-finite values, and large wrapping Numbers are rejected without component coercion. |
| `FIELD_CLASSPTR` | An Entity object or integer entity index. An unresolved value becomes a null entity handle. |

Float/time and signed-32-bit integer branches follow V8 coercion semantics; they do not require a JavaScript Number primitive. Color components instead require integer `Number` primitives. Component property getters still execute while reading a color object or array; a getter exception stops parsing and leaves the output color unchanged. Unsupported native field types throw instead of falling back to another variant family.

Color decoding resolves and validates every component before committing its result. A component getter exception is propagated unchanged and stops later component reads; invalid values are rejected without publishing a partially decoded color. The optional alpha default and primitive-integer validation apply equally to objects and arrays.

## Generic property API

`GetEntityDataMapProperty(Entity, Property, strType?)` and `SetEntityDataMapProperty(Entity, Property, Value, strType?)` infer the storage type when the selector is a string that resolves to a named field. A numeric offset or an ordinary field record resolves directly by byte offset and therefore has no field metadata at this stage. Without an explicit type, that path defaults to native `int`; provide the matching exact type string whenever the storage is not intentionally an `int`:

```text
bool, char, uchar, short, ushort, int, uint,
long, ulong, longlong, ulonglong, float, double,
string, stringarray, address, vector, color, interval, entity
```

Inference is not universal or symmetric. For embedded, custom, input/function, and matrix fields, the generic getter returns the field's address rather than a decoded value; the generic setter has no matching compound writer. Unhandled native kinds, including quaternion storage, fall back to native `int` instead of gaining a matching codec. Never assume an inferred read can be written back safely for those fields; use an explicit codec only after independently verifying its representation, or the owning structured-memory API.

An explicit type takes precedence over inference even for a named selector. The native binding does not prove that an offset and type stay within the entity object, have the required alignment, or match the real field width. Use fresh reflected metadata and the exact storage type; a wrong offset or type can read unrelated memory, corrupt the entity, or terminate the process.

This performs a reversible inferred write:

```js
const {
	FindEntityDataMapField,
	GetEntityDataMap,
	GetEntityDataMapProperty,
	SetEntityDataMapProperty,
} = require("entities/datamaps");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_strHealthDataMapFieldName = "m_iHealth";
const g_PlayerEntity = Player(1);
if (!g_PlayerEntity) {
	throw new Error("Expected player 1 to exist.");
}

const g_PlayerDataMap = GetEntityDataMap(g_PlayerEntity);
if (!g_PlayerDataMap) {
	throw new Error("The selected player has no datamap on this SDK.");
}

const g_HealthDataMapField = FindEntityDataMapField(g_PlayerDataMap, g_strHealthDataMapFieldName);
if (!g_HealthDataMapField || (g_HealthDataMapField.Type !== "int") || (g_HealthDataMapField.ElementCount !== 1) || (g_HealthDataMapField.SizeInBytes !== 4)) {
	throw new Error("This SDK does not expose m_iHealth as a scalar native int.");
}

const g_nPreviousHealth = GetEntityDataMapProperty(g_PlayerEntity, g_strHealthDataMapFieldName);
if (!Number.isInteger(g_nPreviousHealth)) {
	throw new Error("Unable to read a restorable native integer health value.");
}

const g_nTemporaryHealth = (g_nPreviousHealth === 100) ? 99 : 100;

try {
	if (!SetEntityDataMapProperty(g_PlayerEntity, g_strHealthDataMapFieldName, g_nTemporaryHealth)) {
		throw new Error("Unable to write the temporary health value.");
	}

	if (GetEntityDataMapProperty(g_PlayerEntity, g_strHealthDataMapFieldName) !== g_nTemporaryHealth) {
		throw new Error("The temporary health write was not visible in native memory.");
	}

	// A raw offset has no field metadata, so its type is explicit.
	LogInfo("%j", { Operation: "InspectTemporaryDataMapHealth", Health: GetEntityDataMapProperty(g_PlayerEntity, g_HealthDataMapField.Offset, "int") });
} finally {
	if (!SetEntityDataMapProperty(g_PlayerEntity, g_strHealthDataMapFieldName, g_nPreviousHealth)) {
		throw new Error("Unable to restore the health value.");
	}
}
```

Explicit type strings are case-sensitive, and an unknown value throws. Passing `null` as the type does not mean inference; omit the argument or pass `undefined`.

## Typed property API

Each setter returns `true` only after writing. Typed accessors bypass generic type inference and interpret storage according to the selected accessor.

Integer, floating-point, Boolean, Character, `string_t`, and native-address value accessors, including inferred generic scalar operations, transfer the selected native representation as bytes; their reads and writes do not require a typed dereference of the field. Edict/class-address setters likewise copy the native address representation. Vector setters copy the actual SDK float components, and Color and Interval setters copy their verified trivially-copyable representations. Live vector/interval getters and the SDK `CBaseHandle` getter and setter still require matching SDK-aligned storage. Address-plus-offset and complete selected-range arithmetic are checked for overflow; these checks do not establish the entity's allocation extent or prove an arbitrary offset readable or writable. The caller must select existing storage of the matching width and native type. The signed/unsigned integer, Boolean, Character, Float, Double, String, StringArray, Address, Vector, Color/Interval, and Entity typed accessors, and both generic property operations, translate native C++ exceptions into JavaScript errors naming the operation. Before writing, inferred generic scalar and Entity setters revalidate the destination Entity's serial and base address after reading values or running numeric coercion. Getter-thrown JavaScript errors are preserved; a removed, replaced, or moved destination is rejected without a field write.

| Getter / setter | JavaScript contract | Native storage |
| --- | --- | --- |
| `GetEntityDataMapPropertyBoolean` / `SetEntityDataMapPropertyBoolean` | Getter returns a Boolean; setter requires a Boolean primitive. | one-byte boolean representation |
| `GetEntityDataMapPropertyCharacter` / `SetEntityDataMapPropertyCharacter` | Getter converts the stored byte to a String, with NUL becoming an empty String. Setter accepts an in-range integer Number or any String, writes its first encoded byte, and writes NUL for an empty String. | `char` |
| `GetEntityDataMapPropertyUnsignedCharacter` / `SetEntityDataMapPropertyUnsignedCharacter` | Getter returns a Number; setter accepts an in-range integer Number or BigInt. | `unsigned char` |
| `GetEntityDataMapPropertyShort` / `SetEntityDataMapPropertyShort` | Getter returns a Number; setter accepts an in-range integer Number or BigInt. | `short` |
| `GetEntityDataMapPropertyUnsignedShort` / `SetEntityDataMapPropertyUnsignedShort` | Getter returns a Number; setter accepts an in-range integer Number or BigInt. | `unsigned short` |
| `GetEntityDataMapPropertyInteger` / `SetEntityDataMapPropertyInteger` | Getter returns a Number; setter accepts an in-range integer Number or BigInt. | `int` |
| `GetEntityDataMapPropertyUnsignedInteger` / `SetEntityDataMapPropertyUnsignedInteger` | Getter returns a Number; setter accepts an in-range integer Number or BigInt. | `unsigned int` |
| `GetEntityDataMapPropertyLong` / `SetEntityDataMapPropertyLong` | Getter returns a Number when `long` is no wider than `int`, otherwise a BigInt. A 32-bit setter accepts an in-range integer Number or BigInt; a 64-bit setter requires an in-range BigInt, even for small values. | C++ `long` |
| `GetEntityDataMapPropertyUnsignedLong` / `SetEntityDataMapPropertyUnsignedLong` | Getter returns a Number when `unsigned long` is no wider than `unsigned int`, otherwise a BigInt. A 32-bit setter accepts an in-range integer Number or BigInt; a 64-bit setter requires an in-range non-negative BigInt, even for small values. | C++ `unsigned long` |
| `GetEntityDataMapPropertyLongLong` / `SetEntityDataMapPropertyLongLong` | Getter returns a BigInt; setter requires an in-range BigInt, even for small values. | `long long` |
| `GetEntityDataMapPropertyUnsignedLongLong` / `SetEntityDataMapPropertyUnsignedLongLong` | Getter returns a BigInt; setter requires an in-range non-negative BigInt, even for small values. | `unsigned long long` |
| `GetEntityDataMapPropertyFloat` / `SetEntityDataMapPropertyFloat` | Getter returns a Number; setter uses V8 conversion and requires a finite value in the native `float` range. | `float` |
| `GetEntityDataMapPropertyDouble` / `SetEntityDataMapPropertyDouble` | Getter returns a Number; setter uses V8 conversion and requires a finite value. | `double` |
| `GetEntityDataMapPropertyString` / `SetEntityDataMapPropertyString` | Getter returns a String; setter requires a String primitive. | Source `string_t` |
| `GetEntityDataMapPropertyStringArray` / `SetEntityDataMapPropertyStringArray` | Getter requires a NUL terminator within the selected capacity and throws if absent; setter requires a String primitive and writes a terminated, capacity-limited copy. A positive reflected `SizeInBytes` supplies capacity; otherwise both accessors assume 256 bytes. | inline `char[]` |
| `GetEntityDataMapPropertyAddress` / `SetEntityDataMapPropertyAddress` | Getter returns a `BigInt`; setter requires a non-negative `BigInt` within `uintptr_t`, including `0n`. | native address |
| `GetEntityDataMapPropertyVector` / `SetEntityDataMapPropertyVector` | Getter returns a live `X`/`Y`/optional `Z` view. Setter accepts `[X, Y, Z]`, an object with `X`/`Y`/`Z`, or an object with `Pitch`/`Yaw`/`Roll`. | `Vector` or optional `Vector2D` |
| `GetEntityDataMapPropertyColor` / `SetEntityDataMapPropertyColor` | Getter returns a live color view. Setter accepts `[Red, Green, Blue, Alpha?]` or an object with `Red`/`Green`/`Blue`/optional `Alpha`. | `color32` |
| `GetEntityDataMapPropertyInterval` / `SetEntityDataMapPropertyInterval` | Getter returns a live interval view. Setter accepts `[Start, Range]` or an object with `Start` and `Range`. | `interval_t` |
| `GetEntityDataMapPropertyEntity` / `SetEntityDataMapPropertyEntity` | Getter returns an Entity or `null`. Named reflection metadata selects edict, class-address, or handle storage; unresolved edict/class-address setter values become null, while handle storage requires a resolvable Entity, index, or handle. | entity handle/address field |

Three codecs require a name-resolving selector to preserve reflection metadata. For a numeric offset or an ordinary field record with `Offset`, `stringarray` read/write capacity defaults to `256`, vector access assumes three floats instead of detecting `Vector2D`, and Entity access assumes `CBaseHandle` storage. Use a string name/path selector for those codecs unless the raw layout and capacity are independently proven. The string-array getter searches only within the selected capacity and throws if no NUL terminator is found; the entire capacity must be readable. Vector setters finish component conversion before resolving the target entity and copy only X/Y for reflected `Vector2D`, leaving adjacent storage unchanged. After range and alignment checks, handle reads use the real SDK copy constructor and handle writes call `Init` on the existing SDK handle; neither byte-copies a non-trivial SDK object.

`string_t` setters and string-valued variants allocate through the existing game-thread SDK string-pool path, not module-owned character storage. The game owns the resulting string until level shutdown, including strings retained by inputs after module unload. A nonempty string requires a live world entity and a usable pool; allocation failure throws without committing the field or variant. Empty strings or a leading NUL become `NULL_STRING`; an embedded NUL terminates the native value. String setters revalidate the destination entity after pool insertion and before the byte write. Pooled strings are not individually reclaimed during the level, so avoid repeated writes of unbounded transient text.

Target-selector exceptions stop entity-valued setters before fallback or native writes. Edict, class-address, handle, and fallback-index selectors preserve the original JavaScript exception even if native C++ resolution also fails while their `TryCatch` owner is active. The destination representation is captured before target getters run; the destination entity is revalidated before committing the write. SDK variant entity conversion uses the same checked class selector and leaves the variant unchanged on failure, while preserving its existing successful-null result for an unresolved target.

The complete accessor map is useful for tools that select a codec only after validating reflection metadata:

The temporary-write helper below also requires a synchronous callback and a saved value that its setter can restore. Returning a Promise does not postpone restoration. It rejects missing/null snapshots and non-finite numeric components before writing. A null Entity result is deliberately unsupported because handle setters require a resolvable entity. The same entity, referenced entities, and field layout must remain alive and unchanged throughout the callback; this helper neither pins them nor provides a transaction. Text codecs require valid, round-trippable UTF-8 text: restoration preserves the interpreted value, not raw backing bytes, bytes after a string terminator, or pooled-string identity. The `char` snapshot is restricted to ASCII/NUL; use a verified one-byte unsigned codec for arbitrary byte values.

```js
const {
	FindEntityDataMapField,
	GetEntityDataMap,
	GetEntityDataMapPropertyBoolean,
	GetEntityDataMapPropertyCharacter,
	GetEntityDataMapPropertyColor,
	GetEntityDataMapPropertyDouble,
	GetEntityDataMapPropertyEntity,
	GetEntityDataMapPropertyFloat,
	GetEntityDataMapPropertyInteger,
	GetEntityDataMapPropertyInterval,
	GetEntityDataMapPropertyLong,
	GetEntityDataMapPropertyLongLong,
	GetEntityDataMapPropertyAddress,
	GetEntityDataMapPropertyShort,
	GetEntityDataMapPropertyString,
	GetEntityDataMapPropertyStringArray,
	GetEntityDataMapPropertyUnsignedCharacter,
	GetEntityDataMapPropertyUnsignedInteger,
	GetEntityDataMapPropertyUnsignedLong,
	GetEntityDataMapPropertyUnsignedLongLong,
	GetEntityDataMapPropertyUnsignedShort,
	GetEntityDataMapPropertyVector,
	SetEntityDataMapPropertyBoolean,
	SetEntityDataMapPropertyCharacter,
	SetEntityDataMapPropertyColor,
	SetEntityDataMapPropertyDouble,
	SetEntityDataMapPropertyEntity,
	SetEntityDataMapPropertyFloat,
	SetEntityDataMapPropertyInteger,
	SetEntityDataMapPropertyInterval,
	SetEntityDataMapPropertyLong,
	SetEntityDataMapPropertyLongLong,
	SetEntityDataMapPropertyAddress,
	SetEntityDataMapPropertyShort,
	SetEntityDataMapPropertyString,
	SetEntityDataMapPropertyStringArray,
	SetEntityDataMapPropertyUnsignedCharacter,
	SetEntityDataMapPropertyUnsignedInteger,
	SetEntityDataMapPropertyUnsignedLong,
	SetEntityDataMapPropertyUnsignedLongLong,
	SetEntityDataMapPropertyUnsignedShort,
	SetEntityDataMapPropertyVector,
} = require("entities/datamaps");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_TypedAccessors = Object.freeze({
	bool: { Get: GetEntityDataMapPropertyBoolean, Set: SetEntityDataMapPropertyBoolean },
	char: { Get: GetEntityDataMapPropertyCharacter, Set: SetEntityDataMapPropertyCharacter },
	uchar: { Get: GetEntityDataMapPropertyUnsignedCharacter, Set: SetEntityDataMapPropertyUnsignedCharacter },
	short: { Get: GetEntityDataMapPropertyShort, Set: SetEntityDataMapPropertyShort },
	ushort: { Get: GetEntityDataMapPropertyUnsignedShort, Set: SetEntityDataMapPropertyUnsignedShort },
	int: { Get: GetEntityDataMapPropertyInteger, Set: SetEntityDataMapPropertyInteger },
	uint: { Get: GetEntityDataMapPropertyUnsignedInteger, Set: SetEntityDataMapPropertyUnsignedInteger },
	long: { Get: GetEntityDataMapPropertyLong, Set: SetEntityDataMapPropertyLong },
	ulong: { Get: GetEntityDataMapPropertyUnsignedLong, Set: SetEntityDataMapPropertyUnsignedLong },
	longlong: { Get: GetEntityDataMapPropertyLongLong, Set: SetEntityDataMapPropertyLongLong },
	ulonglong: { Get: GetEntityDataMapPropertyUnsignedLongLong, Set: SetEntityDataMapPropertyUnsignedLongLong },
	float: { Get: GetEntityDataMapPropertyFloat, Set: SetEntityDataMapPropertyFloat },
	double: { Get: GetEntityDataMapPropertyDouble, Set: SetEntityDataMapPropertyDouble },
	string: { Get: GetEntityDataMapPropertyString, Set: SetEntityDataMapPropertyString },
	stringarray: { Get: GetEntityDataMapPropertyStringArray, Set: SetEntityDataMapPropertyStringArray },
	address: { Get: GetEntityDataMapPropertyAddress, Set: SetEntityDataMapPropertyAddress },
	vector: { Get: GetEntityDataMapPropertyVector, Set: SetEntityDataMapPropertyVector },
	color: { Get: GetEntityDataMapPropertyColor, Set: SetEntityDataMapPropertyColor },
	interval: { Get: GetEntityDataMapPropertyInterval, Set: SetEntityDataMapPropertyInterval },
	entity: { Get: GetEntityDataMapPropertyEntity, Set: SetEntityDataMapPropertyEntity },
});

const g_CaptureEntityDataMapPropertyValue = function CaptureEntityDataMapPropertyValue(strCodecName, ValueEntityDataMapProperty) {
	if ((ValueEntityDataMapProperty === undefined) || (ValueEntityDataMapProperty === null)) {
		throw new TypeError("A non-null datamap property snapshot is required before a temporary write.");
	}

	switch (strCodecName) {
		case "vector": {
			const bHasZComponent = Object.hasOwn(ValueEntityDataMapProperty, "Z");
			const VectorSnapshot = { X: ValueEntityDataMapProperty.X, Y: ValueEntityDataMapProperty.Y };
			if (bHasZComponent) {
				VectorSnapshot.Z = ValueEntityDataMapProperty.Z;
			}

			if (!Number.isFinite(VectorSnapshot.X) || !Number.isFinite(VectorSnapshot.Y) || (bHasZComponent && !Number.isFinite(VectorSnapshot.Z))) {
				throw new RangeError("A finite vector snapshot is required before a temporary write.");
			}

			return VectorSnapshot;
		}

		case "color": {
			const IsColorComponentValid = function IsColorComponentValid(unComponent) {
				return Number.isInteger(unComponent) && (unComponent >= 0) && (unComponent <= 0xFF);
			};

			const ColorSnapshot = { Red: ValueEntityDataMapProperty.Red, Green: ValueEntityDataMapProperty.Green, Blue: ValueEntityDataMapProperty.Blue, Alpha: ValueEntityDataMapProperty.Alpha };
			const vecComponents = [ColorSnapshot.Red, ColorSnapshot.Green, ColorSnapshot.Blue, ColorSnapshot.Alpha];
			if (!vecComponents.every(IsColorComponentValid)) {
				throw new RangeError("An unsigned-byte color snapshot is required before a temporary write.");
			}

			return ColorSnapshot;
		}

		case "interval": {
			const IntervalSnapshot = { Start: ValueEntityDataMapProperty.Start, Range: ValueEntityDataMapProperty.Range };
			if (!Number.isFinite(IntervalSnapshot.Start) || !Number.isFinite(IntervalSnapshot.Range)) {
				throw new RangeError("A finite interval snapshot is required before a temporary write.");
			}

			return IntervalSnapshot;
		}

		default:
			if ((typeof ValueEntityDataMapProperty === "number") && !Number.isFinite(ValueEntityDataMapProperty)) {
				throw new RangeError("A finite numeric snapshot is required before a temporary write.");
			}

			if ((strCodecName === "char") && ((typeof ValueEntityDataMapProperty !== "string") || !/^[\u0000-\u007F]?$/.test(ValueEntityDataMapProperty))) {
				throw new RangeError("An ASCII/NUL character snapshot is required before a temporary write.");
			}

			return ValueEntityDataMapProperty;
	}
};

const g_LogTemporaryHealth = function LogTemporaryHealth(nCurrentHealth) {
	LogInfo("%j", { Operation: "InspectTypedDataMapHealth", Health: nCurrentHealth });
};

const g_TemporarilySetEntityDataMapProperty = function TemporarilySetEntityDataMapProperty(EntityValue, EntityDataMapField, strCodecName, ValueEntityDataMapProperty, Callback) {
	if (!Object.hasOwn(g_TypedAccessors, strCodecName)) {
		throw new TypeError(`Unknown datamap codec: ${strCodecName}`);
	}

	if (typeof Callback !== "function") {
		throw new TypeError("A synchronous callback is required before a temporary datamap write.");
	}

	const Codec = g_TypedAccessors[strCodecName];
	const strEntityDataMapFieldPath = EntityDataMapField && EntityDataMapField.Path;
	if ((typeof strEntityDataMapFieldPath !== "string") || (strEntityDataMapFieldPath.length === 0)) {
		throw new TypeError("A reflected datamap field path is required.");
	}

	const ValuePreviousEntityDataMapProperty = g_CaptureEntityDataMapPropertyValue(strCodecName, Codec.Get(EntityValue, strEntityDataMapFieldPath));

	try {
		if (!Codec.Set(EntityValue, strEntityDataMapFieldPath, ValueEntityDataMapProperty)) {
			throw new Error(`Unable to write datamap field with codec: ${strCodecName}`);
		}

		return Callback(Codec.Get(EntityValue, strEntityDataMapFieldPath));
	} finally {
		if (!Codec.Set(EntityValue, strEntityDataMapFieldPath, ValuePreviousEntityDataMapProperty)) {
			throw new Error(`Unable to restore datamap field with codec: ${strCodecName}`);
		}
	}
};

const g_RunTypedAccessorExample = function RunTypedAccessorExample() {
	const PlayerValue = Player(1);
	if (!PlayerValue) {
		throw new Error("Expected player 1 to exist.");
	}

	const PlayerDataMap = GetEntityDataMap(PlayerValue);
	if (!PlayerDataMap) {
		throw new Error("The selected player has no datamap on this SDK.");
	}

	const HealthDataMapField = FindEntityDataMapField(PlayerDataMap, "m_iHealth");
	if (!HealthDataMapField || (HealthDataMapField.Type !== "int") || (HealthDataMapField.ElementCount !== 1) || (HealthDataMapField.SizeInBytes !== 4)) {
		throw new Error("m_iHealth is not a scalar four-byte integer on this SDK.");
	}

	g_TemporarilySetEntityDataMapProperty(PlayerValue, HealthDataMapField, "int", 100, g_LogTemporaryHealth);
};

g_RunTypedAccessorExample();
```

## Live structured values

`GetEntityDataMapPropertyVector`, `GetEntityDataMapPropertyColor`, and `GetEntityDataMapPropertyInterval` return native data properties. Reading a component reads current entity memory; assigning a component writes it immediately.

| View | Fields |
| --- | --- |
| Vector | `Address` (`BigInt`), `X`, `Y`, and `Z`; a string selector that resolves `Vector2D` omits `Z`, while a raw offset or ordinary field record assumes three floats. |
| Color | `Address` (`BigInt`), `Red`, `Green`, `Blue`, `Alpha`. |
| Interval | `Address` (`BigInt`), `Start`, `Range`. |

Color component assignments require integer `Number` values from `0` to `255`. Strings, booleans, BigInts, fractional/non-finite Numbers, and objects are rejected before native component access. No coercion methods run, and large Numbers cannot wrap through `ToInt32`. Native C++ failures in the component getter or setter become operation-specific JavaScript errors without replacing an already pending JavaScript exception.

Live vector and interval component getters and setters also translate native C++ failures to operation-specific JavaScript errors. Their setters retain finite native-float conversion semantics, including supported V8 numeric coercion; an exception from a conversion is propagated before a component write.

These objects are borrowed views, not snapshots or owners. They retain raw component addresses without retaining or revalidating the entity. Use them only while the same entity and field storage are alive, and do not keep them across entity removal, map changes, or SDK teardown; a stale read or assignment can terminate the process or corrupt memory.

The specialized getters check address arithmetic and reject null storage. Live vector and interval creation also checks float-component or `interval_t` alignment. These checks do not prove the reflected field type, actual field size, entity allocation extent, or storage lifetime. Resolve a named field, verify its `Type`, and pass its `Path` so `Vector2D` metadata remains available; a mismatched name, ordinary field record, or raw offset can read outside the field, corrupt memory, or terminate the process.

This temporarily edits a live velocity vector and restores every component:

```js
const {
	FindEntityDataMapField,
	GetEntityDataMap,
	GetEntityDataMapPropertyVector,
} = require("entities/datamaps");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_PlayerEntity = Player(1);
if (!g_PlayerEntity) {
	throw new Error("Expected player 1 to exist.");
}

const g_PlayerDataMap = GetEntityDataMap(g_PlayerEntity);
if (!g_PlayerDataMap) {
	throw new Error("The selected player has no datamap on this SDK.");
}

const g_VelocityDataMapField = FindEntityDataMapField(g_PlayerDataMap, "m_vecAbsVelocity");
if (!g_VelocityDataMapField || (g_VelocityDataMapField.Type !== "vector") || (g_VelocityDataMapField.ElementCount !== 1) || (g_VelocityDataMapField.SizeInBytes !== 12)) {
	throw new Error("This SDK does not expose m_vecAbsVelocity as a scalar three-float Vector field.");
}

const g_strVelocityDataMapFieldPath = g_VelocityDataMapField.Path;
const g_Velocity = GetEntityDataMapPropertyVector(g_PlayerEntity, g_strVelocityDataMapFieldPath);
const g_VelocitySnapshot = { X: g_Velocity.X, Y: g_Velocity.Y, Z: g_Velocity.Z };
if (!Number.isFinite(g_VelocitySnapshot.X) || !Number.isFinite(g_VelocitySnapshot.Y) || !Number.isFinite(g_VelocitySnapshot.Z)) {
	throw new Error("The current velocity is not finite and cannot be restored safely.");
}

const g_flTemporaryVelocityZ = Math.fround(g_VelocitySnapshot.Z + 25);
if (!Number.isFinite(g_flTemporaryVelocityZ)) {
	throw new Error("The temporary velocity is outside the native float range.");
}

try {
	g_Velocity.Z = g_flTemporaryVelocityZ;
	if (g_Velocity.Z !== g_flTemporaryVelocityZ) {
		throw new Error("The live velocity view did not expose the native write.");
	}

	LogInfo("%j", { Operation: "InspectLiveDataMapVelocity", Address: `0x${g_Velocity.Address.toString(16).toUpperCase()}`, Z: g_Velocity.Z });
} finally {
	g_Velocity.X = g_VelocitySnapshot.X;
	g_Velocity.Y = g_VelocitySnapshot.Y;
	g_Velocity.Z = g_VelocitySnapshot.Z;
}
```

Whole-value setters accept arrays or objects and update the same storage:

```js
const {
	FindEntityDataMapField,
	GetEntityDataMap,
	GetEntityDataMapPropertyColor,
	SetEntityDataMapPropertyColor,
} = require("entities/datamaps");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_PlayerEntity = Player(1);
if (!g_PlayerEntity) {
	throw new Error("Expected player 1 to exist.");
}

const g_PlayerDataMap = GetEntityDataMap(g_PlayerEntity);
if (!g_PlayerDataMap) {
	throw new Error("The selected player has no datamap on this SDK.");
}

const g_ColorDataMapField = FindEntityDataMapField(g_PlayerDataMap, "m_clrRender");
if (!g_ColorDataMapField || (g_ColorDataMapField.Type !== "color32") || (g_ColorDataMapField.ElementCount !== 1) || (g_ColorDataMapField.SizeInBytes !== 4)) {
	throw new Error("This SDK does not expose m_clrRender as a scalar four-byte color32 field.");
}

const g_strColorDataMapFieldPath = g_ColorDataMapField.Path;
const g_Color = GetEntityDataMapPropertyColor(g_PlayerEntity, g_strColorDataMapFieldPath);
const g_vecPreviousColor = [g_Color.Red, g_Color.Green, g_Color.Blue, g_Color.Alpha];

try {
	if (!SetEntityDataMapPropertyColor(g_PlayerEntity, g_strColorDataMapFieldPath, [80, 160, 255, g_vecPreviousColor[3]])) {
		throw new Error("Unable to write the render color.");
	}

	LogInfo("%j", { Operation: "InspectLiveDataMapColor", Red: g_Color.Red, Green: g_Color.Green, Blue: g_Color.Blue }); // The existing view rereads new memory.
} finally {
	if (!SetEntityDataMapPropertyColor(g_PlayerEntity, g_strColorDataMapFieldPath, g_vecPreviousColor)) {
		throw new Error("Unable to restore the render color.");
	}
}
```

## Practical workflows

### Enumerate inputs and keys

```js
const {
	GetEntityDataMap,
	GetEntityDataMapFields,
	TypeDescriptionFlags,
} = require("entities/datamaps");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_PlayerEntity = Player(1);
if (!g_PlayerEntity) {
	throw new Error("Expected player 1 to exist.");
}

const g_PlayerDataMap = GetEntityDataMap(g_PlayerEntity);
if (!g_PlayerDataMap) {
	throw new Error("The selected player has no datamap on this SDK.");
}

const g_vecEntityDataMapFields = GetEntityDataMapFields(g_PlayerDataMap, true);
for (const EntityDataMapField of g_vecEntityDataMapFields) {
	if ((EntityDataMapField.Flags & (TypeDescriptionFlags.Input | TypeDescriptionFlags.Key)) === 0) {
		continue;
	}

	LogInfo("%j", { Operation: "InspectDataMapInputOrKey", Path: EntityDataMapField.Path, ExternalName: EntityDataMapField.ExternalName, Type: EntityDataMapField.Type, Offset: EntityDataMapField.Offset });
}
```

### Resolve a field by external name

```js
const { FindEntityDataMapField, GetEntityDataMap } = require("entities/datamaps");
const { LogInfo } = require("loggers");

const g_BaseEntityDataMap = GetEntityDataMap("CBaseEntity");
if (!g_BaseEntityDataMap) {
	throw new Error("This SDK does not expose the CBaseEntity datamap.");
}

const g_TargetNameDataMapField = FindEntityDataMapField(g_BaseEntityDataMap, "targetname");
if (!g_TargetNameDataMapField) {
	throw new Error("CBaseEntity has no targetname key on this SDK.");
}

LogInfo("%j", { Operation: "InspectDataMapExternalName", Name: g_TargetNameDataMapField.Name, ExternalName: g_TargetNameDataMapField.ExternalName, Key: g_TargetNameDataMapField.Key });
```

### Read an entity handle safely

```js
const {
	FindEntityDataMapField,
	GetEntityDataMap,
	GetEntityDataMapPropertyEntity,
} = require("entities/datamaps");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_EntityValue = Entity(1);
if (!g_EntityValue) {
	throw new Error("Expected entity 1 to exist.");
}

const g_EntityDataMap = GetEntityDataMap(g_EntityValue);
if (!g_EntityDataMap) {
	throw new Error("The selected entity has no datamap on this SDK.");
}

const g_OwnerDataMapField = FindEntityDataMapField(g_EntityDataMap, "m_hOwnerEntity");
if (!g_OwnerDataMapField || (g_OwnerDataMapField.Type !== "entityhandle") || (g_OwnerDataMapField.ElementCount !== 1) || (g_OwnerDataMapField.SizeInBytes !== 4)) {
	throw new Error("This SDK does not expose m_hOwnerEntity as a scalar four-byte entity handle.");
}

const g_strOwnerDataMapFieldPath = g_OwnerDataMapField.Path;
const g_OwnerEntity = GetEntityDataMapPropertyEntity(g_EntityValue, g_strOwnerDataMapFieldPath);
LogInfo("%j", { Operation: "InspectDataMapOwnerEntity", EntityIndex: g_OwnerEntity ? g_OwnerEntity.Index : null });
```

### Inspect character-array metadata and intervals

`FIELD_CHARACTER` metadata with a size greater than one identifies an inline character array, not necessarily a NUL-terminated string. The native string-array getter searches within a positive reflected `SizeInBytes` bound when a name-resolving selector retains metadata, and throws if no NUL byte exists there. An offset selector instead assumes a readable 256-byte buffer. Use it only for storage whose field type, capacity, and lifetime were independently verified. This workflow reports a character-array candidate without dereferencing it and reads only an interval whose reflected type was verified.

```js
const {
	GetEntityDataMap,
	GetEntityDataMapFields,
	GetEntityDataMapPropertyInterval,
} = require("entities/datamaps");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_IsCharacterArrayEntityDataMapField = function IsCharacterArrayEntityDataMapField(EntityDataMapField) {
	return (EntityDataMapField.Type === "char") && (EntityDataMapField.ElementCount > 1) && (EntityDataMapField.SizeInBytes > 1) && (EntityDataMapField.Path.length > 0);
};

const g_IsIntervalEntityDataMapField = function IsIntervalEntityDataMapField(EntityDataMapField) {
	return (EntityDataMapField.Type === "interval") && (EntityDataMapField.ElementCount === 1) && (EntityDataMapField.SizeInBytes === 8) && (EntityDataMapField.Path.length > 0);
};

const g_RunStructuredFieldInspection = function RunStructuredFieldInspection() {
	const EntityValue = Entity(1);
	if (!EntityValue) {
		throw new Error("Expected entity 1 to exist.");
	}

	const EntityDataMap = GetEntityDataMap(EntityValue);
	if (!EntityDataMap) {
		throw new Error("The selected entity has no datamap on this SDK.");
	}

	const vecEntityDataMapFields = GetEntityDataMapFields(EntityDataMap, true);
	const CharacterArrayDataMapField = vecEntityDataMapFields.find(g_IsCharacterArrayEntityDataMapField);
	const IntervalDataMapField = vecEntityDataMapFields.find(g_IsIntervalEntityDataMapField);
	if (CharacterArrayDataMapField) {
		LogInfo("%j", { Operation: "InspectCharacterArrayMetadata", Path: CharacterArrayDataMapField.Path, SizeInBytes: CharacterArrayDataMapField.SizeInBytes });
	}

	if (IntervalDataMapField) {
		const Interval = GetEntityDataMapPropertyInterval(EntityValue, IntervalDataMapField.Path);
		LogInfo("%j", { Operation: "InspectLiveDataMapInterval", Path: IntervalDataMapField.Path, StartText: String(Interval.Start), RangeText: String(Interval.Range), Address: `0x${Interval.Address.toString(16).toUpperCase()}` });
	}
};

g_RunStructuredFieldInspection();
```

## Errors and memory safety

- Property setters write engine memory immediately. Restore temporary changes in `finally`.
- Never choose a typed accessor only because its JavaScript value looks compatible. Confirm `Type`, `ElementCount`, `SizeInBytes`, and the selected SDK layout first.
- Using a wrong width can overwrite adjacent native fields and crash the server.
- `long` follows the target C++ ABI. It is 32-bit on Windows and may be 64-bit on 64-bit Linux. Values wider than 32 bits use BigInt.
- `longlong`, `ulonglong`, and every native address use `BigInt` on every architecture. Address inputs must be non-negative and fit `uintptr_t`; `Number` values are not accepted as raw addresses.
- A numeric property offset or a field record with a valid integer `Offset` is consumed without reflected type metadata; address arithmetic checks do not prove entity-allocation bounds. Prefer a name/path selector whenever metadata is required.
- `GetEntityDataMapPropertyStringArray` searches for NUL only within a positive reflected `SizeInBytes` bound, or within the 256-byte default capacity when metadata is absent; it throws if unterminated. Both StringArray accessors use reflection only for a name-resolving selector. A numeric offset or field record with `Offset` assumes 256 bytes, so the caller must verify that this entire range belongs to the actual readable/writable character array. Do not use either accessor on unknown storage.
- Live Vector/Color/Interval views become invalid when the entity is removed, its storage changes, or an index is reused.
- Datamap addresses, field addresses, input addresses, and variant addresses are engine-owned. Never deallocate them.
- `CreateEntityDataMapVariant()` is only a JavaScript value record. Use `CreateEntityDataMapVariantFromAddress()` only with a real native `variant_t*` supplied by an owning API.
- Input dispatch runs engine code synchronously and may remove or mutate the target before the call returns.
- Missing SDK capabilities are absent properties. SourceJS does not install throw-only JavaScript stubs.

Related modules: [`entities`](entities.md), [`entities/classes`](entities-classes.md), [`entities/props`](entities-props.md), [`entities/outputs`](entities-outputs.md), [`entities/factories`](entities-factories.md), [`memory`](memory.md), and [`memory/hooks`](memory-hooks.md).
