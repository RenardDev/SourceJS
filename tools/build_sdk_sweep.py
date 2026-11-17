#!/usr/bin/env python3

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import time

from verify_project import ROOT as PathRoot, SDK_BRANCHES as vecSDKBranches, SDK_BRANCH_REFS as objSDKBranchReferences, SDK_SUPPORTED_TARGETS as objSDKSupportedTargets

strHL2SDKRemote = "https://github.com/alliedmodders/hl2sdk.git"
vecFingerprintPaths = [
	PathRoot / "CMakeLists.txt",
	PathRoot / "cmake",
	PathRoot / "src",
	PathRoot / "thirdparty" / "Detours",
]
objPrintLock = threading.Lock()

def PrintStatus(strMessage):
	with objPrintLock:
		print(strMessage, flush=True)

def SafeRemoveTree(PathTarget, PathAllowedRoot):
	PathAbsoluteTarget = PathTarget.absolute()
	PathResolvedRoot = PathAllowedRoot.resolve()

	if (PathAbsoluteTarget == PathResolvedRoot) or (PathResolvedRoot not in PathAbsoluteTarget.parents):
		raise RuntimeError(f"Refusing to remove path outside the sweep root: {PathAbsoluteTarget}")

	if PathAbsoluteTarget.resolve() != PathAbsoluteTarget:
		raise RuntimeError(f"Refusing to remove a redirected sweep path: {PathAbsoluteTarget}")

	if PathAbsoluteTarget.exists():
		shutil.rmtree(PathAbsoluteTarget)

def RunCommand(vecCommand, PathWorkingDirectory, PathLog=None, bAppend=False):
	strCommand = subprocess.list2cmdline([str(CommandPart) for CommandPart in vecCommand])

	if PathLog is None:
		PrintStatus(f"[sweep] {strCommand}")
		objProcessResult = subprocess.run(vecCommand, cwd=PathWorkingDirectory, check=False)

		return objProcessResult.returncode

	PathLog.parent.mkdir(parents=True, exist_ok=True)
	strMode = "a" if bAppend else "w"

	with PathLog.open(strMode, encoding="utf-8", errors="replace") as objFileLog:
		objFileLog.write(f"$ {strCommand}\n")
		objFileLog.flush()
		objProcess = subprocess.Popen(
			vecCommand,
			cwd=PathWorkingDirectory,
			stdout=objFileLog,
			stderr=subprocess.STDOUT,
			text=True,
		)

		return objProcess.wait()

def SourceFingerprint(PathSourceRoot=PathRoot):
	objSourceHash = hashlib.sha256()
	vecFiles = []

	for PathFingerprint in vecFingerprintPaths:
		PathEntry = PathSourceRoot / PathFingerprint.relative_to(PathRoot)
		if PathEntry.is_file():
			vecFiles.append(PathEntry)
		elif PathEntry.is_dir():
			vecFiles.extend(PathFile for PathFile in PathEntry.rglob("*") if PathFile.is_file())

	for PathFile in sorted(vecFiles):
		PathRelative = PathFile.relative_to(PathSourceRoot)
		objSourceHash.update(PathRelative.as_posix().encode("utf-8"))
		objSourceHash.update(b"\0")
		objSourceHash.update(PathFile.read_bytes())
		objSourceHash.update(b"\0")

	return objSourceHash.hexdigest()

def ResolveTargets(strPlatform, vecRequestedBranches, vecRequestedArchitectures):
	objRequestedBranches = set(vecRequestedBranches or vecSDKBranches)
	objRequestedArchitectures = set(vecRequestedArchitectures or ["x86", "x64"])
	objUnknownBranches = objRequestedBranches - set(vecSDKBranches)

	if objUnknownBranches:
		raise RuntimeError(f"Unknown SDK branches: {', '.join(sorted(objUnknownBranches))}")

	vecTargets = []

	for strBranch in vecSDKBranches:
		if strBranch not in objRequestedBranches:
			continue

		for strArchitecture in ["x86", "x64"]:
			if strArchitecture in objRequestedArchitectures and strBranch in objSDKSupportedTargets[strPlatform][strArchitecture]:
				vecTargets.append((strBranch, strArchitecture))

	return vecTargets

