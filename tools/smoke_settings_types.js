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
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "settings-types.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strSettingsStoragePath = g_Path.join(g_strPackageRootPath, "settings", "storage.js");
const g_strSettingsTypesPath = g_Path.join(g_strPackageRootPath, "settings", "types.js");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_unDocumentationCompilationTimeoutMilliseconds = 1000;
const g_vecNetworkIDCalls = [];
const g_SOCIMock = CreateSettingsSOCIMock();

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

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned settings/types fixture property must be removable: " + strKey);
}

function ReleaseSettingsTypesFixture() {
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
		throw new AggregateError(vecFailures, "Settings/types fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseSettingsTypesFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Settings/types runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Settings/types loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed settings/types cache entries must support exact restoration.");
}

// Exit cleanup also covers early synchronous assertion failures.
process.once("exit", ReleaseSettingsTypesFixture);
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

g_bSourceJSOwned = true;
Object.defineProperty(globalThis, "sourcejs", {
	configurable: true,
	enumerable: true,
	writable: true,
	value: {
		players: {
			GetNetworkID(PlayerReference) {
				const unPlayerIndex = (typeof PlayerReference === "number") ? PlayerReference : PlayerReference.Index;
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

		soci: g_SOCIMock,
	},
});

g_bLoaderOwned = true;
Object.defineProperty(g_Module, "_load", {
	...g_LoaderDescriptor,
	value: function LoadSourceJSModule(strRequest, Parent, bIsMain) {
		if (strRequest === "internal/runtime") {
			return g_OriginalModuleLoad(g_strInternalRuntimePath, Parent, bIsMain);
		}

		if (strRequest === "settings/storage") {
			return g_OriginalModuleLoad(g_strSettingsStoragePath, Parent, bIsMain);
		}

		return g_OriginalModuleLoad(strRequest, Parent, bIsMain);
	},
});

let g_StorageAPI = null;
let g_TypesAPI = null;

try {
	g_StorageAPI = require(g_strSettingsStoragePath);
	g_TypesAPI = require(g_strSettingsTypesPath);
} finally {
	RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
	g_bLoaderOwned = false;
}

function ExecuteDocumentationCodeBlock(strJavaScriptSource, unCodeBlockIndex) {
	const strDocumentationBlockPath = `${g_strDocumentationPath}:block-${unCodeBlockIndex}.js`;
	const ModuleRecord = new g_Module(strDocumentationBlockPath, module);
	ModuleRecord.filename = strDocumentationBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));

	ModuleRecord.require = function RequireDocumentationModule(strModuleIdentifier) {
		g_Assert.equal(strModuleIdentifier, "settings/types", `settings/types code block ${unCodeBlockIndex} import`);

		return g_TypesAPI;
	};

	g_VM.runInNewContext("Compile();", {
		Compile() {
			ModuleRecord._compile(strJavaScriptSource, strDocumentationBlockPath);
		},
	}, { filename: strDocumentationBlockPath, timeout: g_unDocumentationCompilationTimeoutMilliseconds });

	return ModuleRecord.exports;
}

function NormalizeHeadingAnchor(strDocumentationHeading) {
	return strDocumentationHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ToPlainValue(CandidateValue) {
	if (Array.isArray(CandidateValue)) {
		const vecPlainValues = [];
		for (const ArrayValue of CandidateValue) {
			vecPlainValues.push(ToPlainValue(ArrayValue));
		}

		return vecPlainValues;
	}

	if (CandidateValue && (typeof CandidateValue === "object")) {
		const PlainRecord = {};
		for (const [strPropertyName, PropertyValue] of Object.entries(CandidateValue)) {
			Object.defineProperty(PlainRecord, strPropertyName, { configurable: true, enumerable: true, value: ToPlainValue(PropertyValue), writable: true });
		}

		return PlainRecord;
	}

	return CandidateValue;
}

function VerifyContentsAnchors(strDocumentationMarkdown) {
	const vecContentsMatch = strDocumentationMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "settings/types contents section");

	const vecDocumentedAnchors = [];
	const vecSectionAnchors = [];

	for (const vecAnchorMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecAnchorMatch[1]);
	}

	for (const vecSectionMatch of strDocumentationMarkdown.matchAll(/^## (.+)$/gm)) {
		const strSectionAnchor = NormalizeHeadingAnchor(vecSectionMatch[1]);
		if (strSectionAnchor !== "contents") {
			vecSectionAnchors.push(strSectionAnchor);
		}
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "settings/types contents anchors");
}

function VerifyDocumentationLinks(strDocumentationMarkdown) {
	const strDocumentationWithoutCode = strDocumentationMarkdown.replace(/```[\s\S]*?```/g, "");
	const vecDocumentationLinks = [];
	for (const vecLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		vecDocumentationLinks.push(vecLinkMatch[1]);
	}

	for (const strDocumentationLink of vecDocumentationLinks) {
		if (strDocumentationLink.startsWith("#") || /^[a-z]+:/i.test(strDocumentationLink)) {
			continue;
		}

		const strDocumentationRelativePath = strDocumentationLink.split("#", 1)[0];
		const strDocumentationTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strDocumentationRelativePath);
		g_Assert.ok(g_FileSystem.existsSync(strDocumentationTargetPath), `settings/types documentation link must exist: ${strDocumentationLink}`);
	}
}

// Boundary scenarios explicitly choose Blocking; production defaults stay deferred.
function RunBlockingRequest(Target, strMethodName, vecArguments = []) {
	let unCompletionCount = 0;
	let RequestError = null;
	let Result = null;
	const DirectResult = Target[strMethodName](...vecArguments, { Blocking: true }, (CompletionError, CompletionResult) => {
		unCompletionCount += 1;
		g_Assert.equal(unCompletionCount, 1, `${strMethodName} completes exactly once`);
		RequestError = CompletionError;
		Result = CompletionResult;
	});
	g_Assert.equal(DirectResult, undefined, `${strMethodName} returns no result directly`);
	g_Assert.equal(unCompletionCount, 1, `${strMethodName} completes before Blocking returns`);

	if (RequestError !== null) {
		throw RequestError;
	}

	return Result;
}

function RunMockRequest(Operation, Options, Callback) {
	g_Assert.equal((Options !== null) && (typeof Options === "object") && !Array.isArray(Options), true, "mock request options");
	const bBlocking = Options.Blocking;
	g_Assert.equal((bBlocking === undefined) || (typeof bBlocking === "boolean"), true, "mock Blocking option");
	g_Assert.equal(typeof Callback, "function", "mock completion callback");

	const CompleteRequest = () => {
		let RequestError = null;
		let Result = null;

		try {
			Result = Operation();
		} catch (OperationError) {
			RequestError = (OperationError === null) ? new Error("Settings-type fixture operation failed.", { cause: OperationError }) : OperationError;
		}

		Callback(RequestError, Result);
	};

	if (bBlocking === true) {
		CompleteRequest();

	} else {
		queueMicrotask(CompleteRequest);
	}
}

g_Assert.deepEqual(Object.keys(g_TypesAPI).sort(), [
	"BooleanSetting",
	"ChoiceSetting",
	"FloatSetting",
	"GetSetting",
	"IntegerSetting",
	"ListSettings",
	"REGISTERED_SETTINGS",
	"RegisterSetting",
	"SettingsType",
	"StringSetting",
	"UnregisterSetting",
], "exact settings/types exports");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_TypesAPI.SettingsType.prototype).sort(), [
	"Coerce",
	"ConVar",
	"DefaultValue",
	"Delete",
	"Description",
	"Get",
	"GetDefaultValue",
	"IsValid",
	"Name",
	"Prefix",
	"Set",
	"Storage",
	"Text",
	"Validator",
	"constructor",
].sort(), "SettingsType members");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_TypesAPI.StringSetting.prototype).sort(), [
	"AddOption",
	"Choices",
	"Coerce",
	"IsValid",
	"Options",
	"RemoveOption",
	"constructor",
].sort(), "StringSetting own members");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_TypesAPI.IntegerSetting.prototype).sort(), [
	"Coerce",
	"constructor",
	"IsValid",
	"Maximum",
	"Minimum",
].sort(), "IntegerSetting own members");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_TypesAPI.FloatSetting.prototype).sort(), [
	"Coerce",
	"constructor",
	"IsValid",
	"Maximum",
	"Minimum",
].sort(), "FloatSetting own members");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_TypesAPI.BooleanSetting.prototype).sort(), ["Coerce", "constructor"], "BooleanSetting own members");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_TypesAPI.ChoiceSetting.prototype), ["constructor"], "ChoiceSetting own members");

g_Assert.ok(g_TypesAPI.StringSetting.prototype instanceof g_TypesAPI.SettingsType, "StringSetting inheritance");
g_Assert.ok(g_TypesAPI.IntegerSetting.prototype instanceof g_TypesAPI.SettingsType, "IntegerSetting inheritance");
g_Assert.ok(g_TypesAPI.FloatSetting.prototype instanceof g_TypesAPI.SettingsType, "FloatSetting inheritance");
g_Assert.ok(g_TypesAPI.BooleanSetting.prototype instanceof g_TypesAPI.SettingsType, "BooleanSetting inheritance");
g_Assert.ok(g_TypesAPI.ChoiceSetting.prototype instanceof g_TypesAPI.StringSetting, "ChoiceSetting inheritance");

