# `require("memory/hooks/messages")`

> AI processing warning: this module installs native engine vtable hooks and exposes mutable user-message buffers. Preserve backend capability checks, exact callback signatures and last-callback cleanup when changing examples.

`memory/hooks/messages` observes and edits outgoing Source user messages. It supports raw bitbuffer or protobuf callbacks for the selected SDK and a backend-independent decoded `UserMessageHook` for messages implemented by `messages/implementation`.

The module lives at `packages/sourcejs/memory/hooks/messages.js`; vtable hook options and native buffer adapters live in `src/sourcejs/modules/ModuleBindings.cpp`. See [`messages`](messages.md), [`messages/implementation`](messages-implementation.md), [`bitbuffers`](bitbuffers.md) and [`filters/recipients`](filters-recipients.md).

## Contents

- [Import](#import)
- [Runtime model](#runtime-model)
- [Exports](#exports)
- [Callback contracts](#callback-contracts)
- [Class members](#class-members)
- [Examples](#examples)
- [Errors and lifecycle](#errors-and-lifecycle)

## Import

```js
const g_MessageHooks = require("memory/hooks/messages");
const {
	HOOK_STATUS,
	UserMessageHook,
	UserMessageHookBase,
	EnsureNativeHooks,
	Backend,
} = g_MessageHooks;

const g_strSelectedBackend = Backend();
const g_strRawClassName = (g_strSelectedBackend === "bitbuffer") ? "BitBufferUserMessageHook" : "ProtobufUserMessageHook";
const g_strUnavailableClassName = (g_strSelectedBackend === "bitbuffer") ? "ProtobufUserMessageHook" : "BitBufferUserMessageHook";

if ((HOOK_STATUS.Backend !== g_strSelectedBackend) || (typeof UserMessageHook !== "function") || (typeof UserMessageHookBase !== "function") || (typeof EnsureNativeHooks !== "function")) {
	throw new Error("memory/hooks/messages did not expose its mandatory live API.");
}

if ((typeof g_MessageHooks[g_strRawClassName] !== "function") || Object.hasOwn(g_MessageHooks, g_strUnavailableClassName)) {
	throw new Error("memory/hooks/messages did not match the selected raw backend.");
}
```

## Runtime model

- `Backend()` returns exactly `"bitbuffer"` or `"protobuf"` for the selected SDK.
- A bitbuffer SDK exports `BitBufferUserMessageHook`; a protobuf SDK exports `ProtobufUserMessageHook`. The unavailable raw class is omitted rather than replaced by a stub.
- `UserMessageHook` is backend-independent. It uses the concrete implementation returned by `messages/implementation.GetUserMessageImplementation(nMessageIndex)`.
- A message may be selected by a non-empty engine name or safe non-negative index. Construction resolves and stores both `MessageName` and `MessageIndex`.
- Registering the first callback installs the required native vtable hooks. Disposing the last callback attempts to remove those hooks; normal completion also clears pending bitbuffer state.
- Failed native removal retains the owned handle and its installed status. When no callbacks remain, another `DisposeUserMessageHook()` call retries cleanup but still returns `false` if it removes no callback. Registration reuses retained, fully configured hooks; incomplete installations must be released before retrying, so no duplicate hooks are created.
- Bitbuffer cleanup attempts both owned native removals independently and clears transient message state even when removal throws. A single removal failure is rethrown unchanged; multiple failures use `AggregateError` in begin/end order. On either backend, installation rollback preserves the registration failure first and a thrown cleanup failure second in an `AggregateError`; bitbuffer cleanup can itself be an aggregate. Thrown primitives retain their exact values, and failed native handles remain owned for retry. Callback removal can already have completed when cleanup throws: inspect live status instead of treating callback removal as proof that native cleanup completed.
- Registrations and callback maps belong to the current plugin's isolated JavaScript context. Native hook ownership is also removed when that context unloads.
- `HOOK_STATUS` is a stable object with realtime getters for this context's retained native-hook handles. The `Installed` flags do not query the native registry or verify that dispatch callbacks are fully configured. Do not copy it when current cleanup ownership matters.
- `EnsureNativeHooks()` installs the current backend hooks without adding a callback. Pair it with a real registration and disposal so the hooks can be released before plugin unload.
- The native bridge creates hook-option fields, recipient/buffer snapshot fields, protobuf adapter methods, and their internal binding fields as own writable, enumerable, configurable data properties. Inherited setters and non-writable prototype properties do not intercept their creation. `ObjectAddress` is a borrowed `bigint` address; `Arguments` and recipient `Indices` are dense arrays with own indexed entries. Bitbuffer `Bytes` is a copied `Uint8Array`, not a live native-memory view. These snapshot guarantees do not validate a supplied native address or extend native-object lifetime.
- Sending examples require an active map and at least one connected player because the engine has no client recipient in the game main menu.
- The `TextMsg` sending examples also require the selected SDK to export `messages.GetBaseMessageConstants`; SDKs without those constants can still use the import and registration examples.

## Exports

| Export | Kind | Availability | Signature |
| --- | --- | --- | --- |
| [`HOOK_STATUS`](#hook_status-1) | Singleton | Always | Live backend and native-hook installation state. |
| [`BitBufferUserMessageHook`](#bitbufferusermessagehook) | Class | Bitbuffer backend | `new BitBufferUserMessageHook(UserMessage, Callback = null)` |
| [`ProtobufUserMessageHook`](#protobufusermessagehook) | Class | Protobuf backend | `new ProtobufUserMessageHook(UserMessage, Callback = null)` |
| [`UserMessageHook`](#usermessagehook-1) | Class | Always | `new UserMessageHook(UserMessage, Callback = null)` |
| [`UserMessageHookBase`](#usermessagehookbase-1) | Base class | Always | `new UserMessageHookBase(UserMessage, Callback = null)` |
| [`Backend`](#backend) | Function | Always | `Backend()` |
| [`EnsureNativeHooks`](#ensurenativehooks) | Function | Always | `EnsureNativeHooks()` |

## Callback contracts

### Bitbuffer callback

```js
function OnBitBufferMessage(Recipients, Reader, Writer) {
	// Recipients: RecipientFilter
	// Reader: BitBufferRead positioned at bit zero
	// Writer: BitBufferWrite positioned at bit zero
}
```

Each raw callback receives a fresh reader over the same live writer, with both cursors reset to bit zero. A writer left at bit zero after the raw callbacks is restored to the original end position before decoded callbacks run. After successful dispatch, final bytes, bit count, cursor and overflow state are written back to the engine buffer.

### Protobuf callback

```js
function OnProtobufMessage(Recipients, Buffer) {
	// Recipients: RecipientFilter
	// Buffer: live native protobuf adapter for this message
}
```

Raw protobuf callbacks run before decoded callbacks and share the same native buffer.

### Decoded callback

```js
function OnUserMessage(Recipients, Data) {
	// Data: message-specific UserMessageData from messages/implementation
}
```

When `Data.HasUserMessageChanged()` is true after all decoded callbacks, SourceJS serializes the changed fields back through the active backend. Raw callbacks run first, so decoding observes their edits. Each callback map takes a snapshot immediately before its iteration; removing a callback does not remove it from a snapshot already taken. Callbacks execute synchronously: a returned Promise is not awaited.

On protobuf, changed decoded data clears the native message before reserialization. Fields not represented by the selected implementation are therefore not preserved. Do not use a decoded hook when those additional fields must survive; use the raw protobuf adapter instead.

## Class members

### `UserMessageHookBase`

The base class can resolve message metadata without a callback, but its abstract `Store` getter prevents direct registration. Use one of the supplied concrete hook classes for registration; a custom subclass must preserve callback-map dispatch and native-hook ownership. Do not mutate `MessageIndex` or `MessageName` after construction: callback maps use the stored `MessageIndex`, while `MessageName` supplies resolved metadata and diagnostics.

| Member | Kind | Description |
| --- | --- | --- |
| `MessageIndex` | Field | Resolved safe non-negative engine message index. |
| `MessageName` | Field | Resolved non-empty engine message name. |
| `Callback` | Live field | Currently registered callback, or `null`. Use registration/disposal methods to change ownership rather than assigning this field. |
| `Store` | Getter | Owning callback map; abstract on the base class. |
| `RequiredBackend` | Getter | Required raw backend, or `null` for portable hooks. |
| [`RegisterUserMessageHook(Callback)`](#usermessagehookbaseregisterusermessagehook) | Method | Validates and replaces the current callback, reuses configured native hooks, and returns the callback. Attempts rollback if disposal fails. |
| [`DisposeUserMessageHook()`](#usermessagehookbasedisposeusermessagehook) | Method | Removes the current callback, attempts to remove unused native hooks even if no callback remains, and returns whether the callback was removed. |

Duplicate callbacks and invalid callback ownership are rejected before changing the existing registration. Replacement adds the new callback before disposing the previous one so native hooks remain in use. If disposal throws or reports failure, registration attempts to restore the previous callback and remove the replacement; failed rollback throws an `AggregateError` containing the replacement error and cleanup errors. Custom disposal overrides must preserve the normal callback-store and native-hook ownership contracts.

### Raw hook classes

`BitBufferUserMessageHook` fixes `Store` to the bitbuffer callback map and `RequiredBackend` to `"bitbuffer"`. `ProtobufUserMessageHook` does the same for `"protobuf"`.

The native bitbuffer sender and hook metadata use the same `IVEngineServer::UserMessageBegin` signature from the selected SDK headers. Some SDKs take a message name in addition to its index; SourceJS passes the name only when that signature requires it. The JavaScript callback contract is the same in both cases.

### `UserMessageHook`

`UserMessageHook` uses the portable decoded callback map. Its dispatch path selects the concrete serializer returned by `messages/implementation` for `MessageIndex`.

### `HOOK_STATUS`

| Property | Description |
| --- | --- |
| `Backend` | Realtime selected backend string. |
| `BitBufferBeginInstalled` | Whether this context retains an `IVEngineServer::UserMessageBegin` hook handle. |
| `BitBufferEndInstalled` | Whether this context retains an `IVEngineServer::MessageEnd` hook handle. |
| `ProtobufSendInstalled` | Whether this context retains an `IVEngineServer::SendUserMessage` hook handle. |

## Examples

Run the raw sending examples independently in an otherwise hook-free plugin context. Constructing metadata without a callback makes the hook object available for cleanup even if registration fails. Cleanup checks both callback removal and live native-hook status: `DisposeUserMessageHook()` returning `true` does not prove that native removal succeeded. Each example preserves a single thrown value, aggregates multiple failures in occurrence order, and leaves any retained native handle for its owner to investigate instead of silently treating failed removal as success. Duplicate disposal is checked only after successful cleanup.

### `BitBufferUserMessageHook`

Register a raw bitbuffer callback only when that class is present on the selected SDK.

```js
const { GetBaseMessageConstants, GetUserMessageIndex, SendUserMessage } = require("messages");
const g_MessageHooks = require("memory/hooks/messages");
const { GetAllPlayers } = require("players");
const { Backend, HOOK_STATUS } = g_MessageHooks;

if (Backend() !== "bitbuffer") {
	if (Object.hasOwn(g_MessageHooks, "BitBufferUserMessageHook")) {
		throw new Error("The protobuf build unexpectedly exported the bitbuffer hook class.");
	}

} else {
	const Recipient = GetAllPlayers()[0];
	const nMessageIndex = GetUserMessageIndex("TextMsg");
	const HUDDestination = GetBaseMessageConstants().HUDDestination;
	const vecErrors = [];
	let unCallbackCount = 0;

	if ((Recipient === null) || (Recipient === undefined) || !Number.isSafeInteger(Recipient.Index) || (nMessageIndex < 0)) {
		throw new Error("The bitbuffer example requires a connected player and TextMsg.");
	}

	function RewriteTextMessage(Recipients, Reader, Writer) {
		if (!Recipients.RecipientIndexes.includes(Recipient.Index)) {
			throw new Error("The bitbuffer hook received the wrong recipient filter.");
		}

		const unDestination = Reader.ReadByte();
		const strOriginalMessage = Reader.ReadString();
		const strParameter1 = Reader.ReadString();
		const strParameter2 = Reader.ReadString();
		const strParameter3 = Reader.ReadString();
		const strParameter4 = Reader.ReadString();
		if ((unDestination !== HUDDestination.Console) || (strOriginalMessage !== "Original bitbuffer message")) {
			throw new Error("The bitbuffer hook decoded an unexpected TextMsg payload.");
		}

		Writer.WriteByte(unDestination);
		Writer.WriteString("[SourceJS] rewritten by the bitbuffer hook\n");
		Writer.WriteString(strParameter1);
		Writer.WriteString(strParameter2);
		Writer.WriteString(strParameter3);
		Writer.WriteString(strParameter4);
		unCallbackCount += 1;
	}

	if (HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled) {
		throw new Error("The bitbuffer sending example requires an otherwise hook-free plugin context.");
	}

	const Hook = new g_MessageHooks.BitBufferUserMessageHook(nMessageIndex);

	try {
		if (Hook.RegisterUserMessageHook(RewriteTextMessage) !== RewriteTextMessage) {
			throw new Error("The bitbuffer hook did not retain its callback identity.");
		}

		if ((Hook.MessageIndex !== nMessageIndex) || (Hook.MessageName !== "TextMsg") || (Hook.RequiredBackend !== "bitbuffer") || (Hook.Callback !== RewriteTextMessage)) {
			throw new Error("BitBufferUserMessageHook did not retain its resolved registration.");
		}

		const bSent = SendUserMessage("TextMsg", [Recipient.Index], [
			{ Type: "byte", Value: HUDDestination.Console },
			{ Type: "string", Value: "Original bitbuffer message" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
		], true);
		if (!bSent || (unCallbackCount !== 1)) {
			throw new Error("The outgoing bitbuffer TextMsg did not pass through the raw hook.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	} finally {
		try {
			const bHadCallback = Hook.Callback !== null;
			if (Hook.DisposeUserMessageHook() !== bHadCallback) {
				throw new Error("The bitbuffer hook did not release its registration.");
			}
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}

		try {
			if ((Hook.Callback !== null) || HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled) {
				throw new Error("The bitbuffer example did not finish releasing its hooks.");
			}
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "Raw bitbuffer message dispatch and cleanup failed.");
	}

	if (Hook.DisposeUserMessageHook() !== false) {
		throw new Error("The bitbuffer hook reported duplicate disposal.");
	}
}
```

### `ProtobufUserMessageHook`

The same capability pattern keeps a plugin loadable on bitbuffer and protobuf games without a fallback class.

```js
const { GetBaseMessageConstants, GetUserMessageIndex, SendUserMessage } = require("messages");
const g_MessageHooks = require("memory/hooks/messages");
const { GetAllPlayers } = require("players");
const { Backend, HOOK_STATUS } = g_MessageHooks;

if (Backend() !== "protobuf") {
	if (Object.hasOwn(g_MessageHooks, "ProtobufUserMessageHook")) {
		throw new Error("The bitbuffer build unexpectedly exported the protobuf hook class.");
	}

} else {
	const Recipient = GetAllPlayers()[0];
	const nMessageIndex = GetUserMessageIndex("TextMsg");
	const HUDDestination = GetBaseMessageConstants().HUDDestination;
	const vecErrors = [];
	let unCallbackCount = 0;

	if ((Recipient === null) || (Recipient === undefined) || !Number.isSafeInteger(Recipient.Index) || (nMessageIndex < 0)) {
		throw new Error("The protobuf example requires a connected player and TextMsg.");
	}

	function RewriteTextMessage(Recipients, Buffer) {
		if (!Recipients.RecipientIndexes.includes(Recipient.Index) || (Buffer.GetInt32("msg_dst") !== HUDDestination.Console) || (Buffer.GetRepeatedString("params", 0) !== "Original protobuf message")) {
			throw new Error("The protobuf hook received an unexpected TextMsg payload.");
		}

		Buffer.SetRepeatedString("params", 0, "[SourceJS] rewritten by the protobuf hook\n");

		if (Buffer.GetRepeatedString("params", 0) !== "[SourceJS] rewritten by the protobuf hook\n") {
			throw new Error("The protobuf hook did not update the live native buffer.");
		}

		unCallbackCount += 1;
	}

	if (HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled) {
		throw new Error("The protobuf sending example requires an otherwise hook-free plugin context.");
	}

	const Hook = new g_MessageHooks.ProtobufUserMessageHook(nMessageIndex);

	try {
		if (Hook.RegisterUserMessageHook(RewriteTextMessage) !== RewriteTextMessage) {
			throw new Error("The protobuf hook did not retain its callback identity.");
		}

		if ((Hook.MessageIndex !== nMessageIndex) || (Hook.MessageName !== "TextMsg") || (Hook.RequiredBackend !== "protobuf") || (Hook.Callback !== RewriteTextMessage)) {
			throw new Error("ProtobufUserMessageHook did not retain its resolved registration.");
		}

		const bSent = SendUserMessage("TextMsg", [Recipient.Index], [
			{ Kind: "SET", Name: "msg_dst", Type: "int32", Value: HUDDestination.Console },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "Original protobuf message" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		], true);
		if (!bSent || (unCallbackCount !== 1)) {
			throw new Error("The outgoing protobuf TextMsg did not pass through the raw hook.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	} finally {
		try {
			const bHadCallback = Hook.Callback !== null;
			if (Hook.DisposeUserMessageHook() !== bHadCallback) {
				throw new Error("The protobuf hook did not release its registration.");
			}
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}

		try {
			if ((Hook.Callback !== null) || HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled) {
				throw new Error("The protobuf example did not finish releasing its hooks.");
			}
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "Raw protobuf message dispatch and cleanup failed.");
	}

	if (Hook.DisposeUserMessageHook() !== false) {
		throw new Error("The protobuf hook reported duplicate disposal.");
	}
}
```

### `UserMessageHook`

Use the portable hook when `messages/implementation` has a serializer for the selected message. Mutating the decoded data marks it for reserialization.

```js
const { GetBaseMessageConstants, GetUserMessageIndex, SendUserMessage } = require("messages");
const g_MessageHooks = require("memory/hooks/messages");
const { UserMessageHook, Backend } = g_MessageHooks;
const { GetAllPlayers } = require("players");

const g_Recipient = GetAllPlayers()[0];
const g_nMessageIndex = GetUserMessageIndex("TextMsg");
const g_strSelectedBackend = Backend();
const g_HUDDestination = GetBaseMessageConstants().HUDDestination;
const g_vecErrors = [];
let g_unCallbackCount = 0;

if ((g_Recipient === null) || (g_Recipient === undefined) || !Number.isSafeInteger(g_Recipient.Index) || (g_nMessageIndex < 0)) {
	throw new Error("The decoded-hook example requires a connected player and TextMsg.");
}

function RewriteDecodedMessage(Recipients, Data) {
	if (!Recipients.RecipientIndexes.includes(g_Recipient.Index) || (Data.Message !== "Original decoded message")) {
		throw new Error("The decoded hook received an unexpected TextMsg payload.");
	}

	Data.Message = "[SourceJS] rewritten by the decoded hook\n";

	if (!Data.HasUserMessageChanged()) {
		throw new Error("The decoded message did not record its live mutation.");
	}

	g_unCallbackCount += 1;
}

if (g_MessageHooks.HOOK_STATUS.BitBufferBeginInstalled || g_MessageHooks.HOOK_STATUS.BitBufferEndInstalled || g_MessageHooks.HOOK_STATUS.ProtobufSendInstalled) {
	throw new Error("The decoded sending example requires an otherwise hook-free plugin context.");
}

const g_Hook = new UserMessageHook(g_nMessageIndex);

try {
	if (g_Hook.RegisterUserMessageHook(RewriteDecodedMessage) !== RewriteDecodedMessage) {
		throw new Error("The decoded hook did not retain its callback identity.");
	}

	if ((g_Hook.MessageIndex !== g_nMessageIndex) || (g_Hook.MessageName !== "TextMsg") || (g_Hook.RequiredBackend !== null)) {
		throw new Error("UserMessageHook did not resolve the portable TextMsg implementation.");
	}

	const vecFields = (g_strSelectedBackend === "bitbuffer")
		? [
			{ Type: "byte", Value: g_HUDDestination.Console },
			{ Type: "string", Value: "Original decoded message" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
		]
		: [
			{ Kind: "SET", Name: "msg_dst", Type: "int32", Value: g_HUDDestination.Console },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "Original decoded message" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		];
	if (!SendUserMessage("TextMsg", [g_Recipient.Index], vecFields, true) || (g_unCallbackCount !== 1)) {
		throw new Error("The outgoing TextMsg did not pass through the decoded hook.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		const bHadCallback = g_Hook.Callback !== null;
		if (g_Hook.DisposeUserMessageHook() !== bHadCallback) {
			throw new Error("The decoded hook did not release its registration.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		if ((g_Hook.Callback !== null) || g_MessageHooks.HOOK_STATUS.BitBufferBeginInstalled || g_MessageHooks.HOOK_STATUS.BitBufferEndInstalled || g_MessageHooks.HOOK_STATUS.ProtobufSendInstalled) {
			throw new Error("The decoded example did not finish releasing its hooks.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Decoded message dispatch and cleanup failed.");
}
```

### `UserMessageHookBase`

The base class owns resolution and lifecycle but leaves `Store` abstract. Inspect it through a concrete hook instead of instantiating it for registration. Run this metadata example in an otherwise hook-free context: even an empty disposal may release unused context-owned native hooks.

```js
const { GetUserMessageIndex } = require("messages");
const { HOOK_STATUS, UserMessageHook, UserMessageHookBase } = require("memory/hooks/messages");

const g_nMessageIndex = GetUserMessageIndex("TextMsg");
if (g_nMessageIndex < 0) {
	throw new Error("The selected SDK does not declare TextMsg.");
}

if (HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled) {
	throw new Error("The base metadata example requires an otherwise hook-free plugin context.");
}

const g_BaseHook = new UserMessageHookBase(g_nMessageIndex);
const g_ConcreteHook = new UserMessageHook(g_nMessageIndex);
let g_StoreError = null;

try {
	g_BaseHook.Store;
} catch (CaughtError) {
	g_StoreError = CaughtError;
}

if (!(g_ConcreteHook instanceof UserMessageHookBase) || (g_BaseHook.MessageIndex !== g_nMessageIndex) || (g_BaseHook.MessageName !== "TextMsg") || (g_BaseHook.Callback !== null) || (g_BaseHook.RequiredBackend !== null)) {
	throw new Error("UserMessageHookBase did not retain its resolved message state.");
}

if (!(g_StoreError instanceof TypeError) || (g_BaseHook.DisposeUserMessageHook() !== false)) {
	throw new Error("The base class did not reject Store access or empty DisposeUserMessageHook().");
}
```

### `Backend()`

Use `Backend()` for raw-buffer feature selection; portable decoded hooks normally do not need this branch.

```js
const g_MessageHooks = require("memory/hooks/messages");
const { Backend } = g_MessageHooks;

const g_strSelectedBackend = Backend();
const g_strRawClassName = (g_strSelectedBackend === "bitbuffer") ? "BitBufferUserMessageHook" : "ProtobufUserMessageHook";
const g_strUnavailableClassName = (g_strSelectedBackend === "bitbuffer") ? "ProtobufUserMessageHook" : "BitBufferUserMessageHook";
if ((g_strSelectedBackend !== "bitbuffer") && (g_strSelectedBackend !== "protobuf")) {
	throw new Error(`Unsupported user-message backend: ${g_strSelectedBackend}.`);
}

if ((g_MessageHooks.HOOK_STATUS.Backend !== g_strSelectedBackend) || (typeof g_MessageHooks[g_strRawClassName] !== "function") || Object.hasOwn(g_MessageHooks, g_strUnavailableClassName)) {
	throw new Error("The raw hook class does not match the selected backend.");
}
```

### `EnsureNativeHooks`

Call `EnsureNativeHooks()` only while a real registration owns cleanup; disposing the final registration attempts to remove the native hooks.

```js
const { GetUserMessageIndex } = require("messages");
const { HOOK_STATUS, UserMessageHook, EnsureNativeHooks } = require("memory/hooks/messages");

const g_nMessageIndex = GetUserMessageIndex("TextMsg");
if (g_nMessageIndex < 0) {
	throw new Error("The selected SDK does not declare TextMsg.");
}

const g_vecErrors = [];
const g_HookStatusBefore = {
	BitBufferBegin: HOOK_STATUS.BitBufferBeginInstalled,
	BitBufferEnd: HOOK_STATUS.BitBufferEndInstalled,
	ProtobufSend: HOOK_STATUS.ProtobufSendInstalled,
};

if (HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled) {
	throw new Error("The installation example requires an otherwise hook-free plugin context.");
}

function ObserveTextMessage() {
}

const g_CleanupHook = new UserMessageHook(g_nMessageIndex);

try {
	if (g_CleanupHook.RegisterUserMessageHook(ObserveTextMessage) !== ObserveTextMessage) {
		throw new Error("The installation example did not retain its callback identity.");
	}

	if ((EnsureNativeHooks() !== undefined) || (EnsureNativeHooks() !== undefined)) {
		throw new Error("EnsureNativeHooks() returned an unexpected value.");
	}

	const bExpectedInstalled = (HOOK_STATUS.Backend === "bitbuffer") ? (HOOK_STATUS.BitBufferBeginInstalled && HOOK_STATUS.BitBufferEndInstalled && !HOOK_STATUS.ProtobufSendInstalled) : (!HOOK_STATUS.BitBufferBeginInstalled && !HOOK_STATUS.BitBufferEndInstalled && HOOK_STATUS.ProtobufSendInstalled);
	if (!bExpectedInstalled) {
		throw new Error("EnsureNativeHooks() did not preserve the selected backend hooks.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		const bHadCallback = g_CleanupHook.Callback !== null;
		if (g_CleanupHook.DisposeUserMessageHook() !== bHadCallback) {
			throw new Error("The cleanup registration did not release its callback.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		if ((g_CleanupHook.Callback !== null) || (HOOK_STATUS.BitBufferBeginInstalled !== g_HookStatusBefore.BitBufferBegin) || (HOOK_STATUS.BitBufferEndInstalled !== g_HookStatusBefore.BitBufferEnd) || (HOOK_STATUS.ProtobufSendInstalled !== g_HookStatusBefore.ProtobufSend)) {
			throw new Error("Reported hook status did not return to its starting values.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Native hook installation and cleanup failed.");
}
```

### `HOOK_STATUS`

Read the stable object's getters before and after a registration instead of saving copied booleans as long-lived state.

```js
const { GetUserMessageIndex } = require("messages");
const g_MessageHooks = require("memory/hooks/messages");
const { HOOK_STATUS, UserMessageHook } = g_MessageHooks;

const g_nMessageIndex = GetUserMessageIndex("TextMsg");
const g_vecErrors = [];
const g_HookStatusBefore = {
	BitBufferBegin: HOOK_STATUS.BitBufferBeginInstalled,
	BitBufferEnd: HOOK_STATUS.BitBufferEndInstalled,
	ProtobufSend: HOOK_STATUS.ProtobufSendInstalled,
};

if (HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled) {
	throw new Error("The status example requires an otherwise hook-free plugin context.");
}

if ((HOOK_STATUS !== g_MessageHooks.HOOK_STATUS) || (g_nMessageIndex < 0)) {
	throw new Error("HOOK_STATUS identity or TextMsg resolution changed.");
}

function ObserveTextMessage() {
}

const g_Hook = new UserMessageHook(g_nMessageIndex);

try {
	if (g_Hook.RegisterUserMessageHook(ObserveTextMessage) !== ObserveTextMessage) {
		throw new Error("The status example did not retain its callback identity.");
	}

	const bCurrentBackendInstalled = (HOOK_STATUS.Backend === "bitbuffer") ? (HOOK_STATUS.BitBufferBeginInstalled && HOOK_STATUS.BitBufferEndInstalled) : HOOK_STATUS.ProtobufSendInstalled;
	if (!bCurrentBackendInstalled) {
		throw new Error("HOOK_STATUS did not update after callback registration.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		const bHadCallback = g_Hook.Callback !== null;
		if (g_Hook.DisposeUserMessageHook() !== bHadCallback) {
			throw new Error("The status example did not remove its callback.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		if ((g_Hook.Callback !== null) || (HOOK_STATUS.BitBufferBeginInstalled !== g_HookStatusBefore.BitBufferBegin) || (HOOK_STATUS.BitBufferEndInstalled !== g_HookStatusBefore.BitBufferEnd) || (HOOK_STATUS.ProtobufSendInstalled !== g_HookStatusBefore.ProtobufSend)) {
			throw new Error("HOOK_STATUS did not return to its starting values after callback disposal.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Hook status verification and cleanup failed.");
}
```

### `UserMessageHookBase.DisposeUserMessageHook`

`DisposeUserMessageHook()` returns `true` when it removes the owned callback and `false` when it removes none. The example preserves pre-existing callbacks, attempts each owned cleanup once, and checks duplicate disposal only when it started without native hooks and cleanup succeeded.

```js
const { GetUserMessageIndex } = require("messages");
const { HOOK_STATUS, UserMessageHook } = require("memory/hooks/messages");

const g_nMessageIndex = GetUserMessageIndex("TextMsg");
if (g_nMessageIndex < 0) {
	throw new Error("The selected SDK does not declare TextMsg.");
}

const g_vecErrors = [];
const g_bNativeHooksWereInstalled = HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled;
const g_Hook = new UserMessageHook(g_nMessageIndex);
const g_vecPreviousCallbacks = Array.from(g_Hook.Store.get(g_nMessageIndex) ?? []);
let g_bDisposalAttempted = false;

function ObserveTextMessage() {
}

try {
	if (g_Hook.RegisterUserMessageHook(ObserveTextMessage) !== ObserveTextMessage) {
		throw new Error("The disposal example did not retain its callback identity.");
	}

	g_bDisposalAttempted = true;

	const bRemoved = g_Hook.DisposeUserMessageHook();
	if (!bRemoved || (g_Hook.Callback !== null)) {
		throw new Error("DisposeUserMessageHook() did not release exactly one owned registration.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (!g_bDisposalAttempted) {
		try {
			const bHadCallback = g_Hook.Callback !== null;
			if (g_Hook.DisposeUserMessageHook() !== bHadCallback) {
				throw new Error("The disposal example did not remove its remaining callback.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	try {
		const vecRemainingCallbacks = Array.from(g_Hook.Store.get(g_nMessageIndex) ?? []);
		if ((g_Hook.Callback !== null) || (vecRemainingCallbacks.length !== g_vecPreviousCallbacks.length) || g_vecPreviousCallbacks.some(Callback => !vecRemainingCallbacks.includes(Callback))) {
			throw new Error("The disposal example did not restore its callback ownership.");
		}

		if (!g_bNativeHooksWereInstalled && (HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled)) {
			throw new Error("The disposal example left its native hooks installed.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Callback disposal and cleanup verification failed.");
}

if (!g_bNativeHooksWereInstalled && (g_Hook.DisposeUserMessageHook() !== false)) {
	throw new Error("The disposal example reported duplicate callback removal.");
}
```

### `UserMessageHookBase.RegisterUserMessageHook`

`RegisterUserMessageHook()` registers or replaces the owned callback while retaining the resolved message. Replacement adds the new callback before removing the previous one, so configured native hooks remain installed. Registrations owned by other hook objects are preserved. Run without unrelated callback-map mutation during this synchronous example; the saved callback inventory is only an ownership comparison, not a mutable replacement store.

```js
const { GetUserMessageIndex } = require("messages");
const { HOOK_STATUS, UserMessageHook } = require("memory/hooks/messages");

const g_nMessageIndex = GetUserMessageIndex("TextMsg");
if (g_nMessageIndex < 0) {
	throw new Error("The selected SDK does not declare TextMsg.");
}

const g_vecErrors = [];
const g_bNativeHooksWereInstalled = HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled;
const g_Hook = new UserMessageHook(g_nMessageIndex);
const g_vecPreviousCallbacks = Array.from(g_Hook.Store.get(g_nMessageIndex) ?? []);

function RewriteConnectionMessage(Recipients, Data) {
	Data.Message = "Player connected";
}

function RewriteDisconnectionMessage(Recipients, Data) {
	Data.Message = "Player disconnected";
}

try {
	if (g_Hook.RegisterUserMessageHook(RewriteConnectionMessage) !== RewriteConnectionMessage) {
		throw new Error("RegisterUserMessageHook() did not return the first callback.");
	}

	const CurrentCallback = g_Hook.RegisterUserMessageHook(RewriteDisconnectionMessage);
	const setCallbacks = g_Hook.Store.get(g_nMessageIndex);
	if ((CurrentCallback !== RewriteDisconnectionMessage) || (g_Hook.Callback !== RewriteDisconnectionMessage) || (setCallbacks === undefined) || setCallbacks.has(RewriteConnectionMessage) || !setCallbacks.has(RewriteDisconnectionMessage)) {
		throw new Error("RegisterUserMessageHook() did not replace the owned callback exactly.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		const bHadCallback = g_Hook.Callback !== null;
		if (g_Hook.DisposeUserMessageHook() !== bHadCallback) {
			throw new Error("The replacement hook did not release its callback.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	try {
		const vecRemainingCallbacks = Array.from(g_Hook.Store.get(g_nMessageIndex) ?? []);
		if ((g_Hook.Callback !== null) || (vecRemainingCallbacks.length !== g_vecPreviousCallbacks.length) || g_vecPreviousCallbacks.some(Callback => !vecRemainingCallbacks.includes(Callback))) {
			throw new Error("The replacement example did not restore its callback ownership.");
		}

		if (!g_bNativeHooksWereInstalled && (HOOK_STATUS.BitBufferBeginInstalled || HOOK_STATUS.BitBufferEndInstalled || HOOK_STATUS.ProtobufSendInstalled)) {
			throw new Error("The replacement example left its native hooks installed.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Callback replacement and cleanup failed.");
}
```

## Errors and lifecycle

- Sending, metadata, installation and status examples require an otherwise hook-free plugin context. The final disposal/replacement examples instead compare the callback inventory they found and preserve other owners; they only require native hooks to be gone when none were installed initially. They do not promise to restore an unowned manual installation made by `EnsureNativeHooks()` without a callback.
- Message selectors must be a non-empty engine name or safe non-negative index. Missing registry entries throw during construction; there is no guessed message number.
- Callback registration requires a function. Registering the same callback twice on one hook, or through another hook for the same message/store, throws.
- `UserMessageHookBase.Store` is abstract. Instantiate a concrete backend or decoded hook before registration.
- A raw hook class exists only for the selected backend. Attempting to use the omitted class produces the normal V8 missing-property error; a present class still verifies its required backend during `RegisterUserMessageHook()`.
- Bitbuffer and protobuf hook installation share the real SDK member-address decoder rather than guessing vtable slots. GNU-compatible Linux x86/x64 requires a tagged, aligned virtual offset with no `this` adjustment; Windows MSVC x86/x64 requires the supported single-inheritance thunk representation. Unsupported representations fail resolution. Windows instruction reads validate the whole range and copy only complete reads; this does not validate arbitrary native addresses supplied to other adapters.
- The bitbuffer hook-option, recipient-filter and state callback boundaries and the protobuf hook-option, recipient-filter, adapter-creation and method-dispatch boundaries translate C++ exceptions into contextual JavaScript errors. Record installation preserves an existing JavaScript property exception or execution termination instead of replacing it with a generic installation error. Shared hook-option creation, bitbuffer recipient/state record creation, and protobuf recipient/adapter creation also retain an already caught JavaScript exception during C++ unwinding. These boundaries do not roll back property-setter or native side effects.
- Protobuf adapter method installation and private binding-property reads preserve original JavaScript errors and execution termination. A null native message address is rejected before committing binding metadata; repeated-field indices are committed only after range validation. `SetRepeatedInt32()`, `SetRepeatedUInt32()`, `SetRepeatedFloat()`, `SetRepeatedDouble()`, and `SetRepeatedEnum()` revalidate the saved index after successful value coercion; enum writes do so after the declared-value lookup. Index/value conversions are not repeated. Conversion failures and undeclared-enum errors retain their original error instead of a later range error. Nested-message adapters also borrow native storage, whose owner must remain valid throughout each operation, including coercion. These checks do not establish native-address validity or extend the dispatch-scoped message lifetime.
- The native protobuf adapter's `Parse()` preserves original JavaScript byte-conversion errors and execution termination before calling the SDK parser, including an already caught JavaScript error during C++ unwinding. Failed byte conversion never reaches the SDK parse call. Invalid conversion results, byte lengths beyond the SDK's signed `int` range, and SDK parse failures keep the existing parse diagnostic. This boundary does not make parsing transactional or extend native-message lifetime.
- `EnsureNativeHooks()` alone creates native ownership without a public release handle. Prefer a real callback registration and call `EnsureNativeHooks()` only as an idempotent check while that registration owns cleanup.
- `Reader`, `Writer` and `Buffer` are dispatch-scoped; do not retain them after callback completion. `Buffer` is a live native protobuf adapter, while bitbuffer state is applied back to the engine buffer when dispatch ends. `Recipients` is a JavaScript `RecipientFilter` built from copied native recipient data, not a borrowed native filter wrapper.
- Native-to-JavaScript recipient snapshots in both backends copy indices/flags before output property setters can run JavaScript. Bitbuffer state snapshots likewise copy bytes/cursor/capacity/overflow before those setters. Reentrant setters cannot mix later native values into either snapshot. These snapshots do not validate arbitrary native addresses or extend the lifetime of borrowed filters/buffers.
- Bitbuffer state application copies up to the native capacity, leaves any remaining bytes unchanged, clamps the cursor to that capacity and sets the overflow flag only when the supplied state requests it. The SDK's `SeekToBit` returns `void`; a successful adapter return is not a separate SDK success status or a rollback guarantee. Native filter and buffer addresses must remain valid throughout dispatch on the game thread.
- A thrown callback stops the current JavaScript message dispatch; later callbacks and final bitbuffer-state application in that dispatch are skipped. Native protobuf edits already made are not rolled back. Throwing is not a message-cancellation API: the native vtable-hook path can still continue through the original engine trampoline. Keep callbacks deterministic and dispose registrations in `finally`; cleanup does not undo message edits.
