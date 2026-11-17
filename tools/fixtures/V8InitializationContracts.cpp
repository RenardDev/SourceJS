
// C++
#include <cstdarg>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// STL
#include <exception>
#include <memory>
#include <mutex>
#include <stdexcept>

// Template fixture, not standalone: compile through tools/smoke_plugin_manager_native_contracts.js.
// V8 API doubles instrument resource order; this is not a real-V8 process lifecycle test.
namespace Fixture {
	enum class Stage {
		None = 0,
		ICU,
		StartupData,
		Platform,
		RegisterPlatform,
		V8,
		Allocator,
		Isolate,
		Context,
		Install
	};

	enum class FailureKind {
		ReturnFailure = 0,
		StandardException,
		UnknownException
	};

	constexpr std::size_t kDiagnosticCapacity = 512;
	constexpr int kUnknownExceptionValue = 7;
	constexpr int kExpectedTerminationExitCode = 73;
	constexpr int kUnexpectedTerminationExitCode = 74;

	struct State {
		Stage m_Stage;
		FailureKind m_FailureKind;
		std::size_t m_unPlatformOwners;
		std::size_t m_unAllocatorOwners;
		std::size_t m_unScopeDepth;
		std::size_t m_unGlobalHandles;
		std::size_t m_unPlatformDisposals;
		std::size_t m_unV8Disposals;
		std::size_t m_unV8Initializations;
		bool m_bPlatformRegistered;
		bool m_bV8Live;
		bool m_bIsolateLive;
		bool m_bBadOrder;
		bool m_bRejectDisposal;
		bool m_bThrowDuringShutdown;
		char const* m_pszExpectedTerminationContext;
		char m_szLastError[kDiagnosticCapacity];
	};

	constinit State g_State {};

	bool FailAt(Stage const CurrentStage) {
		if (g_State.m_Stage != CurrentStage) {
			return false;
		}

		if (g_State.m_FailureKind == FailureKind::StandardException) {
			throw std::runtime_error("injected V8 initialization failure");
		}

		if (g_State.m_FailureKind == FailureKind::UnknownException) {
			throw kUnknownExceptionValue;
		}

		return true;
	}

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}
} // namespace Fixture

// Exact external V8 spellings are preserved by the narrow doubles below.
namespace v8 {
	class Platform {
	public:
		Platform();
		Platform(Platform const&) = delete;
		~Platform() noexcept;

		Platform& operator=(Platform const&) = delete;
	};

	struct ArrayBuffer {
		struct Allocator {
			Allocator();
			Allocator(Allocator const&) = delete;
			~Allocator() noexcept;

			Allocator& operator=(Allocator const&) = delete;

			static Allocator* NewDefaultAllocator();
		};
	};

	class Isolate {
	public:
		struct CreateParams {
			ArrayBuffer::Allocator* array_buffer_allocator;
		};

		class Scope {
		public:
			explicit Scope(Isolate* const pIsolate);
			Scope(Scope const&) = delete;
			~Scope() noexcept;

			Scope& operator=(Scope const&) = delete;
		};

		static Isolate* New(CreateParams const& Parameters);
		void Dispose() noexcept;
	};

	class HandleScope {
	public:
		explicit HandleScope(Isolate* const pIsolate);
		HandleScope(HandleScope const&) = delete;
		~HandleScope() noexcept;

		HandleScope& operator=(HandleScope const&) = delete;
	};

	template<typename TValue>
	struct Local {
		bool IsEmpty() const {
			return !m_pValue;
		}

		TValue* m_pValue;
	};

	struct Object {
	};

	struct Context {
		class Scope {
		public:
			explicit Scope(Local<Context> const ContextValue);
			Scope(Scope const&) = delete;
			~Scope() noexcept;

			Scope& operator=(Scope const&) = delete;
		};

		static Local<Context> New(Isolate* const pIsolate);
	};

	template<typename TValue>
	struct Global {
		void Reset() noexcept {
			if (m_bStored) {
				--Fixture::g_State.m_unGlobalHandles;
				m_bStored = false;
			}
		}

		void Reset(Isolate* const, Local<TValue> const Value) noexcept {
			Reset();
			m_bStored = !Value.IsEmpty();
			if (m_bStored) {
				++Fixture::g_State.m_unGlobalHandles;
			}
		}

