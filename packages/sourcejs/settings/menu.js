"use strict";

const { PagedMenu, PagedMenuOption } = require("menus");
const { SettingsDictionary, GetPlayerSettings, GetUniqueIDFromPlayer } = require("settings/player");
const { SettingsType, ListSettings } = require("settings/types");

function RequireObjectRecord(RecordValue, strValueName) {
	if ((RecordValue === null) || (typeof RecordValue !== "object") || Array.isArray(RecordValue)) {
		throw new TypeError(`${strValueName} must be an object.`);
	}

	return RecordValue;
}

function ReadOptionValue(OptionRecord, strOptionName, DefaultOptionValue) {
	if (!Object.hasOwn(OptionRecord, strOptionName)) {
		return DefaultOptionValue;
	}

	const OptionValue = OptionRecord[strOptionName];
	if (OptionValue === undefined) {
		return DefaultOptionValue;
	}

	return OptionValue;
}

function RequireSettingsMenuRequest(Options, Callback) {
	RequireObjectRecord(Options, "SettingsMenu request options");

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("SettingsMenu request Blocking must be a boolean.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("SettingsMenu requests require a Callback function.");
	}

	return { Blocking: bBlocking === true };
}

function NormalizeSettingsMenuFailure(Failure) {
	// Only null collides with the callback's success sentinel; preserve other thrown values.
	if (Failure === null) {
		return new Error("SettingsMenu operation threw null.", { cause: Failure });
	}

	return Failure;
}

function RequireSettingsEntry(SettingsEntry, unSettingsEntryIndex) {
	if (!(SettingsEntry instanceof SettingsDictionary) && !(SettingsEntry instanceof SettingsType)) {
		throw new TypeError(`SettingsMenu Settings[${unSettingsEntryIndex}] must be a SettingsDictionary or SettingsType.`);
	}

	return SettingsEntry;
}

function GetSettingsDictionaryText(SettingsDictionary) {
	const strSettingsDictionaryText = SettingsDictionary.Text;
	if (strSettingsDictionaryText !== null) {
		if (typeof strSettingsDictionaryText !== "string") {
			throw new TypeError("SettingsDictionary Text must be a string or null.");
		}

		return strSettingsDictionaryText;
	}

	const strSettingsDictionaryName = SettingsDictionary.Name;
	if ((typeof strSettingsDictionaryName !== "string") || (strSettingsDictionaryName.length === 0)) {
		throw new TypeError("SettingsDictionary Name must be a non-empty string.");
	}

	return strSettingsDictionaryName;
}

function RenderSettingsEntry(SettingsEntry, SettingsMenu) {
	if (SettingsEntry instanceof SettingsDictionary) {
		return GetSettingsDictionaryText(SettingsEntry);
	}

	const strSettingName = SettingsEntry.Name;
	if ((typeof strSettingName !== "string") || (strSettingName.length === 0)) {
		throw new TypeError("SettingsType Name must be a non-empty string.");
	}

	const mapSettingsValues = SettingsMenu.ValueSettingsValues;
	if (!(mapSettingsValues instanceof Map)) {
		throw new TypeError("SettingsMenu values must be a Map.");
	}

	if (!mapSettingsValues.has(SettingsEntry)) {
		return strSettingName;
	}

	if (GetUniqueIDFromPlayer(SettingsMenu.Player) !== SettingsMenu.ValuePlayerUniqueID) {
		return strSettingName;
	}

	// Rendering must not initiate storage I/O during menu delivery or queue refresh.
	return `${strSettingName}: ${mapSettingsValues.get(SettingsEntry)}`;
}

function SelectSettingsEntry(unPlayerIndex, SettingsEntry) {
	if (SettingsEntry instanceof SettingsType) {
		return true;
	}

	if (!(SettingsEntry instanceof SettingsDictionary)) {
		throw new TypeError("SettingsEntry must be a SettingsDictionary or SettingsType.");
	}

	const NestedMenu = SettingsEntry.Menu;
	if ((NestedMenu === null) || (typeof NestedMenu !== "object") || Array.isArray(NestedMenu)) {
		throw new TypeError("SettingsDictionary Menu must be an object.");
	}

	const SendNestedMenu = NestedMenu.SendMenu;
	if (typeof SendNestedMenu !== "function") {
		throw new TypeError("SettingsDictionary Menu.SendMenu must be a function.");
	}

	const bNestedMenuAccepted = Reflect.apply(SendNestedMenu, NestedMenu, [unPlayerIndex]);
	if (typeof bNestedMenuAccepted !== "boolean") {
		throw new TypeError("SettingsDictionary Menu.SendMenu must return a boolean.");
	}

	if (!bNestedMenuAccepted) {
		throw new Error("SettingsDictionary Menu.SendMenu did not accept the nested menu.");
	}

	return true;
}

