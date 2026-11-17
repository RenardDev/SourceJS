#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_translation_native_contracts.js\nChecks source contracts only; does not execute live V8 or engine code.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_translation_native_contracts.js");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecBoundaries = [
	{ Name: "FormatTranslationText", Frame: "TranslationFormattingFailure", Error: "kFormattingErrorMessage" },
	{ Name: "MakeTranslationLanguageStateObject", Frame: "TranslationLanguageStateBuildFailure", Error: "kLanguageStateBuildErrorMessage" },
	{ Name: "MakeTranslationPhraseObject", Frame: "TranslationPhraseBuildFailure", Error: "kOperationErrorMessage", Guards: 2 },
	{ Name: "MakeTranslationFileObject", Frame: "TranslationFileBuildFailure", Error: "kOperationErrorMessage", Guards: 3 },
	{ Name: "GetLanguagesCallback", Frame: "TranslationLanguagesFailure", Error: "kOperationErrorMessage", Guards: 1 },
	{ Name: "GetLanguageCallback", Frame: "TranslationLanguageFailure", Error: "kOperationErrorMessage", Guards: 1 },
	{ Name: "GetDefaultLanguageCallback", Frame: "TranslationDefaultLanguageFailure", Error: "kOperationErrorMessage", Guards: 1 },
	{ Name: "GetFallbackLanguageCallback", Frame: "TranslationFallbackLanguageFailure", Error: "kOperationErrorMessage", Guards: 1 },
	{ Name: "SetDefaultLanguageCallback", Frame: "TranslationDefaultLanguageUpdateFailure", Error: "kOperationErrorMessage", Guards: 0 },
	{ Name: "LoadFileCallback", Frame: "TranslationFileLoadFailure", Error: "kOperationErrorMessage", Guards: 1 },
	{ Name: "GetPhraseCallback", Frame: "TranslationPhraseFailure", Error: "kOperationErrorMessage", Guards: 1 },
	{ Name: "GetPhraseKeysCallback", Frame: "TranslationPhraseKeysFailure", Error: "kOperationErrorMessage", Guards: 3 },
	{ Name: "GetTextCallback", Frame: "TranslationTextFailure", Error: "kOperationErrorMessage", Guards: 2 },
	{ Name: "HasPhraseCallback", Frame: "TranslationFailure", Error: "kFailureErrorMessage", Guards: 1 },
	{ Name: "FormatTextCallback", Frame: "TranslationFailure", Error: "kFailureErrorMessage", Guards: 3 },
	{ Name: "InstallTranslationsFunctions", Frame: "TranslationFailure", Error: "kFailureErrorMessage", Guards: 4, Result: "false" },
];
const g_vecHasPhraseSentinels = [
	{ Condition: "itPhrase == TranslationFileData.m_mapPhrases.end()", Result: "false" },
	{ Condition: "CallbackInformation.Length() <= kLanguageAliasArgumentIndex", Result: "true" },
	{ Condition: "LocalLanguageAliasValue->IsUndefined()", Result: "true" },
	{ Condition: "strRequestedLanguageCode.empty()", Result: "false" },
];

let g_unRejectedMutationCount = 0;

function GetRawDefinition(strSource, strName) {
	const strEscapedName = strName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const strNameToken = strName + "(";
	const HeaderPattern = new RegExp("^(\\t{1,2})(?:void|bool|std::string|std::filesystem::path|TranslationLanguageState|TranslationFile|v8::Local<v8::Object>) " + strEscapedName + "\\([^\\n;{}]*\\)(?: noexcept)? \\{$");
	const vecMatches = [];
	let nCandidateIndex = strSource.indexOf(strNameToken);
	while (nCandidateIndex >= 0) {
		const unLineStart = strSource.lastIndexOf("\n", nCandidateIndex) + 1;
		const nLineEnd = strSource.indexOf("\n", nCandidateIndex);
		const unLineEnd = (nLineEnd < 0) ? strSource.length : nLineEnd;
		const vecCandidate = HeaderPattern.exec(strSource.slice(unLineStart, unLineEnd));
		if (vecCandidate) {
			vecMatches.push({ Index: unLineStart, Indentation: vecCandidate[1], HeaderLength: vecCandidate[0].length });
		}

		nCandidateIndex = strSource.indexOf(strNameToken, unLineEnd);
	}

	g_Assert.equal(vecMatches.length, 1, "Expected exactly one real native definition: " + strName);
	const Definition = vecMatches[0];
	const ClosingPattern = new RegExp("^" + Definition.Indentation + "\\}$", "gm");
	ClosingPattern.lastIndex = Definition.Index + Definition.HeaderLength;
	const vecClosing = ClosingPattern.exec(strSource);
	g_Assert(vecClosing && (vecClosing.index > Definition.Index), "Missing native definition closing brace: " + strName);

	return strSource.slice(Definition.Index, vecClosing.index + vecClosing[0].length);
}

