# `require("messages")`

> AI agents: use the contents list and process one bounded chunk at a time. `messages` has engine-branch-selected capability exports and raw wire contracts. Inspect the selected runtime object before choosing a transport; test doubles do not verify live SDK/client delivery.

`messages` is the selected engine branch's native message object augmented with the typed JavaScript message API. It exposes engine console output, client commands, user-message registry access, raw bitbuffer/protobuf sends, `IServerPluginHelpers` dialogs, and reusable message classes. The typed class reference is split into [typed messages classes](messages-types.md); dialog-specific classes live in [`messages/dialog`](messages-dialog.md).

Safe sending requires actual connected clients on a running server; there is no recipient in the game main menu. Not every native binding independently verifies client range or connection state. Call these engine-facing methods synchronously on the game thread, not from an IO worker; they are not the queued Redis/CPR/SOCI/socket request API.

Native methods validate their documented inputs, descriptors and player edicts without inventing fallback exports. Each executable fence is an independent plugin fragment in an initialized SourceJS runtime. Sending examples assume connected client index `1`; substitute a valid index for the running server. Successful dispatch is not a client acknowledgement.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Backend](#backend)
- [Engine output](#engine-output)
- [Dialog types](#dialog-types)
- [Registry](#registry)
- [Chat](#chat)
- [Raw user messages](#raw-user-messages)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const g_MessagesAPI = require("messages");

const g_vecMandatoryExportNames = ["CreateDialog", "GetDialogType", "GetDialogTypes", "GetMessageBackend", "SendClientCommand", "SendClientConsoleMessage"];
const g_vecCapabilityExportNames = ["GetBaseMessageConstants", "GetUserMessageIndex", "GetUserMessageName", "GetUserMessageSize", "SendSayTextMessage", "SendSayText2Message", "SendUserMessage"];
const g_vecSupportedMessageBackends = ["bitbuffer", "protobuf", "source2"];

for (const strExportName of g_vecMandatoryExportNames) {
	if (typeof g_MessagesAPI[strExportName] !== "function") {
		throw new Error(`The messages module is missing ${strExportName}() for the selected engine branch.`);
	}
}

for (const strExportName of g_vecCapabilityExportNames) {
	if (Object.hasOwn(g_MessagesAPI, strExportName) && (typeof g_MessagesAPI[strExportName] !== "function")) {
		throw new Error(`The messages module exposes a non-callable ${strExportName} property.`);
	}
}

const g_strMessageBackend = g_MessagesAPI.GetMessageBackend();
if (!g_vecSupportedMessageBackends.includes(g_strMessageBackend)) {
	throw new Error("GetMessageBackend() returned an unsupported wire backend.");
}
```

## Exports

| Export | Availability | Signature |
| --- | --- | --- |
| [`CreateDialog`](#createdialog) | all supported branches | `CreateDialog(PlayerOrIndex, nDialogType, DialogFields, strDialogName = "menu")` |
| `GetBaseMessageConstants` | SDK has `shareddefs.h` and `shake.h` | `GetBaseMessageConstants()` |
| `GetDialogType` | all supported branches | `GetDialogType(strDialogTypeName)` |
| [`GetDialogTypes`](#getdialogtypes-and-getdialogtype) | all supported branches | `GetDialogTypes()` |
| [`GetMessageBackend`](#getmessagebackend-and-getbasemessageconstants) | all supported branches | `GetMessageBackend()` |
| [`GetUserMessageIndex`](#getusermessageindex-getusermessagename-and-getusermessagesize) | SDK has recipient filters | `GetUserMessageIndex(strMessageName)` |
| `GetUserMessageName` | SDK has recipient filters | `GetUserMessageName(nMessageIndex)` |
| `GetUserMessageSize` | bitbuffer SDK has recipient filters | `GetUserMessageSize(nMessageIndex)` |
| [`SendClientCommand`](#sendclientcommand) | all supported branches | `SendClientCommand(PlayerOrIndex, strCommandLine)` |
| [`SendClientConsoleMessage`](#sendclientconsolemessage) | all supported branches | `SendClientConsoleMessage(PlayerOrIndex, strMessage)` |
| [`SendSayTextMessage`](#sendsaytextmessage) | native bitbuffer SayText support | `SendSayTextMessage(PlayerOrIndex, strMessageText, SenderOrIndex = 0, bChatEnabled = true)` |
| [`SendSayText2Message`](#sendsaytext2message) | native bitbuffer SayText2 support | `SendSayText2Message(PlayerOrIndex, strMessageText, SenderOrIndex = 0, bChatEnabled = true)` |
| [`SendUserMessage`](#sendusermessage) | native bitbuffer or protobuf user-message support | `SendUserMessage(strMessageName, TargetReferences, vecMessageFields, bReliableDelivery = false)` |

Unavailable capability exports are omitted. Reading an omitted property normally returns `undefined`; calling it throws `TypeError`. A present export can still reject a call when its required live SDK interface is unavailable.

`SendClientConsoleMessage`, `SendClientCommand`, `GetMessageBackend`, `GetBaseMessageConstants`, `GetDialogTypes`, and `GetDialogType` translate C++ exceptions into operation-specific JavaScript errors. Constant-record installation preserves the original JavaScript property error or execution termination instead of replacing it with a generic installation error. An already caught JavaScript exception survives C++ unwinding during constant installation or player `Index` resolution; the optional resolved index is committed only after edict validation succeeds. These boundaries do not undo submitted output, commands, or property-setter side effects, and do not make invalid native memory safe.

`CreateDialog`, `SendUserMessage`, `SendSayTextMessage`, `SendSayText2Message`, and the native `messages/colors/saytext2.Apply` / `Strip` operations also translate C++ exceptions into operation-specific JavaScript errors, without replacing an already pending JavaScript error or execution termination.

## Backend

### `GetMessageBackend()` and `GetBaseMessageConstants()`

`GetMessageBackend()` returns `"bitbuffer"` or `"protobuf"` for supported Source 1 builds and `"source2"` for the Source 2 branch. `GetBaseMessageConstants()` returns selected-SDK `FadeFlags`, `HUDDestination`, `SCREEN_FADE_FRACTION_BITS`, and `ShakeCommand` records/values when their headers exist. The returned record and nested constant records have own writable, enumerable, configurable data properties; inherited setters and non-writable prototype properties do not intercept their creation. The established typed exports `FADE_FLAGS`, `HUD_DESTINATION`, and `SHAKE_COMMAND` expose the corresponding records; their members are PascalCase. Without these SDK constants, the getter, these exports, `SCREEN_FADE_FRACTION_BITS`, and the dependent `Fade`, `Shake`, and `HUDTextMessage` classes are omitted rather than populated with fallback values. The module can still load for other capabilities. Its codec dependency retains the `FadeUserMessageImplementation` class but rejects all four backend operations before buffer access when the SDK scale is absent.

```js
const g_MessagesAPI = require("messages");

const g_strMessageBackend = g_MessagesAPI.GetMessageBackend();
if ((g_strMessageBackend !== "bitbuffer") && (g_strMessageBackend !== "protobuf") && (g_strMessageBackend !== "source2")) {
	throw new Error(`Unsupported user-message backend: ${g_strMessageBackend}.`);
}

if (typeof g_MessagesAPI.GetBaseMessageConstants === "function") {
	const BaseMessageConstants = g_MessagesAPI.GetBaseMessageConstants();
	const { FadeFlags, HUDDestination, SCREEN_FADE_FRACTION_BITS, ShakeCommand } = BaseMessageConstants;
	const bHasFadeFlags = (FadeFlags !== null) && (typeof FadeFlags === "object");
	const bHasHUDDestination = (HUDDestination !== null) && (typeof HUDDestination === "object");
	if (!bHasFadeFlags || !bHasHUDDestination) {
		throw new Error("GetBaseMessageConstants() did not expose FadeFlags and HUDDestination.");
	}

	const bHasShakeCommand = (ShakeCommand !== null) && (typeof ShakeCommand === "object");
	const bHasScreenFadeFractionBits = Number.isSafeInteger(SCREEN_FADE_FRACTION_BITS);
	if (!bHasShakeCommand || !bHasScreenFadeFractionBits) {
		throw new Error("GetBaseMessageConstants() did not expose ShakeCommand and SCREEN_FADE_FRACTION_BITS.");
	}

	const bHasFadeOut = Number.isSafeInteger(FadeFlags.Out);
	const bHasTalkDestination = Number.isSafeInteger(HUDDestination.Talk);
	const bHasShakeStart = Number.isSafeInteger(ShakeCommand.Start);
	if (!bHasFadeOut || !bHasTalkDestination || !bHasShakeStart) {
		throw new Error("GetBaseMessageConstants() returned non-integer SDK constants.");
	}
}
```

## Engine output

Both client-output methods accept `PlayerOrIndex` as a positive signed-32-bit integer `Number` or an object whose `Index` property is such a number. An error thrown while reading `Index` is preserved, and the native lookup is not attempted afterward. The binding resolves a non-free edict but does not separately check the client range or connection state: callers must supply an actual connected client.

Text is converted to UTF-8, then passed to a null-terminated native API. Only the prefix before the first embedded NUL reaches the engine; callers should reject NUL characters. Console text may be empty. Command validation requires the full converted string to be non-empty, not the transmitted prefix, so a leading NUL is not rejected by that check.

### `SendClientConsoleMessage()`

`SendClientConsoleMessage()` writes literal text to one client's developer console through `IVEngineServer::ClientPrintf()`.

```js
const { SendClientConsoleMessage } = require("messages");

if (!SendClientConsoleMessage(1, "[SourceJS] Your profile was reloaded.\n")) {
	throw new Error("SendClientConsoleMessage() could not write the client output.");
}
```

### `SendClientCommand()`

`SendClientCommand()` asks the engine to execute a non-empty command line on one client. Do not concatenate untrusted input into a command.

```js
const { SendClientCommand } = require("messages");

if (!SendClientCommand(1, "echo SourceJS message transport ready")) {
	throw new Error("SendClientCommand() could not dispatch the trusted command line.");
}
```

## Dialog types

### `GetDialogTypes()` and `GetDialogType()`

The returned names are `Message`, `Menu`, `Text`, and `Entry`. Each is an own writable, enumerable, configurable data property, independent of inherited setters or prototype-property writability. `AskConnect` has the same property attributes and exists only on SDK branches that declare `DIALOG_ASKCONNECT`.

```js
const { GetDialogType, GetDialogTypes } = require("messages");

const g_DialogTypes = GetDialogTypes();
if ((GetDialogType("Menu") !== g_DialogTypes.Menu) || (GetDialogType("Message") !== g_DialogTypes.Message)) {
	throw new Error("GetDialogType() did not match GetDialogTypes().");
}

for (const strDialogTypeName of ["Message", "Menu", "Text", "Entry"]) {
	if (!Number.isSafeInteger(g_DialogTypes[strDialogTypeName])) {
		throw new Error(`GetDialogTypes() omitted ${strDialogTypeName}.`);
	}
}

const g_bHasAskConnect = Object.hasOwn(g_DialogTypes, "AskConnect");
if (g_bHasAskConnect && (GetDialogType("AskConnect") !== g_DialogTypes.AskConnect)) {
	throw new Error("GetDialogType() did not expose the SDK ASK_CONNECT value.");
}
```

Unknown or capability-absent names throw; user-message names such as `SayText2` are not dialog types. These names are project-owned PascalCase lookup keys mapped to SDK enum values, not native enum symbol spellings.

### `CreateDialog()`

`CreateDialog()` converts a JavaScript field object into SDK `KeyValues` and calls `IServerPluginHelpers::CreateMessage()`. Fields may be strings, finite numbers, booleans, nested objects, or a `Color` array/object with byte components. Color objects require `Red`, `Green`, and `Blue`; `Alpha` is optional and defaults to `255`. Arrays use `[Red, Green, Blue, Alpha?]` component order.

A failed component getter aborts color conversion, including an `Alpha` getter. Only a successfully read missing/nullish optional `Alpha` receives the default; required components still reject missing/nullish values, and all supplied components must be integers from `0` through `255`.

`PlayerOrIndex` accepts the same positive signed-32-bit Number or `Index` object as the client-output methods. `nDialogType` must be an integer declared by the selected SDK. Field enumeration/getter errors are preserved and stop conversion before dispatch; successfully read `null`/`undefined` values are still skipped. Nested objects allow at most 32 nested object edges from the root; deeper or persistently cyclic chains fail with a depth error.

`CreateDialog()` reads `Index` once and captures the server-assigned user ID. After the last field getter/coercion, it resolves the index again immediately before dispatch and requires the same user ID on a non-free edict. Missing/freed edicts, the SDK's invalid user ID (`-1`), or a different occupant cause an error rather than a send. A replacement edict for the same user ID is accepted. This check does not pin the connection or guarantee client delivery.

The temporary KeyValues tree stays owned by SourceJS throughout conversion and dispatch. Cleanup is attempted on validation failure and C++ unwinding; native C++ exceptions are translated by the callback without replacing a pending JavaScript error/termination. The deleter suppresses cleanup exceptions, so cleanup is best-effort, not a success guarantee. This does not roll back getter side effects or an already dispatched engine message.

The SDK documents dialog display times of 10–200 seconds and lower `Level` values as higher priority. The native converter does not enforce that time range or manage a per-player level counter. `CreateMessage()` is a void SDK call: a returned `true` does not prove that a window was displayed. Dialog names and string values use UTF-8 C-string APIs; avoid embedded NUL characters. Names of non-nullish fields must be non-empty and contain neither NUL nor `/`; invalid names throw before the corresponding SDK field call.

```js
const { CreateDialog, GetDialogType } = require("messages");

const g_DialogFields = {
	Color: { Alpha: 0xFF, Blue: 0x50, Green: 0xDC, Red: 0x50 },
	Level: 1,
	Msg: "Choose an action",
	Time: 10,
	Title: "SourceJS menu",
	1: {
		Command: "echo SourceJS dialog option",
		Msg: "1. Continue",
	},
};
if (!CreateDialog(1, GetDialogType("Menu"), g_DialogFields, "menu")) {
	throw new Error("CreateDialog() could not create DIALOG_MENU.");
}
```

The native converter skips `null` and `undefined` properties before validating their names. It does not serialize arrays except when the property name is exactly `Color`. Validated names identify one SDK `KeyValues` node; express nesting with object values rather than slash-separated paths. Do not rely on names differing only in ASCII case being distinct: SDK lookup can treat them as the same key. Numeric option keys are opaque menu choices. These rules apply recursively. The trusted `echo` command demonstrates a selectable item without registering a plugin command or forwarding to another menu's `menuselect` handler. For application actions, register and validate an owned command and release it during startup failure/unload as shown in [`messages/dialog`](messages-dialog.md). Releasing a command does not withdraw an already displayed native window.

## Registry

### `GetUserMessageIndex()`, `GetUserMessageName()`, and `GetUserMessageSize()`

```js
const g_MessagesAPI = require("messages");

const g_bCanGetUserMessageIndex = typeof g_MessagesAPI.GetUserMessageIndex === "function";
const g_bCanGetUserMessageName = typeof g_MessagesAPI.GetUserMessageName === "function";
if (g_bCanGetUserMessageIndex || g_bCanGetUserMessageName) {
	if (!g_bCanGetUserMessageIndex || !g_bCanGetUserMessageName) {
		throw new Error("The selected SDK exposed only one of GetUserMessageIndex() and GetUserMessageName().");
	}

	const vecCandidateMessageNames = ["TextMsg", "SayText2", "SayText"];
	const IsRegisteredUserMessageName = (strCandidateMessageName) => g_MessagesAPI.GetUserMessageIndex(strCandidateMessageName) >= 0;
	const strMessageName = vecCandidateMessageNames.find(IsRegisteredUserMessageName);
	if (strMessageName === undefined) {
		throw new Error("The selected SDK did not declare a documented text user message.");
	}

	const nMessageIndex = g_MessagesAPI.GetUserMessageIndex(strMessageName);
	if (g_MessagesAPI.GetUserMessageName(nMessageIndex) !== strMessageName) {
		throw new Error("GetUserMessageName() did not round-trip GetUserMessageIndex().");
	}

	const nUndeclaredMessageIndex = 2147483647;
	const bReportsMissingMessageIndex = g_MessagesAPI.GetUserMessageIndex("SourceJS_Missing_Message") === -1;
	const bReportsMissingMessageName = g_MessagesAPI.GetUserMessageName(nUndeclaredMessageIndex) === null;
	if (!bReportsMissingMessageIndex || !bReportsMissingMessageName) {
		throw new Error("GetUserMessageIndex() and GetUserMessageName() did not report missing entries.");
	}

	if (typeof g_MessagesAPI.GetUserMessageSize === "function") {
		const nMessageSize = g_MessagesAPI.GetUserMessageSize(nMessageIndex);
		const bIsMessageSizeValid = Number.isSafeInteger(nMessageSize) && (nMessageSize >= -1);
		const bReportsMissingMessageSize = g_MessagesAPI.GetUserMessageSize(nUndeclaredMessageIndex) === -1;
		if (!bIsMessageSizeValid || !bReportsMissingMessageSize) {
			throw new Error("GetUserMessageSize() returned invalid registry metadata.");
		}
	}
}
```

`GetUserMessageIndex()` returns `-1` for an unknown name. `GetUserMessageName()` returns `null` when the index is not declared. Bitbuffer `GetUserMessageSize()` returns `-1` for an invalid index; protobuf SDKs omit it because protobuf messages do not have a fixed registry size.

## Chat

### `SendSayTextMessage()`

Both SayText helpers validate the recipient edict before beginning a message. If the recipient is an object, its `Index` is read once and that validated index is used for delivery. An error thrown while reading a recipient or sender `Index` is propagated before a native message begins, including an already caught JavaScript error during C++ unwinding. Callers must still supply an actual connected client.

```js
const g_MessagesAPI = require("messages");

if (typeof g_MessagesAPI.SendSayTextMessage === "function") {
	if (!g_MessagesAPI.SendSayTextMessage(1, "The current session will restart in five minutes.", 0, true)) {
		throw new Error("SendSayTextMessage() could not send the chat message.");
	}
}
```

When `bChatEnabled` is `true`, native SayText appends `"\x01\n"` when the full converted message has no newline. `SenderOrIndex` defaults to zero and can also be an `Index`-bearing object; a non-positive extracted sender is serialized as zero. Recipient validation is stricter than sender extraction; select an in-range sender for the SDK's byte field rather than relying on conversion or truncation.

### `SendSayText2Message()`

```js
const g_MessagesAPI = require("messages");
const { GREEN, NORMAL } = require("messages/colors");

if (typeof g_MessagesAPI.SendSayText2Message === "function") {
	if (!g_MessagesAPI.SendSayText2Message(1, `${GREEN}[Ready]${NORMAL} Selection accepted.`, 1, true)) {
		throw new Error("SendSayText2Message() could not send the colored chat message.");
	}
}
```

On bitbuffer branches, a non-positive SayText2 sender index defaults to the recipient index. The native helper writes sender byte, chat byte, message string, then four empty parameter strings in the client schema's order. It does not accept custom parameter strings; use the typed `SayText2` class for those. The native bitbuffer writer emits the full UTF-8 byte sequence followed by a NUL terminator; embedded NUL bytes are also written and can end a client string read early or misalign following fields, so exclude them from message text. Protobuf branches use the typed `SayText2` class from `messages` instead of these omitted convenience functions.

## Raw user messages

### `SendUserMessage()`

Both native backends reject embedded NUL in `strMessageName` before name-table lookup or message dispatch; leading and trailing NUL are also invalid. This does not change payload string encoding or wire-width rules.

Bitbuffer field descriptors use `{ Type, Value }` and are written in array order. Supported types are `byte`, `short`, `int`, `uint`, `float`, `string`, `bool`, and `bits`; a `bits` field also requires an integer `Bits` count from `0` through `32`. After input validation, a zero-bit field is a no-op: it does not call the SDK writer or advance the cursor, but an already overflowed buffer still fails. Nonzero bit fields write only the requested low bits of the uint32 value; `32` preserves all bits without a width-sized shift.

After a successful bitbuffer message begin, all three sending methods attempt `MessageEnd()` exactly once on normal completion, a failed write, or C++ unwinding. Cleanup does not cancel a partly written/submitted message; `false` is not a rollback guarantee. An exception from explicit `MessageEnd()` is handled by the callback boundary, and cleanup is not retried. During unwinding, a cleanup exception is suppressed to retain the original failure.

Protobuf scalar descriptors use `{ Kind: "SET" | "ADD", Name, Type, Value }`. Supported types are `int32`, `uint32`, `int64`, `uint64`, `float`, `double`, `bool`, `string`, and `enum`. `int64` and `uint64` values require BigInt in the corresponding signed or unsigned 64-bit range, never Number. Nested descriptors use `{ Kind: "MESSAGE" | "ADDMESSAGE", Name, Fields }`. These project-owned operation codes are case-sensitive; lowercase spellings are not accepted. Type discriminators remain compact lowercase, while protobuf `Name` values retain the selected SDK's external schema spelling. Every operation/type/repeated choice must match the selected SDK's protobuf descriptor.

```js
const { GetMessageBackend, GetUserMessageIndex, SendUserMessage } = require("messages");

const g_bCanGetUserMessageIndex = typeof GetUserMessageIndex === "function";
const g_bCanSendUserMessage = typeof SendUserMessage === "function";
const g_bHasSayText2UserMessage = g_bCanGetUserMessageIndex && (GetUserMessageIndex("SayText2") >= 0);
if (!g_bCanGetUserMessageIndex || !g_bCanSendUserMessage || !g_bHasSayText2UserMessage) {
	throw new Error("This raw example requires an SDK that declares the SayText2 user message.");
}

let g_bMessageSent = false;
const g_strMessageBackend = GetMessageBackend();
if (g_strMessageBackend === "bitbuffer") {
	g_bMessageSent = SendUserMessage("SayText2", [1], [
		{ Type: "byte", Value: 0x01 },
		{ Type: "byte", Value: 0x01 },
		{ Type: "string", Value: "Raw bitbuffer message" },
		{ Type: "string", Value: "" },
		{ Type: "string", Value: "" },
		{ Type: "string", Value: "" },
		{ Type: "string", Value: "" },
	], true);

} else if (g_strMessageBackend === "protobuf") {
	g_bMessageSent = SendUserMessage("SayText2", [1], [
		{ Kind: "SET", Name: "ent_idx", Type: "int32", Value: 1 },
		{ Kind: "SET", Name: "chat", Type: "bool", Value: true },
		{ Kind: "SET", Name: "msg_name", Type: "string", Value: "Raw protobuf message" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
	], true);

} else {
	throw new Error(`This raw example does not support the ${g_strMessageBackend} backend.`);
}

if (!g_bMessageSent) {
	throw new Error("SendUserMessage() could not send the selected raw wire schema.");
}
```

Recipients may be one positive player index, an object with an `Index` field, a flat array of those values, or an object whose `RecipientIndexes` field is such an array. Native collection removes duplicates. At least one valid recipient is required. Collection/getter errors occur before message begin, but bitbuffer field validation is performed after begin; invalid later fields can therefore leave a partly written/submitted message. Protobuf construction owns a temporary message and completes field/reliability validation before the void dispatch call. Prefer typed `messages` creators unless you intentionally own the exact selected-SDK wire schema.

## Errors

- Unknown dialog names, invalid dialog fields, invalid recipients, empty client commands, undeclared user messages, and malformed bitbuffer/protobuf descriptors raise native V8 exceptions.
- `GetDialogType("SayText2")` is invalid because user-message names and dialog-type names use separate registries.
- `GetUserMessageIndex()` reports an unknown name as `-1`; `GetUserMessageName()` reports an unknown index as `null`; bitbuffer `GetUserMessageSize()` reports an invalid index as `-1`.
- `GetUserMessageIndex(strMessageName)` requires a string without embedded NUL; leading or trailing NUL is also rejected before name-table lookup, never interpreted as a truncated name. An empty or unknown name still returns `-1`. `GetUserMessageName(nMessageIndex)` and bitbuffer `GetUserMessageSize(nMessageIndex)` require an exact signed 32-bit integer; a negative index returns `null` or `-1`, respectively. On bitbuffer SDKs, malformed unterminated native name buffers are skipped during name lookup or reported as `null`/`-1` by the name/size queries; empty native names also return those sentinels. Protobuf SDKs retain their generated name-table behavior and omit `GetUserMessageSize()`.
- The native `GetUserMessageIndex()`, `GetUserMessageName()`, and bitbuffer `GetUserMessageSize()` callback boundaries translate C++ exceptions into operation-specific JavaScript errors; normal missing-entry sentinels remain unchanged. They require the selected SDK's live server-game interface and execute on the game thread.
- Bitbuffer descriptor reads of `Type`, `Value`, and `Bits` preserve original JavaScript getter errors and execution termination instead of replacing them with generic field-validation errors. An already caught JavaScript error also survives C++ unwinding through the shared property reader. Invalid or missing fields still use their specific validation diagnostics. Previously written fields are not rolled back.
- Protobuf descriptor reads of `Kind`, `Name`, `Fields`, `Type`, and `Value` also preserve original getter errors and execution termination, including an already caught JavaScript error during C++ unwinding through the shared property reader. `Kind`, `Name`, and `Type` remain strict strings; `Name` must be non-empty, and nested `Fields` must be an array. Missing or incompatible metadata retains its specific diagnostic; validation does not undo JavaScript getter side effects.
- A checked native write or dispatch failure is returned as `false`. Methods backed by `void` SDK calls return `true` after validation and dispatch because they cannot observe later engine handling.
- `GetUserMessageSize()`, `SendSayTextMessage()`, and `SendSayText2Message()` are capability exports. V8 raises its normal property/call error if plugin code calls an export omitted by the selected SDK.

## Lifecycle

- Root send functions do not retain a JavaScript message object and require no explicit release after a successful call.
- Root sends target connected clients on a running server; they cannot create main-menu UI.
- `SendClientCommand()` requires a non-empty trusted command line. Never concatenate untrusted text into it.
- Raw bitbuffer field order and widths are part of the selected SDK's wire contract.
- Raw protobuf names, repetition kinds, and scalar types must match the selected SDK's generated descriptors.

## Related modules

- [Typed messages classes](messages-types.md) are exposed through `require("messages")`, not a separate `messages/types` module.
- [`messages/dialog`](messages-dialog.md) provides typed dialog objects and fields.
- [`messages/implementation`](messages-implementation.md) provides decoded codecs, registry lookup and strict multi-recipient wrappers; typed creators handle per-player localization.
- [`memory/hooks/messages`](memory-hooks-messages.md) intercepts raw and decoded user messages.
