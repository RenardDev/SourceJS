# `require("players/dictionary")`

> AI processing note: this page separates the native live roster from plugin-local `PlayerDictionary` caches. Read the lifecycle section before storing resources in a dictionary value.

The `players/dictionary` module has two deliberately different layers:

- direct native functions enumerate the currently connected roster through `IPlayerInfoManager`;
- `PlayerDictionary` is a plugin-local lazy `Map` cache that creates values on first access and automatically removes them when the corresponding networked entity is deleted.

The implementation lives in [`packages/sourcejs/players/dictionary.js`](../../packages/sourcejs/players/dictionary.js) and extends [`EntityDictionary`](entities-dictionary.md). Its default factory is the decorated [`Player`](players.md) factory.

## Contents

- [Import](#import)
- [Native roster API](#native-roster-api)
- [PlayerDictionary](#playerdictionary)
- [Shared dictionary](#shared-dictionary)
- [Custom cached values](#custom-cached-values)
- [Automatic removal](#automatic-removal)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	PLAYER_DICTIONARY,
	PlayerDictionary,
	GetAll,
	GetEntries,
	Get,
	Has,
	GetKeys,
	GetPlayer,
	GetValues,
} = require("players/dictionary");

const g_NativeFunctions = {
	GetAll,
	GetEntries,
	Get,
	Has,
	GetKeys,
	GetPlayer,
	GetValues,
};
for (const [strExportName, ExportedFunction] of Object.entries(g_NativeFunctions)) {
	if (typeof ExportedFunction !== "function") {
		throw new TypeError(`players/dictionary.${strExportName} must be a function.`);
	}
}

if ((typeof PlayerDictionary !== "function") || !(PLAYER_DICTIONARY instanceof PlayerDictionary)) {
	throw new TypeError("players/dictionary has an invalid PlayerDictionary export.");
}

module.exports = { PLAYER_DICTIONARY, PlayerDictionary, NativeFunctions: g_NativeFunctions };
```

The nine exports above are the stock public module surface. The module does not re-export `Player`. The `PLAYER_DICTIONARY` and `PlayerDictionary` additions are ordinary editable properties on the exact native runtime
object.

## Native roster API

These functions do not read `PLAYER_DICTIONARY` and do not retain JavaScript wrappers between calls.

| Export | Result | Purpose |
| --- | --- | --- |
| `GetAll()` | object | Return `{ Count, [unPlayerIndex]: Player }` for every currently connected player. |
| `Get(nEntityIndex)` | native player or `null` | Resolve one connected player by entity index. |
| `Has(nEntityIndex)` | `boolean` | Report whether the index currently belongs to a connected player. |
| `GetKeys()` | number array | Return current connected-player indexes. |
| `GetValues()` | native player array | Return current connected-player wrappers. |
| `GetEntries()` | `[unPlayerIndex, Player][]` | Return current connected-player entries. |
| `GetPlayer(nEntityIndex)` | native player or `null` | Use the common native player factory; unlike `Get()`, this may return a player-info slot that is not currently connected. |

`GetAll()`, `GetKeys()`, `GetValues()`, and `GetEntries()` omit free edicts and disconnected players. Their returned records and array entries are own data properties, not assignments through inherited setters. Wrapper or result-construction failures abort instead of returning a partially built roster. `Get()` and `Has()` also accept an index-bearing object; a throwing `Index` getter propagates its original exception without a later player lookup.

Read and validate roster shapes on the game thread while player interfaces are available and no reentrant code changes the roster. These are separate live calls, not an atomic snapshot; a mismatch is a failed consistency check, not proof that the server supplied one frozen roster:

```js
const {
	GetAll,
	GetEntries,
	Get,
	Has,
	GetKeys,
	GetPlayer,
	GetValues,
} = require("players/dictionary");

function ReadRosterViews() {
	const Roster = GetAll();
	const vecRosterEntries = GetEntries();
	const vecPlayerIndexes = GetKeys();
	const vecRosterValues = GetValues();

	if ((Roster === null) || (typeof Roster !== "object") || Array.isArray(Roster) || !Number.isSafeInteger(Roster.Count) || (Roster.Count < 0)) {
		throw new TypeError("GetAll() returned an invalid roster object.");
	}

	if (!Array.isArray(vecRosterEntries) || !Array.isArray(vecPlayerIndexes) || !Array.isArray(vecRosterValues)) {
		throw new TypeError("Native roster collections must be arrays.");
	}

	if ((vecRosterEntries.length !== Roster.Count) || (vecPlayerIndexes.length !== Roster.Count) || (vecRosterValues.length !== Roster.Count)) {
		throw new Error("Native roster views disagree within one synchronous operation.");
	}

	const setPlayerIndexes = new Set();
	for (const unIndex of vecPlayerIndexes) {
		if (!Number.isSafeInteger(unIndex) || (unIndex <= 0) || setPlayerIndexes.has(unIndex) || !Has(unIndex)) {
			throw new Error(`Invalid connected-player index: ${unIndex}.`);
		}

		setPlayerIndexes.add(unIndex);

		const ConnectedPlayer = Get(unIndex);
		const FactoryPlayer = GetPlayer(unIndex);
		if ((ConnectedPlayer === null) || (ConnectedPlayer.Index !== unIndex) || (FactoryPlayer === null) || (FactoryPlayer.Index !== unIndex)) {
			throw new Error(`Unable to resolve connected player ${unIndex}.`);
		}

		if (!Object.hasOwn(Roster, String(unIndex)) || (Roster[unIndex].Index !== unIndex)) {
			throw new Error(`GetAll() omitted connected player ${unIndex}.`);
		}
	}

	const setEntryIndexes = new Set();
	for (const vecEntry of vecRosterEntries) {
		if (!Array.isArray(vecEntry) || (vecEntry.length !== 2) || !setPlayerIndexes.has(vecEntry[0]) || setEntryIndexes.has(vecEntry[0]) || (vecEntry[1] === null) || (typeof vecEntry[1] !== "object") || Array.isArray(vecEntry[1]) || (vecEntry[1].Index !== vecEntry[0])) {
			throw new TypeError("GetEntries() returned an invalid player entry.");
		}

		setEntryIndexes.add(vecEntry[0]);
	}

	const setValueIndexes = new Set();
	for (const PlayerValue of vecRosterValues) {
		if ((PlayerValue === null) || (typeof PlayerValue !== "object") || Array.isArray(PlayerValue) || !setPlayerIndexes.has(PlayerValue.Index) || setValueIndexes.has(PlayerValue.Index)) {
			throw new TypeError("GetValues() returned an invalid player value.");
		}

		setValueIndexes.add(PlayerValue.Index);
	}

	if ((Get(0) !== null) || Has(0) || (GetPlayer(0) !== null)) {
		throw new Error("The world index must not resolve as a player.");
	}

	return { PlayerIndexes: vecPlayerIndexes, Roster, RosterEntries: vecRosterEntries, RosterValues: vecRosterValues };
}

ReadRosterViews();

module.exports = { ReadRosterViews };
```

Roster collection calls create new containers and wrappers; `Get()` and `GetPlayer()` create a wrapper when resolution succeeds, while `Has()` returns only a boolean. Do not compare wrapper JavaScript identity across native calls. Accessors such as `Name`, `Team`, `Health`, and `Origin` query the current engine state for the saved index: a retained wrapper can observe a replacement occupant after slot reuse. Save primitive identity before a later lookup, reacquire and validate the current player on the game thread, and do not carry borrowed wrappers across disconnection, map changes, deferred work, or context teardown.

## PlayerDictionary

Create an instance with `new PlayerDictionary(Factory, ...vecFactoryArguments)`. Omitting `Factory` selects the decorated `Player` factory; `null` creates a cache-only dictionary whose misses throw. Cache lookup validates a non-negative safe-integer entity index but does not itself establish a connected player or make arbitrary `set()` keys valid.

`PlayerDictionary` extends `EntityDictionary`, which extends `Map`. Construction immediately registers a networked-entity-deleted listener.

| Member | Result | Behavior |
| --- | --- | --- |
| `get(EntityReference)` | cached value | Return an existing value or call `Factory(unEntityIndex, ...vecFactoryArguments)` and cache the non-null result unless its `IsEntityMarkedForDeletion()` predicate returns `true`; such a result is returned but not retained. |
| `FromUserID(unUserID)` | cached value | Resolve the current entity index through `players/helpers.GetIndexFromUserID()` and call `get()`. |
| `FromIntegerHandle(unEntityHandle)` | cached value | Resolve an entity index through `entities/helpers.GetEntityIndexFromIntegerHandle()` and call `get()`. |
| `has(EntityReference)` | `boolean` | Test cache membership only; this is not native connected-player `Has()`. |
| `keys()` | Map iterator | Return a live iterator over cached indexes; use `[...Dictionary.keys()]` for an array copy. |
| `values()` | Map iterator | Return a live iterator over cached values; use `[...Dictionary.values()]` for an array copy. |
| `entries()` | Map iterator | Return a live iterator over cached `[unEntityIndex, Value]` pairs; use `[...Dictionary.entries()]` for an array copy. |
| `delete(EntityReference)` | `boolean` | Remove one cached value without calling `OnAutomaticallyRemoved()`. |
| `clear()` | `undefined` | Remove every cached value without calling `OnAutomaticallyRemoved()`. |
| `set(unEntityIndex, Value)` | this dictionary | Use inherited `Map.set()` directly. It bypasses entity-index validation, so callers must supply a valid numeric index. |
| `size` | number | Read the current cache size. |
| `forEach()` / iteration | Map behavior | Traverse cached entries. `[...Dictionary]` yields `[unEntityIndex, Value]` pairs. |
| `CreateMissingEntity(unEntityIndex)` | value | Invoke the lazy factory. This extension point wraps factory errors and rejects `null`/`undefined`. |
| `OnAutomaticallyRemoved(unEntityIndex)` | `undefined` | Override to clean one value immediately before automatic entity-deletion removal. The parent deletes the entry in `finally`, even if this hook throws; keep failed resource cleanup reachable outside that entry. |
| `OnNetworkedEntityDeleted(EntityReference)` | `boolean` | Listener entry point; remove a cached entity and report whether it existed. |
| `Unload()` | `boolean` | Unregister the deletion listener. The first call returns `true`; later calls return `false`. |

The default factory returns decorated live players and preserves one identity per retained cache entry. This does not protect against stale slots if an engine deletion event is missed:

```js
const { PlayerDictionary } = require("players/dictionary");
const { GetAllPlayers } = require("players");

const g_mapPlayers = new PlayerDictionary();
let g_CachedIdentity = null;
let g_bOperationFailed = false;
let g_OperationError;

try {
	const CurrentPlayer = GetAllPlayers()[0];
	if (CurrentPlayer) {
		const FirstPlayer = g_mapPlayers.get(CurrentPlayer.Index);
		const SecondPlayer = g_mapPlayers.get(CurrentPlayer.Index);
		const PlayerFromUserID = g_mapPlayers.FromUserID(CurrentPlayer.UserID);
		if ((FirstPlayer !== SecondPlayer) || (FirstPlayer !== PlayerFromUserID)) {
			throw new Error("PlayerDictionary did not preserve its cached identity.");
		}

		if (!g_mapPlayers.has(CurrentPlayer.Index) || (g_mapPlayers.size !== 1)) {
			throw new Error("PlayerDictionary cache membership is inconsistent.");
		}

		g_CachedIdentity = {
			Index: FirstPlayer.Index,
			UserID: FirstPlayer.UserID,
		};
	}
} catch (ErrorValue) {
	g_bOperationFailed = true;
	g_OperationError = ErrorValue;
} finally {
	const vecCleanupErrors = [];
	try {
		g_mapPlayers.clear();
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	try {
		if (!g_mapPlayers.Unload()) {
			throw new Error("Unable to unload the custom player dictionary.");
		}
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	if (vecCleanupErrors.length !== 0) {
		throw new AggregateError(g_bOperationFailed ? [g_OperationError, ...vecCleanupErrors] : vecCleanupErrors, "Player dictionary cleanup failed.");
	}

	if (g_bOperationFailed) {
		throw g_OperationError;
	}
}

module.exports = { CachedIdentity: g_CachedIdentity };
```

## Shared dictionary

`PLAYER_DICTIONARY` is the module-owned default instance. It is useful when several files in one plugin need the same decorated player identity.

```js
const { PLAYER_DICTIONARY } = require("players/dictionary");
const { GetAllPlayers } = require("players");

const g_CurrentPlayer = GetAllPlayers()[0];
let g_SharedCacheEntry = null;

if (g_CurrentPlayer) {
	const unIndex = g_CurrentPlayer.Index;
	const bExistedBefore = PLAYER_DICTIONARY.has(unIndex);
	const unSizeBefore = PLAYER_DICTIONARY.size;
	let CachedPlayer = null;
	let bInsertedHere = false;
	let bOperationFailed = false;
	let OperationError;

	try {
		CachedPlayer = PLAYER_DICTIONARY.get(unIndex);
		bInsertedHere = !bExistedBefore && Map.prototype.has.call(PLAYER_DICTIONARY, unIndex) && (Map.prototype.get.call(PLAYER_DICTIONARY, unIndex) === CachedPlayer);
		if (!PLAYER_DICTIONARY.has(unIndex) || (CachedPlayer.Index !== unIndex)) {
			throw new Error("The shared dictionary did not cache the selected player.");
		}

		g_SharedCacheEntry = {
			ExistedBefore: bExistedBefore,
			Index: unIndex,
			Size: PLAYER_DICTIONARY.size,
		};

		if (bExistedBefore && (PLAYER_DICTIONARY.size !== unSizeBefore)) {
			throw new Error("Reading a cached player changed the shared dictionary size.");
		}
	} catch (ErrorValue) {
		bOperationFailed = true;
		OperationError = ErrorValue;
	} finally {
		const vecCleanupErrors = [];
		if (bInsertedHere) {
			try {
				if ((Map.prototype.get.call(PLAYER_DICTIONARY, unIndex) !== CachedPlayer) || !PLAYER_DICTIONARY.delete(unIndex) || (PLAYER_DICTIONARY.size !== unSizeBefore)) {
					throw new Error("Unable to restore this example's shared dictionary entry.");
				}
			} catch (ErrorValue) {
				vecCleanupErrors.push(ErrorValue);
			}
		}

		if (vecCleanupErrors.length !== 0) {
			throw new AggregateError(bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors, "Shared player dictionary cleanup failed.");
		}

		if (bOperationFailed) {
			throw OperationError;
		}
	}
}

module.exports = { SharedCacheEntry: g_SharedCacheEntry };
```

Do not call `PLAYER_DICTIONARY.Unload()` from an ordinary feature module. The feature does not own the singleton's complete lifecycle. Run the example without reentrant cache mutation. It removes only the exact entry that it inserted itself, including when later checks fail; it never unloads the shared instance or deletes a replaced value belonging to another feature.

## Custom cached values

The factory may create plugin-owned state instead of player wrappers. Additional constructor arguments are forwarded on every cache miss:

```js
const { PlayerDictionary } = require("players/dictionary");

class PlayerSession {
	constructor(unIndex, strRole) {
		this.Index = unIndex;
		this.Role = strRole;
		this.RoundScore = 0;
	}
}

const g_mapSessions = new PlayerDictionary((unIndex, strRole) => new PlayerSession(unIndex, strRole), "guest");
let g_SessionResult = null;
let g_bOperationFailed = false;
let g_OperationError;

try {
	const FirstSession = g_mapSessions.get(1);
	const SecondSession = g_mapSessions.get(1);
	FirstSession.RoundScore += 5;

	if ((FirstSession !== SecondSession) || (FirstSession.Role !== "guest") || (FirstSession.RoundScore !== 5)) {
		throw new Error("The custom session cache is inconsistent.");
	}

	const vecSessionKeys = [...g_mapSessions.keys()];
	const vecSessionValues = [...g_mapSessions.values()];
	const vecSessionEntries = [...g_mapSessions.entries()];
	if ((vecSessionKeys[0] !== 1) || (vecSessionValues[0] !== FirstSession) || (vecSessionEntries[0][1] !== FirstSession)) {
		throw new Error("PlayerDictionary collection views omitted the cached session.");
	}

	if (!g_mapSessions.delete(1) || g_mapSessions.has(1)) {
		throw new Error("Unable to delete the cached session.");
	}

	const ReplacementSession = g_mapSessions.get(1);
	if ((ReplacementSession === FirstSession) || (ReplacementSession.RoundScore !== 0)) {
		throw new Error("A cache miss did not create a fresh session.");
	}

	g_SessionResult = {
		Index: ReplacementSession.Index,
		Role: ReplacementSession.Role,
	};
} catch (ErrorValue) {
	g_bOperationFailed = true;
	g_OperationError = ErrorValue;
} finally {
	const vecCleanupErrors = [];
	try {
		g_mapSessions.clear();
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	try {
		if (!g_mapSessions.Unload()) {
			throw new Error("Unable to unload the session dictionary.");
		}
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	if (vecCleanupErrors.length !== 0) {
		throw new AggregateError(g_bOperationFailed ? [g_OperationError, ...vecCleanupErrors] : vecCleanupErrors, "Session dictionary cleanup failed.");
	}

	if (g_bOperationFailed) {
		throw g_OperationError;
	}
}

module.exports = { SessionResult: g_SessionResult };
```

If the factory throws, `CreateMissingEntity()` throws a new `Error` and preserves the original exception as `cause`. Its normal diagnostic includes the entity index; if converting the failure details also throws, it uses a generic fallback message without that index. A `null` or `undefined` factory result also throws and is never cached.

## Automatic removal

Override `OnAutomaticallyRemoved(unEntityIndex)` when a cached value owns subscriptions or other resources. The hook runs immediately before the parent deletes the cached entry, even if cleanup throws. This controlled example keeps all subscriptions reachable in a dictionary-owned set, attempts every disposal, and retains failed handles there for a later retry; successful handles are removed. Do not use raw `delete()` or `clear()` as resource disposal, and do not create new watches reentrantly during cleanup. The runtime calls the exact `Unload` export, independently of the dictionary's `Unload()` method:

```js
const { RegisterButtonStateChangedListener } = require("listeners");
const { PlayerDictionary } = require("players/dictionary");

class SessionDictionary extends PlayerDictionary {
	constructor() {
		super((unIndex) => ({ Active: true, ButtonChanges: 0, Index: unIndex, Subscriptions: new Set() }));
		this.RemovedIndexes = [];
		this.Subscriptions = new Set();
	}

	WatchButtons(unIndex) {
		const Session = this.get(unIndex);
		const Subscription = RegisterButtonStateChangedListener((Player) => {
			if (Session.Active && (Player.Index === unIndex)) {
				Session.ButtonChanges += 1;
			}
		});

		Session.Subscriptions.add(Subscription);
		this.Subscriptions.add(Subscription);

		return Session;
	}

	ReleaseSubscriptions(setSubscriptions) {
		const vecCleanupErrors = [];
		for (const Subscription of [...setSubscriptions]) {
			try {
				if (!Subscription.DisposeListener()) {
					throw new Error("Unable to dispose a player-session subscription.");
				}

				setSubscriptions.delete(Subscription);
				this.Subscriptions.delete(Subscription);
			} catch (ErrorValue) {
				vecCleanupErrors.push(ErrorValue);
			}
		}

		if (vecCleanupErrors.length !== 0) {
			throw new AggregateError(vecCleanupErrors, "Player-session subscription cleanup failed.");
		}

		return true;
	}

	ReleaseSession(unIndex) {
		const Session = Map.prototype.get.call(this, unIndex);
		if (!Session) {
			return false;
		}

		Session.Active = false;

		return this.ReleaseSubscriptions(Session.Subscriptions);
	}

	OnAutomaticallyRemoved(unIndex) {
		if (!this.ReleaseSession(unIndex)) {
			throw new Error(`Missing session for automatically removed player ${unIndex}.`);
		}

		this.RemovedIndexes.push(unIndex);
	}

	Unload() {
		const bHadOwnership = this.NetworkedEntityDeletedListenerRegistered || (this.Subscriptions.size !== 0) || (this.size !== 0);
		const vecCleanupErrors = [];

		for (const Session of this.values()) {
			Session.Active = false;
		}

		try {
			this.ReleaseSubscriptions(this.Subscriptions);
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		try {
			this.clear();
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		if (this.NetworkedEntityDeletedListenerRegistered) {
			try {
				if (!super.Unload()) {
					throw new Error("Unable to unregister the session dictionary listener.");
				}
			} catch (ErrorValue) {
				vecCleanupErrors.push(ErrorValue);
			}
		}

		if (vecCleanupErrors.length !== 0) {
			throw new AggregateError(vecCleanupErrors, "Session dictionary unload failed.");
		}

		return bHadOwnership;
	}
}

const g_mapSessions = new SessionDictionary();
g_mapSessions.WatchButtons(1);

function Unload() {
	if (!g_mapSessions.Unload()) {
		throw new Error("Unable to unload the session dictionary.");
	}
}

module.exports = { Sessions: g_mapSessions, Unload };
```

The engine listener invokes `OnNetworkedEntityDeleted()` automatically. Plugin code should release resources directly before `delete(unEntityIndex)`, rather than fabricating an engine-deletion notification. Keep this example's mutable session records intact; do not replace them through inherited `Map.set()` or freeze them. The example deactivates session callbacks before disposal, attempts all pending subscriptions, cache clearing, and listener removal independently, and reports failures together. Failed handles remain in `Subscriptions` even when automatic removal or `clear()` drops the session record; retry `Unload()` before the plugin context is destroyed. This override returns `true` when a successful call released existing ownership and `false` when it was already empty and unregistered; it never retries an already released subscription.

## Errors

- Native `Get(nEntityIndex)`, `Has(nEntityIndex)`, and `GetPlayer(nEntityIndex)` throw when the argument is missing. `Get()` and `Has()` also require live player lookup interfaces.
- Native `GetAll()`, `GetKeys()`, `GetValues()`, and `GetEntries()` require `IPlayerInfoManager`, `CGlobalVars`, and `IVEngineServer` edict access.
- Native dictionary callbacks translate C++ exceptions into JavaScript errors while retaining an existing selector getter exception. Failed construction does not publish partial dictionaries, arrays or entry pairs. Existing nullable results remain unchanged; these guards neither keep player sessions alive nor guarantee allocator/OOM recovery.
- `get()`, `has()`, `delete()`, and helper-based lookups require non-negative safe-integer indexes. Invalid values throw `TypeError` before cache access. Inherited `Map.set()` bypasses that validation.
- `FromUserID()` and `FromIntegerHandle()` propagate errors from their native helper and from the lazy factory.
- A default `PlayerDictionary` throws when the requested index cannot produce a live decorated player. A custom factory may cache values for any valid non-negative index.
- Calling the inherited `PlayerDictionary.Unload()` again returns `false`; it does not silently register a new listener. Resource-owning overrides must document their retry and result policy, as this example does.

## Lifecycle

Native roster collection calls create new containers, not one atomic snapshot shared between calls. Wrapper accessors query the current player at their saved index; they are not copied player state or proof of stable player identity. Use them on the game thread, save only needed primitive identity, and resolve and validate the current player after disconnects, map transitions, or deferred work.

`PlayerDictionary` caches by numeric entity index until `delete()`, `clear()`, or an observed networked-entity deletion removes an entry. Slot reuse after a missed deletion can therefore expose stale plugin-owned state.

`OnAutomaticallyRemoved()` runs only for the entity-deletion listener path. Direct `delete()` and `clear()` use inherited `Map` behavior and do not call it.

The inherited `PlayerDictionary.Unload()` unregisters only the dictionary's deletion listener. It does not clear entries and does not call `OnAutomaticallyRemoved()`. A dictionary whose values own resources must release them before `delete()`/`clear()`, or override `Unload()` as shown above.

Keep `PLAYER_DICTIONARY` loaded for the lifetime of the module context. Custom dictionaries are owned by their creator. Unregister each deletion listener once, release every owned resource, and do not equate listener removal with completed resource cleanup. The example may be retried while failed cleanup remains reachable; no retry can recover a destroyed plugin context or expired native resource.

## Related modules

- [`entities/dictionary`](entities-dictionary.md) defines the inherited cache, handle lookup, automatic-removal, and listener lifecycle behavior.
- [`players`](players.md) provides the decorated `Player` factory and current roster helpers.
- [`players/entity`](players-entity.md) documents the live decorated player behavior returned by the default factory.
- [`players/helpers`](players-helpers.md) resolves user IDs used by `FromUserID()`.
- [`entities/helpers`](entities-helpers.md) resolves integer handles used by `FromIntegerHandle()`.
- [`listeners`](listeners.md) supplies the networked-entity lifecycle and button subscriptions with `DisposeListener()` used by the dictionary.
