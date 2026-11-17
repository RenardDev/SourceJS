#include "sourcejs/MemoryHookManager.h"

// General
#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#define SOURCEJS_MEMORY_DEFINED_WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_MEMORY_DEFINED_NOMINMAX
#endif
#include <Windows.h>
#if defined(SOURCEJS_MEMORY_DEFINED_NOMINMAX)
#undef NOMINMAX
#undef SOURCEJS_MEMORY_DEFINED_NOMINMAX
#endif
#if defined(SOURCEJS_MEMORY_DEFINED_WIN32_LEAN_AND_MEAN)
#undef WIN32_LEAN_AND_MEAN
#undef SOURCEJS_MEMORY_DEFINED_WIN32_LEAN_AND_MEAN
#endif
#else
#include <sys/mman.h>
#include <unistd.h>
#endif
#include "edict.h"
#include "eiface.h"
#include "iserverunknown.h"

// C++
#include <cerrno>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <utility>

// STL
#include <algorithm>
#include <bit>
#include <limits>
#include <memory>
#include <type_traits>

// Project
#include "sourcejs/Application.h"
#include "sourcejs/EngineInterfaces.h"
#include "sourcejs/Log.h"
#include "sourcejs/V8Runtime.h"

// ================================================================
// Helpers
// ================================================================

namespace SourceJS {

	MemoryHookSignature::MemoryHookSignature() {
		m_strConvention = "thiscall";
		m_ReturnType = DATA_TYPE_VOID;
	}

	namespace {

		struct MemoryHookCallContext {
			MemoryHookCallContext() noexcept;

			MemoryHookManager* m_pMemoryHookManager;
			MemoryHookRecord const* m_pHookRecord;
			Detours::Hook::PRAW_CONTEXT m_pRawContext;
			v8::Local<v8::Array>* m_pHookArguments;
			bool m_bSkipOriginal;
			bool m_bHasReturnValue;
		};

		enum class NativeCallArgumentKind : unsigned char {
			Integer = 0,
			Float,
			Double,
			WideInteger
		};

		struct NativeCallArgument {
			std::uint64_t m_unBits;
			NativeCallArgumentKind m_Kind;
		};

		struct NativeCallRequest {
			NativeCallRequest();

			void* m_pAddress;
			std::string m_strConvention;
			DATA_TYPE m_ReturnType;
			std::vector<NativeCallArgument> m_vecArguments;
			std::map<std::string, std::uintptr_t> m_mapRegisters;
			bool m_bCallerCleanup;
		};

		constexpr std::size_t kNativeCallResultAlignment = 16;
		constexpr std::size_t kFXStateSize = 512;
		constexpr std::size_t kFXStateControlWordOffset = 0x00;
		constexpr std::size_t kFXStateStatusWordOffset = 0x02;
		constexpr std::size_t kFXStateTagWordOffset = 0x04;
		constexpr std::size_t kFXStateMXCSROffset = 0x18;
		constexpr std::size_t kFXStateRegisterOffset = 0x20;
		constexpr std::size_t kFXStateRegisterSize = 16;
		constexpr std::size_t kFXStateRegisterValueSize = 10;
		constexpr std::size_t kFXStateXMMOffset = 0xA0;
		constexpr std::size_t kFXStateXMMSize = 16;

#if defined(DETOURS_ARCH_X86)
		constexpr std::size_t kX87StateByteCount = sizeof(Detours::Hook::RAW_CONTEXT_FPU);
		constexpr std::size_t kX87StateAlignment = 16;

		static_assert(kX87StateByteCount == 108, "x87 state storage must match the native FSAVE layout.");
#endif

		// Private register/FPU snapshot: keep trivial storage and the FXSAVE alignment.
		// Compatibility profile: the reserved tag is this layout-boundary typedef's only exception (guide 2.5/9.5).
		typedef struct alignas(kNativeCallResultAlignment) _NATIVE_CALL_RESULT {
			std::uint64_t m_unInteger;
			double m_dblDouble;
			float m_flFloat;
			std::uint32_t m_unReserved;
#if defined(DETOURS_ARCH_X64)
			std::uint64_t m_unRFLAGS;
			std::uint64_t m_unRAX;
			std::uint64_t m_unRCX;
			std::uint64_t m_unRDX;
			std::uint64_t m_unRBX;
			std::uint64_t m_unRSP;
			std::uint64_t m_unRBP;
			std::uint64_t m_unRSI;
			std::uint64_t m_unRDI;
			std::uint64_t m_unR8;
			std::uint64_t m_unR9;
			std::uint64_t m_unR10;
			std::uint64_t m_unR11;
			std::uint64_t m_unR12;
			std::uint64_t m_unR13;
			std::uint64_t m_unR14;
			std::uint64_t m_unR15;
#elif defined(DETOURS_ARCH_X86)
			std::uint32_t m_unEFLAGS;
			std::uint32_t m_unEAX;
			std::uint32_t m_unECX;
			std::uint32_t m_unEDX;
			std::uint32_t m_unEBX;
			std::uint32_t m_unESP;
			std::uint32_t m_unEBP;
			std::uint32_t m_unESI;
			std::uint32_t m_unEDI;
			std::uint32_t m_unFXStateAlignmentReserved;
#else
#error Unsupported native call result architecture.
#endif
			alignas(kNativeCallResultAlignment) unsigned char m_arrFXState[kFXStateSize];
		} NATIVE_CALL_RESULT, *PNATIVE_CALL_RESULT;

		static_assert(std::is_standard_layout_v<NATIVE_CALL_RESULT>, "Native call results require standard layout.");
		static_assert(std::is_trivially_copyable_v<NATIVE_CALL_RESULT>, "Native call results require trivial storage.");
		static_assert(alignof(NATIVE_CALL_RESULT) >= kNativeCallResultAlignment, "Native call result alignment is insufficient.");
		static_assert((offsetof(NATIVE_CALL_RESULT, m_arrFXState) % kNativeCallResultAlignment) == 0, "Native call FXSAVE storage must be aligned.");

		MemoryHookCallContext::MemoryHookCallContext() noexcept {
			m_pMemoryHookManager = nullptr;
			m_pHookRecord = nullptr;
			m_pRawContext = nullptr;
			m_pHookArguments = nullptr;
			m_bSkipOriginal = false;
			m_bHasReturnValue = false;
		}

		NativeCallRequest::NativeCallRequest() {
			m_pAddress = nullptr;
			m_ReturnType = DATA_TYPE_VOID;
			m_bCallerCleanup = false;
		}

		class NativeCallStackStorage {
		public:
			NativeCallStackStorage() noexcept;
			~NativeCallStackStorage() noexcept;

			NativeCallStackStorage(NativeCallStackStorage const&) = delete;
			NativeCallStackStorage(NativeCallStackStorage&&) = delete;
			NativeCallStackStorage& operator=(NativeCallStackStorage const&) = delete;
			NativeCallStackStorage& operator=(NativeCallStackStorage&&) = delete;

			bool Allocate() noexcept;
			unsigned char* GetAddress() const noexcept;
			std::size_t GetSize() const noexcept;

		private:
			void* m_pAddress;
			std::size_t m_unSize;
		};

		NativeCallStackStorage::NativeCallStackStorage() noexcept {
			m_pAddress = nullptr;
			m_unSize = 0;
		}

		NativeCallStackStorage::~NativeCallStackStorage() noexcept {
			if (!m_pAddress || !m_unSize) {
				return;
			}

#if defined(_WIN32)
			if (!VirtualFree(m_pAddress, 0, MEM_RELEASE)) {
				const DWORD unError = GetLastError();
				LogError("NativeCallStackStorage release failed Address=%p Size=%zu Error=0x%08lX", m_pAddress, m_unSize, unError);
			}
#else
			if (munmap(m_pAddress, m_unSize) != 0) {
				const int nError = errno;
				LogError("NativeCallStackStorage release failed Address=%p Size=%zu Error=0x%08X", m_pAddress, m_unSize, static_cast<unsigned int>(nError));
			}
#endif
		}

		bool NativeCallStackStorage::Allocate() noexcept {
			if (m_pAddress || m_unSize) {
				return false;
			}

#if defined(_WIN32)
			SYSTEM_INFO SystemInformation {};
			GetSystemInfo(&SystemInformation);
			const std::size_t unAllocationSize = static_cast<std::size_t>(SystemInformation.dwPageSize);
#else
			const long nSystemPageSize = sysconf(_SC_PAGESIZE);
			if (nSystemPageSize <= 0) {
				return false;
			}

			const std::size_t unAllocationSize = static_cast<std::size_t>(nSystemPageSize);
#endif
			if (unAllocationSize == 0) {
				return false;
			}

#if defined(_WIN32)
			void* const pMapping = VirtualAlloc(nullptr, unAllocationSize, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
			if (!pMapping) {
				return false;
			}
#else
			void* const pMapping = mmap(nullptr, unAllocationSize, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
			if (pMapping == MAP_FAILED) {
				return false;
			}

			// A zero-address mapping cannot represent this owner's non-empty state.
			if (!pMapping) {
				if (munmap(pMapping, unAllocationSize) != 0) {
					const int nError = errno;
					LogError("NativeCallStackStorage zero-address release failed Address=%p Size=%zu Error=0x%08X", pMapping, unAllocationSize, static_cast<unsigned int>(nError));
				}

				return false;
			}
#endif
			m_pAddress = pMapping;
			m_unSize = unAllocationSize;

			return true;
		}

		unsigned char* NativeCallStackStorage::GetAddress() const noexcept {
			return static_cast<unsigned char*>(m_pAddress);
		}

		std::size_t NativeCallStackStorage::GetSize() const noexcept {
			return m_unSize;
		}

		v8::Local<v8::String> MakeString(v8::Isolate* const pIsolate, char const* const pszValue) {
			if (!pIsolate || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
				return {};
			}

			char const* const pszSafeValue = pszValue ? pszValue : "";
			v8::MaybeLocal<v8::String> const MaybeLocalString = v8::String::NewFromUtf8(pIsolate, pszSafeValue, v8::NewStringType::kNormal);
			v8::Local<v8::String> LocalString {};
			if (!MaybeLocalString.ToLocal(&LocalString)) {
				return {};
			}

			return LocalString;
		}

		void ThrowError(v8::Isolate* const pIsolate, char const* const pszMessage) {
			if (!pIsolate || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
				return;
			}

			v8::Local<v8::String> const LocalMessage = MakeString(pIsolate, pszMessage);
			if (pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
				return;
			}

			if (LocalMessage.IsEmpty()) {
				// Preserve allocation failure without passing an empty message to Error().
				pIsolate->ThrowException({});
				return;
			}

			pIsolate->ThrowException(v8::Exception::Error(LocalMessage));
		}

		bool GetValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, v8::Local<v8::Value>& LocalValueOut) {
			if (LocalContext.IsEmpty() || LocalObject.IsEmpty()) {
				return false;
			}

			v8::Local<v8::String> const LocalPropertyName = MakeString(pIsolate, pszPropertyName);
			if (LocalPropertyName.IsEmpty()) {
				return false;
			}

			v8::Local<v8::Value> LocalValue {};
			if (!LocalObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalValue)) {
				return false;
			}

			LocalValueOut = LocalValue;

			return true;
		}

		bool SetValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, v8::Local<v8::Value> const LocalValue) {
			if (LocalContext.IsEmpty() || LocalObject.IsEmpty() || LocalValue.IsEmpty()) {
				return false;
			}

			v8::Local<v8::String> const LocalPropertyName = MakeString(pIsolate, pszPropertyName);
			if (LocalPropertyName.IsEmpty()) {
				return false;
			}

			return LocalObject->Set(LocalContext, LocalPropertyName, LocalValue).FromMaybe(false);
		}

		bool SetOwnValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, v8::Local<v8::Value> const LocalValue) {
			if (LocalContext.IsEmpty() || LocalObject.IsEmpty() || LocalValue.IsEmpty()) {
				return false;
			}

			v8::Local<v8::String> const LocalPropertyName = MakeString(pIsolate, pszPropertyName);
			if (LocalPropertyName.IsEmpty()) {
				return false;
			}

			return LocalObject->CreateDataProperty(LocalContext, LocalPropertyName, LocalValue).FromMaybe(false);
		}

		bool SetOwnFunction(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, v8::FunctionCallback const Callback, v8::Local<v8::Value> const LocalData) {
			v8::Local<v8::Function> LocalFunction {};
			if (!v8::Function::New(LocalContext, Callback, LocalData).ToLocal(&LocalFunction)) {
				return false;
			}

			return SetOwnValue(pIsolate, LocalContext, LocalObject, pszPropertyName, LocalFunction);
		}

		bool SetInteger(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, const int nValue) {
			return SetValue(pIsolate, LocalContext, LocalObject, pszPropertyName, v8::Integer::New(pIsolate, nValue));
		}

		bool SetBoolean(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, const bool bValue) {
			return SetValue(pIsolate, LocalContext, LocalObject, pszPropertyName, v8::Boolean::New(pIsolate, bValue));
		}

		bool SetString(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, char const* const pszValue) {
			return SetValue(pIsolate, LocalContext, LocalObject, pszPropertyName, MakeString(pIsolate, pszValue));
		}

		bool SetFunction(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, v8::FunctionCallback const Callback, v8::Local<v8::Value> const LocalData) {
			v8::Local<v8::Function> LocalFunction {};
			if (!v8::Function::New(LocalContext, Callback, LocalData).ToLocal(&LocalFunction)) {
				return false;
			}

			return SetValue(pIsolate, LocalContext, LocalObject, pszPropertyName, LocalFunction);
		}

		bool ReadAddressFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Value> const LocalValue, std::uintptr_t& unAddressOut) {
			if (LocalValue.IsEmpty() || !LocalValue->IsBigInt()) {
				ThrowError(pIsolate, "Expected an address as a JavaScript BigInt.");
				return false;
			}

			bool bLossless = false;
			const std::uint64_t unAddress = LocalValue.As<v8::BigInt>()->Uint64Value(&bLossless);
			if (!bLossless || (unAddress > static_cast<std::uint64_t>(std::numeric_limits<std::uintptr_t>::max()))) {
				ThrowError(pIsolate, "Expected an address as a non-negative BigInt that fits the native address width.");
				return false;
			}

			unAddressOut = static_cast<std::uintptr_t>(unAddress);

			return true;
		}

		bool ReadIntegerWordFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Value> const LocalValue, std::uintptr_t& unValueOut) {
			constexpr double kMinimumNumberWord = static_cast<double>(std::numeric_limits<std::int32_t>::min());
			constexpr double kMaximumNumberWord = static_cast<double>(std::numeric_limits<std::uint32_t>::max());

			if (!LocalValue.IsEmpty() && LocalValue->IsBigInt()) {
				bool bLossless = false;
				const std::uint64_t unValue = LocalValue.As<v8::BigInt>()->Uint64Value(&bLossless);
				if (bLossless) {
					if (unValue > static_cast<std::uint64_t>(std::numeric_limits<std::uintptr_t>::max())) {
						ThrowError(pIsolate, "Expected a BigInt that fits the native machine word.");
						return false;
					}

					unValueOut = static_cast<std::uintptr_t>(unValue);
					return true;
				}

				const std::int64_t nValue = LocalValue.As<v8::BigInt>()->Int64Value(&bLossless);
				if (!bLossless || (nValue < static_cast<std::int64_t>(std::numeric_limits<std::intptr_t>::min()))) {
					ThrowError(pIsolate, "Expected a BigInt that fits the native machine word.");
					return false;
				}

				unValueOut = static_cast<std::uintptr_t>(nValue);
				return true;
			}

			if (LocalValue.IsEmpty() || !LocalValue->IsNumber()) {
				ThrowError(pIsolate, "Expected a 32-bit JavaScript integer or a native-width BigInt.");
				return false;
			}

			const double dblValue = LocalValue.As<v8::Number>()->Value();
			if (!std::isfinite(dblValue) || (std::floor(dblValue) != dblValue) || (dblValue < kMinimumNumberWord) || (dblValue > kMaximumNumberWord)) {
				ThrowError(pIsolate, "Expected a 32-bit JavaScript integer; use BigInt for wider native words.");
				return false;
			}

			const std::int64_t nValue = static_cast<std::int64_t>(dblValue);
			unValueOut = static_cast<std::uintptr_t>(nValue);

			return true;
		}

		edict_t* FindEdictByIndex(const int nEntityIndex) {
			return g_Application.GetEngineInterfaces().GetEdict(nEntityIndex);
		}

		CBaseEntity* FindBaseEntityByIndex(const int nEntityIndex) {
			auto* const pEdict = FindEdictByIndex(nEntityIndex);
			if (!pEdict || pEdict->IsFree()) {
				return nullptr;
			}

			auto* const pUnknown = pEdict->GetUnknown();
			if (!pUnknown) {
				return nullptr;
			}

			return pUnknown->GetBaseEntity();
		}

		constexpr int kMemoryHookContextAddressFieldIndex = 0;
		constexpr int kMemoryHookContextInternalFieldCount = 1;

		// Each callback owns a distinct V8 data object; saved methods never reuse a later stack frame.
		v8::Local<v8::Object> CreateMemoryHookContextData(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
			v8::Local<v8::ObjectTemplate> const LocalDataTemplate = v8::ObjectTemplate::New(pIsolate);
			LocalDataTemplate->SetInternalFieldCount(kMemoryHookContextInternalFieldCount);
			v8::Local<v8::Object> LocalData {};
			if (!LocalDataTemplate->NewInstance(LocalContext).ToLocal(&LocalData)) {
				return {};
			}

			LocalData->SetAlignedPointerInInternalField(kMemoryHookContextAddressFieldIndex, nullptr, v8::kEmbedderDataTypeTagDefault);

			return LocalData;
		}

		// Borrows the data handle and stack frame inside their active HandleScope; no heap owner escapes.
		class MemoryHookCallContextScope {
		public:
			MemoryHookCallContextScope(v8::Local<v8::Object> const LocalContextData, MemoryHookCallContext& CallContext) noexcept;
			~MemoryHookCallContextScope() noexcept;

			MemoryHookCallContextScope(MemoryHookCallContextScope const&) = delete;
			MemoryHookCallContextScope(MemoryHookCallContextScope&&) = delete;
			MemoryHookCallContextScope& operator=(MemoryHookCallContextScope const&) = delete;
			MemoryHookCallContextScope& operator=(MemoryHookCallContextScope&&) = delete;

			void Invalidate() noexcept;

		private:
			v8::Local<v8::Object> const m_LocalContextData;
			bool m_bActive;
		};

		MemoryHookCallContextScope::MemoryHookCallContextScope(v8::Local<v8::Object> const LocalContextData, MemoryHookCallContext& CallContext) noexcept :
			m_LocalContextData(LocalContextData)
		{
			m_LocalContextData->SetAlignedPointerInInternalField(kMemoryHookContextAddressFieldIndex, &CallContext, v8::kEmbedderDataTypeTagDefault);
			m_bActive = true;
		}

		MemoryHookCallContextScope::~MemoryHookCallContextScope() noexcept {
			Invalidate();
		}

		void MemoryHookCallContextScope::Invalidate() noexcept {
			if (!m_bActive) {
				return;
			}

			m_LocalContextData->SetAlignedPointerInInternalField(kMemoryHookContextAddressFieldIndex, nullptr, v8::kEmbedderDataTypeTagDefault);
			m_bActive = false;
		}

		// The private data object survives with a saved function, but its native frame address expires.
		MemoryHookCallContext* FindCallContextFromArguments(v8::FunctionCallbackInfo<v8::Value> const& Arguments) noexcept {
			if (Arguments.Data().IsEmpty() || !Arguments.Data()->IsObject()) {
				return nullptr;
			}

			v8::Local<v8::Object> const LocalData = Arguments.Data().As<v8::Object>();
			if (LocalData->InternalFieldCount() != kMemoryHookContextInternalFieldCount) {
				return nullptr;
			}

			return static_cast<MemoryHookCallContext*>(LocalData->GetAlignedPointerFromInternalField(kMemoryHookContextAddressFieldIndex, v8::kEmbedderDataTypeTagDefault));
		}

		template <typename TCallback>
		void RunMemoryHookCallback(v8::Isolate* const pIsolate, char const* const pszFailureMessage, TCallback const& Callback) {
			v8::TryCatch HookFailure(pIsolate);
			try {
				Callback();
			} catch (...) {
				if (!HookFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
					ThrowError(pIsolate, pszFailureMessage);
				}
			}

			if (HookFailure.HasCaught()) {
				HookFailure.ReThrow();
			}
		}

		template <typename TReader>
		bool ReadMemoryHookValue(v8::Isolate* const pIsolate, TReader const& Reader, char const* const pszFailureMessage = nullptr) {
			constexpr char kReadFailureMessage[] = "memory value conversion failed.";

			v8::TryCatch ReadFailure(pIsolate);
			bool bRead = false;
			try {
				bRead = Reader();
			} catch (...) {
				if (ReadFailure.HasCaught()) {
					ReadFailure.ReThrow();
				}

				throw;
			}

			if (!bRead && !ReadFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
				ThrowError(pIsolate, pszFailureMessage ? pszFailureMessage : kReadFailureMessage);
			}

			if (ReadFailure.HasCaught()) {
				ReadFailure.ReThrow();
				return false;
			}

			return bRead && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException();
		}

		bool ReadNumberFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, char const* const pszErrorMessage, double& dblValueOut) {
			if (!pIsolate || LocalContext.IsEmpty() || LocalValue.IsEmpty()) {
				return false;
			}

			double dblValue = 0.0;
			if (!ReadMemoryHookValue(pIsolate, [LocalContext, LocalValue, &dblValue] {
				v8::Maybe<double> const MaybeValue = LocalValue->NumberValue(LocalContext);
				if (MaybeValue.IsNothing()) {
					return false;
				}

				dblValue = MaybeValue.FromJust();

				return true;
			}, pszErrorMessage)) {
				return false;
			}

			dblValueOut = dblValue;

			return true;
		}

		bool ReadInt32FromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, char const* const pszErrorMessage, int& nValueOut) {
			constexpr double kMinimumInteger = static_cast<double>(std::numeric_limits<std::int32_t>::min());
			constexpr double kMaximumInteger = static_cast<double>(std::numeric_limits<std::int32_t>::max());

			static_assert(sizeof(int) == sizeof(std::int32_t));

			double dblValue = 0.0;
			if (!ReadNumberFromValue(pIsolate, LocalContext, LocalValue, pszErrorMessage, dblValue)) {
				return false;
			}

			if (!std::isfinite(dblValue) || (std::floor(dblValue) != dblValue) || (dblValue < kMinimumInteger) || (dblValue > kMaximumInteger)) {
				ThrowError(pIsolate, pszErrorMessage);
				return false;
			}

			nValueOut = static_cast<int>(dblValue);

			return true;
		}

		bool ReadStringFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Value> const LocalValue, std::string& strValueOut) {
			if (!pIsolate || LocalValue.IsEmpty()) {
				return false;
			}

			std::string strValue {};
			if (!ReadMemoryHookValue(pIsolate, [pIsolate, LocalValue, &strValue] {
				// Utf8Value catches conversion exceptions internally; perform coercion first.
				v8::Local<v8::String> LocalString {};
				if (!LocalValue->ToString(pIsolate->GetCurrentContext()).ToLocal(&LocalString)) {
					return false;
				}

				v8::String::Utf8Value const UTF8Value(pIsolate, LocalString);
				if (!*UTF8Value) {
					return false;
				}

				strValue.assign(*UTF8Value, static_cast<std::size_t>(UTF8Value.length()));

				return true;
			})) {
				return false;
			}

			strValueOut = std::move(strValue);

			return true;
		}

		void SetHookReturnValueCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			constexpr int kMinimumArgumentCount = 1;
			constexpr int kValueArgumentIndex = 0;
			constexpr char kCallbackFailureMessage[] = "memory hook Payload.SetHookReturnValue(Value) failed.";

			auto* const pIsolate = Arguments.GetIsolate();
			RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments, pIsolate] {
				auto* const pCallContext = FindCallContextFromArguments(Arguments);
				if (!pCallContext || !pCallContext->m_pMemoryHookManager || !pCallContext->m_pHookRecord || !pCallContext->m_pRawContext || (Arguments.Length() < kMinimumArgumentCount)) {
					return;
				}

				if (!pCallContext->m_pMemoryHookManager->SetReturnFromValue(*pCallContext->m_pHookRecord, pCallContext->m_pRawContext, pIsolate, pIsolate->GetCurrentContext(), Arguments[kValueArgumentIndex])) {
					return;
				}

				pCallContext->m_bHasReturnValue = true;
			});
		}

		void CallHookTrampolineCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			constexpr int kMinimumOptionsArgumentCount = 1;
			constexpr int kOptionsArgumentIndex = 0;
			constexpr char kCallbackFailureMessage[] = "memory hook Payload.CallHookTrampoline(Options) failed.";

			auto* const pIsolate = Arguments.GetIsolate();
			RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments, pIsolate] {
				auto* const pCallContext = FindCallContextFromArguments(Arguments);
				if (!pCallContext || !pCallContext->m_pMemoryHookManager || !pCallContext->m_pHookRecord || !pCallContext->m_pHookRecord->m_pHook || !pCallContext->m_pRawContext || !pCallContext->m_pHookArguments) {
					return;
				}

				void* const pTrampoline = pCallContext->m_pHookRecord->m_pHook->GetTrampoline();
				if (!pTrampoline) {
					ThrowError(pIsolate, "memory hook trampoline is unavailable.");
					return;
				}

				v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
				v8::Local<v8::Object> const LocalOptions = v8::Object::New(pIsolate);
				v8::Local<v8::Value> LocalCallArguments = *pCallContext->m_pHookArguments;

				if (Arguments.Length() >= kMinimumOptionsArgumentCount) {
					if (!Arguments[kOptionsArgumentIndex]->IsObject() || Arguments[kOptionsArgumentIndex]->IsNull()) {
						ThrowError(pIsolate, "memory hook Payload.CallHookTrampoline() expects an options object.");
						return;
					}

					v8::Local<v8::Object> const LocalUserOptions = Arguments[kOptionsArgumentIndex].As<v8::Object>();
					v8::Local<v8::Value> LocalValue {};
					if (!GetValue(pIsolate, LocalContext, LocalUserOptions, "Arguments", LocalValue)) {
						return;
					}

					if (!LocalValue->IsUndefined()) {
						if (!LocalValue->IsArray()) {
							ThrowError(pIsolate, "memory hook Payload.CallHookTrampoline() expects Options.Arguments to be an array.");
							return;
						}

						LocalCallArguments = LocalValue;
					}

					if (!GetValue(pIsolate, LocalContext, LocalUserOptions, "Registers", LocalValue)) {
						return;
					}

					if (!LocalValue->IsUndefined()) {
						if (!LocalValue->IsObject() || LocalValue->IsNull()) {
							ThrowError(pIsolate, "memory hook Payload.CallHookTrampoline() expects Options.Registers to be an object.");
							return;
						}

						if (!SetValue(pIsolate, LocalContext, LocalOptions, "Registers", LocalValue)) {
							return;
						}
					}

					if (!GetValue(pIsolate, LocalContext, LocalUserOptions, "CallerCleanup", LocalValue)) {
						return;
					}

					if (!LocalValue->IsUndefined()) {
						if (!SetValue(pIsolate, LocalContext, LocalOptions, "CallerCleanup", LocalValue)) {
							return;
						}
					}
				}

				if (!SetValue(pIsolate, LocalContext, LocalOptions, "Address", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pTrampoline))))) {
					return;
				}

				if (!SetString(pIsolate, LocalContext, LocalOptions, "Convention", pCallContext->m_pHookRecord->m_Signature.m_strConvention.c_str())) {
					return;
				}

				if (!SetInteger(pIsolate, LocalContext, LocalOptions, "ReturnType", static_cast<int>(pCallContext->m_pHookRecord->m_Signature.m_ReturnType))) {
					return;
				}

				if (!SetValue(pIsolate, LocalContext, LocalOptions, "Arguments", LocalCallArguments)) {
					return;
				}

				if (!SetBoolean(pIsolate, LocalContext, LocalOptions, "ReturnContext", true)) {
					return;
				}

				v8::Local<v8::Value> const LocalResult = pCallContext->m_pMemoryHookManager->CallFunction(pIsolate, LocalContext, LocalOptions, &pCallContext->m_bSkipOriginal);
				if (pIsolate->HasPendingException() || LocalResult.IsEmpty() || !LocalResult->IsObject()) {
					return;
				}

				v8::Local<v8::Object> const LocalResultObject = LocalResult.As<v8::Object>();
				v8::Local<v8::Value> LocalReturnValue {};
				if (!GetValue(pIsolate, LocalContext, LocalResultObject, "ReturnValue", LocalReturnValue)) {
					return;
				}

				if (pCallContext->m_pHookRecord->m_Signature.m_ReturnType != DATA_TYPE_VOID) {
					if (!pCallContext->m_pMemoryHookManager->SetReturnFromValue(*pCallContext->m_pHookRecord, pCallContext->m_pRawContext, pIsolate, LocalContext, LocalReturnValue)) {
						return;
					}

					pCallContext->m_bHasReturnValue = true;
				}

				v8::Local<v8::Value> LocalRegisters {};
				if (!GetValue(pIsolate, LocalContext, LocalResultObject, "Registers", LocalRegisters)) {
					return;
				}

				v8::Local<v8::Object> const LocalCallResult = v8::Object::New(pIsolate);
				if (!SetValue(pIsolate, LocalContext, LocalCallResult, "ReturnValue", LocalReturnValue)) {
					return;
				}

				if (!SetValue(pIsolate, LocalContext, LocalCallResult, "Registers", LocalRegisters)) {
					return;
				}

				Arguments.GetReturnValue().Set(LocalCallResult);
			});
		}

		void SetHookArgumentCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			constexpr int kMinimumArgumentCount = 2;
			constexpr int kIndexArgumentIndex = 0;
			constexpr int kValueArgumentIndex = 1;
			constexpr char kCallbackFailureMessage[] = "memory hook Payload.SetHookArgument(nArgumentIndex, Value) failed.";

			auto* const pIsolate = Arguments.GetIsolate();
			RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments, pIsolate] {
				auto* const pCallContext = FindCallContextFromArguments(Arguments);
				if (!pCallContext || !pCallContext->m_pMemoryHookManager || !pCallContext->m_pHookRecord || !pCallContext->m_pRawContext || !pCallContext->m_pHookArguments || (Arguments.Length() < kMinimumArgumentCount)) {
					return;
				}

				if (!Arguments[kIndexArgumentIndex]->IsInt32()) {
					ThrowError(pIsolate, "memory hook Payload.SetHookArgument() expects an int32 argument index.");
					return;
				}

				const int nArgumentIndex = Arguments[kIndexArgumentIndex].As<v8::Int32>()->Value();
				if (nArgumentIndex < 0) {
					return;
				}

				v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
				if (!pCallContext->m_pMemoryHookManager->SetArgumentFromValue(*pCallContext->m_pHookRecord, pCallContext->m_pRawContext, nArgumentIndex, pIsolate, LocalContext, Arguments[kValueArgumentIndex])) {
					return;
				}

				if (!(*pCallContext->m_pHookArguments)->Set(LocalContext, static_cast<std::uint32_t>(nArgumentIndex), Arguments[kValueArgumentIndex]).FromMaybe(false)) {
					return;
				}
			});
		}

