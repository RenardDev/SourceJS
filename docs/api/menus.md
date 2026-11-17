# `require("menus")`

`menus` combines the native text-menu transport with the shared JavaScript menu object model. It sends Source SDK `DIALOG_TEXT` messages through `IServerPluginHelpers`; `BaseMenu`, `PagedMenu` and the other menu classes provide choices and state, while `menus/queue`, `menus/esc` and `menus/radio` handle their specialized workflows.

Both native transport functions require a positive index resolving to a non-free edict and a server-assigned user ID other than the SDK's invalid value (`-1`). They read `Index` once, capture that user ID, then resolve the index again immediately before `CreateMessage()`, after input conversion and KeyValues construction. A missing/free edict, disconnected recipient, or changed user ID aborts dispatch; a replacement edict with the same user ID is accepted. If an input getter or conversion raises a JavaScript error, the callback preserves it rather than replacing it with a generic native error. This does not pin the connection or guarantee client delivery. A client in the main menu has no server edict and cannot receive this UI. The selected SDK must expose `IVEngineServer`, `IServerPluginHelpers`, and KeyValues support; unavailable capabilities throw a native V8 error.

## Import

```js
const { HideText, ShowText } = require("menus");

if ((typeof HideText !== "function") || (typeof ShowText !== "function")) {
	throw new Error("menus did not expose both native text-dialog operations.");
}
```

## Native transport exports

| Export | Signature | Return value |
| --- | --- | --- |
| [`HideText`](#hidetext) | `HideText(PlayerOrIndex)` | `true` after dispatching the empty text dialog |
| [`ShowText`](#showtext) | `ShowText(PlayerOrIndex, strMenuTitle, strMenuMessage, nMenuDisplayTime = 10)` | `true` after dispatching the text dialog |

`PlayerOrIndex` must identify the intended connected client edict, as a positive signed-32-bit Number or an object whose `Index` property is such a Number. An `Index` getter error stops before native lookup/dispatch. `strMenuTitle` and `strMenuMessage` must be strings. `nMenuDisplayTime` must be a finite non-negative Number integer representable by native `int` and is passed to the engine as the dialog lifetime in seconds; omit the argument to use ten seconds. Explicit `undefined`, `null`, fractional values and BigInts are rejected.

These functions synchronously call the SDK during the invoking JavaScript call; they do not schedule a background request or completion callback. A `true` result reports dispatch, not confirmation that the client displayed or closed the dialog. Text is converted to UTF-8 and passed to KeyValues as null-terminated strings; embedded NUL characters terminate the stored text.

Both callbacks translate C++ exceptions into operation-specific JavaScript errors without replacing an already pending JavaScript error/termination. SourceJS owns the temporary KeyValues tree and attempts cleanup on normal completion, validation failure, and unwinding; no ownership is transferred to JavaScript. Cleanup exceptions are suppressed by the deleter so they cannot replace the pending error; resource cleanup is best effort. Cleanup does not undo getter side effects or an already dispatched engine message. The native keys `title`, `msg`, `level`, and `time` retain the SDK's exact wire spelling.

The same module also exports the shared menu classes; see [`menus-objects.md`](menus-objects.md) for their constructors and methods.

## `HideText()`

`HideText()` sends an empty level-one text dialog with zero lifetime to request closure of text UI created through this module. It does not mutate `menus/queue` state or confirm that the client closed the dialog.

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { HideText } = require("menus");

let g_bCommandRegistered = false;

function CloseServerText(Command) {
	if (HideText(Command.Index) !== true) {
		throw new Error(`HideText failed PlayerIndex=${Command.Index}.`);
	}

	return CommandReturn.Handled;
}

exports.Unload = () => {
	if (g_bCommandRegistered) {
		if (UnregisterCommand("sjs_close_text", CloseServerText) !== true) {
			throw new Error("UnregisterCommand failed Command=sjs_close_text.");
		}

		g_bCommandRegistered = false;
	}

	return true;
};

if (RegisterCommand("sjs_close_text", CloseServerText) !== true) {
	throw new Error("RegisterCommand failed Command=sjs_close_text.");
}

g_bCommandRegistered = true;
```

## `ShowText()`

`ShowText()` sends one level-one text dialog to one client. SourceJS retains ownership of the temporary KeyValues tree and attempts to delete it before returning; JavaScript receives neither that tree nor ownership of the dialog.

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { ShowText } = require("menus");

let g_bCommandRegistered = false;

function ShowServerRules(Command) {
	const unRulesDisplayTime = 12;
	if (ShowText(Command.Index, "Server rules", "Stay with the team. Do not block saferoom doors.", unRulesDisplayTime) !== true) {
		throw new Error(`ShowText failed PlayerIndex=${Command.Index}.`);
	}

	return CommandReturn.Handled;
}

exports.Unload = () => {
	if (g_bCommandRegistered) {
		if (UnregisterCommand("sjs_rules", ShowServerRules) !== true) {
			throw new Error("UnregisterCommand failed Command=sjs_rules.");
		}

		g_bCommandRegistered = false;
	}

	return true;
};

if (RegisterCommand("sjs_rules", ShowServerRules) !== true) {
	throw new Error("RegisterCommand failed Command=sjs_rules.");
}

g_bCommandRegistered = true;
```

## Lifecycle

- Use `menus/queue` when multiple menus must be serialized per player.
- Use `menus/radio` for numbered Source radio menus and `menuselect` handling.
- Use `menus/esc` for Escape-key text menus.
- Unregister every command or listener that can call these functions when the plugin unloads.
- The examples release only their own command registration. Failed unregistration keeps ownership for an explicit retry; successful or never-acquired registration makes repeated unload harmless. Native transport failures do not unregister the command or clear menu-queue ownership.
- Unregistering a command does not close text UI that it already sent. Call `HideText()` explicitly if closure is required, while the intended client is still connected. A recycled player index can identify someone else on a later call; the native identity check protects each individual invocation, not the interval between `ShowText()` and `HideText()`.
