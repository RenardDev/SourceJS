
// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

// STL
#include <filesystem>
#include <fstream>
#include <new>
#include <stdexcept>
#include <string>

// Project
#include "sourcejs/Log.h"
#include "sourcejs/ManagerManifest.h"
#include "sourcejs/PluginManager.h"
#include "sourcejs/RuntimePaths.h"
#include "sourcejs/V8Runtime.h"

namespace {
	bool g_bFailNextAllocation = false;
	bool g_bFailPluginPublication = false;
	std::size_t g_unWarningCount = 0;
	std::size_t g_unErrorCount = 0;

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	void WriteFile(std::filesystem::path const& PathFile, std::string const& strContents) {
		std::filesystem::create_directories(PathFile.parent_path());

		std::ofstream OutputFile { PathFile, std::ios::binary };
		Require(OutputFile.is_open(), "fixture file open");

		OutputFile << strContents;
		OutputFile.close();

		Require(!OutputFile.fail(), "fixture file write");
	}

	void CreatePlugin(std::filesystem::path const& PathPlugins, std::string const& strName, std::string const& strManifest, std::string const& strEntry = "index.js") {
		WriteFile(PathPlugins / strName / "plugin.json", strManifest);
		WriteFile(PathPlugins / strName / strEntry, "module.exports = {};\n");
	}

	bool HasPlugin(SourceJS::PluginManager const& Manager, std::string const& strName) {
		for (auto const& Plugin : Manager.GetPlugins()) {
			if (Plugin.m_strName == strName) {
				return true;
			}
		}

		return false;
	}
} // namespace

// Replaceable allocation is fault-injected only for the first allocation after
// the runtime double reports successful execution; all other calls retain the
// ordinary allocation/new-handler contract. This fixture is single-threaded.
void* operator new(const std::size_t unSize) {
	if (g_bFailNextAllocation) {
		g_bFailNextAllocation = false;
		throw std::bad_alloc {};
	}

	const std::size_t unAllocationSize = unSize ? unSize : 1;
	for (;;) {
		void* const pAddress = std::malloc(unAllocationSize);
		if (pAddress) {
			return pAddress;
		}

		std::new_handler const NewHandler = std::get_new_handler();
		if (!NewHandler) {
			throw std::bad_alloc {};
		}

		NewHandler();
	}
}

void operator delete(void* const pAddress) noexcept {
	std::free(pAddress);
}

void operator delete(void* const pAddress, std::size_t) noexcept {
	std::free(pAddress);
}

namespace SourceJS {
	RuntimePaths::RuntimePaths(std::filesystem::path const& PathPlugins, std::filesystem::path const& PathData) :
		m_PathPlugins(PathPlugins),
		m_PathData(PathData)
	{
	}

	std::filesystem::path const& RuntimePaths::GetPluginRootPath() const {
		return m_PathPlugins;
	}

	std::filesystem::path const& RuntimePaths::GetDataPath() const {
		return m_PathData;
	}

	V8Runtime::V8Runtime() {
		m_unExecutionCount = 0;
		m_unUnloadCount = 0;
	}

	bool V8Runtime::ExecutePluginFile(std::filesystem::path const& PathScript, std::string const&) {
		m_PathLastScript = PathScript;
		++m_unExecutionCount;

		if (g_bFailPluginPublication) {
			g_bFailPluginPublication = false;
			g_bFailNextAllocation = true;
		}

		return true;
	}

	void V8Runtime::UnloadPlugin(std::string const& strPluginName) {
		++m_unUnloadCount;
		if (m_UnloadCallback) {
			m_UnloadCallback(strPluginName);
		}
	}

	void V8Runtime::EmitEvent(std::string const& strEventName, std::string const&) {
		if (m_EventCallback) {
			m_EventCallback(strEventName);
		}
	}

	void LogInfo(char const* const, ...) noexcept {
	}

	void LogWarning(char const* const, ...) noexcept {
		++g_unWarningCount;
	}

	void LogError(char const* const, ...) noexcept {
		++g_unErrorCount;
	}
} // namespace SourceJS

