#pragma once

#ifndef _SOURCEJSMODULEREGISTRY_H_
#define _SOURCEJSMODULEREGISTRY_H_

// STL
#include <string>
#include <vector>

// ----------------------------------------------------------------
// ModuleRegistry
// ----------------------------------------------------------------

// Compatibility profile (4.1): the canonical reserved include guard is intentional.
namespace SourceJS {

	// No internal synchronization: serialize registration with every access.
	// Getters borrow registry-owned vectors until destruction. Registration can
	// invalidate native element references/iterators, not the vector itself.
	class ModuleRegistry {
	public:
		ModuleRegistry();

	public:
		void RegisterNativeModule(std::string const& strModuleName);
		std::vector<std::string> const& GetNativeModules() const noexcept;
		std::vector<std::string> const& GetPublicPackages() const noexcept;
		bool HasModule(std::string const& strModuleName) const noexcept;

	private:
		std::vector<std::string> m_vecNativeModules;
		std::vector<std::string> m_vecPublicPackages;
	};
} // namespace SourceJS
#endif // _SOURCEJSMODULEREGISTRY_H_
