# `require("players/engines")`

The `players/engines` module exposes the selected HL2SDK branch's direct `CBasePlayer::GiveNamedItem()` operation. Use it when game-specific code already knows an entity class name accepted by the current server.

The CommonJS entry lives in [`packages/sourcejs/players/engines.js`](../../packages/sourcejs/players/engines.js). Family-specific entry points use the same native implementation and are documented separately for [BMS](players-engines-bms.md), [CSGO](players-engines-csgo.md), [L4D2](players-engines-l4d2.md), and [OrangeBox](players-engines-orangebox.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Inspect the selected branch](#inspect-the-selected-branch)
- [Create an item entity](#create-an-item-entity)
- [Return only the entity index](#return-only-the-entity-index)
- [CSGO ownership option](#csgo-ownership-option)
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
} = require("players/engines");

if ((typeof Branch !== "string") || (Branch.length === 0)) {
	throw new TypeError("players/engines.Branch must be a non-empty string.");
}

if ((typeof GiveNamedItem !== "function") || (typeof GiveNamedItemIndex !== "function")) {
	throw new TypeError("players/engines item functions are unavailable.");
}

module.exports = { Branch, GiveNamedItem, GiveNamedItemIndex };
```

The native module is installed only in a build with the server `cbase.h` capability (`SOURCEJS_HAS_BASE_ENTITY`), which supplies the declarations needed by the direct call. The native include gate explicitly excludes the `darkm` branch. Without that capability, the packaged CommonJS entry remains present but cannot supply the native module; `require("players/engines")` throws `Error` with `SourceJS module is not installed: players/engines`.

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `Branch` | string | Initially the concrete compiled HL2SDK branch name; ordinary writable metadata, not an ABI selector. |
| `GiveNamedItem(nPlayerIndex, strItem, nSubtype = 0)` | entity object or `null` | Request the item; wrap the SDK result when it resolves to a current non-free edict. |
| `GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype = 0)` | Int32 Number | Request the item; return the currently resolved entity index, or `-1` if resolution fails. |

The native module defines these three exports as own data properties. Inherited JavaScript setters cannot replace or suppress them during installation; both functions retain the runtime data supplied by the owning module.

On CSGO only, both functions accept a fourth `bRemoveIfNotCarried` boolean argument, defaulting to `true` when omitted, `null`, or `undefined`. Other branches reject that extra argument because their `CBasePlayer::GiveNamedItem()` declaration does not contain it. A wrapper or nonnegative index means that the SDK result was resolved, not that a new entity was necessarily created or pickup succeeded. Neither `null` nor `-1` proves that the call had no game-state effects.

## Inspect the selected branch

Use `Branch` before choosing game-specific item names, subtypes, or optional arguments:

```js
const { Branch } = require("players/engines");

if ((typeof Branch !== "string") || (Branch.length === 0)) {
	throw new Error("The selected HL2SDK branch is unavailable.");
}

module.exports = { SelectedBranch: Branch };
```

The compiled SDK/ABI is fixed through map changes, not guessed from the current map. `Branch` is ordinary writable metadata: changing it or replacing the exported functions does not install another SDK. Do not overwrite the metadata to simulate another branch.

## Create an item entity

Accept the item class from game-specific configuration or command input and return the generic live entity produced by the native factory:

```js
const { GiveNamedItem } = require("players/engines");

function CreateItemEntity(nPlayerIndex, strItem, nSubtype = 0) {
	const nMaximumInt32Index = 2147483647;

	if ((typeof strItem !== "string") || (strItem.length === 0) || strItem.includes("\0")) {
		throw new TypeError("strItem must be a non-empty NUL-free string.");
	}

	const Item = GiveNamedItem(nPlayerIndex, strItem, nSubtype);
	if (Item === null) {
		return null;
	}

	const nEntityIndex = Item.Index;
	const strClassName = Item.ClassName;
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < 0) || (nEntityIndex > nMaximumInt32Index) || (typeof strClassName !== "string")) {
		throw new Error("GiveNamedItem() returned an invalid entity wrapper.");
	}

	return Item;
}

