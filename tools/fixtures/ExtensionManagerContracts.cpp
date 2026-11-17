
// C++
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>

// STL
#include <cctype>
#include <filesystem>
#include <fstream>
#include <limits>
#include <memory>
#include <new>
#include <string>
#include <type_traits>
#include <vector>

// Project
#if defined(SOURCEJS_EXTENSION_ABI_TEST_HEADER)
#include SOURCEJS_EXTENSION_ABI_TEST_HEADER
#endif
#include "ExtensionRuntimeDouble.h"
#include "sourcejs/ExtensionManager.h"
#include "sourcejs/ManagerManifest.h"

// Actual selected production bodies and ABI declarations; library/runtime/registry
// adapters are doubles. This does not execute a DSO, V8, or a running server.
namespace {

	constexpr std::size_t kABIAddressByteCount = sizeof(void*);
	constexpr std::size_t kAPIHeaderByteCount = 2 * sizeof(std::uint32_t);

	static_assert(SOURCEJS_EXTENSION_ABI_VERSION == 3);
	static_assert(std::is_standard_layout_v<SourceJS::SOURCEJS_EXTENSION_CONTEXT> && std::is_trivially_copyable_v<SourceJS::SOURCEJS_EXTENSION_CONTEXT>);
	static_assert(std::is_standard_layout_v<SourceJS::SOURCEJS_EXTENSION_MODULE> && std::is_trivially_copyable_v<SourceJS::SOURCEJS_EXTENSION_MODULE>);
	static_assert(std::is_standard_layout_v<SourceJS::SOURCEJS_EXTENSION_API> && std::is_trivially_copyable_v<SourceJS::SOURCEJS_EXTENSION_API>);
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_CONTEXT, m_pszRootPath) == 0, "SourceJS extension ABI: root");
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_CONTEXT, m_pszSDKBranch) == kABIAddressByteCount, "SourceJS extension ABI: branch");
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_CONTEXT, m_pszPlatform) == (2 * kABIAddressByteCount), "SourceJS extension ABI: platform");
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_CONTEXT, m_pszArchitecture) == (3 * kABIAddressByteCount), "SourceJS extension ABI: architecture");
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_CONTEXT, m_pIsolate) == (5 * kABIAddressByteCount), "SourceJS extension ABI: isolate");
	static_assert(sizeof(SourceJS::SOURCEJS_EXTENSION_CONTEXT) == (7 * kABIAddressByteCount));
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_MODULE, m_unFunctionCount) == kABIAddressByteCount, "SourceJS extension ABI: function count");
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_MODULE, m_pFunctions) == (2 * kABIAddressByteCount), "SourceJS extension ABI: functions");
	static_assert(sizeof(SourceJS::SOURCEJS_EXTENSION_MODULE) == (3 * kABIAddressByteCount));
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_API, m_unSize) == 0);
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_API, m_unABIVersion) == sizeof(std::uint32_t));
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_API, m_pLoad) == (kAPIHeaderByteCount + (2 * kABIAddressByteCount)), "SourceJS extension ABI: load");
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_API, m_pUnload) == (kAPIHeaderByteCount + (3 * kABIAddressByteCount)), "SourceJS extension ABI: unload");
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_API, m_pGetModuleCount) == (kAPIHeaderByteCount + (4 * kABIAddressByteCount)), "SourceJS extension ABI: module count");
	static_assert(offsetof(SourceJS::SOURCEJS_EXTENSION_API, m_pGetModule) == (kAPIHeaderByteCount + (5 * kABIAddressByteCount)));
	static_assert(sizeof(SourceJS::SOURCEJS_EXTENSION_API) == (kAPIHeaderByteCount + (6 * kABIAddressByteCount)));

	enum class FailurePoint {
		None = 0,
		Build,
		Disabled,
		Open,
		Symbol,
		ExportReject,
		ExportThrow,
		ABI,
		LoadReject,
		LoadThrow,
		CountThrow,
		ModuleReject,
		ModuleThrow,
		RootAllocation,
		ModuleAllocation
	};

	struct FixtureState {
		FailurePoint m_Failure;
		std::string m_strModuleName;
		SourceJS::SOURCEJS_EXTENSION_FUNCTION m_arrFunctions[2];
		std::uint32_t m_unFunctionCount;
		std::vector<std::string> m_vecModuleNames;
		std::uint32_t m_unModuleCount;
		unsigned int m_unOpenCount;
		unsigned int m_unCloseCount;
		unsigned int m_unLoadCount;
		unsigned int m_unUnloadCount;
		unsigned int m_unInvalidateCount;
		unsigned int m_unExceptionDestructionCount;
		bool m_bThrowUnload;
		bool m_bRemoveFailure;
		bool m_bNoLoadCallback;
		bool m_bNoUnloadCallback;

		bool m_bDuplicateModule;
		bool m_bRejectSecondModule;
		bool m_bNullModuleName;
		bool m_bNullFunctions;
	};

	constexpr std::uint32_t kExpectedMaximumModuleCount = 128;
	constexpr std::size_t kExpectedMaximumModuleNameLength = 256;
	constexpr std::uint32_t kExpectedMaximumFunctionCount = 256;

	FixtureState* g_pState = nullptr;
	bool g_bFailNextAllocation = false;
	unsigned int g_unScenarioCount = 0;

	void Require(const bool bCondition, char const* const pszMessage) noexcept {
		if (!bCondition) {
			std::fprintf(stderr, "ExtensionManagerContracts failed: %s\n", pszMessage);
			std::exit(1);
		}
	}

	struct NativeFailure {
		~NativeFailure() noexcept {
			Require(g_pState->m_unCloseCount == 0, "native exception destroyed after library close");
			++g_pState->m_unExceptionDestructionCount;
		}
	};

	std::uint32_t GetModuleCount() {
		if (g_pState->m_Failure == FailurePoint::CountThrow) {
			throw NativeFailure {};
		}

		return g_pState->m_unModuleCount;
	}

	void Echo(v8::FunctionCallbackInfo<v8::Value> const&) {
	}

	bool GetModule(const std::uint32_t unModuleIndex, SourceJS::PSOURCEJS_EXTENSION_MODULE pModule) {
		Require(pModule && (unModuleIndex < g_pState->m_unModuleCount), "module output and index range");

		if (g_pState->m_Failure == FailurePoint::ModuleThrow) {
			throw NativeFailure {};
		}

		if ((g_pState->m_Failure == FailurePoint::ModuleReject) || (g_pState->m_bRejectSecondModule && (unModuleIndex == 1))) {
			return false;
		}

		pModule->m_pszName = g_pState->m_bNullModuleName ? nullptr : g_pState->m_strModuleName.c_str();
		pModule->m_unFunctionCount = g_pState->m_unFunctionCount;
		pModule->m_pFunctions = g_pState->m_bNullFunctions ? nullptr : g_pState->m_arrFunctions;

		if ((unModuleIndex != 0) && !g_pState->m_bDuplicateModule) {
			pModule->m_pszName = "Second";
		}

		if (!g_pState->m_vecModuleNames.empty()) {
			Require(unModuleIndex < g_pState->m_vecModuleNames.size(), "fixture module name index");
			pModule->m_pszName = g_pState->m_vecModuleNames[unModuleIndex].c_str();
		}

		if (g_pState->m_Failure == FailurePoint::ModuleAllocation) {
			g_bFailNextAllocation = true;
		}

		return true;
	}

	bool LoadExtension(SourceJS::SOURCEJS_EXTENSION_CONTEXT const* const pContext) {
		++g_pState->m_unLoadCount;
		Require(pContext && pContext->m_pszRootPath && pContext->m_pLog, "load context");
		Require(pContext->m_pszSDKBranch && (std::strcmp(pContext->m_pszSDKBranch, SOURCEJS_SDK_BRANCH) == 0), "SDK context");
		Require(pContext->m_pszPlatform && (std::strcmp(pContext->m_pszPlatform, SOURCEJS_TARGET_PLATFORM) == 0), "platform context");
		Require(pContext->m_pszArchitecture && (std::strcmp(pContext->m_pszArchitecture, SOURCEJS_TARGET_ARCH) == 0), "architecture context");
		pContext->m_pLog("native fixture");

		if (g_pState->m_Failure == FailurePoint::LoadThrow) {
			throw NativeFailure {};
		}

		return g_pState->m_Failure != FailurePoint::LoadReject;
	}

	void UnloadExtension() {
		++g_pState->m_unUnloadCount;
		Require(g_pState->m_unCloseCount == 0, "unload precedes close");

		if (g_pState->m_bThrowUnload) {
			throw NativeFailure {};
		}
	}

	bool GetExtensionAPI(const std::uint32_t unVersion, const std::uint32_t unCapacity, SourceJS::PSOURCEJS_EXTENSION_API pAPI) {
		Require(pAPI && (unVersion == SOURCEJS_EXTENSION_ABI_VERSION) && (unCapacity == sizeof(*pAPI)), "extension API handshake");
		if (g_pState->m_Failure == FailurePoint::ExportThrow) {
			throw NativeFailure {};
		}

		pAPI->m_unSize = sizeof(*pAPI);
		pAPI->m_pszV8ABI = SOURCEJS_EXTENSION_V8_ABI;
		pAPI->m_unABIVersion = (g_pState->m_Failure == FailurePoint::ABI) ? (SOURCEJS_EXTENSION_ABI_VERSION + 1) : SOURCEJS_EXTENSION_ABI_VERSION;
		pAPI->m_pLoad = g_pState->m_bNoLoadCallback ? nullptr : LoadExtension;
		pAPI->m_pUnload = g_pState->m_bNoUnloadCallback ? nullptr : UnloadExtension;
		pAPI->m_pGetModuleCount = GetModuleCount;
		pAPI->m_pGetModule = GetModule;

		if (g_pState->m_Failure == FailurePoint::RootAllocation) {
			g_bFailNextAllocation = true;
		}

		return g_pState->m_Failure != FailurePoint::ExportReject;
	}

	// Non-allocating diagnostic double: rollback must remain safe during bad_alloc.
	void WriteLog(char const* const pszFormat, va_list Arguments) noexcept {
		constexpr std::size_t kMessageBufferByteCount = 2048;

		char szMessage[kMessageBufferByteCount] {};
		Require(std::vsnprintf(szMessage, sizeof(szMessage), pszFormat, Arguments) > 0, "diagnostic format");
	}
} // namespace

