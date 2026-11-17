"use strict";

const { GetGlobalVariables } = require("globals");
const { ShowMenu } = require("messages");
const {
	BaseMenu,
	MenuRenderData,
	PagedMenu,
	PagedMenuOption,
	SimpleMenuOption,
	MenuText,
} = require("menus");

const g_vecSupportedRadioSDKBranches = Object.freeze([
	"bgt",
	"blade",
	"bms",
	"contagion",
	"csgo",
	"css",
	"darkm",
	"dods",
	"doi",
	"episode1",
	"eye",
	"gmod",
	"hl2dm",
	"insurgency",
	"l4d",
	"l4d2",
	"mcv",
	"nucleardawn",
	"orangebox",
	"portal2",
	"pvkii",
	"sdk2013",
	"swarm",
	"tf2",
]);
const g_vecCompactRadioSDKBranches = Object.freeze(["bms", "csgo"]);

function RequireObjectRecord(RecordValue, strValueName) {
	if ((RecordValue === null) || (typeof RecordValue !== "object") || Array.isArray(RecordValue)) {
		throw new TypeError(`${strValueName} must be an object.`);
	}

	return RecordValue;
}

function GetCurrentSDKBranch() {
	const Globals = GetGlobalVariables();
	if ((Globals === null) || (typeof Globals !== "object") || Array.isArray(Globals)) {
		throw new TypeError("globals.GetGlobalVariables() must return an object.");
	}

	if (typeof Globals.SDKBranch !== "string") {
		throw new TypeError("globals.GetGlobalVariables().SDKBranch must be a string.");
	}

	return Globals.SDKBranch.toLowerCase();
}

function RequireSafeInteger(nIntegerValue, strValueName, nMinimumValue = 0, nMaximumValue = Number.MAX_SAFE_INTEGER) {
	if (!Number.isSafeInteger(nIntegerValue) || (nIntegerValue < nMinimumValue) || (nIntegerValue > nMaximumValue)) {
		throw new RangeError(`${strValueName} must be a safe integer between ${nMinimumValue} and ${nMaximumValue}.`);
	}

	return nIntegerValue;
}

function ResolvePlayerIndex(PlayerReference) {
	if ((PlayerReference !== null) && (typeof PlayerReference === "object") && !Array.isArray(PlayerReference)) {
		const unPlayerReferenceIndex = PlayerReference.Index;
		return RequireSafeInteger(unPlayerReferenceIndex, "RadioMenu PlayerReference.Index", 1);
	}

	return RequireSafeInteger(PlayerReference, "RadioMenu PlayerReference", 1);
}

function RequireBoolean(bBooleanValue, strValueName) {
	if (typeof bBooleanValue !== "boolean") {
		throw new TypeError(`${strValueName} must be a boolean.`);
	}

	return bBooleanValue;
}

function CreateIntegerRange(nRangeStart, nRangeEnd) {
	const vecRangeValues = [];
	for (let nRangeValue = nRangeStart; nRangeValue <= nRangeEnd; nRangeValue += 1) {
		vecRangeValues.push(nRangeValue);
	}

	return vecRangeValues;
}

function GetRadioProfile(strSDKBranch = GetCurrentSDKBranch()) {
	if ((typeof strSDKBranch !== "string") || (strSDKBranch.length === 0)) {
		throw new TypeError("GetRadioProfile(strSDKBranch) expects a non-empty SDK branch.");
	}

	const strNormalizedSDKBranch = strSDKBranch.toLowerCase();
	if (!g_vecSupportedRadioSDKBranches.includes(strNormalizedSDKBranch)) {
		throw new RangeError(`Radio menus are not supported for SDK branch: ${strSDKBranch}`);
	}

	if (g_vecCompactRadioSDKBranches.includes(strNormalizedSDKBranch)) {
		return {
			ButtonBack: 7,
			ButtonClose: 9,
			ButtonCloseSlot: 9,
			ButtonNext: 8,
			MaxItemCount: 6,
			ValidChoices: CreateIntegerRange(1, 9),
		};
	}

	return {
		ButtonBack: 8,
		ButtonClose: 10,
		ButtonCloseSlot: 0,
		ButtonNext: 9,
		MaxItemCount: 7,
		ValidChoices: CreateIntegerRange(1, 10),
	};
}

const g_DefaultProfile = Object.freeze(GetRadioProfile());
const g_unButtonBack = g_DefaultProfile.ButtonBack;
const g_unButtonClose = g_DefaultProfile.ButtonClose;
const g_unButtonCloseSlot = g_DefaultProfile.ButtonCloseSlot;
const g_unButtonNext = g_DefaultProfile.ButtonNext;
const g_unMaximumItemCount = g_DefaultProfile.MaxItemCount;
const g_vecValidChoices = Object.freeze(g_DefaultProfile.ValidChoices);

