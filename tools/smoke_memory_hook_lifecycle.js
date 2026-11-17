#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length !== 0) {
	const bHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	console.log("Usage: node tools/smoke_memory_hook_lifecycle.js [--help]");
	process.exit(bHelp ? 0 : 2);
}

g_Assert(["win32", "linux"].includes(process.platform), "Native lifecycle tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native lifecycle tests require x86/x64 compiler profiles.");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_unCommandTimeoutMilliseconds = 600_000;
const g_unFixtureTimeoutMilliseconds = 60_000;
const g_unFixtureCleanupRetries = 3;
const g_unFixtureCleanupRetryDelayMilliseconds = 100;
const g_unHookObjectPropertyFailurePathCount = 9;
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/MemoryHookManager.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/MemoryHookManager.h"), "utf8").replace(/\r\n/g, "\n");
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

const g_vecMethods = [
	"MemoryHookSignature::MemoryHookSignature()",
	"MemoryHookManager::MemoryHookManager()",
	"MemoryHookManager::~MemoryHookManager()",
	"MemoryHookManager::Shutdown()",
	"MemoryHookManager::CreateFunction(",
	"MemoryHookManager::CopyCallbacks(",
	"MemoryHookManager::AddCallback(",
	"MemoryHookManager::RemoveCallback(",
	"MemoryHookManager::Remove(",
	"MemoryHookManager::RemoveContext(",
	"MemoryHookManager::RemoveAll()",
	"MemoryHookManager::HandlePostHook(",
	"MemoryHookManager::FindRecord(const int",
	"MemoryHookManager::FindRecord(void const*",
	"MemoryHookManager::HasCallbacks(",
	"MemoryHookManager::CaptureArguments(",
	"MemoryHookManager::ResetCallbacks(",
];

// These are wiring guards, not execution of the complete V8 dispatchers.
const g_vecWiringContracts = [
	["MemoryHookManager::HandleHook(", "LogError(\"Memory hook callbacks failed Hook=%d\", nHookID);\n\t\t\treturn bSkipOriginal;"],
	["MemoryHookManager::HandleHook(", "CallContextScope.Invalidate();\n\t\t\t\tbSkipOriginal = bSkipOriginal || CallContext.m_bSkipOriginal;"],
	["MemoryHookManager::HandleHook(", "std::shared_ptr<MemoryHookRecord> const pHookRecord = FindRecord(nHookID);"],
	["MemoryHookManager::HandleHook(", "const vecPreCallbacks = CopyCallbacks(nHookID, HOOKTYPE_PRE, pIsolate);"],
	["MemoryHookManager::HandleHook(", "const vecPostCallbacks = CopyCallbacks(nHookID, HOOKTYPE_POST, pIsolate);"],
	["MemoryHookManager::RunPostCallbacks(", "const vecPostCallbacks = CopyCallbacks(PostFrame.m_nHookID, HOOKTYPE_POST, pIsolate);"],
	["MemoryHookManager::CreateFunction(", "std::shared_ptr<MemoryHookRecord> const pHookRecord = std::make_shared<MemoryHookRecord>();"],
	["MemoryHookManager::CreateFunction(", "std::unique_ptr<void, decltype(ThunkDeleter)> pThunkOwner ="],
	["MemoryHookManager::CreateVTable(", "return CreateFunction(pIsolate, LocalContext, LocalOptions, pbRecordCreatedOut);"],
	["MemoryHookManager::MakeHookObject(", "\"Created\", v8::Boolean::New(pIsolate, *pbRecordCreated)"],
	["MemoryHookManager::MakeHookObject(", "if (pbRecordCreated && *pbRecordCreated && !Remove(nHookID))"],
	["MemoryHookManager::MakeHookObject(", "SetOwnFunction(pIsolate, LocalContext, LocalObject, \"Pre\", AddHookObjectPreCallback, LocalData)"],
	["MemoryHookManager::MakeHookObject(", "return FailHookObjectCreation();"],
	["bool SetOwnValue(", "return LocalObject->CreateDataProperty(LocalContext, LocalPropertyName, LocalValue).FromMaybe(false);", "\t\t"],
];

