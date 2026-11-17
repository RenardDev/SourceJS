#!/usr/bin/env python3

import argparse
import ast
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest import mock

argparse.ArgumentParser(description="Check SDK sweep helpers without running builds or deleting files.").parse_args()

PathRoot = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PathRoot / "tools"))
from verify_project import SDK_BRANCHES, SDK_BRANCH_REFS, SDK_SUPPORTED_TARGETS

SourcePath = PathRoot / "tools" / "build_sdk_sweep.py"
Source = SourcePath.read_text(encoding="utf-8")
Tree = ast.parse(Source, filename=str(SourcePath))
Names = {"SourceFingerprint", "SafeRemoveTree", "ResumeResult", "BuildTarget", "ResolveTargets", "ConfigureCommand", "BuildCommand", "ParseArguments"}
Functions = [Node for Node in Tree.body if isinstance(Node, ast.FunctionDef) and Node.name in Names]
assert {Node.name for Node in Functions} == Names
Scope = {
	"argparse": argparse,
	"json": json,
	"hashlib": hashlib,
	"os": __import__("os"),
	"Path": Path,
	"PathRoot": PathRoot,
	"objSDKBranchReferences": SDK_BRANCH_REFS,
	"objSDKSupportedTargets": SDK_SUPPORTED_TARGETS,
	"vecSDKBranches": SDK_BRANCHES,
}
FingerprintPaths = next(Node for Node in Tree.body if isinstance(Node, ast.Assign) and any(isinstance(Target, ast.Name) and Target.id == "vecFingerprintPaths" for Target in Node.targets))
exec(compile(ast.Module(body=[FingerprintPaths, *Functions], type_ignores=[]), str(SourcePath), "exec"), Scope)

class Cache:
	def __init__(self, Payload, bExists=True):
		self.Payload = Payload
		self.bExists = bExists

	def is_file(self):
		return self.bExists

	def read_text(self, **Options):
		assert Options == {"encoding": "utf-8"}
		if isinstance(self.Payload, Exception):
			raise self.Payload

		return self.Payload

vecRejectedPayloads = [
	"",
	"{",
	"[]",
	"null",
	"3",
	"true",
	'"text"',
	'{"status": "build_failed", "sourceFingerprint": "expected"}',
	'{"status": "success", "sourceFingerprint": "different"}',
	OSError("fixture read failure"),
	UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid fixture"),
]
vecResumeTarget = ["csgo", "x86", "linux"]
for Payload in vecRejectedPayloads:
	assert Scope["ResumeResult"](Cache(Payload), "expected", *vecResumeTarget) is None

assert Scope["ResumeResult"](Cache("unused", False), "expected", *vecResumeTarget) is None
ExpectedResult = {"status": "success", "sourceFingerprint": "expected", "binarySize": 77, "branch": "csgo", "arch": "x86", "platform": "linux", "hl2sdkReference": SDK_BRANCH_REFS["csgo"]}

def CheckResumeTargetIdentity(ResumeFunction):
	assert ResumeFunction(Cache(json.dumps(ExpectedResult)), "expected", *vecResumeTarget) == ExpectedResult
	for strField, Value in [("status", "build_failed"), ("sourceFingerprint", "different"), ("branch", "different"), ("arch", "x64"), ("platform", "windows"), ("hl2sdkReference", "different-sdk-pin")]:
		for bMissing in [False, True]:
			Result = dict(ExpectedResult)
			if bMissing:
				Result.pop(strField)
			else:
				Result[strField] = Value

			assert ResumeFunction(Cache(json.dumps(Result)), "expected", *vecResumeTarget) is None, strField

CheckResumeTargetIdentity(Scope["ResumeResult"])
for strField in ["status", "sourceFingerprint", "branch", "arch", "platform", "hl2sdkReference"]:
	# Disable one actual production comparison; the same regression must reject it.
	Definition = next(Node for Node in ast.parse(Source).body if isinstance(Node, ast.FunctionDef) and Node.name == "ResumeResult")
	vecComparisons = [
		Node for Node in ast.walk(Definition)
		if isinstance(Node, ast.Compare)
		and isinstance(Node.left, ast.Call)
		and isinstance(Node.left.func, ast.Attribute)
		and isinstance(Node.left.func.value, ast.Name)
		and Node.left.func.value.id == "objResult"
		and Node.left.func.attr == "get"
		and len(Node.left.args) == 1
		and isinstance(Node.left.args[0], ast.Constant)
		and Node.left.args[0].value == strField
	]
	assert len(vecComparisons) == 1, strField
	vecComparisons[0].comparators = [vecComparisons[0].left]
	MutatedScope = dict(Scope)
	exec(compile(ast.Module(body=[Definition], type_ignores=[]), str(SourcePath), "exec"), MutatedScope)
	try:
		CheckResumeTargetIdentity(MutatedScope["ResumeResult"])
	except AssertionError:
		pass
	else:
		raise AssertionError(f"Resume identity regression accepted a disabled {strField} comparison")