void* operator new(const std::size_t unSize) {
	if (g_bFailNextAllocation) {
		g_bFailNextAllocation = false;
		throw std::bad_alloc {};
	}

	void* const pAllocation = std::malloc((unSize == 0) ? 1 : unSize);
	if (!pAllocation) {
		throw std::bad_alloc {};
	}

	return pAllocation;
}

void* operator new[](const std::size_t unSize) {
	return ::operator new(unSize);
}

void operator delete(void* const pAllocation) noexcept {
	std::free(pAllocation);
}

void operator delete[](void* const pAllocation) noexcept {
	::operator delete(pAllocation);
}

void operator delete(void* const pAllocation, std::size_t) noexcept {
	::operator delete(pAllocation);
}

void operator delete[](void* const pAllocation, std::size_t) noexcept {
	::operator delete(pAllocation);
}

namespace SourceJS {

	class RuntimePaths {
	public:
		explicit RuntimePaths(std::filesystem::path const& PathRoot) noexcept;
		std::filesystem::path const& GetAddonRootPath() const noexcept;

	private:
		std::filesystem::path const& m_PathRoot;
	};

	RuntimePaths::RuntimePaths(std::filesystem::path const& PathRoot) noexcept :
		m_PathRoot(PathRoot)
	{
	}

	std::filesystem::path const& RuntimePaths::GetAddonRootPath() const noexcept {
		return m_PathRoot;
	}

