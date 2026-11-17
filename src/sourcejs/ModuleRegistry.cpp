#include "sourcejs/ModuleRegistry.h"

// ----------------------------------------------------------------
// ModuleRegistry
// ----------------------------------------------------------------

namespace SourceJS {

	ModuleRegistry::ModuleRegistry() {
		m_vecPublicPackages = {
			"auth",
			"autodoc",
			"bitbuffers",
			"colors",
			"commands",
			"config",
			"core",
			"cvars",
			"effects",
			"engines",
			"entities",
			"events",
			"extensions",
			"filesystem",
			"filters",
			"globals",
			"interfaces",
			"keyvalues",
			"listeners",
			"loggers",
			"mathlib",
			"memory",
			"menus",
			"messages",
			"netchannel",
			"paths",
			"physics",
			"players",
			"plugins",
			"public",
			"settings",
			"steam",
			"stringtables",
			"studio",
			"translations",
			"weapons",
		};
	}

	void ModuleRegistry::RegisterNativeModule(std::string const& strModuleName) {
		if (strModuleName.empty()) {
			return;
		}

		for (auto const& strNativeModule : m_vecNativeModules) {
			if (strNativeModule == strModuleName) {
				return;
			}
		}

		m_vecNativeModules.push_back(strModuleName);
	}

	std::vector<std::string> const& ModuleRegistry::GetNativeModules() const noexcept {
		return m_vecNativeModules;
	}

	std::vector<std::string> const& ModuleRegistry::GetPublicPackages() const noexcept {
		return m_vecPublicPackages;
	}

	bool ModuleRegistry::HasModule(std::string const& strModuleName) const noexcept {
		for (auto const& strNativeModule : m_vecNativeModules) {
			if (strNativeModule == strModuleName) {
				return true;
			}
		}

		for (auto const& strPublicPackage : m_vecPublicPackages) {
			if (strPublicPackage == strModuleName) {
				return true;
			}
		}

		return false;
	}
} // namespace SourceJS
