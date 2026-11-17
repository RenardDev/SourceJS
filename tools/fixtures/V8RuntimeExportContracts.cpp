
// C++
#include <cstdarg>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// STL
#include <string>

// Template fixture, not standalone: compile through tools/smoke_plugin_manager_native_contracts.js.
// The included CallExportFunction is real; V8 handles, lookup and calls are doubles.
namespace Fixture {
	constexpr std::size_t kDiagnosticCapacity = 1024;

	struct State {
		bool m_bStringFailure;
		bool m_bLookupFailure;
		bool m_bCallFailure;
		std::size_t m_unLogs;
		std::size_t m_unLookups;
		std::size_t m_unCalls;
		void const* m_pExpectedReceiver;
		char m_szLastDiagnostic[kDiagnosticCapacity];
	};

	constinit State g_State {};

	void Check(const bool bCondition) {
		if (!bCondition) {
			std::fputs("V8 lifecycle export contract failed.\n", stderr);
			std::exit(EXIT_FAILURE);
		}
	}
} // namespace Fixture

// Exact external V8 names; no engine or JavaScript execution is modeled here.
namespace v8 {
	template<typename TValue>
	class Local {
	public:
		explicit Local(TValue* const pValue = nullptr) :
			m_pValue(pValue)
		{
		}

		bool IsEmpty() const {
			return !m_pValue;
		}

		TValue* operator->() const {
			return m_pValue;
		}

		template<typename TTarget>
		Local<TTarget> As() const {
			return Local<TTarget>(static_cast<TTarget*>(m_pValue));
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

	struct Context {
	};

	struct Isolate {
	};

	struct String {
	};

	class TryCatch {
	public:
		explicit TryCatch(Isolate* const);
	};

	TryCatch::TryCatch(Isolate* const) {
	}

	enum class Kind {
		Undefined = 0,
		Null,
		Primitive,
		Object,
		Function
	};

	class Value {
	public:
		explicit Value(const Kind ValueKind);
		bool IsObject() const;
		bool IsNullOrUndefined() const;
		bool IsFunction() const;

	private:
		Kind m_Kind;
	};

	Value::Value(const Kind ValueKind) :
		m_Kind(ValueKind)
	{
	}

	bool Value::IsObject() const {
		return (m_Kind == Kind::Object) || (m_Kind == Kind::Function);
	}

	bool Value::IsNullOrUndefined() const {
		return (m_Kind == Kind::Undefined) || (m_Kind == Kind::Null);
	}

	bool Value::IsFunction() const {
		return m_Kind == Kind::Function;
	}

	class Object : public Value {
	public:
		explicit Object(const Kind ValueKind = Kind::Object);
		MaybeLocal<Value> Get(Local<Context> const LocalContext, Local<String> const LocalName);

	public:
		Value* m_pProperty;
	};

	Object::Object(const Kind ValueKind) :
		Value(ValueKind)
	{
		m_pProperty = nullptr;
	}

	MaybeLocal<Value> Object::Get(Local<Context> const LocalContext, Local<String> const LocalName) {
		Fixture::Check(!LocalContext.IsEmpty() && !LocalName.IsEmpty());
		++Fixture::g_State.m_unLookups;

		if (Fixture::g_State.m_bLookupFailure) {
			return {};
		}

		return MaybeLocal<Value>(Local<Value>(m_pProperty));
	}

	class Function : public Object {
	public:
		Function();
		MaybeLocal<Value> Call(Local<Context> const LocalContext, Local<Object> const LocalReceiver, const int nArgumentCount, Local<Value>* const pArguments);
	};

	Function::Function() :
		Object(Kind::Function)
	{
	}

	MaybeLocal<Value> Function::Call(Local<Context> const LocalContext, Local<Object> const LocalReceiver, const int nArgumentCount, Local<Value>* const pArguments) {
		Fixture::Check(!LocalContext.IsEmpty() && (LocalReceiver.operator->() == Fixture::g_State.m_pExpectedReceiver) && (nArgumentCount == 0) && !pArguments);
		++Fixture::g_State.m_unCalls;

		if (Fixture::g_State.m_bCallFailure) {
			return {};
		}

		return MaybeLocal<Value>(Local<Value>(this));
	}
} // namespace v8

namespace SourceJS {
	class V8Runtime {
	public:
		explicit V8Runtime(v8::Isolate* const pIsolate);
		bool CallExportFunction(std::string const& strModuleName, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalExportsValue, char const* const pszFunctionName);

	public:
		bool m_bInitialized;
		v8::Isolate* m_pIsolate;
	};

	V8Runtime::V8Runtime(v8::Isolate* const pIsolate) :
		m_pIsolate(pIsolate)
	{
		m_bInitialized = true;
	}

