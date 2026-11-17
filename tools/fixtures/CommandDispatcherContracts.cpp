
// C++
#include <cstddef>
#include <cstdio>
#include <cstdlib>

// STL
#include <cctype>
#include <exception>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#define SOURCEJS_VERSION "fixture"
#define SOURCEJS_TARGET_PLATFORM "fixture"
#define SOURCEJS_TARGET_ARCH "fixture"
#define SOURCEJS_SDK_BRANCH "fixture"

namespace SourceJS {

	// Manager/log doubles isolate routing, not engine IO or manager side effects.
	struct PluginRecord {
		bool m_bLoaded;
	};

	struct ExtensionRecord {
		bool m_bLoaded;
	};

	constinit std::vector<std::string>* g_pLogMessages = nullptr;

	void LogInfo(char const* const pszFormat, ...) {
		g_pLogMessages->emplace_back(pszFormat);
	}

	void LogWarning(char const* const pszFormat, ...) {
		g_pLogMessages->emplace_back(pszFormat);
	}

	template <typename TRecord>
	class ManagerDouble {
	public:
		explicit ManagerDouble(std::string const& strKind);
		bool Load(std::string const& strSelector);
		bool Unload(std::string const& strSelector);
		bool Reload(std::string const& strSelector);
		bool Disable(std::string const& strSelector);
		bool Enable(std::string const& strSelector);
		void UnloadAll();
		void ReloadAll();
		std::vector<std::string> List();
		std::vector<TRecord> const& GetPlugins() const;
		std::vector<TRecord> const& GetExtensions() const;

	private:
		void Record(char const* const pszAction, std::string const& strSelector);

	public:
		std::string m_strKind;
		std::vector<TRecord> m_vecRecords;
		std::vector<std::string> m_vecCalls;
		bool m_bOperationResult;
	};

	template <typename TRecord>
	ManagerDouble<TRecord>::ManagerDouble(std::string const& strKind) :
		m_strKind(strKind)
	{
		m_vecRecords.push_back(TRecord { false });
		m_vecRecords.push_back(TRecord { true });
		m_bOperationResult = true;
	}

	template <typename TRecord>
	void ManagerDouble<TRecord>::Record(char const* const pszAction, std::string const& strSelector) {
		m_vecCalls.push_back(m_strKind + "|" + pszAction + "|" + strSelector);
	}

	template <typename TRecord>
	bool ManagerDouble<TRecord>::Load(std::string const& strSelector) {
		Record("load", strSelector);

		return m_bOperationResult;
	}

	template <typename TRecord>
	bool ManagerDouble<TRecord>::Unload(std::string const& strSelector) {
		Record("unload", strSelector);

		return m_bOperationResult;
	}

	template <typename TRecord>
	bool ManagerDouble<TRecord>::Reload(std::string const& strSelector) {
		Record("reload", strSelector);

		return m_bOperationResult;
	}

	template <typename TRecord>
	bool ManagerDouble<TRecord>::Disable(std::string const& strSelector) {
		Record("disable", strSelector);

		return m_bOperationResult;
	}

	template <typename TRecord>
	bool ManagerDouble<TRecord>::Enable(std::string const& strSelector) {
		Record("enable", strSelector);

		return m_bOperationResult;
	}

	template <typename TRecord>
	void ManagerDouble<TRecord>::UnloadAll() {
		Record("unload_all", "");
	}

	template <typename TRecord>
	void ManagerDouble<TRecord>::ReloadAll() {
		Record("reload_all", "");
	}

	template <typename TRecord>
	std::vector<std::string> ManagerDouble<TRecord>::List() {
		Record("list", "");

		return { m_strKind + " list" };
	}

	template <typename TRecord>
	std::vector<TRecord> const& ManagerDouble<TRecord>::GetPlugins() const {
		return m_vecRecords;
	}

	template <typename TRecord>
	std::vector<TRecord> const& ManagerDouble<TRecord>::GetExtensions() const {
		return m_vecRecords;
	}

	using PluginManager = ManagerDouble<PluginRecord>;
	using ExtensionManager = ManagerDouble<ExtensionRecord>;

	class ModuleRegistry {
	public:
		std::vector<std::string> const& GetNativeModules() const;

	private:
		std::vector<std::string> m_vecModules;
	};

	std::vector<std::string> const& ModuleRegistry::GetNativeModules() const {
		return m_vecModules;
	}

