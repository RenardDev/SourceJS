# `require("players/engines/bms")`

The `players/engines/bms` module exposes Black Mesa's direct `CBasePlayer::GiveNamedItem()` operation. It is installed only in a SourceJS binary compiled against the `bms` HL2SDK branch.

Use the contents to find branch checks, complete item helpers, and a client command. Item requests are made only when an exported helper or the registered command is explicitly invoked.

The CommonJS entry lives in [`packages/sourcejs/players/engines/bms.js`](../../packages/sourcejs/players/engines/bms.js). The selected-SDK entry with the same native functions is documented under [`players/engines`](players-engines.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Confirm the BMS build](#confirm-the-bms-build)
- [Give a crowbar](#give-a-crowbar)
- [Resolve the weapon by index](#resolve-the-weapon-by-index)
- [Client command](#client-command)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	GiveNamedItem,
	GiveNamedItemIndex,
	Branch,
} = require("players/engines/bms");

if ((Branch !== "bms") || (typeof GiveNamedItem !== "function") || (typeof GiveNamedItemIndex !== "function")) {
	throw new TypeError("players/engines/bms has an invalid native surface.");
}

module.exports = { Branch, GiveNamedItem, GiveNamedItemIndex };
```

In a non-BMS build, the native module is not installed. The packaged CommonJS entry remains present but cannot supply that SDK capability; requiring it throws `Error` with `SourceJS module is not installed: players/engines/bms`.

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `Branch` | `"bms"` | Identify the HL2SDK branch used to compile the binary. |
| `GiveNamedItem(nPlayerIndex, strItem, nSubtype = 0)` | entity object or `null` | Request an item for a connected player and return a borrowed native entity wrapper when the SDK result resolves to a live edict. |
| `GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype = 0)` | number | Request the item and return its resolved edict index, or `-1` when the SDK result cannot be resolved. |

## Confirm the BMS build

```js
const { Branch } = require("players/engines/bms");

if (Branch !== "bms") {
	throw new Error(`Expected the bms SDK branch, received ${Branch}.`);
}

module.exports = { SelectedBranch: Branch };
```

The initial `Branch` value comes from the loaded binary's compile-time SDK setting, not the active map. This export is an ordinary writable property; reassigning it cannot change the compiled SDK ABI or install another branch's module. Do not overwrite branch metadata or native functions to simulate another game.

## Give a crowbar

Expose the irreversible item request as an explicit action instead of running it when the plugin loads:

```js
const { GiveNamedItem } = require("players/engines/bms");

function CreateBMSCrowbar(nPlayerIndex) {
	const Item = GiveNamedItem(nPlayerIndex, "weapon_crowbar");
	if (Item === null) {
		return null;
	}

	const nEntityIndex = Item.Index;
	const strClassName = Item.ClassName;
	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < 0) || (typeof strClassName !== "string") || (strClassName.length === 0)) {
		throw new Error("BMS returned an invalid crowbar entity.");
	}

	return Item;
}

module.exports = { CreateBMSCrowbar };
```

The game DLL decides whether the request creates an entity, returns an existing item, merges inventory, or removes an item later. A non-null generic entity wrapper is not a promise of a newly allocated crowbar or current player ownership.

## Resolve the weapon by index

Use the index-returning form when the next operation needs a decorated weapon wrapper:

```js
const { GiveNamedItemIndex } = require("players/engines/bms");
const { Weapon } = require("weapons/entity");

function CreateBMSGlock(nPlayerIndex, nSubtype = 0) {
	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, "weapon_glock", nSubtype);
	if (nEntityIndex === -1) {
		return null;
	}

	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < 0)) {
		throw new Error("BMS returned an invalid Glock entity index.");
	}

	const CurrentWeapon = Weapon(nEntityIndex);
	if ((CurrentWeapon === null) || (CurrentWeapon.Index !== nEntityIndex)) {
		throw new Error(`Unable to wrap BMS weapon ${nEntityIndex}.`);
	}

	return CurrentWeapon;
}

