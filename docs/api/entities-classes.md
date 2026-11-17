# `require("entities/classes")`

> Warning: this is a dense reflection API page. Use the table of contents to navigate directly to current entity classes, server classes, send tables, or sendprops.

The [`entities/classes` package](../../packages/sourcejs/entities/classes.js) extends the native module registered in [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) and combines two related engine views:

- the classes of entities that currently exist in the edict array; and
- `ServerClass`, `SendTable`, and `SendProp` reflection from the selected SDK when sendprops are available.

The first three operations are always installed with the entity runtime. Reflection exports are omitted as a group on SDKs that do not expose sendprops. SourceJS does not replace them with JavaScript stubs.

## Table of contents

- [Module contract](#module-contract)
- [Current entity classes](#current-entity-classes)
- [Server-class reflection](#server-class-reflection)
- [Reflection object fields](#reflection-object-fields)
- [Send tables and properties](#send-tables-and-properties)
- [Inheritance](#inheritance)
- [Generators](#generators)
- [SERVER_CLASSES collection](#server_classes-collection)
- [Using reflection with entities](#using-reflection-with-entities)
- [Lifecycle and common mistakes](#lifecycle-and-common-mistakes)
- [Export reference](#export-reference)

## Module contract

```js
const { GetEntitiesByClassName, GetEntityClassName, GetEntityClassNames, GetServerClasses } = require("entities/classes");
const { LogInfo } = require("loggers");

for (const [strOperationName, Operation] of [
	["GetEntitiesByClassName", GetEntitiesByClassName],
	["GetEntityClassName", GetEntityClassName],
	["GetEntityClassNames", GetEntityClassNames],
]) {
	if (typeof Operation !== "function") {
		throw new Error(`Missing mandatory entities/classes.${strOperationName}().`);
	}
}

const g_bReflectionAvailable = typeof GetServerClasses === "function";
LogInfo("%j", { Operation: "InspectEntityClassCapabilities", ReflectionAvailable: g_bReflectionAvailable });
```

When reflection is available, the module has these exact additional exports:

- `SERVER_CLASSES`
- `ServerClassCollection`
- `ServerClassGenerator`
- `GetServerClassBaseClassNames`
- `GetEntitySendProperty`
- `FindServerClassPropertyOffset`
- `FindServerClassByName`
- `FindServerClass`
- `GetServerClassProperty`
- `GetSendTable`
- `GetServerClassProperties`
- `GetServerClasses`
- `GetServerClassSendTable`
- `GetEntityServerClass`

Detect the owning capability once during plugin load when supporting SDKs with different surfaces. Calling an omitted member naturally raises a JavaScript `TypeError`. Native reflection callbacks are created as own exports without invoking inherited setters, and retain their runtime callback data.

## Current entity classes

### `GetEntityClassNames()`

Scans the current edict range and returns each non-empty entity class name once, in first-seen entity-index order. This is a current-world scan, not a registry of every class the game could create.

The returned array has own indexed data properties, so inherited numeric setters cannot intercept its entries.

### `GetEntitiesByClassName(strClassName)`

Returns native entity wrappers for current non-free edicts whose class name exactly matches `strClassName`, in entity-index order. Matching is case-sensitive. A missing, non-string, or empty name throws; this operation does not expose the scanner's internal all-entities mode. This low-level scan does not install the convenience methods exposed by `entities/entity`.

Its array entries are also own data properties. A wrapper creation failure aborts the result rather than returning a partially built collection.

Native `GetEntityClassNames()` and `GetEntitiesByClassName()` translate C++ exceptions into JavaScript errors without publishing partial arrays. Existing empty results, first-seen name order and exact class matching are unchanged. These guards do not pin entity lifetimes or guarantee allocator/OOM recovery.

Checked native array, string, or reflection-record construction can return `undefined` without a pending exception. Validate results before reading fields, destructuring, or iterating; this is distinct from a valid empty array, an empty class name, or a documented `null` lookup result. Existing exceptions propagate, and no partially constructed array is published.

### `GetEntityClassName(EntityValue)`

Accepts a primitive integral `Number` within the native `int` range, or an object whose `Index` meets that contract, and returns the current edict class name. Primitive strings, fractional/out-of-range numbers, and `bigint` addresses are not coerced to indexes. A missing/free edict or null native name produces an empty string; omitting the argument throws. All three operations require available entity globals.

If the input object's `Index` getter throws, the original exception is propagated before the native edict lookup is attempted.

```js
const { GetEntitiesByClassName, GetEntityClassName, GetEntityClassNames } = require("entities/classes");
const { LogInfo } = require("loggers");

const g_GetEntityIndex = function GetEntityIndex(Entity) {
	return Entity.Index;
};

const g_vecCurrentClassNames = GetEntityClassNames();
if (!Array.isArray(g_vecCurrentClassNames)) {
	throw new Error("GetEntityClassNames() did not return an array.");
}

const g_vecDynamicEntities = GetEntitiesByClassName("prop_dynamic");
if (!Array.isArray(g_vecDynamicEntities)) {
	throw new Error("GetEntitiesByClassName() did not return an array.");
}

for (const Entity of g_vecDynamicEntities) {
	const strClassName = GetEntityClassName(Entity);
	if (typeof strClassName !== "string") {
		throw new Error("GetEntityClassName() did not return a class name.");
	}

	if (strClassName !== "prop_dynamic") {
		throw new Error(`Entity ${Entity.Index} changed class during the scan.`);
	}
}

LogInfo("%j", { Operation: "ScanEntityClasses", Names: g_vecCurrentClassNames, EntityIndexes: g_vecDynamicEntities.map(g_GetEntityIndex) });
```

Resolve a fresh object after entity removal. Do not retain one result and assume the same index still refers to the same entity later.

## Server-class reflection

### `GetServerClasses()`

Walks `IServerGameDLL::GetAllServerClasses()` in linked-list order and returns an array of native-origin `ServerClass` records for the selected SDK. An empty list produces an empty array; an unavailable server-game interface throws. Detected invalid class links, cycles, or array-index overflow raise an error without publishing a partial list.

### `FindServerClass(strServerClassName)`

Requires a non-empty string and returns the first exact, case-sensitive server-class match or `null`. Missing, non-string, or empty names throw, as does an unavailable server-game interface. `FindServerClassByName(strServerClassName)` is retained as the equivalent native compatibility spelling.

### `GetEntityServerClass(EntityValue)`

Accepts a signed 32-bit integer entity index, an object with an integer `Index`, or a `bigint` edict/`CBaseEntity` address. A missing argument throws. It returns the resolved entity's `ServerClass`, or `null` when resolution safely fails or no networkable server class exists. A `bigint` can enter a native-address fallback, including after an index lookup fails: this is not a safe arbitrary-address validator. Use only current, trusted engine values; do not pass fabricated or stale addresses.

```js
const { FindServerClass, GetServerClasses } = require("entities/classes");
const { LogInfo } = require("loggers");

const g_vecServerClasses = GetServerClasses();
if (!Array.isArray(g_vecServerClasses)) {
	throw new Error("GetServerClasses() did not return an array.");
}

const g_DynamicPropClass = FindServerClass("CDynamicProp");
if (!g_DynamicPropClass || (g_DynamicPropClass.Kind !== "serverclass")) {
	throw new Error("CDynamicProp reflection is unavailable.");
}

LogInfo("%j", { Operation: "InspectServerClass", Count: g_vecServerClasses.length, ClassIndex: g_DynamicPropClass.ClassIndex, TableName: g_DynamicPropClass.Table.Name });
```

The returned records are rebuilt from SDK metadata on each native call. Re-query them after map or server-DLL lifecycle changes.

## Reflection object fields

All addresses are JavaScript `bigint` values. `0n` represents a native null address. Treat non-zero addresses as opaque, process-local snapshots: do not perform arithmetic on them or retain them across server-DLL lifecycle changes. These records expose metadata; assigning to their JavaScript fields does not edit the underlying SDK structures.

### `ServerClass`

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | `string` | Always `"serverclass"` |
| `Address` | `bigint` | Native `ServerClass*` address |
| `Name` | `string` | Network server-class name |
| `ClassIndex` | `number` | Selected SDK class ID |
| `InstanceBaselineIndex` | `number` | Current instance-baseline index |
| `Table` | `SendTable` | Root send table with direct properties populated |
| `NextAddress` | `bigint` | Native next-class address or `0n` |

### `SendTable`

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | `string` | Always `"sendtable"` |
| `Address` | `bigint` | Native `SendTable*` address |
| `Name` | `string` | Data-table name such as `DT_BaseEntity` |
| `ServerClassName` | `string` | Owning server-class name when known |
| `PropertyCount` | `number` | Number of direct properties |
| `Initialized` | `boolean` | SDK initialization state |
| `WriteFlag` | `boolean` | SDK write flag |
| `PropertiesEncodedAgainstTickCount` | `boolean` | Omitted when `SOURCEJS_OLD_CONSOLE_API` is defined |
| `Properties` | `SendProp[]` | Direct properties for a top-level table object |

Nested `SendProp.DataTable` records intentionally have an empty `Properties` array. `GetSendTable(ValueServerClassOrSendTableOrEntity)` returns a fresh table with its direct properties populated; `GetServerClassProperties(ValueServerClassOrSendTableOrEntity)` returns a separate flattened recursive property array. Neither call populates an existing record's nested arrays in place. Both require an argument.

### `SendProp`

| Field | Type | Meaning |
| --- | --- | --- |
| `Kind` | `string` | Always `"sendprop"` |
| `Address` | `bigint` | Native `SendProp*` address |
| `ServerClassName` | `string` | Resolved owning server class |
| `TableName` | `string` | Table that directly owns this property |
| `Index` | `number` | Direct property index inside `TableName` |
| `Name` | `string` | Direct SDK property name |
| `Path` | `string` | Path from the search root; single-property baseclass fallback can reset that root as described below |
| `Offset` | `number` | Byte offset from the search root; direct table properties use their SDK offset, recursive results accumulate parent offsets, and single-property baseclass fallback can reset the root |
| `TypeID` | `number` | Raw selected SDK `SendPropType` value |
| `Type` | `string` | Canonical type name such as `int`, `float`, `vector`, `string`, `array`, or `datatable` |
| `Flags` | `number` | Raw `SPROP_*` mask |
| `BitCount` | `number` | Network encoding bit count |
| `LowValue` | `number` | Network encoding lower bound |
| `HighValue` | `number` | Network encoding upper bound |
| `ArrayLength` | `number` | Array element count |
| `ElementStride` | `number` | Array element byte stride |
| `ExcludeDataTableName` | `string` | Excluded data-table name, when applicable |
| `ParentArrayPropertyName` | `string` | Parent array property name, when applicable |
| `HighLowMultiplier` | `number` | SDK encoding multiplier |
| `Signed` | `boolean` | Whether the integer property is signed |
| `ExcludedProperty` | `boolean` | Whether the property is an exclude marker |
| `InsideArray` | `boolean` | Whether the property is an array element descriptor |
| `ArrayPropertyAddress` | `bigint` | Native array-property address or `0n` |
| `ProxyFunctionAddress` | `bigint` | Native non-datatable proxy function address or `0n`; exclude markers use `0n` |
| `DataTableProxyFunctionAddress` | `bigint` | Native data-table proxy function address or `0n`; exclude markers use `0n` |
| `ArrayLengthProxyFunctionAddress` | `bigint` | Native array-length proxy function address or `0n`; only non-excluded array properties expose it |
| `DataTable` | `SendTable \| null` | Nested table for a datatable property |

```js
const { FindServerClass } = require("entities/classes");
const { LogInfo } = require("loggers");

const g_IsDisabledSendProperty = function IsDisabledSendProperty(PropertyCandidate) {
	return PropertyCandidate.Name === "m_bDisabled";
};

const g_ServerClass = FindServerClass("CDynamicProp");
if (!g_ServerClass) {
	throw new Error("CDynamicProp reflection is unavailable.");
}

const g_SendTable = g_ServerClass.Table;
const g_PropertyDescriptor = g_SendTable.Properties.find(g_IsDisabledSendProperty);
if (!g_PropertyDescriptor || (typeof g_PropertyDescriptor.Address !== "bigint") || (typeof g_PropertyDescriptor.TypeID !== "number")) {
	throw new Error("Expected sendprop metadata is unavailable.");
}

LogInfo("%j", {
	Operation: "InspectSendProperty",
	Path: g_PropertyDescriptor.Path,
	TableName: g_PropertyDescriptor.TableName,
	Type: g_PropertyDescriptor.Type,
	Offset: g_PropertyDescriptor.Offset,
});
```

## Send tables and properties

### `GetSendTable(ValueServerClassOrSendTableOrEntity)`

Resolves a populated table from a server-class or send-table name, a `ServerClass` or `SendTable` record, or any `EntityValue` form documented above. Resolution tries an entity first, then a server class, then a send table. A signed 32-bit integer `number` is treated as an entity index; a `bigint` may resolve as an edict, `CBaseEntity`, `ServerClass`, or `SendTable` address. The function requires an argument and the server-game interface; missing either throws. Safe resolution failure returns `null`, but arbitrary or stale addresses are not safely validated and must not be supplied.

### `GetServerClassSendTable(EntityValue)`

Accepts the same integer, `Index` object, and `bigint` entity-address forms as `GetEntityServerClass()`, with the same address-lifetime restrictions. A missing argument throws. It returns a fresh populated table for the resolved entity, or `null` when resolution safely fails or the entity has no server class or table.

```js
const { GetEntitiesByClassName, GetEntityServerClass, GetSendTable, GetServerClassSendTable } = require("entities/classes");
const { LogInfo } = require("loggers");

const g_vecDynamicEntities = GetEntitiesByClassName("prop_dynamic");
if (!Array.isArray(g_vecDynamicEntities)) {
	throw new Error("GetEntitiesByClassName() did not return an array.");
}

const [g_Entity] = g_vecDynamicEntities;
if (!g_Entity) {
	throw new Error("The current map has no prop_dynamic entity.");
}

const g_ServerClass = GetEntityServerClass(g_Entity);
if (!g_ServerClass) {
	throw new Error("The prop_dynamic has no networked server class.");
}

const g_TableByClass = GetSendTable(g_ServerClass);
const g_TableByEntity = GetServerClassSendTable(g_Entity);
if (!g_TableByClass || !g_TableByEntity || (g_TableByClass.Name !== g_TableByEntity.Name)) {
	throw new Error("Entity network reflection is inconsistent.");
}

LogInfo("%j", { Operation: "CompareEntitySendTables", EntityIndex: g_Entity.Index, ClassName: g_ServerClass.Name, TableName: g_TableByEntity.Name });
```

### `GetServerClassProperty(ValueServerClassOrSendTableOrEntity, ValuePropertyNameOrIndex)`

Accepts the same server-class, send-table, and `EntityValue` forms and address restrictions as `GetSendTable()`. A string selector uses the shared name/path search described below. With a signed 32-bit integer `number`, reads only the direct property at that index. Safe resolution failure, an unknown name, or a representable index outside the direct property count returns `null`. Both arguments and the server-game interface are required; missing either argument or the interface throws. After table resolution succeeds, a selector other than a non-empty string or signed 32-bit integer throws; numeric values outside the signed 32-bit range are rejected rather than treated as missing properties.

### `GetEntitySendProperty(EntityValue, strPropertyName)`

Accepts the same integer, `Index` object, and `bigint` entity-address forms and address restrictions as `GetEntityServerClass()`. It recursively resolves one non-empty property name against the live entity's current server class. Both arguments are required; a missing argument throws. Safe entity-resolution failure, a missing server class or table, and an unknown property return `null`. After entity/table resolution succeeds, an empty or non-string property name throws.

### `GetServerClassProperties(ValueServerClassOrSendTableOrEntity)`

Accepts the same server-class, send-table, and `EntityValue` forms and address restrictions as `GetSendTable()`. It returns a flattened recursive property array, without descending into excluded datatable properties. A nested property's `Path` and `Offset` are cumulative from the requested root. Safe resolution failure or a class without a send table returns an empty array. A missing argument or unavailable server-game interface throws.

The collector accepts recursion depths 0 through 32. Exceeding that depth, an invalid table/property storage range, an accumulated offset outside the signed `int` range, an array-index overflow, or a failed record/array-entry construction aborts the collection with a JavaScript error; no partially collected array is returned. An already pending JavaScript exception is preserved. Unlike the single-property search below, the collector does not skip an overflowing branch or retry from a base table with a reset root. These checks do not make arbitrary native addresses safe.

### `FindServerClassPropertyOffset(ValueServerClassOrSendTableOrEntity, strPropertyName)`

Accepts the same server-class, send-table, and `EntityValue` forms and address restrictions as `GetSendTable()`. It returns the byte offset from the shared name/path search below, or `-1` when input resolution safely fails or the property cannot be found. Both arguments and the server-game interface are required; missing either argument or the interface throws. After table resolution succeeds, an empty or non-string property name throws.

The three single-property name lookups share a case-sensitive, first-match depth-first search supporting direct names and dotted paths. The recursive search accumulates parent offsets and paths, does not descend into excluded datatable properties, limits recursion to depth 32, and skips branches whose cumulative offset is outside the signed `int` range.

If that search fails, a separate fallback follows the first direct `baseclass` datatable matched by name and type, without testing its exclude flag, and retries at most 32 base tables. Each retry resets the starting offset and path. A result found only by that fallback is therefore relative to the retried base table, not necessarily the original root or entity base. Do not blindly use such an offset for entity memory access.

```js
const {
	FindServerClassPropertyOffset,
	GetEntitiesByClassName,
	GetEntitySendProperty,
	GetSendTable,
	GetServerClassProperties,
	GetServerClassProperty,
} = require("entities/classes");
const { LogInfo } = require("loggers");

const g_vecDynamicEntities = GetEntitiesByClassName("prop_dynamic");
if (!Array.isArray(g_vecDynamicEntities)) {
	throw new Error("GetEntitiesByClassName() did not return an array.");
}

const [g_Entity] = g_vecDynamicEntities;
if (!g_Entity) {
	throw new Error("The current map has no prop_dynamic entity.");
}

const g_SendTable = GetSendTable("CDynamicProp");
if (!g_SendTable) {
	throw new Error("CDynamicProp send-table reflection is unavailable.");
}

const g_HealthProperty = GetServerClassProperty(g_SendTable, "m_iHealth");
const g_FirstDirectProperty = GetServerClassProperty(g_SendTable, 0);
const g_EntityHealthProperty = GetEntitySendProperty(g_Entity, "m_iHealth");
const g_vecProperties = GetServerClassProperties(g_SendTable);
if (!Array.isArray(g_vecProperties)) {
	throw new Error("GetServerClassProperties() did not return an array.");
}

const g_nHealthOffset = FindServerClassPropertyOffset(g_SendTable, "m_iHealth");
if (!g_HealthProperty || !g_EntityHealthProperty || !g_FirstDirectProperty || (g_HealthProperty.Offset !== g_nHealthOffset)) {
	throw new Error("Recursive m_iHealth resolution failed.");
}

LogInfo("%j", { Operation: "FindSendProperties", FirstDirectProperty: g_FirstDirectProperty.Name, Path: g_HealthProperty.Path, PropertyCount: g_vecProperties.length });
```

Use property metadata to select the appropriate Entity typed getter/setter or [`entities/props`](entities-props.md) operation, following that operation's type, lifetime, and range contract. Do not construct arbitrary process-memory addresses by adding metadata offsets to entity addresses. Reflection metadata alone does not establish that memory access is safe.

## Inheritance

### `GetServerClassBaseClassNames(ServerClassReference)`

Accepts the same server-class, send-table, and `EntityValue` forms and address restrictions as `GetSendTable()`. It walks properties named `baseclass`, maps nested table names back to server-class names, and returns each mapped class once in depth-first property order. Tables without a mapped class name are still traversed but add no name; duplicate table-name mappings use the last server-class record. Visited table names prevent repeated traversal. Safe failure to resolve the starting value returns an empty array; an unresolved nested `baseclass` send table throws. Native errors propagate, and malformed class/table names in the mapping records throw a `TypeError`.

```js
const { FindServerClass, GetServerClassBaseClassNames } = require("entities/classes");
const { LogInfo } = require("loggers");

const g_DynamicPropClass = FindServerClass("CDynamicProp");
if (!g_DynamicPropClass) {
	throw new Error("CDynamicProp reflection is unavailable.");
}

const g_vecBaseClassNames = GetServerClassBaseClassNames(g_DynamicPropClass);
if (!g_vecBaseClassNames.includes("CBaseEntity")) {
	throw new Error("CDynamicProp did not expose CBaseEntity inheritance.");
}

LogInfo("%j", { Operation: "InspectClassInheritance", Names: [g_DynamicPropClass.Name].concat(g_vecBaseClassNames) });
```

This follows network-table inheritance, which is not a complete C++ RTTI hierarchy.

## Generators

### `new ServerClassGenerator(strClassPattern = "", GeneratorOptions = {})`

Each iterator calls `GetServerClasses()` when iteration starts, not when the generator is constructed. It then walks that returned array. A new iterator fetches current metadata again. Matching is case-insensitive, but does not trim whitespace:

- default mode includes a class when its name contains `strClassPattern`;
- `{ Exact: true }` requires the complete normalized name;
- an empty or `undefined` `strClassPattern` yields every server class; every other non-string value is rejected;
- `GeneratorOptions` defaults to `{}`; any supplied non-`undefined` value must be a non-null, non-array object, and a non-`undefined` `Exact` value must be boolean.

The public `Pattern` and `Exact` fields store the supplied pattern and resolved boolean mode. They are mutable and are read and validated for each candidate during iteration. Changing them between yielded records affects subsequent matching; invalid later values throw when another candidate is checked. Constructor validation still applies even when the native class array is empty.

```js
const { ServerClassGenerator } = require("entities/classes");
const { LogInfo } = require("loggers");

if (typeof ServerClassGenerator !== "function") {
	throw new Error("The selected SDK does not expose sendprop reflection.");
}

const g_GetServerClassName = function GetServerClassName(ServerClass) {
	return ServerClass.Name;
};

const g_vecBasePatternClasses = Array.from(new ServerClassGenerator("base"));
const g_vecExactDynamicClasses = Array.from(new ServerClassGenerator("cdynamicprop", { Exact: true }));
if ((g_vecExactDynamicClasses.length !== 1) || (g_vecExactDynamicClasses[0].Name !== "CDynamicProp")) {
	throw new Error("Exact server-class filtering failed.");
}

LogInfo("%j", { Operation: "GenerateServerClasses", Names: g_vecBasePatternClasses.map(g_GetServerClassName) });
```

## `SERVER_CLASSES` collection

`SERVER_CLASSES` is one `ServerClassCollection` instance. It does not cache server-class records: each method delegates to current native reflection data. Requesting a collection iterator calls `GetServerClasses()` immediately; unlike `ServerClassGenerator`, it does not wait for the first `next()` call.

### Collection methods

| Method | Result |
| --- | --- |
| [`GetServerClasses()`](#getserverclasses) | Current `ServerClass[]` |
| [`FindServerClass(strServerClassName)`](#findserverclassstrserverclassname) | Named `ServerClass` or `null` |
| `HasServerClass(strServerClassName)` | `false` when one `FindServerClass(strServerClassName)` call returns `null` or `undefined`; otherwise `true` |
| `FindServerClassBySendTableName(strSendTableName)` | Requires a non-empty string; returns the first class whose root table has that exact case-sensitive name, or `null` |
| [`GetServerClassProperty(strServerClassName, PropertyNameOrIndex)`](#getserverclasspropertyvalueserverclassorsendtableorentity-valuepropertynameorindex) | Named/indexed property for a class name, or `null` |
| [`GetServerClassProperties(strServerClassName)`](#getserverclasspropertiesvalueserverclassorsendtableorentity) | Recursive properties for a class name, or `[]` |
| [`FindServerClassPropertyOffset(strServerClassName, strPropertyName)`](#findserverclasspropertyoffsetvalueserverclassorsendtableorentity-strpropertyname) | Property offset or `-1`; the single-property baseclass fallback limitation above applies |
| [`GetServerClassBaseClassNames(strServerClassName)`](#getserverclassbaseclassnamesserverclassreference) | Network base-class names for a class name, or `[]` |
| [`GetServerClassSendTable(strServerClassName)`](#getserverclasssendtableentityvalue) | Root `SendTable` for a class name, or `null`; unlike the native function of the same name, this collection method resolves a server-class name |
| [`GetSendTable(strServerClassName)`](#getsendtablevalueserverclassorsendtableorentity) | Root `SendTable` for a class name, or `null` |
| `[Symbol.iterator]()` | Iterator over `GetServerClasses()` |

Methods that forward native array or record results can preserve checked `undefined`; validate those results before use. `HasServerClass()` performs one lookup, returns `false` for `null` or `undefined`, and otherwise returns `true` without coercing or validating the returned record. Lookup errors propagate unchanged. Use `FindServerClass()` when the record itself is needed.

```js
const { SERVER_CLASSES, ServerClassCollection } = require("entities/classes");
const { LogInfo } = require("loggers");

if (!SERVER_CLASSES || (typeof ServerClassCollection !== "function")) {
	throw new Error("The selected SDK does not expose sendprop reflection.");
}

const g_GetServerClassName = function GetServerClassName(ServerClass) {
	return ServerClass.Name;
};

const g_IndependentView = new ServerClassCollection();
const g_DynamicPropClass = SERVER_CLASSES.FindServerClass("CDynamicProp");
const g_ServerClassByTableName = SERVER_CLASSES.FindServerClassBySendTableName("DT_DynamicProp");
const g_SendTable = SERVER_CLASSES.GetSendTable("CDynamicProp");
const g_HealthProperty = SERVER_CLASSES.GetServerClassProperty("CDynamicProp", "m_iHealth");
const g_vecProperties = SERVER_CLASSES.GetServerClassProperties("CDynamicProp");
if (!Array.isArray(g_vecProperties)) {
	throw new Error("SERVER_CLASSES.GetServerClassProperties() did not return an array.");
}

const g_nHealthOffset = SERVER_CLASSES.FindServerClassPropertyOffset("CDynamicProp", "m_iHealth");
const g_vecBaseClassNames = SERVER_CLASSES.GetServerClassBaseClassNames("CDynamicProp");
const g_vecIteratedClassNames = Array.from(g_IndependentView, g_GetServerClassName);

if (!g_DynamicPropClass || !g_ServerClassByTableName || !SERVER_CLASSES.HasServerClass("CDynamicProp") || (g_ServerClassByTableName.Address !== g_DynamicPropClass.Address)) {
	throw new Error("Server-class collection lookup failed.");
}

if (!g_SendTable || !g_HealthProperty || (g_HealthProperty.Offset !== g_nHealthOffset) || (g_vecProperties.length === 0)) {
	throw new Error("Server-class property lookup failed.");
}

if (!g_vecBaseClassNames.includes("CBaseEntity") || !g_vecIteratedClassNames.includes("CDynamicProp")) {
	throw new Error("Server-class iteration failed.");
}

const g_vecServerClasses = SERVER_CLASSES.GetServerClasses();
if (!Array.isArray(g_vecServerClasses)) {
	throw new Error("SERVER_CLASSES.GetServerClasses() did not return an array.");
}

LogInfo("%j", { Operation: "InspectServerClassCollection", Names: g_vecServerClasses.map(g_GetServerClassName) });
```

Multiple collection instances do not create isolated caches. They are lightweight views over the same current engine metadata.

## Using reflection with entities

Resolve metadata first, then use the appropriate native Entity API for values under its documented type and lifetime constraints. Metadata describes the property; it does not by itself prove safe memory access or remove the single-property lookup's baseclass fallback limitation described above.

```js
const { GetEntitiesByClassName, GetEntitySendProperty } = require("entities/classes");
const { LogInfo } = require("loggers");

if (typeof GetEntitySendProperty !== "function") {
	throw new Error("The selected SDK does not expose sendprop reflection.");
}

const g_vecDynamicEntities = GetEntitiesByClassName("prop_dynamic");
if (!Array.isArray(g_vecDynamicEntities)) {
	throw new Error("GetEntitiesByClassName() did not return an array.");
}

const [g_Entity] = g_vecDynamicEntities;
if (!g_Entity || (typeof g_Entity.GetEntityPropertyInteger !== "function")) {
	throw new Error("The current map has no prop_dynamic with native sendprop access.");
}

const g_HealthProperty = GetEntitySendProperty(g_Entity, "m_iHealth");
if (!g_HealthProperty || (g_HealthProperty.Type !== "int")) {
	throw new Error("m_iHealth is not an integer sendprop on this class.");
}

const g_nHealth = g_Entity.GetEntityPropertyInteger(g_HealthProperty.Path);
if (!Number.isInteger(g_nHealth)) {
	throw new Error("Unable to read m_iHealth through the typed Entity API.");
}

LogInfo("%j", { Operation: "ReadEntityHealth", EntityIndex: g_Entity.Index, Health: g_nHealth });
```

See [`entities/props`](entities-props.md) for every typed property operation and sendprop constant.

## Lifecycle and common mistakes

- Run live-entity scans and engine reflection queries on the server thread, not arbitrary worker threads.
- `GetEntityClassNames()` describes classes present now; `GetServerClasses()` describes network classes registered by the server DLL.
- `GetEntitiesByClassName()` returns native Entity objects but does not run `entities.DecorateEntity()`.
- Reflection exports may be absent on a selected SDK. Test the owning capability, not each method with fallback values.
- Class names such as `CDynamicProp` and table names such as `DT_DynamicProp` are different namespaces.
- `GetServerClassProperty(ValueServerClassOrSendTableOrEntity, nPropertyIndex)` is direct-table indexing; string lookup is recursive.
- Preserve `Path` and `Offset` when diagnosing nested tables. Recursive listing uses the requested root; single-property lookup can retry a base table with a reset root, as described above.
- Reflection records are rebuilt JavaScript metadata objects. Mutating their fields does not change the engine's `ServerClass`, `SendTable`, or `SendProp`.
- Do not retain reflection records, Entity objects, or addresses across map teardown or server-DLL changes.
- Preserve the API's `bigint` address representation and do not fabricate address-bearing records; use current reflection objects returned by the API.

## Export reference

| Export | Availability | Signature | Result |
| --- | --- | --- | --- |
| [`GetEntityClassNames`](#getentityclassnames) | Always | `GetEntityClassNames()` | Unique current edict class names |
| [`GetEntitiesByClassName`](#getentitiesbyclassnamestrclassname) | Always | `GetEntitiesByClassName(strClassName)` | Current native Entity array; requires a non-empty string |
| [`GetEntityClassName`](#getentityclassnameentityvalue) | Always | `GetEntityClassName(EntityValue)` | Current edict class name or `""` |
| [`GetServerClasses`](#getserverclasses) | Sendprops | `GetServerClasses()` | Current `ServerClass[]` |
| `FindServerClassByName` | Sendprops | `FindServerClassByName(strServerClassName)` | `ServerClass` or `null` |
| [`FindServerClass`](#findserverclassstrserverclassname) | Sendprops | `FindServerClass(strServerClassName)` | `ServerClass` or `null` |
| [`GetEntityServerClass`](#getentityserverclassentityvalue) | Sendprops | `GetEntityServerClass(EntityValue)` | Entity `ServerClass` or `null` |
| [`GetServerClassSendTable`](#getserverclasssendtableentityvalue) | Sendprops | `GetServerClassSendTable(EntityValue)` | Entity `SendTable` or `null` |
| [`GetSendTable`](#getsendtablevalueserverclassorsendtableorentity) | Sendprops | `GetSendTable(ValueServerClassOrSendTableOrEntity)` | Populated `SendTable` or `null` |
| [`GetServerClassProperty`](#getserverclasspropertyvalueserverclassorsendtableorentity-valuepropertynameorindex) | Sendprops | `GetServerClassProperty(ValueServerClassOrSendTableOrEntity, ValuePropertyNameOrIndex)` | `SendProp` or `null` |
| [`GetEntitySendProperty`](#getentitysendpropertyentityvalue-strpropertyname) | Sendprops | `GetEntitySendProperty(EntityValue, strPropertyName)` | Entity sendprop metadata or `null` |
| [`GetServerClassProperties`](#getserverclasspropertiesvalueserverclassorsendtableorentity) | Sendprops | `GetServerClassProperties(ValueServerClassOrSendTableOrEntity)` | Recursive `SendProp[]` |
| [`FindServerClassPropertyOffset`](#findserverclasspropertyoffsetvalueserverclassorsendtableorentity-strpropertyname) | Sendprops | `FindServerClassPropertyOffset(ValueServerClassOrSendTableOrEntity, strPropertyName)` | Property offset or `-1`; baseclass fallback limitation applies |
| [`GetServerClassBaseClassNames`](#getserverclassbaseclassnamesserverclassreference) | Sendprops | `GetServerClassBaseClassNames(ServerClassReference)` | Network inheritance names |
| `SERVER_CLASSES` | Sendprops | `ServerClassCollection` instance | Current reflection view |
| `ServerClassCollection` | Sendprops | `new ServerClassCollection()` | Lightweight current reflection view |
| [`ServerClassGenerator`](#new-serverclassgeneratorstrclasspattern---generatoroptions--) | Sendprops | `new ServerClassGenerator(strClassPattern = "", GeneratorOptions = {})` | Lazy class iterator |
