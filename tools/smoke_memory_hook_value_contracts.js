#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && ["--help", "-h"].includes(g_vecArguments[0])) {
	console.log("Usage: node tools/smoke_memory_hook_value_contracts.js");
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error("Usage: node tools/smoke_memory_hook_value_contracts.js");
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform) && ["ia32", "x64"].includes(process.arch), "Windows/Linux x86/x64 fixture host required");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_unCommandTimeoutMilliseconds = 600_000;
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/MemoryHookManager.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

// Negative fixtures only: each changed expression must compile and fail a native assertion.
const g_vecMutations = [
	{ Name: "CapturedFloatNarrowing", Profiles: ["Win32", "X86"], Old: "(std::fabs(dblX87Value) > kMaximumCapturedFloat)", New: "(std::fabs(dblX87Value) > (kMaximumCapturedFloat * 2.0))" },
	{ Name: "EdictLookupNoexcept", Old: "edict_t* FindEdictByIndex(const int nEntityIndex) {", New: "edict_t* FindEdictByIndex(const int nEntityIndex) noexcept {" },
	{ Name: "EntityLookupNoexcept", Old: "CBaseEntity* FindBaseEntityByIndex(const int nEntityIndex) {", New: "CBaseEntity* FindBaseEntityByIndex(const int nEntityIndex) noexcept {" },
	{ Name: "StackByteOutputFailure", Old: "if (!pchStackStorage || (unStackStorageSize <= kStackEntryOffset)) {\n\t\t\t\treturn false;", New: "if (!pchStackStorage || (unStackStorageSize <= kStackEntryOffset)) {\n\t\t\t\tunStackArgumentBytesOut = 0;\n\t\t\t\treturn false;" },
	{ Name: "NumberMaximum", Old: "(dblValue > kMaximumNumberWord)", New: "(dblValue > (kMaximumNumberWord + 1.0))" },
	{ Name: "SignedMinimum", Old: "(nValue < static_cast<std::int64_t>(std::numeric_limits<std::intptr_t>::min()))", New: "(nValue <= static_cast<std::int64_t>(std::numeric_limits<std::intptr_t>::min()))" },
	{ Name: "StringNUL", Old: "strValue.assign(*UTF8Value, static_cast<std::size_t>(UTF8Value.length()));", New: "strValue.assign(*UTF8Value);" },
	{ Name: "AddressWidth", Old: "(unAddress > static_cast<std::uint64_t>(std::numeric_limits<std::uintptr_t>::max()))", New: "(unAddress > (static_cast<std::uint64_t>(std::numeric_limits<std::uintptr_t>::max()) / 2))" },
	{ Name: "CallbackRethrow", Old: "HookFailure.ReThrow();", New: "HookFailure.HasCaught();" },
	{ Name: "ByteCopyLength", Old: "std::memcpy(pBackingStore->Data(), pchBytes, unSize);", New: "std::memcpy(pBackingStore->Data(), pchBytes, unSize - 1);" },
	{ Name: "BackingStoreFailureMode", Old: "v8::BackingStoreOnFailureMode::kReturnNull", New: "v8::BackingStoreOnFailureMode::kOutOfMemory" },
	{ Name: "MachineWordBigInt", Old: "return v8::BigInt::NewFromUnsigned(pIsolate, unValue);", New: "return v8::Integer::NewFromUnsigned(pIsolate, static_cast<std::uint32_t>(unValue));" },
	{ Name: "FPURegisterCase", Old: 'strRegisterName = "ST" +', New: 'strRegisterName = "st" +' },
	{ Name: "XMMRegisterCase", Old: 'strRegisterName = "XMM" +', New: 'strRegisterName = "xmm" +' },
	{ Name: "ControlRegisterCase", Old: 'SetRegister("MXCSR",', New: 'SetRegister("mxcsr",' },
	{ Name: "CallStackEntry", Old: "RawContextOut.m_Stack.SetAddress(pchStackStorage + kStackEntryOffset);", New: "RawContextOut.m_Stack.SetAddress(pchStackStorage);" },
	{ Name: "CallStackCopyLimit", Old: "constexpr std::size_t kMaximumStackCopySize = HOOK_RAW_CALL_MAXIMUM_STACK_SIZE / 4;", New: "constexpr std::size_t kMaximumStackCopySize = HOOK_RAW_CALL_MAXIMUM_STACK_SIZE;" },
	{ Name: "CapturedFPUTag", Old: "std::uint16_t(1) << unFPURegisterIndex", New: "std::uint16_t(1) << (7 - unFPURegisterIndex)" },
	{ Name: "CapturedXMMBytes", Old: "std::memcpy(pchFXStateRegisterBytes, arrSIMDRegisters[unXMMRegisterIndex], kFXStateXMMSize);", New: "std::memcpy(pchFXStateRegisterBytes, arrSIMDRegisters[unXMMRegisterIndex], kFXStateXMMSize - 1);" },
	{ Name: "ReaderUnwindRethrow", Old: "if (ReadFailure.HasCaught()) {\n\t\t\t\t\tReadFailure.ReThrow();\n\t\t\t\t}", New: "if (ReadFailure.HasCaught()) {\n\t\t\t\t\tReadFailure.HasCaught();\n\t\t\t\t}" },
	{ Name: "ReaderCaughtRethrow", Old: "ReadFailure.ReThrow();\n\t\t\t\treturn false;", New: "ReadFailure.HasCaught();\n\t\t\t\treturn false;" },
	{ Name: "ReaderPending", Old: "return bRead && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException();", New: "return bRead && !pIsolate->IsExecutionTerminating();" },
	{ Name: "ReaderTermination", Old: "return bRead && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException();", New: "return bRead && !pIsolate->HasPendingException();" },
	{ Name: "StringReaderCommit", Old: "strValueOut = std::move(strValue);", New: "strValueOut.clear();" },
	{ Name: "ReaderFailureDiagnostic", Old: "ThrowError(pIsolate, pszFailureMessage ? pszFailureMessage : kReadFailureMessage);", New: "ThrowError(pIsolate, pszFailureMessage ? (pszFailureMessage + 1) : (kReadFailureMessage + 1));" },
];

const g_vecCallParserGuards = [
	'if ((CallRequest.m_strConvention != "cdecl") && (CallRequest.m_strConvention != "stdcall") && (CallRequest.m_strConvention != "thiscall") && (CallRequest.m_strConvention != "fastcall"))',
	"if (!LocalArguments->IsUndefined() && !LocalArguments->IsArray())",
	"if (ArgumentType == DATA_TYPE_VOID)",
	"if (std::isfinite(dblArgumentValue) && (std::fabs(dblArgumentValue) > static_cast<double>(std::numeric_limits<float>::max())))",
	"if (ArgumentType == DATA_TYPE_FLOAT) {\n\t\t\t\t\t\t\tdouble dblArgumentValue = 0.0;\n\t\t\t\t\t\t\tif (!ReadNumberFromValue(pIsolate, LocalContext, LocalTypedArgument, nullptr, dblArgumentValue))",
	"if (ArgumentType == DATA_TYPE_DOUBLE) {\n\t\t\t\t\t\t\tdouble dblArgumentValue = 0.0;\n\t\t\t\t\t\t\tif (!ReadNumberFromValue(pIsolate, LocalContext, LocalTypedArgument, nullptr, dblArgumentValue))",
	"CallRequest.m_vecArguments.push_back({ ConvertFloatToArgumentWord(static_cast<float>(dblArgumentValue)), NativeCallArgumentKind::Float });",
	"CallRequest.m_vecArguments.push_back({ std::bit_cast<std::uint64_t>(dblArgumentValue), NativeCallArgumentKind::Double });",
	"CallRequest.m_vecArguments.push_back({ unIntegerBits, NativeCallArgumentKind::WideInteger });",
];

