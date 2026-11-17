"use strict";

// Executes extracted production thunk bytes and return-context conversion with
// real OS executable memory and assembly entry/continuation probes. The bridges
// are explicit adapters, not an installed Detours hook, V8, or a game server.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && ["--help", "-h"].includes(g_vecArguments[0])) {
	console.log("Usage: node tools/smoke_memory_hook_thunks.js [--profile X86|X64]");
	process.exit(0);
}

if ((g_vecArguments.length !== 0) && ((g_vecArguments.length !== 2) || (g_vecArguments[0] !== "--profile") || !["X86", "X64"].includes(g_vecArguments[1]))) {
	console.error("Usage: node tools/smoke_memory_hook_thunks.js [--profile X86|X64]");
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform) && ["ia32", "x64"].includes(process.arch), "Windows/Linux x86/x64 fixture host required");

const g_strRoot = g_Path.resolve(__dirname, "..");
const g_strCMakeRoot = g_strRoot.replace(/\\/g, "/");
g_Assert(!/[;"\r\n]|\$\{/.test(g_strCMakeRoot), "Safe generated CMake project root");

const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/MemoryHookManager.cpp"), "utf8").replace(/\r/g, "");
const g_strHeader = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/MemoryHookManager.h"), "utf8").replace(/\r/g, "");
const g_strBindings = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r/g, "");
const g_strFixtureRoot = g_Path.join(__dirname, "fixtures");
const g_vecProfiles = ["X86", "X64"].filter(strProfile => (g_vecArguments.length === 0) || (strProfile === g_vecArguments[1]));

function GetDefinition(strName, bMethod = false) {
	const strIndentation = bMethod ? "\t" : "\t\t";
	const strRole = bMethod ? "MemoryHookManager::" + strName : strName;
	const vecMatches = g_strSource.match(new RegExp("^" + strIndentation + "(?=[^\\t\\n]).*\\b" + strRole + "\\([^\\n]*\\)(?: const)?(?: noexcept)? \\{", "m"));
	g_Assert(vecMatches, "Actual function definition: " + strName);

	const strEnd = "\n" + strIndentation + "}";
	const nEnd = g_strSource.indexOf(strEnd, vecMatches.index);
	g_Assert(nEnd > vecMatches.index, "Complete function definition: " + strName);

	const strDefinition = g_strSource.slice(vecMatches.index, nEnd + strEnd.length);

	return bMethod ? strDefinition : strDefinition.replace(/^\t/gm, "");
}

function Run(strCommand, vecArguments, strDirectory) {
	const unTimeoutMilliseconds = 240_000;
	const unMaximumOutputBytes = 16 * 1024 * 1024;

	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: strDirectory, encoding: "utf8", timeout: unTimeoutMilliseconds, maxBuffer: unMaximumOutputBytes, windowsHide: true });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Native fixture must not crash: " + Result.signal);

	return Result;
}

function ReplaceOnce(strSource, strOld, strNew) {
	g_Assert.equal(strSource.split(strOld).length, 2, "Unique insertion/compiled regression target: " + strOld);

	return strSource.replace(strOld, () => strNew);
}

function RequireBuild(strCommand, vecArguments, strDirectory) {
	const Result = Run(strCommand, vecArguments, strDirectory);
	g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "Native fixture warnings:\n" + Result.stdout + Result.stderr);
}

function VerifyFixtureCLI(strExecutable) {
	const Result = Run(strExecutable, ["--invalid"], g_strDirectory);
	g_Assert.equal(Result.status, 2, Result.stdout + Result.stderr);
	g_Assert.equal(Result.stdout, "");
	g_Assert(Result.stderr.startsWith("Usage: MemoryHookThunkContracts"), Result.stderr);
}

const g_vecContextMatch = g_strHeader.match(/\ttypedef struct _MEMORY_HOOK_POST_CONTEXT \{[\s\S]*?\n\t\} MemoryHookPostContext, \*PMemoryHookPostContext;/);
g_Assert(g_vecContextMatch, "Actual post-context record");

