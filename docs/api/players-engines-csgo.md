# `require("players/engines/csgo")`

The `players/engines/csgo` module exposes the Source 1 CSGO branch's direct `CBasePlayer::GiveNamedItem()` operation. It is installed only in a SourceJS binary compiled against the `csgo` HL2SDK branch.

The CommonJS entry lives in [`packages/sourcejs/players/engines/csgo.js`](../../packages/sourcejs/players/engines/csgo.js). The selected-SDK entry with the same native ownership is documented under [`players/engines`](players-engines.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Confirm the CSGO build](#confirm-the-csgo-build)
- [Give an AK-47](#give-an-ak-47)
- [Keep an uncarried item](#keep-an-uncarried-item)
- [Use a weapon wrapper](#use-a-weapon-wrapper)
- [Server command](#server-command)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	GiveNamedItem,
	GiveNamedItemIndex,
	Branch,
} = require("players/engines/csgo");

if ((Branch !== "csgo") || (typeof GiveNamedItem !== "function") || (typeof GiveNamedItemIndex !== "function")) {
	throw new TypeError("players/engines/csgo has an invalid native surface.");
}

module.exports = { Branch, GiveNamedItem, GiveNamedItemIndex };
```

This native module targets the project's Source 1 CSGO build, not Source 2. In another build it is not installed; the packaged CommonJS entry remains present and throws `Error` with `SourceJS module is not installed: players/engines/csgo` when required without that native module.

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `Branch` | `"csgo"` initially | Metadata for the Source 1 CSGO HL2SDK selected when the binary was compiled. |
| `GiveNamedItem(nPlayerIndex, strItem, nSubtype = 0, bRemoveIfNotCarried = true)` | entity object or `null` | Request an item for a connected player and return a borrowed wrapper when the SDK result resolves to a live networked entity. |
| `GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype = 0, bRemoveIfNotCarried = true)` | signed integer | Request the item and return its live entity index, or `-1` when the SDK result cannot be resolved. |

`bRemoveIfNotCarried` is the boolean declared by the CSGO SDK method. SourceJS forwards it unchanged; the game DLL decides whether and when an uncarried item survives.

## Confirm the CSGO build

```js
const { Branch } = require("players/engines/csgo");

if (Branch !== "csgo") {
	throw new Error(`Expected the csgo SDK branch, received ${Branch}.`);
}

module.exports = { SelectedBranch: Branch };
```

The binary's SDK/ABI selection is fixed and does not change with the active map. `Branch` is an ordinary writable property populated during installation; overwriting it does not change the ABI or install another branch's functions. Do not overwrite the metadata or native functions to simulate another SDK.

## Give an AK-47

Expose item creation as an explicit action instead of mutating inventory during plugin load:

```js
const { GiveNamedItem } = require("players/engines/csgo");

function CreateCSGOAK47(nPlayerIndex) {
	const Item = GiveNamedItem(nPlayerIndex, "weapon_ak47");
	if (Item === null) {
		return null;
	}

	const nEntityIndex = Item.Index;
	const strClassName = Item.ClassName;
	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < 0) || (typeof strClassName !== "string") || (strClassName.length === 0)) {
		throw new Error("CSGO returned an invalid AK-47 entity.");
	}

	return Item;
}

module.exports = { CreateCSGOAK47 };
```

The SDK decides how duplicate items are handled. A `null` result only means SourceJS could not wrap the SDK result as a live networked entity; it does not prove that the game was unchanged or that no item was created.

## Keep an uncarried item

Pass all optional arguments explicitly when changing `bRemoveIfNotCarried`:

```js
const { GiveNamedItemIndex } = require("players/engines/csgo");

function CreateRetainedDeagle(nPlayerIndex) {
	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, "weapon_deagle", 0, false);
	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < -1)) {
		throw new Error("CSGO returned an invalid Desert Eagle entity index.");
	}

	return nEntityIndex;
}

module.exports = { CreateRetainedDeagle };
```

The third argument is the Int32 item subtype. A non-null fourth argument must be a primitive boolean; passing `false` as the third argument is a type error, not shorthand. Omitting either optional argument, or passing `null`/`undefined`, selects its default: `0` and `true`, respectively. `false` is forwarded as a request, not a guarantee that the item survives or a transfer of ownership to JavaScript.

## Use a weapon wrapper

Convert a successful entity index through the canonical weapon factory before using weapon-specific live properties:

```js
const { GiveNamedItemIndex } = require("players/engines/csgo");
const { Weapon } = require("weapons/entity");

function CreateCSGOM4A1(nPlayerIndex) {
	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, "weapon_m4a1", 0, true);
	if (nEntityIndex === -1) {
		return null;
	}

	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < 0)) {
		throw new Error("CSGO returned an invalid M4A1 entity index.");
	}

	const CurrentWeapon = Weapon(nEntityIndex);
	if ((CurrentWeapon === null) || (CurrentWeapon.Index !== nEntityIndex)) {
		throw new Error(`Unable to wrap CSGO weapon ${nEntityIndex}.`);
	}

	return CurrentWeapon;
}

