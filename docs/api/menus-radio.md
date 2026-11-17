# `require("menus/radio")`

> Warning: this reference is large for AI-agent processing, and radio slot numbers differ between classic and compact Source 1 SDK profiles. Use the runtime constants and the contents list instead of hardcoding one game's layout.

`menus/radio` builds Source 1 `ShowMenu` user messages controlled by number keys. It renders the selected SDK's slot layout, computes the native ten-bit valid-slot mask, and delegates transport to `messages.ShowMenu`: the bit-buffer backend splits long text, while the protobuf backend sends one field payload. It uses the shared queue from [`menus/queue`](menus-queue.md) for `menuselect` dispatch.

Radio menus require a connected client on a running server and cannot display in the game main menu. Queue-backed menus must be cleared when their plugin unloads. A direct `SendMenuToPlayer()` call has no queue ownership and must be paired with `CloseMenuForPlayer()`.

Closing validates and clears the old player state. When a player page was remembered, it attempts an empty zero-slot `ShowMenu` before attempting `CloseCallback`, including after a hide exception. This radio close helper performs no hide after the callback; queue-level replacement protection depends on the callback establishing an active queue owner. Neither normal completion nor empty JavaScript state confirms the visible client dialog state. One hide or callback failure is rethrown unchanged; both are retained in order with `AggregateError`. A boolean `false` hide result is not propagated. For teardown, prevent callbacks from reopening or enqueueing menus. The examples release only their own menu, tolerate an already-closed menu, and preserve both setup and cleanup failures.

## Contents

