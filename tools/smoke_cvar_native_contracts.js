#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks CVar source contracts without native V8 execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecCallbacks = [
	"GetCommandReturnNumberCallback",
	"GetCommandReturnObjectCallback",
	"FindConVarCallback",
	"DoesConVarExistCallback",
	"GetConCommandBaseRecordsCallback",
	"GetConVarCallback",
	"RequireConVarCallback",
	"GetConVarIntegerCallback",
	"GetConVarFloatCallback",
	"GetConVarBooleanCallback",
	"SetConVarCallback",
	"RevertConVarToDefaultCallback",
	"SetConVarFlagsCallback",
	"AddConVarFlagsCallback",
	"RemoveConVarFlagsCallback",
	"CreateConVarCallback",
	"SetConVarPublicCallback",
	"IsConVarPublicCallback",
	"FindPublicConVarCallback",
	"GetConVarNumericConstantCallback",
	"GetConVarObjectConstantCallback",
	"GetConVarFlagConstantCallback",
	"GetPublicConVarConstantCallback",
	"GetServerTagsStringCallback",
	"SetServerTagsStringCallback",
	"GetServerTagsCallback",
	"HasServerTagCallback",
	"AddServerTagCallback",
	"RemoveServerTagCallback",
];

let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignaturePrefix) {
	const strDefinition = strSource.split("\n").find((strLine) => strLine.startsWith("\t\t" + strSignaturePrefix) && strLine.endsWith("{"));
	g_Assert.ok(strDefinition, strSignaturePrefix);

	const nStart = strSource.indexOf(strDefinition);
	const nEnd = strSource.indexOf("\n\t\t}\n", nStart);
	g_Assert.ok(nEnd > nStart, strSignaturePrefix);

	return strSource.slice(nStart, nEnd);
}

