# `require("menus/esc")`

> Warning: this reference is large for AI-agent processing and covers both queued and direct ESC-dialog ownership. Use the contents list to open the lifecycle that matches the current plugin.

`menus/esc` builds interactive Source 1 Escape-key dialogs. It sends `DIALOG_MENU` through the selected SDK's `IServerPluginHelpers`, stores each button as nested KeyValues data, and uses the shared `menuselect` queue from [`menus`](menus-objects.md).

An ESC dialog can only target a connected client on a running server. There is no client recipient in the game main menu. Queue-backed menus should be closed when their plugin unloads; direct `SendMenuToPlayer()` calls must be paired with `CloseMenuForPlayer()` because they do not create queue ownership.

The queued examples attempt to release partial setup on failure and export an idempotent `Unload` callback. `CloseMenu()` returning `false` means no queue entry was removed, not that cleanup failed; residual direct player state is checked separately. Cleanup errors are reported together with, rather than instead of, the original failure. These checks cover JavaScript queue and player-map state, not confirmation that the visible client dialog has closed.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Constants](#constants)
- [Menu classes](#menu-classes)
- [Option classes](#option-classes)
- [Direct transport](#direct-transport)
- [Selection](#selection)
- [`SendESCMenu`](#sendescmenu)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	BUTTON_BACK,
	BUTTON_CLOSE,
	BUTTON_NEXT,
	MAX_ITEM_COUNT,
	VALID_CHOICES,
	ListESCMenu,
	ListESCOption,
	PagedESCMenu,
	PagedESCOption,
	SimpleESCMenu,
	SimpleESCOption,
	SendESCMenu,
} = require("menus/esc");

const g_vecConstructors = [ListESCMenu, ListESCOption, PagedESCMenu, PagedESCOption, SimpleESCMenu, SimpleESCOption];
if (g_vecConstructors.some((Constructor) => typeof Constructor !== "function") || (typeof SendESCMenu !== "function")) {
	throw new Error("The menus/esc module did not expose every documented callable.");
}

if ((BUTTON_BACK !== 6) || (BUTTON_CLOSE !== 0) || (BUTTON_NEXT !== 7) || (MAX_ITEM_COUNT !== 5)) {
	throw new Error("The menus/esc module exported an unexpected button layout.");
}

if (!Object.isFrozen(VALID_CHOICES) || (VALID_CHOICES.join(",") !== "0,1,2,3,4,5,6,7")) {
	throw new Error("The menus/esc module exported an unexpected choice inventory.");
}
```

## Exports

| Export | Kind | Constructor or signature |
| --- | --- | --- |
| `BUTTON_BACK` | constant | `6` |
| `BUTTON_CLOSE` | constant | `0` |
| `BUTTON_NEXT` | constant | `7` |
| `MAX_ITEM_COUNT` | constant | `5` |
| `VALID_CHOICES` | frozen array | `[0, 1, 2, 3, 4, 5, 6, 7]` |
| [`ListESCMenu`](#listescmenu) | class | `new ListESCMenu(Options = {})` |
| [`ListESCOption`](#listescoption) | class | `new ListESCOption(TextValue = "", OptionOptions = {})` |
| [`PagedESCMenu`](#pagedescmenu) | class | `new PagedESCMenu(Options = {})` |
| [`PagedESCOption`](#pagedescoption) | class | `new PagedESCOption(TextValue = "", OptionValue = null, OptionOptions = {})` |
| [`SimpleESCMenu`](#simpleescmenu) | class | `new SimpleESCMenu(Options = {})` |
| [`SimpleESCOption`](#simpleescoption) | class | `new SimpleESCOption(unChoiceIndex, TextValue, OptionValue = null, OptionOptions = {})` |
| [`SendESCMenu`](#sendescmenu) | function | `SendESCMenu(TargetReferences, strMenuTitle, strMenuMessage, unDisplayTime = 10)` |

## Constants

Choices `1` through `5` are ordinary paged slots. Paged menus reserve `6` for Back, `7` for Next, and `0` for Close. A `SimpleESCOption` may use any choice from `1` through `7`; choice `0` remains reserved for Close.

```js
const {
	BUTTON_BACK,
	BUTTON_CLOSE,
	BUTTON_NEXT,
	MAX_ITEM_COUNT,
	VALID_CHOICES,
} = require("menus/esc");

function IsESCChoice(unChoice) {
	return Number.isSafeInteger(unChoice) && VALID_CHOICES.includes(unChoice);
}

if ((BUTTON_BACK !== 6) || (BUTTON_CLOSE !== 0) || (BUTTON_NEXT !== 7) || (MAX_ITEM_COUNT !== 5)) {
	throw new Error("ESC button constants do not match the Source dialog slots.");
}

if (!IsESCChoice(4) || IsESCChoice(8) || !Object.isFrozen(VALID_CHOICES)) {
	throw new Error("VALID_CHOICES did not enforce the documented ESC selection range.");
}
```

## Menu classes

### `SimpleESCMenu`

`SimpleESCMenu` extends `BaseMenu`. It accepts every base option plus `TitleColor`; the optional value is exposed as `ValueTitleColor` and forwarded by reference into the dialog's `Color` field rather than cloned in JavaScript. This exact field spelling is required by the native `messages.CreateDialog()` color converter. Its own methods preserve the base signatures:

| Method | Behavior |
| --- | --- |
| `CloseMenuForPlayer(PlayerReference)` | clears JavaScript player state, invokes `CloseCallback`, then attempts an empty dialog replacement if this menu was displayed. A throwing callback prevents that replacement attempt. It returns `undefined`, not a client-delivery confirmation. |
| `RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {})` | prefixes `SimpleMenuOption` rows with their explicit choice |
| `SelectMenuOption(PlayerReference, unChoiceIndex, unPageIndex = 0)` | closes queue ownership for choice `0`; otherwise selects an option |
| [`SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {})`](#simpleescmenusendmenutoplayer) | sends one raw `DIALOG_MENU` without creating queue ownership |
| `ShouldCloseMenuAfterSelection(unChoiceIndex, unPageIndex = 0)` | prevents the queue from closing choice `0` a second time |

```js
const { SimpleESCMenu, SimpleESCOption } = require("menus/esc");

const g_SimpleESCMenuInstance = new SimpleESCMenu({
	Description: "Choose an action for {PlayerName}",
	Title: "Action controls",
	TitleColor: { Alpha: 255, Blue: 80, Green: 220, Red: 80 },
});
g_SimpleESCMenuInstance.AppendMenuItem(new SimpleESCOption(1, "Apply", "apply"));
g_SimpleESCMenuInstance.AppendMenuItem(new SimpleESCOption(2, "Continue", "continue"));

const g_PlayerTokenRecord = { PlayerName: "Ren" };

function CloseExampleMenu() {
	const vecErrors = [];
	try {
		const bMenuRemoved = g_SimpleESCMenuInstance.CloseMenu(1);
		if (typeof bMenuRemoved !== "boolean") {
			throw new Error("CloseMenu() returned an undocumented value.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (g_SimpleESCMenuInstance.PlayerMenuPages.has(1) || g_SimpleESCMenuInstance.PlayerTokenRecords.has(1)) {
			const CloseResult = g_SimpleESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_SimpleESCMenuInstance.IsActiveMenu(1) || g_SimpleESCMenuInstance.PlayerMenuPages.has(1) || g_SimpleESCMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("ESC menu cleanup left player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "ESC menu cleanup failed.");
	}

	return true;
}

exports.Unload = CloseExampleMenu;

try {
	if (!g_SimpleESCMenuInstance.SendMenu(1, 0, g_PlayerTokenRecord) || !g_SimpleESCMenuInstance.IsActiveMenu(1)) {
		throw new Error("SimpleESCMenu could not activate its ESC dialog.");
	}

	if ((g_SimpleESCMenuInstance.PlayerTokenRecords.get(1) !== g_PlayerTokenRecord) || (g_SimpleESCMenuInstance.ValueTitleColor.Green !== 220)) {
		throw new Error("SimpleESCMenu did not retain its tokens or title color.");
	}
} catch (CaughtError) {
	try {
		CloseExampleMenu();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "ESC menu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

### `PagedESCMenu`

`PagedESCMenu` extends `PagedMenu`. It fixes navigation choices to the constants above, accepts `ItemsPerPage` from `1` through `5`, defaults `Fill` to `true`, and accepts optional `TitleColor`, exposed as `ValueTitleColor`. `RenderMenuItem()`, `SendMenuToPlayer()`, and `CloseMenuForPlayer()` use ESC button and dialog semantics; page selection and navigation remain the inherited `PagedMenu` API.

```js
const { MAX_ITEM_COUNT, PagedESCMenu, PagedESCOption } = require("menus/esc");

const g_PagedESCMenuInstance = new PagedESCMenu({
	Description: "Select a destination",
	ItemsPerPage: MAX_ITEM_COUNT,
	Title: "Destination vote",
});
for (const strDestinationName of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]) {
	g_PagedESCMenuInstance.AppendMenuItem(new PagedESCOption(strDestinationName, strDestinationName.toLowerCase()));
}

function CloseExampleMenu() {
	const vecErrors = [];
	try {
		const bMenuRemoved = g_PagedESCMenuInstance.CloseMenu(1);
		if (typeof bMenuRemoved !== "boolean") {
			throw new Error("CloseMenu() returned an undocumented value.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (g_PagedESCMenuInstance.PlayerMenuPages.has(1) || g_PagedESCMenuInstance.PlayerTokenRecords.has(1)) {
			const CloseResult = g_PagedESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_PagedESCMenuInstance.IsActiveMenu(1) || g_PagedESCMenuInstance.PlayerMenuPages.has(1) || g_PagedESCMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("ESC menu cleanup left player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "ESC menu cleanup failed.");
	}

	return true;
}

exports.Unload = CloseExampleMenu;

try {
	if ((g_PagedESCMenuInstance.GetMenuPageCount() !== 2) || !g_PagedESCMenuInstance.SendMenu(1) || !g_PagedESCMenuInstance.IsActiveMenu(1)) {
		throw new Error("PagedESCMenu could not activate its two-page dialog.");
	}
} catch (CaughtError) {
	try {
		CloseExampleMenu();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "ESC menu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

When `Fill` is enabled, unused item slots are emitted as empty KeyValues buttons without commands. Back, Next, and Close remain visible on every page; an unavailable Back or Next choice is ignored by `PagedMenu.SelectMenuOption()`.

### `ListESCMenu`

`ListESCMenu` extends `PagedESCMenu` for read-only rows. Its default page size is `5`, but `ItemsPerPage` may be reduced. Use `ListESCOption`, which initializes `Value` to `null` and `Selectable` to `false`. These fields remain writable; retain those values when the rows must remain non-selectable.

```js
const { ListESCMenu, ListESCOption } = require("menus/esc");

const g_ListESCMenuInstance = new ListESCMenu({ Description: "Current session", ItemsPerPage: 3, Title: "Status" });
const g_FirstListESCOption = g_ListESCMenuInstance.AppendMenuItem(new ListESCOption("Mode: cooperative"));
const g_SecondListESCOption = g_ListESCMenuInstance.AppendMenuItem(new ListESCOption("Players: 4", { Enumerated: false }));
if (g_FirstListESCOption.Selectable || (g_FirstListESCOption.Value !== null) || g_SecondListESCOption.Enumerated) {
	throw new Error("ListESCOption did not retain its read-only row contract.");
}

function CloseExampleMenu() {
	const vecErrors = [];
	try {
		const bMenuRemoved = g_ListESCMenuInstance.CloseMenu(1);
		if (typeof bMenuRemoved !== "boolean") {
			throw new Error("CloseMenu() returned an undocumented value.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (g_ListESCMenuInstance.PlayerMenuPages.has(1) || g_ListESCMenuInstance.PlayerTokenRecords.has(1)) {
			const CloseResult = g_ListESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_ListESCMenuInstance.IsActiveMenu(1) || g_ListESCMenuInstance.PlayerMenuPages.has(1) || g_ListESCMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("ESC menu cleanup left player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "ESC menu cleanup failed.");
	}

	return true;
}

exports.Unload = CloseExampleMenu;

try {
	if (!g_ListESCMenuInstance.SendMenu(1) || !g_ListESCMenuInstance.IsActiveMenu(1)) {
		throw new Error("ListESCMenu could not activate its read-only dialog.");
	}
} catch (CaughtError) {
	try {
		CloseExampleMenu();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "ESC menu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

## Option classes

### `SimpleESCOption`

`SimpleESCOption` extends `SimpleMenuOption`. `ChoiceIndex` must be from `1` through `7`; `Text`, `Value`, `Selectable`, and `Highlighted` follow the base option contract. Source ESC dialogs do not provide a separate highlight visual, but the property remains available to menu code.

```js
const { SimpleESCMenu, SimpleESCOption } = require("menus/esc");

const g_SimpleESCMenuInstance = new SimpleESCMenu({ Title: "Difficulty" });
const g_SimpleESCOptionInstance = new SimpleESCOption(3, "Expert", "impossible", { Selectable: true });
g_SimpleESCMenuInstance.AppendMenuItem(g_SimpleESCOptionInstance);

const g_bMatchingChoiceIndex = g_SimpleESCOptionInstance.ChoiceIndex === 3;
const g_bMatchingOptionValue = g_SimpleESCOptionInstance.Value === "impossible";
if (!g_bMatchingChoiceIndex || !g_bMatchingOptionValue || !g_SimpleESCOptionInstance.Selectable) {
	throw new Error("SimpleESCOption did not retain its choice, value, or selectable state.");
}

function CloseExampleMenu() {
	const vecErrors = [];
	try {
		const bMenuRemoved = g_SimpleESCMenuInstance.CloseMenu(1);
		if (typeof bMenuRemoved !== "boolean") {
			throw new Error("CloseMenu() returned an undocumented value.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (g_SimpleESCMenuInstance.PlayerMenuPages.has(1) || g_SimpleESCMenuInstance.PlayerTokenRecords.has(1)) {
			const CloseResult = g_SimpleESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_SimpleESCMenuInstance.IsActiveMenu(1) || g_SimpleESCMenuInstance.PlayerMenuPages.has(1) || g_SimpleESCMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("ESC menu cleanup left player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "ESC menu cleanup failed.");
	}

	return true;
}

exports.Unload = CloseExampleMenu;

try {
	if (!g_SimpleESCMenuInstance.SendMenu(1) || !g_SimpleESCMenuInstance.IsActiveMenu(1)) {
		throw new Error("SimpleESCOption could not be sent through SimpleESCMenu.");
	}
} catch (CaughtError) {
	try {
		CloseExampleMenu();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "ESC menu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

### `PagedESCOption`

`PagedESCOption` extends `PagedMenuOption`. Its `ChoiceIndex` is assigned from the option's position on the current page whenever the menu is built.

```js
const { PagedESCMenu, PagedESCOption } = require("menus/esc");

const g_PagedESCMenuInstance = new PagedESCMenu({ ItemsPerPage: 2, Title: "Destinations" });
g_PagedESCMenuInstance.AppendMenuItem(new PagedESCOption("Alpha", "alpha"));
g_PagedESCMenuInstance.AppendMenuItem(new PagedESCOption("Bravo", "bravo"));
const g_ThirdPagedESCOption = g_PagedESCMenuInstance.AppendMenuItem(new PagedESCOption("Charlie", "charlie"));

function CloseExampleMenu() {
	const vecErrors = [];
	try {
		const bMenuRemoved = g_PagedESCMenuInstance.CloseMenu(1);
		if (typeof bMenuRemoved !== "boolean") {
			throw new Error("CloseMenu() returned an undocumented value.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (g_PagedESCMenuInstance.PlayerMenuPages.has(1) || g_PagedESCMenuInstance.PlayerTokenRecords.has(1)) {
			const CloseResult = g_PagedESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_PagedESCMenuInstance.IsActiveMenu(1) || g_PagedESCMenuInstance.PlayerMenuPages.has(1) || g_PagedESCMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("ESC menu cleanup left player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "ESC menu cleanup failed.");
	}

	return true;
}

exports.Unload = CloseExampleMenu;

try {
	const bMenuSent = g_PagedESCMenuInstance.SendMenu(1, 1);
	const bMatchingPlayerMenuPage = g_PagedESCMenuInstance.GetPlayerMenuPage(1) === 1;
	const bMatchingChoiceIndex = g_ThirdPagedESCOption.ChoiceIndex === 1;
	if (!bMenuSent || !bMatchingPlayerMenuPage || !bMatchingChoiceIndex) {
		throw new Error("PagedESCOption did not receive its page-local choice.");
	}
} catch (CaughtError) {
	try {
		CloseExampleMenu();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "ESC menu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

### `ListESCOption`

`ListESCOption` accepts the boolean `Enumerated` and `Highlighted` options. `Enumerated: false` removes the visible numeric prefix while retaining the slot needed by the Source dialog layout.

```js
const { ListESCMenu, ListESCOption } = require("menus/esc");

const g_ListESCMenuInstance = new ListESCMenu({ Title: "Session status" });
const g_PlayersListESCOption = g_ListESCMenuInstance.AppendMenuItem(new ListESCOption("Players: 8", { Enumerated: false }));
const g_ModeListESCOption = g_ListESCMenuInstance.AppendMenuItem(new ListESCOption("Mode: expert", { Enumerated: false }));

const g_bInvalidPlayersOptionState = g_PlayersListESCOption.Enumerated || g_PlayersListESCOption.Selectable;
const g_bInvalidModeOptionState = g_ModeListESCOption.Enumerated || g_ModeListESCOption.Selectable;
if (g_bInvalidPlayersOptionState || g_bInvalidModeOptionState) {
	throw new Error("ListESCOption did not remain non-enumerated and non-selectable.");
}

function CloseExampleMenu() {
	const vecErrors = [];
	try {
		const bMenuRemoved = g_ListESCMenuInstance.CloseMenu(1);
		if (typeof bMenuRemoved !== "boolean") {
			throw new Error("CloseMenu() returned an undocumented value.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (g_ListESCMenuInstance.PlayerMenuPages.has(1) || g_ListESCMenuInstance.PlayerTokenRecords.has(1)) {
			const CloseResult = g_ListESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_ListESCMenuInstance.IsActiveMenu(1) || g_ListESCMenuInstance.PlayerMenuPages.has(1) || g_ListESCMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("ESC menu cleanup left player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "ESC menu cleanup failed.");
	}

	return true;
}

exports.Unload = CloseExampleMenu;

try {
	if (!g_ListESCMenuInstance.SendMenu(1)) {
		throw new Error("ListESCOption rows could not be sent through ListESCMenu.");
	}
} catch (CaughtError) {
	try {
		CloseExampleMenu();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "ESC menu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

## Direct transport

### `SimpleESCMenu.SendMenuToPlayer`

Use the raw transport when another owner manages the dialog lifetime. `CloseMenu()` only works on queue entries, so a direct send must call `CloseMenuForPlayer()`.

```js
const { SimpleESCMenu, SimpleESCOption } = require("menus/esc");

const g_SimpleESCMenuInstance = new SimpleESCMenu({ QueueEnabled: false, Title: "Private notice" });
const g_PlayerTokenRecord = { Source: "plugin" };
const g_vecErrors = [];
let g_bDirectSendAttempted = false;

g_SimpleESCMenuInstance.AppendMenuItem(new SimpleESCOption(1, "Acknowledge", true));

try {
	g_bDirectSendAttempted = true;
	if (!g_SimpleESCMenuInstance.SendMenuToPlayer(1, 0, g_PlayerTokenRecord)) {
		throw new Error("SimpleESCMenu.SendMenuToPlayer() could not create the ESC dialog.");
	}

	const bMatchingPlayerMenuPage = g_SimpleESCMenuInstance.PlayerMenuPages.get(1) === 0;
	const bMatchingPlayerTokenRecord = g_SimpleESCMenuInstance.PlayerTokenRecords.get(1) === g_PlayerTokenRecord;
	if (!bMatchingPlayerMenuPage || !bMatchingPlayerTokenRecord) {
		throw new Error("SimpleESCMenu.SendMenuToPlayer() did not retain direct player state.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bDirectSendAttempted) {
		try {
			const CloseResult = g_SimpleESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("SimpleESCMenu.CloseMenuForPlayer() returned an undocumented value.");
			}

			const bPlayerMenuPageRetained = g_SimpleESCMenuInstance.PlayerMenuPages.has(1);
			const bPlayerTokenRecordRetained = g_SimpleESCMenuInstance.PlayerTokenRecords.has(1);
			if (bPlayerMenuPageRetained || bPlayerTokenRecordRetained) {
				throw new Error("SimpleESCMenu.CloseMenuForPlayer() left direct player state behind.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "ESC dialog operation and cleanup failed.");
}
```

### `PagedESCMenu.SendMenuToPlayer`

The paged raw transport clamps the requested page, assigns page-local choices, and stores the exact player token record for later rendering.

```js
const { PagedESCMenu, PagedESCOption } = require("menus/esc");

const g_PlayerTokenRecord = { Mode: "current" };
const g_PagedESCMenuInstance = new PagedESCMenu({ QueueEnabled: false, Description: "Mode: {Mode}", ItemsPerPage: 1, Title: "Destinations" });
const g_vecErrors = [];
let g_bDirectSendAttempted = false;

g_PagedESCMenuInstance.AppendMenuItem(new PagedESCOption("Alpha"));
g_PagedESCMenuInstance.AppendMenuItem(new PagedESCOption("Bravo"));

try {
	g_bDirectSendAttempted = true;
	if (!g_PagedESCMenuInstance.SendMenuToPlayer(1, 99, g_PlayerTokenRecord)) {
		throw new Error("PagedESCMenu.SendMenuToPlayer() could not create the ESC dialog.");
	}

	const bMatchingPlayerMenuPage = g_PagedESCMenuInstance.GetPlayerMenuPage(1) === 1;
	const bMatchingPlayerTokenRecord = g_PagedESCMenuInstance.GetPlayerTokenRecord(1) === g_PlayerTokenRecord;
	if (!bMatchingPlayerMenuPage || !bMatchingPlayerTokenRecord) {
		throw new Error("PagedESCMenu.SendMenuToPlayer() did not clamp the page or retain its player token record.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bDirectSendAttempted) {
		try {
			const CloseResult = g_PagedESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("PagedESCMenu.CloseMenuForPlayer() returned an undocumented value.");
			}

			const bPlayerMenuPageRetained = g_PagedESCMenuInstance.PlayerMenuPages.has(1);
			const bPlayerTokenRecordRetained = g_PagedESCMenuInstance.PlayerTokenRecords.has(1);
			if (bPlayerMenuPageRetained || bPlayerTokenRecordRetained) {
				throw new Error("PagedESCMenu.CloseMenuForPlayer() left direct player state behind.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "ESC dialog operation and cleanup failed.");
}
```

## Selection

The shared queue registers `menuselect` lazily when `SendMenu()` activates a menu. Ordinary selectable options invoke `SelectCallback`; `CloseOnSelection` then decides whether the queue removes the menu. Paged navigation choices keep the menu active and resend the requested page.

```js
const { BUTTON_NEXT, PagedESCMenu, PagedESCOption } = require("menus/esc");

let g_strSelectedOption = null;

const g_PagedESCMenuInstance = new PagedESCMenu({
	ItemsPerPage: 1,
	SelectCallback(unPlayerIndex, ValueOption) {
		if (unPlayerIndex !== 1) {
			throw new Error("PagedESCMenu.SelectMenuOption() received an unexpected player index.");
		}

		g_strSelectedOption = ValueOption;
	},
	Title: "Navigation",
});
g_PagedESCMenuInstance.AppendMenuItem(new PagedESCOption("Page one", "first"));
g_PagedESCMenuInstance.AppendMenuItem(new PagedESCOption("Page two", "second"));

function CloseExampleMenu() {
	const vecErrors = [];
	try {
		const bMenuRemoved = g_PagedESCMenuInstance.CloseMenu(1);
		if (typeof bMenuRemoved !== "boolean") {
			throw new Error("CloseMenu() returned an undocumented value.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (g_PagedESCMenuInstance.PlayerMenuPages.has(1) || g_PagedESCMenuInstance.PlayerTokenRecords.has(1)) {
			const CloseResult = g_PagedESCMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_PagedESCMenuInstance.IsActiveMenu(1) || g_PagedESCMenuInstance.PlayerMenuPages.has(1) || g_PagedESCMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("ESC menu cleanup left player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "ESC menu cleanup failed.");
	}

	return true;
}

exports.Unload = CloseExampleMenu;

const g_vecErrors = [];
try {
	if (!g_PagedESCMenuInstance.SendMenu(1)) {
		throw new Error("PagedESCMenu could not activate the navigation example.");
	}

	if (!g_PagedESCMenuInstance.SelectMenuOption(1, BUTTON_NEXT, 0) || (g_PagedESCMenuInstance.GetPlayerMenuPage(1) !== 1)) {
		throw new Error("PagedESCMenu.SelectMenuOption() did not advance to the second page.");
	}

	if (!g_PagedESCMenuInstance.SelectMenuOption(1, 1, 1) || (g_strSelectedOption !== "second")) {
		throw new Error("PagedESCMenu.SelectMenuOption() did not dispatch the page-local value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		CloseExampleMenu();
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "ESC dialog operation and cleanup failed.");
}
```

Calling `SelectMenuOption()` directly is useful for tests and custom transports, but it does not apply the queue's post-selection close step. Normal plugins should let the registered `menuselect` handler dispatch player input.

## `SendESCMenu`

`SendESCMenu()` creates a one-shot `SimpleESCMenu` with `QueueEnabled: false`, puts `strMenuMessage` in the dialog body, and returns the aggregate native send result. It is intended for informational dialogs that do not need a retained callback.

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { SendESCMenu } = require("menus/esc");

function ShowHelpCallback(Command) {
	if (!SendESCMenu(Command.Index, "Session help", "Use the configured ready command when prepared.", 12)) {
		throw new Error("SendESCMenu() could not create the help dialog.");
	}

	return CommandReturn.Handled;
}

let g_bHelpCommandRegistered = false;

function ReleaseHelpCommand() {
	if (!g_bHelpCommandRegistered) {
		return true;
	}

	if (UnregisterCommand("sjs_help", ShowHelpCallback) !== true) {
		throw new Error("UnregisterCommand() could not unregister sjs_help.");
	}

	g_bHelpCommandRegistered = false;

	return true;
}

exports.Unload = ReleaseHelpCommand;

const g_bHelpCommandRegistrationSucceeded = RegisterCommand("sjs_help", ShowHelpCallback);
if (g_bHelpCommandRegistrationSucceeded !== true) {
	throw new Error("RegisterCommand() could not register the help callback.");
}

g_bHelpCommandRegistered = true;
```

`SendESCMenu()` does not expose the temporary menu object or create queued ownership. If the client displays the dialog, its timeout, replacement, and dismissal are handled by the native client; the helper supplies no delivery or closure acknowledgement. Retain an explicit menu object when programmatic closure is needed.

## Errors

- `TypeError` is thrown when menu options or player-token values are null, non-objects, or arrays; when `Items` is not an array; or when `ListESCOption` receives a non-boolean `Enumerated` or `Highlighted` value.
- JavaScript guards throw `RangeError` for invalid choice or page-size ranges, negative or non-safe-integer pages and timeouts, player indexes that fail the positive-safe-integer check, and empty target arrays. Native recipient and SDK-availability checks run later and can raise other errors even when the numeric index passes those guards.
- If the underlying `CreateDialog()` function returns the boolean `false`, the JavaScript wrappers propagate `false` through `SendMenu()`, `SendMenuToPlayer()`, and `SendESCMenu()`. The current native binding returns `true` after its void SDK dispatch, not a client-delivery confirmation. Native exceptions propagate; handle them separately from a transport-provided `false`.
- Text-renderer and callback exceptions propagate to the method that triggered rendering, selection, or closure.

```js
const { ListESCOption, PagedESCMenu, SendESCMenu, SimpleESCMenu, SimpleESCOption } = require("menus/esc");

const g_vecInvalidCallRecords = [
	{ Call: () => new ListESCOption("Status", { Enumerated: "no" }), ErrorType: TypeError },
	{ Call: () => new SimpleESCMenu({ Items: "not-an-array" }), ErrorType: TypeError },
	{ Call: () => new PagedESCMenu({ ItemsPerPage: 0 }), ErrorType: RangeError },
	{ Call: () => new PagedESCMenu({ ItemsPerPage: 6 }), ErrorType: RangeError },
	{ Call: () => new SimpleESCOption(0, "Reserved"), ErrorType: RangeError },
	{ Call: () => new SimpleESCOption(8, "Outside range"), ErrorType: RangeError },
	{ Call: () => SendESCMenu([], "Title", "Message"), ErrorType: RangeError },
];
for (const { Call, ErrorType } of g_vecInvalidCallRecords) {
	let bThrown = false;
	let CaughtValue;

	try {
		Call();
	} catch (CaughtError) {
		bThrown = true;
		CaughtValue = CaughtError;
	}

	if (!bThrown) {
		throw new Error("The menus/esc operation did not throw " + ErrorType.name + ".");
	}

	if (!(CaughtValue instanceof ErrorType)) {
		throw CaughtValue;
	}
}
```

## Lifecycle

- `SendMenu()` with the default `QueueEnabled: true` creates queue ownership. Use `CloseMenu(TargetReferences)` during unload to remove queued ownership and attempt player-state cleanup. Empty dialog replacement follows the `CloseMenuForPlayer()` callback-ordering limitations above; successful JavaScript cleanup is not client-side closure confirmation.
- `SendMenuToPlayer()` and `SendMenu()` with `QueueEnabled: false` retain state only on the menu object. Call `CloseMenuForPlayer(PlayerReference)` for every displayed client; `CloseMenu()` cannot find direct sends.
- Dialog levels are assigned per player by this module instance and wrap after its internal maximum. They request native display ordering; the JavaScript counter does not confirm which dialog the client currently shows.
- An unmodified `ListESCOption` starts non-selectable even though Source represents it as a nested button record, so selection does not invoke `SelectCallback`. Its public fields remain writable; changing `Selectable` can change that behavior.
- `SendESCMenu()` does not return a retained menu owner. Use it only when timeout-based lifetime is sufficient.
- ESC menus require a connected server-side player and cannot display in the game main menu.

## Related modules

- [`menus`](menus-objects.md) provides menu items, callbacks, pages, and player token records.
- [`menus/queue`](menus-queue.md) owns queued `menuselect` dispatch.
- [`messages/dialog`](messages-dialog.md) exposes the lower-level Source dialog transport.
