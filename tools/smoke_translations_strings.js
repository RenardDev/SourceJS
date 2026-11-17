#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations-strings.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strStringsPath = g_Path.join(g_strPackageRootPath, "translations", "strings.js");
const g_strConfigurationCVarPath = g_Path.join(g_strPackageRootPath, "config", "cvar.js");
const g_strTranslationsPath = g_Path.join(g_strPackageRootPath, "translations.js");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strRootDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations.md");
const g_strManagerDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations-manager.md");
const g_strFileName = "_core/translations_strings";
const g_strInitialCommentKey = "Initial Comment";
const g_strRoundStartKey = "Round Start";

const g_CallCounts = { GetText: 0, HasPhrase: 0, GetPhraseKeys: 0, LoadFile: 0, GetPhrase: 0 };

// Keep the resource's token names and external language codes exact.
const g_FileState = {
	DefaultLanguage: "en",
	Name: g_strFileName,
	Path: "game/resource/sourcejs/translations/_core/translations_strings.ini",
	ServerPath: "game/resource/sourcejs/translations/_core/translations_strings_server.ini",
	Strings: {
		[g_strInitialCommentKey]: {
			DefaultLanguage: "en",
			Languages: { en: "Server specific translations for {filename}.", ru: "Server translation: {filename}." },
			Name: g_strInitialCommentKey,
		},
		[g_strRoundStartKey]: {
			DefaultLanguage: "en",
			Languages: { en: "Round {round} has started." },
			Name: g_strRoundStartKey,
		},
	},
};

const g_LanguageAliases = { en: "en", english: "en", ru: "ru", russian: "ru" };

function GetTotalCallCount() {
	let unTotalCallCount = 0;
	for (const strOperationName of Object.keys(g_CallCounts)) {
		unTotalCallCount += g_CallCounts[strOperationName];
	}

	return unTotalCallCount;
}

function CopyOwnedValue(Value) {
	return structuredClone(Value);
}

function RequireFile(strRequestedFileName) {
	if (strRequestedFileName !== g_strFileName) {
		throw new Error(`Unexpected translation fixture file: ${strRequestedFileName}`);
	}

	return g_FileState;
}

function ResolveLanguage(strLanguageName) {
	if (strLanguageName === undefined) {
		return g_FileState.DefaultLanguage;
	}

	if (typeof strLanguageName !== "string") {
		throw new TypeError("language must be a string or undefined");
	}

	const strNormalizedLanguageName = strLanguageName.trim().toLowerCase();

	return Object.hasOwn(g_LanguageAliases, strNormalizedLanguageName) ? g_LanguageAliases[strNormalizedLanguageName] : null;
}

function GetTranslationPhrase(strFileName, strKey) {
	const Phrases = RequireFile(strFileName).Strings;

	return Object.hasOwn(Phrases, strKey) ? Phrases[strKey] : null;
}

function FormatText(strMessage, Tokens) {
	let strFormattedText = strMessage;
	for (const strTokenName of Object.keys(Tokens)) {
		strFormattedText = strFormattedText.split(`{${strTokenName}}`).join(String(Tokens[strTokenName]));
	}

	return strFormattedText;
}

