
// General
#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_THUNK_FIXTURE_OWNS_NOMINMAX
#endif
#include <Windows.h>
#if defined(SOURCEJS_THUNK_FIXTURE_OWNS_NOMINMAX)
#undef SOURCEJS_THUNK_FIXTURE_OWNS_NOMINMAX
#undef NOMINMAX
#endif
#else
#include <sys/mman.h>
#endif

// C++
#include <cerrno>
#include <cstdarg>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

// STL
#include <bit>
#include <exception>
#include <thread>
#include <type_traits>
#include <vector>

// Third-party
#include <Detours.h>

// Project
#include "MemoryHookThunkBridge.h"

extern "C" {
	std::uintptr_t g_unRawBridgeStack = 0;
	std::uintptr_t g_unPostBridgeStack = 0;
	std::uintptr_t g_unEntryStack = 0;
	std::uintptr_t g_unExitStack = 0;
	std::uintptr_t g_unEntryBase = 0;
	std::uintptr_t g_unExitBase = 0;
	std::uintptr_t g_unReturnInteger = 0;
	std::uintptr_t g_unReturnSecondInteger = 0;
	void* g_pCallerContinuation = nullptr;
	void* g_pBridgeContinuation = nullptr;
}

namespace SourceJS {
@POST_CONTEXT@

	enum class ReturnKind {
		Integer = 0,
		Double,
		Float,
	};

	constexpr int kHookID = 73;
	constexpr std::uint64_t kInputInteger = 0x12345678ABCDEF01;
	constexpr std::uint64_t kOutputInteger = 0xFEDCBA9876543210;
	constexpr double kInputDouble = 63.5;
	constexpr double kOutputDouble = 14.25;
	constexpr float kInputFloat = -11.25F;
	constexpr float kOutputFloat = 9.75F;
	constexpr std::size_t kCleanupDiagnosticCapacity = 256;
#if defined(__linux__) || defined(DETOURS_ARCH_X64)
	constexpr std::size_t kBridgeStackAlignment = 16;
#else
	constexpr std::size_t kBridgeStackAlignment = sizeof(void*);
#endif

	std::size_t g_unFailures = 0;
	std::size_t g_unCleanupDiagnosticCount = 0;
	std::size_t g_unZeroAddressCleanupDiagnosticCount = 0;
	char g_szCleanupDiagnostic[kCleanupDiagnosticCapacity] {};
	bool g_bRejectPostThunkAllocation = false;
	bool g_bRejectThunkRelease = false;
	ReturnKind g_ReturnKind = ReturnKind::Integer;
	Detours::Hook::PRAW_CONTEXT g_pExpectedContext = nullptr;
	bool g_bRawArgumentsMatch = false;
	bool g_bReturnContextMatches = false;
	std::uintptr_t g_unExpectedInteger = 0;
	std::uintptr_t g_unExpectedSecondInteger = 0;
#if defined(__linux__)
	bool g_bReturnZeroAddressMapping = false;
	std::size_t g_unZeroAddressCleanupCalls = 0;
#endif

	class MemoryHookManager {
	public:
		MemoryHookManager() = default;
		void* CreateThunk(int nHookID, std::size_t& unThunkSizeOut, std::uintptr_t unDispatchAddress = 0) const noexcept;
		void* CreatePostThunk(std::size_t& unThunkSizeOut) const;
		void ReleaseThunk(void* pThunk, std::size_t unThunkSize) const noexcept;
		void LoadReturnContext(MemoryHookPostContext const& PostContext, Detours::Hook::RAW_CONTEXT& RawContextOut) noexcept;
		void StoreReturnContext(Detours::Hook::RAW_CONTEXT const& RawContext, MemoryHookPostContext& PostContextOut) noexcept;
	};

	// Diagnostics and deliberate allocation/release failures are adapters.
	// Successful allocation/cache and emitted instructions come from production.
	void LogError(char const* const pszFormat, ...) noexcept {
		const bool bZeroAddressCleanup = std::strstr(pszFormat, "CreateThunk cleanup failed") != nullptr;
		if (std::strstr(pszFormat, "ReleaseThunk failed") || bZeroAddressCleanup) {
			std::va_list Arguments {};
			va_start(Arguments, pszFormat);
			const int nWritten = std::vsnprintf(g_szCleanupDiagnostic, sizeof(g_szCleanupDiagnostic), pszFormat, Arguments);
			va_end(Arguments);

			if ((nWritten < 0) || (static_cast<std::size_t>(nWritten) >= sizeof(g_szCleanupDiagnostic))) {
				++g_unFailures;
			}

			if (bZeroAddressCleanup) {
				++g_unZeroAddressCleanupDiagnosticCount;
			} else {
				++g_unCleanupDiagnosticCount;
			}

			return;
		}

		std::fprintf(stderr, "Thunk fixture allocation: %s\n", pszFormat);
	}

@HELPERS@

