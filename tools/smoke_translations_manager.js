#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations-manager.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strManagerPath = g_Path.join(g_strPackageRootPath, "translations", "manager.js");
const g_strTranslationsPath = g_Path.join(g_strPackageRootPath, "translations.js");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strRootDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations.md");
const g_strStringsDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations-strings.md");

const g_LanguageState = {
	DefaultLanguage: "en",
	FallbackLanguage: "en",
	Languages: { en: "en", english: "en", ru: "ru", russian: "ru" },
};

const g_CallCounts = { GetDefaultLanguage: 0, GetFallbackLanguage: 0, GetLanguage: 0, GetLanguages: 0, SetDefaultLanguage: 0 };

function GetTotalCallCount() {
	let unTotalCallCount = 0;
	for (const strOperationName of Object.keys(g_CallCounts)) {
		unTotalCallCount += g_CallCounts[strOperationName];
	}

	return unTotalCallCount;
}

function ResolveLanguage(strName) {
	if (typeof strName !== "string") {
		throw new Error("translation language name must be a string");
	}

	const strNormalizedName = strName.trim().toLowerCase();

	return Object.hasOwn(g_LanguageState.Languages, strNormalizedName) ? g_LanguageState.Languages[strNormalizedName] : null;
}

// Delegation fixture only: native filesystem IO and process-lifetime overrides need runtime tests.
// Caller-defined language names and codes are resource data, not API member names.
const g_NativeTranslations = {
	GetDefaultLanguage() {
		g_CallCounts.GetDefaultLanguage += 1;

		return g_LanguageState.DefaultLanguage;
	},

	GetFallbackLanguage() {
		g_CallCounts.GetFallbackLanguage += 1;

		return g_LanguageState.FallbackLanguage;
	},

	GetLanguage(strName) {
		g_CallCounts.GetLanguage += 1;

		return ResolveLanguage(strName);
	},

	GetLanguages() {
		g_CallCounts.GetLanguages += 1;

		return { DefaultLanguage: g_LanguageState.DefaultLanguage, FallbackLanguage: g_LanguageState.FallbackLanguage, Languages: structuredClone(g_LanguageState.Languages) };
	},

	SetDefaultLanguage(strLanguage) {
		g_CallCounts.SetDefaultLanguage += 1;

		const strSelectedLanguage = ResolveLanguage(strLanguage);
		if (strSelectedLanguage === null) {
			throw new Error(`translation language not found: ${strLanguage}`);
		}

		g_LanguageState.DefaultLanguage = strSelectedLanguage;

		return true;
	},
};

