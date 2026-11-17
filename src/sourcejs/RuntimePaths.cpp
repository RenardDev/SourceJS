#include "sourcejs/RuntimePaths.h"

// STL
#include <filesystem>
#include <string>

// ----------------------------------------------------------------
// RuntimePaths
// ----------------------------------------------------------------

namespace SourceJS {

	std::string EncodePathAsUTF8(std::filesystem::path const& Path) {
		std::u8string const strUTF8Path = Path.u8string();

		return std::string(strUTF8Path.begin(), strUTF8Path.end());
	}

	RuntimePaths::RuntimePaths() {
		Initialize(std::filesystem::current_path());
	}

	void RuntimePaths::Initialize(std::filesystem::path const& PathGameRoot) {
		std::filesystem::path PathResolved = PathGameRoot;
		if (PathResolved.empty()) {
			PathResolved = std::filesystem::current_path();
		}

		if (PathResolved.is_relative()) {
			PathResolved = std::filesystem::absolute(PathResolved);
		}

		m_PathGameRoot = PathResolved.lexically_normal();
		m_PathAddonRoot = m_PathGameRoot / "addons" / "sourcejs";
		m_PathData = m_PathAddonRoot / "data";
		m_PathSourceJSData = m_PathData / "sourcejs";
		m_PathExtensionRoot = m_PathAddonRoot / "extensions";
		m_PathPackageRoot = m_PathAddonRoot / "packages";
		m_PathPluginRoot = m_PathAddonRoot / "plugins";
	}

	std::filesystem::path const& RuntimePaths::GetGameRootPath() const {
		return m_PathGameRoot;
	}

	std::filesystem::path const& RuntimePaths::GetAddonRootPath() const {
		return m_PathAddonRoot;
	}

	std::filesystem::path const& RuntimePaths::GetDataPath() const {
		return m_PathData;
	}

	std::filesystem::path const& RuntimePaths::GetSourceJSDataPath() const {
		return m_PathSourceJSData;
	}

	std::filesystem::path const& RuntimePaths::GetExtensionRootPath() const {
		return m_PathExtensionRoot;
	}

	std::filesystem::path const& RuntimePaths::GetPackageRootPath() const {
		return m_PathPackageRoot;
	}

	std::filesystem::path const& RuntimePaths::GetPluginRootPath() const {
		return m_PathPluginRoot;
	}
} // namespace SourceJS