// Delegation model for the registered fixture, not native file IO or language fallback.
const g_NativeTranslations = {
	GetText(strFileName, strKey, strLanguage = undefined, Tokens = {}) {
		g_CallCounts.GetText += 1;

		const Phrase = GetTranslationPhrase(strFileName, strKey);
		if (!Phrase) {
			throw new Error(`translation key not found: ${strKey}`);
		}

		if ((Tokens === null) || ((typeof Tokens !== "object") && (typeof Tokens !== "function"))) {
			throw new TypeError("tokens must be an object");
		}

		const strSelectedLanguage = ResolveLanguage(strLanguage);
		const strLanguageText = (strSelectedLanguage === null) ? undefined : Phrase.Languages[strSelectedLanguage];
		if (strLanguageText === undefined) {
			throw new Error(`translation language not found: ${String(strLanguage)}`);
		}

		return FormatText(strLanguageText, Tokens);
	},

	HasPhrase(strFileName, strKey, strLanguage = undefined) {
		g_CallCounts.HasPhrase += 1;

		const Phrase = GetTranslationPhrase(strFileName, strKey);
		if (!Phrase) {
			return false;
		}

		if (strLanguage === undefined) {
			return true;
		}

		const strSelectedLanguage = ResolveLanguage(strLanguage);

		return (strSelectedLanguage !== null) && Object.hasOwn(Phrase.Languages, strSelectedLanguage);
	},

	GetPhraseKeys(strFileName) {
		g_CallCounts.GetPhraseKeys += 1;

		return Object.keys(RequireFile(strFileName).Strings).sort();
	},

	LoadFile(strFileName) {
		g_CallCounts.LoadFile += 1;

		return CopyOwnedValue(RequireFile(strFileName));
	},

	GetPhrase(strFileName, strKey) {
		g_CallCounts.GetPhrase += 1;

		const Phrase = GetTranslationPhrase(strFileName, strKey);

		return Phrase ? CopyOwnedValue(Phrase) : null;
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

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Translations/strings runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Translations/strings package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Translations/strings runtime fixture must support exact restoration.");
	g_Assert.ok(LoaderDescriptor && LoaderDescriptor.configurable && (typeof OriginalModuleLoad === "function"), "Translations/strings loader must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed translations/strings cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned translations/strings fixture property must be removable: " + strKey);
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
			value: function LoadTranslationsStringsModule(strRequest, Parent, bIsMain) {
				const strModulePath = mapModulePaths.get(strRequest) ?? strRequest;

				return OriginalModuleLoad.call(this, strModulePath, Parent, bIsMain);
			},
		});
		bLoaderOwned = true;

		const NativeModule = require(g_strTranslationsPath);
		g_Assert.equal(NativeModule, g_NativeTranslations, "translations facade preserves native identity");
		g_Assert.deepEqual(Object.keys(NativeModule).sort(), ["GetPhrase", "GetPhraseKeys", "GetText", "HasPhrase", "LoadFile"], "model exposes only current native functions");

		Result = { Strings: require(g_strStringsPath), Configuration: require(g_strConfigurationCVarPath) };
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

			throw new AggregateError(vecFailures, "Translations/strings fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const g_TestAPIs = LoadTestAPIs();
const g_StringsAPI = g_TestAPIs.Strings;
const g_ConfigurationAPI = g_TestAPIs.Configuration;

function RequireDocumentationModule(strIdentifier) {
	if (strIdentifier === "translations/strings") {
		return g_StringsAPI;
	}

	throw new Error(`Unexpected documentation import: ${strIdentifier}`);
}

function CollectDocumentedMemberNames(strDocumentation, strClassName) {
	const vecSections = strDocumentation.replace(/\r\n/g, "\n").split(`## ${strClassName}\n`);
	g_Assert.equal(vecSections.length, 2, `exactly one ${strClassName} documentation section is required`);

	const strSection = vecSections[1].split("\n## ")[0];
	const vecMatches = [...strSection.matchAll(/^\| \x60([^\x60]+)\x60 \| (?:field|getter|method) \|/gm)];
	const vecMemberNames = vecMatches.map((vecMatch) => vecMatch[1].replace(/\(.*$/, ""));

	return vecMemberNames.sort();
}

function VerifyDirectFileTokenForwarding(StringsAPI, strFileName, strPhraseName) {
	const FileView = new StringsAPI.LangStrings(strFileName);
	const PhraseView = new StringsAPI.TranslationStrings(strFileName, strPhraseName);
	for (const Tokens of [[], () => undefined]) {
		let unTokenReadCount = 0;
		Object.defineProperty(Tokens, "round", {
			enumerable: true,
			get() {
				g_Assert.equal(this, Tokens, "native token reads retain the forwarded receiver");
				unTokenReadCount += 1;

				return 3;
			},
		});
		Object.defineProperty(Tokens, "Hidden", {
			enumerable: false,
			get() {
				throw new Error("Non-enumerable forwarded token getters must not run.");
			},
		});

		g_Assert.equal(FileView.GetString(strPhraseName, "english", Tokens), "Round 3 has started.", "file views forward array/function tokens and native formatting selects enumerable names only");
		g_Assert.equal(unTokenReadCount, 1, "the original token getter is read once");
		g_Assert.throws(() => PhraseView.GetString("english", Tokens), /Tokens must be an object/, "phrase views retain their stricter token contract");
		g_Assert.equal(unTokenReadCount, 1, "phrase token validation precedes native formatting");
	}
}

function RunDocumentationBlock(strSourceCode, unBlockIndex) {
	const unDocumentationTimeoutMilliseconds = 1000;
	const DocumentationContext = g_VM.createContext({ require: RequireDocumentationModule });
	const unCallCountBefore = GetTotalCallCount();
	const strPathBefore = g_FileState.Path;
	const strEnglishTextBefore = g_FileState.Strings[g_strInitialCommentKey].Languages.en;

	g_VM.runInContext(strSourceCode, DocumentationContext, { filename: `${g_strDocumentationPath}#example-${unBlockIndex + 1}`, timeout: unDocumentationTimeoutMilliseconds });

	const strEnglishTextAfter = g_FileState.Strings[g_strInitialCommentKey].Languages.en;

	g_Assert.equal(GetTotalCallCount(), unCallCountBefore, `example ${unBlockIndex + 1} performs no native parse during load`);
	g_Assert.equal(g_FileState.Path, strPathBefore, `example ${unBlockIndex + 1} preserves file metadata during load`);
	g_Assert.equal(strEnglishTextAfter, strEnglishTextBefore, `example ${unBlockIndex + 1} preserves phrase text during load`);

	return DocumentationContext;
}

g_Assert.deepEqual(Object.keys(g_StringsAPI).sort(), ["LangStrings", "TranslationStrings"], "exact translations/strings exports");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_StringsAPI.LangStrings.prototype).sort(), [
	"Data",
	"DefaultLanguage",
	"Entries",
	"ForEach",
	"Get",
	"GetString",
	"Has",
	"Keys",
	"Name",
	"Path",
	"ServerPath",
	"Size",
	"Values",
	"constructor",
], "exact LangStrings members");
g_Assert.equal(typeof g_StringsAPI.LangStrings.prototype[Symbol.iterator], "function", "LangStrings iterator");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_StringsAPI.TranslationStrings.prototype).sort(), [
	"DefaultLanguage",
	"Entries",
	"GetString",
	"Has",
	"Keys",
	"Languages",
	"Name",
	"Record",
	"Size",
	"Tokenized",
	"Values",
	"constructor",
], "exact TranslationStrings members");
g_Assert.equal(typeof g_StringsAPI.TranslationStrings.prototype[Symbol.iterator], "function", "TranslationStrings iterator");
g_Assert.equal(Object.hasOwn(g_StringsAPI, "default"), false, "default alias is absent");

