# `require("players/language")`

> AI processing note: distinguish the native client query from the CS:GO cache hit before using an example. The contents separate routing, listener ownership, and string parsing.

The `players/language` module combines native client ConVar queries through `IVEngineServer` with a listener-backed CS:GO language cache. Native queries require a current connected human player; a language-cache hit only reads the stored string.

The public entry lives in [`packages/sourcejs/players/language/index.js`](../../packages/sourcejs/players/language/index.js).
It combines the native client-setting API with the branch-aware language implementation. The same direct operations are
available through [`players/helpers`](players-helpers.md).

## Contents

- [Import](#import)
- [Internal Language Cache](#internal-language-cache)
- [Client Settings](#client-settings)
- [Language Routing](#language-routing)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

| Export | Result | Purpose |
| --- | --- | --- |
| `GetClientCVarValue(Player, strCVarName)` | `string` | Read a client ConVar for a connected human player. |
| `GetClientLanguage(PlayerReference)` | `string` | Read the same player's current `cl_language` value. |

```js
const { GetClientLanguage } = require("players/language");
const { Player } = require("players/entity");

function InspectClientLanguage(unClientIndex) {
	const nMaximumInt32Value = 2147483647;

	if (!Number.isInteger(unClientIndex) || (unClientIndex <= 0) || (unClientIndex > nMaximumInt32Value)) {
		throw new TypeError("unClientIndex must be a positive Int32 number.");
	}

	const CurrentPlayer = Player(unClientIndex);
	const nCurrentIndex = CurrentPlayer.Index;
	if (nCurrentIndex !== unClientIndex) {
		throw new Error("Player() returned a different client index.");
	}

	const IsConnected = CurrentPlayer.IsConnected;
	const IsFakeClient = CurrentPlayer.IsFakeClient;
	if ((typeof IsConnected !== "function") || (typeof IsFakeClient !== "function")) {
		throw new TypeError("Player() must expose human-client status methods.");
	}

	const bConnected = IsConnected.call(CurrentPlayer);
	if (typeof bConnected !== "boolean") {
		throw new TypeError("IsConnected() must return a boolean.");
	}

	if (!bConnected) {
		return null;
	}

	const bFakeClient = IsFakeClient.call(CurrentPlayer);
	if (typeof bFakeClient !== "boolean") {
		throw new TypeError("IsFakeClient() must return a boolean.");
	}

	if (bFakeClient) {
		return null;
	}

	const strName = CurrentPlayer.Name;
	if (typeof strName !== "string") {
		throw new TypeError("Player.Name must be a string.");
	}

	const strClientLanguage = GetClientLanguage(unClientIndex);
	if (typeof strClientLanguage !== "string") {
		throw new TypeError(`GetClientLanguage() must return a string for player ${unClientIndex}.`);
	}

	return { Index: nCurrentIndex, Language: strClientLanguage, Name: strName };
}

module.exports = { InspectClientLanguage };
```

`GetClientCVarValue()` always performs a native query. `GetClientLanguage()` uses the listener-backed cache on CS:GO and the
direct native implementation on other SDK branches.

## Internal Language Cache

`require("players/language")` performs the branch selection. `require("players/language/cache")` exposes the cache
implementation for integrations that explicitly own its lifecycle.

| Export | Result | Purpose |
| --- | --- | --- |
| `LANGUAGE_CACHE` | `LanguageCache` | Shared cache used by the CS:GO language router. |
| `LanguageCache` | class | Create an independently registered live language cache. |
| `GetClientLanguage(PlayerReference)` | `string` | Read or refresh a value through `LANGUAGE_CACHE`. |

| `LanguageCache` member | Result | Purpose |
| --- | --- | --- |
| `ClientLanguages` | `Map` | Live editable map from positive client indexes to language strings. |
| `ListenersRegistered` | `boolean` | Read whether at least one exactly owned listener remains registered. |
| `ClientDisconnectCallback` | function | Callback registered to remove disconnected clients. |
| `ClientFullyConnectCallback` | function | Callback registered to populate a newly connected client. |
| `ClientSettingsChangedCallback` | function | Callback registered to refresh a client after its settings change. |
| `RegisterListeners()` | `boolean` | Register all three callbacks, or return `false` when already registered. |
| `UnregisterListeners()` | `boolean` | Remove owned callbacks and clear entries on complete success; return `false` when already inactive without clearing entries. |
| `GetClientLanguage(PlayerReference)` | `string` | Return a cached language or refresh a missing entry. |
| `SetClientLanguage(PlayerReference, strClientLanguage)` | `string` | Store and return a strict language string. |
| `HasClientLanguage(PlayerReference)` | `boolean` | Test the live map for a client. |
| `DeleteClientLanguage(PlayerReference)` | `boolean` | Remove one client from the live map. |
| `ClearClientLanguages()` | `true` | Remove every cached language. |
| `RefreshClientLanguage(PlayerReference)` | `string` | Query the current language, store it, and return it. |

```js
const {
	LANGUAGE_CACHE,
	LanguageCache,
	GetClientLanguage,
} = require("players/language/cache");
const { GetPlayerIndex } = require("players/helpers");

function InspectLanguageCache(PlayerReference, Cache) {
	const nMaximumInt32Value = 2147483647;

	if (!(Cache instanceof LanguageCache) || (Cache === LANGUAGE_CACHE) || (Cache.ListenersRegistered !== true)) {
		throw new TypeError("Cache must be an independently owned, active LanguageCache.");
	}

	const nClientIndex = GetPlayerIndex(PlayerReference);
	if (!Number.isInteger(nClientIndex) || (nClientIndex <= 0) || (nClientIndex > nMaximumInt32Value)) {
		throw new RangeError("PlayerReference must expose a positive Int32 client index.");
	}

	const mapSharedLanguages = LANGUAGE_CACHE.ClientLanguages;
	if (!(mapSharedLanguages instanceof Map)) {
		throw new TypeError("LANGUAGE_CACHE.ClientLanguages must be a Map.");
	}

	let CacheReport = null;
	let OperationError;
	let bOperationFailed = false;
	try {
		const strSharedLanguage = GetClientLanguage(nClientIndex);
		if (typeof strSharedLanguage !== "string") {
			throw new TypeError("The shared cache returned a non-string language.");
		}

		const strInitialLanguage = Cache.GetClientLanguage(nClientIndex);
		const strRefreshedLanguage = Cache.RefreshClientLanguage(nClientIndex);
		const bAlreadyRegistered = Cache.RegisterListeners();
		if ((typeof strInitialLanguage !== "string") || (typeof strRefreshedLanguage !== "string") || (bAlreadyRegistered !== false)) {
			throw new TypeError("LanguageCache returned invalid query or registration results.");
		}

		if ((Cache.HasClientLanguage(nClientIndex) !== true) || (Cache.DeleteClientLanguage(nClientIndex) !== true)) {
			throw new Error("LanguageCache could not remove the refreshed client.");
		}

		const strRestoredLanguage = Cache.SetClientLanguage(nClientIndex, strRefreshedLanguage);
		const bCleared = Cache.ClearClientLanguages();
		const mapClientLanguages = Cache.ClientLanguages;
		if ((strRestoredLanguage !== strRefreshedLanguage) || (bCleared !== true) || !(mapClientLanguages instanceof Map) || (mapClientLanguages.size !== 0)) {
			throw new Error("LanguageCache could not restore and clear its own entries.");
		}

		CacheReport = { InitialLanguage: strInitialLanguage, RefreshedLanguage: strRefreshedLanguage, SharedLanguage: strSharedLanguage };
	} catch (ErrorValue) {
		OperationError = ErrorValue;
		bOperationFailed = true;
	}

	try {
		if (Cache.UnregisterListeners() !== true) {
			throw new Error("LanguageCache disposal returned an invalid result.");
		}
	} catch (CleanupError) {
		if (bOperationFailed) {
			throw new AggregateError([OperationError, CleanupError], "Language-cache operation and cleanup failed.");
		}

		throw CleanupError;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	const bListenersRegistered = Cache.ListenersRegistered;
	if (bListenersRegistered !== false) {
		throw new Error("LanguageCache disposal retained listener ownership.");
	}

	CacheReport.ListenersRegistered = bListenersRegistered;

	return CacheReport;
}

module.exports = { InspectLanguageCache };
```

Create an independent `Cache` with `new LanguageCache()` only when the owning plugin is ready to register listeners, then pass it to `InspectLanguageCache(PlayerReference, Cache)`. The helper rejects the shared singleton, consumes the independent instance's active registration, and leaves unrelated shared entries/listeners intact; the shared lookup may populate the requested client. Retain `Cache` in the caller for every failure path. Preflight failure leaves it unchanged; cleanup failure leaves exact pending callbacks for an explicit `Cache.UnregisterListeners()` retry. A successful report has `ListenersRegistered: false` after disposal.

Registration attempts rollback of the callbacks installed by that operation. If rollback also fails, an `AggregateError` contains the registration error followed by cleanup errors; rollback is not unconditionally atomic. A failed `UnregisterListeners()` attempts every owned removal and retains only failed callbacks; cached entries remain until complete success or explicit `ClearClientLanguages()`. Editing public callback fields does not change the originally registered identities. A constructor that throws does not return an instance: do not claim that its failed rollback can be retried through a returned `Cache`.

If the example's operation and disposal both fail, its `AggregateError.errors` preserves both values in operation/cleanup order, including a thrown `null`. With successful disposal the original operation exception propagates unchanged.

## Client Settings

Client ConVars are returned as raw strings. The following example deliberately accepts only complete unsigned decimal strings in the positive `Int32` range; signs, whitespace, decimal fractions, suffixes, and overflow are rejected. This is the example's plugin policy, not a native parser contract.

```js
const {
	GetClientCVarValue,
	GetClientLanguage,
} = require("players/language");
const { Player } = require("players/entity");

function InspectClientSettings(unClientIndex) {
	const nMaximumInt32Value = 2147483647;

	if (!Number.isInteger(unClientIndex) || (unClientIndex <= 0) || (unClientIndex > nMaximumInt32Value)) {
		throw new TypeError("unClientIndex must be a positive Int32 number.");
	}

	const CurrentPlayer = Player(unClientIndex);
	const nCurrentIndex = CurrentPlayer.Index;
	if (nCurrentIndex !== unClientIndex) {
		throw new Error("Player() returned a different client index.");
	}

	const IsConnected = CurrentPlayer.IsConnected;
	const IsFakeClient = CurrentPlayer.IsFakeClient;
	if ((typeof IsConnected !== "function") || (typeof IsFakeClient !== "function")) {
		throw new TypeError("Player() must expose human-client status methods.");
	}

	const bConnected = IsConnected.call(CurrentPlayer);
	if (typeof bConnected !== "boolean") {
		throw new TypeError("IsConnected() must return a boolean.");
	}

	if (!bConnected) {
		return null;
	}

	const bFakeClient = IsFakeClient.call(CurrentPlayer);
	if (typeof bFakeClient !== "boolean") {
		throw new TypeError("IsFakeClient() must return a boolean.");
	}

	if (bFakeClient) {
		return null;
	}

	function ParseRate(strRateText) {
		if ((typeof strRateText !== "string") || !/^[0-9]+$/.test(strRateText)) {
			throw new TypeError(`Client rates must be complete unsigned decimal strings for player ${unClientIndex}.`);
		}

		const unRate = Number(strRateText);
		if (!Number.isInteger(unRate) || (unRate <= 0) || (unRate > nMaximumInt32Value)) {
			throw new RangeError(`Client rates must fit a positive Int32 value for player ${unClientIndex}.`);
		}

		return unRate;
	}

	const unRate = ParseRate(GetClientCVarValue(unClientIndex, "rate"));
	const unUpdateRate = ParseRate(GetClientCVarValue(unClientIndex, "cl_updaterate"));
	const strClientLanguage = GetClientLanguage(unClientIndex);
	if (typeof strClientLanguage !== "string") {
		throw new TypeError(`GetClientLanguage() must return a string for player ${unClientIndex}.`);
	}

	return { Language: strClientLanguage, Rate: unRate, UpdateRate: unUpdateRate };
}

module.exports = { InspectClientSettings };
```

`rate` and `cl_updaterate` are examples of common Source client settings. Pass another non-empty name to
`GetClientCVarValue()` when the selected game exposes a different setting.

## Language Routing

`cl_language` values are game/client strings such as `english` or `german`. A plugin should define its own supported-language
policy explicitly:

```js
const { GetClientLanguage } = require("players/language");
const { Player } = require("players/entity");

const g_mapGreetings = new Map([
	["english", "Welcome to the server."],
	["german", "Willkommen auf dem Server."],
]);

function GreetingFor(unClientIndex) {
	const nMaximumInt32Value = 2147483647;

	if (!Number.isInteger(unClientIndex) || (unClientIndex <= 0) || (unClientIndex > nMaximumInt32Value)) {
		throw new TypeError("unClientIndex must be a positive Int32 number.");
	}

	const CurrentPlayer = Player(unClientIndex);
	const nCurrentIndex = CurrentPlayer.Index;
	if (nCurrentIndex !== unClientIndex) {
		throw new Error("Player() returned a different client index.");
	}

	const IsConnected = CurrentPlayer.IsConnected;
	const IsFakeClient = CurrentPlayer.IsFakeClient;
	if ((typeof IsConnected !== "function") || (typeof IsFakeClient !== "function")) {
		throw new TypeError("Player() must expose human-client status methods.");
	}

	const bConnected = IsConnected.call(CurrentPlayer);
	if (typeof bConnected !== "boolean") {
		throw new TypeError("IsConnected() must return a boolean.");
	}

	if (!bConnected) {
		return null;
	}

	const bFakeClient = IsFakeClient.call(CurrentPlayer);
	if (typeof bFakeClient !== "boolean") {
		throw new TypeError("IsFakeClient() must return a boolean.");
	}

	if (bFakeClient) {
		return null;
	}

	const strClientLanguage = GetClientLanguage(unClientIndex);
	if (typeof strClientLanguage !== "string") {
		throw new TypeError(`GetClientLanguage() must return a string for player ${unClientIndex}.`);
	}

	return g_mapGreetings.has(strClientLanguage) ? g_mapGreetings.get(strClientLanguage) : g_mapGreetings.get("english");
}

module.exports = { GreetingFor };
```

The fallback above belongs to the plugin's explicit message policy, not to `players/language`. For phrase files, token replacement
and per-recipient translations, use [`translations`](translations.md).

## Errors

- `Player` may be a native/decorated player object or a one-based index accepted by the native player resolver.
- `GetClientCVarValue()` always requires `IVEngineServer` and a currently connected, non-fake client. `GetClientLanguage()` has those native requirements on non-CS:GO branches and on a CS:GO cache miss/refresh. A CS:GO hit only validates the positive index and cached string, not live connection state.
- `GetClientCVarValue()` requires a non-empty string name; invalid arguments throw rather than being coerced.
- Native and getter failures propagate directly. A null SDK string becomes `""`; the module does not invent a language fallback. Cached entries are mutable snapshots, not native lifetime guarantees.
- Native callbacks catch C++ exceptions and attempt to raise contextual JavaScript errors, preserving an existing JavaScript exception. Error-object allocation and recovery from termination or allocator/OOM failure are not guaranteed.

## Lifecycle

Native results are copied engine strings; cached results reflect the last stored/refreshed value. `ClientSettingsChanged` and `ClientFullyConnect` callbacks refresh an entry; `ClientDisconnect` removes it when dispatched. A cache hit does not check whether listeners are registered. Importing the CS:GO router/cache creates the shared cache and registers three callbacks; loading these example functions performs no client lookup.

Invoke examples on the game thread in an initialized SDK phase, with a current player connection and no hooks that can disconnect or replace it during the workflow. Index/type checks and matching strings do not pin a connection or make sequential lookups atomic. The client inspection/greeting helpers return `null` for a fake or disconnected client and throw for malformed status/results. Empty/unknown language strings use only the greeting example's explicit English fallback.

A plugin owning an independent cache must dispose/retry its exact callbacks on unload. Do not unregister or clear `LANGUAGE_CACHE` merely to inspect it. Inactive `UnregisterListeners()` returns `false` without clearing entries.

## Related Modules

- [`players/helpers`](players-helpers.md) exposes the same native functions with the complete player-conversion graph.
- [`players/entity`](players-entity.md) adds `GetLanguage()` to the decorated player wrapper.
- [`translations`](translations.md) owns language-aware phrase lookup and token substitution.
- [`listeners`](listeners.md) owns the project `ClientSettingsChanged`, `ClientFullyConnect`, and `ClientDisconnect` managers used by this cache.
- [`events`](events.md) documents native game events, including external `client_settingschanged` for games that declare it; this spelling is not the cache manager name.
