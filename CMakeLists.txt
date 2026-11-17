cmake_minimum_required(VERSION 3.24)

set(SOURCEJS_PLATFORM "" CACHE STRING "Target platform: linux or windows.")
set(SOURCEJS_ARCH "x86" CACHE STRING "Target architecture: x86 or x64.")
set(SOURCEJS_SDK_BRANCH "l4d2" CACHE STRING "HL2SDK branch name.")
set(HL2SDK_ROOT "" CACHE PATH "Path to the selected alliedmodders/hl2sdk checkout.")
set(V8_ROOT "" CACHE PATH "Path to the compiled V8 checkout.")
set(V8_CONFIG "x86.release" CACHE STRING "V8 out config directory.")

# Architecture flags must precede project() because it initializes the toolchain flags.
if((UNIX OR (SOURCEJS_PLATFORM STREQUAL "linux")) AND (SOURCEJS_ARCH STREQUAL "x86"))
	string(APPEND CMAKE_CXX_FLAGS_INIT " -m32")
	string(APPEND CMAKE_EXE_LINKER_FLAGS_INIT " -m32")
	string(APPEND CMAKE_SHARED_LINKER_FLAGS_INIT " -m32")
	string(APPEND CMAKE_MODULE_LINKER_FLAGS_INIT " -m32")
endif()

project(SourceJS VERSION 0.3.0 LANGUAGES CXX)

if(NOT HL2SDK_ROOT)
	message(FATAL_ERROR "HL2SDK_ROOT is required.")
endif()

if(NOT V8_ROOT)
	message(FATAL_ERROR "V8_ROOT is required.")
endif()

include(cmake/SourceJSBranches.cmake)
include(cmake/SourceJSPackage.cmake)

SourceJSRequireSupportedTarget("${SOURCEJS_SDK_BRANCH}" "${SOURCEJS_PLATFORM}" "${SOURCEJS_ARCH}")

find_package(SOCI CONFIG REQUIRED)
find_package(redis++ CONFIG REQUIRED)
find_package(cpr CONFIG REQUIRED)
find_package(ZLIB REQUIRED)

if((WIN32 OR (SOURCEJS_PLATFORM STREQUAL "windows")) AND TARGET SQLite3::SQLite3 AND VCPKG_INSTALLED_DIR AND VCPKG_TARGET_TRIPLET)
	set(strSourceJSSQLiteTarget SQLite3::SQLite3)
	get_target_property(strSourceJSSQLiteAliasedTarget SQLite3::SQLite3 ALIASED_TARGET)
	if(strSourceJSSQLiteAliasedTarget)
		set(strSourceJSSQLiteTarget ${strSourceJSSQLiteAliasedTarget})
	endif()

	set(strSourceJSSQLiteReleaseLibrary "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/lib/sqlite3.lib")
	set(strSourceJSSQLiteDebugLibrary "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/debug/lib/sqlite3.lib")
	if(NOT EXISTS "${strSourceJSSQLiteReleaseLibrary}" OR NOT EXISTS "${strSourceJSSQLiteDebugLibrary}")
		message(FATAL_ERROR "The mandatory vcpkg SQLite3 libraries are incomplete for ${VCPKG_TARGET_TRIPLET}.")
	endif()

	set_target_properties(${strSourceJSSQLiteTarget} PROPERTIES
		IMPORTED_LOCATION_DEBUG "${strSourceJSSQLiteDebugLibrary}"
		IMPORTED_LOCATION_RELEASE "${strSourceJSSQLiteReleaseLibrary}"
		IMPORTED_LOCATION_MINSIZEREL "${strSourceJSSQLiteReleaseLibrary}"
		IMPORTED_LOCATION_RELWITHDEBINFO "${strSourceJSSQLiteReleaseLibrary}"
	)
endif()

set(strSourceJSSOCITarget "")
foreach(strSOCITarget IN ITEMS SOCI::Core SOCI::SOCI SOCI::soci_core SOCI::soci_core_static soci_core soci_core_static)
	if(TARGET ${strSOCITarget})
		set(strSourceJSSOCITarget ${strSOCITarget})
		break()
	endif()
endforeach()

if(NOT strSourceJSSOCITarget)
	message(FATAL_ERROR "SOCI was found, but no supported SOCI CMake target is available.")
endif()