function EncodeRadioSlots(RadioSlots) {
	let unSlotBits = 0;
	for (const unRadioSlotValue of RadioSlots) {
		const unRadioSlot = RequireSafeInteger(unRadioSlotValue, "radio slot", 0, 9);
		const unSlotBitIndex = (unRadioSlot === 0) ? 9 : (unRadioSlot - 1);
		unSlotBits |= (1 << unSlotBitIndex);
	}

	return unSlotBits;
}

function ConvertRadioSlotsToBits(vecRadioSlots) {
	if (!Array.isArray(vecRadioSlots)) {
		throw new TypeError("ConvertRadioSlotsToBits(vecRadioSlots) expects an array.");
	}

	return EncodeRadioSlots(vecRadioSlots);
}

function ResolveRadioChoiceSlot(unChoiceIndex) {
	return (unChoiceIndex === 10) ? 0 : unChoiceIndex;
}

function RequireRadioItemCount(unItemCountValue, RadioProfile) {
	const unMaximumItemCount = RequireSafeInteger(RadioProfile.MaxItemCount, "RadioProfile MaxItemCount", 1, 10);

	return RequireSafeInteger(unItemCountValue, "PagedRadioMenu ItemsPerPage", 1, unMaximumItemCount);
}

function RequireSimpleRadioChoice(unChoiceIndex) {
	const unSelectedChoiceIndex = RequireSafeInteger(unChoiceIndex, "SimpleRadioOption ChoiceIndex", 1, g_unButtonClose);
	if (unSelectedChoiceIndex === g_unButtonClose) {
		throw new RangeError(`SimpleRadioOption ChoiceIndex ${g_unButtonClose} is reserved for Close.`);
	}

	return unSelectedChoiceIndex;
}

function GetRadioOptionPrefix(MenuOption) {
	const bOptionHighlighted = RequireBoolean(MenuOption.Highlighted, "RadioMenu option Highlighted");

	return bOptionHighlighted ? "->" : "";
}

function RenderRadioText(TextValue, unPlayerIndex, TokenRecord = {}) {
	const MenuTokens = RequireObjectRecord(TokenRecord, "radio menu tokens");

	return new MenuText(TextValue).GetMenuText(unPlayerIndex, MenuTokens);
}

function CreateRadioMenuData(strMenuTitle, strMenuMessage, unPageIndex, unTotalPageCount, setRadioSlots) {
	const unValidSlots = EncodeRadioSlots(setRadioSlots);
	const MenuData = new MenuRenderData(strMenuTitle, strMenuMessage, unPageIndex, unTotalPageCount);
	MenuData.ValidSlotBits = unValidSlots;

	return MenuData;
}

function SendRadioMenuToPlayer(MenuObject, PlayerReference, unPageIndex, TokenRecord) {
	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const strRadioMenuName = MenuObject.constructor.name;
	const unRequestedPageIndex = RequireSafeInteger(unPageIndex, `${strRadioMenuName}.SendMenuToPlayer PageIndex`);
	const MenuTokens = RequireObjectRecord(TokenRecord, "radio menu tokens");
	const BuildCallback = MenuObject.BuildCallback;
	const mapPlayerPages = MenuObject.PlayerMenuPages;
	const mapPlayerTokens = MenuObject.PlayerTokenRecords;
	if ((BuildCallback !== null) && (typeof BuildCallback !== "function")) {
		throw new TypeError(`${strRadioMenuName}.BuildCallback must be a function or null.`);
	}

	if (!(mapPlayerPages instanceof Map)) {
		throw new TypeError(`${strRadioMenuName}.PlayerMenuPages must be a Map.`);
	}

	if (!(mapPlayerTokens instanceof Map)) {
		throw new TypeError(`${strRadioMenuName}.PlayerTokenRecords must be a Map.`);
	}

	mapPlayerPages.set(unPlayerIndex, unRequestedPageIndex);
	mapPlayerTokens.set(unPlayerIndex, MenuTokens);

	if (BuildCallback !== null) {
		Reflect.apply(BuildCallback, MenuObject, [MenuObject, unPlayerIndex, unRequestedPageIndex, MenuTokens]);
	}

	const BuildMenuData = MenuObject.BuildMenuRenderData;
	if (typeof BuildMenuData !== "function") {
		throw new TypeError(`${strRadioMenuName}.BuildMenuRenderData must be a function.`);
	}

	const MenuData = RequireObjectRecord(Reflect.apply(BuildMenuData, MenuObject, [unPlayerIndex, unRequestedPageIndex, MenuTokens]), `${strRadioMenuName}.BuildMenuRenderData result`);
	const strMenuMessage = MenuData.MenuMessage;
	const unValidSlotBits = RequireSafeInteger(MenuData.ValidSlotBits, `${strRadioMenuName}.ValidSlotBits`, 0, 1023);
	const unDisplayTime = RequireSafeInteger(MenuObject.Timeout, `${strRadioMenuName}.Timeout`);
	if (typeof strMenuMessage !== "string") {
		throw new TypeError(`${strRadioMenuName}.MenuMessage must be a string.`);
	}

	const ShowMenuObject = new ShowMenu(strMenuMessage, unValidSlotBits, unDisplayTime);
	const ShowMenuSend = ShowMenuObject.SendUserMessage;
	const bShowMenuResult = Reflect.apply(ShowMenuSend, ShowMenuObject, [unPlayerIndex]);

	return RequireBoolean(bShowMenuResult, "ShowMenu.SendUserMessage result");
}

