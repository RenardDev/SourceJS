#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strManagerPath = g_Path.join(g_strPackageRootPath, "translations", "manager.js");
const g_strStringsPath = g_Path.join(g_strPackageRootPath, "translations", "strings.js");
const g_strTranslationsPath = g_Path.join(g_strPackageRootPath, "translations.js");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");

const g_vecCallLog = [];
const g_LanguageState = {
	Aliases: { en: "en", english: "en", fr: "fr", french: "fr" },
	Default: "fr",
	Fallback: "en",
};

const g_TranslationFiles = {
	demo: {
		DefaultLanguage: "fr",
		Name: "demo",
		Path: "resource/sourcejs/translations/demo.ini",
		ServerPath: "resource/sourcejs/translations/demo_server.ini",
		Strings: {
			Greeting: {
				DefaultLanguage: "fr",
				Languages: { en: "Hello {name}", fr: "Bonjour {name}" },
				Name: "Greeting",
			},
		},
	},
};

function CloneValue(Value) {
	return JSON.parse(JSON.stringify(Value));
}

function RequireTranslationFile(strTranslationFilePath) {
	if (typeof strTranslationFilePath !== "string") {
		throw new Error("translation file must be a string");
	}

	if (!Object.hasOwn(g_TranslationFiles, strTranslationFilePath)) {
		throw new Error(`unregistered translation fixture: ${strTranslationFilePath}`);
	}

	return g_TranslationFiles[strTranslationFilePath];
}

function GetTranslationPhrase(strTranslationFilePath, strPhraseKey) {
	if (typeof strPhraseKey !== "string") {
		throw new Error("translation key must be a string");
	}

	const TranslationFile = RequireTranslationFile(strTranslationFilePath);

	return Object.hasOwn(TranslationFile.Strings, strPhraseKey) ? TranslationFile.Strings[strPhraseKey] : null;
}

function ResolveLanguage(strLanguage) {
	if (typeof strLanguage !== "string") {
		throw new Error("language name must be a string");
	}

	const strNormalizedLanguage = strLanguage.trim().toLowerCase();

	return Object.hasOwn(g_LanguageState.Aliases, strNormalizedLanguage) ? g_LanguageState.Aliases[strNormalizedLanguage] : null;
}

function IsObjectValue(Value) {
	return (Value !== null) && ((typeof Value === "object") || (typeof Value === "function"));
}

function FormatReplacementText(strMessage, Tokens = undefined) {
	if (Tokens === undefined) {
		return strMessage;
	}

	let strResult = strMessage;
	for (const strName of Object.getOwnPropertyNames(Tokens)) {
		strResult = strResult.split(`{${strName}}`).join(String(Tokens[strName]));
	}

	return strResult;
}

