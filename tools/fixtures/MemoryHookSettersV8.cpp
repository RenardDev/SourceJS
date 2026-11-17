
// General
#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_SETTER_FIXTURE_OWNS_NOMINMAX
#endif
#include <Windows.h>
#if defined(SOURCEJS_SETTER_FIXTURE_OWNS_NOMINMAX)
#undef SOURCEJS_SETTER_FIXTURE_OWNS_NOMINMAX
#undef NOMINMAX
#endif
#endif

// C++
#include <cfenv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <utility>

// STL
#include <array>
#include <bit>
#include <initializer_list>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <new>
#include <stdexcept>
#include <string>
#include <vector>

// Third-party
#include <Detours.h>
#include <libplatform/libplatform.h>
#include <v8.h>

namespace SourceJS {
@DATA_TYPE@

@HOOK_TYPE@

@POST_CONTEXT@

@POST_FRAME@

@CALLBACK_RECORD@

@SIGNATURE_TYPE@

@SIGNATURE_CONSTRUCTOR@

	using fnDisposeIsolate = void(*)(v8::Isolate*);

	// Records/native-hook handles, string ownership and argument writes are adapters.
	// V8, Detours layouts, readers, setters, result decoding and inventory are real.
	// A borrowed trampoline sentinel, never installed or called.
	struct FixtureHook {
		void* GetTrampoline() const noexcept {
			return nullptr;
		}
	};

	struct MemoryHookRecord {
		int m_nID;
		MemoryHookSignature m_Signature;
		FixtureHook* m_pHook;
		void* m_pAddress;
	};

	// Only runtime availability is adapted; JavaScript execution uses the real isolate.
	class V8Runtime {
	public:
		explicit V8Runtime(v8::Isolate* pIsolate);
		bool IsInitialized() const noexcept;
		v8::Isolate* GetIsolate() const noexcept;

	private:
		v8::Isolate* m_pIsolate;
	};

	V8Runtime::V8Runtime(v8::Isolate* const pIsolate) :
		m_pIsolate(pIsolate)
	{
	}

	bool V8Runtime::IsInitialized() const noexcept {
		return m_pIsolate != nullptr;
	}

	v8::Isolate* V8Runtime::GetIsolate() const noexcept {
		return m_pIsolate;
	}

	class MemoryHookManager {
	public:
		MemoryHookManager();
		bool SetArgumentFromValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT pRawContext, int nArgumentIndex, v8::Isolate* pIsolate, v8::Local<v8::Context> LocalContext, v8::Local<v8::Value> LocalValue);
		bool SetReturnFromValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT pRawContext, v8::Isolate* pIsolate, v8::Local<v8::Context> LocalContext, v8::Local<v8::Value> LocalValue);
		v8::Local<v8::Value> MakeDataTypeValue(DATA_TYPE DataType, std::uint64_t unDataValue, v8::Isolate* pIsolate) const;
		v8::Local<v8::Value> GetReturnValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT pRawContext, v8::Isolate* pIsolate) const;
		v8::Local<v8::Array> GetHooks(v8::Isolate* pIsolate, v8::Local<v8::Context> LocalContext) const;
		std::shared_ptr<MemoryHookRecord> FindRecord(int nHookID) noexcept;
		std::shared_ptr<MemoryHookRecord> FindRecord(void const* pAddress) noexcept;
		MemoryHookSignature BuildSignature(v8::Isolate* pIsolate, v8::Local<v8::Context> LocalContext, v8::Local<v8::Object> LocalOptions) const;
		void* ReadAddress(v8::Isolate* pIsolate, v8::Local<v8::Context> LocalContext, v8::Local<v8::Object> LocalOptions, char const* pszName) const;
		void* ReadVTableAddress(v8::Isolate* pIsolate, v8::Local<v8::Context> LocalContext, v8::Local<v8::Object> LocalOptions) const;
		DATA_TYPE ReadDataType(v8::Isolate* pIsolate, v8::Local<v8::Value> LocalValue) const;
		std::vector<DATA_TYPE> ReadArgumentTypes(v8::Isolate* pIsolate, v8::Local<v8::Context> LocalContext, v8::Local<v8::Object> LocalOptions) const;
		void WriteArgumentRaw(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT pRawContext, int nArgumentIndex, std::uint64_t unValue);
		char const* StoreString(int nHookID, std::string const& strValue);
		bool HandleHook(int nHookID, Detours::Hook::PRAW_CONTEXT pRawContext);
		std::vector<MemoryHookCallbackRecord> CopyCallbacks(int nHookID, HOOK_TYPE HookType, v8::Isolate* pIsolate) const;
		v8::Local<v8::Value> GetArgumentValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT pRawContext, int nArgumentIndex, v8::Isolate* pIsolate) const;
		std::uintptr_t* GetStackSlot(Detours::Hook::PRAW_CONTEXT pRawContext, std::size_t unOffset) const noexcept;
		bool InstallPostFrame(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT pRawContext);
		void RunPostCallbacks(MemoryHookRecord const& HookRecord, MemoryHookPostFrame const& PostFrame, PMemoryHookPostContext pPostContext);
		static void LoadReturnContext(MemoryHookPostContext const& PostContext, Detours::Hook::RAW_CONTEXT& RawContextOut) noexcept;
		static void StoreReturnContext(Detours::Hook::RAW_CONTEXT const& RawContext, MemoryHookPostContext& PostContextOut) noexcept;

		std::size_t m_unWrites;
		std::uint64_t m_unArgument;
		std::list<std::string> m_lstStrings;
		bool m_bRejectStorage;
		std::vector<std::shared_ptr<MemoryHookRecord>> m_vecHookRecords;
		V8Runtime* m_pV8Runtime;
		bool m_bDisabled;
		std::size_t m_unPostFrames;
		std::map<int, std::map<HOOK_TYPE, std::vector<MemoryHookCallbackRecord>>> m_mapCallbacks;
	};

	MemoryHookManager::MemoryHookManager() {
		m_unWrites = 0;
		m_unArgument = 0;
		m_bRejectStorage = false;
		m_pV8Runtime = nullptr;
		m_bDisabled = false;
		m_unPostFrames = 0;
	}

	void MemoryHookManager::WriteArgumentRaw(MemoryHookRecord const&, Detours::Hook::PRAW_CONTEXT, int, const std::uint64_t unValue) {
		++m_unWrites;
		m_unArgument = unValue;
	}

	char const* MemoryHookManager::StoreString(int, std::string const& strValue) {
		if (m_bRejectStorage) {
			throw std::bad_alloc {};
		}

		m_lstStrings.push_back(strValue);

		return m_lstStrings.back().c_str();
	}

	// Only string-creation failure is injected; successful calls still execute the real V8 API.
	bool g_bFailStringCreation = false;

	v8::MaybeLocal<v8::String> CreateFixtureString(v8::Isolate* const pIsolate, char const* const pszValue, const v8::NewStringType StringType) {
		if (g_bFailStringCreation) {
			return {};
		}

		return v8::String::NewFromUtf8(pIsolate, pszValue, StringType);
	}

@RUNTIME_STRING@

@READERS@

@HOOK_CONTEXT_HELPERS@

	// Entity lookup is a fixture adapter, not an SDK/entity-lifetime test.
	void* g_pFixtureEntity = nullptr;

	void* FindBaseEntityByIndex(const int nEntityIndex) {
		return (nEntityIndex == 7) ? g_pFixtureEntity : nullptr;
	}

@SIGNATURE_HELPERS@

#if defined(DETOURS_ARCH_X86)
	constexpr std::size_t kX87StateByteCount = sizeof(Detours::Hook::RAW_CONTEXT_FPU);
	constexpr std::size_t kX87StateAlignment = 16;

	static_assert(kX87StateByteCount == 108);

@X87_HELPERS@
#endif

@SETTERS@

