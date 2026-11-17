# `require("players/engines/orangebox")`

The `players/engines/orangebox` module exposes the OrangeBox-family SDK's direct `CBasePlayer::GiveNamedItem()` operation. SourceJS installs it for the `css`, `dods`, `gmod`, `hl2dm`, `orangebox`, `sdk2013` and `tf2` builds with base-entity support.

The CommonJS entry lives in [`packages/sourcejs/players/engines/orangebox.js`](../../packages/sourcejs/players/engines/orangebox.js). The selected-SDK entry with the same native ownership is documented under [`players/engines`](players-engines.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Identify the concrete game](#identify-the-concrete-game)
- [Choose a branch item](#choose-a-branch-item)
- [Resolve the generic entity](#resolve-the-generic-entity)
- [Give items to human players](#give-items-to-human-players)
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
} = require("players/engines/orangebox");

const g_setFamilyBranches = new Set(["css", "dods", "gmod", "hl2dm", "orangebox", "sdk2013", "tf2"]);
if (!g_setFamilyBranches.has(Branch) || (typeof GiveNamedItem !== "function") || (typeof GiveNamedItemIndex !== "function")) {
	throw new TypeError("players/engines/orangebox has an invalid native surface.");
}

module.exports = { Branch, GiveNamedItem, GiveNamedItemIndex };
```

Outside the listed family, the native module is not installed. The packaged CommonJS entry remains present but cannot supply that SDK capability; requiring it throws `Error` with `SourceJS module is not installed: players/engines/orangebox`. SourceJS does not guess a compatible game at runtime.

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `Branch` | string | Initially the concrete compiled HL2SDK branch, not `orangebox` for every family member. |
| `GiveNamedItem(nPlayerIndex, strItem, nSubtype = 0)` | entity object or `null` | Request an item for a connected player; wrap the returned entity when it resolves to a current edict. |
| `GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype = 0)` | Int32 Number | Request the item; return the currently resolved entity index, or `-1` if resolution fails. |

These branches declare only item name and integer subtype. CSGO's fourth boolean argument is not accepted. A wrapper or nonnegative index means that the SDK result was resolved, not that a new entity was necessarily created or inventory/pickup succeeded. `null`/`-1` can also mean missing globals or an unresolved/free edict after the call; neither proves that the game made no changes.

## Identify the concrete game

```js
const { Branch } = require("players/engines/orangebox");

const g_setFamilyBranches = new Set(["css", "dods", "gmod", "hl2dm", "orangebox", "sdk2013", "tf2"]);
if (!g_setFamilyBranches.has(Branch)) {
	throw new Error(`Unexpected OrangeBox-family SDK branch: ${Branch}.`);
}

module.exports = { SelectedBranch: Branch };
```

The compiled SDK/ABI is fixed through map changes. `Branch` is ordinary writable metadata, not an ABI selector; overwriting it does not install another game's SDK. Do not change the metadata or exports to simulate another branch.

## Choose a branch item

Select a class name owned by the concrete game before invoking the SDK. The helper is explicit so plugin initialization does not create an item:

```js
const { GiveNamedItem, Branch } = require("players/engines/orangebox");

const g_ItemsByBranch = Object.freeze({
	css: "weapon_ak47",
	dods: "weapon_garand",
	gmod: "weapon_crowbar",
	hl2dm: "weapon_crowbar",
	orangebox: "weapon_crowbar",
	sdk2013: "weapon_crowbar",
	tf2: "tf_weapon_rocketlauncher",
});

function CreateOrangeBoxBranchItem(nPlayerIndex) {
	const nMaximumInt32Index = 2147483647;
	if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumInt32Index)) {
		throw new TypeError("nPlayerIndex must be a positive Int32 Number.");
	}

	const strItem = g_ItemsByBranch[Branch];
	if (!strItem) {
		throw new Error(`No item class is configured for ${Branch}.`);
	}

	const Item = GiveNamedItem(nPlayerIndex, strItem);
	if (Item === null) {
		return null;
	}

	const nEntityIndex = Item.Index;
	const strClassName = Item.ClassName;
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < 0) || (nEntityIndex > nMaximumInt32Index) || (typeof strClassName !== "string") || (strClassName.length === 0)) {
		throw new Error(`${Branch} returned an invalid item entity.`);
	}

	return Item;
}

