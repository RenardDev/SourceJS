#include "sourcejs/ExtensionManager.h"

// General
#if defined(_WIN32)
#include <Windows.h>
#else
#include <dlfcn.h>
#endif

// C++
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <utility>

// STL
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <limits>
#include <memory>
#include <sstream>
#include <type_traits>

// Project
#include "sourcejs/Log.h"
#include "sourcejs/ManagerManifest.h"
#include "sourcejs/ManagerState.h"
#include "sourcejs/RuntimePaths.h"

// ================================================================
// Extension file helpers
// ================================================================

namespace SourceJS {

	namespace {

		constexpr std::uint32_t kMaximumExtensionModuleCount = 128;
		constexpr std::uint32_t kMaximumExtensionFunctionCount = 256;
		constexpr std::size_t kExtensionNameCapacity = 256;

		struct ExtensionLifecycleScope {
			bool& m_bChanging;

			~ExtensionLifecycleScope() {
				m_bChanging = false;
			}
		};

		bool IsDecimalText(std::string const& strText) noexcept {
			if (strText.empty()) {
				return false;
			}

			for (std::size_t unCharacterIndex = 0; unCharacterIndex < strText.size(); ++unCharacterIndex) {
				if (!std::isdigit(static_cast<unsigned char>(strText[unCharacterIndex]))) {
					return false;
				}
			}

			return true;
		}

		bool ReadTextFile(std::filesystem::path const& PathFile, std::string& strTextOut) {
			constexpr std::size_t kReadBufferByteCount = 4096;

			std::ifstream InputFile(PathFile, std::ios::binary);
			if (!InputFile) {
				return false;
			}

			std::string strText {};
			char arrBuffer[kReadBufferByteCount] {};
			while (InputFile) {
				InputFile.read(arrBuffer, static_cast<std::streamsize>(kReadBufferByteCount));
				const std::streamsize nByteCount = InputFile.gcount();
				if (nByteCount > 0) {
					strText.append(arrBuffer, static_cast<std::size_t>(nByteCount));
				}
			}

			if (!InputFile.eof() || InputFile.bad()) {
				return false;
			}

			strTextOut = std::move(strText);

			return true;
		}

