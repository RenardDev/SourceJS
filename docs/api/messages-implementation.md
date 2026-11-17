# `require("messages/implementation")`

> AI agents: use the contents list and process one bounded chunk at a time. This module is the decoded user-message codec registry used by `memory/hooks/messages`. Field order, selected-SDK fade scaling, Protobuf names, and change tracking are engine contracts. Verify each example on its documented backend; a bitbuffer-only custom codec is not Protobuf-capable, and test doubles do not verify a live native hook.

`messages/implementation` decodes common outgoing Source user messages into mutable `UserMessageData` objects and writes changed data back to bitbuffer or Protobuf buffers. It also owns strict multi-recipient wrappers around the native [`messages`](messages.md) module.

The module lives at `packages/sourcejs/messages/implementation.js`. Loading it captures `SCREEN_FADE_FRACTION_BITS` when native `GetBaseMessageConstants()` exists. Without that getter, other codecs and helpers can still load; the four `FadeUserMessageImplementation` backend methods throw `TypeError` before touching a buffer because their SDK scale is unavailable. Getter failures propagate rather than becoming fallback values. Registry operations additionally need native message-registry access. Direct SayText helper calls remain available only when the root native module exposes those bitbuffer capabilities; calling an absent method throws `TypeError`.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Recipient and send helpers](#recipient-and-send-helpers)
- [`UserMessageData`](#usermessagedata)
- [`UserMessageImplementation`](#usermessageimplementation)
- [Codec fields](#codec-fields)
- [Codec registry](#codec-registry)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

Each fence is an independent fragment for an initialized SourceJS runtime, not a standalone Node.js program. Send examples assume connected recipient indexes `1` and `2` and, where used, sender index `1`; select valid clients for the running server. Numeric client indexes are not native memory addresses.

```js
const {
	FadeUserMessageImplementation,
	HintTextUserMessageImplementation,
	HUDMessageUserMessageImplementation,
	KeyHintTextUserMessageImplementation,
	ResetHUDUserMessageImplementation,
	SayTextUserMessageImplementation,
	SayText2UserMessageImplementation,
	ShakeUserMessageImplementation,
	ShowMenuUserMessageImplementation,
	TextMessageUserMessageImplementation,
	UserMessageData,
	UserMessageImplementation,
	VGUIMenuUserMessageImplementation,
	GetUserMessageImplementation,
	IMPLEMENTED_USER_MESSAGES,
	NormalizeUserMessageRecipients,
	RefreshImplementedUserMessages,
	SendClientCommandToRecipients,
	SendClientConsoleMessageToRecipients,
	SendDialogMessageToRecipients,
	SendDialogMessageDataToRecipients,
	SendSayTextMessageToRecipients,
	SendSayText2MessageToRecipients,
	SendUserMessageToRecipients,
} = require("messages/implementation");

const g_vecDocumentedConstructors = [
	FadeUserMessageImplementation,
	HintTextUserMessageImplementation,
	HUDMessageUserMessageImplementation,
	KeyHintTextUserMessageImplementation,
	ResetHUDUserMessageImplementation,
	SayTextUserMessageImplementation,
	SayText2UserMessageImplementation,
	ShakeUserMessageImplementation,
	ShowMenuUserMessageImplementation,
	TextMessageUserMessageImplementation,
	UserMessageData,
	UserMessageImplementation,
	VGUIMenuUserMessageImplementation,
];
const g_vecDocumentedFunctions = [
	GetUserMessageImplementation,
	NormalizeUserMessageRecipients,
	RefreshImplementedUserMessages,
	SendClientCommandToRecipients,
	SendClientConsoleMessageToRecipients,
	SendDialogMessageToRecipients,
	SendDialogMessageDataToRecipients,
	SendSayTextMessageToRecipients,
	SendSayText2MessageToRecipients,
	SendUserMessageToRecipients,
];

for (const DocumentedConstructor of g_vecDocumentedConstructors) {
	if (typeof DocumentedConstructor !== "function") {
		throw new Error("The messages/implementation module did not expose every documented constructor.");
	}
}

for (const DocumentedFunction of g_vecDocumentedFunctions) {
	if (typeof DocumentedFunction !== "function") {
		throw new Error("The messages/implementation module did not expose every documented function.");
	}
}

if (!(IMPLEMENTED_USER_MESSAGES instanceof Map)) {
	throw new Error("The messages/implementation module did not expose the live codec map.");
}
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| `FadeUserMessageImplementation` | Static codec class | Fade bitbuffer/Protobuf codec. |
| `HintTextUserMessageImplementation` | Static codec class | HintText bitbuffer/Protobuf codec. |
| `HUDMessageUserMessageImplementation` | Static codec class | HudMsg bitbuffer/Protobuf codec. |
| `KeyHintTextUserMessageImplementation` | Static codec class | KeyHintText bitbuffer/Protobuf codec. |
| `ResetHUDUserMessageImplementation` | Static codec class | ResetHud bitbuffer/Protobuf codec. |
| `SayTextUserMessageImplementation` | Static codec class | SayText bitbuffer/Protobuf codec. |
| `SayText2UserMessageImplementation` | Static codec class | SayText2 bitbuffer/Protobuf codec. |
| `ShakeUserMessageImplementation` | Static codec class | Shake bitbuffer/Protobuf codec. |
| `ShowMenuUserMessageImplementation` | Static codec class | ShowMenu bitbuffer/Protobuf codec. |
| `TextMessageUserMessageImplementation` | Static codec class | TextMsg bitbuffer/Protobuf codec. |
| [`UserMessageData`](#usermessagedata) | Class | `new UserMessageData(MessageFields = {})` |
| [`UserMessageImplementation`](#usermessageimplementation) | Abstract static codec class | Backend-dispatch base class. |
| `VGUIMenuUserMessageImplementation` | Static codec class | VGUIMenu bitbuffer/Protobuf codec. |
| `GetUserMessageImplementation` | Function | `GetUserMessageImplementation(MessageNameOrIndex)` |
| `IMPLEMENTED_USER_MESSAGES` | Map | Live name/index-to-codec registry. |
| [`NormalizeUserMessageRecipients`](#normalizeusermessagerecipients) | Function | `NormalizeUserMessageRecipients(TargetReferences)` |
| `RefreshImplementedUserMessages` | Function | `RefreshImplementedUserMessages()` |
| `SendClientCommandToRecipients` | Function | `SendClientCommandToRecipients(TargetReferences, strCommandLine)` |
| [`SendClientConsoleMessageToRecipients`](#sendclientconsolemessagetorecipients-and-sendclientcommandtorecipients) | Function | `SendClientConsoleMessageToRecipients(TargetReferences, strMessageText)` |
| `SendDialogMessageToRecipients` | Function | `SendDialogMessageToRecipients(TargetReferences, strDialogTitle, strDialogMessage, dblDisplayTime = 10)` |
| [`SendDialogMessageDataToRecipients`](#senddialogmessagedatatorecipients-and-senddialogmessagetorecipients) | Function | `SendDialogMessageDataToRecipients(TargetReferences, unDialogType, DialogValues, strDialogName = "menu")` |
| [`SendSayTextMessageToRecipients`](#sendsaytextmessagetorecipients-and-sendsaytext2messagetorecipients) | Function | `SendSayTextMessageToRecipients(TargetReferences, strMessageText, unSenderIndex = 0, bSendToChat = true)` |
| `SendSayText2MessageToRecipients` | Function | `SendSayText2MessageToRecipients(TargetReferences, strMessageText, unSenderIndex = 0, bSendToChat = true)` |
| [`SendUserMessageToRecipients`](#sendusermessagetorecipients) | Function | `SendUserMessageToRecipients(TargetReferences, strMessageName, vecMessageFields, bReliableDelivery = false)` |

## Recipient and send helpers

### `NormalizeUserMessageRecipients()`

`NormalizeUserMessageRecipients()` delegates to [`filters/recipients.CreateRecipientFilterFromValues()`](filters-recipients.md), includes bots, removes duplicates, and returns a detached index array.

```js
const { NormalizeUserMessageRecipients } = require("messages/implementation");

const g_unExpectedRecipientCount = 2;
const g_vecRecipientIndexes = NormalizeUserMessageRecipients([1, { Index: 2 }, 1]);
const g_bHasExpectedRecipientCount = g_vecRecipientIndexes.length === g_unExpectedRecipientCount;
const g_bHasExpectedFirstRecipient = g_vecRecipientIndexes[0] === 1;
const g_bHasExpectedSecondRecipient = g_vecRecipientIndexes[1] === 2;
if (!g_bHasExpectedRecipientCount || !g_bHasExpectedFirstRecipient || !g_bHasExpectedSecondRecipient) {
	throw new Error("NormalizeUserMessageRecipients() did not flatten and deduplicate the targets.");
}

g_vecRecipientIndexes.push(3);

const g_vecRepeatedRecipientIndexes = NormalizeUserMessageRecipients([1, { Index: 2 }, 1]);
const g_bHasDetachedRecipientCount = g_vecRepeatedRecipientIndexes.length === g_unExpectedRecipientCount;
const g_bExcludedInjectedRecipient = !g_vecRepeatedRecipientIndexes.includes(3);
if (!g_bHasDetachedRecipientCount || !g_bExcludedInjectedRecipient) {
	throw new Error("NormalizeUserMessageRecipients() did not return a detached index array.");
}
```

All helpers except `SendUserMessageToRecipients()` require at least one normalized recipient before calling native code. The wrappers validate their string/boolean/numeric arguments before sending and require native results to be actual booleans; a non-boolean result throws `TypeError`, not a truthiness conversion. An empty list passed to `SendUserMessageToRecipients()` reaches native validation rather than being rejected by this JavaScript helper.

### `SendClientConsoleMessageToRecipients()` and `SendClientCommandToRecipients()`

These helpers loop over every normalized recipient and return `false` if any native call returns `false`; they do not skip later recipients after a failure. Native exceptions or non-boolean results propagate and stop the loop; earlier calls are not rolled back. These are synchronous native calls, not queued worker requests. A successful result reports the native operation's acceptance, not a client acknowledgement. Client commands must be trusted command-line strings; never concatenate unvalidated player input or secrets into them.

```js
const { SendClientCommandToRecipients, SendClientConsoleMessageToRecipients } = require("messages/implementation");

if (!SendClientConsoleMessageToRecipients([1, 2], "[SourceJS] Settings reloaded.\n")) {
	throw new Error("SendClientConsoleMessageToRecipients() did not reach every recipient.");
}

if (!SendClientCommandToRecipients(1, "echo SourceJS client command")) {
	throw new Error("SendClientCommandToRecipients() did not execute the trusted command line.");
}
```

### `SendSayTextMessageToRecipients()` and `SendSayText2MessageToRecipients()`

The direct helpers exist in this JavaScript module on every branch, but they can be called only when the selected native `messages` object exposes the corresponding bitbuffer method.

```js
const { SendSayTextMessage, SendSayText2Message } = require("messages");
const { SendSayTextMessageToRecipients, SendSayText2MessageToRecipients } = require("messages/implementation");

const g_bCanSendNativeSayTextMessage = typeof SendSayTextMessage === "function";
const g_bCanSendNativeSayText2Message = typeof SendSayText2Message === "function";
if (g_bCanSendNativeSayTextMessage) {
	if (!SendSayTextMessageToRecipients([1, 2], "Server restart in five minutes.", 0, true)) {
		throw new Error("SendSayTextMessageToRecipients() did not reach every recipient.");
	}

} else {
	let bRejectedMissingSayTextCapability = false;

	try {
		SendSayTextMessageToRecipients(1, "Capability check", 0, true);
	} catch (CapabilityError) {
		bRejectedMissingSayTextCapability = CapabilityError instanceof TypeError;
	}

	if (!bRejectedMissingSayTextCapability) {
		throw new Error("SendSayTextMessageToRecipients() did not expose the absent native capability.");
	}
}

if (g_bCanSendNativeSayText2Message) {
	if (!SendSayText2MessageToRecipients([1, 2], "\x04[Ready]\x01 Ren is ready.", 1, true)) {
		throw new Error("SendSayText2MessageToRecipients() did not reach every recipient.");
	}

} else {
	let bRejectedMissingSayText2Capability = false;

	try {
		SendSayText2MessageToRecipients(1, "Capability check", 0, true);
	} catch (CapabilityError) {
		bRejectedMissingSayText2Capability = CapabilityError instanceof TypeError;
	}

	if (!bRejectedMissingSayText2Capability) {
		throw new Error("SendSayText2MessageToRecipients() did not expose the absent native capability.");
	}
}
```

Use [`messages.SayText2.SendUserMessage()`](messages-types.md#saytext2) for a typed, portable bitbuffer/Protobuf send.

### `SendUserMessageToRecipients()`

`SendUserMessageToRecipients()` forwards an exact descriptor array to native code. Descriptor shape depends on `messages.GetMessageBackend()`.

```js
const { GetMessageBackend } = require("messages");
const { SendUserMessageToRecipients } = require("messages/implementation");

const g_bUsesBitBufferBackend = GetMessageBackend() === "bitbuffer";
if (g_bUsesBitBufferBackend) {
	if (!SendUserMessageToRecipients(1, "HintText", [{ Type: "string", Value: "Generator started" }], false)) {
		throw new Error("The bitbuffer HintText descriptor was not delivered.");
	}

} else {
	if (!SendUserMessageToRecipients(1, "HintText", [{ Kind: "SET", Name: "text", Type: "string", Value: "Generator started" }], false)) {
		throw new Error("The Protobuf HintText descriptor was not delivered.");
	}
}
```

This helper intentionally leaves final schema validation to native V8 bindings. Descriptor keys (`Type`, `Value`, `Kind`, and `Name`) are project-owned PascalCase API properties. Protobuf field-name values such as `Name: "text"` preserve the exact external schema spelling. Operation `Kind` codes are `SET`, `ADD`, `MESSAGE`, and `ADDMESSAGE`; `Type` values retain their compact lowercase spelling.

### `SendDialogMessageDataToRecipients()` and `SendDialogMessageToRecipients()`

`SendDialogMessageDataToRecipients()` passes the same plain payload object to each normalized recipient through `messages.CreateDialog()`; it does not clone the object. `SendDialogMessageToRecipients()` is a simple `messages.GetDialogType("Text")` convenience wrapper with `Level: 1`; its JavaScript display-time validation accepts any finite non-negative number, including fractional seconds. The SDK documents 10–200 seconds for plugin dialogs; the examples use that range. Neither helper filters fake clients, translates text, or maintains the `messages/dialog` module's per-recipient level counter.

A lower `Level` is a higher SDK priority, not a reliable replacement of an earlier window. Native `CreateMessage()` has no client-acknowledgement result: `true` from `CreateDialog()` is not proof that a window was shown. Native KeyValues construction uses UTF-8 C strings, so avoid embedded NUL characters in names and text. Cleanup is best-effort at the native boundary. A later failure does not undo earlier recipients' sends.

For each native `CreateDialog()` call, the initial recipient index and server-assigned user ID are captured before field conversion. Immediately before dispatch, SourceJS resolves a fresh edict at that index and rejects a missing/free edict, the invalid user ID (`-1`), or a changed user ID. Reentrant getters therefore cannot silently redirect that pending send to a new client in the same slot. The same user ID on a replacement edict is accepted; this is a pre-dispatch check, not a connection pin or delivery acknowledgement.

```js
const { GetDialogType } = require("messages");
const { SendDialogMessageDataToRecipients, SendDialogMessageToRecipients } = require("messages/implementation");

const g_dblRulesDisplayTime = 12;
const g_unLoadoutDisplayTime = 15;
const g_strRifleLoadout = "rifle";
if (!SendDialogMessageToRecipients(1, "Server rules", "Read the rules before playing.", g_dblRulesDisplayTime)) {
	throw new Error("SendDialogMessageToRecipients() did not deliver its text dialog.");
}

if (!SendDialogMessageDataToRecipients(1, GetDialogType("Menu"), {
	Level: 2,
	Msg: "Choose a loadout",
	Time: g_unLoadoutDisplayTime,
	Title: "Loadout",
	[g_strRifleLoadout]: {
		Command: "echo SourceJS rifle loadout",
		Msg: "Rifle",
	},
}, "menu")) {
	throw new Error("SendDialogMessageDataToRecipients() did not deliver its nested menu payload.");
}
```

The menu's trusted `echo` command demonstrates nested KeyValues without registering a plugin command; it does not actually change a loadout. Dynamic option labels such as `rifle` are opaque menu choices, not JavaScript API property names. Use [`messages/dialog`](messages-dialog.md) for per-player translation, fake-client filtering, and interactive dialog classes, including examples that register, validate, and release their owned plugin commands. Releasing a command does not withdraw an already displayed native window.

## `UserMessageData`

`UserMessageData` exposes its initial logical fields as live own accessors while tracking whether a hook changed the decoded message. The built-in codecs use PascalCase fields such as `Chat`, `Message`, and `SenderIndex`, and translate exact external Protobuf names at the codec boundary. Custom field names are stored exactly as supplied; use PascalCase for project-owned fields.

| Member | Description |
| --- | --- |
| `GetUserMessageField(strFieldName, DefaultFieldValue = undefined)` | Reads a tracked field or the default. |
| `SetUserMessageField(strFieldName, FieldValue)` | Adds or updates a tracked field and returns `this`. |
| `DeleteUserMessageField(strFieldName)` | Removes a field and returns whether it existed. |
| `HasUserMessageChanged()` | Returns the current change flag. |
| `SetUserMessageChanged(bHasChanged = true)` | Explicitly sets the change flag and returns `this`. |

```js
const { UserMessageData } = require("messages/implementation");

const g_UserMessageDataValue = new UserMessageData({ Chat: true, Message: "Original" });
const g_bMessageChangedInitially = g_UserMessageDataValue.HasUserMessageChanged();
const g_bHasExpectedInitialMessage = g_UserMessageDataValue.GetUserMessageField("Message") === "Original";
const g_bResolvedDefaultField = g_UserMessageDataValue.GetUserMessageField("Missing", "default") === "default";
if (g_bMessageChangedInitially || !g_bHasExpectedInitialMessage || !g_bResolvedDefaultField) {
	throw new Error("UserMessageData did not expose its unchanged initial fields.");
}

g_UserMessageDataValue.Message = "Changed through live field";

const g_bSetReturnedUserMessageData = g_UserMessageDataValue.SetUserMessageField("SenderIndex", 1) === g_UserMessageDataValue;
const g_bSetExpectedSenderIndex = g_UserMessageDataValue.SenderIndex === 1;
if (!g_bSetReturnedUserMessageData || !g_bSetExpectedSenderIndex) {
	throw new Error("UserMessageData.SetUserMessageField() did not add a tracked live field.");
}

const g_bDeletedChatField = g_UserMessageDataValue.DeleteUserMessageField("Chat");
const g_bHasChatField = Object.hasOwn(g_UserMessageDataValue, "Chat");
const g_bTrackedFieldChanges = g_UserMessageDataValue.HasUserMessageChanged();
if (!g_bDeletedChatField || g_bHasChatField || !g_bTrackedFieldChanges) {
	throw new Error("UserMessageData.DeleteUserMessageField() did not remove and track the field.");
}

const g_bSetChangeReturnedUserMessageData = g_UserMessageDataValue.SetUserMessageChanged(false) === g_UserMessageDataValue;
const g_bMessageRemainedChanged = g_UserMessageDataValue.HasUserMessageChanged();
if (!g_bSetChangeReturnedUserMessageData || g_bMessageRemainedChanged) {
	throw new Error("UserMessageData.SetUserMessageChanged(false) did not reset change tracking.");
}

g_UserMessageDataValue.Untracked = "metadata";

if (g_UserMessageDataValue.HasUserMessageChanged()) {
	throw new Error("An unrelated property unexpectedly became tracked codec data.");
}
```

Direct assignment tracks existing fields, even when the new value equals the old value. Use `SetUserMessageField()` to create a new tracked field; assigning an unrelated new JavaScript property does not register codec data. Tracking is shallow: mutating an array/object stored inside a field does not set the change flag. After a nested edit, call `SetUserMessageChanged(true)` or assign the field through its tracked setter.

The constructor accepts a plain object (ordinary or null prototype), copies its own enumerable string-named fields into the tracked map, and initially reports unchanged. Values are retained by reference, not deep-cloned. Field names must be non-empty strings. Do not use names that shadow `UserMessageData` methods or redefine its accessors; use the managed get/set/delete operations rather than directly deleting or redefining a tracked property. `DeleteUserMessageField()` returns `false` for a missing field without setting the flag; clearing the flag does not restore old values.

## `UserMessageImplementation`

Built-in codecs implement four backend-specific operations and inherit two dispatch operations:

| Member | Description |
| --- | --- |
| `ReadUserMessageFromBitBuffer(BitBuffer)` | Decodes a `BitBufferRead` into `UserMessageData`. |
| `WriteUserMessageToBitBuffer(BitBuffer, MessageData)` | Writes logical data in exact bitbuffer field order. |
| `ReadUserMessageFromProtobuf(ProtobufBuffer)` | Decodes a live native Protobuf adapter. |
| `WriteUserMessageToProtobuf(ProtobufBuffer, MessageData)` | Writes logical fields to a live native Protobuf adapter. |
| `ReadUserMessage(MessageBuffer)` | Selects Protobuf for a non-null object with a callable `GetString` or `SetString`; otherwise bitbuffer. |
| `WriteUserMessage(MessageBuffer, MessageData)` | Uses the same structural backend test, invokes the writer, and returns the original `MessageBuffer`; it does not report transport delivery. |

The backend-specific base methods throw `TypeError` until a subclass implements them. Dispatch tests method shape, not the engine's selected backend or the complete adapter interface; a partial adapter can select Protobuf and then fail when another required method is absent. Readers consume the current buffer cursor, and writers mutate the supplied buffer without rollback on failure. The bitbuffer-only example below overrides just that backend's read/write pair; it does not support Protobuf.

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { UserMessageData, UserMessageImplementation } = require("messages/implementation");

class ByteFlagUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromBitBuffer(BitBufferReader) {
		return new UserMessageData({ Value: BitBufferReader.ReadByte() });
	}

	static WriteUserMessageToBitBuffer(BitBufferWriter, MessageData) {
		BitBufferWriter.WriteByte(MessageData.Value);
	}
}

const g_unByteFlagBufferSize = 1;
const g_unByteFlagValue = 0x07;
const g_BitBufferWriter = new BitBufferWrite(g_unByteFlagBufferSize);
const g_ReturnedBitBuffer = ByteFlagUserMessageImplementation.WriteUserMessage(g_BitBufferWriter, { Value: g_unByteFlagValue });
if (g_ReturnedBitBuffer !== g_BitBufferWriter) {
	throw new Error("UserMessageImplementation.WriteUserMessage() did not return the selected buffer.");
}

const g_DecodedUserMessageData = ByteFlagUserMessageImplementation.ReadUserMessage(new BitBufferRead(g_BitBufferWriter));
const g_bIsDecodedUserMessageData = g_DecodedUserMessageData instanceof UserMessageData;
const g_bHasExpectedDecodedValue = g_DecodedUserMessageData.Value === g_unByteFlagValue;
const g_bDecodedMessageChanged = g_DecodedUserMessageData.HasUserMessageChanged();
if (!g_bIsDecodedUserMessageData || !g_bHasExpectedDecodedValue || g_bDecodedMessageChanged) {
	throw new Error("UserMessageImplementation.ReadUserMessage() did not return unchanged decoded data.");
}
```

### Live Protobuf rewrite

On Protobuf games, a raw hook supplies a borrowed native adapter valid only during the callback on the game thread. Do not retain it, its child adapters, or use them asynchronously. Clear it before rewriting a complete message because repeated fields append; clearing also removes fields not modeled by the codec, so this pattern requires a codec that covers the message fields you need to preserve. Clearing and writing are not transactional; a failed rewrite can leave a partially changed outgoing message.

This short-lived demonstration expects the exact controlled SayText2 message sent below, not arbitrary chat. Publish cleanup before acquiring the hook, retain ownership when disposal fails, and preserve both startup and cleanup errors. `UnloadPlugin()` is idempotent after successful cleanup; `DisposeUserMessageHook()` itself returns `false` when the callback is already absent. The case-sensitive SourceJS-owned `exports.Unload` is the runtime lifecycle contract; no lowercase alias is installed.

```js
const { GetMessageBackend, SayText2 } = require("messages");
const { ProtobufUserMessageHook } = require("memory/hooks/messages");
const { SayText2UserMessageImplementation } = require("messages/implementation");

if (GetMessageBackend() === "protobuf") {
	if (typeof ProtobufUserMessageHook !== "function") {
		throw new Error("The Protobuf backend did not expose ProtobufUserMessageHook.");
	}

	let bMessageRewritten = false;
	let MessageHook = null;

	function UnloadPlugin() {
		if (MessageHook === null) {
			return true;
		}

		const bHadCallback = MessageHook.Callback !== null;
		const bDisposed = MessageHook.DisposeUserMessageHook();
		if (bHadCallback && !bDisposed) {
			throw new Error("ProtobufUserMessageHook.DisposeUserMessageHook() could not release its callback.");
		}

		MessageHook = null;

		return true;
	}

	function RewriteSayText2Callback(RecipientFilter, ProtobufBuffer) {
		const bIncludesRecipient = RecipientFilter.RecipientIndexes.includes(1);
		if (!bIncludesRecipient) {
			throw new Error("ProtobufUserMessageHook received unexpected recipients.");
		}

		const MessageData = SayText2UserMessageImplementation.ReadUserMessageFromProtobuf(ProtobufBuffer);
		if (!MessageData.Message.endsWith("Original Protobuf message")) {
			throw new Error("SayText2UserMessageImplementation.ReadUserMessageFromProtobuf() did not decode the outgoing Protobuf message.");
		}

		MessageData.Message = MessageData.Message.replace("Original Protobuf message", "Rewritten by SourceJS");
		ProtobufBuffer.Clear();
		SayText2UserMessageImplementation.WriteUserMessageToProtobuf(ProtobufBuffer, MessageData);
		bMessageRewritten = true;
	}

	exports.Unload = UnloadPlugin;

	try {
		MessageHook = new ProtobufUserMessageHook("SayText2");
		MessageHook.RegisterUserMessageHook(RewriteSayText2Callback);

		const SayText2Message = new SayText2("Original Protobuf message", {
			Chat: true,
			Parameter1: "",
			Parameter2: "",
			Parameter3: "",
			Parameter4: "",
			SenderIndex: 1,
		});
		const bSentSayText2Message = SayText2Message.SendUserMessage(1);
		const bHasExpectedHookMessageName = MessageHook.MessageName === "SayText2";
		if (!bSentSayText2Message || !bMessageRewritten || !bHasExpectedHookMessageName) {
			throw new Error("The live Protobuf hook did not rewrite SayText2.");
		}
	} catch (CaughtError) {
		try {
			UnloadPlugin();
		} catch (CleanupError) {
			throw new AggregateError([CaughtError, CleanupError], "Starting and releasing the Protobuf rewrite hook both failed.");
		}

		throw CaughtError;
	}

	UnloadPlugin();

} else {
	if (typeof ProtobufUserMessageHook !== "undefined") {
		throw new Error("The bitbuffer backend unexpectedly exposed ProtobufUserMessageHook.");
	}
}
```

Decoded [`UserMessageHook`](memory-hooks-messages.md#usermessagehook) performs this clear/rewrite lifecycle automatically when `UserMessageData.HasUserMessageChanged()` returns `true`.

## Codec fields

`UserMessageData` fields use PascalCase. Protobuf names retain their exact external spelling at codec boundaries; bitbuffer fields are positional. The codec methods borrow the supplied buffers and never rewind their cursors, allocate replacement native buffers, or send transport messages themselves.

Provide sufficient bitbuffer capacity and validate wire-width limits before writing: a JavaScript safe integer is not automatically a valid byte, word, or signed native field. The codec normalizers do not enforce every wire width or detect every native overflow. In particular, the bitbuffer KeyHintText header is exactly `1`, followed by one newline-joined string (an empty `Hints` array writes an empty string to clear the display). Its decoder rejects other counts and returns `Hints` containing the single wire string; embedded newlines make the original array boundaries unrecoverable. Protobuf retains separate repeated `hints` entries. VGUI entry counts must fit one byte; strings use the native buffer's encoding and terminator contract, not JavaScript character counts. Do not treat the successful fixture round trips below as proof of live SDK layouts or overflow handling.

| Codec | Logical fields |
| --- | --- |
| `SayTextUserMessageImplementation` | `SenderIndex`, `Message`, `Chat` |
| `SayText2UserMessageImplementation` | `SenderIndex`, `Chat`, `Message`, `Parameter1` through `Parameter4` |
| `HintTextUserMessageImplementation` | `Message` |
| `ShakeUserMessageImplementation` | `ShakeCommand`, `Amplitude`, `Frequency`, `Duration` |
| `ResetHUDUserMessageImplementation` | `Reset` |
| `TextMessageUserMessageImplementation` | `Destination`, `Message`, `Parameter1` through `Parameter4` |
| `KeyHintTextUserMessageImplementation` | `Hints` array |
| `FadeUserMessageImplementation` | `Duration`, `HoldTime`, `Flags`, `Color` |
| `HUDMessageUserMessageImplementation` | `Channel`, `X`, `Y`, `Color1`, `Color2`, `Effect`, `FadeIn`, `FadeOut`, `HoldTime`, `EffectTime`, `Message` |
| `ShowMenuUserMessageImplementation` | `ValidSlots`, `DisplayTime`, `MenuString`; bitbuffer also has `Chunked` |
| `VGUIMenuUserMessageImplementation` | `Name`, `Show`, `Subkeys` plain object |

### `SayTextUserMessageImplementation` and `SayText2UserMessageImplementation`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { SayTextUserMessageImplementation, SayText2UserMessageImplementation } = require("messages/implementation");

const g_unSayTextByteCapacity = 128;
const g_unSayText2ByteCapacity = 256;
const g_SayTextBitBufferWriter = new BitBufferWrite(g_unSayTextByteCapacity);
SayTextUserMessageImplementation.WriteUserMessageToBitBuffer(g_SayTextBitBufferWriter, { Chat: true, Message: "Simple chat", SenderIndex: 1 });

const g_SayTextUserMessageData = SayTextUserMessageImplementation.ReadUserMessageFromBitBuffer(new BitBufferRead(g_SayTextBitBufferWriter));
const g_bHasExpectedSayTextSenderIndex = g_SayTextUserMessageData.SenderIndex === 1;
const g_bHasExpectedSayTextMessage = g_SayTextUserMessageData.Message === "Simple chat";
const g_bHasExpectedSayTextChatFlag = g_SayTextUserMessageData.Chat;
if (!g_bHasExpectedSayTextSenderIndex || !g_bHasExpectedSayTextMessage || !g_bHasExpectedSayTextChatFlag) {
	throw new Error("SayTextUserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve its bitbuffer fields.");
}

const g_SayText2BitBufferWriter = new BitBufferWrite(g_unSayText2ByteCapacity);
SayText2UserMessageImplementation.WriteUserMessageToBitBuffer(g_SayText2BitBufferWriter, {
	Chat: true,
	Message: "Parameterized chat",
	Parameter1: "Ren",
	Parameter2: "ready",
	Parameter3: "",
	Parameter4: "",
	SenderIndex: 1,
});

const g_SayText2UserMessageData = SayText2UserMessageImplementation.ReadUserMessageFromBitBuffer(new BitBufferRead(g_SayText2BitBufferWriter));
const g_bHasExpectedSayText2SenderIndex = g_SayText2UserMessageData.SenderIndex === 1;
const g_bHasExpectedSayText2Message = g_SayText2UserMessageData.Message === "Parameterized chat";
const g_bHasExpectedSayText2Parameter = g_SayText2UserMessageData.Parameter2 === "ready";
const g_bHasExpectedSayText2ChatFlag = g_SayText2UserMessageData.Chat;
if (!g_bHasExpectedSayText2SenderIndex || !g_bHasExpectedSayText2Message || !g_bHasExpectedSayText2Parameter || !g_bHasExpectedSayText2ChatFlag) {
	throw new Error("SayText2UserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve its bitbuffer fields.");
}
```

`SayTextUserMessageImplementation` bitbuffer order is sender byte, message string, then chat byte. `SayText2UserMessageImplementation` uses sender byte, chat byte, message, and four parameter strings.

### `HintTextUserMessageImplementation`, `ShakeUserMessageImplementation`, and `ResetHUDUserMessageImplementation`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { SHAKE_COMMAND } = require("messages");
const { HintTextUserMessageImplementation, ResetHUDUserMessageImplementation, ShakeUserMessageImplementation } = require("messages/implementation");

function RoundTripUserMessage(UserMessageImplementationClass, MessageFields, unByteCapacity = 128) {
	const BitBufferWriter = new BitBufferWrite(unByteCapacity);
	UserMessageImplementationClass.WriteUserMessageToBitBuffer(BitBufferWriter, MessageFields);

	return UserMessageImplementationClass.ReadUserMessageFromBitBuffer(new BitBufferRead(BitBufferWriter));
}

const g_dblShakeAmplitude = 4;
const g_dblShakeDuration = 1.5;
const g_dblShakeFrequency = 2;
const g_dblFloatTolerance = 0.0001;
const g_HintTextUserMessageData = RoundTripUserMessage(HintTextUserMessageImplementation, { Message: "Use the mounted gun" });
const g_ShakeUserMessageData = RoundTripUserMessage(ShakeUserMessageImplementation, { Amplitude: g_dblShakeAmplitude, Duration: g_dblShakeDuration, Frequency: g_dblShakeFrequency, ShakeCommand: SHAKE_COMMAND.Start });
const g_ResetHUDUserMessageData = RoundTripUserMessage(ResetHUDUserMessageImplementation, { Reset: true });
if (g_HintTextUserMessageData.Message !== "Use the mounted gun") {
	throw new Error("HintTextUserMessageImplementation did not preserve its message.");
}

const g_bHasExpectedShakeCommand = g_ShakeUserMessageData.ShakeCommand === SHAKE_COMMAND.Start;
const g_bHasExpectedShakeAmplitude = Math.abs(g_ShakeUserMessageData.Amplitude - g_dblShakeAmplitude) <= g_dblFloatTolerance;
const g_bHasExpectedShakeDuration = Math.abs(g_ShakeUserMessageData.Duration - g_dblShakeDuration) <= g_dblFloatTolerance;
const g_bHasExpectedShakeFrequency = Math.abs(g_ShakeUserMessageData.Frequency - g_dblShakeFrequency) <= g_dblFloatTolerance;
if (!g_bHasExpectedShakeCommand || !g_bHasExpectedShakeAmplitude || !g_bHasExpectedShakeDuration || !g_bHasExpectedShakeFrequency) {
	throw new Error("ShakeUserMessageImplementation did not preserve its selected-SDK command and values.");
}

if (g_ResetHUDUserMessageData.Reset !== true) {
	throw new Error("ResetHUDUserMessageImplementation did not preserve its reset flag.");
}
```

### `TextMessageUserMessageImplementation` and `KeyHintTextUserMessageImplementation`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { HUD_DESTINATION } = require("messages");
const { KeyHintTextUserMessageImplementation, TextMessageUserMessageImplementation } = require("messages/implementation");

const g_unTextByteCapacity = 256;
const g_unHintsByteCapacity = 128;
const g_unExpectedHintCount = 1;
const g_TextBitBufferWriter = new BitBufferWrite(g_unTextByteCapacity);
TextMessageUserMessageImplementation.WriteUserMessageToBitBuffer(g_TextBitBufferWriter, {
	Destination: HUD_DESTINATION.Center,
	Message: "Wave incoming",
	Parameter1: "5",
	Parameter2: "",
	Parameter3: "",
	Parameter4: "",
});

const g_TextUserMessageData = TextMessageUserMessageImplementation.ReadUserMessageFromBitBuffer(new BitBufferRead(g_TextBitBufferWriter));
const g_bHasExpectedTextDestination = g_TextUserMessageData.Destination === HUD_DESTINATION.Center;
const g_bHasExpectedTextMessage = g_TextUserMessageData.Message === "Wave incoming";
const g_bHasExpectedTextParameter = g_TextUserMessageData.Parameter1 === "5";
if (!g_bHasExpectedTextDestination || !g_bHasExpectedTextMessage || !g_bHasExpectedTextParameter) {
	throw new Error("TextMessageUserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve its destination and parameters.");
}

const g_HintsBitBufferWriter = new BitBufferWrite(g_unHintsByteCapacity);
KeyHintTextUserMessageImplementation.WriteUserMessageToBitBuffer(g_HintsBitBufferWriter, { Hints: ["Press E to use", "Press R to reload"] });

const g_KeyHintTextUserMessageData = KeyHintTextUserMessageImplementation.ReadUserMessageFromBitBuffer(new BitBufferRead(g_HintsBitBufferWriter));
const g_bHasExpectedHintCount = g_KeyHintTextUserMessageData.Hints.length === g_unExpectedHintCount;
const g_bHasExpectedHintText = g_KeyHintTextUserMessageData.Hints[0] === "Press E to use\nPress R to reload";
if (!g_bHasExpectedHintCount || !g_bHasExpectedHintText) {
	throw new Error("KeyHintTextUserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve its single wire string.");
}
```

### `FadeUserMessageImplementation` and `HUDMessageUserMessageImplementation`

`FadeUserMessageImplementation` uses the selected SDK's `SCREEN_FADE_FRACTION_BITS`; it does not assume one game's fixed-point scale. `Duration` and `HoldTime` are logical seconds: multiplying by that scale must produce a safe integer or the writer throws `TypeError`. There is no implicit rounding. Also respect the selected bitbuffer/Protobuf field range before writing.

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { FADE_FLAGS } = require("messages");
const { FadeUserMessageImplementation, HUDMessageUserMessageImplementation } = require("messages/implementation");

const g_unFadeByteCapacity = 64;
const g_unHUDByteCapacity = 256;
const g_unMaximumColorComponent = 0xFF;
const g_unFadeAlpha = 0xB4;
const g_dblFadeDuration = 1;
const g_dblFadeHoldTime = 2;
const g_dblHUDYPosition = 0.2;
const g_dblFloatTolerance = 0.0001;
const g_FadeBitBufferWriter = new BitBufferWrite(g_unFadeByteCapacity);
FadeUserMessageImplementation.WriteUserMessageToBitBuffer(g_FadeBitBufferWriter, {
	Color: { Red: 0x00, Green: 0x00, Blue: 0x00, Alpha: g_unFadeAlpha },
	Duration: g_dblFadeDuration,
	Flags: FADE_FLAGS.Out,
	HoldTime: g_dblFadeHoldTime,
});

const g_FadeUserMessageData = FadeUserMessageImplementation.ReadUserMessageFromBitBuffer(new BitBufferRead(g_FadeBitBufferWriter));
const g_bHasExpectedFadeDuration = g_FadeUserMessageData.Duration === g_dblFadeDuration;
const g_bHasExpectedFadeHoldTime = g_FadeUserMessageData.HoldTime === g_dblFadeHoldTime;
const g_bHasExpectedFadeFlags = g_FadeUserMessageData.Flags === FADE_FLAGS.Out;
const g_bHasExpectedFadeAlpha = g_FadeUserMessageData.Color.Alpha === g_unFadeAlpha;
if (!g_bHasExpectedFadeDuration || !g_bHasExpectedFadeHoldTime || !g_bHasExpectedFadeFlags || !g_bHasExpectedFadeAlpha) {
	throw new Error("FadeUserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve its selected-SDK scaled fields.");
}

const g_HUDBitBufferWriter = new BitBufferWrite(g_unHUDByteCapacity);
HUDMessageUserMessageImplementation.WriteUserMessageToBitBuffer(g_HUDBitBufferWriter, {
	Channel: 3,
	Color1: { Red: 0x50, Green: 0xDC, Blue: 0x50, Alpha: g_unMaximumColorComponent },
	Color2: { Red: g_unMaximumColorComponent, Green: g_unMaximumColorComponent, Blue: g_unMaximumColorComponent, Alpha: g_unMaximumColorComponent },
	Effect: 0,
	EffectTime: 0,
	FadeIn: 0.2,
	FadeOut: 0.5,
	HoldTime: 4,
	Message: "Reach the extraction point",
	X: -1,
	Y: g_dblHUDYPosition,
});

const g_HUDUserMessageData = HUDMessageUserMessageImplementation.ReadUserMessageFromBitBuffer(new BitBufferRead(g_HUDBitBufferWriter));
const g_bHasExpectedHUDChannel = g_HUDUserMessageData.Channel === 3;
const g_bHasExpectedHUDMessage = g_HUDUserMessageData.Message === "Reach the extraction point";
const g_bHasExpectedHUDPosition = Math.abs(g_HUDUserMessageData.Y - g_dblHUDYPosition) <= g_dblFloatTolerance;
const g_bHasExpectedHUDColor = g_HUDUserMessageData.Color1.Green === 0xDC;
if (!g_bHasExpectedHUDChannel || !g_bHasExpectedHUDMessage || !g_bHasExpectedHUDPosition || !g_bHasExpectedHUDColor) {
	throw new Error("HUDMessageUserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve its position, color, and text.");
}
```

### `ShowMenuUserMessageImplementation` and `VGUIMenuUserMessageImplementation`

```js
const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { ShowMenuUserMessageImplementation, VGUIMenuUserMessageImplementation } = require("messages/implementation");

const g_unShowMenuByteCapacity = 128;
const g_unVGUIMenuByteCapacity = 256;
const g_nMenuDisplayTime = 10;
const g_unValidMenuSlots = 0x0201;
const g_ShowMenuBitBufferWriter = new BitBufferWrite(g_unShowMenuByteCapacity);
ShowMenuUserMessageImplementation.WriteUserMessageToBitBuffer(g_ShowMenuBitBufferWriter, { Chunked: false, DisplayTime: g_nMenuDisplayTime, MenuString: "1. Continue\n0. Close", ValidSlots: g_unValidMenuSlots });

const g_ShowMenuUserMessageData = ShowMenuUserMessageImplementation.ReadUserMessageFromBitBuffer(new BitBufferRead(g_ShowMenuBitBufferWriter));
const g_bHasExpectedValidSlots = g_ShowMenuUserMessageData.ValidSlots === g_unValidMenuSlots;
const g_bHasExpectedMenuDisplayTime = g_ShowMenuUserMessageData.DisplayTime === g_nMenuDisplayTime;
const g_bHasExpectedMenuChunkState = !g_ShowMenuUserMessageData.Chunked;
const g_bHasExpectedMenuString = g_ShowMenuUserMessageData.MenuString === "1. Continue\n0. Close";
if (!g_bHasExpectedValidSlots || !g_bHasExpectedMenuDisplayTime || !g_bHasExpectedMenuChunkState || !g_bHasExpectedMenuString) {
	throw new Error("ShowMenuUserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve its bitbuffer fields.");
}

const g_VGUIMenuBitBufferWriter = new BitBufferWrite(g_unVGUIMenuByteCapacity);
const g_VGUISubkeyValues = { title: "SourceJS", type: "2" };
Object.defineProperty(g_VGUISubkeyValues, "__proto__", { configurable: true, enumerable: true, value: "literal engine key", writable: true });

VGUIMenuUserMessageImplementation.WriteUserMessageToBitBuffer(g_VGUIMenuBitBufferWriter, { Name: "info", Show: true, Subkeys: g_VGUISubkeyValues });

const g_VGUIMenuUserMessageData = VGUIMenuUserMessageImplementation.ReadUserMessageFromBitBuffer(new BitBufferRead(g_VGUIMenuBitBufferWriter));
const g_bHasExpectedVGUIMenuName = g_VGUIMenuUserMessageData.Name === "info";
const g_bHasExpectedVGUIMenuShowFlag = g_VGUIMenuUserMessageData.Show === true;
const g_bHasExpectedVGUIMenuTitle = g_VGUIMenuUserMessageData.Subkeys.title === "SourceJS";
if (!g_bHasExpectedVGUIMenuName || !g_bHasExpectedVGUIMenuShowFlag || !g_bHasExpectedVGUIMenuTitle) {
	throw new Error("VGUIMenuUserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve its root and ordinary subkey fields.");
}

const g_bHasLiteralPrototypeKey = Object.hasOwn(g_VGUIMenuUserMessageData.Subkeys, "__proto__");
const g_bHasExpectedPrototypeValue = g_VGUIMenuUserMessageData.Subkeys["__proto__"] === "literal engine key";
if (!g_bHasLiteralPrototypeKey || !g_bHasExpectedPrototypeValue) {
	throw new Error("VGUIMenuUserMessageImplementation.ReadUserMessageFromBitBuffer() did not preserve the literal __proto__ engine key safely.");
}
```

`ShowMenu` stores `ValidSlots` as an unsigned 16-bit word and `DisplayTime` as a signed 8-bit value on bitbuffer games; the Protobuf fields are signed 32-bit values. The bitbuffer codec also preserves the continuation flag in `Chunked`.

The VGUI decoder creates own subkey properties safely, including an engine key literally named `__proto__`. VGUI subkey names such as `title` and `type` are external engine keys, not project-owned logical field names; retain their exact spelling.

## Codec registry

`IMPLEMENTED_USER_MESSAGES` is a live `Map`. It initially maps 11 supported engine message names to codecs; having a codec does not establish that the selected game's registry exposes that message. `RefreshImplementedUserMessages()` resolves indexes for the built-in names and adds or updates their numeric keys; it does not clear old or custom entries. Earlier updates are not rolled back if a later registry lookup throws. Numeric entries are cached and can still refer to an earlier codec until refreshed; do not reuse stale indexes across engine registry changes.

`GetUserMessageImplementation()` accepts only a string name or safe non-negative integer index. A missing numeric entry triggers a refresh, then falls back to lookup by the engine's message name. Map values are returned without codec validation: register a class implementing the required backend methods, not `undefined` or an arbitrary object.

```js
const { GetUserMessageIndex } = require("messages");
const {
	HintTextUserMessageImplementation,
	GetUserMessageImplementation,
	IMPLEMENTED_USER_MESSAGES,
	RefreshImplementedUserMessages,
} = require("messages/implementation");

if (RefreshImplementedUserMessages() !== IMPLEMENTED_USER_MESSAGES) {
	throw new Error("RefreshImplementedUserMessages() did not return the live registry.");
}

const g_nHintTextMessageIndex = GetUserMessageIndex("HintText");
if (g_nHintTextMessageIndex < 0) {
	throw new Error("The selected SDK does not expose the HintText user message.");
}

const g_HintTextUserMessageImplementationByName = GetUserMessageImplementation("HintText");
const g_HintTextUserMessageImplementationByIndex = GetUserMessageImplementation(g_nHintTextMessageIndex);

if (IMPLEMENTED_USER_MESSAGES.has("CustomHint")) {
	throw new Error("The isolated codec registry already owns CustomHint.");
}

IMPLEMENTED_USER_MESSAGES.set("CustomHint", HintTextUserMessageImplementation);

try {
	const bResolvedImplementationByName = g_HintTextUserMessageImplementationByName === HintTextUserMessageImplementation;
	const bResolvedImplementationByIndex = g_HintTextUserMessageImplementationByIndex === HintTextUserMessageImplementation;
	const bResolvedCustomImplementation = GetUserMessageImplementation("CustomHint") === HintTextUserMessageImplementation;
	if (!bResolvedImplementationByName || !bResolvedImplementationByIndex || !bResolvedCustomImplementation) {
		throw new Error("The live codec registry did not resolve names and indexes consistently.");
	}
} finally {
	if (IMPLEMENTED_USER_MESSAGES.get("CustomHint") === HintTextUserMessageImplementation) {
		if (!IMPLEMENTED_USER_MESSAGES.delete("CustomHint")) {
			throw new Error("The owned custom codec registration could not be removed.");
		}
	}
}
```

The decoded hook API resolves codecs through `GetUserMessageImplementation()`, which reads this live map. This fragment temporarily acquires `CustomHint` and removes it in `finally` only while it still points to the exact acquired codec; it does not delete another owner's replacement. A persistent registration belongs to the current isolated plugin context and requires an owned cleanup path published before subsequent startup work can fail.

## Errors

- Send helpers except `SendUserMessageToRecipients()` throw `TypeError` when normalization produces no indexes.
- `SendSayTextMessageToRecipients()` and `SendSayText2MessageToRecipients()` expose the normal V8 `TypeError` when the selected native module omits the corresponding capability.
- Codec readers and writers throw when the buffer lacks a required method or a supplied logical field has the wrong type. Defaults apply only where the codec supplies them; booleans also accept numeric `0`/`1`. Color components outside `0x00`–`0xFF` throw `RangeError`. These checks are not complete wire-range validation.
- `UserMessageImplementation` abstract read/write methods throw until a concrete codec implements that backend.
- `GetUserMessageImplementation()` throws `TypeError` for unsupported names, valid indexes with no supported serializer, invalid indexes, and values of any other type, assuming the live map has not been populated with invalid values. A valid but unsupported index reports the missing serializer, not an argument-type error. Native registry lookup failures propagate.

## Lifecycle

Codec implementation classes are static schema owners and require no construction or disposal. `IMPLEMENTED_USER_MESSAGES` is a live map in the current isolated plugin context; remove only owned custom entries during plugin cleanup. Raw Protobuf hooks own callback registrations and must be released with `DisposeUserMessageHook()`, including when decoding or rewriting throws. Keep the hook object available for retry if callback removal or native-hook cleanup fails; never discard it merely because a cleanup call was attempted. If the callback was already removed before native cleanup threw, retrying disposal can return `false` after successful remaining cleanup.

## Related modules

- [`messages`](messages.md) provides selected-SDK `GetMessageBackend()` discovery and native transport.
- [Typed messages classes](messages-types.md) provide message creators through `require("messages")`.
- [`messages/dialog`](messages-dialog.md) provides translated per-player dialog objects.
- [`memory/hooks/messages`](memory-hooks-messages.md) uses these codecs for managed outgoing-message interception.
- [`bitbuffers`](bitbuffers.md) provides the concrete bitbuffer reader and writer classes used by codec examples.
