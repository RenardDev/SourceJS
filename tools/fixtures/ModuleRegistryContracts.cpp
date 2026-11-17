
// C++
#include <cstddef>
#include <cstdio>

// STL
#include <exception>
#include <string>
#include <vector>

// Project
#include "sourcejs/ModuleRegistry.h"

#if !defined(_M_IX86) && !defined(_M_X64) && !defined(__i386__) && !defined(__x86_64__)
#error Module registry fixture profiles require an x86 or x64 compiler target
#endif

namespace {
	constexpr char const* kPublicPackageNames[] = {
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

	std::size_t g_unFailures = 0;

	void Check(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			++g_unFailures;
			std::fprintf(stderr, "Module registry contract failed: %s\n", pszMessage);
		}
	}

	void RunFixture() {
		constexpr std::size_t kPublicPackageCount = sizeof(kPublicPackageNames) / sizeof(kPublicPackageNames[0]);

		SourceJS::ModuleRegistry Registry {};
		std::vector<std::string> const& vecPublicPackages = Registry.GetPublicPackages();
		std::vector<std::string> const& vecNativeModules = Registry.GetNativeModules();
		Check(vecNativeModules.empty(), "native registry starts empty");
		Check(vecPublicPackages.size() == kPublicPackageCount, "public inventory size");

		for (std::size_t unPackageIndex = 0; unPackageIndex < kPublicPackageCount; ++unPackageIndex) {
			if (unPackageIndex < vecPublicPackages.size()) {
				Check(vecPublicPackages[unPackageIndex] == kPublicPackageNames[unPackageIndex], "public inventory ordering and spelling");
			}

			Check(Registry.HasModule(kPublicPackageNames[unPackageIndex]), "public package visibility");
		}

		Check(!Registry.HasModule(""), "empty name is unavailable");
		Check(!Registry.HasModule("missing/module"), "unknown name is unavailable");
		Registry.RegisterNativeModule("");
		Check(vecNativeModules.empty(), "empty registration is ignored");

		Registry.RegisterNativeModule("socket");
		Registry.RegisterNativeModule("socket");
		Registry.RegisterNativeModule("redis");
		Registry.RegisterNativeModule("extension/example");
		Registry.RegisterNativeModule("auth");
		std::vector<std::string> const vecExpectedNativeModules = { "socket", "redis", "extension/example", "auth" };
		Check(vecNativeModules == vecExpectedNativeModules, "ordered unique native names, including public-name overlap");

		for (auto const& strNativeModule : vecExpectedNativeModules) {
			Check(Registry.HasModule(strNativeModule), "native module visibility");
		}

		Check(!Registry.HasModule("Socket"), "lookup remains case sensitive");
		Check(!Registry.HasModule("missing/module"), "unknown name stays unavailable after registration");

		if (!vecNativeModules.empty()) {
			Registry.RegisterNativeModule(vecNativeModules.front());
			Check(vecNativeModules == vecExpectedNativeModules, "duplicate input may borrow an existing native name");
		}

		Registry.RegisterNativeModule("extension/next");
		Check(vecNativeModules.size() == (vecExpectedNativeModules.size() + 1), "native getter borrows the live vector, not an element");
		Check(vecPublicPackages.size() == kPublicPackageCount, "native registration preserves public inventory");

		SourceJS::ModuleRegistry const OtherRegistry {};
		Check(OtherRegistry.GetNativeModules().empty(), "instances do not share native state");
		Check(OtherRegistry.GetPublicPackages() == vecPublicPackages, "instances share only the public inventory contract");
	}
} // namespace

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fprintf(stderr, "Usage: ModuleRegistryContracts\n");
		return 2;
	}

	try {
		RunFixture();
	} catch (std::exception const& Failure) {
		std::fprintf(stderr, "Module registry fixture failed: %s\n", Failure.what());
		return 2;
	}

	if (g_unFailures != 0) {
		return 1;
	}

	std::puts("Module registry contracts passed; actual project class executed, no V8/engine integration exercised.");

	return 0;
}
