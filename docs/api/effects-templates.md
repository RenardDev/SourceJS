# `require("effects/templates")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

`effects/templates` combines temporary-entity descriptors with field profiles from `effects/fields`. Each module instance exports a default template collection; callers can also construct collections or templates. The module provides field resolution, mutable pre/post callback lists, and a direct creation method that delegates to the native runtime without invoking managed hooks. A module-level cache alone does not establish per-plugin ownership or isolation.

Name-based discovery requires native temporary-entity metadata from the running server. Constructors also accept descriptor objects directly, so not every template originates from native discovery. Missing lookup results and failed descriptor checks throw; the constructor checks nonempty name/class-name strings and a properties array, not every metadata field or native provenance. Use templates only while their server metadata and referenced resources remain valid.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Shared collection](#shared-collection)
- [`TemporaryEntityTemplate`](#temporaryentitytemplate)
- [Examples](#examples)
- [Errors and lifecycle](#errors-and-lifecycle)
- [Related modules](#related-modules)

## Location and purpose

[`packages/sourcejs/effects/templates.js`](../../packages/sourcejs/effects/templates.js) implements template discovery, canonical caching, field resolution, hook lists, and direct creation. [`packages/sourcejs/effects/fields.js`](../../packages/sourcejs/effects/fields.js) supplies readable field profiles, while [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) supplies native descriptors and sending.

Use this module when a plugin needs reusable template metadata, field/profile lookup, direct native creation, or the shared hook arrays used by managed `TemporaryEntity` creation.

## Import

```js
const {
	TEMP_ENTITY_TEMPLATES,
	TemporaryEntityTemplate,
	TemporaryEntityTemplateCollection,
	GetTemporaryEntityTemplate,
	GetTemporaryEntityTemplates,
} = require("effects/templates");
```

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| `TEMP_ENTITY_TEMPLATES` | Shared collection | Default collection for this module instance; not proof of per-plugin ownership or isolation. |
| [`TemporaryEntityTemplate`](#new-temporaryentitytemplatetemporaryentitynameordescriptor) | `new TemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)` | New template built from a name lookup or supplied descriptor. Does not automatically enter the default collection; descriptor/profile data can be shared by reference. |
| `TemporaryEntityTemplateCollection` | `new TemporaryEntityTemplateCollection()` | New collection with an initially empty map; still uses the same runtime and field-profile module dependencies. |
| [`GetTemporaryEntityTemplate`](#gettemporaryentitytemplatetemporaryentitynameordescriptor) | `GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)` | Delegates to the default collection: resolves/accepts a descriptor and caches by its exact class-name string. A cache hit returns the existing template without rebuilding it from the supplied descriptor. |
| [`GetTemporaryEntityTemplates`](#gettemporaryentitytemplates) | `GetTemporaryEntityTemplates()` | Enumerates through the native runtime and replaces each returned descriptor with the default collection's cached/new template. Native enumeration can throw before mapping begins; descriptor construction can throw after earlier entries have been cached. |

## Shared collection

`TEMP_ENTITY_TEMPLATES` exposes:

| Member | Result |
| --- | --- |
| `TemplateCache` | Mutable `Map` keyed by the descriptor's exact `ClassName`; direct mutation can invalidate identity and value assumptions. |
| [`GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)`](#gettemporaryentitytemplatetemporaryentitynameordescriptor) | The exported function delegates to this method on the default collection. |
| `HasTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)` | Resolves and caches a template, then returns `true`. A name lookup returning exactly `null` returns `false`; invalid input, other invalid lookup results, and runtime/construction failures throw. Descriptor input goes directly through `GetTemporaryEntityTemplate`. |
| [`GetTemporaryEntityTemplates()`](#gettemporaryentitytemplates) | Same result as the exported `GetTemporaryEntityTemplates()`. |
| `[Symbol.iterator]()` | Calls `GetTemporaryEntityTemplates()` and returns that array's iterator; enumeration populates the cache and can throw. |

Without direct cache mutation, resolving `BeamPoints` by name and later enumerating a descriptor with the same `CTEBeamPoints` class-name string returns the cached object. A separate collection creates a separate template, but descriptor/profile references can still be shared; separate maps do not establish independent ownership of all underlying data.

```js
const { TEMP_ENTITY_TEMPLATES, TemporaryEntityTemplateCollection } = require("effects/templates");

function IsBeamPointsTemporaryEntityTemplate(TemporaryEntityTemplate) {
	return TemporaryEntityTemplate.ClassName === "CTEBeamPoints";
}

if (!TEMP_ENTITY_TEMPLATES.HasTemporaryEntityTemplate("BeamPoints")) {
	throw new Error("The selected SDK does not expose BeamPoints.");
}

const g_DirectBeamPointsTemporaryEntityTemplate = TEMP_ENTITY_TEMPLATES.GetTemporaryEntityTemplate("BeamPoints");
const g_ListedBeamPointsTemporaryEntityTemplate = [...TEMP_ENTITY_TEMPLATES].find(IsBeamPointsTemporaryEntityTemplate);
if (g_ListedBeamPointsTemporaryEntityTemplate !== g_DirectBeamPointsTemporaryEntityTemplate) {
	throw new Error("BeamPoints did not preserve canonical template identity.");
}

const g_IndependentTemporaryEntityTemplates = new TemporaryEntityTemplateCollection();
const g_IndependentBeamPointsTemporaryEntityTemplate = g_IndependentTemporaryEntityTemplates.GetTemporaryEntityTemplate(g_DirectBeamPointsTemporaryEntityTemplate.TemplateInfo);
if ((g_IndependentBeamPointsTemporaryEntityTemplate === g_DirectBeamPointsTemporaryEntityTemplate) || (g_IndependentBeamPointsTemporaryEntityTemplate.ClassName !== g_DirectBeamPointsTemporaryEntityTemplate.ClassName)) {
	throw new Error("The separate collection did not produce a distinct template for the same class.");
}
```

## `TemporaryEntityTemplate`

### Fields

| Field | Meaning |
| --- | --- |
| `TemplateInfo` | Original descriptor reference, from native lookup or supplied directly by the caller; not a defensive copy or proof of native provenance. |
| `Name` | Name copied from the descriptor at construction, such as `BeamPoints`. |
| `ClassName` | Class-name string copied at construction, such as `CTEBeamPoints`. |
| `ClassIndex` | Descriptor's class-index value at construction; not refreshed automatically. |
| `TableName` | Descriptor's root send-table name at construction. |
| `Size` | Descriptor's sender storage size in bytes at construction. |
| `Properties` | Descriptor's property array, retained by reference. |
| `PreCreateHooks` | Initially empty, live managed pre-create callback array. |
| `PostCreateHooks` | Initially empty, live managed post-create callback array. |
| `Fields` | New field map populated by `BuildTemporaryEntityFields()` during construction. |
| `FieldNames` | Live ordered field-name array returned directly by `GetTemporaryEntityFieldNames()`, not a copy. |

These are ordinary writable properties, not immutable metadata or live native accessors. Changing the original descriptor does not automatically refresh copied values or rebuild mappings; direct mutation of arrays, the map, or properties can make the template inconsistent. Constructor shape checks do not validate every descriptor value or establish native resource lifetime.

### Field methods

| Method | Signature | Result |
| --- | --- | --- |
| [`BuildTemporaryEntityFields`](#buildtemporaryentityfields) | `BuildTemporaryEntityFields()` | Adds/replaces mappings from the stored property array, then profile properties, then profile types. Does not clear old mappings or names; later failures do not roll back earlier updates. Returns `undefined`. |
| [`AddTemporaryEntityFieldName`](#addtemporaryentityfieldnamestrfieldname-fielddescriptor) | `AddTemporaryEntityFieldName(strFieldName, FieldDescriptor)` | Stores the descriptor reference under the lowercase key. Appends the original name only for a new key; replacement keeps the first spelling and position. Requires a non-null, non-array object, not a fully validated descriptor. Returns `undefined`. |
| [`FindTemporaryEntityProperty`](#findtemporaryentitypropertystrfieldname) | `FindTemporaryEntityProperty(strFieldName)` | Uses the mapped path/value fields or input name (first entry for an array), then returns the first matching stored property descriptor, or `null`. |
| [`ResolveTemporaryEntityField`](#resolvetemporaryentityfieldstrfieldname) | `ResolveTemporaryEntityField(strFieldName)` | Returns a truthy stored mapping directly; otherwise wraps the first matching property in a new descriptor without caching it, or returns `null`. |
| [`ResolveTemporaryEntityPropertyName`](#resolvetemporaryentitypropertynamestrfieldname) | `ResolveTemporaryEntityPropertyName(strFieldName)` | Resolves a descriptor and selects its path/value fields (first array entry). Returns the input when unresolved; throws if a resolved name is not a non-empty string. |
| [`HasTemporaryEntityField`](#hastemporaryentityfieldstrfieldname) | `HasTemporaryEntityField(strFieldName)` | Tests whether resolution returns anything other than `null`; does not prove the mapping is usable by native creation. |
| [`GetTemporaryEntityFieldNames`](#gettemporaryentityfieldnames) | `GetTemporaryEntityFieldNames()` | Live ordered name array. |

Name lookup requires a non-empty string and lowercases it without trimming. Property fallback compares the raw path, property name, alias, and last/previous path segments, plus engine-normalized property-name and path-segment candidates; ambiguous matches select the first property. These methods can throw on invalid names, malformed descriptors, or profile-loading failures; `HasTemporaryEntityField` does not suppress errors.

### Hook methods

| Method | Signature | Result |
| --- | --- | --- |
| `RegisterTemporaryEntityPreCreateHook` | `RegisterTemporaryEntityPreCreateHook(HookCallback)` | Appends and returns the supplied function; throws for a non-function or the same function already present in the pre-create array. |
| `UnregisterTemporaryEntityPreCreateHook` | `UnregisterTemporaryEntityPreCreateHook(HookCallback)` | Removes the first matching function reference and returns `true`; throws if absent. |
| `InvokeTemporaryEntityPreCreateHooks` | `InvokeTemporaryEntityPreCreateHooks(TemporaryEntity, Recipients)` | Calls handlers synchronously with the supplied arguments; stops and returns `false` at the first exact-false result, otherwise returns `true`. |
| `RegisterTemporaryEntityPostCreateHook` | `RegisterTemporaryEntityPostCreateHook(HookCallback)` | Appends and returns the supplied function; throws for a non-function or the same function already present in the post-create array. |
| `UnregisterTemporaryEntityPostCreateHook` | `UnregisterTemporaryEntityPostCreateHook(HookCallback)` | Removes the first matching function reference and returns `true`; throws if absent. |
| `InvokeTemporaryEntityPostCreateHooks` | `InvokeTemporaryEntityPostCreateHooks(TemporaryEntity, Recipients)` | Calls handlers synchronously in array order, ignores their return values, and returns `undefined` on normal completion. |

Both invocation methods traverse the live arrays, not snapshots. Callback exceptions stop traversal and propagate; promises are not awaited. Registration/removal during dispatch can affect which callbacks run. Arguments are forwarded unchanged: `Recipients` is not necessarily an array. Calling an invocation method directly does not itself perform native creation or prove delivery. The same function can be registered once in each phase; retain its reference for removal.

### Native creation

| Method | Signature | Result |
| --- | --- | --- |
| [`CreateTemporaryEntity`](#createtemporaryentitypropertyvalues-recipients-fleffectdelay-breliabledelivery) | `CreateTemporaryEntity(PropertyValues = {}, Recipients = undefined, flEffectDelay = 0, bReliableDelivery = false)` | Returns `CreateTempEntity(this.Name, PropertyValues, Recipients, flEffectDelay, bReliableDelivery)` from the native runtime; exceptions propagate. |

`TemporaryEntityTemplate.CreateTemporaryEntity()` forwards values directly: it does not resolve profile aliases, convert typed field values, or invoke `PreCreateHooks`/`PostCreateHooks`. Supply property paths and values accepted by the native API. `Recipients` is forwarded unchanged, not required by this JavaScript method to be an array. Defaults apply to omitted or `undefined` arguments; native validation still applies.

Use `TemporaryEntity.CreateTemporaryEntity()` or `effects.CreateTemporaryEntity()` when managed field conversion and hooks are required. A successful native return means the engine playback call returned, not that clients received the effect; this direct template method adds no delivery acknowledgement or rollback.

## Examples

### `new TemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)`

Build a separate field resolver without adding it to the default collection's cache. The selected runtime must expose `BeamPoints`, and the field profile must load successfully:

```js
const { TemporaryEntityTemplate } = require("effects/templates");

const g_BeamTemporaryEntityTemplate = new TemporaryEntityTemplate("BeamPoints");
console.log({
	TemporaryEntityClassIndex: g_BeamTemporaryEntityTemplate.ClassIndex,
	TemporaryEntityClassName: g_BeamTemporaryEntityTemplate.ClassName,
	TemporaryEntityName: g_BeamTemporaryEntityTemplate.Name,
	TemporaryEntityPropertyCount: g_BeamTemporaryEntityTemplate.Properties.length,
	TemporaryEntitySizeBytes: g_BeamTemporaryEntityTemplate.Size,
	TemporaryEntityTableName: g_BeamTemporaryEntityTemplate.TableName,
});
```

Direct descriptor input must have non-empty `Name` and `ClassName` strings plus a `Properties` array; its entries must also support field-map construction. These checks are not exhaustive native validation. The descriptor and property array are retained by reference, and profile data can be shared, so a separate template does not imply a deep copy or independent native resource lifetime.

### `GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)`

Reuse the default module collection's field map and hook arrays for the same class:

```js
const { GetTemporaryEntityTemplate } = require("effects/templates");

const g_FirstBeamPointsTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
const g_SecondBeamPointsTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
if (g_FirstBeamPointsTemporaryEntityTemplate !== g_SecondBeamPointsTemporaryEntityTemplate) {
	throw new Error("BeamPoints template cache identity changed.");
}
```

Each string lookup calls the native runtime before consulting the cache and can therefore fail even when a previous template is cached. If both descriptors have the same class-name string and the cache is not directly changed, both calls return the same object. A cache hit does not refresh its metadata, fields, or hooks from the newer descriptor; this is module-instance sharing, not a guarantee of per-plugin isolation.

### `GetTemporaryEntityTemplates()`

Find templates with a non-empty, non-`property` field type label. This identifies configured mappings, not proof that native creation supports each mapping:

```js
const { GetTemporaryEntityTemplates } = require("effects/templates");

function HasTypedTemporaryEntityProfileField(TemporaryEntityTemplate) {
	function IsTypedTemporaryEntityField(strFieldName) {
		const strValueType = TemporaryEntityTemplate.ResolveTemporaryEntityField(strFieldName)?.ValueType;

		return (typeof strValueType === "string") && (strValueType.length > 0) && (strValueType !== "property");
	}

	return TemporaryEntityTemplate.GetTemporaryEntityFieldNames().some(IsTypedTemporaryEntityField);
}

function GetTemporaryEntityTemplateSummary(TemporaryEntityTemplate) {
	return { ClassName: TemporaryEntityTemplate.ClassName, Name: TemporaryEntityTemplate.Name, TableName: TemporaryEntityTemplate.TableName };
}

const g_vecTypedTemporaryEntityTemplateSummaries = GetTemporaryEntityTemplates().filter(HasTypedTemporaryEntityProfileField).map(GetTemporaryEntityTemplateSummary);
console.log(g_vecTypedTemporaryEntityTemplateSummaries);
```

Enumeration resolves each native descriptor through `TEMP_ENTITY_TEMPLATES`. Entries with the same class-name key reuse their cached object unless the map is changed directly. The list can change with native enumeration; cached metadata is not refreshed on a hit, and a later failure can leave earlier entries cached. Missing type definitions are omitted by the profile parser, but an unrecognized non-empty type label still passes this example's filter; the example does not validate supported conversions. Resolver exceptions propagate.

### `AddTemporaryEntityFieldName(strFieldName, FieldDescriptor)`

Add an extension-owned alias to a separate template without changing the default collection:

```js
const { TemporaryEntityTemplate } = require("effects/templates");

const g_BeamTemporaryEntityTemplate = new TemporaryEntityTemplate("BeamPoints");
const g_LifetimeFieldDescriptor = g_BeamTemporaryEntityTemplate.ResolveTemporaryEntityField("LifeTime");
if (!g_LifetimeFieldDescriptor) {
	throw new Error("BeamPoints has no LifeTime mapping.");
}

g_BeamTemporaryEntityTemplate.AddTemporaryEntityFieldName("DurationSeconds", g_LifetimeFieldDescriptor);

if (g_BeamTemporaryEntityTemplate.ResolveTemporaryEntityField("DurationSeconds") !== g_LifetimeFieldDescriptor) {
	throw new Error("The extension field alias did not retain its descriptor.");
}
```

The descriptor is shared by reference, not copied or exhaustively validated. A case-insensitive key collision replaces the mapping while retaining the first recorded spelling and position; choose an alias that does not replace a required mapping. Rebuilding can overwrite the alias if an input later supplies the same normalized key.

### `BuildTemporaryEntityFields()`

Check that rebuilding with unchanged property/profile inputs preserves the field-name count. This is not a check of descriptor identity or complete state equivalence:

```js
const { TemporaryEntityTemplate } = require("effects/templates");

const g_BeamTemporaryEntityTemplate = new TemporaryEntityTemplate("BeamPoints");
const g_unBeamTemporaryEntityFieldCount = g_BeamTemporaryEntityTemplate.GetTemporaryEntityFieldNames().length;
g_BeamTemporaryEntityTemplate.BuildTemporaryEntityFields();

if (g_BeamTemporaryEntityTemplate.GetTemporaryEntityFieldNames().length !== g_unBeamTemporaryEntityFieldCount) {
	throw new Error("Rebuilding BeamPoints changed the field-name count.");
}
```

`BuildTemporaryEntityFields()` reuses the stored property array rather than rediscovering native metadata. It replaces matching map entries and appends names for new normalized keys without clearing the map or name array. Extension-added entries survive only where rebuilding does not overwrite their keys; removed input mappings can remain stale. New descriptor objects can replace old ones even when the count is unchanged. Profile-loading or construction errors propagate without rolling back earlier updates.

### `FindTemporaryEntityProperty(strFieldName)`

Inspect stored send-property metadata behind the supplied profile's `LifeTime` alias. The selected runtime must expose the expected `BeamPoints` property layout:

```js
const { GetTemporaryEntityTemplate } = require("effects/templates");

const g_BeamTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
const g_LifetimeTemporaryEntityPropertyDescriptor = g_BeamTemporaryEntityTemplate.FindTemporaryEntityProperty("LifeTime");
if (!g_LifetimeTemporaryEntityPropertyDescriptor || (g_LifetimeTemporaryEntityPropertyDescriptor.Path !== "m_fLife")) {
	throw new Error("BeamPoints LifeTime did not resolve to m_fLife.");
}

console.log({ OffsetBytes: g_LifetimeTemporaryEntityPropertyDescriptor.Offset, PropertyPath: g_LifetimeTemporaryEntityPropertyDescriptor.Path, PropertyType: g_LifetimeTemporaryEntityPropertyDescriptor.Type });
```

`FindTemporaryEntityProperty()` selects the mapped path/value fields, using only the first entry of an array, or falls back to the input name. It searches stored properties in order using case-insensitive path, name, alias, path-segment and engine-prefix-normalized candidates; the first match wins. A normal miss returns `null`, while invalid names or malformed descriptors can throw. The result is the stored descriptor reference, not freshly queried native metadata.

### `ResolveTemporaryEntityField(strFieldName)`

Inspect typed profile mappings and a property path using the supplied `BeamPoints` profile aliases:

```js
const { GetTemporaryEntityTemplate } = require("effects/templates");

const g_BeamTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
const g_ColorTemporaryEntityFieldDescriptor = g_BeamTemporaryEntityTemplate.ResolveTemporaryEntityField("Color");
if ((g_ColorTemporaryEntityFieldDescriptor?.ValueType !== "color") || !Array.isArray(g_ColorTemporaryEntityFieldDescriptor.ValueFields)) {
	throw new Error("BeamPoints Color descriptor is invalid.");
}

const g_ModelTemporaryEntityFieldDescriptor = g_BeamTemporaryEntityTemplate.ResolveTemporaryEntityField("Model");
if ((g_ModelTemporaryEntityFieldDescriptor?.ValueType !== "model") || (g_ModelTemporaryEntityFieldDescriptor.ValueFields !== "ModelIndex")) {
	throw new TypeError("BeamPoints Model profile is not a single Model field.");
}

const g_StartPointTemporaryEntityFieldDescriptor = g_BeamTemporaryEntityTemplate.ResolveTemporaryEntityField("StartPoint");
if (g_StartPointTemporaryEntityFieldDescriptor?.Path !== "m_vecStartPoint") {
	throw new Error("BeamPoints StartPoint descriptor is invalid.");
}
```

Resolution requires a non-empty string but compares lowercase keys without trimming. It returns an existing mapping before trying property-name fallback; a normal miss returns `null`, and validation errors propagate. The checks above establish only the shown descriptor shapes, not native field availability, supported conversion, or successful creation. Returned mappings can share mutable data with the template and profile cache.

### `ResolveTemporaryEntityPropertyName(strFieldName)`

Resolve a profile alias to its first underlying field name:

```js
const { GetTemporaryEntityTemplate } = require("effects/templates");

const g_BeamTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
if (g_BeamTemporaryEntityTemplate.ResolveTemporaryEntityPropertyName("LifeTime") !== "m_fLife") {
	throw new Error("LifeTime did not resolve to its native path.");
}

if (g_BeamTemporaryEntityTemplate.ResolveTemporaryEntityPropertyName("Color") !== "Red") {
	throw new Error("A multi-field descriptor must resolve to its first component name.");
}
```

For a multi-field typed descriptor this method returns only the first profile component (`Red` in the supplied Color profile), not every component or necessarily the final native send-property path. It does not recursively resolve that component. A normal unresolved name is returned unchanged; a resolved descriptor lacking a non-empty string path/component throws. Consequently, receiving a string alone does not prove that a field exists.

### `HasTemporaryEntityField(strFieldName)`

Check required mappings before staging an effect. A successful check proves resolution only, not native compatibility or valid values:

```js
const { GetTemporaryEntityTemplate } = require("effects/templates");

const g_BeamTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
for (const strFieldName of ["Color", "EndPoint", "Model", "StartPoint"]) {
	if (!g_BeamTemporaryEntityTemplate.HasTemporaryEntityField(strFieldName)) {
		throw new Error(`BeamPoints is missing required field: ${strFieldName}`);
	}
}
```

`HasTemporaryEntityField()` returns `false` for a normal unresolved name and propagates resolver errors. Custom mappings can make otherwise unknown names resolve, so no arbitrary sentinel string is guaranteed to be absent from a mutable shared template.

### `GetTemporaryEntityFieldNames()`

List recorded field names that start with an uppercase ASCII letter and contain only ASCII letters or digits. This coarse filter does not validate full PascalCase spelling, readability, profile provenance, or native compatibility:

```js
const { GetTemporaryEntityTemplate } = require("effects/templates");

function MatchesUppercaseLeadingASCIIFieldNamePattern(strFieldName) {
	return /^[A-Z][A-Za-z0-9]*$/.test(strFieldName);
}

const g_BeamTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
const g_vecUppercaseLeadingTemporaryEntityFieldNames = g_BeamTemporaryEntityTemplate.GetTemporaryEntityFieldNames().filter(MatchesUppercaseLeadingASCIIFieldNamePattern);
console.log(`BeamPoints uppercase-leading fields:\n${g_vecUppercaseLeadingTemporaryEntityFieldNames.join("\n")}`);
```

The getter returns the live internal name array, not a copy or a fresh native enumeration. Direct mutation can desynchronize it from `Fields`. Here, `filter()` creates a separate array and leaves the source unchanged; copy the array before operations such as sorting. Recorded names retain the first spelling inserted for each normalized key and can become stale after changes to the mapping inputs.

### Pre-create hook methods

Install, invoke, and remove a callback on a separate template using a minimal test object. No native creation occurs, and the separate hook array avoids invoking callbacks from the default collection:

```js
const { TemporaryEntityTemplate } = require("effects/templates");

const g_flMaximumBeamLifetimeSeconds = 2;

function IsBeamLifetimeAllowed(TemporaryEntity) {
	return TemporaryEntity.GetTemporaryEntityPropertyFloat("LifeTime") <= g_flMaximumBeamLifetimeSeconds;
}

const g_BeamTemporaryEntityTemplate = new TemporaryEntityTemplate("BeamPoints");
g_BeamTemporaryEntityTemplate.RegisterTemporaryEntityPreCreateHook(IsBeamLifetimeAllowed);

try {
	const bBeamCreationAllowed = g_BeamTemporaryEntityTemplate.InvokeTemporaryEntityPreCreateHooks({
		GetTemporaryEntityPropertyFloat() {
			return 1.5;
		},
	}, undefined);
	if (!bBeamCreationAllowed) {
		throw new Error("The valid beam was unexpectedly cancelled.");
	}
} finally {
	if (!g_BeamTemporaryEntityTemplate.UnregisterTemporaryEntityPreCreateHook(IsBeamLifetimeAllowed)) {
		throw new Error("The BeamPoints pre-create callback could not be removed.");
	}
}
```

Registration rejects a duplicate function in this template's pre-create array. Removal throws when the function is absent. The `finally` block attempts cleanup even if invocation throws; cleanup failure can replace the earlier exception. The `effects/hooks.RegisterTemporaryEntityPreCreateHook()` helper returns a handle for explicit removal, not a guarantee of automatic plugin cleanup. This isolated dispatch example still requires successful template/profile construction and does not validate native values or delivery.

### Post-create hook methods

Exercise post-create callback dispatch with a minimal test object, then remove the callback by identity. This example performs no native send; a separate template prevents dispatch to unrelated callbacks in the default collection:

```js
const { TemporaryEntityTemplate } = require("effects/templates");

let g_strObservedTemporaryEntityName = null;

function RecordTemporaryEntityName(TemporaryEntity) {
	g_strObservedTemporaryEntityName = TemporaryEntity.Name;
}

const g_BeamTemporaryEntityTemplate = new TemporaryEntityTemplate("BeamPoints");
g_BeamTemporaryEntityTemplate.RegisterTemporaryEntityPostCreateHook(RecordTemporaryEntityName);

try {
	g_BeamTemporaryEntityTemplate.InvokeTemporaryEntityPostCreateHooks({ Name: "BeamPoints" }, undefined);

	if (g_strObservedTemporaryEntityName !== "BeamPoints") {
		throw new Error("The BeamPoints post-create callback did not run.");
	}
} finally {
	if (!g_BeamTemporaryEntityTemplate.UnregisterTemporaryEntityPostCreateHook(RecordTemporaryEntityName)) {
		throw new Error("The BeamPoints post-create callback could not be removed.");
	}
}
```

`InvokeTemporaryEntityPostCreateHooks()` ignores callback return values, including promises, and returns `undefined` on normal completion. It traverses the live array in order; an exception stops traversal and propagates, while callback-driven array mutation can alter traversal. The `finally` block attempts removal even after a dispatch failure; a removal exception can replace an earlier error. Template/profile construction must succeed before registration. A direct dispatch is not evidence of native creation or client delivery.

### `CreateTemporaryEntity(PropertyValues, Recipients, flEffectDelay, bReliableDelivery)`

Request native playback by passing native `BeamPoints` send-property names and values. The native API validates and converts supported values to the selected send-property types, but this path bypasses `TemporaryEntity`'s staged accessors and pre/post hooks. Run only with an initialized server, a compatible property layout, and an available model asset; this example uses native default recipients:

```js
const { PrecacheModel } = require("effects");
const { GetTemporaryEntityTemplate } = require("effects/templates");

const g_BeamTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
const g_nBeamModelIndex = PrecacheModel("materials/sprites/laserbeam.vmt", true);
const g_bBeamCreationResult = g_BeamTemporaryEntityTemplate.CreateTemporaryEntity({
	a: 255,
	b: 255,
	g: 180,
	m_fEndWidth: 2,
	m_fLife: 0.4,
	m_fWidth: 2,
	m_nModelIndex: g_nBeamModelIndex,
	m_vecEndPoint: [256, 0, 64],
	m_vecStartPoint: [0, 0, 64],
	r: 80,
}, undefined, 0, true);
if (!g_bBeamCreationResult) {
	throw new Error("The native BeamPoints sender returned an unexpected false result.");
}
```

This method passes property names and values to the native sender's validated property application. `true` means the native playback call returned, not that a recipient received the effect; reliability is not an acknowledgement. Native validation errors propagate, and the wrapper neither converts failure results nor rolls back prior side effects such as model precaching. The coordinate arrays use the native vector-input contract. Use `TemporaryEntity` from `effects` when you need its staged typed accessors and pre/post hooks; the direct template method does not run those hooks.

## Errors and lifecycle

- Use template lookup, field mutation, hook dispatch, and creation in the initialized server/game-thread context. These operations run synchronously on their caller; they do not schedule work, provide concurrent access to the live containers, or await callback promises.
- Use native temporary-entity names such as `BeamPoints`; use `CTEBeamPoints` only where a server class name is explicitly requested.
- Field methods require non-empty string names. They do not coerce numbers, booleans, objects, or `null`.
- Hook registration rejects non-functions and duplicate function references within a phase; removal throws for an absent reference. Dispatch exceptions propagate, and promises are not awaited.
- The default collection retains templates and their callback arrays within the module instance; this does not establish per-plugin isolation or automatic cleanup. Explicitly unregister callbacks owned by your plugin during unload. Rebuilding fields and cache hits do not clear hook arrays.
- `GetTemporaryEntityFieldNames()`, `PreCreateHooks`, `PostCreateHooks`, `Fields`, and `Properties` are live JavaScript containers, not defensive snapshots.
- Direct template `CreateTemporaryEntity()` passes property names and values through native validation and type conversion; it does not run `TemporaryEntity` staging or managed pre/post hooks. Use `TemporaryEntity` from `effects` for its staged accessors and managed lifecycle hooks.
- Descriptor/profile references can be shared. Do not treat copied metadata as current native state, successful field resolution as native validation, or a successful playback return as client delivery. Cache population and field rebuilding can partially update state before throwing.

## Related modules

- [`effects`](effects.md) exposes temporary-entity discovery, precaching, and managed root helpers.
- [TemporaryEntity guide](effects-temp-entity.md) documents typed mutable staging and managed creation exported through `effects`.
- [`effects/fields`](effects-fields.md) owns the packaged readable field profiles.
- [`effects/hooks`](effects-hooks.md) wraps template callback registration in handles with explicit removal methods.
