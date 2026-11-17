"use strict";

const { GetModule } = require("internal/runtime");
const {
	GetPlayerMenuQueue,
	ListPlayerMenuQueues,
} = require("menus/queue");

const g_MenusRuntime = GetModule("menus");

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

function RequireMap(mapValue, strValueName) {
	if (!(mapValue instanceof Map)) {
		throw new TypeError(`${strValueName} must be a Map.`);
	}

	return mapValue;
}

function ReadBooleanOption(Options, strOptionName, bDefaultOptionValue) {
	if (!Object.hasOwn(Options, strOptionName)) {
		return bDefaultOptionValue;
	}

	const bOptionValue = Options[strOptionName];
	if (bOptionValue === undefined) {
		return bDefaultOptionValue;
	}

	return RequireBoolean(bOptionValue, `menus option ${strOptionName}`);
}

function RequireSafeInteger(nIntegerValue, strValueName, nMinimumValue = 0) {
	if (!Number.isSafeInteger(nIntegerValue) || (nIntegerValue < nMinimumValue)) {
		throw new RangeError(`${strValueName} must be a safe integer greater than or equal to ${nMinimumValue}.`);
	}

	return nIntegerValue;
}

function ResolvePlayerIndex(PlayerReference) {
	if ((PlayerReference !== null) && (typeof PlayerReference === "object") && !Array.isArray(PlayerReference)) {
		const unReferenceIndex = PlayerReference.Index;
		return RequireSafeInteger(unReferenceIndex, "menus PlayerReference.Index", 1);
	}

	return RequireSafeInteger(PlayerReference, "menus player index", 1);
}

function RequireNullableCallback(Callback, strCallbackName) {
	if ((Callback !== null) && (typeof Callback !== "function")) {
		throw new TypeError(`${strCallbackName} must be a function or null.`);
	}

	return Callback;
}

function RequireTokenRecord(TokenRecord) {
	return RequireObjectRecord(TokenRecord, "menus tokens");
}

function FormatTemplate(TemplateValue, TokenFields) {
	return String(TemplateValue).replace(/\{([^}]+)\}/g, (strMatchedText, strFieldName) => {
		if (Object.hasOwn(TokenFields, strFieldName)) {
			return String(TokenFields[strFieldName]);
		}

		return strMatchedText;
	});
}

function NormalizeText(TextValue, unPlayerIndex = 0, TokenRecord = {}) {
	const TokenFields = RequireTokenRecord(TokenRecord);

	if ((TextValue !== null) && (typeof TextValue === "object")) {
		const GetTextCallback = TextValue.GetMenuText;
		if (typeof GetTextCallback === "function") {
			return String(Reflect.apply(GetTextCallback, TextValue, [unPlayerIndex, TokenFields]));
		}

		const GetStringCallback = TextValue.GetTranslatedString;
		if (typeof GetStringCallback === "function") {
			return String(Reflect.apply(GetStringCallback, TextValue, [null, TokenFields]));
		}
	}

	if (typeof TextValue === "function") {
		return String(TextValue(unPlayerIndex, TokenFields));
	}

	if ((TextValue === null) || (TextValue === undefined)) {
		return "";
	}

	return FormatTemplate(TextValue, TokenFields);
}

function NormalizeTargetIndexes(Targets) {
	const vecTargetReferences = Array.isArray(Targets) ? Targets : [Targets];
	const unTargetCount = vecTargetReferences.length;
	if (unTargetCount === 0) {
		throw new RangeError("menus targets must not be empty.");
	}

	const vecTargetIndexes = new Array(unTargetCount);
	for (let unTargetReferenceIndex = 0; unTargetReferenceIndex < unTargetCount; ++unTargetReferenceIndex) {
		vecTargetIndexes[unTargetReferenceIndex] = ResolvePlayerIndex(vecTargetReferences[unTargetReferenceIndex]);
	}

	return vecTargetIndexes;
}

function ReadOptionValue(Options, strOptionName, DefaultOptionValue) {
	if (!Object.hasOwn(Options, strOptionName)) {
		return DefaultOptionValue;
	}

	const OptionValue = Options[strOptionName];
	if (OptionValue === undefined) {
		return DefaultOptionValue;
	}

	return OptionValue;
}

class MenuText {
	constructor(TextValue = "") {
		this.Text = TextValue;
		this.Selectable = false;
	}

	GetMenuText(unPlayerIndex = 0, TokenRecord = {}) {
		return NormalizeText(this.Text, unPlayerIndex, TokenRecord);
	}
}