namespace {
	void CheckLoadPublicationFailure(std::filesystem::path const& PathRoot, const bool bRollbackThrows) {
		constexpr char const* const kPluginName = "Publication";

		std::filesystem::path const PathPlugins = PathRoot / "plugins";
		CreatePlugin(PathPlugins, kPluginName, "{\"Autoload\": false}");
		SourceJS::RuntimePaths const Paths = SourceJS::RuntimePaths(PathPlugins, PathRoot / "data");
		SourceJS::PluginManager Manager {};
		SourceJS::V8Runtime Runtime {};
		Manager.Initialize(&Paths, &Runtime);

		if (bRollbackThrows) {
			Runtime.m_UnloadCallback = [](std::string const&) {
				throw std::runtime_error("Expected load rollback failure");
			};
		}

		const std::size_t unErrorsBefore = g_unErrorCount;
		bool bCaughtAllocationFailure = false;
		g_bFailPluginPublication = true;
		try {
			Manager.Load(kPluginName);
		} catch (std::bad_alloc const&) {
			bCaughtAllocationFailure = true;
		}

		g_bFailPluginPublication = false;
		g_bFailNextAllocation = false;
		Require(bCaughtAllocationFailure, "record publication preserves its original allocation exception");
		Require((Runtime.m_unExecutionCount == 1) && (Runtime.m_unUnloadCount == 1), "failed record publication rolls back the successfully executed runtime exactly once");
		Require(!HasPlugin(Manager, kPluginName), "failed publication leaves no manager record");
		const std::size_t unExpectedErrors = unErrorsBefore + (bRollbackThrows ? 1 : 0);
		Require(g_unErrorCount == unExpectedErrors, "rollback failure is diagnosed without replacing the original exception");
		Runtime.m_UnloadCallback = nullptr;

		if (!bRollbackThrows) {
			Require(Manager.Load(kPluginName), "completed publication rollback leaves the manager retryable");
			Require(HasPlugin(Manager, kPluginName) && (Runtime.m_unExecutionCount == 2), "publication retry installs the manager record");
		}

		Manager.Shutdown();
	}

	void CheckUnloadReentry(std::filesystem::path const& PathRoot) {
		constexpr std::size_t kCaseCount = 2;
		constexpr char const* const kPluginName = "Reentrant";

		for (std::size_t unCaseIndex = 0; unCaseIndex < kCaseCount; ++unCaseIndex) {
			std::filesystem::path const PathCase = PathRoot / std::to_string(unCaseIndex);
			std::filesystem::path const PathPlugins = PathCase / "plugins";
			CreatePlugin(PathPlugins, kPluginName, "{\"Autoload\": false}");
			SourceJS::RuntimePaths const Paths = SourceJS::RuntimePaths(PathPlugins, PathCase / "data");
			std::size_t unReentryCount = 0;
			SourceJS::PluginManager Manager {};
			SourceJS::V8Runtime Runtime {};
			Manager.Initialize(&Paths, &Runtime);
			Require(Manager.Load(kPluginName), "reentry fixture plugin load");

			auto Reenter = [&Manager, &unReentryCount, kPluginName]() {
				++unReentryCount;
				Require(unReentryCount == 1, "Recursive manager unload dispatched twice");
				Require(!Manager.Unload(kPluginName), "An in-progress manager unload must not run again");
			};

			if (unCaseIndex == 0) {
				Runtime.m_EventCallback = [Reenter](std::string const& strEventName) {
					if (strEventName == "PluginUnloading") {
						Reenter();
					}
				};

			} else {
				Runtime.m_UnloadCallback = [Reenter](std::string const&) {
					Reenter();
				};
			}

			Require(Manager.Unload(kPluginName), "outer manager unload succeeds");
			Require(!HasPlugin(Manager, kPluginName) && (Runtime.m_unUnloadCount == 1) && (unReentryCount == 1), "manager unload owns callback and removal once");
			Runtime.m_EventCallback = nullptr;
			Runtime.m_UnloadCallback = nullptr;
			Manager.Shutdown();
		}
	}