function LoadTestAPIs() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const mapCachedModules = new Map();
	const mapModulePaths = new Map([["internal/runtime", g_strInternalRuntimePath], ["translations", g_strTranslationsPath]]);
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Translations/manager runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Translations/manager package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Translations/manager runtime fixture must support exact restoration.");
	g_Assert.ok(LoaderDescriptor && LoaderDescriptor.configurable && (typeof OriginalModuleLoad === "function"), "Translations/manager loader must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed translations/manager cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned translations/manager fixture property must be removable: " + strKey);
	};

	let bSourceJSOwned = false;
	let bLoaderOwned = false;
	let bCacheOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;

	try {
		bCacheOwned = true;

		for (const strModulePath of mapCachedModules.keys()) {
			RestoreProperty(require.cache, strModulePath, undefined);
		}

		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { translations: g_NativeTranslations } });
		bSourceJSOwned = true;

		Object.defineProperty(g_Module, "_load", {
			...LoaderDescriptor,
			writable: true,
			value: function LoadTranslationsManagerModule(strRequest, Parent, bIsMain) {
				const strModulePath = mapModulePaths.get(strRequest) ?? strRequest;

				return OriginalModuleLoad.call(this, strModulePath, Parent, bIsMain);
			},
		});
		bLoaderOwned = true;

		g_Assert.equal(require(g_strTranslationsPath), g_NativeTranslations, "current facade uses the installed native module");
		g_Assert.deepEqual(Object.keys(g_NativeTranslations).sort(), ["GetDefaultLanguage", "GetFallbackLanguage", "GetLanguage", "GetLanguages", "SetDefaultLanguage"], "fixture exposes only current manager native exports");

		const ManagerAPI = require(g_strManagerPath);
		const RepeatedManagerAPI = require(g_strManagerPath);
		Result = { ManagerAPI, RepeatedManagerAPI };
	} catch (ExceptionValue) {
		Failure = ExceptionValue;
		bFailed = true;
	} finally {
		const vecFailures = [];
		const AttemptRestoration = Restore => {
			try {
				Restore();
			} catch (ExceptionValue) {
				vecFailures.push(ExceptionValue);
			}
		};

		if (bLoaderOwned) {
			AttemptRestoration(() => RestoreProperty(g_Module, "_load", LoaderDescriptor));
		}

		if (bCacheOwned) {
			for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
				if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
					AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, undefined));
				}
			}

			for (const [strModulePath, Descriptor] of mapCachedModules) {
				AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, Descriptor));
			}
		}

		if (bSourceJSOwned) {
			AttemptRestoration(() => RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor));
		}

		if (vecFailures.length > 0) {
			if (bFailed) {
				vecFailures.unshift(Failure);
			}

			throw new AggregateError(vecFailures, "Translations/manager fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

function CollectDocumentedMembers(strDocumentation) {
	const vecSections = strDocumentation.replace(/\r\n/g, "\n").split("## LanguageManager\n");
	g_Assert.equal(vecSections.length, 2, "documentation contains exactly one LanguageManager section");

	const strSection = vecSections[1].split("\n## ")[0];
	const vecMatches = [...strSection.matchAll(/^\| \x60([^\x60]+)\x60 \| (?:getter(?:\/setter)?|method) \|/gm)];
	const vecMembers = vecMatches.map((vecMatch) => vecMatch[1].replace(/\(.*$/, ""));

	return vecMembers.sort();
}

function RunDocumentationBlock(strCode, unIndex, ManagerAPI) {
	const unDocumentationTimeoutMilliseconds = 1000;

	const DocumentationContext = g_VM.createContext({
		require(strIdentifier) {
			if (strIdentifier === "translations/manager") {
				return ManagerAPI;
			}

			throw new Error(`Unexpected documentation import: ${strIdentifier}`);
		},
	});

	const unCallCountBefore = GetTotalCallCount();
	const strDefaultLanguageBefore = g_LanguageState.DefaultLanguage;

	g_VM.runInContext(strCode, DocumentationContext, { filename: `${g_strDocumentationPath}:example-${unIndex + 1}.js`, timeout: unDocumentationTimeoutMilliseconds });

	g_Assert.equal(GetTotalCallCount(), unCallCountBefore, `example ${unIndex + 1} performs no native lookup during load`);
	g_Assert.equal(g_LanguageState.DefaultLanguage, strDefaultLanguageBefore, `example ${unIndex + 1} preserves process default during load`);

	return DocumentationContext;
}

const g_TestAPIs = LoadTestAPIs();
const g_ManagerAPI = g_TestAPIs.ManagerAPI;
const g_RepeatedManagerAPI = g_TestAPIs.RepeatedManagerAPI;
g_Assert.deepEqual(Object.keys(g_ManagerAPI).sort(), ["LANGUAGE_MANAGER", "LanguageManager"], "exact translations/manager exports");
g_Assert.equal(GetTotalCallCount(), 0, "loading the manager and constructing its singleton performs no native lookup");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_ManagerAPI.LanguageManager.prototype).sort(), [
	"Aliases",
	"DefaultLanguage",
	"FallbackLanguage",
	"GetLanguage",
	"Has",
	"constructor",
], "exact LanguageManager members");
g_Assert.ok(g_ManagerAPI.LANGUAGE_MANAGER instanceof g_ManagerAPI.LanguageManager, "canonical manager type");
g_Assert.equal(g_RepeatedManagerAPI.LANGUAGE_MANAGER, g_ManagerAPI.LANGUAGE_MANAGER, "module cache preserves the canonical singleton");
g_Assert.equal(Object.hasOwn(g_ManagerAPI, "languageManager"), false, "lowercase singleton alias is absent");
g_Assert.equal(Object.hasOwn(g_ManagerAPI, "default"), false, "default alias is absent");

const g_AliasesDescriptor = Object.getOwnPropertyDescriptor(g_ManagerAPI.LanguageManager.prototype, "Aliases");
const g_DefaultDescriptor = Object.getOwnPropertyDescriptor(g_ManagerAPI.LanguageManager.prototype, "DefaultLanguage");
const g_FallbackDescriptor = Object.getOwnPropertyDescriptor(g_ManagerAPI.LanguageManager.prototype, "FallbackLanguage");

g_Assert.equal(typeof g_AliasesDescriptor.get, "function", "Aliases getter");
g_Assert.equal(g_AliasesDescriptor.set, undefined, "Aliases has no setter");
g_Assert.equal(typeof g_DefaultDescriptor.get, "function", "default language getter");
g_Assert.equal(typeof g_DefaultDescriptor.set, "function", "default language setter");
g_Assert.equal(typeof g_FallbackDescriptor.get, "function", "fallback language getter");
g_Assert.equal(g_FallbackDescriptor.set, undefined, "fallback language has no setter");

const g_Manager = g_ManagerAPI.LANGUAGE_MANAGER;
const g_Aliases = g_Manager.Aliases;
g_Assert.equal(g_Aliases.russian, "ru", "current Aliases");
g_Aliases.english = "ru";
g_Assert.equal(g_Manager.Aliases.english, "en", "Aliases are independently owned");
g_Assert.equal(g_Manager.DefaultLanguage, "en", "live default language");
g_Assert.equal(g_Manager.FallbackLanguage, "en", "live fallback language");
g_Assert.equal(g_Manager.GetLanguage(" Russian "), "ru", "normalized language lookup");
g_Assert.equal(g_Manager.GetLanguage("unknown"), null, "unknown language result");
g_Assert.equal(g_Manager.GetLanguage(""), null, "empty language name has no registered alias");
g_Assert.equal(g_Manager.GetLanguage("toString"), null, "inherited object names are not registered language aliases");
g_Assert.equal(g_Manager.Has("English"), true, "known language membership");
g_Assert.equal(g_Manager.Has("unknown"), false, "unknown language membership");
g_Assert.equal(g_Manager.Has("  "), false, "whitespace-only language name is not registered");
g_Assert.throws(function GetLanguageWithInvalidName() {
	g_Manager.GetLanguage(3);
}, /language name must be a string/, "strict language-name input");

g_Assert.throws(function HasWithInvalidName() {
	g_Manager.Has(undefined);
}, /language name must be a string/, "Has propagates native lookup errors");

const g_OverriddenManager = {
	GetLanguage() {
		return "custom";
	},
};
g_Assert.equal(g_ManagerAPI.LanguageManager.prototype.Has.call(g_OverriddenManager, "ignored"), true, "Has uses its receiver's GetLanguage override");
g_OverriddenManager.GetLanguage = () => null;
g_Assert.equal(g_ManagerAPI.LanguageManager.prototype.Has.call(g_OverriddenManager, "ignored"), false, "Has checks the exact null sentinel");

const g_OtherManager = new g_ManagerAPI.LanguageManager("ignored");
const g_strAssignmentResult = g_OtherManager.DefaultLanguage = "russian";
g_Assert.equal(g_strAssignmentResult, "russian", "assignment expression returns the assigned value");
g_Assert.equal(g_Manager.DefaultLanguage, "ru", "instances share native default state");
g_Manager.DefaultLanguage = "english";
g_Assert.equal(g_OtherManager.DefaultLanguage, "en", "singleton writes are visible to other instances");
g_Assert.throws(function SetUnknownDefaultLanguage() {
	g_Manager.DefaultLanguage = "unknown";
}, /not found/, "unknown default language error");
g_Assert.equal(g_Manager.DefaultLanguage, "en", "failed unknown assignment preserves the previous default");
g_Assert.throws(function SetDefaultLanguageWithInvalidName() {
	g_Manager.DefaultLanguage = 3;
}, /language name must be a string/, "setter propagates non-string native argument errors");
g_Assert.equal(g_Manager.DefaultLanguage, "en", "failed type validation preserves the previous default");
g_Assert.throws(function SetReadOnlyFallbackLanguage() {
	g_Manager.FallbackLanguage = "ru";
}, TypeError, "fallback language is read-only in strict mode");
g_Assert.equal(g_CallCounts.GetLanguages >= 2, true, "Aliases delegate to native GetLanguages every time");
g_Assert.equal(g_CallCounts.GetLanguage >= 4, true, "lookups delegate to native GetLanguage");
g_Assert.equal(g_CallCounts.SetDefaultLanguage >= 2, true, "writes delegate to native SetDefaultLanguage");

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_CodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecCodeBlocks = [];
let g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
while (g_vecCodeBlockMatch !== null) {
	g_vecCodeBlocks.push(g_vecCodeBlockMatch[1]);
	g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
}

g_Assert.equal(g_vecCodeBlocks.length, 4, "all translations/manager documentation JavaScript blocks are present");

const g_vecDocumentationContexts = [];
for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecCodeBlocks.length; unCodeBlockIndex += 1) {
	g_vecDocumentationContexts.push(RunDocumentationBlock(g_vecCodeBlocks[unCodeBlockIndex], unCodeBlockIndex, g_ManagerAPI));
}