class SimpleMenuOption extends MenuText {
	constructor(unChoiceIndex, TextValue, OptionValue = null, OptionOptions = {}) {
		const SimpleOptionOptions = RequireObjectRecord(OptionOptions, "SimpleMenuOption options");
		const unNormalizedChoiceIndex = RequireSafeInteger(unChoiceIndex, "SimpleMenuOption ChoiceIndex");
		const bSelectable = ReadBooleanOption(SimpleOptionOptions, "Selectable", true);
		const bHighlighted = ReadBooleanOption(SimpleOptionOptions, "Highlighted", true);

		super(TextValue);

		this.ChoiceIndex = unNormalizedChoiceIndex;
		this.Value = OptionValue;
		this.Selectable = bSelectable;
		this.Highlighted = bHighlighted;
	}
}

class PagedMenuOption extends SimpleMenuOption {
	constructor(TextValue = "", OptionValue = null, OptionOptions = {}) {
		super(0, TextValue, OptionValue, OptionOptions);
	}
}

class MenuRenderData {
	constructor(strMenuTitle, strMenuMessage, unPageIndex = 0, unPageCount = 1) {
		if (typeof strMenuTitle !== "string") {
			throw new TypeError("MenuRenderData MenuTitle must be a string.");
		}

		if (typeof strMenuMessage !== "string") {
			throw new TypeError("MenuRenderData MenuMessage must be a string.");
		}

		const unNormalizedPageIndex = RequireSafeInteger(unPageIndex, "MenuRenderData PageIndex");
		const unNormalizedPageCount = RequireSafeInteger(unPageCount, "MenuRenderData PageCount", 1);

		this.MenuTitle = strMenuTitle;
		this.MenuMessage = strMenuMessage;
		this.PageIndex = unNormalizedPageIndex;
		this.PageCount = unNormalizedPageCount;
	}
}

function NormalizeItem(MenuItem, unFallbackChoiceIndex) {
	if (MenuItem instanceof MenuText) {
		return MenuItem;
	}

	if ((MenuItem !== null) && (typeof MenuItem === "object") && !Array.isArray(MenuItem) && Object.hasOwn(MenuItem, "Text")) {
		const unChoiceIndex = ReadOptionValue(MenuItem, "ChoiceIndex", unFallbackChoiceIndex);
		const ItemText = MenuItem.Text;
		const ItemValue = ReadOptionValue(MenuItem, "Value", null);
		const SimpleOptionOptions = { Highlighted: ReadBooleanOption(MenuItem, "Highlighted", true), Selectable: ReadBooleanOption(MenuItem, "Selectable", true) };
		return new SimpleMenuOption(unChoiceIndex, ItemText, ItemValue, SimpleOptionOptions);
	}

	return new MenuText(MenuItem);
}

function RequireMenuItemArray(vecMenuItems, strValueName) {
	if (!Array.isArray(vecMenuItems)) {
		throw new TypeError(`${strValueName} must be an array.`);
	}

	return vecMenuItems;
}

function ReindexMenuItems(vecMenuItems) {
	const unMenuItemCount = vecMenuItems.length;
	for (let unMenuItemIndex = 0; unMenuItemIndex < unMenuItemCount; ++unMenuItemIndex) {
		const MenuItem = vecMenuItems[unMenuItemIndex];
		if (MenuItem instanceof SimpleMenuOption) {
			MenuItem.ChoiceIndex = unMenuItemIndex + 1;
		}
	}
}

class BaseMenu {
	constructor(Options = {}) {
		const MenuOptions = RequireObjectRecord(Options, "BaseMenu options");
		const vecMenuItems = RequireMenuItemArray(ReadOptionValue(MenuOptions, "Items", []), "BaseMenu options.Items");

		const MenuTitle = ReadOptionValue(MenuOptions, "Title", "");
		const MenuDescription = ReadOptionValue(MenuOptions, "Description", "");
		const unMenuTimeout = RequireSafeInteger(ReadOptionValue(MenuOptions, "Timeout", 10), "BaseMenu Timeout");
		const bQueueEnabled = ReadBooleanOption(MenuOptions, "QueueEnabled", true);
		const bCloseOnSelect = ReadBooleanOption(MenuOptions, "CloseOnSelection", true);
		const SelectCallback = RequireNullableCallback(ReadOptionValue(MenuOptions, "SelectCallback", null), "BaseMenu SelectCallback");
		const BuildCallback = RequireNullableCallback(ReadOptionValue(MenuOptions, "BuildCallback", null), "BaseMenu BuildCallback");
		const CloseCallback = RequireNullableCallback(ReadOptionValue(MenuOptions, "CloseCallback", null), "BaseMenu CloseCallback");
		const InteractionCallback = RequireNullableCallback(ReadOptionValue(MenuOptions, "InteractionCallback", null), "BaseMenu InteractionCallback");
		const ParentMenu = ReadOptionValue(MenuOptions, "ParentMenu", null);
		const bFillMenu = ReadBooleanOption(MenuOptions, "Fill", false);
		const bShowPageNumbers = ReadBooleanOption(MenuOptions, "ShowPages", true);

		if ((ParentMenu !== null) && !(ParentMenu instanceof BaseMenu)) {
			throw new TypeError("BaseMenu ParentMenu must be a BaseMenu or null.");
		}

		const unMenuItemCount = vecMenuItems.length;
		const vecNormalizedItems = new Array(unMenuItemCount);
		for (let unMenuItemIndex = 0; unMenuItemIndex < unMenuItemCount; ++unMenuItemIndex) {
			vecNormalizedItems[unMenuItemIndex] = NormalizeItem(vecMenuItems[unMenuItemIndex], unMenuItemIndex + 1);
		}

		this.ValueTitle = MenuTitle;
		this.ValueDescription = MenuDescription;
		this.ValueCloseText = ReadOptionValue(MenuOptions, "CloseText", "Close");
		this.Timeout = unMenuTimeout;
		this.QueueEnabled = bQueueEnabled;
		this.CloseOnSelection = bCloseOnSelect;
		this.SelectCallback = SelectCallback;
		this.BuildCallback = BuildCallback;
		this.CloseCallback = CloseCallback;
		this.InteractionCallback = InteractionCallback;
		this.ParentMenu = ParentMenu;
		this.Fill = bFillMenu;
		this.ShowPages = bShowPageNumbers;
		this.Items = vecNormalizedItems;
		this.PlayerMenuPages = new Map();
		this.PlayerTokenRecords = new Map();
	}

