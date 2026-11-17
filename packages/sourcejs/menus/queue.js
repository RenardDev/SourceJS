"use strict";

const { CONTINUE, HANDLED } = require("commands");
const g_ClientCommands = require("commands/client");
const { GetModule } = require("internal/runtime");

const { RegisterCommand } = g_ClientCommands;

const g_MenusRuntime = GetModule("menus");
const g_mapMenuQueues = new Map();
let g_bMenuSelectCommandRegistered = false;

function RequireObjectRecord(RecordValue, strValueName) {
	if ((RecordValue === null) || (typeof RecordValue !== "object") || Array.isArray(RecordValue)) {
		throw new TypeError(`${strValueName} must be an object.`);
	}

	return RecordValue;
}

function RequireBoolean(bBooleanValue, strValueName) {
	if (typeof bBooleanValue !== "boolean") {
		throw new TypeError(`${strValueName} must be a boolean.`);
	}

	return bBooleanValue;
}

function RequireSafeInteger(nIntegerValue, strValueName, nMinimumValue = 0) {
	if (!Number.isSafeInteger(nIntegerValue) || (nIntegerValue < nMinimumValue)) {
		throw new RangeError(`${strValueName} must be a safe integer greater than or equal to ${nMinimumValue}.`);
	}

	return nIntegerValue;
}

function ResolvePlayerIndex(PlayerReference) {
	if ((PlayerReference !== null) && (typeof PlayerReference === "object") && !Array.isArray(PlayerReference)) {
		const unPlayerReferenceIndex = PlayerReference.Index;
		return RequireSafeInteger(unPlayerReferenceIndex, "menus PlayerReference.Index", 1);
	}

	return RequireSafeInteger(PlayerReference, "menus player index", 1);
}

function RequireMenuQueueEntryArray(vecMenuQueueEntries) {
	if (!Array.isArray(vecMenuQueueEntries)) {
		throw new TypeError("MenuQueue queue must be an array.");
	}

	return vecMenuQueueEntries;
}

function RequireTokenRecord(TokenRecord) {
	return RequireObjectRecord(TokenRecord, "menus queue tokens");
}

function RequireMenuQueueMenu(MenuObject) {
	if ((MenuObject === null) || (typeof MenuObject !== "object")) {
		throw new TypeError("menus queue entries must be menu objects.");
	}

	const SendToPlayer = MenuObject.SendMenuToPlayer;
	const CloseForPlayer = MenuObject.CloseMenuForPlayer;
	const Select = MenuObject.SelectMenuOption;
	const ShouldCloseAfterSelection = MenuObject.ShouldCloseMenuAfterSelection;
	if ((typeof SendToPlayer !== "function") || (typeof CloseForPlayer !== "function") || (typeof Select !== "function") || (typeof ShouldCloseAfterSelection !== "function")) {
		throw new TypeError("queue entries must expose SendMenuToPlayer, CloseMenuForPlayer, SelectMenuOption, and ShouldCloseMenuAfterSelection methods.");
	}

	return MenuObject;
}

function CreateMenuQueueEntry(MenuObject, unPageIndex = 0, TokenRecord = {}) {
	return { Menu: RequireMenuQueueMenu(MenuObject), PageIndex: RequireSafeInteger(unPageIndex, "menus queue PageIndex"), PlayerTokenRecord: RequireTokenRecord(TokenRecord) };
}

function FindMatchingMenuQueueEntryIndexes(vecMenuQueueEntries, RequestedMenu) {
	const vecMatchingQueueEntryIndexes = [];
	const unQueueEntryCount = vecMenuQueueEntries.length;
	for (let unQueueEntryIndex = 0; unQueueEntryIndex < unQueueEntryCount; unQueueEntryIndex += 1) {
		const CurrentQueueEntry = RequireObjectRecord(vecMenuQueueEntries[unQueueEntryIndex], "MenuQueue queue entry");
		const CurrentMenu = RequireMenuQueueMenu(CurrentQueueEntry.Menu);
		RequireSafeInteger(CurrentQueueEntry.PageIndex, "MenuQueue queue entry PageIndex");
		RequireTokenRecord(CurrentQueueEntry.PlayerTokenRecord);

		if (CurrentMenu === RequestedMenu) {
			vecMatchingQueueEntryIndexes.push(unQueueEntryIndex);
		}
	}

	return vecMatchingQueueEntryIndexes;
}

