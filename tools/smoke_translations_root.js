#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations.md");
const g_strPackagePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "translations.js");
const g_strPackageRootPath = g_Path.dirname(g_strPackagePath);
const g_strInternalRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_strManagerDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations-manager.md");
const g_strStringsDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "translations-strings.md");
const g_strTranslationRootPath = g_Path.join(g_strRepositoryRootPath, "game", "resource", "sourcejs", "translations");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_strCoreFileName = "_core/translations_strings";
const g_strInitialCommentKey = "Initial Comment";
const g_strRoundStartKey = "Round Start";

const g_LanguageState = {
	DefaultLanguage: "en",
	FallbackLanguage: "en",
	Languages: { en: "en", english: "en", ru: "ru", russian: "ru" },
};

const g_TranslationFiles = {
	[g_strCoreFileName]: {
		DefaultLanguage: "en",
		Name: g_strCoreFileName,
		Path: g_Path.join(g_strTranslationRootPath, "_core", "translations_strings.ini"),
		ServerPath: g_Path.join(g_strTranslationRootPath, "_core", "translations_strings_server.ini"),
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
	},
};

let g_unNativeOperationCount = 0;

function CopyOwnedRecord(Record) {
	return structuredClone(Record);
}

function NormalizeTranslationFileName(strTranslationFilePath) {
	if (typeof strTranslationFilePath !== "string") {
		throw new Error("file must be a string");
	}

	if (strTranslationFilePath.length === 0) {
		return g_strCoreFileName;
	}

	return strTranslationFilePath.replace(/\\/g, "/").replace(/\.ini$/i, "");
}

function GetTranslationFile(strTranslationFilePath) {
	const strNormalizedFileName = NormalizeTranslationFileName(strTranslationFilePath);
	const TranslationFile = Object.hasOwn(g_TranslationFiles, strNormalizedFileName) ? g_TranslationFiles[strNormalizedFileName] : null;
	if (TranslationFile) {
		return TranslationFile;
	}

	return { DefaultLanguage: g_LanguageState.DefaultLanguage, Name: strNormalizedFileName, Path: g_Path.join(g_strTranslationRootPath, `${strNormalizedFileName}.ini`), ServerPath: g_Path.join(g_strTranslationRootPath, `${strNormalizedFileName}_server.ini`), Strings: {} };
}

function ResolveLanguage(strName) {
	if (typeof strName !== "string") {
		throw new Error("language name must be a string");
	}

	const strNormalizedName = strName.trim().toLowerCase();

	return Object.hasOwn(g_LanguageState.Languages, strNormalizedName) ? g_LanguageState.Languages[strNormalizedName] : null;
}

function IsObjectValue(Value) {
	return (Value !== null) && ((typeof Value === "object") || (typeof Value === "function"));
}

function GetTranslationPhrase(TranslationFile, strPhraseKey) {
	return Object.hasOwn(TranslationFile.Strings, strPhraseKey) ? TranslationFile.Strings[strPhraseKey] : null;
}

function FormatReplacementText(strMessage, Values = undefined) {
	if (Values === undefined) {
		return strMessage;
	}

	if (!IsObjectValue(Values)) {
		throw new Error("values must be an object");
	}

	let strResult = strMessage;
	for (const strName of Object.keys(Values)) {
		const strPlaceholder = `{${strName}}`;
		const strReplacement = String(Values[strName]);
		strResult = strResult.split(strPlaceholder).join(strReplacement);
	}

	return strResult;
}

