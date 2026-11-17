# `require("entities/props")`

> Warning: this is a large reference for a low-level live-memory API. A getter or setter with the wrong storage width can read unrelated bytes or corrupt an entity. Resolve and validate the `SendProp` first, restore temporary changes, never reuse entity state after its index has been recycled, and use the table of contents to keep type and ownership rules together.

`entities/props` exposes Source's server-class and send-table reflection plus direct typed access to an entity's network-property storage. The implementation uses the selected HL2SDK's `ServerClass`, `SendTable`, `SendProp`, `CBaseHandle`, and entity memory. It does not maintain a JavaScript SDK model. The package entry point is [packages/sourcejs/entities/props.js](../../packages/sourcejs/entities/props.js); the native implementation is [src/sourcejs/modules/ModuleBindings.cpp](../../src/sourcejs/modules/ModuleBindings.cpp).

Call these engine-memory APIs on the server/game thread while the referenced metadata and entities are live. Reflection records and vector views neither pin entity lifetime nor synchronize with engine mutation.

Selectors, component getters, and numeric conversions can execute JavaScript. Keep the entity and its storage alive throughout the operation and any temporary-value restoration; do not remove or recycle it from those callbacks. The current bindings do not pin entity lifetime across reentrant conversion, and arithmetic range checks do not establish liveness.

Property resolution snapshots the entity handle, including its serial, and checks that handle and the base-entity address after descriptor getters before native property access. Whole-vector setters and the `float`/`double` setter paths check the same identity again after component getters or numeric conversion; this includes explicit generic dispatch and inferred `float` properties. A removed or replaced entity raises an error before the write, even when its replacement uses the same address. Revalidation does not repeat input getters or replace an exception thrown by conversion. These checks do not pin borrowed source vectors, extend the lifetime of returned views, or provide a post-conversion guarantee for every other typed setter.

This module exists only when the selected SDK exposes server send properties. On an SDK without that capability, `require("entities/props")` throws because the native module is not installed.

## Table of contents

