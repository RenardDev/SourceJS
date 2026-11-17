
// C++
#include <cstddef>
#include <cstdio>
#include <exception>
#include <utility>

// STL
#include <cctype>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

// Project
#include "sourcejs/ManagerState.h"

// Production file helpers, validators and LoadState/SaveState definitions are
// injected below. Path, logger and manager facades are test doubles, not an ABI
// or engine/runtime test. Files are real and isolated by the runner.
namespace SourceJS {

	namespace {

		// Count both severities; this fixture checks emission count, not logger severity.
		std::size_t g_unDiagnosticCount = 0;

		void ShowUsage(std::FILE* const pOutputFile) {
			std::fprintf(pOutputFile, "Usage: ManagerStateContracts <new-isolated-data-directory>\n");
			std::fprintf(pOutputFile, "       ManagerStateContracts -h | --help\n");
			std::fprintf(pOutputFile, "The fixture creates the directory and refuses to reuse an existing path.\n");
			std::fprintf(pOutputFile, "Prefix leading-dash directory names with ./ or use an absolute path.\n");
		}

		void Require(const bool bCondition, char const* const pszMessage) {
			if (!bCondition) {
				throw std::runtime_error(pszMessage);
			}
		}

		void LogWarning(char const*, ...) noexcept {
			++g_unDiagnosticCount;
		}

		void LogError(char const*, ...) noexcept {
			++g_unDiagnosticCount;
		}

		void WriteState(std::filesystem::path const& PathStateFile, std::string const& strState) {
			std::ofstream OutputFile(PathStateFile, std::ios::binary);
			Require(static_cast<bool>(OutputFile), "state fixture open");

			OutputFile.write(strState.data(), static_cast<std::streamsize>(strState.size()));
			OutputFile.close();
			Require(static_cast<bool>(OutputFile), "state fixture write");
		}

	} // namespace

	class RuntimePaths {
	public:
		explicit RuntimePaths(std::filesystem::path const& PathData);
		std::filesystem::path const& GetDataPath() const noexcept;

	private:
		std::filesystem::path m_PathData;
	};

	RuntimePaths::RuntimePaths(std::filesystem::path const& PathData) :
		m_PathData(PathData)
	{
	}

	std::filesystem::path const& RuntimePaths::GetDataPath() const noexcept {
		return m_PathData;
	}

	namespace ExtensionStateFixture {

		// SOURCEJS_EXTENSION_STATE_HELPERS

		class ExtensionManager {
		public:
			explicit ExtensionManager(RuntimePaths const* const pPaths);
			void LoadState();
			void SaveState() const;
			void SetNames(std::vector<std::string> const& vecNames);
			std::vector<std::string> const& GetNames() const noexcept;

		private:
			RuntimePaths const* m_pRuntimePaths;
			std::vector<std::string> m_vecDisabledExtensionNames;
		};

		ExtensionManager::ExtensionManager(RuntimePaths const* const pPaths) :
			m_pRuntimePaths(pPaths)
		{
		}

		void ExtensionManager::SetNames(std::vector<std::string> const& vecNames) {
			m_vecDisabledExtensionNames = vecNames;
		}

		std::vector<std::string> const& ExtensionManager::GetNames() const noexcept {
			return m_vecDisabledExtensionNames;
		}

		// SOURCEJS_EXTENSION_STATE_METHODS

	} // namespace ExtensionStateFixture

	namespace PluginStateFixture {

		// SOURCEJS_PLUGIN_STATE_HELPERS

		class PluginManager {
		public:
			explicit PluginManager(RuntimePaths const* const pPaths);
			void LoadState();
			void SaveState() const;
			void SetNames(std::vector<std::string> const& vecNames);
			std::vector<std::string> const& GetNames() const noexcept;

		private:
			RuntimePaths const* m_pRuntimePaths;
			std::vector<std::string> m_vecDisabledNames;
		};

		PluginManager::PluginManager(RuntimePaths const* const pPaths) :
			m_pRuntimePaths(pPaths)
		{
		}

		void PluginManager::SetNames(std::vector<std::string> const& vecNames) {
			m_vecDisabledNames = vecNames;
		}

		std::vector<std::string> const& PluginManager::GetNames() const noexcept {
			return m_vecDisabledNames;
		}

		// SOURCEJS_PLUGIN_STATE_METHODS

	} // namespace PluginStateFixture

