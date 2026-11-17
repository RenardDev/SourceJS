
// General
// Match Detours' architecture selectors; never infer an instruction set from pointer width.
#if defined(_M_X64) || defined(__x86_64__)
#ifndef DETOURS_ARCH_X64
#define DETOURS_ARCH_X64
#define SOURCEJS_LIFECYCLE_FIXTURE_OWNS_X64
#endif
#elif defined(_M_IX86) || defined(__i386__)
#ifndef DETOURS_ARCH_X86
#define DETOURS_ARCH_X86
#define SOURCEJS_LIFECYCLE_FIXTURE_OWNS_X86
#endif
#else
#error The lifecycle fixture requires the supported x86/x64 target
#endif

// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <utility>

// STL
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <new>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

#if defined(_MSC_VER)
namespace {
	// Single-threaded fixture: fail only the next allocation during actual manager construction.
	bool g_bFailNextManagerAllocation = false;
} // namespace

void* operator new(const std::size_t unSize) {
	if (g_bFailNextManagerAllocation) {
		g_bFailNextManagerAllocation = false;
		throw std::bad_alloc {};
	}

	void* const pStorage = std::malloc((unSize == 0) ? 1 : unSize);
	if (!pStorage) {
		throw std::bad_alloc {};
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

// This fixture compiles extracted production lifecycle methods/records. V8 handles,
// Detours release and post-callback execution are doubles, not live engine/GC tests.
namespace v8 {
	class Context {
	};

	using fnCreationReadAction = void(*)(void* pUserData);

	// Only reader reentrancy is modeled; these fields are not a JavaScript object implementation.
	class Object {
	public:
		Object(void* const pAddress, fnCreationReadAction const ReadAddressAction = nullptr, fnCreationReadAction const ReadSignatureAction = nullptr, void* const pActionData = nullptr);

		void* m_pAddress;
		fnCreationReadAction m_ReadAddressAction;
		fnCreationReadAction m_ReadSignatureAction;
		void* m_pActionData;
	};

	Object::Object(void* const pAddress, fnCreationReadAction const ReadAddressAction, fnCreationReadAction const ReadSignatureAction, void* const pActionData) :
		m_pAddress(pAddress),
		m_ReadAddressAction(ReadAddressAction),
		m_ReadSignatureAction(ReadSignatureAction),
		m_pActionData(pActionData)
	{
	}

	class Array;
	class Value;
	class Isolate;

	template <typename T>
	class Local {
	public:
		Local() = default;
		explicit Local(std::shared_ptr<T> pValue) :
			m_pValue(std::move(pValue))
		{
		}

		bool IsEmpty() const noexcept {
			return !m_pValue;
		}

		T* operator->() const noexcept {
			return m_pValue.get();
		}

		bool operator==(Local const& Other) const noexcept {
			return m_pValue == Other.m_pValue;
		}

		std::shared_ptr<T> m_pValue;
	};

	template <typename T>
	class Global {
	public:
		Global() = default;
		Global(Isolate*, Local<T> const LocalValue) noexcept :
			m_pValue(LocalValue.m_pValue)
		{
		}
		Global(Global const&) = delete;
		Global& operator=(Global const&) = delete;
		Global(Global&& Other) noexcept :
			m_pValue(std::move(Other.m_pValue))
		{
		}

		Global& operator=(Global&& Other) noexcept {
			m_pValue = std::move(Other.m_pValue);

			return *this;
		}

		bool IsEmpty() const noexcept {
			return !m_pValue;
		}

		Local<T> Get(Isolate*) const noexcept {
			return Local<T>(m_pValue);
		}

		void Reset() noexcept {
			m_pValue.reset();
		}

		void Reset(Isolate*, Local<T> const LocalValue) noexcept {
			m_pValue = LocalValue.m_pValue;
		}

	private:
		std::shared_ptr<T> m_pValue;
	};

	class Function {
	public:
		bool StrictEquals(Local<Function> const LocalFunction) const noexcept;
	};

	bool Function::StrictEquals(Local<Function> const LocalFunction) const noexcept {
		return this == LocalFunction.m_pValue.get();
	}

	class Isolate {
	public:
		Local<Context> GetCurrentContext() const noexcept;
		bool IsExecutionTerminating() const noexcept;
		bool HasPendingException() const noexcept;
		Local<Context> m_Context;
	};

	Local<Context> Isolate::GetCurrentContext() const noexcept {
		return m_Context;
	}

	// Creation tests inject C++ reader actions, not JavaScript exceptions or termination.
	bool Isolate::IsExecutionTerminating() const noexcept {
		return false;
	}

	bool Isolate::HasPendingException() const noexcept {
		return false;
	}

	class TryCatch {
	public:
		explicit TryCatch(Isolate*) noexcept;
		bool HasCaught() const noexcept;
		void ReThrow() noexcept;
	};

	TryCatch::TryCatch(Isolate*) noexcept {
	}

	bool TryCatch::HasCaught() const noexcept {
		return false;
	}

	void TryCatch::ReThrow() noexcept {
	}
} // namespace v8

namespace {
	std::size_t g_unDestroyedHookCount = 0;
	std::size_t g_unInstalledHookCount = 0;
	std::size_t g_unReleasedThunkCount = 0;
	std::size_t g_unLoggedFailureCount = 0;
	char g_chHookThunkStorage = 0;
	char g_chPostThunkStorage = 0;
} // namespace

namespace Detours::Hook {
#if defined(DETOURS_ARCH_X86)
	constexpr std::size_t kX87StateByteCount = 108;

	// Opaque lifecycle-only storage, not a model of x87 instructions or fields.
	// The native thunk fixture separately uses the actual Detours context layout.
	struct alignas(std::uint32_t) RAW_CONTEXT_FPU {
		unsigned char m_arrBytes[kX87StateByteCount];
	};
#endif

	struct RAW_CONTEXT {
	};

	using PRAW_CONTEXT = RAW_CONTEXT*;

	using fnRawHookCallBack = bool(*)(PRAW_CONTEXT pRawContext);

	class RawHook {
	public:
		RawHook() noexcept;
		~RawHook() noexcept;
		bool Set(void* const pAddress) noexcept;
		bool Hook(fnRawHookCallBack const Callback, bool, unsigned int, bool, bool) noexcept;
		bool Release();

		bool m_bCanRelease;
		bool m_bThrowOnRelease;
		std::size_t m_unReleaseCount;
	};

	RawHook::RawHook() noexcept {
		m_bCanRelease = true;
		m_bThrowOnRelease = false;
		m_unReleaseCount = 0;
	}

	RawHook::~RawHook() noexcept {
		++g_unDestroyedHookCount;
	}

	bool RawHook::Set(void* const pAddress) noexcept {
		return pAddress != nullptr;
	}

	bool RawHook::Hook(fnRawHookCallBack const Callback, bool, unsigned int, bool, bool) noexcept {
		if (!Callback) {
			return false;
		}

		++g_unInstalledHookCount;

		return true;
	}

	bool RawHook::Release() {
		++m_unReleaseCount;

		if (m_bThrowOnRelease) {
			throw std::runtime_error("injected release failure");
		}

		return m_bCanRelease;
	}
} // namespace Detours::Hook

namespace SourceJS {
	class V8Runtime {
	public:
		explicit V8Runtime(v8::Isolate* const pIsolate) noexcept;
		v8::Isolate* GetIsolate() const noexcept;
		bool IsInitialized() const noexcept;

		v8::Isolate* m_pIsolate;
		bool m_bInitialized;
	};

	V8Runtime::V8Runtime(v8::Isolate* const pIsolate) noexcept :
		m_pIsolate(pIsolate)
	{
		m_bInitialized = true;
	}

	v8::Isolate* V8Runtime::GetIsolate() const noexcept {
		return m_pIsolate;
	}

	bool V8Runtime::IsInitialized() const noexcept {
		return m_bInitialized;
	}
} // namespace SourceJS

// @PRODUCTION_HEADER@

static_assert(!std::is_nothrow_default_constructible_v<SourceJS::MemoryHookManager>, "Memory hook manager construction may allocate.");

namespace {
	using fnPostAction = void(*)(SourceJS::MemoryHookManager& Manager, SourceJS::MemoryHookRecord const& HookRecord);

	constexpr std::uint64_t kCapturedArgumentBase = 0xFEDCBA9876543210;

	fnPostAction g_PostAction = nullptr;
	std::size_t g_unArgumentReadCount = 0;

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			std::fprintf(stderr, "[native] memory-hook lifecycle failure: %s\n", pszMessage);
			std::exit(1);
		}
	}
} // namespace

