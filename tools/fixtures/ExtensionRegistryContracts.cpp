
// General
#if defined(_WIN32)
#define NOMINMAX
#include <Windows.h>
#undef NOMINMAX
#else
#include <dlfcn.h>
#endif

// C++
#include <cerrno>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>

// STL
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <limits>
#include <memory>
#include <sstream>
#include <string>
#include <type_traits>
#include <vector>

// Project
#include "ExtensionRuntimeDouble.h"
#include "sourcejs/ExtensionManager.h"
#include "sourcejs/ManagerManifest.h"
#include "sourcejs/ManagerState.h"

// All production manager bodies, actual ABI, OS loader and filesystem operations.
// Isolate, cache, path and log dependencies are doubles; no V8 or server runs.
namespace {

	static_assert(!std::is_copy_constructible_v<SourceJS::ExtensionManager>, "Extension managers must not copy library ownership.");
	static_assert(!std::is_copy_assignable_v<SourceJS::ExtensionManager>, "Extension managers must not copy-assign library ownership.");
	static_assert(!std::is_move_constructible_v<SourceJS::ExtensionManager>, "Extension manager identity must remain stable.");
	static_assert(!std::is_move_assignable_v<SourceJS::ExtensionManager>, "Extension managers must not move-assign live runtime state.");

	unsigned int g_unAssertionCount = 0;
	unsigned int g_unNativeLoadCount = 0;
	unsigned int g_unNativeUnloadCount = 0;
	unsigned int g_unInvalidationCount = 0;
	unsigned int g_unErrorCount = 0;
	bool g_bOpenDiagnostic = false;
	bool g_bSymbolDiagnostic = false;

	void Require(const bool bCondition, char const* const pszMessage) noexcept {
		if (!bCondition) {
			std::fprintf(stderr, "ExtensionRegistryContracts failed: %s\n", pszMessage);
			std::exit(1);
		}

		++g_unAssertionCount;
	}

	void WriteLog(char const* const pszFormat, va_list Arguments) noexcept {
		constexpr std::size_t kMessageBufferByteCount = 4096;

		char szMessage[kMessageBufferByteCount] {};
		const int nMessageLength = std::vsnprintf(szMessage, sizeof(szMessage), pszFormat, Arguments);
		Require((nMessageLength > 0) && (static_cast<std::size_t>(nMessageLength) < sizeof(szMessage)), "complete diagnostic formatting");

		if (std::strstr(szMessage, "Fixture.Load")) {
			++g_unNativeLoadCount;
		}

		if (std::strstr(szMessage, "Fixture.Unload")) {
			++g_unNativeUnloadCount;
		}

		g_bOpenDiagnostic = g_bOpenDiagnostic || (std::strstr(szMessage, "ExtensionManager.OpenLibrary failed Path=") != nullptr);
		g_bSymbolDiagnostic = g_bSymbolDiagnostic || (std::strstr(szMessage, "ExtensionManager.ResolveSymbol failed Symbol=") != nullptr);
	}
} // namespace

namespace SourceJS {

	class RuntimePaths {
	public:
		RuntimePaths(std::filesystem::path const& PathRoot, std::filesystem::path const& PathExtensions, std::filesystem::path const& PathData) noexcept;
		std::filesystem::path const& GetAddonRootPath() const noexcept;
		std::filesystem::path const& GetExtensionRootPath() const noexcept;
		std::filesystem::path const& GetDataPath() const noexcept;

	private:
		std::filesystem::path const& m_PathRoot;
		std::filesystem::path const& m_PathExtensions;
		std::filesystem::path const& m_PathData;
	};

	RuntimePaths::RuntimePaths(std::filesystem::path const& PathRoot, std::filesystem::path const& PathExtensions, std::filesystem::path const& PathData) noexcept :
		m_PathRoot(PathRoot),
		m_PathExtensions(PathExtensions),
		m_PathData(PathData)
	{
	}

	std::filesystem::path const& RuntimePaths::GetAddonRootPath() const noexcept {
		return m_PathRoot;
	}