	template <typename TManager>
	void CheckStatePersistence(RuntimePaths const& Paths, char const* const pszStateFileName, const bool bDeduplicates) {
		constexpr char const* kInvalidStates[] = {
			"",
			"{}",
			"[]",
			"{\"disabled\":[\"Disabled\"]}",
			"{\"Disabled\":\"Echo\"}",
			"{\"Disabled\":[null]}",
			"{\"Other\":[\"Echo\"],\"Disabled\":[]}",
			"{\"Disabled\":[\"Echo\"],\"Other\":[]}",
			"{\"Disabled\":[\"Echo\"],\"Disabled\":[]}",
			"{\"Disabled\":[\"Echo\",]}",
			"{\"Disabled\":[\"Echo\"]} trailing",
			"{\"Disabled\":[\"Echo\"]",
			"{\"Disabled\":[\"Echo]}",
			"{\"Disabled\":[\"Escape\\\\Name\"]}",
			"{\"Disabled\":[\"Escape\\\"Name\"]}",
			"{\"Disabled\":[\"\\u0045cho\"]}",
			"{\"Disabled\":[\"../Escape\"]}",
			"{\"Disabled\":[\"\"]}",
			"{\"Disabled\":[\"Control\nName\"]}",
		};

		std::filesystem::path const PathStateFile = Paths.GetDataPath() / pszStateFileName;
		std::vector<std::string> const vecExpected = { "Disabled", "disabled", "Echo-1" };
		TManager Manager(&Paths);
		Manager.SetNames(vecExpected);
		Manager.SaveState();
		Manager.SetNames({ "Stale" });
		Manager.LoadState();
		Require(Manager.GetNames() == vecExpected, "saved state restores every name including Disabled/disabled");

		TManager FreshManager(&Paths);
		FreshManager.LoadState();
		Require(FreshManager.GetNames() == vecExpected, "new manager restores persisted state");
		FreshManager.LoadState();
		Require(FreshManager.GetNames() == vecExpected, "repeated load does not accumulate names");

		WriteState(PathStateFile, " \r\n{ \t\"Disabled\" : [ \"Echo-1\", \"Echo-1\" ] }\n");
		Manager.LoadState();
		const std::size_t unExpectedCount = bDeduplicates ? 1 : 2;
		Require((Manager.GetNames().size() == unExpectedCount) && (Manager.GetNames().front() == "Echo-1"), "manager duplicate policy is preserved");

		WriteState(PathStateFile, "{\"Disabled\":[]}");
		Manager.LoadState();
		Require(Manager.GetNames().empty(), "empty state clears old names");

		std::error_code ErrorCode {};
		Require(std::filesystem::remove(PathStateFile, ErrorCode) && !ErrorCode, "fixture removes its exact state file");
		Manager.SetNames(vecExpected);
		const std::size_t unDiagnosticsBeforeMissingFile = g_unDiagnosticCount;
		Manager.LoadState();
		Require(Manager.GetNames().empty() && (g_unDiagnosticCount == unDiagnosticsBeforeMissingFile), "missing file clears state without a diagnostic");

		for (auto const& pszInvalidState : kInvalidStates) {
			Manager.SetNames(vecExpected);
			WriteState(PathStateFile, pszInvalidState);
			const std::size_t unDiagnosticsBefore = g_unDiagnosticCount;
			Manager.LoadState();
			Require(Manager.GetNames().empty(), "invalid state never commits partial names");
			Require(g_unDiagnosticCount == (unDiagnosticsBefore + 1), "invalid state emits one diagnostic");
		}

		TManager UninitializedManager(nullptr);
		UninitializedManager.SetNames(vecExpected);
		UninitializedManager.SaveState();
		UninitializedManager.LoadState();
		Require(UninitializedManager.GetNames().empty(), "uninitialized load clears state without reading a file");
	}

	void CheckParserOutput() {
		std::vector<std::string> vecNames = { "Original" };
		const bool bParsed = Detail::ParseDisabledManagerNames("{\"Disabled\":[\"Echo\",\"../Escape\"]}", vecNames, ExtensionStateFixture::IsValidExtensionName);
		Require(!bParsed && (vecNames == std::vector<std::string> { "Original" }), "parser leaves output unchanged after a later invalid name");

		Require(Detail::ParseDisabledManagerNames("{\"Disabled\":[\"Disabled\",\"disabled\"]}", vecNames, ExtensionStateFixture::IsValidExtensionName), "both special directory names are valid values");
		Require(vecNames == std::vector<std::string> { "Disabled", "disabled" }, "parser does not confuse values with its key");

		Require(!Detail::ParseDisabledManagerNames("{\"Disabled\":[\".cache\"]}", vecNames, PluginStateFixture::IsValidPluginName), "plugin validator remains stricter than extension validator");
		Require(Detail::ParseDisabledManagerNames("{\"Disabled\":[\".cache\"]}", vecNames, ExtensionStateFixture::IsValidExtensionName), "extension directory-name contract is preserved");
	}

} // namespace SourceJS

int main(const int nArgumentCount, char** ppszArguments) {
	if (nArgumentCount != 2) {
		SourceJS::ShowUsage(stderr);
		return 2;
	}

	std::string_view const strvDataDirectory = ppszArguments[1];
	if ((strvDataDirectory == "-h") || (strvDataDirectory == "--help")) {
		SourceJS::ShowUsage(stdout);
		return 0;
	}

	if (strvDataDirectory.empty() || (strvDataDirectory.front() == '-')) {
		std::fprintf(stderr, "[ERROR] Unsupported manager-state fixture directory argument.\n");
		SourceJS::ShowUsage(stderr);
		return 2;
	}

	try {
		std::filesystem::path const PathData = strvDataDirectory;
		std::error_code DirectoryError {};
		const bool bDirectoryCreated = std::filesystem::create_directory(PathData, DirectoryError);
		if (DirectoryError) {
			std::fprintf(stderr, "[ERROR] ManagerStateContracts could not create the isolated directory Result=%d\n", DirectoryError.value());
			return 2;
		}

		if (!bDirectoryCreated) {
			std::fprintf(stderr, "[ERROR] ManagerStateContracts requires a new isolated directory.\n");
			return 2;
		}

		SourceJS::RuntimePaths const Paths(PathData);
		SourceJS::CheckStatePersistence<SourceJS::ExtensionStateFixture::ExtensionManager>(Paths, "ExtensionsState.json", true);
		SourceJS::CheckStatePersistence<SourceJS::PluginStateFixture::PluginManager>(Paths, "PluginsState.json", false);
		SourceJS::CheckParserOutput();
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "[ERROR] ManagerStateContracts failed: %s\n", Exception.what());
		return 1;
	}

	std::puts("ManagerStateContracts PASS: actual persistence methods and validators; schema, restoration, rollback and naming checks");

	return 0;
}