// Each mutation is compiled and must be rejected by a native assertion.
const g_vecMutations = [
	{ Name: "CreationOutputReset", Old: "*pbRecordCreatedOut = false;", New: "*pbRecordCreatedOut = true;" },
	{ Name: "CreationOutputCommit", Old: "*pbRecordCreatedOut = true;", New: "*pbRecordCreatedOut = false;" },
	{ Name: "DispatchFallbackState", Old: "return bSkipOriginal;", New: "return false;" },
	{ Name: "DispatchPrematureSkip", Old: "bool bSkipOriginal = false;", New: "bool bSkipOriginal = true;" },
	{ Name: "DispatchEarlyCommit", Old: "bSkipOriginal = bSkipOriginal || CallContext.m_bSkipOriginal;", New: "bSkipOriginal = false;" },
	{ Name: "DispatchReturnCommit", Old: "// Commit callback return override.\n\t\t\tbSkipOriginal = bSkipOriginal || CallContext.m_bSkipOriginal;", New: "// Commit callback return override.\n\t\t\tbSkipOriginal = false;" },
	{ Name: "ReentrantRecordLookup", Old: "std::shared_ptr<MemoryHookRecord> const pReentrantRecord = FindRecord(pAddress);", New: "std::shared_ptr<MemoryHookRecord> const pReentrantRecord {};" },
	{ Name: "ReentrantHookIdentifier", Old: "const int nHookID = m_nNextHookID;", New: "const int nHookID = m_nNextHookID - 1;" },
	{ Name: "SignatureShutdown", Old: "if (!m_bInitialized || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {", New: "if (false) {" },
	{ Name: "OwnerlessRegistration", Old: "if (LocalContext.IsEmpty()) {", New: "if (false) {" },
	{ Name: "PendingFrameTeardown", Old: "if (!m_mapPostFrames.empty()) {", New: "if (false) {" },
	{ Name: "ReleaseFailure", Old: "if (!HookRecord.m_pHook->Release()) {", New: "if (HookRecord.m_pHook->Release()) {" },
	{ Name: "CallbackSnapshot", Old: "vecCallbacks.push_back(std::move(CallbackCopy));", New: "vecCallbacks.clear();" },
	{ Name: "IncompleteCallback", Old: "if (CallbackRecord.m_Context.IsEmpty() || CallbackRecord.m_Function.IsEmpty()) {", New: "if (false) {" },
	{ Name: "ActivePostFrame", Old: "// Keep the slot registered during callbacks so Shutdown cannot free this thunk.", New: "m_mapPostFrames.erase(pReturnSlot);" },
	{ Name: "SavedReturn", Old: "return PostFrame.m_pReturnAddress;", New: "return nullptr;" },
	{ Name: "CaptureFailureOutput", Old: "if (!pRawContext || (unArgumentCount > kMaximumArgumentCount)) {\n\t\t\treturn;", New: "if (!pRawContext || (unArgumentCount > kMaximumArgumentCount)) {\n\t\t\tvecArgumentsOut.clear();\n\t\t\treturn;" },
	{ Name: "CaptureOutputCommit", Old: "vecArgumentsOut = std::move(vecArguments);", New: "vecArgumentsOut.clear();" },
];

function GetDefinition(strSignature, strIndentation = "\t", strSource = g_strSource) {
	const nSignatureIndex = strSource.indexOf(strSignature);
	g_Assert(nSignatureIndex >= 0, "Missing production definition: " + strSignature);

	const nStartIndex = strSource.lastIndexOf("\n", nSignatureIndex) + 1;
	const nEndIndex = strSource.indexOf("\n" + strIndentation + "}", nSignatureIndex);
	g_Assert(nEndIndex > nStartIndex, "Missing production definition end: " + strSignature);

	return strSource.slice(nStartIndex, nEndIndex + strIndentation.length + 2);
}