namespace SourceJS {
	void LogError(char const*, const int) noexcept {
		++g_unLoggedFailureCount;
	}

	// @PRODUCTION_DEFINITIONS@

	// Reduced dispatch-policy oracle only: callback execution, argument replay,
	// post snapshots and the eventual original invocation are explicit adapters.
	// The generated function copies the production commit/catch statements.
	enum class DispatchFailureStage {
		None = 0,
		BeforeCallback,
		ArgumentReplay,
		PostSnapshot
	};

	struct DispatchFailureProbe {
		DispatchFailureStage m_Stage;
		bool m_bInvokeTrampoline;
		bool m_bOverrideReturn;
		std::size_t m_unOriginalCalls;
	};

	struct DispatchCallbackState {
		bool m_bSkipOriginal;
	};

	// @PRODUCTION_DISPATCH_POLICY@

	// Reader actions simulate synchronous getter/coercion reentry into actual CreateFunction.
	void* MemoryHookManager::ReadAddress(v8::Isolate*, v8::Local<v8::Context>, v8::Local<v8::Object> const LocalOptions, char const*) const {
		if (LocalOptions->m_ReadAddressAction) {
			LocalOptions->m_ReadAddressAction(LocalOptions->m_pActionData);
		}

		return LocalOptions->m_pAddress;
	}