module.exports = { CreateItemEntity };
```

Call `CreateItemEntity()` only as an explicit administrative or game action. Convert the returned index through [`weapons/entity`](weapons-entity.md) only when the configured class is known to create a weapon.

## Return only the entity index

Use `GiveNamedItemIndex()` when the next API needs only an entity index:

```js
const { GiveNamedItemIndex } = require("players/engines");

function CreateItemIndex(nPlayerIndex, strItem, nSubtype = 0) {
	const nMaximumInt32Index = 2147483647;

	if ((typeof strItem !== "string") || (strItem.length === 0) || strItem.includes("\0")) {
		throw new TypeError("strItem must be a non-empty NUL-free string.");
	}

	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype);
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < -1) || (nEntityIndex > nMaximumInt32Index)) {
		throw new Error("GiveNamedItemIndex() returned an invalid entity index.");
	}

	return nEntityIndex;
}

module.exports = { CreateItemIndex };
```

`-1` means the SDK result could not be resolved to a current entity index: the SDK may return no entity, globals may be unavailable, or no matching non-free edict may exist. This does not prove that no item was created or other effects occurred. A non-nullish primitive Int32 `nSubtype` is forwarded unchanged; its meaning is game-specific. Omission, `null`, and `undefined` select the native default `0`.

## CSGO ownership option

CSGO exposes an additional `bRemoveIfNotCarried` argument. Passing `false` asks that SDK declaration not to remove the returned item merely because the player did not carry it. This is an engine-side removal request, not a transfer of ownership to JavaScript; the game DLL decides the final result:

```js
const { GiveNamedItemIndex, Branch } = require("players/engines");

function CreateCSGOItem(nPlayerIndex, strItem, nSubtype = 0, bRemoveIfNotCarried = true) {
	const nMaximumInt32Index = 2147483647;

	if (Branch !== "csgo") {
		throw new RangeError("bRemoveIfNotCarried is available only on the CSGO SDK branch.");
	}

	if ((typeof strItem !== "string") || (strItem.length === 0) || strItem.includes("\0")) {
		throw new TypeError("strItem must be a non-empty NUL-free string.");
	}

	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype, bRemoveIfNotCarried);
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < -1) || (nEntityIndex > nMaximumInt32Index)) {
		throw new Error("GiveNamedItemIndex() returned an invalid entity index.");
	}

	return nEntityIndex;
}

module.exports = { CreateCSGOItem };
```

Do not pass the fourth argument on another branch. The native binding rejects argument counts that exceed the selected `CBasePlayer` declaration.

## Server command

This administrative command accepts a player index and full item class name, invokes the operation only when the command is run, and unregisters its exact callback during unload:

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/server");
const { LogInfo, LogWarning } = require("loggers");
const { GiveNamedItemIndex } = require("players/engines");

function GiveItem(Command) {
	const nMaximumInt32Index = 2147483647;

	const vecArguments = Command.Arguments;
	const nPlayerIndex = Number(vecArguments[1]);
	const strItem = vecArguments[2];
	if ((vecArguments.length !== 3) || !Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumInt32Index) || (typeof strItem !== "string") || (strItem.length === 0) || strItem.includes("\0")) {
		if (!LogWarning("Usage: sjs_give_item <player-index> <item-class>")) {
			throw new Error("Unable to write the command usage message.");
		}

		return CommandReturn.Block;
	}

	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, strItem);
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < -1) || (nEntityIndex > nMaximumInt32Index)) {
		throw new Error("GiveNamedItemIndex() returned an invalid entity index.");
	}

	if (nEntityIndex === -1) {
		if (!LogWarning(`GiveNamedItemIndex did not resolve ${strItem} for player ${nPlayerIndex}.`)) {
			throw new Error("Unable to write the unresolved-item result.");
		}

		return CommandReturn.Block;
	}

	if (!LogInfo(`GiveNamedItemIndex resolved ${strItem} for player ${nPlayerIndex}: entity ${nEntityIndex}.`)) {
		throw new Error("Unable to write the resolved-item result.");
	}

	return CommandReturn.Handled;
}

if (!RegisterCommand("sjs_give_item", GiveItem)) {
	throw new Error("Unable to register sjs_give_item.");
}

function Unload() {
	if (!UnregisterCommand("sjs_give_item", GiveItem)) {
		throw new Error("Unable to unregister sjs_give_item.");
	}
}

module.exports = { GiveItem, Unload };
```