		bool m_bStored;
	};

	class V8 {
	public:
		static bool InitializeICUDefaultLocation(char const*);
		static void InitializeExternalStartupData(char const*);
		static void InitializePlatform(Platform* const pPlatform);
		static bool Initialize();
		static bool Dispose() noexcept;
		static void DisposePlatform() noexcept;
	};

	constinit Isolate g_Isolate {};
	constinit Context g_Context {};
	constinit Object g_Object {};

	Platform::Platform() {
		++Fixture::g_State.m_unPlatformOwners;
	}

	Platform::~Platform() noexcept {
		Fixture::g_State.m_bBadOrder |= Fixture::g_State.m_bPlatformRegistered || Fixture::g_State.m_bV8Live || Fixture::g_State.m_bIsolateLive;
		--Fixture::g_State.m_unPlatformOwners;
	}

	ArrayBuffer::Allocator::Allocator() {
		++Fixture::g_State.m_unAllocatorOwners;
	}

	ArrayBuffer::Allocator::~Allocator() noexcept {
		Fixture::g_State.m_bBadOrder |= Fixture::g_State.m_bV8Live || Fixture::g_State.m_bIsolateLive;
		--Fixture::g_State.m_unAllocatorOwners;
	}

	ArrayBuffer::Allocator* ArrayBuffer::Allocator::NewDefaultAllocator() {
		if (Fixture::FailAt(Fixture::Stage::Allocator)) {
			return nullptr;
		}

		return new Allocator();
	}

	Isolate::Scope::Scope(Isolate* const pIsolate) {
		Fixture::Require(pIsolate != nullptr, "scope requires isolate");
		++Fixture::g_State.m_unScopeDepth;
	}

	Isolate::Scope::~Scope() noexcept {
		--Fixture::g_State.m_unScopeDepth;
	}

	Isolate* Isolate::New(CreateParams const& Parameters) {
		Fixture::Require(Parameters.array_buffer_allocator != nullptr, "isolate requires allocator");

		if (Fixture::FailAt(Fixture::Stage::Isolate)) {
			return nullptr;
		}

		Fixture::g_State.m_bIsolateLive = true;

		return &g_Isolate;
	}

	void Isolate::Dispose() noexcept {
		Fixture::g_State.m_bBadOrder |= !Fixture::g_State.m_bIsolateLive || (Fixture::g_State.m_unScopeDepth != 0) || (Fixture::g_State.m_unGlobalHandles != 0);
		Fixture::g_State.m_bIsolateLive = false;
	}

	HandleScope::HandleScope(Isolate* const pIsolate) {
		Fixture::Require(pIsolate != nullptr, "handle scope requires isolate");
		++Fixture::g_State.m_unScopeDepth;
	}

	HandleScope::~HandleScope() noexcept {
		--Fixture::g_State.m_unScopeDepth;
	}

	Context::Scope::Scope(Local<Context> const ContextValue) {
		Fixture::Require(!ContextValue.IsEmpty(), "context scope requires context");
		++Fixture::g_State.m_unScopeDepth;
	}

	Context::Scope::~Scope() noexcept {
		--Fixture::g_State.m_unScopeDepth;
	}

	Local<Context> Context::New(Isolate* const pIsolate) {
		Fixture::Require(pIsolate != nullptr, "context requires isolate");

		if (Fixture::FailAt(Fixture::Stage::Context)) {
			return {};
		}

		return Local<Context> { &g_Context };
	}

	bool V8::InitializeICUDefaultLocation(char const*) {
		return !Fixture::FailAt(Fixture::Stage::ICU);
	}

	void V8::InitializeExternalStartupData(char const*) {
		Fixture::FailAt(Fixture::Stage::StartupData);
	}

	void V8::InitializePlatform(Platform* const pPlatform) {
		Fixture::Require(pPlatform != nullptr, "platform registration requires owner");
		Fixture::FailAt(Fixture::Stage::RegisterPlatform);
		Fixture::g_State.m_bPlatformRegistered = true;
	}

	bool V8::Initialize() {
		++Fixture::g_State.m_unV8Initializations;

		if (Fixture::FailAt(Fixture::Stage::V8)) {
			return false;
		}

		Fixture::g_State.m_bV8Live = true;

		return true;
	}