	void* FixtureAllocateExecutable(const std::size_t unSize) {
		if (g_bRejectPostThunkAllocation) {
			return nullptr;
		}

		return AllocateExecutable(unSize);
	}

#if defined(DETOURS_ARCH_X86)
	constexpr std::size_t kX87StateByteCount = sizeof(Detours::Hook::RAW_CONTEXT_FPU);
	constexpr std::size_t kX87StateAlignment = 16;

	static_assert(kX87StateByteCount == 108);

@X87_HELPERS@
#endif

	// Real mappings use the OS except for deliberately rejected releases.
	// Synthetic zero mappings exercise cleanup only through the adapters.
#if defined(_WIN32)
	BOOL FixtureVirtualFree(void* const pMemory, const SIZE_T unSize, const DWORD unType) noexcept {
		if (g_bRejectThunkRelease) {
			SetLastError(ERROR_ACCESS_DENIED);
			return FALSE;
		}

		return VirtualFree(pMemory, unSize, unType);
	}
#else
	// Synthetic zero mappings never reach a real OS unmap operation.
	void* FixtureMapMemory(void* const pAddress, const std::size_t unSize, const int nProtection, const int nFlags, const int nFileDescriptor, const off_t nOffset) noexcept {
		if (g_bReturnZeroAddressMapping) {
			return nullptr;
		}

		return mmap(pAddress, unSize, nProtection, nFlags, nFileDescriptor, nOffset);
	}

	int FixtureMunmap(void* const pMemory, const std::size_t unSize) noexcept {
		if (g_bReturnZeroAddressMapping) {
			++g_unZeroAddressCleanupCalls;

			if (g_bRejectThunkRelease) {
				errno = EACCES;
				return -1;
			}

			return 0;
		}

		if (g_bRejectThunkRelease) {
			errno = EACCES;
			return -1;
		}

		return munmap(pMemory, unSize);
	}
#endif

	struct SendPropertyDispatchFixture {
		SendPropertyDispatchFixture& GetMemoryHookManager() noexcept {
			return *this;
		}

		bool HandleHook(const int nHookID, Detours::Hook::PRAW_CONTEXT const pRawContext) const noexcept {
			return (pRawContext == g_pExpectedContext) && (nHookID == kHookID);
		}
	};

	constinit SendPropertyDispatchFixture g_Application {};

@SEND_PROPERTY_DISPATCH@

@THUNKS@

@RETURN_CONTEXT@

	class ThunkOwner {
	public:
		explicit ThunkOwner(MemoryHookManager& Manager, bool bPost);
		~ThunkOwner();
		ThunkOwner(ThunkOwner const&) = delete;
		ThunkOwner& operator=(ThunkOwner const&) = delete;
		void* GetAddress() const noexcept;

	private:
		MemoryHookManager& m_Manager;
		void* m_pAddress;
		std::size_t m_unSize;
	};

	ThunkOwner::ThunkOwner(MemoryHookManager& Manager, const bool bPost) :
		m_Manager(Manager)
	{
		m_unSize = 0;
		m_pAddress = bPost ? Manager.CreatePostThunk(m_unSize) : Manager.CreateThunk(kHookID, m_unSize);
	}

	ThunkOwner::~ThunkOwner() {
		m_Manager.ReleaseThunk(m_pAddress, m_unSize);
	}

	void* ThunkOwner::GetAddress() const noexcept {
		return m_pAddress;
	}