	std::filesystem::path const& RuntimePaths::GetExtensionRootPath() const noexcept {
		return m_PathExtensions;
	}

	std::filesystem::path const& RuntimePaths::GetDataPath() const noexcept {
		return m_PathData;
	}

	v8::Platform g_Platform {};

	void InvalidateExtensionModules(void*, std::string const& strName) {
		Require(!strName.empty(), "cache invalidation name");
		++g_unInvalidationCount;
	}

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
		++g_unErrorCount;

		va_list Arguments;
		va_start(Arguments, pszFormat);
		WriteLog(pszFormat, Arguments);
		va_end(Arguments);
	}
} // namespace SourceJS

// SOURCEJS_EXTENSION_NAMESPACE

namespace {

	void SetMode(char const* const pszMode) {
#if defined(_WIN32)
		Require(_putenv_s("SOURCEJS_EXTENSION_FIXTURE_MODE", pszMode) == 0, "set fixture mode");
#else
		Require(setenv("SOURCEJS_EXTENSION_FIXTURE_MODE", pszMode, 1) == 0, "set fixture mode");
#endif
	}

	void WriteText(std::filesystem::path const& PathFile, std::string const& strText) {
		std::ofstream OutputFile(PathFile, std::ios::binary);
		Require(static_cast<bool>(OutputFile), "open fixture file");

		OutputFile << strText;
		OutputFile.close();
		Require(static_cast<bool>(OutputFile), "write fixture file");
	}

	void CreateExtension(std::filesystem::path const& PathExtensions, std::filesystem::path const& PathLibrary, std::string const& strName, const bool bAutoLoad, const bool bPlatformBinary) {
#if defined(_WIN32)
		constexpr char const* kLibrarySuffix = ".dll";
#else
		constexpr char const* kLibrarySuffix = ".so";
#endif

		std::filesystem::path const PathDirectory = PathExtensions / strName;
		std::filesystem::path PathBinaryDirectory = PathDirectory / "bin";
		if (bPlatformBinary) {
			PathBinaryDirectory /= std::string(SOURCEJS_TARGET_PLATFORM) + "-" + SOURCEJS_TARGET_ARCH;
		}

		std::filesystem::create_directories(PathBinaryDirectory);
		std::filesystem::copy_file(PathLibrary, PathBinaryDirectory / (strName + kLibrarySuffix));
		WriteText(PathDirectory / "extension.json", bAutoLoad ? "{\"Autoload\": true}\n" : "{\"Autoload\": false}\n");
	}

	void CheckLookup(SourceJS::ExtensionManager& Manager) {
		std::string const strModuleName = "extensions/Alpha/Main";
		Require(!Manager.FindNativeModule("extensions/Alpha/Absent"), "missing module result");
		auto const* const pModule = Manager.FindNativeModule(strModuleName);
		Require(pModule && (pModule->m_vecFunctions.size() == 1), "main module lookup");
		SourceJS::ExtensionNativeFunction const& Binding = pModule->m_vecFunctions.front();
		Require((Binding.m_strName == "Echo") && Binding.m_Invoke, "copied native callback descriptor");
		const std::uint64_t unOriginalID = Binding.m_unID;
		SourceJS::ExtensionRuntime* pRuntime = nullptr;
		SourceJS::fnSourceJSExtensionInvoke Handler = nullptr;
		void* pData = nullptr;
		Require(Manager.ResolveNativeBinding(unOriginalID, pRuntime, Handler, pData) && pRuntime && (Handler == Binding.m_Invoke), "binding lookup");
		Require(Manager.FindNativeModule("extensions/Alpha/Nested/Helper"), "nested module lookup");
		Require(!Manager.ResolveNativeBinding(0, pRuntime, Handler, pData), "invalid binding ID");
		Require(Manager.Reload("Alpha"), "real library reload");
		Require(!Manager.ResolveNativeBinding(unOriginalID, pRuntime, Handler, pData), "reload revokes the old binding ID");
		auto const* const pReloaded = Manager.FindNativeModule(strModuleName);
		Require(pReloaded && (pReloaded->m_vecFunctions.front().m_unID > unOriginalID), "reload allocates a new binding ID");
		Require(Manager.Unload("Fallback") && Manager.Load("Fallback"), "restore registry order for selector checks");
	}