set(vecSourceJSSOCIBackendTargets "")
set(strSourceJSSOCIMySQLTarget "")
set(strSourceJSSOCISQLiteTarget "")

foreach(strSOCIBackendTarget IN ITEMS
	SOCI::Empty
	SOCI::soci_empty
	SOCI::soci_empty_static
	SOCI::SQLite3
	SOCI::soci_sqlite3
	SOCI::soci_sqlite3_static
	SOCI::MySQL
	SOCI::soci_mysql
	SOCI::soci_mysql_static
	SOCI::PostgreSQL
	SOCI::soci_postgresql
	SOCI::soci_postgresql_static
	SOCI::ODBC
	SOCI::soci_odbc
	SOCI::soci_odbc_static
)
	if(TARGET ${strSOCIBackendTarget})
		if(strSOCIBackendTarget MATCHES "SQLite3|sqlite3")
			set(strSourceJSSOCISQLiteTarget ${strSOCIBackendTarget})
		elseif(strSOCIBackendTarget MATCHES "MySQL|mysql")
			set(strSourceJSSOCIMySQLTarget ${strSOCIBackendTarget})
		else()
			list(APPEND vecSourceJSSOCIBackendTargets ${strSOCIBackendTarget})
		endif()
	endif()
endforeach()

if(NOT strSourceJSSOCISQLiteTarget)
	message(FATAL_ERROR "SOCI was found without its required SQLite3 backend target. Install SOCI with soci[sqlite3].")
endif()

if(NOT strSourceJSSOCIMySQLTarget)
	message(FATAL_ERROR "SOCI was found without its required MySQL/MariaDB backend target. Install SOCI with soci[mysql].")
endif()

if(TARGET redis++::redis++)
	set(strSourceJSRedisTarget redis++::redis++)
elseif(TARGET redis++::redis++_static)
	set(strSourceJSRedisTarget redis++::redis++_static)
else()
	message(FATAL_ERROR "redis++ was found, but no supported redis++ CMake target is available.")
endif()

if(TARGET cpr::cpr)
	set(strSourceJSCPRTarget cpr::cpr)
else()
	message(FATAL_ERROR "cpr was found, but no supported cpr CMake target is available.")
endif()

SourceJSGetBranchDefinitions(vecSourceJSBranchDefinitions "${SOURCEJS_SDK_BRANCH}")
SourceJSGetBranchFeatureDefinitions(vecSourceJSBranchFeatureDefinitions "${HL2SDK_ROOT}")

set(vecSourceJSSources
	src/sourcejs/Application.cpp
	src/sourcejs/CommandDispatcher.cpp
	src/sourcejs/EngineInterfaces.cpp
	src/sourcejs/ExtensionBindings.cpp
	src/sourcejs/ExtensionManager.cpp
	src/sourcejs/ExtensionRuntime.cpp
	src/sourcejs/GlobalAddressGameData.cpp
	src/sourcejs/HookManager.cpp
	src/sourcejs/ListenerPayload.cpp
	src/sourcejs/Log.cpp
	src/sourcejs/MemoryHookManager.cpp
	src/sourcejs/ModuleRegistry.cpp
	src/sourcejs/modules/ModuleBindings.cpp
	src/sourcejs/PluginManager.cpp
	src/sourcejs/RuntimePaths.cpp
	src/sourcejs/SourceSDKKeyValues.cpp
	src/sourcejs/SourceJSPlugin.cpp
	src/sourcejs/SourceModGameData.cpp
	src/sourcejs/V8Runtime.cpp
	thirdparty/Detours/Detours.cpp
)

if(SOURCEJS_SDK_BRANCH STREQUAL "csgo")
	list(APPEND vecSourceJSSources
		${HL2SDK_ROOT}/public/engine/protobuf/netmessages.pb.cc
		${HL2SDK_ROOT}/public/game/shared/csgo/protobuf/cstrike15_usermessages.pb.cc
		${HL2SDK_ROOT}/public/game/shared/csgo/protobuf/cstrike15_usermessage_helpers.cpp
	)
elseif(SOURCEJS_SDK_BRANCH STREQUAL "blade")
	list(APPEND vecSourceJSSources
		${HL2SDK_ROOT}/public/engine/protobuf/netmessages.pb.cc
		${HL2SDK_ROOT}/public/game/shared/berimbau/protobuf/berimbau_usermessages.pb.cc
		${HL2SDK_ROOT}/public/game/shared/berimbau/protobuf/berimbau_usermessage_helpers.cpp
	)
