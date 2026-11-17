
// General
#if defined(_WIN32)
#include <Windows.h>
#else
#include <dlfcn.h>
#endif

// C++
#include <cstdarg>
#include <cstdio>
#include <cstdlib>

// STL
#include <filesystem>
#include <fstream>
#include <memory>
#include <random>
#include <string>

// Third-party
#include <libplatform/libplatform.h>
#include <v8.h>

// Project
#include "sourcejs/ExtensionBindings.h"
#include "sourcejs/ExtensionManager.h"
#include "sourcejs/Log.h"
#include "sourcejs/RuntimePaths.h"

namespace {

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			std::fprintf(stderr, "ExtensionIsolateContracts failed: %s\n", pszMessage);
			std::exit(1);
		}
	}

	void WriteLog(char const* const pszFormat, va_list Arguments) noexcept {
		std::vfprintf(stderr, pszFormat, Arguments);
		std::fputc('\n', stderr);
	}

	bool IsLibraryMapped(std::filesystem::path const& Path) {
#if defined(_WIN32)
		return GetModuleHandleW(Path.c_str()) != nullptr;
#else
		void* const hLibrary = dlopen(Path.c_str(), RTLD_NOW | RTLD_NOLOAD);
		if (!hLibrary) {
			return false;
		}

		Require(dlclose(hLibrary) == 0, "release diagnostic module reference");

		return true;
#endif
	}

	void* OpenLibraryReference(std::filesystem::path const& Path) {
#if defined(_WIN32)
		return LoadLibraryW(Path.c_str());
#else
		return dlopen(Path.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
	}

	bool ReleaseLibraryReference(void* const hLibrary) {
#if defined(_WIN32)
		return FreeLibrary(static_cast<HMODULE>(hLibrary)) != 0;
#else
		return dlclose(hLibrary) == 0;
#endif
	}

	std::filesystem::path MakeFixtureRoot() {
		std::random_device Random {};
		std::filesystem::path const PathRoot = std::filesystem::temp_directory_path() / ("SourceJSExtensionIsolate-" + std::to_string(Random()));
		Require(std::filesystem::create_directory(PathRoot), "create exclusive fixture directory");

		return PathRoot;
	}

	std::filesystem::path InstallFixture(SourceJS::RuntimePaths const& Paths, std::filesystem::path const& PathBinary, std::string const& strName) {
		std::filesystem::path const PathExtension = Paths.GetExtensionRootPath() / strName;
		std::filesystem::path const PathInstalled = PathExtension / "bin" / (strName + PathBinary.extension().string());
		std::filesystem::create_directories(PathInstalled.parent_path());
		Require(std::filesystem::copy_file(PathBinary, PathInstalled), "install fixture library");

		std::ofstream Manifest(PathExtension / "extension.json");
		Manifest << "{\"Autoload\":false}\n";
		Manifest.close();
		Require(static_cast<bool>(Manifest), "write fixture manifest");

		return PathInstalled;
	}

	bool Evaluate(v8::Isolate* const pIsolate, v8::Local<v8::Context> LocalContext, char const* const pszScript) {
		v8::TryCatch TryCatch(pIsolate);
		v8::Local<v8::String> LocalSource {};
		v8::Local<v8::Script> LocalScript {};
		v8::Local<v8::Value> LocalResult {};
		if (!v8::String::NewFromUtf8(pIsolate, pszScript).ToLocal(&LocalSource) || !v8::Script::Compile(LocalContext, LocalSource).ToLocal(&LocalScript) || !LocalScript->Run(LocalContext).ToLocal(&LocalResult)) {
			v8::String::Utf8Value const Text(pIsolate, TryCatch.Exception());
			std::fprintf(stderr, "Fixture JavaScript failed: %s\n", *Text ? *Text : "");
			return false;
		}

		return LocalResult->IsTrue();
	}

	void PublishModule(SourceJS::ExtensionManager& Manager, v8::Isolate* const pIsolate, v8::Local<v8::Context> LocalContext, char const* const pszGlobalName, std::string const& strExtensionName = "echo") {
		auto const* const pModule = Manager.FindNativeModule("extensions/" + strExtensionName + "/echo");
		Require(pModule, "find native module");

		v8::Local<v8::Object> LocalModule {};
		Require(SourceJS::CreateExtensionBindingModule(Manager, *pModule, pIsolate, LocalContext).ToLocal(&LocalModule), "construct host bindings");

		v8::Local<v8::String> LocalName {};
		Require(v8::String::NewFromUtf8(pIsolate, pszGlobalName).ToLocal(&LocalName), "construct fixture global name");
		Require(LocalContext->Global()->CreateDataProperty(LocalContext, LocalName, LocalModule).FromMaybe(false), "publish host binding for test");
	}

	void RunContracts(SourceJS::ExtensionManager& Manager, std::filesystem::path const& PathInstalled, std::filesystem::path const& PathOther, v8::Isolate* const pIsolate) {
		v8::Isolate::Scope IsolateScope(pIsolate);
		v8::HandleScope HandleScope(pIsolate);
		v8::Local<v8::Context> const LocalContext = v8::Context::New(pIsolate);
		v8::Context::Scope ContextScope(LocalContext);

		Require(!IsLibraryMapped(PathInstalled), "library absent before load");
		Require(Manager.Load("echo") && IsLibraryMapped(PathInstalled), "load real extension");
		PublishModule(Manager, pIsolate, LocalContext, "First");
		Require(Manager.Load("other") && IsLibraryMapped(PathOther), "load a second native extension");
		PublishModule(Manager, pIsolate, LocalContext, "Other", "other");
		Require(Evaluate(pIsolate, LocalContext, "(First.Echo(1) === 1) && (Other.Echo(2) === 2);"), "both native libraries can use the same embedder-data slot in distinct isolates");
#if defined(SOURCEJS_TEST_V8_IMPORTS)
		Require(Evaluate(pIsolate, LocalContext, "typeof First.GetV8Version() === 'string' && First.GetV8Version().length > 0;"), "call V8 through the host's exports");
#endif

		auto TryUnload = [](v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			auto* const pManager = static_cast<SourceJS::ExtensionManager*>(Arguments.Data().As<v8::External>()->Value());
			Arguments.GetReturnValue().Set(pManager->Unload("echo"));
		};
		v8::Local<v8::Function> LocalTryUnload {};
		Require(v8::Function::New(LocalContext, TryUnload, v8::External::New(pIsolate, &Manager)).ToLocal(&LocalTryUnload), "construct reentrant unload probe");
		Require(LocalContext->Global()->CreateDataProperty(LocalContext, v8::String::NewFromUtf8Literal(pIsolate, "TryUnload"), LocalTryUnload).FromMaybe(false), "publish reentrant unload probe");
		Require(Evaluate(pIsolate, LocalContext, R"JS(
			const Saved = First.Echo;
			const Source = { Value: 18446744073709551615n, Bytes: new Uint8Array([0, 128, 255]) };
			Source.Self = Source;
			const Copy = Saved(Source);
			(Copy !== Source) && (Copy.Self === Copy) && (Copy.Value === Source.Value) &&
				(Copy.Bytes !== Source.Bytes) && (Copy.Bytes[2] === 255) && (Saved() === undefined);
		)JS"), "real native callback clones BigInt, bytes and cyclic objects");
		Require(Evaluate(pIsolate, LocalContext, "Saved({ get Result() { return TryUnload(); } }).Result === false;"), "an active copy cannot reentrantly unload its library");
		Require(Evaluate(pIsolate, LocalContext, R"JS(
			const Reject = (Value) => {
				try { Saved(Value); } catch { return true; }
				return false;
			};
			Reject(() => 1) && Reject(new SharedArrayBuffer(8));
		)JS"), "functions and shared memory cannot cross the isolate boundary");
		Require(Manager.Unload("echo") && !IsLibraryMapped(PathInstalled), "unload releases the native image");
		Require(!Manager.FindNativeModule("extensions/echo/echo"), "module unavailable after unload");
		Require(Evaluate(pIsolate, LocalContext, R"JS(
			const IsRevoked = (Handler) => {
				try { Handler(42); } catch (ErrorValue) { return /no longer loaded/.test(ErrorValue.message); }
				return false;
			};
			IsRevoked(Saved) && IsRevoked(First.Echo);
		)JS"), "held bare and object bindings are revoked");

		Require(Manager.Load("echo"), "load after unload");
		PublishModule(Manager, pIsolate, LocalContext, "Second");
		Require(Evaluate(pIsolate, LocalContext, "(Second.Echo(42) === 42) && IsRevoked(Saved);"), "new load never reuses an old binding");
		Require(Manager.Reload("echo"), "reload active extension");
		PublishModule(Manager, pIsolate, LocalContext, "Third");
		Require(Evaluate(pIsolate, LocalContext, "(Third.Echo(43) === 43) && IsRevoked(Second.Echo) && IsRevoked(Saved);"), "reload revokes the second generation");
		void* const hExternalReference = OpenLibraryReference(PathInstalled);
		Require(hExternalReference, "take an independent OS loader reference");
		Require(!Manager.Unload("echo") && IsLibraryMapped(PathInstalled), "unload does not consume another owner's loader reference");
		Require(!Manager.Load("echo") && Evaluate(pIsolate, LocalContext, "IsRevoked(Third.Echo);"), "resident library cannot reactivate revoked bindings");
		Require(ReleaseLibraryReference(hExternalReference), "release independent OS reference");
		Require(Manager.Unload("echo") && !IsLibraryMapped(PathInstalled), "reload generation is physically unloaded");
		Require(Evaluate(pIsolate, LocalContext, "Other.Echo(4) === 4;"), "other isolate survives the first extension's unload and reload");
		Require(Manager.Unload("other") && !IsLibraryMapped(PathOther), "release the second native image");
	}

	int Run(char const* const pszBinaryPath) {
		std::filesystem::path const PathRoot = MakeFixtureRoot();
		SourceJS::RuntimePaths Paths {};
		Paths.Initialize(PathRoot);
		std::filesystem::path const PathInstalled = InstallFixture(Paths, pszBinaryPath, "echo");
		std::filesystem::path const PathOther = InstallFixture(Paths, pszBinaryPath, "other");

		std::unique_ptr<v8::Platform> pPlatform = v8::platform::NewDefaultPlatform();
		Require(pPlatform != nullptr, "create V8 platform");
		v8::V8::InitializePlatform(pPlatform.get());
		Require(v8::V8::Initialize(), "initialize V8");

		std::unique_ptr<v8::ArrayBuffer::Allocator> pAllocator(v8::ArrayBuffer::Allocator::NewDefaultAllocator());
		v8::Isolate::CreateParams Parameters {};
		Parameters.array_buffer_allocator = pAllocator.get();
		auto* const pIsolate = v8::Isolate::New(Parameters);
		Require(pIsolate, "create caller isolate");

		SourceJS::ExtensionManager Manager {};
		Manager.Initialize(&Paths, pPlatform.get());
		RunContracts(Manager, PathInstalled, PathOther, pIsolate);
		Manager.Shutdown();
		v8::platform::NotifyIsolateShutdown(pPlatform.get(), pIsolate);
		pIsolate->Dispose();
		Require(v8::V8::Dispose(), "dispose V8");
		v8::V8::DisposePlatform();
		pAllocator.reset();
		pPlatform.reset();
		std::filesystem::remove_all(PathRoot);

		std::printf("ExtensionIsolateContracts PASS\n");

		return 0;
	}
} // namespace

namespace SourceJS {

	void LogInfo(char const* const pszFormat, ...) noexcept {
		va_list Arguments;
		va_start(Arguments, pszFormat);
		WriteLog(pszFormat, Arguments);
		va_end(Arguments);
	}

	void LogWarning(char const* const pszFormat, ...) noexcept {
		va_list Arguments;
		va_start(Arguments, pszFormat);
		WriteLog(pszFormat, Arguments);
		va_end(Arguments);
	}

	void LogError(char const* const pszFormat, ...) noexcept {
		va_list Arguments;
		va_start(Arguments, pszFormat);
		WriteLog(pszFormat, Arguments);
		va_end(Arguments);
	}
} // namespace SourceJS

#if defined(SOURCEJS_EXTENSION_TEST_DYNAMIC_HOST)
SOURCEJS_EXTENSION_EXPORT int SourceJS_RunIsolateContracts(char const* const pszBinaryPath) {
	return Run(pszBinaryPath);
}
#else
int main(const int nArgumentCount, char** const ppszArguments) {
	if (nArgumentCount != 2) {
		std::fprintf(stderr, "Usage: ExtensionIsolateContracts <echo library>\n");
		return 2;
	}

	return Run(ppszArguments[1]);
}
#endif
