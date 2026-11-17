# `require("interfaces")`

> AI navigation: use the contents to locate a responsibility, then review one bounded chunk at a time. This module exposes borrowed engine interface addresses; verify the exact interface name, selected-SDK layout, and ABI before using an address.

`interfaces` exposes the Source 1 interfaces that SourceJS successfully connected during VSP startup. It lives in `packages/sourcejs/interfaces.js` and exports the exact native object backed by `EngineInterfaces`.

The registry is deliberately narrower than a DLL-wide `CreateInterface` scan. It contains only successful connections requested by SourceJS from the engine and game-server factories, not every interface or GameData-derived address those libraries might expose. An interface unavailable on the selected SDK is not listed.

## Contents

- [Import and exports](#import-and-exports)
- [Interface names](#interface-names)
- [Interface records](#interface-records)
- [Strict lookup behavior](#strict-lookup-behavior)
- [Practical workflows](#practical-workflows)
- [Address and lifecycle safety](#address-and-lifecycle-safety)

## Import and exports

```js
const { GetAllInterfaceNames } = require("interfaces");
const { LogInfo } = require("loggers");

const g_ReportInterfaceNames = () => {
	function IsEngineInterfaceName(strInterfaceName) {
		return strInterfaceName.startsWith("VEngine");
	}

	function IsGameServerInterfaceName(strInterfaceName) {
		return strInterfaceName.startsWith("Server") || strInterfaceName.startsWith("Player");
	}

	const vecInterfaceNames = GetAllInterfaceNames();
	LogInfo("Connected interface inventory " + JSON.stringify({ EngineInterfaceNames: vecInterfaceNames.filter(IsEngineInterfaceName), GameServerInterfaceNames: vecInterfaceNames.filter(IsGameServerInterfaceName), InterfaceCount: vecInterfaceNames.length }));
};

g_ReportInterfaceNames();
```

| Export | Contract |
| --- | --- |
| `GetAllInterfaceNames()` | Returns a new array containing the exact names of currently connected interfaces. |
| `GetInterfaceRecord(strInterfaceName)` | Returns the exact connected interface record or `null` when that name was not loaded. |

The module has exactly two root names: `GetAllInterfaceNames` and `GetInterfaceRecord`. These are synchronous game-thread metadata APIs, not asynchronous request APIs. Neither operation loads a new engine interface or probes arbitrary shared libraries. `GetAllInterfaceNames()` needs no arguments; `GetInterfaceRecord()` needs the name argument. The native callbacks ignore extra arguments.

Examples send complete diagnostic strings through `loggers.LogInfo`. Hexadecimal address text is only a logging presentation; API record addresses remain `bigint` values.

## Interface names

`GetAllInterfaceNames()` returns a fresh array of strings, not interface records or a live registry view. Names preserve their first successful registration order; replacing an existing entry does not append its name again. Sorting, removing, or adding entries in the returned array does not change native connections. Typical selected-SDK results can include:

- `VEngineServer...`
- `GAMEEVENTSMANAGER...`
- `IEngineSoundServer...`
- `EngineTraceServer...`
- `VEngineServerStringTable...`
- `ServerGameDLL...`
- `VSERVERTOOLS...`
- `MDLCache...`
- `VFileSystem...`
- `ISERVERPLUGINHELPERS...`
- `VoiceServer...`
- `VPhysics...`
- `PlayerInfoManager...`
- `VEngineCvar...`

Exact suffixes are selected-SDK data. Do not hardcode a version copied from another game when the inventory can supply the running version:

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { LogInfo } = require("loggers");

const g_ReportEngineServerInterface = () => {
	function IsEngineServerInterfaceName(strInterfaceName) {
		return /^VEngineServer[0-9]+$/.test(strInterfaceName);
	}

	const strEngineServerInterfaceName = GetAllInterfaceNames().find(IsEngineServerInterfaceName);
	if (strEngineServerInterfaceName === undefined) {
		throw new Error("VEngineServer is not connected.");
	}

	const EngineServerInterfaceRecord = GetInterfaceRecord(strEngineServerInterfaceName);
	if (EngineServerInterfaceRecord === null) {
		throw new Error(`${strEngineServerInterfaceName} disappeared from the registry.`);
	}

	LogInfo("Connected engine server interface Name=" + JSON.stringify(EngineServerInterfaceRecord.Name));
};

g_ReportEngineServerInterface();
```

## Interface records

`GetInterfaceRecord(strInterfaceName)` returns `null` or one plain record:

| Property | Type | Contract |
| --- | --- | --- |
| `Name` | string | The exact registry key used for this lookup. |
| `Available` | boolean | Always `true` for a returned record; an unavailable name returns `null`. |
| `Address` | bigint | Non-zero native address of the interface object. |

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { LogInfo } = require("loggers");

const g_ReportFirstInterface = () => {
	const vecInterfaceNames = GetAllInterfaceNames();
	if (vecInterfaceNames.length === 0) {
		throw new Error("No SourceJS engine interfaces are connected.");
	}

	const InterfaceRecord = GetInterfaceRecord(vecInterfaceNames[0]);
	if (InterfaceRecord === null) {
		throw new Error(`${vecInterfaceNames[0]} disappeared from the registry.`);
	}

	LogInfo("Connected interface " + JSON.stringify({ Available: InterfaceRecord.Available, Address: "0x" + InterfaceRecord.Address.toString(16).toUpperCase(), Name: InterfaceRecord.Name }));
};

g_ReportFirstInterface();
```

Each successful `GetInterfaceRecord()` call creates a new plain JavaScript record with exactly `Name`, `Available`, and `Address` as its own data properties. Equal names resolve to equal addresses while their native registry entry is unchanged, even though the records are distinct objects. Records are mutable snapshots: editing or deleting their properties does not change the registry. Neither `Available` nor a saved `Address` updates after disconnect or replacement; a retained record does not keep its native object alive.

## Strict lookup behavior

`GetInterfaceRecord(strInterfaceName)` requires an actual non-empty JavaScript string. Numbers, booleans, objects (including boxed strings), `null`, `undefined`, and the empty string throw a JavaScript `Error` without coercion. A valid but unknown string returns `null`.

Lookup is case-sensitive and uses the complete UTF-8-encoded name, including embedded NUL bytes. It does not trim whitespace, truncate at NUL, or resolve just the preceding prefix. A name containing a NUL byte returns `null` unless that exact full encoded key is registered. Optional capability checks should distinguish a normal `null` miss from a thrown validation or native-operation error:

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { LogInfo } = require("loggers");

const g_ReportVoiceServerCapability = () => {
	function IsVoiceServerInterfaceName(strInterfaceName) {
		return strInterfaceName.startsWith("VoiceServer");
	}

	const strVoiceServerInterfaceName = GetAllInterfaceNames().find(IsVoiceServerInterfaceName);
	const UnknownInterfaceRecord = GetInterfaceRecord("SourceJSUnknownInterface999");
	let VoiceServerInterfaceRecord = null;
	if (strVoiceServerInterfaceName !== undefined) {
		VoiceServerInterfaceRecord = GetInterfaceRecord(strVoiceServerInterfaceName);
	}

	LogInfo("Interface capability " + JSON.stringify({ HasVoiceServerInterface: VoiceServerInterfaceRecord !== null, UnknownInterfaceRecord }));
};

g_ReportVoiceServerCapability();
```

Use `null` as the capability result. The `Available` property is not present on a missing record because no record exists.

## Practical workflows

### Require one interface with an actionable error

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { LogInfo } = require("loggers");

const g_ReportRequiredEventManagerInterface = () => {
	function RequireInterfaceRecord(strInterfaceName) {
		const EngineInterfaceRecord = GetInterfaceRecord(strInterfaceName);
		if (EngineInterfaceRecord === null) {
			throw new Error(`Required engine interface is unavailable: ${strInterfaceName}.`);
		}

		return EngineInterfaceRecord;
	}

	function IsEventManagerInterfaceName(strInterfaceName) {
		return strInterfaceName.startsWith("GAMEEVENTSMANAGER");
	}

	const strEventManagerInterfaceName = GetAllInterfaceNames().find(IsEventManagerInterfaceName);
	if (strEventManagerInterfaceName === undefined) {
		throw new Error("GAMEEVENTSMANAGER is not connected.");
	}

	const EventManagerInterfaceRecord = RequireInterfaceRecord(strEventManagerInterfaceName);
	LogInfo("Connected event manager interface Address=0x" + EventManagerInterfaceRecord.Address.toString(16).toUpperCase());
};

g_ReportRequiredEventManagerInterface();
```

This helper is appropriate only when the plugin genuinely cannot operate without that exact interface. Optional features should stay capability-gated.

### Group the current inventory by subsystem

```js
const { GetAllInterfaceNames } = require("interfaces");
const { LogInfo } = require("loggers");

const g_ReportInterfaceGroups = () => {
	const InterfaceGroups = { EngineInterfaceNames: [], GameServerInterfaceNames: [], OtherInterfaceNames: [] };
	for (const strInterfaceName of GetAllInterfaceNames()) {
		if (/^(VEngine|GAMEEVENT|IEngineSound|EngineTrace|VoiceServer)/.test(strInterfaceName)) {
			InterfaceGroups.EngineInterfaceNames.push(strInterfaceName);

		} else if (/^(ServerGameDLL|VSERVERTOOLS|PlayerInfoManager)/.test(strInterfaceName)) {
			InterfaceGroups.GameServerInterfaceNames.push(strInterfaceName);

		} else {
			InterfaceGroups.OtherInterfaceNames.push(strInterfaceName);
		}
	}

	LogInfo("Connected interface groups " + JSON.stringify(InterfaceGroups));
};

g_ReportInterfaceGroups();
```

### Select a loaded version by prefix

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { LogInfo } = require("loggers");

const g_ReportModelCacheInterface = () => {
	function GetInterfaceRecordByPrefix(strInterfaceNamePrefix) {
		function HasInterfaceNamePrefix(strInterfaceName) {
			return strInterfaceName.startsWith(strInterfaceNamePrefix);
		}

		const vecMatchingInterfaceNames = GetAllInterfaceNames().filter(HasInterfaceNamePrefix);
		if (vecMatchingInterfaceNames.length === 0) {
			return null;
		}

		if (vecMatchingInterfaceNames.length !== 1) {
			throw new Error(`Ambiguous interface prefix: ${strInterfaceNamePrefix}; Matches=${vecMatchingInterfaceNames.join(", ")}.`);
		}

		return GetInterfaceRecord(vecMatchingInterfaceNames[0]);
	}

	const ModelCacheInterfaceRecord = GetInterfaceRecordByPrefix("MDLCache");
	if (ModelCacheInterfaceRecord === null) {
		throw new Error("MDLCache is not connected.");
	}

	LogInfo("Connected model cache interface Address=0x" + ModelCacheInterfaceRecord.Address.toString(16).toUpperCase());
};

g_ReportModelCacheInterface();
```

This helper accepts exactly one matching loaded name and rejects ambiguity rather than choosing a lexicographically last version. A prefix can match unrelated families: for example, `VEngineServer` also prefixes `VEngineServerStringTable`; the earlier engine-server example requires a complete numeric-version name to avoid that collision. Prefix discovery neither negotiates a new `CreateInterface` version nor verifies ABI compatibility. Check the selected exact name against the SDK or GameData contract before using its address.

### Inspect the native virtual-table address

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { LogInfo } = require("loggers");
const { VirtualTable } = require("memory/helpers");

const g_ReportEventManagerVirtualTable = () => {
	function IsEventManagerInterfaceName(strInterfaceName) {
		return strInterfaceName.startsWith("GAMEEVENTSMANAGER");
	}

	const strEventManagerInterfaceName = GetAllInterfaceNames().find(IsEventManagerInterfaceName);
	if (strEventManagerInterfaceName === undefined) {
		throw new Error("GAMEEVENTSMANAGER is not connected.");
	}

	const EventManagerInterfaceRecord = GetInterfaceRecord(strEventManagerInterfaceName);
	if (EventManagerInterfaceRecord === null) {
		throw new Error(`${strEventManagerInterfaceName} disappeared from the registry.`);
	}

	const unVirtualTableAddress = VirtualTable(EventManagerInterfaceRecord.Address);
	if ((typeof unVirtualTableAddress !== "bigint") || (unVirtualTableAddress <= 0n)) {
		throw new Error(`Invalid virtual-table address: ${unVirtualTableAddress}.`);
	}

	LogInfo("Connected event manager interface Address=0x" + EventManagerInterfaceRecord.Address.toString(16).toUpperCase() + " VirtualTableAddress=0x" + unVirtualTableAddress.toString(16).toUpperCase());
};

g_ReportEventManagerVirtualTable();
```

Reading the virtual-table address is non-owning. Do not call or hook an entry until its exact selected-SDK index and ABI are verified. Use [`memory/hooks`](memory-hooks.md) for managed Detours hooks rather than writing the table directly.

## Address and lifecycle safety

- A returned `Address` is a JavaScript `bigint`, never a `Number`, string, or wrapper object.
- SourceJS owns no interface object. Never deallocate an interface address.
- Records are point-in-time JavaScript metadata. Call `GetInterfaceRecord()` again when you need a fresh record.
- Returned name arrays have own indexed data properties; records have own `Name`, `Available`, and `Address` data properties. Building these results does not invoke inherited setters.
- Native C++ exceptions are translated into JavaScript errors at the callback boundary, not reported as an ordinary `null` lookup miss.
- Call these synchronous metadata APIs on the game thread in the active SourceJS JavaScript context, never from request worker threads. They do not enqueue asynchronous requests, add locking for external callers, or extend native interface lifetimes.
- Interface addresses borrow objects owned by the engine or game server. Connectivity metadata does not prove an object's layout, memory safety, or lifetime. After disconnect, the native registry is cleared; while a JavaScript context remains callable, fresh queries see an empty array or `null`, not updated retained records. Do not use saved addresses across SourceJS unload, engine shutdown, or a plugin reload that discards the runtime.
- Prefer typed modules such as [`engines/server`](engines-server.md), [`events`](events.md), [`physics`](physics.md), [`cvars`](cvars.md), and [`filesystem`](filesystem.md). Raw addresses are for verified APIs not already exposed through a typed module.
