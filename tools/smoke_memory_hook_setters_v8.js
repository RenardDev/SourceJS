"use strict";

// Executes extracted production conversions/setters against the configured real
// V8 monolith and Detours context layouts, including scoped payload-data lifetime
// and the complete pre/suppressed-post and post-return dispatchers with explicit
// native adapters.
// It does not install a native hook or
// emulate the game server. Records, native-hook handles, the string owner and
// argument writer are adapters; their effects are checked explicitly.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

function PrintUsage() {
	console.log("Usage: node tools/smoke_memory_hook_setters_v8.js --build-tree <configured-production-build>");
}

function ReadBuildTreeArgument() {
	const vecArguments = process.argv.slice(2);
	if ((vecArguments.length === 1) && ["--help", "-h"].includes(vecArguments[0])) {
		PrintUsage();
		process.exit(0);
	}

	if ((vecArguments.length !== 2) || (vecArguments[0] !== "--build-tree") || !vecArguments[1] || vecArguments[1].startsWith("--")) {
		PrintUsage();
		process.exit(2);
	}

	return vecArguments[1];
}

const g_strBuildTreeArgument = ReadBuildTreeArgument();
g_Assert(["win32", "linux"].includes(process.platform) && ["ia32", "x64"].includes(process.arch), "Supported x86/x64 production host required");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strBuildTree = g_FileSystem.realpathSync(g_Path.resolve(g_strBuildTreeArgument));
const g_strCache = g_FileSystem.readFileSync(g_Path.join(g_strBuildTree, "CMakeCache.txt"), "utf8");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/MemoryHookManager.cpp"), "utf8").replace(/\r/g, "");
const g_strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/V8Runtime.cpp"), "utf8").replace(/\r/g, "");
const g_strHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/MemoryHookManager.h"), "utf8").replace(/\r/g, "");
const g_strTemplate = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/MemoryHookSettersV8.cpp"), "utf8").replace(/\r/g, "");

function ReadCache(strName, bRequired = true) {
	const vecMatches = g_strCache.match(new RegExp("^" + strName + ":[^=]*=(.*)$", "m"));
	g_Assert(!bRequired || vecMatches?.[1], "Missing configured cache entry: " + strName);

	return vecMatches?.[1].trim() ?? "";
}

function GetDefinition(strName, bMethod = false, bTemplate = false, strOwner = "MemoryHookManager") {
	const strIndentation = bMethod ? "\t" : "\t\t";
	const strRole = bMethod ? strOwner + "::" + strName : strName;
	const vecMatches = g_strSource.match(new RegExp("^" + strIndentation + "(?=[^\\t\\n]).*\\b" + strRole + "\\([^\\n]*\\)" + (bMethod ? "(?: const)?(?: noexcept)?" : "(?: noexcept)?") + " \\{", "m"));
	g_Assert(vecMatches, "Missing actual definition: " + strName);

	const unStart = vecMatches.index;
	const strEnd = "\n" + strIndentation + "}";
	const nEnd = g_strSource.indexOf(strEnd, unStart);
	g_Assert(nEnd > unStart, "Missing actual definition end: " + strName);

	const strDefinition = g_strSource.slice(unStart, nEnd + strEnd.length);

	return (bTemplate ? "\ttemplate <typename " + ((strName === "RunMemoryHookCallback") ? "TCallback" : "TReader") + ">\n" : "") + (bMethod ? strDefinition : strDefinition.replace(/^\t/gm, ""));
}

function ReplaceOnce(strSource, strOld, strNew) {
	g_Assert.equal(strSource.split(strOld).length, 2, "Unique insertion/mutation target: " + strOld);

	return strSource.replace(strOld, () => strNew);
}

function Run(strCommand, vecArguments, strDirectory = g_strProjectRoot) {
	const unTimeoutMilliseconds = 240_000;
	const unMaximumOutputBytes = 16 * 1024 * 1024;

	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: strDirectory, encoding: "utf8", timeout: unTimeoutMilliseconds, maxBuffer: unMaximumOutputBytes, windowsHide: true });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Unexpected native process signal: " + Result.signal);

	return Result;
}

