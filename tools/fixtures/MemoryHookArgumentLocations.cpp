
// General
#if defined(_M_X64) || defined(__x86_64__)
#ifndef DETOURS_ARCH_X64
#define DETOURS_ARCH_X64
#define SOURCEJS_ARGUMENT_FIXTURE_OWNS_X64
#endif
#elif defined(_M_IX86) || defined(__i386__)
#ifndef DETOURS_ARCH_X86
#define DETOURS_ARCH_X86
#define SOURCEJS_ARGUMENT_FIXTURE_OWNS_X86
#endif
#else
#error Hook argument classification requires an x86/x64 compiler target
#endif

// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <exception>

// STL
#include <initializer_list>
#include <limits>
#include <string>
#include <vector>

// Compiles the actual signature and resolver, not a V8/Detours hook installation
// or a native-callee probe. Expected locations follow the selected compiler ABI.
// Template fixture: compile through tools/smoke_memory_hook_argument_locations.js,
// which inserts production definitions at the unique markers, not standalone.
namespace SourceJS {
@DATA_TYPE@

@SIGNATURE@

@CONSTRUCTOR@

@LOCATION_RECORDS@

@RESOLVER@

	std::size_t g_unFailures = 0;

	MemoryHookSignature MakeSignature(std::initializer_list<DATA_TYPE> spnArgumentTypes, char const* const pszConvention) {
		MemoryHookSignature Signature {};
		Signature.m_strConvention = pszConvention;
		Signature.m_vecArgumentTypes = spnArgumentTypes;

		return Signature;
	}

	void CheckLocation(MemoryHookSignature const& Signature, const int nArgumentIndex, const NativeArgumentLocationKind ExpectedKind, const std::size_t unExpectedPosition) {
		NativeArgumentLocation const Location = ResolveNativeArgumentLocation(Signature, nArgumentIndex);
		const bool bExpectedStackLocation = ExpectedKind == NativeArgumentLocationKind::Stack;
		const std::size_t unExpectedRegisterIndex = bExpectedStackLocation ? 0 : unExpectedPosition;
		const std::size_t unExpectedStackOffset = bExpectedStackLocation ? unExpectedPosition : 0;
		if ((Location.m_Kind != ExpectedKind) || (Location.m_unRegisterIndex != unExpectedRegisterIndex) || (Location.m_unStackOffset != unExpectedStackOffset)) {
			++g_unFailures;
			std::fprintf(stderr, "Hook argument location failure: Convention=%s Index=%d Kind=%d ExpectedKind=%d RegisterIndex=%zu ExpectedRegisterIndex=%zu StackOffset=%zu ExpectedStackOffset=%zu\n", Signature.m_strConvention.c_str(), nArgumentIndex, static_cast<int>(Location.m_Kind), static_cast<int>(ExpectedKind), Location.m_unRegisterIndex, unExpectedRegisterIndex, Location.m_unStackOffset, unExpectedStackOffset);
		}
	}