		std::string ReadManifestString(std::filesystem::path const& PathManifest, std::string const& strKey, std::string const& strFallback) {
			std::string strManifest {};
			if (!ReadTextFile(PathManifest, strManifest)) {
				return strFallback;
			}

			std::string const strKeyNeedle = "\"" + strKey + "\"";
			const std::size_t unKeyOffset = strManifest.find(strKeyNeedle);
			if (unKeyOffset == std::string::npos) {
				return strFallback;
			}

			const std::size_t unColonOffset = strManifest.find(':', unKeyOffset + strKeyNeedle.size());
			if (unColonOffset == std::string::npos) {
				return strFallback;
			}

			const std::size_t unValueStart = strManifest.find('"', unColonOffset + 1);
			if (unValueStart == std::string::npos) {
				return strFallback;
			}

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

			std::string const strKeyNeedle = "\"" + strKey + "\"";
			const std::size_t unKeyOffset = strManifest.find(strKeyNeedle);
			if (unKeyOffset == std::string::npos) {
				return bFallback;
			}

			const std::size_t unColonOffset = strManifest.find(':', unKeyOffset + strKeyNeedle.size());
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

		bool ContainsExtensionName(std::vector<std::string> const& vecExtensionNames, std::string const& strExtensionName) noexcept {
			for (std::size_t unExtensionIndex = 0; unExtensionIndex < vecExtensionNames.size(); ++unExtensionIndex) {
				if (vecExtensionNames[unExtensionIndex] == strExtensionName) {
					return true;
				}
			}

			return false;
		}

		void RemoveExtensionName(std::vector<std::string>& vecExtensionNames, std::string const& strExtensionName) {
			for (std::size_t unExtensionIndex = 0; unExtensionIndex < vecExtensionNames.size(); ++unExtensionIndex) {
				if (vecExtensionNames[unExtensionIndex] == strExtensionName) {
					vecExtensionNames.erase(vecExtensionNames.begin() + static_cast<std::ptrdiff_t>(unExtensionIndex));
					return;
				}
			}
		}

		void LogExtensionMessage(char const* const pszMessage) noexcept {
			if (!pszMessage) {
				return;
			}

			LogInfo("Extension.Log Message=\"%s\"", pszMessage);
		}

		bool CopyBoundedExtensionText(char const* const pszText, const std::size_t unMaximumLength, std::string& strTextOut) {
			if (!pszText) {
				return false;
			}

			std::size_t unTextLength = 0;
			while ((unTextLength < unMaximumLength) && (pszText[unTextLength] != '\0')) {
				++unTextLength;
			}

			if (unTextLength == unMaximumLength) {
				return false;
			}

			strTextOut.assign(pszText, unTextLength);

			return true;
		}

		bool IsValidExtensionModuleName(std::string const& strModuleName) noexcept {
			if (strModuleName.empty() || (strModuleName.size() >= kExtensionNameCapacity) || (strModuleName.front() == '/') || (strModuleName.back() == '/')) {
				return false;
			}

			std::size_t unSegmentStart = 0;
			for (std::size_t unCharacterIndex = 0; unCharacterIndex <= strModuleName.size(); ++unCharacterIndex) {
				if ((unCharacterIndex < strModuleName.size()) && (strModuleName[unCharacterIndex] != '/')) {
					const unsigned char chCharacter = static_cast<unsigned char>(strModuleName[unCharacterIndex]);
					const bool bIsASCIIAlphaNumeric = ((chCharacter >= 'A') && (chCharacter <= 'Z')) || ((chCharacter >= 'a') && (chCharacter <= 'z')) || ((chCharacter >= '0') && (chCharacter <= '9'));
					if (!bIsASCIIAlphaNumeric && (chCharacter != '_') && (chCharacter != '-') && (chCharacter != '.')) {
						return false;
					}

					continue;
				}

				const std::size_t unSegmentLength = unCharacterIndex - unSegmentStart;
				const bool bIsCurrentDirectorySegment = (unSegmentLength == 1) && (strModuleName[unSegmentStart] == '.');
				const bool bIsParentDirectorySegment = (unSegmentLength == 2) && (strModuleName[unSegmentStart] == '.') && (strModuleName[unSegmentStart + 1] == '.');
				if ((unSegmentLength == 0) || bIsCurrentDirectorySegment || bIsParentDirectorySegment) {
					return false;
				}

				unSegmentStart = unCharacterIndex + 1;
			}

			return true;
		}

		bool IsValidExtensionName(std::string const& strExtensionName) noexcept {
			if (strExtensionName.empty() || (strExtensionName == ".") || (strExtensionName == "..")) {
				return false;
			}

			for (std::size_t unCharacterIndex = 0; unCharacterIndex < strExtensionName.size(); ++unCharacterIndex) {
				const unsigned char chCharacter = static_cast<unsigned char>(strExtensionName[unCharacterIndex]);
				const bool bIsASCIIAlphaNumeric = ((chCharacter >= 'A') && (chCharacter <= 'Z')) || ((chCharacter >= 'a') && (chCharacter <= 'z')) || ((chCharacter >= '0') && (chCharacter <= '9'));
				if (!bIsASCIIAlphaNumeric && (chCharacter != '_') && (chCharacter != '-') && (chCharacter != '.')) {
					return false;
				}
			}

			return true;
		}

		bool IsValidExtensionFunctionName(std::string const& strName) noexcept {
			if (strName.empty() || (strName.front() < 'A') || (strName.front() > 'Z')) {
				return false;
			}

			for (const char chCharacter : strName) {
				if (!((chCharacter >= 'A') && (chCharacter <= 'Z')) && !((chCharacter >= 'a') && (chCharacter <= 'z')) && !((chCharacter >= '0') && (chCharacter <= '9')) && (chCharacter != '_')) {
					return false;
				}
			}

			return true;
		}

		bool ReadExtensionNativeModules(std::string const& strExtensionName, SOURCEJS_EXTENSION_API const& ExtensionAPI, std::uint64_t& unLastBindingID, std::vector<ExtensionNativeModule>& vecModulesOut) {
			if (!ExtensionAPI.m_pGetModuleCount || !ExtensionAPI.m_pGetModule) {
				return false;
			}

			std::uint32_t unModuleCount = 0;
			try {
				unModuleCount = ExtensionAPI.m_pGetModuleCount();
			} catch (...) {
				return false;
			}

			if ((unModuleCount == 0) || (unModuleCount > kMaximumExtensionModuleCount)) {
				return false;
			}

			std::uint64_t unBindingID = unLastBindingID;
			std::vector<ExtensionNativeModule> vecModules {};
			vecModules.reserve(unModuleCount);
			for (std::uint32_t unModuleIndex = 0; unModuleIndex < unModuleCount; ++unModuleIndex) {
				SOURCEJS_EXTENSION_MODULE Module {};
				try {
					if (!ExtensionAPI.m_pGetModule(unModuleIndex, &Module)) {
						return false;
					}
				} catch (...) {
					return false;
				}

				ExtensionNativeModule ModuleRecord {};
				if (!Module.m_pFunctions || (Module.m_unFunctionCount == 0) || (Module.m_unFunctionCount > kMaximumExtensionFunctionCount) || (Module.m_unFunctionCount > (std::numeric_limits<std::uint64_t>::max() - unBindingID)) || !CopyBoundedExtensionText(Module.m_pszName, kExtensionNameCapacity, ModuleRecord.m_strName) || !IsValidExtensionModuleName(ModuleRecord.m_strName)) {
					return false;
				}

				ModuleRecord.m_strName = "extensions/" + strExtensionName + "/" + ModuleRecord.m_strName;
				for (auto const& ExistingModule : vecModules) {
					if (ExistingModule.m_strName == ModuleRecord.m_strName) {
						return false;
					}
				}

				ModuleRecord.m_vecFunctions.reserve(Module.m_unFunctionCount);
				for (std::uint32_t unFunctionIndex = 0; unFunctionIndex < Module.m_unFunctionCount; ++unFunctionIndex) {
					SOURCEJS_EXTENSION_FUNCTION const& Function = Module.m_pFunctions[unFunctionIndex];
					ExtensionNativeFunction Binding {};
					if (!Function.m_Invoke || !CopyBoundedExtensionText(Function.m_pszName, kExtensionNameCapacity, Binding.m_strName) || !IsValidExtensionFunctionName(Binding.m_strName)) {
						return false;
					}

					for (auto const& ExistingBinding : ModuleRecord.m_vecFunctions) {
						if (ExistingBinding.m_strName == Binding.m_strName) {
							return false;
						}
					}

					Binding.m_Invoke = Function.m_Invoke;
					Binding.m_pData = Function.m_pData;
					Binding.m_unID = ++unBindingID;
					ModuleRecord.m_vecFunctions.push_back(std::move(Binding));
				}

				vecModules.push_back(std::move(ModuleRecord));
			}

			vecModulesOut = std::move(vecModules);
			unLastBindingID = unBindingID;

			return true;
		}

		std::filesystem::path BuildDefaultBinaryPath(std::filesystem::path const& PathDirectory, std::string const& strExtensionName) {
#if defined(_WIN32)
			constexpr char const* kLibrarySuffix = ".dll";
#else
			constexpr char const* kLibrarySuffix = ".so";
#endif

			std::string const strPlatformDirectory = std::string(SOURCEJS_TARGET_PLATFORM) + "-" + SOURCEJS_TARGET_ARCH;
			std::filesystem::path const PathPlatformBinary = PathDirectory / "bin" / strPlatformDirectory / (strExtensionName + kLibrarySuffix);
			if (std::filesystem::exists(PathPlatformBinary)) {
				return PathPlatformBinary;
			}

			return PathDirectory / "bin" / (strExtensionName + kLibrarySuffix);
		}

	} // namespace

