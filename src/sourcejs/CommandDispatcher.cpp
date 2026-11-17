#include "sourcejs/CommandDispatcher.h"

// General
#include "eiface.h"

// C++
#include <cstdlib>

// STL
#include <algorithm>
#include <cctype>
#include <limits>
#include <sstream>

// Project
#include "sourcejs/Application.h"
#include "sourcejs/ExtensionManager.h"
#include "sourcejs/Log.h"
#include "sourcejs/ModuleRegistry.h"
#include "sourcejs/PluginManager.h"
#include "sourcejs/V8Runtime.h"

// ================================================================
// CommandDispatcher
// ================================================================

namespace SourceJS {

	namespace {

		constexpr std::size_t kClientPageSize = 10;

		std::size_t CountLoadedPlugins(std::vector<PluginRecord> const& vecPlugins) noexcept {
			std::size_t unCount = 0;
			for (std::size_t unIndex = 0; unIndex < vecPlugins.size(); ++unIndex) {
				if (vecPlugins[unIndex].m_bLoaded) {
					++unCount;
				}
			}

			return unCount;
		}

		std::size_t CountLoadedExtensions(std::vector<ExtensionRecord> const& vecExtensions) noexcept {
			std::size_t unCount = 0;
			for (std::size_t unIndex = 0; unIndex < vecExtensions.size(); ++unIndex) {
				if (vecExtensions[unIndex].m_bLoaded) {
					++unCount;
				}
			}

			return unCount;
		}

		bool ValidateManagerCommandArgumentCount(std::vector<std::string> const& vecArguments, const std::size_t unActionArgumentIndex, char const* const pszManagerKind) {
			constexpr std::size_t kActionArgumentCount = 1;
			constexpr std::size_t kSelectorArgumentCount = 2;

			if (unActionArgumentIndex >= vecArguments.size()) {
				return true;
			}

			std::string const& strAction = vecArguments[unActionArgumentIndex];
			const bool bRequiresSelector = (strAction == "load") || (strAction == "unload") || (strAction == "reload") || (strAction == "disable") || (strAction == "enable");
			const std::size_t unExpectedArgumentCount = bRequiresSelector ? kSelectorArgumentCount : kActionArgumentCount;
			const std::size_t unActualArgumentCount = vecArguments.size() - unActionArgumentIndex;
			if (unActualArgumentCount != unExpectedArgumentCount) {
				LogWarning("DispatchManagerCommand rejected argument count Kind=\"%s\" Action=\"%s\" Expected=%zu Actual=%zu", pszManagerKind, strAction.c_str(), unExpectedArgumentCount, unActualArgumentCount);
				return false;
			}

			return true;
		}

	} // namespace

	CommandDispatcher::CommandDispatcher() noexcept {
		m_pPluginManager = nullptr;
		m_pExtensionManager = nullptr;
		m_pModuleRegistry = nullptr;
		m_pRuntime = nullptr;
	}

	void CommandDispatcher::Initialize(PluginManager* const pPluginManager, ExtensionManager* const pExtensionManager, ModuleRegistry const* const pModuleRegistry, V8Runtime* const pRuntime) noexcept {
		m_pPluginManager = pPluginManager;
		m_pExtensionManager = pExtensionManager;
		m_pModuleRegistry = pModuleRegistry;
		m_pRuntime = pRuntime;
	}

	void CommandDispatcher::Shutdown() noexcept {
		m_pRuntime = nullptr;
		m_pModuleRegistry = nullptr;
		m_pExtensionManager = nullptr;
		m_pPluginManager = nullptr;
	}