// Registered-record delegation fixture, not native filesystem/parser/lifecycle proof.
// Caller-defined file, phrase, language and token spellings are resource data, not API member names.
const g_NativeTranslations = {
	FormatText(strMessage, Values = undefined) {
		g_unNativeOperationCount += 1;

		if (typeof strMessage !== "string") {
			throw new Error("message must be a string");
		}

		if ((arguments.length > 1) && !IsObjectValue(Values)) {
			throw new Error("values must be an object");
		}

		return FormatReplacementText(strMessage, Values);
	},

	GetText(strTranslationFilePath, strPhraseKey, strLanguage = undefined, Tokens = undefined) {
		g_unNativeOperationCount += 1;

		if ((typeof strTranslationFilePath !== "string") || (typeof strPhraseKey !== "string")) {
			throw new Error("key must be a string");
		}

		if ((strLanguage !== undefined) && (typeof strLanguage !== "string")) {
			throw new Error("language must be a string or undefined");
		}

		if ((arguments.length > 3) && !IsObjectValue(Tokens)) {
			throw new Error("tokens must be an object");
		}

		const TranslationFile = GetTranslationFile(strTranslationFilePath);
		const TranslationPhrase = GetTranslationPhrase(TranslationFile, strPhraseKey);
		if (!TranslationPhrase) {
			throw new Error(`translation key not found: ${strPhraseKey}`);
		}

		const strRequestedLanguage = (strLanguage === undefined) ? null : ResolveLanguage(strLanguage);
		const vecCandidateLanguages = [
			strRequestedLanguage,
			g_LanguageState.DefaultLanguage,
			TranslationPhrase.DefaultLanguage,
			g_LanguageState.FallbackLanguage,
		];
		let strSelectedLanguage = null;
		for (const strCandidateLanguage of vecCandidateLanguages) {
			if ((strCandidateLanguage !== null) && Object.hasOwn(TranslationPhrase.Languages, strCandidateLanguage)) {
				strSelectedLanguage = strCandidateLanguage;
				break;
			}
		}

		if (strSelectedLanguage === null) {
			throw new Error(`translation language not found: ${String(strLanguage)}`);
		}

		return FormatReplacementText(TranslationPhrase.Languages[strSelectedLanguage], Tokens);
	},

	GetDefaultLanguage() {
		g_unNativeOperationCount += 1;

		return g_LanguageState.DefaultLanguage;
	},

	GetFallbackLanguage() {
		g_unNativeOperationCount += 1;

		return g_LanguageState.FallbackLanguage;
	},

	GetLanguage(strName) {
		g_unNativeOperationCount += 1;

		return ResolveLanguage(strName);
	},

	HasPhrase(strTranslationFilePath, strPhraseKey, strLanguage = undefined) {
		g_unNativeOperationCount += 1;

		if ((typeof strTranslationFilePath !== "string") || (typeof strPhraseKey !== "string")) {
			throw new Error("key must be a string");
		}

		const TranslationPhrase = GetTranslationPhrase(GetTranslationFile(strTranslationFilePath), strPhraseKey);
		if (!TranslationPhrase) {
			return false;
		}

		if ((strLanguage !== undefined) && (typeof strLanguage !== "string")) {
			throw new Error("language must be a string or undefined");
		}

		if (strLanguage === undefined) {
			return true;
		}

		const strSelectedLanguage = ResolveLanguage(strLanguage);

		return (strSelectedLanguage !== null) && Object.hasOwn(TranslationPhrase.Languages, strSelectedLanguage);
	},

	GetPhraseKeys(strTranslationFilePath) {
		g_unNativeOperationCount += 1;

		return Object.keys(GetTranslationFile(strTranslationFilePath).Strings).sort();
	},

	GetLanguages() {
		g_unNativeOperationCount += 1;

		return { DefaultLanguage: g_LanguageState.DefaultLanguage, FallbackLanguage: g_LanguageState.FallbackLanguage, Languages: CopyOwnedRecord(g_LanguageState.Languages) };
	},

	LoadFile(strTranslationFilePath) {
		g_unNativeOperationCount += 1;

		if ((typeof strTranslationFilePath !== "string") || (strTranslationFilePath.length === 0)) {
			throw new Error("file must be a non-empty string");
		}

		return CopyOwnedRecord(GetTranslationFile(strTranslationFilePath));
	},

	GetPhrase(strTranslationFilePath, strPhraseKey) {
		g_unNativeOperationCount += 1;

		if ((typeof strTranslationFilePath !== "string") || (typeof strPhraseKey !== "string")) {
			throw new Error("key must be a string");
		}

		const TranslationPhrase = GetTranslationPhrase(GetTranslationFile(strTranslationFilePath), strPhraseKey);

		return TranslationPhrase ? CopyOwnedRecord(TranslationPhrase) : null;
	},

	SetDefaultLanguage(strLanguage) {
		g_unNativeOperationCount += 1;

		const strSelectedLanguage = ResolveLanguage(strLanguage);
		if (strSelectedLanguage === null) {
			throw new Error(`translation language not found: ${strLanguage}`);
		}

		g_LanguageState.DefaultLanguage = strSelectedLanguage;

		return true;
	},
};