	v8::Platform g_Platform {};

	void InvalidateExtensionModules(void*, std::string const& strName) {
		Require(!strName.empty(), "cache name");
		++g_pState->m_unInvalidateCount;
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
		va_list Arguments;
		va_start(Arguments, pszFormat);
		WriteLog(pszFormat, Arguments);
		va_end(Arguments);
	}

	namespace {
		// SOURCEJS_EXTENSION_HELPERS
	} // namespace

	// SOURCEJS_EXTENSION_METHODS

	ExtensionRecord* ExtensionManager::ResolveByName(std::string const& strName) noexcept {
		for (auto& Record : m_vecExtensions) {
			if (Record.m_strName == strName) {
				return &Record;
			}
		}

		return nullptr;
	}

	ExtensionRecord* ExtensionManager::Resolve(std::string const& strSelector) noexcept {
		if ((strSelector == "1") && !m_vecExtensions.empty()) {
			return &m_vecExtensions.front();
		}

		return ResolveByName(strSelector);
	}

	bool ExtensionManager::RemoveRecord(std::string const& strName) {
		if (g_pState->m_bRemoveFailure) {
			return false;
		}

		for (auto itRecord = m_vecExtensions.begin(); itRecord != m_vecExtensions.end(); ++itRecord) {
			if (itRecord->m_strName == strName) {
				m_vecExtensions.erase(itRecord);
				return true;
			}
		}

		return false;
	}

