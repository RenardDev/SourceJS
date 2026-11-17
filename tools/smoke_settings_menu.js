#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "settings-menu.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strMenusPath = g_Path.join(g_strPackageRootPath, "menus.js");
const g_strSettingsMenuPath = g_Path.join(g_strPackageRootPath, "settings", "menu.js");
const g_strSettingsPlayerPath = g_Path.join(g_strPackageRootPath, "settings", "player.js");
const g_strSettingsTypesPath = g_Path.join(g_strPackageRootPath, "settings", "types.js");
const g_vecExpectedExports = Object.freeze([
	"BuildSettingsMenu",
	"SendSettingsMenu",
	"SettingsMenu",
]);

const g_vecRegisteredPlayerSettings = [];
const g_vecRegisteredSettings = [];
const g_vecSendRecords = [];
const g_mapPlayerUniqueIDs = new Map();
const g_unRequestTimeoutMilliseconds = 5000;
const g_unJavaScriptTimeoutMilliseconds = 1000;

function ExecuteWithDeadline(Action, strOperationName) {
	return g_VM.runInNewContext("Action();", { Action }, { filename: g_strDocumentationPath + ":" + strOperationName, timeout: g_unJavaScriptTimeoutMilliseconds });
}

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

function RequireBoolean(bBooleanValue, strValueName) {
	if (typeof bBooleanValue !== "boolean") {
		throw new TypeError(`${strValueName} must be a boolean.`);
	}

	return bBooleanValue;
}

function RequirePositiveSafeInteger(unIntegerValue, strValueName) {
	if (!Number.isSafeInteger(unIntegerValue) || (unIntegerValue < 1)) {
		throw new TypeError(`${strValueName} must be a positive integer.`);
	}

	return unIntegerValue;
}

class PagedMenuOptionFixture {
	constructor(OptionText = "", OptionValue = null, PagedMenuOptionOptions = {}) {
		const ValidatedPagedMenuOptionOptions = RequireObjectRecord(PagedMenuOptionOptions, "PagedMenuOption options");
		const bOptionSelectable = RequireBoolean(ReadOptionValue(ValidatedPagedMenuOptionOptions, "Selectable", true), "PagedMenuOption Selectable");

		this.Text = OptionText;
		this.Value = OptionValue;
		this.Selectable = bOptionSelectable;
	}

	GetMenuText() {
		return (typeof this.Text === "function") ? ExecuteWithDeadline(() => this.Text(), "GetMenuText") : this.Text;
	}
}

class PagedMenuFixture {
	constructor(PagedMenuOptions = {}) {
		const ValidatedPagedMenuOptions = RequireObjectRecord(PagedMenuOptions, "PagedMenu options");
		const MenuTitle = ReadOptionValue(ValidatedPagedMenuOptions, "Title", "");
		const MenuDescription = ReadOptionValue(ValidatedPagedMenuOptions, "Description", "");
		const unMenuItemsPerPage = RequirePositiveSafeInteger(ReadOptionValue(ValidatedPagedMenuOptions, "ItemsPerPage", 7), "PagedMenu ItemsPerPage");
		const MenuSelectCallback = ReadOptionValue(ValidatedPagedMenuOptions, "SelectCallback", null);
		if ((MenuSelectCallback !== null) && (typeof MenuSelectCallback !== "function")) {
			throw new TypeError("PagedMenu SelectCallback must be a function or null.");
		}

		this.ValueTitle = MenuTitle;
		this.ValueDescription = MenuDescription;
		this.ItemsPerPage = unMenuItemsPerPage;
		this.SelectCallback = MenuSelectCallback;
		this.Items = [];
	}

	AppendMenuItem(MenuItem) {
		this.Items.push(MenuItem);

		return MenuItem;
	}

	ClearMenuItems() {
		this.Items.length = 0;
	}

	SelectMenuOption(unPlayerIndex, unChoiceIndex) {
		const SelectedMenuItem = this.Items[unChoiceIndex - 1];
		if (SelectedMenuItem === undefined) {
			return false;
		}

		const bSelectedMenuItemSelectable = RequireBoolean(SelectedMenuItem.Selectable, "PagedMenuOption Selectable");
		if (!bSelectedMenuItemSelectable) {
			return false;
		}

		const MenuSelectCallback = this.SelectCallback;
		if (MenuSelectCallback !== null) {
			if (typeof MenuSelectCallback !== "function") {
				throw new TypeError("PagedMenu SelectCallback must be a function or null.");
			}

			ExecuteWithDeadline(() => Reflect.apply(MenuSelectCallback, this, [unPlayerIndex, SelectedMenuItem.Value, SelectedMenuItem, this]), "SelectMenuOption");
		}

		return true;
	}

	SendMenu(TargetReference) {
		for (const MenuItem of this.Items) {
			MenuItem.GetMenuText();
		}

		g_vecSendRecords.push({ PagedMenu: this, TargetReference });

		return true;
	}

	get Length() {
		return this.Items.length;
	}
}

class SettingsTypeFixture {
	constructor(strSettingName, DefaultSettingValue = null, SettingOptions = {}) {
		const ValidatedSettingOptions = RequireObjectRecord(SettingOptions, "SettingsType options");
		const strSettingText = ReadOptionValue(ValidatedSettingOptions, "Text", null);
		if ((strSettingText !== null) && (typeof strSettingText !== "string")) {
			throw new TypeError("SettingsType text must be a string or null.");
		}

		this.Name = strSettingName;
		this.DefaultValue = DefaultSettingValue;
		this.Text = strSettingText;
		this.CurrentValue = DefaultSettingValue;
		this.SettingsPlayersRead = [];
		this.RequestOptionsRead = [];
		this.RequestError = null;
	}

	Get(strPlayerUniqueID, Options, Callback) {
		RequireObjectRecord(Options, "SettingsType request options");

		const bBlocking = Options.Blocking;
		if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
			throw new TypeError("SettingsType request Blocking must be a boolean.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("SettingsType requests require a Callback function.");
		}

		this.SettingsPlayersRead.push(strPlayerUniqueID);
		this.RequestOptionsRead.push(Options);

		const RequestError = this.RequestError;
		const SettingsValue = this.CurrentValue;
		const CompleteRequest = () => ExecuteWithDeadline(() => Callback(RequestError, (RequestError === null) ? SettingsValue : null), "CompleteRequest");
		if (bBlocking === true) {
			CompleteRequest();
			return;
		}

		// Microtasks model deferred completion only; they are not native worker threads.
		queueMicrotask(CompleteRequest);
	}
}

class BooleanSettingFixture extends SettingsTypeFixture {
}

class IntegerSettingFixture extends SettingsTypeFixture {
}

class SettingsDictionaryFixture {
	constructor(strSettingsName, strSettingsText = null) {
		const strMenuTitle = (strSettingsText === null) ? strSettingsName : strSettingsText;

		this.Name = strSettingsName;
		this.Text = strSettingsText;
		this.Menu = new PagedMenuFixture({ Title: strMenuTitle });
	}

	Send(TargetReference) {
		return this.Menu.SendMenu(TargetReference);
	}
}