- [Import](#import)
- [Exports](#exports)
- [SDK profiles](#sdk-profiles)
- [Slot masks](#slot-masks)
- [Menu classes](#menu-classes)
- [Option classes](#option-classes)
- [Direct transport](#direct-transport)
- [Selection](#selection)
- [`SendRadioMenu`](#sendradiomenu)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	BUTTON_BACK,
	BUTTON_CLOSE,
	BUTTON_CLOSE_SLOT,
	BUTTON_NEXT,
	MAX_ITEM_COUNT,
	VALID_CHOICES,
	ListRadioMenu,
	ListRadioOption,
	PagedRadioMenu,
	PagedRadioOption,
	SimpleRadioMenu,
	SimpleRadioOption,
	ConvertRadioSlotsToBits,
	GetRadioProfile,
	SendRadioMenu,
} = require("menus/radio");

const g_vecRadioConstructors = [ListRadioMenu, ListRadioOption, PagedRadioMenu, PagedRadioOption, SimpleRadioMenu, SimpleRadioOption];
const g_vecRadioFunctions = [ConvertRadioSlotsToBits, GetRadioProfile, SendRadioMenu];
const g_bInvalidRadioConstructor = g_vecRadioConstructors.some((Constructor) => typeof Constructor !== "function");
const g_bInvalidRadioFunction = g_vecRadioFunctions.some((Callable) => typeof Callable !== "function");
if (g_bInvalidRadioConstructor || g_bInvalidRadioFunction) {
	throw new Error("The menus/radio module did not expose every documented callable.");
}

const g_RadioProfile = GetRadioProfile();
const g_bBackButtonMatches = BUTTON_BACK === g_RadioProfile.ButtonBack;
const g_bCloseButtonMatches = BUTTON_CLOSE === g_RadioProfile.ButtonClose;
const g_bCloseSlotMatches = BUTTON_CLOSE_SLOT === g_RadioProfile.ButtonCloseSlot;
if (!g_bBackButtonMatches || !g_bCloseButtonMatches || !g_bCloseSlotMatches) {
	throw new Error("The menus/radio constants do not match the selected SDK profile.");
}

const g_bNextButtonMatches = BUTTON_NEXT === g_RadioProfile.ButtonNext;
const g_bMaximumItemCountMatches = MAX_ITEM_COUNT === g_RadioProfile.MaxItemCount;
const g_bValidChoicesFrozen = Object.isFrozen(VALID_CHOICES);
if (!g_bNextButtonMatches || !g_bMaximumItemCountMatches || !g_bValidChoicesFrozen) {
	throw new Error("The menus/radio navigation exports do not match the selected SDK profile.");
}
```

## Exports

| Export | Kind | Constructor or signature |
| --- | --- | --- |
| `BUTTON_BACK` | selected-SDK constant | `8` classic, `7` compact |
| `BUTTON_CLOSE` | selected-SDK choice | `10` classic, `9` compact |
| `BUTTON_CLOSE_SLOT` | selected-SDK mask/display slot | `0` classic, `9` compact |
| `BUTTON_NEXT` | selected-SDK constant | `9` classic, `8` compact |
| `MAX_ITEM_COUNT` | selected-SDK constant | `7` classic, `6` compact |
| `VALID_CHOICES` | frozen array | `1..10` classic, `1..9` compact |
| [`ListRadioMenu`](#listradiomenu) | class | `new ListRadioMenu(Options = {})` |
| [`ListRadioOption`](#listradiooption) | class | `new ListRadioOption(OptionText = "", Options = {})` |
| [`PagedRadioMenu`](#pagedradiomenu) | class | `new PagedRadioMenu(Options = {})` |
| [`PagedRadioOption`](#pagedradiooption) | class | `new PagedRadioOption(OptionText = "", OptionValue = null, Options = {})` |
| [`SimpleRadioMenu`](#simpleradiomenu) | class | `new SimpleRadioMenu(Options = {})` |
| [`SimpleRadioOption`](#simpleradiooption) | class | `new SimpleRadioOption(unChoiceIndex, OptionText, OptionValue = null, Options = {})` |
| [`ConvertRadioSlotsToBits`](#convertradioslotstobits) | function | `ConvertRadioSlotsToBits(vecRadioSlots)` |
| `GetRadioProfile` | function | `GetRadioProfile(strSDKBranch?)` |
| [`SendRadioMenu`](#sendradiomenu) | function | `SendRadioMenu(TargetReferences, MenuTitle, vecRadioOptions, SelectionCallback = null, unDisplayTime = 10)` |

## SDK profiles

BMS and CSGO use the compact profile. Every other [supported Source 1 branch](../sdk-support.md) uses the classic profile. Source 2 and unknown branches throw instead of falling back to a classic layout.

```js
const {
	BUTTON_BACK,
	BUTTON_CLOSE,
	BUTTON_CLOSE_SLOT,
	BUTTON_NEXT,
	MAX_ITEM_COUNT,
	VALID_CHOICES,
	GetRadioProfile,
} = require("menus/radio");

const g_SelectedRadioProfile = GetRadioProfile();
const g_CompactRadioProfile = GetRadioProfile("csgo");
const g_ClassicRadioProfile = GetRadioProfile("sdk2013");

const g_bBackButtonMatches = BUTTON_BACK === g_SelectedRadioProfile.ButtonBack;
const g_bCloseButtonMatches = BUTTON_CLOSE === g_SelectedRadioProfile.ButtonClose;
const g_bCloseSlotMatches = BUTTON_CLOSE_SLOT === g_SelectedRadioProfile.ButtonCloseSlot;
if (!g_bBackButtonMatches || !g_bCloseButtonMatches || !g_bCloseSlotMatches) {
	throw new Error("Selected radio constants do not match GetRadioProfile().");
}

const g_bNextButtonMatches = BUTTON_NEXT === g_SelectedRadioProfile.ButtonNext;
const g_bMaximumItemCountMatches = MAX_ITEM_COUNT === g_SelectedRadioProfile.MaxItemCount;
if (!g_bNextButtonMatches || !g_bMaximumItemCountMatches) {
	throw new Error("Selected radio navigation does not match GetRadioProfile().");
}

const g_bValidChoicesMatch = VALID_CHOICES.join(",") === g_SelectedRadioProfile.ValidChoices.join(",");
const g_bValidChoicesFrozen = Object.isFrozen(VALID_CHOICES);
if (!g_bValidChoicesMatch || !g_bValidChoicesFrozen) {
	throw new Error("VALID_CHOICES does not match the selected radio profile.");
}

const g_bCompactCloseButtonMatches = g_CompactRadioProfile.ButtonClose === 9;
const g_bCompactCloseSlotMatches = g_CompactRadioProfile.ButtonCloseSlot === 9;
const g_bCompactItemCountMatches = g_CompactRadioProfile.MaxItemCount === 6;
if (!g_bCompactCloseButtonMatches || !g_bCompactCloseSlotMatches || !g_bCompactItemCountMatches) {
	throw new Error("GetRadioProfile() did not return the compact layout.");
}

const g_bClassicCloseButtonMatches = g_ClassicRadioProfile.ButtonClose === 10;
const g_bClassicCloseSlotMatches = g_ClassicRadioProfile.ButtonCloseSlot === 0;
const g_bClassicItemCountMatches = g_ClassicRadioProfile.MaxItemCount === 7;
if (!g_bClassicCloseButtonMatches || !g_bClassicCloseSlotMatches || !g_bClassicItemCountMatches) {
	throw new Error("GetRadioProfile() did not return the classic layout.");
}

const g_bFreshProfileObjectReturned = g_SelectedRadioProfile !== GetRadioProfile();
const g_bFreshValidChoicesArrayReturned = g_bFreshProfileObjectReturned && (g_SelectedRadioProfile.ValidChoices !== GetRadioProfile().ValidChoices);
if (!g_bFreshProfileObjectReturned || !g_bFreshValidChoicesArrayReturned) {
	throw new Error("GetRadioProfile() did not return fresh profile data.");
}
```

Each `GetRadioProfile()` call returns a fresh object with `ButtonBack`, `ButtonClose`, `ButtonCloseSlot`, `ButtonNext`, `MaxItemCount`, and `ValidChoices`. Omitting `strSDKBranch` selects the running server's SDK branch. Menu constructors also accept `SDKBranch`; normal plugins should omit it so formatting follows the running server. `SimpleRadioOption` validates its choice against the running server's profile, not a menu's override; `SimpleRadioMenu.BuildMenuRenderData()` additionally rejects duplicates, Close, or slots outside that menu's profile.

## Slot masks

### `ConvertRadioSlotsToBits`

`ShowMenu` maps display slots `1..9` to bit indices `0..8`, and display slot `0` to bit index `9`. Pass display slots from `0` through `9`; choice `10` uses display/mask slot `0` in the classic profile.

```js
const { BUTTON_CLOSE_SLOT, ConvertRadioSlotsToBits } = require("menus/radio");

const g_vecEnabledRadioSlots = [1, 2, BUTTON_CLOSE_SLOT];
const g_unValidSlotBits = ConvertRadioSlotsToBits(g_vecEnabledRadioSlots);
const g_unCloseSlotBitIndex = (BUTTON_CLOSE_SLOT === 0) ? 9 : (BUTTON_CLOSE_SLOT - 1);
const g_unExpectedSlotBits = (1 << 0) | (1 << 1) | (1 << g_unCloseSlotBitIndex);
const g_unMaximumValidSlotBits = 0x03FF;

const g_bExpectedSlotBitsEncoded = g_unValidSlotBits === g_unExpectedSlotBits;
const g_bValidSlotBitsInRange = (g_unValidSlotBits >= 0) && (g_unValidSlotBits <= g_unMaximumValidSlotBits);
if (!g_bExpectedSlotBitsEncoded || !g_bValidSlotBitsInRange) {
	throw new Error("ConvertRadioSlotsToBits() did not encode the selected display slots.");
}

const g_unDuplicateSlotBits = ConvertRadioSlotsToBits([...g_vecEnabledRadioSlots, 1, BUTTON_CLOSE_SLOT]);
if (g_unDuplicateSlotBits !== g_unValidSlotBits) {
	throw new Error("ConvertRadioSlotsToBits() did not ignore duplicate slots.");
}
```

`ConvertRadioSlotsToBits()` requires an array of Number integers, rejects slots outside `0..9`, and naturally ignores duplicate bits.

## Menu classes

### `SimpleRadioMenu`

`SimpleRadioMenu` extends `BaseMenu` and adds a `RadioProfile` field. It appends a Close row automatically and enables only selectable option slots plus Close.

Constructor options use `Title` and `Description`; the resulting menu stores them in `ValueTitle` and `ValueDescription`. Do not pass the stored field names as constructor option keys.

| Method | Behavior |
| --- | --- |
| `BuildMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {})` | returns `MenuRenderData` whose `MenuMessage` is the complete `ShowMenu` text and whose `ValidSlotBits` is the native bitmask |
| `CloseMenuForPlayer(PlayerReference)` | clears player state, attempts an empty zero-slot `ShowMenu` for a remembered page, then attempts `CloseCallback` even after a hide exception; returns `undefined`, ignores boolean `false`, and retains phase failures |
| `RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {})` | renders highlighted options as `-><choice>. <text>` |
| `SelectMenuOption(PlayerReference, unChoiceIndex, unPageIndex = 0)` | closes queue ownership for the profile's Close choice, otherwise selects an option |
| [`SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {})`](#simpleradiomenusendmenutoplayer) | sends one raw `ShowMenu` without creating queue ownership |
| `ShouldCloseMenuAfterSelection(unChoiceIndex, unPageIndex = 0)` | prevents duplicate queue close handling for Close |

```js
const { BUTTON_CLOSE, SimpleRadioMenu, SimpleRadioOption } = require("menus/radio");
const { GetPlayerMenuQueue } = require("menus/queue");

const g_SimpleRadioMenuInstance = new SimpleRadioMenu({
	Description: "Choose for {PlayerName}",
	Title: "Action menu",
});
const g_TokenRecord = { PlayerName: "Ren" };

g_SimpleRadioMenuInstance.AppendMenuItem(new SimpleRadioOption(1, "Apply", "apply"));
g_SimpleRadioMenuInstance.AppendMenuItem(new SimpleRadioOption(2, "Continue", "continue", { Highlighted: false }));

exports.Unload = () => {
	const Queue = GetPlayerMenuQueue(1);
	const vecErrors = [];

	try {
		const bHadQueueEntry = Queue.HasMenu(g_SimpleRadioMenuInstance);
		const bMenuClosed = g_SimpleRadioMenuInstance.CloseMenu(1);
		if ((typeof bMenuClosed !== "boolean") || (bHadQueueEntry && !bMenuClosed)) {
			throw new Error("SimpleRadioMenu did not confirm removal of its queue entry.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (Queue.HasMenu(g_SimpleRadioMenuInstance)) {
			throw new Error("SimpleRadioMenu still owns a queue entry; disable reopening callbacks before teardown.");
		}

		if (g_SimpleRadioMenuInstance.PlayerMenuPages.has(1) || g_SimpleRadioMenuInstance.PlayerTokenRecords.has(1)) {
			if (g_SimpleRadioMenuInstance.CloseMenuForPlayer(1) !== undefined) {
				throw new Error("SimpleRadioMenu.CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_SimpleRadioMenuInstance.PlayerMenuPages.has(1) || g_SimpleRadioMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("SimpleRadioMenu cleanup left remembered player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "SimpleRadioMenu cleanup failed.");
	}

	return true;
};

try {
	const bMenuSent = g_SimpleRadioMenuInstance.SendMenu(1, 0, g_TokenRecord);
	const bMenuActive = bMenuSent && g_SimpleRadioMenuInstance.IsActiveMenu(1);
	if (!bMenuSent || !bMenuActive) {
		throw new Error("SimpleRadioMenu could not activate its ShowMenu message.");
	}

	const bPlayerTokenRecordRetained = g_SimpleRadioMenuInstance.PlayerTokenRecords.get(1) === g_TokenRecord;
	const bRadioProfileSelected = g_SimpleRadioMenuInstance.RadioProfile.ButtonClose === BUTTON_CLOSE;
	if (!bPlayerTokenRecordRetained || !bRadioProfileSelected) {
		throw new Error("SimpleRadioMenu did not retain its player token record or selected radio profile.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("SimpleRadioMenu cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "SimpleRadioMenu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

Choice indexes must be unique option slots in the menu's `RadioProfile`. The running server's Close choice is rejected by `SimpleRadioOption`; rendering also rejects the menu profile's Close choice.

### `PagedRadioMenu`

`PagedRadioMenu` extends `PagedMenu`. It adds `RadioProfile`, `ValueTopSeparator`, and `ValueBottomSeparator`; defaults `Fill` to `true`; fixes Back/Next/Close to the profile; and limits `ItemsPerPage` to `RadioProfile.MaxItemCount`. Set the separators through the constructor's `TopSeparator` and `BottomSeparator` options, not the stored field names.

| Method | Behavior |
| --- | --- |
| `BuildMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {})` | renders page-local slots, separators, fill rows, navigation, Close, and `ValidSlotBits` |
| `CloseMenuForPlayer(PlayerReference)` | clears player state, attempts an empty zero-slot `ShowMenu` for a remembered page, then attempts `CloseCallback` even after a hide exception; returns `undefined`, ignores boolean `false`, and retains phase failures |
| `RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {})` | renders page choices, highlight arrows, and list enumeration |
| [`SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {})`](#pagedradiomenusendmenutoplayer) | sends the clamped page through `ShowMenu` |

```js
const { MAX_ITEM_COUNT, PagedRadioMenu, PagedRadioOption } = require("menus/radio");
const { GetPlayerMenuQueue } = require("menus/queue");

const g_PagedRadioMenuInstance = new PagedRadioMenu({
	BottomSeparator: "----------------",
	Description: "Choose a destination",
	ItemsPerPage: MAX_ITEM_COUNT,
	Title: "Destination vote",
	TopSeparator: "----------------",
});

for (let unDestinationIndex = 0; unDestinationIndex <= MAX_ITEM_COUNT; unDestinationIndex += 1) {
	const strDestinationName = `Destination ${unDestinationIndex + 1}`;
	g_PagedRadioMenuInstance.AppendMenuItem(new PagedRadioOption(strDestinationName, unDestinationIndex + 1));
}

exports.Unload = () => {
	const Queue = GetPlayerMenuQueue(1);
	const vecErrors = [];

	try {
		const bHadQueueEntry = Queue.HasMenu(g_PagedRadioMenuInstance);
		const bMenuClosed = g_PagedRadioMenuInstance.CloseMenu(1);
		if ((typeof bMenuClosed !== "boolean") || (bHadQueueEntry && !bMenuClosed)) {
			throw new Error("PagedRadioMenu did not confirm removal of its queue entry.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (Queue.HasMenu(g_PagedRadioMenuInstance)) {
			throw new Error("PagedRadioMenu still owns a queue entry; disable reopening callbacks before teardown.");
		}

		if (g_PagedRadioMenuInstance.PlayerMenuPages.has(1) || g_PagedRadioMenuInstance.PlayerTokenRecords.has(1)) {
			if (g_PagedRadioMenuInstance.CloseMenuForPlayer(1) !== undefined) {
				throw new Error("PagedRadioMenu.CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_PagedRadioMenuInstance.PlayerMenuPages.has(1) || g_PagedRadioMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("PagedRadioMenu cleanup left remembered player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "PagedRadioMenu cleanup failed.");
	}

	return true;
};

try {
	const bTwoPagesAvailable = g_PagedRadioMenuInstance.GetMenuPageCount() === 2;
	const bMenuSent = bTwoPagesAvailable && g_PagedRadioMenuInstance.SendMenu(1);
	const bMenuActive = bMenuSent && g_PagedRadioMenuInstance.IsActiveMenu(1);
	if (!bTwoPagesAvailable || !bMenuSent || !bMenuActive) {
		throw new Error("PagedRadioMenu could not activate its two-page ShowMenu message.");
	}

	const bMaximumItemCountMatches = g_PagedRadioMenuInstance.RadioProfile.MaxItemCount === MAX_ITEM_COUNT;
	const bTopSeparatorRetained = bMaximumItemCountMatches && (g_PagedRadioMenuInstance.ValueTopSeparator !== null);
	const bBottomSeparatorRetained = bTopSeparatorRetained && (g_PagedRadioMenuInstance.ValueBottomSeparator !== null);
	if (!bMaximumItemCountMatches || !bTopSeparatorRetained || !bBottomSeparatorRetained) {
		throw new Error("PagedRadioMenu did not retain its selected profile or separators.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("PagedRadioMenu cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "PagedRadioMenu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

Back and Next rows are always rendered but their slots are enabled only when navigation is possible. Close is always enabled. Classic menus display `0. Close` but receive choice `10`; compact menus display and receive `9`.

### `ListRadioMenu`

`ListRadioMenu` extends `PagedRadioMenu` and defaults `ItemsPerPage` to the active profile limit. `ListRadioOption` initializes `Value` to `null` and `Selectable` to `false`; its fields remain writable. Keep `Selectable` false when a visible row must not trigger `SelectCallback`.

```js
const { ListRadioMenu, ListRadioOption } = require("menus/radio");
const { GetPlayerMenuQueue } = require("menus/queue");

const g_ListRadioMenuInstance = new ListRadioMenu({ Title: "Session status" });
const g_PlayerStatusOption = g_ListRadioMenuInstance.AppendMenuItem(new ListRadioOption("Players: 8", { Enumerated: false }));
const g_GameModeOption = g_ListRadioMenuInstance.AppendMenuItem(new ListRadioOption("Mode: expert", { Enumerated: false }));
g_ListRadioMenuInstance.AppendMenuItem(new ListRadioOption("Ready check in progress"));

const g_bPlayerStatusOptionReadOnly = !g_PlayerStatusOption.Enumerated && !g_PlayerStatusOption.Selectable;
const g_bGameModeOptionReadOnly = !g_GameModeOption.Enumerated && !g_GameModeOption.Selectable;
if (!g_bPlayerStatusOptionReadOnly || !g_bGameModeOptionReadOnly) {
	throw new Error("ListRadioOption did not retain its read-only row state.");
}

exports.Unload = () => {
	const Queue = GetPlayerMenuQueue(1);
	const vecErrors = [];

	try {
		const bHadQueueEntry = Queue.HasMenu(g_ListRadioMenuInstance);
		const bMenuClosed = g_ListRadioMenuInstance.CloseMenu(1);
		if ((typeof bMenuClosed !== "boolean") || (bHadQueueEntry && !bMenuClosed)) {
			throw new Error("ListRadioMenu did not confirm removal of its queue entry.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	try {
		if (Queue.HasMenu(g_ListRadioMenuInstance)) {
			throw new Error("ListRadioMenu still owns a queue entry; disable reopening callbacks before teardown.");
		}

		if (g_ListRadioMenuInstance.PlayerMenuPages.has(1) || g_ListRadioMenuInstance.PlayerTokenRecords.has(1)) {
			if (g_ListRadioMenuInstance.CloseMenuForPlayer(1) !== undefined) {
				throw new Error("ListRadioMenu.CloseMenuForPlayer() returned an undocumented value.");
			}
		}

		if (g_ListRadioMenuInstance.PlayerMenuPages.has(1) || g_ListRadioMenuInstance.PlayerTokenRecords.has(1)) {
			throw new Error("ListRadioMenu cleanup left remembered player state behind.");
		}
	} catch (CaughtError) {
		vecErrors.push(CaughtError);
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "ListRadioMenu cleanup failed.");
	}

	return true;
};

try {
	const bMenuSent = g_ListRadioMenuInstance.SendMenu(1);
	const bMenuActive = bMenuSent && g_ListRadioMenuInstance.IsActiveMenu(1);
	if (!bMenuSent || !bMenuActive) {
		throw new Error("ListRadioMenu could not activate its status message.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("ListRadioMenu cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "ListRadioMenu setup and cleanup failed.");
	}

	throw CaughtError;
}
```

## Option classes

### `SimpleRadioOption`

`SimpleRadioOption` extends `SimpleMenuOption`. `Highlighted: true` adds the `->` text marker, while `Selectable: false` leaves the row visible but omits its bit from `ValidSlotBits`.

```js
const { BUTTON_CLOSE_SLOT, SimpleRadioMenu, SimpleRadioOption, ConvertRadioSlotsToBits } = require("menus/radio");

const g_SimpleRadioMenuInstance = new SimpleRadioMenu({ Title: "Difficulty" });
g_SimpleRadioMenuInstance.AppendMenuItem(new SimpleRadioOption(1, "Expert", "impossible"));
g_SimpleRadioMenuInstance.AppendMenuItem(new SimpleRadioOption(2, "Strict", "strict", { Selectable: false }));

const g_RenderData = g_SimpleRadioMenuInstance.BuildMenuRenderData(1);
const g_strRenderedFirstMenuItem = g_SimpleRadioMenuInstance.RenderMenuItem(g_SimpleRadioMenuInstance.Items[0], 1);
if (g_strRenderedFirstMenuItem !== "->1. Expert") {
	throw new Error("SimpleRadioOption did not render its highlighted choice marker.");
}

const g_bDisabledOptionRendered = g_RenderData.MenuMessage.includes("->2. Strict");
let g_bValidSlotBitsMatch = false;
if (g_bDisabledOptionRendered) {
	const unExpectedValidSlotBits = ConvertRadioSlotsToBits([1, BUTTON_CLOSE_SLOT]);
	g_bValidSlotBitsMatch = g_RenderData.ValidSlotBits === unExpectedValidSlotBits;
}

if (!g_bDisabledOptionRendered || !g_bValidSlotBitsMatch) {
	throw new Error("SimpleRadioMenu did not omit the disabled option from ValidSlotBits.");
}
```

### `PagedRadioOption`

`PagedRadioOption` extends `PagedMenuOption`. Its `ChoiceIndex` is assigned from its position on the currently built page.

```js
const { PagedRadioMenu, PagedRadioOption, ConvertRadioSlotsToBits } = require("menus/radio");

const g_PagedRadioMenuInstance = new PagedRadioMenu({ ItemsPerPage: 1, Title: "Destinations" });
g_PagedRadioMenuInstance.AppendMenuItem(new PagedRadioOption("Alpha", "alpha"));

const g_SecondRadioOption = g_PagedRadioMenuInstance.AppendMenuItem(new PagedRadioOption("Bravo", "bravo"));
const g_SecondPageMenuRenderData = g_PagedRadioMenuInstance.BuildMenuRenderData(1, 1);
const g_RadioProfile = g_PagedRadioMenuInstance.RadioProfile;
const g_unExpectedValidSlotBits = ConvertRadioSlotsToBits([1, g_RadioProfile.ButtonBack, g_RadioProfile.ButtonCloseSlot]);
const g_bSecondPageRendered = g_SecondPageMenuRenderData.PageIndex === 1;
const g_bPageLocalChoiceAssigned = g_bSecondPageRendered && (g_SecondRadioOption.ChoiceIndex === 1);
if (!g_bSecondPageRendered || !g_bPageLocalChoiceAssigned) {
	throw new Error("PagedRadioOption did not receive its page-local choice.");
}

const g_bExpectedValidSlotBitsEnabled = g_SecondPageMenuRenderData.ValidSlotBits === g_unExpectedValidSlotBits;
const g_bTwoPagesRendered = g_bExpectedValidSlotBitsEnabled && (g_SecondPageMenuRenderData.PageCount === 2);
if (!g_bExpectedValidSlotBitsEnabled || !g_bTwoPagesRendered) {
	throw new Error("PagedRadioMenu did not enable the second-page option, Back, and Close slots.");
}
```

### `ListRadioOption`

`ListRadioOption` accepts boolean `Enumerated` and `Highlighted` options. It initializes `Value` to `null` and `Selectable` to `false`; these fields remain writable. Keep `Selectable` false for a non-selectable display row.

```js
const { ListRadioMenu, ListRadioOption } = require("menus/radio");

const g_StatusRadioOption = new ListRadioOption("State: active", { Enumerated: false, Highlighted: false });
const g_ListRadioMenuInstance = new ListRadioMenu({ Title: "Session" });
g_ListRadioMenuInstance.AppendMenuItem(g_StatusRadioOption);

const g_strRenderedStatusOption = g_ListRadioMenuInstance.RenderMenuItem(g_StatusRadioOption, 1);
if (g_strRenderedStatusOption !== "State: active") {
	throw new Error("ListRadioOption did not omit its enumeration and highlight marker.");
}

const g_bNullOptionValue = g_StatusRadioOption.Value === null;
const g_bOptionNotSelectable = g_bNullOptionValue && !g_StatusRadioOption.Selectable;
const g_bOptionNotEnumerated = g_bOptionNotSelectable && !g_StatusRadioOption.Enumerated;
const g_bOptionNotHighlighted = g_bOptionNotEnumerated && !g_StatusRadioOption.Highlighted;
if (!g_bNullOptionValue || !g_bOptionNotSelectable || !g_bOptionNotEnumerated || !g_bOptionNotHighlighted) {
	throw new Error("ListRadioOption did not retain its read-only display state.");
}
```

## Direct transport

### `SimpleRadioMenu.SendMenuToPlayer`

```js
const { SimpleRadioMenu, SimpleRadioOption } = require("menus/radio");

const g_SimpleRadioMenuInstance = new SimpleRadioMenu({ QueueEnabled: false, Timeout: 8, Title: "Private vote" });
g_SimpleRadioMenuInstance.AppendMenuItem(new SimpleRadioOption(1, "Accept", true));

const g_vecErrors = [];

try {
	if (!g_SimpleRadioMenuInstance.SendMenuToPlayer(1)) {
		throw new Error("SimpleRadioMenu.SendMenuToPlayer() could not send ShowMenu.");
	}

	const bMenuPageRetained = g_SimpleRadioMenuInstance.PlayerMenuPages.get(1) === 0;
	const bPlayerTokenRecordRetained = bMenuPageRetained && g_SimpleRadioMenuInstance.PlayerTokenRecords.has(1);
	if (!bMenuPageRetained || !bPlayerTokenRecordRetained) {
		throw new Error("SimpleRadioMenu.SendMenuToPlayer() did not retain direct player state.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
}

try {
	if (g_SimpleRadioMenuInstance.CloseMenuForPlayer(1) !== undefined) {
		throw new Error("SimpleRadioMenu.CloseMenuForPlayer() returned an undocumented value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
}

if (g_SimpleRadioMenuInstance.PlayerMenuPages.has(1) || g_SimpleRadioMenuInstance.PlayerTokenRecords.has(1)) {
	g_vecErrors.push(new Error("SimpleRadioMenu.CloseMenuForPlayer() left direct player state behind."));
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "SimpleRadioMenu direct send and cleanup failed.");
}
```

### `PagedRadioMenu.SendMenuToPlayer`

```js
const { PagedRadioMenu, PagedRadioOption } = require("menus/radio");

const g_TokenRecord = { Mode: "current" };
const g_PagedRadioMenuInstance = new PagedRadioMenu({
	Description: "Mode: {Mode}",
	ItemsPerPage: 1,
	QueueEnabled: false,
	Title: "Destinations",
});
g_PagedRadioMenuInstance.AppendMenuItem(new PagedRadioOption("Alpha"));
g_PagedRadioMenuInstance.AppendMenuItem(new PagedRadioOption("Bravo"));

const g_vecErrors = [];

try {
	const unRequestedPageIndex = 99;
	if (!g_PagedRadioMenuInstance.SendMenuToPlayer(1, unRequestedPageIndex, g_TokenRecord)) {
		throw new Error("PagedRadioMenu.SendMenuToPlayer() could not send ShowMenu.");
	}

	const bLastMenuPageSelected = g_PagedRadioMenuInstance.GetPlayerMenuPage(1) === 1;
	const bPlayerTokenRecordRetained = bLastMenuPageSelected && (g_PagedRadioMenuInstance.GetPlayerTokenRecord(1) === g_TokenRecord);
	if (!bLastMenuPageSelected || !bPlayerTokenRecordRetained) {
		throw new Error("PagedRadioMenu.SendMenuToPlayer() did not clamp the page or retain its player token record.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
}

try {
	if (g_PagedRadioMenuInstance.CloseMenuForPlayer(1) !== undefined) {
		throw new Error("PagedRadioMenu.CloseMenuForPlayer() returned an undocumented value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
}

if (g_PagedRadioMenuInstance.PlayerMenuPages.has(1) || g_PagedRadioMenuInstance.PlayerTokenRecords.has(1)) {
	g_vecErrors.push(new Error("PagedRadioMenu.CloseMenuForPlayer() left direct player state behind."));
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "PagedRadioMenu direct send and cleanup failed.");
}
```

Both `SendMenuToPlayer()` methods store the exact player token record before building and sending. Paged sends clamp the page before assigning choices. Close every attempted direct send, including a `false` result or an exception: retained state may already exist. The examples attempt closing and check residual state after catching the send failure; one failure is rethrown unchanged and multiple failures are retained in order. Disable reopening callbacks before this teardown. `CloseMenu()` cannot remove a direct send because no queue entry exists.

## Selection

```js
const { BUTTON_NEXT, PagedRadioMenu, PagedRadioOption } = require("menus/radio");
const { GetPlayerMenuQueue } = require("menus/queue");

let g_strSelectedDestination = null;

const g_PagedRadioMenuInstance = new PagedRadioMenu({
	ItemsPerPage: 1,
	SelectCallback(unPlayerIndex, ValueSelectedOption) {
		if (unPlayerIndex !== 1) {
			throw new Error("PagedRadioMenu.SelectMenuOption() received an unexpected player index.");
		}

		g_strSelectedDestination = ValueSelectedOption;
	},
	Title: "Navigation",
});
g_PagedRadioMenuInstance.AppendMenuItem(new PagedRadioOption("Page one", "first"));
g_PagedRadioMenuInstance.AppendMenuItem(new PagedRadioOption("Page two", "second"));

const g_vecErrors = [];

try {
	if (!g_PagedRadioMenuInstance.SendMenu(1)) {
		throw new Error("PagedRadioMenu could not activate the navigation example.");
	}

	const bNextChoiceSelected = g_PagedRadioMenuInstance.SelectMenuOption(1, BUTTON_NEXT, 0);
	const bSecondMenuPageActive = bNextChoiceSelected && (g_PagedRadioMenuInstance.GetPlayerMenuPage(1) === 1);
	if (!bNextChoiceSelected || !bSecondMenuPageActive) {
		throw new Error("PagedRadioMenu.SelectMenuOption() did not advance to the second page.");
	}

	const bSecondDestinationSelected = g_PagedRadioMenuInstance.SelectMenuOption(1, 1, 1);
	const bSecondDestinationDispatched = bSecondDestinationSelected && (g_strSelectedDestination === "second");
	if (!bSecondDestinationSelected || !bSecondDestinationDispatched) {
		throw new Error("PagedRadioMenu.SelectMenuOption() did not dispatch the page-local value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
}

const g_Queue = GetPlayerMenuQueue(1);

try {
	const bHadQueueEntry = g_Queue.HasMenu(g_PagedRadioMenuInstance);
	const bMenuClosed = g_PagedRadioMenuInstance.CloseMenu(1);
	if ((typeof bMenuClosed !== "boolean") || (bHadQueueEntry && !bMenuClosed)) {
		throw new Error("Navigation cleanup did not confirm removal of its queue entry.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
}

try {
	if (g_Queue.HasMenu(g_PagedRadioMenuInstance)) {
		throw new Error("Navigation menu still owns a queue entry; disable reopening callbacks before teardown.");
	}

	if (g_PagedRadioMenuInstance.PlayerMenuPages.has(1) || g_PagedRadioMenuInstance.PlayerTokenRecords.has(1)) {
		if (g_PagedRadioMenuInstance.CloseMenuForPlayer(1) !== undefined) {
			throw new Error("Navigation CloseMenuForPlayer() returned an undocumented value.");
		}
	}

	if (g_PagedRadioMenuInstance.PlayerMenuPages.has(1) || g_PagedRadioMenuInstance.PlayerTokenRecords.has(1)) {
		throw new Error("Navigation cleanup left remembered player state behind.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Radio navigation and cleanup failed.");
}
```

Calling `SelectMenuOption()` directly is useful for custom transports and tests, but ordinary plugins should let the queue's registered `menuselect` handler apply post-selection closing. The example releases only its own menu and retains selection and cleanup failures without closing a replacement that acquired queue ownership. If the original menu still owns a queue entry after removal, teardown reports that state rather than closing it again.

## `SendRadioMenu`

`SendRadioMenu()` builds a queue-backed `SimpleRadioMenu`. Array entries may be text values, `PagedRadioOption` objects, or objects with `Text`, `Value`, `Highlighted`, and `Selectable`. The callback receives `(unPlayerIndex, ValueSelectedOption, SelectedOption, RadioMenu)`.

```js
const { CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { ClearMenuQueue } = require("menus/queue");
const { SendRadioMenu } = require("menus/radio");

const g_setActivePlayerIndexes = new Set();
const g_mapPlayerSelections = new Map();
let g_bVoteCommandRegistered = false;

function HandleReadyVoteSelection(unPlayerIndex, ValueSelectedOption, SelectedOption, RadioMenu) {
	const bOptionValueMatches = SelectedOption.Value === ValueSelectedOption;
	const bMenuTitleMatches = bOptionValueMatches && (RadioMenu.ValueTitle === "Ready?");
	if (!bOptionValueMatches || !bMenuTitleMatches) {
		throw new Error("SendRadioMenu() callback received an unexpected item or menu.");
	}

	g_mapPlayerSelections.set(unPlayerIndex, ValueSelectedOption);
}

function GetPlayerSelection(unPlayerIndex) {
	return g_mapPlayerSelections.get(unPlayerIndex);
}

function ClearReadyVote(unPlayerIndex) {
	if (ClearMenuQueue(unPlayerIndex) !== undefined) {
		throw new Error(`ClearMenuQueue returned an undocumented value PlayerIndex=${unPlayerIndex}.`);
	}

	g_setActivePlayerIndexes.delete(unPlayerIndex);
	g_mapPlayerSelections.delete(unPlayerIndex);
}

function OpenReadyVote(Command) {
	g_setActivePlayerIndexes.add(Command.Index);

	try {
		const unVoteDisplayTime = 10;
		const bReadyVoteSent = SendRadioMenu(Command.Index, "Ready?", [
			{ Text: "Yes", Value: true },
			{ Text: "No", Value: false },
		], HandleReadyVoteSelection, unVoteDisplayTime);
		if (!bReadyVoteSent) {
			throw new Error("SendRadioMenu() could not queue the ready vote.");
		}
	} catch (CaughtError) {
		try {
			ClearReadyVote(Command.Index);
		} catch (CleanupError) {
			throw new AggregateError([CaughtError, CleanupError], "Ready vote send and cleanup failed.");
		}

		throw CaughtError;
	}

	return CommandReturn.Handled;
}

function UnloadPlugin() {
	const vecErrors = [];

	if (g_bVoteCommandRegistered) {
		try {
			if (UnregisterCommand("sjs_ready_vote", OpenReadyVote) !== true) {
				throw new Error("UnregisterCommand could not release sjs_ready_vote.");
			}

			g_bVoteCommandRegistered = false;
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}
	}

	for (const unActivePlayerIndex of [...g_setActivePlayerIndexes]) {
		try {
			ClearReadyVote(unActivePlayerIndex);
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "Ready vote unload failed.");
	}

	return true;
}

exports.GetPlayerSelection = GetPlayerSelection;
exports.Unload = UnloadPlugin;

if (RegisterCommand("sjs_ready_vote", OpenReadyVote) !== true) {
	throw new Error("RegisterCommand() could not register sjs_ready_vote.");
}

g_bVoteCommandRegistered = true;
```

`SendRadioMenu()` reserves the profile's Close choice, so it accepts at most `BUTTON_CLOSE - 1` options. It returns no menu handle: this command example deliberately owns the entire queue for each tracked player in the current plugin context, including on send failure; do not use this cleanup where another menu workflow in that context shares the queue. Unload attempts command unregistration first, then independently clears a snapshot of every tracked target. Failed releases retain their bookkeeping for an explicit retry; successful releases are not repeated. One failure is rethrown unchanged and multiple failures are retained in order. Stop close callbacks from enqueueing during teardown; a successful logical release does not prove native dialog hiding succeeded.

## Errors

- `TypeError` is thrown when `GetRadioProfile()` receives an explicit value other than a non-empty string, `ConvertRadioSlotsToBits()` or `SendRadioMenu()` receives a non-array value, menu options or player token records are not object records, or `ListRadioOption`/`SendRadioMenu()` option flags are not booleans. Omitting the SDK branch (or passing `undefined`) selects the current branch.
- JavaScript validation raises `RangeError` for an unsupported SDK branch, a slot outside `0..9`, an invalid player/page/timeout value, a reserved or duplicated simple choice, too many page items, or too many `SendRadioMenu()` options. Native transport validation and availability checks can additionally raise their own errors.
- A boolean `false` from `ShowMenu.SendUserMessage()` is returned by an immediate `SendMenu()`/`SendMenuToPlayer()`; a queued append can return `true` before its eventual send. Transport exceptions and non-boolean results propagate instead. Neither a `false` result nor an exception guarantees that queue or per-menu state was rolled back.
- Text-renderer and callback exceptions propagate through the menu or queue operation that triggered them.

```js
const {
	BUTTON_CLOSE,
	MAX_ITEM_COUNT,
	ListRadioOption,
	PagedRadioMenu,
	SimpleRadioMenu,
	SimpleRadioOption,
	ConvertRadioSlotsToBits,
	GetRadioProfile,
	SendRadioMenu,
} = require("menus/radio");

const g_DuplicateChoiceMenu = new SimpleRadioMenu();
g_DuplicateChoiceMenu.AppendMenuItem(new SimpleRadioOption(1, "First"));
g_DuplicateChoiceMenu.AppendMenuItem(new SimpleRadioOption(1, "Duplicate"));

const g_vecInvalidCallCases = [
	[() => GetRadioProfile(""), TypeError],
	[() => GetRadioProfile("unsupported-source-branch"), RangeError],
	[() => ConvertRadioSlotsToBits("1,2"), TypeError],
	[() => ConvertRadioSlotsToBits([10]), RangeError],
	[() => new ListRadioOption("Status", { Enumerated: "no" }), TypeError],
	[() => new PagedRadioMenu({ ItemsPerPage: MAX_ITEM_COUNT + 1 }), RangeError],
	[() => new SimpleRadioOption(BUTTON_CLOSE, "Reserved"), RangeError],
	[() => g_DuplicateChoiceMenu.BuildMenuRenderData(1), RangeError],
	[() => SendRadioMenu(1, "Title", "not-an-array"), TypeError],
	[() => SendRadioMenu(1, "Title", new Array(BUTTON_CLOSE).fill("Option")), RangeError],
];
for (const vecInvalidCallCase of g_vecInvalidCallCases) {
	const Call = vecInvalidCallCase[0];
	const ErrorType = vecInvalidCallCase[1];
	let ReceivedError = null;

	try {
		Call();
	} catch (CaughtError) {
		ReceivedError = CaughtError;
	}

	if (!(ReceivedError instanceof ErrorType)) {
		let strReceivedErrorName = "no error";
		if (ReceivedError !== null) {
			strReceivedErrorName = ReceivedError.constructor.name;
		}

		throw new Error(`The menus/radio module raised ${strReceivedErrorName} instead of ${ErrorType.name}.`);
	}
}
```

## Lifecycle

- `BUTTON_CLOSE` is the `menuselect` choice; `BUTTON_CLOSE_SLOT` is the displayed/mask slot. They differ on classic branches.
- Pass display slots `0..9`, not choice `10`, to `ConvertRadioSlotsToBits()`.
- For actual sends, use the running server's profile. An explicit `SDKBranch` override can exercise formatting or validation in tests, but does not change the server's native SDK or transport backend.
- Duplicate simple choice indexes and profile-reserved Close choices throw during rendering.
- `ItemsPerPage` cannot exceed the selected profile's `MaxItemCount`.
- With `QueueEnabled: true`, `SendMenu()` creates or reuses queue ownership; remove it during unload. With `QueueEnabled: false`, it sends directly, like raw `SendMenuToPlayer()`. Close direct sends with `CloseMenuForPlayer()` because `CloseMenu()` cannot find them.
- `CloseMenuForPlayer()` attempts an empty zero-slot `ShowMenu` only when that menu remembered a player page. It then attempts `CloseCallback`, even if hiding threw. It returns `undefined` on normal completion and ignores boolean `false` hide results. A sole failure is rethrown unchanged; hide and callback failures are retained in order. Old state is cleared first, and this helper performs no hide after the callback. Queue-level replacement protection additionally requires an active queue owner; JavaScript state and return values are not client-display confirmations.
- `SendRadioMenu()` returns no menu object. If the current plugin workflow owns the entire player queue, retain its target indexes and clear each queue during unload. `ClearMenuQueue()` affects all menus in that queue, not only this convenience call; use an explicitly constructed menu when selective cleanup is required.
- Radio menus have no recipient in the game main menu.

## Related modules

- [`menus`](menus-objects.md) provides menu objects, callbacks, pages, and player token record state.
- [`menus/queue`](menus-queue.md) owns queued `menuselect` dispatch.
- [`messages`](messages-types.md) exposes the lower-level `ShowMenu` message class.
- [`globals`](globals.md) supplies the selected SDK branch through `GetGlobalVariables().SDKBranch`, which `GetRadioProfile()` uses by default.