elseif(SOURCEJS_SDK_BRANCH STREQUAL "mcv")
	list(APPEND vecSourceJSSources
		${HL2SDK_ROOT}/public/engine/protobuf/netmessages.pb.cc
		${HL2SDK_ROOT}/public/engine/protobuf/engine_gcmessages.pb.cc
		${HL2SDK_ROOT}/public/game/shared/vietnam/protobuf/vietnam_gcmessages.pb.cc
		${HL2SDK_ROOT}/public/game/shared/vietnam/protobuf/vietnam_usermessages.pb.cc
		${HL2SDK_ROOT}/public/game/shared/vietnam/protobuf/vietnam_usermessage_helpers.cpp
	)
endif()

add_library(sourcejs MODULE ${vecSourceJSSources})

target_compile_features(sourcejs PRIVATE cxx_std_20)

if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
	target_compile_options(sourcejs PRIVATE
		"SHELL:-include algorithm"
		"SHELL:-include \"${HL2SDK_ROOT}/public/mathlib/mathlib.h\""
		"SHELL:-include \"${HL2SDK_ROOT}/public/tier0/memalloc.h\""
	)
endif()

SourceJSPrepareHL2SDKCXX20Headers(vecSourceJSHL2SDKCXX20IncludeDirectories "${HL2SDK_ROOT}")
if(vecSourceJSHL2SDKCXX20IncludeDirectories)
	target_include_directories(sourcejs BEFORE PRIVATE ${vecSourceJSHL2SDKCXX20IncludeDirectories})

	if(EXISTS "${CMAKE_CURRENT_BINARY_DIR}/sourcejs-hl2sdk-cxx20/sourcejs_sdk_utility_compat.h")
		target_compile_options(sourcejs PRIVATE "SHELL:-include \"${CMAKE_CURRENT_BINARY_DIR}/sourcejs-hl2sdk-cxx20/sourcejs_sdk_utility_compat.h\"")
	endif()

	foreach(strSourceJSHL2SDKOverlayHeader IN ITEMS utlsymbol.h UtlStringMap.h utlmemory.h)
		if(EXISTS "${CMAKE_CURRENT_BINARY_DIR}/sourcejs-hl2sdk-cxx20/tier1/${strSourceJSHL2SDKOverlayHeader}")
			target_compile_options(sourcejs PRIVATE "SHELL:-include \"${CMAKE_CURRENT_BINARY_DIR}/sourcejs-hl2sdk-cxx20/tier1/${strSourceJSHL2SDKOverlayHeader}\"")
		endif()
	endforeach()
endif()

SourceJSPrepareHL2SDKMSVCHeaders(vecSourceJSHL2SDKMSVCIncludeDirectories strSourceJSHL2SDKMSVCPreIncludeHeader "${HL2SDK_ROOT}" "${SOURCEJS_ARCH}")
if(vecSourceJSHL2SDKMSVCIncludeDirectories)
	target_include_directories(sourcejs BEFORE PRIVATE ${vecSourceJSHL2SDKMSVCIncludeDirectories})
endif()

if(strSourceJSHL2SDKMSVCPreIncludeHeader)
	target_compile_options(sourcejs PRIVATE "/FI${strSourceJSHL2SDKMSVCPreIncludeHeader}")
endif()

set(strSourceJSHL2SDKProtobufIncludeDirectory "${HL2SDK_ROOT}/common/protobuf-2.5.0/src")
if(EXISTS "${HL2SDK_ROOT}/common/protobuf-3.2.0/src/Makefile.am")
	set(strSourceJSHL2SDKProtobufIncludeDirectory "${HL2SDK_ROOT}/common/protobuf-3.2.0/src")
endif()

set(strSourceJSSteamAccountHeader "${HL2SDK_ROOT}/public/steam/steamclientpublic.h")
if(EXISTS "${strSourceJSSteamAccountHeader}")
	file(STRINGS "${strSourceJSSteamAccountHeader}" vecSourceJSSteamAccountLimit REGEX "k_EAccountTypeMax")
	if(NOT vecSourceJSSteamAccountLimit)
		target_compile_definitions(sourcejs PRIVATE SOURCEJS_LEGACY_STEAM_ACCOUNT_TYPES)
	endif()