def PrepareRepository(PathRepository, vecTargets):
	PathRepository.parent.mkdir(parents=True, exist_ok=True)

	if not (PathRepository / ".git").exists():
		nReturnCode = RunCommand([
			"git",
			"clone",
			"--filter=blob:none",
			"--no-checkout",
			"--single-branch",
			"--branch",
			"sdk2013",
			strHL2SDKRemote,
			str(PathRepository),
		], PathRoot)

		if nReturnCode != 0:
			raise RuntimeError("Unable to create the shared HL2SDK sweep repository.")

	nReturnCode = RunCommand(["git", "remote", "set-url", "origin", strHL2SDKRemote], PathRepository)

	if nReturnCode != 0:
		raise RuntimeError("Unable to configure the HL2SDK sweep remote.")

	objBranches = {strBranch for strBranch, _ in vecTargets}

	for strBranch in vecSDKBranches:
		if strBranch not in objBranches:
			continue

		strReference = objSDKBranchReferences[strBranch]
		nReturnCode = RunCommand(["git", "fetch", "--depth", "1", "origin", strReference], PathRepository)

		if nReturnCode != 0:
			raise RuntimeError(f"Unable to fetch pinned HL2SDK ref for {strBranch}: {strReference}")

	RunCommand(["git", "worktree", "prune"], PathRepository)

def PrepareWorkers(PathRepository, PathWorktreeRoot, unWorkerCount, strInitialReference):
	PathWorktreeRoot.mkdir(parents=True, exist_ok=True)

	vecWorkers = []

	for unIndex in range(unWorkerCount):
		PathWorker = PathWorktreeRoot / f"worker-{unIndex + 1}"

		if PathWorker.exists():
			if not (PathWorker / ".git").exists():
				raise RuntimeError(f"Existing worker path is not an HL2SDK worktree: {PathWorker}")

			objProcessResult = subprocess.run(
				["git", "status", "--porcelain", "--untracked-files=no"],
				cwd=PathWorker,
				stdout=subprocess.PIPE,
				stderr=subprocess.STDOUT,
				text=True,
				check=False,
			)

			if objProcessResult.returncode != 0 or objProcessResult.stdout.strip():
				raise RuntimeError(f"HL2SDK worker has tracked changes: {PathWorker}\n{objProcessResult.stdout}")
		else:
			nReturnCode = RunCommand([
				"git",
				"worktree",
				"add",
				"--detach",
				str(PathWorker),
				strInitialReference,
			], PathRepository)

			if nReturnCode != 0:
				raise RuntimeError(f"Unable to create HL2SDK worker: {PathWorker}")

		vecWorkers.append(PathWorker)

	return vecWorkers

def ConfigureCommand(objArguments, strBranch, strArchitecture, PathSDK, PathBuild):
	strTriplet = f"{strArchitecture}-{objArguments.platform}"
	vecCommand = [
		"cmake",
		"-S",
		str(objArguments.source_root),
		"-B",
		str(PathBuild),
		f"-DSOURCEJS_PLATFORM={objArguments.platform}",
		f"-DSOURCEJS_ARCH={strArchitecture}",
		f"-DSOURCEJS_SDK_BRANCH={strBranch}",
		f"-DHL2SDK_ROOT={PathSDK}",
		f"-DV8_ROOT={objArguments.v8_root}",
		f"-DV8_CONFIG={strArchitecture}.release",
		f"-DCMAKE_TOOLCHAIN_FILE={objArguments.vcpkg_root / 'scripts' / 'buildsystems' / 'vcpkg.cmake'}",
	]

	if objArguments.platform == "linux":
		vecCommand.extend([
			"-G",
			"Ninja",
			"-DCMAKE_BUILD_TYPE=Release",
			f"-DVCPKG_TARGET_TRIPLET={strTriplet}",
		])
	else:
		strVisualStudioArchitecture = "Win32" if (strArchitecture == "x86") else "x64"

		vecCommand.extend([
			"-G",
			objArguments.generator,
			"-A",
			strVisualStudioArchitecture,
			f"-DVCPKG_TARGET_TRIPLET={strTriplet}-static",
		])

	return vecCommand

def BuildCommand(objArguments, PathBuild):
	vecCommand = ["cmake", "--build", str(PathBuild)]

	if objArguments.platform == "windows":
		vecCommand.extend(["--config", "Release"])

	vecCommand.extend(["--parallel", str(objArguments.jobs)])

	return vecCommand

def WriteResult(PathResult, objResult):
	PathResult.parent.mkdir(parents=True, exist_ok=True)

	PathResult.write_text(json.dumps(objResult, indent="\t", sort_keys=True) + "\n", encoding="utf-8")

