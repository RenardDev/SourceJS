"use strict";

const { GetModule } = require("internal/runtime");
const { PagedMenu, PagedMenuOption } = require("menus");
const { DEFAULT_STORAGE } = require("settings/storage");
const { BooleanSetting, IntegerSetting, SettingsType, StringSetting } = require("settings/types");

const g_vecRequiredSettingsStorageMethods = Object.freeze(["GetSetting", "SetSetting", "DeleteSetting", "ClearPlayer", "GetPlayerValues"]);
const g_mapRegisteredPlayerSettings = new Map();
const g_PlayersRuntime = GetModule("players");
const g_setRefreshingSettingsDictionaries = new WeakSet();

function IsSettingsStorage(SettingsStorage) {
	if ((SettingsStorage === null) || (typeof SettingsStorage !== "object") || Array.isArray(SettingsStorage)) {
		return false;
	}

	for (const strStorageMethodName of g_vecRequiredSettingsStorageMethods) {
		const StorageMethod = SettingsStorage[strStorageMethodName];
		if (typeof StorageMethod !== "function") {
			return false;
		}
	}

	return true;
}

function NormalizeSettingName(strSettingName) {
	if ((typeof strSettingName !== "string") || (strSettingName.length === 0)) {
		throw new TypeError("Setting name must be a non-empty string.");
	}

	const strSettingNameCharacters = strSettingName.replace(/[_ ]/g, "");
	if (!/^[A-Za-z]+$/.test(strSettingNameCharacters)) {
		throw new TypeError(`Given name "${strSettingName}" is not valid`);
	}

	return strSettingName;
}

function NormalizeSettingToken(strSettingText) {
	if (typeof strSettingText !== "string") {
		throw new TypeError("Setting token must be a string.");
	}

	const vecSettingWords = strSettingText.split(/[ _]+/);
	let strSettingToken = "";
	for (const strSettingWord of vecSettingWords) {
		if (strSettingWord.length === 0) {
			continue;
		}

		strSettingToken += strSettingWord[0].toUpperCase() + strSettingWord.slice(1);
	}

	return strSettingToken;
}

function NormalizeSettingPrefix(strSettingPrefix) {
	if (typeof strSettingPrefix !== "string") {
		throw new TypeError("Setting prefix must be a string.");
	}

	const strSettingPrefixCharacters = strSettingPrefix.replace(/_/g, "");
	if (!/^[A-Za-z]+$/.test(strSettingPrefixCharacters)) {
		throw new TypeError(`Given prefix "${strSettingPrefix}" is not valid`);
	}

	return NormalizeSettingToken(strSettingPrefix);
}

function GetSettingLabel(SettingsEntry) {
	const strSettingText = SettingsEntry.Text;
	if (strSettingText === null) {
		return NormalizeSettingName(SettingsEntry.Name);
	}

	if (typeof strSettingText !== "string") {
		throw new TypeError("Setting text must be a string or null.");
	}

	return strSettingText;
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

function CallMenuMethod(SettingsMenu, strCanonicalMethodName, vecArguments = []) {
	const MenuMethodNames = { Append: "AppendMenuItem", Remove: "RemoveMenuItem", Send: "SendMenu" };
	const strMenuMethodName = MenuMethodNames[strCanonicalMethodName];
	const MenuMethod = SettingsMenu[strMenuMethodName];
	if (typeof MenuMethod !== "function") {
		throw new TypeError(`Settings menu must provide ${strMenuMethodName}().`);
	}

	return Reflect.apply(MenuMethod, SettingsMenu, vecArguments);
}

function RequirePlayerUniqueID(strPlayerUniqueID) {
	if ((typeof strPlayerUniqueID !== "string") || (strPlayerUniqueID.length === 0)) {
		throw new TypeError("strPlayerUniqueID must be a non-empty string.");
	}

	return strPlayerUniqueID;
}

function GetUniqueIDFromPlayer(PlayerReference) {
	if ((typeof PlayerReference === "string") && (PlayerReference.length > 0)) {
		return PlayerReference;
	}

	if (Number.isSafeInteger(PlayerReference) && (PlayerReference > 0)) {
		return RequirePlayerUniqueID(g_PlayersRuntime.GetNetworkID(PlayerReference));
	}

	if ((PlayerReference !== null) && (typeof PlayerReference === "object") && !Array.isArray(PlayerReference)) {
		const unPlayerIndex = PlayerReference.Index;
		if (Number.isSafeInteger(unPlayerIndex) && (unPlayerIndex > 0)) {
			return RequirePlayerUniqueID(g_PlayersRuntime.GetNetworkID(unPlayerIndex));
		}
	}

	throw new TypeError("PlayerReference must be a unique ID string, positive player index or native player object.");
}

function RequirePlayerSettingsRequest(Options, Callback) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Player settings requests require an Options object.");
	}

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("Player settings Options.Blocking must be a boolean.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Player settings requests require a Callback function.");
	}

	return { Blocking: bBlocking === true };
}

