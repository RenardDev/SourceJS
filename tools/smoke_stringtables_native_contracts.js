#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_stringtables_native_contracts.js [--build-tree <configured-production-build>]\nWithout arguments: source contracts only. With --build-tree: execute actual native download-path filesystem transformations, with runtime path providers adapted; no V8/engine execution.";
const g_vecArguments = process.argv.slice(2);
const g_bNativePaths = (g_vecArguments.length === 2) && (g_vecArguments[0] === "--build-tree") && Boolean(g_vecArguments[1]);
if ((g_vecArguments.length === 1) && ["--help", "-h"].includes(g_vecArguments[0])) {
	console.log(g_strUsage);
	process.exit(0);
}

if ((g_vecArguments.length !== 0) && !g_bNativePaths) {
	console.error(g_strUsage);
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecBoundaries = [
	{ Name: "GetStringTablesTableProperty", Guards: 3 },
	{ Name: "InstallStringTablesTableProperty", Guards: 4, Result: "false" },
	{ Name: "MakeStringTablesTableObject", Guards: 10, Result: "{}" },
	{ Name: "GetAllStringTablesCallback", Guards: 5 },
	{ Name: "FindStringTableCallback", Guards: 3 },
	{ Name: "GetStringCallback", Guards: 4 },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Guards: 2, Result: "false" },
	{ Name: "GetRequiredStringCallback", Guards: 3 },
	{ Name: "AddStringCallback", Guards: 1 },
	{ Name: "RequireStringTablesDownloadablesTable", Guards: 1, Result: "nullptr" },
	{ Name: "MakeStringTablesStringArray", Guards: 3, Result: "{}" },
	{ Name: "GetDownloadablesTableCallback", Guards: 2 },
	{ Name: "GetDownloadablesListCallback", Guards: 4 },
	{ Name: "GetTrackedDownloadablesCallback", Guards: 1 },
	{ Name: "GetDownloadableIndexCallback", Guards: 1 },
	{ Name: "HasDownloadableCallback", Guards: 1 },
	{ Name: "AddDownloadableCallback", Guards: 1 },
	{ Name: "UntrackDownloadableCallback", Guards: 0 },
	{ Name: "UntrackDownloadableDirectoryCallback", Guards: 0 },
	{ Name: "RestoreDownloadablesCallback", Guards: 1 },
	{ Name: "AddDownloadableDirectoryCallback", Guards: 2 },
	{ Name: "InstallStringTablesDownloadsFunctions", Guards: 4, Result: "false" },
];
const g_vecTableProperties = ["Address", "Name", "ID", "StringCount", "MaximumStringCount"];
let g_unRejectedMutationCount = 0;

function GetRawDefinition(strSource, strName) {
	const strEscapedName = strName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecMatches = [...strSource.matchAll(new RegExp("^(\\t{1,2})(?:void|bool|int|std::string|INetworkStringTable\\*|v8::Local<v8::(?:Object|Array)>) " + strEscapedName + "\\([^\\n;{}]*\\)(?: noexcept)? \\{$", "gm"))];
	g_Assert.equal(vecMatches.length, 1, "Expected exactly one real native definition: " + strName);
	const vecMatch = vecMatches[0];
	const ClosingPattern = new RegExp("^" + vecMatch[1] + "\\}$", "gm");
	ClosingPattern.lastIndex = vecMatch.index + vecMatch[0].length;
	const vecClosing = ClosingPattern.exec(strSource);
	g_Assert(vecClosing && (vecClosing.index > vecMatch.index), "Missing native definition closing brace: " + strName);

	return strSource.slice(vecMatch.index, vecClosing.index + vecClosing[0].length);
}

function GetDefinition(strSource, strName) {
	const strActualDefinition = GetRawDefinition(strSource, strName);
	const bNested = strActualDefinition.startsWith("\t\t");
	const strDefinition = bNested ? strActualDefinition.replace(/^\t/gm, "") : strActualDefinition;
	g_Assert.equal(bNested ? strDefinition.replace(/^\t/gm, "\t\t") : strDefinition, strActualDefinition, "Normalize namespace indentation reversibly without changing preprocessor lines.");

	return strDefinition;
}

function CheckDefinitionExtraction() {
	for (const strIndentation of ["\t", "\t\t"]) {
		const strPrototype = strIndentation + "bool Probe(int nValue); // signature marker ) {\n";
		const strUnrelated = strIndentation + "bool Other(int nValue) {\n" + strIndentation + "\treturn false;\n" + strIndentation + "}\n";
		const strDefinition = strIndentation + "bool Probe(int nValue) {\n#if defined(SOURCEJS_EXTRACTOR_TEST)\n" + strIndentation + "\treturn true;\n#else\n" + strIndentation + "\treturn false;\n#endif\n" + strIndentation + "}";
		const strSource = strPrototype + strUnrelated + strDefinition + "\n";
		g_Assert.equal(GetRawDefinition(strSource, "Probe"), strDefinition, "Ignore prototypes, comments, and unrelated bodies.");
		const strNormalizedDefinition = (strIndentation === "\t\t") ? strDefinition.replace(/^\t/gm, "") : strDefinition;
		g_Assert.equal(GetDefinition(strSource, "Probe"), strNormalizedDefinition, "Namespace normalization preserves preprocessor lines.");

		const strEmptyArgumentDefinition = strIndentation + "bool Probe() {\n" + strIndentation + "\treturn true;\n" + strIndentation + "}";
		g_Assert.equal(GetRawDefinition(strEmptyArgumentDefinition + "\n", "Probe"), strEmptyArgumentDefinition);
		g_Assert.throws(() => GetRawDefinition(strPrototype + strUnrelated, "Probe"), { code: "ERR_ASSERTION" });
		g_Assert.throws(() => GetRawDefinition(strDefinition + "\n" + strDefinition + "\n", "Probe"), { code: "ERR_ASSERTION" });
	}
}

