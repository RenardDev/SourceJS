# `require("players/dropweapon")`

The `players/dropweapon` module exposes the selected Source SDK's real `CBasePlayer::Weapon_Drop()` operation. It invokes the game implementation for one of a player's weapon entities, optionally supplying a target position and initial velocity.

Use the contents to find complete, explicitly invoked examples; none of the helpers drops a weapon during plugin loading.

The CommonJS entry lives in [`packages/sourcejs/players/dropweapon.js`](../../packages/sourcejs/players/dropweapon.js). Player lookup, inventory queries, and the decorated `Player.DropWeapon()` method are documented under [`players`](players.md); weapon wrappers are documented under [`weapons`](weapons.md).

## Contents

- [Import](#import)
- [API](#api)
- [Drop the active weapon](#drop-the-active-weapon)
- [Throw toward the view target](#throw-toward-the-view-target)
- [Vector input forms](#vector-input-forms)
- [Drop the primary weapon](#drop-the-primary-weapon)
- [Client command](#client-command)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const { DropWeapon } = require("players/dropweapon");

if (typeof DropWeapon !== "function") {
	throw new TypeError("players/dropweapon.DropWeapon must be a function.");
}

module.exports = { DropWeapon };
```

The native module is installed only when the selected SDK exposes `CBaseEntity` and datamaps. The packaged CommonJS entry cannot supply a missing SDK capability: loading it when the runtime omits this native module throws `Error` with `SourceJS module is not installed: players/dropweapon`.

## API

Call `DropWeapon(Player, Weapon, Target = null, Velocity = null)`. A successful native call returns `true`.

| Parameter | Accepted value | Native meaning |
| --- | --- | --- |
| `Player` | player index or indexed player object | Live player whose virtual `Weapon_Drop()` method is called. |
| `Weapon` | weapon index or indexed weapon object | Live entity whose datamap derives from `CBaseCombatWeapon`; SourceJS does not independently check membership in the selected player's inventory. |
| `Target` | `Vector`, `[X, Y, Z]`, `{ X, Y, Z }`, or `null` | Optional world-space point in the selected game's native coordinate units. |
| `Velocity` | `Vector`, `[X, Y, Z]`, `{ X, Y, Z }`, or `null` | Optional initial world-space velocity in native coordinate units per second. |

SourceJS resolves the player, validates its player information and live entity, and snapshots its SDK handle before resolving the weapon. It validates the weapon's combat-weapon type and snapshots its handle before reading optional vectors. It then resolves both captured handles, reacquires live pointers, repeats player/type checks and invokes the SDK method. Deletion or slot reuse that invalidates a captured handle stops dispatch. Selectors run before their own handle is captured: returning an already reused index can select the current occupant rather than an earlier one the caller intended. Getter side effects are not rolled back; handle checks neither establish inventory ownership nor pin native lifetime against unrelated engine changes. Use a controlled synchronous game-thread phase.

## Drop the active weapon

Resolve the live active weapon immediately before dropping it. The operation is exposed as an explicit function so loading the plugin does not mutate player inventory:

```js
const { GetActiveWeapon } = require("players");
const { DropWeapon } = require("players/dropweapon");
const { Player } = require("players/entity");

function DropActiveWeapon(unPlayerIndex) {
	const CurrentPlayer = Player(unPlayerIndex);
	const Weapon = GetActiveWeapon(CurrentPlayer);
	if (Weapon === null) {
		return null;
	}

	const unWeaponIndex = Weapon.Index;

	if (!DropWeapon(CurrentPlayer, Weapon)) {
		throw new Error(`Unable to drop weapon ${unWeaponIndex}.`);
	}

	return unWeaponIndex;
}

module.exports = { DropActiveWeapon };
```

`null` means that the player had no active weapon at lookup time. A numeric result identifies the weapon passed to the SDK; requery inventory instead of retaining the wrapper as proof of current ownership.

## Throw toward the view target

Use the player's current trace hit as the target and add upward velocity. A trace without a hit returns `null` and this helper does not drop the weapon:

```js
const { GetActiveWeapon, GetViewCoordinates } = require("players");
const { DropWeapon } = require("players/dropweapon");
const { Player } = require("players/entity");
const { Vector } = require("mathlib");

function ThrowActiveWeapon(unPlayerIndex) {
	const CurrentPlayer = Player(unPlayerIndex);
	const Target = GetViewCoordinates(CurrentPlayer);
	const Weapon = GetActiveWeapon(CurrentPlayer);
	if ((Target === null) || (Weapon === null)) {
		return null;
	}

	const unWeaponIndex = Weapon.Index;
	const Velocity = new Vector(0, 0, 240);
	if (!DropWeapon(CurrentPlayer, Weapon, Target, Velocity)) {
		throw new Error(`Unable to throw weapon ${unWeaponIndex}.`);
	}

	return {
		Target,
		Velocity,
		WeaponIndex: unWeaponIndex,
	};
}

module.exports = { ThrowActiveWeapon };
```

`Target` and `Velocity` are copied into SDK `Vector` values for the call. Mutating the JavaScript objects after `DropWeapon()` returns cannot alter the completed drop.

## Vector input forms

Native vectors are convenient but not required. Arrays and component objects are accepted directly:

```js
const { GetActiveWeapon } = require("players");
const { DropWeapon } = require("players/dropweapon");
const { Player } = require("players/entity");

function ThrowWithComponents(unPlayerIndex) {
	const CurrentPlayer = Player(unPlayerIndex);
	const Weapon = GetActiveWeapon(CurrentPlayer);
	if (Weapon === null) {
		return null;
	}

	const unWeaponIndex = Weapon.Index;
	const vecTarget = [512, 128, 80];
	const Velocity = { X: 160, Y: 0, Z: 220 };
	if (!DropWeapon(CurrentPlayer, Weapon, vecTarget, Velocity)) {
		throw new Error(`Unable to throw weapon ${unWeaponIndex}.`);
	}

	return unWeaponIndex;
}

module.exports = { ThrowWithComponents };
```

Only the first three array positions are read; missing, `null`, or `undefined` array components become zero. For object inputs, `X`, `Y`, and `Z` take precedence over `Pitch`, `Yaw`, and `Roll`; each angle-name fallback is read only when its primary component is nullish. Unresolved components become zero, and at least one non-null component must exist.

Supply finite `number` components within the native `float` range. The current implementation applies JavaScript numeric conversion before checking that range, so convertible strings or booleans are also accepted; this is not a strict `number`-only validator. Conversion/getter failures propagate, including those for unsupported `bigint` or `symbol` components. An array/object with no non-null component is invalid rather than an explicit zero vector; use `[0, 0, 0]` for one.

## Drop the primary weapon

The selected SDK's inventory profile can choose the primary weapon instead of relying on the active slot:

```js
const { GetPrimaryWeapon } = require("players");
const { DropWeapon } = require("players/dropweapon");
const { Player } = require("players/entity");

function DropPrimaryWeapon(unPlayerIndex) {
	const CurrentPlayer = Player(unPlayerIndex);
	const Weapon = GetPrimaryWeapon(CurrentPlayer);
	if (Weapon === null) {
		return null;
	}

	const DropResult = {
		ClassName: Weapon.ClassName,
		Index: Weapon.Index,
	};

	if (!DropWeapon(CurrentPlayer, Weapon)) {
		throw new Error(`Unable to drop primary weapon ${DropResult.Index}.`);
	}

	return DropResult;
}

module.exports = { DropPrimaryWeapon };
```

Which classes count as primary weapons comes from the selected SDK's weapon profile; this example does not hardcode a game or class name.

## Client command

This plugin command drops the caller's current weapon and unregisters the exact callback through the runtime's exact `Unload` export:

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { GetActiveWeapon } = require("players");
const { DropWeapon } = require("players/dropweapon");
const { Player } = require("players/entity");

function DropCurrentWeapon(Command) {
	const CurrentPlayer = Player(Command.Index);
	const Weapon = GetActiveWeapon(CurrentPlayer);
	if (Weapon === null) {
		if (!CurrentPlayer.Say("You do not have a weapon to drop.")) {
			throw new Error("Unable to notify the player.");
		}

		return CommandReturn.Handled;
	}

	const unWeaponIndex = Weapon.Index;

	if (!DropWeapon(CurrentPlayer, Weapon)) {
		throw new Error(`Unable to drop weapon ${unWeaponIndex}.`);
	}

	return CommandReturn.Handled;
}

if (!RegisterCommand("sjs_drop", DropCurrentWeapon)) {
	throw new Error("Unable to register sjs_drop.");
}

function Unload() {
	if (!UnregisterCommand("sjs_drop", DropCurrentWeapon)) {
		throw new Error("Unable to unregister sjs_drop.");
	}
}

module.exports = { DropCurrentWeapon, Unload };
```

See [`commands/client`](commands-client.md) for callback filtering and command ownership. Keep the registered callback identity unchanged; unregister it before destroying the plugin context. An unregister failure must be reported and retried while that context is still available.

## Errors

- Omitting `Player` or `Weapon` throws the native signature error.
- The player must resolve through `IPlayerInfoManager` and must have a live `CBaseEntity`. The helpers use the decorated `Player()` factory, which throws instead of returning `null` when no native player is available; lookup and validation errors propagate.
- The weapon must resolve to a live entity whose datamap chain contains `CBaseCombatWeapon`; a `weapon_` class-name prefix alone is insufficient. Invalid record ranges and cycles encountered before that class are rejected.
- `Target` and `Velocity` may be omitted, `null`, or `undefined`. Any other value must be a vector-like array or object with at least one non-null component that converts to a finite native `float`.
- Exceptions from JavaScript entity selectors, vector component getters, and numeric-conversion hooks propagate unchanged. Input validation failures prevent `Weapon_Drop()` but do not roll back side effects of those JavaScript hooks.
- Native C++ exceptions at this callback boundary become `DropWeapon failed with a native C++ exception.` This also covers an exception from the SDK call; it does not roll back any engine changes made before that exception.
- The native operation returns only `true`; failures are reported by JavaScript exceptions.

## Lifecycle

Use this operation on the game thread. Resolve both entities immediately before calling `DropWeapon()`; do not retain borrowed wrappers across deferred work, disconnects, or map transitions. Entity indexes can be reused after deletion, and an earlier weapon wrapper does not prove current ownership.

Capture primitive indexes and any needed metadata before the drop. The SDK may change or remove the weapon during the call; neither result formatting nor error reporting should read its live fields afterward. A returned index/record identifies the argument that was submitted, not a currently owned or surviving entity.

SourceJS copies supplied components into stack-local SDK `Vector` values, calls `Weapon_Drop()`, and returns after the virtual method completes; this is a synchronous SDK operation, not a queued callback request. The SDK owns the actual detach, origin, angle, and velocity behavior; individual games may override it.

`true` confirms that the selected SDK method returned normally; the native `Weapon_Drop()` has no result for SourceJS to translate. It does not guarantee that the entity survives subsequent game logic or that another system will not immediately pick it up.

The operation is intentionally irreversible at the SourceJS layer. Example helpers perform it only when explicitly called; they do not drop weapons during plugin load.

## Related modules

- [`players`](players.md) resolves active/profile-selected weapons and provides the decorated `Player.DropWeapon()` method.
- [`players/entity`](players-entity.md) creates the live player wrapper accepted by the operation.
- [`weapons`](weapons.md) enumerates and filters weapon entities.
- [`weapons/entity`](weapons-entity.md) documents decorated weapon wrappers.
- [`mathlib`](mathlib.md) supplies native-backed `Vector` values.
- [`commands/client`](commands-client.md) owns the command registration used by the complete plugin example.