	void CheckUnloadRetry(std::filesystem::path const& PathRoot) {
		constexpr std::size_t kCaseCount = 2;
		constexpr char const* const kPluginName = "Retry";

		for (std::size_t unCaseIndex = 0; unCaseIndex < kCaseCount; ++unCaseIndex) {
			std::filesystem::path const PathCase = PathRoot / std::to_string(unCaseIndex);
			std::filesystem::path const PathPlugins = PathCase / "plugins";
			CreatePlugin(PathPlugins, kPluginName, "{\"Autoload\": false}");
			SourceJS::RuntimePaths const Paths = SourceJS::RuntimePaths(PathPlugins, PathCase / "data");
			bool bThrow = true;
			SourceJS::PluginManager Manager {};
			SourceJS::V8Runtime Runtime {};
			Manager.Initialize(&Paths, &Runtime);
			Require(Manager.Load(kPluginName), "retry fixture plugin load");

			if (unCaseIndex == 0) {
				Runtime.m_EventCallback = [&bThrow](std::string const& strName) {
					if ((strName == "PluginUnloading") && bThrow) {
						bThrow = false;
						throw std::runtime_error("Expected manager event failure");
					}
				};

			} else {
				Runtime.m_UnloadCallback = [&bThrow](std::string const&) {
					if (bThrow) {
						bThrow = false;
						throw std::runtime_error("Expected manager unload failure");
					}
				};
			}

			bool bCaught = false;
			try {
				Manager.Unload(kPluginName);
			} catch (std::runtime_error const&) {
				bCaught = true;
			}

			const std::size_t unExpectedUnloadCount = (unCaseIndex == 0) ? 1 : 2;
			Require(bCaught && HasPlugin(Manager, kPluginName), "native failure keeps the plugin record retryable");
			Require(Manager.Unload(kPluginName) && !HasPlugin(Manager, kPluginName) && (Runtime.m_unUnloadCount == unExpectedUnloadCount), "manager retry must not retain the in-progress guard");
			Runtime.m_EventCallback = nullptr;
			Runtime.m_UnloadCallback = nullptr;
			Manager.Shutdown();
		}
	}

	void CheckUnloadShutdown(std::filesystem::path const& PathRoot) {
		constexpr char const* const kPluginName = "Shutdown";

		std::filesystem::path const PathPlugins = PathRoot / "plugins";
		CreatePlugin(PathPlugins, kPluginName, "{\"Autoload\": false}");
		SourceJS::RuntimePaths const Paths = SourceJS::RuntimePaths(PathPlugins, PathRoot / "data");
		bool bRequestedShutdown = false;
		SourceJS::PluginManager Manager {};
		SourceJS::V8Runtime Runtime {};
		Manager.Initialize(&Paths, &Runtime);
		Require(Manager.Load(kPluginName), "shutdown fixture plugin load");

		Runtime.m_EventCallback = [&Manager, &bRequestedShutdown](std::string const& strName) {
			if ((strName == "PluginUnloading") && !bRequestedShutdown) {
				bRequestedShutdown = true;
				Manager.Shutdown();
			}
		};

		Require(Manager.Unload(kPluginName) && bRequestedShutdown && Manager.GetPlugins().empty() && (Runtime.m_unUnloadCount == 1), "manager shutdown during an event must retain the active runtime borrow until cleanup");
		Runtime.m_EventCallback = nullptr;
		Manager.Shutdown();
	}

	void CheckUnloadOtherPlugin(std::filesystem::path const& PathRoot) {
		std::filesystem::path const PathPlugins = PathRoot / "plugins";
		CreatePlugin(PathPlugins, "Inner", "{\"Autoload\": false}");
		CreatePlugin(PathPlugins, "Outer", "{\"Autoload\": false}");
		SourceJS::RuntimePaths const Paths = SourceJS::RuntimePaths(PathPlugins, PathRoot / "data");
		SourceJS::PluginManager Manager {};
		SourceJS::V8Runtime Runtime {};
		Manager.Initialize(&Paths, &Runtime);
		Require(Manager.Load("Inner") && Manager.Load("Outer"), "nested fixture plugins load");

		Runtime.m_UnloadCallback = [&Manager](std::string const& strName) {
			if (strName == "Outer") {
				Require(Manager.Unload("Inner"), "another plugin can unload during the callback");
			}
		};

		Require(Manager.Unload("Outer") && Manager.GetPlugins().empty() && (Runtime.m_unUnloadCount == 2), "another unload may move the original vector record without invalid access");
		Runtime.m_UnloadCallback = nullptr;
		Manager.Shutdown();
	}

