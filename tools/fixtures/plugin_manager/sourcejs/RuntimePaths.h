#pragma once

#ifndef _SOURCEJSTESTPLUGINMANAGERRUNTIMEPATHS_H_
#define _SOURCEJSTESTPLUGINMANAGERRUNTIMEPATHS_H_

// STL
#include <filesystem>

// Test double: only the actual PluginManager dependency surface, not path discovery.
namespace SourceJS {
	class RuntimePaths {
	public:
		RuntimePaths(std::filesystem::path const& PathPlugins, std::filesystem::path const& PathData);

		std::filesystem::path const& GetPluginRootPath() const;
		std::filesystem::path const& GetDataPath() const;

	private:
		std::filesystem::path m_PathPlugins;
		std::filesystem::path m_PathData;
	};
} // namespace SourceJS

#endif // _SOURCEJSTESTPLUGINMANAGERRUNTIMEPATHS_H_
