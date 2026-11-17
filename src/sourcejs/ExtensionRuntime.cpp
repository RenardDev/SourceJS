#include "sourcejs/ExtensionRuntime.h"

// C++
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <utility>

// STL
#include <string>
#include <vector>

// Third-party
#include "libplatform/libplatform.h"
#include "v8.h"

namespace SourceJS {

	class ExtensionRuntime {
	public:
		explicit ExtensionRuntime(v8::Platform* pPlatform) noexcept;
		~ExtensionRuntime();

		ExtensionRuntime(ExtensionRuntime const&) = delete;
		ExtensionRuntime& operator=(ExtensionRuntime const&) = delete;

		bool Initialize();
		bool Start(fnSourceJSExtensionLoad Load, SOURCEJS_EXTENSION_CONTEXT const& Context, bool& bStartedOut);
		bool Stop(fnSourceJSExtensionUnload Unload);
		void Invoke(fnSourceJSExtensionInvoke Handler, void* pData, v8::FunctionCallbackInfo<v8::Value> const& Arguments);
		bool IsInvoking() const noexcept;

	private:
		v8::Platform* m_pPlatform;
		std::unique_ptr<v8::ArrayBuffer::Allocator> m_pAllocator;
		v8::Isolate* m_pIsolate;
		v8::Global<v8::Context> m_Context;
		bool m_bInvoking;
	};

	namespace {

		using SerializedExtensionBuffer = std::unique_ptr<std::uint8_t, decltype(&std::free)>;
		using SerializedExtensionValue = std::pair<SerializedExtensionBuffer, std::size_t>;

		struct ExtensionInvocationScope {
			bool& m_bInvoking;

			~ExtensionInvocationScope() {
				m_bInvoking = false;
			}
		};

		void ThrowExtensionError(v8::Isolate* const pIsolate, char const* const pszMessage) {
			v8::Local<v8::String> LocalMessage {};
			if (v8::String::NewFromUtf8(pIsolate, pszMessage).ToLocal(&LocalMessage)) {
				pIsolate->ThrowException(v8::Exception::Error(LocalMessage));
			}
		}

		bool SerializeExtensionValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> LocalContext, v8::Local<v8::Value> LocalValue, SerializedExtensionValue& BufferOut) {
			constexpr std::size_t kMaximumSerializedByteCount = 16 * 1024 * 1024;

			// No delegate or transfer list: shared memory, functions and host objects cannot cross.
			v8::ValueSerializer Serializer(pIsolate);
			Serializer.WriteHeader();
			if (!Serializer.WriteValue(LocalContext, LocalValue).FromMaybe(false)) {
				return false;
			}

			auto Storage = Serializer.Release();
			SerializedExtensionBuffer pBytes(Storage.first, std::free);
			if (!pBytes || (Storage.second > kMaximumSerializedByteCount)) {
				ThrowExtensionError(pIsolate, "Serialized extension value exceeds the size limit.");
				return false;
			}

			BufferOut = { std::move(pBytes), Storage.second };

			return true;
		}