class PlayerSettingsFixture extends SettingsDictionaryFixture {
	constructor(strSettingsName, strSettingsPrefix, strSettingsText = null) {
		for (const RegisteredPlayerSetting of g_vecRegisteredPlayerSettings) {
			if (RegisteredPlayerSetting.Name === strSettingsName) {
				throw new Error(`Given name "${strSettingsName}" is already registered.`);
			}
		}

		super(strSettingsName, strSettingsText);

		this.Prefix = strSettingsPrefix;
		this.Settings = [];

		g_vecRegisteredPlayerSettings.push(this);
	}

	AddBooleanSetting(strSettingName, DefaultSettingValue, SettingOptions = {}) {
		const BooleanSetting = new BooleanSettingFixture(strSettingName, DefaultSettingValue, SettingOptions);
		this.Settings.push(BooleanSetting);

		return BooleanSetting;
	}

	AddIntegerSetting(strSettingName, DefaultSettingValue, SettingOptions = {}) {
		const IntegerSetting = new IntegerSettingFixture(strSettingName, DefaultSettingValue, SettingOptions);
		this.Settings.push(IntegerSetting);

		return IntegerSetting;
	}

	Unregister() {
		const nRegisteredPlayerSettingIndex = g_vecRegisteredPlayerSettings.indexOf(this);
		if (nRegisteredPlayerSettingIndex < 0) {
			return false;
		}

		g_vecRegisteredPlayerSettings.splice(nRegisteredPlayerSettingIndex, 1);

		return true;
	}
}

function ExecuteDocumentationCodeBlock(strJavaScriptSource, unDocumentationBlockIndex, DocumentationModulesByName) {
	const strFileName = g_strDocumentationPath + ":" + unDocumentationBlockIndex;
	const DocumentationModuleRecord = new g_Module(strFileName, module);
	DocumentationModuleRecord.filename = strFileName;
	DocumentationModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
	DocumentationModuleRecord.require = function(strRequestName) {
		g_Assert.ok(Object.hasOwn(DocumentationModulesByName, strRequestName), `settings/menu code block ${unDocumentationBlockIndex} import: ${strRequestName}`);

		return DocumentationModulesByName[strRequestName];
	};
	ExecuteWithDeadline(() => DocumentationModuleRecord._compile(strJavaScriptSource, strFileName), "CompileDocumentationModule");

	return DocumentationModuleRecord.exports;
}

function GetUniqueIDFromPlayer(PlayerReference) {
	if ((typeof PlayerReference === "string") && (PlayerReference.length > 0)) {
		return PlayerReference;
	}

	const unPlayerIndex = ((PlayerReference !== null) && (typeof PlayerReference === "object")) ? PlayerReference.Index : PlayerReference;
	RequirePositiveSafeInteger(unPlayerIndex, "Player index");

	return g_mapPlayerUniqueIDs.get(unPlayerIndex) ?? `Player${unPlayerIndex}`;
}

async function AwaitRequest(Request, Options, bExpectDeferred = false) {
	let bReturned = false;
	let bCompletedBeforeReturn = false;
	let unCompletionCount = 0;
	let DirectResult = null;
	let RequestError = null;
	let RequestResult = null;
	let RequestTimer = null;
	const bBlocking = Options.Blocking === true;
	const Completion = new Promise((Resolve, Reject) => {
		RequestTimer = setTimeout(() => Reject(new Error("settings/menu request did not complete.")), g_unRequestTimeoutMilliseconds);

		try {
			DirectResult = ExecuteWithDeadline(() => Request(Options, (CallbackError, CallbackResult) => {
				unCompletionCount += 1;
				bCompletedBeforeReturn = !bReturned;
				RequestError = CallbackError;
				RequestResult = CallbackResult;
				Resolve();
			}), "SubmitRequest");
			bReturned = true;
		} catch (SchedulingError) {
			Reject(SchedulingError);
		}
	});

	try {
		await Completion;
		g_Assert.equal(DirectResult, undefined, "request must not return a direct result");
		g_Assert.equal(unCompletionCount, 1, "request must complete exactly once");

		if (bBlocking) {
			g_Assert.equal(bCompletedBeforeReturn, true, "Blocking request must complete before returning");
		} else if (bExpectDeferred) {
			g_Assert.equal(bCompletedBeforeReturn, false, "uncached model request must complete after returning");
		}

		if (RequestError !== null) {
			throw RequestError;
		}

		return RequestResult;
	} finally {
		clearTimeout(RequestTimer);
	}
}

function NormalizeDocumentationHeadingAnchor(strDocumentationHeading) {
	return strDocumentationHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function InstallDependencyModule(strDependencyModulePath, DependencyModuleExports) {
	delete require.cache[strDependencyModulePath];
	require.cache[strDependencyModulePath] = { exports: DependencyModuleExports, filename: strDependencyModulePath, id: strDependencyModulePath, loaded: true };
}

function GetPlayerSettings() {
	return g_vecRegisteredPlayerSettings.values();
}

function ListSettings() {
	return g_vecRegisteredSettings;
}

function VerifyContentsAnchors(strDocumentationText) {
	const vecContentsMatch = strDocumentationText.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "settings/menu contents section");

	const vecDocumentedAnchors = [];
	for (const vecContentsAnchorMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecContentsAnchorMatch[1]);
	}

	const vecSectionAnchors = [];
	for (const vecSectionHeadingMatch of strDocumentationText.matchAll(/^## (.+)$/gm)) {
		const strSectionAnchor = NormalizeDocumentationHeadingAnchor(vecSectionHeadingMatch[1]);
		if (strSectionAnchor !== "contents") {
			vecSectionAnchors.push(strSectionAnchor);
		}
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "settings/menu contents anchors");
}

function VerifyDocumentationLinks(strDocumentationText) {
	const strDocumentationWithoutCode = strDocumentationText.replace(/```[\s\S]*?```/g, "");
	for (const vecDocumentationLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strDocumentationTarget = vecDocumentationLinkMatch[1];
		if (strDocumentationTarget.startsWith("#") || /^[a-z]+:/i.test(strDocumentationTarget)) {
			continue;
		}

		const nDocumentationFragmentIndex = strDocumentationTarget.indexOf("#");
		const strLocalDocumentationTarget = (nDocumentationFragmentIndex < 0) ? strDocumentationTarget : strDocumentationTarget.slice(0, nDocumentationFragmentIndex);
		const strDocumentationTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strLocalDocumentationTarget);
		g_Assert.ok(g_FileSystem.existsSync(strDocumentationTargetPath), `settings/menu documentation link must exist: ${strDocumentationTarget}`);
	}
}

const g_mapPackageCacheDescriptors = new Map();
const g_LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_LoaderDescriptor?.value;
let g_bPackageCacheOwned = false;
let g_bLoaderOwned = false;

function RestoreProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned settings/menu fixture property must be removable: " + strKey);
}