#if defined(_WIN32) && (defined(_M_X64) || defined(__x86_64__))
		bool __fastcall DispatchSourceJSRawHook(Detours::Hook::PRAW_CONTEXT const pRawContext, const int nHookID) noexcept {
#elif defined(_WIN32)
		bool __cdecl DispatchSourceJSRawHook(Detours::Hook::PRAW_CONTEXT const pRawContext, const int nHookID) noexcept {
#else
		bool DispatchSourceJSRawHook(Detours::Hook::PRAW_CONTEXT const pRawContext, const int nHookID) noexcept {
#endif
			try {
				return g_Application.GetMemoryHookManager().HandleHook(nHookID, pRawContext);
			} catch (...) {
				LogError("Memory hook dispatch failed Hook=%d", nHookID);
				return false;
			}
		}

		void* DispatchSourceJSPostHook(void* const pReturnSlot, PMemoryHookPostContext const pPostContext) noexcept {
			return g_Application.GetMemoryHookManager().HandlePostHook(pReturnSlot, pPostContext);
		}

		template <std::size_t unOffset, std::size_t unByteCount>
		std::uint16_t ReadUnsignedShort(unsigned char const (&arrBytes)[unByteCount]) noexcept {
			static_assert(unOffset <= unByteCount, "Native word read offset exceeds its byte array.");
			static_assert(sizeof(std::uint16_t) <= (unByteCount - unOffset), "Native word read exceeds its byte array.");

			std::uint16_t unValue = 0;
			std::memcpy(&unValue, arrBytes + unOffset, sizeof(unValue));

			return unValue;
		}

		template <std::size_t unOffset, std::size_t unByteCount>
		std::uint32_t ReadUnsignedInteger(unsigned char const (&arrBytes)[unByteCount]) noexcept {
			static_assert(unOffset <= unByteCount, "Native word read offset exceeds its byte array.");
			static_assert(sizeof(std::uint32_t) <= (unByteCount - unOffset), "Native word read exceeds its byte array.");

			std::uint32_t unValue = 0;
			std::memcpy(&unValue, arrBytes + unOffset, sizeof(unValue));

			return unValue;
		}

		v8::Local<v8::Uint8Array> MakeByteArray(v8::Isolate* const pIsolate, unsigned char const* const pchBytes, const std::size_t unSize) {
			if ((unSize > 0) && !pchBytes) {
				ThrowError(pIsolate, "Cannot copy memory hook bytes from a null address.");
				return {};
			}

			std::unique_ptr<v8::BackingStore> pBackingStore = v8::ArrayBuffer::NewBackingStore(pIsolate, unSize, v8::BackingStoreInitializationMode::kZeroInitialized, v8::BackingStoreOnFailureMode::kReturnNull);
			if (!pBackingStore || ((unSize > 0) && !pBackingStore->Data())) {
				ThrowError(pIsolate, "Failed to allocate memory hook byte storage.");
				return {};
			}

			if (unSize > 0) {
				std::memcpy(pBackingStore->Data(), pchBytes, unSize);
			}

			v8::Local<v8::ArrayBuffer> const LocalArrayBuffer = v8::ArrayBuffer::New(pIsolate, std::move(pBackingStore));

			return v8::Uint8Array::New(LocalArrayBuffer, 0, unSize);
		}

		v8::Local<v8::Value> MakeMachineWord(v8::Isolate* const pIsolate, const std::uint64_t unValue) {
			return v8::BigInt::NewFromUnsigned(pIsolate, unValue);
		}

		v8::Local<v8::Object> MakeNativeRegisterObject(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, NATIVE_CALL_RESULT const& CallResult) {
#if defined(DETOURS_ARCH_X64)
			constexpr std::size_t kXMMRegisterCount = 16;
#else
			constexpr std::size_t kXMMRegisterCount = 8;
#endif
			constexpr std::size_t kFPURegisterCount = 8;

			static_assert(kFXStateControlWordOffset <= (kFXStateSize - sizeof(std::uint16_t)));
			static_assert(kFXStateStatusWordOffset <= (kFXStateSize - sizeof(std::uint16_t)));
			static_assert(kFXStateTagWordOffset < kFXStateSize);
			static_assert(kFXStateMXCSROffset <= (kFXStateSize - sizeof(std::uint32_t)));
			static_assert((kFXStateRegisterOffset < kFXStateSize) && (kFXStateRegisterValueSize <= kFXStateRegisterSize) && (kFPURegisterCount <= ((kFXStateSize - kFXStateRegisterOffset) / kFXStateRegisterSize)));
			static_assert((kFXStateXMMOffset < kFXStateSize) && (kXMMRegisterCount <= ((kFXStateSize - kFXStateXMMOffset) / kFXStateXMMSize)));

			v8::Local<v8::Object> const LocalRegisters = v8::Object::New(pIsolate);
			auto SetRegister = [pIsolate, LocalContext, LocalRegisters](char const* const pszPropertyName, v8::Local<v8::Value> const LocalValue) -> bool {
				return SetValue(pIsolate, LocalContext, LocalRegisters, pszPropertyName, LocalValue);
			};

#if defined(DETOURS_ARCH_X64)
			if (!SetRegister("RFLAGS", MakeMachineWord(pIsolate, CallResult.m_unRFLAGS))) {
				return {};
			}

			if (!SetRegister("RAX", MakeMachineWord(pIsolate, CallResult.m_unRAX))) {
				return {};
			}

			if (!SetRegister("RCX", MakeMachineWord(pIsolate, CallResult.m_unRCX))) {
				return {};
			}

			if (!SetRegister("RDX", MakeMachineWord(pIsolate, CallResult.m_unRDX))) {
				return {};
			}

			if (!SetRegister("RBX", MakeMachineWord(pIsolate, CallResult.m_unRBX))) {
				return {};
			}

			if (!SetRegister("RSP", MakeMachineWord(pIsolate, CallResult.m_unRSP))) {
				return {};
			}

			if (!SetRegister("RBP", MakeMachineWord(pIsolate, CallResult.m_unRBP))) {
				return {};
			}

			if (!SetRegister("RSI", MakeMachineWord(pIsolate, CallResult.m_unRSI))) {
				return {};
			}

			if (!SetRegister("RDI", MakeMachineWord(pIsolate, CallResult.m_unRDI))) {
				return {};
			}

			if (!SetRegister("R8", MakeMachineWord(pIsolate, CallResult.m_unR8))) {
				return {};
			}

			if (!SetRegister("R9", MakeMachineWord(pIsolate, CallResult.m_unR9))) {
				return {};
			}

			if (!SetRegister("R10", MakeMachineWord(pIsolate, CallResult.m_unR10))) {
				return {};
			}

			if (!SetRegister("R11", MakeMachineWord(pIsolate, CallResult.m_unR11))) {
				return {};
			}

			if (!SetRegister("R12", MakeMachineWord(pIsolate, CallResult.m_unR12))) {
				return {};
			}

			if (!SetRegister("R13", MakeMachineWord(pIsolate, CallResult.m_unR13))) {
				return {};
			}

			if (!SetRegister("R14", MakeMachineWord(pIsolate, CallResult.m_unR14))) {
				return {};
			}

			if (!SetRegister("R15", MakeMachineWord(pIsolate, CallResult.m_unR15))) {
				return {};
			}
#else
			if (!SetRegister("EFLAGS", MakeMachineWord(pIsolate, CallResult.m_unEFLAGS))) {
				return {};
			}

			if (!SetRegister("EAX", MakeMachineWord(pIsolate, CallResult.m_unEAX))) {
				return {};
			}

			if (!SetRegister("ECX", MakeMachineWord(pIsolate, CallResult.m_unECX))) {
				return {};
			}

			if (!SetRegister("EDX", MakeMachineWord(pIsolate, CallResult.m_unEDX))) {
				return {};
			}

			if (!SetRegister("EBX", MakeMachineWord(pIsolate, CallResult.m_unEBX))) {
				return {};
			}

			if (!SetRegister("ESP", MakeMachineWord(pIsolate, CallResult.m_unESP))) {
				return {};
			}

			if (!SetRegister("EBP", MakeMachineWord(pIsolate, CallResult.m_unEBP))) {
				return {};
			}

			if (!SetRegister("ESI", MakeMachineWord(pIsolate, CallResult.m_unESI))) {
				return {};
			}

			if (!SetRegister("EDI", MakeMachineWord(pIsolate, CallResult.m_unEDI))) {
				return {};
			}
#endif
			if (!SetRegister("FPUControlWord", v8::Integer::NewFromUnsigned(pIsolate, ReadUnsignedShort<kFXStateControlWordOffset>(CallResult.m_arrFXState)))) {
				return {};
			}

			if (!SetRegister("FPUStatusWord", v8::Integer::NewFromUnsigned(pIsolate, ReadUnsignedShort<kFXStateStatusWordOffset>(CallResult.m_arrFXState)))) {
				return {};
			}

			if (!SetRegister("FPUTagWord", v8::Integer::NewFromUnsigned(pIsolate, CallResult.m_arrFXState[kFXStateTagWordOffset]))) {
				return {};
			}

			if (!SetRegister("MXCSR", v8::Integer::NewFromUnsigned(pIsolate, ReadUnsignedInteger<kFXStateMXCSROffset>(CallResult.m_arrFXState)))) {
				return {};
			}

			for (std::size_t unFPURegisterIndex = 0; unFPURegisterIndex < kFPURegisterCount; ++unFPURegisterIndex) {
				std::string const strRegisterName = "ST" + std::to_string(unFPURegisterIndex);
				unsigned char const* const pchRegisterBytes = CallResult.m_arrFXState + kFXStateRegisterOffset + unFPURegisterIndex * kFXStateRegisterSize;
				if (!SetRegister(strRegisterName.c_str(), MakeByteArray(pIsolate, pchRegisterBytes, kFXStateRegisterValueSize))) {
					return {};
				}
			}

			for (std::size_t unXMMRegisterIndex = 0; unXMMRegisterIndex < kXMMRegisterCount; ++unXMMRegisterIndex) {
				std::string const strRegisterName = "XMM" + std::to_string(unXMMRegisterIndex);
				unsigned char const* const pchRegisterBytes = CallResult.m_arrFXState + kFXStateXMMOffset + unXMMRegisterIndex * kFXStateXMMSize;
				if (!SetRegister(strRegisterName.c_str(), MakeByteArray(pIsolate, pchRegisterBytes, kFXStateXMMSize))) {
					return {};
				}
			}

			if (!SetRegister("FXState", MakeByteArray(pIsolate, CallResult.m_arrFXState, sizeof(CallResult.m_arrFXState)))) {
				return {};
			}

			return LocalRegisters;
		}

		std::string ConvertStringToLowercase(std::string const& strValue) {
			std::string strResult = strValue;
			for (std::size_t unCharacterIndex = 0; unCharacterIndex < strResult.size(); ++unCharacterIndex) {
				if ((strResult[unCharacterIndex] >= 'A') && (strResult[unCharacterIndex] <= 'Z')) {
					strResult[unCharacterIndex] = static_cast<char>((strResult[unCharacterIndex] - 'A') + 'a');
				}
			}

			return strResult;
		}

		std::string NormalizeCallingConvention(std::string const& strValue) {
			std::string strResult = ConvertStringToLowercase(strValue);
			while (!strResult.empty() && (strResult[0] == '_')) {
				strResult.erase(strResult.begin());
			}

			if (strResult == "c") {
				return "cdecl";
			}

			return strResult;
		}

		std::uintptr_t ConvertFloatToArgumentWord(const float flValue) noexcept {
			return std::bit_cast<std::uint32_t>(flValue);
		}

		void AppendU8(std::vector<unsigned char>& vecCodeBytes, const unsigned char unValue) {
			vecCodeBytes.push_back(unValue);
		}

#if defined(DETOURS_ARCH_X86)
		void AppendU32LE(std::vector<unsigned char>& vecCodeBytes, const std::uint32_t unValue) {
			constexpr std::size_t kByteBitCount = 8;
			constexpr std::uint32_t kByteMask = 0xFF;

			for (std::size_t unByteIndex = 0; unByteIndex < sizeof(unValue); ++unByteIndex) {
				vecCodeBytes.push_back(static_cast<unsigned char>((unValue >> (unByteIndex * kByteBitCount)) & kByteMask));
			}
		}
#endif

#if defined(DETOURS_ARCH_X64)
		void AppendU64LE(std::vector<unsigned char>& vecCodeBytes, const std::uint64_t unValue) {
			constexpr std::size_t kByteBitCount = 8;
			constexpr std::uint64_t kByteMask = 0xFF;

			for (std::size_t unByteIndex = 0; unByteIndex < sizeof(unValue); ++unByteIndex) {
				vecCodeBytes.push_back(static_cast<unsigned char>((unValue >> (unByteIndex * kByteBitCount)) & kByteMask));
			}
		}
#endif

		void* AllocateExecutable(const std::size_t unSize) noexcept {
			if (!unSize) {
				return nullptr;
			}

#if defined(_WIN32)
			return VirtualAlloc(nullptr, unSize, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
#else
			void* const pMemory = mmap(nullptr, unSize, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
			if (pMemory == MAP_FAILED) {
				return nullptr;
			}

			if (!pMemory) {
				if (munmap(pMemory, unSize) != 0) {
					const int nError = errno;
					LogError("AllocateExecutable cleanup failed Address=%p Size=%zu Error=0x%08X", pMemory, unSize, static_cast<unsigned int>(nError));
				}

				return nullptr;
			}

			return pMemory;
#endif
		}

#if defined(_WIN32)
		void FreeExecutable(void* const pMemory, const std::size_t unSize) noexcept {
			if (!pMemory || !unSize) {
				return;
			}

			if (!VirtualFree(pMemory, 0, MEM_RELEASE)) {
				const DWORD unError = GetLastError();
				LogError("FreeExecutable failed Address=%p Size=%zu Error=0x%08lX", pMemory, unSize, static_cast<unsigned long>(unError));
			}
		}
#endif

#if defined(DETOURS_ARCH_X64)
		bool FindX64RegisterCodeByName(std::string const& strRegisterName, unsigned char& unRegisterCodeOut) noexcept {
			constexpr std::size_t kRegisterCount = 16;

			constexpr char const* kRegisterNames[kRegisterCount] = {
				"RAX",
				"RCX",
				"RDX",
				"RBX",
				"RSP",
				"RBP",
				"RSI",
				"RDI",
				"R8",
				"R9",
				"R10",
				"R11",
				"R12",
				"R13",
				"R14",
				"R15",
			};

			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kRegisterCount; ++unRegisterIndex) {
				if (strRegisterName == kRegisterNames[unRegisterIndex]) {
					unRegisterCodeOut = static_cast<unsigned char>(unRegisterIndex);
					return true;
				}
			}

			return false;
		}
#else
		bool FindX86RegisterOpcodeByName(std::string const& strRegisterName, unsigned char& unRegisterOpcodeOut) noexcept {
			constexpr std::size_t kRegisterCount = 8;
			constexpr unsigned char kFirstRegisterOpcode = 0xB8;

			constexpr char const* kRegisterNames[kRegisterCount] = {
				"EAX",
				"ECX",
				"EDX",
				"EBX",
				"ESP",
				"EBP",
				"ESI",
				"EDI",
			};

			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kRegisterCount; ++unRegisterIndex) {
				if (strRegisterName == kRegisterNames[unRegisterIndex]) {
					unRegisterOpcodeOut = static_cast<unsigned char>(kFirstRegisterOpcode + unRegisterIndex);
					return true;
				}
			}

			return false;
		}
#endif

#if defined(DETOURS_ARCH_X64)
		bool IsFloatingPointArgument(NativeCallArgument const& Argument) noexcept {
			return (Argument.m_Kind == NativeCallArgumentKind::Float) || (Argument.m_Kind == NativeCallArgumentKind::Double);
		}
#endif

		// The caller discards RawContextOut on failure; stack storage remains owned by CallStackStorage.
		// The stack-byte output commits only after the complete context is valid.
		bool ConfigureNativeCallContext(NativeCallRequest const& CallRequest, NativeCallStackStorage const& CallStackStorage, Detours::Hook::RAW_CONTEXT& RawContextOut, std::size_t& unStackArgumentBytesOut) noexcept {
			// Detours PrepareRawCall reserves the remaining working stack for the native callee.
			constexpr std::size_t kMaximumStackCopySize = HOOK_RAW_CALL_MAXIMUM_STACK_SIZE / 4;
#if defined(DETOURS_ARCH_X64)
			constexpr std::size_t kStackEntryOffset = sizeof(std::uint64_t);
			constexpr unsigned char kStackRegisterCode = 4;
#if defined(_WIN32)
			constexpr std::size_t kArgumentRegisterCount = 4;
			constexpr std::size_t kSIMDArgumentRegisterCount = 4;
			// The return address precedes the four Windows x64 register-home slots.
			constexpr std::size_t kFirstStackArgumentOffset = (1 + kArgumentRegisterCount) * sizeof(std::uint64_t);
#else
			constexpr std::size_t kArgumentRegisterCount = 6;
			constexpr std::size_t kSIMDArgumentRegisterCount = 8;
			constexpr std::size_t kFirstStackArgumentOffset = sizeof(std::uint64_t);
			constexpr std::uint64_t kVariadicRegisterCountMask = 0xFF;
#endif
#else
			// Native entry ESP + the return-address word is sixteen-byte aligned.
			constexpr std::size_t kStackEntryOffset = 0x0C;
			constexpr std::size_t kFirstStackArgumentOffset = sizeof(std::uint32_t);
			constexpr std::size_t kThiscallArgumentRegisterCount = 1;
			constexpr std::size_t kFastcallArgumentRegisterCount = 2;
			constexpr unsigned char kFirstRegisterOpcode = 0xB8;
			constexpr unsigned char kStackRegisterOpcode = 0xBC;
#endif

			std::size_t unStackArgumentBytes = 0;

			unsigned char* const pchStackStorage = CallStackStorage.GetAddress();
			const std::size_t unStackStorageSize = CallStackStorage.GetSize();
			if (!pchStackStorage || (unStackStorageSize <= kStackEntryOffset)) {
				return false;
			}

#if defined(DETOURS_ARCH_X64)
			const std::size_t unStackCapacity = std::min(unStackStorageSize - kStackEntryOffset, kMaximumStackCopySize);
			if (kFirstStackArgumentOffset > unStackCapacity) {
				return false;
			}

#if defined(_WIN32)
			const std::size_t unStackArgumentCount = (CallRequest.m_vecArguments.size() > kArgumentRegisterCount) ? (CallRequest.m_vecArguments.size() - kArgumentRegisterCount) : 0;
#else
			std::size_t unIntegerArgumentRegisterCount = 0;
			std::size_t unSIMDArgumentRegisterCount = 0;
			std::size_t unStackArgumentCount = 0;
			for (auto const& Argument : CallRequest.m_vecArguments) {
				if (IsFloatingPointArgument(Argument) && (unSIMDArgumentRegisterCount < kSIMDArgumentRegisterCount)) {
					++unSIMDArgumentRegisterCount;

				} else if (!IsFloatingPointArgument(Argument) && (unIntegerArgumentRegisterCount < kArgumentRegisterCount)) {
					++unIntegerArgumentRegisterCount;

				} else {
					++unStackArgumentCount;
				}
			}
#endif

			if (unStackArgumentCount > ((unStackCapacity - kFirstStackArgumentOffset) / sizeof(std::uint64_t))) {
				return false;
			}

#if defined(_WIN32)
			unsigned long long* const arrArgumentRegisters[kArgumentRegisterCount] = { &RawContextOut.m_unRCX, &RawContextOut.m_unRDX, &RawContextOut.m_unR8, &RawContextOut.m_unR9 };
#else
			unsigned long long* const arrArgumentRegisters[kArgumentRegisterCount] = { &RawContextOut.m_unRDI, &RawContextOut.m_unRSI, &RawContextOut.m_unRDX, &RawContextOut.m_unRCX, &RawContextOut.m_unR8, &RawContextOut.m_unR9 };
			// SysV variadic callees read AL; non-variadic callees ignore this count.
			RawContextOut.m_unRAX = (RawContextOut.m_unRAX & ~kVariadicRegisterCountMask) | static_cast<std::uint64_t>(unSIMDArgumentRegisterCount);
			unIntegerArgumentRegisterCount = 0;
			unSIMDArgumentRegisterCount = 0;
#endif

			Detours::Hook::PRAW_CONTEXT_M512 const arrSIMDArgumentRegisters[kSIMDArgumentRegisterCount] = {
				&RawContextOut.m_ZMM0, &RawContextOut.m_ZMM1, &RawContextOut.m_ZMM2, &RawContextOut.m_ZMM3,
#if !defined(_WIN32)
				&RawContextOut.m_ZMM4, &RawContextOut.m_ZMM5, &RawContextOut.m_ZMM6, &RawContextOut.m_ZMM7,
#endif
			};

			static_assert(sizeof(Detours::Hook::RAW_CONTEXT_M512) >= sizeof(std::uint64_t));

			std::size_t unStackArgumentIndex = 0;
			for (std::size_t unArgumentIndex = 0; unArgumentIndex < CallRequest.m_vecArguments.size(); ++unArgumentIndex) {
				NativeCallArgument const& Argument = CallRequest.m_vecArguments[unArgumentIndex];
#if defined(_WIN32)
				if (unArgumentIndex < kArgumentRegisterCount) {
					// Mirror floating bits into the GPR slot for Windows variadic calls too.
					*arrArgumentRegisters[unArgumentIndex] = Argument.m_unBits;
					if (IsFloatingPointArgument(Argument)) {
						std::memcpy(arrSIMDArgumentRegisters[unArgumentIndex], &Argument.m_unBits, sizeof(Argument.m_unBits));
					}

					continue;
				}
#else
				if (IsFloatingPointArgument(Argument) && (unSIMDArgumentRegisterCount < kSIMDArgumentRegisterCount)) {
					std::memcpy(arrSIMDArgumentRegisters[unSIMDArgumentRegisterCount], &Argument.m_unBits, sizeof(Argument.m_unBits));
					++unSIMDArgumentRegisterCount;
					continue;
				}

				if (!IsFloatingPointArgument(Argument) && (unIntegerArgumentRegisterCount < kArgumentRegisterCount)) {
					*arrArgumentRegisters[unIntegerArgumentRegisterCount] = Argument.m_unBits;
					++unIntegerArgumentRegisterCount;
					continue;
				}
#endif

				unsigned char* const pchArgumentAddress = pchStackStorage + kStackEntryOffset + kFirstStackArgumentOffset + (unStackArgumentIndex * sizeof(std::uint64_t));
				std::memcpy(pchArgumentAddress, &Argument.m_unBits, sizeof(Argument.m_unBits));
				++unStackArgumentIndex;
			}
#else
			const bool bThiscall = CallRequest.m_strConvention == "thiscall";
			const bool bFastcall = CallRequest.m_strConvention == "fastcall";
			const std::size_t unArgumentRegisterCount = bThiscall ? kThiscallArgumentRegisterCount : (bFastcall ? kFastcallArgumentRegisterCount : 0);
			const std::size_t unStackCapacity = std::min(unStackStorageSize - kStackEntryOffset, kMaximumStackCopySize);
			if (kFirstStackArgumentOffset > unStackCapacity) {
				return false;
			}

			const std::size_t unStackArgumentCapacity = unStackCapacity - kFirstStackArgumentOffset;
			std::size_t unArgumentRegisterIndex = 0;
			for (std::size_t unArgumentIndex = 0; unArgumentIndex < CallRequest.m_vecArguments.size(); ++unArgumentIndex) {
				NativeCallArgument const& Argument = CallRequest.m_vecArguments[unArgumentIndex];
				if (bThiscall && (unArgumentIndex == 0) && (Argument.m_Kind != NativeCallArgumentKind::Integer)) {
					return false;
				}

#if defined(__GNUC__) && !defined(__clang__)
				// GCC i386 closes the fastcall GPR window at a wide integer; FP arguments do not.
				if (bFastcall && (Argument.m_Kind == NativeCallArgumentKind::WideInteger)) {
					unArgumentRegisterIndex = unArgumentRegisterCount;
				}
#endif

				if ((Argument.m_Kind == NativeCallArgumentKind::Integer) && (unArgumentRegisterIndex < unArgumentRegisterCount)) {
					++unArgumentRegisterIndex;
					continue;
				}

				const std::size_t unArgumentSize = ((Argument.m_Kind == NativeCallArgumentKind::Double) || (Argument.m_Kind == NativeCallArgumentKind::WideInteger)) ? sizeof(std::uint64_t) : sizeof(std::uint32_t);
				if (unArgumentSize > (unStackArgumentCapacity - unStackArgumentBytes)) {
					return false;
				}

				unStackArgumentBytes += unArgumentSize;
			}

			std::uint32_t* const arrArgumentRegisters[kFastcallArgumentRegisterCount] = { &RawContextOut.m_unECX, &RawContextOut.m_unEDX };
			unArgumentRegisterIndex = 0;
			unStackArgumentBytes = 0;
			for (auto const& Argument : CallRequest.m_vecArguments) {
#if defined(__GNUC__) && !defined(__clang__)
				if (bFastcall && (Argument.m_Kind == NativeCallArgumentKind::WideInteger)) {
					unArgumentRegisterIndex = unArgumentRegisterCount;
				}
#endif

				if ((Argument.m_Kind == NativeCallArgumentKind::Integer) && (unArgumentRegisterIndex < unArgumentRegisterCount)) {
					*arrArgumentRegisters[unArgumentRegisterIndex] = static_cast<std::uint32_t>(Argument.m_unBits);
					++unArgumentRegisterIndex;
					continue;
				}

				const std::size_t unArgumentSize = ((Argument.m_Kind == NativeCallArgumentKind::Double) || (Argument.m_Kind == NativeCallArgumentKind::WideInteger)) ? sizeof(std::uint64_t) : sizeof(std::uint32_t);
				// x86 is little-endian; copy a complete wide argument without splitting its ABI class.
				std::memcpy(pchStackStorage + kStackEntryOffset + kFirstStackArgumentOffset + unStackArgumentBytes, &Argument.m_unBits, unArgumentSize);
				unStackArgumentBytes += unArgumentSize;
			}
#endif

			RawContextOut.m_Stack.SetAddress(pchStackStorage + kStackEntryOffset);

			for (auto const& RegisterValue : CallRequest.m_mapRegisters) {
#if defined(DETOURS_ARCH_X64)
				unsigned char unRegisterCode = 0;
				if (!FindX64RegisterCodeByName(RegisterValue.first, unRegisterCode) || (unRegisterCode == kStackRegisterCode)) {
					continue;
				}

				const std::uint64_t unRegisterValue = static_cast<std::uint64_t>(RegisterValue.second);
				switch (unRegisterCode) {
					case 0:
						RawContextOut.m_unRAX = unRegisterValue;
						break;

					case 1:
						RawContextOut.m_unRCX = unRegisterValue;
						break;

					case 2:
						RawContextOut.m_unRDX = unRegisterValue;
						break;

					case 3:
						RawContextOut.m_unRBX = unRegisterValue;
						break;

					case 5:
						RawContextOut.m_unRBP = unRegisterValue;
						break;

					case 6:
						RawContextOut.m_unRSI = unRegisterValue;
						break;

					case 7:
						RawContextOut.m_unRDI = unRegisterValue;
						break;

					case 8:
						RawContextOut.m_unR8 = unRegisterValue;
						break;

					case 9:
						RawContextOut.m_unR9 = unRegisterValue;
						break;

					case 10:
						RawContextOut.m_unR10 = unRegisterValue;
						break;

					case 11:
						RawContextOut.m_unR11 = unRegisterValue;
						break;

					case 12:
						RawContextOut.m_unR12 = unRegisterValue;
						break;

					case 13:
						RawContextOut.m_unR13 = unRegisterValue;
						break;

					case 14:
						RawContextOut.m_unR14 = unRegisterValue;
						break;

					case 15:
						RawContextOut.m_unR15 = unRegisterValue;
						break;
				}
#else
				unsigned char unRegisterOpcode = 0;
				if (!FindX86RegisterOpcodeByName(RegisterValue.first, unRegisterOpcode) || (unRegisterOpcode == kStackRegisterOpcode)) {
					continue;
				}

				const std::uint32_t unRegisterValue = static_cast<std::uint32_t>(RegisterValue.second);
				switch (unRegisterOpcode - kFirstRegisterOpcode) {
					case 0:
						RawContextOut.m_unEAX = unRegisterValue;
						break;

					case 1:
						RawContextOut.m_unECX = unRegisterValue;
						break;

					case 2:
						RawContextOut.m_unEDX = unRegisterValue;
						break;

					case 3:
						RawContextOut.m_unEBX = unRegisterValue;
						break;

					case 5:
						RawContextOut.m_unEBP = unRegisterValue;
						break;

					case 6:
						RawContextOut.m_unESI = unRegisterValue;
						break;

					case 7:
						RawContextOut.m_unEDI = unRegisterValue;
						break;
				}
#endif
			}

			unStackArgumentBytesOut = unStackArgumentBytes;

			return true;
		}

#if defined(DETOURS_ARCH_X86)
		// Detours stores x87 values in the legacy 80-bit register format.
		double ReadX87ValueAsDouble(Detours::Hook::RAW_CONTEXT_FPU_REGISTER const* const pX87Register) noexcept {
			if (!pX87Register) {
				return 0.0;
			}

			double dblValue = 0.0;
			alignas(kX87StateAlignment) unsigned char arrFPUState[kX87StateByteCount] {};
#if defined(_MSC_VER) && defined(_M_IX86)
			unsigned char const* const pchX87Value = pX87Register->m_unRAW;
			__asm {
				lea eax, arrFPUState
				fnsave [eax]
				mov eax, pchX87Value
				fld tbyte ptr [eax]
				lea eax, dblValue
				fstp qword ptr [eax]
				lea eax, arrFPUState
				frstor [eax]
			}
#elif defined(__GNUC__) || defined(__clang__)
			__asm__ __volatile__("fnsave %0\n\tfldt %2\n\tfstpl %1\n\tfrstor %0" : "+m"(arrFPUState), "=m"(dblValue) : "m"(*pX87Register) : "st");
#else
			#error x87 value conversion requires MSVC x86 or GNU-compatible x86 inline assembly
#endif

			return dblValue;
		}

		bool WriteX87ValueFromDouble(const double dblValue, Detours::Hook::RAW_CONTEXT_FPU* const pX87Context) noexcept {
			constexpr unsigned int kTopRegisterBitOffset = 11;
			constexpr unsigned int kTopRegisterMask = 0x07;
			constexpr unsigned int kTagBitCount = 2;
			constexpr unsigned int kEmptyTag = 0x03;

			if (!pX87Context) {
				return false;
			}

			const unsigned int unX87TopRegisterIndex = (pX87Context->m_unStatusWord >> kTopRegisterBitOffset) & kTopRegisterMask;
			const unsigned int unX87TopTagShift = unX87TopRegisterIndex * kTagBitCount;
			const unsigned int unX87TopTag = (pX87Context->m_unTagWord >> unX87TopTagShift) & kEmptyTag;
			const bool bX87TopIsOccupied = unX87TopTag != kEmptyTag;
			const unsigned int unX87TopIsOccupied = bX87TopIsOccupied ? 1 : 0;
			alignas(kX87StateAlignment) unsigned char arrFPUState[kX87StateByteCount] {};
#if defined(_MSC_VER) && defined(_M_IX86)
			__asm {
				lea eax, arrFPUState
				fnsave [eax]
				mov eax, pX87Context
				frstor [eax]
				cmp unX87TopIsOccupied, 0
				je X87ReturnValueStackTopIsEmpty
				fstp st(0)
			X87ReturnValueStackTopIsEmpty:
				fld qword ptr [dblValue]
				mov eax, pX87Context
				fnsave [eax]
				lea eax, arrFPUState
				frstor [eax]
			}
#elif defined(__GNUC__) || defined(__clang__)
			__asm__ __volatile__("fnsave %0\n\tfrstor %1\n\ttestl %3, %3\n\tjz 1f\n\tfstp %%st(0)\n1:\n\tfldl %2\n\tfnsave %1\n\tfrstor %0" : "+m"(arrFPUState), "+m"(*pX87Context) : "m"(dblValue), "r"(unX87TopIsOccupied) : "cc", "st");
#else
			#error x87 value conversion requires MSVC x86 or GNU-compatible x86 inline assembly
#endif

			return true;
		}
#endif

		void CaptureNativeCallResult(Detours::Hook::RAW_CONTEXT const& RawContext, NATIVE_CALL_RESULT& CallResultOut) noexcept {
			constexpr std::size_t kFPURegisterCount = 8;
			constexpr unsigned int kFPUTagBitCount = 2;
			constexpr unsigned short kEmptyFPUTag = 0x03;
			constexpr std::size_t kFXStateFPUOperationCodeOffset = 0x06;
			constexpr std::size_t kFXStateFPUInstructionAddressOffset = 0x08;
			constexpr std::size_t kFXStateFPUCodeSegmentOffset = 0x0C;
			constexpr std::size_t kFXStateFPUDataAddressOffset = 0x10;
			constexpr std::size_t kFXStateFPUDataSegmentOffset = 0x14;
#if defined(DETOURS_ARCH_X64)
			constexpr std::size_t kXMMRegisterCount = 16;
#else
			constexpr std::size_t kXMMRegisterCount = 8;
			constexpr unsigned int kMachineWordBitCount = 32;
			constexpr double kMaximumCapturedFloat = static_cast<double>(std::numeric_limits<float>::max());
#endif

			static_assert(sizeof(RawContext.m_FPU.m_Registers) >= (kFPURegisterCount * sizeof(RawContext.m_FPU.m_Registers[0])));
			static_assert(sizeof(RawContext.m_FPU.m_Registers[0].m_unRAW) >= kFXStateRegisterValueSize);
			static_assert(sizeof(Detours::Hook::RAW_CONTEXT_M512) >= kFXStateXMMSize);
			static_assert(std::numeric_limits<float>::has_infinity, "Native floating snapshots require representable signed infinity.");
			static_assert((kFXStateRegisterOffset + (kFPURegisterCount * kFXStateRegisterSize)) <= kFXStateSize);
			static_assert((kFXStateXMMOffset + (kXMMRegisterCount * kFXStateXMMSize)) <= kFXStateSize);
			static_assert((kFXStateFPUDataSegmentOffset + sizeof(RawContext.m_FPU.m_unDS)) <= kFXStateRegisterOffset);

#if defined(DETOURS_ARCH_X64)
			CallResultOut.m_unInteger = RawContext.m_unRAX;
			std::memcpy(&CallResultOut.m_dblDouble, &RawContext.m_ZMM0, sizeof(CallResultOut.m_dblDouble));
			std::memcpy(&CallResultOut.m_flFloat, &RawContext.m_ZMM0, sizeof(CallResultOut.m_flFloat));
			CallResultOut.m_unRFLAGS = RawContext.m_unRFLAGS;
			CallResultOut.m_unRAX = RawContext.m_unRAX;
			CallResultOut.m_unRCX = RawContext.m_unRCX;
			CallResultOut.m_unRDX = RawContext.m_unRDX;
			CallResultOut.m_unRBX = RawContext.m_unRBX;
			CallResultOut.m_unRSP = reinterpret_cast<std::uintptr_t>(RawContext.m_Stack.GetAddress());
			CallResultOut.m_unRBP = RawContext.m_unRBP;
			CallResultOut.m_unRSI = RawContext.m_unRSI;
			CallResultOut.m_unRDI = RawContext.m_unRDI;
			CallResultOut.m_unR8 = RawContext.m_unR8;
			CallResultOut.m_unR9 = RawContext.m_unR9;
			CallResultOut.m_unR10 = RawContext.m_unR10;
			CallResultOut.m_unR11 = RawContext.m_unR11;
			CallResultOut.m_unR12 = RawContext.m_unR12;
			CallResultOut.m_unR13 = RawContext.m_unR13;
			CallResultOut.m_unR14 = RawContext.m_unR14;
			CallResultOut.m_unR15 = RawContext.m_unR15;
#else
			CallResultOut.m_unInteger = static_cast<std::uint64_t>(RawContext.m_unEAX) | (static_cast<std::uint64_t>(RawContext.m_unEDX) << kMachineWordBitCount);
			const double dblX87Value = ReadX87ValueAsDouble(&RawContext.m_FPU.m_Registers[0]);
			CallResultOut.m_dblDouble = dblX87Value;

			// A valid double return may exceed float range; never narrow that alternate view directly.
			if (std::isfinite(dblX87Value) && (std::fabs(dblX87Value) > kMaximumCapturedFloat)) {
				CallResultOut.m_flFloat = std::signbit(dblX87Value) ? -std::numeric_limits<float>::infinity() : std::numeric_limits<float>::infinity();
			} else {
				CallResultOut.m_flFloat = static_cast<float>(dblX87Value);
			}

			CallResultOut.m_unEFLAGS = RawContext.m_unEFLAGS;
			CallResultOut.m_unEAX = RawContext.m_unEAX;
			CallResultOut.m_unECX = RawContext.m_unECX;
			CallResultOut.m_unEDX = RawContext.m_unEDX;
			CallResultOut.m_unEBX = RawContext.m_unEBX;
			CallResultOut.m_unESP = static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(RawContext.m_Stack.GetAddress()));
			CallResultOut.m_unEBP = RawContext.m_unEBP;
			CallResultOut.m_unESI = RawContext.m_unESI;
			CallResultOut.m_unEDI = RawContext.m_unEDI;
#endif

			std::memset(CallResultOut.m_arrFXState, 0, sizeof(CallResultOut.m_arrFXState));
			std::memcpy(CallResultOut.m_arrFXState + kFXStateControlWordOffset, &RawContext.m_FPU.m_unControlWord, sizeof(RawContext.m_FPU.m_unControlWord));
			std::memcpy(CallResultOut.m_arrFXState + kFXStateStatusWordOffset, &RawContext.m_FPU.m_unStatusWord, sizeof(RawContext.m_FPU.m_unStatusWord));
			std::memcpy(CallResultOut.m_arrFXState + kFXStateFPUOperationCodeOffset, &RawContext.m_FPU.m_unOP, sizeof(RawContext.m_FPU.m_unOP));
			std::memcpy(CallResultOut.m_arrFXState + kFXStateFPUInstructionAddressOffset, &RawContext.m_FPU.m_unIP, sizeof(RawContext.m_FPU.m_unIP));
			std::memcpy(CallResultOut.m_arrFXState + kFXStateFPUCodeSegmentOffset, &RawContext.m_FPU.m_unCS, sizeof(RawContext.m_FPU.m_unCS));
			std::memcpy(CallResultOut.m_arrFXState + kFXStateFPUDataAddressOffset, &RawContext.m_FPU.m_unDP, sizeof(RawContext.m_FPU.m_unDP));
			std::memcpy(CallResultOut.m_arrFXState + kFXStateFPUDataSegmentOffset, &RawContext.m_FPU.m_unDS, sizeof(RawContext.m_FPU.m_unDS));
			std::memcpy(CallResultOut.m_arrFXState + kFXStateMXCSROffset, &RawContext.m_unMXCSR, sizeof(RawContext.m_unMXCSR));

			unsigned char unAbridgedFPUTagWord = 0;
			for (std::size_t unFPURegisterIndex = 0; unFPURegisterIndex < kFPURegisterCount; ++unFPURegisterIndex) {
				const unsigned short unFPUTag = static_cast<unsigned short>((RawContext.m_FPU.m_unTagWord >> (unFPURegisterIndex * kFPUTagBitCount)) & kEmptyFPUTag);
				if (unFPUTag != kEmptyFPUTag) {
					unAbridgedFPUTagWord |= static_cast<unsigned char>(std::uint16_t(1) << unFPURegisterIndex);
				}

				unsigned char* const pchRegisterBytes = CallResultOut.m_arrFXState + kFXStateRegisterOffset + unFPURegisterIndex * kFXStateRegisterSize;
				std::memcpy(pchRegisterBytes, RawContext.m_FPU.m_Registers[unFPURegisterIndex].m_unRAW, kFXStateRegisterValueSize);
			}

			CallResultOut.m_arrFXState[kFXStateTagWordOffset] = unAbridgedFPUTagWord;

			Detours::Hook::RAW_CONTEXT_M512 const* const arrSIMDRegisters[kXMMRegisterCount] = {
				&RawContext.m_ZMM0, &RawContext.m_ZMM1, &RawContext.m_ZMM2, &RawContext.m_ZMM3,
				&RawContext.m_ZMM4, &RawContext.m_ZMM5, &RawContext.m_ZMM6, &RawContext.m_ZMM7,
#if defined(DETOURS_ARCH_X64)
				&RawContext.m_ZMM8, &RawContext.m_ZMM9, &RawContext.m_ZMM10, &RawContext.m_ZMM11,
				&RawContext.m_ZMM12, &RawContext.m_ZMM13, &RawContext.m_ZMM14, &RawContext.m_ZMM15,
#endif
			};
			for (std::size_t unXMMRegisterIndex = 0; unXMMRegisterIndex < kXMMRegisterCount; ++unXMMRegisterIndex) {
				unsigned char* const pchFXStateRegisterBytes = CallResultOut.m_arrFXState + kFXStateXMMOffset + unXMMRegisterIndex * kFXStateXMMSize;
				std::memcpy(pchFXStateRegisterBytes, arrSIMDRegisters[unXMMRegisterIndex], kFXStateXMMSize);
			}
		}

		void AddTypedHookObjectCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments, const HOOK_TYPE HookType) {
			constexpr int kMinimumArgumentCount = 1;
			constexpr int kCallbackArgumentIndex = 0;

			if (Arguments.Data().IsEmpty() || !Arguments.Data()->IsInt32() || (Arguments.Length() < kMinimumArgumentCount) || !Arguments[kCallbackArgumentIndex]->IsFunction()) {
				Arguments.GetReturnValue().Set(false);
				return;
			}

			const int nHookID = Arguments.Data().As<v8::Int32>()->Value();
			Arguments.GetReturnValue().Set(g_Application.GetMemoryHookManager().AddCallback(nHookID, HookType, v8::Local<v8::Function>::Cast(Arguments[kCallbackArgumentIndex])));
		}

		void AddHookObjectPreCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			constexpr char kCallbackFailureMessage[] = "memory hook Pre(Callback) failed.";

			auto* const pIsolate = Arguments.GetIsolate();
			RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments] {
				AddTypedHookObjectCallback(Arguments, HOOKTYPE_PRE);
			});
		}

		void AddHookObjectPostCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			constexpr char kCallbackFailureMessage[] = "memory hook Post(Callback) failed.";

			auto* const pIsolate = Arguments.GetIsolate();
			RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments] {
				AddTypedHookObjectCallback(Arguments, HOOKTYPE_POST);
			});
		}

		void RemoveTypedHookObjectCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments, const HOOK_TYPE HookType) {
			constexpr int kMinimumArgumentCount = 1;
			constexpr int kCallbackArgumentIndex = 0;

			if (Arguments.Data().IsEmpty() || !Arguments.Data()->IsInt32() || (Arguments.Length() < kMinimumArgumentCount) || !Arguments[kCallbackArgumentIndex]->IsFunction()) {
				Arguments.GetReturnValue().Set(false);
				return;
			}

			const int nHookID = Arguments.Data().As<v8::Int32>()->Value();
			Arguments.GetReturnValue().Set(g_Application.GetMemoryHookManager().RemoveCallback(nHookID, HookType, v8::Local<v8::Function>::Cast(Arguments[kCallbackArgumentIndex])));
		}

		void RemoveHookObjectPreCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			constexpr char kCallbackFailureMessage[] = "memory hook RemovePre(Callback) failed.";

			auto* const pIsolate = Arguments.GetIsolate();
			RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments] {
				RemoveTypedHookObjectCallback(Arguments, HOOKTYPE_PRE);
			});
		}

		void RemoveHookObjectPostCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			constexpr char kCallbackFailureMessage[] = "memory hook RemovePost(Callback) failed.";

			auto* const pIsolate = Arguments.GetIsolate();
			RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments] {
				RemoveTypedHookObjectCallback(Arguments, HOOKTYPE_POST);
			});
		}

		void RemoveHookObjectCallback(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			constexpr char kCallbackFailureMessage[] = "memory hook Remove() failed.";

			auto* const pIsolate = Arguments.GetIsolate();
			RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments] {
				if (Arguments.Data().IsEmpty() || !Arguments.Data()->IsInt32()) {
					Arguments.GetReturnValue().Set(false);
					return;
				}

				const int nHookID = Arguments.Data().As<v8::Int32>()->Value();
				Arguments.GetReturnValue().Set(g_Application.GetMemoryHookManager().Remove(nHookID));
			});
		}
	} // namespace

	// ----------------------------------------------------------------
	// MemoryHookManager
	// ----------------------------------------------------------------

	namespace {

		bool DoesMemoryHookContextMatch(v8::Isolate* const pIsolate, v8::Global<v8::Context> const& GlobalContext, v8::Local<v8::Context> const LocalContext) noexcept {
			return !GlobalContext.IsEmpty() && (GlobalContext.Get(pIsolate) == LocalContext);
		}

		void AddMemoryHookOwner(v8::Isolate* const pIsolate, MemoryHookRecord& HookRecord, v8::Local<v8::Context> const LocalContext) {
			for (std::size_t unOwnerContextIndex = 0; unOwnerContextIndex < HookRecord.m_vecOwnerContexts.size(); ++unOwnerContextIndex) {
				if (DoesMemoryHookContextMatch(pIsolate, HookRecord.m_vecOwnerContexts[unOwnerContextIndex], LocalContext)) {
					return;
				}
			}

			v8::Global<v8::Context> OwnerContext = v8::Global<v8::Context>(pIsolate, LocalContext);
			HookRecord.m_vecOwnerContexts.push_back(std::move(OwnerContext));
		}

		void ResetMemoryHookCallback(MemoryHookCallbackRecord& CallbackRecord) noexcept {
			CallbackRecord.m_Function.Reset();
			CallbackRecord.m_Context.Reset();
		}
	} // namespace

	MemoryHookManager::MemoryHookManager() {
		m_pV8Runtime = nullptr;
		m_pPostThunk = nullptr;
		m_unPostThunkSize = 0;
		m_nNextHookID = 1;
		m_bDisabled = false;
		m_bInitialized = false;
	}

	MemoryHookManager::~MemoryHookManager() noexcept {
		Shutdown();
	}

	void MemoryHookManager::Initialize(V8Runtime* const pV8Runtime) {
		if (!pV8Runtime || m_bInitialized) {
			return;
		}

		std::size_t unPostThunkSize = 0;
		void* const pPostThunk = CreatePostThunk(unPostThunkSize);
		if (!pPostThunk) {
			LogError("MemoryHookManager::Initialize failed to create the post-hook thunk.");
			return;
		}

		m_pV8Runtime = pV8Runtime;
		m_pPostThunk = pPostThunk;
		m_unPostThunkSize = unPostThunkSize;
		m_bDisabled = false;
		m_bInitialized = true;
	}

	void MemoryHookManager::Shutdown() noexcept {
		if (!m_bInitialized) {
			return;
		}

		if (!RemoveAll()) {
			return;
		}

		ReleaseThunk(m_pPostThunk, m_unPostThunkSize);

		m_pPostThunk = nullptr;
		m_unPostThunkSize = 0;

		m_pV8Runtime = nullptr;
		m_bDisabled = false;
		m_bInitialized = false;
	}

	bool MemoryHookManager::IsInitialized() const noexcept {
		return m_bInitialized;
	}

	int MemoryHookManager::CreateFunction(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions, bool* const pbRecordCreatedOut, const std::uintptr_t unDispatchAddress) {
		constexpr bool kNativeHook = false;
		constexpr unsigned int kReservedStackSize = 0;
		constexpr bool kSingleInstructionOnly = false;
		constexpr bool kWaitForHook = true;

		if (pbRecordCreatedOut) {
			*pbRecordCreatedOut = false;
		}

		if (!m_bInitialized || !pIsolate || LocalContext.IsEmpty() || LocalOptions.IsEmpty()) {
			return 0;
		}

		void* const pAddress = ReadAddress(pIsolate, LocalContext, LocalOptions, "Address");
		if (!m_bInitialized || !pAddress || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
			return 0;
		}

		std::shared_ptr<MemoryHookRecord> const pExistingRecord = FindRecord(pAddress);
		if (pExistingRecord) {
			if (pExistingRecord->m_unDispatchAddress != unDispatchAddress) {
				return 0;
			}

			AddMemoryHookOwner(pIsolate, *pExistingRecord, LocalContext);
			return pExistingRecord->m_nID;
		}

		if (m_nNextHookID <= 0) {
			return 0;
		}

		MemoryHookSignature HookSignature {};
		{
			v8::TryCatch SignatureFailure(pIsolate);
			HookSignature = BuildSignature(pIsolate, LocalContext, LocalOptions);
			if (SignatureFailure.HasCaught()) {
				SignatureFailure.ReThrow();
				return 0;
			}

			if (pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
				return 0;
			}
		}

		// Signature readers can run JavaScript that shuts down the manager or registers another hook.
		if (!m_bInitialized || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
			return 0;
		}

		std::shared_ptr<MemoryHookRecord> const pReentrantRecord = FindRecord(pAddress);
		if (pReentrantRecord) {
			if (pReentrantRecord->m_unDispatchAddress != unDispatchAddress) {
				return 0;
			}

			AddMemoryHookOwner(pIsolate, *pReentrantRecord, LocalContext);
			return pReentrantRecord->m_nID;
		}

		const int nHookID = m_nNextHookID;
		if (nHookID <= 0) {
			return 0;
		}

		std::size_t unThunkSize = 0;
		void* const pThunk = CreateThunk(nHookID, unThunkSize, unDispatchAddress);
		auto ThunkDeleter = [this, unThunkSize](void* const pThunkAddress) {
			ReleaseThunk(pThunkAddress, unThunkSize);
		};
		std::unique_ptr<void, decltype(ThunkDeleter)> pThunkOwner = std::unique_ptr<void, decltype(ThunkDeleter)>(pThunk, ThunkDeleter);
		if (!pThunk) {
			return 0;
		}

		// Destroy a failed record/RawHook before releasing its executable thunk.
		std::shared_ptr<MemoryHookRecord> const pHookRecord = std::make_shared<MemoryHookRecord>();
		pHookRecord->m_nID = nHookID;
		pHookRecord->m_pAddress = pAddress;
		pHookRecord->m_unThunkSize = unThunkSize;
		pHookRecord->m_unDispatchAddress = unDispatchAddress;
		pHookRecord->m_Signature = std::move(HookSignature);
		AddMemoryHookOwner(pIsolate, *pHookRecord, LocalContext);

		std::unique_ptr<Detours::Hook::RawHook> pHook = std::make_unique<Detours::Hook::RawHook>();
		if (!pHook->Set(pAddress)) {
			return 0;
		}

		if (!pHook->Hook(reinterpret_cast<Detours::Hook::fnRawHookCallBack>(pThunk), kNativeHook, kReservedStackSize, kSingleInstructionOnly, kWaitForHook)) {
			// Best-effort rollback: failure is reported below and RawHook's destructor retries UnHook.
			pHook->Release();
			return 0;
		}

		pHookRecord->m_pHook = std::move(pHook);
		m_vecHookRecords.push_back(pHookRecord);
		pHookRecord->m_pThunk = pThunkOwner.release();
		m_nNextHookID = (nHookID < std::numeric_limits<int>::max()) ? (nHookID + 1) : 0;

		if (pbRecordCreatedOut) {
			*pbRecordCreatedOut = true;
		}

		return pHookRecord->m_nID;
	}

	int MemoryHookManager::CreateVTable(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions, bool* const pbRecordCreatedOut) {
		if (pbRecordCreatedOut) {
			*pbRecordCreatedOut = false;
		}

		if (!m_bInitialized || !pIsolate || LocalContext.IsEmpty() || LocalOptions.IsEmpty()) {
			return 0;
		}

		void* const pAddress = ReadVTableAddress(pIsolate, LocalContext, LocalOptions);
		if (!pAddress) {
			return 0;
		}

		if (!SetValue(pIsolate, LocalContext, LocalOptions, "Address", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pAddress))))) {
			return 0;
		}

		return CreateFunction(pIsolate, LocalContext, LocalOptions, pbRecordCreatedOut);
	}

	v8::Local<v8::Value> MemoryHookManager::CallFunction(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions, bool* const pbNativeCallCompletedOut) {
#if defined(DETOURS_ARCH_X64)
		constexpr unsigned char kStackRegisterCode = 4;
#else
		constexpr unsigned char kStackRegisterOpcode = 0xBC;
#endif

		if (!pIsolate) {
			return {};
		}

		if (!m_bInitialized || LocalContext.IsEmpty() || LocalOptions.IsEmpty()) {
			return v8::Null(pIsolate);
		}

		NativeCallRequest CallRequest {};
		CallRequest.m_pAddress = ReadAddress(pIsolate, LocalContext, LocalOptions, "Address");
		if (!CallRequest.m_pAddress) {
			return v8::Null(pIsolate);
		}

		CallRequest.m_strConvention = "cdecl";
		CallRequest.m_bCallerCleanup = true;

		v8::Local<v8::Value> LocalConvention {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "Convention", LocalConvention)) {
			return v8::Null(pIsolate);
		}

		if (!LocalConvention->IsUndefined()) {
			std::string strConvention {};
			if (!ReadStringFromValue(pIsolate, LocalConvention, strConvention)) {
				return v8::Null(pIsolate);
			}

			CallRequest.m_strConvention = NormalizeCallingConvention(strConvention);
		}

		if ((CallRequest.m_strConvention != "cdecl") && (CallRequest.m_strConvention != "stdcall") && (CallRequest.m_strConvention != "thiscall") && (CallRequest.m_strConvention != "fastcall")) {
			ThrowError(pIsolate, "memory/hooks.CallFunction(Options) expects Options.Convention to be cdecl, stdcall, thiscall, or fastcall.");
			return v8::Null(pIsolate);
		}

		v8::Local<v8::Value> LocalReturnType {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "ReturnType", LocalReturnType)) {
			return v8::Null(pIsolate);
		}

		if (!LocalReturnType->IsUndefined()) {
			if (!ReadMemoryHookValue(pIsolate, [this, pIsolate, LocalReturnType, &CallRequest] {
				CallRequest.m_ReturnType = ReadDataType(pIsolate, LocalReturnType);

				return true;
			})) {
				return v8::Null(pIsolate);
			}
		}

		if ((CallRequest.m_strConvention == "stdcall") || (CallRequest.m_strConvention == "thiscall") || (CallRequest.m_strConvention == "fastcall")) {
			CallRequest.m_bCallerCleanup = false;
		}

		v8::Local<v8::Value> LocalCallerCleanup {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "CallerCleanup", LocalCallerCleanup)) {
			return v8::Null(pIsolate);
		}

		if (!LocalCallerCleanup->IsUndefined()) {
			CallRequest.m_bCallerCleanup = LocalCallerCleanup->BooleanValue(pIsolate);
		}

		v8::Local<v8::Value> LocalReturnContext {};
		bool bReturnContext = false;
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "ReturnContext", LocalReturnContext)) {
			return v8::Null(pIsolate);
		}

		if (!LocalReturnContext->IsUndefined()) {
			bReturnContext = LocalReturnContext->BooleanValue(pIsolate);
		}

		std::list<std::string> lstStringStorage {};
		auto AppendStringArgument = [pIsolate, &lstStringStorage, &CallRequest](v8::Local<v8::Value> const LocalValue) -> bool {
			std::string strArgument {};
			if (!ReadStringFromValue(pIsolate, LocalValue, strArgument)) {
				return false;
			}

			// List nodes keep borrowed C-string addresses stable until the call returns.
			lstStringStorage.push_back(std::move(strArgument));
			CallRequest.m_vecArguments.push_back({ reinterpret_cast<std::uintptr_t>(lstStringStorage.back().c_str()), NativeCallArgumentKind::Integer });

			return true;
		};

		v8::Local<v8::Value> LocalThisObject {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "ThisObject", LocalThisObject)) {
			return v8::Null(pIsolate);
		}

		if (!LocalThisObject->IsUndefined() && !LocalThisObject->IsNull()) {
			std::uintptr_t unAddress = 0;
			if (!ReadAddressFromValue(pIsolate, LocalThisObject, unAddress)) {
				return v8::Null(pIsolate);
			}

			CallRequest.m_vecArguments.push_back({ unAddress, NativeCallArgumentKind::Integer });
		}

		v8::Local<v8::Value> LocalArguments {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "Arguments", LocalArguments)) {
			return v8::Null(pIsolate);
		}

		if (!LocalArguments->IsUndefined() && !LocalArguments->IsArray()) {
			ThrowError(pIsolate, "memory/hooks.CallFunction(Options) expects Options.Arguments to be an array.");
			return v8::Null(pIsolate);
		}

		if (LocalArguments->IsArray()) {
			v8::Local<v8::Array> const LocalArray = LocalArguments.As<v8::Array>();
			for (std::uint32_t unArgumentIndex = 0; unArgumentIndex < LocalArray->Length(); ++unArgumentIndex) {
				v8::Local<v8::Value> LocalArgumentValue {};
				if (!LocalArray->Get(LocalContext, unArgumentIndex).ToLocal(&LocalArgumentValue)) {
					return v8::Null(pIsolate);
				}

				if (LocalArgumentValue->IsObject()) {
					v8::Local<v8::Object> const LocalArgumentObject = LocalArgumentValue.As<v8::Object>();
					v8::Local<v8::Value> LocalStringArgument {};
					if (!GetValue(pIsolate, LocalContext, LocalArgumentObject, "String", LocalStringArgument)) {
						return v8::Null(pIsolate);
					}

					if (!LocalStringArgument->IsUndefined()) {
						if (!AppendStringArgument(LocalStringArgument)) {
							return v8::Null(pIsolate);
						}

						continue;
					}

					v8::Local<v8::Value> LocalTypedArgument {};
					if (!GetValue(pIsolate, LocalContext, LocalArgumentObject, "Value", LocalTypedArgument)) {
						return v8::Null(pIsolate);
					}

					if (!LocalTypedArgument->IsUndefined()) {
						DATA_TYPE ArgumentType = DATA_TYPE_ADDRESS;
						v8::Local<v8::Value> LocalArgumentType {};
						if (!GetValue(pIsolate, LocalContext, LocalArgumentObject, "Type", LocalArgumentType)) {
							return v8::Null(pIsolate);
						}

						if (!LocalArgumentType->IsUndefined()) {
							if (!ReadMemoryHookValue(pIsolate, [this, pIsolate, LocalArgumentType, &ArgumentType] {
								ArgumentType = ReadDataType(pIsolate, LocalArgumentType);

								return true;
							})) {
								return v8::Null(pIsolate);
							}
						}

						if (ArgumentType == DATA_TYPE_VOID) {
							ThrowError(pIsolate, "memory/hooks.CallFunction(Options) does not accept void arguments.");
							return v8::Null(pIsolate);
						}

						if (ArgumentType == DATA_TYPE_STRING) {
							if (!AppendStringArgument(LocalTypedArgument)) {
								return v8::Null(pIsolate);
							}

							continue;
						}

						if (ArgumentType == DATA_TYPE_FLOAT) {
							double dblArgumentValue = 0.0;
							if (!ReadNumberFromValue(pIsolate, LocalContext, LocalTypedArgument, nullptr, dblArgumentValue)) {
								return v8::Null(pIsolate);
							}

							if (std::isfinite(dblArgumentValue) && (std::fabs(dblArgumentValue) > static_cast<double>(std::numeric_limits<float>::max()))) {
								ThrowError(pIsolate, "memory/hooks.CallFunction(Options) expects finite typed float arguments to fit a native float.");
								return v8::Null(pIsolate);
							}

							CallRequest.m_vecArguments.push_back({ ConvertFloatToArgumentWord(static_cast<float>(dblArgumentValue)), NativeCallArgumentKind::Float });
							continue;
						}

						if (ArgumentType == DATA_TYPE_DOUBLE) {
							double dblArgumentValue = 0.0;
							if (!ReadNumberFromValue(pIsolate, LocalContext, LocalTypedArgument, nullptr, dblArgumentValue)) {
								return v8::Null(pIsolate);
							}

							CallRequest.m_vecArguments.push_back({ std::bit_cast<std::uint64_t>(dblArgumentValue), NativeCallArgumentKind::Double });
							continue;
						}

						if (ArgumentType == DATA_TYPE_BOOL) {
							CallRequest.m_vecArguments.push_back({ static_cast<std::uint64_t>(LocalTypedArgument->BooleanValue(pIsolate) ? 1 : 0), NativeCallArgumentKind::Integer });
							continue;
						}

						const bool bIsSigned64 = (ArgumentType == DATA_TYPE_LONG_LONG) || ((ArgumentType == DATA_TYPE_LONG) && (sizeof(long) == sizeof(std::int64_t)));
						const bool bIsUnsigned64 = (ArgumentType == DATA_TYPE_ULONG_LONG) || ((ArgumentType == DATA_TYPE_ULONG) && (sizeof(unsigned long) == sizeof(std::uint64_t)));
						if (bIsSigned64 || bIsUnsigned64) {
							if (!LocalTypedArgument->IsBigInt()) {
								ThrowError(pIsolate, "memory/hooks.CallFunction(Options) expects typed 64-bit integer arguments to be BigInt values.");
								return v8::Null(pIsolate);
							}

							bool bLossless = false;
							std::uint64_t unIntegerBits = 0;
							if (bIsSigned64) {
								const std::int64_t nIntegerValue = LocalTypedArgument.As<v8::BigInt>()->Int64Value(&bLossless);
								if (!bLossless) {
									ThrowError(pIsolate, "memory/hooks.CallFunction(Options) expects typed signed 64-bit arguments to fit in int64.");
									return v8::Null(pIsolate);
								}

								unIntegerBits = static_cast<std::uint64_t>(nIntegerValue);

							} else {
								unIntegerBits = LocalTypedArgument.As<v8::BigInt>()->Uint64Value(&bLossless);
								if (!bLossless) {
									ThrowError(pIsolate, "memory/hooks.CallFunction(Options) expects typed unsigned 64-bit arguments to fit in uint64.");
									return v8::Null(pIsolate);
								}
							}

							CallRequest.m_vecArguments.push_back({ unIntegerBits, NativeCallArgumentKind::WideInteger });
							continue;
						}

						std::uintptr_t unArgumentWord = 0;
						if (ArgumentType == DATA_TYPE_ADDRESS) {
							if (!ReadAddressFromValue(pIsolate, LocalTypedArgument, unArgumentWord)) {
								return v8::Null(pIsolate);
							}

						} else if (!ReadIntegerWordFromValue(pIsolate, LocalTypedArgument, unArgumentWord)) {
							return v8::Null(pIsolate);
						}

						CallRequest.m_vecArguments.push_back({ unArgumentWord, NativeCallArgumentKind::Integer });
						continue;
					}
				}

				if (LocalArgumentValue->IsString()) {
					if (!AppendStringArgument(LocalArgumentValue)) {
						return v8::Null(pIsolate);
					}

					continue;
				}

				std::uintptr_t unAddress = 0;
				if (!ReadAddressFromValue(pIsolate, LocalArgumentValue, unAddress)) {
					return v8::Null(pIsolate);
				}

				CallRequest.m_vecArguments.push_back({ unAddress, NativeCallArgumentKind::Integer });
			}
		}

		v8::Local<v8::Value> LocalRegisters {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "Registers", LocalRegisters)) {
			return v8::Null(pIsolate);
		}

		if (LocalRegisters->IsObject()) {
			v8::Local<v8::Object> const LocalRegisterObject = LocalRegisters.As<v8::Object>();
			v8::Local<v8::Array> LocalRegisterNames {};
			if (!LocalRegisterObject->GetOwnPropertyNames(LocalContext).ToLocal(&LocalRegisterNames)) {
				return v8::Null(pIsolate);
			}

			for (std::uint32_t unRegisterNameIndex = 0; unRegisterNameIndex < LocalRegisterNames->Length(); ++unRegisterNameIndex) {
				v8::Local<v8::Value> LocalRegisterKey {};
				v8::Local<v8::Value> LocalRegisterValue {};
				if (!LocalRegisterNames->Get(LocalContext, unRegisterNameIndex).ToLocal(&LocalRegisterKey)) {
					return v8::Null(pIsolate);
				}

				std::string strRegisterName {};
				if (!ReadStringFromValue(pIsolate, LocalRegisterKey, strRegisterName)) {
					return v8::Null(pIsolate);
				}

				// Only GPR overrides are supported; do not read ignored snapshot fields or RSP/ESP.
#if defined(DETOURS_ARCH_X64)
				unsigned char unRegisterCode = 0;
				if (!FindX64RegisterCodeByName(strRegisterName, unRegisterCode) || (unRegisterCode == kStackRegisterCode)) {
					continue;
				}
#else
				unsigned char unRegisterOpcode = 0;
				if (!FindX86RegisterOpcodeByName(strRegisterName, unRegisterOpcode) || (unRegisterOpcode == kStackRegisterOpcode)) {
					continue;
				}
#endif

				if (!LocalRegisterObject->Get(LocalContext, LocalRegisterKey).ToLocal(&LocalRegisterValue)) {
					return v8::Null(pIsolate);
				}

				if (LocalRegisterValue->IsObject()) {
					v8::Local<v8::Object> const LocalRegisterValueObject = LocalRegisterValue.As<v8::Object>();
					v8::Local<v8::Value> LocalUnwrappedRegisterValue {};
					if (!GetValue(pIsolate, LocalContext, LocalRegisterValueObject, "Value", LocalUnwrappedRegisterValue)) {
						return v8::Null(pIsolate);
					}

					if (!LocalUnwrappedRegisterValue->IsUndefined()) {
						LocalRegisterValue = LocalUnwrappedRegisterValue;
					}
				}

				std::uintptr_t unRegisterValue = 0;
				if (!ReadIntegerWordFromValue(pIsolate, LocalRegisterValue, unRegisterValue)) {
					return v8::Null(pIsolate);
				}

				CallRequest.m_mapRegisters[strRegisterName] = unRegisterValue;
			}
		}

		// Property readers and conversions may shut down the manager or stop JavaScript.
		if (!m_bInitialized || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
			return v8::Null(pIsolate);
		}

		NATIVE_CALL_RESULT CallResult {};
		Detours::Hook::RAW_CONTEXT RawContext {};
		Detours::Hook::GetCurrentContext(&RawContext);
		if (!RawContext.m_Stack.GetAddress()) {
			return v8::Null(pIsolate);
		}

		NativeCallStackStorage CallStackStorage {};
		if (!CallStackStorage.Allocate()) {
			return v8::Null(pIsolate);
		}

		std::size_t unStackArgumentBytes = 0;
		if (!ConfigureNativeCallContext(CallRequest, CallStackStorage, RawContext, unStackArgumentBytes)) {
			return v8::Null(pIsolate);
		}

		Detours::Hook::CallAddress(CallRequest.m_pAddress, &RawContext);
		// Later cleanup/JavaScript result failures must not request another native invocation.
		if (pbNativeCallCompletedOut) {
			*pbNativeCallCompletedOut = true;
		}