	// ================================================================
	// ExtensionManager
	// ================================================================

	ExtensionManager::ExtensionManager() noexcept {
		m_pRuntimePaths = nullptr;
		m_pPlatform = nullptr;
		m_InvalidateModules = nullptr;
		m_pInvalidationData = nullptr;
		m_unLastBindingID = 0;
		m_bChanging = false;
	}

	void ExtensionManager::Initialize(RuntimePaths const* const pRuntimePaths, v8::Platform* const pPlatform, fnInvalidateExtensionModules InvalidateModules, void* const pInvalidationData) {
		if (!pRuntimePaths || !pPlatform) {
			LogError("ExtensionManager.Initialize failed: runtime paths or V8 platform are missing.");
			return;
		}

		m_pRuntimePaths = pRuntimePaths;
		m_pPlatform = pPlatform;
		m_InvalidateModules = InvalidateModules;
		m_pInvalidationData = pInvalidationData;
		LoadState();

		LoadAll();
	}

	void ExtensionManager::Shutdown() {
		if (!m_pRuntimePaths) {
			return;
		}

		UnloadAll();
		SaveState();

		if (!m_vecExtensions.empty()) {
			LogError("ExtensionManager.Shutdown failed RemainingExtensions=%zu.", m_vecExtensions.size());
			return;
		}

		m_vecDisabledExtensionNames.clear();
		m_pRuntimePaths = nullptr;
		m_pPlatform = nullptr;
		m_InvalidateModules = nullptr;
		m_pInvalidationData = nullptr;
	}

	void ExtensionManager::Refresh() {
		if (!m_pRuntimePaths) {
			return;
		}

		LoadAll();
	}

	void ExtensionManager::LoadAll() {
		if (!m_pRuntimePaths) {
			return;
		}

		std::vector<std::string> const vecExtensionNames = DiscoverNames();
		for (std::size_t unExtensionIndex = 0; unExtensionIndex < vecExtensionNames.size(); ++unExtensionIndex) {
			std::string const& strExtensionName = vecExtensionNames[unExtensionIndex];
			if (IsDisabledInState(strExtensionName)) {
				continue;
			}

			ExtensionRecord ExtensionCandidate {};
			if (BuildRecord(strExtensionName, ExtensionCandidate) && !ExtensionCandidate.m_bAutoLoad) {
				continue;
			}

			Load(strExtensionName);
		}
	}

