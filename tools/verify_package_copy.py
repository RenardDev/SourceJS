#!/usr/bin/env python3

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PACKAGE = ROOT / "packages" / "sourcejs"
CHECKED_SUFFIXES = {".cjs", ".js", ".json", ".ts"}

def ReadText(PathFile):
	return PathFile.read_text(encoding="utf-8")

def CollectPackageFiles(PathRoot):
	return {
		PathFile.relative_to(PathRoot)
		for PathFile in PathRoot.rglob("*")
		if PathFile.is_file() and PathFile.suffix in CHECKED_SUFFIXES
	}

def Main():
	Parser = argparse.ArgumentParser(description="Verify an installed SourceJS package copy is fresh.")
	Parser.add_argument("--package-root", required=True, help="Installed addons/sourcejs/packages/sourcejs directory.")
	Arguments = Parser.parse_args()

	if not SOURCE_PACKAGE.is_dir():
		print(f"[verify-package-copy] missing source package: {SOURCE_PACKAGE}")
		return 1

	PathPackageRoot = Path(Arguments.package_root).resolve()
	if not PathPackageRoot.is_dir():
		print(f"[verify-package-copy] missing package root: {PathPackageRoot}")
		return 1

	setSourceFiles = CollectPackageFiles(SOURCE_PACKAGE)
	setInstalledFiles = CollectPackageFiles(PathPackageRoot)

	setMissing = setSourceFiles - setInstalledFiles
	if setMissing:
		print(f"[verify-package-copy] missing installed file: {sorted(setMissing)[0].as_posix()}")
		return 1

	setExtra = setInstalledFiles - setSourceFiles
	if setExtra:
		print(f"[verify-package-copy] extra installed file: {sorted(setExtra)[0].as_posix()}")
		return 1

	for PathRelative in sorted(setSourceFiles):
		PathSourceFile = SOURCE_PACKAGE / PathRelative
		PathInstalledFile = PathPackageRoot / PathRelative
		if ReadText(PathSourceFile) != ReadText(PathInstalledFile):
			print(f"[verify-package-copy] stale installed file: {PathRelative.as_posix()}")
			return 1

	print(f"[verify-package-copy] ok: {PathPackageRoot}")

	return 0

if __name__ == "__main__":
	raise SystemExit(Main())