function CallSettingsStorageMethod(SettingsStorage, strStorageMethodName, vecStorageMethodArguments, Options, Callback) {
	const RequestOptions = RequirePlayerSettingsRequest(Options, Callback);

	if ((SettingsStorage === null) || (typeof SettingsStorage !== "object") || Array.isArray(SettingsStorage)) {
		throw new TypeError("PlayerSettingsValues storage must be an object.");
	}

	const SettingsStorageMethod = SettingsStorage[strStorageMethodName];
	if (typeof SettingsStorageMethod !== "function") {
		throw new TypeError(`PlayerSettingsValues storage ${strStorageMethodName} must be a function.`);
	}

	Reflect.apply(SettingsStorageMethod, SettingsStorage, [...vecStorageMethodArguments, RequestOptions, Callback]);
}

function RequireSettingsDictionaryItems(SettingsDictionary) {
	const mapSettingsItems = SettingsDictionary.Items;
	if (!(mapSettingsItems instanceof Map)) {
		throw new TypeError("SettingsDictionary items must be a Map.");
	}

	return mapSettingsItems;
}

class SettingsDictionary {
	constructor(strSettingsDictionaryName, strSettingsDictionaryText = null, SettingsDictionaryOptions = {}) {
		if ((SettingsDictionaryOptions === null) || (typeof SettingsDictionaryOptions !== "object") || Array.isArray(SettingsDictionaryOptions)) {
			throw new TypeError("SettingsDictionary options must be an object.");
		}

		if ((strSettingsDictionaryText !== null) && (typeof strSettingsDictionaryText !== "string")) {
			throw new TypeError("SettingsDictionary text must be a string or null.");
		}

		const strNormalizedSettingsDictionaryName = NormalizeSettingName(strSettingsDictionaryName);
		const strSettingsDictionaryPrefix = ReadOptionValue(SettingsDictionaryOptions, "Prefix", "");
		if (typeof strSettingsDictionaryPrefix !== "string") {
			throw new TypeError("SettingsDictionary prefix must be a string.");
		}

		const ParentSettingsDictionary = ReadOptionValue(SettingsDictionaryOptions, "Parent", null);
		if ((ParentSettingsDictionary !== null) && !(ParentSettingsDictionary instanceof SettingsDictionary)) {
			throw new TypeError("SettingsDictionary parent must be a SettingsDictionary or null.");
		}

		this.ValueName = strNormalizedSettingsDictionaryName;
		this.ValueText = strSettingsDictionaryText;
		this.ValuePrefix = strSettingsDictionaryPrefix;
		this.ValueParent = ParentSettingsDictionary;
		this.ValueItems = new Map();

		const ChooseSettingsEntry = (unPlayerIndex, SettingsEntry) => this.Choose(unPlayerIndex, SettingsEntry);
		this.ValueMenu = new PagedMenu({ Title: GetSettingLabel(this), SelectCallback: ChooseSettingsEntry });
	}

	Keys() {
		return RequireSettingsDictionaryItems(this).keys();
	}

	Values() {
		return RequireSettingsDictionaryItems(this).values();
	}

	Entries() {
		return RequireSettingsDictionaryItems(this).entries();
	}