function ReleaseSettingsMenuFixture() {
	const vecFailures = [];
	const AttemptRestoration = (Restore) => {
		try {
			Restore();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	};

	// These registries and send records belong only to the Node doubles.
	AttemptRestoration(() => {
		g_vecRegisteredPlayerSettings.length = 0;
	});
	AttemptRestoration(() => {
		g_vecRegisteredSettings.length = 0;
	});
	AttemptRestoration(() => {
		g_vecSendRecords.length = 0;
	});
	AttemptRestoration(() => g_mapPlayerUniqueIDs.clear());

	if (g_bLoaderOwned) {
		AttemptRestoration(() => RestoreProperty(g_Module, "_load", g_LoaderDescriptor));
	}

	if (g_bPackageCacheOwned) {
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
				AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
			AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, Descriptor));
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Settings/menu fixture restoration failed.");
	}

	g_bLoaderOwned = false;
	g_bPackageCacheOwned = false;
}

function LoadSettingsMenuAPI() {
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Settings/menu loader must support exact restoration.");

	for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed settings/menu cache entries must support exact restoration.");
	}

	let SettingsMenuAPI = null;
	const vecFailures = [];

	try {
		g_bPackageCacheOwned = true;

		for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
			RestoreProperty(require.cache, strModulePath, undefined);
		}

		InstallDependencyModule(g_strMenusPath, { PagedMenu: PagedMenuFixture, PagedMenuOption: PagedMenuOptionFixture });
		InstallDependencyModule(g_strSettingsPlayerPath, {
			PlayerSettings: PlayerSettingsFixture,
			SettingsDictionary: SettingsDictionaryFixture,
			GetPlayerSettings,
			GetUniqueIDFromPlayer,
		});
		InstallDependencyModule(g_strSettingsTypesPath, {
			BooleanSetting: BooleanSettingFixture,
			IntegerSetting: IntegerSettingFixture,
			SettingsType: SettingsTypeFixture,
			ListSettings,
		});

		g_bLoaderOwned = true;
		Object.defineProperty(g_Module, "_load", {
			...g_LoaderDescriptor,
			value: function LoadModule(strRequest) {
				if (strRequest === "menus") {
					return require(g_strMenusPath);
				}

				if (strRequest === "settings/player") {
					return require(g_strSettingsPlayerPath);
				}

				if (strRequest === "settings/types") {
					return require(g_strSettingsTypesPath);
				}

				return g_OriginalModuleLoad.apply(this, arguments);
			},
		});
		SettingsMenuAPI = require(g_strSettingsMenuPath);
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	if (g_bLoaderOwned) {
		try {
			RestoreProperty(g_Module, "_load", g_LoaderDescriptor);
			g_bLoaderOwned = false;
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		try {
			ReleaseSettingsMenuFixture();
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}

		if (vecFailures.length === 1) {
			throw vecFailures[0];
		}

		throw new AggregateError(vecFailures, "Settings/menu fixture initialization failed.");
	}

	return SettingsMenuAPI;
}

async function RunOwnedSettingsMenuVerification(Verify) {
	let PrimaryError = null;
	let bHasPrimaryError = false;

	try {
		await Verify();
	} catch (Failure) {
		PrimaryError = Failure;
		bHasPrimaryError = true;
	} finally {
		try {
			ReleaseSettingsMenuFixture();
		} catch (CleanupFailure) {
			throw new AggregateError(bHasPrimaryError ? [PrimaryError, CleanupFailure] : [CleanupFailure], "Settings/menu verification cleanup failed.");
		}
	}

	if (bHasPrimaryError) {
		throw PrimaryError;
	}
}

const g_SettingsMenuAPI = LoadSettingsMenuAPI();