// Native algorithm tests with narrow V8 conversion doubles, NOT a live V8/engine test.
// Normal stack allocation/release uses the real OS; only failure reports are injected.
const g_strFixture = String.raw`
// General
#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#define SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_NOMINMAX
#endif
#include <Windows.h>
#if defined(SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_NOMINMAX)
#undef NOMINMAX
#undef SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_NOMINMAX
#endif
#if defined(SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_WIN32_LEAN_AND_MEAN)
#undef WIN32_LEAN_AND_MEAN
#undef SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_WIN32_LEAN_AND_MEAN
#endif
#else
#include <sys/mman.h>
#include <unistd.h>
#endif

// C++
#include <cerrno>
#include <cfenv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>

// STL
#include <algorithm>
#include <bit>
#include <limits>
#include <map>
#include <memory>
#include <string>
#include <type_traits>
#include <vector>

// Generated only: memory-hook value regression executable with V8 conversion doubles.
namespace v8 {
	template <typename T> class Local {
	public:
		Local() noexcept {
			m_pValue = nullptr;
		}

		explicit Local(T* const pValue) noexcept :
			m_pValue(pValue)
		{
		}

		template <typename TSource> requires std::is_convertible_v<TSource*, T*> Local(Local<TSource> const& LocalValue) noexcept :
			m_pValue(LocalValue.operator->())
		{
		}

		T* operator->() const noexcept {
			return m_pValue;
		}

		bool IsEmpty() const noexcept {
			return !m_pValue;
		}

		template <typename TTarget> Local<TTarget> As() const noexcept {
			return Local<TTarget>(static_cast<TTarget*>(m_pValue));
		}

	private:
		T* m_pValue;
	};

	template <typename T> class MaybeLocal {
	public:
		MaybeLocal() noexcept = default;
		explicit MaybeLocal(Local<T> const LocalValue) noexcept :
			m_LocalValue(LocalValue)
		{
		}

		bool ToLocal(Local<T>* const pLocalOut) const noexcept {
			if (m_LocalValue.IsEmpty()) {
				return false;
			}

			*pLocalOut = m_LocalValue;

			return true;
		}

	private:
		Local<T> m_LocalValue;
	};

	class Context {
	};

	// String derives from Value, whose conversion API returns MaybeLocal<String>.
	class String;

	class Isolate {
	public:
		Isolate() noexcept;
		void ResetErrors() noexcept;
		bool IsExecutionTerminating() const noexcept;
		bool HasPendingException() const noexcept;
		Local<Context> GetCurrentContext() const noexcept;

		std::string m_strError;
		bool m_bTerminating;
		bool m_bPendingException;
		bool m_bFrameActive;
		bool m_bCaught;
		bool m_bRethrown;
		std::size_t m_unRethrowCount;
		bool m_bFailBackingStore;
		bool m_bNullBackingData;
		bool m_bRecoverableAllocation;
		int m_nFailSetIndex;
		std::size_t m_unSetCount;
	};

	Isolate::Isolate() noexcept {
		m_bTerminating = false;
		m_bPendingException = false;
		m_bFrameActive = false;
		m_bCaught = false;
		m_bRethrown = false;
		m_unRethrowCount = 0;
		m_bFailBackingStore = false;
		m_bNullBackingData = false;
		m_bRecoverableAllocation = false;
		m_nFailSetIndex = -1;
		m_unSetCount = 0;
	}

	void Isolate::ResetErrors() noexcept {
		m_strError.clear();
		m_bTerminating = false;
		m_bPendingException = false;
		m_bFrameActive = false;
		m_bCaught = false;
		m_bRethrown = false;
		m_unRethrowCount = 0;
		m_unSetCount = 0;
	}

	bool Isolate::IsExecutionTerminating() const noexcept {
		return m_bTerminating;
	}

	bool Isolate::HasPendingException() const noexcept {
		return m_bPendingException;
	}

	// Only one active frame is modeled; this is not a substitute for real V8 nesting.
	class TryCatch {
	public:
		explicit TryCatch(Isolate* const pIsolate) noexcept;
		~TryCatch() noexcept;
		bool HasCaught() const noexcept;
		void ReThrow() noexcept;

	private:
		Isolate* m_pIsolate;
		bool m_bPreviousFrameActive;
	};

	TryCatch::TryCatch(Isolate* const pIsolate) noexcept :
		m_pIsolate(pIsolate),
		m_bPreviousFrameActive(pIsolate->m_bFrameActive)
	{
		m_pIsolate->m_bFrameActive = true;
	}

	TryCatch::~TryCatch() noexcept {
		m_pIsolate->m_bFrameActive = m_bPreviousFrameActive;

		if (m_pIsolate->m_bCaught && !m_pIsolate->m_bRethrown) {
			m_pIsolate->m_bPendingException = false;
			m_pIsolate->m_strError.clear();
		}
	}

	bool TryCatch::HasCaught() const noexcept {
		return m_pIsolate->m_bCaught;
	}

	void TryCatch::ReThrow() noexcept {
		m_pIsolate->m_bRethrown = true;
		m_pIsolate->m_bPendingException = true;
		++m_pIsolate->m_unRethrowCount;
	}

	class Value {
	public:
		virtual ~Value();
		virtual bool IsBigInt() const noexcept;
		virtual bool IsNumber() const noexcept;
		MaybeLocal<String> ToString(Local<Context> LocalContext);
	};

	Value::~Value() {
	}

	bool Value::IsBigInt() const noexcept {
		return false;
	}

	bool Value::IsNumber() const noexcept {
		return false;
	}

	class Number final : public Value {
	public:
		explicit Number(const double dblValue) noexcept;
		bool IsNumber() const noexcept override;
		double Value() const noexcept;

	private:
		double m_dblValue;
	};

	Number::Number(const double dblValue) noexcept :
		m_dblValue(dblValue)
	{
	}

	bool Number::IsNumber() const noexcept {
		return true;
	}

	double Number::Value() const noexcept {
		return m_dblValue;
	}

	class BigInt final : public Value {
	public:
		BigInt(const std::uint64_t unMagnitude, const bool bNegative, const bool bOverflow = false) noexcept;
		static Local<BigInt> NewFromUnsigned(Isolate*, const std::uint64_t unValue);
		bool IsBigInt() const noexcept override;
		std::uint64_t Uint64Value(bool* const pbLosslessOut) const noexcept;
		std::int64_t Int64Value(bool* const pbLosslessOut) const noexcept;

	private:
		std::uint64_t m_unMagnitude;
		bool m_bNegative;
		bool m_bOverflow;
	};

	BigInt::BigInt(const std::uint64_t unMagnitude, const bool bNegative, const bool bOverflow) noexcept :
		m_unMagnitude(unMagnitude),
		m_bNegative(bNegative),
		m_bOverflow(bOverflow)
	{
	}

	// Factory values remain owned until fixture exit, not by a simulated V8 collector.
	Local<BigInt> BigInt::NewFromUnsigned(Isolate*, const std::uint64_t unValue) {
		static constinit std::vector<std::unique_ptr<BigInt>> s_vecValues {};

		s_vecValues.push_back(std::make_unique<BigInt>(unValue, false));

		return Local<BigInt>(s_vecValues.back().get());
	}

	bool BigInt::IsBigInt() const noexcept {
		return true;
	}

	std::uint64_t BigInt::Uint64Value(bool* const pbLosslessOut) const noexcept {
		*pbLosslessOut = !m_bOverflow && !m_bNegative;

		return m_bNegative ? (std::uint64_t(0) - m_unMagnitude) : m_unMagnitude;
	}

	std::int64_t BigInt::Int64Value(bool* const pbLosslessOut) const noexcept {
		constexpr std::uint64_t kSignBit = std::uint64_t(1) << 63;

		*pbLosslessOut = !m_bOverflow && (m_bNegative ? m_unMagnitude <= kSignBit : m_unMagnitude < kSignBit);
		if (!*pbLosslessOut) {
			return 0;
		}

		if (m_bNegative && (m_unMagnitude == kSignBit)) {
			return std::numeric_limits<std::int64_t>::min();
		}

		return m_bNegative ? -static_cast<std::int64_t>(m_unMagnitude) : static_cast<std::int64_t>(m_unMagnitude);
	}

	class Integer {
	public:
		static Local<Value> NewFromUnsigned(Isolate*, const std::uint32_t unValue);
	};

	Local<Value> Integer::NewFromUnsigned(Isolate*, const std::uint32_t unValue) {
		static constinit std::vector<std::unique_ptr<Number>> s_vecValues {};

		s_vecValues.push_back(std::make_unique<Number>(unValue));

		return Local<Value>(s_vecValues.back().get());
	}

	Local<Context> Isolate::GetCurrentContext() const noexcept {
		static Context s_Context {};

		return Local<Context>(&s_Context);
	}

	class Object final : public Value {
	public:
		static Local<Object> New(Isolate*);

		std::map<std::string, Local<Value>> m_mapValues;
	};

	Local<Object> Object::New(Isolate*) {
		static constinit std::vector<std::unique_ptr<Object>> s_vecValues {};

		s_vecValues.push_back(std::make_unique<Object>());

		return Local<Object>(s_vecValues.back().get());
	}

	class Text final : public Value {
	public:
		Text(std::string const& strValue, const bool bConversionFailure);
		std::string const& GetValue() const noexcept;
		bool HasConversionFailure() const noexcept;

	private:
		std::string m_strValue;
		bool m_bConversionFailure;
	};

	Text::Text(std::string const& strValue, const bool bConversionFailure) :
		m_strValue(strValue),
		m_bConversionFailure(bConversionFailure)
	{
	}

	std::string const& Text::GetValue() const noexcept {
		return m_strValue;
	}

	bool Text::HasConversionFailure() const noexcept {
		return m_bConversionFailure;
	}

	class String : public Value {
	public:
		explicit String(std::string const& strValue);
		std::string const& GetValue() const noexcept;

		class Utf8Value {
		public:
			Utf8Value(Isolate*, Local<Value> const LocalValue);
			char const* operator*() const noexcept;
			std::size_t length() const noexcept;

		private:
			std::string m_strValue;
			bool m_bValid;
		};

	private:
		std::string m_strValue;
	};

	String::String(std::string const& strValue) :
		m_strValue(strValue)
	{
	}

	std::string const& String::GetValue() const noexcept {
		return m_strValue;
	}

	MaybeLocal<String> Value::ToString(Local<Context>) {
		static constinit std::vector<std::unique_ptr<String>> s_vecValues {};

		auto* const pText = dynamic_cast<Text*>(this);
		if (!pText || pText->HasConversionFailure()) {
			return {};
		}

		s_vecValues.push_back(std::make_unique<String>(pText->GetValue()));

		return MaybeLocal<String>(Local<String>(s_vecValues.back().get()));
	}

	String::Utf8Value::Utf8Value(Isolate*, Local<Value> const LocalValue) {
		m_bValid = false;

		if (!LocalValue.IsEmpty()) {
			auto* const pString = dynamic_cast<String*>(LocalValue.operator->());
			if (pString) {
				m_strValue = pString->GetValue();
				m_bValid = true;
				return;
			}

			auto* const pText = dynamic_cast<Text*>(LocalValue.operator->());
			if (pText && !pText->HasConversionFailure()) {
				m_strValue = pText->GetValue();
				m_bValid = true;
			}
		}
	}

	char const* String::Utf8Value::operator*() const noexcept {
		return m_bValid ? m_strValue.c_str() : nullptr;
	}

	std::size_t String::Utf8Value::length() const noexcept {
		return m_strValue.size();
	}

	enum class BackingStoreInitializationMode {
		kZeroInitialized = 0
	};

	enum class BackingStoreOnFailureMode {
		kOutOfMemory = 0,
		kReturnNull
	};

	class BackingStore {
	public:
		BackingStore(const std::size_t unSize, const bool bNullData);
		void* Data() noexcept;
		std::size_t ByteLength() const noexcept;

	private:
		std::vector<unsigned char> m_vecBytes;
		bool m_bNullData;
	};

	BackingStore::BackingStore(const std::size_t unSize, const bool bNullData) :
		m_vecBytes(unSize),
		m_bNullData(bNullData)
	{
	}

	void* BackingStore::Data() noexcept {
		return (m_bNullData || m_vecBytes.empty()) ? nullptr : m_vecBytes.data();
	}

	std::size_t BackingStore::ByteLength() const noexcept {
		return m_vecBytes.size();
	}

	// Stable fixture-owned factory values are not V8 handles or garbage collection.
	class ArrayBuffer {
	public:
		explicit ArrayBuffer(std::shared_ptr<BackingStore> pBackingStore) noexcept;
		static std::unique_ptr<BackingStore> NewBackingStore(Isolate* const pIsolate, const std::size_t unSize, const BackingStoreInitializationMode InitializationMode, const BackingStoreOnFailureMode FailureMode);
		static Local<ArrayBuffer> New(Isolate*, std::shared_ptr<BackingStore> pBackingStore);
		void* Data() const noexcept;
		std::size_t ByteLength() const noexcept;

	private:
		std::shared_ptr<BackingStore> m_pBackingStore;
	};

	ArrayBuffer::ArrayBuffer(std::shared_ptr<BackingStore> pBackingStore) noexcept :
		m_pBackingStore(std::move(pBackingStore))
	{
	}

	std::unique_ptr<BackingStore> ArrayBuffer::NewBackingStore(Isolate* const pIsolate, const std::size_t unSize, const BackingStoreInitializationMode InitializationMode, const BackingStoreOnFailureMode FailureMode) {
		pIsolate->m_bRecoverableAllocation = (InitializationMode == BackingStoreInitializationMode::kZeroInitialized) && (FailureMode == BackingStoreOnFailureMode::kReturnNull);

		if (pIsolate->m_bFailBackingStore) {
			return {};
		}

		return std::make_unique<BackingStore>(unSize, pIsolate->m_bNullBackingData);
	}

	Local<ArrayBuffer> ArrayBuffer::New(Isolate*, std::shared_ptr<BackingStore> pBackingStore) {
		static constinit std::vector<std::unique_ptr<ArrayBuffer>> s_vecBuffers {};

		s_vecBuffers.push_back(std::make_unique<ArrayBuffer>(std::move(pBackingStore)));

		return Local<ArrayBuffer>(s_vecBuffers.back().get());
	}

	void* ArrayBuffer::Data() const noexcept {
		return m_pBackingStore->Data();
	}

	std::size_t ArrayBuffer::ByteLength() const noexcept {
		return m_pBackingStore->ByteLength();
	}

	class Uint8Array final : public Value {
	public:
		Uint8Array(Local<ArrayBuffer> const LocalBuffer, const std::size_t unOffset, const std::size_t unSize) noexcept;
		static Local<Uint8Array> New(Local<ArrayBuffer> const LocalBuffer, const std::size_t unOffset, const std::size_t unSize);
		void const* Data() const noexcept;
		std::size_t ByteLength() const noexcept;

	private:
		Local<ArrayBuffer> m_LocalBuffer;
		std::size_t m_unOffset;
		std::size_t m_unSize;
	};

	Uint8Array::Uint8Array(Local<ArrayBuffer> const LocalBuffer, const std::size_t unOffset, const std::size_t unSize) noexcept :
		m_LocalBuffer(LocalBuffer),
		m_unOffset(unOffset),
		m_unSize(unSize)
	{
	}

	Local<Uint8Array> Uint8Array::New(Local<ArrayBuffer> const LocalBuffer, const std::size_t unOffset, const std::size_t unSize) {
		constexpr int kInvalidArrayBufferRangeError = 1;

		static constinit std::vector<std::unique_ptr<Uint8Array>> s_vecArrays {};

		if ((unOffset > LocalBuffer->ByteLength()) || (unSize > (LocalBuffer->ByteLength() - unOffset))) {
			throw kInvalidArrayBufferRangeError;
		}

		s_vecArrays.push_back(std::make_unique<Uint8Array>(LocalBuffer, unOffset, unSize));

		return Local<Uint8Array>(s_vecArrays.back().get());
	}

	void const* Uint8Array::Data() const noexcept {
		return m_unSize ? (static_cast<unsigned char*>(m_LocalBuffer->Data()) + m_unOffset) : nullptr;
	}

	std::size_t Uint8Array::ByteLength() const noexcept {
		return m_unSize;
	}
} // namespace v8

namespace SourceJS {
	namespace {
		int g_nPageMode = 0;
		int g_nAllocationMode = 0;
		bool g_bReportReleaseFailure = false;
#if !defined(_WIN32)
		bool g_bZeroMapping = false;
#endif
		std::size_t g_unReleaseCount = 0;
		std::size_t g_unLogCount = 0;
		unsigned int g_unLoggedError = 0;

		void Check(const bool bCondition, char const* const pszMessage) {
			if (!bCondition) {
				std::fprintf(stderr, "MEMORY_HOOK_VALUE_ASSERTION_FAILED: %s\n", pszMessage);
				std::exit(EXIT_FAILURE);
			}
		}

		void LogError(char const* const pszFormat, void*, std::size_t, const unsigned long unError) noexcept {
			if (std::strstr(pszFormat, "release failed") || std::strstr(pszFormat, "cleanup failed") || std::strstr(pszFormat, "FreeExecutable failed")) {
				++g_unLogCount;
				g_unLoggedError = static_cast<unsigned int>(unError);
			}
		}

#if defined(_WIN32)
		void FixtureGetSystemInfo(SYSTEM_INFO* const pInformation) noexcept {
			GetSystemInfo(pInformation);

			if (g_nPageMode != 0) {
				pInformation->dwPageSize = 0;
			}
		}

		void* FixtureVirtualAlloc(void* const pAddress, const SIZE_T unSize, const DWORD unAllocationType, const DWORD unProtection) noexcept {
			if (g_nAllocationMode != 0) {
				return nullptr;
			}

			return VirtualAlloc(pAddress, unSize, unAllocationType, unProtection);
		}

		BOOL FixtureVirtualFree(void* const pAddress, const SIZE_T unSize, const DWORD unFreeType) noexcept {
			++g_unReleaseCount;
			const BOOL bReleased = VirtualFree(pAddress, unSize, unFreeType);

			if (g_bReportReleaseFailure) {
				SetLastError(ERROR_ACCESS_DENIED);
				return FALSE;
			}

			return bReleased;
		}

#define VirtualAlloc FixtureVirtualAlloc
#define VirtualFree FixtureVirtualFree
#define GetSystemInfo FixtureGetSystemInfo
#else
		long FixtureSysconf(const int nName) noexcept {
			if (g_nPageMode != 0) {
				return (g_nPageMode == 1) ? -1 : 0;
			}

			return sysconf(nName);
		}

		void* FixtureMmap(void* const pAddress, const std::size_t unSize, const int nProtection, const int nFlags, const int nFile, const off_t nOffset) noexcept {
			if (g_nAllocationMode == 1) {
				errno = ENOMEM;
				return MAP_FAILED;
			}

			if (g_nAllocationMode == 2) {
				g_bZeroMapping = true;
				return nullptr;
			}

			return mmap(pAddress, unSize, nProtection, nFlags, nFile, nOffset);
		}

		int FixtureMunmap(void* const pAddress, const std::size_t unSize) noexcept {
			++g_unReleaseCount;
			const int nResult = (!pAddress && g_bZeroMapping) ? 0 : munmap(pAddress, unSize);
			g_bZeroMapping = false;

			if (g_bReportReleaseFailure) {
				errno = EACCES;
				return -1;
			}

			return nResult;
		}

#define sysconf FixtureSysconf
#define mmap FixtureMmap
#define munmap FixtureMunmap
#endif

@STACK_STORAGE@

@EXECUTABLE_HELPERS@

#if defined(_WIN32)
#undef VirtualAlloc
#undef VirtualFree
#undef GetSystemInfo
#else
#undef sysconf
#undef mmap
#undef munmap
#endif

#if defined(_M_X64) || defined(__x86_64__)
#if defined(DETOURS_ARCH_X86)
#error Inconsistent x64 fixture architecture
#endif
#ifndef DETOURS_ARCH_X64
#define DETOURS_ARCH_X64 1
#define SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_DETOURS_ARCH_X64
#endif
#elif defined(_M_IX86) || defined(__i386__)
#if defined(DETOURS_ARCH_X64)
#error Inconsistent x86 fixture architecture
#endif
#ifndef DETOURS_ARCH_X86
#define DETOURS_ARCH_X86 1
#define SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_DETOURS_ARCH_X86
#endif
#else
#error Unsupported fixture architecture
#endif

		// Consumed context members are doubled, not full Detours layout/execution.
		// The x87 FSAVE record below has its exact hardware byte layout for real x86 instructions.
		namespace Detours::Hook {
#pragma pack(push, 1)
			typedef union _RAW_CONTEXT_FPU_REGISTER {
				unsigned char m_unRAW[10];
				double m_f64;
				float m_f32;
			} RAW_CONTEXT_FPU_REGISTER, *PRAW_CONTEXT_FPU_REGISTER;

			typedef struct _RAW_CONTEXT_FPU {
				unsigned short m_unControlWord;
				unsigned short m_unReserved1;
				unsigned short m_unStatusWord;
				unsigned short m_unReserved2;
				unsigned short m_unTagWord;
				unsigned short m_unReserved3;
				unsigned int m_unIP;
				unsigned short m_unCS;
				unsigned short m_unOP;
				unsigned int m_unDP;
				unsigned short m_unDS;
				unsigned short m_unReserved4;
				RAW_CONTEXT_FPU_REGISTER m_Registers[8];
			} RAW_CONTEXT_FPU, *PRAW_CONTEXT_FPU;
#pragma pack(pop)

			static_assert(sizeof(RAW_CONTEXT_FPU_REGISTER) == 10);
			static_assert(sizeof(RAW_CONTEXT_FPU) == 108);
			static_assert(offsetof(RAW_CONTEXT_FPU, m_unControlWord) == 0x00);
			static_assert(offsetof(RAW_CONTEXT_FPU, m_unStatusWord) == 0x04);
			static_assert(offsetof(RAW_CONTEXT_FPU, m_unTagWord) == 0x08);
			static_assert(offsetof(RAW_CONTEXT_FPU, m_Registers) == 0x1C);
			static_assert(std::is_trivially_copyable_v<RAW_CONTEXT_FPU> && std::is_standard_layout_v<RAW_CONTEXT_FPU>);

			struct RAW_CONTEXT_M512 {
				unsigned char m_arrBytes[64];
			};

			struct StackAddress {
				void* m_pAddress;

				void SetAddress(void* const pAddress) noexcept {
					m_pAddress = pAddress;
				}

				void* GetAddress() const noexcept {
					return m_pAddress;
				}
			};

			using PRAW_CONTEXT_M512 = RAW_CONTEXT_M512*;

			struct RAW_CONTEXT {
				StackAddress m_Stack;
				RAW_CONTEXT_FPU m_FPU;
				unsigned int m_unMXCSR;
				RAW_CONTEXT_M512 m_ZMM0;
				RAW_CONTEXT_M512 m_ZMM1;
				RAW_CONTEXT_M512 m_ZMM2;
				RAW_CONTEXT_M512 m_ZMM3;
				RAW_CONTEXT_M512 m_ZMM4;
				RAW_CONTEXT_M512 m_ZMM5;
				RAW_CONTEXT_M512 m_ZMM6;
				RAW_CONTEXT_M512 m_ZMM7;
#if defined(DETOURS_ARCH_X64)
				RAW_CONTEXT_M512 m_ZMM8;
				RAW_CONTEXT_M512 m_ZMM9;
				RAW_CONTEXT_M512 m_ZMM10;
				RAW_CONTEXT_M512 m_ZMM11;
				RAW_CONTEXT_M512 m_ZMM12;
				RAW_CONTEXT_M512 m_ZMM13;
				RAW_CONTEXT_M512 m_ZMM14;
				RAW_CONTEXT_M512 m_ZMM15;
				unsigned long long m_unRFLAGS;
				unsigned long long m_unRAX;
				unsigned long long m_unRCX;
				unsigned long long m_unRDX;
				unsigned long long m_unRBX;
				unsigned long long m_unRBP;
				unsigned long long m_unRSI;
				unsigned long long m_unRDI;
				unsigned long long m_unR8;
				unsigned long long m_unR9;
				unsigned long long m_unR10;
				unsigned long long m_unR11;
				unsigned long long m_unR12;
				unsigned long long m_unR13;
				unsigned long long m_unR14;
				unsigned long long m_unR15;
#else
				std::uint32_t m_unEFLAGS;
				std::uint32_t m_unEAX;
				std::uint32_t m_unECX;
				std::uint32_t m_unEDX;
				std::uint32_t m_unEBX;
				std::uint32_t m_unEBP;
				std::uint32_t m_unESI;
				std::uint32_t m_unEDI;
#endif
			};
		} // namespace Detours::Hook

@ARGUMENT_RECORDS@

		struct NativeCallRequest {
			std::string m_strConvention;
			std::vector<NativeCallArgument> m_vecArguments;
			std::map<std::string, std::uintptr_t> m_mapRegisters;
		};

@RESULT_RECORD@

#if defined(DETOURS_ARCH_X64)
		static_assert(offsetof(NATIVE_CALL_RESULT, m_arrFXState) == 0xA0);
		static_assert(sizeof(NATIVE_CALL_RESULT) == 672);
#else
		static_assert(offsetof(NATIVE_CALL_RESULT, m_arrFXState) == 0x40);
		static_assert(sizeof(NATIVE_CALL_RESULT) == 576);
#endif

		void ThrowError(v8::Isolate* const pIsolate, char const* const pszMessage) {
			pIsolate->m_strError = pszMessage;
			pIsolate->m_bPendingException = true;
			pIsolate->m_bCaught = pIsolate->m_bFrameActive;
		}

		bool SetValue(v8::Isolate* const pIsolate, v8::Local<v8::Context>, v8::Local<v8::Object> const LocalObject, char const* const pszName, v8::Local<v8::Value> const LocalValue) {
			if (LocalValue.IsEmpty()) {
				return false;
			}

			const std::size_t unSetIndex = pIsolate->m_unSetCount++;
			if ((pIsolate->m_nFailSetIndex >= 0) && (unSetIndex == static_cast<std::size_t>(pIsolate->m_nFailSetIndex))) {
				return false;
			}

			LocalObject->m_mapValues.emplace(pszName, LocalValue);

			return true;
		}

@RAW_STACK_LIMIT@
		constexpr std::size_t kMaximumNativeStackCopySize = HOOK_RAW_CALL_MAXIMUM_STACK_SIZE / 4;

		// Exact SDK method/type spellings, with identity-only doubles; no SDK layout or live engine is exercised.
		struct CBaseEntity {
		};

		struct FixtureSDKLookupFailure {
		};

		constexpr int kFixtureEntityIndex = 7;

		struct FixtureServerUnknown {
			CBaseEntity* m_pEntity;

			CBaseEntity* GetBaseEntity() const noexcept {
				return m_pEntity;
			}
		};

		struct edict_t {
			bool m_bFree;
			FixtureServerUnknown* m_pUnknown;

			bool IsFree() const noexcept {
				return m_bFree;
			}

			FixtureServerUnknown* GetUnknown() const noexcept {
				return m_pUnknown;
			}
		};

		struct FixtureEngineInterfaces {
			bool m_bThrowLookup;
			edict_t* m_pEdict;

			edict_t* GetEdict(const int nEntityIndex) const {
				if (m_bThrowLookup) {
					throw FixtureSDKLookupFailure {};
				}

				return (nEntityIndex == kFixtureEntityIndex) ? m_pEdict : nullptr;
			}
		};

		struct FixtureApplication {
			FixtureEngineInterfaces m_EngineInterfaces;

			FixtureEngineInterfaces& GetEngineInterfaces() noexcept {
				return m_EngineInterfaces;
			}
		};

		using fnFixtureEdictLookup = edict_t*(*)(int nEntityIndex);
		using fnFixtureEntityLookup = CBaseEntity*(*)(int nEntityIndex);

		FixtureApplication g_Application {};

@READERS@

#undef HOOK_RAW_CALL_MAXIMUM_STACK_SIZE

		void CheckSDKLookups() {
			constexpr int kInvalidEntityIndex = -1;

			// Observable reads keep /WX negative fixtures executable instead of constant-folded C4702 failures.
			// This is test/compiler observability, never synchronization.
			const volatile bool bEdictNoexcept = noexcept(FindEdictByIndex(kFixtureEntityIndex));
			const volatile bool bEntityNoexcept = noexcept(FindBaseEntityByIndex(kFixtureEntityIndex));
			fnFixtureEdictLookup const volatile EdictLookup = &FindEdictByIndex;
			fnFixtureEntityLookup const volatile EntityLookup = &FindBaseEntityByIndex;
			Check(!bEdictNoexcept, "edict wrapper cannot promise a nonthrowing SDK lookup");
			Check(!bEntityNoexcept, "entity wrapper cannot promise a nonthrowing SDK lookup");

			CBaseEntity Entity {};
			FixtureServerUnknown Unknown { &Entity };
			edict_t Edict { false, &Unknown };
			g_Application.m_EngineInterfaces.m_pEdict = &Edict;
			Check(FindEdictByIndex(kFixtureEntityIndex) == &Edict, "edict identity from the SDK adapter");
			Check(FindBaseEntityByIndex(kFixtureEntityIndex) == &Entity, "base entity identity from the SDK adapter");

			Check(FindEdictByIndex(kInvalidEntityIndex) == nullptr, "missing edict lookup");
			Check(FindBaseEntityByIndex(kInvalidEntityIndex) == nullptr, "missing base entity lookup");

			Edict.m_bFree = true;
			Check(FindBaseEntityByIndex(kFixtureEntityIndex) == nullptr, "free edict cannot expose an entity");

			Edict.m_bFree = false;
			Edict.m_pUnknown = nullptr;
			Check(FindBaseEntityByIndex(kFixtureEntityIndex) == nullptr, "missing server unknown cannot expose an entity");

			Edict.m_pUnknown = &Unknown;
			Unknown.m_pEntity = nullptr;
			Check(FindBaseEntityByIndex(kFixtureEntityIndex) == nullptr, "null base entity result");

			g_Application.m_EngineInterfaces.m_bThrowLookup = true;
			bool bEdictFailure = false;
			try {
				EdictLookup(kFixtureEntityIndex);
			} catch (FixtureSDKLookupFailure const&) {
				bEdictFailure = true;
			}

			Check(bEdictFailure, "edict lookup failure propagates without terminating");

			bool bEntityFailure = false;
			try {
				EntityLookup(kFixtureEntityIndex);
			} catch (FixtureSDKLookupFailure const&) {
				bEntityFailure = true;
			}

			Check(bEntityFailure, "entity lookup failure propagates without terminating");

			g_Application.m_EngineInterfaces.m_bThrowLookup = false;
			g_Application.m_EngineInterfaces.m_pEdict = nullptr;
		}

@CAPTURE_HELPERS@

		void CheckCapturedNativeResults() {
			constexpr std::uint64_t kFloatingReturnBits = 0x3FF8'0000'3FC0'0000;
			constexpr std::size_t kExpectedFXStateSize = 512;
			constexpr std::size_t kFPURegisterCount = 8;
			constexpr std::size_t kFPURegisterOffset = 0x20;
			constexpr std::size_t kFPURegisterStride = 16;
			constexpr std::size_t kFPUValueSize = 10;
			constexpr std::size_t kXMMRegisterOffset = 0xA0;
			constexpr std::size_t kXMMValueSize = 16;
			constexpr unsigned char kExpectedHeader[] = { 0x7F, 0x03, 0x00, 0x38, 0x85, 0x00, 0xCD, 0xAB, 0x78, 0x56, 0x34, 0x12, 0xBC, 0x9A, 0x00, 0x00, 0xD4, 0xC3, 0xB2, 0xA1, 0x6F, 0x5E, 0x00, 0x00, 0x80, 0x1F, 0x00, 0x00 };
#if defined(DETOURS_ARCH_X64)
			constexpr std::size_t kSIMDCount = 16;
#else
			constexpr std::size_t kSIMDCount = 8;
#endif

			Detours::Hook::RAW_CONTEXT RawContext {};
#if defined(DETOURS_ARCH_X86)
			RawContext.m_FPU.m_unControlWord = 0x037F;
			RawContext.m_FPU.m_unTagWord = 0xFFFF;
			Check(WriteX87ValueFromDouble(1.5, &RawContext.m_FPU), "prepare valid x87 return value");
#endif
			RawContext.m_FPU.m_unControlWord = 0x037F;
			RawContext.m_FPU.m_unStatusWord = 0x3800;
			RawContext.m_FPU.m_unTagWord = 0x3FCC;
			RawContext.m_FPU.m_unOP = 0xABCD;
			RawContext.m_FPU.m_unIP = 0x1234'5678;
			RawContext.m_FPU.m_unCS = 0x9ABC;
			RawContext.m_FPU.m_unDP = 0xA1B2'C3D4;
			RawContext.m_FPU.m_unDS = 0x5E6F;
			RawContext.m_unMXCSR = 0x1F80;
			RawContext.m_Stack.SetAddress(&RawContext);
			Detours::Hook::PRAW_CONTEXT_M512 const arrSIMDRegisters[kSIMDCount] = {
				&RawContext.m_ZMM0, &RawContext.m_ZMM1, &RawContext.m_ZMM2, &RawContext.m_ZMM3,
				&RawContext.m_ZMM4, &RawContext.m_ZMM5, &RawContext.m_ZMM6, &RawContext.m_ZMM7,
#if defined(DETOURS_ARCH_X64)
				&RawContext.m_ZMM8, &RawContext.m_ZMM9, &RawContext.m_ZMM10, &RawContext.m_ZMM11,
				&RawContext.m_ZMM12, &RawContext.m_ZMM13, &RawContext.m_ZMM14, &RawContext.m_ZMM15,
#endif
			};
			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kSIMDCount; ++unRegisterIndex) {
				std::memset(arrSIMDRegisters[unRegisterIndex], static_cast<int>(unRegisterIndex + 1), sizeof(*arrSIMDRegisters[unRegisterIndex]));
			}

			std::memcpy(&RawContext.m_ZMM0, &kFloatingReturnBits, sizeof(kFloatingReturnBits));
#if defined(DETOURS_ARCH_X64)
			RawContext.m_unRAX = 0xFEDC'BA98'7654'3210;
			RawContext.m_unRFLAGS = 0x202;
#else
			RawContext.m_unEAX = 0x7654'3210;
			RawContext.m_unEDX = 0xFEDC'BA98;
			RawContext.m_unEFLAGS = 0x202;
#endif

			NATIVE_CALL_RESULT Result {};
			std::memset(Result.m_arrFXState, 0xA5, sizeof(Result.m_arrFXState));
			CaptureNativeCallResult(RawContext, Result);
			Check(Result.m_unInteger == 0xFEDC'BA98'7654'3210, "exact native integer return pair/word");
#if defined(DETOURS_ARCH_X64)
			Check(Result.m_dblDouble == std::bit_cast<double>(kFloatingReturnBits), "x64 double return representation");
			Check(Result.m_flFloat == 1.5F, "x64 float return representation");
			Check((Result.m_unRFLAGS == 0x202) && (Result.m_unRSP == reinterpret_cast<std::uintptr_t>(&RawContext)), "x64 flags and stack snapshot");
#else
			Check((Result.m_dblDouble == 1.5) && (Result.m_flFloat == 1.5F), "x86 actual x87 return conversion");
			Check((Result.m_unEFLAGS == 0x202) && (Result.m_unESP == reinterpret_cast<std::uintptr_t>(&RawContext)), "x86 flags and stack snapshot");
#endif

			unsigned char arrExpectedFXState[kExpectedFXStateSize] {};
			std::memcpy(arrExpectedFXState, kExpectedHeader, sizeof(kExpectedHeader));
			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kFPURegisterCount; ++unRegisterIndex) {
				std::memcpy(arrExpectedFXState + kFPURegisterOffset + (unRegisterIndex * kFPURegisterStride), RawContext.m_FPU.m_Registers[unRegisterIndex].m_unRAW, kFPUValueSize);
			}

			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kSIMDCount; ++unRegisterIndex) {
				std::memcpy(arrExpectedFXState + kXMMRegisterOffset + (unRegisterIndex * kXMMValueSize), arrSIMDRegisters[unRegisterIndex], kXMMValueSize);
			}

			Check(std::memcmp(Result.m_arrFXState, arrExpectedFXState, sizeof(arrExpectedFXState)) == 0, "complete captured FX header, tags, slots, padding and SIMD bytes");
		}

#if defined(DETOURS_ARCH_X86)
		void CheckWideX87Capture() {
			constexpr double kMaximumFloat = static_cast<double>(std::numeric_limits<float>::max());
			constexpr double kWideFiniteValue = kMaximumFloat * 1.5;
			constexpr double kValues[] = { std::numeric_limits<double>::max(), -std::numeric_limits<double>::max(), kWideFiniteValue, -kWideFiniteValue, kMaximumFloat, -kMaximumFloat, 0.0, -0.0, std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN() };

			for (auto const& dblValue : kValues) {
				Detours::Hook::RAW_CONTEXT RawContext {};
				RawContext.m_FPU.m_unControlWord = 0x037F;
				RawContext.m_FPU.m_unTagWord = 0xFFFF;
				Check(WriteX87ValueFromDouble(dblValue, &RawContext.m_FPU), "prepare wide/nonfinite x87 capture");
				Check(std::feclearexcept(FE_ALL_EXCEPT) == 0, "clear hardware floating exceptions before capture");
				NATIVE_CALL_RESULT Result {};
				CaptureNativeCallResult(RawContext, Result);
				const int nOverflow = std::fetestexcept(FE_OVERFLOW);
				Check(nOverflow == 0, "unused float snapshot must not overflow a valid wide x87 double return");

				if (std::isnan(dblValue)) {
					Check(std::isnan(Result.m_dblDouble) && std::isnan(Result.m_flFloat), "capture preserves NaN in both views");
					continue;
				}

				Check(Result.m_dblDouble == dblValue, "capture preserves the full double result");

				if (std::isinf(dblValue) || (std::fabs(dblValue) > kMaximumFloat)) {
					Check(std::isinf(Result.m_flFloat) && (std::signbit(Result.m_flFloat) == std::signbit(dblValue)), "out-of-range alternate float view is signed infinity");

				} else {
					Check(Result.m_flFloat == static_cast<float>(dblValue), "representable native float view remains exact");

					if (dblValue == 0.0) {
						Check(std::signbit(Result.m_flFloat) == std::signbit(dblValue), "capture preserves signed zero");
					}
				}
			}
		}

		void CheckX87Conversions() {
			constexpr unsigned int kTopBitOffset = 11;
			constexpr unsigned int kTagBits = 2;
			constexpr unsigned int kRegisterCount = 8;
			constexpr unsigned int kTopMask = 0x07;
			constexpr unsigned int kEmptyTag = 0x03;
			constexpr unsigned short kAllTagsEmpty = 0xFFFF;
			constexpr unsigned short kControlWord = 0x037F;
			constexpr double kReturnValue = -2.75;

			CheckWideX87Capture();
			Check(ReadX87ValueAsDouble(nullptr) == 0.0, "null x87 read");
			Check(!WriteX87ValueFromDouble(1.5, nullptr), "null x87 write");

			for (unsigned int unTop = 0; unTop < kRegisterCount; ++unTop) {
				for (auto const& bOccupied : { false, true }) {
					Detours::Hook::RAW_CONTEXT_FPU State {};
					State.m_unControlWord = kControlWord;
					State.m_unStatusWord = static_cast<unsigned short>(unTop << kTopBitOffset);
					State.m_unTagWord = bOccupied ? static_cast<unsigned short>(kAllTagsEmpty & ~(kEmptyTag << (unTop * kTagBits))) : kAllTagsEmpty;
					Check(WriteX87ValueFromDouble(kReturnValue, &State), "actual x87 empty/occupied top write");
					const unsigned int unExpectedTop = bOccupied ? unTop : ((unTop + kRegisterCount - 1) % kRegisterCount);
					Check(((static_cast<unsigned int>(State.m_unStatusWord) >> kTopBitOffset) & kTopMask) == unExpectedTop, "x87 preserves or advances TOP correctly");
					Check(State.m_unTagWord == static_cast<unsigned short>(kAllTagsEmpty & ~(kEmptyTag << (unExpectedTop * kTagBits))), "x87 exact occupied tag");
					Check((State.m_unControlWord == kControlWord) && (ReadX87ValueAsDouble(&State.m_Registers[0]) == kReturnValue), "x87 preserves control and converts return value");
				}
			}
		}
#endif

		void CheckNativeCallContexts() {
			constexpr std::uintptr_t kFirstArgument = (std::uintptr_t(1) << ((sizeof(std::uintptr_t) * 8) - 1)) + 0x123456;
			constexpr unsigned char kUnwrittenByte = 0xA5;
			constexpr std::size_t kStackByteSentinel = 73;
			constexpr std::size_t kMaximumArgumentCount = 10;
#if defined(DETOURS_ARCH_X64)
			constexpr std::size_t kStackEntryOffset = 0x08;
			constexpr char const* const kRegisterNames[] = { "RAX", "RCX", "RDX", "RBX", "RBP", "RSI", "RDI", "R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15" };
#if defined(_WIN32)
			constexpr std::size_t kRegisterArgumentCount = 4;
			constexpr std::size_t kFirstStackArgumentOffset = 0x28;
#else
			constexpr std::size_t kRegisterArgumentCount = 6;
			constexpr std::size_t kFirstStackArgumentOffset = 0x08;
#endif
#else
			constexpr std::size_t kStackEntryOffset = 0x0C;
			constexpr std::size_t kFirstStackArgumentOffset = sizeof(std::uint32_t);
			constexpr char const* const kRegisterNames[] = { "EAX", "ECX", "EDX", "EBX", "EBP", "ESI", "EDI" };
#endif
			constexpr std::size_t kRegisterCount = sizeof(kRegisterNames) / sizeof(kRegisterNames[0]);

			NativeCallRequest Request {};
			NativeCallStackStorage Storage {};
			Detours::Hook::RAW_CONTEXT RawContext {};
			std::size_t unStackBytes = kStackByteSentinel;
			Check(!ConfigureNativeCallContext(Request, Storage, RawContext, unStackBytes), "reject empty native call storage");
			// Observe the output at runtime so /WX does not fold the negative fixture into unreachable code.
			const volatile std::size_t unFailedStackBytes = unStackBytes;
			Check((unFailedStackBytes == kStackByteSentinel) && !RawContext.m_Stack.GetAddress(), "empty storage preserves the size output and leaves no native call context");
			Check(Storage.Allocate(), "native call context stack allocation");

			for (auto const& pszConvention : { "cdecl", "stdcall", "thiscall", "fastcall" }) {
				Request.m_strConvention = pszConvention;
#if !defined(DETOURS_ARCH_X64)
				const std::size_t unRegisterArgumentCount = (Request.m_strConvention == "thiscall") ? 1 : (Request.m_strConvention == "fastcall") ? 2 : 0;
#endif

				for (std::size_t unArgumentCount = 0; unArgumentCount <= kMaximumArgumentCount; ++unArgumentCount) {
					Request.m_vecArguments.clear();
					for (std::size_t unArgumentIndex = 0; unArgumentIndex < unArgumentCount; ++unArgumentIndex) {
						Request.m_vecArguments.push_back({ kFirstArgument + unArgumentIndex, NativeCallArgumentKind::Integer });
					}

					RawContext = {};
					std::memset(Storage.GetAddress(), kUnwrittenByte, Storage.GetSize());
					unStackBytes = kStackByteSentinel;
					Check(ConfigureNativeCallContext(Request, Storage, RawContext, unStackBytes), "native argument context configured");
					Check(RawContext.m_Stack.GetAddress() == (Storage.GetAddress() + kStackEntryOffset), "native call stack entry address");
#if defined(DETOURS_ARCH_X64)
#if defined(_WIN32)
					const std::uint64_t arrRegisterArguments[] = { RawContext.m_unRCX, RawContext.m_unRDX, RawContext.m_unR8, RawContext.m_unR9 };
#else
					const std::uint64_t arrRegisterArguments[] = { RawContext.m_unRDI, RawContext.m_unRSI, RawContext.m_unRDX, RawContext.m_unRCX, RawContext.m_unR8, RawContext.m_unR9 };
#endif
					const std::size_t unFirstStackArgumentIndex = kRegisterArgumentCount;
					for (std::size_t unRegisterIndex = 0; unRegisterIndex < kRegisterArgumentCount; ++unRegisterIndex) {
						Check(arrRegisterArguments[unRegisterIndex] == ((unRegisterIndex < unArgumentCount) ? (kFirstArgument + unRegisterIndex) : 0), "x64 ABI register argument");
					}
#else
					const std::size_t unFirstStackArgumentIndex = unRegisterArgumentCount;
					Check(RawContext.m_unECX == (((unRegisterArgumentCount > 0) && (unArgumentCount > 0)) ? kFirstArgument : 0), "x86 ECX argument");
					Check(RawContext.m_unEDX == (((unRegisterArgumentCount > 1) && (unArgumentCount > 1)) ? (kFirstArgument + 1) : 0), "x86 EDX argument");
#endif
					const std::size_t unStackArgumentCount = (unArgumentCount > unFirstStackArgumentIndex) ? (unArgumentCount - unFirstStackArgumentIndex) : 0;
#if defined(DETOURS_ARCH_X64)
					Check(unStackBytes == 0, "x64 has no x86 caller cleanup");
#else
					Check(unStackBytes == (unStackArgumentCount * sizeof(std::uint32_t)), "x86 exact caller cleanup bytes");
#endif

					for (std::size_t unStackIndex = 0; unStackIndex < unStackArgumentCount; ++unStackIndex) {
						std::uintptr_t unStackValue = 0;
						std::memcpy(&unStackValue, Storage.GetAddress() + kStackEntryOffset + kFirstStackArgumentOffset + (unStackIndex * sizeof(unStackValue)), sizeof(unStackValue));
						Check(unStackValue == (kFirstArgument + unFirstStackArgumentIndex + unStackIndex), "complete stack argument word");
					}

					const std::size_t unWrittenEnd = kStackEntryOffset + kFirstStackArgumentOffset + (unStackArgumentCount * sizeof(std::uintptr_t));
					Check(Storage.GetAddress()[unWrittenEnd] == kUnwrittenByte, "stack argument upper write boundary");
					Check(Storage.GetAddress()[kStackEntryOffset - 1] == kUnwrittenByte, "stack argument lower write boundary");
				}
			}

			// The complete capacity is accepted; one more word fails without writing storage.
			Request.m_strConvention = "cdecl";
#if defined(DETOURS_ARCH_X64)
			const std::size_t unFirstStackArgumentIndex = kRegisterArgumentCount;
#else
			const std::size_t unFirstStackArgumentIndex = 0;
#endif
			const std::size_t unCopiedStackCapacity = std::min(Storage.GetSize() - kStackEntryOffset, kMaximumNativeStackCopySize);
			const std::size_t unStackWordCapacity = (unCopiedStackCapacity - kFirstStackArgumentOffset) / sizeof(std::uintptr_t);
			Request.m_vecArguments.assign(unFirstStackArgumentIndex + unStackWordCapacity, NativeCallArgument { kFirstArgument, NativeCallArgumentKind::Integer });
			Check(ConfigureNativeCallContext(Request, Storage, RawContext, unStackBytes), "exact native stack capacity");

			Request.m_vecArguments.push_back({ kFirstArgument, NativeCallArgumentKind::Integer });
			std::memset(Storage.GetAddress(), kUnwrittenByte, Storage.GetSize());
			unStackBytes = kStackByteSentinel;
			Check(!ConfigureNativeCallContext(Request, Storage, RawContext, unStackBytes), "reject native stack capacity overflow");
			Check(unStackBytes == kStackByteSentinel, "stack overflow preserves the size output");
			for (std::size_t unByteIndex = 0; unByteIndex < Storage.GetSize(); ++unByteIndex) {
				Check(Storage.GetAddress()[unByteIndex] == kUnwrittenByte, "overflow does not write native stack");
			}

			Request.m_vecArguments.clear();
			RawContext = {};
#if defined(DETOURS_ARCH_X64)
			unsigned long long* const arrRegisterValues[] = { &RawContext.m_unRAX, &RawContext.m_unRCX, &RawContext.m_unRDX, &RawContext.m_unRBX, &RawContext.m_unRBP, &RawContext.m_unRSI, &RawContext.m_unRDI, &RawContext.m_unR8, &RawContext.m_unR9, &RawContext.m_unR10, &RawContext.m_unR11, &RawContext.m_unR12, &RawContext.m_unR13, &RawContext.m_unR14, &RawContext.m_unR15 };
			Request.m_mapRegisters["RSP"] = 0;
#else
			std::uint32_t* const arrRegisterValues[] = { &RawContext.m_unEAX, &RawContext.m_unECX, &RawContext.m_unEDX, &RawContext.m_unEBX, &RawContext.m_unEBP, &RawContext.m_unESI, &RawContext.m_unEDI };
			Request.m_mapRegisters["ESP"] = 0;
#endif
			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kRegisterCount; ++unRegisterIndex) {
				Request.m_mapRegisters[kRegisterNames[unRegisterIndex]] = kFirstArgument + unRegisterIndex;
			}

			Request.m_mapRegisters["Unknown"] = kFirstArgument;
			Check(ConfigureNativeCallContext(Request, Storage, RawContext, unStackBytes), "general register overrides configured");
			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kRegisterCount; ++unRegisterIndex) {
				Check(*arrRegisterValues[unRegisterIndex] == (kFirstArgument + unRegisterIndex), "exact general register override mapping");
			}

			Check(RawContext.m_Stack.GetAddress() == (Storage.GetAddress() + kStackEntryOffset), "stack overrides cannot replace owned native call stack");
		}

		void CheckWord(v8::Value* const pValue, const bool bExpected, const std::uintptr_t unExpected) {
			constexpr std::uintptr_t kSentinel = 0x25;

			v8::Isolate Isolate {};
			std::uintptr_t unResult = kSentinel;
			const bool bResult = ReadIntegerWordFromValue(&Isolate, v8::Local<v8::Value>(pValue), unResult);
			Check(bResult == bExpected, "word acceptance");
			Check(unResult == (bExpected ? unExpected : kSentinel), "word output commit");
			Check(Isolate.m_strError.empty() == bExpected, "word diagnostic");
		}

		void CheckAddress(v8::Value* const pValue, const bool bExpected, const std::uintptr_t unExpected) {
			constexpr std::uintptr_t kSentinel = 0x25;

			v8::Isolate Isolate {};
			std::uintptr_t unResult = kSentinel;
			const bool bResult = ReadAddressFromValue(&Isolate, v8::Local<v8::Value>(pValue), unResult);
			Check(bResult == bExpected, "address acceptance");
			Check(unResult == (bExpected ? unExpected : kSentinel), "address output commit");
			Check(Isolate.m_strError.empty() == bExpected, "address diagnostic");
		}

		void CheckEmptyStorage(NativeCallStackStorage const& Storage) {
			Check(!Storage.GetAddress() && (Storage.GetSize() == 0), "empty storage after failure");
		}

		void CheckRegisterBytes(v8::Local<v8::Object> const LocalRegisters, char const* const pszName, unsigned char const* const pchExpected, const std::size_t unSize) {
			auto itValue = LocalRegisters->m_mapValues.find(pszName);
			Check(itValue != LocalRegisters->m_mapValues.end(), "byte register present");

			auto* const pBytes = dynamic_cast<v8::Uint8Array*>(itValue->second.operator->());
			Check(pBytes && (pBytes->ByteLength() == unSize), "byte register type/length");
			Check(std::memcmp(pBytes->Data(), pchExpected, unSize) == 0, "complete independent register byte snapshot");
		}

		void CheckRegisterNumber(v8::Local<v8::Object> const LocalRegisters, char const* const pszName, const std::uint32_t unExpected) {
			auto itValue = LocalRegisters->m_mapValues.find(pszName);
			Check(itValue != LocalRegisters->m_mapValues.end(), "control register present");
			Check(itValue->second->IsNumber(), "control register Number");
			Check(itValue->second.As<v8::Number>()->Value() == unExpected, "control register value");
		}

		void CheckRegisterSnapshots() {
			constexpr std::uintptr_t kFirstWord = std::uintptr_t(1) << ((sizeof(std::uintptr_t) * 8) - 1);
			constexpr std::size_t kControlRegisterCount = 4;
			constexpr std::size_t kFPUCount = 8;
			constexpr std::size_t kFPUOffset = 0x20;
			constexpr std::size_t kFPUStride = 16;
			constexpr std::size_t kFPUValueSize = 10;
			constexpr std::size_t kXMMOffset = 0xA0;
			constexpr std::size_t kXMMValueSize = 16;
#if defined(DETOURS_ARCH_X64)
			constexpr std::size_t kXMMCount = 16;
#else
			constexpr std::size_t kXMMCount = 8;
#endif

			v8::Isolate Isolate {};
			v8::Context Context {};
			v8::Local<v8::Context> const LocalContext(&Context);
			NATIVE_CALL_RESULT CallResult {};
			std::map<std::string, std::uint64_t> mapExpected {};
			std::uintptr_t unNextWord = kFirstWord;
			auto AddExpected = [&mapExpected, &unNextWord](char const* const pszName, std::uintptr_t& unField) {
				unField = unNextWord++;
				mapExpected.emplace(pszName, unField);
			};
#if defined(DETOURS_ARCH_X64)
			AddExpected("RFLAGS", CallResult.m_unRFLAGS);
			AddExpected("RAX", CallResult.m_unRAX);
			AddExpected("RCX", CallResult.m_unRCX);
			AddExpected("RDX", CallResult.m_unRDX);
			AddExpected("RBX", CallResult.m_unRBX);
			AddExpected("RSP", CallResult.m_unRSP);
			AddExpected("RBP", CallResult.m_unRBP);
			AddExpected("RSI", CallResult.m_unRSI);
			AddExpected("RDI", CallResult.m_unRDI);
			AddExpected("R8", CallResult.m_unR8);
			AddExpected("R9", CallResult.m_unR9);
			AddExpected("R10", CallResult.m_unR10);
			AddExpected("R11", CallResult.m_unR11);
			AddExpected("R12", CallResult.m_unR12);
			AddExpected("R13", CallResult.m_unR13);
			AddExpected("R14", CallResult.m_unR14);
			AddExpected("R15", CallResult.m_unR15);
#else
			AddExpected("EFLAGS", CallResult.m_unEFLAGS);
			AddExpected("EAX", CallResult.m_unEAX);
			AddExpected("ECX", CallResult.m_unECX);
			AddExpected("EDX", CallResult.m_unEDX);
			AddExpected("EBX", CallResult.m_unEBX);
			AddExpected("ESP", CallResult.m_unESP);
			AddExpected("EBP", CallResult.m_unEBP);
			AddExpected("ESI", CallResult.m_unESI);
			AddExpected("EDI", CallResult.m_unEDI);
#endif

			for (std::size_t unByteIndex = 0; unByteIndex < sizeof(CallResult.m_arrFXState); ++unByteIndex) {
				CallResult.m_arrFXState[unByteIndex] = static_cast<unsigned char>(unByteIndex);
			}

			v8::Local<v8::Object> const LocalRegisters = MakeNativeRegisterObject(&Isolate, LocalContext, CallResult);
			Check(!LocalRegisters.IsEmpty(), "complete register snapshot");

			const std::size_t unPropertyCount = mapExpected.size() + kControlRegisterCount + kFPUCount + kXMMCount + 1;
			Check(LocalRegisters->m_mapValues.size() == unPropertyCount, "exact canonical register inventory");

			for (auto const& Expected : mapExpected) {
				auto itValue = LocalRegisters->m_mapValues.find(Expected.first);
				Check(itValue != LocalRegisters->m_mapValues.end(), "canonical machine register present");
				Check(itValue->second->IsBigInt(), "machine register BigInt on both widths");
				bool bLossless = false;
				Check((itValue->second.As<v8::BigInt>()->Uint64Value(&bLossless) == Expected.second) && bLossless, "lossless unsigned machine register");
			}

			CheckRegisterNumber(LocalRegisters, "FPUControlWord", 0x0100);
			CheckRegisterNumber(LocalRegisters, "FPUStatusWord", 0x0302);
			CheckRegisterNumber(LocalRegisters, "FPUTagWord", 0x04);
			CheckRegisterNumber(LocalRegisters, "MXCSR", 0x1B1A'1918);

			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kFPUCount; ++unRegisterIndex) {
				std::string const strExpectedRegisterName = "ST" + std::to_string(unRegisterIndex);
				CheckRegisterBytes(LocalRegisters, strExpectedRegisterName.c_str(), CallResult.m_arrFXState + kFPUOffset + unRegisterIndex * kFPUStride, kFPUValueSize);
			}

			for (std::size_t unRegisterIndex = 0; unRegisterIndex < kXMMCount; ++unRegisterIndex) {
				std::string const strExpectedRegisterName = "XMM" + std::to_string(unRegisterIndex);
				CheckRegisterBytes(LocalRegisters, strExpectedRegisterName.c_str(), CallResult.m_arrFXState + kXMMOffset + unRegisterIndex * kXMMValueSize, kXMMValueSize);
			}

			CheckRegisterBytes(LocalRegisters, "FXState", CallResult.m_arrFXState, sizeof(CallResult.m_arrFXState));

			auto itFXState = LocalRegisters->m_mapValues.find("FXState");
			Check(itFXState != LocalRegisters->m_mapValues.end(), "FXState snapshot present before source mutation");

			auto* const pFXState = dynamic_cast<v8::Uint8Array*>(itFXState->second.operator->());
			Check(pFXState, "FXState snapshot type before source mutation");

			unsigned char const* const pchSnapshotBytes = static_cast<unsigned char const*>(pFXState->Data());
			CallResult.m_arrFXState[0] = 0xFF;
			Check(pchSnapshotBytes != CallResult.m_arrFXState, "snapshot does not borrow native storage");
			Check(pchSnapshotBytes[0] == 0, "snapshot survives source mutation");

			for (std::size_t unPropertyIndex = 0; unPropertyIndex < unPropertyCount; ++unPropertyIndex) {
				Isolate.ResetErrors();
				Isolate.m_nFailSetIndex = static_cast<int>(unPropertyIndex);
				Check(MakeNativeRegisterObject(&Isolate, LocalContext, CallResult).IsEmpty(), "each failed register assignment aborts snapshot");
				Check(Isolate.m_unSetCount == (unPropertyIndex + 1), "no assignment after failure");
			}

			Isolate.ResetErrors();
			Isolate.m_nFailSetIndex = -1;
			Isolate.m_bFailBackingStore = true;
			Check(MakeNativeRegisterObject(&Isolate, LocalContext, CallResult).IsEmpty() && Isolate.HasPendingException(), "failed byte storage aborts register snapshot");
		}

		void CheckInstructionBytes() {
			Check(ConvertFloatToArgumentWord(1.5F) == 0x3FC0'0000, "float argument representation");
			Check(ConvertFloatToArgumentWord(-0.0F) == 0x8000'0000, "negative zero argument representation");

			std::vector<unsigned char> vecCode {};
			AppendU8(vecCode, 0xAA);
			AppendU32LE(vecCode, 0xFEDC'BA98);
			Check(vecCode == std::vector<unsigned char> { 0xAA, 0x98, 0xBA, 0xDC, 0xFE }, "32-bit little-endian append");
#if defined(DETOURS_ARCH_X64)
			vecCode.clear();
			AppendU64LE(vecCode, 0xFEDC'BA98'7654'3210);
			Check(vecCode == std::vector<unsigned char> { 0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE }, "64-bit little-endian append");

			unsigned char unRegisterCode = 0xFF;
			Check(FindX64RegisterCodeByName("RAX", unRegisterCode) && (unRegisterCode == 0), "canonical x64 input register");
			Check(!FindX64RegisterCodeByName("rax", unRegisterCode), "no lowercase x64 alias");
#else
			unsigned char unRegisterOpcode = 0;
			Check(FindX86RegisterOpcodeByName("EAX", unRegisterOpcode) && (unRegisterOpcode == 0xB8), "canonical x86 input register");
			Check(!FindX86RegisterOpcodeByName("eax", unRegisterOpcode), "no lowercase x86 alias");
#endif
		}

		void CheckExecutableStorage() {
			constexpr std::size_t kAllocationSize = 4'096;

			g_unReleaseCount = 0;
			g_unLogCount = 0;
			Check(!AllocateExecutable(0), "reject empty executable allocation");

			g_nAllocationMode = 1;
			Check(!AllocateExecutable(kAllocationSize), "executable allocation failure");
#if !defined(_WIN32)
			g_nAllocationMode = 2;
			Check(!AllocateExecutable(kAllocationSize) && !g_bZeroMapping && (g_unReleaseCount == 1), "release rejected zero-address executable mapping");
			g_bReportReleaseFailure = true;
			Check(!AllocateExecutable(kAllocationSize) && (g_unLogCount == 1) && (g_unLoggedError == EACCES), "immediate rejected-mapping cleanup error");
			g_bReportReleaseFailure = false;
#endif
			g_nAllocationMode = 0;
			void* const pMemory = AllocateExecutable(kAllocationSize);
			Check(pMemory != nullptr, "real executable allocation");
#if defined(_WIN32)
			g_bReportReleaseFailure = true;
			FreeExecutable(pMemory, kAllocationSize);
			g_bReportReleaseFailure = false;
			Check((g_unLogCount == 1) && (g_unLoggedError == ERROR_ACCESS_DENIED), "immediate executable release error");
#else
			Check(munmap(pMemory, kAllocationSize) == 0, "real executable release");
#endif
		}
	} // namespace

	void RunTests() {
		constexpr std::uint64_t kMaximumNativeWord = std::numeric_limits<std::uintptr_t>::max();
		constexpr std::uint64_t kNativeSignMagnitude = std::uint64_t(1) << ((sizeof(std::intptr_t) * 8) - 1);
		constexpr char const* const kNativeCallbackFailureMessage = "native failure";
		constexpr char const* const kJavaScriptCallbackFailureMessage = "original JavaScript failure";
		constexpr char const* const kPendingFailureMessage = "pending failure";
		constexpr char const* const kReadFailureMessage = "memory value conversion failed.";
		constexpr int kNativeCallbackFailure = 1;
		constexpr int kNativeReaderFailure = 7;
		constexpr int kNativeOnlyReaderFailure = 11;

		CheckSDKLookups();

		CheckWord(nullptr, false, 0);
		CheckAddress(nullptr, false, 0);

		for (auto const& dblValue : { 0.0, -0.0, -1.0, -2'147'483'648.0, 2'147'483'647.0, 2'147'483'648.0, 4'294'967'295.0 }) {
			v8::Number Number(dblValue);
			CheckWord(&Number, true, static_cast<std::uintptr_t>(static_cast<std::int64_t>(dblValue)));
			CheckAddress(&Number, false, 0);
		}

		for (auto const& dblValue : { -2'147'483'649.0, 4'294'967'296.0, 1.5, -0.5, std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN(), 1.0e30 }) {
			v8::Number Number(dblValue);
			CheckWord(&Number, false, 0);
		}

		v8::BigInt Zero = v8::BigInt(0, false);
		v8::BigInt Maximum = v8::BigInt(kMaximumNativeWord, false);
		v8::BigInt NegativeOne = v8::BigInt(1, true);
		v8::BigInt Minimum = v8::BigInt(kNativeSignMagnitude, true);
		v8::BigInt BelowMinimum = v8::BigInt(kNativeSignMagnitude + 1, true);
		v8::BigInt Overflow = v8::BigInt(0, false, true);
		v8::BigInt NegativeOverflow = v8::BigInt(0, true, true);
		CheckWord(&Zero, true, 0);
		CheckAddress(&Zero, true, 0);
		CheckWord(&Maximum, true, static_cast<std::uintptr_t>(kMaximumNativeWord));
		CheckAddress(&Maximum, true, static_cast<std::uintptr_t>(kMaximumNativeWord));
		CheckWord(&NegativeOne, true, static_cast<std::uintptr_t>(kMaximumNativeWord));
		CheckAddress(&NegativeOne, false, 0);
		CheckWord(&Minimum, true, static_cast<std::uintptr_t>(kNativeSignMagnitude));
		CheckAddress(&Minimum, false, 0);
		CheckWord(&BelowMinimum, false, 0);
		CheckWord(&Overflow, false, 0);
		CheckAddress(&Overflow, false, 0);
		CheckWord(&NegativeOverflow, false, 0);

		if constexpr (sizeof(std::uintptr_t) < sizeof(std::uint64_t)) {
			v8::BigInt TooWide = v8::BigInt(kMaximumNativeWord + 1, false);
			CheckWord(&TooWide, false, 0);
			CheckAddress(&TooWide, false, 0);
		} else {
			v8::BigInt AboveNative = v8::BigInt(0, false, true);
			CheckWord(&AboveNative, false, 0);
			CheckAddress(&AboveNative, false, 0);
		}

		v8::Isolate Isolate {};
		RunMemoryHookCallback(&Isolate, kNativeCallbackFailureMessage, [] {
		});
		Check(Isolate.m_strError.empty() && !Isolate.m_bPendingException && (Isolate.m_unRethrowCount == 0), "successful callback boundary");
		RunMemoryHookCallback(&Isolate, kNativeCallbackFailureMessage, [&Isolate] {
			ThrowError(&Isolate, kJavaScriptCallbackFailureMessage);
		});
		Check((Isolate.m_strError == kJavaScriptCallbackFailureMessage) && Isolate.m_bPendingException && (Isolate.m_unRethrowCount == 1), "preserve callback JavaScript exception");
		Isolate.ResetErrors();
		RunMemoryHookCallback(&Isolate, kNativeCallbackFailureMessage, [] {
			throw kNativeCallbackFailure;
		});
		Check((Isolate.m_strError == kNativeCallbackFailureMessage) && Isolate.m_bPendingException && (Isolate.m_unRethrowCount == 1), "translate native callback exception");
		Isolate.ResetErrors();
		RunMemoryHookCallback(&Isolate, kNativeCallbackFailureMessage, [&Isolate] {
			ThrowError(&Isolate, kJavaScriptCallbackFailureMessage);
			throw kNativeCallbackFailure;
		});
		Check((Isolate.m_strError == kJavaScriptCallbackFailureMessage) && (Isolate.m_unRethrowCount == 1), "do not replace JavaScript error during native unwinding");
		Isolate.ResetErrors();
		Isolate.m_bTerminating = true;
		RunMemoryHookCallback(&Isolate, kNativeCallbackFailureMessage, [] {
			throw kNativeCallbackFailure;
		});
		Check(Isolate.m_bTerminating && Isolate.m_strError.empty() && (Isolate.m_unRethrowCount == 0), "do not replace termination");
		Isolate.ResetErrors();
		Isolate.m_bPendingException = true;
		Isolate.m_strError = kPendingFailureMessage;
		RunMemoryHookCallback(&Isolate, kNativeCallbackFailureMessage, [] {
			throw kNativeCallbackFailure;
		});
		Check((Isolate.m_strError == kPendingFailureMessage) && Isolate.m_bPendingException && (Isolate.m_unRethrowCount == 0), "do not replace an uncaught pending exception");
		Isolate.ResetErrors();

		auto SuccessfulReader = [] {
			return true;
		};
		auto FailedReader = [] {
			return false;
		};

		Check(ReadMemoryHookValue(&Isolate, SuccessfulReader), "successful value reader");
		Check(!ReadMemoryHookValue(&Isolate, FailedReader), "explicit reader failure");
		Check((Isolate.m_strError == kReadFailureMessage) && (Isolate.m_unRethrowCount == 1), "reader diagnoses failure without an existing exception");
		Isolate.ResetErrors();
		Check(!ReadMemoryHookValue(&Isolate, [&Isolate] {
			ThrowError(&Isolate, kJavaScriptCallbackFailureMessage);
			// A caught exception need not remain visible through HasPendingException().
			Isolate.m_bPendingException = false;

			return true;
		}), "caught JavaScript exception stops successful reader");
		Check((Isolate.m_strError == kJavaScriptCallbackFailureMessage) && Isolate.m_bPendingException && (Isolate.m_unRethrowCount == 1), "reader preserves caught JavaScript exception");
		Isolate.ResetErrors();
		bool bNativeReaderFailure = false;
		try {
			ReadMemoryHookValue(&Isolate, [&Isolate]() -> bool {
				ThrowError(&Isolate, kJavaScriptCallbackFailureMessage);
				throw kNativeReaderFailure;
			});
		} catch (const int nFailure) {
			bNativeReaderFailure = nFailure == kNativeReaderFailure;
		}

		Check(bNativeReaderFailure && (Isolate.m_strError == kJavaScriptCallbackFailureMessage) && (Isolate.m_unRethrowCount == 1), "reader preserves JavaScript failure during C++ unwinding");
		Isolate.ResetErrors();
		try {
			ReadMemoryHookValue(&Isolate, []() -> bool {
				throw kNativeOnlyReaderFailure;
			});
			Check(false, "native reader exception cannot be swallowed");
		} catch (const int nFailure) {
			Check(nFailure == kNativeOnlyReaderFailure, "native reader exception identity");
		}

		Check(Isolate.m_strError.empty() && (Isolate.m_unRethrowCount == 0), "reader does not invent JavaScript error for C++ failure");
		Isolate.m_bTerminating = true;
		Check(!ReadMemoryHookValue(&Isolate, SuccessfulReader), "reader stops execution termination");
		Isolate.ResetErrors();
		Isolate.m_bPendingException = true;
		Isolate.m_strError = kPendingFailureMessage;
		Check(!ReadMemoryHookValue(&Isolate, SuccessfulReader), "reader stops uncaught pending exception");
		Check((Isolate.m_strError == kPendingFailureMessage) && (Isolate.m_unRethrowCount == 0), "reader preserves pending exception");
		Isolate.ResetErrors();

		unsigned char const arrBytes[] = { 0x00, 0x7F, 0xFF };
		v8::Local<v8::Uint8Array> const LocalBytes = MakeByteArray(&Isolate, arrBytes, sizeof(arrBytes));
		Check(!LocalBytes.IsEmpty() && (LocalBytes->ByteLength() == sizeof(arrBytes)), "byte array length");
		Check(std::memcmp(LocalBytes->Data(), arrBytes, sizeof(arrBytes)) == 0, "complete byte copy");
		Check(Isolate.m_bRecoverableAllocation, "explicit recoverable backing-store allocation");
		v8::Local<v8::Uint8Array> const LocalEmptyBytes = MakeByteArray(&Isolate, nullptr, 0);
		Check(!LocalEmptyBytes.IsEmpty() && (LocalEmptyBytes->ByteLength() == 0), "empty bytes do not copy from a null address");
		Isolate.ResetErrors();
		Check(MakeByteArray(&Isolate, nullptr, 1).IsEmpty() && !Isolate.m_strError.empty(), "reject null nonempty byte range");
		Isolate.ResetErrors();
		Isolate.m_bFailBackingStore = true;
		Check(MakeByteArray(&Isolate, arrBytes, sizeof(arrBytes)).IsEmpty() && !Isolate.m_strError.empty(), "backing-store allocation failure");
		Isolate.m_bFailBackingStore = false;
		Isolate.ResetErrors();
		Isolate.m_bNullBackingData = true;
		Check(MakeByteArray(&Isolate, arrBytes, sizeof(arrBytes)).IsEmpty() && !Isolate.m_strError.empty(), "missing backing data");
		Isolate.m_bNullBackingData = false;
		Isolate.ResetErrors();

		v8::Text EmbeddedNUL = v8::Text(std::string("a\0b", 3), false);
		v8::Text EmptyText = v8::Text("", false);
		v8::Text FailedText = v8::Text("ignored", true);
		CheckWord(&EmbeddedNUL, false, 0);
		CheckAddress(&EmbeddedNUL, false, 0);
		std::string strReadValue = "unchanged";
		Check(ReadStringFromValue(&Isolate, v8::Local<v8::Value>(&EmbeddedNUL), strReadValue) && (strReadValue == std::string("a\0b", 3)), "string reader preserves complete UTF8 byte range");
		Check(ReadStringFromValue(&Isolate, v8::Local<v8::Value>(&EmptyText), strReadValue) && strReadValue.empty(), "string reader accepts empty string");
		strReadValue = "unchanged";
		Check(!ReadStringFromValue(&Isolate, v8::Local<v8::Value>(&FailedText), strReadValue) && (strReadValue == "unchanged"), "failed string conversion does not commit output");
		Check((Isolate.m_strError == kReadFailureMessage) && (Isolate.m_unRethrowCount == 1), "failed UTF8 conversion has an explicit error");
		Isolate.ResetErrors();
		Check(!ReadStringFromValue(nullptr, v8::Local<v8::Value>(&EmbeddedNUL), strReadValue) && (strReadValue == "unchanged"), "string reader rejects null isolate");
		Check(!ReadStringFromValue(&Isolate, {}, strReadValue) && (strReadValue == "unchanged"), "string reader rejects empty value");
		Isolate.m_bTerminating = true;
		Check(!ReadStringFromValue(&Isolate, v8::Local<v8::Value>(&EmbeddedNUL), strReadValue) && (strReadValue == "unchanged"), "terminated string reader does not commit output");
		Isolate.ResetErrors();
		Isolate.m_bPendingException = true;
		Check(!ReadStringFromValue(&Isolate, v8::Local<v8::Value>(&EmbeddedNUL), strReadValue) && (strReadValue == "unchanged"), "pending string reader does not commit output");
		Isolate.ResetErrors();

		{
			NativeCallStackStorage Storage {};
			CheckEmptyStorage(Storage);
		}

		Check(g_unReleaseCount == 0, "empty destructor");

		{
			NativeCallStackStorage Storage {};
			for (auto const& nPageMode : { 1, 2 }) {
				g_nPageMode = nPageMode;
				Check(!Storage.Allocate(), "page-size failure");
				CheckEmptyStorage(Storage);
			}

			g_nPageMode = 0;
			g_nAllocationMode = 1;
			Check(!Storage.Allocate(), "mapping failure");
			CheckEmptyStorage(Storage);
			g_nAllocationMode = 0;
			Check(Storage.Allocate(), "retry after failed mapping");
			Check(Storage.GetAddress() && (Storage.GetSize() > 0), "owned mapping");
			Storage.GetAddress()[0] = 0xA5;
			Storage.GetAddress()[Storage.GetSize() - 1] = 0x5A;
			Check((Storage.GetAddress()[0] == 0xA5) && (Storage.GetAddress()[Storage.GetSize() - 1] == 0x5A), "complete writable page");
			Check(!Storage.Allocate(), "reject double allocation");
		}

		Check(g_unReleaseCount == 1, "exactly one release");
		Check(g_unLogCount == 0, "no spurious cleanup error");

		{
			NativeCallStackStorage Storage {};
			Check(Storage.Allocate(), "cleanup diagnostic mapping");
			g_bReportReleaseFailure = true;
		}

		g_bReportReleaseFailure = false;
		Check(g_unReleaseCount == 2, "failed-release report still attempts cleanup once");
		Check(g_unLogCount == 1, "cleanup failure diagnostic");
#if defined(_WIN32)
		Check(g_unLoggedError == ERROR_ACCESS_DENIED, "immediate Windows error capture");
#else
		Check(g_unLoggedError == EACCES, "immediate errno capture");

		{
			NativeCallStackStorage Storage {};
			g_nAllocationMode = 2;
			Check(!Storage.Allocate(), "zero-address mapping rejected");
			CheckEmptyStorage(Storage);
			Check(!g_bZeroMapping && (g_unReleaseCount == 3), "zero-address mapping released");
			g_nAllocationMode = 0;
			Check(Storage.Allocate(), "retry after zero mapping");
		}

		Check(g_unReleaseCount == 4, "zero mapping does not leak");
#endif

		CheckRegisterSnapshots();
		CheckInstructionBytes();
		CheckExecutableStorage();
		CheckNativeCallContexts();
		CheckCapturedNativeResults();
#if defined(DETOURS_ARCH_X86)
		CheckX87Conversions();
#endif
	}
} // namespace SourceJS

#if defined(SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_DETOURS_ARCH_X64)
#undef DETOURS_ARCH_X64
#undef SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_DETOURS_ARCH_X64
#endif
#if defined(SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_DETOURS_ARCH_X86)
#undef DETOURS_ARCH_X86
#undef SOURCEJS_MEMORY_HOOK_VALUE_FIXTURE_OWNS_DETOURS_ARCH_X86
#endif

int main(const int nArgumentCount, char**) {
	constexpr int kInvalidArgumentsExitCode = 2;

	if (nArgumentCount != 1) {
		std::fprintf(stderr, "Usage: MemoryHookValueContracts\n");
		return kInvalidArgumentsExitCode;
	}

	SourceJS::RunTests();
	std::puts("MEMORY_HOOK_VALUE_NATIVE_PASS");

	return EXIT_SUCCESS;
}
`;