const g_Inspection = g_vecDocumentationContexts[1].InspectLanguageManager(["english", " Russian ", "missing"]);
g_Assert.equal(g_Inspection.DefaultLanguage, "en", "inspection workflow reads the default");
g_Assert.equal(g_Inspection.FallbackLanguage, "en", "inspection workflow reads the fallback");
g_Assert.equal(g_Inspection.Aliases.russian, "ru", "inspection workflow returns current Aliases");

const g_vecResolvedLanguages = [];
for (const Resolution of g_Inspection.Resolutions) {
	g_vecResolvedLanguages.push({ Name: Resolution.Name, Registered: Resolution.Registered, ShortName: Resolution.ShortName });
}

g_Assert.deepEqual(g_vecResolvedLanguages, [
	{ Name: "english", Registered: true, ShortName: "en" },
	{ Name: " Russian ", Registered: true, ShortName: "ru" },
	{ Name: "missing", Registered: false, ShortName: null },
], "inspection workflow resolves every requested name");

g_Inspection.Aliases.english = "ru";
g_Assert.equal(g_Manager.Aliases.english, "en", "inspection workflow returns independently owned Aliases");

const g_Configuration = g_vecDocumentationContexts[2].ConfigureManagerDefault("russian");
const g_ConfigurationRecord = {};
for (const strConfigurationFieldName of Object.keys(g_Configuration)) {
	g_ConfigurationRecord[strConfigurationFieldName] = g_Configuration[strConfigurationFieldName];
}