	bool V8::Dispose() noexcept {
		if (Fixture::g_State.m_bRejectDisposal) {
			return false;
		}

		Fixture::g_State.m_bBadOrder |= !Fixture::g_State.m_bV8Live || Fixture::g_State.m_bIsolateLive;
		Fixture::g_State.m_bV8Live = false;
		++Fixture::g_State.m_unV8Disposals;

		return true;
	}

	void V8::DisposePlatform() noexcept {
		Fixture::g_State.m_bBadOrder |= !Fixture::g_State.m_bPlatformRegistered || Fixture::g_State.m_bV8Live;
		Fixture::g_State.m_bPlatformRegistered = false;
		++Fixture::g_State.m_unPlatformDisposals;
	}

	namespace platform {
		std::unique_ptr<Platform> NewDefaultPlatform() {
			if (Fixture::FailAt(Fixture::Stage::Platform)) {
				return {};
			}

			return std::make_unique<Platform>();
		}
	} // namespace platform
} // namespace v8

namespace SourceJS {
	struct RuntimePaths {
	};

	class V8Runtime {
	public:
		V8Runtime();
		~V8Runtime();

		bool Initialize(RuntimePaths const& RuntimePathConfiguration);
		void Shutdown();
		bool IsEmpty() const;
		bool IsReady() const;
		void ReleaseForFixture();

	private:
		bool InstallRuntimeObjects(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object>& LocalSourceJSOut);

	private:
		RuntimePaths const* m_pRuntimePaths;
		std::unique_ptr<v8::Platform> m_pPlatform;
		std::unique_ptr<v8::ArrayBuffer::Allocator> m_pArrayBufferAllocator;
		v8::Isolate* m_pIsolate;
		v8::Global<v8::Context> m_V8Context;
		v8::Global<v8::Object> m_SourceJSObject;
		std::mutex m_AsyncRequestMutex;
		bool m_bAcceptAsyncRequests;
		bool m_bInitialized;
	};

	void LogError(char const* const pszFormat, ...) noexcept {
		std::va_list ArgumentList;
		va_start(ArgumentList, pszFormat);
		const int nMessageLength = std::vsnprintf(Fixture::g_State.m_szLastError, Fixture::kDiagnosticCapacity, pszFormat, ArgumentList);
		va_end(ArgumentList);

		if ((nMessageLength < 0) || (static_cast<std::size_t>(nMessageLength) >= Fixture::kDiagnosticCapacity)) {
			std::fputs("V8 initialization fixture could not record the complete diagnostic.\n", stderr);
			std::abort();
		}
	}

	void LogInfo(char const*, ...) noexcept {
	}

	V8Runtime::V8Runtime() {
		m_pRuntimePaths = nullptr;
		m_pIsolate = nullptr;
		m_V8Context = {};
		m_SourceJSObject = {};
		m_bAcceptAsyncRequests = false;
		m_bInitialized = false;
	}

	// Shutdown is doubled here; only the extracted destructor's boundary is exercised.
	void V8Runtime::Shutdown() {
		if (!Fixture::g_State.m_bThrowDuringShutdown) {
			return;
		}

		if (Fixture::g_State.m_FailureKind == Fixture::FailureKind::UnknownException) {
			throw Fixture::kUnknownExceptionValue;
		}

		throw std::runtime_error("injected shutdown failure");
	}

	bool V8Runtime::IsEmpty() const {
		return !m_pRuntimePaths && !m_pPlatform && !m_pArrayBufferAllocator && !m_pIsolate && !m_V8Context.m_bStored && !m_SourceJSObject.m_bStored && !m_bAcceptAsyncRequests && !m_bInitialized;
	}

	bool V8Runtime::IsReady() const {
		return m_pRuntimePaths && m_pPlatform && m_pArrayBufferAllocator && m_pIsolate && m_V8Context.m_bStored && m_SourceJSObject.m_bStored && m_bAcceptAsyncRequests && m_bInitialized;
	}