function RequireSuccess(strCommand, vecArguments, strDirectory) {
	const Result = Run(strCommand, vecArguments, strDirectory);
	g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "New fixture warning:\n" + Result.stdout + Result.stderr);

	return Result;
}

function VerifyFixtureCLI(strExecutable) {
	const Result = Run(strExecutable, ["--invalid"], g_strDirectory);
	g_Assert.equal(Result.status, 2, Result.stdout + Result.stderr);
	g_Assert.equal(Result.stdout, "");
	g_Assert(Result.stderr.startsWith("Usage: MemoryHookSettersV8"), Result.stderr);
}

const g_strPlatform = (process.platform === "win32") ? "windows" : "linux";
const g_strV8Root = ReadCache("V8_ROOT").replace(/\\/g, "/");
const g_strV8Configuration = ReadCache("V8_CONFIG");
const g_strRoot = g_strProjectRoot.replace(/\\/g, "/");
g_Assert(![g_strRoot, g_strV8Root, g_strV8Configuration].some(strValue => /[;"\r\n]|\$\{/.test(strValue)), "Unsafe CMake path/configuration value");

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryHookSettersV8-"));
try {
	const vecTypeMatches = g_strHeader.match(/\ttypedef enum _DATA_TYPE : int \{[\s\S]*?\n\t\} DATA_TYPE, \*PDATA_TYPE;/);
	const vecRuntimeStringMatches = g_strRuntimeSource.match(/^\t\tbool MakeRuntimeString\([^\r\n]*\) \{[\s\S]*?^\t\t\}/gm);
	g_Assert(vecRuntimeStringMatches && (vecRuntimeStringMatches.length === 1), "Actual runtime string conversion definition");
	g_Assert(vecTypeMatches, "Actual DATA_TYPE boundary");

	const vecSignatureMatches = g_strHeader.match(/\tstruct MemoryHookSignature \{[\s\S]*?\n\t\};/);
	g_Assert(vecSignatureMatches, "Actual signature declaration");
	const vecHookTypeMatches = g_strHeader.match(/\ttypedef enum _HOOK_TYPE : int \{[\s\S]*?\n\t\} HOOK_TYPE, \*PHOOK_TYPE;/);
	const vecCallbackRecordMatches = g_strHeader.match(/\tstruct MemoryHookCallbackRecord \{[\s\S]*?\n\t\};/);
	g_Assert(vecHookTypeMatches && vecCallbackRecordMatches, "Actual callback phase and handle record declarations");
	const vecPostContextMatches = g_strHeader.match(/\ttypedef struct _MEMORY_HOOK_POST_CONTEXT \{[\s\S]*?\n\t\} MemoryHookPostContext, \*PMemoryHookPostContext;/);
	const vecPostFrameMatches = g_strHeader.match(/\tstruct MemoryHookPostFrame \{[\s\S]*?\n\t\};/);
	g_Assert(vecPostContextMatches && vecPostFrameMatches, "Actual post-return context and argument-frame declarations");

	const nSignatureStart = g_strSource.indexOf("\tstd::shared_ptr<MemoryHookRecord> MemoryHookManager::FindRecord(");
	const nSignatureEnd = g_strSource.indexOf("\n\tvoid* MemoryHookManager::CreateThunk(", nSignatureStart);
	g_Assert((nSignatureStart >= 0) && (nSignatureEnd > nSignatureStart), "Actual contiguous signature/lookup definitions");

	const strMakeString = ReplaceOnce(GetDefinition("MakeString"), "v8::String::NewFromUtf8(pIsolate, pszSafeValue, v8::NewStringType::kNormal)", "CreateFixtureString(pIsolate, pszSafeValue, v8::NewStringType::kNormal)");
	const strReaders = strMakeString + "\n\n" + ["ThrowError", "GetValue", "SetValue", "SetInteger", "SetString", "SetFunction", "ReadAddressFromValue", "ReadIntegerWordFromValue"].map(strName => GetDefinition(strName)).join("\n\n") + "\n\n" + GetDefinition("RunMemoryHookCallback", false, true) + "\n\n" + GetDefinition("ReadMemoryHookValue", false, true) + "\n\n" + ["ReadNumberFromValue", "ReadInt32FromValue", "ReadStringFromValue"].map(strName => GetDefinition(strName)).join("\n\n");
	const vecContextRecords = g_strSource.match(/^\t\tstruct MemoryHookCallContext \{[\s\S]*?^\t\t\};/gm);
	const vecContextConstructors = g_strSource.match(/^\t\tMemoryHookCallContext::MemoryHookCallContext\(\) noexcept \{[\s\S]*?^\t\t\}/gm);
	g_Assert.equal(vecContextRecords?.length, 1, "Actual hook call context record");
	g_Assert.equal(vecContextConstructors?.length, 1, "Actual hook call context constructor");
	const nContextStart = g_strSource.indexOf("\t\tconstexpr int kMemoryHookContextAddressFieldIndex = 0;");
	const nContextEnd = g_strSource.indexOf("\n\t\ttemplate <typename TCallback>", nContextStart);
	g_Assert((nContextStart >= 0) && (nContextEnd > nContextStart), "Actual scoped hook context helpers");
	const strContextHelpers = (vecContextRecords[0] + "\n\n" + vecContextConstructors[0] + "\n\n" + g_strSource.slice(nContextStart, nContextEnd).trimEnd()).replace(/^\t/gm, "");
	g_Assert(!g_strSource.includes("v8::External::New(pIsolate, &CallContext)"), "No payload callback may retain a bare stack-frame external");
	g_Assert.equal(g_strSource.match(/\bMemoryHookCallContextScope CallContextScope\(/g)?.length, 3, "All pre/suppressed/post callback producers own a scoped context");
	g_Assert.equal(g_strSource.match(/\bCallContextScope\.Invalidate\(\);/g)?.length, 3, "Every callback invalidates its context before later result coercion");
	const vecInsertions = [
		["@RUNTIME_STRING@", "\t// Generated only: real-V8 memory-hook setter/signature regression executable.\n" + vecRuntimeStringMatches[0].replace(/^\t/gm, "")],
		["@DATA_TYPE@", vecTypeMatches[0]],
		["@HOOK_TYPE@", vecHookTypeMatches[0]],
		["@POST_CONTEXT@", vecPostContextMatches[0]],
		["@POST_FRAME@", vecPostFrameMatches[0]],
		["@CALLBACK_RECORD@", vecCallbackRecordMatches[0]],
		["@SIGNATURE_TYPE@", vecSignatureMatches[0]],
		["@SIGNATURE_CONSTRUCTOR@", GetDefinition("MemoryHookSignature", true, false, "MemoryHookSignature")],
		["@READERS@", strReaders],
		["@HOOK_CONTEXT_HELPERS@", strContextHelpers],
		["@SIGNATURE_HELPERS@", GetDefinition("ConvertStringToLowercase") + "\n\n" + GetDefinition("NormalizeCallingConvention") + "\n\n" + g_strSource.slice(nSignatureStart, nSignatureEnd)],
		["@SIGNATURE_CHECKS@", g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/MemoryHookSignaturesV8.cpp"), "utf8").replace(/\r/g, "")],
		["@X87_HELPERS@", GetDefinition("ReadX87ValueAsDouble") + "\n\n" + GetDefinition("WriteX87ValueFromDouble")],
		["@SETTERS@", GetDefinition("SetArgumentFromValue", true) + "\n\n" + GetDefinition("SetReturnFromValue", true)],
		["@DECODER@", GetDefinition("MakeDataTypeValue", true) + "\n\n" + GetDefinition("GetReturnValue", true) + "\n\n" + GetDefinition("GetHooks", true)],
		["@DISPATCHER@", GetDefinition("SetHookReturnValueCallback") + "\n\n" + GetDefinition("SetHookArgumentCallback") + "\n\n" + GetDefinition("CopyCallbacks", true) + "\n\n" + GetDefinition("GetStackSlot", true) + "\n\n" + GetDefinition("HandleHook", true)],
		["@POST_DISPATCHER@", ["RunPostCallbacks", "LoadReturnContext", "StoreReturnContext"].map(strName => GetDefinition(strName, true)).join("\n\n")],
	];
	let strFixture = g_strTemplate;
	for (const arrInsertion of vecInsertions) {
		strFixture = ReplaceOnce(strFixture, arrInsertion[0], arrInsertion[1]);
	}

	g_Assert(!/@[A-Z_]+@/.test(strFixture), "All fixture insertion points resolved");

	const strPostDispatcher = GetDefinition("RunPostCallbacks", true);
	g_Assert.equal(strPostDispatcher.split("pIsolate->HasPendingException()").length, 4, "Entry, next payload and callback-completion post-return guards");
	const strPostStopGuard = "\t\t\tif (pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\tbreak;\n\t\t\t}";
	g_Assert.equal(strPostDispatcher.split(strPostStopGuard).length, 3, "Both post-return loop exits retain final native result storage");

	const vecCases = [
		{ Name: "Current", Source: strFixture, ExpectedStatus: 0 },
		{ Name: "DispatchArgumentTypeReused", Source: ReplaceOnce(strFixture, "const DATA_TYPE ArgumentType = HookRecord.m_Signature.m_vecArgumentTypes[static_cast<std::size_t>(nArgumentIndex)];\n\n\t\treturn MakeDataTypeValue(ArgumentType, m_unArgument, pIsolate);", "const DATA_TYPE ArgumentType = HookRecord.m_Signature.m_vecArgumentTypes.front();\n\n\t\treturn MakeDataTypeValue(ArgumentType, m_unArgument, pIsolate);"), ExpectedStatus: 1, Failure: "Successful dispatcher handles the call" },
		{ Name: "PostReturnPendingExceptionIgnored", Source: ReplaceOnce(strFixture, strPostDispatcher, strPostDispatcher.replaceAll("pIsolate->HasPendingException()", "false")), ExpectedStatus: 1 },
		{ Name: "PostReturnOverrideDiscarded", Source: ReplaceOnce(strFixture, strPostDispatcher, strPostDispatcher.replaceAll(strPostStopGuard, strPostStopGuard.replace("break;", "return;"))), ExpectedStatus: 1 },
		{ Name: "PostReturnPayloadContinuation", Source: ReplaceOnce(strFixture, strPostDispatcher, ReplaceOnce(strPostDispatcher, "for (auto const& CallbackRecord : vecPostCallbacks) {\n" + strPostStopGuard + "\n", "for (auto const& CallbackRecord : vecPostCallbacks) {")), ExpectedStatus: 1 },
		{ Name: "DispatchPendingExceptionIgnored", Source: ReplaceOnce(strFixture, "return pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException();", "return pIsolate->IsExecutionTerminating();"), ExpectedStatus: 1 },
		{ Name: "DispatchCompletedDecisionLost", Source: ReplaceOnce(strFixture, "CallContextScope.Invalidate();\n\t\t\t\tbSkipOriginal = bSkipOriginal || CallContext.m_bSkipOriginal;", "CallContextScope.Invalidate();\n\t\t\t\tbSkipOriginal = false;"), ExpectedStatus: 1 },
		{ Name: "DispatchReplayIterationContinues", Source: ReplaceOnce(strFixture, "\t\t\t\t\tif (IsJavaScriptStopped()) {\n\t\t\t\t\t\treturn bSkipOriginal;\n\t\t\t\t\t}", "// Generated-only regression: replay the next argument despite a pending exception."), ExpectedStatus: 1 },
		{ Name: "DispatchLastReplayFailureContinues", Source: ReplaceOnce(strFixture, "\t\t\t\tif (IsJavaScriptStopped()) {\n\t\t\t\t\treturn bSkipOriginal;\n\t\t\t\t}\n\n\t\t\t\tif (bCallbackCompleted", "\t\t\t\tif (bCallbackCompleted"), ExpectedStatus: 1 },
		{ Name: "ExpiredContextRetained", Source: ReplaceOnce(strFixture, "m_LocalContextData->SetAlignedPointerInInternalField(kMemoryHookContextAddressFieldIndex, nullptr, v8::kEmbedderDataTypeTagDefault);", "// Generated-only regression: leave the expired frame address attached."), ExpectedStatus: 1 },
		{ Name: "InvalidNumericInputAccepted", Source: ReplaceOnce(strFixture, GetDefinition("ReadNumberFromValue"), ReplaceOnce(GetDefinition("ReadNumberFromValue"), "if (!pIsolate || LocalContext.IsEmpty() || LocalValue.IsEmpty()) {\n\t\t\treturn false;", "if (!pIsolate || LocalContext.IsEmpty() || LocalValue.IsEmpty()) {\n\t\t\treturn true;")), ExpectedStatus: 1 },
		{ Name: "FailedStringCreationResult", Source: ReplaceOnce(strFixture, "if (!MaybeLocalString.ToLocal(&LocalString)) {\n\t\t\treturn {};", "if (!MaybeLocalString.ToLocal(&LocalString)) {\n\t\t\treturn v8::String::Empty(pIsolate);"), ExpectedStatus: 1 },
		{ Name: "FailedPropertyReadResult", Source: ReplaceOnce(strFixture, GetDefinition("GetValue"), ReplaceOnce(GetDefinition("GetValue"), "if (LocalPropertyName.IsEmpty()) {\n\t\t\treturn false;", "if (LocalPropertyName.IsEmpty()) {\n\t\t\treturn true;")), ExpectedStatus: 1 },
		{ Name: "FailedPropertyWriteResult", Source: ReplaceOnce(strFixture, GetDefinition("SetValue"), ReplaceOnce(GetDefinition("SetValue"), "if (LocalPropertyName.IsEmpty()) {\n\t\t\treturn false;", "if (LocalPropertyName.IsEmpty()) {\n\t\t\treturn true;")), ExpectedStatus: 1 },
		{ Name: "FailedPropertyReadOutput", Source: ReplaceOnce(strFixture, "if (!LocalObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalValue)) {\n\t\t\treturn false;", "if (!LocalObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalValue)) {\n\t\t\tLocalValueOut = {};\n\t\t\treturn false;"), ExpectedStatus: 1 },
		{ Name: "FailedErrorMessageIgnored", Source: ReplaceOnce(strFixture, "pIsolate->ThrowException({});\n\t\t\treturn;", "return;"), ExpectedStatus: 1 },
		{ Name: "ArgumentFloatLimit", Source: ReplaceOnce(strFixture, "std::fabs(dblArgumentValue) > static_cast<double>(std::numeric_limits<float>::max())", "std::fabs(dblArgumentValue) > (static_cast<double>(std::numeric_limits<float>::max()) / 2.0)"), ExpectedStatus: 1 },
		{ Name: "ReturnFloatLimit", Source: ReplaceOnce(strFixture, "std::fabs(dblReturnValue) > static_cast<double>(std::numeric_limits<float>::max())", "std::fabs(dblReturnValue) > (static_cast<double>(std::numeric_limits<float>::max()) / 2.0)"), ExpectedStatus: 1 },
		{ Name: "ArgumentStringFailure", Source: ReplaceOnce(strFixture, "std::string strArgumentValue {};\n\t\t\tif (!ReadStringFromValue(pIsolate, LocalValue, strArgumentValue)) {\n\t\t\t\treturn false;\n\t\t\t}", "std::string strArgumentValue {};\n\t\t\tReadStringFromValue(pIsolate, LocalValue, strArgumentValue);"), ExpectedStatus: 1 },
		{ Name: "ReturnStringFailure", Source: ReplaceOnce(strFixture, "std::string strReturnValue {};\n\t\t\t\tif (!ReadStringFromValue(pIsolate, LocalValue, strReturnValue)) {\n\t\t\t\t\treturn false;\n\t\t\t\t}", "std::string strReturnValue {};\n\t\t\t\tReadStringFromValue(pIsolate, LocalValue, strReturnValue);"), ExpectedStatus: 1 },
		{ Name: "NumericExceptionReplacement", Source: ReplaceOnce(strFixture, "v8::Maybe<double> const MaybeValue = LocalValue->NumberValue(LocalContext);\n\t\t\tif (MaybeValue.IsNothing()) {\n\t\t\t\treturn false;", "v8::Maybe<double> const MaybeValue = LocalValue->NumberValue(LocalContext);\n\t\t\tif (MaybeValue.IsNothing()) {\n\t\t\t\tv8::Isolate::GetCurrent()->ThrowException(v8::Exception::Error(v8::String::Empty(v8::Isolate::GetCurrent())));\n\t\t\t\treturn false;"), ExpectedStatus: 1 },
		{ Name: "BooleanHighBits", Source: ReplaceOnce(strFixture, "static_cast<std::uint8_t>(unDataValue) != 0", "unDataValue != 0"), ExpectedStatus: 1 },
		{ Name: "LiveInventory", Source: ReplaceOnce(strFixture, "std::vector<std::shared_ptr<MemoryHookRecord>> const vecHookRecords = m_vecHookRecords;", "std::vector<std::shared_ptr<MemoryHookRecord>> const& vecHookRecords = m_vecHookRecords;"), ExpectedStatus: 1 },
		{ Name: "UTF8ExceptionSwallowing", Source: ReplaceOnce(strFixture, "v8::Local<v8::String> LocalString {};\n\t\t\tif (!LocalValue->ToString(pIsolate->GetCurrentContext()).ToLocal(&LocalString)) {\n\t\t\t\treturn false;\n\t\t\t}\n\n\t\t\tv8::String::Utf8Value const UTF8Value(pIsolate, LocalString);", "v8::String::Utf8Value const UTF8Value(pIsolate, LocalValue);"), ExpectedStatus: 1 },
		{ Name: "FractionalIndex", Source: ReplaceOnce(strFixture, "(std::floor(dblValue) != dblValue) || (dblValue < kMinimumInteger)", "(std::floor(dblValue) > dblValue) || (dblValue < kMinimumInteger)"), ExpectedStatus: 1 },
		{ Name: "SignatureArrayExtent", Source: ReplaceOnce(strFixture, GetDefinition("ReadArgumentTypes", true), ReplaceOnce(GetDefinition("ReadArgumentTypes", true), "unArgumentIndex < unArgumentCount;", "unArgumentIndex < LocalArgumentTypes->Length();")), ExpectedStatus: 1 },
		{ Name: "VoidArgument", Source: ReplaceOnce(strFixture, "if (ArgumentType == DATA_TYPE_VOID)", "if (ArgumentType == DATA_TYPE_STRING)"), ExpectedStatus: 1 },
		{ Name: "UnknownConvention", Source: ReplaceOnce(strFixture, '(strConvention != "fastcall")', '(strConvention != "unknown")'), ExpectedStatus: 1 },
	];
	if (ReadCache("SOURCEJS_ARCH") === "x86") {
		vecCases.push({ Name: "X87FloatReadRange", Source: ReplaceOnce(strFixture, "(std::fabs(dblReturnValue) > kMaximumFloatReturn)", "(std::fabs(dblReturnValue) > (kMaximumFloatReturn * 2.0))"), ExpectedStatus: 1 });
	}

	let strCMake = `# Generated only: real-V8 memory-hook setter/signature regression build.
cmake_minimum_required(VERSION 3.20)
project(MemoryHookSettersV8 LANGUAGES CXX)
include("${g_strRoot}/cmake/SourceJSPackage.cmake")
`;
	for (const Case of vecCases) {
		g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, Case.Name + ".cpp"), Case.Source);
		strCMake += `add_executable(${Case.Name} ${Case.Name}.cpp)
target_compile_features(${Case.Name} PRIVATE cxx_std_20)
target_include_directories(${Case.Name} SYSTEM PRIVATE "${g_strRoot}/thirdparty/Detours" "${g_strV8Root}/include")
SourceJSLinkV8(${Case.Name} "${g_strV8Root}" "${g_strV8Configuration}" "${g_strPlatform}")
if(MSVC)
	# Match the production target's static Release CRT and the configured V8 monolith.
	set_target_properties(${Case.Name} PROPERTIES MSVC_RUNTIME_LIBRARY "MultiThreaded")
	target_compile_options(${Case.Name} PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)
	target_link_libraries(${Case.Name} PRIVATE advapi32 dbghelp winmm ws2_32)
else()
	target_compile_options(${Case.Name} PRIVATE -Wall -Wextra -Werror -pedantic)
	target_link_options(${Case.Name} PRIVATE "-fuse-ld=${ReadCache("SOURCEJS_LINUX_LINKER", false) || "bfd"}")
	target_link_libraries(${Case.Name} PRIVATE dl pthread atomic)
endif()
`;
	}

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), strCMake);

	const strBinaryDirectory = g_Path.join(g_strDirectory, "compiled");
	const vecConfigure = ["-S", g_strDirectory, "-B", strBinaryDirectory, "-G", ReadCache("CMAKE_GENERATOR"), "-DCMAKE_CXX_FLAGS=" + ReadCache("CMAKE_CXX_FLAGS", false)];
	if (process.platform === "win32") {
		vecConfigure.push("-A", ReadCache("CMAKE_GENERATOR_PLATFORM"));
	} else {
		vecConfigure.push("-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_COMPILER=" + ReadCache("CMAKE_CXX_COMPILER"));
	}

	RequireSuccess("cmake", vecConfigure);

	for (const Case of vecCases) {
		RequireSuccess("cmake", ["--build", strBinaryDirectory, "--config", "Release", "--target", Case.Name, "--parallel", "2"]);

		const strExecutable = g_Path.join(strBinaryDirectory, (process.platform === "win32") ? "Release/" + Case.Name + ".exe" : Case.Name);
		if (Case.ExpectedStatus === 0) {
			VerifyFixtureCLI(strExecutable);
		}

		const Result = Run(strExecutable, [], g_strDirectory);
		g_Assert.equal(Result.status, Case.ExpectedStatus, Case.Name + " Status=" + Result.status + "\n" + Result.stdout + Result.stderr);

		if (Case.ExpectedStatus !== 0) {
			g_Assert(Result.stderr.includes("Memory hook setter fixture:"), "Mutation must fail a runtime assertion, not initialization or compilation: " + Case.Name);

			if (Case.Failure) {
				g_Assert(Result.stderr.includes(Case.Failure), Case.Name + ": expected failure: " + Case.Failure);
			}
		}

		console.log("Real V8 hook setter " + Case.Name + ": checked");

		// V8 monolith executables are large; retain only the current scenario.
		g_Assert.equal(g_FileSystem.realpathSync(strExecutable), g_Path.resolve(strExecutable), "Executable stays at its generated path");
		g_FileSystem.unlinkSync(strExecutable);
	}

	console.log("Real V8 hook setter/signature contracts passed: " + g_strPlatform + " " + g_strV8Configuration + "; " + (vecCases.length - 1) + " compiled negative controls.");
} finally {
	const strResolved = g_FileSystem.realpathSync(g_strDirectory);
	g_Assert.equal(strResolved, g_strDirectory, "Cleanup keeps the exact created directory");
	g_Assert(!g_FileSystem.lstatSync(g_strDirectory).isSymbolicLink(), "Cleanup refuses a substituted link");
	g_Assert.equal(g_Path.dirname(strResolved), g_strBuildRoot, "Cleanup stays in the actual build root");
	g_Assert(g_Path.basename(strResolved).startsWith("NativeMemoryHookSettersV8-") && (g_Path.basename(strResolved).length > "NativeMemoryHookSettersV8-".length), "Cleanup stays in the owned fixture family");
	g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
}
