#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_gamerules_address_native_contracts.js [--help | --build-tree <configured-production-build>]\nWithout arguments: source contracts. With --build-tree: native proxy-name metadata cases and compiled regressions with SDK providers adapted; no V8/engine execution.";
const g_vecStructuredBoundaries = [
	{ Name: "GetGameRulesColorComponent", Guards: 3, Result: "false" },
	{ Name: "GetGameRulesColorFromValue", Guards: 4, Result: "false" },
	{ Name: "GetGameRulesBytePropertyAddress", Guards: 0, Result: "nullptr" },
	{ Name: "GetGameRulesByteComponentPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesByteComponentPropertyCallback", Guards: 2 },
	{ Name: "InstallGameRulesByteProperty", Guards: 3, Result: "false" },
	{ Name: "MakeGameRulesColorObject", Guards: 8, Result: "{}" },
	{ Name: "GetGameRulesColorPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesColorPropertyCallback", Guards: 2 },
	{ Name: "GetGameRulesObjectFloatComponent", Guards: 3, Result: "false" },
	{ Name: "MakeGameRulesIntervalObject", Guards: 6, Result: "{}" },
	{ Name: "GetGameRulesIntervalPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesIntervalPropertyCallback", Guards: 3 },
	{ Name: "MakeGameRulesQuaternionObject", Guards: 8, Result: "{}" },
];
const g_vecPublicBoundaries = [
	{ Name: "GetGameRulesQuaternionPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesQuaternionPropertyCallback", Guards: 5 },
	{ Name: "GetGameRulesEdictPropertyCallback", Guards: 3 },
	{ Name: "SetGameRulesEdictPropertyCallback", Guards: 3 },
	{ Name: "IsEngineGameRulesAvailableCallback", Guards: 1 },
	{ Name: "GetEngineGameRulesProxyNameCallback", Guards: 2 },
	{ Name: "GetEngineGameRulesAddressCallback", Guards: 2 },
	{ Name: "GetEngineGameRulesSendTableNameCallback", Guards: 3 },
	{ Name: "FindEngineGameRulesPropertyOffsetCallback", Guards: 1 },
	{ Name: "FindEngineGameRulesCallback", Guards: 2 },
	{ Name: "ListEngineGameRulesPropertiesCallback", Guards: 3 },
	{ Name: "InstallGameRulesFunction", Guards: 3, Result: "false" },
	{ Name: "InstallGameRulesFunctions", Guards: 47, Result: "false" },
];
const g_vecFunctionRegistrations = [
	{ Name: "IsAvailable", Callback: "IsEngineGameRulesAvailableCallback" },
	{ Name: "GetAddress", Callback: "GetEngineGameRulesAddressCallback" },
	{ Name: "GetProxyName", Callback: "GetEngineGameRulesProxyNameCallback" },
	{ Name: "GetSendTableName", Callback: "GetEngineGameRulesSendTableNameCallback" },
	{ Name: "FindPropertyOffset", Callback: "FindEngineGameRulesPropertyOffsetCallback" },
	{ Name: "Find", Callback: "FindEngineGameRulesCallback" },
	{ Name: "ListProperties", Callback: "ListEngineGameRulesPropertiesCallback" },
	{ Name: "GetPropertyBoolean", Callback: "GetGameRulesBooleanPropertyCallback" },
	{ Name: "GetPropertyCharacter", Callback: "GetGameRulesCharacterPropertyCallback" },
	{ Name: "GetPropertyInt8", Callback: "GetGameRulesSignedIntegerPropertyCallback<std::int8_t>" },
	{ Name: "GetPropertyUInt8", Callback: "GetGameRulesUnsignedIntegerPropertyCallback<std::uint8_t>" },
	{ Name: "GetPropertyInt16", Callback: "GetGameRulesSignedIntegerPropertyCallback<std::int16_t>" },
	{ Name: "GetPropertyUInt16", Callback: "GetGameRulesUnsignedIntegerPropertyCallback<std::uint16_t>" },
	{ Name: "GetPropertyInt32", Callback: "GetGameRulesSignedIntegerPropertyCallback<std::int32_t>" },
	{ Name: "GetPropertyUInt32", Callback: "GetGameRulesUnsignedIntegerPropertyCallback<std::uint32_t>" },
	{ Name: "GetPropertyInt64", Callback: "GetGameRulesSignedIntegerPropertyCallback<std::int64_t>" },
	{ Name: "GetPropertyUInt64", Callback: "GetGameRulesUnsignedIntegerPropertyCallback<std::uint64_t>" },
	{ Name: "GetPropertyFloat", Callback: "GetGameRulesFloatPropertyCallback" },
	{ Name: "GetPropertyDouble", Callback: "GetGameRulesDoublePropertyCallback" },
	{ Name: "GetPropertyStringAddress", Callback: "GetGameRulesStringAddressPropertyCallback" },
	{ Name: "GetPropertyStringBuffer", Callback: "GetGameRulesStringBufferPropertyCallback" },
	{ Name: "GetPropertyAddress", Callback: "GetGameRulesAddressPropertyCallback" },
	{ Name: "GetPropertyVector", Callback: "GetGameRulesVectorPropertyCallback" },
	{ Name: "GetPropertyColor", Callback: "GetGameRulesColorPropertyCallback" },
	{ Name: "GetPropertyInterval", Callback: "GetGameRulesIntervalPropertyCallback" },
	{ Name: "GetPropertyQuaternion", Callback: "GetGameRulesQuaternionPropertyCallback" },
	{ Name: "GetPropertyEdict", Callback: "GetGameRulesEdictPropertyCallback" },
	{ Name: "SetPropertyBoolean", Callback: "SetGameRulesBooleanPropertyCallback" },
	{ Name: "SetPropertyCharacter", Callback: "SetGameRulesCharacterPropertyCallback" },
	{ Name: "SetPropertyInt8", Callback: "SetGameRulesSignedIntegerPropertyCallback<std::int8_t>" },
	{ Name: "SetPropertyUInt8", Callback: "SetGameRulesUnsignedIntegerPropertyCallback<std::uint8_t>" },
	{ Name: "SetPropertyInt16", Callback: "SetGameRulesSignedIntegerPropertyCallback<std::int16_t>" },
	{ Name: "SetPropertyUInt16", Callback: "SetGameRulesUnsignedIntegerPropertyCallback<std::uint16_t>" },
	{ Name: "SetPropertyInt32", Callback: "SetGameRulesSignedIntegerPropertyCallback<std::int32_t>" },
	{ Name: "SetPropertyUInt32", Callback: "SetGameRulesUnsignedIntegerPropertyCallback<std::uint32_t>" },
	{ Name: "SetPropertyInt64", Callback: "SetGameRulesSignedIntegerPropertyCallback<std::int64_t>" },
	{ Name: "SetPropertyUInt64", Callback: "SetGameRulesUnsignedIntegerPropertyCallback<std::uint64_t>" },
	{ Name: "SetPropertyFloat", Callback: "SetGameRulesFloatPropertyCallback" },
	{ Name: "SetPropertyDouble", Callback: "SetGameRulesDoublePropertyCallback" },
	{ Name: "SetPropertyStringAddress", Callback: "SetGameRulesStringAddressPropertyCallback" },
	{ Name: "SetPropertyStringBuffer", Callback: "SetGameRulesStringBufferPropertyCallback" },
	{ Name: "SetPropertyAddress", Callback: "SetGameRulesAddressPropertyCallback" },
	{ Name: "SetPropertyVector", Callback: "SetGameRulesVectorPropertyCallback" },
	{ Name: "SetPropertyColor", Callback: "SetGameRulesColorPropertyCallback" },
	{ Name: "SetPropertyInterval", Callback: "SetGameRulesIntervalPropertyCallback" },
	{ Name: "SetPropertyQuaternion", Callback: "SetGameRulesQuaternionPropertyCallback" },
	{ Name: "SetPropertyEdict", Callback: "SetGameRulesEdictPropertyCallback" },
];
const g_vecPublicReadResults = [
	{ Name: "GetGameRulesQuaternionPropertyCallback", Build: "MakeGameRulesQuaternionObject(", Checked: "if (LocalQuaternionObject.IsEmpty()", Value: "LocalQuaternionObject" },
	{ Name: "GetGameRulesEdictPropertyCallback", Build: "MakeEntityObject(", Checked: "if (LocalEdictEntityObject.IsEmpty()", Value: "LocalEdictEntityObject" },
	{ Name: "IsEngineGameRulesAvailableCallback", Build: "const bool bGameRulesAvailable = GetGameRulesAddress() != nullptr;", Checked: "if (GameRulesFailure.HasCaught()", Value: "bGameRulesAvailable" },
	{ Name: "GetEngineGameRulesProxyNameCallback", Build: "MakeString(pIsolate, strGameRulesProxyName)", Checked: "if (LocalGameRulesProxyName.IsEmpty()", Value: "LocalGameRulesProxyName" },
	{ Name: "GetEngineGameRulesAddressCallback", Build: "MakeGameRulesAddressValue(", Checked: "if (LocalGameRulesAddress.IsEmpty()", Value: "LocalGameRulesAddress" },
	{ Name: "GetEngineGameRulesSendTableNameCallback", Build: "MakeString(pIsolate, pszGameRulesSendTableName)", Checked: "if (LocalGameRulesSendTableName.IsEmpty()", Value: "LocalGameRulesSendTableName" },
	{ Name: "FindEngineGameRulesPropertyOffsetCallback", Build: "if (!GetGameRulesPropertyOffsetFromNameOrPathArgument(", Value: "nGameRulesPropertyOffset" },
	{ Name: "FindEngineGameRulesCallback", Build: "CallbackInformation.This()", Checked: "if (LocalGameRulesObject.IsEmpty()", Value: "LocalGameRulesObject" },
	{ Name: "ListEngineGameRulesPropertiesCallback", Build: "v8::Array::New(pIsolate)", Checked: "if (LocalGameRulesPropertyInformationArray.IsEmpty()", Value: "LocalGameRulesPropertyInformationArray" },
];
const g_vecPropertyBoundaries = [
	{ Name: "MakeGameRulesPropertyInformationObject", Guards: 3, Result: "{}" },
	{ Name: "CollectGameRulesPropertyInformationObjects", Guards: 3, Result: "false" },
	{ Name: "RequireGameRulesPropertyNameArgument", Guards: 1, Result: "false" },
	{ Name: "GetGameRulesPropertyOffsetFromNameOrPathArgument", Guards: 1, Result: "false" },
	{ Name: "GetGameRulesPropertyAddress", Guards: 1, Result: "nullptr" },
	{ Name: "GetGameRulesSignedIntegerPropertyCallback", Guards: 2 },
	{ Name: "GetGameRulesUnsignedIntegerPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesSignedIntegerPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesUnsignedIntegerPropertyCallback", Guards: 2 },
	{ Name: "GetGameRulesBooleanPropertyCallback", Guards: 1 },
	{ Name: "SetGameRulesBooleanPropertyCallback", Guards: 1 },
	{ Name: "GetGameRulesCharacterPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesCharacterPropertyCallback", Guards: 3 },
	{ Name: "GetGameRulesFloatPropertyCallback", Guards: 2 },
	{ Name: "GetGameRulesDoublePropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesFloatPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesDoublePropertyCallback", Guards: 2 },
	{ Name: "GetGameRulesStringAddressPropertyCallback", Guards: 2 },
	{ Name: "GetGameRulesStringBufferPropertyCallback", Guards: 3 },
	{ Name: "SetGameRulesStringAddressPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesStringBufferPropertyCallback", Guards: 3 },
	{ Name: "GetGameRulesAddressPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesAddressPropertyCallback", Guards: 2 },
	{ Name: "GetGameRulesVectorFromValue", Guards: 1, Result: "false" },
	{ Name: "GetGameRulesFloatPropertyAddress", Guards: 0, Result: "nullptr" },
	{ Name: "GetGameRulesFloatComponentPropertyCallback", Guards: 1 },
	{ Name: "SetGameRulesFloatComponentPropertyCallback", Guards: 2 },
	{ Name: "InstallGameRulesFloatProperty", Guards: 3, Result: "false" },
	{ Name: "MakeGameRulesVectorObject", Guards: 7, Result: "{}" },
	{ Name: "GetGameRulesVectorPropertyCallback", Guards: 2 },
	{ Name: "SetGameRulesVectorPropertyCallback", Guards: 2 },
	...g_vecStructuredBoundaries,
	...g_vecPublicBoundaries,
];
const g_vecScalarReads = [
	{ Name: "GetGameRulesBooleanPropertyCallback", Value: "bGameRulesPropertyValue", Result: "bGameRulesPropertyValue" },
	{ Name: "GetGameRulesCharacterPropertyCallback", Value: "chGameRulesPropertyValue", Result: "LocalGameRulesCharacterString" },
	{ Name: "GetGameRulesFloatPropertyCallback", Value: "flGameRulesPropertyValue", Result: "LocalGameRulesPropertyValue" },
	{ Name: "GetGameRulesDoublePropertyCallback", Value: "dblGameRulesPropertyValue", Result: "LocalGameRulesPropertyValue" },
	{ Name: "GetGameRulesStringAddressPropertyCallback", Value: "pszGameRulesPropertyValue", Result: "LocalGameRulesPropertyString" },
	{ Name: "GetGameRulesAddressPropertyCallback", Value: "pGameRulesAddressValue", Result: "LocalGameRulesAddressValue" },
];
const g_vecScalarWrites = [
	{ Name: "SetGameRulesSignedIntegerPropertyCallback", Value: "nGameRulesPropertyValue" },
	{ Name: "SetGameRulesUnsignedIntegerPropertyCallback", Value: "unGameRulesPropertyValue" },
	{ Name: "SetGameRulesBooleanPropertyCallback", Value: "bGameRulesPropertyValue" },
	{ Name: "SetGameRulesCharacterPropertyCallback", Value: "chGameRulesPropertyValue" },
	{ Name: "SetGameRulesFloatPropertyCallback", Value: "flGameRulesPropertyValue" },
	{ Name: "SetGameRulesDoublePropertyCallback", Value: "dblGameRulesPropertyValue" },
	{ Name: "SetGameRulesAddressPropertyCallback", Value: "pGameRulesAddressValue" },
];

const g_vecArguments = process.argv.slice(2);
const g_bNativeProxyName = (g_vecArguments.length === 2) && (g_vecArguments[0] === "--build-tree") && Boolean(g_vecArguments[1]);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