	void CheckManifestControls(SourceJS::ExtensionManager& Manager, SourceJS::RuntimePaths const& Paths, std::filesystem::path const& PathExtensions, std::filesystem::path const& PathLibrary) {
		Manager.Initialize(&Paths, &SourceJS::g_Platform, SourceJS::InvalidateExtensionModules);
		Require(Manager.Unload("Fallback"), "manifest checks use an initialized manager with an empty active registry");

		const unsigned int unLoadBeforeLegacyControls = g_unNativeLoadCount;
		CreateExtension(PathExtensions, PathLibrary, "LegacyAutoload", false, true);
		WriteText(PathExtensions / "LegacyAutoload/extension.json", "{\"autoload\": false}\n");
		Require(!Manager.Load("LegacyAutoload"), "legacy autoload=false rejects explicit load");
		WriteText(PathExtensions / "LegacyAutoload/extension.json", "{\"autoload\" \t\r\n : true}\n");
		Require(!Manager.Load("LegacyAutoload"), "legacy control detection allows JSON whitespace");

		CreateExtension(PathExtensions, PathLibrary, "LegacyBinary", false, true);
		WriteText(PathExtensions / "LegacyBinary/extension.json", "{\"Autoload\": false, \"binary\": \"missing.so\"}\n");
		Require(!Manager.Load("LegacyBinary"), "legacy binary override rejects default-library fallback");

		CreateExtension(PathExtensions, PathLibrary, "MixedLegacy", false, true);
		WriteText(PathExtensions / "MixedLegacy/extension.json", "{\"Description\": \"autoload\", \"Autoload\": false, \"autoload\": false}\n");
		Require(!Manager.Load("MixedLegacy"), "legacy control rejected after a matching descriptive value");
		Require(g_unNativeLoadCount == unLoadBeforeLegacyControls, "legacy rejection precedes native load callbacks");
		Require(Manager.GetExtensions().empty(), "legacy rejection publishes no active record");

		CreateExtension(PathExtensions, PathLibrary, "PascalBinary", false, true);
		std::filesystem::path const PathSelectedBinary = PathExtensions / "PascalBinary" / PathLibrary.filename();
		std::filesystem::copy_file(PathLibrary, PathSelectedBinary);
		WriteText(PathExtensions / "PascalBinary/extension.json", "{\"Autoload\": false, \"Binary\": \"" + PathLibrary.filename().string() + "\"}\n");
		Require(Manager.Load("PascalBinary"), "PascalCase Binary override loads a real library");
		Require((Manager.GetExtensions().size() == 1) && (Manager.GetExtensions().back().m_PathBinary == PathSelectedBinary), "PascalCase Binary overrides the default path");
		Require(Manager.Unload("PascalBinary"), "PascalCase Binary override unloads");

		CreateExtension(PathExtensions, PathLibrary, "Descriptions", false, true);
		WriteText(PathExtensions / "Descriptions/extension.json", "{\"Name\": \"autoload\", \"Description\": \"binary\", \"Autoload\": false}\n");
		Require(Manager.Load("Descriptions"), "legacy words in descriptive values remain valid");
		Require(Manager.Unload("Descriptions"), "descriptive manifest unloads");

		Manager.LoadAll();
		Require((Manager.GetExtensions().size() == 1) && (Manager.GetExtensions()[0].m_strName == "Fallback"), "startup skips PascalCase non-autoload and rejects legacy controls");
		Manager.Shutdown();
		Require(Manager.GetExtensions().empty(), "manifest checks leave no active libraries");
		Require(g_unNativeLoadCount == (g_unNativeUnloadCount + 1), "manifest checks preserve native load/unload balance");
	}
} // namespace

