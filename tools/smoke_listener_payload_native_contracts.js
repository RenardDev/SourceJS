#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length !== 0) {
	const bHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	console.log("Usage: node tools/smoke_listener_payload_native_contracts.js [--help]");
	process.exit(bHelp ? 0 : 2);
}

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_unCommandTimeoutMilliseconds = 600_000;
const g_unFixtureCleanupRetries = 3;
const g_unFixtureCleanupRetryDelayMilliseconds = 100;
const g_unControlCharacterCount = 0x20;
const g_nNegativeGroupedInteger = -1_234_567;
const g_nPositiveGroupedInteger = 1_234_567;
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/ListenerPayload.cpp"), "utf8");
const g_vecMutations = [
	{ Name: "ClassicLocale", Old: "m_OutputStream.imbue(std::locale::classic());", New: "" },
	{ Name: "WriteFailure", Old: "m_OutputStream.exceptions(std::ios::badbit | std::ios::failbit);", New: "" },
	{ Name: "ControlEscapes", Old: "constexpr unsigned char kHexDigitMask = 0x0F;", New: "constexpr unsigned char kHexDigitMask = 0x07;" },
	{ Name: "ArraySeparators", Old: "if (unValueIndex > 0)", New: "if (unValueIndex > 1)" },
	{ Name: "SealedBuilder", Old: "if (m_bBuilt)", New: "if (false)" },
	{ Name: "AddressTag", Old: "$SourceJSBigInt", New: "$InvalidAddressTag" },
];
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", AddressBitCount: 32n, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", AddressBitCount: 64n, Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", AddressBitCount: 32n, Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", AddressBitCount: 64n, Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];
const g_strFixture = String.raw`
// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

// STL
#include <limits>
#include <locale>
#include <new>
#include <stdexcept>
#include <string>

// Project
#include "sourcejs/ListenerPayload.h"

// Generated only: native listener-payload regression executable.
namespace {
	// Single-threaded fixture-only allocation fault, never enabled during locale setup or diagnostics.
	bool g_bFailNextAllocation = false;
} // namespace

void* operator new(const std::size_t unSize) {
	if (g_bFailNextAllocation) {
		g_bFailNextAllocation = false;
		throw std::bad_alloc();
	}

	void* const pAddress = std::malloc(unSize ? unSize : 1);
	if (!pAddress) {
		throw std::bad_alloc();
	}

	return pAddress;
}

void operator delete(void* const pAddress) noexcept {
	std::free(pAddress);
}

void operator delete(void* const pAddress, std::size_t) noexcept {
	std::free(pAddress);
}

namespace {
	// Override names are the exact STL locale-facet contract.
	class GroupedNumberPunctuation final : public std::numpunct<char> {
	protected:
		char do_thousands_sep() const override;
		std::string do_grouping() const override;
	};

	class GlobalLocaleScope {
	public:
		explicit GlobalLocaleScope(std::locale const& Locale);
		~GlobalLocaleScope() noexcept;
		GlobalLocaleScope(GlobalLocaleScope const&) = delete;
		GlobalLocaleScope(GlobalLocaleScope&&) = delete;
		GlobalLocaleScope& operator=(GlobalLocaleScope const&) = delete;
		GlobalLocaleScope& operator=(GlobalLocaleScope&&) = delete;

	private:
		std::locale m_PreviousLocale;
	};

	char GroupedNumberPunctuation::do_thousands_sep() const {
		return ',';
	}

	std::string GroupedNumberPunctuation::do_grouping() const {
		return "\x03";
	}

	GlobalLocaleScope::GlobalLocaleScope(std::locale const& Locale) :
		m_PreviousLocale(std::locale::global(Locale))
	{
	}

	GlobalLocaleScope::~GlobalLocaleScope() noexcept {
		try {
			std::locale::global(m_PreviousLocale);
		} catch (...) {
			// Best-effort diagnostic before an unrecoverable fixture-process abort.
			std::fputs("[native] listener-payload failure: global locale restoration failed\n", stderr);
			std::abort();
		}
	}

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	template <typename TOperation>
	void RequireSealed(TOperation const& Operation) {
		bool bRejected = false;

		try {
			Operation();
		} catch (std::logic_error const&) {
			bRejected = true;
		}

		Require(bRejected, "sealed builder rejected mutation");
	}

	std::string RunJSONContracts() {
		constexpr int kControlCharacterCount = 0x20;
		constexpr int kNegativeGroupedInteger = -1'234'567;
		constexpr int kPositiveGroupedInteger = 1'234'567;
		constexpr char kControlEscapes[] = R"(\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f)";

		SourceJS::ListenerPayloadBuilder Empty {};
		Require(Empty.Build() == "{\"Arguments\":[]}", "empty payload");
		Require(Empty.Build() == "{\"Arguments\":[]}", "idempotent empty build");
		RequireSealed([&Empty]() {
			Empty.AddString("");
		});
		RequireSealed([&Empty]() {
			Empty.AddInteger(0);
		});
		RequireSealed([&Empty]() {
			Empty.AddIntegerArray({});
		});
		RequireSealed([&Empty]() {
			Empty.AddAddress(nullptr);
		});

		SourceJS::ListenerPayloadBuilder EmptyString {};
		EmptyString.AddString("");
		Require(EmptyString.Build() == "{\"Arguments\":[\"\"]}", "empty string quoting");

		SourceJS::ListenerPayloadBuilder Bounds {};
		Bounds.AddInteger(std::numeric_limits<int>::min());
		Bounds.AddInteger(std::numeric_limits<int>::max());
		Require(Bounds.Build() == ("{\"Arguments\":[" + std::to_string(std::numeric_limits<int>::min()) + "," + std::to_string(std::numeric_limits<int>::max()) + "]}"), "integer bounds");

		std::locale const GroupedLocale = std::locale(std::locale::classic(), new GroupedNumberPunctuation());
		GlobalLocaleScope LocaleScope(GroupedLocale);
		SourceJS::ListenerPayloadBuilder Payload {};
		Payload.AddInteger(kNegativeGroupedInteger);
		Payload.AddInteger(kPositiveGroupedInteger);
		Payload.AddIntegerArray({ kNegativeGroupedInteger, 0, kPositiveGroupedInteger });

		std::string strCharacters {};
		for (int nCharacter = 0; nCharacter < kControlCharacterCount; ++nCharacter) {
			strCharacters.push_back(static_cast<char>(nCharacter));
		}

		strCharacters += "\\\"/ \xE2\x82\xAC \xF0\x9F\x98\x80";
		Payload.AddString(strCharacters);
		Payload.AddIntegerArray({});
		Payload.AddAddress(nullptr);

		// x86/x64 address-representation boundary only: the synthesized address is never dereferenced.
		const std::uintptr_t unMaximumAddress = std::numeric_limits<std::uintptr_t>::max();
		Payload.AddAddress(reinterpret_cast<void const*>(unMaximumAddress));
		std::string const strPayload = Payload.Build();
		Require(strPayload.starts_with("{\"Arguments\":[-1234567,1234567,[-1234567,0,1234567],"), "locale-independent numbers and array separators");
		Require(strPayload.find(kControlEscapes) != std::string::npos, "all control-character escapes");
		Require(strPayload.ends_with("{\"$SourceJSBigInt\":\"" + std::to_string(unMaximumAddress) + "\"}]}"), "exact native-width address tag");
		Require(Payload.Build() == strPayload, "idempotent populated build");

		return strPayload;
	}

	void RunAllocationFailureContracts() {
		constexpr std::size_t kFaultPayloadByteCount = 8'192;

		SourceJS::ListenerPayloadBuilder Payload {};
		std::string const strLargePayload = std::string(kFaultPayloadByteCount, 'X');
		bool bWriteFailed = false;
		g_bFailNextAllocation = true;
		try {
			Payload.AddString(strLargePayload);
		} catch (std::exception const&) {
			bWriteFailed = true;
		}

		const bool bAllocationIntercepted = !g_bFailNextAllocation;
		g_bFailNextAllocation = false;
		Require(bAllocationIntercepted && bWriteFailed, "actual stream allocation failure propagated");

		bool bBuildRejected = false;
		try {
			Payload.Build();
		} catch (std::exception const&) {
			bBuildRejected = true;
		}

		Require(bBuildRejected, "failed stream never returned a partial payload");
	}
} // namespace

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fputs("Usage: ListenerPayloadContracts\n", stderr);
		return 2;
	}

	try {
		std::string const strPayload = RunJSONContracts();
		RunAllocationFailureContracts();
		std::puts(strPayload.c_str());
		std::puts("[native] listener payload framing, integers, Unicode, controls, addresses, locale and allocation-failure scenarios passed");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "[native] listener-payload failure: %s\n", Exception.what());
		return 1;
	}
}
`;