if ((g_vecArguments.length !== 0) && !g_bNativeProxyName) {
	console.error(g_strUsage);
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

const g_strProxyNameFixture = String.raw`
// C++
#include <cstddef>
#include <cstdio>
#include <cstring>

// STL
#include <limits>
#include <stdexcept>
#include <string>

namespace {
	constexpr int kInvalidStringIndex = -1;
	constexpr std::size_t kBitsPerByte = 8;

	struct ProxyNameStringTable {
		int FindStringIndex(char const* const pszName) const noexcept {
			return (pszName && (std::strcmp(pszName, "classname") == 0)) ? m_nStringIndex : kInvalidStringIndex;
		}

		void const* GetStringUserData(const int nIndex, int* const pnByteCountOut) const noexcept {
			if (!pnByteCountOut || (nIndex != m_nStringIndex)) {
				return nullptr;
			}

			*pnByteCountOut = m_nByteCount;

			return m_pData;
		}

		void const* m_pData;
		int m_nByteCount;
		int m_nStringIndex;
	};

	struct ProxyNameStringTableContainer {
		ProxyNameStringTable* FindTable(char const* const pszName) const noexcept {
			return (pszName && (std::strcmp(pszName, "GameRulesCreation") == 0)) ? m_pTable : nullptr;
		}

		ProxyNameStringTable* m_pTable;
	};

	struct ProxyNameEngineInterfaces {
		ProxyNameStringTableContainer* GetNetworkStringTableContainer() const noexcept {
			return m_pContainer;
		}

		ProxyNameStringTableContainer* m_pContainer;
	};

	struct ProxyNameApplication {
		ProxyNameEngineInterfaces& GetEngineInterfaces() noexcept {
			return m_Interfaces;
		}

		ProxyNameEngineInterfaces m_Interfaces;
	};

	constinit ProxyNameApplication g_Application {};

	// Exact SDK sentinel consumed by the extracted helper; providers above are controlled models, not SDK ABI objects.
#define INVALID_STRING_INDEX kInvalidStringIndex
@PROXY_HELPER@
#undef INVALID_STRING_INDEX

	struct ProxyNameCase {
		void const* m_pData;
		int m_nByteCount;
		std::string m_strExpected;
	};

	void Require(const bool bCondition) {
		if (!bCondition) {
			throw std::runtime_error("proxy-name contract mismatch");
		}
	}

	std::size_t RunProxyNameCases() {
		constexpr char kTerminatedName[] = "Rules";
		constexpr char kUnterminatedName[] = { 'R', 'u', 'l', 'e', 's' };
		constexpr char kEmptyName[] = { '\0' };
		constexpr char kEmbeddedNULName[] = { 'A', '\0', 'B' };
		constexpr char kTwoTrailingNULName[] = { 'A', '\0', '\0' };
		constexpr std::size_t kMissingProviderCaseCount = 3;
		constexpr int kTerminatedNameByteCount = static_cast<int>(sizeof(kTerminatedName));
		constexpr int kUnterminatedNameByteCount = static_cast<int>(sizeof(kUnterminatedName));
		constexpr int kPrefixNameByteCount = 3;

		ProxyNameStringTable Table {};
		ProxyNameStringTableContainer Container {};

		Require(GetGameRulesProxyClassName().empty());

		g_Application.m_Interfaces.m_pContainer = &Container;
		Require(GetGameRulesProxyClassName().empty());

		Container.m_pTable = &Table;
		Table.m_nStringIndex = kInvalidStringIndex;
		Require(GetGameRulesProxyClassName().empty());

		Table.m_nStringIndex = 0;

		ProxyNameCase const arrCases[] = {
			{ kTerminatedName, 0, {} },
			{ kTerminatedName, -1, {} },
			{ kTerminatedName, std::numeric_limits<int>::min(), {} },
			{ nullptr, kTerminatedNameByteCount, {} },
			{ kTerminatedName, kTerminatedNameByteCount, "RulesProxy" },
			{ kUnterminatedName, kUnterminatedNameByteCount, "RulesProxy" },
			{ kTerminatedName, kPrefixNameByteCount, "RulProxy" },
			{ kEmptyName, static_cast<int>(sizeof(kEmptyName)), {} },
			{ kEmbeddedNULName, static_cast<int>(sizeof(kEmbeddedNULName)), std::string(kEmbeddedNULName, sizeof(kEmbeddedNULName)) + "Proxy" },
			{ kTwoTrailingNULName, static_cast<int>(sizeof(kTwoTrailingNULName)), std::string(kTwoTrailingNULName, sizeof(kTwoTrailingNULName) - sizeof(char)) + "Proxy" },
		};
		std::size_t unCaseCount = kMissingProviderCaseCount;
		for (auto const& Case : arrCases) {
			Table.m_pData = Case.m_pData;
			Table.m_nByteCount = Case.m_nByteCount;
			Require(GetGameRulesProxyClassName() == Case.m_strExpected);
			++unCaseCount;
		}

		g_Application.m_Interfaces.m_pContainer = nullptr;

		return unCaseCount;
	}
} // namespace

int main() {
	try {
		const std::size_t unCaseCount = RunProxyNameCases();
		std::printf("GameRulesProxyNameContracts PASS Cases=%zu AddressBits=%zu\n", unCaseCount, sizeof(void*) * kBitsPerByte);

		return 0;
	} catch (std::exception const& Exception) {
		g_Application.m_Interfaces.m_pContainer = nullptr;
		std::fprintf(stderr, "GameRulesProxyNameContracts failed: %s.\n", Exception.what());
		return 1;
	}
}
`;

function GetRawDefinition(strSource, strFunctionName) {
	const vecMatch = new RegExp("^(\\t{1,2})(?:bool|char\\*|unsigned char\\*|float\\*|void|std::string|v8::Local<v8::(?:BigInt|Object)>) " + strFunctionName + "\\([^\\n;{}]*\\) (?:noexcept )?\\{", "m").exec(strSource);
	g_Assert(vecMatch, "Missing native definition: " + strFunctionName);

	const vecClosing = new RegExp("^" + vecMatch[1] + "\\}$", "m").exec(strSource.slice(vecMatch.index));
	g_Assert(vecClosing && (vecClosing.index > 0));

	return strSource.slice(vecMatch.index, vecMatch.index + vecClosing.index + vecClosing[0].length);
}

function GetDefinition(strSource, strFunctionName) {
	const strActualDefinition = GetRawDefinition(strSource, strFunctionName);
	const bNested = strActualDefinition.startsWith("\t\t");
	const strDefinition = bNested ? strActualDefinition.replace(/^\t/gm, "") : strActualDefinition;
	g_Assert.equal(bNested ? strDefinition.replace(/^\t/gm, "\t\t") : strDefinition, strActualDefinition, "Normalize namespace indentation reversibly without changing preprocessor lines.");

	return strDefinition;
}

function RunNativeProxyNameProbe(strBuildTree) {
	const unTimeoutMilliseconds = 300000;
	const unMaximumOutputByteCount = 16 * 1024 * 1024;
	const strProjectRoot = g_FileSystem.realpathSync(g_Path.resolve(__dirname, ".."));
	const strBuildTreePath = g_FileSystem.realpathSync(g_Path.resolve(strBuildTree));
	const strCache = g_FileSystem.readFileSync(g_Path.join(strBuildTreePath, "CMakeCache.txt"), "utf8");
	const ReadCache = (strKey, bRequired = true) => {
		const Match = new RegExp("^" + strKey + ":[^=]+=(.*)$", "m").exec(strCache);
		g_Assert(!bRequired || Match, "Missing production cache key: " + strKey);

		return Match ? Match[1].trim() : "";
	};
	const Run = (strCommand, vecArguments, nExpectedExit = 0) => {
		const vecDisplayArguments = [strCommand, ...vecArguments].map(strArgument => {
			if (!g_Path.isAbsolute(strArgument)) {
				return strArgument;
			}

			const strRelative = g_Path.relative(strProjectRoot, strArgument);

			return g_Path.isAbsolute(strRelative) ? strArgument : strRelative;
		});
		const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: strProjectRoot, encoding: "utf8", windowsHide: true, timeout: unTimeoutMilliseconds, maxBuffer: unMaximumOutputByteCount });
		const strContext = JSON.stringify(vecDisplayArguments);
		g_Assert.equal(Result.error, undefined, strContext + ": " + Result.error?.message);
		g_Assert.equal(Result.signal, null, strContext + ": unexpected signal");
		g_Assert.equal(Result.status, nExpectedExit, strContext + ": " + Result.stdout + Result.stderr);
		g_Assert.doesNotMatch(Result.stdout + Result.stderr, /\bwarning(?:\s+[A-Z]\d+)?\s*:|\bruntime error:|\b(?:AddressSanitizer|UndefinedBehaviorSanitizer)\b/i, strContext);

		return Result;
	};

	const strCacheProjectRoot = g_FileSystem.realpathSync(ReadCache("CMAKE_HOME_DIRECTORY"));
	g_Assert.equal(g_FileSystem.readFileSync(g_Path.join(strCacheProjectRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n"), g_strSource, "Use a production build tree with the same current project source.");
	g_Assert((process.platform === "win32") || (process.platform === "linux"));
	g_Assert.equal(g_strProxyNameFixture.split("@PROXY_HELPER@").length, 2);

	const strHelper = GetDefinition(g_strSource, "GetGameRulesProxyClassName");
	const strBuildRoot = g_FileSystem.realpathSync(g_Path.join(strProjectRoot, "build"));
	const strDirectory = g_FileSystem.mkdtempSync(g_Path.join(strBuildRoot, "NativeGameRulesProxyName-"));
	const strBinaryRoot = g_Path.join(strDirectory, "compiled");
	const strFixturePath = g_Path.join(strDirectory, "Probe.cpp");
	const strSourceGuard = "if (!pszGameRulesClassName || (nGameRulesClassNameDataLength <= 0))";
	const strBoundedLength = "std::size_t unGameRulesClassNameLength = static_cast<std::size_t>(nGameRulesClassNameDataLength);";
	const vecCases = [
		{ Name: "Current", Changes: [], ExpectedExit: 0 },
		{ Name: "OriginalUnboundedFallback", Changes: [[strSourceGuard, "if (!pszGameRulesClassName)"], [strBoundedLength, "std::size_t unGameRulesClassNameLength = (nGameRulesClassNameDataLength > 0) ? static_cast<std::size_t>(nGameRulesClassNameDataLength) : std::strlen(pszGameRulesClassName);"]], ExpectedExit: 1 },
		{ Name: "WrongProxySuffix", Changes: [['kGameRulesProxyClassNameSuffix = "Proxy";', 'kGameRulesProxyClassNameSuffix = "Wrong";']], ExpectedExit: 1 },
		{ Name: "TrailingTerminatorRetained", Changes: [["--unGameRulesClassNameLength;", ""]], ExpectedExit: 1 },
		{ Name: "RestoredCurrent", Changes: [], ExpectedExit: 0 },
	];
	let unAddressBits = 0;
	let bOperationFailed = false;
	let OperationFailure = undefined;

	try {
		g_FileSystem.writeFileSync(g_Path.join(strDirectory, "CMakeLists.txt"), [
			"cmake_minimum_required(VERSION 3.20)",
			"project(GameRulesProxyNameContracts LANGUAGES CXX)",
			"add_executable(Probe Probe.cpp)",
			"target_compile_features(Probe PRIVATE cxx_std_20)",
			"if(MSVC)",
			"\ttarget_compile_options(Probe PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)",
			"elseif(CMAKE_CXX_COMPILER_ID MATCHES \"GNU|Clang\")",
			"\ttarget_compile_options(Probe PRIVATE -Wall -Wextra -Werror -pedantic -fsanitize=undefined -fno-sanitize-recover=undefined)",
			"\ttarget_link_options(Probe PRIVATE -fsanitize=undefined)",
			"else()",
			"\tmessage(FATAL_ERROR \"Unsupported fixture compiler\")",
			"endif()",
			"",
		].join("\n"));
		let bConfigured = false;

		for (const Case of vecCases) {
			g_Assert.match(Case.Name, /^[A-Z][A-Za-z0-9]+$/);
			let strCaseHelper = strHelper;
			for (const [strOld, strNew] of Case.Changes) {
				g_Assert.equal(strCaseHelper.split(strOld).length, 2, Case.Name + ": exact mutation anchor");
				strCaseHelper = strCaseHelper.replace(strOld, () => strNew);
			}

			const strProgram = g_strProxyNameFixture.replace("@PROXY_HELPER@", () => strCaseHelper);
			g_FileSystem.writeFileSync(strFixturePath, strProgram + "\n// Generated-only; smoke_gamerules_address_native_contracts.js owns this fixture.\n");

			if (!bConfigured) {
				const vecConfigure = ["-S", strDirectory, "-B", strBinaryRoot, "-G", ReadCache("CMAKE_GENERATOR"), "-DCMAKE_CXX_FLAGS=" + ReadCache("CMAKE_CXX_FLAGS", false)];
				if (process.platform === "win32") {
					vecConfigure.push("-A", ReadCache("CMAKE_GENERATOR_PLATFORM"));
				} else {
					vecConfigure.push("-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_COMPILER=" + ReadCache("CMAKE_CXX_COMPILER"));
				}

				Run("cmake", vecConfigure);
				bConfigured = true;
			}

			console.log("Game-rules proxy-name native: " + Case.Name + " compiling");
			Run("cmake", ["--build", strBinaryRoot, "--config", "Release", "--target", "Probe", "--parallel", "2"]);
			let strExecutable = g_Path.join(strBinaryRoot, (process.platform === "win32") ? "Release/Probe.exe" : "Probe");
			if (process.platform === "win32") {
				const strExecutionRoot = g_FileSystem.mkdtempSync(g_Path.join(strDirectory, "Execution-" + Case.Name + "-"));
				const strExecutionImage = g_Path.join(strExecutionRoot, "Probe.exe");
				g_FileSystem.copyFileSync(strExecutable, strExecutionImage, g_FileSystem.constants.COPYFILE_EXCL);
				strExecutable = strExecutionImage;
			}

			const Result = Run(strExecutable, [], Case.ExpectedExit);
			if (Case.ExpectedExit === 0) {
				const Match = /^GameRulesProxyNameContracts PASS Cases=13 AddressBits=(32|64)\n$/.exec(Result.stdout.replace(/\r\n/g, "\n"));
				g_Assert(Match, "Current native proxy-name case records");
				g_Assert.equal(Result.stderr, "");
				const unCurrentAddressBits = Number(Match[1]);
				g_Assert((unAddressBits === 0) || (unCurrentAddressBits === unAddressBits));
				unAddressBits = unCurrentAddressBits;
			} else {
				g_Assert.equal(Result.stdout, "");
				g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), "GameRulesProxyNameContracts failed: proxy-name contract mismatch.\n", "Reject through the native oracle, not a crash or environment failure.");
			}
		}
	} catch (ExceptionValue) {
		bOperationFailed = true;
		OperationFailure = ExceptionValue;
		throw ExceptionValue;
	} finally {
		try {
			const Status = g_FileSystem.lstatSync(strDirectory);
			const strResolved = g_FileSystem.realpathSync(strDirectory);
			const strRelative = g_Path.relative(strBuildRoot, strResolved);
			g_Assert(Status.isDirectory() && !Status.isSymbolicLink() && (g_Path.dirname(strResolved) === strBuildRoot) && (strRelative === g_Path.basename(strDirectory)) && /^NativeGameRulesProxyName-[^/\\]+$/.test(strRelative), "Refuse cleanup outside the exact allocated fixture directory.");
			g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
		} catch (CleanupError) {
			if (bOperationFailed) {
				throw new AggregateError([OperationFailure, CleanupError], "Proxy-name check and cleanup both failed.");
			}

			throw CleanupError;
		}
	}

	console.log("Game-rules proxy-name native checks PASS; AddressBits=" + unAddressBits + "; Cases=13; compiled regressions=3; SDK providers adapted; no live V8/engine execution; temporary fixture cleaned.");
}

