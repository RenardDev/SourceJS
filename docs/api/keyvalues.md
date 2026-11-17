# `require("keyvalues")`

> AI agents: this is an API and ownership reference, not permission to load the whole page at once. Use the contents, read one bounded chunk, verify it against the selected SDK and wrapper, then continue.

`keyvalues` exposes the selected Source SDK branch's real `KeyValues` implementation through plugin-context-owned handles. It is used for Valve configuration trees, event schemas, client command payloads, entity metadata and other engine APIs that accept `KeyValues*`.

## Contents

- [Import](#import)
- [SDK behavior](#sdk-behavior)
- [Exports](#exports)
- [Types](#types)
- [Ownership](#ownership)
- [KeyValues](#keyvalues)
- [KeyValuesIterator](#keyvaluesiterator)
- [Workflows](#workflows)
- [Related modules](#related-modules)

## Import

```js
const { CreateKeyValues, KeyValuesType, KeyValues, KeyValuesIterator } = require("keyvalues");
const { LogInfo } = require("loggers");

const g_ReportKeyValuesExports = () => {
	if (!Object.isFrozen(KeyValuesType)) {
		throw new Error("KeyValuesType must be immutable.");
	}

	LogInfo(`KeyValues types available: ${Object.keys(KeyValuesType).join(", ")}`);
	LogInfo(`Constructors available: ${typeof KeyValues}, ${typeof KeyValuesIterator}; factory available: ${typeof CreateKeyValues}.`);
};

g_ReportKeyValuesExports();
```

The module is CommonJS. It exposes only the listed canonical names and does not create missing members at runtime.

## SDK behavior

All parsing, serialization, symbol lookup and typed storage are performed by the `KeyValues` class compiled from the selected HL2SDK branch. File and escape-sequence behavior can therefore differ between branches such as SDK2013 and L4D2.

Unavailable native operations are omitted. In particular, `KeyValues.prototype.GetKeyValuesBoolean` and `KeyValues.prototype.SetKeyValuesBoolean` exist only when that SDK declares direct `GetBool` and `SetBool` methods. Check the method before using it in a plugin that targets several branches.

Generic boolean writes, including booleans inside constructor/object inputs, also require native `SetBool`; they do not fall back to integer setters. Examples containing unconditional boolean writes require that capability. On other branches, write an explicit integer `0` or `1` instead.

The JavaScript wrapper does not parse Valve text itself and does not emulate a missing SDK method. Calls are synchronous and confined to the plugin's game-thread context; file loads and saves use the Source filesystem and can block that thread. This module does not use the asynchronous request/callback contract of the network and database modules.

Key names and file text belong to the supplied Valve/engine or application schema. They are forwarded without PascalCase normalization; keep external names exact and use PascalCase for project-owned schemas.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| [`KeyValuesType`](#keyvaluestype) | Frozen namespace | Selected-SDK `KeyValues::types_t` values. |
| [`KeyValues`](#keyvalues) | Class | Owning roots and non-owning views over native keys. |
| [`KeyValuesIterator`](#keyvaluesiterator) | Class | Live name iterator over direct children. |
| `CreateKeyValues(strKeyValuesName, KeyValuesObject = {})` | Function | Creates an owning root and fills it from a plain object. |

## Types

### `KeyValuesType`

| Member | Stored value |
| --- | --- |
| `None` | A tree node with subkeys. |
| `String` | A narrow string. |
| `Int` | A signed 32-bit integer. Booleans also use this storage type. |
| `Float` | A single-precision number. |
| `Address` | A native address represented by a non-negative JavaScript `bigint`. |
| `WideString` | An SDK wide-string value. The generic reader returns its string form. |
| `Color` | Four byte components. |
| `UInt64` | An unsigned 64-bit value returned as `bigint`. |
| `CompiledIntByte` | Optional compiled-KeyValues byte integer. |
| `CompiledInt0` | Optional compiled-KeyValues constant zero. |
| `CompiledInt1` | Optional compiled-KeyValues constant one. |
| `NumberOfTypes` | The selected SDK's terminal type value. |

The three `CompiledInt*` members are capability-conditioned. Use `Object.hasOwn(KeyValuesType, strTypeName)` when writing cross-SDK code.

## Ownership

Every `KeyValues` JavaScript object contains an opaque `Handle`. The handle identifies a plugin-local native record; it is not the same thing as the SDK object's native `Address` value, which is represented as `bigint`. Native handle and color result records have own data properties (`Handle` and `Red`/`Green`/`Blue`/`Alpha` respectively). Exceptions from a `Handle` getter propagate unchanged during native handle resolution, ownership transfer, or `Destroy`.

A fresh owned root remains rollback-owned until its complete handle result is available; registration inserts a complete record, and a failed result construction removes that registration and releases the fresh root.

Borrowed inputs are never deleted by this rollback.

Native `Types`, `Create`, `Destroy`, `Address`, `Name`, `SetName`, `NameSymbol`, `DataType`, `FindKey`, `FindKeyBySymbol`, `CreateNewKey`, `AddSubKey`, `RemoveSubKey`, `CopySubKeys`, `MakeCopy`, `SetNextKey`, `FirstSubKey`, `NextKey`, `FirstTrueSubKey`, `NextTrueSubKey`, `FirstValue`, `NextValue`, `GetInt`, `GetUInt64`, `GetFloat`, `GetString`, `GetColor`, `GetBool` (where supported by the selected SDK), `GetAddress`, `IsEmpty`, `Clear`, `SetString`, `SetInt`, `SetUInt64`, `SetFloat`, `SetColor`, `SetBool` (where supported by the selected SDK), `SetAddress`, `Keys`, `Value`, `ToObject`, `ToString`, `LoadFromBuffer`, `LoadFromFile`, and `SaveToFile` callbacks translate unexpected C++ exceptions into JavaScript errors identifying the operation.

Native type records and KeyValues-to-object conversion also use own data properties; conversion preserves the supplied key names exactly.

Native string inputs use their complete UTF-8 byte length and reject embedded NUL with `TypeError` before committing the converted value. This includes root/key names, string values and defaults, parser buffers, and file paths: the SDK consumes them as NUL-terminated strings, so silently using only a prefix is not safe. Ordinary and empty strings retain their existing meaning; optional nullish key names still select the current node.

Native `AddSubKey`, `RemoveSubKey`, `CopySubKeys`, and `SetNextKey` resolve each supplied handle once and revalidate the first native record after resolving the second handle; a first record invalidated by that getter is rejected before SDK access or mutation.

`AddSubKey` and `SetNextKey` reject an owned input hierarchy containing the destination node. An owned ancestor cannot be attached beneath its descendant or used as that descendant's next-key tree; rejection leaves the links and ownership records unchanged.

Native `GetColor` and `SetColor` also revalidate their resolved records after reading color object or array components; a component getter that invalidates that record is rejected before the SDK color read or write.

Native `GetFloat` defaults and `SetFloat` inputs use JavaScript numeric coercion. If that conversion invalidates the original KeyValues handle, the operation throws before SDK access; it does not resolve a replacement through another `Handle` getter call. An exception thrown by the conversion propagates unchanged.

Native `Keys` returns own indexed string data properties without invoking inherited setters during SDK traversal and rejects an unsupported key count before index overflow.

Direct native `CopySubKeys(Source, Target)` is a no-op when both handles identify the same native node. For distinct nodes, `Target` must have no subkeys; an occupied target throws before any mutation because the SDK would overwrite its child list without freeing it. The higher-level `CopyKeyValuesRecursively()` already clears its target before calling this primitive; its source must remain valid across that clear.

- `new KeyValues`, `CreateKeyValues`, `KeyValues.CreateKeyValuesFromObject`, `KeyValues.CreateKeyValuesFromBuffer`, `KeyValues.CreateKeyValuesFromFile`, and `CreateKeyValuesCopy` return owning roots.
- `FindKeyValuesKey`, traversal properties, `CreateKeyValuesKey`, and typed setters with a non-null key name return non-owning wrapper handles. Call `DestroyKeyValues()` when each wrapper is no longer needed.
- Destroying a non-owning wrapper releases only that wrapper record. It does not delete the key from its parent.
- Destroying an owning root deletes its native tree and invalidates every wrapper into that tree.
- `AddKeyValuesSubKey(SubKeyValues)` transfers the owned child tree to its new parent. Its root must have no next peer, as required by the SDK's `AddSubKey`; a root with a peer chain throws before links or ownership change. Detach that chain first with `NextKeyValues = null` if only the root should be attached. `RemoveKeyValuesSubKey(SubKeyValues)` detaches it and transfers ownership back to the supplied child wrapper; other wrappers for that root remain non-owning and must not outlive its owner.
- Assigning `NextKeyValues` follows the same ownership rule. A replacement must be a distinct owned tree. A detached previous peer becomes owned through an existing wrapper; without such a wrapper it is deleted immediately. When disposal needs a temporary node list, that list is prepared before changing the link. After linking, the new peer's handles are non-owning before disposal of the previous peer. Replacement is not transactional: an unexpected SDK release error does not imply that the old link was restored or that native release succeeded; cleanup is not retried automatically.
- `ClearKeyValues()`, copying from a different native node with `CopyKeyValuesRecursively()`, and engine ownership transfer invalidate wrappers into replaced descendants. Copying a node to itself, including through distinct handles for the same address, is a no-op.
- An in-place file/buffer load invalidates descendant handles after native argument/filesystem validation, before calling the SDK loader. A loader failure does not restore them; never retain descendant wrappers across a load attempt.
- Handles are isolated by plugin context. A different plugin cannot use one, and plugin unload deletes every still-owned tree.

Release every wrapper you retain with `DestroyKeyValues()`. It returns `true` when a native record was released and `false` when already destroyed or invalidated; after a non-throwing native destroy, the wrapper's `Handle` becomes `null`. A thrown error leaves that field unchanged. After an engine function takes ownership, treat the JavaScript object and all descendant wrappers as invalid. An exposed native `Address` is borrowed, not an allocation to release through `memory.Deallocate()`.

## `KeyValues`

### Construction

| API | Result |
| --- | --- |
| [`new KeyValues(strKeyValuesName = "", FirstKeyNameOrObject = undefined, FirstKeyValue = undefined, strSecondKeyName = undefined, SecondKeyValue = undefined)`](#keyvalues) | Creates an owning root. A plain-object second argument without a third argument fills the tree; otherwise the optional key/value pairs write one or two values. |
| `KeyValues.CreateKeyValuesFromObject(strKeyValuesName, SourceObject)` | Creates an owning root from a plain nested object. |
| `KeyValues.CreateKeyValuesFromBuffer(strKeyValuesBuffer, bUsesEscapeSequences = false)` | Parses text into a new owning root; throws if parsing fails. |
| `KeyValues.CreateKeyValuesFromFile(strFileName, LoadOptions = {})` | Loads a new owning root; throws if loading fails. |

`CreateKeyValuesFromFile` accepts only the optional `UseEscapeSequences` boolean. Unknown option keys throw.

If initialization fails after allocating a root, the constructor and the three creation factories attempt `DestroyKeyValues()` once. A sole initialization failure is rethrown unchanged, including a falsy thrown value. If cleanup also throws, an `AggregateError` contains the initialization failure first and the cleanup failure second. A non-throwing destroy returning `false` retains its existing invalidation meaning; a thrown destroy neither proves release nor triggers an automatic retry.

### Live properties

| Property | Access | Meaning |
| --- | --- | --- |
| `Handle` | Read/write field | Opaque plugin-local native handle object, or `null` after a non-throwing `DestroyKeyValues()`. Implementation-managed: do not replace, edit, or share it across plugins. |
| `Address` | Read | Native address of the current SDK object as `bigint`. |
| `Name` | Read/write | Current key name. |
| `KeyNameSymbol` | Read | Engine symbol for the current name. |
| [`KeyValuesType`](#keyvaluestype) | Read | Current `KeyValuesType` value. |
| `KeyValuesValue` | Read | Current typed value; tree nodes become plain objects. |
| `DirectChildValues` | Read | Point-in-time plain-object representation of direct descendants. |
| `UseEscapeSequences` | Read/write field | Wrapper's current file/buffer load mode; prefer `SetKeyValuesEscapeSequencesEnabled()`. |
| `FirstSubKeyValues` | Read | First direct child wrapper or `null`. |
| `NextKeyValues` | Read/write | Next peer wrapper, an owned replacement tree, or `null`. |
| `FirstTrueSubKeyValues` | Read | First direct child whose type is `None`. |
| `NextTrueSubKeyValues` | Read | Next peer whose type is `None`. |
| `FirstValueKeyValues` | Read | First direct child whose type is not `None`. |
| `NextValueKeyValues` | Read | Next peer whose type is not `None`. |

Each non-null traversal property on a `KeyValues` instance creates a wrapper handle that the caller owns at the JavaScript level and must release with `DestroyKeyValues()`. `KeyValuesIterator.NextKeyValues` is iterator-managed and is released by `next()` or `return()`; do not destroy it directly.

### Tree methods

| Method | Behavior |
| --- | --- |
| `AddKeyValuesObject(SourceObject)` | Writes every own enumerable entry of a plain object and returns `this`. |
| `FindKeyValuesKey(strKeyName, bCreateKey = false)` | Returns a child wrapper, optionally creating the child, or `null`. |
| `FindKeyValuesKeyBySymbol(nKeySymbol)` | Returns the child with a signed 32-bit engine name symbol, or `null`. |
| `CreateKeyValuesKey()` | Appends a numeric-name child and returns its wrapper. |
| `AddKeyValuesSubKey(SubKeyValues)` | Attaches a distinct owned tree and returns the supplied child. |
| `RemoveKeyValuesSubKey(SubKeyValues)` | Detaches a direct child, transfers ownership, and returns success. |
| `CreateKeyValuesCopy()` | Returns an independent owning deep copy. |
| `CopyKeyValuesRecursively(SourceKeyValues)` | For different native nodes, clears `this` and copies the source subkeys. The same node is a no-op, even through distinct handles. Returns `this`. |
| `GetKeyValuesKeyOrDefault(strKeyName, DefaultValue = null)` | Returns `this` for nullish names, a child wrapper, or the supplied default. |
| `GetKeyValuesValue(strKeyName)` | Reads one typed value and releases its temporary child wrapper. |
| `SetKeyValuesValue(strKeyName, KeyValue)` | Replaces one child from a supported JavaScript value and returns its wrapper. Assigning a `KeyValues` view of that same native child leaves its contents and descendant handles unchanged. |
| `DeleteKeyValuesKey(strKeyName)` | Detaches and destroys an existing child. Missing keys throw. |
| `HasKeyValuesKey(strKeyName)` | Tests child existence without retaining a wrapper. |
| `IsKeyValuesEmpty(strKeyName = null)` | Tests a key or the current node for no value/subkeys. |
| `ClearKeyValues()` | Deletes all descendants and resets the current node. |
| `GetKeyValuesKeyNames()` | Returns a point-in-time array of direct child names. |
| `GetKeyValuesValueList()` | Returns point-in-time typed values in child order. |
| `GetKeyValuesEntries()` | Returns point-in-time `[strKeyName, KeyValue]` pairs. |
| `ConvertKeyValuesToObject(bPreserveDuplicateKeys = false)` | Recursively returns a point-in-time plain object of this node's children; the node's own name is not included. When `true`, repeated sibling names become arrays of their typed values, in occurrence order. A non-boolean option throws `TypeError`. |
| `DestroyKeyValues()` | Releases this wrapper; owning roots also delete the native tree. Returns `true` on release, `false` if already destroyed/invalidated; native errors throw. |

`SetKeyValuesValue` accepts strings, booleans when supported, finite numbers, unsigned `bigint` values, `Color`/RGB/RGBA values, plain nested objects, and other `KeyValues` trees. Named setters return a child wrapper; release it even when the returned value is not otherwise needed.

If initializing a child fails, `SetKeyValuesValue` attempts to release that child wrapper once, not the root. It preserves a sole failure unchanged; simultaneous initialization and cleanup failures become an `AggregateError` in that order. This cleanup does not roll back earlier tree mutations or imply that a thrown destroy completed.

Generic integer `number` inputs must fit signed 32-bit storage; larger integers throw before creating or replacing a child. Use `bigint` for unsigned 64-bit values, or the explicit `SetKeyValuesFloat` when floating-point storage is intended. Non-integer finite numbers infer `Float`. Unsigned `bigint` inputs must be between `0n` and `0xFFFFFFFFFFFFFFFFn` inclusive.

Color inputs use the actual `colors.Color` class, three/four-element RGB/RGBA byte arrays, or records with `Red`, `Green`, `Blue`, and optional `Alpha`; omitted alpha is `255`. Legacy `m_un*` color aliases are not accepted. Color getters return a `colors.Color` instance.

By default, plain-object conversion keeps the last value of each duplicate sibling name. Pass `true` to preserve all occurrences in per-name arrays recursively; names occurring once keep their ordinary scalar/object shape. Conversion leaves the native tree unchanged and preserves literal keys such as `__proto__` as own data properties. Grouped arrays do not retain interleaving between different names or native-node identity; use direct traversal when those distinctions matter.

### Typed accessors

| Getter | Setter | Native value |
| --- | --- | --- |
| `GetKeyValuesString(strKeyName = null, strDefaultValue = "")` | `SetKeyValuesString(strKeyName, strValue)` | String. |
| `GetKeyValuesInteger(strKeyName = null, nDefaultValue = 0)` | `SetKeyValuesInteger(strKeyName, nValue)` | Signed 32-bit integer. |
| `GetKeyValuesUInt64(strKeyName = null, unDefaultValue = 0n)` | `SetKeyValuesUInt64(strKeyName, unValue)` | `bigint` in `0n..0xFFFFFFFFFFFFFFFFn`; numeric inputs/defaults are rejected. |
| `GetKeyValuesFloat(strKeyName = null, flDefaultValue = 0)` | `SetKeyValuesFloat(strKeyName, flValue)` | `number`; input/default is numerically coerced and must be finite and within native `float` range. Conversion rounds to single precision and may underflow to zero. |
| `GetKeyValuesColor(strKeyName = null, DefaultValue = { Red: 0, Green: 0, Blue: 0, Alpha: 255 })` | `SetKeyValuesColor(strKeyName, ColorValue)` | `Color` with byte components. |
| `GetKeyValuesAddress(strKeyName = null, unDefaultValue = 0n)` | `SetKeyValuesAddress(strKeyName, unAddressValue)` | Non-negative `bigint` fitting the selected platform's address width; numeric inputs/defaults are rejected. |
| `GetKeyValuesBoolean(strKeyName = null, bDefaultValue = false)` | `SetKeyValuesBoolean(strKeyName, bValue)` | Capability-conditioned direct SDK boolean API. |

`GetKeyValuesType(strKeyName = null)` returns the selected SDK's exact `KeyValuesType` for a key. A typed setter in this table with `null` or `undefined` as its key name writes the current node and returns `this`; a named setter returns a new child wrapper. The generic `SetKeyValuesValue` requires a string key name.

### Serialization and files

| Method | Behavior |
| --- | --- |
| `SetKeyValuesEscapeSequencesEnabled(bEscapeSequencesEnabled = true)` | Sets the wrapper's strict boolean parse mode and returns the resulting boolean mode. |
| `LoadKeyValuesFromBufferInPlace(strKeyValuesBuffer)` | Loads text synchronously and returns native success; a loader failure still invalidates descendant handles. |
| `LoadKeyValuesFromFileInPlace(strFileName, LoadOptions = {})` | Loads a Source filesystem path synchronously and returns native success; a loader failure still invalidates descendant handles. |
| `SaveKeyValuesToFile(strFileName)` | Saves this tree through the selected SDK. |
| `ConvertKeyValuesToString()` | Serializes this tree using the selected SDK. Throws on an SDK buffer error or invalid byte range; a valid empty result is `""`. |

Release descendant wrappers before an in-place load attempt. Once the native loader is reached, all their handles are invalidated even when it returns `false`; neither prior tree contents nor handle validity have a transactional rollback guarantee.

### Iteration

`KeyValuesInstance[Symbol.iterator]()` creates a `KeyValuesIterator` and yields direct child names in native peer order. Construction retains the first child wrapper; each `next()` reads that child and acquires its next peer before releasing the current wrapper. This is live traversal, not a snapshot: later peer changes can affect results, but inserting before an already pending child does not rewind the iterator. Do not delete, clear, load, or transfer the native tree while an iterator retains a child; invalidated handles can throw on `next()`.

## `KeyValuesIterator`

| Member | Behavior |
| --- | --- |
| `new KeyValuesIterator(KeyValuesValue)` | Starts at `FirstSubKeyValues`. |
| `NextKeyValues` | Iterator-managed pending non-owning child wrapper or `null`; released by `next()`/`return()`, so do not destroy it directly. |
| `next()` | Releases the current wrapper and returns the standard iterator result `{ done: false, value: strKeyName }`, or `{ done: true, value: undefined }` when exhausted. |
| `return()` | Releases the pending wrapper and returns `{ done: true, value: undefined }`. |
| `[Symbol.iterator]()` | Returns the same iterator. |

Ordinary `for...of` and spread syntax use the standard iterator protocol; `done`, `value`, `next`, and `return` are external protocol names, not project-owned PascalCase fields. A normal early `for...of` exit calls `return()`. Direct users should call `return()` in `finally` when stopping before `done`; do not rely on garbage collection to release a pending wrapper.

## Workflows

The four owning-tree validation examples immediately below attempt each retained wrapper's cleanup even when an earlier cleanup throws. Once a root has been returned, a sole operation or cleanup failure is rethrown unchanged; multiple failures become an `AggregateError` with the operation failure first, followed by cleanup failures in attempted order. A thrown destroy does not prove that native release succeeded; these examples do not retry it automatically.

### Create a plugin configuration tree

```js
const { CreateKeyValues } = require("keyvalues");

const g_ValidatePluginConfiguration = () => {
	const PluginConfiguration = CreateKeyValues("SourceJSPlugin", { Enabled: 1, Limits: { MaximumPlayers: 8 }, Mode: "COOP" });
	const vecFailures = [];
	try {
		const RetryCountKeyValues = PluginConfiguration.SetKeyValuesInteger("RetryCount", 3);
		RetryCountKeyValues.DestroyKeyValues();

		if (PluginConfiguration.GetKeyValuesString("Mode") !== "COOP") {
			throw new Error("Unexpected plugin mode.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		PluginConfiguration.DestroyKeyValues();
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Plugin configuration validation or cleanup failed.");
	}
};

g_ValidatePluginConfiguration();
```

### Use every typed value family

```js
const { KeyValues } = require("keyvalues");
const { Color } = require("colors");
const { GetGlobalVariables } = require("globals");

const g_ValidateTypedKeyValues = () => {
	const GlobalVariables = GetGlobalVariables();
	if (GlobalVariables.MapName.length === 0) {
		throw new Error("Typed KeyValues example requires a loaded map.");
	}

	const RuntimeStateKeyValues = new KeyValues("RuntimeState");
	const vecFailures = [];

	function ReleaseChildKeyValues(ChildKeyValues) {
		if (ChildKeyValues !== RuntimeStateKeyValues) {
			ChildKeyValues.DestroyKeyValues();
		}
	}

	try {
		ReleaseChildKeyValues(RuntimeStateKeyValues.SetKeyValuesString("MapName", GlobalVariables.MapName));
		ReleaseChildKeyValues(RuntimeStateKeyValues.SetKeyValuesInteger("Round", 2));
		ReleaseChildKeyValues(RuntimeStateKeyValues.SetKeyValuesUInt64("WorkshopID", 4294967296n));
		ReleaseChildKeyValues(RuntimeStateKeyValues.SetKeyValuesFloat("Scale", 1.25));
		ReleaseChildKeyValues(RuntimeStateKeyValues.SetKeyValuesColor("Accent", new Color(64, 192, 255, 255)));
		ReleaseChildKeyValues(RuntimeStateKeyValues.SetKeyValuesAddress("GlobalVariablesAddress", GlobalVariables.Address));

		if ((typeof RuntimeStateKeyValues.SetKeyValuesBoolean === "function") && (typeof RuntimeStateKeyValues.GetKeyValuesBoolean === "function")) {
			ReleaseChildKeyValues(RuntimeStateKeyValues.SetKeyValuesBoolean("Ready", true));

			if (!RuntimeStateKeyValues.GetKeyValuesBoolean("Ready")) {
				throw new Error("Boolean state was not stored.");
			}
		}

		if (RuntimeStateKeyValues.GetKeyValuesType("Accent") === RuntimeStateKeyValues.GetKeyValuesType("MapName")) {
			throw new Error("Typed fields must retain distinct SDK types.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		RuntimeStateKeyValues.DestroyKeyValues();
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Typed KeyValues validation or cleanup failed.");
	}
};

g_ValidateTypedKeyValues();
```

### Inspect live key wrappers and symbols

```js
const { KeyValues } = require("keyvalues");

const g_ValidateLiveKeyWrappers = () => {
	const MetadataKeyValues = KeyValues.CreateKeyValuesFromObject("Metadata", { Version: 1, Author: "SourceJS" });
	const vecFailures = [];
	let AuthorKeyValues = null;
	let AuthorKeyValuesBySymbol = null;

	try {
		AuthorKeyValues = MetadataKeyValues.FindKeyValuesKey("Author");
		if (AuthorKeyValues === null) {
			throw new Error("Author key was not created.");
		}

		AuthorKeyValuesBySymbol = MetadataKeyValues.FindKeyValuesKeyBySymbol(AuthorKeyValues.KeyNameSymbol);
		if (AuthorKeyValuesBySymbol === null) {
			throw new Error("Author symbol could not be resolved.");
		}

		if ((AuthorKeyValuesBySymbol.Name !== AuthorKeyValues.Name) || (AuthorKeyValuesBySymbol.KeyValuesValue !== "SourceJS")) {
			throw new Error("Key symbol lookup returned the wrong value.");
		}

		if (MetadataKeyValues.GetKeyValuesKeyOrDefault("Missing", null) !== null) {
			throw new Error("GetKeyValuesKeyOrDefault() default-result behavior changed.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	for (const KeyValuesWrapper of [AuthorKeyValuesBySymbol, AuthorKeyValues, MetadataKeyValues]) {
		if (KeyValuesWrapper !== null) {
			try {
				KeyValuesWrapper.DestroyKeyValues();
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Key wrapper validation or cleanup failed.");
	}
};

g_ValidateLiveKeyWrappers();
```

### Traverse values and nested sections

```js
const { KeyValues } = require("keyvalues");

const g_ValidateKeyValuesTraversal = () => {
	const TreeKeyValues = KeyValues.CreateKeyValuesFromObject("Tree", { Visible: 1, Server: { Name: "SourceJS Test" }, Mode: "COOP" });
	const vecFailures = [];
	let FirstChildKeyValues = null;
	let FirstSectionKeyValues = null;
	let FirstScalarKeyValues = null;
	let NextScalarKeyValues = null;

	try {
		FirstChildKeyValues = TreeKeyValues.FirstSubKeyValues;
		FirstSectionKeyValues = TreeKeyValues.FirstTrueSubKeyValues;
		FirstScalarKeyValues = TreeKeyValues.FirstValueKeyValues;
		if ((FirstChildKeyValues === null) || (FirstSectionKeyValues === null) || (FirstScalarKeyValues === null)) {
			throw new Error("Native traversal did not return the expected first keys.");
		}

		NextScalarKeyValues = FirstScalarKeyValues.NextValueKeyValues;
		if (NextScalarKeyValues === null) {
			throw new Error("Native traversal did not return the next scalar.");
		}

		if ((FirstChildKeyValues.Name !== "Visible") || (FirstSectionKeyValues.Name !== "Server") || (NextScalarKeyValues.Name !== "Mode")) {
			throw new Error("Native traversal order changed.");
		}

		const vecKeyNames = [...TreeKeyValues];
		if (vecKeyNames.join(",") !== TreeKeyValues.GetKeyValuesKeyNames().join(",")) {
			throw new Error("Iterator and native key order disagree.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	for (const KeyValuesWrapper of [NextScalarKeyValues, FirstScalarKeyValues, FirstSectionKeyValues, FirstChildKeyValues, TreeKeyValues]) {
		if (KeyValuesWrapper !== null) {
			try {
				KeyValuesWrapper.DestroyKeyValues();
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "KeyValues traversal or cleanup failed.");
	}
};

g_ValidateKeyValuesTraversal();
```

### Attach and detach an owned subtree

```js
const { KeyValues } = require("keyvalues");

const g_ValidateOwnedSubtreeTransfer = () => {
	const RootKeyValues = new KeyValues("Root");
	const vecFailures = [];
	let CacheKeyValues = null;
	let AttachedCacheKeyValues = null;
	let bCacheKeyValuesCleanupAttempted = false;

	try {
		CacheKeyValues = KeyValues.CreateKeyValuesFromObject("Cache", { Generation: 4 });
		const AddedCacheKeyValues = RootKeyValues.AddKeyValuesSubKey(CacheKeyValues);
		if (AddedCacheKeyValues !== CacheKeyValues) {
			throw new Error("Cache subtree attachment failed.");
		}

		bCacheKeyValuesCleanupAttempted = true;
		CacheKeyValues.DestroyKeyValues();

		AttachedCacheKeyValues = RootKeyValues.FindKeyValuesKey("Cache");
		if (AttachedCacheKeyValues === null) {
			throw new Error("Attached cache subtree could not be resolved.");
		}

		if (!RootKeyValues.RemoveKeyValuesSubKey(AttachedCacheKeyValues)) {
			throw new Error("Could not detach the cache subtree.");
		}

		if (AttachedCacheKeyValues.GetKeyValuesInteger("Generation") !== 4) {
			throw new Error("Detached subtree lost its value.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	// Do not retry the early wrapper-release attempt if it throws before its outcome is known.
	for (const KeyValuesWrapper of [AttachedCacheKeyValues, bCacheKeyValuesCleanupAttempted ? null : CacheKeyValues, RootKeyValues]) {
		if (KeyValuesWrapper !== null) {
			try {
				KeyValuesWrapper.DestroyKeyValues();
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Subtree transfer or cleanup failed.");
	}
};

g_ValidateOwnedSubtreeTransfer();
```

### Replace a peer with `NextKeyValues`

```js
const { KeyValues } = require("keyvalues");

const g_ValidatePeerReplacement = () => {
	const PeerTreeKeyValues = KeyValues.CreateKeyValuesFromObject("Peers", { First: 1, Second: 2 });
	const vecFailures = [];
	let FirstPeerKeyValues = null;
	let DetachedSecondPeerKeyValues = null;
	let ReplacementPeerKeyValues = null;

	try {
		FirstPeerKeyValues = PeerTreeKeyValues.FirstSubKeyValues;
		if (FirstPeerKeyValues === null) {
			throw new Error("First peer could not be resolved.");
		}

		DetachedSecondPeerKeyValues = FirstPeerKeyValues.NextKeyValues;
		if (DetachedSecondPeerKeyValues === null) {
			throw new Error("Second peer could not be resolved.");
		}

		ReplacementPeerKeyValues = KeyValues.CreateKeyValuesFromObject("Replacement", { Active: 1 });
		FirstPeerKeyValues.NextKeyValues = ReplacementPeerKeyValues;

		if (PeerTreeKeyValues.GetKeyValuesKeyNames().join(",") !== "First,Replacement") {
			throw new Error("Peer replacement did not update the native tree.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	for (const KeyValuesWrapper of [ReplacementPeerKeyValues, DetachedSecondPeerKeyValues, FirstPeerKeyValues, PeerTreeKeyValues]) {
		if (KeyValuesWrapper !== null) {
			try {
				KeyValuesWrapper.DestroyKeyValues();
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Peer replacement or cleanup failed.");
	}
};

g_ValidatePeerReplacement();
```

### Create numeric keys and independent copies

```js
const { KeyValues } = require("keyvalues");

const g_ValidateIndependentKeyValuesCopies = () => {
	const SourceKeyValues = KeyValues.CreateKeyValuesFromObject("Source", { Mode: "COOP" });
	const vecFailures = [];
	let KeyValuesCopy = null;
	let TargetKeyValues = null;
	let NumberedKeyValues = null;
	let CopiedModeKeyValues = null;

	try {
		KeyValuesCopy = SourceKeyValues.CreateKeyValuesCopy();
		TargetKeyValues = KeyValues.CreateKeyValuesFromObject("Target", { Stale: 1 });

		NumberedKeyValues = SourceKeyValues.CreateKeyValuesKey();
		if (NumberedKeyValues.SetKeyValuesString(null, "generated") !== NumberedKeyValues) {
			throw new Error("Current-node string write did not return its wrapper.");
		}

		if (TargetKeyValues.CopyKeyValuesRecursively(SourceKeyValues) !== TargetKeyValues) {
			throw new Error("CopyKeyValuesRecursively() did not return the target tree.");
		}

		CopiedModeKeyValues = KeyValuesCopy.SetKeyValuesString("Mode", "VERSUS");

		if ((SourceKeyValues.GetKeyValuesString("Mode") !== "COOP") || (KeyValuesCopy.GetKeyValuesString("Mode") !== "VERSUS") || TargetKeyValues.HasKeyValuesKey("Stale")) {
			throw new Error("Copy isolation failed.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	for (const KeyValuesWrapper of [CopiedModeKeyValues, NumberedKeyValues, TargetKeyValues, KeyValuesCopy, SourceKeyValues]) {
		if (KeyValuesWrapper !== null) {
			try {
				KeyValuesWrapper.DestroyKeyValues();
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Independent copy validation or cleanup failed.");
	}
};

g_ValidateIndependentKeyValuesCopies();
```

### Delete and clear transient state

```js
const { KeyValues } = require("keyvalues");

const g_ValidateTransientKeyValuesCleanup = () => {
	const TransientKeyValues = KeyValues.CreateKeyValuesFromObject("Transient", { Finished: 0, Phase: "WARMUP" });
	const vecFailures = [];
	try {
		if (!TransientKeyValues.HasKeyValuesKey("Phase") || !TransientKeyValues.DeleteKeyValuesKey("Phase")) {
			throw new Error("Could not delete the phase key.");
		}

		TransientKeyValues.ClearKeyValues();

		if (!TransientKeyValues.IsKeyValuesEmpty() || (TransientKeyValues.GetKeyValuesKeyNames().length !== 0)) {
			throw new Error("ClearKeyValues() did not reset the tree.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		TransientKeyValues.DestroyKeyValues();
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Transient state validation or cleanup failed.");
	}
};

g_ValidateTransientKeyValuesCleanup();
```

### Build point-in-time JavaScript collections

```js
const { KeyValues } = require("keyvalues");
const { GetGlobalVariables } = require("globals");

const g_ValidatePointInTimeCollections = () => {
	const GlobalVariables = GetGlobalVariables();
	if (GlobalVariables.MapName.length === 0) {
		throw new Error("Collection conversion example requires a loaded map.");
	}

	const RotationKeyValues = KeyValues.CreateKeyValuesFromObject("Rotation", { First: GlobalVariables.MapName, Second: GlobalVariables.StartSpot });
	const vecFailures = [];
	try {
		const vecKeyValuesValues = RotationKeyValues.GetKeyValuesValueList();
		const vecKeyValuesEntries = RotationKeyValues.GetKeyValuesEntries();
		const PlainKeyValues = RotationKeyValues.ConvertKeyValuesToObject();
		const DirectChildValues = RotationKeyValues.DirectChildValues;
		PlainKeyValues.First = "local-only";

		if ((vecKeyValuesValues[1] !== GlobalVariables.StartSpot) || (vecKeyValuesEntries[0][0] !== "First") || (DirectChildValues.Second !== GlobalVariables.StartSpot)) {
			throw new Error("Unexpected collection conversion.");
		}

		if (RotationKeyValues.GetKeyValuesString("First") !== GlobalVariables.MapName) {
			throw new Error("Mutating the plain-object copy changed native storage.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		RotationKeyValues.DestroyKeyValues();
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Collection conversion or cleanup failed.");
	}
};

g_ValidatePointInTimeCollections();
```

### Serialize and parse through the selected SDK

```js
const { KeyValues } = require("keyvalues");

const g_ValidateKeyValuesTextRoundTrip = () => {
	const OriginalKeyValues = KeyValues.CreateKeyValuesFromObject("Vote", { Yes: 0, Question: "Restart the chapter?" });
	const vecFailures = [];
	let ParsedKeyValues = null;
	let ReusableKeyValues = null;

	try {
		const strSerializedKeyValues = OriginalKeyValues.ConvertKeyValuesToString();
		ParsedKeyValues = KeyValues.CreateKeyValuesFromBuffer(strSerializedKeyValues, true);
		ReusableKeyValues = new KeyValues("Reusable");
		if (ReusableKeyValues.SetKeyValuesEscapeSequencesEnabled(true) !== true) {
			throw new Error("KeyValues parse mode was not enabled.");
		}

		if (!ReusableKeyValues.LoadKeyValuesFromBufferInPlace(strSerializedKeyValues) || (ParsedKeyValues.GetKeyValuesString("Question") !== "Restart the chapter?")) {
			throw new Error("KeyValues text round trip failed.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	for (const KeyValuesWrapper of [ReusableKeyValues, ParsedKeyValues, OriginalKeyValues]) {
		if (KeyValuesWrapper !== null) {
			try {
				KeyValuesWrapper.DestroyKeyValues();
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Text round trip or cleanup failed.");
	}
};

g_ValidateKeyValuesTextRoundTrip();
```

### Save and reload a Source filesystem file

Run this destructive file example only with an existing, writable `cfg/sourcejs` directory and exclusive control of its temporary path. The existence check is not an atomic exclusive create: another writer could race the save or cleanup. Do not use an application configuration or shared path for this example.

```js
const { DoesFileExist, RemoveFile } = require("filesystem");
const { KeyValues } = require("keyvalues");

const g_ValidateKeyValuesFileRoundTrip = () => {
	const strKeyValuesFilePath = "cfg/sourcejs/keyvalues-example-runtime.kv";
	if (DoesFileExist(strKeyValuesFilePath)) {
		throw new Error(`Refusing to overwrite existing file: ${strKeyValuesFilePath}.`);
	}

	const SettingsKeyValues = KeyValues.CreateKeyValuesFromObject("RuntimeSettings", { Language: "en" });
	const vecFailures = [];
	let LoadedKeyValues = null;

	try {
		if (!SettingsKeyValues.SaveKeyValuesToFile(strKeyValuesFilePath)) {
			throw new Error(`Could not save ${strKeyValuesFilePath}.`);
		}

		LoadedKeyValues = KeyValues.CreateKeyValuesFromFile(strKeyValuesFilePath, { UseEscapeSequences: true });
		if (!LoadedKeyValues.LoadKeyValuesFromFileInPlace(strKeyValuesFilePath, { UseEscapeSequences: false })) {
			throw new Error(`Could not reload ${strKeyValuesFilePath}.`);
		}

		if (LoadedKeyValues.GetKeyValuesString("Language") !== "en") {
			throw new Error("Saved language did not round trip.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	for (const KeyValuesWrapper of [LoadedKeyValues, SettingsKeyValues]) {
		if (KeyValuesWrapper !== null) {
			try {
				KeyValuesWrapper.DestroyKeyValues();
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	try {
		if (DoesFileExist(strKeyValuesFilePath) && !RemoveFile(strKeyValuesFilePath)) {
			throw new Error(`Could not remove ${strKeyValuesFilePath}.`);
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "File round trip or cleanup failed.");
	}
};

g_ValidateKeyValuesFileRoundTrip();
```

### Store colors, addresses, and 64-bit IDs

```js
const { KeyValues } = require("keyvalues");
const { Color } = require("colors");
const { GetGlobalVariables } = require("globals");

const g_ValidateTypedPayloadValues = () => {
	const unWorkshopID = 0xFEDCBA9876543210n;
	const GlobalVariables = GetGlobalVariables();
	const PayloadKeyValues = new KeyValues("Payload");
	const vecFailures = [];
	try {
		PayloadKeyValues.SetKeyValuesColor("TeamColor", [80, 160, 255, 220]).DestroyKeyValues();
		PayloadKeyValues.SetKeyValuesAddress("GlobalsAddress", GlobalVariables.Address).DestroyKeyValues();
		PayloadKeyValues.SetKeyValuesUInt64("WorkshopID", unWorkshopID).DestroyKeyValues();

		const TeamColor = PayloadKeyValues.GetKeyValuesColor("TeamColor", new Color(255, 255, 255, 255));
		if ((TeamColor.ConvertColorToArray()[3] !== 220) || (PayloadKeyValues.GetKeyValuesAddress("GlobalsAddress") !== GlobalVariables.Address) || (PayloadKeyValues.GetKeyValuesUInt64("WorkshopID") !== unWorkshopID)) {
			throw new Error("Typed payload values did not round trip.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		PayloadKeyValues.DestroyKeyValues();
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Typed payload validation or cleanup failed.");
	}
};

g_ValidateTypedPayloadValues();
```

### Handle SDK-conditioned boolean methods

```js
const { KeyValues } = require("keyvalues");
const { LogInfo } = require("loggers");

const g_ValidateSDKBooleanCapability = () => {
	const FlagKeyValues = new KeyValues("Flags");
	const vecFailures = [];
	try {
		if ((typeof FlagKeyValues.SetKeyValuesBoolean === "function") && (typeof FlagKeyValues.GetKeyValuesBoolean === "function")) {
			const EnabledKeyValues = FlagKeyValues.SetKeyValuesBoolean("Enabled", true);
			EnabledKeyValues.DestroyKeyValues();

			if (!FlagKeyValues.GetKeyValuesBoolean("Enabled", false)) {
				throw new Error("Direct SDK boolean access failed.");
			}

		} else {
			LogInfo("This SDK omits direct KeyValues boolean methods.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		FlagKeyValues.DestroyKeyValues();
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Boolean capability validation or cleanup failed.");
	}
};

g_ValidateSDKBooleanCapability();
```

### Stop a direct iterator early

```js
const { KeyValues, KeyValuesIterator } = require("keyvalues");

const g_ValidateEarlyIteratorReturn = () => {
	const SessionKeyValues = new KeyValues("Session", "Mode", "COOP", "Slots", 4);
	const vecFailures = [];
	let itKeyValues = null;
	let bIteratorReturnAttempted = false;

	try {
		itKeyValues = new KeyValuesIterator(SessionKeyValues);
		const FirstIteratorResult = itKeyValues.next();
		if (FirstIteratorResult.done || (FirstIteratorResult.value !== "Mode")) {
			throw new Error("Iterator did not return the first key.");
		}

		bIteratorReturnAttempted = true;
		const CompletedIteratorResult = itKeyValues.return();
		if (!CompletedIteratorResult.done || (CompletedIteratorResult.value !== undefined) || (itKeyValues.NextKeyValues !== null)) {
			throw new Error("Iterator return did not release the pending wrapper.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		if ((itKeyValues !== null) && !bIteratorReturnAttempted) {
			itKeyValues.return();
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	try {
		SessionKeyValues.DestroyKeyValues();
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Iterator validation or cleanup failed.");
	}
};

g_ValidateEarlyIteratorReturn();
```

## Related modules

- [colors](colors.md) supplies the live `Color` class used by color accessors.
- [filesystem](filesystem.md) documents physical and Source filesystem ownership around generated files.
- [engines/server](engines-server.md) includes selected-SDK functions that can transfer an owned `KeyValues` tree to the engine.
