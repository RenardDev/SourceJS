# `require("plugins/info")`

> AI processing note: this page documents strict manifest parsing, mutable metadata values and live record-backed fields.
> Keep disk manifests, constructor defaults and supplied native plugin records distinct.

`plugins/info` reads a plugin's JSON manifest and converts it into validated, mutable metadata. It is independent of the selected
HL2SDK branch because manifests belong to SourceJS plugin directories, not game interfaces.

The native loader allows `index.js` without a `plugin.json`. Explicit `ReadPluginManifest()` and `PluginInfo.FromManifest()` remain
strict, while `PluginInfo.FromRecord()` supplies default metadata for a loaded manifest-less plugin.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Read A Manifest](#read-a-manifest)
- [`PluginInfo`](#plugininfo)
- [Manifest Conversion](#manifest-conversion)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const { PluginInfo, ReadPluginManifest } = require("plugins/info");
```

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| [`PluginInfo`](#new-plugininfostrpluginname-pluginoptions--) | Class | Validated plugin manifest and current record metadata. |
| [`ReadPluginManifest(strPluginDirectory)`](#readpluginmanifeststrplugindirectory) | Function | Reads and parses `<strPluginDirectory>/plugin.json`. |

## Read A Manifest

### `ReadPluginManifest(strPluginDirectory)`

`strPluginDirectory` must be a non-empty path string. The function uses the SourceJS [`filesystem`](filesystem.md) module, requires a
non-empty `plugin.json`, parses JSON, and requires a non-null object rather than an array or scalar. Disk access is synchronous on the caller's game thread. Use a trusted directory: this helper trims trailing path separators but does not enforce a plugin-root sandbox.

```js
const { ReadPluginManifest } = require("plugins/info");

function InspectPluginManifest(strPluginDirectory) {
	const PluginManifest = ReadPluginManifest(strPluginDirectory);

	return {
		Author: PluginManifest.Author,
		Description: PluginManifest.Description,
		Entry: PluginManifest.Entry,
		Name: PluginManifest.Name,
		Version: PluginManifest.Version,
	};
}

module.exports = { InspectPluginManifest };
```

Missing files, empty files, malformed JSON and non-object top-level values throw. The function returns a new parsed JavaScript value
on every call, so editing the object does not rewrite the file.

Owned manifest fields use their exact PascalCase option names, such as `Name`,
`Entry`, `Author`, and `Version`. `PluginInfo.FromManifest()` and `FromRecord()`
do not normalize legacy lowercase aliases; unknown custom fields retain their
spelling as extra metadata. Author project-owned custom keys in PascalCase; do not depend on automatic case conversion.

## `PluginInfo`

### `new PluginInfo(strPluginName, PluginOptions = {})`

`strPluginName` is the plugin's non-empty directory identity. The constructor retains the supplied `Permissions`, `DisplayInListing`,
`PublicConVar`, and `Extra` objects by identity. Their later mutations are visible through the `PluginInfo` instance, and mutations
through the instance update the same objects. Unknown own enumerable option values are assigned into the live `Extra` object and override matching configurable extra fields. Non-configurable collisions or a non-extensible `Extra` that needs new keys throw.

Validation happens during construction, in the two text setters, and in record-backed accessors. Ordinary fields, backing slots and referenced containers are not continuously validated or frozen: keep their declared types after mutation, and use `VerboseName`/`Version` rather than overwriting their storage slots. `PublicConVar` is a boolean or a plain object; this constructor does not validate a schema inside that object. Metadata does not itself register permissions, create ConVars, or execute an entry file.

| Property | Type | Behavior |
| --- | --- | --- |
| `Name` | `string` | Filesystem/plugin-manager identity. |
| `VerboseName` | `string` | Writable display name; by default, replaces runs of hyphens/underscores in `Name` with spaces and capitalizes ASCII word starts. |
| `VerboseNameValue` | `string \| null` | Stored display-name value used by the getter. |
| `Author` | `string \| null` | Optional author. |
| `Description` | `string \| null` | Optional short description. |
| `Version` | `string` | Writable version; reads as `unversioned` when its stored value is `null`. |
| `VersionValue` | `string \| null` | Stored version value used by the getter. |
| `URL` | `string \| null` | Optional project or release URL. |
| `Permissions` | `[string, string][]` | Live permission/description pairs supplied to the constructor. |
| `PublicConVar` | `boolean \| object` | Boolean control or live public-version-ConVar metadata. |
| `DisplayInListing` | `string[]` | Live names of additional listing fields. |
| `Entry` | `string` | Non-empty CommonJS entry path, defaulting to `index.js`. |
| `Extra` | `object` | Live explicit metadata plus unknown option keys. |

This example defines metadata used by an administrative plugin listing and then exercises both writable accessors:

```js
const { PluginInfo } = require("plugins/info");

function CreateMatchToolsInformation() {
	const Information = new PluginInfo("match-tools", {
		Author: "SourceJS Team",
		Description: "Controls competitive match state.",
		DisplayInListing: ["Category"],
		Entry: "main.js",
		Extra: {
			Repository: "https://example.invalid/sourcejs/match-tools",
		},
		Permissions: [
			["match.admin", "Change match state."],
			["match.pause", "Pause the active match."],
		],
		PublicConVar: {
			Name: "sourcejs_match_tools_version",
		},
		Version: "1.4.0",
		Category: "administration",
	});
	Information.VerboseName = "Match Tools";
	Information.Version = null;

	return Information;
}

module.exports = { CreateMatchToolsInformation };
```

Unknown keys such as `Category` are assigned into the live `Extra` object; they are not installed as arbitrary properties on the
class instance. Assigning a non-string, non-null value to `VerboseName` or `Version` throws.

## Manifest Conversion

### `PluginInfo.FromManifest(strPluginName, strPluginDirectory)`

This strict factory reads `plugin.json`. A non-null, non-`undefined` `strPluginName` argument overrides the optional manifest `Name`, which keeps the
plugin manager's directory identity authoritative.

```js
const { PluginInfo } = require("plugins/info");

function InspectManifestPluginInformation(strPluginName, strPluginDirectory) {
	const Information = PluginInfo.FromManifest(strPluginName, strPluginDirectory);

	return {
		Description: Information.Description,
		Entry: Information.Entry,
		Name: Information.Name,
		VerboseName: Information.VerboseName,
		Version: Information.Version,
	};
}

module.exports = { InspectManifestPluginInformation };
```

Passing `null` or `undefined` as `strPluginName` uses `PluginManifest.Name`; if neither source provides a non-empty string name, construction throws. An explicit name does not make a malformed or missing manifest acceptable.

### `PluginInfo.FromRecord(PluginRecord)`

`PluginRecord` is one object from `require("plugins").GetPluginRecords()`. The factory validates all six own record fields, uses its
authoritative name and directory to read the manifest when present, and defines live accessors over the same supplied object.
Without `plugin.json`, it creates default `index.js` and `unversioned` metadata instead of rejecting a plugin that the native loader
accepted. This fallback applies only when the filesystem reports no manifest; read/parse/validation failures for an existing manifest still propagate.

| Record-backed property | Type | Source |
| --- | --- | --- |
| `Name` | `string` | Live `PluginRecord.Name`. |
| `Directory` | `string` | Live `PluginRecord.Directory`. |
| `FilePath` | `string` | Live `PluginRecord.Entry`; distinct from the manifest-relative `Entry`. |
| `Enabled` | `boolean` | Live `PluginRecord.Enabled`. |
| `Loaded` | `boolean` | Live `PluginRecord.Loaded`. |
| `Index` | `number` | Live safe-integer `PluginRecord.Index`; supplied records may use signed sentinel values, while native loaded records use positive one-based indexes. |

```js
const g_Plugins = require("plugins");
const { PluginInfo } = require("plugins/info");

function InspectLoadedPluginInformation() {
	const vecPluginInformation = [];
	for (const PluginRecord of g_Plugins.GetPluginRecords()) {
		const Information = PluginInfo.FromRecord(PluginRecord);
		vecPluginInformation.push(Information);
	}

	return vecPluginInformation;
}

module.exports = { InspectLoadedPluginInformation };
```

## Errors

The constructor requires a non-empty string identity and plain `PluginOptions`/`Extra` objects (`Object.prototype` or a null prototype). Permission entries are exactly two strings; display fields are strings. Optional text accepts string, `null` or `undefined` (the latter two become `null`); array/object fields do not accept `null` as their omission value. `PublicConVar` accepts a boolean or plain object. `Entry` must be a non-empty string; metadata construction does not check that it is a safe relative path or an existing file. Native loading separately validates entry paths.

Only own option properties are read. Unknown enumerable string keys become `Extra` metadata, retaining their values by identity. File manifests can supply only JSON data; direct constructor metadata can hold other JavaScript values and is not necessarily JSON-serializable. Merging into a supplied `Extra` can throw; rollback failures are reported together with the original error rather than being hidden.

`ReadPluginManifest()` and `FromManifest()` throw for a missing, empty, malformed or non-object `plugin.json`. `FromRecord()`
requires a plain object with own `Name`, `Directory`, `Entry`, `Enabled`, `Loaded`, and `Index` fields. Every record-backed getter
validates the current field again, and every setter validates before mutating the supplied record.

## Lifecycle

`PluginInfo.FromRecord()` returns a live view of the supplied plugin record object. Changing `Name`, `Directory`, `FilePath`,
`Enabled`, `Loaded`, or `Index` updates that object. Changes made directly to the object are visible through the same `PluginInfo`
instance. The view owns no native plugin and grants no lifecycle authority: editing `Loaded`/`Enabled` does not load, unload, enable or disable a plugin. Optional manifest text such as `Description` can be `null`; consumers must honor that contract.

The native `plugins.GetPluginRecords()` call creates fresh JavaScript record objects. Editing one of those objects does not mutate the C++
plugin manager, and later lifecycle changes do not update an older record object. Call `GetPluginRecords()` and `FromRecord()` again for
current manager state. Manifest metadata is read only during construction; changing a record-backed directory does not reload
`plugin.json`.

## Related Modules

- [`plugins`](plugins.md) returns current native plugin records.
- [`plugins/manager`](plugins-manager.md) exposes `GetPluginInfo(PluginSelector)`.
- [`plugins/instance`](plugins-instance.md) creates a `PluginInfo` view for a named plugin wrapper.
- [`filesystem`](filesystem.md) owns manifest file access.
- [`paths`](paths.md) exposes `PLUGIN_ROOT`.