	void CommandDispatcher::Dispatch(std::vector<std::string> const& vecArguments) {
		constexpr std::size_t kFirstArgumentIndex = 0;
		constexpr std::size_t kSubcommandArgumentOffset = 1;

		std::size_t unCommandArgumentIndex = kFirstArgumentIndex;
		if (!vecArguments.empty() && (vecArguments[kFirstArgumentIndex] == "sjs")) {
			unCommandArgumentIndex = kSubcommandArgumentOffset;
		}

		if (unCommandArgumentIndex >= vecArguments.size()) {
			PrintRoot();
			return;
		}

		std::string const& strCommandName = vecArguments[unCommandArgumentIndex];
		const std::size_t unSubcommandArgumentIndex = unCommandArgumentIndex + kSubcommandArgumentOffset;
		const bool bIsRootQuery = (strCommandName == "version") || (strCommandName == "modules");
		if (bIsRootQuery && (unSubcommandArgumentIndex != vecArguments.size())) {
			LogWarning("Dispatch rejected unexpected arguments Command=\"%s\"", strCommandName.c_str());
			PrintRoot();
			return;
		}

		if (strCommandName == "version") {
			PrintVersion();
			return;
		}

		if (strCommandName == "modules") {
			PrintModules();
			return;
		}

		if (strCommandName == "plugins") {
			DispatchPlugins(vecArguments, unSubcommandArgumentIndex);
			return;
		}

		if (strCommandName == "extensions") {
			DispatchExtensions(vecArguments, unSubcommandArgumentIndex);
			return;
		}

		if (strCommandName == "auth") {
			if (!m_pRuntime) {
				LogWarning("DispatchAuthenticationCommand failed: runtime is not initialized.");
				return;
			}

			std::vector<std::string> const vecCommandArguments = std::vector<std::string>(vecArguments.begin() + static_cast<std::ptrdiff_t>(unCommandArgumentIndex), vecArguments.end());
			m_pRuntime->DispatchAuthenticationCommand(vecCommandArguments);
			return;
		}

		LogWarning("Dispatch rejected unknown command Name=\"%s\"", strCommandName.c_str());
		PrintRoot();
	}

	void CommandDispatcher::DispatchClient(const int nClientIndex, std::vector<std::string> const& vecArguments) {
		constexpr std::size_t kFirstArgumentIndex = 0;
		constexpr std::size_t kSubcommandArgumentOffset = 1;
		constexpr std::size_t kPageOffsetArgumentOffset = 2;

		std::size_t unCommandArgumentIndex = kFirstArgumentIndex;
		if (!vecArguments.empty() && (vecArguments[kFirstArgumentIndex] == "sjs")) {
			unCommandArgumentIndex = kSubcommandArgumentOffset;
		}

		if (unCommandArgumentIndex >= vecArguments.size()) {
			PrintClientRoot(nClientIndex);
			return;
		}

		std::string const& strCommandName = vecArguments[unCommandArgumentIndex];
		const std::size_t unSubcommandArgumentIndex = unCommandArgumentIndex + kSubcommandArgumentOffset;
		if ((strCommandName == "version") && (unSubcommandArgumentIndex == vecArguments.size())) {
			PrintClientVersion(nClientIndex);
			return;
		}

		const bool bIsPluginCommand = strCommandName == "plugins";
		const bool bIsExtensionCommand = strCommandName == "extensions";
		if (!bIsPluginCommand && !bIsExtensionCommand) {
			PrintClientLine(nClientIndex, "Client command not available. Use: sjs, sjs version, sjs plugins list [offset], or sjs extensions list [offset].");
			return;
		}

		char const* const pszCommandKind = bIsPluginCommand ? "plugins" : "extensions";
		if ((unSubcommandArgumentIndex >= vecArguments.size()) || (vecArguments[unSubcommandArgumentIndex] != "list")) {
			PrintClientLine(nClientIndex, std::string("Usage: sjs ") + pszCommandKind + " list [0|10|20|...]");
			return;
		}

		const std::size_t unPageOffsetArgumentIndex = unCommandArgumentIndex + kPageOffsetArgumentOffset;
		std::size_t unPageOffset = 0;
		if (!ReadClientPageOffset(nClientIndex, vecArguments, unPageOffsetArgumentIndex, pszCommandKind, unPageOffset)) {
			return;
		}

		if (bIsPluginCommand) {
			PrintClientPluginPage(nClientIndex, unPageOffset);
		} else {
			PrintClientExtensionPage(nClientIndex, unPageOffset);
		}
	}