const g_FileStrings = new g_StringsAPI.LangStrings(g_strFileName);
g_Assert.equal(g_FileStrings.File, g_strFileName, "file identity");
g_Assert.equal(g_FileStrings.DefaultLanguage, "en", "file default language");
g_Assert.equal(g_FileStrings.Path, g_FileState.Path, "file main path");
g_Assert.equal(g_FileStrings.ServerPath, g_FileState.ServerPath, "file server path");
g_Assert.equal(g_FileStrings.Size, 2, "file phrase count");
g_Assert.deepEqual(g_FileStrings.Keys(), [g_strInitialCommentKey, g_strRoundStartKey], "file phrase Keys");
g_Assert.equal(g_FileStrings.Has(g_strInitialCommentKey), true, "file phrase membership");
g_Assert.equal(g_FileStrings.Has(g_strInitialCommentKey, "russian"), true, "file exact-language membership");
g_Assert.equal(g_FileStrings.Has(g_strRoundStartKey, "russian"), false, "missing exact language");
g_Assert.equal(g_FileStrings.Has("Missing"), false, "missing file phrase");
g_Assert.equal(g_FileStrings.Get("Missing"), null, "missing phrase view");

const g_strDirectPhraseText = g_FileStrings.GetString(g_strInitialCommentKey, "english", { filename: "plugin.ini" });
g_Assert.equal(g_strDirectPhraseText, "Server specific translations for plugin.ini.", "file direct phrase formatting");

const g_PhraseStrings = g_FileStrings.Get(g_strInitialCommentKey);
g_Assert.ok(g_PhraseStrings instanceof g_StringsAPI.TranslationStrings, "file Get returns a phrase view");
g_Assert.equal(g_PhraseStrings.File, g_strFileName, "phrase file identity");
g_Assert.equal(g_PhraseStrings.Key, g_strInitialCommentKey, "phrase key identity");
g_Assert.equal(g_PhraseStrings.Name, g_strInitialCommentKey, "phrase name");
g_Assert.equal(g_PhraseStrings.DefaultLanguage, "en", "phrase default language");
g_Assert.equal(g_PhraseStrings.Size, 2, "phrase language count");
g_Assert.deepEqual(g_PhraseStrings.Keys().sort(), ["en", "ru"], "phrase language Keys");
g_Assert.deepEqual(g_PhraseStrings.Values().sort(), ["Server specific translations for {filename}.", "Server translation: {filename}."].sort(), "phrase language Values");

const g_vecExpectedPhraseEntries = Object.entries(g_FileState.Strings[g_strInitialCommentKey].Languages).sort();
const g_vecIteratedPhraseEntries = [];
for (const vecLanguageEntry of g_PhraseStrings) {
	g_vecIteratedPhraseEntries.push(vecLanguageEntry);
}

g_Assert.deepEqual(g_PhraseStrings.Entries().sort(), g_vecExpectedPhraseEntries, "phrase language Entries");
g_Assert.deepEqual(g_vecIteratedPhraseEntries.sort(), g_PhraseStrings.Entries().sort(), "phrase iterator");
g_Assert.equal(g_PhraseStrings.Has("english"), true, "phrase exact-language membership");
g_Assert.equal(g_PhraseStrings.Has("unknown"), false, "phrase missing language");

const g_strFormattedPhraseText = g_PhraseStrings.GetString("english", { filename: "rules.ini" });
const g_vecFileEntries = g_FileStrings.Entries();
const g_vecFileValues = g_FileStrings.Values();
const g_vecFileEntryKeys = [];
const g_vecIteratedFileKeys = [];
for (const [strPhraseName, PhraseView] of g_vecFileEntries) {
	g_vecFileEntryKeys.push(strPhraseName);
	g_Assert.ok(PhraseView instanceof g_StringsAPI.TranslationStrings, `file entry view: ${strPhraseName}`);
}

for (const PhraseView of g_vecFileValues) {
	g_Assert.ok(PhraseView instanceof g_StringsAPI.TranslationStrings, "file value view");
}

