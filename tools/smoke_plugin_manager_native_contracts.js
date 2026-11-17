#!/usr/bin/env node

"use strict";

// Compiles actual PluginManager/ListenerPayload sources with narrow path/runtime/log
// doubles. This is a filesystem/lifecycle contract test, not a V8/server test.
// A separate executable compiles real RuntimePaths without those doubles.
// Extracted SourceJSPlugin methods cover clients, callbacks, and modern/legacy
// lifecycle branches. V8 initialization and Application/EngineInterfaces rollback
// executables use API/subsystem doubles, not a live V8 or SDK/server environment.
// Runtime callback executables extract command/require barriers and use V8/SDK doubles.
// Lifecycle export lookup/call checks extract the real method and use V8 API doubles.
// Event-state checks extract snapshot/registration code; dispatch integration is checked separately.
// Command-state checks extract registration/rollback, plugin startup/unload and server dispatch with callback/SDK doubles.
// Async-request checks execute extracted methods with real dedicated threads and V8/logging doubles.
// Runtime read-file checks use the extracted method and actual temporary filesystem inputs.
// Sound emission checks run the extracted dispatcher against four SDK method shapes.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
let g_strProfile = "";

if (g_vecArguments.length !== 0) {
	if ((g_vecArguments.length !== 2) || (g_vecArguments[0] !== "--profile") || !["X86", "X64"].includes(g_vecArguments[1])) {
		console.error("Usage: node tools/smoke_plugin_manager_native_contracts.js [--profile X86|X64]");
		process.exit(2);
	}

	g_strProfile = g_vecArguments[1];
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");

const g_strProjectRoot = g_FileSystem.realpathSync(g_Path.resolve(__dirname, ".."));
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strRoot = g_strProjectRoot.replace(/\\/g, "/");
g_Assert(!/[;"\r\n]|\$\{|\]/.test(g_strRoot), "Unsupported CMake project path");

const g_unTimeoutMilliseconds = 240000;
const g_unOutputLimitBytes = 16 * 1024 * 1024;
// Child fixtures install a terminate handler that exits with this cross-language receipt.
const g_nExpectedTerminationExitCode = 73;

const g_vecProfiles = ((process.platform === "win32") ? [
	{ Name: "X86", AddressSize: 4, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", AddressSize: 8, Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", AddressSize: 4, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", AddressSize: 8, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
]).filter(Profile => !g_strProfile || (Profile.Name === g_strProfile));

function Run(strCommand, vecArguments, nExpectedExitCode = 0) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unTimeoutMilliseconds, maxBuffer: g_unOutputLimitBytes });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Unexpected native process signal: " + Result.signal + "\n" + Result.stdout + Result.stderr);
	g_Assert.equal(Result.status, nExpectedExitCode, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "Native manager fixture warning:\n" + Result.stdout + Result.stderr);

	return Result;
}

function RunExpectedTermination(strProgram, strScenario) {
	const Result = g_ChildProcess.spawnSync(strProgram, [strScenario], { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unTimeoutMilliseconds, maxBuffer: g_unOutputLimitBytes });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Fixture termination must use its exit handler, not a process signal");
	g_Assert.equal(Result.status, g_nExpectedTerminationExitCode, strScenario + ": " + Result.stdout + Result.stderr);
}

const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativePluginManager-"));

try {
	const strPluginSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/SourceJSPlugin.cpp"), "utf8");
	const ExtractDefinition = (Expression, strRole) => {
		const vecMatches = [...strPluginSource.matchAll(Expression)];
		g_Assert.equal(vecMatches.length, 1, "Expected exactly one " + strRole + " definition");

		return vecMatches[0][0];
	};

	const strSayCommandConstants = ExtractDefinition(/^\tconstexpr char const\* kSayCommandNames\[\] = [^\r\n]*;\r?\n\tconstexpr std::size_t kSayCommandCount[^\r\n]*;\r?\n\tconstexpr std::size_t kGlobalSayCommandIndex[^\r\n]*;/gm, "stock chat command constants");
	const strSquadSayCommandIndex = ExtractDefinition(/^\tconstexpr std::size_t kSquadSayCommandIndex[^\r\n]*;/gm, "squad chat command index");
	const strCallbackBoundary = ExtractDefinition(/^\ttemplate <typename TCallback>\r?\n\tbool InvokeEngineCallback\([^\r\n]*\) noexcept \{[\s\S]*?^\t\}/gm, "callback boundary");
	const strGetEntityIndex = ExtractDefinition(/^\tint GetEntityIndex\([^\r\n]*\) \{[\s\S]*?^\t\}/gm, "GetEntityIndex");
	const strDispatchSourceJS = ExtractDefinition(/^\tvoid DispatchSourceJSCommand\([^\r\n]*\) \{[\s\S]*?^\t\}/gm, "DispatchSourceJSCommand");
	const strFindSayCommandIndex = ExtractDefinition(/^\tstd::size_t FindSayCommandIndex\([^\r\n]*\) \{[\s\S]*?^\t\}/gm, "stock chat command lookup");
	const strSayDispatch = ExtractDefinition(/^\tstruct SayDispatchRecord \{[\s\S]*?^\tvoid InstallSayDispatch\(\) \{[\s\S]*?^\t\}/gm, "stock chat dispatch hook");
	const strHandleClientCommand = ExtractDefinition(/^\tPLUGIN_RESULT HandleClientCommand\([^\r\n]*\) \{[\s\S]*?^\t\}/gm, "HandleClientCommand");
	const strSetCommandClient = ExtractDefinition(/^void CSourceJSPlugin::SetCommandClient\([^\r\n]*\) \{[\s\S]*?^\}/gm, "SetCommandClient");
	const strGetCommandClient = ExtractDefinition(/^int CSourceJSPlugin::GetCommandClient\([^\r\n]*\) const noexcept \{[\s\S]*?^\}/gm, "GetCommandClient");
	const strClientConnect = ExtractDefinition(/^PLUGIN_RESULT CSourceJSPlugin::ClientConnect\([^\r\n]*\) \{[\s\S]*?^\}/gm, "ClientConnect");
	const vecMethodsHeader = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTSOURCEJSLISTENCLIENTMETHODS_H_",
		"#define _SOURCEJSTESTSOURCEJSLISTENCLIENTMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding fixture doubles are required.",
		"namespace {",
		"",
		strSayCommandConstants,
		strSquadSayCommandIndex,
		"",
		strCallbackBoundary,
		"",
		strGetEntityIndex,
		"",
		strDispatchSourceJS,
		"",
		strFindSayCommandIndex,
		"",
		strSayDispatch,
		"",
		strHandleClientCommand,
		"} // namespace",
		"",
		strSetCommandClient,
		"",
		strGetCommandClient,
		"",
		strClientConnect,
		"",
		"#endif // _SOURCEJSTESTSOURCEJSLISTENCLIENTMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "SourceJSListenClientMethods.h"), vecMethodsHeader.join("\n") + "\n");

	const strNoCommandClientSlot = ExtractDefinition(/^\tconstexpr int kNoCommandClientSlot = [^\r\n]*;$/gm, "command client slot sentinel");
	const strPluginConstructor = ExtractDefinition(/^CSourceJSPlugin::CSourceJSPlugin\(\) \{[\s\S]*?^\}/gm, "plugin constructor");
	const strRegisterVariables = ExtractDefinition(/^bool CSourceJSPlugin::RegisterConsoleVariables\([^\r\n]*\) \{[\s\S]*?^\}/gm, "RegisterConsoleVariables");
	const strUnregisterVariables = ExtractDefinition(/^void CSourceJSPlugin::UnregisterConsoleVariables\([^\r\n]*\) \{[\s\S]*?^\}/gm, "UnregisterConsoleVariables");
	const strPluginLoad = ExtractDefinition(/^bool CSourceJSPlugin::Load\([^\r\n]*\) \{[\s\S]*?^\}/gm, "plugin Load");
	const strPluginUnload = ExtractDefinition(/^void CSourceJSPlugin::Unload\(\) \{[\s\S]*?^\}/gm, "plugin Unload");
	const strRegisterCommands = ExtractDefinition(/^bool CSourceJSPlugin::RegisterConsoleCommands\([^\r\n]*\) \{[\s\S]*?^\}/gm, "RegisterConsoleCommands");
	const strUnregisterCommands = ExtractDefinition(/^void CSourceJSPlugin::UnregisterConsoleCommands\(\) \{[\s\S]*?^\}/gm, "UnregisterConsoleCommands");
	const vecLifecycleHeader = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTSOURCEJSPLUGINLIFECYCLEMETHODS_H_",
		"#define _SOURCEJSTESTSOURCEJSPLUGINLIFECYCLEMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding fixture doubles are required.",
		"namespace {",
		"",
		strNoCommandClientSlot,
		"",
		strCallbackBoundary,
		"} // namespace",
		"",
		strPluginConstructor,
		"",
		strRegisterVariables,
		"",
		strUnregisterVariables,
		"",
		strPluginLoad,
		"",
		strPluginUnload,
		"",
		strRegisterCommands,
		"",
		strUnregisterCommands,
		"",
		"#endif // _SOURCEJSTESTSOURCEJSPLUGINLIFECYCLEMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "SourceJSPluginLifecycleMethods.h"), vecLifecycleHeader.join("\n") + "\n");

	const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/V8Runtime.cpp"), "utf8");
	const vecInitializeMatches = [...strRuntimeSource.matchAll(/^\tbool V8Runtime::Initialize\([^\r\n]*\) \{[\s\S]*?^\t\}/gm)];
	g_Assert.equal(vecInitializeMatches.length, 1, "Expected exactly one V8Runtime Initialize definition");

	const vecV8AttemptStateMatches = [...strRuntimeSource.matchAll(/^\t\tconstinit bool g_bV8InitializationAttempted = false;/gm)];
	g_Assert.equal(vecV8AttemptStateMatches.length, 1, "Expected exactly one process-global V8 initialization guard");

	const vecDestructorMatches = [...strRuntimeSource.matchAll(/^\tV8Runtime::~V8Runtime\(\) \{[\s\S]*?^\t\}/gm)];
	g_Assert.equal(vecDestructorMatches.length, 1, "Expected exactly one V8Runtime destructor");

	const vecInitializationHeader = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8INITIALIZATIONMETHODS_H_",
		"#define _SOURCEJSTESTV8INITIALIZATIONMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding V8 API doubles are required.",
		"namespace SourceJS {",
		"",
		vecV8AttemptStateMatches[0][0].replace(/^\t/, ""),
		"",
		vecInitializeMatches[0][0],
		"",
		vecDestructorMatches[0][0],
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8INITIALIZATIONMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8InitializationMethods.h"), vecInitializationHeader.join("\n") + "\n");

	// Move private definitions one namespace level outward by indentation only, not token rewrites.
	const ExtractRuntimeDefinition = (Expression, strRole) => {
		const vecMatches = [...strRuntimeSource.matchAll(Expression)];
		g_Assert.equal(vecMatches.length, 1, "Expected exactly one runtime " + strRole + " definition");

		return vecMatches[0][0].replace(/^\t/gm, "");
	};

	const vecCommandMatches = [...strRuntimeSource.matchAll(/^\t\tvoid DispatchSourceJSRuntimeCommand\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm)];
	g_Assert.equal(vecCommandMatches.length, 2, "Expected modern and legacy runtime command callbacks");

	const vecRuntimeCallbackHeader = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8RUNTIMECALLBACKMETHODS_H_",
		"#define _SOURCEJSTESTV8RUNTIMECALLBACKMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding V8/SDK doubles are required.",
		"namespace SourceJS {",
		"",
		ExtractRuntimeDefinition(/^\t\ttemplate <typename TCallback>\r?\n\t\tvoid InvokeRuntimeCommand\([^\r\n]*\) noexcept \{[\s\S]*?^\t\t\}/gm, "command exception barrier"),
		"",
		ExtractRuntimeDefinition(/^\t\tvoid DispatchSourceJSRuntimeCommandArguments\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "command routing"),
		"",
		"#ifdef SOURCEJS_OLD_CONSOLE_API",
		vecCommandMatches[0][0].replace(/^\t/gm, ""),
		"#else",
		vecCommandMatches[1][0].replace(/^\t/gm, ""),
		"#endif",
		"",
		ExtractRuntimeDefinition(/^\t\tvoid RequirePluginModuleCallback\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "plugin require exception barrier"),
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8RUNTIMECALLBACKMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8RuntimeCallbackMethods.h"), vecRuntimeCallbackHeader.join("\n") + "\n");

	const vecExportMatches = [...strRuntimeSource.matchAll(/^\tbool V8Runtime::CallExportFunction\([^\r\n]*\) \{[\s\S]*?^\t\}/gm)];
	g_Assert.equal(vecExportMatches.length, 1, "Expected exactly one runtime lifecycle export definition");

	const vecExportHeader = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8RUNTIMEEXPORTMETHODS_H_",
		"#define _SOURCEJSTESTV8RUNTIMEEXPORTMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding V8 API doubles are required.",
		"namespace SourceJS {",
		"",
		vecExportMatches[0][0],
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8RUNTIMEEXPORTMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8RuntimeExportMethods.h"), vecExportHeader.join("\n") + "\n");

	const strRuntimeHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/V8Runtime.h"), "utf8");
	const vecCallbackRecordMatches = [...strRuntimeHeader.matchAll(/^\tstruct ScriptCallbackRecord \{[\s\S]*?^\t\};/gm)];
	const vecSnapshotRecordMatches = [...strRuntimeSource.matchAll(/^\t\tstruct ScriptCallbackSnapshotRecord \{[\s\S]*?^\t\t\};/gm)];
	g_Assert.equal(vecCallbackRecordMatches.length, 1, "Expected exactly one stored callback record");
	g_Assert.equal(vecSnapshotRecordMatches.length, 1, "Expected exactly one local callback snapshot record");

	const vecEventStateRecords = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8EVENTSTATERECORDS_H_",
		"#define _SOURCEJSTESTV8EVENTSTATERECORDS_H_",
		"",
		"// Generated included-only fragment; preceding V8 API doubles are required.",
		"namespace SourceJS {",
		"",
		vecCallbackRecordMatches[0][0],
		"",
		vecSnapshotRecordMatches[0][0].replace(/^\t/gm, ""),
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8EVENTSTATERECORDS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8EventStateRecords.h"), vecEventStateRecords.join("\n") + "\n");

	const vecRegistrationMatches = [...strRuntimeSource.matchAll(/^\tbool V8Runtime::AddGameEventCallback\([^\r\n]*\) \{[\s\S]*?^\t\}/gm)];
	g_Assert.equal(vecRegistrationMatches.length, 1, "Expected exactly one game-event registration definition");

	const vecEventStateMethods = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8EVENTSTATEMETHODS_H_",
		"#define _SOURCEJSTESTV8EVENTSTATEMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding V8/SDK doubles and records are required.",
		"namespace SourceJS {",
		"",
		ExtractRuntimeDefinition(/^\t\tstd::vector<ScriptCallbackSnapshotRecord> SnapshotStoredFunctions\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "callback snapshot"),
		"",
		ExtractRuntimeDefinition(/^\t\tbool DoesStoredFunctionBelongToContext\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "stored callback context"),
		"",
		ExtractRuntimeDefinition(/^\t\tvoid ResetStoredFunction\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "stored callback reset"),
		"",
		ExtractRuntimeDefinition(/^\t\tbool AddStoredFunction\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "stored callback registration"),
		"",
		ExtractRuntimeDefinition(/^\t\tbool RemoveStoredFunction\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "stored callback removal"),
		"",
		vecRegistrationMatches[0][0],
		"",
		...["RemoveGameEventCallback", "RebuildGameEventListeners"].map((strMethod) => {
			const vecMatches = [...strRuntimeSource.matchAll(new RegExp(String.raw`^\tbool V8Runtime::${strMethod}\([^\r\n]*\) \{[\s\S]*?^\t\}`, "gm"))];
			g_Assert.equal(vecMatches.length, 1, "Expected exactly one " + strMethod + " definition");

			return vecMatches[0][0] + "\n";
		}),
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8EVENTSTATEMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8EventStateMethods.h"), vecEventStateMethods.join("\n") + "\n");

	const vecCommandStateMethods = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8COMMANDSTATEMETHODS_H_",
		"#define _SOURCEJSTESTV8COMMANDSTATEMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding V8/SDK doubles and records are required.",
		"namespace SourceJS {",
		"",
		ExtractRuntimeDefinition(/^\t\tstd::vector<ScriptCallbackSnapshotRecord> SnapshotStoredFunctions\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "command callback snapshot"),
		"",
		...[
			"RegisterCommand",
			"UnregisterCommand",
			"DispatchCommand",
			"RegisterClientCommand",
			"UnregisterClientCommand",
			"HasClientCommand",
			"OwnsRegisteredCommand",
			"AddClientCommandFilter",
			"RemoveClientCommandFilter",
			"DispatchClientCommand",
			"RegisterSayCommand",
			"UnregisterSayCommand",
			"AddSayCommandFilter",
			"RemoveSayCommandFilter",
			"DispatchSayCommand",
			"FindPluginRuntimeRecord",
			"ExecutePluginFile",
			"UnloadPlugin",
			"GetSourceJSObject",
			"GetContext",
			"GetCurrentPluginName",
		].map((strMethod) => {
			const vecMatches = [...strRuntimeSource.matchAll(new RegExp(String.raw`^\t(?:bool|void|PluginRuntimeRecord const\*|v8::Local<v8::(?:Context|Object)>) V8Runtime::${strMethod}\([^\r\n]*\) (?:const )?(?:noexcept )?\{[\s\S]*?^\t\}`, "gm"))];
			g_Assert.equal(vecMatches.length, 1, "Expected exactly one " + strMethod + " definition");

			return vecMatches[0][0] + "\n";
		}),
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8COMMANDSTATEMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8CommandStateMethods.h"), vecCommandStateMethods.join("\n") + "\n");

	const vecEventArgumentMethods = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8GAMEEVENTARGUMENTMETHODS_H_",
		"#define _SOURCEJSTESTV8GAMEEVENTARGUMENTMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding V8 doubles are required.",
		"namespace SourceJS {",
		"",
		ExtractRuntimeDefinition(/^\t\tbool MakeRuntimeString\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "runtime string conversion"),
		"",
		ExtractRuntimeDefinition(/^\t\tvoid ThrowRuntimeError\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm, "runtime error reporting"),
		"",
		ExtractRuntimeDefinition(/^\t\tvoid ThrowRuntimeCallbackException\([^\r\n]*\) noexcept \{[\s\S]*?^\t\t\}/gm, "non-throwing callback exception reporting"),
		"",
		...["Key", "String"].map((strCategory) => ExtractRuntimeDefinition(new RegExp(String.raw`^\t\tbool RequireGameEvent${strCategory}Argument\([^\r\n]*\) \{[\s\S]*?^\t\t\}`, "gm"), "game-event " + strCategory + " argument") + "\n"),
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8GAMEEVENTARGUMENTMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8GameEventArgumentMethods.h"), vecEventArgumentMethods.join("\n") + "\n");

	const strApplicationSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/Application.cpp"), "utf8");
	const strEngineSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/EngineInterfaces.cpp"), "utf8");
	const vecUnloadMatches = [...strApplicationSource.matchAll(/^\tvoid Application::Unload\(\) \{[\s\S]*?^\t\}/gm)];
	const vecDisconnectMatches = [...strEngineSource.matchAll(/^\tvoid EngineInterfaces::Disconnect\(\) noexcept \{[\s\S]*?^\t\}/gm)];
	g_Assert.equal(vecUnloadMatches.length, 1, "Expected exactly one Application Unload definition");
	g_Assert.equal(vecDisconnectMatches.length, 1, "Expected exactly one EngineInterfaces Disconnect definition");

	const vecRollbackHeader = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTAPPLICATIONROLLBACKMETHODS_H_",
		"#define _SOURCEJSTESTAPPLICATIONROLLBACKMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding subsystem doubles are required.",
		"namespace SourceJS {",
		"",
		vecDisconnectMatches[0][0],
		"",
		vecUnloadMatches[0][0],
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTAPPLICATIONROLLBACKMETHODS_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "ApplicationRollbackMethods.h"), vecRollbackHeader.join("\n") + "\n");

	const vecAsyncRecordDeclarations = ["AsyncRequestResult", "AsyncRequestRecord", "AsyncRequestCallbackRecord"].map((strName) => {
		const vecMatches = [...strRuntimeHeader.matchAll(new RegExp(String.raw`^\tstruct ${strName} \{[\s\S]*?^\t\};`, "gm"))];
		g_Assert.equal(vecMatches.length, 1, "Expected exactly one async record: " + strName);

		return vecMatches[0][0] + "\n";
	});

	const vecAsyncLimitMatches = [...strRuntimeSource.matchAll(/^\t\tconstexpr std::size_t kMaximumConcurrentAsyncRequests = [^\r\n]*;/gm)];
	g_Assert.equal(vecAsyncLimitMatches.length, 1, "Expected exactly one async request limit");

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8AsyncRequestRecords.h"), [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8ASYNCREQUESTRECORDS_H_",
		"#define _SOURCEJSTESTV8ASYNCREQUESTRECORDS_H_",
		"",
		"// Generated included-only fragment; preceding V8 doubles are required.",
		"namespace SourceJS {",
		"",
		...vecAsyncRecordDeclarations,
		ExtractRuntimeDefinition(/^\tAsyncRequestRecord::AsyncRequestRecord\(\) \{[\s\S]*?^\t\}/gm, "async request initialization"),
		"",
		vecAsyncLimitMatches[0][0].replace(/^\t/, ""),
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8ASYNCREQUESTRECORDS_H_",
	].join("\n") + "\n");

	const vecAsyncRequestDefinitions = [
		"QueueAsyncRequest",
		"QueueAsyncTask",
		"RunRequestOnDedicatedThread",
		"ConsumeAsyncRequestResult",
		"RunBlockingAsyncRequest",
		"RetireAsyncRequest",
		"ReapAsyncRequests",
		"RunBlockingRequest",
		"QueueAsyncRequestRecord",
		"DeliverAsyncRequest",
		"WaitForAsyncRequest",
		"ProcessAsyncRequests",
		"RunAsyncRequest",
		"StopAsyncRequests",
		"RemoveAsyncRequestsForContext",
	].map((strName) => {
		const vecMatches = [...strRuntimeSource.matchAll(new RegExp(String.raw`^\t(?:bool|void) V8Runtime::${strName}\([^\r\n]*\) \{[\s\S]*?^\t\}`, "gm"))];
		g_Assert.equal(vecMatches.length, 1, "Expected exactly one async method: " + strName);

		return vecMatches[0][0] + "\n";
	});

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8AsyncRequestMethods.h"), [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8ASYNCREQUESTMETHODS_H_",
		"#define _SOURCEJSTESTV8ASYNCREQUESTMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding runtime/V8 doubles are required.",
		"namespace SourceJS {",
		"",
		ExtractRuntimeDefinition(/^\tPluginRuntimeRecord\* V8Runtime::FindPluginRuntimeRecord\([^\r\n]*\) noexcept \{[\s\S]*?^\t\}/gm, "async request context membership"),
		"",
		ExtractRuntimeDefinition(/^\tV8Runtime::AsyncRequestCompletionScope::AsyncRequestCompletionScope\([^\r\n]*\) :[\s\S]*?^\t\}/gm, "async completion owner construction"),
		"",
		ExtractRuntimeDefinition(/^\tV8Runtime::AsyncRequestCompletionScope::~AsyncRequestCompletionScope\(\) \{[\s\S]*?^\t\}/gm, "async completion owner destruction"),
		"",
		...vecAsyncRequestDefinitions,
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8ASYNCREQUESTMETHODS_H_",
	].join("\n") + "\n");

	const vecReadFileMatches = [...strRuntimeSource.matchAll(/^\tbool V8Runtime::ReadFile\([^\r\n]*\) \{[\s\S]*?^\t\}/gm)];
	g_Assert.equal(vecReadFileMatches.length, 1, "Expected exactly one runtime ReadFile method");

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "V8RuntimeReadFileMethods.h"), [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTV8RUNTIMEREADFILEMETHODS_H_",
		"#define _SOURCEJSTESTV8RUNTIMEREADFILEMETHODS_H_",
		"",
		"// Generated included-only fragment; preceding runtime declaration is required.",
		"namespace SourceJS {",
		"",
		vecReadFileMatches[0][0],
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSTESTV8RUNTIMEREADFILEMETHODS_H_",
	].join("\n") + "\n");

	const strModuleBindings = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8");
	const vecSoundDefinitions = [...strModuleBindings.matchAll(/^\t\ttemplate <typename TEngineSound, typename TRecipientFilter>\r?\n\t\tbool TryEmitEngineSound\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm)];
	g_Assert.equal(vecSoundDefinitions.length, 1, "Expected exactly one engine sound emission helper");

	const vecSoundFragment = [
		"// Generated included-only fragment; requires the sound fixture's SDK doubles.",
		"",
		vecSoundDefinitions[0][0],
		"",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "EngineSoundEmitMethod.inc"), vecSoundFragment.join("\n"));

	const vecConfiguration = [
		"cmake_minimum_required(VERSION 3.20)",
		"project(NativePluginManager LANGUAGES CXX)",
		"set(CMAKE_CXX_STANDARD 20)",
		"set(CMAKE_CXX_STANDARD_REQUIRED ON)",
		"set(CMAKE_CXX_EXTENSIONS OFF)",
		"find_package(Threads REQUIRED)",
		"if(NOT CMAKE_SIZEOF_VOID_P EQUAL SOURCEJS_TEST_ADDRESS_SIZE)",
		'\tmessage(FATAL_ERROR "Requested test bitness was not selected")',
		"endif()",
		'add_executable(Contracts "' + g_strRoot + '/tools/fixtures/PluginManagerContracts.cpp" "' + g_strRoot + '/src/sourcejs/PluginManager.cpp" "' + g_strRoot + '/src/sourcejs/ListenerPayload.cpp")',
		'target_include_directories(Contracts PRIVATE "' + g_strRoot + '/tools/fixtures/plugin_manager" "' + g_strRoot + '/src")',
		'add_executable(PathsContracts "' + g_strRoot + '/tools/fixtures/RuntimePathsContracts.cpp" "' + g_strRoot + '/src/sourcejs/RuntimePaths.cpp")',
		'target_include_directories(PathsContracts PRIVATE "' + g_strRoot + '/src")',
		'add_executable(ListenClientContracts "' + g_strRoot + '/tools/fixtures/SourceJSListenClientContracts.cpp")',
		'target_include_directories(ListenClientContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(EngineSoundEmitContracts "' + g_strRoot + '/tools/fixtures/EngineSoundEmitContracts.cpp")',
		'target_include_directories(EngineSoundEmitContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(LifecycleContracts "' + g_strRoot + '/tools/fixtures/SourceJSPluginLifecycleContracts.cpp")',
		'target_include_directories(LifecycleContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(LifecycleLegacyContracts "' + g_strRoot + '/tools/fixtures/SourceJSPluginLifecycleContracts.cpp")',
		'target_include_directories(LifecycleLegacyContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		"target_compile_definitions(LifecycleLegacyContracts PRIVATE SOURCEJS_OLD_CONSOLE_API)",
		'add_executable(V8InitializationContracts "' + g_strRoot + '/tools/fixtures/V8InitializationContracts.cpp")',
		'target_include_directories(V8InitializationContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		"target_link_libraries(V8InitializationContracts PRIVATE Threads::Threads)",
		'add_executable(ApplicationRollbackContracts "' + g_strRoot + '/tools/fixtures/ApplicationRollbackContracts.cpp")',
		'target_include_directories(ApplicationRollbackContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(RuntimeCallbackContracts "' + g_strRoot + '/tools/fixtures/V8RuntimeCallbackContracts.cpp")',
		'target_include_directories(RuntimeCallbackContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(RuntimeCallbackLegacyContracts "' + g_strRoot + '/tools/fixtures/V8RuntimeCallbackContracts.cpp")',
		'target_include_directories(RuntimeCallbackLegacyContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		"target_compile_definitions(RuntimeCallbackLegacyContracts PRIVATE SOURCEJS_OLD_CONSOLE_API)",
		'add_executable(RuntimeExportContracts "' + g_strRoot + '/tools/fixtures/V8RuntimeExportContracts.cpp")',
		'target_include_directories(RuntimeExportContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(EventStateContracts "' + g_strRoot + '/tools/fixtures/V8EventStateContracts.cpp")',
		'target_include_directories(EventStateContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(GameEventArgumentContracts "' + g_strRoot + '/tools/fixtures/V8GameEventArgumentContracts.cpp")',
		'target_include_directories(GameEventArgumentContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(CommandStateContracts "' + g_strRoot + '/tools/fixtures/V8CommandStateContracts.cpp")',
		'target_include_directories(CommandStateContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		'add_executable(AsyncRequestContracts "' + g_strRoot + '/tools/fixtures/V8AsyncRequestContracts.cpp")',
		'target_include_directories(AsyncRequestContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		"target_link_libraries(AsyncRequestContracts PRIVATE Threads::Threads)",
		'add_executable(RuntimeReadFileContracts "' + g_strRoot + '/tools/fixtures/V8RuntimeReadFileContracts.cpp")',
		'target_include_directories(RuntimeReadFileContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		"foreach(TestTarget IN ITEMS Contracts PathsContracts ListenClientContracts EngineSoundEmitContracts LifecycleContracts LifecycleLegacyContracts V8InitializationContracts ApplicationRollbackContracts RuntimeCallbackContracts RuntimeCallbackLegacyContracts RuntimeExportContracts EventStateContracts GameEventArgumentContracts CommandStateContracts AsyncRequestContracts RuntimeReadFileContracts)",
		"\tif(MSVC)",
		"\t\ttarget_compile_options(${TestTarget} PRIVATE /W4 /WX /EHsc /permissive-)",
		"\telseif(CMAKE_CXX_COMPILER_ID MATCHES \"GNU|Clang\")",
		"\t\ttarget_compile_options(${TestTarget} PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"\telse()",
		'\t\tmessage(FATAL_ERROR "Unsupported fixture compiler")',
		"\tendif()",
		"endforeach()",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), vecConfiguration.join("\n") + "\n");

	for (const Profile of g_vecProfiles) {
		const strBuildDirectory = g_Path.join(g_strDirectory, Profile.Name);
		const strFilesDirectory = g_Path.join(g_strDirectory, "Files-" + Profile.Name);
		g_FileSystem.mkdirSync(strFilesDirectory);

		Run("cmake", ["-S", g_strDirectory, "-B", strBuildDirectory, "-DSOURCEJS_TEST_ADDRESS_SIZE=" + Profile.AddressSize, ...Profile.Arguments]);
		Run("cmake", ["--build", strBuildDirectory, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "Contracts.exe") : g_Path.join(strBuildDirectory, "Contracts");
		const Result = Run(strProgram, [strFilesDirectory]);
		g_Assert.match(Result.stdout, /Plugin manager contracts passed/);
		console.log(Profile.Name + ": actual PluginManager contracts passed (runtime/path/log doubles; no V8/server).");

		const strPathsProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "PathsContracts.exe") : g_Path.join(strBuildDirectory, "PathsContracts");
		const PathsResult = Run(strPathsProgram, []);
		g_Assert.match(PathsResult.stdout, /RuntimePaths contracts passed/);
		console.log(Profile.Name + ": actual RuntimePaths contracts passed (no path doubles).");

		const strListenClientProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "ListenClientContracts.exe") : g_Path.join(strBuildDirectory, "ListenClientContracts");
		const ListenClientResult = Run(strListenClientProgram, []);
		g_Assert.match(ListenClientResult.stdout, /SourceJS listen-client and callback-boundary contracts passed/);
		console.log(Profile.Name + ": extracted SourceJSPlugin listen-client and callback-boundary contracts passed (doubles; no SDK/server).");

		const strSoundProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "EngineSoundEmitContracts.exe") : g_Path.join(strBuildDirectory, "EngineSoundEmitContracts");
		const SoundResult = Run(strSoundProgram, []);
		g_Assert.match(SoundResult.stdout, /Engine sound emission contracts passed/);
		console.log(Profile.Name + ": extracted sound emission contracts passed (four SDK signature doubles; not live audio).");

		for (const strTarget of ["LifecycleContracts", "LifecycleLegacyContracts"]) {
			const strLifecycleProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", strTarget + ".exe") : g_Path.join(strBuildDirectory, strTarget);
			const LifecycleResult = Run(strLifecycleProgram, []);
			g_Assert.match(LifecycleResult.stdout, /SourceJS plugin lifecycle contracts passed/);
			console.log(Profile.Name + ": " + strTarget + " passed (extracted methods; SDK/application doubles).");
		}

		const strInitializationProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "V8InitializationContracts.exe") : g_Path.join(strBuildDirectory, "V8InitializationContracts");
		const InitializationResult = Run(strInitializationProgram, []);
		g_Assert.match(InitializationResult.stdout, /V8 initialization contracts passed/);
		console.log(Profile.Name + ": extracted V8 initialization contracts passed (V8 API doubles; not a real V8 lifecycle test).");

		for (const strScenario of ["--destructor-standard", "--destructor-unknown", "--rollback-dispose-failure"]) {
			RunExpectedTermination(strInitializationProgram, strScenario);
		}

		console.log(Profile.Name + ": destructor/rollback fail-fast contracts passed (controlled child exit; V8 and Shutdown doubles).");

		const strRollbackProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "ApplicationRollbackContracts.exe") : g_Path.join(strBuildDirectory, "ApplicationRollbackContracts");
		const RollbackResult = Run(strRollbackProgram, []);
		g_Assert.match(RollbackResult.stdout, /Application rollback contracts passed/);
		console.log(Profile.Name + ": extracted Application/EngineInterfaces rollback contracts passed (subsystem doubles; no SDK/server).");

		for (const strTarget of ["RuntimeCallbackContracts", "RuntimeCallbackLegacyContracts"]) {
			const strCallbackProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", strTarget + ".exe") : g_Path.join(strBuildDirectory, strTarget);
			const CallbackResult = Run(strCallbackProgram, []);
			g_Assert.match(CallbackResult.stdout, /V8 runtime callback contracts passed/);
			console.log(Profile.Name + ": " + strTarget + " passed (extracted barriers/routing; V8 and SDK doubles, not live execution).");
		}

		const strExportProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "RuntimeExportContracts.exe") : g_Path.join(strBuildDirectory, "RuntimeExportContracts");
		const ExportResult = Run(strExportProgram, []);
		g_Assert.match(ExportResult.stdout, /V8 lifecycle export contracts passed/);
		console.log(Profile.Name + ": extracted lifecycle export contracts passed (V8 API doubles; not live JavaScript execution).");

		const strEventStateProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "EventStateContracts.exe") : g_Path.join(strBuildDirectory, "EventStateContracts");
		const EventStateResult = Run(strEventStateProgram, []);
		g_Assert.match(EventStateResult.stdout, /V8 event-state contracts passed/);
		console.log(Profile.Name + ": extracted callback snapshot and game-event registration contracts passed (V8/SDK doubles; not live dispatch or GC).");

		const strEventArgumentProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "GameEventArgumentContracts.exe") : g_Path.join(strBuildDirectory, "GameEventArgumentContracts");
		const EventArgumentResult = Run(strEventArgumentProgram, []);
		g_Assert.match(EventArgumentResult.stdout, /V8 game-event argument contracts passed/);
		console.log(Profile.Name + ": extracted game-event argument/error helper contracts passed (V8 doubles; not live encoding, GC or SDK dispatch).");

		const strCommandStateProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "CommandStateContracts.exe") : g_Path.join(strBuildDirectory, "CommandStateContracts");
		const CommandStateResult = Run(strCommandStateProgram, []);
		g_Assert.match(CommandStateResult.stdout, /V8 command-state contracts passed/);
		console.log(Profile.Name + ": extracted command registration/rollback, dispatch-phase snapshot, plugin startup/exception rollback, unload reentry and runtime getter contracts passed (V8/SDK and plugin IO/execution doubles; not live dispatch, GC or plugin execution).");

		const strAsyncRequestProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "AsyncRequestContracts.exe") : g_Path.join(strBuildDirectory, "AsyncRequestContracts");
		const AsyncRequestResult = Run(strAsyncRequestProgram, []);
		g_Assert.match(AsyncRequestResult.stdout, /V8 async request contracts passed/);
		console.log(Profile.Name + ": extracted async request contracts passed (real dedicated threads/queues; V8/logging doubles, no network IO).");

		const strReadFileProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "RuntimeReadFileContracts.exe") : g_Path.join(strBuildDirectory, "RuntimeReadFileContracts");
		const ReadFileResult = Run(strReadFileProgram, [strFilesDirectory]);
		g_Assert.match(ReadFileResult.stdout, /V8 runtime read-file contracts passed/);

		for (const vecInvalidArguments of [[], [strFilesDirectory, "UnexpectedArgument"]]) {
			const InvalidReadFileResult = Run(strReadFileProgram, vecInvalidArguments, 2);
			g_Assert.match(InvalidReadFileResult.stdout + InvalidReadFileResult.stderr, /^Usage: V8RuntimeReadFileContracts /m);
			g_Assert.doesNotMatch(InvalidReadFileResult.stdout + InvalidReadFileResult.stderr, /V8 runtime read-file contracts passed/);
		}

		console.log(Profile.Name + ": extracted runtime ReadFile contracts passed (real filesystem; binary/empty/failing reads and output preservation).");
	}
} finally {
	const DirectoryStatus = g_FileSystem.lstatSync(g_strDirectory);
	g_Assert(DirectoryStatus.isDirectory() && !DirectoryStatus.isSymbolicLink(), "Unsafe fixture cleanup target");

	const strRealDirectory = g_FileSystem.realpathSync(g_strDirectory);
	g_Assert.equal(strRealDirectory, g_strDirectory, "Fixture cleanup target changed");

	const strRelativeDirectory = g_Path.relative(g_strBuildRoot, strRealDirectory);
	g_Assert(strRelativeDirectory && !g_Path.isAbsolute(strRelativeDirectory) && !strRelativeDirectory.startsWith("..") && !strRelativeDirectory.includes(g_Path.sep) && g_Path.basename(strRealDirectory).startsWith("NativePluginManager-"), "Unsafe fixture cleanup target");
	g_FileSystem.rmSync(strRealDirectory, { recursive: true, force: true });
}