	std::vector<std::string> ExtensionManager::DiscoverNames() const {
		return {};
	}

	void* ExtensionManager::OpenLibrary(std::filesystem::path const&) const {
		++g_pState->m_unOpenCount;

		return (g_pState->m_Failure == FailurePoint::Open) ? nullptr : g_pState;
	}

	void* ExtensionManager::ResolveSymbol(void* const hLibraryHandle, char const* const pszSymbolName) const noexcept {
		Require((hLibraryHandle == g_pState) && pszSymbolName && (std::strcmp(pszSymbolName, "SourceJS_GetNativeExtensionAPI") == 0), "symbol boundary");

		// Match the production OS-loader function/object-address conversion boundary.
		return (g_pState->m_Failure == FailurePoint::Symbol) ? nullptr : reinterpret_cast<void*>(GetExtensionAPI);
	}

	bool ExtensionManager::CloseLibrary(void* const hLibraryHandle) const noexcept {
		Require(hLibraryHandle == g_pState, "owned library identity");
		++g_pState->m_unCloseCount;

		return true;
	}

	bool ExtensionManager::IsLibraryMapped(std::filesystem::path const&) const noexcept {
		return false;
	}

	void ExtensionManager::LoadState() {
	}

	void ExtensionManager::SaveState() const {
	}

	bool ExtensionManager::IsDisabledInState(std::string const&) const noexcept {
		return false;
	}

	bool ExtensionManager::BuildRecord(std::string const& strName, ExtensionRecord& RecordOut) const {
		if (g_pState->m_Failure == FailurePoint::Build) {
			return false;
		}

		ExtensionRecord Candidate {};
		Candidate.m_strName = strName;
		Candidate.m_PathBinary = "FixtureLibrary";
		Candidate.m_bEnabled = g_pState->m_Failure != FailurePoint::Disabled;
		Candidate.m_bAutoLoad = true;
		RecordOut = std::move(Candidate);

		return true;
	}

	std::vector<ExtensionRecord> const& ExtensionManager::GetExtensions() const noexcept {
		return m_vecExtensions;
	}
} // namespace SourceJS

namespace {

	void PrepareState(FixtureState& State) {
		State.m_strModuleName = "Echo";
		State.m_unFunctionCount = 1;
		State.m_arrFunctions[0] = { "Echo", Echo, nullptr };
		State.m_unModuleCount = 1;
		g_pState = &State;
	}