for (const [strPhraseName] of g_FileStrings) {
	g_vecIteratedFileKeys.push(strPhraseName);
}

g_Assert.equal(g_strFormattedPhraseText, "Server specific translations for rules.ini.", "phrase direct formatting");
g_Assert.deepEqual(g_vecFileEntryKeys, [g_strInitialCommentKey, g_strRoundStartKey], "file entry Keys");
g_Assert.deepEqual(g_vecIteratedFileKeys, [g_strInitialCommentKey, g_strRoundStartKey], "file iterator");

const g_unKeysBeforeMeasuredEntries = g_CallCounts.GetPhraseKeys;
const g_unPhrasesBeforeMeasuredEntries = g_CallCounts.GetPhrase;

g_FileStrings.Entries();
g_Assert.equal(g_CallCounts.GetPhraseKeys - g_unKeysBeforeMeasuredEntries, 1, "Entries performs one key parse");
g_Assert.equal(g_CallCounts.GetPhrase - g_unPhrasesBeforeMeasuredEntries, 2, "Entries validates every current phrase view");

const g_vecVisitedPhrases = [];
const g_vecVisitedPhraseNames = [];
const g_IterationReceiver = { Marker: "receiver" };
const g_ForEachResult = g_FileStrings.ForEach(function VisitPhrase(PhraseView, strPhraseName, File) {
	g_vecVisitedPhrases.push({ Collection: File, PhraseName: strPhraseName, PhraseView, Receiver: this });
}, g_IterationReceiver);

g_Assert.equal(g_vecVisitedPhrases.length, 2, "ForEach visit count");

for (const PhraseVisit of g_vecVisitedPhrases) {
	g_Assert.equal(PhraseVisit.Receiver, g_IterationReceiver, "ForEach this argument");
	g_Assert.ok(PhraseVisit.PhraseView instanceof g_StringsAPI.TranslationStrings, "ForEach value");
	g_Assert.equal(PhraseVisit.Collection, g_FileStrings, "ForEach collection");
	g_vecVisitedPhraseNames.push(PhraseVisit.PhraseName);
}

g_Assert.deepEqual(g_vecVisitedPhraseNames, [g_strInitialCommentKey, g_strRoundStartKey], "ForEach Keys");
g_Assert.equal(g_ForEachResult, undefined, "ForEach return value");

{
	const vecVisits = [];
	const Receiver = { Marker: "intrinsic callback invocation" };
	const VisitPhrase = function VisitPhrase(PhraseView, strPhraseName, Collection) {
		vecVisits.push({ Collection, PhraseName: strPhraseName, PhraseView, Receiver: this });
	};
	for (const strInvocationPropertyName of ["call", "apply"]) {
		Object.defineProperty(VisitPhrase, strInvocationPropertyName, {
			get() {
				throw new Error(`LangStrings.ForEach() must not read callback.${strInvocationPropertyName}.`);
			},
		});
	}

	g_Assert.equal(g_FileStrings.ForEach(VisitPhrase, Receiver), undefined, "intrinsic callback iteration returns undefined");
	g_Assert.deepEqual(vecVisits.map((Visit) => Visit.PhraseName), [g_strInitialCommentKey, g_strRoundStartKey], "intrinsic invocation preserves key order");
	for (const Visit of vecVisits) {
		g_Assert.equal(Visit.Receiver, Receiver, "intrinsic invocation preserves callback receiver");
		g_Assert.equal(Visit.Collection, g_FileStrings, "intrinsic invocation preserves collection argument");
		g_Assert.ok(Visit.PhraseView instanceof g_StringsAPI.TranslationStrings, "intrinsic invocation preserves phrase-view argument");
	}

	for (const CallbackFailure of [null, undefined, new Error("opaque callback failure")]) {
		let bThrown = false;
		let CaughtFailure;
		let unVisitCount = 0;

		try {
			g_FileStrings.ForEach(() => {
				unVisitCount += 1;
				throw CallbackFailure;
			});
		} catch (Failure) {
			bThrown = true;
			CaughtFailure = Failure;
		}

		g_Assert.equal(bThrown, true, "opaque callback failure propagates");
		g_Assert.equal(CaughtFailure, CallbackFailure, "opaque callback failure retains exact identity");
		g_Assert.equal(unVisitCount, 1, "opaque callback failure stops later visits");
	}
}

const g_unCallsBeforeInvalidCallback = GetTotalCallCount();

g_Assert.throws(function InvokeInvalidForEachCallback() {
	g_FileStrings.ForEach(null);
}, TypeError, "ForEach callback validation");
g_Assert.equal(GetTotalCallCount(), g_unCallsBeforeInvalidCallback, "invalid ForEach callback performs no native parse");

const g_BaseTokens = { filename: "first.ini" };
const g_TokenizedPhrase = new g_StringsAPI.TranslationStrings(g_strFileName, g_strInitialCommentKey, g_BaseTokens);
const g_ServerPhrase = g_TokenizedPhrase.Tokenized({ filename: "server.ini" });