	void CheckLocations() {
#if defined(DETOURS_ARCH_X64) && defined(__linux__)
		constexpr std::size_t kGeneralRegisterCount = 6;
		constexpr std::size_t kFloatingRegisterCount = 8;
#endif

		MemoryHookSignature const Empty = MakeSignature({}, "cdecl");
		CheckLocation(Empty, -1, NativeArgumentLocationKind::Invalid, 0);
		CheckLocation(Empty, 0, NativeArgumentLocationKind::Invalid, 0);
		CheckLocation(Empty, std::numeric_limits<int>::max(), NativeArgumentLocationKind::Invalid, 0);

		MemoryHookSignature const One = MakeSignature({ DATA_TYPE_UINT }, "cdecl");
		CheckLocation(One, 1, NativeArgumentLocationKind::Invalid, 0);

#if defined(DETOURS_ARCH_X86)
		for (auto const& pszConvention : { "cdecl", "stdcall" }) {
			MemoryHookSignature const Stack = MakeSignature({ DATA_TYPE_UINT, DATA_TYPE_FLOAT, DATA_TYPE_LONG_LONG, DATA_TYPE_DOUBLE, DATA_TYPE_ADDRESS }, pszConvention);
			CheckLocation(Stack, 0, NativeArgumentLocationKind::Stack, 0x04);
			CheckLocation(Stack, 1, NativeArgumentLocationKind::Stack, 0x08);
			CheckLocation(Stack, 2, NativeArgumentLocationKind::Stack, 0x0C);
			CheckLocation(Stack, 3, NativeArgumentLocationKind::Stack, 0x14);
			CheckLocation(Stack, 4, NativeArgumentLocationKind::Stack, 0x1C);
		}

		MemoryHookSignature const Thiscall = MakeSignature({ DATA_TYPE_ADDRESS, DATA_TYPE_FLOAT, DATA_TYPE_UINT }, "thiscall");
		CheckLocation(Thiscall, 0, NativeArgumentLocationKind::GeneralRegister, 0);
		CheckLocation(Thiscall, 1, NativeArgumentLocationKind::Stack, 0x04);
		CheckLocation(Thiscall, 2, NativeArgumentLocationKind::Stack, 0x08);

		MemoryHookSignature const FloatFirst = MakeSignature({ DATA_TYPE_FLOAT, DATA_TYPE_UINT, DATA_TYPE_UINT, DATA_TYPE_DOUBLE, DATA_TYPE_UINT }, "fastcall");
		CheckLocation(FloatFirst, 0, NativeArgumentLocationKind::Stack, 0x04);
		CheckLocation(FloatFirst, 1, NativeArgumentLocationKind::GeneralRegister, 0);
		CheckLocation(FloatFirst, 2, NativeArgumentLocationKind::GeneralRegister, 1);
		CheckLocation(FloatFirst, 3, NativeArgumentLocationKind::Stack, 0x08);
		CheckLocation(FloatFirst, 4, NativeArgumentLocationKind::Stack, 0x10);

		MemoryHookSignature const FloatBetween = MakeSignature({ DATA_TYPE_UINT, DATA_TYPE_FLOAT, DATA_TYPE_UINT, DATA_TYPE_UINT }, "fastcall");
		CheckLocation(FloatBetween, 0, NativeArgumentLocationKind::GeneralRegister, 0);
		CheckLocation(FloatBetween, 1, NativeArgumentLocationKind::Stack, 0x04);
		CheckLocation(FloatBetween, 2, NativeArgumentLocationKind::GeneralRegister, 1);
		CheckLocation(FloatBetween, 3, NativeArgumentLocationKind::Stack, 0x08);

		MemoryHookSignature const DoubleFirst = MakeSignature({ DATA_TYPE_DOUBLE, DATA_TYPE_UINT, DATA_TYPE_UINT }, "fastcall");
		CheckLocation(DoubleFirst, 0, NativeArgumentLocationKind::Stack, 0x04);
		CheckLocation(DoubleFirst, 1, NativeArgumentLocationKind::GeneralRegister, 0);
		CheckLocation(DoubleFirst, 2, NativeArgumentLocationKind::GeneralRegister, 1);

		for (auto const& WideType : { DATA_TYPE_LONG_LONG, DATA_TYPE_ULONG_LONG }) {
			MemoryHookSignature const WideFirst = MakeSignature({ WideType, DATA_TYPE_UINT, DATA_TYPE_UINT }, "fastcall");
			CheckLocation(WideFirst, 0, NativeArgumentLocationKind::Stack, 0x04);
#if defined(__GNUC__) && !defined(__clang__)
			CheckLocation(WideFirst, 1, NativeArgumentLocationKind::Stack, 0x0C);
			CheckLocation(WideFirst, 2, NativeArgumentLocationKind::Stack, 0x10);
#else
			CheckLocation(WideFirst, 1, NativeArgumentLocationKind::GeneralRegister, 0);
			CheckLocation(WideFirst, 2, NativeArgumentLocationKind::GeneralRegister, 1);
#endif

			MemoryHookSignature const WideBetween = MakeSignature({ DATA_TYPE_UINT, WideType, DATA_TYPE_UINT, DATA_TYPE_UINT }, "fastcall");
			CheckLocation(WideBetween, 0, NativeArgumentLocationKind::GeneralRegister, 0);
			CheckLocation(WideBetween, 1, NativeArgumentLocationKind::Stack, 0x04);
#if defined(__GNUC__) && !defined(__clang__)
			CheckLocation(WideBetween, 2, NativeArgumentLocationKind::Stack, 0x0C);
			CheckLocation(WideBetween, 3, NativeArgumentLocationKind::Stack, 0x10);
#else
			CheckLocation(WideBetween, 2, NativeArgumentLocationKind::GeneralRegister, 1);
			CheckLocation(WideBetween, 3, NativeArgumentLocationKind::Stack, 0x0C);
#endif
		}
#elif defined(_WIN32)
		MemoryHookSignature const Mixed = MakeSignature({ DATA_TYPE_FLOAT, DATA_TYPE_UINT, DATA_TYPE_DOUBLE, DATA_TYPE_ADDRESS, DATA_TYPE_UINT, DATA_TYPE_FLOAT }, "fastcall");
		CheckLocation(Mixed, 0, NativeArgumentLocationKind::FloatingRegister, 0);
		CheckLocation(Mixed, 1, NativeArgumentLocationKind::GeneralRegister, 1);
		CheckLocation(Mixed, 2, NativeArgumentLocationKind::FloatingRegister, 2);
		CheckLocation(Mixed, 3, NativeArgumentLocationKind::GeneralRegister, 3);
		CheckLocation(Mixed, 4, NativeArgumentLocationKind::Stack, 0x28);
		CheckLocation(Mixed, 5, NativeArgumentLocationKind::Stack, 0x30);
#elif defined(__linux__)
		MemoryHookSignature IntegersFirst = MakeSignature({}, "cdecl");
		IntegersFirst.m_vecArgumentTypes.assign(kGeneralRegisterCount, DATA_TYPE_UINT);
		IntegersFirst.m_vecArgumentTypes.insert(IntegersFirst.m_vecArgumentTypes.end(), kFloatingRegisterCount, DATA_TYPE_FLOAT);
		IntegersFirst.m_vecArgumentTypes.push_back(DATA_TYPE_UINT);
		IntegersFirst.m_vecArgumentTypes.push_back(DATA_TYPE_DOUBLE);

		for (std::size_t unIndex = 0; unIndex < kGeneralRegisterCount; ++unIndex) {
			CheckLocation(IntegersFirst, static_cast<int>(unIndex), NativeArgumentLocationKind::GeneralRegister, unIndex);
		}

		for (std::size_t unIndex = 0; unIndex < kFloatingRegisterCount; ++unIndex) {
			CheckLocation(IntegersFirst, static_cast<int>(kGeneralRegisterCount + unIndex), NativeArgumentLocationKind::FloatingRegister, unIndex);
		}

		CheckLocation(IntegersFirst, 14, NativeArgumentLocationKind::Stack, 0x08);
		CheckLocation(IntegersFirst, 15, NativeArgumentLocationKind::Stack, 0x10);

		MemoryHookSignature FloatingFirst = MakeSignature({}, "cdecl");
		FloatingFirst.m_vecArgumentTypes.assign(kFloatingRegisterCount + 1, DATA_TYPE_DOUBLE);
		FloatingFirst.m_vecArgumentTypes.insert(FloatingFirst.m_vecArgumentTypes.end(), kGeneralRegisterCount + 1, DATA_TYPE_UINT);
		CheckLocation(FloatingFirst, 8, NativeArgumentLocationKind::Stack, 0x08);
		CheckLocation(FloatingFirst, 9, NativeArgumentLocationKind::GeneralRegister, 0);
		CheckLocation(FloatingFirst, 14, NativeArgumentLocationKind::GeneralRegister, 5);
		CheckLocation(FloatingFirst, 15, NativeArgumentLocationKind::Stack, 0x10);
#endif
	}
} // namespace SourceJS

#if defined(SOURCEJS_ARGUMENT_FIXTURE_OWNS_X64)
#undef DETOURS_ARCH_X64
#undef SOURCEJS_ARGUMENT_FIXTURE_OWNS_X64
#endif
#if defined(SOURCEJS_ARGUMENT_FIXTURE_OWNS_X86)
#undef DETOURS_ARCH_X86
#undef SOURCEJS_ARGUMENT_FIXTURE_OWNS_X86
#endif

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fputs("Usage: MemoryHookArgumentLocations\n", stderr);
		return 2;
	}

	try {
		SourceJS::CheckLocations();
	} catch (std::exception const& Failure) {
		std::fprintf(stderr, "Hook argument location initialization failure: %s\n", Failure.what());
		return 2;
	}

	if (SourceJS::g_unFailures != 0) {
		return 1;
	}

	std::puts("Compiled hook argument classification passed; native callee/engine execution not exercised.");

	return 0;
}
