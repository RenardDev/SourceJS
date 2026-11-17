#!/usr/bin/env python3

import sys

from verify_project import SDK_BRANCH_REFS, SDK_SUPPORTED_TARGETS

def Main(vecArguments: list[str]) -> int:
	if len(vecArguments) != 3:
		print("Usage: select_github_build_target.py <SDK> <platform> <architecture>", file=sys.stderr)
		return 2

	strSDK, strPlatform, strArchitecture = vecArguments
	mapArchitectures = SDK_SUPPORTED_TARGETS.get(strPlatform, {})
	if strSDK not in mapArchitectures.get(strArchitecture, set()):
		print(f"Unsupported SDK target: {strSDK!r} on {strPlatform!r} {strArchitecture!r}.", file=sys.stderr)
		return 2

	print(f"sdk_ref={SDK_BRANCH_REFS[strSDK]}")

	return 0

if __name__ == "__main__":
	raise SystemExit(Main(sys.argv[1:]))
