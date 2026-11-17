# `require("weapons/data")`

> Warning: this page documents synchronous profile parsing and a mutable per-plugin cache. Validate branch selectors
> before passing them to path functions, and decide explicitly when invalidating every cached profile with
> `ClearCache()`.
>
> AI navigation: read Branch Selection and Cache and Ownership before running examples; distinguish raw INI tokens
> from the normalized JavaScript fields in Profile Shape.

`weapons/data` reads SourceJS weapon profiles from `<SourceDataRoot>/weapons/<strBranch>.ini`. Profiles describe
selected-game class prefixes, special-name mappings, projectile mappings, tags, ammo properties and per-weapon
metadata. They complement the compiled SDK API; they do not replace live weapon entities or engine weapon scripts.

The implementation is `packages/sourcejs/weapons/data.js`. It parses only the requested branch file, never substitutes
another game's profile and never synthesizes data for an unsupported branch.

## Contents

- [Import](#import)
- [Export Reference](#export-reference)
- [Branch Selection](#branch-selection)
- [Loading a Packaged Profile](#loading-a-packaged-profile)
- [Cache and Ownership](#cache-and-ownership)
- [Building a Live Catalog](#building-a-live-catalog)
- [Formatting and Lookup](#formatting-and-lookup)
- [Profile Shape](#profile-shape)
- [Parsing Raw Configuration](#parsing-raw-configuration)
- [Parsing a Weapon Profile](#parsing-a-weapon-profile)
- [Errors and Security](#errors-and-security)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const {
	SUPPORTED_BRANCHES,
	GetAll,
	GetClasses,
	ClearCache,
	GetDataPath,
	FormatName,
	Get,
	Has,
	Load,
	GetNames,
	ParseConfigurationObject,
	ParseWeaponINI,
	GetProjectiles,
	GetProperties,
	GetSpecialNames,
	GetTags,
} = require("weapons/data");
```

There is no aggregate namespace, generated alias or fallback implementation. Requiring the module outside the
SourceJS runtime fails while resolving its `filesystem`, `globals` and `paths` dependencies.

## Export Reference

| Export | Return | Ownership and effect |
| --- | --- | --- |
| `SUPPORTED_BRANCHES` | frozen `string[]` | Static list of profiles shipped in the runtime package. |
| `GetDataPath(strBranch?)` | `string` | Computes a normalized slash path, preserving a leading `//` UNC root; performs no existence check. |
| `Has(strBranch?)` | `boolean` | Performs a synchronous physical-file existence check. |
| `Load(strBranch?)` | profile object | Returns the mutable cached identity or synchronously reads and parses disk. |
| `ClearCache()` | `true` | Drops every branch entry from this plugin context's cache. |
| `GetAll(strBranch?)` | weapon record array | Live `Load(strBranch).Weapons` identity. |
| `GetNames(strBranch?)` | `string[]` | Fresh short-name array built from current live records. |
| `GetClasses(strBranch?)` | `string[]` | Fresh class-name array built from current live records. |
| `GetTags(strBranch?)` | tag array | Live `Load(strBranch).Tags` identity. |
| `GetProperties(strBranch?)` | property record | Live `Load(strBranch).Properties` identity. |
| `GetSpecialNames(strBranch?)` | special-name record | Live `Load(strBranch).SpecialNames` identity. |
| `GetProjectiles(strBranch?)` | projectile record | Live `Load(strBranch).Projectiles` identity. |
| `FormatName(strWeaponName, strBranch?)` | `string` | Applies special-name mappings, projectile mappings and class prefix. |
| `Get(strWeaponName, strBranch?)` | weapon record or `null` | Returns a matching live cached record. |
| `ParseConfigurationObject(strText)` | null-prototype record | Parses raw two-level INI records. |
| `ParseWeaponINI(strText)` | normalized profile | Parses and normalizes profile text without adding `Branch` or `Path`. |

Every optional `strBranch` defaults to the current `require("globals").GetGlobalVariables().SDKBranch`. The default is evaluated on each
call. Explicit `strBranch` values are trimmed and lowercased. Alternative spellings such as `teamfortress2` are not
translated to `tf2`.

## Branch Selection

`SUPPORTED_BRANCHES` contains exactly:

- `blade`;
- `bms`;
- `csgo`;
- `css`;
- `dods`;
- `gmod`;
- `hl2dm`;
- `l4d2`;
- `tf2`.

This list describes packaged profile files, not every branch accepted by the build system. A package may also be
incomplete or locally modified, so membership and physical existence answer different questions.

`strBranch` is a basename selector, not an arbitrary path. After trimming and lowercasing, the module accepts only letters,
digits and underscores; path separators, dots and other characters raise `TypeError`. The selector does not have to be
present in `SUPPORTED_BRANCHES`, so use list membership when a caller must select only a packaged profile.

## Loading a Packaged Profile

This controller validates a current or caller-selected branch, verifies the exact file and returns the loaded profile
together with its physical path:

```js
const {
	SUPPORTED_BRANCHES,
	GetDataPath,
	Has,
	Load,
} = require("weapons/data");
const { GetGlobalVariables } = require("globals");

function RequirePackagedWeaponProfile(strBranch = GetGlobalVariables().SDKBranch) {
	if (typeof strBranch !== "string") {
		throw new TypeError("Weapon profile branch must be a string");
	}

	const strNormalizedBranch = strBranch.trim().toLowerCase();
	if (strNormalizedBranch.length === 0) {
		throw new TypeError("Weapon profile branch must not be empty");
	}

	if (!SUPPORTED_BRANCHES.includes(strNormalizedBranch)) {
		throw new Error(`Weapon profile is not packaged for ${strNormalizedBranch}`);
	}

	const strPath = GetDataPath(strNormalizedBranch);
	if (!Has(strNormalizedBranch)) {
		throw new Error(`Packaged weapon profile is missing: ${strPath}`);
	}

	return { Profile: Load(strNormalizedBranch), Branch: strNormalizedBranch, Path: strPath };
}
```

The function performs no work until called. `Has(strBranch)` does not validate profile contents; `Load(strBranch)` can still throw a
parser or normalization error.

## Cache and Ownership

`Load(strBranch)` stores one mutable profile object for each normalized branch in this plugin context. Repeated `Load("l4d2")`
and `Load(" L4D2 ")` calls return the same object. Mutating that object or a live member returned by `GetAll(strBranch)`,
`GetTags(strBranch)`, `GetProperties(strBranch)`, `GetSpecialNames(strBranch)` or `GetProjectiles(strBranch)` changes
subsequent results until the cache is cleared.

`ClearCache()` removes all branch entries, not one selected branch. Existing references remain valid ordinary JavaScript
objects but become detached from future helper calls. The next `Load(strBranch)` reparses disk and returns a new identity.

Use an explicit administrative operation when a plugin needs to refresh profiles after changing files:

```js
const {
	ClearCache,
	Load,
} = require("weapons/data");

function RefreshWeaponProfiles(strBranch) {
	const PreviousProfile = Load(strBranch);
	ClearCache();

	const CurrentProfile = Load(strBranch);

	return { IdentityChanged: CurrentProfile !== PreviousProfile, CurrentProfile, PreviousProfile };
}
```

Coordinate this operation with every subsystem in the same plugin context that retains profile or weapon-record
references. There is no disposal method because profiles contain JavaScript data rather than native handles.

## Building a Live Catalog

The collection helpers can build a searchable catalog while preserving their exact ownership semantics:

```js
const {
	GetAll,
	GetClasses,
	GetNames,
	GetProjectiles,
	GetProperties,
	GetSpecialNames,
	GetTags,
} = require("weapons/data");

function BuildLiveWeaponCatalog(strBranch) {
	const vecWeapons = GetAll(strBranch);
	const mapWeaponsByClassName = new Map();
	for (const Weapon of vecWeapons) {
		mapWeaponsByClassName.set(Weapon.ClassName, Weapon);
	}

	return {
		MapWeaponsByClassName: mapWeaponsByClassName,
		Properties: GetProperties(strBranch),
		Projectiles: GetProjectiles(strBranch),
		SpecialNames: GetSpecialNames(strBranch),
		ClassNames: GetClasses(strBranch),
		Names: GetNames(strBranch),
		Tags: GetTags(strBranch),
		Weapons: vecWeapons,
	};
}
```

`Weapons`, `Tags`, `Properties`, `SpecialNames`, `Projectiles` and the map's weapon values are live cached data.
`ClassNames`, `Names` and the `Map` structure are derived collections built by this call. Rebuild the catalog after
`ClearCache()`.

## Formatting and Lookup

`FormatName(strWeaponName, strBranch?)` trims and lowercases caller input, applies `SpecialNames`, then `Projectiles`, and finally prepends
`Properties.Prefix` when needed. A special-name or projectile mapping can therefore redirect a short name before
class lookup. If the final mapped name is empty, it returns `""` without adding a prefix. Mapping keys retain their input spelling; use lowercase keys when they must match this lookup.

`Get(strWeaponName, strBranch?)` uses the formatted class and also checks the normalized input against each record's `ClassName`, `Name`,
`BaseName` and `Names`. It returns the live record or `null`.

For an unmodified parsed record, this resolver copies its scalar metadata and collections into a summary suitable for
plugin messages or cross-plugin serialization:

```js
const {
	FormatName,
	Get,
} = require("weapons/data");

function CreateWeaponRecordSummary(Record) {
	return {
		AmmoProperty: Record.AmmoProperty,
		BaseName: Record.BaseName,
		ClassName: Record.ClassName,
		Classes: Record.Classes.slice(),
		Clip: Record.Clip,
		Cost: Record.Cost,
		Data: Object.assign(Object.create(null), Record.Data),
		ID: Record.ID,
		ItemDefinitionIndex: Record.ItemDefinitionIndex,
		MaximumAmmo: Record.MaximumAmmo,
		Name: Record.Name,
		Names: Record.Names.slice(),
		ParentClass: Record.ParentClass,
		SecondaryAmmoProperty: Record.SecondaryAmmoProperty,
		SecondaryMaximumAmmo: Record.SecondaryMaximumAmmo,
		Slot: Record.Slot,
		Tags: Record.Tags.slice(),
		Type: Record.Type,
	};
}

function ResolveWeaponMetadata(strWeaponName, strBranch) {
	const strClassName = FormatName(strWeaponName, strBranch);
	const Record = Get(strWeaponName, strBranch);
	let Weapon = null;
	if (Record !== null) {
		Weapon = CreateWeaponRecordSummary(Record);
	}

	return { Weapon, ClassName: strClassName };
}
```

The `Classes`, `Names` and `Tags` arrays and raw `Data` record are copied deliberately, but this is not a recursive
clone. If callers replace scalar fields or raw `Data` values with objects, those nested objects remain shared.
The live `Script` accessor is omitted because its script record owns `KeyValues` state in the current plugin context.

## Profile Shape

`Load(strBranch)` returns the normalized result with two additional mutable fields:

| Field | Type and source |
| --- | --- |
| `Branch` | Normalized branch added by `Load(strBranch)`. |
| `Path` | Exact path added by `Load(strBranch)`. |
| `Properties` | Ordinary `{ AmmoProperty, MyWeaponsProperty, Prefix }` record. |
| `SpecialNames` | Raw `special names` value, normally a parsed section record; null/absent becomes an empty null-prototype record. |
| `Projectiles` | Raw `projectiles` value, normally a parsed section record; null/absent becomes an empty null-prototype record. |
| `Tags` | Live unique profile tags in first-seen order. |
| `Weapons` | Live normalized weapon-record array. |

`ParseWeaponINI(strText)` returns the last five fields only. It has no source branch or path to attach.

Each normalized weapon record contains:

| Field | Value |
| --- | --- |
| `AmmoProperty` | Raw `ammo_property`, or `null` when empty/absent. |
| `BaseName` | Nested `[weapons]` section name exactly as parsed. |
| `ClassName` | `BaseName` with the configured prefix when needed. |
| `Classes` | New one-element array containing `ClassName`. |
| `Clip` | Finite numeric `clip`, or `null` when empty/absent. |
| `Cost` | Finite numeric `cost`, or `null` when empty/absent. |
| `Data` | Live null-prototype raw-record identity containing every parsed key. |
| `ID` | Raw scalar `id`, or `null` when empty/absent. |
| `ItemDefinitionIndex` | Numeric `id` when finite; otherwise `null`. |
| `MaximumAmmo` | Raw `maximum_ammo`, or `null` when empty/absent. |
| `Name` | `ClassName` with the configured prefix removed. |
| `Names` | New `[Name, BaseName]` array. |
| `ParentClass` | Raw `parent_class`, or `null` when empty/absent. |
| `Script` | Live getter for the current game's `weapons/scripts` record. |
| `SecondaryAmmoProperty` | Raw `secondary_fire_ammo_property`, or `null`. |
| `SecondaryMaximumAmmo` | Raw `secondary_fire_maximum_ammo`, or `null`. |
| `Slot` | Raw `slot`, or `null` when empty/absent. |
| `Tags` | Deduplicated comma-separated tags, defaulting to `["all"]`. |
| `Type` | Raw `type`, or `null` when empty/absent. |

Only `Clip` and `Cost` require finite numbers. Other scalar metadata can remain a `number` or string according to the
profile schema. Tags preserve spelling and case while removing duplicates inside one weapon and then across the profile.

These input names are the current case-sensitive INI schema. Normalized JavaScript fields use PascalCase; `Data`
retains the original input keys instead of renaming them. A schema migration must update the parser, packaged files
and their consumers together.

Missing property names default to `m_iAmmo.`, `m_hMyWeapons.` and `weapon_`.

Property names, prefixes and optional mapping contents are not type-checked by normalization. Supply string property
names and prefixes, and record-valued mappings with string destinations. Malformed values may be accepted while
parsing and fail during name formatting or later use.

Accessing `Record.Script` calls `require("weapons/scripts").Load()` with the class name captured when that record is normalized.
Changing `Record.ClassName` later does not retarget this getter. The lookup still uses the current game and can throw
when a caller loads another branch's profile or the corresponding game script file is absent.

## Parsing Raw Configuration

`ParseConfigurationObject(strText)` accepts assignments at the root, top-level `[section]` headers and one-level
`[[nested section]]` headers under the most recent top-level section. Every root, section and nested record has a null
prototype, so keys such as `__proto__` remain ordinary own properties.

Scalar rules are intentionally small:

- unquoted decimal integers with an optional leading minus become `number` values;
- unquoted decimal values containing a dot, with an optional leading minus, become `number` values;
- quoted values remain strings after `\"` and `\\` unescaping;
- other unquoted values remain strings;
- `#` begins a comment only outside quotes;
- duplicate keys or section names in one record throw `SyntaxError`;
- malformed assignments, nameless sections, orphan nested sections and unterminated quotes throw `SyntaxError`.

Keys preserve their exact spelling. Leading-plus and exponent forms remain strings. Numeric conversion uses
JavaScript `Number`, not `BigInt`; quote a value when its original digits must be preserved exactly.

This parser workflow validates the required raw shape while preserving the original null-prototype records:

```js
const { ParseConfigurationObject } = require("weapons/data");

const g_strRawWeaponConfiguration = `
[Properties]
Prefix = "weapon_"
Description = "hash # remains data" # outside-quote comment

[Weapons]
[[SampleWeapon]]
Clip = 12
Cost = 400
Weight = 1.5
Tags = "all,secondary"
`;

function ParseRawWeaponConfiguration(strText = g_strRawWeaponConfiguration) {
	const Configuration = ParseConfigurationObject(strText);
	if (!Object.hasOwn(Configuration, "Properties") || !Object.hasOwn(Configuration, "Weapons")) {
		throw new SyntaxError("Raw weapon configuration requires Properties and Weapons sections");
	}

	return { Configuration, PropertyNames: Object.keys(Configuration.Properties), WeaponNames: Object.keys(Configuration.Weapons) };
}
```

The parser does not require `[Properties]` or `[Weapons]`; this controller requires those exact keys for its custom
raw record. It is not a normalized weapon profile. Use `ParseWeaponINI(strText)` with its fixed INI schema when
normalization is required.

## Parsing a Weapon Profile

`ParseWeaponINI(strText)` requires object-valued `[properties]` and `[weapons]` sections, normalizes each nested weapon record
and aggregates profile tags. It does not touch disk or the module cache.

```js
const { ParseWeaponINI } = require("weapons/data");

const g_strWeaponProfileText = `
[properties]
prefix = "weapon_"
ammo_property = "m_iAmmo."
my_weapons_property = "m_hMyWeapons."

[special names]
Sidearm = "pistol"

[projectiles]
Grenade = "grenade_projectile"

[weapons]
[[pistol]]
id = 7
clip = 12
cost = 400
maximum_ammo = "ammo_9mm_max"
ammo_property = 6
secondary_fire_ammo_property = 7
secondary_fire_maximum_ammo = 3
parent_class = "basecombatweapon"
slot = 1
tags = "all,secondary,all"
type = "PISTOL"
`;

function ParseWeaponProfileText(strText = g_strWeaponProfileText) {
	const Profile = ParseWeaponINI(strText);
	if (Profile.Weapons.length === 0) {
		throw new SyntaxError("Weapon profile contains no weapon records");
	}

	const Weapon = Profile.Weapons[0];

	return { Profile, Weapon, Projectile: Profile.Projectiles.Grenade, SpecialName: Profile.SpecialNames.Sidearm };
}
```

`ParseWeaponINI(strText)` creates a fresh normalized profile; this controller's `Weapon` references its first record.
Calling the parser does not cache that profile. Only `Load(strBranch)` caches the profile it parses internally.

This parsing-only example preserves `Sidearm` and `Grenade` as case-sensitive raw mapping keys. Use lowercase alias
keys in profiles intended for `FormatName(strWeaponName, strBranch?)` or `Get(strWeaponName, strBranch?)`, because those helpers lowercase lookup names.

## Errors and Security

- `GetDataPath(strBranch)`, `Has(strBranch)` and `Load(strBranch)` throw `TypeError` for non-string, empty or invalid branch selectors.
- `FormatName(strWeaponName)` and `Get(strWeaponName)` throw `TypeError` for non-string or empty weapon names.
- `Load(strBranch)` throws `Error` when the exact profile file is absent.
- Filesystem checks and reads are synchronous and can block the server thread. Load during controlled initialization or
  administration.
- Parsing and normalization have no built-in size limit; repeated tag-deduplication searches can take quadratic time.
  Bound untrusted text and tag counts before parsing.
- Character validation prevents branch path traversal. Check `SUPPORTED_BRANCHES` separately when only packaged
  profiles are allowed.
- `ParseConfigurationObject(strText)` throws `SyntaxError` for grammar failures.
- `ParseWeaponINI(strText)` can additionally throw `SyntaxError` for missing sections and `TypeError` for invalid records,
  tags, `Clip` or `Cost`.
- Accessing `Record.Script` propagates `weapons/scripts` errors when the current game script file is absent or invalid.
- No helper catches these failures or substitutes another branch.

## Common Mistakes

- Do not treat `SUPPORTED_BRANCHES` as the complete HL2SDK build matrix.
- Do not assume `Has(strBranch)` means a profile parses successfully.
- Do not mutate a cached record unless every consumer in the plugin should observe the change.
- Do not expect `ClearCache()` to update old references; they remain detached objects.
- Do not retain a live record across `ClearCache()` and mistake it for the newly loaded record.
- Do not use `Record.Script` as another branch's script; it resolves files for the current game.
- Do not assume every `AmmoProperty`, `ID`, `Slot` or `Type` field is numeric; the profile schema intentionally carries strings too.
- Do not use `ParseConfigurationObject(strText)` when normalized defaults and records are required.
- Do not add compatibility aliases with alternate casing, a default export, or module-name metadata.

## Related Modules

- [`weapons`](weapons.md) documents live weapon entities and sendprop access.
- [`weapons/scripts`](weapons-scripts.md) documents engine weapon-script KeyValues.
- [`globals`](globals.md) documents the realtime selected-SDK branch.
- [`paths`](paths.md) documents `SourceDataRoot` and other runtime roots.
- [`filesystem`](filesystem.md) documents the synchronous path operations used by this module.
