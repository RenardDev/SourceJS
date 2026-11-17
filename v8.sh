#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
	printf '[ERROR] Execute v8.sh instead of sourcing it.\n' >&2
	return 2
fi

set -euo pipefail

ShowUsage() {
	local strScriptPath="${BASH_SOURCE[0]}"
	local strRelativePath=""

	if command -v realpath >/dev/null 2>&1; then
		if strRelativePath="$(realpath --relative-to="${PWD}" -- "${strScriptPath}" 2>/dev/null)"; then
			strScriptPath="${strRelativePath}"
		fi
	fi

	printf 'Usage: %q [-h | --help]\n' "${strScriptPath}"
	printf 'Build in the caller directory using SOURCEJS_V8_CONFIGS and optional SOURCEJS_V8_JOBS.\n'

	return 0
}

FinishBuild() {
	local nResult="$1"
	trap - EXIT INT TERM

	if ! cd -- "${g_strBuildRoot}"; then
		printf '[ERROR] V8 build could not restore its working directory.\n' >&2
		nResult=1
	fi

	if [[ "${nResult}" -eq 0 ]]; then
		printf 'V8_BUILD_SUCCESS\n'
	else
		printf 'V8_BUILD_FAILURE\n'
	fi

	exit "${nResult}"
}

BuildV8Configuration() {
	local strConfiguration="$1"
	local strTargetCPU="$2"
	local bDebug="$3"
	local vecNinjaArguments=()
	local nResult=0

	if [[ -n "${SOURCEJS_V8_JOBS}" ]]; then
		vecNinjaArguments+=("-j" "${SOURCEJS_V8_JOBS}")
	fi

	gn gen "out/${strConfiguration}" --args="icu_use_data_file=false is_component_build=false is_debug=${bDebug} target_cpu=\"${strTargetCPU}\" treat_warnings_as_errors=false use_custom_libcxx=false use_custom_libcxx_for_host=true use_sysroot=false v8_enable_i18n_support=false v8_enable_temporal_support=false v8_expose_public_symbols=true v8_monolithic=true v8_monolithic_for_shared_library=true v8_target_cpu=\"${strTargetCPU}\" v8_use_external_startup_data=false" || {
		nResult=$?
		printf '[ERROR] V8 GN generation failed Configuration=%s Result=%d\n' "${strConfiguration}" "${nResult}" >&2
		return "${nResult}"
	}

	autoninja -C "out/${strConfiguration}" "${vecNinjaArguments[@]}" v8_monolith || {
		nResult=$?
		printf '[ERROR] V8 compilation failed Configuration=%s Result=%d\n' "${strConfiguration}" "${nResult}" >&2
		return "${nResult}"
	}

	return 0
}

if [[ "$#" -gt 0 ]]; then
	if [[ "$#" -eq 1 ]] && [[ "$1" == "-h" || "$1" == "--help" ]]; then
		ShowUsage
		exit 0
	fi

	printf '[ERROR] Unsupported V8 build arguments.\n' >&2
	ShowUsage >&2
	exit 2
fi

SOURCEJS_V8_CONFIGS="${SOURCEJS_V8_CONFIGS:-x86.debug x86.release x64.debug x64.release}"
SOURCEJS_V8_JOBS="${SOURCEJS_V8_JOBS:-}"

if [[ ! "${SOURCEJS_V8_CONFIGS}" =~ ^[[:blank:]]*(x86|x64)\.(debug|release)([[:blank:]]+(x86|x64)\.(debug|release))*[[:blank:]]*$ ]]; then
	printf '[ERROR] Invalid SOURCEJS_V8_CONFIGS; expected x86/x64 debug/release configurations.\n' >&2
	exit 2
fi

if [[ -n "${SOURCEJS_V8_JOBS}" ]] && [[ ! "${SOURCEJS_V8_JOBS}" =~ ^[0-9]+$ ]]; then
	printf '[ERROR] Invalid SOURCEJS_V8_JOBS; expected a nonnegative decimal job count.\n' >&2
	exit 2
fi

g_vecConfigurations=()
read -r -a g_vecConfigurations <<< "${SOURCEJS_V8_CONFIGS}"

readonly g_strBuildRoot="${PWD}"
trap 'FinishBuild "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -d depot_tools/.git ]]; then
	git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git depot_tools
fi

export PATH="$PWD/depot_tools:$PATH"

if [[ ! -d v8/.git ]]; then
	fetch v8
fi

cd -- v8
git fetch --tags
git checkout 14.4.230
gclient sync -D

# Linux build dependencies
./build/install-build-deps.sh --no-prompt --lib32

for g_strConfiguration in "${g_vecConfigurations[@]}"; do
	case "${g_strConfiguration}" in
		x86.debug)
			BuildV8Configuration "x86.debug" "x86" "true"
			;;

		x86.release)
			BuildV8Configuration "x86.release" "x86" "false"
			;;

		x64.debug)
			BuildV8Configuration "x64.debug" "x64" "true"
			;;

		x64.release)
			BuildV8Configuration "x64.release" "x64" "false"
			;;

		*)
			printf '[ERROR] Unknown V8 configuration.\n' >&2
			exit 2
			;;
	esac
done

exit 0
