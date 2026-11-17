# `require("settings/player")`

> AI processing note: this page documents module-scoped group definitions and per-player storage views. Keep
> definition ownership, network-ID resolution, menu delivery and stored-value mutation as separate lifecycles.

`settings/player` organizes typed settings into named menu trees and binds stored values to one player identity.
`PlayerSettings` roots register in the current module instance's registry for [`settings/menu`](settings-menu.md). `PlayerSettingsValues` delegates
every value operation to a [`SettingsStorage`](settings-storage.md)-compatible backend.

Definition, registry, identity and menu methods are synchronous. The five `PlayerSettingsValues` I/O methods require
`Options` followed by `Callback`, return `undefined` directly and complete through `Callback(RequestError, RequestResult)`.
`Blocking: true` waits for the request but still uses its callback; it does not restore synchronous return values.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Names And Prefixes](#names-and-prefixes)
- [SettingsDictionary](#settingsdictionary)
- [Own A Player Settings Tree](#own-a-player-settings-tree)
- [Manage A Dictionary Directly](#manage-a-dictionary-directly)
- [PlayerSettings](#playersettings)
- [Player Identity](#player-identity)
- [PlayerSettingsValues](#playersettingsvalues)
- [Implement A Custom Backend](#implement-a-custom-backend)
- [Errors And Lifecycle](#errors-and-lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	REGISTERED_PLAYER_SETTINGS,
	CreatePlayerSettings,
	GetPlayerSettings,
	GetUniqueIDFromPlayer,
	PlayerSettings,
	PlayerSettingsValues,
	SettingsDictionary,
} = require("settings/player");
```

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `REGISTERED_PLAYER_SETTINGS` | Live `Map` | Maps exact root names to current `PlayerSettings` objects. |
| [`SettingsDictionary`](#settingsdictionary) | Class | Named tree node containing settings and nested sections. |
| [`PlayerSettings`](#playersettings) | Class | Registered root dictionary with explicit `Unregister()` ownership. |
| [`PlayerSettingsValues`](#playersettingsvalues) | Class | Value operations through canonical player-ID and storage-backend fields. |
| `GetPlayerSettings()` | Live iterator | Returns `REGISTERED_PLAYER_SETTINGS.values()` in insertion order. |
| `CreatePlayerSettings(PlayerReference, SettingsStorage?)` | `PlayerSettingsValues` | Constructs a values view. |
| `GetUniqueIDFromPlayer(PlayerReference)` | `string` | Accepts an ID or resolves native `GetNetworkID()`. |

The registry belongs to the current module instance; isolated plugin contexts do not share it. Its `Map` and group objects are live and writable. The iterator returned by `GetPlayerSettings()` observes
roots registered after iterator creation until that iterator is exhausted. Use constructors and `Unregister()` to
preserve uniqueness and menu invariants.

Editing a root's `Name` does not rekey the registry. Retain the originally registered name for key-based lookup, or
use the live iterator to find the root by identity. `Unregister()` removes that identity even after a name edit.

## Names And Prefixes

Dictionary names and keys contain only ASCII letters, spaces or underscores, with at least one letter. Their exact
spelling, including spaces and case, is retained for collection lookup. Digits, empty and separator-only names are invalid.

A `PlayerSettings` root prefix contains only ASCII letters or underscores, with at least one letter. Its underscore-separated
words are concatenated with uppercase initials: `Source_JS` becomes `SourceJS`. A direct `SettingsDictionary` option named
`Prefix` is stored as supplied and may be empty; it is not subjected to the root prefix's character validation.

When propagating prefixes, spaces and underscores separate words; empty segments are removed, each word's first character
is uppercased and its remaining casing is preserved. There is no inserted separator or automatic acronym correction.
An empty prefix stays empty for direct settings. A nested dictionary appends its own name token. Root prefix `match` plus
section `Advanced Rules` therefore gives that section's settings `MatchAdvancedRules`. A typed setting named `Allow Pause`
then has `ConVar` equal to `MatchAdvancedRulesAllowPause`.

Changing a name or prefix does not migrate old stored keys or install aliases. After editable prefix/name changes, call
`RefreshChildPrefixes()` to update definitions; stored-value migration is a separate caller-owned operation.

## SettingsDictionary

### Constructor

`new SettingsDictionary(strSettingsDictionaryName, strSettingsDictionaryText = null, SettingsDictionaryOptions = {})`

| Option | Default | Purpose |
| --- | --- | --- |
| `Prefix` | `""` | Prefix source assigned to direct children. |
| `Parent` | `null` | Parent `SettingsDictionary` used by `Path` and nested prefix propagation. |

Options must be a non-array object. Only own `Prefix` and `Parent` properties are read; an absent property or an
own `undefined` uses its default. Getters may execute during validation. The constructor creates a menu, but does
not register this dictionary globally or add it to its supplied parent.

### Fields And Properties

| Member | Kind | Purpose |
| --- | --- | --- |
| `Name` | Read/write property | Constructor validates the name; later assignments check only that it is a string. |
| `Text` | Read/write property | String display label or `null` to use `Name`. |
| `Prefix` | Read/write property | String prefix source for children; assignment does not refresh them. |
| `Parent` | Read/write property | Expected parent dictionary or `null`; assignment itself does not validate the hierarchy. |
| `Items` | Read/write property | Expected live `Map` of child names to dictionaries/types; collection methods validate its type. |
| `Menu` | Getter | Current `PagedMenu`, kept in sync by `SetSetting()`, `DeleteSetting()` and `ClearSettings()`. |
| `Option` | Attached field | `SetSetting()` assigns the child's `PagedMenuOption`; an unattached dictionary has no option. A `PlayerSettings` root creates its own. |
| `Size` | Getter | Current `Items.size`. |
| `Path` | Getter | Fresh root-to-node name array; validates each current name, parent type and parent cycle. |
| `ValueName`, `ValueText`, `ValuePrefix`, `ValueParent`, `ValueItems`, `ValueMenu` | Writable backing fields | Store the corresponding property values; direct writes bypass setter checks. |

Treat the backing fields and live collections as implementation state. Arbitrary edits can break name, hierarchy or menu
invariants; use the collection/construction methods. Name edits do not rekey a parent's `Items`, refresh menu labels or
rekey the root registry. A malformed editable name may be accepted by its setter and rejected later by `Path` or prefix propagation.

### Collection Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `Keys()` | Iterator | Live `Items` key iterator. |
| `Values()` | Iterator | Live `Items` value iterator. |
| `Entries()` | Iterator | Live `Items` entry iterator. |
| `[Symbol.iterator]()` | Iterator | Same iterator as `Entries()`. |
| `ForEach(SettingsCallback, CallbackReceiver = undefined)` | `undefined` | Calls `SettingsCallback(SettingsEntry, strSettingName, SettingsDictionary)` with `CallbackReceiver` as `this`. |
| `HasSetting(strSettingName)` | `boolean` | Validates and checks a child name. |
| `GetSetting(strSettingName)` | Object or `null` | Returns one child. |
| `SetSetting(strSettingName, SettingsEntry)` | Supplied object | Adds a real dictionary/type and its menu option. |
| `DeleteSetting(strSettingName)` | `boolean` | Removes one child and its attached menu option. |
| `ClearSettings()` | `true` | Deletes every current child through `DeleteSetting()`. |

These operations are not transactions. `SetSetting()` updates prefixes and the attached option before appending to
the menu and committing the map entry. A later failure does not roll back earlier mutations. `DeleteSetting()` removes
the menu option before deleting the field and map entry; `ClearSettings()` may delete some children before failing.
Live iteration, including `ForEach()`, follows `Map` mutation semantics; callbacks receive this dictionary as their
third argument, and thrown values propagate unchanged.

### Construction And Menu Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `AddIntegerSetting(strSettingName, nDefaultSettingValue, SettingOptions = {})` | `IntegerSetting` | Adds an integer type. |
| `AddBooleanSetting(strSettingName, bDefaultSettingValue, SettingOptions = {})` | `BooleanSetting` | Adds a boolean type. |
| `AddStringSetting(strSettingName, strDefaultSettingValue, SettingOptions = {})` | `StringSetting` | Adds a string type. |
| `AddSection(strSettingName, SectionOptions = {})` | `SettingsDictionary` | Adds a child with this node as `Parent`. |
| `ApplyPrefix(SettingsEntry)` | `undefined` | Recomputes one child's prefix and recursively refreshes a dictionary child. |
| `RefreshChildPrefixes()` | `undefined` | Reapplies this dictionary's prefix to every current child. |
| `Choose(unPlayerIndex, SettingsEntry)` | `boolean` | Sends a dictionary entry; a setting type returns `false`. |
| `Send(unPlayerIndex, unPageIndex = 0, TokenRecord = {})` | `boolean` | Forwards all arguments to this dictionary's `Menu`. |

## Own A Player Settings Tree

This controller keeps one root registered in that module instance for the complete plugin lifetime. Its inspection method
exercises the live map and iterator APIs without printing or copying root ownership:

```js
const {
	REGISTERED_PLAYER_SETTINGS,
	PlayerSettings,
	GetPlayerSettings,
} = require("settings/player");

function CreateMatchSettingsController() {
	const strRegisteredRootName = "Match Controls";
	let AdvancedRulesSection = null;
	let MatchSettingsRoot = null;

	function RequireMatchSettingsRoot() {
		if (MatchSettingsRoot === null) {
			throw new Error("Match settings are not loaded.");
		}

		return MatchSettingsRoot;
	}

	function ReleaseMatchSettingsRoot() {
		const vecCleanupErrors = [];
		let bMatchSettingsRootRemoved = false;

		try {
			MatchSettingsRoot.ClearSettings();
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		try {
			bMatchSettingsRootRemoved = MatchSettingsRoot.Unregister();
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		if (vecCleanupErrors.length !== 0) {
			throw new AggregateError(vecCleanupErrors, "Match settings cleanup failed; ownership is retained for retry.");
		}

		AdvancedRulesSection = null;
		MatchSettingsRoot = null;

		return bMatchSettingsRootRemoved;
	}

	return {
		Inspect() {
			const MatchSettings = RequireMatchSettingsRoot();
			const vecSettingsVisits = [];
			let bLiveRegistryContainsRoot = false;
			MatchSettings.ForEach((SettingsEntry, strSettingName, SettingsDictionary) => {
				vecSettingsVisits.push({ SettingsEntry, SettingName: strSettingName, SettingsDictionary });
			});

			for (const RegisteredPlayerSettingsEntry of GetPlayerSettings()) {
				if (RegisteredPlayerSettingsEntry === MatchSettings) {
					bLiveRegistryContainsRoot = true;
					break;
				}
			}

			return {
				AllSettingsAreItems: MatchSettings.GetAllSettings() === MatchSettings.Items,
				Entries: Array.from(MatchSettings.Entries()),
				HasAutoReady: MatchSettings.HasSetting("Auto Ready"),
				IteratorEntries: Array.from(MatchSettings),
				Keys: Array.from(MatchSettings.Keys()),
				MinimumPlayers: MatchSettings.GetSetting("Minimum Players"),
				Path: MatchSettings.Path,
				RootRegistered: REGISTERED_PLAYER_SETTINGS.get(strRegisteredRootName) === MatchSettings,
				Size: MatchSettings.Size,
				LiveRegistryContainsRoot: bLiveRegistryContainsRoot,
				Values: Array.from(MatchSettings.Values()),
				Visits: vecSettingsVisits,
			};
		},
		Load() {
			if (MatchSettingsRoot !== null) {
				throw new Error("Match settings are already loaded.");
			}

			MatchSettingsRoot = new PlayerSettings(strRegisteredRootName, "Match", "Match Controls");

			try {
				MatchSettingsRoot.AddBooleanSetting("Auto Ready", true, { Text: "Automatic ready-up" });
				MatchSettingsRoot.AddIntegerSetting("Minimum Players", 4, { Maximum: 32, Minimum: 1 });
				MatchSettingsRoot.AddStringSetting("Ready Message", "Ready", { Choices: ["Ready", "Prepared"] });
				AdvancedRulesSection = MatchSettingsRoot.AddSection("Advanced Rules", { Text: "Advanced Rules" });
				AdvancedRulesSection.AddBooleanSetting("Allow Pause", true);

				return MatchSettingsRoot;
			} catch (ErrorObject) {
				try {
					ReleaseMatchSettingsRoot();
				} catch (CleanupError) {
					throw new AggregateError([ErrorObject, CleanupError], "Match settings load and cleanup failed.");
				}

				throw ErrorObject;
			}
		},
		OpenAdvanced(unPlayerIndex) {
			const MatchSettings = RequireMatchSettingsRoot();

			return MatchSettings.Choose(unPlayerIndex, AdvancedRulesSection);
		},
		Show(unPlayerIndex, unPageIndex = 0) {
			const MatchSettings = RequireMatchSettingsRoot();

			return MatchSettings.Send(unPlayerIndex, unPageIndex, { Scope: "match" });
		},
		Unload() {
			if (MatchSettingsRoot === null) {
				return false;
			}

			return ReleaseMatchSettingsRoot();
		},
	};
}

module.exports = { CreateMatchSettingsController };
```

The nested section and every typed setting remain owned by the root until unload. `GetPlayerSettings()` returns a
live registry iterator that observes later root registrations until exhaustion.

The controller captures its original registry key, so `Inspect().RootRegistered` still identifies its owned root after
an editable `Name` change. Such edits do not automatically refresh child prefixes or labels.

Cleanup attempts both clearing and unregistering, even if one throws. A load failure is rethrown unchanged after
successful cleanup, including a thrown `null` or `undefined`; otherwise an `AggregateError` retains the load failure
and every cleanup failure. Failed cleanup retains the controller's references for a later `Unload()` retry and blocks
another `Load()`. Registry removal may already have succeeded, so retrying can finish cleanup and return `false`.
Neither cleanup nor prefix propagation promises to undo earlier partial mutations.

## Manage A Dictionary Directly

`SetSetting()` accepts only actual `SettingsDictionary` or `SettingsType` instances. Prefix updates happen immediately and recursively:

```js
const { SettingsDictionary } = require("settings/player");
const { BooleanSetting, IntegerSetting } = require("settings/types");

function ExerciseSettingsDictionary(unPlayerIndex) {
	const AudioSettings = new SettingsDictionary("Audio", "Audio Settings", { Prefix: "Audio" });
	const VolumeSetting = AudioSettings.SetSetting("Volume", new IntegerSetting("Volume", 80, { Maximum: 100, Minimum: 0 }));
	const AdvancedAudioSettings = AudioSettings.AddSection("Advanced", { Text: "Advanced Audio" });
	const MuteMusicSetting = AdvancedAudioSettings.SetSetting("Mute Music", new BooleanSetting("Mute Music", false));

	AudioSettings.ApplyPrefix(VolumeSetting);
	AudioSettings.RefreshChildPrefixes();

	const bVolumeChoiceResult = AudioSettings.Choose(unPlayerIndex, VolumeSetting);
	const bAdvancedAudioChoiceResult = AudioSettings.Choose(unPlayerIndex, AdvancedAudioSettings);
	const bVolumeDeleted = AudioSettings.DeleteSetting("Volume");
	const MissingVolumeAfterDelete = AudioSettings.GetSetting("Volume");
	const unRemainingAudioSettingCount = AudioSettings.Size;
	const bAudioSettingsCleared = AudioSettings.ClearSettings();

	return {
		AdvancedAudioChoiceResult: bAdvancedAudioChoiceResult,
		AudioSettingsCleared: bAudioSettingsCleared,
		AudioSettingsSizeAfterClear: AudioSettings.Size,
		MissingVolumeAfterDelete,
		MuteMusicSettingPrefix: MuteMusicSetting.Prefix,
		RemainingAudioSettingCount: unRemainingAudioSettingCount,
		VolumeChoiceResult: bVolumeChoiceResult,
		VolumeDeleted: bVolumeDeleted,
		VolumeSettingPrefix: VolumeSetting.Prefix,
	};
}

module.exports = { ExerciseSettingsDictionary };
```

The nested choice invokes `AdvancedAudioSettings.Send(unPlayerIndex)`, which delegates to its menu. A standalone
integer setting returns `false` without menu delivery.

## PlayerSettings

`new PlayerSettings(strSettingsName, strSettingsPrefix, strSettingsText = null)`

Construction validates root-name uniqueness, normalizes the prefix, creates a root `PagedMenuOption` and immediately
inserts the object into `REGISTERED_PLAYER_SETTINGS`. It inherits every `SettingsDictionary` member.

| Additional member | Result | Purpose |
| --- | --- | --- |
| `Option` | `PagedMenuOption` | Root option whose value is this group. |
| `GetAllSettings()` | Live `Map` | Returns the exact `Items` object. |
| `Unregister()` | `boolean` | Removes this exact object identity from the module instance's registry. |

`Unregister()` changes registry visibility but does not clear `Items`, destroy menus or make the object unusable. The
owning plugin decides whether to call `ClearSettings()` before unregistering.

## Player Identity

`GetUniqueIDFromPlayer(PlayerReference)` returns any non-empty string unchanged. A positive safe-integer value or a
non-array object with a positive safe-integer `Index` is passed to native `players.GetNetworkID()`:

```js
const { GetUniqueIDFromPlayer } = require("settings/player");

function ResolvePlayerIdentities(unPlayerIndex, strExpectedNetworkID) {
	const strNetworkIDFromIndex = GetUniqueIDFromPlayer(unPlayerIndex);
	const strNetworkIDFromObject = GetUniqueIDFromPlayer({ Index: unPlayerIndex });
	const strDirectNetworkID = GetUniqueIDFromPlayer(strExpectedNetworkID);
	if ((strNetworkIDFromIndex !== strExpectedNetworkID) || (strNetworkIDFromObject !== strExpectedNetworkID) || (strDirectNetworkID !== strExpectedNetworkID)) {
		throw new Error("Player identity representations do not resolve to the expected network ID.");
	}

	return { DirectNetworkID: strDirectNetworkID, NetworkIDFromIndex: strNetworkIDFromIndex, NetworkIDFromObject: strNetworkIDFromObject };
}

module.exports = { ResolvePlayerIdentities };
```

The JavaScript precheck requires a positive safe integer but cannot prove that the index belongs to a connected player.
Disconnected indexes fail through the native player query. Empty strings and unsupported value shapes throw before
storage access.

An object reference's `Index` is read once and may be inherited or implemented by a getter. A direct string ID bypasses
the native query; no Steam-ID syntax or connected-player check is performed for that string. Indices are `Number`
values, not native addresses or `BigInt` values.

## PlayerSettingsValues

### Constructor And Factory

`new PlayerSettingsValues(PlayerReference, SettingsStorage = DEFAULT_STORAGE)`

`CreatePlayerSettings(PlayerReference, SettingsStorage = DEFAULT_STORAGE)` returns an instance of the same class.
Construction checks all five backend methods and resolves the initial identity once; it does not open a database or
perform value I/O. Subsequent operations validate the current `ValueUniqueID`, request pair and selected method on
`ValueStorage`, without querying native player identity again.

| Member | Kind | Purpose |
| --- | --- | --- |
| `UniqueID` | Getter | Current `ValueUniqueID`. |
| `Storage` | Getter | Current `ValueStorage`. |
| `ValueUniqueID`, `ValueStorage` | Writable backing fields | Hold the identity and backend used by future operations; direct edits do not resolve an identity or validate the backend. |
| `GetSetting(strSettingName, DefaultValue = null, Options, Callback)` | Method | Calls backend `GetSetting(strPlayerUniqueID, strSettingName, DefaultValue, RequestOptions, Callback)`. |
| `SetSetting(strSettingName, SettingsValue, Options, Callback)` | Method | Calls backend `SetSetting(strPlayerUniqueID, strSettingName, SettingsValue, RequestOptions, Callback)`. |
| `DeleteSetting(strSettingName, Options, Callback)` | Method | Calls backend `DeleteSetting(strPlayerUniqueID, strSettingName, RequestOptions, Callback)`. |
| `ClearSettings(Options, Callback)` | Method | Calls backend `ClearPlayer(strPlayerUniqueID, RequestOptions, Callback)`. |
| `GetAllSettings(Options, Callback)` | Method | Calls backend `GetPlayerValues(strPlayerUniqueID, RequestOptions, Callback)`. |

### Request Options And Completion

Every I/O call requires a non-null, non-array `Options` object followed by a function `Callback`, including in Blocking
mode. `Options.Blocking` may be omitted or boolean; it is read once and captured in a fresh `{ Blocking: boolean }`
object passed to the backend. Other options are not forwarded by this facade. Later caller mutations do not change the
captured mode. For the default fallback, write `GetSetting(strSettingName, null, Options, Callback)`; the required pair
cannot occupy the `DefaultValue` argument slot.

`Blocking` follows ordinary property lookup, including inherited values and getters. `null` is not a valid mode.
Option getters execute during validation; the facade does not snapshot or prevent their side effects.

All five methods return `undefined` directly. A successful completion uses `Callback(null, RequestResult)`; backend
failures use the backend's error and failure result unchanged. Missing-value defaults, mutation booleans, record identity,
supported value types and exact `bigint` handling are backend contracts, not conversions performed by this facade.
The original callback and backend receiver are preserved. The facade does not add a queue, switch threads, catch callback
exceptions or retry requests: completion timing, threading and resource lifetime follow the selected backend.

With the built-in backend, `Blocking: true` retains the inline callback; a default-mode cache hit may also complete inline.
Database work is callback-based. A Blocking request cannot be queued behind pending work on the same storage; it throws
synchronously. See [`settings/storage`](settings-storage.md) for its FIFO, callback context, transaction and shutdown contracts.
Do not close or replace a backend while an operation still needs it, or assume that returning from a default-mode call
means it has completed.

`GetAllSettings()` may initialize a missing player record, and the built-in backend returns a live value object, not a
snapshot. `GetSetting()` may also initialize missing state through that read path. Copy a completed record when a stable
inspection result is needed; direct edits to a returned live object are not a substitute for persisted `SetSetting()` calls.
Use `ClearSettings()` only for a deliberately owned storage namespace: it removes every value for the bound identity.

### Owned Values Workflow

This helper requires the same `Options, Callback` pair, captures its mode once, serializes its dependent requests and
completes with the result below. It stops on the first backend error with `Callback(RequestError, null)`; earlier successful
mutations are not rolled back. It snapshots the after-delete record before clearing values. The final read can recreate an
empty player record, so the example does not promise that the identity's database row stays deleted:

```js
const {
	PlayerSettingsValues,
	CreatePlayerSettings,
} = require("settings/player");

function ExercisePlayerSettingsValues(PlayerReference, SettingsStorage, Options, Callback) {
	if ((SettingsStorage === null) || (typeof SettingsStorage !== "object") || Array.isArray(SettingsStorage)) {
		throw new TypeError("A dedicated settings storage object is required.");
	}

	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("An Options object is required.");
	}

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("Options.Blocking must be a boolean.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("A Callback function is required.");
	}

	const RequestOptions = { Blocking: bBlocking === true };
	const PlayerValues = CreatePlayerSettings(PlayerReference, SettingsStorage);
	const DirectPlayerValues = new PlayerSettingsValues(PlayerValues.UniqueID, SettingsStorage);
	const WorkflowResult = {
		DirectPlayerUniqueID: DirectPlayerValues.UniqueID,
		PlayerUniqueID: PlayerValues.UniqueID,
	};
	const vecSteps = [
		{ PropertyName: "MissingTeamPreference", Request: (CompleteRequest) => PlayerValues.GetSetting("Preferred Team", "auto", RequestOptions, CompleteRequest) },
		{ PropertyName: "PreferredTeamStored", Request: (CompleteRequest) => PlayerValues.SetSetting("Preferred Team", "survivor", RequestOptions, CompleteRequest) },
		{ PropertyName: "DamageNumbersStored", Request: (CompleteRequest) => DirectPlayerValues.SetSetting("Damage Numbers", true, RequestOptions, CompleteRequest) },
		{ PropertyName: "DamageNumbersDeleted", Request: (CompleteRequest) => PlayerValues.DeleteSetting("Damage Numbers", RequestOptions, CompleteRequest) },
		{ PropertyName: "PlayerValuesAfterDelete", Request: (CompleteRequest) => PlayerValues.GetAllSettings(RequestOptions, CompleteRequest) },
		{ PropertyName: "PlayerValuesCleared", Request: (CompleteRequest) => DirectPlayerValues.ClearSettings(RequestOptions, CompleteRequest) },
		{ PropertyName: "PlayerValuesAfterClear", Request: (CompleteRequest) => PlayerValues.GetAllSettings(RequestOptions, CompleteRequest) },
	];
	let unStepIndex = 0;
	const CompleteStep = (RequestError, RequestResult) => {
		if (RequestError !== null) {
			Callback(RequestError, null);
			return;
		}

		const strPropertyName = vecSteps[unStepIndex].PropertyName;
		WorkflowResult[strPropertyName] = (strPropertyName === "PlayerValuesAfterDelete") ? { ...RequestResult } : RequestResult;
		unStepIndex += 1;
		if (unStepIndex === vecSteps.length) {
			Callback(null, WorkflowResult);
			return;
		}

		vecSteps[unStepIndex].Request(CompleteStep);
	};
	vecSteps[0].Request(CompleteStep);
}

module.exports = { ExercisePlayerSettingsValues };
```

Names use the same validation as dictionary keys and are passed to storage exactly as supplied. They are not derived
from a settings-tree prefix; callers of this raw values view choose their own keys. `PlayerSettingsValues` does not clone,
freeze or reinterpret callback results. This helper's explicit shallow after-delete copy is not a general facade behavior.

## Implement A Custom Backend

A backend must expose callable `GetSetting`, `SetSetting`, `DeleteSetting`, `ClearPlayer` and `GetPlayerValues` methods with
the signatures above: identity first, operation-specific arguments next, then required `Options, Callback`. Request methods
return `undefined` and complete once through the callback, even with Blocking enabled. A production I/O backend must
provide the appropriate worker execution, caller-thread callback delivery and shutdown ownership itself.

This in-memory model performs no external I/O. It schedules default-mode work with Promise microtasks, executes Blocking
work inline and completes with a live null-prototype value object per identity or boolean mutation results. Microtasks do
not create worker threads or make a blocking database/network call safe for the game thread:

```js
class MemorySettingsStorage {
	constructor() {
		this.PlayerValuesByUniqueID = new Map();
	}

	// In-memory timing model only; Promise microtasks are not native workers.
	RunRequest(Options, Callback, Operation) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("An Options object is required.");
		}

		const bBlocking = Options.Blocking;
		if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
			throw new TypeError("Options.Blocking must be a boolean.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("A Callback function is required.");
		}

		const ExecuteRequest = () => {
			let RequestResult = undefined;

			try {
				RequestResult = Operation();
			} catch (RequestError) {
				const OperationError = (RequestError === null) ? new Error("Memory settings operation threw null.", { cause: RequestError }) : RequestError;
				Callback(OperationError, null);
				return;
			}

			Callback(null, RequestResult);
		};

		if (bBlocking === true) {
			ExecuteRequest();
			return;
		}

		Promise.resolve().then(ExecuteRequest);
	}

	GetOrCreatePlayerValues(strPlayerUniqueID) {
		if (!this.PlayerValuesByUniqueID.has(strPlayerUniqueID)) {
			this.PlayerValuesByUniqueID.set(strPlayerUniqueID, Object.create(null));
		}

		return this.PlayerValuesByUniqueID.get(strPlayerUniqueID);
	}

	GetPlayerValues(strPlayerUniqueID, Options, Callback) {
		this.RunRequest(Options, Callback, () => this.GetOrCreatePlayerValues(strPlayerUniqueID));
	}

	GetSetting(strPlayerUniqueID, strSettingName, DefaultValue = null, Options, Callback) {
		this.RunRequest(Options, Callback, () => {
			const SettingsValues = this.GetOrCreatePlayerValues(strPlayerUniqueID);

			return Object.hasOwn(SettingsValues, strSettingName) ? SettingsValues[strSettingName] : DefaultValue;
		});
	}

	SetSetting(strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback) {
		this.RunRequest(Options, Callback, () => {
			this.GetOrCreatePlayerValues(strPlayerUniqueID)[strSettingName] = SettingsValue;

			return true;
		});
	}

	DeleteSetting(strPlayerUniqueID, strSettingName, Options, Callback) {
		this.RunRequest(Options, Callback, () => {
			const SettingsValues = this.GetOrCreatePlayerValues(strPlayerUniqueID);
			if (!Object.hasOwn(SettingsValues, strSettingName)) {
				return false;
			}

			delete SettingsValues[strSettingName];

			return true;
		});
	}

	ClearPlayer(strPlayerUniqueID, Options, Callback) {
		this.RunRequest(Options, Callback, () => this.PlayerValuesByUniqueID.delete(strPlayerUniqueID));
	}
}

module.exports = { MemorySettingsStorage };
```

The class is an example backend contract, not a cross-plugin transport. Isolated plugins must exchange serialized
data through [`plugins/bus`](plugins-bus.md) rather than sharing the storage object.

Its callback is outside the operation's `try` block, so a caller callback exception is not translated into a second error
completion. Blocking exceptions propagate to the caller; default-mode callback exceptions reject the model's scheduled
Promise, which the example does not return or handle. A production runtime needs a rejection/error boundary; this model
does not swallow callback exceptions or retry completion. A caught operation failure equal to `null` is wrapped in an
`Error` with `cause: null`, because `null` in the callback's error slot means success. Other thrown values are preserved.
This example has no persistence, transaction, close or native worker implementation.

## Errors And Lifecycle

- Invalid names, prefixes, dictionary options, section options, callbacks, duplicate child names and duplicate root
  names throw synchronously.
- Missing/malformed request pairs and invalid current player IDs/backends/methods throw before backend invocation.
  A backend's synchronous exception propagates unchanged; a custom backend may throw before or after invoking its
  callback. `PlayerSettingsValues` neither supplies an extra completion nor retracts one already delivered. Backend
  operation failures and their result sentinels follow that backend's contract; the facade does not normalize them.
- `SettingsDictionary.SetSetting(strSettingName, SettingsEntry)` rejects duck-typed entries; values must be actual classes from
  this SourceJS package context.
- A custom storage array or object missing any of the five required methods is rejected by `PlayerSettingsValues`
  construction. A values view borrows its backend: creating, clearing or discarding the view does not close it. The owner
  must wait for requests to complete before closing an owned storage; do not close shared `DEFAULT_STORAGE` casually.
- `GetUniqueIDFromPlayer()` calls native code only for numeric and player-object representations; string identities work
  without a connected player.
- A root registers during construction. Wrap partial setup when needed: if a later `Add*()` fails, call `ClearSettings()` and
  `Unregister()` before propagating the error. Attempt both, preserve every failure and retain ownership when cleanup
  fails, as in the controller above; a cleanup failure must not hide the original setup failure.
- `GetPlayerSettings()` returns a live registry iterator. `REGISTERED_PLAYER_SETTINGS`, `Items`, returned roots,
  and built-in backend `GetPlayerValues()` results are also live references. Custom result ownership follows the backend.

## Related Modules

- [`settings/menu`](settings-menu.md) renders registered roots and standalone settings.
- [`settings/types`](settings-types.md) documents typed setting values, options and storage reads.
- [`settings/storage`](settings-storage.md) documents the built-in SOCI-backed storage implementations.
- [`menus`](menus-objects.md) documents dictionary menu delivery and selection.
- [`plugins/bus`](plugins-bus.md) provides serialized communication between isolated plugins.
