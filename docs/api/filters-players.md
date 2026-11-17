# `require("filters/players")`

> AI navigation: use the contents to locate scans, snapshot fields, iterator contracts, expression grammar, ownership, and errors. This hand-maintained reference follows `packages/sourcejs/filters/players.js` and the selected native bindings; navigation does not replace a full review when required.

Module index: [SourceJS API Reference](README.md)

`filters/players` scans the currently connected clients and adds reusable named filters and expression parsing. It returns compact JavaScript Player snapshots of native records; use them immediately and re-scan after disconnects, index reuse, or map changes.

Engine-backed scans and compact-record action methods run synchronously and must stay on the server/game thread. Iterator and expression helpers do not enqueue backend IO requests or accept `Blocking` options; native scans invoked by those helpers run before the call returns.

## Contents

- [Import](#import)
- [Native scans](#native-scans)
- [Compact Player records](#compact-player-records)
- [PlayerIterator](#playeriterator)
- [Default filters](#default-filters)
- [Filter expressions](#filter-expressions)
- [Resolution and ownership](#resolution-and-ownership)
- [Errors](#errors)

## Import

```js
const {
	GetAllPlayers,
	GetBotPlayers,
	GetConnectedPlayers,
	GetDefaultPlayerFilters,
	GetHumanPlayers,
	GetPlayersByTeam,
	ParsePlayerFilterExpression,
	PlayerIterator,
} = require("filters/players");
```

The module exposes eight public names: five scan operations obtain current compact records from the selected-SDK runtime, while the iterator, default-filter, and expression helpers extend the same module object.

## Native scans

| Function | Result |
| --- | --- |
| `GetAllPlayers()` | New array of all connected humans and bots, ordered by entity index. |
| `GetHumanPlayers()` | New array containing connected non-fake clients. |
| `GetBotPlayers()` | New array containing connected fake clients. |
| `GetConnectedPlayers()` | New `GetAllPlayers()` snapshot array filtered by each record's captured `Connected` value. |
| `GetPlayersByTeam(TeamValue?)` | New array containing connected humans and bots selected by numeric or named team, or an unrestricted scan for an absent or unrecognized string selector; see lookup rules below. |

`GetPlayersByTeam()` has no bot-selection argument and includes both client kinds. Omit the selector, or pass `null`/`undefined`, to scan all teams. Numeric selectors must pass the native signed 32-bit integer check; the scan applies a restriction only when the resolved number is non-negative, so a negative number selects all teams.

Use the canonical PascalCase keys returned by `GetTeamNames()` from `players/teams` for the selected SDK. Native string lookup ignores ASCII case and removes underscores, hyphens, and ordinary spaces before comparing configured names. An unknown string resolves to the any-team sentinel and returns an unrestricted scan, not an unknown-team error. Validate a required team against the configured keys before calling. This selector normalization does not change the case-sensitive names registered on `PlayerIterator` or accepted by filter expressions. SourceJS does not install universal Survivor, Infected, Terrorist, or Counter-Terrorist entries independently of the profile.

Inspect current population without retaining scan records. These are three independent scans, not one atomic snapshot; the counts need not add up if the connected client set changes between calls:

```js
const { GetAllPlayers, GetBotPlayers, GetHumanPlayers } = require("filters/players");
const { LogInfo } = require("loggers");

const g_InspectPlayerPopulation = () => {
	const PlayerPopulation = { AllPlayerCount: GetAllPlayers().length, BotPlayerCount: GetBotPlayers().length, HumanPlayerCount: GetHumanPlayers().length };
	LogInfo("PlayerPopulation %s", JSON.stringify(PlayerPopulation));
};

g_InspectPlayerPopulation();
```

Resolve a profile-backed team name instead of hardcoding a game-specific team:

```js
const { GetPlayersByTeam } = require("filters/players");
const { LogInfo } = require("loggers");
const { GetTeamNames } = require("players/teams");

const g_ListTeamPlayers = () => {
	const GetPlayerName = (Player) => Player.Name;
	for (const vecTeamEntry of Object.entries(GetTeamNames())) {
		const strTeamName = vecTeamEntry[0];
		const nTeamNumber = vecTeamEntry[1];
		const vecTeamPlayers = GetPlayersByTeam(strTeamName);
		LogInfo("PlayerTeam Name=%s Number=%d PlayerNames=%s", strTeamName, nTeamNumber, JSON.stringify(vecTeamPlayers.map(GetPlayerName)));
	}
};

g_ListTeamPlayers();
```

## Compact Player records

Every scan returns newly created compact Player objects with captured fields and a separate `Origin` object. These are shallow JavaScript snapshots, not live accessors or retained native-client ownership:

| Field | Type | Meaning |
| --- | --- | --- |
| `Index` | number | Current client entity index. |
| `Name` | string | Current player name. |
| `UserID` | number | Current engine user ID. |
| `NetworkID` | string | Engine network identifier, such as a Steam2 ID or `BOT`. |
| `RemoteAddress` | string | Human network endpoint; empty for bots or unavailable network state. |
| `TeamNumber` | number | Team index. |
| `Frags`, `Deaths` | number | Scoreboard values. |
| `Health`, `MaximumHealth` | number | Current health values. |
| `Connected`, `FakeClient`, `Dead`, `Free` | boolean | Connection, bot, life, and edict state. |
| `Language` | string | Human `cl_language`; empty for bots or unavailable clients. |
| `Origin` | object | Captured absolute origin with `X`, `Y`, and `Z` components, not a live memory view. |
| `WeaponName`, `ModelName` | string | Current weapon and model names. |

Methods retain the native record as their receiver and resolve its `Index` when called. Assigning a captured field does not change native state or retarget these methods. The package keeps its public action names while binding the corresponding native methods:

| Method | Behavior |
| --- | --- |
| `SlayPlayer()` | Kills the current player at the index. |
| `ExecuteClientCommand(strCommand, bServerSide?)` | Sends a client command; the optional boolean selects server-side execution. |
| `SetPlayerName(strPlayerName)` | Changes the player name. |
| `SayPlayerMessage(strPlayerMessage)`, `SayPlayerTeamMessage(strPlayerMessage)` | Executes public or team chat as the player. |
| `KickPlayer(strKickReason?)` | Kicks with only the supplied reason text. |
| `BanPlayer(nBanDuration?, bKickPlayer?, bWriteBanList?)` | Forwards to native `Ban`; omitted arguments default to `0`, `true`, and `true`. A supplied duration must be a primitive finite integer from `0` through `2147483647`; supplied flags must be primitive booleans. |
| `ChangePlayerTeam(TeamReference)` | Forwards to native `ChangeTeam`: accepts a non-negative signed 32-bit team index or a selected-profile team name. Name lookup uses ASCII case/underscore/hyphen/space normalization; unknown names and nullish/negative selectors fail instead of selecting all teams. |
| `GivePlayerNamedItem(strItem, nSubtype?, bRemoveIfNotCarried?)` | Binds the native record's `GiveNamedItem` method when present; otherwise this field is `undefined`. Native installation requires `SOURCEJS_HAS_BASE_ENTITY`. Check callability before use; the call still validates the current player and item arguments. The final option exists only on the CS:GO-style overload. |

`BanPlayer` uses the native `Ban` duration contract: a supplied duration must be a primitive number containing a finite integer from `0` through `2147483647`; numeric `-0` is treated as `0`. Fractions, non-finite or out-of-range values, strings, booleans, boxed numbers, other objects, `bigint` and symbols are rejected before reading the receiver's `Index` or issuing native commands. No `valueOf()`, `toString()` or `Symbol.toPrimitive` conversion is attempted. Only omission selects the native duration default: explicitly supplied `undefined` or `null` is rejected, as are non-boolean kick/write flags. Omit trailing arguments to use defaults. A successful command dispatch does not by itself prove that the engine applied or persisted a ban.

Use a compact record for an immediate one-step operation, and prefer the directly imported `Player(unPlayerIndex)` factory from `players/entity` for a longer live workflow:

```js
const { GetHumanPlayers } = require("filters/players");

const g_PlaySoundForLivingHumans = () => {
	for (const Player of GetHumanPlayers()) {
		if (!Player.Dead && !Player.ExecuteClientCommand("play ui/buttonclick.wav", false)) {
			throw new Error(`Failed to play a sound for player #${Player.Index}.`);
		}
	}
};

g_PlaySoundForLivingHumans();
```

## `PlayerIterator`

### Constructor

```text
new PlayerIterator(RequiredFilters = null, ExcludedFilters = null)
```

Constructor arguments use `RequiredFilters` and `ExcludedFilters`. Each argument may be `null`, `undefined`, one non-empty filter name, or an iterable of non-empty names. The constructor copies the names and validates their current registration. Required callbacks run in order until one returns a falsy value; excluded callbacks run until one returns a truthy value. Unknown names throw during construction. Later removal throws only if resolution reaches that name's lookup; an empty scan or earlier rejection can avoid it.

### Fields

| Field | Meaning |
| --- | --- |
| `RequiredFilterNames` | Copied, mutable array of required names. |
| `ExcludedFilterNames` | Copied, mutable array of excluded names. |
| `IteratorItems` | Initially the inherited lazy resolver over the current native scan and `IsValid()` checks. Replacing it replaces that pipeline. |
| `IteratorPredicate` | Initially `null`; assigning a function adds an ordinary post-source predicate, separate from named filtering. |
| `static Filters` | Class-local Map of filter callbacks, owned by this plugin context. Its property is non-writable and non-configurable; the Map contents remain mutable. |

### Static methods

| Method | Behavior |
| --- | --- |
| `Iterator()` | Performs a new native `GetAllPlayers()` scan. |
| `RegisterFilter(strFilterName, Callback)` | Adds one unique filter and returns its callback. |
| `UnregisterFilter(strFilterName)` | Removes an existing filter and returns `true`. |
| `HasFilter(strFilterName)` | Tests whether a filter exists. |
| `GetFilterNames()` | Returns a new array of current filter names. |
| `DefaultFilters()` | Resolves each currently registered name independently through `new this(strFilterName)`, producing a Set in a new null-prototype object. Subclasses must preserve that constructor contract or override this method. |

### Instance methods

`Iterate()`, `GetIteratorFilterCallback(strFilterName)`, and `IsValid(Item)` are inherited by the player iterator. Inherited `Resolve()`, `Values()`, `ToArray()`, `Count()`, `First()`, `Filter(Predicate)`, `Map(Callback)`, and `ForEach(Callback)` are also available. `[Symbol.iterator]()` is unchanged. Their synchronous callback, mutable-field, and nullish `First()` contracts are documented in [`filters/iterator`](filters-iterator.md). While the installed `IteratorItems` resolver remains unchanged, every terminal operation performs a new player scan; replacing it bypasses the scan and named filtering.

Select living human players and inspect the fresh result:

```js
const { PlayerIterator } = require("filters/players");
const { LogInfo } = require("loggers");

const g_InspectActiveHumanPlayers = () => {
	const GetPlayerName = (Player) => Player.Name;
	const ActiveHumanPlayerIterator = new PlayerIterator(["Connected", "Alive", "Human"]);
	const FirstActiveHumanPlayer = ActiveHumanPlayerIterator.First();
	const unFirstPlayerIndex = (FirstActiveHumanPlayer === null) ? null : FirstActiveHumanPlayer.Index;
	const vecActiveHumanPlayerNames = ActiveHumanPlayerIterator.Map(GetPlayerName);
	LogInfo("PlayerHumanActivity %s", JSON.stringify({ ActiveHumanPlayerCount: ActiveHumanPlayerIterator.Count(), FirstPlayerIndex: unFirstPlayerIndex, ActiveHumanPlayerNames: vecActiveHumanPlayerNames }));
};

g_InspectActiveHumanPlayers();
```

Register plugin-owned filters during load and always remove them during unload:

```js
const { PlayerIterator } = require("filters/players");
const { LogInfo } = require("loggers");

const g_InspectWoundedPlayers = () => {
	const IsWoundedPlayer = (Player) => !Player.Dead && (Player.Health < Player.MaximumHealth);
	const vecFailures = [];
	let bWoundedPlayerFilterRegistered = false;

	try {
		const RegisteredWoundedPlayerFilter = PlayerIterator.RegisterFilter("Wounded", IsWoundedPlayer);
		bWoundedPlayerFilterRegistered = true;

		if ((RegisteredWoundedPlayerFilter !== IsWoundedPlayer) || !PlayerIterator.HasFilter("Wounded")) {
			throw new Error("Wounded filter registration failed.");
		}

		for (const Player of new PlayerIterator("Wounded")) {
			LogInfo("PlayerWounded Index=%d Health=%d MaximumHealth=%d", Player.Index, Player.Health, Player.MaximumHealth);
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (bWoundedPlayerFilterRegistered && (!PlayerIterator.UnregisterFilter("Wounded") || PlayerIterator.HasFilter("Wounded"))) {
				throw new Error("Wounded filter cleanup failed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Player filtering and Wounded-filter cleanup failed.");
	}
};

g_InspectWoundedPlayers();
```

The example preserves a sole failure unchanged and reports simultaneous operation/cleanup failures in an `AggregateError`, in that order. Registration failure does not authorize removing another owner's existing `Wounded` filter. A cleanup failure does not establish successful removal; arrange unload-time removal for any plugin filter that remains registered.

## Default filters

### `GetDefaultPlayerFilters()`

Returns a new null-prototype object whose values are independently resolved Sets for the current class registry, including plugin-registered names. Built-in names registered on the module's initial import are:

- `All`;
- `Bot` and `Human`;
- `Alive` and `Dead`;
- `Connected`;
- every exact team-name key loaded from the selected SDK profile when this plugin context imports the module.

Each Set is resolved independently, so do not compare compact record identity across different entries or treat the entire result as one atomic world snapshot. Removing a built-in name removes it from later results too. Team entries are registered on import; reload the plugin after changing team-profile files so the class registry is rebuilt.

```js
const { GetDefaultPlayerFilters } = require("filters/players");
const { LogInfo } = require("loggers");

const g_InspectDefaultPlayerFilters = () => {
	const CreatePlayerFilterSizeEntry = (vecPlayerFilterEntry) => {
		const strPlayerFilterName = vecPlayerFilterEntry[0];
		const setFilteredPlayers = vecPlayerFilterEntry[1];

		return [strPlayerFilterName, setFilteredPlayers.size];
	};

	const DefaultPlayerFilters = GetDefaultPlayerFilters();
	const PlayerFilterSizes = Object.fromEntries(Object.entries(DefaultPlayerFilters).map(CreatePlayerFilterSizeEntry));
	LogInfo("PlayerFilterSizes %s", JSON.stringify(PlayerFilterSizes));
};

g_InspectDefaultPlayerFilters();
```

## Filter expressions

### Signatures

`ParsePlayerFilterExpression(strFilterExpression, AvailableFilters = null)` returns the current players selected by the expression.

The function parses a non-empty string and returns a Set of Player values. Tokenization runs first; after successful tokenization, an omitted, `null`, or `undefined` `AvailableFilters` resolves `GetDefaultPlayerFilters()` before grammar evaluation. A numeric token is a decimal engine `unUserID` in the inclusive range `0`–`2147483647`, not an entity index or BigInt. Leading zeros are accepted. Identifiers are case-sensitive filter names matching `[A-Za-z_][A-Za-z0-9_]*`; whitespace is permitted between tokens. `PlayerIterator.RegisterFilter()` accepts arbitrary non-empty names for ordinary iterator use, but expression filter names must obey this lexical grammar; registering an operator or closing parenthesis does not make it a valid expression primary.

Grammar:

```text
expression := primary (("+" | "-") primary)*
primary    := unUserID | strFilterName | "(" expression ")"
```

`+` unions by player index, `-` subtracts by player index, and both operators have equal precedence and evaluate left to right. Parentheses change grouping. Union keeps the right-hand record when an index occurs on both sides, without moving that index's existing insertion position. Subtraction keeps left-hand records whose indexes are absent on the right. A missing user ID or unknown name throws.

Each numeric token performs a separate current native `GetAllPlayers()` search and creates a fresh compact snapshot, even when a custom `AvailableFilters` object is supplied. It does not search those custom collections. Default-filter and numeric scans can therefore observe different world states; the result is not an atomic client snapshot.

Use an administrator-supplied expression immediately against the current client set:

```js
const { ParsePlayerFilterExpression } = require("filters/players");
const { LogInfo } = require("loggers");

const g_ListSelectedPlayers = () => {
	const setSelectedPlayers = ParsePlayerFilterExpression("(Human + Bot) - Dead");
	for (const Player of setSelectedPlayers) {
		LogInfo("PlayerSelection UserID=%d Name=%s", Player.UserID, Player.Name);
	}
};

g_ListSelectedPlayers();
```

Numeric user IDs can add one current player while index-based deduplication prevents duplicates:

```js
const { GetAllPlayers, ParsePlayerFilterExpression } = require("filters/players");
const { LogInfo } = require("loggers");

const g_InspectNumericPlayerFilter = () => {
	const GetPlayerIndex = (Player) => Player.Index;
	const vecCurrentPlayers = GetAllPlayers();
	if (vecCurrentPlayers.length === 0) {
		throw new Error("Numeric player-filter example requires a connected player.");
	}

	const setSelectedPlayers = ParsePlayerFilterExpression(`Human + ${vecCurrentPlayers[0].UserID}`);
	LogInfo("PlayerNumericSelection Indexes=%s", JSON.stringify([...setSelectedPlayers].map(GetPlayerIndex)));
};

g_InspectNumericPlayerFilter();
```

Pass an object whose prototype is the current realm's `Object.prototype` or `null` to define a local expression vocabulary. Only own enumerable string keys are used, and every such key must match the identifier grammar. Each value must be a non-string iterable; nullish values and scalar values are rejected. Every item must expose a non-negative safe-integer numeric `Index`, but it need not be a native-backed Player record.

After tokenization, all these collections are validated and consumed once per parse, including entries not referenced by the expression, before the parser finishes checking its grammar. Their getters and iterators can therefore run even when later grammar evaluation throws. Duplicate indexes keep the last record supplied while retaining the index's first insertion position. Operation-owned Sets preserve the supplied objects rather than cloning them; changing those objects changes the retained values. A single-use generator is not rewound for a later parse.

```js
const { GetAllPlayers, ParsePlayerFilterExpression } = require("filters/players");
const { LogInfo } = require("loggers");

const g_InspectCustomPlayerFilters = () => {
	const vecCurrentPlayers = GetAllPlayers();
	if (vecCurrentPlayers.length === 0) {
		throw new Error("Custom player-filter example requires a connected player.");
	}

	const IsSameTeamPlayer = (Player) => Player.TeamNumber === vecCurrentPlayers[0].TeamNumber;
	const IsWoundedPlayer = (Player) => !Player.Dead && (Player.Health < Player.MaximumHealth);
	const GetPlayerName = (Player) => Player.Name;
	const setSelectedPlayers = ParsePlayerFilterExpression("Wounded + SameTeam", { SameTeam: vecCurrentPlayers.filter(IsSameTeamPlayer), Wounded: vecCurrentPlayers.filter(IsWoundedPlayer) });
	LogInfo("PlayerCustomSelection Names=%s", JSON.stringify([...setSelectedPlayers].map(GetPlayerName)));
};

g_InspectCustomPlayerFilters();
```

## Resolution and ownership

- Native scan arrays, expression Sets, default-filter Sets, compact fields, and `Origin` objects are point-in-time JavaScript values.
- `PlayerIterator` is lazy. With its installed source unchanged, each terminal operation materializes a separate current scan. An overridden `IteratorItems` field follows the replacement source's contract instead.
- Methods on compact records act through the native receiver's `Index`; retaining one across disconnect/index reuse can target a different client. Captured JavaScript fields are snapshots, not setters for that receiver.
- Before later mutations, compare captured identity with a freshly resolved current player, not merely the same entity index. Use `UserID` and an appropriate `NetworkID`; `BOT` or an empty network ID is not a unique client identity. Do not treat a factory result as a client-lifetime guarantee.
- Module filter registries belong to one isolated plugin context and are not shared with another plugin.

## Errors

The module throws for non-string or empty expressions, invalid syntax, unknown names, missing or out-of-range user IDs, malformed custom filter maps or player indexes (including unused enumerable entries), invalid iterator names/callbacks, duplicate registrations, missing unregistrations, and native player/team capability failures. Caller-owned getters, iterators, and filter callbacks can also throw; their errors propagate.

```js
const { ParsePlayerFilterExpression } = require("filters/players");
const { LogInfo } = require("loggers");

const g_InspectPlayerFilterErrors = () => {
	const vecInvalidPlayerFilterExpressions = [
		{ ErrorType: SyntaxError, FilterExpression: "" },
		{ ErrorType: SyntaxError, FilterExpression: "Human +" },
		{ ErrorType: SyntaxError, FilterExpression: "Human + )" },
		{ ErrorType: ReferenceError, FilterExpression: "UnknownFilter" },
	];
	for (const { ErrorType, FilterExpression: strFilterExpression } of vecInvalidPlayerFilterExpressions) {
		let CaughtPlayerFilterError = null;

		try {
			ParsePlayerFilterExpression(strFilterExpression);
		} catch (PlayerFilterError) {
			CaughtPlayerFilterError = PlayerFilterError;
		}

		if (!(CaughtPlayerFilterError instanceof ErrorType)) {
			throw new Error(`${strFilterExpression} did not throw ${ErrorType.name}.`);
		}

		LogInfo("PlayerFilterValidation Expression=%s Error=%s", strFilterExpression, CaughtPlayerFilterError.message);
	}
};

g_InspectPlayerFilterErrors();
```
