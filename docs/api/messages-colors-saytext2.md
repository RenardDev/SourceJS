# `require("messages/colors/saytext2")`

> Warning: this reference is large for AI-agent processing and exposes raw bytes from `0x01` through `0x10`. Use the contents list. Client rendering varies by game, and `StripSayText2ColorCodes()` also removes tab, newline, and carriage-return characters because they occupy the same byte range.

`messages/colors/saytext2` augments the live native color-code module for Source `SayText2` bodies. SourceJS installs the palette and native `Apply`/`Strip` functions; the package adds JavaScript `ColorizeSayText2MessageText` and `StripSayText2ColorCodes` implementations to that same runtime object and exports it.

Use [`messages.SayText2`](messages-types.md#saytext2) to send the resulting text. The smaller common palette and its `MessageColor` wrapper live in [`messages/colors`](messages-colors.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Palette](#palette)
- [`ColorizeSayText2MessageText()`](#colorizesaytext2messagetext)
- [`StripSayText2ColorCodes()`](#stripsaytext2colorcodes)
- [Sending SayText2](#sending-saytext2)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	BLUE,
	BRIGHT_GREEN,
	DARK_BLUE,
	DULL_RED,
	GRAY,
	GREEN,
	LIGHT_BLUE,
	ORANGE,
	PALE_GREEN,
	PALE_RED,
	PINK,
	RED,
	TEAM,
	WHITE,
	YELLOW,
	Apply,
	ColorizeSayText2MessageText,
	Strip,
	StripSayText2ColorCodes,
} = require("messages/colors/saytext2");

const g_vecSayText2ColorCodes = [
	BLUE,
	BRIGHT_GREEN,
	DARK_BLUE,
	DULL_RED,
	GRAY,
	GREEN,
	LIGHT_BLUE,
	ORANGE,
	PALE_GREEN,
	PALE_RED,
	PINK,
	RED,
	TEAM,
	WHITE,
	YELLOW,
];
const g_bCanApplyNativeSayText2Color = typeof Apply === "function";
const g_bCanColorizeSayText2MessageText = typeof ColorizeSayText2MessageText === "function";
const g_bCanStripNativeSayText2ColorCodes = typeof Strip === "function";
const g_bCanStripSayText2ColorCodes = typeof StripSayText2ColorCodes === "function";
if (!g_bCanApplyNativeSayText2Color || !g_bCanColorizeSayText2MessageText || !g_bCanStripNativeSayText2ColorCodes || !g_bCanStripSayText2ColorCodes) {
	throw new Error("The messages/colors/saytext2 module did not expose Apply(), ColorizeSayText2MessageText(), Strip(), and StripSayText2ColorCodes().");
}

for (const strColorCode of g_vecSayText2ColorCodes) {
	if ((typeof strColorCode !== "string") || (strColorCode.length !== 1)) {
		throw new Error("The messages/colors/saytext2 module returned an invalid palette code.");
	}
}
```

## Exports

| Export | Kind | Description |
| --- | --- | --- |
| `WHITE` | String constant | Control code `0x01`; reset appended by `ColorizeSayText2MessageText()`. |
| `RED` | String constant | Control code `0x02`. |
| `TEAM` | String constant | Control code `0x03`; resolved from the sender's team. |
| `BRIGHT_GREEN` | String constant | Control code `0x04`. |
| `PALE_GREEN` | String constant | Control code `0x05`. |
| `GREEN` | String constant | Control code `0x06`. |
| `PALE_RED` | String constant | Control code `0x07`. |
| `GRAY` | String constant | Control code `0x08`. |
| `YELLOW` | String constant | Control code `0x09`. |
| `LIGHT_BLUE` | String constant | Control code `0x0A`. |
| `BLUE` | String constant | Control code `0x0B`. |
| `DARK_BLUE` | String constant | Control code `0x0C`. |
| `PINK` | String constant | Control code `0x0E`. |
| `DULL_RED` | String constant | Control code `0x0F`. |
| `ORANGE` | String constant | Control code `0x10`. |
| [`ColorizeSayText2MessageText`](#colorizesaytext2messagetext) | Function | `ColorizeSayText2MessageText(strColorCode, strMessageText)` |
| [`StripSayText2ColorCodes`](#stripsaytext2colorcodes) | Function | `StripSayText2ColorCodes(strMessageText)` |
| `Apply` | Native function | `Apply(strSayText2ColorCode, strSayText2Message)` |
| `Strip` | Native function | `Strip(strSayText2Message)` |

## Palette

All constants are raw one-character strings. `0x0D` is intentionally absent because it is carriage return, not a named palette entry.

```js
const {
	BLUE,
	BRIGHT_GREEN,
	DARK_BLUE,
	DULL_RED,
	GRAY,
	GREEN,
	LIGHT_BLUE,
	ORANGE,
	PALE_GREEN,
	PALE_RED,
	PINK,
	RED,
	TEAM,
	WHITE,
	YELLOW,
} = require("messages/colors/saytext2");

const g_vecExpectedSayText2ColorCodes = [
	[WHITE, 0x01],
	[RED, 0x02],
	[TEAM, 0x03],
	[BRIGHT_GREEN, 0x04],
	[PALE_GREEN, 0x05],
	[GREEN, 0x06],
	[PALE_RED, 0x07],
	[GRAY, 0x08],
	[YELLOW, 0x09],
	[LIGHT_BLUE, 0x0A],
	[BLUE, 0x0B],
	[DARK_BLUE, 0x0C],
	[PINK, 0x0E],
	[DULL_RED, 0x0F],
	[ORANGE, 0x10],
];

let g_bHasCarriageReturnColorCode = false;
for (const [strColorCode, unExpectedCodePoint] of g_vecExpectedSayText2ColorCodes) {
	const unColorCodePoint = strColorCode.charCodeAt(0);
	if ((strColorCode.length !== 1) || (unColorCodePoint !== unExpectedCodePoint)) {
		throw new Error(`Unexpected SayText2 palette code: ${unColorCodePoint}.`);
	}

	if (unColorCodePoint === 0x0D) {
		g_bHasCarriageReturnColorCode = true;
	}
}

if (g_bHasCarriageReturnColorCode) {
	throw new Error("The SayText2 palette unexpectedly exposed carriage return.");
}
```

SourceJS preserves the engine control values, but the receiving game's client decides the visible color. A code that is distinct in one branch may render differently or fall back to another color in a different branch.

## `ColorizeSayText2MessageText()`

`ColorizeSayText2MessageText(strColorCode, strMessageText)` requires two strings, prefixes `strMessageText` with a non-empty `strColorCode`, and appends the current `WHITE` property (initially `\x01`) to reset later text. The `strColorCode` argument may contain more than one control byte.

```js
const { ColorizeSayText2MessageText, GREEN, ORANGE, WHITE } = require("messages/colors/saytext2");

const g_strCheckpointLabelText = ColorizeSayText2MessageText(GREEN, "[Checkpoint]");
const g_strGeneratorDetailText = ColorizeSayText2MessageText(ORANGE, " Generator started");
const g_strPriorityMessageText = ColorizeSayText2MessageText(`${GREEN}${ORANGE}`, "Priority");
const g_strCombinedCheckpointMessageText = `${g_strCheckpointLabelText}${g_strGeneratorDetailText}`;
const g_strExpectedCheckpointMessageText = `${GREEN}[Checkpoint]${WHITE}${ORANGE} Generator started${WHITE}`;
if (g_strCombinedCheckpointMessageText !== g_strExpectedCheckpointMessageText) {
	throw new Error("ColorizeSayText2MessageText() did not color and reset both message spans.");
}

if (g_strPriorityMessageText !== `${GREEN}${ORANGE}Priority${WHITE}`) {
	throw new Error("ColorizeSayText2MessageText() did not preserve a composed color prefix.");
}
```

The color-prefix check requires only a non-empty string, not membership in the palette. The function does not determine whether a client understands every byte in a composed prefix.

`Apply(strSayText2ColorCode, strSayText2Message)` is a separate native implementation. It appends the fixed `\x01` reset compiled into `ModuleBindings.cpp`; `ColorizeSayText2MessageText()` instead validates and reads the current live `WHITE` property for each call. Both accept arbitrary non-empty prefixes, not only named palette entries.

## `StripSayText2ColorCodes()`

`StripSayText2ColorCodes(strMessageText)` removes string code units `U+0001` through `U+0010`, corresponding to control bytes `0x01` through `0x10`. This includes all exported palette codes, the unassigned `0x0D` character, tab, and newline. Code units outside that range remain unchanged.

```js
const { BRIGHT_GREEN, RED, StripSayText2ColorCodes, WHITE } = require("messages/colors/saytext2");

const g_strColoredMessageText = `${BRIGHT_GREEN}[Ready]${WHITE}\n${RED}Boss${WHITE}\x11`;
const g_strPlainMessageText = StripSayText2ColorCodes(g_strColoredMessageText);
const g_strExpectedPlainMessageText = "[Ready]Boss\x11";
const g_unLastPlainMessageCodePoint = g_strPlainMessageText.charCodeAt(g_strPlainMessageText.length - 1);
if (g_strPlainMessageText !== g_strExpectedPlainMessageText) {
	throw new Error("StripSayText2ColorCodes() did not remove the complete SayText2 control range.");
}

if (g_unLastPlainMessageCodePoint !== 0x11) {
	throw new Error("StripSayText2ColorCodes() removed a byte outside the SayText2 control range.");
}
```

Use `StripSayText2ColorCodes()` for one-line chat or log text. It is not a general multiline sanitizer because literal line breaks are removed with the color range.

`Strip(strSayText2Message)` is the native implementation and removes the same `0x01` through `0x10` control range. It processes UTF-8 bytes; the JavaScript helper operates directly on string code units. Neither is a general sanitizer or a substitute for transport validation.

Both native functions preserve embedded NUL in their returned strings because SourceJS supplies the explicit UTF-8 length. This example only formats strings; it does not establish whether a game's chat transport can carry embedded NUL.

```js
const { Apply, GREEN, Strip } = require("messages/colors/saytext2");

const g_strNativeColoredText = Apply(GREEN, "Native\x00Text");
if (g_strNativeColoredText !== `${GREEN}Native\x00Text\x01`) {
	throw new Error("Apply() did not preserve its prefix, embedded NUL, and fixed reset.");
}

const g_strNativePlainText = Strip("\x04Native\x00Text\x01\x11");
if (g_strNativePlainText !== "Native\x00Text\x11") {
	throw new Error("Strip() did not remove only the native control range.");
}
```

## Sending SayText2

Insert codes into a typed `SayText2` message. Keep the user-schema option `SenderIndex` valid when using `TEAM`, since the client derives that color from the sender.

```js
const { SayText2 } = require("messages");
const { BRIGHT_GREEN, ORANGE, TEAM, WHITE } = require("messages/colors/saytext2");

const g_unSenderIndex = 1;
const g_strStatusMessageText = `${BRIGHT_GREEN}[Status]${WHITE} ${TEAM}{Player}${WHITE}: ${ORANGE}{State}${WHITE}`;
const g_StatusMessage = new SayText2(g_strStatusMessageText, {
	Chat: true,
	Parameter1: "{Player}",
	Parameter2: "{State}",
	SenderIndex: g_unSenderIndex,
});
const g_bStatusMessageSent = g_StatusMessage.SendUserMessage([1, 2], { Player: "Ren", State: "ready" });
if (!g_bStatusMessageSent) {
	throw new Error("SayText2.SendUserMessage() could not deliver the extended-color message.");
}
```

Sending requires a running server and connected human recipients. This module composes message bytes and cannot display UI in the game main menu.

## Errors

- `ColorizeSayText2MessageText(strColorCode, strMessageText)` throws `TypeError` unless both arguments are strings and `strColorCode` is non-empty; the current `WHITE` property must also be a non-empty string.
- `StripSayText2ColorCodes(strMessageText)` throws `TypeError` unless `strMessageText` is a string.
- Native `Apply` and `Strip` report invalid arguments through JavaScript `Error`, not the helpers' `TypeError`; native C++ exceptions are translated without replacing an already pending JavaScript error.
- `SayText2.SendUserMessage()` returns `false` when no connected human recipients remain or native delivery fails.

```js
const { Apply, ColorizeSayText2MessageText, GREEN, Strip, StripSayText2ColorCodes } = require("messages/colors/saytext2");

const g_vecInvalidColorCalls = [
	[() => ColorizeSayText2MessageText("", "Text"), TypeError],
	[() => ColorizeSayText2MessageText(GREEN, null), TypeError],
	[() => StripSayText2ColorCodes(null), TypeError],
	[() => Apply("", "Text"), Error],
	[() => Apply(GREEN, null), Error],
	[() => Strip(null), Error],
];
for (const vecInvalidColorCall of g_vecInvalidColorCalls) {
	const Call = vecInvalidColorCall[0];
	const ErrorType = vecInvalidColorCall[1];
	let ReceivedError = null;

	try {
		Call();
	} catch (CaughtError) {
		ReceivedError = CaughtError;
	}

	if ((ReceivedError === null) || (ReceivedError.constructor !== ErrorType)) {
		throw new Error("The color function did not report its documented error class.");
	}
}
```

## Lifecycle

No function in this module acquires resources requiring manual disposal. Palette values and results are ordinary immutable strings, but the exported palette fields belong to the shared live module. Do not mutate them casually: JavaScript colorization observes the current `WHITE`, while native `Apply` uses its compiled reset.

## Related modules

- [`messages`](messages.md) exposes the selected-SDK backend and low-level transport.
- [`messages`](messages-types.md) provides the typed `SayText2` creator.
- [`messages/colors`](messages-colors.md) provides the common five-code palette and `MessageColor` wrapper.
