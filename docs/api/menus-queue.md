# `require("menus/queue")`

> Warning: this reference is large for AI-agent processing and exposes live queue internals as well as supported mutation methods. Use the contents list and do not mutate queue fields directly.

`menus/queue` serializes menu ownership for each player in the current plugin context. One menu is active, later menus wait in order, and the shared `menuselect` client command dispatches choices to the active menu. Menu classes from [`menus`](menus-objects.md), [`menus/esc`](menus-esc.md), and [`menus/radio`](menus-radio.md) use this module through `BaseMenu.SendMenu()`.

A queue only becomes useful for a connected server-side player. Queue objects may exist before a map, but sending reaches the selected SDK's native dialog transport and therefore requires a connected client. Clear queue ownership before plugin unload and separately clean up residual per-menu or direct-send state. An empty queue or a normal cleanup result confirms JavaScript queue state, not that the client hid its native dialog.

Sending can establish active or pending state before returning `false` or throwing. The examples with `exports.Unload` retain menus after successful setup and call that same cleanup on setup failure. They require a successful cleanup result and preserve both failures if cleanup also throws. Do not treat a failed send as proof that the queue is empty.

## Contents

- [Import](#import)
- [Exports](#exports)
- [`MenuQueue`](#menuqueue)
- [Canonical queue](#canonical-queue)
- [Enqueueing](#enqueueing)
- [Replacing](#replacing)
- [Immediate send](#immediate-send)
- [Selection](#selection)
- [Membership](#membership)
- [Closing](#closing)
- [Command registration](#command-registration)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	MenuQueue,
	ClearMenuQueue,
	CloseActivePlayerMenu,
	GetPlayerMenuQueue,
	ListPlayerMenuQueues,
	RegisterMenuSelectCommand,
} = require("menus/queue");

const g_vecQueueFunctions = [ClearMenuQueue, CloseActivePlayerMenu, GetPlayerMenuQueue, ListPlayerMenuQueues, RegisterMenuSelectCommand];

if (typeof MenuQueue !== "function") {
	throw new Error("The menus/queue module did not expose MenuQueue.");
}

if (g_vecQueueFunctions.some((QueueFunction) => typeof QueueFunction !== "function")) {
	throw new Error("The menus/queue module did not expose every documented function.");
}
```

## Exports

| Export | Kind | Constructor or signature |
| --- | --- | --- |
| [`MenuQueue`](#menuqueue) | class | `new MenuQueue(PlayerReference)` |
| `ClearMenuQueue` | function | `ClearMenuQueue(PlayerReference)` |
| `CloseActivePlayerMenu` | function | `CloseActivePlayerMenu(PlayerReference)` |
| `GetPlayerMenuQueue` | function | `GetPlayerMenuQueue(PlayerReference)` |
| `ListPlayerMenuQueues` | function | `ListPlayerMenuQueues()` |
| [`RegisterMenuSelectCommand`](#registermenuselectcommand) | function | `RegisterMenuSelectCommand()` |

`new MenuQueue(PlayerReference)` and `GetPlayerMenuQueue(PlayerReference)` return the same canonical object for that player. Player references accept a positive safe integer or an object whose `Index` field contains such an integer. `ListPlayerMenuQueues()` returns a live `Map` value iterator over every canonical queue created in this plugin context, including queues that are currently empty. Queues added after iterator creation remain visible until that iterator is exhausted.

## `MenuQueue`

### State

| Field | Meaning |
| --- | --- |
| `PlayerIndex` | immutable-by-contract player index supplied to the constructor |
| `PendingMenuEntries` | pending `{ Menu, PageIndex, PlayerTokenRecord }` entries in send order |
| `ActiveMenu` | active menu object or `null` |
| `ActivePageIndex` | page requested for the active menu |
| `ActivePlayerTokenRecord` | exact player token record retained by reference for the active entry |
| `Length` | active entry plus pending entry count |

Treat `PendingMenuEntries` and the active fields as live inspection state. Use the methods below for mutation so duplicate detection, callbacks, native hiding, and `menuselect` ownership remain consistent.

### Methods

| Method | Result |
| --- | --- |
| `AppendMenu(MenuObject, unPageIndex = 0, TokenRecord = {})` | adds at the right; sends immediately when idle |
| `AppendMenus(vecMenuObjects, unPageIndex = 0, TokenRecord = {})` | appends an array of unique menu objects |
| `ClearMenuQueue()` | drops pending entries without calling their close methods; if active, detaches that menu and attempts hiding even if its close callback throws, unless a new active owner exists; returns `undefined` |
| `CloseActiveMenu()` | closes the active menu, advances unless its close callback opened a menu, and returns whether one was active |
| `HasMenu(MenuObject)` | whether the exact menu object is active or pending |
| `PrependMenu(MenuObject, unPageIndex = 0, TokenRecord = {})` | adds at the left; sends immediately when idle |
| `PrependMenus(vecMenuObjects, unPageIndex = 0, TokenRecord = {})` | prepends an array of unique menu objects in deque order |
| `RefreshActiveMenu()` | returns the active resend's strict boolean result, or `false` when idle; a `false` resend does not remove the active owner |
| `RemoveMenu(MenuObject)` | removes the exact active or pending menu; pending-only removal does not call its close method or clear its player maps; active removal still attempts transition after a close exception without replacing a reentrant owner |
| `ReplaceMenu(unPositionIndex, MenuObject, unPageIndex = 0, TokenRecord = {})` | replaces an active or pending position; returns `false` for a position beyond queue bounds or a duplicate menu; invalid argument types/ranges throw |
| `SelectMenuOption(unChoiceIndex)` | dispatches a choice and applies post-selection queue closing |
| `SendMenu(MenuObject, unPageIndex = 0, TokenRecord = {})` | activates immediately, closing a different active menu and removing duplicate pending entries |
| `SendNextMenu()` | validates and sends the next pending entry; with no pending entry, resets the active fields and returns `false` without closing or hiding a previously active menu |

Menus are compared by object identity. Re-appending the same menu returns success without changing its existing page or player-token entry. Player token records are retained by reference.

`ClearMenuQueue()` drops the original pending entries without calling their close methods or clearing their menu-local player maps. If a menu was active, it is detached before its close callback; active and pending menus created by that callback survive, including when it then throws. With no new active owner, hiding is best-effort: native `false` does not change the `undefined` result. An initially idle queue does not attempt native hiding. A sole close or hide exception is rethrown unchanged; failures from both phases are combined in order with `AggregateError`.

## Canonical queue

### `MenuQueue`, `GetPlayerMenuQueue`, and `ListPlayerMenuQueues`

```js
const { GetPlayerMenuQueue, ListPlayerMenuQueues, MenuQueue } = require("menus/queue");

const g_ConstructedMenuQueue = new MenuQueue(1);
const g_LookedUpMenuQueue = GetPlayerMenuQueue({ Index: 1 });

const g_itPlayerMenuQueues = ListPlayerMenuQueues();
const g_LaterMenuQueue = new MenuQueue(2);
let g_bFoundConstructedMenuQueue = false;
let g_bFoundLaterMenuQueue = false;

for (const PlayerMenuQueue of g_itPlayerMenuQueues) {
	if (PlayerMenuQueue === g_ConstructedMenuQueue) {
		g_bFoundConstructedMenuQueue = true;
	}

	if (PlayerMenuQueue === g_LaterMenuQueue) {
		g_bFoundLaterMenuQueue = true;
	}
}

if ((g_ConstructedMenuQueue !== g_LookedUpMenuQueue) || !g_bFoundConstructedMenuQueue) {
	throw new Error("MenuQueue construction and lookup did not resolve the canonical queue.");
}

if (!g_bFoundLaterMenuQueue || (g_ConstructedMenuQueue.Length !== 0)) {
	throw new Error("ListPlayerMenuQueues() did not retain live iteration over a later queue.");
}
```

Constructing the class directly is safe: subsequent `menuselect` dispatch resolves the same canonical queue.

## Enqueueing

### `MenuQueue.AppendMenu` and `MenuQueue.PrependMenu`

```js
const { SimpleMenu } = require("menus");
const { ClearMenuQueue, GetPlayerMenuQueue } = require("menus/queue");

const g_MenuQueueInstance = GetPlayerMenuQueue(1);
const g_StatusMenu = new SimpleMenu({ Title: "Status" });
const g_VoteMenu = new SimpleMenu({ Title: "Vote" });
const g_WarningMenu = new SimpleMenu({ Title: "Urgent warning" });

exports.Unload = () => {
	if ((ClearMenuQueue(1) !== undefined) || (g_MenuQueueInstance.Length !== 0)) {
		throw new Error("ClearMenuQueue() did not release the append example.");
	}

	return true;
};

try {
	const bStatusMenuAppended = g_MenuQueueInstance.AppendMenu(g_StatusMenu, 0, { Source: "status" });
	const bVoteMenuAppended = bStatusMenuAppended && g_MenuQueueInstance.AppendMenu(g_VoteMenu, 0, { Source: "vote" });
	const bWarningMenuPrepended = bVoteMenuAppended && g_MenuQueueInstance.PrependMenu(g_WarningMenu, 0, { Source: "admin" });
	if (!bStatusMenuAppended || !bVoteMenuAppended || !bWarningMenuPrepended) {
		throw new Error("MenuQueue could not prepare the append/prepend example.");
	}

	if ((g_MenuQueueInstance.ActiveMenu !== g_StatusMenu) || (g_MenuQueueInstance.Length !== 3)) {
		throw new Error("MenuQueue.AppendMenu() did not activate the first menu.");
	}

	const bMatchingFirstPendingMenu = g_MenuQueueInstance.PendingMenuEntries[0].Menu === g_WarningMenu;
	const bMatchingSecondPendingMenu = g_MenuQueueInstance.PendingMenuEntries[1].Menu === g_VoteMenu;
	if (!bMatchingFirstPendingMenu || !bMatchingSecondPendingMenu) {
		throw new Error("MenuQueue.PrependMenu() did not prepend the pending entry.");
	}

	const bMatchingActivePlayerTokenRecord = g_MenuQueueInstance.ActivePlayerTokenRecord.Source === "status";
	const bMatchingPendingPlayerTokenRecord = g_MenuQueueInstance.PendingMenuEntries[0].PlayerTokenRecord.Source === "admin";
	if (!bMatchingActivePlayerTokenRecord || !bMatchingPendingPlayerTokenRecord) {
		throw new Error("MenuQueue did not retain the supplied player token records.");
	}

	const bDuplicateMenuIgnored = g_MenuQueueInstance.AppendMenu(g_StatusMenu, 1, { Source: "ignored" });
	if (!bDuplicateMenuIgnored || (g_MenuQueueInstance.Length !== 3) || (g_MenuQueueInstance.ActivePageIndex !== 0) || (g_MenuQueueInstance.ActivePlayerTokenRecord.Source !== "status")) {
		throw new Error("AppendMenu() changed the existing entry while ignoring a duplicate menu.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("Append/prepend cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "Append/prepend setup and cleanup failed.");
	}

	throw CaughtError;
}
```

The first append sends immediately because the queue is idle. `PrependMenu()` affects pending order only while another menu is active.

### `MenuQueue.AppendMenus` and `MenuQueue.PrependMenus`

```js
const { SimpleMenu } = require("menus");
const { ClearMenuQueue, GetPlayerMenuQueue } = require("menus/queue");

const g_MenuQueueInstance = GetPlayerMenuQueue(1);
const g_OverviewMenu = new SimpleMenu({ Title: "Overview" });
const g_ChoicesMenu = new SimpleMenu({ Title: "Choices" });
const g_PlayersMenu = new SimpleMenu({ Title: "Players" });
const g_RulesMenu = new SimpleMenu({ Title: "Rules" });

exports.Unload = () => {
	if (ClearMenuQueue(1) !== undefined) {
		throw new Error("ClearMenuQueue() returned an undocumented value.");
	}

	if (g_MenuQueueInstance.Length !== 0) {
		throw new Error("ClearMenuQueue() did not release the append-menus example.");
	}

	return true;
};

try {
	const bMenusAppended = g_MenuQueueInstance.AppendMenus([g_OverviewMenu, g_ChoicesMenu]);
	const bMenusPrepended = bMenusAppended && g_MenuQueueInstance.PrependMenus([g_PlayersMenu, g_RulesMenu]);
	if (!bMenusAppended || !bMenusPrepended) {
		throw new Error("MenuQueue could not append and prepend the menus.");
	}

	if ((g_MenuQueueInstance.ActiveMenu !== g_OverviewMenu) || (g_MenuQueueInstance.Length !== 4)) {
		throw new Error("MenuQueue.AppendMenus() did not activate the first menu.");
	}

	const bMatchingFirstPendingMenu = g_MenuQueueInstance.PendingMenuEntries[0].Menu === g_PlayersMenu;
	const bMatchingSecondPendingMenu = g_MenuQueueInstance.PendingMenuEntries[1].Menu === g_RulesMenu;
	const bMatchingThirdPendingMenu = g_MenuQueueInstance.PendingMenuEntries[2].Menu === g_ChoicesMenu;
	if (!bMatchingFirstPendingMenu || !bMatchingSecondPendingMenu || !bMatchingThirdPendingMenu) {
		throw new Error("MenuQueue.PrependMenus() did not preserve deque order.");
	}

	const bDuplicateMenusIgnored = g_MenuQueueInstance.AppendMenus([g_OverviewMenu, g_ChoicesMenu]);
	if (!bDuplicateMenusIgnored || (g_MenuQueueInstance.Length !== 4)) {
		throw new Error("MenuQueue.AppendMenus() duplicated an existing menu object.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("Append/prepend-many cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "Append/prepend-many setup and cleanup failed.");
	}

	throw CaughtError;
}
```

Both methods require an array. Duplicate menu objects are ignored without duplicating their queue entry.

## Replacing

### `MenuQueue.ReplaceMenu`

Position `0` is the active entry when one exists. Pending entries then begin at position `1`. When the queue is idle, position `0` refers to the first pending entry.

```js
const { SimpleMenu } = require("menus");
const { ClearMenuQueue, GetPlayerMenuQueue } = require("menus/queue");

const g_MenuQueueInstance = GetPlayerMenuQueue(1);
const g_FirstMenu = new SimpleMenu({ Title: "First" });
const g_SecondMenu = new SimpleMenu({ Title: "Second" });
const g_ReplacementMenu = new SimpleMenu({ Title: "Replacement" });
const g_TokenRecord = { Refreshed: true };

exports.Unload = () => {
	if ((ClearMenuQueue(1) !== undefined) || (g_MenuQueueInstance.Length !== 0)) {
		throw new Error("ClearMenuQueue() did not release the replace example.");
	}

	return true;
};

try {
	const bFirstMenuAppended = g_MenuQueueInstance.AppendMenu(g_FirstMenu);
	const bSecondMenuAppended = bFirstMenuAppended && g_MenuQueueInstance.AppendMenu(g_SecondMenu);
	if (!bFirstMenuAppended || !bSecondMenuAppended) {
		throw new Error("MenuQueue could not prepare the replace example.");
	}

	const bPendingMenuReplaced = g_MenuQueueInstance.ReplaceMenu(1, g_ReplacementMenu);
	const bMatchingPendingMenu = bPendingMenuReplaced && (g_MenuQueueInstance.PendingMenuEntries[0].Menu === g_ReplacementMenu);
	if (!bPendingMenuReplaced || !bMatchingPendingMenu) {
		throw new Error("MenuQueue.ReplaceMenu() did not replace the pending position.");
	}

	const bActiveMenuReplaced = g_MenuQueueInstance.ReplaceMenu(0, g_FirstMenu, 0, g_TokenRecord);
	const bMatchingActivePlayerTokenRecord = bActiveMenuReplaced && (g_MenuQueueInstance.ActivePlayerTokenRecord === g_TokenRecord);
	if (!bActiveMenuReplaced || !bMatchingActivePlayerTokenRecord) {
		throw new Error("MenuQueue.ReplaceMenu() did not refresh the active entry with a new player token record.");
	}

	const bInvalidPositionReplaced = g_MenuQueueInstance.ReplaceMenu(4, g_SecondMenu);
	const bDuplicateMenuReplaced = !bInvalidPositionReplaced && g_MenuQueueInstance.ReplaceMenu(1, g_FirstMenu);
	if (bInvalidPositionReplaced || bDuplicateMenuReplaced) {
		throw new Error("MenuQueue.ReplaceMenu() accepted an invalid or duplicate target.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("Replace cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "Replace setup and cleanup failed.");
	}

	throw CaughtError;
}
```

Replacing the active menu with itself updates its page and player token record before refreshing it; a `false` result or exception does not roll back those updates. Replacing it with another menu invokes the old menu's `CloseMenuForPlayer()` before assigning the new active owner, so a close exception prevents that assignment. Unlike removal and clearing, this direct replacement does not detach the old owner before its callback; do not assume those operations' reentrancy guarantees apply here.

## Immediate send

### `MenuQueue.SendMenu`, `MenuQueue.RefreshActiveMenu`, and `MenuQueue.SendNextMenu`

```js
const { SimpleMenu } = require("menus");
const { ClearMenuQueue, GetPlayerMenuQueue } = require("menus/queue");

const g_MenuQueueInstance = GetPlayerMenuQueue(1);
const g_TokenRecord = { Phase: "warmup" };
const g_CurrentMenu = new SimpleMenu({ Description: "Phase: {Phase}", Title: "Current state" });
const g_NextMenu = new SimpleMenu({ Title: "Next notice" });

exports.Unload = () => {
	if ((ClearMenuQueue(1) !== undefined) || (g_MenuQueueInstance.Length !== 0)) {
		throw new Error("ClearMenuQueue() did not release the immediate-send example.");
	}

	return true;
};

try {
	const bCurrentMenuSent = g_MenuQueueInstance.SendMenu(g_CurrentMenu, 0, g_TokenRecord);
	const bPlayerTokenRecordActivated = bCurrentMenuSent && (g_MenuQueueInstance.ActivePlayerTokenRecord === g_TokenRecord);
	if (!bCurrentMenuSent || !bPlayerTokenRecordActivated) {
		throw new Error("MenuQueue.SendMenu() did not activate the menu with its player token record.");
	}

	g_TokenRecord.Phase = "live";

	const bCurrentMenuRefreshed = g_MenuQueueInstance.RefreshActiveMenu();
	const bLivePlayerTokenRecordReused = bCurrentMenuRefreshed && (g_MenuQueueInstance.ActivePlayerTokenRecord.Phase === "live");
	if (!bCurrentMenuRefreshed || !bLivePlayerTokenRecordReused) {
		throw new Error("MenuQueue.RefreshActiveMenu() did not reuse the live player token record.");
	}

	const bNextMenuAppended = g_MenuQueueInstance.AppendMenu(g_NextMenu);
	const bPendingMenuEntryQueued = g_MenuQueueInstance.PendingMenuEntries.length === 1;
	const bNextMenuSent = bNextMenuAppended && bPendingMenuEntryQueued && g_MenuQueueInstance.SendNextMenu();
	if (!bNextMenuAppended || !bPendingMenuEntryQueued || !bNextMenuSent) {
		throw new Error("MenuQueue.SendNextMenu() could not activate the pending menu.");
	}

	const bMatchingActiveMenu = g_MenuQueueInstance.ActiveMenu === g_NextMenu;
	const bMatchingQueueLength = g_MenuQueueInstance.Length === 1;
	const bPendingMenuEntriesEmpty = g_MenuQueueInstance.PendingMenuEntries.length === 0;
	if (!bMatchingActiveMenu || !bMatchingQueueLength || !bPendingMenuEntriesEmpty) {
		throw new Error("MenuQueue.SendNextMenu() left an unexpected active or pending entry.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("Immediate-send cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "Immediate-send setup and cleanup failed.");
	}

	throw CaughtError;
}
```

`SendNextMenu()` may advance immediately while an entry is active if a pending entry exists. With no pending entry, it only resets the active fields: it does not close the previous menu or hide its native text. Use `CloseActiveMenu()` to release an active menu. `SendMenu()` removes existing pending entries for the requested menu before calling a different old owner's close method, then assigns the new owner and sends. This is not a transaction: callback-side queue changes are not rolled back and can be superseded by the outer send.

Menus that close their own display in `CloseMenuForPlayer()` can set
`UseTextDialogFallback = false` on the menu instance. The queue then skips
the generic native text dialog on selection, removal, close, and clear.
The bundled vote uses this setting so closing a radio vote does not open a
second VGUI dialog.

## Selection

### `MenuQueue.SelectMenuOption`

```js
const { SimpleMenu, SimpleMenuOption } = require("menus");
const { ClearMenuQueue, GetPlayerMenuQueue } = require("menus/queue");

let g_SelectionRecord = null;

const g_SimpleMenuInstance = new SimpleMenu({
	SelectCallback(unPlayerIndex, ValueOption) {
		g_SelectionRecord = { PlayerIndex: unPlayerIndex, ValueOption };
	},
	Title: "Ready state",
});
const g_MenuQueueInstance = GetPlayerMenuQueue(1);
g_SimpleMenuInstance.AppendMenuItem(new SimpleMenuOption(1, "Ready", true));

exports.Unload = () => {
	if ((ClearMenuQueue(1) !== undefined) || (g_MenuQueueInstance.Length !== 0)) {
		throw new Error("ClearMenuQueue() did not release the selection example.");
	}

	return true;
};

try {
	const bSimpleMenuSent = g_MenuQueueInstance.SendMenu(g_SimpleMenuInstance);
	const bMenuOptionSelected = bSimpleMenuSent && g_MenuQueueInstance.SelectMenuOption(1);
	if (!bSimpleMenuSent || !bMenuOptionSelected) {
		throw new Error("MenuQueue.SelectMenuOption() could not dispatch the active choice.");
	}

	const bMatchingPlayerIndex = g_SelectionRecord?.PlayerIndex === 1;
	const bMatchingOptionValue = g_SelectionRecord?.ValueOption === true;
	if ((g_SelectionRecord === null) || !bMatchingPlayerIndex || !bMatchingOptionValue) {
		throw new Error("MenuQueue.SelectMenuOption() dispatched unexpected callback data.");
	}

	if ((g_MenuQueueInstance.ActiveMenu !== null) || (g_MenuQueueInstance.Length !== 0)) {
		throw new Error("MenuQueue.SelectMenuOption() did not close the one-shot menu.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("Selection cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "Selection setup and cleanup failed.");
	}

	throw CaughtError;
}
```

An ordinary handled choice closes the menu when `CloseOnSelection` is true and the same menu still owns the queue. Paged Back/Next choices can resend a page; the paged Close choice explicitly closes the active entry. Unknown or disabled choices, and selections while idle, return `false`; invalid choice-argument types or ranges throw before dispatch.

## Membership

### `MenuQueue.HasMenu` and `MenuQueue.RemoveMenu`

```js
const { SimpleMenu } = require("menus");
const { ClearMenuQueue, GetPlayerMenuQueue } = require("menus/queue");

const g_ActiveMenu = new SimpleMenu({ Title: "Active" });
const g_PendingMenu = new SimpleMenu({ Title: "Pending" });
const g_MenuQueueInstance = GetPlayerMenuQueue(1);

exports.Unload = () => {
	if ((ClearMenuQueue(1) !== undefined) || (g_MenuQueueInstance.Length !== 0)) {
		throw new Error("ClearMenuQueue() did not release the membership example.");
	}

	return true;
};

try {
	const bActiveMenuAppended = g_MenuQueueInstance.AppendMenu(g_ActiveMenu);
	const bPendingMenuAppended = bActiveMenuAppended && g_MenuQueueInstance.AppendMenu(g_PendingMenu);
	if (!bActiveMenuAppended || !bPendingMenuAppended) {
		throw new Error("MenuQueue could not prepare the membership example.");
	}

	const bActiveMenuFound = g_MenuQueueInstance.HasMenu(g_ActiveMenu);
	const bPendingMenuFound = bActiveMenuFound && g_MenuQueueInstance.HasMenu(g_PendingMenu);
	const bTwoMenusQueued = bPendingMenuFound && (g_MenuQueueInstance.Length === 2);
	if (!bActiveMenuFound || !bPendingMenuFound || !bTwoMenusQueued) {
		throw new Error("MenuQueue.HasMenu() did not find active and pending menus.");
	}

	const bPendingMenuRemoved = g_MenuQueueInstance.RemoveMenu(g_PendingMenu);
	const bPendingMenuRemovedAgain = bPendingMenuRemoved && g_MenuQueueInstance.RemoveMenu(g_PendingMenu);
	const bActiveMenuRemaining = bPendingMenuRemoved && !bPendingMenuRemovedAgain && (g_MenuQueueInstance.Length === 1);
	if (!bPendingMenuRemoved || bPendingMenuRemovedAgain || !bActiveMenuRemaining) {
		throw new Error("MenuQueue.RemoveMenu() did not remove exactly one pending menu.");
	}

	const bActiveMenuRemoved = g_MenuQueueInstance.RemoveMenu(g_ActiveMenu);
	const bActiveMenuStillQueued = bActiveMenuRemoved && g_MenuQueueInstance.HasMenu(g_ActiveMenu);
	const bMenuQueueEmpty = bActiveMenuRemoved && !bActiveMenuStillQueued && (g_MenuQueueInstance.Length === 0);
	if (!bActiveMenuRemoved || bActiveMenuStillQueued || !bMenuQueueEmpty) {
		throw new Error("MenuQueue.RemoveMenu() did not release the active menu.");
	}
} catch (CaughtError) {
	try {
		if (exports.Unload() !== true) {
			throw new Error("Membership cleanup returned an undocumented value.");
		}
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "Membership setup and cleanup failed.");
	}

	throw CaughtError;
}
```

Removing an active menu invokes its close callback and sends the next pending entry unless that callback opened a menu. Removing a pending menu does not affect the displayed dialog.

## Closing

### `MenuQueue.CloseActiveMenu` and `MenuQueue.ClearMenuQueue`

```js
const { SimpleMenu } = require("menus");
const { GetPlayerMenuQueue } = require("menus/queue");

let g_bCleanupAttempted = false;
let g_bCleanupCompleted = false;

const g_MenuQueueInstance = GetPlayerMenuQueue(1);
const g_FirstMenu = new SimpleMenu({ Title: "First" });
const g_SecondMenu = new SimpleMenu({ Title: "Second" });

exports.Unload = () => {
	if (g_bCleanupAttempted) {
		return g_bCleanupCompleted;
	}

	g_bCleanupAttempted = true;
	const ClearResult = g_MenuQueueInstance.ClearMenuQueue();
	const bMenuQueueEmpty = (g_MenuQueueInstance.Length === 0) && (g_MenuQueueInstance.ActiveMenu === null);
	if ((ClearResult !== undefined) || !bMenuQueueEmpty) {
		throw new Error("MenuQueue.ClearMenuQueue() did not release the complete queue.");
	}

	g_bCleanupCompleted = true;

	return true;
};

try {
	const bFirstMenuAppended = g_MenuQueueInstance.AppendMenu(g_FirstMenu);
	const bSecondMenuAppended = bFirstMenuAppended && g_MenuQueueInstance.AppendMenu(g_SecondMenu);
	if (!bFirstMenuAppended || !bSecondMenuAppended) {
		throw new Error("MenuQueue could not prepare the close example.");
	}

	const bActiveMenuClosed = g_MenuQueueInstance.CloseActiveMenu();
	const bSecondMenuActivated = bActiveMenuClosed && (g_MenuQueueInstance.ActiveMenu === g_SecondMenu);
	const bSingleMenuQueued = bSecondMenuActivated && (g_MenuQueueInstance.Length === 1);
	if (!bActiveMenuClosed || !bSecondMenuActivated || !bSingleMenuQueued) {
		throw new Error("MenuQueue.CloseActiveMenu() did not advance to the pending menu.");
	}

	if (exports.Unload() !== true) {
		throw new Error("The closing example did not confirm cleanup.");
	}

	if (g_MenuQueueInstance.CloseActiveMenu()) {
		throw new Error("MenuQueue.CloseActiveMenu() reported success for an idle queue.");
	}
} catch (CaughtError) {
	if (!g_bCleanupAttempted) {
		try {
			if (exports.Unload() !== true) {
				throw new Error("Closing cleanup returned an undocumented value.");
			}
		} catch (CleanupError) {
			throw new AggregateError([CaughtError, CleanupError], "Closing setup and cleanup failed.");
		}
	}

	throw CaughtError;
}
```

`CloseActiveMenu()` attempts the next entry even when the old active menu's `CloseCallback` throws, unless that callback opened a menu. If a transition makes a menu active and then returns `false` or throws, closing does not hide that new owner; use explicit clearing when teardown must release it. `ClearMenuQueue()` discards the pending entries present when clearing begins and closes the current menu without automatically advancing. The closing examples attempt explicit clearing once: a later unload confirms completed cleanup but does not silently retry a failed clear.

After selection, active-menu removal, closing, or clearing, a menu opened by `CloseCallback` remains active, including when the callback reopens the same menu object. The queue does not subsequently advance over or hide that menu. For teardown that must leave the queue idle, prevent close callbacks from opening or enqueueing menus before calling `ClearMenuQueue()`.

### `CloseActivePlayerMenu` and `ClearMenuQueue`

```js
const { SimpleMenu } = require("menus");
const { ClearMenuQueue, CloseActivePlayerMenu, GetPlayerMenuQueue } = require("menus/queue");

let g_bCleanupAttempted = false;
let g_bCleanupCompleted = false;

const g_MenuQueueInstance = GetPlayerMenuQueue(1);
const g_FirstMenu = new SimpleMenu({ Title: "First" });
const g_SecondMenu = new SimpleMenu({ Title: "Second" });

exports.Unload = () => {
	if (g_bCleanupAttempted) {
		return g_bCleanupCompleted;
	}

	g_bCleanupAttempted = true;
	const ClearResult = ClearMenuQueue(1);
	if ((ClearResult !== undefined) || (g_MenuQueueInstance.Length !== 0)) {
		throw new Error("ClearMenuQueue() did not release the canonical queue.");
	}

	g_bCleanupCompleted = true;

	return true;
};

try {
	const bMenusAppended = g_MenuQueueInstance.AppendMenus([g_FirstMenu, g_SecondMenu]);
	if (!bMenusAppended) {
		throw new Error("MenuQueue.AppendMenus() could not prepare the free-function example.");
	}

	const bActiveMenuClosed = CloseActivePlayerMenu(1);
	const bSecondMenuActivated = bActiveMenuClosed && (g_MenuQueueInstance.ActiveMenu === g_SecondMenu);
	if (!bActiveMenuClosed || !bSecondMenuActivated) {
		throw new Error("CloseActivePlayerMenu() did not advance the canonical queue.");
	}

	if (exports.Unload() !== true) {
		throw new Error("The free-closing example did not confirm cleanup.");
	}

	if (CloseActivePlayerMenu(1)) {
		throw new Error("CloseActivePlayerMenu() reported success for an idle canonical queue.");
	}
} catch (CaughtError) {
	if (!g_bCleanupAttempted) {
		try {
			if (exports.Unload() !== true) {
				throw new Error("Free-closing cleanup returned an undocumented value.");
			}
		} catch (CleanupError) {
			throw new AggregateError([CaughtError, CleanupError], "Free-closing setup and cleanup failed.");
		}
	}

	throw CaughtError;
}
```

The free functions operate on the canonical queue. `CloseActivePlayerMenu()` returns the queue's boolean result; `ClearMenuQueue()` returns `undefined`.

## Command registration

### `RegisterMenuSelectCommand`

```js
const { RegisterMenuSelectCommand } = require("menus/queue");

const g_bFirstRegistrationSucceeded = RegisterMenuSelectCommand();
const g_bSecondRegistrationSucceeded = g_bFirstRegistrationSucceeded && RegisterMenuSelectCommand();
if (!g_bFirstRegistrationSucceeded || !g_bSecondRegistrationSucceeded) {
	throw new Error("RegisterMenuSelectCommand() was not idempotent.");
}
```

Registration is idempotent and normally automatic on the first queue send. The handler accepts a decimal `menuselect <choice>` argument that fits a nonnegative safe integer. A missing or nondecimal choice returns `CONTINUE`; a decimal value outside that range throws `RangeError`, and an invalid callback payload throws `TypeError`. A valid dispatch returns `HANDLED` for a handled active-menu choice and otherwise returns `CONTINUE`, including when no canonical queue exists for the player. The plugin context owns the native command registration.

## Errors

- `TypeError` is thrown when an entry does not provide `SendMenuToPlayer()`, `CloseMenuForPlayer()`, `SelectMenuOption()`, and `ShouldCloseMenuAfterSelection()`, the player token record is not a non-array object, or `AppendMenus()`/`PrependMenus()` receives a non-array value.
- `RangeError` is thrown for a player index that is not a positive safe integer, or for a page, choice, or replacement position that is not a nonnegative safe integer. This includes noninteger, nonnumeric, and out-of-safe-range values, not only negative numbers.
- Native send and refresh results are exposed by the corresponding send/refresh methods. `CloseActiveMenu()` reports whether a menu was active, and `RemoveMenu()` reports whether an entry was removed; these results do not certify a successful next-menu send or native hide. `ClearMenuQueue()` returns `undefined`. A native `HideText()` result of `false` is not propagated by these close/clear operations.
- Menu renderer and callback exceptions propagate through the operation that triggered them. Once `RemoveMenu()`, `CloseActiveMenu()`, or a handled `SelectMenuOption()` begins releasing its active owner, it detaches that owner and still attempts transition after a close exception. A failed transition triggers hiding only while no new menu owns the queue. `ClearMenuQueue()` instead attempts closing and ownerless hiding without advancement. A sole phase failure is rethrown unchanged; several failures are combined in order with `AggregateError`. Errors before the release phase can leave ownership intact, and empty fields still do not certify that native hiding succeeded.

```js
const { MenuQueue } = require("menus/queue");

const g_MenuQueueInstance = new MenuQueue(3);
const g_MinimalMenu = {
	CloseMenuForPlayer() {
	},
	SelectMenuOption() {
		return true;
	},
	SendMenuToPlayer() {
		return true;
	},
	ShouldCloseMenuAfterSelection() {
		return true;
	},
};

const g_vecInvalidCalls = [
	[() => new MenuQueue(0), RangeError],
	[() => g_MenuQueueInstance.AppendMenu({}), TypeError],
	[() => g_MenuQueueInstance.AppendMenu(g_MinimalMenu, 0, []), TypeError],
	[() => g_MenuQueueInstance.AppendMenus("not-an-array"), TypeError],
	[() => g_MenuQueueInstance.PrependMenus(null), TypeError],
	[() => g_MenuQueueInstance.ReplaceMenu(-1, {}), RangeError],
	[() => g_MenuQueueInstance.SelectMenuOption(-1), RangeError],
];
for (const [Call, ErrorType] of g_vecInvalidCalls) {
	let CaughtError = null;

	try {
		Call();
	} catch (CaughtCallError) {
		CaughtError = CaughtCallError;
	}

	if (!(CaughtError instanceof ErrorType)) {
		throw new Error(`The menus/queue module raised ${CaughtError?.constructor?.name ?? "no error"} instead of ${ErrorType.name}.`);
	}
}
```

## Lifecycle

- Pass menu objects, not menu names, numbers, or indexes, to queue methods.
- `AppendMenus()` and `PrependMenus()` require arrays even when adding one menu.
- A duplicate `AppendMenu()` call succeeds but does not replace the existing page index or player token record; use `ReplaceMenu()` for that.
- `CloseActiveMenu()` releases the old active entry and normally advances; `ClearMenuQueue()` discards existing pending entries and releases the old active entry. Both preserve a menu opened by the close callback, so clearing is not an unconditional promise of an empty queue.
- `ListPlayerMenuQueues()` returns a live `Map` value iterator; consume it directly with `for...of` and request another iterator after exhaustion.
- Call `SendNextMenu()` only when a pending entry exists. With no pending entry it resets the queue to idle and returns `false`; use `CloseActiveMenu()` or `ClearMenuQueue()` when the active menu must be closed first.
- `RegisterMenuSelectCommand()` has no matching public unregister function. The plugin runtime owns and releases the command registration with the plugin context.
- Do not mutate `MenuQueue.PendingMenuEntries`, `MenuQueue.ActiveMenu`, `MenuQueue.ActivePageIndex`, or `MenuQueue.ActivePlayerTokenRecord` directly; doing so bypasses cleanup and native transport.
- Before teardown, prevent close callbacks from opening or enqueueing new menus, then call `ClearMenuQueue(PlayerReference)` for every owned client, even when normal callbacks are expected to close their menus.

## Related modules

- [`menus`](menus-objects.md) provides the menu objects accepted by queue methods.
- [`menus/esc`](menus-esc.md) renders Source Escape-key dialogs.
- [`menus/radio`](menus-radio.md) renders numbered radio menus.
- [`commands/client`](commands-client.md) provides the underlying `RegisterCommand()` and `UnregisterCommand()` APIs.