ResumeSpy = mock.Mock(return_value=ExpectedResult)
Arguments = SimpleNamespace(platform="linux", log_root=Path("Logs"), result_root=Path("Results"), build_root=Path("Build"), resume=True)
with mock.patch.dict(Scope, {
	"time": SimpleNamespace(monotonic=lambda: 0),
	"PrintStatus": mock.Mock(),
	"ResumeResult": ResumeSpy,
	"SafeRemoveTree": mock.Mock(side_effect=AssertionError("A matching cached target must not delete build files")),
	"RunCommand": mock.Mock(side_effect=AssertionError("A matching cached target must not run a command")),
}):
	assert Scope["BuildTarget"](Arguments, Path("Worker"), 0, "csgo", "x86", "expected") is ExpectedResult
	ResumeSpy.assert_called_once_with(Path("Results") / "linux-csgo-x86.json", "expected", *vecResumeTarget)

mapRelativeSources = {
	"CMakeLists.txt": b"project(Fixture)\n",
	"cmake/Options.cmake": b"set(FIXTURE 1)\n",
	"src/Fixture.cpp": b"return 1;\n",
	"thirdparty/Detours/Detours.cpp": b"fixture ABI\n",
}
OtherRoot = PathRoot / "build" / "StyleSweepOtherSource"
SameRoot = PathRoot / "build" / "StyleSweepSameSource"
mapSourceBytes = {}
for Root in [PathRoot, OtherRoot, SameRoot]:
	for strRelativePath, Bytes in mapRelativeSources.items():
		mapSourceBytes[Root / strRelativePath] = Bytes

mapOtherSources = dict(mapRelativeSources)
mapOtherSources["src/Fixture.cpp"] = b"return 2;\n"
mapSourceBytes[OtherRoot / "src/Fixture.cpp"] = mapOtherSources["src/Fixture.cpp"]

def ExpectedFingerprint(mapSources):
	Hash = hashlib.sha256()
	for RelativePath in sorted(Path(strName) for strName in mapSources):
		Hash.update(RelativePath.as_posix().encode("utf-8"))
		Hash.update(b"\0")
		Hash.update(mapSources[RelativePath.as_posix()])
		Hash.update(b"\0")

	return Hash.hexdigest()

def CheckFingerprint(Fingerprint):
	strFirst = Fingerprint(PathRoot)
	strOther = Fingerprint(OtherRoot)
	assert strFirst == ExpectedFingerprint(mapRelativeSources)
	assert strOther == ExpectedFingerprint(mapOtherSources)
	assert strFirst != strOther
	assert Fingerprint(SameRoot) == strFirst

def CollectFixturePaths(Target, strPattern):
	assert strPattern == "*"

	return [Candidate for Candidate in mapSourceBytes if Target in Candidate.parents]

with contextlib.ExitStack() as Stack:
	Stack.enter_context(mock.patch.object(Path, "is_file", lambda Target: Target in mapSourceBytes))
	Stack.enter_context(mock.patch.object(Path, "is_dir", lambda Target: any(Target in Candidate.parents for Candidate in mapSourceBytes)))
	Stack.enter_context(mock.patch.object(Path, "rglob", CollectFixturePaths))
	Stack.enter_context(mock.patch.object(Path, "read_bytes", lambda Target: mapSourceBytes[Target]))
	CheckFingerprint(Scope["SourceFingerprint"])
	assert Scope["SourceFingerprint"]() == Scope["SourceFingerprint"](PathRoot)

	# Negative control intentionally ignores the selected source root.
	try:
		CheckFingerprint(lambda SelectedRoot: Scope["SourceFingerprint"]())
	except AssertionError:
		pass
	else:
		raise AssertionError("Fingerprint regression accepted an ignored --source-root")

vecDeletedPaths = []
Scope["shutil"] = SimpleNamespace(rmtree=lambda Target: vecDeletedPaths.append(Target))
AllowedRoot = (PathRoot / "build" / "StyleSweepReadOnlyPaths").resolve()
for Target in [AllowedRoot, AllowedRoot.parent / "outside", AllowedRoot / ".." / "outside"]:
	try:
		Scope["SafeRemoveTree"](Target, AllowedRoot)
	except RuntimeError:
		pass
	else:
		raise AssertionError("Unsafe deletion target accepted")