	class V8Runtime {
	public:
		void DispatchAuthenticationCommand(std::vector<std::string> const& vecArguments) {
			m_vecArguments = vecArguments;
		}

		std::vector<std::string> m_vecArguments;
	};

	class CommandDispatcher {
	public:
		CommandDispatcher() noexcept;
		void Initialize(PluginManager* const pPluginManager, ExtensionManager* const pExtensionManager, ModuleRegistry const* const pModuleRegistry, V8Runtime* const pRuntime) noexcept;
		void Shutdown() noexcept;
		void Dispatch(std::vector<std::string> const& vecArguments);

	private:
		void PrintRoot() const;
		void PrintVersion() const;
		void PrintModules() const;
		void DispatchPlugins(std::vector<std::string> const& vecArguments, const std::size_t unActionArgumentIndex);
		void DispatchExtensions(std::vector<std::string> const& vecArguments, const std::size_t unActionArgumentIndex);
		void PrintLines(std::vector<std::string> const& vecLines) const;
		void PrintClientLine(const int nClientIndex, std::string const& strLine) const;

	public:
		// Test-only access; this reduced class is not an SDK/ABI layout fixture.
		bool RequireSelector(std::vector<std::string> const& vecArguments, const std::size_t unSelectorArgumentIndex, char const* const pszUsage, std::string& strSelectorOut) const;
		bool ReadClientPageOffset(const int nClientIndex, std::vector<std::string> const& vecArguments, const std::size_t unOffsetArgumentIndex, char const* const pszCommandKind, std::size_t& unPageOffsetOut) const;

	private:
		PluginManager* m_pPluginManager;
		ExtensionManager* m_pExtensionManager;
		ModuleRegistry const* m_pModuleRegistry;
		V8Runtime* m_pRuntime;
	};

	namespace {

		// SOURCEJS_DISPATCHER_HELPERS

	} // namespace

	// SOURCEJS_DISPATCHER_METHODS

	void CommandDispatcher::PrintLines(std::vector<std::string> const& vecLines) const {
		g_pLogMessages->insert(g_pLogMessages->end(), vecLines.begin(), vecLines.end());
	}

	void CommandDispatcher::PrintClientLine(const int nClientIndex, std::string const& strLine) const {
		g_pLogMessages->push_back(std::to_string(nClientIndex) + "|" + strLine);
	}
} // namespace SourceJS

#undef SOURCEJS_VERSION
#undef SOURCEJS_TARGET_PLATFORM
#undef SOURCEJS_TARGET_ARCH
#undef SOURCEJS_SDK_BRANCH

namespace {

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	bool HasLog(std::vector<std::string> const& vecLogs, char const* const pszMessage) {
		for (auto const& strLog : vecLogs) {
			if (strLog.find(pszMessage) != std::string::npos) {
				return true;
			}
		}

		return false;
	}
} // namespace