	bool ExtensionManager::Load(std::string const& strSelector) {
		if (m_bChanging) {
			LogWarning("ExtensionManager.Load rejected: extension lifecycle callback is active.");
			return false;
		}

		if (!m_pRuntimePaths) {
			LogError("ExtensionManager.Load failed: runtime paths are missing.");
			return false;
		}

		if (IsDecimalText(strSelector)) {
			LogWarning("ExtensionManager.Load rejected numeric Selector=\"%s\".", strSelector.c_str());
			return false;
		}

		auto* const pLoadedExtension = ResolveByName(strSelector);
		if (pLoadedExtension) {
			if (!pLoadedExtension->m_bLoaded) {
				LogWarning("ExtensionManager.Load rejected Extension=\"%s\": previous unload has not completed.", strSelector.c_str());
				return false;
			}

			LogInfo("ExtensionManager.Load already loaded Extension=\"%s\".", pLoadedExtension->m_strName.c_str());
			return true;
		}

		ExtensionRecord ExtensionCandidate {};
		if (!BuildRecord(strSelector, ExtensionCandidate)) {
			LogWarning("ExtensionManager.Load not found Selector=\"%s\".", strSelector.c_str());
			return false;
		}

		if (!ExtensionCandidate.m_bEnabled) {
			LogWarning("ExtensionManager.Load disabled Extension=\"%s\".", ExtensionCandidate.m_strName.c_str());
			return false;
		}

		m_bChanging = true;
		ExtensionLifecycleScope LifecycleScope { m_bChanging };
		m_vecExtensions.reserve(m_vecExtensions.size() + 1);

		std::string const strExtensionName = ExtensionCandidate.m_strName;
		void* const hLibraryHandle = OpenLibrary(ExtensionCandidate.m_PathBinary);
		if (!hLibraryHandle) {
			LogError("ExtensionManager.Load failed Path=\"%s\".", ExtensionCandidate.m_PathBinary.string().c_str());
			return false;
		}

		SOURCEJS_EXTENSION_API ExtensionAPI {};
		bool bLoadCompleted = false;
		auto ReleaseLibrary = [this, &ExtensionCandidate, &ExtensionAPI, &bLoadCompleted, &strExtensionName](void* const hOwnedLibrary) noexcept {
			bool bStopped = true;
			if (bLoadCompleted && ExtensionCandidate.m_pRuntime) {
				bStopped = StopExtensionRuntime(*ExtensionCandidate.m_pRuntime, ExtensionAPI.m_pUnload);
			}

			if (bStopped) {
				ExtensionCandidate.m_pRuntime.reset();
				bStopped = CloseLibrary(hOwnedLibrary);
			}

			if (!bStopped) {
				// The reserved record keeps the library and isolate alive when rollback cannot finish.
				LogError("ExtensionManager.Load retained failed load Extension=\"%s\"; retry unload.", strExtensionName.c_str());
				ExtensionCandidate.m_API = ExtensionAPI;
				ExtensionCandidate.m_hLibraryHandle = hOwnedLibrary;
				ExtensionCandidate.m_bLoaded = false;
				m_vecExtensions.push_back(std::move(ExtensionCandidate));
			}
		};
		std::unique_ptr<void, decltype(ReleaseLibrary)> pLibraryOwner(hLibraryHandle, ReleaseLibrary);

		for (auto const& Extension : m_vecExtensions) {
			if (Extension.m_hLibraryHandle == hLibraryHandle) {
				LogError("ExtensionManager.Load rejected Extension=\"%s\": native library is already registered as Extension=\"%s\".", strExtensionName.c_str(), Extension.m_strName.c_str());
				return false;
			}
		}

		void* const pSymbol = ResolveSymbol(hLibraryHandle, "SourceJS_GetNativeExtensionAPI");
		if (!pSymbol) {
			LogError("ExtensionManager.Load missing native V8 API export Extension=\"%s\"; rebuild for extension ABI %u.", strExtensionName.c_str(), static_cast<unsigned int>(SOURCEJS_EXTENSION_ABI_VERSION));
			return false;
		}

		fnSourceJSGetNativeExtensionAPI const GetExtensionAPI = reinterpret_cast<fnSourceJSGetNativeExtensionAPI>(pSymbol);
		bool bAPIExported = false;
		bool bAPIExportException = false;
		try {
			bAPIExported = GetExtensionAPI(SOURCEJS_EXTENSION_ABI_VERSION, sizeof(ExtensionAPI), &ExtensionAPI);
		} catch (...) {
			bAPIExportException = true;
		}

		if (!bAPIExported) {
			LogError("ExtensionManager.Load API export failed Extension=\"%s\" Exception=%d.", strExtensionName.c_str(), bAPIExportException);
			return false;
		}

		std::string strV8ABI {};
		if ((ExtensionAPI.m_unABIVersion != SOURCEJS_EXTENSION_ABI_VERSION) || (ExtensionAPI.m_unSize != sizeof(ExtensionAPI)) || !CopyBoundedExtensionText(ExtensionAPI.m_pszV8ABI, sizeof(SOURCEJS_EXTENSION_V8_ABI), strV8ABI) || (strV8ABI != SOURCEJS_EXTENSION_V8_ABI)) {
			LogError("ExtensionManager.Load native V8 ABI mismatch Extension=\"%s\"; rebuild against this SourceJS build.", strExtensionName.c_str());
			return false;
		}

		std::string const strRootPath = m_pRuntimePaths->GetAddonRootPath().string();
		SOURCEJS_EXTENSION_CONTEXT ExtensionContext {};
		ExtensionContext.m_pszRootPath = strRootPath.c_str();
		ExtensionContext.m_pszSDKBranch = SOURCEJS_SDK_BRANCH;
		ExtensionContext.m_pszPlatform = SOURCEJS_TARGET_PLATFORM;
		ExtensionContext.m_pszArchitecture = SOURCEJS_TARGET_ARCH;
		ExtensionContext.m_pLog = LogExtensionMessage;

		ExtensionCandidate.m_pRuntime = CreateExtensionRuntime(m_pPlatform);
		if (!ExtensionCandidate.m_pRuntime || !StartExtensionRuntime(*ExtensionCandidate.m_pRuntime, ExtensionAPI.m_pLoad, ExtensionContext, bLoadCompleted)) {
			LogError("ExtensionManager.Load isolate initialization failed Extension=\"%s\".", strExtensionName.c_str());
			return false;
		}

		if (!ReadExtensionNativeModules(strExtensionName, ExtensionAPI, m_unLastBindingID, ExtensionCandidate.m_vecNativeModules)) {
			LogError("ExtensionManager.Load invalid native binding table Extension=\"%s\".", strExtensionName.c_str());
			return false;
		}

		ExtensionCandidate.m_API = ExtensionAPI;
		ExtensionCandidate.m_hLibraryHandle = hLibraryHandle;
		ExtensionCandidate.m_bLoaded = true;
		m_vecExtensions.push_back(std::move(ExtensionCandidate));
		pLibraryOwner.release();

		LogInfo("ExtensionManager.Load loaded Extension=\"%s\".", strExtensionName.c_str());

		return true;
	}