	void CheckManifestStringCodec() {
		struct ManifestStringCase {
			char const* m_pszEncodedText;
			char const* m_pszExpectedText;
		};

		constexpr ManifestStringCase kCases[] = {
			{ "\"\"", "" },
			{ "\"plain\"suffix", "plain" },
			{ "\"a\\\"b\\\\c\\/d\\b\\f\\n\\r\\t\"", "a\"b\\c/d\b\f\n\r\t" },
			{ "\"\\u0069ndex.js\"", "index.js" },
			{ "\"\\u00e9\"", "\xC3\xA9" },
			{ "\"\\u20AC\"", "\xE2\x82\xAC" },
			{ "\"\\uD83d\\uDE00\"", "\xF0\x9F\x98\x80" },
			{ "\"\\uDBFF\\uDFFF\"", "\xF4\x8F\xBF\xBF" },
			{ "\"\xC3\xA9\"", "\xC3\xA9" },
		};
		constexpr char const* kInvalidStrings[] = { "", "plain", "\"unfinished", "\"\\", "\"\\x\"", "\"\\u12", "\"\\uZZZZ\"", "\"\\uD800\"", "\"\\uDC00\"", "\"\\uD800\\uE000\"", "\"\n\"" };
		constexpr char kUnchangedText[] = "Sentinel";
		constexpr std::uint32_t kOriginalHexWord = 0x1234;

		std::string strDecoded {};
		for (auto const& CodecCase : kCases) {
			strDecoded = kUnchangedText;
			Require(SourceJS::Detail::DecodeManifestString(CodecCase.m_pszEncodedText, 0, strDecoded), "shared manifest codec accepts a complete selected string");
			Require(strDecoded == CodecCase.m_pszExpectedText, "shared manifest codec produces exact UTF8/control bytes");
		}

		for (auto const& pszInvalidString : kInvalidStrings) {
			strDecoded = kUnchangedText;
			Require(!SourceJS::Detail::DecodeManifestString(pszInvalidString, 0, strDecoded) && (strDecoded == kUnchangedText), "invalid selected string leaves output unchanged");
		}

		Require(!SourceJS::Detail::DecodeManifestString("\"ok\"", std::string::npos, strDecoded) && (strDecoded == kUnchangedText), "invalid opening offset leaves output unchanged");
		Require(SourceJS::Detail::DecodeManifestString("\"\\u0000\"", 0, strDecoded), "codec preserves NUL for caller-specific validation");
		Require((strDecoded.size() == 1) && (strDecoded.front() == '\0'), "decoded NUL is an exact string byte");

		std::string strAliased = "\"\\u0061\"";
		Require(SourceJS::Detail::DecodeManifestString(strAliased, 0, strAliased) && (strAliased == "a"), "string input and successful output may alias");

		std::uint32_t unWord = kOriginalHexWord;
		Require(!SourceJS::Detail::ReadManifestHexWord("12", 0, unWord) && (unWord == kOriginalHexWord), "short hex word leaves output unchanged");
		Require(!SourceJS::Detail::ReadManifestHexWord("0000", std::string::npos, unWord) && (unWord == kOriginalHexWord), "hex offset range check precedes subtraction");
		Require(SourceJS::Detail::ReadManifestHexWord("aBcD", 0, unWord) && (unWord == 0xABCD), "hex words accept both letter cases");
	}

	void CheckManifest(std::filesystem::path const& PathRoot) {
		std::filesystem::path const PathPlugins = PathRoot / "Manifest" / "Plugins";
		CreatePlugin(PathPlugins, "automatic", "{\"Entry\":\"dist/main.js\",\"Autoload\":true}", "dist/main.js");
		CreatePlugin(PathPlugins, "manual", "{\"Entry\":\"main.js\",\"Autoload\":false}", "main.js");

		SourceJS::RuntimePaths const Paths { PathPlugins, PathRoot / "Manifest" / "Data" };
		SourceJS::V8Runtime Runtime {};
		SourceJS::PluginManager Manager {};
		Manager.Initialize(&Paths, &Runtime);
		Require(Manager.GetPlugins().size() == 1, "PascalCase Autoload controls startup");
		Require(Runtime.m_PathLastScript == (PathPlugins / "automatic" / "dist/main.js"), "PascalCase nested Entry controls execution");
		Require(Manager.Load("manual"), "explicit load bypasses Autoload false");
		Require(Runtime.m_PathLastScript == (PathPlugins / "manual" / "main.js"), "explicit load uses PascalCase Entry");
		Require(Manager.List().front() == ("1. automatic [loaded, enabled] " + (PathPlugins / "automatic" / "dist/main.js").string()), "listing bytes remain stable");
		Require(!Manager.Unload("0"), "zero selector rejected");
		Require(!Manager.Unload("184467440737095516160"), "overflow selector rejected");
		Require(Manager.Unload("1"), "one-based selector removes first record");
		Require(Manager.GetPlugins().size() == 1, "only selected record removed");
		Require(Manager.GetPlugins().front().m_strName == "manual", "remaining record preserved");
		Require((Runtime.m_unExecutionCount == 2) && (Runtime.m_unUnloadCount == 1), "runtime calls match selected lifecycle operations");
		Manager.Shutdown();
	}