@DECODER@

	// Native argument reads and post-frame installation are explicit adapters.
	v8::Local<v8::Value> MemoryHookManager::GetArgumentValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex, v8::Isolate* const pIsolate) const {
		if (!pIsolate) {
			return {};
		}

		if (!pRawContext || (nArgumentIndex < 0) || (static_cast<std::size_t>(nArgumentIndex) >= HookRecord.m_Signature.m_vecArgumentTypes.size())) {
			return v8::Undefined(pIsolate);
		}

		const DATA_TYPE ArgumentType = HookRecord.m_Signature.m_vecArgumentTypes[static_cast<std::size_t>(nArgumentIndex)];

		return MakeDataTypeValue(ArgumentType, m_unArgument, pIsolate);
	}

	bool MemoryHookManager::InstallPostFrame(MemoryHookRecord const&, Detours::Hook::PRAW_CONTEXT) {
		++m_unPostFrames;

		return true;
	}

	void LogError(char const* const pszMessage, const int nHookID) {
		std::fprintf(stderr, pszMessage, nHookID);
		std::fprintf(stderr, "\n");
	}

	std::size_t g_unTrampolineCompletions = 0;

	// Deliberately does not execute a native address. It models only the completion commit.
	void CallHookTrampolineCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
		auto* const pCallContext = FindCallContextFromArguments(Arguments);
		if (!pCallContext) {
			return;
		}

		++g_unTrampolineCompletions;
		pCallContext->m_bSkipOriginal = true;
	}

@DISPATCHER@