	void CommandDispatcher::PrintRoot() const {
		LogInfo("SourceJS %s (%s/%s, sdk %s)", SOURCEJS_VERSION, SOURCEJS_TARGET_PLATFORM, SOURCEJS_TARGET_ARCH, SOURCEJS_SDK_BRANCH);

		if (m_pPluginManager) {
			std::vector<PluginRecord> const& vecPlugins = m_pPluginManager->GetPlugins();
			LogInfo("Plugins: %zu loaded.", CountLoadedPlugins(vecPlugins));
		}

		if (m_pExtensionManager) {
			std::vector<ExtensionRecord> const& vecExtensions = m_pExtensionManager->GetExtensions();
			LogInfo("Extensions: %zu loaded.", CountLoadedExtensions(vecExtensions));
		}

		LogInfo("Commands:");
		LogInfo("  sjs version");
		LogInfo("  sjs plugins load <name>");
		LogInfo("  sjs plugins [unload|reload|disable|enable] <name/index>");
		LogInfo("  sjs plugins [unload_all|reload_all]");
		LogInfo("  sjs extensions load <name>");
		LogInfo("  sjs extensions list");
		LogInfo("  sjs extensions [unload|reload|disable|enable] <name/index>");
		LogInfo("  sjs extensions [unload_all|reload_all]");
		LogInfo("  sjs modules");
		LogInfo("  sjs auth");
	}

	void CommandDispatcher::PrintVersion() const {
		LogInfo("SourceJS version: %s", SOURCEJS_VERSION);
		LogInfo("SDK branch: %s", SOURCEJS_SDK_BRANCH);
		LogInfo("Target: %s %s", SOURCEJS_TARGET_PLATFORM, SOURCEJS_TARGET_ARCH);
		LogInfo("Runtime: V8");
	}

	void CommandDispatcher::PrintModules() const {
		if (!m_pModuleRegistry) {
			LogWarning("PrintModules failed: module registry is not initialized.");
			return;
		}

		std::vector<std::string> const& vecModules = m_pModuleRegistry->GetNativeModules();

		LogInfo("Native module contracts:");

		for (std::size_t unIndex = 0; unIndex < vecModules.size(); ++unIndex) {
			LogInfo("  %s", vecModules[unIndex].c_str());
		}
	}

	// Routing ends after each manager call; managers own operation diagnostics.
	void CommandDispatcher::DispatchPlugins(std::vector<std::string> const& vecArguments, const std::size_t unActionArgumentIndex) {
		constexpr std::size_t kSelectorArgumentOffset = 1;

		if (!m_pPluginManager) {
			LogWarning("DispatchPlugins failed: plugin manager is not initialized.");
			return;
		}

		if (!ValidateManagerCommandArgumentCount(vecArguments, unActionArgumentIndex, "plugins")) {
			PrintRoot();
			return;
		}

		if ((unActionArgumentIndex >= vecArguments.size()) || (vecArguments[unActionArgumentIndex] == "list")) {
			PrintLines(m_pPluginManager->List());
			return;
		}

		std::string const& strPluginAction = vecArguments[unActionArgumentIndex];
		const std::size_t unSelectorArgumentIndex = unActionArgumentIndex + kSelectorArgumentOffset;
		std::string strPluginSelector {};
		if (strPluginAction == "load") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs plugins load <name>", strPluginSelector)) {
				m_pPluginManager->Load(strPluginSelector);
			}

