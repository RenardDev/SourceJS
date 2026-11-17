# `require("core/cache")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`CachedProperty`](#cachedproperty)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/core/cache.js`](../../packages/sourcejs/core/cache.js). It stores property results on the receiving object under a symbol unique to each `CachedProperty` instance. Function wrappers store one result per object/function receiver in a `WeakMap`; arguments are not part of the cache key. Use it when a computed result should be reused until explicit invalidation. Cached objects are returned by reference, not copied or frozen, so their contents can still change.

## Import

```js
const { CachedProperty, CacheFunctionResult, ClearCachedProperty } = require("core/cache");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`MODULE_NAME`](#module_name) | Constant | JavaScript module name (`"core/cache"`). |
| [`CachedProperty`](#cachedproperty-1) | Class | `new CachedProperty(Getter, Options = {})` |
| [`CacheFunctionResult`](#cachefunctionresult) | Function | `CacheFunctionResult(Callback)` |
| [`ClearAllCachedProperties`](#clearallcachedproperties) | Function | `ClearAllCachedProperties(Instance)` |
| [`ClearCachedProperty`](#clearcachedproperty) | Function | `ClearCachedProperty(Instance, PropertyValue)` |
| [`ClearFunctionCaches`](#clearfunctioncaches) | Function | `ClearFunctionCaches()` |
| [`CreateCachedProperty`](#createcachedproperty) | Function | `CreateCachedProperty(TargetOrGetter, PropertyKey = null, Descriptor = null)`; the decorator form also accepts a symbol property name. |

## `CachedProperty`

### Options

| Option | Signature |
| --- | --- |
| `Name` | Property name, or `null` to infer it from the getter name. |
| `CacheKey` | Description used for the cache symbol, or `null` to use the resolved property name, falling back to `"CachedProperty"`. The description does not share a cache with another property instance. |
| `Enumerable` | Whether the installed property is enumerable; defaults to `false`. |
| `Configurable` | Whether the installed property is configurable; defaults to `true`. |

### Members

| Member | Signature |
| --- | --- |
| `Getter` | Writable property containing the getter evaluated with the instance as `this`. |
| `Name` | Writable property containing the property name inferred from options or the getter. |
| `CacheKey` | Writable property containing the symbol used to store the cached value on an instance. |
| `Enumerable` | Writable property used by `GetPropertyDescriptor()`. |
| `Configurable` | Writable property used by `GetPropertyDescriptor()`. |
| `GetCachedValue` | `GetCachedValue(Instance)` |
| `ClearCachedValue` | `ClearCachedValue(Instance)` |
| `GetPropertyDescriptor` | `GetPropertyDescriptor()` |
| `InstallCachedProperty` | `InstallCachedProperty(Target, PropertyKey = undefined)`; accepts a non-empty string or symbol, defaults to `Name`, and returns this `CachedProperty`. |
| `WrapPropertyDescriptor` | Static `WrapPropertyDescriptor(PropertyDescriptor, Options = {})`; creates a `CachedProperty` from the descriptor getter and the supplied options, not from the descriptor flags. |

## Examples

### `CachedProperty`

```js
const { CachedProperty } = require("core/cache");

class MapConfiguration {
	constructor(mapValues) {
		this.Values = mapValues;
	}
}

function GetConfigurationSummary() {
	return `${this.Values.size} configuration overrides`;
}

const g_SummaryCachedProperty = new CachedProperty(GetConfigurationSummary, { Name: "Summary", Enumerable: true });
g_SummaryCachedProperty.InstallCachedProperty(MapConfiguration.prototype);

const g_MapConfigurationInstance = new MapConfiguration(new Map([
	["sv_gravity", "800"],
	["sv_alltalk", "0"],
]));
console.log(g_MapConfigurationInstance.Summary);
```

### `CreateCachedProperty`

```js
const { CreateCachedProperty } = require("core/cache");

class PluginRecord {
	constructor(strName) {
		this.Name = strName;
	}
}

function GetNormalizedPluginName() {
	return this.Name.trim().toLowerCase();
}

const g_NormalizedNameCachedProperty = CreateCachedProperty(GetNormalizedPluginName, "NormalizedName");
g_NormalizedNameCachedProperty.InstallCachedProperty(PluginRecord.prototype);

const g_PluginRecordInstance = new PluginRecord("  Match Stats  ");
console.log(g_PluginRecordInstance.NormalizedName);
```

The three-argument form can wrap an existing getter descriptor, which is useful for decorator-compatible code:

```js
const { CreateCachedProperty } = require("core/cache");

class PlayerLabel {
	constructor(unClientIndex, strName) {
		this.ClientIndex = unClientIndex;
		this.Name = strName;
	}

	get DisplayName() {
		return `#${this.ClientIndex} ${this.Name}`;
	}
}