	ForEach(SettingsCallback, CallbackReceiver = undefined) {
		if (typeof SettingsCallback !== "function") {
			throw new TypeError("SettingsCallback must be a function.");
		}

		const mapSettingsItems = RequireSettingsDictionaryItems(this);
		for (const vecSettingsItem of mapSettingsItems) {
			const strSettingName = vecSettingsItem[0];
			const SettingsEntry = vecSettingsItem[1];
			Reflect.apply(SettingsCallback, CallbackReceiver, [SettingsEntry, strSettingName, this]);
		}
	}

	HasSetting(strSettingName) {
		const strNormalizedSettingName = NormalizeSettingName(strSettingName);

		return RequireSettingsDictionaryItems(this).has(strNormalizedSettingName);
	}

	GetSetting(strSettingName) {
		const strNormalizedSettingName = NormalizeSettingName(strSettingName);
		const mapSettingsItems = RequireSettingsDictionaryItems(this);
		if (!mapSettingsItems.has(strNormalizedSettingName)) {
			return null;
		}

		const SettingsEntry = mapSettingsItems.get(strNormalizedSettingName);
		if (!(SettingsEntry instanceof SettingsDictionary) && !(SettingsEntry instanceof SettingsType)) {
			throw new TypeError(`Setting "${strNormalizedSettingName}" does not contain a valid settings entry.`);
		}

		return SettingsEntry;
	}

	SetSetting(strSettingName, SettingsEntry) {
		const strNormalizedSettingName = NormalizeSettingName(strSettingName);

		if (!(SettingsEntry instanceof SettingsDictionary) && !(SettingsEntry instanceof SettingsType)) {
			throw new TypeError("SettingsDictionary entry must be a SettingsDictionary or SettingsType.");
		}

		const mapSettingsItems = RequireSettingsDictionaryItems(this);
		if (mapSettingsItems.has(strNormalizedSettingName)) {
			throw new Error(`Setting "${strNormalizedSettingName}" is already registered.`);
		}

		const SettingsMenu = this.Menu;
		if (!(SettingsMenu instanceof PagedMenu)) {
			throw new TypeError("SettingsDictionary menu must be a PagedMenu.");
		}

		const SettingsOption = new PagedMenuOption(GetSettingLabel(SettingsEntry), SettingsEntry);
		this.ApplyPrefix(SettingsEntry);
		SettingsEntry.Option = SettingsOption;
		CallMenuMethod(SettingsMenu, "Append", [SettingsOption]);
		mapSettingsItems.set(strNormalizedSettingName, SettingsEntry);

		return SettingsEntry;
	}

	DeleteSetting(strSettingName) {
		const strNormalizedSettingName = NormalizeSettingName(strSettingName);
		const mapSettingsItems = RequireSettingsDictionaryItems(this);
		if (!mapSettingsItems.has(strNormalizedSettingName)) {
			return false;
		}

		const SettingsEntry = mapSettingsItems.get(strNormalizedSettingName);
		if (!(SettingsEntry instanceof SettingsDictionary) && !(SettingsEntry instanceof SettingsType)) {
			throw new TypeError(`Setting "${strNormalizedSettingName}" does not contain a valid settings entry.`);
		}

		const bSettingsEntryHasOption = Object.hasOwn(SettingsEntry, "Option");
		if (bSettingsEntryHasOption) {
			const SettingsOption = SettingsEntry.Option;
			if (!(SettingsOption instanceof PagedMenuOption)) {
				throw new TypeError(`Setting "${strNormalizedSettingName}" option must be a PagedMenuOption.`);
			}

			const SettingsMenu = this.Menu;
			if (!(SettingsMenu instanceof PagedMenu)) {
				throw new TypeError("SettingsDictionary menu must be a PagedMenu.");
			}

			const bSettingsOptionRemoved = CallMenuMethod(SettingsMenu, "Remove", [SettingsOption]);
			if (bSettingsOptionRemoved !== true) {
				throw new Error(`Setting "${strNormalizedSettingName}" option is not registered in the menu.`);
			}

			delete SettingsEntry.Option;
		}

		return mapSettingsItems.delete(strNormalizedSettingName);
	}

