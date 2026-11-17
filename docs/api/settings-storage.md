# `require("settings/storage")`

> AI processing note: SOCI persistence uses mandatory Options + Callback; collections read loaded caches only.
> Keep SQL state, callback completion, top-level/nested cache identity and connection ownership distinct.

`settings/storage` persists namespaced per-player values through the mandatory native [`soci`](soci.md) module.
Instances share two fixed SQL tables, but each instance owns its namespace rows, live cache and lazily opened SOCI
session handle.

The default configuration uses SQLite at `<settings root>/users.sqlite3`. SOCI's MySQL backend supports
MySQL/MariaDB through `Backend: "mysql"` and a native SOCI connection string when included in the selected native build.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Request Options And Callbacks](#request-options-and-callbacks)
- [Stored Values](#stored-values)
- [SettingsStorage](#settingsstorage)
- [Inspect Configuration](#inspect-configuration)
- [Store Every Supported Kind](#store-every-supported-kind)
- [Edit The Live Cache](#edit-the-live-cache)
- [Use Collection Operations](#use-collection-operations)
- [Use The Low-Level SOCI Lifecycle](#use-the-low-level-soci-lifecycle)
- [Handle Transaction Failure](#handle-transaction-failure)
- [PlayerSettingsView](#playersettingsview)
- [Errors And Lifecycle](#errors-and-lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	DEFAULT_STORAGE,
	PlayerSettingsView,
	ROOT,
	SettingsStorage,
	CreateStorage,
} = require("settings/storage");
```

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `ROOT` | `string` | Live editable settings root backed directly by `require("settings").Root`. |
| `DEFAULT_STORAGE` | `SettingsStorage` | Lazily opened `"players"` instance created from static defaults when this module loads. |
| [`SettingsStorage`](#settingsstorage) | Class | Namespaced SQL persistence and stable top-level live cache. |
| [`PlayerSettingsView`](#playersettingsview) | Class | One-player facade over a real `SettingsStorage`. |
| `CreateStorage(strSettingsNamespace?, StorageOptions?)` | `SettingsStorage` | Constructs a new independent instance. |

## Request Options And Callbacks

Every persistence/load operation requires a final `Options, Callback` pair, even when data is already cached.
Use `{}` for normal asynchronous I/O or `{ Blocking: true }` for startup work that must complete before returning.
`Blocking`, when present, must be boolean. Each submission captures that flag in a new request object; unrelated
options are not forwarded. Ordinary property lookup includes inherited values and getters; `undefined` means false,
and `null` is invalid. The facade does not freeze caller objects or prevent option-getter side effects.

Request methods return `undefined`; their result is delivered once through `Callback(RequestError, Result)`.
Success has `RequestError === null`; on failure do not read `Result`. Invalid public inputs throw before scheduling.
Database, decode and live-record update errors are delivered to the callback. User callback exceptions propagate
after queue bookkeeping, without invoking that callback a second time.

Caught request/validation exceptions equal to `null` are wrapped in an `Error` with `cause: null`, so they cannot become
successful completions. Other thrown values retain their identity. An explicit `Callback(null, Result)` still means
success. Exceptions thrown by the caller's completion callback are not normalized; the native callback boundary may
log them after they leave the JavaScript facade.

A storage instance serializes its queued operations to keep its session's transactions ordered. Other instances
have independent queues. A Blocking operation is rejected if that same instance already has an active or queued
operation: waiting for its deferred game-thread callback would deadlock. Queue normal operations instead, or start
Blocking work after completion. Completion callbacks can submit subsequent work.
Independent queues do not coordinate separate instances writing the same namespace; callers must coordinate those
writers and their separate caches.

Native SOCI runs requests off the game thread and delivers completion on the game thread; Blocking intentionally
waits there. Cached reads may complete inline even without Blocking. Collection methods perform no hidden I/O.
Direct edits to live records while an operation is in flight require application coordination; the queue cannot
serialize arbitrary object mutations.

The longer examples below use a local `Wait` adapter so `await` keeps each sequence readable. This is application-level
Promise adaptation, not a Promise-returning storage API: every actual request still supplies Options and a callback.
Pass `{}` as the examples' Options argument for nonblocking I/O; observe their returned Promise and its rejection.
Request Options are separate from constructor StorageOptions, which configure the backend/path/connection string.

## Stored Values

`SetSetting()` and `InsertValue()` accept exactly these JavaScript value kinds:

| JavaScript value | SQL representation |
| --- | --- |
| `null` | Kind `null`; text and number columns null. |
| `boolean` | Kind `boolean`; text `"0"` or `"1"`. |
| String, including `""` | Kind `string`; exact text. |
| Finite `Number` | Kind `number`; double-precision numeric column. |
| `BigInt` | Kind `bigint`; decimal text. |

Objects, arrays, symbols, functions, `NaN` and infinities throw. Reload validates required columns, kinds, booleans,
numbers and BigInt text; it does not fabricate malformed database values.

Compatibility note: these Kind tokens and the fixed SQL table/column names are the existing persisted database format,
not the memory module's native type-discriminator strings. User-supplied setting names and player IDs are retained
exactly; style changes do not rename stored data.

## SettingsStorage

### Static Defaults And Constructor

`SettingsStorage.Options` is a live mutable defaults object:

```json
{
  "Backend": "sqlite3",
  "ConnectionString": null,
  "DatabasePath": null
}
```

`new SettingsStorage(strSettingsNamespace = "players", StorageOptions = {})` shallow-copies current static defaults and
then the supplied storage options. Existing instances do not follow later static-object edits.

Static defaults and supplied `StorageOptions` must be non-array objects. Own enumerable string and symbol properties are copied by value into writable
data properties; getters execute once per copied property, inherited and non-enumerable properties are ignored.
Caller properties override defaults even when their value is `undefined`: that is accepted as a default database-path
request, but an undefined Backend or ConnectionString is invalid. Unknown properties remain in the instance's Options
record without changing the selected connection behavior.

| Option | Default | Purpose |
| --- | --- | --- |
| `Backend` | `"sqlite3"` | SOCI backend; `null` calls `soci.Connect(strConnectionString, Options, Callback)` without an explicit backend. |
| `DatabasePath` | `${ROOT}/users.sqlite3` | Physical path used only to derive the default connection string. |
| `ConnectionString` | `dbname=<DatabasePath>` | Complete native SOCI connection string. |

Namespaces accept ASCII letters, digits, dots, underscores and hyphens. Namespace, player identities and setting names
are SQL parameters; table names are fixed by SourceJS.

### Fields

These are read-only accessors; the returned Options and Data records remain mutable. Constructor/setup Value* fields
and the load/transaction helpers are implementation state, not a second configuration API.

| Field | Purpose |
| --- | --- |
| `Namespace` | Validated SQL namespace. |
| `Options` | Per-instance shallow option copy. |
| `Path` | Effective database path captured during construction. |
| `Backend` | Effective backend string or `null`. |
| `ConnectionString` | Effective connection string captured during construction. |
| `Handle` | Current positive numeric SOCI handle or `null`. |
| `Loaded` | Loaded-state flag. |
| `Data` | Live null-prototype top-level cache record; methods preserve its identity. |

Changing `Options` later does not recompute `Path`, `Backend` or `ConnectionString`; these values are captured during
construction.

### Connection And Transaction Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `Open(Options, Callback)` | Numeric handle | Reuses/reconnects a handle or ensures ROOT, connects and creates schema. |
| `CreateSchema(Options, Callback)` | `true` | Executes both fixed CREATE statements on the already opened Handle. |
| `RunTransaction(TransactionCallback, Options, Callback)` | Work result | Opens, begins, waits for work completion, then commits or rolls back. |
| `EnsureLoaded(Options, Callback)` | Live Data | Loads once if Loaded is false. |
| `EnsurePlayer(hSOCIHandle, strPlayerUniqueID, Options, Callback)` | `true` | Inserts a missing player row through the borrowed session; no cache update. |
| `InsertValue(hSOCIHandle, strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback)` | `bigint` affected rows | Encodes and inserts one SQL value row; no cache update. |
| `Close(Options, Callback)` | `boolean` | Closes the handle and marks cache unloaded; false when already closed. |

The Result columns in request tables describe the callback result, never a direct return value; the explicitly marked
GetSettingsForPlayer constructor-like operation and the collection methods are synchronous exceptions.

`RunTransaction()` invokes `TransactionCallback(hSOCIHandle, RequestOptions, CompleteTransaction)`.
Call `CompleteTransaction(TransactionError, Result)` exactly once: null commits and delivers Result after commit;
an error rolls back and delivers that error. A thrown work error is also rolled back. Return values/Promises from
TransactionCallback are not observed and do not finish the transaction.

Only the first work completion is honored. A work exception before that completion triggers rollback, including
`throw null` after normalization; an exception thrown after completion does not retract already submitted commit work.
Work must not complete first and then throw or continue using the borrowed session asynchronously.

Use the borrowed handle, supplied RequestOptions, and native SOCI or the explicit EnsurePlayer/InsertValue helpers
inside transaction work. Do not call queued storage operations there and wait for their completion: they are behind
the current transaction. Chain each borrowed-handle operation's callback before starting the next one.
Those helpers bypass the instance queue and do not own/close the supplied handle; outside transaction work the
caller must prevent overlap with other session users.

If rollback fails, the completion error is an AggregateError with the operation error first and rollback error second.
Close the unsafe session before reusing it; schema and borrowed helpers also reject that storage's failed session.

### Cache And Persistence Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `Reload(Options, Callback)` | Live Data | Rebuilds from SQL, preserving top-level Data identity. |
| `Save(Options, Callback)` | `true` | Rewrites this namespace from a cache snapshot in one transaction. |
| `OnLevelShutdown(Options, Callback)` | `true` | Calls Save; not automatically registered as a listener. |
| `GetPlayerValues(strPlayerUniqueID, Options, Callback)` | Live record | Ensures the cached player and SQL row; delivers a null-prototype nested record. |
| `GetSettingsForPlayer(strPlayerUniqueID)` | PlayerSettingsView (direct) | Constructs a view without loading or creating the player. |
| `HasPlayer(strPlayerUniqueID, Options, Callback)` | `boolean` | Tests loaded cache membership. |
| `GetSetting(strPlayerUniqueID, strSettingName, DefaultValue, Options, Callback)` | Stored value or default | Reads the live nested record. |
| `SetSetting(strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback)` | `true` | Commits SQL and live-cache replacement transactionally. |
| `DeleteSetting(strPlayerUniqueID, strSettingName, Options, Callback)` | `boolean` | Deletes the SQL row and live value; false when the setting is absent. |
| `ClearPlayer(strPlayerUniqueID, Options, Callback)` | `true` | Deletes one player's rows and cache entry, even if absent. |
| `ClearSettings(Options, Callback)` | `true` | Deletes all namespace rows and empties stable Data. |
| `GetAllSettings(Options, Callback)` | Live Data | Ensures loading and delivers the exact top-level cache object. |

GetSetting's DefaultValue slot precedes the mandatory pair: pass `null` or `undefined` there to use the default null.
It is not an options-overload slot. Direct mutation through Data or a delivered player record changes memory only;
call `Save(Options, Callback)` explicitly. No listener automatically invokes OnLevelShutdown.

Editable cache records must remain null-prototype objects with enumerable, configurable, writable own data properties.
Save and record replacements reject symbol keys, accessors and incompatible descriptors, even when a cache lookup succeeds.

### Collection Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `Keys()` | `string[]` | Fresh player-ID array. |
| `Values()` | `PlayerSettingsView[]` | Fresh views for current IDs. |
| `Entries()` | Entry array | Fresh `[strPlayerUniqueID, PlayerSettingsView]` pairs. |
| `ForEach(SettingsCallback, CallbackReceiver?)` | `undefined` | Visits every current player view. |
| `[Symbol.iterator]()` | Iterator | Iterator over a fresh entries array. |

Collections require Loaded to be true; call `EnsureLoaded(Options, Callback)` first. Otherwise they throw instead of
loading synchronously. They visit a snapshot of current entries and do not ensure missing player rows.

`ForEach()` invokes `SettingsCallback(PlayerView, strPlayerUniqueID, Storage)` with CallbackReceiver as `this` through
`Reflect.apply()`. `GetCachedSettings()` and `GetCachedPlayerValues(strPlayerUniqueID)` likewise read loaded cache only;
the latter returns null for an absent player. Load/transaction helpers below the accessors are implementation details.

## Inspect Configuration

Constructors do not connect. This helper compares default, SQLite and MariaDB/MySQL configuration without opening a
handle:

```js
const {
	DEFAULT_STORAGE,
	ROOT,
	SettingsStorage,
} = require("settings/storage");

function InspectStorageConfiguration(strMySQLConnectionString) {
	if ((typeof strMySQLConnectionString !== "string") || (strMySQLConnectionString.length === 0)) {
		throw new TypeError("A non-empty MySQL/MariaDB connection string is required.");
	}

	const SQLiteStorage = new SettingsStorage("MatchHistory", { DatabasePath: `${ROOT}/MatchHistory.sqlite3` });
	const MariaDBStorage = new SettingsStorage("MatchHistoryMariaDB", { Backend: "mysql", ConnectionString: strMySQLConnectionString });

	return {
		DefaultSOCIHandle: DEFAULT_STORAGE.Handle,
		DefaultSettingsNamespace: DEFAULT_STORAGE.Namespace,
		DefaultStorageOptions: {
			Backend: SettingsStorage.Options.Backend,
			ConnectionString: SettingsStorage.Options.ConnectionString,
			DatabasePath: SettingsStorage.Options.DatabasePath,
		},
		MariaDBStorageConfiguration: {
			Backend: MariaDBStorage.Backend,
			ConnectionString: MariaDBStorage.ConnectionString,
		},
		SettingsRoot: ROOT,
		SQLiteStorageConfiguration: {
			Backend: SQLiteStorage.Backend,
			ConnectionString: SQLiteStorage.ConnectionString,
			DatabasePath: SQLiteStorage.Path,
		},
	};
}

module.exports = { InspectStorageConfiguration };
```

Keep credentials outside plugin source. SOCI passes connection strings to the selected backend without
SourceJS-specific parsing.

## Store Every Supported Kind

Use a unique namespace and database owned by the caller, then clean both SQL rows and the session:

```js
const { CreateStorage, ROOT } = require("settings/storage");

async function ExerciseStoredValueKinds(strSettingsNamespace, strPlayerUniqueID, Options) {
	const nLargeSignedValue = 9223372036854775807n;
	const Storage = CreateStorage(strSettingsNamespace, { DatabasePath: `${ROOT}/${strSettingsNamespace}.sqlite3` });
	const Wait = (Request) => new Promise((Resolve, Reject) => {
		Request((RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
	const vecCleanupErrors = [];
	let OperationError = undefined;
	let WorkflowResult = undefined;
	let bOperationFailed = false;

	try {
		const vecSettingsEntries = [
			["NullValue", null],
			["BooleanValue", true],
			["EmptyString", ""],
			["StringValue", "ready"],
			["NumberValue", 12.5],
			["BigIntValue", nLargeSignedValue],
		];
		for (const [strSettingName, SettingsValue] of vecSettingsEntries) {
			await Wait((Callback) => Storage.SetSetting(strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback));
		}

		await Wait((Callback) => Storage.Save(Options, Callback));
		await Wait((Callback) => Storage.Reload(Options, Callback));

		const StoredSettingsValues = await Wait((Callback) => Storage.GetPlayerValues(strPlayerUniqueID, Options, Callback));
		WorkflowResult = {
			BigIntValue: StoredSettingsValues.BigIntValue,
			BooleanValue: StoredSettingsValues.BooleanValue,
			EmptyStringValue: StoredSettingsValues.EmptyString,
			MissingValue: await Wait((Callback) => Storage.GetSetting(strPlayerUniqueID, "MissingValue", "default", Options, Callback)),
			NullValue: StoredSettingsValues.NullValue,
			NumberValue: StoredSettingsValues.NumberValue,
			StringValue: StoredSettingsValues.StringValue,
		};
		const bDeleted = await Wait((Callback) => Storage.DeleteSetting(strPlayerUniqueID, "StringValue", Options, Callback));
		if (!bDeleted) {
			throw new Error("Stored string value was not deleted.");
		}
	} catch (WorkError) {
		OperationError = WorkError;
		bOperationFailed = true;
	}

	if (Storage.Handle !== null) {
		try {
			await Wait((Callback) => Storage.ClearSettings(Options, Callback));
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		try {
			await Wait((Callback) => Storage.Close(Options, Callback));

			if (Storage.Handle !== null) {
				throw new Error("Settings close did not release its session.");
			}
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	if (vecCleanupErrors.length !== 0) {
		const vecFailures = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const CleanupError = new AggregateError(vecFailures, "Stored-value workflow cleanup failed.");
		CleanupError.Storage = Storage;
		throw CleanupError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return WorkflowResult;
}

module.exports = { ExerciseStoredValueKinds };
```

The empty string and BigInt pass through the same encode, reload, and decode path used after a server restart.

The helper attempts both row cleanup and session close, retaining an original work failure before any cleanup failures.
Successful cleanup rethrows a work failure unchanged, even `null` or `undefined`. On cleanup failure the AggregateError's
`Storage` property retains the owned instance for the caller to retry cleanup; a failed Close can leave its Handle live.
After a failed rollback, close the unsafe session before reopening it to remove rows. The helper does not delete the
database file or promise that partially completed work is undone.

## Edit The Live Cache

`Reload()` preserves only top-level `Data` identity; reacquire nested records afterward:

```js
const { SettingsStorage } = require("settings/storage");

async function ExerciseLiveSettingsCache(strSettingsNamespace, strPlayerUniqueID, Options) {
	const Storage = new SettingsStorage(strSettingsNamespace);
	const Wait = (Request) => new Promise((Resolve, Reject) => {
		Request((RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
	const vecCleanupErrors = [];
	let OperationError = undefined;
	let WorkflowResult = undefined;
	let bOperationFailed = false;

	try {
		const SettingsData = Storage.Data;
		const BeforeReload = await Wait((Callback) => Storage.GetPlayerValues(strPlayerUniqueID, Options, Callback));
		BeforeReload.Theme = "dark";
		BeforeReload.ShowDamage = true;
		await Wait((Callback) => Storage.Save(Options, Callback));
		await Wait((Callback) => Storage.Reload(Options, Callback));

		const AfterReload = await Wait((Callback) => Storage.GetPlayerValues(strPlayerUniqueID, Options, Callback));
		WorkflowResult = {
			HasPlayer: await Wait((Callback) => Storage.HasPlayer(strPlayerUniqueID, Options, Callback)),
			PlayerSettingsValuesIdentityChanged: AfterReload !== BeforeReload,
			SettingsDataIdentityPreserved: Storage.Data === SettingsData,
			SettingsValues: { ShowDamage: AfterReload.ShowDamage, Theme: AfterReload.Theme },
		};
	} catch (WorkError) {
		OperationError = WorkError;
		bOperationFailed = true;
	}

	if (Storage.Handle !== null) {
		try {
			await Wait((Callback) => Storage.ClearSettings(Options, Callback));
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		try {
			await Wait((Callback) => Storage.Close(Options, Callback));

			if (Storage.Handle !== null) {
				throw new Error("Settings close did not release its session.");
			}
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	if (vecCleanupErrors.length !== 0) {
		const vecFailures = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const CleanupError = new AggregateError(vecFailures, "Settings workflow cleanup failed.");
		CleanupError.Storage = Storage;
		throw CleanupError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return WorkflowResult;
}

module.exports = { ExerciseLiveSettingsCache };
```

Holding a nested record across reload gives a stale object. The next `GetPlayerValues(strPlayerUniqueID, Options, Callback)` delivers the
current record attached to stable Data.

## Use Collection Operations

Collection methods produce fresh arrays and views while player records remain live:

```js
const { SettingsStorage } = require("settings/storage");

async function ExerciseSettingsCollections(strSettingsNamespace, strFirstPlayerUniqueID, strSecondPlayerUniqueID, Options) {
	const Storage = new SettingsStorage(strSettingsNamespace);
	const Wait = (Request) => new Promise((Resolve, Reject) => {
		Request((RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
	const vecCleanupErrors = [];
	let OperationError = undefined;
	let WorkflowResult = undefined;
	let bOperationFailed = false;

	try {
		await Wait((Callback) => Storage.SetSetting(strFirstPlayerUniqueID, "Color", "green", Options, Callback));
		await Wait((Callback) => Storage.SetSetting(strSecondPlayerUniqueID, "Color", "blue", Options, Callback));

		const vecPlayerSettingsVisits = [];
		Storage.ForEach((PlayerView, strPlayerUniqueID, CurrentStorage) => {
			const PlayerValues = CurrentStorage.GetCachedPlayerValues(strPlayerUniqueID);
			vecPlayerSettingsVisits.push({ ColorSettingValue: PlayerValues.Color, PlayerUniqueID: strPlayerUniqueID, SameSettingsStorage: PlayerView.Storage === Storage });
		});

		const vecPlayerSettingsEntries = [];
		const vecEntries = Storage.Entries();
		for (const [strPlayerUniqueID, PlayerView] of vecEntries) {
			vecPlayerSettingsEntries.push([strPlayerUniqueID, PlayerView.UniqueID]);
		}

		const vecIteratorPlayerUniqueIDs = [];
		for (const [strPlayerUniqueID] of Storage) {
			vecIteratorPlayerUniqueIDs.push(strPlayerUniqueID);
		}

		const vecPlayerSettingsViewUniqueIDs = [];
		const vecPlayerViews = Storage.Values();
		for (const PlayerView of vecPlayerViews) {
			vecPlayerSettingsViewUniqueIDs.push(PlayerView.UniqueID);
		}

		WorkflowResult = {
			IteratorPlayerUniqueIDs: vecIteratorPlayerUniqueIDs,
			PlayerSettingsEntries: vecPlayerSettingsEntries,
			PlayerSettingsVisits: vecPlayerSettingsVisits,
			PlayerSettingsViewUniqueIDs: vecPlayerSettingsViewUniqueIDs,
			PlayerUniqueIDs: Storage.Keys(),
		};
		WorkflowResult.FirstPlayerClearSucceeded = await Wait((Callback) => Storage.ClearPlayer(strFirstPlayerUniqueID, Options, Callback));
		WorkflowResult.FirstPlayerWasRemoved = !await Wait((Callback) => Storage.HasPlayer(strFirstPlayerUniqueID, Options, Callback));
		WorkflowResult.SettingsStorageWasCleared = await Wait((Callback) => Storage.ClearSettings(Options, Callback));
		WorkflowResult.PlayerUniqueIDsAfterClear = Storage.Keys();
	} catch (WorkError) {
		OperationError = WorkError;
		bOperationFailed = true;
	}

	if (Storage.Handle !== null) {
		try {
			await Wait((Callback) => Storage.ClearSettings(Options, Callback));
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		try {
			await Wait((Callback) => Storage.Close(Options, Callback));

			if (Storage.Handle !== null) {
				throw new Error("Settings close did not release its session.");
			}
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	if (vecCleanupErrors.length !== 0) {
		const vecFailures = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const CleanupError = new AggregateError(vecFailures, "Settings workflow cleanup failed.");
		CleanupError.Storage = Storage;
		throw CleanupError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return WorkflowResult;
}

module.exports = { ExerciseSettingsCollections };
```

ClearPlayer's callback receives true even for an absent ID; use HasPlayer's callback result when prior membership matters.

## Use The Low-Level SOCI Lifecycle

Low-level inserts update SQL only. Reload before reading them through the cache:

```js
const { SettingsStorage } = require("settings/storage");

async function ExerciseLowLevelSettingsStorage(strSettingsNamespace, strPlayerUniqueID, Options) {
	const Storage = new SettingsStorage(strSettingsNamespace);
	const Wait = (Request) => new Promise((Resolve, Reject) => {
		Request((RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
	const vecCleanupErrors = [];
	let OperationError = undefined;
	let WorkflowResult = undefined;
	let bOperationFailed = false;

	try {
		const hSOCIHandle = await Wait((Callback) => Storage.Open(Options, Callback));
		await Wait((Callback) => Storage.CreateSchema(Options, Callback));
		await Wait((Callback) => Storage.RunTransaction((hTransactionSOCIHandle, RequestOptions, CompleteTransaction) => {
			Storage.EnsurePlayer(hTransactionSOCIHandle, strPlayerUniqueID, RequestOptions, (PlayerError) => {
				if (PlayerError !== null) {
					CompleteTransaction(PlayerError);
					return;
				}

				Storage.InsertValue(hTransactionSOCIHandle, strPlayerUniqueID, "Ready", true, RequestOptions, CompleteTransaction);
			});
		}, Options, Callback));
		await Wait((Callback) => Storage.Reload(Options, Callback));

		WorkflowResult = {
			LevelShutdownSaveSucceeded: await Wait((Callback) => Storage.OnLevelShutdown(Options, Callback)),
			ReadySettingValue: await Wait((Callback) => Storage.GetSetting(strPlayerUniqueID, "Ready", null, Options, Callback)),
			SettingsCacheIsLive: await Wait((Callback) => Storage.EnsureLoaded(Options, Callback)) === Storage.Data,
			SOCIHandle: hSOCIHandle,
			SOCIHandleIsCurrent: hSOCIHandle === Storage.Handle,
		};
	} catch (WorkError) {
		OperationError = WorkError;
		bOperationFailed = true;
	}

	if (Storage.Handle !== null) {
		try {
			await Wait((Callback) => Storage.ClearSettings(Options, Callback));
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		try {
			await Wait((Callback) => Storage.Close(Options, Callback));

			if (Storage.Handle !== null) {
				throw new Error("Settings close did not release its session.");
			}
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	if (vecCleanupErrors.length !== 0) {
		const vecFailures = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const CleanupError = new AggregateError(vecFailures, "Settings workflow cleanup failed.");
		CleanupError.Storage = Storage;
		throw CleanupError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return WorkflowResult;
}

module.exports = { ExerciseLowLevelSettingsStorage };
```

`SettingsCacheIsLive` checks the exact top-level object identity. `OnLevelShutdown()` is named for lifecycle
integration but must be called or registered by the plugin owner.

## Handle Transaction Failure

A rejected transaction's error is delivered to its completion callback after rollback. The local Wait adapter turns
that callback error into the awaited rejection:

```js
const { SettingsStorage } = require("settings/storage");

async function VerifySettingsRollback(strSettingsNamespace, strPlayerUniqueID, Options) {
	const Storage = new SettingsStorage(strSettingsNamespace);
	const RejectedSettingsUpdateError = new Error("Reject this settings update");
	const MissingSettingsValue = Symbol("missing settings value");
	const Wait = (Request) => new Promise((Resolve, Reject) => {
		Request((RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
	const vecCleanupErrors = [];
	let OperationError = undefined;
	let WorkflowResult = undefined;
	let bOperationFailed = false;

	try {
		try {
			await Wait((Callback) => Storage.RunTransaction((hSOCIHandle, RequestOptions, CompleteTransaction) => {
				Storage.EnsurePlayer(hSOCIHandle, strPlayerUniqueID, RequestOptions, (PlayerError) => {
					if (PlayerError !== null) {
						CompleteTransaction(PlayerError);
						return;
					}

					Storage.InsertValue(hSOCIHandle, strPlayerUniqueID, "RejectedValue", 42, RequestOptions, (InsertError) => CompleteTransaction((InsertError === null) ? RejectedSettingsUpdateError : InsertError));
				});
			}, Options, Callback));
		} catch (TransactionError) {
			if (TransactionError !== RejectedSettingsUpdateError) {
				throw TransactionError;
			}

			await Wait((Callback) => Storage.Reload(Options, Callback));
			const SettingsValue = await Wait((Callback) => Storage.GetSetting(strPlayerUniqueID, "RejectedValue", MissingSettingsValue, Options, Callback));
			WorkflowResult = { SettingWasRolledBack: SettingsValue === MissingSettingsValue, TransactionErrorMessage: TransactionError.message };
		}

		if (WorkflowResult === undefined) {
			throw new Error("The rejected transaction unexpectedly committed.");
		}
	} catch (WorkError) {
		OperationError = WorkError;
		bOperationFailed = true;
	}

	if (Storage.Handle !== null) {
		try {
			await Wait((Callback) => Storage.ClearSettings(Options, Callback));
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		try {
			await Wait((Callback) => Storage.Close(Options, Callback));

			if (Storage.Handle !== null) {
				throw new Error("Settings close did not release its session.");
			}
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	if (vecCleanupErrors.length !== 0) {
		const vecFailures = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const CleanupError = new AggregateError(vecFailures, "Settings workflow cleanup failed.");
		CleanupError.Storage = Storage;
		throw CleanupError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return WorkflowResult;
}

module.exports = { VerifySettingsRollback };
```

If `soci.Rollback(hSOCIHandle, Options, Callback)` also fails, RunTransaction delivers an AggregateError. Its errors
array contains the transaction operation error first and the rollback error second; close the session before reuse.

## PlayerSettingsView

### Constructor And Members

`new PlayerSettingsView(SettingsStorageReference, strPlayerUniqueID)` requires a real SettingsStorage and stores both
arguments. Construction and GetSettingsForPlayer perform no I/O and do not create/load a player row.

| Member | Kind | Purpose |
| --- | --- | --- |
| `Storage` | Property | Exact owning storage instance. |
| `UniqueID` | Property | Bound non-empty player identity. |
| `Size` | Getter | Loaded cache's own enumerable string-key count; zero for an absent player. |
| `Values(Options, Callback)` | Request | Delivers the current live record, ensuring the player if missing. |
| `GetSetting(strSettingName, DefaultValue, Options, Callback)` | Request | Delivers the stored value/default; the default slot is required before the pair. |
| `SetSetting(strSettingName, SettingsValue, Options, Callback)` | Request | Writes SQL and live cache; callback result true. |
| `HasSetting(strSettingName, Options, Callback)` | Request | Delivers the own-key test after ensuring the player. |
| `DeleteSetting(strSettingName, Options, Callback)` | Request | Delivers true when deleted, false when absent. |
| `ClearSettings(Options, Callback)` | Request | Calls ClearPlayer through the owning storage; callback result true. |
| `Keys()` | Method | Fresh loaded-cache setting-name array; empty for an absent player. |
| `Entries()` | Method | Fresh loaded-cache `[strSettingName, SettingsValue]` pairs; empty if absent. |
| `ForEach(SettingsCallback, CallbackReceiver?)` | Method | Invokes the callback with the supplied receiver. |
| `[Symbol.iterator]()` | Method | Iterator over a fresh entries array. |

ForEach calls `SettingsCallback(SettingsValue, strSettingName, PlayerView)` for every current setting, with the supplied
receiver as this. Size, Keys, Entries, ForEach and iteration require the storage to be loaded; they never load/recreate
a player. `GetCachedValues()` reads the same cache and returns null when that player is absent.

Keys, Entries, ForEach and iteration enumerate own enumerable string keys; symbols and non-enumerable properties are
excluded. ForEach captures its entries before calling user code, so later cache changes do not alter that visit list.
HasSetting tests ownership rather than enumerability and therefore also sees an own non-enumerable string property.
The view borrows its storage: close only the owning storage when no users remain. Internal ValueStorage/ValueUniqueID
fields are implementation state, not additional public accessors.

### Work With One Player

The workflow uses the direct constructor, factory method and every view operation:

```js
const {
	PlayerSettingsView,
	SettingsStorage,
} = require("settings/storage");

async function ExercisePlayerSettingsView(strSettingsNamespace, strPlayerUniqueID, Options) {
	const Storage = new SettingsStorage(strSettingsNamespace);
	const Wait = (Request) => new Promise((Resolve, Reject) => {
		Request((RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
	const vecCleanupErrors = [];
	let OperationError = undefined;
	let WorkflowResult = undefined;
	let bOperationFailed = false;

	try {
		const View = new PlayerSettingsView(Storage, strPlayerUniqueID);
		const FactoryPlayerSettingsView = Storage.GetSettingsForPlayer(strPlayerUniqueID);
		await Wait((Callback) => View.SetSetting("Language", "ru", Options, Callback));
		await Wait((Callback) => View.SetSetting("Volume", 75, Options, Callback));

		const vecSettingVisits = [];
		View.ForEach((SettingsValue, strSettingName, CurrentPlayerView) => {
			vecSettingVisits.push({ SamePlayerSettingsView: CurrentPlayerView === View, SettingName: strSettingName, SettingValue: SettingsValue });
		});

		const vecIteratorSettingEntries = [];
		for (const [strSettingName, SettingsValue] of View) {
			vecIteratorSettingEntries.push([strSettingName, SettingsValue]);
		}

		const SettingsValues = await Wait((Callback) => View.Values(Options, Callback));
		const PlayerSettingsViewResult = {
			ConstructorPlayerUniqueID: View.UniqueID,
			FactoryPlayerUniqueID: FactoryPlayerSettingsView.UniqueID,
			HasVolumeSetting: await Wait((Callback) => View.HasSetting("Volume", Options, Callback)),
			IteratorSettingEntries: vecIteratorSettingEntries,
			LanguageSettingValue: await Wait((Callback) => View.GetSetting("Language", null, Options, Callback)),
			SettingCount: View.Size,
			SettingEntries: View.Entries(),
			SettingNames: View.Keys(),
			SettingsValues: { Language: SettingsValues.Language, Volume: SettingsValues.Volume },
			SettingVisits: vecSettingVisits,
			SettingsStorageIsCurrent: View.Storage === Storage,
		};
		PlayerSettingsViewResult.VolumeSettingWasDeleted = await Wait((Callback) => View.DeleteSetting("Volume", Options, Callback));
		PlayerSettingsViewResult.PlayerSettingsWereCleared = await Wait((Callback) => View.ClearSettings(Options, Callback));
		PlayerSettingsViewResult.PlayerWasRemoved = !await Wait((Callback) => Storage.HasPlayer(strPlayerUniqueID, Options, Callback));
		PlayerSettingsViewResult.EmptyCachedSizeAfterClear = View.Size;
		PlayerSettingsViewResult.LanguageSettingValueAfterClear = await Wait((Callback) => View.GetSetting("Language", null, Options, Callback));
		PlayerSettingsViewResult.PlayerWasRecreated = await Wait((Callback) => Storage.HasPlayer(strPlayerUniqueID, Options, Callback));

		WorkflowResult = PlayerSettingsViewResult;
	} catch (WorkError) {
		OperationError = WorkError;
		bOperationFailed = true;
	}

	if (Storage.Handle !== null) {
		try {
			await Wait((Callback) => Storage.ClearSettings(Options, Callback));
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		try {
			await Wait((Callback) => Storage.Close(Options, Callback));

			if (Storage.Handle !== null) {
				throw new Error("Settings close did not release its session.");
			}
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	if (vecCleanupErrors.length !== 0) {
		const vecFailures = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const CleanupError = new AggregateError(vecFailures, "Settings workflow cleanup failed.");
		CleanupError.Storage = Storage;
		throw CleanupError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return WorkflowResult;
}

module.exports = { ExercisePlayerSettingsView };
```

After ClearSettings completes, the same view remains usable. Cache-only inspection sees an absent player without
recreating it. Values/GetSetting/HasSetting/SetSetting/DeleteSetting requests ensure a player record through the owning storage.

## Errors And Lifecycle

- Constructor/public argument validation throws before scheduling; failures while opening, loading, decoding or
  updating SQL/live records reach the request callback. Missing/invalid Options or Callback never schedules I/O.
- CreateSchema requires a current Handle; a missing handle is a callback error. EnsurePlayer/InsertValue validate the
  borrowed hSOCIHandle synchronously. Finish Open before direct low-level use; serialize borrowed-handle operations.
- Record-changing transactions update the live record before commit so a failed JavaScript update can still roll back
  SQL. The callback is delivered after commit/rollback; a failed commit restores the original live record when possible.
  Avoid reading/mutating that record while the write is pending: provisional values can be visible. Restoration or
  rollback failure yields an AggregateError; an unsuccessful SQL rollback requires Close before session reuse.
- Reload preserves Data identity but replaces nested records only after complete validation. Close leaves Data intact
  and sets Loaded to false. The next load-capable request reloads; cache-only iteration/getters throw until loading completes.
- Default database I/O runs off the game thread. Result conversion and callbacks run on the game thread; keep result
  sets/callback work bounded. Blocking intentionally stalls that thread and is suitable only for controlled idle/startup work.
- Finish saves and Close plugin-owned sessions while their callbacks can still run, before tearing down the plugin/runtime.
  Do not close or clear DEFAULT_STORAGE while other SourceJS modules may use it. A busy instance rejects Blocking close
  just like any other Blocking request; queue a normal close and wait for its callback.
- OnLevelShutdown is not automatically registered. Call/register it with the mandatory pair and wait for completion
  if the plugin relies on direct cache edits being saved.
- The standalone workflows attempt both clearing and closing their owned session. Cleanup failures produce an
  AggregateError with the original operation failure first, when present, followed by cleanup failures; its Storage
  property retains the owner for recovery. Successful cleanup preserves the original thrown value, including null
  or undefined. A failed close may leave a live session: retain that owner and resolve the failure before discarding it.

## Related Modules

- [`soci`](soci.md) documents native SQL sessions, parameters and backend support.
- [`settings/player`](settings-player.md) is the higher-level player facade; its storage integration must follow the
  callback request contract above.
- [`settings/types`](settings-types.md) stores typed player values through these backends.
- [`listeners`](listeners.md) can invoke an owned storage's `OnLevelShutdown()` explicitly.