	void CheckLoadFailure(std::filesystem::path const& PathRoot, const FailurePoint Failure, const bool bThrowUnload = false) {
		FixtureState State {};
		PrepareState(State);
		State.m_Failure = Failure;
		State.m_bThrowUnload = bThrowUnload;
		SourceJS::RuntimePaths Paths(PathRoot);
		SourceJS::ExtensionManager Manager {};
		Manager.Initialize(&Paths, &SourceJS::g_Platform, SourceJS::InvalidateExtensionModules);
		bool bLoaded = false;
		bool bAllocationFailure = false;
		try {
			bLoaded = Manager.Load("Fixture");
		} catch (std::bad_alloc const&) {
			bAllocationFailure = true;
		}

		const bool bExpectedAllocationFailure = (Failure == FailurePoint::RootAllocation) || (Failure == FailurePoint::ModuleAllocation);
		const bool bExpectedOpen = (Failure != FailurePoint::Build) && (Failure != FailurePoint::Disabled);
		const bool bExpectedUnload = (Failure == FailurePoint::LoadThrow) || ((Failure >= FailurePoint::CountThrow) && (Failure != FailurePoint::RootAllocation));
		const bool bExpectedNativeException = (Failure == FailurePoint::ExportThrow) || (Failure == FailurePoint::LoadThrow) || (Failure == FailurePoint::CountThrow) || (Failure == FailurePoint::ModuleThrow) || bThrowUnload;
		Require(!bLoaded && (bAllocationFailure == bExpectedAllocationFailure), "failed load result");
		Require(Manager.GetExtensions().size() == static_cast<std::size_t>(bThrowUnload), "only failed cleanup retains a record");
		if (bThrowUnload) {
			Require(!Manager.GetExtensions().front().m_bLoaded && (State.m_unCloseCount == 0), "failed cleanup retained a revoked library");
			State.m_bThrowUnload = false;
			Require(Manager.Unload("Fixture"), "retry cleanup after rejected load");
		}
		Require(State.m_unOpenCount == static_cast<unsigned int>(bExpectedOpen), "open count on failure");
		Require(State.m_unCloseCount == static_cast<unsigned int>(bExpectedOpen && (Failure != FailurePoint::Open)), "library leaked on failure");
		Require(State.m_unUnloadCount == (static_cast<unsigned int>(bExpectedUnload) + static_cast<unsigned int>(bThrowUnload)), "rollback unload contract");
		Require(State.m_unExceptionDestructionCount == static_cast<unsigned int>(bExpectedNativeException), "native exception destruction count");
		Require(!g_bFailNextAllocation, "allocation injection was not reached");
		Manager.Shutdown();
		++g_unScenarioCount;
	}