#if !defined(DETOURS_ARCH_X64)
		if (CallRequest.m_bCallerCleanup && unStackArgumentBytes) {
			const std::uintptr_t unStackStorageAddress = reinterpret_cast<std::uintptr_t>(CallStackStorage.GetAddress());
			const std::uintptr_t unReturnedStackAddress = reinterpret_cast<std::uintptr_t>(RawContext.m_Stack.GetAddress());
			if (unStackStorageAddress > (std::numeric_limits<std::uintptr_t>::max() - CallStackStorage.GetSize())) {
				return v8::Null(pIsolate);
			}

			const std::uintptr_t unStackStorageEndAddress = unStackStorageAddress + CallStackStorage.GetSize();
			if ((unReturnedStackAddress < unStackStorageAddress) || (unReturnedStackAddress > unStackStorageEndAddress) || (unStackArgumentBytes > (unStackStorageEndAddress - unReturnedStackAddress))) {
				return v8::Null(pIsolate);
			}

			RawContext.m_Stack.SetAddress(reinterpret_cast<void*>(unReturnedStackAddress + unStackArgumentBytes));
		}
#endif

		CaptureNativeCallResult(RawContext, CallResult);

		v8::Local<v8::Value> LocalReturnValue = v8::Undefined(pIsolate);
		const bool bReturnIsAddress = CallRequest.m_ReturnType == DATA_TYPE_ADDRESS;
		const bool bReturnIsSigned64 = (CallRequest.m_ReturnType == DATA_TYPE_LONG_LONG) || ((CallRequest.m_ReturnType == DATA_TYPE_LONG) && (sizeof(long) == sizeof(std::int64_t)));
		const bool bReturnIsUnsigned64 = (CallRequest.m_ReturnType == DATA_TYPE_ULONG_LONG) || ((CallRequest.m_ReturnType == DATA_TYPE_ULONG) && (sizeof(unsigned long) == sizeof(std::uint64_t)));
		if (bReturnIsAddress) {
			LocalReturnValue = v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(static_cast<std::uintptr_t>(CallResult.m_unInteger)));

		} else if (bReturnIsSigned64) {
			LocalReturnValue = v8::BigInt::New(pIsolate, std::bit_cast<std::int64_t>(CallResult.m_unInteger));

		} else if (bReturnIsUnsigned64) {
			LocalReturnValue = v8::BigInt::NewFromUnsigned(pIsolate, CallResult.m_unInteger);

		} else {
			switch (CallRequest.m_ReturnType) {
				case DATA_TYPE_FLOAT:
					LocalReturnValue = v8::Number::New(pIsolate, CallResult.m_flFloat);
					break;

				case DATA_TYPE_DOUBLE:
					LocalReturnValue = v8::Number::New(pIsolate, CallResult.m_dblDouble);
					break;

				default:
					LocalReturnValue = MakeDataTypeValue(CallRequest.m_ReturnType, static_cast<std::uintptr_t>(CallResult.m_unInteger), pIsolate);
					break;
			}
		}

		if (LocalReturnValue.IsEmpty()) {
			return {};
		}

		if (!bReturnContext) {
			return LocalReturnValue;
		}

		v8::Local<v8::Object> const LocalResult = v8::Object::New(pIsolate);
		if (!SetValue(pIsolate, LocalContext, LocalResult, "ReturnValue", LocalReturnValue)) {
			return v8::Null(pIsolate);
		}

		if (!SetValue(pIsolate, LocalContext, LocalResult, "Registers", MakeNativeRegisterObject(pIsolate, LocalContext, CallResult))) {
			return v8::Null(pIsolate);
		}

		return LocalResult;
	}

	std::vector<MemoryHookCallbackRecord> MemoryHookManager::CopyCallbacks(const int nHookID, const HOOK_TYPE HookType, v8::Isolate* const pIsolate) const {
		auto itHookCallbacks = m_mapCallbacks.find(nHookID);
		if (itHookCallbacks == m_mapCallbacks.end()) {
			return {};
		}

		auto itTypeCallbacks = itHookCallbacks->second.find(HookType);
		if (itTypeCallbacks == itHookCallbacks->second.end()) {
			return {};
		}

		// Independent handles survive removal/reset of the registered callbacks.
		std::vector<MemoryHookCallbackRecord> vecCallbacks {};
		vecCallbacks.reserve(itTypeCallbacks->second.size());
		for (auto const& CallbackRecord : itTypeCallbacks->second) {
			if (CallbackRecord.m_Context.IsEmpty() || CallbackRecord.m_Function.IsEmpty()) {
				continue;
			}

			MemoryHookCallbackRecord CallbackCopy {};
			CallbackCopy.m_Context.Reset(pIsolate, CallbackRecord.m_Context.Get(pIsolate));
			CallbackCopy.m_Function.Reset(pIsolate, CallbackRecord.m_Function.Get(pIsolate));
			vecCallbacks.push_back(std::move(CallbackCopy));
		}

		return vecCallbacks;
	}

	bool MemoryHookManager::AddCallback(const int nHookID, const HOOK_TYPE HookType, v8::Local<v8::Function> const LocalFunction) {
		if (LocalFunction.IsEmpty() || !m_pV8Runtime) {
			return false;
		}

		if (!FindRecord(nHookID)) {
			return false;
		}

		auto* const pIsolate = m_pV8Runtime->GetIsolate();
		if (!pIsolate) {
			return false;
		}

		v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			return false;
		}

		MemoryHookCallbackRecord CallbackRecord {};
		CallbackRecord.m_Context.Reset(pIsolate, LocalContext);
		CallbackRecord.m_Function.Reset(pIsolate, LocalFunction);
		m_mapCallbacks[nHookID][HookType].push_back(std::move(CallbackRecord));

		return true;
	}

	bool MemoryHookManager::RemoveCallback(const int nHookID, const HOOK_TYPE HookType, v8::Local<v8::Function> const LocalFunction) {
		if (LocalFunction.IsEmpty() || !m_pV8Runtime) {
			return false;
		}

		if (!FindRecord(nHookID)) {
			return false;
		}

		auto* const pIsolate = m_pV8Runtime->GetIsolate();
		if (!pIsolate) {
			return false;
		}

		auto itHookCallbacks = m_mapCallbacks.find(nHookID);
		if (itHookCallbacks == m_mapCallbacks.end()) {
			return false;
		}

		auto itTypeCallbacks = itHookCallbacks->second.find(HookType);
		if (itTypeCallbacks == itHookCallbacks->second.end()) {
			return false;
		}

		v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			return false;
		}

		std::vector<MemoryHookCallbackRecord>& vecHookCallbacks = itTypeCallbacks->second;
		for (std::size_t unCallbackIndex = 0; unCallbackIndex < vecHookCallbacks.size(); ++unCallbackIndex) {
			if (!DoesMemoryHookContextMatch(pIsolate, vecHookCallbacks[unCallbackIndex].m_Context, LocalContext)) {
				continue;
			}

			v8::Local<v8::Function> const LocalStoredCallback = vecHookCallbacks[unCallbackIndex].m_Function.Get(pIsolate);
			if (!LocalStoredCallback->StrictEquals(LocalFunction)) {
				continue;
			}

			ResetMemoryHookCallback(vecHookCallbacks[unCallbackIndex]);
			vecHookCallbacks.erase(vecHookCallbacks.begin() + static_cast<std::ptrdiff_t>(unCallbackIndex));

			if (vecHookCallbacks.empty()) {
				itHookCallbacks->second.erase(itTypeCallbacks);
			}

			if (itHookCallbacks->second.empty()) {
				m_mapCallbacks.erase(itHookCallbacks);
			}

			return true;
		}

		return false;
	}

	bool MemoryHookManager::Remove(const int nHookID) {
		for (std::size_t unHookIndex = 0; unHookIndex < m_vecHookRecords.size(); ++unHookIndex) {
			std::shared_ptr<MemoryHookRecord> const pHookRecord = m_vecHookRecords[unHookIndex];
			MemoryHookRecord& HookRecord = *pHookRecord;
			if (HookRecord.m_nID != nHookID) {
				continue;
			}

			if (HookRecord.m_pHook) {
				try {
					if (!HookRecord.m_pHook->Release()) {
						return false;
					}
				} catch (...) {
					return false;
				}
			}

			ResetCallbacks(nHookID);
			ReleaseThunk(HookRecord.m_pThunk, HookRecord.m_unThunkSize);
			HookRecord.m_pThunk = nullptr;
			HookRecord.m_unThunkSize = 0;
			m_vecHookRecords.erase(m_vecHookRecords.begin() + static_cast<std::ptrdiff_t>(unHookIndex));
			return true;
		}

		return false;
	}

	void MemoryHookManager::RemoveContext(v8::Local<v8::Context> const LocalContext) {
		if (LocalContext.IsEmpty() || !m_pV8Runtime) {
			return;
		}

		auto* const pIsolate = m_pV8Runtime->GetIsolate();
		if (!pIsolate) {
			return;
		}

		for (auto itHookCallbacks = m_mapCallbacks.begin(); itHookCallbacks != m_mapCallbacks.end();) {
			for (auto itTypeCallbacks = itHookCallbacks->second.begin(); itTypeCallbacks != itHookCallbacks->second.end();) {
				std::vector<MemoryHookCallbackRecord>& vecHookCallbacks = itTypeCallbacks->second;
				std::size_t unCallbackIndex = 0;
				while (unCallbackIndex < vecHookCallbacks.size()) {
					if (!DoesMemoryHookContextMatch(pIsolate, vecHookCallbacks[unCallbackIndex].m_Context, LocalContext)) {
						++unCallbackIndex;
						continue;
					}

					ResetMemoryHookCallback(vecHookCallbacks[unCallbackIndex]);
					vecHookCallbacks.erase(vecHookCallbacks.begin() + static_cast<std::ptrdiff_t>(unCallbackIndex));
				}

				if (vecHookCallbacks.empty()) {
					itTypeCallbacks = itHookCallbacks->second.erase(itTypeCallbacks);
				} else {
					++itTypeCallbacks;
				}
			}

			if (itHookCallbacks->second.empty()) {
				itHookCallbacks = m_mapCallbacks.erase(itHookCallbacks);
			} else {
				++itHookCallbacks;
			}
		}

		std::size_t unHookIndex = 0;
		while (unHookIndex < m_vecHookRecords.size()) {
			std::shared_ptr<MemoryHookRecord> const pHookRecord = m_vecHookRecords[unHookIndex];
			MemoryHookRecord& HookRecord = *pHookRecord;
			std::size_t unOwnerIndex = 0;
			while (unOwnerIndex < HookRecord.m_vecOwnerContexts.size()) {
				if (!DoesMemoryHookContextMatch(pIsolate, HookRecord.m_vecOwnerContexts[unOwnerIndex], LocalContext)) {
					++unOwnerIndex;
					continue;
				}

				HookRecord.m_vecOwnerContexts[unOwnerIndex].Reset();
				HookRecord.m_vecOwnerContexts.erase(HookRecord.m_vecOwnerContexts.begin() + static_cast<std::ptrdiff_t>(unOwnerIndex));
			}

			if (HookRecord.m_vecOwnerContexts.empty() && !HasCallbacks(HookRecord.m_nID, HOOKTYPE_PRE) && !HasCallbacks(HookRecord.m_nID, HOOKTYPE_POST)) {
				if (!Remove(HookRecord.m_nID)) {
					++unHookIndex;
				}

				continue;
			}

			++unHookIndex;
		}
	}

	bool MemoryHookManager::RemoveAll() noexcept {
		// Pending/in-progress post hooks still need their saved return slots/thunk.
		if (!m_mapPostFrames.empty()) {
			return false;
		}

		try {
			while (!m_vecHookRecords.empty()) {
				// Keep the record and thunk if Detours cannot release the hook.
				if (!Remove(m_vecHookRecords.back()->m_nID)) {
					return false;
				}
			}

			m_mapCallbacks.clear();
			m_mapStringStorage.clear();
		} catch (...) {
			return false;
		}

		return true;
	}

	bool MemoryHookManager::HandleHook(const int nHookID, Detours::Hook::PRAW_CONTEXT const pRawContext) {
		constexpr int kCallbackArgumentCount = 1;

		if (m_bDisabled || !m_pV8Runtime || !m_pV8Runtime->IsInitialized() || !pRawContext) {
			return false;
		}

		std::shared_ptr<MemoryHookRecord> const pHookRecord = FindRecord(nHookID);
		if (!pHookRecord || !pHookRecord->m_pHook) {
			return false;
		}

		auto itHookCallbacks = m_mapCallbacks.find(nHookID);
		if (itHookCallbacks == m_mapCallbacks.end()) {
			pRawContext->m_Stack.Push(pHookRecord->m_pHook->GetTrampoline());
			return true;
		}

		auto itPreCallbacks = itHookCallbacks->second.find(HOOKTYPE_PRE);
		auto itPostCallbacks = itHookCallbacks->second.find(HOOKTYPE_POST);
		const bool bHasPreCallbacks = (itPreCallbacks != itHookCallbacks->second.end()) && !itPreCallbacks->second.empty();
		const bool bHasPostCallbacks = (itPostCallbacks != itHookCallbacks->second.end()) && !itPostCallbacks->second.empty();

		if (!bHasPreCallbacks && !bHasPostCallbacks) {
			pRawContext->m_Stack.Push(pHookRecord->m_pHook->GetTrampoline());
			return true;
		}

		if (!bHasPreCallbacks) {
			// The original trampoline remains valid when a post frame cannot be installed.
			InstallPostFrame(*pHookRecord, pRawContext);
			pRawContext->m_Stack.Push(pHookRecord->m_pHook->GetTrampoline());
			return true;
		}

		auto* const pIsolate = m_pV8Runtime->GetIsolate();
		if (!pIsolate) {
			pRawContext->m_Stack.Push(pHookRecord->m_pHook->GetTrampoline());
			return true;
		}

		const std::size_t unHookArgumentCount = pHookRecord->m_Signature.m_vecArgumentTypes.size();
		if (unHookArgumentCount > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
			pRawContext->m_Stack.Push(pHookRecord->m_pHook->GetTrampoline());
			return true;
		}

		const int nHookArgumentCount = static_cast<int>(unHookArgumentCount);
		v8::Isolate::Scope IsolateScope(pIsolate);
		v8::HandleScope HandleScope(pIsolate);
		bool bSkipOriginal = false;
		auto IsJavaScriptStopped = [pIsolate]() -> bool {
			return pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException();
		};
		if (IsJavaScriptStopped()) {
			return false;
		}

		try {
			std::vector<MemoryHookCallbackRecord> const vecPreCallbacks = CopyCallbacks(nHookID, HOOKTYPE_PRE, pIsolate);
			for (auto const& CallbackRecord : vecPreCallbacks) {
				if (IsJavaScriptStopped()) {
					return bSkipOriginal;
				}

				v8::HandleScope CallbackHandleScope(pIsolate);
				v8::Local<v8::Context> const LocalContext = CallbackRecord.m_Context.Get(pIsolate);
				v8::Context::Scope ContextScope(LocalContext);
				MemoryHookCallContext CallContext {};

				CallContext.m_pMemoryHookManager = this;
				CallContext.m_pHookRecord = pHookRecord.get();
				CallContext.m_pRawContext = pRawContext;

				v8::Local<v8::Object> const LocalContextData = CreateMemoryHookContextData(pIsolate, LocalContext);
				if (LocalContextData.IsEmpty()) {
					continue;
				}

				MemoryHookCallContextScope CallContextScope(LocalContextData, CallContext);
				v8::Local<v8::Object> const LocalPayload = v8::Object::New(pIsolate);
				v8::Local<v8::Array> LocalHookArguments = v8::Array::New(pIsolate, nHookArgumentCount);
				CallContext.m_pHookArguments = &LocalHookArguments;

				bool bArgumentsReady = true;
				for (std::size_t unArgumentIndex = 0; unArgumentIndex < unHookArgumentCount; ++unArgumentIndex) {
					const std::uint32_t unV8ArgumentIndex = static_cast<std::uint32_t>(unArgumentIndex);
					const int nArgumentIndex = static_cast<int>(unArgumentIndex);
					v8::Local<v8::Value> const LocalArgumentValue = GetArgumentValue(*pHookRecord, pRawContext, nArgumentIndex, pIsolate);
					if (LocalArgumentValue.IsEmpty() || !LocalHookArguments->Set(LocalContext, unV8ArgumentIndex, LocalArgumentValue).FromMaybe(false)) {
						bArgumentsReady = false;
						break;
					}
				}

				if (!bArgumentsReady) {
					continue;
				}

				if (!SetInteger(pIsolate, LocalContext, LocalPayload, "HookID", nHookID)) {
					continue;
				}

				if (!SetString(pIsolate, LocalContext, LocalPayload, "Type", "pre")) {
					continue;
				}

				if (!SetValue(pIsolate, LocalContext, LocalPayload, "Arguments", LocalHookArguments)) {
					continue;
				}

				// The entry stack is borrowed only for the duration of this pre-hook callback.
				if (!SetValue(pIsolate, LocalContext, LocalPayload, "StackAddress", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(GetStackSlot(pRawContext, 0)))))) {
					continue;
				}

				if (!SetValue(pIsolate, LocalContext, LocalPayload, "TrampolineAddress", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pHookRecord->m_pHook->GetTrampoline()))))) {
					continue;
				}

				if (!SetFunction(pIsolate, LocalContext, LocalPayload, "CallHookTrampoline", CallHookTrampolineCallback, LocalContextData)) {
					continue;
				}

				if (!SetFunction(pIsolate, LocalContext, LocalPayload, "SetHookReturnValue", SetHookReturnValueCallback, LocalContextData)) {
					continue;
				}

				if (!SetFunction(pIsolate, LocalContext, LocalPayload, "SetHookArgument", SetHookArgumentCallback, LocalContextData)) {
					continue;
				}

				v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalPayload };
				v8::Local<v8::Function> const LocalCallback = CallbackRecord.m_Function.Get(pIsolate);
				v8::Local<v8::Value> LocalCallbackResult {};
				const bool bCallbackCompleted = LocalCallback->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).ToLocal(&LocalCallbackResult);
				CallContextScope.Invalidate();
				bSkipOriginal = bSkipOriginal || CallContext.m_bSkipOriginal;
				if (IsJavaScriptStopped()) {
					return bSkipOriginal;
				}

				for (std::size_t unArgumentIndex = 0; unArgumentIndex < unHookArgumentCount; ++unArgumentIndex) {
					if (IsJavaScriptStopped()) {
						return bSkipOriginal;
					}

					const std::uint32_t unV8ArgumentIndex = static_cast<std::uint32_t>(unArgumentIndex);
					const int nArgumentIndex = static_cast<int>(unArgumentIndex);
					v8::Local<v8::Value> LocalArgumentValue {};
					if (!LocalHookArguments->Get(LocalContext, unV8ArgumentIndex).ToLocal(&LocalArgumentValue)) {
						continue;
					}

					if (!SetArgumentFromValue(*pHookRecord, pRawContext, nArgumentIndex, pIsolate, LocalContext, LocalArgumentValue)) {
						continue;
					}
				}

				if (IsJavaScriptStopped()) {
					return bSkipOriginal;
				}

				if (bCallbackCompleted && !LocalCallbackResult->IsUndefined() && !LocalCallbackResult->IsNull()) {
					if (SetReturnFromValue(*pHookRecord, pRawContext, pIsolate, LocalContext, LocalCallbackResult)) {
						CallContext.m_bHasReturnValue = true;
						CallContext.m_bSkipOriginal = true;
					}
				}

				bSkipOriginal = bSkipOriginal || CallContext.m_bSkipOriginal;
			}

			if (IsJavaScriptStopped()) {
				return bSkipOriginal;
			}

			if (bSkipOriginal) {
				if (bHasPostCallbacks) {
					std::vector<MemoryHookCallbackRecord> const vecPostCallbacks = CopyCallbacks(nHookID, HOOKTYPE_POST, pIsolate);
					for (auto const& CallbackRecord : vecPostCallbacks) {
						if (IsJavaScriptStopped()) {
							return true;
						}

						v8::HandleScope CallbackHandleScope(pIsolate);
						v8::Local<v8::Context> const LocalContext = CallbackRecord.m_Context.Get(pIsolate);
						v8::Context::Scope ContextScope(LocalContext);
						MemoryHookCallContext CallContext {};

						CallContext.m_pMemoryHookManager = this;
						CallContext.m_pHookRecord = pHookRecord.get();
						CallContext.m_pRawContext = pRawContext;
						CallContext.m_bSkipOriginal = true;

						v8::Local<v8::Object> const LocalContextData = CreateMemoryHookContextData(pIsolate, LocalContext);
						if (LocalContextData.IsEmpty()) {
							continue;
						}

						MemoryHookCallContextScope CallContextScope(LocalContextData, CallContext);
						v8::Local<v8::Object> const LocalPayload = v8::Object::New(pIsolate);
						v8::Local<v8::Array> const LocalHookArguments = v8::Array::New(pIsolate, nHookArgumentCount);
						bool bArgumentsReady = true;
						for (std::size_t unArgumentIndex = 0; unArgumentIndex < unHookArgumentCount; ++unArgumentIndex) {
							const std::uint32_t unV8ArgumentIndex = static_cast<std::uint32_t>(unArgumentIndex);
							const int nArgumentIndex = static_cast<int>(unArgumentIndex);
							v8::Local<v8::Value> const LocalArgumentValue = GetArgumentValue(*pHookRecord, pRawContext, nArgumentIndex, pIsolate);
							if (LocalArgumentValue.IsEmpty() || !LocalHookArguments->Set(LocalContext, unV8ArgumentIndex, LocalArgumentValue).FromMaybe(false)) {
								bArgumentsReady = false;
								break;
							}
						}

						if (!bArgumentsReady) {
							continue;
						}

						v8::Local<v8::Value> const LocalReturnValue = GetReturnValue(*pHookRecord, pRawContext, pIsolate);

						if (!SetInteger(pIsolate, LocalContext, LocalPayload, "HookID", nHookID)) {
							continue;
						}

						if (!SetString(pIsolate, LocalContext, LocalPayload, "Type", "post")) {
							continue;
						}

						if (!SetValue(pIsolate, LocalContext, LocalPayload, "Arguments", LocalHookArguments)) {
							continue;
						}

						if (!SetValue(pIsolate, LocalContext, LocalPayload, "ReturnValue", LocalReturnValue)) {
							continue;
						}

						if (!SetFunction(pIsolate, LocalContext, LocalPayload, "SetHookReturnValue", SetHookReturnValueCallback, LocalContextData)) {
							continue;
						}

						v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalPayload };
						v8::Local<v8::Function> const LocalCallback = CallbackRecord.m_Function.Get(pIsolate);
						v8::Local<v8::Value> LocalCallbackResult {};
						const bool bCallbackCompleted = LocalCallback->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).ToLocal(&LocalCallbackResult);
						CallContextScope.Invalidate();

						if (IsJavaScriptStopped()) {
							return true;
						}

						if (!bCallbackCompleted) {
							continue;
						}

						if (LocalCallbackResult->IsUndefined() || LocalCallbackResult->IsNull()) {
							continue;
						}

						if (!SetReturnFromValue(*pHookRecord, pRawContext, pIsolate, LocalContext, LocalCallbackResult)) {
							continue;
						}
					}
				}

				return true;
			}

			if (bHasPostCallbacks) {
				// The original trampoline remains valid when a post frame cannot be installed.
				InstallPostFrame(*pHookRecord, pRawContext);
			}

			pRawContext->m_Stack.Push(pHookRecord->m_pHook->GetTrampoline());

			return true;
		} catch (...) {
			LogError("Memory hook callbacks failed Hook=%d", nHookID);
			return bSkipOriginal;
		}
	}

	void* MemoryHookManager::HandlePostHook(void* const pReturnSlot, PMemoryHookPostContext const pPostContext) noexcept {
		static_assert(std::is_nothrow_move_constructible_v<MemoryHookPostFrame>, "Post-hook frames must transfer ownership without allocating.");

		if (!pReturnSlot || !pPostContext) {
			return nullptr;
		}

		auto itPostFrame = m_mapPostFrames.find(pReturnSlot);
		if (itPostFrame == m_mapPostFrames.end()) {
			return nullptr;
		}

		MemoryHookPostFrame const PostFrame = std::move(itPostFrame->second);

		// Keep the slot registered during callbacks so Shutdown cannot free this thunk.
		if (!m_bDisabled && m_pV8Runtime && m_pV8Runtime->IsInitialized()) {
			std::shared_ptr<MemoryHookRecord> const pHookRecord = FindRecord(PostFrame.m_nHookID);
			if (pHookRecord && HasCallbacks(PostFrame.m_nHookID, HOOKTYPE_POST)) {
				try {
					RunPostCallbacks(*pHookRecord, PostFrame, pPostContext);
				} catch (...) {
					LogError("Memory post-hook callbacks failed Hook=%d", PostFrame.m_nHookID);
				}
			}
		}

		m_mapPostFrames.erase(pReturnSlot);

		return PostFrame.m_pReturnAddress;
	}

	v8::Local<v8::Object> MemoryHookManager::MakeHookObject(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, const int nHookID, bool const* const pbRecordCreated) {
		if (!pIsolate || LocalContext.IsEmpty()) {
			return {};
		}

		v8::Local<v8::Object> const LocalObject = v8::Object::New(pIsolate);
		v8::Local<v8::Value> const LocalData = v8::Integer::New(pIsolate, nHookID);
		std::shared_ptr<MemoryHookRecord> const pHookRecord = FindRecord(nHookID);

		auto FailHookObjectCreation = [this, nHookID, pbRecordCreated]() -> v8::Local<v8::Object> {
			if (pbRecordCreated && *pbRecordCreated && !Remove(nHookID)) {
				LogError("MakeHookObject cleanup failed Hook=%d", nHookID);
			}

			return {};
		};

		// Own data properties prevent inherited setters from acquiring the record during result construction.
		if (!SetOwnValue(pIsolate, LocalContext, LocalObject, "ID", v8::Integer::New(pIsolate, nHookID))) {
			return FailHookObjectCreation();
		}

		if (pbRecordCreated && !SetOwnValue(pIsolate, LocalContext, LocalObject, "Created", v8::Boolean::New(pIsolate, *pbRecordCreated))) {
			return FailHookObjectCreation();
		}

		if (pHookRecord && pHookRecord->m_pHook) {
			if (!SetOwnValue(pIsolate, LocalContext, LocalObject, "Address", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pHookRecord->m_pAddress))))) {
				return FailHookObjectCreation();
			}

			if (!SetOwnValue(pIsolate, LocalContext, LocalObject, "TrampolineAddress", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pHookRecord->m_pHook->GetTrampoline()))))) {
				return FailHookObjectCreation();
			}
		}

		if (!SetOwnFunction(pIsolate, LocalContext, LocalObject, "Pre", AddHookObjectPreCallback, LocalData)) {
			return FailHookObjectCreation();
		}

		if (!SetOwnFunction(pIsolate, LocalContext, LocalObject, "Post", AddHookObjectPostCallback, LocalData)) {
			return FailHookObjectCreation();
		}

		if (!SetOwnFunction(pIsolate, LocalContext, LocalObject, "RemovePre", RemoveHookObjectPreCallback, LocalData)) {
			return FailHookObjectCreation();
		}

		if (!SetOwnFunction(pIsolate, LocalContext, LocalObject, "RemovePost", RemoveHookObjectPostCallback, LocalData)) {
			return FailHookObjectCreation();
		}

		if (!SetOwnFunction(pIsolate, LocalContext, LocalObject, "Remove", RemoveHookObjectCallback, LocalData)) {
			return FailHookObjectCreation();
		}

		return LocalObject;
	}

	v8::Local<v8::Array> MemoryHookManager::GetHooks(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) const {
		if (!pIsolate || LocalContext.IsEmpty() || (m_vecHookRecords.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))) {
			return {};
		}

		// Setting result properties can reenter JavaScript and change the live registry.
		std::vector<std::shared_ptr<MemoryHookRecord>> const vecHookRecords = m_vecHookRecords;
		v8::Local<v8::Array> const LocalHooks = v8::Array::New(pIsolate, static_cast<int>(vecHookRecords.size()));
		for (std::size_t unHookIndex = 0; unHookIndex < vecHookRecords.size(); ++unHookIndex) {
			std::shared_ptr<MemoryHookRecord> const pHookRecord = vecHookRecords[unHookIndex];
			MemoryHookRecord const& HookRecord = *pHookRecord;
			if (!HookRecord.m_pHook) {
				return {};
			}

			v8::Local<v8::Object> const LocalHook = v8::Object::New(pIsolate);
			if (!SetInteger(pIsolate, LocalContext, LocalHook, "ID", HookRecord.m_nID)) {
				return {};
			}

			if (!SetValue(pIsolate, LocalContext, LocalHook, "Address", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(HookRecord.m_pAddress))))) {
				return {};
			}

			if (!SetValue(pIsolate, LocalContext, LocalHook, "TrampolineAddress", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(HookRecord.m_pHook->GetTrampoline()))))) {
				return {};
			}

			if (!LocalHooks->Set(LocalContext, static_cast<std::uint32_t>(unHookIndex), LocalHook).FromMaybe(false)) {
				return {};
			}
		}

		return LocalHooks;
	}

	void MemoryHookManager::SetDisabled(const bool bDisabled) noexcept {
		m_bDisabled = bDisabled;
	}

	bool MemoryHookManager::IsDisabled() const noexcept {
		return m_bDisabled;
	}

	bool MemoryHookManager::SetArgumentFromValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex, v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
		if (!pRawContext || !pIsolate || LocalContext.IsEmpty() || LocalValue.IsEmpty() || (nArgumentIndex < 0) || (static_cast<std::size_t>(nArgumentIndex) >= HookRecord.m_Signature.m_vecArgumentTypes.size())) {
			return false;
		}

		const DATA_TYPE ArgumentType = HookRecord.m_Signature.m_vecArgumentTypes[static_cast<std::size_t>(nArgumentIndex)];
		if ((ArgumentType == DATA_TYPE_FLOAT) || (ArgumentType == DATA_TYPE_DOUBLE)) {
			double dblArgumentValue = 0.0;
			if (!ReadNumberFromValue(pIsolate, LocalContext, LocalValue, "memory hook Payload.SetHookArgument() expects a numeric float/double value.", dblArgumentValue)) {
				return false;
			}

			std::uint64_t unArgumentValue = 0;
			if (ArgumentType == DATA_TYPE_FLOAT) {
				if (std::isfinite(dblArgumentValue) && (std::fabs(dblArgumentValue) > static_cast<double>(std::numeric_limits<float>::max()))) {
					ThrowError(pIsolate, "memory hook Payload.SetHookArgument() expects a value within the float range.");
					return false;
				}

				const float flArgumentValue = static_cast<float>(dblArgumentValue);
				unArgumentValue = std::bit_cast<std::uint32_t>(flArgumentValue);

			} else {
				unArgumentValue = std::bit_cast<std::uint64_t>(dblArgumentValue);
			}

			WriteArgumentRaw(HookRecord, pRawContext, nArgumentIndex, unArgumentValue);

			return true;
		}

		if (ArgumentType == DATA_TYPE_STRING) {
			std::string strArgumentValue {};
			if (!ReadStringFromValue(pIsolate, LocalValue, strArgumentValue)) {
				return false;
			}

			try {
				char const* const pszStoredString = StoreString(HookRecord.m_nID, strArgumentValue);
				WriteArgumentRaw(HookRecord, pRawContext, nArgumentIndex, reinterpret_cast<std::uintptr_t>(pszStoredString));
			} catch (...) {
				ThrowError(pIsolate, "Failed to store the memory hook string argument.");
				return false;
			}

			return true;
		}

		if (ArgumentType == DATA_TYPE_BOOL) {
			WriteArgumentRaw(HookRecord, pRawContext, nArgumentIndex, LocalValue->BooleanValue(pIsolate) ? 1 : 0);
			return true;
		}

		const bool bSigned64Argument = (ArgumentType == DATA_TYPE_LONG_LONG) || ((ArgumentType == DATA_TYPE_LONG) && (sizeof(long) == sizeof(std::int64_t)));
		const bool bUnsigned64Argument = (ArgumentType == DATA_TYPE_ULONG_LONG) || ((ArgumentType == DATA_TYPE_ULONG) && (sizeof(unsigned long) == sizeof(std::uint64_t)));
		if (bSigned64Argument || bUnsigned64Argument) {
			if (!LocalValue->IsBigInt()) {
				ThrowError(pIsolate, "memory hook Payload.SetHookArgument() expects typed 64-bit integer values to be BigInt.");
				return false;
			}

			bool bLossless = false;
			std::uint64_t unArgumentValue = 0;
			if (bSigned64Argument) {
				const std::int64_t nArgumentValue = LocalValue.As<v8::BigInt>()->Int64Value(&bLossless);
				if (!bLossless) {
					ThrowError(pIsolate, "memory hook Payload.SetHookArgument() expects signed 64-bit values to fit in int64.");
					return false;
				}

				unArgumentValue = static_cast<std::uint64_t>(nArgumentValue);

			} else {
				unArgumentValue = LocalValue.As<v8::BigInt>()->Uint64Value(&bLossless);
				if (!bLossless) {
					ThrowError(pIsolate, "memory hook Payload.SetHookArgument() expects unsigned 64-bit values to fit in uint64.");
					return false;
				}
			}

			WriteArgumentRaw(HookRecord, pRawContext, nArgumentIndex, unArgumentValue);
			return true;
		}

		std::uintptr_t unArgumentValue = 0;
		if (ArgumentType == DATA_TYPE_ADDRESS) {
			if (!ReadAddressFromValue(pIsolate, LocalValue, unArgumentValue)) {
				return false;
			}

		} else if (!ReadIntegerWordFromValue(pIsolate, LocalValue, unArgumentValue)) {
			return false;
		}

		WriteArgumentRaw(HookRecord, pRawContext, nArgumentIndex, static_cast<std::uint64_t>(unArgumentValue));

		return true;
	}

	bool MemoryHookManager::SetReturnFromValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue) {
#if !defined(DETOURS_ARCH_X64)
		constexpr unsigned int kX86ReturnWordBits = 32;
#endif

		if (!pRawContext || !pIsolate || LocalContext.IsEmpty() || LocalValue.IsEmpty()) {
			return false;
		}

		switch (HookRecord.m_Signature.m_ReturnType) {
			case DATA_TYPE_VOID:
				break;

			case DATA_TYPE_BOOL:
				pRawContext->m_unEAX = LocalValue->BooleanValue(pIsolate) ? 1 : 0;
				break;

			case DATA_TYPE_FLOAT: {
				double dblReturnValue = 0.0;
				if (!ReadNumberFromValue(pIsolate, LocalContext, LocalValue, "memory hook Payload.SetHookReturnValue() expects a numeric float value.", dblReturnValue)) {
					return false;
				}

				if (std::isfinite(dblReturnValue) && (std::fabs(dblReturnValue) > static_cast<double>(std::numeric_limits<float>::max()))) {
					ThrowError(pIsolate, "memory hook Payload.SetHookReturnValue() expects a value within the float range.");
					return false;
				}

				const float flReturnValue = static_cast<float>(dblReturnValue);
#if defined(DETOURS_ARCH_X64)
				pRawContext->m_XMM0.m_f32[0] = flReturnValue;
#elif defined(DETOURS_ARCH_X86)
				if (!WriteX87ValueFromDouble(static_cast<double>(flReturnValue), &pRawContext->m_FPU)) {
					return false;
				}
#else
#error Floating return writing requires the supported x86/x64 ABI
#endif

				break;
			}

			case DATA_TYPE_DOUBLE: {
				double dblReturnValue = 0.0;
				if (!ReadNumberFromValue(pIsolate, LocalContext, LocalValue, "memory hook Payload.SetHookReturnValue() expects a numeric double value.", dblReturnValue)) {
					return false;
				}

#if defined(DETOURS_ARCH_X64)
				pRawContext->m_XMM0.m_f64[0] = dblReturnValue;
#elif defined(DETOURS_ARCH_X86)
				if (!WriteX87ValueFromDouble(dblReturnValue, &pRawContext->m_FPU)) {
					return false;
				}
#else
#error Floating return writing requires the supported x86/x64 ABI
#endif

				break;
			}

			case DATA_TYPE_STRING: {
				std::string strReturnValue {};
				if (!ReadStringFromValue(pIsolate, LocalValue, strReturnValue)) {
					return false;
				}

				char const* const pszStoredReturnValue = StoreString(HookRecord.m_nID, strReturnValue);

#if defined(DETOURS_ARCH_X64)
				pRawContext->m_unRAX = static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pszStoredReturnValue));
#else
				pRawContext->m_unEAX = static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(pszStoredReturnValue));