function CreateDefaultSettingsEntries() {
	const itPlayerSettingsEntries = GetPlayerSettings();
	if ((itPlayerSettingsEntries === null) || (itPlayerSettingsEntries === undefined) || (typeof itPlayerSettingsEntries[Symbol.iterator] !== "function")) {
		throw new TypeError("GetPlayerSettings() must return an iterable.");
	}

	const vecPlayerSettingsEntries = Array.from(itPlayerSettingsEntries);
	const vecStandaloneSettingsEntries = ListSettings();
	if (!Array.isArray(vecStandaloneSettingsEntries)) {
		throw new TypeError("ListSettings() must return an array.");
	}

	return [...vecPlayerSettingsEntries, ...vecStandaloneSettingsEntries];
}

function CreatePagedMenuOptions(SettingsMenuOptions) {
	const strMenuTitle = ReadOptionValue(SettingsMenuOptions, "Title", "Settings");
	const strMenuDescription = ReadOptionValue(SettingsMenuOptions, "Description", "");
	const unMenuItemsPerPage = ReadOptionValue(SettingsMenuOptions, "ItemsPerPage", 7);
	const SelectCallback = ReadOptionValue(SettingsMenuOptions, "SelectCallback", SelectSettingsEntry);
	if (typeof SelectCallback !== "function") {
		throw new TypeError("SettingsMenu SelectCallback must be a function.");
	}

	return { Title: strMenuTitle, Description: strMenuDescription, ItemsPerPage: unMenuItemsPerPage, SelectCallback };
}

function CreateSettingsMenuItems(vecSettingsEntries, SettingsMenu) {
	if (!Array.isArray(vecSettingsEntries)) {
		throw new TypeError("SettingsMenu Settings must be an array.");
	}

	const unSettingsEntryCount = vecSettingsEntries.length;
	const vecSettingsMenuItems = new Array(unSettingsEntryCount);
	for (let unSettingsEntryIndex = 0; unSettingsEntryIndex < unSettingsEntryCount; ++unSettingsEntryIndex) {
		const SettingsEntry = RequireSettingsEntry(vecSettingsEntries[unSettingsEntryIndex], unSettingsEntryIndex);
		const RenderCurrentSettingsEntry = () => RenderSettingsEntry(SettingsEntry, SettingsMenu);
		vecSettingsMenuItems[unSettingsEntryIndex] = new PagedMenuOption(RenderCurrentSettingsEntry, SettingsEntry, { Selectable: true });
	}

	return vecSettingsMenuItems;
}

class SettingsMenu extends PagedMenu {
	constructor(Player, Options = {}) {
		const SettingsMenuOptions = RequireObjectRecord(Options, "SettingsMenu options");
		const PagedMenuOptions = CreatePagedMenuOptions(SettingsMenuOptions);
		const vecSettingsEntries = ReadOptionValue(SettingsMenuOptions, "Settings", undefined);

		super(PagedMenuOptions);

		this.ValuePlayer = Player;
		this.ValuePlayerUniqueID = null;
		this.ValueSettingsValues = new Map();
		this.ValueRefreshToken = null;
		this.RefreshOptions(vecSettingsEntries);
	}

	RefreshOptions(vecSettingsEntries = undefined) {
		let vecSelectedSettingsEntries = vecSettingsEntries;
		if (vecSelectedSettingsEntries === undefined) {
			vecSelectedSettingsEntries = CreateDefaultSettingsEntries();
		}

		const vecSettingsMenuItems = CreateSettingsMenuItems(vecSelectedSettingsEntries, this);
		this.ClearMenuItems();
		this.ValuePlayerUniqueID = null;
		this.ValueSettingsValues = new Map();
		this.ValueRefreshToken = {};

		for (let unSettingsMenuItemIndex = 0; unSettingsMenuItemIndex < vecSettingsMenuItems.length; ++unSettingsMenuItemIndex) {
			this.AppendMenuItem(vecSettingsMenuItems[unSettingsMenuItemIndex]);
		}

		return this;
	}