	AppendMenuItem(MenuItem) {
		const vecMenuItems = RequireMenuItemArray(this.Items, "BaseMenu Items");
		const NormalizedItem = NormalizeItem(MenuItem, vecMenuItems.length + 1);
		vecMenuItems.push(NormalizedItem);

		return NormalizedItem;
	}

	InsertMenuItem(unInsertIndex, MenuItem) {
		const vecMenuItems = RequireMenuItemArray(this.Items, "BaseMenu Items");
		const unNormalizedInsertIndex = RequireSafeInteger(unInsertIndex, "BaseMenu.InsertMenuItem InsertIndex");
		if (unNormalizedInsertIndex > vecMenuItems.length) {
			throw new RangeError("BaseMenu.InsertMenuItem InsertIndex exceeds the menu length.");
		}

		const NormalizedItem = NormalizeItem(MenuItem, unNormalizedInsertIndex + 1);
		vecMenuItems.splice(unNormalizedInsertIndex, 0, NormalizedItem);
		ReindexMenuItems(vecMenuItems);

		return NormalizedItem;
	}

	RemoveMenuItem(MenuItem) {
		const vecMenuItems = RequireMenuItemArray(this.Items, "BaseMenu Items");
		const nMenuItemIndex = vecMenuItems.indexOf(MenuItem);
		if (nMenuItemIndex < 0) {
			return false;
		}

		vecMenuItems.splice(nMenuItemIndex, 1);
		ReindexMenuItems(vecMenuItems);

		return true;
	}

	ClearMenuItems() {
		const vecMenuItems = RequireMenuItemArray(this.Items, "BaseMenu Items");
		vecMenuItems.length = 0;
	}

	ReindexMenuItems() {
		const vecMenuItems = RequireMenuItemArray(this.Items, "BaseMenu Items");
		ReindexMenuItems(vecMenuItems);
	}

	RegisterMenuSelectCallback(SelectCallback) {
		const ValidatedSelectCallback = RequireNullableCallback(SelectCallback, "BaseMenu SelectCallback");
		this.SelectCallback = ValidatedSelectCallback;

		return ValidatedSelectCallback;
	}

	RegisterMenuBuildCallback(BuildCallback) {
		const ValidatedBuildCallback = RequireNullableCallback(BuildCallback, "BaseMenu BuildCallback");
		this.BuildCallback = ValidatedBuildCallback;

		return ValidatedBuildCallback;
	}

	RegisterMenuCloseCallback(CloseCallback) {
		const ValidatedCloseCallback = RequireNullableCallback(CloseCallback, "BaseMenu CloseCallback");
		this.CloseCallback = ValidatedCloseCallback;

		return ValidatedCloseCallback;
	}

	IsActiveMenu(PlayerReference) {
		return GetPlayerMenuQueue(ResolvePlayerIndex(PlayerReference)).ActiveMenu === this;
	}