function ParseMenuSelectChoice(CommandPayload) {
	if ((CommandPayload === null) || (typeof CommandPayload !== "object")) {
		throw new TypeError("menuselect callback requires a command with arguments.");
	}

	const vecCommandArguments = CommandPayload.Arguments;
	if (!Array.isArray(vecCommandArguments)) {
		throw new TypeError("menuselect callback requires a command with arguments.");
	}

	const strChoiceText = vecCommandArguments[1];
	if ((typeof strChoiceText !== "string") || !/^\d+$/.test(strChoiceText)) {
		return null;
	}

	return RequireSafeInteger(Number.parseInt(strChoiceText, 10), "menuselect ChoiceIndex");
}

function RequireNullableMenuQueueMenu(MenuObject) {
	if (MenuObject === null) {
		return null;
	}

	return RequireMenuQueueMenu(MenuObject);
}

function HideMenuForPlayer(PlayerReference) {
	const bMenuHideResult = g_MenusRuntime.HideText(ResolvePlayerIndex(PlayerReference));

	return RequireBoolean(bMenuHideResult, "menus HideText result");
}

function HandleMenuSelectCommand(CommandPayload) {
	const unChoiceIndex = ParseMenuSelectChoice(CommandPayload);
	if (unChoiceIndex === null) {
		return CONTINUE;
	}

	const unPlayerIndex = ResolvePlayerIndex(CommandPayload.Index);
	const MenuQueue = g_mapMenuQueues.get(unPlayerIndex);
	if (MenuQueue === undefined) {
		return CONTINUE;
	}

	const bMenuSelectionHandled = RequireBoolean(MenuQueue.SelectMenuOption(unChoiceIndex), "MenuQueue SelectMenuOption result");

	return bMenuSelectionHandled ? HANDLED : CONTINUE;
}

function RegisterMenuSelectCommand() {
	if (g_bMenuSelectCommandRegistered) {
		return true;
	}

	const bMenuSelectRegistrationResult = RegisterCommand("menuselect", HandleMenuSelectCommand);
	const bMenuSelectRegistrationSucceeded = RequireBoolean(bMenuSelectRegistrationResult, "menuselect registration result");
	if (bMenuSelectRegistrationSucceeded) {
		g_bMenuSelectCommandRegistered = true;
	}

	return bMenuSelectRegistrationSucceeded;
}

class MenuQueue {
	constructor(PlayerReference) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const ExistingMenuQueue = g_mapMenuQueues.get(unPlayerIndex);
		if (ExistingMenuQueue !== undefined) {
			return ExistingMenuQueue;
		}

