# `require("players")`

> AI processing note: this page documents the complete root player facade. Use the contents and grouped API tables to read only the relevant workflow.

The `players` module resolves live engine clients and exposes the shared player operations used by every supported Source 1 branch. It combines the selected SDK's native `IPlayerInfo` and entity operations with SourceJS authorization, voice, trace, netchannel, sound, team-profile, and weapon services.

The public facade, shared decorator, and higher-level operations live together in [`packages/sourcejs/players/index.js`](../../packages/sourcejs/players/index.js). Use [`players/entity`](players-entity.md) when code primarily works with one decorated player object.

Operations backed by missing SDK properties or capabilities throw from the owning native module. SourceJS does not return fabricated player state. `GetFrozen()` and `SetFrozen()` are exported only when the selected SDK defines `FL_FROZEN`.

## Contents

- [Import](#import)
- [Resolving Players](#resolving-players)
- [Identity And Connection State](#identity-and-connection-state)
- [Teams And Classes](#teams-and-classes)
- [Commands, Chat, And Events](#commands-chat-and-events)
- [Moderation And Voice](#moderation-and-voice)
- [Movement And Player State](#movement-and-player-state)
- [View And Tracing](#view-and-tracing)
- [Client Networking](#client-networking)
- [Weapons And Ammunition](#weapons-and-ammunition)
- [Restrictions And Dropping](#restrictions-and-dropping)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	Player,
	Ban,
	ChangeTeam,
	DecoratePlayer,
	DropWeapon,
	ExecuteClientCommand,
	FireGameEvent,
	FromUserID,
	GetActiveWeapon,
	GetAllPlayers,
	GetClientCVarValue,
	GetClientCount,
	GetEyeLocation,
	GetFlashlight,
	GetFrozen,
	GetGodMode,
	GetJetpack,
	GetLanguage,
	GetMaximumClients,
	GetName,
	GetNetInfo,
	GetNoBlock,
	GetNoClip,
	GetPermissions,
	GetPlayerClass,
	GetPlayerClassName,
	GetPrimaryWeapon,
	GetProjectileAmmo,
	GetProjectileIndexes,
	GetRawSteamID,
	GetSecondaryWeapon,
	GetSpectators,
	GetStuck,
	GetTeam,
	GetTeamName,
	GetTraceRay,
	GetViewCoordinates,
	GetViewEntity,
	GetViewPlayer,
	GetViewVector,
	GetWeapon,
	GetWeaponIndexes,
	GetWeapons,
	IsBot,
	IsConnected,
	IsDead,
	IsFakeClient,
	IsHLTV,
	IsInAVehicle,
	IsMuted,
	IsObserver,
	IsWeaponRestricted,
	Kick,
	Mute,
	PlaySound,
	Push,
	RestrictWeapons,
	Say,
	SayTeam,
	SendConVarValue,
	SetActiveWeapon,
	SetEyeLocation,
	SetFlashlight,
	SetFrozen,
	SetGodMode,
	SetJetpack,
	SetName,
	SetNoBlock,
	SetNoClip,
	SetPlayerClass,
	SetPlayerClassName,
	SetProjectileAmmo,
	SetStuck,
	SetTeam,
	SetTeamName,
	SetViewCoordinates,
	SetViewEntity,
	SetViewPlayer,
	Slay,
	Spawn,
	Unmute,
	UnrestrictWeapons,
} = require("players");

const g_vecMandatoryGroups = [
	[Player, GetAllPlayers, GetClientCount, DecoratePlayer, FromUserID, GetMaximumClients],
	[Ban, ChangeTeam, ExecuteClientCommand, FireGameEvent, Kick, Mute, PlaySound, Say, SayTeam, Slay, Spawn, GetSpectators, Unmute],
	[GetLanguage, GetName, GetPermissions, GetRawSteamID, IsBot, IsConnected, IsDead, IsFakeClient, IsHLTV, IsInAVehicle, IsMuted, IsObserver],
	[GetPlayerClass, GetPlayerClassName, GetTeam, GetTeamName, SetName, SetPlayerClass, SetPlayerClassName, SetTeam, SetTeamName],
	[GetEyeLocation, GetTraceRay, GetViewCoordinates, GetViewEntity, GetViewPlayer, GetViewVector, Push, SetEyeLocation, SetViewCoordinates, SetViewEntity, SetViewPlayer],
	[GetClientCVarValue, GetNetInfo, SendConVarValue],
	[GetFlashlight, GetGodMode, GetJetpack, GetNoBlock, GetNoClip, GetStuck, SetFlashlight, SetGodMode, SetJetpack, SetNoBlock, SetNoClip, SetStuck],
	[DropWeapon, GetActiveWeapon, GetProjectileAmmo, GetWeapon, IsWeaponRestricted, GetPrimaryWeapon, GetProjectileIndexes, RestrictWeapons, GetSecondaryWeapon, SetActiveWeapon, SetProjectileAmmo, UnrestrictWeapons, GetWeaponIndexes, GetWeapons],
];

if (g_vecMandatoryGroups.flat().some((Callback) => typeof Callback !== "function")) {
	throw new Error("The players module does not expose its complete mandatory API.");
}

if ((typeof GetFrozen === "function") !== (typeof SetFrozen === "function")) {
	throw new Error("The selected SDK exposes an incomplete frozen-state capability.");
}
```

All standalone operations accept either a decorated player object or, where the underlying helper supports it, a player index. The objects returned by `Player()`, `FromUserID()`, or `GetAllPlayers()` borrow engine state; they neither own the player nor pin a slot against reuse. Re-resolve and validate participants in a controlled game-thread phase.

## Resolving Players

| Export | Result | Purpose |
| --- | --- | --- |
| `Player(PlayerReference)` | decorated player | Resolve a positive Int32 index or an object whose `Index` has that contract. A missing native player returns `null` at the native boundary; the decorator rejects it rather than fabricating a wrapper. |
| `FromUserID(nUserID)` | decorated player | Resolve a connected player for a signed Int32 engine user ID; missing/non-Int32 IDs fail native resolution. |
| `GetAllPlayers()` | decorated player array | Return connected players in ascending entity-index order, excluding free edict slots. |
| `GetMaximumClients()` | `number` | Read the live server client-slot limit. |
| `GetClientCount()` | `number` | Read the current connected-client count. |
| `DecoratePlayer(NativePlayer)` | same player object | Add SourceJS helper methods after checking the required native-method shape. This is not native-provenance validation; never fabricate a wrapper or native address. |

Resolve every object again after disconnects and map changes. Wrapper metadata is not a durable player identity; methods may resolve the current occupant of the stored slot. A wrapper does not own or extend the engine player's lifetime.

Native player-wrapper construction installs `Slay`, `ExecuteClientCommand`, `SetName`, `Say`, `SayTeam`, `Kick`, `Ban`, and `ChangeTeam` as own writable, enumerable, configurable data properties. `GiveNamedItem` is installed with the same attributes only when the selected SDK supports base entities. Inherited setters and non-writable prototype fields do not intercept these method initializers. This construction rule does not change `DecoratePlayer`'s structural acceptance of inherited callable methods or validate native provenance or lifetime.

Native enumeration creates own array-index data properties without invoking inherited index setters. Missing player-manager or engine/global-variable dependencies raise an error. A player-wrapper construction failure stops enumeration and propagates its original exception; no partial roster is returned.

```js
const {
	Player,
	GetAllPlayers,
	GetClientCount,
	DecoratePlayer,
	FromUserID,
	GetMaximumClients,
} = require("players");

function ReadRoster() {
	const unSlotCount = GetMaximumClients();
	const unConnectedCount = GetClientCount();
	const vecRoster = GetAllPlayers();

	if (!Number.isInteger(unSlotCount) || (unSlotCount < 0) || !Number.isInteger(unConnectedCount) || (unConnectedCount < 0) || (unConnectedCount > unSlotCount) || (vecRoster.length > unSlotCount)) {
		throw new Error("The engine returned inconsistent player counts.");
	}

	return vecRoster.map((CurrentPlayer) => {
		const PlayerByIndex = Player(CurrentPlayer.Index);
		const PlayerByUserID = FromUserID(CurrentPlayer.UserID);
		const DecoratedPlayer = DecoratePlayer(PlayerByIndex);

		if ((DecoratedPlayer !== PlayerByIndex) || (DecoratedPlayer.Index !== PlayerByUserID.Index) || (DecoratedPlayer.UserID !== PlayerByUserID.UserID)) {
			throw new Error(`Player resolution disagrees for slot ${CurrentPlayer.Index}.`);
		}

		return {
			Index: DecoratedPlayer.Index,
			UserID: DecoratedPlayer.UserID,
		};
	});
}

ReadRoster();

module.exports = { ReadRoster };
```

## Identity And Connection State

| Export | Result | Purpose |
| --- | --- | --- |
| `GetName(PlayerReference)` / `SetName(PlayerReference, strPlayerName)` | `string` / `boolean` | Read the current name or request a new name. The native `SetName()` binding preserves an exception from an object reference's `Index` getter and stops before requesting the name change. |
| `GetRawSteamID(PlayerReference)` | `SteamID \| null` | Parse the current network ID; null/empty IDs and `BOT` (case-insensitive) return `null`; invalid non-string IDs throw. |
| `GetPermissions(PlayerReference)` | `PlayerPermissions \| null` | Resolve the live authorization map for the player's network ID; `BOT` returns `null`, and malformed IDs can throw. |
| `GetLanguage(PlayerReference)` | `string` | Resolve the selected language through `players/helpers`. |
| `IsConnected(PlayerReference)` | `boolean` | Query current connection state. |
| `IsFakeClient(PlayerReference)` | `boolean` | Query the SDK fake-client flag. |
| `IsHLTV(PlayerReference)` | `boolean` | Query the SDK HLTV flag; this is not a separate replay-client test. |
| `IsBot(PlayerReference)` | `boolean` | Treat fake clients and the `BOT` network ID as bots. |
| `IsInAVehicle(PlayerReference)` | `boolean` | Query the selected SDK vehicle handle. |
| `IsObserver(PlayerReference)` | `boolean` | Query observer state. |
| `IsDead(PlayerReference)` | `boolean` | Query current death state. |

Native player properties and methods both perform current engine queries. Use methods such as `GetName()` and `IsConnected()` when their composed behavior is useful, and read properties when the direct `IPlayerInfo` value is the desired contract.

Native `players.SetName(Player, strName)` requires a primitive string before reading the player selector and a connected player before dispatch. It dispatches a server-side client `name` command, quoting the name, escaping quotes and backslashes, and replacing CR/LF with spaces. The SDK receives a C string, so an embedded NUL ends the command. The boolean reports dispatch, not a confirmed rename. C++ failures are caught and contextual JavaScript errors are attempted; an existing JavaScript exception is preserved, and a dispatched command is not rolled back. Error-object allocation and termination/OOM recovery are not guaranteed.

The native name, team, user ID, network ID, origin, connection-state, fake-client, and death-state queries preserve an exception from an object reference's `Index` getter and stop before the native player lookup. A missing player-information record is an error, unlike the sentinel results of live-property reads. C++ failures during lookup, the SDK query, or result construction trigger attempts to raise operation-specific JavaScript errors, such as `players.GetName() failed because a native C++ exception occurred.` Null native name/network-ID strings become `""`. Native `GetOrigin()` returns a detached snapshot with its own `X`, `Y`, and `Z` properties, not a live memory view. These queries do not validate an arbitrary native address or extend a player's lifetime, or guarantee Error-object allocation or termination/OOM recovery.

`GetPermissions()` returns a live `PlayerPermissions` map or `null` for `BOT`. The report below copies only direct permission-name keys, not inherited permissions or effective authorization decisions; use the authorization API for those checks.

```js
const {
	GetAllPlayers,
	GetLanguage,
	GetName,
	GetPermissions,
	GetRawSteamID,
	IsBot,
	IsConnected,
	IsDead,
	IsFakeClient,
	IsHLTV,
	IsInAVehicle,
	IsObserver,
} = require("players");

function ReadIdentity(CurrentPlayer) {
	const SteamID = GetRawSteamID(CurrentPlayer);
	const mapPermissions = GetPermissions(CurrentPlayer);

	if ((mapPermissions !== null) && !(mapPermissions instanceof Map)) {
		throw new Error(`Player ${CurrentPlayer.Index} has no valid permissions record.`);
	}

	const Identity = {
		Bot: IsBot(CurrentPlayer),
		Connected: IsConnected(CurrentPlayer),
		Dead: IsDead(CurrentPlayer),
		FakeClient: IsFakeClient(CurrentPlayer),
		HLTV: IsHLTV(CurrentPlayer),
		InVehicle: IsInAVehicle(CurrentPlayer),
		Language: GetLanguage(CurrentPlayer),
		Name: GetName(CurrentPlayer),
		Observer: IsObserver(CurrentPlayer),
		Permissions: (mapPermissions === null) ? null : [...mapPermissions.keys()],
		SteamID: (SteamID === null) ? null : SteamID.Render(),
	};
	const vecBooleanValues = [Identity.Bot, Identity.Connected, Identity.Dead, Identity.FakeClient, Identity.HLTV, Identity.InVehicle, Identity.Observer];
	if (vecBooleanValues.some((bValue) => typeof bValue !== "boolean") || (typeof Identity.Language !== "string") || (typeof Identity.Name !== "string")) {
		throw new Error(`Player ${CurrentPlayer.Index} returned invalid identity state.`);
	}

	return Identity;
}

for (const CurrentPlayer of GetAllPlayers()) {
	ReadIdentity(CurrentPlayer);
}

module.exports = { ReadIdentity };
```

This reversible rename captures the live name before writing. Restoration failures remain visible; if both the operation and restoration fail, `AggregateError.errors` preserves the original thrown value first. Keep the player valid throughout this synchronous game-thread action; a connection check cannot prevent reentrant slot reuse.

```js
const { GetAllPlayers, GetName, SetName } = require("players");

function RenamePlayerTemporarily(CurrentPlayer, strTemporaryName) {
	const strPreviousName = GetName(CurrentPlayer);
	if ((typeof strPreviousName !== "string") || (typeof strTemporaryName !== "string")) {
		throw new TypeError("Player names must be strings.");
	}

	let bOperationFailed = false;
	let OperationFailure = null;

	try {
		if ((SetName(CurrentPlayer, strTemporaryName) !== true) || (GetName(CurrentPlayer) !== strTemporaryName)) {
			throw new Error("The temporary player name was not applied.");
		}
	} catch (Failure) {
		bOperationFailed = true;
		OperationFailure = Failure;
		throw Failure;
	} finally {
		try {
			if (SetName(CurrentPlayer, strPreviousName) !== true) {
				throw new Error("The original player name could not be restored.");
			}
		} catch (CleanupFailure) {
			if (bOperationFailed) {
				throw new AggregateError([OperationFailure, CleanupFailure], "Temporary rename and restoration both failed.");
			}

			throw CleanupFailure;
		}
	}

	return true;
}

const g_Player = GetAllPlayers().find((Candidate) => Candidate.IsConnected());
if (g_Player) {
	RenamePlayerTemporarily(g_Player, "SourceJS Guest");
}

module.exports = { RenamePlayerTemporarily };
```

## Teams And Classes

Team and class names come from the selected SDK's packaged profile. Do not hard-code L4D2, TF2, or Counter-Strike team numbers in portable plugins.

| Export | Result | Purpose |
| --- | --- | --- |
| `GetTeam(PlayerReference)` | `number` | Read the current SDK team number. |
| `SetTeam(PlayerReference, TeamReference)` | `boolean` | Set a numeric or profile-backed team through the native change-team method. |
| `ChangeTeam(PlayerReference, TeamReference)` | `boolean` | Perform the native team transition. |
| `GetTeamName(PlayerReference)` | `string` | Resolve the current number through the selected team profile. |
| `SetTeamName(PlayerReference, strTeamName)` | `boolean` | Change to an exact profile team name. |
| `GetPlayerClass(PlayerReference)` / `SetPlayerClass(PlayerReference, nPlayerClass)` | `number` / `boolean` | Read or write `m_iClass`. |
| `GetPlayerClassName(PlayerReference)` / `SetPlayerClassName(PlayerReference, strPlayerClassName)` | `string` / `boolean` | Resolve or write a class through the selected profile. |

```js
const {
	GetAllPlayers,
	ChangeTeam,
	GetPlayerClass,
	GetPlayerClassName,
	GetTeam,
	GetTeamName,
	SetPlayerClass,
	SetPlayerClassName,
	SetTeam,
	SetTeamName,
} = require("players");
const { GetTeamClassesByNumber } = require("players/teams");

const g_Player = GetAllPlayers()[0];

if (g_Player) {
	const nTeamNumber = GetTeam(g_Player);
	const strTeamName = GetTeamName(g_Player);
	const vecTeamResults = [SetTeam(g_Player, nTeamNumber), ChangeTeam(g_Player, nTeamNumber), SetTeamName(g_Player, strTeamName)];

	if (vecTeamResults.some((bResult) => bResult !== true) || (GetTeam(g_Player) !== nTeamNumber) || (GetTeamName(g_Player) !== strTeamName)) {
		throw new Error("The current team could not be round-tripped through the selected profile.");
	}

	const nPlayerClass = GetPlayerClass(g_Player);
	const Classes = GetTeamClassesByNumber();

	if (Object.prototype.hasOwnProperty.call(Classes, nPlayerClass)) {
		const strPlayerClassName = GetPlayerClassName(g_Player);
		const vecClassResults = [SetPlayerClass(g_Player, nPlayerClass), SetPlayerClassName(g_Player, strPlayerClassName)];

		if (vecClassResults.some((bResult) => bResult !== true) || (GetPlayerClass(g_Player) !== nPlayerClass) || (GetPlayerClassName(g_Player) !== strPlayerClassName)) {
			throw new Error("The current class could not be round-tripped through the selected profile.");
		}
	}
}
```

## Commands, Chat, And Events

| Export | Result | Purpose |
| --- | --- | --- |
| `ExecuteClientCommand(PlayerReference, strCommandText, bServerSide = false)` | `boolean` | Send a client command or execute it through the server-side client command path. |
| `Say(PlayerReference, strChatMessage)` | `boolean` | Make the client issue `say`. The native binding preserves an exception from an object reference's `Index` getter and stops before command dispatch. |
| `SayTeam(PlayerReference, strChatMessage)` | `boolean` | Make the client issue `say_team`. The native binding preserves an exception from an object reference's `Index` getter and stops before command dispatch. |
| `PlaySound(PlayerReference, strSoundSample, SoundOptions = {})` | `boolean` | Play a `Sound` or `StreamSound`; fake clients are skipped. |
| `FireGameEvent(PlayerReference, strEventName, EventPayload = {}, bDoNotBroadcast = false)` | event result | Seed the native `userid` from the player, then copy own enumerable payload fields (which can override `userid`); preserve exact engine event-schema keys. |

```js
const {
	GetAllPlayers,
	ExecuteClientCommand,
	FireGameEvent,
	GetName,
	PlaySound,
	Say,
	SayTeam,
} = require("players");

const g_CurrentPlayer = GetAllPlayers().find((Candidate) => Candidate.IsConnected() && !Candidate.IsFakeClient());
if (g_CurrentPlayer) {
	const bCommandSent = ExecuteClientCommand(g_CurrentPlayer, "echo SourceJS player example", false);
	const bPublicMessageSent = Say(g_CurrentPlayer, "SourceJS is active.");
	const bTeamMessageSent = SayTeam(g_CurrentPlayer, "This message uses team chat.");
	const bSoundPlayed = PlaySound(g_CurrentPlayer, "buttons/button14.wav", { Volume: 0.7 });
	const bEventFired = FireGameEvent(g_CurrentPlayer, "player_say", { text: `SourceJS event from ${GetName(g_CurrentPlayer)}` }, true);

	if ((bCommandSent !== true) || (bPublicMessageSent !== true) || (bTeamMessageSent !== true) || (bSoundPlayed !== true) || (bEventFired !== true)) {
		throw new Error("One or more player communication operations failed.");
	}
}
```

## Moderation And Voice

| Export | Result | Purpose |
| --- | --- | --- |
| `Slay(PlayerReference)` | `boolean` | Kill the player through the native player method. |
| `Spawn(PlayerReference, bForce = false)` | `boolean` | Spawn the player; `bForce` must be a boolean. |
| `Kick(PlayerReference, strKickMessage = "")` | `boolean` | Disconnect the player with exactly the supplied reason. |
| `Ban(PlayerReference, unBanDuration = 0, bKickPlayer = true, bWriteBan = true)` | `boolean` | Issue a native user-ID ban with a primitive finite integer duration from `0` through `2147483647`. The facade's JavaScript parameter defaults also apply to explicit `undefined`; other supplied values follow the [native method contract](players-entity.md). |
| `Mute(PlayerReference, ReceiverReferences = null)` | `boolean` | Mute this sender for all or selected receivers. |
| `Unmute(PlayerReference, ReceiverReferences = null)` | `boolean` | Remove the corresponding mute entries. |
| `IsMuted(PlayerReference, ReceiverReferences = null)` | `boolean` | Test whether every selected receiver has the sender muted. |
| `GetSpectators(PlayerReference)` | player array | Return current players whose observer target is this player. |

Administrative actions should always be behind an authorization and confirmation layer:

```js
const { Ban, Kick, Slay, Spawn } = require("players");

function ApplyAdministrativeAction(PlayerReference, strAction) {
	switch (strAction) {
		case "BAN30":
			return Ban(PlayerReference, 30, true, true);

		case "KICK":
			return Kick(PlayerReference, "Removed by an administrator");

		case "RESPAWN":
			return Spawn(PlayerReference, true);

		case "SLAY":
			return Slay(PlayerReference);

		default:
			throw new RangeError(`Unknown administrative action: ${strAction}`);
	}
}

module.exports = { ApplyAdministrativeAction };
```

Mute one sender only for one receiver, verify the state, and remove only the newly added pair. This example uses the context's shared manager; it does not own or unload the shared hook/listener. Its context owner must finish manager cleanup during plugin unload. Unmute requests listening `true` when no manager still owns the pair, not the pre-mute listening value. If cleanup fails, retain the sender/receiver context and resolve the failure before slot reuse. Dual failures preserve the operation error first:

```js
const { GetAllPlayers, IsMuted, Mute, GetSpectators, Unmute } = require("players");

const g_vecRoster = GetAllPlayers();
const g_Sender = g_vecRoster[0];
const g_Receiver = g_vecRoster[1];
if (g_Sender && g_Receiver) {
	const vecReceiverIndexes = [g_Receiver.Index];
	const bWasMuted = IsMuted(g_Sender, vecReceiverIndexes);
	if (typeof bWasMuted !== "boolean") {
		throw new TypeError("IsMuted() must return a boolean.");
	}

	let bOperationFailed = false;
	let OperationFailure = null;

	try {
		if (!bWasMuted && (Mute(g_Sender, vecReceiverIndexes) !== true)) {
			throw new Error("The selected receiver could not mute the sender.");
		}

		if (IsMuted(g_Sender, vecReceiverIndexes) !== true) {
			throw new Error("The mute state was not applied.");
		}

		const vecSpectatorIndexes = GetSpectators(g_Sender).map((CurrentPlayer) => CurrentPlayer.Index);
		if (vecSpectatorIndexes.some((unPlayerIndex) => !Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex <= 0))) {
			throw new Error("GetSpectators() returned an invalid player index.");
		}
	} catch (Failure) {
		bOperationFailed = true;
		OperationFailure = Failure;
		throw Failure;
	} finally {
		try {
			if (!bWasMuted && ((Unmute(g_Sender, vecReceiverIndexes) !== true) || (IsMuted(g_Sender, vecReceiverIndexes) !== false))) {
				throw new Error("The temporary mute state could not be removed.");
			}
		} catch (CleanupFailure) {
			if (bOperationFailed) {
				throw new AggregateError([OperationFailure, CleanupFailure], "Temporary mute and cleanup both failed.");
			}

			throw CleanupFailure;
		}
	}
}
```

## Movement And Player State

| Export | Result | Purpose |
| --- | --- | --- |
| `GetEyeLocation(PlayerReference)` / `SetEyeLocation(PlayerReference, EyeLocation)` | `Vector` / `boolean` | Read the eye world position or move the origin so the eye reaches that position. |
| `Push(PlayerReference, flHorizontalMultiplier, flVerticalMultiplier, bVerticalOverride = false)` | `boolean` | Write a view-relative base velocity. |
| `GetNoClip(PlayerReference)` / `SetNoClip(PlayerReference, bEnabled)` | `boolean` / `boolean` | Query or select `MoveType.NoClip`; disabling selects `MoveType.Walk`. |
| `GetJetpack(PlayerReference)` / `SetJetpack(PlayerReference, bEnabled)` | `boolean` / `boolean` | Query or select `MoveType.Fly`; disabling selects `MoveType.Walk`. |
| `GetStuck(PlayerReference)` / `SetStuck(PlayerReference, bEnabled)` | `boolean` / `boolean` | Query or select `MoveType.None`; disabling selects `MoveType.Walk`. |
| `GetGodMode(PlayerReference)` / `SetGodMode(PlayerReference, bEnabled)` | `boolean` / `boolean` | Read or write the damage mode. |
| `GetNoBlock(PlayerReference)` / `SetNoBlock(PlayerReference, bEnabled)` | `boolean` / `boolean` | Toggle the player/debris-trigger collision group. |
| `GetFlashlight(PlayerReference)` / `SetFlashlight(PlayerReference, bEnabled)` | `boolean` / `boolean` | Toggle `EntityEffects.DimLight`. |
| `GetFrozen(PlayerReference)` / `SetFrozen(PlayerReference, bEnabled)` | `boolean` / `boolean` | Capability-conditioned `FL_FROZEN` accessors. |

Noclip, jetpack, and stuck all own the same move-type property. Do not use their `false` setters to restore an unknown custom move type. Similarly, `SetGodMode(false)` selects `TakeDamage.Yes`, and `SetNoBlock(false)` selects the normal player collision group; use the lower-level entity APIs when an exact custom raw value must survive rollback.

The reversible example below is appropriate only when the game already uses the standard damage and player collision modes represented by these boolean APIs. It attempts every restoration independently and preserves operation/cleanup errors, but it is not atomic or a guaranteed rollback. For production retry, retain the original values with the owning player session rather than discarding them after a failed module load. All SDK access must remain on the game thread, without reentrant disconnect/map changes:

```js
const {
	GetAllPlayers,
	GetFlashlight,
	GetFrozen,
	GetGodMode,
	GetNoBlock,
	SetFlashlight,
	SetFrozen,
	SetGodMode,
	SetNoBlock,
} = require("players");

if ((typeof GetFrozen === "function") !== (typeof SetFrozen === "function")) {
	throw new Error("The selected SDK exposes an incomplete frozen-state capability.");
}

const g_Player = GetAllPlayers()[0];
if (g_Player) {
	const PreviousState = {
		Flashlight: GetFlashlight(g_Player),
		GodMode: GetGodMode(g_Player),
		NoBlock: GetNoBlock(g_Player),
	};
	const bCanFreeze = (typeof GetFrozen === "function") && (typeof SetFrozen === "function");
	const bWasFrozen = bCanFreeze ? GetFrozen(g_Player) : false;
	if ([PreviousState.Flashlight, PreviousState.GodMode, PreviousState.NoBlock, bWasFrozen].some((Value) => typeof Value !== "boolean")) {
		throw new TypeError("Player-state getters must return booleans.");
	}

	let bOperationFailed = false;
	let OperationFailure = null;

	try {
		const vecUpdateResults = [
			SetFlashlight(g_Player, !PreviousState.Flashlight),
			SetGodMode(g_Player, !PreviousState.GodMode),
			SetNoBlock(g_Player, !PreviousState.NoBlock),
		];

		if (bCanFreeze) {
			vecUpdateResults.push(SetFrozen(g_Player, !bWasFrozen));
		}

		const bFlashlightApplied = GetFlashlight(g_Player) === !PreviousState.Flashlight;
		const bGodModeApplied = GetGodMode(g_Player) === !PreviousState.GodMode;
		const bNoBlockApplied = GetNoBlock(g_Player) === !PreviousState.NoBlock;
		const bFrozenApplied = !bCanFreeze || (GetFrozen(g_Player) === !bWasFrozen);
		if (vecUpdateResults.some((bResult) => bResult !== true) || !bFlashlightApplied || !bGodModeApplied || !bNoBlockApplied || !bFrozenApplied) {
			throw new Error("The temporary player-state changes were not applied.");
		}
	} catch (Failure) {
		bOperationFailed = true;
		OperationFailure = Failure;
		throw Failure;
	} finally {
		const vecCleanupErrors = [];
		const Restore = (Setter, Getter, bPreviousValue) => {
			try {
				if ((Setter(g_Player, bPreviousValue) !== true) || (Getter(g_Player) !== bPreviousValue)) {
					throw new Error("The original player state could not be restored.");
				}
			} catch (CleanupFailure) {
				vecCleanupErrors.push(CleanupFailure);
			}
		};

		Restore(SetFlashlight, GetFlashlight, PreviousState.Flashlight);
		Restore(SetGodMode, GetGodMode, PreviousState.GodMode);
		Restore(SetNoBlock, GetNoBlock, PreviousState.NoBlock);

		if (bCanFreeze) {
			Restore(SetFrozen, GetFrozen, bWasFrozen);
		}

		if (vecCleanupErrors.length !== 0) {
			if (bOperationFailed) {
				throw new AggregateError([OperationFailure, ...vecCleanupErrors], "Player-state update and restoration failed.");
			}

			if (vecCleanupErrors.length === 1) {
				throw vecCleanupErrors[0];
			}

			throw new AggregateError(vecCleanupErrors, "Multiple player-state restorations failed.");
		}
	}
}
```

This helper makes the four supported mode selections explicit:

```js
const {
	GetJetpack,
	GetNoClip,
	GetStuck,
	SetJetpack,
	SetNoClip,
	SetStuck,
} = require("players");

function SelectMovementMode(PlayerReference, strMode) {
	let bChanged = false;

	if (strMode === "JETPACK") {
		bChanged = SetJetpack(PlayerReference, true);
	} else if (strMode === "NOCLIP") {
		bChanged = SetNoClip(PlayerReference, true);
	} else if (strMode === "STUCK") {
		bChanged = SetStuck(PlayerReference, true);
	} else if (strMode === "WALK") {
		bChanged = SetNoClip(PlayerReference, false);
	} else {
		throw new RangeError(`Unknown movement mode: ${strMode}`);
	}

	const bSelected = ((strMode === "JETPACK") && (GetJetpack(PlayerReference) === true))
		|| ((strMode === "NOCLIP") && (GetNoClip(PlayerReference) === true))
		|| ((strMode === "STUCK") && (GetStuck(PlayerReference) === true))
		|| ((strMode === "WALK") && (GetJetpack(PlayerReference) === false) && (GetNoClip(PlayerReference) === false) && (GetStuck(PlayerReference) === false));
	if ((bChanged !== true) || !bSelected) {
		throw new Error(`The ${strMode} movement mode was not applied.`);
	}

	return true;
}

module.exports = { SelectMovementMode };
```

This helper keeps the eye at its current location and then applies a deliberate view-relative impulse. Call it only as part of gameplay that intends to change the player's velocity:

```js
const { GetEyeLocation, Push, SetEyeLocation } = require("players");

function LaunchPlayer(PlayerReference) {
	const EyeLocation = GetEyeLocation(PlayerReference);
	if ((SetEyeLocation(PlayerReference, EyeLocation) !== true) || (Push(PlayerReference, 240, 180, true) !== true)) {
		throw new Error("The player could not be launched.");
	}

	return EyeLocation;
}

module.exports = { LaunchPlayer };
```

## View And Tracing

| Export | Result | Purpose |
| --- | --- | --- |
| `GetViewVector(PlayerReference)` | `Vector` | Convert current eye angles to a forward vector. |
| `GetTraceRay(PlayerReference, unContentMask?, TraceFilter?)` | trace result | Trace from the eye to `MAX_TRACE_LENGTH`. |
| `GetViewCoordinates(PlayerReference, unContentMask?, TraceFilter?)` | `Vector \| null` | Return the trace hit coordinates. |
| `GetViewEntity(PlayerReference, unContentMask?, TraceFilter?)` | entity or `null` | Return the hit non-world entity; world index `0` maps to `null`. |
| `GetViewPlayer(PlayerReference, unContentMask?, TraceFilter?)` | player or `null` | Return a connected hit player, or `null` for a miss, world hit, non-player, or disconnected player; native dependency/wrapper failures still throw. |
| `SetViewCoordinates(PlayerReference, ViewCoordinates)` | `boolean` | Turn the player's eye angles toward world coordinates. |
| `SetViewEntity(PlayerReference, EntityReference)` | `boolean` | Turn toward the entity origin. |
| `SetViewPlayer(PlayerReference, TargetPlayer)` | `boolean` | Turn toward another player's eye location. |

These helpers issue separate live queries, not one atomic trace snapshot. Keep the caller and any target player valid on the game thread throughout the calls. `AimPlayer()` accepts a player target because its final step uses that player's eye location, not an arbitrary entity.

```js
const {
	GetAllPlayers,
	GetTraceRay,
	GetViewCoordinates,
	GetViewEntity,
	GetViewPlayer,
	GetViewVector,
} = require("players");

function ReadViewTarget(PlayerReference) {
	const TraceResult = GetTraceRay(PlayerReference);
	const ViewCoordinates = GetViewCoordinates(PlayerReference);
	const ViewEntity = GetViewEntity(PlayerReference);
	const ForwardVector = GetViewVector(PlayerReference);
	const TargetPlayer = GetViewPlayer(PlayerReference);

	if ((TraceResult === null) || (typeof TraceResult !== "object") || Array.isArray(TraceResult)) {
		throw new Error("The player view trace returned invalid data.");
	}

	if ((ForwardVector === null) || (typeof ForwardVector !== "object") || Array.isArray(ForwardVector)) {
		throw new Error("The player view vector returned invalid data.");
	}

	const flTraceFraction = TraceResult.Fraction;
	const flForwardX = ForwardVector.X;
	const flForwardY = ForwardVector.Y;
	const flForwardZ = ForwardVector.Z;
	const bForwardVectorIsFinite = Number.isFinite(flForwardX) && Number.isFinite(flForwardY) && Number.isFinite(flForwardZ);
	if (!Number.isFinite(flTraceFraction) || !bForwardVectorIsFinite) {
		throw new Error("The player view trace returned invalid data.");
	}

	if (ViewCoordinates !== null) {
		if ((typeof ViewCoordinates !== "object") || Array.isArray(ViewCoordinates)) {
			throw new Error("The player view coordinates returned invalid data.");
		}

		const flCoordinateX = ViewCoordinates.X;
		const flCoordinateY = ViewCoordinates.Y;
		const flCoordinateZ = ViewCoordinates.Z;
		const bCoordinatesAreFinite = Number.isFinite(flCoordinateX) && Number.isFinite(flCoordinateY) && Number.isFinite(flCoordinateZ);
		if (!bCoordinatesAreFinite) {
			throw new Error("The player view coordinates are not finite.");
		}
	}

	let nViewEntityIndex = null;

	if (ViewEntity !== null) {
		if ((typeof ViewEntity !== "object") || Array.isArray(ViewEntity)) {
			throw new Error("The player view entity returned invalid data.");
		}

		nViewEntityIndex = ViewEntity.Index;
		if (!Number.isSafeInteger(nViewEntityIndex) || (nViewEntityIndex <= 0)) {
			throw new Error("The player view trace returned an invalid entity index.");
		}
	}

	let nTargetPlayerIndex = null;

	if (TargetPlayer !== null) {
		if ((typeof TargetPlayer !== "object") || Array.isArray(TargetPlayer)) {
			throw new Error("The player view target returned invalid data.");
		}

		nTargetPlayerIndex = TargetPlayer.Index;
		if (!Number.isSafeInteger(nTargetPlayerIndex) || (nTargetPlayerIndex <= 0)) {
			throw new Error("The player view trace returned an invalid player index.");
		}
	}

	return {
		Coordinates: ViewCoordinates,
		EntityIndex: nViewEntityIndex,
		Forward: ForwardVector,
		Fraction: flTraceFraction,
		PlayerIndex: nTargetPlayerIndex,
	};
}

const g_CurrentPlayer = GetAllPlayers()[0];
if (g_CurrentPlayer !== undefined) {
	ReadViewTarget(g_CurrentPlayer);
}

module.exports = { ReadViewTarget };
```

```js
const {
	GetViewCoordinates,
	SetViewCoordinates,
	SetViewEntity,
	SetViewPlayer,
} = require("players");

function AimPlayer(PlayerReference, TargetPlayer = null) {
	const Coordinates = GetViewCoordinates(PlayerReference);
	if ((Coordinates !== null) && (SetViewCoordinates(PlayerReference, Coordinates) !== true)) {
		throw new Error("The player could not aim at the current trace point.");
	}

	if (TargetPlayer !== null) {
		if ((SetViewEntity(PlayerReference, TargetPlayer) !== true) || (SetViewPlayer(PlayerReference, TargetPlayer) !== true)) {
			throw new Error("The player could not aim at the target entity and eye position.");
		}
	}

	return (Coordinates !== null) || (TargetPlayer !== null);
}

module.exports = { AimPlayer };
```

## Client Networking

| Export | Result | Purpose |
| --- | --- | --- |
| `GetClientCVarValue(PlayerReference, strConVarName)` | `string` | Query a client ConVar through `IVEngineServer`. |
| `GetNetInfo(PlayerReference)` | netchannel info or `null` | Resolve the client's live `INetChannelInfo` wrapper. |
| `SendConVarValue(PlayerReference, strConVarName, strConVarValue)` | `boolean` | Send the selected SDK's client ConVar update message. |

`SendConVarValue()` sends a client-side ConVar update; it does not mutate the server's actual ConVar or prove client receipt. Use live players/channels on the game thread and do not retain them across disconnects or map changes.

```js
const { NET_FLOW } = require("netchannel");
const {
	GetAllPlayers,
	GetClientCVarValue,
	GetNetInfo,
	SendConVarValue,
} = require("players");

const g_vecAvailablePlayers = GetAllPlayers();
let g_CurrentPlayer = null;

for (const CandidatePlayer of g_vecAvailablePlayers) {
	if (!CandidatePlayer.IsConnected() || CandidatePlayer.IsFakeClient()) {
		continue;
	}

	g_CurrentPlayer = CandidatePlayer;
	break;
}

if (g_CurrentPlayer !== null) {
	const NetChannelInfo = GetNetInfo(g_CurrentPlayer);
	if ((NetChannelInfo === null) || (typeof NetChannelInfo !== "object") || Array.isArray(NetChannelInfo) || (typeof NetChannelInfo.GetNetChannelLatency !== "function")) {
		throw new Error("The player has no active network channel.");
	}

	const strClientLanguage = GetClientCVarValue(g_CurrentPlayer, "cl_language");
	const flOutgoingLatency = NetChannelInfo.GetNetChannelLatency(NET_FLOW.Outgoing);
	if ((typeof strClientLanguage !== "string") || !Number.isFinite(flOutgoingLatency)) {
		throw new Error("The client networking state could not be read.");
	}

	if (SendConVarValue(g_CurrentPlayer, "cl_language", strClientLanguage) !== true) {
		throw new Error("The client ConVar update could not be sent.");
	}
}
```

## Weapons And Ammunition

| Export | Result | Purpose |
| --- | --- | --- |
| `GetActiveWeapon(PlayerReference)` | weapon or `null` | Read the current active-weapon handle. |
| `SetActiveWeapon(PlayerReference, WeaponReference)` | `true \| undefined` | Replace the active-weapon handle; a failed storage write returns `undefined`, while argument/dependency errors still throw. |
| `GetWeaponIndexes(PlayerReference, strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null)` | number array | Enumerate owned weapon indexes and apply class/filter constraints. |
| `GetWeapons(PlayerReference, strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null)` | weapon array | Return decorated owned weapons. |
| `GetWeapon(PlayerReference, strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null)` | weapon or `null` | Return the first matching owned weapon. |
| `GetPrimaryWeapon(PlayerReference)` / `GetSecondaryWeapon(PlayerReference)` | weapon or `null` | Return the first weapon matching the selected profile filter. |
| `GetProjectileIndexes(PlayerReference, strProjectileName)` | number array | Resolve owned projectiles or matching weapons. |
| `GetProjectileAmmo(PlayerReference, strProjectileName)` | `number \| undefined` | Read the profile-backed signed 32-bit ammo property; a failed complete-value read returns `undefined`. |
| `SetProjectileAmmo(PlayerReference, strProjectileName, nAmmoValue)` | `true \| undefined` | Write a signed 32-bit ammunition value; a failed complete-value write returns `undefined`. The caller chooses a game-valid amount. |

The example queries inventories separately, so it assumes no reentrant inventory changes during the game-thread operation. The original and selected weapons must remain live throughout restoration. Cleanup can fail; retain the original weapon and player-session context for an explicit retry rather than assuming an atomic rollback.

```js
const {
	GetAllPlayers,
	GetActiveWeapon,
	GetWeapon,
	GetPrimaryWeapon,
	GetSecondaryWeapon,
	SetActiveWeapon,
	GetWeaponIndexes,
	GetWeapons,
} = require("players");

function ValidateOptionalWeapon(WeaponReference, strWeaponRole) {
	if (WeaponReference === null) {
		return;
	}

	if ((typeof WeaponReference !== "object") || Array.isArray(WeaponReference) || !Number.isSafeInteger(WeaponReference.Index) || (WeaponReference.Index <= 0)) {
		throw new Error(`${strWeaponRole} is not a valid weapon.`);
	}
}

const g_CurrentPlayer = GetAllPlayers()[0];
if (g_CurrentPlayer !== undefined) {
	const ActiveWeapon = GetActiveWeapon(g_CurrentPlayer);
	const vecOwnedWeapons = GetWeapons(g_CurrentPlayer);
	const vecOwnedWeaponIndexes = GetWeaponIndexes(g_CurrentPlayer);
	const FirstWeapon = GetWeapon(g_CurrentPlayer);
	const PrimaryWeapon = GetPrimaryWeapon(g_CurrentPlayer);
	const SecondaryWeapon = GetSecondaryWeapon(g_CurrentPlayer);
	if (!Array.isArray(vecOwnedWeapons) || !Array.isArray(vecOwnedWeaponIndexes)) {
		throw new Error("The player weapon enumerators returned invalid collections.");
	}

	if (vecOwnedWeaponIndexes.length !== vecOwnedWeapons.length) {
		throw new Error("The player weapon enumerators returned different collection lengths.");
	}

	for (let unWeaponPosition = 0; unWeaponPosition < vecOwnedWeapons.length; unWeaponPosition += 1) {
		const OwnedWeapon = vecOwnedWeapons[unWeaponPosition];
		const unOwnedWeaponIndex = vecOwnedWeaponIndexes[unWeaponPosition];
		if (OwnedWeapon === null) {
			throw new Error(`Owned weapon ${unWeaponPosition} is missing.`);
		}

		ValidateOptionalWeapon(OwnedWeapon, `Owned weapon ${unWeaponPosition}`);

		if (!Number.isSafeInteger(unOwnedWeaponIndex) || (unOwnedWeaponIndex !== OwnedWeapon.Index)) {
			throw new Error(`Owned weapon ${unWeaponPosition} has an inconsistent index.`);
		}
	}

	ValidateOptionalWeapon(ActiveWeapon, "Active weapon");
	ValidateOptionalWeapon(FirstWeapon, "First matching weapon");
	ValidateOptionalWeapon(PrimaryWeapon, "Primary weapon");
	ValidateOptionalWeapon(SecondaryWeapon, "Secondary weapon");

	if ((ActiveWeapon !== null) && (vecOwnedWeapons.length > 0)) {
		const SelectedWeapon = vecOwnedWeapons[0];
		let bOperationFailed = false;
		let OperationFailure = null;

		try {
			const bWeaponSelected = SetActiveWeapon(g_CurrentPlayer, SelectedWeapon);
			const ConfirmedSelectedWeapon = GetActiveWeapon(g_CurrentPlayer);
			ValidateOptionalWeapon(ConfirmedSelectedWeapon, "Confirmed selected weapon");

			if ((bWeaponSelected !== true) || (ConfirmedSelectedWeapon === null) || (ConfirmedSelectedWeapon.Index !== SelectedWeapon.Index)) {
				throw new Error("The selected owned weapon could not become active.");
			}
		} catch (Failure) {
			bOperationFailed = true;
			OperationFailure = Failure;
			throw Failure;
		} finally {
			try {
				const bWeaponRestored = SetActiveWeapon(g_CurrentPlayer, ActiveWeapon);
				const ConfirmedActiveWeapon = GetActiveWeapon(g_CurrentPlayer);
				ValidateOptionalWeapon(ConfirmedActiveWeapon, "Restored active weapon");

				if ((bWeaponRestored !== true) || (ConfirmedActiveWeapon === null) || (ConfirmedActiveWeapon.Index !== ActiveWeapon.Index)) {
					throw new Error("The original active weapon could not be restored.");
				}
			} catch (CleanupFailure) {
				if (bOperationFailed) {
					throw new AggregateError([OperationFailure, CleanupFailure], "Active-weapon selection and restoration failed.");
				}

				throw CleanupFailure;
			}
		}
	}
}
```

Projectile names are keys from the selected SDK's weapon profile, not entity indexes. Some profiles have no
projectile-ammo mapping, so the example first selects a key whose weapon record declares an ammo property. It rejects negative ammo as plugin policy even though native ammo values are signed. The profile must also provide its valid native ammo-property prefix; SDK/property failures still throw:

```js
const { WEAPON_MANAGER } = require("weapons/manager");
const {
	GetAllPlayers,
	GetProjectileAmmo,
	GetProjectileIndexes,
	SetProjectileAmmo,
} = require("players");

const g_CurrentPlayer = GetAllPlayers()[0];
let g_strProjectileName = null;

for (const strAvailableProjectileName in WEAPON_MANAGER.Projectiles) {
	if (!Object.hasOwn(WEAPON_MANAGER.Projectiles, strAvailableProjectileName)) {
		continue;
	}

	const WeaponInformation = WEAPON_MANAGER.Get(WEAPON_MANAGER.Projectiles[strAvailableProjectileName]);
	if (!WeaponInformation) {
		continue;
	}

	const AmmoProperty = WeaponInformation.AmmoProperty;
	if ((AmmoProperty === null) || (AmmoProperty === undefined) || (AmmoProperty === "")) {
		continue;
	}

	g_strProjectileName = strAvailableProjectileName;
	break;
}

if ((g_CurrentPlayer !== undefined) && (g_strProjectileName !== null)) {
	const nProjectileAmmo = GetProjectileAmmo(g_CurrentPlayer, g_strProjectileName);
	const vecOwnedProjectileIndexes = GetProjectileIndexes(g_CurrentPlayer, g_strProjectileName);
	if (!Array.isArray(vecOwnedProjectileIndexes)) {
		throw new Error("The projectile enumerator returned an invalid collection.");
	}

	if (!Number.isSafeInteger(nProjectileAmmo) || (nProjectileAmmo < 0)) {
		throw new Error(`Projectile ammo is invalid for ${g_strProjectileName}.`);
	}

	for (const unOwnedProjectileIndex of vecOwnedProjectileIndexes) {
		if (!Number.isSafeInteger(unOwnedProjectileIndex) || (unOwnedProjectileIndex <= 0)) {
			throw new Error(`Projectile index is invalid for ${g_strProjectileName}.`);
		}
	}

	const bProjectileAmmoWritten = SetProjectileAmmo(g_CurrentPlayer, g_strProjectileName, nProjectileAmmo);
	const nConfirmedProjectileAmmo = GetProjectileAmmo(g_CurrentPlayer, g_strProjectileName);
	if ((bProjectileAmmoWritten !== true) || (nConfirmedProjectileAmmo !== nProjectileAmmo)) {
		throw new Error(`Projectile ammo could not be round-tripped for ${g_strProjectileName}.`);
	}
}
```

## Restrictions And Dropping

| Export | Result | Purpose |
| --- | --- | --- |
| `RestrictWeapons(PlayerReference, ...vecWeaponsToRestrict)` | `true` | Add player-owned restrictions for every supplied weapon name/object. |
| `UnrestrictWeapons(PlayerReference, ...vecWeaponsToUnrestrict)` | `true` | Remove the corresponding player restrictions. |
| `IsWeaponRestricted(PlayerReference, WeaponReference)` | `boolean` | Return the inverse of the restriction manager's `CanUse()` result. |
| `DropWeapon(PlayerReference, WeaponReference, DropTarget = null, DropVelocity = null)` | `true` after dispatch | Call the selected SDK's void `Weapon_Drop()` operation; `true` does not prove that inventory changed. Invalid inputs/native failures throw. |

Temporary restrictions belong to the current player session. Pass a player object: numeric restriction selectors are engine user IDs, not player-slot indexes. The example removes only restrictions it added, attempts cleanup independently for every weapon, and preserves operation/cleanup failures. Adding a restriction matching the current weapon can request removal of that weapon entity; removing the restriction does not recreate it. This example restores restriction state, not inventory, and is appropriate only when that side effect is intended. It is not atomic: if cleanup fails, retain the original states and resolve the failure before session/slot reuse. Keep SDK calls on the game thread without reentrant inventory or player changes:

```js
const {
	GetAllPlayers,
	IsWeaponRestricted,
	RestrictWeapons,
	UnrestrictWeapons,
	GetWeapons,
} = require("players");

const g_CurrentPlayer = GetAllPlayers()[0];
if (g_CurrentPlayer !== undefined) {
	const vecOwnedWeapons = GetWeapons(g_CurrentPlayer);
	if (!Array.isArray(vecOwnedWeapons)) {
		throw new Error("The weapon enumerator returned an invalid collection.");
	}

	const vecSelectedWeapons = [];
	const mapPreviousRestrictionStates = new Map();
	const vecNewlyRestrictedWeapons = [];
	const unSelectedWeaponCount = Math.min(vecOwnedWeapons.length, 2);
	for (let unWeaponPosition = 0; unWeaponPosition < unSelectedWeaponCount; unWeaponPosition += 1) {
		const SelectedWeapon = vecOwnedWeapons[unWeaponPosition];
		const bWeaponWasRestricted = IsWeaponRestricted(g_CurrentPlayer, SelectedWeapon);
		if (typeof bWeaponWasRestricted !== "boolean") {
			throw new Error(`Weapon ${unWeaponPosition} returned an invalid restriction state.`);
		}

		vecSelectedWeapons.push(SelectedWeapon);
		mapPreviousRestrictionStates.set(SelectedWeapon, bWeaponWasRestricted);

		if (!bWeaponWasRestricted) {
			vecNewlyRestrictedWeapons.push(SelectedWeapon);
		}
	}

	let bOperationFailed = false;
	let OperationFailure = null;

	try {
		if ((vecNewlyRestrictedWeapons.length > 0) && (RestrictWeapons(g_CurrentPlayer, ...vecNewlyRestrictedWeapons) !== true)) {
			throw new Error("The temporary weapon restrictions were not applied.");
		}

		for (const RestrictedWeapon of vecNewlyRestrictedWeapons) {
			if (IsWeaponRestricted(g_CurrentPlayer, RestrictedWeapon) !== true) {
				throw new Error("A temporary weapon restriction was not applied.");
			}
		}
	} catch (Failure) {
		bOperationFailed = true;
		OperationFailure = Failure;
		throw Failure;
	} finally {
		const vecCleanupErrors = [];
		for (const RestrictedWeapon of vecNewlyRestrictedWeapons) {
			try {
				if (UnrestrictWeapons(g_CurrentPlayer, RestrictedWeapon) !== true) {
					throw new Error("An original weapon restriction could not be restored.");
				}
			} catch (CleanupFailure) {
				vecCleanupErrors.push(CleanupFailure);
			}
		}

		for (const SelectedWeapon of vecSelectedWeapons) {
			try {
				const bRestoredRestrictionState = IsWeaponRestricted(g_CurrentPlayer, SelectedWeapon);
				const bPreviousRestrictionState = mapPreviousRestrictionStates.get(SelectedWeapon);
				if (bRestoredRestrictionState !== bPreviousRestrictionState) {
					throw new Error("An original weapon restriction state was not restored.");
				}
			} catch (CleanupFailure) {
				vecCleanupErrors.push(CleanupFailure);
			}
		}

		if (vecCleanupErrors.length !== 0) {
			if (bOperationFailed) {
				throw new AggregateError([OperationFailure, ...vecCleanupErrors], "Weapon restriction update and cleanup failed.");
			}

			if (vecCleanupErrors.length === 1) {
				throw vecCleanupErrors[0];
			}

			throw new AggregateError(vecCleanupErrors, "Multiple weapon restriction cleanup operations failed.");
		}
	}
}
```

Request an active-weapon drop toward the current trace hit. This requires live player/weapon objects and target/velocity values throughout the game-thread call. A `true` result means the SDK call returned, not that it confirmed a physical drop:

```js
const { Vector } = require("mathlib");
const {
	DropWeapon,
	GetActiveWeapon,
	GetViewCoordinates,
} = require("players");

function DropActiveWeapon(PlayerReference) {
	const ActiveWeapon = GetActiveWeapon(PlayerReference);
	const DropTarget = GetViewCoordinates(PlayerReference);
	if ((ActiveWeapon === null) || (DropTarget === null)) {
		return false;
	}

	const DropVelocity = new Vector(0, 0, 120);
	const bWeaponDropped = DropWeapon(PlayerReference, ActiveWeapon, DropTarget, DropVelocity);
	if (typeof bWeaponDropped !== "boolean") {
		throw new Error("DropWeapon() returned an invalid result.");
	}

	return bWeaponDropped;
}

module.exports = { DropActiveWeapon };
```

## Errors

- Native error reporting is best effort: contextual JavaScript error creation can fail, and these guards do not guarantee Error-object allocation or termination/OOM recovery.
- Loading fails when the native `players` module or a mandatory composed dependency is absent.
- `Player()` and `FromUserID()` throw when the requested live client cannot be resolved; nullable weapon and trace
  lookups return `null` where documented.
- Objects missing required native player methods fail decoration. The structural check accepts inherited callable methods and does not prove native provenance or a live player session.
- Missing SDK properties, team/class names, projectile mappings and optional capabilities throw from their owning
  modules instead of returning fabricated values.
- Boolean-result operations may return `false` on rejection; invalid argument types/ranges and native failures throw as documented by each API. Failed native active-weapon writes and ammunition reads/writes can instead return `undefined`; require each operation's documented success result. Restriction wrappers return `true` after their delegated calls, and `DropWeapon()` reports dispatch rather than a confirmed inventory change.
- Native `GetActiveWeapon()`, `SetActiveWeapon()`, `GetWeaponIndices()`, `GetProjectileIndices()`, and `GetProjectileAmmo()` callbacks catch C++ exceptions and attempt to raise operation-specific JavaScript errors. Input `Index`/handle getter and string-conversion exceptions propagate unchanged.
- Native handle access checks the complete selected-SDK storage range and alignment; projectile ammunition reads and writes check the complete `int` range. Numeric checks do not prove arbitrary memory is mapped or live. Invalid handle ranges retain the existing `null`, no-result, or skipped-slot behavior of the corresponding operation.
- Native integer/vector/entity-property callbacks, `SetProjectileAmmo()`, and HLTV/vehicle/observer query callbacks also catch C++ exceptions and attempt to raise operation-specific JavaScript errors. Player-selector, property-name conversion, and vector-component getter exceptions propagate unchanged.
- Native property-name lookup snapshots the selected entity's SDK handle before coercing names and rejects removal/slot reuse before accessing property storage. `DropWeapon()` similarly revalidates both handles after reading optional vectors, then reacquires the original objects before dispatch. Getter side effects are not rolled back and SDK object lifetimes are not pinned.
- Native `SetActiveWeapon()` selects the player before reading the weapon, then verifies both live SDK handles before resolving and writing the active-weapon property. Removal or slot reuse from a weapon getter stops the write; a detached weapon handle is rejected.
- Native `GetWeaponIndices()` and integer send-property lookup revalidate the original player after string coercion and reacquire its address before accessing storage. Weapon-property prefixes and integer property paths must not contain NUL bytes, because the SDK consumes null-terminated names.
- Native weapon/projectile index arrays are populated with own numeric data properties. Inherited JavaScript setters are not called while iterating SDK storage.
- Native `Player()` selection, all/human/bot/team collection callbacks, and team-number/name lookups catch C++ exceptions and attempt to raise JavaScript errors. Their existing nullable results, filters and unknown-team sentinels remain unchanged. These guards do not keep player sessions or SDK interfaces alive; resolve live players again after lifecycle changes.
- Native `GetMaximumClients()` and `GetClientCount()` callbacks also catch C++ exceptions and attempt to raise JavaScript errors; successful calls retain their existing numeric slot-limit and connected-client-count results.
- Native `GetPlayerFromUserID()` and `SpawnPlayer()` callbacks catch C++ exceptions and attempt to raise JavaScript errors while preserving an existing input exception. Spawn keeps its force/team/death checks and selected-SDK availability; a dispatched spawn is not rolled back if a later failure occurs.
- Integer field reads and writes check the complete `int` range. Vector access requires a complete, aligned range containing a live SDK `Vector`; entity fields use the selected-SDK handle representation. Range failures preserve the corresponding no-result or `null` behavior. Vehicle/observer presence checks retain the existing positive-integer fallback when the stored value does not resolve to a live handle.
- Native `IsObserver()` evaluates the player selector once, then checks mode and, when needed, target for that resolved index. A getter cannot select another player for the fallback check. This is not an atomic snapshot of changing SDK state and does not pin the player session.

## Lifecycle

- Resolve players again after disconnects and map transitions.
- Read live properties or call live methods when the value is needed; do not retain mutable player state as a permanent cache.
- Treat `SetEyeLocation()` as movement, not as an eye-angle setter.
- Do not combine the noclip, jetpack, and stuck setters without owning the complete move-type lifecycle.
- Pass strings to `SendConVarValue()`; numeric values are rejected instead of coerced. Player and string conversion errors stop the operation before the next conversion or native send, preserving the original JavaScript exception; C++ failures are caught at the callback boundary, which attempts to raise a contextual JavaScript error. The selected SDK's ConVar message must fit the fixed 256-byte bit-writer buffer, including its protocol header; oversized or overflowed messages return `false` without being sent.
- Remove voice mutes and weapon restrictions during plugin unload.
- Put `Kick()`, `Ban()`, `Slay()`, forced spawn, and team changes behind explicit authorization.

## Related Modules

- [`players/entity`](players-entity.md) documents the same operations as decorated instance methods.
- [`players/teams`](players-teams.md) exposes the selected SDK's team and class profile.
- [`players/voice`](players-voice.md) owns sender/receiver mute state.
- [`netchannel`](netchannel.md) provides the live channel objects returned by `GetNetInfo()` and used by `SendConVarValue()`.
- [`weapons`](weapons.md) and [`weapons/manager`](weapons-manager.md) provide decorated weapons and selected-profile metadata.
- [`entities`](entities.md) provides lower-level raw properties and collision state when a boolean player helper
  cannot preserve a custom value.
