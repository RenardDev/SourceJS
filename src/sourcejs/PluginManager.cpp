#include "sourcejs/PluginManager.h"

// C++
#include <cstddef>
#include <cstdlib>
#include <utility>

// STL
#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <type_traits>

// Project
#include "sourcejs/ListenerPayload.h"
#include "sourcejs/Log.h"
#include "sourcejs/ManagerManifest.h"
#include "sourcejs/ManagerState.h"
#include "sourcejs/RuntimePaths.h"
#include "sourcejs/V8Runtime.h"

// ----------------------------------------------------------------
// File helpers
// ----------------------------------------------------------------

namespace SourceJS {

	namespace {

		bool IsDecimalText(std::string const& strText) {
			if (strText.empty()) {
				return false;
			}

			for (auto const& chCharacter : strText) {
				if (!std::isdigit(static_cast<unsigned char>(chCharacter))) {
					return false;
				}
			}

			return true;
		}

		bool IsValidPluginName(std::string const& strName) {
			if (strName.empty() || !std::isalpha(static_cast<unsigned char>(strName.front()))) {
				return false;
			}

			for (std::size_t unCharacterIndex = 1; unCharacterIndex < strName.size(); ++unCharacterIndex) {
				const unsigned char chCharacter = static_cast<unsigned char>(strName[unCharacterIndex]);
				if (!std::isalnum(chCharacter) && (chCharacter != '_') && (chCharacter != '-')) {
					return false;
				}
			}

			return std::isalnum(static_cast<unsigned char>(strName.back())) != 0;
		}

		bool ReadTextFile(std::filesystem::path const& PathFile, std::string& strTextOut) {
			constexpr std::streamsize kReadBufferSize = 4096;

			std::ifstream InputFile { PathFile, std::ios::binary };
			if (!InputFile) {
				return false;
			}

			char arrBuffer[kReadBufferSize] {};

			std::ostringstream OutputStream {};

			do {
				InputFile.read(arrBuffer, kReadBufferSize);
				const std::streamsize nByteCount = InputFile.gcount();
				if (nByteCount > 0) {
					OutputStream.write(arrBuffer, nByteCount);
					if (!OutputStream) {
						return false;
					}
				}
			} while (InputFile);

			// Commit only after a clean EOF, never after an I/O failure.
			if (InputFile.bad() || !InputFile.eof()) {
				return false;
			}

			strTextOut = OutputStream.str();

			return true;
		}

		std::string ReadManifestString(std::filesystem::path const& PathManifest, std::string const& strKey, std::string const& strFallback) {
			std::string strManifest {};
			if (!ReadTextFile(PathManifest, strManifest)) {
				return strFallback;
			}

			std::string const strNeedle = "\"" + strKey + "\"";
			const std::size_t unKeyOffset = strManifest.find(strNeedle);
			if (unKeyOffset == std::string::npos) {
				return strFallback;
			}

			const std::size_t unColonOffset = strManifest.find(':', unKeyOffset + strNeedle.size());
			if (unColonOffset == std::string::npos) {
				return strFallback;
			}

			const std::size_t unValueStart = strManifest.find('"', unColonOffset + 1);
			if (unValueStart == std::string::npos) {
				return strFallback;
			}

			// Decode the selected string; preserve the existing key lookup and fallback policy.
			std::string strValue {};
			if (!Detail::DecodeManifestString(strManifest, unValueStart, strValue)) {
				return strFallback;
			}

			return strValue;
		}

		bool ReadManifestBoolean(std::filesystem::path const& PathManifest, std::string const& strKey, const bool bFallback) {
			constexpr char kTrueText[] = "true";
			constexpr char kFalseText[] = "false";

			std::string strManifest {};
			if (!ReadTextFile(PathManifest, strManifest)) {
				return bFallback;
			}

			std::string const strNeedle = "\"" + strKey + "\"";
			const std::size_t unKeyOffset = strManifest.find(strNeedle);
			if (unKeyOffset == std::string::npos) {
				return bFallback;
			}

			const std::size_t unColonOffset = strManifest.find(':', unKeyOffset + strNeedle.size());
			if (unColonOffset == std::string::npos) {
				return bFallback;
			}

			std::size_t unValueOffset = unColonOffset + 1;
			while ((unValueOffset < strManifest.size()) && std::isspace(static_cast<unsigned char>(strManifest[unValueOffset]))) {
				++unValueOffset;
			}

			if (strManifest.compare(unValueOffset, sizeof(kTrueText) - 1, kTrueText) == 0) {
				return true;
			}

			if (strManifest.compare(unValueOffset, sizeof(kFalseText) - 1, kFalseText) == 0) {
				return false;
			}

			return bFallback;
		}