	bool MakeRuntimeString(v8::Isolate* const pIsolate, std::string const& strName, v8::Local<v8::String>& LocalStringOut) {
		static constinit v8::String s_FunctionName {};

		Fixture::Check(pIsolate && ((strName == "load") || (strName == "unload")));

		if (Fixture::g_State.m_bStringFailure) {
			return false;
		}

		LocalStringOut = v8::Local<v8::String>(&s_FunctionName);

		return true;
	}

	std::string FormatException(v8::TryCatch const&) {
		return "injected JavaScript failure";
	}

	void LogError(char const* const pszFormat, ...) {
		++Fixture::g_State.m_unLogs;
		std::va_list Arguments;
		va_start(Arguments, pszFormat);
		const int nLength = std::vsnprintf(Fixture::g_State.m_szLastDiagnostic, Fixture::kDiagnosticCapacity, pszFormat, Arguments);
		va_end(Arguments);
		Fixture::Check((nLength >= 0) && (static_cast<std::size_t>(nLength) < Fixture::kDiagnosticCapacity));
	}
} // namespace SourceJS

// Project
#include "V8RuntimeExportMethods.h"

namespace Fixture {
	void CheckExport(SourceJS::V8Runtime& Runtime, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalExportsValue, char const* const pszFunctionName, const bool bExpectedResult, const std::size_t unExpectedLogs, const std::size_t unExpectedLookups, const std::size_t unExpectedCalls, char const* const pszExpectedStage = nullptr) {
		Check(Runtime.CallExportFunction("TestPlugin", LocalContext, LocalExportsValue, pszFunctionName) == bExpectedResult);
		Check(g_State.m_unLogs == unExpectedLogs);
		Check(g_State.m_unLookups == unExpectedLookups);
		Check(g_State.m_unCalls == unExpectedCalls);

		if (unExpectedLogs != 0) {
			Check(std::strstr(g_State.m_szLastDiagnostic, "CallExportFunction failed Module=\"TestPlugin\" Function=\"load\"") == g_State.m_szLastDiagnostic);
		}

		if (pszExpectedStage) {
			Check(std::strstr(g_State.m_szLastDiagnostic, pszExpectedStage));
			Check(std::strstr(g_State.m_szLastDiagnostic, "injected JavaScript failure"));
		}
	}
} // namespace Fixture

int main() {
	v8::Isolate Isolate {};
	v8::Context Context {};
	v8::Object Exports {};
	v8::Object NonFunction {};
	v8::Function Callback {};
	v8::Value Undefined(v8::Kind::Undefined);
	v8::Value Null(v8::Kind::Null);
	v8::Value Primitive(v8::Kind::Primitive);
	SourceJS::V8Runtime Runtime(&Isolate);
	v8::Local<v8::Context> const LocalContext(&Context);
	v8::Local<v8::Value> const LocalExports(&Exports);

	Fixture::g_State = {};
	Fixture::g_State.m_pExpectedReceiver = &Exports;
	Exports.m_pProperty = &Callback;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "load", true, 0, 1, 1);

	Fixture::g_State = {};
	Fixture::g_State.m_pExpectedReceiver = &Exports;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "unload", true, 0, 1, 1);

	Fixture::g_State = {};
	Exports.m_pProperty = &Undefined;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "load", true, 0, 1, 0);

	Fixture::g_State = {};
	Exports.m_pProperty = &Null;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "load", true, 0, 1, 0);

	Fixture::g_State = {};
	Fixture::CheckExport(Runtime, LocalContext, v8::Local<v8::Value>(&Primitive), "load", true, 0, 0, 0);

	Fixture::g_State = {};
	Fixture::CheckExport(Runtime, LocalContext, v8::Local<v8::Value> {}, "load", true, 0, 0, 0);

	Fixture::g_State = {};
	Exports.m_pProperty = &NonFunction;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "load", false, 1, 1, 0);

	Fixture::g_State = {};
	Fixture::g_State.m_bLookupFailure = true;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "load", false, 1, 1, 0, "Stage=Lookup");

	Fixture::g_State = {};
	Fixture::g_State.m_pExpectedReceiver = &Exports;
	Fixture::g_State.m_bCallFailure = true;
	Exports.m_pProperty = &Callback;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "load", false, 1, 1, 1, "Stage=Call");

	Fixture::g_State = {};
	Fixture::g_State.m_bStringFailure = true;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "load", false, 1, 0, 0);

	Fixture::g_State = {};
	Fixture::CheckExport(Runtime, v8::Local<v8::Context> {}, LocalExports, "load", false, 0, 0, 0);
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, nullptr, false, 0, 0, 0);
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "", false, 0, 0, 0);

	Runtime.m_bInitialized = false;
	Fixture::CheckExport(Runtime, LocalContext, v8::Local<v8::Value>(&Primitive), "load", false, 0, 0, 0);
	Runtime.m_bInitialized = true;
	Runtime.m_pIsolate = nullptr;
	Fixture::CheckExport(Runtime, LocalContext, LocalExports, "load", false, 0, 0, 0);

	std::puts("V8 lifecycle export contracts passed.");

	return 0;
}