	void CheckManifestEscapes(std::filesystem::path const& PathRoot) {
		constexpr char const* kFallbackPluginNames[] = { "invalidhex", "unpaired", "truncated", "dangling" };

		std::filesystem::path const PathPlugins = PathRoot / "ManifestEscapes" / "Plugins";
		CreatePlugin(PathPlugins, "unicode", "{\"Entry\":\"\\u0069ndex.js\",\"Autoload\":false}");
		CreatePlugin(PathPlugins, "slash", "{\"Entry\":\"dist\\/main.js\",\"Autoload\":false}", "dist/main.js");
		CreatePlugin(PathPlugins, "nullentry", "{\"Entry\":\"index.js\\u0000ignored.js\",\"Autoload\":false}");
		CreatePlugin(PathPlugins, "invalidhex", "{\"Entry\":\"\\uZZZZ.js\",\"Autoload\":false}");
		CreatePlugin(PathPlugins, "unpaired", "{\"Entry\":\"\\uD800.js\",\"Autoload\":false}");
		CreatePlugin(PathPlugins, "truncated", "{\"Autoload\":false,\"Entry\":\"\\u12");
		CreatePlugin(PathPlugins, "dangling", "{\"Autoload\":false,\"Entry\":\"\\");
#if defined(__linux__)
		CreatePlugin(PathPlugins, "twobyte", "{\"Entry\":\"\\u00E9.js\",\"Autoload\":false}", "\xC3\xA9.js");
		CreatePlugin(PathPlugins, "threebyte", "{\"Entry\":\"\\u20AC.js\",\"Autoload\":false}", "\xE2\x82\xAC.js");
		CreatePlugin(PathPlugins, "fourbyte", "{\"Entry\":\"\\uD83D\\uDE00.js\",\"Autoload\":false}", "\xF0\x9F\x98\x80.js");
#endif

		SourceJS::RuntimePaths const Paths { PathPlugins, PathRoot / "ManifestEscapes" / "Data" };
		SourceJS::V8Runtime Runtime {};
		SourceJS::PluginManager Manager {};
		Manager.Initialize(&Paths, &Runtime);
		Require(Manager.Load("unicode"), "JSON Unicode escapes in Entry decode before native path validation");
		Require(Runtime.m_PathLastScript == (PathPlugins / "unicode" / "index.js"), "escaped Entry selects the decoded script path");
		Require(Manager.Load("slash"), "JSON escaped slashes select nested scripts");
		Require(Runtime.m_PathLastScript == (PathPlugins / "slash" / "dist/main.js"), "escaped slash preserves the native entry path");
		Require(!Manager.Load("nullentry"), "decoded NUL cannot truncate a native entry path");

		for (auto const& pszFallbackPluginName : kFallbackPluginNames) {
			Require(Manager.Load(pszFallbackPluginName), "invalid selected strings retain the native reader fallback");
			Require(Runtime.m_PathLastScript == (PathPlugins / pszFallbackPluginName / "index.js"), "invalid selected strings use index.js without partial decoding");
		}

#if defined(__linux__)
		Require(Manager.Load("twobyte"), "two-byte UTF8 entry from a JSON escape");
		Require(Runtime.m_PathLastScript.filename().string() == "\xC3\xA9.js", "two-byte UTF8 entry bytes");
		Require(Manager.Load("threebyte"), "three-byte UTF8 entry from a JSON escape");
		Require(Runtime.m_PathLastScript.filename().string() == "\xE2\x82\xAC.js", "three-byte UTF8 entry bytes");
		Require(Manager.Load("fourbyte"), "four-byte UTF8 entry from a surrogate pair");
		Require(Runtime.m_PathLastScript.filename().string() == "\xF0\x9F\x98\x80.js", "surrogate-pair UTF8 entry bytes");
#endif
		Manager.Shutdown();
	}