	bool ExtensionManager::Unload(std::string const& strSelector) {
		if (m_bChanging) {
			LogWarning("ExtensionManager.Unload rejected: extension lifecycle callback is active.");
			return false;
		}

		auto* const pExtension = Resolve(strSelector);
		if (!pExtension) {
			LogWarning("ExtensionManager.Unload not found Selector=\"%s\".", strSelector.c_str());
			return false;
		}

		std::string const strExtensionName = pExtension->m_strName;
		if (pExtension->m_pRuntime && IsExtensionRuntimeInvoking(*pExtension->m_pRuntime)) {
			LogWarning("ExtensionManager.Unload rejected Extension=\"%s\": binding call is still on the game thread.", strExtensionName.c_str());
			return false;
		}

		m_bChanging = true;
		ExtensionLifecycleScope LifecycleScope { m_bChanging };
		if (m_InvalidateModules) {
			m_InvalidateModules(m_pInvalidationData, strExtensionName);
		}

		pExtension->m_bLoaded = false;

		if (pExtension->m_pRuntime && !StopExtensionRuntime(*pExtension->m_pRuntime, pExtension->m_API.m_pUnload)) {
			LogError("ExtensionManager.Unload cleanup failed Extension=\"%s\"; library retained for a retry.", strExtensionName.c_str());
			return false;
		}

		pExtension->m_pRuntime.reset();
		if (pExtension->m_hLibraryHandle && !CloseLibrary(pExtension->m_hLibraryHandle)) {
			return false;
		}

		pExtension->m_hLibraryHandle = nullptr;
		pExtension->m_API = {};

		if (IsLibraryMapped(pExtension->m_PathBinary)) {
			LogError("ExtensionManager.Unload library remains mapped Extension=\"%s\"; another owner or loader policy is keeping it resident.", strExtensionName.c_str());
			return false;
		}

		const bool bRecordRemoved = RemoveRecord(strExtensionName);

		if (!bRecordRemoved) {
			LogError("ExtensionManager.Unload failed to remove Extension=\"%s\".", strExtensionName.c_str());
			return false;
		}

		LogInfo("ExtensionManager.Unload unloaded Extension=\"%s\".", strExtensionName.c_str());

		return true;
	}

	bool ExtensionManager::Reload(std::string const& strSelector) {
		auto* const pExtension = Resolve(strSelector);
		if (!pExtension) {
			LogWarning("ExtensionManager.Reload not found Selector=\"%s\".", strSelector.c_str());
			return false;
		}

		std::string const strExtensionName = pExtension->m_strName;
		if (!Unload(strExtensionName)) {
			return false;
		}

		return Load(strExtensionName);
	}

	void ExtensionManager::UnloadAll() {
		std::vector<std::string> vecExtensionNames {};
		vecExtensionNames.reserve(m_vecExtensions.size());
		for (std::size_t unExtensionIndex = 0; unExtensionIndex < m_vecExtensions.size(); ++unExtensionIndex) {
			vecExtensionNames.push_back(m_vecExtensions[unExtensionIndex].m_strName);
		}

		// Each unload is independent; continue cleaning up after individual failures.
		for (std::size_t unExtensionIndex = 0; unExtensionIndex < vecExtensionNames.size(); ++unExtensionIndex) {
			Unload(vecExtensionNames[unExtensionIndex]);
		}
	}

	void ExtensionManager::ReloadAll() {
		UnloadAll();

		LoadAll();
	}

	bool ExtensionManager::Disable(std::string const& strSelector) {
		if (!m_pRuntimePaths) {
			LogError("ExtensionManager.Disable failed: runtime paths are missing.");
			return false;
		}

		std::string strExtensionName {};
		auto* const pLoadedExtension = Resolve(strSelector);
		if (pLoadedExtension) {
			strExtensionName = pLoadedExtension->m_strName;

		} else if (!IsDecimalText(strSelector)) {
			ExtensionRecord ExtensionCandidate {};
			if (BuildRecord(strSelector, ExtensionCandidate)) {
				strExtensionName = ExtensionCandidate.m_strName;
			}
		}

		if (strExtensionName.empty()) {
			LogWarning("ExtensionManager.Disable not found Selector=\"%s\".", strSelector.c_str());
			return false;
		}

		if (pLoadedExtension) {
			if (!Unload(strExtensionName)) {
				return false;
			}
		}

		if (!ContainsExtensionName(m_vecDisabledExtensionNames, strExtensionName)) {
			m_vecDisabledExtensionNames.push_back(strExtensionName);
		}

		SaveState();

		LogInfo("ExtensionManager.Disable disabled Extension=\"%s\".", strExtensionName.c_str());

		return true;
	}

