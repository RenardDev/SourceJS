# `require("messages")`

> AI agents: use the contents list and process one bounded chunk at a time. Typed creators own selected-SDK bitbuffer and Protobuf schemas. Preserve field order, external descriptor names, and SDK constants. Endpoint doubles do not prove live SDK/client delivery.

`messages` provides typed constructors for common Source user messages. Built-in engine-message creators convert JavaScript fields into selected-SDK bitbuffer or Protobuf descriptors, group translated sends by client language, exclude fake clients, and send through [`messages.SendUserMessage()`](messages.md#sendusermessage). `TextMessage` instead formats text for the client's developer console through `IVEngineServer::ClientPrintf()`.

Availability follows the selected SDK. The constants and the `Fade`, `HUDTextMessage`, and `Shake` classes are exposed only when native `messages.GetBaseMessageConstants()` is available; independent message classes remain available without it. Native forwarding helpers are exported only when their native capability exists: in particular, `GetUserMessageSize` is not exported on Protobuf branches. The complete import inventory below targets a bitbuffer SDK exposing all listed capabilities. Wire delivery requires native `messages.SendUserMessage()`, a running server, and valid recipients; typed creators need at least one connected human recipient because they exclude fake clients. These messages do not target the game main menu. Call them synchronously on the game thread; they are not queued Redis/CPR/SOCI/socket requests. A successful dispatch does not acknowledge client receipt or visible output. Each executable fence is an independent plugin fragment in an initialized SourceJS runtime; index `1` must identify an actual connected client.

Reading an omitted capability property normally returns `undefined`; calling it throws `TypeError`. A present export can still reject a call when its required live SDK interface is unavailable. Use capability checks outside the complete bitbuffer import inventory below.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Constants](#constants)
- [Targets and templates](#targets-and-templates)
- [Raw user messages](#raw-user-messages)
- [Creator contract](#creator-contract)
- [Extending a message](#extending-a-message)
- [Text output](#text-output)
- [Menus](#menus)
- [Screen and view effects](#screen-and-view-effects)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	SCREEN_FADE_FRACTION_BITS,
	FADE_FLAGS,
	HUD_DESTINATION,
	SHAKE_COMMAND,
	GetBaseMessageConstants,
	GetMessageBackend,
	GetUserMessageIndex,
	GetUserMessageName,
	GetUserMessageSize,
	SendSayTextMessage,
	SendSayText2Message,
	SendUserMessage,
	CustomUserMessageCreator,
	Fade,
	HintText,
	HUDMessage,
	HUDTextMessage,
	KeyHintText,
	ResetHUD,
	SayText,
	SayText2,
	Shake,
	ShowMenu,
	TextMessage,
	UserMessage,
	UserMessageCreator,
	VGUIMenu,
	SendUserMessageValue,
} = require("messages");

const g_vecUserMessageClasses = [
	CustomUserMessageCreator,
	Fade,
	HintText,
	HUDMessage,
	HUDTextMessage,
	KeyHintText,
	ResetHUD,
	SayText,
	SayText2,
	Shake,
	ShowMenu,
	TextMessage,
	UserMessage,
	UserMessageCreator,
	VGUIMenu,
];
const g_vecMessageFunctions = [
	GetBaseMessageConstants,
	GetMessageBackend,
	GetUserMessageIndex,
	GetUserMessageName,
	GetUserMessageSize,
	SendSayTextMessage,
	SendSayText2Message,
	SendUserMessage,
	SendUserMessageValue,
];
const g_bHasInvalidMessageClass = g_vecUserMessageClasses.some((UserMessageClass) => typeof UserMessageClass !== "function");
const g_bHasInvalidMessageFunction = g_vecMessageFunctions.some((MessageFunction) => typeof MessageFunction !== "function");
if (g_bHasInvalidMessageClass || g_bHasInvalidMessageFunction) {
	throw new Error("The messages module did not expose every documented callable.");
}

const g_bHasFadeFlags = (FADE_FLAGS !== null) && (typeof FADE_FLAGS === "object");
const g_bHasHUDDestination = (HUD_DESTINATION !== null) && (typeof HUD_DESTINATION === "object");
if (!g_bHasFadeFlags || !g_bHasHUDDestination) {
	throw new Error("The messages module did not expose the selected-SDK flag objects.");
}

const g_bHasShakeCommand = (SHAKE_COMMAND !== null) && (typeof SHAKE_COMMAND === "object");
const g_bHasFadeFractionBits = Number.isSafeInteger(SCREEN_FADE_FRACTION_BITS);
if (!g_bHasShakeCommand || !g_bHasFadeFractionBits) {
	throw new Error("The messages module did not expose the selected-SDK shake and fade constants.");
}
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| `SCREEN_FADE_FRACTION_BITS` | Constant | Selected-SDK fixed-point shift. |
| `FADE_FLAGS` | Constant object | Selected-SDK fade flags. |
| `HUD_DESTINATION` | Constant object | Selected-SDK text destinations. |
| `SHAKE_COMMAND` | Constant object | Selected-SDK shake commands. |
| `GetBaseMessageConstants` | Function | Returns the selected-SDK message constants. |
| `GetMessageBackend` | Function | Returns the selected wire backend. |
| `GetUserMessageIndex` | Function | Returns the registry index for `strMessageName`. |
| `GetUserMessageName` | Function | Returns the registry name for `nMessageIndex`. |
| `GetUserMessageSize` | Function | Returns the bitbuffer size for `nMessageIndex`; unavailable on Protobuf branches. |
| `SendSayTextMessage` | Function | `SendSayTextMessage(PlayerOrIndex, strMessageText, SenderOrIndex = 0, bChatEnabled = true)` |
| `SendSayText2Message` | Function | `SendSayText2Message(PlayerOrIndex, strMessageText, SenderOrIndex = 0, bChatEnabled = true)` |
| `SendUserMessage` | Function | `SendUserMessage(strMessageName, TargetReferences, vecMessageFields, bReliableDelivery = false)` |
| [`CustomUserMessageCreator`](#customusermessagecreator) | Base class | `new CustomUserMessageCreator(strMessageName, MessageFields = {})` |
| [`Fade`](#fade) | Class | `new Fade(FadeOptions)` |
| [`HintText`](#hinttext) | Class | `new HintText(strMessageText, MessageFields = {})` |
| [`HUDMessage`](#hudmessage) | Class | `new HUDMessage(strMessageText, MessageOptions = {})` |
| [`HUDTextMessage`](#hudtextmessage) | Class | `new HUDTextMessage(strMessageText, MessageOptions = {})` |
| [`KeyHintText`](#keyhinttext) | Class | `new KeyHintText(vecHints)` |
| [`ResetHUD`](#resethud) | Class | `new ResetHUD(bResetEnabled = true)` |
| [`SayText`](#saytext) | Class | `new SayText(strMessageText, MessageOptions = {})` |
| [`SayText2`](#saytext2) | Class | `new SayText2(strMessageText, MessageOptions = {})` |
| [`Shake`](#shake) | Class | `new Shake(ShakeOptions)` |
| [`ShowMenu`](#showmenu) | Class | `new ShowMenu(strMenuText, unValidSlots = 0x3FF, nDisplayTime = 4)` |
| `TextMessage` | Class | `new TextMessage(strMessageText, MessageFields = {})` |
| [`UserMessage`](#usermessage) | Class | `new UserMessage(strMessageName, vecFieldEntries = [], bReliableDelivery = false)` |
| [`UserMessageCreator`](#usermessagecreator) | Base class | `new UserMessageCreator(MessageFields = {}, CreatorOptions = {})` |
| [`VGUIMenu`](#vguimenu) | Class | `new VGUIMenu(strMenuName, MenuSubkeys = {}, bVisible = true)` |
| `SendUserMessageValue` | Function | `SendUserMessageValue(TargetReferences, MessageValue, TranslationTokens = {})` |

## Constants

`GetBaseMessageConstants()` returns the selected-SDK values as `FadeFlags`, `HUDDestination`, `ShakeCommand`, and the established constant `SCREEN_FADE_FRACTION_BITS`. The `messages` module exposes the first three objects as `FADE_FLAGS`, `HUD_DESTINATION`, and `SHAKE_COMMAND`; their members are `In`, `Out`, `Modulate`, `StayOut`, `Purge`; `Notify`, `Console`, `Talk`, `Center`; and `Start`, `Stop`, `Amplitude`, `Frequency`, `StartRumbleOnly`, `StartNoRumble`, respectively. The fixed-point shift is also exported directly as `SCREEN_FADE_FRACTION_BITS`.

```js
const {
	SCREEN_FADE_FRACTION_BITS,
	FADE_FLAGS,
	HUD_DESTINATION,
	SHAKE_COMMAND,
} = require("messages");

for (const unConstantValue of [HUD_DESTINATION.Center, FADE_FLAGS.Out, SHAKE_COMMAND.Stop]) {
	if (!Number.isSafeInteger(unConstantValue)) {
		throw new Error("The messages module returned a non-integer selected-SDK constant.");
	}
}

const g_bHasValidFadeFractionBits = Number.isSafeInteger(SCREEN_FADE_FRACTION_BITS);
if (!g_bHasValidFadeFractionBits) {
	throw new Error("SCREEN_FADE_FRACTION_BITS was not a safe integer.");
}

const g_unFixedPointScale = 1 << SCREEN_FADE_FRACTION_BITS;
if (!Number.isSafeInteger(g_unFixedPointScale) || (g_unFixedPointScale <= 0)) {
	throw new Error("SCREEN_FADE_FRACTION_BITS did not produce a positive fixed-point scale.");
}
```

The objects come directly from headers in the selected SDK; do not hard-code their numeric values across games.

## Targets and templates

A `TargetReferences` argument accepts the same positive player-index shapes as [`filters/recipients`](filters-recipients.md): one index, an object with `Index`, a flat array, or an object with a `RecipientIndexes` array. Duplicate indexes are removed.

`SendUserMessage()` obtains each human client's language from `players/language` and groups recipients by language when the creator's `TRANSLATABLE_FIELDS` list is non-empty. The default `TranslateUserMessageFields()` implementation resolves each declared field as follows:

- a string replaces `{Token}` placeholders with string, number, or boolean token values;
- a callable `GetString(strLanguageCode, TranslationTokens)` supplies a string result and is invoked with the original value as its receiver; getter/callback errors propagate;
- unknown placeholders remain in the string;
- fake clients are excluded from every typed creator `SendUserMessage()` call.

Translation tokens must be plain objects, including null-prototype objects. Substitution considers own token properties only. A used token of another type throws; number tokens are formatted as strings, not range-checked wire numbers. Translation copies fields shallowly, so non-translated nested objects remain shared. The default implementation requires each declared translated field as an own field; missing fields or non-string `GetString()` results throw. `KeyHintText` overrides translation for its `Hints` array: each entry must be a string and is translated separately; `GetString()` objects are not accepted as hint entries.

## Raw user messages

### `UserMessage`

`UserMessage` stores public `MessageName`, `FieldEntries`, and `ReliableDelivery` fields. The constructor retains the supplied `FieldEntries` array by reference, without validating or cloning its descriptors. Later array/descriptor mutations affect delivery. `AddUserMessageField(strFieldType, FieldValue, unBitCount = null)` appends a bitbuffer descriptor and returns the same message; it validates a non-empty type string and any supplied bit count but defers descriptor-type/value validation to the writer. `SendUserMessage(TargetReferences)` revalidates the current name, array, and reliable flag, then sends without guessing the schema or applying typed creators' language grouping and fake-client filtering.

```js
const {
	GetMessageBackend,
	GetUserMessageIndex,
	UserMessage,
} = require("messages");

if (typeof GetUserMessageIndex !== "function") {
	throw new Error("The messages module did not expose GetUserMessageIndex().");
}

const g_nSayText2MessageIndex = GetUserMessageIndex("SayText2");
if (g_nSayText2MessageIndex < 0) {
	throw new Error("This raw example requires an SDK that declares SayText2.");
}

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error(`Unsupported user-message backend: ${g_strMessageBackend}.`);
}

const g_bUsesBitBufferBackend = g_strMessageBackend === "bitbuffer";
const g_nSenderIndex = 1;
const g_bChatEnabled = true;
let g_UserMessageInstance = null;
if (g_bUsesBitBufferBackend) {
	g_UserMessageInstance = new UserMessage("SayText2", [], true);
	g_UserMessageInstance.AddUserMessageField("byte", g_nSenderIndex);
	g_UserMessageInstance.AddUserMessageField("byte", g_bChatEnabled ? 0x01 : 0x00);
	g_UserMessageInstance.AddUserMessageField("string", "Raw SourceJS chat");
	g_UserMessageInstance.AddUserMessageField("string", "");
	g_UserMessageInstance.AddUserMessageField("string", "");
	g_UserMessageInstance.AddUserMessageField("string", "");
	g_UserMessageInstance.AddUserMessageField("string", "");

} else {
	g_UserMessageInstance = new UserMessage("SayText2", [
		{ Kind: "SET", Name: "ent_idx", Type: "int32", Value: g_nSenderIndex },
		{ Kind: "SET", Name: "chat", Type: "bool", Value: g_bChatEnabled },
		{ Kind: "SET", Name: "msg_name", Type: "string", Value: "Raw SourceJS chat" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
	], true);
}

const g_bIsUserMessage = g_UserMessageInstance instanceof UserMessage;
const g_bHasExpectedMessageName = g_UserMessageInstance.MessageName === "SayText2";
const g_bUsesReliableDelivery = g_UserMessageInstance.ReliableDelivery;
if (!g_bIsUserMessage || !g_bHasExpectedMessageName || !g_bUsesReliableDelivery) {
	throw new Error("UserMessage did not retain its raw schema identity.");
}

if (!g_UserMessageInstance.SendUserMessage(1)) {
	throw new Error("UserMessage.SendUserMessage() could not send its selected-backend schema.");
}
```

Native bitbuffer writing supports `byte`, `short`, `int`, `uint`, `float`, `string`, `bool`, and `bits` descriptors. `AddUserMessageField()` records these descriptors; `bits` requires `unBitCount` from `0` through `32`, stored as `Bits`. Unsupported descriptor types are rejected during native writing.

Protobuf scalar types are lowercase: `int32`, `uint32`, `int64`, `uint64`, `float`, `double`, `bool`, `string`, and `enum`. Use `BigInt` values for `int64` and `uint64`; the remaining numeric scalar types use finite `Number` values within their native range.

Field order and Protobuf descriptor names are engine ABI, not portable application data.

## Creator contract

### `UserMessageCreator`

Every typed message inherits this contract:

| Member | Description |
| --- | --- |
| `MessageFields` | Mutable plain object retained by reference, not copied or frozen. |
| `ReliableDelivery` | Mutable boolean used by the native recipient filter. |
| `ValidFieldNames` | Initial own enumerable field-name set when strict mode is enabled, otherwise `null`; not a deep validation schema. |
| `MessageName` | Static registry name on built-in classes; the configured instance name on `CustomUserMessageCreator`. |
| `TRANSLATABLE_FIELDS` | Static array containing the subclass's translated field names; empty on the base class. |
| `GetUserMessageName()` | Returns the engine registry name. |
| `GetTranslatableFields()` | Returns the current static translated-field array; rejects a non-array replacement. |
| `SetUserMessageField(strFieldName, FieldValue)` | Sets a field and returns the creator; strict creators reject unknown names. New fields are own enumerable data properties, including names such as `__proto__`, without changing the field object's prototype or invoking inherited setters. Existing own fields retain normal assignment behavior, including their setters. |
| `GetUserMessageField(strFieldName, DefaultValue = null)` | Gets an own field or returns the supplied default. |
| `BuildUserMessagePayload(TargetReferences, TranslationTokens = {}, strLanguageCode = null)` | Builds a normalized delivery record. |
| `TranslateUserMessageFields(strLanguageCode = null, TranslationTokens = {})` | Returns a shallow translated field copy. |
| `BuildUserMessageBitBufferFields(MessageFields)` | Returns bitbuffer descriptors for an explicit logical field object; abstract on the base class. |
| `BuildUserMessageProtobufFields(MessageFields)` | Returns Protobuf descriptors for an explicit logical field object; abstract on the base class. |
| `WriteUserMessageToBitBuffer(MessageBuffer, MessageFields = this.MessageFields)` | Writes `BuildUserMessageBitBufferFields()` into a `BitBufferWrite`-compatible object. |
| `WriteUserMessageToProtobuf(MessageBuffer, MessageFields = this.MessageFields)` | Writes `BuildUserMessageProtobufFields()` into a live Protobuf adapter. |
| `DeliverUserMessage(MessagePayload)` | Chooses the active backend and sends one prepared payload. |
| `SendUserMessage(TargetReferences, TranslationTokens = {})` | Groups human recipients, builds payloads, and returns the strict boolean aggregate of deliveries; exceptions propagate. |
| `toString(MessageFields = this.MessageFields)` | Formats the logical `Message` field using the supplied fields. |

`MessageFields` and `CreatorOptions` must be plain objects, including null-prototype objects. `CreatorOptions.Reliable` defaults to `false`; `CreatorOptions.Strict` defaults to `true`, and both require booleans when supplied. Strictness applies to `SetUserMessageField()`, not direct mutation of the public field object or field-name set.

A translated creator with no human recipient groups returns `false` without delivery. Non-translated creators still prepare one group, even when its recipient array is empty, and may receive the native empty-recipient error. Delivery `false` does not stop later language groups; any thrown translation, validation, or delivery error does. Earlier output and getter side effects are not rolled back.

The following workflow exercises the field, translation, payload, and backend descriptor methods on a real `HintText` creator.

```js
const { HintText, UserMessageCreator } = require("messages");

const g_Notice = new HintText("Wave {Wave}: {State}", { State: "incoming", Wave: 4 });
g_Notice.SetUserMessageField("State", "ready");

const g_TranslationTokens = { State: g_Notice.GetUserMessageField("State"), Wave: g_Notice.GetUserMessageField("Wave") };
const g_TranslatedMessageFields = g_Notice.TranslateUserMessageFields("en", g_TranslationTokens);
const g_MessagePayload = g_Notice.BuildUserMessagePayload(1, g_TranslationTokens, "en");
const g_bIsUserMessageCreator = g_Notice instanceof UserMessageCreator;
const g_bHasExpectedMessageName = g_Notice.GetUserMessageName() === "HintText";
if (!g_bIsUserMessageCreator || !g_bHasExpectedMessageName) {
	throw new Error("HintText did not expose the creator contract.");
}

const g_bHasExpectedTranslatedMessage = g_TranslatedMessageFields.Message === "Wave 4: ready";
const g_bHasExpectedFormattedMessage = g_Notice.toString(g_MessagePayload.MessageFields) === "Wave 4: ready";
if (!g_bHasExpectedTranslatedMessage || !g_bHasExpectedFormattedMessage) {
	throw new Error("HintText did not translate its logical message fields.");
}

const g_bHasExpectedRecipientCount = g_MessagePayload.RecipientIndexes.length === 1;
const g_bHasExpectedRecipientIndex = g_MessagePayload.RecipientIndexes[0] === 1;
const g_bHasExpectedLanguageCode = g_MessagePayload.LanguageCode === "en";
if (!g_bHasExpectedRecipientCount || !g_bHasExpectedRecipientIndex || !g_bHasExpectedLanguageCode) {
	throw new Error("UserMessageCreator.BuildUserMessagePayload() returned unexpected delivery metadata.");
}

const g_vecBitBufferFieldDescriptors = g_Notice.BuildUserMessageBitBufferFields(g_MessagePayload.MessageFields);
const g_vecProtobufFieldDescriptors = g_Notice.BuildUserMessageProtobufFields(g_MessagePayload.MessageFields);
const g_bHasExpectedBitBufferFieldCount = g_vecBitBufferFieldDescriptors.length === 1;
const g_bHasExpectedBitBufferFieldType = g_vecBitBufferFieldDescriptors[0].Type === "string";
const g_bHasExpectedProtobufFieldCount = g_vecProtobufFieldDescriptors.length === 1;
const g_bHasExpectedProtobufFieldName = g_vecProtobufFieldDescriptors[0].Name === "text";
if (!g_bHasExpectedBitBufferFieldCount || !g_bHasExpectedBitBufferFieldType || !g_bHasExpectedProtobufFieldCount || !g_bHasExpectedProtobufFieldName) {
	throw new Error("HintText did not build both backend descriptor sets.");
}

if (!g_Notice.DeliverUserMessage(g_MessagePayload)) {
	throw new Error("UserMessageCreator.DeliverUserMessage() could not send the prepared payload.");
}
```

`BuildUserMessagePayload()` is a low-level preparation method. It normalizes recipients but does not exclude fake clients or choose each client's language. Its record retains the supplied `TranslationTokens` reference and creator instance; the translated fields are only a shallow copy. `DeliverUserMessage()` trusts the supplied registry name after string validation and rejects an empty descriptor array with `false`; neither method is a transaction. Normal plugin code usually calls `SendUserMessage()` for fake-client filtering and language grouping.

### `WriteUserMessageToBitBuffer()`

Use an owned `BitBufferWrite` when inspecting or composing a message body outside the engine send path.

The live writer supports the raw descriptor types from [`SendUserMessage()`](messages.md), plus adapter-only `char` and `word` fields. An `int` requires a signed 32-bit integer; `uint` and `bits` require unsigned 32-bit values; `bool` requires a boolean. A `bits` descriptor also requires an integer `Bits` count from `0` through `32`. Unknown types and invalid `int`, `uint`, `bool`, or `bits` fields throw before that field is written; earlier writes are not rolled back.

The method writes descriptors sequentially and returns the same adapter without converting overflow into an exception. It does not dispatch an engine message. With `BitBufferWrite`, inspect `Overflowed` after writing; overflow or a later validation/adapter error can leave a partially written body.

```js
const { BitBufferWrite } = require("bitbuffers");
const { FADE_FLAGS, Fade } = require("messages");

const g_unMessageBufferCapacityByteCount = 32;
const g_ScreenFade = new Fade({
	Color: { Red: 0x00, Green: 0x00, Blue: 0x00, Alpha: 0xB4 },
	Duration: 1,
	Flags: FADE_FLAGS.Out,
	HoldTime: 0,
});
const g_MessageBuffer = new BitBufferWrite(g_unMessageBufferCapacityByteCount);
if (g_ScreenFade.WriteUserMessageToBitBuffer(g_MessageBuffer) !== g_MessageBuffer) {
	throw new Error("UserMessageCreator.WriteUserMessageToBitBuffer() did not return the supplied writer.");
}

if ((g_MessageBuffer.CurrentBit <= 0) || g_MessageBuffer.Overflowed) {
	throw new Error("Fade did not write a non-overflowing bitbuffer payload.");
}
```

### `WriteUserMessageToProtobuf()`

On a Protobuf SDK, a raw message hook supplies a borrowed native recipient filter and Protobuf adapter. Use them, including nested adapters, only during that callback: do not retain, defer, or dispose these engine-owned views. Clear the adapter before replacing the complete body; repeated fields would otherwise be appended. Clearing and subsequent writes are not transactional.

Scalar `Kind` values must be exactly `SET` or `ADD`; nested messages use `MESSAGE` or `ADDMESSAGE`. Any other `Kind` throws `TypeError` before that field is written. Fields are written sequentially, so earlier writes are not rolled back if a later descriptor fails.

```js
const { SayText2, GetMessageBackend } = require("messages");
const { ProtobufUserMessageHook } = require("memory/hooks/messages");

let g_MessageHook = null;

function ReleaseMessageHook() {
	if (g_MessageHook === null) {
		return true;
	}

	const bHadCallback = g_MessageHook.Callback !== null;
	const bCallbackRemoved = g_MessageHook.DisposeUserMessageHook();
	if (bHadCallback && !bCallbackRemoved) {
		throw new Error("ProtobufUserMessageHook.DisposeUserMessageHook() could not release its callback.");
	}

	g_MessageHook = null;

	return true;
}

// Keep the exact host lifecycle export, including when startup or cleanup fails.
exports.Unload = ReleaseMessageHook;

if (GetMessageBackend() === "protobuf") {
	if (typeof ProtobufUserMessageHook !== "function") {
		throw new Error("The Protobuf backend did not expose ProtobufUserMessageHook.");
	}

	const unMaintenanceMinuteCount = 5;
	const unTargetRecipientIndex = 1;
	const ReplacementMessage = new SayText2("Server maintenance in {Minutes} minutes", { Chat: true, Parameter1: "{Minutes}", SenderIndex: 0 });
	let bMessageRewritten = false;

	try {
		g_MessageHook = new ProtobufUserMessageHook("SayText2");
		g_MessageHook.RegisterUserMessageHook((RecipientFilter, MessageBuffer) => {
			let bTargetIncluded = false;
			for (const unRecipientIndex of RecipientFilter) {
				if (unRecipientIndex === unTargetRecipientIndex) {
					bTargetIncluded = true;
					break;
				}
			}

			if (!bTargetIncluded) {
				throw new Error("ProtobufUserMessageHook received unexpected recipients.");
			}

			const TranslatedMessageFields = ReplacementMessage.TranslateUserMessageFields(null, { Minutes: unMaintenanceMinuteCount });

			MessageBuffer.Clear();

			if (ReplacementMessage.WriteUserMessageToProtobuf(MessageBuffer, TranslatedMessageFields) !== MessageBuffer) {
				throw new Error("UserMessageCreator.WriteUserMessageToProtobuf() did not return the live adapter.");
			}

			bMessageRewritten = true;
		});

		const bMessageSent = ReplacementMessage.SendUserMessage(unTargetRecipientIndex, { Minutes: unMaintenanceMinuteCount });
		const bHasExpectedMessageName = g_MessageHook.MessageName === "SayText2";
		if (!bMessageSent || !bMessageRewritten || !bHasExpectedMessageName) {
			throw new Error("ProtobufUserMessageHook did not rewrite SayText2 through the live adapter.");
		}
	} catch (PrimaryError) {
		try {
			ReleaseMessageHook();
		} catch (CleanupError) {
			throw new AggregateError([PrimaryError, CleanupError], "Message setup/delivery and hook cleanup both failed.");
		}

		throw PrimaryError;
	}

	ReleaseMessageHook();

} else {
	if (typeof ProtobufUserMessageHook !== "undefined") {
		throw new Error("The bitbuffer backend unexpectedly exposed ProtobufUserMessageHook.");
	}
}
```

The example retains the hook before registration and publishes cleanup before startup. If native release throws after removing the callback, the retained hook lets `exports.Unload()` retry release even though `Callback` is already `null`. A failed plugin's exports must still be reachable by its host for that retry; the example cannot guarantee host cleanup after discarded startup state.

## Extending a message

### `CustomUserMessageCreator`

`CustomUserMessageCreator` supplies a dynamic non-empty engine name and non-strict logical fields. A subclass using inherited delivery must provide both backend descriptor methods to send portably. A subclass that overrides delivery is responsible for its own backend, validation, and transport contracts.

```js
const { CustomUserMessageCreator } = require("messages");

class PortableHintUserMessageCreator extends CustomUserMessageCreator {
	static TRANSLATABLE_FIELDS = Object.freeze(["Message"]);

	constructor(strMessageText) {
		super("HintText", { Message: strMessageText });
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		return [{ Type: "string", Value: MessageFields.Message }];
	}

	BuildUserMessageProtobufFields(MessageFields) {
		return [{ Kind: "SET", Name: "text", Type: "string", Value: MessageFields.Message }];
	}
}

const g_PortableHint = new PortableHintUserMessageCreator("Target health: {Health}");
const g_TranslatedMessageFields = g_PortableHint.TranslateUserMessageFields("en", { Health: 6000 });
const g_bHasExpectedTranslatedMessage = g_TranslatedMessageFields.Message === "Target health: 6000";
const g_bHasExpectedMessageName = g_PortableHint.GetUserMessageName() === "HintText";
const g_bHasExpectedFormattedMessage = g_PortableHint.toString({ Health: 6000, Message: "Value: {Health}" }) === "Value: 6000";
if (!g_bHasExpectedMessageName || !g_bHasExpectedFormattedMessage || !g_bHasExpectedTranslatedMessage) {
	throw new Error("PortableHintUserMessageCreator did not retain its dynamic engine name, template, or translation behavior.");
}

if (!g_PortableHint.SendUserMessage(1, { Health: 6000 })) {
	throw new Error("PortableHintUserMessageCreator.SendUserMessage() could not send its portable descriptor schema.");
}
```

## Text output

### `TextMessage` and `SendUserMessageValue()`

`TextMessage` formats its `Message` field and sends literal text through `IVEngineServer::ClientPrintf()`; it is not the engine `TextMsg` user message. Its constructor shallow-merges the supplied fields over the positional message, so `MessageFields.Message` may replace it; the final value must be a string.

`SendUserMessageValue()` accepts a `UserMessage`, a `UserMessageCreator`, or a string. A string is wrapped in `TextMessage`: it sets the `Message` field and cannot be overridden by `TranslationTokens.Message`, though tokens can still interpolate placeholders in that string. For an already serialized `UserMessage`, the tokens are validated but not used; creators translate them through their own send path.

```js
const { TextMessage, SendUserMessageValue } = require("messages");

const g_ScoreReport = new TextMessage("[SourceJS] {Name} has {Points} points.\n", { Name: "Ren", Points: 42 });

const g_TranslationTokens = { Name: "Ren", Points: 42 };

if (g_ScoreReport.toString() !== "[SourceJS] Ren has 42 points.\n") {
	throw new Error("TextMessage did not format its logical message.");
}

if (!SendUserMessageValue(1, g_ScoreReport, g_TranslationTokens)) {
	throw new Error("SendUserMessageValue() could not deliver TextMessage.");
}

if (!SendUserMessageValue(1, "[SourceJS] Session state synchronized.\n")) {
	throw new Error("SendUserMessageValue() could not wrap and deliver literal text.");
}
```

### `SayText`

`SayText` sends `SenderIndex`, colored text, and the `Chat` flag. `SenderIndex` defaults to `0`, `Chat` to `false`, and mutable `ReliableDelivery` to `true`. Its default color prefix is `"\x01"` on bitbuffer SDKs and `" \x01"` on Protobuf SDKs, selected at construction (not recomputed if the backend later changes). In bitbuffer mode the sender is a byte; validate the selected game's wire range before sending.

```js
const { GetMessageBackend, SayText } = require("messages");
const { GREEN } = require("messages/colors");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("SayText requires the BitBuffer or Protobuf message backend.");
}

const g_SelectionAnnouncement = new SayText("Selection accepted for {Name}.", { Chat: true, Color: GREEN, SenderIndex: 1 });
const g_bUsesReliableDelivery = g_SelectionAnnouncement.ReliableDelivery;
const g_bHasExpectedMessageName = g_SelectionAnnouncement.GetUserMessageName() === "SayText";
if (!g_bUsesReliableDelivery || !g_bHasExpectedMessageName) {
	throw new Error("SayText did not retain its reliable engine-message contract.");
}

if (!g_SelectionAnnouncement.SendUserMessage([1, 2], { Name: "Ren" })) {
	throw new Error("SayText.SendUserMessage() could not deliver the translated chat message.");
}
```

### `SayText2`

`SayText2` adds four translated string parameters, each defaulting to `""`. `SenderIndex`, `Chat`, reliability, and construction-time color defaults match `SayText`; bitbuffer senders also use one byte. The engine may treat the message as a localization token when `Message` names a client translation entry.

```js
const { GetMessageBackend, SayText2 } = require("messages");
const { GREEN, NORMAL } = require("messages/colors");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("SayText2 requires the BitBuffer or Protobuf message backend.");
}

const g_ReadyMessage = new SayText2("{Prefix} {Player} is ready", { Chat: true, Color: GREEN, Parameter1: "{Player}", Parameter2: "ready", SenderIndex: 1 });

const g_TranslationTokens = { Player: "Ren", Prefix: `${GREEN}[Ready]${NORMAL}` };
const g_TranslatedMessageFields = g_ReadyMessage.TranslateUserMessageFields("en", g_TranslationTokens);
const g_bHasPlayerName = g_TranslatedMessageFields.Message.includes("Ren");
const g_bHasExpectedParameter = g_TranslatedMessageFields.Parameter1 === "Ren";
if (!g_bHasPlayerName || !g_bHasExpectedParameter) {
	throw new Error("SayText2 did not translate its message and parameter fields.");
}

if (!g_ReadyMessage.SendUserMessage([1, 2], g_TranslationTokens)) {
	throw new Error("SayText2.SendUserMessage() could not deliver the translated chat message.");
}
```

### `HintText`

`HintText` sends one translated hint string through the engine `HintText` user message.

```js
const { GetMessageBackend, HintText } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("HintText requires the BitBuffer or Protobuf message backend.");
}

const g_ConfirmationHint = new HintText("Press {Key} to confirm {Action}.");
const g_strFormattedHintText = g_ConfirmationHint.toString({ Action: "selection", Key: "E", Message: g_ConfirmationHint.MessageFields.Message });
if (g_strFormattedHintText !== "Press E to confirm selection.") {
	throw new Error("HintText did not format its logical message.");
}

if (!g_ConfirmationHint.SendUserMessage(1, { Action: "selection", Key: "E" })) {
	throw new Error("HintText.SendUserMessage() could not deliver the translated hint.");
}
```

### `HUDTextMessage`

`HUDTextMessage` is the typed engine `TextMsg` message. Mutable `ReliableDelivery` defaults to `true`; it carries a destination, the primary message, and four optional string parameters defaulting to `""`. The default destination is the selected SDK's `HUD_DESTINATION.Center`. Bitbuffer writes a destination byte and five strings; Protobuf writes `msg_dst` and five repeated `params` strings. Validate the selected game's destination range.

```js
const { GetMessageBackend, HUD_DESTINATION, HUDTextMessage } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("HUDTextMessage requires the BitBuffer or Protobuf message backend.");
}

const g_CenterHUDText = new HUDTextMessage("Stage {Stage} begins now", { Destination: HUD_DESTINATION.Center, Parameter1: "{Stage}" });
const g_TranslatedMessageFields = g_CenterHUDText.TranslateUserMessageFields("en", { Stage: 5 });
const g_bHasExpectedMessage = g_TranslatedMessageFields.Message === "Stage 5 begins now";
const g_bHasExpectedParameter = g_TranslatedMessageFields.Parameter1 === "5";
if (!g_bHasExpectedMessage || !g_bHasExpectedParameter) {
	throw new Error("HUDTextMessage did not translate its TextMsg parameters.");
}

if (!g_CenterHUDText.SendUserMessage([1, 2], { Stage: 5 })) {
	throw new Error("HUDTextMessage.SendUserMessage() could not deliver TextMsg.");
}
```

### `KeyHintText`

`KeyHintText` accepts and retains an array of hint strings; translation produces rendered lines and `toString()` joins them with newlines. Bitbuffer writes a count byte of `1` and one newline-joined string, as required by the selected TF2 client's `KeyHintText` reader. An empty array writes `1` and `""` to clear that display. Protobuf retains separate repeated `hints` entries. The bitbuffer codec returns one combined string and cannot recover original array boundaries when hints contain newlines. Native encoding, capacity, and terminator constraints still apply; do not pass embedded NUL characters as display text.

```js
const { GetMessageBackend, KeyHintText } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("KeyHintText requires the BitBuffer or Protobuf message backend.");
}

const g_ControlHints = new KeyHintText(["Press {UseKey} to use", "Press {ReloadKey} to reload"]);
const g_TranslatedMessageFields = g_ControlHints.TranslateUserMessageFields("en", { ReloadKey: "R", UseKey: "E" });
const g_strRenderedHints = g_ControlHints.toString(g_TranslatedMessageFields);
if (g_strRenderedHints !== "Press E to use\nPress R to reload") {
	throw new Error("KeyHintText.toString() did not join the rendered hint lines.");
}

if (!g_ControlHints.SendUserMessage(1, { ReloadKey: "R", UseKey: "E" })) {
	throw new Error("KeyHintText.SendUserMessage() could not deliver its translated hints.");
}
```

## Menus

### `VGUIMenu`

`VGUIMenu` opens or closes a named client VGUI panel. `Subkeys` must be a plain or null-prototype object whose own enumerable keys are non-empty strings and whose values are strings accepted by that panel. The object is retained, not cloned; entries/getters are read when building fields. Bitbuffer uses a byte entry count without enforcing its range: callers must limit it to `255`, provide adequate capacity, and respect native string encoding/terminators (no embedded NUL). Protobuf writes nested `subkeys` with external `name`/`str` fields.

```js
const { GetMessageBackend, VGUIMenu } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("VGUIMenu requires the BitBuffer or Protobuf message backend.");
}

const g_InformationPanel = new VGUIMenu("info", { msg: "motd", title: "SourceJS information", type: "2" }, true);
const g_bHasExpectedMessageName = g_InformationPanel.GetUserMessageName() === "VGUIMenu";
const g_bHasExpectedPanelName = g_InformationPanel.MessageFields.Name === "info";
const g_bShowsPanel = g_InformationPanel.MessageFields.Show;
if (!g_bHasExpectedMessageName || !g_bHasExpectedPanelName || !g_bShowsPanel) {
	throw new Error("VGUIMenu did not retain its panel fields.");
}

if (!g_InformationPanel.SendUserMessage(1)) {
	throw new Error("VGUIMenu.SendUserMessage() could not deliver the selected-game panel request.");
}
```

Panel names and subkeys are game UI contracts: `info`, `msg`, `title`, and `type` above deliberately retain native spelling. Verify them against the selected game rather than assuming one branch's panel exists everywhere.

### `ShowMenu`

`ShowMenu` sends a radio-menu body and a valid-slot bitmask. Bitbuffer mode splits the JavaScript string into `ShowMenu.ChunkSize` UTF-16 code units per chunk; the default is `62`, and a replacement must be a positive integer on that path. This is not a UTF-8 byte-count limit and may split a surrogate pair: callers must provide text/chunk sizes valid for the selected game's encoding and capacity. An empty body still sends one clearing chunk. A `false` delivery result does not stop later chunks; a thrown error does.

Bitbuffer keeps only the low 16 bits of `ValidSlots` and low 8 bits of `DisplayTime`; these masks are not range validation. Protobuf writes the unmasked integer fields in one descriptor set. Use `SendUserMessage()`/delivery for bitbuffer chunking: `ShowMenu` does not implement the base bitbuffer descriptor builder.

```js
const { GetMessageBackend, ShowMenu } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("ShowMenu requires the BitBuffer or Protobuf message backend.");
}

const g_unValidSlots = 0x0203;
const g_RadioBodyMessage = new ShowMenu([
	"Choose an action",
	"->1. Accept",
	"->2. Decline",
	"->0. Close",
].join("\n"), g_unValidSlots, 10);
const g_bHasExpectedChunkSize = ShowMenu.ChunkSize === 62;
const g_bHasExpectedValidSlots = g_RadioBodyMessage.MessageFields.ValidSlots === g_unValidSlots;
if (!g_bHasExpectedChunkSize || !g_bHasExpectedValidSlots) {
	throw new Error("ShowMenu did not retain its chunk or slot-mask contract.");
}

if (!g_RadioBodyMessage.SendUserMessage(1)) {
	throw new Error("ShowMenu.SendUserMessage() could not deliver the rendered radio body.");
}
```

Use [`menus/radio`](menus-radio.md) when you need choice dispatch, paging, and queue ownership. `ShowMenu` only transports the rendered body.

## Screen and view effects

### `Shake`

`Shake` sends `Command`, `Amplitude`, `Frequency`, and `Duration`. Own `Amplitude` and `Duration` fields are required finite numbers; `Frequency` defaults to `1` and `Command` to the selected SDK's `SHAKE_COMMAND.Start`. Normalization does not enforce nonnegative values or whitelist enum members. The units and supported command behavior come from the selected SDK.

```js
const { GetMessageBackend, SHAKE_COMMAND, Shake } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("Shake requires the BitBuffer or Protobuf message backend.");
}

const g_unExpectedShakeFieldCount = 4;
const g_ImpactShake = new Shake({ Amplitude: 4.5, Command: SHAKE_COMMAND.Start, Duration: 1.25, Frequency: 2 });
const g_vecBitBufferFieldDescriptors = g_ImpactShake.BuildUserMessageBitBufferFields(g_ImpactShake.MessageFields);
const g_vecProtobufFieldDescriptors = g_ImpactShake.BuildUserMessageProtobufFields(g_ImpactShake.MessageFields);
const g_bHasExpectedBitBufferFieldCount = g_vecBitBufferFieldDescriptors.length === g_unExpectedShakeFieldCount;
const g_bHasExpectedCommand = g_vecBitBufferFieldDescriptors[0].Value === SHAKE_COMMAND.Start;
const g_bHasExpectedProtobufFieldCount = g_vecProtobufFieldDescriptors.length === g_unExpectedShakeFieldCount;
if (!g_bHasExpectedBitBufferFieldCount || !g_bHasExpectedCommand || !g_bHasExpectedProtobufFieldCount) {
	throw new Error("Shake did not build both backend descriptor sets.");
}

if (!g_ImpactShake.SendUserMessage([1, 2])) {
	throw new Error("Shake.SendUserMessage() could not deliver the view effect.");
}
```

Stop an existing shake with `SHAKE_COMMAND.Stop`; do not invent numeric command values.

### `Fade`

`Fade` requires own finite `Duration` and `HoldTime` fields, converts them into the selected SDK's fixed-point format, and encodes color as RGBA components. It needs the selected SDK's message constants; they are not fabricated on unsupported branches. `Flags` defaults to `FADE_FLAGS.In`, and `Color` to opaque white.

```js
const { FADE_FLAGS, Fade, GetMessageBackend } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("Fade requires the BitBuffer or Protobuf message backend.");
}

const g_unExpectedBitBufferFieldCount = 7;
const g_unExpectedProtobufFieldCount = 4;
const g_BlackoutFade = new Fade({
	Color: { Red: 0x00, Green: 0x00, Blue: 0x00, Alpha: 0xDC },
	Duration: 1,
	Flags: FADE_FLAGS.Out,
	HoldTime: 2,
});
const g_vecBitBufferFieldDescriptors = g_BlackoutFade.BuildUserMessageBitBufferFields(g_BlackoutFade.MessageFields);
const g_vecProtobufFieldDescriptors = g_BlackoutFade.BuildUserMessageProtobufFields(g_BlackoutFade.MessageFields);
const g_bHasExpectedBitBufferFieldCount = g_vecBitBufferFieldDescriptors.length === g_unExpectedBitBufferFieldCount;
const g_bHasExpectedFadeFlags = g_vecBitBufferFieldDescriptors[2].Value === FADE_FLAGS.Out;
const g_bHasExpectedProtobufFieldCount = g_vecProtobufFieldDescriptors.length === g_unExpectedProtobufFieldCount;
if (!g_bHasExpectedBitBufferFieldCount || !g_bHasExpectedFadeFlags || !g_bHasExpectedProtobufFieldCount) {
	throw new Error("Fade did not build its fixed-point color descriptor sets.");
}

if (!g_BlackoutFade.SendUserMessage(1)) {
	throw new Error("Fade.SendUserMessage() could not deliver the screen effect.");
}
```

Color components must be integers from `0` through `255`. Duration values must produce safe integer fixed-point values after multiplication by `1 << SCREEN_FADE_FRACTION_BITS`; there is no automatic rounding or nonnegative-duration check. Bitbuffer writes three short fields and four color bytes; Protobuf writes three `int32` fields and nested `clr`. Safe-integer validation is not wire-range validation: also check the selected SDK's encoded duration, hold-time, and flag limits.

### `HUDMessage`

`HUDMessage` is the engine `HudMsg` message. It supports position, two colors, effect timing, and a channel. Defaults are `Channel: 0`, `Effect: 0`, `EffectTime: 0`, `FadeIn: 0`, `FadeOut: 0`, `HoldTime: 4`, `X: -1`, and `Y: -1`; both colors default to opaque white. Integers and finite numbers are validated, but there is no channel/effect whitelist or nonnegative-timing check. Bitbuffer channel/effect fields are bytes: callers must validate the selected game's ranges and capacity.

```js
const { GetMessageBackend, HUDMessage } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("HUDMessage requires the BitBuffer or Protobuf message backend.");
}

const g_unMaximumColorComponentValue = 0xFF;
const g_unExpectedBitBufferFieldCount = 17;
const g_unExpectedProtobufFieldCount = 10;
const g_PrimaryColor = { Red: 0x78, Green: 0xDC, Blue: 0x50, Alpha: g_unMaximumColorComponentValue };
const g_SecondaryColor = { Red: g_unMaximumColorComponentValue, Green: g_unMaximumColorComponentValue, Blue: g_unMaximumColorComponentValue, Alpha: g_unMaximumColorComponentValue };
const g_ObjectiveMessage = new HUDMessage("Objective: {Objective}", {
	Channel: 3,
	Effect: 0,
	EffectTime: 0,
	FadeIn: 0.2,
	FadeOut: 0.5,
	HoldTime: 4,
	PrimaryColor: g_PrimaryColor,
	SecondaryColor: g_SecondaryColor,
	X: -1,
	Y: 0.2,
});
const g_TranslatedMessageFields = g_ObjectiveMessage.TranslateUserMessageFields("en", { Objective: "Complete the current task" });
const g_bHasExpectedText = g_ObjectiveMessage.toString(g_TranslatedMessageFields) === "Objective: Complete the current task";
if (!g_bHasExpectedText) {
	throw new Error("HUDMessage did not format its translated objective.");
}

const g_vecBitBufferFieldDescriptors = g_ObjectiveMessage.BuildUserMessageBitBufferFields(g_TranslatedMessageFields);
const g_vecProtobufFieldDescriptors = g_ObjectiveMessage.BuildUserMessageProtobufFields(g_TranslatedMessageFields);
const g_bHasExpectedBitBufferFieldCount = g_vecBitBufferFieldDescriptors.length === g_unExpectedBitBufferFieldCount;
const g_bHasExpectedPrimaryRed = g_vecBitBufferFieldDescriptors[3].Value === g_PrimaryColor.Red;
const g_bHasExpectedProtobufFieldCount = g_vecProtobufFieldDescriptors.length === g_unExpectedProtobufFieldCount;
if (!g_bHasExpectedBitBufferFieldCount || !g_bHasExpectedPrimaryRed || !g_bHasExpectedProtobufFieldCount) {
	throw new Error("HUDMessage did not build both backend descriptor sets.");
}

if (!g_ObjectiveMessage.SendUserMessage([1, 2], { Objective: "Complete the current task" })) {
	throw new Error("HUDMessage.SendUserMessage() could not deliver HudMsg.");
}
```

`X: -1` is passed through as the horizontal position; games may interpret it as centered according to their `HudMsg` layout. Channels and layout behavior remain game-defined.

### `ResetHUD`

`ResetHUD` sends the exact engine registry name `ResetHud` and one reset boolean, defaulting to `true`. Bitbuffer encodes it as a byte (`0x01`/`0x00`); Protobuf writes the external boolean field `reset`.

```js
const { GetMessageBackend, ResetHUD } = require("messages");

const g_strMessageBackend = GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf")) {
	throw new Error("ResetHUD requires the BitBuffer or Protobuf message backend.");
}

const g_ResetMessage = new ResetHUD(true);
const g_vecBitBufferFieldDescriptors = g_ResetMessage.BuildUserMessageBitBufferFields(g_ResetMessage.MessageFields);
const g_bHasExpectedMessageName = g_ResetMessage.GetUserMessageName() === "ResetHud";
const g_bHasExpectedResetValue = g_vecBitBufferFieldDescriptors[0].Value === 0x01;
if (!g_bHasExpectedMessageName || !g_bHasExpectedResetValue) {
	throw new Error("ResetHUD did not build the reset descriptor.");
}

if (!g_ResetMessage.SendUserMessage(1)) {
	throw new Error("ResetHUD.SendUserMessage() could not deliver ResetHud.");
}
```

## Errors

- `TypeError` is thrown for invalid field containers, booleans, finite numbers, integer fields, strings, translation values, buffer adapters, descriptor arrays, field types or kinds, VGUI subkeys, or unsupported backends. `UserMessage.AddUserMessageField()` also throws `TypeError` for a supplied non-integer or out-of-range bit count; it does not append that field.
- `RangeError` is thrown for an integer color component outside `0` through `255`, or when the JavaScript bitbuffer adapter writer receives an `int`/`uint`/`bits` integer value outside its validated range or an integer `Bits` count outside `0` through `32`. Non-integer values throw `TypeError`. A non-positive integer `ShowMenu.ChunkSize` throws `RangeError` on bitbuffer delivery. Byte/short wire widths and native buffer overflow are not all checked by these builders; native send validation remains a separate boundary.
- `ReferenceError` is thrown when `SetUserMessageField()` names a field outside a strict creator's initial field set.
- `UserMessageCreator.BuildUserMessageBitBufferFields()` and `UserMessageCreator.BuildUserMessageProtobufFields()` throw until a subclass implements them.
- Translated creators return `false` without delivery when no human language groups remain. Non-translated creators still prepare an empty group and may reach native empty-recipient validation. Inherited `DeliverUserMessage()` returns `false` when a builder emits no descriptors or native delivery returns `false`; exceptions propagate. Delivery overrides own their result contracts. A successful native result is not a client acknowledgment or proof of rendering.

## Lifecycle

- `SendUserMessage()` calls do not retain native message buffers after delivery and need no explicit release.
- Do not send before a map/server session has connected recipients.
- `TextMessage` is developer-console output; use `HUDTextMessage` for the engine `TextMsg` user message.
- Native Protobuf descriptor types are lowercase, including `int32` and `string`.
- Colors require non-array objects with integer `Red`, `Green`, `Blue`, and `Alpha` fields in `0` through `255`; construction validates the supplied color objects but retains their references, and descriptor builders re-read/normalize current component values. VGUI subkeys require plain or null-prototype objects with string values. Mutating `MessageFields` into another shape can invalidate the creator's backend descriptor methods.
- Call `Clear()` on a live Protobuf hook buffer before replacing its complete body so repeated fields are not appended to old values.
- A hook's live recipient filter, message buffer, and nested Protobuf adapters are borrowed for that callback; do not retain them for later or asynchronous use. Hook registrations still need their separate cleanup lifecycle.

## Related modules

- [`messages`](messages.md) exposes native user-message and console transports alongside the typed creators.
- [`messages/implementation`](messages-implementation.md) provides tracked `UserMessageData`, bitbuffer/Protobuf codecs, and the message implementation registry.
- [`memory/hooks/messages`](memory-hooks-messages.md) decodes and edits outgoing user messages.
- [`menus/radio`](menus-radio.md) owns interactive ShowMenu paging and selection.