	ClearSettings() {
		const mapSettingsItems = RequireSettingsDictionaryItems(this);
		for (const strSettingName of mapSettingsItems.keys()) {
			const bSettingDeleted = this.DeleteSetting(strSettingName);
			if (bSettingDeleted !== true) {
				throw new Error(`Setting "${strSettingName}" could not be deleted.`);
			}
		}

		return true;
	}

	ApplyPrefix(SettingsEntry) {
		if (!(SettingsEntry instanceof SettingsDictionary) && !(SettingsEntry instanceof SettingsType)) {
			throw new TypeError("SettingsDictionary entry must be a SettingsDictionary or SettingsType.");
		}

		let strSettingsDictionaryPrefix = this.Prefix;
		if (typeof strSettingsDictionaryPrefix !== "string") {
			throw new TypeError("SettingsDictionary prefix must be a string.");
		}

		strSettingsDictionaryPrefix = NormalizeSettingToken(strSettingsDictionaryPrefix);

		const ParentSettingsDictionary = this.Parent;
		if (ParentSettingsDictionary !== null) {
			if (!(ParentSettingsDictionary instanceof SettingsDictionary)) {
				throw new TypeError("SettingsDictionary parent must be a SettingsDictionary or null.");
			}

			const strSettingsDictionaryName = NormalizeSettingName(this.Name);
			strSettingsDictionaryPrefix += NormalizeSettingToken(strSettingsDictionaryName);
		}

		SettingsEntry.Prefix = strSettingsDictionaryPrefix;

		if (SettingsEntry instanceof SettingsDictionary) {
			SettingsEntry.RefreshChildPrefixes();
		}
	}

	RefreshChildPrefixes() {
		if (g_setRefreshingSettingsDictionaries.has(this)) {
			throw new TypeError("SettingsDictionary child hierarchy must not contain a cycle.");
		}

		const mapSettingsItems = RequireSettingsDictionaryItems(this);
		for (const SettingsEntry of mapSettingsItems.values()) {
			if (!(SettingsEntry instanceof SettingsDictionary) && !(SettingsEntry instanceof SettingsType)) {
				throw new TypeError("SettingsDictionary items must contain settings entries.");
			}
		}

		g_setRefreshingSettingsDictionaries.add(this);

		try {
			for (const SettingsEntry of mapSettingsItems.values()) {
				this.ApplyPrefix(SettingsEntry);
			}
		} finally {
			g_setRefreshingSettingsDictionaries.delete(this);
		}
	}

	AddIntegerSetting(strSettingName, nDefaultSettingValue, SettingOptions = {}) {
		return this.SetSetting(strSettingName, new IntegerSetting(strSettingName, nDefaultSettingValue, SettingOptions));
	}

	AddBooleanSetting(strSettingName, bDefaultSettingValue, SettingOptions = {}) {
		return this.SetSetting(strSettingName, new BooleanSetting(strSettingName, bDefaultSettingValue, SettingOptions));
	}

	AddStringSetting(strSettingName, strDefaultSettingValue, SettingOptions = {}) {
		return this.SetSetting(strSettingName, new StringSetting(strSettingName, strDefaultSettingValue, SettingOptions));
	}

	AddSection(strSettingName, SectionOptions = {}) {
		if ((SectionOptions === null) || (typeof SectionOptions !== "object") || Array.isArray(SectionOptions)) {
			throw new TypeError("Settings section options must be an object.");
		}

		const strNormalizedSettingName = NormalizeSettingName(strSettingName);
		const strSectionText = ReadOptionValue(SectionOptions, "Text", null);
		if ((strSectionText !== null) && (typeof strSectionText !== "string")) {
			throw new TypeError("Settings section text must be a string or null.");
		}

		const SectionSettingsDictionaryOptions = { Parent: this, Prefix: this.Prefix };
		const SectionSettingsDictionary = new SettingsDictionary(strNormalizedSettingName, strSectionText, SectionSettingsDictionaryOptions);

		return this.SetSetting(strNormalizedSettingName, SectionSettingsDictionary);
	}