g_Assert.equal(g_TokenizedPhrase.Tokens, g_BaseTokens, "base token object is retained by identity");
g_BaseTokens.filename = "second.ini";

const g_strMutatedBaseText = g_TokenizedPhrase.GetString("english");
const g_strCallOverrideText = g_TokenizedPhrase.GetString("english", { filename: "call.ini" });
const g_strTokenizedText = g_ServerPhrase.GetString("english");

g_Assert.equal(g_strMutatedBaseText, "Server specific translations for second.ini.", "base token mutations are observed");
g_Assert.equal(g_strCallOverrideText, "Server specific translations for call.ini.", "per-call tokens override base tokens");
g_Assert.equal(g_strTokenizedText, "Server specific translations for server.ini.", "Tokenized view owns merged tokens");
g_Assert.equal(g_TokenizedPhrase.Tokens.filename, "second.ini", "Tokenized leaves the source view unchanged");

const g_SharedTokenValue = { Value: "shared" };
const g_ShallowTokenPhrase = new g_StringsAPI.TranslationStrings(g_strFileName, g_strInitialCommentKey, { Shared: g_SharedTokenValue });
const g_ShallowTokenCopy = g_ShallowTokenPhrase.Tokenized({});
g_Assert.equal(g_ShallowTokenCopy.Tokens.Shared, g_SharedTokenValue, "Tokenized copies object-valued tokens shallowly");

for (const Value of [null, [], "replacement", 42]) {
	const PhraseView = new g_StringsAPI.TranslationStrings(g_strFileName, g_strInitialCommentKey);
	PhraseView.Tokens = Value;
	g_Assert.equal(PhraseView.GetString("english", { filename: "replacement.ini" }), "Server specific translations for replacement.ini.", "replacing the public base field does not revalidate it");

	const TokenizedView = PhraseView.Tokenized({ filename: "tokenized.ini" });
	g_Assert.equal(TokenizedView.GetString("english"), "Server specific translations for tokenized.ini.", "Tokenized validates the overlay and merged object, not the replaced base field");
}

const g_PrototypeTokenOverrides = JSON.parse('{"__proto__":"token.ini"}');
const g_PrototypeTokenPhrase = g_TokenizedPhrase.Tokenized(g_PrototypeTokenOverrides);
g_Assert.equal(Object.hasOwn(g_PrototypeTokenPhrase.Tokens, "__proto__"), true, "token merging preserves an own __proto__ key");
g_Assert.equal(g_PrototypeTokenPhrase.Tokens.__proto__, "token.ini", "reserved token keys remain ordinary data");
g_Assert.equal(Object.getPrototypeOf(g_PrototypeTokenPhrase.Tokens), Object.prototype, "token keys do not replace the merged record prototype");

const g_PrototypeTokenLanguageRecord = RequireFile(g_strFileName).Strings[g_strInitialCommentKey].Languages;
const g_strOriginalPrototypeTokenText = g_PrototypeTokenLanguageRecord.en;

try {
	g_PrototypeTokenLanguageRecord.en = "File {__proto__}.";
	g_Assert.equal(g_TokenizedPhrase.GetString("english", g_PrototypeTokenOverrides), "File token.ini.", "GetString retains reserved per-call token keys");
} finally {
	g_PrototypeTokenLanguageRecord.en = g_strOriginalPrototypeTokenText;
}

g_Assert.equal(g_ConfigurationAPI.ResolveConfigText(g_ServerPhrase), "Server specific translations for server.ini.", "config text resolves a real translation view through GetText");

const g_TranslatedConfigurationEntry = new g_ConfigurationAPI.CVarConfigEntry("sourcejs_translation_example", 1, g_ServerPhrase);
g_Assert.deepEqual(g_TranslatedConfigurationEntry.Description, ["Server specific translations for server.ini."], "config descriptions use the current translation API");
g_Assert.equal(g_TranslatedConfigurationEntry.RenderConfigEntry({ CommentPrefix: "//" })[0], "// Server specific translations for server.ini.", "translated configuration rendering");

g_Assert.throws(function ConstructMissingPhrase() {
	new g_StringsAPI.TranslationStrings(g_strFileName, "Missing");
}, /not found/, "missing phrase construction");
g_Assert.throws(function ConstructWithArrayTokens() {
	new g_StringsAPI.TranslationStrings(g_strFileName, g_strInitialCommentKey, []);
}, TypeError, "constructor token validation");
g_Assert.throws(function GetStringWithArrayTokens() {
	g_PhraseStrings.GetString("english", []);
}, TypeError, "GetString token validation");
g_Assert.throws(function TokenizeWithNullTokens() {
	g_PhraseStrings.Tokenized(null);
}, TypeError, "Tokenized validation");

const g_strOriginalPath = g_FileState.Path;
const g_strOriginalEnglishText = g_FileState.Strings[g_strInitialCommentKey].Languages.en;

