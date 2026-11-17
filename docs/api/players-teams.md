# `require("players/teams")`

> AI processing note: this page documents the selected-SDK team profile. Read the profile and mapping sections before writing branch-portable team logic.

The `players/teams` module loads the packaged team profile for the current Source 1 SDK and exposes current name/number/class maps, team-manager class names, player filtering, and native team changes. It deliberately does not export game-specific constants such as `SURVIVOR`, `INFECTED`, `RED`, or `BLUE`.

The public entry lives in [`packages/sourcejs/players/teams.js`](../../packages/sourcejs/players/teams.js) and returns the exact native module object. Profile data comes from the current runtime data path, normally `addons/sourcejs/data/sourcejs/teams/<profile>.ini`. Profile queries reload that file; numeric selectors do not read it. The module does not keep a JavaScript profile cache.

## Contents

- [Import](#import)
- [Selected Profile](#selected-profile)
- [Names And Numbers](#names-and-numbers)
- [Classes And Managers](#classes-and-managers)
- [Filtering Players](#filtering-players)
- [Changing Teams](#changing-teams)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	DataProfile,
	GetTeamProfile,
	SDKBranch,
	GetTeamSupportedBranches,
} = require("players/teams");

function InspectTeamProfile() {
	const strProfileFromDisk = GetTeamProfile();
	const vecBranches = GetTeamSupportedBranches();

	if (strProfileFromDisk !== DataProfile) {
		throw new Error(`Installed profile ${DataProfile} does not match ${strProfileFromDisk} from disk.`);
	}

	if (!vecBranches.includes(SDKBranch)) {
		throw new Error(`The selected SDK branch is not supported: ${SDKBranch}.`);
	}

	return { DataProfile, ProfileFromDisk: strProfileFromDisk, SDKBranch };
}

module.exports = { InspectTeamProfile };
```

| Export | Result | Purpose |
| --- | --- | --- |
| `SDKBranch` | `string` | Build-time HL2SDK branch used by this binary. |
| `DataProfile` | `string` | Team-profile name selected when the module is installed. |
| `GetTeamProfile()` | `string` | Load the current file and return the profile name selected by this binary's SDK branch. |
| `GetTeamSupportedBranches()` | string array | Return the binary's static Source 1 branch list without reading the profile; Source 2 branches are absent. |

Profile mappings account for repository/Valve naming differences, for example `l4d2` uses `left4dead2.ini`, `css` uses `cstrike.ini`, and `tf2` uses `tf.ini`.

## Selected Profile

| Function | Result | Purpose |
| --- | --- | --- |
| `GetTeamData()` | profile object | Return `{ Names, Numbers, ClassesByName, ClassesByNumber, Managers }` from the current profile file. |
| `GetTeamNames()` | object | Return public team name to integer number mappings. |
| `GetTeamNumbers()` | object | Return integer number to public team name mappings. |
| `GetTeamClassesByName()` | object | Return public player-class name to integer class mappings. |
| `GetTeamClassesByNumber()` | object | Return integer class to public player-class name mappings. |
| `GetTeamManagers()` | string array | Return configured team-manager entity class names. |

Each call returns a new JavaScript object or array built from current profile data. Mutating the returned value does not edit the INI file or another call's result.

Native mapping entries, manager-array indices, and the five `GetTeamData()` fields are own writable, enumerable, configurable data properties; inherited setters are not invoked. Name/class keys use the native PascalCase conversion of configured names; reverse-map signed numeric keys are converted to strings. SDK branch strings retain their exported identifiers. `GetTeamSupportedBranches()` likewise returns an array with own index properties.

Profile-loading errors propagate their diagnostic before a result is built. Native construction stops if a mapping key or value cannot be created, without returning a partially populated result. These are plain objects/arrays, not `Map` instances; use own keys rather than inherited properties. Manager class names are exact engine strings.

The example below compares separate file reads, not an atomic snapshot. Use it while the profile remains unchanged; concurrent file edits can legitimately produce a mismatch. Native parsing skips unrecognized or malformed entries, so a successfully loaded profile is not proof that every line was valid.

```js
const {
	GetTeamClassesByName,
	GetTeamClassesByNumber,
	GetTeamData,
	GetTeamManagers,
	GetTeamNames,
	GetTeamNumbers,
} = require("players/teams");

function InspectTeamData() {
	const Profile = GetTeamData();
	const CurrentNames = GetTeamNames();
	const CurrentNumbers = GetTeamNumbers();
	const CurrentClassesByName = GetTeamClassesByName();
	const CurrentClassesByNumber = GetTeamClassesByNumber();
	const vecCurrentManagers = GetTeamManagers();

	if (JSON.stringify(Profile.Names) !== JSON.stringify(CurrentNames)) {
		throw new Error("GetTeamData().Names does not match GetTeamNames().");
	}

	if (JSON.stringify(Profile.Numbers) !== JSON.stringify(CurrentNumbers)) {
		throw new Error("GetTeamData().Numbers does not match GetTeamNumbers().");
	}

	if (JSON.stringify(Profile.ClassesByName) !== JSON.stringify(CurrentClassesByName)) {
		throw new Error("GetTeamData().ClassesByName does not match GetTeamClassesByName().");
	}

	if (JSON.stringify(Profile.ClassesByNumber) !== JSON.stringify(CurrentClassesByNumber)) {
		throw new Error("GetTeamData().ClassesByNumber does not match GetTeamClassesByNumber().");
	}

	if (JSON.stringify(Profile.Managers) !== JSON.stringify(vecCurrentManagers)) {
		throw new Error("GetTeamData().Managers does not match GetTeamManagers().");
	}

	return {
		ClassesByName: CurrentClassesByName,
		ClassesByNumber: CurrentClassesByNumber,
		Managers: vecCurrentManagers,
		Names: CurrentNames,
		Numbers: CurrentNumbers,
	};
}

module.exports = { InspectTeamData };
```

## Names And Numbers

| Function | Result | Purpose |
| --- | --- | --- |
| `GetTeamNumber(Team)` | signed Int32 `number` | Pass a primitive Int32 through without profile I/O, or load the profile to resolve a string. Missing, `undefined`, `null`, and unknown strings produce `-1`. |
| `GetTeamName(nTeamIndex)` | `string` | Require a primitive Int32 and load the profile to resolve its name. Unmapped numbers, including negative values, produce `""`. |

String lookup is ASCII case-insensitive and ignores `_`, `-`, and ordinary spaces; tabs and other characters are not ignored. Returned names follow native PascalCase conversion: separators are removed, the initial character and the character after each separator are capitalized, and other characters retain their spelling. Numeric strings are names, not coerced numbers. Booleans, BigInts, boxed values, fractions, non-finite numbers, and numbers outside Int32 are rejected.

Profile numbers are signed. Duplicate or normalization-colliding names/numbers need not form a one-to-one mapping; the inspection examples intentionally reject non-reversible configuration instead of claiming the parser rejects it.

```js
const {
	GetTeamName,
	GetTeamNames,
	GetTeamNumber,
} = require("players/teams");

function InspectTeamMappings() {
	const vecMappings = [];

	for (const [strTeamName, nTeamNumber] of Object.entries(GetTeamNames())) {
		const strNormalizedName = strTeamName.replace(/[A-Z]/g, (strCharacter) => `_${strCharacter.toLowerCase()}`);
		const strResolvedName = GetTeamName(nTeamNumber);
		const nResolvedNumber = GetTeamNumber(strTeamName);
		const nNormalizedNumber = GetTeamNumber(strNormalizedName);

		if ((strResolvedName !== strTeamName) || (nResolvedNumber !== nTeamNumber) || (nNormalizedNumber !== nTeamNumber)) {
			throw new Error(`Team mapping is not reversible: ${strTeamName}=${nTeamNumber}.`);
		}

		vecMappings.push({ Name: strResolvedName, Number: nResolvedNumber });
	}

	return vecMappings;
}

module.exports = { InspectTeamMappings };
```

## Classes And Managers

Class maps may be empty for games without a configured player-class concept. Manager names are entity server-class names, not JavaScript managers.

```js
const {
	GetTeamClassesByName,
	GetTeamClassesByNumber,
	GetTeamManagers,
} = require("players/teams");

function InspectTeamClasses() {
	const ByName = GetTeamClassesByName();
	const ByNumber = GetTeamClassesByNumber();

	for (const [strClassName, nClassNumber] of Object.entries(ByName)) {
		if (ByNumber[nClassNumber] !== strClassName) {
			throw new Error(`Player-class mapping is not reversible: ${strClassName}=${nClassNumber}.`);
		}
	}

	return {
		ByName,
		ByNumber,
		ManagerClasses: GetTeamManagers(),
	};
}

module.exports = { InspectTeamClasses };
```

## Filtering Players

| Function | Result | Purpose |
| --- | --- | --- |
| `GetPlayersByTeam(Team?)` | native player array | Resolve an Int32 or configured name; include connected matching players. Omitted, `undefined`, `null`, unknown names, and **every negative Int32** select all connected players. |

`GetPlayersByTeam()` includes both human players and bots, skips disconnected/free slots, and enumerates in ascending entity-index order. A non-negative number absent from the profile is still a numeric filter. Only string selectors read the profile. Use [`players/bots`](players-bots.md) or [`filters/players`](filters-players.md) when fake-client filtering is required.

Validate a configured name and its non-negative result before filtering; otherwise an unknown/negative selector broadens the query to all connected players. The example treats negative configured numbers as invalid plugin policy.

```js
const {
	GetPlayersByTeam,
	GetTeamName,
	GetTeamNames,
	GetTeamNumber,
} = require("players/teams");

function InspectTeamRosters() {
	const Rosters = Object.create(null);

	for (const [strTeamName, nTeamNumber] of Object.entries(GetTeamNames())) {
		if ((nTeamNumber < 0) || (GetTeamNumber(strTeamName) !== nTeamNumber) || (GetTeamName(nTeamNumber) !== strTeamName)) {
			throw new Error(`Invalid team mapping: ${strTeamName}=${nTeamNumber}.`);
		}

		const vecRoster = GetPlayersByTeam(strTeamName);
		if (vecRoster.some((Player) => Player.Team !== nTeamNumber)) {
			throw new Error(`GetPlayersByTeam() returned a player outside ${strTeamName}.`);
		}

		Rosters[strTeamName] = vecRoster.map((Player) => Player.Index);
	}

	return {
		AllConnected: GetPlayersByTeam().map((Player) => Player.Index),
		Rosters,
	};
}

module.exports = { InspectTeamRosters };
```

## Changing Teams

| Function | Result | Purpose |
| --- | --- | --- |
| `ChangePlayerTeam(nEntityIndex, Team)` | `true` | Resolve an index or index-bearing player record, then a primitive Int32 or configured name; require a non-negative result and valid player information on a non-free edict before `IPlayerInfo::ChangeTeam()`. A throwing `Index` getter aborts before team resolution or the gameplay action. |

For the example, select a target name from `GetTeamNames()` or plugin configuration validated through `GetTeamNumber()`. The native API also accepts a non-negative Int32 directly, without profile membership checks or profile I/O. `true` means the void SDK `ChangeTeam()` call returned, not that the game accepted or retained the requested team. Team changes can trigger game-specific side effects; `Changed` below compares the previous team with the requested target, not a post-change verification.

```js
const { Player } = require("players/entity");
const { ChangePlayerTeam, GetTeamNumber } = require("players/teams");

function MovePlayerToTeam(unPlayerIndex, strConfiguredTeamName) {
	const nMinimumInt32Value = -2147483648;
	const nMaximumInt32Value = 2147483647;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive Int32.");
	}

	if ((typeof strConfiguredTeamName !== "string") || (strConfiguredTeamName.length === 0)) {
		throw new TypeError("strConfiguredTeamName must be a non-empty string.");
	}

	const nTargetTeam = GetTeamNumber(strConfiguredTeamName);
	if (!Number.isInteger(nTargetTeam) || (nTargetTeam < 0) || (nTargetTeam > nMaximumInt32Value)) {
		throw new RangeError(`Unknown or invalid team name: ${strConfiguredTeamName}.`);
	}

	const CurrentPlayer = Player(unPlayerIndex);
	if ((CurrentPlayer === null) || (typeof CurrentPlayer !== "object") || Array.isArray(CurrentPlayer)) {
		throw new TypeError(`Player ${unPlayerIndex} did not return a player record.`);
	}

	const unResolvedPlayerIndex = CurrentPlayer.Index;
	if (unResolvedPlayerIndex !== unPlayerIndex) {
		throw new Error(`Player ${unPlayerIndex} returned a different index.`);
	}

	const IsConnected = CurrentPlayer.IsConnected;
	const GetTeam = CurrentPlayer.GetTeam;
	if ((typeof IsConnected !== "function") || (typeof GetTeam !== "function")) {
		throw new TypeError(`Player ${unPlayerIndex} requires IsConnected() and GetTeam().`);
	}

	const bConnected = IsConnected.call(CurrentPlayer);
	if (typeof bConnected !== "boolean") {
		throw new TypeError(`Player ${unPlayerIndex} returned an invalid connection status.`);
	}

	if (!bConnected) {
		throw new Error(`Player ${unPlayerIndex} is not connected.`);
	}

	const nPreviousTeam = GetTeam.call(CurrentPlayer);
	if (!Number.isInteger(nPreviousTeam) || (nPreviousTeam < nMinimumInt32Value) || (nPreviousTeam > nMaximumInt32Value)) {
		throw new TypeError(`Player ${unPlayerIndex} returned an invalid previous team.`);
	}

	if (ChangePlayerTeam(unPlayerIndex, nTargetTeam) !== true) {
		throw new Error(`Failed to request team ${strConfiguredTeamName} for player ${unPlayerIndex}.`);
	}

	return {
		Changed: nPreviousTeam !== nTargetTeam,
		Index: unResolvedPlayerIndex,
		PreviousTeam: nPreviousTeam,
		TargetTeam: nTargetTeam,
	};
}

module.exports = { MovePlayerToTeam };
```

## Errors

- Never hard-code team or class constants in a plugin intended for multiple SDK branches. Read `GetTeamNames()` and `GetTeamClassesByName()` or validate configured names through `GetTeamNumber()`.
- `GetPlayersByTeam()` has no boolean bot-inclusion argument; it returns all connected matching players.
- Unknown names resolve to `-1` in `GetTeamNumber()`; only `GetTeamName()` returns `""` for an unmapped numeric input. `GetTeamNumber()` passes any primitive Int32 through, including negatives. In `GetPlayersByTeam()`, all negative selectors (not only `-1`) disable team filtering.
- Native team-number/name, player-by-team, profile/data/class/manager/branch enumeration and `ChangePlayerTeam()` callbacks catch C++ exceptions and attempt to raise JavaScript errors while preserving these sentinels and filters. Player-index getter exceptions propagate unchanged, including during C++ unwinding. Failed result construction does not publish partial records or an empty native profile-string handle. SDK and profile failures still propagate; the guards do not pin the roster or engine interfaces through reentrant lifecycle changes or guarantee Error-object allocation, termination recovery or allocator/OOM recovery.
- `ChangePlayerTeam()` requires valid player information on a non-free edict and rejects negative numbers or unknown configured names with a native error. It does not itself test `IsConnected()`; that is the example's additional precondition. A non-negative numeric team is passed directly to the selected game even when it is absent from the profile.
- A missing/unreadable profile or a profile with no usable `[names]` entries throws with its path; unavailable runtime paths also fail. Malformed individual lines may be skipped rather than rejected. SourceJS does not install a generic fallback profile. Profile-dependent queries can fail even for an unknown name/number.

## Lifecycle

Profile queries (`GetTeamData`, mapping/manager getters, `GetTeamName`, `GetTeamProfile`, and string name resolution) load the selected file each time. `DataProfile`/`SDKBranch` are installation metadata; `GetTeamSupportedBranches()` returns a fresh static-list array. Numeric/null/omitted selector resolution does not load the file. Edit the owning INI file to persist configuration; repeated calls are independent reads, not a synchronized snapshot.

`GetPlayersByTeam()` resolves the connected roster when called. `ChangePlayerTeam()` immediately delegates to `IPlayerInfo::ChangeTeam()` and does not provide automatic rollback on plugin unload or map transition.

Run SDK player operations on the game thread after player interfaces/globals are initialized. Native player records borrow live engine state, and indices can be reused after disconnect; a roster is neither an immutable snapshot nor a lifetime pin. Use a controlled game phase without disconnect, map transition, or reentrant hooks invalidating the player between checks and mutation; the example cannot enforce that lifetime guarantee. There is no worker-thread or automatic rollback contract here.

The examples export functions without invoking them at plugin load. The plugin owner chooses when to inspect current data or request a team change. Errors from profile reads, player getters/methods, and the native change propagate unchanged; the example passes its checked numeric target to avoid a second name/profile lookup.

## Related Modules

- [`players/entity`](players-entity.md) exposes the current `Team` property and instance `SetTeam()` method.
- [`players/bots`](players-bots.md) separates current human and fake clients.
- [`filters/players`](filters-players.md) combines team, bot and alive-state filters.
- [`entities/classes`](entities-classes.md) finds team-manager entities by the configured server-class names.
