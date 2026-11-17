# `require("soci")`

> Warning: this reference is intentionally detailed. Use the contents list to open only the operation or workflow needed for the current task.

`soci` is the asynchronous native database module backed directly by [SOCI](https://github.com/SOCI/soci). Every operation runs on its own worker thread and delivers its result through a callback on the game thread. Each runtime accepts at most 128 outstanding asynchronous requests across the shared request queue, not per module or session; blocking requests use a dedicated worker outside that queue limit. Invalid arguments or requests rejected by the queue throw synchronously, while database failures are reported through the callback. SourceJS requires both the SQLite3 and MySQL backends at build time; the MySQL backend is also used for MariaDB servers.

If argument or option getters remove the calling JavaScript context, request admission throws synchronously before starting a worker or retaining the callback for delivery. This applies to asynchronous and blocking requests.

Each game-frame pump uses the number of completions ready at entry as its ordinary drain-loop budget. This does not bound reentrant completion delivery, individual callback duration or blocking waits, and does not guarantee that every request queued by a callback waits for the next frame.

Every connection is represented by a positive numeric handle owned by the SourceJS runtime context that created it. Plugin contexts are isolated by plugin name and cannot use one another's handles; the main runtime has its own owner scope. SourceJS releases plugin-owned handles when that plugin unloads and main-runtime handles during runtime shutdown. Explicit `Close(hSessionHandle, Options, Callback)` is still required so database resources are released at the point intended by the caller.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Sessions And Backends](#sessions-and-backends)
- [Parameters](#parameters)
- [Query Results](#query-results)
- [SQLite Workflow](#sqlite-workflow)
- [Transactions](#transactions)
- [Connection Recovery](#connection-recovery)
- [Generated IDs And Sequences](#generated-ids-and-sequences)
- [MySQL And MariaDB Workflow](#mysql-and-mariadb-workflow)
- [Errors Security And Lifecycle](#errors-security-and-lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	Begin,
	Close,
	Commit,
	Connect,
	Execute,
	GetBackendName,
	GetNextSequenceValue,
	IsConnected,
	LastInsertId,
	Query,
	Reconnect,
	Rollback,
} = require("soci");
```

## Exports

| Export | Callback result | Purpose |
| --- | --- | --- |
| `Connect(strConnectionString, strBackendName?, Options, Callback)` | Positive integer handle | Opens a SOCI session scoped to the current runtime owner. |
| `Close(hSessionHandle, Options, Callback)` | `boolean` | Releases a live handle owned by the current runtime owner; callback result is `false` when the resolved handle is not live or belongs to another owner. |
| `Execute(hSessionHandle, strSQL, Parameters?, Options, Callback)` | `bigint` | Executes a statement; callback result is its affected-row count. |
| `Query(hSessionHandle, strSQL, Parameters?, Options, Callback)` | `object[]` | Executes a row-producing statement; callback result contains all rows. |
| `GetBackendName(hSessionHandle, Options, Callback)` | `string` | Callback result is SOCI's name for the active backend. |
| `LastInsertId(hSessionHandle, strTable, Options, Callback)` | `bigint` | Callback result is the backend's most recent generated ID for a table. |
| `GetNextSequenceValue(hSessionHandle, strSequence, Options, Callback)` | `bigint` | Callback result is the next value from a backend-supported sequence. |
| `Begin(hSessionHandle, Options, Callback)` | `true` | Starts a transaction. |
| `Commit(hSessionHandle, Options, Callback)` | `true` | Commits the active transaction. |
| `Rollback(hSessionHandle, Options, Callback)` | `true` | Rolls back the active transaction. |
| `Reconnect(hSessionHandle, Options, Callback)` | `true` | Asks SOCI to reconnect the existing session. |
| `IsConnected(hSessionHandle, Options, Callback)` | `boolean` | Callback result reports the session's connection state. |

Every method requires a trailing non-array `Options` object and a `Callback` function, even when no option is set. `Options.Blocking` is optional; missing, `null`, or `undefined` means `false`. When `true`, the game thread waits for that request and still invokes its required callback before returning. Callbacks receive `(RequestError, Result)`, with `RequestError` set to `null` on success. Invalid arguments throw before scheduling; database failures are delivered through the callback. All functions are native bindings. There is no JavaScript facade, fallback implementation or compatibility alias.

All methods return `undefined` directly in either mode. Callback return values are ignored, including returned Promises: blocking mode waits for the worker and synchronous callback invocation, not for later asynchronous work started by that callback. A thrown callback exception is logged; the request is not retried.

## Sessions And Backends

```text
Connect(strConnectionString, strBackendName?, Options, Callback)
```

`strConnectionString` must be a non-empty string. Passing an explicit backend is the clearest form:

| Database | Backend | Connection-string example |
| --- | --- | --- |
| SQLite3 | `"sqlite3"` | `"dbname=addons/sourcejs/data/plugin.sqlite3"` |
| MySQL | `"mysql"` | `"db=sourcejs user=sourcejs password=secret host=127.0.0.1 port=3306"` |
| MariaDB | `"mysql"` | The same key/value form accepted by SOCI's MySQL backend. |

When `strBackendName` is omitted, nullish or an empty string, SourceJS calls SOCI's connection-string-only session constructor. Backend selection and connection-string syntax are then entirely SOCI-defined. SQLite3 and MySQL/MariaDB are the backends guaranteed by SourceJS builds.

The callback result is a JavaScript `number`, not a string or object reference. `Connect()` does not pool or cache sessions: every successful call creates a new handle.

Backend registration is once-only and synchronized across connection workers; if registration throws, a later connection can retry it. `Connect()` validates the V8 handle result before inserting the session into the game-thread registry and refuses to replace an existing handle entry. `Close()` releases the native session on its worker, then removes the matching registry entry only after validating its boolean result. These publication checks do not roll back database work or extend a session's lifetime.

Each `hSessionHandle` argument accepts either a positive integer `number` or an object whose `Handle` property is such a number. A missing or malformed handle argument throws an argument-validation error. `Close()` reports `false` through its callback when the handle is not live or belongs to another runtime owner; other operations reject unknown or foreign-owner handles synchronously before scheduling.

Workers sharing a session serialize native access through that session's mutex; separate request threads do not make
one session concurrent. Mutex acquisition is not a FIFO guarantee. Await each dependent operation and all pending
work before closing. A transaction needs exclusive caller ownership of its session for the whole sequence, because
the mutex protects individual operations, not the sequence between Begin and Commit/Rollback.

## Parameters

The `strSQL` argument to `Execute()` and `Query()` must be a non-empty JavaScript string. Each call also requires a trailing `Options` object and `Callback` function; invalid argument types, empty SQL strings, or invalid parameter values throw before SourceJS queues the request. SQL syntax and execution errors are reported through the callback by the selected backend.

`Execute()` and `Query()` accept optional `Parameters` immediately after `strSQL`, before the required trailing `Options` and `Callback`:

- `null` or `undefined` means no bound parameters;
- an array binds positional values in array order;
- an object binds its own string-named properties by name;
- an empty array or object behaves as no parameters.

Each bound value may be:

| JavaScript value | SOCI value |
| --- | --- |
| `null` or `undefined` | SQL `NULL` indicator. |
| `boolean` | Integer `1` or `0`. |
| `string` | Text. |
| Integer `number` within the signed 32-bit range | Signed 32-bit integer. |
| Other finite `number` | Double. |
| Signed 64-bit `bigint` | Signed 64-bit integer. |

`NaN`, infinities, objects, arrays nested as values, binary views and out-of-range `bigint` values throw. Every signed 64-bit integer parameter must be a `bigint`, even at small magnitudes. A finite `number` outside the signed 32-bit integer range binds as a double, not as an inferred 64-bit integer.

Named parameter keys must not be empty. Placeholder spelling is backend/SOCI syntax. Parameters bind values, not SQL identifiers: table names, column names and sort directions must come from fixed SQL or a strict allowlist.

Parameter enumeration and reads preserve JavaScript getter exceptions rather than replacing them with generic validation errors. Named values are read before their keys are converted to text; positional traversal checks the array's current length for each entry. Conversion stages the whole collection and publishes it to the caller only after every entry succeeds, so a failed read or conversion cannot supply a partially parsed collection. These checks do not make caller-provided getters side-effect-free or roll back their effects.

## Query Results

`Query()` supplies a new array containing ordinary row objects as the callback result. Column names become object keys. An unnamed column uses its zero-based column index converted to text. Duplicate column names overwrite earlier values in the same row, so aliases should be unique. A result that exceeds V8's unsigned 32-bit array-index capacity reports an error and never publishes a partial array.

SQL column names/aliases are retained exactly, not converted to PascalCase automatically. Use unique PascalCase
aliases for project-owned query records; preserve names required by an external schema.

Column names are retained as complete strings and installed as own data properties, including a name such as `__proto__`; inherited setters are not invoked. Native row construction returns a row only after all value conversions and property definitions succeed, preserving an existing V8 error on failure. Signed and unsigned 64-bit values are never converted through `number`.

The result array's indexes are also checked own data properties, not assignments through inherited setters. All twelve bindings contain C++ exceptions. Argument parsing and dispatch preserve existing V8 errors; result-conversion helpers also preserve them for the runtime's completion handler. That handler formats a conversion failure into a new callback `Error` with an `undefined` result, rather than preserving the original thrown object's identity. A failed row or index conversion does not publish a partially filled array to the callback. Scalar result conversion retains complete backend-name strings, signed 64-bit BigInts for generated IDs and sequences, and booleans for transactions, reconnection and connection state.

| SOCI column type | JavaScript value |
| --- | --- |
| SQL `NULL` | `null` |
| String | `string` |
| Date/time | `"YYYY-MM-DD HH:MM:SS"` text produced by `strftime`, or an empty string when formatting fails. |
| Double | `number` |
| Integer | `number` |
| Signed or unsigned 64-bit integer | `bigint` |
| Other SOCI type | SOCI string conversion result. |

Affected-row counts, generated IDs and sequence values are always returned as signed 64-bit `bigint`s. Query results also use `bigint` for signed and unsigned 64-bit columns; narrower integer columns use `number`.

## SQLite Workflow

This workflow creates a fixed schema, inserts one player with named parameters, reads the generated ID and queries the inserted row. No database is opened until the function is called.

```js
const {
	Close,
	Connect,
	Execute,
	GetBackendName,
	IsConnected,
	LastInsertId,
	Query,
} = require("soci");

function AwaitSOCIRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function StoreSQLitePlayer(strConnectionString, strPlayerName, nScore) {
	if ((typeof strPlayerName !== "string") || (strPlayerName.length === 0) || !Number.isSafeInteger(nScore)) {
		throw new TypeError("A non-empty player name and safe integer score are required.");
	}

	const hSessionHandle = await AwaitSOCIRequest({}, (Options, Callback) => Connect(strConnectionString, "sqlite3", Options, Callback));
	let Result = null;
	let OperationError = null;
	let bOperationFailed = false;

	try {
		await AwaitSOCIRequest({}, (Options, Callback) => Execute(hSessionHandle, "CREATE TABLE IF NOT EXISTS SourceJSPlayers (ID INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Score INTEGER NOT NULL)", Options, Callback));

		const nAffectedRowCount = await AwaitSOCIRequest({}, (Options, Callback) => Execute(hSessionHandle, "INSERT INTO SourceJSPlayers (Name, Score) VALUES (:Name, :Score)", { Name: strPlayerName, Score: nScore }, Options, Callback));
		const nInsertID = await AwaitSOCIRequest({}, (Options, Callback) => LastInsertId(hSessionHandle, "SourceJSPlayers", Options, Callback));
		const vecRows = await AwaitSOCIRequest({}, (Options, Callback) => Query(hSessionHandle, "SELECT ID, Name, Score FROM SourceJSPlayers WHERE ID = :ID", { ID: nInsertID }, Options, Callback));
		Result = {
			Connected: await AwaitSOCIRequest({}, (Options, Callback) => IsConnected(hSessionHandle, Options, Callback)),
			AffectedRowCount: nAffectedRowCount,
			InsertID: nInsertID,
			BackendName: await AwaitSOCIRequest({}, (Options, Callback) => GetBackendName(hSessionHandle, Options, Callback)),
			Rows: vecRows,
		};
	} catch (RequestError) {
		OperationError = RequestError;
		bOperationFailed = true;
	}

	try {
		const bClosed = await AwaitSOCIRequest({}, (Options, Callback) => Close(hSessionHandle, Options, Callback));
		if (bClosed !== true) {
			throw new Error("Close did not confirm release of the SQLite session.");
		}
	} catch (CloseError) {
		const vecErrors = bOperationFailed ? [OperationError, CloseError] : [CloseError];
		const CompletionError = new AggregateError(vecErrors, "SQLite workflow could not confirm session cleanup.", { cause: bOperationFailed ? OperationError : CloseError });
		CompletionError.SessionHandle = hSessionHandle;
		throw CompletionError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}

module.exports = { StoreSQLitePlayer };
```

The caller chooses the database file through `strConnectionString`, for example `"dbname=addons/sourcejs/data/my-plugin.sqlite3"`. Keep plugin-owned databases under a plugin-owned data path and do not share table ownership accidentally.

The workflow attempts Close exactly once after a successful Connect, even if a later operation fails. Confirmed
cleanup preserves an original operation failure unchanged. Unconfirmed cleanup rejects with an AggregateError
containing every failure and the SessionHandle, so the owner can investigate or retry cleanup in the same runtime
context. That handle is not a guarantee the session remains live; Close may already have released it before result
conversion failed. Do not replay the insert to recover from a cleanup or later metadata failure: it may already be committed.

## Transactions

`Begin()`, `Commit()` and `Rollback()` operate on the supplied session; each requires `Options` and `Callback`, whose result is `true` after SOCI succeeds. SourceJS does not create an automatic rollback wrapper.

This transfer uses positional parameter arrays, verifies both affected-row counts and preserves both failures in an
AggregateError with the original failure as cause if rollback also fails, without mutating thrown values:

`unSourceID` and `unDestinationID` are positive signed 64-bit `bigint` IDs, matching the generated-ID result type. `unAmount` is a positive safe-integer `number` for this example's integer score column. Validation completes before the transaction starts.

```js
const {
	Begin,
	Commit,
	Execute,
	Rollback,
} = require("soci");

function AwaitSOCIRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function TransferScore(hSessionHandle, unSourceID, unDestinationID, unAmount) {
	const nMaximumSQLInteger = (1n << 63n) - 1n;

	if ((typeof unSourceID !== "bigint") || (unSourceID <= 0n) || (unSourceID > nMaximumSQLInteger) || (typeof unDestinationID !== "bigint") || (unDestinationID <= 0n) || (unDestinationID > nMaximumSQLInteger) || !Number.isSafeInteger(unAmount) || (unAmount <= 0)) {
		throw new TypeError("Player IDs must be positive signed 64-bit BigInts, and the amount must be a positive safe integer.");
	}

	await AwaitSOCIRequest({}, (Options, Callback) => Begin(hSessionHandle, Options, Callback));

	try {
		const nRemovedRowCount = await AwaitSOCIRequest({}, (Options, Callback) => Execute(hSessionHandle, "UPDATE SourceJSPlayers SET Score = Score - :Amount WHERE ID = :ID AND Score >= :Minimum", [unAmount, unSourceID, unAmount], Options, Callback));
		const nAddedRowCount = await AwaitSOCIRequest({}, (Options, Callback) => Execute(hSessionHandle, "UPDATE SourceJSPlayers SET Score = Score + :Amount WHERE ID = :ID", [unAmount, unDestinationID], Options, Callback));
		if ((nRemovedRowCount !== 1n) || (nAddedRowCount !== 1n)) {
			throw new Error("Score transfer did not update both players.");
		}

		const bCommitted = await AwaitSOCIRequest({}, (Options, Callback) => Commit(hSessionHandle, Options, Callback));

		return {
			Committed: bCommitted,
			AddedRowCount: nAddedRowCount,
			RemovedRowCount: nRemovedRowCount,
		};
	} catch (TransactionError) {
		try {
			await AwaitSOCIRequest({}, (Options, Callback) => Rollback(hSessionHandle, Options, Callback));
		} catch (RollbackError) {
			throw new AggregateError([TransactionError, RollbackError], "Score transfer failed and rollback also failed.", { cause: TransactionError });
		}

		throw TransactionError;
	}
}

module.exports = { TransferScore };
```

The handle remains caller-owned and open after this function. DDL transaction behavior and isolation rules depend on the selected database backend.
Do not share the session with unrelated requests during this sequence. A failed rollback leaves transaction state
unconfirmed; the owner must recover or release that session before reusing it.

## Connection Recovery

`IsConnected()` reports SOCI's current state through its callback. `Reconnect()` reuses the existing handle and connection parameters; its callback result is `true` after the backend reconnects. Both methods require `Options` and `Callback`.

```js
const {
	IsConnected,
	Reconnect,
} = require("soci");

function AwaitSOCIRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function EnsureSessionConnection(hSessionHandle) {
	if (await AwaitSOCIRequest({}, (Options, Callback) => IsConnected(hSessionHandle, Options, Callback))) {
		return false;
	}

	await AwaitSOCIRequest({}, (Options, Callback) => Reconnect(hSessionHandle, Options, Callback));

	if (!await AwaitSOCIRequest({}, (Options, Callback) => IsConnected(hSessionHandle, Options, Callback))) {
		throw new Error("The SOCI session remained disconnected after Reconnect().");
	}

	return true;
}

module.exports = { EnsureSessionConnection };
```

`false` means no reconnect was needed; `true` means the function reconnected and verified the session. Query failures are not retried automatically because replaying a write may duplicate side effects.

## Generated IDs And Sequences

`LastInsertId(hSessionHandle, strTable, Options, Callback)` and `GetNextSequenceValue(hSessionHandle, strSequence, Options, Callback)` delegate to backend capabilities. Each requires `Options` and `Callback`. Their identifier arguments are non-empty strings, not bound SQL values. A backend that does not implement the requested operation reports its failure through the callback.

```js
const {
	GetBackendName,
	GetNextSequenceValue,
} = require("soci");

function AwaitSOCIRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function ReserveSequenceValue(hSessionHandle, strSequenceName) {
	if ((typeof strSequenceName !== "string") || (strSequenceName.length === 0)) {
		throw new TypeError("A non-empty sequence name is required.");
	}

	return {
		SequenceValue: await AwaitSOCIRequest({}, (Options, Callback) => GetNextSequenceValue(hSessionHandle, strSequenceName, Options, Callback)),
		BackendName: await AwaitSOCIRequest({}, (Options, Callback) => GetBackendName(hSessionHandle, Options, Callback)),
	};
}

module.exports = { ReserveSequenceValue };
```

SQLite and MySQL/MariaDB schemas normally use auto-increment IDs and `LastInsertId()`. Call `GetNextSequenceValue()` only for a connected backend and schema that actually provide named sequences.
A reserved sequence value is already consumed if the later GetBackendName request fails; that failure does not
return the value or roll back sequence advancement. Retrying may consume another value.

## MySQL And MariaDB Workflow

MariaDB uses the `"mysql"` backend name. This workflow inserts a JSON audit payload into a fixed table and returns the stored row. Credentials remain a caller-owned connection string and are never embedded in the module.

```js
const {
	Close,
	Connect,
	Execute,
	GetBackendName,
	LastInsertId,
	Query,
} = require("soci");

function AwaitSOCIRequest(Options, StartRequest) {
	return new Promise((Resolve, Reject) => {
		StartRequest(Options, (RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function InsertMariaDBAudit(strConnectionString, strEventName, Payload) {
	const unMaximumEventNameLength = 128;

	if ((typeof strEventName !== "string") || (strEventName.length === 0) || (strEventName.length > unMaximumEventNameLength)) {
		throw new TypeError(`An audit event name containing 1 through ${unMaximumEventNameLength} UTF-16 code units is required.`);
	}

	const strPayloadJSON = JSON.stringify(Payload);
	if (typeof strPayloadJSON !== "string") {
		throw new TypeError("The audit payload must have a JSON representation.");
	}

	const hSessionHandle = await AwaitSOCIRequest({}, (Options, Callback) => Connect(strConnectionString, "mysql", Options, Callback));
	let Result = null;
	let OperationError = null;
	let bOperationFailed = false;

	try {
		await AwaitSOCIRequest({}, (Options, Callback) => Execute(hSessionHandle, `CREATE TABLE IF NOT EXISTS SourceJSAudit (ID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, EventName VARCHAR(${unMaximumEventNameLength}) NOT NULL, PayloadJSON LONGTEXT NOT NULL)`, Options, Callback));

		const nAffectedRowCount = await AwaitSOCIRequest({}, (Options, Callback) => Execute(hSessionHandle, "INSERT INTO SourceJSAudit (EventName, PayloadJSON) VALUES (:EventName, :PayloadJSON)", { EventName: strEventName, PayloadJSON: strPayloadJSON }, Options, Callback));
		const nInsertID = await AwaitSOCIRequest({}, (Options, Callback) => LastInsertId(hSessionHandle, "SourceJSAudit", Options, Callback));
		const vecRows = await AwaitSOCIRequest({}, (Options, Callback) => Query(hSessionHandle, "SELECT ID, EventName, PayloadJSON FROM SourceJSAudit WHERE ID = :ID", { ID: nInsertID }, Options, Callback));
		Result = {
			AffectedRowCount: nAffectedRowCount,
			InsertID: nInsertID,
			BackendName: await AwaitSOCIRequest({}, (Options, Callback) => GetBackendName(hSessionHandle, Options, Callback)),
			Rows: vecRows,
		};
	} catch (RequestError) {
		OperationError = RequestError;
		bOperationFailed = true;
	}

	try {
		const bClosed = await AwaitSOCIRequest({}, (Options, Callback) => Close(hSessionHandle, Options, Callback));
		if (bClosed !== true) {
			throw new Error("Close did not confirm release of the MariaDB session.");
		}
	} catch (CloseError) {
		const vecErrors = bOperationFailed ? [OperationError, CloseError] : [CloseError];
		const CompletionError = new AggregateError(vecErrors, "MariaDB audit could not confirm session cleanup.", { cause: bOperationFailed ? OperationError : CloseError });
		CompletionError.SessionHandle = hSessionHandle;
		throw CompletionError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}

module.exports = { InsertMariaDBAudit };
```

`JSON.stringify()` errors and unsupported top-level values are rejected before the connection opens. Database migrations should be versioned instead of relying on `CREATE TABLE IF NOT EXISTS` as a complete schema migration system.

The example uses a signed BIGINT ID to match LastInsertId's signed 64-bit result contract. Existing schemas are not
changed by CREATE TABLE IF NOT EXISTS. The close/error/SessionHandle recovery rules are the same as in the SQLite
workflow: a successful insert can remain committed if a later query, metadata request or cleanup fails. Do not replay
the insert to retry cleanup. Character-set and backend errors still arrive through the native callback.

## Errors Security And Lifecycle

Validation and request-queue failures throw synchronously. SOCI failures are reported through the required error-first callback; a Promise adapter such as the one in the examples can convert those callback errors into rejections. Important operational rules:

- Every operation requires a registered SourceJS runtime context. Plugin contexts use their plugin name as the owner; the main runtime uses its dedicated owner scope. Any other context throws before accessing a session.
- Each accepted request runs on its own worker thread and delivers its callback on the game thread. `Options.Blocking: true` waits for that worker on the game thread but still requires and invokes the callback; keep blocking use out of hot hooks, commands and per-frame listeners.
- Always bind untrusted values. Never concatenate player text, tokens or request data into SQL.
- Use fixed or allowlisted identifiers because parameters cannot bind table and column names.
- Do not log connection strings containing passwords.
- Attempt `Close(hSessionHandle, Options, Callback)` once on every owned workflow exit and verify its result. Preserve
  original and cleanup failures together; retain an unconfirmed handle for explicit owner recovery instead of losing it.
- Keep transactions short; always handle rollback failure as a distinct error path.
- Treat returned row objects as current query results, not live database views.
- Owner teardown releases leaked sessions: plugin unload handles plugin-owned sessions, and runtime shutdown handles main-runtime sessions. This emergency cleanup is not a substitute for explicit ownership.
- If `Connect()` exhausts SourceJS's process-local positive handle range while converting a successful connection result, it reports that failure through the required callback and creates no handle.

`Close()` reports `false` through its callback for an already closed or foreign handle. Other operations reject unknown or foreign-owner handles before scheduling. Session handles are transient and must not be stored across plugin reloads.

Operations sharing one session are serialized by that session's mutex; use separate sessions for independent work and sequence dependent statements through callbacks. Do not assume submission order makes concurrently queued statements or whole transactions atomic. Context unload discards pending callbacks without cancelling running workers; shutdown waits for those workers before disposing the JavaScript environment. Configure bounded database waits and timeouts so teardown can finish.

## Related Modules

- [`settings/storage`](settings-storage.md) builds typed persistent settings namespaces on top of SOCI.
- [`redis`](redis.md) provides asynchronous redis++ connections and Redis data structures through required options and callbacks.
- [`cpr`](cpr.md) provides asynchronous HTTP/HTTPS requests with text and raw-byte response bodies through required options and callbacks.