	MemoryHookSignature MemoryHookManager::BuildSignature(v8::Isolate*, v8::Local<v8::Context>, v8::Local<v8::Object> const LocalOptions) const {
		if (LocalOptions->m_ReadSignatureAction) {
			LocalOptions->m_ReadSignatureAction(LocalOptions->m_pActionData);
		}

		return {};
	}

	void* MemoryHookManager::CreateThunk(const int nHookID, std::size_t& unThunkSizeOut, const std::uintptr_t) const noexcept {
		if (nHookID <= 0) {
			return nullptr;
		}

		unThunkSizeOut = 1;

		return &g_chHookThunkStorage;
	}

	// Raw argument values are deterministic adapters; capture/commit is production code.
	std::uint64_t MemoryHookManager::ReadArgumentRaw(MemoryHookRecord const&, Detours::Hook::PRAW_CONTEXT, const int nArgumentIndex) const noexcept {
		++g_unArgumentReadCount;

		return kCapturedArgumentBase + static_cast<std::uint64_t>(nArgumentIndex);
	}

	// Executable thunk release and the V8 post loop are deliberately doubled.
	void MemoryHookManager::ReleaseThunk(void* const pThunk, const std::size_t) const noexcept {
		if (pThunk) {
			++g_unReleasedThunkCount;
		}
	}

	void MemoryHookManager::RunPostCallbacks(MemoryHookRecord const& HookRecord, MemoryHookPostFrame const&, MemoryHookPostContext*) {
		if (g_PostAction) {
			g_PostAction(*this, HookRecord);
		}
	}
} // namespace SourceJS

namespace {
	struct CreationReadScenario {
		SourceJS::MemoryHookManager* m_pManager;
		v8::Isolate* m_pIsolate;
		v8::Local<v8::Context> m_Context;
		v8::Local<v8::Object> m_NestedOptions;
		int m_nNestedID;
	};

	v8::Local<v8::Object> MakeCreationOptions(void* const pAddress, v8::fnCreationReadAction const ReadAddressAction = nullptr, v8::fnCreationReadAction const ReadSignatureAction = nullptr, void* const pActionData = nullptr) {
		return v8::Local<v8::Object>(std::make_shared<v8::Object>(pAddress, ReadAddressAction, ReadSignatureAction, pActionData));
	}

	void RegisterNestedHook(void* const pActionData) {
		auto* const pScenario = static_cast<CreationReadScenario*>(pActionData);
		Require(pScenario && pScenario->m_pManager && pScenario->m_pIsolate, "valid creation reader action context");
		pScenario->m_nNestedID = pScenario->m_pManager->CreateFunction(pScenario->m_pIsolate, pScenario->m_Context, pScenario->m_NestedOptions);
	}

	void ShutdownDuringCreation(void* const pActionData) {
		auto* const pScenario = static_cast<CreationReadScenario*>(pActionData);
		Require(pScenario && pScenario->m_pManager, "valid shutdown reader action context");
		pScenario->m_pManager->Shutdown();
	}

	void UnexpectedSignatureRead(void*) {
		Require(false, "existing-hook and exhausted-ID fast paths must not read the signature");
	}

	void CheckDispatchFailurePolicy() {
		constexpr SourceJS::DispatchFailureStage kStages[] = { SourceJS::DispatchFailureStage::None, SourceJS::DispatchFailureStage::BeforeCallback, SourceJS::DispatchFailureStage::ArgumentReplay, SourceJS::DispatchFailureStage::PostSnapshot };

		for (auto const& Stage : kStages) {
			for (auto const& bInvokeTrampoline : { false, true }) {
				for (auto const& bOverrideReturn : { false, true }) {
					SourceJS::DispatchFailureProbe Probe {};
					Probe.m_Stage = Stage;
					Probe.m_bInvokeTrampoline = bInvokeTrampoline;
					Probe.m_bOverrideReturn = bOverrideReturn;
					const std::size_t unFailuresBefore = g_unLoggedFailureCount;
					const bool bHandled = SourceJS::ExecuteDispatchFailureProbe(Probe, 73);
					if (!bHandled) {
						++Probe.m_unOriginalCalls;
					}

					const bool bOverrideReached = bOverrideReturn && (Stage != SourceJS::DispatchFailureStage::BeforeCallback) && (Stage != SourceJS::DispatchFailureStage::ArgumentReplay);
					const std::size_t unExpectedCalls = (!bInvokeTrampoline && bOverrideReached) ? 0 : 1;
					Require(Probe.m_unOriginalCalls == unExpectedCalls, "dispatch failure never repeats a completed original or loses required fallback");

					const bool bExpectedFailure = (Stage == SourceJS::DispatchFailureStage::BeforeCallback) || (Stage == SourceJS::DispatchFailureStage::ArgumentReplay) || ((Stage == SourceJS::DispatchFailureStage::PostSnapshot) && (bInvokeTrampoline || bOverrideReturn));
					Require(g_unLoggedFailureCount == (unFailuresBefore + (bExpectedFailure ? 1 : 0)), "dispatch failure is logged exactly once");
				}
			}
		}
	}