async function VerifyCaughtSettingsMenuFailures() {
	const unPlayerIndex = 17;
	const nFixtureValue = 5;
	const strExpectedPlayerUniqueID = `Player${unPlayerIndex}`;

	const strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const vecCodeBlocks = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	const strExplicitMenuCode = vecCodeBlocks.find((strCode) => strCode.includes("function ShowExplicitSettingsMenu("));
	g_Assert.equal(typeof strExplicitMenuCode, "string");

	const DocumentationWorkflow = ExecuteDocumentationCodeBlock(strExplicitMenuCode, 0, { "settings/menu": g_SettingsMenuAPI });

	for (const bBlocking of [false, true]) {
		for (const ThrownValue of [
			null,
			undefined,
			new Error("operation failed"),
			0,
			false,
			"",
		]) {
			for (const strFailureStage of [
				"SCHEDULING",
				"IDENTITY",
				"SEND",
				"EXAMPLE_SEND",
			]) {
				let bReadCompleted = false;
				const Player = {
					get Index() {
						if ((strFailureStage === "IDENTITY") && bReadCompleted) {
							throw ThrownValue;
						}

						return unPlayerIndex;
					},
				};

				const Setting = new IntegerSettingFixture("FailureProbe", nFixtureValue);
				Setting.Get = function Get(strPlayerUniqueID, Options, Callback) {
					g_Assert.equal(this, Setting, "captured Get retains its setting receiver");
					g_Assert.equal(strPlayerUniqueID, strExpectedPlayerUniqueID);
					g_Assert.deepEqual(Options, { Blocking: bBlocking });

					if (strFailureStage === "SCHEDULING") {
						throw ThrownValue;
					}

					bReadCompleted = true;
					Callback(null, nFixtureValue);
				};

				const Menu = new g_SettingsMenuAPI.SettingsMenu(Player, { Settings: [Setting] });
				const mapPreviousSnapshot = Menu.ValueSettingsValues;
				const Prototype = g_SettingsMenuAPI.SettingsMenu.prototype;
				const PreviousSendDescriptor = Object.getOwnPropertyDescriptor(Prototype, "SendMenu");
				const bSendFailure = (strFailureStage === "SEND") || (strFailureStage === "EXAMPLE_SEND");
				let unCompletionCount = 0;
				let Result;
				let ReceivedFailure;
				let bRejected = false;

				try {
					if (bSendFailure) {
						Object.defineProperty(Prototype, "SendMenu", {
							configurable: true,

							value() {
								throw ThrownValue;
							},

							writable: true,
						});
					}

					await AwaitRequest((Options, CompleteRequest) => {
						const Callback = (RequestError, RequestResult) => {
							unCompletionCount += 1;
							Result = RequestResult;
							CompleteRequest(RequestError, RequestResult);
						};
						if (strFailureStage === "EXAMPLE_SEND") {
							DocumentationWorkflow.ShowExplicitSettingsMenu(Player, [Setting], Options, Callback);
						} else if (bSendFailure) {
							g_SettingsMenuAPI.SendSettingsMenu(Player, { ...Options, Settings: [Setting] }, Callback);
						} else {
							Menu.RefreshValues(Options, Callback);
						}
					}, { Blocking: bBlocking });
				} catch (Failure) {
					bRejected = true;
					ReceivedFailure = Failure;
				} finally {
					if (bSendFailure) {
						if (PreviousSendDescriptor === undefined) {
							delete Prototype.SendMenu;
						} else {
							Object.defineProperty(Prototype, "SendMenu", PreviousSendDescriptor);
						}
					}
				}

				g_Assert.equal(bRejected, true, `${strFailureStage} must not turn a thrown value into success`);
				g_Assert.equal(unCompletionCount, 1);
				g_Assert.equal(Result, null, "failed operations publish no result");

				if (ThrownValue === null) {
					g_Assert.equal(ReceivedFailure.name, "Error");
					g_Assert.equal(Object.hasOwn(ReceivedFailure, "cause"), true);
					g_Assert.equal(ReceivedFailure.cause, null, "null failure survives as the error cause");
				} else {
					g_Assert.equal(ReceivedFailure, ThrownValue, "other thrown values retain their exact identity");
				}

				if (!bSendFailure) {
					g_Assert.equal(Menu.ValueSettingsValues, mapPreviousSnapshot, "failed reads/identity validation preserve the previous snapshot");
				}
			}
		}
	}

	for (const bBlocking of [false, true]) {
		for (const CallerFailure of [
			null,
			undefined,
			new Error("caller failed"),
			0,
			false,
			"",
		]) {
			const Setting = new IntegerSettingFixture("CallerProbe", nFixtureValue);
			Setting.Get = (strPlayerUniqueID, Options, Callback) => {
				g_Assert.equal(strPlayerUniqueID, strExpectedPlayerUniqueID);
				g_Assert.deepEqual(Options, { Blocking: bBlocking });
				Callback(null, nFixtureValue);
			};

			const Menu = new g_SettingsMenuAPI.SettingsMenu({ Index: unPlayerIndex }, { Settings: [Setting] });
			const mapPreviousSnapshot = Menu.ValueSettingsValues;
			let unCompletionCount = 0;
			let bThrown = false;
			let ReceivedFailure;

			try {
				Menu.RefreshValues({ Blocking: bBlocking }, () => {
					unCompletionCount += 1;
					throw CallerFailure;
				});
			} catch (Failure) {
				bThrown = true;
				ReceivedFailure = Failure;
			}

			g_Assert.equal(bThrown, true);
			g_Assert.equal(ReceivedFailure, CallerFailure, "caller exceptions are not normalized as operation failures");
			g_Assert.equal(unCompletionCount, 1, "caller exception is never retried");
			g_Assert.notEqual(Menu.ValueSettingsValues, mapPreviousSnapshot, "callback exception does not roll back an already published successful snapshot");
		}
	}

	const Player = { Index: unPlayerIndex };
	const Setting = new IntegerSettingFixture("TokenProbe", nFixtureValue);
	const vecPendingCallbacks = [];
	Setting.Get = (strPlayerUniqueID, Options, Callback) => {
		g_Assert.equal(strPlayerUniqueID, strExpectedPlayerUniqueID);
		g_Assert.deepEqual(Options, { Blocking: false });
		vecPendingCallbacks.push(Callback);
	};

	const Menu = new g_SettingsMenuAPI.SettingsMenu(Player, { Settings: [Setting] });
	const vecCompletions = [];
	const CompleteRequest = (RequestError, Result) => vecCompletions.push({ RequestError, Result });
	Menu.RefreshValues({}, CompleteRequest);
	const FirstToken = Menu.ValueRefreshToken;
	g_Assert.throws(() => Menu.RefreshValues({ Blocking: null }, () => {}), /Blocking must be a boolean/);
	g_Assert.equal(Menu.ValueRefreshToken, FirstToken, "option preflight failure does not supersede a pending load");

	vecPendingCallbacks[0](null, 7);
	g_Assert.equal(vecCompletions[0].RequestError, null);
	g_Assert.equal(vecCompletions[0].Result, Menu);

	const mapPreviousSnapshot = Menu.ValueSettingsValues;
	Menu.RefreshValues({}, CompleteRequest);
	const SecondToken = Menu.ValueRefreshToken;
	Menu.ValuePlayer = null;
	g_Assert.throws(() => Menu.RefreshValues({}, () => {}), /Player index/);
	g_Assert.notEqual(Menu.ValueRefreshToken, SecondToken, "initial identity failure follows token installation");
	g_Assert.equal(Menu.ValueSettingsValues, mapPreviousSnapshot);

	Menu.ValuePlayer = Player;
	vecPendingCallbacks[1](null, 9);
	g_Assert.equal(vecCompletions.length, 2);
	g_Assert.match(vecCompletions[1].RequestError.message, /changed while values were loading/);
	g_Assert.equal(vecCompletions[1].Result, null);
	g_Assert.equal(Menu.ValueSettingsValues, mapPreviousSnapshot, "superseded completion cannot overwrite the prior snapshot");
}

function VerifyPostCompletionGetThrows() {
	const nFixtureValue = 7;
	const vecThrownValues = [
		new Error("Get threw after entry completion"),
		null,
		undefined,
		0,
		false,
		"",
	];
	for (const bBlocking of [false, true]) {
		for (const bMultipleEntries of [false, true]) {
			for (const ThrownValue of vecThrownValues) {
				const FirstSetting = new IntegerSettingFixture("First", nFixtureValue);
				const SecondSetting = new IntegerSettingFixture("Second", nFixtureValue);
				let unFirstReadCount = 0;
				let unSecondReadCount = 0;
				FirstSetting.Get = function Get(strPlayerUniqueID, Options, Callback) {
					g_Assert.equal(this, FirstSetting, "captured Get keeps its receiver");
					g_Assert.equal(strPlayerUniqueID, "Player17");
					g_Assert.deepEqual(Options, { Blocking: bBlocking });
					unFirstReadCount += 1;
					Callback(null, nFixtureValue);
					throw ThrownValue;
				};

				SecondSetting.Get = () => {
					unSecondReadCount += 1;
				};

				const vecSettings = bMultipleEntries ? [FirstSetting, SecondSetting] : [FirstSetting];
				const Menu = new g_SettingsMenuAPI.SettingsMenu({ Index: 17 }, { Settings: vecSettings });
				const mapPreviousSnapshot = Menu.ValueSettingsValues;
				let unCompletionCount = 0;
				let bThrown = false;
				let ReceivedFailure;

				try {
					Menu.RefreshValues({ Blocking: bBlocking }, (RequestError, Result) => {
						unCompletionCount += 1;
						g_Assert.equal(RequestError, null);
						g_Assert.equal(Result, Menu);
					});
				} catch (Failure) {
					bThrown = true;
					ReceivedFailure = Failure;
				}

				g_Assert.equal(bThrown, true, "Get throwing after inline completion is rethrown synchronously");
				g_Assert.equal(ReceivedFailure, ThrownValue, "post-completion throws retain exact identity,including null/undefined");
				g_Assert.equal(unFirstReadCount, 1);
				g_Assert.equal(unSecondReadCount, 0, "no later read starts after the throw");
				g_Assert.equal(unCompletionCount, bMultipleEntries ? 0 : 1, "unfinished batch has no menu completion;completed menu callback is not retried");

				if (bMultipleEntries) {
					g_Assert.equal(Menu.ValueSettingsValues, mapPreviousSnapshot, "aborted batch preserves its previous snapshot");
					g_Assert.equal(Menu.ValueSettingsValues.size, 0, "aborted batch publishes no partial value");
				} else {
					g_Assert.notEqual(Menu.ValueSettingsValues, mapPreviousSnapshot, "already published snapshot is not rolled back");
					g_Assert.equal(Menu.ValueSettingsValues.get(FirstSetting), nFixtureValue);
				}
			}
		}
	}
}

