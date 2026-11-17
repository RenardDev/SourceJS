# `require("effects/fields")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

`effects/fields` loads packaged temporary-entity field profiles for `TemporaryEntityTemplate`. It resolves configured field aliases, sendprop paths, and type groups for a requested SDK branch; loading a profile does not validate it against a live engine entity.

Missing index or field files, invalid JSON or checked index structure, branches without an indexed group array, and invalid required string arguments throw JavaScript errors. A class with no matching definitions can still yield empty `Fields` and `Types` objects; an empty result is not proof that the native class exists or is supported.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Data shapes](#data-shapes)
- [Examples](#examples)
- [Errors and lifecycle](#errors-and-lifecycle)
- [Related modules](#related-modules)

## Location and purpose

[`packages/sourcejs/effects/fields.js`](../../packages/sourcejs/effects/fields.js) implements the loader. It prefixes `effects/index.json` and indexed profile paths with the runtime source-data directory, normalizing slashes while preserving a leading UNC pair (`//server/share`). This is lexical path joining, not a directory-containment check: trusted index/profile files are required, and indexed `..` components are not rejected. The packaged layout supplies [`addons/sourcejs/data/sourcejs/effects/index.json`](../../packaging/runtime/addons/sourcejs/data/sourcejs/effects/index.json); cached results may avoid subsequent file reads.

Use this module when a plugin must inspect field-profile availability, resolve readable effect fields for the running SDK, or diagnose the raw packaged profiles before constructing a temporary entity.

## Import

```js
const {
	ClearEffectsFieldCache,
	GetTemporaryEntityFieldData,
	GetTemporaryEntityFieldDefinition,
	GetTemporaryEntityFieldGroups,
	GetSupportedSDKBranches,
} = require("effects/fields");
```

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| [`ClearEffectsFieldCache`](#cleareffectsfieldcache) | `ClearEffectsFieldCache()` | Clears this module instance's group/definition maps and drops its index/aggregate cache references; returns `true`. Does not reload files or invalidate objects already held by callers. |
| [`GetTemporaryEntityFieldData`](#gettemporaryentityfielddata) | `GetTemporaryEntityFieldData()` | Shared cached parsed profile data grouped by own index group keys and class name; not raw INI text or a live file view. Loading may throw. |
| [`GetTemporaryEntityFieldDefinition`](#gettemporaryentityfielddefinitionstrtemporaryentityclassname-strsdkbranch) | `GetTemporaryEntityFieldDefinition(strTemporaryEntityClassName, strSDKBranch?)` | Shared cached merged `{ Fields, Types }` for a class/branch pair. Can contain empty maps when no definition matches; does not validate the native class. |
| [`GetTemporaryEntityFieldGroups`](#gettemporaryentityfieldgroupsstrsdkbranch) | `GetTemporaryEntityFieldGroups(strSDKBranch?)` | New array containing `common` followed by the indexed branch groups in order; no deduplication. Throws if the indexed branch value is not an array. |
| [`GetSupportedSDKBranches`](#getsupportedsdkbranches) | `GetSupportedSDKBranches()` | Same frozen array of 24 hard-coded Source 1 SDK branch names on each call. Does not inspect the installed index or validate its profiles. |

When `strSDKBranch` is omitted or `undefined`, both branch-dependent functions read `globals.GetGlobalVariables().SDKBranch`. Explicit `null` is invalid. Branch names must be non-empty strings; they are not trimmed or case-normalized. Treat returned cached objects as read-only: caller mutation can affect later calls.

## Data shapes

### Merged definition

`GetTemporaryEntityFieldDefinition()` merges `common` first, followed by every branch-specific group in index order. Later entries replace earlier entries with the same key in the corresponding map; a group without the requested class contributes nothing. Index members, branch/group lookups, and class definitions use own entries only; inherited properties do not satisfy the schema or contribute definitions. Group, class, field, and type entries are written as own data properties without invoking inherited setters or changing the returned objects' ordinary prototypes:

```js
const { GetTemporaryEntityFieldDefinition } = require("effects/fields");

const g_BeamPointsFieldDefinition = GetTemporaryEntityFieldDefinition("CTEBeamPoints", "l4d2");
console.log(g_BeamPointsFieldDefinition.Fields.StartPoint); // m_vecStartPoint
console.log(g_BeamPointsFieldDefinition.Fields.LifeTime); // m_fLife
console.log(g_BeamPointsFieldDefinition.Types.Color); // { ValueFields: ["Red", "Green", "Blue", "Alpha"], Type: "color" }
console.log(g_BeamPointsFieldDefinition.Types.Model); // { ValueFields: "ModelIndex", Type: "model" }
```

`Fields` maps a profile alias to its configured sendprop path. `Types` maps a typed alias to a descriptor with `Type` and `ValueFields`; the latter is one field reference or an ordered array of references. Profile aliases are trimmed, an underscore before a lowercase letter or digit is removed and that character is uppercased (`start_point` becomes `StartPoint`), remaining underscores are removed, and the first character is capitalized. Use compact lowercase type discriminators such as `color` and `model` in project-owned profiles; the parser copies discriminator text without normalizing or validating it. Alias keys remain PascalCase and do not acquire type prefixes. These returned keys and descriptor property names are API data, not local-variable naming examples. Merging copies descriptors and paths without validating native sendprops or applying conversions.

### Raw group data

`GetTemporaryEntityFieldData()` returns parsed per-group records instead of merging definitions; it does not preserve original INI text, comments, or formatting:

```js
const { GetTemporaryEntityFieldData } = require("effects/fields");

function IsTemporaryEntityStartPointField(vecField) {
	return vecField[0] === "StartPoint";
}

function IsTemporaryEntityColorField(vecField) {
	return vecField[0] === "Color";
}

const g_TemporaryEntityFieldData = GetTemporaryEntityFieldData();
const g_CommonBeamPointsFieldProfile = g_TemporaryEntityFieldData.common.CTEBeamPoints;
console.log(g_CommonBeamPointsFieldProfile.Fields.find(IsTemporaryEntityStartPointField));
// ["StartPoint", "m_vecStartPoint"]
console.log(g_CommonBeamPointsFieldProfile.Types.find(IsTemporaryEntityColorField));
// ["Color", "color", ["Red", "Green", "Blue", "Alpha"]]
```

Use these parsed records for diagnostics, profile tooling, and class inventories. `Fields` contains `[alias, path]` entries; `Types` contains `[PascalCase alias, profile type discriminator, referenceOrReferences]` entries. Do not mutate cached records or their nested arrays. Use the merged form when resolving fields for a selected SDK.

## Examples

### `GetSupportedSDKBranches()`

Check whether the running SDK appears in the module's declared branch list before installing profile-dependent behavior. This check does not load or validate installed profiles:

```js
const { GetGlobalVariables } = require("globals");
const { GetSupportedSDKBranches } = require("effects/fields");

const g_strSDKBranch = GetGlobalVariables().SDKBranch;
const g_vecSupportedSDKBranches = GetSupportedSDKBranches();
if (!g_vecSupportedSDKBranches.includes(g_strSDKBranch)) {
	throw new Error(`SDK branch is absent from the declared effects branch list: ${g_strSDKBranch}`);
}

console.log(`Effects declares ${g_vecSupportedSDKBranches.length} SDK branch names.`);
```

The returned array is frozen. Recognition does not guarantee a branch entry in the installed index. `GetTemporaryEntityFieldGroups()` checks that entry and returns its group names; it does not load their INI files or verify a particular class.

Report index group mappings for the declared branch list without hardcoding branch names. A successful mapping does not establish INI availability or live-engine support:

```js
const { GetTemporaryEntityFieldGroups, GetSupportedSDKBranches } = require("effects/fields");

function CreateSDKGroupRecord(strSDKBranch) {
	try {
		return { HasGroupMapping: true, SDKBranch: strSDKBranch, FieldGroups: GetTemporaryEntityFieldGroups(strSDKBranch) };
	} catch (ErrorValue) {
		return { HasGroupMapping: false, ErrorMessage: String(ErrorValue), SDKBranch: strSDKBranch };
	}
}

const g_vecSDKGroupRecords = GetSupportedSDKBranches().map(CreateSDKGroupRecord);
console.log(g_vecSDKGroupRecords);
```

### `GetTemporaryEntityFieldGroups(strSDKBranch?)`

Check the shipped index's Left 4 Dead 2 precedence. A customized index can legitimately use another order; this assertion intentionally requires the shipped mapping, not successful INI loading:

```js
const { GetTemporaryEntityFieldGroups } = require("effects/fields");

const g_vecTemporaryEntityFieldGroups = GetTemporaryEntityFieldGroups("l4d2");
if (g_vecTemporaryEntityFieldGroups.join(" -> ") !== "common -> l4d2") {
	throw new Error(`Unexpected L4D2 effects profile order: ${g_vecTemporaryEntityFieldGroups.join(", ")}`);
}
```

Report a group-mapping lookup failure for the running SDK. This preflight does not establish that a particular temporary entity or sendprop exists:

```js
const { GetGlobalVariables } = require("globals");
const { GetTemporaryEntityFieldGroups } = require("effects/fields");

const g_strSDKBranch = GetGlobalVariables().SDKBranch;

try {
	const vecFieldGroups = GetTemporaryEntityFieldGroups(g_strSDKBranch);
	console.log(`Effects profile groups: ${vecFieldGroups.join(", ")}`);
} catch (ErrorValue) {
	throw new Error(`Cannot report effects group mapping for ${g_strSDKBranch}: ${String(ErrorValue)}`);
}
```

`GetTemporaryEntityFieldGroups()` returns a new ordered array. Editing that array does not change the index or later lookups.

### `GetTemporaryEntityFieldDefinition(strTemporaryEntityClassName, strSDKBranch?)`

Check the profile aliases used by this BeamPoints example before constructing it. This does not validate native sendprops, the model resource, or recipients. Run only in an initialized server context with a valid connected recipient at index `1` and the model available; successful creation does not prove client delivery or visibility:

```js
const { TemporaryEntity } = require("effects");
const { GetTemporaryEntityFieldDefinition } = require("effects/fields");
const { Vector } = require("mathlib");

const g_BeamPointsFieldDefinition = GetTemporaryEntityFieldDefinition("CTEBeamPoints");
const g_vecRequiredBeamPointsFields = ["Color", "EndPoint", "LifeTime", "Model", "StartPoint", "StartWidth"];
for (const strFieldName of g_vecRequiredBeamPointsFields) {
	if (!Object.prototype.hasOwnProperty.call(g_BeamPointsFieldDefinition.Fields, strFieldName) && !Object.prototype.hasOwnProperty.call(g_BeamPointsFieldDefinition.Types, strFieldName)) {
		throw new Error(`CTEBeamPoints is missing required field: ${strFieldName}`);
	}
}

const g_BeamTemporaryEntity = new TemporaryEntity("BeamPoints", {
	Color: [80, 200, 255, 255],
	EndPoint: new Vector(256, 0, 64),
	LifeTime: 0.4,
	Model: "materials/sprites/laserbeam.vmt",
	StartPoint: new Vector(0, 0, 64),
	StartWidth: 2,
});
if (!g_BeamTemporaryEntity.CreateTemporaryEntity([1])) {
	throw new Error("BeamPoints creation returned false; a hook may have cancelled it.");
}
```

Inspect a typed descriptor's shape before using it. This only checks the type name and component count, not the referenced field names, native sendprops, or plugin configuration:

```js
const { GetTemporaryEntityFieldDefinition } = require("effects/fields");

const g_BeamPointsFieldDefinition = GetTemporaryEntityFieldDefinition("CTEBeamPoints", "l4d2");
const g_BeamPointsColorTypeDefinition = g_BeamPointsFieldDefinition.Types.Color;
if (!Object.prototype.hasOwnProperty.call(g_BeamPointsFieldDefinition.Types, "Color") || (g_BeamPointsColorTypeDefinition === null) || (typeof g_BeamPointsColorTypeDefinition !== "object") || Array.isArray(g_BeamPointsColorTypeDefinition)) {
	throw new TypeError("CTEBeamPoints must define a color descriptor.");
}

if ((g_BeamPointsColorTypeDefinition.Type !== "color") || !Array.isArray(g_BeamPointsColorTypeDefinition.ValueFields) || (g_BeamPointsColorTypeDefinition.ValueFields.length !== 4)) {
	throw new TypeError("CTEBeamPoints color profile must contain four Color components.");
}
```

Definitions are cached under the concatenated key `strSDKBranch:strTemporaryEntityClassName` and returned by reference. This is not a collision-proof tuple encoding for arbitrary colon-containing strings. Mutating a definition affects subsequent readers of that cache entry and does not rebuild an existing `TemporaryEntityTemplate`; nested component arrays can also be shared with parsed records and template descriptors. Treat all returned data as read-only.

### `GetTemporaryEntityFieldData()`

List class-record keys in the L4D2 groups, including records with no parsed fields. `GetTemporaryEntityFieldData()` loads all indexed groups, so a failure in an unrelated group's files can also stop this report. These are profile class names, not a live-engine class inventory:

```js
const { GetTemporaryEntityFieldData, GetTemporaryEntityFieldGroups } = require("effects/fields");

const g_TemporaryEntityFieldData = GetTemporaryEntityFieldData();
const g_setTemporaryEntityClassNames = new Set();
for (const strFieldGroupName of GetTemporaryEntityFieldGroups("l4d2")) {
	for (const strTemporaryEntityClassName of Object.keys(g_TemporaryEntityFieldData[strFieldGroupName])) {
		g_setTemporaryEntityClassNames.add(strTemporaryEntityClassName);
	}
}

console.log(`L4D2 effects field profiles: ${g_setTemporaryEntityClassNames.size}`);
console.log([...g_setTemporaryEntityClassNames].sort().join("\n"));
```

Check that parsed field paths are nonempty strings before deploying a custom profile. This is only a shape check: it does not validate typed references, native sendprops, or whether a path is meaningful for the selected SDK:

```js
const { GetTemporaryEntityFieldData } = require("effects/fields");

const g_vecInvalidTemporaryEntityFieldReferences = [];
for (const [strFieldGroupName, TemporaryEntityFieldProfiles] of Object.entries(GetTemporaryEntityFieldData())) {
	for (const [strTemporaryEntityClassName, FieldProfile] of Object.entries(TemporaryEntityFieldProfiles)) {
		for (const [strFieldName, strPropertyPath] of FieldProfile.Fields) {
			if ((typeof strPropertyPath !== "string") || (strPropertyPath.length === 0)) {
				g_vecInvalidTemporaryEntityFieldReferences.push(`${strFieldGroupName}/${strTemporaryEntityClassName}.${strFieldName}`);
			}
		}
	}
}

if (g_vecInvalidTemporaryEntityFieldReferences.length > 0) {
	throw new Error(`Invalid effects fields:\n${g_vecInvalidTemporaryEntityFieldReferences.join("\n")}`);
}
```

The returned aggregate and its group/class records are shared cached JavaScript objects, not live file views. Keep them read-only; this API provides no per-caller ownership, isolated customization, or transactional restoration mechanism.

### `ClearEffectsFieldCache()`

After an administrator finishes replacing profile files, clear this module instance's caches and request a definition again. Clearing alone performs no file reads; a later load can fail and there is no automatic rollback to the previous cache. Coordinate this operation with other users of the same module instance:

```js
const { ClearEffectsFieldCache, GetTemporaryEntityFieldDefinition } = require("effects/fields");

const g_PreviousBeamPointsFieldDefinition = GetTemporaryEntityFieldDefinition("CTEBeamPoints", "l4d2");
if (!ClearEffectsFieldCache()) {
	throw new Error("Effects field caches were not cleared.");
}

const g_ReloadedBeamPointsFieldDefinition = GetTemporaryEntityFieldDefinition("CTEBeamPoints", "l4d2");
if (g_ReloadedBeamPointsFieldDefinition === g_PreviousBeamPointsFieldDefinition) {
	throw new Error("Effects field definition still has the previous object identity.");
}
```

The identity check only detects reuse of the previous definition object; it does not prove expected file contents or native compatibility. Existing references remain valid JavaScript objects and can still share nested data with old templates. `ClearEffectsFieldCache()` affects later reads through this module instance; it neither mutates retained objects nor rebuilds cached `TemporaryEntityTemplate` instances.

## Errors and lifecycle

- Pass exact non-empty strings for branch and class names. The module does not trim, lowercase, or alias them.
- Use native server class names such as `CTEBeamPoints`, not temporary-entity names such as `BeamPoints`, with `GetTemporaryEntityFieldDefinition()`.
- A branch listed by `GetSupportedSDKBranches()` can still lack an array-valued entry in the installed branch index; `GetTemporaryEntityFieldGroups()` then throws `ReferenceError`. An empty branch array is valid and yields only `common`.
- A missing index or INI file is a deployment error and throws `ReferenceError`.
- Failed index object/`Branches`/`Groups` checks or a non-array field-group file list throw `TypeError`; malformed JSON and filesystem reads can throw separately. These checks are not exhaustive schema validation. The INI parser skips some unrecognized lines and incomplete type sections rather than rejecting the file.
- A class missing from all selected groups yields empty definition maps, not a native class lookup error. Validate the fields your caller needs; these APIs do not verify sendprops or perform conversions.
- Clear the field cache before obtaining new definitions after a coordinated file update. Existing templates are not rebuilt, and retained objects can share nested arrays. Keep cached data read-only and use the template module's lifecycle contract when replacing templates; clearing field data alone does not reload an entire plugin or engine state.

## Related modules

- [`effects`](effects.md) exposes native temporary-entity discovery and high-level geometry helpers.
- [The `TemporaryEntity` guide](effects-temp-entity.md) explains staging typed values and creating temporary entities through `effects`.
- [`effects/templates`](effects-templates.md) turns these definitions into runtime field descriptors.
