
// C++
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>

// STL
#include <limits>
#include <new>
#include <string>

// Template fixture, not standalone: compile through tools/smoke_plugin_manager_native_contracts.js.
// Actual extracted argument/error helpers; V8 allocation, encoding and handles are doubles.
namespace Fixture {
	constexpr std::size_t kMaximumMessageByteCount = 512;

	struct State {
		void* m_pPlaceholder;
		std::size_t m_unExceptions;
		std::size_t m_unLogs;
		std::size_t m_unStringByteCount;
		bool m_bFailUTF8;
		bool m_bFailStringCreation;
		bool m_bThrowStringCreation;
		bool m_bThrowException;
		char m_szMessage[kMaximumMessageByteCount];
		char m_arrStringBytes[kMaximumMessageByteCount];
	};

	constinit State g_State {};

	void Check(const bool bCondition) {
		if (!bCondition) {
			std::fputs("V8 game-event argument contract failed.\n", stderr);
			std::exit(EXIT_FAILURE);
		}
	}

	void ResetState(void* const pPlaceholder) {
		g_State = {};
		g_State.m_pPlaceholder = pPlaceholder;
	}
} // namespace Fixture

// Exact V8 API spellings. Placeholder strings borrow main() storage; there is no GC.
namespace v8 {
	template<typename TValue>
	class Local {
	public:
		Local() {
			m_pValue = nullptr;
		}

		explicit Local(TValue* const pValue) :
			m_pValue(pValue)
		{
		}

		bool IsEmpty() const {
			return !m_pValue;
		}

		TValue* operator->() const {
			return m_pValue;
		}

		template<typename TConverted>
		Local<TConverted> As() const {
			return Local<TConverted>(static_cast<TConverted*>(m_pValue));
		}

	private:
		TValue* m_pValue;
	};

	template<typename TValue>
	class MaybeLocal {
	public:
		MaybeLocal() = default;

		explicit MaybeLocal(Local<TValue> const LocalValue) :
			m_Value(LocalValue)
		{
		}

		bool ToLocal(Local<TValue>* const pValueOut) const {
			if (m_Value.IsEmpty()) {
				return false;
			}

			*pValueOut = m_Value;

			return true;
		}

	private:
		Local<TValue> m_Value;
	};

	struct Value {
		bool IsString() const;

		bool m_bString;
	};

	bool Value::IsString() const {
		return m_bString;
	}

	struct Isolate {
		void ThrowException(Local<Value> const LocalError);
	};

	void Isolate::ThrowException(Local<Value> const LocalError) {
		Fixture::Check(!LocalError.IsEmpty());

		if (Fixture::g_State.m_bThrowException) {
			throw std::bad_alloc();
		}

		++Fixture::g_State.m_unExceptions;
	}

	enum class NewStringType {
		kNormal = 0
	};

	class String : public Value {
	public:
		explicit String(std::string const& strText);
		static MaybeLocal<String> NewFromUtf8(Isolate* const pIsolate, char const* const pchData, const NewStringType Type, const int nByteCount = -1);

	public:
		class Utf8Value {
		public:
			Utf8Value(Isolate* const pIsolate, Local<Value> const LocalValue);
			char const* operator*() const;
			std::size_t length() const;

		private:
			std::string const* m_pText;
		};

	public:
		std::string const* m_pText;
	};

	String::String(std::string const& strText) :
		Value { true },
		m_pText(&strText)
	{
	}

	MaybeLocal<String> String::NewFromUtf8(Isolate* const pIsolate, char const* const pchData, const NewStringType Type, const int nByteCount) {
		Fixture::Check(pIsolate && pchData && (Type == NewStringType::kNormal) && (nByteCount >= -1));

		if (Fixture::g_State.m_bThrowStringCreation) {
			throw std::bad_alloc();
		}

		if (Fixture::g_State.m_bFailStringCreation) {
			return {};
		}

		const std::size_t unByteCount = (nByteCount < 0) ? std::strlen(pchData) : static_cast<std::size_t>(nByteCount);
		Fixture::Check(unByteCount < sizeof(Fixture::g_State.m_arrStringBytes));
		std::memcpy(Fixture::g_State.m_arrStringBytes, pchData, unByteCount);
		Fixture::g_State.m_arrStringBytes[unByteCount] = '\0';
		Fixture::g_State.m_unStringByteCount = unByteCount;

		const int nMessageLength = std::snprintf(Fixture::g_State.m_szMessage, sizeof(Fixture::g_State.m_szMessage), "%s", Fixture::g_State.m_arrStringBytes);
		Fixture::Check((nMessageLength >= 0) && (static_cast<std::size_t>(nMessageLength) < sizeof(Fixture::g_State.m_szMessage)));

		// ResetState receives the address of the fixture-owned String, never another type.
		auto* const pPlaceholder = static_cast<String*>(Fixture::g_State.m_pPlaceholder);

		return MaybeLocal<String>(Local<String>(pPlaceholder));
	}