	bool V8Runtime::InstallRuntimeObjects(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object>& LocalSourceJSOut) {
		Fixture::Require(!LocalContext.IsEmpty(), "installation requires context");

		if (Fixture::FailAt(Fixture::Stage::Install)) {
			return false;
		}

		LocalSourceJSOut = { &v8::g_Object };

		return true;
	}

	// Test-only success teardown; assertions do not claim to exercise production Shutdown.
	void V8Runtime::ReleaseForFixture() {
		m_V8Context.Reset();
		m_SourceJSObject.Reset();
		m_pIsolate->Dispose();
		m_pIsolate = nullptr;
		Fixture::Require(v8::V8::Dispose(), "fixture V8 disposal");
		v8::V8::DisposePlatform();
		m_pArrayBufferAllocator.reset();
		m_pPlatform.reset();
		m_pRuntimePaths = nullptr;
		m_bAcceptAsyncRequests = false;
		m_bInitialized = false;
	}
} // namespace SourceJS

// Generated included-only production definition; the preceding doubles are required.
#include "V8InitializationMethods.h"

namespace Fixture {
	void RunTerminationScenario(char const* const pszScenario) {
		g_State = {};
		SourceJS::g_bV8InitializationAttempted = false;
		const bool bRollbackFailure = std::strcmp(pszScenario, "--rollback-dispose-failure") == 0;
		g_State.m_pszExpectedTerminationContext = bRollbackFailure ? "V8Runtime.Initialize rollback failed:" : "V8Runtime destruction failed:";
		std::set_terminate([]() noexcept {
			const bool bExpectedContext = g_State.m_pszExpectedTerminationContext && std::strstr(g_State.m_szLastError, g_State.m_pszExpectedTerminationContext);
			std::_Exit(bExpectedContext ? kExpectedTerminationExitCode : kUnexpectedTerminationExitCode);
		});

		SourceJS::RuntimePaths Paths {};
		SourceJS::V8Runtime Runtime {};
		if (bRollbackFailure) {
			g_State.m_Stage = Stage::Allocator;
			g_State.m_bRejectDisposal = true;
			Runtime.Initialize(Paths);
			return;
		}

		Require(Runtime.Initialize(Paths), "termination fixture initialization");
		g_State.m_bThrowDuringShutdown = true;
		g_State.m_FailureKind = (std::strcmp(pszScenario, "--destructor-unknown") == 0) ? FailureKind::UnknownException : FailureKind::StandardException;
	}

	void CheckFailure(Stage const FailureStage, FailureKind const Kind) {
		// Independent cases simulate separate processes; production never resets this guard.
		SourceJS::g_bV8InitializationAttempted = false;
		g_State = {};
		g_State.m_Stage = FailureStage;
		g_State.m_FailureKind = Kind;
		SourceJS::RuntimePaths Paths {};
		SourceJS::V8Runtime Runtime {};
		Require(!Runtime.Initialize(Paths), "injected failure returns false");
		Require(Runtime.IsEmpty(), "failure clears all acquired runtime fields and readiness flags");
		Require((g_State.m_unPlatformOwners == 0) && (g_State.m_unAllocatorOwners == 0) && (g_State.m_unScopeDepth == 0) && (g_State.m_unGlobalHandles == 0), "failure releases owners and unwinds scopes");
		Require(!g_State.m_bV8Live && !g_State.m_bPlatformRegistered && !g_State.m_bIsolateLive && !g_State.m_bBadOrder, "failure teardown respects resource order");

		const std::size_t unExpectedPlatformDisposals = (FailureStage > Stage::RegisterPlatform) ? 1 : 0;
		const std::size_t unExpectedV8Disposals = (FailureStage > Stage::V8) ? 1 : 0;
		Require(g_State.m_unPlatformDisposals == unExpectedPlatformDisposals, "only successfully registered platform is disposed");
		Require(g_State.m_unV8Disposals == unExpectedV8Disposals, "only successfully initialized V8 is disposed");

		if (Kind != FailureKind::ReturnFailure) {
			Require(std::strstr(g_State.m_szLastError, "V8Runtime.Initialize failed:") != nullptr, "exception diagnostics preserve initialization context");
		}

		const bool bV8Attempted = FailureStage >= Stage::V8;
		Require(SourceJS::g_bV8InitializationAttempted == bV8Attempted, "only a V8 initialization attempt consumes the process-global guard");
		g_State.m_Stage = Stage::None;

		if (bV8Attempted) {
			const std::size_t unV8Initializations = g_State.m_unV8Initializations;
			Require(!Runtime.Initialize(Paths) && Runtime.IsEmpty(), "late failure cannot restart V8");
			Require(g_State.m_unV8Initializations == unV8Initializations, "restart rejection precedes another native V8 initialization");
			Require(std::strstr(g_State.m_szLastError, "restart the server process") != nullptr, "restart rejection explains recovery");

		} else {
			Require(Runtime.Initialize(Paths) && Runtime.IsReady(), "failure before V8 initialization remains retryable");
			Runtime.ReleaseForFixture();
			Require(Runtime.IsEmpty() && !g_State.m_bBadOrder, "early failure retry retains valid cleanup order");
		}
	}
} // namespace Fixture