	void CheckReentrantCreation(const bool bSameAddress, const int nInitialID) {
		v8::Isolate Isolate {};
		v8::Local<v8::Context> const LocalContext(std::make_shared<v8::Context>());
		Isolate.m_Context = LocalContext;
		SourceJS::V8Runtime Runtime(&Isolate);
		SourceJS::MemoryHookManager Manager {};
		Manager.m_pV8Runtime = &Runtime;
		Manager.m_bInitialized = true;
		Manager.m_nNextHookID = nInitialID;
		char chOuterTarget = 0;
		char chNestedTarget = 0;
		void* const pNestedAddress = bSameAddress ? &chOuterTarget : &chNestedTarget;
		CreationReadScenario Scenario {};
		Scenario.m_pManager = &Manager;
		Scenario.m_pIsolate = &Isolate;
		Scenario.m_Context = LocalContext;
		Scenario.m_NestedOptions = MakeCreationOptions(pNestedAddress);
		v8::Local<v8::Object> const LocalOptions = MakeCreationOptions(&chOuterTarget, nullptr, RegisterNestedHook, &Scenario);
		const std::size_t unInstallationsBefore = g_unInstalledHookCount;
		bool bRecordCreated = true;
		const int nOuterID = Manager.CreateFunction(&Isolate, LocalContext, LocalOptions, &bRecordCreated);
		Require(Scenario.m_nNestedID == nInitialID, "nested creation uses the current identifier");
		std::shared_ptr<SourceJS::MemoryHookRecord> const pNestedRecord = Manager.FindRecord(Scenario.m_nNestedID);
		Require(pNestedRecord && (pNestedRecord->m_pAddress == pNestedAddress), "nested identifier resolves to its own native target");

		if (bSameAddress) {
			Require(!bRecordCreated, "reentrant reuse is not creation ownership");
			Require(nOuterID == Scenario.m_nNestedID, "same-address reentry reuses the registered record");
			Require((Manager.m_vecHookRecords.size() == 1) && (g_unInstalledHookCount == (unInstallationsBefore + 1)), "same-address reentry installs only once, including at ID exhaustion");

		} else if (nInitialID == std::numeric_limits<int>::max()) {
			Require(!bRecordCreated, "reentrant exhaustion leaves creation output false");
			Require((nOuterID == 0) && (Manager.m_nNextHookID == 0), "nested final-ID consumption rejects a new outer target");
			Require((Manager.m_vecHookRecords.size() == 1) && (g_unInstalledHookCount == (unInstallationsBefore + 1)), "exhaustion performs no second installation");

		} else {
			Require(bRecordCreated, "distinct outer target reports committed native creation");
			Require(nOuterID == (nInitialID + 1), "outer creation reads its identifier after the nested registration");
			Require((Manager.m_vecHookRecords.size() == 2) && (g_unInstalledHookCount == (unInstallationsBefore + 2)), "distinct reentrant targets produce two unique records");
			std::shared_ptr<SourceJS::MemoryHookRecord> const pOuterRecord = Manager.FindRecord(nOuterID);
			Require(pOuterRecord && (pOuterRecord->m_pAddress == &chOuterTarget), "outer identifier resolves to its own native target");
		}
	}

	void CheckCreationShutdown(const bool bFromAddressRead) {
		v8::Isolate Isolate {};
		v8::Local<v8::Context> const LocalContext(std::make_shared<v8::Context>());
		Isolate.m_Context = LocalContext;
		SourceJS::V8Runtime Runtime(&Isolate);
		SourceJS::MemoryHookManager Manager {};
		Manager.m_pV8Runtime = &Runtime;
		Manager.m_bInitialized = true;
		CreationReadScenario Scenario {};
		Scenario.m_pManager = &Manager;
		char chTarget = 0;
		v8::Local<v8::Object> const LocalOptions = MakeCreationOptions(&chTarget, bFromAddressRead ? ShutdownDuringCreation : nullptr, bFromAddressRead ? UnexpectedSignatureRead : ShutdownDuringCreation, &Scenario);
		const std::size_t unInstallationsBefore = g_unInstalledHookCount;
		bool bRecordCreated = true;
		Require(Manager.CreateFunction(&Isolate, LocalContext, LocalOptions, &bRecordCreated) == 0, "reader-triggered shutdown aborts creation");
		Require(!bRecordCreated, "shutdown cannot report ownership of a new record");
		Require(!Manager.m_bInitialized && Manager.m_vecHookRecords.empty() && (g_unInstalledHookCount == unInstallationsBefore), "reader-triggered shutdown installs no hook");
	}

