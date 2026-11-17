# `require("netchannel")`

> AI navigation: Read this API reference one section at a time and use the contents below to open only the contract needed for the current task.

> Warning: this module invokes live, non-owning Source networking objects. Validate each BigInt address and unsigned 32-bit transfer ID at its ABI boundary, keep wrappers inside the owning connection or hook lifetime, and call message processing or raw transport methods only when the protocol contract requires it.

The `netchannel` module exposes non-owning wrappers around live Source 1 `INetChannelInfo`, `INetChannel`, `INetChannelHandler`, and `INetMessage` objects associated with connected clients. It is intended for transport diagnostics, packet-history inspection, file transfer, raw bit-buffer delivery, and low-level detours that receive an engine-owned network-message address.

The implementation lives in [`packages/sourcejs/netchannel.js`](../../packages/sourcejs/netchannel.js) and calls the selected HL2SDK branch directly through V8. Related APIs are documented in [`bitbuffers`](bitbuffers.md), [`memory`](memory.md), and [`memory/hooks`](memory-hooks.md). The engine and lifetime boundaries are described in [Architecture](../architecture.md).

These operations run synchronously on the game thread. The wrappers do not provide worker requests, `Options`, or completion callbacks, and engine-owned objects must not be accessed from a worker thread. `SendNetChannelFile()` returns the native send status, `DenyNetChannelFile()` returns `true` after the void SDK denial call, and `RequestNetChannelFile()` returns the engine-assigned transfer ID. None is a transfer-completion notification.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Lifetime and addresses](#lifetime-and-addresses)
- [Flows](#flows)
- [`NetChannelInfo`](#netchannelinfo)
- [`NetChannel`](#netchannel)
- [`NetChannelHandler`](#netchannelhandler)
- [`NetMessage`](#netmessage)
- [Examples](#examples)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	NET_FLOW,
	NetChannel,
	NetChannelHandler,
	NetChannelInfo,
	NetMessage,
	GetPlayerNetChannel,
	GetPlayerNetChannelInfo,
} = require("netchannel");

const g_vecNetChannelClasses = [NetChannel, NetChannelHandler, NetChannelInfo, NetMessage];
const g_bHasInvalidNetChannelClass = g_vecNetChannelClasses.some((NetChannelClass) => typeof NetChannelClass !== "function");
const g_bCanGetPlayerNetChannel = typeof GetPlayerNetChannel === "function";
const g_bCanGetPlayerNetChannelInfo = typeof GetPlayerNetChannelInfo === "function";

if (g_bHasInvalidNetChannelClass || !g_bCanGetPlayerNetChannel || !g_bCanGetPlayerNetChannelInfo) {
	throw new Error("The netchannel module did not expose every documented callable.");
}

const g_bHasNetFlowConstants = (NET_FLOW !== null) && (typeof NET_FLOW === "object") && Object.isFrozen(NET_FLOW);
if (!g_bHasNetFlowConstants) {
	throw new Error("The netchannel module did not expose the frozen NET_FLOW namespace.");
}

const g_vecNetFlowValues = [NET_FLOW.Outgoing, NET_FLOW.Incoming, NET_FLOW.InOut];
const g_bHasInvalidNetFlowValue = g_vecNetFlowValues.some((nFlowValue) => !Number.isSafeInteger(nFlowValue));
const g_bHasDistinctNetFlowValues = new Set(g_vecNetFlowValues).size === g_vecNetFlowValues.length;
if (g_bHasInvalidNetFlowValue || !g_bHasDistinctNetFlowValues) {
	throw new Error("NET_FLOW did not expose three distinct native flow identifiers.");
}
```

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `NET_FLOW` | Frozen constant object | Native flow identifiers: `Outgoing`, `Incoming`, and the `InOut` sentinel. |
| [`NetChannel`](#netchannel) | Class | Live `INetChannel` view with inherited information and transport operations. |
| [`NetChannelHandler`](#netchannelhandler) | Class | Opaque view of the channel's `INetChannelHandler`, backed by a BigInt address. |
| [`NetChannelInfo`](#netchannelinfo) | Class | Live `INetChannelInfo` view for one connected player or known BigInt engine address. |
| [`NetMessage`](#netmessage) | Class | Live `INetMessage` view created from a BigInt address supplied by a detour or extension. |
| `GetPlayerNetChannel(unPlayerIndex)` | Function | Returns a live `NetChannel`, or `null` when the player has no channel. |
| `GetPlayerNetChannelInfo(unPlayerIndex)` | Function | Returns a live `NetChannelInfo`, or `null` when the player has no channel information. |

## Lifetime and addresses

All `unAddress` arguments and `Address` fields are positive JavaScript `bigint` values that contain native addresses. The JavaScript factories check positivity only; native calls also require a losslessly representable address for the current architecture. A valid numeric representation is not proof of a live object, readable memory, or the correct vtable. Strings such as `"0x1234"` are rejected. `NetChannel.CreateNetChannelFromAddress(unAddress)`, `NetChannelInfo.CreateNetChannelInfoFromAddress(unAddress)`, `NetChannelHandler.CreateNetChannelHandlerFromAddress(unAddress)`, and `NetMessage.CreateNetMessageFromAddress(unAddress)` never scan memory and never prove that an arbitrary address has the requested C++ type; use them only with the exact engine-owned address supplied by an interface, a validated detour argument, or another SourceJS object.

All four classes also inherit `CreateFromAddress(unAddress)` for `memory.MakeObject()` integration. That generic factory expects the same positive BigInt address and has the same non-validating lifetime contract; normal application code should prefer the class-specific factory whose name preserves the expected native type.

Channel and message wrappers do not own native objects. Disconnecting a player, changing a map, unloading the engine object, or returning from a callback that owns a temporary message can invalidate a wrapper. Resolve the player again instead of retaining wrappers across those boundaries.

`GetPlayerNetChannelInfo(unPlayerIndex)` and `GetPlayerNetChannel(unPlayerIndex)` are the nullable lookups for a valid player index. `NetChannelInfo.GetRequiredPlayerNetChannelInfo(unPlayerIndex)` requires a live information object and throws when none exists. `NetChannel.GetPlayerNetChannel(unPlayerIndex)` is nullable. Every native-backed `NetChannelInfo` getter reads the engine again and does not retain a cached copy. Separate reads are not an atomic snapshot; the returned statistics records and primitive values are snapshots, not live views of those values. `DataRate` is the only writable native-backed information property and writes directly through to the channel.

The native `DataRate` property setter converts the assigned value to a finite native float before reading the receiver's `Address`. Numeric conversion may execute JavaScript, so no native channel is borrowed across that conversion. Conversion errors and throwing address getters stop the native write and retain the original JavaScript exception. This ordering does not validate object liveness or permit retargeting an existing wrapper.

`Address` and `PlayerIndex` are ordinary JavaScript fields set when a wrapper is constructed, not native getters or setters. Do not overwrite them to retarget a live view; construct a new wrapper from the validated address or resolve the player again. Changing `PlayerIndex` does not change the native object addressed by the wrapper.

## Flows

| Constant | Meaning |
| --- | --- |
| `NET_FLOW.Outgoing` | Packets sent by the server through the channel. |
| `NET_FLOW.Incoming` | Packets received by the server through the channel. |
| `NET_FLOW.InOut` | Native `MAX_FLOWS` sentinel. It is not accepted by per-flow methods. |

Every public wrapper method that accepts `nFlow` requires it explicitly. Passing `undefined` or any value other than `NET_FLOW.Outgoing` or `NET_FLOW.Incoming`, including `NET_FLOW.InOut`, throws.

Module loading throws `TypeError` if the native flow record is missing, malformed, or does not contain three distinct safe-integer `Outgoing`, `Incoming`, and `InOut` values. Obsolete uppercase property names are not accepted as aliases.

## `NetChannelInfo`

### Properties

| Property | Type | Behavior |
| --- | --- | --- |
| `Address` | `bigint` | BigInt address of the `INetChannelInfo*` used by the wrapper. |
| `PlayerIndex` | `number` | Player index recorded when the wrapper came from a player lookup, otherwise `0`. |
| `Name` | `string` | Current channel name. |
| `RemoteAddress` | `string` | Current remote endpoint reported by the engine. |
| `Time` | `number` | Current channel time in seconds. |
| `TimeConnected` | `number` | Current connection age in seconds. |
| `TimeSinceLastReceived` | `number` | Seconds since the last received packet. |
| `BufferSize` | `number` | Current engine channel buffer size. |
| `DataRate` | `number` | Live integer byte rate per second from `INetChannelInfo::GetDataRate()`; assignment invokes `INetChannel::SetDataRate(float)`. |
| `NetworkChannelAddress` | `bigint` | BigInt `INetChannel*` address for the same engine object. |
| [`NetChannel`](#netchannel) | `NetChannel` | Returns a new non-owning wrapper for the associated native `INetChannel*` on each read. |
| `TimeoutSeconds` | `number` | Current timeout threshold; omitted on SDK branches without this interface method. |

### Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `NetChannelInfo.GetRequiredPlayerNetChannelInfo(unPlayerIndex)` | `NetChannelInfo` | Requires live information for the player. |
| `NetChannelInfo.CreateNetChannelInfoFromAddress(unAddress)` | `NetChannelInfo` | Wraps a positive BigInt address as a non-owning `INetChannelInfo` view; it does not verify the native object type. |
| `IsNetChannelLoopback()` | `boolean` | Reads `INetChannelInfo::IsLoopback()`. |
| `IsNetChannelTimingOut()` | `boolean` | Reads `INetChannelInfo::IsTimingOut()`. |
| `IsNetChannelPlayback()` | `boolean` | Reads `INetChannelInfo::IsPlayback()`. |
| `GetNetChannelLatency(nFlow)` | `number` | Returns current one-way latency for the selected flow. |
| `GetNetChannelAverageLatency(nFlow)` | `number` | Returns smoothed latency. |
| `GetNetChannelAveragePacketLoss(nFlow)` | `number` | Returns the smoothed packet-loss ratio. |
| `GetNetChannelAverageChoke(nFlow)` | `number` | Returns the smoothed choke ratio. |
| `GetNetChannelAverageDataRate(nFlow)` | `number` | Returns the average data rate for the flow. |
| `GetNetChannelAveragePacketRate(nFlow)` | `number` | Returns the average packet rate for the flow. |
| `GetNetChannelTotalDataBytes(nFlow)` | `number` | Returns total bytes recorded for the flow. |
| `GetNetChannelTotalPacketCount(nFlow)` | `number` | Returns total packets recorded for the flow; omitted when the selected SDK lacks `GetTotalPackets()`. |
| `GetNetChannelSequenceNumber(nFlow)` | `number` | Returns the current packet sequence number. |
| `IsNetChannelPacketValid(nFlow, nFrameNumber?)` | `boolean` | Tests a packet-history frame. Omission, `undefined`, or `null` uses the current sequence. |
| `GetNetChannelPacketTime(nFlow, nFrameNumber?)` | `number` | Returns the packet timestamp. Omission, `undefined`, or `null` uses the current sequence. |
| `GetNetChannelPacketByteCount(nFlow, nFrameNumber?, nPacketGroup = 0)` | `number` | Returns bytes attributed to one packet and message group. An omitted/nullish frame uses the current sequence; an omitted/nullish group uses `INetChannelInfo::GENERIC` (`0` on the selected SDK). The group must be in the selected SDK's range from `INetChannelInfo::GENERIC` through `INetChannelInfo::TOTAL - 1`; `TOTAL` is not a group. |
| `GetNetChannelStreamProgress(nFlow)` | `object` | Returns `{ Active, ReceivedByteCount, TotalByteCount }` for the reliable stream. |
| `GetNetChannelRemoteFrameRate()` | `object` | Returns `{ FrameTime, FrameTimeStandardDeviation }`; CSGO, BLADE, and MCV builds also include `FrameStartTimeStandardDeviation`. Other branches omit that field. |
| `GetNetChannelCommandInterpolationAmount(nFlow, nFrameNumber?)` | `number` | Returns command interpolation for a packet. Available only when the selected SDK exposes `GetCommandInterpolationAmount`. |
| `GetNetChannelPacketResponseLatency(nFlow, nFrameNumber?)` | `object` | Returns `{ LatencyMilliseconds, Choke }`. Available only when the selected SDK exposes `GetPacketResponseLatency`. |

Capability methods are absent from the prototype when the selected SDK does not declare the corresponding C++ method. Check with `typeof NetChannelInfo.prototype.GetNetChannelTotalPacketCount === "function"`; there are no JavaScript fallback values.

## `NetChannel`

`NetChannel` extends `NetChannelInfo`, so every property and method above is also available on a channel.

| Member | Result | Behavior |
| --- | --- | --- |
| `NetChannel.GetPlayerNetChannel(unPlayerIndex)` | `NetChannel \| null` | Resolves the player's current channel. |
| `NetChannel.CreateNetChannelFromAddress(unAddress)` | `NetChannel` | Wraps a positive BigInt address as a non-owning `INetChannel` view; it does not verify the native object type. |
| `MessageHandler` | `NetChannelHandler \| null` | Reads and wraps the current `INetChannelHandler*`. |
| `SetNetChannelDataRate(flDataRate)` | `boolean` | Passes a finite native float to the void SDK setter and returns `true` after invocation; this does not promise an exact read-back value. |
| `SendNetChannelFile(strFilePath, unTransferID, bIsReplayDemoFile = false)` | `boolean` | Begins an outgoing file transfer using an unsigned transfer ID. |
| `DenyNetChannelFile(strFilePath, unTransferID, bIsReplayDemoFile = false)` | `boolean` | Denies a file transfer. |
| `RequestNetChannelFile(strFilePath, bIsReplayDemoFile = false)` | `number` | Requests a file and returns the engine-assigned unsigned transfer ID. |
| `SendNetChannelData(MessageBuffer, bReliableDelivery = true)` | `boolean` | Sends raw bytes or the written portion of a `BitBufferWrite`. |

`strFilePath` is an engine transfer path, not a filesystem read performed by SourceJS. Validate untrusted paths before passing them to the engine, including rejecting embedded NUL characters (the SDK receives a C string). A transfer ID belongs to the corresponding engine request and must not be guessed or reused accidentally. On SDK branches without replay overloads, passing `true` for `bIsReplayDemoFile` throws; ordinary `false` remains portable.

`SendNetChannelData()` accepts `ArrayBuffer`, typed-array bytes, a `BitBufferWrite`, or a compatible object containing `Bytes` and `WrittenBitCount`. The call is synchronous: native code copies the payload before returning. Use explicit byte storage such as `Uint8Array` for binary data: the shared native conversion turns ordinary numeric arrays into UTF-8 comma-separated text, not those byte values.

Buffer bit counts must be signed 32-bit integer Numbers when present; nullish counts are treated as absent. The first property checked is `WrittenBitCount` for `SendNetChannelData()`, `DataBitCount` for `ReadNetMessageFromBuffer()`, and `MaximumBitCount` for `WriteNetMessageToBuffer()`. While the selected count remains negative, conversion checks `DataBitCount`, `MaximumBitCount`, then `WrittenBitCount` in that order; count getters may therefore run more than once. A remaining negative count or one above byte capacity becomes the full byte capacity, not an error. An oversized nonnegative count does not try lower-priority fields. Supply stable, explicit in-range counts when only part of a buffer is valid.

Native send/read/write buffers use zero-padded, aligned 32-bit storage required by the SDK. Padding does not extend the logical bit count, and serialized `Bytes` retain the original byte capacity. Empty input has zero logical capacity. Buffers too large for the SDK's signed bit capacity after word alignment are rejected before native processing.

## `NetChannelHandler`

`NetChannelHandler.CreateNetChannelHandlerFromAddress(unAddress)` wraps a positive BigInt address as an opaque non-owning view, and `Address` returns that BigInt address. SourceJS does not invent methods absent from the public HL2SDK interface. The reliable way to obtain the wrapper is `Channel.MessageHandler`; read its `Address` field when the address is required. Do not reinterpret a symbol or signature result as a handler.

## `NetMessage`

`NetMessage` is a low-level view over an existing `INetMessage*`. SourceJS does not enumerate arbitrary messages or allocate engine subclasses. Obtain the positive BigInt address from a detour or extension callback whose ABI explicitly supplies `INetMessage*`, and keep the wrapper inside that callback's valid lifetime.

| Member | Type or result | Behavior |
| --- | --- | --- |
| `NetMessage.CreateNetMessageFromAddress(unAddress)` | `NetMessage` | Wraps a positive BigInt address as a non-owning view; it does not verify the native object type. |
| `Address` | `bigint` | BigInt address of the `INetMessage*`. |
| `ReliableDelivery` | `boolean` | Live readable and writable reliability flag. |
| `MessageType` | `number` | Native message type identifier. |
| `MessageGroup` | `number` | Native network-message group. |
| `MessageName` | `string` | Native message name. |
| `NetChannel` | `NetChannel \| null` | Live readable and writable message channel. Assignment accepts a `NetChannel` or positive BigInt `INetChannel` address. |
| `toString()` | `string` | Native diagnostic representation. |
| `ProcessNetMessage()` | `boolean` | Invokes the message's native `INetMessage::Process()` implementation. |
| `ReadNetMessageFromBuffer(MessageBuffer)` | `boolean` | Invokes `INetMessage::ReadFromBuffer()`; updates `CurrentBit` on a mutable buffer object from the native `ReadBitCount` result. |
| `WriteNetMessageToBuffer(MessageBuffer)` | `boolean` | Invokes `INetMessage::WriteToBuffer()`; replaces `Bytes`, sets `CurrentBit` on `BitBufferWrite`, or sets `WrittenBitCount` on a compatible plain object. |

`ReadNetMessageFromBuffer()` accepts byte storage, `BitBufferRead`, or `{ Bytes, DataBitCount }`; it updates `CurrentBit` when given a mutable object. `WriteNetMessageToBuffer()` accepts byte storage, `BitBufferWrite`, or `{ Bytes, MaximumBitCount }`; it replaces `Bytes` and updates a mutable object's write position. For `BitBufferWrite`, setting `CurrentBit` also updates the read-only `WrittenBitCount` and `WrittenByteCount` getters. Plain records receive `WrittenBitCount` directly. Raw `ArrayBuffer` and typed-array arguments are copied for processing and are not modified in place. Native read/write cursors start at bit `0`; the input object's `CurrentBit` is not a resume or append position. Updates to a mutable buffer are applied even when the native method returns `false`; neither a failed result nor an update/setter exception rolls back earlier engine work. Use writable buffer objects and inspect partial output before retrying. These methods execute virtual engine code. `ProcessNetMessage()` can change game state and must not be called merely to inspect a message. Reprocessing or parsing the same engine message at the wrong hook phase can be destructive.

## Examples

### Resolve a connected player

Use nullable lookups when the command may run before a player has a live `NetChannel`.

```js
const { GetPlayerNetChannel, GetPlayerNetChannelInfo } = require("netchannel");

const g_unPlayerIndex = 1;
const g_ChannelInformation = GetPlayerNetChannelInfo(g_unPlayerIndex);
const g_Channel = GetPlayerNetChannel(g_unPlayerIndex);
if ((g_ChannelInformation === null) || (g_Channel === null)) {
	throw new Error("Player 1 does not currently have a live NetChannel.");
}

const g_bHasExpectedInformationPlayerIndex = g_ChannelInformation.PlayerIndex === g_unPlayerIndex;
const g_bHasExpectedNetChannelPlayerIndex = g_Channel.PlayerIndex === g_unPlayerIndex;
const g_bHasMatchingNetChannelAddress = g_ChannelInformation.NetworkChannelAddress === g_Channel.Address;
if (!g_bHasExpectedInformationPlayerIndex || !g_bHasExpectedNetChannelPlayerIndex || !g_bHasMatchingNetChannelAddress) {
	throw new Error("Player NetChannel lookups did not resolve the same live engine object.");
}
```

### Read live channel state

Native-backed properties below ask the engine for their current values; `Address` remains the field recorded when the wrapper was constructed.

```js
const { NetChannelInfo } = require("netchannel");

const g_ChannelInformation = NetChannelInfo.GetRequiredPlayerNetChannelInfo(1);
const g_vecNetChannelNumericValues = [g_ChannelInformation.BufferSize, g_ChannelInformation.DataRate, g_ChannelInformation.Time, g_ChannelInformation.TimeConnected, g_ChannelInformation.TimeSinceLastReceived];
const g_bHasInvalidNetChannelNumericValue = g_vecNetChannelNumericValues.some((dblNetChannelNumericValue) => (typeof dblNetChannelNumericValue !== "number") || !Number.isFinite(dblNetChannelNumericValue));
if (g_bHasInvalidNetChannelNumericValue) {
	throw new Error("NetChannelInfo returned an invalid live numeric property.");
}

const g_bHasValidInformationAddress = (typeof g_ChannelInformation.Address === "bigint") && (g_ChannelInformation.Address > 0n);
const g_bHasValidNetChannelAddress = (typeof g_ChannelInformation.NetworkChannelAddress === "bigint") && (g_ChannelInformation.NetworkChannelAddress > 0n);
const g_bHasMatchingNetChannelAddress = g_ChannelInformation.NetChannel.Address === g_ChannelInformation.NetworkChannelAddress;
if (!g_bHasValidInformationAddress || !g_bHasValidNetChannelAddress || !g_bHasMatchingNetChannelAddress) {
	throw new Error("NetChannelInfo returned invalid or inconsistent BigInt addresses.");
}

const g_bHasValidNetChannelName = typeof g_ChannelInformation.Name === "string";
const g_bHasValidRemoteAddress = typeof g_ChannelInformation.RemoteAddress === "string";
if (!g_bHasValidNetChannelName || !g_bHasValidRemoteAddress) {
	throw new Error("NetChannelInfo returned invalid live identity strings.");
}

for (const bNetChannelState of [g_ChannelInformation.IsNetChannelLoopback(), g_ChannelInformation.IsNetChannelPlayback(), g_ChannelInformation.IsNetChannelTimingOut()]) {
	if (typeof bNetChannelState !== "boolean") {
		throw new Error("NetChannelInfo returned a non-boolean channel state.");
	}
}
```

### Change and restore the data rate

Reading `DataRate` returns the SDK's signed integer byte rate per second. Both assignment to `DataRate` and `SetNetChannelDataRate()` write through to the same void `INetChannel::SetDataRate(float)` method. The engine controls the stored rate, including float representation and any engine policy; read it back rather than assuming exact equality to the requested JavaScript number. The example attempts restoration on every exit and preserves both errors if the operation and restoration fail.

```js
const { NetChannelInfo } = require("netchannel");

const g_ChannelInformation = NetChannelInfo.GetRequiredPlayerNetChannelInfo(1);
const g_nPreviousNetChannelDataRate = g_ChannelInformation.DataRate;
const g_flRequestedNetChannelDataRate = g_nPreviousNetChannelDataRate + 1000;
let g_bRateChangeFailed = false;
let g_RateChangeError = null;

try {
	g_ChannelInformation.DataRate = g_flRequestedNetChannelDataRate;

	const nObservedNetChannelDataRate = g_ChannelInformation.DataRate;
	if (!Number.isSafeInteger(nObservedNetChannelDataRate)) {
		throw new Error("NetChannelInfo.DataRate returned an invalid live rate.");
	}
} catch (OperationError) {
	g_bRateChangeFailed = true;
	g_RateChangeError = OperationError;
	throw OperationError;
} finally {
	try {
		if (!g_ChannelInformation.NetChannel.SetNetChannelDataRate(g_nPreviousNetChannelDataRate)) {
			throw new Error("NetChannel.SetNetChannelDataRate() could not restore the original rate.");
		}
	} catch (CleanupError) {
		if (g_bRateChangeFailed) {
			throw new AggregateError([g_RateChangeError, CleanupError], "Data-rate change and restoration both failed.");
		}

		throw CleanupError;
	}
}
```

### Compare incoming and outgoing statistics

```js
const { NET_FLOW, NetChannelInfo } = require("netchannel");

const g_ChannelInformation = NetChannelInfo.GetRequiredPlayerNetChannelInfo(1);
for (const nFlow of [NET_FLOW.Outgoing, NET_FLOW.Incoming]) {
	const vecNetChannelStatistics = [
		g_ChannelInformation.GetNetChannelAverageChoke(nFlow),
		g_ChannelInformation.GetNetChannelAverageDataRate(nFlow),
		g_ChannelInformation.GetNetChannelAverageLatency(nFlow),
		g_ChannelInformation.GetNetChannelAveragePacketLoss(nFlow),
		g_ChannelInformation.GetNetChannelAveragePacketRate(nFlow),
		g_ChannelInformation.GetNetChannelLatency(nFlow),
		g_ChannelInformation.GetNetChannelSequenceNumber(nFlow),
		g_ChannelInformation.GetNetChannelTotalDataBytes(nFlow),
	];
	const bHasInvalidNetChannelStatistic = vecNetChannelStatistics.some((dblNetChannelStatistic) => (typeof dblNetChannelStatistic !== "number") || !Number.isFinite(dblNetChannelStatistic));
	if (bHasInvalidNetChannelStatistic) {
		throw new Error("NetChannelInfo returned invalid directional statistics.");
	}

	const bCanGetNetChannelTotalPacketCount = typeof g_ChannelInformation.GetNetChannelTotalPacketCount === "function";
	if (bCanGetNetChannelTotalPacketCount) {
		const nNetChannelTotalPacketCount = g_ChannelInformation.GetNetChannelTotalPacketCount(nFlow);
		if (!Number.isSafeInteger(nNetChannelTotalPacketCount) || (nNetChannelTotalPacketCount < 0)) {
			throw new Error("NetChannelInfo.GetNetChannelTotalPacketCount() returned an invalid packet count.");
		}
	}
}
```

### Inspect packet history and stream progress

```js
const { NET_FLOW, NetChannelInfo } = require("netchannel");

const g_ChannelInformation = NetChannelInfo.GetRequiredPlayerNetChannelInfo(1);
const g_nNetFlow = NET_FLOW.Incoming;
const g_nNetChannelFrameNumber = g_ChannelInformation.GetNetChannelSequenceNumber(g_nNetFlow);
const g_nNetChannelPacketByteCount = g_ChannelInformation.GetNetChannelPacketByteCount(g_nNetFlow, g_nNetChannelFrameNumber, 0);
const g_flNetChannelPacketTime = g_ChannelInformation.GetNetChannelPacketTime(g_nNetFlow, g_nNetChannelFrameNumber);
const g_NetChannelStreamProgress = g_ChannelInformation.GetNetChannelStreamProgress(g_nNetFlow);
const g_bNetChannelPacketValid = g_ChannelInformation.IsNetChannelPacketValid(g_nNetFlow, g_nNetChannelFrameNumber);
const g_bHasValidNetChannelFrameNumber = Number.isSafeInteger(g_nNetChannelFrameNumber);
const g_bHasValidNetChannelPacketByteCount = Number.isSafeInteger(g_nNetChannelPacketByteCount);
const g_bHasValidNetChannelPacketTime = (typeof g_flNetChannelPacketTime === "number") && Number.isFinite(g_flNetChannelPacketTime);
if (!g_bHasValidNetChannelFrameNumber || !g_bHasValidNetChannelPacketByteCount || !g_bHasValidNetChannelPacketTime) {
	throw new Error("Packet-history access returned invalid numeric data.");
}

const g_bHasValidNetChannelPacketState = typeof g_bNetChannelPacketValid === "boolean";
const g_bHasNetChannelStreamProgress = (g_NetChannelStreamProgress !== null) && (typeof g_NetChannelStreamProgress === "object");
const g_bHasValidNetChannelStreamState = g_bHasNetChannelStreamProgress && (typeof g_NetChannelStreamProgress.Active === "boolean");
if (!g_bHasValidNetChannelPacketState || !g_bHasValidNetChannelStreamState) {
	throw new Error("Packet-history access returned invalid status data.");
}

const g_bHasValidNetChannelReceivedByteCount = Number.isSafeInteger(g_NetChannelStreamProgress.ReceivedByteCount);
const g_bHasValidNetChannelTotalByteCount = Number.isSafeInteger(g_NetChannelStreamProgress.TotalByteCount);
if (!g_bHasValidNetChannelReceivedByteCount || !g_bHasValidNetChannelTotalByteCount) {
	throw new Error("NetChannelInfo.GetNetChannelStreamProgress() returned invalid byte counts.");
}
```

### Read SDK-dependent diagnostics

```js
const { NET_FLOW, NetChannelInfo } = require("netchannel");

const g_ChannelInformation = NetChannelInfo.GetRequiredPlayerNetChannelInfo(1);
const g_NetChannelDiagnostics = {};
if ("TimeoutSeconds" in g_ChannelInformation) {
	g_NetChannelDiagnostics.TimeoutSeconds = g_ChannelInformation.TimeoutSeconds;
	if ((typeof g_NetChannelDiagnostics.TimeoutSeconds !== "number") || !Number.isFinite(g_NetChannelDiagnostics.TimeoutSeconds)) {
		throw new Error("NetChannelInfo.TimeoutSeconds returned an invalid value.");
	}
}

if (typeof g_ChannelInformation.GetNetChannelRemoteFrameRate === "function") {
	g_NetChannelDiagnostics.RemoteFrameRate = g_ChannelInformation.GetNetChannelRemoteFrameRate();
	const bHasValidNetChannelFrameTime = (typeof g_NetChannelDiagnostics.RemoteFrameRate.FrameTime === "number") && Number.isFinite(g_NetChannelDiagnostics.RemoteFrameRate.FrameTime);
	const bHasValidNetChannelFrameTimeStandardDeviation = (typeof g_NetChannelDiagnostics.RemoteFrameRate.FrameTimeStandardDeviation === "number") && Number.isFinite(g_NetChannelDiagnostics.RemoteFrameRate.FrameTimeStandardDeviation);
	if (!bHasValidNetChannelFrameTime || !bHasValidNetChannelFrameTimeStandardDeviation) {
		throw new Error("NetChannelInfo.GetNetChannelRemoteFrameRate() returned an invalid record.");
	}
}

if (typeof g_ChannelInformation.GetNetChannelCommandInterpolationAmount === "function") {
	g_NetChannelDiagnostics.CommandInterpolationAmount = g_ChannelInformation.GetNetChannelCommandInterpolationAmount(NET_FLOW.Incoming);
	if ((typeof g_NetChannelDiagnostics.CommandInterpolationAmount !== "number") || !Number.isFinite(g_NetChannelDiagnostics.CommandInterpolationAmount)) {
		throw new Error("NetChannelInfo.GetNetChannelCommandInterpolationAmount() returned an invalid value.");
	}
}

if (typeof g_ChannelInformation.GetNetChannelPacketResponseLatency === "function") {
	g_NetChannelDiagnostics.PacketResponseLatency = g_ChannelInformation.GetNetChannelPacketResponseLatency(NET_FLOW.Outgoing);
	const bHasValidNetChannelLatency = Number.isSafeInteger(g_NetChannelDiagnostics.PacketResponseLatency.LatencyMilliseconds);
	const bHasValidNetChannelChoke = Number.isSafeInteger(g_NetChannelDiagnostics.PacketResponseLatency.Choke);
	if (!bHasValidNetChannelLatency || !bHasValidNetChannelChoke) {
		throw new Error("NetChannelInfo.GetNetChannelPacketResponseLatency() returned an invalid record.");
	}
}
```

### Rewrap addresses obtained from live objects

This example never substitutes an unrelated symbol address for an SDK object.

```js
const { NetChannel, NetChannelHandler, NetChannelInfo } = require("netchannel");

const g_PlayerChannelInformation = NetChannelInfo.GetRequiredPlayerNetChannelInfo(1);
const g_InformationView = NetChannelInfo.CreateNetChannelInfoFromAddress(g_PlayerChannelInformation.Address);
const g_ChannelView = NetChannel.CreateNetChannelFromAddress(g_PlayerChannelInformation.NetworkChannelAddress);
const g_MessageHandler = g_ChannelView.MessageHandler;
const g_HandlerView = (g_MessageHandler === null) ? null : NetChannelHandler.CreateNetChannelHandlerFromAddress(g_MessageHandler.Address);
const g_bHasMatchingInformationAddress = g_InformationView.Address === g_PlayerChannelInformation.Address;
const g_bHasMatchingChannelAddress = g_ChannelView.NetworkChannelAddress === g_PlayerChannelInformation.NetworkChannelAddress;
if (!g_bHasMatchingInformationAddress || !g_bHasMatchingChannelAddress) {
	throw new Error("The NetChannel address factories did not preserve the validated live addresses.");
}

const g_bHasMatchingNullHandler = (g_MessageHandler === null) === (g_HandlerView === null);
const g_bHasMatchingHandlerAddress = (g_MessageHandler === null) || ((g_HandlerView !== null) && (g_HandlerView.Address === g_MessageHandler.Address));
if (!g_bHasMatchingNullHandler || !g_bHasMatchingHandlerAddress) {
	throw new Error("NetChannelHandler.CreateNetChannelHandlerFromAddress() did not preserve the live handler address.");
}
```

### Send a bit-accurate payload

`SendNetChannelData()` uses only the bits already written to the buffer. The bytes below illustrate buffer construction, not a valid selected-SDK network-message format. Send them on a live channel only if the peer and owning protocol explicitly accept that payload; otherwise construct the actual validated protocol message.

```js
const { BitBufferWrite } = require("bitbuffers");
const { NetChannel } = require("netchannel");

const g_unPayloadBufferByteCapacity = 16;
const g_unPayloadMarkerFirstByte = 0x53;
const g_unPayloadMarkerSecondByte = 0x4A;

const g_Channel = NetChannel.GetPlayerNetChannel(1);
if (g_Channel === null) {
	throw new Error("Player 1 does not currently own a live NetChannel.");
}

const g_PayloadBuffer = new BitBufferWrite(g_unPayloadBufferByteCapacity);
g_PayloadBuffer.WriteByte(g_unPayloadMarkerFirstByte);
g_PayloadBuffer.WriteByte(g_unPayloadMarkerSecondByte);
g_PayloadBuffer.WriteString("status");

if (!g_Channel.SendNetChannelData(g_PayloadBuffer, true)) {
	throw new Error("NetChannel.SendNetChannelData() did not accept the written bitbuffer payload.");
}
```

### Request a file transfer

The path below is a relative engine transfer path. `RequestNetChannelFile()` returns the ID for that request; it does not report transfer completion. `SendNetChannelFile()` and `DenyNetChannelFile()` need the ID supplied by the corresponding peer request, not an ID reused from an unrelated local request. Denial is an alternative to sending the same transfer; do not deny an ID after its file has already been sent.

```js
const { NetChannel } = require("netchannel");

const g_Channel = NetChannel.GetPlayerNetChannel(1);
if (g_Channel === null) {
	throw new Error("Player 1 does not currently own a live NetChannel.");
}

const g_unTransferID = g_Channel.RequestNetChannelFile("download/sourcejs/client-state.bin");
const g_bHasValidTransferID = Number.isSafeInteger(g_unTransferID) && (g_unTransferID >= 0);
if (!g_bHasValidTransferID) {
	throw new Error("NetChannel.RequestNetChannelFile() returned an invalid transfer ID.");
}
```

`DenyNetChannelFile()` invokes native `DenyFile()`, which has no result; the JavaScript method returns `true` after issuing the call. Validation or unsupported replay-file options throw instead.

### Inspect a message supplied by a detour

Export this callback to the detour or extension that supplies the BigInt address of an `INetMessage*`. The callback does not retain the wrapper.

```js
const { NetMessage } = require("netchannel");

module.exports = function InspectNetMessageCallback(unAddress) {
	const Message = NetMessage.CreateNetMessageFromAddress(unAddress);
	const Channel = Message.NetChannel;

	return {
		MessageAddress: Message.Address,
		MessageName: Message.MessageName,
		MessageType: Message.MessageType,
		MessageGroup: Message.MessageGroup,
		ReliableDelivery: Message.ReliableDelivery,
		NetChannelAddress: Channel?.Address ?? null,
		DiagnosticText: Message.toString(),
	};
};
```

### Change message routing inside a pre-hook

This callback intentionally changes routing and reliability and does not restore them. Use it only while the detour contract permits that mutation, not in an observational hook. Assignment to `NetChannel` requires a live channel or positive BigInt address; `null` and `0n` cannot clear the channel, so this API cannot restore an originally absent channel.

```js
const { NetChannel, NetMessage } = require("netchannel");

module.exports = function RouteUnreliableNetMessageCallback(unMessageAddress, unPlayerIndex) {
	const Message = NetMessage.CreateNetMessageFromAddress(unMessageAddress);
	const TargetNetChannel = NetChannel.GetPlayerNetChannel(unPlayerIndex);
	if (TargetNetChannel === null) {
		return false;
	}

	Message.NetChannel = TargetNetChannel;
	Message.ReliableDelivery = false;
	const bHasTargetNetChannel = Message.NetChannel.Address === TargetNetChannel.Address;

	return bHasTargetNetChannel && !Message.ReliableDelivery;
};
```

### Parse a message from bytes

Pass one-byte typed-array storage, preferably `Uint8Array`, to this callback. Ordinary numeric arrays are not native byte buffers, and wider typed arrays represent their raw multibyte storage. The guard rejects both before native processing. `CurrentBit` reports the native read position starting at bit `0`, including a partial read when `ReadSucceeded` is `false`.

```js
const { BitBufferRead } = require("bitbuffers");
const { NetMessage } = require("netchannel");

module.exports = function ParseNetMessageFromBytesCallback(unMessageAddress, arrBytes) {
	if (!ArrayBuffer.isView(arrBytes) || (arrBytes.BYTES_PER_ELEMENT !== 1)) {
		throw new TypeError("Message bytes must be one-byte typed-array storage.");
	}

	const Message = NetMessage.CreateNetMessageFromAddress(unMessageAddress);
	const BitBufferReader = new BitBufferRead(arrBytes);
	const bNetMessageReadSucceeded = Message.ReadNetMessageFromBuffer(BitBufferReader);

	return {
		CurrentBit: BitBufferReader.CurrentBit,
		ReadSucceeded: bNetMessageReadSucceeded,
	};
};
```

### Serialize a message to bytes

The returned `Bytes` are a copied slice limited to the written byte count; `WrittenBitCount` defines how many bits in that slice are valid. A failed native write can still return partial bytes and a nonzero bit count. This callback does not retry or roll back the native message operation.

```js
const { BitBufferWrite } = require("bitbuffers");
const { NetMessage } = require("netchannel");

module.exports = function SerializeNetMessageToBytesCallback(unMessageAddress, unCapacityByteCount) {
	const Message = NetMessage.CreateNetMessageFromAddress(unMessageAddress);
	const BitBufferWriter = new BitBufferWrite(unCapacityByteCount);
	const bNetMessageWriteSucceeded = Message.WriteNetMessageToBuffer(BitBufferWriter);

	return {
		Bytes: BitBufferWriter.Bytes.slice(0, BitBufferWriter.WrittenByteCount),
		WriteSucceeded: bNetMessageWriteSucceeded,
		WrittenBitCount: BitBufferWriter.WrittenBitCount,
	};
};
```

### Process a message at an owning hook point

This callback invokes native game behavior and therefore belongs only at a hook point that transfers processing responsibility to the plugin.

```js
const { NetMessage } = require("netchannel");

module.exports = function ProcessNetMessageCallback(unMessageAddress) {
	const Message = NetMessage.CreateNetMessageFromAddress(unMessageAddress);

	return Message.ProcessNetMessage();
};
```

## Errors

- Player indexes supplied to lookup methods must be positive safe integers in JavaScript and fit the native signed 32-bit index; the optional `NetChannelInfo` constructor player-index field may be zero. Native addresses must be positive `bigint` values that fit the architecture; strings and zero addresses are rejected.
- `NetChannelInfo.GetRequiredPlayerNetChannelInfo()` throws without live information, while `GetPlayerNetChannelInfo()`, `GetPlayerNetChannel()`, and `NetChannel.GetPlayerNetChannel()` return `null` where documented.
- Per-flow methods throw `RangeError` for `NET_FLOW.InOut` or any unknown identifier.
- Loading the module throws `TypeError` when native flow constants do not satisfy the canonical record contract.
- Native channel-address, player-index, flow, frame-number, transfer-ID, and boolean argument readers preserve JavaScript errors, translate C++ failures, and leave outputs unchanged on failure. Native flow constants are created as own data properties, without invoking inherited setters.
- Native information callbacks, live property accessors, and buffer readers preserve JavaScript exceptions and translate C++ failures at the callback boundary. A throwing `Address` getter stops property access before any native channel call; buffer outputs are committed only after successful validation and copying. Information-record identity fields and frame-rate result fields are own data properties, bypassing inherited setters.
- Native file, message, and packet callbacks preserve conversion/property exceptions and translate C++ failures before returning to JavaScript. A failed file-path conversion stops before transfer options or native file operations. Message read/write, stream-progress, and packet-latency result fields are own data properties, bypassing inherited setters.
- Optional SDK methods are absent from the prototype and therefore produce the normal V8 member error when called without a capability check.
- `SendNetChannelFile()`, `SendNetChannelData()`, message parsing/serialization, and `ProcessNetMessage()` return `false` when their native operation reports failure. `DenyNetChannelFile()` returns `true` after invoking the native void method, while `RequestNetChannelFile()` returns the engine-assigned unsigned 32-bit transfer ID as a JavaScript number.

## Lifecycle

All wrappers are non-owning live views. Do not cache channel or message objects across disconnects, map changes, plugin unload, or the callback that supplied a temporary BigInt address of an `INetMessage*`. Observational hooks should inspect without routing, parsing, processing, or other mutations. If the owning hook contract permits a temporary mutation, retain the original values and check restoration on every exit; cleanup can fail and does not roll back earlier engine work. `NetChannel` cannot be cleared with `null` or `0n`, so do not temporarily retarget a message whose original channel is absent.

## Related modules

- [`bitbuffers`](bitbuffers.md) provides bit-accurate buffers for `SendNetChannelData()`, `ReadNetMessageFromBuffer()`, and `WriteNetMessageToBuffer()`.
- [`memory`](memory.md) registers these classes for `MakeObject()` with positive BigInt addresses.
- [`memory/hooks`](memory-hooks.md) provides detours that can receive BigInt addresses of `INetMessage*` objects.
- [Architecture](../architecture.md) documents native object ownership and selected-SDK boundaries.