int main(const int nArgumentCount, char** const ppszArguments) {
	constexpr Fixture::Stage kReturnFailures[] = { Fixture::Stage::ICU, Fixture::Stage::Platform, Fixture::Stage::V8, Fixture::Stage::Allocator, Fixture::Stage::Isolate, Fixture::Stage::Context, Fixture::Stage::Install };
	constexpr Fixture::Stage kExceptionStages[] = { Fixture::Stage::ICU, Fixture::Stage::StartupData, Fixture::Stage::Platform, Fixture::Stage::RegisterPlatform, Fixture::Stage::V8, Fixture::Stage::Allocator, Fixture::Stage::Isolate, Fixture::Stage::Context, Fixture::Stage::Install };
	constexpr Fixture::FailureKind kExceptionKinds[] = { Fixture::FailureKind::StandardException, Fixture::FailureKind::UnknownException };

	if (nArgumentCount != 1) {
		if ((nArgumentCount != 2) || ((std::strcmp(ppszArguments[1], "--destructor-standard") != 0) && (std::strcmp(ppszArguments[1], "--destructor-unknown") != 0) && (std::strcmp(ppszArguments[1], "--rollback-dispose-failure") != 0))) {
			std::fputs("Usage: V8InitializationContracts [--destructor-standard|--destructor-unknown|--rollback-dispose-failure]\n", stderr);
			return 2;
		}

		Fixture::RunTerminationScenario(ppszArguments[1]);
		return 1;
	}

	try {
		for (auto const& Stage : kReturnFailures) {
			Fixture::CheckFailure(Stage, Fixture::FailureKind::ReturnFailure);
		}

		for (auto const& Stage : kExceptionStages) {
			for (auto const& Kind : kExceptionKinds) {
				Fixture::CheckFailure(Stage, Kind);
			}
		}

		Fixture::g_State = {};
		SourceJS::g_bV8InitializationAttempted = false;
		SourceJS::RuntimePaths Paths {};
		SourceJS::V8Runtime Runtime {};
		Fixture::Require(Runtime.Initialize(Paths) && Runtime.IsReady(), "successful initialization commits readiness");
		Fixture::Require(Runtime.Initialize(Paths) && Runtime.IsReady() && (Fixture::g_State.m_unPlatformOwners == 1) && (Fixture::g_State.m_unAllocatorOwners == 1), "already initialized runtime acquires no new owners");
		SourceJS::V8Runtime SecondRuntime {};
		Fixture::Require(!SecondRuntime.Initialize(Paths) && SecondRuntime.IsEmpty() && Runtime.IsReady(), "second runtime cannot replace the live process-global V8 instance");
		Runtime.ReleaseForFixture();
		Fixture::Require(Runtime.IsEmpty() && !Fixture::g_State.m_bBadOrder, "fixture success cleanup");
		Fixture::Require(!Runtime.Initialize(Paths) && Runtime.IsEmpty(), "disposed runtime cannot restart V8");
		Fixture::Require(!SecondRuntime.Initialize(Paths) && SecondRuntime.IsEmpty() && (Fixture::g_State.m_unV8Initializations == 1), "fresh runtime cannot bypass permanent V8 disposal");
		std::puts("V8 initialization contracts passed (extracted Initialize; V8 API doubles).");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "V8 initialization contract failed: %s\n", Exception.what());
		return 1;
	}
}