g_Assert(["win32", "linux"].includes(process.platform), "Native listener payload tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native listener payload tests require x86/x64 compiler profiles.");
g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeListenerPayload-"));

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));
}

function RunFixtureCommand(strProgram, vecArguments) {
	let strExecutionProgram = strProgram;
	if (process.platform === "win32") {
		const strRealProgram = g_FileSystem.realpathSync(strProgram);
		const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
		const strRelativeProgramPath = g_Path.relative(strRealTemporaryRoot, strRealProgram);
		g_Assert.match(strRelativeProgramPath, /^(?:Win32|X64)[/\\]Release[/\\]ListenerPayloadContracts\.exe$/, "Execution copies must stay within this private fixture build");

		// Keep the link output unexecuted; Windows can retain image mappings after process exit.
		const strExecutionDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_Path.dirname(strRealProgram), "Run-"));
		strExecutionProgram = g_Path.join(strExecutionDirectory, g_Path.basename(strRealProgram));
		g_FileSystem.copyFileSync(strRealProgram, strExecutionProgram, g_FileSystem.constants.COPYFILE_EXCL);
	}

	return g_ChildProcess.spawnSync(strExecutionProgram, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
}

function RunFixture(strProgram, bRegression, Profile) {
	const Result = RunFixtureCommand(strProgram, []);
	g_Assert.equal(Result.status, bRegression ? 1 : 0, Result.error?.message ?? (Result.stdout + Result.stderr));

	if (bRegression) {
		g_Assert.match(Result.stderr, /\[native\] listener-payload failure:/, "Compiled regression must fail a native assertion.");
		return;
	}

	g_Assert.match(Result.stdout, /\[native\] listener payload framing, integers, Unicode, controls, addresses, locale and allocation-failure scenarios passed/);
	const vecJSONLines = Result.stdout.split(/\r?\n/).filter((strLine) => strLine.startsWith("{"));
	g_Assert.equal(vecJSONLines.length, 1);

	const Payload = JSON.parse(vecJSONLines[0]);
	g_Assert.deepEqual(Object.keys(Payload), ["Arguments"]);
	g_Assert.equal(Payload.Arguments.length, 7);
	g_Assert.deepEqual(Payload.Arguments.slice(0, 3), [g_nNegativeGroupedInteger, g_nPositiveGroupedInteger, [g_nNegativeGroupedInteger, 0, g_nPositiveGroupedInteger]]);

	let strExpectedCharacters = "";
	for (let unCharacter = 0; unCharacter < g_unControlCharacterCount; ++unCharacter) {
		strExpectedCharacters += String.fromCharCode(unCharacter);
	}

	g_Assert.equal(Payload.Arguments[3], strExpectedCharacters + '\\"/ € 😀');
	g_Assert.deepEqual(Payload.Arguments[4], []);
	g_Assert.deepEqual(Payload.Arguments[5], { $SourceJSBigInt: "0" });
	g_Assert.deepEqual(Object.keys(Payload.Arguments[6]), ["$SourceJSBigInt"]);
	g_Assert.equal(BigInt(Payload.Arguments[6].$SourceJSBigInt), (1n << Profile.AddressBitCount) - 1n);
}