	void CheckCreationFastPaths() {
		v8::Isolate Isolate {};
		v8::Local<v8::Context> const LocalContext(std::make_shared<v8::Context>());
		Isolate.m_Context = LocalContext;
		SourceJS::V8Runtime Runtime(&Isolate);
		SourceJS::MemoryHookManager Manager {};
		Manager.m_pV8Runtime = &Runtime;
		Manager.m_bInitialized = true;
		char chTarget = 0;
		v8::Local<v8::Object> const LocalInitialOptions = MakeCreationOptions(&chTarget);
		bool bRecordCreated = false;
		const int nInitialID = Manager.CreateFunction(&Isolate, LocalContext, LocalInitialOptions, &bRecordCreated);
		Require(nInitialID == 1, "initial production creation");
		Require(bRecordCreated, "fresh native record reports creation ownership");
		v8::Local<v8::Object> const LocalReuseOptions = MakeCreationOptions(&chTarget, nullptr, UnexpectedSignatureRead);
		bRecordCreated = true;
		Require(Manager.CreateFunction(&Isolate, LocalContext, LocalReuseOptions, &bRecordCreated) == nInitialID, "existing target fast path preserves ID without signature reads");
		Require(!bRecordCreated, "existing fast path resets stale creation output");
		constexpr std::uintptr_t kGuardedDispatch = 1;
		bRecordCreated = true;
		Require(Manager.CreateFunction(&Isolate, LocalContext, LocalReuseOptions, &bRecordCreated, kGuardedDispatch) == 0, "guarded registration does not reuse an ordinary hook");
		Require(!bRecordCreated, "dispatch mismatch cannot report ownership");

		char chGuardedTarget = 0;
		v8::Local<v8::Object> const LocalGuardedOptions = MakeCreationOptions(&chGuardedTarget);
		Require(Manager.CreateFunction(&Isolate, LocalContext, LocalGuardedOptions, &bRecordCreated, kGuardedDispatch) == 2, "a new guarded hook is installed independently");
		Require(bRecordCreated, "new guarded hook reports ownership");
		Require(Manager.CreateFunction(&Isolate, LocalContext, LocalGuardedOptions, &bRecordCreated) == 0, "ordinary registration does not inherit the guarded bridge");
		Require(!bRecordCreated, "ordinary registration cannot claim the guarded hook");

		char chOtherTarget = 0;
		Manager.m_nNextHookID = 0;
		v8::Local<v8::Object> const LocalExhaustedOptions = MakeCreationOptions(&chOtherTarget, nullptr, UnexpectedSignatureRead);
		bRecordCreated = true;
		Require(Manager.CreateFunction(&Isolate, LocalContext, LocalExhaustedOptions, &bRecordCreated) == 0, "already exhausted manager does not invoke signature readers");
		Require(!bRecordCreated, "identifier exhaustion leaves creation output false");
	}

	void CheckManagerConstruction() {
		SourceJS::MemoryHookManager Manager {};
		Require(!Manager.m_pV8Runtime && !Manager.m_pPostThunk && (Manager.m_unPostThunkSize == 0) && (Manager.m_nNextHookID == 1) && !Manager.m_bDisabled && !Manager.m_bInitialized, "production manager scalar defaults");
		Require(Manager.m_vecHookRecords.empty() && Manager.m_mapCallbacks.empty() && Manager.m_mapPostFrames.empty() && Manager.m_mapStringStorage.empty(), "production manager container defaults");
#if defined(_MSC_VER)
		bool bCaughtAllocationFailure = false;
		g_bFailNextManagerAllocation = true;
		try {
			SourceJS::MemoryHookManager FailedManager {};
			Require(!FailedManager.m_bInitialized, "constructed manager remains detached");
		} catch (std::bad_alloc const&) {
			bCaughtAllocationFailure = true;
		}

		const bool bAllocationAttempted = !g_bFailNextManagerAllocation;
		g_bFailNextManagerAllocation = false;
		Require(bAllocationAttempted && bCaughtAllocationFailure, "actual manager map allocation failure propagates without termination");
#endif
	}

	void PrepareManager(SourceJS::MemoryHookManager& Manager, SourceJS::V8Runtime& Runtime) {
		Manager.m_pV8Runtime = &Runtime;
		Manager.m_bInitialized = true;
		Manager.m_pPostThunk = &g_chPostThunkStorage;
		Manager.m_unPostThunkSize = 1;
	}

	std::shared_ptr<SourceJS::MemoryHookRecord> AddRecord(SourceJS::MemoryHookManager& Manager, const int nHookID) {
		std::shared_ptr<SourceJS::MemoryHookRecord> const pHookRecord = std::make_shared<SourceJS::MemoryHookRecord>();
		pHookRecord->m_nID = nHookID;
		pHookRecord->m_pAddress = pHookRecord.get();
		pHookRecord->m_pThunk = &g_chHookThunkStorage;
		pHookRecord->m_unThunkSize = 1;
		pHookRecord->m_pHook = std::make_unique<Detours::Hook::RawHook>();
		Manager.m_vecHookRecords.push_back(pHookRecord);

		return pHookRecord;
	}