module.exports = { ItemsByBranch: g_ItemsByBranch, CreateOrangeBoxBranchItem };
```

The table is deliberately branch-aware: its lowercase keys mirror the exact external HL2SDK branch identifiers, not general project-owned property names. SourceJS does not substitute an item name from another game.

## Resolve the generic entity

The index-returning form works with the generic entity factory even when a game uses a non-`weapon_` class prefix. Pass a class selected for the concrete branch:

```js
const { Entity } = require("entities/entity");
const { GiveNamedItemIndex, Branch } = require("players/engines/orangebox");

function CreateOrangeBoxEntity(nPlayerIndex, strItem) {
	const nMaximumInt32Index = 2147483647;
	if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumInt32Index) || (typeof strItem !== "string") || (strItem.length === 0) || strItem.includes("\0")) {
		throw new TypeError("Expected a positive Int32 player index and non-empty NUL-free item string.");
	}

	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, strItem, 0);
	if (nEntityIndex === -1) {
		return null;
	}

	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < 0) || (nEntityIndex > nMaximumInt32Index)) {
		throw new Error(`${Branch} returned an invalid item entity index.`);
	}

	const EntityInstance = Entity(nEntityIndex);
	if ((EntityInstance === null) || (EntityInstance.Index !== nEntityIndex)) {
		throw new Error(`Unable to wrap ${Branch} entity ${nEntityIndex}.`);
	}

	return EntityInstance;
}

module.exports = { CreateOrangeBoxEntity };
```

Use a game-specific weapon API only after confirming that it recognizes the selected branch's class family.

## Give items to human players

Resolve current human players at the moment of the operation, pass a class selected for the concrete branch, and validate every native result:

```js
const { GetHumanPlayers } = require("players/bots");
const { GiveNamedItemIndex, Branch } = require("players/engines/orangebox");

function GiveOrangeBoxItemToHumans(strItem) {
	const nMaximumInt32Index = 2147483647;

	if ((typeof strItem !== "string") || (strItem.length === 0) || strItem.includes("\0")) {
		throw new TypeError("strItem must be a non-empty NUL-free string.");
	}

	const vecResults = [];
	const vecCurrentHumans = GetHumanPlayers();
	if (!Array.isArray(vecCurrentHumans)) {
		throw new TypeError("players/bots.GetHumanPlayers() did not return an array.");
	}

	for (const Player of vecCurrentHumans) {
		const nPlayerIndex = Player.Index;
		if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumInt32Index)) {
			throw new TypeError("The human roster contains an invalid Int32 player index.");
		}

		const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, strItem);
		if (!Number.isInteger(nEntityIndex) || (nEntityIndex < -1) || (nEntityIndex > nMaximumInt32Index)) {
			throw new Error(`${Branch} returned an invalid item index for player ${nPlayerIndex}.`);
		}

		if (nEntityIndex >= 0) {
			vecResults.push({ EntityIndex: nEntityIndex, PlayerIndex: nPlayerIndex });
		}
	}

	return vecResults;
}