	bool ExtensionManager::Enable(std::string const& strSelector) {
		if (!m_pRuntimePaths) {
			LogError("ExtensionManager.Enable failed: runtime paths are missing.");
			return false;
		}

		std::string strExtensionName {};
		auto* const pLoadedExtension = Resolve(strSelector);
		if (pLoadedExtension) {
			strExtensionName = pLoadedExtension->m_strName;

		} else if (!IsDecimalText(strSelector)) {
			strExtensionName = strSelector;
		}

		if (strExtensionName.empty()) {
			LogWarning("ExtensionManager.Enable not found Selector=\"%s\".", strSelector.c_str());
			return false;
		}

		RemoveExtensionName(m_vecDisabledExtensionNames, strExtensionName);
		SaveState();

		LogInfo("ExtensionManager.Enable enabled Extension=\"%s\".", strExtensionName.c_str());

		return Load(strExtensionName);
	}

	std::vector<std::string> ExtensionManager::List() const {
		std::vector<std::string> vecOutputLines {};
		vecOutputLines.reserve(m_vecExtensions.size());

		for (std::size_t unExtensionIndex = 0; unExtensionIndex < m_vecExtensions.size(); ++unExtensionIndex) {
			ExtensionRecord const& ExtensionInformation = m_vecExtensions[unExtensionIndex];

			std::ostringstream OutputStream {};

			OutputStream << (unExtensionIndex + 1) << ". " << ExtensionInformation.m_strName << (ExtensionInformation.m_bLoaded ? " [loaded, " : " [cleanup pending, ") << (ExtensionInformation.m_bEnabled ? "enabled" : "disabled") << "] " << ExtensionInformation.m_PathBinary.string();

			vecOutputLines.push_back(OutputStream.str());
		}

		if (vecOutputLines.empty()) {
			vecOutputLines.push_back("No extensions loaded.");
		}

		return vecOutputLines;
	}

	std::vector<ExtensionRecord> const& ExtensionManager::GetExtensions() const noexcept {
		return m_vecExtensions;
	}

	ExtensionNativeModule const* ExtensionManager::FindNativeModule(std::string const& strModuleName) const noexcept {
		for (auto const& ExtensionInformation : m_vecExtensions) {
			if (!ExtensionInformation.m_bLoaded) {
				continue;
			}

			for (auto const& Module : ExtensionInformation.m_vecNativeModules) {
				if (Module.m_strName == strModuleName) {
					return &Module;
				}
			}
		}

		return nullptr;
	}

	bool ExtensionManager::ResolveNativeBinding(const std::uint64_t unID, ExtensionRuntime*& pRuntimeOut, fnSourceJSExtensionInvoke& InvokeOut, void*& pDataOut) const noexcept {
		for (auto const& ExtensionInformation : m_vecExtensions) {
			if (!ExtensionInformation.m_bLoaded) {
				continue;
			}

			for (auto const& Module : ExtensionInformation.m_vecNativeModules) {
				const std::uint64_t unFirstID = Module.m_vecFunctions.front().m_unID;
				if ((unID < unFirstID) || (unID > Module.m_vecFunctions.back().m_unID)) {
					continue;
				}

				ExtensionNativeFunction const& Binding = Module.m_vecFunctions[static_cast<std::size_t>(unID - unFirstID)];
				pRuntimeOut = ExtensionInformation.m_pRuntime.get();
				InvokeOut = Binding.m_Invoke;
				pDataOut = Binding.m_pData;

				return true;
			}
		}

		return false;
	}

	ExtensionRecord* ExtensionManager::Resolve(std::string const& strSelector) noexcept {
		if (IsDecimalText(strSelector)) {
			char* pszEnd = nullptr;
			errno = 0;
			const unsigned long long unOneBasedIndex = std::strtoull(strSelector.c_str(), &pszEnd, 10);
			const int nParseError = errno;
			if ((nParseError == 0) && pszEnd && (*pszEnd == '\0') && (unOneBasedIndex > 0) && (unOneBasedIndex <= static_cast<unsigned long long>(m_vecExtensions.size()))) {
				return &m_vecExtensions[static_cast<std::size_t>(unOneBasedIndex - 1)];
			}
		}

		for (std::size_t unExtensionIndex = 0; unExtensionIndex < m_vecExtensions.size(); ++unExtensionIndex) {
			if (m_vecExtensions[unExtensionIndex].m_strName == strSelector) {
				return &m_vecExtensions[unExtensionIndex];
			}
		}

		return nullptr;
	}

	ExtensionRecord* ExtensionManager::ResolveByName(std::string const& strExtensionName) noexcept {
		for (std::size_t unExtensionIndex = 0; unExtensionIndex < m_vecExtensions.size(); ++unExtensionIndex) {
			if (m_vecExtensions[unExtensionIndex].m_strName == strExtensionName) {
				return &m_vecExtensions[unExtensionIndex];
			}
		}

		return nullptr;
	}

	bool ExtensionManager::IsDisabledInState(std::string const& strExtensionName) const noexcept {
		return ContainsExtensionName(m_vecDisabledExtensionNames, strExtensionName);
	}

