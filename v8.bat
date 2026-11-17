@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "SOURCEJS_V8_SCRIPT_PATH=%~f0"
set "SOURCEJS_V8_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "SOURCEJS_V8_USAGE_RESULT=0"

if "%~1"=="" (
	goto :CheckEmptyInvocation
)

if not "%~2"=="" (
	goto :UsageError
)

if not [%2]==[] (
	goto :UsageError
)

if "%~1"=="-h" (
	goto :ShowUsage
)

if "%~1"=="--help" (
	goto :ShowUsage
)

goto :UsageError

:CheckEmptyInvocation
if not [%1]==[] (
	goto :UsageError
)

:ArgumentsValidated
if not defined SOURCEJS_V8_CONFIGS (
	set "SOURCEJS_V8_CONFIGS=x86.debug x86.release x64.debug x64.release"
)

if not exist "%SOURCEJS_V8_POWERSHELL%" (
	echo [ERROR] Windows PowerShell is required to validate V8 build settings. >&2
	exit /b 2
)

"%SOURCEJS_V8_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -Command ^
	"$ErrorActionPreference = 'Stop';" ^
	"if ($env:SOURCEJS_V8_CONFIGS -cnotmatch '\A[ \t]*(?:x86|x64)\.(?:debug|release)(?:[ \t]+(?:x86|x64)\.(?:debug|release))*[ \t]*\z') { [Console]::Error.WriteLine('[ERROR] Invalid SOURCEJS_V8_CONFIGS; expected x86/x64 debug/release configurations.'); exit 2 };" ^
	"if ($env:SOURCEJS_V8_JOBS -and ($env:SOURCEJS_V8_JOBS -cnotmatch '\A[0-9]+\z')) { [Console]::Error.WriteLine('[ERROR] Invalid SOURCEJS_V8_JOBS; expected a nonnegative decimal job count.'); exit 2 };" ^
	"exit 0"
if errorlevel 1 (
	exit /b 2
)

set "SOURCEJS_V8_DIRECTORY_PUSHED=0"
set "SOURCEJS_V8_ORIGINAL_CODE_PAGE="
set "SOURCEJS_V8_JOBS_ARG="

if not "%SOURCEJS_V8_JOBS%"=="" (
	set "SOURCEJS_V8_JOBS_ARG=-j %SOURCEJS_V8_JOBS%"
)

if not exist depot_tools\.git (
	call git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git depot_tools
	if errorlevel 1 (
		goto :BuildFailed
	)
)

set "PATH=%CD%\depot_tools;%PATH%"
set "DEPOT_TOOLS_WIN_TOOLCHAIN=0"
set "GYP_MSVS_VERSION=2022"
set "VSLANG=1033"

for /f "tokens=2 delims=:" %%P in ('chcp') do (
	set "SOURCEJS_V8_ORIGINAL_CODE_PAGE=%%P"
)

if not "%SOURCEJS_V8_ORIGINAL_CODE_PAGE%"=="" (
	call chcp 1252 >nul
	if errorlevel 1 (
		goto :BuildFailed
	)

) else (
	echo [WARNING] No console code page is available; leaving it unchanged.
)

if not exist v8\.git (
	call fetch v8
	if errorlevel 1 (
		goto :BuildFailed
	)
)

pushd "v8"
if errorlevel 1 (
	goto :BuildFailed
)

set "SOURCEJS_V8_DIRECTORY_PUSHED=1"

call git fetch --tags
if errorlevel 1 (
	goto :BuildFailed
)

call git checkout 14.4.230
if errorlevel 1 (
	goto :BuildFailed
)

call gclient sync -D
if errorlevel 1 (
	goto :BuildFailed
)

for %%C in (%SOURCEJS_V8_CONFIGS%) do (
	call :BuildConfiguration %%C
	if errorlevel 1 (
		goto :BuildFailed
	)
)

call :RestoreBuildState
if errorlevel 1 (
	echo V8_BUILD_FAILURE
	exit /b 1
)

echo V8_BUILD_SUCCESS

exit /b 0