module.exports = { GiveOrangeBoxItemToHumans };
```

Requery the human roster for each deliberate operation. The example captures each player index once before the SDK call and omits unresolved `-1` results; duplicate resolved entity indexes remain separate records. Requests are independent, not a transaction: a later error stops the loop without undoing earlier effects or returning a partial result. Inspect current game state before deciding whether another request is safe; do not blindly replay the whole batch.

## Server command

This family-wide server command accepts the concrete item class from the administrator:

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/server");
const { LogInfo, LogWarning } = require("loggers");
const { GiveNamedItemIndex } = require("players/engines/orangebox");

function GiveOrangeBoxItem(Command) {
	const nMaximumInt32Index = 2147483647;

	const vecArguments = Command.Arguments;
	const nPlayerIndex = Number(vecArguments[1]);
	const strItem = vecArguments[2];
	if ((vecArguments.length !== 3) || !Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumInt32Index) || (typeof strItem !== "string") || (strItem.length === 0) || strItem.includes("\0")) {
		if (!LogWarning("Usage: sjs_ob_item <player-index> <item-class>")) {
			throw new Error("Unable to write the OrangeBox command usage message.");
		}

		return CommandReturn.Block;
	}

	const nEntityIndex = GiveNamedItemIndex(nPlayerIndex, strItem);
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < -1) || (nEntityIndex > nMaximumInt32Index)) {
		throw new Error("The OrangeBox-family SDK returned an invalid entity index.");
	}

	if (!LogInfo(`OrangeBox-family item ${strItem} for player ${nPlayerIndex}: entity ${nEntityIndex}.`)) {
		throw new Error("Unable to write the OrangeBox item-request result.");
	}

	return CommandReturn.Handled;
}

if (!RegisterCommand("sjs_ob_item", GiveOrangeBoxItem)) {
	throw new Error("Unable to register sjs_ob_item.");
}

function Unload() {
	if (!UnregisterCommand("sjs_ob_item", GiveOrangeBoxItem)) {
		throw new Error("Unable to unregister sjs_ob_item.");
	}
}

module.exports = { GiveOrangeBoxItem, Unload };
```

See [`commands/server`](commands-server.md) for server command registration and payload ownership.

## Errors

- The native module is installed only in the listed OrangeBox-family builds with `CBaseEntity` support.
- `Branch` must drive game-specific class selection; the module does not normalize item names.
- `nPlayerIndex` must be a primitive Int32 Number for a connected player with a live server entity. Strings, booleans, BigInt, fractions, boxed numbers, and indexed objects are not coerced; command examples explicitly convert the textual token first.
- `strItem` must be a primitive non-empty string accepted by the concrete game. Use a NUL-free name: the SDK consumes `strItem.c_str()`; the native adapter does not explicitly reject an embedded NUL, which can truncate the name. The caller checks in the examples are a precondition, not a native validation guarantee.
- `nSubtype` defaults to `0` when omitted, `null`, or `undefined`; any other value must be a primitive Int32 Number, without coercion.
- More than three JavaScript arguments are rejected before the native method is called.
- Validation and player/interface lookup failures throw instead of returning normal no-result sentinels. Native C++ exceptions that reach either callback are translated to operation-specific JavaScript errors. This does not make arbitrary game-DLL faults recoverable or roll back earlier game state.

## Lifecycle

Run these APIs on the game thread. They synchronously call the loaded game DLL, which owns item creation, inventory conflicts, pickup rules, and final entity lifetime. These are not queued background requests and have no `Options`/callback/`Blocking` mode. SourceJS forwards the selected SDK arguments and does not retain the native entity.

Returned wrappers borrow current engine slots, not stable identities. Removal or slot reuse can invalidate the view or redirect it to another entity. Reacquire entities and player rosters after inventory changes, disconnects, and map transitions. Roster queries and live fields are not an atomic snapshot; captured primitives preserve diagnostics but cannot pin the entity across game callbacks.

Both item functions mutate game state and have no SourceJS rollback. The examples call them only from explicit helpers or a deliberately invoked server command, never during registration/plugin initialization. Later result validation or logging failures do not undo earlier SDK effects. Export cleanup under the runtime's exact `Unload` key. The native unload path continues its own teardown even when this export reports a failure. If a manual unregistration attempt fails before native unload starts, keep the original callback/context alive and retry cleanup, not registration or item creation.

## Related modules

- [`players/engines`](players-engines.md) documents the shared native ABI.
- [`players/bots`](players-bots.md) supplies the current human-player roster used by the bulk operation.
- [`entities/entity`](entities-entity.md) wraps an item index without assuming a weapon class-name family.
- [`commands/server`](commands-server.md) owns the complete family-wide command example.