assert vecDeletedPaths == []
Target = AllowedRoot / "worker-1" / "current"
RedirectedTarget = AllowedRoot / "worker-2" / "current"
with mock.patch.object(Path, "resolve", lambda PathValue: RedirectedTarget if (PathValue == Target) else PathValue):
	with mock.patch.object(Path, "exists", return_value=True):
		try:
			Scope["SafeRemoveTree"](Target, AllowedRoot)
		except RuntimeError:
			pass
		else:
			raise AssertionError("Redirected worker deletion target accepted")

assert vecDeletedPaths == []
with mock.patch.object(Path, "exists", return_value=True):
	Scope["SafeRemoveTree"](AllowedRoot / "worker-1" / "current", AllowedRoot)

assert vecDeletedPaths == [(AllowedRoot / "worker-1" / "current").resolve()]

for strPlatform in ["linux", "windows"]:
	vecExpectedTargets = [
		(strBranch, strArchitecture)
		for strBranch in SDK_BRANCHES
		for strArchitecture in ["x86", "x64"]
		if strBranch in SDK_SUPPORTED_TARGETS[strPlatform][strArchitecture]
	]
	assert Scope["ResolveTargets"](strPlatform, None, None) == vecExpectedTargets
	assert Scope["ResolveTargets"](strPlatform, ["csgo"], ["x86"]) == [
		Target for Target in vecExpectedTargets if Target == ("csgo", "x86")
	]
	Arguments = SimpleNamespace(platform=strPlatform, source_root=Path("Source"), v8_root=Path("V8"), vcpkg_root=Path("Vcpkg"), generator="FixtureGenerator", jobs=3)
	vecConfigure = Scope["ConfigureCommand"](Arguments, "csgo", "x86", Path("SDK"), Path("Build"))
	assert "-DSOURCEJS_ARCH=x86" in vecConfigure
	assert "-DSOURCEJS_SDK_BRANCH=csgo" in vecConfigure
	assert "-DV8_CONFIG=x86.release" in vecConfigure
	if strPlatform == "linux":
		assert "Ninja" in vecConfigure
		assert "-DCMAKE_BUILD_TYPE=Release" in vecConfigure
		assert "-DVCPKG_TARGET_TRIPLET=x86-linux" in vecConfigure
	else:
		assert "Win32" in vecConfigure and "FixtureGenerator" in vecConfigure
		assert "-DVCPKG_TARGET_TRIPLET=x86-windows-static" in vecConfigure

	vecBuild = Scope["BuildCommand"](Arguments, Path("Build"))
	assert vecBuild[:3] == ["cmake", "--build", "Build"]
	assert vecBuild[-2:] == ["--parallel", "3"]
	assert ("--config" in vecBuild) == (strPlatform == "windows")

try:
	Scope["ResolveTargets"]("linux", ["unknown-fixture-branch"], ["x86"])
except RuntimeError:
	pass
else:
	raise AssertionError("Unknown branch accepted")

vecRequired = [
	"--platform", "linux",
	"--v8-root", "V8",
	"--vcpkg-root", "Vcpkg",
	"--sdk-repository", "SDK",
	"--worktree-root", "Worktrees",
	"--build-root", "Build",
	"--log-root", "Logs",
	"--result-root", "Results",
]
vecSavedArguments = sys.argv
try:
	sys.argv = ["build_sdk_sweep.py", *vecRequired, "--branches", "csgo", "--architectures", "x64", "--workers", "2", "--jobs", "3", "--resume"]
	Arguments = Scope["ParseArguments"]()
	assert Arguments.workers == 2 and Arguments.jobs == 3 and Arguments.resume
	assert Arguments.branches == ["csgo"] and Arguments.architectures == ["x64"]
	for vecArguments, nExpectedStatus in [(["--help"], 0), ([], 2), ([*vecRequired, "--unknown-fixture-option"], 2)]:
		with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
			sys.argv = ["build_sdk_sweep.py", *vecArguments]
			try:
				Scope["ParseArguments"]()
			except SystemExit as Error:
				assert Error.code == nExpectedStatus
			else:
				raise AssertionError("Parser did not terminate")
finally:
	sys.argv = vecSavedArguments

compile(Source, str(SourcePath), "exec")
print("SDK sweep cache/target identity with 6 production fault controls, selected-root fingerprint/fault control, mocked deletion guards, actual target matrices, commands and parser passed; no builds or deletions executed.")