function VerifyFixtureCLI(strProgram) {
	const Result = RunFixtureCommand(strProgram, ["UnexpectedArgument"]);
	g_Assert.equal(Result.status, 2, Result.error?.message ?? (Result.stdout + Result.stderr));
	g_Assert.equal(Result.signal, null);
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), "Usage: ListenerPayloadContracts\n");
}

let g_unRejectedMutationCount = 0;
try {
	const strSourceNamespaceAnchor = "\nnamespace SourceJS {";
	g_Assert.equal(g_strSource.split(strSourceNamespaceAnchor).length, 2, "Unique production namespace anchor for the generated-only notice.");
	const strGeneratedSource = g_strSource.replace(strSourceNamespaceAnchor, "\n// Generated only: production listener-payload copy for native regression checks.\nnamespace SourceJS {");

	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ListenerPayloadContracts.cpp"), g_strFixture);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native listener-payload regression build.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(ListenerPayloadContracts LANGUAGES CXX)",
		"add_executable(ListenerPayloadContracts ListenerPayloadContracts.cpp ListenerPayload.cpp)",
		"target_compile_features(ListenerPayloadContracts PRIVATE cxx_std_20)",
		"target_include_directories(ListenerPayloadContracts PRIVATE \"" + g_Path.join(g_strProjectRoot, "src").replace(/\\/g, "/").replace(/"/g, '\\"') + "\")",
		"if(MSVC)",
		"\ttarget_compile_options(ListenerPayloadContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(ListenerPayloadContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		const strSourcePath = g_Path.join(g_strTemporaryRoot, "ListenerPayload.cpp");
		g_FileSystem.writeFileSync(strSourcePath, strGeneratedSource);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/ListenerPayloadContracts.exe") : g_Path.join(strBinaryRoot, "ListenerPayloadContracts");
		RunFixture(strProgram, false, Profile);
		VerifyFixtureCLI(strProgram);

		for (const Mutation of g_vecMutations) {
			g_Assert.equal(g_strSource.split(Mutation.Old).length, 2, Mutation.Name);
			g_FileSystem.writeFileSync(strSourcePath, strGeneratedSource.replace(Mutation.Old, () => Mutation.New));
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			RunFixture(strProgram, true, Profile);
			++g_unRejectedMutationCount;
		}

		g_FileSystem.writeFileSync(strSourcePath, strGeneratedSource);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		RunFixture(strProgram, false, Profile);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeListenerPayload-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true, maxRetries: g_unFixtureCleanupRetries, retryDelay: g_unFixtureCleanupRetryDelayMilliseconds });
}

console.log("Listener payload native checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; actual production implementation/header, JSON parsed by JavaScript, native allocation failure injected; V8/live server not exercised; temporary build cleaned.");