module.exports = { CreateBMSGlock };
```

`nSubtype` is forwarded unchanged as an Int32 to BMS `GiveNamedItem()`; omitted, `null`, or `undefined` values select zero. The native signature accepts a JavaScript `number` integer, not a string, boolean, `bigint`, or boxed number. The game interprets valid subtype values.

## Client command

This BMS-only client command requests a crowbar for the caller and unregisters the exact callback through the runtime's exact `Unload` export:

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { LogInfo, LogWarning } = require("loggers");
const { GiveNamedItemIndex } = require("players/engines/bms");

function GiveCrowbar(Command) {
	const nPlayerIndex = Command.Index;
	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, "weapon_crowbar");
	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < -1)) {
		throw new Error("BMS returned an invalid crowbar entity index.");
	}

	if (nEntityIndex === -1) {
		if (!LogWarning(`BMS did not return a live crowbar entity for player ${nPlayerIndex}.`)) {
			throw new Error("Unable to write the BMS item-creation failure.");
		}

		return CommandReturn.Handled;
	}

	if (!LogInfo(`BMS crowbar request for player ${nPlayerIndex}: entity ${nEntityIndex}.`)) {
		throw new Error("Unable to write the BMS item-creation result.");
	}

	return CommandReturn.Handled;
}

if (!RegisterCommand("sjs_bms_crowbar", GiveCrowbar)) {
	throw new Error("Unable to register sjs_bms_crowbar.");
}

function Unload() {
	if (!UnregisterCommand("sjs_bms_crowbar", GiveCrowbar)) {
		throw new Error("Unable to unregister sjs_bms_crowbar.");
	}
}

module.exports = { GiveCrowbar, Unload };
```

See [`commands/client`](commands-client.md) for client callback ownership and filtering. Registration does not invoke the callback. Keep its identity unchanged, report an unregister failure, and retry that cleanup before destroying the plugin context.

## Errors

- The native module is installed only in a `bms` build with `CBaseEntity` support.
- `nPlayerIndex` must be an Int32 JavaScript `number` index that resolves to a connected player with a live server entity. Numeric strings, booleans, `bigint`, and object selectors are not accepted.
- `strItem` must be a non-empty primitive JavaScript string. Use an exact Black Mesa entity class name without embedded NUL characters; the current native boundary passes a C string and does not validate a class-name allowlist.
- `nSubtype` may be omitted, `null`, or `undefined`; any non-null supplied value must be an Int32 JavaScript `number`.
- `GiveNamedItem()` returns `null` and `GiveNamedItemIndex()` returns `-1` when the SDK result cannot be found as a live networked edict. This includes a null SDK result or failed edict resolution, not proof that the game made no changes. Input validation and required player-interface failures throw instead.
- BMS `CBasePlayer::GiveNamedItem()` has no `bRemoveIfNotCarried` parameter; passing a fourth JavaScript argument is rejected.

## Lifecycle

Use the functions on the game thread. They call the selected SDK synchronously, then attempt to resolve its result through current edicts. The game DLL owns item creation, pickup rules, replacement behavior, and final entity lifetime; SourceJS does not own or retain the returned native entity.

Returned wrappers have live accessors tied to an engine index, not immutable entity identity or copied game state. Save only needed primitive identity/metadata and resolve and validate the current entity after deferred work, inventory changes, disconnects, or map transitions; a reused slot may refer to another entity.

Both functions are irreversible requests to game code, not queued background operations. A failed wrapper validation, decoration, or logger call after the SDK returns does not undo game changes. Do not blindly repeat an item request to recover from a later diagnostic failure. The examples invoke them only from explicit helpers or a client command, never during plugin initialization.

## Related modules

- [`players/engines`](players-engines.md) documents the shared native ABI and generic configuration-driven use.
- [`players`](players.md) provides player inventory and live-wrapper operations.
- [`weapons/entity`](weapons-entity.md) decorates the Glock entity returned by index.
- [`commands/client`](commands-client.md) owns the complete BMS command example.