const g_IndexedPlayerReference = { Index: 42 };
const g_ViewScaleSetting = new g_TypesAPI.IntegerSetting("View Scale", 5, { Description: "Integer setting", Maximum: 10, Minimum: 1, Prefix: "SJS", Text: "View Scale" });
g_Assert.equal(g_ViewScaleSetting.Name, "View Scale", "setting name");
g_Assert.equal(g_ViewScaleSetting.DefaultValue, 5, "default value");
g_Assert.equal(g_ViewScaleSetting.Text, "View Scale", "display text");
g_Assert.equal(g_ViewScaleSetting.Description, "Integer setting", "description");
g_Assert.equal(g_ViewScaleSetting.Prefix, "SJS", "prefix");
g_Assert.equal(g_ViewScaleSetting.Storage, g_StorageAPI.DEFAULT_STORAGE, "default storage");
g_Assert.equal(g_ViewScaleSetting.Validator, null, "default validator");
g_Assert.equal(g_ViewScaleSetting.Minimum, 1, "integer minimum");
g_Assert.equal(g_ViewScaleSetting.Maximum, 10, "integer maximum");
g_Assert.equal(g_ViewScaleSetting.ConVar, "SJSViewScale", "ConVar uses current prefix and PascalCase name");
g_Assert.equal(g_ViewScaleSetting.GetDefaultValue(), 5, "GetDefaultValue coerces the current default");
g_Assert.throws(() => g_ViewScaleSetting.Get(g_IndexedPlayerReference), TypeError, "Get requires options and callback");
g_Assert.throws(() => g_ViewScaleSetting.Set(g_IndexedPlayerReference, 7), TypeError, "Set requires options and callback");
g_Assert.throws(() => g_ViewScaleSetting.Delete(g_IndexedPlayerReference), TypeError, "Delete requires options and callback");
g_Assert.throws(() => g_ViewScaleSetting.Get(g_IndexedPlayerReference, {}), TypeError, "Get requires callback with options");
g_Assert.throws(() => g_ViewScaleSetting.Set(g_IndexedPlayerReference, 7, {}), TypeError, "Set requires callback with options");
g_Assert.throws(() => g_ViewScaleSetting.Delete(g_IndexedPlayerReference, {}), TypeError, "Delete requires callback with options");

for (const Options of [null, [], { Blocking: 1 }]) {
	g_Assert.throws(() => g_ViewScaleSetting.Get(g_IndexedPlayerReference, Options, () => {}), TypeError, "Get rejects malformed options before player lookup");
	g_Assert.throws(() => g_ViewScaleSetting.Set(g_IndexedPlayerReference, 7, Options, () => {}), TypeError, "Set rejects malformed options before player lookup");
	g_Assert.throws(() => g_ViewScaleSetting.Delete(g_IndexedPlayerReference, Options, () => {}), TypeError, "Delete rejects malformed options before player lookup");
}

g_Assert.equal(RunBlockingRequest(g_ViewScaleSetting, "Get", [g_IndexedPlayerReference]), 5, "Get returns the default through callback");
g_Assert.equal(RunBlockingRequest(g_ViewScaleSetting, "Set", [g_IndexedPlayerReference, 7]), true, "Set stores an integer");
g_Assert.equal(RunBlockingRequest(g_ViewScaleSetting, "Get", [g_IndexedPlayerReference]), 7, "Get reads the stored integer");
g_Assert.equal(g_ViewScaleSetting.Coerce(8), 8, "integer Coerce");
g_Assert.equal(g_ViewScaleSetting.IsValid(1), true, "minimum is inclusive");
g_Assert.equal(g_ViewScaleSetting.IsValid(10), true, "maximum is inclusive");
g_Assert.equal(g_ViewScaleSetting.IsValid(11), false, "above maximum is invalid");
g_Assert.equal(RunBlockingRequest(g_ViewScaleSetting, "Delete", [g_IndexedPlayerReference]), true, "Delete removes the stored value");
g_Assert.deepEqual(g_vecNetworkIDCalls, [42, 42, 42, 42], "indexed player references resolve on every storage operation");

g_ViewScaleSetting.Prefix = "Changed";
g_Assert.equal(g_ViewScaleSetting.ConVar, "ChangedViewScale", "ConVar observes live prefix edits");

g_ViewScaleSetting.ValueDefaultValue = 6;
g_Assert.equal(g_ViewScaleSetting.GetDefaultValue(), 6, "default reads are live");

const g_EnabledSetting = new g_TypesAPI.BooleanSetting("Enabled", true, { Prefix: "SJS" });
g_Assert.equal(g_EnabledSetting.Coerce(false), false, "BooleanSetting accepts booleans");
g_Assert.equal(g_EnabledSetting.IsValid(true), true, "BooleanSetting validates booleans");
g_Assert.throws(() => g_EnabledSetting.Coerce("true"), TypeError, "BooleanSetting rejects strings");

const g_SensitivitySetting = new g_TypesAPI.FloatSetting("Sensitivity", 1.25, { Maximum: 2, Minimum: 0.5 });
g_Assert.equal(g_SensitivitySetting.Coerce(1.5), 1.5, "FloatSetting accepts finite numbers");
g_Assert.equal(g_SensitivitySetting.IsValid(0.5), true, "float minimum is inclusive");
g_Assert.equal(g_SensitivitySetting.IsValid(2), true, "float maximum is inclusive");
g_Assert.equal(g_SensitivitySetting.IsValid(2.1), false, "float maximum is enforced");
g_Assert.throws(() => g_SensitivitySetting.Coerce(Number.NaN), TypeError, "FloatSetting rejects NaN");

const g_ColorSetting = new g_TypesAPI.StringSetting("Color", "red", { Choices: ["red", "green"], Prefix: "SJS" });
g_Assert.deepEqual(g_ColorSetting.Choices, ["red", "green"], "string choices preserve insertion order");
g_Assert.equal(g_ColorSetting.Options.get("red").Text, "red", "choice default text");

const g_BlueColorOption = g_ColorSetting.AddOption("blue", "Blue");
g_Assert.deepEqual(g_BlueColorOption, { Name: "blue", Text: "Blue", Value: "blue" }, "AddOption record");
g_Assert.equal(g_ColorSetting.IsValid("green"), true, "configured choices are valid");
g_Assert.equal(g_ColorSetting.IsValid("orange"), false, "missing choices are invalid");
g_Assert.equal(g_ColorSetting.RemoveOption("green"), true, "RemoveOption removes choices");
g_Assert.throws(() => g_ColorSetting.AddOption("red"), Error, "duplicate options are rejected");
g_Assert.throws(() => g_ColorSetting.RemoveOption("green"), Error, "missing options are rejected");

const g_ThemeSetting = new g_TypesAPI.ChoiceSetting("Theme", "dark", { Choices: ["dark", "light"] });
g_Assert.deepEqual(g_ThemeSetting.Choices, ["dark", "light"], "ChoiceSetting choices");
g_Assert.equal(g_ThemeSetting.IsValid("light"), true, "ChoiceSetting validates configured choices");

const g_ValidatedRetryCountSetting = new g_TypesAPI.SettingsType("Retry Count", 0, { Validator: (nRetryCount) => Number.isSafeInteger(nRetryCount) && (nRetryCount >= 0) });
g_Assert.equal(g_ValidatedRetryCountSetting.Coerce(3), 3, "base Coerce returns the exact value");
g_Assert.equal(g_ValidatedRetryCountSetting.IsValid(3), true, "base validator accepts valid values");
g_Assert.equal(g_ValidatedRetryCountSetting.IsValid(-1), false, "base validator rejects invalid values");

const g_mapFallbackSettingsValues = new Map();
const g_CreateFallbackSettingsKey = (strPlayerUniqueID, strSettingToken) => JSON.stringify([strPlayerUniqueID, strSettingToken]);
const g_FallbackSettingsStorage = {
	DeleteSetting(strPlayerUniqueID, strSettingToken, Options, Callback) {
		RunMockRequest(() => g_mapFallbackSettingsValues.delete(g_CreateFallbackSettingsKey(strPlayerUniqueID, strSettingToken)), Options, Callback);
	},

	GetSetting(strPlayerUniqueID, strSettingToken, DefaultSettingsValue, Options, Callback) {
		const strSettingsKey = g_CreateFallbackSettingsKey(strPlayerUniqueID, strSettingToken);
		RunMockRequest(() => g_mapFallbackSettingsValues.has(strSettingsKey) ? g_mapFallbackSettingsValues.get(strSettingsKey) : DefaultSettingsValue, Options, Callback);
	},

	SetSetting(strPlayerUniqueID, strSettingToken, SettingsValue, Options, Callback) {
		RunMockRequest(() => {
			g_mapFallbackSettingsValues.set(g_CreateFallbackSettingsKey(strPlayerUniqueID, strSettingToken), SettingsValue);

			return true;
		}, Options, Callback);
	},
};
const g_BoundedIntegerSetting = new g_TypesAPI.IntegerSetting("Bounded", 5, { Maximum: 10, Minimum: 1, Storage: g_FallbackSettingsStorage });

g_mapFallbackSettingsValues.set(g_CreateFallbackSettingsKey("STEAM_1:1:10", "Bounded"), 11);

g_Assert.equal(RunBlockingRequest(g_BoundedIntegerSetting, "Get", ["STEAM_1:1:10"]), 5, "semantically invalid stored values use the default");

g_mapFallbackSettingsValues.set(g_CreateFallbackSettingsKey("STEAM_1:1:10", "Bounded"), "bad");

g_Assert.throws(() => RunBlockingRequest(g_BoundedIntegerSetting, "Get", ["STEAM_1:1:10"]), TypeError, "stored values of the wrong type complete with error");
g_Assert.throws(() => RunBlockingRequest(g_BoundedIntegerSetting, "Set", ["STEAM_1:1:10", 11]), TypeError, "invalid writes throw before scheduling");