try {
	g_FileState.Path = "game/resource/sourcejs/translations/_core/updated.ini";
	g_FileState.Strings[g_strInitialCommentKey].Languages.en = "Updated {filename}.";

	const strUpdatedPhraseText = g_PhraseStrings.GetString("english", { filename: "plugin.ini" });
	g_Assert.equal(g_FileStrings.Path, g_FileState.Path, "file metadata is reread");
	g_Assert.equal(strUpdatedPhraseText, "Updated plugin.ini.", "phrase text is reread");
} finally {
	g_FileState.Path = g_strOriginalPath;
	g_FileState.Strings[g_strInitialCommentKey].Languages.en = g_strOriginalEnglishText;
}

g_Assert.equal(g_NativeTranslations.GetPhrase(g_strFileName, "toString"), null, "registered phrase lookup excludes inherited object members");
g_Assert.equal(g_FileStrings.Has("toString"), false, "file membership excludes inherited object members");
g_Assert.equal(g_FileStrings.Get("toString"), null, "file lookup excludes inherited object members");
g_Assert.throws(() => g_FileStrings.GetString("toString", "english"), /not found/, "file text lookup excludes inherited object members");
g_Assert.equal(ResolveLanguage("constructor"), null, "language lookup excludes inherited aliases");
g_Assert.equal(ResolveLanguage("__proto__"), null, "language lookup excludes inherited prototype aliases");

g_Assert.equal(g_PhraseStrings.Address, undefined, "phrase views do not fabricate addresses");
g_Assert.equal(Object.hasOwn(g_StringsAPI.TranslationStrings.prototype, "set"), false, "phrase setter is absent");
g_Assert.equal(Object.hasOwn(g_StringsAPI.TranslationStrings.prototype, "toJSON"), false, "phrase serialization helper is absent");
g_Assert.equal(Object.hasOwn(g_StringsAPI.LangStrings.prototype, "delete"), false, "file delete helper is absent");
g_Assert.equal(g_CallCounts.LoadFile > 1, true, "file getters reread through native LoadFile");
g_Assert.equal(g_CallCounts.GetPhrase > 1, true, "phrase getters reread through native GetPhrase");
g_Assert.equal(g_CallCounts.GetText > 1, true, "text reads delegate to native GetText");

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
g_Assert.match(g_strDocumentation, /with object spread/, "documentation describes the current token-copy mechanism");
g_Assert.doesNotMatch(g_strDocumentation, /with `Object\.assign`/, "documentation must not teach the old prototype-sensitive token copy");

const g_CodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecCodeBlocks = [];
let g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
while (g_vecCodeBlockMatch !== null) {
	g_vecCodeBlocks.push(g_vecCodeBlockMatch[1]);
	g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
}

g_Assert.equal(g_vecCodeBlocks.length, 6, "all translations/strings documentation JavaScript blocks are present");

const g_vecDocumentationContexts = [];
for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecCodeBlocks.length; unCodeBlockIndex += 1) {
	g_vecDocumentationContexts.push(RunDocumentationBlock(g_vecCodeBlocks[unCodeBlockIndex], unCodeBlockIndex));
}

const g_FileInspection = g_vecDocumentationContexts[1].InspectTranslationFileView(g_strFileName);
const g_vecInspectedFileKeys = [];
for (const strPhraseName of g_FileInspection.Keys) {
	g_vecInspectedFileKeys.push(strPhraseName);
}

g_Assert.equal(g_FileInspection.File, g_strFileName, "file inspection preserves identity");
g_Assert.equal(g_FileInspection.Data.Name, g_strFileName, "file inspection returns current data");
g_Assert.equal(g_FileInspection.DefaultLanguage, "en", "file inspection returns the default");
g_Assert.equal(g_FileInspection.Path, g_FileState.Path, "file inspection returns the main path");
g_Assert.equal(g_FileInspection.ServerPath, g_FileState.ServerPath, "file inspection returns the server path");
g_Assert.equal(g_FileInspection.Size, 2, "file inspection returns the phrase count");
g_Assert.deepEqual(g_vecInspectedFileKeys, [g_strInitialCommentKey, g_strRoundStartKey], "file inspection returns current Keys");

const g_PhraseRead = g_vecDocumentationContexts[2].ReadFilePhrase(g_strFileName, g_strRoundStartKey, "english", { round: 3 });
g_Assert.equal(g_PhraseRead.PhraseAvailable, true, "file read reports phrase membership");
g_Assert.equal(g_PhraseRead.ExactLanguageAvailable, true, "file read reports exact-language membership");
g_Assert.ok(g_PhraseRead.PhraseView instanceof g_StringsAPI.TranslationStrings, "file read returns a reusable phrase view");
g_Assert.equal(g_PhraseRead.Text, "Round 3 has started.", "file read formats selected text");

const g_MissingRead = g_vecDocumentationContexts[2].ReadFilePhrase(g_strFileName, "Missing", "english");
g_Assert.equal(g_MissingRead.PhraseView, null, "file read preserves a missing view");
g_Assert.equal(g_MissingRead.PhraseAvailable, false, "file read preserves missing membership");
g_Assert.equal(g_MissingRead.ExactLanguageAvailable, false, "file read preserves missing language membership");
g_Assert.equal(g_MissingRead.Text, null, "file read skips native GetText for a missing phrase");

