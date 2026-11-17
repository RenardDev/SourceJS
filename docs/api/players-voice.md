# `require("players/voice")`

> AI processing note: this page documents direct `IVoiceServer` control and the listener-aware mute manager. Keep receiver/sender argument order explicit in every integration.

The `players/voice` module controls whether one client receives another client's voice, optionally controls engine proximity processing, and maintains persistent scoped mutes through a real Detours pre-hook on `IVoiceServer::SetClientListening()`.

The public implementation lives in [`packages/sourcejs/players/voice.js`](../../packages/sourcejs/players/voice.js). Direct operations call the selected SDK's `IVoiceServer`; mute state is plugin-context JavaScript state enforced whenever the engine tries to change listening again.

## Contents

- [Import](#import)
- [Direct Voice Control](#direct-voice-control)
- [Voice Server Wrapper](#voice-server-wrapper)
- [Hook Ownership](#hook-ownership)
- [Global Mute Manager](#global-mute-manager)
- [Custom Mute Managers](#custom-mute-managers)
- [MuteManager API](#mutemanager-api)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

| Export | Kind | Purpose |
| --- | --- | --- |
| `VoiceServer` | live property | Return a current native voice-server wrapper with BigInt interface/vtable addresses and direct methods on each property read. |
| `GetClientListening(ReceiverReference, SenderReference)` | function | Query whether `ReceiverReference` currently hears `SenderReference`. |
| `SetClientListening(ReceiverReference, SenderReference, bListen = true)` | function | Change the pair while respecting every active SourceJS mute manager. |
| `SetClientProximity(ReceiverReference, SenderReference, bUseProximity = true)` | function | Toggle the selected SDK's proximity processing for the pair. |
| `GetSetClientListeningHookOptions()` | function | Return a fresh ABI definition for `IVoiceServer::SetClientListening()`. |
| `HookSetClientListening()` | function | Install or return the module-owned Detours hook handle. |
| `MuteManager` | class | Own an independent scoped-mute map and disconnect listener. |
| `MUTE_MANAGER` | singleton | Shared mute manager used by decorated `Player.Mute()` methods. |

Both receiver and sender may be one-based indexes or live player-like objects accepted by `players/helpers.GetPlayerIndex()`.

## Direct Voice Control

The argument order is always `(ReceiverReference, SenderReference)`: the first player hears or does not hear the second player. Root functions validate slot numbers through `GetPlayerIndex()` and `GetMaximumClients()`; this is not a connection/lifetime check. The example adds a positive Int32 and strict connection precondition, then passes numeric indices instead of repeatedly reading caller-owned player records.

```js
const { Player } = require("players/entity");
const g_VoiceModule = require("players/voice");
const {
	GetClientListening,
	SetClientListening,
	SetClientProximity,
} = g_VoiceModule;

function RequireConnectedVoicePlayer(unPlayerIndex) {
	const unMaximumPlayerIndex = 2147483647;

	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > unMaximumPlayerIndex)) {
		throw new TypeError("unPlayerIndex must be a positive Int32.");
	}

	const CurrentPlayer = Player(unPlayerIndex);
	if ((CurrentPlayer === null) || (typeof CurrentPlayer !== "object") || Array.isArray(CurrentPlayer)) {
		throw new TypeError(`Player ${unPlayerIndex} did not return a player record.`);
	}

	const unResolvedPlayerIndex = CurrentPlayer.Index;
	if (unResolvedPlayerIndex !== unPlayerIndex) {
		throw new Error(`Player ${unPlayerIndex} returned a different index.`);
	}

	const IsConnected = CurrentPlayer.IsConnected;
	if (typeof IsConnected !== "function") {
		throw new TypeError(`Player ${unPlayerIndex} requires IsConnected().`);
	}

	const bConnected = IsConnected.call(CurrentPlayer);
	if (typeof bConnected !== "boolean") {
		throw new TypeError(`Player ${unPlayerIndex} returned an invalid connection status.`);
	}

	if (!bConnected) {
		throw new Error(`Player ${unPlayerIndex} is not connected.`);
	}

	return true;
}

function RequireConnectedVoicePair(unReceiverIndex, unSenderIndex) {
	RequireConnectedVoicePlayer(unReceiverIndex);
	RequireConnectedVoicePlayer(unSenderIndex);
}

function InspectVoicePair(unReceiverIndex, unSenderIndex) {
	RequireConnectedVoicePair(unReceiverIndex, unSenderIndex);
	const VoiceServer = g_VoiceModule.VoiceServer;
	const bListening = GetClientListening(unReceiverIndex, unSenderIndex);
	const bServerListening = VoiceServer.GetClientListening(unReceiverIndex, unSenderIndex);

	if ((typeof bListening !== "boolean") || (typeof bServerListening !== "boolean") || (bServerListening !== bListening)) {
		throw new Error(`Voice queries disagree or return invalid states for ${unReceiverIndex}<-${unSenderIndex}.`);
	}

	return {
		GetListeningIndex: VoiceServer.GetClientListeningIndex,
		GetListeningAddress: VoiceServer.GetClientListeningAddress,
		Listening: bListening,
		ReceiverIndex: unReceiverIndex,
		SenderIndex: unSenderIndex,
		SetListeningIndex: VoiceServer.SetClientListeningIndex,
		SetListeningAddress: VoiceServer.SetClientListeningAddress,
		SetProximityIndex: VoiceServer.SetClientProximityIndex,
		SetProximityAddress: VoiceServer.SetClientProximityAddress,
		VoiceServerAddress: VoiceServer.Address,
	};
}

function SetVoicePairListening(unReceiverIndex, unSenderIndex, bListen) {
	if (typeof bListen !== "boolean") {
		throw new TypeError("bListen must be a boolean.");
	}

	RequireConnectedVoicePair(unReceiverIndex, unSenderIndex);
	const bPrevious = GetClientListening(unReceiverIndex, unSenderIndex);
	if (typeof bPrevious !== "boolean") {
		throw new TypeError("GetClientListening() must return a boolean.");
	}

	if (SetClientListening(unReceiverIndex, unSenderIndex, bListen) !== true) {
		throw new Error(`Failed to update voice pair ${unReceiverIndex}<-${unSenderIndex}.`);
	}

	return bPrevious;
}

function SetVoicePairProximity(unReceiverIndex, unSenderIndex, bUseProximity) {
	if (typeof bUseProximity !== "boolean") {
		throw new TypeError("bUseProximity must be a boolean.");
	}

	RequireConnectedVoicePair(unReceiverIndex, unSenderIndex);
	if (SetClientProximity(unReceiverIndex, unSenderIndex, bUseProximity) !== true) {
		throw new Error(`Failed to update voice proximity ${unReceiverIndex}<-${unSenderIndex}.`);
	}

	return true;
}

function SetVoiceServerListening(unReceiverIndex, unSenderIndex, bListen) {
	if (typeof bListen !== "boolean") {
		throw new TypeError("bListen must be a boolean.");
	}

	RequireConnectedVoicePair(unReceiverIndex, unSenderIndex);
	const VoiceServer = g_VoiceModule.VoiceServer;
	const bPrevious = VoiceServer.GetClientListening(unReceiverIndex, unSenderIndex);
	if (typeof bPrevious !== "boolean") {
		throw new TypeError("VoiceServer.GetClientListening() must return a boolean.");
	}

	if (VoiceServer.SetClientListening(unReceiverIndex, unSenderIndex, bListen) !== true) {
		throw new Error(`IVoiceServer rejected voice pair ${unReceiverIndex}<-${unSenderIndex}.`);
	}

	return bPrevious;
}

function SetVoiceServerProximity(unReceiverIndex, unSenderIndex, bUseProximity) {
	if (typeof bUseProximity !== "boolean") {
		throw new TypeError("bUseProximity must be a boolean.");
	}

	RequireConnectedVoicePair(unReceiverIndex, unSenderIndex);
	const VoiceServer = g_VoiceModule.VoiceServer;
	if (VoiceServer.SetClientProximity(unReceiverIndex, unSenderIndex, bUseProximity) !== true) {
		throw new Error(`IVoiceServer rejected proximity pair ${unReceiverIndex}<-${unSenderIndex}.`);
	}

	return true;
}

module.exports = {
	InspectVoicePair,
	SetVoicePairListening,
	SetVoicePairProximity,
	SetVoiceServerListening,
	SetVoiceServerProximity,
};
```

`SetClientProximity()` is exposed by the JavaScript module on every build, but the native call throws when the selected SDK's `IVoiceServer` does not implement that method. SourceJS does not emulate proximity.

`SetVoicePairListening()` returns the previous listening value so the owner can restore it. There is no native proximity getter, so a plugin must treat `SetVoicePairProximity()` as an explicit game-state action rather than inventing a previous value.

## Voice Server Wrapper

Each `VoiceServer` property read creates a current direct wrapper around the selected SDK interface. Address fields are BigInt snapshots (`0n` when the interface is unavailable, and for the optional proximity method when absent); they borrow the engine interface and loaded binaries rather than owning them. Re-read the property when obtaining current addresses, and do not retain them beyond those native lifetimes. Wrapper methods resolve the current native interface on each call; editing `Address` does not rebind them. Metadata and methods are own data properties; construction does not invoke inherited setters. The proximity slot index is platform metadata, not a capability promise; an absent SDK method is not dereferenced to obtain its address.

| Member | Result | Purpose |
| --- | --- | --- |
| `Address` | `bigint` | Current `IVoiceServer*` address. |
| `GetClientListeningIndex` | number | Selected platform's `GetClientListening` vtable index. |
| `SetClientListeningIndex` | number | Selected platform's `SetClientListening` vtable index. |
| `SetClientProximityIndex` | number | Selected platform's `SetClientProximity` vtable index. |
| `GetClientListeningAddress` | `bigint` | Current `GetClientListening` function address. |
| `SetClientListeningAddress` | `bigint` | Current `SetClientListening` function address. |
| `SetClientProximityAddress` | `bigint` | Current `SetClientProximity` function address. |
| `GetClientListening(nReceiverIndex, nSenderIndex)` | `boolean` | Resolve the indexes and query the directed pair through `IVoiceServer`. |
| `SetClientListening(nReceiverIndex, nSenderIndex, bListen?)` | `boolean` | Resolve the indexes and call `IVoiceServer::SetClientListening()` directly. |
| `SetClientProximity(nReceiverIndex, nSenderIndex, bUseProximity?)` | `boolean` | Resolve the indexes and call the selected SDK's proximity method directly or throw when absent. |

The direct wrapper methods accept indexes or index-bearing objects, perform native argument/interface checks, but do not run the JavaScript pre-check in the root `SetClientListening()` function. Setter booleans are checked before reading either player index. An `Index` getter failure propagates its original exception before index-range validation or engine calls; receiver failure stops before reading the sender. Omitting a native wrapper's boolean means `true`, but explicitly passing `undefined` is rejected; root JavaScript setters also apply their `true` default to explicit `undefined`. An installed mute-manager Detours hook still enforces its owned pairs at the engine function.

## Hook Ownership

`GetSetClientListeningHookOptions()` returns the direct function-hook definition:

| Field | Value |
| --- | --- |
| `Address` | BigInt address of the selected platform's `SetClientListening` vtable function; pass unchanged, never through `Number()` |
| `Convention` | `"thiscall"` |
| `Arguments` | `["address", "int", "int", "bool"]` for `this`, receiver, sender, and listen; the native `CreateFunctionHook()` field, not `ArgumentTypes` |
| `ReturnType` | `"bool"` |

`HookSetClientListening()` calls native `CreateFunctionHook()` and memoizes its handle inside the module context, registering the mute-enforcement pre callback once. It captures the required boolean `Created` metadata separately from the editable handle. A reused record (`Created: false`) is borrowed: failed registration does not remove it, and successful voice cleanup removes only the voice callback and forgets the borrowed handle. Existing callbacks belonging to other users remain installed.

For a newly created record, failed callback registration attempts removal. If removal also fails, an `AggregateError` reports the registration error followed by the cleanup error, and the module retains the handle for a `MUTE_MANAGER.Unload()` retry when no other mute manager remains active. A cached hook can retry callback registration after partial cleanup. Remove mute state through manager lifecycle instead of calling `Hook.Remove()` behind the module's cache.

`Created` is a creation snapshot, not an ownership lease. A voice-created record must remain exclusive, or its final whole-record removal must be coordinated with every later subscriber; adding foreign callbacks after voice creates it is not made safe by that flag. A borrowed record is never removed by voice cleanup. Context teardown still follows the native hook manager's ownership rules.

The named `Unload()` callback below is for the owner of the entire context/shared manager, not a library borrowing someone else's mutes. A manual call can return `false` or throw; retain the owner and retry while its context is live. The current runtime continues context teardown after an unload callback returns or throws: neither `false` nor an exception cancels native unloading. Complete required mute cleanup before requesting context destruction. Merely reading hook options does not install anything.

The runtime dispatches the case-sensitive `Load`/`Unload` exports. Export those PascalCase properties directly, without lowercase aliases. This does not rename the public `MuteManager.Unload()` method.

```js
const {
	MUTE_MANAGER,
	HookSetClientListening,
	GetSetClientListeningHookOptions,
} = require("players/voice");

function Load() {
	const Options = GetSetClientListeningHookOptions();
	const Hook = HookSetClientListening();

	return {
		Arguments: Options.Arguments,
		Convention: Options.Convention,
		ID: Hook.ID,
		Address: Hook.Address,
		ReturnType: Options.ReturnType,
		TrampolineAddress: Hook.TrampolineAddress,
	};
}

function Unload() {
	return MUTE_MANAGER.Unload();
}

module.exports = { Load, Unload };
```

## Global Mute Manager

`MUTE_MANAGER` is the context-local manager used by `Player.Mute()`, `Player.Unmute()`, and `Player.IsMuted()`. A `null` receiver set means every slot from `1` through the current `players.GetMaximumClients()`; pass one receiver or an array for a scoped mute.

```js
const { Player } = require("players/entity");
const { MUTE_MANAGER } = require("players/voice");

function ResolveMutePlayers(unSenderIndex, vecReceiverIndexes) {
	if (!Array.isArray(vecReceiverIndexes) || (vecReceiverIndexes.length === 0)) {
		throw new TypeError("vecReceiverIndexes must be a non-empty array.");
	}

	const Sender = Player(unSenderIndex);
	const vecReceivers = vecReceiverIndexes.map((unReceiverIndex) => Player(unReceiverIndex));
	if (!Sender.IsConnected() || vecReceivers.some((Receiver) => !Receiver.IsConnected())) {
		throw new Error("Every mute participant must be connected.");
	}

	return { Receivers: vecReceivers, Sender };
}

function MuteForReceivers(unSenderIndex, vecReceiverIndexes) {
	const { Receivers: vecReceivers, Sender } = ResolveMutePlayers(unSenderIndex, vecReceiverIndexes);
	if (MUTE_MANAGER.MutePlayer(Sender, vecReceivers) !== true) {
		throw new Error(`Failed to mute sender ${unSenderIndex}.`);
	}

	return {
		AllSelectedMuted: MUTE_MANAGER.IsMuted(Sender, vecReceivers),
		FirstReceiverMuted: MUTE_MANAGER.IsMutedForReceiver(Sender, vecReceivers[0]),
	};
}

function UnmuteForReceivers(unSenderIndex, vecReceiverIndexes) {
	const { Receivers: vecReceivers, Sender } = ResolveMutePlayers(unSenderIndex, vecReceiverIndexes);

	return MUTE_MANAGER.UnmutePlayer(Sender, vecReceivers);
}

function Unload() {
	return MUTE_MANAGER.Unload();
}

module.exports = { MuteForReceivers, Unload, UnmuteForReceivers };
```

When the engine later calls `SetClientListening(ReceiverReference, SenderReference, true)`, the pre-hook changes only the final `bListen` argument to `false` for a muted pair. It does not skip the original function or replace its return value.

## Custom Mute Managers

Multiple managers may coexist. A pair remains muted while any active manager owns it; clearing one manager does not override another manager's mute.

```js
const { Player } = require("players/entity");
const { MuteManager } = require("players/voice");

let g_bLoaded = false;
let g_Manager = null;

function Load() {
	if (g_bLoaded) {
		throw new Error("The custom mute manager is already loaded.");
	}

	g_bLoaded = true;

	return true;
}

function MuteScoped(unSenderIndex, vecReceiverIndexes) {
	if (!g_bLoaded) {
		throw new Error("The custom mute manager is not loaded.");
	}

	if (!Array.isArray(vecReceiverIndexes) || (vecReceiverIndexes.length === 0)) {
		throw new TypeError("vecReceiverIndexes must be a non-empty array.");
	}

	const Sender = Player(unSenderIndex);
	const vecReceiverPlayers = vecReceiverIndexes.map((unReceiverIndex) => Player(unReceiverIndex));
	if (!Sender.IsConnected() || vecReceiverPlayers.some((Receiver) => !Receiver.IsConnected())) {
		throw new Error("Every custom-mute participant must be connected.");
	}

	if (g_Manager === null) {
		g_Manager = new MuteManager();
	}

	const vecReceivers = g_Manager.GetReceiverIndexes(vecReceiverPlayers);
	if ((g_Manager.MutePlayer(Sender, vecReceivers) !== true) || (g_Manager.ApplyMuteState(vecReceivers) !== true)) {
		throw new Error(`Failed to apply the custom mute for sender ${unSenderIndex}.`);
	}

	const setFirstReceiverSenders = g_Manager.GetMutedSenderIndexes(vecReceivers[0]);

	return {
		FirstReceiverSenders: [...setFirstReceiverSenders],
		MutedForFirst: g_Manager.IsMutedForReceiver(Sender, vecReceivers[0]),
		Receivers: vecReceivers,
	};
}

function ClearMutes() {
	return (g_Manager !== null) && g_Manager.ClearMuteState();
}

function Unload() {
	if (!g_bLoaded) {
		return false;
	}

	if (g_Manager !== null) {
		const bUnloaded = g_Manager.Unload();
		if (typeof bUnloaded !== "boolean") {
			throw new TypeError("MuteManager.Unload() must return a boolean.");
		}

		if (!bUnloaded) {
			return false;
		}
	}

	g_Manager = null;
	g_bLoaded = false;

	return true;
}

module.exports = { ClearMutes, Load, MuteScoped, Unload };
```

`GetMutedSenderIndexes(ReceiverReference)` returns the manager's mutable sender `Set` for that receiver and creates it when absent. Reading/creating this set does not activate the manager, install a hook/listener, or update native listening. Use `MutePlayer()`/`UnmutePlayer()` for managed mutation; changing the public map/set or `DisconnectCallback` directly can violate cleanup/enforcement invariants.

The example constructs its manager lazily on the first mute attempt. Calling the `Load` then `Unload` exports without a mute needs no hook/listener. A failed/throwing manual unload keeps the instance and loaded flag for retry while the context remains live; it never drops its only cleanup reference. This does not cancel host-initiated context destruction.

## MuteManager API

| Member | Result | Purpose |
| --- | --- | --- |
| `MutedSenderIndexesByReceiver` | `Map<number, Set<number>>` | Current receiver-to-sender ownership map. |
| `DisconnectCallback` | function or `null` | Registered disconnect callback while this manager is active. |
| `GetReceiverIndexes(ReceiverReferences = null)` | number array | Normalize all slots, one receiver, or an array to validated indexes. |
| `GetMutedSenderIndexes(ReceiverReference)` | sender `Set` | Return/create the sender set owned for one receiver. |
| `EnsureDisconnectListener()` | `undefined` | Exposed implementation helper: register this manager's disconnect callback if absent; does not activate hook enforcement. Prefer `MutePlayer()` for complete ownership. |
| `IsMutedForReceiver(SenderReference, ReceiverReference)` | `boolean` | Test one directed pair in this manager. |
| `MutePlayer(SenderReference, ReceiverReferences = null)` | `true` | Set native listening false, register enforcement/listener ownership, then commit directed pairs after success. |
| `UnmutePlayer(SenderReference, ReceiverReferences = null)` | `true` | Remove directed pairs and restore listening only when no manager still owns them. |
| `IsMuted(SenderReference, ReceiverReferences = null)` | `boolean` | Return true only when this manager mutes the sender for every selected receiver. |
| `ApplyMuteState(ReceiverReferences = null)` | `true` | Reapply false to all stored pairs for selected receivers. |
| `ClearMuteState()` | `true` | Remove all owned pairs and restore each pair unless another manager still mutes it. |
| `Unload()` | `boolean` | Clear mute state, unregister the disconnect listener, remove this manager from the active set, then remove the module callback/hook when the active set is empty; `false`/exceptions can leave pending cleanup. |

On disconnect, the manager removes its ownership of every pair involving the departing slot before making native calls. It then tries to restore listening for each remaining receiver that has no other mute owner. A native failure is logged and does not restore the old mute or prevent cleanup of other pairs. This prevents the hook from enforcing the old mute against a replacement player; it does not guarantee that a rejected native write took effect. Explicit `UnmutePlayer()` remains transactional for live connections.

## Errors

- Always read `(ReceiverReference, SenderReference)` as "receiver hears sender"; reversing the arguments changes a different directed pair.
- Pass booleans to direct setters. Numeric truthy/falsy values are rejected instead of coerced.
- Receiver and sender values must resolve to indexes from `1` through the current `players.GetMaximumClients()`.
- Native interface failures and unsupported proximity calls throw directly. SourceJS does not substitute a voice server or proximity implementation.
- Native voice methods and the `VoiceServer` property callback catch C++ exceptions and attempt to raise JavaScript errors without replacing an existing player-index getter exception. Construction failures do not publish a partial wrapper; these guards do not guarantee Error-object allocation, termination recovery or allocator/OOM recovery, or keep SDK interfaces and addresses alive.
- Do not call `RemoveAll()` from `memory/hooks` for voice cleanup; it would remove hooks owned by unrelated subsystems.
- A live mute always wins over a direct `SetClientListening(..., true)` request.
- Treat `VoiceServer` and hook addresses as BigInts valid only for the loaded engine/server binaries; do not convert them to `Number()` or infer optional-method support from a slot index.

## Lifecycle

`MutePlayer()` installs the shared Detours pre-hook and disconnect listener on first successful use, including an empty receiver array. `GetReceiverIndexes(null)` enumerates every slot through `GetMaximumClients()`, including empty/disconnected slots; arrays preserve order/duplicates. `ApplyMuteState()` preserves repeated native calls but deduplicates ownership-release steps for repeated receiver/sender pairs during rollback. `IsMuted()` with an empty receiver list returns `true` vacuously, not proof of any stored pair.

Unmute/clear requests `true` when no active manager still owns the pair; it does not restore the listening value from before the original mute. Changing all slots may therefore alter game-managed listening state. Mute/apply/unmute/clear attempt rollback after native failures; successful rollback rethrows the original value, while rollback failures produce `AggregateError` with the operation error first. Do not assume perfect atomicity or guaranteed recovery.

Use `try/finally` or the plugin's current `Unload` export to release temporary mutes. Call `Unload()` on every custom manager that installed mute state; unload the shared manager only when its owning plugin context is destroyed. Keep a failed manager reference and retry before requesting native unloading; unregister/hook removal can return `false` after mute state was already cleared, but the runtime does not preserve a context because its unload callback failed. With no active managers and no hook, even an unused/already-unloaded manager returns `false`. A successfully unloaded manager can be used again; it is not permanently disposed.

All SDK operations, mutation, disconnect handling, and hook callbacks belong on the game thread with initialized interfaces; do not call them from request workers. Player indices can be reused, and connection checks do not pin native lifetime. Use a controlled phase without disconnect/map transitions or reentrant hooks invalidating participants between validation and mutation. Separate voice queries are not a synchronized snapshot.

The direct listening setter has no automatic rollback. Preserve `GetClientListening()` when a temporary change must be restored. Proximity has no getter, so the owning plugin must define its desired final state explicitly.

## Related Modules

- [`players/entity`](players-entity.md) exposes `Mute()`, `Unmute()` and `IsMuted()` instance methods backed by `MUTE_MANAGER`.
- [`players/helpers`](players-helpers.md) defines the player/index conversions accepted by this module.
- [`listeners`](listeners.md) owns the disconnect listener manager used to clean reused slots.
- [`memory/hooks`](memory-hooks.md) documents the Detours function-hook and trampoline surface used internally.