		v8::MaybeLocal<v8::Value> DeserializeExtensionValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> LocalContext, SerializedExtensionValue const& Buffer) {
			v8::ValueDeserializer Deserializer(pIsolate, Buffer.first.get(), Buffer.second);
			if (!Deserializer.ReadHeader(LocalContext).FromMaybe(false)) {
				return {};
			}

			return Deserializer.ReadValue(LocalContext);
		}

		bool RunIsolatedExtensionBinding(v8::Isolate* const pIsolate, v8::Local<v8::Context> LocalContext, fnSourceJSExtensionInvoke Handler, void* const pData, SerializedExtensionValue const& Input, SerializedExtensionValue& ResultOut) {
			v8::Local<v8::Value> LocalInput {};
			if (!DeserializeExtensionValue(pIsolate, LocalContext, Input).ToLocal(&LocalInput) || !LocalInput->IsArray()) {
				return false;
			}

			v8::Local<v8::Array> const LocalArray = LocalInput.As<v8::Array>();
			const std::uint32_t unArgumentCount = LocalArray->Length();
			std::vector<v8::Local<v8::Value>> vecArguments(unArgumentCount);
			for (std::uint32_t unIndex = 0; unIndex < unArgumentCount; ++unIndex) {
				if (!LocalArray->Get(LocalContext, unIndex).ToLocal(&vecArguments[unIndex])) {
					return false;
				}
			}

			v8::Local<v8::Value> LocalData = v8::Undefined(pIsolate);
			if (pData) {
				LocalData = v8::External::New(pIsolate, pData);
			}

			v8::Local<v8::Function> LocalFunction {};
			if (!v8::Function::New(LocalContext, Handler, LocalData, 0, v8::ConstructorBehavior::kThrow).ToLocal(&LocalFunction)) {
				return false;
			}

			v8::Local<v8::Value> LocalResult {};
			if (!LocalFunction->Call(LocalContext, v8::Undefined(pIsolate), static_cast<int>(unArgumentCount), vecArguments.data()).ToLocal(&LocalResult)) {
				return false;
			}

			return SerializeExtensionValue(pIsolate, LocalContext, LocalResult, ResultOut);
		}
	} // namespace

	ExtensionRuntime::ExtensionRuntime(v8::Platform* const pPlatform) noexcept :
		m_pPlatform(pPlatform)
	{
		m_pIsolate = nullptr;
		m_bInvoking = false;
	}

	ExtensionRuntime::~ExtensionRuntime() {
		if (m_pIsolate) {
			m_Context.Reset();
			v8::platform::NotifyIsolateShutdown(m_pPlatform, m_pIsolate);
			m_pIsolate->Dispose();
		}
	}

	bool ExtensionRuntime::Initialize() {
		m_pAllocator.reset(v8::ArrayBuffer::Allocator::NewDefaultAllocator());
		if (!m_pAllocator) {
			return false;
		}

		v8::Isolate::CreateParams Parameters {};
		Parameters.array_buffer_allocator = m_pAllocator.get();
		m_pIsolate = v8::Isolate::New(Parameters);
		if (!m_pIsolate) {
			return false;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		m_pIsolate->SetMicrotasksPolicy(v8::MicrotasksPolicy::kExplicit);
		v8::Local<v8::Context> const LocalContext = v8::Context::New(m_pIsolate);
		if (LocalContext.IsEmpty()) {
			return false;
		}

		m_Context.Reset(m_pIsolate, LocalContext);

		return true;
	}

	bool ExtensionRuntime::Start(fnSourceJSExtensionLoad Load, SOURCEJS_EXTENSION_CONTEXT const& Context, bool& bStartedOut) {
		if (!Load) {
			bStartedOut = true;
			return true;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = m_Context.Get(m_pIsolate);
		v8::Context::Scope ContextScope(LocalContext);
		v8::TryCatch TryCatch(m_pIsolate);

		SOURCEJS_EXTENSION_CONTEXT BoundContext = Context;
		BoundContext.m_pIsolate = m_pIsolate;
		BoundContext.m_pContext = &LocalContext;
		try {
			bStartedOut = Load(&BoundContext);
		} catch (...) {
			// A throwing callback may have changed external state before failing.
			bStartedOut = true;
			return false;
		}

		return bStartedOut && !TryCatch.HasCaught();
	}

	bool ExtensionRuntime::Stop(fnSourceJSExtensionUnload Unload) {
		if (!Unload) {
			return true;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = m_Context.Get(m_pIsolate);
		v8::Context::Scope ContextScope(LocalContext);
		v8::TryCatch TryCatch(m_pIsolate);
		try {
			Unload();
		} catch (...) {
			return false;
		}

		return !TryCatch.HasCaught();
	}

	void ExtensionRuntime::Invoke(fnSourceJSExtensionInvoke Handler, void* const pData, v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
		constexpr int kMaximumArgumentCount = 1024;

		auto* const pCaller = Arguments.GetIsolate();
		if (m_bInvoking || (Arguments.Length() > kMaximumArgumentCount)) {
			ThrowExtensionError(pCaller, "Native extension binding is already active or has too many arguments.");
			return;
		}

		// Serialization can run an enumerable getter which can try to unload us.
		m_bInvoking = true;
		ExtensionInvocationScope InvocationScope { m_bInvoking };
		v8::Local<v8::Context> const LocalCallerContext = pCaller->GetCurrentContext();
		SerializedExtensionValue Input { SerializedExtensionBuffer(nullptr, std::free), 0 };
		{
			v8::TryCatch TryCatch(pCaller);
			std::vector<v8::Local<v8::Value>> vecArguments {};
			vecArguments.reserve(static_cast<std::size_t>(Arguments.Length()));
			for (int nIndex = 0; nIndex < Arguments.Length(); ++nIndex) {
				vecArguments.push_back(Arguments[nIndex]);
			}

			v8::Local<v8::Array> const LocalInput = v8::Array::New(pCaller, vecArguments.data(), vecArguments.size());
			if (!SerializeExtensionValue(pCaller, LocalCallerContext, LocalInput, Input)) {
				if (!TryCatch.HasCaught()) {
					ThrowExtensionError(pCaller, "Could not copy arguments into the native extension.");
				}

				if (TryCatch.HasCaught()) {
					TryCatch.ReThrow();
				}

				return;
			}
		}

		SerializedExtensionValue Result { SerializedExtensionBuffer(nullptr, std::free), 0 };
		std::string strFailure {};
		bool bSucceeded = false;
		{
			v8::Isolate::Scope IsolateScope(m_pIsolate);
			v8::HandleScope HandleScope(m_pIsolate);
			v8::Local<v8::Context> const LocalContext = m_Context.Get(m_pIsolate);
			v8::Context::Scope ContextScope(LocalContext);
			v8::TryCatch TryCatch(m_pIsolate);
			bSucceeded = RunIsolatedExtensionBinding(m_pIsolate, LocalContext, Handler, pData, Input, Result);
			if (!bSucceeded && TryCatch.HasCaught() && !TryCatch.Message().IsEmpty()) {
				v8::String::Utf8Value const Text(m_pIsolate, TryCatch.Message()->Get());
				if (*Text) {
					strFailure.assign(*Text, static_cast<std::size_t>(Text.length()));
				}
			}
		}

		if (!bSucceeded) {
			ThrowExtensionError(pCaller, strFailure.empty() ? "Native extension binding failed." : strFailure.c_str());
			return;
		}

		v8::Local<v8::Value> LocalResult {};
		if (DeserializeExtensionValue(pCaller, LocalCallerContext, Result).ToLocal(&LocalResult)) {
			Arguments.GetReturnValue().Set(LocalResult);
		}
	}

	bool ExtensionRuntime::IsInvoking() const noexcept {
		return m_bInvoking;
	}

	void ExtensionRuntimeDeleter::operator()(ExtensionRuntime* const pRuntime) const noexcept {
		delete pRuntime;
	}

	ExtensionRuntimeOwner CreateExtensionRuntime(v8::Platform* const pPlatform) {
		if (!pPlatform) {
			return {};
		}

		ExtensionRuntimeOwner pRuntime(new ExtensionRuntime(pPlatform));
		if (!pRuntime->Initialize()) {
			return {};
		}

		return pRuntime;
	}

	bool StartExtensionRuntime(ExtensionRuntime& Runtime, fnSourceJSExtensionLoad Load, SOURCEJS_EXTENSION_CONTEXT const& Context, bool& bStartedOut) {
		return Runtime.Start(Load, Context, bStartedOut);
	}

	bool StopExtensionRuntime(ExtensionRuntime& Runtime, fnSourceJSExtensionUnload Unload) {
		return Runtime.Stop(Unload);
	}

	bool IsExtensionRuntimeInvoking(ExtensionRuntime const& Runtime) noexcept {
		return Runtime.IsInvoking();
	}

	void InvokeExtensionRuntime(ExtensionRuntime& Runtime, fnSourceJSExtensionInvoke Handler, void* const pData, v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
		try {
			Runtime.Invoke(Handler, pData, Arguments);
		} catch (...) {
			ThrowExtensionError(Arguments.GetIsolate(), "Native extension binding threw a C++ exception.");
		}
	}
} // namespace SourceJS