// Registered-record delegation only; this fixture does not prove native IO/parser/lifecycle behavior.
// Caller-defined file, phrase, language and token spellings are resource data, not API identifiers.
const g_NativeTranslations = {
	FormatText(strMessage, Values = undefined) {
		g_vecCallLog.push(["FormatText", strMessage, Values]);

		if (typeof strMessage !== "string") {
			throw new Error("message must be a string");
		}

		if ((arguments.length > 1) && !IsObjectValue(Values)) {
			throw new Error("values must be an object");
		}

		return FormatReplacementText(strMessage, Values);
	},

	GetText(strTranslationFilePath, strPhraseKey, strLanguage = undefined, Tokens = undefined) {
		g_vecCallLog.push(["GetText", strTranslationFilePath, strPhraseKey, strLanguage, Tokens]);

		if ((typeof strTranslationFilePath !== "string") || (typeof strPhraseKey !== "string")) {
			throw new Error("translation file and key must be strings");
		}

		if ((strLanguage !== undefined) && (typeof strLanguage !== "string")) {
			throw new Error("language must be a string or undefined");
		}

		if ((arguments.length > 3) && !IsObjectValue(Tokens)) {
			throw new Error("tokens must be an object");
		}

		const Phrase = GetTranslationPhrase(strTranslationFilePath, strPhraseKey);
		if (!Phrase) {
			throw new Error(`translation key not found: ${strPhraseKey}`);
		}

		const strRequestedLanguage = (strLanguage === undefined) ? null : ResolveLanguage(strLanguage);
		const vecCandidateLanguages = [strRequestedLanguage, g_LanguageState.Default, Phrase.DefaultLanguage, g_LanguageState.Fallback];
		for (const strCandidateLanguage of vecCandidateLanguages) {
			if (strCandidateLanguage && Object.hasOwn(Phrase.Languages, strCandidateLanguage)) {
				return FormatReplacementText(Phrase.Languages[strCandidateLanguage], Tokens);
			}
		}

		throw new Error("translation language not found");
	},

	GetDefaultLanguage() {
		g_vecCallLog.push(["GetDefaultLanguage"]);

		return g_LanguageState.Default;
	},

	GetFallbackLanguage() {
		g_vecCallLog.push(["GetFallbackLanguage"]);

		return g_LanguageState.Fallback;
	},

	GetLanguage(strName) {
		g_vecCallLog.push(["GetLanguage", strName]);

		return ResolveLanguage(strName);
	},

	HasPhrase(strTranslationFilePath, strPhraseKey, strLanguage = undefined) {
		g_vecCallLog.push(["HasPhrase", strTranslationFilePath, strPhraseKey, strLanguage]);

		const Phrase = GetTranslationPhrase(strTranslationFilePath, strPhraseKey);
		if (!Phrase) {
			return false;
		}

		if (strLanguage === undefined) {
			return true;
		}

		const strLanguageCode = ResolveLanguage(strLanguage);

		return (strLanguageCode !== null) && Object.hasOwn(Phrase.Languages, strLanguageCode);
	},

	GetPhraseKeys(strTranslationFilePath) {
		g_vecCallLog.push(["GetPhraseKeys", strTranslationFilePath]);

		return Object.keys(RequireTranslationFile(strTranslationFilePath).Strings).sort();
	},

	GetLanguages() {
		g_vecCallLog.push(["GetLanguages"]);

		return { DefaultLanguage: g_LanguageState.Default, FallbackLanguage: g_LanguageState.Fallback, Languages: { ...g_LanguageState.Aliases } };
	},

	LoadFile(strTranslationFilePath) {
		g_vecCallLog.push(["LoadFile", strTranslationFilePath]);

		return CloneValue(RequireTranslationFile(strTranslationFilePath));
	},

	GetPhrase(strTranslationFilePath, strPhraseKey) {
		g_vecCallLog.push(["GetPhrase", strTranslationFilePath, strPhraseKey]);

		const Phrase = GetTranslationPhrase(strTranslationFilePath, strPhraseKey);

		return Phrase ? CloneValue(Phrase) : null;
	},

	SetDefaultLanguage(strLanguage) {
		g_vecCallLog.push(["SetDefaultLanguage", strLanguage]);

		const strSelectedLanguage = ResolveLanguage(strLanguage);
		if (!strSelectedLanguage) {
			throw new Error(`translation language not found: ${strLanguage}`);
		}

		g_LanguageState.Default = strSelectedLanguage;

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

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Translations runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Translations package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Translations runtime fixture must support exact restoration.");
	g_Assert.ok(LoaderDescriptor && LoaderDescriptor.configurable && (typeof OriginalModuleLoad === "function"), "Translations loader must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed translations cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned translations fixture property must be removable: " + strKey);
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
			value: function LoadTranslationsModule(strRequest, Parent, bIsMain) {
				const strModulePath = mapModulePaths.get(strRequest) ?? strRequest;

				return OriginalModuleLoad.call(this, strModulePath, Parent, bIsMain);
			},
		});
		bLoaderOwned = true;

		const Translations = require(g_strTranslationsPath);
		const Manager = require(g_strManagerPath);
		const Strings = require(g_strStringsPath);
		Result = { Translations, Manager, Strings };
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

			throw new AggregateError(vecFailures, "Translations fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const g_TestAPIs = LoadTestAPIs();
const g_TranslationsAPI = g_TestAPIs.Translations;
const { LANGUAGE_MANAGER, LanguageManager } = g_TestAPIs.Manager;
const { LangStrings, TranslationStrings } = g_TestAPIs.Strings;

g_Assert.equal(g_vecCallLog.length, 0, "loading facades/classes does not invoke native translation operations");
g_Assert.equal(g_TranslationsAPI, g_NativeTranslations, "translations must expose the exact native module object.");
g_Assert.deepEqual(Object.keys(g_TranslationsAPI).sort(), [
	"FormatText",
	"GetDefaultLanguage",
	"GetFallbackLanguage",
	"GetLanguage",
	"GetLanguages",
	"GetPhrase",
	"GetPhraseKeys",
	"GetText",
	"HasPhrase",
	"LoadFile",
	"SetDefaultLanguage",
], "fixture exposes current native exports, not compatibility aliases");
g_Assert.ok(!Object.hasOwn(g_TranslationsAPI, "LangStrings"), "translations root must not aggregate strings classes.");
g_Assert.ok(!Object.hasOwn(g_TranslationsAPI, "languageManager"), "translations root must not expose a manager alias.");
g_Assert.ok(!Object.hasOwn(g_TranslationsAPI, "default"), "translations root must not expose a default alias.");
g_Assert.ok(LANGUAGE_MANAGER instanceof LanguageManager, "LANGUAGE_MANAGER must be the canonical manager singleton.");
g_Assert.equal(LANGUAGE_MANAGER.DefaultLanguage, "fr", "live default language");
g_Assert.equal(LANGUAGE_MANAGER.FallbackLanguage, "en", "live fallback language");
g_Assert.equal(LANGUAGE_MANAGER.Aliases.french, "fr", "current language aliases");
g_Assert.equal(LANGUAGE_MANAGER.Has(" French "), true, "normalized known language lookup");
g_Assert.equal(LANGUAGE_MANAGER.Has("unknown"), false, "unknown language lookup");
g_Assert.equal(LANGUAGE_MANAGER.Has("toString"), false, "inherited object members are not language aliases");

LANGUAGE_MANAGER.DefaultLanguage = "English";
g_Assert.equal(LANGUAGE_MANAGER.DefaultLanguage, "en", "writable default language");

const g_TranslationFileStrings = new LangStrings("demo");
const g_GreetingStrings = g_TranslationFileStrings.Get("Greeting");
g_Assert.ok(g_GreetingStrings instanceof TranslationStrings, "LangStrings.Get() must return a live TranslationStrings view.");
g_Assert.equal(g_TranslationFileStrings.Size, 1, "live phrase count");
g_Assert.equal(g_GreetingStrings.GetString("fr", { name: "Ren" }), "Bonjour Ren", "direct formatted phrase");
g_Assert.equal(g_GreetingStrings.Tokenized({ name: "SourceJS" }).GetString("en"), "Hello SourceJS", "tokenized live phrase");
g_Assert.equal(g_GreetingStrings.Address, undefined, "translations must not fabricate native addresses.");

g_TranslationFiles.demo.Strings.Greeting.Languages.en = "Welcome {name}";
g_TranslationFiles.demo.Path = "resource/sourcejs/translations/demo_updated.ini";
g_Assert.equal(g_GreetingStrings.GetString("en", { name: "Ren" }), "Welcome Ren", "live phrase reread");
g_Assert.equal(g_TranslationFileStrings.Path, "resource/sourcejs/translations/demo_updated.ini", "live file metadata reread");
g_Assert.throws(() => new TranslationStrings("demo", "Missing"), /not found/, "missing translation view must throw.");
g_Assert.equal(g_GreetingStrings.GetString("unknown", { name: "Ren" }), "Welcome Ren", "unknown language falls back to the current default");
g_Assert.equal(g_GreetingStrings.Has("unknown"), false, "exact language membership does not use fallback");

const g_OriginalGreetingLanguages = g_TranslationFiles.demo.Strings.Greeting.Languages;

try {
	g_TranslationFiles.demo.Strings.Greeting.Languages = {};
	g_Assert.throws(() => g_GreetingStrings.GetString("unknown"), /translation language not found/, "no available text fails after exhausting all fallbacks");
} finally {
	g_TranslationFiles.demo.Strings.Greeting.Languages = g_OriginalGreetingLanguages;
}

g_Assert.equal(g_TranslationsAPI.GetPhrase("demo", "toString"), null, "inherited object members are not phrase records");
g_Assert.equal(g_TranslationsAPI.HasPhrase("demo", "Missing", 3), false, "missing phrase precedes optional language validation");
g_Assert.equal(g_TranslationsAPI.FormatText("{First}", { First: "{Second}", Second: "ready" }), "ready", "replacement order is sequential");
g_Assert.equal(g_TranslationsAPI.FormatText("{0}", [17]), "17", "arrays are valid native replacement maps");
g_Assert.equal(g_TranslationsAPI.FormatText("{name}"), "{name}", "omitted replacement map keeps text unchanged");
g_Assert.throws(() => g_TranslationsAPI.FormatText("message", undefined), /values must be an object/, "explicit undefined replacement map is invalid");
g_Assert.throws(() => g_TranslationsAPI.GetText("demo", "Greeting", undefined, undefined), /tokens must be an object/, "explicit undefined native tokens are invalid");
g_Assert.ok(!Object.hasOwn(TranslationStrings.prototype, "set"), "TranslationStrings must not expose a fake setter.");
g_Assert.ok(!Object.hasOwn(TranslationStrings.prototype, "toJSON"), "TranslationStrings must not expose snapshots.");
g_Assert.ok(!Object.hasOwn(LangStrings.prototype, "delete"), "LangStrings must not expose a fake delete operation.");
g_Assert.ok(g_vecCallLog.some((vecCall) => (vecCall[0] === "GetText") && (vecCall[1] === "demo") && (vecCall[2] === "Greeting")), "TranslationStrings must delegate reads to native GetText().");

console.log("[  OK  ] smoke_translations");