		bool ContainsName(std::vector<std::string> const& vecNames, std::string const& strName) {
			for (auto const& strExistingName : vecNames) {
				if (strExistingName == strName) {
					return true;
				}
			}

			return false;
		}

		void RemoveName(std::vector<std::string>& vecNames, std::string const& strName) {
			auto itName = std::find(vecNames.begin(), vecNames.end(), strName);
			if (itName != vecNames.end()) {
				vecNames.erase(itName);
			}
		}
	} // namespace

	// ----------------------------------------------------------------
	// PluginManager
	// ----------------------------------------------------------------

	PluginManager::PluginManager() {
		m_pRuntimePaths = nullptr;
		m_pRuntime = nullptr;
	}

	void PluginManager::Initialize(RuntimePaths const* const pRuntimePaths, V8Runtime* const pRuntime) {
		m_pRuntimePaths = pRuntimePaths;
		m_pRuntime = pRuntime;

		LoadState();
		LoadAll();
	}

	void PluginManager::Shutdown() {
		UnloadAll();
		SaveState();

		m_vecPlugins.clear();
		m_vecDisabledNames.clear();

		m_pRuntime = nullptr;
		m_pRuntimePaths = nullptr;
	}

	void PluginManager::Refresh() {
		LoadAll();
	}

	void PluginManager::LoadAll() {
		std::vector<std::string> const vecPluginNames = DiscoverNames();
		for (auto const& strPluginName : vecPluginNames) {
			if (IsDisabledInState(strPluginName)) {
				continue;
			}

			PluginRecord PluginCandidate {};
			if (BuildRecord(strPluginName, PluginCandidate) && !PluginCandidate.m_bAutoLoad) {
				continue;
			}

			// Continue after a false result; C++ exceptions still propagate.
			Load(strPluginName);
		}
	}

	bool PluginManager::Load(std::string const& strName) {
		if (IsDecimalText(strName)) {
			LogWarning("Plugin load expects a plugin name, not an index: %s", strName.c_str());
			return false;
		}

		if (!IsValidPluginName(strName)) {
			LogWarning("Invalid plugin name: %s", strName.c_str());
			return false;
		}

		auto* const pLoadedPlugin = ResolveByName(strName);
		if (pLoadedPlugin) {
			LogInfo("Plugin already loaded: %s", pLoadedPlugin->m_strName.c_str());
			return true;
		}

		PluginRecord NewPluginRecord {};
		if (!BuildRecord(strName, NewPluginRecord)) {
			LogWarning("Plugin not found: %s", strName.c_str());
			return false;
		}

		if (!NewPluginRecord.m_bEnabled) {
			LogWarning("Plugin is disabled: %s", NewPluginRecord.m_strName.c_str());
			return false;
		}

		ListenerPayloadBuilder LoadingPayloadBuilder {};
		LoadingPayloadBuilder.AddString(NewPluginRecord.m_strName);

		if (m_pRuntime) {
			m_pRuntime->EmitEvent("PluginLoading", LoadingPayloadBuilder.Build());
		}

		auto* const pRuntime = m_pRuntime;
		if (!pRuntime || !pRuntime->ExecutePluginFile(NewPluginRecord.m_PathEntry, NewPluginRecord.m_strName)) {
			return false;
		}

		NewPluginRecord.m_bLoaded = true;
		try {
			m_vecPlugins.push_back(NewPluginRecord);
		} catch (...) {
			try {
				pRuntime->UnloadPlugin(NewPluginRecord.m_strName);
			} catch (...) {
				LogError("Plugin load rollback failed Name=\"%s\"", NewPluginRecord.m_strName.c_str());
			}

			throw;
		}

		if (m_pRuntime) {
			ListenerPayloadBuilder LoadedPayloadBuilder {};
			LoadedPayloadBuilder.AddString(NewPluginRecord.m_strName);
			m_pRuntime->EmitEvent("PluginLoaded", LoadedPayloadBuilder.Build());
		}

		LogInfo("Plugin loaded: %s", NewPluginRecord.m_strName.c_str());

		return true;
	}