endif()

target_include_directories(sourcejs
	PRIVATE
		${CMAKE_CURRENT_SOURCE_DIR}/src
		${HL2SDK_ROOT}
		${HL2SDK_ROOT}/common
		${strSourceJSHL2SDKProtobufIncludeDirectory}
		${HL2SDK_ROOT}/dlls
		${HL2SDK_ROOT}/game/server
		${HL2SDK_ROOT}/game/shared
		${HL2SDK_ROOT}/game_shared
		${HL2SDK_ROOT}/public
		${HL2SDK_ROOT}/public/engine
		${HL2SDK_ROOT}/public/engine/protobuf
		${HL2SDK_ROOT}/public/game/server
		${HL2SDK_ROOT}/public/mathlib
		${HL2SDK_ROOT}/public/tier0
		${HL2SDK_ROOT}/public/tier1
		${HL2SDK_ROOT}/public/tier2
		${HL2SDK_ROOT}/public/vstdlib
		${HL2SDK_ROOT}/public/vphysics
		${CMAKE_CURRENT_SOURCE_DIR}/thirdparty/Detours
		${V8_ROOT}/include
)

target_compile_definitions(sourcejs
	PRIVATE
		SOURCEJS_VERSION="${PROJECT_VERSION}"
		SOURCEJS_SDK_BRANCH="${SOURCEJS_SDK_BRANCH}"
		SOURCEJS_TARGET_PLATFORM="${SOURCEJS_PLATFORM}"
		SOURCEJS_TARGET_ARCH="${SOURCEJS_ARCH}"
		${vecSourceJSBranchDefinitions}
		${vecSourceJSBranchFeatureDefinitions}
)

if(SOURCEJS_ARCH STREQUAL "x64")
	target_compile_definitions(sourcejs PRIVATE X64BITS PLATFORM_64BITS)
endif()

set_target_properties(sourcejs PROPERTIES
	CXX_STANDARD 20
	CXX_STANDARD_REQUIRED ON
	CXX_EXTENSIONS OFF
	MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
	OUTPUT_NAME sourcejs
	PREFIX ""
)

if(WIN32 OR (SOURCEJS_PLATFORM STREQUAL "windows"))
	target_compile_definitions(sourcejs PRIVATE WIN32 _WIN32 _WINDOWS COMPILER_MSVC WIN32_LEAN_AND_MEAN NOMINMAX)

	# Detours uses native NT types without including their Windows SDK declaration.
	if(MSVC)
		set_property(SOURCE thirdparty/Detours/Detours.cpp APPEND PROPERTY COMPILE_OPTIONS /FIWindows.h /FIwinternl.h)

		# SDK/V8 instantiations and exception boundaries exceed standard COFF section capacity in this translation unit.
		set_property(SOURCE src/sourcejs/modules/ModuleBindings.cpp APPEND PROPERTY COMPILE_OPTIONS /bigobj)
	endif()

	if(SOURCEJS_ARCH STREQUAL "x64")
		target_compile_definitions(sourcejs PRIVATE COMPILER_MSVC64 WIN64)
	else()
		target_compile_definitions(sourcejs PRIVATE COMPILER_MSVC32)
	endif()

	target_compile_options(sourcejs PRIVATE /W4 /permissive- /EHsc /MP /Zc:__cplusplus /Zc:rewrittenExpressions- /Zc:strictStrings-)

	target_link_libraries(sourcejs
		PRIVATE
			advapi32
			dbghelp
			legacy_stdio_definitions
			winmm
			ws2_32
	)