const g_strReleaseThunk = ReplaceOnce(ReplaceOnce(GetDefinition("ReleaseThunk", true), "VirtualFree(pThunk, 0, MEM_RELEASE)", "FixtureVirtualFree(pThunk, 0, MEM_RELEASE)"), "munmap(pThunk, unThunkSize)", "FixtureMunmap(pThunk, unThunkSize)");
const g_strCreatePostThunk = ReplaceOnce(GetDefinition("CreatePostThunk", true), "AllocateExecutable(unThunkSize)", "FixtureAllocateExecutable(unThunkSize)");
const g_strCreateThunk = ReplaceOnce(ReplaceOnce(GetDefinition("CreateThunk", true), "mmap(nullptr, kThunkCodeSize, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0)", "FixtureMapMemory(nullptr, kThunkCodeSize, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0)"), "munmap(pThunk, kThunkCodeSize)", "FixtureMunmap(pThunk, kThunkCodeSize)");
const g_nSendPropertyStart = g_strBindings.indexOf("constinit thread_local bool g_bSendPropertyGameThread = false;");
const g_nSendPropertyEnd = g_strBindings.indexOf("\n\t\tvoid CreateFunctionHookCallback(", g_nSendPropertyStart);
g_Assert((g_nSendPropertyStart >= 0) && (g_nSendPropertyEnd > g_nSendPropertyStart), "Production SendProp dispatch bridge");
const g_vecInsertions = [
	["@POST_CONTEXT@", "\t// Generated only: native memory-hook thunk regression executable.\n" + g_vecContextMatch[0]],
	["@HELPERS@", GetDefinition("AllocateExecutable") + "\n\n" + GetDefinition("AppendU8") + "\n\n#if defined(DETOURS_ARCH_X86)\n" + GetDefinition("AppendU32LE") + "\n#else\n" + GetDefinition("AppendU64LE") + "\n#endif\n\n#if defined(_WIN32)\n" + GetDefinition("FreeExecutable") + "\n#endif"],
	["@X87_HELPERS@", GetDefinition("ReadX87ValueAsDouble") + "\n\n" + GetDefinition("WriteX87ValueFromDouble")],
	["@THUNKS@", g_strCreateThunk + "\n\n" + g_strCreatePostThunk + "\n\n" + g_strReleaseThunk],
	["@SEND_PROPERTY_DISPATCH@", g_strBindings.slice(g_nSendPropertyStart, g_nSendPropertyEnd)],
	["@RETURN_CONTEXT@", GetDefinition("LoadReturnContext", true) + "\n\n" + GetDefinition("StoreReturnContext", true)],
];
let g_strFixture = g_FileSystem.readFileSync(g_Path.join(g_strFixtureRoot, "MemoryHookThunkContracts.cpp"), "utf8");
for (const arrInsertion of g_vecInsertions) {
	g_strFixture = ReplaceOnce(g_strFixture, arrInsertion[0], arrInsertion[1]);
}

g_Assert(!/@[A-Z_]+@/.test(g_strFixture), "All actual-source insertion points resolved");

