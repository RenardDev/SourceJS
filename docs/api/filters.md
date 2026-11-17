# `require("filters")`

> AI navigation: use the contents to locate scans, live fields, recipient records, ownership, and errors. This hand-maintained reference follows the installed native module; navigation does not replace a full review when required.

Module index: [SourceJS API Reference](README.md)

The root `filters` module exposes four low-level, one-shot scans over the current server state. It does not cache results and it does not aggregate the higher-level iterator modules. Import `filters/players`, `filters/entities`, `filters/recipients`, or `filters/weapons` when reusable predicates or mutable recipient collections are needed.

Scans and live wrapper operations run synchronously on the server/game thread. They do not enqueue backend IO requests or accept `Blocking` options.

The installed native `filters` module is required. Missing runtime/module lookup or required engine capabilities fails rather than installing a fallback collection. A module being present does not prove that every required engine interface is currently available.

## Contents

- [Import](#import)
- [Result lifetime](#result-lifetime)
- [`GetAllPlayers`](#getallplayers)
- [`GetAllEntities`](#getallentities)
- [`GetAllRecipients`](#getallrecipients)
- [`GetAllWeapons`](#getallweapons)
- [Errors and ownership](#errors-and-ownership)

## Import

```js
const {
	GetAllEntities,
	GetAllPlayers,
	GetAllRecipients,
	GetAllWeapons,
} = require("filters");
```

The module has four public scan operations: `GetAllEntities`, `GetAllPlayers`, `GetAllRecipients`, and `GetAllWeapons`. It does not expose nested namespaces, a module-name field, or a default export.

## Result lifetime

Separate scan calls are independent observations, not one atomic world snapshot; do not assume their counts or wrapper identities describe the same instant.

Each call scans native state immediately and returns a new JavaScript array or recipient record:

- arrays and recipient indexes are point-in-time collections;
- entity, player, and weapon entries are fresh native wrappers whose accessors read current state while their indexes resolve; a wrapper does not pin an entity or preserve identity across index reuse;
- `GetAllRecipients()` returns a point-in-time recipient record whose `RecipientPlayers` entries are live native Player wrappers;
- the separate `filters/players` package returns compact player records with values captured by that scan;
- no result keeps an entity or player alive across deletion, disconnect, index reuse, or a map transition;
- do not store scan results as a permanent registry.

## `GetAllPlayers`

### `GetAllPlayers()`

Returns a new array containing every connected player recognized by `IPlayerInfoManager`, including bots. The array is ordered by entity index.

Each result is a native Player wrapper with the live properties below and the native Entity fields and methods described under `GetAllEntities`:

| Field | Type | Meaning |
| --- | --- | --- |
| `Index` | number | Current client entity index. |
| `Name` | string | Player name. |
| `UserID` | number | Engine user ID. |
| `NetworkID` | string | Engine network identifier, such as a Steam2 ID or `BOT`. |
| `RemoteAddress` | string | Remote network endpoint for a connected human, otherwise an empty string. |
| `Team` | number | Current team index. |
| `Frags`, `Deaths` | number | Current scoreboard counters. |
| `Health`, `MaximumHealth` | number | Current health values. |
| `Connected`, `FakeClient`, `Dead`, `Free` | boolean | Connection, bot, life, and edict state. |
| `Language` | string | Human client's `cl_language`; empty for bots or unavailable clients. |
| `Origin` | object | Current absolute origin with `X`, `Y`, and `Z` components. |
| `Weapon`, `Model` | string | Current weapon and model names. |

The wrapper also provides `Slay()`, `ExecuteClientCommand(strCommand, bServerSide?)`, `SetName(strName)`, `Say(strMessage)`, `SayTeam(strMessage)`, `Kick(strMessage?)`, `Ban(nBanDuration?, bKickPlayer?, bWriteBanList?)`, and `ChangeTeam(TeamReference)`. SDKs with `CBasePlayer::GiveNamedItem` additionally provide `GiveNamedItem(strItem, nSubtype?, bRemoveIfNotCarried?)`; the final option exists only on SDKs whose method declares it.

`ChangeTeam(TeamReference)` accepts a non-negative signed 32-bit team index or a selected-profile team name. Name lookup ignores ASCII case and removes underscores, hyphens, and ordinary spaces. An unknown name or nullish/negative selector fails the non-negative-team check instead of selecting all teams; this differs from the unrestricted-scan fallback used by team scan helpers. Use the canonical keys from `GetTeamNames()` in `players/teams` when selecting a configured team.

Omitted native `Ban()` arguments default to `0`, `true`, and `true`. A supplied duration must be a primitive number containing a finite integer from `0` through `2147483647`; numeric `-0` is accepted as `0`. There is no numeric coercion: fractional, non-finite, out-of-range and non-number inputs, including explicit `undefined` or `null`, fail before receiver lookup or native command dispatch. Supplied flags must be primitive booleans. See the [compact-player duration contract](filters-players.md#compact-player-records). Command-dispatch success does not prove that a ban was applied or persisted by the engine.

The scan already supplies live Player wrappers. Read them directly at the point of use; no additional `Player()` conversion is required:

```js
const { GetAllPlayers } = require("filters");
const { LogInfo } = require("loggers");

const g_InspectCurrentPlayers = () => {
	for (const Player of GetAllPlayers()) {
		if (!Player.Connected) {
			continue;
		}

		LogInfo("RootFilterPlayer Index=%d Name=%s Team=%d", Player.Index, Player.Name, Player.Team);
	}
};

g_InspectCurrentPlayers();
```

## `GetAllEntities`

### `GetAllEntities()`

Scans edict indexes from zero through `CGlobalVars.maxEntities - 1`, skips free edicts, and returns a new array of native Entity objects.

Every result has live `Index`, `Valid`, `Free`, `ClassName`, `StateFlags`, `NetworkSerialNumber`, `Edict`, `BaseEntity`, `Address`, `BaseHandle`, and `HandleValue` properties. Core methods are `RemoveEntity()` and, when the selected SDK exposes `CBaseEntity::AcceptInput`, `SlayEntity()` and `CallEntityInput(strInputName, InputValue?, flInputDelay?)`.

SDK capability can add the complete typed send-property and datamap method families:

- `GetEntityProperty` and `SetEntityProperty`, with `Integer`, `Float`, `String`, `Vector`, and `Entity` variants;
- `GetEntityDataMap`, `GetEntityDataMapProperty`, and `SetEntityDataMapProperty`, with the same typed variants.

Use the scan to inspect the current world rather than maintaining a stale entity list:

```js
const { GetAllEntities } = require("filters");
const { LogInfo } = require("loggers");

const g_ReportBusiestEntityClasses = () => {
	const unMaximumReportedEntityClassCount = 10;
	const mapEntityCountsByClassName = new Map();

	const CompareEntityClassCounts = (vecLeftClassCountEntry, vecRightClassCountEntry) => vecRightClassCountEntry[1] - vecLeftClassCountEntry[1];

	for (const Entity of GetAllEntities()) {
		const unEntityClassCount = mapEntityCountsByClassName.get(Entity.ClassName) ?? 0;
		mapEntityCountsByClassName.set(Entity.ClassName, unEntityClassCount + 1);
	}

	const vecBusiestEntityClasses = [...mapEntityCountsByClassName.entries()].sort(CompareEntityClassCounts).slice(0, unMaximumReportedEntityClassCount);
	LogInfo("RootFilterEntityClasses %s", JSON.stringify(vecBusiestEntityClasses));
};

g_ReportBusiestEntityClasses();
```

See [`entities/entity`](entities-entity.md) for every Entity operation and its selected-SDK rules.

## `GetAllRecipients`

### `GetAllRecipients()`

Builds a point-in-time recipient record for all connected human clients. Bots are deliberately excluded; use `GetAllRecipients()` from [`filters/recipients`](filters-recipients.md) when they must be included.

| Field | Type | Meaning |
| --- | --- | --- |
| `RecipientIndexes` | number[] | Unique recipient entity indexes. |
| `RecipientPlayers` | object[] | Fresh native Player wrappers for indexes still connected while the result is built. |
| `RecipientCount` | number | Number of collected recipient indexes. |

The record can be passed directly to message APIs because they consume its `RecipientIndexes` array. Delivery still requires the corresponding message capability in a running SourceJS server context:

```js
const { GetAllRecipients } = require("filters");
const { SayText2 } = require("messages");

const g_SendConfigurationReloadMessage = () => {
	const Recipients = GetAllRecipients();
	if (Recipients.RecipientCount === 0) {
		return;
	}

	const Message = new SayText2("SourceJS configuration reloaded.", { Chat: true });
	if (!Message.SendUserMessage(Recipients)) {
		throw new Error("The configuration message could not be delivered.");
	}
};

g_SendConfigurationReloadMessage();
```

The root result is an ordinary JavaScript record, not a `RecipientFilter` instance or mutable native recipient state. Editing `RecipientIndexes` does not synchronize `RecipientCount` or `RecipientPlayers`; those fields describe the original scan. Use [`filters/recipients`](filters-recipients.md) for `RecipientFilter`, `AddRecipient()`/`RemoveRecipient()`/`UpdateRecipients()`, team selection, bot inclusion, and player resolution.

## `GetAllWeapons`

### `GetAllWeapons()`

Scans current non-free edicts and returns a new array for entities whose class names start with `weapon_`. It does not consult a game-specific weapon catalog. Each result has the complete native Entity fields and methods described above plus:

| Field | Type | Meaning |
| --- | --- | --- |
| `IsWeapon` | boolean | Whether the current class name starts with `weapon_`. |
| `Weapon` | string | Class name with the `weapon_` prefix removed. |

Build current diagnostics from the returned objects instead of assuming a game-specific weapon list:

```js
const { GetAllWeapons } = require("filters");
const { LogInfo } = require("loggers");

const g_ReportWeaponIndexesByName = () => {
	const mapWeaponIndexesByName = new Map();
	for (const Weapon of GetAllWeapons()) {
		let vecWeaponIndexes = mapWeaponIndexesByName.get(Weapon.Weapon);
		if (vecWeaponIndexes === undefined) {
			vecWeaponIndexes = [];
			mapWeaponIndexesByName.set(Weapon.Weapon, vecWeaponIndexes);
		}

		vecWeaponIndexes.push(Weapon.Index);
	}

	for (const vecWeaponNameEntry of mapWeaponIndexesByName) {
		const strWeaponName = vecWeaponNameEntry[0];
		const vecWeaponIndexes = vecWeaponNameEntry[1];
		LogInfo("RootFilterWeapon Name=%s Indexes=%s", strWeaponName, vecWeaponIndexes.join(", "));
	}
};

g_ReportWeaponIndexesByName();
```

Use [`filters/weapons`](filters-weapons.md) for reusable class/tag predicates and [`weapons/entity`](weapons-entity.md) for the decorated weapon API.

## Errors and ownership

- `GetAllPlayers()` and `GetAllRecipients()` require `IPlayerInfoManager`, `IVEngineServer`, and current globals/edicts.
- `GetAllEntities()` requires `CGlobalVars` and `IVEngineServer` edicts.
- `GetAllWeapons()` requires `CGlobalVars` and `IVEngineServer` edicts; classification uses each edict's class name.
- Missing engine prerequisites throw; an empty current world returns an empty collection.
- Returned arrays and `RecipientIndexes`/`RecipientPlayers` arrays belong to JavaScript and may be changed without changing the engine.
- `Address`, `Edict.Address`, and `BaseEntity.Address` are borrowed engine addresses represented as `bigint`. Never deallocate them or reuse them after the entity becomes invalid.
- Re-run the appropriate scan after disconnects, deletion, creation, or map transitions. If identity must survive deferred work, retain and compare the original serial-aware handle or client identity: a current getter can resolve a new occupant of the same index.
