#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length !== 0) {
	const bHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	console.log("Usage: node tools/smoke_memory_call_abi.js [--help]");
	process.exit(bHelp ? 0 : 2);
}

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/MemoryHookManager.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/MemoryHookManager.h"), "utf8").replace(/\r\n/g, "\n");
const g_unCommandTimeoutMilliseconds = 600_000;
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32"] },
	{ Name: "X64", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64"] },
];

// Executes real Detours with the extracted argument preparation, not a live V8/game server.
const g_strFixture = String.raw`
// General
#if defined(_WIN32)
#if !defined(WIN32_LEAN_AND_MEAN)
#define WIN32_LEAN_AND_MEAN
#define SOURCEJS_ABI_UNDEFINE_WIN32_LEAN_AND_MEAN
#endif
#if !defined(NOMINMAX)
#define NOMINMAX
#define SOURCEJS_ABI_UNDEFINE_NOMINMAX
#endif
#include <Windows.h>
#include <intrin.h>
#include <winternl.h>
#if defined(SOURCEJS_ABI_UNDEFINE_NOMINMAX)
#undef NOMINMAX
#undef SOURCEJS_ABI_UNDEFINE_NOMINMAX
#endif
#if defined(SOURCEJS_ABI_UNDEFINE_WIN32_LEAN_AND_MEAN)
#undef WIN32_LEAN_AND_MEAN
#undef SOURCEJS_ABI_UNDEFINE_WIN32_LEAN_AND_MEAN
#endif
#else
#include <sys/mman.h>
#include <unistd.h>
#endif

// C++
#include <cerrno>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// STL
#include <algorithm>
#include <bit>
#include <limits>
#include <map>
#include <string>
#include <vector>

// Third-party
#include <Detours.h>

#if defined(DETOURS_ARCH_X86) && defined(_MSC_VER)
#define SOURCEJS_ABI_FASTCALL __fastcall
#define SOURCEJS_ABI_STDCALL __stdcall
#define SOURCEJS_ABI_THISCALL __thiscall
#elif defined(DETOURS_ARCH_X86)
#define SOURCEJS_ABI_FASTCALL __attribute__((fastcall))
#define SOURCEJS_ABI_STDCALL __attribute__((stdcall))
#define SOURCEJS_ABI_THISCALL __attribute__((thiscall))
#else
#define SOURCEJS_ABI_FASTCALL
#define SOURCEJS_ABI_STDCALL
#define SOURCEJS_ABI_THISCALL
#endif

#if defined(_MSC_VER)
#define SOURCEJS_ABI_FRAME_ADDRESS() _AddressOfReturnAddress()
#else
#define SOURCEJS_ABI_FRAME_ADDRESS() __builtin_frame_address(0)
#endif

// Generated only: memory-call ABI regression executable with current production helpers.
namespace SourceJS {
	namespace {
@ARGUMENT_RECORDS@

		// Compatibility profile: preserve the production boundary enum's tag/base/aliases (guide 2.5/9.5).
@DATA_TYPE@

@REQUEST_RECORD@

@REQUEST_CONSTRUCTOR@

		constexpr std::uint64_t kFirstWideValue = 0x0123456789ABCDEF;
		constexpr std::uint64_t kSecondWideValue = 0xFEDCBA9876543210;
		constexpr std::uint64_t kReturnMarker = 0xABCD1234FEDC5678;
#if defined(DETOURS_ARCH_X86)
		constexpr std::size_t kX87StateByteCount = sizeof(Detours::Hook::RAW_CONTEXT_FPU);
		constexpr std::size_t kX87StateAlignment = 16;
#endif

		std::size_t g_unInvocations = 0;
		char const* g_pszProbeFailure = nullptr;
		float g_flObservedFirstArgument = 0.0f;
		std::uint32_t g_unObservedSecondArgument = 0;
		double g_dblObservedThirdArgument = 0.0;
		std::uint64_t g_unObservedFourthArgument = 0;

		void Check(const bool bCondition, char const* const pszMessage) {
			if (!bCondition) {
				std::fprintf(stderr, "MEMORY_CALL_ABI_ASSERTION_FAILED: %s\n", pszMessage);
				std::exit(EXIT_FAILURE);
			}
		}

		void LogError(char const* const pszMessage, ...) {
			std::va_list ArgumentList;
			va_start(ArgumentList, pszMessage);
			std::fputs("MEMORY_CALL_ABI_CLEANUP_FAILED: ", stderr);
			std::vfprintf(stderr, pszMessage, ArgumentList);
			va_end(ArgumentList);
			std::fputc('\n', stderr);
			std::exit(EXIT_FAILURE);
		}

		// Never terminate the process from Detours' mirrored stack on a probe failure.
		void CheckProbe(const bool bCondition, char const* const pszMessage) noexcept {
			if (!bCondition && !g_pszProbeFailure) {
				g_pszProbeFailure = pszMessage;
			}
		}

		void CheckNativeStackAlignment(void* const pFrame) noexcept {
			constexpr std::size_t kNativeStackAlignment = 16;
#if defined(_MSC_VER)
			constexpr std::size_t kExpectedOffset = kNativeStackAlignment - sizeof(void*);
#else
			constexpr std::size_t kExpectedOffset = (kNativeStackAlignment - (2 * sizeof(void*))) % kNativeStackAlignment;
#endif

			const std::size_t unAlignmentOffset = reinterpret_cast<std::uintptr_t>(pFrame) % kNativeStackAlignment;
			CheckProbe(unAlignmentOffset == kExpectedOffset, "native stack alignment preserved");
		}

@STACK_STORAGE@

@PREPARATION@

#if defined(DETOURS_ARCH_X86)
@X87_READER@
#endif

		std::uint64_t ReadIntegerResult(Detours::Hook::RAW_CONTEXT const& Context) noexcept {
#if defined(DETOURS_ARCH_X64)
			return static_cast<std::uint64_t>(Context.m_unRAX);
#else
			constexpr unsigned int kHighWordBits = 32;

			return (static_cast<std::uint64_t>(Context.m_unEDX) << kHighWordBits) | Context.m_unEAX;
#endif
		}

		double ReadDoubleResult(Detours::Hook::RAW_CONTEXT const& Context) noexcept {
#if defined(DETOURS_ARCH_X64)
			double dblValue = 0.0;
			std::memcpy(&dblValue, &Context.m_ZMM0, sizeof(dblValue));

			return dblValue;
#else
			return ReadX87ValueAsDouble(&Context.m_FPU.m_Registers[0]);
#endif
		}

		NativeCallArgument IntegerArgument(const std::uint64_t unValue) noexcept {
			return { unValue, NativeCallArgumentKind::Integer };
		}

		NativeCallArgument WideArgument(const std::uint64_t unValue) noexcept {
			return { unValue, NativeCallArgumentKind::WideInteger };
		}

		NativeCallArgument FloatArgument(const float flValue) noexcept {
			return { std::bit_cast<std::uint32_t>(flValue), NativeCallArgumentKind::Float };
		}

		NativeCallArgument DoubleArgument(const double dblValue) noexcept {
			return { std::bit_cast<std::uint64_t>(dblValue), NativeCallArgumentKind::Double };
		}

		std::uint64_t ScalarProbe(const float flA, const std::uint32_t unB, const double dblC, const std::uint64_t unD, const float flE, const std::uint32_t unF, const double dblG, const std::uint64_t unH, const double dblI, const double dblJ, const double dblK, const double dblL, const double dblM) {
			CheckNativeStackAlignment(SOURCEJS_ABI_FRAME_ADDRESS());
			++g_unInvocations;
			g_flObservedFirstArgument = flA;
			g_unObservedSecondArgument = unB;
			g_dblObservedThirdArgument = dblC;
			g_unObservedFourthArgument = unD;
			CheckProbe((flA == 1.25f) && (unB == 17) && (dblC == 2.5) && (unD == kFirstWideValue), "initial mixed arguments");
			CheckProbe((flE == 3.75f) && (unF == 29) && (dblG == 4.5) && (unH == kSecondWideValue), "mixed GPR/stack arguments");
			CheckProbe((dblI == 5.5) && (dblJ == 6.5) && (dblK == 7.5) && (dblL == 8.5) && (dblM == 9.5), "floating register exhaustion and stack spill");

			return kReturnMarker;
		}

		std::uint64_t IntegerProbe(const std::uint64_t unA, const std::uint64_t unB, const std::uint64_t unC, const std::uint64_t unD, const std::uint64_t unE, const std::uint64_t unF, const std::uint64_t unG, const std::uint64_t unH) {
			CheckNativeStackAlignment(SOURCEJS_ABI_FRAME_ADDRESS());
			++g_unInvocations;
			CheckProbe((unA == kFirstWideValue) && (unB == kSecondWideValue) && (unC == 3) && (unD == 4) && (unE == 5) && (unF == 6) && (unG == 7) && (unH == kReturnMarker), "wide integer registers and stack spill");

			return kReturnMarker;
		}

		std::uint64_t SOURCEJS_ABI_FASTCALL FastcallProbe(const float flA, const std::uint64_t unB, const std::uint32_t unC, const double dblD, const std::uint32_t unE, const std::uint64_t unF) {
			CheckNativeStackAlignment(SOURCEJS_ABI_FRAME_ADDRESS());
			++g_unInvocations;
			CheckProbe((flA == 1.25f) && (unB == kFirstWideValue) && (unC == 17) && (dblD == 2.5) && (unE == 29) && (unF == kSecondWideValue), "fastcall skips floating/wide register candidates");

			return kReturnMarker;
		}

		std::uint64_t SOURCEJS_ABI_STDCALL StdcallProbe(const float flA, const std::uint64_t unB, const std::uint32_t unC, const double dblD, const std::uint32_t unE, const std::uint64_t unF) {
			CheckNativeStackAlignment(SOURCEJS_ABI_FRAME_ADDRESS());
			++g_unInvocations;
			CheckProbe((flA == 1.25f) && (unB == kFirstWideValue) && (unC == 17) && (dblD == 2.5) && (unE == 29) && (unF == kSecondWideValue), "stdcall complete stack arguments");

			return kReturnMarker;
		}

		std::uint64_t VariadicProbe(const unsigned int unCount, ...) {
			CheckNativeStackAlignment(SOURCEJS_ABI_FRAME_ADDRESS());
			++g_unInvocations;

			std::va_list ArgumentList;
			va_start(ArgumentList, unCount);

			for (unsigned int unIndex = 0; unIndex < unCount; ++unIndex) {
				const double dblValue = va_arg(ArgumentList, double);
				CheckProbe(dblValue == (static_cast<double>(unIndex) + 0.5), "variadic SIMD/GPR mirrors and stack spill");
			}

			va_end(ArgumentList);

			return kReturnMarker;
		}

		double DoubleProbe(const float flValue, const double dblValue) {
			CheckNativeStackAlignment(SOURCEJS_ABI_FRAME_ADDRESS());
			++g_unInvocations;
			CheckProbe((flValue == 1.25f) && (dblValue == 9.5), "floating return arguments");

			return static_cast<double>(flValue) + dblValue;
		}

		class MemberProbe {
		public:
			MemberProbe();
			virtual std::uint64_t SOURCEJS_ABI_THISCALL Invoke(const float flValue, const std::uint64_t unValue, const std::uint32_t unCount);

		private:
			std::uint64_t m_unValue;
		};

		MemberProbe::MemberProbe() {
			m_unValue = kSecondWideValue;
		}

		std::uint64_t SOURCEJS_ABI_THISCALL MemberProbe::Invoke(const float flValue, const std::uint64_t unValue, const std::uint32_t unCount) {
			CheckNativeStackAlignment(SOURCEJS_ABI_FRAME_ADDRESS());
			++g_unInvocations;
			CheckProbe((m_unValue == kSecondWideValue) && (flValue == 1.25f) && (unValue == kFirstWideValue) && (unCount == 17), "thiscall object and complete stack arguments");

			return kReturnMarker;
		}

		Detours::Hook::RAW_CONTEXT Invoke(void* const pAddress, NativeCallRequest const& Request) {
			NativeCallStackStorage Storage {};
			Check(Storage.Allocate(), "native call stack allocated");

			Detours::Hook::RAW_CONTEXT Context {};
			Detours::Hook::GetCurrentContext(&Context);
			std::size_t unStackArgumentBytes = 0;
			Check(ConfigureNativeCallContext(Request, Storage, Context, unStackArgumentBytes), "native call context configured");

			const std::size_t unPreviousInvocations = g_unInvocations;
			std::fprintf(stderr, "MEMORY_CALL_ABI_CALL: Index=%zu Convention=%s\n", unPreviousInvocations, Request.m_strConvention.c_str());
			Detours::Hook::CallAddress(pAddress, &Context);

			if (g_pszProbeFailure) {
				std::fprintf(stderr, "Last mixed-scalar probe: Float=%.9g Integer=%u Double=%.17g Wide=0x%016llX\n", static_cast<double>(g_flObservedFirstArgument), g_unObservedSecondArgument, g_dblObservedThirdArgument, static_cast<unsigned long long>(g_unObservedFourthArgument));
				Check(false, g_pszProbeFailure);
			}

			Check(g_unInvocations == (unPreviousInvocations + 1), "real target invoked exactly once");

			// Returned registers are independent values; the copied stack address is not used.
			Context.m_Stack.SetAddress(nullptr);

			return Context;
		}
	} // namespace

	void RunTests() {
		constexpr unsigned int kVariadicArgumentCount = 9;
		constexpr std::size_t kMaximumCopiedStackBytes = HOOK_RAW_CALL_MAXIMUM_STACK_SIZE / 4;
#if defined(DETOURS_ARCH_X64) && defined(_WIN32)
		constexpr std::size_t kFixedVariadicStackBytes = (1 + 4) * sizeof(std::uint64_t);
		constexpr std::size_t kVariadicRegisterArgumentCount = 3;
#elif defined(DETOURS_ARCH_X64)
		constexpr std::size_t kFixedVariadicStackBytes = sizeof(std::uint64_t);
		constexpr std::size_t kVariadicRegisterArgumentCount = 8;
#else
		constexpr std::size_t kFixedVariadicStackBytes = 2 * sizeof(std::uint32_t);
		constexpr std::size_t kVariadicRegisterArgumentCount = 0;
#endif
		constexpr std::size_t kMaximumVariadicArgumentCount = kVariadicRegisterArgumentCount + ((kMaximumCopiedStackBytes - kFixedVariadicStackBytes) / sizeof(double));

		static_assert(kMaximumCopiedStackBytes >= kFixedVariadicStackBytes);
		static_assert(kMaximumVariadicArgumentCount <= std::numeric_limits<unsigned int>::max());

		NativeCallRequest Request {};
		Request.m_strConvention = "cdecl";
		Request.m_vecArguments = { FloatArgument(1.25f), IntegerArgument(17), DoubleArgument(2.5), WideArgument(kFirstWideValue), FloatArgument(3.75f), IntegerArgument(29), DoubleArgument(4.5), WideArgument(kSecondWideValue), DoubleArgument(5.5), DoubleArgument(6.5), DoubleArgument(7.5), DoubleArgument(8.5), DoubleArgument(9.5) };
		Check(ReadIntegerResult(Invoke(reinterpret_cast<void*>(&ScalarProbe), Request)) == kReturnMarker, "mixed scalar result");

		Request.m_vecArguments = { WideArgument(kFirstWideValue), WideArgument(kSecondWideValue), WideArgument(3), WideArgument(4), WideArgument(5), WideArgument(6), WideArgument(7), WideArgument(kReturnMarker) };
		Check(ReadIntegerResult(Invoke(reinterpret_cast<void*>(&IntegerProbe), Request)) == kReturnMarker, "wide integer result");

		Request.m_vecArguments = { FloatArgument(1.25f), WideArgument(kFirstWideValue), IntegerArgument(17), DoubleArgument(2.5), IntegerArgument(29), WideArgument(kSecondWideValue) };
		Request.m_strConvention = "fastcall";
		Check(ReadIntegerResult(Invoke(reinterpret_cast<void*>(&FastcallProbe), Request)) == kReturnMarker, "fastcall result");

		Request.m_strConvention = "stdcall";
		Check(ReadIntegerResult(Invoke(reinterpret_cast<void*>(&StdcallProbe), Request)) == kReturnMarker, "stdcall result");

		Request.m_strConvention = "cdecl";
		Request.m_vecArguments = { IntegerArgument(kVariadicArgumentCount) };
		for (unsigned int unIndex = 0; unIndex < kVariadicArgumentCount; ++unIndex) {
			Request.m_vecArguments.push_back(DoubleArgument(static_cast<double>(unIndex) + 0.5));
		}

		Check(ReadIntegerResult(Invoke(reinterpret_cast<void*>(&VariadicProbe), Request)) == kReturnMarker, "variadic result");

		Request.m_vecArguments = { IntegerArgument(kMaximumVariadicArgumentCount) };
		for (std::size_t unIndex = 0; unIndex < kMaximumVariadicArgumentCount; ++unIndex) {
			Request.m_vecArguments.push_back(DoubleArgument(static_cast<double>(unIndex) + 0.5));
		}

		Check(ReadIntegerResult(Invoke(reinterpret_cast<void*>(&VariadicProbe), Request)) == kReturnMarker, "exact actual Detours copied-stack capacity");

		Request.m_vecArguments.push_back(DoubleArgument(0.5));
		NativeCallStackStorage OverflowStorage {};
		Check(OverflowStorage.Allocate(), "overflow test stack allocated");

		Detours::Hook::RAW_CONTEXT OverflowContext {};
		std::size_t unOverflowStackBytes = 0;
		Check(!ConfigureNativeCallContext(Request, OverflowStorage, OverflowContext, unOverflowStackBytes), "reject arguments exceeding actual Detours copy limit");

		Request.m_vecArguments = { FloatArgument(1.25f), DoubleArgument(9.5) };
		Check(ReadDoubleResult(Invoke(reinterpret_cast<void*>(&DoubleProbe), Request)) == 10.75, "actual floating return register");

		MemberProbe Probe {};
		// Supported MSVC/Itanium single-vptr ABI: copy representation, not a type-punned dereference.
		void const* pVTable = nullptr;
		std::memcpy(&pVTable, &Probe, sizeof(pVTable));
		void* pAddress = nullptr;
		std::memcpy(&pAddress, pVTable, sizeof(pAddress));
		Request.m_strConvention = "thiscall";
		Request.m_vecArguments = { IntegerArgument(reinterpret_cast<std::uintptr_t>(&Probe)), FloatArgument(1.25f), WideArgument(kFirstWideValue), IntegerArgument(17) };
		Check(ReadIntegerResult(Invoke(pAddress, Request)) == kReturnMarker, "real member-function result");
	}
} // namespace SourceJS

#undef SOURCEJS_ABI_FASTCALL
#undef SOURCEJS_ABI_STDCALL
#undef SOURCEJS_ABI_THISCALL
#undef SOURCEJS_ABI_FRAME_ADDRESS

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fputs("Usage: MemoryCallABI\n", stderr);
		return 2;
	}

	SourceJS::RunTests();
	std::puts("MEMORY_CALL_ABI_NATIVE_PASS");

	return EXIT_SUCCESS;
}
`;