	Choose(unPlayerIndex, SettingsEntry) {
		if (!(SettingsEntry instanceof SettingsDictionary) && !(SettingsEntry instanceof SettingsType)) {
			throw new TypeError("Chosen setting must be a SettingsDictionary or SettingsType.");
		}

		if (SettingsEntry instanceof SettingsType) {
			return false;
		}

		const SettingsDictionarySend = SettingsEntry.Send;
		if (typeof SettingsDictionarySend !== "function") {
			throw new TypeError("Chosen SettingsDictionary must provide Send().");
		}

		const bSettingsDictionarySent = Reflect.apply(SettingsDictionarySend, SettingsEntry, [unPlayerIndex]);
		if (typeof bSettingsDictionarySent !== "boolean") {
			throw new TypeError("Chosen SettingsDictionary send must return a boolean.");
		}

		return bSettingsDictionarySent;
	}

	Send(unPlayerIndex, unPageIndex = 0, TokenRecord = {}) {
		const SettingsMenu = this.Menu;
		if (!(SettingsMenu instanceof PagedMenu)) {
			throw new TypeError("SettingsDictionary menu must be a PagedMenu.");
		}

		const bSettingsMenuSent = CallMenuMethod(SettingsMenu, "Send", [unPlayerIndex, unPageIndex, TokenRecord]);
		if (typeof bSettingsMenuSent !== "boolean") {
			throw new TypeError("SettingsDictionary menu send must return a boolean.");
		}

		return bSettingsMenuSent;
	}

	[Symbol.iterator]() {
		return this.Entries();
	}

	get Size() {
		return RequireSettingsDictionaryItems(this).size;
	}

	get Name() {
		return this.ValueName;
	}

	set Name(strName) {
		if (typeof strName !== "string") {
			throw new TypeError("SettingsDictionary name must be a string.");
		}

		this.ValueName = strName;
	}

	get Text() {
		return this.ValueText;
	}

	set Text(strText) {
		if ((strText !== null) && (typeof strText !== "string")) {
			throw new TypeError("SettingsDictionary text must be a string or null.");
		}

		this.ValueText = strText;
	}

	get Prefix() {
		return this.ValuePrefix;
	}

	set Prefix(strPrefix) {
		if (typeof strPrefix !== "string") {
			throw new TypeError("SettingsDictionary prefix must be a string.");
		}

		this.ValuePrefix = strPrefix;
	}

	get Parent() {
		return this.ValueParent;
	}

	set Parent(Parent) {
		this.ValueParent = Parent;
	}

	get Menu() {
		return this.ValueMenu;
	}

	get Items() {
		return this.ValueItems;
	}

	set Items(mapItems) {
		this.ValueItems = mapItems;
	}

	// The established property validates the hierarchy and allocates a new path array.
	get Path() {
		const vecSettingsDictionaryPath = [];
		const setVisitedSettingsDictionaries = new Set();
		let CurrentSettingsDictionary = this;
		while (CurrentSettingsDictionary !== null) {
			if (!(CurrentSettingsDictionary instanceof SettingsDictionary)) {
				throw new TypeError("SettingsDictionary parent must be a SettingsDictionary or null.");
			}

			if (setVisitedSettingsDictionaries.has(CurrentSettingsDictionary)) {
				throw new TypeError("SettingsDictionary parent hierarchy must not contain a cycle.");
			}

			setVisitedSettingsDictionaries.add(CurrentSettingsDictionary);
			vecSettingsDictionaryPath.unshift(NormalizeSettingName(CurrentSettingsDictionary.Name));
			CurrentSettingsDictionary = CurrentSettingsDictionary.Parent;
		}

		return vecSettingsDictionaryPath;
	}
}

class PlayerSettings extends SettingsDictionary {
	constructor(strSettingsName, strSettingsPrefix, strSettingsText = null) {
		const strNormalizedSettingsName = NormalizeSettingName(strSettingsName);
		if (g_mapRegisteredPlayerSettings.has(strNormalizedSettingsName)) {
			throw new Error(`Player settings name "${strNormalizedSettingsName}" is already registered.`);
		}

		const strNormalizedSettingsPrefix = NormalizeSettingPrefix(strSettingsPrefix);
		super(strNormalizedSettingsName, strSettingsText, { Prefix: strNormalizedSettingsPrefix });

		this.Option = new PagedMenuOption(GetSettingLabel(this), this);
		g_mapRegisteredPlayerSettings.set(strNormalizedSettingsName, this);
	}

