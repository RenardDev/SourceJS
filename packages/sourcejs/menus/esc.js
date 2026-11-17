"use strict";

const { GetModule } = require("internal/runtime");
const {
	BaseMenu,
	PagedMenu,
	PagedMenuOption,
	SimpleMenuOption,
	MenuText,
} = require("menus");

const g_unButtonBack = 6;
const g_unButtonClose = 0;
const g_unButtonNext = 7;
const g_unMaximumItemCount = 5;
const g_vecValidChoices = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);
const g_unMaximumDialogLevel = 1024;
const g_strSelectionCommand = "menuselect";
const g_MessagesRuntime = GetModule("messages");
const g_DialogTypes = g_MessagesRuntime.GetDialogTypes();
const g_mapDialogLevels = new Map();

function RequireObjectRecord(RecordValue, strValueName) {
	if ((RecordValue === null) || (typeof RecordValue !== "object") || Array.isArray(RecordValue)) {
		throw new TypeError(`${strValueName} must be an object.`);
	}

	return RecordValue;
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

function RequireNullableCallback(Callback, strCallbackName) {
	if ((Callback !== null) && (typeof Callback !== "function")) {
		throw new TypeError(`${strCallbackName} must be a function or null.`);
	}

	return Callback;
}

function RequireSafeInteger(nIntegerValue, strValueName, nMinimumValue = 0) {
	if (!Number.isSafeInteger(nIntegerValue) || (nIntegerValue < nMinimumValue)) {
		throw new RangeError(`${strValueName} must be a safe integer greater than or equal to ${nMinimumValue}.`);
	}

	return nIntegerValue;
}

function ResolvePlayerIndex(PlayerReference) {
	if ((PlayerReference !== null) && (typeof PlayerReference === "object") && !Array.isArray(PlayerReference)) {
		return RequireSafeInteger(PlayerReference.Index, "ESCMenu PlayerReference.Index", 1);
	}

	return RequireSafeInteger(PlayerReference, "ESCMenu PlayerReference", 1);
}

function RequireESCChoiceIndex(unChoiceIndex) {
	const unNormalizedChoiceIndex = RequireSafeInteger(unChoiceIndex, "SimpleESCOption ChoiceIndex", 1);
	if (!g_vecValidChoices.includes(unNormalizedChoiceIndex)) {
		throw new RangeError("SimpleESCOption ChoiceIndex must be between 1 and 7.");
	}

	return unNormalizedChoiceIndex;
}

function RequireESCItemsPerPage(unItemsPerPage) {
	const unNormalizedItemsPerPage = RequireSafeInteger(unItemsPerPage, "PagedESCMenu ItemsPerPage", 1);
	if (unNormalizedItemsPerPage > g_unMaximumItemCount) {
		throw new RangeError(`PagedESCMenu ItemsPerPage must not exceed ${g_unMaximumItemCount}.`);
	}

	return unNormalizedItemsPerPage;
}

function AllocateDialogLevel(PlayerReference) {
	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	let unPreviousDialogLevel = 0;
	if (g_mapDialogLevels.has(unPlayerIndex)) {
		unPreviousDialogLevel = RequireSafeInteger(g_mapDialogLevels.get(unPlayerIndex), "ESC stored dialog level", 1);
	}

	const unDialogLevel = (unPreviousDialogLevel >= g_unMaximumDialogLevel) ? 1 : (unPreviousDialogLevel + 1);
	g_mapDialogLevels.set(unPlayerIndex, unDialogLevel);

	return unDialogLevel;
}

function RenderESCText(TextValue, PlayerReference, TokenRecord = {}) {
	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const TokenFields = RequireObjectRecord(TokenRecord, "ESC menu tokens");

	return new MenuText(TextValue).GetMenuText(unPlayerIndex, TokenFields);
}

function* IterateMenuItemRange(vecMenuItems, unStartIndex, unEndIndex) {
	for (let unMenuItemIndex = unStartIndex; unMenuItemIndex < unEndIndex; ++unMenuItemIndex) {
		yield vecMenuItems[unMenuItemIndex];
	}
}

function CreatePageMenuItemIterable(Menu, unPageIndex) {
	if (!(Menu instanceof BaseMenu)) {
		throw new TypeError("ESC menu must be a BaseMenu.");
	}

	const vecMenuItems = Menu.Items;
	if (!Array.isArray(vecMenuItems)) {
		throw new TypeError("ESC menu Items must be an array.");
	}

	const unCurrentPage = RequireSafeInteger(unPageIndex, "ESCMenu PageIndex");
	let unStartIndex = 0;
	let unEndIndex = vecMenuItems.length;
	if (Menu instanceof PagedMenu) {
		const unItemsPerPage = RequireESCItemsPerPage(Menu.ItemsPerPage);
		unStartIndex = unCurrentPage * unItemsPerPage;
		unEndIndex = Math.min(unStartIndex + unItemsPerPage, vecMenuItems.length);
	}

	return {
		[Symbol.iterator]() {
			return IterateMenuItemRange(vecMenuItems, unStartIndex, unEndIndex);
		},
	};
}

function RenderESCMenuMessage(Menu, MenuItems, unPlayerIndex, TokenRecord, RenderItemCallback) {
	const vecMenuLines = [];
	const strMenuDescription = RenderESCText(Menu.ValueDescription, unPlayerIndex, TokenRecord);
	if (strMenuDescription.length > 0) {
		vecMenuLines.push(strMenuDescription);
	}

	for (const MenuItem of MenuItems) {
		if (!(MenuItem instanceof SimpleMenuOption)) {
			const strRenderedItem = Reflect.apply(RenderItemCallback, Menu, [MenuItem, unPlayerIndex, TokenRecord]);
			if (typeof strRenderedItem !== "string") {
				throw new TypeError("ESC menu RenderMenuItem must return a string.");
			}

			vecMenuLines.push(strRenderedItem);
		}
	}

	return vecMenuLines.join("\n");
}

function RequireDialogChoiceIndex(unChoiceIndex) {
	const unNormalizedChoiceIndex = RequireSafeInteger(unChoiceIndex, "ESC dialog ChoiceIndex");
	if (!g_vecValidChoices.includes(unNormalizedChoiceIndex)) {
		throw new RangeError("ESC dialog ChoiceIndex must be between 0 and 7.");
	}

	return unNormalizedChoiceIndex;
}

function AddDialogOption(DialogValues, unChoiceIndex, strOptionText, bIncludeCommand = true) {
	const NormalizedDialogValues = RequireObjectRecord(DialogValues, "ESC dialog values");
	const unNormalizedChoiceIndex = RequireDialogChoiceIndex(unChoiceIndex);
	const bIncludeSelectionCommand = RequireBoolean(bIncludeCommand, "ESC dialog bIncludeCommand");
	if (typeof strOptionText !== "string") {
		throw new TypeError("ESC dialog strOptionText must be a string.");
	}

	const DialogOption = { Msg: strOptionText };
	if (bIncludeSelectionCommand) {
		DialogOption.Command = `${g_strSelectionCommand} ${unNormalizedChoiceIndex}`;
	}

	NormalizedDialogValues[String(unNormalizedChoiceIndex)] = DialogOption;
}

function AddPagedDialogOptions(DialogValues, Menu, unPlayerIndex, unCurrentPage, TokenRecord) {
	if (!(Menu instanceof PagedMenu)) {
		throw new TypeError("ESC paged menu must be a PagedMenu.");
	}

	const NormalizedDialogValues = RequireObjectRecord(DialogValues, "ESC dialog values");
	const unItemsPerPage = RequireESCItemsPerPage(Menu.ItemsPerPage);
	const bFillMenu = RequireBoolean(Menu.Fill, "PagedESCMenu Fill");
	const unBackChoice = RequireDialogChoiceIndex(Menu.BackChoiceIndex);
	const unNextChoice = RequireDialogChoiceIndex(Menu.NextChoiceIndex);
	const unCloseChoice = RequireDialogChoiceIndex(Menu.CloseChoiceIndex);
	for (let unChoiceIndex = 1; unChoiceIndex <= unItemsPerPage; ++unChoiceIndex) {
		if (bFillMenu && !Object.hasOwn(NormalizedDialogValues, String(unChoiceIndex))) {
			AddDialogOption(NormalizedDialogValues, unChoiceIndex, "", false);
		}
	}

	const strBackText = RenderESCText(Menu.ValueBackText, unPlayerIndex, TokenRecord);
	const strNextText = RenderESCText(Menu.ValueNextText, unPlayerIndex, TokenRecord);
	const strCloseText = RenderESCText(Menu.ValueCloseText, unPlayerIndex, TokenRecord);

	if (bFillMenu || (unCurrentPage > 0) || (Menu.ParentMenu !== null)) {
		AddDialogOption(NormalizedDialogValues, unBackChoice, `${unBackChoice}. ${strBackText}`);
	}

	if (bFillMenu || (unCurrentPage < Menu.LastPageIndex)) {
		AddDialogOption(NormalizedDialogValues, unNextChoice, `${unNextChoice}. ${strNextText}`);
	}

	AddDialogOption(NormalizedDialogValues, unCloseChoice, `${unCloseChoice}. ${strCloseText}`);
}

function BuildDialogValues(Menu, PlayerReference, unPageIndex, TokenRecord) {
	if (!(Menu instanceof BaseMenu)) {
		throw new TypeError("ESC menu must be a BaseMenu.");
	}

	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const unRequestedPage = RequireSafeInteger(unPageIndex, "ESCMenu PageIndex");
	const TokenFields = RequireObjectRecord(TokenRecord, "ESC menu tokens");
	const BuildMenuDataCallback = Menu.BuildMenuRenderData;
	const RenderItemCallback = Menu.RenderMenuItem;
	if (typeof BuildMenuDataCallback !== "function") {
		throw new TypeError("ESC menu BuildMenuRenderData must be a function.");
	}

	if (typeof RenderItemCallback !== "function") {
		throw new TypeError("ESC menu RenderMenuItem must be a function.");
	}

	const MenuData = RequireObjectRecord(Reflect.apply(BuildMenuDataCallback, Menu, [unPlayerIndex, unRequestedPage, TokenFields]), "ESC menu data");
	const unCurrentPage = RequireSafeInteger(MenuData.PageIndex, "ESC menu data PageIndex");
	const strMenuTitle = MenuData.MenuTitle;
	if (typeof strMenuTitle !== "string") {
		throw new TypeError("ESC menu data MenuTitle must be a string.");
	}

	const MenuItems = CreatePageMenuItemIterable(Menu, unCurrentPage);
	const unDisplayTime = RequireSafeInteger(Menu.Timeout, "ESC menu Timeout");
	const TitleColor = Menu.ValueTitleColor;
	// Color must match the native converter exactly; other SDK KeyValues names are case-insensitive.
	const DialogValues = { Msg: RenderESCMenuMessage(Menu, MenuItems, unPlayerIndex, TokenFields, RenderItemCallback), Time: unDisplayTime, Title: strMenuTitle };
	if (TitleColor !== null) {
		DialogValues.Color = TitleColor;
	}

	for (const MenuItem of MenuItems) {
		if (MenuItem instanceof SimpleMenuOption) {
			const strRenderedItem = Reflect.apply(RenderItemCallback, Menu, [MenuItem, unPlayerIndex, TokenFields]);
			if (typeof strRenderedItem !== "string") {
				throw new TypeError("ESC menu RenderMenuItem must return a string.");
			}

			AddDialogOption(DialogValues, MenuItem.ChoiceIndex, strRenderedItem);
		}
	}

	if (Menu instanceof PagedMenu) {
		AddPagedDialogOptions(DialogValues, Menu, unPlayerIndex, unCurrentPage, TokenFields);
	} else {
		const strCloseText = RenderESCText(Menu.ValueCloseText, unPlayerIndex, TokenFields);
		AddDialogOption(DialogValues, g_unButtonClose, `${g_unButtonClose}. ${strCloseText}`);
	}

	DialogValues.Level = AllocateDialogLevel(unPlayerIndex);

	return DialogValues;
}

function SendESCDialog(PlayerReference, DialogValues) {
	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const NormalizedDialogValues = RequireObjectRecord(DialogValues, "ESC dialog values");
	const bCreateDialogResult = g_MessagesRuntime.CreateDialog(unPlayerIndex, g_DialogTypes.Menu, NormalizedDialogValues, "menu");

	return RequireBoolean(bCreateDialogResult, "messages.CreateDialog result");
}

function HideESCDialog(PlayerReference, unDisplayTime) {
	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const unNormalizedDisplayTime = RequireSafeInteger(unDisplayTime, "ESC dialog DisplayTime");

	return SendESCDialog(unPlayerIndex, { Level: AllocateDialogLevel(unPlayerIndex), Msg: "", Time: unNormalizedDisplayTime, Title: "" });
}

function SendMenuToPlayer(Menu, PlayerReference, unPageIndex, TokenRecord) {
	if (!(Menu instanceof BaseMenu)) {
		throw new TypeError("ESC menu must be a BaseMenu.");
	}

	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const unCurrentPage = RequireSafeInteger(unPageIndex, "ESC menu SendMenuToPlayer PageIndex");
	const TokenFields = RequireObjectRecord(TokenRecord, "ESC menu tokens");
	const mapPlayerPages = RequireMap(Menu.PlayerMenuPages, "ESC menu PlayerMenuPages");
	const mapPlayerTokens = RequireMap(Menu.PlayerTokenRecords, "ESC menu PlayerTokenRecords");
	const BuildCallback = RequireNullableCallback(Menu.BuildCallback, "ESC menu BuildCallback");
	mapPlayerPages.set(unPlayerIndex, unCurrentPage);
	mapPlayerTokens.set(unPlayerIndex, TokenFields);

	if (BuildCallback !== null) {
		Reflect.apply(BuildCallback, Menu, [Menu, unPlayerIndex, unCurrentPage, TokenFields]);
	}

	return SendESCDialog(unPlayerIndex, BuildDialogValues(Menu, unPlayerIndex, unCurrentPage, TokenFields));
}

function CloseMenuForPlayer(Menu, PlayerReference) {
	if (!(Menu instanceof BaseMenu)) {
		throw new TypeError("ESC menu must be a BaseMenu.");
	}

	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const mapPlayerPages = RequireMap(Menu.PlayerMenuPages, "ESC menu PlayerMenuPages");
	const unDisplayTime = RequireSafeInteger(Menu.Timeout, "ESC menu Timeout");
	const bWasDisplayed = mapPlayerPages.has(unPlayerIndex);
	BaseMenu.prototype.CloseMenuForPlayer.call(Menu, unPlayerIndex);

	if (bWasDisplayed) {
		HideESCDialog(unPlayerIndex, unDisplayTime);
	}
}

function RenderESCMenuItemText(MenuItem, PlayerReference, TokenRecord) {
	if (!(MenuItem instanceof MenuText)) {
		throw new TypeError("ESC menu MenuItem must be a MenuText instance.");
	}

	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const TokenFields = RequireObjectRecord(TokenRecord, "ESC menu tokens");
	const GetTextCallback = MenuItem.GetMenuText;
	if (typeof GetTextCallback !== "function") {
		throw new TypeError("ESC menu MenuItem.GetMenuText must be a function.");
	}

	const strRenderedText = Reflect.apply(GetTextCallback, MenuItem, [unPlayerIndex, TokenFields]);
	if (typeof strRenderedText !== "string") {
		throw new TypeError("ESC menu MenuItem.GetMenuText must return a string.");
	}

	return strRenderedText;
}

class SimpleESCOption extends SimpleMenuOption {
	constructor(unChoiceIndex, TextValue, OptionValue = null, OptionOptions = {}) {
		super(RequireESCChoiceIndex(unChoiceIndex), TextValue, OptionValue, OptionOptions);
	}
}

class PagedESCOption extends PagedMenuOption {
	constructor(TextValue = "", OptionValue = null, OptionOptions = {}) {
		super(TextValue, OptionValue, OptionOptions);
	}
}

class ListESCOption extends PagedESCOption {
	constructor(TextValue = "", OptionOptions = {}) {
		const NormalizedOptionOptions = RequireObjectRecord(OptionOptions, "ListESCOption options");
		const bHighlighted = RequireBoolean(ReadOptionValue(NormalizedOptionOptions, "Highlighted", true), "ListESCOption Highlighted");
		const bEnumerated = RequireBoolean(ReadOptionValue(NormalizedOptionOptions, "Enumerated", true), "ListESCOption Enumerated");

		super(TextValue, null, { Highlighted: bHighlighted, Selectable: false });

		this.Enumerated = bEnumerated;
	}
}

class SimpleESCMenu extends BaseMenu {
	constructor(Options = {}) {
		const MenuOptions = RequireObjectRecord(Options, "SimpleESCMenu options");
		const TitleColor = ReadOptionValue(MenuOptions, "TitleColor", null);

		super(MenuOptions);

		this.ValueTitleColor = TitleColor;
	}

	RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {}) {
		const strRenderedText = RenderESCMenuItemText(MenuItem, PlayerReference, TokenRecord);
		if (MenuItem instanceof SimpleMenuOption) {
			const unChoiceIndex = RequireESCChoiceIndex(MenuItem.ChoiceIndex);
			return `${unChoiceIndex}. ${strRenderedText}`;
		}

		return strRenderedText;
	}

	SelectMenuOption(PlayerReference, unChoiceIndex, unPageIndex = 0) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unNormalizedChoiceIndex = RequireDialogChoiceIndex(unChoiceIndex);
		const unCurrentPage = RequireSafeInteger(unPageIndex, "SimpleESCMenu.SelectMenuOption PageIndex");
		if (unNormalizedChoiceIndex === g_unButtonClose) {
			const bClosed = RequireBoolean(this.CloseMenu(unPlayerIndex), "SimpleESCMenu CloseMenu result");
			if (bClosed) {
				this.NotifyMenuInteraction(unPlayerIndex, "Exit");
			}

			return bClosed;
		}

		return super.SelectMenuOption(unPlayerIndex, unNormalizedChoiceIndex, unCurrentPage);
	}

	ShouldCloseMenuAfterSelection(unChoiceIndex, unPageIndex = 0) {
		const unNormalizedChoiceIndex = RequireDialogChoiceIndex(unChoiceIndex);
		const unCurrentPage = RequireSafeInteger(unPageIndex, "SimpleESCMenu.ShouldCloseMenuAfterSelection PageIndex");
		if (unNormalizedChoiceIndex === g_unButtonClose) {
			return false;
		}

		return super.ShouldCloseMenuAfterSelection(unNormalizedChoiceIndex, unCurrentPage);
	}

	SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		return SendMenuToPlayer(this, PlayerReference, unPageIndex, TokenRecord);
	}

	CloseMenuForPlayer(PlayerReference) {
		CloseMenuForPlayer(this, PlayerReference);
	}
}

