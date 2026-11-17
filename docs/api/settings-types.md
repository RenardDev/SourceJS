# `require("settings/types")`

> Warning: this reference is intentionally detailed. Use the contents list to open only the API or workflow needed
> for the current task.

`settings/types` defines typed per-player settings on top of a caller-selected storage backend. Each setting owns a
construction-validated `Name`, a default value, display `Text`, optional `Validator`, and storage key derived from `ConVar`.
Player reads, writes, and deletions require `Options` and `Callback`; they return `undefined`, not the operation result.

Standalone settings can also be registered for discovery by [`settings/menu`](settings-menu.md) in the same module instance.
The registering plugin owns its entry and must unregister it before the plugin unloads.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Names, Keys, And Players](#names-keys-and-players)
- [Storage Contract](#storage-contract)
- [Request Options And Completion](#request-options-and-completion)
- [`SettingsType`](#settingstype)
- [Typed Numeric And Boolean Settings](#typed-numeric-and-boolean-settings)
- [String And Choice Settings](#string-and-choice-settings)
- [Registry Ownership](#registry-ownership)
- [Validation And Realtime State](#validation-and-realtime-state)
- [Errors And Lifecycle](#errors-and-lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	BooleanSetting,
	ChoiceSetting,
	FloatSetting,
	IntegerSetting,
	REGISTERED_SETTINGS,
	SettingsType,
	StringSetting,
	GetSetting,
	ListSettings,
	RegisterSetting,
	UnregisterSetting,
} = require("settings/types");
```

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `REGISTERED_SETTINGS` | `Map` | Live standalone `Name -> SettingsType` registry. |
| [`SettingsType`](#settingstype) | Class | Base setting with editable fields, storage, and optional validation. |
| `StringSetting` | Class | Strict string setting with a live `Options` map and fresh `Choices` arrays. |
| `IntegerSetting` | Class | Strict integer setting with inclusive bounds. |
| `FloatSetting` | Class | Finite-number setting with inclusive bounds. |
| `BooleanSetting` | Class | Strict JavaScript boolean setting. |
| `ChoiceSetting` | Class | `StringSetting` that requires at least one initial choice. |
| `RegisterSetting(SettingDefinition)` | Function | Registers one standalone setting and returns that setting object. |
| `UnregisterSetting(strSettingName)` | Function | Removes an exact registered name and returns whether it existed. |
| `GetSetting(strSettingName)` | Function | Returns the exact registered setting or `null`. |
| `ListSettings()` | Function | Returns a fresh array containing the current registered objects. |

## Names, Keys, And Players

A setting name must be a non-empty string made from ASCII letters, spaces, and underscores. Removing spaces and
underscores must leave at least one letter. The original spelling is retained in `Name`.

`ConVar` is computed every time it is read:

1. Split the current `Name` at runs of spaces and underscores.
2. Capitalize the first letter of each word, retain the remaining letter casing, and concatenate the words without separators.
3. Prepend the current `Prefix` without modifying it; use an empty or PascalCase prefix.

Consequently, `"Menu Theme"` and `"Menu_Theme"` produce the same `MenuTheme` key when their prefixes match. The
registry keys those settings by their exact names and can hold both, but a shared storage backend would make them
address the same value. Plugin-owned setting names should therefore also be unique after `ConVar` normalization.

The `PlayerReference` in `Get(PlayerReference, Options, Callback)`,
`Set(PlayerReference, SettingsValue, Options, Callback)`, and `Delete(PlayerReference, Options, Callback)` accepts:

- a non-empty network-ID string, used directly;
- a numeric client index, passed to the native player module for resolution;
- an object whose `Index` is a safe integer, also resolved through the native player module.

The native player module owns range, connection, and network-ID validation for numeric arguments. A string is not
checked against a specific Steam ID format.

## Storage Contract

The default backend is [`DEFAULT_STORAGE`](settings-storage.md#exports). A custom `SettingOptions.Storage` must be an
object other than an array. It must expose these callable methods; extra methods and fields are allowed:

| Method | Callback result on success |
| --- | --- |
| `GetSetting(strPlayerUniqueID, strSettingToken, DefaultValue, Options, Callback)` | Stored value, or the exact supplied `DefaultValue` when the key is absent. |
| `SetSetting(strPlayerUniqueID, strSettingToken, SettingsValue, Options, Callback)` | Storage write result; `SettingsStorage` returns a boolean. |
| `DeleteSetting(strPlayerUniqueID, strSettingToken, Options, Callback)` | Storage deletion result; `SettingsStorage` returns whether a value existed. |

Each method returns `undefined` and completes exactly once with `Callback(RequestError, Result)`. Use `null` for no
error; ignore `Result` on failure. `SettingsType.Get()` replaces a backend failure result with `null`; `Set()` and
`Delete()` pass the original callback to the backend and do not normalize failure results. Keep the explicit `DefaultValue` argument position
even when a caller wants the backend's normal default. `SettingsType.Get()` supplies an opaque missing-value sentinel;
a custom backend must return that sentinel unchanged on a miss, not replace it with `null`, coerce it, or serialize it.

## Request Options And Completion

`Options` and `Callback` are mandatory for every `Get`, `Set`, and `Delete`. `Options` must be a non-null, non-array
object. `Options.Blocking` may be omitted or explicitly `undefined`; otherwise it must be a boolean. Only `true`
requests blocking. For example, `{}` selects the normal mode, while `{ Blocking: true }` waits for that request
and still requires its callback.

The setting reads `Blocking` once and delegates a fresh `{ Blocking: bBlocking }` object containing the normalized boolean;
other option fields are not forwarded. Inherited properties and getters are accepted; the snapshot is not frozen.
It does not launch a worker itself, close the backend, or change its completion context. Native-backed persistence
follows the backend's request/threading contract; a cache-only read may complete inline even without `Blocking`.
Do not assume that every non-blocking callback is deferred.
The callback is where the result is available in either mode; a returned `undefined` does not mean the request failed.

[`SettingsStorage`](settings-storage.md#request-options-and-callbacks) serializes work per storage instance. It rejects
a blocking request behind pending work on that same instance rather than waiting on callbacks that need the game
thread. Use blocking only at deliberate startup/lifecycle points, not as a workaround for an outstanding request.

Malformed options, missing callbacks, invalid player references, and invalid write values can throw before a request
is accepted. Storage scheduling/lifecycle errors can also throw synchronously. Read/coercion/validation failures
during completion are passed to the callback; callback exceptions are not retried or turned into a second completion.
Only `null` denotes callback success: falsy errors such as `undefined`, `0`, `false`, or an empty string remain failures.
A caught `throw null` during value coercion/validation becomes an Error with `cause: null`, so it cannot be confused
with success. Exceptions thrown by the caller's callback are left unwrapped.

This local-memory backend demonstrates the callback contract for temporary match state or tests. It uses a Promise
microtask in normal mode and completes inline in blocking mode; it performs no network/database I/O and does not
demonstrate native worker threads. A real persistence backend must schedule its own I/O rather than put blocking I/O
inside this microtask:

```js
function CreateMemorySettingsStorage() {
	const mapSettingsValues = new Map();

	function CreateSettingsKey(strPlayerUniqueID, strSettingToken) {
		return JSON.stringify([strPlayerUniqueID, strSettingToken]);
	}

	function RunMemoryRequest(Operation, Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Memory settings requests require an Options object.");
		}

		const bBlocking = Options.Blocking;
		if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
			throw new TypeError("Memory settings Options.Blocking must be a boolean.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("Memory settings requests require a Callback function.");
		}

		const CompleteRequest = () => {
			let RequestError = null;
			let Result = null;

			try {
				Result = Operation();
			} catch (OperationError) {
				RequestError = (OperationError === null) ? new Error("Memory settings operation threw null.", { cause: OperationError }) : OperationError;
			}

			Callback(RequestError, Result);
		};

		if (bBlocking === true) {
			CompleteRequest();

		} else {
			Promise.resolve().then(CompleteRequest);
		}
	}

	return {
		MapSettingsValues: mapSettingsValues,
		DeleteSetting(strPlayerUniqueID, strSettingToken, Options, Callback) {
			const strSettingsKey = CreateSettingsKey(strPlayerUniqueID, strSettingToken);
			RunMemoryRequest(() => mapSettingsValues.delete(strSettingsKey), Options, Callback);
		},
		GetSetting(strPlayerUniqueID, strSettingToken, DefaultValue, Options, Callback) {
			const strSettingsKey = CreateSettingsKey(strPlayerUniqueID, strSettingToken);
			RunMemoryRequest(() => mapSettingsValues.has(strSettingsKey) ? mapSettingsValues.get(strSettingsKey) : DefaultValue, Options, Callback);
		},
		SetSetting(strPlayerUniqueID, strSettingToken, SettingsValue, Options, Callback) {
			const strSettingsKey = CreateSettingsKey(strPlayerUniqueID, strSettingToken);
			RunMemoryRequest(() => {
				mapSettingsValues.set(strSettingsKey, SettingsValue);

				return true;
			}, Options, Callback);
		},
	};
}

module.exports = { CreateMemorySettingsStorage };
```

The backend stores live values without copying them. Its public MapSettingsValues is in-memory state, not persistent data.
The callback runs outside the operation's catch: a caller exception is not delivered as an operation failure. In normal
mode it rejects the Promise microtask; host-level rejection reporting remains the application's responsibility.

`SettingsType` only calls those three methods. It does not call `Save()`, `Close()`, or another persistence method.
When `DEFAULT_STORAGE` or a database-backed custom storage is used, its owner must complete any required save at
deliberate lifecycle points, then close only its own backend after pending work has settled. Never clear or close a
shared backend merely because one setting is being removed.

## `SettingsType`

### Constructor

Constructor signature: `new SettingsType(strSettingName, DefaultValue = null, SettingOptions = {})`.

| Option | Default | Purpose |
| --- | --- | --- |
| `Text` | `null` | Optional display label. |
| `Description` | `""` | Longer display description. |
| `Prefix` | `""` | Exact string prepended by `ConVar`; use empty or PascalCase spelling. |
| `Storage` | `DEFAULT_STORAGE` | Backend receiving every player operation. |
| `Validator` | `null` | Additional predicate for the initial default, stored values, and writes. |

SettingOptions itself must be a non-null, non-array object. Each supported field is read using normal property access;
inherited fields and getters are accepted. A null/undefined field uses its default, while unknown fields are ignored.
Description/Prefix must resolve to strings, Text to a string or null, and Validator to a function or null.

The constructor calls a non-null validator with the initial default and rejects the setting when it returns a falsy value.
Validation is synchronous and uses truthiness; returned Promises are not awaited. An ordinary validator function is
called with the setting as its receiver. Validator exceptions during construction propagate directly to the caller.

### Fields And Properties

| Member | Behavior |
| --- | --- |
| `Name` | Read/write original name; the setter does not validate. Construction and registration validate it, as does computing ConVar. |
| `DefaultValue` | Read-only getter for the current `ValueDefaultValue` backing field. |
| `Text` | Editable display label or `null`. |
| `Description` | Editable description string. |
| `Prefix` | Read/write exact storage-key prefix; use empty or PascalCase spelling. |
| `Storage` | Read-only getter for the backend object; does not make the backend immutable. |
| `Validator` | Read-only getter for the predicate or `null`. |
| `ConVar` | Read-only getter recomputed from the current `Name` and `Prefix`. |

The constructor creates writable backing fields `ValueName`, `ValueDefaultValue`, `ValueText`, `ValueDescription`,
`ValuePrefix`, `ValueStorage`, and `ValueValidator`. Editing them bypasses constructor validation. A changed name is
checked when `ConVar` is computed; the `Name`, `Text`, `Description`, and `Prefix` setters themselves do not validate.
Do not assign to getter-only properties such as `DefaultValue`, `Storage`, or `Validator`. Changing the name or prefix
selects a different key; it does not rename, copy, or delete any existing stored value. There is no lowercase-key alias
or automatic migration of an older key.

### Methods

| Method | Behavior |
| --- | --- |
| `Coerce(SettingsValue)` | Returns `SettingsValue` unchanged in the base class. |
| `IsValid(SettingsValue)` | Runs the current validator, or returns `true` when none is set. |
| `GetDefaultValue()` | Coerces and returns the current default. |
| `Get(PlayerReference, Options, Callback)` | Completes with the coerced stored value; missing or validator-rejected values use the current default. Coercion/validator exceptions complete with an error. |
| `Set(PlayerReference, SettingsValue, Options, Callback)` | Coerces and validates before scheduling, then forwards the storage write result to the callback. |
| `Delete(PlayerReference, Options, Callback)` | Removes this player's current `ConVar` key and forwards the storage deletion result to the callback. |

`Coerce`, `IsValid`, and `GetDefaultValue` are synchronous and do not touch storage. The three player operations return
`undefined` and require the request pair described above. `GetDefaultValue()` coerces the current default but does not
rerun its validator. A base setting can store exact `bigint` values when its backend supports them; integer and float
settings instead enforce their documented JavaScript `number` contracts.

This module exercises every base operation. Defining the functions performs no storage work. `InspectRetrySetting`
returns metadata synchronously; `UpdateRetryCount` and `ResetRetryCount` require `Options` and `Callback`. The update
reads, writes, and reads again in sequence, then completes with its result record. It is not a transaction: a later
failure does not undo a successful write. Invalid retry values throw before any storage operation.

```js
const { SettingsType } = require("settings/types");

function CreateRetrySetting(SettingsStorage) {
	return new SettingsType("Retry Count", 0, {
		Description: "Number of retries used in the current match",
		Prefix: "Match",
		Storage: SettingsStorage,
		Text: "Retry count",
		Validator: (unRetryCount) => Number.isSafeInteger(unRetryCount) && (unRetryCount >= 0),
	});
}

function InspectRetrySetting(RetrySetting) {
	const unCoercedRetryCount = RetrySetting.Coerce(2);

	return {
		CoercedRetryCount: unCoercedRetryCount,
		ConVar: RetrySetting.ConVar,
		DefaultRetryCount: RetrySetting.GetDefaultValue(),
		Description: RetrySetting.Description,
		HasValidator: typeof RetrySetting.Validator === "function",
		Name: RetrySetting.Name,
		Prefix: RetrySetting.Prefix,
		RetryCountIsValid: RetrySetting.IsValid(unCoercedRetryCount),
		Storage: RetrySetting.Storage,
		Text: RetrySetting.Text,
	};
}

function RunRetryRequest(StartRequest, Callback) {
	let bDelivered = false;

	try {
		StartRequest((RequestError, Result) => {
			bDelivered = true;
			Callback(RequestError, Result);
		});
	} catch (RequestError) {
		if (bDelivered) {
			throw RequestError;
		}

		const CompletionError = (RequestError === null) ? new Error("Retry request threw null.", { cause: RequestError }) : RequestError;
		Callback(CompletionError, null);
	}
}

function UpdateRetryCount(RetrySetting, PlayerReference, unRetryCount, Options, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("UpdateRetryCount requires a Callback function.");
	}

	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("UpdateRetryCount requires an Options object.");
	}

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("UpdateRetryCount Options.Blocking must be a boolean.");
	}

	const RequestOptions = { Blocking: bBlocking === true };
	const unCoercedRetryCount = RetrySetting.Coerce(unRetryCount);
	if (!RetrySetting.IsValid(unCoercedRetryCount)) {
		throw new RangeError("Retry count must be a non-negative safe integer.");
	}

	RetrySetting.Get(PlayerReference, RequestOptions, (ReadError, unPreviousRetryCount) => {
		if (ReadError !== null) {
			Callback(ReadError, null);
			return;
		}

		RunRetryRequest((CompleteSet) => RetrySetting.Set(PlayerReference, unCoercedRetryCount, RequestOptions, CompleteSet), (WriteError, bRetryCountWasStored) => {
			if (WriteError !== null) {
				Callback(WriteError, null);
				return;
			}

			RunRetryRequest((CompleteGet) => RetrySetting.Get(PlayerReference, RequestOptions, CompleteGet), (ResultError, unCurrentRetryCount) => {
				if (ResultError !== null) {
					Callback(ResultError, null);
					return;
				}

				Callback(null, { CurrentRetryCount: unCurrentRetryCount, PreviousRetryCount: unPreviousRetryCount, RetryCountWasStored: bRetryCountWasStored });
			});
		});
	});
}

function ResetRetryCount(RetrySetting, PlayerReference, Options, Callback) {
	RetrySetting.Delete(PlayerReference, Options, Callback);
}

module.exports = {
	CreateRetrySetting,
	InspectRetrySetting,
	ResetRetryCount,
	UpdateRetryCount,
};
```

The base class intentionally imposes no value type. In this workflow the validator defines the complete value policy.

## Typed Numeric And Boolean Settings

### Constructors

- `new BooleanSetting(strSettingName, bDefaultValue = false, SettingOptions = {})`
- `new IntegerSetting(strSettingName, nDefaultValue = 0, SettingOptions = {})`
- `new FloatSetting(strSettingName, dblDefaultValue = 0, SettingOptions = {})`

`BooleanSetting` accepts only JavaScript booleans. It rejects strings such as `"true"` and numbers such as `1`.

`IntegerSetting` accepts JavaScript `number` values satisfying `Number.isInteger()`, not `bigint` values. This check
does not guarantee exact 64-bit representation; use a base setting with a bigint-capable backend for exact integers
outside JavaScript's safe-integer range. `FloatSetting` accepts any finite JavaScript number, including integers.
Both numeric classes expose getter-only `Minimum` and `Maximum` backed by writable `ValueMinimum` and `ValueMaximum`:

- omitted, undefined, or null constructor bounds become unbounded;
- bounds are inclusive;
- constructor bounds must be numbers of the class's type;
- when both initial bounds are present, `Minimum` must be less than `Maximum`;
- the initial default must fall inside both bounds.

Numeric constructor bounds must also be finite. Numeric/string constructors may call the validator again while checking
their bounds or choices; do not rely on derived fields during the initial base validation or mutate the setting policy.

The following workflow validates all three candidate values before writing any preference and provides matching
cleanup. `UpdateCombatSettings` and `ClearCombatSettings` require `Options` and `Callback`, return `undefined`, and
complete with their result records. The helper captures the blocking mode once and sequences requests; it does not
make the writes/deletions transactional. Each code block is standalone, so its sequencing helper remains private:

```js
const {
	BooleanSetting,
	FloatSetting,
	IntegerSetting,
} = require("settings/types");

function CreateCombatSettings(SettingsStorage) {
	return {
		DamageNumbers: new BooleanSetting("Damage Numbers", true, {
			Prefix: "Combat",
			Storage: SettingsStorage,
			Text: "Show damage numbers",
		}),
		HUDScale: new FloatSetting("HUD Scale", 1, {
			Maximum: 2,
			Minimum: 0.5,
			Prefix: "Interface",
			Storage: SettingsStorage,
		}),
		HitSoundVolume: new IntegerSetting("Hit Sound Volume", 80, {
			Maximum: 100,
			Minimum: 0,
			Prefix: "Combat",
			Storage: SettingsStorage,
		}),
	};
}

function RunCombatSettingsRequests(vecRequests, Options, Callback, Result) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Settings workflows require an Options object.");
	}

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("Settings workflow Options.Blocking must be a boolean.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Settings workflows require a Callback function.");
	}

	const RequestOptions = { Blocking: bBlocking === true };
	let unRequestIndex = 0;

	function StartNextRequest() {
		if (unRequestIndex === vecRequests.length) {
			Callback(null, Result);
			return;
		}

		const Request = vecRequests[unRequestIndex];
		unRequestIndex += 1;
		let bDelivered = false;

		try {
			Request.Setting[Request.MethodName](...Request.Arguments, RequestOptions, (RequestError, RequestResult) => {
				bDelivered = true;

				if (RequestError !== null) {
					Callback(RequestError, null);
					return;
				}

				Request.Result[Request.PropertyName] = RequestResult;
				StartNextRequest();
			});
		} catch (RequestError) {
			if (bDelivered) {
				throw RequestError;
			}

			const CompletionError = (RequestError === null) ? new Error("Combat settings request threw null.", { cause: RequestError }) : RequestError;
			Callback(CompletionError, null);
		}
	}

	StartNextRequest();
}

function UpdateCombatSettings(CombatSettings, PlayerReference, CombatSettingsValues, Options, Callback) {
	const bDamageNumbersEnabled = CombatSettings.DamageNumbers.Coerce(CombatSettingsValues.DamageNumbersEnabled);
	const dblHUDScale = CombatSettings.HUDScale.Coerce(CombatSettingsValues.HUDScale);
	const unHitSoundVolume = CombatSettings.HitSoundVolume.Coerce(CombatSettingsValues.HitSoundVolume);
	if (!CombatSettings.DamageNumbers.IsValid(bDamageNumbersEnabled) || !CombatSettings.HUDScale.IsValid(dblHUDScale) || !CombatSettings.HitSoundVolume.IsValid(unHitSoundVolume)) {
		throw new RangeError("One or more combat settings are outside their configured bounds.");
	}

	const SettingWriteResults = {};
	const Result = { SettingWriteResults };
	const vecRequests = [
		{ Setting: CombatSettings.DamageNumbers, MethodName: "Set", Arguments: [PlayerReference, bDamageNumbersEnabled], Result: SettingWriteResults, PropertyName: "DamageNumbersWasStored" },
		{ Setting: CombatSettings.HitSoundVolume, MethodName: "Set", Arguments: [PlayerReference, unHitSoundVolume], Result: SettingWriteResults, PropertyName: "HitSoundVolumeWasStored" },
		{ Setting: CombatSettings.HUDScale, MethodName: "Set", Arguments: [PlayerReference, dblHUDScale], Result: SettingWriteResults, PropertyName: "HUDScaleWasStored" },
		{ Setting: CombatSettings.DamageNumbers, MethodName: "Get", Arguments: [PlayerReference], Result, PropertyName: "DamageNumbersEnabled" },
		{ Setting: CombatSettings.HitSoundVolume, MethodName: "Get", Arguments: [PlayerReference], Result, PropertyName: "HitSoundVolume" },
		{ Setting: CombatSettings.HUDScale, MethodName: "Get", Arguments: [PlayerReference], Result, PropertyName: "HUDScale" },
	];
	RunCombatSettingsRequests(vecRequests, Options, Callback, Result);
}

function ClearCombatSettings(CombatSettings, PlayerReference, Options, Callback) {
	const Result = {};
	const vecRequests = [
		{ Setting: CombatSettings.DamageNumbers, MethodName: "Delete", Arguments: [PlayerReference], Result, PropertyName: "DamageNumbersWasDeleted" },
		{ Setting: CombatSettings.HitSoundVolume, MethodName: "Delete", Arguments: [PlayerReference], Result, PropertyName: "HitSoundVolumeWasDeleted" },
		{ Setting: CombatSettings.HUDScale, MethodName: "Delete", Arguments: [PlayerReference], Result, PropertyName: "HUDScaleWasDeleted" },
	];
	RunCombatSettingsRequests(vecRequests, Options, Callback, Result);
}

module.exports = {
	ClearCombatSettings,
	CreateCombatSettings,
	UpdateCombatSettings,
};
```

Values of the wrong JavaScript type make direct Coerce calls throw. Numeric IsValid also coerces before checking bounds;
a correctly typed value outside a numeric bound returns false, and Set then throws before scheduling.
BooleanSetting inherits the base validator-only IsValid: without a Validator it returns true even for a non-boolean.
Use Coerce before a standalone boolean validity check; Get/Set already perform that coercion.
A stored value outside the current bounds falls back through `Get()` to the current default; a coercion exception
instead completes that read with an error.

## String And Choice Settings

### Constructors

- `new StringSetting(strSettingName, strDefaultValue = "", SettingOptions = {})`
- `new ChoiceSetting(strSettingName, strDefaultValue, SettingOptions = {})`

`StringSetting` accepts only strings. Its optional `SettingOptions.Choices` array is added in order during construction.
Missing/undefined Choices means an empty initial map; null and non-arrays are invalid. Every option name follows the
same letter/space/underscore validation as a setting name, remains case-sensitive, and must be unique within that map.
With no choices, any string accepted by the optional validator is valid.

Its synchronous overrides are `Coerce(strSettingsValue)` and `IsValid(strSettingsValue)`; both reject non-string values.

`ChoiceSetting` uses the same implementation but requires a non-empty initial `Choices` array. Both classes require
their initial default to be one of the configured choices when `Choices` exist.

### Additional Members

| Member | Behavior |
| --- | --- |
| `Options` | Getter-only property returning the live `ValueOptions` map from exact option name to `{ Name, Text, Value }`. |
| `Choices` | Fresh ordered array of current option names. |
| `AddOption(strSettingOptionName, strSettingOptionText = null)` | Validates and returns the newly stored live `{ Name, Text, Value }` record; duplicate names throw. Null Text defaults to Name; otherwise Text must be a string. Name and Value both retain the exact option name. |
| `RemoveOption(strSettingOptionName)` | Removes an exact existing name and returns `true`; missing names throw. |

These option/metadata operations are synchronous and do not perform storage I/O. `Setting.Options` is the choices
map, not the request `Options` object. The update/cleanup helpers below require the request pair and complete with
their result records through the callback, not through their direct return. Choice validation happens before writing;
later storage errors stop the sequence but do not undo previous writes or deletions.

```js
const {
	ChoiceSetting,
	StringSetting,
} = require("settings/types");

function CreateInterfaceSettings(SettingsStorage) {
	return {
		ChatColor: new StringSetting("Chat Color", "green", {
			Choices: ["green", "blue"],
			Prefix: "Chat",
			Storage: SettingsStorage,
		}),
		MenuTheme: new ChoiceSetting("Menu Theme", "dark", {
			Choices: ["dark", "light"],
			Prefix: "Interface",
			Storage: SettingsStorage,
		}),
	};
}

function AddChatColor(InterfaceSettings, strSettingOptionName, strSettingOptionText = null) {
	return InterfaceSettings.ChatColor.AddOption(strSettingOptionName, strSettingOptionText);
}

function RemoveChatColor(InterfaceSettings, strSettingOptionName) {
	return InterfaceSettings.ChatColor.RemoveOption(strSettingOptionName);
}

function InspectInterfaceChoices(InterfaceSettings) {
	const vecChatColorOptions = [];
	for (const ChatColorOption of InterfaceSettings.ChatColor.Options.values()) {
		vecChatColorOptions.push(ChatColorOption);
	}

	return {
		ChatColorChoices: InterfaceSettings.ChatColor.Choices,
		ChatColorOptions: vecChatColorOptions,
		MenuThemeChoices: InterfaceSettings.MenuTheme.Choices,
	};
}

function RunInterfaceSettingsRequests(vecRequests, Options, Callback, Result) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Settings workflows require an Options object.");
	}

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("Settings workflow Options.Blocking must be a boolean.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Settings workflows require a Callback function.");
	}

	const RequestOptions = { Blocking: bBlocking === true };
	let unRequestIndex = 0;

	function StartNextRequest() {
		if (unRequestIndex === vecRequests.length) {
			Callback(null, Result);
			return;
		}

		const Request = vecRequests[unRequestIndex];
		unRequestIndex += 1;
		let bDelivered = false;

		try {
			Request.Setting[Request.MethodName](...Request.Arguments, RequestOptions, (RequestError, RequestResult) => {
				bDelivered = true;

				if (RequestError !== null) {
					Callback(RequestError, null);
					return;
				}

				Request.Result[Request.PropertyName] = RequestResult;
				StartNextRequest();
			});
		} catch (RequestError) {
			if (bDelivered) {
				throw RequestError;
			}

			const CompletionError = (RequestError === null) ? new Error("Interface settings request threw null.", { cause: RequestError }) : RequestError;
			Callback(CompletionError, null);
		}
	}

	StartNextRequest();
}