	void AddOwner(SourceJS::MemoryHookRecord& HookRecord, v8::Isolate& Isolate, v8::Local<v8::Context> const LocalContext) {
		v8::Global<v8::Context> Owner {};
		Owner.Reset(&Isolate, LocalContext);
		HookRecord.m_vecOwnerContexts.push_back(std::move(Owner));
	}

	void CheckCallbackOwnership() {
		v8::Isolate Isolate {};
		SourceJS::V8Runtime Runtime(&Isolate);
		SourceJS::MemoryHookManager Manager {};
		PrepareManager(Manager, Runtime);
		std::shared_ptr<SourceJS::MemoryHookRecord> const pHookRecord = AddRecord(Manager, 1);
		v8::Local<v8::Function> const LocalFunction(std::make_shared<v8::Function>());
		Require(!Manager.AddCallback(1, SourceJS::HOOKTYPE_PRE, LocalFunction), "empty context must not register an ownerless callback");
		Require(Manager.m_mapCallbacks.empty(), "rejected registration must not change the registry");

		Isolate.m_Context = v8::Local<v8::Context>(std::make_shared<v8::Context>());
		Require(!Manager.AddCallback(99, SourceJS::HOOKTYPE_PRE, LocalFunction), "unknown hook");
		Require(!Manager.AddCallback(1, SourceJS::HOOKTYPE_PRE, {}), "empty callback");
		Require(Manager.AddCallback(1, SourceJS::HOOKTYPE_PRE, LocalFunction), "valid callback");

		// Fault injection: snapshots must reject either missing persistent handle.
		SourceJS::MemoryHookCallbackRecord MissingContext {};
		MissingContext.m_Function.Reset(&Isolate, LocalFunction);
		Manager.m_mapCallbacks[1][SourceJS::HOOKTYPE_PRE].push_back(std::move(MissingContext));
		SourceJS::MemoryHookCallbackRecord MissingFunction {};
		MissingFunction.m_Context.Reset(&Isolate, Isolate.m_Context);
		Manager.m_mapCallbacks[1][SourceJS::HOOKTYPE_PRE].push_back(std::move(MissingFunction));

		std::vector<SourceJS::MemoryHookCallbackRecord> const vecSnapshot = Manager.CopyCallbacks(1, SourceJS::HOOKTYPE_PRE, &Isolate);
		Require(vecSnapshot.size() == 1, "phase snapshot contains only complete callbacks");
		Manager.m_mapCallbacks[1][SourceJS::HOOKTYPE_PRE].pop_back();
		Manager.m_mapCallbacks[1][SourceJS::HOOKTYPE_PRE].pop_back();

		v8::Local<v8::Context> const LocalOwner = Isolate.m_Context;
		Isolate.m_Context = {};
		Require(!Manager.RemoveCallback(1, SourceJS::HOOKTYPE_PRE, LocalFunction), "empty context cannot remove a callback");

		Isolate.m_Context = v8::Local<v8::Context>(std::make_shared<v8::Context>());
		Require(!Manager.RemoveCallback(1, SourceJS::HOOKTYPE_PRE, LocalFunction), "other context cannot remove a callback");

		Isolate.m_Context = LocalOwner;
		Require(Manager.RemoveCallback(1, SourceJS::HOOKTYPE_PRE, LocalFunction), "owner removal");
		Require(Manager.m_mapCallbacks.empty(), "empty callback maps pruned");

		SourceJS::MemoryHookCallbackRecord const& Snapshot = vecSnapshot.front();
		Require(!Snapshot.m_Context.IsEmpty() && !Snapshot.m_Function.IsEmpty(), "independent snapshot handles survive callback reset");
		Require(Snapshot.m_Function.Get(&Isolate)->StrictEquals(LocalFunction), "snapshot preserves callback identity");
		Require(Manager.CopyCallbacks(1, SourceJS::HOOKTYPE_PRE, &Isolate).empty(), "future phase sees removal");

		Runtime.m_pIsolate = nullptr;
		Require(!Manager.AddCallback(1, SourceJS::HOOKTYPE_PRE, LocalFunction), "missing isolate");
		Runtime.m_pIsolate = &Isolate;
		Require(pHookRecord->m_nID == 1, "registration never changes record identity");
	}