function CloseRadioMenuForPlayer(MenuObject, PlayerReference) {
	const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const mapPlayerPages = MenuObject.PlayerMenuPages;
	if (!(mapPlayerPages instanceof Map)) {
		throw new TypeError(`${MenuObject.constructor.name}.PlayerMenuPages must be a Map.`);
	}

	const mapPlayerTokens = MenuObject.PlayerTokenRecords;
	if (!(mapPlayerTokens instanceof Map)) {
		throw new TypeError(`${MenuObject.constructor.name}.PlayerTokenRecords must be a Map.`);
	}

	const CloseCallback = MenuObject.CloseCallback;
	if ((CloseCallback !== null) && (typeof CloseCallback !== "function")) {
		throw new TypeError(`${MenuObject.constructor.name}.CloseCallback must be a function or null.`);
	}

	const vecErrors = [];
	const bHadPlayerMenuPage = mapPlayerPages.has(unPlayerIndex);
	mapPlayerPages.delete(unPlayerIndex);
	mapPlayerTokens.delete(unPlayerIndex);

	// Hide the old dialog before a close callback can display its replacement.
	if (bHadPlayerMenuPage) {
		try {
			const ShowMenuObject = new ShowMenu("", 0, 0);
			const ShowMenuSend = ShowMenuObject.SendUserMessage;
			const bHideMenuResult = Reflect.apply(ShowMenuSend, ShowMenuObject, [unPlayerIndex]);
			RequireBoolean(bHideMenuResult, "ShowMenu.SendUserMessage result");
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}
	}

	if (CloseCallback !== null) {
		try {
			Reflect.apply(CloseCallback, MenuObject, [unPlayerIndex, MenuObject]);
		} catch (CaughtError) {
			vecErrors.push(CaughtError);
		}
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, `CloseRadioMenuForPlayer failed PlayerIndex=${unPlayerIndex}.`);
	}
}

class SimpleRadioOption extends SimpleMenuOption {
	constructor(unChoiceIndex, OptionText, OptionValue = null, Options = {}) {
		super(RequireSimpleRadioChoice(unChoiceIndex), OptionText, OptionValue, Options);
	}
}

class PagedRadioOption extends PagedMenuOption {
	constructor(OptionText = "", OptionValue = null, Options = {}) {
		super(OptionText, OptionValue, Options);
	}
}

class ListRadioOption extends PagedRadioOption {
	constructor(OptionText = "", Options = {}) {
		const RadioOptionOptions = RequireObjectRecord(Options, "ListRadioOption options");
		const HighlightOptionValue = Object.hasOwn(RadioOptionOptions, "Highlighted") ? RadioOptionOptions.Highlighted : undefined;
		const EnumeratedOptionValue = Object.hasOwn(RadioOptionOptions, "Enumerated") ? RadioOptionOptions.Enumerated : undefined;
		let bOptionHighlighted = true;
		let bOptionEnumerated = true;
		if (HighlightOptionValue !== undefined) {
			bOptionHighlighted = RequireBoolean(HighlightOptionValue, "ListRadioOption Highlighted");
		}

		if (EnumeratedOptionValue !== undefined) {
			bOptionEnumerated = RequireBoolean(EnumeratedOptionValue, "ListRadioOption Enumerated");
		}

		super(OptionText, null, { Highlighted: bOptionHighlighted, Selectable: false });

		this.Enumerated = bOptionEnumerated;
	}
}

class SimpleRadioMenu extends BaseMenu {
	constructor(Options = {}) {
		const ValidatedMenuOptions = RequireObjectRecord(Options, "SimpleRadioMenu options");
		const SDKBranchOption = Object.hasOwn(ValidatedMenuOptions, "SDKBranch") ? ValidatedMenuOptions.SDKBranch : undefined;
		const strSelectedSDKBranch = (SDKBranchOption === undefined) ? GetCurrentSDKBranch() : SDKBranchOption;
		const RadioProfile = GetRadioProfile(strSelectedSDKBranch);
		super(ValidatedMenuOptions);

		this.RadioProfile = RadioProfile;
	}

	RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {}) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const MenuTokens = RequireObjectRecord(TokenRecord, "radio menu tokens");
		if (MenuItem instanceof SimpleMenuOption) {
			const unChoiceIndex = RequireSafeInteger(MenuItem.ChoiceIndex, "SimpleRadioMenu option ChoiceIndex", 1, 10);
			const strOptionText = MenuItem.GetMenuText(unPlayerIndex, MenuTokens);
			return `${GetRadioOptionPrefix(MenuItem)}${unChoiceIndex}. ${strOptionText}`;
		}

		return RenderRadioText(MenuItem, unPlayerIndex, MenuTokens);
	}

	SelectMenuOption(PlayerReference, unChoiceIndex, unPageIndex = 0) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unSelectedChoiceIndex = RequireSafeInteger(unChoiceIndex, "SimpleRadioMenu.SelectMenuOption ChoiceIndex", 1, 10);
		const unSelectedPageIndex = RequireSafeInteger(unPageIndex, "SimpleRadioMenu.SelectMenuOption PageIndex");
		const RadioProfile = RequireObjectRecord(this.RadioProfile, "SimpleRadioMenu profile");
		const unCloseChoiceIndex = RequireSafeInteger(RadioProfile.ButtonClose, "SimpleRadioMenu profile ButtonClose", 1, 10);
		if (unSelectedChoiceIndex === unCloseChoiceIndex) {
			const bClosed = this.CloseMenu(unPlayerIndex);
			if (bClosed) {
				this.NotifyMenuInteraction(unPlayerIndex, "Exit");
			}

			return bClosed;
		}

		return super.SelectMenuOption(unPlayerIndex, unSelectedChoiceIndex, unSelectedPageIndex);
	}

	ShouldCloseMenuAfterSelection(unChoiceIndex, unPageIndex = 0) {
		const unSelectedChoiceIndex = RequireSafeInteger(unChoiceIndex, "SimpleRadioMenu.ShouldCloseMenuAfterSelection ChoiceIndex", 1, 10);
		const unSelectedPageIndex = RequireSafeInteger(unPageIndex, "SimpleRadioMenu.ShouldCloseMenuAfterSelection PageIndex");
		const RadioProfile = RequireObjectRecord(this.RadioProfile, "SimpleRadioMenu profile");
		const unCloseChoiceIndex = RequireSafeInteger(RadioProfile.ButtonClose, "SimpleRadioMenu profile ButtonClose", 1, 10);
		if (unSelectedChoiceIndex === unCloseChoiceIndex) {
			return false;
		}

		return super.ShouldCloseMenuAfterSelection(unSelectedChoiceIndex, unSelectedPageIndex);
	}

	BuildMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unRequestedPageIndex = RequireSafeInteger(unPageIndex, "SimpleRadioMenu.BuildMenuRenderData PageIndex");
		const MenuTokens = RequireObjectRecord(TokenRecord, "radio menu tokens");
		const RadioProfile = RequireObjectRecord(this.RadioProfile, "SimpleRadioMenu profile");
		const vecMenuItems = this.Items;
		if (!Array.isArray(vecMenuItems)) {
			throw new TypeError("SimpleRadioMenu items must be an array.");
		}

		const vecValidChoiceIndexes = RadioProfile.ValidChoices;
		if (!Array.isArray(vecValidChoiceIndexes)) {
			throw new TypeError("SimpleRadioMenu profile ValidChoices must be an array.");
		}

		const unCloseChoiceIndex = RequireSafeInteger(RadioProfile.ButtonClose, "SimpleRadioMenu profile ButtonClose", 1, 10);
		const unCloseSlot = RequireSafeInteger(RadioProfile.ButtonCloseSlot, "SimpleRadioMenu profile ButtonCloseSlot", 0, 9);
		const RenderItemCallback = this.RenderMenuItem;
		if (ResolveRadioChoiceSlot(unCloseChoiceIndex) !== unCloseSlot) {
			throw new RangeError("SimpleRadioMenu profile ButtonCloseSlot does not match ButtonClose.");
		}

		if (typeof RenderItemCallback !== "function") {
			throw new TypeError("SimpleRadioMenu RenderMenuItem must be a function.");
		}

		for (const unValidChoiceIndex of vecValidChoiceIndexes) {
			RequireSafeInteger(unValidChoiceIndex, "SimpleRadioMenu profile ValidChoice", 1, 10);
		}

		if (!vecValidChoiceIndexes.includes(unCloseChoiceIndex)) {
			throw new RangeError("SimpleRadioMenu profile ValidChoices must include ButtonClose.");
		}

		const vecMenuLines = [];
		const strMenuTitle = RenderRadioText(this.ValueTitle, unPlayerIndex, MenuTokens);
		const strMenuDescription = RenderRadioText(this.ValueDescription, unPlayerIndex, MenuTokens);
		const setRadioSlots = new Set();
		const setUsedChoiceIndexes = new Set();
		setRadioSlots.add(unCloseSlot);

		if (strMenuTitle.length > 0) {
			vecMenuLines.push(strMenuTitle);
		}

		if (strMenuDescription.length > 0) {
			vecMenuLines.push(strMenuDescription);
		}

		for (const MenuItem of vecMenuItems) {
			if (!(MenuItem instanceof SimpleMenuOption)) {
				const strRenderedMenuItem = Reflect.apply(RenderItemCallback, this, [MenuItem, unPlayerIndex, MenuTokens]);
				if (typeof strRenderedMenuItem !== "string") {
					throw new TypeError("SimpleRadioMenu RenderMenuItem must return a string.");
				}

				vecMenuLines.push(strRenderedMenuItem);
				continue;
			}

			const unChoiceIndex = RequireSafeInteger(MenuItem.ChoiceIndex, "SimpleRadioMenu option ChoiceIndex", 1, 10);
			const bOptionSelectable = RequireBoolean(MenuItem.Selectable, "SimpleRadioMenu option Selectable");
			if (!vecValidChoiceIndexes.includes(unChoiceIndex) || (unChoiceIndex === unCloseChoiceIndex)) {
				throw new RangeError(`SimpleRadioMenu choice ${unChoiceIndex} is not an option slot in the selected SDK profile.`);
			}

			if (setUsedChoiceIndexes.has(unChoiceIndex)) {
				throw new RangeError(`SimpleRadioMenu choice ${unChoiceIndex} is duplicated.`);
			}

			const strRenderedMenuItem = Reflect.apply(RenderItemCallback, this, [MenuItem, unPlayerIndex, MenuTokens]);
			if (typeof strRenderedMenuItem !== "string") {
				throw new TypeError("SimpleRadioMenu RenderMenuItem must return a string.");
			}

			vecMenuLines.push(strRenderedMenuItem);

			if (bOptionSelectable) {
				setRadioSlots.add(ResolveRadioChoiceSlot(unChoiceIndex));
			}

			setUsedChoiceIndexes.add(unChoiceIndex);
		}

		const strCloseText = RenderRadioText(this.ValueCloseText, unPlayerIndex, MenuTokens);
		vecMenuLines.push(`${unCloseSlot}. ${strCloseText}`);

		return CreateRadioMenuData(strMenuTitle, vecMenuLines.join("\n"), unRequestedPageIndex, 1, setRadioSlots);
	}

	SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		return SendRadioMenuToPlayer(this, PlayerReference, unPageIndex, TokenRecord);
	}

	CloseMenuForPlayer(PlayerReference) {
		CloseRadioMenuForPlayer(this, PlayerReference);
	}
}