	void CheckLifecycle(std::filesystem::path const& PathRoot, const unsigned int unVariant) {
		FixtureState State {};
		PrepareState(State);
		State.m_bNoLoadCallback = unVariant == 1;
		State.m_bNoUnloadCallback = unVariant == 2;
		SourceJS::RuntimePaths Paths(PathRoot);
		SourceJS::ExtensionManager Manager {};
		Require(!Manager.Load("Fixture"), "load before initialization");
		Manager.Initialize(nullptr, nullptr);
		Manager.Initialize(&Paths, &SourceJS::g_Platform, SourceJS::InvalidateExtensionModules);
		Require(!Manager.Load("123"), "numeric load selector");
		Require(Manager.Load("Fixture"), "valid load");
		Require(Manager.GetExtensions().size() == 1, "published record count");
		Require(Manager.GetExtensions().front().m_bLoaded, "published loaded flag");
		Require(Manager.Load("Fixture") && (State.m_unOpenCount == 1), "duplicate load");
		Require(!Manager.Unload("Missing") && !Manager.Reload("Missing"), "missing selectors");
		std::vector<SourceJS::ExtensionNativeModule> const& vecModules = Manager.GetExtensions().front().m_vecNativeModules;
		Require(vecModules.size() == 1, "published module count");
		SourceJS::ExtensionNativeModule const& Module = vecModules.front();
		Require((Module.m_strName == ("extensions/Fixture/" + State.m_strModuleName)) && (Module.m_vecFunctions.size() == 1), "published module content");
		Require((Module.m_vecFunctions.front().m_strName == "Echo") && (Module.m_vecFunctions.front().m_Invoke == Echo) && (Module.m_vecFunctions.front().m_unID == 1), "published binding");

		if (unVariant == 4) {
			State.m_bThrowUnload = true;
			Require(!Manager.Reload("Fixture"), "reload continued after failed unload");
			Require(!Manager.GetExtensions().front().m_bLoaded && (State.m_unCloseCount == 0), "retained failed unload");
			State.m_bThrowUnload = false;
			Require(Manager.Unload("Fixture"), "retry failed unload");

		} else if (unVariant == 5) {
			State.m_bRemoveFailure = true;
			Manager.Shutdown();
			Require(Manager.GetExtensions().size() == 1, "shutdown lost failed record");
			State.m_bRemoveFailure = false;
			Require(Manager.Unload("Fixture"), "retry record removal");

		} else {
			Require(Manager.Unload("1"), "normal unload");
		}

		Require(Manager.GetExtensions().empty(), "unload retained active record");
		Require((State.m_unOpenCount == 1) && (State.m_unCloseCount == 1), "library released exactly once");
		Require(State.m_unInvalidateCount == static_cast<unsigned int>(((unVariant == 4) || (unVariant == 5)) ? 2 : 1), "cache invalidation count");
		Require(State.m_unLoadCount == static_cast<unsigned int>(!State.m_bNoLoadCallback), "load callback count");
		Require(State.m_unUnloadCount == (static_cast<unsigned int>(unVariant != 2) + static_cast<unsigned int>(unVariant == 4)), "unload callback count");
		Require(State.m_unExceptionDestructionCount == static_cast<unsigned int>(unVariant == 4), "unload exception destruction count");
		Manager.Shutdown();
		Manager.Shutdown();
		++g_unScenarioCount;
	}

	void CheckModuleTable() {
		FixtureState State {};
		PrepareState(State);
		SourceJS::SOURCEJS_EXTENSION_API API {};
		Require(GetExtensionAPI(SOURCEJS_EXTENSION_ABI_VERSION, sizeof(API), &API), "fixture API");
		std::uint64_t unLastBindingID = 41;
		std::vector<SourceJS::ExtensionNativeModule> vecModules { { "Sentinel", {} } };
		auto const CheckRejected = [&API, &unLastBindingID, &vecModules]() {
			Require(!SourceJS::ReadExtensionNativeModules("Fixture", API, unLastBindingID, vecModules), "invalid module table accepted");
			Require((vecModules.size() == 1) && (vecModules.front().m_strName == "Sentinel") && (unLastBindingID == 41), "failure overwrote module output or binding ID");
			++g_unScenarioCount;
		};

		API.m_pGetModule = nullptr;
		CheckRejected();

		API.m_pGetModule = GetModule;
		API.m_pGetModuleCount = nullptr;
		CheckRejected();

		API.m_pGetModuleCount = GetModuleCount;
		State.m_unModuleCount = kExpectedMaximumModuleCount + 1;
		CheckRejected();

		State.m_unModuleCount = 2;
		State.m_bDuplicateModule = true;
		CheckRejected();

		State.m_bDuplicateModule = false;
		State.m_bRejectSecondModule = true;
		CheckRejected();

		State.m_bRejectSecondModule = false;
		State.m_unModuleCount = 1;
		State.m_bNullModuleName = true;
		CheckRejected();

		State.m_bNullModuleName = false;
		State.m_bNullFunctions = true;
		CheckRejected();

		State.m_bNullFunctions = false;
		State.m_strModuleName.assign(kExpectedMaximumModuleNameLength, 'A');
		CheckRejected();

		State.m_strModuleName = "../Escape";
		CheckRejected();

		State.m_strModuleName.assign(kExpectedMaximumModuleNameLength - 1, 'A');
		State.m_unFunctionCount = kExpectedMaximumFunctionCount + 1;
		CheckRejected();

		State.m_unFunctionCount = 0;
		CheckRejected();

		State.m_unFunctionCount = 1;
		State.m_arrFunctions[0].m_Invoke = nullptr;
		CheckRejected();

		State.m_arrFunctions[0] = { "echo", Echo, nullptr };
		CheckRejected();

		State.m_arrFunctions[0] = { "Echo", Echo, nullptr };
		State.m_arrFunctions[1] = State.m_arrFunctions[0];
		State.m_unFunctionCount = 2;
		CheckRejected();

		State.m_unFunctionCount = 1;
		Require(SourceJS::ReadExtensionNativeModules("Fixture", API, unLastBindingID, vecModules), "maximum valid name length");
		Require((vecModules.size() == 1) && (vecModules.front().m_strName == ("extensions/Fixture/" + State.m_strModuleName)) && (unLastBindingID == 42), "module copy and prefix");

		State.m_unModuleCount = kExpectedMaximumModuleCount;
		for (std::uint32_t unModuleIndex = 0; unModuleIndex < State.m_unModuleCount; ++unModuleIndex) {
			State.m_vecModuleNames.push_back("Module" + std::to_string(unModuleIndex));
		}

		Require(SourceJS::ReadExtensionNativeModules("Fixture", API, unLastBindingID, vecModules) && (vecModules.size() == kExpectedMaximumModuleCount), "maximum module count");
		Require(unLastBindingID == (42 + kExpectedMaximumModuleCount), "one ID per binding");

		vecModules = { { "Sentinel", {} } };
		unLastBindingID = 41;
		State.m_unModuleCount = 0;
		CheckRejected();
		API = {};
		CheckRejected();
		++g_unScenarioCount;
	}