	void Check(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			++g_unFailures;
			std::fprintf(stderr, "Memory hook thunk fixture: %s\n", pszMessage);
		}
	}

	std::uint64_t IntegerTarget() noexcept {
		return kInputInteger;
	}

	double DoubleTarget() noexcept {
		return kInputDouble;
	}

	float FloatTarget() noexcept {
		return kInputFloat;
	}

	void CheckPostFrame() {
		Check(g_bReturnContextMatches, "post bridge receives the actual native return value");
		Check(((g_unPostBridgeStack + sizeof(void*)) % kBridgeStackAlignment) == 0, "post bridge call stack satisfies the platform ABI");
		Check(g_unExitStack == (g_unEntryStack + sizeof(void*)), "post thunk restores the continuation stack");
		Check(g_unExitBase == g_unEntryBase, "post thunk preserves the caller frame register");
		Check(g_unReturnInteger == g_unExpectedInteger, "post thunk restores the primary integer register");
		Check(g_unReturnSecondInteger == g_unExpectedSecondInteger, "post thunk restores the secondary integer register");
	}

	void RunFixture() {
		constexpr std::size_t kErrorFieldCapacity = 32;
		constexpr std::size_t kOriginalThunkSize = 1;
#if defined(__linux__) && defined(DETOURS_ARCH_X86)
		constexpr std::size_t kExpectedRawThunkSize = 28;
#elif defined(__linux__)
		constexpr std::size_t kExpectedRawThunkSize = 17;
#endif

		using fnRawThunk = bool(*)(Detours::Hook::PRAW_CONTEXT);

		MemoryHookManager Manager {};
		Manager.ReleaseThunk(nullptr, 0);
		Check(g_unCleanupDiagnosticCount == 0, "empty thunk release performs no OS operation");

		std::size_t unInvalidSize = kOriginalThunkSize;
		Check((Manager.CreateThunk(0, unInvalidSize) == nullptr) && (unInvalidSize == kOriginalThunkSize), "invalid hook ID preserves the size output");

		std::size_t unRejectedPostThunkSize = kOriginalThunkSize;
		g_bRejectPostThunkAllocation = true;
		void* const pRejectedPostThunk = Manager.CreatePostThunk(unRejectedPostThunkSize);
		g_bRejectPostThunkAllocation = false;
		Check((pRejectedPostThunk == nullptr) && (unRejectedPostThunkSize == kOriginalThunkSize), "failed post thunk allocation preserves the size output");

#if defined(__linux__)
		std::size_t unZeroAddressThunkSize = kOriginalThunkSize;
		g_bReturnZeroAddressMapping = true;
		void* const pZeroAddressThunk = Manager.CreateThunk(kHookID, unZeroAddressThunkSize);
		Check((pZeroAddressThunk == nullptr) && (unZeroAddressThunkSize == kOriginalThunkSize), "zero mapping preserves the failed allocation result and size output");
		Check((g_unZeroAddressCleanupCalls == 1) && (g_unZeroAddressCleanupDiagnosticCount == 0), "successful zero-address cleanup is performed without a failure diagnostic");

		g_bRejectThunkRelease = true;
		void* const pFailedZeroAddressThunk = Manager.CreateThunk(kHookID, unZeroAddressThunkSize);
		g_bRejectThunkRelease = false;
		g_bReturnZeroAddressMapping = false;
		Check((pFailedZeroAddressThunk == nullptr) && (unZeroAddressThunkSize == kOriginalThunkSize), "failed zero-address cleanup preserves the failed allocation result and size output");
		Check((g_unZeroAddressCleanupCalls == 2) && (g_unZeroAddressCleanupDiagnosticCount == 1), "failed zero-address cleanup emits one diagnostic");

		char szExpectedZeroAddressDiagnostic[kCleanupDiagnosticCapacity] {};
		const int nZeroAddressDiagnosticLength = std::snprintf(szExpectedZeroAddressDiagnostic, sizeof(szExpectedZeroAddressDiagnostic), "CreateThunk cleanup failed Address=%p Size=%zu Error=0x%08X", pFailedZeroAddressThunk, kExpectedRawThunkSize, static_cast<unsigned int>(EACCES));
		Check((nZeroAddressDiagnosticLength > 0) && (static_cast<std::size_t>(nZeroAddressDiagnosticLength) < sizeof(szExpectedZeroAddressDiagnostic)) && (std::strcmp(g_szCleanupDiagnostic, szExpectedZeroAddressDiagnostic) == 0), "zero-address cleanup captures errno and renders canonical address/size/hex fields");
#endif

		ThunkOwner const RawThunk(Manager, false);
		ThunkOwner const PostThunk(Manager, true);
		if (!RawThunk.GetAddress() || !PostThunk.GetAddress()) {
			Check(false, "allocate native thunk fixtures");
			return;
		}

		g_bRejectThunkRelease = true;
		Manager.ReleaseThunk(RawThunk.GetAddress(), 1);
		g_bRejectThunkRelease = false;
		Check(g_unCleanupDiagnosticCount == 1, "failed OS thunk release emits its diagnostic");

		char szExpectedError[kErrorFieldCapacity] {};
#if defined(_WIN32)
		const int nExpectedLength = std::snprintf(szExpectedError, sizeof(szExpectedError), " Error=0x%08lX", static_cast<unsigned long>(ERROR_ACCESS_DENIED));
#else
		const int nExpectedLength = std::snprintf(szExpectedError, sizeof(szExpectedError), " Error=0x%08X", static_cast<unsigned int>(EACCES));
#endif

		Check((nExpectedLength > 0) && (static_cast<std::size_t>(nExpectedLength) < sizeof(szExpectedError)) && (std::strstr(g_szCleanupDiagnostic, szExpectedError) != nullptr), "cleanup diagnostic preserves the captured OS error in canonical hex");

		Detours::Hook::RAW_CONTEXT Context {};
		g_pExpectedContext = &Context;
		const bool bResult = reinterpret_cast<fnRawThunk>(RawThunk.GetAddress())(&Context);
		Check(bResult && g_bRawArgumentsMatch, "raw thunk forwards context and embedded hook ID");
		Check(((g_unRawBridgeStack + sizeof(void*)) % kBridgeStackAlignment) == 0, "raw bridge call stack satisfies the platform ABI");

		std::size_t unSendPropertyThunkSize = 0;
		void* const pSendPropertyThunk = Manager.CreateThunk(kHookID, unSendPropertyThunkSize, reinterpret_cast<std::uintptr_t>(&DispatchSendPropertyProxyHook));
		if (!pSendPropertyThunk) {
			Check(false, "allocate the SendProp-specific thunk");
			return;
		}

		g_bSendPropertyGameThread = true;
		auto const SendPropertyThunk = reinterpret_cast<fnRawThunk>(pSendPropertyThunk);
		auto const OrdinaryThunk = reinterpret_cast<fnRawThunk>(RawThunk.GetAddress());
		Check(SendPropertyThunk(&Context), "SendProp thunk dispatches on the game thread");

		bool bWorkerSendPropertyDispatched = true;
		bool bWorkerOrdinaryDispatched = false;
		std::jthread Worker([&] {
			bWorkerSendPropertyDispatched = SendPropertyThunk(&Context);
			bWorkerOrdinaryDispatched = OrdinaryThunk(&Context);
		});
		Worker.join();
		Check(!bWorkerSendPropertyDispatched, "SendProp thunk falls through on workers");
		Check(bWorkerOrdinaryDispatched, "ordinary thunk still uses its original bridge on workers");
		g_bSendPropertyGameThread = false;
		Manager.ReleaseThunk(pSendPropertyThunk, unSendPropertyThunkSize);

		g_ReturnKind = ReturnKind::Integer;
		g_bReturnContextMatches = false;
		const std::uint64_t unIntegerResult = InvokePostInteger(reinterpret_cast<void*>(&IntegerTarget), PostThunk.GetAddress());
		Check(unIntegerResult == kOutputInteger, "post thunk applies native integer result edits");
		CheckPostFrame();

		g_ReturnKind = ReturnKind::Double;
		g_bReturnContextMatches = false;
		const double dblResult = InvokePostDouble(reinterpret_cast<void*>(&DoubleTarget), PostThunk.GetAddress());
		Check(dblResult == kOutputDouble, "post thunk applies native double result edits");
		CheckPostFrame();

		g_ReturnKind = ReturnKind::Float;
		g_bReturnContextMatches = false;
		const float flResult = InvokePostFloat(reinterpret_cast<void*>(&FloatTarget), PostThunk.GetAddress());
		Check(flResult == kOutputFloat, "post thunk applies native float result edits");
		CheckPostFrame();
	}
} // namespace SourceJS