	bool PluginManager::Unload(std::string const& strSelector) {
		auto* const pPlugin = ResolveBySelector(strSelector);
		if (!pPlugin) {
			LogWarning("Plugin not found: %s", strSelector.c_str());
			return false;
		}

		if (pPlugin->m_bUnloading) {
			return false;
		}

		std::string const strName = pPlugin->m_strName;
		auto* const pRuntime = m_pRuntime;
		pPlugin->m_bUnloading = true;
		try {
			if (pRuntime) {
				ListenerPayloadBuilder UnloadingPayloadBuilder {};
				UnloadingPayloadBuilder.AddString(strName);
				pRuntime->EmitEvent("PluginUnloading", UnloadingPayloadBuilder.Build());
				pRuntime->UnloadPlugin(strName);
			}

			// Callbacks may move or remove records; never retain the original vector element.
			auto* const pCurrentPlugin = ResolveByName(strName);
			if (pCurrentPlugin && pCurrentPlugin->m_bUnloading) {
				RemoveRecord(strName);
			}

			if (pRuntime) {
				ListenerPayloadBuilder UnloadedPayloadBuilder {};
				UnloadedPayloadBuilder.AddString(strName);
				pRuntime->EmitEvent("PluginUnloaded", UnloadedPayloadBuilder.Build());
			}

			LogInfo("Plugin unloaded: %s", strName.c_str());

			return true;
		} catch (...) {
			auto* const pRemainingPlugin = ResolveByName(strName);
			if (pRemainingPlugin) {
				pRemainingPlugin->m_bUnloading = false;
			}

			throw;
		}
	}

	bool PluginManager::Reload(std::string const& strSelector) {
		auto* const pPlugin = ResolveBySelector(strSelector);
		if (!pPlugin) {
			LogWarning("Plugin not found: %s", strSelector.c_str());
			return false;
		}

		std::string const strName = pPlugin->m_strName;
		if (!Unload(strName)) {
			return false;
		}

		return Load(strName);
	}

	void PluginManager::UnloadAll() {
		std::vector<std::string> vecPluginNames {};
		for (auto const& Plugin : m_vecPlugins) {
			vecPluginNames.push_back(Plugin.m_strName);
		}

		for (auto const& strPluginName : vecPluginNames) {
			// Continue after a false result; C++ exceptions still propagate.
			Unload(strPluginName);
		}
	}

	void PluginManager::ReloadAll() {
		UnloadAll();

		LoadAll();
	}

	bool PluginManager::Disable(std::string const& strSelector) {
		std::string strName {};
		auto* const pPlugin = ResolveBySelector(strSelector);
		if (pPlugin) {
			strName = pPlugin->m_strName;

		} else if (!IsDecimalText(strSelector)) {
			PluginRecord DiskPluginRecord {};
			if (BuildRecord(strSelector, DiskPluginRecord)) {
				strName = DiskPluginRecord.m_strName;
			}
		}

		if (strName.empty()) {
			LogWarning("Plugin not found: %s", strSelector.c_str());
			return false;
		}

		if (pPlugin && !Unload(strName)) {
			return false;
		}

		if (!ContainsName(m_vecDisabledNames, strName)) {
			m_vecDisabledNames.push_back(strName);
		}

		SaveState();

		LogInfo("Plugin disabled: %s", strName.c_str());

		return true;
	}

	bool PluginManager::Enable(std::string const& strSelector) {
		std::string strName {};
		auto* const pPlugin = ResolveBySelector(strSelector);
		if (pPlugin) {
			strName = pPlugin->m_strName;

		} else if (!IsDecimalText(strSelector)) {
			strName = strSelector;
		}

		if (strName.empty()) {
			LogWarning("Plugin not found: %s", strSelector.c_str());
			return false;
		}

		RemoveName(m_vecDisabledNames, strName);
		SaveState();

		LogInfo("Plugin enabled: %s", strName.c_str());

		return Load(strName);
	}