		this.PlayerIndex = unPlayerIndex;
		this.PendingMenuEntries = [];
		this.ActiveMenu = null;
		this.ActivePageIndex = 0;
		this.ActivePlayerTokenRecord = {};
		g_mapMenuQueues.set(unPlayerIndex, this);
	}

	AppendMenu(MenuObject, unPageIndex = 0, TokenRecord = {}) {
		const QueueEntry = CreateMenuQueueEntry(MenuObject, unPageIndex, TokenRecord);
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		const bMenuAlreadyQueued = RequireBoolean(this.HasMenu(QueueEntry.Menu), "MenuQueue HasMenu result");
		if (bMenuAlreadyQueued) {
			return true;
		}

		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		vecMenuQueueEntries.push(QueueEntry);

		if (ActiveMenu === null) {
			const bNextMenuSendResult = this.SendNextMenu();
			return RequireBoolean(bNextMenuSendResult, "MenuQueue SendNextMenu result");
		}

		return true;
	}

	PrependMenu(MenuObject, unPageIndex = 0, TokenRecord = {}) {
		const QueueEntry = CreateMenuQueueEntry(MenuObject, unPageIndex, TokenRecord);
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		const bMenuAlreadyQueued = RequireBoolean(this.HasMenu(QueueEntry.Menu), "MenuQueue HasMenu result");
		if (bMenuAlreadyQueued) {
			return true;
		}

		if (ActiveMenu === null) {
			const bMenuSendResult = this.SendMenu(QueueEntry.Menu, QueueEntry.PageIndex, QueueEntry.PlayerTokenRecord);
			return RequireBoolean(bMenuSendResult, "MenuQueue SendMenu result");
		}

		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		vecMenuQueueEntries.unshift(QueueEntry);

		return true;
	}

	AppendMenus(vecMenuObjects, unPageIndex = 0, TokenRecord = {}) {
		if (!Array.isArray(vecMenuObjects)) {
			throw new TypeError("MenuQueue.AppendMenus vecMenuObjects must be an array.");
		}

		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		const vecStagedQueueEntries = [];
		const setStagedMenuObjects = new Set();
		const unMenuObjectCount = vecMenuObjects.length;
		for (let unMenuObjectIndex = 0; unMenuObjectIndex < unMenuObjectCount; unMenuObjectIndex += 1) {
			const QueueEntry = CreateMenuQueueEntry(vecMenuObjects[unMenuObjectIndex], unPageIndex, TokenRecord);
			const bMenuAlreadyQueued = RequireBoolean(this.HasMenu(QueueEntry.Menu), "MenuQueue HasMenu result");
			if (!bMenuAlreadyQueued && !setStagedMenuObjects.has(QueueEntry.Menu)) {
				setStagedMenuObjects.add(QueueEntry.Menu);
				vecStagedQueueEntries.push(QueueEntry);
			}
		}

		for (const QueueEntry of vecStagedQueueEntries) {
			vecMenuQueueEntries.push(QueueEntry);
		}

		if (ActiveMenu === null) {
			const bNextMenuSendResult = this.SendNextMenu();
			return RequireBoolean(bNextMenuSendResult, "MenuQueue SendNextMenu result");
		}

		return true;
	}

	PrependMenus(vecMenuObjects, unPageIndex = 0, TokenRecord = {}) {
		if (!Array.isArray(vecMenuObjects)) {
			throw new TypeError("MenuQueue.PrependMenus vecMenuObjects must be an array.");
		}

		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		const vecStagedQueueEntries = [];
		const setStagedMenuObjects = new Set();
		const unMenuObjectCount = vecMenuObjects.length;
		for (let nMenuObjectIndex = unMenuObjectCount - 1; nMenuObjectIndex >= 0; nMenuObjectIndex -= 1) {
			const QueueEntry = CreateMenuQueueEntry(vecMenuObjects[nMenuObjectIndex], unPageIndex, TokenRecord);
			const bMenuAlreadyQueued = RequireBoolean(this.HasMenu(QueueEntry.Menu), "MenuQueue HasMenu result");
			if (!bMenuAlreadyQueued && !setStagedMenuObjects.has(QueueEntry.Menu)) {
				setStagedMenuObjects.add(QueueEntry.Menu);
				vecStagedQueueEntries.push(QueueEntry);
			}
		}

		for (const QueueEntry of vecStagedQueueEntries) {
			vecMenuQueueEntries.unshift(QueueEntry);
		}

		if (ActiveMenu === null) {
			const bNextMenuSendResult = this.SendNextMenu();
			return RequireBoolean(bNextMenuSendResult, "MenuQueue SendNextMenu result");
		}

		return true;
	}

	ReplaceMenu(unPositionIndex, MenuObject, unPageIndex = 0, TokenRecord = {}) {
		const unQueuePositionIndex = RequireSafeInteger(unPositionIndex, "MenuQueue.ReplaceMenu PositionIndex");
		const QueueEntry = CreateMenuQueueEntry(MenuObject, unPageIndex, TokenRecord);
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		if ((unQueuePositionIndex === 0) && (ActiveMenu !== null)) {
			if (ActiveMenu === QueueEntry.Menu) {
				this.ActivePageIndex = QueueEntry.PageIndex;
				this.ActivePlayerTokenRecord = QueueEntry.PlayerTokenRecord;
				const bMenuRefreshResult = this.RefreshActiveMenu();
				return RequireBoolean(bMenuRefreshResult, "MenuQueue RefreshActiveMenu result");
			}

			const bMenuAlreadyQueued = RequireBoolean(this.HasMenu(QueueEntry.Menu), "MenuQueue HasMenu result");
			if (bMenuAlreadyQueued) {
				return false;
			}

			const unPlayerIndex = ResolvePlayerIndex(this.PlayerIndex);
			ActiveMenu.CloseMenuForPlayer(unPlayerIndex);
			this.ActiveMenu = QueueEntry.Menu;
			this.ActivePageIndex = QueueEntry.PageIndex;
			this.ActivePlayerTokenRecord = QueueEntry.PlayerTokenRecord;
			const bMenuRefreshResult = this.RefreshActiveMenu();
			return RequireBoolean(bMenuRefreshResult, "MenuQueue RefreshActiveMenu result");
		}

		const unQueueEntryIndex = (ActiveMenu === null) ? unQueuePositionIndex : (unQueuePositionIndex - 1);
		if ((unQueueEntryIndex < 0) || (unQueueEntryIndex >= vecMenuQueueEntries.length)) {
			return false;
		}

		const CurrentQueueEntry = RequireObjectRecord(vecMenuQueueEntries[unQueueEntryIndex], "MenuQueue queue entry");
		const CurrentMenu = RequireMenuQueueMenu(CurrentQueueEntry.Menu);
		if (CurrentMenu !== QueueEntry.Menu) {
			const bMenuAlreadyQueued = RequireBoolean(this.HasMenu(QueueEntry.Menu), "MenuQueue HasMenu result");
			if (bMenuAlreadyQueued) {
				return false;
			}
		}

		vecMenuQueueEntries[unQueueEntryIndex] = QueueEntry;

		return true;
	}

	SendMenu(MenuObject, unPageIndex = 0, TokenRecord = {}) {
		const QueueEntry = CreateMenuQueueEntry(MenuObject, unPageIndex, TokenRecord);
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		const unPlayerIndex = ResolvePlayerIndex(this.PlayerIndex);
		const vecQueueEntryRemovalIndexes = FindMatchingMenuQueueEntryIndexes(vecMenuQueueEntries, QueueEntry.Menu);
		const bMenuSelectRegistrationResult = RegisterMenuSelectCommand();
		const bMenuSelectRegistrationSucceeded = RequireBoolean(bMenuSelectRegistrationResult, "menuselect registration result");
		if (!bMenuSelectRegistrationSucceeded) {
			return false;
		}

		for (let nRemovalIndexPosition = vecQueueEntryRemovalIndexes.length - 1; nRemovalIndexPosition >= 0; nRemovalIndexPosition -= 1) {
			vecMenuQueueEntries.splice(vecQueueEntryRemovalIndexes[nRemovalIndexPosition], 1);
		}

		if ((ActiveMenu !== null) && (ActiveMenu !== QueueEntry.Menu)) {
			ActiveMenu.CloseMenuForPlayer(unPlayerIndex);
		}

		this.ActiveMenu = QueueEntry.Menu;
		this.ActivePageIndex = QueueEntry.PageIndex;
		this.ActivePlayerTokenRecord = QueueEntry.PlayerTokenRecord;
		const bMenuSendResult = QueueEntry.Menu.SendMenuToPlayer(unPlayerIndex, QueueEntry.PageIndex, QueueEntry.PlayerTokenRecord);

		return RequireBoolean(bMenuSendResult, "MenuQueue SendMenuToPlayer result");
	}

	SendNextMenu() {
		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		if (vecMenuQueueEntries.length === 0) {
			this.ActiveMenu = null;
			this.ActivePageIndex = 0;
			this.ActivePlayerTokenRecord = {};
			return false;
		}

		const FirstQueueEntry = RequireObjectRecord(vecMenuQueueEntries[0], "MenuQueue queue entry");
		const MenuObject = RequireMenuQueueMenu(FirstQueueEntry.Menu);
		const unPageIndex = RequireSafeInteger(FirstQueueEntry.PageIndex, "MenuQueue queue entry PageIndex");
		const TokenRecord = RequireTokenRecord(FirstQueueEntry.PlayerTokenRecord);
		const bNextMenuSendResult = this.SendMenu(MenuObject, unPageIndex, TokenRecord);

		return RequireBoolean(bNextMenuSendResult, "MenuQueue SendMenu result");
	}

	RefreshActiveMenu() {
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		if (ActiveMenu === null) {
			return false;
		}

		const unPlayerIndex = ResolvePlayerIndex(this.PlayerIndex);
		const unPageIndex = RequireSafeInteger(this.ActivePageIndex, "MenuQueue ActivePageIndex");
		const TokenRecord = RequireTokenRecord(this.ActivePlayerTokenRecord);
		const bMenuRefreshResult = ActiveMenu.SendMenuToPlayer(unPlayerIndex, unPageIndex, TokenRecord);

		return RequireBoolean(bMenuRefreshResult, "MenuQueue SendMenuToPlayer result");
	}

	SelectMenuOption(unChoiceIndex) {
		const unSelectedChoiceIndex = RequireSafeInteger(unChoiceIndex, "MenuQueue.SelectMenuOption ChoiceIndex");
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		if (ActiveMenu === null) {
			return false;
		}

		const unPlayerIndex = ResolvePlayerIndex(this.PlayerIndex);
		const unPageIndex = RequireSafeInteger(this.ActivePageIndex, "MenuQueue ActivePageIndex");
		const bMenuSelectionResult = ActiveMenu.SelectMenuOption(unPlayerIndex, unSelectedChoiceIndex, unPageIndex);
		const bMenuSelectionHandled = RequireBoolean(bMenuSelectionResult, "MenuQueue SelectMenuOption result");
		if (bMenuSelectionHandled) {
			const bShouldCloseAfterSelection = RequireBoolean(ActiveMenu.ShouldCloseMenuAfterSelection(unSelectedChoiceIndex, unPageIndex), "MenuQueue ShouldCloseMenuAfterSelection result");
			if (bShouldCloseAfterSelection && (this.ActiveMenu === ActiveMenu)) {
				const vecErrors = [];
				let bHideMenu = false;

				this.ActiveMenu = null;
				this.ActivePageIndex = 0;
				this.ActivePlayerTokenRecord = {};

				try {
					ActiveMenu.CloseMenuForPlayer(unPlayerIndex);
				} catch (CaughtError) {
					vecErrors.push(CaughtError);
				}

				if (this.ActiveMenu === null) {
					try {
						const bNextMenuSendResult = this.SendNextMenu();
						const bNextMenuSendSucceeded = RequireBoolean(bNextMenuSendResult, "MenuQueue SendNextMenu result");
						bHideMenu = !bNextMenuSendSucceeded;
					} catch (CaughtError) {
						vecErrors.push(CaughtError);
						bHideMenu = true;
					}
				}

				if (bHideMenu && (this.ActiveMenu === null) && (ActiveMenu.UseTextDialogFallback !== false)) {
					try {
						// Preserve the selection result on false; never hide a new active owner.
						HideMenuForPlayer(unPlayerIndex);
					} catch (CaughtError) {
						vecErrors.push(CaughtError);
					}
				}

				if (vecErrors.length === 1) {
					throw vecErrors[0];
				}

				if (vecErrors.length > 1) {
					throw new AggregateError(vecErrors, "MenuQueue.SelectMenuOption close, transition, or hide failed.");
				}
			}
		}

		return bMenuSelectionHandled;
	}

	HasMenu(MenuObject) {
		const RequestedMenu = RequireMenuQueueMenu(MenuObject);
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		if (ActiveMenu === RequestedMenu) {
			return true;
		}

		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		const unQueueEntryCount = vecMenuQueueEntries.length;
		for (let unQueueEntryIndex = 0; unQueueEntryIndex < unQueueEntryCount; unQueueEntryIndex += 1) {
			const QueueEntry = RequireObjectRecord(vecMenuQueueEntries[unQueueEntryIndex], "MenuQueue queue entry");
			const QueuedMenu = RequireMenuQueueMenu(QueueEntry.Menu);
			if (QueuedMenu === RequestedMenu) {
				return true;
			}
		}

		return false;
	}

	RemoveMenu(MenuObject) {
		const RequestedMenu = RequireMenuQueueMenu(MenuObject);
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		const vecQueueEntryRemovalIndexes = FindMatchingMenuQueueEntryIndexes(vecMenuQueueEntries, RequestedMenu);
		for (let nRemovalIndexPosition = vecQueueEntryRemovalIndexes.length - 1; nRemovalIndexPosition >= 0; nRemovalIndexPosition -= 1) {
			vecMenuQueueEntries.splice(vecQueueEntryRemovalIndexes[nRemovalIndexPosition], 1);
		}

		if (ActiveMenu !== RequestedMenu) {
			return vecQueueEntryRemovalIndexes.length > 0;
		}

		const unPlayerIndex = ResolvePlayerIndex(this.PlayerIndex);
		const vecErrors = [];
		let bHideMenu = false;

		this.ActiveMenu = null;
		this.ActivePageIndex = 0;
		this.ActivePlayerTokenRecord = {};

		try {
			RequestedMenu.CloseMenuForPlayer(unPlayerIndex);
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}

		if (this.ActiveMenu === null) {
			try {
				const bNextMenuSendResult = this.SendNextMenu();
				const bNextMenuSendSucceeded = RequireBoolean(bNextMenuSendResult, "MenuQueue SendNextMenu result");
				bHideMenu = !bNextMenuSendSucceeded;
			} catch (CaughtError) {
				vecErrors.push(CaughtError);
				bHideMenu = true;
			}
		}

		if (bHideMenu && (this.ActiveMenu === null) && (RequestedMenu.UseTextDialogFallback !== false)) {
			try {
				// Hiding is best-effort after ownership is gone; preserve the queue-removal result on false.
				HideMenuForPlayer(unPlayerIndex);
			} catch (CaughtError) {
				vecErrors.push(CaughtError);
			}
		}

		if (vecErrors.length === 1) {
			throw vecErrors[0];
		}

		if (vecErrors.length > 1) {
			throw new AggregateError(vecErrors, "MenuQueue.RemoveMenu close, transition, or hide failed.");
		}

		return true;
	}

	CloseActiveMenu() {
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		if (ActiveMenu === null) {
			return false;
		}

		const unPlayerIndex = ResolvePlayerIndex(this.PlayerIndex);
		const vecErrors = [];
		let bHideMenu = false;

		this.ActiveMenu = null;
		this.ActivePageIndex = 0;
		this.ActivePlayerTokenRecord = {};

		try {
			ActiveMenu.CloseMenuForPlayer(unPlayerIndex);
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}

		if (this.ActiveMenu === null) {
			try {
				const bNextMenuSendResult = this.SendNextMenu();
				const bNextMenuSendSucceeded = RequireBoolean(bNextMenuSendResult, "MenuQueue SendNextMenu result");
				bHideMenu = !bNextMenuSendSucceeded;
			} catch (CaughtError) {
				vecErrors.push(CaughtError);
				bHideMenu = true;
			}
		}

		if (bHideMenu && (this.ActiveMenu === null) && (ActiveMenu.UseTextDialogFallback !== false)) {
			try {
				// Preserve the close result on false; never hide a new active owner.
				HideMenuForPlayer(unPlayerIndex);
			} catch (CaughtError) {
				vecErrors.push(CaughtError);
			}
		}

		if (vecErrors.length === 1) {
			throw vecErrors[0];
		}

		if (vecErrors.length > 1) {
			throw new AggregateError(vecErrors, "MenuQueue.CloseActiveMenu close, transition, or hide failed.");
		}

		return true;
	}

	ClearMenuQueue() {
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);
		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		vecMenuQueueEntries.length = 0;
		this.ActiveMenu = null;
		this.ActivePageIndex = 0;
		this.ActivePlayerTokenRecord = {};

		if (ActiveMenu !== null) {
			const unPlayerIndex = ResolvePlayerIndex(this.PlayerIndex);
			const vecErrors = [];

			try {
				ActiveMenu.CloseMenuForPlayer(unPlayerIndex);
			} catch (CaughtError) {
				vecErrors.push(CaughtError);
			}

			if ((this.ActiveMenu === null) && (ActiveMenu.UseTextDialogFallback !== false)) {
				try {
					// Keep the void result on false; hiding is best-effort after ownership is released.
					HideMenuForPlayer(unPlayerIndex);
				} catch (CaughtError) {
					vecErrors.push(CaughtError);
				}
			}

			if (vecErrors.length === 1) {
				throw vecErrors[0];
			}

			if (vecErrors.length > 1) {
				throw new AggregateError(vecErrors, "MenuQueue.ClearMenuQueue close or hide failed.");
			}
		}
	}

	get Length() {
		const vecMenuQueueEntries = RequireMenuQueueEntryArray(this.PendingMenuEntries);
		const ActiveMenu = RequireNullableMenuQueueMenu(this.ActiveMenu);

		return vecMenuQueueEntries.length + ((ActiveMenu === null) ? 0 : 1);
	}
}

function GetPlayerMenuQueue(PlayerReference) {
	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const ExistingMenuQueue = g_mapMenuQueues.get(unPlayerIndex);
	if (ExistingMenuQueue !== undefined) {
		return ExistingMenuQueue;
	}

	return new MenuQueue(unPlayerIndex);
}

function ListPlayerMenuQueues() {
	return g_mapMenuQueues.values();
}

function CloseActivePlayerMenu(PlayerReference) {
	const bMenuCloseResult = GetPlayerMenuQueue(PlayerReference).CloseActiveMenu();

	return RequireBoolean(bMenuCloseResult, "MenuQueue CloseActiveMenu result");
}

function ClearMenuQueue(PlayerReference) {
	const MenuQueue = GetPlayerMenuQueue(PlayerReference);
	MenuQueue.ClearMenuQueue();
}

module.exports = {
	MenuQueue: MenuQueue,
	ClearMenuQueue: ClearMenuQueue,
	CloseActivePlayerMenu: CloseActivePlayerMenu,
	GetPlayerMenuQueue: GetPlayerMenuQueue,
	ListPlayerMenuQueues: ListPlayerMenuQueues,
	RegisterMenuSelectCommand: RegisterMenuSelectCommand,
};