int main() {
	constexpr bool kPrefixModes[] = { false, true };
	constexpr char const* const kManagerKinds[] = { "plugins", "extensions" };
	constexpr char const* const kSelectorActions[] = { "load", "unload", "reload", "disable", "enable" };
	constexpr char const* const kBulkActions[] = { "unload_all", "reload_all" };
	constexpr char const* const kInvalidOffsets[] = { "", "-10", "+10", " 10", "10 ", "1", "11", "10x", "18446744073709551615", "184467440737095516150" };
	constexpr std::size_t kPreservedOffset = 37;
	constexpr unsigned long long kWidePageOffset = 4'294'967'300;

	try {
		std::vector<std::string> vecLogs {};
		SourceJS::g_pLogMessages = &vecLogs;
		SourceJS::PluginManager Plugins("plugins");
		SourceJS::ExtensionManager Extensions("extensions");
		SourceJS::ModuleRegistry Registry {};
		SourceJS::V8Runtime Runtime {};
		SourceJS::CommandDispatcher Dispatcher {};
		std::size_t unScenarioCount = 0;
		auto CheckDispatch = [&Dispatcher, &Plugins, &Extensions, &vecLogs, &unScenarioCount](const bool bWithRoot, std::vector<std::string> const& vecArguments, std::vector<std::string> const& vecExpectedCalls, char const* const pszExpectedDiagnostic) {
			vecLogs.clear();
			Plugins.m_vecCalls.clear();
			Extensions.m_vecCalls.clear();
			std::vector<std::string> vecActualArguments = vecArguments;
			if (bWithRoot) {
				vecActualArguments.insert(vecActualArguments.begin(), "sjs");
			}

			Dispatcher.Dispatch(vecActualArguments);
			std::vector<std::string> vecActualCalls = Plugins.m_vecCalls;
			vecActualCalls.insert(vecActualCalls.end(), Extensions.m_vecCalls.begin(), Extensions.m_vecCalls.end());
			Require(vecActualCalls == vecExpectedCalls, "Unexpected manager operation or missing route.");

			if (pszExpectedDiagnostic) {
				Require(HasLog(vecLogs, pszExpectedDiagnostic), "Expected dispatcher diagnostic missing.");
			}

			++unScenarioCount;
		};

		CheckDispatch(true, { "plugins", "load", "example" }, {}, "DispatchPlugins failed");
		CheckDispatch(true, { "extensions", "load", "example" }, {}, "DispatchExtensions failed");
		CheckDispatch(true, { "modules" }, {}, "PrintModules failed");
		CheckDispatch(true, { "auth" }, {}, "runtime is not initialized");
		Dispatcher.Initialize(&Plugins, &Extensions, &Registry, &Runtime);
		Require(SourceJS::CountLoadedPlugins(Plugins.GetPlugins()) == 1, "Plugin count changed.");
		Require(SourceJS::CountLoadedExtensions(Extensions.GetExtensions()) == 1, "Extension count changed.");

		for (auto const& bWithRoot : kPrefixModes) {
			CheckDispatch(bWithRoot, {}, {}, "Commands:");
			Require(HasLog(vecLogs, "  sjs extensions list"), "Root help must list the selector-free extensions query.");
			Require(HasLog(vecLogs, "  sjs auth"), "Root help must list authorization.");
			Require(!HasLog(vecLogs, "sjs extensions [list|"), "Root help must not advertise list as a selector-taking action.");

			std::vector<std::string> const vecAuthorizationArguments { "auth", "permission", "player", "add", "STEAM_1:0:12345", "sourcejs.kick" };
			CheckDispatch(bWithRoot, vecAuthorizationArguments, {}, nullptr);
			Require(Runtime.m_vecArguments == vecAuthorizationArguments, "Authorization routing changed the engine tokens.");

			CheckDispatch(bWithRoot, { "version" }, {}, "SourceJS version:");
			CheckDispatch(bWithRoot, { "modules" }, {}, "Native module contracts:");
			CheckDispatch(bWithRoot, { "version", "extra" }, {}, "Dispatch rejected unexpected arguments");
			Require(!HasLog(vecLogs, "SourceJS version:"), "Malformed version query executed.");
			CheckDispatch(bWithRoot, { "modules", "extra" }, {}, "Dispatch rejected unexpected arguments");
			Require(!HasLog(vecLogs, "Native module contracts:"), "Malformed module query executed.");
			CheckDispatch(bWithRoot, { "unknown" }, {}, "Dispatch rejected unknown command");

			for (auto const& pszKind : kManagerKinds) {
				std::string const strKind = pszKind;
				std::vector<std::string> const vecExpectedListLines { strKind + " list" };
				CheckDispatch(bWithRoot, { strKind }, { strKind + "|list|" }, nullptr);
				Require(vecLogs == vecExpectedListLines, "Implicit manager list omitted its output.");
				CheckDispatch(bWithRoot, { strKind, "list" }, { strKind + "|list|" }, nullptr);
				Require(vecLogs == vecExpectedListLines, "Explicit manager list omitted its output.");
				CheckDispatch(bWithRoot, { strKind, "list", "extra" }, {}, "DispatchManagerCommand rejected argument count");
				CheckDispatch(bWithRoot, { strKind, "unknown" }, {}, "rejected unknown command");
				Require(HasLog(vecLogs, "Commands:"), "Unknown manager action omitted help.");

				for (auto const& pszAction : kSelectorActions) {
					CheckDispatch(bWithRoot, { strKind, pszAction, "example" }, { strKind + "|" + pszAction + "|example" }, nullptr);
					CheckDispatch(bWithRoot, { strKind, pszAction }, {}, "DispatchManagerCommand rejected argument count");
					CheckDispatch(bWithRoot, { strKind, pszAction, "example", "extra" }, {}, "DispatchManagerCommand rejected argument count");
					CheckDispatch(bWithRoot, { strKind, pszAction, "" }, {}, "Usage:");

					Plugins.m_bOperationResult = false;
					Extensions.m_bOperationResult = false;
					CheckDispatch(bWithRoot, { strKind, pszAction, "example" }, { strKind + "|" + pszAction + "|example" }, nullptr);
					Plugins.m_bOperationResult = true;
					Extensions.m_bOperationResult = true;
				}

				for (auto const& pszAction : kBulkActions) {
					CheckDispatch(bWithRoot, { strKind, pszAction }, { strKind + "|" + pszAction + "|" }, nullptr);
					CheckDispatch(bWithRoot, { strKind, pszAction, "extra" }, {}, "DispatchManagerCommand rejected argument count");
				}
			}
		}

		std::size_t unHelperScenarioCount = 0;
		auto CheckSelector = [&Dispatcher, &unHelperScenarioCount](std::vector<std::string> const& vecArguments, const std::size_t unIndex, char const* const pszUsage, const bool bExpectedResult, std::string const& strExpectedOutput) {
			std::string strOutput = "preserved";
			const bool bResult = Dispatcher.RequireSelector(vecArguments, unIndex, pszUsage, strOutput);
			Require((bResult == bExpectedResult) && (strOutput == strExpectedOutput), "Selector validation committed a failed output or changed a valid selector.");
			++unHelperScenarioCount;
		};

		CheckSelector({ "value" }, 0, "Usage", true, "value");
		CheckSelector({ "before", "value" }, 1, "Usage", true, "value");
		CheckSelector({}, 0, "Usage", false, "preserved");
		CheckSelector({ "" }, 0, "Usage", false, "preserved");
		CheckSelector({ "value" }, 0, nullptr, false, "preserved");
		CheckSelector({ "value" }, 0, "", false, "preserved");
		CheckSelector({ "value" }, 1, "Usage", false, "preserved");

		auto CheckOffset = [&Dispatcher, &vecLogs, &unHelperScenarioCount](std::vector<std::string> const& vecArguments, const std::size_t unIndex, const bool bExpectedResult, const std::size_t unExpectedOutput) {
			vecLogs.clear();
			std::size_t unOutput = kPreservedOffset;
			const bool bResult = Dispatcher.ReadClientPageOffset(7, vecArguments, unIndex, "plugins", unOutput);
			Require((bResult == bExpectedResult) && (unOutput == unExpectedOutput), "Client offset validation committed a failed output or accepted invalid input.");

			if (!bExpectedResult) {
				Require(HasLog(vecLogs, "7|Usage: sjs plugins list [0|10|20|...]"), "Invalid offset omitted client usage.");
			}

			++unHelperScenarioCount;
		};

		CheckOffset({}, 0, true, 0);
		CheckOffset({ "list" }, 1, true, 0);
		CheckOffset({ "0" }, 0, true, 0);
		CheckOffset({ "10" }, 0, true, 10);
		CheckOffset({ "20" }, 0, true, 20);
		CheckOffset({ "00010" }, 0, true, 10);
		CheckOffset({ "list", "10" }, 1, true, 10);
		CheckOffset({ "10", "20" }, 0, false, kPreservedOffset);

		for (auto const& pszOffset : kInvalidOffsets) {
			CheckOffset({ pszOffset }, 0, false, kPreservedOffset);
		}

		std::string const strEmbeddedNull = std::string("10\0x", 4);
		CheckOffset({ strEmbeddedNull }, 0, false, kPreservedOffset);

		const bool bWideOffsetFits = kWidePageOffset <= std::numeric_limits<std::size_t>::max();
		const std::size_t unExpectedWideOffset = bWideOffsetFits ? static_cast<std::size_t>(kWidePageOffset) : kPreservedOffset;
		CheckOffset({ "4294967300" }, 0, bWideOffsetFits, unExpectedWideOffset);

		Dispatcher.Shutdown();
		CheckDispatch(true, { "plugins", "load", "example" }, {}, "DispatchPlugins failed");
		CheckDispatch(true, { "extensions", "load", "example" }, {}, "DispatchExtensions failed");
		CheckDispatch(true, { "modules" }, {}, "PrintModules failed");
		CheckDispatch(true, { "auth" }, {}, "runtime is not initialized");

		SourceJS::g_pLogMessages = nullptr;

		std::printf("CommandDispatcherContracts PASS Scenarios=%zu HelperScenarios=%zu\n", unScenarioCount, unHelperScenarioCount);

		return 0;
	} catch (std::exception const& Exception) {
		SourceJS::g_pLogMessages = nullptr;
		std::fprintf(stderr, "CommandDispatcherContracts failed: %s\n", Exception.what());
		return 1;
	}
}