function AssertCVarContracts(strSource) {
	for (const strCallback of g_vecCallbacks) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /\) try \{/);
		g_Assert.ok(strOwner.includes('"' + strCallback + ' failed with a C++ exception."'));
		g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\s*constexpr char kCallbackExceptionError\[\][^\n]+\s*ThrowError\(CallbackInformation\.GetIsolate\(\), kCallbackExceptionError\);/);
	}

	for (const strCallback of ["FindConVarCallback", "GetConVarCallback", "RequireConVarCallback", "CreateConVarCallback", "FindPublicConVarCallback"]) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /if \(ConstructionFailure\.HasCaught\(\) \|\| Local(?:ConVar|Value)\.IsEmpty\(\)\) \{\s*if \(!ConstructionFailure\.HasCaught\(\)\) \{\s*ThrowError\(pIsolate, kConstructionError\);\s*}\s*ConstructionFailure\.ReThrow\(\);\s*return;/);
	}

	const strAppend = ExtractFunction(strSource, "bool CVarsAppendList(");
	g_Assert.match(strAppend, /if \(unCommandBaseIndexOut >= kMaximumRecordCount\)/);
	g_Assert.match(strAppend, /if \(RecordFailure\.HasCaught\(\)\) \{\s*RecordFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strAppend, /if \(LocalRecord\.IsEmpty\(\) \|\| !LocalArray->CreateDataProperty\(LocalContext, unCommandBaseIndexOut, LocalRecord\)\.FromMaybe\(false\)\)/);
	g_Assert.match(strAppend, /RecordFailure\.ReThrow\(\);\s*return false;\s*}\s*(?:\+\+unCommandBaseIndexOut|unCommandBaseIndexOut\+\+);\s*return true;/);
	g_Assert.match(strAppend, /AppendCommandBase\(pCommandBase\)/);
	g_Assert.match(strAppend, /for \(auto const\* pCommandBase = pCVar->GetCommands\(\); pCommandBase; pCommandBase = pCommandBase->GetNext\(\)\)/);
	g_Assert.match(strAppend, /AppendCommandBase\(const_cast<ConCommandBase\*>\(pCommandBase\)\)/);
	g_Assert.match(strAppend, /} catch \(\.\.\.\) \{\s*if \(RecordFailure\.HasCaught\(\)\) \{\s*RecordFailure\.ReThrow\(\);\s*}\s*throw;/);

	const strNameReader = ExtractFunction(strSource, "bool ReadConVarName(");
	g_Assert.match(strNameReader, /if \(!pszEncodedName\) \{\s*ThrowError\(pIsolate, kConversionError\);\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strNameReader, /const std::size_t unEncodedNameLength = static_cast<std::size_t>\(UTF8Value\.length\(\)\);/);
	g_Assert.match(strNameReader, /if \(std::memchr\(pszEncodedName, '\\0', unEncodedNameLength\)\) \{\s*ThrowError\(pIsolate, kEmbeddedNULNameError\);\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.ok(strNameReader.includes("strConVarNameOut.assign(pszEncodedName, unEncodedNameLength);") && (strNameReader.indexOf("strConVarNameOut.assign(") > strNameReader.indexOf("if (std::memchr(")), "Commit name output only after complete NUL validation.");

	for (const strCallback of ["FindConVarCallback", "DoesConVarExistCallback", "GetConVarCallback", "CreateConVarCallback", "SetConVarPublicCallback", "IsConVarPublicCallback", "FindPublicConVarCallback"]) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /if \(!ReadConVarName\(pIsolate, CallbackInformation\[kNameArgumentIndex\], strConVarName\)\) \{\s*return;/);
		const strLookup = (strCallback === "CreateConVarCallback") ? "FindCommandBase(" : "pCVar->FindVar(";
		g_Assert.ok(strOwner.indexOf("ReadConVarName(") < strOwner.indexOf(strLookup), "Validate the entire name before SDK lookup.");
		g_Assert.doesNotMatch(strOwner, /ValueToString/);
	}

	const strRequiredConVar = ExtractFunction(strSource, "ConVar* CVarsRequireConVarFromArguments(");
	g_Assert.match(strRequiredConVar, /if \(!ReadConVarName\(pIsolate, CallbackInformation\[kNameArgumentIndex\], strConVarName\)\) \{\s*return nullptr;/);
	g_Assert.ok(strRequiredConVar.indexOf("ReadConVarName(") < strRequiredConVar.indexOf("pCVar->FindVar("));
	g_Assert.doesNotMatch(strRequiredConVar, /ValueToString/);

	const strRequiredCommandBase = ExtractFunction(strSource, "ConCommandBase* CVarsRequireConCommandBaseFromArguments(");
	g_Assert.match(strRequiredCommandBase, /if \(!ReadCommandName\(CallbackInformation, kNameArgumentIndex, strCommandBaseName\)\) \{\s*return nullptr;/);
	g_Assert.ok(strRequiredCommandBase.indexOf("ReadCommandName(") < strRequiredCommandBase.indexOf("FindCommandBase("));
	g_Assert.doesNotMatch(strRequiredCommandBase, /ValueToString/);

	for (const strCallback of ["FindConVarCallback", "GetConVarCallback", "RequireConVarCallback", "CreateConVarCallback", "FindPublicConVarCallback", "GetServerTagsStringCallback", "GetServerTagsCallback"]) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\s*if \(ConstructionFailure\.HasCaught\(\)\) \{\s*ConstructionFailure\.ReThrow\(\);\s*}\s*throw;/);
	}

	const strFactory = ExtractFunction(strSource, "v8::Local<v8::Object> MakeConVarObject(");
	g_Assert.match(strFactory, /} catch \(\.\.\.\) \{\s*if \(PropertyInstallationFailure\.HasCaught\(\)\) \{\s*PropertyInstallationFailure\.ReThrow\(\);\s*}\s*throw;/);

	const strConversion = ExtractFunction(strSource, "bool ReadConVarString(");
	g_Assert.match(strConversion, /if \(!LocalValue->ToString\(LocalContext\)\.ToLocal\(&LocalString\)\) \{\s*if \(!ConversionFailure\.HasCaught\(\)\) \{\s*ThrowError\(pIsolate, kConversionError\);\s*}\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strConversion, /if \(ConversionFailure\.HasCaught\(\) \|\| !pszValue\) \{\s*if \(!ConversionFailure\.HasCaught\(\)\) \{\s*ThrowError\(pIsolate, kConversionError\);\s*}\s*ConversionFailure\.ReThrow\(\);\s*return false;/);

	const strSetter = ExtractFunction(strSource, "void SetConVarCallback(");
	g_Assert.match(strSetter, /GetFloatArgument\(pIsolate, LocalContext, CallbackInformation\[kValueArgumentIndex\], kNumericValueError, flValue\)/);
	g_Assert.match(strSetter, /if \(!ReadConVarString\(pIsolate, LocalContext, CallbackInformation\[kValueArgumentIndex\], strValue\)\) \{\s*return;/);

	const strCreation = ExtractFunction(strSource, "void CreateConVarCallback(");
	g_Assert.equal((strCreation.match(/!ReadConVarString\(/g) ?? []).length, 2);
	g_Assert.ok(!strCreation.includes("DuplicateCVarString"));
	const strOwnedCreation = ExtractFunction(strSource, "ConVar* CreateOrRegisterOwnedConVar(");
	g_Assert.ok(strOwnedCreation.indexOf("vecCreatedConVars.push_back(std::move(pStorage));") < strOwnedCreation.indexOf("std::make_unique<ConVar>"));
	g_Assert.match(strOwnedCreation, /vecCreatedConVars\.push_back\(std::move\(pStorage\)\);/);
	g_Assert.match(strOwnedCreation, /vecCreatedConVars\.erase\(itFailedStorage\);\s*}\s*throw;/);
	g_Assert.match(strOwnedCreation, /std::find_if\(vecCreatedConVars\.begin\(\), vecCreatedConVars\.end\(\), MatchesName\)/);
	g_Assert.match(strOwnedCreation, /#if defined\(SOURCEJS_OLD_CONSOLE_API\)[\s\S]*?nCreationFlags \|= kSourceJSOwnedCommandFlag;\s*#endif/);
	g_Assert.match(strOwnedCreation, /if \(!SourceJSConCommandFlagIsSet\(pConVar, FCVAR_UNREGISTERED\) && !g_Application\.GetEngineInterfaces\(\)\.RegisterConCommand\(pConVar\)\) \{\s*return nullptr;/);
	g_Assert.match(strCreation, /pCurrentCommandBase && pCurrentCommandBase->IsCommand\(\)/);
	g_Assert.match(strCreation, /CreateOrRegisterOwnedConVar\(strConVarName, std::move\(strDefaultValue\), std::move\(strDescription\)/);
	const strUnregister = ExtractFunction(strSource, "void UnregisterCreatedConVars(");
	g_Assert.match(strUnregister, /FindCommandBase\(pStorage->m_strName\) == pConVar/);
	g_Assert.match(strUnregister, /UnregisterConCommand\(pConVar\);/);
	g_Assert.doesNotMatch(strUnregister, /\.clear\(|\.reset\(|delete /);
	g_Assert.ok(strSource.includes("std::unique_ptr<ConVar> m_pConVar;"));

	const strTagsGetter = ExtractFunction(strSource, "void GetServerTagsStringCallback(");
	g_Assert.match(strTagsGetter, /if \(ConstructionFailure\.HasCaught\(\) \|\| LocalString\.IsEmpty\(\)\) \{\s*if \(!ConstructionFailure\.HasCaught\(\)\) \{\s*ThrowError\(pIsolate, kConstructionError\);\s*}\s*ConstructionFailure\.ReThrow\(\);\s*return;/);

	for (const strCallback of ["SetServerTagsStringCallback", "HasServerTagCallback", "AddServerTagCallback", "RemoveServerTagCallback"]) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /if \(!ReadConVarString\(pIsolate, LocalContext, CallbackInformation\[k(?:Value|Tag)ArgumentIndex\], str(?:Value|RawTag)\)\) \{\s*return;/);
	}

	const strTagsArray = ExtractFunction(strSource, "void GetServerTagsCallback(");
	g_Assert.match(strTagsArray, /if \(vecTags\.size\(\) > kMaximumTagCount\) \{\s*ThrowError\(pIsolate, kTagCountError\);\s*return;/);
	g_Assert.match(strTagsArray, /if \(ConstructionFailure\.HasCaught\(\) \|\| LocalArray\.IsEmpty\(\)\) \{\s*if \(!ConstructionFailure\.HasCaught\(\)\) \{\s*ThrowError\(pIsolate, kConstructionError\);\s*}\s*ConstructionFailure\.ReThrow\(\);\s*return;/);
	g_Assert.match(strTagsArray, /if \(ConstructionFailure\.HasCaught\(\)\) \{\s*ConstructionFailure\.ReThrow\(\);\s*return;/);
	g_Assert.match(strTagsArray, /if \(LocalTag\.IsEmpty\(\) \|\| !LocalArray->CreateDataProperty\(LocalContext, static_cast<std::uint32_t>\(unTagIndex\), LocalTag\)\.FromMaybe\(false\)\) \{\s*if \(!ConstructionFailure\.HasCaught\(\)\) \{\s*ThrowError\(pIsolate, kConstructionError\);\s*}\s*ConstructionFailure\.ReThrow\(\);\s*return;/);
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignaturePrefix);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.throws(() => AssertCVarContracts(g_strSource.replace(strOwner, strOwner.replace(strOriginal, strReplacement))), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertCVarContracts(g_strSource);
for (const strCallback of g_vecCallbacks) {
	AssertRegression("void " + strCallback + "(", "ThrowError(CallbackInformation.GetIsolate(), kCallbackExceptionError);", "");
}

for (const strCallback of ["FindConVarCallback", "GetConVarCallback", "RequireConVarCallback", "CreateConVarCallback", "FindPublicConVarCallback"]) {
	AssertRegression("void " + strCallback + "(", "ConstructionFailure.ReThrow();", "");
}

AssertRegression("bool CVarsAppendList(", "if (unCommandBaseIndexOut >= kMaximumRecordCount)", "if (false)");
AssertRegression("bool CVarsAppendList(", "RecordFailure.ReThrow();", "");
AssertRegression("bool CVarsAppendList(", "LocalRecord.IsEmpty() || ", "");
AssertRegression("bool CVarsAppendList(", "LocalArray->CreateDataProperty(", "LocalArray->Set(");
AssertRegression("bool CVarsAppendList(", "++unCommandBaseIndexOut;", "");
AssertRegression("bool CVarsAppendList(", "for (auto const* pCommandBase = pCVar->GetCommands();", "for (auto* pCommandBase = pCVar->GetCommands();");
AssertRegression("bool CVarsAppendList(", "AppendCommandBase(pCommandBase)", "AppendCommandBase(const_cast<ConCommandBase*>(pCommandBase))");
AssertRegression("bool CVarsAppendList(", "RecordFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;");
AssertRegression("bool ReadConVarName(", "ThrowError(pIsolate, kConversionError);", "");
AssertRegression("bool ReadConVarName(", "ConversionFailure.ReThrow();", "");
AssertRegression("bool ReadConVarName(", "static_cast<std::size_t>(UTF8Value.length())", "std::strlen(pszEncodedName)");
AssertRegression("bool ReadConVarName(", "UTF8Value.length()", "UTF8ValueXlength()");
AssertRegression("bool ReadConVarName(", "if (std::memchr(pszEncodedName, '\\0', unEncodedNameLength))", "if (false)");
AssertRegression("bool ReadConVarName(", "const std::size_t unEncodedNameLength =", "strConVarNameOut.assign(pszEncodedName, static_cast<std::size_t>(UTF8Value.length()));\n\t\t\tconst std::size_t unEncodedNameLength =");

for (const strCallback of ["FindConVarCallback", "DoesConVarExistCallback", "GetConVarCallback", "CreateConVarCallback", "SetConVarPublicCallback", "IsConVarPublicCallback", "FindPublicConVarCallback"]) {
	AssertRegression("void " + strCallback + "(", "if (!ReadConVarName(pIsolate, CallbackInformation[kNameArgumentIndex], strConVarName))", "if (false)");
}

AssertRegression("ConVar* CVarsRequireConVarFromArguments(", "if (!ReadConVarName(pIsolate, CallbackInformation[kNameArgumentIndex], strConVarName))", "if (false)");
AssertRegression("ConCommandBase* CVarsRequireConCommandBaseFromArguments(", "if (!ReadCommandName(CallbackInformation, kNameArgumentIndex, strCommandBaseName))", "if (false)");

for (const strCallback of ["FindConVarCallback", "GetConVarCallback", "RequireConVarCallback", "CreateConVarCallback", "FindPublicConVarCallback", "GetServerTagsStringCallback", "GetServerTagsCallback"]) {
	AssertRegression("void " + strCallback + "(", "ConstructionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;\n\t\t\t\t}\n\n\t\t\t\tthrow;");
}

AssertRegression("v8::Local<v8::Object> MakeConVarObject(", "PropertyInstallationFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;");
AssertRegression("bool ReadConVarString(", "ConversionFailure.ReThrow();", "");
AssertRegression("bool ReadConVarString(", "!pszValue", "false");
AssertRegression("void SetConVarCallback(", "if (!ReadConVarString(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], strValue))", "if (false)");
AssertRegression("void SetConVarCallback(", "GetFloatArgument(", "GetNumberArgument(");
AssertRegression("void CreateConVarCallback(", "!ReadConVarString(", "!IgnoredConversion(");
AssertRegression("ConVar* CreateOrRegisterOwnedConVar(", "vecCreatedConVars.push_back(std::move(pStorage));", "");
AssertRegression("ConVar* CreateOrRegisterOwnedConVar(", "vecCreatedConVars.erase(itFailedStorage);", "");
AssertRegression("ConVar* CreateOrRegisterOwnedConVar(", "std::find_if(vecCreatedConVars.begin(), vecCreatedConVars.end(), MatchesName)", "vecCreatedConVars.end()");
AssertRegression("ConVar* CreateOrRegisterOwnedConVar(", "nCreationFlags |= kSourceJSOwnedCommandFlag;", "");
AssertRegression("ConVar* CreateOrRegisterOwnedConVar(", "!SourceJSConCommandFlagIsSet(pConVar, FCVAR_UNREGISTERED) && ", "");
AssertRegression("ConVar* CreateOrRegisterOwnedConVar(", "!g_Application.GetEngineInterfaces().RegisterConCommand(pConVar)", "false");
AssertRegression("void CreateConVarCallback(", "pCurrentCommandBase && pCurrentCommandBase->IsCommand()", "false");
AssertRegression("void UnregisterCreatedConVars(", "FindCommandBase(pStorage->m_strName) == pConVar", "true");
AssertRegression("void UnregisterCreatedConVars(", "g_Application.GetEngineInterfaces().UnregisterConCommand(pConVar);", "");
AssertRegression("void GetServerTagsStringCallback(", "ConstructionFailure.ReThrow();", "");
AssertRegression("void GetServerTagsStringCallback(", "LocalString.IsEmpty()", "false");

for (const strCallback of ["SetServerTagsStringCallback", "HasServerTagCallback", "AddServerTagCallback", "RemoveServerTagCallback"]) {
	AssertRegression("void " + strCallback + "(", "!ReadConVarString(", "!IgnoredConversion(");
}

AssertRegression("void GetServerTagsCallback(", "vecTags.size() > kMaximumTagCount", "false");
AssertRegression("void GetServerTagsCallback(", "LocalArray.IsEmpty()", "false");
AssertRegression("void GetServerTagsCallback(", "if (ConstructionFailure.HasCaught())", "if (false)");
AssertRegression("void GetServerTagsCallback(", "LocalTag.IsEmpty()", "false");
AssertRegression("void GetServerTagsCallback(", "LocalArray->CreateDataProperty(", "LocalArray->Set(");
AssertRegression("void GetServerTagsCallback(", "ConstructionFailure.ReThrow();\n\t\t\t\t\t\treturn;\n\t\t\t\t\t}\n\t\t\t\t}", "return;\n\t\t\t\t\t}\n\t\t\t\t}");

console.log("[smoke] CVar source contracts and " + g_unRegressionCount + " negative regressions passed; native V8 execution is a separate check");
