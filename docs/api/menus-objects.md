# `require("menus")`

> Warning: this reference is large for AI-agent processing and intentionally comprehensive. Use the contents list to open only the section needed for the current menu workflow.

`menus` provides the JavaScript object model shared by text, radio, and Escape-key menus. It owns menu items, player-token rendering, callbacks, per-player page state, and integration with `menus/queue`; the actual text transport remains the native `menus.ShowText()` function.

Methods taking `PlayerReference` accept a positive safe integer or an object whose `Index` field contains such an integer. The index must identify a connected client when a workflow reaches the native transport; the `0` default of `MenuText.GetMenuText()` is a rendering sentinel, not a client target. Menu objects and queue entries are plugin-context state. Close both active and pending queued menus and unregister surrounding commands or listeners before the plugin unloads. `CloseMenu()` only removes queue entries. For direct base-menu sends, call `CloseMenuForPlayer()` to clear JavaScript player state and separately call `HideText()` to hide the text; the base close method does not perform that native hide.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Data objects](#data-objects)
- [`BaseMenu`](#basemenu)
- [`PagedMenu`](#pagedmenu)
- [Examples](#examples)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	BaseMenu,
	MenuRenderData,
	MenuText,
	PagedMenu,
	PagedMenuOption,
	SimpleMenu,
	SimpleMenuOption,
} = require("menus");

const g_vecConstructors = [BaseMenu, MenuRenderData, MenuText, PagedMenu, PagedMenuOption, SimpleMenu, SimpleMenuOption];
if (g_vecConstructors.some((Constructor) => typeof Constructor !== "function")) {
	throw new Error("The menus module did not expose every documented constructor.");
}

if (!(new PagedMenu() instanceof BaseMenu) || !(new PagedMenuOption() instanceof SimpleMenuOption)) {
	throw new Error("The menus module class inheritance is incomplete.");
}
```

## Exports

| Export | Inheritance | Constructor |
| --- | --- | --- |
| [`BaseMenu`](#basemenu-1) | iterable base class | `new BaseMenu(Options = {})` |
| [`MenuRenderData`](#menurenderdata) | standalone rendered record | `new MenuRenderData(strMenuTitle, strMenuMessage, unPageIndex = 0, unPageCount = 1)` |
| [`MenuText`](#menutext) | standalone item | `new MenuText(TextValue = "")` |
| [`PagedMenu`](#pagedmenu-1) | `BaseMenu` | `new PagedMenu(Options = {})` |
| [`PagedMenuOption`](#pagedmenuoption) | `SimpleMenuOption` | `new PagedMenuOption(TextValue = "", OptionValue = null, OptionOptions = {})` |
| [`SimpleMenu`](#simplemenu) | `BaseMenu` | `new SimpleMenu(Options = {})` |
| [`SimpleMenuOption`](#simplemenuoption) | `MenuText` | `new SimpleMenuOption(unChoiceIndex, TextValue, OptionValue = null, OptionOptions = {})` |

## Data objects

| Class | Public fields | Methods |
| --- | --- | --- |
| [`MenuText`](#menutext) | `Text`, `Selectable` (initially `false`; both fields are writable) | `GetMenuText(unPlayerIndex = 0, TokenRecord = {})` |
| [`SimpleMenuOption`](#simplemenuoption) | inherited `Text`; `ChoiceIndex`, `Value`, `Selectable`, `Highlighted` | inherited `GetMenuText()` |
| [`PagedMenuOption`](#pagedmenuoption) | the `SimpleMenuOption` fields; `ChoiceIndex` is assigned while a page is built | inherited `GetMenuText()` |
| [`MenuRenderData`](#menurenderdata) | `MenuTitle`, `MenuMessage`, `PageIndex`, `PageCount` | none |

`MenuText.Text` stores the renderable value. `null` and `undefined` render as an empty string. Other plain values are stringified and token-formatted: placeholders such as `{Map}` are replaced only when the player token record owns that key; unknown placeholders remain intact.

Functions are called as `(unPlayerIndex, TokenRecord)`. For objects, `GetMenuText(unPlayerIndex, TokenRecord)` takes precedence over `GetTranslatedString(null, TokenRecord)`; the latter receives `null`, not a language inferred from the player. Any default-language choice belongs to that provider. Function and method results are stringified without a second token-formatting pass; the renderer is responsible for using the supplied tokens.

## `BaseMenu`

The constructor accepts the listed option keys. `Title` and `Description` initialize the public `ValueTitle` and `ValueDescription` fields; other options use the same name as their public field. `PlayerMenuPages` and `PlayerTokenRecords` are initialized maps, and `Length` is a read-only derived property.

| Public field | Constructor option / default | Meaning |
| --- | --- | --- |
| `ValueTitle` | `Title` (`""`) | renderable title value |
| `ValueDescription` | `Description` (`""`) | renderable text placed before the items |
| `Timeout` | `Timeout` (`10`) | non-negative integer passed to native `ShowText()` |
| `QueueEnabled` | `QueueEnabled` (`true`) | route `SendMenu()` through each player's `MenuQueue` |
| `CloseOnSelection` | `CloseOnSelection` (`true`) | let the queue close after an ordinary handled choice |
| `SelectCallback` | `SelectCallback` (`null`) | `(unPlayerIndex, OptionValue, MenuItem, Menu)` |
| `BuildCallback` | `BuildCallback` (`null`) | `(Menu, unPlayerIndex, unPageIndex, TokenRecord)` before native send |
| `CloseCallback` | `CloseCallback` (`null`) | `(unPlayerIndex, Menu)` when `CloseMenuForPlayer()` clears one player's state |
| `InteractionCallback` | `InteractionCallback` (`null`) | `(unPlayerIndex, strInteraction, SelectedItem, Menu)` for an accepted item or navigation choice |
| `ParentMenu` | `ParentMenu` (`null`) | target used by paged back navigation |
| `Fill` | `Fill` (`false`) | inherited rendering option used by specialized menu classes |
| `CloseText` | `ValueCloseText` (`"Close"`) | explicit close label in radio and ESC menus |
| `ShowPages` | `ShowPages` (`true`) | append page numbers in paged titles |
| `Items` | `Items` (`[]`) | ordered `MenuText` and option objects |
| `PlayerMenuPages` | initialized as `new Map()`; no option | remembered page by player index |
| `PlayerTokenRecords` | initialized as `new Map()`; no option | remembered player token record by player index |
| `Length` | derived from `Items.length`; no option | current item count; read-only |

`BaseMenu` is iterable over `Items` in display order.

`InteractionCallback` receives `"Select"` before the selection callback runs, or `"Back"`, `"Next"`, `"ExitBack"`, or `"Exit"` after the requested navigation succeeds. `SelectedItem` is the selected option for `"Select"` and `null` for navigation. Opening, refreshing, or closing a menu through its API does not invoke this callback. It runs synchronously, and thrown errors propagate without undoing navigation already completed.

| Method | Signature | Result |
| --- | --- | --- |
| [`AppendMenuItem`](#basemenuappendmenuitem) | `AppendMenuItem(MenuItem)` | normalized menu item |
| [`BuildMenuRenderData`](#basemenubuildmenurenderdata) | `BuildMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {})` | `MenuRenderData` |
| [`ClearMenuItems`](#basemenuclearmenuitems) | `ClearMenuItems()` | `undefined` |
| [`CloseMenu`](#basemenuclosemenu) | `CloseMenu(TargetReferences = null)` | whether any queue entry was removed |
| [`CloseMenuForPlayer`](#basemenuclosemenuforplayer) | `CloseMenuForPlayer(PlayerReference)` | `undefined` |
| [`FindMenuChoice`](#basemenufindmenuchoice) | `FindMenuChoice(unChoiceIndex, unPageIndex = 0)` | matching option or `null` |
| [`GetMenuRenderData`](#basemenugetmenurenderdata) | `GetMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {})` | `MenuRenderData` |
| [`InsertMenuItem`](#basemenuinsertmenuitem) | `InsertMenuItem(unInsertIndex, MenuItem)` | normalized menu item |
| [`IsActiveMenu`](#basemenuisactivemenu) | `IsActiveMenu(PlayerReference)` | boolean |
| [`RenderMenuItem`](#basemenurendermenuitem) | `RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {})` | rendered string |
| [`RefreshMenu`](#basemenurefreshmenu) | `RefreshMenu(TargetReferences = null)` | whether an active queue entry was resent |
| [`RegisterMenuBuildCallback`](#basemenuregistermenubuildcallback) | `RegisterMenuBuildCallback(BuildCallback)` | the function, or `null` to clear the callback |
| [`RegisterMenuCloseCallback`](#basemenuregistermenuclosecallback) | `RegisterMenuCloseCallback(CloseCallback)` | the function, or `null` to clear the callback |
| [`RegisterMenuSelectCallback`](#basemenuregistermenuselectcallback) | `RegisterMenuSelectCallback(SelectCallback)` | the function, or `null` to clear the callback |
| [`ReindexMenuItems`](#basemenureindexmenuitems) | `ReindexMenuItems()` | `undefined` |
| [`RemoveMenuItem`](#basemenuremovemenuitem) | `RemoveMenuItem(MenuItem)` | boolean |
| [`SelectMenuOption`](#basemenuselectmenuoption) | `SelectMenuOption(PlayerReference, unChoiceIndex, unPageIndex = 0)` | whether a selectable choice was handled |
| [`GetMenuOptions`](#basemenugetmenuoptions) | `GetMenuOptions()` | new array containing the existing option objects |
| [`SendMenu`](#basemenusendmenu) | `SendMenu(TargetReferences, unPageIndex = 0, TokenRecord = {})` | aggregate boolean |
| [`SendMenuToPlayer`](#basemenusendmenutoplayer) | `SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {})` | strict native boolean result |
| [`ShouldCloseMenuAfterSelection`](#basemenushouldclosemenuafterselection) | `ShouldCloseMenuAfterSelection(unChoiceIndex, unPageIndex = 0)` | boolean |

`SendMenuToPlayer()` is the raw one-client transport. It does not make the menu active in a queue by itself. Use `SendMenu()` with the default `QueueEnabled: true` for `menuselect`, `CloseMenu()`, and `RefreshMenu()` ownership.

`GetMenuOptions()` copies the array, not its option objects. Adding or removing entries in that returned array does not change `Items`; changing a returned option's fields changes the same object held by the menu. The paged overload has the same sharing contract.

## `PagedMenu`

`PagedMenu` inherits `BaseMenu` options and adds `ItemsPerPage` (default `7`), `BackChoiceIndex` (`8`), `NextChoiceIndex` (`9`), and `CloseChoiceIndex` (`0`). Its `BackText`, `NextText`, and `CloseText` options (defaults `"Back"`, `"Next"`, and `"Close"`) initialize the renderable `ValueBackText`, `ValueNextText`, and `ValueCloseText` fields. `LastPageIndex` is a read-only derived property.

Building a page, including through `GetMenuRenderData()`, clamps and remembers the player's page in `PlayerMenuPages` and assigns page-local `ChoiceIndex` values to the existing option objects. This is not a read-only snapshot operation. The built-in renderer does not send a menu or acquire queue ownership; `PlayerTokenRecords` are stored by the send path, not by rendering alone.

| Method | Signature | Result |
| --- | --- | --- |
| [`BuildMenuRenderData`](#pagedmenubuildmenurenderdata) | `BuildMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {})` | page-local `MenuRenderData` with navigation rows |
| [`GetPlayerMenuPage`](#pagedmenugetplayermenupage) | `GetPlayerMenuPage(PlayerReference)` | remembered page or `0` |
| [`GetPlayerTokenRecord`](#pagedmenugetplayertokenrecord) | `GetPlayerTokenRecord(PlayerReference)` | remembered live player token record or a new empty object |
| [`GetMenuPageCount`](#pagedmenugetmenupagecount) | `GetMenuPageCount()` | at least `1` |
| [`SelectMenuOption`](#pagedmenuselectmenuoption) | `SelectMenuOption(PlayerReference, unChoiceIndex, unPageIndex = 0)` | handles back, next, close, or a page-local option |
| [`GetMenuOptions`](#pagedmenugetmenuoptions) | `GetMenuOptions(unPageIndex = 0)` | new array of existing options for the requested, clamped page |
| [`SetPlayerPage`](#pagedmenusetplayerpage) | `SetPlayerPage(PlayerReference, unPageIndex)` | page clamped to `LastPageIndex` |
| [`ShouldCloseMenuAfterSelection`](#pagedmenushouldclosemenuafterselection) | `ShouldCloseMenuAfterSelection(unChoiceIndex, unPageIndex = 0)` | `false` for navigation choices; otherwise follows `CloseOnSelection` |

Paged navigation and Close choices operate on the player's menu queue. Let the queue dispatch input for its active menu; if calling `SelectMenuOption()` directly for those choices, first ensure this menu is active for that player.

## Examples

### `BaseMenu`

```js
const { BaseMenu, MenuRenderData, MenuText } = require("menus");