const g_CallbackError = new Error("settings completion failed");
let g_unCallbackCount = 0;
g_Assert.throws(() => g_BoundedIntegerSetting.Get("STEAM_1:1:10", { Blocking: true }, (RequestError, Result) => {
	g_Assert.ok(RequestError instanceof TypeError, "stored-value coercion error reaches callback");
	g_Assert.equal(Result, null, "failed coercion has no value");
	g_unCallbackCount += 1;
	throw g_CallbackError;
}), (RequestError) => RequestError === g_CallbackError, "callback errors are not recaught as validation errors");
g_Assert.equal(g_unCallbackCount, 1, "validation failure callback runs exactly once");

const g_CreateSettingWithMissingStorageMethods = () => new g_TypesAPI.SettingsType("Bad Storage", null, { Storage: {} });
const g_CreateSettingWithArrayStorage = () => new g_TypesAPI.SettingsType("Bad Array Storage", null, { Storage: [] });
const g_CreateSettingWithRejectedDefault = () => new g_TypesAPI.SettingsType("Bad Validator", 1, { Validator: () => false });
const g_CreateIntegerSettingWithInvalidName = () => new g_TypesAPI.IntegerSetting("Bad1", 0);
const g_CreateIntegerSettingWithStringDefault = () => new g_TypesAPI.IntegerSetting("Bad Default", "5");
const g_CreateIntegerSettingWithFractionalDefault = () => new g_TypesAPI.IntegerSetting("Bad Float Default", 5.5);
const g_CreateIntegerSettingWithOutOfBoundsDefault = () => new g_TypesAPI.IntegerSetting("Bad Integer Bounds", 11, { Maximum: 10, Minimum: 1 });
const g_CreateIntegerSettingWithInvertedBounds = () => new g_TypesAPI.IntegerSetting("Inverted Integer Bounds", 5, { Maximum: 1, Minimum: 10 });
const g_CreateFloatSettingWithStringDefault = () => new g_TypesAPI.FloatSetting("Bad Float", "1.5");
const g_CreateFloatSettingWithOutOfBoundsDefault = () => new g_TypesAPI.FloatSetting("Bad Float Bounds", 2.5, { Maximum: 2, Minimum: 1 });
const g_CreateBooleanSettingWithStringDefault = () => new g_TypesAPI.BooleanSetting("Bad Boolean", "true");
const g_CreateStringSettingWithNumericDefault = () => new g_TypesAPI.StringSetting("Bad String", 5);
const g_CreateStringSettingWithMissingDefaultChoice = () => new g_TypesAPI.StringSetting("Bad String Choice", "red", { Choices: ["blue"] });
const g_CreateChoiceSettingWithoutChoices = () => new g_TypesAPI.ChoiceSetting("Empty Choice", "one", { Choices: [] });
const g_CreateChoiceSettingWithMissingDefaultChoice = () => new g_TypesAPI.ChoiceSetting("Bad Choice", "one", { Choices: ["two"] });

g_Assert.throws(g_CreateSettingWithMissingStorageMethods, TypeError, "custom storage requires all methods");
g_Assert.throws(g_CreateSettingWithArrayStorage, TypeError, "storage arrays are rejected");
g_Assert.throws(g_CreateSettingWithRejectedDefault, TypeError, "validators must accept defaults");
g_Assert.throws(g_CreateIntegerSettingWithInvalidName, TypeError, "invalid setting names are rejected");
g_Assert.throws(g_CreateIntegerSettingWithStringDefault, TypeError, "integer defaults must be numbers");
g_Assert.throws(g_CreateIntegerSettingWithFractionalDefault, TypeError, "integer defaults must be integers");
g_Assert.throws(g_CreateIntegerSettingWithOutOfBoundsDefault, RangeError, "integer defaults must satisfy bounds");
g_Assert.throws(g_CreateIntegerSettingWithInvertedBounds, RangeError, "integer bounds must be ordered");
g_Assert.throws(g_CreateFloatSettingWithStringDefault, TypeError, "float defaults must be numbers");
g_Assert.throws(g_CreateFloatSettingWithOutOfBoundsDefault, RangeError, "float defaults must satisfy bounds");
g_Assert.throws(g_CreateBooleanSettingWithStringDefault, TypeError, "boolean defaults must be booleans");
g_Assert.throws(g_CreateStringSettingWithNumericDefault, TypeError, "string defaults must be strings");
g_Assert.throws(g_CreateStringSettingWithMissingDefaultChoice, TypeError, "string defaults must satisfy choices");
g_Assert.throws(g_CreateChoiceSettingWithoutChoices, TypeError, "ChoiceSetting requires choices");
g_Assert.throws(g_CreateChoiceSettingWithMissingDefaultChoice, TypeError, "ChoiceSetting defaults must satisfy choices");

g_Assert.equal(g_TypesAPI.RegisterSetting(g_ViewScaleSetting), g_ViewScaleSetting, "RegisterSetting returns the setting");
g_Assert.equal(g_TypesAPI.REGISTERED_SETTINGS.get("View Scale"), g_ViewScaleSetting, "registry is live");
g_Assert.equal(g_TypesAPI.GetSetting("View Scale"), g_ViewScaleSetting, "GetSetting returns a registered setting");
g_Assert.equal(g_TypesAPI.GetSetting("Missing"), null, "GetSetting returns null for missing settings");
g_Assert.notEqual(g_TypesAPI.ListSettings(), g_TypesAPI.ListSettings(), "ListSettings returns fresh arrays");
g_Assert.deepEqual(g_TypesAPI.ListSettings(), [g_ViewScaleSetting], "ListSettings contents");
g_Assert.throws(() => g_TypesAPI.RegisterSetting(g_ViewScaleSetting), Error, "duplicate registrations are rejected");
g_Assert.throws(() => g_TypesAPI.RegisterSetting({}), TypeError, "RegisterSetting requires SettingsType");
g_Assert.equal(g_TypesAPI.UnregisterSetting("View Scale"), true, "UnregisterSetting removes the setting");
g_Assert.equal(g_TypesAPI.UnregisterSetting("View Scale"), false, "UnregisterSetting reports missing settings");
g_Assert.equal("ValueError" in g_TypesAPI, false, "Python ValueError is absent");
g_Assert.equal("BoolSetting" in g_TypesAPI, false, "BoolSetting alias is absent");
g_Assert.equal("convar" in g_ViewScaleSetting, false, "convar alias is absent");
g_Assert.equal("toJSON" in g_ViewScaleSetting, false, "snapshot serializer is absent");

g_Assert.equal(RunBlockingRequest(g_StorageAPI.DEFAULT_STORAGE, "ClearSettings"), true, "direct settings storage ClearSettings");
g_Assert.equal(RunBlockingRequest(g_StorageAPI.DEFAULT_STORAGE, "Close"), true, "direct settings storage Close");
g_Assert.equal(g_StorageAPI.DEFAULT_STORAGE.Handle, null, "default storage is closed before documentation load");

const g_strDocumentationMarkdown = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecJavaScriptCodeBlocks = [];
for (const vecCodeBlockMatch of g_strDocumentationMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecJavaScriptCodeBlocks.push(vecCodeBlockMatch[1]);
}

g_Assert.ok(g_vecJavaScriptCodeBlocks.length > 0, "settings/types JavaScript examples");

const g_vecSettingsTypesImportMatch = g_vecJavaScriptCodeBlocks[0].match(/const\s*{([\s\S]*?)}\s*=\s*require\("settings\/types"\);/);
g_Assert.ok(g_vecSettingsTypesImportMatch, "settings/types exact import example");

const g_vecDocumentedExports = [];
for (const strDocumentedExportText of g_vecSettingsTypesImportMatch[1].split(",")) {
	const strDocumentedExportName = strDocumentedExportText.split(":", 1)[0].trim();
	if (strDocumentedExportName.length > 0) {
		g_vecDocumentedExports.push(strDocumentedExportName);
	}
}

g_vecDocumentedExports.sort();

const g_ForbiddenDocumentationPattern = /Generated by|\bconsole\.|(?:const|let|var)\s+\w+\s*=\s*require\("settings\/types"\)/;
const g_vecRuntimeExports = Object.keys(g_TypesAPI).sort();
g_Assert.deepEqual(g_vecDocumentedExports, g_vecRuntimeExports, "exact documented settings/types exports");
g_Assert.equal(g_vecJavaScriptCodeBlocks.length, 6, "settings/types JavaScript block count");
g_Assert.doesNotMatch(g_strDocumentationMarkdown, g_ForbiddenDocumentationPattern, "documentation remains hand-written with direct imports");
g_Assert.doesNotMatch(g_strDocumentationMarkdown, /[^\x00-\x7F]/, "settings/types documentation ASCII");
g_Assert.doesNotMatch(g_strDocumentationMarkdown, /[ \t]+$/m, "settings/types documentation trailing whitespace");

for (const strJavaScriptSource of g_vecJavaScriptCodeBlocks) {
	g_Assert.doesNotMatch(strJavaScriptSource, /^ +\S/m, "settings/types JavaScript fence indentation must use tabs");
}

VerifyContentsAnchors(g_strDocumentationMarkdown);
VerifyDocumentationLinks(g_strDocumentationMarkdown);

const g_DocumentedWorkflows = {};
const g_unNetworkCallCountBeforeDocumentation = g_vecNetworkIDCalls.length;
const g_unRegistrySizeBeforeDocumentation = g_TypesAPI.REGISTERED_SETTINGS.size;

