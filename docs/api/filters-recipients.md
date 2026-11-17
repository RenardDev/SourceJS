# `require("filters/recipients")`

> AI navigation: use the contents to locate native groups, conversion, mutable collections, delivery flags, ownership, and errors. This hand-maintained reference follows `packages/sourcejs/filters/recipients.js` and the selected native bindings; navigation does not replace a full review when required.

Module index: [SourceJS API Reference](README.md)

`filters/recipients` builds ordered, duplicate-free client-index collections for user messages, sounds, menus, and other `IRecipientFilter` consumers. Native scans are captured when called. Class mutators update the current `RecipientIndexes` array in place and retain explicit delivery flags; direct field reassignment or array editing is caller-owned and can invalidate the usual ordering, uniqueness, and index invariants.

Native lookups and message delivery run synchronously on the server/game thread. These collection helpers do not enqueue backend IO requests or accept `Blocking` options.

## Contents

- [Import](#import)
- [Native recipient groups](#native-recipient-groups)
- [Conversion functions](#conversion-functions)
- [BaseRecipientFilter](#baserecipientfilter)
- [RecipientFilter](#recipientfilter)
- [Message delivery](#message-delivery)
- [Resolution and ownership](#resolution-and-ownership)
- [Errors](#errors)

## Import

```js
const {
	BaseRecipientFilter,
	ContainsRecipient,
	CreateRecipientFilterFromPlayer,
	CreateRecipientFilterFromValues,
	GetAliveRecipients,
	GetAllRecipients,
	GetBotRecipients,
	GetDeadRecipients,
	GetHumanRecipients,
	GetRecipientsByTeam,
	RecipientFilter,
	ResolveRecipientPlayers,
} = require("filters/recipients");
```

The module has 12 public names across 12 API entries.

## Native recipient groups

Every group function returns a new `RecipientFilter` with point-in-time indexes:

| Function | Included clients |
| --- | --- |
| `GetHumanRecipients()` | All connected human clients, alive and dead. |
| `GetAllRecipients()` | All connected humans and bots. |
| `GetBotRecipients()` | All connected bots. |
| `GetAliveRecipients()` | Connected living humans only. |
| `GetDeadRecipients()` | Connected dead humans only. |
| `GetRecipientsByTeam(TeamValue, bIncludeBots = false)` | Connected members of a signed 32-bit integer or selected-SDK named team; bots are excluded unless explicitly enabled. The package forwards an omitted value as `undefined`; nullish or negative team numbers and unrecognized strings select all teams. |

`GetAliveRecipients()` and `GetDeadRecipients()` deliberately exclude bots. Resolve game-specific team names through `GetTeamNames()` from `players/teams`; no universal team names are installed. Numeric team selectors must fit signed 32-bit integers. These wrappers retain a captured index array as a stored source, not a live population query. Their `IncludeBots` field still defaults to `true` for future mutations, even when the initial group excludes bots.

Native team-name lookup ignores ASCII case and removes underscores, hyphens, and ordinary spaces before comparison. An unknown string, including an empty string, resolves to the any-team sentinel rather than throwing; `bIncludeBots` still controls bot inclusion. Validate a required name against the selected profile before calling. Group calls and their wrapper normalization perform separate current-client lookups, not one atomic population snapshot.

```js
const {
	GetAliveRecipients,
	GetAllRecipients,
	GetBotRecipients,
	GetDeadRecipients,
	GetHumanRecipients,
} = require("filters/recipients");
const { LogInfo } = require("loggers");

const g_InspectRecipientGroups = () => {
	LogInfo("RecipientGroups %s", JSON.stringify({
		AliveRecipientIndexes: GetAliveRecipients().GetRecipientIndexes(),
		AllRecipientIndexes: GetAllRecipients().GetRecipientIndexes(),
		BotRecipientIndexes: GetBotRecipients().GetRecipientIndexes(),
		DeadRecipientIndexes: GetDeadRecipients().GetRecipientIndexes(),
		HumanRecipientIndexes: GetHumanRecipients().GetRecipientIndexes(),
	}));
};

g_InspectRecipientGroups();
```

```js
const { GetRecipientsByTeam } = require("filters/recipients");
const { LogInfo } = require("loggers");
const { GetTeamNames } = require("players/teams");

const g_InspectTeamRecipients = () => {
	for (const vecTeamEntry of Object.entries(GetTeamNames())) {
		const strTeamName = vecTeamEntry[0];
		const nTeamNumber = vecTeamEntry[1];
		LogInfo("RecipientTeam %s", JSON.stringify({
			HumanRecipientIndexes: GetRecipientsByTeam(strTeamName).GetRecipientIndexes(),
			TeamName: strTeamName,
			TeamNumber: nTeamNumber,
			RecipientIndexesWithBots: GetRecipientsByTeam(strTeamName, true).GetRecipientIndexes(),
		}));
	}
};

g_InspectTeamRecipients();
```

## Conversion functions

### `CreateRecipientFilterFromPlayer()`

`CreateRecipientFilterFromPlayer(RecipientValue, bIncludeBots = false)` builds a filter from one positive client index or an object with its own positive safe-integer `Index`. A connected bot is omitted unless the boolean argument is `true`; disconnected clients are omitted.

### `CreateRecipientFilterFromValues()`

`CreateRecipientFilterFromValues(RecipientValues, bIncludeBots = false)` builds a filter from one value, an array or iterable, an `{ RecipientIndexes }` record, or another recipient filter. Input order is preserved, duplicate indexes are removed, disconnected clients are omitted, and bot handling follows the boolean argument. Nullish sources are empty. Expansion is one level deep: nested arrays are not recursively flattened, primitive strings and source functions are not collection sources, and single-use iterators are consumed rather than rewound.

### `ContainsRecipient()`

`ContainsRecipient(RecipientFilter, RecipientValue)` delegates to the native collector and tests the supplied positive client index or own-indexed object against currently connected recipients, including bots. It is not a raw `RecipientIndexes.includes()` check: a disconnected cached index can return `false` without being removed from the stored array.

### `ResolveRecipientPlayers()`

`ResolveRecipientPlayers(RecipientFilter)` returns newly created native Player facades for currently connected indexes, preserving recipient order and omitting disconnected entries. These are live native objects, not the compact snapshots returned by [`filters/players`](filters-players.md). Native fields use `Team`, `Weapon`, and `Model`; action methods use `Slay`, `Ban`, `ChangeTeam`, `ExecuteClientCommand`, `SetName`, `Say`, `SayTeam`, `Kick`, and, when installed, `GiveNamedItem`. Getters resolve current state, and methods act through the native receiver's index. Neither the array nor a retained facade pins client identity across disconnects, index reuse, or map changes.

Convert command targets and resolve current names immediately:

```js
const {
	ContainsRecipient,
	CreateRecipientFilterFromPlayer,
	CreateRecipientFilterFromValues,
	GetAllRecipients,
	ResolveRecipientPlayers,
} = require("filters/recipients");
const { LogInfo } = require("loggers");

const g_InspectRecipientConversions = () => {
	const GetPlayerName = (Player) => Player.Name;
	const vecCurrentRecipientIndexes = GetAllRecipients().GetRecipientIndexes();
	if (vecCurrentRecipientIndexes.length === 0) {
		throw new Error("Recipient conversion example requires a connected client.");
	}

	const unFirstRecipientIndex = vecCurrentRecipientIndexes[0];
	const vecRecipientValues = [unFirstRecipientIndex, { Index: unFirstRecipientIndex }, unFirstRecipientIndex];
	if (vecCurrentRecipientIndexes.length > 1) {
		vecRecipientValues.push({ Index: vecCurrentRecipientIndexes[1] });
	}

	const SinglePlayerRecipientFilter = CreateRecipientFilterFromPlayer(unFirstRecipientIndex, true);
	const MixedRecipientFilter = CreateRecipientFilterFromValues(vecRecipientValues, true);
	const vecRecipientPlayers = ResolveRecipientPlayers(MixedRecipientFilter);
	LogInfo("RecipientConversions %s", JSON.stringify({
		ContainsFirstRecipient: ContainsRecipient(MixedRecipientFilter, unFirstRecipientIndex),
		SinglePlayerRecipientIndexes: SinglePlayerRecipientFilter.GetRecipientIndexes(),
		RecipientPlayerNames: vecRecipientPlayers.map(GetPlayerName),
	}));
};

g_InspectRecipientConversions();
```

## `BaseRecipientFilter`

### Constructor

```text
new BaseRecipientFilter(RecipientValues = [], RecipientOptions = {})
```

`RecipientValues` accepts the same values as `CreateRecipientFilterFromValues()`; constructor-supplied indexes always allow bots because they are explicit. `RecipientOptions` must have the current realm's `Object.prototype` or `null` as its prototype and contain only boolean `IncludeBots`, `Reliable`, `InitializationMessage`, or `ClearRecipients` keys. All own keys are checked, including non-enumerable and symbol keys; unknown names and symbols are rejected. Options cannot also have own `Index`, `RecipientIndexes`, or `Symbol.iterator` properties. The clear option is meaningful for `UpdateRecipients()` and is accepted by shared option parsing. Defaults are `IncludeBots: true`, `Reliable: false`, and `InitializationMessage: false`.

### Static method

| Method | Behavior |
| --- | --- |
| `CreateRecipientFilterFromNativeInfo(NativeRecipientFilterInformation)` | Calls `new this(vecIndexes, Options)` after requiring an object with a `RecipientIndexes` array. Own boolean `Reliable`/`InitializationMessage` flags are copied; missing or inherited flags default to `false`, and other info fields are ignored. Subclasses must accept the same constructor shape. |

### Fields and getters

| Field | Meaning |
| --- | --- |
| `RecipientIndexes` | Ordinary writable array field. Built-in mutators preserve its current identity and append unique indexes; direct edits can add duplicates, stale or malformed entries, and replacing the field replaces the array. |
| `RecipientSourceFilters` | Mutable stored-source array, initially empty for a base filter; source values are retained by reference, not deep-copied. |
| `IncludeBots` | Default bot policy used by add, merge, add-all, and update operations. |
| `Reliable` | Writable delivery flag; `IsRecipientFilterReliable()` validates that its current value is boolean. |
| `InitializationMessage` | Writable initialization-message flag; `IsRecipientFilterInitializationMessage()` validates that its current value is boolean. |
| `RecipientLength`, `RecipientCount` | Read the current array's raw length; they do not rescan connections, deduplicate entries, or repair caller edits. |

### Methods

| Method | Behavior |
| --- | --- |
| `ClearRecipients()` | Empties the stable index array and returns this filter. |
| `At(nRecipientPosition)` | Uses `Array.prototype.at`, including negative positions; returns the stored value or `null` when nullish. It does not validate caller-edited entries. |
| `Slice(nStartPosition = 0, nEndPosition = undefined)` | Shallow-copies stored entries using `Array.prototype.slice` semantics, without native normalization. |
| `IsRecipientFilterReliable()`, `IsRecipientFilterInitializationMessage()` | Return the current writable flags. |
| `GetRecipientIndex(nRecipientPosition)` | Uses `Array.prototype.at`, including negative positions; returns `0` for an undefined entry and otherwise validates a positive safe-integer index. |
| `AddRecipients(RecipientValue, bIncludeBots = this.IncludeBots)` | Expands one value or collection, resolves current connected clients, and appends indexes not already present. |
| `RemoveRecipients(RecipientValues)` | Expands one value or collection and validates indexes locally, then removes all matching stored entries in place, including disconnected clients and bots. It does not require a native connection lookup. |
| `AddAllPlayerRecipients(bIncludeBots = this.IncludeBots)` | Adds a fresh current human or human-and-bot scan. |
| `RemoveAllPlayerRecipients()` | Clears the complete filter. |
| `AddRecipient(RecipientValue)`, `RemoveRecipient(RecipientValue)` | Engine-style single-recipient conveniences; explicit add allows bots. |
| `HasRecipient(RecipientValue)`, `ContainsRecipient(RecipientValue)` | Delegate to native connected-recipient membership; they do not purge stale stored indexes. |
| `MergeRecipients(RecipientValues, bIncludeBots = this.IncludeBots)` | Resolves values, appends unique indexes, and returns this filter. Existing caller-created duplicates are not repaired. |
| `UpdateRecipients(...vecRecipientSources)` | A final source may be an options object. Resolves all supplied sources or stored `RecipientSourceFilters` before optionally clearing and appending to the current index array. No supplied or stored sources means a fresh all/human scan. |
| [`ResolveRecipientPlayers()`](#resolverecipientplayers) | Returns newly created native live Player facades for current connected indexes, not compact snapshots. |
| `GetRecipientIndexes()` | Shallow-copies the current array without connection checks or validation of caller-edited entries. |
| `toString()` | Returns engine-style text such as `(1, 3)`. |
| `[Symbol.iterator]()` | Returns the current array's live iterator, not a normalized snapshot. |

Exercise the complete mutable collection lifecycle while preserving `RecipientIndexes` identity:

```js
const { BaseRecipientFilter, GetAllRecipients } = require("filters/recipients");
const { LogInfo } = require("loggers");

const g_InspectRecipientLifecycle = () => {
	const vecCurrentRecipientIndexes = GetAllRecipients().GetRecipientIndexes();
	if (vecCurrentRecipientIndexes.length === 0) {
		throw new Error("Recipient lifecycle example requires a connected client.");
	}

	const unFirstRecipientIndex = vecCurrentRecipientIndexes[0];
	const RecipientFilter = new BaseRecipientFilter([], { IncludeBots: true });
	const vecRecipientIndexReference = RecipientFilter.RecipientIndexes;
	const RecipientMutationResult = RecipientFilter.AddRecipients({ Index: unFirstRecipientIndex }).AddRecipient(unFirstRecipientIndex).MergeRecipients([unFirstRecipientIndex]).RemoveRecipient(unFirstRecipientIndex).AddRecipient(unFirstRecipientIndex);
	if ((RecipientMutationResult !== RecipientFilter) || (RecipientFilter.RecipientIndexes !== vecRecipientIndexReference)) {
		throw new Error("Recipient mutations did not preserve filter identity.");
	}

	LogInfo("RecipientLifecycle %s", JSON.stringify({
		ContainsFirstRecipient: RecipientFilter.ContainsRecipient(unFirstRecipientIndex),
		RecipientCount: RecipientFilter.RecipientCount,
		FirstRecipientIndex: RecipientFilter.GetRecipientIndex(0),
		HasFirstRecipient: RecipientFilter.HasRecipient(unFirstRecipientIndex),
		LastRecipientIndex: RecipientFilter.At(-1),
		RecipientLength: RecipientFilter.RecipientLength,
		PreservedRecipientIndexArray: RecipientFilter.RecipientIndexes === vecRecipientIndexReference,
		RecipientIndexSlice: RecipientFilter.Slice(0, 2),
		RecipientFilterText: RecipientFilter.toString(),
		RecipientIteratorValues: [...RecipientFilter],
	}));

	if ((RecipientFilter.ClearRecipients() !== RecipientFilter) || (RecipientFilter.RecipientLength !== 0) || (RecipientFilter.RecipientIndexes !== vecRecipientIndexReference)) {
		throw new Error("Recipient clear did not preserve the empty stable array.");
	}
};

g_InspectRecipientLifecycle();
```

Flags are live JavaScript state and can also be changed by explicit `UpdateRecipients()` options:

```js
const { BaseRecipientFilter } = require("filters/recipients");
const { LogInfo } = require("loggers");

const g_InspectRecipientFlags = () => {
	const RecipientFilter = BaseRecipientFilter.CreateRecipientFilterFromNativeInfo({ RecipientIndexes: [], InitializationMessage: true, Reliable: true });
	const vecCurrentRecipientIndexes = RecipientFilter.GetRecipientIndexes();
	if (RecipientFilter.UpdateRecipients(vecCurrentRecipientIndexes, { InitializationMessage: false, Reliable: false }) !== RecipientFilter) {
		throw new Error("Recipient update did not return the source filter.");
	}

	if (RecipientFilter.IsRecipientFilterInitializationMessage() || RecipientFilter.IsRecipientFilterReliable()) {
		throw new Error("Recipient update did not apply the delivery flags.");
	}

	LogInfo("RecipientFlags %s", JSON.stringify({ InitializationMessage: RecipientFilter.IsRecipientFilterInitializationMessage(), Reliable: RecipientFilter.IsRecipientFilterReliable() }));
};

g_InspectRecipientFlags();
```

Add or replace the current population explicitly:

```js
const { BaseRecipientFilter } = require("filters/recipients");
const { LogInfo } = require("loggers");

const g_InspectRecipientPopulationReplacement = () => {
	const RecipientFilter = new BaseRecipientFilter();
	if (RecipientFilter.AddAllPlayerRecipients(false) !== RecipientFilter) {
		throw new Error("AddAllPlayerRecipients did not return the source filter.");
	}

	LogInfo("RecipientPopulation HumanIndexes=%s", JSON.stringify(RecipientFilter.GetRecipientIndexes()));

	if (RecipientFilter.RemoveAllPlayerRecipients().AddAllPlayerRecipients(true) !== RecipientFilter) {
		throw new Error("Population replacement did not return the source filter.");
	}

	LogInfo("RecipientPopulation AllIndexes=%s", JSON.stringify(RecipientFilter.GetRecipientIndexes()));
};

g_InspectRecipientPopulationReplacement();
```

## `RecipientFilter`

### Constructor

```text
new RecipientFilter(...vecRecipientSourceFilters)
```

A final plain/null-prototype object without own `Index`, `RecipientIndexes`, or `Symbol.iterator` is parsed as options, not a source; even an empty object matches. The subclass stores the remaining sources by reference in `RecipientSourceFilters`, then calls `UpdateRecipients()` immediately. With no sources, it selects all connected clients because `IncludeBots` defaults to `true`; `{ IncludeBots: false }` selects current humans. `Reliable` and `InitializationMessage` configure delivery flags.

When stored sources exist, calling `UpdateRecipients()` with no new source revalidates their indexes and drops clients that disconnected, but a captured group does not discover newly connected clients; pass a newly scanned group to discover them. Explicit one-call sources do not replace the stored source list. Mutating a stored array or consuming a stored single-use generator affects later updates. When the stored source list is empty, the same call performs a fresh all/human scan. `{ ClearRecipients: false }` appends instead of replacing; a one-call `IncludeBots` option controls that resolution without rewriting the stored default field.

`UpdateRecipients()` validates options and resolves every source into a temporary index list before changing its destination array or committing `Reliable` and `InitializationMessage` options. A validation or resolution exception propagates unchanged and does not itself clear the destination or commit those flags. This is not a rollback of caller-owned getter/iterator side effects, consumed generators, changing native connections, or a failing commit after direct replacement of writable fields.

```js
const { GetBotRecipients, GetHumanRecipients, RecipientFilter } = require("filters/recipients");
const { LogInfo } = require("loggers");

const g_InspectRecipientSources = () => {
	const RecipientFilterValue = new RecipientFilter(GetHumanRecipients(), { IncludeBots: false, Reliable: true });
	if (RecipientFilterValue.UpdateRecipients(GetBotRecipients(), { ClearRecipients: false, IncludeBots: true }) !== RecipientFilterValue) {
		throw new Error("Recipient source update did not return the source filter.");
	}

	LogInfo("RecipientSources %s", JSON.stringify({
		RecipientIndexes: RecipientFilterValue.GetRecipientIndexes(),
		Reliable: RecipientFilterValue.IsRecipientFilterReliable(),
		RecipientSourceFilterCount: RecipientFilterValue.RecipientSourceFilters.length,
	}));
};

g_InspectRecipientSources();
```

## Message delivery

Recipient filters can be passed to APIs that accept a SourceJS recipient-filter value. This example attempts `SayText2` delivery to living human clients through `SendUserMessage()` and checks the result; it must run in a SourceJS server context with the required message capability:

```js
const { GetAliveRecipients } = require("filters/recipients");
const { SayText2 } = require("messages");

const g_SendRoundLiveMessage = () => {
	const AliveRecipientFilter = GetAliveRecipients();
	if (AliveRecipientFilter.RecipientCount > 0) {
		const SayText2Message = new SayText2("The round is live.");
		if (!SayText2Message.SendUserMessage(AliveRecipientFilter)) {
			throw new Error("SayText2 delivery failed.");
		}
	}
};

g_SendRoundLiveMessage();
```

## Resolution and ownership

- Built-in mutators use in-place length/splice/push operations on the current `RecipientIndexes` array. They preserve that array's identity, not an unconditional lifetime guarantee after caller reassignment or replacement.
- `GetRecipientIndexes()` and `Slice()` copy stored entries; they do not rescan connections. `ResolveRecipientPlayers()` returns a new array of native live facades. A native group function returns a `RecipientFilter`, not an array.
- Native group wrappers retain their captured native index array as a stored source, while the mutable destination array is separate. They do not retain the native filter-info object or native client ownership.
- Construction, addition, merge, and population updates normalize through native current-client lookup. Local removal can purge a disconnected cached index. Malformed package recipient values fail validation; native lookups and capability checks may also fail.
- Filter objects and source arrays belong to one isolated plugin context. They do not cross the serialized plugin event bus as live objects.
- Rebuild or update recipients immediately before delivery when connection state matters. Index collections contain no client-generation or user-ID proof: a reused index can target a different client. Direct array edits bypass the normal validation and uniqueness path.

## Errors

The module throws for unsafe/non-positive input indexes, inherited input `Index` properties, malformed native info, unknown/non-boolean options (including hidden/symbol keys), non-boolean bot flags, non-string/non-integer or out-of-range team selectors, malformed value collections, missing required native player lookup, and native capability failures. Unrecognized string team selectors are not errors; see the unrestricted-scan behavior above. Option getters and source iterators can also throw; their errors propagate. Caller-edited stored arrays are not validated by every accessor.

The native human/all/bot/alive/dead/team recipient callbacks, both filter constructors, `ContainsRecipient()` and `ResolveRecipientPlayers()` translate C++ exceptions into JavaScript errors while retaining an existing selector or recipient-array getter exception. Failed construction does not publish a partial filter or player array. The native recipient-array decoder leaves its output unchanged when an element getter fails, including recipients accepted earlier in that array. Existing boolean, filtering and empty-result contracts remain unchanged. These guards do not keep client sessions alive or guarantee allocator/OOM recovery.

```js
const {
	BaseRecipientFilter,
	CreateRecipientFilterFromPlayer,
	CreateRecipientFilterFromValues,
} = require("filters/recipients");
const { LogInfo } = require("loggers");

const g_InspectRecipientErrors = () => {
	const vecInvalidRecipientOperations = [
		{ OperationName: "non-positive index", Operation: () => CreateRecipientFilterFromPlayer({ Index: 0 }) },
		{ OperationName: "non-boolean bot flag", Operation: () => CreateRecipientFilterFromValues([1], "yes") },
		{ OperationName: "non-boolean reliable flag", Operation: () => new BaseRecipientFilter([], { Reliable: 1 }) },
		{ OperationName: "malformed native indexes", Operation: () => BaseRecipientFilter.CreateRecipientFilterFromNativeInfo({ RecipientIndexes: "1,2" }) },
	];
	for (const { OperationName: strOperationName, Operation } of vecInvalidRecipientOperations) {
		let CaughtTypeError = null;

		try {
			Operation();
		} catch (OperationError) {
			CaughtTypeError = OperationError;
		}

		if (!(CaughtTypeError instanceof TypeError)) {
			throw new Error(`${strOperationName} did not throw TypeError.`);
		}

		LogInfo("RecipientValidation Operation=%s Error=%s", strOperationName, CaughtTypeError.message);
	}
};

g_InspectRecipientErrors();
```