	String::Utf8Value::Utf8Value(Isolate* const pIsolate, Local<Value> const LocalValue) {
		Fixture::Check(pIsolate && !LocalValue.IsEmpty() && LocalValue->IsString());
		m_pText = Fixture::g_State.m_bFailUTF8 ? nullptr : LocalValue.As<String>()->m_pText;
	}

	char const* String::Utf8Value::operator*() const {
		return m_pText ? m_pText->c_str() : nullptr;
	}

	std::size_t String::Utf8Value::length() const {
		return m_pText ? m_pText->size() : 0;
	}

	template<typename TValue>
	class FunctionCallbackInfo {
	public:
		FunctionCallbackInfo(Isolate* const pIsolate, Local<TValue> const LocalArgument, const int nLength = 1) :
			m_pIsolate(pIsolate),
			m_Argument(LocalArgument),
			m_nLength(nLength)
		{
		}

		Isolate* GetIsolate() const {
			return m_pIsolate;
		}

		int Length() const {
			return m_nLength;
		}

		Local<TValue> operator[](const int nIndex) const {
			Fixture::Check((nIndex == 0) && (m_nLength == 1));

			return m_Argument;
		}

	private:
		Isolate* m_pIsolate;
		Local<TValue> m_Argument;
		int m_nLength;
	};

	struct Exception {
		static Local<Value> Error(Local<String> const LocalMessage);
	};

	Local<Value> Exception::Error(Local<String> const LocalMessage) {
		return Local<Value>(LocalMessage.operator->());
	}
} // namespace v8

namespace SourceJS {
	void LogError(char const* const, ...) noexcept {
		++Fixture::g_State.m_unLogs;
	}
} // namespace SourceJS

// Project
#include "V8GameEventArgumentMethods.h"