const g_MissingReadWithoutLanguage = g_vecDocumentationContexts[2].ReadFilePhrase(g_strFileName, "Missing");
g_Assert.equal(g_MissingReadWithoutLanguage.PhraseView, null, "missing phrase without a language has no view");
g_Assert.equal(g_MissingReadWithoutLanguage.PhraseAvailable, false, "missing phrase without a language is absent");
g_Assert.equal(g_MissingReadWithoutLanguage.ExactLanguageAvailable, undefined, "omitted language preserves an undefined membership result");
g_Assert.equal(g_MissingReadWithoutLanguage.Text, null, "missing phrase without a language skips text selection");

let g_unSynchronousVisitCount = 0;
g_Assert.equal(g_FileStrings.ForEach(() => {
	++g_unSynchronousVisitCount;

	return false;
}), undefined, "ForEach ignores callback return values");
g_Assert.equal(g_unSynchronousVisitCount, 2, "false does not stop ForEach iteration");

const g_ExpectedCallbackError = new Error("Translation callback failed.");
g_unSynchronousVisitCount = 0;
g_Assert.throws(() => g_FileStrings.ForEach(() => {
	++g_unSynchronousVisitCount;
	throw g_ExpectedCallbackError;
}), (CallbackError) => CallbackError === g_ExpectedCallbackError, "ForEach preserves callback error identity");
g_Assert.equal(g_unSynchronousVisitCount, 1, "callback exceptions stop the remaining visits");

g_unSynchronousVisitCount = 0;
g_Assert.equal(g_FileStrings.ForEach(() => {
	++g_unSynchronousVisitCount;

	return Promise.resolve(true);
}), undefined, "ForEach does not return or await callback promises");
g_Assert.equal(g_unSynchronousVisitCount, 2, "promise callbacks are called synchronously");

const g_CollectionReport = g_vecDocumentationContexts[3].CollectTranslationFileViews(g_strFileName);
const g_vecCollectionEntryKeys = [];
const g_vecCollectionIteratorKeys = [];
const g_vecVisitedCollectionKeys = [];
for (const [strPhraseName] of g_CollectionReport.Entries) {
	g_vecCollectionEntryKeys.push(strPhraseName);
}

for (const [strPhraseName] of g_CollectionReport.IteratedEntries) {
	g_vecCollectionIteratorKeys.push(strPhraseName);
}

for (const PhraseView of g_CollectionReport.Values) {
	g_Assert.ok(PhraseView instanceof g_StringsAPI.TranslationStrings, "value workflow returns a phrase view");
}

for (const PhraseVisit of g_CollectionReport.Visited) {
	g_vecVisitedCollectionKeys.push(PhraseVisit.PhraseName);
	g_Assert.ok(PhraseVisit.PhraseView instanceof g_StringsAPI.TranslationStrings, "ForEach workflow passes a phrase view");
	g_Assert.equal(PhraseVisit.SameCollection, true, "ForEach workflow passes the source collection");
}

g_Assert.deepEqual(g_vecCollectionEntryKeys, [g_strInitialCommentKey, g_strRoundStartKey], "entry workflow preserves key order");
g_Assert.deepEqual(g_vecCollectionIteratorKeys, [g_strInitialCommentKey, g_strRoundStartKey], "iterator workflow preserves key order");
g_Assert.deepEqual(g_vecVisitedCollectionKeys, [g_strInitialCommentKey, g_strRoundStartKey], "ForEach workflow visits every key");

const g_PhraseInspectionTokens = { filename: "rules.ini" };
const g_PhraseInspection = g_vecDocumentationContexts[4].InspectTranslationPhraseView(g_strFileName, g_strInitialCommentKey, "russian", g_PhraseInspectionTokens);
g_Assert.equal(g_PhraseInspection.File, g_strFileName, "phrase inspection preserves file identity");
g_Assert.equal(g_PhraseInspection.Key, g_strInitialCommentKey, "phrase inspection preserves key identity");
g_Assert.equal(g_PhraseInspection.Name, g_strInitialCommentKey, "phrase inspection returns the current name");
g_Assert.equal(g_PhraseInspection.DefaultLanguage, "en", "phrase inspection returns the current default");
g_Assert.equal(g_PhraseInspection.HasLanguage, true, "phrase inspection checks exact language membership");
g_Assert.equal(g_PhraseInspection.Size, 2, "phrase inspection returns the language count");

const g_vecPhraseInspectionKeys = [];
const g_vecPhraseInspectionValues = [];
const g_vecExpectedPhraseInspectionValues = Object.values(g_FileState.Strings[g_strInitialCommentKey].Languages);
for (const strLanguageName of g_PhraseInspection.Keys) {
	g_vecPhraseInspectionKeys.push(strLanguageName);
}

