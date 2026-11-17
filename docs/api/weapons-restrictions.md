# `require("weapons/restrictions")`

> AI agents: read Accepted Values, Hook Return Contract, Ownership And Lifetime, and Errors And Partial Effects before using a workflow.
> Review one API or workflow at a time; policy ownership and native entity ownership are different.

> Warning: restrictions are JavaScript policy only.
> They have no effect until a plugin invokes the relevant manager callback from a real game hook and blocks the
> game action when it returns `true`.

`weapons/restrictions` stores plugin-context-local global, player and team weapon policies. It provides a default
manager/handler pair for direct calls and classes for independent policy groups.

The module does not install an entity or purchase hook by itself. A plugin that blocks pickup or purchase must call
the manager's `OnPlayerBumpingWeapon()` or `OnPlayerPurchasingWeapon()` from the applicable selected-SDK hook and
interpret `true` as "block".

## Contents

- [Import](#import)
- [Exports](#exports)
- [Accepted Values](#accepted-values)
- [WeaponRestrictionHandler](#weaponrestrictionhandler)
- [WeaponRestrictionManager](#weaponrestrictionmanager)
- [Hook Return Contract](#hook-return-contract)
- [Run A Temporary Global Restriction](#run-a-temporary-global-restriction)
- [Evaluate Player And Team Policies](#evaluate-player-and-team-policies)
- [Own A Detached Handler](#own-a-detached-handler)
- [Customize Restriction Callbacks](#customize-restriction-callbacks)
- [Connect A Manager To Game Hooks](#connect-a-manager-to-game-hooks)
- [Ownership And Lifetime](#ownership-and-lifetime)
- [Errors And Partial Effects](#errors-and-partial-effects)
- [Related Modules](#related-modules)

## Import

```js
const {
	WEAPON_RESTRICTION_HANDLER,
	WEAPON_RESTRICTION_MANAGER,
	WeaponRestrictionHandler,
	WeaponRestrictionManager,
	CanUse,
	CanUseCurrent,
	RestrictGlobal,
	RestrictPlayer,
	RestrictTeam,
	UnrestrictGlobal,
	UnrestrictPlayer,
	UnrestrictTeam,
} = require("weapons/restrictions");
```

## Exports

| Export | Result |
| --- | --- |
| `WEAPON_RESTRICTION_MANAGER` | Default plugin-context `WeaponRestrictionManager`. |
| `WEAPON_RESTRICTION_HANDLER` | Default `WeaponRestrictionHandler`, registered in the default manager during import. |
| [`new WeaponRestrictionManager()`](#weaponrestrictionmanager) | Empty independent handler aggregator. |
| [`new WeaponRestrictionHandler(Options?)`](#weaponrestrictionhandler) | New restriction set, registered by default. |
| `RestrictGlobal(WeaponValue)` | Add one default global restriction; `true` only when newly added. |
| `UnrestrictGlobal(WeaponValue)` | Remove one default global restriction; `true` when removed. |
| `RestrictPlayer(PlayerValue, WeaponValue)` | Add one default player restriction; `true` only when newly added. |
| `UnrestrictPlayer(PlayerValue, WeaponValue)` | Remove one default player restriction; `true` when removed. |
| `RestrictTeam(TeamValue, WeaponValue)` | Add one default team restriction; `true` only when newly added. |
| `UnrestrictTeam(TeamValue, WeaponValue)` | Remove one default team restriction; `true` when removed. |
| `CanUse(Player, WeaponValue)` | Whether no registered default handler restricts the pair. |
| `CanUseCurrent(Player)` | `CanUse()` for the current native weapon, or `true` when there is no current weapon. |

The six mutation functions delegate to the default handler. The two query functions aggregate every handler currently
registered in the default manager. Import registers the default handler but performs no native weapon lookup and
installs no hook.

## Accepted Values

- A weapon is a non-empty string or a native-style object whose `Weapon` is a string. The name is trimmed, lowercased and stored without one leading
  `weapon_` prefix.
- A player identity is a positive safe-integer user ID or an object whose `UserID` is a positive safe integer.
- A player's team participates in `IsPlayerRestricted()` only when the player argument is an object whose `Team` is a
  non-negative safe integer.
- A standalone team selector is a non-negative safe integer or an object whose `TeamNumber` is a non-negative safe integer; it is distinct from a native player's `Team` field. String aliases are not accepted.
- Public object fields use only their PascalCase names; internal-style or lowercase aliases are not converted.
- Bulk mutation values are arrays of weapon values. Normalized duplicates are added once and appear once in the
  returned array.

Entity indexes and user IDs are different domains. A numeric player argument is interpreted as a user ID by
restriction storage, while the native `weapons.GetCurrentWeapon()` operation used by `CanUseCurrent()` and the default removal
callback expects an index or indexed player object.

## WeaponRestrictionHandler

### Construction And State

`new WeaponRestrictionHandler(Options?)` accepts `Manager` (default `WEAPON_RESTRICTION_MANAGER`) and `AutoRegister`
(default `true`). It creates:

`AutoRegister` is read and validated once before collection setup. `Manager` is read once when the handler chooses its
manager; accessors may throw, and no option is re-read for registration.

| Member | Result |
| --- | --- |
| `Manager` | Current `ValueManager`, initially the manager selected at construction or `null`. |
| `GlobalRestrictions` | Live `Set<string>`. |
| `PlayerRestrictions` | Live `Map<number, Set<string>>`. |
| `TeamRestrictions` | Live `Map<number, Set<string>>`. |
| `Unregister()` | Remove this handler from `Manager`; `true` when removed. |
| `Clear()` | Clear all three restriction collections and return `true`. |

`Manager: null` creates a detached handler. `AutoRegister: false` keeps a valid manager reference but skips constructor
registration. Calling any manager's `AddHandler(Handler)` does not change `Handler.Manager`; consequently,
`Handler.Unregister()` targets its current `ValueManager`, initially the construction-time manager reference. Rebinding
that writable backing field changes the target without moving the handler between any managers' sets.

`Manager` and the three collection properties are inherited accessors without setters. They read the own writable
`ValueManager`, `ValueGlobalRestrictions`, `ValuePlayerRestrictions`, and `ValueTeamRestrictions` fields. Treat those
backing fields as implementation state: replacement is not revalidated and can break later operations. Mutating the
live sets/maps directly also bypasses method validation and addition callbacks.

### Mutation And Queries

| Method | Result |
| --- | --- |
| `AddGlobalRestrictions(vecWeaponValues)` | Array of normalized names newly added. |
| `RemoveGlobalRestrictions(vecWeaponValues)` | Whether at least one name was removed. |
| `AddPlayerRestrictions(PlayerValue, vecWeaponValues)` | Newly added names; calls `OnPlayerRestrictionAdded()` for each. |
| `RemovePlayerRestrictions(PlayerValue, vecWeaponValues)` | Whether at least one name was removed. |
| `AddTeamRestrictions(TeamValue, vecWeaponValues)` | Newly added names; calls `OnTeamRestrictionAdded()` for each. |
| `RemoveTeamRestrictions(TeamValue, vecWeaponValues)` | Whether at least one name was removed. |
| `IsGloballyRestricted(WeaponValue)` | Exact global membership. |
| `IsPlayerRestricted(Player, WeaponValue)` | Global, player-ID or available player-team membership. |
| `IsTeamRestricted(TeamValue, WeaponValue)` | Global or team membership. |

Every add or remove call validates the array and every weapon value before mutating state or invoking callbacks. Player
and team removal delete their map bucket after its last restriction is removed; an absent bucket returns `false` only
after validation succeeds.

Empty arrays are valid. An empty player/team add can create an empty scope bucket while returning `[]` and invoking no
addition callback; removing from that empty bucket deletes it while returning `false`.

### Policy Callbacks

| Method | Default result/effect |
| --- | --- |
| `OnPlayerBumpingWeapon(Player, WeaponValue)` | `false` when restricted, otherwise `true`. |
| `OnPlayerPurchasingWeapon(Player, WeaponValue)` | `false` when restricted, otherwise `true`. |
| `OnPlayerRestrictionAdded(PlayerValue, WeaponValue)` | Attempts native removal of an indexed player object's matching current weapon. |
| `OnTeamRestrictionAdded(unTeamNumber, strWeaponName)` | No default effect. |

Subclasses may override these callbacks. Call `super.OnPlayerRestrictionAdded()` only when the default immediate
removal is desired.

Player-add callbacks receive the original player value; team-add callbacks receive the resolved numeric team number.
Both receive normalized weapon names. All newly added names are stored before the first addition callback runs;
callback failures do not roll that state back. The default player callback skips non-object values and objects without
a positive safe-integer `Index`. Its `Remove()` return value is not used as a policy result or a guarantee of removal.
Any default current-weapon lookup or removal must run on the game thread.

## WeaponRestrictionManager

| Member | Result |
| --- | --- |
| `Handlers` | Live `Set<WeaponRestrictionHandler>`. |
| `Size` | Current handler count. |
| `AddHandler(Handler)` | Register a handler and return it. |
| `RemoveHandler(Handler)` | Remove a handler and report whether it existed. |
| `Clear()` | Clear restrictions in every handler without unregistering them. |
| `IsPlayerRestricted(Player, WeaponValue)` | Whether any handler restricts the player. |
| `IsTeamRestricted(TeamValue, WeaponValue)` | Whether any handler restricts the team. |
| `OnPlayerBumpingWeapon(Player, WeaponValue)` | `true` when any handler returns exactly `false`; otherwise `null`. |
| `OnPlayerPurchasingWeapon(Player, WeaponValue)` | `true` when any handler returns exactly `false`; otherwise `null`. |
| `[Symbol.iterator]()` | Iterate registered handlers in insertion order. |

`AddHandler()` accepts only `WeaponRestrictionHandler` instances, adds with normal `Set` idempotence and returns the
handler even when it was already present. `Clear()` calls `Clear()` on each currently registered handler but does not
remove handlers or alter their `Manager` fields.

`Handlers` and `Size` read the own writable `ValueHandlers` backing field. Replacing it is not validated; direct mutation
of the live handler set bypasses `AddHandler()`'s instance check. Aggregation validates inputs only through visited
handlers, so an empty manager can report no restriction without validating the pair. Iteration uses the live set, not
a snapshot: callback-driven additions or removals can affect which handlers are visited during that same call.

## Hook Return Contract

Handler callbacks answer whether the underlying action is allowed: the defaults return `false` for a restricted pair
and `true` otherwise. Manager callbacks invert that into a hook decision:

- The first registered handler that returns exactly `false` makes the manager return `true`, meaning the game action
  should be blocked.
- If no handler returns exactly `false`, the manager returns `null`, meaning no restriction decision.
- Values other than the boolean `false` do not block.
- Callbacks are synchronous decisions. A returned promise is not awaited and cannot delay the current hook decision.
- Exceptions propagate and stop iteration; later handlers are not called.

## Run A Temporary Global Restriction

Remove a temporary restriction only when this call added it. A pre-existing restriction belongs to another policy
decision and must remain in place.

```js
const { WEAPON_RESTRICTION_HANDLER, RestrictGlobal, UnrestrictGlobal } = require("weapons/restrictions");

function WithGlobalRestriction(strWeaponName, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("WithGlobalRestriction(strWeaponName, Callback) expects a function callback.");
	}

	const bRestrictionAdded = RestrictGlobal(strWeaponName);

	try {
		return Callback({ RestrictionAdded: bRestrictionAdded, CurrentlyRestricted: WEAPON_RESTRICTION_HANDLER.IsGloballyRestricted(strWeaponName) });
	} finally {
		if (bRestrictionAdded) {
			UnrestrictGlobal(strWeaponName);
		}
	}
}

module.exports = { WithGlobalRestriction };
```

The callback is synchronous. Returning a promise restores the restriction before that promise settles; implement an
explicitly asynchronous owner when a restriction must survive across `await`.

Keep the normalized key stable and do not remove/re-add that same key from the callback: the boolean addition result
does not identify a particular policy generation. Cleanup is an attempt, not a transaction; if it throws, its error
replaces an earlier callback error or return value.

## Evaluate Player And Team Policies

Use a numeric user ID when policy storage must avoid the default live-player removal callback. Query team policy
through the manager because a numeric player identity carries no team field.

```js
const {
	WEAPON_RESTRICTION_MANAGER,
	CanUse,
	CanUseCurrent,
	RestrictPlayer,
	RestrictTeam,
	UnrestrictPlayer,
	UnrestrictTeam,
} = require("weapons/restrictions");

function CanUseCurrentWeapon(PlayerReference) {
	return CanUseCurrent(PlayerReference);
}

function EvaluateTemporaryPolicies(unPlayerUserID, unTeamNumber, strPlayerWeapon, strTeamWeapon, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("EvaluateTemporaryPolicies(unPlayerUserID, unTeamNumber, strPlayerWeapon, strTeamWeapon, Callback) expects a function callback.");
	}

	let bPlayerRestrictionAdded = false;
	let bTeamRestrictionAdded = false;

	try {
		bPlayerRestrictionAdded = RestrictPlayer(unPlayerUserID, strPlayerWeapon);
		bTeamRestrictionAdded = RestrictTeam(unTeamNumber, strTeamWeapon);

		return Callback({ PlayerCanUseWeapon: CanUse(unPlayerUserID, strPlayerWeapon), TeamCanUseWeapon: !WEAPON_RESTRICTION_MANAGER.IsTeamRestricted(unTeamNumber, strTeamWeapon) });
	} finally {
		try {
			if (bTeamRestrictionAdded) {
				UnrestrictTeam(unTeamNumber, strTeamWeapon);
			}
		} finally {
			if (bPlayerRestrictionAdded) {
				UnrestrictPlayer(unPlayerUserID, strPlayerWeapon);
			}
		}
	}
}

module.exports = { CanUseCurrentWeapon, EvaluateTemporaryPolicies };
```

`CanUseCurrent(PlayerReference)` remains the direct query for a live player. It performs a native current-weapon lookup every
time and returns `true` when no current weapon exists.

The temporary workflow attempts team cleanup before player cleanup, even if team cleanup throws. Later cleanup errors
replace earlier errors or results; it cannot guarantee restoration when a cleanup operation fails. The callback is
synchronous and promises do not postpone cleanup. Keep each normalized policy key stable during the callback; these
addition booleans are not ownership tokens and do not protect against callback-driven removal and re-addition.

## Own A Detached Handler

A detached handler is useful for local policy evaluation that must never join the default aggregate.

```js
const { WeaponRestrictionHandler } = require("weapons/restrictions");

function EvaluateDetachedPolicy(unPlayerUserID, unTeamNumber, strPlayerWeapon, strTeamWeapon) {
	const RestrictionHandler = new WeaponRestrictionHandler({ Manager: null });
	const vecAddedGlobalWeaponNames = RestrictionHandler.AddGlobalRestrictions([" Weapon_Rifle ", "rifle"]);
	const vecAddedPlayerWeaponNames = RestrictionHandler.AddPlayerRestrictions(unPlayerUserID, [strPlayerWeapon]);
	const vecAddedTeamWeaponNames = RestrictionHandler.AddTeamRestrictions(unTeamNumber, [strTeamWeapon]);
	const PolicyReport = {
		AddedGlobalWeaponNames: vecAddedGlobalWeaponNames,
		AddedPlayerWeaponNames: vecAddedPlayerWeaponNames,
		AddedTeamWeaponNames: vecAddedTeamWeaponNames,
		GloballyRestricted: RestrictionHandler.IsGloballyRestricted("weapon_rifle"),
		PlayerBumpAllowed: RestrictionHandler.OnPlayerBumpingWeapon(unPlayerUserID, strPlayerWeapon),
		PlayerRestricted: RestrictionHandler.IsPlayerRestricted(unPlayerUserID, strPlayerWeapon),
		PlayerPurchaseAllowed: RestrictionHandler.OnPlayerPurchasingWeapon(unPlayerUserID, strPlayerWeapon),
		RestrictionManager: RestrictionHandler.Manager,
		TeamRestricted: RestrictionHandler.IsTeamRestricted({ TeamNumber: unTeamNumber }, strTeamWeapon),
	};
	PolicyReport.GlobalRestrictionRemoved = RestrictionHandler.RemoveGlobalRestrictions(["rifle"]);
	PolicyReport.PlayerRestrictionRemoved = RestrictionHandler.RemovePlayerRestrictions(unPlayerUserID, [strPlayerWeapon]);
	PolicyReport.TeamRestrictionRemoved = RestrictionHandler.RemoveTeamRestrictions(unTeamNumber, [strTeamWeapon]);
	PolicyReport.RestrictionsCleared = RestrictionHandler.Clear();
	PolicyReport.HandlerUnregistered = RestrictionHandler.Unregister();

	return PolicyReport;
}

module.exports = { EvaluateDetachedPolicy };
```

The local handler never enters `WEAPON_RESTRICTION_MANAGER`. Its `Unregister()` result is therefore `false`.

## Customize Restriction Callbacks

Callbacks receive normalized weapon names. This subclass records both addition families without invoking the default
current-weapon removal, then exercises manager aggregation and lifecycle explicitly.

```js
const { WeaponRestrictionHandler, WeaponRestrictionManager } = require("weapons/restrictions");

class AuditedWeaponRestrictions extends WeaponRestrictionHandler {
	constructor(Options) {
		super(Options);
		this.RestrictionEvents = [];
	}

	OnPlayerRestrictionAdded(PlayerValue, strWeaponName) {
		const unPlayerUserID = (typeof PlayerValue === "object") ? PlayerValue.UserID : PlayerValue;
		this.RestrictionEvents.push({ Kind: "player", PlayerUserID: unPlayerUserID, WeaponName: strWeaponName });
	}

	OnTeamRestrictionAdded(unTeamNumber, strWeaponName) {
		this.RestrictionEvents.push({ Kind: "team", TeamNumber: unTeamNumber, WeaponName: strWeaponName });
	}
}

function RunAuditedPolicy(PlayerReference, strPlayerWeapon, strTeamWeapon) {
	const RestrictionManager = new WeaponRestrictionManager();
	const RestrictionHandler = new AuditedWeaponRestrictions({ AutoRegister: false, Manager: RestrictionManager });

	RestrictionManager.AddHandler(RestrictionHandler);
	RestrictionHandler.AddPlayerRestrictions(PlayerReference, [strPlayerWeapon]);
	RestrictionHandler.AddTeamRestrictions(PlayerReference.Team, [strTeamWeapon]);

	let unIteratedHandlerCount = 0;
	let bIteratorReturnedHandler = false;

	for (const RegisteredHandler of RestrictionManager) {
		unIteratedHandlerCount += 1;

		if (RegisteredHandler === RestrictionHandler) {
			bIteratorReturnedHandler = true;
		}
	}

	const PolicyReport = {
		HandlerCount: RestrictionManager.Size,
		HandlerRegistered: RestrictionManager.Handlers.has(RestrictionHandler),
		IteratedHandlerCount: unIteratedHandlerCount,
		IteratorReturnedHandler: bIteratorReturnedHandler,
		PlayerBumpBlocked: RestrictionManager.OnPlayerBumpingWeapon(PlayerReference, strPlayerWeapon),
		PlayerRestricted: RestrictionManager.IsPlayerRestricted(PlayerReference, strPlayerWeapon),
		PlayerPurchaseBlocked: RestrictionManager.OnPlayerPurchasingWeapon(PlayerReference, strPlayerWeapon),
		RestrictionEvents: RestrictionHandler.RestrictionEvents,
		TeamRestricted: RestrictionManager.IsTeamRestricted(PlayerReference.Team, strTeamWeapon),
	};

	RestrictionManager.Clear();
	PolicyReport.BlockDecisionAfterClear = RestrictionManager.OnPlayerBumpingWeapon(PlayerReference, strPlayerWeapon);
	PolicyReport.HandlerCountAfterClear = RestrictionManager.Size;
	PolicyReport.HandlerRemoved = RestrictionManager.RemoveHandler(RestrictionHandler);
	PolicyReport.HandlerReadded = RestrictionManager.AddHandler(RestrictionHandler) === RestrictionHandler;
	PolicyReport.HandlerUnregistered = RestrictionHandler.Unregister();
	PolicyReport.FinalHandlerCount = RestrictionManager.Size;

	return PolicyReport;
}

module.exports = { AuditedWeaponRestrictions, RunAuditedPolicy };
```

## Connect A Manager To Game Hooks

Keep the policy adapter independent from the selected-SDK hook signature. A real memory hook can call these functions
and translate the boolean into that hook's required return or register mutation.

```js
const { WEAPON_RESTRICTION_MANAGER } = require("weapons/restrictions");

function ShouldBlockWeaponBump(PlayerReference, strWeaponName) {
	return WEAPON_RESTRICTION_MANAGER.OnPlayerBumpingWeapon(PlayerReference, strWeaponName) === true;
}

function ShouldBlockWeaponPurchase(PlayerReference, strWeaponName) {
	return WEAPON_RESTRICTION_MANAGER.OnPlayerPurchasingWeapon(PlayerReference, strWeaponName) === true;
}

module.exports = { ShouldBlockWeaponBump, ShouldBlockWeaponPurchase };
```

Do not assume that every SDK exposes the same purchase or bump function, arguments or ABI. Resolve and install the
real target through [`memory/hooks`](memory-hooks.md) using selected-SDK gamedata, then pass validated player and weapon
values to this policy layer.

## Ownership And Lifetime

- Restriction state is local to the plugin's isolated JavaScript context and is not serialized or shared across plugins.
- The default manager and handler are module singletons in that context. They live until the plugin context is
  destroyed unless the plugin clears them earlier.
- Manager `Handlers`, handler sets and handler maps are exact mutable containers. Direct mutations bypass normalization
  and addition callbacks.
- Policies retain normalized strings, user IDs and team numbers, not weapon or player entity objects.
- A plugin is responsible for removing user-ID policy when its ownership period ends, such as disconnect or
  administrative rule removal.
- `Unregister()` removes registration but leaves all restriction collections intact. `Clear()` removes policy but
  leaves registration intact.

## Errors And Partial Effects

- Invalid constructor options and values rejected by the method validators throw `TypeError`. Manager aggregation
  validates only through visited handlers; direct container/backing-field mutations bypass those validators.
- `AddPlayerRestrictions()` and `AddTeamRestrictions()` validate identity and every weapon value before creating a map
  bucket; failed validation leaves no bucket or restriction behind.
- Add operations normalize every input before mutating the set. A weapon-validation error adds none of that call's
  names.
- Addition callbacks run after all new names have been inserted. If one callback throws, later callbacks in that call
  are skipped. Insertions and callback-made state changes are not automatically rolled back.
- The default `OnPlayerRestrictionAdded()` ignores the boolean returned by `weapons.Remove()`. Native current/remove
  failures propagate, while the restriction remains stored.
- Player and team removal validate every weapon value even when no bucket exists. Successful removal deletes the map
  bucket when its final restriction is gone.
- Manager callback and `Clear()` errors propagate immediately and stop iteration over later handlers.
- `CanUseCurrent()` propagates native player/current-weapon errors and restriction-query errors.
- The temporary workflow helpers attempt to remove only names they added through `finally`, including when a
  synchronous callback throws. Cleanup failures can prevent restoration and replace an earlier error; the player/team
  workflow still attempts player cleanup after a team cleanup failure. Returning a promise does not defer cleanup, and
  callback-driven removal/re-addition of the same key is not protected by an ownership token.

The module has no automatic hook, persistence layer, cross-plugin bus or SDK fallback.

## Related Modules

- [`memory/hooks`](memory-hooks.md) installs the selected-SDK native hooks that can call this policy layer.
- [`weapons`](weapons.md) provides `GetCurrentWeapon()` and `Remove()` used by current-policy checks and the default addition
  callback.
- [`weapons/entity`](weapons-entity.md) documents live weapon objects accepted by weapon normalization.
- [`players/entity`](players-entity.md) documents indexed player objects and their `UserID` and `Team` fields.
