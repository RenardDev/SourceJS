# `require("players/constants")`

> AI processing note: this page lists the maximum cross-SDK constant surface. Read the relevant domain table and test property presence before using a capability-conditioned member.

The `players/constants` module exposes player-related values compiled from the selected HL2SDK branch. It is the exact native module object: SourceJS does not reconstruct Source constants in JavaScript and does not install values absent from the selected headers.

The CommonJS entry point lives in [`packages/sourcejs/players/constants.js`](../../packages/sourcejs/players/constants.js). Related button transitions are documented in [`listeners`](listeners.md), while typed player-property access is documented in [`entities/props`](entities-props.md).

## Contents

- [Import](#import)
- [Indexes and capacity](#indexes-and-capacity)
- [Input buttons](#input-buttons)
- [Player and HUD flags](#player-and-hud-flags)
- [Hit groups](#hit-groups)
- [Life and observer state](#life-and-observer-state)
- [Fix angles and animation](#fix-angles-and-animation)
- [Capability discovery](#capability-discovery)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const g_Constants = require("players/constants");

const g_RequiredExports = {
	INVALID_PLAYER_INDEX: "number",
	INVALID_PLAYER_USERID: "number",
	WORLD_INDEX: "number",
	FIRST_PLAYER_INDEX: "number",
	FixAngle: "object",
	PlayerStates: "object",
	HideHUDFlags: "object",
	HitGroup: "object",
	PlayerButtons: "object",
	LifeState: "object",
	GetMaximumClients: "function",
	GetClientCount: "function",
};
for (const [strExportName, strExportType] of Object.entries(g_RequiredExports)) {
	const Export = g_Constants[strExportName];
	if (!Object.hasOwn(g_Constants, strExportName) || (typeof Export !== strExportType) || ((strExportType === "object") && ((Export === null) || Array.isArray(Export)))) {
		throw new Error(`players/constants has an invalid ${strExportName} export.`);
	}
}

if ((g_Constants.INVALID_PLAYER_INDEX !== -1) || (g_Constants.INVALID_PLAYER_USERID !== -1) || (g_Constants.WORLD_INDEX !== 0) || (g_Constants.FIRST_PLAYER_INDEX !== 1)) {
	throw new Error("players/constants has invalid index sentinels.");
}

module.exports = { Constants: g_Constants };
```

The whole-module import is intentional on this page: optional exports must be discovered on the selected SDK at runtime. Standalone constants use their exact HL2SDK `UPPER_CASE` spellings. Grouped domain objects use PascalCase member names such as `PlayerButtons.Attack` and `HitGroup.Head`.

## Indexes and capacity

| Export | Meaning |
| --- | --- |
| `INVALID_PLAYER_INDEX` | Sentinel `-1` for an invalid entity/player index. |
| `INVALID_PLAYER_USERID` | Sentinel `-1` for an invalid engine user ID. |
| `WORLD_INDEX` | World entity index `0`. |
| `FIRST_PLAYER_INDEX` | First valid player entity index `1`. |
| `ABSOLUTE_PLAYER_LIMIT` | Compile-time player limit when declared by the selected SDK. |
| `MAX_EDICTS` | Compile-time edict limit when declared by the selected SDK. |
| `GetMaximumClients()` | Current live `CGlobalVars::maxClients`. |
| `GetClientCount()` | Count of non-free player edicts with connected `IPlayerInfo` records in the current live slot range; includes humans and bots. |

Use named imports from `players/constants`. Treat these values as SDK bounds, not counts of connected players or allocated edicts.

| Use | Example |
| --- | --- |
| Compare the live client limit to the optional SDK ceiling. | `const bWithinSDKPlayerLimit = (typeof ABSOLUTE_PLAYER_LIMIT === "number") && (GetMaximumClients() <= ABSOLUTE_PLAYER_LIMIT);` |
| Check a candidate edict index before looking up the entry. | `const bWithinSDKEdictRange = (typeof MAX_EDICTS === "number") && Number.isInteger(nEdictIndex) && (nEdictIndex >= 0) && (nEdictIndex < MAX_EDICTS);` |

Validate a player entity index against the live server limit, not only the compile-time maximum. This is a range check, not proof that the slot is occupied, connected, or still belongs to the same player. The two count calls are separate live reads, not an atomic roster snapshot; use them on the game thread while the server interfaces are available:

```js
const {
	FIRST_PLAYER_INDEX,
	INVALID_PLAYER_INDEX,
	GetClientCount,
	GetMaximumClients,
} = require("players/constants");

function NormalizePlayerIndex(nValue) {
	if (!Number.isSafeInteger(nValue)) {
		return INVALID_PLAYER_INDEX;
	}

	const unSlotCount = GetMaximumClients();
	if (!Number.isSafeInteger(unSlotCount) || (unSlotCount < 0)) {
		throw new Error("GetMaximumClients() returned an invalid slot count.");
	}

	return ((nValue >= FIRST_PLAYER_INDEX) && (nValue <= unSlotCount)) ? nValue : INVALID_PLAYER_INDEX;
}

const g_unSlotCount = GetMaximumClients();
const g_unConnectedClientCount = GetClientCount();
if (!Number.isSafeInteger(g_unSlotCount) || (g_unSlotCount < 0)) {
	throw new Error("GetMaximumClients() returned an invalid slot count.");
}

if (!Number.isSafeInteger(g_unConnectedClientCount) || (g_unConnectedClientCount < 0) || (g_unConnectedClientCount > g_unSlotCount)) {
	throw new Error("GetClientCount() returned an invalid connected-client count.");
}

if (NormalizePlayerIndex(0) !== INVALID_PLAYER_INDEX) {
	throw new Error("The world index must not normalize to a player index.");
}

if ((g_unSlotCount >= FIRST_PLAYER_INDEX) && (NormalizePlayerIndex(FIRST_PLAYER_INDEX) !== FIRST_PLAYER_INDEX)) {
	throw new Error("The first player slot must be accepted by the live range.");
}

module.exports = {
	ConnectedClientCount: g_unConnectedClientCount,
	NormalizePlayerIndex,
	SlotCount: g_unSlotCount,
};
```

## Input buttons

`PlayerButtons` groups the selected SDK input bits. The matching flat `IN_*` export is installed only when that macro exists in the selected headers.

The native binding defines each available bit as an own data property on both the flat constant record and the `PlayerButtons` record. Inherited JavaScript setters do not intercept these definitions. The records remain ordinary mutable records; this does not freeze their values or create constants missing from the SDK.

Use a captured integer `nButtons` from a run-command callback; import the named flat constant from `players/constants`.

| `PlayerButtons` member | Flat SDK constant | Example |
| --- | --- | --- |
| `Attack` | `IN_ATTACK` | `(typeof IN_ATTACK === "number") && ((nButtons & IN_ATTACK) !== 0)` |
| `Jump` | `IN_JUMP` | `(typeof IN_JUMP === "number") && ((nButtons & IN_JUMP) !== 0)` |
| `Duck` | `IN_DUCK` | `(typeof IN_DUCK === "number") && ((nButtons & IN_DUCK) !== 0)` |
| `Forward` | `IN_FORWARD` | `(typeof IN_FORWARD === "number") && ((nButtons & IN_FORWARD) !== 0)` |
| `Back` | `IN_BACK` | `(typeof IN_BACK === "number") && ((nButtons & IN_BACK) !== 0)` |
| `Use` | `IN_USE` | `(typeof IN_USE === "number") && ((nButtons & IN_USE) !== 0)` |
| `Cancel` | `IN_CANCEL` | `(typeof IN_CANCEL === "number") && ((nButtons & IN_CANCEL) !== 0)` |
| `Left` | `IN_LEFT` | `(typeof IN_LEFT === "number") && ((nButtons & IN_LEFT) !== 0)` |
| `Right` | `IN_RIGHT` | `(typeof IN_RIGHT === "number") && ((nButtons & IN_RIGHT) !== 0)` |
| `MoveLeft` | `IN_MOVELEFT` | `(typeof IN_MOVELEFT === "number") && ((nButtons & IN_MOVELEFT) !== 0)` |
| `MoveRight` | `IN_MOVERIGHT` | `(typeof IN_MOVERIGHT === "number") && ((nButtons & IN_MOVERIGHT) !== 0)` |
| `Attack2` | `IN_ATTACK2` | `(typeof IN_ATTACK2 === "number") && ((nButtons & IN_ATTACK2) !== 0)` |
| `Run` | `IN_RUN` | `(typeof IN_RUN === "number") && ((nButtons & IN_RUN) !== 0)` |
| `Reload` | `IN_RELOAD` | `(typeof IN_RELOAD === "number") && ((nButtons & IN_RELOAD) !== 0)` |
| `Alt1` | `IN_ALT1` | `(typeof IN_ALT1 === "number") && ((nButtons & IN_ALT1) !== 0)` |
| `Alt2` | `IN_ALT2` | `(typeof IN_ALT2 === "number") && ((nButtons & IN_ALT2) !== 0)` |
| `Score` | `IN_SCORE` | `(typeof IN_SCORE === "number") && ((nButtons & IN_SCORE) !== 0)` |
| `Speed` | `IN_SPEED` | `(typeof IN_SPEED === "number") && ((nButtons & IN_SPEED) !== 0)` |
| `Walk` | `IN_WALK` | `(typeof IN_WALK === "number") && ((nButtons & IN_WALK) !== 0)` |
| `Zoom` | `IN_ZOOM` | `(typeof IN_ZOOM === "number") && ((nButtons & IN_ZOOM) !== 0)` |
| `Weapon1` | `IN_WEAPON1` | `(typeof IN_WEAPON1 === "number") && ((nButtons & IN_WEAPON1) !== 0)` |
| `Weapon2` | `IN_WEAPON2` | `(typeof IN_WEAPON2 === "number") && ((nButtons & IN_WEAPON2) !== 0)` |
| `BullRush` | `IN_BULLRUSH` | `(typeof IN_BULLRUSH === "number") && ((nButtons & IN_BULLRUSH) !== 0)` |
| `Grenade1` | `IN_GRENADE1` | `(typeof IN_GRENADE1 === "number") && ((nButtons & IN_GRENADE1) !== 0)` |
| `Grenade2` | `IN_GRENADE2` | `(typeof IN_GRENADE2 === "number") && ((nButtons & IN_GRENADE2) !== 0)` |
| `LookSpin` | `IN_LOOKSPIN` when provided by the SDK. | `(typeof IN_LOOKSPIN === "number") && ((nButtons & IN_LOOKSPIN) !== 0)` |

Combine values with bitwise OR and evaluate transitions through `listeners`. The button-state listener is an explicit channel; an owning run-command subsystem must publish the event. Export cleanup through the runtime's case-sensitive `Unload` property:

```js
const {
	ButtonStatus,
	GetButtonCombinationStatus,
	RegisterButtonStateChangedListener,
} = require("listeners");
const { PlayerButtons } = require("players/constants");

if (!Object.hasOwn(PlayerButtons, "Jump") || !Object.hasOwn(PlayerButtons, "Attack")) {
	throw new Error("This plugin requires the Jump and Attack input constants.");
}

const g_unJumpAttackButtonCombination = PlayerButtons.Jump | PlayerButtons.Attack;

const g_ButtonSubscription = RegisterButtonStateChangedListener((Player, nPreviousButtons, nCurrentButtons) => {
	const nButtonStatus = GetButtonCombinationStatus(nPreviousButtons, nCurrentButtons, g_unJumpAttackButtonCombination);
	if ((nButtonStatus !== ButtonStatus.PRESSED) && (nButtonStatus !== ButtonStatus.RELEASED)) {
		return;
	}

	const strMessage = (nButtonStatus === ButtonStatus.PRESSED) ? "Jump + attack pressed" : "Jump + attack released";
	if (!Player.Say(strMessage)) {
		throw new Error("Unable to send the button-state message.");
	}
});

function Unload() {
	if (!g_ButtonSubscription.DisposeListener()) {
		throw new Error("Unable to remove the button-state listener.");
	}
}

module.exports = { Unload };
```

Check a capability-conditioned button before adding it to a portable mask:

```js
const g_Constants = require("players/constants");

if (!Object.hasOwn(g_Constants.PlayerButtons, "Attack") || !Object.hasOwn(g_Constants.PlayerButtons, "Use")) {
	throw new Error("This action requires the Attack and Use input constants.");
}

let g_unActionMask = g_Constants.PlayerButtons.Attack | g_Constants.PlayerButtons.Use;

if (Object.hasOwn(g_Constants.PlayerButtons, "Grenade1")) {
	g_unActionMask |= g_Constants.PlayerButtons.Grenade1;
}

if (!Number.isSafeInteger(g_unActionMask) || (g_unActionMask === 0)) {
	throw new Error("The selected SDK produced an invalid action mask.");
}

module.exports = { ActionMask: g_unActionMask };
```

## Player and HUD flags

`PlayerStates` contains available `FL_*` bitmasks:

| Member | SDK flag |
| --- | --- |
| `OnGround` | `FL_ONGROUND` |
| `Ducking` | `FL_DUCKING` |
| `WaterJump` | `FL_WATERJUMP` |
| `OnTrain` | `FL_ONTRAIN` |
| `InRain` | `FL_INRAIN` |
| `Frozen` | `FL_FROZEN` |
| `AtControls` | `FL_ATCONTROLS` |
| `Client` | `FL_CLIENT` |
| `FakeClient` | `FL_FAKECLIENT` |
| `InWater` | `FL_INWATER` |

`HideHUDFlags` contains available `HIDEHUD_*` bitmasks: `WeaponSelection`, `Flashlight`, `All`, `Health`, `PlayerDead`, `NeedSuit`, `MiscStatus`, `Chat`, `Crosshair`, `VehicleCrosshair`, `InVehicle`, `BonusProgress`, and `Radar`.

These helpers accept signed 32-bit bit fields and preserve unrelated bits within that representation. JavaScript bitwise operators coerce operands to signed 32-bit integers; do not pass arbitrary safe integers, `bigint` addresses, or 64-bit flags. The helpers expect unmodified selected-SDK masks; editing a constant record does not change the native SDK value:

```js
const { HideHUDFlags, PlayerStates } = require("players/constants");

const g_nMinimumBitFieldValue = -(2 ** 31);
const g_nMaximumBitFieldValue = (2 ** 31) - 1;

function HasPlayerState(nFlags, strStateName) {
	if (!Number.isInteger(nFlags) || (nFlags < g_nMinimumBitFieldValue) || (nFlags > g_nMaximumBitFieldValue)) {
		throw new TypeError("Player flags must be a signed 32-bit integer.");
	}

	if (!Object.hasOwn(PlayerStates, strStateName)) {
		throw new RangeError(`Player state is unavailable: ${strStateName}`);
	}

	return (nFlags & PlayerStates[strStateName]) !== 0;
}

function SetHUDFlag(nFlags, strFlagName, bEnabled) {
	if (!Number.isInteger(nFlags) || (nFlags < g_nMinimumBitFieldValue) || (nFlags > g_nMaximumBitFieldValue)) {
		throw new TypeError("HUD flags must be a signed 32-bit integer.");
	}

	if (!Object.hasOwn(HideHUDFlags, strFlagName)) {
		throw new RangeError(`HUD flag is unavailable: ${strFlagName}`);
	}

	if (typeof bEnabled !== "boolean") {
		throw new TypeError("HUD flag state must be a boolean.");
	}

	const nMask = HideHUDFlags[strFlagName];

	return bEnabled ? (nFlags | nMask) : (nFlags & ~nMask);
}

if (!Object.hasOwn(PlayerStates, "OnGround") || !Object.hasOwn(HideHUDFlags, "Crosshair")) {
	throw new Error("This example requires OnGround and Crosshair constants.");
}

if (!HasPlayerState(PlayerStates.OnGround, "OnGround")) {
	throw new Error("The OnGround state mask did not match itself.");
}

const g_nHiddenFlags = SetHUDFlag(0, "Crosshair", true);
const g_nRestoredFlags = SetHUDFlag(g_nHiddenFlags, "Crosshair", false);
if (((g_nHiddenFlags & HideHUDFlags.Crosshair) === 0) || (g_nRestoredFlags !== 0)) {
	throw new Error("The Crosshair HUD flag did not round-trip.");
}

module.exports = { HasPlayerState, SetHUDFlag };
```

When applying `SetHUDFlag()` to `m_iHideHUD`, read and write the exact selected-SDK send property through `entities/props`, and restore the previous integer during unload.

## Hit groups

`HitGroup` contains the available engine damage locations: `Generic`, `Head`, `Chest`, `Stomach`, `LeftArm`, `RightArm`, `LeftLeg`, `RightLeg`, and `Gear`.

Use these values to interpret the real `hitgroup` field from `player_hurt`. Export cleanup as `Unload` so the runtime invokes it:

```js
const { RegisterEventListener, UnregisterEventListener } = require("events");
const { HitGroup } = require("players/constants");

let g_nLastHeadHitUserID = null;

function OnPlayerHurt(PlayerHurtEvent) {
	const nHitGroup = PlayerHurtEvent.GetEventInteger("hitgroup");
	if (Object.hasOwn(HitGroup, "Head") && (nHitGroup === HitGroup.Head)) {
		g_nLastHeadHitUserID = PlayerHurtEvent.GetEventInteger("userid");
	}
}

if (!RegisterEventListener("player_hurt", OnPlayerHurt)) {
	throw new Error("Unable to subscribe to player_hurt.");
}

function Unload() {
	if (!UnregisterEventListener("player_hurt", OnPlayerHurt)) {
		throw new Error("Unable to unsubscribe from player_hurt.");
	}
}

module.exports = {
	GetLastHeadHitUserID() {
		return g_nLastHeadHitUserID;
	},
	Unload,
};
```

## Life and observer state

`LifeState` groups available `LIFE_*` values. Each value is defined as an own data property on the native group and under its exact flat macro name; both are omitted when that macro is unavailable. Inherited setters do not intercept either definition.

Compare a current SDK life-state value `nLifeState` against a named import from `players/constants`.

| `LifeState` member | Flat SDK constant | Example |
| --- | --- | --- |
| `Alive` | `LIFE_ALIVE` | `(typeof LIFE_ALIVE === "number") && (nLifeState === LIFE_ALIVE)` |
| `Dying` | `LIFE_DYING` | `(typeof LIFE_DYING === "number") && (nLifeState === LIFE_DYING)` |
| `Dead` | `LIFE_DEAD` | `(typeof LIFE_DEAD === "number") && (nLifeState === LIFE_DEAD)` |
| `Respawnable` | `LIFE_RESPAWNABLE` | `(typeof LIFE_RESPAWNABLE === "number") && (nLifeState === LIFE_RESPAWNABLE)` |
| `DiscardBody` | `LIFE_DISCARDBODY` | `(typeof LIFE_DISCARDBODY === "number") && (nLifeState === LIFE_DISCARDBODY)` |

`ObserverMode` is present only when the selected SDK supplies shared player definitions. Its maximum members are `None`, `DeathCam`, `FreezeCam`, `Fixed`, `InEye`, `Chase`, and `Roaming`.

Build decoders from the values that actually exist on the selected branch:

```js
const { LifeState, ObserverMode } = require("players/constants");

function NameForValue(Namespace, nValue) {
	if ((Namespace === null) || (typeof Namespace !== "object") || Array.isArray(Namespace)) {
		throw new TypeError("A constant namespace object is required.");
	}

	for (const [strName, nConstantValue] of Object.entries(Namespace)) {
		if (nConstantValue === nValue) {
			return strName;
		}
	}

	return null;
}

if (!Object.hasOwn(LifeState, "Alive") || (NameForValue(LifeState, LifeState.Alive) !== "Alive")) {
	throw new Error("The selected SDK does not expose a consistent Alive state.");
}

let g_strChaseModeName = null;

if (ObserverMode && Object.hasOwn(ObserverMode, "Chase")) {
	g_strChaseModeName = NameForValue(ObserverMode, ObserverMode.Chase);
	if (g_strChaseModeName !== "Chase") {
		throw new Error("The selected SDK exposes an inconsistent Chase observer mode.");
	}
}

module.exports = { ChaseModeName: g_strChaseModeName, NameForValue };
```

## Fix angles and animation

`FixAngle` contains available `FIXANGLE_*` values: `None`, `Absolute`, and `Relative`.

`PlayerAnimation` is present only with shared player definitions. Its maximum members are `Idle`, `Walk`, `Jump`, `SuperJump`, `Die`, `Attack1`, `InVehicle`, `Reload`, `StartAiming`, and `LeaveAiming`.

Use capability checks when building metadata for branch-specific bot or animation systems. This example only returns integer records; it does not submit a bot command or run an animation. Missing animation support leaves `Metadata` as `null`, and the exported builder throws rather than inventing missing values:

```js
const { FixAngle, PlayerAnimation } = require("players/constants");

const g_nMinimumSDKValue = -(2 ** 31);
const g_nMaximumSDKValue = (2 ** 31) - 1;

function BuildCommandMetadata(strAnimationName, strAngleModeName) {
	if (!Object.hasOwn(FixAngle, strAngleModeName)) {
		throw new RangeError(`Fix-angle mode is unavailable: ${strAngleModeName}`);
	}

	if (!PlayerAnimation || !Object.hasOwn(PlayerAnimation, strAnimationName)) {
		throw new RangeError(`Player animation is unavailable: ${strAnimationName}`);
	}

	const nAnimation = PlayerAnimation[strAnimationName];
	const nFixAngle = FixAngle[strAngleModeName];
	if (!Number.isInteger(nAnimation) || (nAnimation < g_nMinimumSDKValue) || (nAnimation > g_nMaximumSDKValue) || !Number.isInteger(nFixAngle) || (nFixAngle < g_nMinimumSDKValue) || (nFixAngle > g_nMaximumSDKValue)) {
		throw new TypeError("Animation metadata must contain signed 32-bit SDK values.");
	}

	return {
		Animation: nAnimation,
		FixAngle: nFixAngle,
	};
}

const g_strAngleModeName = Object.keys(FixAngle)[0];
if (!g_strAngleModeName) {
	throw new Error("The selected SDK does not expose a fix-angle mode.");
}

let g_Metadata = null;
if (PlayerAnimation) {
	const strAnimationName = Object.keys(PlayerAnimation)[0];
	if (!strAnimationName) {
		throw new Error("PlayerAnimation exists but contains no animation values.");
	}

	g_Metadata = BuildCommandMetadata(strAnimationName, g_strAngleModeName);
}

module.exports = { CommandMetadata: BuildCommandMetadata, Metadata: g_Metadata };
```

## Capability discovery

The module surface changes with the selected SDK headers. Discover constants by own-property presence rather than by substituting guessed values:

```js
const g_Constants = require("players/constants");

const g_Capabilities = {
	AbsolutePlayerLimit: Object.hasOwn(g_Constants, "ABSOLUTE_PLAYER_LIMIT"),
	GrenadeInput: Object.hasOwn(g_Constants.PlayerButtons, "Grenade1"),
	MaximumEdicts: Object.hasOwn(g_Constants, "MAX_EDICTS"),
	ObserverModes: Object.hasOwn(g_Constants, "ObserverMode"),
	PlayerAnimation: Object.hasOwn(g_Constants, "PlayerAnimation"),
};
if (!Object.values(g_Capabilities).every((bValue) => typeof bValue === "boolean")) {
	throw new Error("Capability discovery must produce booleans.");
}

module.exports = { Capabilities: g_Capabilities };
```

Capability checks are local to the current SDK build. They do not imply that the same export exists in an artifact built for another branch.

## Errors

- `require("players/constants")` throws when the native module is missing or is not a non-null, non-array object in the current plugin context.
- `GetMaximumClients()` throws when `CGlobalVars` or the `IVEngineServer` edict interface is unavailable. Call it after SourceJS has connected engine interfaces.
- `GetClientCount()` throws when `IPlayerInfoManager`, `CGlobalVars`, or the `IVEngineServer` edict interface is unavailable.
- Accessing an absent optional property normally evaluates to `undefined`; require the capability explicitly and throw a domain-specific error before using it.
- The examples throw `TypeError`, `RangeError`, or `Error` when runtime values do not satisfy the operation they demonstrate. These are example-level checks; the native module never substitutes missing values.

## Lifecycle

The module object and its namespace objects belong to the current isolated plugin context. Requiring the module again in that context returns the same native object, while another plugin receives its own context-bound module object.

`GetMaximumClients()` and `GetClientCount()` are game-thread live calls. They do not cache a value in JavaScript and are not an atomic snapshot together. Re-evaluate them whenever the current server state matters; a count or in-range index does not own a player slot or prevent slot reuse.

Do not mutate the module or namespace objects. Replacing a field would only corrupt later comparisons inside the current plugin context; it would not change the selected SDK or an engine constant.

Use player operations and listener/event callbacks on the game thread. Do not retain a borrowed callback player/event object across disconnection, deferred work, or context teardown; copy only the needed primitive values and resolve the current player again before use. Listeners and event callbacks created by examples must be removed during plugin unload. The button example calls `DisposeListener()` on its `ListenerManagerDecorator`, and the hit-group example unregisters the exact callback passed to `RegisterEventListener()`.

## Related modules

- [`players`](players.md) provides live player queries and operations that consume these values.
- [`players/entity`](players-entity.md) wraps a current player entity and exposes typed behavior.
- [`listeners`](listeners.md) reports input-button transitions and returns subscriptions with `DisposeListener()`.
- [`events`](events.md) delivers game events such as `player_hurt`.
- [`entities/props`](entities-props.md) reads and writes selected-SDK network and data-map properties that store these flags.