	RefreshValues(Options, Callback) {
		const RequestOptions = RequireSettingsMenuRequest(Options, Callback);
		const bBlocking = RequestOptions.Blocking;

		if (!Array.isArray(this.Items)) {
			throw new TypeError("SettingsMenu Items must be an array.");
		}

		const vecRequests = [];
		for (let unItemIndex = 0; unItemIndex < this.Items.length; unItemIndex += 1) {
			const MenuItem = RequireObjectRecord(this.Items[unItemIndex], `SettingsMenu Items[${unItemIndex}]`);
			const SettingsEntry = RequireSettingsEntry(MenuItem.Value, unItemIndex);
			if (SettingsEntry instanceof SettingsDictionary) {
				continue;
			}

			const GetSettingValue = SettingsEntry.Get;
			if (typeof GetSettingValue !== "function") {
				throw new TypeError("SettingsType Get must be a function.");
			}

			vecRequests.push({ SettingsEntry, GetSettingValue });
		}

		const RefreshToken = {};
		this.ValueRefreshToken = RefreshToken;
		const mapSettingsValues = new Map();
		const unRequestCount = vecRequests.length;
		if (unRequestCount === 0) {
			this.ValuePlayerUniqueID = null;
			this.ValueSettingsValues = mapSettingsValues;
			Callback(null, this);
			return;
		}

		const strPlayerUniqueID = GetUniqueIDFromPlayer(this.Player);
		let unRemainingRequests = unRequestCount;
		let bCompleted = false;

		for (const Request of vecRequests) {
			let bEntryCompleted = false;
			const CompleteEntry = (RequestError, SettingsValue) => {
				if (bEntryCompleted || bCompleted) {
					return;
				}

				bEntryCompleted = true;

				if (RequestError !== null) {
					bCompleted = true;
					Callback(RequestError, null);
					return;
				}

				mapSettingsValues.set(Request.SettingsEntry, SettingsValue);
				unRemainingRequests -= 1;
				if (unRemainingRequests !== 0) {
					return;
				}

				bCompleted = true;
				let RefreshError = null;

				try {
					if ((this.ValueRefreshToken !== RefreshToken) || (GetUniqueIDFromPlayer(this.Player) !== strPlayerUniqueID)) {
						throw new Error("SettingsMenu player or definitions changed while values were loading.");
					}
				} catch (ValidationError) {
					RefreshError = NormalizeSettingsMenuFailure(ValidationError);
				}

				if (RefreshError !== null) {
					Callback(RefreshError, null);
					return;
				}

				this.ValuePlayerUniqueID = strPlayerUniqueID;
				this.ValueSettingsValues = mapSettingsValues;
				Callback(null, this);
			};

			try {
				Reflect.apply(Request.GetSettingValue, Request.SettingsEntry, [strPlayerUniqueID, { Blocking: bBlocking }, CompleteEntry]);
			} catch (RequestError) {
				if (bEntryCompleted) {
					bCompleted = true;
					throw RequestError;
				}

				CompleteEntry(NormalizeSettingsMenuFailure(RequestError), null);
			}

			if (bCompleted) {
				break;
			}
		}
	}

	get Player() {
		return this.ValuePlayer;
	}
}

function BuildSettingsMenu(Player, Options = {}) {
	return new SettingsMenu(Player, Options);
}

function SendSettingsMenu(Player, Options, Callback) {
	const RequestOptions = RequireSettingsMenuRequest(Options, Callback);
	const Menu = BuildSettingsMenu(Player, Options);
	Menu.RefreshValues(RequestOptions, (RefreshError) => {
		if (RefreshError !== null) {
			Callback(RefreshError, null);
			return;
		}

		let SendError = null;
		let bSent = false;

		try {
			bSent = Menu.SendMenu(Player);
		} catch (MenuError) {
			SendError = NormalizeSettingsMenuFailure(MenuError);
		}

		Callback(SendError, (SendError === null) ? bSent : null);
	});
}

const g_SettingsMenuAPI = {
	SettingsMenu,
	BuildSettingsMenu,
	SendSettingsMenu,
};

module.exports = g_SettingsMenuAPI;
