# `require("auth")`

`auth` is the direct native authorization module with the `Backend` and `SQLBackend` classes attached. Native operations are exposed under their canonical names; the package does not create lower-case or `*Auth` aliases.

## Location and purpose

The public entry point lives in [`packages/sourcejs/auth.js`](../../packages/sourcejs/auth.js). It retrieves the shared native `auth` runtime and attaches the JavaScript backend classes from [`packages/sourcejs/auth/`](../../packages/sourcejs/auth/). Server packages use this module when they need player or parent records, inherited permissions, backend integration, or explicit authorization-state persistence. Keeping one direct bridge ensures that every consumer uses the same native state, record shape, and canonical operation names.

## Import

```js
const { Backend, SQLBackend } = require("auth");
```

## Exports

| Export | Kind |
| --- | --- |
| `Backend` | Base backend class. |
| `SQLBackend` | SQL backend class. |
| `NetworkID` | `NetworkID(nPlayerIndex)`; returns the player's network identifier string; invalid or unavailable players can throw. |
| `Reload` / `Save` | `Reload()` reads and returns native authorization state. `Save()` rereads the files, writes that state, and returns a boolean; it does not save edits to previously returned JavaScript objects. |
| `Players` / `Parents` | `Players()` / `Parents()`; read and return dictionaries of native player or parent records. |
| `GetPlayer` / `GetParent` | `GetPlayer(Subject?)` / `GetParent(strParentName?)`; return a record or `null` when no record matches. |
| `HasPlayerPermission` / `HasParentPermission` | `HasPlayerPermission(Subject, strPermission)` / `HasParentPermission(strParentName, strPermission)`; return booleans for direct or inherited permissions. |
| `AddPlayerPermission` / `RemovePlayerPermission` | `(Subject, strPermission)`; native player permission operations. |
| `AddPlayerParent` / `RemovePlayerParent` | `(Subject, strParentName)`; native player-parent operations. |
| `AddParentPermission` / `RemoveParentPermission` | `(strParentName, strPermission)`; native parent permission operations. |
| `AddParentParent` / `RemoveParentParent` | `(strParentName, strInheritedParentName)`; native parent-inheritance operations. |

All eight native add/remove operations return a boolean on normal completion. `false` can indicate invalid input, a missing item to remove, or a save failure. Player and parent files are written separately, so failure does not guarantee rollback.

| Use | Example |
| --- | --- |
| Inspect the backend identifier without connecting to a database. Import `SQLBackend` from `auth`. | `const strBackendName = SQLBackend.BackendName;` |

Each record in the `Players()` and `Parents()` dictionaries, or returned by `GetPlayer()` and `GetParent()`, uses the native fields `Name`, `Permissions`, and `Parents`.

The native initializers for `auth` and `auth/backends/sql` define their declared methods as own writable, enumerable, configurable data properties on fresh ordinary objects. Inherited accessors and read-only properties with those method names do not intercept installation. This applies to the native methods, not to package-added `Backend` / `SQLBackend` classes or arbitrary wrapper properties.

## Example

This example requires a valid player at index `1` and persists authorization changes. Resolve the player before writing; the two mutations are not one transaction.

```js
const { AddParentPermission, AddPlayerParent, HasPlayerPermission, NetworkID } = require("auth");

const g_strNetworkID = NetworkID(1);

if (!AddParentPermission("moderator", "sourcejs.kick")) {
	throw new Error("Unable to save the parent permission.");
}

if (!AddPlayerParent(g_strNetworkID, "moderator")) {
	throw new Error("Unable to save the player's parent relationship.");
}

if (HasPlayerPermission(g_strNetworkID, "sourcejs.kick")) {
	console.log("Player 1 may use the kick permission.");
}
```

## Safe use and common mistakes

- Use the exported `PascalCase` names exactly; lower-case and `*Auth` aliases do not exist.
- Native authorization functions run synchronously on the calling JavaScript thread, including file IO. They return values or throw; they do not accept the request `Options` and `Callback` required by the separate backend classes. A callback-shaped backend API does not make these native functions asynchronous.
- Pass a current player index to `NetworkID`, then use the returned network identifier with player-oriented record and permission operations.
- A subject supplied as a signed 32-bit integer is resolved as a player index only in `1..maxClients`, with an available engine and globals and a non-free player edict. Invalid or unavailable indices resolve to an empty subject without querying a non-player edict's network identifier; the surrounding operation still applies its own input/result contract. `NetworkID(nPlayerIndex)` has the separate error contract listed above.
- Check the boolean result of every native add/remove operation. `false` does not guarantee unchanged files: a save can update one file before failing on another.
- `Players()` and `Parents()` return collections keyed by identifier; their values and individual `GetPlayer()` / `GetParent()` results are records with `Name`, `Permissions`, and `Parents`. Individual queries return `null` for a missing record; do not assume lowercase aliases.
- Record names, including `__proto__` and names containing null characters, are own data properties. Use `Object.hasOwn()` or own-key enumeration rather than inherited-property lookup to test dictionary membership.
- Permission matching is case-sensitive and covers the full string, including null characters. Only `*` is a wildcard, including across line terminators; `?` is literal.
- `Reload()` reads the authorization files and returns a new state object. `Save()` loads the files again and writes that loaded state; it does not persist edits made to previously returned JavaScript records. Use the mutation operations for intentional record changes.

## Related files

- [`packages/sourcejs/auth.js`](../../packages/sourcejs/auth.js) defines the public module entry point.
- [`packages/sourcejs/auth/index.js`](../../packages/sourcejs/auth/index.js) defines the JavaScript backend surface.
- [`packages/sourcejs/auth/backends/`](../../packages/sourcejs/auth/backends/) contains the bundled backend implementations.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs the native authorization operations.
- [`packaging/runtime/cfg/sourcejs/auth/`](../../packaging/runtime/cfg/sourcejs/auth/) contains the packaged authorization configuration templates.