int main(const int nArgumentCount, char** const ppszArguments) {
	constexpr int kExpectedArgumentCount = 4;
	constexpr int kInvalidArgumentExitCode = 2;

	if (nArgumentCount != kExpectedArgumentCount) {
		std::fprintf(stderr, "Usage: ExtensionRegistryContracts <IsolatedRoot> <Library> <LibraryWithoutAPI>\nInvalid arguments exit with code %d.\n", kInvalidArgumentExitCode);
		return kInvalidArgumentExitCode;
	}

	SetMode("");

	std::filesystem::path const PathRoot = ppszArguments[1];
	std::filesystem::path const PathLibrary = ppszArguments[2];
	std::filesystem::path const PathNoAPI = ppszArguments[3];
	std::filesystem::path const PathExtensions = PathRoot / "extensions";
	std::filesystem::path const PathData = PathRoot / "data";
	std::filesystem::create_directories(PathExtensions);
	std::filesystem::create_directories(PathData);

	SourceJS::RuntimePaths Paths(PathRoot, PathExtensions, PathData);
	SourceJS::ExtensionManager Manager {};
	Require(!Manager.Load("Alpha"), "uninitialized manager rejects load");
	Manager.Initialize(&Paths, &SourceJS::g_Platform, SourceJS::InvalidateExtensionModules);
	Require(Manager.List() == std::vector<std::string> { "No extensions loaded." }, "empty list message");
	Require(!Manager.Load("../Escape"), "invalid extension name rejected");
	Require(!Manager.Load("Missing"), "missing extension rejected");

	CreateExtension(PathExtensions, PathLibrary, "Alpha", true, true);
	CreateExtension(PathExtensions, PathLibrary, "Fallback", true, false);
	CreateExtension(PathExtensions, PathLibrary, "Manual", false, true);
	CreateExtension(PathExtensions, PathLibrary, "Failure", false, true);
	CreateExtension(PathExtensions, PathNoAPI, "NoAPI", false, true);
	std::filesystem::create_directories(PathExtensions / "MissingBinary");
	WriteText(PathExtensions / "MissingBinary/extension.json", "{\"Autoload\": false, \"Binary\": \"missing.so\"}\n");

	Manager.LoadAll();
	Require(Manager.GetExtensions().size() == 2, "autoload filtering");
	Require((Manager.GetExtensions()[0].m_strName == "Alpha") && (Manager.GetExtensions()[1].m_strName == "Fallback"), "sorted discovery");

	std::vector<std::string> const vecExtensionList = Manager.List();
	Require(!vecExtensionList.empty() && (vecExtensionList.front().find("1. Alpha [loaded, enabled]") == 0), "list formatting");
	Require(Manager.Load("Alpha") && (Manager.GetExtensions().size() == 2), "duplicate load is idempotent");
	CheckLookup(Manager);

	Require(!Manager.Unload("0") && !Manager.Unload("3") && !Manager.Unload("18446744073709551616"), "selector bounds and overflow");
	Require(Manager.Unload("02") && (Manager.GetExtensions().size() == 1), "one-based selector including leading zero");
	Require(Manager.Load("Manual"), "explicit non-autoload extension");
	Require(Manager.Unload("2"), "last valid selector");
	Require(Manager.Disable("1") && Manager.GetExtensions().empty(), "disable loaded selector");
	Require(!Manager.Load("Alpha"), "disabled extension rejects load");
	Require(Manager.Enable("Alpha"), "enable restores load");
	Require(Manager.Disable("Manual"), "disable unloaded extension by name");
	Require(!Manager.Enable("999"), "unknown numeric enable rejected");

	const unsigned int unLoadBeforeFailures = g_unNativeLoadCount;
	const unsigned int unUnloadBeforeFailures = g_unNativeUnloadCount;
	SetMode("BAD_ABI");
	Require(!Manager.Load("Failure"), "real DSO ABI rejection");
	Require(g_unNativeLoadCount == unLoadBeforeFailures, "ABI rejection precedes load callback");

	SetMode("BAD_V8_ABI");
	Require(!Manager.Load("Failure"), "real DSO V8 ABI rejection");
	Require(g_unNativeLoadCount == unLoadBeforeFailures, "V8 ABI rejection precedes load callback");

	SetMode("REJECT_LOAD");
	Require(!Manager.Load("Failure"), "real DSO load rejection");
	Require(g_unNativeUnloadCount == unUnloadBeforeFailures, "failed load has no unload callback");

	SetMode("REJECT_MODULE");
	Require(!Manager.Load("Failure"), "real DSO module rejection");
	Require(g_unNativeUnloadCount == (unUnloadBeforeFailures + 1), "module rejection rolls back native load");

	SetMode("");
	Require(!Manager.Load("NoAPI") && g_bSymbolDiagnostic, "missing native export diagnostic");
	Require(!Manager.Load("MissingBinary") && g_bOpenDiagnostic, "missing library diagnostic");
	Require(Manager.GetExtensions().size() == 1, "failed loads do not publish records");
	Require(Manager.Load("Failure"), "load succeeds after real DSO failures");
	Require(Manager.Unload("Failure"), "unload recovered DSO");

	Manager.ReloadAll();
	Require(Manager.GetExtensions().size() == 2, "reload all rescans enabled autoload entries");
	Manager.Shutdown();
	Require(Manager.GetExtensions().empty(), "shutdown clears active records");
	Require(g_unNativeLoadCount == (g_unNativeUnloadCount + 1), "all successful native loads unloaded, one rejected load callback");
	Require(g_unInvalidationCount > 0, "cache invalidation exercised");
	Require(g_unErrorCount > 0, "native failure diagnostics exercised");

	std::string strState {};
	Require(SourceJS::ReadTextFile(PathData / "ExtensionsState.json", strState), "read saved state");
	Require(strState == "{\n\t\"Disabled\": [\n\t\t\"Manual\"\n\t]\n}\n", "canonical state serialization");
	WriteText(PathData / "ExtensionsState.json", "{\"Disabled\": [\"Alpha\", \"Alpha\", \"Manual\"]}\n");
	Manager.Initialize(&Paths, &SourceJS::g_Platform, SourceJS::InvalidateExtensionModules);
	Require((Manager.GetExtensions().size() == 1) && (Manager.GetExtensions()[0].m_strName == "Fallback"), "persisted disabled names filter startup");
	Manager.Shutdown();
	Require(SourceJS::ReadTextFile(PathData / "ExtensionsState.json", strState), "read validated saved state");
	Require(strState == "{\n\t\"Disabled\": [\n\t\t\"Alpha\",\n\t\t\"Manual\"\n\t]\n}\n", "state deduplicates valid disabled names");

	char const* const arrInvalidStates[] = {
		"{\"Disabled\": [\"Alpha\", \"../Escape\", \"Manual\"]}\n",
		"{\"Disabled\": [\"Alpha\", \"Bad Name\", \"Manual\"]}\n",
	};
	for (auto const& pszInvalidState : arrInvalidStates) {
		WriteText(PathData / "ExtensionsState.json", pszInvalidState);
		Manager.Initialize(&Paths, &SourceJS::g_Platform, SourceJS::InvalidateExtensionModules);
		Require((Manager.GetExtensions().size() == 2) && (Manager.GetExtensions()[0].m_strName == "Alpha") && (Manager.GetExtensions()[1].m_strName == "Fallback"), "invalid state rejects the entire disabled-name list");
		Manager.Shutdown();
		Require(SourceJS::ReadTextFile(PathData / "ExtensionsState.json", strState), "read state after invalid input");
		Require(strState == "{\n\t\"Disabled\": []\n}\n", "invalid state cannot partially commit disabled names");
	}

	WriteText(PathData / "ExtensionsState.json", "{\"Disabled\": [\"Alpha\", \"Manual\"]}\n");

	CheckManifestControls(Manager, Paths, PathExtensions, PathLibrary);

	std::printf("ExtensionRegistryContracts PASS Assertions=%u\n", g_unAssertionCount);

	return 0;
}