function GetDefinition(strName, strIndentation = "\t\t", strSource = g_strSource) {
	const nStart = strSource.search(new RegExp("^" + strIndentation + "(?:bool|double|int|DATA_TYPE|void\\*?|(?:edict_t|CBaseEntity)\\*|std::(?:string|uintptr_t|uint16_t|uint32_t)|v8::Local<v8::(?:Uint8Array|Object|String|Value)>) (?:(?:__fastcall|__cdecl) )?" + strName + "\\(", "m"));
	g_Assert(nStart >= 0, "Missing definition: " + strName);

	const strEnd = "\n" + strIndentation + "}";
	const nEnd = strSource.indexOf(strEnd, nStart);
	g_Assert(nEnd > nStart);

	let nDefinitionStart = nStart;
	if (["ReadUnsignedShort", "ReadUnsignedInteger"].includes(strName)) {
		const strTemplate = strIndentation + "template <std::size_t unOffset, std::size_t unByteCount>\n";
		nDefinitionStart -= strTemplate.length;
		g_Assert.equal(strSource.slice(nDefinitionStart, nStart), strTemplate, "Actual fixed-width reader template declaration");
	}

	return strSource.slice(nDefinitionStart, nEnd + strEnd.length);
}

// Source guards cover wiring, not execution of the full SDK/V8 callback bodies.
function CheckSourceContracts(strSource) {
	for (const strName of ["SetHookReturnValueCallback", "CallHookTrampolineCallback", "SetHookArgumentCallback"]) {
		const strDefinition = GetDefinition(strName, "\t\t", strSource);
		g_Assert(strDefinition.includes("RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments, pIsolate] {"), strName + ": shared preserving failure boundary");
	}

	for (const strName of ["AddHookObjectPreCallback", "AddHookObjectPostCallback", "RemoveHookObjectPreCallback", "RemoveHookObjectPostCallback", "RemoveHookObjectCallback"]) {
		g_Assert(GetDefinition(strName, "\t\t", strSource).includes("RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments] {"), strName + ": preserving exception boundary");
	}

	const strInitialize = GetDefinition("MemoryHookManager::Initialize", "\t", strSource);
	g_Assert(strInitialize.includes('if (!pPostThunk) {\n\t\t\tLogError("MemoryHookManager::Initialize failed to create the post-hook thunk.");\n\t\t\treturn;\n\t\t}'));
	g_Assert(strInitialize.indexOf("if (!pPostThunk)") < strInitialize.indexOf("m_pPostThunk = pPostThunk;"), "failed post thunk cannot initialize manager");

	const strCreate = GetDefinition("MemoryHookManager::CreateFunction", "\t", strSource);
	g_Assert(strCreate.includes("if (nHookID <= 0)"));
	g_Assert(strCreate.includes("m_nNextHookID = (nHookID < std::numeric_limits<int>::max()) ? (nHookID + 1) : 0;"));

	const nSignature = strCreate.indexOf("HookSignature = BuildSignature(pIsolate, LocalContext, LocalOptions);");
	const nThunk = strCreate.indexOf("CreateThunk(nHookID, unThunkSize, unDispatchAddress)");
	g_Assert((nSignature >= 0) && (nSignature < nThunk) && (nThunk < strCreate.indexOf("pHook->Hook(")), "validate signature before allocating/installing hook");
	g_Assert(strCreate.includes("if (SignatureFailure.HasCaught()) {\n\t\t\t\tSignatureFailure.ReThrow();\n\t\t\t\treturn 0;\n\t\t\t}"));
	g_Assert(strCreate.includes("if (pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\treturn 0;\n\t\t\t}"));
	g_Assert(strCreate.includes("pHookRecord->m_Signature = std::move(HookSignature);"));

	const strTrampoline = GetDefinition("CallHookTrampolineCallback", "\t\t", strSource);
	for (const strProperty of ["Arguments", "Registers", "CallerCleanup"]) {
		const strGuard = 'if (!GetValue(pIsolate, LocalContext, LocalUserOptions, "' + strProperty + '", LocalValue)) {\n\t\t\t\t\t\treturn;\n\t\t\t\t\t}';
		const nGuard = strTrampoline.indexOf(strGuard);
		g_Assert((nGuard >= 0) && (nGuard < strTrampoline.indexOf("->CallFunction(")), strProperty + ": stop failed getter before invocation");
	}

	g_Assert(strTrampoline.includes("CallFunction(pIsolate, LocalContext, LocalOptions, &pCallContext->m_bSkipOriginal)"));
	const nInvocation = strSource.indexOf("Detours::Hook::CallAddress(CallRequest.m_pAddress, &RawContext);");
	g_Assert(nInvocation >= 0);
	g_Assert(/CallAddress\(CallRequest\.m_pAddress, &RawContext\);\n\t\t\/\/[^\n]+\n\t\tif \(pbNativeCallCompletedOut\) \{\n\t\t\t\*pbNativeCallCompletedOut = true;\n\t\t\}/.test(strSource.slice(nInvocation, nInvocation + 400)), "record completed invocation before further fallible work");
	g_Assert(!strSource.includes("*pbNativeCallCompletedOut = false"), "completion output must be sticky");

	const strArgument = GetDefinition("SetHookArgumentCallback", "\t\t", strSource);
	g_Assert(strArgument.includes("if (!Arguments[kIndexArgumentIndex]->IsInt32())"));
	g_Assert(strArgument.indexOf("->IsInt32()") < strArgument.indexOf("->SetArgumentFromValue("));

	const strByteArray = GetDefinition("MakeByteArray", "\t\t", strSource);
	g_Assert(strByteArray.includes("v8::BackingStoreOnFailureMode::kReturnNull"));
	g_Assert(strByteArray.includes("if ((unSize > 0) && !pchBytes)"));
	g_Assert(strByteArray.includes("if (!pBackingStore || ((unSize > 0) && !pBackingStore->Data()))"));
	g_Assert(strByteArray.includes("if (unSize > 0) {\n\t\t\t\tstd::memcpy(pBackingStore->Data(), pchBytes, unSize);"));

	const strMakeString = GetDefinition("MakeString", "\t\t", strSource);
	g_Assert(GetDefinition("ReadNumberFromValue", "\t\t", strSource).includes("if (!pIsolate || LocalContext.IsEmpty() || LocalValue.IsEmpty()) {\n\t\t\t\treturn false;"), "invalid native handles must stop before numeric conversion");
	g_Assert(strMakeString.includes("if (!MaybeLocalString.ToLocal(&LocalString)) {\n\t\t\t\treturn {};"), "string allocation failure must return an empty handle");
	g_Assert(!strMakeString.includes("ToLocalChecked"), "failed string allocation cannot terminate through a checked handle conversion");

	const strGetValue = GetDefinition("GetValue", "\t\t", strSource);
	g_Assert(strGetValue.includes("if (LocalPropertyName.IsEmpty()) {\n\t\t\t\treturn false;"), "failed key allocation stops the property read");
	g_Assert(strGetValue.includes("if (!LocalObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalValue)) {\n\t\t\t\treturn false;"), "failed property read stops before output commit");
	g_Assert(strGetValue.indexOf("LocalValueOut = LocalValue;") > strGetValue.indexOf("->Get(LocalContext, LocalPropertyName).ToLocal(&LocalValue)"), "property output commits after a successful read");

	const strSetValue = GetDefinition("SetValue", "\t\t", strSource);
	g_Assert(strSetValue.includes("if (LocalContext.IsEmpty() || LocalObject.IsEmpty() || LocalValue.IsEmpty())"));
	g_Assert(strSetValue.includes("if (LocalPropertyName.IsEmpty()) {\n\t\t\t\treturn false;"), "failed key allocation stops the property write");

	const strPostHook = GetDefinition("MemoryHookManager::HandlePostHook", "\t", strSource);
	const strPostCallbacks = GetDefinition("MemoryHookManager::RunPostCallbacks", "\t", strSource);
	g_Assert(strPostCallbacks.includes("if (LocalArgument.IsEmpty() || !LocalHookArguments->Set(LocalContext, unV8ArgumentIndex, LocalArgument).FromMaybe(false))"), "empty converted arguments cannot reach the V8 array setter");

	const strHandleHook = GetDefinition("MemoryHookManager::HandleHook", "\t", strSource);
	g_Assert.equal(strHandleHook.split("if (LocalArgumentValue.IsEmpty() || !LocalHookArguments->Set(LocalContext, unV8ArgumentIndex, LocalArgumentValue).FromMaybe(false))").length, 3, "both pre and skipped-original post payloads reject empty argument handles");
	g_Assert(strPostHook.includes("std::is_nothrow_move_constructible_v<MemoryHookPostFrame>"));
	g_Assert(strPostHook.includes("MemoryHookPostFrame const PostFrame = std::move(itPostFrame->second);"));
	g_Assert(strPostHook.includes("try {\n\t\t\t\t\tRunPostCallbacks(*pHookRecord, PostFrame, pPostContext);\n\t\t\t\t} catch (...) {"));
	g_Assert(strPostHook.endsWith("return PostFrame.m_pReturnAddress;\n\t}"));

	const strDispatch = GetDefinition("DispatchSourceJSRawHook", "\t\t", strSource);
	g_Assert(strDispatch.includes("noexcept {"));
	g_Assert(strDispatch.includes("} catch (...) {\n\t\t\t\tLogError(\"Memory hook dispatch failed Hook=%d\", nHookID);\n\t\t\t\treturn false;"));

	const strCall = GetDefinition("MemoryHookManager::CallFunction", "\t", strSource);
	const strInvocationGuard = "\t\tif (!m_bInitialized || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\treturn v8::Null(pIsolate);\n\t\t}";
	const nInvocationGuard = strCall.indexOf(strInvocationGuard);
	const nLastReader = strCall.indexOf("CallRequest.m_mapRegisters[strRegisterName] = unRegisterValue;");
	const nPreparation = strCall.indexOf("NATIVE_CALL_RESULT CallResult {};");
	g_Assert((nLastReader >= 0) && (nInvocationGuard > nLastReader) && (nInvocationGuard < nPreparation), "revalidate manager and JavaScript state after all readers, before native preparation");
	g_Assert(strCall.includes("if (LocalReturnValue.IsEmpty()) {\n\t\t\treturn {};\n\t\t}"), "failed return conversion stops before result-context packaging");
	for (const strGuard of g_vecCallParserGuards) {
		g_Assert(strCall.includes(strGuard), "typed argument parser guard: " + strGuard);
	}

	g_Assert(GetDefinition("MemoryHookManager::ReadDataType", "\t", strSource).includes("if (!ReadStringFromValue(pIsolate, LocalValue, strDataType))"), "data type reader preserves failed string conversion");
	g_Assert(!strCall.includes("ConvertValueToString("), "call parser uses checked string conversion");
	for (const strReader of [
		"if (!ReadStringFromValue(pIsolate, LocalConvention, strConvention))",
		"if (!ReadStringFromValue(pIsolate, LocalRegisterKey, strRegisterName))",
		"if (!ReadStringFromValue(pIsolate, LocalValue, strArgument))",
		"if (!ReadMemoryHookValue(pIsolate, [this, pIsolate, LocalReturnType, &CallRequest] {",
		"if (!ReadMemoryHookValue(pIsolate, [this, pIsolate, LocalArgumentType, &ArgumentType] {",
		...["LocalStringArgument", "LocalTypedArgument", "LocalArgumentValue"].map(strValue => "if (!AppendStringArgument(" + strValue + "))"),
	]) {
		g_Assert(strCall.includes(strReader), "checked call reader: " + strReader);
	}

	const nRegisterGet = strCall.indexOf("if (!LocalRegisterObject->Get(LocalContext, LocalRegisterKey).ToLocal(&LocalRegisterValue))");
	for (const strFilter of [
		"if (!FindX64RegisterCodeByName(strRegisterName, unRegisterCode) || (unRegisterCode == kStackRegisterCode))",
		"if (!FindX86RegisterOpcodeByName(strRegisterName, unRegisterOpcode) || (unRegisterOpcode == kStackRegisterOpcode))",
	]) {
		const nFilter = strCall.indexOf(strFilter + " {\n\t\t\t\t\tcontinue;\n\t\t\t\t}");
		g_Assert((nFilter >= 0) && (nFilter < nRegisterGet), "filter unsupported/stack registers before getter: " + strFilter);
	}
}