else()
	target_compile_definitions(sourcejs
		PRIVATE
			LINUX
			_LINUX
			POSIX
			GNUC
			COMPILER_GCC
			stricmp=strcasecmp
			strnicmp=strncasecmp
			strcmpi=strcasecmp
			_stricmp=strcasecmp
			_strnicmp=strncasecmp
			_snprintf=snprintf
			_vsnprintf=vsnprintf
	)

	target_compile_options(sourcejs PRIVATE -Wall -Wextra -fPIC "SHELL:-include strings.h" "SHELL:-include stdio.h")

	target_link_libraries(sourcejs
		PRIVATE
			dl
			pthread
	)

	set(SOURCEJS_LINUX_LINKER "lld" CACHE STRING "Linux linker: lld for LLVM CREL/bitcode, or bfd for standard ELF archives.")
	set_property(CACHE SOURCEJS_LINUX_LINKER PROPERTY STRINGS lld bfd)
	if(NOT (SOURCEJS_LINUX_LINKER STREQUAL "lld") AND NOT (SOURCEJS_LINUX_LINKER STREQUAL "bfd"))
		message(FATAL_ERROR "SOURCEJS_LINUX_LINKER must be lld or bfd.")
	endif()

	# Fail at link time rather than publish a plugin that requires writable read-only segments.
	target_link_options(sourcejs PRIVATE "-fuse-ld=${SOURCEJS_LINUX_LINKER}" "LINKER:-z,text")
	target_link_options(sourcejs PRIVATE "LINKER:-soname,sourcejs.so")

	if(SOURCEJS_ARCH STREQUAL "x86")
		target_compile_options(sourcejs PRIVATE -m32 -msse -msse2 -mfpmath=sse -ftls-model=global-dynamic)
		target_link_options(sourcejs PRIVATE
			-m32
			-static-libstdc++
			-static-libgcc
			"SHELL:-Wl,-Bsymbolic"
			"SHELL:-Wl,--version-script=\"${CMAKE_CURRENT_SOURCE_DIR}/cmake/sourcejs-linux.exports.map\""
		)

		execute_process(
			COMMAND "${CMAKE_CXX_COMPILER}" -m32 -print-file-name=libatomic.a
			OUTPUT_VARIABLE strSourceJSLibAtomic
			OUTPUT_STRIP_TRAILING_WHITESPACE
			COMMAND_ERROR_IS_FATAL ANY
		)
		if(NOT IS_ABSOLUTE "${strSourceJSLibAtomic}" OR NOT EXISTS "${strSourceJSLibAtomic}")
			message(FATAL_ERROR "Linux x86 requires a static 32-bit libatomic.a.")
		endif()
	elseif(SOURCEJS_ARCH STREQUAL "x64")
		target_compile_options(sourcejs PRIVATE "SHELL:-include stdint.h")

		execute_process(
			COMMAND "${CMAKE_CXX_COMPILER}" -m64 -print-file-name=libatomic.a
			OUTPUT_VARIABLE strSourceJSLibAtomic
			OUTPUT_STRIP_TRAILING_WHITESPACE
			COMMAND_ERROR_IS_FATAL ANY
		)
		if(NOT IS_ABSOLUTE "${strSourceJSLibAtomic}" OR NOT EXISTS "${strSourceJSLibAtomic}")
			message(FATAL_ERROR "Linux x64 requires a static 64-bit libatomic.a.")
		endif()
	endif()
endif()

SourceJSLinkHL2SDK(sourcejs "${HL2SDK_ROOT}" "${SOURCEJS_PLATFORM}" "${SOURCEJS_ARCH}")

if((SOURCEJS_SDK_BRANCH STREQUAL "csgo") OR (SOURCEJS_SDK_BRANCH STREQUAL "blade") OR (SOURCEJS_SDK_BRANCH STREQUAL "mcv"))
	SourceJSLinkHL2SDKProtobuf(sourcejs "${HL2SDK_ROOT}" "${SOURCEJS_PLATFORM}" "${SOURCEJS_ARCH}")
endif()

SourceJSLinkV8(sourcejs "${V8_ROOT}" "${V8_CONFIG}" "${SOURCEJS_PLATFORM}")

target_link_libraries(sourcejs
	PRIVATE
		${strSourceJSSOCITarget}
		$<LINK_LIBRARY:WHOLE_ARCHIVE,${strSourceJSSOCISQLiteTarget}>
		$<LINK_LIBRARY:WHOLE_ARCHIVE,${strSourceJSSOCIMySQLTarget}>
		${vecSourceJSSOCIBackendTargets}
		${strSourceJSRedisTarget}
		${strSourceJSCPRTarget}
		ZLIB::ZLIB
)

if(strSourceJSLibAtomic)
	target_link_libraries(sourcejs PRIVATE "${strSourceJSLibAtomic}")
endif()

SourceJSInstallPackage(sourcejs)