#endif

				break;
			}

			case DATA_TYPE_ADDRESS: {
				std::uintptr_t unReturnAddress = 0;
				if (!ReadAddressFromValue(pIsolate, LocalValue, unReturnAddress)) {
					return false;
				}

#if defined(DETOURS_ARCH_X64)
				pRawContext->m_unRAX = static_cast<std::uint64_t>(unReturnAddress);
#else
				pRawContext->m_unEAX = static_cast<std::uint32_t>(unReturnAddress);
#endif

				break;
			}

			default: {
				const bool bReturnIsSigned64 = (HookRecord.m_Signature.m_ReturnType == DATA_TYPE_LONG_LONG) || ((HookRecord.m_Signature.m_ReturnType == DATA_TYPE_LONG) && (sizeof(long) == sizeof(std::int64_t)));
				const bool bReturnIsUnsigned64 = (HookRecord.m_Signature.m_ReturnType == DATA_TYPE_ULONG_LONG) || ((HookRecord.m_Signature.m_ReturnType == DATA_TYPE_ULONG) && (sizeof(unsigned long) == sizeof(std::uint64_t)));
				if (bReturnIsSigned64 || bReturnIsUnsigned64) {
					if (!LocalValue->IsBigInt()) {
						ThrowError(pIsolate, "memory hook Payload.SetHookReturnValue() expects typed 64-bit integer values to be BigInt.");
						return false;
					}

					bool bLossless = false;
					std::uint64_t unReturnBits = 0;
					if (bReturnIsSigned64) {
						const std::int64_t nReturnValue = LocalValue.As<v8::BigInt>()->Int64Value(&bLossless);
						if (!bLossless) {
							ThrowError(pIsolate, "memory hook Payload.SetHookReturnValue() expects a signed int64 value.");
							return false;
						}

						unReturnBits = static_cast<std::uint64_t>(nReturnValue);

					} else {
						unReturnBits = LocalValue.As<v8::BigInt>()->Uint64Value(&bLossless);
						if (!bLossless) {
							ThrowError(pIsolate, "memory hook Payload.SetHookReturnValue() expects an unsigned uint64 value.");
							return false;
						}
					}

#if defined(DETOURS_ARCH_X64)
					pRawContext->m_unRAX = unReturnBits;
#else
					pRawContext->m_unEAX = static_cast<std::uint32_t>(unReturnBits);
					pRawContext->m_unEDX = static_cast<std::uint32_t>(unReturnBits >> kX86ReturnWordBits);
#endif

				} else {
					std::uintptr_t unReturnValue = 0;
					if (!ReadIntegerWordFromValue(pIsolate, LocalValue, unReturnValue)) {
						return false;
					}

#if defined(DETOURS_ARCH_X64)
					pRawContext->m_unRAX = static_cast<std::uint64_t>(unReturnValue);
#else
					pRawContext->m_unEAX = static_cast<std::uint32_t>(unReturnValue);
#endif
				}

				break;
			}
		}

		return true;
	}

	std::shared_ptr<MemoryHookRecord> MemoryHookManager::FindRecord(const int nHookID) noexcept {
		for (auto const& pHookRecord : m_vecHookRecords) {
			if (pHookRecord->m_nID == nHookID) {
				return pHookRecord;
			}
		}

		return {};
	}

	std::shared_ptr<MemoryHookRecord> MemoryHookManager::FindRecord(void const* const pAddress) noexcept {
		for (auto const& pHookRecord : m_vecHookRecords) {
			if (pHookRecord->m_pAddress == pAddress) {
				return pHookRecord;
			}
		}

		return {};
	}

	MemoryHookSignature MemoryHookManager::BuildSignature(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions) const {
		if (!pIsolate || LocalContext.IsEmpty() || LocalOptions.IsEmpty()) {
			return {};
		}

		MemoryHookSignature HookSignature {};
		if (!ReadMemoryHookValue(pIsolate, [this, pIsolate, LocalContext, LocalOptions, &HookSignature] {
			HookSignature.m_vecArgumentTypes = ReadArgumentTypes(pIsolate, LocalContext, LocalOptions);

			return true;
		})) {
			return HookSignature;
		}

		v8::Local<v8::Value> LocalConvention {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "Convention", LocalConvention)) {
			return HookSignature;
		}

		if (!LocalConvention->IsUndefined()) {
			std::string strConvention {};
			if (!ReadStringFromValue(pIsolate, LocalConvention, strConvention)) {
				return HookSignature;
			}

			strConvention = NormalizeCallingConvention(strConvention);
			if ((strConvention != "cdecl") && (strConvention != "stdcall") && (strConvention != "thiscall") && (strConvention != "fastcall")) {
				ThrowError(pIsolate, "memory hook signature expects Convention to be cdecl, stdcall, thiscall, or fastcall.");
				return HookSignature;
			}

			HookSignature.m_strConvention = std::move(strConvention);
		}

		v8::Local<v8::Value> LocalReturnType {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "ReturnType", LocalReturnType)) {
			return HookSignature;
		}

		if (!LocalReturnType->IsUndefined()) {
			HookSignature.m_ReturnType = ReadDataType(pIsolate, LocalReturnType);
		}

		return HookSignature;
	}

	void* MemoryHookManager::ReadAddress(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions, char const* const pszName) const {
		if (!pIsolate || LocalContext.IsEmpty() || LocalOptions.IsEmpty() || !pszName) {
			return nullptr;
		}

		v8::Local<v8::Value> LocalAddressValue {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, pszName, LocalAddressValue)) {
			return nullptr;
		}

		std::uintptr_t unAddressValue = 0;
		if (!ReadAddressFromValue(pIsolate, LocalAddressValue, unAddressValue)) {
			return nullptr;
		}

		return reinterpret_cast<void*>(unAddressValue);
	}

	void* MemoryHookManager::ReadVTableAddress(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions) const {
		constexpr std::size_t kAddressByteCount = sizeof(void*);
		constexpr std::uintptr_t kMaximumAddress = std::numeric_limits<std::uintptr_t>::max();
		constexpr std::uintptr_t kMaximumAddressSlotStart = kMaximumAddress - (kAddressByteCount - 1);

		if (!pIsolate || LocalContext.IsEmpty() || LocalOptions.IsEmpty()) {
			return nullptr;
		}

		v8::Local<v8::Value> LocalObjectAddress {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "ObjectAddress", LocalObjectAddress)) {
			return nullptr;
		}

		void* pObjectAddress = nullptr;
		if (!LocalObjectAddress->IsUndefined()) {
			std::uintptr_t unObjectAddress = 0;
			if (!ReadAddressFromValue(pIsolate, LocalObjectAddress, unObjectAddress)) {
				return nullptr;
			}

			pObjectAddress = reinterpret_cast<void*>(unObjectAddress);
		}

		if (!pObjectAddress) {
			v8::Local<v8::Value> LocalEntity {};
			if (!GetValue(pIsolate, LocalContext, LocalOptions, "Entity", LocalEntity)) {
				return nullptr;
			}

			if (!LocalEntity->IsUndefined()) {
				int nEntityIndex = -1;
				if (!ReadInt32FromValue(pIsolate, LocalContext, LocalEntity, "memory/hooks.CreateVTableHook(Options) expects Entity to fit an int32 index.", nEntityIndex)) {
					return nullptr;
				}

				pObjectAddress = FindBaseEntityByIndex(nEntityIndex);
			}
		}

		if (!pObjectAddress) {
			return nullptr;
		}

		if (reinterpret_cast<std::uintptr_t>(pObjectAddress) > kMaximumAddressSlotStart) {
			ThrowError(pIsolate, "memory/hooks.CreateVTableHook(Options) object address range overflows the native address width.");
			return nullptr;
		}

		// Native slots may be byte-offset/unaligned storage; do not access them through an unrelated typed lvalue.
		void* const* ppVTable = nullptr;
		std::memcpy(&ppVTable, pObjectAddress, kAddressByteCount);
		if (!ppVTable) {
			return nullptr;
		}

		auto const ReadEntry = [pIsolate, ppVTable](const std::size_t unByteOffset) -> void* {
			const std::uintptr_t unVTableAddress = reinterpret_cast<std::uintptr_t>(ppVTable);
			if (unByteOffset > (kMaximumAddress - unVTableAddress)) {
				ThrowError(pIsolate, "memory/hooks.CreateVTableHook(Options) vtable offset overflows the native address width.");
				return nullptr;
			}

			const std::uintptr_t unEntryAddress = unVTableAddress + static_cast<std::uintptr_t>(unByteOffset);
			if (unEntryAddress > kMaximumAddressSlotStart) {
				ThrowError(pIsolate, "memory/hooks.CreateVTableHook(Options) vtable entry range overflows the native address width.");
				return nullptr;
			}

			void* pFunctionAddress = nullptr;
			std::memcpy(&pFunctionAddress, reinterpret_cast<void const*>(unEntryAddress), kAddressByteCount);

			return pFunctionAddress;
		};

		v8::Local<v8::Value> LocalVTableIndex {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "Index", LocalVTableIndex)) {
			return nullptr;
		}

		if (!LocalVTableIndex->IsUndefined()) {
			int nVTableIndex = -1;
			if (!ReadInt32FromValue(pIsolate, LocalContext, LocalVTableIndex, "memory/hooks.CreateVTableHook(Options) expects Index to fit an int32 integer.", nVTableIndex)) {
				return nullptr;
			}

			if (nVTableIndex < 0) {
				return nullptr;
			}

			const std::size_t unVTableIndex = static_cast<std::size_t>(nVTableIndex);
			if (unVTableIndex > (std::numeric_limits<std::size_t>::max() / kAddressByteCount)) {
				ThrowError(pIsolate, "memory/hooks.CreateVTableHook(Options) vtable index byte offset overflows the native size width.");
				return nullptr;
			}

			return ReadEntry(unVTableIndex * kAddressByteCount);
		}

		v8::Local<v8::Value> LocalByteOffset {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "Offset", LocalByteOffset)) {
			return nullptr;
		}

		if (!LocalByteOffset->IsUndefined()) {
			int nByteOffset = -1;
			if (!ReadInt32FromValue(pIsolate, LocalContext, LocalByteOffset, "memory/hooks.CreateVTableHook(Options) expects Offset to fit an int32 integer.", nByteOffset)) {
				return nullptr;
			}

			if (nByteOffset < 0) {
				return nullptr;
			}

			return ReadEntry(static_cast<std::size_t>(nByteOffset));
		}

		return nullptr;
	}

	DATA_TYPE MemoryHookManager::ReadDataType(v8::Isolate* const pIsolate, v8::Local<v8::Value> const LocalValue) const {
		struct DataTypeNameRecord {
			char const* m_pszName;
			DATA_TYPE m_DataType;
		};

		constexpr DataTypeNameRecord kDataTypeNames[] = {
			{ "void", DATA_TYPE_VOID },
			{ "bool", DATA_TYPE_BOOL },
			{ "char", DATA_TYPE_CHAR },
			{ "uchar", DATA_TYPE_UCHAR },
			{ "short", DATA_TYPE_SHORT },
			{ "ushort", DATA_TYPE_USHORT },
			{ "int", DATA_TYPE_INT },
			{ "uint", DATA_TYPE_UINT },
			{ "long", DATA_TYPE_LONG },
			{ "ulong", DATA_TYPE_ULONG },
			{ "longlong", DATA_TYPE_LONG_LONG },
			{ "ulonglong", DATA_TYPE_ULONG_LONG },
			{ "float", DATA_TYPE_FLOAT },
			{ "double", DATA_TYPE_DOUBLE },
			{ "address", DATA_TYPE_ADDRESS },
			{ "string", DATA_TYPE_STRING },
		};

		if (!pIsolate || LocalValue.IsEmpty()) {
			return DATA_TYPE_VOID;
		}

		if (LocalValue->IsInt32()) {
			const int nDataType = LocalValue.As<v8::Int32>()->Value();
			if ((nDataType >= static_cast<int>(DATA_TYPE_VOID)) && (nDataType <= static_cast<int>(DATA_TYPE_STRING))) {
				return static_cast<DATA_TYPE>(nDataType);
			}

			ThrowError(pIsolate, "Unknown numeric memory data type.");
			return DATA_TYPE_VOID;
		}

		std::string strDataType {};
		if (!ReadStringFromValue(pIsolate, LocalValue, strDataType)) {
			return DATA_TYPE_VOID;
		}

		strDataType = ConvertStringToLowercase(strDataType);
		for (auto const& DataTypeName : kDataTypeNames) {
			if (strDataType == DataTypeName.m_pszName) {
				return DataTypeName.m_DataType;
			}
		}

		ThrowError(pIsolate, "Unknown memory data type.");
		return DATA_TYPE_VOID;
	}

	std::vector<DATA_TYPE> MemoryHookManager::ReadArgumentTypes(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions) const {
		if (!pIsolate || LocalContext.IsEmpty() || LocalOptions.IsEmpty()) {
			return {};
		}

		std::vector<DATA_TYPE> vecArgumentTypes {};
		v8::Local<v8::Value> LocalArguments {};
		if (!GetValue(pIsolate, LocalContext, LocalOptions, "Arguments", LocalArguments)) {
			return vecArgumentTypes;
		}

		if (LocalArguments->IsUndefined()) {
			return vecArgumentTypes;
		}

		if (!LocalArguments->IsArray()) {
			ThrowError(pIsolate, "memory hook signature expects Arguments to be an array.");
			return {};
		}

		v8::Local<v8::Array> const LocalArgumentTypes = LocalArguments.As<v8::Array>();
		const std::uint32_t unArgumentCount = LocalArgumentTypes->Length();
		vecArgumentTypes.reserve(unArgumentCount);

		for (std::uint32_t unArgumentIndex = 0; unArgumentIndex < unArgumentCount; ++unArgumentIndex) {
			v8::Local<v8::Value> LocalArgumentType {};
			if (!LocalArgumentTypes->Get(LocalContext, unArgumentIndex).ToLocal(&LocalArgumentType)) {
				return {};
			}

			DATA_TYPE ArgumentType = DATA_TYPE_VOID;
			if (!ReadMemoryHookValue(pIsolate, [this, pIsolate, LocalArgumentType, &ArgumentType] {
				ArgumentType = ReadDataType(pIsolate, LocalArgumentType);

				return true;
			})) {
				return {};
			}

			if (ArgumentType == DATA_TYPE_VOID) {
				ThrowError(pIsolate, "memory hook signature expects non-void argument types.");
				return {};
			}

			vecArgumentTypes.push_back(ArgumentType);
		}

		return vecArgumentTypes;
	}

	void* MemoryHookManager::CreateThunk(const int nHookID, std::size_t& unThunkSizeOut, const std::uintptr_t unDispatchAddress) const noexcept {
#if defined(DETOURS_ARCH_X86)
		constexpr std::size_t kHookIDOffset = 0x0A;
#else
		constexpr std::size_t kHookIDOffset = 0x01;
#endif

		static_assert(std::endian::native == std::endian::little, "native hook thunks require little-endian targets");
#if defined(DETOURS_ARCH_X64) && defined(_WIN32)
		constexpr std::size_t kThunkCodeSize = 17;
		constexpr std::size_t kBridgeAddressOffset = 0x07;

		static_assert((kHookIDOffset + sizeof(std::uint32_t)) <= kThunkCodeSize, "hook ID exceeds the native hook thunk");
		static_assert((kBridgeAddressOffset + sizeof(std::uintptr_t)) <= kThunkCodeSize, "bridge address exceeds the native hook thunk");

		unsigned char arrThunkCodeBytes[kThunkCodeSize] = {
			0xBA, 0, 0, 0, 0,
			0x48, 0xB8, 0, 0, 0, 0, 0, 0, 0, 0,
			0xFF, 0xE0,
		};
#elif defined(DETOURS_ARCH_X64) && defined(__linux__)
		constexpr std::size_t kThunkCodeSize = 17;
		constexpr std::size_t kBridgeAddressOffset = 0x07;

		static_assert((kHookIDOffset + sizeof(std::uint32_t)) <= kThunkCodeSize, "hook ID exceeds the native hook thunk");
		static_assert((kBridgeAddressOffset + sizeof(std::uintptr_t)) <= kThunkCodeSize, "bridge address exceeds the native hook thunk");

		unsigned char arrThunkCodeBytes[kThunkCodeSize] = {
			0xBE, 0, 0, 0, 0,
			0x48, 0xB8, 0, 0, 0, 0, 0, 0, 0, 0,
			0xFF, 0xE0,
		};
#elif defined(DETOURS_ARCH_X86) && (defined(_WIN32) || defined(__linux__))
		constexpr std::size_t kThunkCodeSize = 28;
		constexpr std::size_t kBridgeAddressOffset = 0x12;

		static_assert(sizeof(std::uintptr_t) == sizeof(std::uint32_t), "the 32-bit native hook thunk requires 32-bit addresses");
		static_assert((kHookIDOffset + sizeof(std::uint32_t)) <= kThunkCodeSize, "hook ID exceeds the native hook thunk");
		static_assert((kBridgeAddressOffset + sizeof(std::uint32_t)) <= kThunkCodeSize, "bridge address exceeds the native hook thunk");

		unsigned char arrThunkCodeBytes[kThunkCodeSize] = {
			// Preserve the caller frame while aligning the C++ bridge call to 16 bytes.
			0x55,
			0x89, 0xE5,
			0x83, 0xE4, 0xF0,
			0x83, 0xEC, 0x08,
			0x68, 0, 0, 0, 0,
			0xFF, 0x75, 0x08,
			0xB8, 0, 0, 0, 0,
			0xFF, 0xD0,
			0x89, 0xEC,
			0x5D,
			0xC3,
		};
#else
#error Native hook thunks require the supported Windows/Linux x86/x64 ABI
#endif

		if (nHookID <= 0) {
			return nullptr;
		}

#if defined(_WIN32)
		void* const pThunk = VirtualAlloc(nullptr, kThunkCodeSize, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
		if (!pThunk) {
			return nullptr;
		}
#else
		void* const pThunk = mmap(nullptr, kThunkCodeSize, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
		if (pThunk == MAP_FAILED) {
			return nullptr;
		}

		if (!pThunk) {
			if (munmap(pThunk, kThunkCodeSize) != 0) {
				const int nError = errno;
				LogError("CreateThunk cleanup failed Address=%p Size=%zu Error=0x%08X", pThunk, kThunkCodeSize, static_cast<unsigned int>(nError));
			}

			return nullptr;
		}
#endif

		const std::uint32_t unEncodedHookID = static_cast<std::uint32_t>(nHookID);
		const std::uintptr_t unBridgeAddress = unDispatchAddress ? unDispatchAddress : reinterpret_cast<std::uintptr_t>(&DispatchSourceJSRawHook);

		std::memcpy(arrThunkCodeBytes + kHookIDOffset, &unEncodedHookID, sizeof(unEncodedHookID));

#if defined(DETOURS_ARCH_X64)
		std::memcpy(arrThunkCodeBytes + kBridgeAddressOffset, &unBridgeAddress, sizeof(unBridgeAddress));
#else
		const std::uint32_t unBridgeAddress32 = static_cast<std::uint32_t>(unBridgeAddress);
		std::memcpy(arrThunkCodeBytes + kBridgeAddressOffset, &unBridgeAddress32, sizeof(unBridgeAddress32));
#endif

		std::memcpy(pThunk, arrThunkCodeBytes, kThunkCodeSize);

#if defined(_WIN32)
		if (!FlushInstructionCache(GetCurrentProcess(), pThunk, kThunkCodeSize)) {
			ReleaseThunk(pThunk, kThunkCodeSize);
			return nullptr;
		}
#else
		__builtin___clear_cache(static_cast<char*>(pThunk), static_cast<char*>(pThunk) + kThunkCodeSize);
#endif

		unThunkSizeOut = kThunkCodeSize;

		return pThunk;
	}

	void* MemoryHookManager::CreatePostThunk(std::size_t& unThunkSizeOut) const {
#if defined(DETOURS_ARCH_X64)
		constexpr unsigned char kStackFrameSize = 0x60;
		constexpr unsigned char kPrimaryIntegerReturnOffset = 0x20;
		constexpr unsigned char kSecondaryIntegerReturnOffset = 0x28;
		constexpr unsigned char kFloatingReturnOffset = 0x30;
		constexpr unsigned char kReturnSlotOffset = 0x58;

		static_assert(kFloatingReturnOffset == (kPrimaryIntegerReturnOffset + offsetof(MemoryHookPostContext, m_dblDouble)));
#elif defined(DETOURS_ARCH_X86)
		constexpr std::uint32_t kStackFrameSize = 0x90;
		constexpr unsigned char kPrimaryIntegerReturnOffset = 0x10;
		constexpr unsigned char kSecondaryIntegerReturnOffset = 0x14;
		constexpr unsigned char kFPUStateOffset = 0x18;
		constexpr std::uint32_t kReturnSlotOffset = 0x8C;
		constexpr unsigned char kBridgeStackPaddingSize = 0x08;
		constexpr unsigned char kBridgeStackAlignmentMask = 0xF0;

		static_assert(sizeof(std::uintptr_t) == sizeof(std::uint32_t), "the 32-bit post hook thunk requires 32-bit addresses");
		static_assert(kFPUStateOffset == (kPrimaryIntegerReturnOffset + offsetof(MemoryHookPostContext, m_FPU)));
#else
#error Post hook thunks require a supported x86/x64 ABI
#endif

		static_assert(kSecondaryIntegerReturnOffset == (kPrimaryIntegerReturnOffset + offsetof(MemoryHookPostContext, m_unSecondInteger)));
		static_assert((kPrimaryIntegerReturnOffset + sizeof(MemoryHookPostContext)) <= kReturnSlotOffset);
		static_assert((kReturnSlotOffset + sizeof(std::uintptr_t)) == kStackFrameSize);

		std::vector<unsigned char> vecCode {};

#if defined(DETOURS_ARCH_X64)
		// Reserve the native return context.
		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x83);
		AppendU8(vecCode, 0xEC);
		AppendU8(vecCode, kStackFrameSize);

		// Save integer and floating-point return registers.
		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0x44);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kPrimaryIntegerReturnOffset);

		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0x54);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kSecondaryIntegerReturnOffset);

		AppendU8(vecCode, 0xF2);
		AppendU8(vecCode, 0x0F);
		AppendU8(vecCode, 0x11);
		AppendU8(vecCode, 0x44);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kFloatingReturnOffset);

		// Pass the return slot and saved return context to the bridge.