			return;
		}

		if (strPluginAction == "unload") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs plugins unload <name/index>", strPluginSelector)) {
				m_pPluginManager->Unload(strPluginSelector);
			}

			return;
		}

		if (strPluginAction == "unload_all") {
			m_pPluginManager->UnloadAll();
			return;
		}

		if (strPluginAction == "reload") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs plugins reload <name/index>", strPluginSelector)) {
				m_pPluginManager->Reload(strPluginSelector);
			}

			return;
		}

		if (strPluginAction == "reload_all") {
			m_pPluginManager->ReloadAll();
			return;
		}

		if (strPluginAction == "disable") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs plugins disable <name/index>", strPluginSelector)) {
				m_pPluginManager->Disable(strPluginSelector);
			}

			return;
		}

		if (strPluginAction == "enable") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs plugins enable <name/index>", strPluginSelector)) {
				m_pPluginManager->Enable(strPluginSelector);
			}

			return;
		}

		LogWarning("DispatchPlugins rejected unknown command Name=\"%s\"", strPluginAction.c_str());
		PrintRoot();
	}

	void CommandDispatcher::DispatchExtensions(std::vector<std::string> const& vecArguments, const std::size_t unActionArgumentIndex) {
		constexpr std::size_t kSelectorArgumentOffset = 1;

		if (!m_pExtensionManager) {
			LogWarning("DispatchExtensions failed: extension manager is not initialized.");
			return;
		}

		if (!ValidateManagerCommandArgumentCount(vecArguments, unActionArgumentIndex, "extensions")) {
			PrintRoot();
			return;
		}

		if ((unActionArgumentIndex >= vecArguments.size()) || (vecArguments[unActionArgumentIndex] == "list")) {
			PrintLines(m_pExtensionManager->List());
			return;
		}

		std::string const& strExtensionAction = vecArguments[unActionArgumentIndex];
		const std::size_t unSelectorArgumentIndex = unActionArgumentIndex + kSelectorArgumentOffset;
		std::string strExtensionSelector {};
		if (strExtensionAction == "load") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs extensions load <name>", strExtensionSelector)) {
				m_pExtensionManager->Load(strExtensionSelector);
			}

			return;
		}

		if (strExtensionAction == "unload") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs extensions unload <name/index>", strExtensionSelector)) {
				m_pExtensionManager->Unload(strExtensionSelector);
			}

			return;
		}

		if (strExtensionAction == "unload_all") {
			m_pExtensionManager->UnloadAll();
			return;
		}

		if (strExtensionAction == "reload") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs extensions reload <name/index>", strExtensionSelector)) {
				m_pExtensionManager->Reload(strExtensionSelector);
			}

			return;
		}

		if (strExtensionAction == "reload_all") {
			m_pExtensionManager->ReloadAll();
			return;
		}

		if (strExtensionAction == "disable") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs extensions disable <name/index>", strExtensionSelector)) {
				m_pExtensionManager->Disable(strExtensionSelector);
			}

			return;
		}

		if (strExtensionAction == "enable") {
			if (RequireSelector(vecArguments, unSelectorArgumentIndex, "sjs extensions enable <name/index>", strExtensionSelector)) {
				m_pExtensionManager->Enable(strExtensionSelector);
			}

			return;
		}

		LogWarning("DispatchExtensions rejected unknown command Name=\"%s\"", strExtensionAction.c_str());
		PrintRoot();
	}

	void CommandDispatcher::PrintLines(std::vector<std::string> const& vecLines) const {
		for (std::size_t unIndex = 0; unIndex < vecLines.size(); ++unIndex) {
			LogInfo("%s", vecLines[unIndex].c_str());
		}
	}

	bool CommandDispatcher::RequireSelector(std::vector<std::string> const& vecArguments, const std::size_t unSelectorArgumentIndex, char const* const pszUsage, std::string& strSelectorOut) const {
		if (!pszUsage || !*pszUsage) {
			return false;
		}

		if ((unSelectorArgumentIndex >= vecArguments.size()) || vecArguments[unSelectorArgumentIndex].empty()) {
			LogWarning("Usage: %s", pszUsage);
			return false;
		}

		strSelectorOut = vecArguments[unSelectorArgumentIndex];

		return true;
	}

	void CommandDispatcher::PrintClientRoot(const int nClientIndex) const {
		PrintClientVersion(nClientIndex);
		PrintClientLine(nClientIndex, "Client commands:");
		PrintClientLine(nClientIndex, "  sjs version");
		PrintClientLine(nClientIndex, "  sjs plugins list [0|10|20|...]");
		PrintClientLine(nClientIndex, "  sjs extensions list [0|10|20|...]");
	}

	void CommandDispatcher::PrintClientVersion(const int nClientIndex) const {
		std::ostringstream VersionStream {};

		VersionStream << "SourceJS " << SOURCEJS_VERSION << " (" << SOURCEJS_SDK_BRANCH << ", " << SOURCEJS_TARGET_PLATFORM << "/" << SOURCEJS_TARGET_ARCH << ")";

		PrintClientLine(nClientIndex, VersionStream.str());
	}

	void CommandDispatcher::PrintClientPluginPage(const int nClientIndex, const std::size_t unPageOffset) const {
		if (!m_pPluginManager) {
			PrintClientLine(nClientIndex, "Plugin manager is not initialized.");
			return;
		}

		std::vector<PluginRecord> const& vecPlugins = m_pPluginManager->GetPlugins();
		const std::size_t unPluginCount = vecPlugins.size();
		if (unPluginCount == 0) {
			PrintClientLine(nClientIndex, "Plugins: none loaded.");
			return;
		}

		if (unPageOffset >= unPluginCount) {
			PrintClientLine(nClientIndex, "Plugin offset is outside the loaded list.");
			PrintClientPageFooter(nClientIndex, "plugins", unPageOffset, unPageOffset, unPluginCount);
			return;
		}

		const std::size_t unPageEnd = unPageOffset + std::min(kClientPageSize, unPluginCount - unPageOffset);

		std::ostringstream PluginPageHeaderStream {};

		PluginPageHeaderStream << "Plugins " << (unPageOffset + 1) << "-" << unPageEnd << " of " << unPluginCount << ":";

		PrintClientLine(nClientIndex, PluginPageHeaderStream.str());

		for (std::size_t unIndex = unPageOffset; unIndex < unPageEnd; ++unIndex) {
			std::ostringstream PluginLineStream {};

			PluginLineStream << (unIndex + 1) << ". " << vecPlugins[unIndex].m_strName;

			PrintClientLine(nClientIndex, PluginLineStream.str());
		}

		PrintClientPageFooter(nClientIndex, "plugins", unPageOffset, unPageEnd, unPluginCount);
	}

	void CommandDispatcher::PrintClientExtensionPage(const int nClientIndex, const std::size_t unPageOffset) const {
		if (!m_pExtensionManager) {
			PrintClientLine(nClientIndex, "Extension manager is not initialized.");
			return;
		}

		std::vector<ExtensionRecord> const& vecExtensions = m_pExtensionManager->GetExtensions();
		const std::size_t unExtensionCount = vecExtensions.size();
		if (unExtensionCount == 0) {
			PrintClientLine(nClientIndex, "Extensions: none loaded.");
			return;
		}

		if (unPageOffset >= unExtensionCount) {
			PrintClientLine(nClientIndex, "Extension offset is outside the loaded list.");
			PrintClientPageFooter(nClientIndex, "extensions", unPageOffset, unPageOffset, unExtensionCount);
			return;
		}

		const std::size_t unPageEnd = unPageOffset + std::min(kClientPageSize, unExtensionCount - unPageOffset);

		std::ostringstream ExtensionPageHeaderStream {};

		ExtensionPageHeaderStream << "Extensions " << (unPageOffset + 1) << "-" << unPageEnd << " of " << unExtensionCount << ":";

		PrintClientLine(nClientIndex, ExtensionPageHeaderStream.str());

		for (std::size_t unIndex = unPageOffset; unIndex < unPageEnd; ++unIndex) {
			std::ostringstream ExtensionLineStream {};

			ExtensionLineStream << (unIndex + 1) << ". " << vecExtensions[unIndex].m_strName;

			PrintClientLine(nClientIndex, ExtensionLineStream.str());
		}

		PrintClientPageFooter(nClientIndex, "extensions", unPageOffset, unPageEnd, unExtensionCount);
	}

	void CommandDispatcher::PrintClientPageFooter(const int nClientIndex, char const* const pszCommandKind, const std::size_t unPageOffset, const std::size_t unPageEnd, const std::size_t unItemCount) const {
		if (!pszCommandKind || !*pszCommandKind) {
			return;
		}

		if (unPageOffset > 0) {
			const std::size_t unPreviousPageOffset = (unPageOffset >= kClientPageSize) ? (unPageOffset - kClientPageSize) : 0;

			std::ostringstream PreviousPageStream {};

			PreviousPageStream << "Previous: sjs " << pszCommandKind << " list " << unPreviousPageOffset;

			PrintClientLine(nClientIndex, PreviousPageStream.str());
		}

		if (unPageEnd < unItemCount) {
			std::ostringstream NextPageStream {};

			NextPageStream << "Next: sjs " << pszCommandKind << " list " << unPageEnd;

			PrintClientLine(nClientIndex, NextPageStream.str());
		}
	}

	void CommandDispatcher::PrintClientLine(const int nClientIndex, std::string const& strLine) const {
		EngineInterfaces& EngineInterfaceSet = g_Application.GetEngineInterfaces();
		auto* const pEngine = EngineInterfaceSet.GetEngine();
		auto* const pClientEdict = EngineInterfaceSet.GetEdict(nClientIndex);
		if (!pEngine || !pClientEdict || pClientEdict->IsFree()) {
			return;
		}

		std::string const strClientOutput = "[SourceJS] " + strLine + "\n";
		pEngine->ClientPrintf(pClientEdict, strClientOutput.c_str());
	}

	bool CommandDispatcher::ReadClientPageOffset(const int nClientIndex, std::vector<std::string> const& vecArguments, const std::size_t unOffsetArgumentIndex, char const* const pszCommandKind, std::size_t& unPageOffsetOut) const {
		// strtoull saturates on overflow; its sentinel must fail page alignment.
		static_assert((std::numeric_limits<unsigned long long>::max() % kClientPageSize) != 0, "Overflow must not be accepted as a client page offset.");

		if (unOffsetArgumentIndex >= vecArguments.size()) {
			unPageOffsetOut = 0;
			return true;
		}

		if ((unOffsetArgumentIndex + 1) != vecArguments.size()) {
			PrintClientLine(nClientIndex, std::string("Usage: sjs ") + pszCommandKind + " list [0|10|20|...]");
			return false;
		}

		std::string const& strPageOffset = vecArguments[unOffsetArgumentIndex];
		if (strPageOffset.empty()) {
			PrintClientLine(nClientIndex, std::string("Usage: sjs ") + pszCommandKind + " list [0|10|20|...]");
			return false;
		}

		for (std::size_t unCharacterIndex = 0; unCharacterIndex < strPageOffset.size(); ++unCharacterIndex) {
			if (!std::isdigit(static_cast<unsigned char>(strPageOffset[unCharacterIndex]))) {
				PrintClientLine(nClientIndex, std::string("Usage: sjs ") + pszCommandKind + " list [0|10|20|...]");
				return false;
			}
		}

		char* pszParseEnd = nullptr;
		const unsigned long long unParsedPageOffset = std::strtoull(strPageOffset.c_str(), &pszParseEnd, 10);
		if ((pszParseEnd != (strPageOffset.c_str() + strPageOffset.size())) || (unParsedPageOffset > static_cast<unsigned long long>(std::numeric_limits<std::size_t>::max())) || ((unParsedPageOffset % kClientPageSize) != 0)) {
			PrintClientLine(nClientIndex, std::string("Usage: sjs ") + pszCommandKind + " list [0|10|20|...]");
			return false;
		}

		unPageOffsetOut = static_cast<std::size_t>(unParsedPageOffset);

		return true;
	}
} // namespace SourceJS