async function VerifySettingsMenuRequests() {
	VerifyPostCompletionGetThrows();

	await VerifyCaughtSettingsMenuFailures();

	const Player = { Index: 17 };
	const FirstSetting = new IntegerSettingFixture("First", 5);
	const SecondSetting = new IntegerSettingFixture("Second", 8);
	const Menu = new g_SettingsMenuAPI.SettingsMenu(Player, { Settings: [FirstSetting, SecondSetting] });

	for (const InvalidOptions of [
		undefined,
		null,
		[],
		true,
		{ Blocking: "true" },
	]) {
		g_Assert.throws(() => Menu.RefreshValues(InvalidOptions, () => {}), /options must be an object|Blocking must be a boolean/);
		g_Assert.throws(() => g_SettingsMenuAPI.SendSettingsMenu(Player, InvalidOptions, () => {}), /options must be an object|Blocking must be a boolean/);
	}

	g_Assert.throws(() => Menu.RefreshValues({}), /require a Callback/);
	g_Assert.throws(() => g_SettingsMenuAPI.SendSettingsMenu(Player, {}), /require a Callback/);
	g_Assert.equal(FirstSetting.SettingsPlayersRead.length, 0, "invalid requests fail before storage access");

	for (const bBlocking of [false, true]) {
		g_Assert.equal(await AwaitRequest((Options, Callback) => Menu.RefreshValues(Options, Callback), { Blocking: bBlocking }, !bBlocking), Menu);
		g_Assert.equal(Menu.Items[0].GetMenuText(), "First: 5");
		g_Assert.equal(Menu.Items[1].GetMenuText(), "Second: 8");
		g_Assert.notEqual(FirstSetting.RequestOptionsRead.at(-1), SecondSetting.RequestOptionsRead.at(-1), "each entry receives independent request options");
		g_Assert.deepEqual(FirstSetting.RequestOptionsRead.at(-1), { Blocking: bBlocking });
		g_Assert.deepEqual(SecondSetting.SettingsPlayersRead.at(-1), "Player17");

		const mapPreviousValues = Menu.ValueSettingsValues;
		const ReadError = new Error("settings read failed");
		FirstSetting.RequestError = ReadError;
		await g_Assert.rejects(() => AwaitRequest((Options, Callback) => Menu.RefreshValues(Options, Callback), { Blocking: bBlocking }), (ErrorValue) => ErrorValue === ReadError);
		g_Assert.equal(Menu.ValueSettingsValues, mapPreviousValues, "failed reads never publish partial values");

		const unPreviousSendCount = g_vecSendRecords.length;
		await g_Assert.rejects(() => AwaitRequest((Options, Callback) => g_SettingsMenuAPI.SendSettingsMenu(Player, { ...Options, Settings: [FirstSetting] }, Callback), { Blocking: bBlocking }), (ErrorValue) => ErrorValue === ReadError);
		g_Assert.equal(g_vecSendRecords.length, unPreviousSendCount, "failed loading never sends a menu");
		FirstSetting.RequestError = null;
	}

	let unBlockingGetterReadCount = 0;
	const GetterOptions = {
		get Blocking() {
			unBlockingGetterReadCount += 1;

			return false;
		},
	};
	await AwaitRequest((Options, Callback) => Menu.RefreshValues(GetterOptions, Callback), { Blocking: false }, true);
	g_Assert.equal(unBlockingGetterReadCount, 1, "Blocking is captured exactly once");

	const FirstGet = FirstSetting.Get;
	FirstSetting.Get = function Get(strPlayerUniqueID, Options, Callback) {
		Options.Blocking = true;
		Reflect.apply(FirstGet, this, [strPlayerUniqueID, Options, Callback]);
	};

	try {
		await AwaitRequest((Options, Callback) => Menu.RefreshValues(Options, Callback), { Blocking: false }, true);
		g_Assert.equal(SecondSetting.RequestOptionsRead.at(-1).Blocking, false, "one entry cannot alter another entry's request mode");
	} finally {
		FirstSetting.Get = FirstGet;
	}

	const CallerError = new Error("caller callback failed");
	let unCallerCompletionCount = 0;
	g_Assert.throws(() => Menu.RefreshValues({ Blocking: true }, () => {
		unCallerCompletionCount += 1;
		throw CallerError;
	}), (ErrorValue) => ErrorValue === CallerError);
	g_Assert.equal(unCallerCompletionCount, 1, "caller callback exceptions are never retried");

	const mapPreviousValues = Menu.ValueSettingsValues;
	const SchedulingError = new Error("request scheduling failed");
	FirstSetting.Get = () => {
		throw SchedulingError;
	};

	try {
		await g_Assert.rejects(() => AwaitRequest((Options, Callback) => Menu.RefreshValues(Options, Callback), { Blocking: false }), (ErrorValue) => ErrorValue === SchedulingError);
		g_Assert.equal(Menu.ValueSettingsValues, mapPreviousValues, "scheduling failure preserves the previous snapshot");
	} finally {
		FirstSetting.Get = FirstGet;
	}

	const PendingMenu = new g_SettingsMenuAPI.SettingsMenu(Player, { Settings: [FirstSetting] });
	const vecPendingCallbacks = [];
	FirstSetting.Get = (strPlayerUniqueID, Options, Callback) => {
		g_Assert.equal(strPlayerUniqueID, "Player17");
		vecPendingCallbacks.push(Callback);
	};

	try {
		const vecCompletions = [];
		const CompleteRefresh = (RequestError, ResultMenu) => vecCompletions.push({ RequestError, ResultMenu });
		g_Assert.equal(PendingMenu.RefreshValues({}, CompleteRefresh), undefined);
		g_Assert.equal(PendingMenu.RefreshValues({}, CompleteRefresh), undefined);

		vecPendingCallbacks[1](null, 9);
		vecPendingCallbacks[0](null, 4);
		vecPendingCallbacks[1](null, 2);
		g_Assert.equal(vecCompletions.length, 2, "overlapping requests each complete once");
		g_Assert.equal(vecCompletions[0].RequestError, null);
		g_Assert.equal(vecCompletions[0].ResultMenu, PendingMenu);
		g_Assert.match(vecCompletions[1].RequestError.message, /changed while values were loading/);
		g_Assert.equal(vecCompletions[1].ResultMenu, null);
		g_Assert.equal(PendingMenu.Items[0].GetMenuText(), "First: 9", "older and duplicate results cannot overwrite the newest snapshot");

		PendingMenu.RefreshValues({}, CompleteRefresh);
		PendingMenu.RefreshOptions([FirstSetting]);
		vecPendingCallbacks[2](null, 10);
		g_Assert.match(vecCompletions[2].RequestError.message, /changed while values were loading/);
		g_Assert.equal(PendingMenu.ValueSettingsValues.size, 0, "definition refresh invalidates pending values");

		PendingMenu.RefreshValues({}, CompleteRefresh);
		g_mapPlayerUniqueIDs.set(Player.Index, "ReplacementPlayer");
		vecPendingCallbacks[3](null, 11);
		g_Assert.match(vecCompletions[3].RequestError.message, /changed while values were loading/);
		g_Assert.equal(PendingMenu.ValueSettingsValues.size, 0, "player changes invalidate pending values");
		g_Assert.equal(g_mapPlayerUniqueIDs.delete(Player.Index), true, "replacement player identity is removed before the next request");

		PendingMenu.RefreshValues({}, CompleteRefresh);
		vecPendingCallbacks[4](null, 12);
		g_Assert.equal(PendingMenu.Items[0].GetMenuText(), "First: 12");

		g_mapPlayerUniqueIDs.set(Player.Index, "ReplacementPlayer");
		g_Assert.equal(PendingMenu.Items[0].GetMenuText(), "First", "cached values are hidden after a player slot is reused");
	} finally {
		FirstSetting.Get = FirstGet;
		// Failure may occur before identity replacement; final cleanup accepts an absent key.
		g_mapPlayerUniqueIDs.delete(Player.Index);
	}

	const EmptyMenu = new g_SettingsMenuAPI.SettingsMenu(null, { Settings: [] });
	g_Assert.equal(await AwaitRequest((Options, Callback) => EmptyMenu.RefreshValues(Options, Callback), { Blocking: true }), EmptyMenu, "empty menus require no player lookup");

	const InvalidMenu = new g_SettingsMenuAPI.SettingsMenu(Player, { Settings: [] });
	InvalidMenu.Items = [null];
	g_Assert.throws(() => InvalidMenu.RefreshValues({}, () => {}), /Items\[0\] must be an object/);

	await g_Assert.rejects(() => AwaitRequest((Options, Callback) => {
		Callback(null, true);

		return true;
	}, { Blocking: true }), /direct result/, "request assertions are not swallowed by a settled Promise");

	await g_Assert.rejects(() => AwaitRequest((Options, Callback) => {
		Callback(null, true);
		Callback(null, true);
	}, { Blocking: true }), /exactly once/);
}