#if defined(_WIN32)
		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x8D);
		AppendU8(vecCode, 0x4C);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kReturnSlotOffset);

		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x8D);
		AppendU8(vecCode, 0x54);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kPrimaryIntegerReturnOffset);
#elif defined(__linux__)
		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x8D);
		AppendU8(vecCode, 0x7C);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kReturnSlotOffset);

		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x8D);
		AppendU8(vecCode, 0x74);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kPrimaryIntegerReturnOffset);
#else
#error The x64 post hook thunk requires the Windows or Linux calling convention
#endif

		// Call the bridge and retain its continuation address.
		AppendU8(vecCode, 0x49);
		AppendU8(vecCode, 0xBB);
		AppendU64LE(vecCode, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(&DispatchSourceJSPostHook)));
		AppendU8(vecCode, 0x41);
		AppendU8(vecCode, 0xFF);
		AppendU8(vecCode, 0xD3);

		AppendU8(vecCode, 0x49);
		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0xC3);

		// Restore native return registers.
		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x8B);
		AppendU8(vecCode, 0x44);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kPrimaryIntegerReturnOffset);

		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x8B);
		AppendU8(vecCode, 0x54);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kSecondaryIntegerReturnOffset);

		AppendU8(vecCode, 0xF2);
		AppendU8(vecCode, 0x0F);
		AppendU8(vecCode, 0x10);
		AppendU8(vecCode, 0x44);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kFloatingReturnOffset);

		// Release the stack frame and jump to the continuation.
		AppendU8(vecCode, 0x48);
		AppendU8(vecCode, 0x83);
		AppendU8(vecCode, 0xC4);
		AppendU8(vecCode, kStackFrameSize);

		AppendU8(vecCode, 0x41);
		AppendU8(vecCode, 0xFF);
		AppendU8(vecCode, 0xE3);
