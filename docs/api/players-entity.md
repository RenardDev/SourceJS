# `require("players/entity")`

> AI processing note: this page documents the complete decorated `Player` object. Use the contents and grouped tables to read only the relevant workflow.

The `players/entity` module resolves one live engine player and decorates the native wrapper with the shared SourceJS player operations. It is the object-oriented counterpart to the standalone functions in [`players`](players.md).

The focused entry lives in [`packages/sourcejs/players/entity.js`](../../packages/sourcejs/players/entity.js). Decoration and higher-level behavior live in the root [`players`](../../packages/sourcejs/players/index.js) package, while the initial wrapper and its live properties are created by the native `players` module.

Native wrapper creation stops if a live property cannot be installed. An existing JavaScript exception is propagated unchanged; otherwise the binding reports `Failed to install Player live properties.` No partially installed wrapper is returned.

Live accessor reads resolve current engine state for the stored index; `Index` itself identifies that slot, not a permanent player identity. Writable accessors call the selected SDK immediately. Use these operations synchronously on the game thread, not in a background request. Separate reads are not an atomic snapshot. Resolve a new `Player` after a disconnect or map transition because a slot can belong to another client; keeping a JavaScript wrapper or address does not extend native lifetime.

## Contents

- [Import](#import)
- [Live Properties](#live-properties)
- [Identity and Teams](#identity-and-teams)
- [Commands, Events, and Moderation](#commands-events-and-moderation)
- [Movement and Player State](#movement-and-player-state)
- [View and Tracing](#view-and-tracing)
- [Networking and Spectators](#networking-and-spectators)
- [Weapons and Ammunition](#weapons-and-ammunition)
- [Restrictions, Drops, and Items](#restrictions-drops-and-items)
- [Entity Operations](#entity-operations)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

| Export | Result | Purpose |
| --- | --- | --- |
| `Player(PlayerReference)` | decorated player | Resolve a one-based engine entity index supplied as a primitive signed 32-bit number or an object's `Index` property. Native lookup returns `null` for an invalid or unavailable player; decoration rejects that result with `TypeError`. Missing runtime interfaces/globals or native construction errors also throw. |

The factory forwards `PlayerReference` unchanged. The native lookup reads an object's `Index`, including an inherited property or getter, and requires the same primitive integer representation; it does not coerce strings or `bigint`. A throwing getter propagates its original exception. The examples below deliberately accept only positive numeric indexes.

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

if (typeof Player !== "function") {
	throw new Error("players/entity.Player is unavailable.");
}

function GetPlayerIdentity(unPlayerIndex) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const Identity = {
		Index: CurrentPlayer.Index,
		Name: CurrentPlayer.Name,
		NetworkID: CurrentPlayer.NetworkID,
		UserID: CurrentPlayer.UserID,
	};

	if ((Identity.Index !== unPlayerIndex) || (typeof Identity.Name !== "string") || (typeof Identity.NetworkID !== "string") || !Number.isInteger(Identity.UserID) || (Identity.UserID < -1) || (Identity.UserID > g_nMaximumInt32Value)) {
		throw new Error(`Player(${unPlayerIndex}) returned invalid identity fields.`);
	}

	return Identity;
}

module.exports = { GetPlayerIdentity };
```

`players/entity` exports only `Player`. Import roster queries such as `GetAllPlayers()` and `FromUserID()` directly from [`players`](players.md), and import helpers from their owning modules. Decoration adds missing operations but preserves existing native methods; their argument names, defaults, and validation can differ from the standalone JavaScript facades.

## Live Properties

The native player wrapper includes the live entity properties documented by [`entities/entity`](entities-entity.md):

| Property | Writable | Meaning |
| --- | --- | --- |
| `Index` | no | One-based engine entity index. |
| `Valid` | no | Whether the index still resolves to a non-free edict. |
| `Free` | yes | Current edict free flag. Setting this is a low-level operation; normal plugins should use `Remove()`. |
| `ClassName` | no | Current server class name. |
| `StateFlags` | yes | Raw edict state flags. |
| `NetworkSerialNumber` | yes | Raw edict network serial number. |
| `Edict` | no | Native `edict_t` descriptor, or `null` when unavailable. |
| `BaseEntity` | no | Native `CBaseEntity` descriptor when the SDK exposes it, otherwise `null`. |
| `Address` | no | Native base-entity address as `bigint`; `0n` when unavailable. Borrowed, not owned or proof of readable memory. |
| `BaseHandle` | no | Snapshot descriptor with `Kind`, `Value`, `EntryIndex`, `SerialNumber`, and `Valid`, or `null` when unavailable. It is not a live handle view. |
| `HandleValue` | no | Encoded handle as a `number`; `-1` when unavailable. |

Player-specific properties are also resolved on every access. Their native names are `Team`, `Weapon`, and `Model`, not `TeamNumber`, `WeaponName`, or `ModelName`. Health writes require a selected SDK with base-entity support; otherwise they fail. A missing player-information record produces native sentinel values such as `UserID = -1`, empty identity strings, and an empty `Origin` object:

| Property | Writable | Meaning |
| --- | --- | --- |
| `Name` | yes | Current player name. Assignment performs the native rename operation. |
| `UserID` | no | Current engine user ID. |
| `NetworkID` | no | Current Steam/network identity string. |
| `RemoteAddress` | no | Current real-client network address, or an empty string for bots and unavailable channels. |
| `Team` | yes | Current numeric SDK team. Assignment calls `IPlayerInfo::ChangeTeam()`. |
| `Frags` | no | Current frag count. |
| `Deaths` | no | Current death count. |
| `Health` | yes | Current health. Assignment calls `CBaseEntity::SetHealth()`. |
| `MaximumHealth` | yes | Current maximum health. Assignment calls `CBaseEntity::SetMaxHealth()`. |
| `Connected` | no | Current connection state. |
| `FakeClient` | no | Current SDK fake-client state. |
| `Language` | no | Current real client's `cl_language` value. |
| `Dead` | no | Current death state. |
| `Origin` | no | Absolute-origin snapshot with `X`, `Y`, and `Z` from `IPlayerInfo`, not a live `Vector` view. Use `SetEyeLocation()` or entity properties to move a player. |
| `Weapon` | no | Current weapon name reported by `IPlayerInfo`. |
| `Model` | no | Current model name reported by `IPlayerInfo`. |

Property objects such as `Origin` are current values at the instant of the read. Mutating `Player.Origin.X` changes that returned JavaScript value, not engine memory; assigning one of the explicitly writable top-level properties performs the native write.

At the native boundary, `Origin` is a snapshot record with its own `X`, `Y`, and `Z` data properties, or an empty object when player information is unavailable. Inherited component setters are not invoked. An existing JavaScript exception is preserved; a C++ exception during a live-property read or result construction attempts to report `Error("Player property failed because a native C++ exception occurred.")`. Creating that error object is not guaranteed during allocation failure or execution termination.

Native property writes resolve player information before validating the value; a missing record therefore reports `Player property target is unavailable.` even for an invalid value. `Name` requires a primitive string and uses the connected-player rename helper. `Team` requires a primitive non-negative signed 32-bit integer; it does not resolve team-name aliases. `Health` and `MaximumHealth` require primitive signed 32-bit integers and an available base entity; negative values are passed to the SDK unchanged. Without base-entity support, these health properties reject writes as read-only. Other player-specific properties are read-only. A C++ failure attempts to report `Error("Player property write failed because a native C++ exception occurred.")`, subject to the same allocation/termination limits; an SDK write already performed is not rolled back.

Native Player construction installs the sixteen player-specific properties above and its methods before returning the wrapper. If property installation fails, an existing JavaScript exception propagates unchanged; otherwise the binding reports `Failed to install Player live properties.` No partially installed wrapper is returned. `GiveNamedItem` is installed only with base-entity support.

Without player information, identity strings are empty, `UserID` is `-1`, numeric state fields are `0`, boolean state fields are `false`, and `Origin` is an empty object. `Language` and `RemoteAddress` additionally require a connected non-fake player and a non-free edict. A missing engine or network-information record also produces an empty `RemoteAddress`. These reads do not acquire ownership, extend the native player's lifetime, or establish that an arbitrary address is safe.

The following opt-in example temporarily changes name and health, not team membership. It validates the original values before writing, attempts each needed restoration independently, and preserves the first thrown value, including `null`. Restoration can still fail; it is best-effort, not a transaction or a guarantee that SDK side effects are reversible. Defining the helper performs no player lookup or mutation:

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function WithTemporaryPlayerProperties(unPlayerIndex, strTemporaryName) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof strTemporaryName !== "string") || (strTemporaryName.length === 0) || strTemporaryName.includes("\0")) {
		throw new TypeError("strTemporaryName must be a non-empty NUL-free string.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const PreviousState = {
		Health: CurrentPlayer.Health,
		MaximumHealth: CurrentPlayer.MaximumHealth,
		Name: CurrentPlayer.Name,
		NetworkID: CurrentPlayer.NetworkID,
		UserID: CurrentPlayer.UserID,
	};
	if ((typeof PreviousState.Name !== "string") || (PreviousState.Name.length === 0) || PreviousState.Name.includes("\0") || (typeof PreviousState.NetworkID !== "string") || !Number.isInteger(PreviousState.UserID) || (PreviousState.UserID <= 0) || (PreviousState.UserID > g_nMaximumInt32Value)) {
		throw new Error("The original player identity is unavailable.");
	}

	for (const strPropertyName of ["Health", "MaximumHealth"]) {
		const nHealth = PreviousState[strPropertyName];
		if (!Number.isInteger(nHealth) || (nHealth <= 0) || (nHealth > g_nMaximumInt32Value)) {
			throw new Error("Temporary health changes require positive signed 32-bit original values.");
		}
	}

	const setChangedProperties = new Set();
	let bHasFailure = false;
	let Failure = null;
	let Result = null;
	const RecordFailure = (Error) => {
		if (!bHasFailure) {
			bHasFailure = true;
			Failure = Error;
		}
	};
	const RestoreField = (strPropertyName, Value) => {
		if (!setChangedProperties.has(strPropertyName)) {
			return;
		}

		try {
			if ((CurrentPlayer.UserID !== PreviousState.UserID) || (CurrentPlayer.NetworkID !== PreviousState.NetworkID)) {
				throw new Error("The player identity changed before restoration.");
			}

			CurrentPlayer[strPropertyName] = Value;
		} catch (Error) {
			RecordFailure(Error);
		}
	};

	try {
		setChangedProperties.add("Name");
		CurrentPlayer.Name = strTemporaryName;
		setChangedProperties.add("MaximumHealth");
		CurrentPlayer.MaximumHealth = PreviousState.MaximumHealth;
		setChangedProperties.add("Health");
		CurrentPlayer.Health = Math.min(PreviousState.MaximumHealth, PreviousState.Health);

		Result = {
			Connected: CurrentPlayer.Connected,
			Health: CurrentPlayer.Health,
			Name: CurrentPlayer.Name,
			Address: CurrentPlayer.Address,
		};
		if ((typeof Result.Connected !== "boolean") || !Number.isInteger(Result.Health) || (typeof Result.Name !== "string") || (typeof Result.Address !== "bigint") || (Result.Address < 0n)) {
			throw new Error("The temporary player result is invalid.");
		}
	} catch (Error) {
		RecordFailure(Error);
	}

	RestoreField("Name", PreviousState.Name);
	RestoreField("MaximumHealth", PreviousState.MaximumHealth);
	RestoreField("Health", PreviousState.Health);

	if (bHasFailure) {
		throw Failure;
	}

	return Result;
}

module.exports = { WithTemporaryPlayerProperties };
```

The user-ID/network-ID checks reduce the risk of restoring a reused slot, but do not pin its native lifetime or prevent reentrant changes. Use only in a controlled game-thread phase with live getters and setters that do not disconnect, remove, or replace the player. If any operation fails, inspect current state before retrying; do not blindly replay this helper. A restore setter may already have changed state before throwing.

## Identity and Teams

| Method | Result | Purpose |
| --- | --- | --- |
| `IsConnected()` | `boolean` | Query current connection state. |
| `IsFakeClient()` | `boolean` | Query the SDK fake-client flag. |
| `IsHLTV()` | `boolean` | Query `IPlayerInfo::IsHLTV()`; this does not separately query an SDK replay-client flag. |
| `IsBot()` | `boolean` | Treat fake clients and the `BOT` network ID as bots. |
| `IsInAVehicle()` | `boolean` | Query the selected SDK vehicle handle. |
| `IsObserver()` | `boolean` | Query observer state. |
| `IsDead()` | `boolean` | Query current death state. |
| `GetRawSteamID()` | `SteamID \| null` | Parse the current network identity; bots return `null`. |
| `GetPermissions()` | player permissions | Resolve the live authorization record. |
| `GetName()` / `SetName(strName)` | `string` / `boolean` | Read the player name or update it on the server. The setter requires a connected player, a non-empty name without control characters, and a compatible SDKTools `SetClientName` offset for the current game or SDK, platform, and architecture. `true` means the native name changed or already matched the request. The engine can normalize or shorten the requested name; read `Name` back when the exact spelling matters. `false` means the server-side operation was unavailable or did not apply the request. |
| `GetTeam()` / `SetTeam(TeamReference)` | `number` / `boolean` | Read or change the numeric/profile-backed team. |
| `GetTeamName()` / `SetTeamName(strTeamName)` | `string` / `boolean` | Resolve or change an exact selected-SDK team name. |
| `GetPlayerClass()` / `SetPlayerClass(nPlayerClass)` | `number` / `boolean` | Read or write `m_iClass`. |
| `GetPlayerClassName()` / `SetPlayerClassName(strPlayerClassName)` | `string` / `boolean` | Resolve or write a selected-SDK class name. |
| `GetLanguage()` | `string` | Resolve the current language through `players/helpers`. |

Team and class names come from the selected SDK profile. Portable plugins must inspect that profile instead of hard-coding L4D2, TF2, or Counter-Strike values.

```js
const { Player } = require("players/entity");
const { ClassesByNumber, Names } = require("players/teams");

const g_nMaximumInt32Value = 2147483647;
const g_nMinimumInt32Value = -2147483648;

function RequirePlayerIndex(unPlayerIndex) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}
}

function InspectPlayerProfile(unPlayerIndex, bIncludePlayerClass = false) {
	RequirePlayerIndex(unPlayerIndex);

	if (typeof bIncludePlayerClass !== "boolean") {
		throw new TypeError("bIncludePlayerClass must be a boolean.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const SteamID = CurrentPlayer.GetRawSteamID();
	const Profile = {
		Bot: CurrentPlayer.IsBot(),
		Connected: CurrentPlayer.IsConnected(),
		Dead: CurrentPlayer.IsDead(),
		FakeClient: CurrentPlayer.IsFakeClient(),
		HLTV: CurrentPlayer.IsHLTV(),
		InVehicle: CurrentPlayer.IsInAVehicle(),
		Language: CurrentPlayer.GetLanguage(),
		Name: CurrentPlayer.GetName(),
		Observer: CurrentPlayer.IsObserver(),
		Permissions: CurrentPlayer.GetPermissions(),
		SteamID: (SteamID === null) ? null : SteamID.Render(),
		Team: CurrentPlayer.GetTeam(),
		TeamName: CurrentPlayer.GetTeamName(),
		TeamNames: Names(),
	};

	if (bIncludePlayerClass) {
		Profile.PlayerClass = CurrentPlayer.GetPlayerClass();
		Profile.PlayerClassName = CurrentPlayer.GetPlayerClassName();
		Profile.PlayerClassNames = ClassesByNumber();
	}

	return Profile;
}

function ApplyPlayerProfile(unPlayerIndex, Profile) {
	RequirePlayerIndex(unPlayerIndex);

	if ((Profile === null) || (Profile === undefined) || (typeof Profile !== "object") || Array.isArray(Profile)) {
		throw new TypeError("Profile must be an object.");
	}

	const strPlayerName = Profile.Name;
	const TeamReference = Profile.Team;
	const strTeamName = Profile.TeamName;
	const nPlayerClass = Profile.PlayerClass;
	const strPlayerClassName = Profile.PlayerClassName;
	if ((TeamReference !== undefined) && (strTeamName !== undefined)) {
		throw new TypeError("Specify either Team or TeamName, not both.");
	}

	if ((nPlayerClass !== undefined) && (strPlayerClassName !== undefined)) {
		throw new TypeError("Specify either PlayerClass or PlayerClassName, not both.");
	}

	for (const [strFieldName, strValue] of [["Name", strPlayerName], ["TeamName", strTeamName], ["PlayerClassName", strPlayerClassName]]) {
		if ((strValue !== undefined) && ((typeof strValue !== "string") || (strValue.length === 0) || strValue.includes("\0"))) {
			throw new TypeError(`${strFieldName} must be a non-empty NUL-free string.`);
		}
	}

	if ((nPlayerClass !== undefined) && (!Number.isInteger(nPlayerClass) || (nPlayerClass < g_nMinimumInt32Value) || (nPlayerClass > g_nMaximumInt32Value))) {
		throw new TypeError("PlayerClass must be a signed 32-bit integer.");
	}

	if ((TeamReference !== undefined) && ((typeof TeamReference !== "string") && !Number.isInteger(TeamReference))) {
		throw new TypeError("Team must be an integer or an exact selected-SDK team name.");
	}

	if (((typeof TeamReference === "number") && ((TeamReference < 0) || (TeamReference > g_nMaximumInt32Value))) || ((typeof TeamReference === "string") && ((TeamReference.length === 0) || TeamReference.includes("\0")))) {
		throw new TypeError("Team must be a nonnegative signed 32-bit integer or a non-empty NUL-free name.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const vecChanges = [];

	function ApplyField(strName, Value, Setter) {
		if (Value === undefined) {
			return;
		}

		if (Setter(Value) !== true) {
			throw new Error(`Unable to apply player profile field ${strName}.`);
		}

		vecChanges.push(strName);
	}

	ApplyField("Name", strPlayerName, (strPlayerName) => CurrentPlayer.SetName(strPlayerName));
	ApplyField("Team", TeamReference, (Team) => CurrentPlayer.SetTeam(Team));
	ApplyField("TeamName", strTeamName, (strTeamName) => CurrentPlayer.SetTeamName(strTeamName));
	ApplyField("PlayerClass", nPlayerClass, (nPlayerClass) => CurrentPlayer.SetPlayerClass(nPlayerClass));
	ApplyField("PlayerClassName", strPlayerClassName, (strPlayerClassName) => CurrentPlayer.SetPlayerClassName(strPlayerClassName));

	return vecChanges;
}

module.exports = { ApplyPlayerProfile, InspectPlayerProfile };
```

Class access requires the selected game to expose `m_iClass` and the active team profile to define that numeric class. Pass `bIncludePlayerClass = false` in games without that capability. `ApplyPlayerProfile()` reads each input field once and validates primitive types/ranges before resolving the player. Profile getters must not mutate or disconnect players. It then applies fields in the listed order; selected-SDK name lookup or a later setter can still fail after earlier writes. There is no rollback. Do not replay the entire profile blindly after a failure. `InspectPlayerProfile()` performs separate live reads, not a single consistent engine snapshot.

## Commands, Events, and Moderation

| Method | Result | Purpose |
| --- | --- | --- |
| `ExecuteClientCommand(strCommand, bServerSide = false)` | `boolean` | Send a client command or execute it through the server-side client-command path. |
| `Say(strMessage)` / `SayTeam(strMessage)` | `boolean` | Issue the engine's exact `say` or `say_team` command. |
| `PlaySound(strSoundSample, SoundOptions = {})` | `boolean` | Play a `Sound` or `StreamSound`; fake clients are skipped. |
| `FireGameEvent(strEventName, EventPayload = {}, bDoNotBroadcast = false)` | `boolean` | Seed the engine `userid` from this player, then copy own enumerable payload fields, which may replace it. |
| `Slay()` | `boolean` | Dispatch a native kill through a configured player-action ABI. |
| `Ignite(flDurationSeconds)` | `boolean` | Ignite the player for a finite positive duration in seconds, where the player-action ABI is configured. |
| `GetEyeAngles()` | `{ Pitch, Yaw, Roll } \| null` | Read the connected player's native view angles in degrees, or return `null` if unavailable. |
| `Teleport(Position?, Angles?, Velocity?)` | `boolean` | Pass `null` or omit an argument to leave that value unchanged. |
| `AddVelocity(Impulse)` | `boolean` | Add a vector to a live player's current velocity without requesting a position or angle change. |
| `Spawn(bForce = false)` | `boolean` | Spawn the player; forced support follows the selected SDK implementation. |
| `Kick(strMessage?)` | `boolean` | Request native disconnection; `true` reports dispatch, not confirmed disconnection. See native defaults and fallback reason handling below. |
| `Ban(nBanDuration = 0, bKickPlayer = true, bWriteBanList = true)` | `boolean` | Dispatch a user-ID ban in minutes; `0` is permanent. |
| `ChangeTeam(TeamReference)` | `boolean` | Perform the native team transition. |
| `Mute(ReceiverReferences = null)` / `Unmute(ReceiverReferences = null)` | `boolean` | Add or remove this sender's scoped voice mutes. |
| `IsMuted(ReceiverReferences = null)` | `boolean` | Test whether every selected receiver has this sender muted. |

The underlying native `Kick()`, `Ban()`, and `ChangeTeam()` bindings preserve an exception from the receiver's `Index` getter and stop before their native player lookup or mutation. `Ban()` validates its duration and boolean arguments before reading the receiver, without invoking user-defined duration conversion. These checks do not extend the lifetime of the native player or authorize the operation.

`Slay()` and `Ignite(flDurationSeconds)` use `sdktools.games` from the [startup snapshot](memory-gamedata.md) or an existing local GameData installation on the game thread. The stock `master.games.txt` selects a file for the current game directory. Only offsets explicitly listed for that game and architecture are considered. On Windows, the compiled SDK must declare the supported member signature, and the vtable slot and executable entry must belong to the active game DLL. On Linux, the virtual entry must match the method and parameter types in the loaded binary's ELF symbol table. No additional configuration file is needed. Unsupported or unverified calls return `false`; other platforms do not expose `Ignite()`.

`true` confirms dispatch, not that an engine effect persisted. Missing or incompatible GameData and dead or disconnected players return `false`. These methods do not issue a client command as a fallback. `Ignite()` throws for a duration that is not a primitive number, finite, positive, and representable as a native float.

`GetEyeAngles()` and `Teleport()` are available on Windows and Linux builds with the base-entity SDK header. They use the current game's GameData and the call shapes declared by the SDK. Position and velocity use `{ X, Y, Z }`; angles use `{ Pitch, Yaw, Roll }` in degrees. All supplied components must be finite. To change a view without moving the player or replacing their velocity, call `Player.Teleport(null, Angles, null)`. To change only roll, read `GetEyeAngles()` first and pass the returned pitch and yaw back unchanged. `Teleport()` returns `false` when nothing is supplied, the player is disconnected, or the engine method cannot be resolved. A `true` result confirms native dispatch, not client receipt or visible camera movement.

`AddVelocity({ X, Y, Z })` is available on Windows and Linux builds with the base-entity SDK header. It uses the current game's SDKTools GameData entries for `GetVelocity` and `Teleport`, with the call shapes selected by the SDK. It rejects an absent or invalid vector and returns `false` when the player is not live, GameData cannot resolve the required methods, or the resulting velocity is not finite. A `true` result means the engine received the requested velocity; it does not guarantee displacement after collision or later simulation.

Native `Player.Kick()` requires a connected player. An omitted or nullish `strMessage` uses `Kicked by SourceJS.`; otherwise a primitive string is required. When an SDK client can be disconnected directly, the reason is passed as a native C string, so an embedded NUL ends it. The server-command fallback replaces CR, LF, and semicolons with spaces and substitutes `Kicked by SourceJS.` for an empty reason. The package-level `players.Kick(PlayerReference, strKickMessage = "")` facade forwards its explicit empty default; it is not the native method's omitted-argument default. Native `Kick()` attempts to translate caught C++ failures into contextual JavaScript `Error` exceptions while preserving existing JavaScript exceptions; this does not undo an already dispatched disconnection or command, or protect against invalid-memory faults.

Native `Player.Ban()` defaults to duration `0`, kicking the player, and writing the ban list. A supplied duration must be a primitive number containing a finite integer from `0` through `2147483647`; numeric `-0` is treated as `0`. The binding checks type, integrality and range before narrowing to the native signed 32-bit duration. Strings, booleans, boxed numbers, other objects, `bigint`, symbols, fractional/non-finite/out-of-range numbers and explicitly supplied `null` or `undefined` fail without invoking `valueOf()`, `toString()` or `Symbol.toPrimitive`. Supplied kick/write flags must be primitive booleans. Omit arguments to use native defaults. The player must be connected. The binding dispatches `banid <duration> <user ID>` with optional ` kick`, then dispatches `writeid` when requested even if the first dispatch returned `false`. Its result combines those dispatch statuses, not confirmed banning or durable persistence. A failure after dispatch does not roll back the earlier operation.

Native `Player.ChangeTeam(TeamReference)` accepts a signed 32-bit team number or a primitive configured team-name string. Nullish values and unknown names resolve to the negative sentinel and are rejected; configured-team data errors propagate. It resolves the receiver and player information before decoding the supplied team. `true` means the SDK team-change method returned, not that a later engine-state query confirmed the transition. Both `Ban()` and `ChangeTeam()` attempt to translate C++ exceptions into operation-specific JavaScript `Error` objects without replacing an existing JavaScript exception or proving native-memory safety. As with live-property failures, allocation failure or execution termination can prevent construction of that error object.

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function NotifyPlayer(unPlayerIndex, strEventName, EventPayload, strSoundSample) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof strEventName !== "string") || (strEventName.length === 0) || strEventName.includes("\0")) {
		throw new TypeError("strEventName must be a non-empty NUL-free string.");
	}

	if ((EventPayload === null) || (typeof EventPayload !== "object") || Array.isArray(EventPayload)) {
		throw new TypeError("EventPayload must be an object.");
	}

	if ((typeof strSoundSample !== "string") || (strSoundSample.length === 0) || strSoundSample.includes("\0")) {
		throw new TypeError("strSoundSample must be a non-empty NUL-free string.");
	}

	if (Object.hasOwn(EventPayload, "userid")) {
		throw new TypeError("EventPayload must not override the engine userid field.");
	}

	const EventSnapshot = Object.create(null);
	for (const strFieldName of Object.keys(EventPayload)) {
		EventSnapshot[strFieldName] = EventPayload[strFieldName];
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const bConnected = CurrentPlayer.IsConnected();
	const bFakeClient = CurrentPlayer.IsFakeClient();
	if ((typeof bConnected !== "boolean") || (typeof bFakeClient !== "boolean")) {
		throw new TypeError("Player connection flags must be booleans.");
	}

	if (!bConnected || bFakeClient) {
		return false;
	}

	if (CurrentPlayer.ExecuteClientCommand("echo SourceJS Player wrapper", false) !== true) {
		throw new Error(`Unable to send a client command to player ${unPlayerIndex}.`);
	}

	if (CurrentPlayer.Say("SourceJS is active.") !== true) {
		throw new Error(`Unable to send public chat for player ${unPlayerIndex}.`);
	}

	if (CurrentPlayer.SayTeam("This message uses team chat.") !== true) {
		throw new Error(`Unable to send team chat for player ${unPlayerIndex}.`);
	}

	if (CurrentPlayer.PlaySound(strSoundSample, { Volume: 0.7 }) !== true) {
		throw new Error(`Unable to play ${strSoundSample} for player ${unPlayerIndex}.`);
	}

	if (CurrentPlayer.FireGameEvent(strEventName, EventSnapshot, true) !== true) {
		throw new Error(`Unable to fire ${strEventName} for player ${unPlayerIndex}.`);
	}

	return true;
}

module.exports = { NotifyPlayer };
```

Supply an event declared by the loaded game's event resources and a sample available to that game. Exact native schema keys such as `userid` and `text`, and engine commands such as `say`/`say_team`, retain their external spelling; they are not project-owned API properties. The helper snapshots own enumerable string payload fields once and rejects an own `userid` override. Payload getters must not mutate or disconnect players. Calling `NotifyPlayer()` performs real operations in order. `true` reports successful submission to the SDK, not receipt by the client; a later failure does not undo earlier command, chat, sound, or event effects. Do not blindly replay it.

Administrative actions belong behind explicit authorization and confirmation. This dispatcher performs real player operations while keeping the policy decision outside the API wrapper:

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function ApplyAdministrativeAction(unPlayerIndex, strAction, TeamReference = null) {
	const unBanDurationMinutes = 30;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof strAction !== "string") || !["BAN30", "CHANGETEAM", "KICK", "RESPAWN", "SLAY"].includes(strAction)) {
		throw new RangeError("strAction must be BAN30, CHANGETEAM, KICK, RESPAWN, or SLAY.");
	}

	if (strAction === "CHANGETEAM") {
		const bNumericTeam = Number.isInteger(TeamReference) && (TeamReference >= 0) && (TeamReference <= g_nMaximumInt32Value);
		const bNamedTeam = (typeof TeamReference === "string") && (TeamReference.length > 0) && !TeamReference.includes("\0");
		if (!bNumericTeam && !bNamedTeam) {
			throw new TypeError("TeamReference must be a nonnegative signed 32-bit integer or a non-empty NUL-free selected-SDK name.");
		}
	}

	const CurrentPlayer = Player(unPlayerIndex);
	let bResult = false;

	switch (strAction) {
		case "BAN30":
			bResult = CurrentPlayer.Ban(unBanDurationMinutes, true, true);
			break;

		case "CHANGETEAM":
			bResult = CurrentPlayer.ChangeTeam(TeamReference);
			break;

		case "KICK":
			bResult = CurrentPlayer.Kick("Removed by an administrator");
			break;

		case "RESPAWN":
			bResult = CurrentPlayer.Spawn(true);
			break;

		case "SLAY":
			bResult = CurrentPlayer.Slay();
			break;

		default:
			throw new RangeError("Administrative action validation failed.");
	}

	if (typeof bResult !== "boolean") {
		throw new Error("The administrative SDK operation returned a non-boolean result.");
	}

	return bResult;
}

module.exports = { ApplyAdministrativeAction };
```

The administrative selector uses compact project-owned action codes; engine commands keep their external spelling. It validates the action before player lookup, but performs no authorization. A result reports the selected SDK operation, not client acknowledgement. Bans, kicks, spawns, and team changes are real effects and are not rolled back.

Mute one sender for selected receivers during a synchronous callback, inspect spectators, then attempt to release newly added pairs independently:

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function WithSenderMuted(unSenderIndex, vecReceiverIndexes, Callback) {
	if (!Number.isInteger(unSenderIndex) || (unSenderIndex <= 0) || (unSenderIndex > g_nMaximumInt32Value) || !Array.isArray(vecReceiverIndexes) || (typeof Callback !== "function")) {
		throw new TypeError("A positive signed 32-bit sender index, receiver array, and synchronous callback are required.");
	}

	const vecReceivers = Array.from(vecReceiverIndexes);
	if ((vecReceivers.length === 0) || !vecReceivers.every((unReceiverIndex) => Number.isInteger(unReceiverIndex) && (unReceiverIndex > 0) && (unReceiverIndex <= g_nMaximumInt32Value))) {
		throw new TypeError("Every receiver must be a positive signed 32-bit index; sparse arrays are invalid.");
	}

	const vecSelectedReceivers = [...new Set(vecReceivers)];
	const Sender = Player(unSenderIndex);
	const nSenderUserID = Sender.UserID;
	if (!Number.isInteger(nSenderUserID) || (nSenderUserID <= 0) || (nSenderUserID > g_nMaximumInt32Value)) {
		throw new Error("The sender identity is unavailable.");
	}

	const vecNewlyMuted = [];
	for (const unReceiverIndex of vecSelectedReceivers) {
		const bMuted = Sender.IsMuted([unReceiverIndex]);
		if (typeof bMuted !== "boolean") {
			throw new TypeError("IsMuted() must return a boolean.");
		}

		if (!bMuted) {
			vecNewlyMuted.push(unReceiverIndex);
		}
	}

	let bMuteAttempted = false;
	let bHasFailure = false;
	let Failure = null;
	let Result = null;
	const RecordFailure = (Error) => {
		if (!bHasFailure) {
			bHasFailure = true;
			Failure = Error;
		}
	};

	try {
		if (vecNewlyMuted.length !== 0) {
			bMuteAttempted = true;
			if (Sender.Mute(vecNewlyMuted) !== true) {
				throw new Error("Unable to mute the selected sender.");
			}
		}

		if (Sender.IsMuted(vecSelectedReceivers) !== true) {
			throw new Error("Voice mute verification failed.");
		}

		const vecSpectators = Sender.GetSpectators();
		if (!Array.isArray(vecSpectators)) {
			throw new TypeError("GetSpectators() must return an array.");
		}

		const vecSpectatorIndexes = Array.from(vecSpectators).map((Spectator) => {
			const unIndex = Spectator.Index;
			if (!Number.isInteger(unIndex) || (unIndex <= 0) || (unIndex > g_nMaximumInt32Value)) {
				throw new TypeError("The spectator index is invalid.");
			}

			return unIndex;
		});
		Result = Callback({ Sender, SpectatorIndexes: vecSpectatorIndexes });
		if ((Result !== null) && ((typeof Result === "object") || (typeof Result === "function")) && (typeof Result.then === "function")) {
			throw new TypeError("WithSenderMuted() requires a synchronous callback, not a promise/thenable.");
		}
	} catch (Error) {
		RecordFailure(Error);
	}

	if (bMuteAttempted) {
		for (const unReceiverIndex of vecNewlyMuted) {
			try {
				if (Sender.UserID !== nSenderUserID) {
					throw new Error("The sender identity changed before unmuting.");
				}

				if (Sender.Unmute([unReceiverIndex]) !== true) {
					throw new Error("Unable to restore a newly added voice mute.");
				}
			} catch (Error) {
				RecordFailure(Error);
			}
		}
	}

	if (bHasFailure) {
		throw Failure;
	}

	return Result;
}

module.exports = { WithSenderMuted };
```

This helper uses the shared `MUTE_MANAGER`, not an exclusive mute lease. The callback must not disconnect/reuse sender or receiver slots, change these pairs through the same manager, or schedule work that relies on the temporary mutes. It snapshots and deduplicates receiver indexes, skips already-owned pairs, and preserves the first thrown value (including `null`) while attempting each newly added pair's cleanup. Cleanup can fail or leave partial native effects. A sender user-ID check does not pin native lifetime; receiver lifetime remains a caller precondition. A rejected promise/thenable is not cancelled.

## Movement and Player State

| Method | Result | Purpose |
| --- | --- | --- |
| `GetEyeLocation()` / `SetEyeLocation(EyeLocation)` | `Vector` / `boolean` | Read the eye world position or move the origin so the eye reaches that position. |
| `Push(flHorizontalMultiplier, flVerticalMultiplier, bVerticalOverride = false)` | `boolean` | Write view-relative base velocity: scale horizontal forward components and scale the forward Z component unless override selects the supplied vertical value. |
| `GetNoClip()` / `SetNoClip(bEnabled)` | `boolean` / `boolean` | Query or select `MoveType.NoClip`; disabling selects `MoveType.Walk`. |
| `GetJetpack()` / `SetJetpack(bEnabled)` | `boolean` / `boolean` | Query or select `MoveType.Fly`; disabling selects `MoveType.Walk`. |
| `GetStuck()` / `SetStuck(bEnabled)` | `boolean` / `boolean` | Query or select `MoveType.None`; disabling selects `MoveType.Walk`. |
| `GetGodMode()` / `SetGodMode(bEnabled)` | `boolean` / `boolean` | Read or write the damage mode. |
| `GetNoBlock()` / `SetNoBlock(bEnabled)` | `boolean` / `boolean` | Toggle the player/debris-trigger collision group. |
| `GetFlashlight()` / `SetFlashlight(bEnabled)` | `boolean` / `boolean` | Toggle `EntityEffects.DimLight`. |
| `GetFrozen()` / `SetFrozen(bEnabled)` | `boolean` / `boolean` | Access `FL_FROZEN`. These methods exist only when the selected SDK defines the flag. |

This opt-in helper handles capability-conditioned frozen methods, validates boolean snapshots, and checks writes and independent cleanup. It restores the observed booleans, not every underlying SDK enum or side effect:

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function WithTemporaryPlayerState(unPlayerIndex) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const nUserID = CurrentPlayer.UserID;
	if (!Number.isInteger(nUserID) || (nUserID <= 0) || (nUserID > g_nMaximumInt32Value)) {
		throw new Error("The player identity is unavailable.");
	}

	const vecSettings = [
		{ Name: "Flashlight", Get: CurrentPlayer.GetFlashlight, Set: CurrentPlayer.SetFlashlight, Attempted: false },
		{ Name: "GodMode", Get: CurrentPlayer.GetGodMode, Set: CurrentPlayer.SetGodMode, Attempted: false },
		{ Name: "NoBlock", Get: CurrentPlayer.GetNoBlock, Set: CurrentPlayer.SetNoBlock, Attempted: false },
	];
	const GetFrozen = CurrentPlayer.GetFrozen;
	const SetFrozen = CurrentPlayer.SetFrozen;
	if ((GetFrozen !== undefined) || (SetFrozen !== undefined)) {
		vecSettings.push({ Name: "Frozen", Get: GetFrozen, Set: SetFrozen, Attempted: false });
	}

	for (const Setting of vecSettings) {
		if ((typeof Setting.Get !== "function") || (typeof Setting.Set !== "function")) {
			throw new TypeError("Each supported state requires callable getter and setter methods.");
		}

		Setting.Previous = Setting.Get.call(CurrentPlayer);
		if (typeof Setting.Previous !== "boolean") {
			throw new TypeError("The original state must be boolean.");
		}
	}

	let bHasFailure = false;
	let Failure = null;
	const Result = { Frozen: null };
	const RecordFailure = (Error) => {
		if (!bHasFailure) {
			bHasFailure = true;
			Failure = Error;
		}
	};
	const RequireWrite = (bResult) => {
		if (bResult !== true) {
			throw new Error("The SDK state write failed.");
		}
	};

	try {
		for (const Setting of vecSettings) {
			Setting.Attempted = true;
			RequireWrite(Setting.Set.call(CurrentPlayer, !Setting.Previous));
		}

		for (const Setting of vecSettings) {
			const bValue = Setting.Get.call(CurrentPlayer);
			if (typeof bValue !== "boolean") {
				throw new TypeError("The temporary state must be boolean.");
			}

			Result[Setting.Name] = bValue;
		}
	} catch (Error) {
		RecordFailure(Error);
	}

	for (const Setting of vecSettings) {
		if (!Setting.Attempted) {
			continue;
		}

		try {
			if (CurrentPlayer.UserID !== nUserID) {
				throw new Error("The player identity changed before state restoration.");
			}

			RequireWrite(Setting.Set.call(CurrentPlayer, Setting.Previous));
		} catch (Error) {
			RecordFailure(Error);
		}
	}

	if (bHasFailure) {
		throw Failure;
	}

	return Result;
}

module.exports = { WithTemporaryPlayerState };
```

Use `WithTemporaryPlayerState()` only with stable player identity and ordinary selected-SDK damage/collision modes: disabling GodMode selects `TakeDamage.Yes`, and disabling NoBlock selects `CollisionGroup.Player`. A false predicate does not preserve an arbitrary original enum value. Flashlight and frozen setters update their corresponding bits, but cleanup is still best-effort and does not undo external SDK side effects. Inspect actual state before retrying a failed operation.

NoClip, jetpack, and stuck inspect/write the same move-type property. The following helper selects a mode; it does not own it or restore it automatically. `PreviousMode = "OTHER"` includes normal walking and any unrecognized native mode:

```js
const { Player } = require("players/entity");
const { Vector } = require("mathlib");

const g_nMaximumInt32Value = 2147483647;

function RequireWrite(bResult, strOperation) {
	if (bResult !== true) {
		throw new Error(strOperation + " failed.");
	}
}

function CopyEyeLocation(VectorLike) {
	if ((VectorLike === null) || (typeof VectorLike !== "object") || Array.isArray(VectorLike)) {
		throw new TypeError("Eye location must be an X/Y/Z record.");
	}

	const flX = VectorLike.X;
	const flY = VectorLike.Y;
	const flZ = VectorLike.Z;
	if ([flX, flY, flZ].some((flValue) => (typeof flValue !== "number") || !Number.isFinite(flValue) || !Number.isFinite(Math.fround(flValue)))) {
		throw new TypeError("Eye components must be finite numbers representable by SDK floats.");
	}

	return new Vector(flX, flY, flZ);
}

function SelectMovementMode(unPlayerIndex, strMode) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof strMode !== "string") || !["JETPACK", "NOCLIP", "STUCK", "WALK"].includes(strMode)) {
		throw new RangeError("strMode must be JETPACK, NOCLIP, STUCK, or WALK.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const bJetpack = CurrentPlayer.GetJetpack();
	const bNoClip = CurrentPlayer.GetNoClip();
	const bStuck = CurrentPlayer.GetStuck();
	if ([bJetpack, bNoClip, bStuck].some((bValue) => typeof bValue !== "boolean")) {
		throw new TypeError("Move-type predicates must be booleans.");
	}

	if ((bJetpack && bNoClip) || (bJetpack && bStuck) || (bNoClip && bStuck)) {
		throw new Error("Separate move-type reads produced an inconsistent state.");
	}

	let strPreviousMode = "OTHER";
	if (bJetpack) {
		strPreviousMode = "JETPACK";
	} else if (bNoClip) {
		strPreviousMode = "NOCLIP";
	} else if (bStuck) {
		strPreviousMode = "STUCK";
	}

	if (strMode === "JETPACK") {
		RequireWrite(CurrentPlayer.SetJetpack(true), "SetJetpack");
		return { PreviousMode: strPreviousMode, SelectedMode: strMode };
	}

	if (strMode === "NOCLIP") {
		RequireWrite(CurrentPlayer.SetNoClip(true), "SetNoClip");
		return { PreviousMode: strPreviousMode, SelectedMode: strMode };
	}

	if (strMode === "STUCK") {
		RequireWrite(CurrentPlayer.SetStuck(true), "SetStuck");
		return { PreviousMode: strPreviousMode, SelectedMode: strMode };
	}

	RequireWrite(CurrentPlayer.SetNoClip(false), "SetNoClip");

	return { PreviousMode: strPreviousMode, SelectedMode: strMode };
}

function MovePlayer(unPlayerIndex, EyeLocation, flHorizontalMultiplier, flVerticalMultiplier, bVerticalOverride = false) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof flHorizontalMultiplier !== "number") || !Number.isFinite(flHorizontalMultiplier) || !Number.isFinite(Math.fround(flHorizontalMultiplier)) || (typeof flVerticalMultiplier !== "number") || !Number.isFinite(flVerticalMultiplier) || !Number.isFinite(Math.fround(flVerticalMultiplier)) || (typeof bVerticalOverride !== "boolean")) {
		throw new TypeError("Push requires finite numeric multipliers and a boolean override.");
	}

	const Destination = CopyEyeLocation(EyeLocation);
	const CurrentPlayer = Player(unPlayerIndex);
	const PreviousEyeLocation = CopyEyeLocation(CurrentPlayer.GetEyeLocation());
	const nUserID = CurrentPlayer.UserID;
	if (!Number.isInteger(nUserID) || (nUserID <= 0) || (nUserID > g_nMaximumInt32Value)) {
		throw new Error("The player identity is unavailable.");
	}

	try {
		RequireWrite(CurrentPlayer.SetEyeLocation(Destination), "SetEyeLocation");
		RequireWrite(CurrentPlayer.Push(flHorizontalMultiplier, flVerticalMultiplier, bVerticalOverride), "Push");
	} catch (PrimaryError) {
		try {
			if (CurrentPlayer.UserID !== nUserID) {
				throw new Error("The player identity changed before eye-position restoration.");
			}

			RequireWrite(CurrentPlayer.SetEyeLocation(PreviousEyeLocation), "restore SetEyeLocation");
		} catch {
			// Preserve the primary failure; restoration can fail after a partial native write.
		}

		throw PrimaryError;
	}

	return PreviousEyeLocation;
}

module.exports = { MovePlayer, SelectMovementMode };
```

`MovePlayer()` snapshots X/Y/Z before any write and rejects non-finite input; record getters must not mutate players. On false/throw from either write it attempts to restore eye position, preserving the first thrown value, even `null`. That restore can fail and does not restore base velocity, undo gameplay side effects, or pin native lifetime. On success it leaves the player moved and returns a detached previous-eye snapshot for an explicit later restore. A mode change or move is not a transaction; do not blindly replay failures. Use all these helpers in a controlled synchronous game-thread phase with stable player identity.

## View and Tracing

| Method | Result | Purpose |
| --- | --- | --- |
| `GetViewVector()` | `Vector` | Convert current eye angles to a forward vector. |
| `GetTraceRay(unContentMask?, TraceFilter?)` | trace result | Trace from the eye to the selected SDK's maximum trace length. |
| `GetViewCoordinates(unContentMask?, TraceFilter?)` | `Vector \| null` | Return current trace-hit coordinates. |
| `SetViewCoordinates(ViewCoordinates)` | `boolean` | Turn the player's eye angles toward world coordinates. |
| `GetViewEntity(unContentMask?, TraceFilter?)` | entity or `null` | Return the entity under the crosshair. |
| `SetViewEntity(EntityReference)` | `boolean` | Turn toward an entity's origin. |
| `GetViewPlayer(unContentMask?, TraceFilter?)` | player or `null` | Return a connected player under the crosshair. |
| `SetViewPlayer(TargetPlayer)` | `boolean` | Turn toward another player's eye location. |

```js
const { Player } = require("players/entity");
const { Vector } = require("mathlib");

const g_nMaximumInt32Value = 2147483647;

function RequirePlayerIndex(unPlayerIndex) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}
}

function CopyCoordinates(VectorLike) {
	if ((VectorLike === null) || (typeof VectorLike !== "object") || Array.isArray(VectorLike)) {
		throw new TypeError("Coordinates must be an X/Y/Z record.");
	}

	const flX = VectorLike.X;
	const flY = VectorLike.Y;
	const flZ = VectorLike.Z;
	if ([flX, flY, flZ].some((flValue) => (typeof flValue !== "number") || !Number.isFinite(flValue) || !Number.isFinite(Math.fround(flValue)))) {
		throw new TypeError("Coordinate components must be finite SDK-float numbers.");
	}

	return new Vector(flX, flY, flZ);
}

function RequireTargetIndex(Target) {
	const unIndex = (typeof Target === "number") ? Target : Target?.Index;
	if (!Number.isInteger(unIndex) || (unIndex <= 0) || (unIndex > g_nMaximumInt32Value)) {
		throw new TypeError("Entity/player targets require a positive signed 32-bit index or indexed object.");
	}

	return unIndex;
}

function InspectPlayerView(unPlayerIndex) {
	RequirePlayerIndex(unPlayerIndex);

	const CurrentPlayer = Player(unPlayerIndex);
	const TraceResult = CurrentPlayer.GetTraceRay();
	if ((TraceResult === null) || (typeof TraceResult !== "object") || Array.isArray(TraceResult)) {
		throw new TypeError("GetTraceRay() must return an object.");
	}

	const flFraction = TraceResult.Fraction;
	if ((typeof flFraction !== "number") || !Number.isFinite(flFraction) || (flFraction < 0) || (flFraction > 1)) {
		throw new Error("The trace fraction is invalid.");
	}

	const CoordinateValue = CurrentPlayer.GetViewCoordinates();
	const Coordinates = (CoordinateValue === null) ? null : CopyCoordinates(CoordinateValue);
	const Entity = CurrentPlayer.GetViewEntity();
	const unEntityIndex = (Entity === null) ? null : RequireTargetIndex(Entity);
	const TargetPlayer = CurrentPlayer.GetViewPlayer();
	const unTargetPlayerIndex = (TargetPlayer === null) ? null : RequireTargetIndex(TargetPlayer);
	const Forward = CopyCoordinates(CurrentPlayer.GetViewVector());

	return { Coordinates, EntityIndex: unEntityIndex, Forward, Fraction: flFraction, PlayerIndex: unTargetPlayerIndex };
}

function AimPlayerAt(unPlayerIndex, Target) {
	RequirePlayerIndex(unPlayerIndex);

	if ((Target === null) || (typeof Target !== "object") || Array.isArray(Target)) {
		throw new TypeError("Target must be an object.");
	}

	const Snapshot = { Coordinates: Target.Coordinates, Entity: Target.Entity, Player: Target.Player };
	const vecTargetNames = ["Coordinates", "Entity", "Player"].filter((strName) => Snapshot[strName] !== undefined);
	if (vecTargetNames.length !== 1) {
		throw new TypeError("Target must provide exactly one of Coordinates, Entity, or Player.");
	}

	const strTargetName = vecTargetNames[0];
	const SelectedTarget = (strTargetName === "Coordinates") ? CopyCoordinates(Snapshot.Coordinates) : RequireTargetIndex(Snapshot[strTargetName]);
	const CurrentPlayer = Player(unPlayerIndex);
	let bAimed = false;

	if (strTargetName === "Coordinates") {
		bAimed = CurrentPlayer.SetViewCoordinates(SelectedTarget);
	} else if (strTargetName === "Entity") {
		bAimed = CurrentPlayer.SetViewEntity(SelectedTarget);
	} else {
		bAimed = CurrentPlayer.SetViewPlayer(SelectedTarget);
	}

	if (bAimed !== true) {
		throw new Error("The aim operation failed.");
	}

	return true;
}

module.exports = { AimPlayerAt, InspectPlayerView };
```

`InspectPlayerView()` uses default content masks and the default filter that excludes the viewing player. Its four view/trace methods perform separate traces: fraction, coordinates, entity, and player need not describe one coherent hit. It snapshots each returned fraction/index/vector component once, but does not pin entity lifetime. Pass custom masks/filters through the underlying methods for game-specific traces.

`AimPlayerAt()` snapshots the three selector fields once before lookup. This example accepts X/Y/Z coordinate records and positive indexes or indexed objects, rather than every representation supported by the underlying APIs. Selector/component/index getters must not mutate players. A successful return reports the selected angle-write result, not target lifetime or future view direction; a failed write can still have partial effects. The helpers perform no SDK access while their code blocks are loaded.

## Networking and Spectators

| Method | Result | Purpose |
| --- | --- | --- |
| `GetClientCVarValue(strConVarName)` | `string` | Query a client CVar through `IVEngineServer`. |
| `GetNetInfo()` | netchannel information or `null` | Resolve a borrowed live `INetChannelInfo` wrapper, or `null` when the client has no channel. Interface/argument errors can throw. |
| `SendConVarValue(strConVarName, strConVarValue)` | `boolean` | Send `NET_SetConVar`; both values must be strings. |
| `GetSpectators()` | player array | Return current players whose observer target is this player. |

`GetNetInfo()` delegates to `netchannel.GetPlayerNetChannelInfo()`. Use the selected SDK's `NET_FLOW.Incoming` or `NET_FLOW.Outgoing` for latency queries. `SendConVarValue()` sends a per-client ConVar update; it does not mutate the server's actual ConVar. Its result does not acknowledge receipt or prove a later client CVar query will reflect the value. Net-channel wrappers and spectator/player wrappers borrow native state; do not retain them across disconnects or map changes. `GetSpectators()` constructs a current roster from separate live reads, not an atomic server snapshot.

```js
const { NET_FLOW } = require("netchannel");
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function IsRealConnectedPlayer(CurrentPlayer) {
	const bConnected = CurrentPlayer.IsConnected();
	if (typeof bConnected !== "boolean") {
		throw new TypeError("IsConnected() must return a boolean.");
	}

	if (!bConnected) {
		return false;
	}

	const bFakeClient = CurrentPlayer.IsFakeClient();
	if (typeof bFakeClient !== "boolean") {
		throw new TypeError("IsFakeClient() must return a boolean.");
	}

	return !bFakeClient;
}

function InspectPlayerNetwork(unPlayerIndex, strClientConVarName = "cl_language") {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof strClientConVarName !== "string") || (strClientConVarName.length === 0) || strClientConVarName.includes("\0")) {
		throw new TypeError("strClientConVarName must be a non-empty NUL-free string.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const vecCurrentSpectators = CurrentPlayer.GetSpectators();
	if (!Array.isArray(vecCurrentSpectators)) {
		throw new TypeError("GetSpectators() must return an array.");
	}

	const vecSpectatorIndexes = Array.from(vecCurrentSpectators).map((Spectator) => {
		if ((Spectator === null) || (typeof Spectator !== "object") || Array.isArray(Spectator)) {
			throw new TypeError("A spectator must be an indexed player object.");
		}

		const unSpectatorIndex = Spectator.Index;
		if (!Number.isInteger(unSpectatorIndex) || (unSpectatorIndex <= 0) || (unSpectatorIndex > g_nMaximumInt32Value)) {
			throw new TypeError("The spectator index is invalid.");
		}

		return unSpectatorIndex;
	});

	if (!IsRealConnectedPlayer(CurrentPlayer)) {
		return { Network: null, SpectatorIndexes: vecSpectatorIndexes };
	}

	const NetChannelInformation = CurrentPlayer.GetNetInfo();
	if ((NetChannelInformation === null) || (typeof NetChannelInformation !== "object") || Array.isArray(NetChannelInformation)) {
		throw new Error("The player has no usable network channel.");
	}

	const strClientConVarValue = CurrentPlayer.GetClientCVarValue(strClientConVarName);
	if (typeof strClientConVarValue !== "string") {
		throw new TypeError("The client ConVar value must be a string.");
	}

	const flIncomingLatency = NetChannelInformation.GetNetChannelLatency(NET_FLOW.Incoming);
	if ((typeof flIncomingLatency !== "number") || !Number.isFinite(flIncomingLatency) || (flIncomingLatency < 0)) {
		throw new Error("The incoming latency must be a finite nonnegative number of seconds.");
	}

	return {
		Network: { ClientConVarName: strClientConVarName, ClientConVarValue: strClientConVarValue, IncomingLatency: flIncomingLatency },
		SpectatorIndexes: vecSpectatorIndexes,
	};
}

function SendClientConVarValue(unPlayerIndex, strConVarName, strConVarValue) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof strConVarName !== "string") || (strConVarName.length === 0) || strConVarName.includes("\0") || (typeof strConVarValue !== "string") || strConVarValue.includes("\0")) {
		throw new TypeError("A non-empty NUL-free ConVar name and NUL-free string value are required.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	if (!IsRealConnectedPlayer(CurrentPlayer)) {
		return false;
	}

	const bConVarSent = CurrentPlayer.SendConVarValue(strConVarName, strConVarValue);
	if (typeof bConVarSent !== "boolean") {
		throw new TypeError("SendConVarValue() must return a boolean.");
	}

	return bConVarSent;
}

module.exports = { InspectPlayerNetwork, SendClientConVarValue };
```

Defining these helpers performs no SDK access. Their spectator indexes and network values are detached snapshots from separate live reads, not one atomic server state. Disconnected or fake clients produce `Network: null`/`false`; malformed results, a missing real-client channel, and native exceptions are not replaced with success. `IncomingLatency` is measured in seconds. Call `SendClientConVarValue()` only with a client ConVar understood by the loaded game and a valid value; its result is not a receipt acknowledgement.

## Weapons and Ammunition

| Method | Result | Purpose |
| --- | --- | --- |
| `GetActiveWeapon()` | weapon or `null` | Read the current active-weapon handle. |
| `SetActiveWeapon(WeaponReference)` | `true \| undefined` | Replace the active-weapon handle. Returns `true` after the write; an invalid storage range or alignment can produce `undefined`, not success. |
| `GetWeaponIndexes(strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null)` | number array | Enumerate indexes using class/filter constraints. |
| `GetWeapons(strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null)` | weapon array | Return decorated owned weapons. |
| `GetWeapon(strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null)` | weapon or `null` | Return the first matching owned weapon. |
| `GetPrimaryWeapon()` / `GetSecondaryWeapon()` | weapon or `null` | Return the first weapon matching the selected profile filter. |
| `GetProjectileIndexes(strProjectileName)` | number array | Resolve owned projectiles or matching weapons. |
| `GetProjectileAmmo(strProjectileName)` / `SetProjectileAmmo(strProjectileName, nAmmoValue)` | `number \| undefined` / `true \| undefined` | Read or write signed SDK `int` ammo. An invalid storage range can produce `undefined`, not a value or successful write. |

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function GetOptionalWeaponIndex(WeaponReference, strWeaponRole) {
	if (WeaponReference === null) {
		return null;
	}

	if ((typeof WeaponReference !== "object") || Array.isArray(WeaponReference)) {
		throw new TypeError(strWeaponRole + " must be an indexed weapon object or null.");
	}

	const unIndex = WeaponReference.Index;
	if (!Number.isInteger(unIndex) || (unIndex <= 0) || (unIndex > g_nMaximumInt32Value)) {
		throw new TypeError(strWeaponRole + " has an invalid index.");
	}

	return unIndex;
}

function SnapshotFilters(FilterNames) {
	if ((FilterNames === null) || (FilterNames === undefined)) {
		return null;
	}

	if (typeof FilterNames === "string") {
		if ((FilterNames.length === 0) || FilterNames.includes("\0")) {
			throw new TypeError("A filter name must be non-empty and NUL-free.");
		}

		return FilterNames;
	}

	const Iterate = FilterNames[Symbol.iterator];
	if (typeof Iterate !== "function") {
		throw new TypeError("Filters must be a string, iterable, null, or undefined.");
	}

	const vecNames = Array.from({ [Symbol.iterator]: () => Iterate.call(FilterNames) });
	if (vecNames.some((strName) => (typeof strName !== "string") || (strName.length === 0) || strName.includes("\0"))) {
		throw new TypeError("Every filter name must be a non-empty NUL-free string.");
	}

	return vecNames;
}

function InspectPlayerWeapons(unPlayerIndex, strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((strClassName !== null) && ((typeof strClassName !== "string") || (strClassName.length === 0) || strClassName.includes("\0"))) {
		throw new TypeError("strClassName must be null or a non-empty NUL-free string.");
	}

	const RequiredFilters = SnapshotFilters(RequiredWeaponFilters);
	const ExcludedFilters = SnapshotFilters(ExcludedWeaponFilters);
	const CurrentPlayer = Player(unPlayerIndex);
	const unActiveWeaponIndex = GetOptionalWeaponIndex(CurrentPlayer.GetActiveWeapon(), "Active weapon");
	const vecOwnedWeapons = CurrentPlayer.GetWeapons(strClassName, RequiredFilters, ExcludedFilters);
	if (!Array.isArray(vecOwnedWeapons)) {
		throw new TypeError("GetWeapons() must return an array.");
	}

	const vecObservedWeaponIndexes = Array.from(vecOwnedWeapons).map((WeaponReference) => {
		const unIndex = GetOptionalWeaponIndex(WeaponReference, "Owned weapon");
		if (unIndex === null) {
			throw new TypeError("An owned weapon cannot be null.");
		}

		return unIndex;
	});

	const vecIndexValues = CurrentPlayer.GetWeaponIndexes(strClassName, RequiredFilters, ExcludedFilters);
	if (!Array.isArray(vecIndexValues)) {
		throw new TypeError("GetWeaponIndexes() must return an array.");
	}

	const vecOwnedWeaponIndexes = Array.from(vecIndexValues);
	if ((vecObservedWeaponIndexes.length !== vecOwnedWeaponIndexes.length) || vecOwnedWeaponIndexes.some((unIndex, unPosition) => unIndex !== vecObservedWeaponIndexes[unPosition])) {
		throw new Error("Separate weapon inventory reads disagree.");
	}

	const unMatchingWeaponIndex = GetOptionalWeaponIndex(CurrentPlayer.GetWeapon(strClassName, RequiredFilters, ExcludedFilters), "Matching weapon");
	const unPrimaryWeaponIndex = GetOptionalWeaponIndex(CurrentPlayer.GetPrimaryWeapon(), "Primary weapon");
	const unSecondaryWeaponIndex = GetOptionalWeaponIndex(CurrentPlayer.GetSecondaryWeapon(), "Secondary weapon");

	return {
		ActiveWeaponIndex: unActiveWeaponIndex,
		MatchingWeaponIndex: unMatchingWeaponIndex,
		OwnedWeaponIndexes: vecOwnedWeaponIndexes,
		PrimaryWeaponIndex: unPrimaryWeaponIndex,
		SecondaryWeaponIndex: unSecondaryWeaponIndex,
		GetWeaponIndexes: vecOwnedWeaponIndexes,
	};
}

function SelectActiveWeapon(unPlayerIndex, strClassName) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value) || (typeof strClassName !== "string") || (strClassName.length === 0) || strClassName.includes("\0")) {
		throw new TypeError("unPlayerIndex and strClassName must identify a current player weapon.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const SelectedWeapon = CurrentPlayer.GetWeapon(strClassName);
	if (SelectedWeapon === null) {
		return false;
	}

	const unSelectedWeaponIndex = GetOptionalWeaponIndex(SelectedWeapon, "Selected weapon");
	const bWeaponSelected = CurrentPlayer.SetActiveWeapon(SelectedWeapon);
	if (typeof bWeaponSelected !== "boolean") {
		throw new Error(`SetActiveWeapon() returned an invalid result for player ${unPlayerIndex}.`);
	}

	if (bWeaponSelected) {
		const unConfirmedWeaponIndex = GetOptionalWeaponIndex(CurrentPlayer.GetActiveWeapon(), "Confirmed active weapon");
		if (unConfirmedWeaponIndex !== unSelectedWeaponIndex) {
			throw new Error(`Player ${unPlayerIndex} did not activate ${strClassName}.`);
		}
	}

	return bWeaponSelected;
}

module.exports = { InspectPlayerWeapons, SelectActiveWeapon };
```

Inventory reads are separate observations: getters/iterators must not mutate players, and inconsistent reads fail rather than being silently merged. The helper snapshots filter iterables once and copies returned indexes; it does not pin weapon lifetime. `SelectActiveWeapon()` performs a real handle write, checks its boolean result, and compares a later active index; that check is not a transaction or proof of future active state.

Projectile names are selected-profile keys supplied by the loaded game's weapon data, not entity indexes:

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function InspectProjectile(unPlayerIndex, strProjectileName) {
	const nMinimumAmmo = -2147483648;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof strProjectileName !== "string") || (strProjectileName.length === 0) || strProjectileName.includes("\0")) {
		throw new TypeError("strProjectileName must be a non-empty NUL-free string.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const nProjectileAmmo = CurrentPlayer.GetProjectileAmmo(strProjectileName);
	if (!Number.isInteger(nProjectileAmmo) || (nProjectileAmmo < nMinimumAmmo) || (nProjectileAmmo > g_nMaximumInt32Value)) {
		throw new TypeError("Projectile ammunition must be a signed 32-bit integer.");
	}

	const vecIndexValues = CurrentPlayer.GetProjectileIndexes(strProjectileName);
	if (!Array.isArray(vecIndexValues)) {
		throw new TypeError("GetProjectileIndexes() must return an array.");
	}

	const vecOwnedProjectileIndexes = Array.from(vecIndexValues);
	if (vecOwnedProjectileIndexes.some((unIndex) => !Number.isInteger(unIndex) || (unIndex <= 0) || (unIndex > g_nMaximumInt32Value))) {
		throw new TypeError("Every projectile index must be a positive signed 32-bit integer.");
	}

	return { OwnedProjectileIndexes: vecOwnedProjectileIndexes, ProjectileAmmo: nProjectileAmmo };
}

function SetProjectileAmmo(unPlayerIndex, strProjectileName, nAmmoValue) {
	const nMinimumAmmo = -2147483648;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex must be a positive signed 32-bit integer.");
	}

	if ((typeof strProjectileName !== "string") || (strProjectileName.length === 0) || strProjectileName.includes("\0") || !Number.isInteger(nAmmoValue) || (nAmmoValue < nMinimumAmmo) || (nAmmoValue > g_nMaximumInt32Value)) {
		throw new TypeError("A NUL-free projectile name and signed 32-bit nAmmoValue are required.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const bProjectileAmmoWritten = CurrentPlayer.SetProjectileAmmo(strProjectileName, nAmmoValue);
	if (typeof bProjectileAmmoWritten !== "boolean") {
		throw new TypeError("SetProjectileAmmo() must return a boolean.");
	}

	return bProjectileAmmoWritten;
}

module.exports = { InspectProjectile, SetProjectileAmmo };
```

Both helpers require a projectile key or weapon name present in the selected game's data. SourceJS throws when the profile cannot map it to an ammunition property. The native ammunition field is a signed SDK `int`; negative values are preserved, not coerced to unsigned counts. Writing a signed value is not evidence that it is sensible for the loaded game: choose game-valid amounts. Enumeration and ammunition are separate live reads; malformed/missing native results are rejected, and false writes remain false.

## Restrictions, Drops, and Items

| Method | Result | Purpose |
| --- | --- | --- |
| `RestrictWeapons(...vecWeaponsToRestrict)` | `true` | Add player-owned restrictions for every supplied weapon name or object. |
| `UnrestrictWeapons(...vecWeaponsToUnrestrict)` | `true` | Remove the corresponding player restrictions. |
| `IsWeaponRestricted(WeaponReference)` | `boolean` | Return the inverse of the restriction manager's `CanUse()` result. |
| `DropWeapon(WeaponReference, DropTarget = null, DropVelocity = null)` | `boolean` | Call the selected SDK implementation. |
| `GiveNamedItem(strItem, nSubtype = 0, bRemoveIfNotCarried?)` | entity or `null` | Call the SDK when installed. |

`GiveNamedItem()` is installed only when the selected SDK exposes `CBasePlayer::GiveNamedItem()`. Source 1 CSGO
additionally accepts `bRemoveIfNotCarried` as its third argument.

This opt-in helper snapshots names, checks prior effective restrictions, and independently attempts cleanup after every attempted addition:

```js
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function WithWeaponRestrictions(unPlayerIndex, vecWeaponReferences, Callback) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value) || !Array.isArray(vecWeaponReferences) || (typeof Callback !== "function")) {
		throw new TypeError("A positive signed 32-bit index, weapon-reference array, and synchronous callback are required.");
	}

	const vecNames = Array.from(vecWeaponReferences).map((WeaponReference) => {
		const strName = (typeof WeaponReference === "string") ? WeaponReference : WeaponReference?.Weapon;
		if ((typeof strName !== "string") || (strName.trim().length === 0) || strName.includes("\0")) {
			throw new TypeError("Each weapon must provide a non-empty NUL-free name.");
		}

		return strName;
	});
	if (vecNames.length === 0) {
		throw new TypeError("At least one weapon name is required.");
	}

	const vecSelectedNames = [...new Set(vecNames)];
	const CurrentPlayer = Player(unPlayerIndex);
	const nUserID = CurrentPlayer.UserID;
	if (!Number.isInteger(nUserID) || (nUserID <= 0) || (nUserID > g_nMaximumInt32Value)) {
		throw new Error("The player identity is unavailable.");
	}

	const vecNewNames = [];
	for (const strName of vecSelectedNames) {
		const bRestricted = CurrentPlayer.IsWeaponRestricted(strName);
		if (typeof bRestricted !== "boolean") {
			throw new TypeError("IsWeaponRestricted() must return a boolean.");
		}

		if (!bRestricted) {
			vecNewNames.push(strName);
		}
	}

	const vecAttemptedNames = [];
	let bHasFailure = false;
	let Failure = null;
	let Result = null;
	const RecordFailure = (Error) => {
		if (!bHasFailure) {
			bHasFailure = true;
			Failure = Error;
		}
	};

	try {
		for (const strName of vecNewNames) {
			vecAttemptedNames.push(strName);
			if (CurrentPlayer.RestrictWeapons(strName) !== true) {
				throw new Error("Unable to add the selected weapon restriction.");
			}
		}

		for (const strName of vecSelectedNames) {
			if (CurrentPlayer.IsWeaponRestricted(strName) !== true) {
				throw new Error("Weapon restriction verification failed.");
			}
		}

		Result = Callback(CurrentPlayer);
		if ((Result !== null) && ((typeof Result === "object") || (typeof Result === "function")) && (typeof Result.then === "function")) {
			throw new TypeError("WithWeaponRestrictions() requires a synchronous callback.");
		}
	} catch (Error) {
		RecordFailure(Error);
	}

	for (const strName of vecAttemptedNames) {
		try {
			if (CurrentPlayer.UserID !== nUserID) {
				throw new Error("The player identity changed before restriction cleanup.");
			}

			if (CurrentPlayer.UnrestrictWeapons(strName) !== true) {
				throw new Error("Unable to remove an attempted weapon restriction.");
			}
		} catch (Error) {
			RecordFailure(Error);
		}
	}

	if (bHasFailure) {
		throw Failure;
	}

	return Result;
}

module.exports = { WithWeaponRestrictions };
```

The restriction manager is shared state, not an exclusive lease. Supply selected-game canonical names; identical names are deduplicated, but native name normalization can merge different spellings. An already effective team/global/player restriction is not added or removed here. The callback must not change these restrictions, disconnect/reuse the player, or schedule work relying on them. Cleanup preserves the first thrown value (including `null`) and may fail. Adding a player restriction can remove a matching active weapon through `OnPlayerRestrictionAdded()`; unrestricting does not restore that entity or undo gameplay effects. A promise/thenable is rejected, not cancelled.

Drop the active weapon toward the point the player is looking at:

```js
const { Vector } = require("mathlib");
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function DropActiveWeapon(unPlayerIndex, flUpwardSpeed = 120) {
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value) || (typeof flUpwardSpeed !== "number") || !Number.isFinite(flUpwardSpeed) || !Number.isFinite(Math.fround(flUpwardSpeed))) {
		throw new TypeError("unPlayerIndex and a finite flUpwardSpeed are required.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const ActiveWeapon = CurrentPlayer.GetActiveWeapon();
	const DropTarget = CurrentPlayer.GetViewCoordinates();
	if ((ActiveWeapon === null) || (DropTarget === null)) {
		return false;
	}

	if ((typeof ActiveWeapon !== "object") || Array.isArray(ActiveWeapon) || (typeof DropTarget !== "object") || Array.isArray(DropTarget)) {
		throw new TypeError("The active weapon and drop target must be objects or null.");
	}

	const flX = DropTarget.X;
	const flY = DropTarget.Y;
	const flZ = DropTarget.Z;
	if ([flX, flY, flZ].some((flValue) => (typeof flValue !== "number") || !Number.isFinite(flValue) || !Number.isFinite(Math.fround(flValue)))) {
		throw new TypeError("The drop target must contain finite SDK-float components.");
	}

	const TargetSnapshot = new Vector(flX, flY, flZ);
	const DropVelocity = new Vector(0, 0, flUpwardSpeed);
	const bWeaponDropped = CurrentPlayer.DropWeapon(ActiveWeapon, TargetSnapshot, DropVelocity);
	if (typeof bWeaponDropped !== "boolean") {
		throw new Error(`DropWeapon() returned an invalid result for player ${unPlayerIndex}.`);
	}

	return bWeaponDropped;
}

module.exports = { DropActiveWeapon };
```

`DropActiveWeapon()` snapshots the target, returns false when no active weapon or hit exists, and preserves the native boolean result. It performs a real drop without rollback. Record getters must not mutate players/weapons; indexes and wrappers do not pin lifetime. Use all mutating examples in a controlled synchronous game-thread phase and inspect actual state before retrying.

Keep branch-specific item selection in the caller. This reusable operation accepts the exact server class name chosen by plugin configuration:

```js
const { Branch } = require("players/engines");
const { Player } = require("players/entity");

const g_nMaximumInt32Value = 2147483647;

function GiveLoadoutItem(unPlayerIndex, strItemClassName, nSubtype = 0, bRemoveIfNotCarried = undefined) {
	const nMinimumSubtype = -2147483648;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > g_nMaximumInt32Value) || (typeof strItemClassName !== "string") || (strItemClassName.length === 0) || strItemClassName.includes("\0") || !Number.isInteger(nSubtype) || (nSubtype < nMinimumSubtype) || (nSubtype > g_nMaximumInt32Value)) {
		throw new TypeError("unPlayerIndex, strItemClassName, and an integer nSubtype are required.");
	}

	if ((bRemoveIfNotCarried !== undefined) && ((Branch !== "csgo") || (typeof bRemoveIfNotCarried !== "boolean"))) {
		throw new TypeError("bRemoveIfNotCarried is a boolean available only in the csgo branch.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	const GiveNamedItem = CurrentPlayer.GiveNamedItem;
	if (typeof GiveNamedItem !== "function") {
		throw new Error("The selected SDK does not expose CBasePlayer::GiveNamedItem().");
	}

	let Item = null;

	if (bRemoveIfNotCarried === undefined) {
		Item = GiveNamedItem.call(CurrentPlayer, strItemClassName, nSubtype);
	} else {
		Item = GiveNamedItem.call(CurrentPlayer, strItemClassName, nSubtype, bRemoveIfNotCarried);
	}

	if (Item === null) {
		return null;
	}

	if ((typeof Item !== "object") || Array.isArray(Item)) {
		throw new TypeError("GiveNamedItem() must return an indexed entity object or null.");
	}

	const unItemIndex = Item.Index;
	if (!Number.isInteger(unItemIndex) || (unItemIndex <= 0) || (unItemIndex > g_nMaximumInt32Value)) {
		throw new TypeError("The returned item index is invalid.");
	}

	return Item;
}

module.exports = { GiveLoadoutItem };
```

The item helper captures the callable method once, preserves its receiver, and forwards the optional third argument only for the actual `csgo` branch. It does not emulate absent SDK capability or invent a replacement item. A returned item borrows native state; creation/removal effects are not rolled back, including when result validation fails.

## Entity Operations

The decorated player retains every operation from [`entities/entity`](entities-entity.md), including:

- `Slay()`, `CallInput()`, and `Remove()` where the selected SDK exposes their native owners;
- send-property and datamap reads/writes;
- key-value, collision, handle, output, parent, model, teleport, transmit, and physics helpers installed by `DecorateEntity()`.

Player-specific methods preserve an existing native method instead of replacing it with a JavaScript alias. For example, `Slay()`, `Kick()`, `Ban()`, `ExecuteClientCommand()`, and `GiveNamedItem()` execute their direct native bindings.

## Errors

- `Player(PlayerReference)` forwards a primitive signed 32-bit index or an indexed object without coercion. Missing, invalid, or unavailable targets throw: a null native lookup result is rejected during decoration, while native lookup/construction and property-getter exceptions propagate.
- Property and native method validation happens in C++ or in the owning JavaScript module. SourceJS propagates those exceptions directly; `players/entity` does not translate them into fallback values.
- Team, class, weapon, and projectile lookups backed by the selected game's data can throw when their owning manager cannot resolve a name. `GiveNamedItem()` forwards the item class directly to the SDK without profile prevalidation; an unresolved SDK result can return `null` instead of throwing.
- `GetPlayerClass()` requires `m_iClass`; `GetPlayerClassName()` also requires a matching class entry. The methods remain explicit instead of inventing a class for games without one.
- The network examples reject disconnected/fake clients; a connected real client can still have no channel. Availability checks do not pin native lifetime.
- Native mutators return booleans unless their table entry documents a different result. A `false` result is an operation failure or an explicitly documented ineligible case, not an exception substitute. Native `SetActiveWeapon()` and `SetProjectileAmmo()` return `true` after a completed write, but may return `undefined` when the storage range is invalid; handle writes also require SDK alignment. Native `GetProjectileAmmo()` can likewise return `undefined` without completing a read. None of these missing results is success.
- Active-weapon, weapon/projectile-enumeration, and projectile-ammunition callbacks attempt to report native C++ exceptions as operation-specific JavaScript errors; allocation failure or execution termination can prevent construction of the error object. Input `Index`/handle getter and string-conversion exceptions propagate unchanged.
- The native `GiveNamedItem()`, `ExecuteClientCommand()`, `SetName()`, `Slay()`, `Say()`, and `SayTeam()` callbacks also attempt to report C++ exceptions as operation-specific JavaScript `Error` objects, subject to the same allocation/termination limits and preserving an existing JavaScript exception. Native effects completed before the failure are not rolled back.
- Native handle access checks the complete SDK storage range and alignment; ammunition reads and writes check the complete `int` range. These checks do not prove arbitrary memory is mapped or live; see [`players` errors](players.md#errors) for failure-result details.
- Frozen-state methods and the native-owned `GiveNamedItem()` method are omitted when their compile-time SDK capabilities are absent. A missing required dependency module such as `players/dropweapon` makes `require("players/entity")` fail; SourceJS does not install a stub.

## Lifecycle

- Resolve a new wrapper after disconnects and map transitions; a one-based entity index can be reused.
- Read properties or call methods when the value is needed. Do not retain `Origin`, weapon, netchannel, trace, or permissions results as permanent state.
- Assign only properties marked writable. Read-only native-property writes are rejected instead of creating writable shadow values.
- Do not mutate the `Origin` value expecting an engine write; use the explicit movement/entity APIs.
- Put `Kick()`, `Ban()`, `Slay()`, forced `Spawn()`, and team changes behind authorization.
- Remove voice mutes and weapon restrictions during plugin unload.
- Treat `GiveNamedItem()` and `DropWeapon()` as selected-SDK capabilities and let missing native capabilities fail explicitly rather than substituting behavior.

The examples define functions without invoking them at plugin load. Administrative, movement, network, inventory and moderation effects occur only when the owning plugin deliberately calls the corresponding helper.

## Related Modules

- [`players`](players.md) provides the standalone player API and live roster queries.
- [`players/teams`](players-teams.md) exposes selected-SDK team and class profiles.
- [`players/voice`](players-voice.md) owns shared voice-mute state.
- [`players/dropweapon`](players-dropweapon.md) documents the conditional native weapon-drop path.
- [`entities/entity`](entities-entity.md) documents every inherited entity method.
- [`netchannel`](netchannel.md) documents flow constants and live channel wrappers.
- [`weapons`](weapons.md) and [`weapons/manager`](weapons-manager.md) document weapon wrappers and profile data.