g_FileSystem.mkdirSync(g_Path.join(g_strRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strRoot, "build"));
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryHookThunks-"));
try {
	const strBridgeHeader = g_FileSystem.readFileSync(g_Path.join(g_strFixtureRoot, "MemoryHookThunkBridge.h"), "utf8");
	const strBridgeHeaderGuard = "#define _SOURCEJSMEMORYHOOKTHUNKBRIDGE_H_";
	g_Assert.equal(strBridgeHeader.split(strBridgeHeaderGuard).length, 2, "Unique copied bridge header guard");
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "MemoryHookThunkBridge.h"), strBridgeHeader.replace(strBridgeHeaderGuard, strBridgeHeaderGuard + "\n\n// Generated only: native memory-hook thunk bridge header copy."));

	for (const strProfile of g_vecProfiles) {
		// Negative controls alter only extracted code in the generated fixture.
		// x87 mutations keep the saved control/tag environment valid, changing
		// only ST0 through the checked production encoder rather than restoring
		// an invalid FPU image or deliberately crashing the native process.
		const strRead = (strProfile === "X86") ? "RawContextOut.m_FPU = PostContext.m_FPU;" : "RawContextOut.m_XMM0.m_f64[0] = PostContext.m_dblDouble;";
		const strBadRead = (strProfile === "X86") ? strRead + "\n\t\tWriteX87ValueFromDouble(0.0, &RawContextOut.m_FPU);" : "RawContextOut.m_XMM0.m_f64[0] = 0.0;";
		const strCommit = (strProfile === "X86") ? "PostContextOut.m_FPU = RawContext.m_FPU;" : "PostContextOut.m_dblDouble = RawContext.m_XMM0.m_f64[0];";
		const strBadCommit = (strProfile === "X86") ? strCommit + "\n\t\tWriteX87ValueFromDouble(0.0, &PostContextOut.m_FPU);" : "PostContextOut.m_dblDouble = 0.0;";
		const strReleaseDiagnostic = (process.platform === "win32") ? "ReleaseThunk failed Address=%p Size=%zu Error=0x%08lX" : "ReleaseThunk failed Address=%p Size=%zu Error=0x%08X";
		const strErrorCapture = ((process.platform === "win32") ? "const DWORD unError = GetLastError();" : "const int nError = errno;") + '\n\t\t\tLogError("ReleaseThunk failed';
		const strBadErrorCapture = ((process.platform === "win32") ? "const DWORD unError = 0;" : "const int nError = 0;") + '\n\t\t\tLogError("ReleaseThunk failed';
		const strBadDiagnostic = strReleaseDiagnostic.replace((process.platform === "win32") ? "Error=0x%08lX" : "Error=0x%08X", (process.platform === "win32") ? "Error=%lu" : "Error=%u");
		const vecCases = [
			{ Name: "Current", Source: g_strFixture, Status: 0 },
			{ Name: "FailedThunkSizeCommit", Source: ReplaceOnce(g_strFixture, "if (nHookID <= 0) {\n\t\t\treturn nullptr;", "if (nHookID <= 0) {\n\t\t\tunThunkSizeOut = 0;\n\t\t\treturn nullptr;"), Status: 1 },
			{ Name: "FailedPostThunkSizeCommit", Source: ReplaceOnce(g_strFixture, "std::vector<unsigned char> vecCode {};", "unThunkSizeOut = 0;\n\t\tstd::vector<unsigned char> vecCode {};"), Status: 1 },
			{ Name: "EmbeddedHookID", Source: ReplaceOnce(g_strFixture, "const std::uint32_t unEncodedHookID = static_cast<std::uint32_t>(nHookID);", "const std::uint32_t unEncodedHookID = static_cast<std::uint32_t>(nHookID) ^ std::uint32_t(1);"), Status: 1 },
			{ Name: "FloatingSnapshot", Source: ReplaceOnce(g_strFixture, strRead, strBadRead), Status: 1 },
			{ Name: "FloatingCommit", Source: ReplaceOnce(g_strFixture, strCommit, strBadCommit), Status: 1 },
			{ Name: "ReleaseDiagnostic", Source: ReplaceOnce(g_strFixture, strReleaseDiagnostic, strReleaseDiagnostic.replace("ReleaseThunk failed", "Missing release diagnostic")), Status: 1 },
			{ Name: "ReleaseErrorCode", Source: ReplaceOnce(g_strFixture, strErrorCapture, strBadErrorCapture), Status: 1 },
			{ Name: "ReleaseDiagnosticFields", Source: ReplaceOnce(g_strFixture, strReleaseDiagnostic, strBadDiagnostic), Status: 1 },
		];
		if (process.platform === "linux") {
			const strZeroAddressDiagnostic = 'LogError("CreateThunk cleanup failed Address=%p Size=%zu Error=0x%08X"';
			const strZeroAddressErrorCapture = 'const int nError = errno;\n\t\t\t\tLogError("CreateThunk cleanup failed';
			vecCases.push(
				{ Name: "ZeroAddressCleanupDiagnostic", Source: ReplaceOnce(g_strFixture, strZeroAddressDiagnostic, strZeroAddressDiagnostic.replace("CreateThunk cleanup failed", "Missing cleanup diagnostic")), Status: 1 },
				{ Name: "ZeroAddressCleanupErrorCode", Source: ReplaceOnce(g_strFixture, strZeroAddressErrorCapture, strZeroAddressErrorCapture.replace("nError = errno", "nError = 0")), Status: 1 },
				{ Name: "ZeroAddressCleanupDiagnosticFields", Source: ReplaceOnce(g_strFixture, strZeroAddressDiagnostic, strZeroAddressDiagnostic.replace("Error=0x%08X", "Error=%u")), Status: 1 },
			);
		}

		if ((process.platform === "linux") && (strProfile === "X86")) {
			vecCases.push({ Name: "RawStackAlignment", Source: ReplaceOnce(g_strFixture, "0x83, 0xE4, 0xF0,", "0x83, 0xE4, 0xFC,"), Status: 1 });
		}

		const strAssemblyName = (process.platform === "win32") ? "MemoryHookThunkBridge" + strProfile + ".asm" : "MemoryHookThunkBridge.S";
		const strAssemblySource = g_FileSystem.readFileSync(g_Path.join(g_strFixtureRoot, strAssemblyName), "utf8");
		const strAssemblyCommentPrefix = (process.platform === "win32") ? ";" : "//";
		g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, strAssemblyName), strAssemblyCommentPrefix + " Generated only: native memory-hook thunk assembly bridge copy.\n" + strAssemblySource);

		const strAssemblyLanguage = (process.platform === "win32") ? "ASM_MASM" : "ASM";
		let strCMake = `# Generated only: native memory-hook thunk regression build.
cmake_minimum_required(VERSION 3.20)
project(MemoryHookThunks LANGUAGES CXX ${strAssemblyLanguage})
`;
		for (const Case of vecCases) {
			g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, Case.Name + ".cpp"), Case.Source);
			strCMake += `add_executable(${Case.Name} ${Case.Name}.cpp ${strAssemblyName})
target_compile_features(${Case.Name} PRIVATE cxx_std_20)
target_include_directories(${Case.Name} SYSTEM PRIVATE "${g_strCMakeRoot}/thirdparty/Detours")
if(MSVC)
	target_compile_options(${Case.Name} PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:/W4;/WX;/EHsc;/permissive-;/Zc:__cplusplus>")
else()
	target_compile_options(${Case.Name} PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:-Wall;-Wextra;-Werror;-pedantic;-fsanitize=undefined;-fno-sanitize-recover=all>")
	target_link_options(${Case.Name} PRIVATE -no-pie -fsanitize=undefined)
endif()
`;
		}

		g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), strCMake);

		const strBinaryRoot = g_Path.join(g_strDirectory, strProfile);
		const vecConfigure = ["-S", g_strDirectory, "-B", strBinaryRoot];
		if (process.platform === "win32") {
			vecConfigure.push("-G", "Visual Studio 17 2022", "-A", (strProfile === "X86") ? "Win32" : "x64");
		} else {
			const strWidth = (strProfile === "X86") ? "-m32" : "-m64";
			vecConfigure.push("-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=" + strWidth + " -fno-pie", "-DCMAKE_ASM_FLAGS=" + strWidth + " -fno-pie", "-DCMAKE_EXE_LINKER_FLAGS=" + strWidth);
		}

		RequireBuild("cmake", vecConfigure, g_strRoot);
		RequireBuild("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"], g_strRoot);

		for (const Case of vecCases) {
			const strExecutable = g_Path.join(strBinaryRoot, (process.platform === "win32") ? "Release/" + Case.Name + ".exe" : Case.Name);
			if (Case.Status === 0) {
				VerifyFixtureCLI(strExecutable);
			}

			const Result = Run(strExecutable, [], g_strDirectory);
			g_Assert.equal(Result.status, Case.Status, strProfile + " " + Case.Name + " native thunk execution failed:\n" + Result.stdout + Result.stderr);

			if (Case.Status !== 0) {
				g_Assert(Result.stderr.includes("Memory hook thunk fixture:"), "Compiled control fails a runtime assertion, not initialization or a crash");
			}

			console.log(strProfile + " " + Case.Name + ": native thunk execution checked");
		}

		console.log(strProfile + ": native thunk contracts passed; " + (vecCases.length - 1) + " compiled negative controls.");
	}
} finally {
	const strResolved = g_FileSystem.realpathSync(g_strDirectory);
	g_Assert.equal(strResolved, g_strDirectory, "Cleanup keeps the exact created directory");
	g_Assert(!g_FileSystem.lstatSync(g_strDirectory).isSymbolicLink(), "Cleanup refuses a substituted link");
	g_Assert.equal(g_Path.dirname(strResolved), g_strBuildRoot, "Cleanup remains in actual build root");
	g_Assert(g_Path.basename(strResolved).startsWith("NativeMemoryHookThunks-") && (g_Path.basename(strResolved).length > "NativeMemoryHookThunks-".length), "Cleanup remains in owned fixture family");
	g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
}