const g_BaseMenuInstance = new BaseMenu({
	Description: "Choose for {Player}",
	Items: [{ ChoiceIndex: 1, Text: "Continue", Value: "continue" }],
	Title: "Action menu",
});
g_BaseMenuInstance.AppendMenuItem(new MenuText("Context: {Context}"));

const g_RenderData = g_BaseMenuInstance.GetMenuRenderData(1, 0, { Context: "current session", Player: "Ren" });
const g_bMenuRenderDataInstance = g_RenderData instanceof MenuRenderData;
const g_bMatchingMenuItemCount = g_BaseMenuInstance.Length === 2;
const g_bMatchingMenuTitle = g_RenderData.MenuTitle === "Action menu";
if (!g_bMenuRenderDataInstance || !g_bMatchingMenuItemCount || !g_bMatchingMenuTitle) {
	throw new Error("BaseMenu did not build the expected menu data.");
}

if (g_RenderData.MenuMessage !== "Choose for Ren\n\n1. Continue\nContext: current session") {
	throw new Error(`BaseMenu rendered an unexpected message: ${g_RenderData.MenuMessage}`);
}

const g_vecFirstMenuOptions = g_BaseMenuInstance.GetMenuOptions();
const g_vecSecondMenuOptions = g_BaseMenuInstance.GetMenuOptions();
if (!Array.isArray(g_vecFirstMenuOptions) || !Array.isArray(g_vecSecondMenuOptions) || (g_vecFirstMenuOptions === g_vecSecondMenuOptions) || (g_vecFirstMenuOptions.length !== 1) || (g_vecSecondMenuOptions.length !== 1) || (g_vecFirstMenuOptions[0] !== g_BaseMenuInstance.Items[0]) || (g_vecSecondMenuOptions[0] !== g_vecFirstMenuOptions[0])) {
	throw new Error("BaseMenu.GetMenuOptions() did not return new arrays sharing the original option.");
}

g_vecFirstMenuOptions.length = 0;
if ((g_BaseMenuInstance.Length !== 2) || (g_vecSecondMenuOptions.length !== 1) || (g_BaseMenuInstance.GetMenuOptions()[0] !== g_vecSecondMenuOptions[0])) {
	throw new Error("Changing the returned option array changed the menu or another snapshot.");
}
```

### `MenuRenderData`

```js
const { MenuRenderData } = require("menus");

const g_RenderData = new MenuRenderData("Selection [2/3]", "1. First\n2. Second", 1, 3);
const g_bMatchingMenuTitle = g_RenderData.MenuTitle === "Selection [2/3]";
const g_bMatchingMenuMessage = g_RenderData.MenuMessage === "1. First\n2. Second";
if (!g_bMatchingMenuTitle || !g_bMatchingMenuMessage) {
	throw new Error("MenuRenderData did not retain its rendered strings.");
}

const g_bMatchingPageIndex = g_RenderData.PageIndex === 1;
const g_bMatchingPageCount = g_RenderData.PageCount === 3;
if (!g_bMatchingPageIndex || !g_bMatchingPageCount) {
	throw new Error("MenuRenderData did not retain its page metadata.");
}
```

### `PagedMenu`

```js
const { PagedMenu, PagedMenuOption } = require("menus");

const g_PagedMenuInstance = new PagedMenu({ ItemsPerPage: 2, Title: "Destination" });
for (const strDestinationName of ["Alpha", "Bravo", "Charlie"]) {
	g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption(strDestinationName, strDestinationName.toLowerCase()));
}

const g_SecondPageMenuRenderData = g_PagedMenuInstance.GetMenuRenderData(1, 1);
const g_bMatchingMenuTitle = g_SecondPageMenuRenderData.MenuTitle === "Destination [2/2]";
const g_bMatchingMenuMessage = g_SecondPageMenuRenderData.MenuMessage === "1. Charlie\n\n8. Back";
if (!g_bMatchingMenuTitle || !g_bMatchingMenuMessage) {
	throw new Error("PagedMenu did not render the requested page.");
}

const g_bMatchingPageIndex = g_SecondPageMenuRenderData.PageIndex === 1;
const g_bMatchingPageCount = g_SecondPageMenuRenderData.PageCount === 2;
const g_bMatchingLastPageIndex = g_PagedMenuInstance.LastPageIndex === 1;
if (!g_bMatchingPageIndex || !g_bMatchingPageCount || !g_bMatchingLastPageIndex) {
	throw new Error("PagedMenu returned incorrect page metadata.");
}