class PagedRadioMenu extends PagedMenu {
	constructor(Options = {}) {
		const OwnedMenuOptions = { ...RequireObjectRecord(Options, "PagedRadioMenu options") };
		const strSDKBranchOption = OwnedMenuOptions.SDKBranch;
		const unItemsPerPageOption = OwnedMenuOptions.ItemsPerPage;
		const bFillOptionValue = OwnedMenuOptions.Fill;
		const TopSeparatorOption = OwnedMenuOptions.TopSeparator;
		const BottomSeparatorOption = OwnedMenuOptions.BottomSeparator;
		const strSelectedSDKBranch = (strSDKBranchOption === undefined) ? GetCurrentSDKBranch() : strSDKBranchOption;
		const RadioProfile = GetRadioProfile(strSelectedSDKBranch);
		const unSelectedItemsPerPage = (unItemsPerPageOption === undefined) ? RadioProfile.MaxItemCount : unItemsPerPageOption;
		const unItemsPerPage = RequireRadioItemCount(unSelectedItemsPerPage, RadioProfile);
		const bFillMenu = (bFillOptionValue === undefined) ? true : RequireBoolean(bFillOptionValue, "PagedRadioMenu Fill");
		const TopSeparator = (TopSeparatorOption === undefined) ? null : TopSeparatorOption;
		const BottomSeparator = (BottomSeparatorOption === undefined) ? null : BottomSeparatorOption;

		OwnedMenuOptions.BackChoiceIndex = RadioProfile.ButtonBack;
		OwnedMenuOptions.CloseChoiceIndex = RadioProfile.ButtonClose;
		OwnedMenuOptions.ItemsPerPage = unItemsPerPage;
		OwnedMenuOptions.NextChoiceIndex = RadioProfile.ButtonNext;
		super(OwnedMenuOptions);

		this.RadioProfile = RadioProfile;
		this.ValueTopSeparator = TopSeparator;
		this.ValueBottomSeparator = BottomSeparator;
		this.Fill = bFillMenu;
	}

	RenderMenuItem(MenuItem, PlayerReference, TokenRecord = {}) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const MenuTokens = RequireObjectRecord(TokenRecord, "radio menu tokens");
		if (MenuItem instanceof ListRadioOption) {
			const unChoiceIndex = RequireSafeInteger(MenuItem.ChoiceIndex, "PagedRadioMenu option ChoiceIndex");
			const bOptionEnumerated = RequireBoolean(MenuItem.Enumerated, "ListRadioOption Enumerated");
			const strChoicePrefix = bOptionEnumerated ? `${unChoiceIndex}. ` : "";
			const strOptionText = MenuItem.GetMenuText(unPlayerIndex, MenuTokens);
			return `${GetRadioOptionPrefix(MenuItem)}${strChoicePrefix}${strOptionText}`;
		}