class PagedESCMenu extends PagedMenu {
	constructor(Options = {}) {
		const MenuOptions = RequireObjectRecord(Options, "PagedESCMenu options");
		const NormalizedMenuOptions = { ...MenuOptions };
		const unItemsPerPage = RequireESCItemsPerPage(ReadOptionValue(NormalizedMenuOptions, "ItemsPerPage", g_unMaximumItemCount));
		const bFillMenu = RequireBoolean(ReadOptionValue(NormalizedMenuOptions, "Fill", true), "PagedESCMenu Fill");
		const TitleColor = ReadOptionValue(NormalizedMenuOptions, "TitleColor", null);
		NormalizedMenuOptions.BackChoiceIndex = g_unButtonBack;
		NormalizedMenuOptions.CloseChoiceIndex = g_unButtonClose;
		NormalizedMenuOptions.Fill = bFillMenu;
		NormalizedMenuOptions.ItemsPerPage = unItemsPerPage;
		NormalizedMenuOptions.NextChoiceIndex = g_unButtonNext;
		super(NormalizedMenuOptions);

		this.ValueTitleColor = TitleColor;
	}

	RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {}) {
		const strRenderedText = RenderESCMenuItemText(MenuItem, PlayerReference, TokenRecord);
		if (MenuItem instanceof ListESCOption) {
			const bEnumerated = RequireBoolean(MenuItem.Enumerated, "ListESCOption Enumerated");
			if (!bEnumerated) {
				return strRenderedText;
			}

			const unChoiceIndex = RequireESCChoiceIndex(MenuItem.ChoiceIndex);
			return `${unChoiceIndex}. ${strRenderedText}`;
		}

		if (MenuItem instanceof SimpleMenuOption) {
			const unChoiceIndex = RequireESCChoiceIndex(MenuItem.ChoiceIndex);
			return `${unChoiceIndex}. ${strRenderedText}`;
		}

		return strRenderedText;
	}

	SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		return SendMenuToPlayer(this, PlayerReference, unPageIndex, TokenRecord);
	}

	CloseMenuForPlayer(PlayerReference) {
		CloseMenuForPlayer(this, PlayerReference);
	}
}

