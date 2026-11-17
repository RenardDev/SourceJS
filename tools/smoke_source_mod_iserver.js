#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_source_mod_iserver.js\nChecks source contracts; does not execute native lookups or validate live game signatures.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_source_mod_iserver.js");
	process.exit(2);
}

const g_strNativeSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

const g_vecGuardRegressions = [
	["GetSDKVirtualMethodIndex(&TEngineServer::CreateFakeClient)", "0"],
	["if constexpr (requires { &TEngineServer::CreateFakeClient; })", "if constexpr (true)"],
	['if (ToLowerASCII(pFile->GetString("game", "")) != strGame) {\n\t\t\t\t\tcontinue;\n\t\t\t\t}\n\n\t\t\t\tstd::string_view const strvFileName = pFile->GetName();\n\t\t\t\tif (!PathMatchedFile.empty()', 'if (false) {\n\t\t\t\t\tcontinue;\n\t\t\t\t}\n\n\t\t\t\tstd::string_view const strvFileName = pFile->GetName();\n\t\t\t\tif (!PathMatchedFile.empty()'],
	['!PathMatchedFile.empty() || !strvFileName.ends_with(".txt")', '!strvFileName.ends_with(".txt")'],
	["if (IsSourceModPatternRangeReadable(reinterpret_cast<unsigned char const*>(pResolvedServer), sizeof(void*)))", "if (true)"],
	["(nCreateFakeClientVTableIndex >= 0)", "true"],
	["static_cast<std::size_t>(nCreateFakeClientVTableIndex)", "0"],
	["if constexpr (sizeof(void*) == sizeof(std::uint64_t))", "if constexpr (true)"],
	["InputStream.bad() || OutputStream.fail()", "InputStream.bad()"],
	["unByteCount > (kMaximumAddress - unBeginAddress)", "false"],
	["MemoryInformation.State != MEM_COMMIT", "false"],
	["MemoryInformation.Protect & PAGE_GUARD", "0"],
	["MemoryInformation.Protect & kReadableProtectionFlags", "1"],
	["MemoryInformation.RegionSize > (kMaximumAddress - unRegionBeginAddress)", "false"],
	["unCurrentAddress >= unRegionEndAddress", "false"],
	["unByteOffset += unRegionByteCount;", ""],
	["!IsSourceModPatternRangeReadable(pchBytes, unByteCount)", "false"],
	["unPatternByteIndex >= unByteCount", "false"],
	["unVTableFunctionIndex > kMaximumVTableFunctionIndex", "false"],
	["unFunctionByteOffset > (kMaximumAddress - unVTableAddress)", "false"],
	["!IsSourceModPatternRangeReadable(pchFunctionSlotBytes, sizeof(void*))", "false"],
	["IClient* GetPlayerClientFromIndex(const int nPlayerIndex) {", "IClient* GetPlayerClientFromIndex(const int nPlayerIndex) noexcept {"],
	["GetSourceJSDataPath() / kMemoryDataDirectoryName / strDataGroup / kGlobalAddressFileName", "GetSourceJSDataPath() / kGlobalAddressFileName"],
	["s_pEngineServer = ResolvePackagedIServer();", "s_pEngineServer = nullptr;"],
	["!ScanGlobalAddressGameDataPattern(GameDataInformation.m_strIdentifier, BinaryInformation.m_unBaseAddress, BinaryInformation.m_unByteSize, unIdentifierAddress)", "false"],
	["!ApplyGlobalAddressGameDataTransform(GameDataInformation, unIdentifierAddress, unEngineServerAddress)", "false"],
];

let g_unRejectedRegressionCount = 0;

function ExtractNativeFunction(strSource, strSignature) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecMatches = Array.from(strSource.matchAll(new RegExp("^(\\t{1,2})" + strEscapedSignature + "[^;\\n]*\\)(?: noexcept)?(?: try)? \\{$", "gm")));
	g_Assert.equal(vecMatches.length, 1, strSignature + ": missing or ambiguous native definition");

	const vecMatch = vecMatches[0];
	const nEndIndex = strSource.indexOf("\n" + vecMatch[1] + "}\n", vecMatch.index + vecMatch[0].length);
	g_Assert(nEndIndex > vecMatch.index, strSignature + ": missing native definition boundary");

	return strSource.slice(vecMatch.index, nEndIndex);
}

function VerifyNativeFunctionExtraction() {
	for (const strIndent of ["\t", "\t\t"]) {
		const strPrototype = strIndent + "bool Probe();\n";
		const strDefinition = strIndent + "bool Probe() noexcept {\n" + strIndent + "\treturn true;";
		g_Assert.equal(ExtractNativeFunction(strPrototype + strDefinition + "\n" + strIndent + "}\n", "bool Probe("), strDefinition);
		g_Assert.throws(() => ExtractNativeFunction(strPrototype, "bool Probe("), g_Assert.AssertionError);
	}
}