def ResumeResult(PathResult, strFingerprint, strBranch, strArchitecture, strPlatform):
	if not PathResult.is_file():
		return None

	try:
		objResult = json.loads(PathResult.read_text(encoding="utf-8"))
	except (OSError, UnicodeError, json.JSONDecodeError):
		return None

	if not isinstance(objResult, dict):
		return None

	# SDK pins live outside the source fingerprint; a different target/revision must rebuild.
	if (
		objResult.get("status") != "success"
		or objResult.get("sourceFingerprint") != strFingerprint
		or objResult.get("branch") != strBranch
		or objResult.get("arch") != strArchitecture
		or objResult.get("platform") != strPlatform
		or objResult.get("hl2sdkReference") != objSDKBranchReferences[strBranch]
	):
		return None

	return objResult

def BuildTarget(objArguments, PathWorker, unWorkerIndex, strBranch, strArchitecture, strFingerprint):
	flStartTime = time.monotonic()
	strTarget = f"{objArguments.platform}-{strBranch}-{strArchitecture}"
	PathLog = objArguments.log_root / f"{strTarget}.log"
	PathResult = objArguments.result_root / f"{strTarget}.json"
	PathBuild = objArguments.build_root / f"worker-{unWorkerIndex + 1}" / "current"

	if objArguments.resume:
		objPreviousResult = ResumeResult(PathResult, strFingerprint, strBranch, strArchitecture, objArguments.platform)

		if objPreviousResult is not None:
			PrintStatus(f"[sweep] SKIP {strTarget}")
			return objPreviousResult

	SafeRemoveTree(PathBuild, objArguments.build_root)
	PathBuild.parent.mkdir(parents=True, exist_ok=True)
	strReference = objSDKBranchReferences[strBranch]

	PrintStatus(f"[sweep] START {strTarget} on worker {unWorkerIndex + 1}")
	nReturnCode = RunCommand(["git", "switch", "--detach", strReference], PathWorker, PathLog)
	strStatus = "checkout_failed"
	unBinarySize = 0

	if nReturnCode == 0:
		nReturnCode = RunCommand(ConfigureCommand(objArguments, strBranch, strArchitecture, PathWorker, PathBuild), objArguments.source_root, PathLog, True)
		strStatus = "configure_failed"

	if nReturnCode == 0:
		nReturnCode = RunCommand(BuildCommand(objArguments, PathBuild), objArguments.source_root, PathLog, True)
		strStatus = "build_failed"

	if nReturnCode == 0:
		PathBinary = PathBuild / "sourcejs.so"

		if objArguments.platform == "windows":
			PathBinary = PathBuild / "Release" / "sourcejs.dll"

		if not PathBinary.is_file():
			nReturnCode = 1
			strStatus = "binary_missing"
		else:
			unBinarySize = PathBinary.stat().st_size
			strStatus = "success"

	flDurationSeconds = time.monotonic() - flStartTime
	objResult = {
		"arch": strArchitecture,
		"binarySize": unBinarySize,
		"branch": strBranch,
		"durationSeconds": round(flDurationSeconds, 3),
		"hl2sdkReference": strReference,
		"log": str(PathLog.resolve()),
		"platform": objArguments.platform,
		"sourceFingerprint": strFingerprint,
		"status": strStatus,
	}

	WriteResult(PathResult, objResult)

	if strStatus == "success" or not objArguments.keep_failed_builds:
		SafeRemoveTree(PathBuild, objArguments.build_root)

	strLabel = "PASS" if (strStatus == "success") else "FAIL"

	PrintStatus(f"[sweep] {strLabel} {strTarget} ({flDurationSeconds:.1f}s, {strStatus})")

	return objResult

def ParseArguments():
	objArgumentParser = argparse.ArgumentParser(description="Build every supported SourceJS HL2SDK target for one platform.")
	objArgumentParser.add_argument("--platform", choices=["linux", "windows"], required=True)
	objArgumentParser.add_argument("--source-root", type=Path, default=PathRoot)
	objArgumentParser.add_argument("--v8-root", type=Path, required=True)
	objArgumentParser.add_argument("--vcpkg-root", type=Path, required=True)
	objArgumentParser.add_argument("--sdk-repository", type=Path, required=True)
	objArgumentParser.add_argument("--worktree-root", type=Path, required=True)
	objArgumentParser.add_argument("--build-root", type=Path, required=True)
	objArgumentParser.add_argument("--log-root", type=Path, required=True)
	objArgumentParser.add_argument("--result-root", type=Path, required=True)
	objArgumentParser.add_argument("--branches", nargs="*", choices=vecSDKBranches)
	objArgumentParser.add_argument("--architectures", nargs="*", choices=["x86", "x64"])
	objArgumentParser.add_argument("--workers", type=int, default=1)
	objArgumentParser.add_argument("--jobs", type=int, default=max(1, os.cpu_count() or 1))
	objArgumentParser.add_argument("--generator", default="Visual Studio 17 2022")
	objArgumentParser.add_argument("--resume", action="store_true")
	objArgumentParser.add_argument("--keep-failed-builds", action="store_true")

	return objArgumentParser.parse_args()

