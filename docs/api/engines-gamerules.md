# `require("engines/gamerules")`

> Warning: this low-level selected-SDK API writes game-rules memory. Use the table of contents and read the safety and lifetime section before generating code.

`engines/gamerules` attempts to locate the current `CGameRules` instance through the selected Source 1 SDK's game-rules proxy. It exposes proxy/send-table metadata and typed reads and writes at send-property offsets. The module does not emulate a game-specific rule set in JavaScript or provide ownership of the engine instance.

Property names and layouts vary between SDK branches and game updates. Discover the current send table first, then keep a reviewed per-SDK layout for every field that a plugin writes.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import and availability](#import-and-availability)
- [Instance API](#instance-api)
- [Property descriptors](#property-descriptors)
- [Scalar properties](#scalar-properties)
- [String, address, and edict properties](#string-address-and-edict-properties)
- [Live structured views](#live-structured-views)
- [Practical workflows](#practical-workflows)
- [Safety and lifetime](#safety-and-lifetime)
- [Related modules](#related-modules)

## Location and purpose

[`packages/sourcejs/engines/gamerules.js`](../../packages/sourcejs/engines/gamerules.js) exposes the native module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). The native implementation owns proxy discovery, send-table traversal, typed memory access, live structured views, validation, and error reporting.

Use this module only for reviewed selected-SDK game-rules layouts after a map has created the current instance. Re-discover availability and property offsets after every map transition; an earlier successful lookup does not keep the instance alive. Discovery invokes a matching send-table proxy with null property/base/data arguments, so use it only with a game/SDK proxy compatible with that calling pattern. JavaScript validation is not a general guard against an incompatible native proxy or stale engine memory.

All calls are synchronous in the initialized JavaScript/server-game-thread context. They do not schedule IO-worker requests or wait for callback promises; do not move game-rules discovery or memory access onto an IO worker thread.

## Import and availability

```js
const { IsAvailable, GetProxyName, GetSendTableName } = require("engines/gamerules");

if (!IsAvailable()) {
	console.log("The game-rules lookup returned no instance in the current server state.");
} else {
	console.log(`${GetProxyName()} uses ${GetSendTableName()}.`);
}
```

The native module is installed only in builds with `SOURCEJS_HAS_GAMERULES`; importing it can fail when that selected-SDK feature is absent. When the module is present, importing it does not establish that an instance exists. `IsAvailable()` calls the native instance lookup and returns whether its result is non-null; it does not inspect a menu/map-transition flag or validate the full memory layout. A false result alone does not identify the cause. `GetProxyName()` and `GetSendTableName()` are independent calls and can throw even after a positive availability check.

Do not cache a positive availability result across map changes or treat it as a lifetime lock. The example calls discovery under the proxy compatibility requirements above; it cannot make an incompatible native proxy safe.

## Instance API

| Function | Return | Behavior |
| --- | --- | --- |
| `IsAvailable()` | `boolean` | Reports whether the proxy currently resolves a game-rules instance. |
| `GetAddress()` | `bigint` | Looks up the current `CGameRules` instance and returns its address as a JavaScript `BigInt`; throws if lookup returns null. The returned address is borrowed, not a lifetime guarantee. |
| `GetProxyName()` | `string` | Reads the `classname` value from `GameRulesCreation` and appends `Proxy`; throws when the required name data is missing, empty, or has a non-positive SDK byte length. It does not itself require an instance lookup. |
| `GetSendTableName()` | `string` | Returns the proxy's send-table name; throws when the table or its native name pointer is unavailable. This is a metadata lookup, not an instance lifetime check. |
| `FindPropertyOffset(strGameRulesPropertyName)` | `number` | Resolves a property name or dotted path to the descriptor's signed native byte offset. Invalid names or a failed lookup throw; it does not acquire an instance or validate the complete memory range at that offset. |
| `Find()` | receiver object | Requires a non-null instance lookup and returns the call's `this` object. Call as `g_GameRulesModule.Find()` to receive that module object; a detached or rebound call does not guarantee module identity. |
| `ListProperties()` | `Array<object>` | Creates a new descriptor array by traversing the current send table, including nested tables. Throws when the root table is missing; traversal is capped at 32 nested data-table levels and skips offsets outside signed `int` range, so the result can be incomplete. It does not acquire or retain the game-rules instance. |

Proxy-name lookup reads only the SDK-reported positive byte range and removes at most one final NUL byte. A positive-length name without a final NUL remains bounded by that length; a missing or non-positive length never falls back to an unbounded C-string scan. The buffer still belongs to the engine, so its address and reported extent must remain valid during the call.

Native callbacks preserve JavaScript exceptions and translate native exceptions
with operation context. Failed V8 conversions or descriptor collection stop the
call before a successful result is published. Ordinary negative outcomes such as
`IsAvailable() === false` are unchanged. Native GameRules functions are installed
as own data properties; inherited setters do not intercept their installation.

Call `Find()` through the module to preserve its receiver. This example checks availability, then performs a separate required-instance lookup; the later calls can still throw if discovery fails. Neither lookup pins the native instance:

```js
const g_GameRulesModule = require("engines/gamerules");

if (g_GameRulesModule.IsAvailable()) {
	const CurrentGameRulesModule = g_GameRulesModule.Find();
	console.log(CurrentGameRulesModule === g_GameRulesModule);
	console.log(CurrentGameRulesModule.GetAddress());
}
```

## Property descriptors

Each successfully constructed descriptor has the following public keys. Preserve their exact PascalCase spelling; these are API fields, not implementation variable names:

| Field | Type | Meaning |
| --- | --- | --- |
| `Name` | `string` | Send-property name, or an empty string when the native name is null. Data-table entries are included too. |
| `Path` | `string` | Dotted path assembled during nested send-table traversal. Prefer it over an ambiguous leaf name, but validate it for the selected layout. |
| `Offset` | `number` | Signed native `int` byte offset accumulated through the send tables; not proof of a valid memory range relative to an instance. |
| `Type` | `string` | Send type: `int`, `float`, `vector`, `string`, `array`, `datatable`, or `unknown`; `vectorxy` is recognized only when `SOURCEJS_HAS_DPT_VECTORXY` is enabled. |
| `TypeID` | `number` | Raw selected-SDK `SendPropType` value. |
| `Flags` | `number` | Raw send-property flags. |
| `BitCount` | `number` | Network bit count. This is not necessarily the C++ field width. |
| `ElementCount` | `number` | Signed native element count reported by the SDK; meaningful according to that property's contract. |
| `ElementStride` | `number` | Signed native element stride in bytes; not independently validated as a safe array layout. |

Enumeration is not a completeness check. Starting at depth zero, traversal skips branches beyond depth 32, null properties, and accumulated offsets outside the native `int` range without reporting a separate completeness status. Descriptor-construction or array-insertion failures instead abort the call and propagate an error; no partially built array is returned as a successful result. Inspect required fields explicitly before using a layout.

This helper reports the enumerated metadata without assuming one SDK layout. The output retains signed numeric categories and does not establish that enumeration is complete or that any field is safe to write:

```js
const { IsAvailable, ListProperties } = require("engines/gamerules");

function CreateGameRulesPropertyReport(GameRulesPropertyDescriptor) {
	return {
		PropertyPath: GameRulesPropertyDescriptor.Path,
		PropertyType: GameRulesPropertyDescriptor.Type,
		BitCount: GameRulesPropertyDescriptor.BitCount,
		ElementCount: GameRulesPropertyDescriptor.ElementCount,
		OffsetBytes: GameRulesPropertyDescriptor.Offset,
	};
}

if (IsAvailable()) {
	const vecGameRulesPropertyDescriptors = ListProperties();
	const vecGameRulesPropertyReport = vecGameRulesPropertyDescriptors.map(CreateGameRulesPropertyReport);
	console.log(JSON.stringify(vecGameRulesPropertyReport, null, 2));
}
```

Prefer the dotted `Path` when nested tables contain the same leaf name. The binding's recursive traversal accepts names and paths and returns its first match; a leaf-only lookup is not an ambiguity check. Matching is case-sensitive and preserves exact native field names.

The following diagnostic computes an address with exact `BigInt` arithmetic after checking descriptor consistency and the signed native offset. It does not dereference the result, validate the field's full extent/alignment or keep the instance alive. Separate lookups are not an atomic snapshot:

```js
const { IsAvailable, GetAddress, FindPropertyOffset, ListProperties } = require("engines/gamerules");

function GetGameRulesPropertyAddress(strPropertyPath) {
	function IsRequestedProperty(GameRulesPropertyDescriptor) {
		return GameRulesPropertyDescriptor.Path === strPropertyPath;
	}

	const GameRulesPropertyDescriptor = ListProperties().find(IsRequestedProperty);
	if (!GameRulesPropertyDescriptor) {
		throw new Error(`Unknown game-rules property: ${strPropertyPath}.`);
	}

	const nPropertyOffsetBytes = FindPropertyOffset(GameRulesPropertyDescriptor.Path);
	if (!Number.isSafeInteger(nPropertyOffsetBytes) || (nPropertyOffsetBytes < 0)) {
		throw new RangeError(`Invalid game-rules property offset: ${nPropertyOffsetBytes}.`);
	}

	if (nPropertyOffsetBytes !== GameRulesPropertyDescriptor.Offset) {
		throw new Error(`Offset changed while resolving ${GameRulesPropertyDescriptor.Path}.`);
	}

	const unGameRulesAddress = GetAddress();
	if ((typeof unGameRulesAddress !== "bigint") || (unGameRulesAddress <= 0n)) {
		throw new RangeError("The game-rules address is invalid.");
	}

	return unGameRulesAddress + BigInt(nPropertyOffsetBytes);
}

if (IsAvailable()) {
	const FirstGameRulesPropertyDescriptor = ListProperties()[0];
	if (FirstGameRulesPropertyDescriptor) {
		console.log(GetGameRulesPropertyAddress(FirstGameRulesPropertyDescriptor.Path));
	}
}
```

## Scalar properties

Property names or dotted paths must be non-empty UTF-8-encodable strings without embedded NUL. Setters report successful writes with `true`; argument validation, failed property lookup, missing instances and rejected address arithmetic produce JavaScript errors. Value checks depend on the selected setter. The shared address helper checks a nonnegative offset and representable base-plus-offset arithmetic. Integer, boolean, character and floating-point accessors additionally validate the full native scalar's representable address range before byte copying. These checks do not establish memory mapping, access rights, actual field extent, representation or compatibility with the chosen C++ storage type. Use only a reviewed live layout; a successful write does not establish network replication or game-specific validity.

### Boolean, character, and floating-point properties

For a live, independently reviewed native float property, import `SetPropertyFloat` from `engines/gamerules`. Supply its path as `strPropertyPath` and a finite application value as `flSeconds`.

| Use | Example |
| --- | --- |
| Set a reviewed duration without converting text to a native float. | `const bDurationUpdated = SetPropertyFloat(strPropertyPath, flSeconds);` |

| Getter | Setter | JavaScript value |
| --- | --- | --- |
| `GetPropertyBoolean(strGameRulesPropertyName)` | `SetPropertyBoolean(strGameRulesPropertyName, bGameRulesPropertyValue)` | Getter copies native `bool` storage and returns a boolean; setter accepts only a JavaScript boolean and copies `sizeof(bool)` bytes. Requires a valid native `bool` representation and extent, not an arbitrary integer or packed bitfield. |
| `GetPropertyCharacter(strGameRulesPropertyName)` | `SetPropertyCharacter(strGameRulesPropertyName, GameRulesPropertyValue)` | Getter converts one native `char` through a NUL-terminated UTF-8 string; a zero byte returns an empty string, not a numeric zero. Setter requires the complete UTF-8 encoding of a string to contain exactly one byte (a single NUL is allowed), or accepts an integral `number`/losslessly converted `bigint` within the target's native `char` range. Empty, multibyte and NUL-plus-trailing-data strings are rejected before writing; there is no prefix truncation. Native `char` signedness is platform-dependent. This is not a general Unicode-character or arbitrary-byte round trip. |
| `GetPropertyFloat(strGameRulesPropertyName)` | `SetPropertyFloat(strGameRulesPropertyName, flGameRulesPropertyValue)` | Getter copies native `float` storage into a JavaScript number without checking finiteness. Setter accepts only a finite JavaScript `number` within the native float range, then converts to `float`; rounding or underflow can occur. `bigint` and numeric strings are rejected. Requires valid native float storage and extent. |
| `GetPropertyDouble(strGameRulesPropertyName)` | `SetPropertyDouble(strGameRulesPropertyName, dblGameRulesPropertyValue)` | Getter copies native `double` storage into a JavaScript number without checking finiteness. Setter accepts only a finite JavaScript `number`; `bigint` and numeric strings are rejected. Requires valid native double storage and extent, not a float field selected merely because its send type is floating-point. |

The send type does not identify `bool` versus another integer field. A reviewed SDK layout must make that decision. This example uses `CTeamplayRoundBasedRules`-style names also present in the project smoke fixture; that fixture does not establish their presence or native storage types in a selected game. Run it only after reviewing that game's SDK layout and confirming the current instance lifetime. A matching name alone is insufficient, and duplicate leaf names are rejected:

```js
const { IsAvailable, ListProperties, GetPropertyBoolean, GetPropertyFloat } = require("engines/gamerules");

function FindGameRulesPropertyDescriptor(strPropertyLeafName) {
	function IsRequestedProperty(GameRulesPropertyDescriptor) {
		return GameRulesPropertyDescriptor.Name === strPropertyLeafName;
	}

	const vecMatchingProperties = ListProperties().filter(IsRequestedProperty);
	if (vecMatchingProperties.length > 1) {
		throw new Error(`Ambiguous game-rules property: ${strPropertyLeafName}.`);
	}

	return vecMatchingProperties[0] ?? null;
}

if (IsAvailable()) {
	const WaitingGameRulesPropertyDescriptor = FindGameRulesPropertyDescriptor("m_bInWaitingForPlayers");
	const RestartTimeGameRulesPropertyDescriptor = FindGameRulesPropertyDescriptor("m_flRestartRoundTime");

	if (WaitingGameRulesPropertyDescriptor) {
		console.log(`Waiting=${GetPropertyBoolean(WaitingGameRulesPropertyDescriptor.Path)}`);
	}

	if (RestartTimeGameRulesPropertyDescriptor) {
		console.log(`RestartTimeSeconds=${GetPropertyFloat(RestartTimeGameRulesPropertyDescriptor.Path)}`);
	}
}
```

For a reviewed native boolean field, use `finally` to attempt restoration after a synchronous callback, including when it throws. This is not a transaction: restoration can fail or replace the callback's exception, and nested code can observe or overwrite the temporary value. The callback must not return asynchronous work or invalidate the instance/layout. A setter failure before entering `try` does not trigger restoration:

```js
const { IsAvailable, ListProperties, GetPropertyBoolean, SetPropertyBoolean } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesBoolean(strPropertyPath, bTemporaryValue, RunSynchronouslyWithTemporaryBoolean) {
	const bPreviousValue = GetPropertyBoolean(strPropertyPath);

	if (!SetPropertyBoolean(strPropertyPath, bTemporaryValue)) {
		throw new Error(`Could not set temporary game-rules boolean: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryBoolean();
	} finally {
		if (!SetPropertyBoolean(strPropertyPath, bPreviousValue)) {
			throw new Error(`Could not restore game-rules boolean: ${strPropertyPath}.`);
		}
	}
}

if (IsAvailable()) {
	function IsWaitingGameRulesProperty(GameRulesPropertyDescriptor) {
		return GameRulesPropertyDescriptor.Name === "m_bInWaitingForPlayers";
	}

	const vecWaitingGameRulesProperties = ListProperties().filter(IsWaitingGameRulesProperty);
	if (vecWaitingGameRulesProperties.length > 1) {
		throw new Error("Ambiguous waiting-for-players property; select a reviewed full path.");
	}

	const WaitingGameRulesPropertyDescriptor = vecWaitingGameRulesProperties[0];
	if (WaitingGameRulesPropertyDescriptor) {
		function LogGameRulesWaitingStatus() {
			console.log(GetPropertyBoolean(WaitingGameRulesPropertyDescriptor.Path));
		}

		RunSynchronouslyWithTemporaryGameRulesBoolean(WaitingGameRulesPropertyDescriptor.Path, false, LogGameRulesWaitingStatus);
	}
}
```

For a reviewed one-byte character field, the string getter cannot preserve every possible byte. This helper supports an original NUL or ASCII byte and rejects other decoded values before writing. It restores NUL using numeric zero because the setter rejects the getter's empty-string result. Restoration is still only attempted: the same synchronous-callback, stable-layout and cleanup-failure restrictions apply:

```js
const { GetPropertyCharacter, SetPropertyCharacter } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesCharacter(strPropertyPath, GameRulesPropertyValue, RunSynchronouslyWithTemporaryCharacter) {
	const strPreviousCharacter = GetPropertyCharacter(strPropertyPath);
	if ((strPreviousCharacter.length > 1) || ((strPreviousCharacter.length === 1) && (strPreviousCharacter.charCodeAt(0) > 0x7F))) {
		throw new Error(`Cannot restore the original byte through the character API: ${strPropertyPath}.`);
	}

	const PreviousCharacterValue = (strPreviousCharacter === "") ? 0 : strPreviousCharacter;

	if (!SetPropertyCharacter(strPropertyPath, GameRulesPropertyValue)) {
		throw new Error(`Could not set temporary game-rules character: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryCharacter(GetPropertyCharacter(strPropertyPath));
	} finally {
		if (!SetPropertyCharacter(strPropertyPath, PreviousCharacterValue)) {
			throw new Error(`Could not restore game-rules character: ${strPropertyPath}.`);
		}
	}
}
```

For a reviewed native double field, reject a non-finite original value before writing: the getter can return it, but the setter cannot restore it. The helper attempts restoration after a synchronous callback; restoration can fail or replace an earlier exception. Keep the instance/layout valid throughout, and do not return asynchronous work:

```js
const { GetPropertyDouble, SetPropertyDouble } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesDouble(strPropertyPath, dblTemporaryValue, RunSynchronouslyWithTemporaryDouble) {
	const dblPreviousValue = GetPropertyDouble(strPropertyPath);
	if (!Number.isFinite(dblPreviousValue)) {
		throw new RangeError(`Cannot restore a non-finite game-rules double: ${strPropertyPath}.`);
	}

	if (!SetPropertyDouble(strPropertyPath, dblTemporaryValue)) {
		throw new Error(`Could not set temporary game-rules double: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryDouble(GetPropertyDouble(strPropertyPath));
	} finally {
		if (!SetPropertyDouble(strPropertyPath, dblPreviousValue)) {
			throw new Error(`Could not restore game-rules double: ${strPropertyPath}.`);
		}
	}
}
```

### Signed and unsigned integers

| Getter | Setter | Getter result | Valid range |
| --- | --- | --- | --- |
| `GetPropertyInt8(strGameRulesPropertyName)` | `SetPropertyInt8(strGameRulesPropertyName, nGameRulesPropertyValue)` | `number` | `-128` through `127` |
| `GetPropertyUInt8(strGameRulesPropertyName)` | `SetPropertyUInt8(strGameRulesPropertyName, unGameRulesPropertyValue)` | `number` | `0` through `255` |
| `GetPropertyInt16(strGameRulesPropertyName)` | `SetPropertyInt16(strGameRulesPropertyName, nGameRulesPropertyValue)` | `number` | `-32768` through `32767` |
| `GetPropertyUInt16(strGameRulesPropertyName)` | `SetPropertyUInt16(strGameRulesPropertyName, unGameRulesPropertyValue)` | `number` | `0` through `65535` |
| `GetPropertyInt32(strGameRulesPropertyName)` | `SetPropertyInt32(strGameRulesPropertyName, nGameRulesPropertyValue)` | `number` | signed 32-bit integer |
| `GetPropertyUInt32(strGameRulesPropertyName)` | `SetPropertyUInt32(strGameRulesPropertyName, unGameRulesPropertyValue)` | `number` | unsigned 32-bit integer |
| `GetPropertyInt64(strGameRulesPropertyName)` | `SetPropertyInt64(strGameRulesPropertyName, nGameRulesPropertyValue)` | `bigint` | signed 64-bit integer |
| `GetPropertyUInt64(strGameRulesPropertyName)` | `SetPropertyUInt64(strGameRulesPropertyName, unGameRulesPropertyValue)` | `bigint` | unsigned 64-bit integer |

The 8/16/32-bit integer setters accept in-range safe-integer `number` or in-range `bigint` values. The 64-bit setters require in-range `bigint` values, even when a `number` is within JavaScript's safe-integer range. All integer setters reject strings. Converting an already rounded `number` to `bigint` cannot recover the original integer.

The getter/setter width selects the number of native bytes copied, not the send property's network bit count. These functions require a reviewed matching storage type and extent; choosing a wider accessor does not widen the underlying field.

A plugin can keep the reviewed storage width beside each SDK-specific path. This dispatcher passes the value directly to the selected setter; that setter's conversion rules still apply. The callback must complete synchronously: do not return asynchronous work or change the active game-rules instance or its layout. If the initial setter fails before entering `try`, no restoration is attempted. Restoration in `finally` can fail and replace an earlier exception; this is not an atomic update. The private dispatch-table keys are compact storage-type discriminator strings, not public API property names:

```js
const {
	GetPropertyInt8,
	GetPropertyUInt8,
	GetPropertyInt16,
	GetPropertyUInt16,
	GetPropertyInt32,
	GetPropertyUInt32,
	GetPropertyInt64,
	GetPropertyUInt64,
	SetPropertyInt8,
	SetPropertyUInt8,
	SetPropertyInt16,
	SetPropertyUInt16,
	SetPropertyInt32,
	SetPropertyUInt32,
	SetPropertyInt64,
	SetPropertyUInt64,
} = require("engines/gamerules");

const g_GameRulesIntegerAccessors = Object.freeze({
	"int8": [GetPropertyInt8, SetPropertyInt8],
	"uint8": [GetPropertyUInt8, SetPropertyUInt8],
	"int16": [GetPropertyInt16, SetPropertyInt16],
	"uint16": [GetPropertyUInt16, SetPropertyUInt16],
	"int32": [GetPropertyInt32, SetPropertyInt32],
	"uint32": [GetPropertyUInt32, SetPropertyUInt32],
	"int64": [GetPropertyInt64, SetPropertyInt64],
	"uint64": [GetPropertyUInt64, SetPropertyUInt64],
});

function RunSynchronouslyWithTemporaryGameRulesInteger(strPropertyPath, strStorageType, TemporaryIntegerValue, RunSynchronouslyWithTemporaryInteger) {
	if (!Object.hasOwn(g_GameRulesIntegerAccessors, strStorageType)) {
		throw new Error(`Unsupported integer storage: ${strStorageType}.`);
	}

	const vecGameRulesIntegerAccessors = g_GameRulesIntegerAccessors[strStorageType];
	const [GetGameRulesIntegerValue, SetGameRulesIntegerValue] = vecGameRulesIntegerAccessors;
	const PreviousIntegerValue = GetGameRulesIntegerValue(strPropertyPath);

	if (!SetGameRulesIntegerValue(strPropertyPath, TemporaryIntegerValue)) {
		throw new Error(`Could not set temporary game-rules integer: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryInteger(GetGameRulesIntegerValue(strPropertyPath));
	} finally {
		if (!SetGameRulesIntegerValue(strPropertyPath, PreviousIntegerValue)) {
			throw new Error(`Could not restore game-rules integer: ${strPropertyPath}.`);
		}
	}
}
```

The bundled TF2 SDK declares `m_iRoundState` as `CNetworkVar(gamerules_roundstate_t, m_iRoundState)` and sends five network bits. The enum has no explicit underlying type in that header. Use the following 32-bit read only after verifying the selected build's enum storage width, representation and field extent; the network encoding does not establish them:

```js
const { IsAvailable, ListProperties, GetPropertyInt32 } = require("engines/gamerules");

function IsRoundStateProperty(GameRulesPropertyDescriptor) {
	return GameRulesPropertyDescriptor.Name === "m_iRoundState";
}

if (IsAvailable()) {
	const vecRoundStateGameRulesProperties = ListProperties().filter(IsRoundStateProperty);
	if (vecRoundStateGameRulesProperties.length > 1) {
		throw new Error("Ambiguous round-state property; select a reviewed full path.");
	}

	const RoundStateGameRulesPropertyDescriptor = vecRoundStateGameRulesProperties[0];
	if (RoundStateGameRulesPropertyDescriptor) {
		console.log(GetPropertyInt32(RoundStateGameRulesPropertyDescriptor.Path));
	}
}
```

Never select `GetPropertyInt8()` merely because a send property uses eight or fewer network bits. `BitCount` describes network encoding, not the C++ member's storage width.

## String, address, and edict properties

| Getter | Setter | Contract |
| --- | --- | --- |
| `GetPropertyStringAddress(strGameRulesPropertyName)` | `SetPropertyStringAddress(strGameRulesPropertyName, strGameRulesPropertyValue)` | Getter copies the stored native `char const*` and decodes NUL-terminated UTF-8; a null stored string address returns `""`. Non-null text must remain readable through its terminator: this getter supplies no maximum length. Setter decodes the complete UTF-8 string and rejects embedded NUL before replacing text or writing the field. It validates the complete address-field range, stores the text in a module-static map keyed by the field's address, then writes the map-owned string's `c_str()` address. That storage lasts until the entry is overwritten or the module unloads; overwriting can invalidate retained string addresses. It neither frees the previous external text nor restores its original address, and it does not own or extend the native field's lifetime. |
| `GetPropertyStringBuffer(strGameRulesPropertyName, nMaximumGameRulesStringBufferLength)` | `SetPropertyStringBuffer(strGameRulesPropertyName, strGameRulesPropertyValue, nGameRulesStringBufferCapacity)` | Inline UTF-8 buffer, not a stored string address. Both lengths must be positive signed-32-bit JavaScript integers measured in bytes, including room for NUL. Getter validates the complete claimed range, scans only within its maximum and throws if no terminator is found. Setter decodes complete UTF-8 text, rejects embedded NUL and text whose byte length is at least the capacity, validates the complete capacity range, then copies text plus terminator; remaining buffer bytes are unchanged. No prefix truncation is performed. The caller must supply a reviewed readable/writable extent: representability checks do not establish mapping or actual allocation capacity. |
| `GetPropertyAddress(strGameRulesPropertyName)` | `SetPropertyAddress(strGameRulesPropertyName, unGameRulesAddress)` | Getter copies a stored native `void*` and returns its exact address as a JavaScript `bigint`. Setter accepts only a nonnegative `bigint` within the target's `uintptr_t` range; `0n` writes null. Numbers, strings, objects, `null`, and `undefined` are rejected. Both validate the complete stored address-field range before byte copying; the field must hold a native address of the correct width. No pointee validation, ownership transfer or lifetime extension is performed. |
| `GetPropertyEdict(strGameRulesPropertyName)` | `SetPropertyEdict(strGameRulesPropertyName, EntityValue)` | Field storage must be an `edict_t*`, not an entity handle or inline index. Both validate the complete representable stored address-field range before byte copying, without requiring field alignment. This does not validate the stored edict or actual field extent. Getter resolves the stored edict to an Entity wrapper or `null`; it calls `IsFree()` on a non-null address, so arbitrary/stale addresses are unsafe. Setter accepts explicit `null`, a nonnegative integer number fitting native `int`, or an object exposing such an `Index`; no Entity class identity check is performed. Conversion errors stop before writing. It writes the engine lookup result without a separate non-null check, so a failed lookup can store null and still return `true`. Missing/invalid indexes are rejected; wrappers do not keep the edict alive. |

Keep the reviewed byte capacity beside the property path. This helper attempts to restore decoded text, not every original buffer byte: bytes after the terminator remain outside its restoration contract, and invalid UTF-8 cannot reliably round-trip through a JavaScript string. Use a valid NUL-terminated UTF-8 field and a stable instance/layout. The callback must complete synchronously and must not return asynchronous work. Restoration can fail or replace an earlier exception; an initial setter failure does not enter `finally`:

```js
const { GetPropertyStringBuffer, SetPropertyStringBuffer } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesStringBuffer(strPropertyPath, nBufferCapacity, strTemporaryText, RunSynchronouslyWithTemporaryText) {
	const strPreviousText = GetPropertyStringBuffer(strPropertyPath, nBufferCapacity);

	if (!SetPropertyStringBuffer(strPropertyPath, strTemporaryText, nBufferCapacity)) {
		throw new Error(`Could not set temporary game-rules string buffer: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryText(GetPropertyStringBuffer(strPropertyPath, nBufferCapacity));
	} finally {
		if (!SetPropertyStringBuffer(strPropertyPath, strPreviousText, nBufferCapacity)) {
			throw new Error(`Could not restore game-rules string buffer: ${strPropertyPath}.`);
		}
	}
}
```

String-address fields have different ownership from inline buffers. The setter replaces the field with an address into SourceJS's static property-address map; a later replacement can invalidate a previously retained address. This helper attempts to restore decoded text, not the original address or ownership. An original null string address becomes a non-null empty string, and invalid UTF-8 may not round-trip. Use it only where those changes are acceptable, with readable NUL-terminated UTF-8 and a stable field/instance. The callback must complete synchronously and must not return asynchronous work. Restoration can fail or replace an earlier exception; if the initial setter fails before `try`, no restoration is attempted:

```js
const { GetPropertyStringAddress, SetPropertyStringAddress } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesStringAddressText(strPropertyPath, strTemporaryText, RunSynchronouslyWithTemporaryText) {
	const strPreviousText = GetPropertyStringAddress(strPropertyPath);

	if (!SetPropertyStringAddress(strPropertyPath, strTemporaryText)) {
		throw new Error(`Could not set temporary game-rules string-address text: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryText(GetPropertyStringAddress(strPropertyPath));
	} finally {
		if (!SetPropertyStringAddress(strPropertyPath, strPreviousText)) {
			throw new Error(`Could not restore game-rules string-address text: ${strPropertyPath}.`);
		}
	}
}
```

Use address and edict writes only for reviewed native address fields with stable owners. Each callback must complete synchronously and must not return asynchronous work. The address setter accepts only a nonnegative `bigint` within the target's `uintptr_t` range; it does not validate the pointee. The edict helper re-resolves the previous wrapper's index, so neither that entity nor its index may be deleted, recycled or changed during the callback. A getter result of null can also represent a failed edict resolution, not just original null storage; exact restoration requires a known valid original edict or known null field. Cleanup in `finally` can fail or replace an earlier exception; if the initial setter fails before `try`, no restoration is attempted. A successful edict setter alone does not establish that lookup found the intended entity:

```js
const { GetPropertyAddress, GetPropertyEdict, SetPropertyAddress, SetPropertyEdict } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesAddress(strPropertyPath, unTemporaryAddress, RunSynchronouslyWithTemporaryAddress) {
	const unPreviousAddress = GetPropertyAddress(strPropertyPath);
	if ((typeof unPreviousAddress !== "bigint") || (unPreviousAddress < 0n)) {
		throw new RangeError(`Could not preserve game-rules address exactly: ${strPropertyPath}.`);
	}

	if (!SetPropertyAddress(strPropertyPath, unTemporaryAddress)) {
		throw new Error(`Could not set temporary game-rules address: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryAddress(GetPropertyAddress(strPropertyPath));
	} finally {
		if (!SetPropertyAddress(strPropertyPath, unPreviousAddress)) {
			throw new Error(`Could not restore game-rules address: ${strPropertyPath}.`);
		}
	}
}

function RunSynchronouslyWithTemporaryGameRulesEdict(strPropertyPath, TemporaryEdict, RunSynchronouslyWithTemporaryEdict) {
	const PreviousEdict = GetPropertyEdict(strPropertyPath);

	if (!SetPropertyEdict(strPropertyPath, TemporaryEdict)) {
		throw new Error(`Could not set temporary game-rules edict: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryEdict(GetPropertyEdict(strPropertyPath));
	} finally {
		if (!SetPropertyEdict(strPropertyPath, PreviousEdict)) {
			throw new Error(`Could not restore game-rules edict: ${strPropertyPath}.`);
		}
	}
}
```

## Live structured views

The four structured getters return component views backed by native addresses, not detached snapshots. Component access uses the captured storage; it does not re-discover the current game-rules instance or keep that storage alive. A successful component assignment updates native memory immediately, while invalid input or metadata can throw. Several component assignments are separate writes, not an atomic whole-structure update. Use the public field names below exactly as shown, and discard views before their owning storage becomes invalid.

| Getter | Returned fields | Whole-value setter |
| --- | --- | --- |
| `GetPropertyVector(strGameRulesPropertyName)` | `bigint` `Address` snapshot; live float properties `X`, `Y`, `Z`. Checks alignment and complete representable `Vector` range before installing the view; still requires live native storage of the correct extent. | `SetPropertyVector(strGameRulesPropertyName, VectorValue)`, for example `{ X: flX, Y: flY, Z: flZ }`. Converts to a temporary native vector, checks destination alignment and complete representable range, then assigns it and returns `true`. Conversion errors stop before assignment; range checks do not prove actual field extent, lifetime or atomicity. |
| `GetPropertyColor(strGameRulesPropertyName)` | `bigint` `Address` snapshot; live byte properties `Red`, `Green`, `Blue`, `Alpha` at offsets 0–3. Checks the complete representable four-byte SDK `Color` range before installing the view; still requires live native storage. | `SetPropertyColor(strGameRulesPropertyName, ColorValue)`, for example `{ Red: unRed, Green: unGreen, Blue: unBlue, Alpha: unAlpha }`. Validates all four components, stages them through the SDK's byte-wise constructor/`SetColor()` path, checks the complete representable destination range, then writes the channels with `SetColor()` and returns `true`. This avoids the SDK's `int`-based default construction and copy assignment: byte-aligned fields need no `int` alignment. Component getters can execute user code; conversion errors stop before field writes, but range checks do not prove actual field extent, lifetime or atomicity. |
| `GetPropertyInterval(strGameRulesPropertyName)` | `bigint` `Address` snapshot; live float properties `Start`, `Range`. Checks alignment and complete representable `interval_t` range before installing the view; still requires live native storage. | `SetPropertyInterval(strGameRulesPropertyName, IntervalValue)`, for example `{ Start: flStart, Range: flRange }`. Requires both components as finite numbers within float range; stages them in a temporary interval, checks destination alignment and complete representable range, then assigns it and returns `true`. No nonnegative-range or application-specific interval check is performed. Conversion errors stop before assignment; component access can execute user code, and actual extent, lifetime and atomicity are not guaranteed. |
| `GetPropertyQuaternion(strGameRulesPropertyName)` | `bigint` `Address` snapshot; live float properties `X`, `Y`, `Z`, `W`. Checks alignment and complete representable `Quaternion` range before installing the view; still requires live native storage. | `SetPropertyQuaternion(strGameRulesPropertyName, QuaternionValue)`, for example `{ X: flX, Y: flY, Z: flZ, W: flW }`. Requires all four components as finite numbers within float range; stages them in a temporary quaternion, checks destination alignment and complete representable range, then assigns it and returns `true`. Conversion errors stop before assignment. The handler performs no unit-length check or explicit normalization. Component access can execute user code; actual field extent, lifetime and atomicity are not guaranteed. |

Each `Address` property is an informational JavaScript `bigint` captured when the view is created; assigning it does not redirect the native component addresses. The value is exact, but does not validate or extend the storage lifetime, extent or alignment. BigInt arithmetic is exact, yet a computed address may still be outside `uintptr_t` or fail to designate valid storage. `SetPropertyAddress` checks the target range only; it does not validate the pointee. Replacing the informational value cannot make a stale view valid.

The Vector, Color, Interval and Quaternion builders validate each complete
representable SDK structure range before taking component addresses and check
each result before constructing the next field. `Address` is an own BigInt data
property, not an inherited setter call; failed address or component installation
does not publish a partial successful view. Live float metadata must designate
aligned storage with a representable `sizeof(float)` range; live byte metadata
must designate a representable `sizeof(unsigned char)` range. Reads/writes
byte-copy the native scalar and preserve existing JavaScript errors. Direct float
writes require finite Number input; direct byte writes require integer Numbers
from 0 through 255. None of these checks establishes mapping or makes borrowed
engine storage safe after it is invalidated.

`SetPropertyVector()` accepts an array (only indexes 0–2 are read) or an object with `X`, `Y`, `Z`, falling back to `Pitch`, `Yaw`, `Roll` respectively when the primary component is nullish. At least one non-nullish component must be supplied; all missing/nullish components become zero because the whole vector is replaced. Supplied components pass through V8 numeric conversion and finite float-range checks, so this path can coerce values and execute getters/conversion hooks. It is not the strict-number contract used by direct component assignment. An invalid non-nullish primary component fails rather than falling back to its alias.

Copy component values into a plain object before changing a live view. Keeping the view itself as the "backup" does not preserve old values. Reject non-finite saved components before writing: the getter can expose them, but the setter cannot restore them. The callback must complete synchronously, return no asynchronous work, and leave the same live game-rules instance/layout valid. If the initial setter fails before `try`, restoration is not attempted; cleanup can throw and replace a callback error.

```js
const { GetPropertyVector, SetPropertyVector } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesVector(strPropertyPath, TemporaryVector, RunSynchronouslyWithTemporaryVector) {
	const GameRulesVector = GetPropertyVector(strPropertyPath);
	const PreviousGameRulesVector = { X: GameRulesVector.X, Y: GameRulesVector.Y, Z: GameRulesVector.Z };
	if (!Number.isFinite(PreviousGameRulesVector.X) || !Number.isFinite(PreviousGameRulesVector.Y) || !Number.isFinite(PreviousGameRulesVector.Z)) {
		throw new Error(`Cannot restore non-finite game-rules vector: ${strPropertyPath}.`);
	}

	if (!SetPropertyVector(strPropertyPath, TemporaryVector)) {
		throw new Error(`Could not set temporary game-rules vector: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryVector(GameRulesVector);
	} finally {
		if (!SetPropertyVector(strPropertyPath, PreviousGameRulesVector)) {
			throw new Error(`Could not restore game-rules vector: ${strPropertyPath}.`);
		}
	}
}
```

Individual component assignment is also write-through. Validate the saved component and numeric delta before mutation; the native setter additionally rejects results outside the finite float range. The callback must complete synchronously, return no asynchronous work, and leave the captured storage valid. Restoration can throw and replace an earlier error.

```js
const { GetPropertyVector } = require("engines/gamerules");

function RunSynchronouslyWithOffsetGameRulesVectorX(strPropertyPath, flDelta, RunSynchronouslyWithOffsetVector) {
	const GameRulesVector = GetPropertyVector(strPropertyPath);
	const flPreviousX = GameRulesVector.X;
	if (!Number.isFinite(flPreviousX) || !Number.isFinite(flDelta)) {
		throw new Error(`Cannot offset game-rules vector with a non-finite component or delta: ${strPropertyPath}.`);
	}

	try {
		GameRulesVector.X = flPreviousX + flDelta;

		return RunSynchronouslyWithOffsetVector(GameRulesVector);
	} finally {
		GameRulesVector.X = flPreviousX;
	}
}
```

Color writes require all four components as integer Numbers from `0` through `255`; strings and BigInts are rejected. Save component values rather than the live view. The callback must complete synchronously, return no asynchronous work, and leave the captured storage valid. If the initial setter fails before `try`, no restoration is attempted; cleanup can throw and replace a callback error.

```js
const { GetPropertyColor, SetPropertyColor } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesColor(strPropertyPath, TemporaryColor, RunSynchronouslyWithTemporaryColor) {
	const GameRulesColor = GetPropertyColor(strPropertyPath);
	const PreviousGameRulesColor = { Red: GameRulesColor.Red, Green: GameRulesColor.Green, Blue: GameRulesColor.Blue, Alpha: GameRulesColor.Alpha };

	if (!SetPropertyColor(strPropertyPath, TemporaryColor)) {
		throw new Error(`Could not set temporary game-rules color: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryColor(GameRulesColor);
	} finally {
		if (!SetPropertyColor(strPropertyPath, PreviousGameRulesColor)) {
			throw new Error(`Could not restore game-rules color: ${strPropertyPath}.`);
		}
	}
}
```

Interval and quaternion setters require every component to be a Number within the finite float range. Their live getters can expose non-finite stored values, so reject an unrestorable snapshot before mutation. Callbacks must complete synchronously, return no asynchronous work, and leave captured storage valid. The initial setters run before `try`, so their failure is not restored; later cleanup can throw and replace a callback error.

```js
const { GetPropertyInterval, GetPropertyQuaternion, SetPropertyInterval, SetPropertyQuaternion } = require("engines/gamerules");

function RunSynchronouslyWithTemporaryGameRulesInterval(strPropertyPath, TemporaryInterval, RunSynchronouslyWithTemporaryInterval) {
	const GameRulesInterval = GetPropertyInterval(strPropertyPath);
	const PreviousGameRulesInterval = { Start: GameRulesInterval.Start, Range: GameRulesInterval.Range };
	if (!Number.isFinite(PreviousGameRulesInterval.Start) || !Number.isFinite(PreviousGameRulesInterval.Range)) {
		throw new Error(`Cannot restore non-finite game-rules interval: ${strPropertyPath}.`);
	}

	if (!SetPropertyInterval(strPropertyPath, TemporaryInterval)) {
		throw new Error(`Could not set temporary game-rules interval: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryInterval(GameRulesInterval);
	} finally {
		if (!SetPropertyInterval(strPropertyPath, PreviousGameRulesInterval)) {
			throw new Error(`Could not restore game-rules interval: ${strPropertyPath}.`);
		}
	}
}

function RunSynchronouslyWithTemporaryGameRulesQuaternion(strPropertyPath, TemporaryQuaternion, RunSynchronouslyWithTemporaryQuaternion) {
	const GameRulesQuaternion = GetPropertyQuaternion(strPropertyPath);
	const PreviousGameRulesQuaternion = { X: GameRulesQuaternion.X, Y: GameRulesQuaternion.Y, Z: GameRulesQuaternion.Z, W: GameRulesQuaternion.W };
	if (!Number.isFinite(PreviousGameRulesQuaternion.X) || !Number.isFinite(PreviousGameRulesQuaternion.Y) || !Number.isFinite(PreviousGameRulesQuaternion.Z) || !Number.isFinite(PreviousGameRulesQuaternion.W)) {
		throw new Error(`Cannot restore non-finite game-rules quaternion: ${strPropertyPath}.`);
	}

	if (!SetPropertyQuaternion(strPropertyPath, TemporaryQuaternion)) {
		throw new Error(`Could not set temporary game-rules quaternion: ${strPropertyPath}.`);
	}

	try {
		return RunSynchronouslyWithTemporaryQuaternion(GameRulesQuaternion);
	} finally {
		if (!SetPropertyQuaternion(strPropertyPath, PreviousGameRulesQuaternion)) {
			throw new Error(`Could not restore game-rules quaternion: ${strPropertyPath}.`);
		}
	}
}
```

## Practical workflows

### Build a branch layout report

Run this after a map starts, then compare the output when updating an SDK branch. This reports the compiled SDK branch and enumerated send-table metadata, not a complete native storage layout or proof that a later write is safe. Availability and metadata are separate lookups that can fail independently.

```js
const { IsAvailable, GetProxyName, GetSendTableName, ListProperties } = require("engines/gamerules");
const { GetGlobalVariables } = require("globals");

if (IsAvailable()) {
	const GlobalVariables = GetGlobalVariables();
	const GameRulesLayoutReport = {
		Properties: ListProperties(),
		ProxyName: GetProxyName(),
		SDKBranch: GlobalVariables.SDKBranch,
		SendTableName: GetSendTableName(),
	};
	console.log(JSON.stringify(GameRulesLayoutReport, null, 2));
}
```

### Validate a reviewed layout before writing

```js
const { ListProperties } = require("engines/gamerules");

function ValidateGameRulesLayout(ReviewedLayout) {
	const mapGameRulesPropertyDescriptorsByPath = new Map();
	for (const GameRulesPropertyDescriptor of ListProperties()) {
		if (mapGameRulesPropertyDescriptorsByPath.has(GameRulesPropertyDescriptor.Path)) {
			throw new Error(`Ambiguous game-rules property path: ${GameRulesPropertyDescriptor.Path}.`);
		}

		mapGameRulesPropertyDescriptorsByPath.set(GameRulesPropertyDescriptor.Path, GameRulesPropertyDescriptor);
	}

	for (const [strReviewedFieldName, ReviewedField] of Object.entries(ReviewedLayout)) {
		const GameRulesPropertyDescriptor = mapGameRulesPropertyDescriptorsByPath.get(ReviewedField.Path);
		if (!GameRulesPropertyDescriptor) {
			throw new Error(`${strReviewedFieldName} is missing at ${ReviewedField.Path}.`);
		}

		if (GameRulesPropertyDescriptor.Offset !== ReviewedField.Offset) {
			throw new Error(`${strReviewedFieldName} moved from ${ReviewedField.Offset} to ${GameRulesPropertyDescriptor.Offset}.`);
		}
	}
}
```

Pass a trusted reviewed layout whose entries contain the exact `Path` and numeric `Offset`. This helper rejects duplicate enumerated paths and checks that each reviewed path exists at its expected offset; it does not compare types, widths, capacities, alignment, ownership, or the complete native layout. Successful validation alone never authorizes a write: independently verify those contracts and the current instance lifetime. An unchanged send type is insufficient because native width and ownership are outside the send-table schema.

## Safety and lifetime

- These operations reinterpret memory at a send-property offset. A wrong typed accessor can corrupt the server or crash the process.
- `BitCount` is the network encoding width, not the C++ field width. Confirm the selected SDK declaration or game-specific reverse-engineered layout.
- Native address getters and live-view `Address` fields return exact JavaScript `bigint` values. `SetPropertyAddress()` accepts only a nonnegative `bigint` within the native `uintptr_t` range; `0n` writes null. Exact representation does not prove that the target is live, aligned, or within accessible storage.
- Live Vector, Color, Interval, and Quaternion objects become invalid when the game-rules instance is destroyed. Do not retain them across map shutdown, map change, or plugin reload.
- Keep temporary writes synchronous and use `try`/`finally`. Copy live components into plain values before mutation and ensure the setter can restore them. Callbacks and property getters must not invalidate the underlying storage. Cleanup can fail or replace an earlier exception; `finally` does not make restoration unconditional or transactional.
- `SetPropertyStringBuffer()` needs the real native capacity, including the null terminator. Passing a guessed capacity can overwrite adjacent fields.
- `SetPropertyStringAddress()` replaces the native address with SourceJS-managed string storage and cannot restore the original address identity. Replacing the managed string can invalidate an address retained by native code; restoring text does not restore original ownership or a null address. Use it only for a reviewed `char const*` field whose lifetime and consumers permit replacement.
- Prefer dotted property paths and validate offsets for every supported SDK branch.

Property-name arguments are decoded as complete UTF-8 strings and reject embedded
NUL before lookup; failed decoding does not become a missing/empty property name.
Keep the exact native send-property names and dotted paths, including SDK-owned
`m_` spellings. The native name/offset/address helpers, metadata builder/collector,
integer, boolean, character and floating-point accessors, string/address accessors
and Vector/float-component helpers preserve existing JavaScript errors and
translate native exceptions rather than returning partial successful results.

Metadata objects and array entries are checked own data properties, so inherited
setters cannot intercept their construction. Collection keeps its existing
maximum recursion depth of 32 and skips offsets outside the native signed-int range;
array-index exhaustion or a failed descriptor/entry build raises an error rather
than returning a successful truncated array.

Integer, boolean, character, floating-point and stored-address accessors, plus
the string-address getter, validate complete representable field ranges before
byte-copying. Setters parse and validate the complete value before writing;
failed parsing or delegated JavaScript errors do not commit a scalar write.
Up to 32-bit integer results remain Numbers; 64-bit results remain exact `bigint`
values and 64-bit integer setters require lossless `bigint` input, not Number.
Range checks do not prove mapping, permissions, object lifetime, valid native
representation or that the selected accessor matches the real field width.
The string-address getter validates the stored address field, not the pointee's
length or lifetime; non-null text must remain readable through its NUL terminator.
The caller still needs the correct live engine layout.

String-buffer reads validate the full claimed maximum before scanning, and
string-buffer writes validate the full claimed capacity before copying text plus
NUL. Both string setters decode full UTF-8 and reject embedded NUL rather than
silently truncating a prefix. Parsing, range or text-allocation failure does not
commit a native field write; stored string-address text is staged before replacing
the map-owned value. Vector parsing likewise stages its output before assignment.
These are ordinary failure-path guarantees, not rollback for invalid storage,
engine lifetime changes, access faults or several separate native writes.

## Related modules

- [`engines`](engines.md) provides ordinary engine commands, tracing, sounds, and resource precaching.
- [`engines/server`](engines-server.md) exposes server interfaces and live global state.
- [`entities/props`](entities-props.md) accesses entity send properties rather than the singleton game-rules object.
- [`memory/manager`](memory-manager.md) defines reviewed native layouts for addresses that are not represented by a send table.
- [`globals`](globals.md) identifies the compiled SDK branch and exposes live engine timing/state.