class ListESCMenu extends PagedESCMenu {
	constructor(Options = {}) {
		super(RequireObjectRecord(Options, "ListESCMenu options"));
	}
}

function SendESCMenu(TargetReferences, strMenuTitle, strMenuMessage, unDisplayTime = 10) {
	const unNormalizedDisplayTime = RequireSafeInteger(unDisplayTime, "SendESCMenu DisplayTime");
	const ESCMenu = new SimpleESCMenu({ Description: strMenuMessage, QueueEnabled: false, Timeout: unNormalizedDisplayTime, Title: strMenuTitle });

	return ESCMenu.SendMenu(TargetReferences);
}

module.exports = {
	BUTTON_BACK: g_unButtonBack,
	BUTTON_CLOSE: g_unButtonClose,
	BUTTON_NEXT: g_unButtonNext,
	MAX_ITEM_COUNT: g_unMaximumItemCount,
	VALID_CHOICES: g_vecValidChoices,
	ListESCMenu: ListESCMenu,
	ListESCOption: ListESCOption,
	PagedESCMenu: PagedESCMenu,
	PagedESCOption: PagedESCOption,
	SimpleESCMenu: SimpleESCMenu,
	SimpleESCOption: SimpleESCOption,
	SendESCMenu: SendESCMenu,
};