	Unregister() {
		for (const vecRegisteredSettingsItem of g_mapRegisteredPlayerSettings.entries()) {
			const strRegisteredSettingsName = vecRegisteredSettingsItem[0];
			const RegisteredPlayerSettings = vecRegisteredSettingsItem[1];
			if (RegisteredPlayerSettings === this) {
				return g_mapRegisteredPlayerSettings.delete(strRegisteredSettingsName);
			}
		}

		return false;
	}

	GetAllSettings() {
		return RequireSettingsDictionaryItems(this);
	}
}

class PlayerSettingsValues {
	constructor(PlayerReference, SettingsStorage = DEFAULT_STORAGE) {
		if (!IsSettingsStorage(SettingsStorage)) {
			throw new TypeError("SettingsStorage must provide GetSetting(), SetSetting(), DeleteSetting(), ClearPlayer() and GetPlayerValues().");
		}

		const strPlayerUniqueID = GetUniqueIDFromPlayer(PlayerReference);
		this.ValueUniqueID = strPlayerUniqueID;
		this.ValueStorage = SettingsStorage;
	}

	GetSetting(strSettingName, DefaultValue = null, Options, Callback) {
		const strNormalizedSettingName = NormalizeSettingName(strSettingName);
		const strPlayerUniqueID = RequirePlayerUniqueID(this.ValueUniqueID);
		CallSettingsStorageMethod(this.ValueStorage, "GetSetting", [strPlayerUniqueID, strNormalizedSettingName, DefaultValue], Options, Callback);
	}

	SetSetting(strSettingName, SettingsValue, Options, Callback) {
		const strNormalizedSettingName = NormalizeSettingName(strSettingName);
		const strPlayerUniqueID = RequirePlayerUniqueID(this.ValueUniqueID);
		CallSettingsStorageMethod(this.ValueStorage, "SetSetting", [strPlayerUniqueID, strNormalizedSettingName, SettingsValue], Options, Callback);
	}

	DeleteSetting(strSettingName, Options, Callback) {
		const strNormalizedSettingName = NormalizeSettingName(strSettingName);
		const strPlayerUniqueID = RequirePlayerUniqueID(this.ValueUniqueID);
		CallSettingsStorageMethod(this.ValueStorage, "DeleteSetting", [strPlayerUniqueID, strNormalizedSettingName], Options, Callback);
	}

	ClearSettings(Options, Callback) {
		const strPlayerUniqueID = RequirePlayerUniqueID(this.ValueUniqueID);
		CallSettingsStorageMethod(this.ValueStorage, "ClearPlayer", [strPlayerUniqueID], Options, Callback);
	}

	GetAllSettings(Options, Callback) {
		const strPlayerUniqueID = RequirePlayerUniqueID(this.ValueUniqueID);
		CallSettingsStorageMethod(this.ValueStorage, "GetPlayerValues", [strPlayerUniqueID], Options, Callback);
	}

	get UniqueID() {
		return this.ValueUniqueID;
	}

	get Storage() {
		return this.ValueStorage;
	}
}

function CreatePlayerSettings(PlayerReference, SettingsStorage = DEFAULT_STORAGE) {
	return new PlayerSettingsValues(PlayerReference, SettingsStorage);
}

function GetPlayerSettings() {
	return g_mapRegisteredPlayerSettings.values();
}

const g_PlayerSettingsAPI = {
	REGISTERED_PLAYER_SETTINGS: g_mapRegisteredPlayerSettings,
	PlayerSettings,
	PlayerSettingsValues,
	SettingsDictionary,
	CreatePlayerSettings,
	GetPlayerSettings,
	GetUniqueIDFromPlayer,
};

module.exports = g_PlayerSettingsAPI;