const g_strRequestFixture = String.raw`
// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

// STL
#include <map>
#include <new>
#include <string>
#include <type_traits>
#include <vector>

// Generated only: actual production request construction; no V8/game-server execution.
#if defined(_MSC_VER)
namespace {
	// Single-threaded fixture: fail only the next allocation during request construction.
	bool g_bFailNextAllocation = false;
} // namespace

void* operator new(const std::size_t unSize) {
	if (g_bFailNextAllocation) {
		g_bFailNextAllocation = false;
		throw std::bad_alloc();
	}

	void* const pStorage = std::malloc(unSize ? unSize : 1);
	if (!pStorage) {
		throw std::bad_alloc();
	}

	return pStorage;
}

void operator delete(void* const pStorage) noexcept {
	std::free(pStorage);
}

void operator delete(void* const pStorage, std::size_t) noexcept {
	std::free(pStorage);
}
#endif

namespace SourceJS {
	namespace {
@ARGUMENT_RECORDS@

		// Compatibility profile: preserve the production boundary enum's tag/base/aliases (guide 2.5/9.5).
@DATA_TYPE@

@REQUEST_RECORD@

@REQUEST_CONSTRUCTOR@

		static_assert(!std::is_nothrow_default_constructible_v<NativeCallRequest>, "Request construction must permit allocation failure.");

		void Check(const bool bCondition, char const* const pszMessage) {
			if (!bCondition) {
				std::fprintf(stderr, "MEMORY_CALL_REQUEST_ASSERTION_FAILED: %s\n", pszMessage);
				std::exit(EXIT_FAILURE);
			}
		}
	} // namespace

	void RunRequestTests() {
		NativeCallRequest Request {};
		Check((Request.m_pAddress == nullptr) && (Request.m_ReturnType == DATA_TYPE_VOID) && !Request.m_bCallerCleanup, "request scalar defaults");
		Check(Request.m_strConvention.empty() && Request.m_vecArguments.empty() && Request.m_mapRegisters.empty(), "request container defaults");
#if defined(_MSC_VER)
		// MSVC std::map allocates its sentinel in the default constructor.
		bool bCaughtAllocationFailure = false;
		g_bFailNextAllocation = true;
		try {
			NativeCallRequest FailedRequest {};
			Check(FailedRequest.m_pAddress == nullptr, "constructed request remains initialized");
		} catch (std::bad_alloc const&) {
			bCaughtAllocationFailure = true;
		}

		const bool bAllocationAttempted = !g_bFailNextAllocation;
		g_bFailNextAllocation = false;
		Check(bAllocationAttempted && bCaughtAllocationFailure, "actual request allocation failure propagates without termination");
#endif
	}
} // namespace SourceJS

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fputs("Usage: MemoryCallRequest\n", stderr);
		return 2;
	}

	SourceJS::RunRequestTests();
	std::puts("MEMORY_CALL_REQUEST_NATIVE_PASS");

	return EXIT_SUCCESS;
}
`;

