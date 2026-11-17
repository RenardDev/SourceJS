#!/usr/bin/env node

"use strict";

// Executes actual ModuleBindings error/conversion helpers with configured real V8.
// Controlled MakeString entry faults model empty handles, exceptions, and
// termination, not allocator/OOM behavior. SDK Vector storage is adapted;
// actual numeric/vector parsers and entity record builders run against real JS
// values, getters, inherited setters, and keys. SDK handle packing is adapted.
// Client/server addresses, callbacks, properties and record builders execute actual
// helpers; SDK client/server operations are adapted.
// Checksum UTF-8 result faults and SDK MD5/event dispatch are adapted; actual
// checksum conversion/hex output and game-event name validation execute in V8.
// Actual command-name coercion/NUL validation executes in V8 with controlled UTF-8 result faults.
// Actual ConVar lookups and command enumeration execute with adapted SDK registries;
// iterator/list dispatch, UTF-8 result faults and pending native errors are controlled.
// No game server or SDK ABI is emulated.
// Actual current game-event payload/direct-access bodies are also extracted.
// --game-event-payload-only selects their capability profiles and negative controls;
// each selected executable still runs the shared fixture checks.
// --datamap-properties-only selects the same capability profiles and datamap controls.
// --entity-properties-only keeps all positive profiles and selects network-property selector controls.
// --entity-property-lifetime-only selects Current and entity-property lifetime controls.
// --filesystem-only keeps all positive profiles and every filesystem negative control.
// --keyvalues-only keeps all positive profiles and every KeyValues negative control.
// --bitbuffers-only keeps all positive profiles and every BitBuffer negative control.
// --sound-only keeps all positive profiles and every Sound negative control.
// --spatial-partition-only selects Current and engine ownership/identity negative controls.
// --map-load-type-only selects Current and both installer error-identity controls.
// --text-message-only selects modern/legacy snapshots and two compiled lifetime controls.
// --transmit-snapshots-only selects current/legacy profiles and ten native snapshot controls.
// --client-keyvalues-only selects current/legacy transfer profiles and six ownership/identity controls.
// --installation-only selects Current and globals/messages unwind/name controls.
// --player-ban-only selects Current and strict duration/default/translation negative controls.
// --console-bootstrap-only selects SDK bootstrap capability profiles and native ownership controls.
// --cvar-creation-only selects owned ConVar creation/lifecycle profiles and negative controls.
// --weapons-dictionary-only selects Current and an independently compiled dictionary counter control.
// --engine-address-records-only selects Current and the shared address-record initializer control.
// --client-records-only selects Current and client/statistics own-property initializer controls.
// --server-records-only selects Current and IServer own-method initializer controls.
// --player-records-only selects base-entity-present/absent profiles and Player own-method controls.
// --entity-records-only selects base-entity-present/absent profiles and entity/missing-ConVar construction controls.
// --core-records-only selects Current and command/core own-record, native-require, and version-query controls.
// --entity-hook-options-only selects Current and two own-field construction controls; borrowed-options checks remain active.
// --binding-records-only selects modern/legacy native installers; only the SDK command-limit query is adapted.
// --cvar-enumeration-only selects Current and indexed-own-property/exception controls for both ICvar traversal forms.
// --cvar-flags-tags-only selects sparse, all-flags and no-notify profiles plus own-flag/tag-array controls; SDK flag values and registry dispatch are controlled.
// --event-records-only selects uint64-present/absent profiles and own hook-options/event-info/conditional-export/sound-constant/trace-entity controls; SDK records and dispatch are adapted.
// --runtime-require-only selects actual runtime require helpers, prototype/exception
// checks and independently compiled controls; only the local-loader operation is adapted.
// Current dictionary/recipient/voice callbacks also execute; the compiler-built
// single-primary-vptr voice model and readable missing-method sentinel are adapters, not SDK ABI proof.
// --help reports usage without reading a build tree. Invalid arguments exit 2;
// failed checks exit 1, and successful checks/help exit 0.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_unProcessTimeoutMilliseconds = 240000;
const g_unMaximumOutputBytes = 16 * 1024 * 1024;
const g_vecProfileFlags = [
	"--game-event-payload-only",
	"--datamap-properties-only",
	"--entity-properties-only",
	"--entity-property-lifetime-only",
	"--filesystem-only",
	"--keyvalues-only",
	"--bitbuffers-only",
	"--sound-only",
	"--spatial-partition-only",
	"--map-load-type-only",
	"--text-message-only",
	"--transmit-snapshots-only",
	"--client-keyvalues-only",
	"--installation-only",
	"--player-ban-only",
	"--console-bootstrap-only",
	"--cvar-creation-only",
	"--weapons-dictionary-only",
	"--engine-address-records-only",
	"--client-records-only",
	"--server-records-only",
	"--player-records-only",
	"--entity-records-only",
	"--core-records-only",
	"--entity-hook-options-only",
	"--binding-records-only",
	"--cvar-enumeration-only",
	"--cvar-flags-tags-only",
	"--event-records-only",
	"--runtime-require-only",
];
const g_strUsage = "Usage: node tools/smoke_module_binding_errors_v8.js --build-tree <configured-production-build> [" + g_vecProfileFlags.join("|") + "]\n       node tools/smoke_module_binding_errors_v8.js --help";
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

const g_bValidArguments = ((g_vecArguments.length === 2) || ((g_vecArguments.length === 3) && g_vecProfileFlags.includes(g_vecArguments[2]))) && (g_vecArguments[0] === "--build-tree") && (g_vecArguments[1].length > 0);
if (!g_bValidArguments) {
	console.error(g_strUsage);
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform), "Requires a configured Windows/Linux V8 profile.");
const g_strRoot = g_Path.resolve(__dirname, "..").replace(/\\/g, "/");
const g_strBuildTree = g_FileSystem.realpathSync(g_Path.resolve(g_vecArguments[1]));
const g_strCache = g_FileSystem.readFileSync(g_Path.join(g_strBuildTree, "CMakeCache.txt"), "utf8");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r/g, "");
const g_strBitBufferTestSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "smoke_bitbuffers.js"), "utf8").replace(/\r/g, "");
const g_vecBitBufferSourceContractMatch = g_strBitBufferTestSource.match(/^function VerifyBitBufferByteSourceContracts\(CreateReader, CreateWriter, PackUInt32\) \{[\s\S]*?^\}/m);
g_Assert(g_vecBitBufferSourceContractMatch, "Find the canonical shared BitBuffer byte-source scenarios.");
const g_strBitBufferSourceContractScript = g_vecBitBufferSourceContractMatch[0] + "\nVerifyBitBufferByteSourceContracts(FixtureCreateBitBufferReader, FixtureCreateBitBufferWriter, FixturePackBitBufferUInt32);";
g_Assert(!g_strBitBufferSourceContractScript.includes(')SourceJS"'), "Shared BitBuffer scenarios must not close the generated C++ raw literal.");
const g_strRawTemplate = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/ModuleBindingErrorsV8.cpp"), "utf8").replace(/\r/g, "");
g_Assert.equal(g_strRawTemplate.split("@BITBUFFER_BYTE_SOURCE_CONTRACT@").length, 2, "Unique shared BitBuffer scenario placeholder.");
const g_strTemplate = g_strRawTemplate.replace("@BITBUFFER_BYTE_SOURCE_CONTRACT@", () => g_strBitBufferSourceContractScript);

function ReadCache(strName, bRequired = true) {
	const vecMatches = g_strCache.match(new RegExp("^" + strName + ":[^=]*=(.*)$", "m"));
	g_Assert(!bRequired || vecMatches?.[1], "Missing configured cache entry: " + strName);

	return vecMatches?.[1].trim() ?? "";
}

function GetDefinition(strName, strParameterPattern = "[^\\n]*") {
	const vecMatches = g_strSource.match(new RegExp("^\\t\\t[^\\t\\n].*\\b" + strName + "\\(" + strParameterPattern + "\\)(?: noexcept)?(?: try)? \\{", "m"));
	g_Assert(vecMatches, "Missing actual definition: " + strName);

	const vecEndMatches = g_strSource.slice(vecMatches.index).match(/^\t\t}$/m);
	g_Assert(vecEndMatches && (vecEndMatches.index > 0), "Missing actual definition end: " + strName);

	return g_strSource.slice(vecMatches.index, vecMatches.index + vecEndMatches.index + vecEndMatches[0].length);
}

function GetEnumerationDefinition(strName) {
	const vecMatches = [...g_strSource.matchAll(new RegExp("^\\t\\tenum class " + strName + "(?: : [^\\n{]+)? \\{", "gm"))];
	g_Assert.equal(vecMatches.length, 1, "Unique enumeration definition: " + strName);

	const unStart = vecMatches[0].index;
	const nEnd = g_strSource.indexOf("\n\t\t};", unStart);
	g_Assert((unStart >= 0) && (nEnd > unStart), "Locate actual enumeration: " + strName);

	return g_strSource.slice(unStart, nEnd + "\n\t\t};".length);
}

function GetServerTemplateDefinition(strName) {
	const strDefinition = GetDefinition(strName);
	const strHeader = "\t\ttemplate <typename TServer>\n";
	g_Assert(g_strSource.includes(strHeader + strDefinition), "Preserve actual server template: " + strName);

	return strHeader + strDefinition;
}

function ReplaceOnce(strSource, strOld, strNew) {
	g_Assert.equal(strSource.split(strOld).length, 2, "Unique mutation target: " + strOld);

	// Source mutations are literal text, not replacement-token expressions such as $&.
	return strSource.replace(strOld, () => strNew);
}

function GetFixtureConstants(strDefinition, vecNames) {
	return vecNames.map(strName => {
		const vecMatch = new RegExp("^\\t+constexpr [^\\n]*\\b" + strName + "[^\\n]*;$", "m").exec(strDefinition);
		g_Assert(vecMatch, "Preserve actual fixture constant: " + strName);

		return "\t\t\t" + vecMatch[0].trim();
	}).join("\n");
}

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strRoot, encoding: "utf8", timeout: g_unProcessTimeoutMilliseconds, maxBuffer: g_unMaximumOutputBytes, windowsHide: true });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Native process signal: " + Result.signal);

	return Result;
}

function RequireSuccess(strCommand, vecArguments) {
	const Result = Run(strCommand, vecArguments);
	g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "New fixture warning:\n" + Result.stdout + Result.stderr);

	return Result;
}

const g_strV8Root = ReadCache("V8_ROOT").replace(/\\/g, "/");
const g_strV8Configuration = ReadCache("V8_CONFIG");
g_Assert(![g_strRoot, g_strV8Root, g_strV8Configuration].some(strValue => /[;"\r\n]|\$\{/.test(strValue)), "Unsafe CMake path/configuration value.");

const g_strPlatform = (process.platform === "win32") ? "windows" : "linux";
const g_strFaultAdapter = [
	"\t\t\t++g_unMessageCalls;",
	"",
	"\t\t\tif (((g_MessageFault == MessageFault::CppException) || (g_MessageFault == MessageFault::PendingCppException)) && (g_unMessageCalls == g_unMessageFaultCall)) {",
	"\t\t\t\tconst bool bPendingException = g_MessageFault == MessageFault::PendingCppException;",
	"\t\t\t\tg_MessageFault = MessageFault::None;",
	"",
	"\t\t\t\tif (bPendingException) {",
	"\t\t\t\t\tpIsolate->ThrowException(v8::True(pIsolate));",
	"\t\t\t\t}",
	"",
	"#if defined(SOURCEJS_FIXTURE_TRACE_NOEXCEPT_TERMINATION)",
	"\t\t\t\t// Only deliberate noexcept mutants install this controlled termination witness.",
	"\t\t\t\tInstallTraceNoexceptTerminationProbe();",
	"#endif",
	"\t\t\t\tthrow std::runtime_error(\"Synthetic string-construction entry failure\");",
	"\t\t\t}",
	"",
	"\t\t\tif (g_MessageFault == MessageFault::Empty) {",
	"\t\t\t\treturn {};",
	"\t\t\t}",
	"",
	"\t\t\tif (g_MessageFault == MessageFault::PendingException) {",
	"\t\t\t\tpIsolate->ThrowException(v8::True(pIsolate));",
	"\t\t\t\treturn {};",
	"\t\t\t}",
	"",
	"\t\t\tif (g_MessageFault == MessageFault::Termination) {",
	"\t\t\t\tTerminateScript(pIsolate);",
	"\t\t\t\treturn {};",
	"\t\t\t}",
	"",
	"",
].join("\n");
const g_strMakeString = [GetDefinition("MakeString", "v8::Isolate\\* const pIsolate, char const\\* const pszValue"), GetDefinition("MakeString", "v8::Isolate\\* const pIsolate, std::string const& strValue")].map(strDefinition => strDefinition.replace(" {\n", " {\n" + g_strFaultAdapter)).join("\n\n");
const g_strThrowError = GetDefinition("ThrowError");
const g_strThrowTypeError = GetDefinition("ThrowTypeError");
const g_strConverters = ["GetNumberArgument", "IsValueNullish", "GetFloatArgument", "OptionalFloatFromArray", "OptionalFloatFromObject", "VectorComponentFromObject", "GetVectorFromValue"].map(strName => GetDefinition(strName)).join("\n\n");
const g_strRequiredVector = GetDefinition("RequireVectorFromValue");
const g_strEntityRecordProperty = GetDefinition("CreateEntityRecordProperty").replace(" {\n", " {\n" + ["\t\t\t// Controlled last-property failure; not allocator/OOM emulation.", "\t\t\tif (g_bFixtureEntityRecordPropertyFailure && pIsolate && pszName && ((std::strcmp(pszName, \"ClassName\") == 0) || (std::strcmp(pszName, \"Valid\") == 0))) {", "\t\t\t\tpIsolate->ThrowException(v8::False(pIsolate));", "\t\t\t\treturn false;", "\t\t\t}", "", ""].join("\n"));
const g_strBooleanSetter = GetDefinition("SetBoolean");
const g_strSetters = ["SetValue", "SetString", "SetInteger", "SetFunction"].map(strName => GetDefinition(strName)).join("\n\n") + "\n\n" + g_strEntityRecordProperty;
const g_strEntityRecordFailureTail = "\n\t\t\t\treturn {};\n\t\t\t}\n\n\t\t\treturn LocalObject;\n\t\t}";
const g_strHandleRecord = GetDefinition("MakeEntityBaseHandleObject");
const g_strAddressRecord = GetDefinition("MakeEntityAddressObject");
const g_strValueToString = GetDefinition("ValueToString");
const g_vecCallbackNames = ["PlayerGiveNamedItemMethodCallback", "GiveNamedItemCallback", "GiveNamedItemEntityIndexCallback", "EntitySlayMethodCallback", "EntityCallInputMethodCallback", "CallEntityInputCallback", "EntityRemoveMethodCallback", "PlayerExecuteClientCommandMethodCallback", "PlayerSlayMethodCallback", "PlayerSayMethodCallback", "PlayerSayTeamMethodCallback"];
const g_strCallbacks = [GetDefinition("CallEntityInputByIndex"), ...g_vecCallbackNames.map(strName => GetDefinition(strName))].join("\n\n");
const g_strPlayerIndexHelpers = ["GetIntegerFromValue", "GetObjectIndex", "GetValueIndex", "ReadEntityIndex"].map(strName => GetDefinition(strName)).join("\n\n") + "\n\n" + GetDefinition("ReadEntityIndex", "v8::FunctionCallbackInfo[^\\n]*");
g_Assert.match(GetDefinition("ReadEntityIndex"), /^\t\tbool ReadEntityIndex\(v8::Isolate\*/);
const g_vecClientCallbackNames = ["DisconnectCurrentIServerClientCallback", "ExecuteIServerClientStringCommandCallback", "PrintToIServerClientConsoleCallback", "GetIServerClientUserSettingCallback", "SetIServerClientNetworkRateCallback", "SetIServerClientUpdateRateCallback"];
g_Assert.match(g_strSource, /\n\t\ttemplate <typename TClient>\r?\n\t\tvoid DisconnectClient\(/, "Preserve the actual client template declaration.");
const g_strClientAddressParser = GetDefinition("GetEngineServerAddressFromValue");
const g_strEngineServerAddressRecord = GetDefinition("MakeEngineServerAddressObject");
g_Assert.equal((g_strEngineServerAddressRecord.match(/\bSetRecordProperty\(/g) ?? []).length, 2, "Preserve both own engine address metadata fields.");
const g_strEngineAddressKindWrite = '\t\t\tif (!SetRecordProperty(pIsolate, LocalContext, LocalAddressObject, kAddressTypePropertyName, MakeString(pIsolate, pszAddressTypeName))) {';
const g_strEngineAddressFixtureHook = [
	"\t\t\t// Controlled construction hook for cleanup/reentry checks; not a production setter or allocator/OOM emulation.",
	"\t\t\tif (g_bFixtureEngineAddressPropertyHook) {",
	"\t\t\t\tv8::Local<v8::String> const LocalHookName = MakeString(pIsolate, \"FixtureEngineAddressPropertyHook\");",
	"\t\t\t\tif (LocalHookName.IsEmpty()) {",
	"\t\t\t\t\treturn {};",
	"\t\t\t\t}",
	"",
	"\t\t\t\tv8::Local<v8::Value> LocalHook {};",
	"\t\t\t\tif (!LocalContext->Global()->Get(LocalContext, LocalHookName).ToLocal(&LocalHook) || !LocalHook->IsFunction()) {",
	"\t\t\t\t\treturn {};",
	"\t\t\t\t}",
	"",
	"\t\t\t\tv8::Local<v8::Value> LocalHookResult {};",
	"\t\t\t\tif (!LocalHook.As<v8::Function>()->Call(LocalContext, LocalAddressObject, 0, nullptr).ToLocal(&LocalHookResult)) {",
	"\t\t\t\t\treturn {};",
	"\t\t\t\t}",
	"\t\t\t}",
	"",
	"",
].join("\n");
const g_strEngineServerAddressRecordFixture = ReplaceOnce(g_strEngineServerAddressRecord, g_strEngineAddressKindWrite, g_strEngineAddressFixtureHook + g_strEngineAddressKindWrite);
const g_strClientHelpers = [
	GetDefinition("SetRecordProperty"),
	GetDefinition("SetRecordFunction"),
	GetDefinition("GetAddressSizedUnsignedIntegerFromValue"),
	g_strClientAddressParser,
	GetDefinition("GetIServerClientFromValue"),
	GetDefinition("RequireIServerClientFromThis"),
	g_strEngineServerAddressRecordFixture,
	"\t\ttemplate <typename TClient>\n" + GetDefinition("DisconnectClient"),
	...g_vecClientCallbackNames.map(strName => GetDefinition(strName)),
	GetEnumerationDefinition("IServerClientProperty"),
	...["GetIServerClientPropertyCallback", "InstallIServerClientProperty", "MakeIServerClientObject"].map(strName => GetDefinition(strName)),
].join("\n\n");
const g_vecServerFamilies = ["Number", "Boolean", "String"];
const g_vecServerCallbackNames = ["GetIServerClientCallback", "GetIServerNetworkStatisticsCallback", "SetIServerPasswordCallback", "SetIServerPausedCallback", "SetIServerTimescaleCallback", "DisconnectIServerClientCallback"];
const g_strServerHelpers = [
	...["GetIServerUDPPort", "GetIServerTimescale", "GetIServerReplayState", "SetIServerTimescale"].map(strName => GetServerTemplateDefinition(strName)),
	...["RequireIServer", "GetIServerFromValue", "RequireIServerFromThis"].map(strName => GetDefinition(strName)),
	...g_vecServerFamilies.map(strFamily => GetEnumerationDefinition("IServer" + strFamily + "Operation") + "\n\n" + GetDefinition("GetIServer" + strFamily + "Callback")),
	...g_vecServerCallbackNames.map(strName => GetDefinition(strName)),
	...["MakeEngineServerObject", "GetEngineServerCallback", "GetEngineServerFromAddressCallback", "MakeSafePlayerKickCommandReason", "PlayerKickMethodCallback"].map(strName => GetDefinition(strName)),
].join("\n\n");
const g_vecPlayerCallbackNames = ["PlayerBanMethodCallback", "PlayerChangeTeamMethodCallback", "SetPlayerNameCallback", "SendClientCommandCallback", "SayCallback", "SayToTeamCallback"];
const g_vecAnyTeamMatches = g_strSource.match(/^\t\tconstexpr int kAnyTeamIndex = -1;$/gm);
g_Assert.equal(g_vecAnyTeamMatches?.length, 1, "Preserve the actual team sentinel.");
const g_strPlayerHelpers = [
	g_vecAnyTeamMatches[0],
	GetDefinition("GetTeamNumberFromValue"),
	"#define SOURCEJS_HAS_ISERVER 1\n#define INTERFACEVERSION_SERVERGAMECLIENTS \"ServerGameClientsFixture\"\n" + GetDefinition("SetPlayerNameForPlayerIndex") + "\n#undef INTERFACEVERSION_SERVERGAMECLIENTS\n#undef SOURCEJS_HAS_ISERVER",
	GetDefinition("PlayerSetNameMethodCallback"),
	...g_vecPlayerCallbackNames.map(strName => GetDefinition(strName)),
	GetDefinition("PlayerIgniteMethodCallback"),
	GetDefinition("MakeVectorObject"),
	GetEnumerationDefinition("PlayerLiveProperty"),
	GetDefinition("PlayerGetLivePropertyCallback"),
].join("\n\n");
const g_vecPlayerQueryProbes = [
	{ Name: "GetPlayerNameCallback", Operation: "players.GetName()" },
	{ Name: "GetPlayerTeamCallback", Operation: "players.GetTeam()" },
	{ Name: "GetPlayerUserIDCallback", Operation: "players.GetUserID()" },
	{ Name: "GetPlayerNetworkIDCallback", Operation: "players.GetNetworkID()" },
	{ Name: "GetPlayerOriginCallback", Operation: "players.GetOrigin()" },
	{ Name: "IsPlayerConnectedCallback", Operation: "players.IsConnected()" },
	{ Name: "IsPlayerFakeClientCallback", Operation: "players.IsFakeClient()" },
	{ Name: "IsPlayerDeadCallback", Operation: "players.IsDead()" },
];
const g_strPlayerProperties = [
	"#if defined(SOURCEJS_HAS_BASE_ENTITY) && (defined(_WIN32) || defined(__linux__))\n" + ["PlayerAddVelocityMethodCallback", "PlayerGetEyeAnglesMethodCallback", "PlayerTeleportMethodCallback"].map(strName => GetDefinition(strName)).join("\n\n") + "\n#endif",
	...["MakeEntityEdictObject", "MakeEntityBaseEntityObject", "MakeEntityEdictValue", "MakeEntityBaseEntityValue", "MakeEntityAddressValue", "MakeEntityBaseHandleValue"].map(strName => GetDefinition(strName)),
	GetEnumerationDefinition("EntityLiveProperty"),
	...["IsWeaponClassName", "GetWeaponNameFromClassName", "GetEntityLivePropertyCallback", "SetEntityLivePropertyCallback", "InstallEntityLiveProperty", "MakeEntityObject", "NormalizeWeaponClassName", "MakeWeaponObject", "PlayerSetLiveProperty", "InstallPlayerLiveProperty", "MakePlayerObject", "RequirePlayerInformationArgument"].map(strName => {
		const strDefinition = GetDefinition(strName);
		if (strName !== "MakeWeaponObject") {
			return strDefinition;
		}

		// Explicit fixture-only state change, not an inherited setter or production callback boundary.
		return ReplaceOnce(strDefinition, "v8::Local<v8::Object> const LocalWeaponObject = MakeEntityObject(pIsolate, LocalContext, nEntityIndex);", "RunFixtureWeaponConstructionHook(nEntityIndex);\n\n\t\t\tv8::Local<v8::Object> const LocalWeaponObject = MakeEntityObject(pIsolate, LocalContext, nEntityIndex);");
	}),
	...g_vecPlayerQueryProbes.map(Probe => GetDefinition(Probe.Name)),
].join("\n\n");
const g_strWeaponDictionaryHelpers = ["GetWeaponClassName", "IsWeaponEdict", "CollectWeaponIndexes", "GetAllWeaponsDictionaryCallback"].map(strName => GetDefinition(strName)).join("\n\n");
const g_strConVarProperties = GetEnumerationDefinition("ConVarLiveProperty") + "\n\n" + ["ConVarGetLiveProperty", "ConVarSetLiveProperty", "ConVarInstallLiveProperty"].map(strName => {
	const strDefinition = GetDefinition(strName);
	const strTemplate = "\t\ttemplate <ConVarLiveProperty PropertyInformation>\n";
	g_Assert(g_strSource.includes(strTemplate + strDefinition), "Preserve actual ConVar template: " + strName);

	return strTemplate + strDefinition;
}).join("\n\n") + "\n\n" + GetDefinition("MakeConVarObject");
const g_strConCommandProperties = ["GetConCommandBaseFromPropertyInformation", "ConCommandGetExistsProperty", "ConCommandGetFlagsProperty", "ConCommandSetReadOnlyProperty", "ConCommandSetFlagsProperty", "MakeConCommandBaseObject", "MakeModule", "GetCoreVersionCallback"].map(strName => GetDefinition(strName)).join("\n\n");
const g_strCoreInformationHelpers = [
	GetDefinition("BuildCoreInformationObject"),
	ReplaceOnce(GetDefinition("GetCoreInformationCallback"), "RuntimePaths const& RuntimePathsValue = g_Application.GetRuntimePaths();\n\t\t\tstd::filesystem::path const PathGameRoot = RuntimePathsValue.GetGameRootPath();", "Require(g_pFixtureCoreGameRootPath != nullptr, \"Scope the controlled core game-root path\");\n\t\t\tstd::filesystem::path const PathGameRoot = *g_pFixtureCoreGameRootPath;"),
	GetDefinition("GetCurrentBuildCallback"),
	GetDefinition("IsCoreUnversionedCallback"),
	ReplaceOnce(ReplaceOnce(GetDefinition("IsCoreUnversionedCallback"), "void IsCoreUnversionedCallback(", "void IsCoreUnversionedEmptyFixtureCallback("), "SOURCEJS_VERSION", '\"\"'),
	ReplaceOnce(GetDefinition("RequireCallback"), "GetRuntimeFromCallbackInformation(", "GetFixtureModuleRuntimeFromCallbackInformation("),
].join("\n\n");
const g_strChecksum = ReplaceOnce(GetDefinition("GetCoreChecksumCallback"), "char const* const pszEncodedValue = *UTF8Value;", "if (g_bChecksumPendingException) {\n\t\t\t\tpIsolate->ThrowException(v8::True(pIsolate));\n\t\t\t}\n\n\t\t\tchar const* const pszEncodedValue = g_bChecksumEncodingFailure ? nullptr : *UTF8Value;");
const g_vecGameEventCallbacks = ["RegisterGameEventListenerCallback", "UnregisterGameEventListenerCallback"];
const g_strChecksumAndGameEvents = [g_strChecksum, ...g_vecGameEventCallbacks.map(strName => GetDefinition(strName))].join("\n\n");
const g_strCommandName = ReplaceOnce(GetDefinition("ReadCommandName"), "char const* const pszEncodedName = *UTF8Value;", "if (g_bCommandNamePendingException) {\n\t\t\t\tpIsolate->ThrowException(v8::True(pIsolate));\n\t\t\t}\n\n\t\t\tchar const* const pszEncodedName = g_bCommandNameEncodingFailure ? nullptr : *UTF8Value;");
const g_strConVarName = ReplaceOnce(GetDefinition("ReadConVarName"), "char const* const pszEncodedName = *UTF8Value;", "if (g_bConVarNamePendingException) {\n\t\t\t\tpIsolate->ThrowException(v8::True(pIsolate));\n\t\t\t}\n\n\t\t\tchar const* const pszEncodedName = g_bConVarNameEncodingFailure ? nullptr : *UTF8Value;");
const g_strCVarInterface = ReplaceOnce(GetDefinition("RequireCVarInterface"), "g_Application.GetEngineInterfaces().GetCVar()", "GetFixtureCVarInterface()");
const g_vecControlledCVarFlagDefinitions = [
	["FCVAR_NONE", "0x0"],
	["FCVAR_DEVELOPMENTONLY", "0x2"],
	["FCVAR_GAMEDLL", "0x4"],
	["FCVAR_CLIENTDLL", "0x8"],
	["FCVAR_HIDDEN", "0x10"],
	["FCVAR_PROTECTED", "0x20"],
	["FCVAR_SPONLY", "0x40"],
	["FCVAR_ARCHIVE", "0x80"],
	["FCVAR_USERINFO", "0x200"],
	["FCVAR_PRINTABLEONLY", "0x400"],
	["FCVAR_UNLOGGED", "0x800"],
	["FCVAR_NEVER_AS_STRING", "0x1000"],
	["FCVAR_REPLICATED", "0x2000"],
	["FCVAR_CHEAT", "0x4000"],
	["FCVAR_DEMO", "0x8000"],
	["FCVAR_DONTRECORD", "0x10000"],
	["FCVAR_NOT_CONNECTED", "0x20000"],
	["FCVAR_ARCHIVE_XBOX", "0x40000"],
	["FCVAR_SERVER_CAN_EXECUTE", "0x80000"],
	["FCVAR_SERVER_CANNOT_QUERY", "0x100000"],
	["FCVAR_CLIENTCMD_CAN_EXECUTE", "0x200000"],
];

const g_strCVarEnumeration = GetDefinition("CVarsAppendList");
const g_strCVarTemplate = "\t\ttemplate <typename TCVar>\n";
g_Assert(g_strSource.includes(g_strCVarTemplate + g_strCVarEnumeration), "Preserve actual ICvar enumeration template.");
const g_vecCVarLookupCallbacks = ["FindConVarCallback", "DoesConVarExistCallback"];
const g_strCVarLookups = [g_strConVarName, g_strCVarInterface, ...g_vecCVarLookupCallbacks.map(strName => GetDefinition(strName)), g_strCVarTemplate + g_strCVarEnumeration, GetDefinition("GetConCommandBaseRecordsCallback")].join("\n\n");

function GetCVarOperationDefinition(strName) {
	return GetDefinition(strName).replaceAll("g_Application.GetEngineInterfaces().FindCommandBase(", "FindFixtureCommandBase(").replaceAll("g_Application.GetEngineInterfaces().RegisterConCommand(", "RegisterFixtureConVar(").replaceAll("g_Application.GetEngineInterfaces().UnregisterConCommand(", "UnregisterFixtureConVar(");
}

const g_vecCVarOperationCallbacks = ["GetConVarCallback", "RequireConVarCallback", "GetConVarIntegerCallback", "GetConVarFloatCallback", "GetConVarBooleanCallback", "SetConVarCallback", "RevertConVarToDefaultCallback", "SetConVarFlagsCallback", "AddConVarFlagsCallback", "RemoveConVarFlagsCallback", "CreateConVarCallback"];
const g_vecCreatedStorageMatches = [...g_strSource.matchAll(/^\t\tstruct CreatedConVarStorage \{[\s\S]*?\n\t\t};/gm)];
g_Assert.equal(g_vecCreatedStorageMatches.length, 1, "Extract the current ConVar backing-storage record.");
const g_strCreatedStorage = "#if defined(SOURCEJS_HAS_CONVAR_CREATION)\n" + [g_vecCreatedStorageMatches[0][0], GetDefinition("GetCreatedConVars"), GetCVarOperationDefinition("CreateOrRegisterOwnedConVar"), GetCVarOperationDefinition("UnregisterCreatedConVars")].join("\n\n") + "\n#endif";
const g_strCVarOperations = ["GetConVarCallback", "CVarsRequireConVarFromArguments", "RequireConVarCallback", "GetConVarIntegerCallback", "GetConVarFloatCallback", "GetConVarBooleanCallback", "ReadConVarString", "SetConVarCallback", "RevertConVarToDefaultCallback", "CVarsRequireConCommandBaseFromArguments", "SetConVarFlagsCallback", "AddConVarFlagsCallback", "RemoveConVarFlagsCallback"].map(strName => GetCVarOperationDefinition(strName)).join("\n\n") + "\n\n" + g_strCreatedStorage + "\n\n" + GetCVarOperationDefinition("CreateConVarCallback");
const g_vecCVarPublicAndTagCallbacks = ["SetConVarPublicCallback", "IsConVarPublicCallback", "FindPublicConVarCallback", "GetConVarNumericConstantCallback", "GetConVarObjectConstantCallback", "GetConVarFlagConstantCallback", "GetPublicConVarConstantCallback", "GetServerTagsStringCallback", "SetServerTagsStringCallback", "GetServerTagsCallback"];
// Preserve actual dependency order; the four constant dispatch leaves are adapters.
const g_strCVarPublicAndTagHelpers = ["SetConVarPublicCallback", "IsConVarPublicCallback", "FindPublicConVarCallback", "GetConVarNumericConstantCallback", "GetConVarObjectConstantCallback", "GetConVarFlagConstantCallback", "GetPublicConVarConstantCallback", "InstallCVarFlagConstants", "GetSVTagsConVar", "TrimTag", "SplitTags", "JoinTags", "HasTag", "GetServerTagsStringCallback", "SetServerTagsStringCallback", "GetServerTagsCallback"].map(strName => GetDefinition(strName)).join("\n\n");
const g_strEventResourceHelpers = ["IsEventVariableType", "RequireEventVariableType", "GetEventVariableTypeFromValue", "GetObjectValue", "RequireEventStringFromValue", "RequireEventObjectFromValue", "GetEventVariableTypeFromDefinition", "AppendEscapedResourceString", "MakeEventResourceLine", "BuildEventResourceText"].map(strName => {
	const strDefinition = GetDefinition(strName);
	if (strName === "RequireEventStringFromValue") {
		return ReplaceOnce(strDefinition, "char const* const pszValue = *UTF8Value;", "char const* const pszValue = ReadFixtureEventUTF8Value(pIsolate, *UTF8Value);");
	}

	return strDefinition;
}).join("\n\n");
const g_vecPayloadCallbackNames = ["GetGameEventManagerAddressCallback", "GetFireEventHookOptionsCallback", "GetEventAddressCallback", "GetEventNameCallback", "GetEventInformationCallback", "IsEventEmptyCallback", "GetEventBooleanCallback", "GetEventIntegerCallback"];
const g_vecDirectEventCallbacks = [
	{ Name: "GetEventUInt64Callback", Operation: "GetUInt64", Template: true },
	{ Name: "GetEventFloatCallback", Operation: "GetFloat" },
	{ Name: "GetEventStringCallback", Operation: "GetString" },
	{ Name: "SetEventBooleanCallback", Operation: "SetBool" },
	{ Name: "SetEventIntegerCallback", Operation: "SetInt" },
	{ Name: "SetEventUInt64Callback", Operation: "SetUInt64", Template: true },
	{ Name: "SetEventFloatCallback", Operation: "SetFloat" },
	{ Name: "SetEventStringCallback", Operation: "SetString" },
	{ Name: "FreeGameEventCallback", Operation: "FreeEvent" },
];
const g_vecResourceEventCallbackNames = [
	"FireGameEventCallback",
	"CreateEventVariableCallback",
	"InferEventVariableCallback",
	"CoerceEventVariableCallback",
	"GetEventVariableTypesCallback",
	"CreateEventResourceTextCallback",
	"BuildEventResourceLineCallback",
	"DescribeEventResourceCallback",
	"LoadEventsFromFileCallback",
	"CustomEventFireMethodCallback",
	"CreateEventPayloadCallback",
	"CreateCustomEventCallback",
];
const g_strGameEventPayloadHelpers = [
	GetDefinition("GetUInt64ValueFromValue"),
	GetDefinition("RequireUInt64FromValue"),
	"\t\ttemplate <typename TEvent>\n" + GetDefinition("SetGameEventValueFromV8"),
	"\t\ttemplate <typename TEvent>\n" + GetDefinition("SetGameEventPayloadFromObject"),
	ReplaceOnce(GetDefinition("RequireGameEventManager"), "g_Application.GetEngineInterfaces().GetGameEventManager()", "GetFixtureGameEventManager()"),
	GetDefinition("FireGameEvent"),
	"\t\ttemplate <typename TEventManager>\n" + GetDefinition("GetGameEventManagerFireEventVTableIndex"),
	GetDefinition("GetGameEventFromValue"),
	GetDefinition("RequireGameEventAddress"),
	GetDefinition("GetEventHookKeyArgument"),
	...g_vecPayloadCallbackNames.map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n")),
	...g_vecDirectEventCallbacks.map(Probe => (Probe.Template ? "\t\ttemplate <typename TEvent>\n" : "") + ReplaceOnce(GetDefinition(Probe.Name), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n")),
	"\t\ttemplate <typename TEvent>\n" + GetDefinition("InstallEventHookUInt64Functions"),
	GetDefinition("CopyEventObjectProperties"),
	GetDefinition("AddEventPayloadDefaults"),
	GetDefinition("MakeCustomEventPayload"),
	GetDefinition("MakeEventVariableObject"),
	GetDefinition("MakeEventVariableArray"),
	...g_vecResourceEventCallbackNames.map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n")),
].join("\n\n");
const g_vecPlayerCollectionCallbacks = ["GetPlayerCallback", "GetAllPlayersCallback", "GetHumanPlayersCallback", "GetBotPlayersCallback", "GetPlayersByTeamCallback", "GetTeamNumberCallback", "GetTeamNameCallback"];
const g_vecPlayerTeamCallbacks = [
	"GetTeamDataCallback",
	"GetTeamClassesByNameCallback",
	"GetTeamClassesByNumberCallback",
	"GetTeamNamesCallback",
	"GetTeamNumbersCallback",
	"GetTeamManagersCallback",
	"GetTeamProfileCallback",
	"GetTeamSupportedBranchesCallback",
	"ChangePlayerTeamCallback",
];
const g_vecPlayerTeamDataRecords = [...g_strSource.matchAll(/^\t\tstruct PlayerTeamData \{[\s\S]*?\n\t\t};/gm)];
g_Assert.equal(g_vecPlayerTeamDataRecords.length, 1, "Extract the actual team-data record.");
const g_strPlayerTeamDataRecord = g_vecPlayerTeamDataRecords[0][0];
const g_strPlayerCollectionHelpers = [
	GetDefinition("RequirePlayerInformationManager"),
	GetDefinition("RequirePlayersGlobals"),
	ReplaceOnce(GetDefinition("GetTeamAliasFromNumber"), "LoadPlayerTeamDataFromRuntime(pRuntime, TeamData, strErrorOut)", "LoadFixturePlayerTeamData(pRuntime, TeamData, strErrorOut)"),
	GetEnumerationDefinition("PlayerFakeClientFilter"),
	ReplaceOnce(GetDefinition("GetPlayerCallback"), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n"),
	GetDefinition("MakePlayersArray"),
	...g_vecPlayerCollectionCallbacks.slice(1).map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n")),
	GetDefinition("MakePlayerTeamNumbersByName"),
	GetDefinition("MakePlayerTeamNamesByNumber"),
	GetDefinition("MakePlayerTeamManagerArray"),
	ReplaceOnce(GetDefinition("RequirePlayerTeamDataFromArguments"), "LoadPlayerTeamDataFromRuntime(", "LoadFixturePlayerTeamData("),
	ReplaceOnce(GetDefinition("GetEntityIndexFromValue"), "GetValueIndex(pIsolate, LocalContext, LocalValue)", "GetFixtureEntityIndexValue(pIsolate, LocalContext, LocalValue)"),
	GetDefinition("RemoveEntityCallback"),
	...g_vecPlayerTeamCallbacks.map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n")),
	GetEnumerationDefinition("PlayerAliveFilter"),
	GetDefinition("DoesPlayerMatchFilters"),
	GetDefinition("ContainsEntityIndex"),
	GetDefinition("RequireConnectedHumanPlayerInformation"),
	GetDefinition("CollectPlayerEntityIndices"),
	GetDefinition("AddUniqueRecipientEntityIndex"),
	GetDefinition("MakeEntityIndexArray"),
	GetDefinition("MakePlayerArrayFromEntityIndices"),
].join("\n\n");
const g_vecRecipientDictionaryVoiceCallbacks = [
	"GetAllPlayerDictionaryEntriesCallback",
	"GetPlayerDictionaryValueCallback",
	"DoesPlayerDictionaryContainKeyCallback",
	"GetPlayerDictionaryKeysCallback",
	"GetPlayerDictionaryValuesCallback",
	"GetPlayerDictionaryEntriesCallback",
	"GetMaximumClientsCallback",
	"GetClientCountCallback",
	"GetVoiceClientListeningCallback",
	"SetVoiceClientListeningCallback",
	"SetVoiceClientProximityCallback",
	"GetHumanRecipientsCallback",
	"GetAllRecipientsCallback",
	"GetBotRecipientsCallback",
	"GetAliveRecipientsCallback",
	"GetDeadRecipientsCallback",
	"GetRecipientsByTeamCallback",
	"CreateRecipientFilterFromPlayerCallback",
	"CreateRecipientFilterFromValuesCallback",
	"DoesRecipientFilterContainRecipientCallback",
	"ResolveRecipientPlayersCallback",
];
const g_strPlayerButtonHelpers = [
	"\t\t// Controlled button macros, not selected-SDK constant values.",
	"\t\tconstexpr int kFixtureAttackButton = 0x1;",
	"\t\tconstexpr int kFixtureJumpButton = 0x2;",
	"\t\tconstexpr int kFixtureUseButton = 0x20;",
	"",
	"#define IN_ATTACK kFixtureAttackButton",
	"#define IN_JUMP kFixtureJumpButton",
	"#define IN_USE kFixtureUseButton",
	GetDefinition("InstallPlayerButtonConstants"),
	"#undef IN_USE",
	"#undef IN_JUMP",
	"#undef IN_ATTACK",
].join("\n");
const g_strEntityCollectionAndLifeStateHelpers = [
	"\t\t// Controlled life-state macros, not selected-SDK constant values.",
	"\t\tconstexpr int kFixtureAliveLifeState = 0;",
	"\t\tconstexpr int kFixtureDyingLifeState = 1;",
	"\t\tconstexpr int kFixtureDeadLifeState = 2;",
	"\t\tconstexpr int kFixtureRespawnableLifeState = 3;",
	"\t\tconstexpr int kFixtureDiscardBodyLifeState = 4;",
	"",
	"#define LIFE_ALIVE kFixtureAliveLifeState",
	"#define LIFE_DYING kFixtureDyingLifeState",
	"#define LIFE_DEAD kFixtureDeadLifeState",
	"#define LIFE_RESPAWNABLE kFixtureRespawnableLifeState",
	"#define LIFE_DISCARDBODY kFixtureDiscardBodyLifeState",
	GetDefinition("InstallPlayerLifeStateConstants"),
	"#undef LIFE_DISCARDBODY",
	"#undef LIFE_RESPAWNABLE",
	"#undef LIFE_DEAD",
	"#undef LIFE_DYING",
	"#undef LIFE_ALIVE",
	"",
	GetDefinition("RequireEntityGlobals"),
	"",
	GetDefinition("MakeEntityArray"),
	"",
	ReplaceOnce(GetDefinition("GetAllEntitiesCallback"), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n"),
].join("\n");
const g_vecEntityClassDictionaryCallbacks = [
	"GetEntitiesByClassNameCallback",
	"FindEntityByClassNameCallback",
	"GetEntityClassNamesCallback",
	"GetEntityClassInstancesByNameCallback",
	"GetEntityClassNameCallback",
	"GetAllDictionaryEntitiesCallback",
	"GetEntityFromDictionaryCallback",
	"HasEntityInDictionaryCallback",
	"GetEntityDictionaryKeysCallback",
	"GetEntityDictionaryValuesCallback",
	"GetEntityDictionaryEntriesCallback",
	"GetEntityIndexCallback",
	"IsEntityValidCallback",
	"ConvertEntityHelperValueCallback",
	"GetPlayerIndexCallback",
];

function GetEntityClassDictionaryCallbackDefinition(strName) {
	return ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n");
}

const g_strEntityClassDictionaryHelpers = [
	GetDefinition("CollectEntityIndices"),
	GetDefinition("MakeEntityArrayFromIndices"),
	GetDefinition("ContainsString"),
	GetDefinition("MakeEntityClassNameArray"),
	GetEnumerationDefinition("EntityHelperValue"),
	GetDefinition("GetEntityHelperConversionCode"),
	GetDefinition("GetEntityHelperValueName"),
	GetDefinition("GetEntityHelperUnsignedHandleFromValue"),
	GetDefinition("GetEntityHelperRecordUnsignedValue"),
	GetDefinition("GetEntityIndexFromHelperConversionValue"),
	...g_vecEntityClassDictionaryCallbacks.map(GetEntityClassDictionaryCallbackDefinition),
].join("\n\n");
const g_strRecipientDictionaryVoiceHelpers = [
	GetDefinition("CollectRecipientEntityIndicesFromArray"),
	GetDefinition("CollectRecipientEntityIndicesFromValue"),
	GetDefinition("MakeRecipientFilterObject"),
	GetDefinition("GetVoiceServerInterface"),
	GetDefinition("RequireVoiceServer"),
	GetDefinition("ValidateVoicePlayerIndices"),
	GetDefinition("GetVoiceEntityIndexArgument"),
	GetDefinition("GetVoiceClientListeningVTableIndex"),
	GetDefinition("GetVoiceSetClientListeningVTableIndex"),
	GetDefinition("GetVoiceSetClientProximityVTableIndex"),
	"\t\ttemplate <typename TVoiceServer>\n" + GetDefinition("HasVoiceClientProximity"),
	GetDefinition("GetVoiceVTableFunctionAddress"),
	"\t\ttemplate <typename TVoiceServer>\n" + GetDefinition("SetVoiceClientProximity"),
	g_strPlayerButtonHelpers,
	g_strEntityCollectionAndLifeStateHelpers,
	g_strEntityClassDictionaryHelpers,
	...g_vecRecipientDictionaryVoiceCallbacks.map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n")),
	GetDefinition("InstallVoiceFunctions"),
	GetDefinition("InstallVoiceMetadata"),
	GetDefinition("MakeVoiceServerObject"),
	ReplaceOnce(GetDefinition("GetVoiceServerPropertyCallback"), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(PropertyCallbackInformation.GetIsolate());\n"),
].join("\n\n");

const g_vecPlayerIdentityCallbacks = [
	"GetPlayerIndexFromUserIDCallback",
	"GetPlayerFromUserIDCallback",
	"ConvertPlayerHelperValueCallback",
	"SpawnPlayerCallback",
	"GetPlayerIndexFromNameCallback",
	"GetPlayerIndexFromNetworkIDCallback",
	"GetPlayerUserIDFromIndexCallback",
	"GetPlayerNameFromIndexCallback",
	"GetPlayerNetworkAddressFromIndexCallback",
	"GetPlayerNetworkIDFromIndexCallback",
	"IsPlayerConnectedByIndexCallback",
	"GetPlayerClientCVarValueCallback",
	"GetPlayerClientLanguageCallback",
	"GetEntityCallback",
	"GetEntityCountCallback",
	"GetMaximumEntityCountCallback",
];
const g_vecPlayerMatchesAliases = g_strSource.match(/^\t\tusing fnPlayerMatches = [^\n]+;/gm);
g_Assert.equal(g_vecPlayerMatchesAliases?.length, 1, "Preserve the current player matcher type alias.");
const g_vecEntityConstantGroupRecords = g_strSource.match(/^\tstruct EntityConstantGroupEntry \{\n(?:\t\t[^\n]*\n)*\t\};/gm);
g_Assert.equal(g_vecEntityConstantGroupRecords?.length, 1, "Preserve the current constant-group record.");
const g_nFactoryRecordStart = g_strSource.indexOf("\n\tenum class EntityFactoryKeyValueType :");
const g_nFactoryRecordEnd = g_strSource.indexOf("\n\tconstexpr char kEntityFactoryDispatchSpawnOptionName[]", g_nFactoryRecordStart);
g_Assert.ok((g_nFactoryRecordStart >= 0) && (g_nFactoryRecordEnd > g_nFactoryRecordStart), "Locate the actual factory record and constructor definitions.");
const g_strFactoryRecords = g_strSource.slice(g_nFactoryRecordStart, g_nFactoryRecordEnd).split("\n").map(strLine => strLine.startsWith("\t") ? ("\t" + strLine) : strLine).join("\n");
const g_vecTransmitCallbacks = ["GetEntityTransmitStateFlagsCallback", "SetEntityTransmitStateFlagsCallback", "SetEntityTransmitStateCallback", "ClearEntityTransmitStateCallback"];
const g_strTransmitEdictAdapter = `		edict_t* GetFixtureTransmitEdictValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			auto* const pEntityEdict = GetEntityEdictFromValue(pIsolate, LocalContext, LocalValue);
			EnterFixtureEventCallback(pIsolate);

			return pEntityEdict;
		}`;
const g_strFixtureServerToolsInterfaceVersion = "FixtureServerTools";
const g_strPlayerIdentityHelpers = [
	"// Controlled SDK version string, not a live player/factory ABI.",
	"#define VSERVERTOOLS_INTERFACE_VERSION " + JSON.stringify(g_strFixtureServerToolsInterfaceVersion),
	GetDefinition("ToLowerASCII"),
	g_vecPlayerMatchesAliases[0],
	GetDefinition("FindPlayerEntityIndex"),
	GetDefinition("DoesPlayerNameMatch"),
	GetDefinition("AddPlayerNetworkIDCandidate"),
	"// Controlled no-Steam SDK profile; Steam-enabled production SDK builds are separate.",
	"#define SOURCEJS_HAS_STEAMCLIENTPUBLIC 0",
	GetDefinition("AddPlayerSteamIDCandidates"),
	"#undef SOURCEJS_HAS_STEAMCLIENTPUBLIC",
	GetDefinition("DoesPlayerNetworkIDMatch"),
	GetDefinition("GetPlayerEntityIndexFromUserIDValue"),
	GetDefinition("GetObjectInteger"),
	"\t\ttemplate <typename THandle>\n" + GetDefinition("CreateEntityBaseHandleFromRawValue"),
	GetDefinition("GetEntityBaseHandleFromValue"),
	GetDefinition("GetEntityEdictFromValue"),
	g_strTransmitEdictAdapter,
	GetDefinition("MarkEntityTransmitStateChanged"),
	ReplaceOnce(GetDefinition("ResolveEntityTransmitEdictFromValue"), "GetEntityEdictFromValue(pIsolate, LocalContext, LocalEntityValue)", "GetFixtureTransmitEdictValue(pIsolate, LocalContext, LocalEntityValue)"),
	GetDefinition("GetEntityTransmitStateFromValue"),
	...g_vecTransmitCallbacks.map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n")),
	g_strFactoryRecords,
	GetDefinition("GetEntityFactoryVectorFromValue"),
	GetDefinition("GetEntityFactoryKeyValueFromValue"),
	GetDefinition("ReadEntityFactoryKeyValues"),
	GetDefinition("GetEntityBaseEntityFromAddressValue"),
	GetDefinition("RequireEngineServer"),
	GetDefinition("GetClientConVarValue", "IVEngineServer\\* const pEngineServer, [^\\n]*"),
	ReplaceOnce(GetDefinition("RequirePlayerInformationFromIndex"), "RequirePlayerInformationFromIndex(", "RequireFixturePlayerInformationFromIndex("),
	GetEnumerationDefinition("PlayerHelperValue"),
	GetDefinition("GetPlayerHelperConversionCode"),
	GetDefinition("GetPlayerEntityIndexFromHelperConversionValue"),
	g_vecEntityConstantGroupRecords[0].split("\n").map(strLine => "\t" + strLine).join("\n"),
	"\t\ttemplate <std::size_t unEntryCount>\n" + GetDefinition("MakeEntityConstantGroup"),
	"\t\ttemplate <std::size_t unEntryCount>\n" + GetDefinition("InstallEntityConstantGroup"),
	...g_vecPlayerIdentityCallbacks.map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n").replaceAll("RequirePlayerInformationFromIndex(", "RequireFixturePlayerInformationFromIndex(")),
	"#undef VSERVERTOOLS_INTERFACE_VERSION",
].join("\n\n");

function IndentFixtureNamespace(strSource) {
	// Keep extracted directives at column zero and blank lines empty.
	return strSource.split("\n").map(strLine => (!strLine || strLine.startsWith("#")) ? strLine : "\t" + strLine).join("\n");
}

const g_strClientCVarCallbacks = IndentFixtureNamespace([
	ReplaceOnce(GetDefinition("GetClientConVarValue", "IVEngineServer\\* const pEngineServer, [^\\n]*"), "IVEngineServer* const pEngineServer", "Engine* const pEngineServer"),
	GetDefinition("GetEngineServerClientCVarValueCallback"),
].join("\n\n"));

const g_strEngineVisibilityCallbacks = IndentFixtureNamespace([
	"\t\ttemplate <typename TEngineServer>\n" + GetDefinition("GetEngineServerClusterCount"),
	ReplaceOnce(GetDefinition("GetEngineServerPVSByteCount"), "IVEngineServer* const pEngineServer", "Engine* const pEngineServer"),
	GetDefinition("MakeEngineByteArrayValue"),
	GetDefinition("RequireEngineBytesFromValue"),
	GetDefinition("GetEngineServerPVSForClusterCallback"),
	"#define SOURCEJS_HAS_VPLANE 1",
	GetDefinition("GetEngineServerAreaPortalPlaneCallback"),
	"#undef SOURCEJS_HAS_VPLANE",
].join("\n\n"));

const g_vecFactoryCallbacks = ["CreateEntityByClassNameCallback", "CreateAndSpawnEntityByClassNameCallback", "DispatchEntitySpawnCallback", "SetEntityKeyValueCallback", "GetEntityKeyValueCallback", "FindEntityByHammerIDCallback"];
const g_vecFactoryOptionConstants = g_strSource.match(/^\tconstexpr char kEntityFactory(?:DispatchSpawn|KeyValues)OptionName\[\] = [^\n]+;/gm);
g_Assert.equal(g_vecFactoryOptionConstants?.length, 2, "Preserve actual option key constants.");
const g_strFactoryBaseAdapter = `		CBaseEntity* GetFixtureFactoryBaseEntityValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			auto* const pBaseEntity = GetEntityFactoryBaseEntityFromValue(pIsolate, LocalContext, LocalValue);
			EnterFixtureEventCallback(pIsolate);

			return pBaseEntity;
		}`;
const g_strFactoryCallbacks = [
	"#if !defined(SOURCEJS_FIXTURE_OLD_CONSOLE_API)",
	"// Controlled SDK version string and operations, not a live factory ABI.",
	"#define VSERVERTOOLS_INTERFACE_VERSION " + JSON.stringify(g_strFixtureServerToolsInterfaceVersion),
	...g_vecFactoryOptionConstants,
	GetDefinition("GetBaseEntityFromValue"),
	GetDefinition("GetEntityFactoryBaseEntityFromValue"),
	g_strFactoryBaseAdapter,
	GetDefinition("GetEntityFactoriesServerTools"),
	GetDefinition("RequireEntityFactoriesServerTools"),
	GetDefinition("SetEntityFactoryKeyValue"),
	GetDefinition("ApplyEntityFactoryKeyValues"),
	ReplaceOnce(GetDefinition("ResolveEntityFactoryBaseEntityFromValue"), "GetEntityFactoryBaseEntityFromValue(pIsolate, LocalContext, LocalEntityValue)", "GetFixtureFactoryBaseEntityValue(pIsolate, LocalContext, LocalEntityValue)"),
	GetDefinition("ReadEntityFactoryOptions"),
	GetDefinition("MakeEntityValueFromBaseEntity"),
	...g_vecFactoryCallbacks.map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n")),
	"\t\ttemplate <typename TServerTools>\n" + ReplaceOnce(GetDefinition("DestroyEntityByHammerIDCallback"), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n"),
	"#undef VSERVERTOOLS_INTERFACE_VERSION\n#endif // !SOURCEJS_FIXTURE_OLD_CONSOLE_API",
].join("\n\n");

const g_strFactorySetter = ReplaceOnce(GetDefinition("SetEntityKeyValueCallback"), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n");
const g_strFactoryValueRead = g_strFactorySetter.match(/\t\t\tEntityFactoryKeyValue FactoryKeyValue \{\};\n\t\t\tif \(!GetEntityFactoryKeyValueFromValue\([^\n]+\)\) \{\n\t\t\t\treturn;\n\t\t\t\}\n\n/)?.[0];
g_Assert.equal(typeof g_strFactoryValueRead, "string");

const g_strFactoryDeferredValueReadSetter = ReplaceOnce(ReplaceOnce(g_strFactorySetter, g_strFactoryValueRead, ""), "\t\t\tauto* const pServerTools = RequireEntityFactoriesServerTools(pIsolate, kOperationName);", g_strFactoryValueRead + "\t\t\tauto* const pServerTools = RequireEntityFactoriesServerTools(pIsolate, kOperationName);");

const g_nDatamapRecordBegin = g_strSource.indexOf("\t\tstruct EntityDatamapsFieldInformation {");
const g_nDatamapRecordEnd = g_strSource.indexOf("\n\t\t};", g_nDatamapRecordBegin);
g_Assert((g_nDatamapRecordBegin >= 0) && (g_nDatamapRecordEnd > g_nDatamapRecordBegin), "Locate the current datamap metadata record.");

const g_nDatamapColorBindingsBegin = g_strSource.indexOf("\t\tstruct EntityDatamapsColorComponentPropertyBinding {");
const g_nDatamapColorBindingsEnd = g_strSource.indexOf("\t\tbool EntityDatamapsInstallColorComponentProperty(", g_nDatamapColorBindingsBegin);
g_Assert((g_nDatamapColorBindingsBegin >= 0) && (g_nDatamapColorBindingsEnd > g_nDatamapColorBindingsBegin), "Locate the actual color-binding record and argument constructor.");

const g_strDatamapColorBindings = g_strSource.slice(g_nDatamapColorBindingsBegin, g_nDatamapColorBindingsEnd).trimEnd();

const g_strDatamapBaseAdapter = `		CBaseEntity* GetFixtureDatamapBaseEntityValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			auto* const pBaseEntity = GetBaseEntityFromValue(pIsolate, LocalContext, LocalValue);
			EnterFixtureEventCallback(pIsolate);

			return pBaseEntity;
		}

		std::string GetFixtureDatamapPropertyName(v8::Isolate* const pIsolate, v8::Local<v8::Value> const LocalValue) {
			std::string const strValue = ValueToString(pIsolate, LocalValue);

			if (g_bDatamapPropertyNameCppFault) {
				pIsolate->ThrowException(v8::True(pIsolate));
				throw std::runtime_error("Controlled property-name conversion failure");
			}

			return strValue;
		}

		edict_t* GetFixtureDatamapTargetEdict(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			auto* const pEdict = GetEntityEdictFromValue(pIsolate, LocalContext, LocalValue);
			EnterFixtureEventCallback(pIsolate);

			return pEdict;
		}

		bool GetFixtureDatamapTargetHandle(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, CBaseHandle& HandleOut) {
			const bool bHasHandle = GetEntityBaseHandleFromValue(pIsolate, LocalContext, LocalValue, HandleOut);
			EnterFixtureEventCallback(pIsolate);

			return bHasHandle;
		}

		int GetFixtureDatamapTargetIndex(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			const int nIndex = GetValueIndex(pIsolate, LocalContext, LocalValue);
			EnterFixtureEventCallback(pIsolate);

			return nIndex;
		}

		typedescription_t* GetFixtureDatamapInputDescription(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			auto* const pDescription = EntityDatamapsGetTypeDescriptionFromValue(pIsolate, LocalContext, LocalValue);
			EnterFixtureEventCallback(pIsolate);

			return pDescription;
		}`;
const g_vecDatamapOuterOwners = [
	["GetEntityDataMapCallback", "DatamapResolutionFailure"],
	["GetEntityDataMapFieldCallback", "DatamapResolutionFailure"],
	["FindEntityDataMapFieldCallback", "DatamapResolutionFailure"],
	["FindEntityDataMapFieldOffsetCallback", "DatamapResolutionFailure"],
	["GetEntityDataMapFieldsCallback", "DatamapResolutionFailure"],
	["CallEntityInputFunctionCallback", "FieldResolutionFailure"],
	["CallEntityInputFunctionCallback", "ValueConversionFailure"],
	["GetEntityInputFunctionCallback", "FieldResolutionFailure"],
];
const g_strDatamapOuterCallbacks = [...new Set(g_vecDatamapOuterOwners.map(vecOwner => vecOwner[0]))].map(strName => GetDefinition(strName).replaceAll("EntityDatamapsMakeDatamapObject(", "MakeFixtureDatamapRecord(").replaceAll("EntityDatamapsMakeTypeDescriptionObject(", "MakeFixtureTypeDescriptionRecord(").replaceAll("EntityDatamapsCollectFields(", "CollectFixtureDatamapFields(").replaceAll("EntityDatamapsGetTypeDescriptionFromValue(", "GetFixtureDatamapInputDescription(")).join("\n\n");
const g_strDatamapReceiverCallback = GetDefinition("EntityDatamapsGetEntityDatamapMethodCallback").replaceAll("EntityDatamapsMakeDatamapObject(", "MakeFixtureDatamapRecord(");
const g_strDatamapReceiverGuard = "\t\t\t\tCBaseEntity* pTargetBaseEntity = nullptr;\n\t\t\t\tif (!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalEntityReceiver, pTargetBaseEntity)) {\n\t\t\t\t\treturn;\n\t\t\t\t}";
// Restore the old inline owner only in a compiled negative control; its destructor loses a pending JS error during C++ unwinding.
const g_strDatamapReceiverUnsafeOwner = "\t\t\t\tCBaseEntity* pTargetBaseEntity = nullptr;\n\t\t\t\t{\n\t\t\t\t\tv8::TryCatch EntityResolutionFailure(pIsolate);\n\t\t\t\t\tpTargetBaseEntity = GetFixtureDatamapBaseEntityValue(pIsolate, LocalContext, LocalEntityReceiver);\n\t\t\t\t\tif (EntityResolutionFailure.HasCaught()) {\n\t\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t\t\treturn;\n\t\t\t\t\t}\n\t\t\t\t}";
const g_strDatamapEntitySetter = ReplaceOnce(ReplaceOnce(ReplaceOnce(GetDefinition("EntityDatamapsSetEntityProperty"), "GetEntityEdictFromValue(pIsolate, LocalContext, LocalSetValue)", "GetFixtureDatamapTargetEdict(pIsolate, LocalContext, LocalSetValue)"), "GetEntityBaseHandleFromValue(pIsolate, LocalContext, LocalSetValue, EntityHandle)", "GetFixtureDatamapTargetHandle(pIsolate, LocalContext, LocalSetValue, EntityHandle)"), "GetValueIndex(pIsolate, LocalContext, LocalSetValue)", "GetFixtureDatamapTargetIndex(pIsolate, LocalContext, LocalSetValue)");
const g_strDatamapTargetUnwindGuard = "if (TargetTryCatch.HasCaught()) {\n\t\t\t\t\t\t\t\tTargetTryCatch.ReThrow();\n\t\t\t\t\t\t\t}\n\n\t\t\t\t\t\t\tthrow;";
g_Assert.equal(g_strDatamapEntitySetter.split(g_strDatamapTargetUnwindGuard).length, 3, "Expect matching edict and handle guards; mutate only the first edict owner.");

// Current property selectors run with explicit SDK lookup/storage and post-read C++ fault adapters.
const g_strEntityPropertiesAdapters = `		void CompleteFixturePropertySelectorRead() {
			if (!g_bPropertySelectorCppFault) {
				return;
			}

			g_bPropertySelectorCppFault = false;
			throw std::runtime_error("Controlled property-selector C++ failure");
		}

		IServerGameDLL* GetEntityPropertiesServerGameDLL() noexcept {
			return &g_PropertyGameDLL;
		}

		ServerClass* FindEntityPropertiesServerClassByName(std::string const& strName) {
			++g_unPropertyClassLookups;

			return (strName == "FixtureServerClass") ? &g_PropertyServerClass : nullptr;
		}

		ServerClass* FindEntityPropertiesServerClassByAddress(IServerGameDLL* const pServerGameDLL, const std::uintptr_t unAddress) {
			++g_unPropertyClassLookups;

			return ((pServerGameDLL == &g_PropertyGameDLL) && (unAddress == reinterpret_cast<std::uintptr_t>(&g_PropertyServerClass))) ? &g_PropertyServerClass : nullptr;
		}

		SendTable* FindEntityPropertiesSendTableByName(std::string const& strName) {
			++g_unPropertyClassLookups;

			return (strName == "FixtureSendTable") ? &g_PropertySendTable : nullptr;
		}

		v8::MaybeLocal<v8::Value> ReadFixturePropertiesValue(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, v8::Local<v8::String> const LocalName) {
			v8::MaybeLocal<v8::Value> const PropertyReadResult = LocalObject->Get(LocalContext, LocalName);
			CompleteFixturePropertySelectorRead();

			return PropertyReadResult;
		}

		bool GetFixturePropertiesObjectString(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszName, std::string& strValueOut) {
			const bool bRead = GetObjectString(pIsolate, LocalContext, LocalObject, pszName, strValueOut);
			CompleteFixturePropertySelectorRead();

			return bRead;
		}

		edict_t* GetFixturePropertiesEntityEdict(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			auto* const pEdict = GetEntityEdictFromValue(pIsolate, LocalContext, LocalValue);
			CompleteFixturePropertySelectorRead();

			return pEdict;
		}`;
const g_strEntityPropertiesRecordSelector = GetDefinition("GetEntityPropertiesServerClassFromValue").replaceAll("GetObjectString(", "GetFixturePropertiesObjectString(").replace("LocalServerClassObject->Get(LocalContext, LocalAddressPropertyName)", "ReadFixturePropertiesValue(LocalContext, LocalServerClassObject, LocalAddressPropertyName)");
const g_strEntityPropertiesTableSelector = GetDefinition("GetEntityPropertiesSendTableFromValue").replaceAll("GetObjectString(", "GetFixturePropertiesObjectString(").replace("LocalSendTableObject->Get(LocalContext, LocalAddressPropertyName)", "ReadFixturePropertiesValue(LocalContext, LocalSendTableObject, LocalAddressPropertyName)");
const g_strEntityPropertiesEntitySelector = ReplaceOnce(GetDefinition("GetEntityPropertiesServerClassFromEntity"), "GetEntityEdictFromValue(", "GetFixturePropertiesEntityEdict(");
const g_strEntityPropertiesSelectors = [
	GetDefinition("GetObjectString"),
	GetDefinition("EntityPropertiesIsRecordStorageRangeValid"),
	GetDefinition("EntityPropertiesIsSendTableStorageValid"),
	g_strEntityPropertiesAdapters,
	g_strEntityPropertiesRecordSelector,
	g_strEntityPropertiesTableSelector,
	g_strEntityPropertiesEntitySelector,
].join("\n\n");

const g_nEntityPropertiesInformationBegin = g_strSource.indexOf("\t\tstruct EntityPropertiesPropertyInformation {");
const g_nEntityPropertiesInformationEnd = g_strSource.indexOf("\n\t\t};", g_nEntityPropertiesInformationBegin);
g_Assert((g_nEntityPropertiesInformationBegin >= 0) && (g_nEntityPropertiesInformationEnd > g_nEntityPropertiesInformationBegin), "Locate the actual property-information record.");
const g_strEntityPropertiesInformation = g_strSource.slice(g_nEntityPropertiesInformationBegin, g_nEntityPropertiesInformationEnd + "\n\t\t};".length);
const g_strEntityPropertiesFieldAdapters = `		bool GetFixturePropertiesObjectInteger(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszName, int& nValueOut) {
			const bool bRead = GetObjectInteger(pIsolate, LocalContext, LocalObject, pszName, nValueOut);
			CompleteFixturePropertySelectorRead();

			return bRead;
		}

		bool GetFixturePropertiesTargetHandle(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, CBaseHandle& HandleOut) {
			const bool bHasHandle = GetEntityBaseHandleFromValue(pIsolate, LocalContext, LocalValue, HandleOut);
			CompleteFixturePropertySelectorRead();

			return bHasHandle;
		}

		bool FindEntityPropertiesPropertyInformation(ServerClass* const pServerClass, SendTable* const pSendTable, std::string const& strName, EntityPropertiesPropertyInformation& InformationOut) {
			constexpr int kPropertyOffset = 0x40;
			constexpr int kStringArrayOffset = 0x80;
			constexpr int kStringArrayCapacity = 8;
			constexpr int kSolidTypeOffset = 0x44;
			constexpr int kSolidFlagsOffset = 0x48;
			constexpr int kVectorOffset = 0xD0;
			constexpr int kGenericIntegerOffset = 0x90;

			++g_unPropertyClassLookups;

			if ((pServerClass != &g_PropertyServerClass) || (pSendTable != &g_PropertySendTable) || (pSendTable->GetNumProps() != 1)) {
				return false;
			}

			int nPropertyOffset = kPropertyOffset;
			SendVarProxyFn ProxyFunction = nullptr;
			if (strName == "m_nSolidType") {
				nPropertyOffset = kSolidTypeOffset;

			} else if (strName == "m_usSolidFlags") {
				nPropertyOffset = kSolidFlagsOffset;

			} else if (strName == "FixtureStringArray") {
				nPropertyOffset = kStringArrayOffset;

			} else if (strName == "FixtureVectorXY") {
				nPropertyOffset = kVectorOffset;

			} else if (strName == "FixtureGenericSigned8") {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxySigned8;

			} else if (strName == "FixtureGenericUnsigned8") {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxyUnsigned8;

			} else if (strName == "FixtureGenericSigned16") {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxySigned16;

			} else if ((strName == "FixtureGenericUnsigned16") || (strName == "m_AttributeManager.m_Item.m_iItemDefinitionIndex")) {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxyUnsigned16;

			} else if ((strName == "FixtureGenericSigned32") || (strName == "m_iPrimaryReserveAmmoCount")) {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxySigned32;

			} else if (strName == "FixtureGenericUnsigned32") {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxyUnsigned32;

			} else if (strName == "FixtureGenericSigned64") {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxySigned64;

			} else if (strName == "FixtureGenericUnsigned64") {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxyUnsigned64;

			} else if (strName == "FixtureGenericUnknown") {
				nPropertyOffset = kGenericIntegerOffset;
				ProxyFunction = FixtureProxyUnknown;

			} else if (strName == "FixtureGenericFloat") {
				nPropertyOffset = kGenericIntegerOffset;

			} else if ((strName != "FixtureValue") && (strName != "m_CollisionGroup")) {
				return false;
			}

			EntityPropertiesPropertyInformation Information {};
			Information.m_pServerClass = pServerClass;
			Information.m_pSendTable = pSendTable;
			Information.m_pProperty = &g_PropertySendProperty;
			g_PropertySendProperty.m_ProxyFunction = ProxyFunction;
			Information.m_nPropertyOffset = nPropertyOffset;
			Information.m_nElementCount = (strName == "FixtureStringArray") ? kStringArrayCapacity : 0;
			// Deliberately misleading network width: only the actual native proxy determines integer storage.
			Information.m_nBitCount = 1;
			Information.m_SendPropertyType = (strName == "FixtureVectorXY") ? DPT_VectorXY : (strName == "FixtureGenericFloat") ? DPT_Float : DPT_Int;
			Information.m_strPropertyName = strName;
			Information.m_strPropertyPath = strName;
			InformationOut = std::move(Information);

			return true;
		}`;
const g_strEntityPropertiesResolution = GetDefinition("ResolveEntityPropertiesServerClassAndTable");
const g_strEntityPropertiesFieldResolution = GetDefinition("GetEntityPropertiesPropertyAddressFromValues").replaceAll("GetObjectInteger(", "GetFixturePropertiesObjectInteger(").replaceAll("GetObjectString(", "GetFixturePropertiesObjectString(");
const g_strEntityPropertiesFieldHelpers = [
	g_strEntityPropertiesInformation,
	GetDefinition("RequireEntityPropertiesString"),
	GetDefinition("ComputeEntityPropertiesFieldAddress"),
	g_strEntityPropertiesFieldAdapters,
	g_strEntityPropertiesResolution,
	GetDefinition("EntityPropertiesIsEntityCurrent"),
	g_strEntityPropertiesFieldResolution,
	...["ReadEntityPropertiesScalarValue", "WriteEntityPropertiesScalarValue", "EntityPropertiesGetNumberFromValue", "EntityPropertiesGetUnsignedNumberFromValue", "EntityPropertiesGetSignedProperty", "EntityPropertiesGetUnsignedProperty", "EntityPropertiesSetSignedProperty", "EntityPropertiesSetUnsignedProperty"].map(strName => "\t\ttemplate <typename T>\n" + GetDefinition(strName)),
	GetDefinition("ReadEntityPropertiesBooleanValue"),
].join("\n\n");
const g_strEntityPropertiesValueCallbacks = ["RetainEntityPropertiesStringValue", "EntityPropertiesRequireVectorFromValue", "EntityPropertiesGetBooleanProperty", "EntityPropertiesSetBooleanProperty", "EntityPropertiesGetCharacterProperty", "EntityPropertiesSetCharacterProperty", "EntityPropertiesGetFloatProperty", "EntityPropertiesSetFloatProperty", "EntityPropertiesGetDoubleProperty", "EntityPropertiesSetDoubleProperty", "EntityPropertiesGetStringArrayProperty", "EntityPropertiesSetStringArrayProperty", "EntityPropertiesGetStringAddressProperty", "EntityPropertiesSetStringAddressProperty", "EntityPropertiesGetAddressProperty", "EntityPropertiesSetAddressProperty", "EntityPropertiesGetVectorComponentAddress", "EntityPropertiesGetVectorComponentProperty", "EntityPropertiesSetVectorComponentProperty", "EntityPropertiesInstallVectorComponentProperty"].map(strName => GetDefinition(strName)).join("\n\n");
const g_vecCollisionScalarArrays = ["kEntityCollisionGroupProperties", "kEntitySolidTypeProperties", "kEntitySolidFlagsProperties"];
const g_vecCollisionScalarDeclarations = g_strSource.split("\n").filter(strLine => g_vecCollisionScalarArrays.some(strName => strLine.startsWith("\t\tconstexpr char const* " + strName + "[]")));
g_Assert.equal(g_vecCollisionScalarDeclarations.length, g_vecCollisionScalarArrays.length, "Extract actual collision SDK-property inventories.");

const g_strEntityCollisionSelector = "\t\ttemplate <std::size_t unNameCount>\n" + GetDefinition("FindEntityCollisionPropertyNameValue");
const g_strEntityCollisionScalarCallbacks = [
	...g_vecCollisionScalarDeclarations,
	g_strEntityCollisionSelector,
	...["GetEntityCollisionIntegerProperty", "SetEntityCollisionIntegerProperty"].map(strName => "\t\ttemplate <typename TField, std::size_t unNameCount>\n" + GetDefinition(strName)),
	...["GetEntityCollisionGroupCallback", "SetEntityCollisionGroupCallback", "GetEntitySolidTypeCallback", "SetEntitySolidTypeCallback", "GetEntitySolidFlagsCallback", "SetEntitySolidFlagsCallback"].map(strName => GetDefinition(strName)),
].join("\n\n");
const g_strEntityPropertiesHandleSetter = ReplaceOnce(GetDefinition("EntityPropertiesSetEntityHandleProperty"), "GetEntityBaseHandleFromValue(pIsolate, LocalContext, LocalSetValue, EntityHandle)", "GetFixturePropertiesTargetHandle(pIsolate, LocalContext, LocalSetValue, EntityHandle)");
const g_nEntityHandleStorageBegin = g_strSource.indexOf("\t\tstruct EntityHandleStorageAccess : CBaseHandle {");
const g_nEntityHandleStorageEnd = g_strSource.indexOf("\t\tvoid EntityPropertiesGetEntityHandleProperty(", g_nEntityHandleStorageBegin);
g_Assert((g_nEntityHandleStorageBegin >= 0) && (g_nEntityHandleStorageEnd > g_nEntityHandleStorageBegin), "Extract the SDK handle field layout checks.");

const g_strEntityHandleStorage = g_strSource.slice(g_nEntityHandleStorageBegin, g_nEntityHandleStorageEnd);
const g_vecEntityPropertiesVectorTypeBlock = g_strSource.match(/#ifdef SOURCEJS_HAS_DPT_VECTORXY\n\t\tbool EntityPropertiesIsVectorXYPropertyType\([\s\S]*?#endif \/\/ SOURCEJS_HAS_DPT_VECTORXY/);
g_Assert(g_vecEntityPropertiesVectorTypeBlock, "Extract both actual vector-type capability branches.");

const g_strEntityPropertiesVectorCallbacks = [g_vecEntityPropertiesVectorTypeBlock[0], ...["EntityPropertiesMakeVectorPropertyObject", "EntityPropertiesGetVectorProperty", "EntityPropertiesSetVectorProperty"].map(strName => GetDefinition(strName))].join("\n\n");

const g_nIntegerStorageEnumBegin = g_strSource.indexOf("\t\tenum class EntityPropertiesIntegerStorageType {");
const g_nIntegerStorageEnumEnd = g_strSource.indexOf("\n\t\t};", g_nIntegerStorageEnumBegin);
g_Assert((g_nIntegerStorageEnumBegin >= 0) && (g_nIntegerStorageEnumEnd > g_nIntegerStorageEnumBegin), "Extract actual native integer-storage type enum.");

const g_strEntityPropertiesIntegerStorageEnum = g_strSource.slice(g_nIntegerStorageEnumBegin, g_nIntegerStorageEnumEnd + "\n\t\t};".length);
const g_strIntegerProxyTypeResolver = GetDefinition("GetEntityPropertiesIntegerStorageTypeFromProxies");
const g_strGenericPropertyGetter = GetDefinition("EntityPropertiesGetGenericProperty");
const g_strEntityPropertiesGenericCallbacks = [
	g_strEntityPropertiesIntegerStorageEnum,
	"\t\ttemplate <typename TProxies>\n" + GetDefinition("GetEntityPropertiesIntegerStorageTypeFromProxies"),
	"\t\ttemplate <typename TEngine>\n" + GetDefinition("GetEntityPropertiesIntegerStorageTypeFromEngine"),
	...["EntityPropertiesGetInferredIntegerProperty", "EntityPropertiesSetInferredIntegerProperty"].map(strName => "\t\ttemplate <typename TField>\n" + GetDefinition(strName)),
	GetDefinition("EntityPropertiesIsVectorPropertyType"),
	GetDefinition("EntityPropertiesGetEntityHandleProperty"),
	GetDefinition("EntityPropertiesGetGenericProperty"),
	GetDefinition("EntityPropertiesSetGenericProperty"),
].join("\n\n");
const g_vecIntegerPropertyStorageConstant = g_strSource.match(/^\t\tconstexpr char kIntegerPropertyStorageErrorMessage\[\] = .+;$/m);
g_Assert(g_vecIntegerPropertyStorageConstant, "Extract actual integer-property storage diagnostic.");

const g_strIntegerPropertyAddressResolver = GetDefinition("EntityPropertiesTryGetIntegerPropertyAddress");
const g_strEntityPropertiesNamedIntegerCallbacks = [
	g_vecIntegerPropertyStorageConstant[0],
	g_strIntegerPropertyAddressResolver,
	...["EntityPropertiesGetNamedIntegerProperty", "EntityPropertiesSetNamedIntegerProperty", "GetCSGOEntityItemDefinitionIndexCallback", "SetCSGOEntityItemDefinitionIndexCallback", "GetCSGOItemDefinitionIndexCallback", "SetCSGOItemDefinitionIndexCallback", "GetCSGOWeaponAmmoCountCallback", "SetCSGOWeaponAmmoCountCallback"].map(strName => GetDefinition(strName)),
].join("\n\n");
const g_strPlayerPropertyNameAdapters = `		v8::MaybeLocal<v8::Value> ReadFixturePlayerPropertyName(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Array> const LocalNames, const std::uint32_t unIndex) {
			v8::MaybeLocal<v8::Value> const ReadResult = LocalNames->Get(LocalContext, unIndex);
			CompleteFixturePropertySelectorRead();

			return ReadResult;
		}

		v8::MaybeLocal<v8::String> ConvertFixturePlayerPropertyName(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			v8::MaybeLocal<v8::String> const ConversionResult = LocalValue->ToString(LocalContext);
			CompleteFixturePropertySelectorRead();

			return ConversionResult;
		}`;
const g_strPlayerPropertyNamesParser = GetDefinition("PlayersGetPropertyNamesFromValue");
const g_strFixturePlayerPropertyNamesParser = ReplaceOnce(ReplaceOnce(ReplaceOnce(g_strPlayerPropertyNamesParser, "LocalPropertyNamesArray->Get(LocalContext, unPropertyNameIndex)", "ReadFixturePlayerPropertyName(LocalContext, LocalPropertyNamesArray, unPropertyNameIndex)"), "LocalPropertyNameValue->ToString(LocalContext)", "ConvertFixturePlayerPropertyName(LocalContext, LocalPropertyNameValue)"), "LocalPropertyNamesValue->ToString(LocalContext)", "ConvertFixturePlayerPropertyName(LocalContext, LocalPropertyNamesValue)");
const g_strPlayerPropertyCallerAdapters = `		constexpr int kFixturePropertyPlayerIndex = 4;

		constinit bool g_bFixturePropertyPlayerAvailable = true;
		constinit std::size_t g_unFixturePlayerPropertyLookups = 0;

		CBaseEntity* GetFixturePropertyPlayerFromIndex(const int nIndex) {
			return ((nIndex == kFixturePropertyPlayerIndex) && g_bFixturePropertyPlayerAvailable) ? &g_Entity : nullptr;
		}

		CBaseEntity* GetFixturePropertyPlayerFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			const int nIndex = GetValueIndex(pIsolate, LocalContext, LocalValue);
			CompleteFixturePropertySelectorRead();

			return GetFixturePropertyPlayerFromIndex(nIndex);
		}

		bool ResolveFixturePropertyPlayerHandle(CBaseHandle const& Handle, int& nIndexOut) {
			if (!g_bFixturePropertyPlayerAvailable || (Handle.ToInt() != g_Entity.GetRefEHandle().ToInt())) {
				return false;
			}

			nIndexOut = kFixturePropertyPlayerIndex;

			return true;
		}

		bool ResolveFixturePlayerPropertyAddress(CBaseEntity* const pPlayer, std::vector<std::string> const& vecNames, char*& pchAddressOut, std::string& strNameOut) {
			constexpr std::size_t kFieldOffset = 0x40;
			constexpr std::size_t kObserverModeOffset = 0x48;
			constexpr std::size_t kObserverTargetOffset = 0x4C;
			constexpr std::size_t kVehicleOffset = 0x50;

			// These offsets address the controlled leading byte buffer, not an SDK layout.
			static_assert(std::is_standard_layout_v<CBaseEntity>);
			static_assert(offsetof(CBaseEntity, m_arrPropertyStorage) == 0);
			static_assert(kFieldOffset < sizeof(g_Entity.m_arrPropertyStorage));
			static_assert(kObserverModeOffset < sizeof(g_Entity.m_arrPropertyStorage));
			static_assert(kObserverTargetOffset < sizeof(g_Entity.m_arrPropertyStorage));
			static_assert(kVehicleOffset < sizeof(g_Entity.m_arrPropertyStorage));

			++g_unFixturePlayerPropertyLookups;

			if ((pPlayer != &g_Entity) || !g_bFixturePropertyPlayerAvailable) {
				return false;
			}

			for (auto const& strName : vecNames) {
				if (strName == "FixtureValue") {
					strNameOut = strName;
					pchAddressOut = reinterpret_cast<char*>(pPlayer) + kFieldOffset;
					return true;
				}

				std::size_t unOffset = 0;
				if ((strName == "m_iObserverMode") || (strName == "localdata.m_iObserverMode")) {
					unOffset = kObserverModeOffset;

				} else if (strName == "m_hObserverTarget") {
					unOffset = kObserverTargetOffset;

				} else if ((strName == "m_hVehicle") || (strName == "localdata.m_hVehicle")) {
					unOffset = kVehicleOffset;

				} else {
					continue;
				}

				strNameOut = strName;
				pchAddressOut = reinterpret_cast<char*>(pPlayer) + unOffset;
				return true;
			}

			return false;
		}`;
const g_strPlayerPropertyCaller = GetDefinition("PlayersRequirePropertyAddressFromArguments");
const g_strFixturePlayerPropertyCaller = ReplaceOnce(ReplaceOnce(ReplaceOnce(ReplaceOnce(g_strPlayerPropertyCaller, "GetBaseEntityFromValue(pIsolate, LocalContext, LocalPlayerValue)", "GetFixturePropertyPlayerFromValue(pIsolate, LocalContext, LocalPlayerValue)"), "GetEntityIndexFromBaseHandleValue(PlayerHandle, nResolvedPlayerIndex)", "ResolveFixturePropertyPlayerHandle(PlayerHandle, nResolvedPlayerIndex)"), "GetBaseEntityFromIndex(nResolvedPlayerIndex)", "GetFixturePropertyPlayerFromIndex(nResolvedPlayerIndex)"), "PlayersResolvePropertyAddress(pPlayerEntity, vecPropertyNames, pchPropertyAddressOut, strResolvedPropertyNameOut)", "ResolveFixturePlayerPropertyAddress(pPlayerEntity, vecPropertyNames, pchPropertyAddressOut, strResolvedPropertyNameOut)");
const g_strDropWeaponAdapters = `		// Exact SDK spellings with controlled storage/identity/action, not an SDK layout or vtable model.
		struct CBaseCombatWeapon : CBaseEntity {
		};

		struct CBasePlayer : CBaseEntity {
			void Weapon_Drop(CBaseCombatWeapon* const pWeapon, Vector const* const pTarget, Vector const* const pVelocity);
		};

		constexpr int kFixtureDropPlayerIndex = 4;
		constexpr int kFixtureDropWeaponIndex = 7;

		constinit CBasePlayer g_FixtureDropPlayer {};
		constinit CBaseCombatWeapon g_FixtureDropWeapon {};
		constinit datamap_t g_FixtureDropWeaponDatamap {};
		constinit bool g_bFixtureDropPlayerAvailable = true;
		constinit bool g_bFixtureDropWeaponAvailable = true;
		constinit std::size_t g_unFixtureDropCalls = 0;

		void CBasePlayer::Weapon_Drop(CBaseCombatWeapon* const pWeapon, Vector const* const pTarget, Vector const* const pVelocity) {
			Require(g_bFixtureDropPlayerAvailable && g_bFixtureDropWeaponAvailable && (this == &g_FixtureDropPlayer) && (pWeapon == &g_FixtureDropWeapon), "Drop only the still-live original controlled SDK objects");

			if (pTarget) {
				Require(std::isfinite(pTarget->x) && std::isfinite(pTarget->y) && std::isfinite(pTarget->z), "Initialized optional drop target");
			}

			if (pVelocity) {
				Require(std::isfinite(pVelocity->x) && std::isfinite(pVelocity->y) && std::isfinite(pVelocity->z), "Initialized optional drop velocity");
			}

			++g_unFixtureDropCalls;
		}

		CBaseEntity* GetFixtureDropEntityFromIndex(const int nIndex) {
			if ((nIndex == kFixtureDropPlayerIndex) && g_bFixtureDropPlayerAvailable) {
				return &g_FixtureDropPlayer;
			}

			if ((nIndex == kFixtureDropWeaponIndex) && g_bFixtureDropWeaponAvailable) {
				return &g_FixtureDropWeapon;
			}

			return nullptr;
		}

		int GetFixtureDropEntityIndex(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			const int nIndex = GetValueIndex(pIsolate, LocalContext, LocalValue);
			CompleteFixturePropertySelectorRead();

			return nIndex;
		}

		CBaseEntity* GetFixtureDropEntityFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			return GetFixtureDropEntityFromIndex(GetFixtureDropEntityIndex(pIsolate, LocalContext, LocalValue));
		}

		IPlayerInfo* RequireFixtureDropPlayer(v8::Isolate* const pIsolate, const int nIndex, edict_t**, char const*) {
			if ((nIndex != kFixtureDropPlayerIndex) || !g_bFixtureDropPlayerAvailable) {
				ThrowError(pIsolate, "Controlled drop player is unavailable.");
				return nullptr;
			}

			return &g_PlayerInformation;
		}

		bool ResolveFixtureDropHandle(CBaseHandle const& Handle, int& nIndexOut) {
			const int nIndex = Handle.GetEntryIndex();
			auto* const pEntity = GetFixtureDropEntityFromIndex(nIndex);
			if (!pEntity || (Handle.ToInt() != pEntity->GetRefEHandle().ToInt())) {
				return false;
			}

			nIndexOut = nIndex;

			return true;
		}

		datamap_t* GetFixtureDropDatamap(CBaseEntity* const pEntity) {
			return (pEntity == &g_FixtureDropWeapon) ? &g_FixtureDropWeaponDatamap : nullptr;
		}`;
const g_strDropCombatWeaponValidator = ReplaceOnce(GetDefinition("PlayersIsCombatWeapon"), "EntityDatamapsGetDatamapFromBaseEntity(pBaseEntity)", "GetFixtureDropDatamap(pBaseEntity)");
const g_strDropWeaponCallback = GetDefinition("DropPlayerWeaponCallback");
const g_strFixtureDropWeaponCallback = g_strDropWeaponCallback.replaceAll("GetValueIndex(pIsolate, LocalContext, LocalPlayerValue)", "GetFixtureDropEntityIndex(pIsolate, LocalContext, LocalPlayerValue)").replaceAll("GetBaseEntityFromIndex(", "GetFixtureDropEntityFromIndex(").replaceAll("GetBaseEntityFromValue(pIsolate, LocalContext, LocalWeaponValue)", "GetFixtureDropEntityFromValue(pIsolate, LocalContext, LocalWeaponValue)").replaceAll("RequirePlayerInformationFromIndex(", "RequireFixtureDropPlayer(").replaceAll("GetEntityIndexFromBaseHandleValue(", "ResolveFixtureDropHandle(");

const g_strPlayerStorageAdapters = `		// Controlled SDK lookup/storage and post-read faults, not SDK offsets or an ABI model.
		struct FixtureProjectileGlobals {
			int maxEntities;
		};

		constexpr int kFixtureProjectileIndex = 8;
		constexpr FixtureProjectileGlobals kFixtureProjectileGlobals { kFixtureProjectileIndex + 1 };
		constinit std::size_t g_unFixturePlayerStorageLookups = 0;

		bool ResolveFixturePlayerSendStorage(CBaseEntity* const pPlayer, char const* const pszName, char*& pchAddressOut) {
			constexpr std::size_t kStorageOffset = 0x40;

			// pPlayer denotes the base subobject whose leading byte buffer owns this address.
			static_assert(std::is_standard_layout_v<CBaseEntity>);
			static_assert(offsetof(CBaseEntity, m_arrPropertyStorage) == 0);
			static_assert(kStorageOffset < sizeof(g_Entity.m_arrPropertyStorage));

			++g_unFixturePlayerStorageLookups;

			if (!pPlayer || !pszName) {
				return false;
			}

			if ((pPlayer == &g_Entity) && g_bFixturePropertyPlayerAvailable && (std::strcmp(pszName, "FixtureValue") == 0)) {
				pchAddressOut = reinterpret_cast<char*>(pPlayer) + kStorageOffset;
				return true;
			}

			if ((pPlayer == &g_FixtureDropPlayer) && g_bFixtureDropPlayerAvailable && ((std::strcmp(pszName, "m_hActiveWeapon") == 0) || (std::strcmp(pszName, "FixtureSlots.000") == 0))) {
				pchAddressOut = reinterpret_cast<char*>(pPlayer) + kStorageOffset;
				return true;
			}

			return false;
		}

		CBaseHandle CreateFixturePlayerRawHandle(const unsigned int unValue) {
			return { unValue };
		}

		bool ResolveFixtureRawDropHandle(const unsigned int unValue, int& nIndexOut) {
			CBaseHandle const Handle = CreateFixturePlayerRawHandle(unValue);

			return ResolveFixtureDropHandle(Handle, nIndexOut);
		}

		edict_t* GetFixtureActiveWeaponEdict(const int nIndex) {
			return ((nIndex == kFixtureDropWeaponIndex) && g_bFixtureDropWeaponAvailable) ? &g_PlayerEdict : nullptr;
		}

		bool ReadFixtureActiveWeaponEdictHandle(edict_t* const pEdict, CBaseHandle& HandleOut) {
			if ((pEdict != &g_PlayerEdict) || !g_bFixtureDropWeaponAvailable) {
				return false;
			}

			HandleOut = g_FixtureDropWeapon.GetRefEHandle();

			return true;
		}

		bool RequireFixturePlayerPropertyVector(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, char const* const pszError, Vector& VectorOut) {
			const bool bConverted = RequireVectorFromValue(pIsolate, LocalContext, LocalValue, pszError, VectorOut);
			CompleteFixturePropertySelectorRead();

			return bConverted;
		}

		FixtureProjectileGlobals const* GetFixtureProjectileGlobals() {
			return &kFixtureProjectileGlobals;
		}

		bool IsFixtureProjectileEngineAvailable() {
			return true;
		}

		edict_t* GetFixtureProjectileEdict(const int nIndex) {
			return (nIndex == kFixtureProjectileIndex) ? &g_PlayerEdict : nullptr;
		}

		char const* GetFixtureProjectileClassName(edict_t*) {
			return "weapon_fixture";
		}

		CBaseEntity* GetFixtureProjectileEntity(edict_t*) {
			return &g_Entity;
		}

		bool ReadFixtureProjectileOwner(CBaseEntity*, bool& bHasPropertyOut, int& nOwnerIndexOut) {
			bHasPropertyOut = true;
			nOwnerIndexOut = kFixtureDropPlayerIndex;

			return true;
		}`;
const g_strPlayerHandleReadAdapter = `		bool ReadFixturePlayerHandle(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, CBaseHandle& HandleOut) {
			const bool bRead = GetEntityBaseHandleFromValue(pIsolate, LocalContext, LocalValue, HandleOut);
			CompleteFixturePropertySelectorRead();

			return bRead;
		}`;
const g_strPlayerIntegerStorage = GetDefinition("PlayersGetIntegerSendPropertyAddress").replaceAll("GetBaseEntityFromValue(", "GetFixturePropertyPlayerFromValue(").replaceAll("GetEntityIndexFromBaseHandleValue(", "ResolveFixturePropertyPlayerHandle(").replaceAll("GetBaseEntityFromIndex(", "GetFixturePropertyPlayerFromIndex(").replaceAll("LocalPropertyValue->ToString(LocalContext)", "ConvertFixturePlayerPropertyName(LocalContext, LocalPropertyValue)").replaceAll("PlayersGetSendPropertyAddress(", "ResolveFixturePlayerSendStorage(");
const g_strPlayerActiveWeaponSetter = GetDefinition("SetPlayerActiveWeaponCallback").replaceAll("GetBaseEntityFromValue(", "GetFixtureDropEntityFromValue(").replaceAll("GetEntityBaseHandleFromValue(", "ReadFixturePlayerHandle(").replaceAll("GetValueIndex(", "GetFixtureDropEntityIndex(").replaceAll("GetValidEntityEdictFromIndex(", "GetFixtureActiveWeaponEdict(").replaceAll("GetEntityBaseHandleFromEdictAddress(", "ReadFixtureActiveWeaponEdictHandle(").replaceAll("GetEntityIndexFromBaseHandleValue(", "ResolveFixtureDropHandle(").replaceAll("GetBaseEntityFromIndex(", "GetFixtureDropEntityFromIndex(").replaceAll("PlayersGetSendPropertyAddress(", "ResolveFixturePlayerSendStorage(");
const g_strPlayerWeaponIndices = GetDefinition("GetPlayerWeaponIndicesCallback").replaceAll("GetBaseEntityFromValue(", "GetFixtureDropEntityFromValue(").replaceAll("GetEntityIndexFromBaseHandleValue(", "ResolveFixtureDropHandle(").replaceAll("GetBaseEntityFromIndex(", "GetFixtureDropEntityFromIndex(").replaceAll("LocalPropertyPrefixValue->ToString(LocalContext)", "ConvertFixturePlayerPropertyName(LocalContext, LocalPropertyPrefixValue)").replaceAll("PlayersGetSendPropertyAddress(", "ResolveFixturePlayerSendStorage(").replaceAll("GetEntityIndexFromIntegerHandleValue(", "ResolveFixtureRawDropHandle(");
const g_strPlayerProjectileIndices = GetDefinition("GetPlayerProjectileIndicesCallback").replaceAll("GetValueIndex(", "GetFixtureDropEntityIndex(").replaceAll("g_Application.GetEngineInterfaces().GetGlobalVariables()", "GetFixtureProjectileGlobals()").replaceAll("g_Application.GetEngineInterfaces().GetEngine()", "IsFixtureProjectileEngineAvailable()").replaceAll("GetValidEntityEdictFromIndex(", "GetFixtureProjectileEdict(").replaceAll("pProjectileEdict->GetClassName()", "GetFixtureProjectileClassName(pProjectileEdict)").replaceAll("GetEntityBaseEntityFromEdictAddress(", "GetFixtureProjectileEntity(").replaceAll("PlayersGetOwnerEntityIndexFromEntity(", "ReadFixtureProjectileOwner(");
const g_strPlayerVectorSetter = GetDefinition("SetPlayerVectorPropertyCallback").replaceAll("RequireVectorFromValue(", "RequireFixturePlayerPropertyVector(");
const g_strPlayerHLTV = GetDefinition("IsPlayerHLTVCallback").replaceAll("GetValueIndex(", "GetFixtureDropEntityIndex(").replaceAll("RequirePlayerInformationFromIndex(", "RequireFixtureDropPlayer(");
const g_strPlayerObserver = GetDefinition("IsPlayerObserverCallback").replaceAll("GetValueIndex(", "GetFixtureDropEntityIndex(");
const g_vecPlayerPresenceReaders = ["PlayersReadNativeIntegerProperty", "PlayersReadNativeHandlePresence"].map(strName => GetDefinition(strName).replaceAll("GetBaseEntityFromValue(", "GetFixturePropertyPlayerFromValue(").replaceAll("PlayersResolvePropertyAddress(", "ResolveFixturePlayerPropertyAddress(").replaceAll("GetEntityIndexFromIntegerHandleValue(", "ResolveFixtureRawDropHandle("));
const g_strPlayerPresenceReaders = g_vecPlayerPresenceReaders.join("\n\n");

const g_strEffectsOwnershipAdapters = `		// Controlled SDK/project metadata and integer marshalling seams for callback ownership tests.
		// Their schemas, SDK ABI and engine playback are not exercised by these adapters.
		constinit std::size_t g_unFixtureEffectsLookups = 0;
		constinit std::size_t g_unFixtureEffectsWrites = 0;

		bool ReadFixtureEffectsSignal(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, char const* const pszName, v8::Local<v8::Value>& LocalValueOut) {
			const bool bRead = LocalContext->Global()->Get(LocalContext, MakeString(pIsolate, pszName)).ToLocal(&LocalValueOut);
			CompleteFixturePropertySelectorRead();

			return bRead;
		}

		IServerGameDLL* RequireFixtureEffectsGameDLL(v8::Isolate*, char const*) {
			return &g_PropertyGameDLL;
		}

		ServerClass* FindFixtureEffectsClass(std::string const& strName) {
			return (strName == "FixtureEffect") ? &g_PropertyServerClass : nullptr;
		}

		bool IsFixtureEffectsClassValid(ServerClass const* const pClass) {
			return pClass == &g_PropertyServerClass;
		}

		bool FindFixtureEffectsInformation(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, ServerClass*, std::string const& strName, EntityPropertiesPropertyInformation& InformationOut) {
			++g_unFixtureEffectsLookups;

			v8::Local<v8::Value> LocalSignal {};
			if (!ReadFixtureEffectsSignal(pIsolate, LocalContext, "FixtureEffectsLookupSignal", LocalSignal) || (strName != "FixtureValue")) {
				return false;
			}

			// Allocate before committing any of the caller-owned metadata fields.
			std::string strPropertyPath = strName;
			InformationOut.m_pSendTable = &g_PropertySendTable;
			InformationOut.m_pProperty = &g_PropertySendProperty;
			InformationOut.m_nPropertyIndex = 0;
			InformationOut.m_nPropertyOffset = 0;
			InformationOut.m_strPropertyPath = std::move(strPropertyPath);

			return true;
		}

		v8::Local<v8::Object> ReadFixtureEffectsObject(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, char const* const pszName) {
			v8::Local<v8::Value> LocalValue {};
			if (!ReadFixtureEffectsSignal(pIsolate, LocalContext, pszName, LocalValue) || !LocalValue->IsObject()) {
				return {};
			}

			return LocalValue.As<v8::Object>();
		}

		v8::Local<v8::Object> MakeFixtureEffectsMetadata(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, ServerClass*) {
			return ReadFixtureEffectsObject(pIsolate, LocalContext, "FixtureEffectsTemplate");
		}

		v8::Local<v8::Object> MakeFixtureEffectsProperty(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, ServerClass*, SendTable*, SendProp*, int, int, std::string const&) {
			return ReadFixtureEffectsObject(pIsolate, LocalContext, "FixtureEffectsProperty");
		}

		bool WriteFixtureEffectsProperty(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, char* const pchMemory, const std::size_t unByteCount, ServerClass*, EntityPropertiesPropertyInformation const&, v8::Local<v8::Value> const LocalValue) {
			v8::Local<v8::Value> LocalSignal {};
			if (!ReadFixtureEffectsSignal(pIsolate, LocalContext, "FixtureEffectsWriteSignal", LocalSignal) || (unByteCount < sizeof(int))) {
				return false;
			}

			int nValue = 0;
			if (!GetInt32Argument(pIsolate, LocalContext, LocalValue, "Fixture effects integer expected.", nValue) || !WriteEntityPropertiesScalarValue(pchMemory, nValue)) {
				return false;
			}

			++g_unFixtureEffectsWrites;

			return true;
		}`;
const g_strEffectsApplyOwnership = GetDefinition("ApplyEffectsPropertyValues").replaceAll("AreEffectsServerClassStorageRangesValid(", "IsFixtureEffectsClassValid(").replaceAll("FindEffectsPropertyInformation(", "FindFixtureEffectsInformation(").replaceAll("EffectsSetPropertyValue(", "WriteFixtureEffectsProperty(");
const g_strEffectsMetadataOwnership = GetDefinition("GetEffectsTemporaryEntityCallback").replaceAll("RequireServerGameDLL(", "RequireFixtureEffectsGameDLL(").replaceAll("FindEffectsServerClass(", "FindFixtureEffectsClass(").replaceAll("MakeEffectsTemporaryEntityObject(", "MakeFixtureEffectsMetadata(");
const g_strEffectsPropertyOwnership = GetDefinition("GetEffectsPropertyCallback").replaceAll("RequireServerGameDLL(", "RequireFixtureEffectsGameDLL(").replaceAll("FindEffectsServerClass(", "FindFixtureEffectsClass(").replaceAll("FindEffectsPropertyInformation(", "FindFixtureEffectsInformation(").replaceAll("MakeEntityPropertiesSendPropertyObject(", "MakeFixtureEffectsProperty(");

const g_strFilesystemAdapters = `		// Real V8 and standard filesystem/stream IO; only SDK existence lookup is controlled.
		constexpr char kFixtureFilesystemDirectory[] = @FIXTURE_FILESYSTEM_DIRECTORY@;
		constexpr char kFixtureFilesystemCaseName[] = @FIXTURE_FILESYSTEM_CASE@;
		constinit std::size_t g_unFixtureFilesystemLookups = 0;
		constinit bool g_bFixtureFilesystemFailure = false;
		constinit unsigned int g_unFilesystemTemporaryFilePathCounter = 0;

		struct FixtureFilesystem {
			bool FileExists(char const*) {
				++g_unFixtureFilesystemLookups;

				if (g_bFixtureFilesystemFailure) {
					throw std::runtime_error("Fixture SDK filesystem failure.");
				}

				return false;
			}
		};

		constinit FixtureFilesystem g_FixtureFilesystem {};

		FixtureFilesystem* GetFixtureFilesystem() {
			return &g_FixtureFilesystem;
		}`;
const g_vecFilesystemCallbacks = ["DoesFileExistCallback", "ReadTextFileCallback", "WriteTextFileCallback", "EnsureDirectoryExistsCallback", "RequireFilesystemStringArgument", "GetTemporaryFilePathCallback", "IsVPKFileCallback", "RemoveFileCallback"].map(strName => GetDefinition(strName).replaceAll("RequireFilesystemInterface(pIsolate)", "GetFixtureFilesystem()"));

// Opaque handles and IO fault stages are SDK seams, not a live filesystem ABI.
const g_strTruncationAdapters = `		using FileHandle_t = void*;
		constexpr FileHandle_t FILESYSTEM_INVALID_HANDLE = nullptr;
		constexpr int FILESYSTEM_SEEK_HEAD = 0;
		constexpr std::size_t kFixtureTruncationHandleCount = 4;
		constexpr std::size_t kFixtureTruncationOriginalHandleSlot = 0;
		constexpr std::size_t kFixtureTruncationReadHandleSlot = 1;
		constexpr std::size_t kFixtureTruncationWriteHandleSlot = 2;
		constexpr std::size_t kFixtureTruncationReplacementHandleSlot = 3;
		constexpr int kFixtureTruncationNoFailureStage = 0;
		constexpr int kFixtureTruncationFlushFailureStage = 1;
		constexpr int kFixtureTruncationReadFailureStage = 2;
		constexpr int kFixtureTruncationOriginalCloseFailureStage = 3;
		constexpr int kFixtureTruncationWriteOpenFailureStage = 4;
		constexpr int kFixtureTruncationWriteFailureStage = 5;
		constexpr int kFixtureTruncationReplacementOpenFailureStage = 6;
		constexpr int kFixtureTruncationReplacementSeekFailureStage = 7;
		constexpr unsigned int kFixtureTruncationSavedPosition = 2;
		constexpr unsigned int kFixtureTruncationOriginalByteCount = 4;

		static_assert(kFixtureTruncationOriginalHandleSlot < kFixtureTruncationHandleCount);
		static_assert(kFixtureTruncationReadHandleSlot < kFixtureTruncationHandleCount);
		static_assert(kFixtureTruncationWriteHandleSlot < kFixtureTruncationHandleCount);
		static_assert(kFixtureTruncationReplacementHandleSlot < kFixtureTruncationHandleCount);

		constinit char g_arrTruncationHandles[kFixtureTruncationHandleCount] {};
		constinit std::size_t g_arrTruncationCloses[kFixtureTruncationHandleCount] {};
		constinit int g_nTruncationFailureStage = kFixtureTruncationNoFailureStage;
		constinit std::size_t g_unTruncationCalls = 0;

		struct FixtureTruncationFilesystem {
			FileHandle_t Open(char const*, char const* const pszMode, char const*) {
				if (!pszMode) {
					throw std::runtime_error("Controlled truncation open requires a mode.");
				}

				++g_unTruncationCalls;
				const std::size_t unSlot = (std::strcmp(pszMode, "rb") == 0) ? kFixtureTruncationReadHandleSlot : ((std::strcmp(pszMode, "wb") == 0) ? kFixtureTruncationWriteHandleSlot : kFixtureTruncationReplacementHandleSlot);
				if (((unSlot == kFixtureTruncationWriteHandleSlot) && (g_nTruncationFailureStage == kFixtureTruncationWriteOpenFailureStage)) || ((unSlot == kFixtureTruncationReplacementHandleSlot) && (g_nTruncationFailureStage == kFixtureTruncationReplacementOpenFailureStage))) {
					return FILESYSTEM_INVALID_HANDLE;
				}

				return &g_arrTruncationHandles[unSlot];
			}

			void Close(FileHandle_t const hFile) {
				++g_unTruncationCalls;

				for (std::size_t unSlot = 0; unSlot < kFixtureTruncationHandleCount; ++unSlot) {
					if (hFile != &g_arrTruncationHandles[unSlot]) {
						continue;
					}

					++g_arrTruncationCloses[unSlot];

					if (unSlot == kFixtureTruncationOriginalHandleSlot) {
						auto* const pIsolate = v8::Isolate::GetCurrent();
						v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
						v8::Local<v8::Value> LocalState {};
						v8::Local<v8::Value> LocalConsumed {};
						Require(LocalContext->Global()->Get(LocalContext, MakeString(pIsolate, "FixtureOwnershipState")).ToLocal(&LocalState) && LocalState->IsObject() && LocalState.As<v8::Object>()->Get(LocalContext, MakeString(pIsolate, "OriginalHandleConsumed")).ToLocal(&LocalConsumed) && LocalConsumed->IsTrue(), "Commit handoff before the original close attempt");

						if (g_nTruncationFailureStage == kFixtureTruncationOriginalCloseFailureStage) {
							throw std::runtime_error("Controlled original close failure.");
						}
					}

					return;
				}

				throw std::runtime_error("Unexpected fixture truncation handle.");
			}

			unsigned int Tell(FileHandle_t) {
				++g_unTruncationCalls;

				return kFixtureTruncationSavedPosition;
			}

			unsigned int Size(FileHandle_t) {
				++g_unTruncationCalls;

				return kFixtureTruncationOriginalByteCount;
			}

			int Read(void* const pData, const int nSize, FileHandle_t) {
				if ((nSize < 0) || (static_cast<unsigned int>(nSize) > kFixtureTruncationOriginalByteCount) || ((nSize > 0) && !pData)) {
					throw std::runtime_error("Controlled truncation read exceeds its storage contract.");
				}

				++g_unTruncationCalls;

				if (nSize > 0) {
					std::memset(pData, 'A', static_cast<std::size_t>(nSize));
				}

				return (g_nTruncationFailureStage == kFixtureTruncationReadFailureStage) ? 0 : nSize;
			}

			int Write(void const*, const int nSize, FileHandle_t) {
				if (nSize < 0) {
					throw std::runtime_error("Controlled truncation write requires a nonnegative byte count.");
				}

				++g_unTruncationCalls;

				return (g_nTruncationFailureStage == kFixtureTruncationWriteFailureStage) ? 0 : nSize;
			}

			void Flush(FileHandle_t) {
				++g_unTruncationCalls;

				if (g_nTruncationFailureStage == kFixtureTruncationFlushFailureStage) {
					throw std::runtime_error("Controlled flush failure.");
				}
			}

			void Seek(FileHandle_t const hFile, int, int) {
				++g_unTruncationCalls;

				if ((hFile == &g_arrTruncationHandles[kFixtureTruncationReplacementHandleSlot]) && (g_nTruncationFailureStage == kFixtureTruncationReplacementSeekFailureStage)) {
					throw std::runtime_error("Controlled replacement seek failure.");
				}
			}
		};

		constinit FixtureTruncationFilesystem g_FixtureTruncationFilesystem {};

		FixtureTruncationFilesystem* GetFixtureTruncationFilesystem() {
			return &g_FixtureTruncationFilesystem;
		}`;
const g_nFilesystemCloserBegin = g_strSource.indexOf("\t\tstruct FilesystemFileCloser {");
const g_nFilesystemCloserEnd = g_strSource.indexOf("\t\tstatic_assert", g_nFilesystemCloserBegin);
g_Assert((g_nFilesystemCloserBegin >= 0) && (g_nFilesystemCloserEnd > g_nFilesystemCloserBegin), "Locate actual filesystem owner and constructor.");
const g_strFilesystemCloser = g_strSource.slice(g_nFilesystemCloserBegin, g_nFilesystemCloserEnd).replaceAll("IFileSystem", "FixtureTruncationFilesystem");
const g_strTruncationCallback = GetDefinition("TruncateSourceFileCallback").replaceAll("RequireFilesystemInterface(pIsolate)", "GetFixtureTruncationFilesystem()");
const g_strTruncationHelpers = [
	g_strTruncationAdapters,
	g_strFilesystemCloser,
	...["IsFilesystemModeWritable", "GetFilesystemTruncationOpenMode", "GetBoundedFilesystemReadSize", "GetFilesystemFileHandleFromValue", "RequireFilesystemFileHandleArgument", "ConvertFilesystemFileHandleToBigInt", "GetOptionalFilesystemIntegerArgument"].map(strName => GetDefinition(strName)),
	g_strTruncationCallback,
].join("\n\n");

const g_strKeyValuesNativeStrings = [GetDefinition("RequireKeyValuesStringFromValue"), GetDefinition("GetOptionalKeyNameFromValueForKeyValues")].join("\n\n");
const g_strKeyValuesNativeHierarchy = [GetDefinition("IsKeyValuesAddressCollected"), GetDefinition("CollectKeyValuesHierarchy")].join("\n\n").replace(/\bKeyValues\b/g, "FixtureKeyValuesHierarchyNode");
const g_strKeyValuesHierarchyAdapter = `		// Constructor-free controlled SDK links, not a live KeyValues ABI/layout.
		struct FixtureKeyValuesHierarchyNode {
			FixtureKeyValuesHierarchyNode* GetFirstSubKey() {
				return m_pFirstSubKey;
			}

			FixtureKeyValuesHierarchyNode* GetNextKey() {
				return m_pNextKey;
			}

			FixtureKeyValuesHierarchyNode* m_pFirstSubKey;
			FixtureKeyValuesHierarchyNode* m_pNextKey;
		};`;

const g_nBitBufferStateBegin = g_strSource.indexOf("\t\tstruct BitBuffersState {");
const g_nBitBufferStateEnd = g_strSource.indexOf("\t\tint CalculateByteCountForBitCount(", g_nBitBufferStateBegin);
g_Assert((g_nBitBufferStateBegin >= 0) && (g_nBitBufferStateEnd > g_nBitBufferStateBegin), "Locate actual owned BitBuffer state and constructor.");
const g_strBitBufferStateRecord = g_strSource.slice(g_nBitBufferStateBegin, g_nBitBufferStateEnd);
const g_strBitBufferByteConverter = GetDefinition("GetFilesystemBytesFromValue").replace(" {\n", ` {
			// Controlled entry faults, not allocator/OOM behavior or live SDK IO.
			constexpr int kFixtureBitBufferNoFailureMode = 0;
			constexpr int kFixtureBitBufferPendingFailureMode = 2;

			const int nFailureMode = g_nFixtureBitBufferFailureMode;
			g_nFixtureBitBufferFailureMode = kFixtureBitBufferNoFailureMode;

			if (nFailureMode == kFixtureBitBufferPendingFailureMode) {
				v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
				v8::Local<v8::Value> LocalOriginalError {};
				Require(LocalContext->Global()->Get(LocalContext, MakeString(pIsolate, "FixtureBitBufferOriginalError")).ToLocal(&LocalOriginalError), "Find controlled pending error");
				pIsolate->ThrowException(LocalOriginalError);
			}

			if (nFailureMode != kFixtureBitBufferNoFailureMode) {
				throw std::runtime_error("Controlled bitbuffer conversion failure.");
			}

`);
const g_strBitBufferStateParser = GetDefinition("GetBitBufferStateFromValue");
const g_strBitBufferCreateReader = GetDefinition("CreateBitBufferReaderCallback");
const g_strBitBufferPackUInt32 = GetDefinition("PackUInt32Callback");
const g_strSoundOrigins = GetDefinition("CollectSoundOrigins");
// Capture the current recipient parse/collect responsibility in dependency order.
const g_nSoundRecipientBegin = g_strSource.indexOf(g_strSoundOrigins) + g_strSoundOrigins.length;
const g_nSoundRecipientEnd = g_strSource.indexOf("\n\t\tIEngineSound* GetEngineSoundInterface()", g_nSoundRecipientBegin);
g_Assert((g_nSoundRecipientBegin > g_strSoundOrigins.length) && (g_nSoundRecipientEnd > g_nSoundRecipientBegin), "Locate actual sound recipient parsers and collector.");
const g_strSoundRecipientHelpers = g_strSource.slice(g_nSoundRecipientBegin, g_nSoundRecipientEnd).replace(/^\n+|\n+$/g, "");
const g_strTraceType = GetDefinition("GetTraceTypeFromObject");
const g_strTraceFunction = GetDefinition("GetTraceFunctionFromValue");
const g_strTraceRayParser = GetDefinition("RequireTraceRayFromValue");
const g_strTraceIgnoredIndex = GetDefinition("GetTraceIgnoredEntityIndexFromValue");
const g_strTraceResult = GetDefinition("MakeTraceResultObject");
const g_strTraceResultIndexDeclaration = "\t\t\tconst int nEntityIndex = GetTraceEntityIndexFromGameTrace(TraceInformation);\n";
const g_strTraceResultLateEntity = ReplaceOnce(ReplaceOnce(g_strTraceResult, g_strTraceResultIndexDeclaration, ""), "\t\t\tconst bool bDidHit = TraceInformation.DidHit();", g_strTraceResultIndexDeclaration + "\t\t\tconst bool bDidHit = TraceInformation.DidHit();");
const g_strTraceResultBorrowedSurface = ReplaceOnce(g_strTraceResult, "SurfaceInformation.name = strSurfaceName.c_str();", "SurfaceInformation.name = TraceInformation.surface.name;");
const g_nTraceFilterBegin = g_strSource.indexOf("\t\tclass TraceFilter : public ITraceFilter {");
const g_nTraceConstructorBegin = g_strSource.indexOf("\t\tTraceFilter::TraceFilter(", g_nTraceFilterBegin);
const g_nTraceFilterEnd = g_strSource.indexOf("\n\t\t}", g_nTraceConstructorBegin);
g_Assert((g_nTraceFilterBegin >= 0) && (g_nTraceConstructorBegin > g_nTraceFilterBegin) && (g_nTraceFilterEnd > g_nTraceConstructorBegin), "Locate actual trace filter class and constructor.");
const g_strTraceFilter = g_strSource.slice(g_nTraceFilterBegin, g_nTraceFilterEnd + "\n\t\t}".length);
const g_vecTraceOwnerUnwindMatches = [...g_strTraceFilter.matchAll(/if \((MethodLookupFailure|CallbackTryCatch)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+}\n\n\t+throw;/g)];
g_Assert.equal(g_vecTraceOwnerUnwindMatches.length, 3, "Retain all three trace filter native-unwind guards.");
const g_nTraceEnumeratorBegin = g_strSource.indexOf("\t\tclass EntityEnumerator : public IEntityEnumerator {");
const g_nTraceEnumeratorConstructorBegin = g_strSource.indexOf("\t\tEntityEnumerator::EntityEnumerator(", g_nTraceEnumeratorBegin);
const g_nTraceEnumeratorEnd = g_strSource.indexOf("\n\t\t}", g_nTraceEnumeratorConstructorBegin);
g_Assert((g_nTraceEnumeratorBegin >= 0) && (g_nTraceEnumeratorConstructorBegin > g_nTraceEnumeratorBegin) && (g_nTraceEnumeratorEnd > g_nTraceEnumeratorConstructorBegin), "Locate actual trace enumerator class and constructor.");
const g_strTraceEnumerator = g_strSource.slice(g_nTraceEnumeratorBegin, g_nTraceEnumeratorEnd + "\n\t\t}".length);
const g_vecTraceEnumeratorUnwindMatches = [...g_strTraceEnumerator.matchAll(/if \((MethodLookupFailure|CallbackTryCatch)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+}\n\n\t+throw;/g)];
g_Assert.equal(g_vecTraceEnumeratorUnwindMatches.length, 2, "Retain both trace enumerator native-unwind guards.");

// Exact SDK field spellings, synthetic storage/lifetime witness; no SDK ABI or live trace claim.
const g_strTraceResultHelpers = [
	String.raw`
		struct cplane_t {
			Vector normal;
			float dist;
			unsigned char type;
			unsigned char signbits;
		};

		struct csurface_t {
			char const* name;
			short surfaceProps;
			unsigned short flags;
		};

		struct trace_t {
			Vector startpos;
			Vector endpos;
			cplane_t plane;
			float fraction;
			int contents;
			unsigned short dispFlags;
			bool allsolid;
			bool startsolid;
			float fractionleftsolid;
			csurface_t surface;
			int hitgroup;
			short physicsbone;
			int hitbox;
			IHandleEntity* m_pEnt;

			bool DidHit() const {
				return (fraction < 1) || allsolid || startsolid;
			}
		};

		constexpr char kFixtureTraceOriginalSurfaceName[] = "original";
		constexpr char kFixtureTraceInvalidatedSurfaceName[] = "modified";

		constinit bool g_bFixtureTraceBorrowedDataValid = true;
		constinit char g_szFixtureTraceSurfaceName[] = "original";

		static_assert(sizeof(g_szFixtureTraceSurfaceName) == sizeof(kFixtureTraceOriginalSurfaceName));
		static_assert(sizeof(g_szFixtureTraceSurfaceName) == sizeof(kFixtureTraceInvalidatedSurfaceName));

		class FixtureTraceResultEntity final : public IHandleEntity {
		public:
			CBaseHandle const& GetRefEHandle() const override {
				constexpr unsigned int kEntityIndex = 7;
				constexpr unsigned int kEntitySerial = 1;

				static_assert(kHandleSerialShift < std::numeric_limits<unsigned int>::digits);
				static_assert((kEntityIndex & kHandleEntryMask) == kEntityIndex);
				static_assert(kEntitySerial <= (std::numeric_limits<unsigned int>::max() >> kHandleSerialShift));

				static constexpr CBaseHandle kHandle { (kEntitySerial << kHandleSerialShift) | kEntityIndex };

				Require(g_bFixtureTraceBorrowedDataValid, "Trace result native entity accessed after JavaScript reentry");

				return kHandle;
			}
		};
	`,
	...[
		"MakePlaneObject",
		"MakeSurfaceObject",
		"GetTraceEntityIndexFromGameTrace",
		"MakeTraceResultObject",
	].map(strName => GetDefinition(strName)),
	String.raw`
		void InvalidateTraceResultBorrowedDataForFixture(v8::FunctionCallbackInfo<v8::Value> const&) {
			g_bFixtureTraceBorrowedDataValid = false;
			std::memcpy(g_szFixtureTraceSurfaceName, kFixtureTraceInvalidatedSurfaceName, sizeof(g_szFixtureTraceSurfaceName));
		}

		void ReadTraceResultForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			auto* const pIsolate = CallbackInformation.GetIsolate();
			v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
			g_bFixtureTraceBorrowedDataValid = true;
			std::memcpy(g_szFixtureTraceSurfaceName, kFixtureTraceOriginalSurfaceName, sizeof(g_szFixtureTraceSurfaceName));

			FixtureTraceResultEntity Entity {};
			trace_t TraceInformation {};
			TraceInformation.startpos.Init(1, 2, 3);
			TraceInformation.endpos.Init(4, 5, 6);
			TraceInformation.plane.normal.Init(0, 0, 1);
			TraceInformation.fraction = 0.5F;
			TraceInformation.contents = 1;
			TraceInformation.surface.name = g_szFixtureTraceSurfaceName;
			TraceInformation.surface.surfaceProps = 17;
			TraceInformation.surface.flags = 0x20;
			TraceInformation.m_pEnt = &Entity;

			try {
				v8::Local<v8::Object> const LocalResult = MakeTraceResultObject(pIsolate, LocalContext, TraceInformation, CallbackInformation[0]);
				if (!LocalResult.IsEmpty()) {
					CallbackInformation.GetReturnValue().Set(LocalResult);
				}
			} catch (...) {
				ThrowError(pIsolate, "Fixture trace result native failure.");
			}
		}
	`,
].join("\n\n");
const g_strPointContents = GetDefinition("GetPointContentsCallback");
const g_strPointContentsAdapter = ReplaceOnce(g_strPointContents, "RequireEngineTraceInterface(pIsolate, kAPIName)", "RequireFixturePointContentsEngine(pIsolate, kAPIName)");
const g_strPointContentsTemplate = "\t\ttemplate <typename TEngineTrace>\n" + GetDefinition("TryGetEngineTracePointContents");
g_Assert(g_strSource.includes(g_strPointContentsTemplate), "Preserve actual point-contents template declaration.");
const g_strPointContentsHelpers = [
	String.raw`
		// Exact MASK_ALL spelling is an SDK facade; only 32-bit contents and handle lifetime are modeled.
		constexpr unsigned int MASK_ALL = std::numeric_limits<unsigned int>::max();
		constexpr int kFixturePointContents = 0x20;
		constinit IHandleEntity* g_pFixturePointContentsEntity = nullptr;

		class FixturePointContentsEngine {
		public:
			int GetPointContents(Vector const&, const unsigned int, IHandleEntity** const ppHandleEntityOut) {
				if (ppHandleEntityOut) {
					*ppHandleEntityOut = g_pFixturePointContentsEntity;
				}

				return kFixturePointContents;
			}
		};

		FixturePointContentsEngine* RequireFixturePointContentsEngine(v8::Isolate*, char const*) {
			static FixturePointContentsEngine s_Engine {};

			return &s_Engine;
		}
	`,
	GetDefinition("GetTraceMaskFromValue"),
	g_strPointContentsTemplate,
	GetDefinition("MakeTraceEntityIndexArray"),
	// Enable only the controlled native capability around the actual callback.
	"#define SOURCEJS_HAS_ENGINE_TRACE 1\n" + g_strPointContentsAdapter + "\n#undef SOURCEJS_HAS_ENGINE_TRACE",
	String.raw`
		void ReadPointContentsForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			constexpr int kNoEntityArgumentIndex = 2;

			FixtureTraceResultEntity Entity {};
			g_MessageFault = MessageFault::None;
			g_bFixtureTraceBorrowedDataValid = true;
			g_pFixturePointContentsEntity = CallbackInformation[kNoEntityArgumentIndex]->IsTrue() ? nullptr : &Entity;
			GetPointContentsCallback(CallbackInformation);
			g_pFixturePointContentsEntity = nullptr;
		}
	`,
].join("\n\n");

const g_strCollideableQuery = GetDefinition("GetPointContentsOfCollideableCallback");
const g_strCollideableQueryAdapter = ReplaceOnce(g_strCollideableQuery, "RequireEngineTraceInterface(pIsolate, kOperationName)", "RequireFixtureCollideableContentsEngine(pIsolate, kOperationName)");
const g_strCollideableResolver = ReplaceOnce(GetDefinition("GetTraceCollideableFromValue"), "GetEdictFromEntityIndex(nEntityIndex)", "GetFixtureTraceLifetimeEdict(nEntityIndex)");
const g_bHasCollideableHandleResolver = g_strSource.includes("\t\tICollideable* GetTraceCollideableFromEntityHandle(");
const g_strCollideableHandleResolver = g_bHasCollideableHandleResolver ? ReplaceOnce(GetDefinition("GetTraceCollideableFromEntityHandle"), "GetEdictFromEntityIndex(", "GetFixtureTraceLifetimeEdict(") : "";
const g_strCollideableAliasedHandle = ReplaceOnce(g_strCollideableQueryAdapter, "CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();", "CBaseHandle const& EntityHandle = pHandleEntity->GetRefEHandle();");
const g_strCollideableSerialUnchecked = ReplaceOnce(g_strCollideableHandleResolver, "(CurrentEntityHandle.GetSerialNumber() != EntityHandle.GetSerialNumber())", "false");
const g_strCollideableStaleAddress = ReplaceOnce(g_strCollideableQueryAdapter, "pCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);", "GetTraceCollideableFromEntityHandle(EntityHandle);");
const g_strCollideableContentsHelpers = [
	String.raw`
		// Synthetic edict/handle/collideable identity state; exact SDK method spellings, not its ABI.
		constexpr int kFixtureCollideableEntityIndex = 7;
		constexpr int kFixtureCollideableInitialSerial = 1;
		constexpr int kFixtureCollideableReplacementSerial = 2;
		constexpr int kFixtureCollideableContents = 0x40;
		constinit CBaseHandle g_FixtureCollideableHandle {};
		constinit bool g_bFixtureCollideableEntityPresent = true;
		constinit bool g_bFixtureCollideablePresent = true;
		constinit bool g_bFixtureCollideableReplaced = false;
		constinit unsigned int g_unFixtureCollideableDispatchCalls = 0;

		class FixtureCollideableHandleEntity final : public IHandleEntity {
		public:
			CBaseHandle const& GetRefEHandle() const override {
				Require(g_bFixtureCollideableEntityPresent, "Controlled collideable entity handle accessed after removal");

				return g_FixtureCollideableHandle;
			}
		};

		IHandleEntity* GetFixtureCollideableHandleEntity() {
			static FixtureCollideableHandleEntity s_Entity {};

			return &s_Entity;
		}

		class ICollideable {
		public:
			IHandleEntity* GetEntityHandle() {
				return GetFixtureCollideableHandleEntity();
			}
		};

		ICollideable* GetFixtureCurrentCollideable() {
			static ICollideable s_Initial {};
			static ICollideable s_Replacement {};

			if (!g_bFixtureCollideablePresent) {
				return nullptr;
			}

			return g_bFixtureCollideableReplaced ? &s_Replacement : &s_Initial;
		}

		class FixtureTraceLifetimeUnknown final : public IHandleEntity {
		public:
			ICollideable* GetCollideable() {
				return GetFixtureCurrentCollideable();
			}

			CBaseHandle const& GetRefEHandle() const override {
				return GetFixtureCollideableHandleEntity()->GetRefEHandle();
			}
		};

		class FixtureTraceLifetimeEdict {
		public:
			ICollideable* GetCollideable() {
				return g_bFixtureCollideableEntityPresent ? GetFixtureCurrentCollideable() : nullptr;
			}

			bool IsFree() const {
				return !g_bFixtureCollideableEntityPresent;
			}

			FixtureTraceLifetimeUnknown* GetUnknown() {
				static FixtureTraceLifetimeUnknown s_Initial {};
				static FixtureTraceLifetimeUnknown s_Replacement {};
				if (!g_bFixtureCollideableEntityPresent) {
					return nullptr;
				}

				return g_bFixtureCollideableReplaced ? &s_Replacement : &s_Initial;
			}
		};

		FixtureTraceLifetimeEdict* GetFixtureTraceLifetimeEdict(const int nEntityIndex) {
			static FixtureTraceLifetimeEdict s_Edict {};

			return (nEntityIndex == kFixtureCollideableEntityIndex) ? &s_Edict : nullptr;
		}

		class FixtureCollideableContentsEngine {
		public:
			int GetPointContents_Collideable(ICollideable* const pCollideable, Vector const&) {
				++g_unFixtureCollideableDispatchCalls;
				Require(g_bFixtureCollideableEntityPresent && g_bFixtureCollideablePresent && g_FixtureCollideableHandle.IsValid() && (pCollideable == GetFixtureCurrentCollideable()), "Controlled SDK dispatch received stale collideable identity");

				return kFixtureCollideableContents;
			}
		};

		FixtureCollideableContentsEngine* RequireFixtureCollideableContentsEngine(v8::Isolate*, char const*) {
			static FixtureCollideableContentsEngine s_Engine {};

			return &s_Engine;
		}
	`,
	g_strCollideableResolver,
	g_strCollideableHandleResolver,
	"#define SOURCEJS_HAS_ENGINE_TRACE 1\n" + g_strCollideableQueryAdapter + "\n#undef SOURCEJS_HAS_ENGINE_TRACE",
	String.raw`
		void MutateCollideableIdentityForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			constexpr int kRemovedEntityMode = 0;
			constexpr int kReusedEntityMode = 1;
			constexpr int kRemovedCollideableMode = 2;
			constexpr int kReplacedCollideableMode = 3;
			constexpr int kInvalidHandleMode = 4;

			auto* const pIsolate = CallbackInformation.GetIsolate();
			if (!CallbackInformation[0]->IsInt32()) {
				ThrowError(pIsolate, "Controlled collideable mutation requires an integer mode.");
				return;
			}

			const int nMode = CallbackInformation[0].As<v8::Int32>()->Value();
			switch (nMode) {
				case kRemovedEntityMode:
					g_bFixtureCollideableEntityPresent = false;
					break;

				case kReusedEntityMode:
					g_FixtureCollideableHandle.Init(kFixtureCollideableEntityIndex, kFixtureCollideableReplacementSerial);
					g_bFixtureCollideableReplaced = true;
					break;

				case kRemovedCollideableMode:
					g_bFixtureCollideablePresent = false;
					break;

				case kReplacedCollideableMode:
					g_bFixtureCollideableReplaced = true;
					break;

				case kInvalidHandleMode:
					g_FixtureCollideableHandle.m_Index = std::numeric_limits<unsigned int>::max();
					break;

				default:
					ThrowError(pIsolate, "Unknown controlled collideable mutation mode.");
					return;
			}
		}

		void ReadCollideableDispatchCountForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			CallbackInformation.GetReturnValue().Set(v8::Integer::NewFromUnsigned(CallbackInformation.GetIsolate(), g_unFixtureCollideableDispatchCalls));
		}

		void ReadCollideableContentsForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			g_MessageFault = MessageFault::None;
			g_FixtureCollideableHandle.Init(kFixtureCollideableEntityIndex, kFixtureCollideableInitialSerial);
			g_bFixtureCollideableEntityPresent = true;
			g_bFixtureCollideablePresent = true;
			g_bFixtureCollideableReplaced = false;
			g_unFixtureCollideableDispatchCalls = 0;
			GetPointContentsOfCollideableCallback(CallbackInformation);
		}
	`,
].filter(strHelper => strHelper.length > 0).join("\n\n");

const g_strClipEntity = GetDefinition("ClipRayToEntityCallback");
const g_strClipCollideable = GetDefinition("ClipRayToCollideableCallback");
// Only SDK interface/edict lookup is adapted; actual callback validation and dispatch order remain intact.
const g_strClipEntityAdapter = ReplaceOnce(g_strClipEntity, "RequireEngineTraceInterface(pIsolate, kOperationName)", "RequireFixtureClipEngine(pIsolate, kOperationName)").replaceAll("GetEdictFromEntityIndex(", "GetFixtureTraceLifetimeEdict(");
const g_strClipCollideableAdapter = ReplaceOnce(g_strClipCollideable, "RequireEngineTraceInterface(pIsolate, kOperationName)", "RequireFixtureClipEngine(pIsolate, kOperationName)");
const g_strClipHandleResolver = ReplaceOnce(GetDefinition("GetTraceHandleEntityFromValue"), "GetEdictFromEntityIndex(nEntityIndex)", "GetFixtureTraceLifetimeEdict(nEntityIndex)");
const g_strClipEntityAliasedHandle = ReplaceOnce(g_strClipEntityAdapter, "CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();", "CBaseHandle const& EntityHandle = pHandleEntity->GetRefEHandle();");
const g_strClipEntitySerialUnchecked = ReplaceOnce(g_strClipEntityAdapter, "(CurrentEntityHandle.GetSerialNumber() != EntityHandle.GetSerialNumber())", "false");
const g_strClipEntityStaleAddress = ReplaceOnce(g_strClipEntityAdapter, "\t\t\t\tpHandleEntity = pServerUnknown;\n", "");
const g_strClipCollideableAliasedHandle = ReplaceOnce(g_strClipCollideableAdapter, "CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();", "CBaseHandle const& EntityHandle = pHandleEntity->GetRefEHandle();");
const g_strClipCollideableStaleAddress = ReplaceOnce(g_strClipCollideableAdapter, "pEntityCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);", "GetTraceCollideableFromEntityHandle(EntityHandle);");
const g_strClipLifetimeHelpers = [
	String.raw`
		class FixtureClipEngine {
		public:
			void ClipRayToEntity(Ray_t const&, const unsigned int, IHandleEntity* const pHandleEntity, trace_t*) {
				++g_unFixtureCollideableDispatchCalls;
				Require(g_bFixtureCollideableEntityPresent && g_FixtureCollideableHandle.IsValid() && (pHandleEntity == GetFixtureTraceLifetimeEdict(kFixtureCollideableEntityIndex)->GetUnknown()), "Controlled clip dispatch received stale entity identity");
			}

			void ClipRayToCollideable(Ray_t const&, const unsigned int, ICollideable* const pCollideable, trace_t*) {
				++g_unFixtureCollideableDispatchCalls;
				Require(g_bFixtureCollideableEntityPresent && g_bFixtureCollideablePresent && g_FixtureCollideableHandle.IsValid() && (pCollideable == GetFixtureCurrentCollideable()), "Controlled clip dispatch received stale collideable identity");
			}
		};

		FixtureClipEngine* RequireFixtureClipEngine(v8::Isolate*, char const*) {
			static FixtureClipEngine s_Engine {};

			return &s_Engine;
		}
	`,
	GetDefinition("ValidateTraceResultTarget"),
	g_strClipHandleResolver,
	"#define SOURCEJS_HAS_ENGINE_TRACE 1\n" + g_strClipEntityAdapter + "\n" + g_strClipCollideableAdapter + "\n#undef SOURCEJS_HAS_ENGINE_TRACE",
	String.raw`
		void ResetFixtureTraceIdentity() {
			g_MessageFault = MessageFault::None;
			g_FixtureCollideableHandle.Init(kFixtureCollideableEntityIndex, kFixtureCollideableInitialSerial);
			g_bFixtureCollideableEntityPresent = true;
			g_bFixtureCollideablePresent = true;
			g_bFixtureCollideableReplaced = false;
			g_unFixtureCollideableDispatchCalls = 0;
		}

		void ReadClipEntityForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			ResetFixtureTraceIdentity();
			ClipRayToEntityCallback(CallbackInformation);
		}

		void ReadClipCollideableForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			ResetFixtureTraceIdentity();
			ClipRayToCollideableCallback(CallbackInformation);
		}
	`,
].join("\n\n");

const g_strSweepLifetimeCallback = ReplaceOnce(GetDefinition("SweepCollideableCallback"), "RequireEngineTraceInterface(pIsolate, kOperationName)", "RequireFixtureTraceLifetimeEngine(pIsolate, kOperationName)");
const g_strCollideableSnapshotCallback = ReplaceOnce(ReplaceOnce(GetDefinition("GetCollideableCallback"), "RequireEngineTraceInterface(pIsolate, kOperationName)", "RequireFixtureTraceLifetimeEngine(pIsolate, kOperationName)"), "GetEdictFromEntityIndex(nEntityIndex)", "GetFixtureTraceLifetimeEdict(nEntityIndex)");
const g_strSweepAliasedHandle = ReplaceOnce(g_strSweepLifetimeCallback, "CBaseHandle const EntityHandle = pHandleEntity->GetRefEHandle();", "CBaseHandle const& EntityHandle = pHandleEntity->GetRefEHandle();");
const g_strSweepStaleAddress = ReplaceOnce(g_strSweepLifetimeCallback, "pEntityCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);", "GetTraceCollideableFromEntityHandle(EntityHandle);");
const g_strSweepFreshIdentityBlock = "\t\t\t\tpEntityCollideable = GetTraceCollideableFromEntityHandle(EntityHandle);\n\t\t\t\tif (!pEntityCollideable) {\n\t\t\t\t\tThrowError(pIsolate, kCollideableErrorMessage);\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n";
const g_strSweepFilterDeclaration = "\t\t\t\tTraceFilter TraceFilterAdapter = TraceFilter(pIsolate, LocalContext, LocalFilterValue);";
const g_strSweepEarlyRefresh = ReplaceOnce(ReplaceOnce(g_strSweepLifetimeCallback, g_strSweepFreshIdentityBlock, ""), g_strSweepFilterDeclaration, g_strSweepFreshIdentityBlock + g_strSweepFilterDeclaration);
const g_strSweepLifetimeHelpers = [
	String.raw`
		// Static native identity/storage and counted dispatch; no live SDK ABI or in-query mutation model.
		class FixtureTraceLifetimeEngine {
		public:
			void SweepCollideable(ICollideable* const pCollideable, Vector const&, Vector const&, QAngle const&, const unsigned int, ITraceFilter*, trace_t*) {
				++g_unFixtureCollideableDispatchCalls;
				Require(g_bFixtureCollideableEntityPresent && g_bFixtureCollideablePresent && g_FixtureCollideableHandle.IsValid() && (pCollideable == GetFixtureCurrentCollideable()), "Controlled sweep dispatch received stale collideable identity");
			}
		};

		FixtureTraceLifetimeEngine* RequireFixtureTraceLifetimeEngine(v8::Isolate*, char const*) {
			static FixtureTraceLifetimeEngine s_Engine {};

			return &s_Engine;
		}
	`,
	"#define SOURCEJS_HAS_ENGINE_TRACE 1\n" + g_strCollideableSnapshotCallback + "\n" + g_strSweepLifetimeCallback + "\n#undef SOURCEJS_HAS_ENGINE_TRACE",
	String.raw`
		void ReadCollideableSnapshotForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			constexpr int kWithoutCollideableArgumentIndex = 1;

			ResetFixtureTraceIdentity();
			g_bFixtureCollideablePresent = !CallbackInformation[kWithoutCollideableArgumentIndex]->IsTrue();
			GetCollideableCallback(CallbackInformation);
		}

		void ReadSweepLifetimeForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			ResetFixtureTraceIdentity();
			SweepCollideableCallback(CallbackInformation);
		}
	`,
].join("\n\n");

function GetSoundEntitySelectionProbe(strCallbackName, strProbeName) {
	const strDefinition = GetDefinition(strCallbackName);
	const nBegin = strDefinition.indexOf("\t\t\t\tif (!IsValueNullish(LocalEntityValue) && !GetIntegerFromValue(");
	const nEnd = strDefinition.indexOf("\n\t\t\t\tif (!GetSoundIntegerPropertyFromObject(", nBegin);
	g_Assert((nBegin >= 0) && (nEnd > nBegin), "Locate actual sound entity selection block: " + strCallbackName);
	const strSelection = strDefinition.slice(nBegin, nEnd).trimEnd().split("\n").map(strLine => strLine.startsWith("\t") ? strLine.slice(1) : strLine).join("\n");
	const strConstants = GetFixtureConstants(strDefinition, ["kDefaultEntityIndex", "kEntityErrorMessage"]);

	return `		void ${strProbeName}(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
${strConstants}

			auto* const pIsolate = CallbackInformation.GetIsolate();
			v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
			v8::Local<v8::Value> const LocalEntityValue = CallbackInformation[0];
			int nEntityIndex = kDefaultEntityIndex;
${strSelection}

			CallbackInformation.GetReturnValue().Set(nEntityIndex);
		}`;
}

const g_strSoundEntitySelectionProbe = GetSoundEntitySelectionProbe("EmitSoundCallback", "ReadSoundEntityIndexForFixture");
const g_strStopSoundEntitySelectionProbe = GetSoundEntitySelectionProbe("StopSoundCallback", "ReadStopSoundEntityIndexForFixture");
const g_SoundEntityUnwindPattern = /if \(IndexLookupFailure\.HasCaught\(\)\) \{\n\t+IndexLookupFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
g_Assert(g_SoundEntityUnwindPattern.test(g_strSoundEntitySelectionProbe), "Retain actual sound entity native-unwind guard.");
g_Assert(g_SoundEntityUnwindPattern.test(g_strStopSoundEntitySelectionProbe), "Retain actual stop-sound entity native-unwind guard.");
const g_vecTraceQueryOwners = [
	{ Callback: "GetPointContentsCallback", Owner: "PositionLookupFailure", Input: "LocalPositionValue", Setup: "Vector Position {};", Error: "kPositionInvalidErrorMessage" },
	{ Callback: "GetPointContentsOfCollideableCallback", Owner: "EntityLookupFailure", Input: "LocalEntityValue", Setup: "void* pCollideable = nullptr;", Resolver: "GetTraceCollideableFromValue", Result: "pCollideable == nullptr" },
	{ Callback: "GetPointContentsOfCollideableCallback", Owner: "PositionLookupFailure", Input: "LocalPositionValue", Setup: "Vector Position {};", Error: "kPositionErrorMessage" },
	{ Callback: "TraceRayCallback", Owner: "RayLookupFailure", Input: "LocalRayValue", Setup: "Ray_t TraceRayInformation {};", Error: "kInvalidRayErrorMessage" },
	{ Callback: "ClipRayToEntityCallback", Owner: "EntityLookupFailure", Input: "LocalEntityValue", Setup: "void* pHandleEntity = nullptr;", Resolver: "GetTraceHandleEntityFromValue", Result: "pHandleEntity == nullptr" },
	{ Callback: "ClipRayToEntityCallback", Owner: "RayLookupFailure", Input: "LocalRayValue", Setup: "Ray_t TraceRayInformation {};", Error: "kRayErrorMessage" },
	{ Callback: "ClipRayToCollideableCallback", Owner: "EntityLookupFailure", Input: "LocalEntityValue", Setup: "void* pEntityCollideable = nullptr;", Resolver: "GetTraceCollideableFromValue", Result: "pEntityCollideable == nullptr" },
	{ Callback: "ClipRayToCollideableCallback", Owner: "RayLookupFailure", Input: "LocalRayValue", Setup: "Ray_t TraceRayInformation {};", Error: "kRayErrorMessage" },
	{ Callback: "EnumerateEntitiesCallback", Owner: "RayLookupFailure", Input: "LocalRayValue", Setup: "Ray_t TraceRayInformation {};", Error: "kRayErrorMessage" },
	{ Callback: "EnumerateEntitiesInBoxCallback", Owner: "MinimumBoundsLookupFailure", Input: "LocalMinimumBoundsValue", Setup: "Vector MinimumBounds {};", Error: "kBoundsErrorMessage" },
	{ Callback: "EnumerateEntitiesInBoxCallback", Owner: "MaximumBoundsLookupFailure", Input: "LocalMaximumBoundsValue", Setup: "Vector MaximumBounds {};", Error: "kBoundsErrorMessage" },
	{ Callback: "GetCollideableCallback", Owner: "IndexLookupFailure", Input: "LocalEntityValue", Setup: "int nEntityIndex = -1;", Result: "nEntityIndex >= 0" },
	{ Callback: "IsPointOutsideWorldCallback", Owner: "PositionLookupFailure", Input: "LocalPointValue", Setup: "Vector Position {};", Error: "kPositionErrorMessage" },
	{ Callback: "GetLeafContainingPointCallback", Owner: "PositionLookupFailure", Input: "LocalPointValue", Setup: "Vector Position {};", Error: "kPositionErrorMessage" },
	{ Callback: "SweepCollideableCallback", Owner: "EntityLookupFailure", Input: "LocalEntityValue", Setup: "void* pEntityCollideable = nullptr;", Resolver: "GetTraceCollideableFromValue", Result: "pEntityCollideable == nullptr" },
	{ Callback: "SweepCollideableCallback", Owner: "StartPositionLookupFailure", Input: "LocalStartPositionValue", Setup: "Vector StartPosition {};", Error: "kVectorsErrorMessage" },
	{ Callback: "SweepCollideableCallback", Owner: "EndPositionLookupFailure", Input: "LocalEndPositionValue", Setup: "Vector EndPosition {};", Error: "kVectorsErrorMessage" },
	{ Callback: "SweepCollideableCallback", Owner: "AnglesLookupFailure", Input: "LocalAnglesValue", Setup: "QAngle SweepAngles {};", Error: "kVectorsErrorMessage" },
	{ Callback: "GetEngineServerClientCVarValueCallback", Owner: "IndexLookupFailure", Input: "LocalPlayerValue", Setup: "int nPlayerIndex = -1;", Result: "nPlayerIndex >= 0" },
	{ Callback: "RequireEngineEdictArgument", Owner: "EntityLookupFailure", Input: "LocalArgumentValue", Setup: "void* pEntityEdict = nullptr;", Resolver: "GetEntityEdictFromValue", Result: "pEntityEdict == nullptr", ReturnsAddress: true },
	{ Callback: "GetEngineServerClusterForOriginCallback", Owner: "OriginLookupFailure", Input: "LocalOriginValue", Setup: "Vector Origin {};", Error: "kOriginErrorMessage" },
];
const g_vecTraceQueryOwnerProbes = g_vecTraceQueryOwners.map((Specification, unOwnerIndex) => {
	const strDefinition = GetDefinition(Specification.Callback);
	const vecOwnerMatch = new RegExp("^(\\t+)v8::TryCatch " + Specification.Owner + "\\(pIsolate\\);$", "m").exec(strDefinition);
	g_Assert(vecOwnerMatch, "Locate trace query owner: " + Specification.Callback + ": " + Specification.Owner);
	const strScopeIndent = vecOwnerMatch[1].slice(1);
	const nBegin = strDefinition.lastIndexOf("\n" + strScopeIndent + "{\n", vecOwnerMatch.index) + 1;
	const nEnd = strDefinition.indexOf("\n" + strScopeIndent + "}", vecOwnerMatch.index);
	g_Assert((nBegin > 0) && (nEnd > vecOwnerMatch.index), "Locate trace query owner scope.");
	let strScope = strDefinition.slice(nBegin, nEnd + ("\n" + strScopeIndent + "}").length).split("\n").map(strLine => strLine.startsWith(strScopeIndent) ? ("\t\t\t" + strLine.slice(strScopeIndent.length)) : strLine).join("\n");
	if (Specification.Resolver) {
		strScope = ReplaceOnce(strScope, Specification.Resolver + "(", "GetFixtureTraceEntityFromValue(");
	}

	if (Specification.ReturnsAddress) {
		// The probe has a void V8 signature; only the early-exit result is adapted.
		strScope = strScope.replaceAll("return nullptr;", "return;");
	}

	const vecErrorMatch = Specification.Error ? new RegExp("constexpr char " + Specification.Error + "\\[\\] = [^\\n]+;").exec(strDefinition) : null;
	g_Assert(!Specification.Error || vecErrorMatch, "Locate trace query fallback error.");
	const strErrorDeclaration = vecErrorMatch ? ("\t\t\t" + vecErrorMatch[0] + "\n\n") : "";

	return `		void ReadTraceQueryOwnerForFixture${unOwnerIndex}(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
${strErrorDeclaration}			auto* const pIsolate = CallbackInformation.GetIsolate();
			v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
			v8::Local<v8::Value> const ${Specification.Input} = CallbackInformation[0];
			${Specification.Setup}
${strScope}

			CallbackInformation.GetReturnValue().Set(${Specification.Result || "true"});
		}`;
});
const g_TraceQueryUnwindPattern = /if \((PositionLookupFailure|EntityLookupFailure|RayLookupFailure|MinimumBoundsLookupFailure|MaximumBoundsLookupFailure|IndexLookupFailure|StartPositionLookupFailure|EndPositionLookupFailure|AnglesLookupFailure|OriginLookupFailure)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
g_Assert(g_vecTraceQueryOwnerProbes.every(strProbe => g_TraceQueryUnwindPattern.test(strProbe)), "Retain each actual trace query native-unwind guard.");
const g_strTraceQueryOwnerHelpers = [
	"\t\tconstexpr std::uint32_t kFixtureTraceQueryOwnerCount = " + g_vecTraceQueryOwners.length + ";",
	// The real index parser runs; SDK entity lookup and address dereference are not modeled.
	`\t\tvoid* GetFixtureTraceEntityFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalEntityValue) {
			GetValueIndex(pIsolate, LocalContext, LocalEntityValue);

			return nullptr;
		}`,
	...g_vecTraceQueryOwnerProbes,
	`\t\tvoid ReadTraceQueryOwnerForFixture(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			constexpr int kOwnerArgumentIndex = 2;
			constexpr v8::FunctionCallback kOwnerCallbacks[] = {
${Array.from(g_vecTraceQueryOwners.keys(), unOwnerIndex => "\t\t\t\tReadTraceQueryOwnerForFixture" + unOwnerIndex + ",").join("\n")}
			};

			static_assert((sizeof(kOwnerCallbacks) / sizeof(kOwnerCallbacks[0])) == kFixtureTraceQueryOwnerCount, "Trace owner callback count mismatch");

			auto* const pIsolate = CallbackInformation.GetIsolate();
			if ((CallbackInformation.Length() <= kOwnerArgumentIndex) || !CallbackInformation[kOwnerArgumentIndex]->IsUint32()) {
				ThrowError(pIsolate, "Fixture trace owner index must be uint32.");
				return;
			}

			const std::uint32_t unOwnerIndex = CallbackInformation[kOwnerArgumentIndex].As<v8::Uint32>()->Value();
			if (unOwnerIndex >= kFixtureTraceQueryOwnerCount) {
				ThrowError(pIsolate, "Fixture trace owner index is out of range.");
				return;
			}

			kOwnerCallbacks[unOwnerIndex](CallbackInformation);
		}`,
].join("\n\n");
const g_strBitBufferStateHelpers = [
	"\t\tconstinit int g_nFixtureBitBufferFailureMode = 0;",
	g_strBitBufferStateRecord,
	g_strBitBufferByteConverter,
	...["MakeFilesystemByteArrayValue", "CalculateByteCountForBitCount", "ClampIntegerToRange", "GetObjectPropertyValueForBitBuffers", "GetObjectIntegerPropertyForBitBuffers", "GetObjectBooleanPropertyForBitBuffers"].map(strName => GetDefinition(strName)),
	g_strBitBufferStateParser,
	GetDefinition("MakeBitBufferStateObject"),
	GetDefinition("GetUInt32Argument"),
	g_strBitBufferPackUInt32,
	GetDefinition("CreateBitBufferWriterCallback"),
	g_strBitBufferCreateReader,
].join("\n\n");

const g_nSpatialPartitionConstructionScopeStart = g_strSource.indexOf("\t\t// Track nested result construction on the callback thread");
const g_nSpatialPartitionConstructionScopeEnd = g_strSource.indexOf("\n#endif // defined(SOURCEJS_HAS_SPATIAL_PARTITION)", g_nSpatialPartitionConstructionScopeStart);
g_Assert((g_nSpatialPartitionConstructionScopeStart >= 0) && (g_nSpatialPartitionConstructionScopeEnd > g_nSpatialPartitionConstructionScopeStart), "Locate actual nested spatial-partition construction scope.");
const g_strSpatialPartitionConstructionScope = g_strSource.slice(g_nSpatialPartitionConstructionScopeStart, g_nSpatialPartitionConstructionScopeEnd);

const g_strSpatialPartitionCallback = GetDefinition("CreateEngineServerSpatialPartitionCallback");
const g_strSpatialPartitionHelpers = [
	"#define SOURCEJS_HAS_SPATIAL_PARTITION 1",
	g_strSpatialPartitionConstructionScope,
	...["CreateEngineServerSpatialPartition", "DestroyEngineServerSpatialPartition", "ReleaseUnreturnedEngineServerSpatialPartition"].map(strName => "\t\ttemplate <typename TEngineServer>\n" + GetDefinition(strName)),
	GetDefinition("RequireOpaqueAddressFromValue"),
	g_strSpatialPartitionCallback,
	GetDefinition("DestroyEngineServerSpatialPartitionCallback"),
	"#undef SOURCEJS_HAS_SPATIAL_PARTITION",
].join("\n\n");

const g_strSpatialPartitionDestroyCallback = GetDefinition("DestroyEngineServerSpatialPartitionCallback");
const g_nSpatialPartitionConstructionGuardStart = g_strSpatialPartitionDestroyCallback.indexOf("\t\t\t\tif (SpatialPartitionConstructionScope::IsConstructing(pSpatialPartition)) {");
const g_nSpatialPartitionConstructionGuardEnd = g_strSpatialPartitionDestroyCallback.indexOf("\n\n\t\t\t\tif (!DestroyEngineServerSpatialPartition(", g_nSpatialPartitionConstructionGuardStart);
g_Assert((g_nSpatialPartitionConstructionGuardStart >= 0) && (g_nSpatialPartitionConstructionGuardEnd > g_nSpatialPartitionConstructionGuardStart), "Locate the complete construction-only public destruction guard.");
const g_strSpatialPartitionConstructionGuard = g_strSpatialPartitionDestroyCallback.slice(g_nSpatialPartitionConstructionGuardStart, g_nSpatialPartitionConstructionGuardEnd);
const g_strSpatialPartitionConstructionGuardConstant = '\t\t\tconstexpr char kSpatialPartitionUnderConstructionErrorMessage[] = "engines/server.DestroySpatialPartition() cannot destroy a partition before CreateSpatialPartition() returns it.";\n';
const g_strSpatialPartitionUnguardedDestroy = ReplaceOnce(ReplaceOnce(g_strSpatialPartitionDestroyCallback, g_strSpatialPartitionConstructionGuard + "\n\n", ""), g_strSpatialPartitionConstructionGuardConstant, "");

// Preserve actual parsers and full handle logic; only SDK storage/lookup/dispatch are adapted.
function AdaptMovementSDK(strDefinition) {
	const vecNames = [
		["GetEntityBaseHandleFromEdictAddress", "GetFixtureMovementHandleFromEdict"],
		["GetEntityIndexFromBaseHandleValue", "GetFixtureMovementIndexFromHandle"],
		["GetValidEntityEdictFromIndex", "GetValidFixtureMovementEdictFromIndex"],
		["GetEdictFromEntityIndex", "GetFixtureMovementEdictFromIndex"],
		["RequireEngineServer", "RequireFixtureMovementEngineServer"],
	];
	// Adapt declarations/casts only; preserve SDK names inside public diagnostics.
	strDefinition = strDefinition.replace(/\bedict_t\*/g, "FixtureMovementEdict*").replace(/\bICollideable\*/g, "FixtureMovementCollideable*");
	for (const vecName of vecNames) {
		strDefinition = strDefinition.replace(new RegExp("\\b" + vecName[0] + "\\b", "g"), vecName[1]);
	}

	return strDefinition;
}

const g_strMovementSDK = `		// Readable, independent SDK storage: handle packing and dispatch, not SDK ABI/lifetime emulation.
		struct FixtureMovementCollideable {};

		struct FixtureMovementHandleEntity {
			CBaseHandle const& GetRefEHandle() const;

			CBaseHandle m_Handle;
		};

		CBaseHandle const& FixtureMovementHandleEntity::GetRefEHandle() const {
			return m_Handle;
		}

		struct FixtureMovementNetworkable {
			FixtureMovementHandleEntity* GetEntityHandle();

			FixtureMovementHandleEntity* m_pHandleEntity;
		};

		FixtureMovementHandleEntity* FixtureMovementNetworkable::GetEntityHandle() {
			return m_pHandleEntity;
		}

		struct FixtureMovementEdict {
			bool IsFree();
			FixtureMovementNetworkable* GetNetworkable();
			FixtureMovementCollideable* GetCollideable();

			bool m_bFree;
			FixtureMovementNetworkable* m_pNetworkable;
			FixtureMovementCollideable* m_pCollideable;
		};

		bool FixtureMovementEdict::IsFree() {
			return m_bFree;
		}

		FixtureMovementNetworkable* FixtureMovementEdict::GetNetworkable() {
			return m_pNetworkable;
		}

		FixtureMovementCollideable* FixtureMovementEdict::GetCollideable() {
			return m_pCollideable;
		}

		constexpr int kFixtureMovementEntityIndex = 4;
		constexpr int kFixtureMovementSerialNumber = 3;
		constexpr int kFixtureMovementDispatched = 0x1;
		constexpr int kFixtureMovementCurrentEdict = 0x2;
		constexpr int kFixtureMovementCurrentCollideable = 0x4;
		constexpr int kFixtureMovementExplicitCollideable = 0x8;
		constexpr int kFixtureMovementOriginCopied = 0x10;
		constexpr int kFixtureMovementBoundsOnly = 0x20;
		constexpr int kFixtureMovementDispatchIncrement = 0x100;

		constinit FixtureMovementCollideable g_MovementCollideable {};
		constinit FixtureMovementCollideable g_RelocatedMovementCollideable {};
		constinit FixtureMovementCollideable g_ExplicitMovementCollideable {};
		constinit FixtureMovementHandleEntity g_MovementHandleEntity {};
		constinit FixtureMovementHandleEntity g_RelocatedMovementHandleEntity {};
		constinit FixtureMovementNetworkable g_MovementNetworkable {};
		constinit FixtureMovementNetworkable g_RelocatedMovementNetworkable {};
		constinit FixtureMovementEdict g_MovementEdict {};
		constinit FixtureMovementEdict g_RelocatedMovementEdict {};
		constinit FixtureMovementEdict* g_pMovementEdict = nullptr;
		constinit int g_nMovementDispatchState = 0;

		FixtureMovementEdict* GetFixtureMovementEdictFromIndex(const int nEntityIndex) {
			return (nEntityIndex == kFixtureMovementEntityIndex) ? g_pMovementEdict : nullptr;
		}

		FixtureMovementEdict* GetValidFixtureMovementEdictFromIndex(const int nEntityIndex) {
			auto* const pEdict = GetFixtureMovementEdictFromIndex(nEntityIndex);

			return (pEdict && !pEdict->IsFree()) ? pEdict : nullptr;
		}

		void RecordFixtureMovementDispatch(FixtureMovementEdict* const pEntityEdict, FixtureMovementCollideable* const pCollideable, Vector const* const pPreviousOrigin, const bool bBoundsOnly) {
			if (g_nMovementDispatchState > (std::numeric_limits<int>::max() - kFixtureMovementDispatchIncrement)) {
				throw std::runtime_error("Controlled movement dispatch state overflow.");
			}

			g_nMovementDispatchState += kFixtureMovementDispatchIncrement;
			g_nMovementDispatchState |= kFixtureMovementDispatched;

			if (pEntityEdict == g_pMovementEdict) {
				g_nMovementDispatchState |= kFixtureMovementCurrentEdict;
			}

			if (g_pMovementEdict && (pCollideable == g_pMovementEdict->m_pCollideable)) {
				g_nMovementDispatchState |= kFixtureMovementCurrentCollideable;
			}

			if (pCollideable == &g_ExplicitMovementCollideable) {
				g_nMovementDispatchState |= kFixtureMovementExplicitCollideable;
			}

			if (pPreviousOrigin && (pPreviousOrigin->x == 1) && (pPreviousOrigin->y == 2) && (pPreviousOrigin->z == 3)) {
				g_nMovementDispatchState |= kFixtureMovementOriginCopied;
			}

			if (bBoundsOnly) {
				g_nMovementDispatchState |= kFixtureMovementBoundsOnly;
			}
		}

		struct FixtureMovementEngineServer {
			void SetView(FixtureMovementEdict* const pClientEdict, FixtureMovementEdict* const pViewEntityEdict);
			void CrosshairAngle(FixtureMovementEdict* const pClientEdict, const float flPitch, const float flYaw);
			void SolidMoved(FixtureMovementEdict* const pEntityEdict, FixtureMovementCollideable* const pCollideable, Vector const* const pPreviousOrigin, const bool bBoundsOnly);
			void FadeClientVolume(FixtureMovementEdict* const pClientEdict, const float flFadePercent, const float flFadeOutSeconds, const float flHoldTime, const float flFadeInSeconds);
		};

		void FixtureMovementEngineServer::SolidMoved(FixtureMovementEdict* const pEntityEdict, FixtureMovementCollideable* const pCollideable, Vector const* const pPreviousOrigin, const bool bBoundsOnly) {
			RecordFixtureMovementDispatch(pEntityEdict, pCollideable, pPreviousOrigin, bBoundsOnly);
		}

		struct FixtureLegacyMovementEngineServer {
			void SolidMoved(FixtureMovementEdict* const pEntityEdict, FixtureMovementCollideable* const pCollideable, Vector const* const pPreviousOrigin);
		};

		void FixtureLegacyMovementEngineServer::SolidMoved(FixtureMovementEdict* const pEntityEdict, FixtureMovementCollideable* const pCollideable, Vector const* const pPreviousOrigin) {
			RecordFixtureMovementDispatch(pEntityEdict, pCollideable, pPreviousOrigin, false);
		}

		struct FixtureUnsupportedMovementEngineServer {};
		constinit FixtureMovementEngineServer g_MovementEngineServer {};

		FixtureMovementEngineServer* RequireFixtureMovementEngineServer(v8::Isolate*, char const*) {
			return &g_MovementEngineServer;
		}`;
const g_strMovementHandleCapture = AdaptMovementSDK(GetDefinition("GetEntityBaseHandleFromEdictAddress"));
const g_strMovementHandleResolver = AdaptMovementSDK(GetDefinition("GetEntityIndexFromBaseHandleValue"));
const g_strMovementCallback = AdaptMovementSDK(GetDefinition("NotifyEngineServerSolidMovedCallback"));
const g_strClientVolumeSDK = `		constexpr int kFixtureClientVolumeDispatchIncrement = 0x100;
		constexpr int kFixtureClientVolumeDispatched = 0x1;
		constexpr int kFixtureClientVolumeCurrentEdict = 0x2;
		constexpr int kFixtureClientVolumeValuesMatch = 0x4;

		constinit int g_nClientVolumeDispatchState = 0;
		constinit bool g_bClientVolumeNativeThrows = false;

		void FixtureMovementEngineServer::FadeClientVolume(FixtureMovementEdict* const pClientEdict, const float flFadePercent, const float flFadeOutSeconds, const float flHoldTime, const float flFadeInSeconds) {
			if (g_nClientVolumeDispatchState > (std::numeric_limits<int>::max() - kFixtureClientVolumeDispatchIncrement)) {
				throw std::runtime_error("Controlled client-volume dispatch state overflow.");
			}

			g_nClientVolumeDispatchState += kFixtureClientVolumeDispatchIncrement;

			if (g_bClientVolumeNativeThrows) {
				throw std::runtime_error("Controlled client-volume native failure.");
			}

			g_nClientVolumeDispatchState |= kFixtureClientVolumeDispatched;

			if (pClientEdict == g_pMovementEdict) {
				g_nClientVolumeDispatchState |= kFixtureClientVolumeCurrentEdict;
			}

			if ((flFadePercent == 25.0F) && (flFadeOutSeconds == 0.5F) && (flHoldTime == 1.0F) && (flFadeInSeconds == 0.75F)) {
				g_nClientVolumeDispatchState |= kFixtureClientVolumeValuesMatch;
			}
		}

		// Resolve only controlled index/Index inputs; real mapped addresses and SDK ABI are not emulated.
		FixtureMovementEdict* GetFixtureClientVolumeEdictFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			const int nEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalValue);

			return GetValidFixtureMovementEdictFromIndex(nEntityIndex);
		}`;
const g_strClientVolumeHandleCapture = ReplaceOnce(g_strMovementHandleCapture, "GetFixtureMovementHandleFromEdict", "GetFixtureClientVolumeHandleFromEdict");
const g_strClientVolumeHandleResolver = ReplaceOnce(ReplaceOnce(g_strMovementHandleResolver, "GetFixtureMovementIndexFromHandle", "GetFixtureClientVolumeIndexFromHandle"), "GetFixtureMovementHandleFromEdict", "GetFixtureClientVolumeHandleFromEdict");
const g_strClientVolumeEdictArgument = ReplaceOnce(AdaptMovementSDK(GetDefinition("RequireEngineEdictArgument")), "GetEntityEdictFromValue", "GetFixtureClientVolumeEdictFromValue");
const g_strClientVolumeCallback = ReplaceOnce(ReplaceOnce(AdaptMovementSDK(GetDefinition("FadeEngineServerClientVolumeCallback")), "GetFixtureMovementHandleFromEdict", "GetFixtureClientVolumeHandleFromEdict"), "GetFixtureMovementIndexFromHandle", "GetFixtureClientVolumeIndexFromHandle");
const g_strClientVolumeHelpers = [
	g_strClientVolumeSDK,
	g_strClientVolumeHandleCapture,
	g_strClientVolumeHandleResolver,
	g_strClientVolumeEdictArgument,
	g_strClientVolumeCallback,
].join("\n\n");

function AdaptClientPresentation(strDefinition) {
	strDefinition = AdaptMovementSDK(strDefinition);
	for (const vecNames of [
		["GetFixtureMovementHandleFromEdict", "GetFixtureClientPresentationHandleFromEdict"],
		["GetFixtureMovementIndexFromHandle", "GetFixtureClientPresentationIndexFromHandle"],
		["RequireEngineEdictArgument", "RequireFixtureClientPresentationEdictArgument"],
		["GetEntityEdictFromValue", "GetFixtureClientPresentationEdictFromValue"],
	]) {
		strDefinition = strDefinition.replace(new RegExp("\\b" + vecNames[0] + "\\b", "g"), vecNames[1]);
	}

	return strDefinition;
}

const g_strClientPresentationSDK = `		constexpr int kFixtureClientViewEntityIndex = 5;

		constinit FixtureMovementEdict g_ClientViewEdict {};

		void FixtureMovementEngineServer::SetView(FixtureMovementEdict* const pClientEdict, FixtureMovementEdict* const pViewEntityEdict) {
			if (g_nClientVolumeDispatchState > (std::numeric_limits<int>::max() - kFixtureClientVolumeDispatchIncrement)) {
				throw std::runtime_error("Controlled client-view dispatch state overflow.");
			}

			g_nClientVolumeDispatchState += kFixtureClientVolumeDispatchIncrement;

			if (g_bClientVolumeNativeThrows) {
				throw std::runtime_error("Controlled client-view native failure.");
			}

			g_nClientVolumeDispatchState |= kFixtureClientVolumeDispatched;

			if (pClientEdict == g_pMovementEdict) {
				g_nClientVolumeDispatchState |= kFixtureClientVolumeCurrentEdict;
			}

			if (pViewEntityEdict == &g_ClientViewEdict) {
				g_nClientVolumeDispatchState |= kFixtureClientVolumeValuesMatch;
			}
		}

		void FixtureMovementEngineServer::CrosshairAngle(FixtureMovementEdict* const pClientEdict, const float flPitch, const float flYaw) {
			if (g_nClientVolumeDispatchState > (std::numeric_limits<int>::max() - kFixtureClientVolumeDispatchIncrement)) {
				throw std::runtime_error("Controlled client-crosshair dispatch state overflow.");
			}

			g_nClientVolumeDispatchState += kFixtureClientVolumeDispatchIncrement;

			if (g_bClientVolumeNativeThrows) {
				throw std::runtime_error("Controlled client-crosshair native failure.");
			}

			g_nClientVolumeDispatchState |= kFixtureClientVolumeDispatched;

			if (pClientEdict == g_pMovementEdict) {
				g_nClientVolumeDispatchState |= kFixtureClientVolumeCurrentEdict;
			}

			if ((flPitch == 25.0F) && (flYaw == 0.5F)) {
				g_nClientVolumeDispatchState |= kFixtureClientVolumeValuesMatch;
			}
		}

		FixtureMovementEdict* GetFixtureClientPresentationEdictFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
			const int nEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalValue);

			return (nEntityIndex == kFixtureClientViewEntityIndex) ? &g_ClientViewEdict : GetValidFixtureMovementEdictFromIndex(nEntityIndex);
		}`;
const g_strClientPresentationHandleCapture = AdaptClientPresentation(GetDefinition("GetEntityBaseHandleFromEdictAddress"));
const g_strClientPresentationHandleResolver = AdaptClientPresentation(GetDefinition("GetEntityIndexFromBaseHandleValue"));
const g_strClientPresentationEdictArgument = AdaptClientPresentation(GetDefinition("RequireEngineEdictArgument"));
const g_strClientViewCallback = AdaptClientPresentation(GetDefinition("SetEngineServerClientViewEntityCallback"));
const g_strClientCrosshairCallback = AdaptClientPresentation(GetDefinition("SetEngineServerClientCrosshairAngleCallback"));
const g_strClientPresentationHelpers = [
	g_strClientPresentationSDK,
	g_strClientPresentationHandleCapture,
	g_strClientPresentationHandleResolver,
	g_strClientPresentationEdictArgument,
	g_strClientViewCallback,
	g_strClientCrosshairCallback,
].join("\n\n");

const g_strMovementHelpers = [
	g_strMovementSDK,
	g_strMovementHandleCapture,
	g_strMovementHandleResolver,
	"\t\ttemplate <typename TEngineServer>\n" + AdaptMovementSDK(GetDefinition("NotifyEngineServerSolidMoved")),
	g_strMovementCallback,
	g_strClientVolumeHelpers,
	g_strClientPresentationHelpers,
].join("\n\n");

// Only consumed SDK storage and the allocation-entry primitive are adapted; preserve Kind/diagnostics.
const g_strPVSSnapshotSDK = `		// Exact consumed SDK field spellings, adapted readable storage; no SDK layout/ABI claim.
		struct FixturePVSInformation {
			short m_nHeadNode;
			short m_nClusterCount;
			unsigned short* m_pClusters;
			short m_nAreaNum;
			short m_nAreaNum2;
			float m_vCenter[3];
		};

		constexpr std::size_t kFixturePVSClusterCapacity = static_cast<std::size_t>(std::numeric_limits<short>::max());

		static_assert(kFixturePVSClusterCapacity == 32767, "The controlled PVS count matrix requires a 16-bit signed short.");

		constinit unsigned short g_arrFixturePVSClusters[kFixturePVSClusterCapacity] {};
		// Keep replacement storage readable throughout controlled native mutation.
		constinit unsigned short g_arrFixtureReplacementPVSClusters[] { 99, 98, 97 };
		constinit FixturePVSInformation g_FixturePVSInformation {};
		constinit FixturePVSInformation* g_pFixturePVSInformation = nullptr;
		constinit bool g_bFixturePVSSnapshotAllocationFailure = false;

		std::uint32_t* AllocateFixturePVSSnapshotClusters(const std::size_t unCount) {
			// Deterministic allocation-entry fault, not an allocator/OOM simulation.
			// Reject counts outside the controlled SDK record's signed-short matrix.
			if (g_bFixturePVSSnapshotAllocationFailure || (unCount > kFixturePVSClusterCapacity)) {
				return nullptr;
			}

			return new (std::nothrow) std::uint32_t[unCount];
		}`;
const g_strPVSSnapshotRecord = ReplaceOnce(ReplaceOnce(GetDefinition("MakeEngineServerPVSInformationObject"), "PVSInfo_t* const pBorrowedPVSInformation", "FixturePVSInformation* const pBorrowedPVSInformation"), "PVSInfo_t PVSInformationSnapshot {};", "FixturePVSInformation PVSInformationSnapshot {};");
const g_strPVSSnapshotBody = ReplaceOnce(ReplaceOnce(g_strPVSSnapshotRecord, "decltype(PVSInfo_t::m_pClusters)", "decltype(FixturePVSInformation::m_pClusters)"), "new (std::nothrow) std::uint32_t[unPVSClusterCount]", "AllocateFixturePVSSnapshotClusters(unPVSClusterCount)");
const g_strPVSSnapshotHelpers = [g_strPVSSnapshotSDK, g_strPVSSnapshotBody].join("\n\n");

const g_strPaintMapRLESDK = `		constexpr unsigned int kFixturePaintMapRLEValues[] { 0x01, 0x80000000, 0xFFFFFFFF };
		constinit std::size_t g_unFixturePaintMapRLEGetCalls = 0;

		struct FixturePaintMapEngineServer {
			void GetPaintmapDataRLE(CUtlVector<unsigned int>& vecValuesOut) {
				++g_unFixturePaintMapRLEGetCalls;

				for (auto const& unValue : kFixturePaintMapRLEValues) {
					vecValuesOut.AddToTail(unValue);
				}
			}

			// Compile the loader dependency only; the getter matrix does not exercise it.
			void LoadPaintmapDataRLE(CUtlVector<unsigned int>&) {
			}
		};

		constinit FixturePaintMapEngineServer g_FixturePaintMapEngineServer {};

		FixturePaintMapEngineServer* RequireFixturePaintMapEngineServer(v8::Isolate* const pIsolate, char const* const pszOperationName) {
			if (!pIsolate || !pszOperationName) {
				return nullptr;
			}

			return &g_FixturePaintMapEngineServer;
		}`;
const g_vecPaintMapRLETemplateDefinitions = ["GetEngineServerPaintMapDataRLE", "LoadEngineServerPaintMapDataRLE"].map(strName => {
	const strDefinition = GetDefinition(strName);
	const strHeader = "\t\ttemplate <typename TEngineServer>\n";
	g_Assert(g_strSource.includes(strHeader + strDefinition), "Preserve actual paint-map SDK template: " + strName);

	return strHeader + strDefinition;
});
const g_strPaintMapRLECallback = ReplaceOnce(GetDefinition("GetOrLoadEngineServerPaintMapDataRLECallback"), "RequireEngineServer(pIsolate, pszOperationName)", "RequireFixturePaintMapEngineServer(pIsolate, pszOperationName)");
const g_strPaintMapRLEHelpers = [g_strPaintMapRLESDK, GetEnumerationDefinition("EngineServerPaintMapDataRLEOperation"), GetDefinition("ReadEngineServerPaintMapDataRLEFromValue"), ...g_vecPaintMapRLETemplateDefinitions, g_strPaintMapRLECallback].join("\n\n");

const g_strPickedSentenceSDK = `		constexpr int kFixturePickedSentenceIndex = 17;
		constexpr int kFixtureSentenceSequenceIndex = 23;
		constexpr int kFixtureSentenceSequenceReset = 1;
		constexpr int kFixtureSentenceFailureGroupIndex = -1;
		constexpr int kFixtureSentenceUnterminatedGroupIndex = -2;
		constexpr int kFixtureSentenceFailureIndex = -7;
		constexpr char kFixturePickedSentenceName[] = "FixtureSentence";
		constinit std::size_t g_unFixtureSentencePickCalls = 0;

		struct FixtureSentenceEngineServer {
			int SentenceGroupPick(const int nSentenceGroupIndex, char* const pszSentenceNameOut, const int nSentenceNameCapacity) {
				if (!pszSentenceNameOut || (nSentenceNameCapacity <= 0)) {
					throw std::length_error("Controlled sentence buffer is unavailable.");
				}

				++g_unFixtureSentencePickCalls;

				if (nSentenceGroupIndex == kFixtureSentenceFailureGroupIndex) {
					return kFixtureSentenceFailureIndex;
				}

				if (nSentenceGroupIndex == kFixtureSentenceUnterminatedGroupIndex) {
					std::memset(pszSentenceNameOut, 'X', static_cast<std::size_t>(nSentenceNameCapacity));
					return kFixturePickedSentenceIndex;
				}

				if (static_cast<std::size_t>(nSentenceNameCapacity) < sizeof(kFixturePickedSentenceName)) {
					throw std::length_error("Controlled sentence buffer is too small.");
				}

				std::memcpy(pszSentenceNameOut, kFixturePickedSentenceName, sizeof(kFixturePickedSentenceName));

				return kFixturePickedSentenceIndex;
			}

			int SentenceGroupPickSequential(const int nSentenceGroupIndex, char* const pszSentenceNameOut, const int nSentenceNameCapacity, const int nSentenceIndex, const int nSequenceReset) {
				if ((nSentenceIndex != kFixtureSentenceSequenceIndex) || (nSequenceReset != kFixtureSentenceSequenceReset)) {
					throw std::logic_error("Controlled sentence sequence arguments were not forwarded.");
				}

				return SentenceGroupPick(nSentenceGroupIndex, pszSentenceNameOut, nSentenceNameCapacity);
			}
		};

		constinit FixtureSentenceEngineServer g_FixtureSentenceEngineServer {};

		FixtureSentenceEngineServer* RequireFixtureSentenceEngineServer(v8::Isolate* const pIsolate, char const* const pszOperationName) {
			if (!pIsolate || !pszOperationName) {
				return nullptr;
			}

			return &g_FixtureSentenceEngineServer;
		}`;
const g_strPickedSentenceCallback = ReplaceOnce(GetDefinition("PickEngineServerSentenceFromGroupCallback"), "RequireEngineServer(pIsolate, kOperationName)", "RequireFixtureSentenceEngineServer(pIsolate, kOperationName)");
const g_strSequentialPickedSentenceCallback = ReplaceOnce(GetDefinition("PickSequentialEngineServerSentenceFromGroupCallback"), "RequireEngineServer(pIsolate, kOperationName)", "RequireFixtureSentenceEngineServer(pIsolate, kOperationName)");
const g_strPickedSentenceHelpers = [g_strPickedSentenceSDK, g_strPickedSentenceCallback, g_strSequentialPickedSentenceCallback].join("\n\n");

// Preserve input/full-handle/error logic; adapt only SDK storage, lookup and native method dispatch.
function AdaptClusterSDK(strDefinition) {
	const vecNames = [
		["GetEntityBaseHandleFromEdictAddress", "GetFixtureClusterHandleFromEdict"],
		["GetEntityIndexFromBaseHandleValue", "GetFixtureClusterIndexFromHandle"],
		["GetValidEntityEdictFromIndex", "GetValidFixtureClusterEdictFromIndex"],
		["GetEdictFromEntityIndex", "GetFixtureClusterEdictFromIndex"],
		["RequireEngineServer", "RequireFixtureClusterEngineServer"],
	];
	strDefinition = strDefinition.replace(/\bedict_t\*/g, "FixtureMovementEdict*").replace(/\bPVSInfo_t\*/g, "FixturePVSInformation*").replace(/\bKeyValues\*/g, "FixtureClusterLaunchOptions*");
	for (const vecName of vecNames) {
		strDefinition = strDefinition.replace(new RegExp("\\b" + vecName[0] + "\\b", "g"), vecName[1]);
	}

	return strDefinition;
}

const g_strClusterSDK = `		// Controlled secondary entity, networkable lookup and dispatch; all buffers remain readable.
		constexpr int kFixtureClusterSecondaryIndex = 5;
		constexpr int kFixtureClusterSecondarySerial = 7;
		constexpr std::uint32_t kFixtureClusterCurrentEntity = 0x1;
		constexpr std::uint32_t kFixtureClusterDefaultInformation = 0x2;
		constexpr std::uint32_t kFixtureClusterSecondaryInformation = 0x4;
		constexpr unsigned int kFixtureClusterDispatchShift = 8;
		constexpr int kFixtureEngineVersion = 47;
		constexpr int kFixtureLoadingProgress = 73;
		constexpr int kFixtureUserIDInUse = 41;

		// Only launch-option availability/null semantics are exercised, not KeyValues contents.
		struct FixtureClusterLaunchOptions {};

		struct FixtureClusterEngineServer {
			void BuildEntityClusterList(FixtureMovementEdict* const pEntityEdict, FixturePVSInformation* const pPVSInformation);
			void CleanUpEntityClusterList(FixturePVSInformation* const pPVSInformation);
			int GetServerVersion();
			void MultiplayerEndGame();
			FixtureMovementEdict* CreateFakeClientEx(char const* const pszName, const bool bReportFakeClient);
			FixtureClusterLaunchOptions* GetLaunchOptions();
			bool IsUserIDInUse(const int nUserID);
			int GetLoadingProgressForUserID(const int);
		};

		struct FixtureUnsupportedClusterEngineServer {};
		constinit FixtureMovementHandleEntity g_ClusterSecondaryHandleEntity {};
		constinit FixtureMovementNetworkable g_ClusterSecondaryNetworkable {};
		constinit FixtureMovementEdict g_ClusterSecondaryEdict {};
		constinit unsigned short g_arrClusterSecondaryClusters[] { 44, 55 };
		constinit FixturePVSInformation g_ClusterSecondaryPVSInformation {};
		constinit FixtureClusterEngineServer g_ClusterEngineServer {};
		constinit bool g_bClusterPrimaryPVSAvailable = false;
		constinit bool g_bClusterSecondaryPVSAvailable = false;
		constinit bool g_bClusterSecondaryEdictAvailable = false;
		constinit bool g_bClusterBuildThrows = false;
		constinit bool g_bClusterCleanupThrows = false;
		constinit bool g_bLastFakeClientReported = false;
		constinit std::uint32_t g_unClusterDispatchCalls = 0;
		constinit std::uint32_t g_unClusterDispatchFlags = 0;
		constinit std::uint32_t g_unClusterCleanupCalls = 0;
		constinit std::uint32_t g_unMultiplayerEndCalls = 0;

		FixtureMovementEdict* GetFixtureClusterEdictFromIndex(const int nEntityIndex) {
			if (nEntityIndex == kFixtureClusterSecondaryIndex) {
				return g_bClusterSecondaryEdictAvailable ? &g_ClusterSecondaryEdict : nullptr;
			}

			return GetFixtureMovementEdictFromIndex(nEntityIndex);
		}

		FixtureMovementEdict* GetValidFixtureClusterEdictFromIndex(const int nEntityIndex) {
			auto* const pEdict = GetFixtureClusterEdictFromIndex(nEntityIndex);

			return (pEdict && !pEdict->IsFree()) ? pEdict : nullptr;
		}

		FixturePVSInformation* GetFixtureClusterPVSInformation(FixtureMovementEdict* const pEntityEdict) {
			if (pEntityEdict == &g_ClusterSecondaryEdict) {
				return g_bClusterSecondaryPVSAvailable ? &g_ClusterSecondaryPVSInformation : nullptr;
			}

			if ((pEntityEdict == &g_MovementEdict) || (pEntityEdict == &g_RelocatedMovementEdict)) {
				return g_bClusterPrimaryPVSAvailable ? &g_FixturePVSInformation : nullptr;
			}

			return nullptr;
		}

		void FixtureClusterEngineServer::BuildEntityClusterList(FixtureMovementEdict* const pEntityEdict, FixturePVSInformation* const pPVSInformation) {
			if (g_unClusterDispatchCalls == std::numeric_limits<std::uint32_t>::max()) {
				throw std::runtime_error("Controlled cluster build count overflow.");
			}

			++g_unClusterDispatchCalls;

			if (pEntityEdict == g_pMovementEdict) {
				g_unClusterDispatchFlags |= kFixtureClusterCurrentEntity;
			}

			if (pPVSInformation == &g_FixturePVSInformation) {
				g_unClusterDispatchFlags |= kFixtureClusterDefaultInformation;

			} else if (pPVSInformation == &g_ClusterSecondaryPVSInformation) {
				g_unClusterDispatchFlags |= kFixtureClusterSecondaryInformation;
			}

			if (g_bClusterBuildThrows) {
				throw std::runtime_error("Controlled cluster build failure");
			}
		}

		void FixtureClusterEngineServer::CleanUpEntityClusterList(FixturePVSInformation* const pPVSInformation) {
			Require(pPVSInformation != nullptr, "Controlled cluster cleanup needs a record");

			if (g_unClusterCleanupCalls == std::numeric_limits<std::uint32_t>::max()) {
				throw std::runtime_error("Controlled cluster cleanup count overflow.");
			}

			++g_unClusterCleanupCalls;

			if (g_bClusterCleanupThrows) {
				throw std::runtime_error("Controlled cluster cleanup failure");
			}
		}

		int FixtureClusterEngineServer::GetServerVersion() {
			return kFixtureEngineVersion;
		}

		void FixtureClusterEngineServer::MultiplayerEndGame() {
			if (g_unMultiplayerEndCalls == std::numeric_limits<std::uint32_t>::max()) {
				throw std::runtime_error("Controlled multiplayer end-game count overflow.");
			}

			++g_unMultiplayerEndCalls;
		}

		FixtureMovementEdict* FixtureClusterEngineServer::CreateFakeClientEx(char const* const pszName, const bool bReportFakeClient) {
			Require(pszName && (std::strcmp(pszName, "FixtureBot") == 0), "Controlled fake-client name");
			g_bLastFakeClientReported = bReportFakeClient;

			return g_pMovementEdict;
		}

		FixtureClusterLaunchOptions* FixtureClusterEngineServer::GetLaunchOptions() {
			return nullptr;
		}

		bool FixtureClusterEngineServer::IsUserIDInUse(const int nUserID) {
			return nUserID == kFixtureUserIDInUse;
		}

		int FixtureClusterEngineServer::GetLoadingProgressForUserID(const int) {
			return kFixtureLoadingProgress;
		}

		FixtureClusterEngineServer* RequireFixtureClusterEngineServer(v8::Isolate*, char const*) {
			return &g_ClusterEngineServer;
		}`;
const g_strClusterHandleCapture = AdaptClusterSDK(GetDefinition("GetEntityBaseHandleFromEdictAddress"));
const g_strClusterHandleResolver = AdaptClusterSDK(GetDefinition("GetEntityIndexFromBaseHandleValue"));
const g_strClusterPVSGetter = ReplaceOnce(AdaptClusterSDK(GetDefinition("GetEngineServerPVSInformationFromEntity")), "return pServerNetworkable->GetPVSInfo();", "return GetFixtureClusterPVSInformation(pEntityEdict);");
const g_strClusterCallback = AdaptClusterSDK(GetDefinition("BuildEngineServerEntityClusterListCallback"));
const g_strClusterFakeClient = AdaptClusterSDK(GetDefinition("CreateEngineServerFakeClientWithOptions"));
const g_strClusterHelpers = [
	g_strClusterSDK,
	g_strClusterHandleCapture,
	g_strClusterHandleResolver,
	g_strClusterPVSGetter,
	AdaptClusterSDK(GetDefinition("RequireEngineServerPVSInformationFromValue")),
	...["BuildEngineServerEntityClusterList", "CleanupEngineServerEntityClusterList", "GetEngineServerVersion", "EndEngineServerMultiplayerGame", "GetEngineServerLaunchOptions", "IsEngineServerUserIDInUse", "GetEngineServerLoadingProgressForUserID"].map(strName => "\t\ttemplate <typename TEngineServer>\n" + AdaptClusterSDK(GetDefinition(strName))),
	"\t\ttemplate <typename TEngineServer>\n" + g_strClusterFakeClient,
	"#define SOURCEJS_HAS_SERVER_NETWORKABLE 1",
	g_strClusterCallback,
	AdaptClusterSDK(GetDefinition("CleanupEngineServerEntityClusterListCallback")),
	"#undef SOURCEJS_HAS_SERVER_NETWORKABLE",
].join("\n\n");

const g_strDatamapBaseResolver = ReplaceOnce(GetDefinition("ResolveEntityDatamapsBaseEntityFromValue"), "GetBaseEntityFromValue(pIsolate, LocalContext, LocalEntityValue)", "GetFixtureDatamapBaseEntityValue(pIsolate, LocalContext, LocalEntityValue)");

// Adapt controlled SDK enumerators and feature availability; execute the actual installer and factory bodies.
const g_vecMapLoadTypeConstants = [
	["MapLoad_NewGame", "kFixtureMapLoadNewGame", 0],
	["MapLoad_LoadGame", "kFixtureMapLoadLoadGame", 1],
	["MapLoad_Transition", "kFixtureMapLoadTransition", 2],
	["MapLoad_Background", "kFixtureMapLoadBackground", 3],
];
const g_strMapLoadTypeInstaller = g_vecMapLoadTypeConstants.reduce((strBody, vecConstant) => ReplaceOnce(strBody, vecConstant[0], vecConstant[1]), GetDefinition("InstallMapLoadTypeConstants"));
const g_vecMapLoadConstantWriteMutations = [
	["SetRecordProperty(pIsolate, LocalContext, LocalMapLoadTypeObject, kNewGamePropertyName, v8::Integer::New(pIsolate, kFixtureMapLoadNewGame))", "SetInteger(pIsolate, LocalContext, LocalMapLoadTypeObject, kNewGamePropertyName, kFixtureMapLoadNewGame)"],
	["SetRecordProperty(pIsolate, LocalContext, LocalMapLoadTypeObject, kLoadGamePropertyName, v8::Integer::New(pIsolate, kFixtureMapLoadLoadGame))", "SetInteger(pIsolate, LocalContext, LocalMapLoadTypeObject, kLoadGamePropertyName, kFixtureMapLoadLoadGame)"],
	["SetRecordProperty(pIsolate, LocalContext, LocalMapLoadTypeObject, kTransitionPropertyName, v8::Integer::New(pIsolate, kFixtureMapLoadTransition))", "SetInteger(pIsolate, LocalContext, LocalMapLoadTypeObject, kTransitionPropertyName, kFixtureMapLoadTransition)"],
	["SetRecordProperty(pIsolate, LocalContext, LocalMapLoadTypeObject, kBackgroundPropertyName, v8::Integer::New(pIsolate, kFixtureMapLoadBackground))", "SetInteger(pIsolate, LocalContext, LocalMapLoadTypeObject, kBackgroundPropertyName, kFixtureMapLoadBackground)"],
];

const g_vecQueryCVarStatusWriteMutations = [
	["SetRecordProperty(pIsolate, LocalContext, LocalQueryCVarStatusObject, kQueryCVarSuccessPropertyName, v8::Integer::New(pIsolate, kFixtureQueryCVarSuccess))", "SetInteger(pIsolate, LocalContext, LocalQueryCVarStatusObject, kQueryCVarSuccessPropertyName, kFixtureQueryCVarSuccess)"],
	["SetRecordProperty(pIsolate, LocalContext, LocalQueryCVarStatusObject, kQueryCVarNotFoundPropertyName, v8::Integer::New(pIsolate, kFixtureQueryCVarNotFound))", "SetInteger(pIsolate, LocalContext, LocalQueryCVarStatusObject, kQueryCVarNotFoundPropertyName, kFixtureQueryCVarNotFound)"],
	["SetRecordProperty(pIsolate, LocalContext, LocalQueryCVarStatusObject, kQueryCVarInvalidPropertyName, v8::Integer::New(pIsolate, kFixtureQueryCVarInvalid))", "SetInteger(pIsolate, LocalContext, LocalQueryCVarStatusObject, kQueryCVarInvalidPropertyName, kFixtureQueryCVarInvalid)"],
	["SetRecordProperty(pIsolate, LocalContext, LocalQueryCVarStatusObject, kQueryCVarProtectedPropertyName, v8::Integer::New(pIsolate, kFixtureQueryCVarProtected))", "SetInteger(pIsolate, LocalContext, LocalQueryCVarStatusObject, kQueryCVarProtectedPropertyName, kFixtureQueryCVarProtected)"],
];

const g_vecQueryCVarStatusConstants = [
	["eQueryCvarValueStatus_ValueIntact", "kFixtureQueryCVarSuccess", 0],
	["eQueryCvarValueStatus_CvarNotFound", "kFixtureQueryCVarNotFound", 1],
	["eQueryCvarValueStatus_NotACvar", "kFixtureQueryCVarInvalid", 2],
	["eQueryCvarValueStatus_CvarProtected", "kFixtureQueryCVarProtected", 3],
];

const g_strServerConstantsCallback = g_vecQueryCVarStatusConstants.reduce((strBody, vecConstant) => ReplaceOnce(strBody, vecConstant[0], vecConstant[1]), GetDefinition("GetEngineServerConstantsCallback").replaceAll("SOURCEJS_HAS_QUERY_CVAR_STATUS", "SOURCEJS_FIXTURE_HAS_QUERY_CVAR_STATUS"));
const g_strServerConstantsHelpers = [
	"// Controlled optional SDK enum support; keep the actual callback branches.\n#define SOURCEJS_FIXTURE_HAS_QUERY_CVAR_STATUS",
	"#if defined(SOURCEJS_FIXTURE_HAS_QUERY_CVAR_STATUS)\n\t\tconstexpr bool kFixtureHasQueryCVarStatus = true;\n" + g_vecQueryCVarStatusConstants.map(vecConstant => "\t\tconstexpr int " + vecConstant[1] + " = " + vecConstant[2] + ";").join("\n") + "\n#else\n\t\tconstexpr bool kFixtureHasQueryCVarStatus = false;\n#endif // defined(SOURCEJS_FIXTURE_HAS_QUERY_CVAR_STATUS)",
	g_strServerConstantsCallback,
	"#undef SOURCEJS_FIXTURE_HAS_QUERY_CVAR_STATUS",
].join("\n\n");
const g_strMapLoadTypeHelpers = g_vecMapLoadTypeConstants.map(vecConstant => "\t\tconstexpr int " + vecConstant[1] + " = " + vecConstant[2] + ";").join("\n") + "\n\n" + g_strMapLoadTypeInstaller + "\n\n" + g_strServerConstantsHelpers;

// Registration-only SDK adapters; actual factories, installers and unwind owners execute.
const g_nGlobalsTraitsBegin = g_strSource.indexOf("\t\ttemplate <typename TGlobalVariables>\n\t\tconstexpr bool kSDKHasGlobalAbsoluteFrameStartTimeStandardDeviation");
const g_nGlobalsTraitsEnd = g_strSource.indexOf("\t\ttemplate <typename TGlobalVariables>\n\t\tbool ReadGlobalVariablesAbsoluteFrameStartTimeStandardDeviation", g_nGlobalsTraitsBegin);
g_Assert((g_nGlobalsTraitsBegin >= 0) && (g_nGlobalsTraitsEnd > g_nGlobalsTraitsBegin), "Locate actual globals capability traits.");
const g_strOriginalGlobalsPropertyInstaller = GetDefinition("InstallGlobalVariablesInformationProperty");
g_Assert.equal([...g_strOriginalGlobalsPropertyInstaller.matchAll(/\bGetGlobalVariablesInformationPropertyCallback\b/g)].length, 2, "Adapt only the two SDK read callback registrations.");
g_Assert.equal([...g_strOriginalGlobalsPropertyInstaller.matchAll(/\bSetGlobalVariablesInformationPropertyValueCallback\b/g)].length, 1, "Adapt only the SDK write callback registration.");
const g_strGlobalsPropertyInstaller = g_strOriginalGlobalsPropertyInstaller.replace(/\bGetGlobalVariablesInformationPropertyCallback\b/g, "FixtureGlobalRegistrationCallbacks::Read").replace(/\bSetGlobalVariablesInformationPropertyValueCallback\b/g, "FixtureGlobalRegistrationCallbacks::Write");
const g_strOriginalGlobalsObjectFactory = GetDefinition("MakeGlobalVariablesInformationObject");
g_Assert(g_strOriginalGlobalsObjectFactory.includes("<CGlobalVars>"), "Locate actual globals registration capability checks.");
const g_strGlobalsObjectFactory = ["IsGlobalVariablesRemoteClientCallback", "IsGlobalVariablesClientCallback", "GetGlobalVariablesNetworkBaseCallback"].reduce((strBody, strName) => ReplaceOnce(strBody, strName, "FixtureGlobalRegistrationCallbacks::UnavailableMethod"), g_strOriginalGlobalsObjectFactory.replaceAll("<CGlobalVars>", "<FixtureGlobalRegistrationCapabilities>"));
const g_vecMessageInstallationConstants = [
	"HUD_PRINTNOTIFY",
	"HUD_PRINTCONSOLE",
	"HUD_PRINTTALK",
	"HUD_PRINTCENTER",
	"SHAKE_START",
	"SHAKE_STOP",
	"SHAKE_AMPLITUDE",
	"SHAKE_FREQUENCY",
	"SHAKE_START_RUMBLEONLY",
	"SHAKE_START_NORUMBLE",
	"FFADE_IN",
	"FFADE_OUT",
	"FFADE_MODULATE",
	"FFADE_STAYOUT",
	"FFADE_PURGE",
	"SCREENFADE_FRACBITS",
	"DIALOG_MSG",
	"DIALOG_MENU",
	"DIALOG_TEXT",
	"DIALOG_ENTRY",
	"DIALOG_ASKCONNECT",
];
function AdaptMessageInstallationConstants(strBody) {
	for (const [unIndex, strConstant] of g_vecMessageInstallationConstants.entries()) {
		const Pattern = new RegExp("\\b" + strConstant + "\\b", "g");
		const unMatches = [...strBody.matchAll(Pattern)].length;
		g_Assert(unMatches <= 1, "Unique controlled SDK constant: " + strConstant);
		strBody = strBody.replace(Pattern, "kFixtureMessageConstant" + unIndex);
	}

	return strBody;
}

const g_vecMessageInstallationCallbacks = ["GetMessagesBaseMessageConstantsCallback", "GetMessagesDialogTypesCallback"].map(strName => AdaptMessageInstallationConstants(GetDefinition(strName)));
const g_strMessagePlayerResolver = GetDefinition("RequireMessagePlayerEdict");
// Controlled recipient/buffer storage; preserve actual callback and factory logic.
const g_strMessageHookOptionsFactory = GetDefinition("MakeMessagesHookOptions");
const g_strMessageRecipientFactory = ReplaceOnce(ReplaceOnce(GetDefinition("GetMessagesBitBufferRecipientFilterCallback"), "static_cast<IRecipientFilter*>", "static_cast<FixtureMessageRecipientFilter*>"), "v8::Object::New(pIsolate)", "CreateFixtureMessageSnapshotObject(pIsolate)");
const g_strMessageBitBufferFactory = ReplaceOnce(ReplaceOnce(GetDefinition("GetMessagesBitBufferStateCallback"), "static_cast<bf_write*>", "static_cast<FixtureMessageBitBuffer*>"), "MakeFilesystemByteArrayValue(", "MakeFixtureMessageByteSnapshot(");
const g_strUserMessageBitWriter = ReplaceOnce(GetDefinition("WriteUserMessageBits"), "bf_write* const pBitBuffer", "FixtureUserMessageBitWriter* const pBitBuffer");
const g_strMessageIndexCallback = ReplaceOnce(ReplaceOnce(GetDefinition("GetMessagesMessageIndexCallback"), "RequireServerGameDLL(", "RequireFixtureMessageServer("), "FindUserMessageType(", "FindFixtureMessageType(");
const g_strMessagePropertyReader = GetDefinition("GetMessagesObjectValue");
const g_strProtobufRecipientFactory = ReplaceOnce(ReplaceOnce(GetDefinition("GetMessagesProtobufRecipientFilterCallback"), "static_cast<IRecipientFilter*>", "static_cast<FixtureMessageRecipientFilter*>"), "v8::Array::New(pIsolate, nRecipientCount)", "CreateFixtureMessageSnapshotArray(pIsolate, nRecipientCount)");
const g_strProtobufMethodInstaller = ReplaceOnce(GetDefinition("AddMessagesProtobufMethod"), "google::protobuf::Message* const pProtobufMessage", "FixtureProtobufMessage* const pProtobufMessage");
const g_strProtobufMessageFactory = ReplaceOnce(GetDefinition("MakeMessagesProtobufMessageObject"), "google::protobuf::Message* const pProtobufMessage", "FixtureProtobufMessage* const pProtobufMessage");
const g_unProtobufMethodCount = [...g_strProtobufMessageFactory.matchAll(/^\t+"[A-Za-z0-9]+",$/gm)].length;
g_Assert(g_unProtobufMethodCount > 0, "Locate every actual protobuf adapter method.");

// Execute the exact Parse branch; only its message backend is controlled.
const g_strProtobufDispatch = GetDefinition("HandleMessagesProtobufMethodCallback");
const g_strProtobufParseHeader = '\t\t\t\tif (strMethodOperation == "Parse") {';
const g_nProtobufParseBegin = g_strProtobufDispatch.indexOf(g_strProtobufParseHeader);
const g_nProtobufParseEnd = g_strProtobufDispatch.indexOf("\n\t\t\t\t}", g_nProtobufParseBegin);
g_Assert((g_nProtobufParseBegin >= 0) && (g_nProtobufParseEnd > g_nProtobufParseBegin), "Locate the complete actual protobuf Parse branch.");
const g_strProtobufParseBranch = g_strProtobufDispatch.slice(g_nProtobufParseBegin, g_nProtobufParseEnd + "\n\t\t\t\t}".length);
const g_vecProtobufParseConstants = ["kNativeExceptionErrorMessage", "kFirstArgumentIndex", "kRequiredArgumentCount", "kMaximumProtobufParseByteCount", "kParseErrorMessage"].map(strName => {
	const vecMatch = new RegExp("^\\t+constexpr [^\\n]*\\b" + strName + "[^\\n]*;$", "m").exec(g_strProtobufDispatch);
	g_Assert(vecMatch, "Preserve actual protobuf Parse constant: " + strName);

	return vecMatch[0].trim();
});
const g_strProtobufParseProbe = `		void ParseFixtureProtobufMessageCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
${g_vecProtobufParseConstants.map(strLine => "\t\t\t" + strLine).join("\n")}

			auto* const pIsolate = CallbackInformation.GetIsolate();

			try {
				auto* const pMessage = &g_FixtureProtobufMessage;
				std::string const strMethodOperation = ValueToString(pIsolate, CallbackInformation.Data());
${g_strProtobufParseBranch}
			} catch (...) {
				ThrowError(pIsolate, kNativeExceptionErrorMessage);
			}
		}`;
// Run actual index helpers and numeric/enum conversion, lookup and revalidation prologues.
// Only receiver/field lookup, operation selection and SDK storage/dispatch are adapted.
function AdaptRepeatedDefinition(strName) {
	return GetDefinition(strName).replaceAll("google::protobuf::Message*", "FixtureRepeatedMessage*").replaceAll("google::protobuf::FieldDescriptor const*", "FixtureRepeatedField const*");
}

const g_strRepeatedIndexHelpers = [AdaptRepeatedDefinition("ValidateMessagesProtobufRepeatedIndex"), AdaptRepeatedDefinition("RequireMessagesProtobufRepeatedIndex"), GetDefinition("GetMessagesFloatFromValue"), GetDefinition("GetMessagesNumberFromValue")].join("\n\n");
const g_vecRepeatedNumericTypes = [
	{ Name: "Int32", Enum: "INT32", Value: "nFieldValue" },
	{ Name: "UInt32", Enum: "UINT32", Value: "unFieldValue" },
	{ Name: "Float", Enum: "FLOAT", Value: "flFieldValue" },
	{ Name: "Double", Enum: "DOUBLE", Value: "dblFieldValue" },
	{ Name: "Enum", Enum: "ENUM", Value: "pEnumValueDescriptor" },
];
const g_strRepeatedNumericGuard = "\t\t\t\tif (bIsRepeatedFieldOperation && !bIsAddOperation && !ValidateMessagesProtobufRepeatedIndex(pIsolate, pMessage, pField, nRepeatedFieldIndex)) {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n";
const g_vecRepeatedNumericProbes = g_vecRepeatedNumericTypes.map(Type => {
	const strHeader = "\n\t\t\t\t" + ((Type.Enum === "INT32") ? "if" : "} else if") + " (FieldType == google::protobuf::FieldDescriptor::CPPTYPE_" + Type.Enum + ") {";
	const nValueArgument = g_strProtobufDispatch.indexOf("v8::Local<v8::Value> const LocalFieldValue = CallbackInformation[nFieldValueArgumentIndex];");
	const nHeader = g_strProtobufDispatch.indexOf(strHeader, nValueArgument);
	g_Assert((nValueArgument >= 0) && (nHeader > nValueArgument), "Locate the actual numeric write branch: " + Type.Name);
	const unBodyBegin = nHeader + strHeader.length + 1;
	const nBodyEnd = g_strProtobufDispatch.indexOf("\n\n\t\t\t\t\tif (bIsAddOperation) {", unBodyBegin);
	g_Assert(nBodyEnd > unBodyBegin, "Locate conversion and post-coercion guard before SDK dispatch: " + Type.Name);
	const strPrologue = g_strProtobufDispatch.slice(unBodyBegin, nBodyEnd).replace(/^\t/gm, "");
	g_Assert.equal((strPrologue + "\n\n").split(g_strRepeatedNumericGuard).length, 2, "Preserve one actual post-coercion guard: " + Type.Name);
	const vecConstantNames = ["kNativeExceptionErrorMessage", "kScalarValueArgumentIndex", "kRepeatedValueArgumentIndex", "kFieldValueErrorMessage", "k" + Type.Name + "FieldValueErrorMessage"];
	if (Type.Name === "Enum") {
		vecConstantNames.push("kUndeclaredEnumFieldValueErrorMessage");
	}

	const vecConstants = vecConstantNames.map(strName => {
		const vecMatch = new RegExp("^\\t+constexpr [^\\n]*\\b" + strName + "[^\\n]*;$", "m").exec(g_strProtobufDispatch);
		g_Assert(vecMatch, "Preserve actual numeric callback constant: " + strName);

		return "\t\t\t" + vecMatch[0].trim();
	});

	return `		void WriteFixtureNumeric${Type.Name}Callback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
${vecConstants.join("\n")}
			constexpr int kMaximumWriteMode = static_cast<int>(FixtureRepeatedWriteMode::SetScalar);
			constexpr char kModeErrorMessage[] = "Invalid controlled numeric-write mode.";

			auto* const pIsolate = CallbackInformation.GetIsolate();
			if (!pIsolate) {
				return;
			}

			try {
				v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
				if (LocalContext.IsEmpty()) {
					return;
				}

				if (!CallbackInformation.Data()->IsInt32()) {
					ThrowError(pIsolate, kModeErrorMessage);
					return;
				}

				const int nWriteMode = CallbackInformation.Data().As<v8::Int32>()->Value();
				if ((nWriteMode < 0) || (nWriteMode > kMaximumWriteMode)) {
					ThrowError(pIsolate, kModeErrorMessage);
					return;
				}

				auto* const pMessage = &g_FixtureRepeatedMessage;
				auto const* const pField = &g_FixtureRepeatedField;
				auto const* const pReflection = pMessage->GetReflection();
				const bool bIsAddOperation = nWriteMode == static_cast<int>(FixtureRepeatedWriteMode::Add);
				const bool bIsRepeatedFieldOperation = nWriteMode != static_cast<int>(FixtureRepeatedWriteMode::SetScalar);
				int nRepeatedFieldIndex = -1;
				if (bIsRepeatedFieldOperation && !bIsAddOperation && !RequireMessagesProtobufRepeatedIndex(CallbackInformation, pMessage, pField, nRepeatedFieldIndex)) {
					return;
				}

				const int nFieldValueArgumentIndex = (bIsRepeatedFieldOperation && !bIsAddOperation) ? kRepeatedValueArgumentIndex : kScalarValueArgumentIndex;
				if (CallbackInformation.Length() <= nFieldValueArgumentIndex) {
					ThrowError(pIsolate, kFieldValueErrorMessage);
					return;
				}

				v8::Local<v8::Value> const LocalFieldValue = CallbackInformation[nFieldValueArgumentIndex];
				if (LocalFieldValue.IsEmpty()) {
					ThrowError(pIsolate, kFieldValueErrorMessage);
					return;
				}

${strPrologue}

				if (bIsAddOperation) {
					pReflection->Add${Type.Name}(pMessage, pField, ${Type.Value});
				} else if (bIsRepeatedFieldOperation) {
					pReflection->SetRepeated${Type.Name}(pMessage, pField, nRepeatedFieldIndex, ${Type.Value});
				} else {
					pReflection->Set${Type.Name}(pMessage, pField, ${Type.Value});
				}

				CallbackInformation.GetReturnValue().Set(true);
			} catch (...) {
				ThrowError(pIsolate, kNativeExceptionErrorMessage);
			}
		}`;
});

const g_vecMessageParserOwners = [g_strMessagePropertyReader, g_strProtobufRecipientFactory, g_strProtobufMessageFactory, g_strProtobufParseProbe];
const g_vecSenderProbes = ["SendMessagesSayTextMessageCallback", "SendMessagesSayText2MessageCallback"].map((strName, unIndex) => {
	const strDefinition = GetDefinition(strName);
	const strHeader = "\t\t\t\tif (CallbackInformation.Length() > kSenderIndexArgumentIndex) {";
	const nBegin = strDefinition.indexOf(strHeader);
	const nEnd = strDefinition.indexOf("\n\t\t\t\t}", nBegin);
	g_Assert((nBegin >= 0) && (nEnd > nBegin), "Locate the complete actual sender extraction.");
	const strArgumentError = (unIndex === 0) ? "kSendSayTextMessageArgumentsErrorMessage" : "kSendSayText2MessageArgumentsErrorMessage";

	return `		void ReadFixtureMessageSender${unIndex}(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
${GetFixtureConstants(strDefinition, ["kNativeExceptionErrorMessage", "kSenderIndexArgumentIndex", "kDefaultSenderIndex", strArgumentError])}

			auto* const pIsolate = CallbackInformation.GetIsolate();

			try {
				v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
				int nSenderIndex = kDefaultSenderIndex;
${strDefinition.slice(nBegin, nEnd + "\n\t\t\t\t}".length)}

				CallbackInformation.GetReturnValue().Set(nSenderIndex);
			} catch (...) {
				ThrowError(pIsolate, kNativeExceptionErrorMessage);
			}
		}`;
});
const g_strColorArrayReader = ReplaceOnce(GetDefinition("GetMessagesColorArrayComponent"), "LocalColorArray->Get(LocalContext, unColorComponentIndex)", "ReadFixtureMessageColorArrayValue(LocalContext, LocalColorArray, unColorComponentIndex)");
const g_strColorObjectReader = ReplaceOnce(GetDefinition("GetMessagesColorObjectComponent"), "LocalColorObject->Get(LocalContext, LocalColorComponentPropertyName)", "ReadFixtureMessageColorObjectValue(LocalContext, LocalColorObject, LocalColorComponentPropertyName)");
const g_strRawSendCallback = GetDefinition("SendMessagesUserMessageCallback");
const g_strRawNameDeclaration = "\t\t\t\tstd::string const strUserMessageName = ValueToString(pIsolate, LocalUserMessageNameValue);";
const g_vecRawNameProbes = [...g_strRawSendCallback.matchAll(new RegExp(g_strRawNameDeclaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].map((vecMatch, unIndex) => {
	const nEnd = g_strRawSendCallback.indexOf("\n\t\t\t\t}", g_strRawSendCallback.indexOf("const int nUserMessageType = RequireUserMessageType(", vecMatch.index));
	g_Assert(nEnd > vecMatch.index, "Locate actual raw-message name validation and lookup.");
	const vecConstants = ["kNativeExceptionErrorMessage", "kEmbeddedNullMessageNameErrorMessage", "kSendUserMessageAPIName"];
	if (unIndex === 0) {
		vecConstants.push("kUserMessageNameErrorMessage");
	}

	return `		void LookupFixtureRawMessageName${unIndex}(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
${GetFixtureConstants(g_strRawSendCallback, vecConstants)}

			auto* const pIsolate = CallbackInformation.GetIsolate();

			try {
				v8::Local<v8::Value> const LocalUserMessageNameValue = CallbackInformation[0];
${g_strRawSendCallback.slice(vecMatch.index, nEnd + "\n\t\t\t\t}".length)}

				CallbackInformation.GetReturnValue().Set(nUserMessageType);
			} catch (...) {
				ThrowError(pIsolate, kNativeExceptionErrorMessage);
			}
		}`;
});
g_Assert.equal(g_vecRawNameProbes.length, 2, "Retain both raw-message backend name guards.");
const g_nMessageScopeBegin = g_strSource.indexOf("\t\t// Attempts to end a successfully begun bitbuffer message once");
const g_nMessageScopeEnd = g_strSource.indexOf("\n#endif // defined(SOURCEJS_HAS_RECIPIENT_FILTER) && defined(SOURCEJS_USERMESSAGE_CAN_WRITE_SAYTEXT)", g_nMessageScopeBegin);
g_Assert((g_nMessageScopeBegin >= 0) && (g_nMessageScopeEnd > g_nMessageScopeBegin), "Locate the actual RAII message owner.");
const g_strMessageScope = g_strSource.slice(g_nMessageScopeBegin, g_nMessageScopeEnd);
const g_vecChatReadOwners = [...g_vecSenderProbes, g_strColorArrayReader, g_strColorObjectReader];
const g_vecInstallationOwners = [g_strGlobalsObjectFactory, g_strMessagePlayerResolver, ...g_vecMessageInstallationCallbacks, g_strMessageHookOptionsFactory, g_strMessageRecipientFactory, g_strMessageBitBufferFactory];
// Controlled construction-entry mutation probes, not allocator/OOM/GC behavior.
const g_strMessageSnapshotEntryHelpers = [
	"\t\tv8::Local<v8::Array> CreateFixtureMessageSnapshotArray(v8::Isolate* const pIsolate, const int nLength) {",
	"\t\tv8::Local<v8::Array> const LocalArray = v8::Array::New(pIsolate, nLength);",
	"\t\t\tif (!LocalArray.IsEmpty() && g_bFixtureMessageSnapshotEntryMutation) {",
	"\t\t\t\tg_bFixtureMessageSnapshotEntryMutation = false;",
	"\t\t\t\tMutateFixtureMessageSnapshotStorage();",
	"\t\t\t}",
	"",
	"\t\t\treturn LocalArray;",
	"\t\t}",
	"",
	"\t\tv8::Local<v8::Object> CreateFixtureMessageSnapshotObject(v8::Isolate* const pIsolate) {",
	"\t\t\tv8::Local<v8::Object> const LocalObject = v8::Object::New(pIsolate);",
	"\t\t\tif (!LocalObject.IsEmpty() && g_bFixtureMessageSnapshotEntryMutation) {",
	"\t\t\t\tg_bFixtureMessageSnapshotEntryMutation = false;",
	"\t\t\t\tMutateFixtureMessageSnapshotStorage();",
	"\t\t\t}",
	"",
	"\t\t\treturn LocalObject;",
	"\t\t}",
	"",
	"\t\tv8::Local<v8::Value> MakeFixtureMessageByteSnapshot(v8::Isolate* const pIsolate, char const* const pchByteData, const std::size_t unSize) {",
	"\t\t\tv8::Local<v8::Value> const LocalBytes = MakeFilesystemByteArrayValue(pIsolate, pchByteData, unSize);",
	"\t\t\tif (!LocalBytes.IsEmpty() && g_bFixtureMessageSnapshotEntryMutation) {",
	"\t\t\t\tg_bFixtureMessageSnapshotEntryMutation = false;",
	"\t\t\t\tMutateFixtureMessageSnapshotStorage();",
	"\t\t\t}",
	"",
	"\t\t\treturn LocalBytes;",
	"\t\t}",
].join("\n");

// Only compile-time SDK member availability is adapted; actual registration bodies execute.
const g_strGlobalsRegistrationCapabilities = [
	"\t\tstruct FixtureGlobalRegistrationCapabilities {",
	"#if !defined(SOURCEJS_FIXTURE_NO_GLOBAL_METHODS)",
	"\t\t\tbool IsClient() {",
	"\t\t\t\treturn false;",
	"\t\t\t}",
	"",
	"\t\t\tbool IsRemoteClient() {",
	"\t\t\t\treturn false;",
	"\t\t\t}",
	"",
	"\t\t\tint GetNetworkBase(int, int) {",
	"\t\t\t\treturn 0;",
	"\t\t\t}",
	"#endif",
	"\t\t};",
	"",
	"#if defined(SOURCEJS_FIXTURE_NO_GLOBAL_METHODS)",
	"\t\tconstexpr bool kFixtureGlobalsHaveMethods = false;",
	"#else",
	"\t\tconstexpr bool kFixtureGlobalsHaveMethods = true;",
	"#endif",
	"#undef SOURCEJS_FIXTURE_NO_GLOBAL_METHODS",
].join("\n");
const g_strInstallationHelpers = [
	g_strGlobalsRegistrationCapabilities,
	g_strMessageSnapshotEntryHelpers,
	GetEnumerationDefinition("GlobalsInformationProperty"),
	g_strSource.slice(g_nGlobalsTraitsBegin, g_nGlobalsTraitsEnd),
	GetDefinition("RethrowV8InstallationFailure"),
	GetDefinition("IsGlobalVariablesInformationPropertyWritable"),
	g_strGlobalsPropertyInstaller,
	"// Controlled SDK branch label; optional SDK members are absent in the fixture.\n#define SOURCEJS_SDK_BRANCH \"fixture\"",
	g_strGlobalsObjectFactory,
	GetDefinition("GetGlobalVariablesCallback"),
	"#undef SOURCEJS_SDK_BRANCH",
	g_strMessageHookOptionsFactory,
	g_strMessageRecipientFactory,
	"\t\ttemplate <typename TBitBuffer>\n" + GetDefinition("GetMessagesBitBufferCapacityBitCount"),
	g_strMessageBitBufferFactory,
	g_strUserMessageBitWriter,
	g_strMessageIndexCallback,
	g_strMessagePropertyReader,
	g_strProtobufRecipientFactory,
	g_strProtobufMethodInstaller,
	g_strProtobufMessageFactory,
	"\t\tconstexpr std::size_t kFixtureProtobufMethodCount = " + g_unProtobufMethodCount + ";",
	g_strProtobufParseProbe,
	g_strRepeatedIndexHelpers,
	...g_vecRepeatedNumericProbes,
	...g_vecSenderProbes,
	GetDefinition("GetMessagesIntegerFromValue"),
	GetDefinition("GetMessagesColorComponentFromValue"),
	g_strColorArrayReader,
	g_strColorObjectReader,
	ReplaceOnce(ReplaceOnce(GetDefinition("RequireUserMessageType"), "RequireServerGameDLL(", "RequireFixtureMessageServer("), "FindUserMessageType(", "FindFixtureMessageType("),
	...g_vecRawNameProbes,
	g_strMessageScope,
	g_strMessagePlayerResolver,
	"// Controlled distinct enumerators, not deployed SDK numeric values.",
	...Array.from(g_vecMessageInstallationConstants.keys(), unIndex => "\t\tconstexpr int kFixtureMessageConstant" + unIndex + " = " + unIndex + ";"),
	"#define SOURCEJS_HAS_SHAREDDEFS 1\n#define SOURCEJS_HAS_SHAKE_H 1\n#define SOURCEJS_HAS_DIALOG_ASKCONNECT 1",
	...g_vecMessageInstallationCallbacks,
	"#undef SOURCEJS_HAS_DIALOG_ASKCONNECT\n#undef SOURCEJS_HAS_SHAKE_H\n#undef SOURCEJS_HAS_SHAREDDEFS",
].join("\n\n");

function RemoveInstallationUnwindGuard(strBody) {
	const Pattern = /if \((InstallationFailure|PlayerIndexFailure|PropertyFailure|ParseFailure|SenderIndexFailure|ColorComponentFailure)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+\}\n\n\t+throw;/g;
	g_Assert.equal([...strBody.matchAll(Pattern)].length, 1, "Unique native-unwind guard in each installation owner.");

	return strBody.replace(Pattern, "throw;");
}

const g_strPluginSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/SourceJSPlugin.cpp"), "utf8").replace(/\r/g, "");

function GetPluginDefinition(strName) {
	const strSignature = g_strPluginSource.split("\n").find(strLine => strLine.includes("CSourceJSPlugin::" + strName + "(") && strLine.endsWith("{"));
	g_Assert(strSignature, "Find plugin helper: " + strName);
	const unStart = g_strPluginSource.indexOf(strSignature);
	const unEnd = g_strPluginSource.indexOf("\n}\n", unStart);
	g_Assert(unEnd > unStart);

	return g_strPluginSource.slice(unStart, unEnd + 2);
}

const g_strConsoleRegister = g_strPluginSource.includes("bool CSourceJSPlugin::RegisterConsoleVariables(")
	? GetPluginDefinition("RegisterConsoleVariables")
	: "bool CSourceJSPlugin::RegisterConsoleVariables(CreateInterfaceFn const, CreateInterfaceFn const) {\n" + /#ifndef SOURCEJS_OLD_CONSOLE_API\n\t\tif \(!m_bCVarsRegistered\)[\s\S]*?\n#endif/.exec(GetPluginDefinition("Load"))[0].replace(/^\t/gm, "") + "\n\n\treturn true;\n}";
const g_strConsoleUnregister = GetPluginDefinition("UnregisterConsoleVariables").replace("UnregisterConsoleVariables()", "UnregisterConsoleVariables(const bool, const bool)");
const g_strConsoleBootstrap = (g_strConsoleRegister + "\n\n" + g_strConsoleUnregister)
	.replaceAll("SourceJS::g_Application.GetRuntime().IsInitialized()", "g_bConsoleRuntimeInitialized")
	.replaceAll("SourceJS::LogError(", "FixtureConsoleSDK::ReportDiagnostic(")
	.replaceAll("SourceJS::LogWarning(", "FixtureConsoleSDK::ReportDiagnostic(")
	.replaceAll("ConnectTier1Libraries(", "FixtureConsoleSDK::Connect(")
	.replaceAll("ConnectInterfaces(", "FixtureConsoleSDK::Connect(")
	.replaceAll("DisconnectTier1Libraries(", "FixtureConsoleSDK::Disconnect(")
	.replaceAll("DisconnectInterfaces(", "FixtureConsoleSDK::Disconnect(")
	.replaceAll("ConVar_Register(", "FixtureConsoleSDK::Register(")
	.replaceAll("ConVar_Unregister(", "FixtureConsoleSDK::Unregister(");

if (g_strPluginSource.includes("bool CSourceJSPlugin::RegisterConsoleVariables(")) {
	g_Assert(GetPluginDefinition("CSourceJSPlugin").includes("m_bSDKLibrariesConnected = false;"));
	const strLoad = GetPluginDefinition("Load");
	const strUnload = GetPluginDefinition("Unload");
	g_Assert(strLoad.indexOf("RegisterConsoleVariables(InterfaceFactory, GameServerFactory)") < strLoad.indexOf("RegisterConsoleCommands(pEarlyCVar)"));
	g_Assert(strLoad.indexOf("SourceJS::g_Application.Unload();") < strLoad.indexOf("UnregisterConsoleVariables(!bCVarsWereRegistered, !bSDKLibrariesWereConnected)"));
	g_Assert(strUnload.indexOf("SourceJS::g_Application.Unload();") < strUnload.indexOf("UnregisterConsoleVariables();"));
	g_Assert(!GetPluginDefinition("UnregisterConsoleCommands").includes("m_pSourceJSCommand.reset()"), "SDK pending lists retain command objects until module teardown.");
	g_Assert(GetPluginDefinition("RegisterConsoleCommands").includes("if (!m_pSourceJSCommand)"), "Reuse the retained command after rollback/reload.");
}

const g_strMemoryHookHeader = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/MemoryHookManager.h"), "utf8").replace(/\r/g, "");
const g_vecHookTypeDeclarationMatch = /^\ttypedef enum _HOOK_TYPE : int \{[\s\S]*?^\t\} HOOK_TYPE, \*PHOOK_TYPE;/m.exec(g_strMemoryHookHeader);
g_Assert(g_vecHookTypeDeclarationMatch !== null, "Locate the exported hook-type enum in src/sourcejs/MemoryHookManager.h.");
const g_strHookTypeDeclaration = g_vecHookTypeDeclarationMatch[0].split("\n").map(strLine => "\t" + strLine).join("\n");

const g_strBindingRecordHelpers = ["GetCommandReturnNumberCallback", "GetCommandReturnObjectCallback", "InstallCommandReturnBindings", "InstallHookTypeBindings"].map(strName => GetDefinition(strName).replaceAll("CCommand::MaxCommandLength()", "FixtureCommandSDK::MaxCommandLength()")).join("\n\n");

function RenderBindingRecordHelpers(Case) {
	const strProfileBegin = Case.LegacyBindingRecords ? "#if !defined(SOURCEJS_OLD_CONSOLE_API)\n#define SOURCEJS_FIXTURE_OWNS_BINDING_RECORD_CONSOLE_API\n#define SOURCEJS_OLD_CONSOLE_API\n#endif\n" : "";
	const strProfileEnd = Case.LegacyBindingRecords ? "\n#ifdef SOURCEJS_FIXTURE_OWNS_BINDING_RECORD_CONSOLE_API\n#undef SOURCEJS_OLD_CONSOLE_API\n#undef SOURCEJS_FIXTURE_OWNS_BINDING_RECORD_CONSOLE_API\n#endif" : "";
	const strSDKAdapter = "\t\tconstexpr int kFixtureMaximumCommandLength = 1024;\n#ifndef SOURCEJS_OLD_CONSOLE_API\n\t\tconstexpr bool kFixtureLegacyBindingRecords = false;\n\t\tclass FixtureCommandSDK {\n\t\tpublic:\n\t\t\tstatic int MaxCommandLength() {\n\t\t\t\treturn kFixtureMaximumCommandLength;\n\t\t\t}\n\t\t};\n#else\n\t\tconstexpr bool kFixtureLegacyBindingRecords = true;\n#endif\n";

	return strProfileBegin + strSDKAdapter + (Case.BindingRecordsSource ?? g_strBindingRecordHelpers) + strProfileEnd;
}

const g_strEntityHookAndGameDescriptionCallbacks = [
	"ReadDefinedObjectProperty",
	"NormalizeEntityHookEntityOption",
	"ReadEntityHookCreationOptions",
	"ReadEntityHookCallbackOptions",
	"ReadEntityHookVTableOption",
	"CreateEntityHookID",
	"CreateEntityHookCallback",
	"CreateEntityVTableHookCallback",
	"AddPreEntityHookCallback",
	"AddPostEntityHookCallback",
	"GetEngineGameDescriptionCallback",
].map(strName => GetDefinition(strName)
	.replaceAll("g_Application.GetMemoryHookManager()", "GetFixtureMemoryHookManager()")
	.replaceAll("GetEntityBaseEntityFromAddressValue(", "GetFixtureHookEntityFromAddressValue(")
	.replaceAll("RequireServerGameDLL(", "GetFixtureGameDescriptionProvider("))
	.join("\n\n");

const g_strTextMessageCallback = ReplaceOnce(GetDefinition("GetEngineServerTextMessageCallback"), "RequireEngineServer(pIsolate, kOperationName)", "RequireFixtureTextMessageEngine(pIsolate, kOperationName)");
const g_strTextMessageHelpers = [
	GetDefinition("RequireEngineStringArgument"),
	"\t\ttemplate <typename TEngineServer>\n" + GetDefinition("GetEngineServerTextMessage"),
	"\t\ttemplate <std::size_t unColorChannelCount>\n" + GetDefinition("MakeEngineTextMessageColorObject"),
	g_strTextMessageCallback,
].join("\n\n");

const g_strEnginePlayerInformationHelpers = IndentFixtureNamespace([
	"\t\ttemplate <typename TPlayerInformation>\n" + GetDefinition("SetEngineBranchPlayerInformation"),
	"\t\ttemplate <typename TEngineServer>\n" + GetDefinition("GetEngineServerPlayerInformation"),
	GetDefinition("GetEngineServerPlayerInformationCallback"),
].join("\n\n"));

function AdaptTransmitRecordDefinition(strName) {
	let strDefinition = GetDefinition(strName);
	for (const [strBefore, strAfter] of [
		["RequireEngineServer(", "RequireFixtureTransmitRecordEngine("],
		["GetEdictFromEntityIndex(", "GetFixtureTransmitRecordEdict("],
		["GetEntityIndexFromEdictAddress(", "GetFixtureTransmitRecordEdictIndex("],
		["GetEntityClassNameFromEdict(", "GetFixtureTransmitRecordClassName("],
		["CCheckTransmitInfo::", "FixturePreviousCheckTransmitInformation::"],
		["CCheckTransmitInfo const", "FixturePreviousCheckTransmitInformation const"],
		["CCheckTransmitInfo PreviousTransmitInformation", "FixturePreviousCheckTransmitInformation PreviousTransmitInformation"],
		["CSharedEdictChangeInfo*", "FixtureSharedEdictChangeInformation*"],
		["IChangeInfoAccessor*", "FixtureChangeInformationAccessor*"],
		["edict_t", "FixtureTransmitRecordEdict"],
	]) {
		strDefinition = strDefinition.replaceAll(strBefore, strAfter);
	}

	return strDefinition;
}

const g_strTransmitRecordPreviousCallback = AdaptTransmitRecordDefinition("GetEngineServerPreviousCheckTransmitInformationCallback");
const g_strTransmitRecordSharedObject = AdaptTransmitRecordDefinition("MakeEngineServerSharedChangeInformationObject");
const g_strTransmitRecordAccessorCallback = AdaptTransmitRecordDefinition("GetEngineServerEntityChangeAccessorCallback");
const g_strTransmitRecordHelpers = [
	"\t\ttemplate <typename TEngineServer>\n" + AdaptTransmitRecordDefinition("GetEngineServerPreviousCheckTransmitInformation"),
	g_strTransmitRecordPreviousCallback,
	"\t\ttemplate <typename TEngineServer>\n" + AdaptTransmitRecordDefinition("GetEngineServerSharedEdictChangeInformation"),
	"\t\ttemplate <typename TSharedChangeInformation>\n" + g_strTransmitRecordSharedObject,
	"\t\ttemplate <typename TEngineServer>\n" + AdaptTransmitRecordDefinition("GetEngineServerEntityChangeAccessor"),
	AdaptTransmitRecordDefinition("GetEngineServerSharedEdictChangeInformationCallback"),
	g_strTransmitRecordAccessorCallback,
].join("\n\n");

const g_strTransmitSnapshotCallback = ReplaceOnce(GetDefinition("GetEngineServerEntityTransmitBitsForClientCallback"), "RequireEngineServer(pIsolate, kOperationName)", "RequireFixtureTransmitBitsEngine(pIsolate, kOperationName)");
const g_strTransmitBitArray = GetDefinition("MakeEngineEntityIndexArrayFromBitVector");
const g_strTransmitIntegerArray = GetDefinition("MakeEngineIntegerArrayFromBuffer");
const g_strTransmitByteArray = GetDefinition("MakeEngineByteArrayFromBuffer");
const g_strTransmitSnapshotHelpers = [
	"\t\ttemplate <typename TBitVector>\n" + g_strTransmitBitArray,
	"\t\ttemplate <typename TEngineServer>\n" + GetDefinition("GetEngineServerEntityTransmitBitsForClient"),
	g_strTransmitSnapshotCallback,
	g_strTransmitIntegerArray,
	g_strTransmitByteArray,
].join("\n\n");

function AdaptClientKeyValuesDefinition(strDefinition) {
	return strDefinition
		.replaceAll("KeyValues*", "FixtureKeyValuesTransferNode*")
		.replace(/\bKeyValuesRecord\b/g, "FixtureKeyValuesTransferRecord")
		.replaceAll("edict_t*", "FixtureKeyValuesClientEdict*")
		.replaceAll("kInvalidKeyValuesHandle", "kInvalidFixtureKeyValuesHandle")
		.replaceAll("GetKeyValuesHandleFromValueAtDepth", "ReadFixtureKeyValuesTransferHandleAtDepth")
		.replaceAll("GetKeyValuesHandleFromValue", "ReadFixtureKeyValuesTransferHandle")
		.replaceAll("GetKeyValuesRecords", "GetFixtureKeyValuesTransferRecords")
		.replaceAll("RequireCurrentPluginNameForKeyValues", "RequireFixtureKeyValuesPluginName")
		.replaceAll("IsKeyValuesAddressCollected", "IsFixtureKeyValuesTransferAddressCollected")
		.replaceAll("CollectKeyValuesHierarchy", "CollectFixtureKeyValuesTransferHierarchy")
		.replaceAll("GetEntityBaseHandleFromEdictAddress", "ReadFixtureKeyValuesClientHandle")
		.replaceAll("GetEntityIndexFromBaseHandleValue", "ResolveFixtureKeyValuesClientHandle")
		.replaceAll("GetValidEntityEdictFromIndex", "GetFixtureKeyValuesClientEdict")
		.replaceAll("RequirePlayerInformationFromIndex", "RequireFixtureKeyValuesPlayerInformation")
		.replaceAll("RequireEngineServer(pIsolate, kOperationName)", "RequireFixtureClientKeyValuesEngine(pIsolate, kOperationName)");
}

const g_strClientKeyValuesExecution = AdaptClientKeyValuesDefinition(GetDefinition("ExecuteEngineServerClientCommandKeyValues"));
const g_strClientKeyValuesCallback = AdaptClientKeyValuesDefinition(GetDefinition("ExecuteEngineServerClientCommandKeyValuesCallback"));
const g_strClientKeyValuesIdentityGuard = "\t\t\t\tif (!ResolveFixtureKeyValuesClientHandle(ClientHandle, nCurrentClientIndex)) {\n\t\t\t\t\tThrowError(pIsolate, kChangedClientErrorMessage);\n\t\t\t\t\treturn false;\n\t\t\t\t}";
const g_strClientKeyValuesConnectedGuard = "\t\t\t\tif (!pCurrentClientPlayerInformation->IsConnected()) {\n\t\t\t\t\tThrowError(pIsolate, kChangedClientErrorMessage);\n\t\t\t\t\treturn false;\n\t\t\t\t}";
const g_strClientKeyValuesRelease = "\t\t\t\tReleaseKeyValuesOwnershipToEngine(pNativeKeyValues);";
const g_strClientKeyValuesRefreshComment = "\t\t\t\t// Handle getters may disconnect or replace the original client; no ownership has moved yet.";
const g_strClientKeyValuesEarlyCommit = ReplaceOnce(ReplaceOnce(g_strClientKeyValuesExecution, g_strClientKeyValuesRelease + "\n", ""), g_strClientKeyValuesRefreshComment, g_strClientKeyValuesRelease + "\n" + g_strClientKeyValuesRefreshComment);
const g_strClientKeyValuesHelpers = [
	...["GetEntityBaseHandleFromEdictAddress", "GetEntityIndexFromBaseHandleValue", "GetKeyValuesHandleFromValueAtDepth", "GetKeyValuesHandleFromValue", "IsKeyValuesAddressCollected", "CollectKeyValuesHierarchy", "EraseCollectedKeyValuesRecords", "PrepareKeyValuesOwnershipTransfer", "ReleaseKeyValuesOwnershipToEngine"].map(strName => AdaptClientKeyValuesDefinition(GetDefinition(strName))),
	"\t\ttemplate <typename TEngineServer>\n" + g_strClientKeyValuesExecution,
	g_strClientKeyValuesCallback,
].join("\n\n");

function MakeTraceConstantRecordFixture() {
	const strDefinition = GetDefinition("InstallTraceConstants");
	const mapRecords = new Map([
		["LocalTraceTypeObject", "TraceType"],
		["LocalDisplacementFlagsObject", "DisplacementFlags"],
		["LocalSurfaceFlagsObject", "SurfaceFlags"],
		["LocalContentFlagsObject", "ContentFlags"],
		["LocalContentMasksObject", "ContentMasks"],
	]);
	const mapTraceTypes = new Map([["TRACE_EVERYTHING", 0], ["TRACE_WORLD_ONLY", 1], ["TRACE_ENTITIES_ONLY", 2], ["TRACE_EVERYTHING_FILTER_PROPS", 3]]);
	const mapModels = new Map();
	const vecOperations = [];
	let bModernOnly = false;
	for (const strLine of strDefinition.split("\n").map(strValue => strValue.trim())) {
		if (strLine === "#if !defined(SOURCEJS_OLD_CONSOLE_API)") {
			g_Assert(!bModernOnly);
			bModernOnly = true;
			continue;
		}

		if (strLine.startsWith("#endif")) {
			g_Assert(bModernOnly);
			bModernOnly = false;
			continue;
		}

		const vecGlobalMatch = strLine.match(/^SOURCEJS_SET_TRACE_(UNSIGNED|NUMBER)\(([A-Z][A-Z0-9_]+)\);$/);
		const vecRecordMatch = strLine.match(/^SOURCEJS_REQUIRE_TRACE_SET\(.+?LocalContext, (Local\w+), "([^"]+)", (.+)\)\);$/);
		if (!vecGlobalMatch && !vecRecordMatch) {
			g_Assert(!strLine.startsWith("SOURCEJS_SET_TRACE_") && !strLine.startsWith("SOURCEJS_REQUIRE_TRACE_SET("), "Parse every trace constant write: " + strLine);
			continue;
		}

		if (vecRecordMatch && (vecRecordMatch[1] === "LocalTraceModule")) {
			const strRecordTarget = [...mapRecords.keys()].find(strName => vecRecordMatch[3].includes(strName));
			g_Assert(strRecordTarget);
			g_Assert.equal(mapRecords.get(strRecordTarget), vecRecordMatch[2]);
			vecOperations.push({ Target: "", Name: vecRecordMatch[2], Record: true, ModernOnly: bModernOnly });
			continue;
		}

		const vecNames = vecRecordMatch ? [...vecRecordMatch[3].matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map(vecMatch => vecMatch[0]) : [vecGlobalMatch[2]];
		g_Assert.equal(vecNames.length, 1, strLine);
		const strName = vecNames[0];
		const strMacroFamily = vecGlobalMatch ? vecGlobalMatch[1] : "UNSIGNED";
		if (!mapModels.has(strName) && !mapTraceTypes.has(strName)) {
			const unModelIndex = mapModels.size;
			const dblValue = (strMacroFamily === "NUMBER") ? ((strName.startsWith("MIN_") ? -1 : 1) * (100 + unModelIndex + 0.25)) : ((strName === "MASK_ALL") ? 0xFFFFFFFF : ((strName === "CONTENTS_HITBOX") ? 0x80000000 : (0x1000 + unModelIndex)));
			mapModels.set(strName, { Name: strName, MacroFamily: strMacroFamily, Value: dblValue, ModernOnly: bModernOnly });
		}

		if (mapModels.has(strName)) {
			const Model = mapModels.get(strName);
			g_Assert.equal(Model.MacroFamily, strMacroFamily);
			Model.ModernOnly = Model.ModernOnly && bModernOnly;
		}

		const strTarget = vecGlobalMatch ? "" : mapRecords.get(vecRecordMatch[1]);
		g_Assert(vecGlobalMatch || strTarget);
		vecOperations.push({ Target: strTarget, Name: vecGlobalMatch ? strName : vecRecordMatch[2], SDKName: strName, Record: false, ModernOnly: bModernOnly });
	}

	g_Assert(!bModernOnly);
	const MakeExpected = bLegacy => {
		const Root = {};
		const mapValues = new Map([...mapRecords.values()].map(strName => [strName, {}]));
		for (const Operation of vecOperations) {
			if (bLegacy && Operation.ModernOnly) {
				continue;
			}

			if (Operation.Record) {
				Root[Operation.Name] = mapValues.get(Operation.Name);
				continue;
			}

			const Target = Operation.Target ? mapValues.get(Operation.Target) : Root;
			Target[Operation.Name] = mapTraceTypes.has(Operation.SDKName) ? mapTraceTypes.get(Operation.SDKName) : mapModels.get(Operation.SDKName).Value;
		}

		g_Assert([...mapValues.keys()].every(strName => Object.hasOwn(Root, strName)));

		return Root;
	};
	const vecDeclarations = [
		"// Exact SDK spellings with synthetic distinct values: own-property/conversion tests only, not SDK numeric or ABI proof.",
		"#if defined(SOURCEJS_FIXTURE_OLD_CONSOLE_API) && !defined(SOURCEJS_OLD_CONSOLE_API)",
		"#define SOURCEJS_FIXTURE_OWNS_TRACE_CONSTANT_PROFILE 1",
		"#define SOURCEJS_OLD_CONSOLE_API 1",
		"#endif",
		"",
		"\t\tnamespace TraceConstantRecordFixture {",
	];
	for (const Model of mapModels.values()) {
		if (Model.ModernOnly) {
			vecDeclarations.push("#if !defined(SOURCEJS_OLD_CONSOLE_API)");
		}

		const strType = (Model.MacroFamily === "NUMBER") ? "double" : "std::uint32_t";
		const strValue = (Model.MacroFamily === "NUMBER") ? String(Model.Value) : ("0x" + Model.Value.toString(16).toUpperCase().padStart(8, "0"));
		vecDeclarations.push("\t\t\tconstexpr " + strType + " " + Model.Name + " = " + strValue + ";");
		if (Model.ModernOnly) {
			vecDeclarations.push("#endif // !defined(SOURCEJS_OLD_CONSOLE_API)");
		}
	}

	vecDeclarations.push("", "#if defined(SOURCEJS_OLD_CONSOLE_API)", "\t\t\tconstexpr bool kLegacyProfile = true;", "#else", "\t\t\tconstexpr bool kLegacyProfile = false;", "#endif // defined(SOURCEJS_OLD_CONSOLE_API)", "");
	for (const strName of ["SOURCEJS_REQUIRE_TRACE_SET", "SOURCEJS_SET_TRACE_UNSIGNED", "SOURCEJS_SET_TRACE_NUMBER"]) {
		const vecMatches = [...g_strSource.matchAll(new RegExp("^#define " + strName + "\\([^\\n]+$", "gm"))];
		g_Assert.equal(vecMatches.length, 1);
		vecDeclarations.push(vecMatches[0][0]);
	}

	vecDeclarations.push("", strDefinition.split("\n").map(strLine => (strLine && !strLine.startsWith("#")) ? ("\t" + strLine) : strLine).join("\n"), "\t\t} // namespace TraceConstantRecordFixture", "", "#if defined(SOURCEJS_FIXTURE_OWNS_TRACE_CONSTANT_PROFILE)", "#undef SOURCEJS_OLD_CONSOLE_API", "#undef SOURCEJS_FIXTURE_OWNS_TRACE_CONSTANT_PROFILE", "#endif // defined(SOURCEJS_FIXTURE_OWNS_TRACE_CONSTANT_PROFILE)");
	const strContract = String.raw`
(() => {
	const Expected = FixtureTraceConstantsLegacyProfile ? EXPECTED_LEGACY : EXPECTED_CURRENT;
	const vecRecords = [Expected, ...Object.values(Expected).filter(Value => (Value !== null) && (typeof Value === "object"))];
	const vecNames = [...new Set(vecRecords.flatMap(Record => Object.keys(Record)))];
	const mapDescriptors = new Map(vecNames.map(strName => [strName, Object.getOwnPropertyDescriptor(Object.prototype, strName)]));
	let unSetterCalls = 0;
	const CheckRecord = (Actual, ExpectedRecord) => {
		if ((Actual === null) || (typeof Actual !== "object") || (Object.getPrototypeOf(Actual) !== Object.prototype) || (Object.keys(Actual).length !== Object.keys(ExpectedRecord).length)) {
			return false;
		}

		return Object.keys(ExpectedRecord).every(strName => {
			const Descriptor = Object.getOwnPropertyDescriptor(Actual, strName);
			if (!Descriptor || !Object.hasOwn(Descriptor, "value") || !Descriptor.writable || !Descriptor.enumerable || !Descriptor.configurable) {
				return false;
			}

			return (typeof ExpectedRecord[strName] === "object") ? CheckRecord(Descriptor.value, ExpectedRecord[strName]) : Object.is(Descriptor.value, ExpectedRecord[strName]);
		});
	};

	try {
		for (const strName of vecNames) {
			Object.defineProperty(Object.prototype, strName, {
				configurable: true,
				set() {
					++unSetterCalls;
				},
			});
		}

		return CheckRecord(FixtureCreateTraceConstants(), Expected) && (unSetterCalls === 0);
	} finally {
		for (const strName of vecNames) {
			const Descriptor = mapDescriptors.get(strName);
			if (Descriptor === undefined) {
				delete Object.prototype[strName];

			} else {
				Object.defineProperty(Object.prototype, strName, Descriptor);
			}
		}
	}
})()
`.replace("EXPECTED_LEGACY", () => JSON.stringify(MakeExpected(true))).replace("EXPECTED_CURRENT", () => JSON.stringify(MakeExpected(false)));
	g_Assert(!strContract.includes(')SourceJS"'));

	return { Source: vecDeclarations.join("\n"), Contract: strContract };
}

const g_TraceConstantRecordFixture = MakeTraceConstantRecordFixture();

g_Assert.equal(g_strTemplate.split("@TRACE_CONSTANT_OWN_CONTRACT@").length, 2, "Unique trace constant own-property contract placeholder.");

const g_strSoundConstantInstaller = GetDefinition("InstallSoundConstants");
const g_strSoundConstantProfiles = "#if defined(SOURCEJS_FIXTURE_LEGACY_SOUND_CONSTANTS)\n" + g_strSoundConstantInstaller.replaceAll("SetRecordProperty(", "SetValue(") + "\n#else\n" + g_strSoundConstantInstaller + "\n#endif // SOURCEJS_FIXTURE_LEGACY_SOUND_CONSTANTS";
const g_strTraceEntityRecord = GetDefinition("MakeTraceEntityObject");
const g_strTraceEntityRecordProfiles = "#if defined(SOURCEJS_FIXTURE_LEGACY_TRACE_ENTITY_RECORD)\n" + g_strTraceEntityRecord.replaceAll("SetRecordProperty(", "SetValue(") + "\n#else\n" + g_strTraceEntityRecord + "\n#endif // SOURCEJS_FIXTURE_LEGACY_TRACE_ENTITY_RECORD";

const g_strDatamapCallbacks = [
	"#define SOURCEJS_FIXTURE_HAS_DATAMAP_CALLBACKS 1",
	"#if defined(SOURCEJS_HAS_BASE_ENTITY)\n#define SOURCEJS_FIXTURE_HAS_DATAMAP_STRING_POOL 1\n#endif",
	"#if defined(SOURCEJS_FIXTURE_OLD_CONSOLE_API)\n" + GetDefinition("GetBaseEntityFromValue") + "\n#endif // SOURCEJS_FIXTURE_OLD_CONSOLE_API",
	GetDefinition("EntityDatamapsGetTypeDescriptionFromValue"),
	g_strSource.slice(g_nDatamapRecordBegin, g_nDatamapRecordEnd + "\n\t\t};".length),
	GetDefinition("EntityDatamapsFieldInformation"),
	"\t\ttemplate <typename TTypeDescription>\n" + GetDefinition("EntityDatamapsGetTypeDescriptionOffset"),
	"\t\ttemplate <typename TTypeDescription>\n" + GetDefinition("EntityDatamapsGetTypeDescriptionFlatOffset"),
	"\t\ttemplate <typename TTypeDescription>\n" + GetDefinition("EntityDatamapsGetTypeDescriptionPackedOffset"),
	g_strDatamapBaseAdapter,
	g_strDatamapBaseResolver,
	GetDefinition("EntityDatamapsGetDatamapFromBaseEntity"),
	ReplaceOnce(GetDefinition("FindEntityOutputNameByAddressCallback"), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n"),
	GetDefinition("EntityDatamapsMakeAddressValue"),
	GetDefinition("EntityDatamapsMakeColorObject"),
	GetDefinition("EntityDatamapsGetColorPropertyAddress"),
	...["EntityDatamapsGetColorComponentProperty", "EntityDatamapsSetColorComponentProperty"].map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(PropertyInformation.GetIsolate());\n")),
	g_strDatamapColorBindings,
	...["EntityDatamapsInstallColorComponentProperty", "EntityDatamapsMakeColorPropertyObject", "EntityDatamapsGetColorComponent", "EntityDatamapsGetColorFromValue", "EntityDatamapsGetVectorFromValue", "EntityDatamapsGetFloatPropertyAddress"].map(strName => GetDefinition(strName)),
	...["EntityDatamapsGetFloatComponentProperty", "EntityDatamapsSetFloatComponentProperty"].map(strName => ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(PropertyInformation.GetIsolate());\n")),
	...["EntityDatamapsInstallFloatComponentProperty", "EntityDatamapsMakeVectorPropertyObject", "EntityDatamapsMakeIntervalObject", "EntityDatamapsMakeIntervalPropertyObject", "EntityDatamapsGetIntervalComponent", "EntityDatamapsGetIntervalFromValue"].map(strName => GetDefinition(strName)),
	GetDefinition("EntityDatamapsGetDatamapFromName"),
	GetDefinition("EntityDatamapsGetDatamapFromValue"),
	"\t\ttemplate <typename T>\n" + GetDefinition("EntityDatamapsGetNumberFromValue"),
	"\t\ttemplate <typename T>\n" + GetDefinition("EntityDatamapsGetUnsignedNumberFromValue"),
	...["EntityDatamapsStringStartsWith", "EntityDatamapsFillFieldInformation", "EntityDatamapsIsRecordStorageRangeValid", "EntityDatamapsFindFieldInDatamap", "EntityDatamapsFindFieldInformation", "EntityDatamapsValidatePropertyStorageRange"].map(strName => GetDefinition(strName)),
	ReplaceOnce(GetDefinition("EntityDatamapsGetPropertyAddressFromValues"), "strPropertyName = ValueToString(pIsolate, LocalNameValue);", "strPropertyName = GetFixtureDatamapPropertyName(pIsolate, LocalNameValue);"),
	...["EntityDatamapsGetSignedProperty", "EntityDatamapsGetUnsignedProperty", "EntityDatamapsSetSignedProperty", "EntityDatamapsSetUnsignedProperty"].map(strName => "\t\ttemplate <typename T>\n" + GetDefinition(strName)),
	...["EntityDatamapsGetBooleanProperty", "EntityDatamapsSetBooleanProperty", "EntityDatamapsGetCharProperty", "EntityDatamapsSetCharProperty", "EntityDatamapsGetFloatProperty", "EntityDatamapsSetFloatProperty", "EntityDatamapsGetDoubleProperty", "EntityDatamapsSetDoubleProperty"].map(strName => GetDefinition(strName)),
	"// Controlled SDK string extraction; no deployed string_t representation claim.\n#define STRING(StringValue) ((StringValue).m_pszValue)\n" + GetDefinition("EntityDatamapsGetStringIDProperty") + "\n#undef STRING",
	...["EntityDatamapsIsEntityHandleCurrent", "EntityDatamapsValidatePropertyEntity", "EntityDatamapsSetStringIDProperty", "EntityDatamapsGetStringBufferCapacity", "EntityDatamapsGetStringArrayProperty", "EntityDatamapsSetStringArrayProperty", "EntityDatamapsGetAddressProperty", "EntityDatamapsSetAddressProperty"].map(strName => GetDefinition(strName)),
	g_strDatamapEntitySetter,
	GetDefinition("EntityDatamapsSetVariantValue"),
	g_strDatamapOuterCallbacks,
	g_strDatamapReceiverCallback,
	g_strEntityPropertiesSelectors,
	g_strEntityPropertiesFieldHelpers,
	g_strEntityPropertiesValueCallbacks,
	g_strEntityCollisionScalarCallbacks,
	"#pragma push_macro(\"SOURCEJS_HAS_BASE_ENTITY\")\n#undef SOURCEJS_HAS_BASE_ENTITY\n#define SOURCEJS_HAS_BASE_ENTITY 1\n" + GetDefinition("GetLiveEntityHandle") + "\n#pragma pop_macro(\"SOURCEJS_HAS_BASE_ENTITY\")",
	g_strEntityHandleStorage,
	g_strEntityPropertiesHandleSetter,
	g_strEntityPropertiesVectorCallbacks,
	g_strEntityPropertiesGenericCallbacks,
	g_strEntityPropertiesNamedIntegerCallbacks,
	g_strPlayerPropertyNameAdapters,
	g_strFixturePlayerPropertyNamesParser,
	g_strPlayerPropertyCallerAdapters,
	g_strFixturePlayerPropertyCaller,
	g_strDropWeaponAdapters,
	g_strDropCombatWeaponValidator,
	GetDefinition("PlayersRequireOptionalDropWeaponVectorArgument"),
	g_strFixtureDropWeaponCallback,
	g_strPlayerStorageAdapters,
	g_strPlayerHandleReadAdapter,
	GetDefinition("PlayersReadEntityHandleStorage"),
	GetDefinition("PlayersWriteEntityHandleStorage"),
	GetDefinition("PlayersBuildIndexedPropertyName"),
	g_strPlayerIntegerStorage,
	...[
		"GetPlayerProjectileAmmoCallback",
		"SetPlayerProjectileAmmoCallback",
		"GetPlayerIntegerPropertyCallback",
		"SetPlayerIntegerPropertyCallback",
	].map(strName => GetDefinition(strName)),
	g_strPlayerVectorSetter,
	g_strPlayerPresenceReaders,
	g_strPlayerActiveWeaponSetter,
	g_strPlayerWeaponIndices,
	g_strPlayerProjectileIndices,
	g_strPlayerHLTV,
	GetDefinition("IsPlayerInVehicleCallback"),
	g_strPlayerObserver,
	g_strEffectsOwnershipAdapters,
	g_strEffectsApplyOwnership,
	g_strEffectsMetadataOwnership,
	g_strEffectsPropertyOwnership,
	g_strFilesystemAdapters,
	...g_vecFilesystemCallbacks,
	g_strTruncationHelpers,
	g_strKeyValuesNativeStrings,
	g_strKeyValuesHierarchyAdapter,
	g_strKeyValuesNativeHierarchy,
	g_strBitBufferStateHelpers,
	g_strSoundConstantProfiles,
	GetDefinition("GetSoundObjectPropertyValue"),
	GetDefinition("GetTraceObjectPropertyValue"),
	...[
		"RequireTraceVectorFromValue",
		"RequireTraceAngleFromValue",
		"GetTraceRayVectorPropertyFromObject",
		"RequireTraceRayFromValue",
	].map(strName => GetDefinition(strName)),
	g_strSoundOrigins,
	g_strSoundRecipientHelpers,
	g_strTraceFunction,
	...[
		"GetTraceEntityIndexFromHandle",
		"MakeTraceEntityObject",
		"GetTraceIgnoredEntityIndexFromValue",
		"IsSupportedEngineTraceType",
		"CollectTraceIgnoredEntityIndexes",
		"GetTraceTypeFromObject",
	].map(strName => (strName === "MakeTraceEntityObject") ? g_strTraceEntityRecordProfiles : GetDefinition(strName)),
	g_strTraceFilter,
	g_strTraceEnumerator,
	g_strTraceResultHelpers,
	g_TraceConstantRecordFixture.Source,
	g_strPointContentsHelpers,
	g_strCollideableContentsHelpers,
	g_strClipLifetimeHelpers,
	g_strSweepLifetimeHelpers,
	g_strSoundEntitySelectionProbe,
	g_strStopSoundEntitySelectionProbe,
	g_strTraceQueryOwnerHelpers,
	GetDefinition("GetEngineServerGameDirectoryCallback"),
	g_strSpatialPartitionHelpers,
	g_strMovementHelpers,
	g_strPVSSnapshotHelpers,
	g_strClusterHelpers,
	g_strMapLoadTypeHelpers,
	g_strInstallationHelpers,
	g_strPaintMapRLEHelpers,
	g_strPickedSentenceHelpers,
].join("\n\n");

const g_nBinaryRecordBegin = g_strSource.indexOf("\t\tstruct MemoryManagerBinaryInformation {");
const g_nBinaryRecordEnd = g_strSource.indexOf("\t\tstd::string ConvertMemoryManagerStringToLowercase(", g_nBinaryRecordBegin);
g_Assert((g_nBinaryRecordBegin >= 0) && (g_nBinaryRecordEnd > g_nBinaryRecordBegin), "Locate actual binary record and constructors.");
const g_strBinaryRecord = g_strSource.slice(g_nBinaryRecordBegin, g_nBinaryRecordEnd);

const g_unFixturePlaceholderSplitPartCount = 2;
g_Assert.equal(g_strTemplate.split("@BINDING_ERROR_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@ENTITY_CALLBACK_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@PLAYER_INDEX_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@QUOTE_COMMAND_HELPER@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@CLIENT_CALLBACK_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@SERVER_PROPERTY_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@PLAYER_CALLBACK_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@PLAYER_PROPERTY_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@CONVAR_PROPERTY_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@CONCOMMAND_PROPERTY_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@CORE_CHECKSUM_AND_GAME_EVENT_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@COMMAND_NAME_HELPER@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@CVAR_LOOKUP_AND_ENUMERATION_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@CVAR_OPERATION_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@CVAR_PUBLIC_AND_TAG_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@EVENT_RESOURCE_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@GAME_EVENT_PAYLOAD_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@PLAYER_TEAM_DATA_RECORD@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@PLAYER_COLLECTION_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@RECIPIENT_DICTIONARY_VOICE_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@PLAYER_IDENTITY_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@SERVER_CLIENT_CVAR_CALLBACK_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@ENGINE_VISIBILITY_CALLBACK_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@ENTITY_FACTORY_CALLBACK_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);
g_Assert.equal(g_strTemplate.split("@DATAMAP_CALLBACK_HELPERS@").length, g_unFixturePlaceholderSplitPartCount);

const g_vecPlayerErrorProbes = [
	{ Name: "PlayerBan", Operation: "Player.Ban()" },
	{ Name: "PlayerChangeTeam", Operation: "Player.ChangeTeam()" },
	{ Name: "PlayerSetName", Operation: "players.SetName()" },
	{ Name: "ClientCommandSend", Operation: "commands.Send()" },
	{ Name: "ClientCommandSay", Operation: "commands.Say()" },
	{ Name: "ClientCommandSayTeam", Operation: "commands.SayTeam()" },
];
const g_vecConCommandErrorProbes = [
	{ Name: "ExistsRead", Operation: "ConCommand.Exists read" },
	{ Name: "FlagsRead", Operation: "ConCommand.Flags read" },
	{ Name: "ReadOnlyWrite", Operation: "ConCommand read-only property write" },
	{ Name: "FlagsWrite", Operation: "ConCommand.Flags write" },
];

const g_unFactoryClassNameCallbackCount = 2;
const g_unFilesystemDirectoryCallbackIndex = 3;
const g_unFilesystemStringArgumentCallbackIndex = 4;
const g_unFilesystemTemporaryPathCallbackIndex = 5;

const g_strPlayerBanCallback = GetDefinition("PlayerBanMethodCallback");
const g_strPlayerBanDurationValidation = [
	"\t\t\tint nBanDuration = kDefaultBanDuration;",
	"\t\t\tif (CallbackInformation.Length() > kDurationArgumentIndex) {",
	"\t\t\t\tv8::Local<v8::Value> const LocalDurationValue = CallbackInformation[kDurationArgumentIndex];",
	"\t\t\t\tif (!LocalDurationValue->IsNumber()) {",
	"\t\t\t\t\tThrowError(pIsolate, kDurationMessage);",
	"\t\t\t\t\treturn;",
	"\t\t\t\t}",
	"",
	"\t\t\t\tconst double dblBanDuration = LocalDurationValue.As<v8::Number>()->Value();",
	"\t\t\t\tif (!std::isfinite(dblBanDuration) || (std::floor(dblBanDuration) != dblBanDuration)) {",
	"\t\t\t\t\tThrowError(pIsolate, kDurationMessage);",
	"\t\t\t\t\treturn;",
	"\t\t\t\t}",
	"",
	"\t\t\t\tif ((dblBanDuration < 0) || (dblBanDuration > kMaximumBanDuration)) {",
	"\t\t\t\t\tThrowError(pIsolate, kDurationRangeMessage);",
	"\t\t\t\t\treturn;",
	"\t\t\t\t}",
	"",
	"\t\t\t\tnBanDuration = static_cast<int>(dblBanDuration);",
	"\t\t\t}",
].join("\n");
const g_strPlayerBanCoercedDurationProbe = [
	"\t\t\tint nBanDuration = kDefaultBanDuration;",
	"\t\t\tif (CallbackInformation.Length() > kDurationArgumentIndex) {",
	"\t\t\t\tif (!GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kDurationArgumentIndex], kDurationMessage, nBanDuration)) {",
	"\t\t\t\t\treturn;",
	"\t\t\t\t}",
	"\t\t\t}",
	"",
	"\t\t\tif ((nBanDuration < 0) || (static_cast<double>(nBanDuration) > kMaximumBanDuration)) {",
	"\t\t\t\tThrowError(pIsolate, kDurationRangeMessage);",
	"\t\t\t\treturn;",
	"\t\t\t}",
].join("\n");
const g_strRuntimeRequireSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/V8Runtime.cpp"), "utf8").replace(/\r/g, "");
const g_strRuntimeRequireHelpers = ["MakeRuntimeString", "ThrowRuntimeError", "RequirePluginModule", "RequirePluginModuleCallback", "MakePluginRequire"].map(strName => {
	const vecMatches = [...g_strRuntimeRequireSource.matchAll(new RegExp("^\\t\\t(?:bool|void) " + strName + "\\([^\\n]*\\) \\{[\\s\\S]*?^\\t\\t\\}", "gm"))];
	g_Assert.equal(vecMatches.length, 1, "Unique actual runtime require definition: " + strName);

	return vecMatches[0][0];
}).join("\n\n");
// Test-only entry bookkeeping observes attempted error construction during termination.
const g_strRuntimeRequireObserved = ReplaceOnce(g_strRuntimeRequireHelpers, "void ThrowRuntimeError(v8::Isolate* const pIsolate, std::string const& strMessage) {", "void ThrowRuntimeError(v8::Isolate* const pIsolate, std::string const& strMessage) {\n\t\t\t++g_unErrorReports;");

function GetCommonJSExportsInitializers(strMutatedMethod = "") {
	return [
		{ Method: "ExecuteCommonJS", Helper: "InitializeRuntimeCommonJSExports" },
		{ Method: "RequirePackageModule", Helper: "InitializePackageCommonJSExports" },
	].map(Entry => {
		const vecMethods = [...g_strRuntimeRequireSource.matchAll(new RegExp("^\\tbool V8Runtime::" + Entry.Method + "\\([^\\n]*\\) \\{[\\s\\S]*?^\\t\\}", "gm"))];
		g_Assert.equal(vecMethods.length, 1, "Unique current CommonJS method: " + Entry.Method);
		const vecInitializers = [...vecMethods[0][0].matchAll(/if \(!(?<Initializer>LocalModuleObject->(?:Set|CreateDataProperty)\(LocalContext, LocalExportsPropertyName, LocalExportsObject\)\.FromMaybe\(false\))\)/g)];
		g_Assert.equal(vecInitializers.length, 1, "Unique current CommonJS exports initialization: " + Entry.Method);
		const strInitializer = vecInitializers[0].groups.Initializer;
		const strCurrentInitializer = (strMutatedMethod === Entry.Method) ? strInitializer.replace("->CreateDataProperty(", "->Set(") : strInitializer;

		return "\t\tbool " + Entry.Helper + "(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalModuleObject, v8::Local<v8::String> const LocalExportsPropertyName, v8::Local<v8::Object> const LocalExportsObject) {\n\t\t\treturn " + strCurrentInitializer + ";\n\t\t}";
	}).join("\n\n");
}

const g_strCommonJSExportsInitializers = GetCommonJSExportsInitializers();

function GetRuntimeRecordDefinition(strName, bMember = false) {
	const strIndentation = bMember ? "\\t" : "\\t\\t";
	const strQualification = bMember ? "V8Runtime::" : "";
	const vecMatches = [...g_strRuntimeRequireSource.matchAll(new RegExp("^" + strIndentation + "(?:bool|v8::Local<v8::(?:Array|Object)>) " + strQualification + strName + "\\([^\\n]*\\) \\{[\\s\\S]*?^" + strIndentation + "\\}", "gm"))];
	g_Assert.equal(vecMatches.length, 1, "Unique current runtime record definition: " + strName);

	return vecMatches[0][0];
}

function RestoreRuntimeRecordSet(strSource, strObject, strArguments) {
	const strOwn = strObject + "->CreateDataProperty(" + strArguments;
	const strSet = strObject + "->Set(" + strArguments;
	const strCurrent = strSource.includes(strOwn) ? strOwn : strSet;

	return ReplaceOnce(strSource, strCurrent, strSet);
}

const g_strRuntimeRecordPayloadHelpers = ["SetPayloadString", "SetPayloadInteger", "SetPayloadBoolean", "MakePayloadArguments", "SetPayloadArguments", "DoesCommandResultBlock", "CallCommandCallback"].map(strName => GetRuntimeRecordDefinition(strName)).join("\n\n");
const g_strRuntimeGameEventViewFactory = GetRuntimeRecordDefinition("MakeGameEventView", true);
const g_vecRuntimeRecordControls = [
	{ Name: "RuntimeRecordsRuntimeSlot", Factory: true, Object: "LocalCallbackData", Arguments: "LocalContext, kRuntimeIndex," },
	{ Name: "RuntimeRecordsTokenSlot", Factory: true, Object: "LocalCallbackData", Arguments: "LocalContext, kEventTokenIndex," },
	{ Name: "RuntimeRecordsAddress", Factory: true, Object: "LocalEvent", Arguments: "LocalContext, LocalAddressKey," },
	{ Name: "RuntimeRecordsMethods", Factory: true, Object: "LocalEvent", Arguments: "LocalContext, LocalMethodName," },
	{ Name: "RuntimeRecordsStringFields", Factory: false, Object: "LocalObject", Arguments: "LocalContext, LocalPropertyName, LocalStringValue)" },
	{ Name: "RuntimeRecordsIntegerFields", Factory: false, Object: "LocalObject", Arguments: "LocalContext, LocalPropertyName, v8::Integer::New" },
	{ Name: "RuntimeRecordsBooleanFields", Factory: false, Object: "LocalObject", Arguments: "LocalContext, LocalPropertyName, v8::Boolean::New" },
	{ Name: "RuntimeRecordsArgumentsField", Factory: false, Object: "LocalObject", Arguments: "LocalContext, LocalPropertyName, LocalArgumentArray)" },
	{ Name: "RuntimeRecordsArgumentIndexes", Factory: false, Object: "LocalArgumentArray", Arguments: "LocalContext, static_cast<std::uint32_t>(unArgumentIndex)," },
];

const g_vecInstallationOwnRecordWriteMutations = [
	["HookArguments", "LocalArgumentTypes->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unArgumentTypeIndex), LocalArgumentType).FromMaybe(false)", "LocalArgumentTypes->Set(LocalContext, static_cast<std::uint32_t>(unArgumentTypeIndex), LocalArgumentType).FromMaybe(false)"],
	["HookFields", "SetRecordProperty(pIsolate, LocalContext, LocalHookOptions, \"ObjectAddress\", LocalEngineServerAddress)", "SetValue(pIsolate, LocalContext, LocalHookOptions, \"ObjectAddress\", LocalEngineServerAddress)"],
	["HookFields", "SetRecordProperty(pIsolate, LocalContext, LocalHookOptions, \"Index\", v8::Integer::New(pIsolate, nVirtualMethodIndex))", "SetInteger(pIsolate, LocalContext, LocalHookOptions, \"Index\", nVirtualMethodIndex)"],
	["HookFields", "SetRecordProperty(pIsolate, LocalContext, LocalHookOptions, \"Convention\", MakeString(pIsolate, \"thiscall\"))", "SetString(pIsolate, LocalContext, LocalHookOptions, \"Convention\", \"thiscall\")"],
	["HookFields", "SetRecordProperty(pIsolate, LocalContext, LocalHookOptions, \"ReturnType\", MakeString(pIsolate, pszReturnType))", "SetString(pIsolate, LocalContext, LocalHookOptions, \"ReturnType\", pszReturnType)"],
	["HookFields", "SetRecordProperty(pIsolate, LocalContext, LocalHookOptions, \"Arguments\", LocalArgumentTypes)", "SetValue(pIsolate, LocalContext, LocalHookOptions, \"Arguments\", LocalArgumentTypes)"],
	["RecipientIndices", "LocalRecipientIndexes->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unRecipientListIndex), LocalRecipientEntityIndex).FromMaybe(false)", "LocalRecipientIndexes->Set(LocalContext, static_cast<std::uint32_t>(unRecipientListIndex), LocalRecipientEntityIndex).FromMaybe(false)"],
	["RecipientFields", "SetRecordProperty(pIsolate, LocalContext, LocalRecipientFilterInformation, \"Indices\", LocalRecipientIndexes)", "SetValue(pIsolate, LocalContext, LocalRecipientFilterInformation, \"Indices\", LocalRecipientIndexes)"],
	["RecipientFields", "SetRecordProperty(pIsolate, LocalContext, LocalRecipientFilterInformation, \"Reliable\", v8::Boolean::New(pIsolate, bReliable))", "SetBoolean(pIsolate, LocalContext, LocalRecipientFilterInformation, \"Reliable\", bReliable)"],
	["RecipientFields", "SetRecordProperty(pIsolate, LocalContext, LocalRecipientFilterInformation, \"InitializationMessage\", v8::Boolean::New(pIsolate, bInitializationMessage))", "SetBoolean(pIsolate, LocalContext, LocalRecipientFilterInformation, \"InitializationMessage\", bInitializationMessage)"],
	["BitBufferFields", "SetRecordProperty(pIsolate, LocalContext, LocalBitBufferState, \"Bytes\", LocalBitBufferBytesValue)", "SetValue(pIsolate, LocalContext, LocalBitBufferState, \"Bytes\", LocalBitBufferBytesValue)"],
	["BitBufferFields", "SetRecordProperty(pIsolate, LocalContext, LocalBitBufferState, \"CurrentBit\", v8::Integer::New(pIsolate, nCurrentBitIndex))", "SetInteger(pIsolate, LocalContext, LocalBitBufferState, \"CurrentBit\", nCurrentBitIndex)"],
	["BitBufferFields", "SetRecordProperty(pIsolate, LocalContext, LocalBitBufferState, \"DataBitCount\", v8::Integer::New(pIsolate, nCapacityBitCount))", "SetInteger(pIsolate, LocalContext, LocalBitBufferState, \"DataBitCount\", nCapacityBitCount)"],
	["BitBufferFields", "SetRecordProperty(pIsolate, LocalContext, LocalBitBufferState, \"Overflowed\", v8::Boolean::New(pIsolate, bOverflowed))", "SetBoolean(pIsolate, LocalContext, LocalBitBufferState, \"Overflowed\", bOverflowed)"],
	["GlobalsMethods", "SetRecordFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, \"IsRemoteClient\", FixtureGlobalRegistrationCallbacks::UnavailableMethod, LocalCallbackData)", "SetFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, \"IsRemoteClient\", FixtureGlobalRegistrationCallbacks::UnavailableMethod, LocalCallbackData)"],
	["GlobalsMethods", "SetRecordFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, \"IsClient\", FixtureGlobalRegistrationCallbacks::UnavailableMethod, LocalCallbackData)", "SetFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, \"IsClient\", FixtureGlobalRegistrationCallbacks::UnavailableMethod, LocalCallbackData)"],
	["GlobalsMethods", "SetRecordFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, \"GetNetworkBase\", FixtureGlobalRegistrationCallbacks::UnavailableMethod, LocalCallbackData)", "SetFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, \"GetNetworkBase\", FixtureGlobalRegistrationCallbacks::UnavailableMethod, LocalCallbackData)"],
	["BaseFields", "SetRecordProperty(pIsolate, LocalContext, LocalHUDDestinationConstants, BindingInformation.m_pszName, v8::Integer::New(pIsolate, BindingInformation.m_nValue))", "SetInteger(pIsolate, LocalContext, LocalHUDDestinationConstants, BindingInformation.m_pszName, BindingInformation.m_nValue)"],
	["BaseContainers", "SetRecordProperty(pIsolate, LocalContext, LocalBaseMessageConstants, \"HUDDestination\", LocalHUDDestinationConstants)", "SetValue(pIsolate, LocalContext, LocalBaseMessageConstants, \"HUDDestination\", LocalHUDDestinationConstants)"],
	["BaseFields", "SetRecordProperty(pIsolate, LocalContext, LocalShakeCommandConstants, BindingInformation.m_pszName, v8::Integer::New(pIsolate, BindingInformation.m_nValue))", "SetInteger(pIsolate, LocalContext, LocalShakeCommandConstants, BindingInformation.m_pszName, BindingInformation.m_nValue)"],
	["BaseContainers", "SetRecordProperty(pIsolate, LocalContext, LocalBaseMessageConstants, \"ShakeCommand\", LocalShakeCommandConstants)", "SetValue(pIsolate, LocalContext, LocalBaseMessageConstants, \"ShakeCommand\", LocalShakeCommandConstants)"],
	["BaseFields", "SetRecordProperty(pIsolate, LocalContext, LocalFadeFlagConstants, BindingInformation.m_pszName, v8::Integer::New(pIsolate, BindingInformation.m_nValue))", "SetInteger(pIsolate, LocalContext, LocalFadeFlagConstants, BindingInformation.m_pszName, BindingInformation.m_nValue)"],
	["BaseContainers", "SetRecordProperty(pIsolate, LocalContext, LocalBaseMessageConstants, \"FadeFlags\", LocalFadeFlagConstants)", "SetValue(pIsolate, LocalContext, LocalBaseMessageConstants, \"FadeFlags\", LocalFadeFlagConstants)"],
	["BaseFractionBits", "SetRecordProperty(pIsolate, LocalContext, LocalBaseMessageConstants, \"SCREEN_FADE_FRACTION_BITS\", v8::Integer::New(pIsolate, SCREENFADE_FRACBITS))", "SetInteger(pIsolate, LocalContext, LocalBaseMessageConstants, \"SCREEN_FADE_FRACTION_BITS\", SCREENFADE_FRACBITS)"],
	["DialogFields", "SetRecordProperty(pIsolate, LocalContext, LocalDialogTypes, \"Message\", v8::Integer::New(pIsolate, DIALOG_MSG))", "SetInteger(pIsolate, LocalContext, LocalDialogTypes, \"Message\", DIALOG_MSG)"],
	["DialogFields", "SetRecordProperty(pIsolate, LocalContext, LocalDialogTypes, \"Menu\", v8::Integer::New(pIsolate, DIALOG_MENU))", "SetInteger(pIsolate, LocalContext, LocalDialogTypes, \"Menu\", DIALOG_MENU)"],
	["DialogFields", "SetRecordProperty(pIsolate, LocalContext, LocalDialogTypes, \"Text\", v8::Integer::New(pIsolate, DIALOG_TEXT))", "SetInteger(pIsolate, LocalContext, LocalDialogTypes, \"Text\", DIALOG_TEXT)"],
	["DialogFields", "SetRecordProperty(pIsolate, LocalContext, LocalDialogTypes, \"Entry\", v8::Integer::New(pIsolate, DIALOG_ENTRY))", "SetInteger(pIsolate, LocalContext, LocalDialogTypes, \"Entry\", DIALOG_ENTRY)"],
	["DialogFields", "SetRecordProperty(pIsolate, LocalContext, LocalDialogTypes, \"AskConnect\", v8::Integer::New(pIsolate, DIALOG_ASKCONNECT))", "SetInteger(pIsolate, LocalContext, LocalDialogTypes, \"AskConnect\", DIALOG_ASKCONNECT)"],
].map(vecWrite => [vecWrite[0], AdaptMessageInstallationConstants(vecWrite[1]), AdaptMessageInstallationConstants(vecWrite[2])]);

function RevertInstallationOwnRecordWrites(strFamily) {
	const vecWrites = g_vecInstallationOwnRecordWriteMutations.filter(vecWrite => vecWrite[0] === strFamily);
	g_Assert(vecWrites.length > 0, "Find owned installation write family: " + strFamily);
	const bRecipientFamily = (strFamily === "RecipientIndices") || (strFamily === "RecipientFields");
	const strOwner = bRecipientFamily ? g_strMessageRecipientFactory : g_strDatamapCallbacks;
	const strRegression = vecWrites.reduce((strSource, vecWrite) => ReplaceOnce(strSource, vecWrite[1], vecWrite[2]), strOwner);

	return bRecipientFamily ? ReplaceOnce(g_strDatamapCallbacks, strOwner, strRegression) : strRegression;
}

function RevertProtobufInstallationWrites(strFamily) {
	const vecControls = [
		{ Family: "RecipientIndices", Owner: g_strProtobufRecipientFactory, Before: "LocalRecipientEntityIndices->CreateDataProperty(", After: "LocalRecipientEntityIndices->Set(" },
		{ Family: "RecipientFields", Owner: g_strProtobufRecipientFactory, Before: 'SetRecordProperty(pIsolate, LocalContext, LocalRecipientFilterInformation, "Indices", LocalRecipientEntityIndices)', After: 'SetValue(pIsolate, LocalContext, LocalRecipientFilterInformation, "Indices", LocalRecipientEntityIndices)' },
		{ Family: "RecipientFields", Owner: g_strProtobufRecipientFactory, Before: 'SetRecordProperty(pIsolate, LocalContext, LocalRecipientFilterInformation, "Reliable", v8::Boolean::New(pIsolate, bReliable))', After: 'SetBoolean(pIsolate, LocalContext, LocalRecipientFilterInformation, "Reliable", bReliable)' },
		{ Family: "RecipientFields", Owner: g_strProtobufRecipientFactory, Before: 'SetRecordProperty(pIsolate, LocalContext, LocalRecipientFilterInformation, "InitializationMessage", v8::Boolean::New(pIsolate, bInitializationMessage))', After: 'SetBoolean(pIsolate, LocalContext, LocalRecipientFilterInformation, "InitializationMessage", bInitializationMessage)' },
		{ Family: "BindingAddress", Owner: g_strProtobufMethodInstaller, Before: 'SetRecordProperty(pIsolate, LocalContext, LocalProtobufMethodBindingData, "Address", LocalProtobufMessageAddress)', After: 'SetValue(pIsolate, LocalContext, LocalProtobufMethodBindingData, "Address", LocalProtobufMessageAddress)' },
		{ Family: "BindingOperation", Owner: g_strProtobufMethodInstaller, Before: 'SetRecordProperty(pIsolate, LocalContext, LocalProtobufMethodBindingData, "Operation", MakeString(pIsolate, pszMethodName))', After: 'SetString(pIsolate, LocalContext, LocalProtobufMethodBindingData, "Operation", pszMethodName)' },
		{ Family: "Methods", Owner: g_strProtobufMethodInstaller, Before: "SetRecordFunction(pIsolate, LocalContext, LocalMessageObject, pszMethodName, MethodCallback, LocalProtobufMethodBindingData)", After: "SetFunction(pIsolate, LocalContext, LocalMessageObject, pszMethodName, MethodCallback, LocalProtobufMethodBindingData)" },
	];
	const vecSelected = vecControls.filter(Control => Control.Family === strFamily);
	g_Assert(vecSelected.length > 0, "Find protobuf installation write family: " + strFamily);
	const strOwner = vecSelected[0].Owner;
	g_Assert(vecSelected.every(Control => Control.Owner === strOwner), "Keep each protobuf reversion inside one actual owner.");
	const strRegression = vecSelected.reduce((strSource, Control) => ReplaceOnce(strSource, Control.Before, Control.After), strOwner);

	return ReplaceOnce(g_strDatamapCallbacks, strOwner, strRegression);
}

const g_vecCases = [
	...[
		{ Name: "EngineVisibilityRequiredBytes", Old: "SetRecordProperty(pIsolate, LocalContext, LocalPVSResultObject, kRequiredBytesPropertyName, v8::Integer::New(pIsolate, nRequiredPVSByteCount))", New: "SetInteger(pIsolate, LocalContext, LocalPVSResultObject, kRequiredBytesPropertyName, nRequiredPVSByteCount)" },
		{ Name: "EngineVisibilityBytes", Old: "SetRecordProperty(pIsolate, LocalContext, LocalPVSResultObject, kBytesPropertyName, LocalPVSBytesArray)", New: "SetValue(pIsolate, LocalContext, LocalPVSResultObject, kBytesPropertyName, LocalPVSBytesArray)" },
		{ Name: "EngineVisibilityNormal", Old: "SetRecordProperty(pIsolate, LocalContext, LocalAreaPortalPlaneObject, kNormalPropertyName, LocalAreaPortalNormalObject)", New: "SetValue(pIsolate, LocalContext, LocalAreaPortalPlaneObject, kNormalPropertyName, LocalAreaPortalNormalObject)" },
		{ Name: "EngineVisibilityDistance", Old: "SetRecordProperty(pIsolate, LocalContext, LocalAreaPortalPlaneObject, kDistancePropertyName, v8::Number::New(pIsolate, AreaPortalPlane.m_Dist))", New: "SetValue(pIsolate, LocalContext, LocalAreaPortalPlaneObject, kDistancePropertyName, v8::Number::New(pIsolate, AreaPortalPlane.m_Dist))" },
	].map(Control => ({ Name: Control.Name, Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Engine visibility result fields use own data without inherited setters", EngineVisibilitySource: ReplaceOnce(g_strEngineVisibilityCallbacks, Control.Old, Control.New) })),
	...[
		{ Name: "ClientCVarSelectorNumberOnly", Old: "nPlayerIndex = GetValueIndex(pIsolate, LocalContext, LocalPlayerValue);", New: "nPlayerIndex = LocalPlayerValue->IsObject() ? kInvalidPlayerIndex : GetValueIndex(pIsolate, LocalContext, LocalPlayerValue);" },
		{ Name: "ClientCVarNameType", Old: "LocalCVarNameValue.IsEmpty() || !LocalCVarNameValue->IsString()", New: "LocalCVarNameValue.IsEmpty()" },
		{ Name: "ClientCVarCStringDecoding", Old: "std::string const strCVarName = ValueToString(pIsolate, LocalCVarNameValue);", New: "std::string const strCVarName = ValueToString(pIsolate, LocalCVarNameValue).c_str();" },
	].map(Control => ({ Name: Control.Name, Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Client CVar native selector, validation order and UTF8/C-string contract", ClientCVarSource: ReplaceOnce(g_strClientCVarCallbacks, Control.Old, Control.New) })),
	{ Name: "ClientCVarDiagnosticRoles", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Client CVar native selector, validation order and UTF8/C-string contract", ClientCVarSource: g_strClientCVarCallbacks.replaceAll("GetClientCVarValue(PlayerOrIndex, strCVarName)", "GetClientCVarValue(nPlayerIndex, strCVarName)") },
	{ Name: "RuntimeRequireCurrent", Source: g_strThrowError, Positive: true, RuntimeRequireProfile: true },
	...["kRuntimeDataIndex", "kGlobalRequireDataIndex", "kParentScriptDataIndex"].map(strIndex => ({ Name: "RuntimeRequireMetadata" + strIndex.slice(1), Source: g_strThrowError, RuntimeRequireProfile: true, ExpectedFailure: "Runtime require metadata bypasses inherited setters", RuntimeRequireSource: ReplaceOnce(g_strRuntimeRequireObserved, "LocalCallbackData->CreateDataProperty(LocalContext, " + strIndex + ",", "LocalCallbackData->Set(LocalContext, " + strIndex + ",") })),
	...[{ Name: "Runtime", Index: "kRuntimeDataIndex", Value: "LocalRuntimeValue" }, { Name: "Global", Index: "kGlobalRequireDataIndex", Value: "LocalGlobalRequireFunction" }, { Name: "Parent", Index: "kParentScriptDataIndex", Value: "LocalParentScriptName" }].map(Entry => ({ Name: "RuntimeRequireGetter" + Entry.Name, Source: g_strThrowError, RuntimeRequireProfile: true, ExpectedFailure: "Runtime require metadata getter preserves original exception", RuntimeRequireSource: ReplaceOnce(g_strRuntimeRequireObserved, "if (!LocalCallbackData->Get(LocalContext, " + Entry.Index + ").ToLocal(&" + Entry.Value + ")) {\n\t\t\t\treturn;", "if (!LocalCallbackData->Get(LocalContext, " + Entry.Index + ").ToLocal(&" + Entry.Value + ")) {\n\t\t\t\tThrowRuntimeError(pIsolate, \"Deliberately replace a metadata getter failure\");\n\t\t\t\treturn;") })),
	{ Name: "RuntimeRequireLocalFailure", Source: g_strThrowError, RuntimeRequireProfile: true, ExpectedFailure: "Runtime require local loader preserves original exception", RuntimeRequireSource: ReplaceOnce(ReplaceOnce(g_strRuntimeRequireObserved, "if (CallbackFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", "if (pIsolate->IsExecutionTerminating())"), "v8::TryCatch const& CallbackFailure)", "v8::TryCatch const&)") },
	{ Name: "RuntimeRequireNativeUnwind", Source: g_strThrowError, RuntimeRequireProfile: true, ExpectedFailure: "Runtime require native unwind preserves JavaScript exception", RuntimeRequireSource: ReplaceOnce(g_strRuntimeRequireObserved, "if (bNativeFailure && !CallbackFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException())", "if (bNativeFailure && !pIsolate->IsExecutionTerminating())") },
	{ Name: "RuntimeRequireTermination", Source: g_strThrowError, RuntimeRequireProfile: true, ExpectedFailure: "Runtime require termination is not reported or resumed", RuntimeRequireSource: ReplaceOnce(g_strRuntimeRequireObserved, "if (CallbackFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", "if ((CallbackFailure.HasCaught() || pIsolate->HasPendingException()) && !pIsolate->IsExecutionTerminating())") },
	...["ExecuteCommonJS", "RequirePackageModule"].map(strMethod => ({ Name: "RuntimeCommonJSExports" + strMethod, Source: g_strThrowError, RuntimeRequireProfile: true, ExpectedFailure: "CommonJS exports metadata bypasses inherited properties", CommonJSExportsSource: GetCommonJSExportsInitializers(strMethod) })),
	{ Name: "RuntimeRecordsWithoutUInt64", Source: g_strThrowError, Positive: true, RuntimeRequireProfile: true, RuntimeWithoutEventUInt64: true },
	...g_vecRuntimeRecordControls.map(Control => ({
		Name: Control.Name,
		Source: g_strThrowError,
		RuntimeRequireProfile: true,
		ExpectedFailure: "Runtime record factories bypass inherited properties",
		...(Control.Factory ? { RuntimeGameEventViewSource: RestoreRuntimeRecordSet(g_strRuntimeGameEventViewFactory, Control.Object, Control.Arguments) } : { RuntimeRecordPayloadSource: RestoreRuntimeRecordSet(g_strRuntimeRecordPayloadHelpers, Control.Object, Control.Arguments) }),
	})),
	{ Name: "WeaponDictionaryInitialCount", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Weapon dictionary Count matches materialized indexes after reentrant construction", WeaponDictionarySource: ReplaceOnce(g_strWeaponDictionaryHelpers, "\t\t\t\tif (!SetRecordProperty(pIsolate, LocalContext, LocalWeaponsDictionary, kWeaponCountPropertyName, v8::Integer::New(pIsolate, nWeaponCount))) {", "\t\t\t\tnWeaponCount = static_cast<int>(vecWeaponIndexes.size());\n\n\t\t\t\tif (!SetRecordProperty(pIsolate, LocalContext, LocalWeaponsDictionary, kWeaponCountPropertyName, v8::Integer::New(pIsolate, nWeaponCount))) {") },
	{ Name: "ClientKeyValuesUncheckedIdentity", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client identity and KeyValues ownership through preparation", ClientKeyValuesSource: ReplaceOnce(g_strClientKeyValuesHelpers, g_strClientKeyValuesIdentityGuard, "\t\t\t\tResolveFixtureKeyValuesClientHandle(ClientHandle, nCurrentClientIndex);\n\t\t\t\tnCurrentClientIndex = ClientHandle.GetEntryIndex();") },
	{ Name: "ClientKeyValuesEarlyCommit", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client identity and KeyValues ownership through preparation", ClientKeyValuesSource: ReplaceOnce(g_strClientKeyValuesHelpers, g_strClientKeyValuesExecution, g_strClientKeyValuesEarlyCommit) },
	{ Name: "ClientKeyValuesMissingErase", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client identity and KeyValues ownership through preparation", ClientKeyValuesSource: ReplaceOnce(g_strClientKeyValuesHelpers, "EraseCollectedKeyValuesRecords(vecCollectedKeyValues);", "EraseCollectedKeyValuesRecords({});") },
	{ Name: "ClientKeyValuesStaleEdict", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client identity and KeyValues ownership through preparation", ClientKeyValuesSource: ReplaceOnce(g_strClientKeyValuesHelpers, "pEngineServer->ClientCommandKeyValues(pClientEdict, pNativeKeyValues);", "pEngineServer->ClientCommandKeyValues(&g_FixtureKeyValuesClientA, pNativeKeyValues);") },
	{ Name: "ClientKeyValuesDisconnected", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client identity and KeyValues ownership through preparation", ClientKeyValuesSource: ReplaceOnce(g_strClientKeyValuesHelpers, g_strClientKeyValuesConnectedGuard, "") },
	{ Name: "ClientKeyValuesAliasedHandle", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client identity and KeyValues ownership through preparation", ClientKeyValuesSource: ReplaceOnce(g_strClientKeyValuesHelpers, "\t\t\t\tCBaseHandle ClientHandle {};", "\t\t\t\tCBaseHandle& ClientHandle = g_FixtureKeyValuesHandleA.m_Handle;") },

	{ Name: "EngineTransmitBitIndices", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build own transmit indices and bit records without inherited interference", TransmitSnapshotSource: ReplaceOnce(g_strTransmitSnapshotHelpers, "LocalEntityIndexArray->CreateDataProperty(LocalContext, unEntityIndexArrayIndex, LocalEntityIndexValue)", "LocalEntityIndexArray->Set(LocalContext, unEntityIndexArrayIndex, LocalEntityIndexValue)") },
	{ Name: "EngineTransmitIntegerIndices", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build own transmit indices and bit records without inherited interference", TransmitSnapshotSource: ReplaceOnce(g_strTransmitSnapshotHelpers, "LocalIntegerArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(nIntegerValueIndex), LocalIntegerValue)", "LocalIntegerArray->Set(LocalContext, static_cast<std::uint32_t>(nIntegerValueIndex), LocalIntegerValue)") },
	{ Name: "EngineTransmitByteIndices", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build own transmit indices and bit records without inherited interference", TransmitSnapshotSource: ReplaceOnce(g_strTransmitSnapshotHelpers, "LocalByteArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(nByteValueIndex), LocalByteValue)", "LocalByteArray->Set(LocalContext, static_cast<std::uint32_t>(nByteValueIndex), LocalByteValue)") },
	{ Name: "EngineTransmitMaximumBits", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build own transmit indices and bit records without inherited interference", TransmitSnapshotSource: ReplaceOnce(g_strTransmitSnapshotHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalEntityTransmitBitsObject, kMaximumBitCountPropertyName, v8::Integer::New(pIsolate, kMaximumEntityCount))", "SetInteger(pIsolate, LocalContext, LocalEntityTransmitBitsObject, kMaximumBitCountPropertyName, kMaximumEntityCount)") },
	{ Name: "EngineTransmitIndexes", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build own transmit indices and bit records without inherited interference", TransmitSnapshotSource: ReplaceOnce(g_strTransmitSnapshotHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalEntityTransmitBitsObject, kEntityIndexArrayPropertyName, LocalEntityIndexArray)", "SetValue(pIsolate, LocalContext, LocalEntityTransmitBitsObject, kEntityIndexArrayPropertyName, LocalEntityIndexArray)") },
	{ Name: "EngineTransmitPreviousOwnClient", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kClientPropertyName, LocalClientEntityValue)", "SetValue(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kClientPropertyName, LocalClientEntityValue)") },
	{ Name: "EngineTransmitPreviousOwnPVSSize", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kPVSSizePropertyName, v8::Integer::New(pIsolate, nPVSByteCount))", "SetValue(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kPVSSizePropertyName, v8::Integer::New(pIsolate, nPVSByteCount))") },
	{ Name: "EngineTransmitPreviousOwnPVS", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kPVSPropertyName, LocalPVSByteArray)", "SetValue(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kPVSPropertyName, LocalPVSByteArray)") },
	{ Name: "EngineTransmitPreviousOwnEdicts", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kTransmitEdictsPropertyName, LocalTransmitEdictIndexArray)", "SetValue(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kTransmitEdictsPropertyName, LocalTransmitEdictIndexArray)") },
	{ Name: "EngineTransmitPreviousOwnAlways", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kTransmitAlwaysPropertyName, LocalAlwaysTransmitEdictIndexArray)", "SetValue(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kTransmitAlwaysPropertyName, LocalAlwaysTransmitEdictIndexArray)") },
	{ Name: "EngineTransmitOwnPreviousAreasNetworked", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kAreasNetworkedPropertyName, v8::Integer::New(pIsolate, nNetworkedAreaCount))", "SetInteger(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kAreasNetworkedPropertyName, nNetworkedAreaCount)") },
	{ Name: "EngineTransmitOwnPreviousAreas", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kAreasPropertyName, LocalNetworkedAreaArray)", "SetValue(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kAreasPropertyName, LocalNetworkedAreaArray)") },
	{ Name: "EngineTransmitOwnPreviousMapAreas", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kMapAreasPropertyName, v8::Integer::New(pIsolate, nMapAreaCount))", "SetInteger(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kMapAreasPropertyName, nMapAreaCount)") },
	{ Name: "EngineTransmitOwnPreviousAreaFloodNumbers", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kAreaFloodNumbersPropertyName, LocalAreaFloodNumberArray)", "SetValue(pIsolate, LocalContext, LocalPreviousTransmitInformationObject, kAreaFloodNumbersPropertyName, LocalAreaFloodNumberArray)") },
	{ Name: "EngineTransmitOwnSharedSerialNumber", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalSharedChangeInformationObject, kSerialNumberPropertyName, v8::Integer::New(pIsolate, nSerialNumber))", "SetInteger(pIsolate, LocalContext, LocalSharedChangeInformationObject, kSerialNumberPropertyName, nSerialNumber)") },
	{ Name: "EngineTransmitOwnSharedChangeInformationCount", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalSharedChangeInformationObject, kChangeInformationCountPropertyName, v8::Integer::New(pIsolate, nChangeInformationCount))", "SetInteger(pIsolate, LocalContext, LocalSharedChangeInformationObject, kChangeInformationCountPropertyName, nChangeInformationCount)") },
	{ Name: "EngineTransmitOwnAccessorChangeInformation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalChangeInformationAccessorObject, kChangeInformationPropertyName, v8::Integer::New(pIsolate, nChangeInformation))", "SetInteger(pIsolate, LocalContext, LocalChangeInformationAccessorObject, kChangeInformationPropertyName, nChangeInformation)") },
	{ Name: "EngineTransmitOwnAccessorSerialNumber", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Build transmit-record own fields without inherited interference", TransmitRecordSource: ReplaceOnce(g_strTransmitRecordHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalChangeInformationAccessorObject, kSerialNumberPropertyName, v8::Integer::New(pIsolate, nChangeInformationSerialNumber))", "SetInteger(pIsolate, LocalContext, LocalChangeInformationAccessorObject, kSerialNumberPropertyName, nChangeInformationSerialNumber)") },
	{ Name: "EngineTextMessageOwnColor", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create own copied text-message fields without inherited interference", TextMessageSource: ReplaceOnce(g_strTextMessageHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalTextMessageColorObject, kRedPropertyName, v8::Integer::New(pIsolate, arrColorChannelValues[kRedChannelIndex]))", "SetInteger(pIsolate, LocalContext, LocalTextMessageColorObject, kRedPropertyName, arrColorChannelValues[kRedChannelIndex])") },
	{ Name: "EngineTextMessageOwnOuter", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create own copied text-message fields without inherited interference", TextMessageSource: ReplaceOnce(g_strTextMessageHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalTextMessageObject, kEffectPropertyName, v8::Integer::New(pIsolate, TextMessage.effect))", "SetInteger(pIsolate, LocalContext, LocalTextMessageObject, kEffectPropertyName, TextMessage.effect)") },
	{ Name: "EnginePlayerInformationOwnOuter", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create own copied player information fields and custom-file indices", EnginePlayerInformationSource: ReplaceOnce(g_strEnginePlayerInformationHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalPlayerInformationObject, kNamePropertyName, MakeString(pIsolate, PlayerInformation.name))", "SetString(pIsolate, LocalContext, LocalPlayerInformationObject, kNamePropertyName, PlayerInformation.name)") },
	{ Name: "EnginePlayerInformationOwnIndices", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create own copied player information fields and custom-file indices", EnginePlayerInformationSource: ReplaceOnce(g_strEnginePlayerInformationHelpers, "LocalPlayerCustomFilesArray->CreateDataProperty(", "LocalPlayerCustomFilesArray->Set(") },
	{ Name: "Current", Source: g_strThrowError, GameEventProfile: true },
	...[
		{ Name: "Contents", Expression: "SetRecordProperty(pIsolate, LocalContext, LocalPointContentsResultObject, kContentsPropertyName, v8::Integer::New(pIsolate, nPointContents))" },
		{ Name: "Mask", Expression: "SetRecordProperty(pIsolate, LocalContext, LocalPointContentsResultObject, kMaskPropertyName, v8::Integer::NewFromUnsigned(pIsolate, static_cast<std::uint32_t>(unContentsMask)))" },
		{ Name: "Entity", Expression: "SetRecordProperty(pIsolate, LocalContext, LocalPointContentsResultObject, kEntityPropertyName, LocalEntityValue)" },
		{ Name: "Entities", Expression: "SetRecordProperty(pIsolate, LocalContext, LocalPointContentsResultObject, kEntitiesPropertyName, LocalEntityIndexArray)" },
	].map(Property => ({ Name: "EventRecordsPointContents" + Property.Name + "Own", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Point contents snapshot native handle before JavaScript record setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, Property.Expression, Property.Expression.replace("SetRecordProperty(", "SetValue(")) })),
	...[
		{ Name: "EntityIndex", Expression: "SetRecordProperty(pIsolate, LocalContext, LocalCollideableObject, kEntityIndexPropertyName, v8::Integer::New(pIsolate, nEntityIndex))" },
		{ Name: "Address", Expression: "SetRecordProperty(pIsolate, LocalContext, LocalCollideableObject, kAddressPropertyName, v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unCollideableAddress)))" },
		{ Name: "Entity", Expression: "SetRecordProperty(pIsolate, LocalContext, LocalCollideableObject, kEntityPropertyName, LocalTraceEntityObject)" },
	].map(Property => ({ Name: "EventRecordsCollideable" + Property.Name + "Own", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Collideable result fields use own data without inherited setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, Property.Expression, Property.Expression.replace("SetRecordProperty(", "SetValue(")) })),
	{ Name: "EventRecordsTracePlaneOwn", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace result records and indexes use own data without inherited setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("MakePlaneObject"), GetDefinition("MakePlaneObject").replaceAll("SetRecordProperty(", "SetValue(")) },
	{ Name: "EventRecordsTraceSurfaceOwn", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace result records and indexes use own data without inherited setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("MakeSurfaceObject"), GetDefinition("MakeSurfaceObject").replaceAll("SetRecordProperty(", "SetValue(")) },
	{ Name: "EventRecordsTraceResultOwn", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace result records and indexes use own data without inherited setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("MakeTraceResultObject"), GetDefinition("MakeTraceResultObject").replaceAll("SetRecordProperty(", "SetValue(")) },
	{ Name: "EventRecordsTraceArrayOwn", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace result records and indexes use own data without inherited setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("MakeTraceEntityIndexArray"), GetDefinition("MakeTraceEntityIndexArray").replaceAll("->CreateDataProperty(", "->Set(")) },
	{ Name: "EventRecordsTraceConstantOwn", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace constants use own data without inherited setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_TraceConstantRecordFixture.Source, g_TraceConstantRecordFixture.Source.replaceAll("SetRecordProperty(", "SetValue(")) },
	{ Name: "EventRecordsTraceSuppliedTarget", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace results snapshot borrowed native data before JavaScript setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("MakeTraceResultObject"), GetDefinition("MakeTraceResultObject").replace("return SetValue(pIsolate, LocalContext, LocalTraceResultObject, pszPropertyName, LocalValue);", "return SetRecordProperty(pIsolate, LocalContext, LocalTraceResultObject, pszPropertyName, LocalValue);")) },
	{ Name: "EventRecordsSoundConstants", Source: "#define SOURCEJS_FIXTURE_LEGACY_SOUND_CONSTANTS 1\n" + g_strThrowError, GameEventProfile: true, ExpectedFailure: "Sound constants use own data properties without inherited setters" },
	{ Name: "EventRecordsTraceEntity", Source: "#define SOURCEJS_FIXTURE_LEGACY_TRACE_ENTITY_RECORD 1\n" + g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace entity records use own data properties without inherited setters" },
	{ Name: "EventRecordsArguments", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize event records with own properties", GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, "if (HookOptionsFailure.HasCaught() || LocalManagerArgumentType.IsEmpty() || !LocalArguments->CreateDataProperty(LocalContext, kManagerArgumentIndex, LocalManagerArgumentType).FromMaybe(false)) {", "if (HookOptionsFailure.HasCaught() || LocalManagerArgumentType.IsEmpty() || !LocalArguments->Set(LocalContext, kManagerArgumentIndex, LocalManagerArgumentType).FromMaybe(false)) {") },
	{ Name: "EventRecordsOptions", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize event records with own properties", GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, "if (!SetRecordProperty(pIsolate, LocalContext, LocalObject, \"ObjectAddress\", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unManagerAddress)))) {", "if (!SetValue(pIsolate, LocalContext, LocalObject, \"ObjectAddress\", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unManagerAddress)))) {") },
	{ Name: "EventRecordsInformation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize event records with own properties", GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, "if (!SetRecordProperty(pIsolate, LocalContext, LocalObject, \"EventName\", MakeString(pIsolate, pszEventName ? pszEventName : \"\"))) {", "if (!SetString(pIsolate, LocalContext, LocalObject, \"EventName\", pszEventName ? pszEventName : \"\")) {") },
	{ Name: "EventRecordsUInt64Get", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize uint64 event exports with own properties", GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, "if (!SetRecordFunction(pIsolate, LocalContext, LocalTargetObject, \"GetUInt64\", GetEventUInt64Callback<TEvent>, LocalRuntimeData)) {", "if (!SetFunction(pIsolate, LocalContext, LocalTargetObject, \"GetUInt64\", GetEventUInt64Callback<TEvent>, LocalRuntimeData)) {") },
	{ Name: "EventRecordsUInt64Set", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize uint64 event exports with own properties", GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, "if (!SetRecordFunction(pIsolate, LocalContext, LocalTargetObject, \"SetUInt64\", SetEventUInt64Callback<TEvent>, LocalRuntimeData)) {", "if (!SetFunction(pIsolate, LocalContext, LocalTargetObject, \"SetUInt64\", SetEventUInt64Callback<TEvent>, LocalRuntimeData)) {") },
	{ Name: "CurrentAllCVarFlags", Source: g_strThrowError, GameEventProfile: true, Positive: true, AllCVarFlags: true },
	{ Name: "CVarFlagsTagsOwnFlag", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize CVar flags with own data properties", CVarPublicAndTagSource: ReplaceOnce(g_strCVarPublicAndTagHelpers, "SetRecordProperty(pIsolate, LocalContext, LocalTargetObject, \"UNREGISTERED\", v8::Integer::New(pIsolate, FCVAR_UNREGISTERED))", "SetInteger(pIsolate, LocalContext, LocalTargetObject, \"UNREGISTERED\", FCVAR_UNREGISTERED)") },
	{ Name: "CVarFlagsTagsOwnArray", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize server tags with own array elements", CVarPublicAndTagSource: ReplaceOnce(g_strCVarPublicAndTagHelpers, "LocalArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unTagIndex), LocalTag)", "LocalArray->Set(LocalContext, static_cast<std::uint32_t>(unTagIndex), LocalTag)") },
	{ Name: "CurrentLegacyBindingRecords", Source: g_strThrowError, GameEventProfile: true, Positive: true, LegacyBindingRecords: true },
	{ Name: "CVarEnumerationOwnIndex", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize command enumeration with own array elements", CVarLookupSource: ReplaceOnce(g_strCVarLookups, "LocalArray->CreateDataProperty(LocalContext, unCommandBaseIndexOut, LocalRecord)", "LocalArray->Set(LocalContext, unCommandBaseIndexOut, LocalRecord)") },
	{ Name: "BindingRecordsCommandNested", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize binding records with own fields", BindingRecordsSource: ReplaceOnce(g_strBindingRecordHelpers, "if (!SetRecordProperty(pIsolate, LocalContext, LocalCommandReturn, \"Continue\", v8::Integer::New(pIsolate, kContinueResult))) {", "if (!SetInteger(pIsolate, LocalContext, LocalCommandReturn, \"Continue\", kContinueResult)) {") },
	{ Name: "BindingRecordsCommandExport", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize binding records with own fields", BindingRecordsSource: ReplaceOnce(g_strBindingRecordHelpers, "if (!SetRecordProperty(pIsolate, LocalContext, LocalTargetModule, \"CONTINUE\", v8::Integer::New(pIsolate, kContinueResult))) {", "if (!SetInteger(pIsolate, LocalContext, LocalTargetModule, \"CONTINUE\", kContinueResult)) {") },
	{ Name: "BindingRecordsCommandLimit", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize binding records with own fields", BindingRecordsSource: ReplaceOnce(g_strBindingRecordHelpers, "if (!SetRecordProperty(pIsolate, LocalContext, LocalTargetModule, \"MAX_COMMAND_LENGTH\", v8::Integer::New(pIsolate, FixtureCommandSDK::MaxCommandLength()))) {", "if (!SetInteger(pIsolate, LocalContext, LocalTargetModule, \"MAX_COMMAND_LENGTH\", FixtureCommandSDK::MaxCommandLength())) {") },
	{ Name: "BindingRecordsCommandNamespace", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize binding records with own fields", BindingRecordsSource: ReplaceOnce(g_strBindingRecordHelpers, "if (!LocalTargetModule->CreateDataProperty(LocalContext, LocalCommandReturnName, LocalCommandReturn).FromMaybe(false)) {", "if (!LocalTargetModule->Set(LocalContext, LocalCommandReturnName, LocalCommandReturn).FromMaybe(false)) {") },
	{ Name: "BindingRecordsCommandMethod", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize binding records with own fields", BindingRecordsSource: ReplaceOnce(g_strBindingRecordHelpers, "if (!SetRecordFunction(pIsolate, LocalContext, LocalTargetModule, \"GetCommandReturnNumber\", GetCommandReturnNumberCallback, LocalUndefinedValue)) {", "if (!SetFunction(pIsolate, LocalContext, LocalTargetModule, \"GetCommandReturnNumber\", GetCommandReturnNumberCallback, LocalUndefinedValue)) {") },
	{ Name: "BindingRecordsHookNested", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize binding records with own fields", BindingRecordsSource: ReplaceOnce(g_strBindingRecordHelpers, "if (!SetRecordProperty(pIsolate, LocalContext, LocalHookTypeObject, \"Pre\", v8::Integer::New(pIsolate, HOOKTYPE_PRE))) {", "if (!SetInteger(pIsolate, LocalContext, LocalHookTypeObject, \"Pre\", HOOKTYPE_PRE)) {") },
	{ Name: "BindingRecordsHookExport", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize binding records with own fields", BindingRecordsSource: ReplaceOnce(g_strBindingRecordHelpers, "if (!SetRecordProperty(pIsolate, LocalContext, LocalTargetModule, \"PRE\", v8::Integer::New(pIsolate, HOOKTYPE_PRE))) {", "if (!SetInteger(pIsolate, LocalContext, LocalTargetModule, \"PRE\", HOOKTYPE_PRE)) {") },
	{ Name: "BindingRecordsHookNamespace", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize binding records with own fields", BindingRecordsSource: ReplaceOnce(g_strBindingRecordHelpers, "if (!LocalTargetModule->CreateDataProperty(LocalContext, LocalHookTypeName, LocalHookTypeObject).FromMaybe(false)) {", "if (!LocalTargetModule->Set(LocalContext, LocalHookTypeName, LocalHookTypeObject).FromMaybe(false)) {") },
	{ Name: "ConsoleBootstrapLegacy", Source: g_strThrowError, Positive: true, GameEventProfile: true, ConsoleOldAPI: true },
	{ Name: "ConsoleBootstrapUnified", Source: g_strThrowError, Positive: true, GameEventProfile: true, ConsoleUnified: true },
	{ Name: "ConsoleBootstrapConnectionOwnership", Source: g_strThrowError, GameEventProfile: true, ConsoleBootstrapSource: ReplaceOnce(g_strConsoleBootstrap, "m_bSDKLibrariesConnected = true;", "m_bSDKLibrariesConnected = false;") },
	{ Name: "ConsoleBootstrapRegistrationOwnership", Source: g_strThrowError, GameEventProfile: true, ConsoleBootstrapSource: ReplaceOnce(g_strConsoleBootstrap, "m_bCVarsRegistered = true;\n\t\tFixtureConsoleSDK::Register(0);", "FixtureConsoleSDK::Register(0);\n\t\tm_bCVarsRegistered = true;") },
	{ Name: "ConsoleBootstrapRuntimeGuard", Source: g_strThrowError, GameEventProfile: true, ConsoleBootstrapSource: ReplaceOnce(g_strConsoleBootstrap, "if (g_bConsoleRuntimeInitialized)", "if (!g_bConsoleRuntimeInitialized)") },
	{ Name: "ConsoleBootstrapDisconnect", Source: g_strThrowError, GameEventProfile: true, ConsoleBootstrapSource: g_strConsoleBootstrap.replaceAll("FixtureConsoleSDK::Disconnect();", "FixtureConsoleSDK::ReportDiagnostic(\"Deliberately omit disconnect\");") },
	{ Name: "ConsoleBootstrapRepeatConnection", Source: g_strThrowError, GameEventProfile: true, ConsoleBootstrapSource: ReplaceOnce(g_strConsoleBootstrap, "if (!m_bSDKLibrariesConnected)", "if (g_bConsoleInterfaceAvailable)") },
	...[
		{ Name: "PlayerBanDurationCoercion", Old: g_strPlayerBanDurationValidation, New: g_strPlayerBanCoercedDurationProbe },
		{ Name: "PlayerBanDurationFractionGuard", Old: "(std::floor(dblBanDuration) != dblBanDuration)", New: "false" },
		{ Name: "PlayerBanDurationNegativeGuard", Old: "(dblBanDuration < 0)", New: "(dblBanDuration < -1)" },
		{ Name: "PlayerBanDurationUpperBoundary", Old: "(dblBanDuration > kMaximumBanDuration)", New: "(dblBanDuration >= kMaximumBanDuration)" },
		{ Name: "PlayerBanDurationDefault", Old: "constexpr int kDefaultBanDuration = 0;", New: "constexpr int kDefaultBanDuration = 1;" },
	].map(Probe => ({ Name: Probe.Name, Source: g_strThrowError, GameEventProfile: true, PlayerSource: ReplaceOnce(g_strPlayerHelpers, g_strPlayerBanCallback, ReplaceOnce(g_strPlayerBanCallback, Probe.Old, Probe.New)) })),
	...g_vecRepeatedNumericProbes.map((strProbe, unProbeIndex) => ({ Name: "InstallationRepeated" + g_vecRepeatedNumericTypes[unProbeIndex].Name + "Revalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Revalidate numeric repeated-field writes after value coercion", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strProbe, ReplaceOnce(strProbe, g_strRepeatedNumericGuard, "")) })),
	{ Name: "InstallationUserMessageZeroBitDispatch", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Never dispatch a zero-bit user-message write to the SDK", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strUserMessageBitWriter, ReplaceOnce(g_strUserMessageBitWriter, "\t\t\tif (nBitCount == 0) {\n\t\t\t\treturn !pBitBuffer->IsOverflowed();\n\t\t\t}\n\n", "")) },
	{ Name: "InstallationUserMessageBitWidthMask", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Never send high bits outside the user-message field width to the SDK", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strUserMessageBitWriter, ReplaceOnce(g_strUserMessageBitWriter, "const std::uint32_t unMaskedBitValue = (nBitCount == kMaximumUnsignedIntegerBitCount) ? unBitValue : (unBitValue & ((std::uint32_t(1) << nBitCount) - 1));", "const std::uint32_t unMaskedBitValue = unBitValue;")) },
	...[
		{ Name: "InstallationRecipientLiveIndex", Owner: g_strMessageRecipientFactory, Before: "vecRecipientEntityIndices[unRecipientListIndex]", After: "pRecipientFilter->GetRecipientIndex(static_cast<int>(unRecipientListIndex))", Declaration: "", ExpectedFailure: "Preserve recipient snapshots across controlled output construction" },
		{ Name: "InstallationRecipientLateReliable", Owner: g_strMessageRecipientFactory, Before: '"Reliable", v8::Boolean::New(pIsolate, bReliable)', After: '"Reliable", v8::Boolean::New(pIsolate, pRecipientFilter->IsReliable())', Declaration: "\t\t\t\tconst bool bReliable = pRecipientFilter->IsReliable();\n", ExpectedFailure: "Preserve recipient snapshots across controlled output construction" },
		{ Name: "InstallationRecipientLateInitialization", Owner: g_strMessageRecipientFactory, Before: '"InitializationMessage", v8::Boolean::New(pIsolate, bInitializationMessage)', After: '"InitializationMessage", v8::Boolean::New(pIsolate, pRecipientFilter->IsInitMessage())', Declaration: "\t\t\t\tconst bool bInitializationMessage = pRecipientFilter->IsInitMessage();\n", ExpectedFailure: "Preserve recipient snapshots across controlled output construction" },
		{ Name: "InstallationProtobufRecipientLiveIndex", Owner: g_strProtobufRecipientFactory, Before: "vecRecipientEntityIndices[unRecipientPosition]", After: "pRecipientFilter->GetRecipientIndex(static_cast<int>(unRecipientPosition))", Declaration: "", ExpectedFailure: "Preserve recipient snapshots across controlled output construction" },
		{ Name: "InstallationProtobufRecipientLateReliable", Owner: g_strProtobufRecipientFactory, Before: '"Reliable", v8::Boolean::New(pIsolate, bReliable)', After: '"Reliable", v8::Boolean::New(pIsolate, pRecipientFilter->IsReliable())', Declaration: "\t\t\t\tconst bool bReliable = pRecipientFilter->IsReliable();\n", ExpectedFailure: "Preserve recipient snapshots across controlled output construction" },
		{ Name: "InstallationProtobufRecipientLateInitialization", Owner: g_strProtobufRecipientFactory, Before: '"InitializationMessage", v8::Boolean::New(pIsolate, bInitializationMessage)', After: '"InitializationMessage", v8::Boolean::New(pIsolate, pRecipientFilter->IsInitMessage())', Declaration: "\t\t\t\tconst bool bInitializationMessage = pRecipientFilter->IsInitMessage();\n", ExpectedFailure: "Preserve recipient snapshots across controlled output construction" },
		{ Name: "InstallationBitBufferLateCursor", Owner: g_strMessageBitBufferFactory, Before: '"CurrentBit", v8::Integer::New(pIsolate, nCurrentBitIndex)', After: '"CurrentBit", v8::Integer::New(pIsolate, pBitBuffer->GetNumBitsWritten())', Declaration: "\t\t\t\tconst int nCurrentBitIndex = pBitBuffer->GetNumBitsWritten();\n", ExpectedFailure: "Preserve bit-buffer snapshots across controlled output construction" },
		{ Name: "InstallationBitBufferLateOverflow", Owner: g_strMessageBitBufferFactory, Before: '"Overflowed", v8::Boolean::New(pIsolate, bOverflowed)', After: '"Overflowed", v8::Boolean::New(pIsolate, pBitBuffer->IsOverflowed())', Declaration: "\t\t\t\tconst bool bOverflowed = pBitBuffer->IsOverflowed();\n", ExpectedFailure: "Preserve bit-buffer snapshots across controlled output construction" },
	].map(Probe => {
		const strLateRead = ReplaceOnce(Probe.Owner, Probe.Before, Probe.After);
		const strRegression = Probe.Declaration ? ReplaceOnce(strLateRead, Probe.Declaration, "") : strLateRead;

		return { Name: Probe.Name, Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: Probe.ExpectedFailure, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, Probe.Owner, strRegression) };
	}),
	...g_vecInstallationOwners.map((strOwner, unIndex) => ({ Name: "InstallationNativeUnwind" + unIndex, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strOwner, RemoveInstallationUnwindGuard(strOwner)) })),
	{ Name: "InstallationTruncatedMessageName", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMessageIndexCallback, ReplaceOnce(g_strMessageIndexCallback, "strUserMessageName.find('\\0') != std::string::npos", "false")) },
	...g_vecMessageParserOwners.map((strOwner, unIndex) => ({ Name: "InstallationParserUnwind" + unIndex, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strOwner, RemoveInstallationUnwindGuard(strOwner)) })),
	...g_vecChatReadOwners.map((strOwner, unIndex) => ({ Name: "InstallationChatUnwind" + unIndex, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strOwner, RemoveInstallationUnwindGuard(strOwner)) })),
	...g_vecRawNameProbes.map((strProbe, unIndex) => ({ Name: "InstallationRawName" + unIndex, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strProbe, ReplaceOnce(strProbe, "strUserMessageName.find('\\0') != std::string::npos", "false")) })),
	{ Name: "InstallationScopeCleanup", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMessageScope, ReplaceOnce(g_strMessageScope, "\t\t\t\tEndUserMessage();", "\t\t\t\t// Deliberately omit cleanup.")) },
	{ Name: "InstallationScopeClearOrder", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMessageScope, ReplaceOnce(g_strMessageScope, "m_pEngineServer = nullptr;\n\t\t\tpEngineServer->MessageEnd();", "pEngineServer->MessageEnd();\n\t\t\tm_pEngineServer = nullptr;")) },
	{ Name: "CurrentCSGO", Source: g_strThrowError, Positive: true, CSGO: true, GameEventProfile: true },
	{ Name: "CurrentNoEventUInt64", Source: g_strThrowError, Positive: true, NoEventUInt64: true, GameEventProfile: true },
	{ Name: "CurrentNoVoiceInterface", Source: g_strThrowError, Positive: true, NoVoiceInterface: true, GameEventProfile: true },
	{ Name: "CurrentNoVoiceProximity", Source: g_strThrowError, Positive: true, NoVoiceProximity: true, GameEventProfile: true },
	{ Name: "CurrentOldConsoleAPI", Source: g_strThrowError, Positive: true, OldConsoleAPI: true, GameEventProfile: true },
	{ Name: "CurrentNoQueryCVarStatus", Source: g_strThrowError, Positive: true, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "#define SOURCEJS_FIXTURE_HAS_QUERY_CVAR_STATUS", "// Controlled SDK omits query status enumerators.") },
	{ Name: "CurrentNoGlobalMethods", Source: g_strThrowError, Positive: true, GameEventProfile: true, DatamapSource: "#define SOURCEJS_FIXTURE_NO_GLOBAL_METHODS\n" + g_strDatamapCallbacks },
	{ Name: "InstallationMessageHookOwnArguments", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve own message hook fields and dense snapshot arrays", DatamapSource: RevertInstallationOwnRecordWrites("HookArguments") },
	{ Name: "InstallationMessageHookOwnFields", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve own message hook fields and dense snapshot arrays", DatamapSource: RevertInstallationOwnRecordWrites("HookFields") },
	{ Name: "InstallationMessageRecipientOwnIndices", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve own message hook fields and dense snapshot arrays", DatamapSource: RevertInstallationOwnRecordWrites("RecipientIndices") },
	{ Name: "InstallationMessageRecipientOwnFields", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve own message hook fields and dense snapshot arrays", DatamapSource: RevertInstallationOwnRecordWrites("RecipientFields") },
	{ Name: "InstallationMessageBitBufferOwnFields", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve own message hook fields and dense snapshot arrays", DatamapSource: RevertInstallationOwnRecordWrites("BitBufferFields") },
	...["RecipientIndices", "RecipientFields", "BindingAddress", "BindingOperation", "Methods"].map(strFamily => ({ Name: "InstallationProtobufOwn" + strFamily, Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve own message hook fields and dense snapshot arrays", DatamapSource: RevertProtobufInstallationWrites(strFamily) })),
	{ Name: "InstallationGlobalsOwnMethods", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve globals methods and message constant own records", DatamapSource: RevertInstallationOwnRecordWrites("GlobalsMethods") },
	{ Name: "InstallationBaseMessageFields", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve globals methods and message constant own records", DatamapSource: RevertInstallationOwnRecordWrites("BaseFields") },
	{ Name: "InstallationBaseMessageContainers", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve globals methods and message constant own records", DatamapSource: RevertInstallationOwnRecordWrites("BaseContainers") },
	{ Name: "InstallationBaseMessageFractionBits", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve globals methods and message constant own records", DatamapSource: RevertInstallationOwnRecordWrites("BaseFractionBits") },
	{ Name: "InstallationDialogOwnFields", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve globals methods and message constant own records", DatamapSource: RevertInstallationOwnRecordWrites("DialogFields") },
	{ Name: "InstallationGlobalsSDKBranchOwnField", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve globals SDKBranch own field and branch shape", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strGlobalsObjectFactory, ReplaceOnce(g_strGlobalsObjectFactory, "SetRecordProperty(pIsolate, LocalContext, LocalGlobalVariablesInformation, \"SDKBranch\", MakeString(pIsolate, SOURCEJS_SDK_BRANCH))", "SetString(pIsolate, LocalContext, LocalGlobalVariablesInformation, \"SDKBranch\", SOURCEJS_SDK_BRANCH)")) },
	{ Name: "ServerConstantsMapLoadFields", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve server constant own records and branch shape", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMapLoadTypeInstaller, g_vecMapLoadConstantWriteMutations.reduce((strBody, vecWrite) => ReplaceOnce(strBody, vecWrite[0], vecWrite[1]), g_strMapLoadTypeInstaller)) },
	{ Name: "ServerConstantsQueryFields", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve server constant own records and branch shape", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strServerConstantsCallback, g_vecQueryCVarStatusWriteMutations.reduce((strBody, vecWrite) => ReplaceOnce(strBody, vecWrite[0], vecWrite[1]), g_strServerConstantsCallback)) },
	{ Name: "ServerConstantsQueryContainer", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve server constant own records and branch shape", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strServerConstantsCallback, ReplaceOnce(g_strServerConstantsCallback, "SetRecordProperty(pIsolate, LocalContext, LocalServerConstantsObject, kQueryCVarStatusPropertyName, LocalQueryCVarStatusObject)", "SetValue(pIsolate, LocalContext, LocalServerConstantsObject, kQueryCVarStatusPropertyName, LocalQueryCVarStatusObject)")) },
	{ Name: "ServerConstantsMapSlot", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve server constant own records and branch shape", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strServerConstantsCallback, ReplaceOnce(g_strServerConstantsCallback, "SetRecordProperty(pIsolate, LocalContext, LocalServerConstantsObject, kMapLoadTypePropertyName, v8::Undefined(pIsolate))", "SetValue(pIsolate, LocalContext, LocalServerConstantsObject, kMapLoadTypePropertyName, v8::Undefined(pIsolate))")) },
	{ Name: "SentencePickSequentialOwnIndex", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve sequential picked sentence own fields and native buffer contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSequentialPickedSentenceCallback, ReplaceOnce(g_strSequentialPickedSentenceCallback, "SetRecordProperty(pIsolate, LocalContext, LocalPickedSentenceObject, kSentenceIndexPropertyName, v8::Integer::New(pIsolate, nPickedSentenceIndex))", "SetInteger(pIsolate, LocalContext, LocalPickedSentenceObject, kSentenceIndexPropertyName, nPickedSentenceIndex)")) },
	{ Name: "SentencePickSequentialOwnName", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve sequential picked sentence own fields and native buffer contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSequentialPickedSentenceCallback, ReplaceOnce(g_strSequentialPickedSentenceCallback, "SetRecordProperty(pIsolate, LocalContext, LocalPickedSentenceObject, kSentenceNamePropertyName, MakeString(pIsolate, szSentenceName))", "SetString(pIsolate, LocalContext, LocalPickedSentenceObject, kSentenceNamePropertyName, szSentenceName)")) },
	{ Name: "SentencePickOwnIndex", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve picked sentence own fields and native buffer contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPickedSentenceCallback, ReplaceOnce(g_strPickedSentenceCallback, "SetRecordProperty(pIsolate, LocalContext, LocalPickedSentenceObject, kSentenceIndexPropertyName, v8::Integer::New(pIsolate, nSentenceIndex))", "SetInteger(pIsolate, LocalContext, LocalPickedSentenceObject, kSentenceIndexPropertyName, nSentenceIndex)")) },
	{ Name: "SentencePickOwnName", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve picked sentence own fields and native buffer contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPickedSentenceCallback, ReplaceOnce(g_strPickedSentenceCallback, "SetRecordProperty(pIsolate, LocalContext, LocalPickedSentenceObject, kSentenceNamePropertyName, MakeString(pIsolate, szSentenceName))", "SetString(pIsolate, LocalContext, LocalPickedSentenceObject, kSentenceNamePropertyName, szSentenceName)")) },
	{ Name: "PaintMapRLEOwnIndices", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create paint-map RLE indices without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "LocalPaintMapDataRLEArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unPaintMapDataRLEEntryIndex), LocalPaintMapDataRLEEntryValue)", "LocalPaintMapDataRLEArray->Set(LocalContext, static_cast<std::uint32_t>(unPaintMapDataRLEEntryIndex), LocalPaintMapDataRLEEntryValue)") },
	{ Name: "CurrentNoBaseEntity", Source: g_strThrowError, Positive: true, NoBaseEntity: true, GameEventProfile: true },
	{ Name: "CurrentNoVectorXY", Source: g_strThrowError, Positive: true, NoVectorXY: true, GameEventProfile: true },
	{ Name: "CurrentNoInt64SendProxies", Source: g_strThrowError, Positive: true, NoInt64SendProxies: true, GameEventProfile: true },
	{ Name: "CurrentNoConVarCreation", Source: g_strThrowError, Positive: true, NoConVarCreation: true },
	{ Name: "CVarOwnedLegacy", Source: g_strThrowError, Positive: true, LegacyConVars: true },
	{ Name: "CVarOwnedRegistration", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, "!RegisterFixtureConVar(pConVar)", "!RegisterFixtureConVar(pConVar, true)") },
	{ Name: "CVarOwnedCacheReuse", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, "return pStorage->m_strName == strName;", "return pStorage->m_strName.empty() && strName.empty();") },
	{ Name: "CVarOwnedUnregisteredFlag", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, "!SourceJSConCommandFlagIsSet(pConVar, FCVAR_UNREGISTERED) && ", "") },
	{ Name: "CVarOwnedCleanup", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, "UnregisterFixtureConVar(pConVar);", "UnregisterFixtureConVar(pConVar, true);") },
	{ Name: "CVarOwnedNameRecheck", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, "auto* const pCurrentCommandBase = FindFixtureCommandBase(strConVarName);", "auto* const pCurrentCommandBase = FindFixtureCommandBase(strConVarName, true);") },
	{ Name: "CVarOwnedLegacyMarker", Source: g_strThrowError, LegacyConVars: true, CVarOperationSource: ReplaceOnce(g_strCVarOperations, "nCreationFlags |= kSourceJSOwnedCommandFlag;", "nCreationFlags |= nFlags;") },
	{ Name: "CurrentNoNotify", Source: g_strThrowError, Positive: true, NoNotify: true },
	{ Name: "MapLoadTypeNativeUnwind", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMapLoadTypeInstaller, ReplaceOnce(g_strMapLoadTypeInstaller, "if (InstallationFailure.HasCaught()) {\n\t\t\t\t\tInstallationFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;")) },
	{ Name: "MapLoadTypeRegularRethrow", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMapLoadTypeInstaller, ReplaceOnce(g_strMapLoadTypeInstaller, "\t\t\t\t\tif (InstallationFailure.HasCaught()) {\n\t\t\t\t\t\tInstallationFailure.ReThrow();\n\t\t\t\t\t}", "\t\t\t\t\tif (InstallationFailure.HasCaught()) {\n\t\t\t\t\t\tInstallationFailure.Reset();\n\t\t\t\t\t}")) },
	...[
		["SpatialPartitionEarlyRelease", "std::unique_ptr<ISpatialPartition, decltype(ReleaseSpatialPartition)> pSpatialPartitionOwner(pSpatialPartition, ReleaseSpatialPartition);", "std::unique_ptr<ISpatialPartition, decltype(ReleaseSpatialPartition)> pSpatialPartitionOwner(pSpatialPartition, ReleaseSpatialPartition);\n\t\t\t\tpSpatialPartitionOwner.release();"],
		["SpatialPartitionMissingHandoff", "pSpatialPartitionOwner.release();", ""],
		["SpatialPartitionCleanupFailure", "bSpatialPartitionCleanupFailed = !ReleaseUnreturnedEngineServerSpatialPartition(pEngineServer, pUnreturnedSpatialPartition);", "ReleaseUnreturnedEngineServerSpatialPartition(pEngineServer, pUnreturnedSpatialPartition);"],
	].map(vecMutation => ({ Name: vecMutation[0], Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSpatialPartitionCallback, ReplaceOnce(g_strSpatialPartitionCallback, vecMutation[1], vecMutation[2])) })),
	{ Name: "SpatialPartitionUnguardedConstruction", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve guarded spatial-partition construction and nested cleanup", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSpatialPartitionHelpers, ReplaceOnce(g_strSpatialPartitionHelpers, g_strSpatialPartitionDestroyCallback, g_strSpatialPartitionUnguardedDestroy)) },
	{ Name: "SpatialPartitionMissingParentScope", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve guarded spatial-partition construction and nested cleanup", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSpatialPartitionHelpers, ReplaceOnce(g_strSpatialPartitionHelpers, "m_pPreviousScope = m_pCurrentScope;", "m_pPreviousScope = nullptr;")) },
	{ Name: "SpatialPartitionMovementRevalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve SolidMoved identity, fresh collideable, coercion and error-order contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMovementHelpers, ReplaceOnce(g_strMovementHelpers, g_strMovementCallback, ReplaceOnce(g_strMovementCallback, "if (bNeedsEntityRevalidation) {", "if (bNeedsEntityRevalidation && false) {"))) },
	{ Name: "SpatialPartitionMovementSerial", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve SolidMoved identity, fresh collideable, coercion and error-order contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMovementHelpers, ReplaceOnce(g_strMovementHelpers, g_strMovementHandleResolver, ReplaceOnce(g_strMovementHandleResolver, "(LiveHandle.ToInt() != EntityHandle.ToInt())", "(LiveHandle.GetEntryIndex() != EntityHandle.GetEntryIndex())"))) },
	{ Name: "SpatialPartitionMovementEdictRefresh", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve SolidMoved identity, fresh collideable, coercion and error-order contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMovementHelpers, ReplaceOnce(g_strMovementHelpers, g_strMovementCallback, ReplaceOnce(g_strMovementCallback, "\t\t\t\t\tpEntityEdict = GetFixtureMovementEdictFromIndex(nCurrentEntityIndex);", "\t\t\t\t\tGetFixtureMovementEdictFromIndex(nCurrentEntityIndex);"))) },
	{ Name: "SpatialPartitionMovementCollideableRefresh", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve SolidMoved identity, fresh collideable, coercion and error-order contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strMovementHelpers, ReplaceOnce(g_strMovementHelpers, g_strMovementCallback, ReplaceOnce(g_strMovementCallback, "\t\t\t\t\t\tpCollideable = pEntityEdict->GetCollideable();", "\t\t\t\t\t\tpEntityEdict->GetCollideable();"))) },
	{ Name: "SpatialPartitionPVSStackAddress", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create PVS own fields without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "MakeEngineServerAddressObject(pIsolate, LocalContext, kPVSInformationTypeName, pBorrowedPVSInformation)", "MakeEngineServerAddressObject(pIsolate, LocalContext, kPVSInformationTypeName, pPVSInformation)"))) },
	{ Name: "SpatialPartitionPVSAllocationError", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve PVS copied values, borrowed addresses and allocation failures", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "ThrowError(pIsolate, kClusterSnapshotAllocationErrorMessage);", "if (pIsolate->IsExecutionTerminating()) {\n\t\t\t\t\t\t\tThrowError(pIsolate, kClusterSnapshotAllocationErrorMessage);\n\t\t\t\t\t\t}"))) },
	{ Name: "SpatialPartitionPVSOwnHeadNode", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create PVS own fields without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "SetRecordProperty(pIsolate, LocalContext, LocalPVSInformationObject, kHeadNodePropertyName, v8::Integer::New(pIsolate, pPVSInformation->m_nHeadNode))", "SetInteger(pIsolate, LocalContext, LocalPVSInformationObject, kHeadNodePropertyName, pPVSInformation->m_nHeadNode)"))) },
	{ Name: "SpatialPartitionPVSOwnClusterCount", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create PVS own fields without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "SetRecordProperty(pIsolate, LocalContext, LocalPVSInformationObject, kClusterCountPropertyName, v8::Integer::New(pIsolate, pPVSInformation->m_nClusterCount))", "SetInteger(pIsolate, LocalContext, LocalPVSInformationObject, kClusterCountPropertyName, pPVSInformation->m_nClusterCount)"))) },
	{ Name: "SpatialPartitionPVSOwnArea", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create PVS own fields without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "SetRecordProperty(pIsolate, LocalContext, LocalPVSInformationObject, kAreaPropertyName, v8::Integer::New(pIsolate, pPVSInformation->m_nAreaNum))", "SetInteger(pIsolate, LocalContext, LocalPVSInformationObject, kAreaPropertyName, pPVSInformation->m_nAreaNum)"))) },
	{ Name: "SpatialPartitionPVSOwnSecondaryArea", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create PVS own fields without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "SetRecordProperty(pIsolate, LocalContext, LocalPVSInformationObject, kSecondaryAreaPropertyName, v8::Integer::New(pIsolate, pPVSInformation->m_nAreaNum2))", "SetInteger(pIsolate, LocalContext, LocalPVSInformationObject, kSecondaryAreaPropertyName, pPVSInformation->m_nAreaNum2)"))) },
	{ Name: "SpatialPartitionPVSOwnCenter", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create PVS own fields without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "SetRecordProperty(pIsolate, LocalContext, LocalPVSInformationObject, kCenterPropertyName, LocalCenterObject)", "SetValue(pIsolate, LocalContext, LocalPVSInformationObject, kCenterPropertyName, LocalCenterObject)"))) },
	{ Name: "SpatialPartitionPVSOwnIndices", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create copied PVS indices without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "LocalPVSClusterArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unPVSClusterIndex), LocalPVSClusterValue)", "LocalPVSClusterArray->Set(LocalContext, static_cast<std::uint32_t>(unPVSClusterIndex), LocalPVSClusterValue)"))) },
	{ Name: "SpatialPartitionPVSOwnClusters", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Create PVS own fields without inherited interference", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strPVSSnapshotHelpers, ReplaceOnce(g_strPVSSnapshotHelpers, g_strPVSSnapshotBody, ReplaceOnce(g_strPVSSnapshotBody, "SetRecordProperty(pIsolate, LocalContext, LocalPVSInformationObject, kClustersPropertyName, LocalPVSClusterArray)", "SetValue(pIsolate, LocalContext, LocalPVSInformationObject, kClustersPropertyName, LocalPVSClusterArray)"))) },
	...[
		["CoreRecordCommandMissingExists", "SetRecordProperty(pIsolate, LocalContext, LocalMissingCommandObject, kExistsPropertyName, v8::Boolean::New(pIsolate, false))", "SetBoolean(pIsolate, LocalContext, LocalMissingCommandObject, kExistsPropertyName, false)"],
		["CoreRecordCommandConVarIsCommand", "SetRecordProperty(pIsolate, LocalContext, LocalConVarObject, kIsCommandPropertyName, v8::Boolean::New(pIsolate, false))", "SetBoolean(pIsolate, LocalContext, LocalConVarObject, kIsCommandPropertyName, false)"],
		["CoreRecordCommandConVarType", "SetRecordProperty(pIsolate, LocalContext, LocalConVarObject, kTypePropertyName, MakeString(pIsolate, kConVarTypeValue))", "SetString(pIsolate, LocalContext, LocalConVarObject, kTypePropertyName, kConVarTypeValue)"],
		["CoreRecordCommandIsCommand", "SetRecordProperty(pIsolate, LocalContext, LocalCommandObject, kIsCommandPropertyName, v8::Boolean::New(pIsolate, true))", "SetBoolean(pIsolate, LocalContext, LocalCommandObject, kIsCommandPropertyName, true)"],
		["CoreRecordCommandType", "SetRecordProperty(pIsolate, LocalContext, LocalCommandObject, kTypePropertyName, MakeString(pIsolate, kCommandTypeValue))", "SetString(pIsolate, LocalContext, LocalCommandObject, kTypePropertyName, kCommandTypeValue)"],
		["CoreRecordCommandName", "SetRecordProperty(pIsolate, LocalContext, LocalCommandObject, kNamePropertyName, MakeString(pIsolate, pCommandBase->GetName()))", "SetString(pIsolate, LocalContext, LocalCommandObject, kNamePropertyName, pCommandBase->GetName())"],
		["CoreRecordCommandHelp", "SetRecordProperty(pIsolate, LocalContext, LocalCommandObject, kHelpPropertyName, MakeString(pIsolate, pCommandBase->GetHelpText()))", "SetString(pIsolate, LocalContext, LocalCommandObject, kHelpPropertyName, pCommandBase->GetHelpText())"],
		["CoreRecordCommandAddress", "SetRecordProperty(pIsolate, LocalContext, LocalCommandObject, kAddressPropertyName, v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unCommandAddress)))", "SetValue(pIsolate, LocalContext, LocalCommandObject, kAddressPropertyName, v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unCommandAddress)))"],
	].map(vecMutation => ({ Name: vecMutation[0], Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize command metadata with own data properties", ConCommandSource: ReplaceOnce(g_strConCommandProperties, vecMutation[1], vecMutation[2]) })),
	...[
		["CoreRecordInformationVersion", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"Version\", MakeString(pIsolate, SOURCEJS_VERSION))", "SetString(pIsolate, LocalContext, LocalObject, \"Version\", SOURCEJS_VERSION)"],
		["CoreRecordInformationGitCommit", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"GitCommit\", MakeString(pIsolate, SOURCEJS_GIT_COMMIT))", "SetString(pIsolate, LocalContext, LocalObject, \"GitCommit\", SOURCEJS_GIT_COMMIT)"],
		["CoreRecordInformationSDKBranch", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"SDKBranch\", MakeString(pIsolate, SOURCEJS_SDK_BRANCH))", "SetString(pIsolate, LocalContext, LocalObject, \"SDKBranch\", SOURCEJS_SDK_BRANCH)"],
		["CoreRecordInformationPlatform", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"Platform\", MakeString(pIsolate, SOURCEJS_TARGET_PLATFORM))", "SetString(pIsolate, LocalContext, LocalObject, \"Platform\", SOURCEJS_TARGET_PLATFORM)"],
		["CoreRecordInformationArchitecture", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"Architecture\", MakeString(pIsolate, SOURCEJS_TARGET_ARCH))", "SetString(pIsolate, LocalContext, LocalObject, \"Architecture\", SOURCEJS_TARGET_ARCH)"],
		["CoreRecordInformationRuntime", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"Runtime\", MakeString(pIsolate, \"v8\"))", "SetString(pIsolate, LocalContext, LocalObject, \"Runtime\", \"v8\")"],
		["CoreRecordInformationGameName", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"GameName\", MakeString(pIsolate, PathGameRoot.filename().string()))", "SetValue(pIsolate, LocalContext, LocalObject, \"GameName\", MakeString(pIsolate, PathGameRoot.filename().string()))"],
		["CoreRecordInformationSourceEngine", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"SourceEngine\", MakeString(pIsolate, \"source\"))", "SetString(pIsolate, LocalContext, LocalObject, \"SourceEngine\", \"source\")"],
		["CoreRecordInformationSourceEngineBranch", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"SourceEngineBranch\", MakeString(pIsolate, SOURCEJS_SDK_BRANCH))", "SetString(pIsolate, LocalContext, LocalObject, \"SourceEngineBranch\", SOURCEJS_SDK_BRANCH)"],
	].map(vecMutation => ({ Name: vecMutation[0], Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize core information with own data properties", CoreInformationSource: ReplaceOnce(g_strCoreInformationHelpers, vecMutation[1], vecMutation[2]) })),
	{ Name: "CoreRecordRequireOwnExports", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Native require rejects inherited namespace exports", CoreInformationSource: ReplaceOnce(g_strCoreInformationHelpers, "if (MaybeHasNativeModule.FromJust()) {", "if (true) {") },
	{ Name: "CoreRecordRequireUnwind", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Native require preserves package exception during C++ unwinding", CoreInformationSource: ReplaceOnce(g_strCoreInformationHelpers, "if (PackageLookupFailure.HasCaught()) {\n\t\t\t\t\t\tPackageLookupFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;") },
	{ Name: "CoreRecordVersionPredicate", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Core unversioned queries reflect non-empty and empty compiled strings", CoreInformationSource: ReplaceOnce(g_strCoreInformationHelpers, GetDefinition("IsCoreUnversionedCallback"), ReplaceOnce(GetDefinition("IsCoreUnversionedCallback"), "SOURCEJS_VERSION[0] == '\\0'", "SOURCEJS_VERSION[0] != '\\0'")) },
	{ Name: "EntityHookOptionsEntityInheritedSet", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize positional entity-hook options with own fields", EntityHookSource: ReplaceOnce(g_strEntityHookAndGameDescriptionCallbacks, "SetRecordProperty(pIsolate, LocalContext, LocalOptions, kEntityOptionPropertyName, CallbackInformation[kEntityArgumentIndex])", "SetValue(pIsolate, LocalContext, LocalOptions, kEntityOptionPropertyName, CallbackInformation[kEntityArgumentIndex])") },
	{ Name: "EntityHookOptionsIndexInheritedSet", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize positional entity-hook options with own fields", EntityHookSource: ReplaceOnce(g_strEntityHookAndGameDescriptionCallbacks, "SetRecordProperty(pIsolate, LocalContext, LocalOptions, kHookIndexOptionPropertyName, CallbackInformation[kHookIndexArgumentIndex])", "SetValue(pIsolate, LocalContext, LocalOptions, kHookIndexOptionPropertyName, CallbackInformation[kHookIndexArgumentIndex])") },
	{ Name: "EntityRecordMethodsInheritedSet", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize Entity records with own methods", PropertySource: ReplaceOnce(g_strPlayerProperties, "return SetRecordFunction(pIsolate, LocalContext, LocalEntityObject, pszFunctionName, Callback, LocalFunctionData);", "return SetFunction(pIsolate, LocalContext, LocalEntityObject, pszFunctionName, Callback, LocalFunctionData);") },
	{ Name: "MissingConVarRecordInheritedSet", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize missing ConVar records with own Exists", ConVarSource: ReplaceOnce(g_strConVarProperties, 'if (!SetRecordProperty(pIsolate, LocalContext, LocalConVarObject, "Exists", v8::Boolean::New(pIsolate, false))) {', 'if (!SetBoolean(pIsolate, LocalContext, LocalConVarObject, "Exists", false)) {') },
	{ Name: "EntityRecordInheritedSet", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize entity records with own data properties", SettersSource: ReplaceOnce(g_strSetters, "LocalObject->CreateDataProperty(LocalContext, LocalName, LocalValue)", "LocalObject->Set(LocalContext, LocalName, LocalValue)") },
	{ Name: "EntityRecordAddressPartialResult", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Initialize entity records with own data properties", AddressSource: ReplaceOnce(g_strAddressRecord, g_strEntityRecordFailureTail, g_strEntityRecordFailureTail.replace("return {};", "return LocalObject;")) },
	{ Name: "EntityRecordHandlePartialResult", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Do not return a partially initialized record after string failure", HandleSource: ReplaceOnce(g_strHandleRecord, g_strEntityRecordFailureTail, g_strEntityRecordFailureTail.replace("return {};", "return LocalObject;")) },
	{ Name: "SpatialPartitionClusterRevalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve cluster first-entity identity and original getter contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClusterHelpers, ReplaceOnce(g_strClusterHelpers, g_strClusterCallback, ReplaceOnce(g_strClusterCallback, "if (bNeedsEntityRevalidation) {", "if (bNeedsEntityRevalidation && false) {"))) },
	{ Name: "SpatialPartitionClusterSerial", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve cluster first-entity identity and original getter contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClusterHelpers, ReplaceOnce(g_strClusterHelpers, g_strClusterHandleResolver, ReplaceOnce(g_strClusterHandleResolver, "(LiveHandle.ToInt() != EntityHandle.ToInt())", "(LiveHandle.GetEntryIndex() != EntityHandle.GetEntryIndex())"))) },
	{ Name: "SpatialPartitionClusterHandleAlias", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve cluster first-entity identity and original getter contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClusterHelpers, ReplaceOnce(g_strClusterHelpers, g_strClusterCallback, ReplaceOnce(g_strClusterCallback, "CBaseHandle EntityHandle {};", "CBaseHandle& EntityHandle = g_MovementHandleEntity.m_Handle;"))) },
	{ Name: "SpatialPartitionClusterEdictRefresh", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve cluster first-entity identity and original getter contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClusterHelpers, ReplaceOnce(g_strClusterHelpers, g_strClusterCallback, ReplaceOnce(g_strClusterCallback, "\t\t\t\t\t\t\tpEntityEdict = GetFixtureClusterEdictFromIndex(nCurrentEntityIndex);", "\t\t\t\t\t\t\tGetFixtureClusterEdictFromIndex(nCurrentEntityIndex);"))) },
	// Keep the wrong availability flag runtime-dependent in the active V8 context so MSVC x86 can compile the failure oracle.
	{ Name: "SpatialPartitionCapabilityAvailability", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve engine capability dispatch and availability outputs", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClusterHelpers, ReplaceOnce(g_strClusterHelpers, g_strClusterFakeClient, ReplaceOnce(g_strClusterFakeClient, "bIsFakeClientWithOptionsCreationAPIAvailableOut = true;", "bIsFakeClientWithOptionsCreationAPIAvailableOut = pIsolate->GetCurrentContext().IsEmpty();"))) },
	{ Name: "ClientVolumeRevalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-volume identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientVolumeHelpers, ReplaceOnce(g_strClientVolumeHelpers, g_strClientVolumeCallback, ReplaceOnce(g_strClientVolumeCallback, "if (bNeedsClientRevalidation) {", "if (bNeedsClientRevalidation && false) {"))) },
	{ Name: "ClientVolumeSerial", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-volume identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientVolumeHelpers, ReplaceOnce(g_strClientVolumeHelpers, g_strClientVolumeHandleResolver, ReplaceOnce(g_strClientVolumeHandleResolver, "(LiveHandle.ToInt() != EntityHandle.ToInt())", "(LiveHandle.GetEntryIndex() != EntityHandle.GetEntryIndex())"))) },
	{ Name: "ClientVolumeHandleAlias", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-volume identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientVolumeHelpers, ReplaceOnce(g_strClientVolumeHelpers, g_strClientVolumeCallback, ReplaceOnce(g_strClientVolumeCallback, "CBaseHandle ClientHandle {};", "CBaseHandle& ClientHandle = g_MovementHandleEntity.m_Handle;"))) },
	{ Name: "ClientVolumeEdictRefresh", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-volume identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientVolumeHelpers, ReplaceOnce(g_strClientVolumeHelpers, g_strClientVolumeCallback, ReplaceOnce(g_strClientVolumeCallback, "\t\t\t\t\tpClientEdict = GetFixtureMovementEdictFromIndex(nCurrentClientIndex);", "\t\t\t\t\tGetFixtureMovementEdictFromIndex(nCurrentClientIndex);"))) },
	{ Name: "ClientVolumeEarlyHandleError", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-volume identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientVolumeHelpers, ReplaceOnce(g_strClientVolumeHelpers, g_strClientVolumeCallback, ReplaceOnce(g_strClientVolumeCallback, "const bool bHasClientHandle = bNeedsClientRevalidation && GetFixtureClientVolumeHandleFromEdict(pClientEdict, ClientHandle);", "const bool bHasClientHandle = bNeedsClientRevalidation && GetFixtureClientVolumeHandleFromEdict(pClientEdict, ClientHandle);\n\n\t\t\t\tif (bNeedsClientRevalidation && !bHasClientHandle) {\n\t\t\t\t\tThrowError(pIsolate, kChangedClientErrorMessage);\n\t\t\t\t\treturn;\n\t\t\t\t}"))) },
	{ Name: "ClientVolumePrimitiveHandle", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-volume identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientVolumeHelpers, ReplaceOnce(g_strClientVolumeHelpers, g_strClientVolumeCallback, ReplaceOnce(g_strClientVolumeCallback, "const bool bNeedsClientRevalidation = LocalFadePercentValue->IsObject() || LocalFadeOutSecondsValue->IsObject() || LocalHoldTimeValue->IsObject() || LocalFadeInSecondsValue->IsObject();", "const bool bNeedsClientRevalidation = true;"))) },
	{ Name: "ClientVolumeLateCapture", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-volume identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientVolumeHelpers, ReplaceOnce(g_strClientVolumeHelpers, g_strClientVolumeCallback, ReplaceOnce(ReplaceOnce(g_strClientVolumeCallback, "const bool bHasClientHandle = bNeedsClientRevalidation && GetFixtureClientVolumeHandleFromEdict(pClientEdict, ClientHandle);", "bool bHasClientHandle = false;"), "if (bNeedsClientRevalidation) {", "bHasClientHandle = bNeedsClientRevalidation && GetFixtureClientVolumeHandleFromEdict(pClientEdict, ClientHandle);\n\n\t\t\t\tif (bNeedsClientRevalidation) {"))) },
	{ Name: "ClientPresentationViewRevalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-presentation identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientPresentationHelpers, ReplaceOnce(g_strClientPresentationHelpers, g_strClientViewCallback, ReplaceOnce(g_strClientViewCallback, "if (bNeedsClientRevalidation) {", "if (bNeedsClientRevalidation && false) {"))) },
	{ Name: "ClientPresentationViewRefresh", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-presentation identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientPresentationHelpers, ReplaceOnce(g_strClientPresentationHelpers, g_strClientViewCallback, ReplaceOnce(g_strClientViewCallback, "\t\t\t\t\tpClientEdict = GetFixtureMovementEdictFromIndex(nCurrentClientIndex);", "\t\t\t\t\tGetFixtureMovementEdictFromIndex(nCurrentClientIndex);"))) },
	{ Name: "ClientPresentationCrosshairRevalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-presentation identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientPresentationHelpers, ReplaceOnce(g_strClientPresentationHelpers, g_strClientCrosshairCallback, ReplaceOnce(g_strClientCrosshairCallback, "if (bNeedsClientRevalidation) {", "if (bNeedsClientRevalidation && false) {"))) },
	{ Name: "ClientPresentationCrosshairRefresh", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-presentation identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientPresentationHelpers, ReplaceOnce(g_strClientPresentationHelpers, g_strClientCrosshairCallback, ReplaceOnce(g_strClientCrosshairCallback, "\t\t\t\t\tpClientEdict = GetFixtureMovementEdictFromIndex(nCurrentClientIndex);", "\t\t\t\t\tGetFixtureMovementEdictFromIndex(nCurrentClientIndex);"))) },
	{ Name: "ClientPresentationSerial", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Preserve client-presentation identity, coercion and dispatch contracts", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClientPresentationHelpers, ReplaceOnce(g_strClientPresentationHelpers, g_strClientPresentationHandleResolver, ReplaceOnce(g_strClientPresentationHandleResolver, "(LiveHandle.ToInt() != EntityHandle.ToInt())", "(LiveHandle.GetEntryIndex() != EntityHandle.GetEntryIndex())"))) },
	...g_vecPayloadCallbackNames.map(strName => {
		const strOperation = strName.slice(0, -"Callback".length);
		const strDiagnostic = "ThrowError(CallbackInformation.GetIsolate(), \"memory/hooks/events " + strOperation + " failed with a C++ exception.\");";

		return { Name: "GameEvent" + strOperation + "Boundary", Source: g_strThrowError, GameEventProfile: true, GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, strDiagnostic, "return;") };
	}),
	...g_vecDirectEventCallbacks.map(Probe => {
		const strDiagnostic = "ThrowError(CallbackInformation.GetIsolate(), \"memory/hooks/events." + Probe.Operation + "() failed with a C++ exception.\");";

		return { Name: "GameEventDirect" + Probe.Operation + "Boundary", Source: g_strThrowError, GameEventProfile: true, GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, strDiagnostic, "return;") };
	}),
	...g_vecResourceEventCallbackNames.map(strName => {
		const strDiagnostic = "ThrowError(CallbackInformation.GetIsolate(), \"" + strName + " failed with a C++ exception.\");";

		return { Name: "GameEventResource" + strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, strDiagnostic, "return;") };
	}),
	...g_vecPlayerCollectionCallbacks.map(strName => {
		const strDiagnostic = "ThrowError(CallbackInformation.GetIsolate(), \"" + strName + " failed with a C++ exception.\");";

		return { Name: "PlayerCollection" + strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, PlayerCollectionSource: ReplaceOnce(g_strPlayerCollectionHelpers, strDiagnostic, "return;") };
	}),
	...g_vecPlayerTeamCallbacks.map(strName => {
		const strDiagnostic = "ThrowError(CallbackInformation.GetIsolate(), \"" + strName + " failed with a C++ exception.\");";

		return { Name: "PlayerTeam" + strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, PlayerCollectionSource: ReplaceOnce(g_strPlayerCollectionHelpers, strDiagnostic, "return;") };
	}),
	{ Name: "PlayerTeamIndexPendingCpp", Source: g_strThrowError, GameEventProfile: true, PlayerCollectionSource: ReplaceOnce(g_strPlayerCollectionHelpers, "if (IndexTryCatch.HasCaught()) {\n\t\t\t\t\tIndexTryCatch.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;") },
	{ Name: "PlayerTeamProfileFailureSentinel", Source: g_strThrowError, GameEventProfile: true, PlayerCollectionSource: ReplaceOnce(g_strPlayerCollectionHelpers, "if (LocalProfileName.IsEmpty()) {\n\t\t\t\treturn;", "if (LocalProfileName.IsEmpty()) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(false);\n\t\t\t\treturn;") },
	...g_vecRecipientDictionaryVoiceCallbacks.map(strName => {
		const strDiagnostic = "ThrowError(CallbackInformation.GetIsolate(), \"" + strName + " failed with a C++ exception.\");";

		return { Name: "RecipientDictionaryVoice" + strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, strDiagnostic, "return;") };
	}),
	{ Name: "VoicePropertyBoundary", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "ThrowError(PropertyCallbackInformation.GetIsolate(), \"GetVoiceServerPropertyCallback failed with a C++ exception.\");", "return;") },
	{ Name: "RecipientArrayFailureCommit", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "AddUniqueRecipientEntityIndex(vecRecipientEntityIndices, nEntityIndex, bIncludeBots);", "AddUniqueRecipientEntityIndex(vecRecipientEntityIndicesOut, nEntityIndex, bIncludeBots);\n\t\t\t\tAddUniqueRecipientEntityIndex(vecRecipientEntityIndices, nEntityIndex, bIncludeBots);") },
	{ Name: "VoiceMissingProximitySlot", Source: g_strThrowError, GameEventProfile: true, NoVoiceProximity: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "(nVTableIndex == GetVoiceSetClientProximityVTableIndex()) && !HasVoiceClientProximity<IVoiceServer>()", "false") },
	{ Name: "VoiceFunctionAddressResult", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "return pFunctionAddress;", "return nullptr;") },
	{ Name: "PlayerButtonSemanticValue", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "return SetRecordProperty(pIsolate, LocalContext, LocalPlayerButtonConstants, pszButtonConstantName, v8::Integer::New(pIsolate, nValue));", "return SetRecordProperty(pIsolate, LocalContext, LocalPlayerButtonConstants, pszButtonConstantName, v8::Integer::New(pIsolate, nValue + 1));") },
	{ Name: "EntityCollectionBoundary", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "ThrowError(CallbackInformation.GetIsolate(), \"GetAllEntitiesCallback failed with a C++ exception.\");", "return;") },
	{ Name: "EntityCollectionSparseOutput", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "LocalEntityArray->CreateDataProperty(LocalContext, unOutputIndex, LocalEntity)", "LocalEntityArray->CreateDataProperty(LocalContext, unOutputIndex + 1, LocalEntity)") },
	{ Name: "PlayerLifeStateSemanticValue", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "return SetRecordProperty(pIsolate, LocalContext, LocalPlayerLifeStateConstants, pszLifeStateName, v8::Integer::New(pIsolate, nValue));", "return SetRecordProperty(pIsolate, LocalContext, LocalPlayerLifeStateConstants, pszLifeStateName, v8::Integer::New(pIsolate, nValue + 1));") },
	...g_vecEntityClassDictionaryCallbacks.map(strName => {
		const strDiagnostic = "ThrowError(CallbackInformation.GetIsolate(), \"" + strName + " failed with a C++ exception.\");";

		return { Name: "EntityClassDictionary" + strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, strDiagnostic, "return;") };
	}),
	{ Name: "EntityIndicesFailureCommit", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "vecEntityIndices.push_back(nEntityIndex);", "vecEntityIndicesOut.push_back(nEntityIndex);\n\t\t\t\tvecEntityIndices.push_back(nEntityIndex);") },
	{ Name: "EntityClassesDuplicateNames", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "strClassName.empty() || ContainsString(vecClassNames, strClassName)", "strClassName.empty()") },
	{ Name: "EntityConversionPendingCpp", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, "if (ConversionFailure.HasCaught()) {\n\t\t\t\t\t\tConversionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;") },
	...g_vecPlayerIdentityCallbacks.map(strName => {
		const strDiagnostic = 'ThrowError(CallbackInformation.GetIsolate(), "' + strName + ' failed with a C++ exception.");';

		return { Name: "PlayerIdentity" + strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, PlayerIdentitySource: ReplaceOnce(g_strPlayerIdentityHelpers, strDiagnostic, "return;") };
	}),
	{ Name: "PlayerConversionPendingCpp", Source: g_strThrowError, GameEventProfile: true, PlayerIdentitySource: ReplaceOnce(g_strPlayerIdentityHelpers, "if (ConversionFailure.HasCaught()) {\n\t\t\t\t\t\tConversionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;") },
	{ Name: "PlayerUserIDLastSlot", Source: g_strThrowError, GameEventProfile: true, PlayerIdentitySource: ReplaceOnce(g_strPlayerIdentityHelpers, GetDefinition("GetPlayerEntityIndexFromUserIDValue"), ReplaceOnce(GetDefinition("GetPlayerEntityIndexFromUserIDValue"), "unEntityIndex <= unPlayerCount", "unEntityIndex < unPlayerCount")) },
	{ Name: "EntityConstantGroupPublication", Source: g_strThrowError, GameEventProfile: true, PlayerIdentitySource: ReplaceOnce(g_strPlayerIdentityHelpers, "return SetRecordProperty(pIsolate, LocalContext, LocalEntityConstants, pszGroupName, LocalEntityConstantGroup);", "return true;") },
	{ Name: "EntityRemoveBoundary", Source: g_strThrowError, GameEventProfile: true, PlayerCollectionSource: ReplaceOnce(g_strPlayerCollectionHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "entities.RemoveEntity(Entity) failed because a native C++ exception occurred.");', "return;") },
	...g_vecTransmitCallbacks.map(strName => ({ Name: "EntityTransmit" + strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, PlayerIdentitySource: ReplaceOnce(g_strPlayerIdentityHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "' + strName + ' failed with a C++ exception.");', "return;") })),
	{ Name: "EntityTransmitPendingCpp", Source: g_strThrowError, GameEventProfile: true, PlayerIdentitySource: ReplaceOnce(g_strPlayerIdentityHelpers, "if (EntityResolutionFailure.HasCaught()) {\n\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;") },
	{ Name: "FactoryKeyValueNameNUL", Source: g_strThrowError, GameEventProfile: true, PlayerIdentitySource: ReplaceOnce(g_strPlayerIdentityHelpers, "strKeyValueName.empty() || (strKeyValueName.find('\\0') != std::string::npos)", "strKeyValueName.empty()") },
	{ Name: "FactoryKeyValueStringNUL", Source: g_strThrowError, GameEventProfile: true, PlayerIdentitySource: ReplaceOnce(g_strPlayerIdentityHelpers, "if (FactoryKeyValue.m_strValue.find('\\0') != std::string::npos)", "if (false)") },
	...[...g_vecFactoryCallbacks, "DestroyEntityByHammerIDCallback"].map(strName => ({ Name: "EntityFactory" + strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, FactoryCallbackSource: ReplaceOnce(g_strFactoryCallbacks, 'ThrowError(CallbackInformation.GetIsolate(), "' + strName + ' failed with a C++ exception.");', "return;") })),
	...g_vecFactoryCallbacks.slice(0, g_unFactoryClassNameCallbackCount).map(strName => {
		const strDefinition = ReplaceOnce(GetDefinition(strName), ") try {\n", ") try {\n\t\t\tEnterFixtureEventCallback(CallbackInformation.GetIsolate());\n");

		return { Name: strName + "ClassNameNUL", Source: g_strThrowError, GameEventProfile: true, FactoryCallbackSource: ReplaceOnce(g_strFactoryCallbacks, strDefinition, ReplaceOnce(strDefinition, "strClassName.empty() || (strClassName.find('\\0') != std::string::npos)", "strClassName.empty()")) };
	}),
	{ Name: "EntityFactoryGetterKeyNUL", Source: g_strThrowError, GameEventProfile: true, FactoryCallbackSource: ReplaceOnce(g_strFactoryCallbacks, "strKeyName.empty() || (strKeyName.find('\\0') != std::string::npos)", "strKeyName.empty()") },
	{ Name: "EntityFactoryResolverPendingCpp", Source: g_strThrowError, GameEventProfile: true, FactoryCallbackSource: ReplaceOnce(g_strFactoryCallbacks, "if (EntityResolutionFailure.HasCaught()) {\n\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;") },
	{ Name: "EntityFactorySetterReentrantValue", Source: g_strThrowError, GameEventProfile: true, FactoryCallbackSource: ReplaceOnce(g_strFactoryCallbacks, g_strFactorySetter, g_strFactoryDeferredValueReadSetter) },
	...[
		"FindEntityOutputNameByAddressCallback",
		"EntityDatamapsGetColorComponentProperty",
		"EntityDatamapsSetColorComponentProperty",
		"EntityDatamapsGetFloatComponentProperty",
		"EntityDatamapsSetFloatComponentProperty",
	].map(strName => ({ Name: strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, 'ThrowError(' + ((strName === "FindEntityOutputNameByAddressCallback") ? "CallbackInformation" : "PropertyInformation") + '.GetIsolate(), "' + strName + ' failed with a C++ exception.");', "return;") })),
	{ Name: "DatamapColorPrimitiveGuard", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "!LocalValue->IsInt32()", "false") },
	{ Name: "DatamapColorInputPrimitiveGuard", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "!LocalComponentValue->IsInt32()", "false") },
	{ Name: "DatamapNameLookupNoexcept", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "EntityDatamapsGetDatamapFromName(std::string const& strDatamapName) {", "EntityDatamapsGetDatamapFromName(std::string const& strDatamapName) noexcept {") },
	{ Name: "DatamapSelectorEntityGuard", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("EntityDatamapsGetDatamapFromValue"), ReplaceOnce(GetDefinition("EntityDatamapsGetDatamapFromValue"), "!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalValue, pBaseEntity)", "false")) },
	{ Name: "DatamapWideNumberPrimitiveGuard", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "std::is_integral_v<T> && (sizeof(T) >= sizeof(std::int64_t))", "false") },
	{ Name: "DatamapPropertyEntityGuard", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalEntityValue, pBaseEntity)", "false") },
	{ Name: "DatamapPropertySelectorPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "if (PropertyTryCatch.HasCaught()) {\n\t\t\t\t\t\tPropertyTryCatch.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;") },
	{ Name: "DatamapPropertyStringOwnerGuard", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("EntityDatamapsSetStringIDProperty"), ReplaceOnce(GetDefinition("EntityDatamapsSetStringIDProperty"), "!EntityDatamapsValidatePropertyEntity(pIsolate, PropertyEntityHandle, pPropertyBaseEntity)", "false")) },
	{ Name: "DatamapEntityTargetPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strDatamapEntitySetter, g_strDatamapEntitySetter.replace(g_strDatamapTargetUnwindGuard, "throw;")) },
	{ Name: "DatamapVariantTargetGuard", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("EntityDatamapsSetVariantValue"), ReplaceOnce(GetDefinition("EntityDatamapsSetVariantValue"), "if (!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalValue, pBaseEntity))", "if (false)")) },
	{ Name: "DatamapReceiverPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strDatamapReceiverCallback, ReplaceOnce(g_strDatamapReceiverCallback, g_strDatamapReceiverGuard, g_strDatamapReceiverUnsafeOwner)) },
	...[
		["Record", g_strEntityPropertiesRecordSelector, "PropertyReadFailure"],
		["Table", g_strEntityPropertiesTableSelector, "PropertyReadFailure"],
		["Entity", g_strEntityPropertiesEntitySelector, "EntityResolutionFailure"],
	].map(vecSelector => {
		const strName = vecSelector[0];
		const strSelector = vecSelector[1];
		const strOwnerName = vecSelector[2];
		const OwnerUnwindPattern = new RegExp("if \\(" + strOwnerName + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strOwnerName + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
		g_Assert.ok(OwnerUnwindPattern.test(strSelector), "Find the property selector's native unwind guard.");

		return { Name: "EntityProperties" + strName + "PendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strSelector, strSelector.replace(OwnerUnwindPattern, "throw;")) };
	}),
	{ Name: "EntityPropertiesEntityFailureStop", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strEntityPropertiesEntitySelector, ReplaceOnce(g_strEntityPropertiesEntitySelector, "if (EntityResolutionFailure.HasCaught()) {\n\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t\treturn nullptr;\n\t\t\t\t}", "if (false) {\n\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t\treturn nullptr;\n\t\t\t\t}")) },
	{ Name: "EntityPropertiesLifetimeSerial", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Reject a recycled property target after a packed-handle getter", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("EntityPropertiesIsEntityCurrent"), ReplaceOnce(GetDefinition("EntityPropertiesIsEntityCurrent"), "(pServerUnknown->GetRefEHandle().ToInt() == EntityHandle.ToInt())", "true")) },
	{ Name: "EntityPropertiesLifetimeVectorRevalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Entity vector setters reject serial recycling", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition("EntityPropertiesSetVectorProperty"), ReplaceOnce(GetDefinition("EntityPropertiesSetVectorProperty"), "if (!EntityPropertiesIsEntityCurrent(PropertyEntityHandle, pPropertyBaseEntity))", "if (false)")) },
	{ Name: "EntityPropertiesLifetimeOffsetRevalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Entity vector selectors reject serial recycling", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strEntityPropertiesFieldResolution, ReplaceOnce(g_strEntityPropertiesFieldResolution, "if (!EntityPropertiesIsEntityCurrent(PropertyEntityHandle, pTargetBaseEntity)) {\n\t\t\t\t\t\treturn FailWithError(kResolveEntityErrorMessage);", "if (false) {\n\t\t\t\t\t\treturn FailWithError(kResolveEntityErrorMessage);")) },
	{ Name: "EntityPropertiesLifetimeNameRevalidation", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Entity vector selectors reject serial recycling", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strEntityPropertiesFieldResolution, ReplaceOnce(g_strEntityPropertiesFieldResolution, "if (!EntityPropertiesIsEntityCurrent(PropertyEntityHandle, pTargetBaseEntity)) {\n\t\t\t\t\treturn FailWithError(kResolveEntityErrorMessage);", "if (false) {\n\t\t\t\t\treturn FailWithError(kResolveEntityErrorMessage);")) },
	...[
		["GenericFloat", "EntityPropertiesSetGenericProperty"],
		["Float", "EntityPropertiesSetFloatProperty"],
		["Double", "EntityPropertiesSetDoubleProperty"],
	].map(vecOwner => ({
		Name: "EntityPropertiesLifetime" + vecOwner[0] + "Revalidation",
		Source: g_strThrowError,
		GameEventProfile: true,
		ExpectedFailure: "Floating property writes reject entity recycling",
		DatamapSource: ReplaceOnce(g_strDatamapCallbacks, GetDefinition(vecOwner[1]), ReplaceOnce(GetDefinition(vecOwner[1]), "if (!EntityPropertiesIsEntityCurrent(PropertyEntityHandle, pPropertyBaseEntity))", "if (false)")),
	})),
	...[
		["Resolution", g_strEntityPropertiesResolution, "ResolutionFailure"],
		["Field", g_strEntityPropertiesFieldResolution, "PropertyReadFailure"],
	].map(vecSelector => {
		const strName = vecSelector[0];
		const strSelector = vecSelector[1];
		const strOwnerName = vecSelector[2];
		const OwnerUnwindPattern = new RegExp("if \\(" + strOwnerName + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strOwnerName + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
		g_Assert.ok(OwnerUnwindPattern.test(strSelector), "Find the outer field/class-table resolution unwind guard.");

		return { Name: "EntityProperties" + strName + "PendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strSelector, strSelector.replace(OwnerUnwindPattern, "throw;")) };
	}),
	...[
		["StringArrayCopy", "std::memcpy(pchResolvedPropertyAddress, strPropertyValue.data(), unCopyLength);", "std::memcpy(pchResolvedPropertyAddress, strPropertyValue.data(), 0);"],
		["StringArrayPadding", "std::memset(pchResolvedPropertyAddress + unCopyLength, 0, unBufferSize - unCopyLength);", "pchResolvedPropertyAddress[unBufferSize - 1] = '\\0';"],
	].map(vecMutation => {
		const strSetter = GetDefinition("EntityPropertiesSetStringArrayProperty");

		return { Name: "EntityProperties" + vecMutation[0], Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strSetter, ReplaceOnce(strSetter, vecMutation[1], vecMutation[2])) };
	}),
	...[
		["SolidType", "unsigned char"],
		["SolidFlags", "unsigned short"],
	].map(vecField => {
		const strName = "SetEntity" + vecField[0] + "Callback";
		const strCallback = GetDefinition(strName);

		return { Name: "EntityPropertiesCollision" + vecField[0] + "Width", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strCallback, ReplaceOnce(strCallback, "SetEntityCollisionIntegerProperty<" + vecField[1] + ">", "SetEntityCollisionIntegerProperty<int>")) };
	}),
	(() => {
		const OwnerUnwindPattern = /if \(EntityResolutionFailure\.HasCaught\(\)\) \{\n\t+EntityResolutionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
		g_Assert.ok(OwnerUnwindPattern.test(g_strEntityCollisionSelector), "Find collision selector unwind guard.");

		return { Name: "EntityPropertiesCollisionPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strEntityCollisionSelector, g_strEntityCollisionSelector.replace(OwnerUnwindPattern, "throw;")) };
	})(),
	(() => {
		const OwnerUnwindPattern = /if \(HandleResolutionFailure\.HasCaught\(\)\) \{\n\t+HandleResolutionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
		g_Assert.ok(OwnerUnwindPattern.test(g_strEntityPropertiesHandleSetter), "Find entity-handle selector unwind guard.");

		return { Name: "EntityPropertiesHandlePendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strEntityPropertiesHandleSetter, g_strEntityPropertiesHandleSetter.replace(OwnerUnwindPattern, "throw;")) };
	})(),
	{ Name: "EntityPropertiesInferenceSigned8Width", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strIntegerProxyTypeResolver, ReplaceOnce(g_strIntegerProxyTypeResolver, "ProxyFunction == StandardProxies.m_Int8ToInt32) {\n\t\t\t\treturn EntityPropertiesIntegerStorageType::Signed8;", "ProxyFunction == StandardProxies.m_Int8ToInt32) {\n\t\t\t\treturn EntityPropertiesIntegerStorageType::Signed32;")) },
	{ Name: "EntityPropertiesInferenceUnsigned32Sign", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strIntegerProxyTypeResolver, ReplaceOnce(g_strIntegerProxyTypeResolver, "ProxyFunction == StandardProxies.m_UInt32ToInt32) {\n\t\t\t\treturn EntityPropertiesIntegerStorageType::Unsigned32;", "ProxyFunction == StandardProxies.m_UInt32ToInt32) {\n\t\t\t\treturn EntityPropertiesIntegerStorageType::Signed32;")) },
	{ Name: "EntityPropertiesInferenceUnsigned64Width", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strIntegerProxyTypeResolver, ReplaceOnce(g_strIntegerProxyTypeResolver, "ProxyFunction == StandardProxies.m_UInt64ToInt64) {\n\t\t\t\t\treturn EntityPropertiesIntegerStorageType::Unsigned64;", "ProxyFunction == StandardProxies.m_UInt64ToInt64) {\n\t\t\t\t\treturn EntityPropertiesIntegerStorageType::Unsigned32;")) },
	{ Name: "EntityPropertiesInferenceGetterTwice", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strGenericPropertyGetter, ReplaceOnce(g_strGenericPropertyGetter, "EntityPropertiesGetInferredIntegerProperty<std::int8_t>(CallbackInformation, pchResolvedPropertyAddress);", "EntityPropertiesGetSignedProperty<std::int8_t>(CallbackInformation, LocalEntityValue, LocalPropertyValue);")) },
	{ Name: "EntityPropertiesNamedGetterWidth", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "EntityPropertiesGetGenericProperty(CallbackInformation, LocalEntityValue, LocalPropertyName, v8::Undefined(pIsolate));", "EntityPropertiesGetSignedProperty<int>(CallbackInformation, LocalEntityValue, LocalPropertyName);") },
	{ Name: "EntityPropertiesNamedSetterWidth", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, "EntityPropertiesSetGenericProperty(CallbackInformation, LocalEntityValue, LocalPropertyName, LocalSetValue, v8::Undefined(pIsolate));", "EntityPropertiesSetSignedProperty<int>(CallbackInformation, LocalEntityValue, LocalPropertyName, LocalSetValue);") },
	...["PlayerResolutionFailure", "PropertyNamesFailure"].map(strCatcher => {
		const UnwindPattern = new RegExp("if \\(" + strCatcher + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strCatcher + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
		g_Assert.ok(UnwindPattern.test(g_strFixturePlayerPropertyCaller), "Find nested actual player-property caller unwind guard.");

		return { Name: "EntityPropertiesPlayerCaller" + strCatcher, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strFixturePlayerPropertyCaller, g_strFixturePlayerPropertyCaller.replace(UnwindPattern, "throw;")) };
	}),
	{ Name: "EntityPropertiesPlayerCallerIdentity", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strFixturePlayerPropertyCaller, ReplaceOnce(g_strFixturePlayerPropertyCaller, "ResolveFixturePropertyPlayerHandle(PlayerHandle, nResolvedPlayerIndex)", "((nResolvedPlayerIndex = PlayerHandle.GetEntryIndex()) >= 0)")) },
	...["Player", "Weapon"].map(strRole => {
		const strOriginal = "ResolveFixtureDropHandle(" + strRole + "Handle, nResolved" + strRole + "Index)";
		const strReplacement = "((nResolved" + strRole + "Index = " + strRole + "Handle.GetEntryIndex()) >= 0)";

		return { Name: "EntityPropertiesDrop" + strRole + "Identity", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strFixtureDropWeaponCallback, ReplaceOnce(g_strFixtureDropWeaponCallback, strOriginal, strReplacement)) };
	}),
	...["PlayerResolutionFailure", "WeaponResolutionFailure"].map(strCatcher => {
		const UnwindPattern = new RegExp("if \\(" + strCatcher + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strCatcher + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
		g_Assert.ok(UnwindPattern.test(g_strFixtureDropWeaponCallback), "Find actual drop selector unwind guard.");

		return { Name: "EntityPropertiesDrop" + strCatcher, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strFixtureDropWeaponCallback, g_strFixtureDropWeaponCallback.replace(UnwindPattern, "throw;")) };
	}),
	...[
		["ActivePlayer", g_strPlayerActiveWeaponSetter, "PlayerResolutionFailure"],
		["EffectsApply", g_strEffectsApplyOwnership, "PropertyFailure"],
		["EffectsMetadata", g_strEffectsMetadataOwnership, "MetadataFailure"],
		["EffectsProperty", g_strEffectsPropertyOwnership, "PropertyFailure"],
		["Observer", g_strPlayerObserver, "PlayerResolutionFailure"],
		["ActiveWeapon", g_strPlayerActiveWeaponSetter, "WeaponResolutionFailure"],
		["WeaponSlots", g_strPlayerWeaponIndices, "PlayerResolutionFailure"],
		["Projectiles", g_strPlayerProjectileIndices, "PlayerResolutionFailure"],
		["IntegerStorage", g_strPlayerIntegerStorage, "PlayerResolutionFailure"],
		["Vector", g_strPlayerVectorSetter, "VectorConversionFailure"],
		["IntegerReader", g_vecPlayerPresenceReaders[0], "PlayerResolutionFailure"],
		["PresenceReader", g_vecPlayerPresenceReaders[1], "PlayerResolutionFailure"],
		["HLTV", g_strPlayerHLTV, "PlayerResolutionFailure"],
	].map(vecCase => {
		const strName = vecCase[0];
		const strCurrent = vecCase[1];
		const strCatcher = vecCase[2];
		const UnwindPattern = new RegExp("if \\(" + strCatcher + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strCatcher + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
		g_Assert.ok(UnwindPattern.test(strCurrent), "Find current player-storage native unwind guard.");

		return { Name: "EntityPropertiesPlayerStorage" + strName + "Cpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strCurrent, strCurrent.replace(UnwindPattern, "throw;")) };
	}),
	...[
		["ActivePlayer", g_strPlayerActiveWeaponSetter, "ResolveFixtureDropHandle(PlayerHandle, nResolvedPlayerIndex)", "((nResolvedPlayerIndex = PlayerHandle.GetEntryIndex()) >= 0)"],
		["EffectsNULGuard", g_strEffectsApplyOwnership, "strPropertyName.find('\\0') != std::string::npos", "false"],
		["EffectsNULTruncation", g_strEffectsApplyOwnership, "std::string const strPropertyName = std::string(pszPropertyName, static_cast<std::size_t>(UTF8PropertyName.length()));", "std::string const strPropertyName = pszPropertyName;"],
		...g_vecFilesystemCallbacks.flatMap((strCallback, unCallbackIndex) => {
			// These callbacks use the shared strict string validator, not an inline NUL guard.
			if (strCallback.startsWith("\t\tvoid IsVPKFileCallback(") || strCallback.startsWith("\t\tvoid RemoveFileCallback(")) {
				return [];
			}

			const bShared = unCallbackIndex === g_unFilesystemStringArgumentCallbackIndex;
			const bTemporary = unCallbackIndex === g_unFilesystemTemporaryPathCallbackIndex;
			const strRole = bShared ? "ArgumentValue" : bTemporary ? "FileNamePrefix" : (unCallbackIndex === g_unFilesystemDirectoryCallbackIndex) ? "DirectoryPath" : "FilePath";

			return [
				["FilesystemNULGuard" + unCallbackIndex, strCallback, "str" + strRole + ".find('\\0') != std::string::npos", "false"],
				["FilesystemNULTruncation" + unCallbackIndex, strCallback, "std::string(*UTF8" + strRole + ", static_cast<std::size_t>(UTF8" + strRole + ".length()))", "*UTF8" + strRole],
			];
		}),
		["FilesystemCppTranslation", g_vecFilesystemCallbacks[0], "ThrowError(pIsolate, kNativeExceptionErrorMessage);", "CallbackInformation.GetReturnValue().Set(MakeString(pIsolate, kNativeExceptionErrorMessage));"],
		["FilesystemTruncationHandoff", g_strTruncationCallback, "LocalOwnershipState, kConsumedPropertyName, v8::True(pIsolate)", "LocalOwnershipState, kConsumedPropertyName, v8::False(pIsolate)"],
		["FilesystemTruncationProxy", g_strTruncationCallback, " || CallbackInformation[kOwnershipStateArgumentIndex]->IsProxy()", ""],
		["KeyValuesStringNUL", g_strKeyValuesNativeStrings, "strValue.find('\\0') != std::string::npos", "false"],
		["KeyValuesStringLength", g_strKeyValuesNativeStrings, "std::string(*UTF8Value, static_cast<std::size_t>(UTF8Value.length()))", "*UTF8Value"],
		["KeyValuesHierarchyDescendants", g_strKeyValuesNativeHierarchy, "pKeyValues->GetFirstSubKey()", "pKeyValues->GetNextKey()"],
		["ObserverRepeatedSelector", g_strPlayerObserver, "LocalContext, LocalResolvedPlayerValue, vecObserverTargetPropertyNames", "LocalContext, LocalPlayerValue, vecObserverTargetPropertyNames"],
		["ActiveWeapon", g_strPlayerActiveWeaponSetter, "ResolveFixtureDropHandle(ActiveWeaponHandle, nResolvedWeaponIndex)", "((nResolvedWeaponIndex = ActiveWeaponHandle.GetEntryIndex()) >= 0)"],
		["WeaponSlots", g_strPlayerWeaponIndices, "ResolveFixtureDropHandle(PlayerHandle, nResolvedPlayerIndex)", "((nResolvedPlayerIndex = PlayerHandle.GetEntryIndex()) >= 0)"],
		["IntegerStorage", g_strPlayerIntegerStorage, "ResolveFixturePropertyPlayerHandle(PlayerHandle, nResolvedPlayerIndex)", "((nResolvedPlayerIndex = PlayerHandle.GetEntryIndex()) >= 0)"],
		["WeaponPrefixNUL", g_strPlayerWeaponIndices, "(strPropertyPrefix.find('\\0') != std::string::npos)", "false"],
		["IntegerNameNUL", g_strPlayerIntegerStorage, "(strPropertyName.find('\\0') != std::string::npos)", "false"],
		["WeaponArraySet", g_strPlayerWeaponIndices, "LocalWeaponIndicesArray->CreateDataProperty(", "LocalWeaponIndicesArray->Set("],
		["ProjectileArraySet", g_strPlayerProjectileIndices, "LocalProjectileIndicesArray->CreateDataProperty(", "LocalProjectileIndicesArray->Set("],
	].map(vecCase => {
		const strName = vecCase[0];
		const strCurrent = vecCase[1];
		const strOriginal = vecCase[2];
		const strReplacement = vecCase[3];

		return { Name: "EntityPropertiesPlayerStorage" + strName, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strCurrent, ReplaceOnce(strCurrent, strOriginal, strReplacement)) };
	}),
	(() => {
		const UnwindPattern = /if \(BytesConversionFailure\.HasCaught\(\)\) \{\n\t+BytesConversionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
		g_Assert.ok(UnwindPattern.test(g_strBitBufferStateParser), "Find current BitBuffer conversion native unwind guard.");

		return { Name: "EntityPropertiesBitBufferConversionPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strBitBufferStateParser, g_strBitBufferStateParser.replace(UnwindPattern, "throw;")) };
	})(),
	(() => {
		const UnwindPattern = /if \(BytesConversionFailure\.HasCaught\(\)\) \{\n\t+BytesConversionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
		g_Assert.ok(UnwindPattern.test(g_strBitBufferCreateReader), "Find current BitBuffer reader construction native unwind guard.");

		return { Name: "EntityPropertiesBitBufferReaderConversionPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strBitBufferCreateReader, g_strBitBufferCreateReader.replace(UnwindPattern, "throw;")) };
	})(),
	{
		Name: "EntityPropertiesBitBufferPackUInt32Coercion",
		Source: g_strThrowError,
		GameEventProfile: true,
		ExpectedFailure: "Match actual native bitbuffer byte-source admission, conversion, snapshot and metadata contracts",
		DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strBitBufferPackUInt32, ReplaceOnce(g_strBitBufferPackUInt32, "\t\t\t\tif (!CallbackInformation[kUInt32ValueArgumentIndex]->IsUint32()) {\n\t\t\t\t\tThrowTypeError(pIsolate, kUInt32ValueTypeError);\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n", "")),
	},
	...[
		[
			"ShouldHitEntity",
			"LocalShouldHitEntityValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kShouldHitEntityPropertyName);",
			"LocalShouldHitEntityValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kShouldHitEntityPropertyName);\n\t\t\t\t\t\tLocalShouldHitEntityValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kShouldHitEntityPropertyName);",
		],
		[
			"TraceType",
			"if (!GetTraceTypeFromObject(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName, TRACE_EVERYTHING, nTraceType, bHasTraceType))",
			"if (!GetTraceTypeFromObject(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName, TRACE_EVERYTHING, nTraceType, bHasTraceType) || !GetTraceTypeFromObject(pIsolate, LocalContext, LocalFilterObject, kTraceTypePropertyName, TRACE_EVERYTHING, nTraceType, bHasTraceType))",
		],
		[
			"GetTraceType",
			"LocalGetTraceTypeValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kGetTraceTypePropertyName);",
			"LocalGetTraceTypeValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kGetTraceTypePropertyName);\n\t\t\t\t\t\t\tLocalGetTraceTypeValue = GetTraceObjectPropertyValue(pIsolate, LocalContext, LocalFilterObject, kGetTraceTypePropertyName);",
		],
	].map((vecMutation) => ({
		Name: "EntityPropertiesSoundTraceSnapshot" + vecMutation[0],
		Source: g_strThrowError,
		GameEventProfile: true,
		ExpectedFailure: "Trace filter options use a single property snapshot",
		DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceFilter, ReplaceOnce(g_strTraceFilter, vecMutation[1], vecMutation[2])),
	})),
	{ Name: "EntityPropertiesSoundTraceRayRange", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace ray rejects unsafe derived coordinates before SDK initialization", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceRayParser, ReplaceOnce(g_strTraceRayParser, "if (!IsRayGeometrySafe(StartVector, EndVector, MinimumBounds, MaximumBounds, bHasMinimums))", "if (!IsRayGeometrySafe(StartVector, EndVector, MinimumBounds, MaximumBounds, bHasMinimums) && false)")) },
	{ Name: "EntityPropertiesSoundSweepAliasedHandle", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Sweep query revalidates native identity after preparation callbacks", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSweepLifetimeCallback, g_strSweepAliasedHandle) },
	{ Name: "EntityPropertiesSoundSweepStaleAddress", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Sweep query revalidates native identity after preparation callbacks", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSweepLifetimeCallback, g_strSweepStaleAddress) },
	{ Name: "EntityPropertiesSoundSweepEarlyRefresh", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Sweep query revalidates native identity after preparation callbacks", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSweepLifetimeCallback, g_strSweepEarlyRefresh) },
	{ Name: "EntityPropertiesSoundClipEntityAliasedHandle", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Entity clip revalidates native identity after Ray getters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClipEntityAdapter, g_strClipEntityAliasedHandle) },
	{ Name: "EntityPropertiesSoundClipEntitySerialUnchecked", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Entity clip revalidates native identity after Ray getters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClipEntityAdapter, g_strClipEntitySerialUnchecked) },
	{ Name: "EntityPropertiesSoundClipEntityStaleAddress", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Entity clip revalidates native identity after Ray getters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClipEntityAdapter, g_strClipEntityStaleAddress) },
	{ Name: "EntityPropertiesSoundClipCollideableAliasedHandle", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Collideable clip revalidates native identity after Ray getters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClipCollideableAdapter, g_strClipCollideableAliasedHandle) },
	{ Name: "EntityPropertiesSoundClipCollideableStaleAddress", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Collideable clip revalidates native identity after Ray getters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strClipCollideableAdapter, g_strClipCollideableStaleAddress) },
	{ Name: "EntityPropertiesSoundCollideableAliasedHandle", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Collideable query rejects entity invalidation during vector getters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strCollideableQueryAdapter, g_strCollideableAliasedHandle) },
	{ Name: "EntityPropertiesSoundCollideableSerialUnchecked", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Collideable query rejects entity invalidation during vector getters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strCollideableHandleResolver, g_strCollideableSerialUnchecked) },
	{ Name: "EntityPropertiesSoundCollideableStaleAddress", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Collideable query rejects entity invalidation during vector getters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strCollideableQueryAdapter, g_strCollideableStaleAddress) },
	{ Name: "EntityPropertiesSoundTraceResultEntitySnapshot", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace results snapshot borrowed native data before JavaScript setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceResult, g_strTraceResultLateEntity) },
	{ Name: "EntityPropertiesSoundTraceResultSurfaceSnapshot", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace results snapshot borrowed native data before JavaScript setters", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceResult, g_strTraceResultBorrowedSurface) },
	{ Name: "EntityPropertiesSoundTraceIgnoredBoundary", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace ignored indexes preserve pending errors through native unwinding", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceIgnoredIndex, ReplaceOnce(g_strTraceIgnoredIndex, "GetEntityIndexFromValue(pIsolate, LocalContext, LocalValue, nEntityIndex)", "GetIntegerFromValue(LocalContext, LocalValue, nEntityIndex)")) },
	{ Name: "EntityPropertiesSoundRecipientReread", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Sound recipient getters use one validated snapshot", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSoundRecipientHelpers, ReplaceOnce(g_strSoundRecipientHelpers, "CollectSoundRecipientIndicesFromValue(pIsolate, LocalContext, LocalRecipientValue, pszOperationName, vecValidatedRecipientIndices)", "CollectSoundRecipientIndicesFromValue(pIsolate, LocalContext, LocalRecipientValue, pszOperationName, vecValidatedRecipientIndices) || !CollectRecipientEntityIndicesFromValue(pIsolate, LocalContext, LocalRecipientValue, vecValidatedRecipientIndices, kIncludeBots, pszOperationName)")) },
	{ Name: "EntityPropertiesSoundRecipientFailedOutput", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Sound recipient getters use one validated snapshot", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSoundRecipientHelpers, ReplaceOnce(g_strSoundRecipientHelpers, "std::vector<int> vecRecipientEntityIndices {};", "vecRecipientEntityIndicesOut.clear();\n\t\t\tstd::vector<int> vecRecipientEntityIndices {};")) },
	{ Name: "EntityPropertiesSoundOriginCapacity", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSoundOrigins, ReplaceOnce(g_strSoundOrigins, "if (static_cast<std::size_t>(unOriginCount) > kMaximumOriginCount)", "if (static_cast<std::size_t>(unOriginCount) > std::max(kMaximumOriginCount, static_cast<std::size_t>(std::numeric_limits<std::uint32_t>::max())))")) },
	...[
		["TypeNoexcept", g_strTraceType],
		["Noexcept1", g_strTraceFunction],
	].map((vecProbe) => {
		const strDefinition = vecProbe[1];
		const strHeader = strDefinition.split("\n")[0];
		const strNoexceptHeader = strHeader.replace(") {", ") noexcept {");

		return { Name: "EntityPropertiesSoundTrace" + vecProbe[0], Source: g_strThrowError, GameEventProfile: true, TraceNoexceptTermination: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strDefinition, ReplaceOnce(strDefinition, strHeader, strNoexceptHeader)) };
	}),
	{ Name: "EntityPropertiesSoundTraceTypeFailedOutput", Source: g_strThrowError, GameEventProfile: true, ExpectedFailure: "Trace type parser preserves value and presence outputs", DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceType, ReplaceOnce(g_strTraceType, "v8::Local<v8::Value> const LocalPropertyValue =", "nTraceTypeOut = 0;\n\t\t\tbHasTraceTypeOut = false;\n\t\t\tv8::Local<v8::Value> const LocalPropertyValue =")) },
	{ Name: "EntityPropertiesSoundTraceDirectFunction", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceFunction, ReplaceOnce(g_strTraceFunction, "return LocalValue.As<v8::Function>();", "return {};")) },
	...g_vecTraceOwnerUnwindMatches.map((vecMatch, unIndex) => ({ Name: "EntityPropertiesSoundTraceOwnerUnwind" + unIndex, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceFilter, ReplaceOnce(g_strTraceFilter, vecMatch[0], "throw;")) })),
	...g_vecTraceEnumeratorUnwindMatches.map((vecMatch, unIndex) => ({ Name: "EntityPropertiesSoundTraceEnumeratorUnwind" + unIndex, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strTraceEnumerator, ReplaceOnce(g_strTraceEnumerator, vecMatch[0], "throw;")) })),
	{ Name: "EntityPropertiesSoundEntitySelectionUnwind", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strSoundEntitySelectionProbe, g_strSoundEntitySelectionProbe.replace(g_SoundEntityUnwindPattern, "throw;")) },
	{ Name: "EntityPropertiesSoundStopEntitySelectionUnwind", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strStopSoundEntitySelectionProbe, g_strStopSoundEntitySelectionProbe.replace(g_SoundEntityUnwindPattern, "throw;")) },
	...g_vecTraceQueryOwnerProbes.map((strProbe, unOwnerIndex) => ({ Name: "EntityPropertiesSoundTraceQueryOwner" + unOwnerIndex, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strProbe, strProbe.replace(g_TraceQueryUnwindPattern, "throw;")) })),
	(() => {
		const NamesUnwindPattern = /if \(PropertyNamesFailure\.HasCaught\(\)\) \{\n\t+PropertyNamesFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
		g_Assert.ok(NamesUnwindPattern.test(g_strFixturePlayerPropertyNamesParser), "Find player property-name parser unwind guard.");

		return { Name: "EntityPropertiesPlayerPropertyNamesPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strFixturePlayerPropertyNamesParser, g_strFixturePlayerPropertyNamesParser.replace(NamesUnwindPattern, "throw;")) };
	})(),
	(() => {
		const OwnerUnwindPattern = /if \(EntityResolutionFailure\.HasCaught\(\)\) \{\n\t+EntityResolutionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
		g_Assert.ok(OwnerUnwindPattern.test(g_strIntegerPropertyAddressResolver), "Find integer-property selector unwind guard.");

		return { Name: "EntityPropertiesIntegerAddressPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strIntegerPropertyAddressResolver, g_strIntegerPropertyAddressResolver.replace(OwnerUnwindPattern, "throw;")) };
	})(),
	...g_vecDatamapOuterOwners.map(vecOwner => {
		const strName = vecOwner[0];
		const strOwnerName = vecOwner[1];
		const OwnerUnwindPattern = new RegExp("if \\(" + strOwnerName + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strOwnerName + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
		const strCallback = GetDefinition(strName).replaceAll("EntityDatamapsMakeDatamapObject(", "MakeFixtureDatamapRecord(").replaceAll("EntityDatamapsMakeTypeDescriptionObject(", "MakeFixtureTypeDescriptionRecord(").replaceAll("EntityDatamapsCollectFields(", "CollectFixtureDatamapFields(").replaceAll("EntityDatamapsGetTypeDescriptionFromValue(", "GetFixtureDatamapInputDescription(");
		g_Assert.ok(OwnerUnwindPattern.test(strCallback), "Find the outer callback owner's C++ guard.");

		return { Name: "DatamapOuter" + strName + strOwnerName, Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strCallback, strCallback.replace(OwnerUnwindPattern, "throw;")) };
	}),
	...[
		"EntityDatamapsGetSignedProperty",
		"EntityDatamapsGetUnsignedProperty",
		"EntityDatamapsSetSignedProperty",
		"EntityDatamapsSetUnsignedProperty",
		"EntityDatamapsGetBooleanProperty",
		"EntityDatamapsSetBooleanProperty",
		"EntityDatamapsGetCharProperty",
		"EntityDatamapsSetCharProperty",
		"EntityDatamapsGetFloatProperty",
		"EntityDatamapsSetFloatProperty",
		"EntityDatamapsGetDoubleProperty",
		"EntityDatamapsSetDoubleProperty",
		"EntityDatamapsGetStringIDProperty",
		"EntityDatamapsSetStringIDProperty",
		"EntityDatamapsGetStringArrayProperty",
		"EntityDatamapsSetStringArrayProperty",
		"EntityDatamapsGetAddressProperty",
		"EntityDatamapsSetAddressProperty",
	].map(strName => {
		const strDefinition = GetDefinition(strName);
		const vecMessageDeclaration = strDefinition.match(/\t+constexpr char kNativeOperationErrorMessage\[\] = "[^"\n]+";\n\n/);
		g_Assert.ok(vecMessageDeclaration, "Find the owned boundary diagnostic for " + strName);

		// Remove the now-unused constant only in the mutant, so strict compilation still precedes runtime rejection.
		const strMutant = ReplaceOnce(ReplaceOnce(strDefinition, vecMessageDeclaration[0], ""), "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);", "return;");

		return { Name: strName + "Boundary", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, strDefinition, strMutant) };
	}),
	{ Name: "DatamapResolverPendingCpp", Source: g_strThrowError, GameEventProfile: true, DatamapSource: ReplaceOnce(g_strDatamapCallbacks, g_strDatamapBaseResolver, ReplaceOnce(g_strDatamapBaseResolver, "if (EntityResolutionFailure.HasCaught()) {\n\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;")) },
	{ Name: "EntityDictionaryEntrySparseOutput", Source: g_strThrowError, GameEventProfile: true, RecipientDictionaryVoiceSource: ReplaceOnce(g_strRecipientDictionaryVoiceHelpers, GetEntityClassDictionaryCallbackDefinition("GetEntityDictionaryEntriesCallback"), ReplaceOnce(GetEntityClassDictionaryCallbackDefinition("GetEntityDictionaryEntriesCallback"), "LocalEntryArray->CreateDataProperty(LocalContext, unOutputIndex, LocalEntryPair)", "LocalEntryArray->CreateDataProperty(LocalContext, unOutputIndex + 1, LocalEntryPair)")) },
	{ Name: "GameEventResourcePathNUL", Source: g_strThrowError, GameEventProfile: true, GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, "if (strPath.find('\\0') != std::string::npos)", "if (false)") },
	{ Name: "GameEventVariableDefaultPendingCpp", Source: g_strThrowError, GameEventProfile: true, GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, "if (DefaultValueFailure.HasCaught()) {\n\t\t\t\t\t\t\tDefaultValueFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;", "throw;") },
	...[
		{ Function: "SetGameEventPayloadFromObject", Catcher: "PayloadFailure" },
		{ Function: "GetFireEventHookOptionsCallback", Catcher: "HookOptionsFailure" },
		{ Function: "GetEventNameCallback", Catcher: "NameFailure" },
		{ Function: "GetEventInformationCallback", Catcher: "EventInformationFailure" },
		{ Function: "GetEventStringCallback", Catcher: "StringFailure" },
	].map(Guard => {
		const strGuard = "if (" + Guard.Catcher + ".HasCaught()) {\n\t\t\t\t\t" + Guard.Catcher + ".ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;";

		return { Name: "GameEvent" + Guard.Function + "PendingCpp", Source: g_strThrowError, GameEventProfile: true, GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, strGuard, "throw;") };
	}),
	{ Name: "GameEventDefaultValuePendingCpp", Source: g_strThrowError, GameEventProfile: true, GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, "if (DefaultValueFailure.HasCaught()) {\n\t\t\t\t\t\t\t\tDefaultValueFailure.ReThrow();\n\t\t\t\t\t\t\t}\n\n\t\t\t\t\t\t\tthrow;", "throw;") },
	{ Name: "GameEventMissingCleanup", Source: g_strThrowError, GameEventProfile: true, GameEventSource: ReplaceOnce(g_strGameEventPayloadHelpers, GetDefinition("FireGameEvent"), ReplaceOnce(GetDefinition("FireGameEvent"), "pEventManager->FreeEvent(pEvent);", "Require(pEvent != nullptr, \"Cleanup bypass mutation\");\n\t\t\t\tdelete pEvent;")) },
	...[
		{ Function: "GetObjectValue", Catcher: "PropertyFailure", Indentation: 4 },
		{ Function: "RequireEventStringFromValue", Catcher: "ConversionFailure", Indentation: 4 },
		{ Function: "GetEventVariableTypeFromDefinition", Catcher: "DefinitionFailure", Indentation: 5 },
		{ Function: "BuildEventResourceText", Catcher: "ResourceFailure", Indentation: 5 },
	].map(Guard => {
		const strDefinition = GetDefinition(Guard.Function);
		const strAdaptedDefinition = (Guard.Function === "RequireEventStringFromValue") ? ReplaceOnce(strDefinition, "char const* const pszValue = *UTF8Value;", "char const* const pszValue = ReadFixtureEventUTF8Value(pIsolate, *UTF8Value);") : strDefinition;
		const strIndentation = "\t".repeat(Guard.Indentation);
		const strGuard = "if (" + Guard.Catcher + ".HasCaught()) {\n" + strIndentation + "\t" + Guard.Catcher + ".ReThrow();\n" + strIndentation + "}\n\n" + strIndentation + "throw;";
		const strRegression = ReplaceOnce(strAdaptedDefinition, strGuard, "throw;");

		return { Name: "Event" + Guard.Function + "PendingCppException", Source: g_strThrowError, EventResourceSource: ReplaceOnce(g_strEventResourceHelpers, strAdaptedDefinition, strRegression) };
	}),
	...[
		"SetConVarPublicCallback",
		"IsConVarPublicCallback",
		"FindPublicConVarCallback",
	].map(strName => {
		const strDefinition = GetDefinition(strName);
		const strRegression = ReplaceOnce(strDefinition, "if (!ReadConVarName(pIsolate, CallbackInformation[kNameArgumentIndex], strConVarName))", "if (g_bConVarNameEncodingFailure && !ReadConVarName(pIsolate, CallbackInformation[kNameArgumentIndex], strConVarName))");

		return { Name: strName + "NameValidation", Source: g_strThrowError, CVarPublicAndTagSource: ReplaceOnce(g_strCVarPublicAndTagHelpers, strDefinition, strRegression) };
	}),
	...[
		"FindPublicConVarCallback",
		"GetServerTagsStringCallback",
		"GetServerTagsCallback",
	].map(strName => {
		const strDefinition = GetDefinition(strName);
		const strRegression = ReplaceOnce(strDefinition, "if (ConstructionFailure.HasCaught()) {\n\t\t\t\t\tConstructionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;");

		return { Name: strName + "ConstructionPendingCppException", Source: g_strThrowError, CVarPublicAndTagSource: ReplaceOnce(g_strCVarPublicAndTagHelpers, strDefinition, strRegression) };
	}),
	...g_vecCVarPublicAndTagCallbacks.map(strName => {
		const strDefinition = GetDefinition(strName);
		const strWithoutTranslation = ReplaceOnce(strDefinition, "ThrowError(CallbackInformation.GetIsolate(), kCallbackExceptionError);", "return;");
		const strRegression = ReplaceOnce(strWithoutTranslation, '\t\t\tconstexpr char kCallbackExceptionError[] = "' + strName + ' failed with a C++ exception.";\n', "");

		return { Name: strName + "Translation", Source: g_strThrowError, CVarPublicAndTagSource: ReplaceOnce(g_strCVarPublicAndTagHelpers, strDefinition, strRegression) };
	}),
	...[
		"GetConVarCallback",
		"CVarsRequireConVarFromArguments",
		"CreateConVarCallback",
	].map(strName => {
		const strDefinition = GetCVarOperationDefinition(strName);
		const strRegression = ReplaceOnce(strDefinition, "if (!ReadConVarName(pIsolate, CallbackInformation[kNameArgumentIndex], strConVarName))", "if (g_bConVarNameEncodingFailure && !ReadConVarName(pIsolate, CallbackInformation[kNameArgumentIndex], strConVarName))");

		return { Name: strName + "NameValidation", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, strDefinition, strRegression) };
	}),
	{ Name: "CVarCommandBaseNameValidation", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, "if (!ReadCommandName(CallbackInformation, kNameArgumentIndex, strCommandBaseName))", "if (g_bCommandNameEncodingFailure && !ReadCommandName(CallbackInformation, kNameArgumentIndex, strCommandBaseName))") },
	...[
		"GetConVarCallback",
		"RequireConVarCallback",
		"CreateConVarCallback",
	].map(strName => {
		const strDefinition = GetCVarOperationDefinition(strName);
		const strRegression = ReplaceOnce(strDefinition, "if (ConstructionFailure.HasCaught()) {\n\t\t\t\t\tConstructionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;");

		return { Name: strName + "ConstructionPendingCppException", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, strDefinition, strRegression) };
	}),
	...g_vecCVarOperationCallbacks.map(strName => {
		const strDefinition = GetCVarOperationDefinition(strName);
		const strWithoutTranslation = ReplaceOnce(strDefinition, "ThrowError(CallbackInformation.GetIsolate(), kCallbackExceptionError);", "return;");
		const strRegression = ReplaceOnce(strWithoutTranslation, '\t\t\tconstexpr char kCallbackExceptionError[] = "' + strName + ' failed with a C++ exception.";\n', "");

		return { Name: strName + "Translation", Source: g_strThrowError, CVarOperationSource: ReplaceOnce(g_strCVarOperations, strDefinition, strRegression) };
	}),
	{ Name: "ConVarNameNULPrefixOnly", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(g_strCVarLookups, "if (std::memchr(pszEncodedName, '\\0', unEncodedNameLength))", "if (std::memchr(pszEncodedName, '\\0', unEncodedNameLength) == pszEncodedName)") },
	{ Name: "ConVarNameUTF8ByteCount", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(g_strCVarLookups, "static_cast<std::size_t>(UTF8Value.length())", "std::strlen(pszEncodedName)") },
	{ Name: "ConVarNameEarlyOutputCommit", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(g_strCVarLookups, "const std::size_t unEncodedNameLength =", "strConVarNameOut.assign(pszEncodedName, static_cast<std::size_t>(UTF8Value.length()));\n\n\t\t\tconst std::size_t unEncodedNameLength =") },
	{ Name: "ConVarNameEncodingDiagnostic", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(ReplaceOnce(g_strCVarLookups, "if (!pszEncodedName) {\n\t\t\t\tThrowError(pIsolate, kConversionError);\n\t\t\t\tConversionFailure.ReThrow();\n\t\t\t\treturn false;\n\t\t\t}", "if (!pszEncodedName) {\n\t\t\t\treturn false;\n\t\t\t}"), '\t\t\tconstexpr char kConversionError[] = "ConVar name could not be encoded as UTF-8.";\n', "") },
	...g_vecCVarLookupCallbacks.map(strName => ({ Name: strName + "NameValidation", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(g_strCVarLookups, GetDefinition(strName), ReplaceOnce(GetDefinition(strName), "if (!ReadConVarName(pIsolate, CallbackInformation[kNameArgumentIndex], strConVarName))", "if (g_bConVarNameEncodingFailure && !ReadConVarName(pIsolate, CallbackInformation[kNameArgumentIndex], strConVarName))")) })),
	{ Name: "CVarListSkipsRegisteredCommand", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(g_strCVarLookups, "if (!AppendCommandBase(const_cast<ConCommandBase*>(pCommandBase)))", "if (!AppendCommandBase(nullptr))") },
	{ Name: "CVarEnumerationPendingCppException", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(g_strCVarLookups, "if (RecordFailure.HasCaught()) {\n\t\t\t\t\t\tRecordFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;") },
	{ Name: "FindConVarConstructionPendingCppException", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(g_strCVarLookups, "if (ConstructionFailure.HasCaught()) {\n\t\t\t\t\tConstructionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;") },
	{ Name: "ConVarPropertyInstallationPendingCppException", Source: g_strThrowError, ConVarSource: ReplaceOnce(g_strConVarProperties, "if (PropertyInstallationFailure.HasCaught()) {\n\t\t\t\t\t\tPropertyInstallationFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;") },
	...[...g_vecCVarLookupCallbacks, "GetConCommandBaseRecordsCallback"].map(strName => {
		const strDefinition = GetDefinition(strName);
		const strWithoutTranslation = ReplaceOnce(strDefinition, "ThrowError(CallbackInformation.GetIsolate(), kCallbackExceptionError);", "return;");
		const strRegression = ReplaceOnce(strWithoutTranslation, '\t\t\tconstexpr char kCallbackExceptionError[] = "' + strName + ' failed with a C++ exception.";\n', "");

		return { Name: strName + "Translation", Source: g_strThrowError, CVarLookupSource: ReplaceOnce(g_strCVarLookups, strDefinition, strRegression) };
	}),
	{ Name: "CommandNameNULPrefixOnly", Source: g_strThrowError, CommandNameSource: ReplaceOnce(g_strCommandName, "if (std::memchr(pszEncodedName, '\\0', unEncodedNameLength))", "if (std::memchr(pszEncodedName, '\\0', unEncodedNameLength) == pszEncodedName)") },
	{ Name: "CommandNameUTF8ByteCount", Source: g_strThrowError, CommandNameSource: ReplaceOnce(g_strCommandName, "static_cast<std::size_t>(UTF8Value.length())", "std::strlen(pszEncodedName)") },
	{ Name: "CommandNameEarlyOutputCommit", Source: g_strThrowError, CommandNameSource: ReplaceOnce(g_strCommandName, "const std::size_t unEncodedNameLength =", "strCommandNameOut.assign(pszEncodedName, static_cast<std::size_t>(UTF8Value.length()));\n\n\t\t\tconst std::size_t unEncodedNameLength =") },
	{ Name: "CommandNameEncodingDiagnostic", Source: g_strThrowError, CommandNameSource: ReplaceOnce(g_strCommandName, "if (!pszEncodedName) {\n\t\t\t\tThrowError(pIsolate, kConversionError);\n\t\t\t\tConversionFailure.ReThrow();\n\t\t\t\treturn false;\n\t\t\t}", "if (!pszEncodedName) {\n\t\t\t\treturn false;\n\t\t\t}") },
	{ Name: "CommandNameConversionException", Source: g_strThrowError, CommandNameSource: ReplaceOnce(g_strCommandName, "ConversionFailure.ReThrow();\n\t\t\t\treturn false;\n\t\t\t}\n\n\t\t\tv8::String::Utf8Value", "return false;\n\t\t\t}\n\n\t\t\tv8::String::Utf8Value") },
	{ Name: "ChecksumEncodingFailure", Source: g_strThrowError, ChecksumAndEventSource: ReplaceOnce(g_strChecksumAndGameEvents, "if (!pszEncodedValue)", "if (!pszEncodedValue && !g_bChecksumEncodingFailure)") },
	{ Name: "ChecksumByteCount", Source: g_strThrowError, ChecksumAndEventSource: ReplaceOnce(g_strChecksumAndGameEvents, "static_cast<std::size_t>(UTF8Value.length())", "std::strlen(pszEncodedValue)") },
	{ Name: "ChecksumHexCase", Source: g_strThrowError, ChecksumAndEventSource: ReplaceOnce(g_strChecksumAndGameEvents, '"0123456789abcdef"', '"0123456789ABCDEF"') },
	...g_vecGameEventCallbacks.map(strName => ({ Name: strName + "EmbeddedNull", Source: g_strThrowError, ChecksumAndEventSource: ReplaceOnce(g_strChecksumAndGameEvents, GetDefinition(strName), ReplaceOnce(GetDefinition(strName), "if (strEventName.find('\\0') != std::string::npos)", "if (strEventName.find('\\0') == 0)")) })),
	{ Name: "ErrorKind", Source: ReplaceOnce(g_strThrowError, "v8::Exception::Error(LocalMessage)", "v8::Exception::TypeError(LocalMessage)") },
	{ Name: "EmptyMessageFallback", Source: ReplaceOnce(g_strThrowError, "pIsolate->ThrowException({});\n\t\t\t\treturn;", "return;") },
	{ Name: "ExistingException", Source: ReplaceOnce(g_strThrowError, "!pIsolate || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()", "!pIsolate || pIsolate->IsExecutionTerminating()") },
	{ Name: "MessageConstructionException", Source: ReplaceOnce(g_strThrowError, "if (pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", "if (pIsolate->IsExecutionTerminating())") },
	{ Name: "VectorOutputLeak", Source: g_strThrowError, VectorSource: ReplaceOnce(g_strRequiredVector, "pszErrorMessage, bHasVector, VectorValue)", "pszErrorMessage, bHasVector, VectorOut)") },
	{ Name: "HandleZeroValidity", Source: g_strThrowError, HandleSource: ReplaceOnce(g_strHandleRecord, "EntityHandle.IsValid()", "(EntityHandle.IsValid() && (unHandleValue != 0))") },
	{ Name: "AddressKeyCase", Source: g_strThrowError, AddressSource: ReplaceOnce(g_strAddressRecord, '"Address", LocalAddressValue', '"address", LocalAddressValue') },
	{ Name: "AddressNumber", Source: g_strThrowError, AddressSource: ReplaceOnce(g_strAddressRecord, "v8::Local<v8::BigInt> const LocalAddressValue = v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unAddress));", "v8::Local<v8::Number> const LocalAddressValue = v8::Number::New(pIsolate, static_cast<double>(unAddress));") },
	{ Name: "CallbackTranslation", Source: g_strThrowError, CallbackSource: ReplaceOnce(g_strCallbacks, 'ThrowError(CallbackInformation.GetIsolate(), "Player.GiveNamedItem() failed because a native C++ exception occurred.");', "return;") },
	{ Name: "BinaryDefaultState", Source: g_strThrowError, BinarySource: ReplaceOnce(g_strBinaryRecord, "m_unBaseAddress = 0;", "m_unBaseAddress = 1;") },
	{ Name: "BinaryMoveState", Source: g_strThrowError, BinarySource: ReplaceOnce(g_strBinaryRecord, "m_strName(std::move(BinaryInformation.m_strName))", "m_strName(std::move(BinaryInformation.m_strPath))") },
	{ Name: "EngineAddressRecordInheritedSet", Source: g_strThrowError, ClientSource: ReplaceOnce(g_strClientHelpers, g_strEngineServerAddressRecordFixture, g_strEngineServerAddressRecordFixture.replaceAll("SetRecordProperty(", "SetValue(")), ExpectedFailure: "Initialize engine address records with own data properties" },
	{ Name: "ClientRecordIndexInheritedSet", Source: g_strThrowError, ClientSource: ReplaceOnce(g_strClientHelpers, 'SetRecordProperty(pIsolate, LocalContext, LocalClientObject, "Index", v8::Integer::New(pIsolate, nClientIndex))', 'SetInteger(pIsolate, LocalContext, LocalClientObject, "Index", nClientIndex)'), ExpectedFailure: "Initialize IClient records with own fields and methods" },
	...[
		"DisconnectClient",
		"ExecuteClientStringCommand",
		"PrintToClientConsole",
		"GetUserSetting",
		"SetNetworkRate",
		"SetUpdateRate",
	].map(strMethod => ({ Name: "ClientRecord" + strMethod + "InheritedSet", Source: g_strThrowError, ClientSource: ReplaceOnce(g_strClientHelpers, 'SetRecordFunction(pIsolate, LocalContext, LocalClientObject, "' + strMethod + '"', 'SetFunction(pIsolate, LocalContext, LocalClientObject, "' + strMethod + '"'), ExpectedFailure: "Initialize IClient records with own fields and methods" })),
	...["Incoming", "Outgoing"].map(strFieldName => ({ Name: "ServerStatisticsRecord" + strFieldName + "InheritedSet", Source: g_strThrowError, ServerSource: ReplaceOnce(g_strServerHelpers, 'SetRecordProperty(pIsolate, LocalContext, LocalStatisticsObject, "' + strFieldName + '", v8::Number::New(pIsolate, fl' + strFieldName + '))', 'SetValue(pIsolate, LocalContext, LocalStatisticsObject, "' + strFieldName + '", v8::Number::New(pIsolate, fl' + strFieldName + '))'), ExpectedFailure: "Preserve native callback/property result and type Operation=engines/server Server.GetNetworkStatistics()" })),
	...[
		"GetConnectedClientCount",
		"GetServerPassword",
		"IsReplayServer",
		"GetClient",
		"DisconnectClient",
	].map(strMethod => ({ Name: "ServerRecord" + strMethod + "InheritedSet", Source: g_strThrowError, ServerSource: ReplaceOnce(g_strServerHelpers, 'SetRecordFunction(pIsolate, LocalContext, LocalEngineServerObject, "' + strMethod + '"', 'SetFunction(pIsolate, LocalContext, LocalEngineServerObject, "' + strMethod + '"'), ExpectedFailure: "Initialize IServer records with own methods" })),
	...[
		"Slay",
		"ExecuteClientCommand",
		"SetName",
		"Say",
		"SayTeam",
		"Kick",
		"Ban",
		"ChangeTeam",
		"GiveNamedItem",
	].map(strMethod => ({ Name: "PlayerRecord" + strMethod + "InheritedSet", Source: g_strThrowError, PropertySource: ReplaceOnce(g_strPlayerProperties, 'SetRecordFunction(pIsolate, LocalContext, LocalPlayerObject, "' + strMethod + '"', 'SetFunction(pIsolate, LocalContext, LocalPlayerObject, "' + strMethod + '"'), ExpectedFailure: "Initialize Player records with own methods" })),
	{ Name: "ClientAddressCase", Source: g_strThrowError, ClientSource: ReplaceOnce(g_strClientHelpers, g_strClientAddressParser, ReplaceOnce(g_strClientAddressParser, 'constexpr char kAddressPropertyName[] = "Address";', 'constexpr char kAddressPropertyName[] = "address";')) },
	{ Name: "ClientPropertyGuard", Source: g_strThrowError, ClientSource: ReplaceOnce(g_strClientHelpers, "if (LocalAddressPropertyName.IsEmpty())", "if (!LocalAddressPropertyName.IsEmpty())") },
	...[
		"DisconnectClient",
		"ExecuteClientStringCommand",
		"PrintToClientConsole",
		"GetUserSetting",
		"SetNetworkRate",
		"SetUpdateRate",
	].map(strOperation => ({ Name: "Client" + strOperation + "Translation", Source: g_strThrowError, ClientSource: ReplaceOnce(g_strClientHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "engines/server Client.' + strOperation + '() failed because a native C++ exception occurred.");', "return;") })),
	{ Name: "ClientGetterTranslation", Source: g_strThrowError, ClientSource: ReplaceOnce(g_strClientHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "engines/server IClient property failed because a native C++ exception occurred.");', "return;") },
	...g_vecServerFamilies.map(strFamily => ({ Name: "Server" + strFamily + "Translation", Source: g_strThrowError, ServerSource: ReplaceOnce(g_strServerHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "engines/server Server ' + strFamily.toLowerCase().replace("number", "numeric") + ' property failed because a native C++ exception occurred.");', "return;") })),
	...[
		"GetClient",
		"GetNetworkStatistics",
		"SetServerPassword",
		"SetServerPaused",
		"SetServerTimescale",
		"DisconnectClient",
	].map(strOperation => ({ Name: "Server" + strOperation + "Translation", Source: g_strThrowError, ServerSource: ReplaceOnce(g_strServerHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "engines/server Server.' + strOperation + '() failed because a native C++ exception occurred.");', "return;") })),
	...[
		"GetServer",
		"GetServerFromAddress",
	].map(strOperation => ({ Name: strOperation + "Translation", Source: g_strThrowError, ServerSource: ReplaceOnce(g_strServerHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "engines/server.' + strOperation + '() failed because a native C++ exception occurred.");', "return;") })),
	{ Name: "PlayerKickTranslation", Source: g_strThrowError, ServerSource: ReplaceOnce(g_strServerHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "Player.Kick() failed because a native C++ exception occurred.");', "return;") },
	...g_vecPlayerErrorProbes.map(Probe => ({ Name: Probe.Name + "Translation", Source: g_strThrowError, PlayerSource: ReplaceOnce(g_strPlayerHelpers, 'ThrowError(CallbackInformation.GetIsolate(), "' + Probe.Operation + ' failed because a native C++ exception occurred.");', "return;") })),
	{ Name: "PlayerGetterTranslation", Source: g_strThrowError, PlayerSource: ReplaceOnce(g_strPlayerHelpers, 'ThrowError(PropertyCallbackInformation.GetIsolate(), "Player property failed because a native C++ exception occurred.");', "return;") },
	{ Name: "BanWriteDispatchOrder", Source: g_strThrowError, PlayerSource: ReplaceOnce(g_strPlayerHelpers, 'RunServerCommand(pIsolate, "writeid", kOperation) && bWasBanned', 'bWasBanned && RunServerCommand(pIsolate, "writeid", kOperation)') },
	{ Name: "PlayerOriginKeyCase", Source: g_strThrowError, PlayerSource: ReplaceOnce(g_strPlayerHelpers, 'LocalObject, "X", v8::Number::New(pIsolate, VectorValue.x)', 'LocalObject, "x", v8::Number::New(pIsolate, VectorValue.x)') },
	...g_vecPlayerQueryProbes.map(Probe => ({ Name: Probe.Name + "Translation", Source: g_strThrowError, PropertySource: ReplaceOnce(g_strPlayerProperties, 'ThrowError(CallbackInformation.GetIsolate(), "' + Probe.Operation + ' failed because a native C++ exception occurred.");', "return;") })),
	{ Name: "PlayerPropertyWriteTranslation", Source: g_strThrowError, PropertySource: ReplaceOnce(g_strPlayerProperties, 'ThrowError(PropertyCallbackInformation.GetIsolate(), "Player property write failed because a native C++ exception occurred.");', "return;") },
	{ Name: "EntityPropertyTranslation", Source: g_strThrowError, PropertySource: ReplaceOnce(g_strPlayerProperties, 'ThrowError(PropertyCallbackInformation.GetIsolate(), "Entity property failed because a native C++ exception occurred.");', "return;") },
	{ Name: "EntityPropertyWriteTranslation", Source: g_strThrowError, PropertySource: ReplaceOnce(g_strPlayerProperties, 'ThrowError(PropertyCallbackInformation.GetIsolate(), "Entity property write failed because a native C++ exception occurred.");', "return;") },
	{ Name: "ConVarPropertyTranslation", Source: g_strThrowError, ConVarSource: ReplaceOnce(g_strConVarProperties, 'ThrowError(PropertyCallbackInformation.GetIsolate(), "ConVar property failed because a native C++ exception occurred.");', "return;") },
	{ Name: "ConVarPropertyWriteTranslation", Source: g_strThrowError, ConVarSource: ReplaceOnce(g_strConVarProperties, 'ThrowError(PropertyCallbackInformation.GetIsolate(), "ConVar property write failed because a native C++ exception occurred.");', "return;") },
	{ Name: "ConVarNaNValidation", Source: g_strThrowError, ConVarSource: ReplaceOnce(g_strConVarProperties, "!std::isfinite(dblValue) || (std::fabs(dblValue) > kMaximumNativeFloat)", "std::fabs(dblValue) > kMaximumNativeFloat") },
	...g_vecConCommandErrorProbes.map(Probe => ({ Name: "ConCommand" + Probe.Name + "Translation", Source: g_strThrowError, ConCommandSource: ReplaceOnce(g_strConCommandProperties, 'ThrowError(PropertyCallbackInformation.GetIsolate(), "' + Probe.Operation + ' failed because a native C++ exception occurred.");', "return;") })),
	{ Name: "CoreVersionTranslation", Source: g_strThrowError, ConCommandSource: ReplaceOnce(g_strConCommandProperties, 'ThrowError(CallbackInformation.GetIsolate(), "core.GetVersion() failed because a native C++ exception occurred.");', "return;") },
	{ Name: "ConCommandPropertyCase", Source: g_strThrowError, ConCommandSource: ReplaceOnce(g_strConCommandProperties, 'constexpr char kIsCommandPropertyName[] = "IsCommand";', 'constexpr char kIsCommandPropertyName[] = "isCommand";') },
];

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strRoot, "build"));
const g_unMaximumParallelBuildJobs = 2;
const g_bDatamapPropertiesOnly = g_vecArguments[2] === "--datamap-properties-only";
const g_bEntityPropertiesOnly = g_vecArguments[2] === "--entity-properties-only";
const g_bEntityPropertyLifetimeOnly = g_vecArguments[2] === "--entity-property-lifetime-only";
const g_bFilesystemOnly = g_vecArguments[2] === "--filesystem-only";
const g_bKeyValuesOnly = g_vecArguments[2] === "--keyvalues-only";
const g_bBitBuffersOnly = g_vecArguments[2] === "--bitbuffers-only";
const g_bSoundOnly = g_vecArguments[2] === "--sound-only";
const g_bSpatialPartitionOnly = g_vecArguments[2] === "--spatial-partition-only";
const g_bMapLoadTypeOnly = g_vecArguments[2] === "--map-load-type-only";
const g_bTextMessageOnly = g_vecArguments[2] === "--text-message-only";
const g_bTransmitSnapshotsOnly = g_vecArguments[2] === "--transmit-snapshots-only";
const g_bClientKeyValuesOnly = g_vecArguments[2] === "--client-keyvalues-only";
const g_bInstallationOnly = g_vecArguments[2] === "--installation-only";
const g_bConsoleBootstrapOnly = g_vecArguments[2] === "--console-bootstrap-only";
const g_bCVarCreationOnly = g_vecArguments[2] === "--cvar-creation-only";
const g_bPlayerBanOnly = g_vecArguments[2] === "--player-ban-only";
const g_bWeaponsDictionaryOnly = g_vecArguments[2] === "--weapons-dictionary-only";
const g_bEngineAddressRecordsOnly = g_vecArguments[2] === "--engine-address-records-only";
const g_bClientRecordsOnly = g_vecArguments[2] === "--client-records-only";
const g_bServerRecordsOnly = g_vecArguments[2] === "--server-records-only";
const g_bPlayerRecordsOnly = g_vecArguments[2] === "--player-records-only";
const g_bEntityRecordsOnly = g_vecArguments[2] === "--entity-records-only";
const g_bCoreRecordsOnly = g_vecArguments[2] === "--core-records-only";
const g_bEntityHookOptionsOnly = g_vecArguments[2] === "--entity-hook-options-only";
const g_bBindingRecordsOnly = g_vecArguments[2] === "--binding-records-only";
const g_bCVarEnumerationOnly = g_vecArguments[2] === "--cvar-enumeration-only";
const g_bCVarFlagsTagsOnly = g_vecArguments[2] === "--cvar-flags-tags-only";
const g_bEventRecordsOnly = g_vecArguments[2] === "--event-records-only";
const g_bRuntimeRequireOnly = g_vecArguments[2] === "--runtime-require-only";
const g_strFocusedFamily = g_bFilesystemOnly ? "Filesystem" : g_bKeyValuesOnly ? "KeyValues" : g_bSoundOnly ? "Sound" : "BitBuffer";

function SelectFixtureCases() {
	if (g_bEventRecordsOnly) {
		return g_vecCases.filter(Case => ["Current", "CurrentNoEventUInt64"].includes(Case.Name) || Case.Name.startsWith("EventRecords"));
	}

	if (g_bCVarFlagsTagsOnly) {
		return g_vecCases.filter(Case => ["Current", "CurrentNoNotify", "CurrentAllCVarFlags"].includes(Case.Name) || Case.Name.startsWith("CVarFlagsTags"));
	}

	if (g_bCVarEnumerationOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("CVarEnumeration"));
	}

	if (g_bBindingRecordsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || (Case.Name === "CurrentLegacyBindingRecords") || Case.Name.startsWith("BindingRecords"));
	}

	if (g_bEntityHookOptionsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("EntityHookOptions"));
	}

	if (g_bCoreRecordsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("CoreRecord"));
	}

	if (g_bPlayerRecordsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || (Case.Name === "CurrentNoBaseEntity") || Case.Name.startsWith("PlayerRecord"));
	}

	if (g_bServerRecordsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("ServerRecord"));
	}

	if (g_bClientRecordsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("ClientRecord") || Case.Name.startsWith("ServerStatisticsRecord"));
	}

	if (g_bEngineAddressRecordsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("EngineAddressRecord"));
	}

	if (g_bEntityRecordsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || (Case.Name === "CurrentNoBaseEntity") || Case.Name.startsWith("EntityRecord") || Case.Name.startsWith("MissingConVarRecord") || ["HandleZeroValidity", "AddressKeyCase", "AddressNumber"].includes(Case.Name));
	}

	if (g_bRuntimeRequireOnly) {
		return g_vecCases.filter(Case => Case.RuntimeRequireProfile);
	}

	if (g_bEntityPropertyLifetimeOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("EntityPropertiesLifetime"));
	}

	if (g_bWeaponsDictionaryOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("WeaponDictionary"));
	}

	if (g_bClientKeyValuesOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || (Case.Name === "CurrentOldConsoleAPI") || Case.Name.startsWith("ClientKeyValues"));
	}

	if (g_bTransmitSnapshotsOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || (Case.Name === "CurrentOldConsoleAPI") || Case.Name.startsWith("EngineTransmit"));
	}

	if (g_bTextMessageOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || (Case.Name === "CurrentOldConsoleAPI") || Case.Name.startsWith("EngineTextMessage"));
	}

	if (g_bCVarCreationOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || (Case.Name === "CurrentNoConVarCreation") || Case.Name.startsWith("CVarOwned"));
	}

	if (g_bConsoleBootstrapOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("ConsoleBootstrap"));
	}

	if (g_bPlayerBanOnly) {
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith("PlayerBanDuration") || (Case.Name === "PlayerBanTranslation"));
	}

	if (g_bSpatialPartitionOnly || g_bMapLoadTypeOnly || g_bInstallationOnly) {
		const strPrefix = g_bInstallationOnly ? "Installation" : g_bMapLoadTypeOnly ? "MapLoadType" : "SpatialPartition";
		return g_vecCases.filter(Case => (Case.Name === "Current") || Case.Name.startsWith(strPrefix) || (g_bSpatialPartitionOnly && (Case.Name.startsWith("ClientVolume") || Case.Name.startsWith("ClientPresentation") || Case.Name.startsWith("EntityRecord"))));
	}

	if (g_bFilesystemOnly || g_bKeyValuesOnly || g_bBitBuffersOnly || g_bSoundOnly) {
		return g_vecCases.filter(Case => Case.GameEventProfile && ((Case.Name === "Current") || Case.Positive || Case.Name.includes(g_strFocusedFamily)));
	}

	if (g_bEntityPropertiesOnly) {
		return g_vecCases.filter(Case => Case.GameEventProfile && ((Case.Name === "Current") || Case.Positive || Case.Name.startsWith("EntityProperties")));
	}

	if (g_bDatamapPropertiesOnly) {
		return g_vecCases.filter(Case => Case.GameEventProfile && ((Case.Name === "Current") || Case.Positive || Case.Name.startsWith("Datamap") || (Case.Name.startsWith("EntityDatamaps") && Case.Name.endsWith("Boundary"))));
	}

	if (g_vecArguments[2] === "--game-event-payload-only") {
		return g_vecCases.filter(Case => Case.GameEventProfile);
	}

	return g_vecCases;
}

const g_vecSelectedCases = SelectFixtureCases();
const g_unPositiveProfileCount = g_vecSelectedCases.filter(Case => (Case.Name === "Current") || Case.Positive).length;
const g_unNegativeControlCount = g_vecSelectedCases.filter(Case => (Case.Name !== "Current") && !Case.Positive).length;

if (g_bRuntimeRequireOnly) {
	g_Assert.deepEqual(g_vecSelectedCases.map(Case => Case.Name), [
		"RuntimeRequireCurrent",
		"RuntimeRequireMetadataRuntimeDataIndex",
		"RuntimeRequireMetadataGlobalRequireDataIndex",
		"RuntimeRequireMetadataParentScriptDataIndex",
		"RuntimeRequireGetterRuntime",
		"RuntimeRequireGetterGlobal",
		"RuntimeRequireGetterParent",
		"RuntimeRequireLocalFailure",
		"RuntimeRequireNativeUnwind",
		"RuntimeRequireTermination",
		"RuntimeCommonJSExportsExecuteCommonJS",
		"RuntimeCommonJSExportsRequirePackageModule",
		"RuntimeRecordsWithoutUInt64",
		...g_vecRuntimeRecordControls.map(Control => Control.Name),
	], "Keep private require metadata/failures, CommonJS initialization and runtime record factory/capability controls.");
}

if (g_bEntityPropertyLifetimeOnly) {
	g_Assert.deepEqual(g_vecSelectedCases.map(Case => Case.Name), [
		"Current",
		"EntityPropertiesLifetimeSerial",
		"EntityPropertiesLifetimeVectorRevalidation",
		"EntityPropertiesLifetimeOffsetRevalidation",
		"EntityPropertiesLifetimeNameRevalidation",
		"EntityPropertiesLifetimeGenericFloatRevalidation",
		"EntityPropertiesLifetimeFloatRevalidation",
		"EntityPropertiesLifetimeDoubleRevalidation",
	], "Keep current native property callbacks and independently compiled identity/revalidation controls.");
}

if (g_bCVarCreationOnly) {
	g_Assert.deepEqual(g_vecSelectedCases.map(Case => Case.Name), [
		"Current",
		"CurrentNoConVarCreation",
		"CVarOwnedLegacy",
		"CVarOwnedRegistration",
		"CVarOwnedCacheReuse",
		"CVarOwnedUnregisteredFlag",
		"CVarOwnedCleanup",
		"CVarOwnedNameRecheck",
		"CVarOwnedLegacyMarker",
	], "Keep creation availability,legacy ownership and every compiled registration/lifetime negative control.");
}

if (g_bPlayerBanOnly) {
	g_Assert.deepEqual(g_vecSelectedCases.map(Case => Case.Name), [
		"Current",
		"PlayerBanDurationCoercion",
		"PlayerBanDurationFractionGuard",
		"PlayerBanDurationNegativeGuard",
		"PlayerBanDurationUpperBoundary",
		"PlayerBanDurationDefault",
		"PlayerBanTranslation",
	], "Keep strict Ban type/fraction/range/default/translation contracts and their compiled negative controls.");
}

if (g_bSpatialPartitionOnly) {
	g_Assert.deepEqual(g_vecSelectedCases.map(Case => Case.Name), [
		"Current",
		"SpatialPartitionEarlyRelease",
		"SpatialPartitionMissingHandoff",
		"SpatialPartitionCleanupFailure",
		"SpatialPartitionUnguardedConstruction",
		"SpatialPartitionMissingParentScope",
		"SpatialPartitionMovementRevalidation",
		"SpatialPartitionMovementSerial",
		"SpatialPartitionMovementEdictRefresh",
		"SpatialPartitionMovementCollideableRefresh",
		"SpatialPartitionPVSStackAddress",
		"SpatialPartitionPVSAllocationError",
		"SpatialPartitionPVSOwnHeadNode",
		"SpatialPartitionPVSOwnClusterCount",
		"SpatialPartitionPVSOwnArea",
		"SpatialPartitionPVSOwnSecondaryArea",
		"SpatialPartitionPVSOwnCenter",
		"SpatialPartitionPVSOwnIndices",
		"SpatialPartitionPVSOwnClusters",
		"EntityRecordMethodsInheritedSet",
		"EntityRecordInheritedSet",
		"EntityRecordAddressPartialResult",
		"EntityRecordHandlePartialResult",
		"SpatialPartitionClusterRevalidation",
		"SpatialPartitionClusterSerial",
		"SpatialPartitionClusterHandleAlias",
		"SpatialPartitionClusterEdictRefresh",
		"SpatialPartitionCapabilityAvailability",
		"ClientVolumeRevalidation",
		"ClientVolumeSerial",
		"ClientVolumeHandleAlias",
		"ClientVolumeEdictRefresh",
		"ClientVolumeEarlyHandleError",
		"ClientVolumePrimitiveHandle",
		"ClientVolumeLateCapture",
		"ClientPresentationViewRevalidation",
		"ClientPresentationViewRefresh",
		"ClientPresentationCrosshairRevalidation",
		"ClientPresentationCrosshairRefresh",
		"ClientPresentationSerial",
	], "Keep the positive engine profile and each ownership/identity negative control.");
}

if (g_bMapLoadTypeOnly) {
	g_Assert.deepEqual(g_vecSelectedCases.map(Case => Case.Name), [
		"Current",
		"MapLoadTypeNativeUnwind",
		"MapLoadTypeRegularRethrow",
	], "Keep the positive installer profile and both error-identity negative controls.");
}

if (g_bInstallationOnly) {
	g_Assert.deepEqual(g_vecSelectedCases.map(Case => Case.Name), [
		"Current",
		"InstallationMessageHookOwnArguments",
		"InstallationMessageHookOwnFields",
		"InstallationMessageRecipientOwnIndices",
		"InstallationMessageRecipientOwnFields",
		"InstallationMessageBitBufferOwnFields",
		"InstallationProtobufOwnRecipientIndices",
		"InstallationProtobufOwnRecipientFields",
		"InstallationProtobufOwnBindingAddress",
		"InstallationProtobufOwnBindingOperation",
		"InstallationProtobufOwnMethods",
		"InstallationGlobalsOwnMethods",
		"InstallationBaseMessageFields",
		"InstallationBaseMessageContainers",
		"InstallationBaseMessageFractionBits",
		"InstallationDialogOwnFields",
		"InstallationGlobalsSDKBranchOwnField",
		"InstallationRepeatedInt32Revalidation",
		"InstallationRepeatedUInt32Revalidation",
		"InstallationRepeatedFloatRevalidation",
		"InstallationRepeatedDoubleRevalidation",
		"InstallationRepeatedEnumRevalidation",
		"InstallationUserMessageZeroBitDispatch",
		"InstallationUserMessageBitWidthMask",
		"InstallationRecipientLiveIndex",
		"InstallationRecipientLateReliable",
		"InstallationRecipientLateInitialization",
		"InstallationProtobufRecipientLiveIndex",
		"InstallationProtobufRecipientLateReliable",
		"InstallationProtobufRecipientLateInitialization",
		"InstallationBitBufferLateCursor",
		"InstallationBitBufferLateOverflow",
		"InstallationNativeUnwind0",
		"InstallationNativeUnwind1",
		"InstallationNativeUnwind2",
		"InstallationNativeUnwind3",
		"InstallationNativeUnwind4",
		"InstallationNativeUnwind5",
		"InstallationNativeUnwind6",
		"InstallationTruncatedMessageName",
		"InstallationParserUnwind0",
		"InstallationParserUnwind1",
		"InstallationParserUnwind2",
		"InstallationParserUnwind3",
		"InstallationChatUnwind0",
		"InstallationChatUnwind1",
		"InstallationChatUnwind2",
		"InstallationChatUnwind3",
		"InstallationRawName0",
		"InstallationRawName1",
		"InstallationScopeCleanup",
		"InstallationScopeClearOrder",
	], "Keep the positive profile, every prior control and chat/name/lifecycle controls.");
}

if (g_bDatamapPropertiesOnly || g_bEntityPropertiesOnly || g_bFilesystemOnly || g_bKeyValuesOnly || g_bBitBuffersOnly || g_bSoundOnly) {
	g_Assert.deepEqual(g_vecSelectedCases.filter(Case => (Case.Name === "Current") || Case.Positive).map(Case => Case.Name), g_vecCases.filter(Case => Case.GameEventProfile && ((Case.Name === "Current") || Case.Positive)).map(Case => Case.Name), "Keep every positive capability profile in each focused property run.");
}

function ResolveFixtureFilesystemPlaceholders(strProgram, strDirectory, strCaseName) {
	g_Assert(!/@[A-Z_]+@/.test(strProgram.replaceAll("@FIXTURE_FILESYSTEM_DIRECTORY@", "").replaceAll("@FIXTURE_FILESYSTEM_CASE@", "")), "Resolve every insertion point.");

	return strProgram.replaceAll("@FIXTURE_FILESYSTEM_DIRECTORY@", () => JSON.stringify(strDirectory.replaceAll("\\", "/"))).replaceAll("@FIXTURE_FILESYSTEM_CASE@", () => JSON.stringify(strCaseName));
}

function VerifyFixtureFilesystemPlaceholders() {
	const strTemplate = "@FIXTURE_FILESYSTEM_DIRECTORY@|@FIXTURE_FILESYSTEM_CASE@|@FIXTURE_FILESYSTEM_DIRECTORY@";
	const strCaseName = "LiteralFixture";

	// Text-only probes, not filesystem or CMake path-admission claims.
	const vecProbes = [
		{ Directory: "C:\\Fixture\\Plain", ExpectedDirectory: "C:/Fixture/Plain" },
		{ Directory: "C:\\Fixture\\$&$$$`$'$1$<Name>", ExpectedDirectory: "C:/Fixture/$&$$$`$'$1$<Name>" },
		{ Directory: "C:/Fixture/@PATH_DATA@", ExpectedDirectory: "C:/Fixture/@PATH_DATA@" },
	];
	for (const Probe of vecProbes) {
		const strExpectedProgram = JSON.stringify(Probe.ExpectedDirectory) + "|" + JSON.stringify(strCaseName) + "|" + JSON.stringify(Probe.ExpectedDirectory);
		g_Assert.equal(ResolveFixtureFilesystemPlaceholders(strTemplate, Probe.Directory, strCaseName), strExpectedProgram, "Filesystem placeholder data must remain literal and complete.");
	}

	g_Assert.throws(() => ResolveFixtureFilesystemPlaceholders("@UNRESOLVED_HELPER@", "FixtureDirectory", strCaseName), /Resolve every insertion point\./);
}

function RenderFixtureCase(Case) {
	const strProgram = (Case.TemplateSource ?? g_strTemplate)
		.replace("@RUNTIME_REQUIRE_HELPERS@", () => Case.RuntimeRequireSource ?? g_strRuntimeRequireObserved)
		.replace("@RUNTIME_COMMONJS_EXPORT_INITIALIZERS@", () => Case.CommonJSExportsSource ?? g_strCommonJSExportsInitializers)
		.replace("@RUNTIME_RECORD_PAYLOAD_HELPERS@", () => Case.RuntimeRecordPayloadSource ?? g_strRuntimeRecordPayloadHelpers)
		.replace("@RUNTIME_GAME_EVENT_VIEW_FACTORY@", () => Case.RuntimeGameEventViewSource ?? g_strRuntimeGameEventViewFactory)
		.replace("@BINDING_ERROR_HELPERS@", () => [
			g_strMakeString,
			Case.Source,
			g_strThrowTypeError,
			g_strValueToString,
			GetDefinition("GetInt32Argument"),
			g_strConverters,
			Case.VectorSource ?? g_strRequiredVector,
			Case.SettersSource ?? g_strSetters,
			"@FIXTURE_BOOLEAN_SETTER@",
			Case.HandleSource ?? g_strHandleRecord,
			Case.AddressSource ?? g_strAddressRecord,
			Case.BinarySource ?? g_strBinaryRecord,
		].join("\n\n"))
		.replace("@PLAYER_INDEX_HELPERS@", () => g_strPlayerIndexHelpers)
		.replace("@QUOTE_COMMAND_HELPER@", () => GetDefinition("QuoteCommandArgument"))
		.replace("@ENTITY_CALLBACK_HELPERS@", () => (Case.CSGO ? "#define ENGINE_CSGO 1\n" : "") + (Case.CallbackSource ?? g_strCallbacks))
		.replace("@CLIENT_CALLBACK_HELPERS@", () => Case.ClientSource ?? g_strClientHelpers)
		.replace("@SERVER_PROPERTY_HELPERS@", () => "#define SOURCEJS_HAS_ISERVER 1\n" + (Case.ServerSource ?? g_strServerHelpers) + "\n#undef SOURCEJS_HAS_ISERVER")
		.replace("@PLAYER_CALLBACK_HELPERS@", () => (Case.PlayerSource ?? g_strPlayerHelpers) + (Case.NoBaseEntity ? "" : "\n\n#if !defined(SOURCEJS_HAS_BASE_ENTITY)\n#define SOURCEJS_HAS_BASE_ENTITY 1\n#define SOURCEJS_FIXTURE_OWNS_PLAYER_BASE_ENTITY 1\n#endif"))
		.replace("@PLAYER_PROPERTY_HELPERS@", () => Case.PropertySource ?? g_strPlayerProperties)
		.replace("@CONVAR_PROPERTY_HELPERS@", () => Case.ConVarSource ?? g_strConVarProperties)
		.replace("@CONCOMMAND_PROPERTY_HELPERS@", () => "// Controlled build macros, not deployed metadata.\n#define SOURCEJS_VERSION \"FixtureVersion\"\n#define SOURCEJS_GIT_COMMIT \"FixtureCommit\"\n#define SOURCEJS_SDK_BRANCH \"FixtureSDK\"\n#define SOURCEJS_TARGET_PLATFORM \"FixturePlatform\"\n#define SOURCEJS_TARGET_ARCH \"FixtureArchitecture\"\n" + (Case.ConCommandSource ?? g_strConCommandProperties) + "\n\n" + (Case.CoreInformationSource ?? g_strCoreInformationHelpers) + "\n#undef SOURCEJS_TARGET_ARCH\n#undef SOURCEJS_TARGET_PLATFORM\n#undef SOURCEJS_SDK_BRANCH\n#undef SOURCEJS_GIT_COMMIT\n#undef SOURCEJS_VERSION")
		.replace("@CORE_CHECKSUM_AND_GAME_EVENT_HELPERS@", () => "// Controlled SDK macro, not an MD5 implementation.\n#define MD5_DIGEST_LENGTH kFixtureDigestByteCount\n" + (Case.ChecksumAndEventSource ?? g_strChecksumAndGameEvents) + "\n#undef MD5_DIGEST_LENGTH")
		.replace("@COMMAND_NAME_HELPER@", () => Case.CommandNameSource ?? g_strCommandName)
		.replace("@CVAR_LOOKUP_AND_ENUMERATION_HELPERS@", () => Case.CVarLookupSource ?? g_strCVarLookups)
		.replace("@CVAR_OPERATION_HELPERS@", () => Case.CVarOperationSource ?? g_strCVarOperations)
		.replace("@CVAR_PUBLIC_AND_TAG_HELPERS@", () => Case.CVarPublicAndTagSource ?? g_strCVarPublicAndTagHelpers)
		.replace("@EVENT_RESOURCE_HELPERS@", () => Case.EventResourceSource ?? g_strEventResourceHelpers)
		.replace("@GAME_EVENT_PAYLOAD_HELPERS@", () => Case.GameEventSource ?? g_strGameEventPayloadHelpers)
		.replace("@PLAYER_TEAM_DATA_RECORD@", () => g_strPlayerTeamDataRecord)
		.replace("@PLAYER_COLLECTION_HELPERS@", () => Case.PlayerCollectionSource ?? g_strPlayerCollectionHelpers)
		.replace("@RECIPIENT_DICTIONARY_VOICE_HELPERS@", () => (Case.NoVoiceInterface ? "" : "#define SOURCEJS_HAS_VOICE_SERVER 1\n") + (Case.RecipientDictionaryVoiceSource ?? g_strRecipientDictionaryVoiceHelpers) + (Case.NoVoiceInterface ? "" : "\n#undef SOURCEJS_HAS_VOICE_SERVER"))
		.replace("@PLAYER_IDENTITY_HELPERS@", () => "\t\tconstexpr bool kPlayerSpawnAvailable = " + (Case.OldConsoleAPI ? "false" : "true") + ";\n\n" + (Case.OldConsoleAPI ? "#define SOURCEJS_OLD_CONSOLE_API 1\n" : "") + (Case.PlayerIdentitySource ?? g_strPlayerIdentityHelpers) + (Case.OldConsoleAPI ? "\n#undef SOURCEJS_OLD_CONSOLE_API" : ""))
		.replace("@SERVER_CLIENT_CVAR_CALLBACK_HELPERS@", () => Case.ClientCVarSource ?? g_strClientCVarCallbacks)
		.replace("@ENGINE_VISIBILITY_CALLBACK_HELPERS@", () => Case.EngineVisibilitySource ?? g_strEngineVisibilityCallbacks)
		.replace("@ENTITY_FACTORY_CALLBACK_HELPERS@", () => Case.FactoryCallbackSource ?? g_strFactoryCallbacks)
		.replace("@ENGINE_TEXT_MESSAGE_HELPERS@", () => Case.TextMessageSource ?? g_strTextMessageHelpers)
		.replace("@ENGINE_PLAYER_INFORMATION_HELPERS@", () => Case.EnginePlayerInformationSource ?? g_strEnginePlayerInformationHelpers)
		.replace("@ENGINE_TRANSMIT_SNAPSHOT_HELPERS@", () => Case.TransmitSnapshotSource ?? g_strTransmitSnapshotHelpers)
		.replace("@ENGINE_TRANSMIT_RECORD_HELPERS@", () => Case.TransmitRecordSource ?? g_strTransmitRecordHelpers)
		.replace("@CLIENT_KEYVALUES_TRANSFER_HELPERS@", () => Case.ClientKeyValuesSource ?? g_strClientKeyValuesHelpers)
		.replace("@DATAMAP_CALLBACK_HELPERS@", () => Case.DatamapSource ?? g_strDatamapCallbacks)
		.replace("@TRACE_CONSTANT_OWN_CONTRACT@", () => g_TraceConstantRecordFixture.Contract)
		.replace("@HOOK_TYPE_DECLARATION@", () => g_strHookTypeDeclaration)
		.replace("@BINDING_RECORD_HELPERS@", () => RenderBindingRecordHelpers(Case))
		.replace("@ENTITY_HOOK_AND_GAME_DESCRIPTION_CALLBACK_HELPERS@", () => Case.EntityHookSource ?? g_strEntityHookAndGameDescriptionCallbacks)
		.replace("@WEAPON_DICTIONARY_HELPERS@", () => Case.WeaponDictionarySource ?? g_strWeaponDictionaryHelpers)
		.replace("@CONSOLE_BOOTSTRAP_PROFILE_BEGIN@", () => (Case.ConsoleOldAPI ? "#define SOURCEJS_OLD_CONSOLE_API 1\n" : "") + (Case.ConsoleUnified ? "#define ENGINE_BRANCH_CSGO 1\n" : ""))
		.replace("@CONSOLE_BOOTSTRAP_PROFILE_END@", () => (Case.ConsoleUnified ? "#undef ENGINE_BRANCH_CSGO\n" : "") + (Case.ConsoleOldAPI ? "#undef SOURCEJS_OLD_CONSOLE_API\n" : ""))
		.replace("@CONSOLE_BOOTSTRAP_HELPERS@", () => Case.ConsoleBootstrapSource ?? g_strConsoleBootstrap);

	const strBooleanSetterDefinition = /\bSetBoolean\s*\(/.test(strProgram) ? g_strBooleanSetter : "";

	return ResolveFixtureFilesystemPlaceholders(strProgram.replace("@FIXTURE_BOOLEAN_SETTER@", () => strBooleanSetterDefinition), g_strDirectory, Case.Name);
}

function VerifyFixtureBooleanSetterSelection() {
	const vecScenarios = [
		{ BooleanSetterRequired: false },
		{ BooleanSetterRequired: true, DatamapSource: RevertProtobufInstallationWrites("RecipientFields") },
	];
	for (const Scenario of vecScenarios) {
		const strProgram = RenderFixtureCase({ Name: "BooleanSetterSelection", Source: g_strThrowError, ...Scenario });
		g_Assert.equal(strProgram.includes(g_strBooleanSetter), Scenario.BooleanSetterRequired, "Emit the boolean setter only when the generated fixture calls it.");
	}
}

VerifyFixtureFilesystemPlaceholders();

const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeBindingErrorsV8-"));
try {
	VerifyFixtureBooleanSetterSelection();

	let strCMake = `cmake_minimum_required(VERSION 3.20)
project(ModuleBindingErrorsV8 LANGUAGES CXX)
include("${g_strRoot}/cmake/SourceJSPackage.cmake")
`;
	for (const Case of g_vecSelectedCases) {
		g_Assert.match(Case.Name, /^[A-Za-z0-9_]+$/, "Source generation uses only a generated case name.");
		const strCaseSourcePath = g_Path.join(g_strDirectory, Case.Name + ".cpp").replaceAll("\\", "/");
		strCMake += "set_source_files_properties(\"" + strCaseSourcePath + "\" PROPERTIES GENERATED TRUE)\n";

		if (Case.OldConsoleAPI) {
			strCMake += "set_source_files_properties(\"" + strCaseSourcePath + "\" PROPERTIES COMPILE_DEFINITIONS SOURCEJS_FIXTURE_OLD_CONSOLE_API=1)\n";
		}

		strCMake += `add_executable(${Case.Name} "${strCaseSourcePath}")
target_compile_features(${Case.Name} PRIVATE cxx_std_20)
target_include_directories(${Case.Name} SYSTEM PRIVATE "${g_strV8Root}/include")
SourceJSLinkV8(${Case.Name} "${g_strV8Root}" "${g_strV8Configuration}" "${g_strPlatform}")
if(MSVC)
	# Match the configured Release V8 monolith's static CRT.
	set_target_properties(${Case.Name} PROPERTIES MSVC_RUNTIME_LIBRARY "MultiThreaded")
	target_compile_options(${Case.Name} PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)
	target_link_libraries(${Case.Name} PRIVATE advapi32 dbghelp winmm ws2_32)
else()
	target_compile_options(${Case.Name} PRIVATE -Wall -Wextra -Werror -pedantic)
	target_link_options(${Case.Name} PRIVATE "-fuse-ld=${ReadCache("SOURCEJS_LINUX_LINKER", false) || "bfd"}")
	target_link_libraries(${Case.Name} PRIVATE dl pthread atomic)
endif()
`;
		if (Case.RuntimeRequireProfile) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_RUNTIME_REQUIRE=1)\n`;
		}

		if (Case.RuntimeWithoutEventUInt64) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_EVENT_NO_UINT64=1)\n`;
		}

		if (Case.LegacyConVars) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_OLD_CONVAR_API=1)\n`;
		}

		if (!Case.NoConVarCreation) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_HAS_CONVAR_CREATION=1)\n`;
		}

		if (!Case.NoVectorXY) {
			// Controlled send-metadata capability; the underlying enum values are not an SDK ABI map.
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_HAS_DPT_VECTORXY=1)\n`;
		}

		if (Case.NoInt64SendProxies) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_NO_INT64_SEND_PROXIES=1)\n`;
		}

		if (Case.TraceNoexceptTermination) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_TRACE_NOEXCEPT_TERMINATION=1)\n`;
		}

		if (Case.NoVoiceInterface) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_NO_VOICE_INTERFACE=1)\n`;
		}

		if (Case.NoVoiceProximity) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_NO_VOICE_PROXIMITY=1)\n`;
		}

		if (Case.NoEventUInt64) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_NO_EVENT_UINT64=1)\n`;
		}

		if (Case.AllCVarFlags) {
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE SOURCEJS_FIXTURE_ALL_CVAR_FLAGS=1 ${g_vecControlledCVarFlagDefinitions.map(vecDefinition => vecDefinition.join("=")).join(" ")})\n`;
		}

		if (!Case.NoNotify) {
			// Controlled SDK capability/value, not a native ABI or flags-layout claim.
			strCMake += `target_compile_definitions(${Case.Name} PRIVATE FCVAR_NOTIFY=0x100)\n`;
		}
	}

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), strCMake);

	const strBinaryRoot = g_Path.join(g_strDirectory, "compiled");
	const vecConfigure = ["-S", g_strDirectory, "-B", strBinaryRoot, "-G", ReadCache("CMAKE_GENERATOR"), "-DCMAKE_CXX_FLAGS=" + ReadCache("CMAKE_CXX_FLAGS", false), "-DCMAKE_EXE_LINKER_FLAGS=" + ReadCache("CMAKE_EXE_LINKER_FLAGS", false)];
	if (process.platform === "win32") {
		vecConfigure.push("-A", ReadCache("CMAKE_GENERATOR_PLATFORM"));
	} else {
		vecConfigure.push("-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_COMPILER=" + ReadCache("CMAKE_CXX_COMPILER"));
	}

	RequireSuccess("cmake", vecConfigure);

	for (const Case of g_vecSelectedCases) {
		// Materialize only the current source; the full matrix remains registered with CMake.
		const strSourcePath = g_Path.join(g_strDirectory, Case.Name + ".cpp");
		g_FileSystem.writeFileSync(strSourcePath, RenderFixtureCase(Case));
		RequireSuccess("cmake", ["--build", strBinaryRoot, "--config", "Release", "--target", Case.Name, "--parallel", String(g_unMaximumParallelBuildJobs)]);
		const strExecutable = g_Path.join(strBinaryRoot, (process.platform === "win32") ? ("Release/" + Case.Name + ".exe") : Case.Name);
		const Result = Run(strExecutable, []);
		const bPositive = (Case.Name === "Current") || (Case.Positive === true);
		g_Assert.equal(Result.status, bPositive ? 0 : 1, Case.Name + "\n" + Result.stdout + Result.stderr);

		if (!bPositive) {
			g_Assert(Result.stderr.includes("Module binding error fixture:"), "Mutation must fail a runtime assertion.");

			if (Case.ExpectedFailure) {
				g_Assert(Result.stderr.includes("Module binding error fixture: " + Case.ExpectedFailure), Case.Name + "\n" + Result.stdout + Result.stderr);
			}

			if (Case.TraceNoexceptTermination) {
				g_Assert(Result.stderr.includes("Module binding error fixture: controlled trace noexcept termination"), "Noexcept mutation must terminate at the controlled native fault.");
			}
		}

		console.log("Real V8 binding error " + Case.Name + ": checked");
		g_Assert.equal(g_FileSystem.realpathSync(strExecutable), g_Path.resolve(strExecutable));
		g_FileSystem.unlinkSync(strExecutable);
		g_Assert.equal(g_FileSystem.realpathSync(strSourcePath), g_Path.resolve(strSourcePath));
		g_FileSystem.unlinkSync(strSourcePath);

		if ((process.platform === "linux") && ["Ninja", "Unix Makefiles"].includes(ReadCache("CMAKE_GENERATOR"))) {
			// Completed cases are independent; keep CMake metadata, but release the generated object before the next V8 link.
			g_Assert.match(Case.Name, /^[A-Za-z0-9_]+$/, "Object cleanup uses only a generated case name.");
			const strFixtureRoot = g_FileSystem.realpathSync(g_strDirectory);
			g_Assert.equal(g_Path.dirname(strFixtureRoot), g_strBuildRoot, "Object cleanup stays within the actual fixture build root.");
			g_Assert(g_Path.basename(strFixtureRoot).startsWith("NativeBindingErrorsV8-"), "Object cleanup stays within the exact fixture family.");
			g_Assert(!g_FileSystem.lstatSync(g_strDirectory).isSymbolicLink());

			const strObjectFile = g_Path.join(strFixtureRoot, "compiled", "CMakeFiles", Case.Name + ".dir", Case.Name + ".cpp.o");
			g_Assert.equal(g_FileSystem.realpathSync(strObjectFile), g_Path.resolve(strObjectFile), "Object cleanup rejects escaping or symbolic paths.");
			g_Assert(g_FileSystem.lstatSync(strObjectFile).isFile(), "Object cleanup removes only a generated regular object file.");
			g_FileSystem.unlinkSync(strObjectFile);
		}
	}
} finally {
	const strResolved = g_FileSystem.realpathSync(g_strDirectory);
	g_Assert.equal(g_Path.dirname(strResolved), g_strBuildRoot, "Cleanup stays within the actual build root.");
	g_Assert(g_Path.basename(strResolved).startsWith("NativeBindingErrorsV8-"), "Cleanup stays within the exact fixture family.");
	g_Assert(!g_FileSystem.lstatSync(g_strDirectory).isSymbolicLink());
	g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
}

if (g_bRuntimeRequireOnly) {
	console.log("Real V8 runtime require checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual require helpers, full game-event view/command-payload factories and shared helpers, plus isolated CommonJS exports-initialization expressions. Record probes cover inherited accessors/non-writable fields and indexes, own method/data construction, exact BigInt token/address and SDK UInt64 capability absence. SDK event shape, event-operation callbacks, internal local-loader operation and error-entry bookkeeping are adapted; no full CommonJS loader/parser/filesystem, live SDK ABI/event dispatch, game-server or allocator/OOM claim.");
} else {
	console.log("Real V8 event/resource/custom-event/player-selection/collection/team/dictionary/recipient/voice checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual current callbacks, uint64 installer and private payload/key/default/copy/resource/collection/team helpers; SDK event/player storage, lookup/dispatch/loading/capabilities, team-data IO, controlled primary-vptr voice storage/dispatch and missing-method sentinel, callback-entry and string-result faults adapted; no live-server, SDK ABI or allocator/OOM claim.");
}

if (g_bPlayerBanOnly) {
	console.log("Real V8 Player.Ban contracts: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual strict numeric duration callback, raw type/fraction/int32 boundaries, omitted defaults, primitive flags, no-coercion/receiver ordering and exception identity; controlled command dispatch, no live bans or SDK ABI claim.");
}

if (g_bDatamapPropertiesOnly) {
	console.log("Real V8 datamap selection/property checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual datamap helpers with controlled SDK metadata, pool and callback-entry faults; no live-server, SDK ABI or allocator/OOM claim.");
}

if (g_bEntityPropertiesOnly) {
	console.log("Real V8 network-property checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual record/entity/field selectors, signed/unsigned64 and scalar/string/address callbacks, retained-string helper and live X/Y/Z accessors; controlled SDK lookup/storage and post-read C++ fault adapters; exact JS error identity, output commits, no-write failures, bounded string-copy and native BigInt limits checked; no live-server, SDK ABI or allocator/OOM claim.");
}

if (g_bFilesystemOnly) {
	console.log("Real V8 filesystem checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual filesystem path/prefix/ownership callbacks, standard physical IO and controlled SDK handles; no live SDK ABI or allocator/OOM claim.");
}

if (g_bKeyValuesOnly) {
	console.log("Real V8 KeyValues string checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual native UTF8/NUL/optional-name helpers and unchanged outputs on rejection; no live SDK parser/ABI or allocator/OOM claim.");
}

if (g_bBitBuffersOnly) {
	console.log("Real V8 BitBuffer state checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual state/byte/property parsers and controlled conversion-entry C++ faults; no live SDK IO or allocator/OOM claim.");
}

if (g_bSoundOnly) {
	console.log("Real V8 sound parser checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual origin/property/recipient-snapshot parsers with controlled vector storage and SDK player eligibility; no SDK allocator/ABI, live playback or OOM claim.");
}

if (g_bSpatialPartitionOnly) {
	console.log("Real V8 spatial-partition ownership checks: " + g_unPositiveProfileCount + " positive profile, " + g_unNegativeControlCount + " compiled negative controls; actual creation/destruction callbacks and unreturned-resource cleanup with controlled SDK dispatch counts and wrapper-entry faults, guarded result setters and nested callback scopes, SolidMoved full-identity/fresh-collideable revalidation with getter and numeric-conversion inputs plus three-/four-argument SDK adapters, PVS own scalar/center/cluster data properties and copied indices plus controlled allocation-entry failure, generic entity-class string snapshots and empty failed record handles, first-entity cluster identity and supported/absent engine capability outputs, client-volume coercion across all four arguments with copied full handles, fresh edicts, primitive paths and original conversion-error precedence, client-view getter and crosshair coercion identity/error/primitive contracts; no SDK ABI, live-server, allocator/OOM or native heap-lifetime claim.");
}

if (g_bMapLoadTypeOnly) {
	console.log("Real V8 MapLoadType installer checks: " + g_unPositiveProfileCount + " positive profile, " + g_unNegativeControlCount + " compiled negative controls; actual installer and controlled SDK enumerator values/string-entry faults, original setter errors and native-unwind identity; no SDK ABI, live-server or allocator/OOM claim.");
}

if (g_bInstallationOnly) {
	console.log("Real V8 globals/messages installation checks: " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; actual factories/readers, sender/name selections, message RAII owner and protobuf Parse branch, plus repeated numeric/enum revalidation prologues; controlled SDK storage/dispatch and entry faults; original errors/output commits, no truncated lookup and once-only message cleanup checked; no SDK ABI, live-server, full delivery, real protobuf parser or allocator/OOM claim.");
}

if (g_vecArguments.length === 2) {
	console.log("Real V8 error/vector/entity-record/callback/client/server/player-property/player-method/player-query/entity-property/convar-property/concommand-property/core-version/checksum/game-event-name/command-name/cvar-lookup/enumeration/public/tags/command/binary-record contracts passed: " + g_strV8Configuration + "; " + g_unPositiveProfileCount + " positive profiles, " + g_unNegativeControlCount + " compiled negative controls; CSGO/TF2/no-base-entity/no-convar-creation/no-notify usage branches; actual Index, quoting, team-value decoding, Entity/Player/Weapon/ConVar/ConCommand factories and property installers, ConVar templates, core.GetVersion, checksum and game-event callbacks, actual command-name coercion and ConVar primitive-name/UTF-8/NUL/output-commit handling and iterator/legacy/unsupported enumeration, current ConVar value/flag/create/public/tag callbacks, tag helpers, conditional flag installer, private event property/string/descriptor/resource helpers and provisional creation-storage cleanup; MakeString/checksum/command-name/ConVar-name/event UTF-8 result faults, private event-helper probe boundary, player lookup, team aliases, standalone invalid metadata, project version macro and SDK/MD5/event/engine/flag/registry/constant-dispatch backends adapted, no allocator/OOM/MD5 algorithm/SDK ABI/live-server/full-sendprop-datamap-method claim.");
}