// Only the adapter realigns itself, so existing broken x86 thunk alignment can
// be reported safely. The assembly shim records the actual pre-prologue stack;
// it is that original stack, not the adapter's repaired frame, which is checked.
extern "C" {
#if defined(__linux__) && defined(__i386__)
	__attribute__((force_align_arg_pointer))
#endif
	bool FixtureDispatchRawHook(Detours::Hook::PRAW_CONTEXT const pRawContext, const int nHookID) noexcept {
		SourceJS::g_bRawArgumentsMatch = (pRawContext == SourceJS::g_pExpectedContext) && (nHookID == SourceJS::kHookID);

		return true;
	}

#if defined(__linux__) && defined(__i386__)
	__attribute__((force_align_arg_pointer))
#endif
	void* FixtureDispatchPostHook(void* const pReturnSlot, SourceJS::PMemoryHookPostContext const pPostContext) noexcept {
#if defined(DETOURS_ARCH_X86)
		constexpr std::size_t kIntegerRegisterBitCount = 32;
#endif

		SourceJS::MemoryHookManager Manager {};
		Detours::Hook::RAW_CONTEXT Context {};
		Manager.LoadReturnContext(*pPostContext, Context);

		if (SourceJS::g_ReturnKind == SourceJS::ReturnKind::Integer) {
#if defined(DETOURS_ARCH_X64)
			SourceJS::g_bReturnContextMatches = Context.m_unRAX == SourceJS::kInputInteger;
			Context.m_unRAX = SourceJS::kOutputInteger;
#else
			const std::uint64_t unResult = (static_cast<std::uint64_t>(Context.m_unEDX) << kIntegerRegisterBitCount) | Context.m_unEAX;
			SourceJS::g_bReturnContextMatches = unResult == SourceJS::kInputInteger;
			Context.m_unEAX = static_cast<std::uint32_t>(SourceJS::kOutputInteger);
			Context.m_unEDX = static_cast<std::uint32_t>(SourceJS::kOutputInteger >> kIntegerRegisterBitCount);
#endif
		} else {
			const double dblExpected = (SourceJS::g_ReturnKind == SourceJS::ReturnKind::Double) ? SourceJS::kInputDouble : static_cast<double>(SourceJS::kInputFloat);
			const double dblReplacement = (SourceJS::g_ReturnKind == SourceJS::ReturnKind::Double) ? SourceJS::kOutputDouble : static_cast<double>(SourceJS::kOutputFloat);
#if defined(DETOURS_ARCH_X64)
			if (SourceJS::g_ReturnKind == SourceJS::ReturnKind::Double) {
				SourceJS::g_bReturnContextMatches = Context.m_XMM0.m_f64[0] == dblExpected;
				Context.m_XMM0.m_f64[0] = dblReplacement;
			} else {
				SourceJS::g_bReturnContextMatches = Context.m_XMM0.m_f32[0] == dblExpected;
				Context.m_XMM0.m_f32[0] = static_cast<float>(dblReplacement);
			}
#else
			SourceJS::g_bReturnContextMatches = SourceJS::ReadX87ValueAsDouble(&Context.m_FPU.m_Registers[0]) == dblExpected;

			if (!SourceJS::WriteX87ValueFromDouble(dblReplacement, &Context.m_FPU)) {
				SourceJS::g_bReturnContextMatches = false;
			}
#endif
		}

		Manager.StoreReturnContext(Context, *pPostContext);
		SourceJS::g_unExpectedInteger = pPostContext->m_unInteger;
		SourceJS::g_unExpectedSecondInteger = pPostContext->m_unSecondInteger;

		if (reinterpret_cast<std::uintptr_t>(pReturnSlot) != g_unEntryStack) {
			SourceJS::g_bReturnContextMatches = false;
		}

		return g_pBridgeContinuation;
	}
}

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fprintf(stderr, "Usage: MemoryHookThunkContracts\n");
		return 2;
	}

	try {
		SourceJS::RunFixture();
		SourceJS::Check(SourceJS::g_unCleanupDiagnosticCount == 1, "owned thunk cleanup succeeds after the deliberate rejected release");
	} catch (std::exception const& Failure) {
		std::fprintf(stderr, "Memory hook thunk fixture: unexpected C++ failure: %s\n", Failure.what());
		return 2;
	}

	if (SourceJS::g_unFailures != 0) {
		return 1;
	}

	std::puts("Native hook thunk contracts passed; emitted instructions executed, bridge/engine adapters explicit.");

	return 0;
}