module.exports = { CreateCSGOM4A1 };
```

The returned entity remains game-owned and can be removed or replaced after the call.

## Server command

This command accepts a player index and CSGO item class. The optional literal `keep` forwards `false` for `bRemoveIfNotCarried`:

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/server");
const { LogInfo, LogWarning } = require("loggers");
const { GiveNamedItemIndex } = require("players/engines/csgo");

function GiveCSGOItem(Command) {
	const nMaximumPlayerIndex = 2147483647;

	const nPlayerIndex = Number(Command.Arguments[1]);
	const strItem = Command.Arguments[2];
	const strRetentionMode = Command.Arguments[3];

	if ((Command.Arguments.length < 3) || (Command.Arguments.length > 4) || !Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumPlayerIndex) || (typeof strItem !== "string") || (strItem.length === 0) || strItem.includes("\0") || ((strRetentionMode !== undefined) && (strRetentionMode !== "keep"))) {
		if (!LogWarning("Usage: sjs_csgo_item <player-index> <item-class> [keep]")) {
			throw new Error("Unable to write the CSGO command usage message.");
		}

		return CommandReturn.Block;
	}

	const bRemoveIfNotCarried = strRetentionMode !== "keep";
	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, strItem, 0, bRemoveIfNotCarried);
	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < -1)) {
		throw new Error("CSGO returned an invalid entity index.");
	}

	if (nEntityIndex === -1) {
		if (!LogWarning(`CSGO did not return a live item ${strItem} for player ${nPlayerIndex}, RemoveIfNotCarried=${bRemoveIfNotCarried}.`)) {
			throw new Error("Unable to write the CSGO item-request warning.");
		}

		return CommandReturn.Handled;
	}

	if (!LogInfo(`CSGO item request ${strItem} for player ${nPlayerIndex}: entity ${nEntityIndex}, RemoveIfNotCarried=${bRemoveIfNotCarried}.`)) {
		throw new Error("Unable to write the CSGO item-request result.");
	}

	return CommandReturn.Handled;
}

if (!RegisterCommand("sjs_csgo_item", GiveCSGOItem)) {
	throw new Error("Unable to register sjs_csgo_item.");
}

function Unload() {
	if (!UnregisterCommand("sjs_csgo_item", GiveCSGOItem)) {
		throw new Error("Unable to unregister sjs_csgo_item.");
	}
}

module.exports = { GiveCSGOItem, Unload };
```

Registration does not call the handler. The command validates the full token count before mutation; it rejects an embedded NUL instead of forwarding a truncated class name. `keep` changes only the SDK flag, not game ownership. See [`commands/server`](commands-server.md) for registration and payload ownership. Export cleanup under the runtime's exact `Unload` key. Unregister the exact callback before its context is disposed; the native unload path continues its own teardown even when this export reports a failure. If a manual cleanup attempt fails before native unload starts, keep the context alive and retry that attempt rather than registering a replacement.

## Errors

- The native module is installed only in a Source 1 `csgo` build with `CBaseEntity` support.
- `nPlayerIndex` must be a primitive Number representing an Int32 connected-player index with a live server entity. Strings, booleans, BigInt, boxed numbers, fractions, and out-of-range values are not coerced.
- `strItem` must be a non-empty primitive string naming a CSGO entity class. Use the exact game-DLL class spelling, without an embedded NUL; this is a caller precondition, not a claim that native validation rejects NUL or applies an item allowlist.
- `nSubtype` may be omitted, `null`, or `undefined` to select `0`; otherwise it must be a primitive Int32 Number. Valid negative values are forwarded unchanged for the game DLL to interpret.
- `bRemoveIfNotCarried` may be omitted, `null`, or `undefined` to select `true`; otherwise it must be a primitive boolean. Numbers, strings, and Boolean objects are not accepted as substitutes.
- More than four JavaScript arguments are rejected before the native method is called.
- `GiveNamedItem()` returns `null` and `GiveNamedItemIndex()` returns `-1` when the SDK result cannot be resolved to a live networked edict, including a null SDK result or an unavailable entity-index lookup. These sentinels are not proof that no game state changed. Argument/interface/player validation failures throw before the SDK call; later wrapper or example validation errors can occur after it.

## Lifecycle

Call both functions on the game thread. They synchronously enter the selected SDK; they are not queued background requests and have no `Options`/callback/`Blocking` mode. The game DLL owns item creation, pickup, duplicate-item rules, and final entity lifetime. SourceJS forwards the CSGO arguments and never takes ownership of the returned entity.

Returned wrappers have live accessors tied to an engine index, not a durable identity. Removal or slot reuse can invalidate a wrapper or make it refer to a different entity. The examples capture live fields once; do not cache a wrapper across inventory changes, disconnects, or map transitions without reacquiring and validating the current entity.

Both item functions mutate game state and have no SourceJS rollback. An error during wrapper creation, field validation, or logging can follow a completed SDK call; it cannot undo that call and must not trigger a blind retry that could request a duplicate item. The examples call them only from explicit helpers or a server command, never during plugin initialization.

## Related modules

- [`players/engines`](players-engines.md) documents the shared ABI and why the fourth argument is CSGO-only.
- [`players`](players.md) provides player inventory and live-wrapper operations.
- [`weapons/entity`](weapons-entity.md) decorates the M4A1 entity returned by index.
- [`commands/server`](commands-server.md) owns the complete CSGO command example.