	void CheckFileHelpers(std::filesystem::path const& PathRoot) {
		constexpr std::size_t kReadSizes[] = { 0, 1, 4095, 4096, 4097, 8192, 8193 };
		constexpr std::size_t kBoundedExtensionTextByteCount = 8;

		std::filesystem::path const PathFile = PathRoot / "Binary.dat";
		for (auto const& unSize : kReadSizes) {
			std::string strExpected = std::string(unSize, 'A');
			if (!strExpected.empty()) {
				strExpected[unSize / 2] = '\0';
			}

			{
				std::ofstream OutputFile(PathFile, std::ios::binary);

				OutputFile.write(strExpected.data(), static_cast<std::streamsize>(strExpected.size()));
				Require(static_cast<bool>(OutputFile), "fixture file write");
			}

			std::string strActual = "Sentinel";
			Require(SourceJS::ReadTextFile(PathFile, strActual) && (strActual == strExpected), "binary read boundary");
			++g_unScenarioCount;
		}

		std::string strOutput = "Sentinel";
		Require(!SourceJS::ReadTextFile(PathRoot / "Missing", strOutput) && (strOutput == "Sentinel"), "missing read commits output");
		Require(!SourceJS::ReadTextFile(PathRoot, strOutput) && (strOutput == "Sentinel"), "directory read commits output");
		Require(!SourceJS::CopyBoundedExtensionText(nullptr, kBoundedExtensionTextByteCount, strOutput), "null text");
		Require(!SourceJS::CopyBoundedExtensionText("12345678", kBoundedExtensionTextByteCount, strOutput) && (strOutput == "Sentinel"), "unterminated boundary commits output");
		Require(SourceJS::CopyBoundedExtensionText("1234567", kBoundedExtensionTextByteCount, strOutput) && (strOutput == "1234567"), "bounded copy");
		Require(SourceJS::IsDecimalText("0123") && !SourceJS::IsDecimalText("") && !SourceJS::IsDecimalText("1A"), "decimal names");
		Require(SourceJS::IsValidExtensionName("Echo-1.2") && !SourceJS::IsValidExtensionName("../Echo") && !SourceJS::IsValidExtensionName(".."), "extension names");

		for (auto const& pszName : { "", "/A", "A/", "A//B", "A/./B", "A/../B", "A\\B", "A:B", "\xC3\xA9" }) {
			Require(!SourceJS::IsValidExtensionModuleName(pszName), "invalid module path");
			++g_unScenarioCount;
		}

		Require(SourceJS::IsValidExtensionModuleName("Directory/Module-1.js"), "valid module path");
		Require(!SourceJS::IsValidExtensionModuleName(std::string(kExpectedMaximumModuleNameLength, 'A')), "module path maximum");
		std::vector<std::string> vecNames { "First", "Second" };
		Require(SourceJS::ContainsExtensionName(vecNames, "Second"), "contains extension");
		SourceJS::RemoveExtensionName(vecNames, "First");
		SourceJS::RemoveExtensionName(vecNames, "Missing");
		Require((vecNames.size() == 1) && (vecNames.front() == "Second"), "remove extension");
		Require(SourceJS::ReadManifestString(PathRoot / "Missing", "Binary", "Fallback") == "Fallback", "missing string fallback");
		Require(SourceJS::ReadManifestBoolean(PathRoot / "Missing", "Autoload", true), "missing boolean fallback");

		{
			std::ofstream OutputFile(PathFile, std::ios::binary);

			OutputFile << "{\"Binary\":\"bin\\/\\u0046ixture\",\"Autoload\": false}";
			Require(static_cast<bool>(OutputFile), "manifest fixture write");
		}

		Require(SourceJS::ReadManifestString(PathFile, "Binary", "Fallback") == "bin/Fixture", "manifest string");
		Require(!SourceJS::ReadManifestBoolean(PathFile, "Autoload", true), "manifest boolean");

		for (auto const& pszEncodedValue : { "\"\\x\"", "\"\\u12\"", "\"\\uD800\"", "\"\\uDC00\"", "\"Unterminated" }) {
			{
				std::ofstream OutputFile(PathFile, std::ios::binary);

				OutputFile << "{\"Binary\":" << pszEncodedValue << '}';
				Require(static_cast<bool>(OutputFile), "malformed manifest fixture write");
			}

			Require(SourceJS::ReadManifestString(PathFile, "Binary", "Fallback") == "Fallback", "malformed manifest string fallback");
		}

		{
			std::ofstream OutputFile(PathFile, std::ios::binary);

			OutputFile << "{\"Binary\":\"\\u0000\"}";
			Require(static_cast<bool>(OutputFile), "NUL manifest fixture write");
		}

		Require(SourceJS::ReadManifestString(PathFile, "Binary", "Fallback") == std::string(1, '\0'), "decoded NUL reaches path validation");
		Require(SourceJS::BuildDefaultBinaryPath(PathRoot, "Fixture").parent_path() == (PathRoot / "bin"), "default binary fallback");
		SourceJS::LogExtensionMessage(nullptr);
		++g_unScenarioCount;
	}
} // namespace

int main(const int nArgumentCount, char** ppszArguments) {
	constexpr int kExpectedArgumentCount = 2;
	constexpr unsigned int kLifecycleVariantCount = 6;

	Require(nArgumentCount == kExpectedArgumentCount, "expected isolated data directory");
	std::filesystem::path const PathRoot = ppszArguments[1];
	Require(std::filesystem::is_directory(PathRoot), "data directory exists");

	for (std::size_t unFailureIndex = 1; unFailureIndex <= static_cast<std::size_t>(FailurePoint::ModuleAllocation); ++unFailureIndex) {
		CheckLoadFailure(PathRoot, static_cast<FailurePoint>(unFailureIndex));
	}

	CheckLoadFailure(PathRoot, FailurePoint::ModuleReject, true);

	for (unsigned int unVariant = 0; unVariant < kLifecycleVariantCount; ++unVariant) {
		CheckLifecycle(PathRoot, unVariant);
	}

	CheckModuleTable();
	CheckFileHelpers(PathRoot);

	g_pState = nullptr;

	std::printf("ExtensionManagerContracts PASS Scenarios=%u\n", g_unScenarioCount);

	return 0;
}