	bool ExtensionManager::BuildRecord(std::string const& strExtensionName, ExtensionRecord& ExtensionRecordOut) const {
		static_assert(std::is_nothrow_move_assignable_v<ExtensionRecord>, "Extension records must commit without throwing.");

		if (!m_pRuntimePaths || !IsValidExtensionName(strExtensionName)) {
			return false;
		}

		std::filesystem::path const PathExtensionDirectory = m_pRuntimePaths->GetExtensionRootPath() / strExtensionName;
		std::error_code ErrorCode {};
		if (!std::filesystem::is_directory(PathExtensionDirectory, ErrorCode)) {
			return false;
		}

		std::filesystem::path const PathManifest = PathExtensionDirectory / "extension.json";
		std::string strManifest {};
		if (ReadTextFile(PathManifest, strManifest)) {
			auto HasLegacyControl = [&strManifest](char const* const pszKey) {
				std::string const strKeyNeedle = "\"" + std::string(pszKey) + "\"";
				std::size_t unKeyOffset = strManifest.find(strKeyNeedle);
				while (unKeyOffset != std::string::npos) {
					std::size_t unColonOffset = unKeyOffset + strKeyNeedle.size();
					while ((unColonOffset < strManifest.size()) && std::isspace(static_cast<unsigned char>(strManifest[unColonOffset]))) {
						++unColonOffset;
					}

					if ((unColonOffset < strManifest.size()) && (strManifest[unColonOffset] == ':')) {
						return true;
					}

					unKeyOffset = strManifest.find(strKeyNeedle, unColonOffset);
				}

				return false;
			};

			// Ignoring an old autoload=false could unexpectedly load a native library.
			if (HasLegacyControl("binary") || HasLegacyControl("autoload")) {
				LogError("ExtensionManager.BuildRecord rejected legacy manifest controls Path=\"%s\" Expected=Binary/Autoload.", PathManifest.string().c_str());
				return false;
			}
		}

		std::filesystem::path PathBinary = BuildDefaultBinaryPath(PathExtensionDirectory, strExtensionName);
		std::string const strManifestBinary = ReadManifestString(PathManifest, "Binary", "");
		if (strManifestBinary.find('\0') != std::string::npos) {
			return false;
		}

		if (!strManifestBinary.empty()) {
			PathBinary = PathExtensionDirectory / strManifestBinary;
		}

		ExtensionRecord ExtensionCandidate {};
		ExtensionCandidate.m_strName = strExtensionName;
		ExtensionCandidate.m_PathDirectory = PathExtensionDirectory;
		ExtensionCandidate.m_PathBinary = std::move(PathBinary);
		ExtensionCandidate.m_bAutoLoad = ReadManifestBoolean(PathManifest, "Autoload", true);
		ExtensionCandidate.m_bEnabled = !IsDisabledInState(strExtensionName);
		ExtensionRecordOut = std::move(ExtensionCandidate);

		return true;
	}

	bool ExtensionManager::RemoveRecord(std::string const& strExtensionName) {
		for (std::size_t unExtensionIndex = 0; unExtensionIndex < m_vecExtensions.size(); ++unExtensionIndex) {
			if (m_vecExtensions[unExtensionIndex].m_strName == strExtensionName) {
				m_vecExtensions.erase(m_vecExtensions.begin() + static_cast<std::ptrdiff_t>(unExtensionIndex));
				return true;
			}
		}

		return false;
	}

	std::vector<std::string> ExtensionManager::DiscoverNames() const {
		std::vector<std::string> vecExtensionNames {};
		if (!m_pRuntimePaths) {
			return vecExtensionNames;
		}

		std::error_code ErrorCode {};
		std::filesystem::create_directories(m_pRuntimePaths->GetExtensionRootPath(), ErrorCode);

		auto itDirectory = std::filesystem::directory_iterator(m_pRuntimePaths->GetExtensionRootPath(), ErrorCode);
		auto itDirectoryEnd = std::filesystem::directory_iterator {};

		for (; !ErrorCode && (itDirectory != itDirectoryEnd); itDirectory.increment(ErrorCode)) {
			if (itDirectory->is_directory(ErrorCode)) {
				vecExtensionNames.push_back(itDirectory->path().filename().string());
			}
		}

		std::sort(vecExtensionNames.begin(), vecExtensionNames.end());

		return vecExtensionNames;
	}

	void* ExtensionManager::OpenLibrary(std::filesystem::path const& PathBinary) const {
		std::string const strBinaryPath = PathBinary.string();
#if defined(_WIN32)
		HMODULE const hLibraryHandle = LoadLibraryA(strBinaryPath.c_str());
		if (!hLibraryHandle) {
			const DWORD unError = GetLastError();
			LogError("ExtensionManager.OpenLibrary failed Path=\"%s\" Error=0x%08lX.", strBinaryPath.c_str(), static_cast<unsigned long>(unError));
		}

		return static_cast<void*>(hLibraryHandle);
#else
		void* const hLibraryHandle = dlopen(strBinaryPath.c_str(), RTLD_NOW | RTLD_LOCAL);
		if (!hLibraryHandle) {
			char const* const pszError = dlerror();
			LogError("ExtensionManager.OpenLibrary failed Path=\"%s\" Detail=\"%s\".", strBinaryPath.c_str(), pszError ? pszError : "");
		}

		return hLibraryHandle;
#endif
	}