function ReplaceOnce(strSource, strOld, strNew) {
	g_Assert.equal(strSource.split(strOld).length, 2, "Unique insertion/mutation target: " + strOld);

	return strSource.replace(strOld, () => strNew);
}

function CheckSourceRegressions() {
	const vecPatterns = [
		"RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments, pIsolate] {",
		...["Arguments", "Registers", "CallerCleanup"].map(strProperty => 'if (!GetValue(pIsolate, LocalContext, LocalUserOptions, "' + strProperty + '", LocalValue)) {'),
		"CallFunction(pIsolate, LocalContext, LocalOptions, &pCallContext->m_bSkipOriginal)",
		"*pbNativeCallCompletedOut = true;",
		"if (!Arguments[kIndexArgumentIndex]->IsInt32())",
		"if (LocalContext.IsEmpty() || LocalObject.IsEmpty() || LocalValue.IsEmpty())",
		"if (!MaybeLocalString.ToLocal(&LocalString))",
		"if (!pIsolate || LocalContext.IsEmpty() || LocalValue.IsEmpty())",
		"if (LocalReturnValue.IsEmpty())",
		"if (LocalArgument.IsEmpty() || !LocalHookArguments->Set(LocalContext, unV8ArgumentIndex, LocalArgument).FromMaybe(false))",
		"\t\t\t\t\tif (LocalArgumentValue.IsEmpty() || !LocalHookArguments->Set(LocalContext, unV8ArgumentIndex, LocalArgumentValue).FromMaybe(false))",
		"\t\t\t\t\t\t\tif (LocalArgumentValue.IsEmpty() || !LocalHookArguments->Set(LocalContext, unV8ArgumentIndex, LocalArgumentValue).FromMaybe(false))",
		"MemoryHookPostFrame const PostFrame = std::move(itPostFrame->second);",
		"RunPostCallbacks(*pHookRecord, PostFrame, pPostContext);",
		"LogError(\"Memory hook dispatch failed Hook=%d\", nHookID);",
		"if (!ReadStringFromValue(pIsolate, LocalRegisterKey, strRegisterName))",
		"if (!ReadStringFromValue(pIsolate, LocalConvention, strConvention))",
		"if (!ReadStringFromValue(pIsolate, LocalValue, strArgument))",
		"if (!ReadStringFromValue(pIsolate, LocalValue, strDataType))",
		"if (!ReadMemoryHookValue(pIsolate, [this, pIsolate, LocalReturnType, &CallRequest] {",
		"if (!ReadMemoryHookValue(pIsolate, [this, pIsolate, LocalArgumentType, &ArgumentType] {",
		...["LocalStringArgument", "LocalTypedArgument", "LocalArgumentValue"].map(strValue => "if (!AppendStringArgument(" + strValue + "))"),
		"if (!FindX64RegisterCodeByName(strRegisterName, unRegisterCode) || (unRegisterCode == kStackRegisterCode))",
		"if (!FindX86RegisterOpcodeByName(strRegisterName, unRegisterOpcode) || (unRegisterOpcode == kStackRegisterOpcode))",
		"if (!pPostThunk) {\n\t\t\tLogError(",
		"if (nHookID <= 0)",
		"m_nNextHookID = (nHookID < std::numeric_limits<int>::max()) ? (nHookID + 1) : 0;",
		"HookSignature = BuildSignature(pIsolate, LocalContext, LocalOptions);",
		"SignatureFailure.ReThrow();",
	];
	const vecObjectCallbacks = ["AddHookObjectPreCallback", "AddHookObjectPostCallback", "RemoveHookObjectPreCallback", "RemoveHookObjectPostCallback", "RemoveHookObjectCallback"];

	CheckSourceContracts(g_strSource);

	const strCall = GetDefinition("MemoryHookManager::CallFunction", "\t", g_strSource);
	const strInvocationGuard = "\t\tif (!m_bInitialized || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\treturn v8::Null(pIsolate);\n\t\t}";
	const vecCallStateMutations = [
		...["!m_bInitialized", "pIsolate->IsExecutionTerminating()", "pIsolate->HasPendingException()"].map(strCondition => ({ Name: strCondition, Source: ReplaceOnce(strCall, strInvocationGuard, ReplaceOnce(strInvocationGuard, strCondition, "false")) })),
		{ Name: "MissingInvocationGuard", Source: ReplaceOnce(strCall, strInvocationGuard, "") },
		...[
			{ Name: "BeforeFinalReaders", Anchor: "\t\tv8::Local<v8::Value> LocalRegisters {};" },
			{ Name: "AfterNativePreparation", Anchor: "\t\tDetours::Hook::CallAddress(CallRequest.m_pAddress, &RawContext);" },
		].map(Placement => ({ Name: Placement.Name, Source: ReplaceOnce(ReplaceOnce(strCall, strInvocationGuard, ""), Placement.Anchor, strInvocationGuard + "\n\n" + Placement.Anchor) })),
	];
	for (const Mutation of vecCallStateMutations) {
		g_Assert.throws(() => CheckSourceContracts(ReplaceOnce(g_strSource, strCall, Mutation.Source)), g_Assert.AssertionError, "Call state source-only regression must be rejected: " + Mutation.Name);
	}

	for (const strGuard of g_vecCallParserGuards) {
		const strMutatedCall = ReplaceOnce(strCall, strGuard, "REMOVED_SOURCE_REGRESSION_TARGET");
		g_Assert.throws(() => CheckSourceContracts(ReplaceOnce(g_strSource, strCall, strMutatedCall)), g_Assert.AssertionError, "Call parser regression must be rejected: " + strGuard);
	}

	for (const strPattern of vecPatterns) {
		g_Assert(g_strSource.includes(strPattern), "Missing source regression target: " + strPattern);
		g_Assert.throws(() => CheckSourceContracts(g_strSource.replace(strPattern, "REMOVED_SOURCE_REGRESSION_TARGET")), g_Assert.AssertionError, "Source regression must be rejected: " + strPattern);
	}

	for (const strName of vecObjectCallbacks) {
		const strDefinition = GetDefinition(strName);
		const strMutation = ReplaceOnce(strDefinition, "RunMemoryHookCallback(pIsolate, kCallbackFailureMessage, [&Arguments] {", "REMOVED_SOURCE_REGRESSION_TARGET");
		g_Assert.throws(() => CheckSourceContracts(ReplaceOnce(g_strSource, strDefinition, strMutation)), g_Assert.AssertionError, strName + ": boundary source mutation must fail");
	}

	process.stdout.write("Memory hook wiring source guards passed; " + (vecPatterns.length + vecObjectCallbacks.length + g_vecCallParserGuards.length + vecCallStateMutations.length) + " source-only mutations rejected.\n");
}

