#pragma once

#ifndef _SOURCEJSTESTPLUGINMANAGERV8RUNTIME_H_
#define _SOURCEJSTESTPLUGINMANAGERV8RUNTIME_H_

// C++
#include <cstddef>

// STL
#include <filesystem>
#include <functional>
#include <string>

// Test double: records native lifecycle calls without executing JavaScript.
namespace SourceJS {
	class V8Runtime {
	public:
		V8Runtime();

		bool ExecutePluginFile(std::filesystem::path const& PathScript, std::string const& strPluginName);
		void UnloadPlugin(std::string const& strPluginName);
		void EmitEvent(std::string const& strEventName, std::string const& strPayload);

	public:
		std::filesystem::path m_PathLastScript;
		std::size_t m_unExecutionCount;
		std::size_t m_unUnloadCount;
		std::function<void(std::string const&)> m_EventCallback;
		std::function<void(std::string const&)> m_UnloadCallback;
	};
} // namespace SourceJS

#endif // _SOURCEJSTESTPLUGINMANAGERV8RUNTIME_H_