@POST_DISPATCHER@

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	v8::Local<v8::Value> Evaluate(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, char const* const pszSource) {
		v8::Local<v8::Script> LocalScript {};
		Require(v8::Script::Compile(LocalContext, MakeString(pIsolate, pszSource)).ToLocal(&LocalScript), "Compile fixture expression");
		v8::Local<v8::Value> LocalResult {};
		Require(LocalScript->Run(LocalContext).ToLocal(&LocalResult), "Evaluate fixture expression");

		return LocalResult;
	}

	void StopDispatchExecution(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
		Arguments.GetIsolate()->TerminateExecution();
	}

	void RegisterDispatchCallback(MemoryHookManager& Manager, v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, const HOOK_TYPE HookType, char const* const pszSource) {
		v8::Local<v8::Value> const LocalValue = Evaluate(pIsolate, LocalContext, pszSource);
		Require(LocalValue->IsFunction(), "Dispatch callback must be a function");
		MemoryHookCallbackRecord Record {};
		Record.m_Context.Reset(pIsolate, LocalContext);
		Record.m_Function.Reset(pIsolate, LocalValue.As<v8::Function>());
		Manager.m_mapCallbacks[7][HookType].push_back(std::move(Record));
	}

	std::shared_ptr<MemoryHookRecord> CreateDispatchRecord(MemoryHookManager& Manager, V8Runtime& Runtime, FixtureHook& Hook) {
		Manager.m_pV8Runtime = &Runtime;
		std::shared_ptr<MemoryHookRecord> const pRecord = std::make_shared<MemoryHookRecord>();
		pRecord->m_nID = 7;
		pRecord->m_pHook = &Hook;
		pRecord->m_pAddress = nullptr;
		pRecord->m_Signature.m_vecArgumentTypes = { DATA_TYPE_FLOAT, DATA_TYPE_FLOAT };
		pRecord->m_Signature.m_ReturnType = DATA_TYPE_FLOAT;
		Manager.m_vecHookRecords.push_back(pRecord);

		return pRecord;
	}

	void CheckDispatchFailure(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, char const* const pszCallback, const bool bExpectedSkip, const std::size_t unExpectedWrites, const int nExpectedReads, const int nExpectedLaterCallbacks = 0, char const* const pszPostCallback = nullptr, const bool bTermination = false, const bool bInitiallyPending = false) {
		V8Runtime Runtime(pIsolate);
		MemoryHookManager Manager {};
		FixtureHook Hook {};
		CreateDispatchRecord(Manager, Runtime, Hook);
		g_unTrampolineCompletions = 0;

		Evaluate(pIsolate, LocalContext, "globalThis.g_DispatchError = new Error('dispatch failure'); globalThis.g_unReplayReads = 0; globalThis.g_unLaterCallbacks = 0; globalThis.g_Payload = null;");
		v8::Local<v8::Value> const LocalExpectedError = Evaluate(pIsolate, LocalContext, "g_DispatchError");
		RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_PRE, pszCallback);
		RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_PRE, "(Payload) => { ++g_unLaterCallbacks; }");

		if (pszPostCallback) {
			RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_POST, pszPostCallback);
			RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_POST, "(Payload) => { ++g_unLaterCallbacks; }");
		}

		std::uintptr_t arrStack[4] {};
		Detours::Hook::RAW_CONTEXT RawContext {};
		RawContext.m_Stack.SetAddress(&arrStack[3]);
		v8::TryCatch Failure(pIsolate);
		if (bInitiallyPending) {
			pIsolate->ThrowException(LocalExpectedError);
		}

		const bool bHandled = Manager.HandleHook(7, &RawContext);
		const bool bCaught = Failure.HasCaught();
		const bool bTerminated = Failure.HasTerminated() || pIsolate->IsExecutionTerminating();
		v8::Local<v8::Value> const LocalException = Failure.Exception();
		const bool bOriginalError = !LocalException.IsEmpty() && LocalException->StrictEquals(LocalExpectedError);
		void* const pFinalStackAddress = RawContext.m_Stack.GetAddress();

		// Only the fixture clears termination/caught state, after observing production behavior.
		if (bTermination) {
			pIsolate->CancelTerminateExecution();
		}

		Failure.Reset();
		Require(bHandled == bExpectedSkip, "Stopped dispatcher preserves the original-call decision");
		Require(pFinalStackAddress == &arrStack[3], "Stopped dispatcher must not push a second trampoline");
		Require(bCaught || bTerminated, "Dispatch failure must remain observable");
		Require(bTermination ? bTerminated : bOriginalError, "Dispatch preserves original exception or termination");
		Require(Manager.m_unWrites == unExpectedWrites, "Stopped dispatcher does not replay more arguments");
		Require(Manager.m_unPostFrames == 0, "Stopped dispatcher does not schedule a post frame");
		Require(Evaluate(pIsolate, LocalContext, "g_unReplayReads").As<v8::Int32>()->Value() == nExpectedReads, "Stopped dispatcher does not execute later getters/coercions");
		Require(Evaluate(pIsolate, LocalContext, "g_unLaterCallbacks").As<v8::Int32>()->Value() == nExpectedLaterCallbacks, "Stopped dispatcher does not execute later callbacks");
		Evaluate(pIsolate, LocalContext, "delete Object.prototype.HookID; if ((g_Payload !== null) && (typeof g_Payload.SetHookArgument === 'function')) { g_Payload.SetHookArgument(0, 44); }");
		Require(Manager.m_unWrites == unExpectedWrites, "Stopped payload methods cannot retain a live frame");
	}

	void CheckDispatchFailures(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		Require(SetFunction(pIsolate, LocalContext, LocalContext->Global(), "StopDispatchExecution", StopDispatchExecution, v8::Undefined(pIsolate)), "Install fixture termination callback");
		CheckDispatchFailure(pIsolate, LocalContext, R"JS((Payload) => {
			g_Payload = Payload;
			Object.defineProperty(Payload.Arguments, 0, { get() { ++g_unReplayReads; throw new Error("replacement"); } });
			throw g_DispatchError;
		})JS", false, 0, 0);
		CheckDispatchFailure(pIsolate, LocalContext, R"JS((Payload) => {
			g_Payload = Payload;
			Payload.CallHookTrampoline();
			Object.defineProperty(Payload.Arguments, 0, { get() { ++g_unReplayReads; throw new Error("replacement"); } });
			throw g_DispatchError;
		})JS", true, 0, 0);
		Require(g_unTrampolineCompletions == 1, "Completed trampoline adapter executes exactly once");

		CheckDispatchFailure(pIsolate, LocalContext, R"JS((Payload) => {
			g_Payload = Payload;
			Object.defineProperty(Payload.Arguments, 0, { get() { ++g_unReplayReads; throw g_DispatchError; } });
			Object.defineProperty(Payload.Arguments, 1, { get() { g_unReplayReads += 100; return 9; } });
		})JS", false, 0, 1);
		CheckDispatchFailure(pIsolate, LocalContext, R"JS((Payload) => {
			g_Payload = Payload;
			Payload.Arguments[0] = { valueOf() { ++g_unReplayReads; throw g_DispatchError; } };
			Object.defineProperty(Payload.Arguments, 1, { get() { g_unReplayReads += 100; return 9; } });
		})JS", false, 0, 1);
		CheckDispatchFailure(pIsolate, LocalContext, R"JS((Payload) => {
			g_Payload = Payload;
			Object.defineProperty(Payload.Arguments, 1, { get() { ++g_unReplayReads; throw g_DispatchError; } });
			return { valueOf() { g_unReplayReads += 100; throw new Error("replacement"); } };
		})JS", false, 1, 1);
		CheckDispatchFailure(pIsolate, LocalContext, R"JS((Payload) => {
			g_Payload = Payload;
			return { valueOf() { ++g_unReplayReads; throw g_DispatchError; } };
		})JS", false, 2, 1);
		CheckDispatchFailure(pIsolate, LocalContext, "(Payload) => 7", true, 4, 0, 1, "(Payload) => { g_Payload = Payload; throw g_DispatchError; }");
		CheckDispatchFailure(pIsolate, LocalContext, "(Payload) => 7", true, 4, 1, 1, "(Payload) => ({ valueOf() { ++g_unReplayReads; throw g_DispatchError; } })");
		CheckDispatchFailure(pIsolate, LocalContext, "(Payload) => 7", true, 4, 0, 1, "(Payload) => { g_Payload = Payload; StopDispatchExecution(); while (true) {} }", true);
		CheckDispatchFailure(pIsolate, LocalContext, R"JS((Payload) => {
			g_Payload = Payload;
			Object.defineProperty(Payload.Arguments, 0, { get() { ++g_unReplayReads; return 9; } });
			StopDispatchExecution();
			while (true) {}
		})JS", false, 0, 0, 0, nullptr, true);
		CheckDispatchFailure(pIsolate, LocalContext, "(Payload) => { g_Payload = Payload; Payload.CallHookTrampoline(); StopDispatchExecution(); while (true) {} }", true, 0, 0, 0, nullptr, true);
		Require(g_unTrampolineCompletions == 1, "Termination preserves completed trampoline invocation");

		CheckDispatchFailure(pIsolate, LocalContext, "(Payload) => { ++g_unLaterCallbacks; }", false, 0, 0, 0, nullptr, false, true);
		CheckDispatchFailure(pIsolate, LocalContext, "Object.defineProperty(Object.prototype, 'HookID', { configurable: true, set() { throw g_DispatchError; } }); (Payload) => { ++g_unLaterCallbacks; }", false, 0, 0);
	}

	void CheckDispatchSuccess(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, const bool bSkipOriginal) {
		V8Runtime Runtime(pIsolate);
		MemoryHookManager Manager {};
		FixtureHook Hook {};
		std::shared_ptr<MemoryHookRecord> const pRecord = CreateDispatchRecord(Manager, Runtime, Hook);
		pRecord->m_Signature.m_vecArgumentTypes = { DATA_TYPE_FLOAT, DATA_TYPE_UINT };
		Manager.m_unArgument = std::bit_cast<std::uint32_t>(1.0F);

		Evaluate(pIsolate, LocalContext, "globalThis.g_strDispatchOrder = '';");
		Evaluate(pIsolate, LocalContext, bSkipOriginal ? "globalThis.g_bDispatchSkipOriginal = true;" : "globalThis.g_bDispatchSkipOriginal = false;");
		RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_PRE, R"JS((Payload) => {
			if ((Payload.Arguments[0] !== 1) || (Payload.Arguments[1] !== 0x3F800000)) {
				throw new Error("Dispatcher did not decode both argument types.");
			}

			g_strDispatchOrder += "A";

			if (g_bDispatchSkipOriginal) {
				return 7;
			}

			Payload.Arguments[0] = 9;
		})JS");
		RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_PRE, "(Payload) => { g_strDispatchOrder += 'B'; }");
		RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_POST, "(Payload) => { g_strDispatchOrder += 'C'; }");
		RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_POST, "(Payload) => { g_strDispatchOrder += 'D'; }");

		std::uintptr_t arrStack[4] {};
		Detours::Hook::RAW_CONTEXT RawContext {};
		RawContext.m_Stack.SetAddress(&arrStack[3]);
		Require(Manager.HandleHook(7, &RawContext), "Successful dispatcher handles the call");
		Require(!pIsolate->HasPendingException() && !pIsolate->IsExecutionTerminating(), "Successful dispatch leaves JavaScript usable");
		Require(Manager.m_unWrites == 4, "Successful dispatch replays both arguments for both pre callbacks");
		const std::size_t unExpectedPostFrames = bSkipOriginal ? 0 : 1;
		Require(Manager.m_unPostFrames == unExpectedPostFrames, "Successful original call schedules one post frame adapter");
		Require(RawContext.m_Stack.GetAddress() == (bSkipOriginal ? &arrStack[3] : &arrStack[2]), "Successful dispatch preserves trampoline push semantics");
		Require(Evaluate(pIsolate, LocalContext, bSkipOriginal ? "g_strDispatchOrder === 'ABCD'" : "g_strDispatchOrder === 'AB'")->IsTrue(), "Successful dispatch keeps callback phase order");

		if (bSkipOriginal) {
			Require(Manager.GetReturnValue(*pRecord, &RawContext, pIsolate)->NumberValue(LocalContext).FromMaybe(0) == 7.0, "Successful return override reaches the real native context");
		}
	}

	void CheckPostDispatch(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, char const* const pszCallback, const double dblExpectedReturn, const bool bFailure = true, char const* const pszSetup = "", char const* const pszEarlierCallback = nullptr, const bool bTermination = false, const bool bInitiallyPending = false, const int nExpectedPayloadWrites = 0, const int nExpectedLaterCallbacks = 0) {
		V8Runtime Runtime(pIsolate);
		MemoryHookManager Manager {};
		FixtureHook Hook {};
		std::shared_ptr<MemoryHookRecord> const pRecord = CreateDispatchRecord(Manager, Runtime, Hook);

		Evaluate(pIsolate, LocalContext, R"JS(
			globalThis.g_DispatchError = new Error("post dispatch failure");
			globalThis.g_unPayloadWrites = 0;
			globalThis.g_unLaterCallbacks = 0;
			globalThis.g_unExpiredConversions = 0;
			globalThis.g_Payload = null;
			globalThis.g_strDispatchOrder = "";
			globalThis.g_PoisonArgumentSetter = () => {
				Object.defineProperty(Array.prototype, "0", { configurable: true, set() { ++g_unPayloadWrites; throw new Error("replacement"); } });
			};
		)JS");
		v8::Local<v8::Value> const LocalExpectedError = Evaluate(pIsolate, LocalContext, "g_DispatchError");
		Evaluate(pIsolate, LocalContext, pszSetup);

		if (pszEarlierCallback) {
			RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_POST, pszEarlierCallback);
		}

		RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_POST, pszCallback);
		RegisterDispatchCallback(Manager, pIsolate, LocalContext, HOOKTYPE_POST, "(Payload) => { ++g_unLaterCallbacks; }");

		Detours::Hook::RAW_CONTEXT RawContext {};
		Require(Manager.SetReturnFromValue(*pRecord, &RawContext, pIsolate, LocalContext, v8::Number::New(pIsolate, 7)), "Initialize native post-return value");
		MemoryHookPostContext PostContext {};
		Manager.StoreReturnContext(RawContext, PostContext);
		MemoryHookPostFrame PostFrame {};
		PostFrame.m_nHookID = 7;
		PostFrame.m_vecArguments = { std::bit_cast<std::uint32_t>(3.5F), std::bit_cast<std::uint32_t>(4.5F) };
		v8::TryCatch Failure(pIsolate);
		if (bInitiallyPending) {
			pIsolate->ThrowException(LocalExpectedError);
		}

		Manager.RunPostCallbacks(*pRecord, PostFrame, &PostContext);
		const bool bCaught = Failure.HasCaught();
		const bool bTerminated = Failure.HasTerminated() || pIsolate->IsExecutionTerminating();
		v8::Local<v8::Value> const LocalException = Failure.Exception();
		const bool bOriginalError = !LocalException.IsEmpty() && LocalException->StrictEquals(LocalExpectedError);

		// Cleanup is fixture-only, after observing the production pending/termination state.
		if (bTermination) {
			pIsolate->CancelTerminateExecution();
		}

		Failure.Reset();
		Evaluate(pIsolate, LocalContext, "delete Array.prototype[0]; delete Object.prototype.HookID;");

		if (bFailure) {
			Require(bTermination ? bTerminated : (bCaught && bOriginalError), "Post dispatch preserves the original exception or termination");
		} else {
			Require(!bCaught && !bTerminated, "Successful post dispatch leaves JavaScript usable");
		}

		Manager.LoadReturnContext(PostContext, RawContext);
		Require(Manager.GetReturnValue(*pRecord, &RawContext, pIsolate)->NumberValue(LocalContext).FromMaybe(0) == dblExpectedReturn, "Post dispatch commits the native result, including accepted overrides before failure");
		Require(Evaluate(pIsolate, LocalContext, "g_unPayloadWrites").As<v8::Int32>()->Value() == nExpectedPayloadWrites, "Post dispatch does not construct another payload after failure");
		Require(Evaluate(pIsolate, LocalContext, "g_unLaterCallbacks").As<v8::Int32>()->Value() == nExpectedLaterCallbacks, "Post dispatch preserves callback order and stops after failure");
		Evaluate(pIsolate, LocalContext, "if ((g_Payload !== null) && (typeof g_Payload.SetHookReturnValue === 'function')) { g_Payload.SetHookReturnValue({ valueOf() { ++g_unExpiredConversions; return 88; } }); }");
		Require(Evaluate(pIsolate, LocalContext, "g_unExpiredConversions === 0")->IsTrue(), "Post payload methods expire before return coercion and remain expired afterward");
		Require(Manager.m_unWrites == 0, "Post-return dispatch does not replay native arguments");
	}

	void CheckPostDispatchScenarios(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => { g_Payload = Payload; g_PoisonArgumentSetter(); throw g_DispatchError; }", 7);
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => { g_Payload = Payload; Payload.SetHookReturnValue(19); g_PoisonArgumentSetter(); throw g_DispatchError; }", 19);
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => { g_PoisonArgumentSetter(); throw g_DispatchError; }", 19, true, "", "(Payload) => 19");
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => ({ valueOf() { g_PoisonArgumentSetter(); throw g_DispatchError; } })", 19, true, "", "(Payload) => 19");
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => { ++g_unLaterCallbacks; }", 7, true, "Object.defineProperty(Object.prototype, 'HookID', { configurable: true, set() { g_PoisonArgumentSetter(); throw g_DispatchError; } });");
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => { ++g_unLaterCallbacks; }", 7, true, "Object.defineProperty(Array.prototype, '0', { configurable: true, set() { ++g_unPayloadWrites; throw g_DispatchError; } });", nullptr, false, false, 1);
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => { ++g_unLaterCallbacks; }", 7, true, "g_PoisonArgumentSetter();", nullptr, false, true);
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => { g_Payload = Payload; Payload.SetHookReturnValue(19); StopDispatchExecution(); while (true) {} }", 19, true, "", nullptr, true);
		CheckPostDispatch(pIsolate, LocalContext, "(Payload) => { g_Payload = Payload; return { valueOf() { g_Payload.SetHookReturnValue({ valueOf() { ++g_unExpiredConversions; return 88; } }); return 11; } }; }", 11, false, "", nullptr, false, false, 0, 1);
		CheckPostDispatch(pIsolate, LocalContext, R"JS((Payload) => {
			if ((Payload.Type !== "post") || (Payload.ReturnValue !== 9) || (Payload.Arguments[0] !== 3.5) || (Payload.Arguments[1] !== 4.5) || (g_strDispatchOrder !== "A")) {
				throw new Error("Invalid post callback payload or order");
			}

			g_strDispatchOrder += "B";

			return 11;
		})JS", 11, false, "", "(Payload) => { g_strDispatchOrder += 'A'; return 9; }", false, false, 0, 1);
	}

	// Only observes whether the actual private resolver finds an active native frame.
	void ProbeHookContextCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
		Arguments.GetReturnValue().Set(FindCallContextFromArguments(Arguments) != nullptr);
	}

	v8::Local<v8::Function> CreateHookContextProbe(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalData) {
		v8::Local<v8::Function> LocalCallback {};
		Require(v8::Function::New(LocalContext, ProbeHookContextCallback, LocalData).ToLocal(&LocalCallback), "Create hook context probe");

		return LocalCallback;
	}

	bool IsHookContextActive(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Function> const LocalCallback) {
		v8::Local<v8::Value> LocalResult {};
		Require(LocalCallback->Call(LocalContext, LocalContext->Global(), 0, nullptr).ToLocal(&LocalResult), "Invoke hook context probe");
		Require(LocalResult->IsBoolean(), "Hook context probe returns a boolean");

		return LocalResult->IsTrue();
	}

	struct FixtureHookContextUnwind {};

	void CheckHookContextLifetime(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		MemoryHookCallContext CallContext {};
		v8::Local<v8::Function> LocalSavedCallback {};
		{
			v8::EscapableHandleScope ProbeHandleScope(pIsolate);
			v8::Local<v8::Object> const LocalData = CreateMemoryHookContextData(pIsolate, LocalContext);
			Require(!LocalData.IsEmpty(), "Create callback-owned context data");
			MemoryHookCallContextScope CallContextScope(LocalData, CallContext);
			v8::Local<v8::Function> const LocalCallback = CreateHookContextProbe(LocalContext, LocalData);
			Require(IsHookContextActive(LocalContext, LocalCallback), "Payload context is active inside its callback scope");
			LocalSavedCallback = ProbeHandleScope.Escape(LocalCallback);
		}

		pIsolate->LowMemoryNotification();
		Require(!IsHookContextActive(LocalContext, LocalSavedCallback), "Saved payload callback expires when the frame scope ends");

		// Reuse the exact native frame address with distinct V8 data, as repeated hooks do.
		v8::Local<v8::Object> const LocalNextData = CreateMemoryHookContextData(pIsolate, LocalContext);
		Require(!LocalNextData.IsEmpty(), "Create next callback context data");
		{
			MemoryHookCallContextScope NextContextScope(LocalNextData, CallContext);
			v8::Local<v8::Function> const LocalNextCallback = CreateHookContextProbe(LocalContext, LocalNextData);
			Require(IsHookContextActive(LocalContext, LocalNextCallback), "Reused native frame has its own active context");
			Require(!IsHookContextActive(LocalContext, LocalSavedCallback), "A later frame at the same address cannot reactivate a saved callback");
			{
				v8::Local<v8::Object> const LocalNestedData = CreateMemoryHookContextData(pIsolate, LocalContext);
				Require(!LocalNestedData.IsEmpty(), "Create nested callback context data");
				MemoryHookCallContextScope NestedContextScope(LocalNestedData, CallContext);
				v8::Local<v8::Function> const LocalNestedCallback = CreateHookContextProbe(LocalContext, LocalNestedData);
				Require(IsHookContextActive(LocalContext, LocalNestedCallback), "Nested callback has an independent active context");
				NestedContextScope.Invalidate();
				Require(!IsHookContextActive(LocalContext, LocalNestedCallback), "Explicit expiry precedes later native result coercion");
				NestedContextScope.Invalidate();
				Require(!IsHookContextActive(LocalContext, LocalNestedCallback), "Repeated context invalidation is harmless");
				Require(IsHookContextActive(LocalContext, LocalNextCallback), "Nested expiry preserves the outer active callback");
			}
		}

		v8::Local<v8::Object> const LocalUnwindData = CreateMemoryHookContextData(pIsolate, LocalContext);
		Require(!LocalUnwindData.IsEmpty(), "Create exception-path context data");
		v8::Local<v8::Function> const LocalUnwindCallback = CreateHookContextProbe(LocalContext, LocalUnwindData);
		bool bCaughtUnwind = false;
		try {
			MemoryHookCallContextScope UnwindContextScope(LocalUnwindData, CallContext);
			Require(IsHookContextActive(LocalContext, LocalUnwindCallback), "Exception-path callback starts active");
			throw FixtureHookContextUnwind {};
		} catch (FixtureHookContextUnwind const&) {
			bCaughtUnwind = true;
		}

		Require(bCaughtUnwind && !IsHookContextActive(LocalContext, LocalUnwindCallback), "Exception unwinding expires saved payload methods");
		Require(!IsHookContextActive(LocalContext, CreateHookContextProbe(LocalContext, v8::Undefined(pIsolate))), "Missing callback data has no frame");
		Require(!IsHookContextActive(LocalContext, CreateHookContextProbe(LocalContext, v8::Object::New(pIsolate))), "Ordinary objects are not private context data");
		Require(!IsHookContextActive(LocalContext, CreateHookContextProbe(LocalContext, v8::External::New(pIsolate, &CallContext))), "Legacy raw externals are not revocable context data");
	}

	void CheckStringHandles(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr int kOriginalValue = 73;
		constexpr int kReplacementValue = 74;
		constexpr char kPropertyName[] = "Value";

		v8::Local<v8::Object> const LocalObject = v8::Object::New(pIsolate);
		v8::Local<v8::Value> LocalValue = v8::Integer::New(pIsolate, kOriginalValue);
		Require(SetInteger(pIsolate, LocalContext, LocalObject, kPropertyName, kOriginalValue), "Set initial property through actual helper");
		Require(GetValue(pIsolate, LocalContext, LocalObject, kPropertyName, LocalValue), "Read initial property through actual helper");
		Require(MakeString(nullptr, "value").IsEmpty(), "Null isolate cannot create a string");

		g_bFailStringCreation = true;
		try {
			Require(MakeString(pIsolate, "value").IsEmpty(), "Failed string allocation returns an empty handle");
			Require(!GetValue(pIsolate, LocalContext, LocalObject, kPropertyName, LocalValue), "Failed key allocation rejects property read");
			Require(!LocalValue.IsEmpty() && LocalValue->IsInt32() && (LocalValue.As<v8::Integer>()->Value() == kOriginalValue), "Failed key allocation preserves read output");
			Require(!SetInteger(pIsolate, LocalContext, LocalObject, kPropertyName, kReplacementValue), "Failed key allocation rejects property write");

			v8::TryCatch TryCatch(pIsolate);
			ThrowError(pIsolate, "allocation failure");
			Require(TryCatch.HasCaught(), "Failed error-message allocation still throws without an empty Error handle");
		} catch (...) {
			g_bFailStringCreation = false;
			throw;
		}

		g_bFailStringCreation = false;
		Require(GetValue(pIsolate, LocalContext, LocalObject, kPropertyName, LocalValue), "Read succeeds after allocation recovery");
		Require(!LocalValue.IsEmpty() && LocalValue->IsInt32() && (LocalValue.As<v8::Integer>()->Value() == kOriginalValue), "Failed write did not change the property");
		Require(!GetValue(pIsolate, {}, LocalObject, kPropertyName, LocalValue), "Empty context cannot read a property");
		Require(!SetInteger(pIsolate, LocalContext, {}, kPropertyName, kReplacementValue), "Empty receiver cannot write a property");

		v8::Local<v8::Object> const LocalThrowingObject = Evaluate(pIsolate, LocalContext, "({ get Value() { throw new Error('read failure'); } })").As<v8::Object>();
		{
			v8::TryCatch TryCatch(pIsolate);
			Require(!GetValue(pIsolate, LocalContext, LocalThrowingObject, kPropertyName, LocalValue), "Throwing getter rejects the property read");
			Require(TryCatch.HasCaught(), "Throwing getter preserves its exception");
			Require(!LocalValue.IsEmpty() && LocalValue->IsInt32() && (LocalValue.As<v8::Integer>()->Value() == kOriginalValue), "Throwing getter preserves read output");
		}

		v8::Local<v8::Object> const LocalException = v8::Object::New(pIsolate);
		v8::TryCatch TryCatch(pIsolate);
		pIsolate->ThrowException(LocalException);
		ThrowError(pIsolate, "replacement");
		v8::Local<v8::Value> const LocalCaughtException = TryCatch.Exception();
		Require(TryCatch.HasCaught() && !LocalCaughtException.IsEmpty() && LocalCaughtException->StrictEquals(LocalException), "Error helper preserves the pending exception");
	}

	MemoryHookRecord MakeRecord(const DATA_TYPE DataType) {
		MemoryHookRecord Record {};
		Record.m_nID = 1;
		Record.m_Signature.m_ReturnType = DataType;
		Record.m_Signature.m_vecArgumentTypes.push_back(DataType);

		return Record;
	}

	Detours::Hook::RAW_CONTEXT MakeContext() {
		constexpr unsigned short kDefaultFPUControlWord = 0x037F;
		constexpr unsigned short kEmptyFPUTagWord = 0xFFFF;

		Detours::Hook::RAW_CONTEXT Context {};
		Context.m_FPU.m_unControlWord = kDefaultFPUControlWord;
		Context.m_FPU.m_unTagWord = kEmptyFPUTagWord;

		return Context;
	}