	void CheckRecordOwnership() {
		constexpr int kLastGrowthHookID = 80;

		SourceJS::MemoryHookManager Manager {};
		std::shared_ptr<SourceJS::MemoryHookRecord> const pActiveRecord = AddRecord(Manager, 1);
		void* const pAddress = pActiveRecord->m_pAddress;
		Require(Manager.FindRecord(pAddress) == pActiveRecord, "address lookup retains the same record");
		Require(Manager.FindRecord(1) == pActiveRecord, "ID lookup retains the same record");

		for (int nHookID = 2; nHookID <= kLastGrowthHookID; ++nHookID) {
			AddRecord(Manager, nHookID);
		}

		Require(Manager.FindRecord(1).get() == pActiveRecord.get(), "vector growth cannot relocate an active record");
		pActiveRecord->m_pHook->m_bCanRelease = false;
		const std::size_t unReleasedBefore = g_unReleasedThunkCount;
		Require(!Manager.Remove(1), "busy release preserves ownership");
		Require((Manager.FindRecord(1) == pActiveRecord) && pActiveRecord->m_pThunk, "busy record and thunk retained");
		Require(g_unReleasedThunkCount == unReleasedBefore, "busy release cannot free executable memory");

		pActiveRecord->m_pHook->m_bThrowOnRelease = true;
		Require(!Manager.Remove(1), "release exception translated");
		pActiveRecord->m_pHook->m_bThrowOnRelease = false;

		pActiveRecord->m_pHook->m_bCanRelease = true;
		const std::size_t unDestroyedBefore = g_unDestroyedHookCount;
		Require(Manager.Remove(1), "successful release");
		Require(!Manager.FindRecord(1) && !Manager.FindRecord(pAddress), "record unpublished");
		Require((pActiveRecord->m_nID == 1) && pActiveRecord->m_pHook, "active owner keeps signature/native owner alive after unpublication");
		Require(!pActiveRecord->m_pThunk && (pActiveRecord->m_unThunkSize == 0), "released thunk state cleared");
		Require(g_unDestroyedHookCount == unDestroyedBefore, "record destruction deferred until active owner leaves");

		Require(Manager.RemoveAll(), "remaining records can be removed");
		Require(Manager.RemoveAll(), "empty cleanup is repeatable");
	}

	void CheckContextCleanup() {
		v8::Isolate Isolate {};
		SourceJS::V8Runtime Runtime(&Isolate);
		SourceJS::MemoryHookManager Manager {};
		PrepareManager(Manager, Runtime);
		Isolate.m_Context = v8::Local<v8::Context>(std::make_shared<v8::Context>());
		std::shared_ptr<SourceJS::MemoryHookRecord> const pFirst = AddRecord(Manager, 1);
		std::shared_ptr<SourceJS::MemoryHookRecord> const pBusy = AddRecord(Manager, 2);
		std::shared_ptr<SourceJS::MemoryHookRecord> const pOther = AddRecord(Manager, 3);
		AddOwner(*pFirst, Isolate, Isolate.m_Context);
		AddOwner(*pBusy, Isolate, Isolate.m_Context);
		v8::Local<v8::Context> const LocalOther(std::make_shared<v8::Context>());
		AddOwner(*pOther, Isolate, LocalOther);

		v8::Local<v8::Function> const LocalFunction(std::make_shared<v8::Function>());
		Require(Manager.AddCallback(1, SourceJS::HOOKTYPE_PRE, LocalFunction), "first owner callback");
		Require(Manager.AddCallback(2, SourceJS::HOOKTYPE_POST, LocalFunction), "busy owner callback");

		std::vector<SourceJS::MemoryHookCallbackRecord> const vecSnapshot = Manager.CopyCallbacks(1, SourceJS::HOOKTYPE_PRE, &Isolate);
		Require(vecSnapshot.size() == 1, "capture the active callback before context cleanup");

		pBusy->m_pHook->m_bCanRelease = false;
		Manager.RemoveContext({});
		Require(Manager.m_vecHookRecords.size() == 3, "empty context cleanup is inert");

		Manager.RemoveContext(Isolate.m_Context);
		Require(!Manager.FindRecord(1) && Manager.FindRecord(2) && Manager.FindRecord(3), "context cleanup removes owned idle hooks, retains busy/foreign hooks");
		Require(Manager.m_mapCallbacks.empty(), "owned callbacks removed even when native release is busy");

		SourceJS::MemoryHookCallbackRecord const& Snapshot = vecSnapshot.front();
		Require(!Snapshot.m_Context.IsEmpty() && !Snapshot.m_Function.IsEmpty(), "active phase keeps both handles after context cleanup");
		Require(pBusy->m_vecOwnerContexts.empty() && (pOther->m_vecOwnerContexts.size() == 1), "owner contexts pruned selectively");

		pBusy->m_pHook->m_bCanRelease = true;
		Manager.RemoveContext(Isolate.m_Context);
		Require(!Manager.FindRecord(2) && Manager.FindRecord(3), "busy cleanup can be retried");
	}

	void CheckArgumentCapture() {
		SourceJS::MemoryHookManager Manager {};
		SourceJS::MemoryHookRecord HookRecord {};
		Detours::Hook::RAW_CONTEXT RawContext {};
		std::vector<std::uint64_t> const vecPrevious = { 73, 74 };
		std::vector<std::uint64_t> vecArguments = vecPrevious;
		g_unArgumentReadCount = 0;
		Manager.CaptureArguments(HookRecord, nullptr, vecArguments);
		Require((vecArguments == vecPrevious) && (g_unArgumentReadCount == 0), "failed argument capture preserves output without reading native context");

		HookRecord.m_Signature.m_vecArgumentTypes = { SourceJS::DATA_TYPE_INT, SourceJS::DATA_TYPE_DOUBLE, SourceJS::DATA_TYPE_LONG_LONG };
		Manager.CaptureArguments(HookRecord, &RawContext, vecArguments);
		std::vector<std::uint64_t> const vecExpected = { kCapturedArgumentBase, kCapturedArgumentBase + 1, kCapturedArgumentBase + 2 };
		Require((vecArguments == vecExpected) && (g_unArgumentReadCount == vecExpected.size()), "successful argument capture commits all exact native words");

		HookRecord.m_Signature.m_vecArgumentTypes.clear();
		Manager.CaptureArguments(HookRecord, &RawContext, vecArguments);
		Require(vecArguments.empty() && (g_unArgumentReadCount == vecExpected.size()), "successful empty capture replaces the previous snapshot");
	}