int main() {
	constexpr char kUnchangedOutput[] = "unchanged";
	constexpr char kLeadingNullKey[] = "\0key";
	constexpr char kEmbeddedNullKey[] = "a\0b";
	constexpr std::size_t kArgumentErrorCount = 2;

	std::string const strPlaceholder {};
	v8::String Placeholder(strPlaceholder);
	v8::Isolate Isolate {};
	std::string const arrRuntimeStrings[] = {
		"",
		"Plain",
		std::string(kLeadingNullKey, sizeof(kLeadingNullKey) - 1),
		std::string(kEmbeddedNullKey, sizeof(kEmbeddedNullKey) - 1),
		"\xF0\x9F\x9A\x80",
	};
	for (auto const& strRuntimeValue : arrRuntimeStrings) {
		Fixture::ResetState(&Placeholder);
		v8::Local<v8::String> LocalRuntimeValue {};
		Fixture::Check(SourceJS::MakeRuntimeString(&Isolate, strRuntimeValue, LocalRuntimeValue));
		Fixture::Check(!LocalRuntimeValue.IsEmpty());
		Fixture::Check(Fixture::g_State.m_unStringByteCount == strRuntimeValue.size());
		Fixture::Check(std::memcmp(Fixture::g_State.m_arrStringBytes, strRuntimeValue.data(), strRuntimeValue.size()) == 0);
	}

	auto CheckString = [&Placeholder, &Isolate, &kUnchangedOutput](std::string const& strInput, const bool bKeyExpected, const bool bValueExpected) -> void {
		v8::String Input(strInput);
		v8::FunctionCallbackInfo<v8::Value> const Arguments = v8::FunctionCallbackInfo<v8::Value>(&Isolate, v8::Local<v8::Value>(&Input));
		std::string strOutput = kUnchangedOutput;
		Fixture::ResetState(&Placeholder);
		Fixture::Check(SourceJS::RequireGameEventKeyArgument(Arguments, 0, "TestOperation", strOutput) == bKeyExpected);
		Fixture::Check(strOutput == (bKeyExpected ? strInput : kUnchangedOutput));
		const std::size_t unExpectedKeyExceptionCount = bKeyExpected ? 0 : 1;
		Fixture::Check(Fixture::g_State.m_unExceptions == unExpectedKeyExceptionCount);

		strOutput = kUnchangedOutput;
		Fixture::ResetState(&Placeholder);
		Fixture::Check(SourceJS::RequireGameEventStringArgument(Arguments, 0, "TestOperation", strOutput) == bValueExpected);
		Fixture::Check(strOutput == (bValueExpected ? strInput : kUnchangedOutput));
		const std::size_t unExpectedValueExceptionCount = bValueExpected ? 0 : 1;
		Fixture::Check(Fixture::g_State.m_unExceptions == unExpectedValueExceptionCount);
	};

	CheckString("key", true, true);
	CheckString("", false, true);
	CheckString(std::string(kLeadingNullKey, sizeof(kLeadingNullKey) - 1), false, false);
	CheckString(std::string(kEmbeddedNullKey, sizeof(kEmbeddedNullKey) - 1), false, false);
	CheckString("\xD0\x9A\xD0\xBB\xD1\x8E\xD1\x87", true, true);

	v8::FunctionCallbackInfo<v8::Value> const StringArguments = v8::FunctionCallbackInfo<v8::Value>(&Isolate, v8::Local<v8::Value>(&Placeholder));
	std::string strOutput = kUnchangedOutput;
	Fixture::ResetState(&Placeholder);
	Fixture::g_State.m_bFailUTF8 = true;
	Fixture::Check(!SourceJS::RequireGameEventKeyArgument(StringArguments, 0, "TestOperation", strOutput));
	Fixture::Check(!SourceJS::RequireGameEventStringArgument(StringArguments, 0, "TestOperation", strOutput));
	Fixture::Check((strOutput == kUnchangedOutput) && (Fixture::g_State.m_unExceptions == kArgumentErrorCount));

	v8::Value OtherValue { false };
	v8::FunctionCallbackInfo<v8::Value> const OtherArguments = v8::FunctionCallbackInfo<v8::Value>(&Isolate, v8::Local<v8::Value>(&OtherValue));
	Fixture::ResetState(&Placeholder);
	Fixture::Check(!SourceJS::RequireGameEventKeyArgument(OtherArguments, 0, "TestOperation", strOutput));
	Fixture::Check(!SourceJS::RequireGameEventStringArgument(OtherArguments, 0, "TestOperation", strOutput));
	Fixture::Check((strOutput == kUnchangedOutput) && (Fixture::g_State.m_unExceptions == kArgumentErrorCount));

	v8::FunctionCallbackInfo<v8::Value> const MissingArguments = v8::FunctionCallbackInfo<v8::Value>(&Isolate, {}, 0);
	Fixture::ResetState(&Placeholder);
	Fixture::Check(!SourceJS::RequireGameEventKeyArgument(MissingArguments, 0, "TestOperation", strOutput));
	Fixture::Check(!SourceJS::RequireGameEventStringArgument(MissingArguments, 0, "TestOperation", strOutput));
	Fixture::Check((strOutput == kUnchangedOutput) && (Fixture::g_State.m_unExceptions == kArgumentErrorCount));
	Fixture::Check(!SourceJS::RequireGameEventKeyArgument(StringArguments, -1, "TestOperation", strOutput));
	Fixture::Check(!SourceJS::RequireGameEventStringArgument(StringArguments, 0, nullptr, strOutput));
	Fixture::Check((strOutput == kUnchangedOutput) && (Fixture::g_State.m_unExceptions == kArgumentErrorCount));

	Fixture::ResetState(&Placeholder);
	SourceJS::ThrowRuntimeCallbackException(&Isolate, "callback failure");
	Fixture::Check((Fixture::g_State.m_unExceptions == 1) && (Fixture::g_State.m_unLogs == 0));
	Fixture::Check(std::strcmp(Fixture::g_State.m_szMessage, "callback failure") == 0);
	SourceJS::ThrowRuntimeCallbackException(nullptr, "callback failure");
	SourceJS::ThrowRuntimeCallbackException(&Isolate, nullptr);
	Fixture::Check(Fixture::g_State.m_unExceptions == 1);
	Fixture::g_State.m_bFailStringCreation = true;
	SourceJS::ThrowRuntimeCallbackException(&Isolate, "callback failure");
	Fixture::Check((Fixture::g_State.m_unExceptions == 1) && (Fixture::g_State.m_unLogs == 0));
	Fixture::g_State.m_bFailStringCreation = false;
	Fixture::g_State.m_bThrowStringCreation = true;
	SourceJS::ThrowRuntimeCallbackException(&Isolate, "callback failure");
	Fixture::Check((Fixture::g_State.m_unExceptions == 1) && (Fixture::g_State.m_unLogs == 1));
	Fixture::g_State.m_bThrowStringCreation = false;
	Fixture::g_State.m_bThrowException = true;
	SourceJS::ThrowRuntimeCallbackException(&Isolate, "callback failure");
	Fixture::Check((Fixture::g_State.m_unExceptions == 1) && (Fixture::g_State.m_unLogs == 2));

	std::puts("V8 game-event argument contracts passed.");

	return 0;
}