for (const [unCodeBlockOffset, strJavaScriptSource] of g_vecJavaScriptCodeBlocks.entries()) {
	const unCodeBlockIndex = unCodeBlockOffset + 1;
	Object.assign(g_DocumentedWorkflows, ExecuteDocumentationCodeBlock(strJavaScriptSource, unCodeBlockIndex));
}

const g_unNetworkCallCountAfterDocumentation = g_vecNetworkIDCalls.length;
const g_unRegistrySizeAfterDocumentation = g_TypesAPI.REGISTERED_SETTINGS.size;
g_Assert.equal(g_unNetworkCallCountAfterDocumentation, g_unNetworkCallCountBeforeDocumentation, "code blocks leave player resolution idle");
g_Assert.equal(g_unRegistrySizeAfterDocumentation, g_unRegistrySizeBeforeDocumentation, "code blocks leave registry unchanged");
g_Assert.equal(g_StorageAPI.DEFAULT_STORAGE.Handle, null, "settings/types code blocks must not open default storage while loading");
g_Assert.deepEqual(Object.keys(g_DocumentedWorkflows).sort(), [
	"AddChatColor",
	"ClearCombatSettings",
	"ClearInterfaceSettings",
	"CreateCombatSettings",
	"CreateInterfaceSettings",
	"CreateMemorySettingsStorage",
	"CreateRetrySetting",
	"InspectInterfaceChoices",
	"InspectRetrySetting",
	"RegisterRoundLimit",
	"RemoveChatColor",
	"ResetRetryCount",
	"UpdateCombatSettings",
	"UpdateInterfaceSettings",
	"UpdateRetryCount",
], "settings/types documented workflows");

const g_MemorySettingsStorage = g_DocumentedWorkflows.CreateMemorySettingsStorage();
const g_RetrySetting = g_DocumentedWorkflows.CreateRetrySetting(g_MemorySettingsStorage);
const g_RetrySettingInspection = g_DocumentedWorkflows.InspectRetrySetting(g_RetrySetting);
const g_UpdateWithInvalidRetryCount = () => RunBlockingRequest(g_DocumentedWorkflows, "UpdateRetryCount", [g_RetrySetting, "STEAM_1:1:50", -1]);

g_Assert.ok(g_RetrySetting instanceof g_TypesAPI.SettingsType, "documented base setting type");
g_Assert.equal(g_RetrySettingInspection.CoercedRetryCount, 2, "documented base coercion");
g_Assert.equal(g_RetrySettingInspection.ConVar, "MatchRetryCount", "documented base ConVar");
g_Assert.equal(g_RetrySettingInspection.DefaultRetryCount, 0, "documented base default");
g_Assert.equal(g_RetrySettingInspection.Description, "Number of retries used in the current match", "documented base description");
g_Assert.equal(g_RetrySettingInspection.HasValidator, true, "documented base validator");
g_Assert.equal(g_RetrySettingInspection.Name, "Retry Count", "documented base name");
g_Assert.equal(g_RetrySettingInspection.Prefix, "Match", "documented base prefix");
g_Assert.equal(g_RetrySettingInspection.RetryCountIsValid, true, "documented base validation");
g_Assert.equal(g_RetrySettingInspection.Storage, g_MemorySettingsStorage, "documented base storage");
g_Assert.equal(g_RetrySettingInspection.Text, "Retry count", "documented base text");

g_Assert.deepEqual(ToPlainValue(RunBlockingRequest(g_DocumentedWorkflows, "UpdateRetryCount", [g_RetrySetting, "STEAM_1:1:50", 3])), { CurrentRetryCount: 3, PreviousRetryCount: 0, RetryCountWasStored: true }, "documented base update");
g_Assert.throws(g_UpdateWithInvalidRetryCount, /non-negative safe integer/, "documented base validation error");
g_Assert.equal(RunBlockingRequest(g_DocumentedWorkflows, "ResetRetryCount", [g_RetrySetting, "STEAM_1:1:50"]), true, "documented base cleanup");

g_RetrySetting.Prefix = "Round";
g_Assert.equal(g_DocumentedWorkflows.InspectRetrySetting(g_RetrySetting).ConVar, "RoundRetryCount", "documented live prefix");

const g_CombatSettings = g_DocumentedWorkflows.CreateCombatSettings(g_MemorySettingsStorage);
g_Assert.ok(g_CombatSettings.DamageNumbers instanceof g_TypesAPI.BooleanSetting, "documented boolean setting");
g_Assert.ok(g_CombatSettings.HUDScale instanceof g_TypesAPI.FloatSetting, "documented float setting");
g_Assert.ok(g_CombatSettings.HitSoundVolume instanceof g_TypesAPI.IntegerSetting, "documented integer setting");

g_Assert.throws(() => RunBlockingRequest(g_DocumentedWorkflows, "UpdateCombatSettings", [g_CombatSettings, 7, { DamageNumbersEnabled: true, HUDScale: 1, HitSoundVolume: 101 }]), /outside their configured bounds/, "documented numeric bounds");

g_Assert.deepEqual(ToPlainValue(RunBlockingRequest(g_DocumentedWorkflows, "UpdateCombatSettings", [g_CombatSettings, 7, { DamageNumbersEnabled: false, HUDScale: 1.25, HitSoundVolume: 75 }])), {
	DamageNumbersEnabled: false,
	HitSoundVolume: 75,
	HUDScale: 1.25,
	SettingWriteResults: { DamageNumbersWasStored: true, HitSoundVolumeWasStored: true, HUDScaleWasStored: true },
}, "documented typed update");

g_Assert.deepEqual(ToPlainValue(RunBlockingRequest(g_DocumentedWorkflows, "ClearCombatSettings", [g_CombatSettings, 7])), { DamageNumbersWasDeleted: true, HitSoundVolumeWasDeleted: true, HUDScaleWasDeleted: true }, "documented typed cleanup");

const g_InterfacePlayerReference = { Index: 8 };
const g_InterfaceSettings = g_DocumentedWorkflows.CreateInterfaceSettings(g_MemorySettingsStorage);
g_Assert.ok(g_InterfaceSettings.ChatColor instanceof g_TypesAPI.StringSetting, "documented string setting");
g_Assert.ok(g_InterfaceSettings.MenuTheme instanceof g_TypesAPI.ChoiceSetting, "documented choice setting");
g_Assert.deepEqual(ToPlainValue(g_DocumentedWorkflows.InspectInterfaceChoices(g_InterfaceSettings)), {
	ChatColorChoices: ["green", "blue"],
	ChatColorOptions: [
		{ Name: "green", Text: "green", Value: "green" },
		{ Name: "blue", Text: "blue", Value: "blue" },
	],
	MenuThemeChoices: ["dark", "light"],
}, "documented initial string choices");
g_Assert.deepEqual(ToPlainValue(g_DocumentedWorkflows.AddChatColor(g_InterfaceSettings, "red", "Red")), { Name: "red", Text: "Red", Value: "red" }, "documented AddChatColor");
g_Assert.equal(g_DocumentedWorkflows.RemoveChatColor(g_InterfaceSettings, "blue"), true, "documented RemoveChatColor");

g_Assert.throws(() => RunBlockingRequest(g_DocumentedWorkflows, "UpdateInterfaceSettings", [g_InterfaceSettings, g_InterfacePlayerReference, { ChatColor: "orange", MenuTheme: "dark" }]), /not one of the configured choices/, "documented choice validation");

g_Assert.deepEqual(ToPlainValue(RunBlockingRequest(g_DocumentedWorkflows, "UpdateInterfaceSettings", [g_InterfaceSettings, g_InterfacePlayerReference, { ChatColor: "red", MenuTheme: "light" }])), {
	ChatColor: "red",
	MenuTheme: "light",
	SettingWriteResults: { ChatColorWasStored: true, MenuThemeWasStored: true },
}, "documented choice update");

g_Assert.deepEqual(ToPlainValue(RunBlockingRequest(g_DocumentedWorkflows, "ClearInterfaceSettings", [g_InterfaceSettings, g_InterfacePlayerReference])), { ChatColorWasDeleted: true, MenuThemeWasDeleted: true }, "documented choice cleanup");

const g_RoundLimitRegistration = g_DocumentedWorkflows.RegisterRoundLimit(g_MemorySettingsStorage, "Documentation Round Limit");
const g_RoundLimitRegistryInspection = g_RoundLimitRegistration.InspectRegistration();
const g_RoundLimitSetting = g_RoundLimitRegistration.RoundLimitSetting;
g_Assert.ok(g_RoundLimitSetting instanceof g_TypesAPI.IntegerSetting, "documented registered setting type");
g_Assert.equal(g_RoundLimitRegistryInspection.DirectRegisteredSetting, g_RoundLimitSetting, "documented live registry map");
g_Assert.equal(g_RoundLimitRegistryInspection.LookedUpSetting, g_RoundLimitSetting, "documented registry lookup");
g_Assert.equal(g_RoundLimitRegistryInspection.RoundLimitIsListed, true, "documented registry list");
g_Assert.equal(g_RoundLimitRegistryInspection.SettingsListsAreDistinct, true, "documented fresh registry arrays");

g_RoundLimitSetting.Name = "Renamed Round Limit";
g_Assert.equal(g_RoundLimitRegistration.InspectRegistration().LookedUpSetting, g_RoundLimitSetting, "documented registry lookup retains the original key");

