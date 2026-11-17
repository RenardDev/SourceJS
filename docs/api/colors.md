# `require("colors")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`Color`](#color)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. When using colors in HUD messages or native memory, follow the relevant messaging and memory ownership contracts.

Native boundary: only `CreateRGBAColor` depends directly on the native `colors` module. `ModuleBindings.cpp` installs native `colors.CreateRGBAColor` unconditionally; the package implements the palette and `Color` API and uses memory helpers for address-backed storage.

## Location and purpose

The package implementation lives in [`packages/sourcejs/colors.js`](../../packages/sourcejs/colors.js), and [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs native `colors.CreateRGBAColor`. Use the package for RGBA values, shared palette colors, HUD/message options, and address-backed native color storage. Its `CreateRGBAColor` wrapper converts the native `{ Red, Green, Blue, Alpha }` record into a `Color`. See the `Color` API below for channel validation, byte layout, copying, equality, iteration, text control codes, and native memory access; value-backed and address-backed storage have different lifetime requirements.

## Import

```js
const { Color, ORANGE, CreateRGBAColor } = require("colors");

console.log(new Color(), ORANGE, CreateRGBAColor());
```

## Exports

| Export | Kind | Signature or value |
| --- | --- | --- |
| [`BLACK`](#black) | Constant | Frozen `Color` instance. |
| [`BLUE`](#blue) | Constant | Frozen `Color` instance. |
| [`BROWN`](#brown) | Constant | Frozen `Color` instance. |
| [`COLOR_SIZE`](#color_size) | Constant | `4`: the package's RGBA storage size in bytes, one byte per channel. |
| [`CYAN`](#cyan) | Constant | Frozen `Color` instance. |
| [`Color`](#color-1) | Class | `new Color(dblRed = 0, dblGreen = 0, dblBlue = 0, dblAlpha = 0xFF, unAddress = null, nAddressOffset = 0n)`; `null` selects value-backed storage. Address-backed storage requires a positive BigInt within the native address width and a signed 64-bit BigInt offset; the resulting address must also be positive and within native width. |
| [`DARK_BLUE`](#dark_blue) | Constant | Frozen `Color` instance. |
| [`DARK_GRAY`](#dark_gray) | Constant | Frozen `Color` instance. |
| [`DARK_GREEN`](#dark_green) | Constant | Frozen `Color` instance. |
| [`DARK_RED`](#dark_red) | Constant | Frozen `Color` instance. |
| [`GRAY`](#gray) | Constant | Frozen `Color` instance. |
| [`GREEN`](#green) | Constant | Frozen `Color` instance. |
| [`LIGHT_BLUE`](#light_blue) | Constant | Frozen `Color` instance. |
| [`LIGHT_GRAY`](#light_gray) | Constant | Frozen `Color` instance. |
| [`LIGHT_GREEN`](#light_green) | Constant | Frozen `Color` instance. |
| [`LIGHT_RED`](#light_red) | Constant | Frozen `Color` instance. |
| [`OLIVE`](#olive) | Constant | Frozen `Color` instance. |
| [`ORANGE`](#orange) | Constant | Frozen `Color` instance. |
| [`PURPLE`](#purple) | Constant | Frozen `Color` instance. |
| [`RED`](#red) | Constant | Frozen `Color` instance. |
| [`WHITE`](#white) | Constant | Frozen `Color` instance. |
| [`YELLOW`](#yellow) | Constant | Frozen `Color` instance. |
| [`CreateFrozenColor`](#createfrozencolor) | Function | `CreateFrozenColor(dblRed = 0, dblGreen = 0, dblBlue = 0, dblAlpha = 0xFF)` |
| [`CreateRGBAColor`](#creatergbacolor) | Function | `CreateRGBAColor(unRed = 0xFF, unGreen = 0xFF, unBlue = 0xFF, unAlpha = 0xFF)` |

## `Color`

| Member | Signature or access |
| --- | --- |
| [`TYPE_SIZE`](#colortype_size) | Static RGBA storage size: `4` bytes. |
| [`Red`](#colorred) | Writable channel property on non-frozen colors. |
| [`Green`](#colorgreen) | Writable channel property on non-frozen colors. |
| [`Blue`](#colorblue) | Writable channel property on non-frozen colors. |
| [`Alpha`](#coloralpha) | Writable channel property on non-frozen colors. |
| `[Symbol.iterator]` | `[Symbol.iterator]()` yields red, green, blue, then alpha. |
| [`ConvertColorToArray`](#colorconvertcolortoarray) | `ConvertColorToArray()` returns a new RGBA array. |
| [`ConvertColorToHexString`](#colorconvertcolortohexstring) | `ConvertColorToHexString()` returns a text color control sequence, not CSS: `\x07RRGGBB` when opaque, otherwise `\x08RRGGBBAA`. |
| [`CopyColor`](#colorcopycolor) | `CopyColor()` returns a new value-backed color with the current channels. |
| [`CopyColorFrom`](#colorcopycolorfrom) | `CopyColorFrom(ColorLike)` converts the source, copies its channels into this color, and returns this color. |
| [`CopyColorTo`](#colorcopycolorto) | `CopyColorTo(TargetColor)` requires a `Color` target, copies channels into it, and returns the target. |
| [`CreateColorWithAlpha`](#colorcreatecolorwithalpha) | `CreateColorWithAlpha(dblAlpha = 0xFF)` creates a new value-backed color with the same RGB and the requested alpha; the original is unchanged. |
| [`DoesColorEqual`](#colordoescolorequal) | `DoesColorEqual(ColorLike)` converts the argument and compares all four channels. Conversion errors propagate rather than returning false. |
| [`FreezeColor`](#colorfreezecolor) | `FreezeColor()` marks this color frozen, freezes its JavaScript object, and returns this color. It does not freeze external native memory. |
| [`GetColorChannel`](#colorgetcolorchannel) | `GetColorChannel(unIndex)` reads the RGBA channel at integer index `0`–`3`, from native memory when address-backed or from stored values otherwise. Invalid indices throw `RangeError`. |
| [`GetColorAddress`](#colorgetcoloraddress) | `GetColorAddress()` returns the stored backing address as a BigInt, or `null` for value-backed storage, without allocating or copying storage. |
| [`HasColorAddress`](#colorhascoloraddress) | `HasColorAddress()` checks whether the stored address is truthy and non-null. It does not prove that the referenced memory is still valid. |
| [`SetColorChannel`](#colorsetcolorchannel) | `SetColorChannel(unIndex, dblComponent)` sets channel `0`–`3` and returns this color. Finite numeric components are truncated and clamped to `0`–`255`; invalid indices throw `RangeError`, and frozen colors or invalid components throw `TypeError`. Native-helper exceptions propagate; the successful native write boolean is not exposed. |
| [`toString`](#colortostring) | `toString()` returns the same text-control representation as `ConvertColorToHexString()`, not CSS color syntax. |
| [`CreateColorFromAddress`](#colorcreatecolorfromaddress) | Static method: `CreateColorFromAddress(unAddress, nAddressOffset = 0n)` creates a non-owning color view without copying the native RGBA bytes. Both the positive BigInt base and the offset result must fit native address width, including with `0n` offset; the offset must fit signed 64-bit storage and must not produce a null address. Missing, null, Number, negative, or out-of-width base addresses are rejected. Arithmetic validation does not establish mapped storage or ownership; keep the backing storage valid while accessing its channels. |
| [`CreateColorFromValue`](#colorcreatecolorfromvalue) | Static method: `CreateColorFromValue(ColorLike)` returns an existing `Color` unchanged, wraps an address, or creates a color from an array-like value or object with `Red`, `Green`, `Blue`, and `Alpha` properties. Conversion errors propagate; this is not an unconditional copy operation. |

## Examples

### `BLACK`

```js
const { HUDMessage } = require("messages");
const { BLACK } = require("colors");

const g_PrimaryColor = { Red: BLACK.Red, Green: BLACK.Green, Blue: BLACK.Blue, Alpha: BLACK.Alpha };
const g_SecondaryColor = { ...g_PrimaryColor, Alpha: 160 };
const g_Message = new HUDMessage("Safe room door locked", { PrimaryColor: g_PrimaryColor, SecondaryColor: g_SecondaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `BLUE`

```js
const { HUDMessage } = require("messages");
const { BLUE } = require("colors");

const g_PrimaryColor = { Red: BLUE.Red, Green: BLUE.Green, Blue: BLUE.Blue, Alpha: BLUE.Alpha };
const g_Message = new HUDMessage("Rescue vehicle inbound", { PrimaryColor: g_PrimaryColor, HoldTime: 3 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `BROWN`

```js
const { HUDMessage } = require("messages");
const { BROWN } = require("colors");

const g_PrimaryColor = { Red: BROWN.Red, Green: BROWN.Green, Blue: BROWN.Blue, Alpha: BROWN.Alpha };
const g_Message = new HUDMessage("Barricade damaged", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `COLOR_SIZE`

```js
const { Allocate, Deallocate } = require("memory");
const { Color, COLOR_SIZE } = require("colors");

const g_unColorAddress = Allocate(COLOR_SIZE);
try {
	const ColorValue = Color.CreateColorFromAddress(g_unColorAddress);
	ColorValue.CopyColorFrom([64, 192, 255, 255]);

	console.log(ColorValue.ConvertColorToArray());
} finally {
	if (!Deallocate(g_unColorAddress)) {
		console.warn("Unable to release color memory.");
	}
}
```

### `CYAN`

```js
const { HUDMessage } = require("messages");
const { CYAN } = require("colors");

const g_PrimaryColor = { Red: CYAN.Red, Green: CYAN.Green, Blue: CYAN.Blue, Alpha: CYAN.Alpha };
const g_Message = new HUDMessage("Generator online", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color`

```js
const { Color } = require("colors");
const { HUDMessage } = require("messages");

const g_ObjectiveColor = new Color(64, 192, 255, 255);
const g_PrimaryColor = { Red: g_ObjectiveColor.Red, Green: g_ObjectiveColor.Green, Blue: g_ObjectiveColor.Blue, Alpha: g_ObjectiveColor.Alpha };
const g_Message = new HUDMessage("Hold this position", { PrimaryColor: g_PrimaryColor, HoldTime: 4 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.TYPE_SIZE`

```js
const { Allocate, Deallocate } = require("memory");
const { Color } = require("colors");

const g_unColorAddress = Allocate(Color.TYPE_SIZE);
try {
	const ColorValue = Color.CreateColorFromAddress(g_unColorAddress);
	ColorValue.CopyColorFrom([64, 192, 255, 255]);

	console.log(ColorValue.ConvertColorToArray());
} finally {
	if (!Deallocate(g_unColorAddress)) {
		console.warn("Unable to release color memory.");
	}
}
```

### `DARK_BLUE`

```js
const { HUDMessage } = require("messages");
const { DARK_BLUE } = require("colors");

const g_PrimaryColor = { Red: DARK_BLUE.Red, Green: DARK_BLUE.Green, Blue: DARK_BLUE.Blue, Alpha: DARK_BLUE.Alpha };
const g_SecondaryColor = { ...g_PrimaryColor, Alpha: 96 };
const g_Message = new HUDMessage("Night vision enabled", { PrimaryColor: g_PrimaryColor, SecondaryColor: g_SecondaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `DARK_GRAY`

```js
const { HUDMessage } = require("messages");
const { DARK_GRAY } = require("colors");

const g_PrimaryColor = { Red: DARK_GRAY.Red, Green: DARK_GRAY.Green, Blue: DARK_GRAY.Blue, Alpha: DARK_GRAY.Alpha };
const g_Message = new HUDMessage("Spectator mode", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `DARK_GREEN`

```js
const { HUDMessage } = require("messages");
const { DARK_GREEN } = require("colors");

const g_PrimaryColor = { Red: DARK_GREEN.Red, Green: DARK_GREEN.Green, Blue: DARK_GREEN.Blue, Alpha: DARK_GREEN.Alpha };
const g_Message = new HUDMessage("Area secured", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `DARK_RED`

```js
const { HUDMessage } = require("messages");
const { DARK_RED } = require("colors");

const g_PrimaryColor = { Red: DARK_RED.Red, Green: DARK_RED.Green, Blue: DARK_RED.Blue, Alpha: DARK_RED.Alpha };
const g_Message = new HUDMessage("Final warning", { PrimaryColor: g_PrimaryColor, HoldTime: 3 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `GRAY`

```js
const { HUDMessage } = require("messages");
const { GRAY } = require("colors");

const g_PrimaryColor = { Red: GRAY.Red, Green: GRAY.Green, Blue: GRAY.Blue, Alpha: GRAY.Alpha };
const g_Message = new HUDMessage("Waiting for players", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `GREEN`

```js
const { HUDMessage } = require("messages");
const { GREEN } = require("colors");

const g_PrimaryColor = { Red: GREEN.Red, Green: GREEN.Green, Blue: GREEN.Blue, Alpha: GREEN.Alpha };
const g_Message = new HUDMessage("Checkpoint reached", { PrimaryColor: g_PrimaryColor, HoldTime: 3 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `LIGHT_BLUE`

```js
const { HUDMessage } = require("messages");
const { LIGHT_BLUE } = require("colors");

const g_PrimaryColor = { Red: LIGHT_BLUE.Red, Green: LIGHT_BLUE.Green, Blue: LIGHT_BLUE.Blue, Alpha: LIGHT_BLUE.Alpha };
const g_Message = new HUDMessage("Teammate needs help", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `LIGHT_GRAY`

```js
const { HUDMessage } = require("messages");
const { LIGHT_GRAY } = require("colors");

const g_PrimaryColor = { Red: LIGHT_GRAY.Red, Green: LIGHT_GRAY.Green, Blue: LIGHT_GRAY.Blue, Alpha: LIGHT_GRAY.Alpha };
const g_Message = new HUDMessage("Round begins in 10 seconds", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `LIGHT_GREEN`

```js
const { HUDMessage } = require("messages");
const { LIGHT_GREEN } = require("colors");

const g_PrimaryColor = { Red: LIGHT_GREEN.Red, Green: LIGHT_GREEN.Green, Blue: LIGHT_GREEN.Blue, Alpha: LIGHT_GREEN.Alpha };
const g_Message = new HUDMessage("Health restored", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `LIGHT_RED`

```js
const { HUDMessage } = require("messages");
const { LIGHT_RED } = require("colors");

const g_PrimaryColor = { Red: LIGHT_RED.Red, Green: LIGHT_RED.Green, Blue: LIGHT_RED.Blue, Alpha: LIGHT_RED.Alpha };
const g_Message = new HUDMessage("Low health", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `OLIVE`

```js
const { HUDMessage } = require("messages");
const { OLIVE } = require("colors");

const g_PrimaryColor = { Red: OLIVE.Red, Green: OLIVE.Green, Blue: OLIVE.Blue, Alpha: OLIVE.Alpha };
const g_Message = new HUDMessage("Ammo reserve low", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `ORANGE`

```js
const { HUDMessage } = require("messages");
const { ORANGE } = require("colors");

const g_PrimaryColor = { Red: ORANGE.Red, Green: ORANGE.Green, Blue: ORANGE.Blue, Alpha: ORANGE.Alpha };
const g_Message = new HUDMessage("Objective contested", { PrimaryColor: g_PrimaryColor, HoldTime: 3 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `PURPLE`

```js
const { HUDMessage } = require("messages");
const { PURPLE } = require("colors");

const g_PrimaryColor = { Red: PURPLE.Red, Green: PURPLE.Green, Blue: PURPLE.Blue, Alpha: PURPLE.Alpha };
const g_Message = new HUDMessage("Bonus challenge active", { PrimaryColor: g_PrimaryColor, HoldTime: 3 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `RED`

```js
const { HUDMessage } = require("messages");
const { RED } = require("colors");

const g_PrimaryColor = { Red: RED.Red, Green: RED.Green, Blue: RED.Blue, Alpha: RED.Alpha };
const g_Message = new HUDMessage("Tank incoming", { PrimaryColor: g_PrimaryColor, HoldTime: 4 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `WHITE`

```js
const { HUDMessage } = require("messages");
const { WHITE } = require("colors");

const g_PrimaryColor = { Red: WHITE.Red, Green: WHITE.Green, Blue: WHITE.Blue, Alpha: WHITE.Alpha };
const g_Message = new HUDMessage("Round live", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `YELLOW`

```js
const { HUDMessage } = require("messages");
const { YELLOW } = require("colors");

const g_PrimaryColor = { Red: YELLOW.Red, Green: YELLOW.Green, Blue: YELLOW.Blue, Alpha: YELLOW.Alpha };
const g_Message = new HUDMessage("Elevator arriving", { PrimaryColor: g_PrimaryColor, HoldTime: 3 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `CreateRGBAColor`

```js
const { CreateRGBAColor } = require("colors");
const { HUDMessage } = require("messages");

const g_ObjectiveColor = CreateRGBAColor(64, 192, 255, 255);
const g_PrimaryColor = { Red: g_ObjectiveColor.Red, Green: g_ObjectiveColor.Green, Blue: g_ObjectiveColor.Blue, Alpha: g_ObjectiveColor.Alpha };
const g_Message = new HUDMessage("Defend the generator", { PrimaryColor: g_PrimaryColor, HoldTime: 4 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.Alpha`

```js
const { Color } = require("colors");
const { HUDMessage } = require("messages");

const g_ColorValue = new Color(64, 192, 255, 255);
g_ColorValue.Alpha = 160;

const g_PrimaryColor = { Red: g_ColorValue.Red, Green: g_ColorValue.Green, Blue: g_ColorValue.Blue, Alpha: g_ColorValue.Alpha };
const g_Message = new HUDMessage(`Marker alpha: ${g_ColorValue.Alpha}`, { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color[Symbol.iterator]`

```js
const { ORANGE } = require("colors");
const { Emit } = require("plugins/bus");

Emit("HUDPaletteColor", { RGBA: [...ORANGE] }, { Source: "hud-controller" });
```

### `Color.Blue`

```js
const { Color } = require("colors");
const { HUDMessage } = require("messages");

const g_ColorValue = new Color(64, 192, 255, 255);
g_ColorValue.Blue = 160;

const g_PrimaryColor = { Red: g_ColorValue.Red, Green: g_ColorValue.Green, Blue: g_ColorValue.Blue, Alpha: g_ColorValue.Alpha };
const g_Message = new HUDMessage(`Blue channel: ${g_ColorValue.Blue}`, { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.CopyColor`

```js
const { CYAN } = require("colors");
const { HUDMessage } = require("messages");

const g_TranslucentCyan = CYAN.CopyColor();
g_TranslucentCyan.Alpha = 160;

const g_PrimaryColor = { Red: g_TranslucentCyan.Red, Green: g_TranslucentCyan.Green, Blue: g_TranslucentCyan.Blue, Alpha: g_TranslucentCyan.Alpha };
const g_Message = new HUDMessage("Copied palette color", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.CopyColorFrom`

```js
const { Color, ORANGE } = require("colors");
const { HUDMessage } = require("messages");

const g_ObjectiveColor = new Color();
g_ObjectiveColor.CopyColorFrom(ORANGE);

const g_PrimaryColor = { Red: g_ObjectiveColor.Red, Green: g_ObjectiveColor.Green, Blue: g_ObjectiveColor.Blue, Alpha: g_ObjectiveColor.Alpha };
const g_Message = new HUDMessage("Objective updated", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.CopyColorTo`

```js
const { Color, LIGHT_GREEN } = require("colors");
const { HUDMessage } = require("messages");

const g_HealthColor = new Color();
LIGHT_GREEN.CopyColorTo(g_HealthColor);

const g_PrimaryColor = { Red: g_HealthColor.Red, Green: g_HealthColor.Green, Blue: g_HealthColor.Blue, Alpha: g_HealthColor.Alpha };
const g_Message = new HUDMessage("Health restored", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.DoesColorEqual`

```js
const { Color, ORANGE } = require("colors");
const { HUDMessage } = require("messages");

const g_ConfiguredColor = Color.CreateColorFromValue([255, 165, 0, 255]);
if (g_ConfiguredColor.DoesColorEqual(ORANGE)) {
	const PrimaryColor = { Red: g_ConfiguredColor.Red, Green: g_ConfiguredColor.Green, Blue: g_ConfiguredColor.Blue, Alpha: g_ConfiguredColor.Alpha };
	const Message = new HUDMessage("Objective color loaded", { PrimaryColor, HoldTime: 2 });
	if (!Message.SendUserMessage([1])) {
		console.warn("HUD message was not delivered to every intended recipient.");
	}
}
```

### `Color.FreezeColor`

```js
const { Color } = require("colors");
const { HUDMessage } = require("messages");

const g_ObjectiveColor = new Color(64, 192, 255, 255).FreezeColor();
const g_PrimaryColor = { Red: g_ObjectiveColor.Red, Green: g_ObjectiveColor.Green, Blue: g_ObjectiveColor.Blue, Alpha: g_ObjectiveColor.Alpha };
const g_Message = new HUDMessage("Immutable objective style", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.CreateColorFromValue`

```js
const { Color } = require("colors");
const { HUDMessage } = require("messages");

const g_ConfiguredColor = Color.CreateColorFromValue({ Red: 255, Green: 165, Blue: 0, Alpha: 220 });
const g_PrimaryColor = { Red: g_ConfiguredColor.Red, Green: g_ConfiguredColor.Green, Blue: g_ConfiguredColor.Blue, Alpha: g_ConfiguredColor.Alpha };
const g_Message = new HUDMessage("Color loaded from configuration", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.CreateColorFromAddress`

```js
const { Allocate, Deallocate } = require("memory");
const { Color, COLOR_SIZE, PURPLE } = require("colors");

const g_unColorAddress = Allocate(COLOR_SIZE + 2);
try {
	const ColorValue = Color.CreateColorFromAddress(g_unColorAddress, 2n);
	ColorValue.CopyColorFrom(PURPLE.CreateColorWithAlpha(192));

	console.log(ColorValue.ConvertColorToArray());
} finally {
	if (!Deallocate(g_unColorAddress)) {
		console.warn("Unable to release color memory.");
	}
}
```

### `Color.GetColorChannel`

```js
const { Color } = require("colors");

const g_ColorValue = new Color(64, 192, 255, 255);
console.log(`Green channel: ${g_ColorValue.GetColorChannel(1)}`);
```

### `Color.GetColorAddress`

```js
const { Allocate, Deallocate } = require("memory");
const { Read } = require("memory/helpers");
const { Color, COLOR_SIZE } = require("colors");

const g_unColorAddress = Allocate(COLOR_SIZE);
try {
	const ColorValue = Color.CreateColorFromAddress(g_unColorAddress);
	ColorValue.Red = 64;

	console.log(Read(ColorValue.GetColorAddress(), "uchar"));
} finally {
	if (!Deallocate(g_unColorAddress)) {
		console.warn("Unable to release color memory.");
	}
}
```

### `Color.Green`

```js
const { Color } = require("colors");
const { HUDMessage } = require("messages");

const g_ColorValue = new Color(64, 192, 255, 255);
g_ColorValue.Green = 220;

const g_PrimaryColor = { Red: g_ColorValue.Red, Green: g_ColorValue.Green, Blue: g_ColorValue.Blue, Alpha: g_ColorValue.Alpha };
const g_Message = new HUDMessage(`Green channel: ${g_ColorValue.Green}`, { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.HasColorAddress`

```js
const { Allocate, Deallocate } = require("memory");
const { Color, COLOR_SIZE } = require("colors");

const g_unColorAddress = Allocate(COLOR_SIZE);
try {
	const ColorValue = Color.CreateColorFromAddress(g_unColorAddress);
	console.log(ColorValue.HasColorAddress());
} finally {
	if (!Deallocate(g_unColorAddress)) {
		console.warn("Unable to release color memory.");
	}
}
```

### `Color.Red`

```js
const { Color } = require("colors");
const { HUDMessage } = require("messages");

const g_ColorValue = new Color(64, 192, 255, 255);
g_ColorValue.Red = 96;

const g_PrimaryColor = { Red: g_ColorValue.Red, Green: g_ColorValue.Green, Blue: g_ColorValue.Blue, Alpha: g_ColorValue.Alpha };
const g_Message = new HUDMessage(`Red channel: ${g_ColorValue.Red}`, { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.SetColorChannel`

```js
const { Color } = require("colors");
const { HUDMessage } = require("messages");

const g_ColorValue = new Color(64, 192, 255, 255);
g_ColorValue.SetColorChannel(1, 220);

const g_PrimaryColor = { Red: g_ColorValue.Red, Green: g_ColorValue.Green, Blue: g_ColorValue.Blue, Alpha: g_ColorValue.Alpha };
const g_Message = new HUDMessage("Green channel changed by index", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

### `Color.ConvertColorToArray`

```js
const { Color } = require("colors");
const { Emit } = require("plugins/bus");

const g_ColorValue = new Color(64, 192, 255, 255);
Emit("HUDObjectiveColor", { RGBA: g_ColorValue.ConvertColorToArray() }, { Source: "HUDController" });
```

### `Color.ConvertColorToHexString`

```js
const { ORANGE } = require("colors");
const { SayText2 } = require("messages");

const g_Message = new SayText2("Objective contested", { Color: ORANGE.ConvertColorToHexString() });
if (!g_Message.SendUserMessage([1])) {
	console.warn("Message was not delivered to every intended recipient.");
}
```

### `Color.toString`

```js
const { ORANGE } = require("colors");
const { SayText2 } = require("messages");

const g_Message = new SayText2("Objective contested", { Color: `${ORANGE}` });
if (!g_Message.SendUserMessage([1])) {
	console.warn("Message was not delivered to every intended recipient.");
}
```

### `Color.CreateColorWithAlpha`

```js
const { BLUE } = require("colors");
const { HUDMessage } = require("messages");

const g_TranslucentBlue = BLUE.CreateColorWithAlpha(128);
const g_PrimaryColor = { Red: g_TranslucentBlue.Red, Green: g_TranslucentBlue.Green, Blue: g_TranslucentBlue.Blue, Alpha: g_TranslucentBlue.Alpha };
const g_Message = new HUDMessage("Semi-transparent marker", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("Message was not delivered to every intended recipient.");
}
```

### `CreateFrozenColor`

```js
const { CreateFrozenColor } = require("colors");
const { HUDMessage } = require("messages");

const g_AlertColor = CreateFrozenColor(255, 96, 0, 224);
const g_PrimaryColor = { Red: g_AlertColor.Red, Green: g_AlertColor.Green, Blue: g_AlertColor.Blue, Alpha: g_AlertColor.Alpha };
const g_Message = new HUDMessage("Custom alert color", { PrimaryColor: g_PrimaryColor, HoldTime: 2 });
if (!g_Message.SendUserMessage([1])) {
	console.warn("HUD message was not delivered to every intended recipient.");
}
```

## Safe use and common mistakes

- A value-backed `Color` owns its JavaScript channel array. An address-backed `Color` only views external native memory; keep that allocation alive for the whole view lifetime and release it exactly once after the last access.
- The `Color` constructor and channel setters require finite numbers, truncate fractions, and clamp values to `0..255`. `CreateRGBAColor` delegates to the stricter native operation: non-nullish components must be integers in that range; omitted or nullish components default to `255`.
- The native RGBA factory creates own `Red`, `Green`, `Blue`, and `Alpha` data properties without invoking inherited setters. Native C++ exceptions are translated into JavaScript errors at its callback boundary.
- `Color.CreateColorFromValue(ColorLike)` returns the input unchanged when it is already a `Color`. Use `CopyColor` when an independent mutable value is required.
- `CopyColorFrom` reads all four source channels before writing destination channels; `CopyColorTo` uses the same behavior. Overlapping native views therefore copy the original RGBA values rather than re-reading bytes already overwritten by the destination. A source-read failure prevents destination writes by the copy operation; a destination-write failure can still leave earlier writes committed. This is not an atomic snapshot against external native-memory changes.
- Shared palette values and `CreateFrozenColor` results reject mutation through channel setters. Freezing is shallow: do not mutate internal channel storage directly, and do not assume that freezing an address-backed view prevents external native memory changes. Use `CopyColor` or `CreateColorWithAlpha` before changing a palette-derived value.
- Channel indexes are `0` red, `1` green, `2` blue, and `3` alpha. `GetColorChannel` and `SetColorChannel` throw for any other index.
- HUD color options require integer `Red`, `Green`, `Blue`, and `Alpha` fields in `0..255`. A `Color` instance is accepted and retained by the message wrapper. The explicit channel records shown above snapshot those values instead of retaining a possibly address-backed view; keep a retained view's native storage valid until the message is built.
- `ConvertColorToHexString` returns Source text-message control bytes plus uppercase RGB or RGBA digits; it is not a CSS `#RRGGBB` string.

## Related files

- [`packages/sourcejs/colors.js`](../../packages/sourcejs/colors.js) implements `Color`, palette constants, address access, and the public wrappers.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) implements and installs native `colors.CreateRGBAColor`.
- [`tools/smoke_colors.js`](../../tools/smoke_colors.js) verifies normalization, address access, copying, freezing, iteration, and the native wrapper route.
- [`docs/api/memory.md`](memory.md) documents allocation ownership used by address-backed colors.
- [`docs/api/messages.md`](messages.md) documents `HUDMessage` and `SayText2` delivery used by the examples.