const g_vecFirstPageOptions = g_PagedMenuInstance.GetMenuOptions(1);
const g_vecSecondPageOptions = g_PagedMenuInstance.GetMenuOptions(1);
if (!Array.isArray(g_vecFirstPageOptions) || !Array.isArray(g_vecSecondPageOptions) || (g_vecFirstPageOptions === g_vecSecondPageOptions) || (g_vecFirstPageOptions.length !== 1) || (g_vecSecondPageOptions.length !== 1) || (g_vecFirstPageOptions[0] !== g_PagedMenuInstance.Items[2]) || (g_vecSecondPageOptions[0] !== g_vecFirstPageOptions[0]) || (g_vecFirstPageOptions[0].ChoiceIndex !== 1) || (g_PagedMenuInstance.PlayerMenuPages.get(1) !== 1)) {
	throw new Error("PagedMenu rendering or option-array sharing did not preserve the live page state.");
}

g_vecFirstPageOptions.length = 0;
if ((g_PagedMenuInstance.Length !== 3) || (g_vecSecondPageOptions.length !== 1) || (g_PagedMenuInstance.GetMenuOptions(1)[0] !== g_vecSecondPageOptions[0])) {
	throw new Error("Changing the returned page array changed the menu or another snapshot.");
}
```

### `PagedMenuOption`

```js
const { PagedMenu, PagedMenuOption } = require("menus");

const g_PagedMenuOptionInstance = new PagedMenuOption("Difficulty: {Difficulty}", "hard", {
	Highlighted: true,
	Selectable: true,
});
const g_PagedMenuInstance = new PagedMenu({ Items: [g_PagedMenuOptionInstance], Title: "Settings" });
const g_RenderData = g_PagedMenuInstance.GetMenuRenderData(1, 0, { Difficulty: "Expert" });
const g_bMatchingMenuMessage = g_RenderData.MenuMessage === "1. Difficulty: Expert";
const g_bMatchingChoiceIndex = g_PagedMenuOptionInstance.ChoiceIndex === 1;
if (!g_bMatchingMenuMessage || !g_bMatchingChoiceIndex) {
	throw new Error("PagedMenuOption was not assigned its rendered page-local choice.");
}

const g_bMatchingOptionValue = g_PagedMenuOptionInstance.Value === "hard";
if (!g_bMatchingOptionValue || !g_PagedMenuOptionInstance.Selectable || !g_PagedMenuOptionInstance.Highlighted) {
	throw new Error("PagedMenuOption did not retain its value and display flags.");
}
```

### `SimpleMenu`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

let g_SelectedOption = null;
let g_nSelectedPlayerIndex = -1;

const g_SimpleMenuInstance = new SimpleMenu({
	SelectCallback(unPlayerIndex, ValueOption) {
		g_nSelectedPlayerIndex = unPlayerIndex;
		g_SelectedOption = ValueOption;
	},
	Title: "Ready?",
});
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(1, "Ready", true));

const g_bSelectionHandled = g_SimpleMenuInstance.SelectMenuOption(1, 1);
if (!g_bSelectionHandled || (g_nSelectedPlayerIndex !== 1) || (g_SelectedOption !== true)) {
	throw new Error("SimpleMenu did not dispatch the selected value.");
}
```

### `SimpleMenuOption`

```js
const { SimpleMenuOption } = require("menus");

const g_SimpleMenuOptionInstance = new SimpleMenuOption(2, "Give {Weapon}", "weapon_rifle", {
	Highlighted: false,
	Selectable: true,
});
const g_bMatchingChoiceIndex = g_SimpleMenuOptionInstance.ChoiceIndex === 2;
const g_bMatchingMenuText = g_SimpleMenuOptionInstance.GetMenuText(1, { Weapon: "rifle" }) === "Give rifle";
if (!g_bMatchingChoiceIndex || !g_bMatchingMenuText) {
	throw new Error("SimpleMenuOption did not expose its choice or rendered text.");
}

const g_bMatchingOptionValue = g_SimpleMenuOptionInstance.Value === "weapon_rifle";
if (!g_bMatchingOptionValue || !g_SimpleMenuOptionInstance.Selectable || g_SimpleMenuOptionInstance.Highlighted) {
	throw new Error("SimpleMenuOption did not retain its value and display flags.");
}
```

### `MenuText`

```js
const { MenuText } = require("menus");

const g_MenuTextInstance = new MenuText((unPlayerIndex, TokenRecord) => `Player ${unPlayerIndex}: ${TokenRecord.Status}`);
const g_bMatchingMenuText = g_MenuTextInstance.GetMenuText(3, { Status: "ready" }) === "Player 3: ready";
if (!g_bMatchingMenuText || g_MenuTextInstance.Selectable) {
	throw new Error("MenuText did not render its callback value as a non-selectable row.");
}

g_MenuTextInstance.Text = "Status: {Status}";
if (g_MenuTextInstance.GetMenuText(3, { Status: "ready" }) !== "Status: ready") {
	throw new Error("MenuText.Text did not update the rendered value.");
}
```

### `BaseMenu.AppendMenuItem`

```js
const { BaseMenu, MenuText } = require("menus");

const g_BaseMenuInstance = new BaseMenu();
const g_RestartMenuOption = g_BaseMenuInstance.AppendMenuItem({ ChoiceIndex: 4, Text: "Restart", Value: "restart" });
const g_LabelMenuText = g_BaseMenuInstance.AppendMenuItem(new MenuText("Administrative action"));
const g_vecMenuItems = [...g_BaseMenuInstance];
if ((g_RestartMenuOption.ChoiceIndex !== 4) || (g_RestartMenuOption.Value !== "restart")) {
	throw new Error("BaseMenu.AppendMenuItem() did not normalize the option.");
}

if ((g_LabelMenuText.GetMenuText() !== "Administrative action") || (g_BaseMenuInstance.Length !== 2)) {
	throw new Error("BaseMenu.AppendMenuItem() did not retain both items.");
}

if ((g_vecMenuItems[0] !== g_RestartMenuOption) || (g_vecMenuItems[1] !== g_LabelMenuText)) {
	throw new Error("BaseMenu iteration did not preserve display order.");
}
```

### `BaseMenu.BuildMenuRenderData`

```js
const { BaseMenu, MenuRenderData } = require("menus");

const g_BaseMenuInstance = new BaseMenu({
	Description: "Current mode: {Mode}",
	Items: [{ ChoiceIndex: 1, Text: "Keep {Mode}", Value: true }],
	Title: "Mode vote",
});
const g_RenderData = g_BaseMenuInstance.BuildMenuRenderData(1, 0, { Mode: "cooperative" });
const g_bMenuRenderDataInstance = g_RenderData instanceof MenuRenderData;
const g_bMatchingMenuTitle = g_RenderData.MenuTitle === "Mode vote";
if (!g_bMenuRenderDataInstance || !g_bMatchingMenuTitle) {
	throw new Error("BaseMenu.BuildMenuRenderData() did not return MenuRenderData.");
}

const g_bMatchingMenuMessage = g_RenderData.MenuMessage === "Current mode: cooperative\n\n1. Keep cooperative";
const g_bMatchingPageCount = g_RenderData.PageCount === 1;
if (!g_bMatchingMenuMessage || !g_bMatchingPageCount) {
	throw new Error("BaseMenu.BuildMenuRenderData() rendered an unexpected result.");
}
```

### `BaseMenu.ClearMenuItems`

```js
const { BaseMenu } = require("menus");

const g_BaseMenuInstance = new BaseMenu({ Items: ["First", "Second"] });
if (g_BaseMenuInstance.ClearMenuItems() !== undefined) {
	throw new Error("BaseMenu.ClearMenuItems() returned an undocumented value.");
}

if ((g_BaseMenuInstance.Length !== 0) || ([...g_BaseMenuInstance].length !== 0)) {
	throw new Error("BaseMenu.ClearMenuItems() did not remove every item.");
}
```

### `BaseMenu.CloseMenu`

Removing only pending queue entries returns whether any were removed; it does not call `CloseMenuForPlayer()` or clear the menu's player maps. Removing the active menu detaches the old owner before calling `CloseCallback`. It attempts the next transition even after a callback exception, unless that callback has already installed another active menu. A failed or false transition result triggers hiding only while no replacement is active. A single failure is rethrown unchanged; multiple failures produce an `AggregateError` in close, transition, hide order. A false native hide status does not change the queue-removal boolean result.

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

const g_vecErrors = [];
let g_bMenuSendAttempted = false;
let g_bMenuCloseAttempted = false;

const g_SimpleMenuInstance = new SimpleMenu({ Title: "Temporary" });
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(1, "Close me"));