function MakeDispatchFailurePolicy(strSource) {
	const strDispatch = GetDefinition("MemoryHookManager::HandleHook(", "\t", strSource);
	const strCommit = "bSkipOriginal = bSkipOriginal || CallContext.m_bSkipOriginal;";
	const nTry = strDispatch.indexOf("\t\ttry {\n");
	const nCatch = strDispatch.indexOf("\n\t\t} catch (...) {\n");
	const nCatchEnd = strDispatch.lastIndexOf("\n\t\t}");
	const nPreSnapshot = strDispatch.indexOf("const vecPreCallbacks = CopyCallbacks(");
	const nPostSnapshot = strDispatch.indexOf("const vecPostCallbacks = CopyCallbacks(");
	const nCallbackEnd = strDispatch.indexOf("CallContextScope.Invalidate();");
	const nEarlyCommit = strDispatch.indexOf(strCommit);
	const nReplay = strDispatch.indexOf("LocalHookArguments->Get(");
	const nReturnWrite = strDispatch.indexOf("SetReturnFromValue(", nReplay);
	const nLateCommit = strDispatch.lastIndexOf(strCommit);
	g_Assert((nTry >= 0) && (nPreSnapshot > nTry) && (nPostSnapshot > nPreSnapshot) && (nCatch > nPostSnapshot) && (nCatchEnd > nCatch), "dispatch allocation failures stay inside the preserving catch");
	g_Assert((nCallbackEnd >= 0) && (nEarlyCommit > nCallbackEnd) && (nReplay > nEarlyCommit) && (nReturnWrite > nReplay) && (nLateCommit > nReturnWrite) && (nLateCommit < nPostSnapshot), "commit native completion before fallible argument replay, then commit return overrides");
	g_Assert.equal(strDispatch.split(strCommit).length, 3, "two production dispatch commitments");
	const strCatchBody = strDispatch.slice(nCatch + "\n\t\t} catch (...) {\n".length, nCatchEnd);
	g_Assert(strCatchBody.includes("return bSkipOriginal;"), "completed original invocation cannot fall back on exception");
	g_Assert(strDispatch.includes("bool bSkipOriginal = false;"), "pre-invocation failure must retain normal fallback");

	return [
		"\tbool ExecuteDispatchFailureProbe(DispatchFailureProbe& Probe, const int nHookID) {",
		"\t\tbool bSkipOriginal = false;",
		"",
		"\t\ttry {",
		"\t\t\tDispatchCallbackState CallContext {};",
		"\t\t\tif (Probe.m_Stage == DispatchFailureStage::BeforeCallback) {",
		"\t\t\t\tthrow std::bad_alloc {};",
		"\t\t\t}",
		"",
		"\t\t\tif (Probe.m_bInvokeTrampoline) {",
		"\t\t\t\t++Probe.m_unOriginalCalls;",
		"\t\t\t\tCallContext.m_bSkipOriginal = true;",
		"\t\t\t}",
		"",
		"\t\t\t" + strDispatch.slice(nEarlyCommit, nEarlyCommit + strCommit.length),
		"",
		"\t\t\tif (Probe.m_Stage == DispatchFailureStage::ArgumentReplay) {",
		"\t\t\t\tthrow std::bad_alloc {};",
		"\t\t\t}",
		"",
		"\t\t\tif (Probe.m_bOverrideReturn) {",
		"\t\t\t\tCallContext.m_bSkipOriginal = true;",
		"\t\t\t}",
		"",
		"\t\t\t// Commit callback return override.",
		"\t\t\t" + strDispatch.slice(nLateCommit, nLateCommit + strCommit.length),
		"\t\t\tif (bSkipOriginal) {",
		"\t\t\t\tif (Probe.m_Stage == DispatchFailureStage::PostSnapshot) {",
		"\t\t\t\t\tthrow std::bad_alloc {};",
		"\t\t\t\t}",
		"",
		"\t\t\t\treturn true;",
		"\t\t\t}",
		"",
		"\t\t\t++Probe.m_unOriginalCalls;",
		"",
		"\t\t\treturn true;",
		"\t\t} catch (...) {",
		strCatchBody,
		"\t\t}",
		"\t}",
	].join("\n");
}