	void RemoveDuringPost(SourceJS::MemoryHookManager& Manager, SourceJS::MemoryHookRecord const& HookRecord) {
		Require(!Manager.RemoveAll(), "in-progress post callback must block complete teardown");
		Manager.Shutdown();
		Require(Manager.m_bInitialized && Manager.m_pPostThunk, "shutdown must retain an active post thunk");
		const int nHookID = HookRecord.m_nID;
		Require(Manager.Remove(nHookID), "single-hook release double permits removal in post dispatch");
		Require((HookRecord.m_nID == nHookID) && HookRecord.m_pHook, "active post dispatcher retains the unpublished record");
		throw std::runtime_error("injected post failure");
	}

	void CheckPostReturnOwnership() {
		v8::Isolate Isolate {};
		SourceJS::V8Runtime Runtime(&Isolate);
		SourceJS::MemoryHookManager Manager {};
		PrepareManager(Manager, Runtime);
		AddRecord(Manager, 1);
		Isolate.m_Context = v8::Local<v8::Context>(std::make_shared<v8::Context>());
		v8::Local<v8::Function> const LocalFunction(std::make_shared<v8::Function>());
		Require(Manager.AddCallback(1, SourceJS::HOOKTYPE_POST, LocalFunction), "post callback");

		int nReturnSlot = 0;
		int nReturnTarget = 0;
		SourceJS::MemoryHookPostFrame PostFrame {};
		PostFrame.m_nHookID = 1;
		PostFrame.m_pReturnSlot = &nReturnSlot;
		PostFrame.m_pReturnAddress = &nReturnTarget;
		Manager.m_mapPostFrames.emplace(&nReturnSlot, std::move(PostFrame));

		SourceJS::MemoryHookPostContext PostContext {};
		Require(!Manager.RemoveAll(), "pending post frame must block teardown before mutation");
		Require(Manager.FindRecord(1) && Manager.HasCallbacks(1, SourceJS::HOOKTYPE_POST), "pending teardown preserves records/callbacks");

		Require(!Manager.HandlePostHook(nullptr, &PostContext), "null return slot");
		Require(!Manager.HandlePostHook(&nReturnSlot, nullptr), "null return context");

		g_PostAction = RemoveDuringPost;
		const std::size_t unLoggedBefore = g_unLoggedFailureCount;
		Require(Manager.HandlePostHook(&nReturnSlot, &PostContext) == &nReturnTarget, "throwing/reentrant post callback preserves original return address");
		g_PostAction = nullptr;
		Require(g_unLoggedFailureCount == (unLoggedBefore + 1), "post failure logged once");
		Require(Manager.m_mapPostFrames.empty(), "post frame released after dispatch");
		Require(!Manager.HandlePostHook(&nReturnSlot, &PostContext), "consumed post frame cannot be reused");

		Manager.Shutdown();
		Require(!Manager.m_bInitialized && !Manager.m_pPostThunk, "shutdown succeeds after post return");
	}
} // namespace

#if defined(SOURCEJS_LIFECYCLE_FIXTURE_OWNS_X64)
#undef DETOURS_ARCH_X64
#undef SOURCEJS_LIFECYCLE_FIXTURE_OWNS_X64
#endif
#if defined(SOURCEJS_LIFECYCLE_FIXTURE_OWNS_X86)
#undef DETOURS_ARCH_X86
#undef SOURCEJS_LIFECYCLE_FIXTURE_OWNS_X86
#endif

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fputs("Usage: MemoryHookLifecycleContracts\n", stderr);
		return 2;
	}

	CheckDispatchFailurePolicy();
	CheckManagerConstruction();
	CheckReentrantCreation(false, 1);
	CheckReentrantCreation(true, 1);
	CheckReentrantCreation(false, std::numeric_limits<int>::max());
	CheckReentrantCreation(true, std::numeric_limits<int>::max());
	CheckCreationShutdown(false);
	CheckCreationShutdown(true);
	CheckCreationFastPaths();
	CheckCallbackOwnership();
	CheckRecordOwnership();
	CheckContextCleanup();
	CheckArgumentCapture();
	CheckPostReturnOwnership();

	std::puts("[native] memory-hook lifecycle ownership, callback snapshots, argument capture and post-return cleanup passed");

	return 0;
}