	void CheckState(std::filesystem::path const& PathRoot, std::string const& strDisabledName) {
		std::filesystem::path const PathPlugins = PathRoot / "State" / "Plugins";
		std::filesystem::path const PathData = PathRoot / "State" / "Data";
		CreatePlugin(PathPlugins, strDisabledName, "{}");
		CreatePlugin(PathPlugins, "other", "{}");
		WriteFile(PathData / "PluginsState.json", "{\"Disabled\":[\"" + strDisabledName + "\"]}");

		SourceJS::RuntimePaths const Paths { PathPlugins, PathData };
		SourceJS::V8Runtime Runtime {};
		SourceJS::PluginManager Manager {};
		Manager.Initialize(&Paths, &Runtime);
		Require(Manager.GetPlugins().size() == 1, "reserved-looking value remains disabled");
		Require(HasPlugin(Manager, "other"), "array key does not disable unrelated plugin");
		Manager.Shutdown();
		Manager.Initialize(&Paths, &Runtime);
		Require(!HasPlugin(Manager, strDisabledName), "disabled name persists after state round trip");
		Require(Manager.Enable(strDisabledName), "enable reserved-looking directory name");
		Manager.Shutdown();
		Manager.Initialize(&Paths, &Runtime);
		Require(HasPlugin(Manager, strDisabledName), "enabled name persists");
		Manager.Shutdown();

		// Negative schemas: no legacy conversion, partial commits, or arbitrary quoted values.
		char const* const arrInvalidStates[] = {
			"{\"disabled\":[\"other\"]}",
			"{\"Disabled\":[\"other\",]}",
			"{\"Disabled\":[\"other\",12]}",
			"{\"Disabled\":[\"other\"],\"Other\":\"disabled\"}",
			"{\"Disabled\":[\"../other\"]}",
			"{\"Disabled\":[\"oth\\u0065r\"]}",
			"{\"Disabled\":[\"other\"]} trailing",
			"{\"Disabled\":[\"other\"]",
			"{\"Disabled\":[",
		};
		for (auto const& pszState : arrInvalidStates) {
			WriteFile(PathData / "PluginsState.json", pszState);
			const std::size_t unWarningsBefore = g_unWarningCount;
			Manager.Initialize(&Paths, &Runtime);
			Require(g_unWarningCount == (unWarningsBefore + 1), "invalid state produces one warning");
			Require(Manager.GetPlugins().size() == 2, "invalid state commits no disabled names");
			Manager.Shutdown();
		}

		WriteFile(PathData / "PluginsState.json", " \r\n{\t\"Disabled\" : [ ] } \n");
		Manager.Initialize(&Paths, &Runtime);
		Require(Manager.GetPlugins().size() == 2, "empty array and JSON whitespace accepted");
		Manager.Shutdown();
	}

