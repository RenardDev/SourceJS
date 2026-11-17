# `require("cvars/tags")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

[`packages/sourcejs/cvars/tags.js`](../../packages/sourcejs/cvars/tags.js) returns the native `cvars/tags` module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp).

Use this module to read and write the engine's live `sv_tags` ConVar for server-tag advertising. It does not track tag ownership or guarantee browser visibility: callers must coordinate shared tags and decide which tags they may remove. Operations require the native CVar interface and a real `sv_tags` ConVar; missing engine state throws. Tag and raw-value arguments must be primitive strings; numbers, boxed strings, and arbitrary string-convertible objects are rejected.

## Import

```js
const { GetServerTags, AddServerTag, RemoveServerTag } = require("cvars/tags");
```

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| [`GetServerTagsString`](#getservertagsstring) | `GetServerTagsString()` | Raw current `sv_tags` string. |
| [`SetServerTagsString`](#setservertagsstringstrvalue) | `SetServerTagsString(strValue)` | `true` after calling the native setter without tag normalization or read-back verification. |
| [`GetServerTags`](#getservertags) | `GetServerTags()` | Array of trimmed, non-empty, unique tags in first-occurrence order. |
| [`HasServerTag`](#hasservertagstrtag) | `HasServerTag(strTag)` | Whether the parsed live list contains the trimmed argument; `false` for a blank argument. |
| [`AddServerTag`](#addservertagstrtag) | `AddServerTag(strTag)` | `false` for a blank argument; otherwise `true`. An existing exact tag causes no write; otherwise appends the trimmed argument and writes the joined list without read-back verification. |
| [`RemoveServerTag`](#removeservertagstrtag) | `RemoveServerTag(strTag)` | `true` after writing the parsed list without exact matches, even when no match existed or the argument was blank. Does not verify the resulting engine value. |

All six native functions translate C++ exceptions into contextual JavaScript errors without exposing exception text. String-argument conversion or encoding errors stop the operation instead of substituting an empty string. Completed native writes are not rolled back by a later error.

`GetServerTagsString` checks string-result construction. `GetServerTags` checks the native array size limit, each tag string and every array write; it creates own writable, enumerable, configurable elements without invoking inherited setters or being blocked by inherited non-writable properties. It stops on failure rather than returning a partial array. Both preserve an existing JavaScript exception or report construction failure, including when a C++ failure occurs during result construction or append. These checks do not extend the lifetime of the borrowed native ConVar.

Tags are case-sensitive. Parsing splits the engine string on commas, trims only spaces and tabs, skips empty entries, and keeps the first occurrence of each exact tag. Individual tag arguments are trimmed but not split or validated against commas: use one non-empty, comma-free tag per call. An argument containing a comma will not behave as one tag when the written list is parsed again.

`SetServerTagsString()` passes the converted string to a null-terminated native setter; it does not normalize tags or guarantee an exact stored value. Avoid embedded NUL characters. Snapshot `GetServerTagsString()` for temporary replacement, check read-back when required, and coordinate restoration so it does not overwrite another writer's changes.

The module does not track ownership. A successful add is not proof that the caller introduced the tag. Remove a tag during cleanup only when the caller introduced it and other users no longer need it; a prior absence check alone does not establish exclusive ownership.

## Examples

### `GetServerTagsString()`

Read the current native `sv_tags` string without parsing it. This does not verify what a server browser has received:

```js
const { GetServerTagsString } = require("cvars/tags");

const g_strRawServerTags = GetServerTagsString();
console.log(`sv_tags=${g_strRawServerTags}`);
```

### `SetServerTagsString(strValue)`

With exclusive control of `sv_tags`, temporarily replace the complete list, then attempt to restore and verify the saved text. This is not atomic: callbacks can observe intermediate values, other writers' changes can be overwritten, and a restoration error can mask the original failure. Read-back checks the ConVar, not browser propagation.

```js
const { GetServerTagsString, SetServerTagsString, GetServerTags, HasServerTag } = require("cvars/tags");

const g_strOriginalServerTags = GetServerTagsString();
const g_strTemporaryServerTags = Array.from(new Set([...GetServerTags(), "sourcejs-test"])).join(",");

try {
	if (!SetServerTagsString(g_strTemporaryServerTags) || (GetServerTagsString() !== g_strTemporaryServerTags) || !HasServerTag("sourcejs-test")) {
		throw new Error("Unable to install the temporary sv_tags value.");
	}

	console.log(`Temporary sv_tags=${GetServerTagsString()}`);
} finally {
	if (!SetServerTagsString(g_strOriginalServerTags) || (GetServerTagsString() !== g_strOriginalServerTags)) {
		throw new Error("Unable to restore the original sv_tags value.");
	}
}
```

### `GetServerTags()`

Sort the returned tag array for a case-sensitive summary of the current ConVar. Sorting this array does not change `sv_tags`; the result is not confirmation of browser visibility or implemented capabilities:

```js
const { GetServerTags } = require("cvars/tags");

function CompareServerTags(strLeftTag, strRightTag) {
	if (strLeftTag < strRightTag) {
		return -1;
	}

	if (strLeftTag > strRightTag) {
		return 1;
	}

	return 0;
}

const g_vecServerTags = GetServerTags().sort(CompareServerTags);
console.log(`Current server tags: ${g_vecServerTags.join(", ")}`);
```

### `HasServerTag(strTag)`

Check whether the current parsed `sv_tags` list contains the trimmed, case-sensitive tag. Presence does not identify its owner or verify the advertised capability:

```js
const { HasServerTag } = require("cvars/tags");

if (HasServerTag("sourcejs")) {
	console.log("The current sv_tags list contains sourcejs.");
}
```

### `AddServerTag(strTag)`

With exclusive control of the chosen tag, add it temporarily and attempt cleanup only if it was initially absent. The absence check is not an ownership lock: coordinate other writers, including native callbacks. Cleanup may normalize the whole list, fail, or mask the original error; it does not restore the exact original string.

```js
const { HasServerTag, AddServerTag, RemoveServerTag } = require("cvars/tags");

const g_strPluginTag = "sourcejs-events";
const g_bPluginTagAlreadyExisted = HasServerTag(g_strPluginTag);

try {
	if (!g_bPluginTagAlreadyExisted && !AddServerTag(g_strPluginTag)) {
		throw new Error(`Could not add server tag: ${g_strPluginTag}`);
	}

	if (!HasServerTag(g_strPluginTag)) {
		throw new Error(`Server tag is not active: ${g_strPluginTag}`);
	}

	console.log(`Current sv_tags contains: ${g_strPluginTag}`);
} finally {
	if (!g_bPluginTagAlreadyExisted && (!RemoveServerTag(g_strPluginTag) || HasServerTag(g_strPluginTag))) {
		throw new Error(`Could not remove server tag: ${g_strPluginTag}`);
	}
}
```

### `RemoveServerTag(strTag)`

With exclusive control of the chosen tag, temporarily remove it and attempt to restore its presence only if it originally existed. Removal and re-addition normalize the list and may change tag order; they do not restore the original text. Other writers and callbacks must be coordinated, and restoration can fail or mask an earlier error.

```js
const { HasServerTag, AddServerTag, RemoveServerTag } = require("cvars/tags");

const g_strMaintenanceTag = "sourcejs-maintenance";
const g_bMaintenanceTagExisted = HasServerTag(g_strMaintenanceTag);

try {
	if (g_bMaintenanceTagExisted && !RemoveServerTag(g_strMaintenanceTag)) {
		throw new Error(`Could not remove maintenance tag: ${g_strMaintenanceTag}`);
	}

	if (HasServerTag(g_strMaintenanceTag)) {
		throw new Error(`Maintenance tag is still present: ${g_strMaintenanceTag}`);
	}

	console.log("The current sv_tags list does not contain the maintenance tag.");
} finally {
	if (g_bMaintenanceTagExisted && (!AddServerTag(g_strMaintenanceTag) || !HasServerTag(g_strMaintenanceTag))) {
		throw new Error(`Could not restore maintenance tag: ${g_strMaintenanceTag}`);
	}
}
```

`RemoveServerTag()` returns `true` even when the tag was absent. `HasServerTag()` checks current presence, not ownership or browser propagation. Removing a tag does not disable the named feature or prove that a browser has stopped displaying it.

## Safe use

- All functions operate on the live engine `sv_tags` ConVar and throw when the native CVar interface or `sv_tags` is unavailable. Do not treat a missing engine dependency as an empty tag list.
- Tags are case-sensitive. Parsing trims only spaces and tabs around comma-separated entries, discards empty entries, and preserves the first occurrence of each exact tag. Individual tag arguments are not split; use non-empty, comma-free tags without embedded NUL characters.
- The module does not track ownership. A prior presence check is not a lock or ownership claim. Coordinate writers and callbacks, record prior presence, and undo only a change the caller may still safely reverse.
- `AddServerTag()` returns `false` for a blank normalized argument and `true` for an existing tag without writing. `RemoveServerTag()` writes the normalized list and returns `true` even when no exact tag existed. Neither return value proves ownership or confirms the stored value; read back when required.
- `SetServerTagsString()` passes the converted string to the native setter without tag normalization; embedded NUL truncates the native string. Snapshot `GetServerTagsString()` before temporary replacement, verify restoration by reading back, and avoid restoring a stale snapshot over another writer's changes.
- Mutation and cleanup are not transactional. Callbacks can observe intermediate states, cleanup can fail or mask an earlier exception, and remove/re-add can change formatting and order. Native tag presence does not verify browser propagation or enable/disable the named feature.
- Call cleanup from explicit plugin lifecycle handling. Destroying the JavaScript context does not restore the shared ConVar automatically.
- Calls are synchronous on the server/game thread and require the borrowed native ConVar to remain alive. These APIs do not use the background request workers for network or database operations. JavaScript strings cross the native boundary as UTF-8; the native setter remains NUL-terminated.

## Related files

- [`packages/sourcejs/cvars/tags.js`](../../packages/sourcejs/cvars/tags.js) — JavaScript entry point for the native server-tag module.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — `sv_tags` lookup, normalization, list, mutation, and module bindings.
- [`cvars.md`](cvars.md) — full live ConVar and registry API.
- [`cvars-convar.md`](cvars-convar.md) — focused native-backed ConVar lookup and creation objects.