def Main():
	objArguments = ParseArguments()

	if objArguments.workers < 1 or objArguments.jobs < 1:
		print("[sweep] --workers and --jobs must be positive integers.")
		return 2

	for strPropertyName in ["source_root", "v8_root", "vcpkg_root"]:
		PathValue = getattr(objArguments, strPropertyName).resolve()
		setattr(objArguments, strPropertyName, PathValue)

		if not PathValue.is_dir():
			print(f"[sweep] Missing required directory: {PathValue}")
			return 2

	for strPropertyName in ["sdk_repository", "worktree_root", "build_root", "log_root", "result_root"]:
		setattr(objArguments, strPropertyName, getattr(objArguments, strPropertyName).resolve())

	try:
		vecTargets = ResolveTargets(objArguments.platform, objArguments.branches, objArguments.architectures)

		if not vecTargets:
			raise RuntimeError(f"No supported {objArguments.platform} targets were selected.")

		strFingerprint = SourceFingerprint(objArguments.source_root)
		PrepareRepository(objArguments.sdk_repository, vecTargets)
		nWorkerCount = min(objArguments.workers, len(vecTargets))
		vecWorkers = PrepareWorkers(
			objArguments.sdk_repository,
			objArguments.worktree_root,
			nWorkerCount,
			objSDKBranchReferences[vecTargets[0][0]],
		)
	except (OSError, RuntimeError) as objError:
		print(f"[sweep] {objError}")
		return 2

	objTargetQueue = queue.Queue()

	for objTarget in vecTargets:
		objTargetQueue.put(objTarget)

	vecResults = []
	objResultLock = threading.Lock()

	def RunWorker(unWorkerIndex):
		while True:
			try:
				strBranch, strArchitecture = objTargetQueue.get_nowait()
			except queue.Empty:
				return

			try:
				objResult = BuildTarget(
					objArguments,
					vecWorkers[unWorkerIndex],
					unWorkerIndex,
					strBranch,
					strArchitecture,
					strFingerprint,
				)
			except (OSError, RuntimeError) as objError:
				objResult = {
					"arch": strArchitecture,
					"branch": strBranch,
					"platform": objArguments.platform,
					"sourceFingerprint": strFingerprint,
					"status": "internal_error",
					"error": str(objError),
				}

				PrintStatus(f"[sweep] FAIL {objArguments.platform}-{strBranch}-{strArchitecture}: {objError}")
			finally:
				objTargetQueue.task_done()

			with objResultLock:
				vecResults.append(objResult)

	with ThreadPoolExecutor(max_workers=len(vecWorkers)) as objThreadExecutor:
		vecBuildFutures = [objThreadExecutor.submit(RunWorker, unIndex) for unIndex in range(len(vecWorkers))]

		for objBuildFuture in vecBuildFutures:
			objBuildFuture.result()

	def GetResultSortKey(objResult):
		return (vecSDKBranches.index(objResult["branch"]), objResult["arch"])

	vecResults.sort(key=GetResultSortKey)
	objSummary = {
		"failed": sum(objResult["status"] != "success" for objResult in vecResults),
		"platform": objArguments.platform,
		"sourceFingerprint": strFingerprint,
		"succeeded": sum(objResult["status"] == "success" for objResult in vecResults),
		"targets": vecResults,
	}

	objArguments.result_root.mkdir(parents=True, exist_ok=True)
	PathSummary = objArguments.result_root / f"{objArguments.platform}-summary.json"

	WriteResult(PathSummary, objSummary)
	PrintStatus(
		f"[sweep] Completed {objArguments.platform}: {objSummary['succeeded']} passed, "
		f"{objSummary['failed']} failed. Summary: {PathSummary}"
	)

	return 0 if (objSummary["failed"] == 0) else 1

if __name__ == "__main__":
	sys.exit(Main())
