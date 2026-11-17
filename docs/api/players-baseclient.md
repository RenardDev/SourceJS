# `require("players/baseclient")`

> AI processing note: this page documents an internal ABI-backed live memory type. Read the profile, address, and
> lifecycle sections together before using it.

The `players/baseclient` module builds an ABI-backed `CBaseClient` memory type from branch-specific GameData. It is intended for
operations exposed by the engine's internal client vtable but not by a stable public SDK interface. The packaged profiles
define the native `SetName` virtual-function descriptor where its index is known. Obtain it on a live instance and call
`BaseClient.SetName.Call(strName)`; it is a `MemberFunction` object, not a directly callable JavaScript function. The packaged
CSGO profile omits `ReturnType`, so the manager uses `void` and the call returns `undefined`, not a success boolean.
Overridden profiles must declare the matching native return ABI; never change it merely to obtain a status.

The facade lives in [`packages/sourcejs/players/baseclient.js`](../../packages/sourcejs/players/baseclient.js). It uses
[`memory/gamedata`](memory-gamedata.md) to select and merge `client/CBaseClient.ini`,
[`memory/manager`](memory-manager.md) to compile the type, and [`memory.MakeObject`](memory.md) to attach that type to an
existing BigInt address.

There is no empty fallback type. Check `HasBaseClientGameData()` first when a plugin supports several SDK branches. Presence does not
prove that a profile is valid or matches the running binary.
`CreateBaseClientType()`, `GetBaseClientType()`, and `CreateBaseClientFromAddress()` throw `ReferenceError` when the selected branch has no
`CBaseClient` profile.

## Contents

