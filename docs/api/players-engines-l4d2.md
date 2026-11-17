# `require("players/engines/l4d2")`

The `players/engines/l4d2` module exposes Left 4 Dead 2's direct `CBasePlayer::GiveNamedItem()` operation. It is installed only in a SourceJS binary compiled against the `l4d2` HL2SDK branch.

The CommonJS entry lives in [`packages/sourcejs/players/engines/l4d2.js`](../../packages/sourcejs/players/engines/l4d2.js). The selected-SDK entry with the same native ownership is documented under [`players/engines`](players-engines.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Confirm the L4D2 build](#confirm-the-l4d2-build)
- [Give a pistol](#give-a-pistol)
- [Give a survivor loadout](#give-a-survivor-loadout)
- [Use a weapon wrapper](#use-a-weapon-wrapper)
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
} = require("players/engines/l4d2");

if ((Branch !== "l4d2") || (typeof GiveNamedItem !== "function") || (typeof GiveNamedItemIndex !== "function")) {
	throw new TypeError("players/engines/l4d2 has an invalid native surface.");
}

module.exports = { Branch, GiveNamedItem, GiveNamedItemIndex };
```

In another SDK build, the native module is not installed. The packaged CommonJS entry remains present but cannot supply that SDK capability; requiring it throws `Error` with `SourceJS module is not installed: players/engines/l4d2`.

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `Branch` | `"l4d2"` initially | Metadata for the HL2SDK branch selected when the binary was compiled. |
| `GiveNamedItem(nPlayerIndex, strItem, nSubtype = 0)` | entity object or `null` | Request an L4D2 item for a connected player and return a borrowed wrapper when the SDK result resolves to a live networked entity. |
| `GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype = 0)` | signed integer | Request the item and return its live entity index, or `-1` when the SDK result cannot be resolved. |

L4D2 declares the item name and integer subtype only. Passing CSGO's fourth `bRemoveIfNotCarried` JavaScript argument throws instead of being ignored.

## Confirm the L4D2 build

```js
const { Branch } = require("players/engines/l4d2");

if (Branch !== "l4d2") {
	throw new Error(`Expected the l4d2 SDK branch, received ${Branch}.`);
}

module.exports = { SelectedBranch: Branch };
```

The binary's SDK/ABI selection is fixed through map changes. `Branch` is an ordinary writable property populated during installation, not an ABI selector. Overwriting it or the native functions does not install another branch; do not use such changes to simulate an SDK.

## Give a pistol

Expose item creation as an explicit action instead of mutating inventory during plugin load:

```js
const { GiveNamedItem } = require("players/engines/l4d2");

function CreateL4D2Pistol(nPlayerIndex) {
	const Item = GiveNamedItem(nPlayerIndex, "weapon_pistol");
	if (Item === null) {
		return null;
	}

	const nEntityIndex = Item.Index;
	const strClassName = Item.ClassName;
	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < 0) || (typeof strClassName !== "string") || (strClassName.length === 0)) {
		throw new Error("L4D2 returned an invalid pistol entity.");
	}

	return Item;
}

module.exports = { CreateL4D2Pistol };
```

The game DLL decides rejection and merging rules. `null` means SourceJS could not wrap the SDK result as a live networked entity; it does not prove that nothing changed or no item was created.

## Give a survivor loadout

Collect only nonnegative indexes resolved from SDK results, while rejecting invalid result values:

```js
const { GiveNamedItemIndex } = require("players/engines/l4d2");

function CreateL4D2Loadout(nPlayerIndex) {
	const vecItemClasses = ["weapon_pistol", "weapon_pain_pills"];
	const vecResolvedEntityIndexes = [];

	for (const strItemClass of vecItemClasses) {
		const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, strItemClass);
		if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < -1)) {
			throw new Error(`L4D2 returned an invalid index for ${strItemClass}.`);
		}

		if (nEntityIndex >= 0) {
			vecResolvedEntityIndexes.push(nEntityIndex);
		}
	}

	return {
		CreatedIndexes: vecResolvedEntityIndexes,
		RequestedCount: vecItemClasses.length,
	};
}

module.exports = { CreateL4D2Loadout };
```

The calls are synchronous and independent, not an atomic loadout operation. `CreatedIndexes` is the example's result-key spelling; it contains resolved indexes, not proof of new creations or a promise of durable identity. A `-1` result is omitted, and failure on the second call leaves any first-call effects in place while throwing instead of returning a partial record. Do not blindly retry the whole loadout after a failure. The game owns each entity's lifetime; choose items valid for the player's current team and game mode.

## Use a weapon wrapper

Convert a successful rifle index through the canonical weapon factory before using weapon-specific APIs:

```js
const { GiveNamedItemIndex } = require("players/engines/l4d2");
const { Weapon } = require("weapons/entity");

