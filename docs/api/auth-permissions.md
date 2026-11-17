# `require("auth/permissions")`

`auth/permissions` re-exports the canonical permission graph classes from `auth/manager`.

## Location and purpose

The re-export surface lives in [`packages/sourcejs/auth/permissions.js`](../../packages/sourcejs/auth/permissions.js), while the class implementations live in [`packages/sourcejs/auth/manager.js`](../../packages/sourcejs/auth/manager.js). Use this module when code needs permission nodes, stores, or the guest-parent constant without importing backend-selection names into its own API surface. The narrow entry point keeps every consumer on the same graph types and inheritance behavior as `AuthManager`.

## Import and exports

```js
const {
	GUEST_PARENT_NAME,
	ParentPermissionStore,
	ParentPermissions,
	PermissionBase,
	PermissionStore,
	PlayerPermissionStore,
	PlayerPermissions,
} = require("auth/permissions");
```

| Export | Kind |
| --- | --- |
| `GUEST_PARENT_NAME` | Constant: `"guest"`. |
| `ParentPermissionStore` / `PlayerPermissionStore` | Store classes. |
| `ParentPermissions` / `PlayerPermissions` | Permission-node classes. |
| `PermissionBase` / `PermissionStore` | Base classes. |

These are the same classes and constant value exported by `auth/manager`; this module does not wrap, subclass, or rename them.

## Construction

| Class | Signature |
| --- | --- |
| `PermissionBase` | `new PermissionBase(strName, Manager = null)` |
| `ParentPermissions` | `new ParentPermissions(strParentName, Manager = null)` |
| `PlayerPermissions` | `new PlayerPermissions(strPlayerName, strSteamID64, Manager = null)` |
| `PermissionStore` | `new PermissionStore()` |
| `ParentPermissionStore` / `PlayerPermissionStore` | `new ParentPermissionStore(Manager)` / `new PlayerPermissionStore(Manager)` |

## Example

```js
const { ParentPermissions } = require("auth/permissions");

const g_mapModerator = new ParentPermissions("moderator");
const g_Options = {};
const g_Callback = (OperationError) => {
	if (OperationError !== null) {
		throw OperationError;
	}
};

g_mapModerator.Add("sourcejs.kick", g_Options, g_Callback, null, false);

console.log(g_mapModerator.Name, g_mapModerator.Flatten(), g_mapModerator.Has("sourcejs.kick"));
```

## Safe use and common mistakes

For independent tests, construct a separate permission graph instead of mutating the shared one. The two stores below are detached collections; production code normally uses the stores on its manager.

```js
const {
	GUEST_PARENT_NAME,
	ParentPermissionStore,
	PermissionBase,
	PermissionStore,
	PlayerPermissionStore,
	PlayerPermissions,
} = require("auth/permissions");
const { AUTH_MANAGER, AuthManager } = require("auth/manager");

const g_mapTestManager = new AuthManager();
const g_mapParents = new ParentPermissionStore(g_mapTestManager);
const g_mapPlayers = new PlayerPermissionStore(g_mapTestManager);
const g_mapDetachedNodes = new PermissionStore();
const g_mapDetachedGuest = new PermissionBase(GUEST_PARENT_NAME);
const g_unExampleSteamID64 = 76_561_197_960_265_729n;
const g_mapDetachedPlayer = new PlayerPermissions("Example player", g_unExampleSteamID64.toString());

g_mapDetachedNodes.set(g_mapDetachedGuest.Name, g_mapDetachedGuest);
if ((g_mapParents.GetOrCreate(GUEST_PARENT_NAME).Name !== GUEST_PARENT_NAME)
	|| (g_mapPlayers.GetOrCreate(g_unExampleSteamID64).SteamID64 !== g_mapDetachedPlayer.SteamID64)
	|| (g_mapDetachedNodes.get(GUEST_PARENT_NAME) !== g_mapDetachedGuest)
	|| (g_mapTestManager === AUTH_MANAGER)) {
	throw new Error("The test permission graph was not isolated.");
}
```

- Importing this module still loads `auth/manager` and creates its `AUTH_MANAGER` singleton on first initialization; the narrower exports do not provide an independent graph implementation.
- Permission-node names and `PlayerPermissions` SteamID64 text must be non-empty strings.
- `ParentPermissionStore` and `PlayerPermissionStore` require a manager object so newly created nodes share the correct graph and backend lifecycle.
- Standalone nodes use the `AUTH_MANAGER` singleton from `auth/manager` for server targeting, parent lookup, and optional backend notification. Pass `bUpdateBackend = false`, as in the example, unless that shared manager has an intentional active backend.
- `Add(strPermission, Options, Callback, nServerID = null, bUpdateBackend = true)` and `Remove(strPermission, Options, Callback, nServerID = null, bUpdateBackend = true)` require the options object and callback. The server ID must be `null` or an integer, and the update flag must be boolean.
- `Options` must be a non-null, non-array object and `Callback` a function, including for `bUpdateBackend = false`. Invalid arguments throw before mutation. The example bypasses persistence and calls back inline; with persistence enabled, callback timing follows the selected backend. A persistence error does not roll back local changes.
- Permission matching is case-sensitive and covers the entire string, including null characters. `*` matches any sequence, including line terminators; `?` and other regular-expression punctuation are literal, consistently with native authorization matching.
- Built-in `HasPermission` and `Flatten` traverse inherited permissions depth-first without growing the JavaScript call stack. Cycles and shared ancestors use the supplied visited set; insertion order and short-circuit matching are preserved. Custom parent-method overrides are still called with the parent as receiver and remain responsible for their own recursion.
- A managed node automatically inherits the `guest` parent unless the node itself is `guest`. Use `GUEST_PARENT_NAME` instead of repeating the literal in integration code.

## Related files

- [`packages/sourcejs/auth/permissions.js`](../../packages/sourcejs/auth/permissions.js) defines the narrow re-export surface.
- [`packages/sourcejs/auth/manager.js`](../../packages/sourcejs/auth/manager.js) implements all exported graph classes.
- [`docs/api/auth-manager.md`](auth-manager.md) documents manager lifecycle, backend notifications, and inherited permission behavior.