- [Import](#import)
- [Export surface](#export-surface)
- [Reflection records](#reflection-records)
- [SendProp proxy hooks](#sendprop-proxy-hooks)
- [Resolving metadata](#resolving-metadata)
- [Property identifiers](#property-identifiers)
- [Generic access](#generic-access)
- [Typed access](#typed-access)
- [Live vectors](#live-vectors)
- [Entity handles](#entity-handles)
- [Strings and addresses](#strings-and-addresses)
- [Variants](#variants)
- [Send property constants](#send-property-constants)
- [Practical workflows](#practical-workflows)
- [Errors and ownership](#errors-and-ownership)
- [Related modules](#related-modules)

## Import

```js
const {
	GetEntityPropertyInteger,
	GetEntitySendProperty,
	SetEntityPropertyInteger,
} = require("entities/props");
const { LogInfo } = require("loggers");

const g_ReportEntityPropertyCapabilities = function ReportEntityPropertyCapabilities() {
	LogInfo("ReportEntityPropertyCapabilities Result=%j", { GetEntityPropertyIntegerType: typeof GetEntityPropertyInteger, GetEntitySendPropertyType: typeof GetEntitySendProperty, SetEntityPropertyIntegerType: typeof SetEntityPropertyInteger });
};

g_ReportEntityPropertyCapabilities();
```

The package entry point returns the native module object for the current plugin context. It has no default export or alternate module path. It adds no higher-level wrapper.

## Export surface

When installed, the module has exactly 66 top-level exports: 48 PascalCase functions, `SendPropType`, `SendPropFlags`, and sixteen standalone `SPROP_*` constants. The module does not install lower-camel function aliases or CamelCase constant aliases. `SendPropType.VECTOR_XY` and the `PropertiesEncodedAgainstTickCount` record field are selected-SDK capabilities rather than guaranteed members. Native functions are created as own properties without invoking inherited setters, and retain their runtime callback data.

### Reflection

| Export and signature | Result |
| --- | --- |
| `GetServerClasses()` | Returns a point-in-time array of every `ServerClass` record. |
| `FindServerClassByName(strServerClassName)` | Returns the matching `ServerClass`, or `null`. |
| `GetEntityServerClass(Entity)` | Returns the entity's `ServerClass`, or `null`. |
| `GetEntitySendTable(Entity)` | Returns the entity's root `SendTable`, or `null`. |
| `GetSendTable(Value)` | Resolves an entity, server class, or send table and returns its `SendTable`; an unresolved value gives `null`. |
| `GetServerClassProperty(Reference, PropertySelector)` | Resolves an integer direct-property index or a direct/recursive property name and returns its `SendProp`; an unresolved property gives `null`. |
| `GetEntitySendProperty(Entity, strPropertyName)` | Resolves the property against the entity's actual server class, or returns `null`. |
| `AddSendPropertyHook(nEntityIndex, strPropertyName, Callback)` | Registers a callback after the property's native value proxy, or returns `null` when the proxy cannot be hooked. |
| `GetServerClassProperties(Value)` | Returns a flattened recursive `SendProp[]`; an unresolved value gives `[]`. |
| `FindServerClassPropertyOffset(Reference, strPropertyName)` | Returns the property's complete byte offset relative to the supplied `SendTable`; for a root table or entity, this is relative to the entity base. Returns `-1` when the reference or property cannot be resolved. |

### Property values

| Export family | Exact public signature |
| --- | --- |
| Generic read | `GetEntityProperty(Entity, PropertyReference, strPropertyType = undefined)` |
| Generic write | `SetEntityProperty(Entity, PropertyReference, Value, strPropertyType = undefined)` |
| Typed reads | `GetEntityPropertyBoolean`, `GetEntityPropertyCharacter`, `GetEntityPropertyUnsignedCharacter`, `GetEntityPropertyShort`, `GetEntityPropertyUnsignedShort`, `GetEntityPropertyInteger`, `GetEntityPropertyUnsignedInteger`, `GetEntityPropertyLong`, `GetEntityPropertyUnsignedLong`, `GetEntityPropertyLongLong`, `GetEntityPropertyUnsignedLongLong`, `GetEntityPropertyFloat`, `GetEntityPropertyDouble`, `GetEntityPropertyStringAddress`, `GetEntityPropertyStringArray`, `GetEntityPropertyAddress`, `GetEntityPropertyVector`, and `GetEntityPropertyEntity` |
| Typed writes | The matching `SetEntityProperty*` operation for every typed read. |
| Variant descriptor | `CreateEntityPropertyVariant()`, `CreateEntityPropertyVariant(strType)`, or `CreateEntityPropertyVariant(strType, Value)` |

Every successful typed setter returns `true`. Failed validation throws before the write.

### Constants

- `SendPropType`: exact `INT`, `FLOAT`, `VECTOR`, optional `VECTOR_XY`, `STRING`, `ARRAY`, and `DATA_TABLE` type-ID keys.
- `SendPropFlags`: exact `UNSIGNED`, `COORD`, `NO_SCALE`, `ROUND_DOWN`, `ROUND_UP`, `NORMAL`, `EXCLUDE`, `XYZE`, `INSIDE_ARRAY`, `PROXY_ALWAYS_YES`, `IS_VECTOR_ELEMENT`, `COLLAPSIBLE`, `COORD_MP`, `COORD_MP_LOW_PRECISION`, `COORD_MP_INTEGRAL`, and `CHANGES_OFTEN` flag keys.
- Sixteen standalone `SPROP_*` constants matching the HL2SDK names exactly.

## Reflection records

Reflection calls return point-in-time metadata records containing native addresses as `bigint`. The engine owns the pointed-to objects. Do not deallocate them, and reacquire metadata after a level or server-DLL transition.

`Kind` and `Address` are own properties, as are all metadata fields produced for `ServerClass`, `SendTable`, and `SendProp` records and the exported constant dictionaries. Property arrays receive own indexed entries; inherited JavaScript setters are not invoked while defining these fields or entries. Class-name and table-name lookup terminate on repeated server-class links without imposing a class-count limit. Recursive table traversal retains its existing depth limit.

`GetServerClasses()` validates each native class record, rejects invalid or cyclic links, and defines own array entries. Server-class, send-table record and entity selectors preserve getter-thrown JavaScript errors, including when a native C++ exception also unwinds the selector. This includes name, kind and address getters. A failed getter stops later fallback reads and class/table lookup; a getter failure during entity selection leaves the optional base-entity output unchanged. Reflection callbacks translate native C++ failures into JavaScript errors; numeric property lookup validates send-table and property storage before reading SDK metadata. These checks do not establish lifetime or protect against invalid-memory faults.

Class/table orchestration and field-address resolution also preserve the original getter error through native C++ unwinding. Failed resolution leaves its class/table outputs or field-address/property-information outputs unchanged. Typed setters do not write the field after a selector failure; numeric offsets and named-property lookup keep their normal result and ownership rules.

### `ServerClass`

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | `"serverclass"` | Record discriminator. |
| `Address` | `bigint` | Native `ServerClass*`. |
| `Name` | `string` | Network class name reported by the active server DLL. |
| `ClassIndex` | `number` | Network class ID. |
| `InstanceBaselineIndex` | `number` | Instance-baseline string-table index reported by the SDK. |
| `Table` | `SendTable` | Root send table, including direct properties. |
| `NextAddress` | `bigint` | Native address to the linked-list successor, or `0n`. |

### `SendTable`

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | `"sendtable"` | Record discriminator. |
| `Address` | `bigint` | Native `SendTable*`. |
| `Name` | `string` | Table name such as `DT_BasePlayer`. |
| `ServerClassName` | `string` | Owning class name, or `""` when no owning class is available. |
| `PropertyCount` | `number` | Number of direct properties. |
| `Initialized` | `boolean` | Current SDK initialization flag at record creation. |
| `WriteFlag` | `boolean` | Current SDK write flag at record creation. |
| `PropertiesEncodedAgainstTickCount` | `boolean` | Present only on SDKs that expose this query. |
| `Properties` | `SendProp[]` | Direct properties. Nested table records stored on a `SendProp` deliberately have an empty array; call `GetServerClassProperties()` or `GetSendTable()` to expand them. |

### `SendProp`

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | `"sendprop"` | Record discriminator. |
| `Address` | `bigint` | Native `SendProp*`. |
| `ServerClassName` | `string` | Owning class name, or `""` when no owning class is available. |
| `TableName` | `string` | Table that directly owns this property. |
| `Index` | `number` | Direct index in `TableName`. |
| `Name` | `string` | Direct property name. |
| `Path` | `string` | Recursive path from the requested root table. |
| `Offset` | `number` | Cumulative byte offset from the requested root table; for an entity or server-class root, this is relative to the entity base. |
| `TypeID` | `number` | Selected-SDK `SendPropType` value. |
| `Type` | `string` | `int`, `float`, `vector`, `string`, `array`, `datatable`, or `unknown`; `vectorxy` is available only on SDKs that expose `DPT_VectorXY`. |
| `Flags` | `number` | Bit mask of `SendPropFlags`. |
| `BitCount` | `number` | Network bit count. |
| `LowValue` | `number` | Lower network quantization bound. |
| `HighValue` | `number` | Upper network quantization bound. |
| `ArrayLength` | `number` | Array element count. |
| `ElementStride` | `number` | Array byte stride. |
| `ExcludeDataTableName` | `string` | Excluded table name, or `""`. |
| `ParentArrayPropertyName` | `string` | Parent array property name, or `""`. |
| `HighLowMultiplier` | `number` | SDK quantization multiplier. |
| `Signed` | `boolean` | Whether integer encoding is signed. |
| `ExcludedProperty` | `boolean` | Whether this is an exclusion record. |
| `InsideArray` | `boolean` | Whether this property describes an array element. |
| `ArrayPropertyAddress` | `bigint` | Native array-element `SendProp*`, or `0n`. |
| `ProxyFunctionAddress` | `bigint` | Non-`DataTable` send-property proxy address; `0n` for excluded properties or an absent proxy. |
| `DataTableProxyFunctionAddress` | `bigint` | Data-table proxy function address; `0n` for other types, excluded properties, or an absent proxy. |
| `ArrayLengthProxyFunctionAddress` | `bigint` | Array-length proxy function address; `0n` for non-array or excluded properties, or an absent proxy. |
| `DataTable` | `SendTable \| null` | Nested table metadata for `DataTable` properties (its native address can be `0n`); otherwise `null`. |

These plain JavaScript metadata objects expose only the exact fields listed above. They neither own engine memory nor write through to SDK records. Property getters and setters access live entity storage, while vector results are live views; reacquire reflection metadata after its engine lifetime may have ended.

## SendProp proxy hooks

`AddSendPropertyHook(nEntityIndex, strPropertyName, Callback)` resolves the entity's
`SendProp::GetProxyFn()` and registers a post-hook using [`memory/hooks`](memory-hooks.md).
The callback receives `{ EntityIndex, ElementIndex, PropertyName, Value }`. It can return
a replacement number or vector array; `undefined` or `null` keeps the original.
Supported types are `int`, `float`, `vectorxy` and `vector`. Use the full reflected
property path if the short name is ambiguous.
If the property has no value proxy, registration returns `null`. It does not
install a default proxy or use the distinct SendTable proxy ABI.

The hook changes only the proxy's outgoing value, not the entity field. It applies to
all normal recipients and does not change visibility, force an entity update, or
invalidate cached snapshots. If the engine calls the proxy on a worker thread, the
SendProp hook leaves the original value untouched; its private dispatch runs JavaScript
only on the game thread and does not change ordinary `memory/hooks` dispatch.
Run this feature on a server profile that packs entities on that thread when
you need every proxy call to be intercepted.

The returned handle has `Remove()` to detach its callback. The underlying hook is
shared by properties that use the same proxy and remains owned by the plugin until
unload. Do not remove the underlying hook with `memory/hooks` or acquire it separately
for the same address. The entity index is a slot, not a lifetime token; remove the
callback when the entity leaves if it must not apply to a new occupant.

```js
const { AddSendPropertyHook } = require("entities/props");

function ReplaceOutgoingHealth(ProxyResult) {
	return (ProxyResult.Value > 42) ? 42 : undefined;
}

const g_HealthHook = AddSendPropertyHook(4, "m_iHealth", ReplaceOutgoingHealth);
if (!g_HealthHook) {
	throw new Error("The entity has no available health proxy.");
}

function Unload() {
	if (!g_HealthHook.Remove()) {
		throw new Error("Could not detach the health proxy callback.");
	}
}

module.exports = { Unload };
```

## Resolving metadata

The general `GetSendTable()`, `GetServerClassProperties()`, `GetServerClassProperty()`, and `FindServerClassPropertyOffset()` resolvers accept the forms below. Entity-specific `GetEntity*` operations still require an entity selector:

- class name obtained from `ServerClass.Name`;
- table name obtained from `ServerClass.Table.Name` or `SendTable.Name`;
- `ServerClass` or `SendTable` record;
- signed `Int32` entity index, live Entity object, or non-negative `BigInt` edict/`CBaseEntity*` address where the operation accepts an entity;
- native `ServerClass*` or `SendTable*` address as `BigInt` for low-level extension integration. Bare class addresses are matched against the active server DLL's registered classes; other bare metadata addresses are treated as send tables. An unregistered class needs an explicit `{ Kind: "serverclass", Address: unAddress }` record; an address-only table record uses `Kind: "sendtable"`. Alignment, complete property-array arithmetic, and address-range overflow are checked, but ownership, actual allocation extent, and liveness are not: a stale or invalid address can still crash the process. Getter-thrown errors stop resolution instead of falling through to another representation.

Names are case-sensitive. A function with a dedicated required name argument requires a non-empty string and throws when that validation fails. A class/table resolver value that does not resolve, including an empty string or unsupported representation, returns `null`, `[]`, or `-1` according to the function table above; missing required arguments throw.

```js
const {
	FindServerClassByName,
	FindServerClassPropertyOffset,
	GetSendTable,
	GetServerClassProperties,
	GetServerClassProperty,
	GetServerClasses,
} = require("entities/props");
const { LogInfo } = require("loggers");

const g_HasServerClassProperties = function HasServerClassProperties(ServerClass) {
	return GetServerClassProperties(ServerClass.Table).length > 0;
};

const g_ReportResolvedServerClassMetadata = function ReportResolvedServerClassMetadata() {
	const vecServerClasses = GetServerClasses();
	const SelectedServerClass = vecServerClasses.find(g_HasServerClassProperties);
	if (SelectedServerClass === undefined) {
		throw new Error("The server exposes no class with reflected send properties.");
	}

	const ResolvedServerClass = FindServerClassByName(SelectedServerClass.Name);
	const SendTable = GetSendTable(SelectedServerClass);
	if ((ResolvedServerClass === null) || (SendTable === null) || (ResolvedServerClass.Address !== SelectedServerClass.Address)) {
		throw new Error("The reflected server class did not resolve to its native table.");
	}

	const vecServerClassProperties = GetServerClassProperties(SendTable);
	const ServerClassProperty = vecServerClassProperties[0];
	const ResolvedServerClassProperty = GetServerClassProperty(SendTable, ServerClassProperty.Path);
	const nVerifiedPropertyOffset = FindServerClassPropertyOffset(SendTable, ServerClassProperty.Path);
	if ((ResolvedServerClassProperty === null) || (ResolvedServerClassProperty.Offset !== ServerClassProperty.Offset) || (nVerifiedPropertyOffset !== ServerClassProperty.Offset)) {
		throw new Error("Recursive SendProp resolution returned inconsistent metadata.");
	}

	LogInfo("ReportResolvedServerClassMetadata Result=%j", { VerifiedPropertyOffset: nVerifiedPropertyOffset, ClassName: ResolvedServerClass.Name, PropertyPath: ServerClassProperty.Path, TableName: SendTable.Name, ServerClassCount: vecServerClasses.length });
};

g_ReportResolvedServerClassMetadata();
```

`GetServerClassProperty(Reference, nPropertyIndex)` reads a direct property. `GetServerClassProperty(Reference, strPropertyNameOrPath)` and `FindServerClassPropertyOffset()` recurse through data tables and the conventional `baseclass` chain. `GetServerClassProperties()` returns each nested property with its accumulated `Path` and `Offset`.

## Property identifiers

Every value accessor accepts one of these property forms:

| Form | Example | Use |
| --- | --- | --- |
| Name/path | `"m_iHealth"`, `"baseclass.m_vecOrigin"` | Resolve through the entity's real send table. |
| Byte offset | `HealthProperty.Offset` | Use only after validating metadata for this exact class/SDK. |
| Reflection record | `HealthProperty` | Uses the record's `Offset`. |
| Minimal offset object | `{ Offset: GameData.HealthOffset }` | Extension/gamedata integration with a reviewed layout. |

The name/path form is safest because it resolves against the live entity's server class. Numeric offsets, reflection records, and minimal offset objects use an integer offset directly; they bypass type and class validation and do not check that the offset is nonnegative or that the selected storage range belongs to the entity. Signed offset arithmetic rejects native-address overflow, underflow, and a resulting zero address before committing a field address. Getter-thrown errors stop entity/property resolution and preserve the original error instead of falling through to another selector or replacing it with a lookup error.

Integer, native-address, floating-point, character, and Boolean accessors check address-range overflow for the complete scalar width and copy bytes without requiring aligned typed access. Boolean reads reject bytes that are neither the selected native ABI's `false` nor `true` representation. Native C++ exceptions during these operations become JavaScript errors; this is not protection against invalid-memory faults. Range checks do not establish allocation extent, ownership, or liveness.

```js
const { Entity } = require("entities/entity");
const {
	GetEntityPropertyInteger,
	GetEntitySendProperty,
	GetEntitySendTable,
	GetEntityServerClass,
} = require("entities/props");
const { LogInfo } = require("loggers");

const g_ReportEntityPropertyIdentifiers = function ReportEntityPropertyIdentifiers() {
	const strHealthPropertyName = "m_iHealth";
	const nPlayerEntityIndex = 1;
	const PlayerEntity = Entity(nPlayerEntityIndex);
	if (PlayerEntity === null) {
		throw new Error(`Entity index ${nPlayerEntityIndex} is not live.`);
	}

	const EntityServerClass = GetEntityServerClass(PlayerEntity);
	const EntitySendTable = GetEntitySendTable(PlayerEntity);
	const HealthProperty = GetEntitySendProperty(PlayerEntity, strHealthPropertyName);
	if ((EntityServerClass === null) || (EntitySendTable === null) || (HealthProperty === null)) {
		throw new Error("The live entity does not expose the expected health SendProp.");
	}

	const nHealthByPropertyName = GetEntityPropertyInteger(PlayerEntity, HealthProperty.Path);
	const nHealthByRecord = GetEntityPropertyInteger(PlayerEntity, HealthProperty);
	const nHealthByPropertyOffset = GetEntityPropertyInteger(PlayerEntity, HealthProperty.Offset);
	if ((nHealthByPropertyName !== nHealthByRecord) || (nHealthByRecord !== nHealthByPropertyOffset)) {
		throw new Error("SendProp identifiers resolved different storage.");
	}

	LogInfo("ReportEntityPropertyIdentifiers Result=%j", { HealthByRecord: nHealthByRecord, PropertyPath: HealthProperty.Path, ServerClassName: EntityServerClass.Name, TableName: EntitySendTable.Name });
};

g_ReportEntityPropertyIdentifiers();
```

## Generic access

`GetEntityProperty(Entity, PropertyReference, strPropertyType = undefined)` and `SetEntityProperty(Entity, PropertyReference, Value, strPropertyType = undefined)` infer storage from `SendProp` metadata only when the property is resolved by name or path. Omitting `strPropertyType` or passing `undefined` or `null` requests inference:

- integer storage using a recognized standard engine send proxy: its actual signed or unsigned 8/16/32/64-bit native field; 8/16/32-bit fields return `number`, while 64-bit fields return exact `bigint` and require `bigint` on writes;
- `DPT_Float`: 32-bit float;
- `DPT_Vector` / `DPT_VectorXY`: live vector view;
- `DPT_String`: inline NUL-terminated string storage, read as a JavaScript string;
- `DPT_DataTable`: `GetEntityProperty()` returns the nested-storage address as `bigint`, while `SetEntityProperty()` throws because a data table has no unambiguous scalar write;
- other resolved metadata without a recognized standard integer proxy, including a custom/unknown integer proxy or an unavailable standard-proxy table: inference throws; supply an explicit canonical type for known native storage instead of treating every field as a 32-bit integer;
- numeric offset or object containing `Offset`: signed 32-bit integer because no metadata is retained.

Native integer width and signedness come from the engine's `GetStandardSendProxies()` table, not a local SDK copy, network bit count or `SPROP_UNSIGNED`. An SDK without standard 64-bit proxies cannot infer those fields; explicit `longlong`/`ulonglong` access remains available. Integer inference uses the already resolved field address once, so choosing its codec does not evaluate entity/property selectors again.

Inferred metadata integers validate their complete width and copy bytes without requiring aligned typed access. The metadata-free integer getter retains its native `int` alignment requirement; inferred float reads require float alignment. Writes validate their complete width and copy bytes. Explicit typed access retains its own contract. Native C++ exceptions during type selection or access become JavaScript errors; field-range checks do not establish allocation extent or liveness.

Pass one canonical type name when metadata does not describe the actual storage:

`bool`, `char`, `uchar`, `short`, `ushort`, `int`, `uint`, `long`, `ulong`, `longlong`, `ulonglong`, `float`, `double`, `stringaddress`, `stringarray`, `address`, `vector`, `vectorxy`, or `entity`.

Only the listed canonical type names are accepted.

Reads using explicit `"address"` type and inferred `DPT_DataTable` reads return addresses as `bigint`.

An explicit `"vectorxy"` type exposes only `Address` (a `bigint`), `X`, and `Y`, and writes only the first two float components, including when `PropertyReference` is a raw numeric offset. Vector setters use the shared vector parser: an array supplies indices `0` through `2`, while an object supplies `X`, `Y`, and `Z` (with `Pitch`, `Yaw`, and `Roll` as the respective fallback keys). At least one component is required; omitted components become zero.

```js
const { Entity } = require("entities/entity");
const {
	GetEntityProperty,
	GetEntitySendProperty,
	SetEntityProperty,
} = require("entities/props");

const g_VerifyGenericEntityPropertyAccess = function VerifyGenericEntityPropertyAccess() {
	const strHealthPropertyName = "m_iHealth";
	const nPrimaryTemporaryHealth = 1;
	const nSecondaryTemporaryHealth = 2;
	const nPlayerEntityIndex = 1;
	const PlayerEntity = Entity(nPlayerEntityIndex);
	if (PlayerEntity === null) {
		throw new Error(`Entity index ${nPlayerEntityIndex} is not live.`);
	}

	const HealthProperty = GetEntitySendProperty(PlayerEntity, strHealthPropertyName);
	if (HealthProperty === null) {
		throw new Error("The live entity has no m_iHealth SendProp.");
	}

	const nPreviousHealth = GetEntityProperty(PlayerEntity, HealthProperty, "int");
	const nTemporaryHealth = (nPreviousHealth === nPrimaryTemporaryHealth) ? nSecondaryTemporaryHealth : nPrimaryTemporaryHealth;

	try {
		if (!SetEntityProperty(PlayerEntity, HealthProperty, nTemporaryHealth, "int")) {
			throw new Error("The temporary health write failed.");
		}

		if (GetEntityProperty(PlayerEntity, HealthProperty, "int") !== nTemporaryHealth) {
			throw new Error("The temporary health value was not written to live entity memory.");
		}
	} finally {
		if (!SetEntityProperty(PlayerEntity, HealthProperty, nPreviousHealth, "int")) {
			throw new Error("The original health value could not be restored.");
		}
	}
};

g_VerifyGenericEntityPropertyAccess();
```

## Typed access

Typed functions do not compare the chosen C++ width with `SendProp.TypeID`. They intentionally expose raw entity storage. Resolve a property, confirm the SDK layout, then call the matching pair.

| Explicit type | Read / write | Getter result and setter input |
| --- | --- | --- |
| `bool` | `GetEntityPropertyBoolean` / `SetEntityPropertyBoolean` | strict `boolean` |
| `char` | `GetEntityPropertyCharacter` / `SetEntityPropertyCharacter` | one-character string result, or `""` for a stored zero byte; setter accepts an exact-range integer `number` or uses the first byte of a string (`""` writes zero) |
| `uchar` | `GetEntityPropertyUnsignedCharacter` / `SetEntityPropertyUnsignedCharacter` | integer `number` result; setter accepts an exact-range non-negative `number` or `bigint` |
| `short` | `GetEntityPropertyShort` / `SetEntityPropertyShort` | integer `number` result; setter accepts an exact-range signed `number` or `bigint` |
| `ushort` | `GetEntityPropertyUnsignedShort` / `SetEntityPropertyUnsignedShort` | integer `number` result; setter accepts an exact-range non-negative `number` or `bigint` |
| `int` | `GetEntityPropertyInteger` / `SetEntityPropertyInteger` | integer `number` result; setter accepts an exact-range signed `number` or `bigint` |
| `uint` | `GetEntityPropertyUnsignedInteger` / `SetEntityPropertyUnsignedInteger` | non-negative integer `number` result; setter accepts an exact-range non-negative `number` or `bigint` |
| `long` | `GetEntityPropertyLong` / `SetEntityPropertyLong` | `number` result for 32-bit `long`, `bigint` for 64-bit `long`; setter accepts an exact-range `number` or `bigint` when 32-bit and requires an exact-range `bigint` when 64-bit |
| `ulong` | `GetEntityPropertyUnsignedLong` / `SetEntityPropertyUnsignedLong` | unsigned counterpart of `long`, including its width-dependent result; setter accepts an exact-range non-negative `number` or `bigint` when 32-bit and requires an exact-range non-negative `bigint` when 64-bit |
| `longlong` | `GetEntityPropertyLongLong` / `SetEntityPropertyLongLong` | `bigint` result; setter requires an exact-range `bigint` |
| `ulonglong` | `GetEntityPropertyUnsignedLongLong` / `SetEntityPropertyUnsignedLongLong` | non-negative `bigint` result; setter requires an exact-range non-negative `bigint` |
| `float` | `GetEntityPropertyFloat` / `SetEntityPropertyFloat` | `number` result; setter applies JavaScript numeric conversion, requires a finite in-range result, and stores it as a 32-bit float |
| `double` | `GetEntityPropertyDouble` / `SetEntityPropertyDouble` | `number` result; setter applies JavaScript numeric conversion and requires a finite result stored as a 64-bit float |
| `stringaddress` | `GetEntityPropertyStringAddress` / `SetEntityPropertyStringAddress` | getter returns the C string at the field's stored address, or `""` when that address is null; setter accepts a string and retains each copied value until module shutdown so the stored native address remains valid |
| `stringarray` | `GetEntityPropertyStringArray` / `SetEntityPropertyStringArray` | JavaScript string read from a NUL-terminated buffer; setter requires a string and copies at most `ArrayLength - 1` bytes when resolved metadata has a positive `ArrayLength`, or 255 bytes otherwise; copying stops at the first NUL and the remaining buffer is zero-padded, including the final terminator |
| `address` | `GetEntityPropertyAddress` / `SetEntityPropertyAddress` | `bigint` address result; setter requires a non-negative `bigint` within the native address range |
| `vector` | `GetEntityPropertyVector` / `SetEntityPropertyVector` | live `{ Address: bigint, X, Y }` result with `Z` unless resolved metadata identifies `DPT_VectorXY`; setter accepts the shared array or `X`/`Y`/`Z` object input described above |
| `entity` | `GetEntityPropertyEntity` / `SetEntityPropertyEntity` | live `Entity` or `null`; setter accepts a live entity, an entity-reference object with `Index` that resolves to a live edict, or a non-invalid packed 32-bit handle (directly or through `Handle`, `Value`, or `IntHandle`), which need not resolve to a live entity at write time; a numeric `uint32` is a handle, not an entity index |

The following helper is a practical way to centralize a reviewed layout without adding another SourceJS API surface. It references every typed pair and uses the `int` pair for a real health property:

The helper rejects non-finite original floating-point values before a temporary write, because the public setters cannot restore them. It snapshots vector components, raw entity-handle bits, string-address fields, and character bytes rather than retaining live wrappers or round-tripping those representations through strings. Inline string arrays are restored as string values, not byte-for-byte backups of padding or invalid UTF-8. The callback must remain synchronous and must not invalidate the target or borrowed storage; restoration can itself fail and does not make this a transaction.

```js
const { Entity } = require("entities/entity");
const {
	GetEntityPropertyBoolean,
	GetEntityPropertyCharacter,
	GetEntityPropertyDouble,
	GetEntityPropertyEntity,
	GetEntityPropertyFloat,
	GetEntityPropertyInteger,
	GetEntityPropertyLong,
	GetEntityPropertyLongLong,
	GetEntityPropertyAddress,
	GetEntityPropertyShort,
	GetEntityPropertyStringArray,
	GetEntityPropertyStringAddress,
	GetEntityPropertyUnsignedCharacter,
	GetEntityPropertyUnsignedInteger,
	GetEntityPropertyUnsignedLong,
	GetEntityPropertyUnsignedLongLong,
	GetEntityPropertyUnsignedShort,
	GetEntityPropertyVector,
	GetEntitySendProperty,
	SetEntityPropertyBoolean,
	SetEntityPropertyCharacter,
	SetEntityPropertyDouble,
	SetEntityPropertyEntity,
	SetEntityPropertyFloat,
	SetEntityPropertyInteger,
	SetEntityPropertyLong,
	SetEntityPropertyLongLong,
	SetEntityPropertyAddress,
	SetEntityPropertyShort,
	SetEntityPropertyStringArray,
	SetEntityPropertyStringAddress,
	SetEntityPropertyUnsignedCharacter,
	SetEntityPropertyUnsignedInteger,
	SetEntityPropertyUnsignedLong,
	SetEntityPropertyUnsignedLongLong,
	SetEntityPropertyUnsignedShort,
	SetEntityPropertyVector,
} = require("entities/props");

const g_EntityPropertyAccessors = Object.freeze({
	bool: [GetEntityPropertyBoolean, SetEntityPropertyBoolean],
	char: [GetEntityPropertyCharacter, SetEntityPropertyCharacter],
	uchar: [GetEntityPropertyUnsignedCharacter, SetEntityPropertyUnsignedCharacter],
	short: [GetEntityPropertyShort, SetEntityPropertyShort],
	ushort: [GetEntityPropertyUnsignedShort, SetEntityPropertyUnsignedShort],
	int: [GetEntityPropertyInteger, SetEntityPropertyInteger],
	uint: [GetEntityPropertyUnsignedInteger, SetEntityPropertyUnsignedInteger],
	long: [GetEntityPropertyLong, SetEntityPropertyLong],
	ulong: [GetEntityPropertyUnsignedLong, SetEntityPropertyUnsignedLong],
	longlong: [GetEntityPropertyLongLong, SetEntityPropertyLongLong],
	ulonglong: [GetEntityPropertyUnsignedLongLong, SetEntityPropertyUnsignedLongLong],
	float: [GetEntityPropertyFloat, SetEntityPropertyFloat],
	double: [GetEntityPropertyDouble, SetEntityPropertyDouble],
	stringaddress: [GetEntityPropertyStringAddress, SetEntityPropertyStringAddress],
	stringarray: [GetEntityPropertyStringArray, SetEntityPropertyStringArray],
	address: [GetEntityPropertyAddress, SetEntityPropertyAddress],
	vector: [GetEntityPropertyVector, SetEntityPropertyVector],
	entity: [GetEntityPropertyEntity, SetEntityPropertyEntity],
});

const g_CopyEntityPropertyValue = function CopyEntityPropertyValue(strPropertyStorageType, EntityPropertyValue) {
	if (((strPropertyStorageType === "float") || (strPropertyStorageType === "double")) && !Number.isFinite(EntityPropertyValue)) {
		throw new RangeError("Temporary property access cannot restore a non-finite floating-point value.");
	}

	if (strPropertyStorageType === "vector") {
		const vecComponents = ("Z" in EntityPropertyValue) ? [EntityPropertyValue.X, EntityPropertyValue.Y, EntityPropertyValue.Z] : [EntityPropertyValue.X, EntityPropertyValue.Y];
		if (!vecComponents.every(Number.isFinite)) {
			throw new RangeError("Temporary property access cannot restore non-finite vector components.");
		}

		return vecComponents;
	}

	return EntityPropertyValue;
};

const g_WithTemporaryEntityProperty = function WithTemporaryEntityProperty(EntityReference, EntityPropertyReference, strPropertyStorageType, TemporaryEntityPropertyValue, Callback) {
	if ((EntityReference === null) || (typeof EntityReference !== "object") || !EntityReference.Valid || (typeof Callback !== "function")) {
		throw new TypeError("Temporary property access requires a live Entity and a synchronous callback.");
	}

	const nEntityHandleValue = EntityReference.HandleValue;
	const nEntityNetworkSerialNumber = EntityReference.NetworkSerialNumber;
	if (!Number.isInteger(nEntityHandleValue) || !Number.isInteger(nEntityNetworkSerialNumber)) {
		throw new TypeError("The live Entity must expose its handle and network serial number.");
	}

	if ((typeof strPropertyStorageType !== "string") || !Object.hasOwn(g_EntityPropertyAccessors, strPropertyStorageType)) {
		throw new TypeError("Unknown property storage type; use a canonical storage-type string.");
	}

	const vecEntityPropertyAccessors = g_EntityPropertyAccessors[strPropertyStorageType];
	const [ReadEntityProperty, WriteEntityProperty] = vecEntityPropertyAccessors;
	let ReadPreviousEntityProperty = ReadEntityProperty;
	let RestoreEntityProperty = WriteEntityProperty;

	if (strPropertyStorageType === "entity") {
		ReadPreviousEntityProperty = GetEntityPropertyUnsignedInteger;
		RestoreEntityProperty = SetEntityPropertyUnsignedInteger;

	} else if (strPropertyStorageType === "stringaddress") {
		ReadPreviousEntityProperty = GetEntityPropertyAddress;
		RestoreEntityProperty = SetEntityPropertyAddress;

	} else if (strPropertyStorageType === "char") {
		ReadPreviousEntityProperty = GetEntityPropertyUnsignedCharacter;
		RestoreEntityProperty = SetEntityPropertyUnsignedCharacter;
	}

	const CurrentEntityPropertyValue = ReadPreviousEntityProperty(EntityReference, EntityPropertyReference);
	const PreviousEntityPropertyValue = g_CopyEntityPropertyValue(strPropertyStorageType, CurrentEntityPropertyValue);

	try {
		if (!WriteEntityProperty(EntityReference, EntityPropertyReference, TemporaryEntityPropertyValue)) {
			throw new Error(`Unable to write temporary ${strPropertyStorageType} property value.`);
		}

		return Callback(ReadEntityProperty(EntityReference, EntityPropertyReference));
	} finally {
		if (EntityReference.Valid && (EntityReference.HandleValue === nEntityHandleValue) && (EntityReference.NetworkSerialNumber === nEntityNetworkSerialNumber)) {
			if (!RestoreEntityProperty(EntityReference, EntityPropertyReference, PreviousEntityPropertyValue)) {
				throw new Error(`Unable to restore ${strPropertyStorageType} property value.`);
			}
		}
	}
};

const g_VerifyTemporaryHealthProperty = function VerifyTemporaryHealthProperty() {
	const strHealthPropertyName = "m_iHealth";
	const nPrimaryTemporaryHealth = 1;
	const nSecondaryTemporaryHealth = 2;
	const nPlayerEntityIndex = 1;
	const Player = Entity(nPlayerEntityIndex);
	if (Player === null) {
		throw new Error(`Entity index ${nPlayerEntityIndex} is not live.`);
	}

	const HealthProperty = GetEntitySendProperty(Player, strHealthPropertyName);
	if (HealthProperty === null) {
		throw new Error("The live entity has no m_iHealth SendProp.");
	}

	const nCurrentHealth = GetEntityPropertyInteger(Player, HealthProperty);
	const nTemporaryHealth = (nCurrentHealth === nPrimaryTemporaryHealth) ? nSecondaryTemporaryHealth : nPrimaryTemporaryHealth;

	const VerifyTemporaryHealth = function VerifyTemporaryHealth(nHealth) {
		if (nHealth !== nTemporaryHealth) {
			throw new Error("The typed health write was not visible in live memory.");
		}
	};

	g_WithTemporaryEntityProperty(Player, HealthProperty, "int", nTemporaryHealth, VerifyTemporaryHealth);
};

g_VerifyTemporaryHealthProperty();
```

`g_EntityPropertyAccessors` is a plugin-owned dispatch table, not an alternate SourceJS API. `g_WithTemporaryEntityProperty()` requires a live `Entity` object, saves its `HandleValue` and `NetworkSerialNumber`, and invokes its callback synchronously. It restores the saved value on return or exception only while the entity is still valid and both saved identity fields match. The helper copies finite vector components and selects raw unsigned-integer, address, or unsigned-character access for restoring entity handles, string addresses, or character bytes. A `stringaddress` temporary write still retains a new string, but restoration reinstalls the original native address, including `0n`. If the callback removes or replaces the entity, restoration is skipped rather than writing into a replacement. This check is not a permanent lifetime pin or an unlimited-generation identity guarantee; do not pass an asynchronous callback or retain borrowed values beyond the call. The helper is demonstrated only with `int`; use another pair only after reviewing that type's range, ownership, lifetime, and round-trip constraints for the active SDK.

An ordinary `GetEntityPropertyEntity()` result can be `null` or a live wrapper that later resolves to a different owner. The helper therefore snapshots and restores the field through the unsigned-integer pair, preserving all original packed bits even when the ordinary getter would return `null`; this deliberately differs from the typed entity setter's non-invalid-handle requirement. The explicit handle workflow below shows direct restoration of a previously resolvable, non-invalid handle. If restoration itself fails, its error takes precedence over a callback result or exception because it is thrown from `finally`.

## Live vectors

`GetEntityPropertyVector()` returns a native-memory view. Reading or assigning `X`, `Y`, and `Z` accesses entity memory immediately. When a name or path resolves to `DPT_VectorXY`, the view exposes only `X` and `Y`. A `SendProp` record is consumed as a direct `Offset`, so the typed getter cannot infer `VectorXY` from that record and assumes three components; pass the record's `Path` instead, or use generic access with the explicit `"vectorxy"` type. The `Address` field is a `bigint` identifying the first float. The view does not install lower-camel component or address aliases.

`SetEntityPropertyVector()` accepts the shared vector input described above: array indices `0` through `2`, or object fields `X`, `Y`, and `Z` with `Pitch`, `Yaw`, and `Roll` fallbacks. Only a name/path-resolved `DPT_VectorXY` limits the typed setter to two components; record and numeric-offset forms require generic access with the explicit `"vectorxy"` type to avoid a three-float write.

Vector views check native float alignment and address-range overflow for all exposed components before installing accessors. Writes validate the complete two- or three-component range and required native alignment before copying component bytes; failed validation commits no component bytes from that setter. Selector getters and component conversions can execute JavaScript first, and their side effects are not rolled back. `Address` is an own property, so an inherited setter is not invoked while creating the view. Components remain borrowed: these checks do not prove ownership, allocation extent, or entity liveness.

```js
const { Entity } = require("entities/entity");
const {
	GetEntityPropertyVector,
	GetEntitySendProperty,
	SetEntityPropertyVector,
} = require("entities/props");
const { LogInfo } = require("loggers");

const g_VerifyLiveVectorAccess = function VerifyLiveVectorAccess() {
	const nEntityIndex = 1;
	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const OriginProperty = GetEntitySendProperty(EntityValue, "m_vecOrigin");
	if ((OriginProperty === null) || (OriginProperty.Type !== "vector")) {
		throw new Error("The live entity has no three-component m_vecOrigin SendProp.");
	}

	const Origin = GetEntityPropertyVector(EntityValue, OriginProperty);
	const flPreviousOriginZ = Origin.Z;
	const vecPreviousOrigin = [Origin.X, Origin.Y, flPreviousOriginZ];
	if (!vecPreviousOrigin.every(Number.isFinite)) {
		throw new RangeError("The original entity origin must be finite before a temporary write.");
	}

	const flTemporaryOriginDelta = 8;
	const flTemporaryOriginZ = Math.fround(flPreviousOriginZ + flTemporaryOriginDelta);

	try {
		Origin.Z = flTemporaryOriginZ;

		if (GetEntityPropertyVector(EntityValue, OriginProperty).Z !== flTemporaryOriginZ) {
			throw new Error("The live vector view did not update entity memory.");
		}
	} finally {
		if (!SetEntityPropertyVector(EntityValue, OriginProperty, vecPreviousOrigin)) {
			throw new Error("The original entity origin could not be restored.");
		}
	}

	LogInfo("VerifyLiveVectorAccess Address=0x%s Result=%j", Origin.Address.toString(16).toUpperCase(), { X: Origin.X, Y: Origin.Y, Z: Origin.Z });
};

g_VerifyLiveVectorAccess();
```

Do not keep a vector view after the entity is removed or the same index is reused.

## Entity handles

Entity-valued properties store `CBaseHandle`, not a raw entity address.

- `GetEntityPropertyEntity()` returns the current live Entity when the serial-aware handle resolves.
- An invalid handle or a handle that no longer resolves to a live entity with the same serial returns `null`. Raw `0` is not a universal null-handle sentinel; do not substitute it for the SDK's invalid handle representation.
- `SetEntityPropertyEntity()` accepts a live `Entity` object or an entity-reference object with `Index` that resolves to a live edict.
- A numeric `uint32` or a handle object containing `Handle`, `Value`, or `IntHandle` is interpreted as a packed `CBaseHandle`; it is checked only for the non-invalid handle state and need not resolve to a live entity at write time.
- Never pass a plain entity index as that packed handle, and never write an index with `SetEntityPropertyInteger()`; either form loses the required serial number.

The JavaScript packed handle stays a `uint32`. The native field uses the selected SDK's `CBaseHandle` storage width: some Linux x64 SDKs store the handle in a 64-bit `unsigned long`. Reads check and copy the complete native field without requiring aligned typed access; writes also require native `CBaseHandle` alignment and validate the entire field before committing. Getter-thrown errors during handle/reference selection retain their original JavaScript identity and do not fall through to another selector. After reading handle/reference properties, the setter rechecks the destination entity's serial and base address before writing; a recycled destination is rejected without committing field bytes. Native C++ exceptions become JavaScript errors; invalid-memory faults are not caught.

```js
const { GetAllEntities } = require("entities");
const {
	GetEntityPropertyEntity,
	GetEntityPropertyUnsignedInteger,
	GetEntitySendProperty,
	SetEntityPropertyEntity,
} = require("entities/props");

const g_VerifyEntityHandleAccess = function VerifyEntityHandleAccess() {
	const strOwnerPropertyName = "m_hOwnerEntity";
	const vecLiveEntities = GetAllEntities();
	let OwnedEntity = null;
	let OwnerProperty = null;
	let PreviousOwnerEntity = null;
	for (const CandidateEntity of vecLiveEntities) {
		const CandidateOwnerProperty = GetEntitySendProperty(CandidateEntity, strOwnerPropertyName);
		if (CandidateOwnerProperty === null) {
			continue;
		}

		const CandidateOwnerEntity = GetEntityPropertyEntity(CandidateEntity, CandidateOwnerProperty);
		if (CandidateOwnerEntity !== null) {
			OwnedEntity = CandidateEntity;
			OwnerProperty = CandidateOwnerProperty;
			PreviousOwnerEntity = CandidateOwnerEntity;
			break;
		}
	}

	if ((OwnedEntity === null) || (OwnerProperty === null) || (PreviousOwnerEntity === null)) {
		throw new Error("No live entity currently has a resolvable m_hOwnerEntity handle.");
	}

	const VerifyReplacementOwnerEntity = function VerifyReplacementOwnerEntity(EntityValue) {
		return (EntityValue.Index !== OwnedEntity.Index) && (EntityValue.Index !== PreviousOwnerEntity.Index);
	};

	const ReplacementOwnerEntity = vecLiveEntities.find(VerifyReplacementOwnerEntity);
	if (ReplacementOwnerEntity === undefined) {
		throw new Error("No distinct live entity is available for the handle write example.");
	}

	const nOwnedEntityHandleValue = OwnedEntity.HandleValue;
	const nOwnedEntityNetworkSerialNumber = OwnedEntity.NetworkSerialNumber;
	const unPreviousOwnerHandle = GetEntityPropertyUnsignedInteger(OwnedEntity, OwnerProperty);

	try {
		if (!SetEntityPropertyEntity(OwnedEntity, OwnerProperty, ReplacementOwnerEntity)) {
			throw new Error("The temporary owner handle write failed.");
		}

		const CurrentOwnerEntity = GetEntityPropertyEntity(OwnedEntity, OwnerProperty);
		if ((CurrentOwnerEntity === null) || (CurrentOwnerEntity.Index !== ReplacementOwnerEntity.Index)) {
			throw new Error("The temporary owner handle did not resolve to the replacement entity.");
		}
	} finally {
		if (OwnedEntity.Valid && (OwnedEntity.HandleValue === nOwnedEntityHandleValue) && (OwnedEntity.NetworkSerialNumber === nOwnedEntityNetworkSerialNumber)) {
			if (!SetEntityPropertyEntity(OwnedEntity, OwnerProperty, unPreviousOwnerHandle)) {
				throw new Error("The original owner handle could not be restored.");
			}
		}
	}
};

g_VerifyEntityHandleAccess();
```

The example snapshots the original packed 32-bit owner handle with `GetEntityPropertyUnsignedInteger()` before writing. Restoring that number preserves the original index and serial even if the previous owner's wrapper later resolves to a replacement or the old owner is removed; a stale restored handle subsequently reads as `null`. Restoration is skipped if the entity containing the property is no longer valid or its saved `HandleValue` or `NetworkSerialNumber` differs. These finite-generation checks are not permanent lifetime pins. A plugin that needs to represent a null handle should use a reviewed native/gamedata path rather than inventing an index value.

## Strings and addresses

The two string families represent different C++ layouts:

- `stringarray` reads/writes an inline null-terminated `char[]`. The getter's borrowed C-string contract requires valid terminated native storage: selectors supply no read capacity, and address arithmetic cannot prove termination or allocation extent. When the property is resolved by name or path, the setter uses the reflected `SendProp.ArrayLength` as its bound. A `SendProp` record, minimal offset object, or raw numeric offset is consumed as a direct offset and instead uses the fallback 256-byte bound, which is safe only when your reviewed layout actually provides that storage. The setter checks address-range overflow for the entire bound before copying, preserving truncation, zero padding, and final termination.
- `stringaddress` reads/writes a `char const*`. Each setter call appends assigned text to game-thread-confined, lazily initialized module-lifetime SourceJS storage so the new address stays valid; repeated writes retain every appended string, and the target field must genuinely be an address field. Both accessors check address-range overflow and copy the address bytes without requiring aligned typed access; a stored null address reads as an empty string. Native allocation failures become JavaScript errors without committing a field write. Clear borrowed native references before module shutdown.

Both string getters assume a readable null-terminated sequence at the resolved location; `stringaddress` additionally trusts the stored address value. Neither getter validates the readable range or terminator.

`address` reads/writes a native `void*` field as JavaScript `bigint`. The getter preserves the full native address. A setter value must be a non-negative `bigint` no greater than the selected platform's `uintptr_t` maximum; numbers, strings, and objects are rejected.

```js
const {
	GetEntityPropertyAddress,
	GetEntityPropertyStringArray,
	GetEntityPropertyStringAddress,
	SetEntityPropertyAddress,
	SetEntityPropertyStringArray,
	SetEntityPropertyStringAddress,
} = require("entities/props");

const g_InspectReviewedNativeFields = function InspectReviewedNativeFields(EntityValue, NativeFieldLayout) {
	return { UserDataAddress: GetEntityPropertyAddress(EntityValue, NativeFieldLayout.UserDataAddressProperty), BufferText: GetEntityPropertyStringArray(EntityValue, NativeFieldLayout.BufferProperty), AddressText: GetEntityPropertyStringAddress(EntityValue, NativeFieldLayout.TextAddressProperty) };
};

const g_UpdateReviewedNativeFields = function UpdateReviewedNativeFields(EntityValue, NativeFieldLayout, NativeFieldValues) {
	const BufferProperty = NativeFieldLayout.BufferProperty;
	const TextAddressProperty = NativeFieldLayout.TextAddressProperty;
	const UserDataAddressProperty = NativeFieldLayout.UserDataAddressProperty;
	if (!SetEntityPropertyStringArray(EntityValue, BufferProperty, NativeFieldValues.BufferText)) {
		throw new Error("The inline string write failed.");
	}

	if (!SetEntityPropertyStringAddress(EntityValue, TextAddressProperty, NativeFieldValues.AddressText)) {
		throw new Error("The string-address write failed.");
	}

	if (!SetEntityPropertyAddress(EntityValue, UserDataAddressProperty, NativeFieldValues.UserDataAddress)) {
		throw new Error("The native address write failed.");
	}
};

module.exports = { InspectReviewedNativeFields: g_InspectReviewedNativeFields, UpdateReviewedNativeFields: g_UpdateReviewedNativeFields };
```

This pattern is intended for an extension or gamedata profile that supplies exact offsets. `NativeFieldValues.UserDataAddress` must be a non-negative `bigint` within the native address range. If `BufferProperty` is a direct offset form, the reviewed field must provide at least the 256-byte fallback capacity; prefer a name/path for a reflected `SendProp` so the native setter can use its real bound. Do not guess offsets from another SDK branch. The three writes are sequential, not transactional: a later failure leaves earlier fields changed. Call these helpers only while the entity and reviewed storage remain live, and manage restoration according to each field's ownership contract.

## Variants

`CreateEntityPropertyVariant()`, `CreateEntityPropertyVariant(strType)`, and `CreateEntityPropertyVariant(strType, Value)` create a plain JavaScript descriptor for code that needs to carry a property storage type and value together. An omitted type defaults to `"int"`, and an omitted value defaults to `null`. An explicitly supplied type must be a non-empty canonical string, so `undefined` or `null` in the first argument is not treated as omission; an explicitly supplied `undefined` value is stored unchanged. The descriptor does not allocate or point to a native `DVariant`. `Type` and `Value` are own properties; descriptor creation does not invoke inherited setters.

The type must be one of the canonical names accepted by `GetEntityProperty()` and `SetEntityProperty()`. The returned record exposes only `Type` and `Value`; the value is stored unchanged and is not checked against the selected type.

```js
const { CreateEntityPropertyVariant } = require("entities/props");
const { LogInfo } = require("loggers");

const g_VerifyEntityPropertyVariants = function VerifyEntityPropertyVariants() {
	const nHealthValue = 100;
	const DestinationValue = { X: 256, Y: -32, Z: 64 };
	const HealthVariant = CreateEntityPropertyVariant("int", nHealthValue);
	const DestinationVariant = CreateEntityPropertyVariant("vector", DestinationValue);
	const EmptyVariant = CreateEntityPropertyVariant();
	if ((HealthVariant.Type !== "int") || (HealthVariant.Value !== nHealthValue)) {
		throw new Error("CreateEntityPropertyVariant() returned unexpected health fields.");
	}

	if ((DestinationVariant.Type !== "vector") || (DestinationVariant.Value !== DestinationValue)) {
		throw new Error("CreateEntityPropertyVariant() returned unexpected vector fields.");
	}

	if ((EmptyVariant.Type !== "int") || (EmptyVariant.Value !== null)) {
		throw new Error("CreateEntityPropertyVariant() returned unexpected default fields.");
	}

	LogInfo("VerifyEntityPropertyVariants Result=%j", { DestinationVariant, EmptyVariant, HealthVariant });
};

g_VerifyEntityPropertyVariants();
```

For Source input `variant_t` values, use the native datamap API described in [entities/datamaps](entities-datamaps.md). The two representations have different ownership.

## Send property constants

### `SendPropType`

| Member | SDK value |
| --- | --- |
| `INT` | `DPT_Int` |
| `FLOAT` | `DPT_Float` |
| `VECTOR` | `DPT_Vector` |
| `VECTOR_XY` | `DPT_VectorXY`; omitted where unavailable |
| `STRING` | `DPT_String` |
| `ARRAY` | `DPT_Array` |
| `DATA_TABLE` | `DPT_DataTable` |

### `SendPropFlags` and `SPROP_*`

| Member | Standalone constant | HL2SDK meaning |
| --- | --- | --- |
| `UNSIGNED` | `SPROP_UNSIGNED` | Integer data is encoded as unsigned. |
| `COORD` | `SPROP_COORD` | Float/vector data uses world-coordinate encoding; the bit count is ignored. |
| `NO_SCALE` | `SPROP_NOSCALE` | Floating-point data is encoded without scaling into a range. |
| `ROUND_DOWN` | `SPROP_ROUNDDOWN` | Floating-point high bound is reduced by one quantization unit. |
| `ROUND_UP` | `SPROP_ROUNDUP` | Floating-point low bound is adjusted by one quantization unit. |
| `NORMAL` | `SPROP_NORMAL` | Vector data is treated as a normal; see the SDK-specific bit-reuse caveat below. |
| `EXCLUDE` | `SPROP_EXCLUDE` | Exclusion descriptor that identifies another property to exclude. |
| `XYZE` | `SPROP_XYZE` | Vector data uses XYZ/exponent encoding. |
| `INSIDE_ARRAY` | `SPROP_INSIDEARRAY` | Array element descriptor omitted from the engine's flattened network property list and referenced by its array. |
| `PROXY_ALWAYS_YES` | `SPROP_PROXY_ALWAYS_YES` | Default data-table proxy always sends data to all clients. |
| `IS_VECTOR_ELEMENT` | `SPROP_IS_A_VECTOR_ELEM` | Automatically set for a vector-element send property. |
| `COLLAPSIBLE` | `SPROP_COLLAPSIBLE` | Zero-offset data table with a stable pointer that can be collapsed during traversal. |
| `COORD_MP` | `SPROP_COORD_MP` | Coordinate encoding with multiplayer-specific handling. |
| `COORD_MP_LOW_PRECISION` | `SPROP_COORD_MP_LOWPRECISION` | Multiplayer coordinate encoding with three fractional bits instead of five. |
| `COORD_MP_INTEGRAL` | `SPROP_COORD_MP_INTEGRAL` | Multiplayer coordinate encoding rounded to integral boundaries. |
| `CHANGES_OFTEN` | `SPROP_CHANGES_OFTEN` | Marks a frequently changed field so it is moved earlier in the send table and gets a smaller index. |

These flags describe engine send/encoding behavior. `GetServerClassProperties()` walks stored `SendTable` entries, not the engine's flattened network list; it does not filter out an entry merely because `INSIDE_ARRAY` or `EXCLUDE` is set. Bit positions differ between SDKs, and TF2's `SPROP_VARINT` reuses `SPROP_NORMAL` rather than receiving a separate module export. Interpret a flag with the property's `TypeID` and the selected SDK, not its bit value alone.

```js
const {
	SendPropFlags,
	SendPropType,
	SPROP_CHANGES_OFTEN,
	SPROP_COLLAPSIBLE,
	SPROP_COORD,
	SPROP_COORD_MP,
	SPROP_COORD_MP_INTEGRAL,
	SPROP_COORD_MP_LOWPRECISION,
	SPROP_EXCLUDE,
	SPROP_INSIDEARRAY,
	SPROP_IS_A_VECTOR_ELEM,
	SPROP_NORMAL,
	SPROP_NOSCALE,
	SPROP_PROXY_ALWAYS_YES,
	SPROP_ROUNDDOWN,
	SPROP_ROUNDUP,
	SPROP_UNSIGNED,
	SPROP_XYZE,
} = require("entities/props");
const { LogInfo } = require("loggers");

const g_vecRequiredSendPropertyTypeMembers = Object.freeze(["INT", "FLOAT", "VECTOR", "STRING", "ARRAY", "DATA_TABLE"]);

const g_vecSendPropertyFlagExports = Object.freeze([
	["UNSIGNED", SPROP_UNSIGNED],
	["COORD", SPROP_COORD],
	["NO_SCALE", SPROP_NOSCALE],
	["ROUND_DOWN", SPROP_ROUNDDOWN],
	["ROUND_UP", SPROP_ROUNDUP],
	["NORMAL", SPROP_NORMAL],
	["EXCLUDE", SPROP_EXCLUDE],
	["XYZE", SPROP_XYZE],
	["INSIDE_ARRAY", SPROP_INSIDEARRAY],
	["PROXY_ALWAYS_YES", SPROP_PROXY_ALWAYS_YES],
	["IS_VECTOR_ELEMENT", SPROP_IS_A_VECTOR_ELEM],
	["COLLAPSIBLE", SPROP_COLLAPSIBLE],
	["COORD_MP", SPROP_COORD_MP],
	["COORD_MP_LOW_PRECISION", SPROP_COORD_MP_LOWPRECISION],
	["COORD_MP_INTEGRAL", SPROP_COORD_MP_INTEGRAL],
	["CHANGES_OFTEN", SPROP_CHANGES_OFTEN],
]);

const g_VerifySendPropertyConstants = function VerifySendPropertyConstants() {
	for (const strTypeMember of g_vecRequiredSendPropertyTypeMembers) {
		if (!Object.hasOwn(SendPropType, strTypeMember)) {
			throw new Error(`Missing send-property type member: ${strTypeMember}.`);
		}
	}

	for (const [strFlagMember, unStandaloneFlagValue] of g_vecSendPropertyFlagExports) {
		if (SendPropFlags[strFlagMember] !== unStandaloneFlagValue) {
			throw new Error(`Mismatched send-property flag: ${strFlagMember}.`);
		}
	}

	LogInfo("VerifySendPropertyConstants Result=%j", { SendPropertyTypeMembers: Object.keys(SendPropType) });
};

g_VerifySendPropertyConstants();
```

Use bitwise tests on `SendProp.Flags`:

```js
const { GetEntitySendProperty, SendPropFlags } = require("entities/props");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_InspectHealthSendProperty = function InspectHealthSendProperty() {
	const strHealthPropertyName = "m_iHealth";
	const nEntityIndex = 1;
	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const HealthProperty = GetEntitySendProperty(EntityValue, strHealthPropertyName);
	if (HealthProperty === null) {
		throw new Error("The live entity has no m_iHealth SendProp.");
	}

	const bHealthIsUnsigned = (HealthProperty.Flags & SendPropFlags.UNSIGNED) !== 0;
	const bHealthChangesOften = (HealthProperty.Flags & SendPropFlags.CHANGES_OFTEN) !== 0;
	LogInfo("InspectHealthSendProperty Result=%j", { HealthChangesOften: bHealthChangesOften, HealthIsUnsigned: bHealthIsUnsigned, PropertyPath: HealthProperty.Path, PropertyType: HealthProperty.Type });
};

g_InspectHealthSendProperty();
```

## Practical workflows

### Find every vector property on one entity

```js
const { Entity } = require("entities/entity");
const {
	GetEntitySendTable,
	GetServerClassProperties,
	SendPropType,
} = require("entities/props");
const { LogInfo } = require("loggers");

const g_FindEveryVectorPropertyOnOneEntity = function FindEveryVectorPropertyOnOneEntity() {
	const nEntityIndex = 1;
	const EntityValue = Entity(nEntityIndex);
	if (EntityValue === null) {
		throw new Error(`Entity index ${nEntityIndex} is not live.`);
	}

	const SendTable = GetEntitySendTable(EntityValue);
	if (SendTable === null) {
		throw new Error("The live entity has no reflected send table.");
	}

	const setVectorTypeIDs = new Set([SendPropType.VECTOR]);
	if (Object.hasOwn(SendPropType, "VECTOR_XY")) {
		setVectorTypeIDs.add(SendPropType.VECTOR_XY);
	}

	for (const Property of GetServerClassProperties(SendTable)) {
		if (setVectorTypeIDs.has(Property.TypeID)) {
			LogInfo("FindVectorProperty Address=0x%s Result=%j", Property.Address.toString(16).toUpperCase(), { PropertyPath: Property.Path, PropertyOffset: Property.Offset });
		}
	}
};

g_FindEveryVectorPropertyOnOneEntity();
```

### Apply and restore a movement multiplier

```js
const { Entity } = require("entities/entity");
const {
	GetEntityPropertyFloat,
	GetEntitySendProperty,
	SetEntityPropertyFloat,
} = require("entities/props");

const g_ApplyAndRestoreMovementMultiplier = function ApplyAndRestoreMovementMultiplier() {
	const strMovementPropertyName = "m_flLaggedMovementValue";
	const flNormalMovementMultiplier = 1;
	const flReducedMovementMultiplier = 0.75;
	const nPlayerEntityIndex = 1;
	const Player = Entity(nPlayerEntityIndex);
	if (Player === null) {
		throw new Error(`Entity index ${nPlayerEntityIndex} is not live.`);
	}

	const MovementProperty = GetEntitySendProperty(Player, strMovementPropertyName);
	if ((MovementProperty === null) || (MovementProperty.Type !== "float")) {
		throw new Error("The live entity has no float m_flLaggedMovementValue SendProp.");
	}

	const flPreviousMultiplier = GetEntityPropertyFloat(Player, MovementProperty);
	if (!Number.isFinite(flPreviousMultiplier)) {
		throw new RangeError("The original movement multiplier must be finite before a temporary write.");
	}

	const flTemporaryMultiplier = (flPreviousMultiplier === flReducedMovementMultiplier) ? flNormalMovementMultiplier : flReducedMovementMultiplier;

	try {
		if (!SetEntityPropertyFloat(Player, MovementProperty, flTemporaryMultiplier)) {
			throw new Error("The temporary movement multiplier write failed.");
		}

		if (GetEntityPropertyFloat(Player, MovementProperty) !== flTemporaryMultiplier) {
			throw new Error("The temporary movement multiplier was not written to live memory.");
		}
	} finally {
		if (!SetEntityPropertyFloat(Player, MovementProperty, flPreviousMultiplier)) {
			throw new Error("The original movement multiplier could not be restored.");
		}
	}
};

g_ApplyAndRestoreMovementMultiplier();
```

### Diagnose property differences between classes

```js
const {
	FindServerClassByName,
	GetServerClassProperties,
	GetServerClasses,
} = require("entities/props");
const { LogInfo } = require("loggers");

const g_DiagnosePropertyDifferencesBetweenClasses = function DiagnosePropertyDifferencesBetweenClasses() {
	const unMinimumComparableServerClassCount = 2;
	const unMaximumReportedPropertyPathCount = 20;

	const GetServerClassPropertyPath = function GetServerClassPropertyPath(ServerClassProperty) {
		return ServerClassProperty.Path;
	};

	const HasServerClassProperties = function HasServerClassProperties(ServerClass) {
		return GetServerClassProperties(ServerClass).length > 0;
	};

	const GetServerClassPropertyPaths = function GetServerClassPropertyPaths(strServerClassName) {
		const ServerClass = FindServerClassByName(strServerClassName);
		if (ServerClass === null) {
			throw new Error(`Server class disappeared during comparison: ${strServerClassName}.`);
		}

		return new Set(GetServerClassProperties(ServerClass).map(GetServerClassPropertyPath));
	};

	const vecComparableServerClasses = GetServerClasses().filter(HasServerClassProperties);
	if (vecComparableServerClasses.length < unMinimumComparableServerClassCount) {
		throw new Error(`The server exposes fewer than ${unMinimumComparableServerClassCount} classes with send properties.`);
	}

	const FirstServerClass = vecComparableServerClasses[0];
	const SecondServerClass = vecComparableServerClasses[1];
	const setFirstServerClassPropertyPaths = GetServerClassPropertyPaths(FirstServerClass.Name);
	const setSecondServerClassPropertyPaths = GetServerClassPropertyPaths(SecondServerClass.Name);
	const vecFirstServerClassOnlyPropertyPaths = [];
	for (const strPropertyPath of setFirstServerClassPropertyPaths) {
		if (!setSecondServerClassPropertyPaths.has(strPropertyPath)) {
			vecFirstServerClassOnlyPropertyPaths.push(strPropertyPath);
		}
	}

	LogInfo("DiagnosePropertyDifferencesBetweenClasses Result=%j", { FirstServerClassOnlyPropertyPaths: vecFirstServerClassOnlyPropertyPaths.slice(0, unMaximumReportedPropertyPathCount), FirstServerClassName: FirstServerClass.Name, SecondServerClassName: SecondServerClass.Name });
};

g_DiagnosePropertyDifferencesBetweenClasses();
```

## Errors and ownership

- Missing native send-property capability: `require("entities/props")` throws naturally.
- Missing `IServerGameDLL`: reflection operations that require that interface throw instead of returning fabricated empty metadata.
- Malformed names, property types, values, vectors, addresses, indexes, or argument counts: JavaScript exception raised by the native binding.
- Valid lookup with no match: `null`, `[]`, or `-1` as documented.
- Reflection addresses belong to the engine and must not be freed.
- Vector objects are borrowed live views and become invalid with their entity.
- String-address writes retain each assigned string until module shutdown to keep its address stable; use them only for genuine `char const*` fields.
- `SetEntityProperty*` writes engine memory immediately. SourceJS does not automatically replicate unrelated state, trigger game callbacks, or restore values when a plugin unloads.
- Raw offsets and width-specific accessors are selected-SDK ABI operations. Validate them again after game updates.

## Related modules

- [entities/classes](entities-classes.md): higher-level class collection and generators over the same reflection records.
- [entities/entity](entities-entity.md): focused Entity factory and decorated property methods.
- [entities/datamaps](entities-datamaps.md): non-networked fields, native `variant_t`, inputs, and outputs.
- [entities/helpers](entities-helpers.md): entity/edict/base-handle/address conversion matrix.
- [mathlib](mathlib.md): reusable live native vector and matrix types outside entity send-property storage.
- [memory/manager](memory-manager.md): reviewed declarative layouts for extension-owned native structures.