function CreateL4D2Rifle(nPlayerIndex) {
	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, "weapon_rifle", 0);
	if (nEntityIndex === -1) {
		return null;
	}

	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < 0)) {
		throw new Error("L4D2 returned an invalid rifle entity index.");
	}

	const CurrentWeapon = Weapon(nEntityIndex);
	if ((CurrentWeapon === null) || (CurrentWeapon.Index !== nEntityIndex)) {
		throw new Error(`Unable to wrap L4D2 weapon ${nEntityIndex}.`);
	}

	return CurrentWeapon;
}

module.exports = { CreateL4D2Rifle };
```

Use the returned wrapper immediately and reacquire it after inventory-changing events.

## Client command

This L4D2-only client command requests a first aid kit for the caller and unregisters the exact callback during plugin unload:

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { LogInfo, LogWarning } = require("loggers");
const { GiveNamedItemIndex } = require("players/engines/l4d2");

function GiveFirstAidKit(Command) {
	const nPlayerIndex = Command.Index;
	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, "weapon_first_aid_kit");
	if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < -1)) {
		throw new Error("L4D2 returned an invalid first aid kit entity index.");
	}

	if (nEntityIndex === -1) {
		if (!LogWarning(`L4D2 did not return a live first aid kit for player ${nPlayerIndex}.`)) {
			throw new Error("Unable to write the L4D2 item-request warning.");
		}

		return CommandReturn.Handled;
	}

	if (!LogInfo(`L4D2 first aid kit request for player ${nPlayerIndex}: entity ${nEntityIndex}.`)) {
		throw new Error("Unable to write the L4D2 item-request result.");
	}

	return CommandReturn.Handled;
}

if (!RegisterCommand("sjs_l4d2_medkit", GiveFirstAidKit)) {
	throw new Error("Unable to register sjs_l4d2_medkit.");
}

function Unload() {
	if (!UnregisterCommand("sjs_l4d2_medkit", GiveFirstAidKit)) {
		throw new Error("Unable to unregister sjs_l4d2_medkit.");
	}
}

module.exports = { GiveFirstAidKit, Unload };
```

Registration does not invoke the handler. It captures the current player index before entering the SDK and uses that primitive in diagnostics, not a second live-field read. See [`commands/client`](commands-client.md) for callback ownership and filtering. Export cleanup under the runtime's exact `Unload` key. Unregister the exact callback before disposing its context; the native unload path continues its own teardown even when this export reports a failure. If a manual cleanup attempt fails before native unload starts, keep the context alive and retry that attempt rather than registering a replacement.

## Errors

- The native module is installed only in an `l4d2` build with `CBaseEntity` support.
- `nPlayerIndex` must be a primitive Number representing an Int32 connected-player index with a live server entity. Strings, booleans, BigInt, boxed numbers, fractions, and out-of-range values are not coerced.
- `strItem` must be a non-empty primitive string naming an L4D2 entity class. Use the exact game-DLL class spelling without an embedded NUL; this is a caller precondition, not a claim that native validation rejects NUL or applies an item allowlist.
- `nSubtype` may be omitted, `null`, or `undefined` to select `0`; otherwise it must be a primitive Int32 Number. Valid negative subtypes are forwarded unchanged for the SDK to interpret.
- More than three JavaScript arguments are rejected before the native method is called.
- `GiveNamedItem()` returns `null` and `GiveNamedItemIndex()` returns `-1` when the SDK result cannot be resolved to a live networked edict, including a null SDK result or unavailable entity-index lookup. These sentinels do not prove that the game was unchanged. Argument/interface/player validation failures throw before the SDK call; wrapper or example validation errors can occur afterward.

## Lifecycle

Call both functions on the game thread. They enter the selected SDK synchronously and have no queued-request, `Options`, callback, or `Blocking` mode. The game DLL owns slot conflicts, duplicate handling, pickup rules, and entity lifetime. SourceJS forwards the SDK arguments and never takes ownership of the returned entity.

Returned wrappers have live accessors tied to an index, not a durable identity. Removal and slot reuse can invalidate a view or make it refer to another entity. The examples capture live fields once; reacquire and validate the current entity after inventory changes, disconnects, and map transitions.

Both item functions mutate game state and have no SourceJS rollback. A later field-validation, wrapper, or logging error cannot undo a completed SDK call and must not trigger a blind retry that could request another item. The examples call them only from explicit helpers or a client command, never during plugin initialization.

## Related modules

- [`players/engines`](players-engines.md) documents the shared ABI and the absence of CSGO's fourth argument.
- [`players`](players.md) provides player inventory and live-wrapper operations.
- [`weapons/entity`](weapons-entity.md) decorates the rifle entity returned by index.
- [`commands/client`](commands-client.md) owns the complete L4D2 command example.
