# `require("steam")`

> Warning: This reference is intentionally detailed. Use the contents list to open only the selected-SDK capability
> or `SteamID` workflow needed for the current task.

`steam` exposes the selected Source SDK branch's current player identity operations. SDKs that provide `CSteamID` also
expose a JavaScript `SteamID` value and live-memory wrapper. Every 64-bit Steam value is represented as `bigint` so it
remains exact.

Unavailable SDK capabilities are omitted from the module or `SteamID.prototype`. SourceJS does not install fallback
implementations, placeholder methods, or compatibility aliases.

## Contents

- [Import](#import)
- [Availability](#availability)
- [Constants](#constants)
- [Player Identity](#player-identity)
- [`SteamID`](#steamid)
- [Construct And Parse IDs](#construct-and-parse-ids)
- [Read And Modify Fields](#read-and-modify-fields)
- [Attach To Native Memory](#attach-to-native-memory)
- [Compare And Copy](#compare-and-copy)
- [Classify The Current ID](#classify-the-current-id)
- [Create Anonymous IDs And Clear](#create-anonymous-ids-and-clear)
- [Errors And Lifecycle](#errors-and-lifecycle)
- [Related Modules](#related-modules)

## Import

Destructuring an omitted optional property produces `undefined`, which makes one import valid across SDK branches:

```js
const {
	AccountType,
	GetNetworkID,
	GetXUID,
	STEAM_BRANCH,
	STEAM_ID_SIZE,
	SteamID,
	Universe,
} = require("steam");
```

`STEAM_BRANCH` and `GetNetworkID` are always present. Every other export in this block is capability-conditioned as described
below.

## Availability

| Export | Availability | Purpose |
| --- | --- | --- |
| `STEAM_BRANCH` | Every supported SDK | Selected `hl2sdk` branch name. |
| [`GetNetworkID(nPlayerIndex)`](#getnetworkidnplayerindex) | Every supported SDK | Current engine network-ID string for a valid player. |
| [`GetXUID(nPlayerIndex)`](#getxuidnplayerindex) | SDK exposes a client XUID/SteamID engine method | Current exact XUID as `bigint`. |
| `STEAM_ID_SIZE` | SDK exposes `CSteamID` | Native structure size in bytes. |
| [`Universe`](#universe) | SDK exposes `CSteamID` | Selected SDK's Steam-universe constants. |
| [`AccountType`](#accounttype) | SDK exposes `CSteamID` | Selected SDK's account-type constants. |
| [`SteamID`](#steamid) | SDK exposes `CSteamID` | Detached or live-memory identity wrapper. |

The native `CSteamID` initializer creates its helper functions, `STEAM_ID_SIZE`, `Universe`, and `AccountType` as own writable, enumerable, configurable data properties. Both constant tables retain the ordinary object prototype and have own data properties with the same attributes; inherited setters or non-writable prototype properties cannot intercept their construction. This describes the native initializer, not a freeze or immutability guarantee for the JavaScript package exports. It does not validate a player's current identity or keep native storage alive.

Inspect capabilities once during plugin initialization, then enable only workflows whose dependencies are present:

```js
const {
	AccountType,
	GetNetworkID,
	GetXUID,
	STEAM_BRANCH,
	STEAM_ID_SIZE,
	SteamID,
	Universe,
} = require("steam");

function InspectSteamCapabilities() {
	return {
		HasAccountTypes: AccountType !== undefined,
		HasSteamID: typeof SteamID === "function",
		HasSteamIDSize: Number.isSafeInteger(STEAM_ID_SIZE) && (STEAM_ID_SIZE > 0),
		HasUniverses: Universe !== undefined,
		HasXUID: typeof GetXUID === "function",
		BranchName: STEAM_BRANCH,
	};
}

function ReadPlayerIdentity(nPlayerIndex) {
	if (!Number.isSafeInteger(nPlayerIndex) || (nPlayerIndex < 1)) {
		throw new TypeError("A positive player index is required.");
	}

	const PlayerIdentity = {
		BranchName: STEAM_BRANCH,
		NetworkID: GetNetworkID(nPlayerIndex),
	};

	if (typeof GetXUID === "function") {
		PlayerIdentity.XUID = GetXUID(nPlayerIndex);
	}

	return PlayerIdentity;
}

module.exports = {
	InspectSteamCapabilities,
	ReadPlayerIdentity,
};
```

Do not cache a player's returned identity as a live view. Call the function again when current engine state is required.

## Constants

Universe values and the standard account types come from the selected SDK. Account types omitted by older headers retain the documented protocol values below; these exports do not imply that every SDK can construct or validate those account types.

### `Universe`

| Name | Value |
| --- | ---: |
| `Invalid` | `0` |
| `Public` | `1` |
| `Beta` | `2` |
| `Internal` | `3` |
| `Development` | `4` |
| `Maximum` | Selected SDK's `k_EUniverseMax` (exclusive bound). |

`Maximum` is not a usable universe. For example, the reviewed CSGO headers define it as `5`, while the reviewed L4D2 headers define it as `6`. Read the export rather than hardcoding a branch-independent limit.

### `AccountType`

| Name | Value | Availability |
| --- | ---: | --- |
| `Invalid` | `0` | All `CSteamID` SDKs. |
| `Individual` | `1` | All `CSteamID` SDKs. |
| `Multiseat` | `2` | All `CSteamID` SDKs. |
| `GameServer` | `3` | All `CSteamID` SDKs. |
| `AnonymousGameServer` | `4` | All `CSteamID` SDKs. |
| `Pending` | `5` | All `CSteamID` SDKs. |
| `ContentServer` | `6` | All `CSteamID` SDKs. |
| `Clan` | `7` | All `CSteamID` SDKs. |
| `Chat` | `8` | All `CSteamID` SDKs. |
| `P2PSuperSeeder` | `9` | L4D2-family Steam headers. |
| `ConsoleUser` | `9` | BMS-family Steam headers. |
| `AnonymousUser` | `10` | All `CSteamID` SDKs. |

The key at value `9` follows the selected branch: L4D2 exposes `P2PSuperSeeder`, BMS exposes `ConsoleUser`, and other branches expose neither key. SourceJS does not add the other game's name as an alias.

## Player Identity

### `GetNetworkID(nPlayerIndex)`

Requires an integer client index accepted by the native player helper. It returns the engine's current network-ID string,
such as `"STEAM_1:1:12345"`. Invalid or disconnected players throw.

### `GetXUID(nPlayerIndex)`

When exported, accepts the same integer player index and returns the current exact XUID as `bigint`. It is omitted when
the selected engine interface cannot provide it.

The capability workflow above demonstrates both functions without hardcoding a client slot at module load.

## `SteamID`

The class exists only when `STEAM_ID_SIZE` is a positive safe integer. SourceJS then registers it as `"SteamID"` with the
memory object-type registry.

### Constructor Forms

```js
const {
	AccountType,
	SteamID,
	Universe,
} = require("steam");

function CreateSteamIDConstructorForms(SteamValue, unAccountID = 5, unAccountInstance = 1) {
	if ((typeof SteamID !== "function") || (Universe === undefined) || (AccountType === undefined)) {
		throw new Error("The selected SDK does not expose CSteamID.");
	}

	return {
		BlankSteamID: new SteamID(),
		FromValueSteamID: new SteamID(SteamValue),
		IndividualSteamID: new SteamID(unAccountID, Universe.Public, AccountType.Individual),
		InstancedSteamID: new SteamID(unAccountID, unAccountInstance, Universe.Public, AccountType.Individual),
	};
}

module.exports = { CreateSteamIDConstructorForms };
```

The `BlankSteamID` wrapper demonstrates the zero-argument form. The `FromValueSteamID` wrapper demonstrates the one-argument form,
which accepts:

- another `SteamID`;
- an object whose callable `ConvertSteamIDToUInt64()` returns a `bigint`;
- a `bigint` unsigned 64-bit Steam ID value;
- a decimal integer string;
- a formatted Steam2/Steam3 string accepted by the selected SDK parser.

The one-argument constructor reads an object's conversion method once and invokes that captured method with the source object as its receiver. Getter and conversion failures propagate without retry; the returned value must be an unsigned 64-bit `bigint`.

Native unsigned decimal parsing requires the complete numeric component. It rejects negative values, including after leading whitespace, overflow and embedded NUL characters rather than accepting a numeric prefix. Failed conversion does not commit a parsed value.

Formatted Steam2 and Steam3 input requires a universe below the selected SDK's `k_EUniverseMax` sentinel and a 32-bit account ID, with a 20-bit instance for Steam3. Steam2's universe `0` still maps to the public universe; Steam3 preserves the invalid-universe `0` value. Out-of-range components are rejected before updating the SteamID instead of being truncated by native bitfields.

The three-argument form calls `Set()`. The four-argument form calls `SetInstanced()`. Any other arity throws.

### Static Members

| Member | Result |
| --- | --- |
| `SteamID.TypeSize` | Same native byte count as `STEAM_ID_SIZE`. |
| `SteamID.Parse(strSteamIDText)` | Parses a decimal, Steam2, or Steam3 string into a new detached wrapper. |
| `SteamID.CreateFromValue(SteamValue)` | Returns an existing `SteamID` unchanged or constructs a new detached wrapper. |
| `SteamID.CreateFromAddress(unAddress, nAddressOffset = 0n)` | Creates a live non-owning view over a positive `bigint` address and an optional signed `bigint` byte offset. Also provides the registered-constructor factory used by `memory.MakeObject()`. |

### Live Fields And Properties

| Member | Access | Purpose |
| --- | --- | --- |
| `Address` | Read/write property | `0n` when detached; otherwise a positive `bigint` address. |
| `Value` | Read/write field | Detached unsigned 64-bit Steam ID as `bigint`; ignored while a valid address is attached. |
| `AccountID` | Read/write property | Current 32-bit account ID. |
| `AccountInstance` | Read/write property | Current account instance. |
| [`AccountType`](#accounttype) | Read/write property | Current selected-SDK `AccountType` value. |
| [`Universe`](#universe) | Read/write property | Current selected-SDK `Universe` value. |
| `StaticAccountKey` | Read-only property | Current exact static account key as `bigint`. |

Each Steam ID field getter derives its value from `ConvertSteamIDToUInt64()`. Each writable field setter rebuilds the native value and
writes through immediately when the wrapper is memory-backed. Assigning any `Address` other than the `0n` detached sentinel or a
positive `bigint` address throws before the attachment changes.

Use `SteamID.CreateFromAddress()` when an offset must be resolved or attachment intent should be explicit. Direct `Address`
assignment applies the same validation, and assigning `0n` detaches the wrapper.

Attachment does not read, snapshot, own, or free native memory. Attached writes do not update detached `Value`; detaching resumes that existing field, not the last value read from memory. A fresh `CreateFromAddress()` view has the cleared detached value. Copy the current value with `CopySteamID()` before detaching if it must be retained.

`Value` is an ordinary writable field: direct assignment is not immediately validated. Prefer `SetNativeValue()` to validate a new unsigned 64-bit value; detached reads normalize `Value` when it is used. A nonzero `Address` and `HasAddress()` do not prove that the underlying storage is readable, writable, correctly sized, or still alive.

### Value And Memory Methods

| Method | Result |
| --- | --- |
| `HasAddress()` | Whether the wrapper currently references a nonzero address. |
| `ReadAddressValue()` | Reads and normalizes the attached unsigned 64-bit value as `bigint`. |
| `WriteAddressValue(unSteamIDValue)` | Normalizes a `bigint` Steam ID value and writes it to the attached address; returns this wrapper. |
| `SetNativeValue(unSteamIDValue)` | Normalizes a `bigint` Steam ID value, then writes through when attached or replaces detached `Value`; returns this. |
| `GetSteamIDFields()` | Enumerable live view of `AccountID`, `AccountInstance`, `AccountType`, and `Universe`. |
| `ConvertSteamIDToUInt64()` | Current exact value as `bigint`. |
| `ConvertSteamIDToSteamID2()` | Current Steam2 string when the selected SDK supplies the operation. |
| `ConvertSteamIDToSteamID3()` | Current Steam3 string. |
| `toString()` | Same current Steam3 string as `ConvertSteamIDToSteamID3()`. |

`ReadAddressValue()` and `WriteAddressValue()` reject detached wrappers. `CreateFromAddress()` requires a positive `bigint` address;
its optional signed `bigint` byte offset must resolve to another positive address.

### Mutation Methods

| Method | Result |
| --- | --- |
| `Set(unAccountID, nUniverse, nAccountType)` | Replaces the value and returns this. |
| `SetInstanced(unAccountID, unAccountInstance, nUniverse, nAccountType)` | Replaces all fields and returns this. |
| `SetFull(unSteamIDIdentifier, nUniverse, nAccountType)` | Applies the selected SDK's full identifier setter and returns this. |
| `SetSteamIDFromUInt64(unSteamIDValue)` | Normalizes and replaces the value; returns this. |
| `CreateBlankAnonymousLogon(nUniverse)` | Replaces the value with a blank anonymous logon and returns this. |
| `CreateBlankAnonymousUserAccount(nUniverse)` | Replaces the value with a blank anonymous user and returns this. |
| `Clear()` | Replaces the value with the native cleared ID and returns this. |
| `ClearIndividualInstance()` | Clears the individual instance and returns this when supported. |

`Set()`, `SetInstanced()`, `SetFull()`, `CreateBlankAnonymousLogon()`, and `CreateBlankAnonymousUserAccount()` require `nUniverse` and any supplied `nAccountType` to be non-negative integers below the selected SDK's respective `Max` sentinel; `Invalid` (`0`) is still permitted to construct an invalid ID intentionally. `SetInstanced()` also requires `unAccountInstance` to fit the SDK's 20-bit instance mask (`0..0xFFFFF`). Out-of-range inputs throw before the native enum conversion or field write instead of being silently truncated. This does not restrict exact raw 64-bit input accepted by `SetSteamIDFromUInt64()`.

### Comparison And Copy Methods

| Method | Result |
| --- | --- |
| `AreEqual(SteamValue)` | Exact 64-bit equality. |
| `Compare(SteamValue)` | `-1`, `0`, or `1` by unsigned 64-bit value. |
| `CopySteamID()` | New detached wrapper with the current value. |
| `CopySteamIDFrom(SteamValue)` | Copies into this wrapper and returns this. |
| `CopySteamIDTo(TargetSteamID)` | Copies into another real `SteamID` and returns that target. |

`AreEqual()`, `Compare()`, and `CopySteamIDFrom()` accept a real `SteamID` or an unsigned 64-bit `bigint`. Unlike the one-argument constructor, these methods do not parse strings or call a foreign object's conversion method. `CopySteamID()` snapshots the current value into a detached wrapper; it does not transfer or duplicate memory ownership.

### Classification Methods

Each method below returns a current native predicate and is individually omitted if the selected SDK does not expose
its matching native operation:

| Method | Question |
| --- | --- |
| `IsValid()` | Is the full ID valid for a known account type? |
| `IsBlankAnonymousAccount()` | Is it a blank anonymous account? |
| `IsGameServerAccount()` | Is it any game-server account? |
| `IsPersistentGameServerAccount()` | Is it a persistent game server? |
| `IsAnonymousGameServerAccount()` | Is it an anonymous game server? |
| `IsContentServerAccount()` | Is it a content server? |
| `IsClanAccount()` | Is it a clan? |
| `IsChatAccount()` | Is it a chat account? |
| `IsLobby()` | Is it a lobby chat account? |
| `IsIndividualAccount()` | Is it an individual or selected-SDK console user? |
| `IsAnonymousUserAccount()` | Is it an anonymous user? |
| `IsAnonymousAccount()` | Is it any anonymous account? |
| `IsConsoleUserAccount()` | Is it the selected SDK's console-user type? |
| `HasNoIndividualInstance()` | Is an individual/console account missing its instance? |

## Construct And Parse IDs

This workflow exercises the one-, three-, and four-argument detached constructor forms plus the `Parse()` and `CreateFromValue()`
factories. Call it only after confirming `SteamID`, `Universe`, and `AccountType` are present.

```js
const {
	AccountType,
	SteamID,
	Universe,
} = require("steam");

function ConstructSteamIDs(strSteamIDText, unAccountID = 5) {
	if ((typeof SteamID !== "function") || (Universe === undefined) || (AccountType === undefined)) {
		throw new Error("The selected SDK does not expose CSteamID.");
	}

	const ParsedSteamID = SteamID.Parse(strSteamIDText);
	const IndividualSteamID = new SteamID(unAccountID, Universe.Public, AccountType.Individual);
	const InstancedSteamID = new SteamID(unAccountID, 1, Universe.Public, AccountType.Individual);
	const FromBigIntSteamID = new SteamID(ParsedSteamID.ConvertSteamIDToUInt64());
	const FromDecimalSteamID = new SteamID(ParsedSteamID.ConvertSteamIDToUInt64().toString());
	const CopiedByConstructorSteamID = new SteamID(ParsedSteamID);

	return {
		PreservedIdentity: SteamID.CreateFromValue(ParsedSteamID) === ParsedSteamID,
		CopiedByConstructorSteamID,
		FromDecimalSteamID,
		FromBigIntSteamID,
		IndividualSteamID,
		InstancedSteamID,
		ParsedSteamID,
	};
}

module.exports = { ConstructSteamIDs };
```

Constructor-created and parsed wrappers are detached. `SteamID.CreateFromValue(ParsedSteamID)` deliberately returns the exact existing
wrapper and therefore preserves any native-memory attachment. Formatting remains available through `ConvertSteamIDToSteamID3()`,
`toString()`, and the optional `ConvertSteamIDToSteamID2()`.

## Read And Modify Fields

`GetSteamIDFields()` returns an enumerable live view. Every property read observes the current `SteamID`, and every property
assignment updates that same wrapper or its attached native memory.

```js
const { SteamID } = require("steam");

function RequireSteamID(SteamIDInstance) {
	if ((typeof SteamID !== "function") || !(SteamIDInstance instanceof SteamID)) {
		throw new TypeError("A SteamID instance is required.");
	}

	return SteamIDInstance;
}

function GetSteamIDFields(SteamIDInstance) {
	const RequiredSteamID = RequireSteamID(SteamIDInstance);

	return RequiredSteamID.GetSteamIDFields();
}

function UpdateSteamIDFields(SteamIDInstance, FieldValues) {
	const RequiredSteamID = RequireSteamID(SteamIDInstance);
	const unAccountID = FieldValues.AccountID;
	const unAccountInstance = FieldValues.AccountInstance;
	const nAccountType = FieldValues.AccountType;
	const nUniverse = FieldValues.Universe;
	const UpdatedSteamID = RequiredSteamID.CopySteamID();
	const UpdatedFields = UpdatedSteamID.GetSteamIDFields();
	UpdatedFields.AccountID = unAccountID;
	UpdatedFields.AccountInstance = unAccountInstance;
	UpdatedFields.AccountType = nAccountType;
	UpdatedFields.Universe = nUniverse;

	RequiredSteamID.CopySteamIDFrom(UpdatedSteamID);

	return RequiredSteamID.GetSteamIDFields();
}

function BuildSteamIDVariants(unAccountID, unAccountInstance, unSteamIDIdentifier, nUniverse, nAccountType) {
	if (typeof SteamID !== "function") {
		throw new Error("The selected SDK does not expose CSteamID.");
	}

	const BasicSteamID = new SteamID();
	const InstancedSteamID = new SteamID();
	const FullSteamID = new SteamID();
	const RestoredSteamID = new SteamID();

	BasicSteamID.Set(unAccountID, nUniverse, nAccountType);
	InstancedSteamID.SetInstanced(unAccountID, unAccountInstance, nUniverse, nAccountType);
	FullSteamID.SetFull(unSteamIDIdentifier, nUniverse, nAccountType);
	RestoredSteamID.SetSteamIDFromUInt64(InstancedSteamID.ConvertSteamIDToUInt64());

	return {
		BasicSteamID,
		FullSteamID,
		InstancedSteamID,
		RestoredSteamID,
	};
}

module.exports = {
	BuildSteamIDVariants,
	GetSteamIDFields,
	UpdateSteamIDFields,
};
```

Keep the returned fields view when several systems need the same Steam ID. It remains current after mutation through the
wrapper, the view, or an external write to attached memory.

## Attach To Native Memory

`SteamID.CreateFromAddress()` is non-owning. The wrapper never allocates or frees the addressed memory. This workflow allocates
two object widths, attaches at the second slot through a signed byte offset, writes through, creates a detached copy, and checks
the owner block's release on every exit:

```js
const {
	Allocate,
	Deallocate,
} = require("memory");
const {
	STEAM_ID_SIZE,
	SteamID,
} = require("steam");

function CopySteamIDThroughMemory(SteamValue) {
	if ((typeof SteamID !== "function") || !Number.isSafeInteger(STEAM_ID_SIZE) || (STEAM_ID_SIZE < 1)) {
		throw new Error("The selected SDK does not expose CSteamID memory support.");
	}

	const unAllocationByteCount = STEAM_ID_SIZE * 2;
	if (!Number.isSafeInteger(unAllocationByteCount)) {
		throw new RangeError("The SteamID allocation size is not a safe integer.");
	}

	const unMemoryAddress = Allocate(unAllocationByteCount);
	if ((typeof unMemoryAddress !== "bigint") || (unMemoryAddress <= 0n)) {
		throw new Error("SteamID allocation did not return a positive BigInt address.");
	}

	let bOperationFailed = false;
	let OperationError = undefined;

	try {
		const AttachedSteamID = SteamID.CreateFromAddress(unMemoryAddress, BigInt(STEAM_ID_SIZE));
		const SourceSteamID = SteamID.CreateFromValue(SteamValue);
		const ReplacementSteamID = SourceSteamID.CopySteamID();

		AttachedSteamID.WriteAddressValue(SourceSteamID.ConvertSteamIDToUInt64());
		ReplacementSteamID.AccountID += 2;
		AttachedSteamID.SetNativeValue(ReplacementSteamID.ConvertSteamIDToUInt64());

		const unReadSteamIDValue = AttachedSteamID.ReadAddressValue();
		const DetachedSteamID = AttachedSteamID.CopySteamID();

		return {
			HasAddressBeforeRelease: AttachedSteamID.HasAddress(),
			DetachedSteamID,
			ReadSteamIDValue: unReadSteamIDValue,
		};
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			if (Deallocate(unMemoryAddress) !== true) {
				throw new Error("Deallocate() did not release the SteamID allocation.");
			}
		} catch (CleanupError) {
			const ReleaseError = bOperationFailed ? new AggregateError([OperationError, CleanupError], "SteamID operation and memory release failed.") : new Error("SteamID memory release failed.", { cause: CleanupError });
			ReleaseError.UnreleasedAddress = unMemoryAddress;
			throw ReleaseError;
		}
	}
}

module.exports = { CopySteamIDThroughMemory };
```

Only the returned detached copy and primitive report values remain valid after the function returns. The function does
not expose the attachment after its owner block is released.

If release fails, the function throws instead of returning a success report. `UnreleasedAddress` identifies the allocation
whose release was not confirmed; preserve it for investigation or controlled cleanup, not an automatic retry. An `AggregateError`
retains both the original operation failure and the cleanup failure, including thrown primitive values. Do not rerun memory writes
to recover from a cleanup error.

## Compare And Copy

```js
const { SteamID } = require("steam");

function CompareAndCopySteamIDs(LeftSteamValue, RightSteamValue) {
	if (typeof SteamID !== "function") {
		throw new Error("The selected SDK does not expose CSteamID.");
	}

	const LeftSteamID = SteamID.CreateFromValue(LeftSteamValue);
	const RightSteamID = SteamID.CreateFromValue(RightSteamValue);
	const DetachedCopySteamID = LeftSteamID.CopySteamID();
	const CopyFromTargetSteamID = new SteamID();
	const CopyToTargetSteamID = new SteamID();
	const CopyFromResultSteamID = CopyFromTargetSteamID.CopySteamIDFrom(RightSteamID);
	const CopyToResultSteamID = LeftSteamID.CopySteamIDTo(CopyToTargetSteamID);

	return {
		CopyFromMatchesRight: CopyFromTargetSteamID.AreEqual(RightSteamID),
		CopyFromReturnsTarget: CopyFromResultSteamID === CopyFromTargetSteamID,
		CopyToMatchesLeft: CopyToTargetSteamID.AreEqual(LeftSteamID),
		CopyToReturnsTarget: CopyToResultSteamID === CopyToTargetSteamID,
		Equals: LeftSteamID.AreEqual(RightSteamID),
		CopyEquals: DetachedCopySteamID.AreEqual(LeftSteamID),
		Comparison: LeftSteamID.Compare(RightSteamID),
	};
}

module.exports = { CompareAndCopySteamIDs };
```

`CopySteamID()`, `CopySteamIDFrom()`, and `CopySteamIDTo()` read the source's current value. Only `CopySteamID()` creates a new detached
wrapper. The other two methods preserve the target's attachment state; a memory-backed target receives an immediate write-through.

## Classify The Current ID

The selected SDK may omit individual native predicates. This workflow reports only methods actually present on the
current wrapper:

```js
const { SteamID } = require("steam");

const g_vecPredicateMethodNames = [
	"IsValid",
	"IsBlankAnonymousAccount",
	"IsGameServerAccount",
	"IsPersistentGameServerAccount",
	"IsAnonymousGameServerAccount",
	"IsContentServerAccount",
	"IsClanAccount",
	"IsChatAccount",
	"IsLobby",
	"IsIndividualAccount",
	"IsAnonymousUserAccount",
	"IsAnonymousAccount",
	"IsConsoleUserAccount",
	"HasNoIndividualInstance",
];

function ClassifySteamID(SteamValue) {
	if (typeof SteamID !== "function") {
		throw new Error("The selected SDK does not expose CSteamID.");
	}

	const SteamIDInstance = SteamID.CreateFromValue(SteamValue);
	const Classifications = {};

	for (const strMethodName of g_vecPredicateMethodNames) {
		const Classify = SteamIDInstance[strMethodName];
		if (typeof Classify === "function") {
			Classifications[strMethodName] = Reflect.apply(Classify, SteamIDInstance, []);
		}
	}

	return Classifications;
}

module.exports = { ClassifySteamID };
```

The result is a classification record for that call. Re-run the function after mutating a live wrapper or its
underlying memory.

## Create Anonymous IDs And Clear

```js
const {
	AccountType,
	SteamID,
	Universe,
} = require("steam");

function CreateAnonymousSteamIDs(nUniverseOverride) {
	if ((typeof SteamID !== "function") || (Universe === undefined) || (AccountType === undefined)) {
		throw new Error("The selected SDK does not expose CSteamID.");
	}

	const nSelectedUniverse = (nUniverseOverride === undefined) ? Universe.Public : nUniverseOverride;
	const AnonymousLogonSteamID = new SteamID();
	const AnonymousUserSteamID = new SteamID();
	const ClearedSteamID = new SteamID(1, nSelectedUniverse, AccountType.Individual);
	const IndividualSteamID = new SteamID(1, 1, nSelectedUniverse, AccountType.Individual);

	AnonymousLogonSteamID.CreateBlankAnonymousLogon(nSelectedUniverse);
	AnonymousUserSteamID.CreateBlankAnonymousUserAccount(nSelectedUniverse);
	ClearedSteamID.Clear();

	const SteamIDs = {
		AnonymousLogonSteamID,
		AnonymousUserSteamID,
		ClearedSteamID,
	};

	const ClearIndividualInstance = IndividualSteamID.ClearIndividualInstance;
	if (typeof ClearIndividualInstance === "function") {
		Reflect.apply(ClearIndividualInstance, IndividualSteamID, []);
		SteamIDs.IndividualWithoutInstanceSteamID = IndividualSteamID;
	}

	return SteamIDs;
}

module.exports = { CreateAnonymousSteamIDs };
```

Every returned wrapper is detached. `ClearedSteamID.ConvertSteamIDToUInt64()` is the selected SDK's native cleared value, and
`IndividualWithoutInstanceSteamID` exists only when the selected SDK exposes the matching operation.

## Errors And Lifecycle

- Pass integer client indexes to `GetNetworkID()` and optional `GetXUID()`.
- Keep 64-bit values as `bigint`; converting them to an unsafe `number` loses identity bits.
- Check capability-conditioned exports and prototype methods when supporting multiple SDK branches.
- Use `bigint` addresses only. A function or symbol address is valid only if it actually addresses a live `CSteamID`
  object.
- Keep the native owner alive for the complete lifetime of a memory-backed wrapper.
- Never use an attached wrapper after its owner frees or reallocates the memory.
- Do not manually deallocate a detached wrapper; it owns no native heap allocation.
- Use canonical PascalCase JavaScript methods. No legacy aliases or serializer snapshots are exported.

Native parsing, normalization, player validation, and memory errors propagate as JavaScript exceptions. Property setters
can partially update a sequence of manual assignments if a later setter throws; use `SetInstanced()` when all four
fields should be rebuilt in one native operation.

The native callbacks backing player identity, normalization, parsing, field-record construction, `Set()`/`SetInstanced()`/`SetFull()`, blank-account creation, `Clear()`/`ClearIndividualInstance()`, static-account-key extraction, Steam2/Steam3 formatting, and account predicates translate C++ exceptions into operation-specific JavaScript errors without replacing a pending JavaScript error or termination. Player-index conversion stops before engine lookup when conversion raises a JavaScript error. These boundaries do not roll back earlier JavaScript setter side effects or make a stale attached native address safe.

## Related Modules

- [`memory`](memory.md) allocates owner blocks and registers custom object types.
- [`memory/helpers`](memory-helpers.md) performs BigInt address arithmetic and typed memory access.
- [`players`](players.md) provides higher-level player identity and entity wrappers.