	std::vector<std::string> PluginManager::List() const {
		std::vector<std::string> vecPluginLines {};
		for (std::size_t unPluginIndex = 0; unPluginIndex < m_vecPlugins.size(); ++unPluginIndex) {
			PluginRecord const& LoadedPluginRecord = m_vecPlugins[unPluginIndex];

			std::ostringstream OutputStream {};

			OutputStream << unPluginIndex + 1 << ". " << LoadedPluginRecord.m_strName << " [loaded, " << (LoadedPluginRecord.m_bEnabled ? "enabled" : "disabled") << "] " << LoadedPluginRecord.m_PathEntry.string();

			vecPluginLines.push_back(OutputStream.str());
		}

		if (vecPluginLines.empty()) {
			vecPluginLines.push_back("No plugins loaded.");
		}

		return vecPluginLines;
	}

	std::vector<PluginRecord> const& PluginManager::GetPlugins() const {
		return m_vecPlugins;
	}

	PluginRecord* PluginManager::ResolveByName(std::string const& strName) {
		for (auto& Plugin : m_vecPlugins) {
			if (Plugin.m_strName == strName) {
				return &Plugin;
			}
		}

		return nullptr;
	}

	PluginRecord* PluginManager::ResolveBySelector(std::string const& strSelector) {
		if (IsDecimalText(strSelector)) {
			const unsigned long long unPluginIndex = std::strtoull(strSelector.c_str(), nullptr, 10);
			if ((unPluginIndex > 0) && (unPluginIndex <= m_vecPlugins.size())) {
				return &m_vecPlugins[static_cast<std::size_t>(unPluginIndex - 1)];
			}
		}

		return ResolveByName(strSelector);
	}

	bool PluginManager::BuildRecord(std::string const& strName, PluginRecord& PluginRecordOut) const {
		static_assert(std::is_nothrow_move_assignable_v<PluginRecord>, "Plugin record outputs must commit without throwing.");

		if (!m_pRuntimePaths || !IsValidPluginName(strName)) {
			return false;
		}

		std::filesystem::path const PathDirectory = m_pRuntimePaths->GetPluginRootPath() / strName;
		std::error_code ErrorCode {};
		if (!std::filesystem::is_directory(PathDirectory, ErrorCode)) {
			return false;
		}

		std::filesystem::path const PathManifest = PathDirectory / "plugin.json";
		std::string const strEntry = ReadManifestString(PathManifest, "Entry", "index.js");
		if (strEntry.find('\0') != std::string::npos) {
			return false;
		}

		std::filesystem::path const PathRelativeEntry = strEntry;
		if (PathRelativeEntry.empty() || PathRelativeEntry.has_root_path()) {
			return false;
		}

		for (auto itPath = PathRelativeEntry.begin(); itPath != PathRelativeEntry.end(); ++itPath) {
			if (*itPath == "..") {
				return false;
			}
		}

		std::filesystem::path const PathEntry = PathDirectory / PathRelativeEntry;
		if (!std::filesystem::is_regular_file(PathEntry, ErrorCode)) {
			return false;
		}

		PluginRecord Candidate {};
		Candidate.m_strName = strName;
		Candidate.m_PathDirectory = PathDirectory;
		Candidate.m_PathEntry = PathEntry;
		Candidate.m_bAutoLoad = ReadManifestBoolean(PathManifest, "Autoload", true);
		Candidate.m_bEnabled = !IsDisabledInState(strName);
		Candidate.m_bLoaded = false;
		Candidate.m_bUnloading = false;
		PluginRecordOut = std::move(Candidate);

		return true;
	}

	bool PluginManager::RemoveRecord(std::string const& strName) {
		for (auto itPlugin = m_vecPlugins.begin(); itPlugin != m_vecPlugins.end(); ++itPlugin) {
			if (itPlugin->m_strName == strName) {
				m_vecPlugins.erase(itPlugin);
				return true;
			}
		}

		return false;
	}