	void CheckFilesystemFailures(std::filesystem::path const& PathRoot) {
		constexpr char const* const kLifecyclePluginName = "persistent";

		std::filesystem::path const PathBlocked = PathRoot / "Failures" / "Blocked";
		WriteFile(PathBlocked, "not a directory");

		SourceJS::RuntimePaths const BlockedPaths { PathBlocked, PathBlocked };
		SourceJS::V8Runtime Runtime {};
		SourceJS::PluginManager Manager {};
		const std::size_t unWarningsBefore = g_unWarningCount;
		Manager.Initialize(&BlockedPaths, &Runtime);
		Require(g_unWarningCount == (unWarningsBefore + 1), "discovery directory failure is diagnosed");
		Manager.Shutdown();
		Require(g_unWarningCount == (unWarningsBefore + 2), "state directory failure is diagnosed");

		std::filesystem::path const PathData = PathRoot / "Failures" / "Data";
		std::filesystem::create_directories(PathData / "PluginsState.json");

		SourceJS::RuntimePaths const OpenFailurePaths { PathRoot / "Failures" / "Plugins", PathData };
		Manager.Initialize(&OpenFailurePaths, &Runtime);
		const std::size_t unWarningsBeforeSave = g_unWarningCount;
		Manager.Shutdown();
		Require(g_unWarningCount == (unWarningsBeforeSave + 1), "state open failure is diagnosed");

		std::filesystem::path const PathLifecyclePlugins = PathRoot / "Failures" / "LifecyclePlugins";
		std::filesystem::path const PathLifecycleData = PathRoot / "Failures" / "LifecycleData";
		CreatePlugin(PathLifecyclePlugins, kLifecyclePluginName, "{}");
		std::filesystem::create_directories(PathLifecycleData / "PluginsState.json");

		SourceJS::RuntimePaths const LifecycleFailurePaths { PathLifecyclePlugins, PathLifecycleData };
		Manager.Initialize(&LifecycleFailurePaths, &Runtime);
		Require(Manager.Load(kLifecyclePluginName), "lifecycle persistence fixture loads the target");

		const std::size_t unWarningsBeforeLifecycleDisable = g_unWarningCount;
		Require(Manager.Disable(kLifecyclePluginName), "disable can succeed despite a state-save failure");
		Require(g_unWarningCount == (unWarningsBeforeLifecycleDisable + 1), "disable state-save failure produces one warning");
		Require(!HasPlugin(Manager, kLifecyclePluginName), "disable removes the record despite a state-save failure");
		Require(!Manager.Load(kLifecyclePluginName), "failed state persistence does not clear disabled in-memory state");

		const std::size_t unWarningsBeforeLifecycleEnable = g_unWarningCount;
		Require(Manager.Enable(kLifecyclePluginName), "enable can succeed despite a state-save failure");
		Require(g_unWarningCount == (unWarningsBeforeLifecycleEnable + 1), "enable state-save failure produces one warning");
		Require(HasPlugin(Manager, kLifecyclePluginName), "enable restores the record despite a state-save failure");

		Manager.Shutdown();
#if defined(__linux__)
		// /dev/full fails real writes/flushes; install the owned symlink only after LoadState.
		Require(std::filesystem::is_character_file("/dev/full"), "Linux fixture requires /dev/full");
		std::filesystem::path const PathWriteData = PathRoot / "Failures" / "WriteData";
		SourceJS::RuntimePaths const WriteFailurePaths { PathRoot / "Failures" / "Plugins", PathWriteData };
		Manager.Initialize(&WriteFailurePaths, &Runtime);
		std::filesystem::create_directories(PathWriteData);
		std::filesystem::create_symlink("/dev/full", PathWriteData / "PluginsState.json");
		const std::size_t unWarningsBeforeWrite = g_unWarningCount;
		Manager.Shutdown();
		Require(g_unWarningCount == (unWarningsBeforeWrite + 1), "state write/close failure is diagnosed");
#endif
	}
} // namespace

int main(const int nArgumentCount, char const* const* const ppszArguments) {
	constexpr int kRequiredArgumentCount = 2;
	constexpr int kInvalidArgumentExitCode = 2;

	if (nArgumentCount != kRequiredArgumentCount) {
		std::fputs("Usage: Contracts <fixture-directory>\n", stderr);
		return kInvalidArgumentExitCode;
	}

	try {
		std::filesystem::path const PathRoot = ppszArguments[1];
		CheckLoadPublicationFailure(PathRoot / "LoadPublication", false);
		CheckLoadPublicationFailure(PathRoot / "LoadPublicationRollback", true);
		CheckManifestStringCodec();
		CheckManifest(PathRoot);
		CheckManifestEscapes(PathRoot);
		CheckState(PathRoot / "Upper", "Disabled");
		CheckState(PathRoot / "Lower", "disabled-state");
		CheckUnloadReentry(PathRoot / "Reentry");
		CheckUnloadRetry(PathRoot / "Retry");
		CheckUnloadShutdown(PathRoot / "UnloadShutdown");
		CheckUnloadOtherPlugin(PathRoot / "UnloadOther");
		CheckFilesystemFailures(PathRoot);

		std::puts("Plugin manager contracts passed (runtime/path/log doubles; no V8/server).");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "Plugin manager contract failed: %s\n", Exception.what());
		return 1;
	}
}