	void* ExtensionManager::ResolveSymbol(void* const hLibraryHandle, char const* const pszSymbolName) const noexcept {
		if (!hLibraryHandle || !pszSymbolName) {
			return nullptr;
		}

#if defined(_WIN32)
		FARPROC const ExportFunction = GetProcAddress(static_cast<HMODULE>(hLibraryHandle), pszSymbolName);
		if (!ExportFunction) {
			const DWORD unError = GetLastError();
			LogError("ExtensionManager.ResolveSymbol failed Symbol=\"%s\" Error=0x%08lX.", pszSymbolName, static_cast<unsigned long>(unError));
		}

		return reinterpret_cast<void*>(ExportFunction);
#else
		dlerror();
		void* const pSymbol = dlsym(hLibraryHandle, pszSymbolName);
		char const* const pszError = dlerror();
		if (pszError) {
			LogError("ExtensionManager.ResolveSymbol failed Symbol=\"%s\" Detail=\"%s\".", pszSymbolName, pszError);
			return nullptr;
		}

		return pSymbol;
#endif
	}

	bool ExtensionManager::CloseLibrary(void* const hLibraryHandle) const noexcept {
		if (!hLibraryHandle) {
			return true;
		}

#if defined(_WIN32)
		if (!FreeLibrary(static_cast<HMODULE>(hLibraryHandle))) {
			const DWORD unError = GetLastError();
			LogError("ExtensionManager.CloseLibrary failed Error=0x%08lX.", static_cast<unsigned long>(unError));
			return false;
		}
#else
		const int nResult = dlclose(hLibraryHandle);
		if (nResult != 0) {
			char const* const pszError = dlerror();
			LogError("ExtensionManager.CloseLibrary failed Result=%d Detail=\"%s\".", nResult, pszError ? pszError : "");
			return false;
		}
#endif

		return true;
	}

	bool ExtensionManager::IsLibraryMapped(std::filesystem::path const& PathBinary) const noexcept {
#if defined(_WIN32)
		return GetModuleHandleW(PathBinary.c_str()) != nullptr;
#else
		void* const hProbe = dlopen(PathBinary.c_str(), RTLD_NOW | RTLD_NOLOAD);
		if (!hProbe) {
			return false;
		}

		CloseLibrary(hProbe);

		return true;
#endif
	}

	void ExtensionManager::LoadState() {
		m_vecDisabledExtensionNames.clear();

		if (!m_pRuntimePaths) {
			return;
		}

		std::string strStateJSON {};
		std::filesystem::path const PathStateFile = m_pRuntimePaths->GetDataPath() / "ExtensionsState.json";
		if (!ReadTextFile(PathStateFile, strStateJSON)) {
			return;
		}

		std::vector<std::string> vecDisabledNames {};
		if (!Detail::ParseDisabledManagerNames(strStateJSON, vecDisabledNames, IsValidExtensionName)) {
			LogWarning("ExtensionManager.LoadState invalid state Path=\"%s\".", PathStateFile.string().c_str());
			return;
		}

		for (auto const& strExtensionName : vecDisabledNames) {
			if (!ContainsExtensionName(m_vecDisabledExtensionNames, strExtensionName)) {
				m_vecDisabledExtensionNames.push_back(strExtensionName);
			}
		}
	}

	void ExtensionManager::SaveState() const {
		if (!m_pRuntimePaths) {
			return;
		}

		std::filesystem::path const PathDataDirectory = m_pRuntimePaths->GetDataPath();
		std::error_code ErrorCode {};
		std::filesystem::create_directories(PathDataDirectory, ErrorCode);
		if (ErrorCode) {
			LogError("ExtensionManager.SaveState failed to create directory Path=\"%s\" Result=%d Detail=\"%s\".", PathDataDirectory.string().c_str(), ErrorCode.value(), ErrorCode.message().c_str());
			return;
		}

		std::filesystem::path const PathStateFile = PathDataDirectory / "ExtensionsState.json";

		std::ofstream OutputFile(PathStateFile, std::ios::binary);
		if (!OutputFile) {
			LogError("ExtensionManager.SaveState failed to open file Path=\"%s\".", PathStateFile.string().c_str());
			return;
		}

		OutputFile
			<< "{\n"
			<< "\t\"Disabled\": [";

		for (std::size_t unDisabledExtensionIndex = 0; unDisabledExtensionIndex < m_vecDisabledExtensionNames.size(); ++unDisabledExtensionIndex) {
			if (unDisabledExtensionIndex > 0) {
				OutputFile << ",";
			}

			OutputFile
				<< "\n"
				<< "\t\t\"" << m_vecDisabledExtensionNames[unDisabledExtensionIndex] << "\"";
		}

		if (!m_vecDisabledExtensionNames.empty()) {
			OutputFile
				<< "\n"
				<< "\t";
		}

		OutputFile
			<< "]\n"
			<< "}\n";

		OutputFile.close();
		if (!OutputFile) {
			LogError("ExtensionManager.SaveState failed to write file Path=\"%s\".", PathStateFile.string().c_str());
		}
	}
} // namespace SourceJS