	std::vector<std::string> PluginManager::DiscoverNames() const {
		constexpr char kDisabledPluginDirectoryName[] = "disabled";

		std::vector<std::string> vecPluginNames {};
		if (!m_pRuntimePaths) {
			return vecPluginNames;
		}

		std::filesystem::path const PathPluginRoot = m_pRuntimePaths->GetPluginRootPath();
		std::error_code ErrorCode {};
		// Discovery also performs startup setup by creating a missing plugin root.
		std::filesystem::create_directories(PathPluginRoot, ErrorCode);
		if (ErrorCode) {
			LogWarning("DiscoverPlugins failed Path=\"%s\" Error=0x%08X", PathPluginRoot.string().c_str(), static_cast<unsigned int>(ErrorCode.value()));
			return vecPluginNames;
		}

		auto itDirectory = std::filesystem::directory_iterator { PathPluginRoot, ErrorCode };
		if (ErrorCode) {
			LogWarning("DiscoverPlugins open failed Path=\"%s\" Error=0x%08X", PathPluginRoot.string().c_str(), static_cast<unsigned int>(ErrorCode.value()));
			return vecPluginNames;
		}

		auto const itDirectoryEnd = std::filesystem::directory_iterator {};
		while (itDirectory != itDirectoryEnd) {
			std::string const strName = itDirectory->path().filename().string();
			if ((strName != kDisabledPluginDirectoryName) && itDirectory->is_directory(ErrorCode) && IsValidPluginName(strName)) {
				vecPluginNames.push_back(strName);
			}

			if (ErrorCode) {
				LogWarning("DiscoverPlugins entry failed Path=\"%s\" Error=0x%08X", itDirectory->path().string().c_str(), static_cast<unsigned int>(ErrorCode.value()));
				break;
			}

			itDirectory.increment(ErrorCode);
			if (ErrorCode) {
				LogWarning("DiscoverPlugins iteration failed Path=\"%s\" Error=0x%08X", PathPluginRoot.string().c_str(), static_cast<unsigned int>(ErrorCode.value()));
				break;
			}
		}

		std::sort(vecPluginNames.begin(), vecPluginNames.end());

		return vecPluginNames;
	}

	void PluginManager::LoadState() {
		m_vecDisabledNames.clear();

		if (!m_pRuntimePaths) {
			return;
		}

		std::string strState {};
		std::filesystem::path const PathState = m_pRuntimePaths->GetDataPath() / "PluginsState.json";
		if (!ReadTextFile(PathState, strState)) {
			return;
		}

		std::vector<std::string> vecDisabledNames {};
		if (!Detail::ParseDisabledManagerNames(strState, vecDisabledNames, IsValidPluginName)) {
			LogWarning("LoadPluginState invalid state Path=\"%s\"", PathState.string().c_str());
			return;
		}

		m_vecDisabledNames = std::move(vecDisabledNames);
	}

	void PluginManager::SaveState() const {
		if (!m_pRuntimePaths) {
			return;
		}

		std::error_code ErrorCode {};
		std::filesystem::create_directories(m_pRuntimePaths->GetDataPath(), ErrorCode);
		if (ErrorCode) {
			LogWarning("SavePluginState directory failed Path=\"%s\" Error=0x%08X", m_pRuntimePaths->GetDataPath().string().c_str(), static_cast<unsigned int>(ErrorCode.value()));
			return;
		}

		std::filesystem::path const PathState = m_pRuntimePaths->GetDataPath() / "PluginsState.json";

		std::ofstream OutputFile { PathState, std::ios::binary };
		if (!OutputFile) {
			LogWarning("SavePluginState open failed Path=\"%s\"", PathState.string().c_str());
			return;
		}

		OutputFile
			<< "{\n"
			<< "\t\"Disabled\": [";

		for (std::size_t unDisabledNameIndex = 0; unDisabledNameIndex < m_vecDisabledNames.size(); ++unDisabledNameIndex) {
			if (unDisabledNameIndex > 0) {
				OutputFile << ",";
			}

			OutputFile
				<< "\n"
				<< "\t\t\"" << m_vecDisabledNames[unDisabledNameIndex] << "\"";
		}

		if (!m_vecDisabledNames.empty()) {
			OutputFile
				<< "\n"
				<< "\t";
		}

		OutputFile
			<< "]\n"
			<< "}\n";

		OutputFile.close();
		if (!OutputFile) {
			LogWarning("SavePluginState write failed Path=\"%s\"", PathState.string().c_str());
		}
	}

	bool PluginManager::IsDisabledInState(std::string const& strName) const {
		return ContainsName(m_vecDisabledNames, strName);
	}
} // namespace SourceJS
