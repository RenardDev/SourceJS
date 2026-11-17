#pragma once

#ifndef _SOURCEJSEXTENSIONMANAGER_H_
#define _SOURCEJSEXTENSIONMANAGER_H_

// Compatibility profile: retain this project-canonical reserved guard spelling
// under CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this header guard.

// STL
#include <filesystem>
#include <string>
#include <vector>

// Project
#include "sourcejs/ExtensionRuntime.h"

// ================================================================
// ExtensionManager
// ================================================================

namespace SourceJS {

	class RuntimePaths;
	using fnInvalidateExtensionModules = void(*)(void* pData, std::string const& strName);

	struct ExtensionNativeFunction {
		std::string m_strName;
		fnSourceJSExtensionInvoke m_Invoke;
		void* m_pData;
		std::uint64_t m_unID;
	};

	struct ExtensionNativeModule {
		std::string m_strName;
		std::vector<ExtensionNativeFunction> m_vecFunctions;
	};

	// The manager owns the library; these handles and API callbacks expire on unload.
	struct ExtensionRecord {
		std::string m_strName;
		std::filesystem::path m_PathDirectory;
		std::filesystem::path m_PathBinary;
		SOURCEJS_EXTENSION_API m_API;
		std::vector<ExtensionNativeModule> m_vecNativeModules;
		ExtensionRuntimeOwner m_pRuntime;
		void* m_hLibraryHandle;
		bool m_bAutoLoad;
		bool m_bEnabled;
		bool m_bLoaded;
	};

	// Game-thread confined. Extension callbacks must not re-enter this manager.
	// Shutdown must precede destruction while the runtime and paths remain valid.
	class ExtensionManager {
	public:
		ExtensionManager() noexcept;
		ExtensionManager(ExtensionManager const&) = delete;
		ExtensionManager(ExtensionManager&&) = delete;
		ExtensionManager& operator=(ExtensionManager const&) = delete;
		ExtensionManager& operator=(ExtensionManager&&) = delete;

	public:
		void Initialize(RuntimePaths const* const pRuntimePaths, v8::Platform* pPlatform, fnInvalidateExtensionModules InvalidateModules = nullptr, void* pInvalidationData = nullptr);
		void Shutdown();
		void Refresh();
		void LoadAll();
		bool Load(std::string const& strSelector);
		bool Unload(std::string const& strSelector);
		bool Reload(std::string const& strSelector);
		void UnloadAll();
		void ReloadAll();
		bool Disable(std::string const& strSelector);
		bool Enable(std::string const& strSelector);
		std::vector<std::string> List() const;

		// Borrowed records: mutation may invalidate elements; unload expires native APIs.
		std::vector<ExtensionRecord> const& GetExtensions() const noexcept;

		ExtensionNativeModule const* FindNativeModule(std::string const& strModuleName) const noexcept;
		bool ResolveNativeBinding(std::uint64_t unID, ExtensionRuntime*& pRuntimeOut, fnSourceJSExtensionInvoke& InvokeOut, void*& pDataOut) const noexcept;

	private:
		ExtensionRecord* Resolve(std::string const& strSelector) noexcept;
		ExtensionRecord* ResolveByName(std::string const& strExtensionName) noexcept;
		bool RemoveRecord(std::string const& strExtensionName);
		std::vector<std::string> DiscoverNames() const;
		void* OpenLibrary(std::filesystem::path const& PathBinary) const;
		void* ResolveSymbol(void* const hLibraryHandle, char const* const pszSymbolName) const noexcept;
		bool CloseLibrary(void* const hLibraryHandle) const noexcept;
		bool IsLibraryMapped(std::filesystem::path const& PathBinary) const noexcept;
		void LoadState();
		void SaveState() const;
		bool IsDisabledInState(std::string const& strExtensionName) const noexcept;
		bool BuildRecord(std::string const& strExtensionName, ExtensionRecord& ExtensionRecordOut) const;

	private:
		RuntimePaths const* m_pRuntimePaths;
		v8::Platform* m_pPlatform;
		fnInvalidateExtensionModules m_InvalidateModules;
		void* m_pInvalidationData;
		std::vector<ExtensionRecord> m_vecExtensions;
		std::vector<std::string> m_vecDisabledExtensionNames;
		std::uint64_t m_unLastBindingID;
		bool m_bChanging;
	};
} // namespace SourceJS
#endif // _SOURCEJSEXTENSIONMANAGER_H_