	SendMenu(TargetReferences, unPageIndex = 0, TokenRecord = {}) {
		const unCurrentPage = RequireSafeInteger(unPageIndex, "BaseMenu.SendMenu PageIndex");
		const TokenFields = RequireTokenRecord(TokenRecord);
		const bQueueEnabled = RequireBoolean(this.QueueEnabled, "BaseMenu QueueEnabled");
		const mapPlayerTokens = RequireMap(this.PlayerTokenRecords, "BaseMenu PlayerTokenRecords");
		const vecTargetIndexes = NormalizeTargetIndexes(TargetReferences);
		let bSendSucceeded = true;
		for (const unPlayerIndex of vecTargetIndexes) {
			mapPlayerTokens.set(unPlayerIndex, TokenFields);

			if (bQueueEnabled) {
				const bAppendResult = GetPlayerMenuQueue(unPlayerIndex).AppendMenu(this, unCurrentPage, TokenFields);
				const bAppendSucceeded = RequireBoolean(bAppendResult, "MenuQueue AppendMenu result");
				bSendSucceeded = bAppendSucceeded && bSendSucceeded;
			} else {
				const bDirectSendResult = this.SendMenuToPlayer(unPlayerIndex, unCurrentPage, TokenFields);
				const bDirectSendSucceeded = RequireBoolean(bDirectSendResult, "BaseMenu SendMenuToPlayer result");
				bSendSucceeded = bDirectSendSucceeded && bSendSucceeded;
			}
		}

		return bSendSucceeded;
	}

	CloseMenu(TargetReferences = null) {
		if (TargetReferences === null) {
			let bMenuRemoved = false;
			for (const MenuQueue of ListPlayerMenuQueues()) {
				if (RequireBoolean(MenuQueue.HasMenu(this), "MenuQueue HasMenu result")) {
					const bRemoveSucceeded = RequireBoolean(MenuQueue.RemoveMenu(this), "MenuQueue RemoveMenu result");
					bMenuRemoved = bRemoveSucceeded || bMenuRemoved;
				}
			}

			return bMenuRemoved;
		}

		const vecTargetIndexes = NormalizeTargetIndexes(TargetReferences);
		let bMenuRemoved = false;
		for (const unPlayerIndex of vecTargetIndexes) {
			const bRemoveSucceeded = RequireBoolean(GetPlayerMenuQueue(unPlayerIndex).RemoveMenu(this), "MenuQueue RemoveMenu result");
			bMenuRemoved = bRemoveSucceeded || bMenuRemoved;
		}

		return bMenuRemoved;
	}

	RefreshMenu(TargetReferences = null) {
		let bMenuRefreshed = false;

		if (TargetReferences === null) {
			for (const MenuQueue of ListPlayerMenuQueues()) {
				if (MenuQueue.ActiveMenu !== this) {
					continue;
				}

				const bRefreshResult = MenuQueue.RefreshActiveMenu();
				const bRefreshSucceeded = RequireBoolean(bRefreshResult, "MenuQueue RefreshActiveMenu result");
				bMenuRefreshed = bRefreshSucceeded || bMenuRefreshed;
			}

			return bMenuRefreshed;
		}

		const vecTargetIndexes = NormalizeTargetIndexes(TargetReferences);
		for (const unPlayerIndex of vecTargetIndexes) {
			const MenuQueue = GetPlayerMenuQueue(unPlayerIndex);
			if (MenuQueue.ActiveMenu !== this) {
				continue;
			}

			const bRefreshResult = MenuQueue.RefreshActiveMenu();
			const bRefreshSucceeded = RequireBoolean(bRefreshResult, "MenuQueue RefreshActiveMenu result");
			bMenuRefreshed = bRefreshSucceeded || bMenuRefreshed;
		}

		return bMenuRefreshed;
	}

	NotifyMenuInteraction(unPlayerIndex, strInteraction, SelectedItem = null) {
		const InteractionCallback = RequireNullableCallback(this.InteractionCallback, "BaseMenu InteractionCallback");
		if (InteractionCallback !== null) {
			Reflect.apply(InteractionCallback, this, [unPlayerIndex, strInteraction, SelectedItem, this]);
		}
	}

	SelectMenuOption(PlayerReference, unChoiceIndex, unPageIndex = 0) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unNormalizedChoiceIndex = RequireSafeInteger(unChoiceIndex, "BaseMenu.SelectMenuOption ChoiceIndex");
		const unCurrentPage = RequireSafeInteger(unPageIndex, "BaseMenu.SelectMenuOption PageIndex");
		const SelectedItem = this.FindMenuChoice(unNormalizedChoiceIndex, unCurrentPage);
		if (SelectedItem === null) {
			return false;
		}

		if (!RequireBoolean(SelectedItem.Selectable, "BaseMenu selected item Selectable")) {
			return false;
		}

		const SelectCallback = RequireNullableCallback(this.SelectCallback, "BaseMenu SelectCallback");

		this.NotifyMenuInteraction(unPlayerIndex, "Select", SelectedItem);

		if (SelectCallback !== null) {
			Reflect.apply(SelectCallback, this, [unPlayerIndex, SelectedItem.Value, SelectedItem, this]);
		}

