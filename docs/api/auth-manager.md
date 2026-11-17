# `require("auth/manager")`

> Warning: this file is dense API documentation. Use the section links below when reviewing manager, store, and permission-node responsibilities.

`auth/manager` provides the JavaScript in-memory permission graph. It can rebuild that graph from the native `auth` module or delegate lifecycle and persistence callbacks to a selected JavaScript `Backend` instance.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import and exports](#import-and-exports)
- [`AuthManager`](#authmanager)
- [Permission classes](#permission-classes)
- [Example](#example)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/auth/manager.js`](../../packages/sourcejs/auth/manager.js). Use `AuthManager` when code needs one in-memory graph for player permissions, parent inheritance, server targeting, and backend notifications. The manager uses the native `auth` module for player-index conversion and its no-backend refresh path. Built-in backend discovery creates a `FlatFileBackend` over that native state and a SOCI-backed `SQLBackend`; both instances receive a reference to the manager so their load and sync operations can rebuild its stores. Centralizing these responsibilities keeps wildcard matching, SteamID normalization, inherited traversal, and persistence callbacks consistent.

## Import and exports

```js
const {
	AUTH_MANAGER,
	AuthManager,
	GUEST_PARENT_NAME,
	ParentPermissionStore,
	ParentPermissions,
	PermissionBase,
	PermissionStore,
	PlayerPermissionStore,
	PlayerPermissions,
} = require("auth/manager");
```

| Export | Kind |
| --- | --- |
| `AUTH_MANAGER` | Singleton `AuthManager`. |
| [`AuthManager`](#authmanager) | Class. |
| `GUEST_PARENT_NAME` | Constant: `"guest"`. |
| `ParentPermissionStore` / `PlayerPermissionStore` | Store classes. |
| `ParentPermissions` / `PlayerPermissions` | Permission-node classes. |
| `PermissionBase` / `PermissionStore` | Base classes. |

The module creates `AUTH_MANAGER` when it is imported. Each `AuthManager` extends `Map`; `AddBackend()` validates a `Backend` instance and registers it under its lower-case name. Use the manager's backend methods rather than inherited `Map` mutation methods, which bypass that validation and lifecycle coordination.

## `AuthManager`

| Class or member | Signature or behavior |
| --- | --- |
| `AuthManager` | `new AuthManager()` |
| `Parents` / `Players` | Getter-only properties returning the manager's mutable stores, not copies. |
| `ActiveBackend` | Read-only active-backend getter. |
| `ServerID` | Get/set server ID; the setter rejects non-integers. |
| `AddBackend` | `AddBackend(BackendInstance)`; validates, stores, and returns the backend. Replaces an existing same-name map entry without unloading it or changing the active-backend reference. |
| `FindAndAddAvailableBackends` | `FindAndAddAvailableBackends(vecBackends = null)`; with `null`, creates manager-bound flat-file and SQL backends; otherwise accepts an array. Registers each backend and returns the added instances. |
| `SetActiveBackend` | `SetActiveBackend(strBackendName, Options, Callback)`; unloads the active backend, then loads the selected backend. The error-first callback receives `(null, BackendInstance)` on success. This is not atomic: a failed load does not restore the old backend. |
| `UnloadActiveBackend` | `UnloadActiveBackend(Options, Callback)`; unloads the active backend if present, clears both stores and the active reference, then calls the error-first callback with `(null, true)`. An unload error is reported before manager cleanup. |
| `Load` | `Load(strBackendName, Options, Callback)`; with a non-null name, selects a backend through its callback API; with `null`, reloads/imports native `auth` state and calls back with this manager. The native path does not unload or deselect an active backend. |
| `Unload` | `Unload(Options, Callback)`; delegates to `UnloadActiveBackend` and forwards its error-first callback result. |
| `Synchronize` | `Synchronize(Options, Callback)`; delegates to the active backend or rebuilds stores from native `auth` state and calls back with the error or resulting state. |
| `IsBackendLoaded` | `IsBackendLoaded(strBackendName)`; compares the active backend's normalized name, not its `Loaded` flag; returns `false` if no backend is active. |
| `GetPlayerPermissions` | `GetPlayerPermissions(unClientIndex)`; resolves the native network ID and gets or creates its permission node. |
| `GetPlayerPermissionsFromSteamID` | `GetPlayerPermissionsFromSteamID(Value)`; gets or creates a normalized player's permission node. Accepts a SteamID string or an unsigned 64-bit `BigInt` (`0n` through `0xFFFFFFFFFFFFFFFFn`); a trimmed, case-insensitive `"BOT"` string returns `null`. Numeric `Number` inputs and out-of-range `BigInt` values are rejected before creating a node. |
| `IsPlayerAuthorized` | `IsPlayerAuthorized(unClientIndex, strPermission)`; returns `false` for a missing player node, otherwise checks its permissions. Errors from native player-index resolution or permission validation propagate; this is not a catch-all boolean validity check. |
| `GetParentPermissions` | `GetParentPermissions(strParentName)`; gets or creates the parent node. |
| `IsParentAuthorized` | `IsParentAuthorized(strParentName, strPermission)`; gets or creates the parent node and checks its permissions. |
| `TargetsThisServer` | `TargetsThisServer(nServerID)`; accepts `null`, `-1`, or this manager's server ID; rejects non-integer, non-null input. |
| `RefreshFromRuntime` | `RefreshFromRuntime()`; clears both stores, imports native records without persistence callbacks, skips player identities normalized to `null` (`BOT`), and returns this manager. An exception can leave a partially rebuilt graph; previous stores are not restored. |

## Permission classes

| Class or member | Signature or behavior |
| --- | --- |
| `PermissionBase` | `new PermissionBase(strName, Manager = null)`; a `Map` from permission text to compiled matchers. With a manager, every node not named `guest` automatically inherits that manager's `guest` parent without a persistence callback. |
| `Name` / `Manager` / `Parents` | Read-only getters for the node name, manager reference, and mutable parent `Set`. |
| `Add` / `Remove` | `(strPermission, Options, Callback, nServerID = null, bUpdateBackend = true)`; require an options object and error-first callback. The callback receives `(null, Node)` on success. Local permissions change only when the server ID targets this manager; backend notification still runs when enabled and requires an active backend. An asynchronous backend error does not roll back an earlier in-memory change. |
| `AddParent` / `RemoveParent` | `(strParentName, Options, Callback, bUpdateBackend = true)`; require an options object and error-first callback, and call back with `(null, Node)` on success. They update both relationship directions before backend notification; an asynchronous error does not roll back local changes. |
| `Has` | `Has(strPermission)`; alias for inherited-aware `HasPermission`. |
| `HasDirectPermission` | `HasDirectPermission(strPermission)`; checks only this node's exact stored key. |
| `HasPermission` | `HasPermission(strPermission, setVisited = new Set())`; evaluates local wildcard matchers and then inherited parents while preventing cycles. |
| `Flatten` | `Flatten(setVisited = new Set())`; returns an array of stored permission text from this node and reachable parents. Each node is visited once, but identical permission strings on different nodes can appear more than once. |
| `Clear` | Removes permissions and parent links without persistence callbacks and returns this node. |
| `ParentPermissions` | `new ParentPermissions(strParentName, Manager = null)`; adds `Children` and removes child links in `Clear`. |
| `PlayerPermissions` | `new PlayerPermissions(strPlayerName, strSteamID64, Manager = null)`; adds `SteamID64`. This constructor only checks for a non-empty string; use the player store or manager for SteamID normalization. |
| `PermissionStore` | A `Map` whose `Clear()` clears every contained node and then the map; returns `undefined`, unlike a node's `Clear()`. |
| `ParentPermissionStore` | `new ParentPermissionStore(Manager)`; `GetOrCreate(strParentName)` returns a parent node. |
| `PlayerPermissionStore` | `new PlayerPermissionStore(Manager)`; `GetOrCreate(Value)` returns a player node or `null` for `BOT`, with the same SteamID normalization and unsigned 64-bit bounds as the manager. |

`Add`, `Remove`, `AddParent`, and `RemoveParent` update applicable in-memory
permissions or relationships before notifying the backend when `bUpdateBackend`
is `true`. Their required error-first callbacks report persistence failures;
earlier in-memory changes are not rolled back. A successful callback receives
the node, but local success alone does not prove persistence succeeded. `Clear()`
does not notify the backend.

## Example

The first `SetActiveBackend` call uses `Blocking: true` to complete backend
synchronization before that call returns. Later mutation and cleanup calls
still use asynchronous callbacks. For startup that depends on the whole
sequence, await the promise returned by `RunAuthExample`; calling it alone
does not wait for the later operations.

```js
const { AuthManager } = require("auth/manager");
const { SQLBackend } = require("auth/backends/sql");
const { AUTH_SQL_FILE } = require("paths");

const g_mapManager = new AuthManager();
const g_strManagerDatabasePath = `${AUTH_SQL_FILE}.manager.sqlite3`;
const g_Backend = new SQLBackend({ Manager: g_mapManager, DatabasePath: g_strManagerDatabasePath });
g_mapManager.AddBackend(g_Backend);

function RunAuthOperation(CallbackAction) {
	return new Promise((Resolve, Reject) => {
		CallbackAction((OperationError, Result) => {
			if (OperationError !== null) {
				Reject(OperationError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function RunAuthExample() {
	try {
		await RunAuthOperation((Callback) => g_mapManager.SetActiveBackend("sql", { Blocking: true }, Callback));

		const mapModerator = g_mapManager.GetParentPermissions("moderator");
		await RunAuthOperation((Callback) => mapModerator.Add("sourcejs.kick", {}, Callback));
		console.log(g_mapManager.IsParentAuthorized("moderator", "sourcejs.kick"));
	} finally {
		if (g_mapManager.ActiveBackend === g_Backend) {
			await RunAuthOperation((Callback) => g_mapManager.Unload({}, Callback));
		} else {
			await RunAuthOperation((Callback) => g_Backend.Unload({}, Callback));
		}
	}
}

RunAuthExample().catch(console.error);
```

## Safe use and common mistakes

- Lifecycle and permission mutations require a non-null, non-array `Options` object and a function `Callback`. Invalid arguments throw before the operation; constructor/backend configuration does not replace per-call options.
- Callback timing follows the selected backend: native-only refresh and flat-file operations complete inline, while SOCI requests normally defer completion. `Blocking: true` waits for related SOCI work and callback delivery on the game thread; it does not turn synchronous file IO into a worker request. Sequence dependent operations and backend switches through completion callbacks; do not overlap lifecycle changes on one manager.
- Exceptions from native-only `Load` and `Synchronize` are reported through their error-first callback. Falsy thrown values are wrapped in an `AggregateError`, with the original value in `errors[0]`, so an operation failure cannot look like success. Truthy thrown values and exceptions from the caller's callback retain their identity.
- This example creates or opens a separate SQLite database and persists a
  permission. `Blocking: true` waits for the initial synchronization, not the
  entire `async` function; later mutation and cleanup use asynchronous callbacks.
  Await the example's promise when those operations must precede startup.
  Successful `Unload` closes the backend and clears manager stores, but does not
  undo the database change.
- A new `AuthManager` has empty stores and no active backend. Call
  `FindAndAddAvailableBackends` before selecting a built-in backend, or add an
  explicit `Backend` instance with `AddBackend`.
- `Load(null, Options, Callback)` calls native `auth.Reload()` and then
  `RefreshFromRuntime()`. It does not change `ActiveBackend`, so unload a
  selected backend first when the native-only path must replace it.
  `Synchronize(Options, Callback)` with no active backend refreshes stores
  through native `Parents()` and `Players()`; those queries load flat-file
  state, so this is not an in-memory-only refresh.
- `SetActiveBackend` marks the selected backend active only after its `Load`
  callback succeeds. Backends must synchronize through their configured
  `Manager`. The instances created by `FindAndAddAvailableBackends()` do so;
  pass `Manager` when adding a manually constructed flat-file or SQL backend
  that must populate this manager.
- Built-in SQL discovery uses `paths.AUTH_SQL_FILE`, also the native SQL-text
  state path even though `SQLBackend` expects a SOCI database. Supply a distinct
  `DatabasePath` when selecting SQL in a process that may use native SQL
  authorization functions.
- `ServerID` must be an integer and defaults to `-1`. `TargetsThisServer` accepts
  `null` or an integer and treats `null`, `-1`, and the current `ServerID` as
  matching this manager.
- `GetPlayerPermissionsFromSteamID` accepts a parseable non-empty SteamID string
  or an unsigned 64-bit `BigInt` (`0n` through `0xFFFFFFFFFFFFFFFFn`). Numeric
  `Number` inputs and out-of-range `BigInt` values are rejected without creating
  a permission node. The special value `BOT` resolves to `null` instead.
- Permission and parent mutations require `Options` and `Callback`, and call the
  active backend by default. Without an active backend, the callback reports an
  error; use `bUpdateBackend = false` only for an intentionally in-memory
  change. A standalone node without a manager falls back to `AUTH_MANAGER`.
- The flat-file backend routes mutations to native add/remove functions, which
  do not accept a server ID. Use SQL when persisted permissions must retain
  distinct `nServerID` values.
- Every non-guest node created with a manager automatically inherits that
  manager's `guest` parent. `GetParentPermissions` and `IsParentAuthorized`
  create a missing parent node as part of lookup.
- Permission matching is case-sensitive and covers the entire string, including null characters. `*` matches any sequence, including line terminators, consistently with native authorization matching. Other regular-expression punctuation is escaped and matched literally; `?` is not a wildcard.
- `Flatten` prevents inheritance cycles by tracking visited nodes, but it does not deduplicate equal permission text stored on different nodes.
- Pair an explicitly selected backend with callback-completed `Unload` in
  `finally`. If its `Load` callback reports an error before it becomes active,
  the manager does not unload that candidate; retain the backend reference and
  close it directly, as in the example.

## Related files

- [`packages/sourcejs/auth/manager.js`](../../packages/sourcejs/auth/manager.js) defines the manager, stores, nodes, and singleton.
- [`packages/sourcejs/auth/index.js`](../../packages/sourcejs/auth/index.js) defines the common backend contract.
- [`packages/sourcejs/auth/backends/flatfile.js`](../../packages/sourcejs/auth/backends/flatfile.js) synchronizes the manager and routes callbacks to native flat-file mutations.
- [`packages/sourcejs/auth/backends/sql.js`](../../packages/sourcejs/auth/backends/sql.js) implements SOCI-backed persistence and manager synchronization.
- [`packages/sourcejs/paths.js`](../../packages/sourcejs/paths.js) exposes the default authorization storage paths used by the example and built-in backends.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs the native `auth` operations used for player indices, flat-file state, and no-backend refreshes.
