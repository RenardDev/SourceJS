# `require("auth/backends/sql")`

> Warning: this file is dense API documentation. Use the section links below and verify native and class methods separately because similarly named migration operations have different directions.

The `SQLBackend` class uses the native `soci` module and persists authorization state in the configured database. The package adds the class and its singleton to the native `auth/backends/sql` module; it does not add free-function aliases.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import and exports](#import-and-exports)
- [`SQLBackend`](#sqlbackend)
- [Request execution and concurrency](#request-execution-and-concurrency)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

## Location and purpose

The JavaScript implementation lives in [`packages/sourcejs/auth/backends/sql.js`](../../packages/sourcejs/auth/backends/sql.js), and the native free-function surface is installed from [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). Use `SQLBackend` when authorization state should be stored through a SOCI database connection, optionally synchronized into an `AuthManager`, or migrated to and from the packaged flat-file format. The backend centralizes schema creation, transactions, record validation, and server-scoped permissions so callers do not have to reproduce the storage contract.

## Import and exports

```js
const { SQL_BACKEND, SQLBackend } = require("auth/backends/sql");
```

The native module exports 20 authorization operations and one internal request-control operation. The package then attaches `SQL_BACKEND` and `SQLBackend`, for a total surface of 23 exports:

| Export | Signature |
| --- | --- |
| `NetworkID` | `NetworkID(nPlayerIndex)`; returns the player's network-ID string. Rejects missing or invalid indices, unavailable players, and missing network IDs. Uses the shared `steam.GetNetworkID()` callback, so diagnostics carry that API name. |
| `Path` | `Path()`; returns the native SQL-text state-file path as a string. |
| `Reload` | `Reload()`; reads the SQL-text state file and returns a native state object. |
| `Save` | `Save()`; rereads and saves the native SQL-text state file, returning a boolean. It does not save a `SQLBackend` instance's connection state. |
| `Players` | `Players()`; reads native SQL-text state and returns its player-record object. |
| `Parents` | `Parents()`; reads native SQL-text state and returns its parent-record object. |
| `GetPlayer` | `GetPlayer(Subject?)`; returns the record or `null` when no record matches. |
| `GetParent` | `GetParent(strParentName?)`; returns the record or `null` when no record matches. |
| `HasPlayerPermission` | `HasPlayerPermission(Subject, strPermission)`; returns a boolean permission result from native SQL-text state. |
| `HasParentPermission` | `HasParentPermission(strParentName, strPermission)`; returns a boolean permission result from native SQL-text state. |
| `AddPlayerPermission` / `RemovePlayerPermission` | `(Subject, strPermission)` |
| `AddPlayerParent` / `RemovePlayerParent` | `(Subject, strParentName)` |
| `AddParentPermission` / `RemoveParentPermission` | `(strParentName, strPermission)` |
| `AddParentParent` / `RemoveParentParent` | `(strParentName, strInheritedParentName)` |
| `ExportFlatFile` | `ExportFlatFile()`; loads flat-file state, attempts to save it as the native SQL state, and returns the boolean save result. |
| `ImportFlatFile` | `ImportFlatFile()`; loads native SQL state, attempts to save it to the flat files, and returns the boolean save result. |
| `WaitForRequest` | `WaitForRequest(Callback)`; internal package control that waits for and delivers the oldest existing native request with this exact callback in the current JavaScript context. Returns `false` if no matching request is available or delivery fails. It neither starts a request nor waits for or delivers unrelated requests. Backend errors still arrive through the original callback. Invalid arguments throw. |
| `SQL_BACKEND` | `SQLBackend` singleton. |
| [`SQLBackend`](#sqlbackend) | `new SQLBackend(Options = {})`; class with the defaults described below. |

| Use | Example |
| --- | --- |
| Inspect the lifecycle state of the shared SQL adapter without opening a connection. Import `SQL_BACKEND` from `auth/backends/sql`. | `const bSharedBackendLoaded = SQL_BACKEND.Loaded;` |

The eight native add/remove operations load SQL-text state, apply the requested change, and return the boolean save result. Missing arguments or empty converted identifiers return `false`; removal also returns `false` when the record or requested permission/parent entry is absent. A failed save is not a rollback guarantee.

Native record data uses the PascalCase fields `Name`, `Permissions`, and `Parents`; the package preserves those public names.

A failed native SQL-text file load throws before queries, mutations, saves, or migrations consume or persist partial state. These synchronous free functions remain separate from the callback-based `SQLBackend` class. Native permission matching is case-sensitive: only `*` is a wildcard, `?` is literal, and the full string, including embedded null characters, participates in matching. The matcher uses no recursion.

The native state operations read or write a SQL-text state file, not the SOCI connection configured on a `SQLBackend` instance. Do not treat native free functions and class methods as interchangeable database operations.

## `SQLBackend`

Default options use the following existing API keys. Preserve their exact spelling; these keys are not a naming template for new variables:

```js
const g_DefaultOptions = {
	BackendName: "sqlite3",
	ConnectionString: null,
	DatabasePath: null,
	Manager: null,
	URI: null,
};
```

Request methods require an explicit non-null, non-array `Options` object and a `Callback` function, including when `Options.Blocking` is `true`. Invalid argument types throw `TypeError` before connection or query work starts; an already-unloaded backend still validates both arguments. Constructor options configure the backend; they do not replace per-call options. `Path()` and the synchronous native free functions are not request methods.

Obtain the connection handle from the `Open` callback and the resolved database path from `Path()`. `Connection`, `SchemaReady`, `Manager`, `ConnectionString`, and `DatabasePath` are not public instance getters; configuration keys live in `Options`, while resolved connection/session state is internal.

| Member | Signature |
| --- | --- |
| `BackendName` | Static string: `"sql"`; the instance's configured SOCI backend name defaults to `"sqlite3"` and may be `null`. |
| `Options` | Static defaults and inherited instance options getter. |
| `Name` / `Loaded` | Inherited backend getters. |
| `GetConnectionStringFromOptions` | `GetConnectionStringFromOptions()`; resolves the explicit connection string before the URI, or returns `null`. A `sqlite:///` URI also updates the backend name and database path. |
| `Open` | `Open(Options, Callback)`; reuses or reconnects an existing handle, otherwise connects; initializes the schema when not ready and calls back with `(null, hConnection)`. A schema failure retains the handle for cleanup or retry; the next `Open` request retries schema creation. Concurrent opens and joined blocking completion follow the [request execution contract](#request-execution-and-concurrency). |
| `CreateSchema` | `CreateSchema(Options, Callback)`; requires an already-open connection and does not open one itself. Normally invoked by `Open`; creates missing authorization tables through worker-backed requests, marks the schema ready only after all three statements succeed, and reports success as `Callback(null, true)`. Database errors are passed to `Callback(OperationError)`. |
| `RunTransaction` | `RunTransaction(Options, Transaction, Callback)`; begins a worker-backed transaction and calls `Transaction(hConnection, Options, CompleteTransaction)`. Do not return a promise; call `CompleteTransaction(OperationError, Result)` when the transaction work finishes. The final callback receives the result after commit. A transaction or commit failure triggers rollback; if rollback also fails, the callback receives an `AggregateError`. |
| `UpdateSQLiteSchema` | `UpdateSQLiteSchema(Options, Callback)`; for the SourceJS SQLite schema. Opens the backend if needed and adds the group-membership lookup index in a transaction. Reports `Callback(null, true)` after commit, including when the index already exists. Does not modify grants or memberships. |
| `CreateAuthorizationObject` | `CreateAuthorizationObject(strIdentifier, strObjectType, Options, Callback)` ensures a `"Player"` or `"Parent"` record. An existing record is not modified. |
| `DeleteAuthorizationObject` | `DeleteAuthorizationObject(strIdentifier, strObjectType, Options, Callback)` removes the record, its grants, and its memberships in one transaction. Deleting a parent also removes references to that group from other records. The result indicates whether a record was deleted. |
| `ReplacePlayerParents` | `ReplacePlayerParents(strPlayerIdentifier, vecParentNames, Options, Callback)` ensures the player and replaces their groups in one transaction. It rejects a missing group and rolls back, deduplicates up to 32 supplied names, and accepts an empty array to clear the list. |
| `EnsureObject` | `EnsureObject(hConnection, strIdentifier, strObjectType, Options, Callback)`; requires a non-empty string identifier and the exact type `Player` or `Parent`, inserts only when absent, and reports completion or a database error through `Callback`. |
| `Load` / `Unload` / `Reload` | `Load(Options, Callback)` opens, marks loaded, and then synchronizes; a synchronization error is passed to the callback while the loaded flag remains set. `Unload(Options, Callback)` first waits for an in-progress opening, then closes any resulting connection before clearing the handle and state flags and reporting `true`; a close error is passed to the callback and prevents that cleanup. `Reload(Options, Callback)` unloads and then loads. |
| `Synchronize` / `Save` | `Synchronize(Options, Callback)` and `Save(Options, Callback)` pass the state read from the database to the error-first callback after synchronizing the configured manager. `Save(Options, Callback)` delegates to `Synchronize(Options, Callback)`; it does not write manager edits to the database. |
| `Path` | `Path()`; returns `DatabasePath` when non-null, otherwise the default database path. This is not a query of the connected database's location. |
| `ReadState` | `ReadState(Options, Callback)`; reads `{ Parents, Players }` from the database and passes the state to the error-first callback. Permissions include global rows (`server_id = -1`) and rows for the configured manager's server ID; without a manager, only global permissions are included. Object identities and parent relationships are not server-filtered. |
| `SynchronizeManager` | `SynchronizeManager(AuthorizationState)`; returns the supplied state unchanged when no manager is configured. Otherwise clears and rebuilds the manager's stores without persistence callbacks. A validation failure can leave the stores partially rebuilt; there is no rollback of manager state. |
| `Players` / `Parents` | `Players(Options, Callback)` / `Parents(Options, Callback)`; read the respective record dictionary from the database and pass it to the error-first callback. |
| `GetPlayer` / `GetParent` | `GetPlayer(Subject, Options, Callback)` / `GetParent(strName, Options, Callback)`; pass one record or `null` to the callback when no record matches. A player subject is a non-empty string identifier or a numeric player index resolved through the runtime; a parent name must be a non-empty string. Invalid identities can throw synchronously; database errors are passed to the callback. |
| `HasPlayerPermission` / `HasParentPermission` | `HasPlayerPermission(Subject, strPermission, Options, Callback)` / `HasParentPermission(strName, strPermission, Options, Callback)`; pass a boolean to the callback for direct or inherited permissions, with `*` wildcards in stored permissions. Parent traversal detects cycles; player identifiers and parent names are separate namespaces. Missing records produce `false`; invalid identities or permission strings can throw synchronously, while database errors are passed to the callback. |
| `PermissionAdded` / `PermissionRemoved` | `(Node, strPermission, nServerID, Options, Callback)`; asynchronously persist backend permission changes. `PermissionAdded` passes `true` through the callback when the permission already exists or is inserted. |
| `ParentAdded` / `ParentRemoved` | `(Node, strParentName, Options, Callback)`; asynchronously persist backend relationship changes. |
| `AddPermission` / `RemovePermission` | `(strIdentifier, strObjectType, strPermission, nServerID, Options, Callback)`; object-type-aware persistence operations. Adding is transactional and passes `true` to the callback even when the permission already exists. Removing passes whether any matching row was deleted. Validation errors can throw synchronously; database errors are passed to the callback. |
| `AddParent` / `RemoveParent` | `(strIdentifier, strObjectType, strParentName, Options, Callback)`; object-type-aware relationship operations. Adding is transactional and passes `true` to the callback for an existing relationship too; removing passes whether any matching row was deleted. |
| `AddPlayerPermission` / `RemovePlayerPermission` | `(Subject, strPermission, nServerID, Options, Callback)`; asynchronously persist player permissions and pass the operation result or database error to the callback. |
| `AddPlayerParent` / `RemovePlayerParent` | `(Subject, strParentName, Options, Callback)`; asynchronously persist player relationships and pass the operation result or database error to the callback. |
| `AddParentPermission` / `RemoveParentPermission` | `(strParentName, strPermission, nServerID, Options, Callback)`; asynchronously persist parent permissions and pass the operation result or database error to the callback. |
| `AddParentParent` / `RemoveParentParent` | `(strParentName, strInheritedParentName, Options, Callback)`; asynchronously persist parent inheritance and pass the operation result or database error to the callback. |
| `ExportFlatFile` / `ImportFlatFile` | `ExportFlatFile(Options, Callback)` / `ImportFlatFile(Options, Callback)`; class methods with the reverse direction of the similarly named native functions. Export writes the server-filtered database state to the flat files and passes that state to the callback; filesystem or database errors are passed to the callback. Flat-file records use the native format's PascalCase `Permissions` and `Parents` arrays; identifiers are dictionary keys, including `__proto__`, rather than a separate name field. Lowercase aliases are not emitted or read. The two writes are not atomic: a failure can leave partially updated files. Import deletes all existing authorization rows, including every server's permissions, and inserts the flat-file records in a transaction with global permissions (`server_id = -1`), then synchronizes. This replaces rather than merges records and does not preserve server-specific permission scopes. The transaction is committed before synchronization; a subsequent synchronization error does not undo the import. |
| `InsertPermission` / `InsertParent` | `InsertPermission(hConnection, strIdentifier, strObjectType, strPermission, nServerID, Options, Callback)` / `InsertParent(hConnection, strIdentifier, strObjectType, strParentName, Options, Callback)`; asynchronously insert using the supplied connection and report completion or database error through the callback. `InsertParent(hConnection, strIdentifier, strObjectType, strParentName, Options, Callback)` first ensures that the parent object exists, which can add that object. They do not begin or commit a transaction themselves. |

## Request execution and concurrency

Request scheduling, waiting, result conversion, and callbacks are confined to the owning game thread. Each SOCI request performs database work on its own worker; a high-level backend operation may issue several sequential requests. Default requests complete asynchronously. When `Options.Blocking` is `true`, the game thread waits for the related requests and their callbacks before the operation returns. A callback and options remain mandatory in either mode.

Concurrent `Open` calls share the in-progress opening. A joining caller with `Blocking: true` waits through its connection/check/reconnect and schema continuations until its callback has run, even if the first caller requested asynchronous work. Other requests are not pumped or awaited. The detached callback queue is delivered in registration order with the connection handle captured at completion, even if an earlier callback unloads or reopens the backend. Coordinate lifecycle changes with other waiters: a captured handle does not extend its lifetime. A throwing callback does not suppress later callbacks; the first callback exception is rethrown into the native request dispatcher, which logs callback failures.

The internal `WaitForRequest` control accepts only an existing callback, not options and a new callback. It does not cancel work or grant access to another context's requests. Do not override `CreateSchema` with untracked asynchronous work when using joined blocking opens; delegate to the base implementation to retain continuation tracking. An unavailable continuation throws rather than falsely reporting blocking completion.

One backend instance uses one connection. Sequence transactions and dependent mutations through completion callbacks; do not assume that distinct request workers provide independent database sessions or isolate overlapping transactions on that connection. Open, transaction completion, synchronization, row processing, permission checks, and flat-file transfer boundaries wrap falsy failure values, including a thrown `null`, in an `AggregateError` that retains the original value in `errors[0]`. Truthy errors and exceptions thrown by user callbacks retain their identity. Synchronous begin, commit, or rollback dispatch failures follow the same error/rollback contract as callback-reported failures.

`ImportFlatFile` reads and parses files on the game thread before issuing database requests. `ExportFlatFile` serializes and writes files on that thread after reading database state. `Blocking: false` does not make these filesystem phases asynchronous. The synchronous native SQL-text functions are a separate surface and do not use SOCI workers.

## Examples

This example uses the blocking option to open a separate SQLite database and persist a global `sourcejs.kick` permission for the `moderator` parent. Every operation still supplies both its options object and callback. `Unload` closes the connection; it does not undo that change.

Each database request blocks until its callback completes, but `Main` still returns a promise because it uses `await`. A startup sequence that depends on the entire example must await that promise or continue from its completion handler; calling `Main().catch(...)` alone does not block the surrounding JavaScript until all operations finish.

```js
const { SQLBackend } = require("auth/backends/sql");
const { AUTH_SQL_FILE } = require("paths");

const g_strSOCIDatabasePath = `${AUTH_SQL_FILE}.soci`;
const g_Backend = new SQLBackend({ DatabasePath: g_strSOCIDatabasePath });
const g_Options = { Blocking: true };

const g_RunBlockingOperation = (Operation) => new Promise((Resolve, Reject) => {
	Operation(g_Options, (OperationError, Result) => {
		if (OperationError !== null) {
			Reject(OperationError);
			return;
		}

		Resolve(Result);
	});
});

async function Main() {
	try {
		const AuthState = await g_RunBlockingOperation((Options, Callback) => g_Backend.Load(Options, Callback));
		console.log(g_Backend.Path(), AuthState.Parents, AuthState.Players);
		await g_RunBlockingOperation((Options, Callback) => g_Backend.AddParentPermission("moderator", "sourcejs.kick", -1, Options, Callback));
	} finally {
		await g_RunBlockingOperation((Options, Callback) => g_Backend.Unload(Options, Callback));
	}
}

Main().catch((Exception) => console.error(Exception));
```

## Safe use and common mistakes

- With no connection option, the backend uses `sqlite3` and `paths.AUTH_SQL_FILE`. `AUTH_SQL_FILE` is an uppercase exported constant; use its exact module name.
- `ConnectionString` takes precedence over `URI`. A `sqlite:///` URI forces the `sqlite3` backend and derives `DatabasePath`; any other URI becomes the connection string without changing `BackendName`, whose default is `sqlite3`.
- Pass `Manager` when a standalone backend must synchronize an authorization manager. The built-in manager supplies itself when it creates its SQL backend.
- Pair `Load` or `Open` with `Unload` when the backend instance owns a database handle. A successful `Unload` closes the handle and clears `Loaded`; a close error is passed to its callback and leaves the backend fields unchanged.
- Review the [request execution contract](#request-execution-and-concurrency) before using blocking startup work, joined opens, transactions, or flat-file migrations.
- Do not conflate the two storage layers. Native authorization-state functions use the SQL-text file reported by native `Path()`, whereas `SQLBackend` uses a SOCI database. Both default paths resolve to `paths.AUTH_SQL_FILE` despite the different storage formats, so construct `SQLBackend` with a distinct `DatabasePath` when both surfaces may be used. Never point native save or migration operations at the SOCI database file: they write SQL text, not a SQLite database, and can overwrite its contents.
- Native SQL-text state callbacks, including queries, mutations, `Save`, `ExportFlatFile`, and `ImportFlatFile`, preserve JavaScript errors and translate C++ failures at their callback boundaries. Failed argument conversion, loading, or record construction stops before consuming or saving partial state; a normally missing player or parent still returns `null`. These native file operations are distinct from callback-based SOCI database requests.
- Distinguish migration directions: the native `ExportFlatFile` reads flat files into its SQL store, while `SQLBackend.ExportFlatFile` writes database state to flat files. The corresponding `ImportFlatFile` operations reverse those directions.
- Class permission mutation methods require `nServerID`; pass `-1` for a global permission or an explicit server ID to target one server. Native mutation functions do not accept a server-ID argument.
- Class permission matching is case-sensitive and covers the full string, including null characters. `*` matches any sequence, including line terminators, just as in the native matcher; `?` and other regular-expression punctuation are literal.

## Related files

- [`packages/sourcejs/auth/backends/sql.js`](../../packages/sourcejs/auth/backends/sql.js) defines `SQLBackend` and `SQL_BACKEND`.
- [`packages/sourcejs/auth/manager.js`](../../packages/sourcejs/auth/manager.js) creates the built-in backend with a `Manager` reference.
- [`packages/sourcejs/paths.js`](../../packages/sourcejs/paths.js) exposes `AUTH_SQL_FILE` and the flat-file paths.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs the native SQL authorization operations.
- [`packaging/runtime/cfg/sourcejs/auth/`](../../packaging/runtime/cfg/sourcejs/auth/) contains the packaged flat-file migration targets.