See [`commands/server`](commands-server.md) for registration ownership and command payload fields.

## Errors

- `nPlayerIndex` must be a primitive Int32 Number for a connected player. Strings, booleans, BigInt, fractions, boxed numbers, and player-like objects are not coerced. The command example explicitly converts the textual token before validating its range.
- `strItem` must be a primitive non-empty string accepted by the game DLL. Use a NUL-free name: the native adapter calls `strItem.c_str()` without explicitly rejecting embedded NUL, so a NUL can truncate the SDK name. The example guards enforce a caller precondition, not a native validation guarantee.
- `nSubtype` selects `0` when omitted, `null`, or `undefined`; any other value must be a primitive Int32 Number without coercion.
- CSGO's `bRemoveIfNotCarried` selects `true` when omitted, `null`, or `undefined`; any other value must be a primitive boolean without coercion.
- Passing more arguments than the selected SDK method accepts throws before entering the game DLL.
- The player must be connected and resolve to a live `CBaseEntity`. Validation/player-interface lookup failures throw instead of returning normal no-result sentinels.
- Both item callbacks catch C++ exceptions and attempt to report an operation-specific JavaScript `Error` when no exception is pending. An existing JavaScript exception or execution termination is preserved; message allocation can fail instead of producing an `Error` object. Native effects completed before the failure are not rolled back; this boundary does not make native crashes recoverable.

## Lifecycle

Run these APIs on the game thread. The game DLL owns item creation, pickup rules, replacement behavior, and final entity lifetime. SourceJS calls the selected virtual method synchronously and does not synthesize an entity. These are not queued background requests and have no `Options`/callback/`Blocking` mode.

`GiveNamedItem()` returns a new JavaScript wrapper around the resolved engine slot, not a guarantee of a newly created native entity. Its fields are live, and removal or slot reuse can invalidate the view or redirect it to another entity. `GiveNamedItemIndex()` scans current edicts for the SDK result; neither API retains the native entity. Capture primitive fields before later calls and reacquire entities/players after inventory changes, disconnects, or map transitions.

Both operations can mutate game state and have no SourceJS rollback. Keep them inside explicit commands, callbacks, or gameplay paths, not plugin initialization or command registration. Later result validation or logging errors do not undo earlier effects. Preserve original errors and inspect current state before retrying. Export cleanup under the runtime's exact `Unload` key; the native unload path continues its own teardown even when this export reports a failure. If manual command unregistration fails before native unload starts, retain the exact callback/context and retry cleanup, not the item request.

The compiled branch is fixed for the binary's lifetime, but its JavaScript `Branch` property is writable metadata. Entity indexes are borrowed current-slot references, not stable identities; live fields and lookups are not an atomic snapshot.

## Related modules

- [`players`](players.md) provides decorated player methods and live player lookup.
- [`players/entity`](players-entity.md) documents the connected player wrappers required by related operations.
- [`entities/entity`](entities-entity.md) documents the generic live entity returned by `GiveNamedItem()`.
- [`weapons/entity`](weapons-entity.md) wraps an index after game-specific configuration guarantees that the created class is a weapon.
- [`commands/server`](commands-server.md) owns the complete administrative command example.
- [BMS](players-engines-bms.md), [CSGO](players-engines-csgo.md), [L4D2](players-engines-l4d2.md), and [OrangeBox](players-engines-orangebox.md) provide game-family examples with concrete item names.