function GetDefinition(strSource, strName) {
	const strActualDefinition = GetRawDefinition(strSource, strName);
	const bNested = strActualDefinition.startsWith("\t\t");
	const strDefinition = bNested ? strActualDefinition.replace(/^\t(?![ \t]*#)/gm, "") : strActualDefinition;
	g_Assert.equal(bNested ? strDefinition.replace(/^\t(?![ \t]*#)/gm, "\t\t") : strDefinition, strActualDefinition, "Source-check normalization must preserve the complete actual definition.");

	return strDefinition;
}

function CheckDefinitionExtraction() {
	for (const strIndentation of ["\t", "\t\t"]) {
		const strPrototype = strIndentation + "bool Probe(int nValue); // signature marker ) {\n";
		const strUnrelated = strIndentation + "bool Other(int nValue) {\n" + strIndentation + "\treturn Probe(nValue);\n" + strIndentation + "}\n";
		const strDefinition = strIndentation + "bool Probe(int nValue) noexcept {\n#if defined(SOURCEJS_EXTRACTOR_TEST)\n" + strIndentation + "\treturn true;\n#else\n" + strIndentation + "\treturn false;\n#endif\n" + strIndentation + "}";
		g_Assert.equal(GetRawDefinition(strPrototype + strUnrelated + strDefinition + "\n", "Probe"), strDefinition, "Ignore prototypes, comments, and unrelated calls.");
		const strNormalizedDefinition = (strIndentation === "\t\t") ? strDefinition.replace(/^\t/gm, "") : strDefinition;
		g_Assert.equal(GetDefinition(strDefinition + "\n", "Probe"), strNormalizedDefinition, "Namespace normalization preserves preprocessor lines.");
		const strIndentedDefinition = strDefinition.replace(/^#/gm, "\t#");
		g_Assert.equal(GetDefinition(strIndentedDefinition + "\n", "Probe"), strNormalizedDefinition.replace(/^#/gm, "\t#"), "Preserve preprocessor indentation even outside the function-body indentation.");

		const strEmptyDefinition = strIndentation + "bool Probe() {\n" + strIndentation + "\treturn true;\n" + strIndentation + "}";
		g_Assert.equal(GetRawDefinition(strEmptyDefinition + "\n", "Probe"), strEmptyDefinition);
		g_Assert.throws(() => GetRawDefinition(strPrototype + strUnrelated, "Probe"), { code: "ERR_ASSERTION" });
		g_Assert.throws(() => GetRawDefinition(strDefinition + "\n" + strDefinition + "\n", "Probe"), { code: "ERR_ASSERTION" });
	}
}

function CheckContracts(strSource) {
	for (const Boundary of g_vecBoundaries) {
		const strDefinition = GetDefinition(strSource, Boundary.Name);
		const strRethrow = "RethrowV8InstallationFailure(pIsolate, " + Boundary.Frame + ", ";
		const nFrame = strDefinition.indexOf("v8::TryCatch " + Boundary.Frame + "(pIsolate);\n\t\ttry {");
		g_Assert(nFrame >= 0, Boundary.Name + ": frame survives native unwinding.");
		g_Assert(!strDefinition.slice(0, nFrame).includes(strRethrow));

		for (const strCatchType of ["std::exception const&", "..."]) {
			g_Assert(strDefinition.includes("} catch (" + strCatchType + ") {\n\t\t\t" + strRethrow + Boundary.Error + ");"));
		}

		if (!strDefinition.startsWith("\tvoid ")) {
			g_Assert(strDefinition.endsWith("\n\n\t\treturn " + (Boundary.Result ?? "{}") + ";\n\t}"), Boundary.Name + ": defined native-failure result.");
		}

		if (Boundary.Guards !== undefined) {
			g_Assert.doesNotMatch(strDefinition, /ValueToString\(/);
			g_Assert.equal(strDefinition.split(Boundary.Frame + ".HasCaught()").length - 1, Boundary.Guards);
			g_Assert.equal(strDefinition.split("pIsolate->IsExecutionTerminating()").length - 1, Boundary.Guards);
			g_Assert.equal(strDefinition.split("pIsolate->HasPendingException()").length - 1, Boundary.Guards);
		}

		// The local setter returns checked status to its owning V8 boundary, rather than rethrowing independently.
		const strProtectedBody = strDefinition.slice(nFrame).replace(/^\t{3}auto const (?:DefineString|DefineFunction) = [^\n]+\{\n[\s\S]*?^\t{3}\};/gm, "");
		for (const vecGuardMatch of strProtectedBody.matchAll(/^(\t{3,})if \([^\n]+\) \{\n((?:\1\t[^\n]*\n)+)\1\}/gm)) {
			if (/return(?: \{\}| false)?;/.test(vecGuardMatch[0])) {
				if (Boundary.Name === "HasPhraseCallback") {
					const Sentinel = g_vecHasPhraseSentinels.find(Entry => vecGuardMatch[0].includes("if (" + Entry.Condition + ")"));
					if (Sentinel) {
						g_Assert.equal(vecGuardMatch[2], vecGuardMatch[1] + "\tCallbackInformation.GetReturnValue().Set(" + Sentinel.Result + ");\n" + vecGuardMatch[1] + "\treturn;\n", "Only the exact successful phrase/language decision bypasses rethrow.");
						continue;
					}
				}

				const bValidMissingResult = ((Boundary.Name === "GetLanguageCallback") && vecGuardMatch[0].includes("if (strLanguageCode.empty())")) || ((Boundary.Name === "GetPhraseCallback") && vecGuardMatch[0].includes("if (itPhrase == TranslationFileData.m_mapPhrases.end())"));
				if (bValidMissingResult) {
					g_Assert.equal(vecGuardMatch[2], vecGuardMatch[1] + "\tCallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));\n" + vecGuardMatch[1] + "\treturn;\n", "Only the exact successful missing-value sentinel bypasses rethrow.");
					continue;
				}

				g_Assert(vecGuardMatch[0].includes(strRethrow), Boundary.Name + ": preserve each guarded error.");
			}
		}
	}

	const strHasPhrase = GetDefinition(strSource, "HasPhraseCallback");
	for (const Sentinel of g_vecHasPhraseSentinels) {
		g_Assert(strHasPhrase.includes("if (" + Sentinel.Condition + ") {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(" + Sentinel.Result + ");\n\t\t\t\treturn;\n\t\t\t}"));
	}

	g_Assert.equal(strHasPhrase.split("ReadTranslationString(").length - 1, 3);
	g_Assert(strHasPhrase.indexOf("if (itPhrase == TranslationFileData.m_mapPhrases.end())") < strHasPhrase.indexOf("LocalLanguageAliasValue ="), "A missing phrase does not validate the optional language.");
	g_Assert(strHasPhrase.includes("RethrowV8InstallationFailure(pIsolate, TranslationFailure, kLanguageAliasArgumentErrorMessage);"));

	const strFormatText = GetDefinition(strSource, "FormatTextCallback");
	const nDelegatedFormat = strFormatText.indexOf("= FormatTranslationText(");
	const nDelegatedGuard = strFormatText.indexOf("if (TranslationFailure.HasCaught()", nDelegatedFormat);
	const nTextString = strFormatText.indexOf("= MakeString(pIsolate, strFormattedText)", nDelegatedFormat);
	g_Assert((nDelegatedFormat >= 0) && (nDelegatedGuard > nDelegatedFormat) && (nTextString > nDelegatedGuard));
	g_Assert(strFormatText.includes("ReadTranslationString(pIsolate, LocalMessageTemplateValue, TranslationFailure, strMessageTemplate)"));

	const strInstall = GetDefinition(strSource, "InstallTranslationsFunctions");
	g_Assert.doesNotMatch(strInstall, /SetFunction\(|->Set\(/);
	g_Assert(strInstall.includes("v8::Function::New(LocalContext, Callback, LocalRuntimeData).ToLocal(&LocalFunction)"));
	g_Assert(strInstall.includes("LocalTranslationsObject->CreateDataProperty(LocalContext, LocalFunctionName, LocalFunction).FromMaybe(false)"));
	g_Assert(strInstall.includes("return bFunctionInstalled && !TranslationFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException();"));
	g_Assert.deepEqual([...strInstall.matchAll(/if \(!DefineFunction\("([^"]+)", (\w+)\)\)/g)].map(vecMatch => [vecMatch[1], vecMatch[2]]), [
		["FormatText", "FormatTextCallback"],
		["GetLanguages", "GetLanguagesCallback"],
		["GetLanguage", "GetLanguageCallback"],
		["GetDefaultLanguage", "GetDefaultLanguageCallback"],
		["SetDefaultLanguage", "SetDefaultLanguageCallback"],
		["GetFallbackLanguage", "GetFallbackLanguageCallback"],
		["LoadFile", "LoadFileCallback"],
		["GetText", "GetTextCallback"],
		["HasPhrase", "HasPhraseCallback"],
		["GetPhraseKeys", "GetPhraseKeysCallback"],
		["GetPhrase", "GetPhraseCallback"],
	]);

	const strRead = GetDefinition(strSource, "ReadTranslationString");
	g_Assert(strRead.includes("v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalValue);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	g_Assert.doesNotMatch(strRead, /ValueToString\(|\.c_str\(|noexcept/);
	g_Assert.equal(strRead.split("TranslationFailure.HasCaught()").length - 1, 2);
	g_Assert(strRead.includes("!pszEncodedValue || TranslationFailure.HasCaught()"));
	g_Assert(strRead.includes("std::string(pszEncodedValue, static_cast<std::size_t>(UTF8Value.length()))"));
	g_Assert(strRead.includes("strValueOut.swap(strParsedValue);"));

	const strDefineValue = GetDefinition(strSource, "DefineTranslationValueProperty");
	g_Assert.equal(strDefineValue.split("TranslationFailure.HasCaught()").length - 1, 3);
	g_Assert(strDefineValue.includes("MakeString(pIsolate, strName)"));
	g_Assert(strDefineValue.includes("LocalObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert(strDefineValue.includes("return bValueSet && !TranslationFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException();"));

	const strDefineString = GetDefinition(strSource, "DefineTranslationStringProperty");
	g_Assert.equal(strDefineString.split("TranslationFailure.HasCaught()").length - 1, 2);
	g_Assert(strDefineString.includes("MakeString(pIsolate, strValue)"));
	g_Assert(strDefineString.includes("return DefineTranslationValueProperty(pIsolate, LocalContext, LocalObject, strName, LocalValue, TranslationFailure);"));

	for (const Helper of [{ Name: "ReadTranslationString", Guards: 2 }, { Name: "DefineTranslationValueProperty", Guards: 3 }, { Name: "DefineTranslationStringProperty", Guards: 2 }]) {
		const strDefinition = GetDefinition(strSource, Helper.Name);
		g_Assert.equal(strDefinition.split("pIsolate->IsExecutionTerminating()").length - 1, Helper.Guards);
		g_Assert.equal(strDefinition.split("pIsolate->HasPendingException()").length - 1, Helper.Guards);
	}

	for (const strName of ["MakeTranslationPhraseObject", "MakeTranslationFileObject"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert.doesNotMatch(strDefinition, /\.c_str\(|SetString\(|SetValue\(|->Set\(/);
		g_Assert(strDefinition.includes("DefineTranslationStringProperty("));
		g_Assert(strDefinition.includes("DefineTranslationValueProperty("));
	}

	g_Assert(GetDefinition(strSource, "MakeTranslationPhraseObject").includes("LanguageTextEntry.first, LanguageTextEntry.second, TranslationPhraseBuildFailure"));
	g_Assert(GetDefinition(strSource, "MakeTranslationFileObject").includes("LocalPhrasesObject, PhraseEntry.first, LocalPhraseObject, TranslationFileBuildFailure"));

	const strSetDefault = GetDefinition(strSource, "SetDefaultLanguageCallback");
	g_Assert(strSetDefault.includes("g_strTranslationsDefaultLanguageCode.swap(strLanguageCode);"));
	g_Assert(strSetDefault.indexOf("g_bIsTranslationsDefaultLanguageOverridden = true;") > strSetDefault.indexOf("g_strTranslationsDefaultLanguageCode.swap("));
	g_Assert.doesNotMatch(strSetDefault, /g_strTranslationsDefaultLanguageCode =/);
	g_Assert(strSetDefault.includes("TranslationDefaultLanguageUpdateFailure, kLanguageResolutionErrorMessage);"));

	const strKeys = GetDefinition(strSource, "GetPhraseKeysCallback");
	g_Assert(strKeys.includes("if (unPhraseCount > kMaximumV8ArrayLength)"));
	g_Assert(strKeys.includes("kMaximumV8ArrayLength = static_cast<std::size_t>(std::numeric_limits<int>::max());"));
	g_Assert(strKeys.includes("LocalPhraseKeysArray->CreateDataProperty(LocalContext, unPhraseKeyIndex, LocalPhraseKeyString).FromMaybe(false)"));
	g_Assert(strKeys.includes("if (!bPhraseKeySet || TranslationPhraseKeysFailure.HasCaught()"));
	g_Assert(strKeys.includes("MakeString(pIsolate, PhraseEntry.first)"));

	const strText = GetDefinition(strSource, "GetTextCallback");
	const nFormat = strText.indexOf("= FormatTranslationText(");
	const nFormatGuard = strText.indexOf("if (TranslationTextFailure.HasCaught()", nFormat);
	const nFormattedString = strText.indexOf("= MakeString(pIsolate, strFormattedText)", nFormat);
	g_Assert((nFormat >= 0) && (nFormatGuard > nFormat) && (nFormattedString > nFormatGuard), "Preserve a delegated formatting error before converting its empty failure result.");

	for (const strError of ["kLanguageAliasArgumentErrorMessage", "kReplacementTokensArgumentErrorMessage", "kPhraseNotFoundErrorMessage", "kLanguageSelectionErrorMessage", "kTextNotFoundErrorMessage"]) {
		g_Assert(strText.includes("RethrowV8InstallationFailure(pIsolate, TranslationTextFailure, " + strError + ");"));
	}

	const strFormat = GetDefinition(strSource, "FormatTranslationText");
	g_Assert(strFormat.includes("LocalReplacementValuesObject->GetOwnPropertyNames(LocalContext).ToLocal(&LocalPropertyNamesArray)"), "The pinned V8 context-only overload selects own enumerable string keys, excluding non-enumerable properties and symbols.");
	g_Assert(strFormat.includes("v8::String::Utf8Value const UTF8PropertyName = v8::String::Utf8Value(pIsolate, LocalPropertyNameText);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	g_Assert(strFormat.includes("v8::String::Utf8Value const UTF8ReplacementText = v8::String::Utf8Value(pIsolate, LocalReplacementText);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	g_Assert.doesNotMatch(strFormat, /continue;|ValueToString\(/, "Do not skip failed getters or hide failed conversions.");
	g_Assert.equal([...strFormat.matchAll(/TranslationFormattingFailure\.HasCaught\(\)/g)].length, 6);
	g_Assert.equal([...strFormat.matchAll(/pIsolate->IsExecutionTerminating\(\)/g)].length, 6);
	g_Assert.equal([...strFormat.matchAll(/pIsolate->HasPendingException\(\)/g)].length, 6);
	g_Assert(strFormat.includes("!LocalPropertyName->ToString(LocalContext).ToLocal(&LocalPropertyNameText)"));
	g_Assert(strFormat.includes("!LocalReplacementValue->ToString(LocalContext).ToLocal(&LocalReplacementText)"));
	g_Assert(strFormat.includes("!pszEncodedPropertyName || !pszEncodedReplacementText"));
	g_Assert(strFormat.includes("std::string(pszEncodedPropertyName, static_cast<std::size_t>(UTF8PropertyName.length()))"));
	g_Assert(strFormat.includes("std::string(pszEncodedReplacementText, static_cast<std::size_t>(UTF8ReplacementText.length()))"));
	g_Assert(strFormat.includes("unPlaceholderTextOffset += strReplacementText.size();"), "Inserted text is not rescanned for the same placeholder.");

	const strBuild = GetDefinition(strSource, "MakeTranslationLanguageStateObject");
	g_Assert.doesNotMatch(strBuild, /\.c_str\(|SetString\(|SetValue\(|->Set\(/);
	g_Assert(strBuild.includes("LocalObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert(strBuild.includes("LocalLanguageStateObject->CreateDataProperty(LocalContext, LocalLanguageAliasesPropertyName, LocalLanguageAliasesObject).FromMaybe(false)"));
	g_Assert(strBuild.includes("MakeString(pIsolate, strName)"));
	g_Assert(strBuild.includes("MakeString(pIsolate, strValue)"));
	g_Assert(strBuild.includes("DefineString(LocalLanguageAliasesObject, LanguageAliasEntry.first, LanguageAliasEntry.second)"));
	g_Assert(strBuild.includes("return bStringSet && !TranslationLanguageStateBuildFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException();"));
	g_Assert(strBuild.includes("if (!bAliasesSet || TranslationLanguageStateBuildFailure.HasCaught()"));

	const strKeyValue = GetDefinition(strSource, "ParseTranslationKeyValue");
	g_Assert.doesNotMatch(strKeyValue, /str(?:Key|Value)Out =/);
	g_Assert(strKeyValue.indexOf("strKeyOut.swap(strParsedKey);") > strKeyValue.indexOf("UnquoteTranslationString("));
	g_Assert(strKeyValue.includes("strValueOut.swap(strParsedValue);"));

	const strLanguages = GetDefinition(strSource, "LoadTranslationLanguageState");
	g_Assert(strLanguages.includes("TranslationLanguageState ParsedLanguageState = LanguageState;"));
	g_Assert(strLanguages.includes("RegisterTranslationLanguageAlias(ParsedLanguageState, strConfigurationKey, strConfigurationValue);"));
	const nLanguageGuard = strLanguages.indexOf("if (ConfigurationInputStream.eof() && !ConfigurationInputStream.bad())");
	g_Assert(nLanguageGuard >= 0);
	g_Assert(strLanguages.indexOf("LanguageState.m_mapLanguageAliases.swap(ParsedLanguageState.m_mapLanguageAliases);") > nLanguageGuard);
	g_Assert(strLanguages.includes("strConfiguredDefaultLanguageAlias.clear();"));

	const strINI = GetDefinition(strSource, "ParseTranslationINIFile");
	g_Assert(strINI.includes("mapParsedPhrases = TranslationFileDataInOut.m_mapPhrases;"));
	g_Assert(strINI.includes("strParsedDefaultLanguageCode = TranslationFileDataInOut.m_strDefaultLanguageCode;"));
	g_Assert.doesNotMatch(strINI, /TranslationFileDataInOut\.m_mapPhrases\[|TranslationFileDataInOut\.m_strDefaultLanguageCode =/);
	const nINIGuard = strINI.indexOf("if (!TranslationInputStream.eof() || TranslationInputStream.bad())");
	g_Assert(nINIGuard >= 0);
	g_Assert(strINI.indexOf("TranslationFileDataInOut.m_mapPhrases.swap(mapParsedPhrases);") > nINIGuard);
	g_Assert(strINI.indexOf("TranslationFileDataInOut.m_strDefaultLanguageCode.swap(strParsedDefaultLanguageCode);") > nINIGuard);

	const strNormalize = GetDefinition(strSource, "NormalizeTranslationFilePath");
	const nNullGuard = strNormalize.indexOf("if (strTranslationFilePath.find(kNullPathCharacter) != std::string::npos)");
	g_Assert(nNullGuard >= 0);
	g_Assert(strNormalize.indexOf("std::string strPortableTranslationFilePath") > nNullGuard, "Reject NUL before normalization can remove its path component.");

	const strLoad = GetDefinition(strSource, "LoadTranslationFile");
	g_Assert.match(strLoad, /if \(TranslationFileData\.m_PathMainFile\.empty\(\)\) \{\s*TranslationFileData\.m_strDefaultLanguageCode = LanguageState\.m_strDefaultLanguageCode;\s*return TranslationFileData;/);
	g_Assert(strLoad.indexOf("if (TranslationFileData.m_PathMainFile.empty())") < strLoad.indexOf("MakeTranslationServerFilePath("));
}

function RejectMutation(strName, strOld, strNew) {
	const strActualDefinition = GetRawDefinition(g_strSource, strName);
	const strDefinition = GetDefinition(g_strSource, strName);
	g_Assert(strDefinition.includes(strOld));

	const strChanged = strDefinition.replace(strOld, () => strNew);
	const strActualChanged = strActualDefinition.startsWith("\t\t") ? strChanged.replace(/^\t(?![ \t]*#)/gm, "\t\t") : strChanged;
	const strChangedSource = g_strSource.replace(strActualDefinition, () => strActualChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, "Mutate the actual source definition.");
	g_Assert.throws(() => CheckContracts(strChangedSource), g_Assert.AssertionError);
}

CheckDefinitionExtraction();
CheckContracts(g_strSource);

for (const strName of ["ReadTranslationString", "DefineTranslationValueProperty", "DefineTranslationStringProperty"]) {
	for (const strGuard of ["pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
		RejectMutation(strName, strGuard, "false");
		++g_unRejectedMutationCount;
	}
}

for (const Boundary of g_vecBoundaries) {
	RejectMutation(Boundary.Name, "v8::TryCatch " + Boundary.Frame + "(pIsolate);", "");
	RejectMutation(Boundary.Name, "catch (std::exception const&)", "catch (int)");
	RejectMutation(Boundary.Name, "catch (...)", "catch (int)");
	RejectMutation(Boundary.Name, "v8::TryCatch " + Boundary.Frame + "(pIsolate);", "RethrowV8InstallationFailure(pIsolate, " + Boundary.Frame + ", nullptr);\n\t\tv8::TryCatch " + Boundary.Frame + "(pIsolate);");
	g_unRejectedMutationCount += 4;

	RejectMutation(Boundary.Name, "RethrowV8InstallationFailure(pIsolate, " + Boundary.Frame + ", " + Boundary.Error + ");", "");
	++g_unRejectedMutationCount;

	if (!GetDefinition(g_strSource, Boundary.Name).startsWith("\tvoid ")) {
		RejectMutation(Boundary.Name, "\n\n\t\treturn " + (Boundary.Result ?? "{}") + ";\n\t}", "\n\t}");
		++g_unRejectedMutationCount;
	}

	if (Boundary.Guards > 0) {
		for (const strGuard of [Boundary.Frame + ".HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
			RejectMutation(Boundary.Name, strGuard, "false");
			++g_unRejectedMutationCount;
		}
	}
}

for (const Mutation of [
	{ Name: "FormatTranslationText", Old: "GetOwnPropertyNames(LocalContext).ToLocal", New: "GetOwnPropertyNames(LocalContext, v8::ALL_PROPERTIES).ToLocal" },
	{ Name: "FormatTranslationText", Old: "v8::String::Utf8Value const UTF8PropertyName = v8::String::Utf8Value(pIsolate, LocalPropertyNameText);", New: "v8::String::Utf8Value const UTF8PropertyName(pIsolate, LocalPropertyNameText);" },
	{ Name: "FormatTranslationText", Old: "v8::String::Utf8Value const UTF8ReplacementText = v8::String::Utf8Value(pIsolate, LocalReplacementText);", New: "v8::String::Utf8Value const UTF8ReplacementText(pIsolate, LocalReplacementText);" },
	{ Name: "ReadTranslationString", Old: "v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalValue);", New: "v8::String::Utf8Value const UTF8Value(pIsolate, LocalValue);" },
	{ Name: "FormatTranslationText", Old: "TranslationFormattingFailure.HasCaught()", New: "false" },
	{ Name: "FormatTranslationText", Old: "pIsolate->IsExecutionTerminating()", New: "false" },
	{ Name: "FormatTranslationText", Old: "pIsolate->HasPendingException()", New: "false" },
	{ Name: "FormatTranslationText", Old: "!pszEncodedPropertyName || !pszEncodedReplacementText", New: "false" },
	{ Name: "FormatTranslationText", Old: "static_cast<std::size_t>(UTF8PropertyName.length())", New: "0" },
	{ Name: "FormatTranslationText", Old: "static_cast<std::size_t>(UTF8ReplacementText.length())", New: "0" },
	{ Name: "FormatTranslationText", Old: "unPlaceholderTextOffset += strReplacementText.size();", New: "unPlaceholderTextOffset = 0x0;" },
	{ Name: "MakeTranslationLanguageStateObject", Old: "LocalObject->CreateDataProperty(", New: "LocalObject->Set(" },
	{ Name: "MakeTranslationLanguageStateObject", Old: "LocalLanguageStateObject->CreateDataProperty(", New: "LocalLanguageStateObject->Set(" },
	{ Name: "MakeTranslationLanguageStateObject", Old: "LanguageAliasEntry.first,", New: "LanguageAliasEntry.first.c_str()," },
	{ Name: "MakeTranslationLanguageStateObject", Old: "return bStringSet && !TranslationLanguageStateBuildFailure.HasCaught()", New: "return bStringSet" },
	{ Name: "MakeTranslationLanguageStateObject", Old: "if (!bAliasesSet || TranslationLanguageStateBuildFailure.HasCaught()", New: "if (TranslationLanguageStateBuildFailure.HasCaught()" },
	{ Name: "ParseTranslationKeyValue", Old: "strKeyOut.swap(strParsedKey);", New: "strKeyOut = strParsedKey;" },
	{ Name: "ParseTranslationKeyValue", Old: "strValueOut.swap(strParsedValue);", New: "strValueOut = strParsedValue;" },
	{ Name: "LoadTranslationLanguageState", Old: "RegisterTranslationLanguageAlias(ParsedLanguageState,", New: "RegisterTranslationLanguageAlias(LanguageState," },
	{ Name: "LoadTranslationLanguageState", Old: "if (ConfigurationInputStream.eof() && !ConfigurationInputStream.bad())", New: "if (true)" },
	{ Name: "LoadTranslationLanguageState", Old: "strConfiguredDefaultLanguageAlias.clear();", New: "" },
	{ Name: "ParseTranslationINIFile", Old: "if (!TranslationInputStream.eof() || TranslationInputStream.bad())", New: "if (false)" },
	{ Name: "ParseTranslationINIFile", Old: "mapParsedPhrases[strPhraseName]", New: "TranslationFileDataInOut.m_mapPhrases[strPhraseName]" },
	{ Name: "ParseTranslationINIFile", Old: "TranslationFileDataInOut.m_mapPhrases.swap(mapParsedPhrases);", New: "" },
	{ Name: "ParseTranslationINIFile", Old: "TranslationFileDataInOut.m_strDefaultLanguageCode.swap(strParsedDefaultLanguageCode);", New: "" },
	{ Name: "NormalizeTranslationFilePath", Old: "if (strTranslationFilePath.find(kNullPathCharacter) != std::string::npos)", New: "if (false)" },
	{ Name: "LoadTranslationFile", Old: "if (TranslationFileData.m_PathMainFile.empty())", New: "if (false)" },
	{ Name: "ReadTranslationString", Old: "TranslationFailure.HasCaught()", New: "false" },
	{ Name: "ReadTranslationString", Old: "!pszEncodedValue || TranslationFailure.HasCaught()", New: "TranslationFailure.HasCaught()" },
	{ Name: "ReadTranslationString", Old: "static_cast<std::size_t>(UTF8Value.length())", New: "0" },
	{ Name: "ReadTranslationString", Old: "strValueOut.swap(strParsedValue);", New: "strValueOut.clear();" },
	{ Name: "DefineTranslationValueProperty", Old: "TranslationFailure.HasCaught()", New: "false" },
	{ Name: "DefineTranslationValueProperty", Old: "MakeString(pIsolate, strName)", New: "MakeString(pIsolate, strName.c_str())" },
	{ Name: "DefineTranslationValueProperty", Old: "LocalObject->CreateDataProperty(", New: "LocalObject->Set(" },
	{ Name: "DefineTranslationValueProperty", Old: "return bValueSet && !TranslationFailure.HasCaught()", New: "return bValueSet" },
	{ Name: "DefineTranslationStringProperty", Old: "TranslationFailure.HasCaught()", New: "false" },
	{ Name: "DefineTranslationStringProperty", Old: "MakeString(pIsolate, strValue)", New: "MakeString(pIsolate, strValue.c_str())" },
	{ Name: "MakeTranslationPhraseObject", Old: "LanguageTextEntry.first, LanguageTextEntry.second,", New: "LanguageTextEntry.first.c_str(), LanguageTextEntry.second," },
	{ Name: "MakeTranslationFileObject", Old: "LocalPhrasesObject, PhraseEntry.first, LocalPhraseObject,", New: "LocalPhrasesObject, PhraseEntry.first.c_str(), LocalPhraseObject," },
	{ Name: "SetDefaultLanguageCallback", Old: "g_strTranslationsDefaultLanguageCode.swap(strLanguageCode);", New: "g_strTranslationsDefaultLanguageCode = strLanguageCode;" },
	{ Name: "SetDefaultLanguageCallback", Old: "TranslationDefaultLanguageUpdateFailure, kLanguageResolutionErrorMessage);", New: "TranslationDefaultLanguageUpdateFailure, kOperationErrorMessage);" },
	{ Name: "GetPhraseKeysCallback", Old: "if (unPhraseCount > kMaximumV8ArrayLength)", New: "if (false)" },
	{ Name: "GetPhraseKeysCallback", Old: "LocalPhraseKeysArray->CreateDataProperty(", New: "LocalPhraseKeysArray->Set(" },
	{ Name: "GetPhraseKeysCallback", Old: "if (!bPhraseKeySet || TranslationPhraseKeysFailure.HasCaught()", New: "if (TranslationPhraseKeysFailure.HasCaught()" },
	{ Name: "GetTextCallback", Old: "if (TranslationTextFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "HasPhraseCallback", Old: "ReadTranslationString(pIsolate, LocalPhraseKeyValue, TranslationFailure, strPhraseKey)", New: "true" },
	{ Name: "HasPhraseCallback", Old: "ReadTranslationString(pIsolate, LocalLanguageAliasValue, TranslationFailure, strRequestedLanguageAlias)", New: "true" },
	{ Name: "FormatTextCallback", Old: "ReadTranslationString(pIsolate, LocalMessageTemplateValue, TranslationFailure, strMessageTemplate)", New: "true" },
	{ Name: "InstallTranslationsFunctions", Old: "LocalTranslationsObject->CreateDataProperty(", New: "LocalTranslationsObject->Set(" },
	{ Name: "InstallTranslationsFunctions", Old: "LocalContext, Callback, LocalRuntimeData", New: "LocalContext, Callback" },
	{ Name: "InstallTranslationsFunctions", Old: "return bFunctionInstalled && !TranslationFailure.HasCaught()", New: "return bFunctionInstalled" },
	{ Name: "InstallTranslationsFunctions", Old: "if (!DefineFunction(\"HasPhrase\", HasPhraseCallback))", New: "if (!DefineFunction(\"HasPhrase\", FormatTextCallback))" },
]) {
	RejectMutation(Mutation.Name, Mutation.Old, Mutation.New);
	++g_unRejectedMutationCount;
}

for (const Sentinel of g_vecHasPhraseSentinels) {
	RejectMutation("HasPhraseCallback", "if (" + Sentinel.Condition + ")", "if (false)");
	const strOld = "if (" + Sentinel.Condition + ") {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(" + Sentinel.Result + ");";
	RejectMutation("HasPhraseCallback", strOld, strOld.replace("Set(" + Sentinel.Result + ")", "Set(" + ((Sentinel.Result === "true") ? "false" : "true") + ")"));
	g_unRejectedMutationCount += 2;
}

console.log("Translation native source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/engine execution not exercised.");