try {
	g_bMenuSendAttempted = true;
	if (!g_SimpleMenuInstance.SendMenu(1)) {
		throw new Error("BaseMenu.SendMenu() did not activate the queued menu.");
	}

	if (!g_SimpleMenuInstance.IsActiveMenu(1)) {
		throw new Error("BaseMenu.IsActiveMenu() did not report the queued menu.");
	}

	g_bMenuCloseAttempted = true;
	if (g_SimpleMenuInstance.CloseMenu(1) !== true) {
		throw new Error("BaseMenu.CloseMenu() did not remove the queued menu.");
	}

	if (g_SimpleMenuInstance.IsActiveMenu(1)) {
		throw new Error("BaseMenu.CloseMenu() left the menu active.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bMenuSendAttempted) {
		try {
			if (!g_bMenuCloseAttempted) {
				const bMenuRemoved = g_SimpleMenuInstance.CloseMenu(1);
				if (typeof bMenuRemoved !== "boolean") {
					throw new Error("CloseMenu() returned an undocumented value.");
				}
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (g_SimpleMenuInstance.PlayerMenuPages.has(1) || g_SimpleMenuInstance.PlayerTokenRecords.has(1)) {
				const CloseResult = g_SimpleMenuInstance.CloseMenuForPlayer(1);
				if (CloseResult !== undefined) {
					throw new Error("CloseMenuForPlayer() returned an undocumented value.");
				}
			}

			if (g_SimpleMenuInstance.IsActiveMenu(1) || g_SimpleMenuInstance.PlayerMenuPages.has(1) || g_SimpleMenuInstance.PlayerTokenRecords.has(1)) {
				throw new Error("Menu cleanup left queue ownership or player state behind.");
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
	throw new AggregateError(g_vecErrors, "Menu operation and cleanup failed.");
}
```

### `BaseMenu.CloseMenuForPlayer`

```js
const { BaseMenu, HideText } = require("menus");

let g_nClosedPlayerIndex = -1;
const g_vecErrors = [];
let g_bDirectSendAttempted = false;
let g_bDirectCloseAttempted = false;

const g_BaseMenuInstance = new BaseMenu({
	CloseCallback(unPlayerIndex) {
		g_nClosedPlayerIndex = unPlayerIndex;
	},
	QueueEnabled: false,
});

try {
	g_bDirectSendAttempted = true;
	if (!g_BaseMenuInstance.SendMenuToPlayer(1, 0, { Source: "direct" })) {
		throw new Error("BaseMenu.SendMenuToPlayer() could not show the menu.");
	}

	g_bDirectCloseAttempted = true;
	if (g_BaseMenuInstance.CloseMenuForPlayer(1) !== undefined) {
		throw new Error("BaseMenu.CloseMenuForPlayer() returned an undocumented value.");
	}

	const bPlayerMenuPageRetained = g_BaseMenuInstance.PlayerMenuPages.has(1);
	const bPlayerTokenRecordRetained = g_BaseMenuInstance.PlayerTokenRecords.has(1);
	if ((g_nClosedPlayerIndex !== 1) || bPlayerMenuPageRetained || bPlayerTokenRecordRetained) {
		throw new Error("BaseMenu.CloseMenuForPlayer() did not clear the player's state.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bDirectSendAttempted) {
		try {
			if (!g_bDirectCloseAttempted) {
				const CloseResult = g_BaseMenuInstance.CloseMenuForPlayer(1);
				if (CloseResult !== undefined) {
					throw new Error("CloseMenuForPlayer() returned an undocumented value.");
				}
			}

			if (g_BaseMenuInstance.PlayerMenuPages.has(1) || g_BaseMenuInstance.PlayerTokenRecords.has(1)) {
				throw new Error("Direct menu cleanup left player state behind.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (HideText(1) !== true) {
				throw new Error("HideText() could not remove the direct menu text.");
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
	throw new AggregateError(g_vecErrors, "Menu operation and cleanup failed.");
}
```

### `BaseMenu.FindMenuChoice`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

const g_SimpleMenuInstance = new SimpleMenu();
const g_OptionValue = { Action: "apply" };
const g_SimpleMenuOptionInstance = g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(3, "Apply", g_OptionValue));
const g_FoundSimpleMenuOption = g_SimpleMenuInstance.FindMenuChoice(3);
if ((g_FoundSimpleMenuOption !== g_SimpleMenuOptionInstance) || (g_FoundSimpleMenuOption.Value !== g_OptionValue)) {
	throw new Error("BaseMenu.FindMenuChoice() did not return the matching option.");
}

if (g_SimpleMenuInstance.FindMenuChoice(9) !== null) {
	throw new Error("BaseMenu.FindMenuChoice() did not return null for an unknown choice.");
}
```

### `BaseMenu.GetMenuRenderData`

```js
const { BaseMenu, MenuRenderData } = require("menus");

const g_BaseMenuInstance = new BaseMenu({
	Items: [{ Text: "Hello {Name}", Value: "hello" }],
	Title: "Greeting",
});
const g_RenderData = g_BaseMenuInstance.GetMenuRenderData({ Index: 1 }, 0, { Name: "Ren" });
const g_bMenuRenderDataInstance = g_RenderData instanceof MenuRenderData;
const g_bMatchingMenuTitle = g_RenderData.MenuTitle === "Greeting";
const g_bMatchingMenuMessage = g_RenderData.MenuMessage === "1. Hello Ren";
if (!g_bMenuRenderDataInstance || !g_bMatchingMenuTitle || !g_bMatchingMenuMessage) {
	throw new Error("BaseMenu.GetMenuRenderData() did not normalize the player or render the player token record.");
}
```

### `BaseMenu.InsertMenuItem`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

const g_SimpleMenuInstance = new SimpleMenu();
const g_FirstSimpleMenuOption = g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(1, "First", "first"));
const g_ThirdSimpleMenuOption = g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(2, "Third", "third"));
const g_InsertedSimpleMenuOption = g_SimpleMenuInstance.InsertMenuItem(1, new SimpleMenuOption(9, "Second", "second"));
const g_vecMenuItems = [...g_SimpleMenuInstance];
const g_bMatchingFirstMenuItem = g_vecMenuItems[0] === g_FirstSimpleMenuOption;
const g_bMatchingSecondMenuItem = g_vecMenuItems[1] === g_InsertedSimpleMenuOption;
const g_bMatchingThirdMenuItem = g_vecMenuItems[2] === g_ThirdSimpleMenuOption;
if (!g_bMatchingFirstMenuItem || !g_bMatchingSecondMenuItem || !g_bMatchingThirdMenuItem) {
	throw new Error("BaseMenu.InsertMenuItem() did not preserve the requested display order.");
}

const g_bMatchingInsertedOptionValue = g_InsertedSimpleMenuOption.Value === "second";
const g_bMenuItemsReindexed = g_vecMenuItems.every((MenuItem, unIndex) => MenuItem.ChoiceIndex === (unIndex + 1));
if (!g_bMatchingInsertedOptionValue || !g_bMenuItemsReindexed) {
	throw new Error("BaseMenu.InsertMenuItem() did not reindex the menu options.");
}
```

### `BaseMenu.IsActiveMenu`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

const g_vecErrors = [];
let g_bMenuSendAttempted = false;

const g_SimpleMenuInstance = new SimpleMenu({ Title: "Active check" });
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(1, "Select"));

try {
	g_bMenuSendAttempted = true;
	if (!g_SimpleMenuInstance.SendMenu(1)) {
		throw new Error("BaseMenu.IsActiveMenu() did not report the queued menu.");
	}

	if (!g_SimpleMenuInstance.IsActiveMenu(1)) {
		throw new Error("BaseMenu.IsActiveMenu() did not report the queued menu.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bMenuSendAttempted) {
		try {
			const bMenuRemoved = g_SimpleMenuInstance.CloseMenu(1);
			if (typeof bMenuRemoved !== "boolean") {
				throw new Error("CloseMenu() returned an undocumented value.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (g_SimpleMenuInstance.PlayerMenuPages.has(1) || g_SimpleMenuInstance.PlayerTokenRecords.has(1)) {
				const CloseResult = g_SimpleMenuInstance.CloseMenuForPlayer(1);
				if (CloseResult !== undefined) {
					throw new Error("CloseMenuForPlayer() returned an undocumented value.");
				}
			}

			if (g_SimpleMenuInstance.IsActiveMenu(1) || g_SimpleMenuInstance.PlayerMenuPages.has(1) || g_SimpleMenuInstance.PlayerTokenRecords.has(1)) {
				throw new Error("Menu cleanup left queue ownership or player state behind.");
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
	throw new AggregateError(g_vecErrors, "Menu operation and cleanup failed.");
}
```

### `BaseMenu.RenderMenuItem`

```js
const { BaseMenu, MenuText, SimpleMenuOption } = require("menus");

const g_BaseMenuInstance = new BaseMenu();
const g_SimpleMenuOptionInstance = new SimpleMenuOption(2, "Give {Item}", "rifle");
const g_MenuTextInstance = new MenuText("Player {Name}");
if (g_BaseMenuInstance.RenderMenuItem(g_SimpleMenuOptionInstance, 1, { Item: "rifle" }) !== "2. Give rifle") {
	throw new Error("BaseMenu.RenderMenuItem() did not render the selectable option.");
}

if (g_BaseMenuInstance.RenderMenuItem(g_MenuTextInstance, 1, { Name: "Ren" }) !== "Player Ren") {
	throw new Error("BaseMenu.RenderMenuItem() did not render the text row.");
}
```

### `BaseMenu.RefreshMenu`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

const g_vecErrors = [];
let g_bMenuSendAttempted = false;

const g_SimpleMenuInstance = new SimpleMenu({ Title: "Before" });
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(1, "Continue"));

try {
	g_bMenuSendAttempted = true;
	if (!g_SimpleMenuInstance.SendMenu(1)) {
		throw new Error("BaseMenu.SendMenu() could not activate the menu before refresh.");
	}

	g_SimpleMenuInstance.ValueTitle = "After";
	const bMenuRefreshed = g_SimpleMenuInstance.RefreshMenu(1);
	const bMatchingMenuTitle = g_SimpleMenuInstance.GetMenuRenderData(1).MenuTitle === "After";
	if (!bMenuRefreshed || !bMatchingMenuTitle) {
		throw new Error("BaseMenu.RefreshMenu() did not resend the updated menu.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bMenuSendAttempted) {
		try {
			const bMenuRemoved = g_SimpleMenuInstance.CloseMenu(1);
			if (typeof bMenuRemoved !== "boolean") {
				throw new Error("CloseMenu() returned an undocumented value.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (g_SimpleMenuInstance.PlayerMenuPages.has(1) || g_SimpleMenuInstance.PlayerTokenRecords.has(1)) {
				const CloseResult = g_SimpleMenuInstance.CloseMenuForPlayer(1);
				if (CloseResult !== undefined) {
					throw new Error("CloseMenuForPlayer() returned an undocumented value.");
				}
			}

			if (g_SimpleMenuInstance.IsActiveMenu(1) || g_SimpleMenuInstance.PlayerMenuPages.has(1) || g_SimpleMenuInstance.PlayerTokenRecords.has(1)) {
				throw new Error("Menu cleanup left queue ownership or player state behind.");
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
	throw new AggregateError(g_vecErrors, "Menu operation and cleanup failed.");
}
```

### `BaseMenu.RegisterMenuBuildCallback`

```js
const { BaseMenu, HideText } = require("menus");

let g_BuildInvocationRecord = null;
const g_vecErrors = [];
let g_bDirectSendAttempted = false;

const g_BaseMenuInstance = new BaseMenu({ QueueEnabled: false, Title: "Status" });
const g_BuildCallback = g_BaseMenuInstance.RegisterMenuBuildCallback((Menu, unPlayerIndex, unPageIndex, TokenRecord) => {
	g_BuildInvocationRecord = {
		BaseMenu: Menu,
		TokenRecord,
		PageIndex: unPageIndex,
		PlayerIndex: unPlayerIndex,
	};

	Menu.ValueDescription = `Client ${unPlayerIndex}, page ${unPageIndex}, state ${TokenRecord.State}`;
});

const g_PlayerTokenRecord = { State: "ready" };

if (g_BuildCallback !== g_BaseMenuInstance.BuildCallback) {
	throw new Error("BaseMenu.RegisterMenuBuildCallback() did not retain the callback.");
}

try {
	g_bDirectSendAttempted = true;
	if (!g_BaseMenuInstance.SendMenuToPlayer(1, 0, g_PlayerTokenRecord)) {
		throw new Error("BaseMenu.SendMenuToPlayer() could not invoke the build callback.");
	}

	if (g_BuildInvocationRecord === null) {
		throw new Error("BaseMenu build callback did not record an invocation.");
	}

	const bMatchingBaseMenu = g_BuildInvocationRecord.BaseMenu === g_BaseMenuInstance;
	const bMatchingPlayerIndex = g_BuildInvocationRecord.PlayerIndex === 1;
	const bMatchingPageIndex = g_BuildInvocationRecord.PageIndex === 0;
	const bMatchingPlayerTokenRecord = g_BuildInvocationRecord.TokenRecord === g_PlayerTokenRecord;
	if (!bMatchingBaseMenu || !bMatchingPlayerIndex || !bMatchingPageIndex || !bMatchingPlayerTokenRecord) {
		throw new Error("BaseMenu build callback received unexpected arguments.");
	}

	if (g_BaseMenuInstance.ValueDescription !== "Client 1, page 0, state ready") {
		throw new Error("BaseMenu build callback did not update the rendered menu.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bDirectSendAttempted) {
		try {
			const CloseResult = g_BaseMenuInstance.CloseMenuForPlayer(1);
			if (CloseResult !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}

			if (g_BaseMenuInstance.PlayerMenuPages.has(1) || g_BaseMenuInstance.PlayerTokenRecords.has(1)) {
				throw new Error("Direct menu cleanup left player state behind.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (HideText(1) !== true) {
				throw new Error("HideText() could not remove the direct menu text.");
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
	throw new AggregateError(g_vecErrors, "Menu operation and cleanup failed.");
}
```

### `BaseMenu.RegisterMenuCloseCallback`

```js
const { BaseMenu } = require("menus");

const g_vecClosedPlayerRecords = [];
const g_BaseMenuInstance = new BaseMenu();
const g_CloseCallback = g_BaseMenuInstance.RegisterMenuCloseCallback((unPlayerIndex, Menu) => {
	g_vecClosedPlayerRecords.push({
		MatchingBaseMenu: Menu === g_BaseMenuInstance,
		PlayerIndex: unPlayerIndex,
	});
});
if (g_CloseCallback !== g_BaseMenuInstance.CloseCallback) {
	throw new Error("BaseMenu.RegisterMenuCloseCallback() did not retain the callback.");
}

if (g_BaseMenuInstance.CloseMenuForPlayer(4) !== undefined) {
	throw new Error("BaseMenu.CloseMenuForPlayer() returned an undocumented value.");
}

const g_ClosedPlayerRecord = g_vecClosedPlayerRecords[0] ?? null;
const g_bMatchingClosedPlayerCount = g_vecClosedPlayerRecords.length === 1;
const g_bMatchingClosedPlayerIndex = g_ClosedPlayerRecord?.PlayerIndex === 4;
if (!g_bMatchingClosedPlayerCount || !g_bMatchingClosedPlayerIndex || !g_ClosedPlayerRecord?.MatchingBaseMenu) {
	throw new Error("BaseMenu close callback received unexpected arguments.");
}
```

### `BaseMenu.RegisterMenuSelectCallback`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

const g_vecSelectionRecords = [];
const g_SimpleMenuInstance = new SimpleMenu({ Items: [new SimpleMenuOption(1, "Expert", "expert")] });
const g_SelectCallback = g_SimpleMenuInstance.RegisterMenuSelectCallback((unPlayerIndex, ValueOption, MenuItem, Menu) => {
	g_vecSelectionRecords.push({
		MatchingBaseMenu: Menu === g_SimpleMenuInstance,
		MenuItemText: MenuItem.GetMenuText(),
		PlayerIndex: unPlayerIndex,
		ValueOption,
	});
});
const g_bSelectCallbackRetained = g_SelectCallback === g_SimpleMenuInstance.SelectCallback;
const g_bSelectionHandled = g_SimpleMenuInstance.SelectMenuOption(2, 1);
if (!g_bSelectCallbackRetained || !g_bSelectionHandled) {
	throw new Error("BaseMenu.RegisterMenuSelectCallback() did not retain or invoke the callback.");
}

const g_SelectionRecord = g_vecSelectionRecords[0] ?? null;
const g_bMatchingSelectionCount = g_vecSelectionRecords.length === 1;
const g_bMatchingPlayerIndex = g_SelectionRecord?.PlayerIndex === 2;
const g_bMatchingOptionValue = g_SelectionRecord?.ValueOption === "expert";
if (!g_bMatchingSelectionCount || !g_bMatchingPlayerIndex || !g_bMatchingOptionValue) {
	throw new Error("BaseMenu select callback received unexpected player or value data.");
}

if ((g_SelectionRecord?.MenuItemText !== "Expert") || !g_SelectionRecord?.MatchingBaseMenu) {
	throw new Error("BaseMenu select callback received an unexpected item or menu.");
}
```

### `BaseMenu.ReindexMenuItems`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

const g_SimpleMenuInstance = new SimpleMenu();
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(7, "Alpha"));
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(9, "Bravo"));

if (g_SimpleMenuInstance.ReindexMenuItems() !== undefined) {
	throw new Error("BaseMenu.ReindexMenuItems() returned an undocumented value.");
}

const g_bMenuItemsReindexed = [...g_SimpleMenuInstance].every((MenuItem, unIndex) => MenuItem.ChoiceIndex === (unIndex + 1));
if (!g_bMenuItemsReindexed) {
	throw new Error("BaseMenu.ReindexMenuItems() did not assign sequential choices.");
}
```

### `BaseMenu.RemoveMenuItem`

```js
const { BaseMenu } = require("menus");

const g_BaseMenuInstance = new BaseMenu();
const g_MenuItem = g_BaseMenuInstance.AppendMenuItem({ Text: "Remove", Value: "remove" });
if (g_MenuItem.GetMenuText() !== "Remove") {
	throw new Error("BaseMenu.RemoveMenuItem() example did not create the expected text.");
}

const g_bFirstRemovalSucceeded = g_BaseMenuInstance.RemoveMenuItem(g_MenuItem);
const g_bSecondRemovalSucceeded = g_BaseMenuInstance.RemoveMenuItem(g_MenuItem);
if (!g_bFirstRemovalSucceeded || g_bSecondRemovalSucceeded) {
	throw new Error("BaseMenu.RemoveMenuItem() did not distinguish present and absent items.");
}

if (g_BaseMenuInstance.Length !== 0) {
	throw new Error("BaseMenu.RemoveMenuItem() left the removed item in the menu.");
}
```

### `BaseMenu.SelectMenuOption`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");

const g_vecSelectionRecords = [];
const g_SimpleMenuInstance = new SimpleMenu({
	SelectCallback(unPlayerIndex, ValueOption) {
		g_vecSelectionRecords.push({ PlayerIndex: unPlayerIndex, ValueOption });
	},
});
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(1, "Enabled", "enabled"));
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(2, "Disabled", "disabled", { Selectable: false }));

const g_bSelectableChoiceHandled = g_SimpleMenuInstance.SelectMenuOption(1, 1);
const g_bDisabledChoiceHandled = g_SimpleMenuInstance.SelectMenuOption(1, 2);
const g_bUnknownChoiceHandled = g_SimpleMenuInstance.SelectMenuOption(1, 9);
if (!g_bSelectableChoiceHandled || g_bDisabledChoiceHandled || g_bUnknownChoiceHandled) {
	throw new Error("BaseMenu.SelectMenuOption() did not enforce selectable and known choices.");
}

const g_SelectionRecord = g_vecSelectionRecords[0] ?? null;
const g_bMatchingSelectionCount = g_vecSelectionRecords.length === 1;
const g_bMatchingPlayerIndex = g_SelectionRecord?.PlayerIndex === 1;
const g_bMatchingOptionValue = g_SelectionRecord?.ValueOption === "enabled";
if (!g_bMatchingSelectionCount || !g_bMatchingPlayerIndex || !g_bMatchingOptionValue) {
	throw new Error("BaseMenu.SelectMenuOption() dispatched unexpected callback data.");
}
```

### `BaseMenu.GetMenuOptions`

The result is a new array, but its option objects are shared with the menu. Changing the returned array does not change `Items`; editing an option object is visible to the menu. Non-selectable option rows are included; plain `MenuText` rows are excluded.

```js
const { MenuText, SimpleMenu, SimpleMenuOption } = require("menus");

const g_SimpleMenuInstance = new SimpleMenu({
	Items: [
		new MenuText("Heading"),
		new SimpleMenuOption(1, "Playable", "yes"),
		new SimpleMenuOption(2, "Unavailable", "no", { Selectable: false }),
	],
});
const g_vecMenuOptions = g_SimpleMenuInstance.GetMenuOptions();
const g_bMatchingMenuOptionCount = g_vecMenuOptions.length === 2;
const g_bMatchingFirstOptionValue = g_vecMenuOptions[0].Value === "yes";
const g_bMatchingSecondOptionValue = g_vecMenuOptions[1].Value === "no";
if (!g_bMatchingMenuOptionCount || !g_bMatchingFirstOptionValue || !g_bMatchingSecondOptionValue) {
	throw new Error("BaseMenu.GetMenuOptions() did not return every option row.");
}

if (!g_vecMenuOptions[0].Selectable || g_vecMenuOptions[1].Selectable) {
	throw new Error("BaseMenu.GetMenuOptions() did not preserve selectable flags.");
}

g_vecMenuOptions[0].Text = "Updated playable";
if (g_SimpleMenuInstance.RenderMenuItem(g_vecMenuOptions[0], 1) !== "1. Updated playable") {
	throw new Error("GetMenuOptions() did not retain shared option objects.");
}

g_vecMenuOptions.pop();
if ((g_SimpleMenuInstance.Length !== 3) || (g_SimpleMenuInstance.GetMenuOptions().length !== 2)) {
	throw new Error("GetMenuOptions() returned the menu's live array instead of an independent container.");
}
```

### `BaseMenu.SendMenu`

Sending to multiple targets is not atomic: `false` or an exception can follow a successful send to an earlier player. Clean up each requested player independently, including pending queue entries. A single batched `CloseMenu()` call can stop at a throwing close callback; do not let that skip the other players or replace the original failure. Queued cleanup must not hide a different menu activated during the close callback.

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");
const { GetPlayerMenuQueue } = require("menus/queue");

const g_vecErrors = [];
const g_vecTargetPlayerIndexes = [1, 2];
const g_SimpleMenuInstance = new SimpleMenu({ Title: "Session notice" });
const g_PlayerTokenRecord = { Audience: "connected players" };

g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(1, "Acknowledge", true));

try {
	if (!g_SimpleMenuInstance.SendMenu(g_vecTargetPlayerIndexes, 0, g_PlayerTokenRecord)) {
		throw new Error("BaseMenu.SendMenu() could not queue the menu for every target.");
	}

	if (!g_SimpleMenuInstance.IsActiveMenu(1) || !g_SimpleMenuInstance.IsActiveMenu(2)) {
		throw new Error("BaseMenu.SendMenu() did not activate every target queue.");
	}

	const bMatchingFirstPlayerTokenRecord = g_SimpleMenuInstance.PlayerTokenRecords.get(1) === g_PlayerTokenRecord;
	const bMatchingSecondPlayerTokenRecord = g_SimpleMenuInstance.PlayerTokenRecords.get(2) === g_PlayerTokenRecord;
	if (!bMatchingFirstPlayerTokenRecord || !bMatchingSecondPlayerTokenRecord) {
		throw new Error("BaseMenu.SendMenu() did not retain the supplied player token record.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unPlayerIndex of g_vecTargetPlayerIndexes) {
		try {
			const bHadQueueEntry = GetPlayerMenuQueue(unPlayerIndex).HasMenu(g_SimpleMenuInstance);
			const bQueueEntryRemoved = g_SimpleMenuInstance.CloseMenu(unPlayerIndex);
			if ((typeof bQueueEntryRemoved !== "boolean") || (bHadQueueEntry && !bQueueEntryRemoved)) {
				throw new Error("BaseMenu.CloseMenu() did not confirm removal of a target queue entry.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (g_SimpleMenuInstance.PlayerMenuPages.has(unPlayerIndex) || g_SimpleMenuInstance.PlayerTokenRecords.has(unPlayerIndex)) {
				if (g_SimpleMenuInstance.CloseMenuForPlayer(unPlayerIndex) !== undefined) {
					throw new Error("BaseMenu.CloseMenuForPlayer() returned an undocumented value.");
				}
			}

			if (GetPlayerMenuQueue(unPlayerIndex).HasMenu(g_SimpleMenuInstance) || g_SimpleMenuInstance.PlayerMenuPages.has(unPlayerIndex) || g_SimpleMenuInstance.PlayerTokenRecords.has(unPlayerIndex)) {
				throw new Error("BaseMenu.SendMenu() cleanup left queue or player state behind.");
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
	throw new AggregateError(g_vecErrors, "Sending or cleaning up the target menus failed.");
}
```

### `BaseMenu.SendMenuToPlayer`

```js
const { BaseMenu, HideText } = require("menus");

const g_vecErrors = [];
let g_bDirectSendAttempted = false;

const g_BaseMenuInstance = new BaseMenu({ QueueEnabled: false, Description: "Direct transport", Title: "Notice" });
const g_TokenRecord = { Source: "plugin" };

try {
	g_bDirectSendAttempted = true;
	if (!g_BaseMenuInstance.SendMenuToPlayer(1, 0, g_TokenRecord)) {
		throw new Error("BaseMenu.SendMenuToPlayer() could not show the menu.");
	}

	const bMatchingPlayerMenuPage = g_BaseMenuInstance.PlayerMenuPages.get(1) === 0;
	const bMatchingPlayerTokenRecord = g_BaseMenuInstance.PlayerTokenRecords.get(1) === g_TokenRecord;
	if (!bMatchingPlayerMenuPage || !bMatchingPlayerTokenRecord) {
		throw new Error("BaseMenu.SendMenuToPlayer() did not retain the player state.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bDirectSendAttempted) {
		try {
			if (g_BaseMenuInstance.CloseMenuForPlayer(1) !== undefined) {
				throw new Error("BaseMenu.CloseMenuForPlayer() returned an undocumented value.");
			}

			if (g_BaseMenuInstance.PlayerMenuPages.has(1) || g_BaseMenuInstance.PlayerTokenRecords.has(1)) {
				throw new Error("BaseMenu.SendMenuToPlayer() cleanup left player state behind.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (HideText(1) !== true) {
				throw new Error("HideText() could not clean up the direct menu text.");
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
	throw new AggregateError(g_vecErrors, "Sending or cleaning up the direct menu failed.");
}
```

### `BaseMenu.ShouldCloseMenuAfterSelection`

```js
const { BaseMenu } = require("menus");

const g_PersistentMenu = new BaseMenu({ CloseOnSelection: false });
const g_OneShotMenu = new BaseMenu({ CloseOnSelection: true });

const g_bPersistentMenuCloses = g_PersistentMenu.ShouldCloseMenuAfterSelection(1);
const g_bOneShotMenuCloses = g_OneShotMenu.ShouldCloseMenuAfterSelection(1);
if (g_bPersistentMenuCloses || !g_bOneShotMenuCloses) {
	throw new Error("BaseMenu.ShouldCloseMenuAfterSelection() ignored CloseOnSelection.");
}
```

### `PagedMenu.BuildMenuRenderData`

```js
const { MenuRenderData, PagedMenu, PagedMenuOption } = require("menus");

const g_PagedMenuInstance = new PagedMenu({ ItemsPerPage: 2, Title: "Destination" });
for (const strDestinationName of ["Alpha", "Bravo", "Charlie"]) {
	g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption(strDestinationName, strDestinationName.toLowerCase()));
}

const g_RenderData = g_PagedMenuInstance.BuildMenuRenderData(1, 1);
const g_bMenuRenderDataInstance = g_RenderData instanceof MenuRenderData;
const g_bMatchingMenuTitle = g_RenderData.MenuTitle === "Destination [2/2]";
if (!g_bMenuRenderDataInstance || !g_bMatchingMenuTitle) {
	throw new Error("PagedMenu.BuildMenuRenderData() did not return the requested rendered page.");
}

const g_bMatchingPageIndex = g_RenderData.PageIndex === 1;
const g_bMatchingPageCount = g_RenderData.PageCount === 2;
const g_bMatchingMenuMessage = g_RenderData.MenuMessage === "1. Charlie\n\n8. Back";
if (!g_bMatchingPageIndex || !g_bMatchingPageCount || !g_bMatchingMenuMessage) {
	throw new Error("PagedMenu.BuildMenuRenderData() returned unexpected page contents.");
}
```

### `PagedMenu.GetPlayerMenuPage`

```js
const { PagedMenu, PagedMenuOption } = require("menus");

const g_PagedMenuInstance = new PagedMenu({ ItemsPerPage: 1 });
g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption("One"));
g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption("Two"));

if (g_PagedMenuInstance.GetPlayerMenuPage(1) !== 0) {
	throw new Error("PagedMenu.GetPlayerMenuPage() did not default to the first page.");
}

g_PagedMenuInstance.BuildMenuRenderData(1, 1);
if (g_PagedMenuInstance.GetPlayerMenuPage(1) !== 1) {
	throw new Error("PagedMenu.GetPlayerMenuPage() did not return the remembered page.");
}
```

### `PagedMenu.GetPlayerTokenRecord`

```js
const { HideText, PagedMenu } = require("menus");

const g_vecErrors = [];
let g_bDirectSendAttempted = false;

const g_PagedMenuInstance = new PagedMenu({ QueueEnabled: false, Title: "Tokens" });
const g_TokenRecord = { Mode: "current" };

try {
	g_bDirectSendAttempted = true;
	if (!g_PagedMenuInstance.SendMenuToPlayer(1, 0, g_TokenRecord)) {
		throw new Error("PagedMenu.SendMenuToPlayer() could not show the tokenized menu.");
	}

	if (g_PagedMenuInstance.GetPlayerTokenRecord(1) !== g_TokenRecord) {
		throw new Error("PagedMenu.GetPlayerTokenRecord() did not return the active player token record.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bDirectSendAttempted) {
		try {
			if (g_PagedMenuInstance.CloseMenuForPlayer(1) !== undefined) {
				throw new Error("CloseMenuForPlayer() returned an undocumented value.");
			}

			if (g_PagedMenuInstance.PlayerMenuPages.has(1) || g_PagedMenuInstance.PlayerTokenRecords.has(1)) {
				throw new Error("Player-token cleanup left remembered state behind.");
			}

			const FirstEmptyPlayerTokenRecord = g_PagedMenuInstance.GetPlayerTokenRecord(1);
			const SecondEmptyPlayerTokenRecord = g_PagedMenuInstance.GetPlayerTokenRecord(1);
			const bFirstPlayerTokenRecordEmpty = Object.keys(FirstEmptyPlayerTokenRecord).length === 0;
			const bDistinctPlayerTokenRecords = FirstEmptyPlayerTokenRecord !== SecondEmptyPlayerTokenRecord;
			if (!bFirstPlayerTokenRecordEmpty || !bDistinctPlayerTokenRecords) {
				throw new Error("PagedMenu.GetPlayerTokenRecord() did not return a fresh empty object for inactive state.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (HideText(1) !== true) {
				throw new Error("HideText() could not clean up the player-token example.");
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
	throw new AggregateError(g_vecErrors, "Player-token operation and cleanup failed.");
}
```

### `PagedMenu.GetMenuPageCount`

```js
const { PagedMenu, PagedMenuOption } = require("menus");

const g_PagedMenuInstance = new PagedMenu({ ItemsPerPage: 2 });
for (const unOptionValue of [1, 2, 3, 4, 5]) {
	g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption(`Choice ${unOptionValue}`, unOptionValue));
}

const g_bMatchingPageCount = g_PagedMenuInstance.GetMenuPageCount() === 3;
const g_bMatchingLastPageIndex = g_PagedMenuInstance.LastPageIndex === 2;
if (!g_bMatchingPageCount || !g_bMatchingLastPageIndex) {
	throw new Error("PagedMenu.GetMenuPageCount() did not account for the final partial page.");
}
```

### `PagedMenu.SelectMenuOption`

```js
const { PagedMenu, PagedMenuOption } = require("menus");
const { GetPlayerMenuQueue } = require("menus/queue");

const g_vecErrors = [];
let g_bMenuSendAttempted = false;
let g_strSelectedOption = null;

const g_PagedMenuInstance = new PagedMenu({
	ItemsPerPage: 1,
	SelectCallback(unPlayerIndex, ValueOption) {
		if (unPlayerIndex !== 1) {
			throw new Error("PagedMenu.SelectMenuOption() received an unexpected player index.");
		}

		g_strSelectedOption = ValueOption;
	},
	Title: "Destination",
});
g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption("Alpha", "alpha"));
g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption("Bravo", "bravo"));

try {
	g_bMenuSendAttempted = true;
	if (!g_PagedMenuInstance.SendMenu(1)) {
		throw new Error("PagedMenu.SendMenu() could not activate the navigation example.");
	}

	const bNextPageSelected = g_PagedMenuInstance.SelectMenuOption(1, g_PagedMenuInstance.NextChoiceIndex, 0);
	const bMatchingPlayerMenuPage = g_PagedMenuInstance.GetPlayerMenuPage(1) === 1;
	if (!bNextPageSelected || !bMatchingPlayerMenuPage) {
		throw new Error("PagedMenu.SelectMenuOption() did not navigate to the next page.");
	}

	const bOptionSelected = g_PagedMenuInstance.SelectMenuOption(1, 1, 1);
	if (!bOptionSelected || (g_strSelectedOption !== "bravo")) {
		throw new Error("PagedMenu.SelectMenuOption() did not dispatch the page-local option.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (g_bMenuSendAttempted) {
		try {
			const bHadQueueEntry = GetPlayerMenuQueue(1).HasMenu(g_PagedMenuInstance);
			const bQueueEntryRemoved = g_PagedMenuInstance.CloseMenu(1);
			if ((typeof bQueueEntryRemoved !== "boolean") || (bHadQueueEntry && !bQueueEntryRemoved)) {
				throw new Error("CloseMenu() did not confirm removal of the paged menu.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}

		try {
			if (g_PagedMenuInstance.PlayerMenuPages.has(1) || g_PagedMenuInstance.PlayerTokenRecords.has(1)) {
				if (g_PagedMenuInstance.CloseMenuForPlayer(1) !== undefined) {
					throw new Error("CloseMenuForPlayer() returned an undocumented value.");
				}
			}

			if (GetPlayerMenuQueue(1).HasMenu(g_PagedMenuInstance) || g_PagedMenuInstance.PlayerMenuPages.has(1) || g_PagedMenuInstance.PlayerTokenRecords.has(1)) {
				throw new Error("Paged menu cleanup left queue ownership or player state behind.");
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
	throw new AggregateError(g_vecErrors, "Paged selection and cleanup failed.");
}
```

### `PagedMenu.GetMenuOptions`

Like `BaseMenu.GetMenuOptions()`, this returns a new array containing shared option objects. It clamps the requested page to `LastPageIndex`; non-selectable options on that page are included, and plain `MenuText` rows are excluded.

```js
const { PagedMenu, PagedMenuOption } = require("menus");

const g_PagedMenuInstance = new PagedMenu({ ItemsPerPage: 2 });
for (const strOptionValue of ["one", "two", "three"]) {
	g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption(strOptionValue, strOptionValue));
}

const g_vecMenuOptions = g_PagedMenuInstance.GetMenuOptions(1);
if ((g_vecMenuOptions.length !== 1) || (g_vecMenuOptions[0].Value !== "three")) {
	throw new Error("PagedMenu.GetMenuOptions() did not return the requested page slice.");
}

const g_SharedOption = g_vecMenuOptions[0];
g_SharedOption.Text = "Updated third";
if (g_PagedMenuInstance.GetMenuOptions(1)[0].GetMenuText() !== "Updated third") {
	throw new Error("PagedMenu.GetMenuOptions() did not retain the shared option object.");
}

g_vecMenuOptions.pop();
if ((g_PagedMenuInstance.Length !== 3) || (g_PagedMenuInstance.GetMenuOptions(1)[0] !== g_SharedOption)) {
	throw new Error("PagedMenu.GetMenuOptions() returned the menu's live container instead of a new array.");
}
```

### `PagedMenu.SetPlayerPage`

```js
const { PagedMenu, PagedMenuOption } = require("menus");

const g_PagedMenuInstance = new PagedMenu({ ItemsPerPage: 1 });
g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption("One"));
g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption("Two"));
g_PagedMenuInstance.AppendMenuItem(new PagedMenuOption("Three"));

const g_bMatchingClampedPage = g_PagedMenuInstance.SetPlayerPage(1, 99) === 2;
const g_bMatchingRememberedPage = g_PagedMenuInstance.GetPlayerMenuPage(1) === 2;
if (!g_bMatchingClampedPage || !g_bMatchingRememberedPage) {
	throw new Error("PagedMenu.SetPlayerPage() did not clamp and remember the requested page.");
}
```

### `PagedMenu.ShouldCloseMenuAfterSelection`

```js
const { PagedMenu } = require("menus");

const g_PagedMenuInstance = new PagedMenu({ CloseOnSelection: true });
const g_vecNavigationChoiceIndexes = [g_PagedMenuInstance.BackChoiceIndex, g_PagedMenuInstance.NextChoiceIndex, g_PagedMenuInstance.CloseChoiceIndex];
if (g_vecNavigationChoiceIndexes.some((unChoiceIndex) => g_PagedMenuInstance.ShouldCloseMenuAfterSelection(unChoiceIndex, 0))) {
	throw new Error("PagedMenu.ShouldCloseMenuAfterSelection() tried to close after navigation.");
}

if (!g_PagedMenuInstance.ShouldCloseMenuAfterSelection(1, 0)) {
	throw new Error("PagedMenu.ShouldCloseMenuAfterSelection() ignored CloseOnSelection for an ordinary choice.");
}
```

### `MenuText.GetMenuText`

```js
const { MenuText } = require("menus");

const g_MenuTextInstance = new MenuText("{Name} is {State}; {Missing} stays visible");
const g_strRenderedMenuText = g_MenuTextInstance.GetMenuText(1, { Name: "Ren", State: "ready" });
if (g_strRenderedMenuText !== "Ren is ready; {Missing} stays visible") {
	throw new Error("MenuText.GetMenuText() did not replace owned tokens while preserving unknown placeholders.");
}
```

## Errors

Constructors and methods validate JavaScript-owned structure before calling the native menu transport:

- `TypeError` is thrown when a value has the wrong required type: options and token records must be non-null, non-array objects; `Items` must be an array; boolean options must be booleans; callbacks must be functions or `null`.
- JavaScript validation raises `RangeError` for an invalid player-index value, non-safe or below-minimum page/choice/count values, an empty target array, `ItemsPerPage < 1`, `unPageCount < 1`, or an insertion index that is not a safe nonnegative integer or exceeds `Length`. Native transport validation and availability checks can additionally throw their own errors.
- `SendMenu()` reports aggregate queue-admission or direct-send success; pending admission can succeed without an immediate native send. `SendMenuToPlayer()` returns the strict native transport boolean. `CloseMenu()` reports whether any queue entry was removed. `RefreshMenu()` reports whether at least one active resend succeeded, so it can return `false` while the menu is still active. These normal boolean outcomes do not replace exception handling or confirm visible client state.
- Exceptions raised by text functions or menu callbacks propagate to the caller that triggered rendering, selection, or closure.

```js
const { BaseMenu, MenuRenderData, PagedMenu } = require("menus");

const g_vecInvalidCallRecords = [
	{ Call: () => new BaseMenu({ Items: "not-an-array" }), ErrorType: TypeError },
	{ Call: () => new BaseMenu({ QueueEnabled: "yes" }), ErrorType: TypeError },
	{ Call: () => new BaseMenu().SendMenu([]), ErrorType: RangeError },
	{ Call: () => new BaseMenu().InsertMenuItem(1, "late"), ErrorType: RangeError },
	{ Call: () => new MenuRenderData("Title", "Message", 0, 0), ErrorType: RangeError },
	{ Call: () => new PagedMenu({ ItemsPerPage: 0 }), ErrorType: RangeError },
];
for (const { Call, ErrorType } of g_vecInvalidCallRecords) {
	let CaughtError = null;

	try {
		Call();
	} catch (CaughtCallError) {
		CaughtError = CaughtCallError;
	}

	if (!(CaughtError instanceof ErrorType)) {
		throw new Error(`The menus module raised ${CaughtError?.constructor?.name ?? "no error"} instead of ${ErrorType.name}.`);
	}
}
```

## Lifecycle

- `SendMenu()` with `QueueEnabled: true` creates or reuses one `MenuQueue` per target and registers `menuselect` on first use.
- `CloseMenu()` removes this menu from matching queues. Passing `null` closes it everywhere in the current plugin context.
- `SendMenuToPlayer()` and `SendMenu()` with `QueueEnabled: false` do not create queue ownership. Hide those dialogs explicitly with `menus.HideText()`. A failed send or callback exception can leave remembered page/token state. Attempt `CloseMenuForPlayer()` and the hide independently; retain the original failure and any cleanup failures, rethrowing one unchanged or combining several in operation order with `AggregateError`.
- `CloseMenuForPlayer()` clears only this menu's remembered page and player token record and invokes `CloseCallback`; it does not hide native text. `MenuQueue.RemoveMenu()` detaches its active owner before invoking it and still attempts the next menu after a close exception. If transition fails and no reentrant replacement owns the queue, removal attempts a best-effort native hide; a `false` hide result does not change the removal boolean. Do not call `CloseMenuForPlayer()` again after an active entry already closed successfully: that invokes the close callback twice. Removing only pending entries does not clear the menu's player maps; clean up residual state separately.
- Player token records are retained by reference in menu and queue state, including pending entries. Mutations affect later rendering, such as the next queued send or `RefreshMenu()`; removing a pending entry alone does not clear the menu's stored record.
- `ClearMenuItems()` removes item objects but does not close an already active menu. Call `RefreshMenu()` to display the empty menu or `CloseMenu()` to release queue ownership.
- Pass `null` to `RegisterMenuBuildCallback()`, `RegisterMenuCloseCallback()`, or `RegisterMenuSelectCallback()` to remove that callback. Close all queued menus and direct native text before plugin unload.

## Related modules

- [`menus`](menus.md) exposes the native `ShowText()` and `HideText()` transport.
- [`menus/queue`](menus-queue.md) owns per-player dispatch and `menuselect` routing.
- [`menus/esc`](menus-esc.md) adapts these objects to ESC menus.
- [`menus/radio`](menus-radio.md) adapts these objects to numbered radio menus.