const g_DisplayNameDescriptor = Object.getOwnPropertyDescriptor(PlayerLabel.prototype, "DisplayName");
const g_CachedDisplayNameDescriptor = CreateCachedProperty(PlayerLabel.prototype, "DisplayName", g_DisplayNameDescriptor);
Object.defineProperty(PlayerLabel.prototype, "DisplayName", g_CachedDisplayNameDescriptor);
```

### `CacheFunctionResult`

```js
const { CacheFunctionResult } = require("core/cache");

function GetPlayerSummary() {
	return `${this.Name}: ${this.Kills} kills`;
}

const g_BuildPlayerSummary = CacheFunctionResult(GetPlayerSummary);
const g_RoundStatistics = { Name: "Ren", Kills: 7 };
const g_strFirstSummary = g_BuildPlayerSummary.call(g_RoundStatistics);

g_RoundStatistics.Kills = 8;

const g_strCachedSummary = g_BuildPlayerSummary.call(g_RoundStatistics);
console.log(g_strFirstSummary === g_strCachedSummary);
```

### `ClearAllCachedProperties`

```js
const { CachedProperty, ClearAllCachedProperties } = require("core/cache");

const g_PlayerState = { Name: "Ren", Kills: 4 };

function GetPlayerLabel() {
	return `${this.Name}: ${this.Kills}`;
}

function GetPlayerScore() {
	return this.Kills * 10;
}

const g_LabelCachedProperty = new CachedProperty(GetPlayerLabel);
const g_ScoreCachedProperty = new CachedProperty(GetPlayerScore);

g_LabelCachedProperty.GetCachedValue(g_PlayerState);
g_ScoreCachedProperty.GetCachedValue(g_PlayerState);

g_PlayerState.Kills = 5;

const g_unCacheDeletionCount = ClearAllCachedProperties(g_PlayerState);
console.log(`Successful cache deletions (including absent keys): ${g_unCacheDeletionCount}; score is now ${g_ScoreCachedProperty.GetCachedValue(g_PlayerState)}.`);
```

### `ClearCachedProperty`

```js
const { CachedProperty, ClearCachedProperty } = require("core/cache");

const g_MapState = { Name: "c1m1_hotel" };

function GetUppercaseMapName() {
	return this.Name.toUpperCase();
}

const g_UppercaseNameCachedProperty = new CachedProperty(GetUppercaseMapName);
console.log(g_UppercaseNameCachedProperty.GetCachedValue(g_MapState));

g_MapState.Name = "c1m2_streets";

if (!ClearCachedProperty(g_MapState, g_UppercaseNameCachedProperty)) {
	throw new Error("Unable to clear the cached uppercase map name.");
}

console.log(g_UppercaseNameCachedProperty.GetCachedValue(g_MapState));
```

### `ClearFunctionCaches`

```js
const { CacheFunctionResult, ClearFunctionCaches } = require("core/cache");

let g_unCalculationCount = 0;

function GetTeamScore() {
	++g_unCalculationCount;

	return this.SurvivorScore + this.InfectedScore;
}

const g_CalculateTeamScore = CacheFunctionResult(GetTeamScore);
const g_TeamScores = { SurvivorScore: 620, InfectedScore: 280 };
g_CalculateTeamScore.call(g_TeamScores);
g_CalculateTeamScore.call(g_TeamScores);

const g_unClearedFunctionCacheCount = ClearFunctionCaches();
if (g_unClearedFunctionCacheCount < 1) {
	throw new Error("No function cache state was cleared.");
}

g_CalculateTeamScore.call(g_TeamScores);

console.log(`Score was calculated ${g_unCalculationCount} times.`);
```

### `MODULE_NAME`

```js
const { MODULE_NAME } = require("core/cache");

console.log(`Cache helpers loaded from ${MODULE_NAME}.`);
```

### `CachedProperty.ClearCachedValue`

```js
const { CachedProperty } = require("core/cache");

const g_NumericState = { Value: 10 };

function GetDoubledValue() {
	return this.Value * 2;
}

const g_DoubledValueCachedProperty = new CachedProperty(GetDoubledValue);
console.log(g_DoubledValueCachedProperty.GetCachedValue(g_NumericState));

g_NumericState.Value = 20;

if (!g_DoubledValueCachedProperty.ClearCachedValue(g_NumericState)) {
	throw new Error("Unable to clear the cached doubled value.");
}

console.log(g_DoubledValueCachedProperty.GetCachedValue(g_NumericState));
```

### `CachedProperty.GetPropertyDescriptor`

```js
const { CachedProperty } = require("core/cache");

function GetPlayerSummary() {
	return `${this.Players.length} connected players`;
}

const g_PlayerSummaryCachedProperty = new CachedProperty(GetPlayerSummary, { Enumerable: true });
const g_ServerState = { Players: [1, 2, 3] };
Object.defineProperty(g_ServerState, "Summary", g_PlayerSummaryCachedProperty.GetPropertyDescriptor());