		if (MenuItem instanceof SimpleMenuOption) {
			const unChoiceIndex = RequireSafeInteger(MenuItem.ChoiceIndex, "PagedRadioMenu option ChoiceIndex");
			const strOptionText = MenuItem.GetMenuText(unPlayerIndex, MenuTokens);
			return `${GetRadioOptionPrefix(MenuItem)}${unChoiceIndex}. ${strOptionText}`;
		}

		return RenderRadioText(MenuItem, unPlayerIndex, MenuTokens);
	}

	BuildMenuRenderData(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		const unPlayerIndex = ResolvePlayerIndex(PlayerReference);
		const unRequestedPageIndex = RequireSafeInteger(unPageIndex, "PagedRadioMenu.BuildMenuRenderData PageIndex");
		const MenuTokens = RequireObjectRecord(TokenRecord, "radio menu tokens");
		const vecMenuItems = this.Items;
		if (!Array.isArray(vecMenuItems)) {
			throw new TypeError("PagedRadioMenu items must be an array.");
		}

		const RadioProfile = RequireObjectRecord(this.RadioProfile, "PagedRadioMenu profile");
		const vecValidRadioChoices = RadioProfile.ValidChoices;
		if (!Array.isArray(vecValidRadioChoices)) {
			throw new TypeError("PagedRadioMenu profile ValidChoices must be an array.");
		}

		const unMaximumProfileItemCount = RequireSafeInteger(RadioProfile.MaxItemCount, "PagedRadioMenu profile MaxItemCount", 1, 10);
		const unItemsPerPage = RequireSafeInteger(this.ItemsPerPage, "PagedRadioMenu ItemsPerPage", 1, unMaximumProfileItemCount);
		const bShowPageNumbers = RequireBoolean(this.ShowPages, "PagedRadioMenu ShowPages");
		const bFillMenu = RequireBoolean(this.Fill, "PagedRadioMenu Fill");
		const unBackChoice = RequireSafeInteger(RadioProfile.ButtonBack, "PagedRadioMenu profile ButtonBack", 1, 10);
		const unCloseChoice = RequireSafeInteger(RadioProfile.ButtonClose, "PagedRadioMenu profile ButtonClose", 1, 10);
		const unCloseSlot = RequireSafeInteger(RadioProfile.ButtonCloseSlot, "PagedRadioMenu profile ButtonCloseSlot", 0, 9);
		const unNextChoice = RequireSafeInteger(RadioProfile.ButtonNext, "PagedRadioMenu profile ButtonNext", 1, 10);
		const GetMenuPageCount = this.GetMenuPageCount;
		const SetPlayerPage = this.SetPlayerPage;
		const RenderItemCallback = this.RenderMenuItem;
		if ((unBackChoice === unCloseChoice) || (unBackChoice === unNextChoice) || (unCloseChoice === unNextChoice)) {
			throw new RangeError("PagedRadioMenu profile navigation choices must be unique.");
		}

		if (ResolveRadioChoiceSlot(unCloseChoice) !== unCloseSlot) {
			throw new RangeError("PagedRadioMenu profile ButtonCloseSlot does not match ButtonClose.");
		}

		if (typeof GetMenuPageCount !== "function") {
			throw new TypeError("PagedRadioMenu GetMenuPageCount must be a function.");
		}

		if (typeof SetPlayerPage !== "function") {
			throw new TypeError("PagedRadioMenu SetPlayerPage must be a function.");
		}

		if (typeof RenderItemCallback !== "function") {
			throw new TypeError("PagedRadioMenu RenderMenuItem must be a function.");
		}

		let bHasBackChoice = false;
		let bHasCloseChoice = false;
		let bHasNextChoice = false;
		for (const unValidRadioChoiceValue of vecValidRadioChoices) {
			const unValidRadioChoice = RequireSafeInteger(unValidRadioChoiceValue, "PagedRadioMenu profile ValidChoice", 1, 10);
			if (unValidRadioChoice === unBackChoice) {
				bHasBackChoice = true;
			}

			if (unValidRadioChoice === unCloseChoice) {
				bHasCloseChoice = true;
			}

			if (unValidRadioChoice === unNextChoice) {
				bHasNextChoice = true;
			}
		}

		if (!bHasBackChoice || !bHasCloseChoice || !bHasNextChoice) {
			throw new RangeError("PagedRadioMenu profile ValidChoices must include every navigation choice.");
		}

		const unTotalPageCount = RequireSafeInteger(Reflect.apply(GetMenuPageCount, this, []), "PagedRadioMenu GetMenuPageCount", 1);
		const unCurrentPageIndex = RequireSafeInteger(Reflect.apply(SetPlayerPage, this, [unPlayerIndex, unRequestedPageIndex]), "PagedRadioMenu unCurrentPageIndex", 0, unTotalPageCount - 1);
		const unRequestedPageStartIndex = unCurrentPageIndex * unItemsPerPage;
		const unPageStartIndex = Math.min(vecMenuItems.length, unRequestedPageStartIndex);
		const unPageLimitIndex = unPageStartIndex + unItemsPerPage;
		const unPageEndIndex = Math.min(vecMenuItems.length, unPageLimitIndex);
		const unPageItemCount = unPageEndIndex - unPageStartIndex;
		const setRadioSlots = new Set();
		const vecMenuLines = [];
		const strBaseMenuTitle = RenderRadioText(this.ValueTitle, unPlayerIndex, MenuTokens);
		const strMenuDescription = RenderRadioText(this.ValueDescription, unPlayerIndex, MenuTokens);
		const TopSeparator = this.ValueTopSeparator;
		const BottomSeparator = this.ValueBottomSeparator;
		let strMenuTitle = strBaseMenuTitle;
		setRadioSlots.add(unCloseSlot);

		if (bShowPageNumbers && (unTotalPageCount > 1)) {
			strMenuTitle = `${strBaseMenuTitle} [${unCurrentPageIndex + 1}/${unTotalPageCount}]`;
		}

		if (strMenuTitle.length > 0) {
			vecMenuLines.push(strMenuTitle);
		}

		if (strMenuDescription.length > 0) {
			vecMenuLines.push(strMenuDescription);
		}

		if (TopSeparator !== null) {
			vecMenuLines.push(RenderRadioText(TopSeparator, unPlayerIndex, MenuTokens));
		}

		for (let unMenuItemIndex = unPageStartIndex; unMenuItemIndex < unPageEndIndex; unMenuItemIndex += 1) {
			const MenuItem = vecMenuItems[unMenuItemIndex];
			const unPageItemIndex = unMenuItemIndex - unPageStartIndex;
			if (MenuItem instanceof SimpleMenuOption) {
				const unMenuChoiceIndex = unPageItemIndex + 1;
				const bOptionSelectable = RequireBoolean(MenuItem.Selectable, "PagedRadioMenu option Selectable");
				const bIsBackChoice = unMenuChoiceIndex === unBackChoice;
				const bIsCloseChoice = unMenuChoiceIndex === unCloseChoice;
				const bIsNextChoice = unMenuChoiceIndex === unNextChoice;
				const bChoiceIsNavigation = bIsBackChoice || bIsCloseChoice || bIsNextChoice;
				if (!vecValidRadioChoices.includes(unMenuChoiceIndex) || bChoiceIsNavigation) {
					throw new RangeError(`PagedRadioMenu choice ${unMenuChoiceIndex} is not an option slot in the selected SDK profile.`);
				}

				MenuItem.ChoiceIndex = unMenuChoiceIndex;

				if (bOptionSelectable) {
					setRadioSlots.add(unMenuChoiceIndex);
				}
			}

			const strRenderedMenuItem = Reflect.apply(RenderItemCallback, this, [MenuItem, unPlayerIndex, MenuTokens]);
			if (typeof strRenderedMenuItem !== "string") {
				throw new TypeError("PagedRadioMenu RenderMenuItem must return a string.");
			}

			vecMenuLines.push(strRenderedMenuItem);
		}

		if (bFillMenu) {
			for (let unEmptyMenuItemIndex = unPageItemCount; unEmptyMenuItemIndex < unItemsPerPage; unEmptyMenuItemIndex += 1) {
				vecMenuLines.push(" ");
			}
		}

		if (BottomSeparator !== null) {
			vecMenuLines.push(RenderRadioText(BottomSeparator, unPlayerIndex, MenuTokens));
		}

		const ParentMenu = this.ParentMenu;
		const bBackEnabled = (unCurrentPageIndex > 0) || (ParentMenu !== null);
		const bNextEnabled = unCurrentPageIndex < (unTotalPageCount - 1);
		const strBackPrefix = bBackEnabled ? "->" : "";
		const strNextPrefix = bNextEnabled ? "->" : "";
		const strBackText = RenderRadioText(this.ValueBackText, unPlayerIndex, MenuTokens);
		const strNextText = RenderRadioText(this.ValueNextText, unPlayerIndex, MenuTokens);
		const strCloseText = RenderRadioText(this.ValueCloseText, unPlayerIndex, MenuTokens);
		vecMenuLines.push(`${strBackPrefix}${unBackChoice}. ${strBackText}`);
		vecMenuLines.push(`${strNextPrefix}${unNextChoice}. ${strNextText}`);
		vecMenuLines.push(`${unCloseSlot}. ${strCloseText}`);

		if (bBackEnabled) {
			setRadioSlots.add(unBackChoice);
		}

		if (bNextEnabled) {
			setRadioSlots.add(unNextChoice);
		}

		return CreateRadioMenuData(strMenuTitle, vecMenuLines.join("\n"), unCurrentPageIndex, unTotalPageCount, setRadioSlots);
	}

	SendMenuToPlayer(PlayerReference, unPageIndex = 0, TokenRecord = {}) {
		return SendRadioMenuToPlayer(this, PlayerReference, unPageIndex, TokenRecord);
	}

	CloseMenuForPlayer(PlayerReference) {
		CloseRadioMenuForPlayer(this, PlayerReference);
	}
}