g_Assert.equal(g_RoundLimitRegistration.UnregisterRoundLimit(), true, "documented registry cleanup");
g_Assert.equal(g_RoundLimitRegistration.UnregisterRoundLimit(), false, "documented repeated registry cleanup");
g_Assert.equal(g_TypesAPI.REGISTERED_SETTINGS.size, 0, "documentation leaves the registry empty");
g_Assert.equal(g_MemorySettingsStorage.MapSettingsValues.size, 0, "documentation leaves custom storage empty");
g_Assert.equal(g_StorageAPI.DEFAULT_STORAGE.Handle, null, "documentation leaves default storage closed");

const g_unCompletionTimeoutMilliseconds = 5000;
const g_MissingNativeRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strSettingsTypesPath)});`], { encoding: "utf8", env: { ...process.env, NODE_PATH: g_strPackageRootPath }, timeout: g_unCompletionTimeoutMilliseconds });
g_Assert.equal(g_MissingNativeRuntimeResult.error, undefined, "missing-runtime probe launches successfully");
g_Assert.equal(g_MissingNativeRuntimeResult.status, 1, "missing-runtime probe reports the expected Node failure status");
g_Assert.notEqual(g_MissingNativeRuntimeResult.status, 0, "settings/types requires the native runtime");
g_Assert.match(g_MissingNativeRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

async function VerifySettingsCompletionForwarding() {
	const vecCompletionErrors = [
		null,
		new Error("Forwarded backend failure"),
		undefined,
		0,
		false,
		"",
		Symbol("Forwarded backend failure"),
	];
	const vecBackendResults = [undefined, null, { Retained: true }];
	let unScenarioCount = 0;
	for (const bBlocking of [false, true]) {
		for (const strMethodName of ["Get", "Set", "Delete"]) {
			for (const CompletionError of vecCompletionErrors) {
				for (const BackendResult of vecBackendResults) {
					const CallerOptions = { Blocking: bBlocking, Ignored: true };
					const CallbackReceiver = {};
					const ExtraArgument = Symbol("Backend completion metadata");
					let CallerCallback = null;
					const CompleteBackend = (strPlayerUniqueID, strSettingToken, Options, Callback) => {
						g_Assert.equal(strPlayerUniqueID, "ForwardingPlayer", "forwarded player identity");
						g_Assert.equal(strSettingToken, "MatchForwardingValue", "forwarded setting key");
						g_Assert.notEqual(Options, CallerOptions, "request options are captured separately");
						g_Assert.deepEqual(Options, { Blocking: bBlocking }, "only normalized request mode is forwarded");
						g_Assert.equal(Callback === CallerCallback, strMethodName !== "Get", "only reads wrap the original callback");

						const CompleteRequest = () => Reflect.apply(Callback, CallbackReceiver, [CompletionError, BackendResult, ExtraArgument]);
						if (bBlocking) {
							CompleteRequest();

						} else {
							queueMicrotask(CompleteRequest);
						}
					};
					const Storage = {
						GetSetting(strPlayerUniqueID, strSettingToken, DefaultValue, Options, Callback) {
							g_Assert.equal(this, Storage, "read backend receiver");
							g_Assert.equal(typeof DefaultValue, "symbol", "read retains the missing-value sentinel");
							CompleteBackend(strPlayerUniqueID, strSettingToken, Options, Callback);
						},

						SetSetting(strPlayerUniqueID, strSettingToken, SettingsValue, Options, Callback) {
							g_Assert.equal(this, Storage, "write backend receiver");
							g_Assert.equal(SettingsValue, 7, "write value");
							CompleteBackend(strPlayerUniqueID, strSettingToken, Options, Callback);
						},

						DeleteSetting(strPlayerUniqueID, strSettingToken, Options, Callback) {
							g_Assert.equal(this, Storage, "delete backend receiver");
							CompleteBackend(strPlayerUniqueID, strSettingToken, Options, Callback);
						},
					};
					const Setting = new g_TypesAPI.SettingsType("Forwarding Value", 0, { Prefix: "Match", Storage });
					let bReturned = false;
					let unCallbackCount = 0;
					const Observation = await new Promise((Resolve) => {
						CallerCallback = function ObserveCompletion(...vecArguments) {
							unCallbackCount += 1;
							Resolve({ CallbackReceiver: this, Arguments: vecArguments, Returned: bReturned });
						};

						const vecArguments = (strMethodName === "Set") ? ["ForwardingPlayer", 7] : ["ForwardingPlayer"];
						const DirectResult = Setting[strMethodName](...vecArguments, CallerOptions, CallerCallback);
						g_Assert.equal(DirectResult, undefined, "all setting requests return undefined directly");
						bReturned = true;
					});

					const bReadFailure = (strMethodName === "Get") && (CompletionError !== null);
					g_Assert.equal(Observation.Arguments[0], CompletionError, "completion error identity is retained");
					g_Assert.equal(Observation.Arguments[1], bReadFailure ? null : BackendResult, "only failed reads replace backend results with null");
					g_Assert.equal(Observation.Arguments.length, (strMethodName === "Get") ? 2 : 3, "writes and deletes preserve all callback arguments");
					g_Assert.equal(Observation.CallbackReceiver, (strMethodName === "Get") ? undefined : CallbackReceiver, "direct forwarding preserves the backend-selected callback receiver");
					g_Assert.equal(Observation.Returned, !bBlocking, "completion timing follows the backend");
					g_Assert.equal(unCallbackCount, 1, "one backend completion produces one caller completion");

					if (strMethodName !== "Get") {
						g_Assert.equal(Observation.Arguments[2], ExtraArgument, "forwarded completion metadata identity");
					}

					unScenarioCount += 1;
				}
			}
		}
	}

	g_Assert.equal(unScenarioCount, 126, "setting forwarding covers both modes,three methods,seven error values and three result values");
}

async function VerifySettingsTypeFailureSentinels() {
	const vecFailures = [
		new Error("Setting failure"),
		null,
		undefined,
		0,
		false,
		"",
		Symbol("Setting failure"),
	];
	const vecFailurePhases = [
		"READ_ERROR",
		"STORED_COERCION",
		"DEFAULT_COERCION",
		"VALIDATION",
		"REJECTED_DEFAULT_COERCION",
	];
	let unScenarioCount = 0;

	for (const bBlocking of [false, true]) {
		for (const Failure of vecFailures) {
			for (const strFailurePhase of vecFailurePhases) {
				if ((strFailurePhase === "READ_ERROR") && (Failure === null)) {
					continue;
				}

				const vecCompletions = [];
				const Storage = {
					GetSetting(strPlayerUniqueID, strSettingToken, DefaultValue, Options, Callback) {
						g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "typed failure player");
						g_Assert.equal(strSettingToken, "FailureValue", "typed failure token");
						g_Assert.equal(Options.Blocking, bBlocking, "typed failure request mode");

						const CompleteRequest = () => {
							if (strFailurePhase === "READ_ERROR") {
								Callback(Failure, null);
								return;
							}

							Callback(null, (strFailurePhase === "DEFAULT_COERCION") ? DefaultValue : 42);
						};

						if (bBlocking) {
							CompleteRequest();
							return;
						}

						Promise.resolve().then(CompleteRequest);
					},

					SetSetting() {
						throw new Error("Typed failure fixture must not write.");
					},

					DeleteSetting() {
						throw new Error("Typed failure fixture must not delete.");
					},
				};
				const Setting = new g_TypesAPI.SettingsType("Failure Value", 17, { Storage });

				if ((strFailurePhase === "STORED_COERCION") || (strFailurePhase === "DEFAULT_COERCION")) {
					Setting.Coerce = () => {
						throw Failure;
					};

				} else if (strFailurePhase === "VALIDATION") {
					Setting.ValueValidator = () => {
						throw Failure;
					};

				} else if (strFailurePhase === "REJECTED_DEFAULT_COERCION") {
					Setting.ValueValidator = () => false;
					Setting.Coerce = (SettingsValue) => {
						if (SettingsValue === 42) {
							return SettingsValue;
						}

						throw Failure;
					};
				}

				let DirectResult = null;
				const Completion = new Promise((Resolve) => {
					DirectResult = Setting.Get("FixturePlayer", { Blocking: bBlocking }, (RequestError, Result) => {
						vecCompletions.push({ RequestError, Result });
						Resolve();
					});
				});
				await Completion;
				await Promise.resolve();
				g_Assert.equal(DirectResult, undefined, "typed failure direct return");
				g_Assert.equal(vecCompletions.length, 1, "typed failure completes once");
				g_Assert.equal(vecCompletions[0].Result, null, "typed failure cannot deliver a successful value");
				g_Assert.notEqual(vecCompletions[0].RequestError, null, "typed failure cannot use the success sentinel");

				if (Failure === null) {
					g_Assert.equal(vecCompletions[0].RequestError.cause, null, "typed caught null remains available as cause");

				} else {
					g_Assert.equal(vecCompletions[0].RequestError, Failure, "typed failure identity is preserved");
				}

				unScenarioCount++;
			}
		}
	}

	for (const Failure of vecFailures) {
		const Storage = {
			GetSetting(strPlayerUniqueID, strSettingToken, DefaultValue, Options, Callback) {
				g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "typed callback player");
				g_Assert.equal(strSettingToken, "CallbackValue", "typed callback token");
				g_Assert.equal(typeof DefaultValue, "symbol", "typed callback missing-value sentinel");
				g_Assert.equal(Options.Blocking, true, "typed callback Blocking mode");
				Callback(null, 42);
			},

			SetSetting() {
				throw new Error("Typed callback fixture must not write.");
			},

			DeleteSetting() {
				throw new Error("Typed callback fixture must not delete.");
			},
		};
		const Setting = new g_TypesAPI.SettingsType("Callback Value", 17, { Storage });
		let bFailed = false;
		let CaughtFailure = undefined;
		let unCallbackCount = 0;

		try {
			Setting.Get("FixturePlayer", { Blocking: true }, (RequestError, Result) => {
				unCallbackCount++;
				g_Assert.equal(RequestError, null, "typed callback success sentinel");
				g_Assert.equal(Result, 42, "typed callback success result");
				throw Failure;
			});
		} catch (CallbackError) {
			CaughtFailure = CallbackError;
			bFailed = true;
		}

		g_Assert.equal(bFailed, true, "typed callback exception escapes");
		g_Assert.equal(CaughtFailure, Failure, "typed callback exception stays unwrapped");
		g_Assert.equal(unCallbackCount, 1, "typed callback exception is never retried");
		unScenarioCount++;
	}

	g_Assert.equal(unScenarioCount, 75, "typed settings cover falsy failures and caller exceptions");
}

async function VerifyDocumentedBaseSettingFailures() {
	const vecThrownValues = [
		new Error("Base workflow failure"),
		null,
		undefined,
		0,
		false,
		"",
		Symbol("Base workflow failure"),
	];
	let unScenarioCount = 0;

	function CompleteRequest(Options, Callback, RequestError, Result) {
		const Complete = () => Callback(RequestError, Result);
		if (Options.Blocking) {
			Complete();
			return;
		}

		Promise.resolve().then(Complete);
	}

	async function CaptureCompletion(Request) {
		const vecCompletions = [];
		let DirectResult = null;
		await new Promise((Resolve) => {
			DirectResult = Request((RequestError, Result) => {
				vecCompletions.push({ RequestError, Result });
				Resolve();
			});
		});
		await Promise.resolve();
		g_Assert.equal(DirectResult, undefined, "base workflow direct result");
		g_Assert.equal(vecCompletions.length, 1, "base workflow completes once");

		return vecCompletions[0];
	}

	function VerifyFailure(Completion, Failure) {
		g_Assert.notEqual(Completion.RequestError, null, "base workflow failure is not success");
		g_Assert.equal(Completion.Result, null, "base workflow failure has no result");

		if (Failure === null) {
			g_Assert.equal(Completion.RequestError.cause, null, "caught null is retained as cause");

		} else {
			g_Assert.equal(Completion.RequestError, Failure, "base workflow preserves error identity");
		}
	}

	for (const bBlocking of [false, true]) {
		for (const Failure of vecThrownValues) {
			const Storage = g_DocumentedWorkflows.CreateMemorySettingsStorage();
			Storage.MapSettingsValues.set(JSON.stringify(["FixturePlayer", "FailureValue"]), 42);
			Storage.MapSettingsValues.get = () => {
				throw Failure;
			};
			const Completion = await CaptureCompletion((Callback) => Storage.GetSetting("FixturePlayer", "FailureValue", null, { Blocking: bBlocking }, Callback));
			VerifyFailure(Completion, Failure);
			unScenarioCount++;

			for (const unFailureStep of [1, 2, 3]) {
				if (Failure === null) {
					continue;
				}

				let unOperationCount = 0;
				const FaultStorage = {
					GetSetting(strPlayerUniqueID, strSettingToken, DefaultValue, Options, Callback) {
						g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "retry callback failure player");
						g_Assert.equal(strSettingToken, "MatchRetryCount", "retry callback failure token");
						g_Assert.equal(typeof DefaultValue, "symbol", "retry callback missing-value sentinel");
						g_Assert.equal(Options.Blocking, bBlocking, "retry callback failure mode");
						unOperationCount++;
						CompleteRequest(Options, Callback, (unOperationCount === unFailureStep) ? Failure : null, (unOperationCount === unFailureStep) ? null : 1);
					},

					SetSetting(strPlayerUniqueID, strSettingToken, SettingsValue, Options, Callback) {
						g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "retry callback write player");
						g_Assert.equal(strSettingToken, "MatchRetryCount", "retry callback write token");
						g_Assert.equal(SettingsValue, 2, "retry callback write value");
						g_Assert.equal(Options.Blocking, bBlocking, "retry callback write mode");
						unOperationCount++;
						CompleteRequest(Options, Callback, (unOperationCount === unFailureStep) ? Failure : null, (unOperationCount === unFailureStep) ? null : true);
					},

					DeleteSetting() {
						throw new Error("Retry failure fixture must not delete.");
					},
				};
				const RetrySetting = g_DocumentedWorkflows.CreateRetrySetting(FaultStorage);
				const RetryCompletion = await CaptureCompletion((Callback) => g_DocumentedWorkflows.UpdateRetryCount(RetrySetting, "FixturePlayer", 2, { Blocking: bBlocking }, Callback));
				VerifyFailure(RetryCompletion, Failure);
				g_Assert.equal(unOperationCount, unFailureStep, "retry callback failure stops subsequent work");
				unScenarioCount++;
			}

			for (const unFailureStep of [2, 3]) {
				let unOperationCount = 0;
				const CompleteStep = (Options, Callback, Result) => {
					g_Assert.equal(Options.Blocking, bBlocking, "retry throwing request mode");
					unOperationCount++;

					if (unOperationCount === unFailureStep) {
						throw Failure;
					}

					CompleteRequest(Options, Callback, null, Result);
				};
				const RetrySetting = {
					Coerce(unRetryCount) {
						return unRetryCount;
					},

					IsValid(unRetryCount) {
						return Number.isSafeInteger(unRetryCount) && (unRetryCount >= 0);
					},

					Get(PlayerReference, Options, Callback) {
						g_Assert.equal(PlayerReference, "FixturePlayer", "retry throwing read player");
						CompleteStep(Options, Callback, 1);
					},

					Set(PlayerReference, unRetryCount, Options, Callback) {
						g_Assert.equal(PlayerReference, "FixturePlayer", "retry throwing write player");
						g_Assert.equal(unRetryCount, 2, "retry throwing write value");
						CompleteStep(Options, Callback, true);
					},
				};
				const RetryCompletion = await CaptureCompletion((Callback) => g_DocumentedWorkflows.UpdateRetryCount(RetrySetting, "FixturePlayer", 2, { Blocking: bBlocking }, Callback));
				VerifyFailure(RetryCompletion, Failure);
				g_Assert.equal(unOperationCount, unFailureStep, "retry throwing request stops subsequent work");
				unScenarioCount++;
			}
		}
	}

	for (const Failure of vecThrownValues) {
		const Storage = g_DocumentedWorkflows.CreateMemorySettingsStorage();
		const RetrySetting = g_DocumentedWorkflows.CreateRetrySetting(Storage);
		let bFailed = false;
		let CaughtFailure = undefined;
		let unCallbackCount = 0;

		try {
			g_DocumentedWorkflows.UpdateRetryCount(RetrySetting, "FixturePlayer", 2, { Blocking: true }, (RequestError, Result) => {
				g_Assert.equal(RequestError, null, "retry callback success sentinel");
				g_Assert.equal(Result.CurrentRetryCount, 2, "retry callback result");
				unCallbackCount++;
				throw Failure;
			});
		} catch (CallbackError) {
			CaughtFailure = CallbackError;
			bFailed = true;
		}

		g_Assert.equal(bFailed, true, "retry caller exception escapes");
		g_Assert.equal(CaughtFailure, Failure, "retry caller exception remains raw");
		g_Assert.equal(unCallbackCount, 1, "retry caller exception is not retried");
		unScenarioCount++;
	}

	g_Assert.equal(unScenarioCount, 85, "base documentation covers falsy and thrown failures in both modes");
}

async function VerifyDocumentedWorkflowFailures(bBlocking) {
	// Local-memory faults verify callback sequencing, not native workers or database drivers.
	const vecCases = [
		{ MethodName: "UpdateRetryCount", OperationCount: 3, CaptureThrows: false, CreateArguments: (Storage) => [g_DocumentedWorkflows.CreateRetrySetting(Storage), "ID", 3] },
		{ MethodName: "ResetRetryCount", OperationCount: 1, CaptureThrows: false, CreateArguments: (Storage) => [g_DocumentedWorkflows.CreateRetrySetting(Storage), "ID"] },
		{ MethodName: "UpdateCombatSettings", OperationCount: 6, CaptureThrows: true, CreateArguments: (Storage) => [g_DocumentedWorkflows.CreateCombatSettings(Storage), "ID", { DamageNumbersEnabled: false, HUDScale: 1.25, HitSoundVolume: 75 }] },
		{ MethodName: "ClearCombatSettings", OperationCount: 3, CaptureThrows: true, CreateArguments: (Storage) => [g_DocumentedWorkflows.CreateCombatSettings(Storage), "ID"] },
		{ MethodName: "UpdateInterfaceSettings", OperationCount: 4, CaptureThrows: true, CreateArguments: (Storage) => [g_DocumentedWorkflows.CreateInterfaceSettings(Storage), "ID", { ChatColor: "blue", MenuTheme: "light" }] },
		{ MethodName: "ClearInterfaceSettings", OperationCount: 2, CaptureThrows: true, CreateArguments: (Storage) => [g_DocumentedWorkflows.CreateInterfaceSettings(Storage), "ID"] },
	];
	const vecFailures = [
		new Error("Workflow operation failed"),
		null,
		undefined,
		0,
		false,
		"",
		Symbol("Workflow operation failed"),
	];
	let unScenarioCount = 0;

	for (const TestCase of vecCases) {
		for (const bThrowBeforeCallback of [false, true]) {
			if (bThrowBeforeCallback && !TestCase.CaptureThrows) {
				continue;
			}

			for (const ExpectedError of vecFailures) {
				if (!bThrowBeforeCallback && (ExpectedError === null)) {
					continue;
				}

				for (let unFailureStep = 1; unFailureStep <= TestCase.OperationCount; unFailureStep++) {
					const MemoryStorage = g_DocumentedWorkflows.CreateMemorySettingsStorage();
					const FaultStorage = { ...MemoryStorage };
					let unOperationCount = 0;

					for (const strMethodName of ["GetSetting", "SetSetting", "DeleteSetting"]) {
						const Operation = MemoryStorage[strMethodName];
						FaultStorage[strMethodName] = (...vecArguments) => {
							unOperationCount++;
							const Options = vecArguments.at(-2);
							const Callback = vecArguments.at(-1);
							g_Assert.equal(Options.Blocking, bBlocking, "failed workflow forwards mode");
							g_Assert.equal(typeof Callback, "function", "failed workflow requires callback");

							if (unOperationCount === unFailureStep) {
								if (bThrowBeforeCallback) {
									throw ExpectedError;
								}

								const CompleteFailure = () => Callback(ExpectedError, null);
								if (Options.Blocking) {
									CompleteFailure();
									return;
								}

								Promise.resolve().then(CompleteFailure);
								return;
							}

							Reflect.apply(Operation, MemoryStorage, vecArguments);
						};
					}

					const vecCompletions = [];
					let DirectResult = null;
					let unInlineCompletionCount = 0;
					await new Promise((Resolve) => {
						DirectResult = g_DocumentedWorkflows[TestCase.MethodName](...TestCase.CreateArguments(FaultStorage), { Blocking: bBlocking }, (RequestError, Result) => {
							vecCompletions.push({ RequestError, Result });
							Resolve();
						});
						unInlineCompletionCount = vecCompletions.length;
					});
					await Promise.resolve();
					g_Assert.equal(DirectResult, undefined, "failed workflow direct return");
					const bInlineFailure = bBlocking || (bThrowBeforeCallback && (unFailureStep === 1));
					g_Assert.equal(unInlineCompletionCount, bInlineFailure ? 1 : 0, "failed workflow completion mode");
					g_Assert.equal(vecCompletions.length, 1, "failed workflow completes once");
					g_Assert.notEqual(vecCompletions[0].RequestError, null, "failed workflow cannot report success");

					if (ExpectedError === null) {
						g_Assert.equal(vecCompletions[0].RequestError.cause, null, "failed workflow retains thrown null as cause");

					} else {
						g_Assert.equal(vecCompletions[0].RequestError, ExpectedError, "workflow preserves callback error identity");
					}

					g_Assert.equal(vecCompletions[0].Result, null, "failed workflow has no success record");
					g_Assert.equal(unOperationCount, unFailureStep, "workflow stops after the failed operation");
					unScenarioCount++;
				}
			}
		}

		if (bBlocking) {
			for (const CallbackError of vecFailures) {
				const ExpectedError = new Error("Backend completion failed");
				const FaultStorage = {};
				for (const strMethodName of ["GetSetting", "SetSetting", "DeleteSetting"]) {
					FaultStorage[strMethodName] = (...vecArguments) => vecArguments.at(-1)(ExpectedError, null);
				}

				let unCompletionCount = 0;
				let bFailed = false;
				let CaughtError = undefined;

				try {
					g_DocumentedWorkflows[TestCase.MethodName](...TestCase.CreateArguments(FaultStorage), { Blocking: true }, (RequestError, Result) => {
						unCompletionCount++;
						g_Assert.equal(RequestError, ExpectedError, "throwing callback receives the operation error");
						g_Assert.equal(Result, null, "throwing callback receives no success record");
						throw CallbackError;
					});
				} catch (ThrownError) {
					CaughtError = ThrownError;
					bFailed = true;
				}

				g_Assert.equal(bFailed, true, "caller callback failure escapes");
				g_Assert.equal(CaughtError, CallbackError, "caller callback failure stays unwrapped");
				g_Assert.equal(unCompletionCount, 1, "throwing callback completes only once");
				unScenarioCount++;
			}
		}
	}

	g_Assert.equal(unScenarioCount, bBlocking ? 261 : 219, "every workflow step covers callback and thrown failures");
}

function VerifyTypedSettingValidationContracts() {
	const Storage = g_DocumentedWorkflows.CreateMemorySettingsStorage();
	const BooleanDefinition = new g_TypesAPI.BooleanSetting("Boolean Contract", true, { Storage });
	g_Assert.throws(() => BooleanDefinition.Coerce("true"), TypeError, "boolean coercion requires a boolean");
	g_Assert.equal(BooleanDefinition.IsValid("true"), true, "inherited boolean validity is validator-only");
	g_Assert.throws(() => BooleanDefinition.Set("ID", "true", { Blocking: true }, () => {
		throw new Error("Invalid boolean write must not complete a request.");
	}), TypeError, "boolean write still coerces before storage");
	g_Assert.equal(Storage.MapSettingsValues.size, 0, "invalid boolean write leaves storage untouched");

	for (const NumericSetting of [g_TypesAPI.IntegerSetting, g_TypesAPI.FloatSetting]) {
		const Definition = new NumericSetting("Numeric Contract", 0, { Minimum: undefined, Maximum: null, Storage });
		g_Assert.equal(Definition.Minimum, null, "undefined numeric minimum is unbounded");
		g_Assert.equal(Definition.Maximum, null, "null numeric maximum is unbounded");
		g_Assert.throws(() => new NumericSetting("Equal Bounds", 1, { Minimum: 1, Maximum: 1, Storage }), RangeError, "equal numeric bounds are rejected");
		g_Assert.throws(() => new NumericSetting("Infinite Bounds", 0, { Maximum: Infinity, Storage }), TypeError, "numeric bounds must be finite");
	}

	const StringDefinition = new g_TypesAPI.StringSetting("Choice Contract", "dark", { Choices: ["dark"], Storage });
	const Option = StringDefinition.AddOption("Light Theme");
	g_Assert.deepEqual(Option, { Name: "Light Theme", Text: "Light Theme", Value: "Light Theme" }, "option names and values remain exact");
	g_Assert.equal(StringDefinition.Options.get("Light Theme"), Option, "AddOption returns the live stored record");

	Option.Text = "Light display";
	g_Assert.equal(StringDefinition.Options.get("Light Theme").Text, "Light display", "option metadata remains live");

	g_Assert.throws(() => new g_TypesAPI.StringSetting("Null Choices", "", { Choices: null, Storage }), TypeError, "null choices are invalid");
}

function VerifySettingRegistryNameAndOwnership() {
	const mapOriginalRegistry = new Map(g_TypesAPI.REGISTERED_SETTINGS);
	const Storage = g_DocumentedWorkflows.CreateMemorySettingsStorage();
	const vecInvalidNames = [
		null,
		undefined,
		42,
		false,
		{},
		[],
		Symbol("Invalid name"),
		"",
		"___",
		"Invalid1",
	];

	try {
		for (const InvalidName of vecInvalidNames) {
			const Setting = new g_TypesAPI.SettingsType("Valid Registry Name", null, { Storage });
			Setting.Name = InvalidName;
			g_Assert.throws(() => g_TypesAPI.RegisterSetting(Setting), TypeError, "registry rejects a mutated invalid name");
			g_Assert.equal(g_TypesAPI.REGISTERED_SETTINGS.size, mapOriginalRegistry.size, "invalid registration leaves registry unchanged");
		}

		let unNameReadCount = 0;
		class GetterNameSetting extends g_TypesAPI.SettingsType {
			get Name() {
				unNameReadCount++;

				return (unNameReadCount === 1) ? "Captured Registry Name" : "Unexpected Registry Name";
			}
		}

		const GetterSetting = new GetterNameSetting("Initial Registry Name", null, { Storage });
		g_Assert.equal(g_TypesAPI.RegisterSetting(GetterSetting), GetterSetting, "registration returns the exact setting");
		g_Assert.equal(unNameReadCount, 1, "registration validates and captures Name once");
		g_Assert.equal(g_TypesAPI.GetSetting("Captured Registry Name"), GetterSetting, "registration uses the validated captured key");
		g_Assert.equal(g_TypesAPI.UnregisterSetting("Captured Registry Name"), true, "captured registration is removable");

		const Registration = g_DocumentedWorkflows.RegisterRoundLimit(Storage, "Owned Registry Name");
		g_Assert.equal(g_TypesAPI.UnregisterSetting("Owned Registry Name"), true, "original owner entry removed externally");
		const Replacement = g_TypesAPI.RegisterSetting(new g_TypesAPI.IntegerSetting("Owned Registry Name", 1, { Storage }));
		g_Assert.equal(Registration.UnregisterRoundLimit(), false, "stale owner cannot unregister a replacement");
		g_Assert.equal(g_TypesAPI.GetSetting("Owned Registry Name"), Replacement, "replacement remains registered");
		g_Assert.equal(g_TypesAPI.UnregisterSetting("Owned Registry Name"), true, "replacement owner cleans up its entry");
		g_Assert.equal(Registration.UnregisterRoundLimit(), false, "absent original owner cleanup stays harmless");
	} finally {
		g_TypesAPI.REGISTERED_SETTINGS.clear();
		for (const [strSettingName, Setting] of mapOriginalRegistry) {
			g_TypesAPI.REGISTERED_SETTINGS.set(strSettingName, Setting);
		}
	}
}

async function VerifyAsynchronousSettingsTypes() {
	VerifyTypedSettingValidationContracts();
	VerifySettingRegistryNameAndOwnership();

	await VerifySettingsCompletionForwarding();
	await VerifySettingsTypeFailureSentinels();
	await VerifyDocumentedBaseSettingFailures();

	async function AwaitRequest(Target, strMethodName, vecArguments, Options) {
		const bBlocking = Options.Blocking === true;
		const vecCompletions = [];
		let DirectResult = null;
		let unInlineCompletionCount = 0;
		const Completion = new Promise((Resolve) => {
			DirectResult = Target[strMethodName](...vecArguments, Options, (RequestError, Result) => {
				const CompletedRequest = { RequestError, Result };
				vecCompletions.push(CompletedRequest);
				Resolve(CompletedRequest);
			});
			unInlineCompletionCount = vecCompletions.length;
		});
		const CompletedRequest = await Completion;
		await Promise.resolve();
		g_Assert.equal(DirectResult, undefined, `${strMethodName} async direct result`);
		g_Assert.equal(vecCompletions.length, 1, `${strMethodName} async completion count`);

		if (bBlocking) {
			g_Assert.equal(unInlineCompletionCount, 1, `${strMethodName} Blocking completes inline`);

		} else if (Target === g_DocumentedWorkflows) {
			g_Assert.equal(unInlineCompletionCount, 0, `${strMethodName} documentation workflow defers completion`);
		}

		if (CompletedRequest.RequestError !== null) {
			throw CompletedRequest.RequestError;
		}

		return CompletedRequest.Result;
	}

	for (const bBlocking of [false, true]) {
		await VerifyDocumentedWorkflowFailures(bBlocking);

		const Options = { Blocking: bBlocking };
		const Storage = g_StorageAPI.CreateStorage(`types-async-${bBlocking}`, { ConnectionString: `types-async-${bBlocking}`, Backend: "sqlite3" });

		try {
			const vecCases = [
				{ Setting: new g_TypesAPI.SettingsType("Unsigned Limit", null, { Storage }), Value: 18446744073709551615n },
				{ Setting: new g_TypesAPI.StringSetting("Text", "default", { Storage }), Value: "stored" },
				{ Setting: new g_TypesAPI.IntegerSetting("Count", 5, { Storage, Minimum: 0, Maximum: 10 }), Value: 7 },
				{ Setting: new g_TypesAPI.FloatSetting("Volume", 0.5, { Storage, Minimum: 0, Maximum: 1 }), Value: 0.75 },
				{ Setting: new g_TypesAPI.BooleanSetting("Enabled", false, { Storage }), Value: true },
				{ Setting: new g_TypesAPI.ChoiceSetting("Mode", "Low", { Storage, Choices: ["Low", "High"] }), Value: "High" },
			];
			for (const TestCase of vecCases) {
				const Setting = TestCase.Setting;
				g_Assert.equal(await AwaitRequest(Setting, "Get", ["ID"], Options), Setting.GetDefaultValue(), "async missing-value default");
				g_Assert.equal(await AwaitRequest(Setting, "Set", ["ID", TestCase.Value], Options), true, "async typed write");
				g_Assert.equal(await AwaitRequest(Setting, "Get", ["ID"], Options), TestCase.Value, "async typed read");
				g_Assert.equal(await AwaitRequest(Setting, "Delete", ["ID"], Options), true, "async typed delete");
				g_Assert.equal(await AwaitRequest(Setting, "Delete", ["ID"], Options), false, "async missing-value delete");
			}

			const BoundedSetting = new g_TypesAPI.IntegerSetting("Bounded", 5, { Storage, Minimum: 0, Maximum: 10 });
			g_Assert.equal(await AwaitRequest(Storage, "SetSetting", ["ID", BoundedSetting.ConVar, 11], Options), true, "validator fallback fixture stores the out-of-bounds value");
			g_Assert.equal(await AwaitRequest(BoundedSetting, "Get", ["ID"], Options), 5, "async validator fallback");
			g_Assert.equal(await AwaitRequest(Storage, "SetSetting", ["ID", BoundedSetting.ConVar, "bad"], Options), true, "coercion failure fixture stores the wrong-type value");
			await g_Assert.rejects(AwaitRequest(BoundedSetting, "Get", ["ID"], Options), TypeError, "async coercion failure");
			g_Assert.throws(() => BoundedSetting.Set("ID", 11, Options, () => {
			}), TypeError, "invalid writes reject before scheduling");
		} finally {
			const bStorageHadHandle = Storage.Handle !== null;
			g_Assert.equal(await AwaitRequest(Storage, "Close", [], Options), bStorageHadHandle, "async fixture session cleanup");
		}

		const MemoryStorage = g_DocumentedWorkflows.CreateMemorySettingsStorage();
		const RetrySetting = g_DocumentedWorkflows.CreateRetrySetting(MemoryStorage);
		const WorkflowOptions = { Blocking: bBlocking };
		const RetryCompletion = AwaitRequest(g_DocumentedWorkflows, "UpdateRetryCount", [RetrySetting, "ID", 3], WorkflowOptions);
		WorkflowOptions.Blocking = !bBlocking;
		g_Assert.deepEqual(ToPlainValue(await RetryCompletion), { CurrentRetryCount: 3, PreviousRetryCount: 0, RetryCountWasStored: true }, "async documented retry update");
		g_Assert.equal(MemoryStorage.MapSettingsValues.get(JSON.stringify(["ID", "MatchRetryCount"])), 3, "documented PascalCase key");
		g_Assert.equal(MemoryStorage.MapSettingsValues.has(JSON.stringify(["ID", "match_retry_count"])), false, "no lowercase-key alias");
		g_Assert.equal(await AwaitRequest(g_DocumentedWorkflows, "ResetRetryCount", [RetrySetting, "ID"], Options), true, "async documented retry cleanup");

		const CombatSettings = g_DocumentedWorkflows.CreateCombatSettings(MemoryStorage);
		g_Assert.deepEqual(ToPlainValue(await AwaitRequest(g_DocumentedWorkflows, "UpdateCombatSettings", [CombatSettings, "ID", { DamageNumbersEnabled: false, HUDScale: 1.25, HitSoundVolume: 75 }], Options)), {
			DamageNumbersEnabled: false,
			HitSoundVolume: 75,
			HUDScale: 1.25,
			SettingWriteResults: { DamageNumbersWasStored: true, HitSoundVolumeWasStored: true, HUDScaleWasStored: true },
		}, "async documented numeric update");
		g_Assert.deepEqual(ToPlainValue(await AwaitRequest(g_DocumentedWorkflows, "ClearCombatSettings", [CombatSettings, "ID"], Options)), { DamageNumbersWasDeleted: true, HitSoundVolumeWasDeleted: true, HUDScaleWasDeleted: true }, "async documented numeric cleanup");

		const InterfaceSettings = g_DocumentedWorkflows.CreateInterfaceSettings(MemoryStorage);
		g_Assert.deepEqual(ToPlainValue(await AwaitRequest(g_DocumentedWorkflows, "UpdateInterfaceSettings", [InterfaceSettings, "ID", { ChatColor: "blue", MenuTheme: "light" }], Options)), { ChatColor: "blue", MenuTheme: "light", SettingWriteResults: { ChatColorWasStored: true, MenuThemeWasStored: true } }, "async documented choice update");
		g_Assert.deepEqual(ToPlainValue(await AwaitRequest(g_DocumentedWorkflows, "ClearInterfaceSettings", [InterfaceSettings, "ID"], Options)), { ChatColorWasDeleted: true, MenuThemeWasDeleted: true }, "async documented choice cleanup");
		g_Assert.equal(MemoryStorage.MapSettingsValues.size, 0, "async documented storage cleanup");
	}

	for (const TokenCase of [
		{ Name: "menu theme", Token: "MenuTheme" },
		{ Name: "menu_theme", Token: "MenuTheme" },
		{ Name: "__menu  theme__", Token: "MenuTheme" },
		{ Name: "HUD scale", Token: "HUDScale" },
	]) {
		const Setting = new g_TypesAPI.StringSetting(TokenCase.Name, "", { Prefix: "SJS" });
		g_Assert.equal(Setting.ConVar, "SJS" + TokenCase.Token, "canonical PascalCase setting token");
	}
}

let g_CompletionTimeoutTimer = null;

async function CompleteSettingsTypesVerification() {
	let PrimaryError = undefined;
	let bHasPrimaryError = false;

	try {
		const CompletionDeadline = new Promise((Resolve, Reject) => {
			g_CompletionTimeoutTimer = setTimeout(() => Reject(new Error("settings/types async checks did not complete")), g_unCompletionTimeoutMilliseconds);
		});
		await Promise.race([VerifyAsynchronousSettingsTypes(), CompletionDeadline]);
	} catch (Failure) {
		PrimaryError = Failure;
		bHasPrimaryError = true;
	} finally {
		clearTimeout(g_CompletionTimeoutTimer);

		try {
			ReleaseSettingsTypesFixture();
		} catch (CleanupFailure) {
			throw new AggregateError(bHasPrimaryError ? [PrimaryError, CleanupFailure] : [CleanupFailure], "Settings/types asynchronous verification cleanup failed.");
		}
	}

	if (bHasPrimaryError) {
		throw PrimaryError;
	}
}

CompleteSettingsTypesVerification().then(() => {
	console.log("[  OK  ] smoke_settings_types");
}, (RequestError) => {
	console.error(RequestError);
	process.exitCode = 1;
});
