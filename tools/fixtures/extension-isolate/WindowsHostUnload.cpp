
// General
#include <Windows.h>

// C++
#include <cstdio>

// STL
#include <filesystem>

namespace {

	using fnRunIsolateContracts = int(*)(char const*);

	bool LoadRunAndUnload(std::filesystem::path const& PathHost, char const* const pszExtensionPath) {
		HMODULE const hLibrary = LoadLibraryW(PathHost.c_str());
		if (!hLibrary) {
			std::fprintf(stderr, "Could not load the test host. Error=0x%08lX\n", GetLastError());
			return false;
		}

		FARPROC const Entry = GetProcAddress(hLibrary, "SourceJS_RunIsolateContracts");
		fnRunIsolateContracts const Run = reinterpret_cast<fnRunIsolateContracts>(reinterpret_cast<void*>(Entry));
		const bool bRan = Run && (Run(pszExtensionPath) == 0);
		if (!FreeLibrary(hLibrary)) {
			std::fprintf(stderr, "Could not release the test host. Error=0x%08lX\n", GetLastError());
			return false;
		}

		return bRan && !GetModuleHandleW(PathHost.c_str());
	}
} // namespace

int main(const int nArgumentCount, char** const ppszArguments) {
	if (nArgumentCount != 3) {
		std::fprintf(stderr, "Usage: WindowsHostUnload <V8 host DLL> <extension DLL>\n");
		return 2;
	}

	std::filesystem::path const PathHost = std::filesystem::absolute(ppszArguments[1]);
	if (!LoadRunAndUnload(PathHost, ppszArguments[2]) || !LoadRunAndUnload(PathHost, ppszArguments[2])) {
		std::fprintf(stderr, "WindowsHostUnload failed: the V8 host did not cleanly unload and reload.\n");
		return 1;
	}

	std::printf("WindowsHostUnload PASS\n");

	return 0;
}