function CheckWiring(strSource) {
	for (const [strSignature, strContract, strIndentation = "\t"] of g_vecWiringContracts) {
		g_Assert(GetDefinition(strSignature, strIndentation, strSource).includes(strContract), strSignature + ": " + strContract);
	}

	MakeDispatchFailurePolicy(strSource);

	const strHookObject = GetDefinition("MemoryHookManager::MakeHookObject(", "\t", strSource);
	g_Assert.equal(strHookObject.split("return FailHookObjectCreation();").length - 1, g_unHookObjectPropertyFailurePathCount, "Every hook result property failure releases only a newly created record");

	const strCreateFunction = GetDefinition("MemoryHookManager::CreateFunction(", "\t", strSource);
	const nThunkOwnerIndex = strCreateFunction.indexOf("pThunkOwner =");
	const nRecordAllocationIndex = strCreateFunction.indexOf("pHookRecord = std::make_shared");
	const nHookInstallationIndex = strCreateFunction.indexOf("pHook->Hook(");
	g_Assert((nThunkOwnerIndex >= 0) && (nRecordAllocationIndex >= 0) && (nHookInstallationIndex >= 0), "CreateFunction publication boundaries must exist");
	g_Assert(nThunkOwnerIndex < nRecordAllocationIndex, "destroy record before executable thunk on unwind");
	g_Assert(nRecordAllocationIndex < nHookInstallationIndex, "allocate record before installing the hook");
	const nSignatureReadIndex = strCreateFunction.indexOf("HookSignature = BuildSignature(");
	const nReentrantLookupIndex = strCreateFunction.indexOf("pReentrantRecord = FindRecord(pAddress);");
	const nCurrentIdentifierIndex = strCreateFunction.indexOf("const int nHookID = m_nNextHookID;");
	g_Assert((nSignatureReadIndex >= 0) && (nSignatureReadIndex < nReentrantLookupIndex) && (nReentrantLookupIndex < nCurrentIdentifierIndex) && (nCurrentIdentifierIndex < nThunkOwnerIndex), "Revalidate records and allocate the current identifier after JavaScript signature reads");
	g_Assert(g_strHeader.includes("std::vector<std::shared_ptr<MemoryHookRecord>> m_vecHookRecords;"), "registry provides stable pointees");
}

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));
}

function RunFixtureCommand(strProgram, vecArguments) {
	let strExecutionProgram = strProgram;

	if (process.platform === "win32") {
		const strRealProgram = g_FileSystem.realpathSync(strProgram);
		const strRealBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
		const strRelativeProgramPath = g_Path.relative(strRealBuildRoot, strRealProgram);
		g_Assert.match(strRelativeProgramPath, /^NativeMemoryHookLifecycle-[^/\\]+[/\\](?:Win32|X64)[/\\]Release[/\\]MemoryHookLifecycleContracts\.exe$/, "Execution copies must stay within the private fixture build");

		// Keep mutation link outputs separate from executable images launched by this test.
		const strExecutionDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_Path.dirname(strRealProgram), "Run-"));
		strExecutionProgram = g_Path.join(strExecutionDirectory, g_Path.basename(strRealProgram));
		g_FileSystem.copyFileSync(strRealProgram, strExecutionProgram, g_FileSystem.constants.COPYFILE_EXCL);
	}

	return g_ChildProcess.spawnSync(strExecutionProgram, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unFixtureTimeoutMilliseconds });
}

function RunFixture(strProgram, bRegression) {
	const Result = RunFixtureCommand(strProgram, []);
	g_Assert.equal(Result.status, bRegression ? 1 : 0, Result.error?.message ?? (Result.stdout + Result.stderr));
	g_Assert.equal(Result.signal, null, "Native oracle must finish without a signal");
	g_Assert.match(bRegression ? Result.stderr : Result.stdout, bRegression ? /\[native\] memory-hook lifecycle failure:/ : /\[native\] memory-hook lifecycle ownership/);
}

function VerifyFixtureCLI(strProgram) {
	const Result = RunFixtureCommand(strProgram, ["UnexpectedArgument"]);
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.status, 2);
	g_Assert.equal(Result.signal, null);
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), "Usage: MemoryHookLifecycleContracts\n");
}

CheckWiring(g_strSource);

for (const [strSignature, strContract, strIndentation = "\t"] of g_vecWiringContracts) {
	const strDefinition = GetDefinition(strSignature, strIndentation);
	const strMutatedDefinition = strDefinition.replace(strContract, "REMOVED_SOURCE_REGRESSION_TARGET");
	g_Assert.throws(() => CheckWiring(g_strSource.replace(strDefinition, () => strMutatedDefinition)), g_Assert.AssertionError, "Source wiring regression: " + strContract);
}