function UpdateInterfaceSettings(InterfaceSettings, PlayerReference, InterfaceSettingsValues, Options, Callback) {
	if (!InterfaceSettings.ChatColor.IsValid(InterfaceSettingsValues.ChatColor) || !InterfaceSettings.MenuTheme.IsValid(InterfaceSettingsValues.MenuTheme)) {
		throw new RangeError("An interface setting is not one of the configured choices.");
	}

	const SettingWriteResults = {};
	const Result = { SettingWriteResults };
	const vecRequests = [
		{ Setting: InterfaceSettings.ChatColor, MethodName: "Set", Arguments: [PlayerReference, InterfaceSettingsValues.ChatColor], Result: SettingWriteResults, PropertyName: "ChatColorWasStored" },
		{ Setting: InterfaceSettings.MenuTheme, MethodName: "Set", Arguments: [PlayerReference, InterfaceSettingsValues.MenuTheme], Result: SettingWriteResults, PropertyName: "MenuThemeWasStored" },
		{ Setting: InterfaceSettings.ChatColor, MethodName: "Get", Arguments: [PlayerReference], Result, PropertyName: "ChatColor" },
		{ Setting: InterfaceSettings.MenuTheme, MethodName: "Get", Arguments: [PlayerReference], Result, PropertyName: "MenuTheme" },
	];
	RunInterfaceSettingsRequests(vecRequests, Options, Callback, Result);
}