function GetDefinition(strName) {
	const nStartIndex = g_strSource.search(new RegExp("^\\t\\t(?:bool|double) " + strName + "\\(", "m"));
	const strEndBoundary = "\n\t\t}";
	const nEndIndex = g_strSource.indexOf(strEndBoundary, nStartIndex);
	g_Assert((nStartIndex >= 0) && (nEndIndex > nStartIndex), "Missing helper: " + strName);

	return g_strSource.slice(nStartIndex, nEndIndex + strEndBoundary.length);
}

function SliceBetween(strStartBoundary, strEndBoundary, strSource = g_strSource) {
	const nStartIndex = strSource.indexOf(strStartBoundary);
	const nEndIndex = strSource.indexOf(strEndBoundary, nStartIndex);
	g_Assert((nStartIndex >= 0) && (nEndIndex > nStartIndex), "Missing source boundary: " + strStartBoundary);

	return strSource.slice(nStartIndex, nEndIndex);
}

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", timeout: g_unCommandTimeoutMilliseconds, windowsHide: true });
	g_Assert(!Result.error, Result.error?.message);

	return Result;
}

function RequireSuccess(strCommand, vecArguments) {
	const Result = Run(strCommand, vecArguments);
	g_Assert.equal(Result.status, 0, "Status=" + Result.status + " Signal=" + Result.signal + "\n" + Result.stdout + Result.stderr);

	return Result;
}