console.log(Object.keys(g_ServerState).includes("Summary"));
console.log(g_ServerState.Summary);
```

### `CachedProperty.GetCachedValue`

```js
const { CachedProperty } = require("core/cache");

let g_unReadCount = 0;

function GetPlayerName() {
	++g_unReadCount;

	return this.Name;
}

const g_PlayerNameCachedProperty = new CachedProperty(GetPlayerName);
const g_PlayerState = { Name: "Ren" };
g_PlayerNameCachedProperty.GetCachedValue(g_PlayerState);
g_PlayerNameCachedProperty.GetCachedValue(g_PlayerState);

console.log(`Backing getter reads: ${g_unReadCount}`);
```

### `CachedProperty.Getter`

```js
const { CachedProperty } = require("core/cache");

function GetNormalizedMapName() {
	return this.Name.toLowerCase();
}

const g_NormalizedMapNameCachedProperty = new CachedProperty(GetNormalizedMapName);
const g_MapState = { Name: "C1M1_HOTEL" };
console.log(g_NormalizedMapNameCachedProperty.Getter.call(g_MapState));
```

### `CachedProperty.InstallCachedProperty`

```js
const { CachedProperty } = require("core/cache");

class RoundResult {
	constructor(unSurvivorScore, unInfectedScore) {
		this.SurvivorScore = unSurvivorScore;
		this.InfectedScore = unInfectedScore;
	}
}

function GetTotalRoundScore() {
	return this.SurvivorScore + this.InfectedScore;
}

const g_TotalScoreCachedProperty = new CachedProperty(GetTotalRoundScore, { Name: "TotalScore" });
g_TotalScoreCachedProperty.InstallCachedProperty(RoundResult.prototype);

console.log(new RoundResult(620, 280).TotalScore);
```

### `CachedProperty.WrapPropertyDescriptor`

```js
const { CachedProperty } = require("core/cache");

class TeamState {
	constructor(vecPlayers) {
		this.Players = vecPlayers;
	}

	get PlayerCount() {
		return this.Players.length;
	}
}

const g_OriginalDescriptor = Object.getOwnPropertyDescriptor(TeamState.prototype, "PlayerCount");
const g_PlayerCountCachedProperty = CachedProperty.WrapPropertyDescriptor(g_OriginalDescriptor, { Name: "PlayerCount" });
g_PlayerCountCachedProperty.InstallCachedProperty(TeamState.prototype);

console.log(new TeamState([1, 2, 3, 4]).PlayerCount);
```

### `CachedProperty` metadata

```js
const { CachedProperty } = require("core/cache");

function GetSummaryValue() {
	return this.Value;
}

const g_SummaryCachedProperty = new CachedProperty(GetSummaryValue, { Name: "Summary", Enumerable: true, Configurable: false });
console.log({ Name: g_SummaryCachedProperty.Name, CacheKeyType: typeof g_SummaryCachedProperty.CacheKey, Enumerable: g_SummaryCachedProperty.Enumerable, Configurable: g_SummaryCachedProperty.Configurable });
```

## Safe use

- Cached properties reuse the stored result until cleared; object results are shared references and can still be mutated. Invalidate the relevant cache immediately after changing any source field used by its getter.
- `CacheFunctionResult()` caches one result per receiver and does not include call arguments in the cache key. Do not use it for argument-dependent results unless the first result is intentionally reused.
- `ClearFunctionCaches()` resets every function cache created by this module, not only one wrapper.
- `ClearAllCachedProperties()` returns the number of successful cache-key deletions across registered `CachedProperty` instances. Deleting an absent key also succeeds; the count does not measure previously stored values. An exception interrupts the operation without rolling back earlier deletions.
- Passing a `CachedProperty` to `ClearCachedProperty()` clears its cache symbol. Passing a string or symbol deletes that direct property key instead; deleting the installed getter name does not clear its separate cached result. Cache symbols are discoverable object keys, not a privacy boundary.
- The module retains registered `CachedProperty` instances and function-cache state for its lifetime. Clearing cached results does not unregister those definitions. Create and reuse cache definitions deliberately; do not create new ones on every frame.
- `CachedProperty` exposes writable `Getter`, `Name`, `CacheKey`, `Enumerable`, and `Configurable` properties. Configure new instances through constructor options and prefer its public methods instead of mutating metadata after installation.

## Related files

- [`packages/sourcejs/core/cache.js`](../../packages/sourcejs/core/cache.js) contains the implementation documented here.
- [`core.md`](core.md) documents the aggregate core API and lifecycle helpers.
- [`packages/sourcejs/core.js`](../../packages/sourcejs/core.js) contains the surrounding core package implementation.