		return true;
	}

	ShouldCloseMenuAfterSelection(unChoiceIndex, unPageIndex = 0) {
		RequireSafeInteger(unChoiceIndex, "BaseMenu.ShouldCloseMenuAfterSelection ChoiceIndex");
		RequireSafeInteger(unPageIndex, "BaseMenu.ShouldCloseMenuAfterSelection PageIndex");

		return RequireBoolean(this.CloseOnSelection, "BaseMenu CloseOnSelection");
	}

	GetMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unCurrentPage = RequireSafeInteger(unPageIndex, "BaseMenu.GetMenuRenderData PageIndex");
		const TokenFields = RequireTokenRecord(TokenRecord);

		return this.BuildMenuRenderData(unPlayerIndex, unCurrentPage, TokenFields);
	}

	SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unCurrentPage = RequireSafeInteger(unPageIndex, "BaseMenu.SendMenuToPlayer PageIndex");
		const TokenFields = RequireTokenRecord(TokenRecord);
		const mapPlayerPages = RequireMap(this.PlayerMenuPages, "BaseMenu PlayerMenuPages");
		const mapPlayerTokens = RequireMap(this.PlayerTokenRecords, "BaseMenu PlayerTokenRecords");
		const BuildCallback = RequireNullableCallback(this.BuildCallback, "BaseMenu BuildCallback");
		mapPlayerPages.set(unPlayerIndex, unCurrentPage);
		mapPlayerTokens.set(unPlayerIndex, TokenFields);

		if (BuildCallback !== null) {
			Reflect.apply(BuildCallback, this, [this, unPlayerIndex, unCurrentPage, TokenFields]);
		}

		const MenuData = this.BuildMenuRenderData(unPlayerIndex, unCurrentPage, TokenFields);
		const unDisplayTime = RequireSafeInteger(this.Timeout, "BaseMenu Timeout");
		const bShowTextResult = g_MenusRuntime.ShowText(unPlayerIndex, MenuData.MenuTitle, MenuData.MenuMessage, unDisplayTime);

		return RequireBoolean(bShowTextResult, "menus.ShowText result");
	}

	CloseMenuForPlayer(PlayerReference) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const mapPlayerPages = RequireMap(this.PlayerMenuPages, "BaseMenu PlayerMenuPages");
		const mapPlayerTokens = RequireMap(this.PlayerTokenRecords, "BaseMenu PlayerTokenRecords");
		const CloseCallback = RequireNullableCallback(this.CloseCallback, "BaseMenu CloseCallback");
		mapPlayerPages.delete(unPlayerIndex);
		mapPlayerTokens.delete(unPlayerIndex);

		if (CloseCallback !== null) {
			Reflect.apply(CloseCallback, this, [unPlayerIndex, this]);
		}
	}

	BuildMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unCurrentPage = RequireSafeInteger(unPageIndex, "BaseMenu.BuildMenuRenderData PageIndex");
		const TokenFields = RequireTokenRecord(TokenRecord);
		const vecMenuItems = RequireMenuItemArray(this.Items, "BaseMenu Items");
		const unMenuItemCount = vecMenuItems.length;
		const RenderItemCallback = this.RenderMenuItem;
		if (typeof RenderItemCallback !== "function") {
			throw new TypeError("BaseMenu RenderMenuItem must be a function.");
		}

		const vecMenuLines = [];
		const strMenuTitle = NormalizeText(this.ValueTitle, unPlayerIndex, TokenFields);
		const strMenuDescription = NormalizeText(this.ValueDescription, unPlayerIndex, TokenFields);
		if (strMenuDescription.length > 0) {
			vecMenuLines.push(strMenuDescription);
			vecMenuLines.push("");
		}

		for (let unMenuItemIndex = 0; unMenuItemIndex < unMenuItemCount; ++unMenuItemIndex) {
			const strRenderedItem = Reflect.apply(RenderItemCallback, this, [vecMenuItems[unMenuItemIndex], unPlayerIndex, TokenFields]);
			if (typeof strRenderedItem !== "string") {
				throw new TypeError("BaseMenu RenderMenuItem must return a string.");
			}

			vecMenuLines.push(strRenderedItem);
		}

		return new MenuRenderData(strMenuTitle, vecMenuLines.join("\n"), unCurrentPage, 1);
	}

	FindMenuChoice(unChoiceIndex, unPageIndex = 0) {
		const unNormalizedChoiceIndex = RequireSafeInteger(unChoiceIndex, "BaseMenu.FindMenuChoice ChoiceIndex");
		const unCurrentPage = RequireSafeInteger(unPageIndex, "BaseMenu.FindMenuChoice PageIndex");
		const vecSelectableMenuItems = RequireMenuItemArray(this.GetMenuOptions(unCurrentPage), "BaseMenu SelectableItems");
		for (const MenuItem of vecSelectableMenuItems) {
			const unMenuItemChoiceIndex = RequireSafeInteger(MenuItem.ChoiceIndex, "BaseMenu SelectableItem ChoiceIndex");
			if (unMenuItemChoiceIndex === unNormalizedChoiceIndex) {
				return MenuItem;
			}
		}

		return null;
	}

	GetMenuOptions() {
		const vecMenuItems = RequireMenuItemArray(this.Items, "BaseMenu Items");
		const unMenuItemCount = vecMenuItems.length;
		const vecSelectableMenuItems = [];
		for (let unMenuItemIndex = 0; unMenuItemIndex < unMenuItemCount; ++unMenuItemIndex) {
			const MenuItem = vecMenuItems[unMenuItemIndex];
			if (MenuItem instanceof SimpleMenuOption) {
				vecSelectableMenuItems.push(MenuItem);
			}
		}

		return vecSelectableMenuItems.slice();
	}

	RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {}) {
		if (!(MenuItem instanceof MenuText)) {
			throw new TypeError("BaseMenu MenuItem must be a MenuText instance.");
		}

		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const TokenFields = RequireTokenRecord(TokenRecord);
		const GetTextCallback = MenuItem.GetMenuText;
		if (typeof GetTextCallback !== "function") {
			throw new TypeError("BaseMenu MenuItem.GetMenuText must be a function.");
		}

		const strRenderedText = Reflect.apply(GetTextCallback, MenuItem, [unPlayerIndex, TokenFields]);
		if (typeof strRenderedText !== "string") {
			throw new TypeError("BaseMenu MenuItem.GetMenuText must return a string.");
		}

		if (MenuItem instanceof SimpleMenuOption) {
			const unChoiceIndex = RequireSafeInteger(MenuItem.ChoiceIndex, "BaseMenu MenuItem ChoiceIndex");
			return `${unChoiceIndex}. ${strRenderedText}`;
		}

		return strRenderedText;
	}

	[Symbol.iterator]() {
		return RequireMenuItemArray(this.Items, "BaseMenu Items")[Symbol.iterator]();
	}

	get Length() {
		return RequireMenuItemArray(this.Items, "BaseMenu Items").length;
	}
}

