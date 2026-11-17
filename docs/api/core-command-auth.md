# `require("core/command/auth")`

> Warning: This API reference is large for AI-agent processing. Use the table of contents to navigate directly to the
> relevant section.

> This page is maintained by hand. Mutating examples pair each successful change with cleanup and report cleanup failures.

Player subjects use the identities accepted by `auth`; examples use explicit network-ID strings such as Steam2 IDs. Choose
non-empty parent-name and permission strings. A successful grant reports that authorization state was saved, not that the grant
was newly added, so success alone does not justify revoking it during cleanup.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/core/command/auth.js`](../../packages/sourcejs/core/command/auth.js). It wraps the
`auth` runtime with command-facing permission, parent-membership, state-printing, and permission-test helpers. Requiring the module
also registers 11 built-in authorization command paths on the shared `CORE_COMMAND` instance. Use these helpers when a command
plugin needs to inspect or temporarily change authorization state. Check every mutating result. For temporary changes, preserve
the prior state and undo only changes introduced by the operation; do not revoke an existing grant or remove an existing membership.

## Import

```js
const { GrantPlayerPermission, RevokePlayerPermission, TestPermission } = require("core/command/auth");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`MODULE_NAME`](#module_name) | Constant | JavaScript module name, `"core/command/auth"`. |
| [`AddParentToParent`](#addparenttoparent) | Function | `AddParentToParent(strParentName, strInheritedParentName)` |
| [`AddPlayerToParent`](#addplayertoparent) | Function | `AddPlayerToParent(Subject, strParentName)` |
| `DispatchAuthenticationCommand` | Function | `DispatchAuthenticationCommand(vecArguments)` validates the tokenized `auth` command, shows help or dispatches the selected operation, and returns `undefined`. Invalid arguments log a warning before dispatch. |
| [`GrantParentPermission`](#grantparentpermission) | Function | `GrantParentPermission(strParentName, strPermission)` |
| [`GrantPlayerPermission`](#grantplayerpermission) | Function | `GrantPlayerPermission(Subject, strPermission)` |
| [`PrintAuthParents`](#printauthparents) | Function | `PrintAuthParents()` |
| [`PrintAuthPlayers`](#printauthplayers) | Function | `PrintAuthPlayers()` |
| [`RemoveParentFromParent`](#removeparentfromparent) | Function | `RemoveParentFromParent(strParentName, strInheritedParentName)` |
| [`RemovePlayerFromParent`](#removeplayerfromparent) | Function | `RemovePlayerFromParent(Subject, strParentName)` |
| [`RevokeParentPermission`](#revokeparentpermission) | Function | `RevokeParentPermission(strParentName, strPermission)` |
| [`RevokePlayerPermission`](#revokeplayerpermission) | Function | `RevokePlayerPermission(Subject, strPermission)` |
| [`TestPermission`](#testpermission) | Function | `TestPermission(Subject, strPermission)` |

## Examples

The following statements use named imports from `core/command/auth` on the server console path. Neither example writes permissions.

| Use | Example |
| --- | --- |
| Show help for the authorization command. | `DispatchAuthenticationCommand(["auth"]);` |
| Confirm which module owns the command. | `const bIsAuthenticationCommandModule = (MODULE_NAME === "core/command/auth");` |

### `AddParentToParent`

```js
const { AddParentToParent, RemoveParentFromParent } = require("core/command/auth");
const { GetParent } = require("auth");

const g_strParentName = "match_admin";
const g_strInheritedParentName = "moderator";

let g_bAddedInheritance = false;

function UnloadPlugin() {
	if (!g_bAddedInheritance) {
		return true;
	}

	if (!RemoveParentFromParent(g_strParentName, g_strInheritedParentName)) {
		throw new Error("Unable to restore the parent inheritance; manual cleanup is required.");
	}

	g_bAddedInheritance = false;

	return true;
}

exports.Unload = UnloadPlugin;

// Use an existing parent in an isolated test configuration with no concurrent writers.
const g_ParentRecord = GetParent(g_strParentName);
if ((g_ParentRecord === null) || (typeof g_ParentRecord !== "object") || !Array.isArray(g_ParentRecord.Parents)) {
	throw new Error("An existing parent record is required for this example.");
}

if (!g_ParentRecord.Parents.includes(g_strInheritedParentName)) {
	if (!AddParentToParent(g_strParentName, g_strInheritedParentName)) {
		throw new Error(`Unable to make ${g_strParentName} inherit ${g_strInheritedParentName}.`);
	}

	g_bAddedInheritance = true;
}
```

### `AddPlayerToParent`

```js
const { AddPlayerToParent, RemovePlayerFromParent } = require("core/command/auth");
const { GetPlayer } = require("auth");

const g_strPlayerSubject = "STEAM_1:1:12345";
const g_strParentName = "match_admin";

let g_bAddedMembership = false;

function UnloadPlugin() {
	if (!g_bAddedMembership) {
		return true;
	}

	if (!RemovePlayerFromParent(g_strPlayerSubject, g_strParentName)) {
		throw new Error("Unable to restore the player membership; manual cleanup is required.");
	}

	g_bAddedMembership = false;

	return true;
}

exports.Unload = UnloadPlugin;

// Use an existing player record in an isolated configuration with no concurrent writers.
const g_PlayerRecord = GetPlayer(g_strPlayerSubject);
if ((g_PlayerRecord === null) || (typeof g_PlayerRecord !== "object") || !Array.isArray(g_PlayerRecord.Parents)) {
	throw new Error("An existing player record is required for this example.");
}

if (!g_PlayerRecord.Parents.includes(g_strParentName)) {
	if (!AddPlayerToParent(g_strPlayerSubject, g_strParentName)) {
		throw new Error(`Unable to assign ${g_strPlayerSubject} to ${g_strParentName}.`);
	}

	g_bAddedMembership = true;
}
```

### `GrantParentPermission`

```js
const { GrantParentPermission, RevokeParentPermission } = require("core/command/auth");
const { GetParent } = require("auth");

const g_strParentName = "match_admin";
const g_strPermission = "sourcejs.match.start";

// Use an existing parent in an isolated test configuration with no concurrent writers.
const g_ParentRecord = GetParent(g_strParentName);
if ((g_ParentRecord === null) || (typeof g_ParentRecord !== "object") || !Array.isArray(g_ParentRecord.Permissions)) {
	throw new Error("An existing parent record is required for this example.");
}

const g_bHadDirectPermission = g_ParentRecord.Permissions.includes(g_strPermission);
if (!g_bHadDirectPermission) {
	if (!GrantParentPermission(g_strParentName, g_strPermission)) {
		throw new Error(`Unable to grant ${g_strPermission} to ${g_strParentName}.`);
	}
}

try {
	console.log(`${g_strParentName} may now start matches.`);
} finally {
	if (!g_bHadDirectPermission && !RevokeParentPermission(g_strParentName, g_strPermission)) {
		throw new Error(`Unable to revoke ${g_strPermission} from ${g_strParentName} during cleanup.`);
	}
}
```

### `GrantPlayerPermission`

```js
const { GrantPlayerPermission, RevokePlayerPermission } = require("core/command/auth");
const { GetPlayer } = require("auth");

const g_strPlayerSubject = "STEAM_1:1:12345";
const g_strPermission = "sourcejs.match.pause";

// Use an existing player record in an isolated configuration with no concurrent writers.
const g_PlayerRecord = GetPlayer(g_strPlayerSubject);
if ((g_PlayerRecord === null) || (typeof g_PlayerRecord !== "object") || !Array.isArray(g_PlayerRecord.Permissions)) {
	throw new Error("An existing player record is required for this example.");
}

const g_bHadDirectPermission = g_PlayerRecord.Permissions.includes(g_strPermission);
if (!g_bHadDirectPermission) {
	if (!GrantPlayerPermission(g_strPlayerSubject, g_strPermission)) {
		throw new Error(`Unable to grant ${g_strPermission} to ${g_strPlayerSubject}.`);
	}
}

try {
	console.log(`${g_strPlayerSubject} may now pause matches.`);
} finally {
	if (!g_bHadDirectPermission && !RevokePlayerPermission(g_strPlayerSubject, g_strPermission)) {
		throw new Error(`Unable to revoke ${g_strPermission} from ${g_strPlayerSubject} during cleanup.`);
	}
}
```

### `MODULE_NAME`

```js
const { MODULE_NAME } = require("core/command/auth");

console.log(`Authorization command helpers: ${MODULE_NAME}`);
```

### `PrintAuthParents`

This call logs the complete returned parent-authorization records before returning them. Use it only in a trusted diagnostic context where those records may be disclosed.

```js
const { PrintAuthParents } = require("core/command/auth");

const g_AuthParents = PrintAuthParents();
console.log(`Configured parent groups: ${Object.keys(g_AuthParents).join(", ") || "none"}`);
```

### `PrintAuthPlayers`

This call logs the complete returned player-authorization records, including player identifiers; printing only a count afterward does not prevent that disclosure.

```js
const { PrintAuthPlayers } = require("core/command/auth");

const g_AuthPlayers = PrintAuthPlayers();
console.log(`Players with explicit authorization: ${Object.keys(g_AuthPlayers).length}`);
```

### `RemoveParentFromParent`

```js
const { AddParentToParent, RemoveParentFromParent } = require("core/command/auth");
const { GetParent } = require("auth");

const g_strParentName = "match_admin";
const g_strInheritedParentName = "moderator";

// Run only in an isolated configuration with no concurrent authorization changes.
const g_ParentRecord = GetParent(g_strParentName);
if ((g_ParentRecord === null) || (typeof g_ParentRecord !== "object") || !Array.isArray(g_ParentRecord.Parents)) {
	throw new Error("An existing parent record is required for this example.");
}

if (g_ParentRecord.Parents.includes(g_strInheritedParentName)) {
	throw new Error("Choose an inheritance that does not already exist; this example removes it.");
}

if (!AddParentToParent(g_strParentName, g_strInheritedParentName)) {
	throw new Error(`Unable to make ${g_strParentName} inherit ${g_strInheritedParentName}.`);
}

const g_bParentRemoved = RemoveParentFromParent(g_strParentName, g_strInheritedParentName);
if (!g_bParentRemoved) {
	throw new Error(`Unable to remove inherited parent ${g_strInheritedParentName} from ${g_strParentName}.`);
}

console.log(`Removed inherited parent: ${g_bParentRemoved}`);
```

### `RemovePlayerFromParent`

```js
const { AddPlayerToParent, RemovePlayerFromParent } = require("core/command/auth");
const { GetPlayer } = require("auth");

const g_strPlayerSubject = "STEAM_1:1:12345";
const g_strParentName = "match_admin";

// Run only in an isolated configuration with no concurrent authorization changes.
const g_PlayerRecord = GetPlayer(g_strPlayerSubject);
if ((g_PlayerRecord === null) || (typeof g_PlayerRecord !== "object") || !Array.isArray(g_PlayerRecord.Parents)) {
	throw new Error("An existing player record is required for this example.");
}

if (g_PlayerRecord.Parents.includes(g_strParentName)) {
	throw new Error("Choose a membership that does not already exist; this example removes it.");
}

if (!AddPlayerToParent(g_strPlayerSubject, g_strParentName)) {
	throw new Error(`Unable to assign ${g_strPlayerSubject} to ${g_strParentName}.`);
}

const g_bPlayerRemoved = RemovePlayerFromParent(g_strPlayerSubject, g_strParentName);
if (!g_bPlayerRemoved) {
	throw new Error(`Unable to remove ${g_strPlayerSubject} from ${g_strParentName}.`);
}

console.log(`Removed player parent: ${g_bPlayerRemoved}`);
```

### `RevokeParentPermission`

```js
const { GrantParentPermission, RevokeParentPermission } = require("core/command/auth");
const { GetParent } = require("auth");

const g_strParentName = "match_admin";
const g_strPermission = "sourcejs.match.cancel";

// Run only in an isolated configuration with no concurrent authorization changes.
const g_ParentRecord = GetParent(g_strParentName);
if ((g_ParentRecord === null) || (typeof g_ParentRecord !== "object") || !Array.isArray(g_ParentRecord.Permissions)) {
	throw new Error("An existing parent record is required for this example.");
}

if (g_ParentRecord.Permissions.includes(g_strPermission)) {
	throw new Error("Choose a direct permission that does not already exist; this example revokes it.");
}

if (!GrantParentPermission(g_strParentName, g_strPermission)) {
	throw new Error(`Unable to grant ${g_strPermission} to ${g_strParentName}.`);
}

const g_bParentPermissionRevoked = RevokeParentPermission(g_strParentName, g_strPermission);
if (!g_bParentPermissionRevoked) {
	throw new Error(`Unable to revoke ${g_strPermission} from ${g_strParentName}.`);
}

console.log(`Revoked parent permission: ${g_bParentPermissionRevoked}`);
```

### `RevokePlayerPermission`

```js
const { GrantPlayerPermission, RevokePlayerPermission } = require("core/command/auth");
const { GetPlayer } = require("auth");

const g_strPlayerSubject = "STEAM_1:1:12345";
const g_strPermission = "sourcejs.match.cancel";

// Run only in an isolated configuration with no concurrent authorization changes.
const g_PlayerRecord = GetPlayer(g_strPlayerSubject);
if ((g_PlayerRecord === null) || (typeof g_PlayerRecord !== "object") || !Array.isArray(g_PlayerRecord.Permissions)) {
	throw new Error("An existing player record is required for this example.");
}

if (g_PlayerRecord.Permissions.includes(g_strPermission)) {
	throw new Error("Choose a direct permission that does not already exist; this example revokes it.");
}

if (!GrantPlayerPermission(g_strPlayerSubject, g_strPermission)) {
	throw new Error(`Unable to grant ${g_strPermission} to ${g_strPlayerSubject}.`);
}

const g_bPlayerPermissionRevoked = RevokePlayerPermission(g_strPlayerSubject, g_strPermission);
if (!g_bPlayerPermissionRevoked) {
	throw new Error(`Unable to revoke ${g_strPermission} from ${g_strPlayerSubject}.`);
}

console.log(`Revoked player permission: ${g_bPlayerPermissionRevoked}`);
```

### `TestPermission`

```js
const { GrantPlayerPermission, RevokePlayerPermission, TestPermission } = require("core/command/auth");
const { GetPlayer } = require("auth");

const g_strPlayerSubject = "STEAM_1:1:12345";
const g_strPermission = "sourcejs.match.status";

// Run only in an isolated configuration with no concurrent authorization changes.
const g_PlayerRecord = GetPlayer(g_strPlayerSubject);
if ((g_PlayerRecord === null) || (typeof g_PlayerRecord !== "object") || !Array.isArray(g_PlayerRecord.Permissions)) {
	throw new Error("An existing player record is required for this example.");
}

const g_bHadDirectPermission = g_PlayerRecord.Permissions.includes(g_strPermission);
if (!g_bHadDirectPermission) {
	if (!GrantPlayerPermission(g_strPlayerSubject, g_strPermission)) {
		throw new Error(`Unable to grant ${g_strPermission} to ${g_strPlayerSubject}.`);
	}
}

try {
	if (!TestPermission(g_strPlayerSubject, g_strPermission)) {
		throw new Error(`${g_strPlayerSubject} should have ${g_strPermission}.`);
	}
} finally {
	if (!g_bHadDirectPermission && !RevokePlayerPermission(g_strPlayerSubject, g_strPermission)) {
		throw new Error(`Unable to revoke ${g_strPermission} from ${g_strPlayerSubject} during cleanup.`);
	}
}
```

## Safe use

- Module evaluation registers 11 built-in paths on the shared `CORE_COMMAND`. This module exports no registration-cleanup helper;
  do not assume unloading a consuming plugin removes those paths.
- Player `Subject` arguments are forwarded unchanged to native [`auth`](auth.md): a network-ID string, a supported player index, or a supported subject object such as one with `NetworkID`. Command-line paths supply token strings.
- Treat player subjects, parent names, and permission strings as external identifiers; validate or choose them before calling these helpers.
- Check every boolean returned by a mutating helper. A failed cleanup means the authorization state may still contain the
  change.
- `PrintAuthParents()` and `PrintAuthPlayers()` write JSON through the core command logger and also return the corresponding
  authorization objects.
- `TestPermission()` logs the decision and returns the same boolean result. Use the returned boolean for control flow; treat
  the command-log text as diagnostic output.
- Run mutating examples only against existing records in an isolated test configuration without concurrent authorization writers.
  They inspect direct permissions or memberships before changing them; a successful add alone does not prove the entry was new.
- These helpers are not transactions. They log after calling the authorization API, so a logging exception can occur after a
  mutation has succeeded. After any mutation or cleanup error, inspect the actual state before retrying or performing manual cleanup.

## Related files

- [`packages/sourcejs/core/command/auth.js`](../../packages/sourcejs/core/command/auth.js) — implementation and command registrations.
- [`auth.md`](auth.md) — underlying authorization API.
- [`core-command.md`](core-command.md) — core command manager and logger used by this module.