function AssertSourceModIServerGuards(strSource) {
	const strFileLoader = ExtractNativeFunction(strSource, "SourceJSKeyValuesOwner LoadSDKToolsGameData(");
	g_Assert.match(strFileLoader, /if \(InputStream\.bad\(\) \|\| OutputStream\.fail\(\)\) \{\s*return \{\};/);
	g_Assert.match(strFileLoader, /LoadSourceSDKKeyValuesFromBuffer\(pGameData\.get\(\), pFileSystem, strGameData, false\)/);

	const strGameDataPath = ExtractNativeFunction(strSource, "std::filesystem::path GetSourceModIServerGameDataPath(");
	const strWindowsX86Path = strGameDataPath.split("#if defined(_WIN32) && defined(_M_IX86)\n")[1]?.split("#else")[0] ?? "";
	g_Assert.match(strWindowsX86Path, /master\.games\.txt/);
	g_Assert.match(strWindowsX86Path, /ToLowerASCII\(pFile->GetString\("game", ""\)\) != strGame/);
	g_Assert.match(strWindowsX86Path, /!PathMatchedFile\.empty\(\) \|\| !strvFileName\.ends_with\("\.txt"\)/);
	g_Assert.doesNotMatch(strWindowsX86Path, /ENGINE_LEFT4DEAD2|SOURCEJS_SDK_BRANCH|left4dead2|l4d2/);

	const strLoader = ExtractNativeFunction(strSource, "bool LoadSourceModIServerGameData(");
	g_Assert.match(strLoader, /if constexpr \(sizeof\(void\*\) == sizeof\(std::uint64_t\)\) \{\s*GameDataInformation\.m_strPlatformSignature = pIServerSignature->GetString\("linux64", ""\);/);
	g_Assert.match(strLoader, /LoadSDKToolsGameData\(PathCandidate, "Games"\)/);
	g_Assert.match(strLoader, /if \(GameDataInformation\.m_strLibraryName\.empty\(\) \|\| !bHasRequiredSignature\) \{\s*return false;\s*}\s*GameDataInformationOut = std::move\(GameDataInformation\);/);
	g_Assert.doesNotMatch(strLoader, /ENGINE_LEFT4DEAD2/);

	const strRange = ExtractNativeFunction(strSource, "bool IsSourceModPatternRangeReadable(");
	g_Assert.match(strRange, /!pchBytes \|\| \(unByteCount == 0\)/);
	g_Assert.match(strRange, /unByteCount > \(kMaximumAddress - unBeginAddress\)/);
	g_Assert.match(strRange, /VirtualQuery\([\s\S]*!= sizeof\(MemoryInformation\)/);
	g_Assert.match(strRange, /MemoryInformation\.State != MEM_COMMIT/);
	g_Assert.match(strRange, /MemoryInformation\.Protect & PAGE_GUARD/);
	g_Assert.match(strRange, /MemoryInformation\.Protect & kReadableProtectionFlags/);
	g_Assert.match(strRange, /MemoryInformation\.RegionSize > \(kMaximumAddress - unRegionBeginAddress\)/);
	g_Assert.match(strRange, /unCurrentAddress >= unRegionEndAddress/);
	g_Assert.match(strRange, /unByteOffset \+= unRegionByteCount;/);

	const strMatcher = ExtractNativeFunction(strSource, "bool DoesSourceModPatternMatch(");
	g_Assert.match(strMatcher, /!IsSourceModPatternRangeReadable\(pchBytes, unByteCount\)/);
	g_Assert.match(strMatcher, /if \(unPatternByteIndex >= unByteCount\) \{\s*return false;\s*}[\s\S]*pchBytes\[unPatternByteIndex\]/);

	const strVTable = ExtractNativeFunction(strSource, "void* GetEngineServerVTableFunction(");
	g_Assert.match(strVTable, /!IsSourceModPatternRangeReadable\(pchInterfaceBytes, sizeof\(void\*\)\)/);
	g_Assert.match(strVTable, /std::memcpy\(&ppVTable, pchInterfaceBytes, sizeof\(ppVTable\)\);/);
	g_Assert.match(strVTable, /unVTableFunctionIndex > kMaximumVTableFunctionIndex/);
	g_Assert.match(strVTable, /unFunctionByteOffset > \(kMaximumAddress - unVTableAddress\)/);
	g_Assert.match(strVTable, /!IsSourceModPatternRangeReadable\(pchFunctionSlotBytes, sizeof\(void\*\)\)/);
	g_Assert.match(strVTable, /std::memcpy\(&pFunctionAddress, pchFunctionSlotBytes, sizeof\(pFunctionAddress\)\);/);
	g_Assert.doesNotMatch(strVTable, /reinterpret_cast<void\*\*\*>/);

	const strResolver = ExtractNativeFunction(strSource, "IServer* ResolveIServer(");
	const strDecoder = ExtractNativeFunction(strSource, "int GetSDKVirtualMethodIndex(");
	g_Assert.ok(strSource.indexOf(strDecoder) < strSource.indexOf(strResolver), "Define shared SDK member resolution before IServer discovery");

	const strSDKSlot = ExtractNativeFunction(strSource, "int GetCreateFakeClientVTableIndex(");
	g_Assert.match(strSDKSlot, /if constexpr \(requires \{ &TEngineServer::CreateFakeClient; \}\) \{\s*return GetSDKVirtualMethodIndex\(&TEngineServer::CreateFakeClient\);/);

	g_Assert.ok(strResolver.includes("const int nCreateFakeClientVTableIndex = GetCreateFakeClientVTableIndex<IVEngineServer>();"));
	g_Assert.ok(strResolver.includes("(nCreateFakeClientVTableIndex >= 0) ? GetEngineServerVTableFunction(pEngineServerInterface, static_cast<std::size_t>(nCreateFakeClientVTableIndex)) : nullptr"));
	g_Assert.doesNotMatch(strResolver, /kCreateFakeClientVTableIndex|VTableIndex\s*=\s*\d+/);
	const strPackagedResolver = ExtractNativeFunction(strSource, "IServer* ResolvePackagedIServer(");
	g_Assert.match(strPackagedResolver, /GetSourceJSDataPath\(\) \/ kMemoryDataDirectoryName \/ strDataGroup \/ kGlobalAddressFileName/);
	g_Assert.match(strPackagedResolver, /LoadGlobalAddressGameData\(PathFile, kIServerSectionName, SOURCEJS_TARGET_PLATFORM, sizeof\(void\*\) == sizeof\(std::uint64_t\), GameDataInformation\)/);
	g_Assert.match(strPackagedResolver, /std::filesystem::path\(GameDataInformation\.m_strBinaryName\)\.filename\(\)\.string\(\)/);
	g_Assert.match(strPackagedResolver, /FindMemoryManagerBinary\(strBinaryName, BinaryInformation\)/);
	g_Assert.match(strPackagedResolver, /!ScanGlobalAddressGameDataPattern\(GameDataInformation\.m_strIdentifier, BinaryInformation\.m_unBaseAddress, BinaryInformation\.m_unByteSize, unIdentifierAddress\)/);
	g_Assert.match(strPackagedResolver, /ResolveMemoryManagerSymbol\(strBinaryName, strSymbolName, unIdentifierAddress\)/);
	g_Assert.match(strPackagedResolver, /!ApplyGlobalAddressGameDataTransform\(GameDataInformation, unIdentifierAddress, unEngineServerAddress\)/);
	g_Assert.doesNotMatch(strPackagedResolver, /(?:VTableIndex|AddressOffset)\s*=\s*\d+/);

	const nSDKResolverOffset = strResolver.indexOf("GetIServerFromEngineInterface(pEngineServerInterface)");
	const nPackagedResolverOffset = strResolver.indexOf("s_pEngineServer = ResolvePackagedIServer();");
	const nSourceModResolverOffset = strResolver.indexOf("LoadSourceModIServerGameData(GameDataInformation)");
	g_Assert.ok((nSDKResolverOffset >= 0) && (nSDKResolverOffset < nPackagedResolverOffset) && (nPackagedResolverOffset < nSourceModResolverOffset), "SDK, packaged data, then SourceMod fallback");
	g_Assert.match(strResolver, /sizeof\(IServer\*\) <= \(unPatternByteCount - unEngineServerAddressOffset\)/);
	g_Assert.match(strResolver, /DoesSourceModPatternMatch\(GameDataInformation\.m_strWindowsSignature, pchCreateFakeClientFunctionBytes, unPatternByteCount\)/);
	g_Assert.match(strResolver, /if \(IsSourceModPatternRangeReadable\(reinterpret_cast<unsigned char const\*>\(pResolvedServer\), sizeof\(void\*\)\)\) \{\s*s_pEngineServer = pResolvedServer;/);
	g_Assert.doesNotMatch(strResolver, /ENGINE_LEFT4DEAD2/);
	g_Assert.match(strSource, /IClient\* GetPlayerClientFromIndex\(const int nPlayerIndex\) \{/);
}

VerifyNativeFunctionExtraction();
AssertSourceModIServerGuards(g_strNativeSource);

for (const vecRegression of g_vecGuardRegressions) {
	g_Assert.equal(g_strNativeSource.split(vecRegression[0]).length, 2, vecRegression[0]);

	const strMutatedSource = g_strNativeSource.replace(vecRegression[0], () => vecRegression[1]);
	g_Assert.notEqual(strMutatedSource, g_strNativeSource, vecRegression[0]);
	g_Assert.throws(() => AssertSourceModIServerGuards(strMutatedSource), g_Assert.AssertionError, vecRegression[0]);
	++g_unRejectedRegressionCount;
}

g_Assert.equal(g_unRejectedRegressionCount, g_vecGuardRegressions.length);

console.log("Packaged/SourceMod IServer source guards passed: " + g_unRejectedRegressionCount + " rejected regressions; no native lookup or live game signature validation.");