class SimpleMenu extends BaseMenu {
}

class PagedMenu extends BaseMenu {
	constructor(Options = {}) {
		const MenuOptions = RequireObjectRecord(Options, "PagedMenu options");
		const unItemsPerPage = RequireSafeInteger(ReadOptionValue(MenuOptions, "ItemsPerPage", 7), "PagedMenu ItemsPerPage", 1);
		const unBackChoice = RequireSafeInteger(ReadOptionValue(MenuOptions, "BackChoiceIndex", 8), "PagedMenu BackChoiceIndex");
		const unNextChoice = RequireSafeInteger(ReadOptionValue(MenuOptions, "NextChoiceIndex", 9), "PagedMenu NextChoiceIndex");
		const unCloseChoice = RequireSafeInteger(ReadOptionValue(MenuOptions, "CloseChoiceIndex", 0), "PagedMenu CloseChoiceIndex");
		const BackText = ReadOptionValue(MenuOptions, "BackText", "Back");
		const NextText = ReadOptionValue(MenuOptions, "NextText", "Next");

		super(MenuOptions);

		this.ItemsPerPage = unItemsPerPage;
		this.BackChoiceIndex = unBackChoice;
		this.NextChoiceIndex = unNextChoice;
		this.CloseChoiceIndex = unCloseChoice;
		this.ValueBackText = BackText;
		this.ValueNextText = NextText;
	}

	SelectMenuOption(PlayerReference, unChoiceIndex, unPageIndex = 0) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unNormalizedChoiceIndex = RequireSafeInteger(unChoiceIndex, "PagedMenu.SelectMenuOption ChoiceIndex");
		const unCurrentPage = RequireSafeInteger(unPageIndex, "PagedMenu.SelectMenuOption PageIndex");
		const unBackChoice = RequireSafeInteger(this.BackChoiceIndex, "PagedMenu BackChoiceIndex");
		const unNextChoice = RequireSafeInteger(this.NextChoiceIndex, "PagedMenu NextChoiceIndex");
		const unCloseChoice = RequireSafeInteger(this.CloseChoiceIndex, "PagedMenu CloseChoiceIndex");
		const MenuQueue = GetPlayerMenuQueue(unPlayerIndex);
		const TokenRecord = (MenuQueue.ActiveMenu === this) ? MenuQueue.ActivePlayerTokenRecord : this.GetPlayerTokenRecord(unPlayerIndex);
		const TokenFields = RequireTokenRecord(TokenRecord);
		if (unNormalizedChoiceIndex === unBackChoice) {
			const ParentMenu = this.ParentMenu;
			if ((unCurrentPage === 0) && (ParentMenu !== null)) {
				if (!(ParentMenu instanceof BaseMenu)) {
					throw new TypeError("PagedMenu ParentMenu must be a BaseMenu or null.");
				}

				const bParentSendResult = MenuQueue.SendMenu(ParentMenu, 0, TokenFields);
				if (bParentSendResult === true) {
					this.NotifyMenuInteraction(unPlayerIndex, "ExitBack");
				}

				return RequireBoolean(bParentSendResult, "MenuQueue ParentMenu send result");
			}

			if (unCurrentPage === 0) {
				return false;
			}

			const bBackSendResult = MenuQueue.SendMenu(this, unCurrentPage - 1, TokenFields);
			if (bBackSendResult === true) {
				this.NotifyMenuInteraction(unPlayerIndex, "Back");
			}

			return RequireBoolean(bBackSendResult, "MenuQueue Back send result");
		}

