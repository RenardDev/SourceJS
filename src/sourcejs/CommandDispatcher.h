#pragma once

#ifndef _SOURCEJSCOMMANDDISPATCHER_H_
#define _SOURCEJSCOMMANDDISPATCHER_H_

// Local compatibility profile: Windows/Linux C++20; the canonical guard
// is this header's only reserved-name exception (guide 4.1).

// C++
#include <cstddef>

// STL
#include <string>
#include <vector>

// ================================================================
// CommandDispatcher
// ================================================================

namespace SourceJS {

	class ExtensionManager;
	class ModuleRegistry;
	class PluginManager;
	class V8Runtime;

	class CommandDispatcher {
	public:
		CommandDispatcher() noexcept;

	public:
		void Initialize(PluginManager* const pPluginManager, ExtensionManager* const pExtensionManager, ModuleRegistry const* const pModuleRegistry, V8Runtime* const pRuntime) noexcept;
		void Shutdown() noexcept;
		void Dispatch(std::vector<std::string> const& vecArguments);
		void DispatchClient(const int nClientIndex, std::vector<std::string> const& vecArguments);

	private:
		void PrintRoot() const;
		void PrintVersion() const;
		void PrintModules() const;
		void DispatchPlugins(std::vector<std::string> const& vecArguments, const std::size_t unActionArgumentIndex);
		void DispatchExtensions(std::vector<std::string> const& vecArguments, const std::size_t unActionArgumentIndex);
		void PrintLines(std::vector<std::string> const& vecLines) const;
		bool RequireSelector(std::vector<std::string> const& vecArguments, const std::size_t unSelectorArgumentIndex, char const* const pszUsage, std::string& strSelectorOut) const;
		void PrintClientRoot(const int nClientIndex) const;
		void PrintClientVersion(const int nClientIndex) const;
		void PrintClientPluginPage(const int nClientIndex, const std::size_t unPageOffset) const;
		void PrintClientExtensionPage(const int nClientIndex, const std::size_t unPageOffset) const;
		void PrintClientPageFooter(const int nClientIndex, char const* const pszCommandKind, const std::size_t unPageOffset, const std::size_t unPageEnd, const std::size_t unItemCount) const;
		void PrintClientLine(const int nClientIndex, std::string const& strLine) const;
		bool ReadClientPageOffset(const int nClientIndex, std::vector<std::string> const& vecArguments, const std::size_t unOffsetArgumentIndex, char const* const pszCommandKind, std::size_t& unPageOffsetOut) const;

	private:
		PluginManager* m_pPluginManager;
		ExtensionManager* m_pExtensionManager;
		ModuleRegistry const* m_pModuleRegistry;
		V8Runtime* m_pRuntime;
	};
} // namespace SourceJS
#endif // _SOURCEJSCOMMANDDISPATCHER_H_