#elif defined(DETOURS_ARCH_X86)
		// Keep a stable frame while the bridge's call stack is aligned independently.
		AppendU8(vecCode, 0x81);
		AppendU8(vecCode, 0xEC);
		AppendU32LE(vecCode, kStackFrameSize);
		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0x2C);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0xE5);

		// Initialize the integer and floating-point return context.
		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0x44);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kPrimaryIntegerReturnOffset);

		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0x54);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kSecondaryIntegerReturnOffset);

		// Save/reset the complete x87 state before C++/V8 can consume its return stack.
		AppendU8(vecCode, 0xDD);
		AppendU8(vecCode, 0x74);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kFPUStateOffset);

		// Pass the return slot and saved return context to the bridge.
		AppendU8(vecCode, 0x8D);
		AppendU8(vecCode, 0x84);
		AppendU8(vecCode, 0x24);
		AppendU32LE(vecCode, kReturnSlotOffset);

		AppendU8(vecCode, 0x8D);
		AppendU8(vecCode, 0x54);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kPrimaryIntegerReturnOffset);

		// Call the bridge and retain its continuation address.
		AppendU8(vecCode, 0x83);
		AppendU8(vecCode, 0xE4);
		AppendU8(vecCode, kBridgeStackAlignmentMask);
		AppendU8(vecCode, 0x83);
		AppendU8(vecCode, 0xEC);
		AppendU8(vecCode, kBridgeStackPaddingSize);
		AppendU8(vecCode, 0x52);
		AppendU8(vecCode, 0x50);
		AppendU8(vecCode, 0xB8);
		AppendU32LE(vecCode, static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(&DispatchSourceJSPostHook)));
		AppendU8(vecCode, 0xFF);
		AppendU8(vecCode, 0xD0);
		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0xEC);
		AppendU8(vecCode, 0x8B);
		AppendU8(vecCode, 0x2C);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, 0x89);
		AppendU8(vecCode, 0xC1);

		// Restore the updated x87 and integer return state without a narrowing conversion.
		AppendU8(vecCode, 0xDD);
		AppendU8(vecCode, 0x64);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kFPUStateOffset);
		AppendU8(vecCode, 0x8B);
		AppendU8(vecCode, 0x44);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kPrimaryIntegerReturnOffset);

		AppendU8(vecCode, 0x8B);
		AppendU8(vecCode, 0x54);
		AppendU8(vecCode, 0x24);
		AppendU8(vecCode, kSecondaryIntegerReturnOffset);

		// Release the stack frame and jump to the continuation.
		AppendU8(vecCode, 0x81);
		AppendU8(vecCode, 0xC4);
		AppendU32LE(vecCode, kStackFrameSize);
		AppendU8(vecCode, 0xFF);
		AppendU8(vecCode, 0xE1);