function ClearInterfaceSettings(InterfaceSettings, PlayerReference, Options, Callback) {
	const Result = {};
	const vecRequests = [
		{ Setting: InterfaceSettings.ChatColor, MethodName: "Delete", Arguments: [PlayerReference], Result, PropertyName: "ChatColorWasDeleted" },
		{ Setting: InterfaceSettings.MenuTheme, MethodName: "Delete", Arguments: [PlayerReference], Result, PropertyName: "MenuThemeWasDeleted" },
	];
	RunInterfaceSettingsRequests(vecRequests, Options, Callback, Result);
}

module.exports = {
	AddChatColor,
	ClearInterfaceSettings,
	CreateInterfaceSettings,
	InspectInterfaceChoices,
	RemoveChatColor,
	UpdateInterfaceSettings,
};
```

`Options` is deliberately live. Direct `Map` edits bypass `AddOption()` validation and can install arbitrary records.
Removing the current default choice or editing `ValueDefaultValue` can make `GetDefaultValue()` return, and a
missing-value `Get()` complete with, a value that `IsValid()` rejects. Prefer the methods and keep the current default
among the choices. When the options map becomes empty, `StringSetting` and `ChoiceSetting` both accept any string
that passes the current validator; only the `ChoiceSetting` constructor requires a non-empty initial choices array.

## Registry Ownership

`RegisterSetting(SettingDefinition)` accepts only a `SettingsType` instance, validates and captures its current Name
once, and rejects an exact duplicate name. An invalid name after construction cannot create an unreachable registry key.
`REGISTERED_SETTINGS` is the module instance's live map; isolated plugin contexts do not share it. `GetSetting(strSettingName)` and `UnregisterSetting(strSettingName)` validate their
arguments and perform exact, case-sensitive lookups. `ListSettings()` returns a new array on every call, but the setting objects
inside each array remain live.

Direct registry-map edits bypass these checks. Use the public helpers and retain both the captured registered name and
the setting object; before unregistering, check that the current entry is still yours.

Create the registry entry during plugin load and retain the returned setting object for plugin unload:

```js
const {
	IntegerSetting,
	REGISTERED_SETTINGS,
	GetSetting,
	ListSettings,
	RegisterSetting,
	UnregisterSetting,
} = require("settings/types");

