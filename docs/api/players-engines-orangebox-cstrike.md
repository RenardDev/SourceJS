# `require("players/engines/orangebox/cstrike")`

The `players/engines/orangebox/cstrike` module exposes Counter-Strike: Source player operations that are not shared by every OrangeBox-family game. SourceJS installs it only in a `css` build with base-entity access, send properties, shared SDK definitions, `VSERVERTOOLS001` and the current console API.

The CommonJS entry lives in [`packages/sourcejs/players/engines/orangebox/cstrike.js`](../../packages/sourcejs/players/engines/orangebox/cstrike.js). Generic OrangeBox-family item creation remains in [`players/engines/orangebox`](players-engines-orangebox.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Input forms](#input-forms)
- [Confirm the CSS build](#confirm-the-css-build)
- [Find the C4 carrier](#find-the-c4-carrier)
- [Specialized player](#specialized-player)
- [Respawn dead players](#respawn-dead-players)
- [Administrative respawn command](#administrative-respawn-command)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

Import the complete four-export surface directly:

```js
const {
	HasC4,
	GetPlayer,
	Spawn,
	Branch,
} = require("players/engines/orangebox/cstrike");

if ((Branch !== "css") || (typeof HasC4 !== "function") || (typeof GetPlayer !== "function") || (typeof Spawn !== "function")) {
	throw new Error("The CSS player module has an unexpected export surface.");
}

module.exports = { Branch, HasC4, GetPlayer, Spawn };
```

The native module is omitted outside the feature-gated CSS build. The packaged CommonJS entry remains present but cannot supply a missing SDK capability; requiring it without the native module throws `Error` with `SourceJS module is not installed: players/engines/orangebox/cstrike`.

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `Branch` | `"css"` initially | Metadata for the concrete HL2SDK selected when the binary was compiled. |
| `HasC4(Player)` | boolean | Scan live `weapon_c4` entities and compare their current owner handle with the player index. |
| `GetPlayer(Player)` | specialized player object | Create a native player wrapper with CSS-specific `HasC4()` and `Spawn(bForce = false)` methods. |
| `Spawn(Player, bForce = false)` | boolean | Return `false` for a non-forced eligibility skip, or `true` after state writes and `VSERVERTOOLS001::DispatchSpawn()` complete without an exception. |

The specialized wrapper also contains the common native player fields and methods documented under [`players/entity`](players-entity.md).

## Input forms

`GetPlayer`, `HasC4` and `Spawn` resolve their player argument through the native indexed-value parser. Pass either:

- a primitive Number representing a current positive Int32 player index;
- a current indexed player object such as an entry returned by `GetHumanPlayers()`;
- another current indexed object whose `Index` getter resolves to a primitive Int32 Number. Inherited `Index` access is also allowed; no strings, booleans, BigInt, fractions, or out-of-range numbers are coerced as the index.

The wrapper returned by `GetPlayer()` is a new JavaScript object over the same engine slot. It does not clone the player or its inventory.

## Confirm the CSS build

Use the compile-time branch value as a startup invariant for a CSS-only plugin:

```js
const { Branch } = require("players/engines/orangebox/cstrike");

if (Branch !== "css") {
	throw new Error(`Expected the css SDK branch, received ${Branch}.`);
}

module.exports = { SelectedBranch: Branch };
```

The compiled SDK/ABI is fixed through map changes. `Branch` is an ordinary writable metadata property, not an ABI selector: changing it or the module's functions does not install another SDK. Do not overwrite the metadata to simulate another branch.

## Find the C4 carrier

Resolve the human roster immediately before checking C4 ownership:

```js
const { GetHumanPlayers } = require("players/bots");
const { HasC4 } = require("players/engines/orangebox/cstrike");

function FindC4Carrier() {
	const nMaximumPlayerIndex = 2147483647;

	const vecCurrentHumans = GetHumanPlayers();
	if (!Array.isArray(vecCurrentHumans)) {
		throw new Error("players/bots.GetHumanPlayers() did not return an array.");
	}

	for (const CurrentPlayer of vecCurrentHumans) {
		const nPlayerIndex = CurrentPlayer.Index;
		if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumPlayerIndex)) {
			throw new Error("The human roster contains an invalid player index.");
		}

		const bCarriesC4 = HasC4(nPlayerIndex);
		if (typeof bCarriesC4 !== "boolean") {
			throw new Error(`HasC4() returned an invalid result for player ${nPlayerIndex}.`);
		}

		if (bCarriesC4) {
			return CurrentPlayer;
		}
	}

	return null;
}

module.exports = { FindC4Carrier };
```

`HasC4()` walks the current entity range, selects entities whose class is exactly `weapon_c4` and reads each live `m_hOwnerEntity` handle. The result is not based on a retained inventory snapshot.

## Specialized player

Use `GetPlayer()` when one workflow needs both CSS-specific methods on the same current slot: Native `HasC4` and `Spawn` methods are created as own function properties without invoking inherited setters.

```js
const { GetPlayer } = require("players/engines/orangebox/cstrike");

function RequirePlayerIndex(nPlayerIndex) {
	const nMaximumPlayerIndex = 2147483647;
	if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumPlayerIndex)) {
		throw new TypeError("nPlayerIndex must be a positive Int32 Number.");
	}
}

function InspectCSSPlayer(nPlayerIndex) {
	RequirePlayerIndex(nPlayerIndex);

	const CSSPlayer = GetPlayer(nPlayerIndex);
	if (!CSSPlayer || (typeof CSSPlayer.HasC4 !== "function") || (typeof CSSPlayer.Spawn !== "function")) {
		throw new Error(`GetPlayer(${nPlayerIndex}) did not return a CSS player wrapper.`);
	}

	const nResolvedPlayerIndex = CSSPlayer.Index;
	if (nResolvedPlayerIndex !== nPlayerIndex) {
		throw new Error("The CSS player wrapper resolved to another engine slot.");
	}

	const bCarriesC4 = CSSPlayer.HasC4();
	if (typeof bCarriesC4 !== "boolean") {
		throw new Error(`Player.HasC4() returned an invalid result for player ${nPlayerIndex}.`);
	}

	return { CarriesC4: bCarriesC4, Index: nResolvedPlayerIndex };
}

function RespawnWithCSSPlayer(nPlayerIndex, bForce = false) {
	RequirePlayerIndex(nPlayerIndex);

	if (typeof bForce !== "boolean") {
		throw new TypeError("bForce must be a boolean.");
	}

	const CSSPlayer = GetPlayer(nPlayerIndex);
	if (!CSSPlayer || (typeof CSSPlayer.Spawn !== "function")) {
		throw new Error(`GetPlayer(${nPlayerIndex}) did not return a CSS player wrapper.`);
	}

	const bSpawned = CSSPlayer.Spawn(bForce);
	if (typeof bSpawned !== "boolean") {
		throw new Error(`Player.Spawn() returned an invalid result for player ${nPlayerIndex}.`);
	}

	return bSpawned;
}

module.exports = { InspectCSSPlayer, RespawnWithCSSPlayer };
```

Defining these helpers does not respawn anyone. The plugin must call `RespawnWithCSSPlayer()` from an explicit command, event or other deliberate action.

## Respawn dead players

The top-level `Spawn()` function accepts a current Int32 player index. This deliberate bulk operation requeries the roster, reads the native wrapper's numeric `Team` property, captures each entry's fields, then filters and submits the captured index:

```js
const { GetHumanPlayers } = require("players/bots");
const { Spawn } = require("players/engines/orangebox/cstrike");

function RespawnDeadHumans() {
	const nMaximumPlayerIndex = 2147483647;
	const nMaximumNonPlayingTeamNumber = 1;

	const vecCurrentHumans = GetHumanPlayers();
	const vecResults = [];

	if (!Array.isArray(vecCurrentHumans)) {
		throw new Error("players/bots.GetHumanPlayers() did not return an array.");
	}

	for (const CurrentPlayer of vecCurrentHumans) {
		const nPlayerIndex = CurrentPlayer.Index;
		const bDead = CurrentPlayer.Dead;
		const nTeamNumber = CurrentPlayer.Team;
		if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumPlayerIndex) || (typeof bDead !== "boolean") || !Number.isInteger(nTeamNumber)) {
			throw new Error("The human roster contains invalid live player state fields.");
		}

		if (!bDead || (nTeamNumber <= nMaximumNonPlayingTeamNumber)) {
			continue;
		}

		const bSpawned = Spawn(nPlayerIndex, false);
		if (typeof bSpawned !== "boolean") {
			throw new Error(`Spawn() returned an invalid result for player ${nPlayerIndex}.`);
		}

		vecResults.push({ Index: nPlayerIndex, Spawned: bSpawned });
	}

	return vecResults;
}

module.exports = { RespawnDeadHumans };
```

The non-forced call returns `false` without mutating the player when the target is alive or has a team index less than or equal to `1`. The native true-result path writes `m_iPlayerState` as `0`, writes `m_lifeState` as `LIFE_ALIVE`, then dispatches the existing player entity. `Spawned` is the example's result-key spelling: `true` means that dispatch returned without a native exception, not proof of the final game-DLL state. The bulk requests are independent; an error aborts the loop without undoing earlier writes or dispatches or returning a partial result. Do not blindly retry the whole bulk operation.

## Administrative respawn command

This server command accepts one positive player index and an optional literal `force`. It reports both completed dispatches and eligibility-skipped calls and unregisters the exact callback during unload:

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/server");
const { LogInfo, LogWarning } = require("loggers");
const { Spawn } = require("players/engines/orangebox/cstrike");

function RespawnCSSPlayer(Command) {
	const nMaximumPlayerIndex = 2147483647;

	const nPlayerIndex = Number(Command.Arguments[1]);
	const strMode = Command.Arguments[2];
	const bInvalidMode = (strMode !== undefined) && (strMode !== "force");
	if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumPlayerIndex) || bInvalidMode || (Command.Arguments.length < 2) || (Command.Arguments.length > 3)) {
		if (!LogWarning("Usage: sjs_css_respawn <player-index> [force]")) {
			throw new Error("Unable to write the CSS respawn usage message.");
		}

		return CommandReturn.Block;
	}

	const bForce = strMode === "force";
	const bSpawned = Spawn(nPlayerIndex, bForce);
	if (typeof bSpawned !== "boolean") {
		throw new Error("The CSS SDK returned an invalid respawn result.");
	}

	const strOutcome = bSpawned ? "dispatch completed" : "not eligible";
	if (!LogInfo(`CSS player ${nPlayerIndex}: ${strOutcome}; Force=${bForce}.`)) {
		throw new Error("Unable to write the CSS respawn result.");
	}

	return CommandReturn.Handled;
}

if (!RegisterCommand("sjs_css_respawn", RespawnCSSPlayer)) {
	throw new Error("Unable to register sjs_css_respawn.");
}

function Unload() {
	if (!UnregisterCommand("sjs_css_respawn", RespawnCSSPlayer)) {
		throw new Error("Unable to unregister sjs_css_respawn.");
	}
}

module.exports = { RespawnCSSPlayer, Unload };
```

See [`commands/server`](commands-server.md) for command payload ownership and [`loggers`](loggers.md) for the checked output functions.

## Errors

- The native module is installed only in a capable `css` build. Other SDK builds fail when the packaged entry requests that native module during `require()`.
- Omitting the required player argument throws. A supplied index or indexed object must resolve to a current player known to `IPlayerInfoManager`.
- `HasC4()` throws when globals are unavailable or a live `weapon_c4` lacks the required `m_hOwnerEntity` send property. It returns `false` when no current C4 belongs to the player.
- A present owner property with an unresolvable handle is skipped. The native reader checks the handle storage's alignment and address-width overflow before reading it; this is not a check that arbitrary memory is mapped/live or a guarantee of stable ownership.
- Exceptions from `Index` getters propagate unchanged through `GetPlayer()`, `HasC4()`, `Spawn()`, and the specialized methods' receiver lookup.
- Native C++ exceptions become operation-specific JavaScript errors at the `GetPlayer()`, `HasC4()`, `Spawn()`, `Player.HasC4()`, and `Player.Spawn()` callback boundaries.
- `bForce`, when supplied to either spawn form, must be a primitive boolean; only omission selects `false`. Explicit `null`, `undefined`, numbers, strings, and Boolean objects are rejected.
- `Spawn()` rejects a disconnected player before eligibility checks. The eligible/forced path also throws for a missing live entity, missing `m_iPlayerState` or `m_lifeState` property, or unavailable `VSERVERTOOLS001`; a non-forced eligibility skip returns before those mutation-path checks.
- `Player.Spawn(false)` (or `Spawn(Player, false)`) returns `false` when the player is alive or its team index is less than or equal to `1`. Passing `true` as `bForce` bypasses only those eligibility checks.
- Server-tools availability is checked before state writes. A later property failure or SDK dispatch exception does not roll back earlier writes. Player state is written as an `int`; `m_lifeState` uses the selected CSS SDK's one-byte `char` storage, without overwriting adjacent fields.

## Lifecycle

Run these APIs and examples on the game thread. They perform synchronous SDK queries/mutation, not queued background requests, and have no `Options`/callback/`Blocking` mode. The engine owns player edicts, entity memory and the C4 owner handle. SourceJS creates JavaScript wrappers over current slots and does not own or retain the underlying players.

Requery rosters and reacquire specialized wrappers after disconnects, team changes, entity removal and map transitions. Do not keep a `GetPlayer()` result as a permanent identity: removal or slot reuse can invalidate the view or redirect it to another entity. The roster and state fields are not an atomic snapshot. The examples capture explicit live-field reads before calls; those primitives preserve diagnostics but cannot guarantee the same player remains present during game callbacks.

Register commands once when the plugin loads and unregister the same name/callback pair during unload. Export cleanup under the runtime's exact `Unload` key. Registration never invokes the handler; the helpers perform no spawn operation until called deliberately. A failed dispatch, later validation, or logger error cannot roll back earlier native state writes. Preserve the original error and inspect current game state before deciding whether another request is safe. The native unload path continues its own teardown even when this export reports a failure. If a manual cleanup attempt fails before native unload starts, keep the original callback/context alive and retry that attempt rather than registering a replacement.

## Related modules

- [`players/engines/orangebox`](players-engines-orangebox.md) provides generic item creation for OrangeBox-family builds.
- [`players/entity`](players-entity.md) documents the common native player wrapper.
- [`players/bots`](players-bots.md) returns current human and bot rosters.
- [`commands/server`](commands-server.md) owns server-command registration and callback payloads.
- [`loggers`](loggers.md) provides checked SourceJS log output.