#else
#error Post hook thunk code requires the supported x86/x64 ABI
#endif

		const std::size_t unThunkSize = vecCode.size();
		if (!unThunkSize) {
			return nullptr;
		}

		void* const pThunk = AllocateExecutable(unThunkSize);
		if (!pThunk) {
			return nullptr;
		}

		std::memcpy(pThunk, vecCode.data(), unThunkSize);

#if defined(_WIN32)
		if (!FlushInstructionCache(GetCurrentProcess(), pThunk, unThunkSize)) {
			FreeExecutable(pThunk, unThunkSize);
			return nullptr;
		}
#elif defined(__linux__)
		__builtin___clear_cache(static_cast<char*>(pThunk), static_cast<char*>(pThunk) + unThunkSize);
#else
#error Post hook thunk cache maintenance requires Windows or Linux
#endif

		unThunkSizeOut = unThunkSize;

		return pThunk;
	}

	void MemoryHookManager::ReleaseThunk(void* const pThunk, const std::size_t unThunkSize) const noexcept {
		if (!pThunk) {
			return;
		}

#if defined(_WIN32)
		if (!VirtualFree(pThunk, 0, MEM_RELEASE)) {
			const DWORD unError = GetLastError();
			LogError("ReleaseThunk failed Address=%p Size=%zu Error=0x%08lX", pThunk, unThunkSize, static_cast<unsigned long>(unError));
		}
#elif defined(__linux__)
		if (munmap(pThunk, unThunkSize) != 0) {
			const int nError = errno;
			LogError("ReleaseThunk failed Address=%p Size=%zu Error=0x%08X", pThunk, unThunkSize, static_cast<unsigned int>(nError));
		}
#else
#error Executable thunk release requires Windows or Linux
#endif
	}

	v8::Local<v8::Value> MemoryHookManager::MakeDataTypeValue(const DATA_TYPE DataType, const std::uint64_t unDataValue, v8::Isolate* const pIsolate) const {
		static_assert((sizeof(long) == sizeof(std::int32_t)) || (sizeof(long) == sizeof(std::int64_t)), "unsupported long width");
		static_assert(sizeof(long long) == sizeof(std::int64_t), "unsupported long long width");
		static_assert(sizeof(float) == sizeof(std::uint32_t), "unsupported float width");
		static_assert(sizeof(double) == sizeof(std::uint64_t), "unsupported double width");

		if (!pIsolate) {
			return {};
		}

		switch (DataType) {
			case DATA_TYPE_VOID:
				return v8::Undefined(pIsolate);

			case DATA_TYPE_BOOL:
				// The bool ABI uses the low byte; unused register/stack bits need not be zero.
				static_assert(sizeof(bool) == sizeof(std::uint8_t));
				return v8::Boolean::New(pIsolate, static_cast<std::uint8_t>(unDataValue) != 0);

			case DATA_TYPE_CHAR: {
				const std::int8_t nCharacterValue = std::bit_cast<std::int8_t>(static_cast<std::uint8_t>(unDataValue));
				return v8::Integer::New(pIsolate, static_cast<std::int32_t>(nCharacterValue));
			}

			case DATA_TYPE_UCHAR:
				return v8::Integer::NewFromUnsigned(pIsolate, static_cast<std::uint8_t>(unDataValue));

			case DATA_TYPE_SHORT: {
				const std::int16_t nShortValue = std::bit_cast<std::int16_t>(static_cast<std::uint16_t>(unDataValue));
				return v8::Integer::New(pIsolate, static_cast<std::int32_t>(nShortValue));
			}

			case DATA_TYPE_USHORT:
				return v8::Integer::NewFromUnsigned(pIsolate, static_cast<std::uint16_t>(unDataValue));

			case DATA_TYPE_INT: {
				const std::int32_t nIntegerValue = std::bit_cast<std::int32_t>(static_cast<std::uint32_t>(unDataValue));
				return v8::Integer::New(pIsolate, nIntegerValue);
			}

			case DATA_TYPE_UINT:
				return v8::Integer::NewFromUnsigned(pIsolate, static_cast<std::uint32_t>(unDataValue));

			case DATA_TYPE_LONG:
				if constexpr (sizeof(long) == sizeof(std::int64_t)) {
					const std::int64_t nLongValue = std::bit_cast<std::int64_t>(unDataValue);
					return v8::BigInt::New(pIsolate, nLongValue);

				} else {
					const std::int32_t nLongValue = std::bit_cast<std::int32_t>(static_cast<std::uint32_t>(unDataValue));
					return v8::Integer::New(pIsolate, nLongValue);
				}

			case DATA_TYPE_ULONG:
				if constexpr (sizeof(unsigned long) == sizeof(std::uint64_t)) {
					return v8::BigInt::NewFromUnsigned(pIsolate, unDataValue);

				} else {
					return v8::Integer::NewFromUnsigned(pIsolate, static_cast<std::uint32_t>(unDataValue));
				}

			case DATA_TYPE_LONG_LONG: {
				const std::int64_t nLongLongValue = std::bit_cast<std::int64_t>(unDataValue);
				return v8::BigInt::New(pIsolate, nLongLongValue);
			}

			case DATA_TYPE_ULONG_LONG:
				return v8::BigInt::NewFromUnsigned(pIsolate, unDataValue);

			case DATA_TYPE_FLOAT: {
				const float flDataValue = std::bit_cast<float>(static_cast<std::uint32_t>(unDataValue));
				return v8::Number::New(pIsolate, flDataValue);
			}

			case DATA_TYPE_DOUBLE: {
				const double dblDataValue = std::bit_cast<double>(unDataValue);
				return v8::Number::New(pIsolate, dblDataValue);
			}

			case DATA_TYPE_ADDRESS:
				return v8::BigInt::NewFromUnsigned(pIsolate, unDataValue);

			case DATA_TYPE_STRING:
				return MakeString(pIsolate, reinterpret_cast<char const*>(unDataValue));

			default:
				return v8::Undefined(pIsolate);
		}
	}

	v8::Local<v8::Value> MemoryHookManager::GetArgumentValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex, v8::Isolate* const pIsolate) const {
		if (!pIsolate) {
			return {};
		}

		if (!pRawContext || (nArgumentIndex < 0) || (static_cast<std::size_t>(nArgumentIndex) >= HookRecord.m_Signature.m_vecArgumentTypes.size())) {
			return v8::Undefined(pIsolate);
		}

		const DATA_TYPE ArgumentType = HookRecord.m_Signature.m_vecArgumentTypes[static_cast<std::size_t>(nArgumentIndex)];
		const std::uint64_t unArgumentValue = ReadArgumentRaw(HookRecord, pRawContext, nArgumentIndex);

		return MakeDataTypeValue(ArgumentType, unArgumentValue, pIsolate);
	}

	v8::Local<v8::Value> MemoryHookManager::GetReturnValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, v8::Isolate* const pIsolate) const {
#if defined(DETOURS_ARCH_X86)
		constexpr unsigned int kX86ReturnWordBits = 32;
		constexpr double kMaximumFloatReturn = static_cast<double>(std::numeric_limits<float>::max());

		static_assert(std::numeric_limits<float>::has_infinity && std::numeric_limits<double>::has_infinity, "Native floating results require representable signed infinity.");
#endif

		if (!pIsolate) {
			return {};
		}

		if (!pRawContext) {
			return v8::Undefined(pIsolate);
		}

		const DATA_TYPE ReturnType = HookRecord.m_Signature.m_ReturnType;
		if (ReturnType == DATA_TYPE_FLOAT) {
#if defined(DETOURS_ARCH_X64)
			return v8::Number::New(pIsolate, pRawContext->m_XMM0.m_f32[0]);
#elif defined(DETOURS_ARCH_X86)
			const double dblReturnValue = ReadX87ValueAsDouble(&pRawContext->m_FPU.m_Registers[0]);
			if (std::isfinite(dblReturnValue) && (std::fabs(dblReturnValue) > kMaximumFloatReturn)) {
				return v8::Number::New(pIsolate, std::signbit(dblReturnValue) ? -std::numeric_limits<double>::infinity() : std::numeric_limits<double>::infinity());
			}

			return v8::Number::New(pIsolate, static_cast<double>(static_cast<float>(dblReturnValue)));
#else
#error Floating return reading requires the supported x86/x64 ABI
#endif
		}

		if (ReturnType == DATA_TYPE_DOUBLE) {
#if defined(DETOURS_ARCH_X64)
			return v8::Number::New(pIsolate, pRawContext->m_XMM0.m_f64[0]);
#elif defined(DETOURS_ARCH_X86)
			return v8::Number::New(pIsolate, ReadX87ValueAsDouble(&pRawContext->m_FPU.m_Registers[0]));
#else
#error Floating return reading requires the supported x86/x64 ABI
#endif
		}

#if defined(DETOURS_ARCH_X64)
		const std::uint64_t unReturnValue = static_cast<std::uint64_t>(pRawContext->m_unRAX);
#elif defined(DETOURS_ARCH_X86)
		if (ReturnType == DATA_TYPE_LONG_LONG) {
			const std::uint64_t unReturnValue = (static_cast<std::uint64_t>(pRawContext->m_unEDX) << kX86ReturnWordBits) | static_cast<std::uint64_t>(pRawContext->m_unEAX);
			const std::int64_t nReturnValue = std::bit_cast<std::int64_t>(unReturnValue);
			return v8::BigInt::New(pIsolate, nReturnValue);
		}

		if (ReturnType == DATA_TYPE_ULONG_LONG) {
			const std::uint64_t unReturnValue = (static_cast<std::uint64_t>(pRawContext->m_unEDX) << kX86ReturnWordBits) | static_cast<std::uint64_t>(pRawContext->m_unEAX);
			return v8::BigInt::NewFromUnsigned(pIsolate, unReturnValue);
		}

		const std::uint64_t unReturnValue = static_cast<std::uint64_t>(pRawContext->m_unEAX);
#else
#error Integer return reading requires the supported x86/x64 ABI
#endif

		return MakeDataTypeValue(ReturnType, unReturnValue, pIsolate);
	}

	namespace {

		enum class NativeArgumentLocationKind {
			Invalid = 0,
			GeneralRegister,
			FloatingRegister,
			Stack
		};

		struct NativeArgumentLocation {
			NativeArgumentLocationKind m_Kind;
			std::size_t m_unRegisterIndex;
			std::size_t m_unStackOffset;
		};

		NativeArgumentLocation ResolveNativeArgumentLocation(MemoryHookSignature const& Signature, const int nArgumentIndex) noexcept {
#if defined(DETOURS_ARCH_X64) && defined(_WIN32)
			constexpr std::size_t kRegisterArgumentCount = 4;
			constexpr std::size_t kStackArgumentBaseOffset = sizeof(std::uintptr_t) + (kRegisterArgumentCount * sizeof(std::uint64_t));
			constexpr std::size_t kMaximumStackArgumentIndex = (std::numeric_limits<std::size_t>::max() - kStackArgumentBaseOffset) / sizeof(std::uint64_t);
#elif defined(DETOURS_ARCH_X64) && defined(__linux__)
			constexpr std::size_t kGeneralRegisterCount = 6;
			constexpr std::size_t kFloatingRegisterCount = 8;
			constexpr std::size_t kStackSlotSize = sizeof(std::uint64_t);
#elif defined(DETOURS_ARCH_X86)
			constexpr std::size_t kFastcallRegisterCount = 2;
#endif

			NativeArgumentLocation Location {};
			if ((nArgumentIndex < 0) || (static_cast<std::size_t>(nArgumentIndex) >= Signature.m_vecArgumentTypes.size())) {
				return Location;
			}

			const std::size_t unArgumentIndex = static_cast<std::size_t>(nArgumentIndex);
#if defined(DETOURS_ARCH_X64) && defined(_WIN32)
			const DATA_TYPE ArgumentType = Signature.m_vecArgumentTypes[unArgumentIndex];
			const bool bFloatingArgument = (ArgumentType == DATA_TYPE_FLOAT) || (ArgumentType == DATA_TYPE_DOUBLE);

			if (unArgumentIndex < kRegisterArgumentCount) {
				Location.m_Kind = bFloatingArgument ? NativeArgumentLocationKind::FloatingRegister : NativeArgumentLocationKind::GeneralRegister;
				Location.m_unRegisterIndex = unArgumentIndex;
				return Location;
			}

			const std::size_t unStackArgumentIndex = unArgumentIndex - kRegisterArgumentCount;
			if (unStackArgumentIndex > kMaximumStackArgumentIndex) {
				return Location;
			}

			Location.m_Kind = NativeArgumentLocationKind::Stack;
			Location.m_unStackOffset = kStackArgumentBaseOffset + (unStackArgumentIndex * sizeof(std::uint64_t));

			return Location;
#elif defined(DETOURS_ARCH_X64) && defined(__linux__)
			std::size_t unGeneralRegisterIndex = 0;
			std::size_t unFloatingRegisterIndex = 0;
			std::size_t unStackOffset = sizeof(std::uintptr_t);

			for (std::size_t unCurrentArgumentIndex = 0; unCurrentArgumentIndex <= unArgumentIndex; ++unCurrentArgumentIndex) {
				const DATA_TYPE CurrentArgumentType = Signature.m_vecArgumentTypes[unCurrentArgumentIndex];
				const bool bCurrentArgumentIsFloating = (CurrentArgumentType == DATA_TYPE_FLOAT) || (CurrentArgumentType == DATA_TYPE_DOUBLE);
				if (bCurrentArgumentIsFloating) {
					if (unFloatingRegisterIndex < kFloatingRegisterCount) {
						if (unCurrentArgumentIndex == unArgumentIndex) {
							Location.m_Kind = NativeArgumentLocationKind::FloatingRegister;
							Location.m_unRegisterIndex = unFloatingRegisterIndex;
							return Location;
						}

						++unFloatingRegisterIndex;
						continue;
					}

				} else if (unGeneralRegisterIndex < kGeneralRegisterCount) {
					if (unCurrentArgumentIndex == unArgumentIndex) {
						Location.m_Kind = NativeArgumentLocationKind::GeneralRegister;
						Location.m_unRegisterIndex = unGeneralRegisterIndex;
						return Location;
					}

					++unGeneralRegisterIndex;
					continue;
				}

				if (unCurrentArgumentIndex == unArgumentIndex) {
					Location.m_Kind = NativeArgumentLocationKind::Stack;
					Location.m_unStackOffset = unStackOffset;
					return Location;
				}

				if (unStackOffset > (std::numeric_limits<std::size_t>::max() - kStackSlotSize)) {
					return Location;
				}

				unStackOffset += kStackSlotSize;
			}

			return Location;
#elif defined(DETOURS_ARCH_X86)
			const bool bThiscall = Signature.m_strConvention == "thiscall";
			const bool bFastcall = Signature.m_strConvention == "fastcall";
			std::size_t unStackOffset = sizeof(std::uint32_t);
			std::size_t unFastcallRegisterCount = 0;

			for (std::size_t unCurrentArgumentIndex = 0; unCurrentArgumentIndex <= unArgumentIndex; ++unCurrentArgumentIndex) {
				const DATA_TYPE CurrentArgumentType = Signature.m_vecArgumentTypes[unCurrentArgumentIndex];
				const bool bCurrentArgumentIsFloating = (CurrentArgumentType == DATA_TYPE_FLOAT) || (CurrentArgumentType == DATA_TYPE_DOUBLE);
				const bool bCurrentArgumentIsWideInteger = (CurrentArgumentType == DATA_TYPE_LONG_LONG) || (CurrentArgumentType == DATA_TYPE_ULONG_LONG);
				const bool bCurrentArgumentIsWide = (CurrentArgumentType == DATA_TYPE_DOUBLE) || bCurrentArgumentIsWideInteger;
				const std::size_t unCurrentArgumentSize = bCurrentArgumentIsWide ? sizeof(std::uint64_t) : sizeof(std::uint32_t);

#if defined(__GNUC__) && !defined(__clang__)
				// Match GCC i386's wide-integer register-window rule used by native calls.
				if (bFastcall && bCurrentArgumentIsWideInteger) {
					unFastcallRegisterCount = kFastcallRegisterCount;
				}
#endif

				if (bThiscall && (unCurrentArgumentIndex == 0)) {
					if (unCurrentArgumentIndex == unArgumentIndex) {
						Location.m_Kind = NativeArgumentLocationKind::GeneralRegister;
						Location.m_unRegisterIndex = 0;
						return Location;
					}

					continue;
				}

				if (bFastcall && !bCurrentArgumentIsFloating && (unCurrentArgumentSize == sizeof(std::uint32_t)) && (unFastcallRegisterCount < kFastcallRegisterCount)) {
					if (unCurrentArgumentIndex == unArgumentIndex) {
						Location.m_Kind = NativeArgumentLocationKind::GeneralRegister;
						Location.m_unRegisterIndex = unFastcallRegisterCount;
						return Location;
					}

					++unFastcallRegisterCount;
					continue;
				}

				if (unCurrentArgumentIndex == unArgumentIndex) {
					Location.m_Kind = NativeArgumentLocationKind::Stack;
					Location.m_unStackOffset = unStackOffset;
					return Location;
				}

				if (unStackOffset > (std::numeric_limits<std::size_t>::max() - unCurrentArgumentSize)) {
					return Location;
				}

				unStackOffset += unCurrentArgumentSize;
			}

			return Location;
#else
#error Native argument location requires a supported x86/x64 Windows/Linux ABI
#endif
		}
	} // namespace

	std::uint64_t MemoryHookManager::ReadArgumentRaw(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex) const noexcept {
#if defined(DETOURS_ARCH_X86)
		constexpr unsigned int kX86ArgumentWordBits = 32;
#endif

		if (!pRawContext || (nArgumentIndex < 0)) {
			return 0;
		}

		NativeArgumentLocation const Location = ResolveNativeArgumentLocation(HookRecord.m_Signature, nArgumentIndex);
		if (Location.m_Kind == NativeArgumentLocationKind::Invalid) {
			return 0;
		}

		const DATA_TYPE ArgumentType = HookRecord.m_Signature.m_vecArgumentTypes[static_cast<std::size_t>(nArgumentIndex)];

		if (Location.m_Kind == NativeArgumentLocationKind::GeneralRegister) {
#if defined(DETOURS_ARCH_X64) && defined(_WIN32)
			switch (Location.m_unRegisterIndex) {
				case 0:
					return pRawContext->m_unRCX;

				case 1:
					return pRawContext->m_unRDX;

				case 2:
					return pRawContext->m_unR8;

				case 3:
					return pRawContext->m_unR9;

				default:
					return 0;
			}
#elif defined(DETOURS_ARCH_X64) && defined(__linux__)
			switch (Location.m_unRegisterIndex) {
				case 0:
					return pRawContext->m_unRDI;

				case 1:
					return pRawContext->m_unRSI;

				case 2:
					return pRawContext->m_unRDX;

				case 3:
					return pRawContext->m_unRCX;

				case 4:
					return pRawContext->m_unR8;

				case 5:
					return pRawContext->m_unR9;

				default:
					return 0;
			}
#elif defined(DETOURS_ARCH_X86)
			if (Location.m_unRegisterIndex == 0) {
				return pRawContext->m_unECX;
			}

			if (Location.m_unRegisterIndex == 1) {
				return pRawContext->m_unEDX;
			}

			return 0;
#else
#error General argument register reading requires a supported ABI
#endif
		}

		if (Location.m_Kind == NativeArgumentLocationKind::FloatingRegister) {
#if defined(DETOURS_ARCH_X64)
			auto ReadFloatingRegister = [pRawContext, ArgumentType](const std::size_t unRegisterIndex) -> std::uint64_t {
				if (ArgumentType == DATA_TYPE_FLOAT) {
					switch (unRegisterIndex) {
						case 0:
							return std::bit_cast<std::uint32_t>(pRawContext->m_XMM0.m_f32[0]);

						case 1:
							return std::bit_cast<std::uint32_t>(pRawContext->m_XMM1.m_f32[0]);

						case 2:
							return std::bit_cast<std::uint32_t>(pRawContext->m_XMM2.m_f32[0]);

						case 3:
							return std::bit_cast<std::uint32_t>(pRawContext->m_XMM3.m_f32[0]);

						case 4:
							return std::bit_cast<std::uint32_t>(pRawContext->m_XMM4.m_f32[0]);

						case 5:
							return std::bit_cast<std::uint32_t>(pRawContext->m_XMM5.m_f32[0]);

						case 6:
							return std::bit_cast<std::uint32_t>(pRawContext->m_XMM6.m_f32[0]);

						case 7:
							return std::bit_cast<std::uint32_t>(pRawContext->m_XMM7.m_f32[0]);

						default:
							return 0;
					}
				}

				switch (unRegisterIndex) {
					case 0:
						return std::bit_cast<std::uint64_t>(pRawContext->m_XMM0.m_f64[0]);

					case 1:
						return std::bit_cast<std::uint64_t>(pRawContext->m_XMM1.m_f64[0]);

					case 2:
						return std::bit_cast<std::uint64_t>(pRawContext->m_XMM2.m_f64[0]);

					case 3:
						return std::bit_cast<std::uint64_t>(pRawContext->m_XMM3.m_f64[0]);

					case 4:
						return std::bit_cast<std::uint64_t>(pRawContext->m_XMM4.m_f64[0]);

					case 5:
						return std::bit_cast<std::uint64_t>(pRawContext->m_XMM5.m_f64[0]);

					case 6:
						return std::bit_cast<std::uint64_t>(pRawContext->m_XMM6.m_f64[0]);

					case 7:
						return std::bit_cast<std::uint64_t>(pRawContext->m_XMM7.m_f64[0]);

					default:
						return 0;
				}
			};
			return ReadFloatingRegister(Location.m_unRegisterIndex);
#elif defined(DETOURS_ARCH_X86)
			return 0;
#else
#error Floating argument register reading requires a supported ABI
#endif
		}

		if (Location.m_Kind != NativeArgumentLocationKind::Stack) {
			return 0;
		}

		void const* const pStackSlot = GetStackSlot(pRawContext, Location.m_unStackOffset);
		if (!pStackSlot) {
			return 0;
		}

#if defined(DETOURS_ARCH_X86)
		const bool bWideArgument = (ArgumentType == DATA_TYPE_DOUBLE) || (ArgumentType == DATA_TYPE_LONG_LONG) || (ArgumentType == DATA_TYPE_ULONG_LONG);
		if (bWideArgument) {
			if (Location.m_unStackOffset > (std::numeric_limits<std::size_t>::max() - sizeof(std::uint32_t))) {
				return 0;
			}

			void const* const pHighStackSlot = GetStackSlot(pRawContext, Location.m_unStackOffset + sizeof(std::uint32_t));
			if (!pHighStackSlot) {
				return 0;
			}

			std::uint32_t unLowValue = 0;
			std::uint32_t unHighValue = 0;
			std::memcpy(&unLowValue, pStackSlot, sizeof(unLowValue));
			std::memcpy(&unHighValue, pHighStackSlot, sizeof(unHighValue));
			return (static_cast<std::uint64_t>(unHighValue) << kX86ArgumentWordBits) | unLowValue;
		}

		std::uint32_t unStackValue = 0;
		std::memcpy(&unStackValue, pStackSlot, sizeof(unStackValue));

		return unStackValue;
#else
		std::uintptr_t unStackValue = 0;
		std::memcpy(&unStackValue, pStackSlot, sizeof(unStackValue));

		return unStackValue;
#endif
	}

	void MemoryHookManager::WriteArgumentRaw(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex, const std::uint64_t unValue) const noexcept {
#if defined(DETOURS_ARCH_X86)
		constexpr unsigned int kX86ArgumentWordBits = 32;
#endif

		if (!pRawContext || (nArgumentIndex < 0)) {
			return;
		}

		NativeArgumentLocation const Location = ResolveNativeArgumentLocation(HookRecord.m_Signature, nArgumentIndex);
		if (Location.m_Kind == NativeArgumentLocationKind::Invalid) {
			return;
		}

		const DATA_TYPE ArgumentType = HookRecord.m_Signature.m_vecArgumentTypes[static_cast<std::size_t>(nArgumentIndex)];

		if (Location.m_Kind == NativeArgumentLocationKind::GeneralRegister) {
#if defined(DETOURS_ARCH_X64) && defined(_WIN32)
			switch (Location.m_unRegisterIndex) {
				case 0:
					pRawContext->m_unRCX = unValue;
					return;

				case 1:
					pRawContext->m_unRDX = unValue;
					return;

				case 2:
					pRawContext->m_unR8 = unValue;
					return;

				case 3:
					pRawContext->m_unR9 = unValue;
					return;

				default:
					return;
			}
#elif defined(DETOURS_ARCH_X64) && defined(__linux__)
			switch (Location.m_unRegisterIndex) {
				case 0:
					pRawContext->m_unRDI = unValue;
					return;

				case 1:
					pRawContext->m_unRSI = unValue;
					return;

				case 2:
					pRawContext->m_unRDX = unValue;
					return;

				case 3:
					pRawContext->m_unRCX = unValue;
					return;

				case 4:
					pRawContext->m_unR8 = unValue;
					return;

				case 5:
					pRawContext->m_unR9 = unValue;
					return;

				default:
					return;
			}
#elif defined(DETOURS_ARCH_X86)
			if (Location.m_unRegisterIndex == 0) {
				pRawContext->m_unECX = static_cast<std::uint32_t>(unValue);
				return;
			}

			if (Location.m_unRegisterIndex == 1) {
				pRawContext->m_unEDX = static_cast<std::uint32_t>(unValue);
				return;
			}

			return;
#else
#error General argument register writing requires a supported ABI
#endif
		}

		if (Location.m_Kind == NativeArgumentLocationKind::FloatingRegister) {
#if defined(DETOURS_ARCH_X64)
			auto WriteFloatingRegister = [pRawContext, ArgumentType, unValue](const std::size_t unRegisterIndex) -> void {
				if (ArgumentType == DATA_TYPE_FLOAT) {
					const float flValue = std::bit_cast<float>(static_cast<std::uint32_t>(unValue));
					switch (unRegisterIndex) {
						case 0:
							pRawContext->m_XMM0.m_f32[0] = flValue;
							return;

						case 1:
							pRawContext->m_XMM1.m_f32[0] = flValue;
							return;

						case 2:
							pRawContext->m_XMM2.m_f32[0] = flValue;
							return;

						case 3:
							pRawContext->m_XMM3.m_f32[0] = flValue;
							return;

						case 4:
							pRawContext->m_XMM4.m_f32[0] = flValue;
							return;

						case 5:
							pRawContext->m_XMM5.m_f32[0] = flValue;
							return;

						case 6:
							pRawContext->m_XMM6.m_f32[0] = flValue;
							return;

						case 7:
							pRawContext->m_XMM7.m_f32[0] = flValue;
							return;

						default:
							return;
					}
				}

				const double dblValue = std::bit_cast<double>(unValue);
				switch (unRegisterIndex) {
					case 0:
						pRawContext->m_XMM0.m_f64[0] = dblValue;
						return;

					case 1:
						pRawContext->m_XMM1.m_f64[0] = dblValue;
						return;

					case 2:
						pRawContext->m_XMM2.m_f64[0] = dblValue;
						return;

					case 3:
						pRawContext->m_XMM3.m_f64[0] = dblValue;
						return;

					case 4:
						pRawContext->m_XMM4.m_f64[0] = dblValue;
						return;

					case 5:
						pRawContext->m_XMM5.m_f64[0] = dblValue;
						return;

					case 6:
						pRawContext->m_XMM6.m_f64[0] = dblValue;
						return;

					case 7:
						pRawContext->m_XMM7.m_f64[0] = dblValue;
						return;

					default:
						return;
				}
			};
			WriteFloatingRegister(Location.m_unRegisterIndex);
#elif !defined(DETOURS_ARCH_X86)
#error Floating argument register writing requires a supported ABI
#endif
			return;
		}

		if (Location.m_Kind != NativeArgumentLocationKind::Stack) {
			return;
		}

		void* const pStackSlot = GetStackSlot(pRawContext, Location.m_unStackOffset);
		if (!pStackSlot) {
			return;
		}

#if defined(DETOURS_ARCH_X86)
		const bool bWideArgument = (ArgumentType == DATA_TYPE_DOUBLE) || (ArgumentType == DATA_TYPE_LONG_LONG) || (ArgumentType == DATA_TYPE_ULONG_LONG);
		if (bWideArgument) {
			if (Location.m_unStackOffset > (std::numeric_limits<std::size_t>::max() - sizeof(std::uint32_t))) {
				return;
			}

			void* const pHighStackSlot = GetStackSlot(pRawContext, Location.m_unStackOffset + sizeof(std::uint32_t));
			if (!pHighStackSlot) {
				return;
			}

			const std::uint32_t unLowValue = static_cast<std::uint32_t>(unValue);
			const std::uint32_t unHighValue = static_cast<std::uint32_t>(unValue >> kX86ArgumentWordBits);
			std::memcpy(pStackSlot, &unLowValue, sizeof(unLowValue));
			std::memcpy(pHighStackSlot, &unHighValue, sizeof(unHighValue));
			return;
		}

		const std::uint32_t unStackValue = static_cast<std::uint32_t>(unValue);
		std::memcpy(pStackSlot, &unStackValue, sizeof(unStackValue));
#elif defined(DETOURS_ARCH_X64)
		const std::uintptr_t unStackValue = unValue;
		std::memcpy(pStackSlot, &unStackValue, sizeof(unStackValue));
#else
#error Stack argument writing requires a supported ABI
#endif
	}

	std::uintptr_t* MemoryHookManager::GetStackSlot(Detours::Hook::PRAW_CONTEXT const pRawContext, const std::size_t unOffset) const noexcept {
		constexpr std::uintptr_t kMaximumAddress = std::numeric_limits<std::uintptr_t>::max();

		static_assert(sizeof(std::size_t) <= sizeof(std::uintptr_t), "stack offsets must fit native addresses");

		if (!pRawContext) {
			return nullptr;
		}

		void* const pStackAddress = pRawContext->m_Stack.GetAddress();
		if (!pStackAddress) {
			return nullptr;
		}

		const std::uintptr_t unStackAddress = reinterpret_cast<std::uintptr_t>(pStackAddress);
		const std::uintptr_t unStackOffset = static_cast<std::uintptr_t>(unOffset);
		if (unStackAddress > (kMaximumAddress - unStackOffset)) {
			return nullptr;
		}

		const std::uintptr_t unSlotAddress = unStackAddress + unStackOffset;
		if (unSlotAddress > (kMaximumAddress - (sizeof(std::uintptr_t) - 1))) {
			return nullptr;
		}

		return reinterpret_cast<std::uintptr_t*>(unSlotAddress);
	}

	bool MemoryHookManager::HasCallbacks(const int nHookID, const HOOK_TYPE HookType) const noexcept {
		auto itHookCallbacks = m_mapCallbacks.find(nHookID);
		if (itHookCallbacks == m_mapCallbacks.end()) {
			return false;
		}

		auto itTypeCallbacks = itHookCallbacks->second.find(HookType);

		return (itTypeCallbacks != itHookCallbacks->second.end()) && !itTypeCallbacks->second.empty();
	}

	void MemoryHookManager::CaptureArguments(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, std::vector<std::uint64_t>& vecArgumentsOut) const {
		constexpr std::size_t kMaximumArgumentCount = static_cast<std::size_t>(std::numeric_limits<int>::max());

		const std::size_t unArgumentCount = HookRecord.m_Signature.m_vecArgumentTypes.size();
		if (!pRawContext || (unArgumentCount > kMaximumArgumentCount)) {
			return;
		}

		std::vector<std::uint64_t> vecArguments {};
		vecArguments.reserve(unArgumentCount);

		for (std::size_t unArgumentIndex = 0; unArgumentIndex < unArgumentCount; ++unArgumentIndex) {
			vecArguments.push_back(ReadArgumentRaw(HookRecord, pRawContext, static_cast<int>(unArgumentIndex)));
		}

		vecArgumentsOut = std::move(vecArguments);
	}

	bool MemoryHookManager::InstallPostFrame(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext) {
		if (!m_pPostThunk || !pRawContext) {
			return false;
		}

		void* const pReturnSlot = GetStackSlot(pRawContext, 0);
		if (!pReturnSlot) {
			return false;
		}

		std::uintptr_t unReturnAddress = 0;
		std::memcpy(&unReturnAddress, pReturnSlot, sizeof(unReturnAddress));
		if (unReturnAddress == reinterpret_cast<std::uintptr_t>(m_pPostThunk)) {
			return false;
		}

		MemoryHookPostFrame PostFrame {};
		PostFrame.m_nHookID = HookRecord.m_nID;
		PostFrame.m_pReturnSlot = pReturnSlot;
		PostFrame.m_pReturnAddress = reinterpret_cast<void*>(unReturnAddress);
		try {
			CaptureArguments(HookRecord, pRawContext, PostFrame.m_vecArguments);
			m_mapPostFrames.insert_or_assign(pReturnSlot, std::move(PostFrame));
		} catch (...) {
			return false;
		}

		const std::uintptr_t unPostThunkAddress = reinterpret_cast<std::uintptr_t>(m_pPostThunk);
		std::memcpy(pReturnSlot, &unPostThunkAddress, sizeof(unPostThunkAddress));

		return true;
	}

	void MemoryHookManager::RunPostCallbacks(MemoryHookRecord const& HookRecord, MemoryHookPostFrame const& PostFrame, PMemoryHookPostContext const pPostContext) {
		constexpr int kCallbackArgumentCount = 1;
		constexpr std::size_t kMaximumArgumentCount = static_cast<std::size_t>(std::numeric_limits<int>::max());

		if (!pPostContext || !m_pV8Runtime) {
			return;
		}

		const std::size_t unArgumentCount = PostFrame.m_vecArguments.size();
		if ((unArgumentCount != HookRecord.m_Signature.m_vecArgumentTypes.size()) || (unArgumentCount > kMaximumArgumentCount)) {
			return;
		}

		auto* const pIsolate = m_pV8Runtime->GetIsolate();
		if (!pIsolate || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
			return;
		}

		Detours::Hook::RAW_CONTEXT RawContext {};
		LoadReturnContext(*pPostContext, RawContext);

		v8::Isolate::Scope IsolateScope(pIsolate);
		v8::HandleScope HandleScope(pIsolate);

		std::vector<MemoryHookCallbackRecord> const vecPostCallbacks = CopyCallbacks(PostFrame.m_nHookID, HOOKTYPE_POST, pIsolate);
		for (auto const& CallbackRecord : vecPostCallbacks) {
			if (pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
				break;
			}

			v8::HandleScope CallbackHandleScope(pIsolate);
			v8::Local<v8::Context> const LocalContext = CallbackRecord.m_Context.Get(pIsolate);
			v8::Context::Scope ContextScope(LocalContext);
			MemoryHookCallContext CallContext {};

			CallContext.m_pMemoryHookManager = this;
			CallContext.m_pHookRecord = &HookRecord;
			CallContext.m_pRawContext = &RawContext;
			CallContext.m_bSkipOriginal = true;

			v8::Local<v8::Object> const LocalContextData = CreateMemoryHookContextData(pIsolate, LocalContext);
			if (LocalContextData.IsEmpty()) {
				continue;
			}

			MemoryHookCallContextScope CallContextScope(LocalContextData, CallContext);
			v8::Local<v8::Object> const LocalPayload = v8::Object::New(pIsolate);
			v8::Local<v8::Array> const LocalHookArguments = v8::Array::New(pIsolate, static_cast<int>(unArgumentCount));
			bool bArgumentsReady = true;
			for (std::size_t unArgumentIndex = 0; unArgumentIndex < unArgumentCount; ++unArgumentIndex) {
				const DATA_TYPE ArgumentType = HookRecord.m_Signature.m_vecArgumentTypes[unArgumentIndex];
				const std::uint32_t unV8ArgumentIndex = static_cast<std::uint32_t>(unArgumentIndex);
				v8::Local<v8::Value> const LocalArgument = MakeDataTypeValue(ArgumentType, PostFrame.m_vecArguments[unArgumentIndex], pIsolate);
				if (LocalArgument.IsEmpty() || !LocalHookArguments->Set(LocalContext, unV8ArgumentIndex, LocalArgument).FromMaybe(false)) {
					bArgumentsReady = false;
					break;
				}
			}

			if (!bArgumentsReady) {
				continue;
			}

			if (!SetInteger(pIsolate, LocalContext, LocalPayload, "HookID", PostFrame.m_nHookID)) {
				continue;
			}

			if (!SetString(pIsolate, LocalContext, LocalPayload, "Type", "post")) {
				continue;
			}

			v8::Local<v8::Value> const LocalReturnValue = GetReturnValue(HookRecord, &RawContext, pIsolate);

			if (!SetValue(pIsolate, LocalContext, LocalPayload, "Arguments", LocalHookArguments)) {
				continue;
			}

			if (!SetValue(pIsolate, LocalContext, LocalPayload, "ReturnValue", LocalReturnValue)) {
				continue;
			}

			if (!SetFunction(pIsolate, LocalContext, LocalPayload, "SetHookReturnValue", SetHookReturnValueCallback, LocalContextData)) {
				continue;
			}

			v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalPayload };
			v8::Local<v8::Function> const LocalCallback = CallbackRecord.m_Function.Get(pIsolate);
			v8::Local<v8::Value> LocalCallbackResult {};
			const bool bCallbackCompleted = LocalCallback->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).ToLocal(&LocalCallbackResult);
			CallContextScope.Invalidate();

			if (pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
				break;
			}

			if (!bCallbackCompleted) {
				continue;
			}

			if (LocalCallbackResult->IsUndefined() || LocalCallbackResult->IsNull()) {
				continue;
			}

			if (!SetReturnFromValue(HookRecord, &RawContext, pIsolate, LocalContext, LocalCallbackResult)) {
				continue;
			}
		}

		StoreReturnContext(RawContext, *pPostContext);
	}

	void MemoryHookManager::LoadReturnContext(MemoryHookPostContext const& PostContext, Detours::Hook::RAW_CONTEXT& RawContextOut) noexcept {
#if defined(DETOURS_ARCH_X64)
		RawContextOut.m_unRAX = PostContext.m_unInteger;
		RawContextOut.m_unRDX = PostContext.m_unSecondInteger;
		RawContextOut.m_XMM0.m_f64[0] = PostContext.m_dblDouble;
#elif defined(DETOURS_ARCH_X86)
		RawContextOut.m_unEAX = PostContext.m_unInteger;
		RawContextOut.m_unEDX = PostContext.m_unSecondInteger;
		RawContextOut.m_FPU = PostContext.m_FPU;
#else
#error Post-hook return context requires the supported x86/x64 ABI
#endif
	}

	void MemoryHookManager::StoreReturnContext(Detours::Hook::RAW_CONTEXT const& RawContext, MemoryHookPostContext& PostContextOut) noexcept {
#if defined(DETOURS_ARCH_X64)
		PostContextOut.m_unInteger = RawContext.m_unRAX;
		PostContextOut.m_unSecondInteger = RawContext.m_unRDX;
		PostContextOut.m_dblDouble = RawContext.m_XMM0.m_f64[0];
#elif defined(DETOURS_ARCH_X86)
		PostContextOut.m_unInteger = RawContext.m_unEAX;
		PostContextOut.m_unSecondInteger = RawContext.m_unEDX;
		PostContextOut.m_FPU = RawContext.m_FPU;
#else
#error Post-hook return context requires the supported x86/x64 ABI
#endif
	}

	char const* MemoryHookManager::StoreString(const int nHookID, std::string const& strValue) {
		std::list<std::string>& lstStrings = m_mapStringStorage[nHookID];
		lstStrings.push_back(strValue);

		return lstStrings.back().c_str();
	}

	void MemoryHookManager::ResetCallbacks(const int nHookID) noexcept {
		m_mapStringStorage.erase(nHookID);

		auto itHookCallbacks = m_mapCallbacks.find(nHookID);
		if (itHookCallbacks == m_mapCallbacks.end()) {
			return;
		}

		for (auto itTypeCallbacks = itHookCallbacks->second.begin(); itTypeCallbacks != itHookCallbacks->second.end(); ++itTypeCallbacks) {
			std::vector<MemoryHookCallbackRecord>& vecCallbacks = itTypeCallbacks->second;
			for (std::size_t unCallbackIndex = 0; unCallbackIndex < vecCallbacks.size(); ++unCallbackIndex) {
				ResetMemoryHookCallback(vecCallbacks[unCallbackIndex]);
			}
		}

		m_mapCallbacks.erase(itHookCallbacks);
	}
} // namespace SourceJS