		if (unNormalizedChoiceIndex === unNextChoice) {
			const unLastPageIndex = RequireSafeInteger(this.LastPageIndex, "PagedMenu LastPageIndex");
			if (unCurrentPage < unLastPageIndex) {
				const bNextSendResult = MenuQueue.SendMenu(this, unCurrentPage + 1, TokenFields);
				if (bNextSendResult === true) {
					this.NotifyMenuInteraction(unPlayerIndex, "Next");
				}

				return RequireBoolean(bNextSendResult, "MenuQueue Next send result");
			}
		}

		if (unNormalizedChoiceIndex === unCloseChoice) {
			const bClosed = RequireBoolean(MenuQueue.CloseActiveMenu(), "MenuQueue CloseActiveMenu result");
			if (bClosed) {
				this.NotifyMenuInteraction(unPlayerIndex, "Exit");
			}

			return bClosed;
		}

		return super.SelectMenuOption(unPlayerIndex, unNormalizedChoiceIndex, unCurrentPage);
	}

	ShouldCloseMenuAfterSelection(unChoiceIndex, unPageIndex = 0) {
		const unNormalizedChoiceIndex = RequireSafeInteger(unChoiceIndex, "PagedMenu.ShouldCloseMenuAfterSelection ChoiceIndex");
		const unCurrentPage = RequireSafeInteger(unPageIndex, "PagedMenu.ShouldCloseMenuAfterSelection PageIndex");
		const unBackChoice = RequireSafeInteger(this.BackChoiceIndex, "PagedMenu BackChoiceIndex");
		const unNextChoice = RequireSafeInteger(this.NextChoiceIndex, "PagedMenu NextChoiceIndex");
		const unCloseChoice = RequireSafeInteger(this.CloseChoiceIndex, "PagedMenu CloseChoiceIndex");
		const bIsBackChoice = unNormalizedChoiceIndex === unBackChoice;
		const bIsNextChoice = unNormalizedChoiceIndex === unNextChoice;
		const bIsCloseChoice = unNormalizedChoiceIndex === unCloseChoice;
		const bIsNavigationChoice = bIsBackChoice || bIsNextChoice || bIsCloseChoice;
		if (bIsNavigationChoice) {
			return false;
		}

		return super.ShouldCloseMenuAfterSelection(unNormalizedChoiceIndex, unCurrentPage);
	}

	GetMenuPageCount() {
		const vecMenuItems = RequireMenuItemArray(this.Items, "PagedMenu Items");
		const unItemsPerPage = RequireSafeInteger(this.ItemsPerPage, "PagedMenu ItemsPerPage", 1);

		return Math.max(1, Math.ceil(vecMenuItems.length / unItemsPerPage));
	}

	SetPlayerPage(PlayerReference, unPageIndex) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unRequestedPage = RequireSafeInteger(unPageIndex, "PagedMenu.SetPlayerPage PageIndex");
		const unLastPageIndex = RequireSafeInteger(this.LastPageIndex, "PagedMenu LastPageIndex");
		const mapPlayerPages = RequireMap(this.PlayerMenuPages, "PagedMenu PlayerMenuPages");
		const unCurrentPage = Math.min(unRequestedPage, unLastPageIndex);
		mapPlayerPages.set(unPlayerIndex, unCurrentPage);

		return unCurrentPage;
	}

	GetPlayerMenuPage(PlayerReference) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const mapPlayerPages = RequireMap(this.PlayerMenuPages, "PagedMenu PlayerMenuPages");
		if (!mapPlayerPages.has(unPlayerIndex)) {
			return 0;
		}

		return RequireSafeInteger(mapPlayerPages.get(unPlayerIndex), "PagedMenu StoredPageIndex");
	}

	GetPlayerTokenRecord(PlayerReference) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const mapPlayerTokens = RequireMap(this.PlayerTokenRecords, "PagedMenu PlayerTokenRecords");
		if (!mapPlayerTokens.has(unPlayerIndex)) {
			return {};
		}

		return RequireTokenRecord(mapPlayerTokens.get(unPlayerIndex));
	}

	BuildMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unRequestedPage = RequireSafeInteger(unPageIndex, "PagedMenu.BuildMenuRenderData PageIndex");
		const TokenFields = RequireTokenRecord(TokenRecord);
		const unTotalPageCount = RequireSafeInteger(this.GetMenuPageCount(), "PagedMenu PageCount", 1);
		const unCurrentPage = RequireSafeInteger(this.SetPlayerPage(unPlayerIndex, unRequestedPage), "PagedMenu CurrentPageIndex");
		const vecMenuItems = RequireMenuItemArray(this.Items, "PagedMenu Items");
		const unItemsPerPage = RequireSafeInteger(this.ItemsPerPage, "PagedMenu ItemsPerPage", 1);
		const bShowPageNumbers = RequireBoolean(this.ShowPages, "PagedMenu ShowPages");
		const RenderItemCallback = this.RenderMenuItem;
		if (typeof RenderItemCallback !== "function") {
			throw new TypeError("PagedMenu RenderMenuItem must be a function.");
		}

		const unStartIndex = unCurrentPage * unItemsPerPage;
		const unEndIndex = Math.min(unStartIndex + unItemsPerPage, vecMenuItems.length);
		const vecMenuLines = [];
		const strBaseTitle = NormalizeText(this.ValueTitle, unPlayerIndex, TokenFields);
		let strMenuTitle = strBaseTitle;
		if (bShowPageNumbers && (unTotalPageCount > 1)) {
			strMenuTitle = `${strBaseTitle} [${unCurrentPage + 1}/${unTotalPageCount}]`;
		}

		const strMenuDescription = NormalizeText(this.ValueDescription, unPlayerIndex, TokenFields);
		if (strMenuDescription.length > 0) {
			vecMenuLines.push(strMenuDescription);
			vecMenuLines.push("");
		}

		for (let unMenuItemIndex = unStartIndex; unMenuItemIndex < unEndIndex; ++unMenuItemIndex) {
			const MenuItem = vecMenuItems[unMenuItemIndex];
			if (MenuItem instanceof SimpleMenuOption) {
				MenuItem.ChoiceIndex = unMenuItemIndex - unStartIndex + 1;
			}

			const strRenderedItem = Reflect.apply(RenderItemCallback, this, [MenuItem, unPlayerIndex, TokenFields]);
			if (typeof strRenderedItem !== "string") {
				throw new TypeError("PagedMenu RenderMenuItem must return a string.");
			}

			vecMenuLines.push(strRenderedItem);
		}

		if (unTotalPageCount > 1) {
			vecMenuLines.push("");

			if (unCurrentPage > 0) {
				const unBackChoice = RequireSafeInteger(this.BackChoiceIndex, "PagedMenu BackChoiceIndex");
				const strBackText = NormalizeText(this.ValueBackText, unPlayerIndex, TokenFields);
				vecMenuLines.push(`${unBackChoice}. ${strBackText}`);
			}

			if (unCurrentPage < (unTotalPageCount - 1)) {
				const unNextChoice = RequireSafeInteger(this.NextChoiceIndex, "PagedMenu NextChoiceIndex");
				const strNextText = NormalizeText(this.ValueNextText, unPlayerIndex, TokenFields);
				vecMenuLines.push(`${unNextChoice}. ${strNextText}`);
			}
		}

		return new MenuRenderData(strMenuTitle.trim(), vecMenuLines.join("\n"), unCurrentPage, unTotalPageCount);
	}

	GetMenuOptions(unPageIndex = 0) {
		const unRequestedPage = RequireSafeInteger(unPageIndex, "PagedMenu.GetMenuOptions PageIndex");
		const unLastPageIndex = RequireSafeInteger(this.LastPageIndex, "PagedMenu LastPageIndex");
		const vecMenuItems = RequireMenuItemArray(this.Items, "PagedMenu Items");
		const unItemsPerPage = RequireSafeInteger(this.ItemsPerPage, "PagedMenu ItemsPerPage", 1);
		const unCurrentPage = Math.min(unRequestedPage, unLastPageIndex);
		const unStartIndex = unCurrentPage * unItemsPerPage;
		const unEndIndex = Math.min(unStartIndex + unItemsPerPage, vecMenuItems.length);
		const vecSelectableMenuItems = [];
		for (let unMenuItemIndex = unStartIndex; unMenuItemIndex < unEndIndex; ++unMenuItemIndex) {
			const MenuItem = vecMenuItems[unMenuItemIndex];
			if (MenuItem instanceof SimpleMenuOption) {
				vecSelectableMenuItems.push(MenuItem);
			}
		}

		return vecSelectableMenuItems;
	}

	get LastPageIndex() {
		return this.GetMenuPageCount() - 1;
	}
}

module.exports = {
	BaseMenu: BaseMenu,
	MenuRenderData: MenuRenderData,
	MenuText: MenuText,
	PagedMenu: PagedMenu,
	PagedMenuOption: PagedMenuOption,
	SimpleMenu: SimpleMenu,
	SimpleMenuOption: SimpleMenuOption,
};
