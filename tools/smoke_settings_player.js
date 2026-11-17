#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");
const { CreateSettingsSOCIMock } = require("./native_soci_settings_mock.js");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "settings-player.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strMenusPath = g_Path.join(g_strPackageRootPath, "menus.js");
const g_strSettingsPlayerPath = g_Path.join(g_strPackageRootPath, "settings", "player.js");
const g_strSettingsStoragePath = g_Path.join(g_strPackageRootPath, "settings", "storage.js");
const g_strSettingsTypesPath = g_Path.join(g_strPackageRootPath, "settings", "types.js");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_vecNetworkIDCalls = [];

class PagedMenuOption {
	constructor(strOptionText, OptionValue, OptionConfiguration = {}) {
		let bOptionSelectable = true;

		if (Object.hasOwn(OptionConfiguration, "Selectable")) {
			bOptionSelectable = OptionConfiguration.Selectable;
		}

		this.Text = strOptionText;
		this.Value = OptionValue;
		this.Selectable = bOptionSelectable;
	}
}

class PagedMenu {
	constructor(MenuOptions) {
		this.ValueTitle = MenuOptions.Title;
		this.SelectCallback = MenuOptions.SelectCallback;
		this.Items = [];
		this.Sent = [];
	}

	AppendMenuItem(MenuItem) {
		this.Items.push(MenuItem);

		return MenuItem;
	}

	RemoveMenuItem(MenuItem) {
		const nMenuItemIndex = this.Items.indexOf(MenuItem);
		if (nMenuItemIndex < 0) {
			return false;
		}

		this.Items.splice(nMenuItemIndex, 1);

		return true;
	}

	SendMenu(unPlayerIndex, unMenuPage = 0, MenuTokens = {}) {
		this.Sent.push({ Page: unMenuPage, PlayerIndex: unPlayerIndex, Tokens: MenuTokens });

		return true;
	}
}

function ExecuteCodeBlock(strCodeBlockSource, unDocumentationBlockIndex, Modules) {
	const strCodeBlockPath = `${g_strDocumentationPath}:block-${unDocumentationBlockIndex}.js`;
	const ModuleRecord = new g_Module(strCodeBlockPath, module);
	ModuleRecord.filename = strCodeBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
	ModuleRecord.require = function RequireDocumentationModule(strRequestName) {
		const strImportDiagnostic = `settings/player code block ${unDocumentationBlockIndex} import: ${strRequestName}`;
		g_Assert.ok(Object.hasOwn(Modules, strRequestName), strImportDiagnostic);

		return Modules[strRequestName];
	};
	g_VM.runInNewContext("Compile();", {
		Compile() {
			ModuleRecord._compile(strCodeBlockSource, strCodeBlockPath);
		},
	}, { filename: strCodeBlockPath, timeout: g_unDocumentationTimeoutMilliseconds });

	return ModuleRecord.exports;
}