function MakeFixture() {
	const strDetoursHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "thirdparty/Detours/Detours.h"), "utf8");
	const vecStackLimit = strDetoursHeader.match(/^#define HOOK_RAW_CALL_MAXIMUM_STACK_SIZE [^\r\n]+/gm);
	g_Assert.equal(vecStackLimit?.length, 1, "Unique actual Detours stack limit");

	const nArgumentStart = g_strSource.indexOf("\t\tenum class NativeCallArgumentKind : unsigned char {");
	const nArgumentEnd = g_strSource.indexOf("\t\tstruct NativeCallRequest {", nArgumentStart);
	g_Assert((nArgumentStart >= 0) && (nArgumentEnd > nArgumentStart));

	const nStackStart = g_strSource.indexOf("\t\tclass NativeCallStackStorage {");
	const nStackEnd = g_strSource.indexOf("\t\tv8::Local<v8::String> MakeString(", nStackStart);
	g_Assert((nStackStart >= 0) && (nStackEnd > nStackStart));

	const nRecordStart = g_strSource.indexOf("\t\ttypedef struct alignas(kNativeCallResultAlignment) _NATIVE_CALL_RESULT {");
	const nRecordEnd = g_strSource.indexOf("\t\tMemoryHookCallContext::MemoryHookCallContext()", nRecordStart);
	g_Assert((nRecordStart >= 0) && (nRecordEnd > nRecordStart));

	const vecConstants = ["kNativeCallResultAlignment", "kFXStateSize", "kFXStateControlWordOffset", "kFXStateStatusWordOffset", "kFXStateTagWordOffset", "kFXStateMXCSROffset", "kFXStateRegisterOffset", "kFXStateRegisterSize", "kFXStateRegisterValueSize", "kFXStateXMMOffset", "kFXStateXMMSize"].map(strName => {
		const vecMatches = g_strSource.match(new RegExp("^\\t\\tconstexpr std::size_t " + strName + " = [^\\n]+;", "m"));
		g_Assert(vecMatches, "Missing record constant: " + strName);

		return vecMatches[0];
	});
	const vecX87Constants = ["kX87StateByteCount", "kX87StateAlignment"].map(strName => {
		const vecMatches = g_strSource.match(new RegExp("^\\t\\tconstexpr std::size_t " + strName + " = [^\\n]+;", "m"));
		g_Assert(vecMatches, "Missing x87 constant: " + strName);

		return vecMatches[0];
	});
	const strX87Helpers = "#if defined(DETOURS_ARCH_X86)\n" + vecX87Constants.join("\n") + "\n\n" + GetDefinition("ReadX87ValueAsDouble") + "\n\n" + GetDefinition("WriteX87ValueFromDouble") + "\n#endif";

	const vecInsertions = [
		["@RAW_STACK_LIMIT@", vecStackLimit[0]],
		["@ARGUMENT_RECORDS@", g_strSource.slice(nArgumentStart, nArgumentEnd)],
		["@CAPTURE_HELPERS@", strX87Helpers + "\n\n" + GetDefinition("CaptureNativeCallResult")],
		["@STACK_STORAGE@", g_strSource.slice(nStackStart, nStackEnd)],
		["@EXECUTABLE_HELPERS@", GetDefinition("AllocateExecutable") + "\n\n#if defined(_WIN32)\n" + GetDefinition("FreeExecutable") + "\n#endif"],
		["@RESULT_RECORD@", vecConstants.join("\n") + "\n\n" + g_strSource.slice(nRecordStart, nRecordEnd)],
		["@READERS@", "\t\ttemplate <typename TCallback>\n" + GetDefinition("RunMemoryHookCallback") + "\n\n\t\ttemplate <typename TReader>\n" + GetDefinition("ReadMemoryHookValue") + "\n\n" + ["FindEdictByIndex", "FindBaseEntityByIndex", "ReadStringFromValue", "ReadAddressFromValue", "ReadIntegerWordFromValue", "MakeByteArray", "MakeMachineWord", "ReadUnsignedShort", "ReadUnsignedInteger", "MakeNativeRegisterObject", "ConvertFloatToArgumentWord", "AppendU8", "AppendU32LE"].map(strName => GetDefinition(strName)).join("\n\n") + "\n\n#if defined(DETOURS_ARCH_X64)\n" + GetDefinition("FindX64RegisterCodeByName") + "\n\n" + GetDefinition("IsFloatingPointArgument") + "\n\n" + GetDefinition("AppendU64LE") + "\n#else\n" + GetDefinition("FindX86RegisterOpcodeByName") + "\n#endif\n\n" + GetDefinition("ConfigureNativeCallContext")],
	];
	let strFixture = g_strFixture;
	for (const arrInsertion of vecInsertions) {
		strFixture = ReplaceOnce(strFixture, arrInsertion[0], arrInsertion[1]);
	}

	g_Assert(!/@[A-Z_]+@/.test(strFixture), "All native fixture insertion points resolved");

	return strFixture;
}