- [Import](#import)
- [API](#api)
- [Profile discovery](#profile-discovery)
- [Type creation](#type-creation)
- [Wrapping a live client](#wrapping-a-live-client)
- [Cache lifecycle](#cache-lifecycle)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	ClearBaseClientCache,
	CreateBaseClientType,
	CreateBaseClientFromAddress,
	GetBaseClientGameDataPaths,
	GetBaseClientType,
	HasBaseClientGameData,
	LoadBaseClientGameData,
} = require("players/baseclient");

const g_vecBaseClientFunctions = [
	ClearBaseClientCache,
	CreateBaseClientType,
	CreateBaseClientFromAddress,
	GetBaseClientGameDataPaths,
	GetBaseClientType,
	HasBaseClientGameData,
	LoadBaseClientGameData,
];
for (const BaseClientFunction of g_vecBaseClientFunctions) {
	if (typeof BaseClientFunction !== "function") {
		throw new Error("players/baseclient does not expose its complete API.");
	}
}
```

## API

| Export | Result | Purpose |
| --- | --- | --- |
| `ClearBaseClientCache()` | `true` | Clear the type and shared GameData caches. |
| `CreateBaseClientType(strSDKBranch = undefined, BaseType = CustomType)` | constructor | Compile the selected profile. |
| `CreateBaseClientFromAddress(unBaseClientAddress, strSDKBranch = undefined)` | `BaseClient` | Attach the cached type to a BigInt `CBaseClient*` address. |
| `GetBaseClientGameDataPaths(strSDKBranch = undefined)` | string array | Return candidate profile paths. |
| `GetBaseClientType(strSDKBranch = undefined)` | constructor | Reuse or create the branch-specific type. |
| `HasBaseClientGameData(strSDKBranch = undefined)` | boolean | Test whether a profile exists. |
| `LoadBaseClientGameData(strSDKBranch = undefined)` | object | Return the live cached profile object. |

An omitted `strSDKBranch` selects the running SDK branch. Candidate paths are returned in merge order and may include files
that do not exist. `CreateBaseClientFromAddress()` allocates no native client storage and does not own the native client.
It delegates to `memory.MakeObject()`, which also accepts an address-backed object. For live client use, supply a positive
BigInt address from the matching owner; successful address normalization is not proof of a valid native object.

## Profile discovery

Inspect the selected branch before touching internal client memory:

```js
const { BRANCH } = require("memory/manager");
const {
	GetBaseClientGameDataPaths,
	HasBaseClientGameData,
	LoadBaseClientGameData,
} = require("players/baseclient");

const g_vecBaseClientGameDataPaths = GetBaseClientGameDataPaths();
const g_bBaseClientGameDataAvailable = HasBaseClientGameData();

if ((typeof BRANCH !== "string") || (BRANCH.length === 0)) {
	throw new Error("The selected SDK branch is invalid.");
}

if (!Array.isArray(g_vecBaseClientGameDataPaths) || (typeof g_bBaseClientGameDataAvailable !== "boolean")) {
	throw new Error("The selected CBaseClient profile metadata is invalid.");
}

for (const strGameDataPath of g_vecBaseClientGameDataPaths) {
	if ((typeof strGameDataPath !== "string") || (strGameDataPath.length === 0)) {
		throw new Error("A CBaseClient GameData path is invalid.");
	}
}

if (g_bBaseClientGameDataAvailable) {
	const BaseClientGameData = LoadBaseClientGameData();
	if ((BaseClientGameData === null) || (typeof BaseClientGameData !== "object") || Array.isArray(BaseClientGameData)) {
		throw new Error(`The ${BRANCH} CBaseClient profile is invalid.`);
	}

	if ((BaseClientGameData.VirtualFunction === null) || (typeof BaseClientGameData.VirtualFunction !== "object") || Array.isArray(BaseClientGameData.VirtualFunction)) {
		throw new Error(`The ${BRANCH} CBaseClient profile has no virtual-function definition.`);
	}
}
```

An explicit branch is useful for tooling and profile inspection. Do not use a constructor created for one branch with a
server binary from another branch.

```js
const { BRANCH } = require("memory/manager");
const {
	GetBaseClientGameDataPaths,
	HasBaseClientGameData,
	LoadBaseClientGameData,
} = require("players/baseclient");

function InspectBaseClientSDKBranch(strSDKBranch) {
	const vecBaseClientGameDataPaths = GetBaseClientGameDataPaths(strSDKBranch);
	const BaseClientGameData = HasBaseClientGameData(strSDKBranch) ? LoadBaseClientGameData(strSDKBranch) : null;
	if (!Array.isArray(vecBaseClientGameDataPaths)) {
		throw new Error(`Invalid CBaseClient profile paths for ${strSDKBranch}.`);
	}

	if ((BaseClientGameData !== null) && ((typeof BaseClientGameData !== "object") || Array.isArray(BaseClientGameData))) {
		throw new Error(`Invalid CBaseClient profile data for ${strSDKBranch}.`);
	}

	return { BaseClientGameData, BaseClientGameDataPaths: vecBaseClientGameDataPaths };
}

InspectBaseClientSDKBranch(BRANCH);

module.exports = { InspectBaseClientSDKBranch };
```

## Type creation

`GetBaseClientType()` is the ordinary entry point. Calls for the same branch return the same constructor until
`ClearBaseClientCache()` or an explicit `CreateBaseClientType()` replaces it.

```js
const { GetBaseClientType, HasBaseClientGameData } = require("players/baseclient");

if (HasBaseClientGameData()) {
	const BaseClientType = GetBaseClientType();
	const SameBaseClientType = GetBaseClientType();
	const vecBaseClientMethodNames = Object.getOwnPropertyNames(BaseClientType.prototype);

	if ((BaseClientType !== SameBaseClientType) || (typeof BaseClientType !== "function")) {
		throw new Error("GetBaseClientType() did not retain the generated CBaseClient type.");
	}

	const SetNameDescriptor = Object.getOwnPropertyDescriptor(BaseClientType.prototype, "SetName");
	if (!vecBaseClientMethodNames.includes("SetName") || !SetNameDescriptor || (typeof SetNameDescriptor.get !== "function")) {
		throw new Error("The generated CBaseClient type does not expose its SetName accessor.");
	}
}
```

Pass a `CustomType` subclass when the plugin needs additional JavaScript behavior around the generated native methods:

```js
const { CustomType } = require("memory/manager");
const { CreateBaseClientType, HasBaseClientGameData } = require("players/baseclient");

class NamedClient extends CustomType {
	Rename(strClientName) {
		return this.SetName.Call(strClientName);
	}
}

const g_NamedBaseClientType = HasBaseClientGameData() ? CreateBaseClientType(undefined, NamedClient) : null;
if (g_NamedBaseClientType !== null) {
	if (!(g_NamedBaseClientType.prototype instanceof NamedClient)) {
		throw new Error("CreateBaseClientType() did not preserve the custom base class.");
	}

	const SetNameDescriptor = Object.getOwnPropertyDescriptor(g_NamedBaseClientType.prototype, "SetName");
	if ((typeof g_NamedBaseClientType.prototype.Rename !== "function") || !SetNameDescriptor || (typeof SetNameDescriptor.get !== "function")) {
		throw new Error("The generated custom CBaseClient type is incomplete.");
	}
}
```

`CreateBaseClientType()` registers the result as `BaseClient` in the shared type manager. Creating another branch-specific
type replaces that registration and the module's one-entry constructor cache. Inspect its own property descriptor rather
than reading `BaseClientType.prototype.SetName`: that getter needs a live instance address and resolves the native vtable.

## Wrapping a live client

`IServer.GetClient(nClientIndex)` uses a zero-based server slot. A player entity index is one-based, so the corresponding
slot is `Player.Index - 1`. Run this example only on a controlled test server with exclusive control of the selected
client's name and lifetime; choosing the first connected player is not a production selection policy. The sample checks
observable name readback, not a return-status boolean.

```js
const { GetServer } = require("engines/server");
const { GetAllPlayers } = require("players");
const { CreateBaseClientFromAddress, HasBaseClientGameData } = require("players/baseclient");

let g_ConnectedPlayer = null;
for (const CandidatePlayer of GetAllPlayers()) {
	if (CandidatePlayer.IsConnected()) {
		g_ConnectedPlayer = CandidatePlayer;
		break;
	}
}

if (g_ConnectedPlayer && HasBaseClientGameData()) {
	const Server = GetServer();
	if (!Server || (typeof Server.GetClient !== "function")) {
		throw new Error("The live server interface is unavailable.");
	}

	const nClientIndex = g_ConnectedPlayer.Index - 1;
	const ServerClient = Server.GetClient(nClientIndex);
	if (!ServerClient || (typeof ServerClient.Address !== "bigint") || (ServerClient.Address <= 0n) || (ServerClient.Index !== nClientIndex)) {
		throw new Error("The live server client has an invalid identity.");
	}

	const strPreviousClientName = ServerClient.Name;
	if (typeof strPreviousClientName !== "string") {
		throw new Error("The previous client name is not a string.");
	}

	const BaseClient = CreateBaseClientFromAddress(ServerClient.Address);
	if (!BaseClient || (BaseClient.Address !== ServerClient.Address)) {
		throw new Error("The live client view has an inconsistent address.");
	}

	const SetNameMember = BaseClient.SetName;
	if (!SetNameMember || (typeof SetNameMember.Call !== "function")) {
		throw new Error("The live client was wrapped without a valid SetName member.");
	}

	let bRenameFailed = false;
	let RenameErrorValue = null;

	try {
		SetNameMember.Call("SourceJS Guest");

		if (ServerClient.Name !== "SourceJS Guest") {
			throw new Error("The generated CBaseClient.SetName call did not apply the requested name.");
		}
	} catch (RenameError) {
		bRenameFailed = true;
		RenameErrorValue = RenameError;
		throw RenameError;
	} finally {
		try {
			SetNameMember.Call(strPreviousClientName);

			if (ServerClient.Name !== strPreviousClientName) {
				throw new Error("The original client name could not be restored.");
			}
		} catch (RenameRestorationError) {
			if (bRenameFailed) {
				throw new AggregateError([RenameErrorValue, RenameRestorationError], "Client rename and name restoration failed.");
			}

			throw RenameRestorationError;
		}
	}
}
```

The returned object is a non-owning live memory view. `CreateBaseClientFromAddress()` does not prove that an arbitrary BigInt is a
`CBaseClient*` address. Obtain the address from a live engine-owned `IClient` wrapper only after confirming that the selected
profile matches that binary's `IClient`/`CBaseClient` layout; this facade does not adjust base-subobject addresses or verify
vtable compatibility. Avoid awaiting or scheduling work between taking the address, mutating, and restoring the client.

## Cache lifecycle

Reload profile files before rebuilding the generated class:

```js
const {
	ClearBaseClientCache,
	GetBaseClientType,
	HasBaseClientGameData,
} = require("players/baseclient");

if (HasBaseClientGameData()) {
	const PreviousBaseClientType = GetBaseClientType();

	if (!ClearBaseClientCache()) {
		throw new Error("The CBaseClient caches could not be cleared.");
	}

	const ReloadedBaseClientType = GetBaseClientType();
	if (ReloadedBaseClientType === PreviousBaseClientType) {
		throw new Error("GetBaseClientType() reused the constructor after ClearBaseClientCache().");
	}
}
```

A plugin that owns explicit profile reload commands can expose deterministic cleanup through the runtime's case-sensitive `Unload` export:

```js
const { ClearBaseClientCache } = require("players/baseclient");

function Unload() {
	if (!ClearBaseClientCache()) {
		throw new Error("The CBaseClient caches could not be cleared during unload.");
	}
}

module.exports = { Unload };
```

`ClearBaseClientCache()` also clears the shared `memory/gamedata` cache, so other modules reload profile data on their next
GameData operation. Clearing this cache or replacing the registered type affects modules sharing the package instance, not separate plugin-context package caches.
Perform explicit reloads only where the caller owns that context's reload lifecycle. Neither operation validates existing borrowed clients.

## Errors

- Discovery/loading reject unsupported SDK branch names with `RangeError`; file presence alone does not validate definitions.
- `CreateBaseClientType()`, `GetBaseClientType()`, and `CreateBaseClientFromAddress()` throw `ReferenceError` when no profile exists.
- `CreateBaseClientFromAddress()` delegates address normalization to `memory.MakeObject()`: BigInt addresses and address-backed
  objects are supported. Nullish inputs normalize to `0n`; that is not a live client. Never treat normalization or wrapper
  creation as native memory, vtable, alignment, or lifetime validation.
- Invalid profile definitions and custom base classes throw from `Manager.CreateTypeFromObject()`.
- A well-formed BigInt address can still be stale or refer to the wrong ABI object; this module cannot prove native ownership.
- A virtual member getter needs a valid instance address. It is not safe to inspect an ABI accessor by evaluating it on the prototype.
- Virtual-call failures throw. The default `void` result is `undefined`, not `false`/success status. Readback can reveal a rejected or
  normalized name, but cannot prove call safety or undo a native side effect. If rename and restoration both throw, the sample
  retains both errors, including an original `null`, in `AggregateError.errors`.

## Lifecycle

- Treat `CBaseClient` as an internal ABI, not a stable VSP interface, and match its SDK branch to the running binary.
- Use only BigInt addresses obtained from live engine objects. Never retain a wrapped client across disconnect, map shutdown,
  plugin unload, or engine shutdown.
- `GetBaseClientType()` keeps one constructor keyed by the exact `strSDKBranch` argument. Switching between an omitted and an
  explicit branch rebuilds even when both resolve to the same SDK data. Changing `SOURCE_DATA_ROOT` or mutating a loaded profile does not rebuild that constructor; clear/recreate the type before using the new definitions.
- `ClearBaseClientCache()` forgets the local constructor and clears the shared `memory/gamedata` cache. It does not
  unregister the previous `BaseClient` from `TypeManager`; the next `CreateBaseClientType()` replaces that registration.
  Existing constructors and wrapped objects remain JavaScript values but are not made safe or invalidated.
- Keep custom classes derived from `CustomType` and let the manager install native fields and methods.
- Resolve and call native client members on the game thread only while the client remains connected and the ABI profile matches.
  Cleanup requires the same live owner; never attempt restoration through a stale address.

## Related modules

- [`memory/gamedata`](memory-gamedata.md) resolves and merges the branch-specific `CBaseClient.ini` profile.
- [`memory/manager`](memory-manager.md) compiles the profile into a registered `CustomType` constructor.
- [`memory`](memory.md) attaches that constructor to a BigInt address through `MakeObject()`.
- [`engines/server`](engines-server.md) provides the live `IClient` address and zero-based server slot.
- [`players`](players.md) resolves the corresponding one-based player entity and public player operations.
