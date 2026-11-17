# `require("messages/colors")`

> Warning: this reference is large for AI-agent processing and works with raw chat control characters. Use the contents list, preserve the codes as strings, keep the trailing `NORMAL` reset, and use `TEAM` only with a valid message sender.

`messages/colors` provides the control codes understood by common Source `SayText` and `SayText2` layouts, plus small helpers for composing and removing those codes. The implementation lives at `packages/sourcejs/messages/colors.js`; the five raw constants come from the native module installed for the selected SDK. The package augments and exports that exact live native object instead of copying its fields.

Use [`messages`](messages-types.md) to send the resulting text. Extended game-specific SayText2 codes live in [`messages/colors/saytext2`](messages-colors-saytext2.md) and must be imported directly.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Color codes](#color-codes)
- [`MessageColor`](#messagecolor)
- [`ColorizeMessageText()`](#colorizemessagetext)
- [`StripMessageColorCodes()`](#stripmessagecolorcodes)
- [Sending colored chat](#sending-colored-chat)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	MessageColor,
	GREEN,
	LIGHT_GREEN,
	NORMAL,
	OLIVE,
	TEAM,
	ColorizeMessageText,
	StripMessageColorCodes,
} = require("messages/colors");

const g_bHasMessageColor = typeof MessageColor === "function";
const g_bCanColorizeMessageText = typeof ColorizeMessageText === "function";
const g_bCanStripMessageColorCodes = typeof StripMessageColorCodes === "function";
if (!g_bHasMessageColor || !g_bCanColorizeMessageText || !g_bCanStripMessageColorCodes) {
	throw new Error("The messages/colors module did not expose every documented callable.");
}

for (const strColorCode of [GREEN, LIGHT_GREEN, NORMAL, OLIVE, TEAM]) {
	if ((typeof strColorCode !== "string") || (strColorCode.length !== 1)) {
		throw new Error("The messages/colors module returned an invalid control-code constant.");
	}
}
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`MessageColor`](#messagecolor) | Class | `new MessageColor(strColorCode)` |
| `GREEN` | String constant | Green control code. |
| `LIGHT_GREEN` | String constant | Light-green control code. |
| `NORMAL` | String constant | Default/reset control code. |
| `OLIVE` | String constant | Olive control code. |
| `TEAM` | String constant | Sender-team color control code. |
| [`ColorizeMessageText`](#colorizemessagetext) | Function | `ColorizeMessageText(strMessageText, MessageColorValue = NORMAL)` |
| [`StripMessageColorCodes`](#stripmessagecolorcodes) | Function | `StripMessageColorCodes(strMessageText)` |

## Color codes

The constants are one-character strings embedded directly in the message body. `TEAM` does not represent a fixed RGB value: the client resolves it from the message sender and the current game rules. `MessageColor.ColorizeMessageText()` and `ColorizeMessageText()` validate and read the current live `NORMAL` field for each trailing reset. Leave that shared field unchanged unless deliberately updating the live palette.

```js
const {
	GREEN,
	LIGHT_GREEN,
	NORMAL,
	OLIVE,
	TEAM,
} = require("messages/colors");

const g_vecExpectedColorCodes = [
	[GREEN, 0x04],
	[LIGHT_GREEN, 0x06],
	[NORMAL, 0x01],
	[OLIVE, 0x05],
	[TEAM, 0x03],
];
for (const [strColorCode, unExpectedCodePoint] of g_vecExpectedColorCodes) {
	const unColorCodePoint = strColorCode.charCodeAt(0);
	if ((strColorCode.length !== 1) || (unColorCodePoint !== unExpectedCodePoint)) {
		throw new Error(`Unexpected messages/colors control code: ${unColorCodePoint}.`);
	}
}
```

Keep the constants as strings. Numeric code points are useful for validation and diagnostics, but must not replace the exported values in a message body.

## `MessageColor`

`new MessageColor(strColorCode)` validates a non-empty string and stores it in the public writable `ColorCode` field. `ColorizeMessageText(strMessageText)` requires non-empty message text, prefixes it with the current `ColorCode`, and appends the validated live `NORMAL` value. The standard `toString()` method validates and returns the current `ColorCode`, so template interpolation inserts that string directly.

A color prefix need not be a single character or a named palette entry. Keep `ColorCode` a non-empty string when assigning it: the instance's `ColorizeMessageText()` interpolates that field without revalidating it, whereas `toString()` and the module-level `ColorizeMessageText()` validate the current field.

```js
const { GREEN, MessageColor, NORMAL } = require("messages/colors");

const g_GreenMessageColor = new MessageColor(GREEN);
const g_strColorizedMessageText = g_GreenMessageColor.ColorizeMessageText("Upload complete");
const g_strInterpolatedMessageText = `${g_GreenMessageColor}Upload complete${NORMAL}`;
const g_strExpectedMessageText = `${GREEN}Upload complete${NORMAL}`;
const g_bHasGreenColorCode = g_GreenMessageColor.ColorCode === GREEN;
const g_bStringifiesToGreen = g_GreenMessageColor.toString() === GREEN;
const g_bConvertsToGreenString = String(g_GreenMessageColor) === GREEN;
const g_bColorizedMessageMatches = g_strColorizedMessageText === g_strExpectedMessageText;
const g_bInterpolatedMessageMatches = g_strInterpolatedMessageText === g_strColorizedMessageText;
if (!g_bHasGreenColorCode || !g_bStringifiesToGreen || !g_bConvertsToGreenString) {
	throw new Error("MessageColor did not retain its control code.");
}

if (!g_bColorizedMessageMatches || !g_bInterpolatedMessageMatches) {
	throw new Error("MessageColor did not wrap the message with a trailing reset.");
}
```

```js
const { GREEN, MessageColor, NORMAL, TEAM } = require("messages/colors");

const g_CustomMessageColor = new MessageColor(GREEN);
g_CustomMessageColor.ColorCode = `${TEAM}${GREEN}`;
const g_strCustomMessageText = g_CustomMessageColor.ColorizeMessageText("Ready");
if ((g_CustomMessageColor.toString() !== `${TEAM}${GREEN}`) || (g_strCustomMessageText !== `${TEAM}${GREEN}Ready${NORMAL}`)) {
	throw new Error("MessageColor did not observe the updated non-empty prefix.");
}
```

`messages/colors.MessageColor` represents a chat control string. It is unrelated to the RGBA [`colors.Color`](colors.md) structure used by engine rendering APIs.

## `ColorizeMessageText()`

`ColorizeMessageText(strMessageText, MessageColorValue)` requires non-empty message text and accepts either a `MessageColor` with a non-empty string `ColorCode` or a non-empty prefix string. It appends the validated current `NORMAL`. Omitting or passing `undefined` for `MessageColorValue` reads `NORMAL` as the default prefix; the trailing reset is read separately in the function body.

```js
const { ColorizeMessageText, MessageColor, NORMAL, OLIVE } = require("messages/colors");

const g_strServerLabelText = ColorizeMessageText("[Server]", new MessageColor(OLIVE));
const g_strCheckpointMessageText = ColorizeMessageText(" Checkpoint reached");
const g_strExpectedServerLabelText = `${OLIVE}[Server]${NORMAL}`;
const g_strExpectedCheckpointMessageText = `${NORMAL} Checkpoint reached${NORMAL}`;
const g_bServerLabelColorized = g_strServerLabelText === g_strExpectedServerLabelText;
const g_bCheckpointMessageColorized = g_strCheckpointMessageText === g_strExpectedCheckpointMessageText;
const g_bCombinedMessageEndsWithNormal = `${g_strServerLabelText}${g_strCheckpointMessageText}`.endsWith(NORMAL);
if (!g_bServerLabelColorized) {
	throw new Error("ColorizeMessageText() did not apply the MessageColor instance.");
}

if (!g_bCheckpointMessageColorized || !g_bCombinedMessageEndsWithNormal) {
	throw new Error("ColorizeMessageText() did not apply its default reset color.");
}
```

For multiple colored spans, call `ColorizeMessageText()` for each span or insert exported codes directly. Every result resets at its end, so color does not bleed into later chat text.

## `StripMessageColorCodes()`

`StripMessageColorCodes(strMessageText)` removes string code units `U+0001` through `U+0006`, which covers every constant exported by this module and also removes `\x02`. Code units outside that range remain unchanged, including embedded NUL and line breaks. Empty input returns an empty string. This is color-code removal, not a general sanitizer or transport validator.

```js
const { ColorizeMessageText, GREEN, NORMAL, OLIVE, StripMessageColorCodes } = require("messages/colors");

const g_strColoredMessageText = `${ColorizeMessageText("[Ready]", GREEN)} ${ColorizeMessageText("Ren", OLIVE)}\x07`;
const g_strPlainMessageText = StripMessageColorCodes(g_strColoredMessageText);
if (g_strColoredMessageText !== `${GREEN}[Ready]${NORMAL} ${OLIVE}Ren${NORMAL}\x07`) {
	throw new Error("The colored message did not contain the expected raw control codes.");
}

if (g_strPlainMessageText !== "[Ready] Ren\x07") {
	throw new Error("StripMessageColorCodes() removed text or an extended control code.");
}
```

Use [`messages/colors/saytext2.StripSayText2ColorCodes()`](messages-colors-saytext2.md#stripsaytext2colorcodes) when message text may contain extended `\x07` through `\x10` codes.

## Sending colored chat

Build the body with this module and send it through a typed message. The user-schema option `SenderIndex` matters when the body contains `TEAM`; it must identify the player whose team color the client should use.

```js
const { SayText2 } = require("messages");
const { GREEN, NORMAL, TEAM } = require("messages/colors");

const g_unSenderIndex = 1;
const g_JoinMessage = new SayText2(`${GREEN}[Join]${NORMAL} ${TEAM}{Player}${NORMAL} connected.`, {
	Chat: true,
	Parameter1: "{Player}",
	SenderIndex: g_unSenderIndex,
});
const g_bJoinMessageSent = g_JoinMessage.SendUserMessage([1, 2], { Player: "Ren" });
if (!g_bJoinMessageSent) {
	throw new Error("SayText2.SendUserMessage() did not reach any connected human recipient.");
}
```

The send requires a running server and connected human recipients. Color helpers only compose text; they do not create client UI in the game main menu.

## Errors

- `new MessageColor(strColorCode)` throws `TypeError` unless `strColorCode` is a non-empty string.
- `MessageColor.ColorizeMessageText(strMessageText)` and `ColorizeMessageText(strMessageText, MessageColorValue)` throw `TypeError` unless `strMessageText` is a non-empty string.
- `StripMessageColorCodes(strMessageText)` throws `TypeError` for non-string input but accepts empty strings.
- `ColorizeMessageText(strMessageText, MessageColorValue)` throws `TypeError` unless the selected prefix is a non-empty string, including the current `ColorCode` read from a `MessageColor` instance.
- `MessageColor.toString()` throws `TypeError` if the current `ColorCode` is no longer a non-empty string.
- `MessageColor.ColorizeMessageText()` and `ColorizeMessageText()` throw `TypeError` if the current live `NORMAL` field is not a non-empty string.
- `SayText2.SendUserMessage()` returns `false` when no connected human recipients remain or native delivery fails.

```js
const { ColorizeMessageText, GREEN, MessageColor, StripMessageColorCodes } = require("messages/colors");

const g_vecInvalidColorCalls = [
	() => new MessageColor(""),
	() => new MessageColor(null),
	() => new MessageColor(GREEN).ColorizeMessageText(""),
	() => new MessageColor(GREEN).ColorizeMessageText(null),
	() => ColorizeMessageText(""),
	() => ColorizeMessageText(null),
	() => ColorizeMessageText("Text", ""),
	() => ColorizeMessageText("Text", null),
	() => StripMessageColorCodes(null),
];
for (const Call of g_vecInvalidColorCalls) {
	let ReceivedError = null;

	try {
		Call();
	} catch (CaughtError) {
		ReceivedError = CaughtError;
	}

	if ((ReceivedError === null) || (ReceivedError.constructor !== TypeError)) {
		throw new Error("The color helper did not report TypeError for an invalid argument.");
	}
}

if (StripMessageColorCodes("") !== "") {
	throw new Error("StripMessageColorCodes() did not preserve empty input.");
}
```

## Lifecycle

The color helpers acquire no resources requiring manual disposal. `ColorCode` is a writable JavaScript field, and the palette is the shared live runtime object. Keep its constants as non-empty strings. A sent `SayText2` object can be reused, but every `SendUserMessage()` call evaluates the current recipients and runtime backend again.

## Related modules

- [`messages`](messages.md) exposes the selected-SDK backend and low-level message transport.
- [`messages`](messages-types.md) provides typed `SayText` and `SayText2` creators.
- [`messages/colors/saytext2`](messages-colors-saytext2.md) provides extended game-specific codes.
- [`colors`](colors.md) provides the unrelated RGBA color structure used by engine APIs.