function Run(strCommand, vecArguments) {
	const unMaximumOutputBytes = 16 * 1024 * 1024;

	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", timeout: g_unCommandTimeoutMilliseconds, maxBuffer: unMaximumOutputBytes, windowsHide: true });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Unexpected native process signal: " + Result.signal);

	return Result;
}

function RequireSuccess(strCommand, vecArguments) {
	const Result = Run(strCommand, vecArguments);
	g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "Native fixture warning:\n" + Result.stdout + Result.stderr);

	return Result;
}

function RemoveFixture(strDirectory, strBuildRoot) {
	const strResolved = g_FileSystem.realpathSync(strDirectory);
	const strRelative = g_Path.relative(strBuildRoot, strResolved);
	g_Assert.equal(strResolved, g_Path.resolve(strDirectory));
	g_Assert(!g_FileSystem.lstatSync(strDirectory).isSymbolicLink());
	g_Assert(strRelative.startsWith("NativeMemoryHookValues-") && (strRelative.length > "NativeMemoryHookValues-".length) && !strRelative.includes(g_Path.sep) && !g_Path.isAbsolute(strRelative));
	g_FileSystem.rmSync(strResolved, { recursive: true });
}

function VerifyFixtureCLI(strExecutable) {
	const Result = Run(strExecutable, ["--invalid"]);
	g_Assert.equal(Result.status, 2, Result.stdout + Result.stderr);
	g_Assert.equal(Result.stdout, "");
	g_Assert(Result.stderr.startsWith("Usage: MemoryHookValueContracts"), Result.stderr);
}