function CheckFragmentOrder(strDefinition, vecFragments) {
	let nPreviousIndex = -1;
	for (const strFragment of vecFragments) {
		const nIndex = strDefinition.indexOf(strFragment);
		g_Assert(nIndex >= 0, "Missing ordered fragment: " + strFragment);
		g_Assert(nIndex > nPreviousIndex, "Unexpected fragment order: " + strFragment);
		nPreviousIndex = nIndex;
	}
}

function GetFailureBranches(strDefinition) {
	return [...strDefinition.matchAll(/^\t+if \([^\n]*GameRulesFailure\.HasCaught\(\)[^\n]*\) \{\n\t+(RethrowV8InstallationFailure\([^\n]+\);)\n\t+return(?: [^\n;]+)?;/gm)];
}

function GetFunctionRegistrations(strDefinition) {
	return [...strDefinition.matchAll(/InstallGameRulesFunction\(pIsolate, LocalContext, LocalGameRulesObject, "([^"]+)", ([^,\n]+), LocalRuntimeData\)/g)].map(vecMatch => ({ Name: vecMatch[1], Callback: vecMatch[2] }));
}

function CheckContracts(strSource) {
	const strProxyName = GetDefinition(strSource, "GetGameRulesProxyClassName");
	g_Assert(strProxyName.includes('kGameRulesCreationTableName = "GameRulesCreation";'));
	g_Assert(strProxyName.includes('kGameRulesClassNameEntryName = "classname";'));
	g_Assert(strProxyName.includes('kGameRulesProxyClassNameSuffix = "Proxy";'));
	g_Assert(strProxyName.includes("if (!pszGameRulesClassName || (nGameRulesClassNameDataLength <= 0))"));
	g_Assert(strProxyName.includes("std::size_t unGameRulesClassNameLength = static_cast<std::size_t>(nGameRulesClassNameDataLength);"));
	g_Assert(strProxyName.includes("pszGameRulesClassName[unGameRulesClassNameLength - kLastGameRulesClassNameCharacterOffset]"));
	g_Assert.doesNotMatch(strProxyName, /std::strlen\s*\(/, "Use only the positive SDK byte extent, never an unbounded fallback.");

	const strRead = GetDefinition(strSource, "GetGameRulesAddressFromValue");
	g_Assert(strRead.includes("!LocalGameRulesAddressValue->IsBigInt()"));
	g_Assert(strRead.includes("bool bGameRulesAddressConversionLossless = false;"));
	g_Assert(strRead.includes("Uint64Value(&bGameRulesAddressConversionLossless)"));
	g_Assert(strRead.includes("!bGameRulesAddressConversionLossless || (unGameRulesAddress > std::numeric_limits<std::uintptr_t>::max())"));
	g_Assert(strRead.includes("unGameRulesAddressOut = static_cast<std::uintptr_t>(unGameRulesAddress);\n\n\t\treturn true;"));

	const strBuild = GetDefinition(strSource, "MakeGameRulesAddressValue");
	const strRethrow = "RethrowV8InstallationFailure(pIsolate, GameRulesFailure, kFailureErrorMessage);";
	const nFrame = strBuild.indexOf("v8::TryCatch GameRulesFailure(pIsolate);\n\t\ttry {");
	g_Assert(nFrame >= 0);
	g_Assert(!strBuild.slice(0, nFrame).includes(strRethrow));
	g_Assert(strBuild.includes("} catch (std::exception const&) {\n\t\t\t" + strRethrow));
	g_Assert(strBuild.includes("} catch (...) {\n\t\t\t" + strRethrow));
	g_Assert(strBuild.includes("static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pGameRulesAddress))"));
	g_Assert(strBuild.includes("v8::BigInt::NewFromUnsigned(pIsolate, unGameRulesAddress)"));
	g_Assert(strBuild.includes("if (LocalGameRulesAddressValue.IsEmpty() || GameRulesFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn {};\n\t\t\t}"));
	g_Assert(strBuild.includes("\n\n\t\t\treturn LocalGameRulesAddressValue;"));
	g_Assert(strBuild.endsWith("\n\n\t\treturn {};\n\t}"));
	g_Assert.doesNotMatch(strBuild, /v8::Number|noexcept|static_cast<double>/);

	for (const strGuard of ["GameRulesFailure.HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
		g_Assert.equal(strBuild.split(strGuard).length - 1, 1);
	}

	for (const Boundary of g_vecPropertyBoundaries) {
		const strDefinition = GetDefinition(strSource, Boundary.Name);
		const nBoundaryFrame = strDefinition.indexOf("v8::TryCatch GameRulesFailure(pIsolate);\n\t\ttry {");
		g_Assert(nBoundaryFrame >= 0);
		g_Assert(!strDefinition.slice(0, nBoundaryFrame).includes("RethrowV8InstallationFailure("));
		g_Assert(strDefinition.includes("} catch (std::exception const&) {\n\t\t\t" + strRethrow));
		g_Assert(strDefinition.includes("} catch (...) {\n\t\t\t" + strRethrow));
		g_Assert.doesNotMatch(strDefinition, /ThrowError\(|noexcept/);

		if (Boundary.Result !== undefined) {
			g_Assert(strDefinition.endsWith("\n\n\t\treturn " + Boundary.Result + ";\n\t}"));
		}

		for (const strGuard of ["GameRulesFailure.HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
			g_Assert.equal(strDefinition.split(strGuard).length - 1, Boundary.Guards);
		}
	}

	const strMetadata = GetDefinition(strSource, "MakeGameRulesPropertyInformationObject");
	g_Assert.doesNotMatch(strMetadata, /SetString\(|SetInteger\(|->Set\(/);
	g_Assert(strMetadata.includes("LocalGameRulesPropertyInformationObject->CreateDataProperty(LocalContext, LocalNameString, LocalValue).FromMaybe(false)"));
	g_Assert(strMetadata.includes("LocalNameString.IsEmpty() || LocalValue.IsEmpty() || GameRulesFailure.HasCaught()"));
	g_Assert(strMetadata.includes("if (!bValueDefined || GameRulesFailure.HasCaught()"));
	g_Assert(strMetadata.includes("DefineValue(pszName, MakeString(pIsolate, strValue))"));
	g_Assert.deepEqual([...strMetadata.matchAll(/!Define(?:String|Integer)\("([^"]+)"/g)].map(vecMatch => vecMatch[1]), ["Name", "Path", "Offset", "Type", "TypeID", "Flags", "BitCount", "ElementCount", "ElementStride"]);

	const strCollect = GetDefinition(strSource, "CollectGameRulesPropertyInformationObjects");
	g_Assert(strCollect.startsWith("\tbool CollectGameRulesPropertyInformationObjects("));
	g_Assert(strCollect.includes("if (!pGameRulesSendTable || (unGameRulesRecursionDepth > kMaximumGameRulesRecursionDepth)) {\n\t\t\t\treturn true;"));
	g_Assert(strCollect.includes("kMaximumGameRulesRecursionDepth = 32;"));
	g_Assert(strCollect.includes("if (unGameRulesPropertyWriteIndexInOut == kGameRulesPropertyWriteIndexLimit) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, GameRulesFailure, kPropertyCountErrorMessage);\n\t\t\t\t\treturn false;"));
	g_Assert(strCollect.includes("LocalGameRulesPropertyInformationObject.IsEmpty() || GameRulesFailure.HasCaught()"));
	g_Assert(strCollect.includes("LocalGameRulesPropertyInformationArray->CreateDataProperty(LocalContext, unGameRulesPropertyWriteIndexInOut, LocalGameRulesPropertyInformationObject).FromMaybe(false)"));
	g_Assert(strCollect.includes("if (!bPropertyDefined || GameRulesFailure.HasCaught()"));
	g_Assert(strCollect.includes("if (!CollectGameRulesPropertyInformationObjects("));
	g_Assert.doesNotMatch(strCollect, /->Set\(/);
	g_Assert(GetDefinition(strSource, "ListEngineGameRulesPropertiesCallback").includes("if (!CollectGameRulesPropertyInformationObjects(pIsolate, LocalContext, LocalGameRulesPropertyInformationArray, unGameRulesPropertyWriteIndex, pGameRulesSendTable, kRootGameRulesPropertyOffset, kRootGameRulesPropertyPath, kInitialGameRulesPropertyRecursionDepth) || GameRulesFailure.HasCaught()"));

	const strName = GetDefinition(strSource, "RequireGameRulesPropertyNameArgument");
	g_Assert(strName.includes("v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalGameRulesPropertyNameValue);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	g_Assert.doesNotMatch(strName, /ValueToString\(/);
	g_Assert(strName.includes("!pszEncodedGameRulesPropertyName || GameRulesFailure.HasCaught()"));
	g_Assert(strName.includes("std::string(pszEncodedGameRulesPropertyName, static_cast<std::size_t>(UTF8Value.length()))"));
	g_Assert(strName.includes("strGameRulesPropertyName.find('\\0') != std::string::npos"));
	g_Assert(strName.includes("strGameRulesPropertyName.empty()"));
	g_Assert(strName.includes("strGameRulesPropertyNameOut.swap(strGameRulesPropertyName);\n\n\t\t\treturn true;"));

	const strLookup = GetDefinition(strSource, "FindGameRulesPropertyByNameOrPathInSendTable");
	g_Assert(strLookup.includes("GameRulesPropertyInformation PropertyInformation {};"));
	g_Assert(strLookup.includes("GameRulesPropertyInformationOut = std::move(PropertyInformation);\n\t\t\t\treturn true;"));
	g_Assert.doesNotMatch(strLookup, /GameRulesPropertyInformationOut\.m_/);

	const strOffset = GetDefinition(strSource, "GetGameRulesPropertyOffsetFromNameOrPathArgument");
	g_Assert(strOffset.includes("!RequireGameRulesPropertyNameArgument(CallbackInformation, strGameRulesPropertyNameOrPath) || GameRulesFailure.HasCaught()"));
	g_Assert(strOffset.includes("nGameRulesPropertyOffsetOut = PropertyInformation.m_nOffset;\n\n\t\t\treturn true;"));

	const strAddress = GetDefinition(strSource, "GetGameRulesPropertyAddress");
	g_Assert(strAddress.includes("!GetGameRulesPropertyOffsetFromNameOrPathArgument(CallbackInformation, nGameRulesPropertyOffset) || GameRulesFailure.HasCaught()"));
	g_Assert(strAddress.includes("void* const pGameRulesInstance = GetGameRulesAddress();"));
	g_Assert(strAddress.includes("if (nGameRulesPropertyOffset < 0)"));
	g_Assert(strAddress.includes("unGameRulesInstanceAddress > (kMaximumGameRulesAddress - unGameRulesPropertyOffset)"));
	g_Assert(strAddress.includes("GetGameRulesPropertyAddress(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {"));
	g_Assert.doesNotMatch(strAddress, /\bnGameRulesPropertyOffsetOut\b/);
	g_Assert.doesNotMatch(strSource, /GetGameRulesPropertyAddress\(CallbackInformation,/);
	g_Assert(strAddress.includes("\n\n\t\t\treturn pchGameRulesPropertyAddress;"));

	for (const bSigned of [true, false]) {
		const strInteger = GetDefinition(strSource, bSigned ? "GetGameRulesSignedIntegerPropertyCallback" : "GetGameRulesUnsignedIntegerPropertyCallback");
		const strValue = bSigned ? "nGameRulesPropertyValue" : "unGameRulesPropertyValue";
		g_Assert(strInteger.includes("char* const pchGameRulesPropertyAddress = GetGameRulesPropertyAddress("));
		g_Assert(strInteger.includes("!pchGameRulesPropertyAddress || GameRulesFailure.HasCaught()"));
		g_Assert(strInteger.includes("if (!ReadMemoryScalarFromAddress(reinterpret_cast<std::uintptr_t>(pchGameRulesPropertyAddress), " + strValue + ")) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn;"));
		g_Assert(strInteger.includes("if constexpr (sizeof(T) <= sizeof(" + (bSigned ? "int" : "unsigned int") + "))"));
		g_Assert(strInteger.includes("LocalGameRulesPropertyValue = v8::Integer::" + (bSigned ? "New" : "NewFromUnsigned") + "(pIsolate, static_cast<" + (bSigned ? "int" : "unsigned int") + ">(" + strValue + "));"));
		g_Assert(strInteger.includes("LocalGameRulesPropertyValue = v8::BigInt::" + (bSigned ? "New" : "NewFromUnsigned") + "(pIsolate, static_cast<std::" + (bSigned ? "int64_t" : "uint64_t") + ">(" + strValue + "));"));
		g_Assert(strInteger.includes("LocalGameRulesPropertyValue.IsEmpty() || GameRulesFailure.HasCaught()"));
		g_Assert(strInteger.includes("CallbackInformation.GetReturnValue().Set(LocalGameRulesPropertyValue);"));
		g_Assert.doesNotMatch(strInteger, /std::memcpy\(|\*reinterpret_cast/);
	}

	const strNumber = GetDefinition(strSource, "GetGameRulesNumberFromValue");
	g_Assert(strNumber.includes("if constexpr (std::is_integral_v<T> && (sizeof(T) == sizeof(std::uint64_t))) {\n\t\t\tif (!LocalGameRulesNumberValue->IsBigInt()) {\n\t\t\t\treturn false;"));
	g_Assert(strNumber.indexOf("if constexpr (std::is_integral_v<T> &&") < strNumber.indexOf("NumberValue(LocalContext)"));
	g_Assert(strNumber.includes("Uint64Value(&bLosslessGameRulesNumberConversion)"));
	g_Assert(strNumber.includes("!bLosslessGameRulesNumberConversion || (unParsedGameRulesNumberValue > static_cast<std::uint64_t>(std::numeric_limits<T>::max()))"));
	g_Assert(strNumber.includes("Int64Value(&bLosslessGameRulesNumberConversion)"));
	g_Assert(strNumber.includes("if (!bLosslessGameRulesNumberConversion)"));
	g_Assert(strNumber.includes("(nParsedGameRulesNumberValue < static_cast<std::int64_t>(std::numeric_limits<T>::lowest())) || (nParsedGameRulesNumberValue > static_cast<std::int64_t>(std::numeric_limits<T>::max()))"));
	g_Assert(strNumber.includes("LocalContext.IsEmpty() || !LocalGameRulesNumberValue->IsNumber()"));
	g_Assert(strNumber.includes("MaybeGameRulesNumberValue.IsNothing()"));
	g_Assert(strNumber.includes("!std::isfinite(dblParsedGameRulesNumberValue)"));
	g_Assert(strNumber.includes("(dblParsedGameRulesNumberValue < static_cast<double>(std::numeric_limits<T>::lowest())) || (dblParsedGameRulesNumberValue > static_cast<double>(std::numeric_limits<T>::max()))"));
	g_Assert(strNumber.includes("std::floor(dblParsedGameRulesNumberValue) != dblParsedGameRulesNumberValue"));
	g_Assert(strNumber.includes("GameRulesNumberValueOut = static_cast<T>(dblParsedGameRulesNumberValue);\n\n\t\treturn true;"));

	const strUnsignedNumber = GetDefinition(strSource, "GetGameRulesUnsignedNumberFromValue");
	g_Assert(strUnsignedNumber.includes("if constexpr (sizeof(T) < sizeof(std::uint64_t))"));
	g_Assert(strUnsignedNumber.includes("return GetGameRulesNumberFromValue(LocalContext, LocalUnsignedGameRulesNumberValue, unGameRulesNumberValueOut);"));
	g_Assert(strUnsignedNumber.includes("if (!GetUInt64ValueFromValue(pIsolate, LocalContext, LocalUnsignedGameRulesNumberValue, unParsedGameRulesNumberValue)) {\n\t\t\t\treturn false;"));
	g_Assert(strUnsignedNumber.includes("unGameRulesNumberValueOut = unParsedGameRulesNumberValue;\n\n\t\t\treturn true;"));

	for (const Scalar of [...g_vecScalarReads, ...g_vecScalarWrites]) {
		const strDefinition = GetDefinition(strSource, Scalar.Name);
		g_Assert(strDefinition.includes("char* const pchGameRulesPropertyAddress = GetGameRulesPropertyAddress("));
		g_Assert(strDefinition.includes("if (!pchGameRulesPropertyAddress || GameRulesFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn;"));
		g_Assert.doesNotMatch(strDefinition, /std::memcpy\(|\*reinterpret_cast/);
	}

	for (const Scalar of g_vecScalarReads) {
		const strDefinition = GetDefinition(strSource, Scalar.Name);
		const strReadScalar = "if (!ReadMemoryScalarFromAddress(reinterpret_cast<std::uintptr_t>(pchGameRulesPropertyAddress), " + Scalar.Value + ")) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn;";
		g_Assert(strDefinition.includes(strReadScalar));
		g_Assert(strDefinition.indexOf("if (!pchGameRulesPropertyAddress") < strDefinition.indexOf(strReadScalar));
		g_Assert(strDefinition.includes("CallbackInformation.GetReturnValue().Set(" + Scalar.Result + ");"));

		if (Scalar.Result !== Scalar.Value) {
			g_Assert(strDefinition.includes("if (" + Scalar.Result + ".IsEmpty() || GameRulesFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn;"));
		}
	}

	for (const Scalar of g_vecScalarWrites) {
		const strDefinition = GetDefinition(strSource, Scalar.Name);
		const strRange = "if (!IsMemoryAddressRangeRepresentable(unGameRulesPropertyAddress, sizeof(" + Scalar.Value + "))) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn;";
		const strWriteScalar = "WriteMemoryScalarToAddress(unGameRulesPropertyAddress, " + Scalar.Value + ");";
		g_Assert(strDefinition.includes("const std::uintptr_t unGameRulesPropertyAddress = reinterpret_cast<std::uintptr_t>(pchGameRulesPropertyAddress);"));
		g_Assert(strDefinition.includes(strRange));
		g_Assert(strDefinition.includes(strWriteScalar + "\n\n\t\t\tCallbackInformation.GetReturnValue().Set(true);"));
		g_Assert(strDefinition.indexOf("if (!pchGameRulesPropertyAddress") < strDefinition.indexOf(strRange));
		g_Assert(strDefinition.indexOf(strRange) < strDefinition.indexOf(strWriteScalar));
	}

	const strSignedSetter = GetDefinition(strSource, "SetGameRulesSignedIntegerPropertyCallback");
	g_Assert(strSignedSetter.includes("if (!GetGameRulesNumberFromValue(LocalContext, LocalGameRulesPropertyValue, nGameRulesPropertyValue) || GameRulesFailure.HasCaught()"));

	const strUnsignedSetter = GetDefinition(strSource, "SetGameRulesUnsignedIntegerPropertyCallback");
	g_Assert(strUnsignedSetter.includes("if (!GetGameRulesUnsignedNumberFromValue(pIsolate, LocalContext, LocalGameRulesPropertyValue, unGameRulesPropertyValue) || GameRulesFailure.HasCaught()"));

	const strBooleanSetter = GetDefinition(strSource, "SetGameRulesBooleanPropertyCallback");
	g_Assert(strBooleanSetter.includes("LocalGameRulesPropertyValue.IsEmpty() || !LocalGameRulesPropertyValue->IsBoolean()"));
	g_Assert(strBooleanSetter.includes("const bool bGameRulesPropertyValue = LocalGameRulesPropertyValue.As<v8::Boolean>()->Value();"));

	const strCharacterSetter = GetDefinition(strSource, "SetGameRulesCharacterPropertyCallback");
	g_Assert.doesNotMatch(strCharacterSetter, /ValueToString\(|std::strlen\(/);
	g_Assert(strCharacterSetter.includes("v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalGameRulesPropertyValue);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	g_Assert(strCharacterSetter.includes("if (!pszEncodedGameRulesCharacterValue || GameRulesFailure.HasCaught()"));
	g_Assert(strCharacterSetter.includes("if (static_cast<std::size_t>(UTF8Value.length()) != kRequiredGameRulesCharacterCount) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, GameRulesFailure, kGameRulesCharacterValueErrorMessage);\n\t\t\t\t\treturn;"));
	g_Assert(strCharacterSetter.includes("kRequiredGameRulesCharacterCount = 1;"));
	g_Assert(strCharacterSetter.includes("chGameRulesPropertyValue = pszEncodedGameRulesCharacterValue[kFirstGameRulesCharacterIndex];"));
	g_Assert(strCharacterSetter.indexOf("UTF8Value.length()") < strCharacterSetter.indexOf("chGameRulesPropertyValue = pszEncodedGameRulesCharacterValue"));
	g_Assert(strCharacterSetter.includes("} else if (!GetGameRulesNumberFromValue(LocalContext, LocalGameRulesPropertyValue, chGameRulesPropertyValue) || GameRulesFailure.HasCaught()"));
	g_Assert(strCharacterSetter.indexOf("} else if (!GetGameRulesNumberFromValue") < strCharacterSetter.indexOf("if (!IsMemoryAddressRangeRepresentable"));

	const strCharacterGetter = GetDefinition(strSource, "GetGameRulesCharacterPropertyCallback");
	g_Assert(strCharacterGetter.includes("{ chGameRulesPropertyValue, kGameRulesCharacterTerminatorCharacter }"));
	g_Assert(strCharacterGetter.includes("MakeString(pIsolate, szGameRulesCharacterValue)"));

	for (const bFloat of [true, false]) {
		const strDefinition = GetDefinition(strSource, bFloat ? "SetGameRulesFloatPropertyCallback" : "SetGameRulesDoublePropertyCallback");
		const strParse = bFloat ? "if (!GetFloatArgument(pIsolate, LocalContext, LocalGameRulesPropertyValue, kFiniteGameRulesFloatValueErrorMessage, flGameRulesPropertyValue) || GameRulesFailure.HasCaught()" : "if (!GetNumberArgument(pIsolate, LocalContext, LocalGameRulesPropertyValue, kFiniteGameRulesDoubleValueErrorMessage, dblGameRulesPropertyValue) || GameRulesFailure.HasCaught()";
		g_Assert(strDefinition.includes(strParse));
		g_Assert(strDefinition.indexOf(strParse) < strDefinition.indexOf("if (!IsMemoryAddressRangeRepresentable"));
		g_Assert(strDefinition.includes("LocalGameRulesPropertyValue.IsEmpty() || !LocalGameRulesPropertyValue->IsNumber()"));

		if (!bFloat) {
			g_Assert(strDefinition.includes("if (!std::isfinite(dblGameRulesPropertyValue))"));
		}

		const strGetter = GetDefinition(strSource, bFloat ? "GetGameRulesFloatPropertyCallback" : "GetGameRulesDoublePropertyCallback");
		g_Assert(strGetter.includes("v8::Number::New(pIsolate, " + (bFloat ? "fl" : "dbl") + "GameRulesPropertyValue)"));
	}

	const strStringGetter = GetDefinition(strSource, "GetGameRulesStringAddressPropertyCallback");
	g_Assert(strStringGetter.includes("char const* pszGameRulesPropertyValue = nullptr;"));
	g_Assert(strStringGetter.includes("pszGameRulesPropertyValue ? pszGameRulesPropertyValue : kEmptyGameRulesStringAddressValue"));
	g_Assert(strStringGetter.includes("MakeString(pIsolate, pszGameRulesStringReturnValue)"));

	const strBufferGetter = GetDefinition(strSource, "GetGameRulesStringBufferPropertyCallback");
	g_Assert(strBufferGetter.includes("!LocalMaximumGameRulesStringBufferLengthValue->IsInt32()"));
	g_Assert(strBufferGetter.includes("nMaximumGameRulesStringBufferLength < kMinimumGameRulesStringBufferLength"));
	g_Assert(strBufferGetter.includes("if (!IsMemoryAddressRangeRepresentable(reinterpret_cast<std::uintptr_t>(pchGameRulesPropertyAddress), unMaximumGameRulesStringBufferLength)) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn;"));
	g_Assert(strBufferGetter.includes("(unGameRulesStringLength < unMaximumGameRulesStringBufferLength) && (pszGameRulesPropertyStringBuffer[unGameRulesStringLength] != kGameRulesStringBufferTerminatorCharacter)"));
	g_Assert(strBufferGetter.includes("if (unGameRulesStringLength == unMaximumGameRulesStringBufferLength) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, GameRulesFailure, kMissingGameRulesStringBufferTerminatorErrorMessage);\n\t\t\t\treturn;"));
	g_Assert(strBufferGetter.includes("LocalGameRulesPropertyString.IsEmpty() || GameRulesFailure.HasCaught()"));
	CheckFragmentOrder(strBufferGetter, ["if (!GetInt32Argument(", "if (!pchGameRulesPropertyAddress", "if (!IsMemoryAddressRangeRepresentable(", "while ((unGameRulesStringLength", "if (unGameRulesStringLength ==", "MakeString(pIsolate, strGameRulesPropertyValue)", "CallbackInformation.GetReturnValue().Set(LocalGameRulesPropertyString);"]);
	g_Assert.doesNotMatch(strBufferGetter, /std::strlen\(/);

	for (const strName of ["SetGameRulesStringAddressPropertyCallback", "SetGameRulesStringBufferPropertyCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert.doesNotMatch(strDefinition, /ValueToString\(|std::strlen\(/);
		g_Assert(strDefinition.includes("!LocalGameRulesPropertyValue->IsString()"));
		g_Assert(strDefinition.includes("if (!pszEncodedGameRulesPropertyValue || GameRulesFailure.HasCaught()"));
		g_Assert(strDefinition.includes("std::string(pszEncodedGameRulesPropertyValue, static_cast<std::size_t>(UTF8Value.length()))"));
		g_Assert(strDefinition.includes("if (strGameRulesPropertyValue.find('\\0') != std::string::npos) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, GameRulesFailure, kGameRulesStringValueErrorMessage);\n\t\t\t\treturn;"));
		CheckFragmentOrder(strDefinition, ["if (!pchGameRulesPropertyAddress", "v8::String::Utf8Value ", "if (!pszEncodedGameRulesPropertyValue", "std::string(pszEncodedGameRulesPropertyValue,", "if (strGameRulesPropertyValue.find('\\0')", "if (!IsMemoryAddressRangeRepresentable(", "CallbackInformation.GetReturnValue().Set(true);"]);
	}

	const strStringSetter = GetDefinition(strSource, "SetGameRulesStringAddressPropertyCallback");
	g_Assert(strStringSetter.includes("v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalGameRulesPropertyValue);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	g_Assert(strStringSetter.includes("if (!IsMemoryAddressRangeRepresentable(unGameRulesPropertyAddress, sizeof(char const*))) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn;"));
	g_Assert(strStringSetter.includes("strStoredGameRulesPropertyValue.swap(strGameRulesPropertyValue);"));
	g_Assert(strStringSetter.includes("WriteMemoryScalarToAddress(unGameRulesPropertyAddress, pszStoredGameRulesPropertyValue);"));
	CheckFragmentOrder(strStringSetter, ["if (!IsMemoryAddressRangeRepresentable(", "g_mapGameRulesStringValues[unGameRulesPropertyAddress]", "strStoredGameRulesPropertyValue.swap(", "strStoredGameRulesPropertyValue.c_str()", "WriteMemoryScalarToAddress("]);

	const strBufferSetter = GetDefinition(strSource, "SetGameRulesStringBufferPropertyCallback");
	g_Assert(strBufferSetter.includes("v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalGameRulesPropertyValue);"), "Use copy initialization for the non-explicit UTF8 owner constructor (guide7.9).");
	g_Assert(strBufferSetter.includes("!LocalGameRulesStringBufferCapacityValue->IsInt32()"));
	g_Assert(strBufferSetter.includes("nGameRulesStringBufferCapacity < kMinimumGameRulesStringBufferCapacity"));
	g_Assert(strBufferSetter.includes("strGameRulesPropertyValue.size() >= unGameRulesStringBufferCapacity"));
	g_Assert(strBufferSetter.includes("if (!IsMemoryAddressRangeRepresentable(reinterpret_cast<std::uintptr_t>(pchGameRulesPropertyAddress), unGameRulesStringBufferCapacity)) {\n\t\t\t\t" + strRethrow + "\n\t\t\t\treturn;"));
	g_Assert(strBufferSetter.includes("strGameRulesPropertyValue.size() + kGameRulesStringTerminatorByteCount"));
	CheckFragmentOrder(strBufferSetter, ["if (!GetInt32Argument(", "if (strGameRulesPropertyValue.find('\\0')", "if (strGameRulesPropertyValue.size() >=", "if (!IsMemoryAddressRangeRepresentable(", "std::memcpy("]);

	const strAddressSetter = GetDefinition(strSource, "SetGameRulesAddressPropertyCallback");
	g_Assert(strAddressSetter.includes("if (!GetGameRulesAddressFromValue(LocalContext, LocalGameRulesPropertyValue, unGameRulesAddress) || GameRulesFailure.HasCaught()"));
	CheckFragmentOrder(strAddressSetter, ["if (!GetGameRulesAddressFromValue(", "if (!IsMemoryAddressRangeRepresentable(", "WriteMemoryScalarToAddress("]);

	const strVectorParser = GetDefinition(strSource, "GetGameRulesVectorFromValue");
	g_Assert(strVectorParser.includes("Vector VectorValue {};"));
	g_Assert(strVectorParser.includes("if (!RequireVectorFromValue(pIsolate, LocalContext, LocalVectorValue, kVectorValueErrorMessage, VectorValue) || GameRulesFailure.HasCaught()"));
	g_Assert(strVectorParser.includes("VectorValueOut = VectorValue;\n\n\t\t\treturn true;"));
	g_Assert.doesNotMatch(strVectorParser, /RequireVectorFromValue\([^\n]+VectorValueOut\)/);

	for (const strName of ["GetGameRulesFloatPropertyAddress", "InstallGameRulesFloatProperty"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("if (!pflFloatPropertyValue)"));
		g_Assert(strDefinition.includes("(unFloatPropertyAddress % alignof(float)) != 0"));
		g_Assert(strDefinition.includes("if (!IsMemoryAddressRangeRepresentable(unFloatPropertyAddress, sizeof(float)))"));
	}

	const strFloatGetter = GetDefinition(strSource, "GetGameRulesFloatComponentPropertyCallback");
	g_Assert(strFloatGetter.includes("if (!ReadMemoryScalarFromAddress(reinterpret_cast<std::uintptr_t>(pflFloatPropertyValue), flComponentValue))"));
	CheckFragmentOrder(strFloatGetter, ["GetGameRulesFloatPropertyAddress(", "if (!pflFloatPropertyValue", "if (!ReadMemoryScalarFromAddress(", "PropertyInformation.GetReturnValue().Set(flComponentValue);"]);

	const strFloatSetter = GetDefinition(strSource, "SetGameRulesFloatComponentPropertyCallback");
	g_Assert(strFloatSetter.includes("!LocalFloatComponentValue->IsNumber()"));
	g_Assert(strFloatSetter.includes("if (!GetFloatArgument(pIsolate, LocalContext, LocalFloatComponentValue, kFiniteFloatPropertyValueErrorMessage, flComponentValue) || GameRulesFailure.HasCaught()"));
	g_Assert(strFloatSetter.includes("WriteMemoryScalarToAddress(reinterpret_cast<std::uintptr_t>(pflFloatPropertyValue), flComponentValue);"));
	CheckFragmentOrder(strFloatSetter, ["GetGameRulesFloatPropertyAddress(", "if (!pflFloatPropertyValue", "if (!GetFloatArgument(", "WriteMemoryScalarToAddress("]);

	const strInstallFloat = GetDefinition(strSource, "InstallGameRulesFloatProperty");
	g_Assert(strInstallFloat.includes("if (LocalPropertyName.IsEmpty() || GameRulesFailure.HasCaught()"));
	g_Assert(strInstallFloat.includes("if (LocalPropertyData.IsEmpty() || GameRulesFailure.HasCaught()"));
	g_Assert(strInstallFloat.includes("if (!bPropertyInstalled || GameRulesFailure.HasCaught()"));
	CheckFragmentOrder(strInstallFloat, ["if (!IsMemoryAddressRangeRepresentable(", "MakeString(pIsolate, pszPropertyName)", "if (LocalPropertyName.IsEmpty()", "v8::External::New(", "if (LocalPropertyData.IsEmpty()", "->SetNativeDataProperty(", "if (!bPropertyInstalled"]);

	const strVectorBuilder = GetDefinition(strSource, "MakeGameRulesVectorObject");
	g_Assert.doesNotMatch(strVectorBuilder, /SetValue\(|->Set\(/);
	g_Assert(strVectorBuilder.includes('kVectorAddressPropertyName = "Address";'));
	g_Assert(strVectorBuilder.includes("(unVectorAddress % alignof(Vector)) != 0"));
	g_Assert(strVectorBuilder.includes("if (!IsMemoryAddressRangeRepresentable(unVectorAddress, sizeof(Vector)))"));
	g_Assert(strVectorBuilder.includes("MakeGameRulesAddressValue(pIsolate, pVectorValue)"));
	g_Assert(strVectorBuilder.includes("LocalVectorObject->CreateDataProperty(LocalContext, LocalAddressPropertyName, LocalVectorAddressValue).FromMaybe(false)"));
	g_Assert(strVectorBuilder.includes("if (!bAddressDefined || GameRulesFailure.HasCaught()"));
	CheckFragmentOrder(strVectorBuilder, ["if (!IsMemoryAddressRangeRepresentable(", "v8::Object::New(", "if (LocalVectorObject.IsEmpty()", "MakeString(pIsolate, kVectorAddressPropertyName)", "if (LocalAddressPropertyName.IsEmpty()", "MakeGameRulesAddressValue(", "if (LocalVectorAddressValue.IsEmpty()", "->CreateDataProperty(", "if (!bAddressDefined", "if (!InstallGameRulesFloatProperty("]);

	for (const strComponent of ["X", "Y", "Z"]) {
		g_Assert(strVectorBuilder.includes("kVector" + strComponent + 'PropertyName = "' + strComponent + '";'));
		g_Assert(strVectorBuilder.includes("kVector" + strComponent + "PropertyName, &pVectorValue->" + strComponent.toLowerCase() + ") || GameRulesFailure.HasCaught()"));
	}

	const strVectorGetter = GetDefinition(strSource, "GetGameRulesVectorPropertyCallback");
	g_Assert(strVectorGetter.includes("if (LocalVectorObject.IsEmpty() || GameRulesFailure.HasCaught()"));
	CheckFragmentOrder(strVectorGetter, ["if (!pchVectorPropertyAddress", "MakeGameRulesVectorObject(", "if (LocalVectorObject.IsEmpty()", "CallbackInformation.GetReturnValue().Set(LocalVectorObject);"]);

	const strVectorSetter = GetDefinition(strSource, "SetGameRulesVectorPropertyCallback");
	g_Assert(strVectorSetter.includes("(unVectorPropertyAddress % alignof(Vector)) != 0"));
	g_Assert(strVectorSetter.includes("if (!IsMemoryAddressRangeRepresentable(unVectorPropertyAddress, sizeof(Vector)))"));
	g_Assert(strVectorSetter.includes("if (!GetGameRulesVectorFromValue(pIsolate, LocalContext, LocalVectorPropertyValue, VectorPropertyValue) || GameRulesFailure.HasCaught()"));
	CheckFragmentOrder(strVectorSetter, ["if (!pchVectorPropertyAddress", "if (!GetGameRulesVectorFromValue(", "if (!IsMemoryAddressRangeRepresentable(", "*pVectorPropertyValue = VectorPropertyValue;", "CallbackInformation.GetReturnValue().Set(true);"]);

	for (const Boundary of [...g_vecStructuredBoundaries, ...g_vecPublicBoundaries]) {
		g_Assert.equal(GetFailureBranches(GetDefinition(strSource, Boundary.Name)).length, Boundary.Guards, "Missing immediate failure rethrow: " + Boundary.Name);
	}

	const strColorComponent = GetDefinition(strSource, "GetGameRulesColorComponent");
	g_Assert(strColorComponent.includes("!LocalColorComponentValue->IsUint32()"));
	g_Assert(strColorComponent.includes("(nColorComponent < kMinimumColorComponentValue) || (nColorComponent > kMaximumColorComponentValue)"));
	CheckFragmentOrder(strColorComponent, ["MakeString(", "if (LocalColorComponentName.IsEmpty()", "->Get(", "if (!LocalColorComponentValue->IsUint32()", "if (!GetGameRulesNumberFromValue(", "if ((nColorComponent <", "nColorComponentOut = nColorComponent;"]);

	const strColorParser = GetDefinition(strSource, "GetGameRulesColorFromValue");
	g_Assert(strColorParser.includes("!LocalColorValue->IsObject()"));
	CheckFragmentOrder(strColorParser, ["kRedColorComponentName, nRedColorComponent)", "kGreenColorComponentName, nGreenColorComponent)", "kBlueColorComponentName, nBlueColorComponent)", "kAlphaColorComponentName, nAlphaColorComponent)", "ColorValueOut.SetColor(nRedColorComponent, nGreenColorComponent, nBlueColorComponent, nAlphaColorComponent);"]);

	const strObjectFloat = GetDefinition(strSource, "GetGameRulesObjectFloatComponent");
	g_Assert(strObjectFloat.includes("!LocalComponentValue->IsNumber()"));
	CheckFragmentOrder(strObjectFloat, ["MakeString(", "if (LocalComponentName.IsEmpty()", "->Get(", "if (LocalComponentValue.IsEmpty()", "if (!GetFloatArgument(", "flComponentOut = flComponent;"]);

	for (const strName of ["GetGameRulesBytePropertyAddress", "InstallGameRulesByteProperty"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("if (!punBytePropertyValue)"));
		g_Assert(strDefinition.includes("if (!IsMemoryAddressRangeRepresentable(unBytePropertyAddress, sizeof(unsigned char)))"));
	}

	const strByteGetter = GetDefinition(strSource, "GetGameRulesByteComponentPropertyCallback");
	g_Assert.doesNotMatch(strByteGetter, /\*punBytePropertyValue/);
	CheckFragmentOrder(strByteGetter, ["GetGameRulesBytePropertyAddress(", "if (!punBytePropertyValue", "if (!ReadMemoryScalarFromAddress(", "v8::Integer::NewFromUnsigned(", "if (LocalByteComponentValue.IsEmpty()", "PropertyInformation.GetReturnValue().Set(LocalByteComponentValue);"]);

	const strByteSetter = GetDefinition(strSource, "SetGameRulesByteComponentPropertyCallback");
	g_Assert.doesNotMatch(strByteSetter, /\*punBytePropertyValue/);
	g_Assert(strByteSetter.includes("!LocalByteComponentValue->IsUint32()"));
	CheckFragmentOrder(strByteSetter, ["->Uint32Value(", "if (MaybeByteComponentValue.IsNothing()", "if (unByteComponentValue > kMaximumByteValue)", "GetGameRulesBytePropertyAddress(", "if (!punBytePropertyValue", "WriteMemoryScalarToAddress("]);

	const strInstallByte = GetDefinition(strSource, "InstallGameRulesByteProperty");
	CheckFragmentOrder(strInstallByte, ["if (!IsMemoryAddressRangeRepresentable(", "MakeString(", "if (LocalPropertyName.IsEmpty()", "v8::External::New(", "if (LocalPropertyData.IsEmpty()", "->SetNativeDataProperty(", "if (!bPropertyInstalled"]);

	for (const View of [
		{ Role: "Color", NativeType: "Color", Components: ["Red", "Green", "Blue", "Alpha"] },
		{ Role: "Interval", NativeType: "interval_t", Components: ["Start", "Range"] },
		{ Role: "Quaternion", NativeType: "Quaternion", Components: ["X", "Y", "Z", "W"] },
	]) {
		const strDefinition = GetDefinition(strSource, "MakeGameRules" + View.Role + "Object");
		g_Assert.doesNotMatch(strDefinition, /SetValue\(|->Set\(/);
		g_Assert(strDefinition.includes("if (!IsMemoryAddressRangeRepresentable(un" + View.Role + "Address, sizeof(" + View.NativeType + ")))"));
		g_Assert(strDefinition.includes("k" + View.Role + 'AddressPropertyName = "Address";'));
		CheckFragmentOrder(strDefinition, ["if (!IsMemoryAddressRangeRepresentable(", "v8::Object::New(", "if (Local" + View.Role + "Object.IsEmpty()", "MakeString(", "if (LocalAddressPropertyName.IsEmpty()", "MakeGameRulesAddressValue(", "if (Local" + View.Role + "AddressValue.IsEmpty()", "->CreateDataProperty(", "if (!bAddressDefined", "if (!InstallGameRules"]);

		for (const strComponent of View.Components) {
			const strPropertyRole = (View.Role === "Color") ? strComponent + "Color" : View.Role + strComponent;
			const strNativeMember = (View.Role === "Color") ? "punColorComponentBytes[k" + strComponent + "ColorComponentIndex]" : "p" + View.Role + "Value->" + strComponent.toLowerCase();
			g_Assert(strDefinition.includes("k" + strPropertyRole + 'PropertyName = "' + strComponent + '";'));
			g_Assert(strDefinition.includes("k" + strPropertyRole + "PropertyName, &" + strNativeMember + ") || GameRulesFailure.HasCaught()"));
		}
	}

	for (const View of [{ Role: "Color", NativeType: "Color" }, { Role: "Interval", NativeType: "interval_t" }]) {
		const strGetter = GetDefinition(strSource, "GetGameRules" + View.Role + "PropertyCallback");
		CheckFragmentOrder(strGetter, ["if (!pch" + View.Role + "PropertyAddress", "MakeGameRules" + View.Role + "Object(", "if (Local" + View.Role + "Object.IsEmpty()", "CallbackInformation.GetReturnValue().Set(Local" + View.Role + "Object);"]);

		const strSetter = GetDefinition(strSource, "SetGameRules" + View.Role + "PropertyCallback");
		g_Assert(strSetter.includes("if (!IsMemoryAddressRangeRepresentable(un" + View.Role + "PropertyAddress, sizeof(" + View.NativeType + ")))"));
		CheckFragmentOrder(strSetter, ["if (!pch" + View.Role + "PropertyAddress", (View.Role === "Color") ? "if (!GetGameRulesColorFromValue(" : "kIntervalRangePropertyName, kIntervalComponentsErrorMessage, IntervalPropertyValue.range)", "if (!IsMemoryAddressRangeRepresentable(", (View.Role === "Color") ? "pColorPropertyValue->SetColor(ColorPropertyValue.r(), ColorPropertyValue.g(), ColorPropertyValue.b(), ColorPropertyValue.a());" : "*p" + View.Role + "PropertyValue = " + View.Role + "PropertyValue;", "CallbackInformation.GetReturnValue().Set(true);"]);
	}

	const strColorSetter = GetDefinition(strSource, "SetGameRulesColorPropertyCallback");
	g_Assert(strColorSetter.includes("Color ColorPropertyValue = Color(0x0, 0x0, 0x0, 0x0);"));
	g_Assert.doesNotMatch(strColorSetter, /\*pColorPropertyValue\s*=/);
	g_Assert.doesNotMatch(strColorParser, /\bColorValueOut\s*=/);

	for (const Result of g_vecPublicReadResults) {
		const strDefinition = GetDefinition(strSource, Result.Name);
		const vecFragments = [Result.Build];
		if (Result.Checked !== undefined) {
			vecFragments.push(Result.Checked);
		}

		vecFragments.push("CallbackInformation.GetReturnValue().Set(" + Result.Value + ");");
		CheckFragmentOrder(strDefinition, vecFragments);
	}

	const strQuaternionSetter = GetDefinition(strSource, "SetGameRulesQuaternionPropertyCallback");
	g_Assert(strQuaternionSetter.includes("!LocalQuaternionPropertyValue->IsObject()"));
	g_Assert(strQuaternionSetter.includes("(unQuaternionPropertyAddress % alignof(Quaternion)) != 0"));
	g_Assert(strQuaternionSetter.includes("if (!IsMemoryAddressRangeRepresentable(unQuaternionPropertyAddress, sizeof(Quaternion)))"));
	CheckFragmentOrder(strQuaternionSetter, ["if (!pchQuaternionPropertyAddress", "kQuaternionXPropertyName, kQuaternionComponentsErrorMessage, flQuaternionXComponent)", "kQuaternionYPropertyName, kQuaternionComponentsErrorMessage, flQuaternionYComponent)", "kQuaternionZPropertyName, kQuaternionComponentsErrorMessage, flQuaternionZComponent)", "kQuaternionWPropertyName, kQuaternionComponentsErrorMessage, flQuaternionWComponent)", "Quaternion(flQuaternionXComponent, flQuaternionYComponent, flQuaternionZComponent, flQuaternionWComponent)", "if (!IsMemoryAddressRangeRepresentable(", "*pQuaternionPropertyValue = QuaternionPropertyValue;", "CallbackInformation.GetReturnValue().Set(true);"]);

	for (const strComponent of ["X", "Y", "Z", "W"]) {
		g_Assert(strQuaternionSetter.includes("kQuaternion" + strComponent + 'PropertyName = "' + strComponent + '";'));
		g_Assert(strQuaternionSetter.includes("if (!GetGameRulesObjectFloatComponent(pIsolate, LocalContext, LocalQuaternionObject, kQuaternion" + strComponent + "PropertyName, kQuaternionComponentsErrorMessage, flQuaternion" + strComponent + "Component) || GameRulesFailure.HasCaught()"));
	}

	const strEdictGetter = GetDefinition(strSource, "GetGameRulesEdictPropertyCallback");
	const strEdictSetter = GetDefinition(strSource, "SetGameRulesEdictPropertyCallback");
	for (const strDefinition of [strEdictGetter, strEdictSetter]) {
		g_Assert(strDefinition.includes("if (!IsMemoryAddressRangeRepresentable(unEdictPropertyAddress, sizeof(edict_t*)))"));
		g_Assert.doesNotMatch(strDefinition, /\*reinterpret_cast<edict_t\*\*>/);
		CheckFragmentOrder(strDefinition, ["if (!pchEdictPropertyAddress", "if (!IsMemoryAddressRangeRepresentable(", "std::memcpy("]);
	}

	g_Assert(strEdictGetter.includes("if (!bEdictEntityResolved) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\t\treturn;"));
	g_Assert(strEdictGetter.includes("std::memcpy(&pEdictPropertyValue, pchEdictPropertyAddress, sizeof(pEdictPropertyValue));"));
	CheckFragmentOrder(strEdictGetter, ["std::memcpy(", "GetEntityIndexFromEdictAddress(", "if (!bEdictEntityResolved)", "MakeEntityObject("]);
	g_Assert(strEdictSetter.includes("edict_t* pEdictPropertyValue = nullptr;"));
	g_Assert(strEdictSetter.includes("if (!LocalEdictPropertyValue->IsNull())"));
	g_Assert(strEdictSetter.includes("std::memcpy(pchEdictPropertyAddress, &pEdictPropertyValue, sizeof(pEdictPropertyValue));"));
	CheckFragmentOrder(strEdictSetter, ["GetValueIndex(", "if (GameRulesFailure.HasCaught()", "if (nEdictEntityIndex < 0)", "GetEdictFromEntityIndex(", "if (!IsMemoryAddressRangeRepresentable(", "std::memcpy(", "CallbackInformation.GetReturnValue().Set(true);"]);

	const strPublicAddress = GetDefinition(strSource, "GetEngineGameRulesAddressCallback");
	g_Assert(strPublicAddress.includes("void* const pGameRulesInstance = GetGameRulesAddress();"), "Use explicit void* for a known simple address type (guide11.4).");
	g_Assert(GetDefinition(strSource, "FindEngineGameRulesCallback").includes("void* const pGameRulesInstance = GetGameRulesAddress();"), "Use explicit void* for a known simple address type (guide11.4).");
	g_Assert(strPublicAddress.includes("v8::Local<v8::BigInt> const LocalGameRulesAddress = MakeGameRulesAddressValue("));
	g_Assert.doesNotMatch(strPublicAddress, /v8::Number|static_cast<double>/);

	const strPublicList = GetDefinition(strSource, "ListEngineGameRulesPropertiesCallback");
	CheckFragmentOrder(strPublicList, ["if (LocalGameRulesPropertyInformationArray.IsEmpty()", "if (!CollectGameRulesPropertyInformationObjects(", "CallbackInformation.GetReturnValue().Set(LocalGameRulesPropertyInformationArray);"]);

	const strInstallFunction = GetDefinition(strSource, "InstallGameRulesFunction");
	g_Assert(strInstallFunction.includes("!pszFunctionName || !*pszFunctionName || !Callback || LocalRuntimeData.IsEmpty()"));
	g_Assert.doesNotMatch(strInstallFunction, /SetFunction\(|SetValue\(|->Set\(/);
	g_Assert(strInstallFunction.includes("if (!v8::Function::New(LocalContext, Callback, LocalRuntimeData).ToLocal(&LocalFunction) || GameRulesFailure.HasCaught()"));
	g_Assert(strInstallFunction.includes("LocalGameRulesObject->CreateDataProperty(LocalContext, LocalFunctionName, LocalFunction).FromMaybe(false)"));
	CheckFragmentOrder(strInstallFunction, ["v8::Function::New(", "MakeString(pIsolate, pszFunctionName)", "if (LocalFunctionName.IsEmpty()", "->CreateDataProperty(", "if (!bFunctionDefined"]);

	const strInstallFunctions = GetDefinition(strSource, "InstallGameRulesFunctions");
	g_Assert.deepEqual(GetFunctionRegistrations(strInstallFunctions), g_vecFunctionRegistrations);
	g_Assert.doesNotMatch(strInstallFunctions, /SetFunction\(/);

	const nInstallFunctionPosition = strSource.indexOf(GetRawDefinition(strSource, "InstallGameRulesFunction"));
	const nInstallFunctionsPosition = strSource.indexOf(GetRawDefinition(strSource, "InstallGameRulesFunctions"));
	g_Assert((nInstallFunctionPosition >= 0) && (nInstallFunctionsPosition > nInstallFunctionPosition));

	for (const Registration of g_vecFunctionRegistrations) {
		g_Assert(strInstallFunctions.includes('if (!InstallGameRulesFunction(pIsolate, LocalContext, LocalGameRulesObject, "' + Registration.Name + '", ' + Registration.Callback + ", LocalRuntimeData) || GameRulesFailure.HasCaught()"));
	}
}

function VerifyFailureBranchExtraction() {
	const strRethrowCall = "RethrowV8InstallationFailure(pIsolate, GameRulesFailure, kFailureErrorMessage);";
	for (const strReturnSuffix of ["", " false", " {}", " nullptr"]) {
		const strBranch = "\tif (GameRulesFailure.HasCaught()) {\n\t\t" + strRethrowCall + "\n\t\treturn" + strReturnSuffix + ";\n\t}";
		const vecBranches = GetFailureBranches(strBranch);
		g_Assert.equal(vecBranches.length, 1, "Extract the exact GameRulesFailure member guard.");
		g_Assert.equal(vecBranches[0][1], strRethrowCall, "Retain the guarded rethrow call.");
		g_Assert.equal(GetFailureBranches(strBranch.replace("GameRulesFailure.HasCaught", "GameRulesFailureXHasCaught")).length, 0, "Reject a mistyped member separator.");
	}
}

let g_unRejectedMutationCount = 0;

function RejectMutation(Mutation) {
	const strActualDefinition = Mutation.Name ? GetRawDefinition(g_strSource, Mutation.Name) : g_strSource;
	const strDefinition = Mutation.Name ? GetDefinition(g_strSource, Mutation.Name) : g_strSource;
	g_Assert(strDefinition.includes(Mutation.Old), "Mutation anchor: " + Mutation.Name);
	let unOccurrence = 0;
	const strChanged = strDefinition.replaceAll(Mutation.Old, () => (unOccurrence++ === (Mutation.Occurrence ?? 0)) ? Mutation.New : Mutation.Old);
	g_Assert.notEqual(strChanged, strDefinition);
	const strActualChanged = (Mutation.Name && strActualDefinition.startsWith("\t\t")) ? strChanged.replace(/^\t/gm, "\t\t") : strChanged;
	const strChangedSource = g_strSource.replace(strActualDefinition, () => strActualChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, "Mutate the actual source definition.");
	g_Assert.throws(() => CheckContracts(strChangedSource), g_Assert.AssertionError, Mutation.Name + ": " + Mutation.Old);
	++g_unRejectedMutationCount;
}

const g_strZeroArgumentProbe = "\tstd::string ProxyNameProbe() {\n\t\treturn {};\n\t}";
g_Assert.equal(GetRawDefinition(g_strZeroArgumentProbe, "ProxyNameProbe"), g_strZeroArgumentProbe);
g_Assert.throws(() => GetRawDefinition("\tstd::string ProxyNameProbe(); // marker ) {\n", "ProxyNameProbe"), g_Assert.AssertionError);

if (g_bNativeProxyName) {
	RunNativeProxyNameProbe(g_vecArguments[1]);
	process.exit(0);
}

VerifyFailureBranchExtraction();
CheckContracts(g_strSource);

for (const Boundary of g_vecPropertyBoundaries) {
	for (const strFramePart of ["v8::TryCatch GameRulesFailure(pIsolate);", "catch (std::exception const&)", "catch (...)"]) {
		RejectMutation({ Name: Boundary.Name, Old: strFramePart, New: "" });
	}

	for (const strGuard of ["GameRulesFailure.HasCaught()", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"]) {
		for (let unOccurrence = 0; unOccurrence < Boundary.Guards; ++unOccurrence) {
			RejectMutation({ Name: Boundary.Name, Old: strGuard, New: "false", Occurrence: unOccurrence });
		}
	}
}

for (const Scalar of g_vecScalarReads) {
	RejectMutation({ Name: Scalar.Name, Old: "!ReadMemoryScalarFromAddress(", New: "ReadMemoryScalarFromAddress(" });
	RejectMutation({ Name: Scalar.Name, Old: "!pchGameRulesPropertyAddress ||", New: "" });
	RejectMutation({ Name: Scalar.Name, Old: "CallbackInformation.GetReturnValue().Set(" + Scalar.Result + ");", New: "CallbackInformation.GetReturnValue().Set(false);" });

	if (Scalar.Result !== Scalar.Value) {
		RejectMutation({ Name: Scalar.Name, Old: Scalar.Result + ".IsEmpty() ||", New: "" });
	}
}

for (const Scalar of g_vecScalarWrites) {
	RejectMutation({ Name: Scalar.Name, Old: "!pchGameRulesPropertyAddress ||", New: "" });
	RejectMutation({ Name: Scalar.Name, Old: "!IsMemoryAddressRangeRepresentable(unGameRulesPropertyAddress, sizeof(" + Scalar.Value + "))", New: "false" });
	RejectMutation({ Name: Scalar.Name, Old: "WriteMemoryScalarToAddress(unGameRulesPropertyAddress, " + Scalar.Value + ");", New: "" });
	RejectMutation({ Name: Scalar.Name, Old: "CallbackInformation.GetReturnValue().Set(true);", New: "CallbackInformation.GetReturnValue().Set(false);" });
}

for (const Boundary of [...g_vecStructuredBoundaries, ...g_vecPublicBoundaries]) {
	const strDefinition = GetDefinition(g_strSource, Boundary.Name);
	for (const vecMatch of GetFailureBranches(strDefinition)) {
		const unOccurrence = strDefinition.slice(0, vecMatch.index).split(vecMatch[1]).length - 1;
		RejectMutation({ Name: Boundary.Name, Old: vecMatch[1], New: "", Occurrence: unOccurrence });
	}
}

for (const View of [
	{ Role: "Color", NativeType: "Color", Components: ["Red", "Green", "Blue", "Alpha"] },
	{ Role: "Interval", NativeType: "interval_t", Components: ["Start", "Range"] },
	{ Role: "Quaternion", NativeType: "Quaternion", Components: ["X", "Y", "Z", "W"] },
]) {
	const strName = "MakeGameRules" + View.Role + "Object";
	RejectMutation({ Name: strName, Old: "!IsMemoryAddressRangeRepresentable(un" + View.Role + "Address, sizeof(" + View.NativeType + "))", New: "false" });
	RejectMutation({ Name: strName, Old: "->CreateDataProperty(", New: "->Set(" });
	RejectMutation({ Name: strName, Old: "LocalAddressPropertyName.IsEmpty() ||", New: "" });
	RejectMutation({ Name: strName, Old: "Local" + View.Role + "AddressValue.IsEmpty() ||", New: "" });
	RejectMutation({ Name: strName, Old: "k" + View.Role + 'AddressPropertyName = "Address";', New: "k" + View.Role + 'AddressPropertyName = "m_unAddress";' });

	for (const strComponent of View.Components) {
		const strPropertyRole = (View.Role === "Color") ? strComponent + "Color" : View.Role + strComponent;
		const strNativeMember = (View.Role === "Color") ? "punColorComponentBytes[k" + strComponent + "ColorComponentIndex]" : "p" + View.Role + "Value->" + strComponent.toLowerCase();
		RejectMutation({ Name: strName, Old: "k" + strPropertyRole + 'PropertyName = "' + strComponent + '";', New: "k" + strPropertyRole + 'PropertyName = "m_' + strComponent + '";' });
		RejectMutation({ Name: strName, Old: "&" + strNativeMember, New: "nullptr" });
	}
}

for (const strName of ["SetGameRulesStringAddressPropertyCallback", "SetGameRulesStringBufferPropertyCallback"]) {
	RejectMutation({ Name: strName, Old: "!LocalGameRulesPropertyValue->IsString()", New: "false" });
	RejectMutation({ Name: strName, Old: "!pszEncodedGameRulesPropertyValue ||", New: "" });
	RejectMutation({ Name: strName, Old: "static_cast<std::size_t>(UTF8Value.length())", New: "0" });
	RejectMutation({ Name: strName, Old: "strGameRulesPropertyValue.find('\\0') != std::string::npos", New: "false" });
	RejectMutation({ Name: strName, Old: "!IsMemoryAddressRangeRepresentable(", New: "IsMemoryAddressRangeRepresentable(" });
}

for (const strName of ["GetGameRulesFloatPropertyAddress", "InstallGameRulesFloatProperty"]) {
	RejectMutation({ Name: strName, Old: "if (!pflFloatPropertyValue)", New: "if (false)" });
	RejectMutation({ Name: strName, Old: "(unFloatPropertyAddress % alignof(float)) != 0", New: "false" });
	RejectMutation({ Name: strName, Old: "!IsMemoryAddressRangeRepresentable(unFloatPropertyAddress, sizeof(float))", New: "false" });
}

for (const strComponent of ["X", "Y", "Z"]) {
	RejectMutation({ Name: "MakeGameRulesVectorObject", Old: "kVector" + strComponent + 'PropertyName = "' + strComponent + '";', New: "kVector" + strComponent + 'PropertyName = "m_fl' + strComponent + '";' });
	RejectMutation({ Name: "MakeGameRulesVectorObject", Old: "&pVectorValue->" + strComponent.toLowerCase(), New: "nullptr" });
}

for (const Result of g_vecPublicReadResults) {
	RejectMutation({ Name: Result.Name, Old: "CallbackInformation.GetReturnValue().Set(" + Result.Value + ");", New: "CallbackInformation.GetReturnValue().Set(false);" });
}

for (const strComponent of ["X", "Y", "Z", "W"]) {
	RejectMutation({ Name: "SetGameRulesQuaternionPropertyCallback", Old: "kQuaternion" + strComponent + 'PropertyName = "' + strComponent + '";', New: "kQuaternion" + strComponent + 'PropertyName = "m_fl' + strComponent + '";' });
	RejectMutation({ Name: "SetGameRulesQuaternionPropertyCallback", Old: "!GetGameRulesObjectFloatComponent(pIsolate, LocalContext, LocalQuaternionObject, kQuaternion" + strComponent + "PropertyName", New: "GetGameRulesObjectFloatComponent(pIsolate, LocalContext, LocalQuaternionObject, kQuaternion" + strComponent + "PropertyName" });
}

for (const Registration of g_vecFunctionRegistrations) {
	const strCall = 'InstallGameRulesFunction(pIsolate, LocalContext, LocalGameRulesObject, "' + Registration.Name + '", ' + Registration.Callback + ", LocalRuntimeData)";
	RejectMutation({ Name: "InstallGameRulesFunctions", Old: strCall, New: strCall.replace('"' + Registration.Name + '"', '"Changed"') });
	RejectMutation({ Name: "InstallGameRulesFunctions", Old: strCall, New: strCall.replace(Registration.Callback, "nullptr") });
	RejectMutation({ Name: "InstallGameRulesFunctions", Old: strCall, New: strCall.replace(", LocalRuntimeData)", ", v8::Local<v8::Value>())") });
	RejectMutation({ Name: "InstallGameRulesFunctions", Old: "!" + strCall, New: strCall });
}

for (const Mutation of [
	{ Name: "GetGameRulesProxyClassName", Old: "if (!pszGameRulesClassName || (nGameRulesClassNameDataLength <= 0))", New: "if (!pszGameRulesClassName)" },
	{ Name: "GetGameRulesProxyClassName", Old: "std::size_t unGameRulesClassNameLength = static_cast<std::size_t>(nGameRulesClassNameDataLength);", New: "std::size_t unGameRulesClassNameLength = std::strlen(pszGameRulesClassName);" },
	{ Name: "GetGameRulesProxyClassName", Old: 'kGameRulesProxyClassNameSuffix = "Proxy";', New: 'kGameRulesProxyClassNameSuffix = "proxy";' },
	{ Name: "GetGameRulesProxyClassName", Old: "pszGameRulesClassName[unGameRulesClassNameLength - kLastGameRulesClassNameCharacterOffset]", New: "pszGameRulesClassName[0x0]" },
	{ Name: "GetGameRulesAddressFromValue", Old: "!LocalGameRulesAddressValue->IsBigInt()", New: "false" },
	{ Name: "GetGameRulesAddressFromValue", Old: "Uint64Value(&bGameRulesAddressConversionLossless)", New: "Uint64Value(nullptr)" },
	{ Name: "GetGameRulesAddressFromValue", Old: "!bGameRulesAddressConversionLossless ||", New: "" },
	{ Name: "GetGameRulesAddressFromValue", Old: "unGameRulesAddress > std::numeric_limits<std::uintptr_t>::max()", New: "false" },
	{ Name: "GetGameRulesAddressFromValue", Old: "unGameRulesAddressOut = static_cast<std::uintptr_t>(unGameRulesAddress);", New: "unGameRulesAddressOut = 0;" },
	{ Name: "MakeGameRulesAddressValue", Old: "v8::TryCatch GameRulesFailure(pIsolate);", New: "" },
	{ Name: "MakeGameRulesAddressValue", Old: "catch (std::exception const&)", New: "catch (int)" },
	{ Name: "MakeGameRulesAddressValue", Old: "catch (...)", New: "catch (int)" },
	{ Name: "MakeGameRulesAddressValue", Old: "LocalGameRulesAddressValue.IsEmpty() ||", New: "" },
	{ Name: "MakeGameRulesAddressValue", Old: "GameRulesFailure.HasCaught()", New: "false" },
	{ Name: "MakeGameRulesAddressValue", Old: "pIsolate->IsExecutionTerminating()", New: "false" },
	{ Name: "MakeGameRulesAddressValue", Old: "pIsolate->HasPendingException()", New: "false" },
	{ Name: "MakeGameRulesAddressValue", Old: "v8::BigInt::NewFromUnsigned(pIsolate, unGameRulesAddress)", New: "v8::Number::New(pIsolate, 0)" },
	{ Name: "MakeGameRulesAddressValue", Old: "static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pGameRulesAddress))", New: "0" },
	{ Name: "MakeGameRulesAddressValue", Old: "RethrowV8InstallationFailure(pIsolate, GameRulesFailure, kFailureErrorMessage);", New: "" },
	{ Name: "MakeGameRulesAddressValue", Old: "\n\n\t\treturn {};\n\t}", New: "\n\t}" },
	{ Name: "GetEngineGameRulesAddressCallback", Old: "void* const pGameRulesInstance = GetGameRulesAddress();", New: "auto* const pGameRulesInstance = GetGameRulesAddress();" },
	{ Name: "FindEngineGameRulesCallback", Old: "void* const pGameRulesInstance = GetGameRulesAddress();", New: "auto* const pGameRulesInstance = GetGameRulesAddress();" },
	{ Name: "MakeGameRulesPropertyInformationObject", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "MakeGameRulesPropertyInformationObject", Old: "LocalValue.IsEmpty() ||", New: "" },
	{ Name: "MakeGameRulesPropertyInformationObject", Old: "if (!bValueDefined ||", New: "if (" },
	{ Name: "MakeGameRulesPropertyInformationObject", Old: 'DefineString("Path",', New: 'DefineString("path",' },
	{ Name: "CollectGameRulesPropertyInformationObjects", Old: "if (unGameRulesPropertyWriteIndexInOut == kGameRulesPropertyWriteIndexLimit)", New: "if (false)" },
	{ Name: "CollectGameRulesPropertyInformationObjects", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "CollectGameRulesPropertyInformationObjects", Old: "if (!bPropertyDefined ||", New: "if (" },
	{ Name: "CollectGameRulesPropertyInformationObjects", Old: "if (!CollectGameRulesPropertyInformationObjects(", New: "if (CollectGameRulesPropertyInformationObjects(" },
	{ Name: "RequireGameRulesPropertyNameArgument", Old: "v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalGameRulesPropertyNameValue);", New: "v8::String::Utf8Value UTF8Value(pIsolate, LocalGameRulesPropertyNameValue);" },
	{ Name: "RequireGameRulesPropertyNameArgument", Old: "!pszEncodedGameRulesPropertyName ||", New: "" },
	{ Name: "RequireGameRulesPropertyNameArgument", Old: "static_cast<std::size_t>(UTF8Value.length())", New: "0" },
	{ Name: "RequireGameRulesPropertyNameArgument", Old: "strGameRulesPropertyName.find('\\0') != std::string::npos", New: "false" },
	{ Name: "RequireGameRulesPropertyNameArgument", Old: "strGameRulesPropertyNameOut.swap(strGameRulesPropertyName);", New: "strGameRulesPropertyNameOut.clear();" },
	{ Name: "FindGameRulesPropertyByNameOrPathInSendTable", Old: "GameRulesPropertyInformationOut = std::move(PropertyInformation);", New: "GameRulesPropertyInformationOut.m_nOffset = nGameRulesPropertyOffset;" },
	{ Name: "GetGameRulesPropertyOffsetFromNameOrPathArgument", Old: "!RequireGameRulesPropertyNameArgument(", New: "RequireGameRulesPropertyNameArgument(" },
	{ Name: "GetGameRulesPropertyAddress", Old: "nGameRulesPropertyOffset < 0", New: "false" },
	{ Name: "GetGameRulesPropertyAddress", Old: "GetGameRulesPropertyAddress(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation)", New: "GetGameRulesPropertyAddress(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, int& nUnusedOffsetOut)" },
	{ Name: "GetGameRulesPropertyAddress", Old: "unGameRulesInstanceAddress > (kMaximumGameRulesAddress - unGameRulesPropertyOffset)", New: "false" },
	{ Name: "GetGameRulesSignedIntegerPropertyCallback", Old: "!ReadMemoryScalarFromAddress(", New: "ReadMemoryScalarFromAddress(" },
	{ Name: "GetGameRulesSignedIntegerPropertyCallback", Old: "LocalGameRulesPropertyValue.IsEmpty() ||", New: "" },
	{ Name: "GetGameRulesUnsignedIntegerPropertyCallback", Old: "!ReadMemoryScalarFromAddress(", New: "ReadMemoryScalarFromAddress(" },
	{ Name: "GetGameRulesUnsignedIntegerPropertyCallback", Old: "LocalGameRulesPropertyValue.IsEmpty() ||", New: "" },
	{ Old: "if (!CollectGameRulesPropertyInformationObjects(pIsolate, LocalContext, LocalGameRulesPropertyInformationArray, unGameRulesPropertyWriteIndex,", New: "if (CollectGameRulesPropertyInformationObjects(pIsolate, LocalContext, LocalGameRulesPropertyInformationArray, unGameRulesPropertyWriteIndex," },
	{ Name: "GetGameRulesNumberFromValue", Old: "std::is_integral_v<T> && (sizeof(T) == sizeof(std::uint64_t))", New: "std::is_signed_v<T> && (sizeof(T) == sizeof(std::uint64_t))" },
	{ Name: "GetGameRulesNumberFromValue", Old: "!LocalGameRulesNumberValue->IsBigInt()", New: "false" },
	{ Name: "GetGameRulesNumberFromValue", Old: "Uint64Value(&bLosslessGameRulesNumberConversion)", New: "Uint64Value(nullptr)" },
	{ Name: "GetGameRulesNumberFromValue", Old: "!bLosslessGameRulesNumberConversion ||", New: "" },
	{ Name: "GetGameRulesNumberFromValue", Old: "Int64Value(&bLosslessGameRulesNumberConversion)", New: "Int64Value(nullptr)" },
	{ Name: "GetGameRulesNumberFromValue", Old: "if (!bLosslessGameRulesNumberConversion)", New: "if (false)" },
	{ Name: "GetGameRulesNumberFromValue", Old: "LocalContext.IsEmpty() || !LocalGameRulesNumberValue->IsNumber()", New: "false" },
	{ Name: "GetGameRulesNumberFromValue", Old: "MaybeGameRulesNumberValue.IsNothing()", New: "false" },
	{ Name: "GetGameRulesNumberFromValue", Old: "!std::isfinite(dblParsedGameRulesNumberValue)", New: "false" },
	{ Name: "GetGameRulesNumberFromValue", Old: "dblParsedGameRulesNumberValue > static_cast<double>(std::numeric_limits<T>::max())", New: "false" },
	{ Name: "GetGameRulesNumberFromValue", Old: "std::floor(dblParsedGameRulesNumberValue) != dblParsedGameRulesNumberValue", New: "false" },
	{ Name: "GetGameRulesNumberFromValue", Old: "GameRulesNumberValueOut = static_cast<T>(dblParsedGameRulesNumberValue);", New: "GameRulesNumberValueOut = 0;" },
	{ Name: "GetGameRulesUnsignedNumberFromValue", Old: "if constexpr (sizeof(T) < sizeof(std::uint64_t))", New: "if constexpr (sizeof(T) <= sizeof(std::uint64_t))" },
	{ Name: "GetGameRulesUnsignedNumberFromValue", Old: "!GetUInt64ValueFromValue(", New: "GetUInt64ValueFromValue(" },
	{ Name: "GetGameRulesUnsignedNumberFromValue", Old: "unGameRulesNumberValueOut = unParsedGameRulesNumberValue;", New: "unGameRulesNumberValueOut = 0;" },
	{ Name: "SetGameRulesSignedIntegerPropertyCallback", Old: "!GetGameRulesNumberFromValue(", New: "GetGameRulesNumberFromValue(" },
	{ Name: "SetGameRulesUnsignedIntegerPropertyCallback", Old: "!GetGameRulesUnsignedNumberFromValue(", New: "GetGameRulesUnsignedNumberFromValue(" },
	{ Name: "SetGameRulesBooleanPropertyCallback", Old: "!LocalGameRulesPropertyValue->IsBoolean()", New: "false" },
	{ Name: "SetGameRulesCharacterPropertyCallback", Old: "v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalGameRulesPropertyValue);", New: "v8::String::Utf8Value UTF8Value(pIsolate, LocalGameRulesPropertyValue);" },
	{ Name: "SetGameRulesStringAddressPropertyCallback", Old: "v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalGameRulesPropertyValue);", New: "v8::String::Utf8Value UTF8Value(pIsolate, LocalGameRulesPropertyValue);" },
	{ Name: "SetGameRulesCharacterPropertyCallback", Old: "!pszEncodedGameRulesCharacterValue ||", New: "" },
	{ Name: "SetGameRulesCharacterPropertyCallback", Old: "static_cast<std::size_t>(UTF8Value.length()) != kRequiredGameRulesCharacterCount", New: "false" },
	{ Name: "SetGameRulesCharacterPropertyCallback", Old: "kRequiredGameRulesCharacterCount = 1;", New: "kRequiredGameRulesCharacterCount = 0;" },
	{ Name: "SetGameRulesCharacterPropertyCallback", Old: "} else if (!GetGameRulesNumberFromValue(", New: "} else if (GetGameRulesNumberFromValue(" },
	{ Name: "GetGameRulesCharacterPropertyCallback", Old: "{ chGameRulesPropertyValue, kGameRulesCharacterTerminatorCharacter }", New: "{ chGameRulesPropertyValue, 'x' }" },
	{ Name: "SetGameRulesFloatPropertyCallback", Old: "!GetFloatArgument(", New: "GetFloatArgument(" },
	{ Name: "SetGameRulesDoublePropertyCallback", Old: "!GetNumberArgument(", New: "GetNumberArgument(" },
	{ Name: "SetGameRulesDoublePropertyCallback", Old: "!std::isfinite(dblGameRulesPropertyValue)", New: "false" },
	{ Name: "GetGameRulesStringAddressPropertyCallback", Old: "pszGameRulesPropertyValue ? pszGameRulesPropertyValue : kEmptyGameRulesStringAddressValue", New: "pszGameRulesPropertyValue" },
	{ Name: "GetGameRulesStringBufferPropertyCallback", Old: "!IsMemoryAddressRangeRepresentable(", New: "IsMemoryAddressRangeRepresentable(" },
	{ Name: "GetGameRulesStringBufferPropertyCallback", Old: "unGameRulesStringLength < unMaximumGameRulesStringBufferLength", New: "true" },
	{ Name: "GetGameRulesStringBufferPropertyCallback", Old: "unGameRulesStringLength == unMaximumGameRulesStringBufferLength", New: "false" },
	{ Name: "GetGameRulesStringBufferPropertyCallback", Old: "LocalGameRulesPropertyString.IsEmpty() ||", New: "" },
	{ Name: "SetGameRulesStringAddressPropertyCallback", Old: "strStoredGameRulesPropertyValue.swap(strGameRulesPropertyValue);", New: "strStoredGameRulesPropertyValue = strGameRulesPropertyValue;" },
	{ Name: "SetGameRulesStringAddressPropertyCallback", Old: "WriteMemoryScalarToAddress(unGameRulesPropertyAddress, pszStoredGameRulesPropertyValue);", New: "" },
	{ Name: "SetGameRulesStringBufferPropertyCallback", Old: "v8::String::Utf8Value const UTF8Value = v8::String::Utf8Value(pIsolate, LocalGameRulesPropertyValue);", New: "v8::String::Utf8Value UTF8Value(pIsolate, LocalGameRulesPropertyValue);" },
	{ Name: "SetGameRulesStringBufferPropertyCallback", Old: "!LocalGameRulesStringBufferCapacityValue->IsInt32()", New: "false" },
	{ Name: "SetGameRulesStringBufferPropertyCallback", Old: "strGameRulesPropertyValue.size() >= unGameRulesStringBufferCapacity", New: "false" },
	{ Name: "SetGameRulesStringBufferPropertyCallback", Old: "strGameRulesPropertyValue.size() + kGameRulesStringTerminatorByteCount", New: "strGameRulesPropertyValue.size()" },
	{ Name: "SetGameRulesAddressPropertyCallback", Old: "!GetGameRulesAddressFromValue(", New: "GetGameRulesAddressFromValue(" },
	{ Name: "GetGameRulesVectorFromValue", Old: "kVectorValueErrorMessage, VectorValue)", New: "kVectorValueErrorMessage, VectorValueOut)" },
	{ Name: "GetGameRulesVectorFromValue", Old: "VectorValueOut = VectorValue;", New: "" },
	{ Name: "GetGameRulesFloatComponentPropertyCallback", Old: "!ReadMemoryScalarFromAddress(", New: "ReadMemoryScalarFromAddress(" },
	{ Name: "SetGameRulesFloatComponentPropertyCallback", Old: "!GetFloatArgument(", New: "GetFloatArgument(" },
	{ Name: "SetGameRulesFloatComponentPropertyCallback", Old: "WriteMemoryScalarToAddress(reinterpret_cast<std::uintptr_t>(pflFloatPropertyValue), flComponentValue);", New: "*pflFloatPropertyValue = flComponentValue;" },
	{ Name: "InstallGameRulesFloatProperty", Old: "LocalPropertyName.IsEmpty() ||", New: "" },
	{ Name: "InstallGameRulesFloatProperty", Old: "LocalPropertyData.IsEmpty() ||", New: "" },
	{ Name: "InstallGameRulesFloatProperty", Old: "if (!bPropertyInstalled ||", New: "if (" },
	{ Name: "MakeGameRulesVectorObject", Old: "!IsMemoryAddressRangeRepresentable(unVectorAddress, sizeof(Vector))", New: "false" },
	{ Name: "MakeGameRulesVectorObject", Old: "LocalAddressPropertyName.IsEmpty() ||", New: "" },
	{ Name: "MakeGameRulesVectorObject", Old: "LocalVectorAddressValue.IsEmpty() ||", New: "" },
	{ Name: "MakeGameRulesVectorObject", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "MakeGameRulesVectorObject", Old: "if (!bAddressDefined ||", New: "if (" },
	{ Name: "GetGameRulesVectorPropertyCallback", Old: "LocalVectorObject.IsEmpty() ||", New: "" },
	{ Name: "SetGameRulesVectorPropertyCallback", Old: "!IsMemoryAddressRangeRepresentable(unVectorPropertyAddress, sizeof(Vector))", New: "false" },
	{ Name: "SetGameRulesVectorPropertyCallback", Old: "!GetGameRulesVectorFromValue(", New: "GetGameRulesVectorFromValue(" },
	{ Name: "GetGameRulesColorComponent", Old: "!LocalColorComponentValue->IsUint32()", New: "false" },
	{ Name: "GetGameRulesColorComponent", Old: "nColorComponent > kMaximumColorComponentValue", New: "false" },
	{ Name: "GetGameRulesColorComponent", Old: "nColorComponentOut = nColorComponent;", New: "" },
	{ Name: "GetGameRulesColorFromValue", Old: "!LocalColorValue->IsObject()", New: "false" },
	{ Name: "GetGameRulesColorFromValue", Old: "ColorValueOut.SetColor(nRedColorComponent, nGreenColorComponent, nBlueColorComponent, nAlphaColorComponent);", New: "" },
	{ Name: "GetGameRulesColorFromValue", Old: "ColorValueOut.SetColor(nRedColorComponent, nGreenColorComponent, nBlueColorComponent, nAlphaColorComponent);", New: "ColorValueOut = Color(nRedColorComponent, nGreenColorComponent, nBlueColorComponent, nAlphaColorComponent);" },
	{ Name: "SetGameRulesColorPropertyCallback", Old: "Color ColorPropertyValue = Color(0x0, 0x0, 0x0, 0x0);", New: "Color ColorPropertyValue {};" },
	{ Name: "SetGameRulesColorPropertyCallback", Old: "pColorPropertyValue->SetColor(ColorPropertyValue.r(), ColorPropertyValue.g(), ColorPropertyValue.b(), ColorPropertyValue.a());", New: "*pColorPropertyValue = ColorPropertyValue;" },
	{ Name: "GetGameRulesBytePropertyAddress", Old: "!IsMemoryAddressRangeRepresentable(", New: "IsMemoryAddressRangeRepresentable(" },
	{ Name: "GetGameRulesByteComponentPropertyCallback", Old: "!ReadMemoryScalarFromAddress(", New: "ReadMemoryScalarFromAddress(" },
	{ Name: "SetGameRulesByteComponentPropertyCallback", Old: "!LocalByteComponentValue->IsUint32()", New: "false" },
	{ Name: "SetGameRulesByteComponentPropertyCallback", Old: "MaybeByteComponentValue.IsNothing() ||", New: "" },
	{ Name: "SetGameRulesByteComponentPropertyCallback", Old: "unByteComponentValue > kMaximumByteValue", New: "false" },
	{ Name: "SetGameRulesByteComponentPropertyCallback", Old: "WriteMemoryScalarToAddress(", New: "SkippedWrite(" },
	{ Name: "InstallGameRulesByteProperty", Old: "!IsMemoryAddressRangeRepresentable(", New: "IsMemoryAddressRangeRepresentable(" },
	{ Name: "GetGameRulesObjectFloatComponent", Old: "!LocalComponentValue->IsNumber()", New: "false" },
	{ Name: "GetGameRulesObjectFloatComponent", Old: "flComponentOut = flComponent;", New: "" },
	{ Name: "SetGameRulesColorPropertyCallback", Old: "!IsMemoryAddressRangeRepresentable(", New: "IsMemoryAddressRangeRepresentable(" },
	{ Name: "SetGameRulesIntervalPropertyCallback", Old: "!IsMemoryAddressRangeRepresentable(", New: "IsMemoryAddressRangeRepresentable(" },
	{ Name: "SetGameRulesQuaternionPropertyCallback", Old: "!LocalQuaternionPropertyValue->IsObject()", New: "false" },
	{ Name: "SetGameRulesQuaternionPropertyCallback", Old: "(unQuaternionPropertyAddress % alignof(Quaternion)) != 0", New: "false" },
	{ Name: "SetGameRulesQuaternionPropertyCallback", Old: "!IsMemoryAddressRangeRepresentable(unQuaternionPropertyAddress, sizeof(Quaternion))", New: "false" },
	{ Name: "SetGameRulesQuaternionPropertyCallback", Old: "*pQuaternionPropertyValue = QuaternionPropertyValue;", New: "" },
	{ Name: "SetGameRulesQuaternionPropertyCallback", Old: "CallbackInformation.GetReturnValue().Set(true);", New: "CallbackInformation.GetReturnValue().Set(false);" },
	{ Name: "GetGameRulesEdictPropertyCallback", Old: "!IsMemoryAddressRangeRepresentable(unEdictPropertyAddress, sizeof(edict_t*))", New: "false" },
	{ Name: "GetGameRulesEdictPropertyCallback", Old: "std::memcpy(&pEdictPropertyValue, pchEdictPropertyAddress, sizeof(pEdictPropertyValue));", New: "" },
	{ Name: "GetGameRulesEdictPropertyCallback", Old: "if (!bEdictEntityResolved)", New: "if (bEdictEntityResolved)" },
	{ Name: "GetGameRulesEdictPropertyCallback", Old: "CallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));", New: "CallbackInformation.GetReturnValue().Set(false);" },
	{ Name: "SetGameRulesEdictPropertyCallback", Old: "edict_t* pEdictPropertyValue = nullptr;", New: "edict_t* pEdictPropertyValue;" },
	{ Name: "SetGameRulesEdictPropertyCallback", Old: "if (!LocalEdictPropertyValue->IsNull())", New: "if (true)" },
	{ Name: "SetGameRulesEdictPropertyCallback", Old: "if (nEdictEntityIndex < 0)", New: "if (false)" },
	{ Name: "SetGameRulesEdictPropertyCallback", Old: "!IsMemoryAddressRangeRepresentable(unEdictPropertyAddress, sizeof(edict_t*))", New: "false" },
	{ Name: "SetGameRulesEdictPropertyCallback", Old: "std::memcpy(pchEdictPropertyAddress, &pEdictPropertyValue, sizeof(pEdictPropertyValue));", New: "" },
	{ Name: "SetGameRulesEdictPropertyCallback", Old: "CallbackInformation.GetReturnValue().Set(true);", New: "CallbackInformation.GetReturnValue().Set(false);" },
	{ Name: "InstallGameRulesFunction", Old: "!Callback ||", New: "" },
	{ Name: "InstallGameRulesFunction", Old: "!v8::Function::New(", New: "v8::Function::New(" },
	{ Name: "InstallGameRulesFunction", Old: "v8::Function::New(LocalContext, Callback, LocalRuntimeData)", New: "v8::Function::New(LocalContext, Callback)" },
	{ Name: "InstallGameRulesFunction", Old: "LocalFunctionName.IsEmpty() ||", New: "" },
	{ Name: "InstallGameRulesFunction", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "InstallGameRulesFunction", Old: "if (!bFunctionDefined ||", New: "if (" },
]) {
	RejectMutation(Mutation);
}

console.log("Game-rules address source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/engine execution not exercised.");