@SIGNATURE_CHECKS@

	void CheckNumericInputs(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr double kOriginalNumber = 73.25;
		constexpr int kOriginalInteger = 73;
		constexpr char kInvalidInputErrorMessage[] = "invalid numeric input.";

		v8::Local<v8::Value> const LocalNumber = v8::Integer::New(pIsolate, kOriginalInteger);
		double dblValue = kOriginalNumber;
		int nValue = kOriginalInteger;
		Require(!ReadNumberFromValue(nullptr, LocalContext, LocalNumber, kInvalidInputErrorMessage, dblValue) && (dblValue == kOriginalNumber), "Null isolate leaves numeric output unchanged");
		Require(!ReadNumberFromValue(pIsolate, {}, LocalNumber, kInvalidInputErrorMessage, dblValue) && (dblValue == kOriginalNumber), "Empty context leaves numeric output unchanged");
		Require(!ReadNumberFromValue(pIsolate, LocalContext, {}, kInvalidInputErrorMessage, dblValue) && (dblValue == kOriginalNumber), "Empty value leaves numeric output unchanged");
		Require(!ReadInt32FromValue(nullptr, LocalContext, LocalNumber, kInvalidInputErrorMessage, nValue) && (nValue == kOriginalInteger), "Null isolate leaves int32 output unchanged");
		Require(!ReadInt32FromValue(pIsolate, {}, LocalNumber, kInvalidInputErrorMessage, nValue) && (nValue == kOriginalInteger), "Empty context leaves int32 output unchanged");
		Require(!ReadInt32FromValue(pIsolate, LocalContext, {}, kInvalidInputErrorMessage, nValue) && (nValue == kOriginalInteger), "Empty value leaves int32 output unchanged");
		Require(!pIsolate->HasPendingException(), "Rejected native handles do not enter JavaScript conversion");
	}

	void CheckFloatValues(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr double kMaximumFloat = static_cast<double>(std::numeric_limits<float>::max());
		constexpr double kInfinity = std::numeric_limits<double>::infinity();
		constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
		constexpr std::array<double, 8> kValues { 0.0, -0.0, 1.5, kMaximumFloat, -kMaximumFloat, kInfinity, -kInfinity, kNaN };

		MemoryHookManager Manager {};
		MemoryHookRecord const Record = MakeRecord(DATA_TYPE_FLOAT);
		for (auto const& dblValue : kValues) {
			Detours::Hook::RAW_CONTEXT Context = MakeContext();
			v8::TryCatch Failure(pIsolate);
			v8::Local<v8::Number> const LocalValue = v8::Number::New(pIsolate, dblValue);
			Require(Manager.SetArgumentFromValue(Record, &Context, 0, pIsolate, LocalContext, LocalValue), "Accept float argument");
			Require(Manager.SetReturnFromValue(Record, &Context, pIsolate, LocalContext, LocalValue), "Accept float return");
			Require(!Failure.HasCaught(), "No error for representable/nonfinite float");

			const float flArgument = std::bit_cast<float>(static_cast<std::uint32_t>(Manager.m_unArgument));
			v8::Local<v8::Value> const LocalReturn = Manager.GetReturnValue(Record, &Context, pIsolate);
			Require(!LocalReturn.IsEmpty() && LocalReturn->IsNumber(), "Float decoder returns a number");
			const double dblReturn = LocalReturn.As<v8::Number>()->Value();

			if (std::isnan(dblValue)) {
				Require(std::isnan(flArgument) && std::isnan(dblReturn), "Preserve NaN");
			} else {
				Require((flArgument == dblValue) && (dblReturn == dblValue), "Preserve float value");
				Require((std::signbit(flArgument) == std::signbit(dblValue)) && (std::signbit(dblReturn) == std::signbit(dblValue)), "Preserve float sign");
			}
		}

		const double dblOverflow = std::nextafter(kMaximumFloat, kInfinity);
		std::array<double, 4> const arrOverflows { dblOverflow, -dblOverflow, std::numeric_limits<double>::max(), -std::numeric_limits<double>::max() };
		for (auto const& dblValue : arrOverflows) {
			for (auto const& bReturn : { false, true }) {
				Detours::Hook::RAW_CONTEXT Context = MakeContext();
				std::array<unsigned char, sizeof(Context)> arrBefore {};
				std::memcpy(arrBefore.data(), &Context, sizeof(Context));
				const std::size_t unWrites = Manager.m_unWrites;
				v8::TryCatch Failure(pIsolate);
				v8::Local<v8::Number> const LocalValue = v8::Number::New(pIsolate, dblValue);
				const bool bAccepted = bReturn ? Manager.SetReturnFromValue(Record, &Context, pIsolate, LocalContext, LocalValue) : Manager.SetArgumentFromValue(Record, &Context, 0, pIsolate, LocalContext, LocalValue);
				Require(!bAccepted && Failure.HasCaught(), "Reject finite float overflow");
				Require((Manager.m_unWrites == unWrites) && (std::memcmp(arrBefore.data(), &Context, sizeof(Context)) == 0), "No native write on float overflow");
			}
		}

#if defined(DETOURS_ARCH_X86)
		std::array<double, 6> const arrRawOverflows { dblOverflow, -dblOverflow, kMaximumFloat * 1.5, -(kMaximumFloat * 1.5), std::numeric_limits<double>::max(), -std::numeric_limits<double>::max() };
		for (auto const& dblValue : arrRawOverflows) {
			Detours::Hook::RAW_CONTEXT Context = MakeContext();
			Require(WriteX87ValueFromDouble(dblValue, &Context.m_FPU), "Prepare wide raw x87 float result");
			Require(std::feclearexcept(FE_ALL_EXCEPT) == 0, "Clear floating status before decoding");
			v8::Local<v8::Value> const LocalReturn = Manager.GetReturnValue(Record, &Context, pIsolate);
			Require(std::fetestexcept(FE_OVERFLOW) == 0, "Float decoder never executes an overflowing narrowing cast");
			Require(!LocalReturn.IsEmpty() && LocalReturn->IsNumber(), "x87 float decoder returns a number");
			const double dblReturn = LocalReturn.As<v8::Number>()->Value();
			Require(std::isinf(dblReturn) && (std::signbit(dblReturn) == std::signbit(dblValue)), "Wide raw x87 float result becomes signed infinity");
		}
#endif
	}

	void CheckConversionFailures(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr double kOriginalOutput = 73.0;
		constexpr char kNumericFailureSource[] = "({\n\tvalueOf() {\n\t\tthrow globalThis.ConversionFailure;\n\t}\n})";
		constexpr char kStringFailureSource[] = "({\n\ttoString() {\n\t\tthrow globalThis.ConversionFailure;\n\t}\n})";

		MemoryHookManager Manager {};
		v8::Local<v8::Value> const LocalFailure = Evaluate(pIsolate, LocalContext, "globalThis.ConversionFailure = { Reason: 'original' }");
		for (auto const& DataType : { DATA_TYPE_FLOAT, DATA_TYPE_DOUBLE, DATA_TYPE_STRING }) {
			MemoryHookRecord const Record = MakeRecord(DataType);
			v8::Local<v8::Value> const LocalValue = Evaluate(pIsolate, LocalContext, (DataType == DATA_TYPE_STRING) ? kStringFailureSource : kNumericFailureSource);
			for (auto const& bReturn : { false, true }) {
				Detours::Hook::RAW_CONTEXT Context = MakeContext();
				std::array<unsigned char, sizeof(Context)> arrBefore {};
				std::memcpy(arrBefore.data(), &Context, sizeof(Context));
				v8::TryCatch Failure(pIsolate);
				const bool bAccepted = bReturn ? Manager.SetReturnFromValue(Record, &Context, pIsolate, LocalContext, LocalValue) : Manager.SetArgumentFromValue(Record, &Context, 0, pIsolate, LocalContext, LocalValue);
				Require(!bAccepted && Failure.HasCaught(), "Reject failed coercion");

				v8::Local<v8::Value> const LocalException = Failure.Exception();
				Require(!LocalException.IsEmpty(), "Failed coercion supplies an exception value");

				if (!LocalException->StrictEquals(LocalFailure)) {
					v8::String::Utf8Value const UTF8Failure(pIsolate, LocalException);
					std::fprintf(stderr, "Coercion Type=%d Return=%d Exception=%s\n", static_cast<int>(DataType), bReturn ? 1 : 0, *UTF8Failure ? *UTF8Failure : "<unavailable>");
				}

				Require(LocalException->StrictEquals(LocalFailure), "Preserve original thrown JS object");
				Require((Manager.m_unWrites == 0) && Manager.m_lstStrings.empty() && (std::memcmp(arrBefore.data(), &Context, sizeof(Context)) == 0), "No empty-string/native commit on failed conversion");
			}
		}

		double dblOutput = kOriginalOutput;
		v8::TryCatch Failure(pIsolate);
		v8::Local<v8::Value> const LocalInvalid = Evaluate(pIsolate, LocalContext, kNumericFailureSource);
		Require(!ReadNumberFromValue(pIsolate, LocalContext, LocalInvalid, "replacement", dblOutput), "Reject numeric conversion");
		v8::Local<v8::Value> const LocalException = Failure.Exception();
		Require((dblOutput == kOriginalOutput) && !LocalException.IsEmpty() && LocalException->StrictEquals(LocalFailure), "No numeric output commit or exception replacement");
	}

	void CheckStrings(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		MemoryHookManager Manager {};
		MemoryHookRecord const Record = MakeRecord(DATA_TYPE_STRING);
		for (auto const& strValue : { std::string {}, std::string("a\0b", 3) }) {
			v8::Local<v8::String> LocalValue {};
			Require(v8::String::NewFromUtf8(pIsolate, strValue.data(), v8::NewStringType::kNormal, static_cast<int>(strValue.size())).ToLocal(&LocalValue), "Create the fixture string with its full byte length");

			for (auto const& bReturn : { false, true }) {
				Detours::Hook::RAW_CONTEXT Context = MakeContext();
				const std::size_t unStoredStringCount = Manager.m_lstStrings.size();
				const bool bAccepted = bReturn ? Manager.SetReturnFromValue(Record, &Context, pIsolate, LocalContext, LocalValue) : Manager.SetArgumentFromValue(Record, &Context, 0, pIsolate, LocalContext, LocalValue);
				Require(bAccepted && (Manager.m_lstStrings.size() == (unStoredStringCount + 1)) && (Manager.m_lstStrings.back() == strValue), "Commit one string, preserving empty and embedded-NUL storage");
			}
		}

		Manager.m_bRejectStorage = true;
		for (auto const& bReturn : { false, true }) {
			Detours::Hook::RAW_CONTEXT Context = MakeContext();
			std::array<unsigned char, sizeof(Context)> arrBefore {};
			std::memcpy(arrBefore.data(), &Context, sizeof(Context));
			const std::size_t unWrites = Manager.m_unWrites;
			v8::TryCatch Failure(pIsolate);
			bool bAccepted = false;
			RunMemoryHookCallback(pIsolate, "storage failure", [&] {
				bAccepted = bReturn ? Manager.SetReturnFromValue(Record, &Context, pIsolate, LocalContext, MakeString(pIsolate, "value")) : Manager.SetArgumentFromValue(Record, &Context, 0, pIsolate, LocalContext, MakeString(pIsolate, "value"));
			});
			Require(!bAccepted && Failure.HasCaught() && (Manager.m_unWrites == unWrites) && (std::memcmp(arrBefore.data(), &Context, sizeof(Context)) == 0), "Translate allocation failure without native write");
		}
	}

	void CheckBooleanAndBigInt(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr int kValue = 73;
		constexpr std::uint64_t kLowByteMask = 0xFF;

		MemoryHookManager Manager {};
		MemoryHookRecord const BooleanRecord = MakeRecord(DATA_TYPE_BOOL);
		for (auto const& unWord : { std::uint64_t(0), std::uint64_t(1), std::uint64_t(0xA500), std::uint64_t(0xA501), std::numeric_limits<std::uint64_t>::max() - kLowByteMask }) {
			v8::Local<v8::Value> const LocalValue = Manager.MakeDataTypeValue(DATA_TYPE_BOOL, unWord, pIsolate);
			Require(LocalValue->BooleanValue(pIsolate) == (static_cast<std::uint8_t>(unWord) != 0), "Decode bool from low ABI byte only");
			Detours::Hook::RAW_CONTEXT Context = MakeContext();
#if defined(DETOURS_ARCH_X64)
			Context.m_unRAX = unWord;
#else
			Context.m_unEAX = static_cast<std::uint32_t>(unWord);
#endif
			Require(Manager.GetReturnValue(BooleanRecord, &Context, pIsolate)->BooleanValue(pIsolate) == (static_cast<std::uint8_t>(unWord) != 0), "Read bool return with unspecified upper bits");
		}

		for (auto const& DataType : { DATA_TYPE_ADDRESS, DATA_TYPE_LONG_LONG, DATA_TYPE_ULONG_LONG }) {
			MemoryHookRecord const Record = MakeRecord(DataType);
			Detours::Hook::RAW_CONTEXT Context = MakeContext();
			v8::Local<v8::BigInt> const LocalValue = v8::BigInt::NewFromUnsigned(pIsolate, kValue);
			Require(Manager.SetArgumentFromValue(Record, &Context, 0, pIsolate, LocalContext, LocalValue), "Accept BigInt argument");
			Require(Manager.SetReturnFromValue(Record, &Context, pIsolate, LocalContext, LocalValue), "Accept BigInt return");
			Require(Manager.m_unArgument == kValue, "Preserve BigInt argument bits");
			for (auto const& bReturn : { false, true }) {
				v8::TryCatch Failure(pIsolate);
				v8::Local<v8::Number> const LocalNumber = v8::Number::New(pIsolate, kValue);
				const bool bAccepted = bReturn ? Manager.SetReturnFromValue(Record, &Context, pIsolate, LocalContext, LocalNumber) : Manager.SetArgumentFromValue(Record, &Context, 0, pIsolate, LocalContext, LocalNumber);
				Require(!bAccepted && Failure.HasCaught(), "Reject Number for address/int64/uint64");
			}
		}
	}

	void CheckBigIntBoundaries(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		MemoryHookManager Manager {};
		for (auto const& DataType : { DATA_TYPE_ADDRESS, DATA_TYPE_LONG, DATA_TYPE_ULONG, DATA_TYPE_LONG_LONG, DATA_TYPE_ULONG_LONG }) {
			if (((DataType == DATA_TYPE_LONG) && (sizeof(long) != sizeof(std::int64_t))) || ((DataType == DATA_TYPE_ULONG) && (sizeof(unsigned long) != sizeof(std::uint64_t)))) {
				continue;
			}

			MemoryHookRecord const Record = MakeRecord(DataType);
			for (auto const& pszExpression : { "0n", "-1n", "-(1n << 63n)", "(1n << 63n) - 1n", "(1n << 64n) - 1n", "1n << 64n", "-(1n << 63n) - 1n", "0", "1", "-1" }) {
				v8::Local<v8::Value> const LocalValue = Evaluate(pIsolate, LocalContext, pszExpression);
				bool bExpected = false;
				std::uint64_t unBits = 0;
				if (LocalValue->IsBigInt()) {
					v8::Local<v8::BigInt> const LocalBigInt = LocalValue.As<v8::BigInt>();
					if ((DataType == DATA_TYPE_LONG) || (DataType == DATA_TYPE_LONG_LONG)) {
						unBits = static_cast<std::uint64_t>(LocalBigInt->Int64Value(&bExpected));
					} else {
						unBits = LocalBigInt->Uint64Value(&bExpected);
						if (DataType == DATA_TYPE_ADDRESS) {
							bExpected = bExpected && (unBits <= std::numeric_limits<std::uintptr_t>::max());
						}
					}
				}

				for (auto const& bReturn : { false, true }) {
					Detours::Hook::RAW_CONTEXT Context = MakeContext();
					std::array<unsigned char, sizeof(Context)> arrBefore {};
					std::memcpy(arrBefore.data(), &Context, sizeof(Context));
					const std::size_t unWrites = Manager.m_unWrites;
					v8::TryCatch Failure(pIsolate);
					const bool bAccepted = bReturn ? Manager.SetReturnFromValue(Record, &Context, pIsolate, LocalContext, LocalValue) : Manager.SetArgumentFromValue(Record, &Context, 0, pIsolate, LocalContext, LocalValue);
					Require((bAccepted == bExpected) && (Failure.HasCaught() != bExpected), "BigInt signedness/range/address-width acceptance");

					if (!bExpected) {
						Require((Manager.m_unWrites == unWrites) && (std::memcmp(arrBefore.data(), &Context, sizeof(Context)) == 0), "No commit on rejected BigInt boundary");
						continue;
					}

					if (bReturn) {
						Require(Manager.GetReturnValue(Record, &Context, pIsolate)->StrictEquals(LocalValue), "Exact BigInt return roundtrip");
					} else {
						Require(Manager.m_unArgument == unBits, "Exact BigInt argument bits");
					}
				}
			}
		}
	}

	void CheckReaderBoundary(v8::Isolate* const pIsolate) {
		auto const RejectValue = [] {
			return false;
		};
		for (auto const& pszMessage : { static_cast<char const*>(nullptr), "specific failure" }) {
			v8::TryCatch Failure(pIsolate);
			Require(!ReadMemoryHookValue(pIsolate, RejectValue, pszMessage) && Failure.HasCaught(), "Reader reports conversion failure");
			v8::String::Utf8Value const UTF8Failure(pIsolate, Failure.Exception());
			std::string const strFailure = *UTF8Failure;
			Require(strFailure.find(pszMessage ? pszMessage : "memory value conversion failed.") != std::string::npos, "Reader failure diagnostic");
		}

		bool bRethrown = false;
		try {
			ReadMemoryHookValue(pIsolate, []() -> bool {
				throw std::bad_alloc();
			});
		} catch (std::bad_alloc const&) {
			bRethrown = true;
		}

		Require(bRethrown && !pIsolate->HasPendingException(), "Preserve C++ allocation failure for owning boundary");
		v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
		v8::Local<v8::Script> LocalScript {};
		Require(v8::Script::Compile(LocalContext, MakeString(pIsolate, "1")).ToLocal(&LocalScript), "Compile termination probe");
		v8::TryCatch Termination(pIsolate);
		pIsolate->TerminateExecution();
		const bool bAccepted = ReadMemoryHookValue(pIsolate, [LocalContext, LocalScript] {
			v8::Local<v8::Value> LocalResult {};

			return LocalScript->Run(LocalContext).ToLocal(&LocalResult);
		});
		const bool bTerminated = Termination.HasTerminated();
		pIsolate->CancelTerminateExecution();
		Require(!bAccepted && bTerminated, "Respect V8 execution termination");
	}

	void ClearHookRegistry(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
		auto* const pManager = static_cast<MemoryHookManager*>(Arguments.Data().As<v8::External>()->Value());
		pManager->m_vecHookRecords.clear();
	}

	void CheckReentrantInventory(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr char kPrototypeSetterSource[] = "Object.defineProperty(Object.prototype, \"ID\", {\n\tconfigurable: true,\n\tset(unID) {\n\t\tClearHookRegistry(unID);\n\t},\n});";
		constexpr std::uint32_t kHookCount = 2;

		MemoryHookManager Manager {};
		FixtureHook Hook {};
		for (auto const& nID : { 1, 2 }) {
			std::shared_ptr<MemoryHookRecord> pRecord = std::make_shared<MemoryHookRecord>(MakeRecord(DATA_TYPE_VOID));
			pRecord->m_nID = nID;
			pRecord->m_pHook = &Hook;
			pRecord->m_pAddress = &Hook;
			Manager.m_vecHookRecords.push_back(std::move(pRecord));
		}

		v8::Local<v8::Function> const LocalClear = v8::Function::New(LocalContext, ClearHookRegistry, v8::External::New(pIsolate, &Manager)).ToLocalChecked();
		Require(LocalContext->Global()->Set(LocalContext, MakeString(pIsolate, "ClearHookRegistry"), LocalClear).FromMaybe(false), "Register reentrant inventory adapter");
		Evaluate(pIsolate, LocalContext, kPrototypeSetterSource);
		v8::Local<v8::Array> const LocalHooks = Manager.GetHooks(pIsolate, LocalContext);
		Require(Manager.m_vecHookRecords.empty(), "Property setter really reenters the registry");
		Require(!LocalHooks.IsEmpty() && (LocalHooks->Length() == kHookCount), "Preserve inventory extent");
		for (std::uint32_t unIndex = 0; unIndex < kHookCount; ++unIndex) {
			v8::Local<v8::Value> LocalHook {};
			Require(LocalHooks->Get(LocalContext, unIndex).ToLocal(&LocalHook) && LocalHook->IsObject(), "Preserve inventory entries across reentrant registry removal");
		}

		Evaluate(pIsolate, LocalContext, "delete Object.prototype.ID; delete globalThis.ClearHookRegistry; 0");
	}

	void CheckRuntimeStringConversion(v8::Isolate* const pIsolate) {
		constexpr char kLeadingNullValue[] = "\0key";
		constexpr char kEmbeddedNullValue[] = "a\0b";

		std::string const arrRuntimeStrings[] = {
			"",
			"Plain",
			std::string(kLeadingNullValue, sizeof(kLeadingNullValue) - 1),
			std::string(kEmbeddedNullValue, sizeof(kEmbeddedNullValue) - 1),
			"\xF0\x9F\x9A\x80",
		};
		for (auto const& strValue : arrRuntimeStrings) {
			v8::Local<v8::String> LocalValue {};
			Require(MakeRuntimeString(pIsolate, strValue, LocalValue), "Create runtime UTF8 string");
			v8::String::Utf8Value const UTF8Value(pIsolate, LocalValue);
			Require(*UTF8Value != nullptr, "Read runtime UTF8 string");
			const std::size_t unByteCount = UTF8Value.length();
			Require((unByteCount == strValue.size()) && (std::memcmp(*UTF8Value, strValue.data(), unByteCount) == 0), "Preserve runtime UTF8 bytes including NUL");
		}
	}

	void RunFixture() {
		std::unique_ptr<v8::ArrayBuffer::Allocator> pAllocator(v8::ArrayBuffer::Allocator::NewDefaultAllocator());
		v8::Isolate::CreateParams Parameters {};
		Parameters.array_buffer_allocator = pAllocator.get();
		std::unique_ptr<v8::Isolate, fnDisposeIsolate> pIsolate(v8::Isolate::New(Parameters), [](v8::Isolate* const pValue) {
			pValue->Dispose();
		});
		Require(pIsolate != nullptr, "Create real V8 isolate");
		v8::Isolate::Scope IsolateScope(pIsolate.get());
		v8::HandleScope HandleScope(pIsolate.get());
		v8::Local<v8::Context> const LocalContext = v8::Context::New(pIsolate.get());
		v8::Context::Scope ContextScope(LocalContext);
		CheckDispatchFailures(pIsolate.get(), LocalContext);
		CheckDispatchSuccess(pIsolate.get(), LocalContext, false);
		CheckDispatchSuccess(pIsolate.get(), LocalContext, true);
		CheckPostDispatchScenarios(pIsolate.get(), LocalContext);
		CheckHookContextLifetime(pIsolate.get(), LocalContext);
		CheckRuntimeStringConversion(pIsolate.get());
		CheckInt32Values(pIsolate.get(), LocalContext);
		CheckSignatures(pIsolate.get(), LocalContext);
		CheckVTableAddresses(pIsolate.get(), LocalContext);
		CheckRecordLookups(pIsolate.get(), LocalContext);
		CheckNumericInputs(pIsolate.get(), LocalContext);
		CheckFloatValues(pIsolate.get(), LocalContext);
		CheckConversionFailures(pIsolate.get(), LocalContext);
		CheckStrings(pIsolate.get(), LocalContext);
		CheckStringHandles(pIsolate.get(), LocalContext);
		CheckBooleanAndBigInt(pIsolate.get(), LocalContext);
		CheckBigIntBoundaries(pIsolate.get(), LocalContext);
		CheckReentrantInventory(pIsolate.get(), LocalContext);
		CheckReaderBoundary(pIsolate.get());
	}
} // namespace SourceJS

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fprintf(stderr, "Usage: MemoryHookSettersV8\n");
		return 2;
	}

	if (!v8::V8::InitializeICUDefaultLocation(nullptr)) {
		return 2;
	}

	v8::V8::InitializeExternalStartupData(nullptr);
	std::unique_ptr<v8::Platform> pPlatform = v8::platform::NewDefaultPlatform();
	v8::V8::InitializePlatform(pPlatform.get());

	if (!v8::V8::Initialize()) {
		v8::V8::DisposePlatform();
		return 2;
	}

	int nResult = 0;
	try {
		SourceJS::RunFixture();
	} catch (std::exception const& Failure) {
		std::fprintf(stderr, "Memory hook setter fixture: %s\n", Failure.what());
		nResult = 1;
	}

	v8::V8::Dispose();
	v8::V8::DisposePlatform();

	return nResult;
}