function VerifyFixtureCLI(strProgram, strName = "MemoryCallABI") {
	const Result = Run(strProgram, ["UnexpectedArgument"]);
	g_Assert.equal(Result.status, 2);
	g_Assert.equal(Result.signal, null);
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), "Usage: " + strName + "\n");
}

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryCallABI-"));

try {
	for (const strPlaceholder of ["@ARGUMENT_RECORDS@", "@DATA_TYPE@", "@REQUEST_RECORD@", "@REQUEST_CONSTRUCTOR@", "@STACK_STORAGE@", "@PREPARATION@", "@X87_READER@"]) {
		g_Assert.equal(g_strFixture.split(strPlaceholder).length, 2, "Unique fixture placeholder: " + strPlaceholder);
	}

	const strArgumentRecords = SliceBetween("\t\tenum class NativeCallArgumentKind : unsigned char {", "\t\tstruct NativeCallRequest {").trimEnd();
	const strDataType = SliceBetween("\ttypedef enum _DATA_TYPE : int {", "\n\tstruct MemoryHookSignature {", g_strHeader).trimEnd();
	const strRequestRecord = SliceBetween("\t\tstruct NativeCallRequest {", "\t\tconstexpr std::size_t kNativeCallResultAlignment").trimEnd();
	const strRequestConstructor = SliceBetween("\t\tNativeCallRequest::NativeCallRequest()", "\t\tclass NativeCallStackStorage {").trimEnd();
	const RenderRequest = strTemplate => strTemplate
		.replace("@ARGUMENT_RECORDS@", () => strArgumentRecords)
		.replace("@DATA_TYPE@", () => strDataType)
		.replace("@REQUEST_RECORD@", () => strRequestRecord)
		.replace("@REQUEST_CONSTRUCTOR@", () => strRequestConstructor);
	const strRequestFixture = RenderRequest(g_strRequestFixture);
	const strRequestDeclaration = "NativeCallRequest();";
	const strRequestDefinition = "NativeCallRequest::NativeCallRequest() {";
	g_Assert.equal(strRequestFixture.split(strRequestDeclaration).length, 2, "Unique request constructor declaration");
	g_Assert.equal(strRequestFixture.split(strRequestDefinition).length, 2, "Unique request constructor definition");
	const strRequestRegression = strRequestFixture
		.replace(strRequestDeclaration, "NativeCallRequest() noexcept;")
		.replace(strRequestDefinition, "NativeCallRequest::NativeCallRequest() noexcept {");
	const strFixture = RenderRequest(g_strFixture)
		.replace("@STACK_STORAGE@", () => SliceBetween("\t\tclass NativeCallStackStorage {", "\t\tv8::Local<v8::String> MakeString("))
		.replace("@PREPARATION@", () => "#if defined(DETOURS_ARCH_X64)\n" + GetDefinition("FindX64RegisterCodeByName") + "\n\n" + GetDefinition("IsFloatingPointArgument") + "\n#else\n" + GetDefinition("FindX86RegisterOpcodeByName") + "\n#endif\n\n" + GetDefinition("ConfigureNativeCallContext"))
		.replace("@X87_READER@", () => GetDefinition("ReadX87ValueAsDouble"));
	const strCMakeProjectRoot = g_strProjectRoot.replace(/\\/g, "/");
	const strDetoursSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "thirdparty/Detours/Detours.cpp"), "utf8");
	const strDetoursSourceHeader = '#include "Detours.h"';
	g_Assert.equal(strDetoursSource.split(strDetoursSourceHeader).length, 2, "Unique Detours own-header anchor for the generated-only notice");
	const strAlignmentCalculation = "const std::size_t unAlignmentPadding = (unTargetAlignmentOffset + kRawCallStackAlignment - unSourceAlignmentOffset) % kRawCallStackAlignment;";
	g_Assert.equal(strDetoursSource.split(strAlignmentCalculation).length, 2, "Unique Detours alignment regression target");

	const strAlignmentRegression = strDetoursSource.replace(strDetoursSourceHeader, strDetoursSourceHeader + "\n\n// Generated only: copied Detours implementation with the alignment defect injected.").replace(strAlignmentCalculation, "const std::size_t unAlignmentPadding = ((unTargetAlignmentOffset + kRawCallStackAlignment - unSourceAlignmentOffset) % kRawCallStackAlignment) * 0;");
	const strCMake = `# Generated only: memory-call ABI regression build.
cmake_minimum_required(VERSION 3.20)
project(MemoryCallABI LANGUAGES CXX)
set(SOURCEJS_ABI_DETOURS_SOURCE "${strCMakeProjectRoot}/thirdparty/Detours/Detours.cpp" CACHE FILEPATH "Detours implementation under test")
add_library(Detours STATIC "\${SOURCEJS_ABI_DETOURS_SOURCE}")
target_include_directories(Detours PRIVATE "${strCMakeProjectRoot}/thirdparty/Detours")
target_compile_features(Detours PRIVATE cxx_std_20)
add_executable(MemoryCallABI Fixture.cpp)
set(SOURCEJS_ABI_REQUEST_SOURCE "\${CMAKE_CURRENT_SOURCE_DIR}/RequestFixture.cpp" CACHE FILEPATH "Request constructor implementation under test")
add_executable(MemoryCallRequest "\${SOURCEJS_ABI_REQUEST_SOURCE}")
target_compile_features(MemoryCallRequest PRIVATE cxx_std_20)
target_compile_features(MemoryCallABI PRIVATE cxx_std_20)
target_include_directories(MemoryCallABI SYSTEM PRIVATE "${strCMakeProjectRoot}/thirdparty/Detours")
target_link_libraries(MemoryCallABI PRIVATE Detours)
if(MSVC)
	target_compile_definitions(Detours PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
	target_compile_options(Detours PRIVATE /W4 /EHsc /permissive- /FIWindows.h /FIwinternl.h)
	target_compile_options(MemoryCallABI PRIVATE /W4 /WX /EHsc /permissive-)
	target_compile_options(MemoryCallRequest PRIVATE /W4 /WX /EHsc /permissive-)
	target_link_libraries(Detours PUBLIC advapi32 dbghelp winmm ws2_32)
else()
	target_compile_options(MemoryCallABI PRIVATE -Wall -Wextra -Werror -pedantic)
	target_compile_options(MemoryCallRequest PRIVATE -Wall -Wextra -Werror -pedantic)
	target_link_libraries(Detours PUBLIC dl pthread)
endif()
`;
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), strCMake);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "Fixture.cpp"), strFixture);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "RequestFixture.cpp"), strRequestFixture);
	const strRequestRegressionFile = g_Path.join(g_strTemporaryRoot, "RequestNoexceptRegression.cpp");
	g_FileSystem.writeFileSync(strRequestRegressionFile, strRequestRegression);

	const strAlignmentRegressionFile = g_Path.join(g_strTemporaryRoot, "DetoursAlignmentRegression.cpp");
	g_FileSystem.writeFileSync(strAlignmentRegressionFile, strAlignmentRegression);

	for (const Profile of g_vecProfiles) {
		const strBuild = g_Path.join(g_strTemporaryRoot, Profile.Name);
		const strExecutable = (process.platform === "win32") ? g_Path.join(strBuild, "Release", "MemoryCallABI.exe") : g_Path.join(strBuild, "MemoryCallABI");
		RequireSuccess("cmake", ["-S", g_strTemporaryRoot, "-B", strBuild, ...Profile.Arguments]);
		RequireSuccess("cmake", ["--build", strBuild, "--config", "Release", "--parallel", "2"]);

		const Result = RequireSuccess(strExecutable, []);
		g_Assert(Result.stdout.includes("MEMORY_CALL_ABI_NATIVE_PASS"));
		VerifyFixtureCLI(strExecutable);
		process.stdout.write(Profile.Name + ": actual Detours mixed/wide/variadic/floating-return/member-call ABI passed.\n");

		const strRequestExecutable = (process.platform === "win32") ? g_Path.join(strBuild, "Release", "MemoryCallRequest.exe") : g_Path.join(strBuild, "MemoryCallRequest");
		const RequestResult = RequireSuccess(strRequestExecutable, []);
		g_Assert(RequestResult.stdout.includes("MEMORY_CALL_REQUEST_NATIVE_PASS"));
		VerifyFixtureCLI(strRequestExecutable, "MemoryCallRequest");
		process.stdout.write(Profile.Name + ": actual production request defaults/exception contract passed" + ((process.platform === "win32") ? " (MSVC allocation failure caught).\n" : ".\n"));

		const strRequestRegressionBuild = g_Path.join(g_strTemporaryRoot, Profile.Name + "RequestNoexceptRegression");
		RequireSuccess("cmake", ["-S", g_strTemporaryRoot, "-B", strRequestRegressionBuild, ...Profile.Arguments, "-DSOURCEJS_ABI_REQUEST_SOURCE=" + strRequestRegressionFile.replace(/\\/g, "/")]);
		const RequestRegressionBuildResult = Run("cmake", ["--build", strRequestRegressionBuild, "--target", "MemoryCallRequest", "--config", "Release", "--parallel", "2"]);
		g_Assert.notEqual(RequestRegressionBuildResult.status, 0, "False noexcept must fail the actual request compile-time contract");
		g_Assert.equal(RequestRegressionBuildResult.signal, null);
		g_Assert((RequestRegressionBuildResult.stdout + RequestRegressionBuildResult.stderr).includes("Request construction must permit allocation failure."), RequestRegressionBuildResult.stdout + RequestRegressionBuildResult.stderr);
		process.stdout.write(Profile.Name + ": request false-noexcept compile-time regression rejected.\n");

		const strRegressionBuild = g_Path.join(g_strTemporaryRoot, Profile.Name + "AlignmentRegression");
		const strRegressionExecutable = (process.platform === "win32") ? g_Path.join(strRegressionBuild, "Release", "MemoryCallABI.exe") : g_Path.join(strRegressionBuild, "MemoryCallABI");
		RequireSuccess("cmake", ["-S", g_strTemporaryRoot, "-B", strRegressionBuild, ...Profile.Arguments, "-DSOURCEJS_ABI_DETOURS_SOURCE=" + strAlignmentRegressionFile.replace(/\\/g, "/")]);
		RequireSuccess("cmake", ["--build", strRegressionBuild, "--config", "Release", "--parallel", "2"]);

		const RegressionResult = Run(strRegressionExecutable, []);
		g_Assert.equal(RegressionResult.status, 1, "Broken Detours alignment must fail the native assertion");
		g_Assert.equal(RegressionResult.signal, null);
		g_Assert(RegressionResult.stderr.includes("MEMORY_CALL_ABI_ASSERTION_FAILED: native stack alignment preserved"), "Regression must fail for the expected alignment defect: " + RegressionResult.stderr);
		process.stdout.write(Profile.Name + ": compiled Detours alignment regression rejected.\n");
	}
} finally {
	const strResolved = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelative = g_Path.relative(g_strBuildRoot, strResolved);
	g_Assert.equal(strResolved, g_Path.resolve(g_strTemporaryRoot));
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_Assert(strRelative.startsWith("NativeMemoryCallABI-") && !strRelative.includes(g_Path.sep) && !g_Path.isAbsolute(strRelative));

	if (process.env.SOURCEJS_KEEP_ABI_FIXTURE === "1") {
		process.stderr.write("Preserved ABI fixture: " + strResolved + "\n");

	} else {
		g_FileSystem.rmSync(strResolved, { recursive: true });
	}
}

process.stdout.write("Memory call ABI contracts passed (real Detours; V8/parser/game-server execution not exercised).\n");
