# `require("players/helpers")`

> AI processing note: this page documents the complete native player-conversion graph. Use the contents and grouped tables to read only the relevant representation.

The `players/helpers` module converts between a live player index, engine user ID, native player wrapper, edict descriptor, base-entity descriptor, base handle, integer handle and exact BigInt entity address. It also provides current name, network identity, connection, client-ConVar and language queries.

The public entry lives in [`packages/sourcejs/players/helpers.js`](../../packages/sourcejs/players/helpers.js) and returns the exact native module object. Representation conversions resolve the current `IPlayerInfo` through the selected Source 1 SDK; the separate `GetPlayerIndex()` shape query does not. SourceJS does not cache conversion results or manufacture missing players.

## Contents

- [Import](#import)
- [Representations](#representations)
- [Finding Players](#finding-players)
- [Native Player Wrappers](#native-player-wrappers)
- [Edicts](#edicts)
- [Base Entities](#base-entities)
- [Handles](#handles)
- [Addresses](#addresses)
- [Identity and Client Values](#identity-and-client-values)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

Import functions directly from their owning module. This helper performs no search until the caller supplies a name:

```js
const { GetIndexFromName, GetName } = require("players/helpers");

function FindPlayerByName(strName) {
	const nMaximumInt32Value = 2147483647;

	if ((typeof strName !== "string") || (strName.length === 0) || strName.includes("\0")) {
		throw new TypeError("strName must be a non-empty NUL-free string.");
	}

	const nPlayerIndex = GetIndexFromName(strName);
	if (nPlayerIndex === -1) {
		return null;
	}

	if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumInt32Value)) {
		throw new Error("GetIndexFromName() returned an invalid player index.");
	}

	const strCurrentName = GetName(nPlayerIndex);
	if (typeof strCurrentName !== "string") {
		throw new Error(`GetName() returned an invalid name for player ${nPlayerIndex}.`);
	}

	return { PlayerIndex: nPlayerIndex, Name: strCurrentName };
}

module.exports = { FindPlayerByName };
```

The module exposes 37 functions directly. It has no default export, namespace aliases or JavaScript fallback layer.

## Representations

| Representation | JavaScript shape | Ownership |
| --- | --- | --- |
| player index | positive `Int32` `number` | One-based engine entity index. Search functions use `-1` when no current player matches. |
| user ID | signed `Int32` `number` | Connection-scoped engine user ID from `IPlayerInfo::GetUserID()`. |
| player info | native player object | A live `MakePlayerObject` wrapper with native properties/methods, not a numeric `IPlayerInfo*` and not the extended `players/entity` decoration. |
| edict | `{ Kind, Address, Index, ClassName }` | Borrowed descriptor with `Kind: "edict"` and a primitive `bigint` `Address` for the current `edict_t*`. |
| base entity | `{ Kind, Address, Index, ClassName }` or `null` | Borrowed descriptor with `Kind: "baseentity"` and a primitive `bigint` `Address` for the current `CBaseEntity*`; `null` when no base entity is available. |
| base handle | `{ Kind, Value, EntryIndex, SerialNumber, Valid }` or `null` | Decoded valid `CBaseHandle`; `Value` is an unsigned 32-bit `number`. Returns `null`, not an invalid descriptor, when no handle is available. |
| integer handle | `number` | Full unsigned 32-bit encoded handle, including its high bit, or `-1` when a live player has no valid handle. |
| address | `bigint` | Exact `CBaseEntity*` address, or `0n` when no base entity is available. It is never returned as a string or `number`. |

Base-entity input accepts a returned descriptor with its own exact `Kind: "baseentity"` and `Address` properties, or a primitive `bigint` address. Address input accepts only a primitive `bigint`; a `number`, boxed BigInt, or generic address-bearing object is not an address value. Input getters and descriptor traps that throw preserve the original JavaScript exception and stop before player-provider work.

Native representation conversions and `GetIndexFromUserID` catch C++ exceptions and attempt to raise a JavaScript error. A JavaScript exception already raised during input resolution is preserved even if a C++ failure subsequently unwinds the conversion's local exception handler. Existing no-match and unavailable-output sentinels remain unchanged; these boundaries neither retain a player nor guarantee Error-object allocation, termination recovery or allocator/OOM recovery.

Edict inputs first resolve an integer `Index` (including an object's `Index`); primitive BigInt inputs are resolved through engine edict/base-entity address helpers. An edict descriptor's `Kind`/`Address` fields are not what proves its identity. Base-handle inputs accept a `Uint32` encoded value or the first defined `Handle`, `Value`, or `IntHandle` property; the decoder and current handle lookup, not a caller's `Valid` flag, determine validity. Use the native returned representations, not fabricated or arbitrary memory addresses.

Descriptors and wrappers are conversion values, not owners of engine memory. Resolve them again before a later operation if a disconnect, deletion or map transition may have occurred.

## Finding Players

| Function | Result | Purpose |
| --- | --- | --- |
| `GetPlayerIndex(Value?)` | `number` | Read a signed `Int32` number or an entity-like object's `Index` with that contract. Missing or unrecognized values return `-1`; this does not prove that the index is live. |
| `GetIndexFromUserID(nUserID)` | `number` | Find the connected player with an exact `Int32` user ID; non-`Int32` values also return `-1`. |
| `GetIndexFromName(strName)` | `number` | Find the first connected player with an exact non-empty name using ASCII case folding. |
| `GetIndexFromNetworkID(strNetworkID)` | `number` | Find the first connected player matching a non-empty network ID. When Steam support is present, Steam2, Steam3 and Steam64 forms are compared as equivalent identities. |
| `GetUserID(Player)` | `number` | Read the current user ID from a player or index. |
| `GetUserIDFromIndex(unPlayerIndex)` | `number` | Convert an explicit integer index to its current engine user ID. |
| `GetName(Player)` | `string` | Read the current name from a player or index. |
| `IsConnected(Player)` | `boolean` | Query current connection state for a resolvable player or index. |

Search functions return `-1` for no match. `GetIndexFromUserID()` also returns `-1` for a non-`Int32` value without doing provider lookup. Conversion/query functions that require a specific live player throw when the value cannot be resolved.

Name and raw network-ID comparisons fold only ASCII `A`–`Z`; they do not perform Unicode case folding or normalization.

An exception from an input object's `Index` getter propagates unchanged from `GetPlayerIndex`, `GetUserID`, `GetName`, and `IsConnected`. It is not replaced with `-1` or a player-provider error; player-provider work does not begin after that failure.

The native `GetPlayerIndex`, `GetIndexFromName`, `GetIndexFromNetworkID`, `GetUserID`, `GetName`, and `IsConnected` callbacks catch C++ exceptions and attempt to raise JavaScript errors, preserving any existing JavaScript exception. Existing search and query results remain unchanged. `GetPlayerIndex` remains an index-shape query, not a connected-player or lifetime check; Error-object allocation and termination recovery are not guaranteed.

```js
const {
	GetIndexFromName,
	GetIndexFromNetworkID,
	GetIndexFromUserID,
	GetPlayerIndex,
	IsConnected,
	GetName,
	GetUserIDFromIndex,
	GetUserID,
} = require("players/helpers");

function ResolvePlayerSearches(strName, strNetworkID, nExpectedUserID) {
	const nMinimumInt32Value = -2147483648;
	const nMaximumInt32Value = 2147483647;

	if ((typeof strName !== "string") || (strName.length === 0) || strName.includes("\0") || (typeof strNetworkID !== "string") || (strNetworkID.length === 0) || strNetworkID.includes("\0") || !Number.isInteger(nExpectedUserID) || (nExpectedUserID < nMinimumInt32Value) || (nExpectedUserID > nMaximumInt32Value)) {
		throw new TypeError("strName and strNetworkID must be non-empty NUL-free strings; nExpectedUserID must be an Int32 number.");
	}

	const nPlayerIndex = GetIndexFromName(strName);
	if (nPlayerIndex === -1) {
		return null;
	}

	if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumInt32Value)) {
		throw new Error("GetIndexFromName() returned an invalid player index.");
	}

	const nUserID = GetUserID(nPlayerIndex);
	if (!Number.isInteger(nUserID) || (nUserID < nMinimumInt32Value) || (nUserID > nMaximumInt32Value) || (nUserID !== nExpectedUserID)) {
		throw new Error("The player user ID does not match the expected Int32 identity.");
	}

	const Result = {
		NetworkIDIndex: GetIndexFromNetworkID(strNetworkID),
		UserIDIndex: GetIndexFromUserID(nExpectedUserID),
		Connected: IsConnected(nPlayerIndex),
		DirectUserID: GetUserIDFromIndex(nPlayerIndex),
		PlayerIndex: GetPlayerIndex(nPlayerIndex),
		Name: GetName(nPlayerIndex),
		UserID: nUserID,
	};
	if ((Result.Connected !== true) || (typeof Result.Name !== "string") || (Result.NetworkIDIndex !== nPlayerIndex) || (Result.UserIDIndex !== nPlayerIndex) || (Result.PlayerIndex !== nPlayerIndex) || (Result.DirectUserID !== nExpectedUserID)) {
		throw new Error(`Player search representations disagree for index ${nPlayerIndex}.`);
	}

	return Result;
}

module.exports = { ResolvePlayerSearches };
```

## Native Player Wrappers

| Function | Result | Purpose |
| --- | --- | --- |
| `GetPlayerInformationFromIndex(unPlayerIndex)` | native player wrapper | Resolve a live player from an integer index. |
| `GetPlayerInformationFromUserID(nUserID)` | native player wrapper | Resolve a live player from an integer user ID. |
| `GetIndexFromPlayerInformation(PlayerInformation)` | `number` | Read the live wrapper's current index. |
| `GetUserIDFromPlayerInformation(PlayerInformation)` | `number` | Read the wrapper's current engine user ID. |

The returned `PlayerInformation` is the native object created by `MakePlayerObject()`. Input selectors in the `FromPlayerInformation` family also accept a positive `Int32` index or an object whose `Index` resolves to one; they resolve the current player slot rather than authenticate a wrapper's provenance. An inherited `Index` getter is read normally, and its exception is preserved. Pass the resolved index to [`Player()`](players-entity.md) when a workflow needs the additional JavaScript methods installed by `DecoratePlayer()`.

```js
const { Player } = require("players/entity");
const {
	GetIndexFromPlayerInformation,
	GetPlayerInformationFromIndex,
	GetPlayerInformationFromUserID,
	GetUserIDFromPlayerInformation,
} = require("players/helpers");

function RoundTripPlayerInformation(unPlayerIndex) {
	const nMinimumInt32Value = -2147483648;
	const nMaximumInt32Value = 2147483647;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive Int32 number.");
	}

	const PlayerInformation = GetPlayerInformationFromIndex(unPlayerIndex);
	const nUserID = GetUserIDFromPlayerInformation(PlayerInformation);
	if (!Number.isInteger(nUserID) || (nUserID < nMinimumInt32Value) || (nUserID > nMaximumInt32Value)) {
		throw new Error("The native player returned an invalid Int32 user ID.");
	}

	const PlayerByUserID = GetPlayerInformationFromUserID(nUserID);
	const nResolvedIndex = GetIndexFromPlayerInformation(PlayerByUserID);
	if (nResolvedIndex !== unPlayerIndex) {
		throw new Error(`Player-information round trip changed index ${unPlayerIndex}.`);
	}

	const DecoratedPlayer = Player(nResolvedIndex);
	const nDecoratedIndex = DecoratedPlayer.Index;
	if (nDecoratedIndex !== unPlayerIndex) {
		throw new Error(`Player() returned a different index for player ${unPlayerIndex}.`);
	}

	return { DecoratedPlayer, PlayerInformation, UserID: nUserID };
}

module.exports = { RoundTripPlayerInformation };
```

Each conversion can return a new wrapper object over the same slot. Compare indexes or user IDs, not JavaScript object identity.

## Edicts

| Function | Result | Purpose |
| --- | --- | --- |
| `GetEdictFromPlayerInformation(PlayerInformation)` | edict descriptor | Resolve the wrapper's current `edict_t`. |
| `GetEdictFromUserID(nUserID)` | edict descriptor | Resolve a connected user ID to its current `edict_t`. |
| `GetPlayerInformationFromEdict(Edict)` | native player wrapper | Resolve a returned edict descriptor, an `Int32` entity index, or a primitive BigInt engine address to a live player. |
| `GetUserIDFromEdict(Edict)` | `number` | Resolve the current user ID through an edict. |

```js
const {
	GetEdictFromPlayerInformation,
	GetEdictFromUserID,
	GetPlayerInformationFromEdict,
	GetPlayerInformationFromIndex,
	GetUserIDFromEdict,
	GetUserIDFromPlayerInformation,
} = require("players/helpers");

function RoundTripPlayerEdict(unPlayerIndex) {
	const nMinimumInt32Value = -2147483648;
	const nMaximumInt32Value = 2147483647;
	const unMaximumAddress = 0xFFFFFFFFFFFFFFFFn;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive Int32 number.");
	}

	function SnapshotEdict(EdictValue) {
		if ((EdictValue === null) || (typeof EdictValue !== "object") || Array.isArray(EdictValue)) {
			throw new Error("The live player did not return an edict descriptor.");
		}

		const strKind = EdictValue.Kind;
		const unAddress = EdictValue.Address;
		const nIndex = EdictValue.Index;
		const strClassName = EdictValue.ClassName;
		if ((strKind !== "edict") || (typeof unAddress !== "bigint") || (unAddress <= 0n) || (unAddress > unMaximumAddress) || (nIndex !== unPlayerIndex) || (typeof strClassName !== "string")) {
			throw new Error(`Player ${unPlayerIndex} returned an invalid edict descriptor.`);
		}

		return { Kind: strKind, Address: unAddress, Index: nIndex, ClassName: strClassName };
	}

	const PlayerInformation = GetPlayerInformationFromIndex(unPlayerIndex);
	const nUserID = GetUserIDFromPlayerInformation(PlayerInformation);
	if (!Number.isInteger(nUserID) || (nUserID < nMinimumInt32Value) || (nUserID > nMaximumInt32Value)) {
		throw new Error("The native player returned an invalid Int32 user ID.");
	}

	const Edict = SnapshotEdict(GetEdictFromPlayerInformation(PlayerInformation));
	const EdictByUserID = SnapshotEdict(GetEdictFromUserID(nUserID));
	if (EdictByUserID.Address !== Edict.Address) {
		throw new Error(`The edict address changed between conversions for player ${unPlayerIndex}.`);
	}

	const SamePlayer = GetPlayerInformationFromEdict(EdictByUserID);
	const nSamePlayerIndex = SamePlayer.Index;
	const nRoundTripUserID = GetUserIDFromEdict(Edict);
	if ((nSamePlayerIndex !== unPlayerIndex) || (nRoundTripUserID !== nUserID)) {
		throw new Error(`The edict round trip changed identity for player ${unPlayerIndex}.`);
	}

	return { UserID: nRoundTripUserID, Address: Edict.Address, ClassName: Edict.ClassName, Index: nSamePlayerIndex };
}

module.exports = { RoundTripPlayerEdict };
```

## Base Entities

| Function | Result | Purpose |
| --- | --- | --- |
| `GetBaseEntityFromPlayerInformation(PlayerInformation)` | base-entity descriptor or `null` | Resolve the wrapper's current `CBaseEntity`. |
| `GetBaseEntityFromUserID(nUserID)` | base-entity descriptor or `null` | Resolve a connected user ID to its current `CBaseEntity`. |
| `GetPlayerInformationFromBaseEntity(BaseEntity)` | native player wrapper | Resolve a descriptor or primitive BigInt `CBaseEntity*` address to a live player. |
| `GetUserIDFromBaseEntity(BaseEntity)` | `number` | Resolve the current user ID through a base entity. |

```js
const {
	GetBaseEntityFromPlayerInformation,
	GetBaseEntityFromUserID,
	GetPlayerInformationFromBaseEntity,
	GetPlayerInformationFromIndex,
	GetUserIDFromBaseEntity,
	GetUserIDFromPlayerInformation,
} = require("players/helpers");

function RoundTripPlayerBaseEntity(unPlayerIndex) {
	const nMinimumInt32Value = -2147483648;
	const nMaximumInt32Value = 2147483647;
	const unMaximumAddress = 0xFFFFFFFFFFFFFFFFn;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive Int32 number.");
	}

	function SnapshotBaseEntity(BaseEntityValue) {
		if (BaseEntityValue === null) {
			return null;
		}

		if ((typeof BaseEntityValue !== "object") || Array.isArray(BaseEntityValue)) {
			throw new Error("The player did not return a base-entity descriptor or null.");
		}

		const strKind = BaseEntityValue.Kind;
		const unAddress = BaseEntityValue.Address;
		const nIndex = BaseEntityValue.Index;
		const strClassName = BaseEntityValue.ClassName;
		if ((strKind !== "baseentity") || (typeof unAddress !== "bigint") || (unAddress <= 0n) || (unAddress > unMaximumAddress) || (nIndex !== unPlayerIndex) || (typeof strClassName !== "string")) {
			throw new Error(`Player ${unPlayerIndex} returned an invalid base-entity descriptor.`);
		}

		return { Kind: strKind, Address: unAddress, Index: nIndex, ClassName: strClassName };
	}

	const PlayerInformation = GetPlayerInformationFromIndex(unPlayerIndex);
	const nUserID = GetUserIDFromPlayerInformation(PlayerInformation);
	if (!Number.isInteger(nUserID) || (nUserID < nMinimumInt32Value) || (nUserID > nMaximumInt32Value)) {
		throw new Error("The native player returned an invalid Int32 user ID.");
	}

	const BaseEntity = SnapshotBaseEntity(GetBaseEntityFromPlayerInformation(PlayerInformation));
	if (BaseEntity === null) {
		return null;
	}

	const BaseEntityByUserID = SnapshotBaseEntity(GetBaseEntityFromUserID(nUserID));
	if (BaseEntityByUserID === null) {
		return null;
	}

	if (BaseEntityByUserID.Address !== BaseEntity.Address) {
		throw new Error(`The base-entity address changed between conversions for player ${unPlayerIndex}.`);
	}

	const SamePlayer = GetPlayerInformationFromBaseEntity(BaseEntityByUserID);
	const nSamePlayerIndex = SamePlayer.Index;
	const nRoundTripUserID = GetUserIDFromBaseEntity(BaseEntity);
	if ((nSamePlayerIndex !== unPlayerIndex) || (nRoundTripUserID !== nUserID)) {
		throw new Error(`The base-entity round trip changed identity for player ${unPlayerIndex}.`);
	}

	return { UserID: nRoundTripUserID, Address: BaseEntity.Address, Index: nSamePlayerIndex };
}

module.exports = { RoundTripPlayerBaseEntity };
```

## Handles

| Function | Result | Purpose |
| --- | --- | --- |
| `GetBaseHandleFromPlayerInformation(PlayerInformation)` | base-handle descriptor or `null` | Read the wrapper's current `CBaseHandle`. |
| `GetBaseHandleFromUserID(nUserID)` | base-handle descriptor or `null` | Resolve a connected user ID to a base handle. |
| `GetIntegerHandleFromPlayerInformation(PlayerInformation)` | `number` | Read the full unsigned `CBaseHandle::ToInt()` encoding from the wrapper, or `-1` when unavailable. |
| `GetIntegerHandleFromUserID(nUserID)` | `number` | Resolve a user ID to an unsigned encoded handle, or `-1` when unavailable. |
| `GetPlayerInformationFromBaseHandle(BaseHandle)` | native player wrapper | Resolve a valid base-handle descriptor/value to a live player. |
| `GetPlayerInformationFromIntegerHandle(unIntegerHandle)` | native player wrapper | Resolve an encoded handle to a live player. |
| `GetUserIDFromBaseHandle(BaseHandle)` | `number` | Resolve the current user ID through a base handle. |
| `GetUserIDFromIntegerHandle(unIntegerHandle)` | `number` | Resolve the current user ID through an encoded handle. |

```js
const {
	GetBaseHandleFromPlayerInformation,
	GetBaseHandleFromUserID,
	GetIntegerHandleFromPlayerInformation,
	GetIntegerHandleFromUserID,
	GetPlayerInformationFromBaseHandle,
	GetPlayerInformationFromIndex,
	GetPlayerInformationFromIntegerHandle,
	GetUserIDFromBaseHandle,
	GetUserIDFromIntegerHandle,
	GetUserIDFromPlayerInformation,
} = require("players/helpers");

function RoundTripPlayerHandles(unPlayerIndex) {
	const nMinimumInt32Value = -2147483648;
	const nMaximumInt32Value = 2147483647;
	const unInvalidHandle = 0xFFFFFFFF;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive Int32 number.");
	}

	function SnapshotBaseHandle(BaseHandleValue) {
		if (BaseHandleValue === null) {
			return null;
		}

		if ((typeof BaseHandleValue !== "object") || Array.isArray(BaseHandleValue)) {
			throw new Error("The player did not return a base-handle descriptor or null.");
		}

		const strKind = BaseHandleValue.Kind;
		const unValue = BaseHandleValue.Value;
		const nEntryIndex = BaseHandleValue.EntryIndex;
		const nSerialNumber = BaseHandleValue.SerialNumber;
		const bValid = BaseHandleValue.Valid;
		if ((strKind !== "basehandle") || (bValid !== true) || !Number.isInteger(unValue) || (unValue <= 0) || (unValue >= unInvalidHandle) || (nEntryIndex !== unPlayerIndex) || !Number.isInteger(nSerialNumber) || (nSerialNumber < 0) || (nSerialNumber > nMaximumInt32Value)) {
			throw new Error(`Player ${unPlayerIndex} returned an invalid base-handle descriptor.`);
		}

		return { Kind: strKind, Value: unValue, EntryIndex: nEntryIndex, SerialNumber: nSerialNumber, Valid: bValid };
	}

	const PlayerInformation = GetPlayerInformationFromIndex(unPlayerIndex);
	const nUserID = GetUserIDFromPlayerInformation(PlayerInformation);
	if (!Number.isInteger(nUserID) || (nUserID < nMinimumInt32Value) || (nUserID > nMaximumInt32Value)) {
		throw new Error("The native player returned an invalid Int32 user ID.");
	}

	const BaseHandle = SnapshotBaseHandle(GetBaseHandleFromPlayerInformation(PlayerInformation));
	if (BaseHandle === null) {
		return null;
	}

	const BaseHandleByUserID = SnapshotBaseHandle(GetBaseHandleFromUserID(nUserID));
	if (BaseHandleByUserID === null) {
		return null;
	}

	const nIntegerHandle = GetIntegerHandleFromPlayerInformation(PlayerInformation);
	if (nIntegerHandle === -1) {
		return null;
	}

	const nIntegerHandleByUserID = GetIntegerHandleFromUserID(nUserID);
	if (nIntegerHandleByUserID === -1) {
		return null;
	}

	if (!Number.isInteger(nIntegerHandle) || (nIntegerHandle <= 0) || (nIntegerHandle >= unInvalidHandle) || (nIntegerHandleByUserID !== nIntegerHandle) || (BaseHandle.Value !== nIntegerHandle) || (BaseHandleByUserID.Value !== nIntegerHandle) || (BaseHandleByUserID.SerialNumber !== BaseHandle.SerialNumber)) {
		throw new Error(`The handle changed between conversions for player ${unPlayerIndex}.`);
	}

	const Result = {
		BaseHandleUserID: GetUserIDFromBaseHandle(BaseHandle),
		BaseHandleIndex: GetPlayerInformationFromBaseHandle(BaseHandleByUserID).Index,
		IntegerHandleIndex: GetPlayerInformationFromIntegerHandle(nIntegerHandleByUserID).Index,
		EntryIndex: BaseHandle.EntryIndex,
		IntegerHandle: nIntegerHandle,
		IntegerHandleUserID: GetUserIDFromIntegerHandle(nIntegerHandle),
		SerialNumber: BaseHandle.SerialNumber,
	};
	if ((Result.BaseHandleUserID !== nUserID) || (Result.BaseHandleIndex !== unPlayerIndex) || (Result.IntegerHandleIndex !== unPlayerIndex) || (Result.IntegerHandleUserID !== nUserID)) {
		throw new Error(`The handle round trip changed identity for player ${unPlayerIndex}.`);
	}

	return Result;
}

module.exports = { RoundTripPlayerHandles };
```

## Addresses

| Function | Result | Purpose |
| --- | --- | --- |
| `GetAddressFromPlayerInformation(PlayerInformation)` | `bigint` | Return the exact current `CBaseEntity*` address, or `0n` when unavailable. |
| `GetAddressFromUserID(nUserID)` | `bigint` | Resolve a user ID to its exact current `CBaseEntity*` address, or `0n` when unavailable. |
| `GetPlayerInformationFromAddress(unAddress)` | native player wrapper | Resolve a primitive BigInt `CBaseEntity*` address to a live player. |
| `GetUserIDFromAddress(unAddress)` | `number` | Resolve the current user ID through a primitive BigInt `CBaseEntity*` address. |

Addresses are primitive JavaScript BigInts, never Numbers or hexadecimal strings. Native readers require a lossless unsigned value that fits the current target's `std::uintptr_t`; `0n` is an unavailable output, not a reverse-conversion input. The examples check the unsigned 64-bit output range, but do not make an address valid on a narrower target or after its entity has died.

```js
const {
	GetPlayerInformationFromIndex,
	GetPlayerInformationFromAddress,
	GetAddressFromPlayerInformation,
	GetAddressFromUserID,
	GetUserIDFromPlayerInformation,
	GetUserIDFromAddress,
} = require("players/helpers");

function RoundTripPlayerAddress(unPlayerIndex) {
	const nMinimumInt32Value = -2147483648;
	const nMaximumInt32Value = 2147483647;
	const unMaximumAddress = 0xFFFFFFFFFFFFFFFFn;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive Int32 number.");
	}

	const PlayerInformation = GetPlayerInformationFromIndex(unPlayerIndex);
	const nUserID = GetUserIDFromPlayerInformation(PlayerInformation);
	if (!Number.isInteger(nUserID) || (nUserID < nMinimumInt32Value) || (nUserID > nMaximumInt32Value)) {
		throw new Error("The native player returned an invalid Int32 user ID.");
	}

	const unAddress = GetAddressFromPlayerInformation(PlayerInformation);
	if (unAddress === 0n) {
		return null;
	}

	if ((typeof unAddress !== "bigint") || (unAddress <= 0n) || (unAddress > unMaximumAddress)) {
		throw new Error(`Player ${unPlayerIndex} did not return a nonzero unsigned BigInt address.`);
	}

	const unAddressByUserID = GetAddressFromUserID(nUserID);
	if (unAddressByUserID === 0n) {
		return null;
	}

	if (unAddressByUserID !== unAddress) {
		throw new Error("The player base-entity address changed between conversions.");
	}

	const SamePlayer = GetPlayerInformationFromAddress(unAddress);
	const nSamePlayerIndex = SamePlayer.Index;
	const nRoundTripUserID = GetUserIDFromAddress(unAddress);
	if ((nSamePlayerIndex !== unPlayerIndex) || (nRoundTripUserID !== nUserID)) {
		throw new Error(`The address round trip changed identity for player ${unPlayerIndex}.`);
	}

	return { UserID: nRoundTripUserID, Address: unAddress, Index: nSamePlayerIndex };
}

module.exports = { RoundTripPlayerAddress };
```

## Identity and Client Values

| Function | Result | Purpose |
| --- | --- | --- |
| `GetNetworkID(Player)` | `string` | Read the current `IPlayerInfo` network identity from a player or index. |
| `GetNetworkIDFromIndex(unPlayerIndex)` | `string` | Read the current network identity for an index. |
| `GetNetworkAddress(Player)` | `string` | Read `INetChannelInfo::GetAddress()` for a connected human player or index. |
| `GetClientCVarValue(Player, strCVarName)` | `string` | Read a client ConVar with a non-empty string name through `IVEngineServer` for a connected human player or index. |
| `GetClientLanguage(Player)` | `string` | Read `cl_language` for a connected human player or index. |

Network addresses and client ConVars are unavailable for fake or disconnected clients. Missing required providers or a network channel throw; null SDK strings become empty strings. These queries preserve an exception from the input object's `Index` getter and stop before player, channel, or ConVar lookup. `GetClientCVarValue` validates `strCVarName` before reading `Index`.

Native `GetNetworkAddress`, `GetNetworkID`, `GetClientCVarValue`, and `GetClientLanguage` also catch C++ exceptions and attempt to raise contextual JavaScript errors without replacing an existing exception. They do not retain a player or network channel or guarantee Error-object allocation, termination recovery or allocator/OOM recovery.

```js
const {
	GetClientCVarValue,
	GetClientLanguage,
	GetNetworkAddress,
	GetNetworkIDFromIndex,
	GetNetworkID,
	GetPlayerInformationFromIndex,
} = require("players/helpers");

function InspectHumanClient(unPlayerIndex, strClientConVarName = "rate") {
	const nMaximumInt32Value = 2147483647;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > nMaximumInt32Value) || (typeof strClientConVarName !== "string") || (strClientConVarName.length === 0) || strClientConVarName.includes("\0")) {
		throw new TypeError("unPlayerIndex must be a positive Int32 number; strClientConVarName must be a non-empty NUL-free string.");
	}

	const PlayerInformation = GetPlayerInformationFromIndex(unPlayerIndex);
	const bConnected = PlayerInformation.Connected;
	if (typeof bConnected !== "boolean") {
		throw new Error("Connected must be a boolean property.");
	}

	if (!bConnected) {
		return null;
	}

	const bFakeClient = PlayerInformation.FakeClient;
	if (typeof bFakeClient !== "boolean") {
		throw new Error("FakeClient must be a boolean property.");
	}

	if (bFakeClient) {
		return null;
	}

	const strNetworkID = GetNetworkID(PlayerInformation);
	if (typeof strNetworkID !== "string") {
		throw new Error("GetNetworkID() did not return a string.");
	}

	const Result = {
		Address: GetNetworkAddress(PlayerInformation),
		ClientConVarName: strClientConVarName,
		ClientConVarValue: GetClientCVarValue(PlayerInformation, strClientConVarName),
		ClientLanguage: GetClientLanguage(PlayerInformation),
		NetworkID: strNetworkID,
		SameNetworkID: GetNetworkIDFromIndex(unPlayerIndex),
	};
	if (!Object.values(Result).every((strValue) => typeof strValue === "string") || (Result.SameNetworkID !== strNetworkID)) {
		throw new Error(`Player ${unPlayerIndex} returned invalid identity or client values.`);
	}

	return Result;
}

module.exports = { InspectHumanClient };
```

## Errors

- `GetIndexFromName()`, `GetIndexFromNetworkID()` and `GetIndexFromUserID()` return `-1` when no connected player matches. The string searches throw for missing/non-string/empty names; `GetIndexFromUserID()` throws for a missing argument but returns `-1` for a supplied non-`Int32` value.
- `GetPlayerIndex()` only extracts an index and returns `-1` when called without a value. Use a conversion or query function when the workflow must prove the player is live.
- Every `GetPlayerInformationFrom*`, `GetEdictFrom*`, `GetBaseEntityFrom*`, `GetBaseHandleFrom*`, `GetIntegerHandleFrom*`, `GetAddressFrom*` and `GetUserIDFrom*` conversion first requires a currently resolvable player index. Invalid source values preserve an input exception or attempt to raise a JavaScript error; C++ exceptions are caught at the native callback boundary.
- A live player can still produce `null` for an unavailable base entity/base handle, `-1` for an unavailable integer handle, or `0n` for an unavailable base-entity address. It does not return an invalid base-handle descriptor. Check these native sentinels before a reverse conversion.
- Names are matched case-insensitively but exactly; partial-name matching belongs in a command or filter layer.
- Network-address, client-ConVar and language queries require `IVEngineServer`, a connected human client and, for the address, live `INetChannelInfo`.
- Do not obtain a player address from `memory/manager.GetSymbol()`. `GetPlayerInformationFromAddress()` expects a current `CBaseEntity*`, not an arbitrary function address.

## Lifecycle

Resolve descriptors, handles and addresses again after disconnects, entity deletion or map transitions. None of these values keeps an edict, base entity or player connection alive.

Use a native wrapper returned by `GetPlayerInformationFrom*()` only while its index still belongs to the same connection. Create a decorated [`Player`](players-entity.md) from that current index when higher-level methods are required.

The examples export helpers without invoking them at plugin load. Searches and conversions run only when the owning plugin supplies current identity data on the game thread, in an initialized SDK phase. Keep each workflow free of callbacks/hooks that can disconnect or replace the player. Separate lookups are not an atomic connection snapshot; matching indexes, user IDs, handles, or addresses do not pin the connection or prevent slot reuse.

The examples return `null` for no name match, unavailable base-entity/handle/address output, or a fake/disconnected client; malformed values and disagreement throw. Descriptor fields and the reverse wrapper's `Index` are captured once. The examples reject embedded NULs in caller strings as a safe-use precondition; do not infer that every native string API enforces this. Native and getter exceptions propagate unchanged, including non-`Error` thrown values. `InspectHumanClient()` reads the native wrapper's `Connected` and `FakeClient` live properties; it does not require the methods added by `players/entity`.

## Related Modules

- [`players/entity`](players-entity.md) creates the extended decorated `Player` wrapper.
- [`players`](players.md) exposes current rosters and standalone player operations.
- [`entities/helpers`](entities-helpers.md) provides the corresponding general entity-conversion graph.
- [`memory/manager`](memory-manager.md) resolves symbols and signatures, not player entities.
- [`netchannel`](netchannel.md) documents live `INetChannelInfo` and channel wrappers.