:BuildFailed
call :RestoreBuildState
echo V8_BUILD_FAILURE
exit /b 1

:RestoreBuildState
set "SOURCEJS_V8_CLEANUP_FAILED=0"

if "%SOURCEJS_V8_DIRECTORY_PUSHED%"=="1" (
	popd
	if errorlevel 1 (
		echo [ERROR] V8 build could not restore the caller directory. >&2
		set "SOURCEJS_V8_CLEANUP_FAILED=1"
	)
)

if not "%SOURCEJS_V8_ORIGINAL_CODE_PAGE%"=="" (
	call chcp %SOURCEJS_V8_ORIGINAL_CODE_PAGE% >nul
	if errorlevel 1 (
		echo [ERROR] V8 build could not restore the console code page. >&2
		set "SOURCEJS_V8_CLEANUP_FAILED=1"
	)
)

exit /b %SOURCEJS_V8_CLEANUP_FAILED%

:BuildConfiguration
if "%~1"=="x86.debug" (
	call :BuildV8Configuration x86.debug x86 true
)

if "%~1"=="x86.release" (
	call :BuildV8Configuration x86.release x86 false
)

if "%~1"=="x64.debug" (
	call :BuildV8Configuration x64.debug x64 true
)

if "%~1"=="x64.release" (
	call :BuildV8Configuration x64.release x64 false
)

if errorlevel 1 (
	exit /b 1
)

if "%~1"=="x86.debug" (
	exit /b 0
)

if "%~1"=="x86.release" (
	exit /b 0
)

if "%~1"=="x64.debug" (
	exit /b 0
)

if "%~1"=="x64.release" (
	exit /b 0
)

echo [ERROR] Unknown V8 configuration. >&2

exit /b 1

:BuildV8Configuration
call gn gen "out\%~1" --ide=vs2022 --args="icu_use_data_file=false is_component_build=false is_debug=%~3 target_cpu=\"%~2\" treat_warnings_as_errors=false use_custom_libcxx=false use_lld=false v8_enable_i18n_support=false v8_enable_temporal_support=false v8_expose_public_symbols=true v8_monolithic=true v8_monolithic_for_shared_library=true v8_target_cpu=\"%~2\" v8_use_external_startup_data=false"
if errorlevel 1 (
	echo [ERROR] V8 GN generation failed Configuration=%~1 Result=%errorlevel% >&2
	exit /b 1
)

call autoninja -C "out\%~1" %SOURCEJS_V8_JOBS_ARG% v8_monolith
if errorlevel 1 (
	echo [ERROR] V8 compilation failed Configuration=%~1 Result=%errorlevel% >&2
	exit /b 1
)

exit /b 0

:UsageError
set "SOURCEJS_V8_USAGE_RESULT=2"

:ShowUsage
if not exist "%SOURCEJS_V8_POWERSHELL%" (
	echo Usage: "%SOURCEJS_V8_SCRIPT_PATH%" [-h ^| --help]
	exit /b %SOURCEJS_V8_USAGE_RESULT%
)

"%SOURCEJS_V8_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -Command ^
	"$ErrorActionPreference = 'Stop';" ^
	"try { $strScriptPath = Resolve-Path -LiteralPath $env:SOURCEJS_V8_SCRIPT_PATH -Relative -ErrorAction Stop } catch { $strScriptPath = $env:SOURCEJS_V8_SCRIPT_PATH };" ^
	"$OutputStream = if ($env:SOURCEJS_V8_USAGE_RESULT -eq '0') { [Console]::Out } else { [Console]::Error };" ^
	"if ($env:SOURCEJS_V8_USAGE_RESULT -ne '0') { $OutputStream.WriteLine('[ERROR] Unsupported V8 build arguments.') };" ^
	"$OutputStream.WriteLine('Usage: ' + [char]34 + $strScriptPath + [char]34 + ' [-h | --help]');" ^
	"$OutputStream.WriteLine('Build in the caller directory using SOURCEJS_V8_CONFIGS and optional SOURCEJS_V8_JOBS.'); exit 0"
exit /b %SOURCEJS_V8_USAGE_RESULT%