async function VerifySettingsMenu() {
	const unMissingRuntimeTimeoutMilliseconds = 5000;

	const strDocumentationText = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const vecDocumentationCodeBlocks = [];
	for (const vecDocumentationCodeBlockMatch of strDocumentationText.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		vecDocumentationCodeBlocks.push(vecDocumentationCodeBlockMatch[1]);
	}

	g_Assert.equal(vecDocumentationCodeBlocks.length, 5, "settings/menu JavaScript block count");
	g_Assert.ok(strDocumentationText.includes("throws after invoking its entry callback inline"), "document post-completion Get throws instead of promising a final callback for every failure");

	const vecSettingsMenuImportMatch = vecDocumentationCodeBlocks[0].match(/const\s*{([\s\S]*?)}\s*=\s*require\("settings\/menu"\);/);
	g_Assert.ok(vecSettingsMenuImportMatch, "settings/menu exact import example");

	const vecDocumentedSettingsMenuExportNames = vecSettingsMenuImportMatch[1].split(",").map((strImportEntry) => strImportEntry.split(":", 1)[0].trim()).filter(Boolean);
	vecDocumentedSettingsMenuExportNames.sort();

	const vecActualSettingsMenuExportNames = Object.keys(g_SettingsMenuAPI);
	vecActualSettingsMenuExportNames.sort();

	g_Assert.deepEqual(vecActualSettingsMenuExportNames, g_vecExpectedExports, "exact settings/menu exports");
	g_Assert.deepEqual(vecDocumentedSettingsMenuExportNames, g_vecExpectedExports, "exact documented settings/menu exports");
	g_Assert.doesNotMatch(strDocumentationText, /Generated by|\bconsole\.|(?:const|let|var)\s+\w+\s*=\s*require\("settings\/menu"\)/, "settings/menu documentation must remain hand-written and use direct imports");
	g_Assert.doesNotMatch(strDocumentationText, /[^\x00-\x7F]/, "settings/menu documentation ASCII");
	g_Assert.doesNotMatch(strDocumentationText, /[ \t]+$/m, "settings/menu documentation trailing whitespace");

	for (const strDocumentationCodeBlock of vecDocumentationCodeBlocks) {
		g_Assert.doesNotMatch(strDocumentationCodeBlock, /^ +\S/m, "settings/menu JavaScript fence indentation must use tabs");
	}

	VerifyContentsAnchors(strDocumentationText);
	VerifyDocumentationLinks(strDocumentationText);

	const DocumentationModulesByName = { "settings/menu": g_SettingsMenuAPI, "settings/player": { PlayerSettings: PlayerSettingsFixture } };
	const DocumentationWorkflows = Object.create(null);
	let unDocumentationBlockIndex = 1;
	for (const strDocumentationCodeBlock of vecDocumentationCodeBlocks) {
		const DocumentationCodeBlockExports = ExecuteDocumentationCodeBlock(strDocumentationCodeBlock, unDocumentationBlockIndex, DocumentationModulesByName);
		for (const strDocumentationWorkflowName of Object.keys(DocumentationCodeBlockExports)) {
			g_Assert.equal(Object.hasOwn(DocumentationWorkflows, strDocumentationWorkflowName), false, `duplicate workflow: ${strDocumentationWorkflowName}`);
			DocumentationWorkflows[strDocumentationWorkflowName] = DocumentationCodeBlockExports[strDocumentationWorkflowName];
		}

		unDocumentationBlockIndex += 1;
	}

	g_Assert.equal(g_vecSendRecords.length, 0, "settings/menu code blocks must not send menus while loading");
	g_Assert.equal(g_vecRegisteredPlayerSettings.length, 0, "settings/menu code blocks must not register groups while loading");

	const vecDocumentedSettingsMenuWorkflowNames = Object.keys(DocumentationWorkflows);
	vecDocumentedSettingsMenuWorkflowNames.sort();
	g_Assert.deepEqual(vecDocumentedSettingsMenuWorkflowNames, [
		"BuildAuditedSettingsMenu",
		"CreateInterfaceSettingsController",
		"ReplaceSettingsRows",
		"ShowExplicitSettingsMenu",
	], "settings/menu documented workflows");

	const SettingsPlayer = { Index: 3 };
	const VolumeSetting = new IntegerSettingFixture("Volume", 80);
	let ExplicitSettingsMenu = null;
	for (const bBlocking of [false, true]) {
		ExplicitSettingsMenu = await AwaitRequest((Options, Callback) => DocumentationWorkflows.ShowExplicitSettingsMenu(SettingsPlayer, [VolumeSetting], Options, Callback), { Blocking: bBlocking }, !bBlocking);
	}

	g_Assert.ok(ExplicitSettingsMenu instanceof g_SettingsMenuAPI.SettingsMenu, "explicit workflow SettingsMenu");
	g_Assert.ok(ExplicitSettingsMenu instanceof PagedMenuFixture, "SettingsMenu extends PagedMenu");
	g_Assert.equal(ExplicitSettingsMenu.Player, SettingsPlayer, "SettingsMenu retains exact player value");
	g_Assert.equal(ExplicitSettingsMenu.ValueTitle, "Combat Preferences", "explicit menu title");
	g_Assert.equal(ExplicitSettingsMenu.ValueDescription, "Current values for this player", "explicit menu description");
	g_Assert.equal(ExplicitSettingsMenu.Items.length, 1, "explicit menu row");
	g_Assert.equal(ExplicitSettingsMenu.Items[0].GetMenuText(), "Volume: 80", "standalone row loaded text");
	g_Assert.deepEqual(VolumeSetting.SettingsPlayersRead, ["Player3", "Player3"], "standalone loads resolve the retained player identity");

	VolumeSetting.CurrentValue = 65;

	g_Assert.equal(ExplicitSettingsMenu.Items[0].GetMenuText(), "Volume: 80", "standalone row retains the loaded snapshot");
	g_Assert.equal(VolumeSetting.SettingsPlayersRead.length, 2, "rendering does not reread storage");
	g_Assert.equal(await AwaitRequest((Options, Callback) => ExplicitSettingsMenu.RefreshValues(Options, Callback), { Blocking: false }, true), ExplicitSettingsMenu, "RefreshValues retains menu identity");
	g_Assert.equal(ExplicitSettingsMenu.Items[0].GetMenuText(), "Volume: 65", "explicit refresh publishes the new snapshot");

	const ExplicitSettingsMenuSendRecord = g_vecSendRecords[g_vecSendRecords.length - 1];
	g_Assert.equal(ExplicitSettingsMenuSendRecord.PagedMenu, ExplicitSettingsMenu, "explicit workflow sends retained menu");
	g_Assert.equal(ExplicitSettingsMenuSendRecord.TargetReference, SettingsPlayer, "explicit workflow send target");

	const vecAuditedSettingsMenuSelections = [];
	const AuditedSettingsMenu = ExecuteWithDeadline(() => DocumentationWorkflows.BuildAuditedSettingsMenu(
		SettingsPlayer,
		[VolumeSetting],
		(SettingsMenuSelection) => {
			vecAuditedSettingsMenuSelections.push(SettingsMenuSelection);
		},
	), "BuildAuditedSettingsMenu");

	g_Assert.equal(g_vecSendRecords.length, 2, "build workflow leaves menu unsent");
	g_Assert.equal(AuditedSettingsMenu.Items[0].GetMenuText(), "Volume", "unloaded rows render names without storage I/O");
	g_Assert.equal(VolumeSetting.SettingsPlayersRead.length, 3, "building and rendering metadata do not read storage");
	g_Assert.equal(AuditedSettingsMenu.SelectMenuOption(SettingsPlayer.Index, 1), true, "audited menu selection");
	g_Assert.equal(vecAuditedSettingsMenuSelections.length, 1, "audited callback count");
	g_Assert.equal(vecAuditedSettingsMenuSelections[0].PlayerIndex, SettingsPlayer.Index, "audited callback player index");
	g_Assert.equal(vecAuditedSettingsMenuSelections[0].SettingsEntry, VolumeSetting, "audited callback setting entry");
	g_Assert.equal(vecAuditedSettingsMenuSelections[0].MenuItem, AuditedSettingsMenu.Items[0], "audited callback menu item");
	g_Assert.equal(vecAuditedSettingsMenuSelections[0].SettingsMenu, AuditedSettingsMenu, "audited callback settings menu");

	const InterfaceSettingsController = ExecuteWithDeadline(() => DocumentationWorkflows.CreateInterfaceSettingsController(), "CreateInterfaceSettingsController");
	g_Assert.equal(g_vecRegisteredPlayerSettings.length, 0, "controller creation does not register settings");

	const RegisteredInterfaceSettings = ExecuteWithDeadline(() => InterfaceSettingsController.Load(), "LoadSettingsController");
	g_Assert.equal(RegisteredInterfaceSettings.Settings.length, 2, "controller group setting count");

	for (const bBlocking of [false, true]) {
		g_Assert.equal(await AwaitRequest((Options, Callback) => InterfaceSettingsController.Show(SettingsPlayer, Options, Callback), { Blocking: bBlocking }), true, "controller sends registered settings");
	}

	const RegisteredSettingsMenuSendRecord = g_vecSendRecords[g_vecSendRecords.length - 1];
	const RegisteredSettingsMenu = RegisteredSettingsMenuSendRecord.PagedMenu;
	g_Assert.ok(RegisteredSettingsMenu instanceof g_SettingsMenuAPI.SettingsMenu, "registered workflow generated SettingsMenu");
	g_Assert.equal(RegisteredSettingsMenu.Items.length, 1, "registered menu group-first row count");
	g_Assert.equal(RegisteredSettingsMenu.Items[0].Value, RegisteredInterfaceSettings, "registered menu group-first row");
	g_Assert.equal(ExecuteWithDeadline(() => InterfaceSettingsController.Unload(), "UnloadSettingsController"), true, "controller unload unregisters settings");
	g_Assert.equal(ExecuteWithDeadline(() => InterfaceSettingsController.Unload(), "UnloadSettingsController"), false, "controller unload is idempotent");
	g_Assert.equal(g_vecRegisteredPlayerSettings.length, 0, "controller restores group registry");

	const AutoReadySetting = new BooleanSettingFixture("Auto Ready", true);
	const SettingsRowReplacement = ExecuteWithDeadline(() => DocumentationWorkflows.ReplaceSettingsRows(ExplicitSettingsMenu, [AutoReadySetting]), "ReplaceSettingsRows");
	g_Assert.equal(SettingsRowReplacement.Menu, ExplicitSettingsMenu, "ReplaceSettingsRows preserves menu identity");
	g_Assert.equal(SettingsRowReplacement.RowCount, 1, "ReplaceSettingsRows row count");
	g_Assert.equal(ExplicitSettingsMenu.Items[0].Value, AutoReadySetting, "ReplaceSettingsRows replaces row value");
	g_Assert.equal(ExplicitSettingsMenu.ValueSettingsValues.size, 0, "replacing rows clears the loaded snapshot");

	const NestedPlayerSettings = new PlayerSettingsFixture("Combat", "combat", "Combat Settings");

	g_vecRegisteredSettings.push(VolumeSetting);

	const RegistrySettingsMenu = new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer);
	g_Assert.equal(RegistrySettingsMenu.Items.length, 2, "default registry row count");
	g_Assert.equal(RegistrySettingsMenu.Items[0].Value, NestedPlayerSettings, "default registry group row");
	g_Assert.equal(RegistrySettingsMenu.Items[1].Value, VolumeSetting, "default registry standalone row");
	g_Assert.equal(RegistrySettingsMenu.Items[0].GetMenuText(), "Combat Settings", "group row display text");
	g_Assert.equal(RegistrySettingsMenu.SelectMenuOption(SettingsPlayer.Index, 1), true, "default group selection");

	const NestedSettingsMenuSendRecord = g_vecSendRecords[g_vecSendRecords.length - 1];
	g_Assert.equal(NestedSettingsMenuSendRecord.PagedMenu, NestedPlayerSettings.Menu, "default selection opens nested menu");
	g_Assert.equal(NestedSettingsMenuSendRecord.TargetReference, SettingsPlayer.Index, "nested menu target index");

	const LaterBooleanSetting = new BooleanSettingFixture("Later Setting", false);
	g_vecRegisteredSettings.push(LaterBooleanSetting);

	g_Assert.equal(RegistrySettingsMenu.Items.length, 2, "existing menu retains rows before RefreshOptions");
	g_Assert.equal(RegistrySettingsMenu.RefreshOptions(), RegistrySettingsMenu, "argument-free RefreshOptions identity");
	g_Assert.equal(RegistrySettingsMenu.Items.length, 3, "argument-free RefreshOptions row count");
	g_Assert.equal(RegistrySettingsMenu.Items[0].Value, NestedPlayerSettings, "argument-free RefreshOptions group row");
	g_Assert.equal(RegistrySettingsMenu.Items[1].Value, VolumeSetting, "argument-free RefreshOptions first standalone row");
	g_Assert.equal(RegistrySettingsMenu.Items[2].Value, LaterBooleanSetting, "argument-free RefreshOptions second standalone row");

	const vecRegistrySettingsMenuItemsBeforeInvalidRefresh = RegistrySettingsMenu.Items;
	const NestedSettingsMenuItemBeforeInvalidRefresh = vecRegistrySettingsMenuItemsBeforeInvalidRefresh[0];
	const VolumeSettingMenuItemBeforeInvalidRefresh = vecRegistrySettingsMenuItemsBeforeInvalidRefresh[1];
	const LaterBooleanSettingMenuItemBeforeInvalidRefresh = vecRegistrySettingsMenuItemsBeforeInvalidRefresh[2];

	g_Assert.throws(() => RegistrySettingsMenu.RefreshOptions([VolumeSetting, { Name: "Malformed" }]), /SettingsDictionary or SettingsType/, "RefreshOptions rejects malformed rows");
	g_Assert.equal(RegistrySettingsMenu.Items, vecRegistrySettingsMenuItemsBeforeInvalidRefresh, "failed RefreshOptions preserves row array");
	g_Assert.equal(RegistrySettingsMenu.Items[0], NestedSettingsMenuItemBeforeInvalidRefresh, "failed RefreshOptions preserves group row");
	g_Assert.equal(RegistrySettingsMenu.Items[1], VolumeSettingMenuItemBeforeInvalidRefresh, "failed RefreshOptions preserves first row");
	g_Assert.equal(RegistrySettingsMenu.Items[2], LaterBooleanSettingMenuItemBeforeInvalidRefresh, "failed RefreshOptions preserves second row");
	g_Assert.throws(() => new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, { Settings: null }), /SettingsMenu Settings must be an array/, "constructor null settings rejection");
	g_Assert.throws(() => new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, { Settings: [{ Name: "Malformed" }] }), /SettingsDictionary or SettingsType/, "constructor malformed standalone rejection");
	g_Assert.throws(() => new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, { Settings: [{ Menu: {}, Name: "Group-like" }] }), /SettingsDictionary or SettingsType/, "constructor group-like object rejection");
	g_Assert.throws(() => new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, { SelectCallback: null }), /SelectCallback must be a function/, "constructor null callback rejection");
	g_Assert.throws(() => RegistrySettingsMenu.RefreshOptions(null), /SettingsMenu Settings must be an array/, "RefreshOptions null rejection");

	const MalformedNestedSettingsDictionary = new SettingsDictionaryFixture("Malformed Group");
	MalformedNestedSettingsDictionary.Menu = {};
	const MalformedNestedSettingsMenu = new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, { Settings: [MalformedNestedSettingsDictionary] });
	g_Assert.equal(MalformedNestedSettingsMenu.Items[0].GetMenuText(), "Malformed Group", "settings dictionary row text");
	g_Assert.throws(() => MalformedNestedSettingsMenu.SelectMenuOption(SettingsPlayer.Index, 1), /Menu\.SendMenu must be a function/, "malformed nested menu rejection");

	const RejectedNestedSettingsDictionary = new SettingsDictionaryFixture("Rejected Group");
	RejectedNestedSettingsDictionary.Menu.SendMenu = () => false;
	const RejectedNestedSettingsMenu = new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, { Settings: [RejectedNestedSettingsDictionary] });
	g_Assert.throws(() => RejectedNestedSettingsMenu.SelectMenuOption(SettingsPlayer.Index, 1), /did not accept the nested menu/, "rejected nested menu result");

	let unSettingsOptionGetterReadCount = 0;
	const GetterBackedSettingsMenuOptions = {};
	Object.defineProperty(GetterBackedSettingsMenuOptions, "Settings", {
		get() {
			unSettingsOptionGetterReadCount += 1;

			return [VolumeSetting];
		},
	});

	const GetterBackedSettingsMenu = ExecuteWithDeadline(() => new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, GetterBackedSettingsMenuOptions), "ConstructSettingsMenu");
	g_Assert.equal(unSettingsOptionGetterReadCount, 1, "constructor reads settings option once");
	g_Assert.equal(GetterBackedSettingsMenu.Items[0].Value, VolumeSetting, "constructor retains one-read settings entry");
	g_Assert.throws(() => new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, null), /options must be an object/, "constructor null rejection");
	g_Assert.throws(() => new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, []), /options must be an object/, "constructor array rejection");
	g_Assert.throws(() => new g_SettingsMenuAPI.SettingsMenu(SettingsPlayer, { ItemsPerPage: 0 }), /positive integer/, "constructor page-size rejection");
	g_Assert.throws(() => ExecuteWithDeadline(() => DocumentationWorkflows.ShowExplicitSettingsMenu(SettingsPlayer, []), "RejectEmptyExplicitSettings"), /At least one explicit setting/, "explicit workflow empty rejection");

	g_Assert.equal(NestedPlayerSettings.Unregister(), true, "nested settings cleanup");
	g_vecRegisteredSettings.length = 0;

	g_Assert.equal(g_vecRegisteredSettings.length, 0, "settings/menu final standalone registry");
	g_Assert.equal(g_vecRegisteredPlayerSettings.length, 0, "settings/menu final group registry");

	const MissingNativeRuntimeProcess = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strSettingsMenuPath)});`], { env: { ...process.env, NODE_PATH: g_strPackageRootPath }, encoding: "utf8", timeout: unMissingRuntimeTimeoutMilliseconds });
	g_Assert.equal(MissingNativeRuntimeProcess.error, undefined, "settings/menu missing-runtime child must start and terminate normally");
	g_Assert.equal(MissingNativeRuntimeProcess.status, 1, "settings/menu missing-runtime child exit code");
	g_Assert.notEqual(MissingNativeRuntimeProcess.status, 0, "settings/menu requires the native runtime");
	g_Assert.match(MissingNativeRuntimeProcess.stderr, /SourceJS native runtime is not installed/, "settings/menu missing-runtime error");

	await VerifySettingsMenuRequests();
}

RunOwnedSettingsMenuVerification(VerifySettingsMenu).then(() => {
	console.log("[  OK  ] smoke_settings_menu");
}, (ErrorValue) => {
	console.error(ErrorValue);
	process.exitCode = 1;
});
