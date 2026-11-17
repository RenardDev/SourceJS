#pragma once

#ifndef _SOURCEJSPLUGINMANAGER_H_
#define _SOURCEJSPLUGINMANAGER_H_

// STL
#include <filesystem>
#include <string>
#include <vector>

// ----------------------------------------------------------------
// PluginManager
// ----------------------------------------------------------------

// Compatibility profile (4.1): the canonical reserved include guard is intentional.
namespace SourceJS {

	class RuntimePaths;
	class V8Runtime;

	// Metadata aggregate: initialize every field before use, normally with PluginRecord Record {}.
	struct PluginRecord {
		std::string m_strName;
		std::filesystem::path m_PathDirectory;
		std::filesystem::path m_PathEntry;
		bool m_bAutoLoad;
		bool m_bEnabled;
		bool m_bLoaded;
		bool m_bUnloading;
	};

	// Game-thread-confined, explicit lifecycle; operations may allocate and do synchronous IO/runtime work.
	class PluginManager {
	public:
		PluginManager();

	public:
		// Borrows dependencies through Shutdown and active lifecycle calls; nullptr is tolerated but loading requires both.
		// Loads persisted state/autoload plugins. Call Shutdown before reinitializing or releasing dependencies.
		void Initialize(RuntimePaths const* const pRuntimePaths, V8Runtime* const pRuntime);
		void Shutdown();
		void Refresh();
		void LoadAll();
		bool Load(std::string const& strName);
		// Returns false when the selected plugin is already unloading; other plugins remain independent.
		bool Unload(std::string const& strSelector);
		bool Reload(std::string const& strSelector);
		void UnloadAll();
		void ReloadAll();
		bool Disable(std::string const& strSelector);
		bool Enable(std::string const& strSelector);
		std::vector<std::string> List() const;

		// Borrows the manager's vector; do not retain record references/iterators across mutations or Shutdown.
		std::vector<PluginRecord> const& GetPlugins() const;

	private:
		PluginRecord* ResolveByName(std::string const& strName);
		PluginRecord* ResolveBySelector(std::string const& strSelector);
		bool BuildRecord(std::string const& strName, PluginRecord& PluginRecordOut) const;
		bool RemoveRecord(std::string const& strName);
		std::vector<std::string> DiscoverNames() const;
		void LoadState();
		void SaveState() const;
		bool IsDisabledInState(std::string const& strName) const;

	private:
		RuntimePaths const* m_pRuntimePaths;
		V8Runtime* m_pRuntime;
		std::vector<PluginRecord> m_vecPlugins;
		std::vector<std::string> m_vecDisabledNames;
	};
} // namespace SourceJS
#endif // _SOURCEJSPLUGINMANAGER_H_