for (const strLanguageText of g_PhraseInspection.Values) {
	g_vecPhraseInspectionValues.push(strLanguageText);
}

g_vecPhraseInspectionKeys.sort();
g_vecPhraseInspectionValues.sort();
g_vecExpectedPhraseInspectionValues.sort();

g_Assert.deepEqual(g_vecPhraseInspectionKeys, ["en", "ru"], "phrase inspection returns language Keys");
g_Assert.deepEqual(g_vecPhraseInspectionValues, g_vecExpectedPhraseInspectionValues, "phrase inspection returns language Values");
g_Assert.equal(g_PhraseInspection.Text, "Server translation: rules.ini.", "phrase inspection formats current text");
g_Assert.ok(g_PhraseInspection.View instanceof g_StringsAPI.TranslationStrings, "phrase inspection returns a reusable view");

const g_DocumentationBaseTokens = { filename: "base.ini" };
const g_DocumentationInitialTokens = { filename: "server.ini" };
const g_TokenController = g_vecDocumentationContexts[5].CreateTokenizedPhraseController(g_strFileName, g_strInitialCommentKey, g_DocumentationBaseTokens, g_DocumentationInitialTokens);
g_Assert.equal(g_TokenController.BaseView.Tokens, g_DocumentationBaseTokens, "token controller retains the base object");
g_Assert.notEqual(g_TokenController.TokenizedView.Tokens, g_DocumentationBaseTokens, "Tokenized view owns a merged object");
g_DocumentationBaseTokens.filename = "changed.ini";

const g_RetainedTokenRead = g_TokenController.Read("english");
g_Assert.equal(g_RetainedTokenRead.BaseText, "Server specific translations for changed.ini.", "controller read observes live base tokens");
g_Assert.equal(g_RetainedTokenRead.TokenizedText, "Server specific translations for server.ini.", "controller read retains copied Tokenized Values");

const g_PerCallTokenRead = g_TokenController.Read("english", { filename: "call.ini" });
g_Assert.equal(g_PerCallTokenRead.BaseText, "Server specific translations for call.ini.", "per-call tokens override live base tokens");
g_Assert.equal(g_PerCallTokenRead.TokenizedText, "Server specific translations for call.ini.", "per-call tokens override copied Tokenized Values");
g_Assert.equal(g_FileState.Path, g_strOriginalPath, "documentation workflows preserve file metadata");
g_Assert.equal(g_FileState.Strings[g_strInitialCommentKey].Languages.en, g_strOriginalEnglishText, "documentation workflows preserve phrase text");

for (const strExportName of Object.keys(g_StringsAPI)) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

for (const strClassName of ["LangStrings", "TranslationStrings"]) {
	const ClassType = g_StringsAPI[strClassName];
	const StringsView = (strClassName === "LangStrings") ? new ClassType(g_strFileName) : new ClassType(g_strFileName, g_strInitialCommentKey);
	const vecPrototypeNames = Reflect.ownKeys(ClassType.prototype).filter((MemberName) => MemberName !== "constructor").map((MemberName) => (typeof MemberName === "symbol") ? "[Symbol.iterator]" : MemberName);
	const vecExpectedMemberNames = [...Object.keys(StringsView), ...vecPrototypeNames].sort();
	g_Assert.deepEqual(CollectDocumentedMemberNames(g_strDocumentation, strClassName), vecExpectedMemberNames, `exact documented ${strClassName} fields, getters, methods and iterator`);

	for (const strMemberName of Object.getOwnPropertyNames(g_StringsAPI[strClassName].prototype)) {
		if (strMemberName === "constructor") {
			continue;
		}

		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `documentation covers ${strClassName}.${strMemberName}`);
	}
}

g_Assert.match(g_strDocumentation, /Symbol\.iterator/, "documentation covers both iterators");
g_Assert.doesNotMatch(g_strDocumentation, /console\.(?:log|warn|error)/, "translations/strings examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by/, "translations/strings documentation is hand-maintained");
g_Assert.equal(g_FileSystem.existsSync(g_strRootDocumentationPath), true, "translations documentation exists");
g_Assert.equal(g_FileSystem.existsSync(g_strManagerDocumentationPath), true, "translations/manager documentation exists");

const g_unRuntimeCheckTimeoutMilliseconds = 5000;
const g_MissingRuntime = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strStringsPath)});`], {
	encoding: "utf8",
	timeout: g_unRuntimeCheckTimeoutMilliseconds,
	env: {
		...process.env,
		NODE_PATH: g_strPackageRootPath,
	},
});
g_Assert.equal(g_MissingRuntime.error, undefined, "missing-runtime subprocess starts and completes before its timeout");
g_Assert.equal(g_MissingRuntime.signal, null, "missing-runtime subprocess is not terminated by a signal");
g_Assert.equal(g_MissingRuntime.status, 1, "translations/strings requires the native runtime");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

VerifyDirectFileTokenForwarding(g_StringsAPI, g_strFileName, g_strRoundStartKey);

console.log("[  OK  ] smoke_translations_strings");