function NormalizeHeadingAnchor(strHeadingText) {
	const strLowercaseHeading = strHeadingText.toLowerCase();
	const strHeadingWithoutCodeTicks = strLowercaseHeading.replace(/`/g, "");
	const strNormalizedHeading = strHeadingWithoutCodeTicks.replace(/[^a-z0-9]+/g, "-");

	return strNormalizedHeading.replace(/^-|-$/g, "");
}

function ToPlainData(SerializableValue) {
	return JSON.parse(JSON.stringify(SerializableValue));
}

function VerifyContentsAnchors(strDocumentationText) {
	const vecContentsMatch = strDocumentationText.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "settings/player contents section");

	const vecDocumentedAnchors = [];
	for (const vecAnchorMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecAnchorMatch[1]);
	}

	const vecSectionAnchors = [];
	for (const vecSectionMatch of strDocumentationText.matchAll(/^## (.+)$/gm)) {
		const strSectionAnchor = NormalizeHeadingAnchor(vecSectionMatch[1]);
		if (strSectionAnchor !== "contents") {
			vecSectionAnchors.push(strSectionAnchor);
		}
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "settings/player contents anchors");
}

function VerifyDocumentationLinks(strDocumentationText) {
	const strDocumentationWithoutCode = strDocumentationText.replace(/```[\s\S]*?```/g, "");
	for (const vecLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strLinkTarget = vecLinkMatch[1];
		if (strLinkTarget.startsWith("#") || /^[a-z]+:/i.test(strLinkTarget)) {
			continue;
		}

		const nFragmentIndex = strLinkTarget.indexOf("#");
		let strDocumentationTarget = strLinkTarget;

		if (nFragmentIndex >= 0) {
			strDocumentationTarget = strLinkTarget.slice(0, nFragmentIndex);
		}

		const strDocumentationTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strDocumentationTarget);
		g_Assert.ok(g_FileSystem.existsSync(strDocumentationTargetPath), `settings/player documentation link must exist: ${strLinkTarget}`);
	}
}

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_LoaderDescriptor?.value;
const g_mapPackageCacheDescriptors = new Map();
let g_bSourceJSOwned = false;
let g_bLoaderOwned = false;
let g_bPackageCacheOwned = false;

function RestoreFixtureProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned settings/player fixture property must be removable: " + strKey);
}

function ReleaseSettingsPlayerFixture() {
	const vecFailures = [];
	const AttemptRestoration = (Restore) => {
		try {
			Restore();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	};

	if (g_bLoaderOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
			g_bLoaderOwned = false;
		});
	}

	if (g_bPackageCacheOwned) {
		const unPreviousFailureCount = vecFailures.length;
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
				AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
			AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, Descriptor));
		}

		if (vecFailures.length === unPreviousFailureCount) {
			g_bPackageCacheOwned = false;
		}
	}

	if (g_bSourceJSOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
			g_bSourceJSOwned = false;
		});
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Settings/player fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseSettingsPlayerFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Settings/player runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Settings/player loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed settings/player cache entries must support exact restoration.");
}

// Exit cleanup also covers synchronous assertion failures before the async runner starts.
process.once("exit", ReleaseSettingsPlayerFixture);
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

require.cache[g_strMenusPath] = { exports: { PagedMenu, PagedMenuOption }, filename: g_strMenusPath, id: g_strMenusPath, loaded: true };

g_bSourceJSOwned = true;
Object.defineProperty(globalThis, "sourcejs", {
	configurable: true,
	enumerable: true,
	writable: true,
	value: {
		players: {
			GetNetworkID(PlayerReference) {
				let unPlayerIndex;

				if (typeof PlayerReference === "number") {
					unPlayerIndex = PlayerReference;

				} else {
					unPlayerIndex = PlayerReference.Index;
				}

				if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex < 1)) {
					throw new TypeError("player index is invalid");
				}

				g_vecNetworkIDCalls.push(unPlayerIndex);

				return `STEAM_1:1:${unPlayerIndex}`;
			},
		},

		settings: {
			EnsureDirectoryExists() {
				return true;
			},

			Root: "memory/settings",
		},

		soci: CreateSettingsSOCIMock(),
	},
});

g_bLoaderOwned = true;
Object.defineProperty(g_Module, "_load", {
	...g_LoaderDescriptor,
	value: function LoadSourceJSModule(strRequest, ParentModule, bIsMain) {
		if (strRequest === "internal/runtime") {
			return g_OriginalModuleLoad(g_strInternalRuntimePath, ParentModule, bIsMain);
		}

		if (strRequest === "settings/storage") {
			return g_OriginalModuleLoad(g_strSettingsStoragePath, ParentModule, bIsMain);
		}

		if (strRequest === "menus") {
			return g_OriginalModuleLoad(g_strMenusPath, ParentModule, bIsMain);
		}

		if (strRequest === "settings/types") {
			return g_OriginalModuleLoad(g_strSettingsTypesPath, ParentModule, bIsMain);
		}

		return g_OriginalModuleLoad(strRequest, ParentModule, bIsMain);
	},
});

let g_StorageAPI;
let g_TypesAPI;
let g_PlayerAPI;

try {
	g_StorageAPI = require(g_strSettingsStoragePath);
	g_TypesAPI = require(g_strSettingsTypesPath);
	g_PlayerAPI = require(g_strSettingsPlayerPath);
} finally {
	RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
	g_bLoaderOwned = false;
}

g_Assert.deepEqual(Object.keys(g_PlayerAPI).sort(), [
	"CreatePlayerSettings",
	"GetPlayerSettings",
	"GetUniqueIDFromPlayer",
	"PlayerSettings",
	"PlayerSettingsValues",
	"REGISTERED_PLAYER_SETTINGS",
	"SettingsDictionary",
], "exact settings/player exports");

g_Assert.deepEqual(Object.getOwnPropertyNames(g_PlayerAPI.SettingsDictionary.prototype).sort(), [
	"AddBooleanSetting",
	"AddIntegerSetting",
	"AddSection",
	"AddStringSetting",
	"ApplyPrefix",
	"Choose",
	"ClearSettings",
	"DeleteSetting",
	"Entries",
	"ForEach",
	"GetSetting",
	"HasSetting",
	"Keys",
	"Items",
	"Menu",
	"Name",
	"Parent",
	"Path",
	"Prefix",
	"RefreshChildPrefixes",
	"Send",
	"SetSetting",
	"Size",
	"Text",
	"Values",
	"constructor",
].sort(), "SettingsDictionary members");
g_Assert.equal(typeof g_PlayerAPI.SettingsDictionary.prototype[Symbol.iterator], "function", "SettingsDictionary iterator");

g_Assert.deepEqual(Object.getOwnPropertyNames(g_PlayerAPI.PlayerSettings.prototype).sort(), [
	"GetAllSettings",
	"Unregister",
	"constructor",
], "PlayerSettings own members");

g_Assert.deepEqual(Object.getOwnPropertyNames(g_PlayerAPI.PlayerSettingsValues.prototype).sort(), [
	"ClearSettings",
	"DeleteSetting",
	"GetAllSettings",
	"GetSetting",
	"SetSetting",
	"Storage",
	"UniqueID",
	"constructor",
], "PlayerSettingsValues members");

g_Assert.equal(g_PlayerAPI.GetUniqueIDFromPlayer("STEAM_1:0:10"), "STEAM_1:0:10", "string unique IDs pass through");
g_Assert.equal(g_PlayerAPI.GetUniqueIDFromPlayer(3), "STEAM_1:1:3", "numeric players resolve through native runtime");
g_Assert.equal(g_PlayerAPI.GetUniqueIDFromPlayer({ Index: 4 }), "STEAM_1:1:4", "player objects resolve through native runtime");
g_Assert.deepEqual(g_vecNetworkIDCalls, [3, 4], "network ID calls preserve indexes");
g_Assert.throws(() => g_PlayerAPI.GetUniqueIDFromPlayer(""), TypeError, "empty unique IDs are rejected");
g_Assert.throws(() => g_PlayerAPI.GetUniqueIDFromPlayer({ Index: 0 }), TypeError, "invalid player indexes reject before native lookup");
g_Assert.throws(() => g_PlayerAPI.GetUniqueIDFromPlayer(null), TypeError, "null players are rejected");

const g_vecArrayPlayerReference = [];
g_vecArrayPlayerReference.Index = 5;
g_Assert.throws(() => g_PlayerAPI.GetUniqueIDFromPlayer(g_vecArrayPlayerReference), TypeError, "array-shaped player references are rejected");
g_Assert.deepEqual(g_vecNetworkIDCalls, [3, 4], "rejected array-shaped players do not reach the native runtime");

let g_unMalformedPlayerStateCommitCount = 0;

class ObservedPlayerSettingsValues extends g_PlayerAPI.PlayerSettingsValues {
}

Object.defineProperty(ObservedPlayerSettingsValues.prototype, "UniqueID", {
	configurable: true,

	set() {
		g_unMalformedPlayerStateCommitCount += 1;
	},
});

const g_OriginalGetNetworkID = globalThis.sourcejs.players.GetNetworkID;

try {
	globalThis.sourcejs.players.GetNetworkID = function GetMalformedNetworkID() {
		return 42;
	};

	g_Assert.throws(() => g_PlayerAPI.GetUniqueIDFromPlayer(5), TypeError, "malformed native unique IDs are rejected directly");
	g_Assert.throws(() => new ObservedPlayerSettingsValues(5), TypeError, "malformed native unique IDs reject value construction");
	g_Assert.equal(g_unMalformedPlayerStateCommitCount, 0, "malformed native unique IDs are rejected before state commit");
} finally {
	globalThis.sourcejs.players.GetNetworkID = g_OriginalGetNetworkID;
}

const g_RootSettings = new g_PlayerAPI.PlayerSettings("Source JS", "Source_JS", "SourceJS Settings");
const g_VolumeSetting = g_RootSettings.AddIntegerSetting("Volume", 5, { Maximum: 10, Minimum: 0, Text: "Volume" });
const g_EnabledSetting = g_RootSettings.AddBooleanSetting("Enabled", true, { Text: "Enabled" });
const g_ModeSetting = g_RootSettings.AddStringSetting("Mode", "classic", { Choices: ["classic", "advanced"], Text: "Mode" });
const g_GameplaySettings = g_RootSettings.AddSection("Gameplay Rules", { Text: "Gameplay Rules" });
const g_DifficultySetting = g_GameplaySettings.AddIntegerSetting("Difficulty", 2, { Maximum: 5, Minimum: 1 });

g_Assert.equal(g_PlayerAPI.REGISTERED_PLAYER_SETTINGS.get("Source JS"), g_RootSettings, "PlayerSettings registers by name");
g_Assert.equal(g_RootSettings.Name, "Source JS", "root name");
g_Assert.equal(g_RootSettings.Prefix, "SourceJS", "root prefix is PascalCase");
g_Assert.equal(g_RootSettings.Text, "SourceJS Settings", "root display text");
g_Assert.equal(g_RootSettings.Parent, null, "root has no parent");
g_Assert.equal(g_RootSettings.Size, 4, "root size");
g_Assert.deepEqual(g_RootSettings.Path, ["Source JS"], "root path");
g_Assert.deepEqual(g_GameplaySettings.Path, ["Source JS", "Gameplay Rules"], "section path");
g_Assert.equal(g_VolumeSetting.Prefix, "SourceJS", "direct setting prefix");
g_Assert.equal(g_DifficultySetting.Prefix, "SourceJSGameplayRules", "nested setting prefix");
g_Assert.equal(g_VolumeSetting.ConVar, "SourceJSVolume", "integer setting convar");
g_Assert.equal(g_EnabledSetting.ConVar, "SourceJSEnabled", "boolean setting convar");
g_Assert.deepEqual(Array.from(g_ModeSetting.Options.keys()), ["classic", "advanced"], "string choices");
g_Assert.equal(g_RootSettings.Items, g_RootSettings.GetAllSettings(), "PlayerSettings.GetAllSettings returns the live map");
g_Assert.equal(g_RootSettings.Menu.Items.length, 4, "dictionary menu follows current items");
g_Assert.equal(g_RootSettings.Option.Value, g_RootSettings, "root option points to the group");
g_Assert.equal(g_RootSettings.HasSetting("Volume"), true, "HasSetting finds values");
g_Assert.equal(g_RootSettings.GetSetting("Volume"), g_VolumeSetting, "GetSetting returns values");
g_Assert.equal(g_RootSettings.GetSetting("Missing"), null, "GetSetting returns null for missing values");
g_Assert.deepEqual(Array.from(g_RootSettings.Keys()), ["Volume", "Enabled", "Mode", "Gameplay Rules"], "Keys iterator");
g_Assert.deepEqual(Array.from(g_RootSettings.Values()), [g_VolumeSetting, g_EnabledSetting, g_ModeSetting, g_GameplaySettings], "Values iterator");
g_Assert.deepEqual(Array.from(g_RootSettings.Entries()), Array.from(g_RootSettings), "dictionary iterator yields entries");

const g_vecVisitedSettingsEntries = [];
const g_SettingsForEachContext = { Label: "context" };
const g_VisitSetting = function VisitSetting(SettingsValue, strSettingName, SettingsDictionary) {
	g_vecVisitedSettingsEntries.push([this.Label, SettingsValue, strSettingName, SettingsDictionary]);
};

g_VisitSetting.call = function RejectMutableCallbackCall() {
	throw new Error("SettingsDictionary.ForEach() must not dispatch through callback.call().");
};

g_RootSettings.ForEach(g_VisitSetting, g_SettingsForEachContext);

g_Assert.equal(g_vecVisitedSettingsEntries.length, 4, "ForEach visits every value");
g_Assert.deepEqual(g_vecVisitedSettingsEntries[0], ["context", g_VolumeSetting, "Volume", g_RootSettings], "ForEach callback arguments");

g_Assert.equal(g_RootSettings.Send(2, 1, { Source: "smoke" }), true, "Send forwards to the dictionary menu");
g_Assert.deepEqual(g_RootSettings.Menu.Sent[0], { Page: 1, PlayerIndex: 2, Tokens: { Source: "smoke" } }, "Send arguments");

g_Assert.equal(g_RootSettings.Choose(2, g_GameplaySettings), true, "Choose opens nested menus");
g_Assert.equal(g_GameplaySettings.Menu.Sent[0].PlayerIndex, 2, "nested menu target");

g_Assert.equal(g_RootSettings.Choose(2, g_VolumeSetting), false, "Choose ignores standalone settings");

g_RootSettings.ApplyPrefix(g_VolumeSetting);
g_RootSettings.RefreshChildPrefixes();

g_Assert.equal(g_VolumeSetting.Prefix, "SourceJS", "ApplyPrefix updates a direct value");
g_Assert.equal(g_DifficultySetting.Prefix, "SourceJSGameplayRules", "RefreshChildPrefixes updates descendants");

const g_strOriginalGameplaySettingsName = g_GameplaySettings.Name;

try {
	g_GameplaySettings.Name = "";
	g_Assert.throws(() => g_GameplaySettings.Path, TypeError, "Path rejects malformed editable dictionary names");
	g_Assert.throws(() => g_GameplaySettings.ApplyPrefix(g_DifficultySetting), TypeError, "ApplyPrefix rejects malformed editable nested dictionary names");
} finally {
	g_GameplaySettings.Name = g_strOriginalGameplaySettingsName;
}

const g_OriginalRootSettingsParent = g_RootSettings.Parent;

try {
	g_RootSettings.Parent = g_GameplaySettings;
	g_Assert.throws(() => g_RootSettings.Path, TypeError, "Path rejects live parent cycles");
} finally {
	g_RootSettings.Parent = g_OriginalRootSettingsParent;
}

const g_mapOriginalSettingsItems = g_RootSettings.Items;
const g_vecInvalidSettingsItemsOperations = [
	{
		OperationName: "Size",

		InvokeOperation() {
			return g_RootSettings.Size;
		},
	},
	{
		OperationName: "Keys",

		InvokeOperation() {
			return g_RootSettings.Keys();
		},
	},
	{
		OperationName: "Values",

		InvokeOperation() {
			return g_RootSettings.Values();
		},
	},
	{
		OperationName: "Entries",

		InvokeOperation() {
			return g_RootSettings.Entries();
		},
	},
	{
		OperationName: "Iterator",

		InvokeOperation() {
			return g_RootSettings[Symbol.iterator]();
		},
	},
	{
		OperationName: "ForEach",

		InvokeOperation() {
			return g_RootSettings.ForEach(() => undefined);
		},
	},
	{
		OperationName: "HasSetting",

		InvokeOperation() {
			return g_RootSettings.HasSetting("Volume");
		},
	},
	{
		OperationName: "GetSetting",

		InvokeOperation() {
			return g_RootSettings.GetSetting("Volume");
		},
	},
	{
		OperationName: "SetSetting",

		InvokeOperation() {
			return g_RootSettings.SetSetting("Replacement", new g_TypesAPI.IntegerSetting("Replacement", 1));
		},
	},
	{
		OperationName: "DeleteSetting",

		InvokeOperation() {
			return g_RootSettings.DeleteSetting("Volume");
		},
	},
	{
		OperationName: "ClearSettings",

		InvokeOperation() {
			return g_RootSettings.ClearSettings();
		},
	},
	{
		OperationName: "RefreshChildPrefixes",

		InvokeOperation() {
			return g_RootSettings.RefreshChildPrefixes();
		},
	},
	{
		OperationName: "GetAllSettings",

		InvokeOperation() {
			return g_RootSettings.GetAllSettings();
		},
	},
];

g_RootSettings.Items = [];

try {
	for (const InvalidSettingsItemsOperation of g_vecInvalidSettingsItemsOperations) {
		g_Assert.throws(() => InvalidSettingsItemsOperation.InvokeOperation(), TypeError, `${InvalidSettingsItemsOperation.OperationName} rejects a malformed live items collection`);
	}
} finally {
	g_RootSettings.Items = g_mapOriginalSettingsItems;
}

g_Assert.equal(g_RootSettings.DeleteSetting("Enabled"), true, "DeleteSetting removes an existing value");
g_Assert.equal(g_RootSettings.DeleteSetting("Enabled"), false, "DeleteSetting reports missing values");

let g_bRemovedEnabledOptionPresent = false;
for (const MenuItem of g_RootSettings.Menu.Items) {
	if (MenuItem.Value === g_EnabledSetting) {
		g_bRemovedEnabledOptionPresent = true;
		break;
	}
}

g_Assert.equal(g_bRemovedEnabledOptionPresent, false, "delete removes the menu option");
g_Assert.throws(() => g_RootSettings.SetSetting("Volume", new g_TypesAPI.IntegerSetting("Other", 1)), Error, "duplicate keys are rejected");
g_Assert.throws(() => g_RootSettings.SetSetting("Other", {}), TypeError, "SetSetting requires settings objects");
g_Assert.throws(() => g_RootSettings.ForEach(null), TypeError, "ForEach requires a callback");
g_Assert.throws(() => new g_PlayerAPI.SettingsDictionary("Bad1"), TypeError, "invalid names are rejected");
g_Assert.throws(() => new g_PlayerAPI.PlayerSettings("Other", 2), TypeError, "non-string prefixes are rejected");
g_Assert.throws(() => new g_PlayerAPI.PlayerSettings("Source JS", "duplicate"), Error, "duplicate roots are rejected");

const g_itRegisteredPlayerSettings = g_PlayerAPI.GetPlayerSettings();
const g_itSecondRegisteredPlayerSettings = g_PlayerAPI.GetPlayerSettings();
const g_FirstRegisteredSettingsResult = g_itRegisteredPlayerSettings.next();
const g_LaterPlayerSettings = new g_PlayerAPI.PlayerSettings("Later Source JS", "Later_Source_JS");
const g_LaterRegisteredSettingsResult = g_itRegisteredPlayerSettings.next();

g_Assert.notEqual(g_itRegisteredPlayerSettings, g_itSecondRegisteredPlayerSettings, "GetPlayerSettings returns live iterators");
g_Assert.equal(g_itRegisteredPlayerSettings[Symbol.iterator](), g_itRegisteredPlayerSettings, "registry result is an iterator");
g_Assert.equal(g_FirstRegisteredSettingsResult.value, g_RootSettings, "registry iterator starts with the existing root");
g_Assert.equal(g_FirstRegisteredSettingsResult.done, false, "existing root keeps the iterator active");
g_Assert.equal(g_LaterRegisteredSettingsResult.value, g_LaterPlayerSettings, "registry iterator observes later roots");
g_Assert.equal(g_LaterRegisteredSettingsResult.done, false, "later root keeps the iterator active");
g_Assert.equal(g_LaterPlayerSettings.Unregister(), true, "later root unregisters after the live-iterator check");
g_Assert.equal(g_itRegisteredPlayerSettings.next().done, true, "registry iterator completes after current roots");

g_Assert.equal(g_RootSettings.ClearSettings(), true, "ClearSettings removes all settings");
g_Assert.equal(g_RootSettings.Size, 0, "ClearSettings empties the map");
g_Assert.equal(g_RootSettings.Menu.Items.length, 0, "ClearSettings empties the menu");

g_RootSettings.Name = "Renamed Source JS";
g_Assert.equal(g_RootSettings.Unregister(), true, "Unregister removes the registered root after an editable name change");
g_Assert.equal(g_RootSettings.Unregister(), false, "Unregister reports missing roots");

function RunBlockingRequest(Request, strDiagnostic, RequestOptions = { Blocking: true }) {
	const vecCompletions = [];
	const DirectResult = Request(RequestOptions, (RequestError, RequestResult) => {
		vecCompletions.push([RequestError, RequestResult]);
	});
	g_Assert.equal(DirectResult, undefined, `${strDiagnostic}: no direct result`);
	g_Assert.equal(vecCompletions.length, 1, `${strDiagnostic}: exactly one inline completion`);

	const RequestError = vecCompletions[0][0];
	if (RequestError !== null) {
		throw RequestError;
	}

	return vecCompletions[0][1];
}

const g_SettingsStorage = g_StorageAPI.CreateStorage("player-smoke");
const g_PlayerSettingsValues = new g_PlayerAPI.PlayerSettingsValues(5, g_SettingsStorage);

try {
	g_Assert.equal(g_PlayerSettingsValues.UniqueID, "STEAM_1:1:5", "PlayerSettingsValues resolves identity once");
	g_Assert.equal(g_PlayerSettingsValues.Storage, g_SettingsStorage, "PlayerSettingsValues retains storage");
	g_Assert.equal(RunBlockingRequest((Options, Callback) => g_PlayerSettingsValues.GetSetting("Volume", 7, Options, Callback), "missing Volume"), 7, "GetSetting completes with default values");
	g_Assert.equal(RunBlockingRequest((Options, Callback) => g_PlayerSettingsValues.SetSetting("Volume", 9, Options, Callback), "write Volume"), true, "SetSetting forwards to storage");
	g_Assert.equal(RunBlockingRequest((Options, Callback) => g_PlayerSettingsValues.GetSetting("Volume", null, Options, Callback), "read Volume"), 9, "GetSetting completes with stored values");
	g_Assert.equal(RunBlockingRequest((Options, Callback) => g_PlayerSettingsValues.GetAllSettings(Options, Callback), "player values").Volume, 9, "GetAllSettings completes with current player values");
	g_Assert.equal(RunBlockingRequest((Options, Callback) => g_PlayerSettingsValues.DeleteSetting("Volume", Options, Callback), "delete Volume"), true, "DeleteSetting forwards to storage");
	g_Assert.equal(RunBlockingRequest((Options, Callback) => g_PlayerSettingsValues.SetSetting("Mode", "classic", Options, Callback), "write Mode"), true, "second setting value");
	g_Assert.equal(RunBlockingRequest((Options, Callback) => g_PlayerSettingsValues.ClearSettings(Options, Callback), "clear player"), true, "ClearSettings forwards to ClearPlayer");
	g_Assert.deepEqual(Object.keys(RunBlockingRequest((Options, Callback) => g_PlayerSettingsValues.GetAllSettings(Options, Callback), "cleared values")), [], "ClearSettings removes player values");
	g_Assert.ok(g_PlayerAPI.CreatePlayerSettings("STEAM_1:0:7", g_SettingsStorage) instanceof g_PlayerAPI.PlayerSettingsValues, "CreatePlayerSettings constructs a values view");
} finally {
	g_Assert.equal(RunBlockingRequest((Options, Callback) => g_SettingsStorage.Close(Options, Callback), "player storage cleanup"), true, "storage closes after CRUD");
}

g_Assert.equal(g_SettingsStorage.Handle, null, "CRUD releases the SOCI handle");
g_Assert.throws(() => new g_PlayerAPI.PlayerSettingsValues("STEAM_1:0:7", []), TypeError, "storage arrays are rejected");

// This fixture models completion timing, not native worker execution.
function CompleteMockStorageRequest(vecArguments, RequestResult) {
	const Options = vecArguments[vecArguments.length - 2];
	const Callback = vecArguments[vecArguments.length - 1];
	g_Assert.equal(typeof Options.Blocking, "boolean", "storage receives a normalized mode");
	g_Assert.equal(typeof Callback, "function", "storage receives a callback");

	if (Options.Blocking) {
		Callback(null, RequestResult);
		return;
	}

	queueMicrotask(() => Callback(null, RequestResult));
}

let g_unStorageGetMethodReadCount = 0;
const g_vecStorageMethodArguments = [];
const g_ReceiverAwareSettingsStorage = {
	SetSetting(...vecArguments) {
		CompleteMockStorageRequest(vecArguments, true);
	},

	DeleteSetting(...vecArguments) {
		CompleteMockStorageRequest(vecArguments, true);
	},

	ClearPlayer(...vecArguments) {
		CompleteMockStorageRequest(vecArguments, true);
	},

	GetPlayerValues(...vecArguments) {
		CompleteMockStorageRequest(vecArguments, Object.create(null));
	},
};

Object.defineProperty(g_ReceiverAwareSettingsStorage, "GetSetting", {
	configurable: true,
	enumerable: true,

	get() {
		g_unStorageGetMethodReadCount += 1;

		return function GetPlayerSetting(strPlayerUniqueID, strSettingName, DefaultSettingValue, Options, Callback) {
			g_Assert.equal(this, g_ReceiverAwareSettingsStorage, "storage methods retain their receiver");
			g_vecStorageMethodArguments.push(strPlayerUniqueID, strSettingName, DefaultSettingValue, Options, Callback);
			CompleteMockStorageRequest([Options, Callback], DefaultSettingValue);
		};
	},
});

const g_ReceiverAwarePlayerSettingsValues = new g_PlayerAPI.PlayerSettingsValues("STEAM_1:0:8", g_ReceiverAwareSettingsStorage);
const g_ReceiverAwareDefaultSettingValue = { Mode: "classic" };
let g_unReceiverModeReadCount = 0;
const g_ReceiverRequestOptions = {
	get Blocking() {
		g_unReceiverModeReadCount += 1;

		return true;
	},
};

g_unStorageGetMethodReadCount = 0;
g_Assert.equal(RunBlockingRequest((Options, Callback) => g_ReceiverAwarePlayerSettingsValues.GetSetting("Mode", g_ReceiverAwareDefaultSettingValue, Options, Callback), "receiver-aware GetSetting", g_ReceiverRequestOptions), g_ReceiverAwareDefaultSettingValue, "storage calls complete with the exact object result");
g_Assert.equal(g_unStorageGetMethodReadCount, 1, "storage methods are read once per operation");
g_Assert.deepEqual(g_vecStorageMethodArguments.slice(0, 3), ["STEAM_1:0:8", "Mode", g_ReceiverAwareDefaultSettingValue], "storage methods receive validated operation arguments");
g_Assert.equal(g_unReceiverModeReadCount, 1, "Blocking getter is read exactly once");
g_Assert.notEqual(g_vecStorageMethodArguments[3], g_ReceiverRequestOptions, "storage receives a fresh mode snapshot");
g_Assert.deepEqual(g_vecStorageMethodArguments[3], { Blocking: true }, "captured Blocking mode");
g_Assert.equal(typeof g_vecStorageMethodArguments[4], "function", "required callback follows the options");

try {
	g_ReceiverAwarePlayerSettingsValues.ValueStorage = [];
	g_Assert.throws(() => g_ReceiverAwarePlayerSettingsValues.GetSetting("Mode", null, {}, () => undefined), TypeError, "live storage arrays are rejected");
} finally {
	g_ReceiverAwarePlayerSettingsValues.ValueStorage = g_ReceiverAwareSettingsStorage;
}

Object.defineProperty(g_ReceiverAwareSettingsStorage, "GetSetting", { configurable: true, enumerable: true, value: null, writable: true });
g_Assert.throws(() => g_ReceiverAwarePlayerSettingsValues.GetSetting("Mode", null, {}, () => undefined), TypeError, "replaced storage methods must remain callable");

const g_vecRequiredSettingsStorageMethodNames = Object.freeze([
	"GetSetting",
	"SetSetting",
	"DeleteSetting",
	"ClearPlayer",
	"GetPlayerValues",
]);
for (const strMissingStorageMethodName of g_vecRequiredSettingsStorageMethodNames) {
	const IncompleteSettingsStorage = {};
	for (const strStorageMethodName of g_vecRequiredSettingsStorageMethodNames) {
		IncompleteSettingsStorage[strStorageMethodName] = () => true;
	}

	delete IncompleteSettingsStorage[strMissingStorageMethodName];
	g_Assert.throws(() => new g_PlayerAPI.PlayerSettingsValues("STEAM_1:0:7", IncompleteSettingsStorage), TypeError, `storage requires ${strMissingStorageMethodName}`);
}

let g_unInvalidDictionaryTextOptionReadCount = 0;
const g_InvalidDictionaryTextOptions = {};
Object.defineProperty(g_InvalidDictionaryTextOptions, "Prefix", {
	get() {
		g_unInvalidDictionaryTextOptionReadCount += 1;

		return "unread";
	},
});

g_Assert.throws(() => new g_PlayerAPI.SettingsDictionary("Text Validation", 7, g_InvalidDictionaryTextOptions), TypeError, "constructor validates direct text before reading options");
g_Assert.equal(g_unInvalidDictionaryTextOptionReadCount, 0, "invalid direct text prevents option reads");

let g_unInvalidDictionaryNameOptionReadCount = 0;
const g_InvalidDictionaryNameOptions = {};
Object.defineProperty(g_InvalidDictionaryNameOptions, "Prefix", {
	get() {
		g_unInvalidDictionaryNameOptionReadCount += 1;

		return "unread";
	},
});

g_Assert.throws(() => new g_PlayerAPI.SettingsDictionary("", null, g_InvalidDictionaryNameOptions), TypeError, "constructor validates its direct name before reading options");
g_Assert.equal(g_unInvalidDictionaryNameOptionReadCount, 0, "invalid direct names prevent option reads");

let g_unInvalidDictionaryPrefixReadCount = 0;
let g_unDictionaryParentReadCount = 0;
const g_InvalidDictionaryPrefixOptions = {};
Object.defineProperties(g_InvalidDictionaryPrefixOptions, {
	Prefix: {
		get() {
			g_unInvalidDictionaryPrefixReadCount += 1;

			return 7;
		},
	},
	Parent: {
		get() {
			g_unDictionaryParentReadCount += 1;

			return null;
		},
	},
});

g_Assert.throws(() => new g_PlayerAPI.SettingsDictionary("Prefix Validation", null, g_InvalidDictionaryPrefixOptions), TypeError, "constructor validates prefix before reading parent");
g_Assert.equal(g_unInvalidDictionaryPrefixReadCount, 1, "constructor reads prefix once");
g_Assert.equal(g_unDictionaryParentReadCount, 0, "invalid prefix prevents parent reads");

const g_LabelValidationDictionary = new g_PlayerAPI.SettingsDictionary("Label Validation");
const g_MalformedLabelSetting = new g_TypesAPI.IntegerSetting("Initial Label", 1);

g_MalformedLabelSetting.Text = null;
g_MalformedLabelSetting.Name = "";
g_Assert.throws(() => g_LabelValidationDictionary.SetSetting("Stored Label", g_MalformedLabelSetting), TypeError, "SetSetting validates an editable name-derived label before menu mutation");
g_Assert.equal(g_LabelValidationDictionary.Size, 0, "invalid name-derived labels leave dictionary state unchanged");
g_Assert.equal(g_LabelValidationDictionary.Menu.Items.length, 0, "invalid name-derived labels leave menu state unchanged");

let g_unInvalidSectionNameTextReadCount = 0;
const g_InvalidSectionNameOptions = {};
const g_SectionNameValidationDictionary = new g_PlayerAPI.SettingsDictionary("Section Name Validation");

Object.defineProperty(g_InvalidSectionNameOptions, "Text", {
	get() {
		g_unInvalidSectionNameTextReadCount += 1;

		return "unread";
	},
});

g_Assert.throws(() => g_SectionNameValidationDictionary.AddSection("", g_InvalidSectionNameOptions), TypeError, "AddSection validates its direct name before reading text");
g_Assert.equal(g_unInvalidSectionNameTextReadCount, 0, "invalid section names prevent text reads");

let g_unSectionPrefixReadCount = 0;
const g_SectionTextValidationDictionary = new g_PlayerAPI.SettingsDictionary("Section Text Validation");

Object.defineProperty(g_SectionTextValidationDictionary, "Prefix", {
	configurable: true,
	enumerable: true,

	get() {
		g_unSectionPrefixReadCount += 1;

		return "unread";
	},
});

g_Assert.throws(() => g_SectionTextValidationDictionary.AddSection("Invalid Text", { Text: 7 }), TypeError, "AddSection validates text before reading the live prefix");
g_Assert.equal(g_unSectionPrefixReadCount, 0, "invalid section text prevents prefix reads");

let g_unApplyPrefixParentReadCount = 0;
const g_ApplyPrefixValidationDictionary = new g_PlayerAPI.SettingsDictionary("Apply Prefix Validation");
const g_ApplyPrefixValidationSetting = new g_TypesAPI.IntegerSetting("Apply Prefix Setting", 1);

Object.defineProperties(g_ApplyPrefixValidationDictionary, {
	Prefix: { configurable: true, enumerable: true, value: 7, writable: true },
	Parent: {
		configurable: true,
		enumerable: true,

		get() {
			g_unApplyPrefixParentReadCount += 1;

			return null;
		},
	},
});

g_Assert.throws(() => g_ApplyPrefixValidationDictionary.ApplyPrefix(g_ApplyPrefixValidationSetting), TypeError, "ApplyPrefix validates the editable prefix before reading the editable parent");
g_Assert.equal(g_unApplyPrefixParentReadCount, 0, "invalid editable prefixes prevent parent reads");

const g_DuplicateValidationDictionary = new g_PlayerAPI.SettingsDictionary("Duplicate Validation");
const g_DuplicateRegisteredSetting = new g_TypesAPI.IntegerSetting("Duplicate", 1);
const g_DuplicateReplacementSetting = new g_TypesAPI.IntegerSetting("Replacement", 2);

g_DuplicateValidationDictionary.SetSetting("Duplicate", g_DuplicateRegisteredSetting);

const g_DuplicateValidationMenu = g_DuplicateValidationDictionary.Menu;
let g_unDuplicateValidationMenuReadCount = 0;
Object.defineProperty(g_DuplicateValidationDictionary, "Menu", {
	configurable: true,
	enumerable: true,

	get() {
		g_unDuplicateValidationMenuReadCount += 1;

		throw new Error("duplicate validation must not read menu");
	},
});

try {
	g_Assert.throws(() => g_DuplicateValidationDictionary.SetSetting("Duplicate", g_DuplicateReplacementSetting), /already registered/, "SetSetting rejects duplicate entries before reading the editable menu");
	g_Assert.equal(g_unDuplicateValidationMenuReadCount, 0, "duplicate entries prevent menu reads");
} finally {
	Object.defineProperty(g_DuplicateValidationDictionary, "Menu", { configurable: true, enumerable: true, value: g_DuplicateValidationMenu, writable: true });
}

g_Assert.equal(g_DuplicateValidationDictionary.ClearSettings(), true, "duplicate validation dictionary cleanup");

const g_DeleteValidationDictionary = new g_PlayerAPI.SettingsDictionary("Delete Validation");
const g_DeleteValidationSetting = new g_TypesAPI.IntegerSetting("Delete Entry", 1);

g_DeleteValidationDictionary.SetSetting("Delete Entry", g_DeleteValidationSetting);

const g_DeleteValidationMenu = g_DeleteValidationDictionary.Menu;
const g_DeleteValidationOption = g_DeleteValidationSetting.Option;
let g_unDeleteValidationMenuReadCount = 0;

g_DeleteValidationSetting.Option = {};
Object.defineProperty(g_DeleteValidationDictionary, "Menu", {
	configurable: true,
	enumerable: true,

	get() {
		g_unDeleteValidationMenuReadCount += 1;

		throw new Error("delete validation must not read menu");
	},
});

try {
	g_Assert.throws(() => g_DeleteValidationDictionary.DeleteSetting("Delete Entry"), /option must be a PagedMenuOption/, "DeleteSetting validates the editable option before reading the editable menu");
	g_Assert.equal(g_unDeleteValidationMenuReadCount, 0, "invalid editable options prevent menu reads");
} finally {
	g_DeleteValidationSetting.Option = g_DeleteValidationOption;
	Object.defineProperty(g_DeleteValidationDictionary, "Menu", { configurable: true, enumerable: true, value: g_DeleteValidationMenu, writable: true });
}

g_Assert.equal(g_DeleteValidationDictionary.DeleteSetting("Delete Entry"), true, "DeleteSetting validation dictionary cleanup");

const g_ClearValidationDictionary = new g_PlayerAPI.SettingsDictionary("Clear Validation");
g_ClearValidationDictionary.SetSetting("Clear Entry", new g_TypesAPI.IntegerSetting("Clear Entry", 1));

try {
	g_ClearValidationDictionary.DeleteSetting = function RejectSettingDeletion() {
		return false;
	};

	g_Assert.throws(() => g_ClearValidationDictionary.ClearSettings(), /could not be deleted/, "ClearSettings rejects an exact false delete result");
	g_Assert.equal(g_ClearValidationDictionary.Size, 1, "failed clear retains the live dictionary entry");
} finally {
	delete g_ClearValidationDictionary.DeleteSetting;
}

g_Assert.equal(g_ClearValidationDictionary.ClearSettings(), true, "ClearSettings validation dictionary cleanup");

const g_CycleRootDictionary = new g_PlayerAPI.SettingsDictionary("Cycle Root");
const g_CycleChildDictionary = new g_PlayerAPI.SettingsDictionary("Cycle Child", null, { Parent: g_CycleRootDictionary, Prefix: g_CycleRootDictionary.Prefix });

g_CycleRootDictionary.SetSetting("Cycle Child", g_CycleChildDictionary);

try {
	g_CycleChildDictionary.Items.set("Cycle Root", g_CycleRootDictionary);

	g_Assert.throws(() => g_CycleRootDictionary.RefreshChildPrefixes(), /child hierarchy must not contain a cycle/, "RefreshChildPrefixes rejects live child cycles");
} finally {
	// Failure may occur before the back-edge is installed; cleanup accepts an absent key.
	g_CycleChildDictionary.Items.delete("Cycle Root");
}

g_Assert.doesNotThrow(() => g_CycleRootDictionary.RefreshChildPrefixes(), "RefreshChildPrefixes cleans recursive state after a failed cycle");
g_Assert.equal(g_CycleRootDictionary.ClearSettings(), true, "cycle validation dictionary cleanup");

const g_strDocumentationText = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationCodeBlocks = [];
for (const vecDocumentationCodeBlockMatch of g_strDocumentationText.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecDocumentationCodeBlocks.push(vecDocumentationCodeBlockMatch[1]);
}

g_Assert.equal(g_vecDocumentationCodeBlocks.length, 6, "settings/player JavaScript block count");

const g_vecDocumentationImportMatch = g_vecDocumentationCodeBlocks[0].match(/const\s*{([\s\S]*?)}\s*=\s*require\("settings\/player"\);/);
g_Assert.ok(g_vecDocumentationImportMatch, "settings/player exact import example");

const g_vecDocumentedExportNames = g_vecDocumentationImportMatch[1].split(",").map((strImportEntry) => strImportEntry.split(":", 1)[0].trim()).filter(Boolean);
g_vecDocumentedExportNames.sort();

g_Assert.deepEqual(g_vecDocumentedExportNames, Object.keys(g_PlayerAPI).sort(), "exact documented settings/player exports");
g_Assert.doesNotMatch(g_strDocumentationText, /Generated by|\bconsole\.|(?:const|let|var)\s+\w+\s*=\s*require\("settings\/player"\)/, "settings/player documentation must remain hand-written and use direct imports");
g_Assert.doesNotMatch(g_strDocumentationText, /[^\x00-\x7F]/, "settings/player documentation ASCII");
g_Assert.doesNotMatch(g_strDocumentationText, /[ \t]+$/m, "settings/player documentation trailing whitespace");

for (const strDocumentationCodeBlock of g_vecDocumentationCodeBlocks) {
	g_Assert.doesNotMatch(strDocumentationCodeBlock, /^ +\S/m, "settings/player JavaScript fence indentation must use tabs");
}

VerifyContentsAnchors(g_strDocumentationText);
VerifyDocumentationLinks(g_strDocumentationText);

const g_DocumentationModulesByName = { "settings/player": g_PlayerAPI, "settings/types": g_TypesAPI };
const g_DocumentedWorkflows = {};
const g_unNetworkIDCallCountBeforeDocumentation = g_vecNetworkIDCalls.length;

for (const [unDocumentationBlockOffset, strDocumentationCodeBlock] of g_vecDocumentationCodeBlocks.entries()) {
	Object.assign(g_DocumentedWorkflows, ExecuteCodeBlock(strDocumentationCodeBlock, unDocumentationBlockOffset + 1, g_DocumentationModulesByName));
}

g_Assert.equal(g_vecNetworkIDCalls.length, g_unNetworkIDCallCountBeforeDocumentation, "settings/player code blocks must not query players while loading");
g_Assert.equal(g_PlayerAPI.REGISTERED_PLAYER_SETTINGS.size, 0, "settings/player code blocks must not register roots while loading");
g_Assert.deepEqual(Object.keys(g_DocumentedWorkflows).sort(), [
	"CreateMatchSettingsController",
	"ExercisePlayerSettingsValues",
	"ExerciseSettingsDictionary",
	"MemorySettingsStorage",
	"ResolvePlayerIdentities",
], "settings/player documented workflows");

const g_DocumentedMatchSettingsController = g_DocumentedWorkflows.CreateMatchSettingsController();

g_Assert.equal(g_PlayerAPI.REGISTERED_PLAYER_SETTINGS.size, 0, "controller creation leaves registry unchanged");

const g_DocumentedMatchSettings = g_DocumentedMatchSettingsController.Load();
const g_DocumentedMatchSettingsInspection = g_DocumentedMatchSettingsController.Inspect();

g_Assert.equal(g_DocumentedMatchSettings.Size, 4, "controller root setting count");
g_Assert.equal(g_DocumentedMatchSettingsInspection.AllSettingsAreItems, true, "controller live all map");
g_Assert.equal(g_DocumentedMatchSettingsInspection.Entries.length, 4, "controller entries count");
g_Assert.equal(g_DocumentedMatchSettingsInspection.HasAutoReady, true, "controller has workflow");
g_Assert.equal(g_DocumentedMatchSettingsInspection.IteratorEntries.length, 4, "controller iterator count");
g_Assert.deepEqual(ToPlainData(g_DocumentedMatchSettingsInspection.Keys), ["Auto Ready", "Minimum Players", "Ready Message", "Advanced Rules"], "controller key order");
g_Assert.equal(g_DocumentedMatchSettingsInspection.MinimumPlayers, g_DocumentedMatchSettings.GetSetting("Minimum Players"), "controller get workflow");
g_Assert.deepEqual(ToPlainData(g_DocumentedMatchSettingsInspection.Path), ["Match Controls"], "controller root path");
g_Assert.equal(g_DocumentedMatchSettingsInspection.RootRegistered, true, "controller registry lookup");
g_Assert.equal(g_DocumentedMatchSettingsInspection.Size, 4, "controller size getter");
g_Assert.equal(g_DocumentedMatchSettingsInspection.LiveRegistryContainsRoot, true, "controller live registry iterator");
g_Assert.equal(g_DocumentedMatchSettingsInspection.Values.length, 4, "controller values count");
g_Assert.equal(g_DocumentedMatchSettingsInspection.Visits.length, 4, "controller ForEach count");
g_Assert.equal(g_DocumentedMatchSettingsInspection.Visits[0].SettingsEntry, g_DocumentedMatchSettings.GetSetting("Auto Ready"), "controller ForEach setting entry");
g_Assert.equal(g_DocumentedMatchSettingsInspection.Visits[0].SettingName, "Auto Ready", "controller ForEach setting name");
g_Assert.equal(g_DocumentedMatchSettingsInspection.Visits[0].SettingsDictionary, g_DocumentedMatchSettings, "controller ForEach settings dictionary");

g_Assert.equal(g_DocumentedMatchSettingsController.Show(2, 1), true, "controller root menu send");
g_Assert.deepEqual(ToPlainData(g_DocumentedMatchSettings.Menu.Sent[0]), { Page: 1, PlayerIndex: 2, Tokens: { Scope: "match" } }, "controller send arguments");

g_Assert.equal(g_DocumentedMatchSettingsController.OpenAdvanced(2), true, "controller nested menu choice");

const g_strDocumentedRegisteredRootName = g_DocumentedMatchSettings.Name;

try {
	g_DocumentedMatchSettings.Name = "Renamed Match Controls";
	g_Assert.equal(g_DocumentedMatchSettingsController.Inspect().RootRegistered, true, "controller inspection retains the original registry key after a name edit");
	g_Assert.equal(g_PlayerAPI.REGISTERED_PLAYER_SETTINGS.get(g_strDocumentedRegisteredRootName), g_DocumentedMatchSettings, "name edits do not rekey the root registry");
} finally {
	g_DocumentedMatchSettings.Name = g_strDocumentedRegisteredRootName;
}

g_Assert.equal(g_DocumentedMatchSettingsController.Unload(), true, "controller Unload unregisters root");
g_Assert.equal(g_DocumentedMatchSettingsController.Unload(), false, "controller Unload is idempotent");
g_Assert.equal(g_DocumentedMatchSettings.Size, 0, "controller Unload clears definitions");
g_Assert.equal(g_PlayerAPI.REGISTERED_PLAYER_SETTINGS.size, 0, "controller restores root registry");

function VerifyDocumentedControllerCleanup() {
	const SettingsDictionaryPrototype = g_PlayerAPI.SettingsDictionary.prototype;
	const PlayerSettingsPrototype = g_PlayerAPI.PlayerSettings.prototype;
	const AddStringSettingDescriptor = Object.getOwnPropertyDescriptor(SettingsDictionaryPrototype, "AddStringSetting");
	const ClearSettingsDescriptor = Object.getOwnPropertyDescriptor(SettingsDictionaryPrototype, "ClearSettings");
	const UnregisterDescriptor = Object.getOwnPropertyDescriptor(PlayerSettingsPrototype, "Unregister");
	const vecFailures = [
		new Error("Controller fixture failure"),
		null,
		undefined,
		0,
		false,
		"Controller failure",
	];
	const vecCleanupModes = [
		{ ClearFailure: false, UnregisterFailure: false },
		{ ClearFailure: true, UnregisterFailure: false },
		{ ClearFailure: false, UnregisterFailure: true },
		{ ClearFailure: true, UnregisterFailure: true },
	];

	for (const bDuringLoad of [true, false]) {
		for (const Failure of vecFailures) {
			for (const CleanupMode of vecCleanupModes) {
				const Controller = g_DocumentedWorkflows.CreateMatchSettingsController();
				const vecCleanupVisits = [];
				let OwnedRoot = null;
				let CaughtFailure = undefined;
				let bFailureCaught = false;
				let bResult = false;
				let bRetryResult = false;
				const bCleanupFails = CleanupMode.ClearFailure || CleanupMode.UnregisterFailure;

				try {
					if (!bDuringLoad) {
						OwnedRoot = Controller.Load();

					} else {
						Object.defineProperty(SettingsDictionaryPrototype, "AddStringSetting", {
							...AddStringSettingDescriptor,

							value: function RejectStringSetting() {
								throw Failure;
							},
						});
					}

					Object.defineProperty(SettingsDictionaryPrototype, "ClearSettings", {
						...ClearSettingsDescriptor,

						value: function ClearFixtureSettings() {
							OwnedRoot = this;
							vecCleanupVisits.push("ClearSettings");

							if (CleanupMode.ClearFailure) {
								throw Failure;
							}

							return Reflect.apply(ClearSettingsDescriptor.value, this, []);
						},
					});
					Object.defineProperty(PlayerSettingsPrototype, "Unregister", {
						...UnregisterDescriptor,

						value: function UnregisterFixtureSettings() {
							vecCleanupVisits.push("Unregister");

							if (CleanupMode.UnregisterFailure) {
								throw Failure;
							}

							return Reflect.apply(UnregisterDescriptor.value, this, []);
						},
					});

					try {
						if (bDuringLoad) {
							Controller.Load();
						} else {
							bResult = Controller.Unload();
						}
					} catch (OperationFailure) {
						CaughtFailure = OperationFailure;
						bFailureCaught = true;
					}

					g_Assert.deepEqual(vecCleanupVisits, ["ClearSettings", "Unregister"], "cleanup attempts both operations");
					g_Assert.equal(bFailureCaught, bDuringLoad || bCleanupFails, "expected controller failure boundary");

					if (bCleanupFails) {
						g_Assert.equal(CaughtFailure.name, "AggregateError", "cleanup reports every failure");

						const CleanupFailure = bDuringLoad ? CaughtFailure.errors[1] : CaughtFailure;
						if (bDuringLoad) {
							g_Assert.equal(CaughtFailure.errors.length, 2, "load and cleanup failures are separate");
							g_Assert.equal(CaughtFailure.errors[0], Failure, "original load failure identity");
						}

						const vecExpectedCleanupFailures = [];
						if (CleanupMode.ClearFailure) {
							vecExpectedCleanupFailures.push(Failure);
						}

						if (CleanupMode.UnregisterFailure) {
							vecExpectedCleanupFailures.push(Failure);
						}

						g_Assert.deepEqual(Array.from(CleanupFailure.errors), vecExpectedCleanupFailures, "cleanup failure order and identity");
						g_Assert.equal(Controller.Inspect().AllSettingsAreItems, true, "failed cleanup retains the owned root");
						g_Assert.throws(() => Controller.Load(), /already loaded/, "failed cleanup blocks duplicate ownership");

					} else if (bDuringLoad) {
						g_Assert.equal(CaughtFailure, Failure, "successful cleanup preserves the exact thrown value");

					} else {
						g_Assert.equal(bResult, true, "successful unload reports registry removal");
					}
				} finally {
					Object.defineProperty(SettingsDictionaryPrototype, "AddStringSetting", AddStringSettingDescriptor);
					Object.defineProperty(SettingsDictionaryPrototype, "ClearSettings", ClearSettingsDescriptor);
					Object.defineProperty(PlayerSettingsPrototype, "Unregister", UnregisterDescriptor);

					try {
						bRetryResult = Controller.Unload();
					} finally {
						if (OwnedRoot !== null) {
							g_Assert.equal(OwnedRoot.ClearSettings(), true, "owned root fallback clears any remaining settings");
							// The controller may already have unregistered this root; false is valid final cleanup.
							OwnedRoot.Unregister();
						}
					}
				}

				g_Assert.equal(bRetryResult, bCleanupFails && CleanupMode.UnregisterFailure, "retry finishes cleanup with the actual registry result");
				g_Assert.equal(Controller.Unload(), false, "finished cleanup is idempotent");
				g_Assert.equal(g_PlayerAPI.REGISTERED_PLAYER_SETTINGS.size, 0, "cleanup scenario restores registry");
			}
		}
	}
}

VerifyDocumentedControllerCleanup();

g_Assert.deepEqual(ToPlainData(g_DocumentedWorkflows.ExerciseSettingsDictionary(4)), {
	AdvancedAudioChoiceResult: true,
	AudioSettingsCleared: true,
	AudioSettingsSizeAfterClear: 0,
	MissingVolumeAfterDelete: null,
	MuteMusicSettingPrefix: "AudioAdvanced",
	RemainingAudioSettingCount: 1,
	VolumeChoiceResult: false,
	VolumeDeleted: true,
	VolumeSettingPrefix: "Audio",
}, "settings/player direct dictionary workflow");

g_Assert.deepEqual(ToPlainData(g_DocumentedWorkflows.ResolvePlayerIdentities(8, "STEAM_1:1:8")), { DirectNetworkID: "STEAM_1:1:8", NetworkIDFromIndex: "STEAM_1:1:8", NetworkIDFromObject: "STEAM_1:1:8" }, "settings/player identity workflow");

g_Assert.throws(() => g_DocumentedWorkflows.ExercisePlayerSettingsValues(9, null, {}, () => undefined), /dedicated settings storage object/, "values workflow requires owned storage");
g_Assert.equal(g_PlayerAPI.REGISTERED_PLAYER_SETTINGS.size, 0, "settings/player final root registry");

const g_unRequestTimeoutMilliseconds = 5000;
const g_MissingNativeRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strSettingsPlayerPath)});`], { encoding: "utf8", env: { ...process.env, NODE_PATH: g_strPackageRootPath }, timeout: g_unRequestTimeoutMilliseconds });
g_Assert.equal(g_MissingNativeRuntimeResult.error, undefined, "missing-runtime child must start and finish within the deadline");
g_Assert.equal(g_MissingNativeRuntimeResult.status, 1, "missing-runtime child reports the expected Node failure status");
g_Assert.notEqual(g_MissingNativeRuntimeResult.status, 0, "settings/player requires the native runtime");
g_Assert.match(g_MissingNativeRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

async function AwaitRequest(Request, Options, bMustDefer = false) {
	const bBlocking = Options.Blocking === true;
	const vecCompletions = [];
	let ResolveCompletion;
	const Completion = new Promise((Resolve) => {
		ResolveCompletion = Resolve;
	});

	const DirectResult = Request(Options, (RequestError, RequestResult) => {
		vecCompletions.push([RequestError, RequestResult]);
		ResolveCompletion();
	});
	const unInlineCompletionCount = vecCompletions.length;

	await Completion;
	await Promise.resolve();
	g_Assert.equal(DirectResult, undefined, "requests have no direct result");
	g_Assert.equal(vecCompletions.length, 1, "request completes exactly once");

	if (bMustDefer) {
		g_Assert.equal(unInlineCompletionCount, 0, "uncached or fixture request must defer");
	}

	if (bBlocking) {
		g_Assert.equal(unInlineCompletionCount, 1, "Blocking keeps the inline callback");
	}

	const RequestError = vecCompletions[0][0];
	if (RequestError !== null) {
		throw RequestError;
	}

	return vecCompletions[0][1];
}

async function VerifyPlayerSettingsRequests() {
	const unUnsigned64Maximum = 18446744073709551615n;
	const nSigned64Minimum = -9223372036854775808n;
	const DefaultValue = { Fallback: true };
	const vecDescriptors = [
		{ MethodName: "GetSetting", StorageMethodName: "GetSetting", Arguments: ["Exact Key", DefaultValue] },
		{ MethodName: "SetSetting", StorageMethodName: "SetSetting", Arguments: ["Exact Key", unUnsigned64Maximum] },
		{ MethodName: "DeleteSetting", StorageMethodName: "DeleteSetting", Arguments: ["Exact Key"] },
		{ MethodName: "ClearSettings", StorageMethodName: "ClearPlayer", Arguments: [] },
		{ MethodName: "GetAllSettings", StorageMethodName: "GetPlayerValues", Arguments: [] },
	];

	for (const bBlocking of [false, true]) {
		const vecStorageCalls = [];
		const FixtureResult = { Identity: "retained" };
		const Storage = {};
		for (const strMethodName of g_vecRequiredSettingsStorageMethodNames) {
			Storage[strMethodName] = function CompleteObservedRequest(...vecArguments) {
				g_Assert.equal(this, Storage, "all five backend receivers are retained");
				vecStorageCalls.push({ MethodName: strMethodName, Arguments: vecArguments });
				CompleteMockStorageRequest(vecArguments, FixtureResult);
			};
		}

		const Values = g_PlayerAPI.CreatePlayerSettings("Player Requests", Storage);

		for (const Descriptor of vecDescriptors) {
			let LastCallback;
			const Invoke = (Options, Callback) => {
				LastCallback = Callback;

				return Reflect.apply(Values[Descriptor.MethodName], Values, [...Descriptor.Arguments, Options, Callback]);
			};
			const unCallCountBeforeInvalidRequests = vecStorageCalls.length;

			for (const InvalidOptions of [
				undefined,
				null,
				[],
				1,
				{ Blocking: 0 },
			]) {
				g_Assert.throws(() => Invoke(InvalidOptions, () => undefined), TypeError, `${Descriptor.MethodName} rejects malformed options`);
			}

			g_Assert.throws(() => Invoke({}), TypeError, `${Descriptor.MethodName} requires a callback`);
			g_Assert.throws(() => Invoke({}, null), TypeError, `${Descriptor.MethodName} rejects a non-function callback`);
			g_Assert.equal(vecStorageCalls.length, unCallCountBeforeInvalidRequests, "invalid pairs do not reach storage");

			g_Assert.equal(await AwaitRequest(Invoke, { Blocking: bBlocking, IgnoredOption: "not forwarded" }, !bBlocking), FixtureResult, "all five results retain their identity");

			const LastCall = vecStorageCalls[vecStorageCalls.length - 1];
			g_Assert.equal(LastCall.MethodName, Descriptor.StorageMethodName, "correct storage method");
			g_Assert.deepEqual(LastCall.Arguments.slice(0, -2), ["Player Requests", ...Descriptor.Arguments], "identity, exact key and value arguments");
			g_Assert.deepEqual(LastCall.Arguments[LastCall.Arguments.length - 2], { Blocking: bBlocking }, "captured request mode");
			g_Assert.equal(LastCall.Arguments[LastCall.Arguments.length - 1], LastCallback, "callback forwarded without an alias");
		}

		const ExpectedError = new Error("backend request failed");
		Storage.GetSetting = function FailObservedRequest(...vecArguments) {
			const Options = vecArguments[vecArguments.length - 2];
			const Callback = vecArguments[vecArguments.length - 1];
			const CompleteFailure = () => Callback(ExpectedError, null);
			if (Options.Blocking) {
				CompleteFailure();
				return;
			}

			queueMicrotask(CompleteFailure);
		};
		await g_Assert.rejects(AwaitRequest((Options, Callback) => Values.GetSetting("Failure", null, Options, Callback), { Blocking: bBlocking }, !bBlocking), (RequestError) => RequestError === ExpectedError);

		const RealStorage = g_StorageAPI.CreateStorage(bBlocking ? "player-blocking" : "player-deferred");

		try {
			const RealValues = new g_PlayerAPI.PlayerSettingsValues("Exact64 Player", RealStorage);
			g_Assert.equal(await AwaitRequest((Options, Callback) => RealValues.GetSetting("Missing", DefaultValue, Options, Callback), { Blocking: bBlocking }, !bBlocking), DefaultValue, "missing values retain the default object");
			g_Assert.equal(await AwaitRequest((Options, Callback) => RealValues.SetSetting("UnsignedValue", unUnsigned64Maximum, Options, Callback), { Blocking: bBlocking }), true);
			g_Assert.equal(await AwaitRequest((Options, Callback) => RealValues.SetSetting("SignedValue", nSigned64Minimum, Options, Callback), { Blocking: bBlocking }), true);
			g_Assert.equal(await AwaitRequest((Options, Callback) => RealValues.GetSetting("UnsignedValue", null, Options, Callback), { Blocking: bBlocking }), unUnsigned64Maximum);
			g_Assert.equal(await AwaitRequest((Options, Callback) => RealValues.GetSetting("SignedValue", null, Options, Callback), { Blocking: bBlocking }), nSigned64Minimum);

			const LiveValues = await AwaitRequest((Options, Callback) => RealValues.GetAllSettings(Options, Callback), { Blocking: bBlocking });
			g_Assert.equal(LiveValues.UnsignedValue, unUnsigned64Maximum);
			g_Assert.equal(LiveValues.SignedValue, nSigned64Minimum);
			g_Assert.equal(await AwaitRequest((Options, Callback) => RealValues.GetAllSettings(Options, Callback), { Blocking: bBlocking }), LiveValues, "GetAllSettings returns a live record, not a snapshot");

			g_Assert.equal(await AwaitRequest((Options, Callback) => RealValues.DeleteSetting("UnsignedValue", Options, Callback), { Blocking: bBlocking }), true);
			g_Assert.equal(Object.hasOwn(LiveValues, "UnsignedValue"), false, "deletion updates the live record");

			g_Assert.equal(await AwaitRequest((Options, Callback) => RealValues.ClearSettings(Options, Callback), { Blocking: bBlocking }), true);
			g_Assert.deepEqual(Object.keys(await AwaitRequest((Options, Callback) => RealValues.GetAllSettings(Options, Callback), { Blocking: bBlocking })), []);
		} finally {
			const bStorageHadHandle = RealStorage.Handle !== null;
			g_Assert.equal(await AwaitRequest((Options, Callback) => RealStorage.Close(Options, Callback), { Blocking: bBlocking }), bStorageHadHandle, "real storage closes an open handle or reports an already empty state in both modes");
		}

		g_Assert.equal(RealStorage.Handle, null);
	}

	const Storage = {};
	for (const strMethodName of g_vecRequiredSettingsStorageMethodNames) {
		Storage[strMethodName] = (...vecArguments) => CompleteMockStorageRequest(vecArguments, DefaultValue);
	}

	const Values = new g_PlayerAPI.PlayerSettingsValues("Snapshot Player", Storage);
	const MutableOptions = { Blocking: false };
	const Completion = AwaitRequest((Options, Callback) => Values.GetSetting("Missing", DefaultValue, Options, Callback), MutableOptions, true);
	MutableOptions.Blocking = true;
	g_Assert.equal(await Completion, DefaultValue, "a request uses its captured mode, not a later caller mutation");

	const ExpectedCallbackError = new Error("caller callback failed");
	let unCallbackCount = 0;
	g_Assert.throws(() => Values.GetSetting("Callback", null, { Blocking: true }, () => {
		unCallbackCount += 1;
		throw ExpectedCallbackError;
	}), (CallbackError) => CallbackError === ExpectedCallbackError);
	g_Assert.equal(unCallbackCount, 1, "callback exceptions are not retried");

	const ExpectedSchedulingError = new Error("backend scheduling failed");
	Storage.GetSetting = function RejectScheduling() {
		throw ExpectedSchedulingError;
	};
	g_Assert.throws(() => Values.GetSetting("Scheduling", null, {}, () => {
		unCallbackCount += 1;
	}), (SchedulingError) => SchedulingError === ExpectedSchedulingError);
	g_Assert.equal(unCallbackCount, 1, "scheduling failure does not invent a completion");
}

async function VerifyDocumentedPlayerWorkflows() {
	const vecExpectedCalls = [
		"GetSetting",
		"SetSetting",
		"SetSetting",
		"DeleteSetting",
		"GetPlayerValues",
		"ClearPlayer",
		"GetPlayerValues",
	];
	for (const bBlocking of [false, true]) {
		const Storage = new g_DocumentedWorkflows.MemorySettingsStorage();
		const Result = await AwaitRequest((Options, Callback) => g_DocumentedWorkflows.ExercisePlayerSettingsValues(9, Storage, Options, Callback), { Blocking: bBlocking }, !bBlocking);
		g_Assert.deepEqual(ToPlainData(Result), {
			DamageNumbersDeleted: true,
			DamageNumbersStored: true,
			DirectPlayerUniqueID: "STEAM_1:1:9",
			MissingTeamPreference: "auto",
			PlayerUniqueID: "STEAM_1:1:9",
			PlayerValuesAfterClear: {},
			PlayerValuesAfterDelete: { "Preferred Team": "survivor" },
			PlayerValuesCleared: true,
			PreferredTeamStored: true,
		}, "settings/player callback-based values workflow");

		for (const unFailureCallIndex of [1, vecExpectedCalls.length]) {
			const FailingStorage = new g_DocumentedWorkflows.MemorySettingsStorage();
			const ExpectedError = new Error("documented request failed");
			const vecObservedCalls = [];
			for (const strMethodName of g_vecRequiredSettingsStorageMethodNames) {
				const StorageMethod = FailingStorage[strMethodName];
				FailingStorage[strMethodName] = function InjectRequestFailure(...vecArguments) {
					vecObservedCalls.push(strMethodName);

					if (vecObservedCalls.length === unFailureCallIndex) {
						const Callback = vecArguments[vecArguments.length - 1];
						const CompleteFailure = () => Callback(ExpectedError, null);
						if (bBlocking) {
							CompleteFailure();
							return;
						}

						queueMicrotask(CompleteFailure);
						return;
					}

					Reflect.apply(StorageMethod, this, vecArguments);
				};
			}

			let FailureResult;
			await g_Assert.rejects(AwaitRequest((Options, Callback) => g_DocumentedWorkflows.ExercisePlayerSettingsValues(9, FailingStorage, Options, (RequestError, RequestResult) => {
				FailureResult = RequestResult;
				Callback(RequestError, RequestResult);
			}), { Blocking: bBlocking }, !bBlocking), (RequestError) => RequestError === ExpectedError);
			g_Assert.equal(FailureResult, null, "documented failures have no success result");
			g_Assert.deepEqual(vecObservedCalls, vecExpectedCalls.slice(0, unFailureCallIndex), "documented workflow stops on the original error");
		}

		const unNetworkIDCallCountBeforeInvalidRequests = g_vecNetworkIDCalls.length;
		for (const InvalidOptions of [
			undefined,
			null,
			[],
			{ Blocking: "yes" },
		]) {
			g_Assert.throws(() => g_DocumentedWorkflows.ExercisePlayerSettingsValues(9, Storage, InvalidOptions, () => undefined), /Options/);
		}

		g_Assert.throws(() => g_DocumentedWorkflows.ExercisePlayerSettingsValues(9, Storage, {}), /Callback/);
		g_Assert.equal(g_vecNetworkIDCalls.length, unNetworkIDCallCountBeforeInvalidRequests, "invalid documented pairs reject before player lookup");
	}

	const Storage = new g_DocumentedWorkflows.MemorySettingsStorage();
	const ExpectedError = new Error("documented caller callback failed");
	let unCallbackCount = 0;
	g_Assert.throws(() => g_DocumentedWorkflows.ExercisePlayerSettingsValues(9, Storage, { Blocking: true }, () => {
		unCallbackCount += 1;
		throw ExpectedError;
	}), (CallbackError) => CallbackError === ExpectedError);
	g_Assert.equal(unCallbackCount, 1, "documented callback exceptions propagate without retry");
}

async function VerifyDocumentedBackendFailures() {
	const vecFailures = [
		new Error("Backend fixture failure"),
		null,
		undefined,
		0,
		false,
		"Backend failure",
	];
	for (const bBlocking of [false, true]) {
		for (const Failure of vecFailures) {
			const Storage = new g_DocumentedWorkflows.MemorySettingsStorage();
			let unOperationCount = 0;
			let unCallbackCount = 0;
			let unOptionReadCount = 0;
			let bReturned = false;
			const Options = {
				get Blocking() {
					unOptionReadCount += 1;

					return bBlocking;
				},
			};
			const Observation = await new Promise((Resolve) => {
				const DirectResult = Storage.RunRequest(Options, (RequestError, RequestResult) => {
					unCallbackCount += 1;
					Resolve({ RequestError, RequestResult, Returned: bReturned });
				}, () => {
					unOperationCount += 1;
					throw Failure;
				});
				g_Assert.equal(DirectResult, undefined, "model failures retain callback-only return");
				bReturned = true;
			});
			g_Assert.notEqual(Observation.RequestError, null, "operation failure must not become success");
			g_Assert.equal(Observation.RequestResult, null, "model operation failure result");
			g_Assert.equal(Observation.Returned, !bBlocking, "model completion timing");
			g_Assert.equal(unOptionReadCount, 1, "model captures options once");
			g_Assert.equal(unOperationCount, 1, "model does not retry operations");
			g_Assert.equal(unCallbackCount, 1, "model completes once");

			if (Failure === null) {
				g_Assert.equal(Observation.RequestError.name, "Error", "null failure is wrapped");
				g_Assert.equal(Object.hasOwn(Observation.RequestError, "cause"), true, "null failure retains an explicit cause");
				g_Assert.equal(Observation.RequestError.cause, null, "exact null cause");

			} else {
				g_Assert.equal(Observation.RequestError, Failure, "non-null operation failure identity");
			}
		}
	}

	for (const Failure of vecFailures) {
		const Storage = new g_DocumentedWorkflows.MemorySettingsStorage();
		let unCallbackCount = 0;
		let bCaught = false;
		let CaughtFailure = undefined;

		try {
			Storage.RunRequest({ Blocking: true }, () => {
				unCallbackCount += 1;
				throw Failure;
			}, () => true);
		} catch (CallbackFailure) {
			CaughtFailure = CallbackFailure;
			bCaught = true;
		}

		g_Assert.equal(bCaught, true, "inline caller exception propagates");
		g_Assert.equal(CaughtFailure, Failure, "caller failure is not normalized");
		g_Assert.equal(unCallbackCount, 1, "caller exception does not trigger another completion");

		Storage.GetSetting = function CompleteThenThrow(strPlayerUniqueID, strSettingName, DefaultValue, Options, Callback) {
			g_Assert.equal(this, Storage, "facade preserves backend receiver");
			g_Assert.equal(strPlayerUniqueID, "Backend Exceptions", "facade identity");
			g_Assert.equal(strSettingName, "Completion", "facade exact key");
			g_Assert.equal(DefaultValue, null, "facade fallback");
			g_Assert.deepEqual(Options, { Blocking: true }, "facade mode");
			Callback(null, true);
			throw Failure;
		};
		const Values = new g_PlayerAPI.PlayerSettingsValues("Backend Exceptions", Storage);
		unCallbackCount = 0;
		bCaught = false;

		try {
			Values.GetSetting("Completion", null, { Blocking: true }, (RequestError, RequestResult) => {
				unCallbackCount += 1;
				g_Assert.equal(RequestError, null, "original completion remains delivered");
				g_Assert.equal(RequestResult, true, "original completion result");
			});
		} catch (BackendFailure) {
			CaughtFailure = BackendFailure;
			bCaught = true;
		}

		g_Assert.equal(bCaught, true, "post-completion backend exception propagates");
		g_Assert.equal(CaughtFailure, Failure, "post-completion failure identity");
		g_Assert.equal(unCallbackCount, 1, "facade does not invent an error completion");
	}
}

async function RunAsynchronousPlayerChecks() {
	let PrimaryError = null;
	let bHasPrimaryError = false;

	try {
		await VerifyPlayerSettingsRequests();

		await VerifyDocumentedPlayerWorkflows();

		await VerifyDocumentedBackendFailures();

		g_Assert.equal(g_PlayerAPI.REGISTERED_PLAYER_SETTINGS.size, 0, "async checks leave no registered roots");
	} catch (Failure) {
		PrimaryError = Failure;
		bHasPrimaryError = true;
	} finally {
		try {
			ReleaseSettingsPlayerFixture();
		} catch (CleanupFailure) {
			throw new AggregateError(bHasPrimaryError ? [PrimaryError, CleanupFailure] : [CleanupFailure], "Settings/player asynchronous verification cleanup failed.");
		}
	}

	if (bHasPrimaryError) {
		throw PrimaryError;
	}
}

const g_WatchdogTimer = setTimeout(() => {
	console.error("[ERROR] smoke_settings_player callback did not complete");
	process.exit(1);
}, g_unRequestTimeoutMilliseconds);

RunAsynchronousPlayerChecks().then(() => {
	clearTimeout(g_WatchdogTimer);
	console.log("[  OK  ] smoke_settings_player");
}, (CheckError) => {
	clearTimeout(g_WatchdogTimer);
	console.error(CheckError);
	process.exitCode = 1;
});
