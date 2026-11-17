# `require("auth/backends/flatfile")`

`FlatFileBackend` adapts the native flat-file `auth` module to the shared
`Backend` lifecycle. `Load`, `Synchronize`, and mutation methods require an
`Options` object and error-first `Callback`. They reload native state, optionally
synchronize an `AuthManager`, or route mutations to native operations; successful
callbacks receive the native result. These operations attempt to save accepted
changes; `false` can indicate invalid input, an absent item to remove, or a save
failure.

> AI-agent navigation: check the member contract and safe-use notes before using
> the example. Callback syntax does not make native file IO asynchronous.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import and exports](#import-and-exports)
- [FlatFileBackend](#flatfilebackend)
- [Example](#example)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/auth/backends/flatfile.js`](../../packages/sourcejs/auth/backends/flatfile.js), while the packaged authorization files live under [`packaging/runtime/cfg/sourcejs/auth/`](../../packaging/runtime/cfg/sourcejs/auth/). Use this backend when player and parent authorization records should remain in the native flat-file store instead of a database. [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) owns parsing, record construction, mutation, and file saves; the JavaScript class owns manager synchronization and lifecycle state.

## Import and exports

```js
const { FLAT_FILE_BACKEND, FlatFileBackend } = require("auth/backends/flatfile");
```

| Export | Kind | Signature |
| --- | --- | --- |
| `FLAT_FILE_BACKEND` | Singleton | `FlatFileBackend` instance. |
| [`FlatFileBackend`](#flatfilebackend) | Class | `new FlatFileBackend(Options = {})` |

## `FlatFileBackend`

| Class or member | Signature or behavior |
| --- | --- |
| `BackendName` | Static string: `"flatfile"`. |
| `Options` | Static defaults: `{ Manager: null }`. |
| `Options` / `Loaded` | Inherited options and lifecycle state. |
| `Options.Manager` | Constructor option for the configured manager reference or `null`. Changing the merged options afterward does not rebind the backend. |
| `FlatFileBackend` | `new FlatFileBackend(Options = {})`; `Manager` must be `null` or have JavaScript type `"object"`. This check does not validate the manager interface. |
| `Load` | `Load(Options, Callback)`; calls native `auth.Reload()`, synchronizes the configured manager, sets `Loaded` to `true`, and calls back with `(null, AuthorizationState)`. |
| `Unload` | `Unload(Options, Callback)`; sets `Loaded` to `false` and calls back with `(null, true)`. |
| `Synchronize` | `Synchronize(Options, Callback)`; reloads native state, synchronizes the configured manager, and calls back with `(null, AuthorizationState)` without changing `Loaded`. |
| `Save` | `Save(Options, Callback)`; calls native `auth.Save()` and calls back with `(null, bSaveResult)`. |
| `SynchronizeManager` | `SynchronizeManager(AuthorizationState)`; returns the state unchanged when no manager is configured. Otherwise clears and rebuilds the manager's parent and player stores. A failure can leave them partially rebuilt; there is no rollback. |
| `PermissionAdded` / `PermissionRemoved` | `(Node, strPermission, nServerID, Options, Callback)`; route to the matching native player or parent permission operation and pass its result to the callback. |
| `ParentAdded` / `ParentRemoved` | `(Node, strParentName, Options, Callback)`; route to the matching native player-parent or parent-inheritance operation and pass its result to the callback. |

## Example

These checks use the named imports above and do not read authorization files:

| Use | Example |
| --- | --- |
| Inspect whether the shared adapter is loaded. | `const bSharedBackendLoaded = FLAT_FILE_BACKEND.Loaded;` |
| Allocate a separate adapter without attaching a manager. | `const DetachedBackend = new FlatFileBackend();` |

```js
const { AuthManager } = require("auth/manager");

const g_mapManager = new AuthManager();
g_mapManager.FindAndAddAvailableBackends();

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

async function RunFlatFileExample() {
	await RunAuthOperation((Callback) => g_mapManager.SetActiveBackend("flatfile", {}, Callback));

	try {
		console.log(g_mapManager.Parents.size, g_mapManager.Players.size);
	} finally {
		await RunAuthOperation((Callback) => g_mapManager.Unload({}, Callback));
	}
}

RunFlatFileExample().catch(console.error);
```

## Safe use and common mistakes

- Per-call `Options` must be a non-null, non-array object, and `Callback` must be a function. Invalid arguments throw synchronously before native work. Constructor options configure the manager; they do not replace these required per-call arguments.
- Flat-file operations and their callbacks run inline on the calling JavaScript thread. A callback-shaped API or the example's `Promise` wrapper does not move file IO to a worker. Per-call options currently select no execution mode; `Blocking: false` does not make this backend asynchronous. Use the SQL backend when a worker-backed store is required.
- Native or synchronization failures reach `Callback(OperationError)`; success uses `Callback(null, Result)`. Falsy thrown values are wrapped in an `AggregateError` whose `errors[0]` preserves the original value, so a thrown `null` cannot be mistaken for success. Truthy failures retain their identity. A callback exception propagates to the caller. Await the wrapper before reading synchronized manager state or unloading it.
- `FLAT_FILE_BACKEND` has no manager reference. `AuthManager.FindAndAddAvailableBackends()` creates a separate `FlatFileBackend({ Manager })`; pass the same option when constructing one manually for manager synchronization.
- `Load(Options, Callback)` and `Synchronize(Options, Callback)` both call native `Reload()`, rebuild a configured manager, and pass a newly constructed state object containing `Parents`, `Players`, and native metadata to the callback. `Synchronize` leaves `Loaded` unchanged.
- Use the runtime's PascalCase state keys `Parents` and `Players` and record keys `Name`, `Permissions`, and `Parents`; the package preserves these public names.
- Native records and their dictionaries use own data properties. Names containing null characters remain distinct, and a record named `__proto__` does not replace the dictionary's prototype. Use `Object.hasOwn()` or own-key enumeration when testing dictionary membership.
- Player nodes are identified by a non-empty string `SteamID64`; otherwise, parent nodes require a non-empty string `Name`. A callback rejects values that provide neither identity.
- Mutation callbacks call one of `AddPlayerPermission`, `RemovePlayerPermission`, `AddPlayerParent`, `RemovePlayerParent`, `AddParentPermission`, `RemoveParentPermission`, `AddParentParent`, or `RemoveParentParent`. Each native operation owns the required load/mutate/save work and returns a boolean through the error-first callback; the backend does not call `Save()` again.
- Saves write player and parent records separately, without a transaction spanning both files. A `false` result can therefore leave one file updated; do not interpret failure as a rollback.
- A failed native file load or invalid JSON syntax stops query, mutation, and save operations before they consume or persist partial state. `FlatFileBackend` passes the native exception to its error-first callback. This does not make the subsequent two-file save atomic.
- Native flat-file reload, query, permission/parent mutation, and `Save` callbacks preserve JavaScript conversion errors and translate C++ failures into JavaScript errors. Parent permission traversal retains depth-first order and cycle detection without recursive calls; direct player permissions, the `guest` fallback, and simple-administrator grants are unchanged.
- `PermissionAdded` and `PermissionRemoved` require `nServerID` to be an integer or `null`, but native flat-file mutation operations do not accept a server-ID argument. These values are not represented in this backend's file format.
- `FlatFileBackend.Unload(Options, Callback)` clears only the backend's JavaScript loaded flag; it does not clear manager stores or delete authorization files. `AuthManager.Unload(Options, Callback)` clears its stores after unloading the active backend.

## Related files

- [`packages/sourcejs/auth/backends/flatfile.js`](../../packages/sourcejs/auth/backends/flatfile.js) defines the class and singleton.
- [`packages/sourcejs/auth/manager.js`](../../packages/sourcejs/auth/manager.js) creates a manager-bound built-in instance and coordinates its lifecycle.
- [`packages/sourcejs/auth.js`](../../packages/sourcejs/auth.js) exposes the same native authorization object to package consumers.
- [`packaging/runtime/cfg/sourcejs/auth/`](../../packaging/runtime/cfg/sourcejs/auth/) contains the packaged flat-file templates.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs all native reload, query, mutation, and save operations used by the backend.