g_Assert.deepEqual(g_ConfigurationRecord, { Changed: true, CurrentLanguage: "ru", PreviousLanguage: "en" }, "configuration workflow reports its process-wide change");
g_Assert.equal(g_LanguageState.DefaultLanguage, "ru", "configuration workflow leaves the selected override active");
g_Assert.throws(function ConfigureUnknownLanguage() {
	g_vecDocumentationContexts[2].ConfigureManagerDefault("missing");
}, /Unknown configured language/, "configuration workflow rejects unknown Aliases");

g_Manager.DefaultLanguage = "english";

const g_Comparison = g_vecDocumentationContexts[3].CompareLanguageManagerViews("russian");
g_Assert.equal(g_Comparison.AliasesAreIndependent, true, "manager views return independently owned Aliases");
g_Assert.equal(g_Comparison.DefaultMatches, true, "manager views share the default");
g_Assert.equal(g_Comparison.FallbackMatches, true, "manager views share the fallback");
g_Assert.equal(g_Comparison.KnownByBoth, true, "manager views resolve through the same registry");
g_Assert.notEqual(g_Comparison.SharedAliases, g_Comparison.OtherAliases, "comparison preserves distinct owned alias records");
g_Assert.equal(g_LanguageState.DefaultLanguage, "en", "documentation verification restores the visible test default");

for (const strExportName of Object.keys(g_ManagerAPI)) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

const g_vecPublicMemberNames = Reflect.ownKeys(g_ManagerAPI.LanguageManager.prototype).filter((MemberKey) => MemberKey !== "constructor").map((MemberKey) => String(MemberKey)).sort();
g_Assert.deepEqual(CollectDocumentedMembers(g_strDocumentation), g_vecPublicMemberNames, "exact documented LanguageManager members");

g_Assert.doesNotMatch(g_strDocumentation, /console\.(?:log|warn|error)/, "translations/manager examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by/, "translations/manager documentation is hand-maintained");
g_Assert.equal(g_FileSystem.existsSync(g_strRootDocumentationPath), true, "translations documentation exists");
g_Assert.equal(g_FileSystem.existsSync(g_strStringsDocumentationPath), true, "translations/strings documentation exists");

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntime = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strManagerPath)});`], {
	encoding: "utf8",
	timeout: g_unMissingRuntimeTimeoutMilliseconds,
	env: {
		...process.env,
		NODE_PATH: g_strPackageRootPath,
	},
});
g_Assert.equal(g_MissingRuntime.error, undefined, "missing runtime probe launches and exits before its timeout");
g_Assert.equal(g_MissingRuntime.signal, null, "missing runtime probe is not terminated");
g_Assert.equal(g_MissingRuntime.status, 1, "translations/manager requires the native runtime");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_translations_manager");