const g_strDefinitions = [
	GetDefinition("bool DoesMemoryHookContextMatch(", "\t\t"),
	GetDefinition("void AddMemoryHookOwner(", "\t\t"),
	GetDefinition("void ResetMemoryHookCallback(", "\t\t"),
	...g_vecMethods.map(strSignature => GetDefinition(strSignature)),
].join("\n\n");
const g_nHeaderStartIndex = g_strHeader.indexOf("namespace SourceJS {");
const g_nHeaderEndIndex = g_strHeader.lastIndexOf("\n#endif");
g_Assert((g_nHeaderStartIndex >= 0) && (g_nHeaderEndIndex > g_nHeaderStartIndex), "Exact production header namespace");

const g_strFixtureTemplate = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/MemoryHookLifecycleContracts.cpp"), "utf8");
for (const strPlaceholder of ["// @PRODUCTION_HEADER@", "// @PRODUCTION_DEFINITIONS@", "// @PRODUCTION_DISPATCH_POLICY@"]) {
	g_Assert.equal(g_strFixtureTemplate.split(strPlaceholder).length, 2, "Unique production placeholder: " + strPlaceholder);
}

const g_strFixture = g_strFixtureTemplate
	.replace("// @PRODUCTION_HEADER@", () => "// Generated only: memory-hook lifecycle regression executable with V8/Detours doubles.\n" + g_strHeader.slice(g_nHeaderStartIndex, g_nHeaderEndIndex).replace(/\bprivate:/g, "public:"))
	.replace("// @PRODUCTION_DEFINITIONS@", () => g_strDefinitions)
	.replace("// @PRODUCTION_DISPATCH_POLICY@", () => MakeDispatchFailurePolicy(g_strSource));

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryHookLifecycle-"));

try {
	const strFixturePath = g_Path.join(g_strTemporaryRoot, "MemoryHookLifecycleContracts.cpp");
	g_FileSystem.writeFileSync(strFixturePath, g_strFixture);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native memory-hook lifecycle regression build.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(MemoryHookLifecycleContracts LANGUAGES CXX)",
		"add_executable(MemoryHookLifecycleContracts MemoryHookLifecycleContracts.cpp)",
		"target_compile_features(MemoryHookLifecycleContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(MemoryHookLifecycleContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(MemoryHookLifecycleContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		Run("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		Run("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/MemoryHookLifecycleContracts.exe") : g_Path.join(strBinaryRoot, "MemoryHookLifecycleContracts");
		RunFixture(strProgram, false);
		VerifyFixtureCLI(strProgram);

		for (const Mutation of g_vecMutations) {
			g_Assert(g_strFixture.includes(Mutation.Old), "Native regression target: " + Mutation.Name);
			g_FileSystem.writeFileSync(strFixturePath, g_strFixture.replace(Mutation.Old, () => Mutation.New));
			Run("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			RunFixture(strProgram, true);
		}

		g_FileSystem.writeFileSync(strFixturePath, g_strFixture);
		Run("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		RunFixture(strProgram, false);
		process.stdout.write(Profile.Name + ": lifecycle contracts passed; " + g_vecMutations.length + " compiled regressions rejected.\n");
	}
} finally {
	const strRealDirectory = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeDirectory = g_Path.relative(g_strBuildRoot, strRealDirectory);
	g_Assert(!g_Path.isAbsolute(strRelativeDirectory) && !strRelativeDirectory.startsWith("..") && /^NativeMemoryHookLifecycle-[^/\\]+$/.test(strRelativeDirectory), "Refuse cleanup outside the exact native fixture family");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealDirectory, { recursive: true, force: true, maxRetries: g_unFixtureCleanupRetries, retryDelay: g_unFixtureCleanupRetryDelayMilliseconds });
}

process.stdout.write("Memory-hook lifecycle tests passed with V8/Detours doubles; " + g_vecWiringContracts.length + " source-only dispatch/publication regressions rejected.\n");