class ListRadioMenu extends PagedRadioMenu {
	constructor(Options = {}) {
		const OwnedMenuOptions = { ...RequireObjectRecord(Options, "ListRadioMenu options") };
		const strSDKBranchOption = OwnedMenuOptions.SDKBranch;
		const strSelectedSDKBranch = (strSDKBranchOption === undefined) ? GetCurrentSDKBranch() : strSDKBranchOption;
		const RadioProfile = GetRadioProfile(strSelectedSDKBranch);
		if (!Object.hasOwn(OwnedMenuOptions, "ItemsPerPage")) {
			OwnedMenuOptions.ItemsPerPage = RadioProfile.MaxItemCount;
		}

		super(OwnedMenuOptions);
	}
}

function SendRadioMenu(TargetReferences, MenuTitle, vecRadioOptions, SelectionCallback = null, unDisplayTime = 10) {
	if (!Array.isArray(vecRadioOptions)) {
		throw new TypeError("SendRadioMenu vecRadioOptions must be an array.");
	}

	const RadioProfile = GetRadioProfile();
	const unCloseChoice = RequireSafeInteger(RadioProfile.ButtonClose, "SendRadioMenu profile ButtonClose", 1, 10);
	const unMaximumOptionCount = unCloseChoice - 1;
	if (vecRadioOptions.length > unMaximumOptionCount) {
		throw new RangeError(`SendRadioMenu supports at most ${unMaximumOptionCount} options on the selected SDK branch.`);
	}

	const RadioMenu = new SimpleRadioMenu({ SelectCallback: SelectionCallback, Timeout: unDisplayTime, Title: MenuTitle });
	for (let unRadioOptionIndex = 0; unRadioOptionIndex < vecRadioOptions.length; unRadioOptionIndex += 1) {
		const RadioOption = vecRadioOptions[unRadioOptionIndex];
		const unRadioChoiceIndex = RequireSafeInteger(unRadioOptionIndex + 1, "SendRadioMenu option ChoiceIndex", 1, unMaximumOptionCount);
		if (RadioOption instanceof PagedRadioOption) {
			RadioOption.ChoiceIndex = unRadioChoiceIndex;
			RadioMenu.AppendMenuItem(RadioOption);
			continue;
		}

		if ((RadioOption !== null) && (typeof RadioOption === "object") && !Array.isArray(RadioOption)) {
			const OptionText = Object.hasOwn(RadioOption, "Text") ? RadioOption.Text : undefined;
			const OptionValue = Object.hasOwn(RadioOption, "Value") ? RadioOption.Value : undefined;
			const HighlightOptionValue = Object.hasOwn(RadioOption, "Highlighted") ? RadioOption.Highlighted : undefined;
			const SelectableOptionValue = Object.hasOwn(RadioOption, "Selectable") ? RadioOption.Selectable : undefined;
			let bOptionHighlighted = true;
			let bOptionSelectable = true;
			if (HighlightOptionValue !== undefined) {
				bOptionHighlighted = RequireBoolean(HighlightOptionValue, "SendRadioMenu option Highlighted");
			}

			if (SelectableOptionValue !== undefined) {
				bOptionSelectable = RequireBoolean(SelectableOptionValue, "SendRadioMenu option Selectable");
			}

			const RadioOptionSettings = { Highlighted: bOptionHighlighted, Selectable: bOptionSelectable };
			const SimpleRadioOptionInstance = new SimpleRadioOption(unRadioChoiceIndex, OptionText, OptionValue, RadioOptionSettings);
			RadioMenu.AppendMenuItem(SimpleRadioOptionInstance);
			continue;
		}

		RadioMenu.AppendMenuItem(new SimpleRadioOption(unRadioChoiceIndex, RadioOption, RadioOption));
	}

	return RadioMenu.SendMenu(TargetReferences);
}

module.exports = {
	BUTTON_BACK: g_unButtonBack,
	BUTTON_CLOSE: g_unButtonClose,
	BUTTON_CLOSE_SLOT: g_unButtonCloseSlot,
	BUTTON_NEXT: g_unButtonNext,
	MAX_ITEM_COUNT: g_unMaximumItemCount,
	VALID_CHOICES: g_vecValidChoices,
	ListRadioMenu,
	ListRadioOption,
	PagedRadioMenu,
	PagedRadioOption,
	SimpleRadioMenu,
	SimpleRadioOption,
	GetRadioProfile,
	SendRadioMenu,
	ConvertRadioSlotsToBits,
};