CheckSourceRegressions();

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryHookValues-"));
try {
	const strFixture = MakeFixture();
	const vecRejectedReads = [];
	for (const Reader of [{ Name: "ReadUnsignedShort", ByteCount: 2 }, { Name: "ReadUnsignedInteger", ByteCount: 4 }]) {
		for (const Boundary of [{ Name: "TooSmall", ByteCount: Reader.ByteCount - 1, Offset: 0 }, { Name: "OffsetBeyondEnd", ByteCount: Reader.ByteCount, Offset: Reader.ByteCount + 1 }, { Name: "TruncatedTail", ByteCount: Reader.ByteCount, Offset: 1 }]) {
			vecRejectedReads.push({ Name: Reader.Name + Boundary.Name, Reader: Reader.Name, ByteCount: Boundary.ByteCount, Offset: Boundary.Offset });
		}
	}

	const strWordReaders = "\n// C++\n#include <cstddef>\n#include <cstdint>\n#include <cstring>\n\n// Generated only: negative compile-only reader range fixture; never executed.\nnamespace SourceJS {\n\tnamespace {\n" + GetDefinition("ReadUnsignedShort") + "\n\n" + GetDefinition("ReadUnsignedInteger") + "\n\t} // namespace\n} // namespace SourceJS\n";
	let strCMake = '# Generated only: native memory-hook value regression build.\ncmake_minimum_required(VERSION 3.20)\nproject(MemoryHookValues LANGUAGES CXX)\nadd_executable(MemoryHookValues Fixture.cpp)\ntarget_compile_features(MemoryHookValues PRIVATE cxx_std_20)\nif(MSVC)\n\ttarget_compile_options(MemoryHookValues PRIVATE /W4 /WX /permissive-)\nelse()\n\ttarget_compile_options(MemoryHookValues PRIVATE -Wall -Wextra -Werror -pedantic)\nendif()\n';
	for (const Case of vecRejectedReads) {
		const strRejectedFixture = strWordReaders + "\nint main() {\n\tunsigned char const arrBytes[" + Case.ByteCount + "] {};\n\tSourceJS::" + Case.Reader + "<" + Case.Offset + ">(arrBytes);\n\n\treturn 0;\n}\n";
		g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, Case.Name + ".cpp"), strRejectedFixture);
		strCMake += "add_executable(" + Case.Name + " EXCLUDE_FROM_ALL " + Case.Name + ".cpp)\ntarget_compile_features(" + Case.Name + " PRIVATE cxx_std_20)\nif(MSVC)\n\ttarget_compile_options(" + Case.Name + " PRIVATE /W4 /WX /permissive-)\nelse()\n\ttarget_compile_options(" + Case.Name + " PRIVATE -Wall -Wextra -Werror -pedantic)\nendif()\n";
	}

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), strCMake);

	for (const Profile of g_vecProfiles) {
		const strBuild = g_Path.join(g_strDirectory, Profile.Name);
		const strExecutable = (process.platform === "win32") ? g_Path.join(strBuild, "Release", "MemoryHookValues.exe") : g_Path.join(strBuild, "MemoryHookValues");
		g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "Fixture.cpp"), strFixture);

		const vecConfigure = ["-S", g_strDirectory, "-B", strBuild, ...Profile.Arguments];
		if (process.platform === "linux") {
			vecConfigure.push("-DCMAKE_BUILD_TYPE=Release");
		}

		RequireSuccess("cmake", vecConfigure);
		RequireSuccess("cmake", ["--build", strBuild, "--config", "Release", "--parallel", "2"]);
		VerifyFixtureCLI(strExecutable);

		const Result = RequireSuccess(strExecutable, []);
		g_Assert(Result.stdout.includes("MEMORY_HOOK_VALUE_NATIVE_PASS"));

		const vecProfileMutations = g_vecMutations.filter(Mutation => !Mutation.Profiles || Mutation.Profiles.includes(Profile.Name));
		for (const Mutation of vecProfileMutations) {
			g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "Fixture.cpp"), ReplaceOnce(strFixture, Mutation.Old, Mutation.New));
			RequireSuccess("cmake", ["--build", strBuild, "--config", "Release", "--parallel", "2"]);
			const Rejected = Run(strExecutable, []);
			g_Assert.equal(Rejected.status, 1, "Mutation must fail with the native assertion status: " + Mutation.Name + "\n" + Rejected.stdout + Rejected.stderr);
			g_Assert(Rejected.stderr.includes("MEMORY_HOOK_VALUE_ASSERTION_FAILED"), "Mutation must fail a native assertion: " + Mutation.Name);
		}

		for (const Case of vecRejectedReads) {
			const Rejected = Run("cmake", ["--build", strBuild, "--target", Case.Name, "--config", "Release", "--parallel", "2"]);
			g_Assert.notEqual(Rejected.status, 0, "Out-of-range reader instantiation must fail compilation: " + Case.Name);
			g_Assert((Rejected.stdout + Rejected.stderr).includes("Native word read "), "Failure must identify the actual reader bounds assertion: " + Case.Name + "\n" + Rejected.stdout + Rejected.stderr);
		}

		process.stdout.write(Profile.Name + ": native value/stack/layout/callback/byte/register/instruction/executable boundaries passed; " + vecProfileMutations.length + " compiled mutations rejected.\n");
		process.stdout.write(Profile.Name + ": " + vecRejectedReads.length + " fixed-width reader bounds compilation failures verified.\n");
	}
} finally {
	RemoveFixture(g_strDirectory, g_strBuildRoot);
}

process.stdout.write("Memory hook value contracts passed (V8 boundary doubled).\n");