function RegisterRoundLimit(SettingsStorage, strRoundLimitSettingName = "Round Limit") {
	const RoundLimitSetting = RegisterSetting(new IntegerSetting(strRoundLimitSettingName, 5, {
		Maximum: 20,
		Minimum: 1,
		Prefix: "Match",
		Storage: SettingsStorage,
	}));
	const strRegisteredSettingName = RoundLimitSetting.Name;

	return {
		RoundLimitSetting,
		InspectRegistration() {
			const vecFirstSettingsList = ListSettings();
			const vecSecondSettingsList = ListSettings();

			return {
				DirectRegisteredSetting: REGISTERED_SETTINGS.get(strRegisteredSettingName),
				LookedUpSetting: GetSetting(strRegisteredSettingName),
				RoundLimitIsListed: vecFirstSettingsList.includes(RoundLimitSetting),
				SettingsListsAreDistinct: vecFirstSettingsList !== vecSecondSettingsList,
			};
		},
		UnregisterRoundLimit() {
			if (GetSetting(strRegisteredSettingName) !== RoundLimitSetting) {
				return false;
			}

			return UnregisterSetting(strRegisteredSettingName);
		},
	};
}

module.exports = { RegisterRoundLimit };
```

Do not unregister an entry owned by another component. Registration does not clone a setting. Changing the registered
object immediately changes what `GetSetting()`, `ListSettings()`, `REGISTERED_SETTINGS`, and settings menus observe.
Changing `Name` does not re-key the registry: retain the original registered name for lookup/removal, as above.
Registration, discovery, and removal are synchronous; they do not need request `Options` or `Callback`.

## Validation And Realtime State

Constructor validation covers the initial state only:

- `SettingsType` validates option types, storage methods, and the initial validator result.
- Typed subclasses validate the initial default and their constructor-specific choices or bounds.
- `StringSetting` builds its initial options through `AddOption()`.
- `ChoiceSetting` requires at least one initial choice.

Backing fields and maps remain writable. `ConVar`, `GetDefaultValue()`, `IsValid()`, and storage operations observe their
current values in real time. Assignments through the `Name`, `Text`, `Description`, or `Prefix` setters, edits to
`ValueValidator`, `ValueDefaultValue`, `ValueMinimum`, `ValueMaximum`, or `ValueStorage`, and direct map edits do not
rerun constructor validation. Their corresponding getter-only properties are not assignment targets. Plugin code
owns the resulting invariants; do not change a setting's backend or value policy while its requests are pending.

In particular, `GetDefaultValue()` coerces the current default but does not call `IsValid()`. If a stored value has the
correct type but fails the current validator, bounds, or choices, `Get()` completes with that coerced current default
instead. A stored value of the wrong JavaScript type completes with a coercion error instead of silently falling back.

## Errors And Lifecycle

Construction and synchronous validation/metadata operations can throw native JavaScript errors:

- `TypeError` for malformed names, option objects, storage objects, validators, default types, value types, choices,
  and registration objects;
- `RangeError` for non-increasing numeric constructor bounds or an initial numeric default outside its bounds;
- `Error` for duplicate option names, missing option removals, and duplicate registry names.

The player operations require `Options` and `Callback` and return `undefined`. Invalid arguments/write values and
backend scheduling errors may throw synchronously; backend completion errors reach the callback. `Get()` supplies
`null` as its failure result. `Set()` and `Delete()` forward the original callback to the backend, preserving its result
arguments on success and failure. `Get()` interprets a successful
backend result as missing, valid, or validator-rejected; coercion/default/validator exceptions during this processing
also complete the callback with the error and `null`. A user callback exception is never retried as another completion.

The type layer does not retry, save, close, cancel, or roll back a backend operation. Multi-setting workflows are not
transactions: the first operation error stops the remaining steps but can leave earlier writes/deletions applied.

A plugin should release its state in this order:

1. Stop submitting new work and let pending requests settle while their callback state and backend remain alive.
2. Unregister every standalone setting it owns using the original registered name.
3. Delete only player values the plugin intentionally wants to discard and wait for their callbacks.
4. Complete any required `Save()` and then `Close()` only on backends owned exclusively by that plugin, using the
   backend's required `Options` and `Callback` for each operation. Release its state only after completion.

There are no compatibility aliases for shortened setting names, lowercase method/property spellings, or unrelated error
classes. The module also exposes no default aggregate or snapshot serializer.

## Related Modules

- [`settings/storage`](settings-storage.md) implements the mandatory SOCI-backed default and custom namespaces.
- [`settings/menu`](settings-menu.md) renders standalone registered settings.
- [`settings/player`](settings-player.md) groups settings into per-player dictionaries.
- [`players`](players.md) documents player index and network-ID resolution.