function CheckContracts(strSource) {
	for (const Boundary of g_vecBoundaries) {
		const strDefinition = GetDefinition(strSource, Boundary.Name);
		const strRethrow = "RethrowV8InstallationFailure(pIsolate, StringTableFailure, ";
		const nFrame = strDefinition.indexOf("v8::TryCatch StringTableFailure(pIsolate);\n\t\ttry {");
		g_Assert(nFrame >= 0, Boundary.Name + ": V8 frame survives native unwinding.");
		g_Assert(!strDefinition.slice(0, nFrame).includes(strRethrow));
		g_Assert(strDefinition.includes("} catch (std::exception const&) {\n\t\t\t" + strRethrow + "kFailureErrorMessage);"));
		g_Assert(strDefinition.includes("} catch (...) {\n\t\t\t" + strRethrow + "kFailureErrorMessage);"));
		g_Assert.doesNotMatch(strDefinition, /ValueToString\(|noexcept/);

		if (Boundary.Result) {
			g_Assert(strDefinition.endsWith("\n\n\t\treturn " + Boundary.Result + ";\n\t}"));
		}

		for (const strGuard of ["StringTableFailure.HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
			g_Assert.equal(strDefinition.split(strGuard).length - 1, Boundary.Guards, Boundary.Name + ": complete exception-state checks.");
		}

		for (const vecMatch of strDefinition.slice(nFrame).matchAll(/^(\t{3,})if \([^\n]+\) \{\n((?:\1\t[^\n]*\n)+)\1\}/gm)) {
			if (vecMatch[0].includes("StringTableFailure.HasCaught()")) {
				g_Assert(vecMatch[0].includes(strRethrow), Boundary.Name + ": preserve guarded V8 failures.");
			}
		}
	}

	const strRead = GetDefinition(strSource, "ReadStringTableCString");
	g_Assert(strRead.includes("v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalValue);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	for (const strGuard of ["StringTableFailure.HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
		g_Assert.equal(strRead.split(strGuard).length - 1, 2);
	}

	g_Assert.doesNotMatch(strRead, /ValueToString\(|\.c_str\(|noexcept/);
	g_Assert(strRead.includes("!pszEncodedValue || StringTableFailure.HasCaught()"));
	g_Assert(strRead.includes("std::string(pszEncodedValue, static_cast<std::size_t>(UTF8Value.length()))"));
	g_Assert(strRead.includes("if (strParsedValue.find('\\0') != std::string::npos) {\n\t\t\treturn false;\n\t\t}"));
	g_Assert(strRead.indexOf("strValueOut.swap(strParsedValue);") > strRead.indexOf("strParsedValue.find("));

	const strUserDataTarget = GetDefinition(strSource, "ReadStringUserDataTarget");
	g_Assert(strUserDataTarget.includes("!CallbackInformation[1]->IsInt32()"));
	g_Assert(strUserDataTarget.includes("(nStringIndex >= 0) && (nStringIndex < pStringTable->GetNumStrings())"));

	const strGetUserData = GetDefinition(strSource, "GetStringUserDataCallback");
	const strSetUserData = GetDefinition(strSource, "SetStringUserDataCallback");
	g_Assert(strGetUserData.includes("CallbackInformation.GetReturnValue().SetNull();"));
	g_Assert(strGetUserData.indexOf("vecBytes(pchBytes, pchBytes + nByteCount)") < strGetUserData.indexOf("MakeEngineByteArrayValue(pIsolate, vecBytes)"));
	g_Assert(strGetUserData.includes("vecBytes(pchBytes, pchBytes + nByteCount)"));
	g_Assert(strSetUserData.includes("LocalBuffer->IsSharedArrayBuffer() || LocalBuffer->WasDetached()"));
	g_Assert(strSetUserData.includes("LocalBytes->ByteLength() != static_cast<std::size_t>(nByteCount)"));
	g_Assert(strSetUserData.includes("LocalBytes->CopyContents(vecBytes.data(), unByteCount) != unByteCount"));
	g_Assert(strSetUserData.indexOf("LocalBytes->CopyContents(") < strSetUserData.indexOf("pStringTable->SetStringUserData(nStringIndex, nByteCount, vecBytes.data())"));
	g_Assert(strSetUserData.includes("pStringTable->SetStringUserData(nStringIndex, nByteCount, vecBytes.data())"));

	for (const strOperation of ["GetStringUserData", "SetStringUserData"]) {
		g_Assert(strSource.includes(`SetFunction(pIsolate, LocalContext, LocalStringTablesModule, "${strOperation}", ${strOperation}Callback, LocalRuntimeData)`));
	}

	const strGetter = GetDefinition(strSource, "GetStringTablesTableProperty");
	g_Assert(strGetter.includes("LocalHolderObject->InternalFieldCount() <= kTableAddressInternalFieldIndex"));
	g_Assert(strGetter.includes("!LocalPropertyDataValue->IsInt32()"));
	g_Assert(strGetter.includes("GetAlignedPointerFromInternalField(kTableAddressInternalFieldIndex, v8::kEmbedderDataTypeTagDefault)"));
	g_Assert(strGetter.includes("if (!pStringTable) {\n\t\t\t\treturn;\n\t\t\t}"));
	g_Assert(strGetter.includes("v8::BigInt::NewFromUnsigned(pIsolate, unStringTableAddress)"));
	g_Assert(strGetter.includes("static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pStringTable))"));
	for (const strCall of ["GetTableName()", "GetTableId()", "GetNumStrings()", "GetMaxStrings()"]) {
		g_Assert(strGetter.includes("pStringTable->" + strCall));
	}

	const strInstall = GetDefinition(strSource, "InstallStringTablesTableProperty");
	g_Assert(strInstall.includes("static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete)"));
	g_Assert(strInstall.includes("v8::Int32::New(pIsolate, static_cast<int>(TableProperty))"));
	g_Assert(strInstall.includes("SetNativeDataProperty(LocalContext, LocalPropertyNameString, GetStringTablesTableProperty, nullptr, LocalStringTablePropertyValue, kPropertyAttributes).FromMaybe(false)"));
	g_Assert(strInstall.includes("if (!bPropertyInstalled || StringTableFailure.HasCaught()"));

	const strBuild = GetDefinition(strSource, "MakeStringTablesTableObject");
	g_Assert(strBuild.includes("kStringTableInternalFieldCount = 1;"));
	g_Assert(strBuild.includes("SetInternalFieldCount(kStringTableInternalFieldCount);"));
	g_Assert(strBuild.includes("SetAlignedPointerInInternalField(kStringTableAddressInternalFieldIndex, pStringTable, v8::kEmbedderDataTypeTagDefault);"));
	g_Assert.deepEqual([...strBuild.matchAll(/if \(!InstallStringTablesTableProperty\([^\n]+StringTableProperty::(\w+)\)/g)].map(vecMatch => vecMatch[1]), g_vecTableProperties);
	for (const strProperty of g_vecTableProperties) {
		g_Assert(strBuild.includes('= "' + strProperty + '";'));
	}

	const strAll = GetDefinition(strSource, "GetAllStringTablesCallback");
	g_Assert.doesNotMatch(strAll, /->Set\(/);
	g_Assert(strAll.includes("LocalStringTablesArray->CreateDataProperty(LocalContext, unStringTableResultIndex, LocalStringTableObject).FromMaybe(false)"));
	g_Assert(strAll.includes("if (!bStringTableObjectSetSucceeded || StringTableFailure.HasCaught()"));
	g_Assert(strAll.includes("const int nStringTableCount = pStringTableContainer->GetNumTables();"));
	g_Assert(strAll.includes("for (int nStringTableIndex = 0; nStringTableIndex < nStringTableCount; ++nStringTableIndex)"));
	g_Assert(strAll.includes("if (!pStringTable) {\n\t\t\t\t\tcontinue;\n\t\t\t\t}"));
	g_Assert(strAll.includes("CallbackInformation.GetReturnValue().Set(LocalStringTablesArray);"));

	for (const strName of ["FindStringTableCallback", "GetStringCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		const nRead = strDefinition.indexOf("ReadStringTableCString(pIsolate, LocalStringTableNameValue, StringTableFailure, strStringTableName)");
		const nLookup = strDefinition.indexOf("pStringTableContainer->FindTable(strStringTableName.c_str())");
		g_Assert((nRead >= 0) && (nLookup > nRead), "Validate full UTF-8 and reject embedded NUL before the native C-string lookup.");
		g_Assert(strDefinition.includes("RethrowV8InstallationFailure(pIsolate, StringTableFailure, kStringTableNameReadErrorMessage);"));
		g_Assert(strDefinition.includes("if (!pStringTable) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\t\treturn;\n\t\t\t}"));
		g_Assert(strSource.indexOf("\tbool ReadStringTableCString(") < strSource.indexOf("\tvoid " + strName + "("));
	}

	const strFind = GetDefinition(strSource, "FindStringTableCallback");
	g_Assert(strFind.includes("if (LocalStringTableObject.IsEmpty() || StringTableFailure.HasCaught()"));

	const strGet = GetDefinition(strSource, "GetStringCallback");
	g_Assert(strGet.includes("if (!GetInt32Argument(pIsolate, LocalContext, LocalStringTableStringIndexValue, kStringTableStringIndexArgumentErrorMessage, nStringTableStringIndex) || StringTableFailure.HasCaught()"));
	g_Assert(strGet.includes("if ((nStringTableStringIndex < kFirstStringTableStringIndex) || (nStringTableStringIndex >= nStringTableStringCount)) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\t\treturn;\n\t\t\t}"));
	g_Assert(strGet.includes("MakeString(pIsolate, pStringTable->GetString(nStringTableStringIndex))"));
	g_Assert(strGet.includes("if (LocalStringTableValueString.IsEmpty() || StringTableFailure.HasCaught()"));

	const strIndex = GetDefinition(strSource, "GetRequiredStringTableStringIndexFromValue");
	g_Assert(strIndex.includes("v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalStringTableStringIndexValue);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	g_Assert(strIndex.includes("[pIsolate, LocalStringTableStringIndexValue, &strStringTableName, &StringTableFailure]"));
	g_Assert(strIndex.includes("!pszEncodedStringIndex || StringTableFailure.HasCaught()"));
	g_Assert(strIndex.includes("std::string(pszEncodedStringIndex, static_cast<std::size_t>(UTF8Value.length()))"));
	g_Assert(strIndex.includes("MaybeStringTableStringIndexValue.IsNothing() || StringTableFailure.HasCaught()"));
	g_Assert(strIndex.includes("!std::isfinite(dblStringTableStringIndex) || (dblStringTableStringIndex < kMinimumStringTableStringIndex) || (dblStringTableStringIndex > kMaximumStringTableStringIndex) || (std::floor(dblStringTableStringIndex) != dblStringTableStringIndex)"));
	g_Assert(strIndex.includes("kMinimumStringTableStringIndex = 0.0;"));
	g_Assert(strIndex.includes("kMaximumStringTableStringIndex = static_cast<double>(std::numeric_limits<int>::max());"));
	g_Assert(strIndex.includes("nStringTableStringIndexOut = static_cast<int>(dblStringTableStringIndex);\n\n\t\t\treturn true;"));

	for (const strName of ["GetRequiredStringCallback", "AddStringCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		const nRead = strDefinition.indexOf("ReadStringTableCString(pIsolate, LocalStringTableNameValue, StringTableFailure, strStringTableName)");
		const nLookup = strDefinition.indexOf("pStringTableContainer->FindTable(strStringTableName.c_str())");
		g_Assert((nRead >= 0) && (nLookup > nRead), "Strict table name before native lookup.");
	}

	const strRequired = GetDefinition(strSource, "GetRequiredStringCallback");
	g_Assert(strRequired.includes("GetRequiredStringTableStringIndexFromValue(pIsolate, LocalContext, LocalStringTableStringIndexValue, strStringTableName, nStringTableStringIndex) || StringTableFailure.HasCaught()"));
	g_Assert(strRequired.includes("[pIsolate, nStringTableStringIndex, &strStringTableName, &StringTableFailure]"));
	g_Assert(strRequired.includes("if (nStringTableStringIndex >= nStringTableStringCount)"));
	g_Assert(strRequired.includes("!pszStringTableValue || (pszStringTableValue[kStringTableStringBeginOffset] == kStringTableStringTerminatorCharacter)"));
	g_Assert(strRequired.includes("MakeString(pIsolate, pszStringTableValue)"));
	g_Assert(strRequired.includes("CallbackInformation.GetReturnValue().Set(LocalStringTableValueString);"));
	g_Assert.doesNotMatch(strRequired, /v8::Null\(|GetReturnValue\(\).Set\(false\)/);

	const strAdd = GetDefinition(strSource, "AddStringCallback");
	const nReadValue = strAdd.indexOf("ReadStringTableCString(pIsolate, LocalStringTableValue, StringTableFailure, strStringTableValue)");
	const nAddValue = strAdd.indexOf("pStringTable->AddString(");
	g_Assert((nReadValue >= 0) && (nAddValue > nReadValue), "Reject full UTF-8/NUL failures before irreversible SDK insertion.");
	g_Assert(strAdd.includes("#if defined(SOURCEJS_OLD_CONSOLE_API)\n\t\t\tconst int nStringTableStringIndex = pStringTable->AddString(strStringTableValue.c_str());\n#else\n\t\t\tconst int nStringTableStringIndex = pStringTable->AddString(kIsServerSide, strStringTableValue.c_str());\n#endif"));
	g_Assert(strAdd.includes("CallbackInformation.GetReturnValue().Set(nStringTableStringIndex);"));

	const strNormalize = GetDefinition(strSource, "NormalizeStringTablesDownloadPath");
	g_Assert(strNormalize.includes("kDownloadPathTerminatorCharacter = '\\0';"));
	g_Assert(strNormalize.includes("if (strDownloadPath.find(kDownloadPathTerminatorCharacter) != std::string::npos) {\n\t\t\treturn {};\n\t\t}"));
	g_Assert(strNormalize.indexOf("strDownloadPath.find(") < strNormalize.indexOf("TrimStringWhitespace(strDownloadPath)"));
	g_Assert(strNormalize.includes("std::filesystem::path const PathDownloadInput = std::u8string(strNormalizedDownloadPath.begin(), strNormalizedDownloadPath.end());"), "Decode physical download paths as UTF8 independently of the Windows narrow code page.");
	g_Assert(strNormalize.includes("std::u8string const strRelativeDownloadPathUTF8 = PathRelativeDownload.generic_u8string();\n\t\t\t\t\tstrNormalizedDownloadPath = std::string(strRelativeDownloadPathUTF8.begin(), strRelativeDownloadPathUTF8.end());"), "Return relative download paths as UTF8 with generic separators.");

	for (const strName of ["FindStringTablesDownloadableIndex", "AddStringTablesDownloadable"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("strDownloadableFilePath.empty() || (strDownloadableFilePath.find('\\0') != std::string::npos)"));
		g_Assert(strDefinition.indexOf("strDownloadableFilePath.find(") < strDefinition.indexOf("FindStringIndex(strDownloadableFilePath.c_str())"));
	}

	const strDownloadTable = GetDefinition(strSource, "GetDownloadablesTableCallback");
	g_Assert(strDownloadTable.includes("LocalDownloadablesStringTableObject.IsEmpty() || StringTableFailure.HasCaught()"));

	const strTracked = GetDefinition(strSource, "GetTrackedDownloadablesCallback");
	g_Assert(strTracked.includes("MakeStringTablesStringArray(pIsolate, LocalContext, g_vecDownloadableFilePaths)"));
	g_Assert(strTracked.includes("LocalTrackedDownloadableFilePathArray.IsEmpty() || StringTableFailure.HasCaught()"));

	for (const Entry of [
		{ Name: "MakeStringTablesStringArray", Array: "LocalStringTableValueArray", Index: "static_cast<std::uint32_t>(unStringTableValueIndex)", Value: "LocalStringTableValueString", Status: "bStringTableValueSet" },
		{ Name: "GetDownloadablesListCallback", Array: "LocalDownloadableFilePathArray", Index: "static_cast<std::uint32_t>(nDownloadableStringIndex)", Value: "LocalDownloadableFilePathString", Status: "bDownloadableFilePathSet" },
	]) {
		const strDefinition = GetDefinition(strSource, Entry.Name);
		g_Assert.doesNotMatch(strDefinition, /->Set\(/);
		g_Assert(strDefinition.includes(Entry.Array + "->CreateDataProperty(LocalContext, " + Entry.Index + ", " + Entry.Value + ").FromMaybe(false)"));
		g_Assert(strDefinition.includes("if (!" + Entry.Status + " || StringTableFailure.HasCaught()"));
	}

	const strDownloadList = GetDefinition(strSource, "GetDownloadablesListCallback");
	g_Assert(strDownloadList.includes("const int nDownloadableStringCount = pDownloadablesStringTable->GetNumStrings();"));
	g_Assert(strDownloadList.includes("nDownloadableStringIndex < nDownloadableStringCount"));
	g_Assert(strDownloadList.includes("if (!pszDownloadableFilePath) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, StringTableFailure, kInvalidDownloadableStringTableValueErrorMessage);\n\t\t\t\t\treturn;\n\t\t\t\t}"));

	const strDownloadIndex = GetDefinition(strSource, "GetDownloadableIndexCallback");
	g_Assert(strDownloadIndex.includes("ReadStringTableCString(pIsolate, LocalDownloadableFilePathValue, StringTableFailure, strDownloadableFilePathInput)"));
	g_Assert(strDownloadIndex.indexOf("ReadStringTableCString(") < strDownloadIndex.indexOf("NormalizeStringTablesDownloadPath("));
	g_Assert(strDownloadIndex.includes("RequireStringTablesDownloadablesTable(pIsolate, kOperationName) || StringTableFailure.HasCaught()"));
	g_Assert(strDownloadIndex.includes("CallbackInformation.GetReturnValue().Set(nDownloadableStringIndex);"));

	for (const strName of ["HasDownloadableCallback", "AddDownloadableCallback", "UntrackDownloadableCallback", "UntrackDownloadableDirectoryCallback", "AddDownloadableDirectoryCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		const nRead = strDefinition.indexOf("ReadStringTableCString(");
		const nPathUse = strDefinition.indexOf((strName === "AddDownloadableDirectoryCallback") ? "TrimStringWhitespace(strDownloadableDirectoryPathInput)" : "NormalizeStringTablesDownloadPath(");
		g_Assert((nRead >= 0) && (nPathUse > nRead), "Validate complete UTF8/NUL before path transformation or mutation.");
		g_Assert(strDefinition.includes("RethrowV8InstallationFailure(pIsolate, StringTableFailure, kDownloadablePathReadErrorMessage);"));
	}

	const strHas = GetDefinition(strSource, "HasDownloadableCallback");
	g_Assert(strHas.includes("nDownloadableStringIndex >= kFirstValidDownloadableStringIndex"));
	g_Assert(strHas.includes("CallbackInformation.GetReturnValue().Set(bHasDownloadableFilePath);"));

	const strAddDownloadable = GetDefinition(strSource, "AddDownloadableCallback");
	g_Assert(strAddDownloadable.includes("kTrackDownloadableFilePath = true;"));
	g_Assert(strAddDownloadable.includes("AddStringTablesDownloadable(strDownloadableFilePath, kTrackDownloadableFilePath)"));

	const strUntrack = GetDefinition(strSource, "UntrackDownloadableCallback");
	g_Assert(strUntrack.includes("RemoveStringTablesStringValue(g_vecDownloadableFilePaths, strDownloadableFilePath)"));
	g_Assert(strUntrack.includes("CallbackInformation.GetReturnValue().Set(bDownloadableFilePathUntracked);"));

	for (const Entry of [
		{ Name: "UntrackDownloadableDirectoryCallback", Mutation: "g_vecDownloadableFilePaths.erase(" },
		{ Name: "RestoreDownloadablesCallback", Mutation: "AddStringTablesDownloadable(" },
	]) {
		const strDefinition = GetDefinition(strSource, Entry.Name);
		g_Assert(strDefinition.includes("kMaximumTrackedDownloadableFilePathCount = static_cast<std::size_t>(std::numeric_limits<int>::max());"));
		const nBound = strDefinition.indexOf("if (g_vecDownloadableFilePaths.size() > kMaximumTrackedDownloadableFilePathCount)");
		g_Assert((nBound >= 0) && (strDefinition.indexOf(Entry.Mutation) > nBound), "Bound native signed counts before mutation.");
		g_Assert(strDefinition.includes("RethrowV8InstallationFailure(pIsolate, StringTableFailure, kDownloadablePathCountErrorMessage);"));
	}

	const strRestore = GetDefinition(strSource, "RestoreDownloadablesCallback");
	g_Assert(strRestore.includes("kTrackDownloadableFilePath = false;"));
	g_Assert(strRestore.includes("for (auto const& strDownloadableFilePath : g_vecDownloadableFilePaths)"));

	const strDirectory = GetDefinition(strSource, "AddDownloadableDirectoryCallback");
	g_Assert(strDirectory.includes("std::filesystem::path PathDownloadableDirectory = std::u8string(strDownloadableDirectoryPathInput.begin(), strDownloadableDirectoryPathInput.end());"), "Decode directory inputs as UTF8 before platform enumeration.");
	g_Assert(strDirectory.includes("NormalizeStringTablesDownloadPath(pRuntime, EncodePathAsUTF8(PathRelativeDownloadableFile))"), "Encode native filenames as UTF8 before engine-path normalization.");
	g_Assert(strDirectory.includes("kDefaultRecursiveTraversal = true;"));
	const nRecursiveValueRead = strDirectory.indexOf("LocalRecursiveTraversalValue->BooleanValue(pIsolate)");
	g_Assert((nRecursiveValueRead >= 0) && (strDirectory.indexOf("ReadStringTableCString(") > nRecursiveValueRead));
	g_Assert(strDirectory.includes("&vecAddedDownloadableFilePaths, &StringTableFailure]"));
	g_Assert(strDirectory.includes("LocalAddedDownloadableFilePathArray.IsEmpty() || StringTableFailure.HasCaught()"));
	g_Assert(strDirectory.includes("std::filesystem::directory_options::skip_permission_denied"));
	g_Assert.equal(strDirectory.split("DownloadableDirectoryErrorCode.clear();").length - 1, 2);
	g_Assert.equal(strDirectory.split("itDownloadableDirectoryEntry.increment(DownloadableDirectoryErrorCode);").length - 1, 2);
	const nSort = strDirectory.indexOf("std::sort(vecCandidateDownloadableFilePaths.begin(), vecCandidateDownloadableFilePaths.end());");
	g_Assert((nSort >= 0) && (strDirectory.indexOf("for (auto const& strCandidateDownloadableFilePath") > nSort));
	g_Assert(strDirectory.includes("AppendStringTablesUniqueStringValue(vecAddedDownloadableFilePaths, strCandidateDownloadableFilePath);"));

	const strDownloadInstall = GetDefinition(strSource, "InstallStringTablesDownloadsFunctions");
	g_Assert.doesNotMatch(strDownloadInstall, /SetFunction\(|SetString\(|->Set\(/);
	g_Assert(strDownloadInstall.includes("LocalDownloadsObject->CreateDataProperty(LocalContext, LocalNameString, LocalValue).FromMaybe(false)"));
	g_Assert(strDownloadInstall.includes("if (!bValueDefined || StringTableFailure.HasCaught()"));
	g_Assert(strDownloadInstall.includes("v8::Function::New(LocalContext, Callback, LocalRuntimeData).ToLocal(&LocalFunction)"));
	g_Assert(strDownloadInstall.includes("if (!bFunctionCreated || LocalFunction.IsEmpty() || StringTableFailure.HasCaught()"));
	g_Assert(strDownloadInstall.includes('MakeString(pIsolate, "downloadables")'));
	g_Assert(strDownloadInstall.includes('if (!DefineValue("DOWNLOADABLES_TABLE_NAME", LocalDownloadablesTableNameString))'));
	g_Assert.deepEqual([...strDownloadInstall.matchAll(/if \(!DefineFunction\("([^"]+)", (\w+)\)\)/g)].map(vecMatch => [vecMatch[1], vecMatch[2]]), [
		["GetDownloadablesTable", "GetDownloadablesTableCallback"],
		["GetDownloadablesList", "GetDownloadablesListCallback"],
		["GetTrackedDownloadables", "GetTrackedDownloadablesCallback"],
		["GetDownloadableIndex", "GetDownloadableIndexCallback"],
		["HasDownloadable", "HasDownloadableCallback"],
		["AddDownloadable", "AddDownloadableCallback"],
		["AddDownloadableDirectory", "AddDownloadableDirectoryCallback"],
		["UntrackDownloadable", "UntrackDownloadableCallback"],
		["UntrackDownloadableDirectory", "UntrackDownloadableDirectoryCallback"],
		["RestoreDownloadables", "RestoreDownloadablesCallback"],
	]);
}

function RejectChangedDefinition(strName, strChanged) {
	const strActualDefinition = GetRawDefinition(g_strSource, strName);
	const strActualChanged = strActualDefinition.startsWith("\t\t") ? strChanged.replace(/^\t/gm, "\t\t") : strChanged;
	const strChangedSource = g_strSource.replace(strActualDefinition, () => strActualChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, "Mutate the actual source definition.");
	g_Assert.throws(() => CheckContracts(strChangedSource), g_Assert.AssertionError, strName);
}

function RejectMutation(strName, strOld, strNew) {
	const strDefinition = GetDefinition(g_strSource, strName);
	g_Assert(strDefinition.includes(strOld), "Mutation anchor: " + strName + ": " + strOld);
	const strChanged = strDefinition.replace(strOld, () => strNew);
	RejectChangedDefinition(strName, strChanged);
}

function RunNativeFilesystemProbe(strBuildTree) {
	const unTimeoutMilliseconds = 60000;
	const unMaximumOutputBytes = 8 * 1024 * 1024;
	const strRoot = g_Path.resolve(__dirname, "..");
	const strBuildRoot = g_FileSystem.realpathSync(g_Path.join(strRoot, "build"));
	const strCache = g_FileSystem.readFileSync(g_Path.join(g_FileSystem.realpathSync(g_Path.resolve(strBuildTree)), "CMakeCache.txt"), "utf8");
	const ReadCache = (strName, bRequired = true) => {
		const vecMatch = strCache.match(new RegExp("^" + strName + ":[^=]*=(.*)$", "m"));
		g_Assert(!bRequired || vecMatch?.[1], "Missing configured entry: " + strName);

		return vecMatch?.[1].trim() ?? "";
	};
	const RequireSuccess = (strCommand, vecArguments, strWorkingDirectory = strRoot) => {
		const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: strWorkingDirectory, encoding: "utf8", windowsHide: true, timeout: unTimeoutMilliseconds, maxBuffer: unMaximumOutputBytes });
		g_Assert(!Result.error, strCommand + ": " + Result.error?.message);
		g_Assert.equal(Result.signal, null, strCommand + ": unexpected signal");
		g_Assert.equal(Result.status, 0, strCommand + ": " + Result.stdout + Result.stderr);
		g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), strCommand + ": " + Result.stdout + Result.stderr);

		return Result;
	};
	g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");

	const strRuntimePaths = g_FileSystem.readFileSync(g_Path.join(strRoot, "src/sourcejs/RuntimePaths.cpp"), "utf8").replace(/\r\n/g, "\n");
	const strDirectoryCallback = GetDefinition(g_strSource, "AddDownloadableDirectoryCallback");
	const strStart = "\t\t\tstd::filesystem::path const PathGameRoot = pRuntimePaths->GetGameRootPath().lexically_normal();";
	const strEnd = "\t\t\tstd::sort(vecCandidateDownloadableFilePaths.begin(), vecCandidateDownloadableFilePaths.end());";
	g_Assert.equal(strDirectoryCallback.split(strStart).length, 2);
	g_Assert.equal(strDirectoryCallback.split(strEnd).length, 2);
	const unStart = strDirectoryCallback.indexOf(strStart);
	const unEnd = strDirectoryCallback.indexOf(strEnd);
	g_Assert(unEnd > unStart);

	const strDirectoryPhase = strDirectoryCallback.slice(unStart, unEnd + strEnd.length);
	const strEarlyReturn = "SetAddedDownloadableFilePathsReturnValue();\n\t\t\t\treturn;";
	g_Assert.equal(strDirectoryPhase.split(strEarlyReturn).length, 2);
	// Adapt only the V8 empty-array return; retain the complete actual filesystem phase.
	const strEnumeration = strDirectoryPhase.replace(strEarlyReturn, () => "return {};").replace(/^\t\t/gm, "");
	const strHelpers = [
		GetRawDefinition(strRuntimePaths, "EncodePathAsUTF8"),
		...["TrimStringWhitespace", "DoesStringTablesVectorContainValue", "AppendStringTablesUniqueStringValue", "NormalizeStringTablesDownloadPath"].map(strName => GetDefinition(g_strSource, strName)),
	].join("\n\n");
	const strProgram = String.raw`
// C++
#include <cstdio>

// STL
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <vector>

namespace {

	struct RuntimePaths {
		std::filesystem::path const& GetGameRootPath() const {
			return m_PathGameRoot;
		}

		std::filesystem::path m_PathGameRoot;
	};

	struct V8Runtime {
		RuntimePaths const* GetRuntimePaths() const {
			return m_pRuntimePaths;
		}

		RuntimePaths const* m_pRuntimePaths;
	};

@HELPERS@

	std::vector<std::string> EnumeratePaths(V8Runtime const* const pRuntime, std::string const& strDownloadableDirectoryPathInput, const bool bUseRecursiveDirectoryTraversal) {
		auto const* const pRuntimePaths = pRuntime->GetRuntimePaths();
		std::vector<std::string> vecCandidateDownloadableFilePaths {};

@ENUMERATION@

		return vecCandidateDownloadableFilePaths;
	}

	void Require(const bool bCondition, char const* const pszScenario) {
		if (!bCondition) {
			throw std::runtime_error(pszScenario);
		}
	}

	std::string EncodeLiteral(std::u8string const& strText) {
		return std::string(strText.begin(), strText.end());
	}

	void WriteProbeFile(std::filesystem::path const& PathFile) {
		std::ofstream OutputStream(PathFile, std::ios::binary);

		OutputStream.put('x');
		OutputStream.close();
		Require(!OutputStream.fail(), "Could not create physical probe file");
	}

	void CheckPaths(std::filesystem::path const& PathGameRoot) {
		constexpr char8_t kDirectoryName[] = u8"\u6F22\u5B57";
		constexpr char8_t kFileName[] = u8"\u0444\u0430\u0439\u043B.txt";
		constexpr char kEmbeddedNULPath[] = "bad\0path";

		std::filesystem::path const PathDirectory = PathGameRoot / kDirectoryName;
		std::filesystem::create_directories(PathDirectory / "sub");
		std::filesystem::create_directories(PathGameRoot / "ASCII");
		WriteProbeFile(PathDirectory / "alpha.txt");
		WriteProbeFile(PathDirectory / kFileName);
		WriteProbeFile(PathDirectory / "sub" / "beta.txt");
		WriteProbeFile(PathGameRoot / "ASCII" / kFileName);

		RuntimePaths const Paths { PathGameRoot };
		V8Runtime const Runtime { &Paths };
		std::string const strDirectory = EncodeLiteral(kDirectoryName);
		std::string const strFile = EncodeLiteral(kFileName);
		std::string const strAbsoluteFile = EncodePathAsUTF8(PathDirectory / kFileName);
		Require(NormalizeStringTablesDownloadPath(&Runtime, strAbsoluteFile) == (strDirectory + "/" + strFile), "Absolute UTF8 path normalization changed the native filename");
		Require(NormalizeStringTablesDownloadPath(&Runtime, " ./materials\\sourcejs//probe/ ") == "materials/sourcejs//probe/", "Existing relative path policy changed");
		Require(NormalizeStringTablesDownloadPath(nullptr, "./materials/probe") == "materials/probe", "Absent runtime path policy changed");
		Require(NormalizeStringTablesDownloadPath(&Runtime, std::string(kEmbeddedNULPath, sizeof(kEmbeddedNULPath) - 1)).empty(), "Embedded NUL accepted");

		std::vector<std::string> vecShallowExpected { strDirectory + "/alpha.txt", strDirectory + "/" + strFile };
		std::sort(vecShallowExpected.begin(), vecShallowExpected.end());
		Require(EnumeratePaths(&Runtime, strDirectory, false) == vecShallowExpected, "Relative Unicode directory or UTF8 output mismatch");

		std::vector<std::string> vecRecursiveExpected = vecShallowExpected;
		vecRecursiveExpected.push_back(strDirectory + "/sub/beta.txt");
		std::sort(vecRecursiveExpected.begin(), vecRecursiveExpected.end());
		Require(EnumeratePaths(&Runtime, EncodePathAsUTF8(PathDirectory), true) == vecRecursiveExpected, "Absolute Unicode directory or sorted recursion mismatch");

		std::vector<std::string> const vecASCIIExpected { "ASCII/" + strFile };
		Require(EnumeratePaths(&Runtime, "ASCII", false) == vecASCIIExpected, "Native Unicode filename was not returned as UTF8");
		Require(EnumeratePaths(&Runtime, "Missing", true).empty(), "Missing directory policy changed");
	}

} // namespace

int main() {
	try {
		std::filesystem::path const PathRoot = std::filesystem::current_path();
		CheckPaths(PathRoot / "GameRoot");
		CheckPaths(PathRoot / u8"\u6F22\u5B57\u0438\u0433\u0440\u0430");
	} catch (std::exception const& Error) {
		std::fprintf(stderr, "Native download paths: %s\n", Error.what());
		return 1;
	} catch (...) {
		std::fprintf(stderr, "Native download paths: unknown failure\n");
		return 1;
	}

	return 0;
}
`.replace("@HELPERS@", () => strHelpers).replace("@ENUMERATION@", () => strEnumeration);
	g_Assert(!/@[A-Z_]+@/.test(strProgram));

	const strDirectory = g_FileSystem.mkdtempSync(g_Path.join(strBuildRoot, "NativeStringTablesPaths-"));
	let bOperationFailed = false;
	let OperationFailure = null;
	try {
		g_FileSystem.writeFileSync(g_Path.join(strDirectory, "Probe.cpp"), strProgram);
		g_FileSystem.writeFileSync(g_Path.join(strDirectory, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)\nproject(StringTablesPaths LANGUAGES CXX)\nadd_executable(Probe Probe.cpp)\ntarget_compile_features(Probe PRIVATE cxx_std_20)\nif(MSVC)\n\ttarget_compile_options(Probe PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)\nelse()\n\ttarget_compile_options(Probe PRIVATE -Wall -Wextra -Werror -pedantic)\nendif()\n");
		const strBinaryRoot = g_Path.join(strDirectory, "compiled");
		const vecConfigure = ["-S", strDirectory, "-B", strBinaryRoot, "-G", ReadCache("CMAKE_GENERATOR"), "-DCMAKE_CXX_FLAGS=" + ReadCache("CMAKE_CXX_FLAGS", false)];
		if (process.platform === "win32") {
			vecConfigure.push("-A", ReadCache("CMAKE_GENERATOR_PLATFORM"));
		} else {
			vecConfigure.push("-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_COMPILER=" + ReadCache("CMAKE_CXX_COMPILER"));
		}

		RequireSuccess("cmake", vecConfigure);
		RequireSuccess("cmake", ["--build", strBinaryRoot, "--config", "Release", "--target", "Probe", "--parallel", "2"]);
		const strExecutable = g_Path.join(strBinaryRoot, (process.platform === "win32") ? "Release/Probe.exe" : "Probe");
		const Result = RequireSuccess(strExecutable, [], strDirectory);
		g_Assert.equal(Result.stdout + Result.stderr, "", "Native probe must not produce unexpected output");
	} catch (Error) {
		bOperationFailed = true;
		OperationFailure = Error;
		throw Error;
	} finally {
		try {
			const Status = g_FileSystem.lstatSync(strDirectory);
			const strResolved = g_FileSystem.realpathSync(strDirectory);
			const strRelative = g_Path.relative(strBuildRoot, strResolved);
			g_Assert(Status.isDirectory() && !Status.isSymbolicLink() && !g_Path.isAbsolute(strRelative) && /^NativeStringTablesPaths-[^/\\]+$/.test(strRelative) && (g_Path.basename(strResolved) === g_Path.basename(strDirectory)), "Refuse cleanup outside the exact allocated fixture directory");
			g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
		} catch (CleanupError) {
			if (bOperationFailed) {
				throw new AggregateError([OperationFailure, CleanupError], "Native path check and cleanup both failed.");
			}

			throw CleanupError;
		}
	}

	console.log("Native download paths PASS: actual normalizer and directory filesystem phase; ASCII/Unicode roots, relative/absolute paths, UTF8 filenames, recursion/sorting, missing-directory and NUL policies; runtime providers adapted, no V8/engine claim.");
}

if (g_bNativePaths) {
	RunNativeFilesystemProbe(g_vecArguments[1]);
	process.exit(0);
}

CheckDefinitionExtraction();
CheckContracts(g_strSource);

// Deliberate invalid/legacy replacements include forbidden public m_* names; never export them.
for (const Boundary of g_vecBoundaries) {
	for (const Mutation of [
		{ Old: "v8::TryCatch StringTableFailure(pIsolate);", New: "" },
		{ Old: "catch (std::exception const&)", New: "catch (int)" },
		{ Old: "catch (...)", New: "catch (int)" },
		{ Old: "RethrowV8InstallationFailure(pIsolate, StringTableFailure, kFailureErrorMessage);", New: "" },
		{ Old: "v8::TryCatch StringTableFailure(pIsolate);", New: "RethrowV8InstallationFailure(pIsolate, StringTableFailure, nullptr);\n\t\tv8::TryCatch StringTableFailure(pIsolate);" },
	]) {
		RejectMutation(Boundary.Name, Mutation.Old, Mutation.New);
		++g_unRejectedMutationCount;
	}

	if (Boundary.Result) {
		RejectMutation(Boundary.Name, "\n\n\t\treturn " + Boundary.Result + ";\n\t}", "\n\t}");
		++g_unRejectedMutationCount;
	}
}

for (const strName of [...g_vecBoundaries.map(Boundary => Boundary.Name), "ReadStringTableCString"]) {
	const strDefinition = GetDefinition(g_strSource, strName);
	for (const strGuard of ["StringTableFailure.HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
		const unGuardCount = strDefinition.split(strGuard).length - 1;
		for (let unGuardIndex = 0; unGuardIndex < unGuardCount; ++unGuardIndex) {
			let unSeenCount = 0;
			const strChanged = strDefinition.replaceAll(strGuard, () => {
				const bSelected = unSeenCount === unGuardIndex;
				++unSeenCount;

				return bSelected ? "false" : strGuard;
			});
			RejectChangedDefinition(strName, strChanged);
			++g_unRejectedMutationCount;
		}
	}
}

for (const Mutation of [
	{ Name: "HasDownloadableCallback", Old: "ReadStringTableCString(", New: "LegacyReader(" },
	{ Name: "HasDownloadableCallback", Old: "nDownloadableStringIndex >= kFirstValidDownloadableStringIndex", New: "false" },
	{ Name: "AddDownloadableCallback", Old: "ReadStringTableCString(", New: "LegacyReader(" },
	{ Name: "AddDownloadableCallback", Old: "kTrackDownloadableFilePath = true;", New: "kTrackDownloadableFilePath = false;" },
	{ Name: "UntrackDownloadableCallback", Old: "ReadStringTableCString(", New: "LegacyReader(" },
	{ Name: "UntrackDownloadableCallback", Old: "RemoveStringTablesStringValue(", New: "AppendStringTablesUniqueStringValue(" },
	{ Name: "UntrackDownloadableDirectoryCallback", Old: "ReadStringTableCString(", New: "LegacyReader(" },
	{ Name: "UntrackDownloadableDirectoryCallback", Old: "g_vecDownloadableFilePaths.size() > kMaximumTrackedDownloadableFilePathCount", New: "false" },
	{ Name: "RestoreDownloadablesCallback", Old: "g_vecDownloadableFilePaths.size() > kMaximumTrackedDownloadableFilePathCount", New: "false" },
	{ Name: "RestoreDownloadablesCallback", Old: "kTrackDownloadableFilePath = false;", New: "kTrackDownloadableFilePath = true;" },
	{ Name: "AddDownloadableDirectoryCallback", Old: "ReadStringTableCString(", New: "LegacyReader(" },
	{ Name: "AddDownloadableDirectoryCallback", Old: "LocalAddedDownloadableFilePathArray.IsEmpty() ||", New: "" },
	{ Name: "AddDownloadableDirectoryCallback", Old: "kDefaultRecursiveTraversal = true;", New: "kDefaultRecursiveTraversal = false;" },
	{ Name: "AddDownloadableDirectoryCallback", Old: "DownloadableDirectoryErrorCode.clear();", New: "" },
	{ Name: "AddDownloadableDirectoryCallback", Old: "itDownloadableDirectoryEntry.increment(DownloadableDirectoryErrorCode);", New: "" },
	{ Name: "AddDownloadableDirectoryCallback", Old: "std::sort(vecCandidateDownloadableFilePaths.begin(), vecCandidateDownloadableFilePaths.end());", New: "" },
	{ Name: "InstallStringTablesDownloadsFunctions", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "InstallStringTablesDownloadsFunctions", Old: "if (!bValueDefined ||", New: "if (" },
	{ Name: "InstallStringTablesDownloadsFunctions", Old: "Callback, LocalRuntimeData", New: "Callback, v8::Undefined(pIsolate)" },
	{ Name: "InstallStringTablesDownloadsFunctions", Old: "DefineFunction(\"RestoreDownloadables\", RestoreDownloadablesCallback)", New: "DefineFunction(\"RestoreDownloadables\", GetDownloadablesListCallback)" },
	{ Name: "ReadStringTableCString", Old: "v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalValue);", New: "v8::String::Utf8Value const UTF8Value(pIsolate, LocalValue);" },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Old: "v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalStringTableStringIndexValue);", New: "v8::String::Utf8Value const UTF8Value(pIsolate, LocalStringTableStringIndexValue);" },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Old: "!pszEncodedStringIndex || StringTableFailure.HasCaught()", New: "StringTableFailure.HasCaught()" },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Old: "static_cast<std::size_t>(UTF8Value.length())", New: "0" },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Old: "MaybeStringTableStringIndexValue.IsNothing() ||", New: "" },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Old: "std::floor(dblStringTableStringIndex) != dblStringTableStringIndex", New: "false" },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Old: "dblStringTableStringIndex > kMaximumStringTableStringIndex", New: "false" },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Old: "dblStringTableStringIndex < kMinimumStringTableStringIndex", New: "false" },
	{ Name: "GetRequiredStringTableStringIndexFromValue", Old: "return true;", New: "return false;" },
	{ Name: "GetRequiredStringCallback", Old: "ReadStringTableCString(pIsolate, LocalStringTableNameValue, StringTableFailure, strStringTableName)", New: "true" },
	{ Name: "GetRequiredStringCallback", Old: "nStringTableStringIndex >= nStringTableStringCount", New: "nStringTableStringIndex > nStringTableStringCount" },
	{ Name: "GetRequiredStringCallback", Old: "!pszStringTableValue ||", New: "" },
	{ Name: "GetRequiredStringCallback", Old: "pszStringTableValue[kStringTableStringBeginOffset] == kStringTableStringTerminatorCharacter", New: "false" },
	{ Name: "AddStringCallback", Old: "ReadStringTableCString(pIsolate, LocalStringTableValue, StringTableFailure, strStringTableValue)", New: "true" },
	{ Name: "AddStringCallback", Old: "AddString(kIsServerSide, strStringTableValue.c_str())", New: "AddString(false, strStringTableValue.c_str())" },
	{ Name: "AddStringCallback", Old: "CallbackInformation.GetReturnValue().Set(nStringTableStringIndex);", New: "CallbackInformation.GetReturnValue().Set(true);" },
	{ Name: "ReadStringUserDataTarget", Old: "nStringIndex < pStringTable->GetNumStrings()", New: "nStringIndex <= pStringTable->GetNumStrings()" },
	{ Name: "GetStringUserDataCallback", Old: "CallbackInformation.GetReturnValue().SetNull();", New: "CallbackInformation.GetReturnValue().Set(false);" },
	{ Name: "SetStringUserDataCallback", Old: "LocalBuffer->IsSharedArrayBuffer() || ", New: "" },
	{ Name: "SetStringUserDataCallback", Old: "LocalBytes->ByteLength() != static_cast<std::size_t>(nByteCount)", New: "false" },
	{ Name: "SetStringUserDataCallback", Old: "LocalBytes->CopyContents(vecBytes.data(), unByteCount) != unByteCount", New: "false" },
	{ Name: "NormalizeStringTablesDownloadPath", Old: "strDownloadPath.find(kDownloadPathTerminatorCharacter) != std::string::npos", New: "false" },
	{ Name: "NormalizeStringTablesDownloadPath", Old: "std::u8string(strNormalizedDownloadPath.begin(), strNormalizedDownloadPath.end())", New: "strNormalizedDownloadPath" },
	{ Name: "NormalizeStringTablesDownloadPath", Old: "PathRelativeDownload.generic_u8string()", New: "PathRelativeDownload.u8string()" },
	{ Name: "AddDownloadableDirectoryCallback", Old: "std::u8string(strDownloadableDirectoryPathInput.begin(), strDownloadableDirectoryPathInput.end())", New: "strDownloadableDirectoryPathInput" },
	{ Name: "AddDownloadableDirectoryCallback", Old: "EncodePathAsUTF8(PathRelativeDownloadableFile)", New: "PathRelativeDownloadableFile.generic_string()" },
	{ Name: "FindStringTablesDownloadableIndex", Old: "strDownloadableFilePath.find('\\0') != std::string::npos", New: "false" },
	{ Name: "AddStringTablesDownloadable", Old: "strDownloadableFilePath.find('\\0') != std::string::npos", New: "false" },
	{ Name: "MakeStringTablesStringArray", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "MakeStringTablesStringArray", Old: "if (!bStringTableValueSet ||", New: "if (" },
	{ Name: "GetDownloadablesTableCallback", Old: "LocalDownloadablesStringTableObject.IsEmpty() ||", New: "" },
	{ Name: "GetTrackedDownloadablesCallback", Old: "LocalTrackedDownloadableFilePathArray.IsEmpty() ||", New: "" },
	{ Name: "GetDownloadablesListCallback", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "GetDownloadablesListCallback", Old: "if (!bDownloadableFilePathSet ||", New: "if (" },
	{ Name: "GetDownloadablesListCallback", Old: "nDownloadableStringIndex < nDownloadableStringCount", New: "nDownloadableStringIndex <= nDownloadableStringCount" },
	{ Name: "GetDownloadableIndexCallback", Old: "ReadStringTableCString(pIsolate, LocalDownloadableFilePathValue, StringTableFailure, strDownloadableFilePathInput)", New: "true" },
	{ Name: "GetDownloadableIndexCallback", Old: "CallbackInformation.GetReturnValue().Set(nDownloadableStringIndex);", New: "CallbackInformation.GetReturnValue().Set(false);" },
	{ Name: "ReadStringTableCString", Old: "!pszEncodedValue || StringTableFailure.HasCaught()", New: "StringTableFailure.HasCaught()" },
	{ Name: "ReadStringTableCString", Old: "static_cast<std::size_t>(UTF8Value.length())", New: "0" },
	{ Name: "ReadStringTableCString", Old: "if (strParsedValue.find('\\0') != std::string::npos)", New: "if (false)" },
	{ Name: "ReadStringTableCString", Old: "strValueOut.swap(strParsedValue);", New: "strValueOut.clear();" },
	{ Name: "GetStringTablesTableProperty", Old: "v8::BigInt::NewFromUnsigned(pIsolate, unStringTableAddress)", New: "v8::Number::New(pIsolate, 0)" },
	{ Name: "GetStringTablesTableProperty", Old: "!LocalPropertyDataValue->IsInt32()", New: "false" },
	{ Name: "GetStringTablesTableProperty", Old: "v8::kEmbedderDataTypeTagDefault", New: "0" },
	{ Name: "InstallStringTablesTableProperty", Old: "v8::ReadOnly | v8::DontDelete", New: "v8::ReadOnly" },
	{ Name: "InstallStringTablesTableProperty", Old: "static_cast<int>(TableProperty)", New: "0" },
	{ Name: "InstallStringTablesTableProperty", Old: "GetStringTablesTableProperty, nullptr, LocalStringTablePropertyValue, kPropertyAttributes", New: "GetStringTablesTableProperty, nullptr" },
	{ Name: "InstallStringTablesTableProperty", Old: "if (!bPropertyInstalled ||", New: "if (" },
	{ Name: "MakeStringTablesTableObject", Old: "kStringTableInternalFieldCount = 1;", New: "kStringTableInternalFieldCount = 0;" },
	{ Name: "MakeStringTablesTableObject", Old: "pStringTable, v8::kEmbedderDataTypeTagDefault);", New: "nullptr, v8::kEmbedderDataTypeTagDefault);" },
	{ Name: "MakeStringTablesTableObject", Old: 'kStringTableAddressPropertyName = "Address";', New: 'kStringTableAddressPropertyName = "m_pAddress";' },
	{ Name: "MakeStringTablesTableObject", Old: "StringTableProperty::MaximumStringCount)", New: "StringTableProperty::StringCount)" },
	{ Name: "GetAllStringTablesCallback", Old: "LocalStringTablesArray->CreateDataProperty(", New: "LocalStringTablesArray->Set(" },
	{ Name: "GetAllStringTablesCallback", Old: "if (!bStringTableObjectSetSucceeded ||", New: "if (" },
	{ Name: "GetAllStringTablesCallback", Old: "nStringTableIndex < nStringTableCount", New: "nStringTableIndex <= nStringTableCount" },
	{ Name: "FindStringTableCallback", Old: "ReadStringTableCString(pIsolate, LocalStringTableNameValue, StringTableFailure, strStringTableName)", New: "true" },
	{ Name: "FindStringTableCallback", Old: "CallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));", New: "CallbackInformation.GetReturnValue().Set(false);" },
	{ Name: "GetStringCallback", Old: "ReadStringTableCString(pIsolate, LocalStringTableNameValue, StringTableFailure, strStringTableName)", New: "true" },
	{ Name: "GetStringCallback", Old: "nStringTableStringIndex >= nStringTableStringCount", New: "nStringTableStringIndex > nStringTableStringCount" },
	{ Name: "GetStringCallback", Old: "kStringTableNameReadErrorMessage);", New: "kFailureErrorMessage);" },
	{ Name: "GetStringCallback", Old: "MakeString(pIsolate, pStringTable->GetString(nStringTableStringIndex))", New: "MakeString(pIsolate, \"\")" },
]) {
	RejectMutation(Mutation.Name, Mutation.Old, Mutation.New);
	++g_unRejectedMutationCount;
}

console.log("String-table native source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/engine execution not exercised.");