function LoadTestAPI() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const mapCachedModules = new Map();
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Translations root runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Translations root package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Translations root runtime fixture must support exact restoration.");
	g_Assert.ok(LoaderDescriptor && LoaderDescriptor.configurable && (typeof OriginalModuleLoad === "function"), "Translations root loader must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed translations root cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned translations root fixture property must be removable: " + strKey);
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
			value: function LoadTranslationsRootModule(strRequest, Parent, bIsMain) {
				return OriginalModuleLoad.call(this, (strRequest === "internal/runtime") ? g_strInternalRuntimePath : strRequest, Parent, bIsMain);
			},
		});
		bLoaderOwned = true;

		Result = require(g_strPackagePath);
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

			throw new AggregateError(vecFailures, "Translations root fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

function VerifyReplacementPropertySelection(TranslationsAPI) {
	let unGetterReadCount = 0;
	const Tokens = Object.create({ Inherited: "not selected" });
	Object.defineProperties(Tokens, {
		Visible: {
			enumerable: true,
			get() {
				g_Assert.equal(this, Tokens, "enumerable token getters retain their original receiver");
				++unGetterReadCount;

				return "selected";
			},
		},
		Hidden: {
			enumerable: false,
			get() {
				throw new Error("Non-enumerable token getters must not run.");
			},
		},
	});
	Object.defineProperty(Tokens, Symbol("Hidden"), {
		enumerable: true,
		get() {
			throw new Error("Symbol token getters must not run.");
		},
	});

	const strTemplate = "{Visible}/{Hidden}/{Inherited}";
	const strExpectedText = "selected/{Hidden}/{Inherited}";
	g_Assert.equal(TranslationsAPI.FormatText(strTemplate, Tokens), strExpectedText, "formatting selects only own enumerable string keys");
	g_Assert.equal(unGetterReadCount, 1, "only the visible getter runs during formatting");

	const PhraseLanguages = g_TranslationFiles[g_strCoreFileName].Strings[g_strInitialCommentKey].Languages;
	const strOriginalText = PhraseLanguages.en;
	try {
		PhraseLanguages.en = strTemplate;
		g_Assert.equal(TranslationsAPI.GetText(g_strCoreFileName, g_strInitialCommentKey, "english", Tokens), strExpectedText, "phrase replacement uses the same property-selection contract");
		g_Assert.equal(unGetterReadCount, 2, "each operation reads the visible token once");
	} finally {
		PhraseLanguages.en = strOriginalText;
	}
}

function CollectDocumentedExports(strDocumentation) {
	const vecSections = strDocumentation.replace(/\r\n/g, "\n").split("## Exports\n");
	g_Assert.equal(vecSections.length, 2, "documentation contains exactly one Exports section");

	const strSection = vecSections[1].split("\n## ")[0];
	const vecMatches = [...strSection.matchAll(/^\| \x60([^\x60]+)\x60 \|/gm)];
	const vecExports = vecMatches.map((vecMatch) => vecMatch[1].replace(/\(.*$/, ""));

	return vecExports.sort();
}

function RunDocumentationBlock(strSourceCode, unIndex, TranslationsAPI) {
	const unBlockNumber = unIndex + 1;
	const DocumentationContext = g_VM.createContext({
		require(strIdentifier) {
			if (strIdentifier === "translations") {
				return TranslationsAPI;
			}

			throw new Error(`Unexpected documentation import: ${strIdentifier}`);
		},
	});

	const strDefaultLanguageBefore = g_LanguageState.DefaultLanguage;
	const unOperationCountBefore = g_unNativeOperationCount;

	g_VM.runInContext(strSourceCode, DocumentationContext, { filename: `${g_strDocumentationPath}:example-${unBlockNumber}.js`, timeout: g_unDocumentationTimeoutMilliseconds });

	g_Assert.equal(g_unNativeOperationCount, unOperationCountBefore, `block ${unBlockNumber} calls no native API while loading`);
	g_Assert.equal(g_LanguageState.DefaultLanguage, strDefaultLanguageBefore, `block ${unBlockNumber} preserves default while loading`);

	return DocumentationContext;
}

const g_TranslationsAPI = LoadTestAPI();
g_Assert.equal(g_TranslationsAPI, g_NativeTranslations, "translations preserves native object identity");
g_Assert.equal(g_unNativeOperationCount, 0, "loading the facade performs no native operation");
g_Assert.deepEqual(Object.keys(g_TranslationsAPI).sort(), [
	"FormatText",
	"GetText",
	"GetDefaultLanguage",
	"GetFallbackLanguage",
	"GetLanguage",
	"HasPhrase",
	"GetPhraseKeys",
	"GetLanguages",
	"LoadFile",
	"GetPhrase",
	"SetDefaultLanguage",
].sort(), "exact translations exports");
g_Assert.equal(Object.hasOwn(g_TranslationsAPI, "LangStrings"), false, "root does not aggregate string classes");
g_Assert.equal(Object.hasOwn(g_TranslationsAPI, "languageManager"), false, "root does not expose a manager alias");
g_Assert.equal(Object.hasOwn(g_TranslationsAPI, "default"), false, "root does not expose a default alias");

const g_Registry = g_TranslationsAPI.GetLanguages();
g_Assert.deepEqual(Object.keys(g_Registry).sort(), ["DefaultLanguage", "FallbackLanguage", "Languages"], "language registry shape");
g_Assert.equal(g_Registry.DefaultLanguage, "en", "default language");
g_Assert.equal(g_Registry.FallbackLanguage, "en", "fallback language");
g_Assert.equal(g_Registry.Languages.russian, "ru", "language alias mapping");
g_Assert.equal(g_TranslationsAPI.GetLanguage(" Russian "), "ru", "normalized language lookup");
g_Assert.equal(g_TranslationsAPI.GetLanguage("unknown"), null, "unknown language lookup");
g_Registry.Languages.english = "ru";
g_Assert.equal(g_TranslationsAPI.GetLanguage("english"), "en", "registry records own their data");

g_Assert.equal(g_TranslationsAPI.SetDefaultLanguage("russian"), true, "set default language");
g_Assert.equal(g_TranslationsAPI.GetDefaultLanguage(), "ru", "current default override");

const g_strFallbackMessage = g_TranslationsAPI.GetText(g_strCoreFileName, g_strRoundStartKey, "unknown", { round: 2 });
g_Assert.equal(g_strFallbackMessage, "Round 2 has started.", "selection falls through to phrase default");
g_Assert.equal(g_TranslationsAPI.SetDefaultLanguage("english"), true, "direct test default-language reset result");

const g_TranslationFile = g_TranslationsAPI.LoadFile(g_strCoreFileName);
const g_TranslationPhrase = g_TranslationsAPI.GetPhrase(g_strCoreFileName, g_strInitialCommentKey);
const g_vecTranslationFileKeys = Object.keys(g_TranslationFile).sort();
const g_vecTranslationPhraseKeys = Object.keys(g_TranslationPhrase).sort();

g_Assert.deepEqual(g_vecTranslationFileKeys, ["DefaultLanguage", "Name", "Path", "ServerPath", "Strings"], "translation file shape");
g_Assert.deepEqual(g_vecTranslationPhraseKeys, ["DefaultLanguage", "Languages", "Name"], "translation phrase shape");
g_Assert.deepEqual(g_TranslationsAPI.GetPhraseKeys(g_strCoreFileName), [g_strInitialCommentKey, g_strRoundStartKey], "sorted phrase keys");
g_Assert.equal(g_TranslationsAPI.HasPhrase(g_strCoreFileName, g_strInitialCommentKey), true, "phrase membership");
g_Assert.equal(g_TranslationsAPI.HasPhrase(g_strCoreFileName, g_strInitialCommentKey, "russian"), true, "exact language membership");
g_Assert.equal(g_TranslationsAPI.HasPhrase(g_strCoreFileName, g_strRoundStartKey, "russian"), false, "missing exact language membership");
g_Assert.equal(g_TranslationsAPI.GetPhrase(g_strCoreFileName, "Missing"), null, "missing phrase result");

const g_CorePhraseFromEmptyFile = g_TranslationsAPI.GetPhrase("", g_strInitialCommentKey);
const g_vecCoreKeysFromEmptyFile = g_TranslationsAPI.GetPhraseKeys("");

g_Assert.equal(g_CorePhraseFromEmptyFile.Name, g_strInitialCommentKey, "empty read file selects the core translation file");
g_Assert.deepEqual(g_vecCoreKeysFromEmptyFile, [g_strInitialCommentKey, g_strRoundStartKey], "empty key list selects the core file");
g_Assert.throws(() => g_TranslationsAPI.LoadFile(""), Error, "load requires a non-empty file name");

g_TranslationFile.Strings[g_strInitialCommentKey].Languages.en = "Changed local record";

const g_strNativeTextAfterLocalEdit = g_TranslationsAPI.GetText(g_strCoreFileName, g_strInitialCommentKey, "en", { filename: "plugin.ini" });
g_Assert.notEqual(g_strNativeTextAfterLocalEdit, "Changed local record", "file records own their data");

const g_strOriginalTranslationText = g_TranslationFiles[g_strCoreFileName].Strings[g_strInitialCommentKey].Languages.en;

try {
	g_TranslationFiles[g_strCoreFileName].Strings[g_strInitialCommentKey].Languages.en = "Updated {filename}.";

	const strUpdatedTranslationText = g_TranslationsAPI.GetText(g_strCoreFileName, g_strInitialCommentKey, "en", { filename: "plugin.ini" });
	g_Assert.equal(strUpdatedTranslationText, "Updated plugin.ini.", "later calls observe current file data");
} finally {
	g_TranslationFiles[g_strCoreFileName].Strings[g_strInitialCommentKey].Languages.en = g_strOriginalTranslationText;
}

const g_strFormattedMessage = g_TranslationsAPI.FormatText("{name}/{name}/{missing}", { name: "SourceJS" });
g_Assert.equal(g_strFormattedMessage, "SourceJS/SourceJS/{missing}", "all known placeholders are replaced");

// Fixture-defined phrase/token keys and the external __proto__ property keep exact spelling.
const g_HostileTokens = Object.create(null);
g_HostileTokens.__proto__ = "safe";
g_Assert.equal(g_TranslationsAPI.FormatText("{__proto__}", g_HostileTokens), "safe", "own hostile token names are data");
g_Assert.throws(() => g_TranslationsAPI.GetText(g_strCoreFileName, "Missing"), /not found/, "missing key error");
g_Assert.throws(() => g_TranslationsAPI.GetText(g_strCoreFileName, g_strInitialCommentKey, 1), Error, "strict language type");
g_Assert.throws(() => g_TranslationsAPI.FormatText("message", null), Error, "strict format values");
g_Assert.throws(() => g_TranslationsAPI.SetDefaultLanguage("unknown"), /not found/, "unknown default language");

g_Assert.equal(g_TranslationsAPI.FormatText("unchanged {Token}"), "unchanged {Token}", "omitted replacement map leaves the template unchanged");
g_Assert.throws(() => g_TranslationsAPI.FormatText("message", undefined), /values must be an object/, "explicit undefined replacement map is invalid");
g_Assert.throws(() => g_TranslationsAPI.GetText(g_strCoreFileName, g_strInitialCommentKey, undefined, undefined), /tokens must be an object/, "explicit undefined token argument is invalid");
g_Assert.equal(g_TranslationsAPI.HasPhrase(g_strCoreFileName, "Missing", 3), false, "missing phrase returns false before optional language validation");
g_Assert.equal(g_TranslationsAPI.GetPhrase(g_strCoreFileName, "toString"), null, "inherited object members are not phrase records");
g_Assert.equal(g_TranslationsAPI.GetLanguage("toString"), null, "inherited object members are not language aliases");

const g_CallableTokens = function TokenValues() {
};
g_CallableTokens.Name = "callable";
g_Assert.equal(g_TranslationsAPI.FormatText("{Name}", g_CallableTokens), "callable", "callable objects are valid replacement maps");
g_Assert.equal(g_TranslationsAPI.FormatText("{0}", [17]), "17", "arrays are valid replacement maps");
g_Assert.equal(g_TranslationsAPI.FormatText("{First}", { First: "{Second}", Second: "sequential" }), "sequential", "later tokens can replace earlier inserted placeholders");

VerifyReplacementPropertySelection(g_TranslationsAPI);

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
g_Assert.match(g_strDocumentation, /own enumerable string property names/, "documentation states the pinned native property-selection contract");
g_Assert.match(g_strDocumentation, /Non-enumerable properties, symbol keys, and inherited properties are not replacement names/, "documentation excludes hidden, symbol and inherited token keys");

const g_CodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecCodeBlocks = [];
let g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
while (g_vecCodeBlockMatch !== null) {
	g_vecCodeBlocks.push(g_vecCodeBlockMatch[1]);
	g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
}

g_Assert.equal(g_vecCodeBlocks.length, 6, "all translations documentation JavaScript blocks are present");

const g_vecDocumentationContexts = [];
for (let unBlockIndex = 0; unBlockIndex < g_vecCodeBlocks.length; unBlockIndex += 1) {
	g_vecDocumentationContexts.push(RunDocumentationBlock(g_vecCodeBlocks[unBlockIndex], unBlockIndex, g_TranslationsAPI));
}

const g_LanguageInspection = g_vecDocumentationContexts[1].InspectLanguageRegistry(" Russian ");
const g_MissingLanguageInspection = g_vecDocumentationContexts[1].InspectLanguageRegistry("missing");

g_Assert.equal(g_LanguageInspection.ResolvedLanguage, "ru", "language workflow resolves a trimmed full name");
g_Assert.equal(g_LanguageInspection.Registered, true, "language workflow reports registration");
g_Assert.equal(g_LanguageInspection.DefaultMatchesRegistry, true, "language workflow cross-checks the default");
g_Assert.equal(g_LanguageInspection.FallbackMatchesRegistry, true, "language workflow cross-checks the fallback");
g_Assert.equal(g_MissingLanguageInspection.ResolvedLanguage, null, "language workflow preserves unknown null");

const g_DefaultChange = g_vecDocumentationContexts[2].ConfigureDefaultLanguage("russian");
const g_DefaultChangeRecord = { Changed: g_DefaultChange.Changed, CurrentLanguage: g_DefaultChange.CurrentLanguage, PreviousLanguage: g_DefaultChange.PreviousLanguage };
g_Assert.deepEqual(g_DefaultChangeRecord, { Changed: true, CurrentLanguage: "ru", PreviousLanguage: "en" }, "default-language workflow reports the process-wide change");
g_Assert.equal(g_LanguageState.DefaultLanguage, "ru", "default-language workflow leaves the selected override active");
g_Assert.throws(function ConfigureMissingDefaultLanguage() {
	g_vecDocumentationContexts[2].ConfigureDefaultLanguage("missing");
}, /Unknown configured language/, "default-language workflow rejects an unknown name");

g_Assert.equal(g_TranslationsAPI.SetDefaultLanguage("english"), true, "documentation test default-language reset result");

const g_FileInspection = g_vecDocumentationContexts[3].InspectTranslationFile(g_strCoreFileName, g_strInitialCommentKey, "russian");
const g_vecFileInspectionPhraseKeys = [];
for (const strPhraseKey of g_FileInspection.PhraseKeys) {
	g_vecFileInspectionPhraseKeys.push(strPhraseKey);
}

g_Assert.equal(g_FileInspection.File.Name, g_strCoreFileName, "file workflow returns parsed file metadata");
g_Assert.deepEqual(g_vecFileInspectionPhraseKeys, [g_strInitialCommentKey, g_strRoundStartKey], "file workflow returns sorted keys");
g_Assert.equal(g_FileInspection.PhraseRecord.Name, g_strInitialCommentKey, "file workflow returns the requested phrase");
g_Assert.equal(g_FileInspection.HasPhrase, true, "file workflow reports phrase membership");
g_Assert.equal(g_FileInspection.HasExactLanguage, true, "file workflow reports exact-language membership");

const g_MissingFileInspection = g_vecDocumentationContexts[3].InspectTranslationFile(g_strCoreFileName, "Missing", "english");
g_Assert.equal(g_MissingFileInspection.PhraseRecord, null, "file workflow preserves missing phrase null");
g_Assert.equal(g_MissingFileInspection.HasPhrase, false, "file workflow preserves missing phrase membership");
g_Assert.equal(g_MissingFileInspection.HasExactLanguage, false, "file workflow preserves missing exact-language membership");

const g_MissingFileWithoutLanguage = g_vecDocumentationContexts[3].InspectTranslationFile(g_strCoreFileName, "Missing");
g_Assert.equal(g_MissingFileWithoutLanguage.PhraseRecord, null, "missing workflow without a language preserves the null record");
g_Assert.equal(g_MissingFileWithoutLanguage.HasPhrase, false, "missing workflow without a language preserves false membership");
g_Assert.equal(g_MissingFileWithoutLanguage.HasExactLanguage, undefined, "omitted language does not request an exact-language check");

const g_PhraseContext = g_vecDocumentationContexts[4];
const g_FormattingContext = g_vecDocumentationContexts[5];
const g_strRequiredTranslation = g_PhraseContext.GetRequiredTranslation(g_strCoreFileName, g_strRoundStartKey, "english", { round: 3 });
const g_strCaptureNotice = g_FormattingContext.FormatCaptureNotice("Ren", "the checkpoint", 5);

g_Assert.equal(g_strRequiredTranslation, "Round 3 has started.", "phrase workflow formats selected text");
g_Assert.throws(function GetMissingRequiredTranslation() {
	g_PhraseContext.GetRequiredTranslation(g_strCoreFileName, "Missing", "english");
}, /Missing translation phrase/, "phrase workflow distinguishes a missing key");
g_Assert.equal(g_strCaptureNotice, "Ren captured the checkpoint; Ren scored 5.", "formatting workflow replaces repeated tokens");
g_Assert.equal(g_LanguageState.DefaultLanguage, "en", "documentation verification restores the visible default language");

g_Assert.deepEqual(CollectDocumentedExports(g_strDocumentation), Object.keys(g_NativeTranslations).sort(), "exact documented native translation exports");

g_Assert.doesNotMatch(g_strDocumentation, /console\.(?:log|warn|error)/, "translations examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by/, "translations documentation is hand-maintained");
g_Assert.equal(g_FileSystem.existsSync(g_strManagerDocumentationPath), true, "translations/manager documentation exists");
g_Assert.equal(g_FileSystem.existsSync(g_strStringsDocumentationPath), true, "translations/strings documentation exists");

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntime = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strPackagePath)});`], {
	encoding: "utf8",
	timeout: g_unMissingRuntimeTimeoutMilliseconds,
	env: {
		...process.env,
		NODE_PATH: g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs"),
	},
});
g_Assert.equal(g_MissingRuntime.error, undefined, "missing runtime probe launches and finishes before its timeout");
g_Assert.equal(g_MissingRuntime.signal, null, "missing runtime probe is not terminated");
g_Assert.equal(g_MissingRuntime.status, 1, "translations requires the native runtime");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_translations_root");
