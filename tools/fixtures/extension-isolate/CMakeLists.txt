cmake_minimum_required(VERSION 3.24)
project(SourceJSExtensionIsolateContracts LANGUAGES CXX)

get_filename_component(strSourceJSRoot "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)
set(V8_ROOT "" CACHE PATH "V8 checkout used to build SourceJS.")
set(V8_CONFIG "x86.release" CACHE STRING "V8 build configuration.")
option(SOURCEJS_TEST_V8_IMPORTS "Test an extension using out-of-line V8 APIs exported by its host." OFF)

include("${strSourceJSRoot}/cmake/SourceJSPackage.cmake")
enable_testing()
add_subdirectory("${strSourceJSRoot}/examples/extensions/echo" echo)
target_compile_definitions(echo PRIVATE SOURCEJS_ECHO_VERIFY_ISOLATE)

set(vecContractSources
	ExtensionIsolateContracts.cpp
	"${strSourceJSRoot}/src/sourcejs/ExtensionBindings.cpp"
	"${strSourceJSRoot}/src/sourcejs/ExtensionManager.cpp"
	"${strSourceJSRoot}/src/sourcejs/ExtensionRuntime.cpp"
	"${strSourceJSRoot}/src/sourcejs/RuntimePaths.cpp"
)
if(MSVC)
	add_library(ExtensionIsolateContracts MODULE ${vecContractSources})
	target_compile_definitions(ExtensionIsolateContracts PRIVATE SOURCEJS_EXTENSION_TEST_DYNAMIC_HOST)
	add_executable(WindowsHostUnload WindowsHostUnload.cpp)
	target_compile_features(WindowsHostUnload PRIVATE cxx_std_20)
	target_compile_options(WindowsHostUnload PRIVATE /W4 /WX)
else()
	add_executable(ExtensionIsolateContracts ${vecContractSources})
endif()

set_target_properties(ExtensionIsolateContracts PROPERTIES MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
target_compile_features(ExtensionIsolateContracts PRIVATE cxx_std_20)
target_include_directories(ExtensionIsolateContracts PRIVATE "${strSourceJSRoot}/src")
target_include_directories(ExtensionIsolateContracts SYSTEM PRIVATE "${V8_ROOT}/include")
target_compile_definitions(ExtensionIsolateContracts PRIVATE SOURCEJS_SDK_BRANCH="fixture")

if(CMAKE_SIZEOF_VOID_P EQUAL 4)
	target_compile_definitions(ExtensionIsolateContracts PRIVATE SOURCEJS_TARGET_ARCH="x86")
else()
	target_compile_definitions(ExtensionIsolateContracts PRIVATE SOURCEJS_TARGET_ARCH="x64")
endif()

if(MSVC)
	target_compile_definitions(ExtensionIsolateContracts PRIVATE NOMINMAX SOURCEJS_TARGET_PLATFORM="windows")
	target_compile_options(ExtensionIsolateContracts PRIVATE /Zc:__cplusplus /W4 /WX)
	target_link_libraries(ExtensionIsolateContracts PRIVATE dbghelp legacy_stdio_definitions winmm)
	SourceJSLinkV8(ExtensionIsolateContracts "${V8_ROOT}" "${V8_CONFIG}" windows)
else()
	target_compile_definitions(ExtensionIsolateContracts PRIVATE SOURCEJS_TARGET_PLATFORM="linux")
	target_compile_options(ExtensionIsolateContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)
	target_link_libraries(ExtensionIsolateContracts PRIVATE dl pthread atomic)
	target_link_options(ExtensionIsolateContracts PRIVATE -fuse-ld=lld LINKER:-z,text)
	SourceJSLinkV8(ExtensionIsolateContracts "${V8_ROOT}" "${V8_CONFIG}" linux)
endif()

if(SOURCEJS_TEST_V8_IMPORTS)
	target_compile_definitions(ExtensionIsolateContracts PRIVATE SOURCEJS_TEST_V8_IMPORTS)
	target_compile_definitions(echo PRIVATE SOURCEJS_ECHO_LINKED_V8 USING_V8_SHARED=1)
	if(MSVC)
		add_dependencies(echo ExtensionIsolateContracts)
		target_link_libraries(echo PRIVATE "$<TARGET_FILE_DIR:ExtensionIsolateContracts>/ExtensionIsolateContracts.lib")
	else()
		target_link_options(ExtensionIsolateContracts PRIVATE LINKER:--export-dynamic)
	endif()
endif()

if(MSVC)
	add_test(NAME ExtensionIsolateContracts COMMAND WindowsHostUnload "$<TARGET_FILE:ExtensionIsolateContracts>" "$<TARGET_FILE:echo>")
else()
	add_test(NAME ExtensionIsolateContracts COMMAND ExtensionIsolateContracts "$<TARGET_FILE:echo>")
endif()
