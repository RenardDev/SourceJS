#!/usr/bin/env python3

import bisect
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCEJS_NODE_PATH = os.pathsep.join([str(ROOT / "packages" / "sourcejs"), str(ROOT / "packages")])
os.environ["NODE_PATH"] = SOURCEJS_NODE_PATH + (os.pathsep + os.environ["NODE_PATH"] if os.environ.get("NODE_PATH") else "")

SDK_BRANCHES = [
	"bgt",
	"blade",
	"bms",
	"contagion",
	"csgo",
	"css",
	"darkm",
	"dods",
	"doi",
	"episode1",
	"eye",
	"gmod",
	"hl2dm",
	"insurgency",
	"l4d",
	"l4d2",
	"mcv",
	"nucleardawn",
	"orangebox",
	"portal2",
	"pvkii",
	"sdk2013",
	"swarm",
	"tf2",
]

SDK_BRANCH_REFS = {
	"bgt": "4ae5d9dbd614bf862f86682d9f8c95595e973288",
	"blade": "a736c9a6c676136f575af5056384851a8e1e788a",
	"bms": "51cd3e7b0b7fc81d672159c99299910a30b4c9ce",
	"contagion": "934ff16bbb89853c5d2825922cbfcada33b58f05",
	"csgo": "9cf2f325ea273559c7cae27b4f98518c18b8e322",
	"css": "64895cf48c68f5cef0470ee3f13ec449babc30ea",
	"darkm": "016cfd4f95e58f94131594a12b5a3aac9cd33f20",
	"dods": "ece187a8147a8159c16f88305e3523cef6475ecf",
	"doi": "ceefec48c282335da40a30f66bf498bd8e327d2f",
	"episode1": "4b0cde271be6806b95842e78348009712a8b3fbe",
	"eye": "eea369b456eddf177d32cecbb4a32c0b144d0d02",
	"gmod": "231e152ac20af77fbd22a4f5fa810c42004343d1",
	"hl2dm": "af883d5052349f09fbe641c99149b84769a62d01",
	"insurgency": "f66e087ee2993e8f09b27deed9f23c03321bd70d",
	"l4d": "0a8e862697335b12976a124daf728c38e975e381",
	"l4d2": "c2badaa4f7e763a92427ac11202c349385810cc2",
	"mcv": "794ff8a7cd9170c0580f91e0fb89bafc6db7a2a3",
	"nucleardawn": "38a4308cce4f0574d76ee36cedf20aa76054fbee",
	"orangebox": "88bc34abdd51421afed7bd120d457cbdc372ccfa",
	"portal2": "f61c12390436451dbd2fe64362715ee9fc1cf1af",
	"pvkii": "f06b74a1d44116613e398787974b78e51fb1c8b8",
	"sdk2013": "4c56ee5bc8bfe00793abb7d40eb3f6fb040f10d2",
	"swarm": "53355f2ea3671c8b543fca6c5a95ab884a620780",
	"tf2": "f8ec7a5644b58ff0c8dcd94d8b7501b447f5a82d",
}

SDK_SUPPORTED_TARGETS = {
	"linux": {
		"x86": {
			"bgt",
			"blade",
			"bms",
			"contagion",
			"csgo",
			"css",
			"dods",
			"doi",
			"eye",
			"gmod",
			"hl2dm",
			"insurgency",
			"l4d",
			"l4d2",
			"mcv",
			"nucleardawn",
			"orangebox",
			"pvkii",
			"sdk2013",
			"tf2",
		},
		"x64": {
			"blade",
			"css",
			"dods",
			"hl2dm",
			"mcv",
			"tf2",
		},
	},
	"windows": {
		"x86": {
			"bgt",
			"blade",
			"bms",
			"contagion",
			"csgo",
			"css",
			"darkm",
			"dods",
			"doi",
			"episode1",
			"eye",
			"gmod",
			"hl2dm",
			"insurgency",
			"l4d",
			"l4d2",
			"mcv",
			"nucleardawn",
			"orangebox",
			"portal2",
			"pvkii",
			"sdk2013",
			"swarm",
			"tf2",
		},
		"x64": {
			"blade",
			"css",
			"dods",
			"doi",
			"hl2dm",
			"insurgency",
			"mcv",
			"tf2",
		},
	},
}

EXPECTED_PACKAGE_MODULES = {
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
}

SOURCEJS_NATIVE_ONLY_MODULES = {
	"cpr",
	"redis",
	"soci",
	"socket",
}

EXPECTED_PACKAGE_SUBMODULES = {
	"auth/backends/flatfile",
	"auth/backends/sql",
	"auth/manager",
	"auth/permissions",
	"commands/auth",
	"commands/client",
	"commands/command",
	"commands/filter",
	"commands/manager",
	"commands/player",
	"commands/say",
	"commands/server",
	"commands/typed",
	"config/command",
	"config/cvar",
	"config/manager",
	"config/section",
	"core/cache",
	"core/command",
	"core/command/auth",
	"core/command/docs",
	"core/command/dump",
	"core/command/plugin",
	"core/dumps",
	"core/logger",
	"core/settings",
	"core/table",
	"core/update",
	"core/version",
	"cvars/convar",
	"cvars/flags",
	"cvars/public",
	"cvars/tags",
	"effects/hooks",
	"effects/templates",
	"engines/gamerules",
	"engines/precache",
	"engines/server",
	"engines/sound",
	"engines/trace",
	"entities/classes",
	"entities/collisions",
	"entities/constants",
	"entities/dictionary",
	"entities/entity",
	"entities/engines",
	"entities/engines/csgo/csgo",
	"entities/factories",
	"entities/helpers",
	"entities/datamaps",
	"entities/props",
	"entities/transmit",
	"events/custom",
	"events/listener",
	"events/manager",
	"events/resource",
	"events/variable",
	"filters/entities",
	"filters/iterator",
	"filters/players",
	"filters/recipients",
	"filters/weapons",
	"listeners/tick",
	"memory/helpers",
	"memory/hooks",
	"memory/hooks/entities",
	"memory/hooks/events",
	"memory/hooks/exceptions",
	"memory/hooks/messages",
	"memory/hooks/warnings",
	"memory/manager",
	"menus/esc",
	"menus/queue",
	"menus/radio",
	"messages/colors",
	"messages/colors/saytext2",
	"messages/dialog",
	"messages/implementation",
	"players/bots",
	"players/constants",
	"players/dictionary",
	"players/dropweapon",
	"players/engines",
	"players/engines/bms",
	"players/engines/csgo",
	"players/engines/l4d2",
	"players/engines/orangebox",
	"players/engines/orangebox/cstrike",
	"players/entity",
	"players/helpers",
	"players/language",
	"players/language/cache",
	"players/teams",
	"players/voice",
	"plugins/command",
	"plugins/info",
	"plugins/instance",
	"plugins/manager",
	"settings/menu",
	"settings/player",
	"settings/storage",
	"settings/types",
	"stringtables/downloads",
	"studio/cache",
	"studio/constants",
	"translations/manager",
	"translations/strings",
	"weapons/constants",
	"weapons/dictionary",
	"weapons/entity",
	"weapons/engines",
	"weapons/engines/csgo",
	"weapons/instance",
	"weapons/manager",
	"weapons/restrictions",
	"weapons/scripts",
}

EXPECTED_RUNTIME_MODULES = EXPECTED_PACKAGE_MODULES | EXPECTED_PACKAGE_SUBMODULES | SOURCEJS_NATIVE_ONLY_MODULES

BANNED_CODE_PATTERNS = [
	"__sourcejsNative",
	"nativeCall",
	"defineModule",
	"InstallNativeObject",
	"NativeCallCallback",
	"function invoke",
	"invoke(moduleName",
]

BANNED_PUBLIC_EXPORTS = [
	"INFECTED",
	"L4D1_SURVIVOR",
	"SURVIVOR",
	"infected",
	"l4d1Survivor",
	"survivor",
]

def Fail(strMessage):
	print(f"[verify] {strMessage}")

	return 1

def ReadText(PathFile):
	return PathFile.read_text(encoding="utf-8")

def CollectPackageModules(strExtension):
	PathPackage = ROOT / "packages" / "sourcejs"
	vecModules = []
	for PathFile in PathPackage.glob(f"*{strExtension}"):
		if PathFile.name == f"index{strExtension}":
			continue

		vecModules.append(PathFile.name[:-len(strExtension)])

	for PathDirectory in PathPackage.iterdir():
		if PathDirectory.is_dir() and (PathDirectory / f"index{strExtension}").is_file():
			vecModules.append(PathDirectory.name)

	return set(vecModules)

def IterateInstalledPackageRoots():
	for PathParent in [ROOT / "package", ROOT / "artifacts"]:
		if not PathParent.is_dir():
			continue

		for PathPackage in sorted(PathParent.glob("*/addons/sourcejs/packages/sourcejs")):
			if PathPackage.is_dir():
				yield PathPackage

def CheckInstalledPackageCopiesAreFresh():
	PathScript = ROOT / "tools" / "verify_package_copy.py"
	unTimeoutSeconds = 30

	def RunPackageVerifier(PathVerifier, PathPackageRoot):
		return subprocess.run([sys.executable, "-B", str(PathVerifier), "--package-root", str(PathPackageRoot)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)

	try:
		with tempfile.TemporaryDirectory(prefix="sourcejs-package-copy-regression-") as strTemporaryRoot:
			PathTemporaryRoot = Path(strTemporaryRoot).resolve()
			PathFixtureScript = PathTemporaryRoot / "repository" / "tools" / "verify_package_copy.py"
			PathFixtureScript.parent.mkdir(parents=True)
			shutil.copyfile(PathScript, PathFixtureScript)
			PathInstalledPackage = PathTemporaryRoot / "installed"
			PathInstalledPackage.mkdir()
			Result = RunPackageVerifier(PathFixtureScript, PathInstalledPackage)
			if (Result.returncode != 1) or ("[verify-package-copy] missing source package:" not in Result.stdout):
				return Fail(f"package freshness must reject a missing source package:\n{Result.stdout}")

			PathSourcePackage = PathTemporaryRoot / "repository" / "packages" / "sourcejs"
			PathSourcePackage.mkdir(parents=True)
			strPackageCode = "module.exports = {};\n"
			(PathSourcePackage / "index.js").write_text(strPackageCode, encoding="utf-8")
			(PathInstalledPackage / "index.js").write_text(strPackageCode, encoding="utf-8")
			Result = RunPackageVerifier(PathFixtureScript, PathInstalledPackage)
			if (Result.returncode != 0) or ("[verify-package-copy] ok:" not in Result.stdout):
				return Fail(f"package freshness must accept a matching source package:\n{Result.stdout}")
	except (OSError, subprocess.TimeoutExpired) as Error:
		return Fail(f"package freshness regression check failed to run: {Error}")

	for PathInstalledPackage in IterateInstalledPackageRoots():
		try:
			Result = RunPackageVerifier(PathScript, PathInstalledPackage)
		except (OSError, subprocess.TimeoutExpired) as Error:
			return Fail(f"installed package freshness check failed to run: {Error}")

		if Result.returncode != 0:
			return Fail(f"installed package copy is stale in {PathInstalledPackage.relative_to(ROOT)}:\n{Result.stdout}")

	return 0

def CheckNoNativeBridge():
	vecRoots = [
		ROOT / "src",
		ROOT / "packages",
		ROOT / "examples",
	]

	for PathRoot in vecRoots:
		for PathFile in PathRoot.rglob("*"):
			if not PathFile.is_file():
				continue

			try:
				strContent = ReadText(PathFile)
			except UnicodeDecodeError:
				continue

			for strPattern in BANNED_CODE_PATTERNS:
				if strPattern in strContent:
					return Fail(f"banned bridge pattern '{strPattern}' found in {PathFile.relative_to(ROOT)}")

	return 0

def CheckNoDirectExportAliases():
	PathPackage = ROOT / "packages" / "sourcejs"
	PatternESMAlias = re.compile(r"\bexport\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*;")
	PatternNamedAlias = re.compile(r"\bexport\s*\{[^}]*\b([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\b[^}]*\}")
	PatternCJSAlias = re.compile(r"^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*;", re.MULTILINE)
	PatternCJSExports = re.compile(r"\bmodule\.exports\s*=\s*\{([\s\S]*?)\n\};")

	for PathFile in PathPackage.rglob("*.js"):
		strContent = ReadText(PathFile)
		for MatchAlias in PatternESMAlias.finditer(strContent):
			if MatchAlias.group(1) != MatchAlias.group(2):
				return Fail(f"direct ESM alias export is forbidden in {PathFile.relative_to(ROOT)}: {MatchAlias.group(1)} = {MatchAlias.group(2)}")

		for MatchAlias in PatternNamedAlias.finditer(strContent):
			if MatchAlias.group(1) != MatchAlias.group(2):
				return Fail(f"named ESM alias export is forbidden in {PathFile.relative_to(ROOT)}: {MatchAlias.group(1)} as {MatchAlias.group(2)}")

	for PathFile in PathPackage.rglob("*.cjs"):
		strContent = ReadText(PathFile)
		setAliases = {
			MatchAlias.group(1)
			for MatchAlias in PatternCJSAlias.finditer(strContent)
			if MatchAlias.group(1) != MatchAlias.group(2)
		}
		if not setAliases:
			continue

		for MatchExports in PatternCJSExports.finditer(strContent):
			strExports = MatchExports.group(1)
			for strAlias in setAliases:
				if re.search(rf"(^|[\s,]){re.escape(strAlias)}\s*,", strExports):
					return Fail(f"direct CJS alias export is forbidden in {PathFile.relative_to(ROOT)}: {strAlias}")

	return 0

def CheckPublicExportsAreCanonical():
	unTimeoutSeconds = 30
	vecFilePaths = [str(PathFile) for PathFile in (ROOT / "packages" / "sourcejs").rglob("*.js")]
	strInspectionScript = """const g_FileSystem = require("fs");
const { CollectCJSObjectExportNames } = require("./tools/inspect_commonjs_exports.js");

const g_vecFilePaths = JSON.parse(g_FileSystem.readFileSync(0, "utf8"));
const g_vecExports = g_vecFilePaths.map(strFilePath => ({ File: strFilePath, ExportNames: CollectCJSObjectExportNames(g_FileSystem.readFileSync(strFilePath, "utf8")) }));

process.stdout.write(JSON.stringify(g_vecExports));
"""

	try:
		Result = subprocess.run(["node", "-e", strInspectionScript], cwd=ROOT, input=json.dumps(vecFilePaths), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=unTimeoutSeconds, check=False)
		if Result.returncode != 0:
			return Fail(f"public package export inspection failed:\n{Result.stderr}")

		vecExports = json.loads(Result.stdout)
	except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as Error:
		return Fail(f"public package export inspection failed to run: {Error}")

	for ExportRecord in vecExports:
		PathFile = Path(ExportRecord["File"])
		for strExportName in ExportRecord["ExportNames"]:
			if strExportName[0].islower():
				return Fail(f"public package export must be canonical PascalCase or constant-case: {PathFile.relative_to(ROOT)} exports {strExportName}")

	return 0

def CheckRequireAliasContract():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")

	for strRequired in [
		'constexpr char kSourceJSPrefix[] = "sourcejs/";',
		'constexpr std::size_t kSourceJSPrefixLength = sizeof(kSourceJSPrefix) - 1;',
		"strModuleName = strModuleName.substr(kSourceJSPrefixLength);",
	]:
		if strRequired not in strBindings:
			return Fail(f"require resolver must keep the explicit SourceJS namespace: {strRequired}")

	for strForbidden in [
		'std::string const strSourcePrefix = "source/";',
		"strSourcePrefix",
		'strModuleName.rfind(strSourcePrefix, 0)',
	]:
		if strForbidden in strBindings:
			return Fail(f"require resolver must not expose source/ as an alias: {strForbidden}")

	return 0

def CheckNoGameSpecificPublicExports():
	vecPackageRoots = [ROOT / "packages" / "sourcejs"]
	for PathParent in [ROOT / "package", ROOT / "artifacts"]:
		if not PathParent.is_dir():
			continue

		for PathPackage in PathParent.glob("*/addons/sourcejs/packages/sourcejs"):
			if PathPackage.is_dir() and (PathPackage not in vecPackageRoots):
				vecPackageRoots.append(PathPackage)

	strExportDeclaration = r"\bexport\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type)\s+{name}\b"
	strNamedExport = r"\bexport\s*\{{[^}}]*\b{name}\b[^}}]*\}}"
	strCJSExport = r"\bmodule\.exports\s*=\s*\{{[\s\S]*?\b{name}\s*[:,][\s\S]*?\n\}};"

	for PathPackage in vecPackageRoots:
		for PathFile in list(PathPackage.rglob("*.js")) + list(PathPackage.rglob("*.cjs")) + list(PathPackage.rglob("*.d.ts")):
			strContent = ReadText(PathFile)
			for strName in BANNED_PUBLIC_EXPORTS:
				vecPatterns = [
					strExportDeclaration.format(name=re.escape(strName)),
					strNamedExport.format(name=re.escape(strName)),
					strCJSExport.format(name=re.escape(strName)),
				]
				for strPattern in vecPatterns:
					if re.search(strPattern, strContent):
						return Fail(f"game-specific public export '{strName}' found in {PathFile.relative_to(ROOT)}")

	return 0

def CheckCPPStyleFloor():
	for PathFile in (ROOT / "src").rglob("*"):
		if PathFile.suffix not in {".cpp", ".h"}:
			continue

		strContent = ReadText(PathFile)
		for MatchAuto in re.finditer(r"\bauto\b", strContent):
			unLineBegin = strContent.rfind("\n", 0, MatchAuto.start()) + 1
			unLineEnd = strContent.find("\n", MatchAuto.end())
			strLine = strContent[unLineBegin:] if unLineEnd < 0 else strContent[unLineBegin:unLineEnd]

			if re.search(r"\bauto\s+(?:(?:const|volatile)\s+)?(?:bool|char|wchar_t|short|unsigned|signed|int|long|float|double|std::size_t|std::int(?:8|16|32|64)_t|std::uint(?:8|16|32|64)_t)\b", strLine):
				return Fail(f"'auto' must not replace an explicit scalar type: {PathFile.relative_to(ROOT)}")

	return 0

def CheckNativeNumericConversionsAreStrict():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	Match = re.search(r"(?:Int32Value|Uint32Value|IntegerValue|NumberValue)\([^;\n]*\)\.FromMaybe\(", strBindings)
	if Match:
		return Fail(f"native numeric V8 conversion must inspect Maybe instead of using a fallback: {Match.group(0)}")

	if "static_cast<void>(bLossless)" in strBindings:
		return Fail("native BigInt conversion must reject lossy V8 results instead of ignoring bLossless")

	for strRequired in [
		"bool GetIntegerFromValue",
		"bool GetUInt64ValueFromValue",
		"bool GetOptionalFilesystemIntegerArgument",
		"bool GetObjectIntegerPropertyForBitBuffers",
		"bool GetTraceTypeFromObject",
		"bool GetTraceMaskFromValue",
		"bool GetOptionalNetChannelIntegerProperty",
		'"colors.CreateRGBAColor(nRedComponent?, nGreenComponent?, nBlueComponent?, nAlphaComponent?) expects color components between 0 and 255."',
		'"bitbuffers.PackUInt32(unUInt32Value) expects an unsigned 32-bit integer."',
		'"engines/trace mask expects an unsigned 32-bit integer."',
		'"netchannel buffer bit counts must be integers."',
	]:
		if strRequired not in strBindings:
			return Fail(f"strict native numeric conversion contract missing: {strRequired}")

	return 0

def CheckPackageManifest():
	try:
		Manifest = json.loads(ReadText(ROOT / "packaging" / "package-manifest.json.in"))
	except (OSError, ValueError) as Error:
		return Fail(f"invalid package manifest template: {Error}")

	if not isinstance(Manifest, dict):
		return Fail("package manifest template must be a JSON object")

	mapExpectedFields = {
		"Version": "@PROJECT_VERSION@",
		"SDKBranch": "@SOURCEJS_SDK_BRANCH@",
		"Platform": "@SOURCEJS_PLATFORM@",
		"Architecture": "@SOURCEJS_ARCH@",
		"Entrypoint": "addons/sourcejs/bin/sourcejs",
	}
	for strField, strVariable in mapExpectedFields.items():
		if Manifest.get(strField) != strVariable:
			return Fail(f"package manifest {strField} must use {strVariable}")

	strVDF = ReadText(ROOT / "packaging" / "sourcejs.vdf")
	vecEntrypoints = re.findall(r'"file"\s+"([^"]+)"', strVDF)
	if vecEntrypoints != [Manifest["Entrypoint"]]:
		return Fail("package VDF and manifest must name the same SourceJS entrypoint")

	return 0

def CheckPackageModules():
	setJSModules = CollectPackageModules(".js")
	setCJSModules = CollectPackageModules(".cjs")
	setDTSModules = CollectPackageModules(".d.ts")

	if setJSModules != EXPECTED_PACKAGE_MODULES:
		return Fail(f"JS package module mismatch: missing={sorted(EXPECTED_PACKAGE_MODULES - setJSModules)} extra={sorted(setJSModules - EXPECTED_PACKAGE_MODULES)}")

	if setCJSModules:
		return Fail(f"obsolete CJS package duplicates remain: {sorted(setCJSModules)}")

	if setDTSModules:
		return Fail(f"obsolete TypeScript declarations remain: {sorted(setDTSModules)}")

	strIndexJS = ReadText(ROOT / "packages" / "sourcejs" / "index.js")
	for strModule in sorted(EXPECTED_PACKAGE_MODULES):
		if not re.search(rf'^\t[A-Z][A-Za-z0-9]*: "{re.escape(strModule)}",$', strIndexJS, re.MULTILINE):
			return Fail(f"index.js does not export {strModule} under a PascalCase name")

	PathPackage = ROOT / "packages" / "sourcejs"
	for PathModule in PathPackage.rglob("*.js"):
		strModuleContent = ReadText(PathModule)

		if re.search(r'require\(\s*["\']\.\.?/', strModuleContent):
			return Fail(f"SourceJS package modules must use absolute module names: {PathModule.relative_to(ROOT)}")

	for strModule in sorted(EXPECTED_PACKAGE_SUBMODULES):
		PathModuleFile = PathPackage / f"{strModule}.js"
		PathModuleIndex = PathPackage / strModule / "index.js"

		if not PathModuleFile.is_file() and not PathModuleIndex.is_file():
			return Fail(f"package submodule does not exist: {strModule}.js or {strModule}/index.js")

	return 0

def CheckCPPModules():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strEngineInterfaces = ReadText(ROOT / "src" / "sourcejs" / "EngineInterfaces.h")
	setInstalledModules = set(re.findall(r'(?m)^\s*(?:(?:if \(!)|(?:static_cast<void>\())?InstallModule\([^\r\n]*,\s*"([^"]+)"', strBindings))
	PathPackage = ROOT / "packages" / "sourcejs"
	setPackageModules = set()
	for PathModule in PathPackage.rglob("*.js"):
		PathModuleRelative = PathModule.relative_to(PathPackage).with_suffix("")
		strModuleName = PathModuleRelative.parent.as_posix() if PathModuleRelative.name == "index" else PathModuleRelative.as_posix()
		setPackageModules.add(strModuleName)

	setMissingModules = EXPECTED_RUNTIME_MODULES - setInstalledModules - setPackageModules
	setUnexpectedNativeModules = setInstalledModules - EXPECTED_RUNTIME_MODULES
	setMissingNativeOnlyModules = SOURCEJS_NATIVE_ONLY_MODULES - setInstalledModules

	if setMissingModules or setUnexpectedNativeModules:
		return Fail(f"V8 runtime module mismatch: missing={sorted(setMissingModules)} unexpected_native={sorted(setUnexpectedNativeModules)}")

	if setMissingNativeOnlyModules:
		return Fail(f"V8 native-only modules are not installed natively: {sorted(setMissingNativeOnlyModules)}")

	for strRequired in [
		'SetRecordProperty(pIsolate, LocalContext, LocalObject, "GameName", MakeString(pIsolate, PathGameRoot.filename().string()))',
		'SetRecordProperty(pIsolate, LocalContext, LocalObject, "SourceEngine", MakeString(pIsolate, "source"))',
		'SetRecordProperty(pIsolate, LocalContext, LocalObject, "SourceEngineBranch", MakeString(pIsolate, SOURCEJS_SDK_BRANCH))',
		"CoreModulesCallback",
		"CorePublicPackagesCallback",
		'SetFunction(pIsolate, LocalContext, LocalCoreModule, "GetModules", GetCoreModulesCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalCoreModule, "GetPublicPackages", GetCorePublicPackagesCallback, LocalRuntimeData)',
	]:
		if strRequired not in strBindings:
			return Fail(f"native core.GetInfo() identity field missing: {strRequired}")

	if "g_Application.GetModuleRegistry().RegisterNativeModule(pszModuleName);" not in strBindings:
		return Fail("successful V8 module installation is not registered dynamically")

	strRegistry = ReadText(ROOT / "src" / "sourcejs" / "ModuleRegistry.cpp")
	MatchPublicPackages = re.search(r'm_vecPublicPackages\s*=\s*\{(.*?)\n\t\t\};', strRegistry, re.DOTALL)
	if not MatchPublicPackages:
		return Fail("ModuleRegistry public package assignment is missing")

	setPublicPackages = set(re.findall(r'"([^"]+)"', MatchPublicPackages.group(1)))
	if setPublicPackages != EXPECTED_PACKAGE_MODULES:
		return Fail(f"ModuleRegistry public package mismatch: missing={sorted(EXPECTED_PACKAGE_MODULES - setPublicPackages)} extra={sorted(setPublicPackages - EXPECTED_PACKAGE_MODULES)}")

	if "void ModuleRegistry::RegisterNativeModule(std::string const& strModuleName)" not in strRegistry:
		return Fail("ModuleRegistry dynamic native registration is missing")

	for strRequired in [
		'#if __has_include("tier1/iconvar.h")',
		'#include "tier1/iconvar.h"',
		'#else\n#include "tier1/convar.h"',
	]:
		if strRequired not in strEngineInterfaces:
			return Fail(f"EngineInterfaces must support SDKs without tier1/iconvar.h: {strRequired}")

	return 0

def BuildNativeConditionalBranchContexts(strBindings):
	vecBranchOffsets = [0]
	vecBranchContexts = [{}]
	vecBranchFrames = []
	PatternDirective = re.compile(r"^[\t ]*#[\t ]*(if|ifdef|ifndef|elif|else|endif)\b[^\n]*", re.MULTILINE)

	for MatchDirective in PatternDirective.finditer(strBindings):
		strDirective = MatchDirective.group(1)
		if strDirective in {"if", "ifdef", "ifndef"}:
			vecBranchFrames.append({"Offset": MatchDirective.start(), "Branch": 0, "HasElse": False})

		elif strDirective in {"elif", "else"}:
			if not vecBranchFrames or vecBranchFrames[-1]["HasElse"]:
				raise ValueError(f"invalid native preprocessor #{strDirective} branch")

			vecBranchFrames[-1]["Branch"] += 1
			vecBranchFrames[-1]["HasElse"] = strDirective == "else"

		else:
			if not vecBranchFrames:
				raise ValueError("unmatched native preprocessor #endif")

			vecBranchFrames.pop()

		vecBranchOffsets.append(MatchDirective.end())
		vecBranchContexts.append({Frame["Offset"]: Frame["Branch"] for Frame in vecBranchFrames})

	if vecBranchFrames:
		raise ValueError("unterminated native preprocessor conditional")

	return vecBranchOffsets, vecBranchContexts

def CanNativeBranchContextsOverlap(mapFirst, mapSecond):
	# Distinct alternatives in one conditional chain cannot execute together.
	return all(mapSecond.get(unOffset, unBranch) == unBranch for unOffset, unBranch in mapFirst.items())

def FindNativeModuleSurfaceIssue(strBindings):
	# Static literal registrations: retain receiver identity and mutually exclusive SDK alternatives.
	PatternModuleStart = re.compile(r'\b(?:v8::Local<v8::Object>(?:\s+const)?|const\s+v8::Local<v8::Object>|auto(?:\s+const)?|const\s+auto)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*MakeModule\(pIsolate\)')
	PatternProperty = re.compile(r'\b(?:SetFunction|SetValue|SetString|SetBoolean|SetInteger|SetNumber)\(\s*[^,\n]+,\s*[^,\n]+,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*"([^"]+)"')
	mapModuleBranches = {}

	try:
		vecBranchOffsets, vecBranchContexts = BuildNativeConditionalBranchContexts(strBindings)
	except ValueError as Error:
		return str(Error)

	def GetBranchContext(unOffset):
		return vecBranchContexts[bisect.bisect_right(vecBranchOffsets, unOffset) - 1]

	for MatchModule in PatternModuleStart.finditer(strBindings):
		strLocalModuleName = MatchModule.group(1)
		PatternInstall = re.compile(rf'\bInstallModule\([^;\n]*?"([^"]+)"\s*,\s*{re.escape(strLocalModuleName)}\)')
		MatchInstall = PatternInstall.search(strBindings, MatchModule.start())
		if not MatchInstall:
			return f"native module object has no matching InstallModule call: {strLocalModuleName}"

		strModuleName = MatchInstall.group(1)
		mapModuleContext = GetBranchContext(MatchModule.start())
		vecPreviousModuleContexts = mapModuleBranches.setdefault(strModuleName, [])
		if any(CanNativeBranchContextsOverlap(mapModuleContext, mapPrevious) for mapPrevious in vecPreviousModuleContexts):
			return f"native module is installed more than once: {strModuleName}"

		vecPreviousModuleContexts.append(mapModuleContext)

		strModuleBody = strBindings[MatchModule.start():MatchInstall.end()]
		mapPropertyBranches = {}

		for MatchProperty in PatternProperty.finditer(strModuleBody):
			if MatchProperty.group(1) != strLocalModuleName:
				continue

			strPropertyName = MatchProperty.group(2)
			mapPropertyContext = GetBranchContext(MatchModule.start() + MatchProperty.start())
			vecPreviousPropertyContexts = mapPropertyBranches.setdefault(strPropertyName, [])
			if any(CanNativeBranchContextsOverlap(mapPropertyContext, mapPrevious) for mapPrevious in vecPreviousPropertyContexts):
				return f"native module property is registered more than once: {strModuleName}.{strPropertyName}"

			vecPreviousPropertyContexts.append(mapPropertyContext)

	if not mapModuleBranches:
		return "native module declarations could not be parsed"

	return None

def CheckNativeModuleSurfaceUniqueness():
	strDeclaration = "v8::Local<v8::Object> const LocalModule = MakeModule(pIsolate);\n"
	strProperty = 'SetFunction(pIsolate, LocalContext, LocalModule, "Value", Callback, LocalData);\n'
	strInstall = 'InstallModule(pIsolate, LocalContext, LocalSourceJS, "fixture", LocalModule);\n'
	strModule = strDeclaration + strProperty + strInstall

	# These lexical fixtures intentionally include duplicate names and malformed directives.
	vecFixtures = [
		("valid declaration", strModule, False),
		("missing declaration", strProperty + strInstall, True),
		("missing installation", strDeclaration + strProperty, True),
		("duplicate property", strDeclaration + strProperty + strProperty + strInstall, True),
		("duplicate module", strModule + strModule, True),
		("alternative modules", "#if FIRST\n" + strModule + "#else\n" + strModule + "#endif\n", False),
		("alternative properties", strDeclaration + "#if FIRST\n" + strProperty + "#else\n" + strProperty + "#endif\n" + strInstall, False),
		("elif properties", strDeclaration + "#if FIRST\n" + strProperty + "#elif SECOND\n" + strProperty + "#else\n" + strProperty + "#endif\n" + strInstall, False),
		("nested alternatives", strDeclaration + "#if FIRST\n#if SECOND\n" + strProperty + "#else\n" + strProperty + "#endif\n#else\n" + strProperty + "#endif\n" + strInstall, False),
		("independent conditionals", strDeclaration + "#if FIRST\n" + strProperty + "#endif\n#if SECOND\n" + strProperty + "#endif\n" + strInstall, True),
		("unconditional duplicate", strDeclaration + "#if FIRST\n" + strProperty + "#endif\n" + strProperty + strInstall, True),
		("nested receiver", strDeclaration + strProperty + strProperty.replace("LocalModule,", "LocalChild,") + strInstall, False),
		("unmatched endif", strModule + "#endif\n", True),
		("unmatched else", strModule + "#else\n", True),
		("unmatched elif", strModule + "#elif FIRST\n", True),
		("unterminated conditional", "#if FIRST\n" + strModule, True),
		("duplicate else", "#if FIRST\n" + strModule + "#else\n#else\n#endif\n", True),
		("elif after else", "#if FIRST\n" + strModule + "#else\n#elif SECOND\n#endif\n", True),
	]
	for strName, strFixture, bExpectedIssue in vecFixtures:
		strIssue = FindNativeModuleSurfaceIssue(strFixture)
		if (strIssue is not None) != bExpectedIssue:
			return Fail(f"native module surface regression failed for {strName}: {strIssue}")

	for strType in ["v8::Local<v8::Object>", "v8::Local<v8::Object> const", "const v8::Local<v8::Object>", "auto", "auto const", "const auto"]:
		strIssue = FindNativeModuleSurfaceIssue(strModule.replace("v8::Local<v8::Object> const", strType))
		if strIssue is not None:
			return Fail(f"native module surface declaration regression failed for {strType}: {strIssue}")

	for strSetter in ["SetFunction", "SetValue", "SetString", "SetBoolean", "SetInteger", "SetNumber"]:
		strDuplicateProperty = strProperty.replace("SetFunction", strSetter)
		strIssue = FindNativeModuleSurfaceIssue(strDeclaration + strProperty + strDuplicateProperty + strInstall)
		if (strIssue is None) or ("property is registered more than once" not in strIssue):
			return Fail(f"native module surface setter regression failed for {strSetter}: {strIssue}")

	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strIssue = FindNativeModuleSurfaceIssue(strBindings)
	if strIssue is not None:
		return Fail(strIssue)

	return 0

def CheckCMakeSources():
	strCMake = ReadText(ROOT / "CMakeLists.txt")
	vecSources = re.findall(r"\bsrc/sourcejs/[^\s)]+", strCMake)
	for strSource in vecSources:
		if not (ROOT / strSource).is_file():
			return Fail(f"CMake source does not exist: {strSource}")

	return 0

def CheckCMakeRequiredLibraries():
	strCMake = ReadText(ROOT / "CMakeLists.txt")
	for strRequired in [
		"find_package(SOCI CONFIG REQUIRED)",
		"find_package(redis++ CONFIG REQUIRED)",
		"find_package(cpr CONFIG REQUIRED)",
		"SOCI::Core",
		"SOCI::SOCI",
		"SOCI::SQLite3",
		"SOCI::MySQL",
		"SOCI::soci_core_static",
		"SOCI::soci_mysql_static",
		"SOCI::soci_sqlite3_static",
		"set(strSourceJSSOCIMySQLTarget",
		"set(strSourceJSSOCISQLiteTarget",
		"if(NOT strSourceJSSOCIMySQLTarget)",
		"if(NOT strSourceJSSOCISQLiteTarget)",
		"required MySQL/MariaDB backend target",
		"required SQLite3 backend target",
		"$<LINK_LIBRARY:WHOLE_ARCHIVE,${strSourceJSSOCIMySQLTarget}>",
		"$<LINK_LIBRARY:WHOLE_ARCHIVE,${strSourceJSSOCISQLiteTarget}>",
		"strSourceJSSQLiteReleaseLibrary",
		"strSourceJSSQLiteDebugLibrary",
		'IMPORTED_LOCATION_RELEASE "${strSourceJSSQLiteReleaseLibrary}"',
		'IMPORTED_LOCATION_DEBUG "${strSourceJSSQLiteDebugLibrary}"',
		"redis++::redis++",
		"cpr::cpr",
		'SourceJSRequireSupportedTarget("${SOURCEJS_SDK_BRANCH}"',
		"target_compile_definitions(sourcejs PRIVATE X64BITS PLATFORM_64BITS)",
		'SHELL:-include algorithm',
		'SHELL:-include \\"${HL2SDK_ROOT}/public/mathlib/mathlib.h\\"',
		'SHELL:-include \\"${HL2SDK_ROOT}/public/tier0/memalloc.h\\"',
		'SourceJSPrepareHL2SDKCXX20Headers(vecSourceJSHL2SDKCXX20IncludeDirectories',
		"foreach(strSourceJSHL2SDKOverlayHeader IN ITEMS utlsymbol.h UtlStringMap.h utlmemory.h)",
		'EXISTS "${CMAKE_CURRENT_BINARY_DIR}/sourcejs-hl2sdk-cxx20/tier1/${strSourceJSHL2SDKOverlayHeader}"',
		'SHELL:-include \\"${CMAKE_CURRENT_BINARY_DIR}/sourcejs-hl2sdk-cxx20/tier1/${strSourceJSHL2SDKOverlayHeader}\\"',
		'SourceJSLinkHL2SDK(sourcejs "${HL2SDK_ROOT}"',
		'if(SOURCEJS_ARCH STREQUAL "x86")',
		"target_compile_options(sourcejs PRIVATE -m32 -msse -msse2 -mfpmath=sse -ftls-model=global-dynamic)",
		"-ftls-model=global-dynamic",
		'set(SOURCEJS_LINUX_LINKER "lld" CACHE STRING',
		"set_property(CACHE SOURCEJS_LINUX_LINKER PROPERTY STRINGS lld bfd)",
		'if(NOT (SOURCEJS_LINUX_LINKER STREQUAL "lld") AND NOT (SOURCEJS_LINUX_LINKER STREQUAL "bfd"))',
		'message(FATAL_ERROR "SOURCEJS_LINUX_LINKER must be lld or bfd.")',
		'target_link_options(sourcejs PRIVATE "-fuse-ld=${SOURCEJS_LINUX_LINKER}" "LINKER:-z,text")',
		"-static-libstdc++",
		"-static-libgcc",
		'-Wl,--version-script=\\"${CMAKE_CURRENT_SOURCE_DIR}/cmake/sourcejs-linux.exports.map\\"',
		"-print-file-name=libatomic.a",
	]:
		if strRequired not in strCMake:
			return Fail(f"mandatory external library contract missing from CMake: {strRequired}")

	for strForbidden in [
		"SOURCEJS_WITH_EXTERNAL_LIBRARIES",
		"Build native SourceJS bindings for SOCI, redis++ and cpr.",
		"SOURCEJS_TIER_COMPAT",
		"HL2SDK_X64_MATHLIB_ROOT",
		"sourcejs_link_hl2sdk_mathlib_x64",
	]:
		if strForbidden in strCMake:
			return Fail(f"external library dependency must not be optional: {strForbidden}")

	strPackageCMake = ReadText(ROOT / "cmake" / "SourceJSPackage.cmake")
	for strRequired in [
		"function(SourceJSRequireNonEmptyList",
		"function(SourceJSLinkExactSharedLibrary",
		'target_link_libraries(${strTargetName} PRIVATE "-Wl,-l:${strLibraryName}")',
		"IMPORTED_NO_SONAME TRUE",
		"SourceJSLinkExactSharedLibrary(${strTargetName}",
		"function(SourceJSPrepareHL2SDKCXX20Headers",
		'return static_cast<UtlSymId_t>( Find( pStr ) ) != UTL_INVAL_SYMBOL;',
		'file(READ "${strSymbolHeader}" strSymbolHeaderContent)',
		'file(WRITE "${strGeneratedIncludeRoot}/tier1/utlsymbol.h"',
		'return static_cast<UtlSymId_t>( m_SymbolTable.Find( pString ) ) != UTL_INVAL_SYMBOL;',
		'file(READ "${strStringMapHeader}" strStringMapHeaderContent)',
		'file(WRITE "${strGeneratedIncludeRoot}/tier1/UtlStringMap.h"',
		'file(READ "${strMemoryHeader}" strMemoryHeaderContent)',
		'string(REPLACE "V_swap( m_" "SOURCEJS_V_SWAP( m_"',
		'string(REPLACE "swap( m_" "V_swap( m_"',
		'string(REPLACE "SOURCEJS_V_SWAP( m_" "V_swap( m_"',
		'file(WRITE "${strGeneratedIncludeRoot}/tier1/utlmemory.h"',
		'file(READ "${strNetworkVariableHeader}" strNetworkVariableHeaderContent)',
		'#define MyOffsetOf(TYPE, VARIABLE) ([]() constexpr -> int {',
		'file(WRITE "${strGeneratedIncludeRoot}/networkvar.h"',
		'file(READ "${strAppSystemHeader}" strAppSystemHeaderContent)',
		'file(WRITE "${strGeneratedIncludeRoot}/appframework/iappsystem.h"',
		"function(SourceJSLinkHL2SDK",
		'"${strHL2SDKRoot}/lib/public/x86"',
		'"${strHL2SDKRoot}/lib/public/x64"',
		'"${strHL2SDKRoot}/lib/public/win64"',
		'"${strHL2SDKRoot}/lib/public/linux32"',
		'"${strHL2SDKRoot}/lib/public/linux64"',
		'"${strLibraryRootCandidate}/tier1_i486.a"',
		'"${strLibraryRootCandidate}/tier0_i486.so"',
		'EXISTS "${strMathLibraryCandidate}" AND EXISTS "${strTier1Candidate}" AND EXISTS "${strTier0Candidate}"',
		"The selected HL2SDK branch does not contain a complete",
		"SourceJSRequireNonEmptyList(vecV8Libraries",
		"Unable to find required",
	]:
		if strRequired not in strPackageCMake:
			return Fail(f"CMake package library guard missing: {strRequired}")

	strBranchesCMake = ReadText(ROOT / "cmake" / "SourceJSBranches.cmake")
	setSource2Branches = {"cs2", "deadlock", "dota"}
	setConfiguredBranches = set(SDK_BRANCHES) | set(SDK_BRANCH_REFS)

	for mapArchitectures in SDK_SUPPORTED_TARGETS.values():
		for setBranches in mapArchitectures.values():
			setConfiguredBranches.update(setBranches)

	setUnexpectedSource2Branches = setConfiguredBranches & setSource2Branches
	if setUnexpectedSource2Branches:
		return Fail(f"Source 2 branches cannot be built as VSP targets: {sorted(setUnexpectedSource2Branches)}")

	for strBranch in sorted(setSource2Branches):
		PathTeamProfile = ROOT / "packaging" / "runtime" / "addons" / "sourcejs" / "data" / "sourcejs" / "teams" / f"{strBranch}.ini"
		if PathTeamProfile.exists():
			return Fail(f"Source 2 runtime profile must not be packaged: {PathTeamProfile.relative_to(ROOT)}")

	for strRequired in [
		"function(SourceJSGetBranchSupportedArchitectures",
		"function(SourceJSRequireSupportedTarget",
		"list(APPEND vecBranchDefinitions GAME_DLL)",
		"if(strSDKBranch IN_LIST vecX86Branches)",
		"if(strSDKBranch IN_LIST vecX64Branches)",
		"does not support ${strPlatform}/${strArchitecture}",
	]:
		if strRequired not in strBranchesCMake:
			return Fail(f"branch-specific SDK architecture guard missing: {strRequired}")

	MatchPlatforms = re.search(r'if\(strPlatform STREQUAL "windows"\)(.*?)elseif\(strPlatform STREQUAL "linux"\)(.*?)else\(\)', strBranchesCMake, re.DOTALL)
	if MatchPlatforms is None:
		return Fail("unable to parse branch-specific SDK architecture policy")

	for strPlatform, strPlatformBlock in zip(["windows", "linux"], MatchPlatforms.groups()):
		for strArchitecture in ["x86", "x64"]:
			MatchBranches = re.search(rf"set\(vec{strArchitecture.capitalize()}Branches(.*?)\)", strPlatformBlock, re.DOTALL)
			if MatchBranches is None:
				return Fail(f"unable to parse {strPlatform}/{strArchitecture} SDK architecture policy")

			setCMakeBranches = set(MatchBranches.group(1).split())
			setExpectedBranches = SDK_SUPPORTED_TARGETS[strPlatform][strArchitecture]
			if setCMakeBranches != setExpectedBranches:
				return Fail(f"CMake and workflow SDK targets differ for {strPlatform}/{strArchitecture}: " f"CMake={sorted(setCMakeBranches)}, expected={sorted(setExpectedBranches)}")

	return 0

def CheckExternalLibraryNativeContract():
	strCMake = ReadText(ROOT / "CMakeLists.txt")
	for strRequired in [
		"set(strSourceJSSOCITarget",
		"set(vecSourceJSSOCIBackendTargets",
		"set(strSourceJSRedisTarget",
		"set(strSourceJSCPRTarget",
		"${strSourceJSSOCITarget}",
		"${strSourceJSSOCIMySQLTarget}",
		"${strSourceJSSOCISQLiteTarget}",
		"${vecSourceJSSOCIBackendTargets}",
		"${strSourceJSRedisTarget}",
		"${strSourceJSCPRTarget}",
	]:
		if strRequired not in strCMake:
			return Fail(f"mandatory external library link contract missing: {strRequired}")

	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strRequired in [
		'"GetGlobalVariables", GetGlobalVariablesCallback',
		'"GetMaximumClients", GetEngineServerMaximumClientsCallback',
		'"GetMaximumEntities", GetEngineServerMaximumEntitiesCallback',
		'"GetServerCount", GetEngineServerCountCallback',
		'"GetServerTime", GetEngineServerTimeCallback',
		'"GetServerTick", GetEngineServerTickCallback',
		'"GetServerTickInterval", GetEngineServerTickIntervalCallback',
		'"GetMapName", GetEngineServerMapNameCallback',
	]:
		if strRequired not in strModuleBindings:
			return Fail(f"strict engines/server state binding missing from ModuleBindings.cpp: {strRequired}")

	strRegistry = ReadText(ROOT / "src" / "sourcejs" / "ModuleRegistry.cpp")
	MatchPublicPackages = re.search(r'm_vecPublicPackages\s*=\s*\{(.*?)\n\t\t\};', strRegistry, re.DOTALL)
	if not MatchPublicPackages:
		return Fail("ModuleRegistry external module contract could not parse public packages")

	strPublicPackages = MatchPublicPackages.group(1)

	for strName in ["cpr", "redis", "socket", "soci"]:
		strInstallCall = f'InstallModule(pIsolate, LocalContext, LocalSourceJS, "{strName}",'
		if strInstallCall not in strModuleBindings:
			return Fail(f"{strName} must be installed as a native-only runtime module")

		if f'"{strName}"' in strPublicPackages:
			return Fail(f"{strName} must not be listed as a public JS package")

	PathPackage = ROOT / "packages" / "sourcejs"
	for strName in ["cpr", "redis", "socket", "soci"]:
		for strExtension in [".js", ".cjs", ".d.ts"]:
			if (PathPackage / f"{strName}{strExtension}").exists():
				return Fail(f"external module must be native-only, not a JS package: {strName}{strExtension}")

		if (PathPackage / strName).exists():
			return Fail(f"external module must be native-only, not a JS package directory: {strName}")

	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strBindingsHeader = strBindings.split("\nnamespace {", 1)[0]
	vecPredictionMacroNames = ["PC_EVERYTHING", "PC_NON_NETWORKED_ONLY", "PC_NETWORKED_ONLY"]
	vecPredictionMacroBlocks = re.findall(r'#pragma push_macro\("PC_EVERYTHING"\)[\s\S]*?#pragma pop_macro\("PC_EVERYTHING"\)', strBindingsHeader)
	if len(vecPredictionMacroBlocks) != 2:
		return Fail("native SDK prediction includes must preserve caller macros in both configuration blocks")

	vecPredictionSetupLines = [f'#pragma push_macro("{strName}")' for strName in vecPredictionMacroNames]
	vecPredictionSetupLines += [f"#undef {strName}" for strName in vecPredictionMacroNames]
	vecPredictionSetupLines += [f"#define {strName} SOURCEJS_PREDICTION_{strName}" for strName in vecPredictionMacroNames]
	vecPredictionCleanupLines = [f"#undef {strName}" for strName in vecPredictionMacroNames]
	vecPredictionCleanupLines += [f'#pragma pop_macro("{strName}")' for strName in reversed(vecPredictionMacroNames)]

	for strPredictionBlock in vecPredictionMacroBlocks:
		vecPredictionDirectives = [strLine.strip() for strLine in strPredictionBlock.splitlines() if strLine.strip().startswith(("#pragma", "#undef", "#define"))]
		if vecPredictionDirectives != vecPredictionSetupLines + vecPredictionCleanupLines:
			return Fail("native SDK prediction includes must save, remap, and restore each caller macro in order")

	strPluginDeclaration = "extern CSourceJSPlugin g_SourceJSPlugin;"
	strPluginHeader = ReadText(ROOT / "src" / "sourcejs" / "SourceJSPlugin.h")
	if (strPluginHeader.count(strPluginDeclaration) != 1) or (strPluginDeclaration in strBindingsHeader):
		return Fail("the engine callback singleton must have one public SourceJSPlugin.h declaration, not a binding-local declaration")

	strContractBindings = re.sub(r"^\t+", "", strBindings, flags=re.MULTILINE)
	for strRequired in [
		"#include <cpr/cpr.h>",
		"#include <soci/soci.h>",
		"#include <soci/mysql/soci-mysql.h>",
		"#include <soci/sqlite3/soci-sqlite3.h>",
		"#include <sw/redis++/redis++.h>",
		"#include <winsock2.h>",
		"#include <sys/socket.h>",
		'v8::Local<v8::Object> const LocalSOCIModule = MakeModule(pIsolate);',
		'v8::Local<v8::Object> const LocalRedisModule = MakeModule(pIsolate);',
		'v8::Local<v8::Object> const LocalCPRModule = MakeModule(pIsolate);',
		'v8::Local<v8::Object> const LocalSocketModule = MakeModule(pIsolate);',
		'InstallModule(pIsolate, LocalContext, LocalSourceJS, "soci", LocalSOCIModule)',
		'InstallModule(pIsolate, LocalContext, LocalSourceJS, "redis", LocalRedisModule)',
		'InstallModule(pIsolate, LocalContext, LocalSourceJS, "cpr", LocalCPRModule)',
		'InstallModule(pIsolate, LocalContext, LocalSourceJS, "socket", LocalSocketModule)',
		"std::unique_ptr<soci::session>",
		"RegisterRequiredSOCIBackends",
		"soci::register_factory_mysql();",
		"soci::register_factory_sqlite3();",
		"std::shared_ptr<sw::redis::Redis>",
		"sw::redis::ReplyUPtr",
		"MakeRedisReplyValue",
		"bool ParseAsyncRequestExecutionMode(",
		"bool ParseRedisRequestExecutionMode(",
		"cpr::Response",
		"cpr::Session",
		"cpr requests require exactly an options object and a callback.",
		"socket.Connect(strHost, nPort, Options, Callback)",
		"socket.Close(ConnectionReference, Options, Callback)",
		"socket.Send(ConnectionReference, ByteSource, Options, Callback)",
		"socket.Receive(ConnectionReference, nMaximumByteCount, Options, Callback)",
		"socket.CancelRequest(nRequestHandle)",
		"LocalDataValue->IsArray()",
		"LocalDataValue->IsArrayBufferView()",
		"LocalDataValue->IsArrayBuffer()",
		"static_cast<std::uint8_t>(dblByteValue)",
		"LockSocketDirection(SocketConnectionRecordOwner->m_SendMutex, Request)",
		"LockSocketDirection(SocketConnectionRecordOwner->m_ReceiveMutex, Request)",
		"MakeFilesystemByteArrayValue(pResultIsolate, vecReceivedBytes.data(), vecReceivedBytes.size())",
		"ShutdownNativeSocket(hSocket)",
		"bool ParseRequiredExternalStringArgument",
		"!LocalExternalStringValue->IsString()",
		"bool ParseExternalStringFromValue",
		"if (IsValueNullish(LocalExternalStringValue))",
		"bool ParseOptionalExternalStringArgument",
		"bool ParseOptionalExternalStringProperty",
		"bool ParseOptionalExternalBooleanProperty",
		"bool ParseExternalInt32FromValue",
		"bool ParseOptionalExternalInt32Property",
		"bool ParseOptionalExternalStringMapProperty",
		"v8::Local<v8::Value> MakeExternalInt64Value",
		"bool ParseSOCIParametersFromValue",
		"bool ParseExternalStringVectorFromValue",
		"bool ParseExternalStringMapFromValue",
		"!std::isfinite(dblExternalInt32Value) || (std::floor(dblExternalInt32Value) != dblExternalInt32Value) || (dblExternalInt32Value < static_cast<double>(std::numeric_limits<int>::min())) || (dblExternalInt32Value > static_cast<double>(std::numeric_limits<int>::max()))",
		"SOCIStatement.exchange(soci::use(Value, Parameter.m_Indicator, Parameter.m_strName))",
		"SOCIStatement.exchange(soci::use(Value, Parameter.m_Indicator))",
		"SOCISessionRecordOwner->m_pSession->get_backend_name()",
		"SOCISessionRecordOwner->m_pSession->get_last_insert_id(strSOCITableName, nSOCILastInsertID)",
		"SOCISessionRecordOwner->m_pSession->get_next_sequence_value(strSOCISequenceName, nSOCINextSequenceValue)",
		"ParseRequiredExternalStringArgument(RedisConnectCallbackInformation",
		"ParseRedisCommandArguments(RedisCommandCallbackInformation, nCommandArgumentEndExclusive, vecRedisCommandParts)",
		"ParseOptionalExternalStringArgument(RedisPingCallbackInformation",
		"ParseRequiredExternalStringArgument(RedisGetCallbackInformation",
		"ParseRequiredExternalStringArgument(RedisSetCallbackInformation",
		"ParseExternalInt32FromValue(pIsolate, LocalRedisExpirationSecondsValue",
		"ParseRequiredExternalStringArgument(RedisHashGetCallbackInformation",
		"ParseRequiredExternalStringArgument(RedisHashSetCallbackInformation",
		"pRedisClient->mget(vecRedisKeys.begin(), vecRedisKeys.end(), std::back_inserter(vecOptionalRedisStringValues))",
		"pRedisClient->mset(mapRedisStringValues.begin(), mapRedisStringValues.end())",
		"pRedisClient->hgetall(strRedisKey, std::inserter(umapRedisHashFields, umapRedisHashFields.end()))",
		"pRedisClient->lrange(strRedisKey",
		"pRedisClient->smembers(strRedisKey, std::back_inserter(vecRedisSetMembers))",
		"pRedisClient->publish(strRedisChannel, strRedisMessage)",
		"ParseHTTPRequestOptions",
		"ParseOptionalHTTPRequestBodyProperty",
		"ParseOptionalExternalStringProperty",
		"ParseOptionalExternalInt32Property",
		"ParseOptionalExternalBooleanProperty",
		"ParseOptionalExternalStringMapProperty",
		"RequestSession.SetParameters(RequestParameters)",
		"RequestSession.SetCookies(RequestCookies)",
		"RequestSession.SetRedirect(RequestRedirect)",
		"RequestSession.SetAuth(cpr::Authentication",
		"RequestSession.SetBearer(cpr::Bearer",
		"MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.downloaded_bytes))",
		"static_cast<int>(HTTPResponse.error.code)",
		"if (!LocalHTTPRequestValue->IsObject() || LocalHTTPRequestValue->IsArray()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, HTTPFailure, kInvalidHTTPRequestErrorMessage);\n\t\t\t\treturn false;\n\t\t\t}",
	]:
		if re.sub(r"^\t+", "", strRequired, flags=re.MULTILINE) not in strContractBindings:
			return Fail(f"native external library binding contract missing: {strRequired}")

	strV8Runtime = ReadText(ROOT / "src" / "sourcejs" / "V8Runtime.cpp")
	for strRequired in [
		"std::thread(&V8Runtime::RunAsyncRequest, this, pRequestRecord)",
		"std::thread RequestThread([Task, &RequestResult]()",
		"RequestThread.join()",
		"bool V8Runtime::RunBlockingRequest(",
		"void V8Runtime::ProcessAsyncRequests()",
		"void V8Runtime::RunAsyncRequest(",
		"m_pLastAsyncCompletion->m_pNextCompletion = pRequestRecord",
		"constexpr int kCallbackArgumentCount = 2;",
		"LocalCallbackFunction->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments)",
	]:
		if strRequired not in strV8Runtime:
			return Fail(f"asynchronous external request execution contract missing: {strRequired}")

	MatchExternalBindings = re.search(r"^\t{1,2}int AllocateExternalHandle\(\) \{[\s\S]*?(?=^\t{1,2}bool InstallPathConstants\()", strBindings, re.MULTILINE)
	if not MatchExternalBindings:
		return Fail("native external library callback block could not be parsed")

	# Check the complete external-resource section, independently of namespace indentation.
	strExternalBindings = re.sub(r"^\t+", "", MatchExternalBindings.group(0), flags=re.MULTILINE)
	for strForbidden in [
		'std::string const strQuery = Args.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "";',
		'pRedis->get(Args.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "")',
		'pRedis->set(Args.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "", Args.Length() > 2 ? ValueToString(pIsolate, Args[2]) : "")',
		'pRedis->del(Args.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "")',
		'pRedis->exists(Args.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "")',
		'pRedis->incr(Args.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "")',
		'pRedis->expire(Args.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "", nSeconds)',
		'pRedis->hget(\n\t\t\t\tArgs.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "",',
		'pRedis->hset(\n\t\t\t\tArgs.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "",',
		'Args[2]->Int32Value(pIsolate->GetCurrentContext()).FromMaybe(0)',
		'GetObjectInteger(pIsolate, LocalContext, LocalOptions, "timeout", Options.nTimeout)',
		'std::string const strBackend = Args.Length() > 1 && !Args[1]->IsNullOrUndefined() ? ValueToString(pIsolate, Args[1]) : "";',
		'std::string const strMessage = Args.Length() > 1 ? ValueToString(pIsolate, Args[1]) : "";',
		"vecCommand.push_back(ValueToString(pIsolate, LocalValue));",
		"vecCommand.push_back(ValueToString(pIsolate, Args[nIndex]));",
		"mapValues[ValueToString(pIsolate, LocalName)] = ValueToString(pIsolate, LocalEntryValue);",
		'GetObjectString(pIsolate, LocalContext, LocalOptions, "method", Options.strMethod)',
		'GetObjectString(pIsolate, LocalContext, LocalOptions, "url", Options.strUrl)',
		'GetObjectString(pIsolate, LocalContext, LocalOptions, "body", Options.strBody)',
		'GetObjectBoolean(pIsolate, LocalContext, LocalOptions, "verifySsl", Options.bVerifySsl)',
		'ObjectStringMap(pIsolate, LocalContext, LocalOptions, "headers", Options.mapHeaders)',
	]:
		if re.sub(r"^\t+", "", strForbidden, flags=re.MULTILINE) in strExternalBindings:
			return Fail(f"native external library binding must not silently substitute missing strings: {strForbidden}")

	mapModuleFunctions = {
		"soci": ("LocalSOCIModule", ["Connect", "Close", "Execute", "Query", "GetBackendName", "LastInsertId", "GetNextSequenceValue", "Begin", "Commit", "Rollback", "Reconnect", "IsConnected"]),
		"redis": ("LocalRedisModule", ["close", "command", "connect", "dbsize", "decr", "del", "exists", "expire", "get", "hdel", "hexists", "hget", "hgetall", "hlen", "hset", "incr", "incrby", "keys", "lpop", "lpush", "lrange", "mget", "mset", "persist", "ping", "publish", "rpop", "rpush", "sadd", "set", "smembers", "srem", "ttl", "type"]),
		"cpr": ("LocalCPRModule", ["Request", "Get", "Post", "Put", "Patch", "Delete", "Head", "Options"]),
		"socket": ("LocalSocketModule", ["Connect", "Close", "Send", "Receive", "CancelRequest"]),
	}
	for strModule, (strLocalModule, vecFunctions) in mapModuleFunctions.items():
		for strFunction in vecFunctions:
			if f'SetFunction(pIsolate, LocalContext, {strLocalModule}, "{strFunction}"' not in strBindings:
				return Fail(f"native external module function missing: {strModule}.{strFunction}")

	nPackageIndex = strBindings.find("pRuntime->RequirePackageModule(strModuleName, LocalModule)")
	nNativeIndex = strBindings.find("LocalSourceJS->Get(LocalContext, LocalModuleName)")
	if (nPackageIndex < 0) or (nNativeIndex < 0) or (nPackageIndex > nNativeIndex):
		return Fail("require() must fall through from package modules to native sourcejs modules.")

	return 0

def CheckExternalLibrariesExampleSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_api_external_libraries.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as Error:
		return Fail(f"external libraries example smoke failed to run: {Error}")

	if ProcessResult.returncode != 0:
		return Fail(f"external libraries example smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckMemoryHookPayloadContract():
	strMemoryHookManager = ReadText(ROOT / "src" / "sourcejs" / "MemoryHookManager.cpp")
	if "NoopCallback" in strMemoryHookManager:
		return Fail("MemoryHookManager must not expose no-op hook payload callbacks")

	if "memory hook payload." in strMemoryHookManager:
		return Fail("MemoryHookManager diagnostics must use the PascalCase Payload object name")

	for strForbidden in [
		"FromMaybe(0)",
		"FromMaybe(-1)",
	]:
		if strForbidden in strMemoryHookManager:
			return Fail(f"MemoryHookManager must reject invalid conversions instead of using {strForbidden}")

	for strRequired in [
		"bool ReadNumberFromValue(v8::Isolate* const pIsolate",
		"bool ReadInt32FromValue(v8::Isolate* const pIsolate",
		"bool ReadAddressFromValue(v8::Isolate* const pIsolate",
		"Expected an address as a JavaScript BigInt.",
		"if (ArgumentType == DATA_TYPE_FLOAT) {\n\t\t\t\t\t\t\tdouble dblArgumentValue = 0.0;\n\t\t\t\t\t\t\tif (!ReadNumberFromValue(pIsolate, LocalContext, LocalTypedArgument, nullptr, dblArgumentValue))",
		"if (ArgumentType == DATA_TYPE_DOUBLE) {\n\t\t\t\t\t\t\tdouble dblArgumentValue = 0.0;\n\t\t\t\t\t\t\tif (!ReadNumberFromValue(pIsolate, LocalContext, LocalTypedArgument, nullptr, dblArgumentValue))",
		"if (!ReadMemoryHookValue(pIsolate, [LocalContext, LocalValue, &dblValue] {",
		"memory/hooks.CallFunction(Options) expects finite typed float arguments to fit a native float.",
		"memory/hooks.CallFunction(Options) expects Options.Convention to be cdecl, stdcall, thiscall, or fastcall.",
		"memory/hooks.CallFunction(Options) expects Options.Arguments to be an array.",
		"memory/hooks.CallFunction(Options) does not accept void arguments.",
		"NativeCallArgumentKind::Float",
		"NativeCallArgumentKind::Double",
		"NativeCallArgumentKind::WideInteger",
		"memory hook Payload.CallHookTrampoline() expects an options object.",
		"memory hook Payload.CallHookTrampoline() expects Options.Arguments to be an array.",
		"memory hook Payload.CallHookTrampoline() expects Options.Registers to be an object.",
		"pCallContext->m_pHookRecord->m_pHook->GetTrampoline()",
		'SetBoolean(pIsolate, LocalContext, LocalOptions, "ReturnContext", true)',
		'SetFunction(pIsolate, LocalContext, LocalPayload, "CallHookTrampoline", CallHookTrampolineCallback',
		"memory hook Payload.SetHookArgument() expects an int32 argument index.",
		"memory hook Payload.SetHookArgument() expects a numeric float/double value.",
		"memory hook Payload.SetHookReturnValue() expects a numeric float value.",
		"memory hook Payload.SetHookReturnValue() expects a numeric double value.",
		'SetFunction(pIsolate, LocalContext, LocalPayload, "SetHookArgument", SetHookArgumentCallback',
	]:
		if strRequired not in strMemoryHookManager:
			return Fail(f"MemoryHookManager payload contract missing: {strRequired}")

	for strForbidden in [
		"ValueToAddress",
		"addressString",
		'"pointer"',
		'"args"',
		'"captureRegisters"',
		'"setArg"',
		'"skip"',
		'"skipOriginal"',
		"PostSetArgumentUnsupportedCallback",
		"PostSkipUnsupportedCallback",
	]:
		if strForbidden in strMemoryHookManager:
			return Fail(f"MemoryHookManager must not expose obsolete payload compatibility: {strForbidden}")

	return 0

def CheckUnusedNativeFunctionsRemoved():
	strMemoryHookManager = ReadText(ROOT / "src" / "sourcejs" / "MemoryHookManager.cpp")
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")

	for strObsoleteDefinition in [
		"static v8::Local<v8::String> MakeString(v8::Isolate* const pIsolate, std::string const& strValue)",
		"static bool ValueIsNullish(v8::Local<v8::Value> LocalValue)",
	]:
		if strObsoleteDefinition in strMemoryHookManager:
			return Fail(f"unused MemoryHookManager function remains: {strObsoleteDefinition}")

	for strObsoleteDefinition in [
		"static void PhysicsMakeAngleObject(",
		"static bool MemoryHelpersNormalizeConventionName(",
		"static INetChannelInfo* RequireNetChannelInfoFromPlayerIndex(",
		"static void EntitiesByIndexCallback(",
		"static void PlayersByIndexCallback(",
		"static bool EntityBaseHandleFromBaseEntityAddress(",
		"static bool EntityBaseHandleFromIntHandleValue(",
		"static std::string AddressToString(",
		"static void ScheduleEntityInput(int const nEntityIndex, std::string const& strInputName",
		"static void NativeObjectBooleanFieldCallback(",
		"static void NativeObjectStringFieldCallback(",
		"static void NativeObjectNumberFieldCallback(",
		"static void ModuleObjectNumberConstantCallback(",
		"static void ModuleStringConstantCallback(",
		"static bool GetObjectBoolean(",
		"static std::string ConstantPropertyNameFromArguments(",
		"static v8::Local<v8::Object> NativeObjectFieldFromArguments(",
	]:
		if strObsoleteDefinition in strModuleBindings:
			return Fail(f"unused ModuleBindings function remains: {strObsoleteDefinition}")

	for strRequiredGuard in [
		"#if defined(DETOURS_ARCH_X64)\n\t\tvoid AppendU64LE(",
	]:
		if strRequiredGuard not in strMemoryHookManager:
			return Fail(f"architecture-specific MemoryHookManager function is not guarded: {strRequiredGuard}")

	for strRequiredGuard in [
		"#if defined(ENGINE_CSGO)\n\n#if defined(SOURCEJS_HAS_SENDPROPS)\n\t\tvoid GetCSGOEntityItemDefinitionIndexCallback(",
		"\n\t\tvoid SetCSGOEntityItemDefinitionIndexCallback(",
		"#endif // defined(SOURCEJS_HAS_SENDPROPS)\n\n\t\tvoid GetCSGOItemDefinitionIndexCallback(",
		"\n\t\tvoid SetCSGOItemDefinitionIndexCallback(",
	]:
		if strRequiredGuard not in strModuleBindings:
			return Fail(f"game-specific ModuleBindings functions are not guarded: {strRequiredGuard}")

	return 0

def CheckMemoryHelpersNativeErrors():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nMemoryHelpersBegin = strBindings.find("bool NormalizeMemoryDataTypeName(")
	nMemoryHelpersEnd = strBindings.find("bool InstallMemoryHelpersFunctions(", nMemoryHelpersBegin)
	if (nMemoryHelpersBegin < 0) or (nMemoryHelpersEnd < 0):
		return Fail("native memory/helpers callback block could not be parsed")

	strMemoryHelpersBlock = strBindings[nMemoryHelpersBegin:nMemoryHelpersEnd]

	for strRequired in [
		"bool NormalizeMemoryDataTypeName(std::string const& strDataTypeName, std::string& strNormalizedDataTypeNameOut)",
		"bool RequireMemoryUnsignedIntegerFromValue(v8::Isolate* const pIsolate",
		"bool RequireMemoryUInt64FromValue(v8::Isolate* const pIsolate",
		"bool RequireMemoryAddressFromValue(v8::Isolate* const pIsolate",
		"bool RequireMemorySignedIntegerFromValue(v8::Isolate* const pIsolate",
		"bool RequireMemoryInt32InRangeFromValue(v8::Isolate* const pIsolate",
		"bool RequireMemoryFiniteNumberFromValue(v8::Isolate* const pIsolate",
		"memory/helpers.GetAddress(unAddress?) expects a non-negative BigInt address.",
		"memory/helpers.Add(unBaseAddress, nByteOffset?) expects a BigInt offset.",
		"memory/helpers.Compare(unLeftAddress, unRightAddress, unByteSize) expects non-null addresses.",
		"memory/helpers.SearchBytes(unAddress, BytePattern, unByteSize) expects byte values between 0 and 255.",
		"memory/helpers.SetProtection(unAddress, unByteSize, Protection) expects a known protection mode.",
		"memory/helpers.Read(unBaseAddress, strDataTypeName?, nByteOffset?) expects a known data type.",
		"memory/helpers.Write(unBaseAddress, strDataTypeName, Data, nByteOffset?) cannot write this data type directly.",
		"memory/helpers.Write(unBaseAddress, strDataTypeName, Data, nByteOffset?) address data expects a non-negative BigInt address.",
		"memory/helpers.GetVirtualFunction(unObjectAddress, nVirtualFunctionIndex) expects an integer virtual function index.",
		"LocalAddressValue.IsEmpty() || !LocalAddressValue->IsBigInt()",
		"LocalAddressBigInteger->Uint64Value(&bAddressConversionLossless)",
		"!bAddressConversionLossless || (unAddressValue > static_cast<std::uint64_t>(std::numeric_limits<std::uintptr_t>::max()))",
	]:
		if strRequired not in strMemoryHelpersBlock:
			return Fail(f"strict native memory/helpers binding missing: {strRequired}")

	for strForbidden in [
		"static bool MemoryHelpersAddressFromArgs(v8::FunctionCallbackInfo<v8::Value> const& Args, std::uintptr_t& unAddress)",
		"static bool MemoryHelpersSizeArgument(v8::FunctionCallbackInfo<v8::Value> const& Args, int const nIndex, std::size_t& unSize)",
		"static std::int64_t MemoryHelpersSignedIntegerFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> LocalContext, v8::Local<v8::Value> LocalValue) {",
		"NumberValue(LocalContext).FromMaybe(0)",
		"NumberValue(LocalContext).FromMaybe(0.0)",
		"Int32Value(LocalContext).FromMaybe(0)",
		"Uint32Value(LocalContext).FromMaybe(0)",
		"IntegerValue(LocalContext).FromMaybe(0)",
		"IntegerValue(LocalContext).FromMaybe(-1)",
		"return \"address\";\n\t}",
		"return \"cdecl\";\n\t}",
		"if (!MemoryHelpersAddressFromArgs(Args, unAddress)) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null",
		"if (Args.Length() < 3 || !EntityUnsignedFromValue",
		"if (Args.Length() < 2 || !MemoryHelpersAddressFromArgs(Args, unAddress)",
		"LocalEntry->Uint32Value(LocalContext).FromMaybe(0)",
		"MemoryHelpersProtectionFromValue(pIsolate, LocalContext, Args[2]);",
	]:
		if strForbidden in strMemoryHelpersBlock:
			return Fail(f"native memory/helpers binding must reject invalid input instead of using fallback: {strForbidden.splitlines()[0]}")

	return 0

def CheckMemoryManagerNativeErrors():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nMemoryManagerBegin = strBindings.find("struct MemoryManagerPatternByte")
	nMemoryManagerEnd = strBindings.find("struct TranslationLanguageState", nMemoryManagerBegin)
	if (nMemoryManagerBegin < 0) or (nMemoryManagerEnd < 0):
		return Fail("native memory/manager callback block could not be parsed")

	strMemoryManagerBlock = strBindings[nMemoryManagerBegin:nMemoryManagerEnd]

	for strRequired in [
		"bool RequireMemoryManagerStringArgument(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation",
		"bool GetOptionalMemoryManagerStringArgument(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation",
		"enum class MemoryManagerIntegerResult",
		"MemoryManagerIntegerResult::Missing",
		"MemoryManagerIntegerResult::Error",
		"memory/manager.LoadGameDataFile(strGameDataFileName) expects a non-empty game data file name.",
		"memory/manager.LoadGameDataFile(strGameDataFile) failed to read game data file:",
		"memory/manager.LoadGameDataFile(strGameDataFile) failed to parse JSON game data file:",
		"memory/manager.GetGameDataValue(strGameDataFileName, strPropertyPath?) expects path to be a string.",
		"memory/manager.SelectRuntimeValue(Value) expects a value.",
		"memory/manager.GetGameDataOffset(strGameDataFileName, strOffsetName) resolved offset must be an integer.",
		"memory/manager.ScanBinary(strModuleName, strBytePattern) expects a valid byte pattern.",
		"memory/manager.GetBinarySymbol(strModuleName, strSymbolName) expects a non-empty symbol name.",
		"memory/manager.ResolveBinaryIdentifier(strModuleName, Identifier) expects an identifier.",
		"memory/manager.ResolveBinaryIdentifier(strModuleName, Identifier) expects a BigInt address, signature, symbol, or game data record.",
		"memory/manager.GetGameDataAddress(strGameDataFileName, strEntryName) expects a non-empty game data file name.",
		"memory/manager.GetGameDataAddress(strGameDataFileName, strEntryName) expects a non-empty signature or function name.",
		"memory/manager game data record address expects a BigInt address.",
		"memory/manager game data record Add expects an integer offset.",
		'constexpr char const* const kAddressPropertyName = "Address";',
		"v8::BigInt::NewFromUnsigned",
		'DefineFunction("GetGameDataAddress", GetGameDataAddressCallback)',
		"return {};",
	]:
		if strRequired not in strMemoryManagerBlock:
			return Fail(f"strict native memory/manager binding missing: {strRequired}")

	for strForbidden in [
		'memory/manager.Load(file)',
		'memory/manager.Get(file, path?)',
		'memory/manager.Select(value)',
		'memory/manager.GetOffset(file, name)',
		'memory/manager.GetSignature(file, name)',
		'memory/manager.GetAddress(file, name)',
		'memory/manager.Scan(module, pattern)',
		'memory/manager.GetSymbol(module, name)',
		'memory/manager.Resolve(module, identifier)',
		'memory/manager.GetOptions(file, name)',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetRootPath",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetDataRootPath",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetFiles",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "Load",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "Get",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "Select",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetOffset",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetSignature",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetAddress",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "Scan",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetSymbol",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "Resolve",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetBinaries",',
		'SetFunction(pIsolate, LocalContext, LocalObject, "GetOptions",',
		"nOut = LocalSelected->Int32Value(LocalContext).FromMaybe(0);",
		"std::string const strFile = Args.Length() > 0 ? ValueToString(pIsolate, Args[0]) : \"\";",
		"std::string const strName = Args.Length() > 0 ? ValueToString(Args.GetIsolate(), Args[0]) : \"\";",
		"if (Args.Length() < 2) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\treturn;\n\t\t}\n\n\t\tv8::Local<v8::Value> LocalRecord;",
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate));\n\t\t\treturn;\n\t\t}\n\n\t\tArgs.GetReturnValue().Set(MemoryManagerSelectValue",
		"if (!MemoryManagerGetSelectedInteger(pIsolate, LocalContext, LocalRecord, nOffset))",
		"MemoryManagerGetSelectedString(pIsolate, LocalContext, LocalSymbol, strSymbol)",
		"MemoryManagerGetSelectedString(pIsolate, LocalContext, LocalPattern, strPattern)",
		"GetMemoryManagerProperty(pIsolate, LocalContext, LocalRecordObject, \"address\", LocalAddressValue)",
		"GetMemoryManagerProperty(pIsolate, LocalContext, LocalRecordObject, \"add\", LocalAdditionValue)",
		"return v8::Local<v8::Value>();",
		'SetValue(pIsolate, LocalContext, LocalOptions, "address"',
		'SetFunction(pIsolate, LocalContext, LocalObject, "address"',
		'SetFunction(pIsolate, LocalContext, LocalObject, "findSignature"',
		'SetFunction(pIsolate, LocalContext, LocalObject, "findSymbol"',
	]:
		if strForbidden in strMemoryManagerBlock:
			return Fail(f"native memory/manager binding must reject invalid input instead of using fallback: {strForbidden.splitlines()[0]}")

	return 0

def CheckMemoryManagerSourceModGameData():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strManagerPackage = ReadText(ROOT / "packages" / "sourcejs" / "memory" / "manager.js")
	strMemoryManagerDocumentation = ReadText(ROOT / "docs" / "api" / "memory-manager.md")
	strMemoryManagerSmoke = ReadText(ROOT / "tools" / "smoke_memory_mathlib.js")
	for strRequired in [
		"GetAddonRootPath() / kGameDataDirectoryName",
		"std::filesystem::path(kSDKToolsGameDataDirectoryName) / pszGameDataFileName",
		"GetSourceModGameDataRoot(PathGameDataRoot)",
		"strPlatformArchitectureKey",
		'GetMemoryManagerProperty(pIsolate, LocalContext, LocalRecordObject, "library", LocalModuleValue)',
		"kSymbolPrefixCharacter = '@'",
		"strBytePattern.front() == kSymbolPrefixCharacter",
	]:
		if strRequired not in strBindings:
			return Fail(f"SourceMod GameData native contract missing: {strRequired}")

	for strRequired in [
		'const { KeyValues } = require("keyvalues");',
		'strFilePath.toLowerCase().endsWith(".txt")',
		"function StripSourceModComments(strFileText)",
		"strFileText.charCodeAt(0) === 0xFEFF",
		'(strCharacter === "/") && (strNextCharacter === "*")',
		'if (strCharacter === ";")',
		"const strSource = StripSourceModComments(strFileText);",
		"const SourceNames = ReadSourceModKeyNames(strSource);",
		"KeyValues.CreateKeyValuesFromBuffer(strSource, false)",
		"RestoreSourceModKeyNames(NativeValue, SourceNames.Children)",
		"KeyValuesInstance.ConvertKeyValuesToObject(true)",
		"KeyValuesInstance.Name",
		"KeyValuesInstance.DestroyKeyValues()",
		"g_strPlatform}${(g_strArchitecture === \"x64\") ? \"64\" : \"\"}",
	]:
		if strRequired not in strManagerPackage:
			return Fail(f"SourceMod GameData JavaScript contract missing: {strRequired}")

	for strRequired in [
		"SourceMod block comments removed before KeyValues parsing",
		"SourceMod line comments removed before KeyValues parsing",
		"SourceMod semicolon comments removed before KeyValues parsing",
		"comment markers preserved inside quoted SourceMod values",
	]:
		if strRequired not in strMemoryManagerSmoke:
			return Fail(f"SourceMod GameData smoke coverage missing: {strRequired}")

	for strRequired in [
		"`.txt` files are parsed as KeyValues",
		"KeyValues",
		"strips `//`, `;`, and `/*...*/` comments",
		"sm-tf2.games.txt",
	]:
		if strRequired not in strMemoryManagerDocumentation:
			return Fail(f"memory/manager documentation must describe KeyValues GameData: {strRequired}")

	strPackageConfiguration = ReadText(ROOT / "cmake" / "SourceJSPackage.cmake")
	for strSnapshotName in [
		"SourceMod",
		"SourceMod.Pending",
		"SourceMod.Previous",
		"core.games",
		"sdkhooks.games",
		"sdktools.games",
		"sm-cstrike.games",
		"funcommands.games.txt",
		"sm-tf2.games.txt",
	]:
		if f'PATTERN "{strSnapshotName}" EXCLUDE' not in strPackageConfiguration:
			return Fail(f"SourceMod GameData cache must be excluded from installation: {strSnapshotName}")

	for strLegacyPath in [
		"packaging/runtime/addons/sourcejs/data/gamedata",
		"packaging/runtime/addons/sourcejs/data/sourcejs/gamedata",
	]:
		if (ROOT / strLegacyPath).exists():
			return Fail(f"legacy GameData directory must be removed: {strLegacyPath}")

	return 0

def CheckMemoryHooksNativeErrors():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nMemoryHooksBegin = strBindings.find("void RemoveHookCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation)")
	nMemoryHooksEnd = strBindings.find("bool ReadDefinedObjectProperty", nMemoryHooksBegin)
	if (nMemoryHooksBegin < 0) or (nMemoryHooksEnd < 0):
		return Fail("native memory/hooks callback block could not be parsed")

	strMemoryHooksBlock = strBindings[nMemoryHooksBegin:nMemoryHooksEnd]

	for strRequired in [
		"memory/hooks.RemoveHook(nHookID) expects a positive integer hook ID.",
		"GetIntegerFromValue(LocalContext, CallbackInformation[kHookIDArgumentIndex], nHookID)",
		"memory/hooks.SetHooksDisabled(bDisabled) expects a boolean value.",
		"!CallbackInformation[kDisabledArgumentIndex]->IsBoolean()",
	]:
		if strRequired not in strMemoryHooksBlock:
			return Fail(f"strict native memory/hooks binding missing: {strRequired}")

	for strForbidden in [
		"Args.Length() > 0 ? Args[0]->Int32Value(LocalContext).FromMaybe(0) : 0",
		"Args.Length() > 0 ? Args[0]->BooleanValue(Args.GetIsolate()) : true",
	]:
		if strForbidden in strMemoryHooksBlock:
			return Fail(f"native memory/hooks binding must reject invalid input instead of using fallback: {strForbidden}")

	strOutputsPath = "entities/outputs.js"
	strOutputsContent = ReadText(ROOT / "packages" / "sourcejs" / strOutputsPath)
	for strForbidden in [
		"function looksLikePattern",
		"function looksLikeAddress",
		"memoryManager.scan(binaryName, identifier)",
		"memoryManager.symbol(binaryName, String(identifier)) || memoryManager.scan(binaryName, String(identifier))",
		"memoryManager.findSymbol(binaryName, String(identifier)) || memoryManager.findSignature(binaryName, String(identifier))",
		"memoryHelpers.address(identifier)",
		"try {\n\t\tconst data = JSON.parse",
		"data.branches && typeof data.branches",
		"LoadEntityOutputIndex().profiles",
		"LoadEntityOutputIndex().entries",
	]:
		if strForbidden in strOutputsContent:
			return Fail(f"{strOutputsPath} must resolve output identifiers through native memory/manager.ResolveBinaryIdentifier(): {strForbidden}")

	if "g_MemoryManagerRuntime.ResolveBinaryIdentifier(EntityOutputData.Binary, strSelectedFireOutputIdentifier)" not in strOutputsContent:
		return Fail(f"{strOutputsPath} is missing direct native memory/manager.ResolveBinaryIdentifier() call")

	strRadioPath = "menus/radio.js"
	strRadioContent = ReadText(ROOT / "packages" / "sourcejs" / strRadioPath)
	for strRequired in [
		'const { GetGlobalVariables } = require("globals");',
		"const Globals = GetGlobalVariables();",
		'typeof Globals.SDKBranch !== "string"',
		"return Globals.SDKBranch.toLowerCase();",
	]:
		if strRequired not in strRadioContent:
			return Fail(f"{strRadioPath} must read the active SDK branch directly from native globals: {strRequired}")

	for strForbidden in [
		"String(globalsInfo().sdkBranch)",
		"function currentSDKBranch() {\n\ttry",
	]:
		if strForbidden in strRadioContent:
			return Fail(f"{strRadioPath} must not coerce or hide a missing native SDK branch: {strForbidden}")

	return 0

def CheckBitBuffersNativeAPI():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	vecRequiredFunctions = [
		"PackUInt32",
		"CreateWrite",
		"CreateRead",
		"GetBytes",
		"SetBytes",
		"GetDataBitCount",
		"SetDataBitCount",
		"GetDataByteCount",
		"SetDataByteCount",
		"GetCurrentBit",
		"SetCurrentBit",
		"IsOverflowed",
		"SetOverflowFlag",
		"ClearOverflowFlag",
		"GetMaximumBitCount",
		"GetRemainingBitCount",
		"GetRemainingByteCount",
		"GetWrittenBitCount",
		"GetWrittenByteCount",
		"GetReadBitCount",
		"GetReadByteCount",
		"Reset",
		"CheckForOverflow",
		"SeekToBit",
		"SeekRelative",
		"ToBytes",
		"WriteOneBit",
		"WriteOneBitNoCheck",
		"WriteOneBitAt",
		"WriteUBitLong",
		"WriteSBitLong",
		"WriteUBitVar",
		"WriteVarInt32",
		"WriteBitsFromBuffer",
		"WriteBitAngle",
		"WriteBitCoord",
		"WriteBitCoordMP",
		"WriteBitFloat",
		"WriteBitVec3Coord",
		"WriteBitNormal",
		"WriteBitVec3Normal",
		"WriteBitAngles",
		"WriteByte",
		"WriteChar",
		"WriteShort",
		"WriteWord",
		"WriteLong",
		"WriteFloat",
		"WriteString",
		"ReadOneBit",
		"ReadUBitLong",
		"PeekUBitLong",
		"ReadSBitLong",
		"ReadUBitVar",
		"ReadVarInt32",
		"ReadBitAngle",
		"ReadBitCoord",
		"ReadBitFloat",
		"ReadBitNormal",
		"ReadBitVec3Coord",
		"ReadBitVec3Normal",
		"ReadBitAngles",
		"ReadByte",
		"ReadChar",
		"ReadShort",
		"ReadWord",
		"ReadLong",
		"ReadFloat",
		"ReadString",
	]
	for strFunctionName in vecRequiredFunctions:
		strFunctionRegistration = f'SetFunction(pIsolate, LocalContext, LocalBitBuffersModule, "{strFunctionName}"'
		if strFunctionRegistration not in strBindings:
			return Fail(f"native bitbuffers API missing install for {strFunctionName}")

	for strFunctionName in ["WriteLongLong", "ReadBitCoordMP", "ReadLongLong"]:
		strPattern = rf'InstallSDKFunction<[^\r\n]+LocalBitBuffersModule, "{re.escape(strFunctionName)}"'
		if re.search(strPattern, strBindings) is None:
			return Fail(f"native bitbuffers capability API missing install for {strFunctionName}")

	for strRequired in [
		"bf_write BitBufferWriter {};",
		"SDKBitBufferReader BitBufferReader {};",
		"using SDKBitBufferReader = old_bf_read;",
		"using SDKBitBufferReader = bf_read;",
		"std::vector<std::uint32_t> m_vecReaderWords;",
		"WriteBitBufferUnsignedValue(BitBufferWriter, unValue, nBitCount)",
		"ReadBitBufferUnsignedValue(OperationBitBufferReader, nBitCount)",
		"WriteBitBufferCoordinateValue(BitBufferWriter, flCoordinateValue)",
		"SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferByteCallback, ReadBitBufferScalarUnsignedValue(OperationBitBufferReader, kBitBufferByteBitCount))",
		"SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferCharCallback, ReadBitBufferCharacterValue(OperationBitBufferReader))",
		"SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferLongCallback, ReadBitBufferScalarSignedValue(OperationBitBufferReader, kBitBufferLongBitCount))",
		"SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferBitCoordinateCallback, ReadBitBufferCoordinateValue(OperationBitBufferReader))",
		"SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferBitNormalCallback, ReadBitBufferNormalValue(OperationBitBufferReader))",
		"BitBufferWriter.GetNumBitsWritten()",
		"BitBufferState.m_nCurrentBitIndex = Reader.GetNumBitsRead();",
		"Int64Argument",
	]:
		if strRequired not in strBindings:
			return Fail(f"native bitbuffers SDK call missing: {strRequired}")

	strPackagePath = "bitbuffers.js"
	strPackageContent = ReadText(ROOT / "packages" / "sourcejs" / strPackagePath)
	for strRequired in [
		'const g_BitBuffersRuntime = GetModule("bitbuffers");',
		"g_BitBuffersRuntime.PackUInt32",
		"g_BitBuffersRuntime.CreateWrite",
		"g_BitBuffersRuntime.CreateRead",
		"g_BitBuffersRuntime.GetDataBitCount",
		"g_BitBuffersRuntime.SetDataBitCount",
		"g_BitBuffersRuntime.GetDataByteCount",
		"g_BitBuffersRuntime.SetDataByteCount",
		"g_BitBuffersRuntime.GetMaximumBitCount",
		"g_BitBuffersRuntime.GetRemainingBitCount",
		"g_BitBuffersRuntime.GetRemainingByteCount",
		"g_BitBuffersRuntime.GetWrittenBitCount",
		"g_BitBuffersRuntime.GetWrittenByteCount",
		"g_BitBuffersRuntime.GetReadBitCount",
		"g_BitBuffersRuntime.GetReadByteCount",
		"g_BitBuffersRuntime.WriteUBitLong",
		"g_BitBuffersRuntime.ReadUBitLong",
		"g_BitBuffersRuntime.WriteBitCoord",
		"g_BitBuffersRuntime.ReadBitCoord",
		"Bytes: Value.Bytes",
		"DataBitCount: Value.WrittenBitCount",
		"IsOverflowed()",
		"ResetBuffer()",
		"WriteOneBitWithoutCheck(",
		"ReadOneBit()",
	]:
		if strRequired not in strPackageContent:
			return Fail(f"bitbuffers package is not wired to native API in {strPackagePath}: {strRequired}")

	for strForbidden in [
		"COORD_INTEGER_BITS",
		"NORMAL_FRACTIONAL_BITS",
		"TextEncoder",
		"TextDecoder",
		"DataView",
		"function normalizeUnsigned",
		"function readRawBits",
		"function writeRawBits",
		"function vectorObject",
		"moduleName",
		"dataBitsCount",
		"dataBytesCount",
		"maxNumBits",
		"numBitsLeft",
		"numBytesLeft",
		"numBitsWritten",
		"numBytesWritten",
		"numBitsRead",
		"numBytesRead",
		"prototype.IsOverflowed",
		"prototype.SetOverflowFlag",
		"prototype.ClearOverflowFlag",
		"prototype.SeekToBit",
		"prototype.Reset",
		"prototype.ToBytes",
		"prototype.SeekRelative",
	]:
		if strForbidden in strPackageContent:
			return Fail(f"bitbuffers package must not reimplement or alias the native API: {strForbidden}")

	return 0

def CheckKeyValuesNativeAPI():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strSDKAdapter = ReadText(ROOT / "src" / "sourcejs" / "SourceSDKKeyValues.cpp")
	strNativeContent = strBindings + strSDKAdapter
	vecRequiredFunctions = [
		"Types",
		"Create",
		"Destroy",
		"Address",
		"Name",
		"SetName",
		"NameSymbol",
		"DataType",
		"FindKey",
		"FindKeyBySymbol",
		"CreateNewKey",
		"AddSubKey",
		"RemoveSubKey",
		"CopySubKeys",
		"MakeCopy",
		"FirstSubKey",
		"NextKey",
		"SetNextKey",
		"FirstTrueSubKey",
		"NextTrueSubKey",
		"FirstValue",
		"NextValue",
		"GetInt",
		"GetUInt64",
		"GetFloat",
		"GetString",
		"GetColor",
		"GetAddress",
		"IsEmpty",
		"Clear",
		"SetString",
		"SetInt",
		"SetUInt64",
		"SetFloat",
		"SetColor",
		"SetAddress",
		"Keys",
		"Value",
		"ToObject",
		"ToString",
		"LoadFromBuffer",
		"LoadFromFile",
		"SaveToFile",
	]
	for strFunctionName in vecRequiredFunctions:
		strFunctionRegistration = f'SetRecordFunction(pIsolate, LocalContext, LocalKeyValuesModule, "{strFunctionName}"'
		if strFunctionRegistration not in strBindings:
			return Fail(f"native keyvalues API missing install for {strFunctionName}")

	for strRequired in [
		"KeyValuesTypesCallback",
		'{ "None", static_cast<int>(KeyValues::TYPE_NONE) }',
		'{ "UInt64", static_cast<int>(KeyValues::TYPE_UINT64) }',
		'{ "NumberOfTypes", static_cast<int>(KeyValues::TYPE_NUMTYPES) }',
		"KeyValuesRecord",
		"std::string m_strPluginName;",
		"RequireCurrentPluginNameForKeyValues",
		"CollectKeyValuesHierarchy",
		"EraseCollectedKeyValuesRecords",
		"EraseDescendantKeyValuesRecords",
		"DestroyKeyValuesHierarchy",
		"ReleaseKeyValuesRecordsForPlugin",
		"RegisterKeyValues",
		"GetKeyValuesAddressFromValue",
		"ReleaseKeyValuesOwnershipToEngine",
		"InstallKeyValuesGetBooleanFunction<KeyValues>",
		"InstallKeyValuesSetBooleanFunction<KeyValues>",
		"if constexpr (requires(TKeyValues* pKeyValues) { pKeyValues->GetBool(nullptr, false); })",
		"if constexpr (requires(TKeyValues* pKeyValues) { pKeyValues->SetBool(nullptr, false); })",
		"bHasNextKeyHandleArgument",
		"new KeyValues",
		"deleteThis()",
		"FindKey",
		"GetFirstTrueSubKey",
		"GetNextValue",
		"SetUint64",
		"MakeCopy",
		"RecursiveSaveToFile",
		"UsesEscapeSequences",
		"LoadFromBuffer",
		"LoadFromFile",
		"SaveToFile",
		"RequireFilesystemInterface",
	]:
		if strRequired not in strNativeContent:
			return Fail(f"native keyvalues SDK binding missing: {strRequired}")

	for strRequired in [
		"ConvertSourceSDKKeyValuesToString",
		"LoadSourceSDKKeyValuesFromBuffer",
		"LoadSourceSDKKeyValuesFromFile",
		"SaveSourceSDKKeyValuesToFile",
		"RecursiveSaveToFile",
		"UsesEscapeSequences",
		"LoadFromBuffer",
		"LoadFromFile",
		"SaveToFile",
	]:
		if strRequired not in strSDKAdapter:
			return Fail(f"selected-branch KeyValues adapter missing direct SDK call: {strRequired}")

	strCMakeContent = ReadText(ROOT / "CMakeLists.txt")
	if "src/sourcejs/SourceSDKKeyValues.cpp" not in strCMakeContent:
		return Fail("selected-branch KeyValues adapter is missing from CMake")

	for PathForbidden in [
		ROOT / "src" / "sourcejs" / "SourceSdkTierCompat.cpp",
		ROOT / "src" / "sourcejs" / "SourceSdkDebugCompat.cpp",
	]:
		if PathForbidden.exists():
			return Fail(f"cross-branch x64 compatibility implementation must not exist: {PathForbidden.relative_to(ROOT)}")

	for strForbidden in [
		"HL2SDK_X64_MATHLIB_ROOT",
		"SOURCEJS_ALLOW_SELECTED_SDK_DUPLICATES",
		"--allow-multiple-definition",
		'${HL2SDK_ROOT}/tier1/KeyValues.cpp',
	]:
		if strForbidden in strCMakeContent:
			return Fail(f"KeyValues must link from the selected branch library: {strForbidden}")

	for strForbidden in [
		"static void KeyValuesAppendQuoted",
		"static std::string KeyValuesStringValue",
		"static void KeyValuesWriteChildren",
		"static bool KeyValuesTokenizeBuffer",
		"static bool KeyValuesParseChildren",
		"static bool KeyValuesLoadBuffer",
		"KeyValuesGetBoolUnavailableCallback",
		"KeyValuesSetBoolUnavailableCallback",
		"keyvalues.getBool() is unavailable",
		"keyvalues.setBool() is unavailable",
	]:
		if strForbidden in strNativeContent:
			return Fail(f"native bindings must not reimplement selected-branch KeyValues: {strForbidden}")

	strPackagePath = "keyvalues.js"
	strPackageContent = ReadText(ROOT / "packages" / "sourcejs" / strPackagePath)
	for strRequired in [
		"GetModule",
		'GetModule("keyvalues")',
		"Object.freeze(g_KeyValuesRuntime.Types())",
		"g_KeyValuesRuntime.Create",
		"g_KeyValuesRuntime.FindKey",
		"g_KeyValuesRuntime.FindKeyBySymbol(this.Handle, nKeySymbol)",
		"g_KeyValuesRuntime.CopySubKeys(SourceKeyValues.Handle, this.Handle)",
		"g_KeyValuesRuntime.SetString",
		"g_KeyValuesRuntime.GetUInt64",
		"g_KeyValuesRuntime.SetUInt64",
		"g_KeyValuesRuntime.LoadFromBuffer",
		"g_KeyValuesRuntime.SaveToFile",
	]:
		if strRequired not in strPackageContent:
			return Fail(f"keyvalues package is not wired to native API in {strPackagePath}: {strRequired}")

	for strForbidden in [
		"COMPILED_INT_BYTE: 8",
		"g_KeyValuesRuntime.CopySubkeys(",
		"NUM_TYPES: 11",
		"function tokenize",
		"function parseScalar",
		"function parseChildren",
		"function serializeToken",
		"writeChildren(",
		"this.children =",
		"this.parent =",
		"this.detachedNextKey",
		"function normalizeUint64",
		"Number(symbol) || 0",
		"BigInt(Math.trunc(Number(value) || 0))",
		"normalizeUint64(defaultValue)",
		"normalizeUint64(value)",
		"keyValuesRuntime.getString(this.handle, keyName, String(",
		"keyValuesRuntime.setString(this.handle, keyName, String(",
		"keyValuesRuntime.getBool(this.handle, keyName, Boolean(",
		"keyValuesRuntime.setBool(this.handle, keyName, Boolean(",
	]:
		if strForbidden in strPackageContent:
			return Fail(f"keyvalues package must not reimplement SDK KeyValues in JS: {strForbidden}")

	return 0

def CheckKeyValuesNativeErrors():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	if ("struct KeyValuesRecord" not in strBindings) or ("void PackUInt32Callback" not in strBindings):
		return Fail("native keyvalues block could not be located")

	strKeyValuesBlock = strBindings.split("struct KeyValuesRecord", 1)[1].split("void PackUInt32Callback", 1)[0]

	if ("bool GetAddressSizedUnsignedIntegerFromValue" not in strBindings) or ("edict_t* GetValidEntityEdictFromIndex" not in strBindings):
		return Fail("native unsigned address conversion block could not be located")

	strUnsignedAddressBlock = strBindings.split("bool GetAddressSizedUnsignedIntegerFromValue", 1)[1].split("edict_t* GetValidEntityEdictFromIndex", 1)[0]

	for strRequiredAddressContract in [
		"LocalUnsignedIntegerValue.IsEmpty() || !LocalUnsignedIntegerValue->IsBigInt()",
		"bool bLossless = false;",
		"LocalUnsignedIntegerValue.As<v8::BigInt>()->Uint64Value(&bLossless)",
		"!bLossless",
		"std::numeric_limits<std::uintptr_t>::max()",
	]:
		if strRequiredAddressContract not in strUnsignedAddressBlock:
			return Fail(f"native address conversion must require a lossless BigInt: {strRequiredAddressContract}")

	for strForbiddenAddressContract in [
		"IsNumber",
		"IsString",
		"IsObject",
		"kSourceJSMaxSafeInteger",
		"kMaximumSafeNumberInteger",
		"std::floor",
	]:
		if strForbiddenAddressContract in strUnsignedAddressBlock:
			return Fail(f"native address conversion must not coerce or constrain BigInt addresses as Numbers: {strForbiddenAddressContract}")

	for strRequired in [
		"bool RequireKeyValuesIntegerFromValue",
		"bool RequireKeyValuesFloatFromValue",
		"bool RequireKeyValuesNativeAddressFromValue",
		"v8::Local<v8::BigInt> const LocalAddressValue = MakeKeyValuesNativeAddressValue(pIsolate, pKeyValuesAddress);",
		"bool RequireKeyValuesColorComponentFromValue",
		"bool GetKeyValuesColorArrayComponent",
		"bool GetKeyValuesColorObjectComponent",
		"bool RequireKeyValuesColorFromValue",
		"KeyValues operations require an active SourceJS runtime context.",
		"KeyValues native handle belongs to another plugin context.",
		"KeyValues native handle for ownership transfer belongs to another plugin context.",
		"KeyValues ownership transfer requires an owned root handle.",
		"keyvalues.AddSubKey(Parent, Child) expects Child to be a distinct owned tree.",
		"keyvalues.SetNextKey(Handle, Next) expects Next to be a distinct owned next-key tree or null.",
		"keyvalues.Create(strRootName?) expects its optional strRootName to be a string.",
		"keyvalues.SetName(Handle, strKeyValuesName) expects a strKeyValuesName.",
		"keyvalues.SetName(Handle, strKeyValuesName) expects a string strKeyValuesName.",
		"KeyValues key names must be strings, null or undefined.",
		"keyvalues.FindKey(Handle, strKeyName, bCreateMissingKey?) expects a strKeyName.",
		"keyvalues.FindKey(Handle, strKeyName, bCreateMissingKey?) expects bCreateMissingKey to be a boolean.",
		"keyvalues.FindKeyBySymbol(Handle, nKeySymbol) expects an nKeySymbol.",
		"keyvalues.FindKeyBySymbol(Handle, nKeySymbol) expects nKeySymbol to be an integer.",
		"keyvalues.GetInt(Handle, strKeyName?, nDefaultIntegerValue?) expects nDefaultIntegerValue to be an integer.",
		"keyvalues.GetUInt64(Handle, strKeyName?, unDefaultUInt64Value?) expects unDefaultUInt64Value to be an unsigned integer.",
		"keyvalues.GetFloat(Handle, strKeyName?, flDefaultFloatValue?) expects flDefaultFloatValue to be a finite number.",
		"keyvalues.GetString(Handle, strKeyName?, strDefaultStringValue?) expects strDefaultStringValue to be a string.",
		"keyvalues.GetBool(Handle, strKeyName?, bDefaultBooleanValue?) expects bDefaultBooleanValue to be a boolean.",
		"keyvalues.GetAddress(Handle, strKeyName?, unDefaultAddress?) expects unDefaultAddress to be an address.",
		"keyvalues.SetString(Handle, strKeyName, strStringValue) expects a strKeyName and strStringValue.",
		"keyvalues.SetString(Handle, strKeyName, strStringValue) expects a string strStringValue.",
		"keyvalues.SetInt(Handle, strKeyName, nIntegerValue) expects a strKeyName and integer nIntegerValue.",
		"keyvalues.SetInt(Handle, strKeyName, nIntegerValue) expects an integer nIntegerValue.",
		"keyvalues.SetUInt64(Handle, strKeyName, unUInt64Value) expects a strKeyName and value.",
		"keyvalues.SetUInt64(Handle, strKeyName, unUInt64Value) expects an unsigned integer unUInt64Value.",
		"keyvalues.SetFloat(Handle, strKeyName, flFloatValue) expects a strKeyName and numeric flFloatValue.",
		"keyvalues.SetFloat(Handle, strKeyName, flFloatValue) expects a finite numeric flFloatValue.",
		"keyvalues.SetColor(Handle, strKeyName, ColorValue) expects a strKeyName and ColorValue.",
		"keyvalues.SetBool(Handle, strKeyName, bBooleanValue) expects a strKeyName and bBooleanValue.",
		"keyvalues.SetBool(Handle, strKeyName, bBooleanValue) expects a boolean bBooleanValue.",
		"keyvalues.SetAddress(Handle, strKeyName, unAddress) expects a strKeyName and unAddress.",
		"keyvalues.SetAddress(Handle, strKeyName, unAddress) expects an address unAddress.",
		"keyvalues.LoadFromBuffer(Handle, strKeyValuesBuffer, bUsesEscapeSequences?) expects a strKeyValuesBuffer.",
		"keyvalues.LoadFromBuffer(Handle, strKeyValuesBuffer, bUsesEscapeSequences?) expects a string strKeyValuesBuffer.",
		"keyvalues.LoadFromBuffer(Handle, strKeyValuesBuffer, bUsesEscapeSequences?) expects a boolean bUsesEscapeSequences.",
		"keyvalues.LoadFromFile(Handle, strFilePath, bUsesEscapeSequences?) expects a strFilePath.",
		"keyvalues.LoadFromFile(Handle, strFilePath, bUsesEscapeSequences?) expects a string strFilePath.",
		"keyvalues.LoadFromFile(Handle, strFilePath, bUsesEscapeSequences?) expects a boolean bUsesEscapeSequences.",
		"keyvalues.SaveToFile(Handle, strFilePath) expects a strFilePath.",
		"keyvalues.SaveToFile(Handle, strFilePath) expects a string strFilePath.",
		"KeyValues color expects an array or object value.",
		"KeyValues color arrays must contain exactly three or four components.",
		"KeyValues color expects Red, Green and Blue integer components.",
		"KeyValues color expects integer components.",
		"KeyValues color components must be between 0 and 255.",
		'RequireUInt64FromValue(pIsolate, LocalContext, CallbackInformation[kDefaultUInt64ArgumentIndex], kDefaultUInt64TypeErrorMessage, unDefaultUInt64Value)',
		'RequireUInt64FromValue(pIsolate, LocalContext, CallbackInformation[kUInt64ValueArgumentIndex], kUInt64ValueTypeErrorMessage, unUInt64Value)',
	]:
		if strRequired not in strKeyValuesBlock:
			return Fail(f"strict native keyvalues binding missing: {strRequired}")

	for strForbidden in [
		"MakeEventAddressObject",
		"static_cast<uint64>(Uint64FromValue",
		"NumberValue(LocalContext).FromMaybe(0)",
		"NumberValue(LocalContext).FromMaybe(0.0)",
		"Int32Value(LocalContext).FromMaybe(0)",
		"Uint32Value(LocalContext).FromMaybe(0)",
		"IntegerValue(LocalContext).FromMaybe(0)",
		"std::strtoull(strValue.c_str(), nullptr, 0)",
		"ToLocalChecked",
		"!pKeyValues || Args.Length() <",
		"return Color(0, 0, 0, 255);",
		"pKeyValues->SetInt(KeyValuesNullableKeyName(strName, bHasName), Args[2]->Int32Value",
		"pKeyValues->SetFloat(KeyValuesNullableKeyName(strName, bHasName), static_cast<float>(Args[2]->NumberValue",
	]:
		if strForbidden in strKeyValuesBlock:
			return Fail(f"native keyvalues binding must not coerce bad values to zero: {strForbidden}")

	return 0

def CheckSteamNativeAPI():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	vecRequiredFunctions = [
		"SteamIDNormalize",
		"SteamIDParse",
		"SteamIDFields",
		"SteamIDSet",
		"SteamIDInstancedSet",
		"SteamIDFullSet",
		"SteamIDCreateBlankAnonymousLogon",
		"SteamIDCreateBlankAnonymousUserAccount",
		"SteamIDClear",
		"SteamIDStaticAccountKey",
		"SteamIDClearIndividualInstance",
		"SteamIDToSteamID2",
		"SteamIDToSteamID3",
		"SteamIDIsValid",
		"SteamIDIsBlankAnonymousAccount",
		"SteamIDIsGameServerAccount",
		"SteamIDIsPersistentGameServerAccount",
		"SteamIDIsAnonymousGameServerAccount",
		"SteamIDIsContentServerAccount",
		"SteamIDIsClanAccount",
		"SteamIDIsChatAccount",
		"SteamIDIsLobby",
		"SteamIDIsIndividualAccount",
		"SteamIDIsAnonymousUserAccount",
		"SteamIDIsAnonymousAccount",
		"SteamIDIsConsoleUserAccount",
		"SteamIDHasNoIndividualInstance",
	]
	for strFunctionName in vecRequiredFunctions:
		strFunctionRegistration = f'SetRecordFunction(pIsolate, LocalContext, LocalSteamModule, "{strFunctionName}"'
		if strFunctionRegistration not in strBindings:
			return Fail(f"native steam API missing install for {strFunctionName}")

	for strRequired in [
		"steam/steamclientpublic.h",
		"CSteamID",
		"SteamIDFromValue",
		"SteamIDArgument",
		"SteamUInt64FromValue",
		"SteamUInt64Argument",
		"SteamUInt32Argument",
		"GetSteamNonNegativeIntegerArgument",
		"MakeSteamIDFieldsObject",
		"ParseSteamID",
		"ConvertToUint64",
		"GetStaticAccountKey",
		"InstancedSet",
		"FullSet",
		"CreateBlankAnonLogon",
		"BGameServerAccount",
		"BClanAccount",
		"BChatAccount",
		"InstallSteamIDFunctions",
		'SetString(pIsolate, LocalContext, LocalSteamModule, "STEAM_BRANCH", SOURCEJS_SDK_BRANCH)',
		'SetFunction(pIsolate, LocalContext, LocalSteamModule, "GetNetworkID", GetSteamNetworkIDCallback',
		'SetFunction(pIsolate, LocalContext, LocalSteamModule, "GetXUID", GetSteamXUIDCallback',
	]:
		if strRequired not in strBindings:
			return Fail(f"native steam CSteamID binding missing: {strRequired}")

	strSteamNativeBlock = strBindings[strBindings.index("bool GetSteamUInt64FromValue"):strBindings.index("bool InstallSteamIDFunctions")]
	for strRequired in [
		"steam.SteamIDNormalize(unSteamID) expects a BigInt SteamID value.",
		"steam.SteamIDParse(strSteamIDText) expects a SteamID string.",
		"steam.SteamIDFields(unSteamID) expects a BigInt SteamID value.",
		"steam.SteamIDSet(unAccountID, nUniverse, nAccountType) expects an unsigned account ID and selected-SDK universe/account-type integers below their Max sentinels.",
		"steam.SteamIDInstancedSet(unAccountID, unAccountInstance, nUniverse, nAccountType) expects an unsigned account ID, a 20-bit account instance, and selected-SDK universe/account-type integers below their Max sentinels.",
		"steam.SteamIDFullSet(unSteamIDIdentifier, nUniverse, nAccountType) expects a BigInt SteamID identifier and selected-SDK universe/account-type integers below their Max sentinels.",
		"steam.SteamIDCreateBlankAnonymousLogon(nUniverse) expects a selected-SDK universe integer below its Max sentinel.",
		"steam.SteamIDCreateBlankAnonymousUserAccount(nUniverse) expects a selected-SDK universe integer below its Max sentinel.",
		"steam.SteamIDStaticAccountKey(unSteamID) expects a BigInt SteamID value.",
		"steam.SteamIDClearIndividualInstance(unSteamID) expects a BigInt SteamID value.",
		"steam.SteamIDToSteamID2(unSteamID) expects a BigInt SteamID value.",
		"steam.SteamIDToSteamID3(unSteamID) expects a BigInt SteamID value.",
		"GetSteamIDArgument(CallbackInformation, kSteamIDArgumentIndex",
		"GetSteamUInt32Argument(CallbackInformation, kSteamAccountIDArgumentIndex",
		"GetSteamNonNegativeIntegerArgument(CallbackInformation, kSteamUniverseArgumentIndex",
		"GetSteamUInt64Argument(CallbackInformation, kSteamIDArgumentIndex",
		"bool ValidateSteamUniverse(",
		"bool ValidateSteamAccountType(",
		"kMaximumSteamAccountInstance = static_cast<std::uint32_t>(k_unSteamAccountInstanceMask);",
	]:
		if strRequired not in strSteamNativeBlock:
			return Fail(f"strict native steam binding missing: {strRequired}")

	for strForbidden in [
		"SteamIDUnavailableCallback",
		"static_cast<uint64>(Uint64FromValue",
		"NumberValue(LocalContext).FromMaybe(0)",
		"NumberValue(LocalContext).FromMaybe(0.0)",
		"Int32Value(LocalContext).FromMaybe(0)",
		"Uint32Value(LocalContext).FromMaybe(0)",
		"IntegerValue(LocalContext).FromMaybe(0)",
		"Args.Length() > 0 ? Args[0] : v8::Undefined(pIsolate)",
		"Args.Length() > 0 ? static_cast<uint32>",
		"Args.Length() > 1 ? static_cast<uint32>",
		"Args.Length() > 1 ? Args[1]->",
		"Args.Length() > 2 ? Args[2]->",
		"Args.Length() > 3 ? Args[3]->",
		"std::string const strInput = Args.Length() > 0 ?",
	]:
		if strForbidden in strSteamNativeBlock:
			return Fail(f"native steam binding must not coerce bad values to zero: {strForbidden}")

	for strForbidden in [
		'SetString(pIsolate, LocalContext, LocalSteam, "branch"',
		'SetValue(pIsolate, LocalContext, LocalSteam, "universe"',
		'SetValue(pIsolate, LocalContext, LocalSteam, "accountType"',
		'SetInteger(pIsolate, LocalContext, LocalSteam, "steamIDSize"',
		'SetFunction(pIsolate, LocalContext, LocalSteam, "networkID"',
		'SetFunction(pIsolate, LocalContext, LocalSteam, "xuid"',
	]:
		if strForbidden in strBindings:
			return Fail(f"native steam binding retains obsolete public name: {strForbidden}")

	strSteamPlayerNativeBlock = strBindings[strBindings.index("void GetSteamNetworkIDCallback"):strBindings.index("struct AuthenticationPermissionRecord")]
	for strRequired in [
		"steam.GetNetworkID(nPlayerIndex) expects an integer player index.",
		"RequireEngineServer(pIsolate, kGetSteamNetworkIDAPIName)",
		"RequirePlayersGlobals(pIsolate, kGetSteamNetworkIDAPIName)",
		"steam.GetNetworkID(nPlayerIndex) requires a valid player.",
		"steam.GetNetworkID(nPlayerIndex) did not return a network ID.",
		"steam.GetXUID(nPlayerIndex) expects an integer player index.",
		"RequireEngineServer(pIsolate, kGetSteamXUIDAPIName)",
		"RequirePlayersGlobals(pIsolate, kGetSteamXUIDAPIName)",
		"steam.GetXUID(nPlayerIndex) requires a valid player.",
		"steam.GetXUID(nPlayerIndex) did not return an XUID for the player.",
	]:
		if strRequired not in strSteamPlayerNativeBlock:
			return Fail(f"strict native steam player lookup missing: {strRequired}")

	for strForbidden in [
		"Int32Value(LocalContext).FromMaybe(0)",
		"Args.GetReturnValue().Set(v8::Null(pIsolate))",
	]:
		if strForbidden in strSteamPlayerNativeBlock:
			return Fail(f"native steam player lookup must throw instead of returning a fallback: {strForbidden}")

	strSteamPackagePath = "steam.js"
	strSteamPackageContent = ReadText(ROOT / "packages" / "sourcejs" / strSteamPackagePath)
	for strRequired in [
		'const g_SteamRuntime = GetModule("steam");',
		"g_SteamRuntime.SteamIDNormalize",
		"g_SteamRuntime.SteamIDParse",
		"g_SteamRuntime.SteamIDFields",
		"g_SteamRuntime.SteamIDInstancedSet",
		"g_SteamRuntime.SteamIDToSteamID3",
		"g_SteamRuntime.SteamIDIsValid",
		"typeof g_SteamRuntime.GetXUID",
		"delete SteamID.prototype[strMethodName]",
	]:
		if strRequired not in strSteamPackageContent:
			return Fail(f"steam package is not wired to native API in {strSteamPackagePath}: {strRequired}")

	for strForbidden in [
		"ACCOUNT_ID_MASK",
		"ACCOUNT_INSTANCE_MASK",
		"ACCOUNT_TYPE_MASK",
		"UNIVERSE_MASK",
		"STATIC_ACCOUNT_KEY_INSTANCE",
		"CHAT_INSTANCE_FLAG",
		"STEAM_USER_WEB_INSTANCE",
		"function toUint32",
		"function toUint64",
		"function parseAccountTypeIdentifier",
		"function accountTypeIdentifier",
		"BigInt(this.universe)",
		">> 52n",
		"<< 56n",
		"steamId3 = null",
		"toJSON()",
		"moduleName",
		"addressString",
		"isAddressLike",
		"runtime()",
	]:
		if strForbidden in strSteamPackageContent:
			return Fail(f"steam package must not reimplement CSteamID bit layout in JS: {strForbidden}")

	return 0

def CheckEngineFacadesDoNotFabricateUnavailableAPI():
	for strPackagePath in [
		"engines/server.js",
		"engines/trace.js",
		"engines/sound.js",
		"engines/gamerules.js",
	]:
		strPackageContent = ReadText(ROOT / "packages" / "sourcejs" / strPackagePath)
		for strForbidden in [
			"${moduleName}.${String(name)} is not available",
			"function unavailableApi",
			"unavailableApi(",
		]:
			if strForbidden in strPackageContent:
				return Fail(f"{strPackagePath} must not fabricate unavailable API errors in JS: {strForbidden}")

	strServerPackageContent = ReadText(ROOT / "packages" / "sourcejs" / "engines" / "server.js")

	for strForbidden in ["moduleName", "Object.freeze", "Proxy", "serverGameDll", "globalVars", "engineServer"]:
		if strForbidden in strServerPackageContent:
			return Fail(f"engines/server.js must expose only the exact native module: {strForbidden}")

	if 'module.exports = GetModule("engines/server");' not in strServerPackageContent:
		return Fail("engines/server.js must load the exact native module through a literal key")

	strSoundPackageContent = ReadText(ROOT / "packages" / "sourcejs" / "engines" / "sound.js")

	for strForbidden in [
		"function soundPrecacheContains",
		'find("soundprecache")',
		'getString("soundprecache"',
		"moduleName",
		"engineSound",
		"precacheSound",
	]:
		if strForbidden in strSoundPackageContent:
			return Fail(f"engines/sound.js contains a removed wrapper or string-table scan: {strForbidden}")

	if "return g_SoundRuntime.IsSoundPrecached(NormalizeSample(strSample));" not in strSoundPackageContent:
		return Fail("engines/sound.js IsSoundPrecached must delegate to the direct native callback")

	strSoundExportBlock = strSoundPackageContent.split("const g_SoundAPI = {", 1)[1].split("};", 1)[0]

	for strCapabilityName in ["IsLoopingSound", "PrecacheSoundSentenceGroup"]:
		if f"\t{strCapabilityName}," in strSoundExportBlock:
			return Fail(f"engines/sound.js must not expose capability function unconditionally: {strCapabilityName}")

		strCapabilityAssignment = f"g_SoundAPI.{strCapabilityName} ="
		if strCapabilityAssignment not in strSoundPackageContent:
			return Fail(f"engines/sound.js must expose selected-SDK capability directly: {strCapabilityName}")

	for strRequired in [
		"function RequireInt32(Options, strOptionName, nDefaultValue)",
		"Number.isInteger(nValue)",
		"const g_nMinimumInt32 = -2_147_483_648;",
		"const g_nMaximumInt32 = 2_147_483_647;",
		"nValue < g_nMinimumInt32",
		"nValue > g_nMaximumInt32",
		'const g_SoundAPI = {',
		'if (typeof g_SoundRuntime.IsLoopingSound === "function")',
		'if (typeof g_SoundRuntime.PrecacheSoundSentenceGroup === "function")',
	]:
		if strRequired not in strSoundPackageContent:
			return Fail(f"engines/sound.js is missing strict selected-SDK behavior: {strRequired}")

	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strForbidden in [
		"Args.GetReturnValue().Set(pEngine ? pEngine->GetEntityCount() : 0)",
		"Args.GetReturnValue().Set(pEngine ? pEngine->IsDedicatedServer() : false)",
		'Args.GetReturnValue().Set(MakeString(pIsolate, pServerGameDLL ? pServerGameDLL->GetGameDescription() : ""))',
		"Args.GetReturnValue().Set(pGlobals ? pGlobals->maxEntities : 0)",
	]:
		if strForbidden in strBindings:
			return Fail(f"native engine/server binding must not fabricate missing-interface defaults: {strForbidden}")

	strGameDirectoryStart = "void GetEngineServerGameDirectoryCallback"
	strClientCVarStart = "void GetEngineServerClientCVarValueCallback"

	if (strGameDirectoryStart not in strBindings) or (strClientCVarStart not in strBindings):
		return Fail("native engines/server game-directory or client-ConVar callback is missing")

	strGameDirectoryCallback = strBindings.split(strGameDirectoryStart, 1)[1].split(strClientCVarStart, 1)[0]
	if 'Args.GetReturnValue().Set(MakeString(pIsolate, ""))' in strGameDirectoryCallback:
		return Fail("native engines/server.GetGameDirectory() must throw when IVEngineServer is missing instead of returning an empty string")

	for strRequired in [
		"void GetEngineServerConstantsCallback",
		"kQueryCVarSuccessPropertyName, v8::Integer::New(pIsolate, eQueryCvarValueStatus_ValueIntact)",
		"kQueryCVarProtectedPropertyName, v8::Integer::New(pIsolate, eQueryCvarValueStatus_CvarProtected)",
		"kQueryCVarStatusPropertyName, LocalQueryCVarStatusObject",
		"kNewGamePropertyName, v8::Integer::New(pIsolate, MapLoad_NewGame)",
		"kBackgroundPropertyName, v8::Integer::New(pIsolate, MapLoad_Background)",
		'SetFunction(pIsolate, LocalContext, LocalEngineServerModule, "GetServerConstants", GetEngineServerConstantsCallback, LocalRuntimeData)',
		"IVEngineServer* RequireEngineServer",
		'" requires IVEngineServer."',
		"IServer* ResolveIServer()",
		"return pEngineServerInterface->GetIServer();",
		"struct SourceModIServerGameData",
		"GetSourceModIServerGameDataPath()",
		"StripSourceModGameDataComments",
		"chCurrentCharacter == ';'",
		"LoadSourceSDKKeyValuesFromBuffer",
		"GetSourceModPatternByteCount",
		"DoesSourceModPatternMatch",
		'GetString("library", "")',
		'GetString("linux64", "")',
		'LoadSDKToolsGameData(PathSDKTools / kMasterFileName, "Game Master")',
		'pszGameDataFileName = "engine.ep2valve.txt"',
		'"engine.ep2.txt"',
		"std::memcpy(&pResolvedServer",
		"IsSourceModPatternRangeReadable(reinterpret_cast<unsigned char const*>(pResolvedServer), sizeof(void*))",
		'pEngineServer->GetNumClients()',
		'pEngineServer->GetClient(nClientIndex)',
		'pEngineServer->GetNetStats(flIncoming, flOutgoing)',
		'pEngineServer->DisconnectClient(pClient, strReason.c_str())',
		"void DisconnectClient(TClient* const pClient, std::string const& strMessage)",
		'pClient->Disconnect("%s", strMessage.c_str())',
		'pClient->Disconnect(strMessage.c_str())',
		"DisconnectClient(pClient, strReason);",
		'"GetServer", GetEngineServerCallback',
		'"GetServerFromAddress", GetEngineServerFromAddressCallback',
		'RequireEngineServer(pIsolate, kOperationName)',
		'RequireServerGameDLL(pIsolate, "engines/server.GetGameDescription()")',
		'ThrowError(pIsolate, kEmptyCVarNameErrorMessage)',
		'constexpr char kGlobalsError[] = "entities.GetMaximumEntityCount() requires CGlobalVars.";',
	]:
		if strRequired not in strBindings:
			return Fail(f"strict native engine/server binding missing: {strRequired}")

	for strForbidden in [
		"static void* PlayerVTableFunction",
		"static IServer* PlayerResolveIServer",
		"static bool PlayerMatchesCreateFakeClientL4D2Windows",
		'if (ResolveMemoryManagerSymbol("engine", "sv", unEngineServerAddress))',
		"DoesEngineServerCreateFakeClientFunctionMatchL4D2WindowsPattern",
	]:
		if strForbidden in strBindings:
			return Fail(f"engines/server must own IServer resolution instead of a player-only ABI path: {strForbidden}")

	vecRegisteredServerMethods = re.findall(r'(?:SetFunction|InstallSDKFunction)(?:<[^(\r\n]+>)?\(pIsolate, LocalContext, LocalEngineServerModule, "([^"]+)"', strBindings)
	if not vecRegisteredServerMethods:
		return Fail("native engines/server API has no registered functions")

	for strMethodName in vecRegisteredServerMethods:
		if not strMethodName or not strMethodName[0].isupper():
			return Fail(f"native engines/server API retains a non-canonical public name: {strMethodName}")

	for strRequiredMethodName in [
		"GetGlobalVariables",
		"GetMaximumClients",
		"GetMaximumEntities",
		"GetServerCount",
		"GetServerTime",
		"GetServerTick",
		"GetServerTickInterval",
		"GetMapName",
		"GetGameDirectory",
		"GetGameDescription",
		"GetClientCVarValue",
	]:
		if strRequiredMethodName not in vecRegisteredServerMethods:
			return Fail(f"native engines/server API is missing canonical registration: {strRequiredMethodName}")

	for strRequiredExpression in [
		"pEngineServer->ChangeLevel(strMapName.c_str(), pszLandmark)",
		"pEngineServer->IsMapValid(strResourceName.c_str()) != 0",
		"pEngineServer->IsModelPrecached(strResourceName.c_str())",
		"pEngineServer->GetClusterForOrigin(Origin)",
		"pEngineServer->GetPVSForCluster(nClusterIndex, nPVSByteCount, vecPVSBytes.data())",
		"pEngineServer->CheckOriginInPVS(Origin, vecPVSBytes.data(), nPVSByteCount)",
		"pEngineServer->CheckBoxInPVS(MinimumBounds, MaximumBounds, vecPVSBytes.data(), nPVSByteCount)",
		"pEngineServer->Message_DetermineMulticastRecipients(bUsePAS, Origin, bsetRecipientPlayers)",
		"pEngineServer->ResetPVS(vecPVSBytes.data(), nPVSByteCount)",
		"pEngineServer->AddOriginToPVS(Origin)",
		"pEngineServer->SetAreaPortalState(nAreaPortalNumber, nAreaPortalState)",
		"pEngineServer->CheckHeadnodeVisible(nHeadNodeIndex, vecPVSBytes.data(), nPVSByteCount) != 0",
		"pEngineServer->CheckAreasConnected(nFirstAreaNumber, nSecondAreaNumber) != 0",
		"pEngineServer->GetArea(Origin)",
		"pEngineServer->GetAreaBits(nAreaNumber, vecAreaStateBytes.data(), nAreaStateByteCount)",
		"pEngineServer->GetAreaPortalPlane(Origin, nAreaPortalKey, &AreaPortalPlane)",
		"pEngineServer->SetAreaPortalStates(vecAreaPortalNumbers.data(), vecOpenStates.data(), nAreaPortalStateCount)",
		"pEngineServer->GetPlayerNetInfo(nPlayerIndex)",
		"pEngineServer->LoadGameState(strMapName.c_str(), bCreatePlayers)",
		"pEngineServer->LoadAdjacentEnts(strPreviousLevelName.c_str(), strLandmarkName.c_str())",
		"pEngineServer->TextMessageGet(strTextMessageName.c_str())",
		"pEngineServer->GetPlayerInfo(nPlayerIndex, &PlayerInformation)",
		"pEngineServer->GetClientSteamID(pClientEdict, bValidatedOnly)",
		"pEngineServer->Con_NPrintf(nConsolePosition, kConsoleMessageFormat, strConsoleMessage.c_str())",
		"pEngineServer->Con_NXPrintf(&ConsolePrintInformation, kConsoleMessageFormat, strConsoleMessage.c_str())",
		"pEngineServer->ClientCommandKeyValues(pClientEdict, pNativeKeyValues)",
		"pEngineServer->GetEntityTransmitBitsForClient(nClientIndex)",
		"pEngineServer->NotifyEdictFlagsChange(nEntityIndex)",
		"pEngineServer->GetPrevCheckTransmitInfo(pEntityEdict)",
		"pEngineServer->GetSharedEdictChangeInfo()",
		"pEngineServer->GetChangeAccessor(pEntityEdict)",
		"pEngineServer->CreateSpatialPartition(WorldMinimum, WorldMaximum)",
		"pEngineServer->DestroySpatialPartition(pSpatialPartition)",
		"pEngineServer->DrawMapToScratchPad(pScratchPad3D, unDrawFlags)",
		"pEngineServer->SolidMoved(pEntityEdict, pCollideable, pPreviousOrigin, bTestSurroundingBoundsOnly)",
		"pEngineServer->TriggerMoved(pEntityEdict, bTestSurroundingBoundsOnly)",
		"pEngineServer->BuildEntityClusterList(pEntityEdict, pPVSInformation)",
		"pEngineServer->CleanUpEntityClusterList(pPVSInformation)",
		"pEngineServer->PlaybackTempEntity(RecipientFilter, flDelay, pchSenderMemory, pSendTable, nServerClassIndex)",
		"PrepareKeyValuesOwnershipTransfer(pIsolate, LocalContext, LocalKeyValuesValue)",
		"ReleaseKeyValuesOwnershipToEngine(pNativeKeyValues)",
		"GetEntityIndexFromBaseHandleValue(ClientHandle, nCurrentClientIndex)",
		"GetEntityBaseHandleFromEdictAddress(pClientEdict, ClientHandle)",
		"pEngineServer->GetGameServerSteamID()",
		"pEngineServer->GetServerVersion()",
		"pEngineServer->MultiplayerEndGame()",
		"pEngineServer->CreateFakeClientEx(strFakeClientName.c_str(), bReportFakeClient)",
		"pEngineServer->GetLaunchOptions()",
		"pEngineServer->IsUserIDInUse(nUserID)",
		"pEngineServer->GetLoadingProgressForUserID(nUserID)",
		"pEngineServer->IsLogEnabled()",
		"pEngineServer->GetTimescale()",
		"pEngineServer->SetTimescale(flTimescale)",
		"pEngineServer->IsLevelMainMenuBackground()",
		"pEngineServer->IsAnyClientLowViolence()",
		"pEngineServer->IsOverrideLoadGameEntsOn()",
		"pEngineServer->IsCreatingReslist()",
		"pEngineServer->IsCreatingXboxReslist()",
		"pEngineServer->IsDedicatedServerForXbox()",
		"pEngineServer->IsDedicatedServerForPS3()",
		"pEngineServer->IsSplitScreenPlayer(nPlayerIndex)",
		"pEngineServer->GetSplitScreenPlayerAttachToEdict(nReferenceIndex)",
		"pEngineServer->GetSplitScreenPlayerForEdict(nReferenceIndex, nSplitScreenSlot)",
		"pEngineServer->GetNumSplitScreenUsersAttachedToEdict(nEntityIndex)",
		"pEngineServer->ForceFlushEntity(nEntityIndex)",
		"pEngineServer->GetSinglePlayerSharedMemorySpace(strSharedMemoryName.c_str(), nEntityIndex)",
		"pEngineServer->Pause(bPaused, bForcePauseState)",
		"pEngineServer->HostValidateSession()",
		"pEngineServer->RefreshScreenIfNecessary()",
		"pEngineServer->GetAchievementMgr()",
		"using AchievementManagerAddressType = decltype(pEngineServer->GetAchievementMgr());",
		"pEngineServer->SetAchievementMgr(static_cast<AchievementManagerAddressType>(pAchievementManager))",
		"pServerGameDLL->ServerHibernationUpdate(bHibernating)",
		"pServerGameDLL->SetServerHibernation(bHibernating)",
		"pEngineServer->SetGameTimescale(flTimescale)",
		"pEngineServer->HasPaintmap()",
		"pEngineServer->RemoveAllPaint()",
		"pEngineServer->PaintAllSurfaces(unPaintColorValue)",
		"pEngineServer->GetClientXUID(pClientEdict)",
		"pEngineServer->IsActiveApp()",
		"pEngineServer->SetNoClipEnabled(bNoClipEnabled)",
		"pEngineServer->GetPaintmapDataRLE(vecPaintMapDataRLE)",
		"pEngineServer->LoadPaintmapDataRLE(vecPaintMapDataRLE)",
		"pEngineServer->SendPaintmapDataToClient(pClientEdict)",
		"pEngineServer->GetLatencyForChoreoSounds()",
		"pEngineServer->GetClientCrossPlayPlatform(nClientIndex)",
		"pEngineServer->EnsureInstanceBaseline(nEntityIndex)",
		"pEngineServer->ReserveServerForQueuedGame(strQueuedGameReservationPayload.c_str())",
		"pEngineServer->CreateEdict(nForcedEntityIndex)",
		"pEngineServer->RemoveEdict(pEntityEdict)",
		"pEngineServer->EmitAmbientSound(nSoundEntityIndex, SoundPosition, strSoundSampleName.c_str(), flSoundVolume, static_cast<soundlevel_t>(nSoundLevel), nSoundFlags, nSoundPitch, flSoundDelay)",
		"pEngineServer->ClientCommand(pPlayerEdict, \"%s\", strCommand.c_str())",
		"pEngineServer->ClientPrintf(pPlayerEdict, strConsoleMessage.c_str())",
		"pEngineServer->SentenceGroupPick(nSentenceGroupIndex, szSentenceName, static_cast<int>(kSentenceNameBufferSize))",
		"pEngineServer->SentenceGroupPickSequential(nSentenceGroupIndex, szSentenceName, static_cast<int>(kSentenceNameBufferSize), nSentenceIndex, nSequenceReset)",
		"pEngineServer->LightStyle(nLightStyle, LightPatternAllocation.m_pszLightPattern)",
		"pEngineServer->CreateFakeClient(strFakeClientName.c_str())",
		"pEngineServer->StartQueryCvarValue(pClientEdict, strCVarName.c_str())",
		"pEngineServer->IsClientFullyAuthenticated(pClientEdict)",
		"pEngineServer->GetMapEntitiesString()",
	]:
		if strRequiredExpression not in strBindings:
			return Fail(f"engines/server must call the selected SDK IVEngineServer directly: {strRequiredExpression}")

	strSoundCallbackBlock = strBindings.split("void PrecacheSoundCallback", 1)[1].split("void TraceRayCallback", 1)[0]
	strPrecacheSoundCallbackBlock = strSoundCallbackBlock.split("void IsSoundPrecachedCallback", 1)[0]
	strSoundHelperBlock = strBindings.split("class SourceJSSoundRecipientFilter", 1)[1].split("#endif", 1)[0]
	for strForbiddenExpression in [
		"Args.GetReturnValue().Set(false);",
		"Args.GetReturnValue().Set(0);",
		"Int32Value(LocalContext).FromMaybe(",
		"NumberValue(LocalContext).FromMaybe(",
		'SoundGetObjectValue(pIsolate, LocalContext, LocalOptions, "index")',
	]:
		if strForbiddenExpression in strSoundCallbackBlock:
			return Fail(f"native engines/sound binding must throw instead of fabricating fallback results: {strForbiddenExpression}")

	for strForbiddenExpression in [
		"(Args.Length() > 1) ? Args[1]->BooleanValue",
		"(Args.Length() > 2) ? Args[2]->BooleanValue",
	]:
		if strForbiddenExpression in strPrecacheSoundCallbackBlock:
			return Fail(f"native sound precache binding must reject non-boolean flags: {strForbiddenExpression}")

	for strForbiddenExpression in [
		"SoundNumberFromObject",
		"return LocalValue->NumberValue(LocalContext).FromMaybe",
		"return LocalValue->Int32Value(LocalContext).FromMaybe",
		'SoundGetObjectValue(pIsolate, LocalContext, LocalOptionsObject, "index")',
	]:
		if strForbiddenExpression in strSoundHelperBlock:
			return Fail(f"native engines/sound helpers must throw instead of coercing invalid numeric values: {strForbiddenExpression}")

	for strRequiredExpression in [
		"IEngineSound* RequireEngineSoundInterface",
		"bool ReadOptionalEngineBooleanArgument",
		"!LocalOptionalBooleanValue->IsUndefined()",
		"bool RequireSoundIntegerFromValue",
		"bool GetSoundFloatPropertyFromObject",
		"bool GetSoundIntegerPropertyFromObject",
		"bool RequireSoundStringFromValue",
		"bool GetSoundBooleanPropertyFromObject",
		"bool CollectSoundOrigins",
		"bool CollectSoundRecipients",
		"bool GetSoundRecipientIndexFromValue",
		"bool CollectSoundRecipientIndicesFromValue",
		"CollectSoundRecipientIndicesFromValue(pIsolate, LocalContext, LocalRecipientValue, pszOperationName, vecValidatedRecipientIndices)",
		'LocalValue->IsBoolean()',
		'LocalValue->IsArray()',
		'!IsValueNullish(LocalRecipientIndexesValue)',
		'std::string const strRecipientIndexesTypeError = std::string(pszOperationName) + " recipient filter " + kRecipientIndexesPropertyName + " must be an array.";',
		'" recipients expect positive player indexes."',
		"constexpr bool kSDKHasIsLoopingSound",
		'InstallSDKFunction<kSDKHasIsLoopingSound<IEngineSound>>(pIsolate, LocalContext, LocalEngineSoundModule, "IsLoopingSound"',
		'InstallSDKFunction<kSDKHasPrecacheSentenceGroup<IEngineSound>>(pIsolate, LocalContext, LocalEngineSoundModule, "PrecacheSoundSentenceGroup"',
		'" requires IEngineSound."',
		'RequireEngineSoundInterface(pIsolate, kAPIName)',
		'if (CallbackInformation.Length() <= kSampleArgumentIndex)',
		'ReadOptionalEngineBooleanArgument(CallbackInformation, kPreloadArgumentIndex, kPreloadTypeErrorMessage, bPreload)',
		'ReadOptionalEngineBooleanArgument(CallbackInformation, kUISoundArgumentIndex, kUISoundTypeErrorMessage, bUISound)',
		'"engines/sound.PrecacheSound() bUISound must be a boolean."',
		'ThrowError(pIsolate, kEmptySampleErrorMessage)',
		'engines/sound.IsSoundPrecached() requires a non-empty strSample.',
		'engines/sound.PrefetchSound() requires a non-empty strSample.',
		'engines/sound.IsLoopingSound() requires a non-empty strSample.',
		'engines/sound.GetSoundDuration() requires a non-empty strSample.',
		'engines/sound.EmitSound() Entity expects an integer or entity object.',
		'engines/sound.EmitSound() Volume expects a finite numeric value.',
		'engines/sound.EmitSound() Attenuation expects a finite numeric value.',
		'engines/sound.EmitSound() UpdatePositions expects a boolean.',
		'engines/sound.EmitSound() SoundTime expects a finite numeric value.',
		'engines/sound.EmitSound() Reliable expects a boolean.',
		'engines/sound.EmitSound() Origins expects an array of vectors.',
		'engines/sound Origins expects vector entries.',
		'engines/sound.StopSound() Entity expects an integer or entity object.',
		'engines/sound.StopSound() Channel expects an integer.',
		'engines/sound.SetSoundRoomType() nRoomType expects an integer.',
		'engines/sound.SetSoundRoomType() bReliable expects a boolean.',
		'engines/sound.SetPlayerDSP() nDSPType expects an integer.',
		'engines/sound.SetPlayerDSP() bFastReset expects a boolean.',
		'engines/sound.GetDistanceGainFromSoundLevel() nSoundLevel expects an integer.',
		'engines/sound.GetDistanceGainFromSoundLevel() flDistance expects a finite numeric value.',
		'engines/sound.PrecacheSoundSentenceGroup() requires a non-empty strGroupName string.',
	]:
		if strRequiredExpression not in strBindings:
			return Fail(f"strict native engines/sound binding missing: {strRequiredExpression}")

	strTraceCallbackBlock = strBindings.split("bool RequireTraceVectorFromValue", 1)[1].split("void IsDedicatedServerCallback", 1)[0]
	for strForbiddenExpression in [
		"Args.GetReturnValue().Set(v8::Array::New",
		"Args.GetReturnValue().Set(false);",
		"Args.GetReturnValue().Set(0);",
		"Args.GetReturnValue().Set(-1);",
		'"EverythingFilterProps"',
		'"hitgroup"',
		'"physicsbone"',
		'"signbits"',
	]:
		if strForbiddenExpression in strTraceCallbackBlock:
			return Fail(f"native engines/trace binding must throw instead of fabricating fallback results: {strForbiddenExpression}")

	for strRequiredExpression in [
		"IEngineTrace* RequireEngineTraceInterface",
		'" requires IEngineTrace."',
		'RequireEngineTraceInterface(pIsolate, kAPIName)',
		'SetRecordProperty(pIsolate, LocalContext, LocalTraceTypeObject, "EverythingFilterProperties", v8::Integer::New(pIsolate, TRACE_EVERYTHING_FILTER_PROPS))',
		'"engines/trace.EnumerateEntitiesInBox() requires MinimumBounds and MaximumBounds vectors."',
		'"engines/trace filter ShouldHitEntity(EntityInformation, nContentsMask) must return a boolean."',
		'"engines/trace enumerator EnumEntity(EntityInformation) must return a boolean."',
		'"engines/trace.EnumerateEntities() bIncludeTriggers expects a boolean."',
		'"engines/trace.TraceRay() Target expects an object."',
		'"engines/trace.SweepCollideable() Target expects an object."',
		'SetRecordProperty(pIsolate, LocalContext, LocalPlaneObject, kSignBitsPropertyName, v8::Integer::New(pIsolate, PlaneInformation.signbits))',
		'SetResultProperty(kHitGroupPropertyName, v8::Integer::New(pIsolate, TraceInformation.hitgroup))',
		'SetResultProperty(kPhysicsBonePropertyName, v8::Integer::New(pIsolate, TraceInformation.physicsbone))',
		'const bool bHasTraceTarget = !IsValueNullish(LocalTargetValue) && LocalTargetValue->IsObject() && !LocalTargetValue->IsArray();',
		'return SetValue(pIsolate, LocalContext, LocalTraceResultObject, pszPropertyName, LocalValue);',
		'return SetRecordProperty(pIsolate, LocalContext, LocalTraceResultObject, pszPropertyName, LocalValue);',
		'LocalEntityIndexArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unEntityIndexPosition), LocalEntityIndexValue).FromMaybe(false)',
		'if (!LocalTargetValue->IsObject() || LocalTargetValue->IsArray())',
		'if (!TraceFilterAdapter.IsValid())',
		'if (!TraceEnumerator.IsValid())',
	]:
		if strRequiredExpression not in strBindings:
			return Fail(f"strict native engines/trace binding missing: {strRequiredExpression}")

	strPrecacheCallbackBlock = strBindings.split("void PrecacheEngineModelCallback", 1)[1].split("enum class GlobalsInformationProperty", 1)[0]
	for strForbiddenExpression in [
		"g_Application.GetEngineInterfaces().GetEngine()",
		"Args.GetReturnValue().Set(0);",
	]:
		if strForbiddenExpression in strPrecacheCallbackBlock:
			return Fail(f"native engines/precache binding must require IVEngineServer and throw instead of returning 0: {strForbiddenExpression}")

	for strRequiredExpression in [
		'RequireEngineServer(pIsolate, kOperationName)',
	]:
		if strRequiredExpression not in strBindings:
			return Fail(f"strict native engines/precache binding missing: {strRequiredExpression}")

	strGlobalsInformationBlock = strBindings.split("enum class GlobalsInformationProperty", 1)[1].split("edict_t* RequireMessagePlayerEdict", 1)[0]
	for strRequiredExpression in [
		"auto* const pGlobalVariables = RequireEngineGlobalVariables(pIsolate);",
		"CallbackInformation.GetReturnValue().Set(pGlobalVariables->curtime);",
		"pGlobalVariables->curtime = flCurrentTime;",
		"GetGlobalVariablesInformationPropertyCallback, SetGlobalVariablesInformationPropertyValueCallback",
		"void GetGlobalVariablesCallback",
		"v8::MaybeLocal<v8::Object> MakeGlobalVariablesInformationObject",
		"bool GetGlobalVariablesFloatFromValue",
		"bool GetGlobalVariablesIntegerFromValue",
		"bool GetGlobalVariablesBooleanFromValue",
		"bool GetGlobalVariablesAddressFromValue",
		'InstallGlobalVariablesInformationProperty(pIsolate, LocalContext, LocalGlobalVariablesInformation, PropertyBindingInformation.m_pszPropertyName, PropertyBindingInformation.m_PropertyInformation)',
		'"Address", GlobalsInformationProperty::GlobalsInformationAddress',
		'"RealTime", GlobalsInformationProperty::GlobalsInformationRealTime',
		'"FrameCount", GlobalsInformationProperty::GlobalsInformationFrameCount',
		'"AbsoluteFrameTime", GlobalsInformationProperty::GlobalsInformationAbsoluteFrameTime',
		'"CurrentTime", GlobalsInformationProperty::GlobalsInformationCurrentTime',
		'"FrameTime", GlobalsInformationProperty::GlobalsInformationFrameTime',
		'"MaximumClients", GlobalsInformationProperty::GlobalsInformationMaximumClients',
		'"TickCount", GlobalsInformationProperty::GlobalsInformationTickCount',
		'"IntervalPerTick", GlobalsInformationProperty::GlobalsInformationIntervalPerTick',
		'"InterpolationAmount", GlobalsInformationProperty::GlobalsInformationInterpolationAmount',
		'"SaveRestoreDataAddress", GlobalsInformationProperty::GlobalsInformationSaveRestoreDataAddress',
		'"MapName", GlobalsInformationProperty::GlobalsInformationMapName',
		'"MapVersion", GlobalsInformationProperty::GlobalsInformationMapVersion',
		'"StartSpot", GlobalsInformationProperty::GlobalsInformationStartSpot',
		'"MapLoadType", GlobalsInformationProperty::GlobalsInformationMapLoadType',
		'"MapLoadFailed", GlobalsInformationProperty::GlobalsInformationMapLoadFailed',
		'"IsDeathmatch", GlobalsInformationProperty::GlobalsInformationIsDeathmatch',
		'"IsCooperative", GlobalsInformationProperty::GlobalsInformationIsCooperative',
		'"IsTeamplay", GlobalsInformationProperty::GlobalsInformationIsTeamplay',
		'"MaximumEntities", GlobalsInformationProperty::GlobalsInformationMaximumEntities',
		'"AbsoluteFrameStartTimeStandardDeviation", GlobalsInformationProperty::GlobalsInformationAbsoluteFrameStartTimeStandardDeviation',
		'"ServerCount", GlobalsInformationProperty::GlobalsInformationServerCount',
		'"EdictArrayAddress", GlobalsInformationProperty::GlobalsInformationEdictArrayAddress',
		'"MapGroupName", GlobalsInformationProperty::GlobalsInformationMapGroupName',
		'SetRecordFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, "IsRemoteClient", IsGlobalVariablesRemoteClientCallback',
		'SetRecordFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, "IsClient", IsGlobalVariablesClientCallback',
		'SetRecordFunction(pIsolate, LocalContext, LocalGlobalVariablesInformation, "GetNetworkBase", GetGlobalVariablesNetworkBaseCallback',
		"kSDKHasGlobalAbsoluteFrameStartTimeStandardDeviation<CGlobalVars>",
		"kSDKHasGlobalServerCount<CGlobalVars>",
		"kSDKHasGlobalEdictArrayAddress<CGlobalVars>",
		"kSDKHasGlobalMapGroupName<CGlobalVars>",
		"kSDKHasGlobalIsRemoteClient<CGlobalVars>",
		"kSDKHasGlobalSimulatedTicksThisFrame<CGlobalVars>",
		"kSDKHasGlobalNetworkProtocol<CGlobalVars>",
		"kSDKHasGlobalMapLoadFailed<CGlobalVars>",
		"kSDKHasGlobalIsClient<CGlobalVars>",
		"kSDKHasGlobalGetNetworkBase<CGlobalVars>",
	]:
		if strRequiredExpression not in strGlobalsInformationBlock:
			return Fail(f"strict native globals.GetGlobalVariables() binding missing: {strRequiredExpression}")

	for strRequiredExpression in [
		"bool InstallMapLoadTypeConstants",
		"kNewGamePropertyName, v8::Integer::New(pIsolate, MapLoad_NewGame)",
		"kLoadGamePropertyName, v8::Integer::New(pIsolate, MapLoad_LoadGame)",
		"kTransitionPropertyName, v8::Integer::New(pIsolate, MapLoad_Transition)",
		"kBackgroundPropertyName, v8::Integer::New(pIsolate, MapLoad_Background)",
		"InstallMapLoadTypeConstants(pIsolate, LocalContext, LocalGlobalsModule)",
	]:
		if strRequiredExpression not in strBindings:
			return Fail(f"strict native globals MapLoadType binding missing: {strRequiredExpression}")

	for strForbiddenExpression in [
		"g_Application.GetEngineInterfaces().GetGlobals()",
		"if (pGlobals) {",
		"v8::Local<v8::Object> LocalObject = v8::Object::New(pIsolate);\n\n\t\tif",
		"FromMaybe(0.0)",
		"ValueToString(pIsolate, LocalValue)",
	]:
		if strForbiddenExpression in strGlobalsInformationBlock:
			return Fail(f"native globals.GetGlobalVariables() binding must stay live instead of snapshotting CGlobalVars: {strForbiddenExpression.splitlines()[0]}")

	return 0

def CheckWorkflows():
	strWorkflow = ReadText(ROOT / ".github" / "workflows" / "build.yml")
	strReusableWorkflow = ReadText(ROOT / ".github" / "workflows" / "build-sdk-branch.yml")
	strWindowsV8Script = ReadText(ROOT / "v8.bat")
	strLinuxV8Script = ReadText(ROOT / "v8.sh")

	if ("\t" in strWorkflow) or ("\t" in strReusableWorkflow):
		return Fail("GitHub Actions YAML must use spaces instead of tabs")

	for strRequiredToken in [
		"call git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git depot_tools",
		"call git fetch --tags",
		"call git checkout 14.4.230",
		"setlocal EnableExtensions DisableDelayedExpansion",
		"if not defined SOURCEJS_V8_CONFIGS",
		'SOURCEJS_V8_CONFIGS -cnotmatch',
		r'\A[0-9]+\z',
		'pushd "v8"',
		"goto :BuildFailed",
		"call :RestoreBuildState",
		"call chcp %SOURCEJS_V8_ORIGINAL_CODE_PAGE% >nul",
		"echo V8_BUILD_SUCCESS",
		"echo V8_BUILD_FAILURE",
		'if "%~1"=="--help"',
	]:
		if strRequiredToken not in strWindowsV8Script:
			return Fail(f"v8.bat must preserve validated V8 build and cleanup contracts: {strRequiredToken}")

	nV8Validation = strWindowsV8Script.find("SOURCEJS_V8_CONFIGS -cnotmatch")
	nV8DependencyCommand = strWindowsV8Script.find("call git clone")
	if (nV8Validation < 0) or (nV8DependencyCommand < 0) or (nV8Validation >= nV8DependencyCommand):
		return Fail("v8.bat must validate build settings before dependency commands")

	for strRequiredToken in [
		'if [[ "${BASH_SOURCE[0]}" != "${0}" ]]',
		'ShowUsage() {',
		'if [[ ! "${SOURCEJS_V8_CONFIGS}" =~',
		r'"${SOURCEJS_V8_JOBS}" =~ ^[0-9]+$',
		'readonly g_strBuildRoot=',
		'trap \'FinishBuild "$?"\' EXIT',
		"trap 'exit 130' INT",
		"trap 'exit 143' TERM",
		'cd -- "${g_strBuildRoot}"',
		'git checkout 14.4.230',
		'gclient sync -D',
		'./build/install-build-deps.sh --no-prompt --lib32',
		r"printf 'V8_BUILD_SUCCESS\n'",
		r"printf 'V8_BUILD_FAILURE\n'",
		'exit "${nResult}"',
	]:
		if strRequiredToken not in strLinuxV8Script:
			return Fail(f"v8.sh must preserve validated V8 build and cleanup contracts: {strRequiredToken}")

	nLinuxV8Validation = strLinuxV8Script.find('if [[ ! "${SOURCEJS_V8_CONFIGS}" =~')
	nLinuxV8ExitTrap = strLinuxV8Script.find('trap \'FinishBuild "$?"\' EXIT')
	nLinuxV8DependencyCommand = strLinuxV8Script.find("git clone https://")
	if (nLinuxV8Validation < 0) or (nLinuxV8ExitTrap < nLinuxV8Validation) or (nLinuxV8DependencyCommand < nLinuxV8ExitTrap):
		return Fail("v8.sh must validate settings and install cleanup before dependency commands")

	if "windows-latest" in strWorkflow:
		return Fail("build.yml must pin Visual Studio 2022 jobs to the windows-2022 runner")

	if "runs-on: windows-2022" not in strWorkflow:
		return Fail("build.yml must prepare the Windows V8 cache on the windows-2022 runner")

	TriggerBlock = re.search(r"^on:\n(.*?)(?=^\S|\Z)", strWorkflow, re.MULTILINE | re.DOTALL)
	if (TriggerBlock is None) or (re.findall(r"^  ([a-z_]+):", TriggerBlock.group(1), re.MULTILINE) != ["workflow_dispatch"]):
		return Fail("build.yml must start only on manual workflow_dispatch")

	SDKInput = re.search(r"^      sdk:\n(.*?)(?=^      [a-z_]+:|\Z)", TriggerBlock.group(1), re.MULTILINE | re.DOTALL)
	if (SDKInput is None) or (re.findall(r"^          - ([a-z0-9]+)$", SDKInput.group(1), re.MULTILINE) != SDK_BRANCHES):
		return Fail("manual SDK choices must match the supported branch inventory")

	if ("strategy:" in strWorkflow) or ("matrix:" in strWorkflow):
		return Fail("manual builds must not fan out to a build matrix")

	strJobs = strWorkflow.split("\njobs:\n", 1)[-1]
	mapWorkflowJobBlocks = {
		Match.group(1): Match.group(2)
		for Match in re.finditer(r"^  ([a-z0-9_-]+):\n(.*?)(?=^  [a-z0-9_-]+:|\Z)", strJobs, re.MULTILINE | re.DOTALL)
	}
	if set(mapWorkflowJobBlocks) != {"select-target", "prepare-v8-linux", "prepare-v8-windows", "build"}:
		return Fail("manual workflow must validate one target, prepare its V8 cache and invoke one SDK build")

	strTargetSelector = mapWorkflowJobBlocks["select-target"]
	if 'tools/select_github_build_target.py "${SOURCEJS_SDK}" "${SOURCEJS_PLATFORM}" "${SOURCEJS_ARCH}"' not in strTargetSelector:
		return Fail("manual workflow must validate the SDK target before build preparation")

	for strPlatform in ("linux", "windows"):
		strPreparation = mapWorkflowJobBlocks[f"prepare-v8-{strPlatform}"]
		for strRequiredToken in [
			"needs: select-target",
			"inputs.platform == '" + strPlatform + "'",
			"sourcejs-v8-" + strPlatform + "-${{ inputs.arch }}",
		]:
			if strRequiredToken not in strPreparation:
				return Fail(f"V8 preparation must use only the requested platform and architecture: {strRequiredToken}")

	strBuild = mapWorkflowJobBlocks["build"]
	for strRequiredToken in [
		"needs.select-target.result == 'success'",
		"uses: ./.github/workflows/build-sdk-branch.yml",
		"sdk_ref: ${{ needs.select-target.outputs.sdk_ref }}",
		"arch: ${{ inputs.arch }}",
		"v8_config: ${{ format('{0}.release', inputs.arch) }}",
	]:
		if strRequiredToken not in strBuild:
			return Fail(f"manual workflow build contract missing {strRequiredToken}")

	vecSelectorCommand = [sys.executable, "-B", str(ROOT / "tools" / "select_github_build_target.py")]
	Supported = subprocess.run([*vecSelectorCommand, "l4d2", "linux", "x86"], capture_output=True, text=True, timeout=15)
	if (Supported.returncode != 0) or (Supported.stdout != f"sdk_ref={SDK_BRANCH_REFS['l4d2']}\n"):
		return Fail("manual build selector must return the pinned revision for a supported target")

	Unsupported = subprocess.run([*vecSelectorCommand, "portal2", "linux", "x86"], capture_output=True, text=True, timeout=15)
	if (Unsupported.returncode != 2) or Unsupported.stdout or ("Unsupported SDK target" not in Unsupported.stderr):
		return Fail("manual build selector must reject unsupported targets without emitting a revision")

	for strRequiredToken in [
		"uses: actions/upload-artifact@",
		"name: sourcejs-${{ inputs.platform }}-${{ inputs.safe_name }}-${{ inputs.arch }}",
		"if-no-files-found: error",
	]:
		if strRequiredToken not in strReusableWorkflow:
			return Fail(f"reusable workflow artifact contract missing {strRequiredToken}")

	for strRequiredPath in [
		"addons/sourcejs.vdf",
		"addons/sourcejs",
		"addons/sourcejs/bin",
		"addons/sourcejs/bin/sourcejs.dll",
		"addons/sourcejs/bin/sourcejs.so",
		"addons/sourcejs/gamedata",
		"addons/sourcejs/docs/sourcejs/architecture.md",
		"addons/sourcejs/docs/sourcejs/external-libraries.md",
		"addons/sourcejs/extensions",
		"addons/sourcejs/extensions/.keep",
		"addons/sourcejs/packages/sourcejs",
		"addons/sourcejs/packages/sourcejs/index.js",
		"addons/sourcejs/packages/sourcejs/weapons/engines/csgo.js",
		"addons/sourcejs/data/languages.ini",
		"addons/sourcejs/data/sourcejs/memory/l4d2/GlobalAddresses.ini",
		"addons/sourcejs/data/sourcejs/teams/left4dead2.ini",
		"addons/sourcejs/data/sourcejs/weapons/constants/csgo/WeaponID.ini",
		"addons/sourcejs/plugins/server-administration/index.js",
		"addons/sourcejs/plugins/server-administration/plugin.json",
		"addons/sourcejs/plugins/disabled/api-external-libraries/index.js",
		"addons/sourcejs/plugins/disabled/api-external-libraries/plugin.json",
		"addons/sourcejs/plugins/disabled/plugin-bus/index.js",
		"addons/sourcejs/plugins/disabled/plugin-bus/plugin.json",
		"cfg/sourcejs",
		"logs/sourcejs",
	]:
		if strRequiredPath not in strReusableWorkflow:
			return Fail(f"reusable workflow package check is missing {strRequiredPath}")

	for strRequiredToken in [
		"Install mandatory external libraries on Linux",
		"Install mandatory external libraries on Windows",
		"Verify mandatory external libraries in Linux binary",
		"soci[mysql,sqlite3]",
		"redis-plus-plus",
		"cpr",
		"CMAKE_TOOLCHAIN_FILE",
		"VCPKG_TARGET_TRIPLET",
		"--overlay-ports",
		"cmake/vcpkg-ports",
		"cmake\\vcpkg-ports",
		"x86-linux",
		"x64-linux",
		"x86-windows-static",
		"x64-windows-static",
		'-DCMAKE_BUILD_TYPE="$env:SOURCEJS_CONFIG"',
		"readelf --wide --syms --demangle",
		"cpr::|soci::|sw::redis::|register_factory_mysql|register_factory_sqlite3",
		'for strPattern in "cpr::" "soci::" "sw::redis::" "register_factory_mysql" "register_factory_sqlite3"',
	]:
		if strRequiredToken not in strReusableWorkflow:
			return Fail(f"reusable workflow external dependency contract missing {strRequiredToken}")

	for strForbiddenToken in [
		"HL2SDK_X64_MATHLIB",
		"hl2sdk-x64-mathlib",
		"Checkout official HL2SDK x64 mathlib",
		"-DHL2SDK_X64_MATHLIB_ROOT=",
	]:
		if strForbiddenToken in strReusableWorkflow:
			return Fail(f"reusable workflow must use only selected-branch SDK libraries: {strForbiddenToken}")

	for strRequiredPath in [
		"cmake/vcpkg-ports/fmt/portfile.cmake",
		"cmake/vcpkg-ports/fmt/vcpkg.json",
		"cmake/vcpkg-ports/fmt/usage",
		"cmake/vcpkg-ports/fmt/fix-uint128-bitwise-not.patch",
		"cmake/vcpkg-ports/soci/portfile.cmake",
		"cmake/vcpkg-ports/soci/vcpkg.json",
		"cmake/vcpkg-ports/soci/usage",
		"cmake/vcpkg-ports/libmysql/portfile.cmake",
		"cmake/vcpkg-ports/libmysql/vcpkg.json",
		"cmake/vcpkg-ports/libmysql/sourcejs-global-dynamic-tls.patch",
	]:
		if not (ROOT / strRequiredPath).exists():
			return Fail(f"required vcpkg overlay file missing: {strRequiredPath}")

	strFMTPortfile = ReadText(ROOT / "cmake" / "vcpkg-ports" / "fmt" / "portfile.cmake")
	strFMTPatch = ReadText(ROOT / "cmake" / "vcpkg-ports" / "fmt" / "fix-uint128-bitwise-not.patch")
	for strRequiredToken in [
		"PATCHES",
		"fix-uint128-bitwise-not.patch",
		"friend constexpr uint128 operator~(uint128 const& Value)",
	]:
		if (strRequiredToken not in strFMTPortfile) and (strRequiredToken not in strFMTPatch):
			return Fail(f"fmt overlay x86-linux uint128 workaround missing {strRequiredToken}")

	strLibMySQLPortfile = ReadText(ROOT / "cmake" / "vcpkg-ports" / "libmysql" / "portfile.cmake")
	strLibMySQLPatch = ReadText(ROOT / "cmake" / "vcpkg-ports" / "libmysql" / "sourcejs-global-dynamic-tls.patch")
	for strRequiredToken in [
		"sourcejs-global-dynamic-tls.patch",
		"-ftls-model=global-dynamic",
	]:
		if (strRequiredToken not in strLibMySQLPortfile) and (strRequiredToken not in strLibMySQLPatch):
			return Fail(f"libmysql shared-plugin TLS workaround missing {strRequiredToken}")

	strSOCIPortfile = ReadText(ROOT / "cmake" / "vcpkg-ports" / "soci" / "portfile.cmake")
	for strRequiredToken in [
		"-DSOCI_LTO=OFF",
		"mysql       SOCI_MYSQL",
		"sqlite3     SOCI_SQLITE3",
		"vcpkg_cmake_config_fixup",
	]:
		if strRequiredToken not in strSOCIPortfile:
			return Fail(f"SOCI overlay static-link contract missing {strRequiredToken}")

	for strRequiredToken in [
		"python3 tools/verify_package_copy.py",
		"python tools/verify_package_copy.py",
		"--package-root",
		"addons/sourcejs/packages/sourcejs",
	]:
		if strRequiredToken not in strReusableWorkflow:
			return Fail(f"reusable workflow installed package freshness contract missing {strRequiredToken}")

	for strRequiredToken in [
		"sdk_ref:",
		'git -C "external/hl2sdk-${{ inputs.safe_name }}" fetch --depth 1 origin "${{ inputs.sdk_ref }}"',
		'git -C "external/hl2sdk-${{ inputs.safe_name }}" checkout --detach FETCH_HEAD',
		'git -C $strSDKDirectory fetch --depth 1 origin "${{ inputs.sdk_ref }}"',
		"git -C $strSDKDirectory checkout --detach FETCH_HEAD",
	]:
		if strRequiredToken not in strReusableWorkflow:
			return Fail(f"reusable workflow pinned HL2SDK checkout contract missing {strRequiredToken}")

	return 0

def CheckSDKSweepContract():
	PathSweep = ROOT / "tools" / "build_sdk_sweep.py"
	if not PathSweep.is_file():
		return Fail("full SDK branch sweep tool is missing")

	strSweepContent = ReadText(PathSweep)
	for strRequiredToken in [
		"from verify_project import ROOT as PathRoot, SDK_BRANCHES as vecSDKBranches, SDK_BRANCH_REFS as objSDKBranchReferences, SDK_SUPPORTED_TARGETS as objSDKSupportedTargets",
		"ThreadPoolExecutor",
		"SourceFingerprint(objArguments.source_root)",
		"ResolveTargets(objArguments.platform, objArguments.branches, objArguments.architectures)",
		'objArgumentParser.add_argument("--architectures", nargs="*", choices=["x86", "x64"])',
		"git",
		"worktree",
		"sourcejs.so",
		"sourcejs.dll",
		'objArgumentParser.add_argument("--resume", action="store_true")',
		'objArgumentParser.add_argument("--keep-failed-builds", action="store_true")',
		'f"{objArguments.platform}-summary.json"',
	]:
		if strRequiredToken not in strSweepContent:
			return Fail(f"full SDK branch sweep contract missing: {strRequiredToken}")

	for strForbiddenToken in [
		'choices=["l4d2", "csgo", "tf2"]',
		'if strBranch in ["l4d2", "csgo", "tf2"]',
	]:
		if strForbiddenToken in strSweepContent:
			return Fail(f"SDK sweep must not be limited to smoke-test branches: {strForbiddenToken}")

	strBuildDocs = ReadText(ROOT / "docs" / "build-l4d2.md")
	for strRequired in [
		"python3 tools/build_sdk_sweep.py",
		"--platform linux",
		"python tools/build_sdk_sweep.py",
		"--platform windows",
		"--resume",
	]:
		if strRequired not in strBuildDocs:
			return Fail(f"full SDK branch sweep documentation missing: {strRequired}")

	return 0

def CheckPluginLifecycleIsolationContract():
	strRuntimeHeader = ReadText(ROOT / "src" / "sourcejs" / "V8Runtime.h")
	strRuntime = ReadText(ROOT / "src" / "sourcejs" / "V8Runtime.cpp")
	strMemoryHookHeader = ReadText(ROOT / "src" / "sourcejs" / "MemoryHookManager.h")
	strMemoryHookRuntime = ReadText(ROOT / "src" / "sourcejs" / "MemoryHookManager.cpp")
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strPluginManager = ReadText(ROOT / "src" / "sourcejs" / "PluginManager.cpp")
	strExtensionManager = ReadText(ROOT / "src" / "sourcejs" / "ExtensionManager.cpp")
	strArchitectureDocumentation = ReadText(ROOT / "docs" / "architecture.md")
	strPluginsDocumentation = ReadText(ROOT / "docs" / "api" / "plugins.md")

	for strRequiredContract in [
		"bool ExecutePluginFile(",
		"void UnloadPlugin(",
		"bool ExecuteCommonJS(",
		"bool CallPluginExportFunction(",
		"struct ScriptCallbackRecord",
		"struct PluginRuntimeRecord",
		"v8::Global<v8::Context> m_Context",
		"v8::Global<v8::Object> m_SourceJSObject",
		"std::map<std::string, v8::Global<v8::Value>> m_mapPackageModuleCache",
		"std::map<std::string, v8::Global<v8::Value>> m_mapLocalModuleCache",
		"v8::Global<v8::Value> m_Exports",
		"std::map<std::string, PluginRuntimeRecord> m_mapPluginRuntimes",
	]:
		if strRequiredContract not in strRuntimeHeader:
			return Fail(f"plugin lifecycle runtime header contract missing: {strRequiredContract}")

	for strRequiredContract in [
		"v8::Local<v8::Context> const LocalContext = v8::Context::New(m_pIsolate);",
		"InstallRuntimeObjects(LocalContext, LocalSourceJSObject)",
		"m_mapPluginRuntimes.insert(",
		'CallPluginExportFunction(strPluginName, "Load")',
		'CallPluginExportFunction(strPluginName, "Unload")',
		"RemoveCallbacksForContext(LocalContext)",
		"GetMemoryHookManager().RemoveContext(LocalContext)",
		"itPluginRuntime->second.m_bUnloading = true;",
		"itRemainingPluginRuntime->second.m_bUnloading = false;",
		"ReleaseSourceJSExternalResources(strPluginName)",
		"itPluginRuntime->second.m_mapPackageModuleCache",
		"itPluginRuntime->second.m_mapLocalModuleCache",
		"strModuleName + \".js\"",
		"std::string const strWrappedSource =",
		"module, exports, __filename, __dirname",
	]:
		if strRequiredContract not in strRuntime:
			return Fail(f"plugin lifecycle runtime contract missing: {strRequiredContract}")

	for strRequiredContract in [
		"pRuntime->ExecutePluginFile(NewPluginRecord.m_PathEntry, NewPluginRecord.m_strName)",
		"auto* const pRuntime = m_pRuntime;",
		"pRuntime->UnloadPlugin(NewPluginRecord.m_strName)",
		'LogError("Plugin load rollback failed Name=\\"%s\\"", NewPluginRecord.m_strName.c_str());',
		"pRuntime->UnloadPlugin(strName)",
		"pPlugin->m_bUnloading = true;",
		"pRemainingPlugin->m_bUnloading = false;",
		'ReadManifestString(PathManifest, "Entry", "index.js")',
		'ReadManifestBoolean(PathManifest, "Autoload", true)',
		"!PluginCandidate.m_bAutoLoad",
	]:
		if strRequiredContract not in strPluginManager:
			return Fail(f"PluginManager must use plugin-aware runtime lifecycle: {strRequiredContract}")

	for strRequiredContract in [
		'ReadManifestString(PathManifest, "Binary", "")',
		'ReadManifestBoolean(PathManifest, "Autoload", true)',
		'HasLegacyControl("binary") || HasLegacyControl("autoload")',
		"!ExtensionCandidate.m_bAutoLoad",
	]:
		if strRequiredContract not in strExtensionManager:
			return Fail(f"ExtensionManager autoload contract missing: {strRequiredContract}")

	PathPlugins = ROOT / "examples" / "plugins"
	PathAdministrationManifest = PathPlugins / "server-administration" / "plugin.json"
	if '"Autoload": true' not in ReadText(PathAdministrationManifest):
		return Fail("the bundled server administration plugin must autoload")

	for PathManifest in (PathPlugins / "disabled").glob("*/plugin.json"):
		if '"Autoload": false' not in ReadText(PathManifest):
			return Fail(f"packaged example must not autoload: {PathManifest.relative_to(ROOT).as_posix()}")

	PathExtensionManifest = ROOT / "examples" / "extensions" / "echo" / "extension.json"
	if '"Autoload": false' not in ReadText(PathExtensionManifest):
		return Fail(f"packaged example must not autoload: {PathExtensionManifest.relative_to(ROOT).as_posix()}")

	for strRequiredContract in [
		"Per-plugin V8 Contexts",
		"one isolated `v8::Context` per plugin",
		"module.exports",
		"exports.Unload",
		"serialized payloads",
	]:
		if strRequiredContract not in (strArchitectureDocumentation + strPluginsDocumentation):
			return Fail(f"plugin lifecycle documentation missing: {strRequiredContract}")

	for strRequiredContract in [
		"struct MemoryHookCallbackRecord",
		"v8::Global<v8::Context> m_Context",
	]:
		if strRequiredContract not in strMemoryHookHeader:
			return Fail(f"memory hook context ownership contract missing: {strRequiredContract}")

	for strRequiredContract in [
		"CallbackRecord.m_Context.Get(pIsolate)",
		"MemoryHookManager::RemoveContext",
		"ResetMemoryHookCallback",
	]:
		if strRequiredContract not in strMemoryHookRuntime:
			return Fail(f"memory hook context lifecycle contract missing: {strRequiredContract}")

	for strRequiredContract in [
		"struct SOCISessionRecord",
		"struct RedisClientRecord",
		"m_strPluginName",
		"RequireExternalPluginName",
		"ReleaseSourceJSExternalResources",
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"external resource plugin ownership contract missing: {strRequiredContract}")

	for strForbiddenContract in [
		"m_mapPluginExports",
		"onLoad",
		"onUnload",
		'strModuleName + ".cjs"',
		"Per-plugin CommonJS scopes",
		"Optional isolate-per-plugin mode",
		"MVP Milestones",
		"export function onUnload",
	]:
		strPattern = rf"(?<![A-Za-z0-9_]){re.escape(strForbiddenContract)}(?![A-Za-z0-9_])"
		if re.search(strPattern, strRuntime + strArchitectureDocumentation + strPluginsDocumentation):
			return Fail(f"plugin lifecycle contract is stale: {strForbiddenContract}")

	return 0

def CheckExamplesDoNotUseAliasDispatch():
	for PathFile in (ROOT / "examples").rglob("*.js"):
		strContent = ReadText(PathFile)
		for strForbiddenPattern in [
			"fallbackName",
			"function callMethod(",
			"callMethod(",
			"/${fallbackName}",
		]:
			if strForbiddenPattern in strContent:
				return Fail(f"example plugin must call the selected SourceJS API directly: {PathFile.relative_to(ROOT)} contains {strForbiddenPattern}")

	return 0

def CheckClientConsoleCommandContract():
	strDispatcherHeader = ReadText(ROOT / "src" / "sourcejs" / "CommandDispatcher.h")
	strDispatcher = ReadText(ROOT / "src" / "sourcejs" / "CommandDispatcher.cpp")
	strPluginHeader = ReadText(ROOT / "src" / "sourcejs" / "SourceJSPlugin.h")
	strPlugin = ReadText(ROOT / "src" / "sourcejs" / "SourceJSPlugin.cpp")
	strLogHeader = ReadText(ROOT / "src" / "sourcejs" / "Log.h")
	strLog = ReadText(ROOT / "src" / "sourcejs" / "Log.cpp")
	strRuntime = ReadText(ROOT / "src" / "sourcejs" / "V8Runtime.cpp")
	strRuntimeHeader = ReadText(ROOT / "src" / "sourcejs" / "V8Runtime.h")
	strEngineInterfaces = ReadText(ROOT / "src" / "sourcejs" / "EngineInterfaces.h")
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strUIExample = ReadText(ROOT / "examples" / "plugins" / "disabled" / "api-ui-data" / "index.js")
	strRuntimeCommands = ReadText(ROOT / "docs" / "runtime-commands.md")
	strLoggerDocumentation = ReadText(ROOT / "docs" / "api" / "loggers.md")

	for strRequired in [
		"void DispatchClient(const int nClientIndex",
		"void PrintClientPluginPage(",
		"void PrintClientExtensionPage(",
		"bool ReadClientPageOffset(",
	]:
		if strRequired not in strDispatcherHeader:
			return Fail(f"client sjs dispatcher header contract missing: {strRequired}")

	for strRequired in [
		"constexpr std::size_t kClientPageSize = 10;",
		'PrintClientLine(nClientIndex, "  sjs version");',
		'"Usage: sjs "',
		'" list [0|10|20|...]"',
		'"Previous: sjs "',
		'"Next: sjs "',
		"pEngine->ClientPrintf(pClientEdict, strClientOutput.c_str())",
		"vecPlugins[unIndex].m_strName",
		"vecExtensions[unIndex].m_strName",
	]:
		if strRequired not in strDispatcher:
			return Fail(f"client sjs dispatcher contract missing: {strRequired}")

	for strRequired in [
		"GetCommandDispatcher().DispatchClient(nEntityIndex, vecArguments)",
		"GetCommandDispatcher().Dispatch(vecArguments)",
		"void CSourceJSPlugin::SetCommandClient(const int nClientIndex)",
		"m_nCommandClientSlot = nClientIndex",
		"int CSourceJSPlugin::GetCommandClient() const noexcept",
		"m_nCommandClientSlot + 1",
	]:
		if strRequired not in strPlugin:
			return Fail(f"client sjs routing contract missing: {strRequired}")

	for strForbidden in [
		"m_nClientCommandIndex",
		"TakeCommandClientSlot",
		"GetListenServerCommandClient",
	]:
		if strForbidden in (strPlugin + strPluginHeader):
			return Fail(f"server sjs routing must not use the retired command source path: {strForbidden}")

	if "ENGINE_LEFT4DEAD2" in (strPlugin + strPluginHeader + strRuntime):
		return Fail("command routing must not select a game-specific client dispatch path")

	for strRequired in [
		"kSourceJSOwnedCommandFlag | FCVAR_GAMEDLL",
		"kSourceJSClientCommandFlags",
	]:
		if strRequired not in strEngineInterfaces:
			return Fail(f"listen-server command flag contract missing: {strRequired}")

	for strRequired in [
		"bool HasClientCommand(std::string const& strCommandName) const",
	]:
		if strRequired not in strRuntimeHeader:
			return Fail(f"listen-server runtime header contract missing: {strRequired}")

	for strRequired in [
		"class ClientConsoleLogScope",
		"ClientConsoleLogScope(ClientConsoleLogScope const&) = delete",
	]:
		if strRequired not in strLogHeader:
			return Fail(f"client logger scope header contract missing: {strRequired}")

	for strRequired in [
		"thread_local int g_nConsoleLogClientIndex = 0;",
		"WriteClientConsolePrint",
		"pEngine->ClientPrintf(pClientEdict, pszLine)",
		"WriteClientConsolePrint(strLine.c_str())",
		"ResolveLinuxSourceSpew",
		'pszMangledName = "_Z6ConMsgPKcz"',
		"dlsym(RTLD_DEFAULT, pszMangledName)",
	]:
		if strRequired not in strLog:
			return Fail(f"client logger routing contract missing: {strRequired}")

	for strRequired in [
		"RuntimeInstance.DispatchCommand(vecArguments[kCommandNameArgumentIndex], vecArguments)",
		"g_SourceJSPlugin.GetCommandClient()",
		"RuntimeInstance.DispatchClientCommand(nClientIndex, vecArguments)",
		"HasClientCommand(strCommandName) ? kSourceJSClientCommandFlags : kSourceJSOwnedCommandFlag",
		"itRegisteredCommand->second.m_pCommand->AddFlags(FCVAR_GAMEDLL)",
		"ClientConsoleLogScope ClientLogScope(nClientIndex)",
		"RequirePluginModuleCallback",
		"MakePluginRequire",
		"RequirePluginLocalModule",
		'strModuleName.rfind("./", kPrefixOffset) == kPrefixOffset',
		'strModuleName.rfind("../", kPrefixOffset) == kPrefixOffset',
		"IsPathWithin(PathPluginRoot, PathParentScript)",
		'm_mapLocalModuleCache[strCacheKey]',
	]:
		if strRequired not in strRuntime:
			return Fail(f"client JavaScript command routing contract missing: {strRequired}")

	if '"Unknown SourceJS module: " + strModuleName' not in strModuleBindings:
		return Fail("unknown SourceJS module errors must identify the requested module")

	if "LocalModule->SetIntegrityLevel(LocalContext, v8::IntegrityLevel::kFrozen)" in strModuleBindings:
		return Fail("native module objects must remain extensible for SourceJS package facades")

	for strRequired in [
		"g_RegisterClientCommand(g_strCommandName, RunClientUIExample)",
		"g_UnregisterSourceCommand(g_strCommandName, RunUIExample)",
		"Chat: true",
		"SenderIndex: unPlayerIndex",
		"messages.SendClientConsoleMessageToRecipients console example.\\n",
	]:
		if strRequired not in strUIExample:
			return Fail(f"api-ui-data client delivery contract missing: {strRequired}")

	for strRequired in [
		"## Client Console View",
		"sjs plugins list [0|10|20|...]",
		"sjs extensions list [0|10|20|...]",
		"also mirrored to the issuing client's console",
	]:
		if strRequired not in (strRuntimeCommands + strLoggerDocumentation):
			return Fail(f"client command documentation missing: {strRequired}")

	return 0

def CheckPluginBusContract():
	unTimeoutSeconds = 30

	PathPluginPackage = ROOT / "packages" / "sourcejs" / "plugins"
	PathPluginBus = PathPluginPackage / "bus.js"
	if not PathPluginBus.is_file():
		return Fail("plugins/bus.js is missing")

	for PathRemovedDuplicate in [PathPluginPackage / "bus.cjs", PathPluginPackage / "bus.d.ts"]:
		if PathRemovedDuplicate.exists():
			return Fail(f"obsolete plugin bus duplicate remains: {PathRemovedDuplicate.relative_to(ROOT)}")

	strPluginBus = ReadText(PathPluginBus)
	strPluginDocumentation = ReadText(ROOT / "docs" / "api" / "plugins.md") + ReadText(ROOT / "docs" / "api" / "plugins-bus.md")

	for strRequiredContract in [
		'const g_strEventPrefix = "SourceJS:Plugins:"',
		"const g_mapCallbackWrappers = new WeakMap()",
		'const g_ListenerRuntime = GetModule("listeners")',
		"g_ListenerRuntime.Emit",
		"g_ListenerRuntime.AddListener",
		"g_ListenerRuntime.RemoveListener",
		"g_ListenerRuntime.GetListenerCount",
		"CreatePluginBusEnvelope(strNormalizedChannelName",
		"PluginBusChannel",
		"module.exports = {",
	]:
		if strRequiredContract not in strPluginBus:
			return Fail(f"plugins/bus.js contract missing: {strRequiredContract}")

	for strForbiddenContract in ["moduleName", "eventPrefix", "export default", "export const", "callbackWrappers", "g_ListenerRuntime.On", "g_ListenerRuntime.Off", "g_ListenerRuntime.ListenerCount"]:
		if strForbiddenContract in strPluginBus:
			return Fail(f"plugins/bus.js contains obsolete API: {strForbiddenContract}")

	for strRequiredContract in [
		'# `require("plugins/bus")`',
		'require("plugins/bus")',
		"SourceJS:Plugins:",
		"decoded copy",
		"does not filter them automatically",
	]:
		if strRequiredContract not in strPluginDocumentation:
			return Fail(f"plugin bus docs/example table missing: {strRequiredContract}")

	PathPluginExample = ROOT / "examples" / "plugins" / "disabled" / "plugin-bus" / "index.js"
	if not PathPluginExample.is_file():
		return Fail("plugin-bus example plugin is missing")

	strPluginExample = ReadText(PathPluginExample)
	for strRequiredContract in [
		'const { CreateChannel } = require("plugins/bus")',
		'const g_MessageChannel = CreateChannel("Examples:PluginBus"',
		"g_MessageChannel.On(OnMessage)",
		"g_MessageChannel.Emit(",
		"g_MessageChannel.Off(OnMessage)",
		"exports.Unload = Cleanup",
	]:
		if strRequiredContract not in strPluginExample:
			return Fail(f"plugin-bus example contract missing: {strRequiredContract}")

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_plugin_bus.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as Error:
		return Fail(f"plugin bus smoke failed to run: {Error}")

	if ProcessResult.returncode != 0:
		return Fail(f"plugin bus smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckTeamSupportedBranches():
	mapExpectedProfiles = {
		"bgt": "berimbau",
		"bms": "bms",
		"csgo": "csgo",
		"css": "cstrike",
		"dods": "dod",
		"hl2dm": "hl2mp",
		"l4d": "left4dead",
		"l4d2": "left4dead2",
		"tf2": "tf",
	}
	setExpectedProfileFiles = {mapExpectedProfiles.get(strBranch, strBranch) for strBranch in SDK_BRANCHES}

	vecPackageRoots = [ROOT / "packages" / "sourcejs"]
	for PathPackageRoot in vecPackageRoots:
		for strRemovedExtension in [".js", ".cjs", ".d.ts"]:
			PathRemovedSDKRegistry = PathPackageRoot / "internal" / f"sdk{strRemovedExtension}"
			if PathRemovedSDKRegistry.exists():
				return Fail(f"obsolete JavaScript SDK branch registry remains: {PathRemovedSDKRegistry.relative_to(ROOT)}")

		PathTeamsPackage = PathPackageRoot / "players" / "teams.js"
		if not PathTeamsPackage.is_file():
			return Fail(f"players/teams.js is missing in package root: {PathPackageRoot.relative_to(ROOT)}")

		for strRemovedExtension in [".cjs", ".d.ts"]:
			PathRemovedTeamsDuplicate = PathPackageRoot / "players" / f"teams{strRemovedExtension}"
			if PathRemovedTeamsDuplicate.exists():
				return Fail(f"obsolete players/teams duplicate remains: {PathRemovedTeamsDuplicate.relative_to(ROOT)}")

		strTeamsPackage = ReadText(PathTeamsPackage)
		if 'GetModule("players/teams")' not in strTeamsPackage:
			return Fail(f"players/teams must expose the selected SDK native object directly: {PathTeamsPackage.relative_to(ROOT)}")

		for strBannedExport in BANNED_PUBLIC_EXPORTS:
			if re.search(rf"\bexport\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type)\s+{re.escape(strBannedExport)}\b", strTeamsPackage):
				return Fail(f"game-specific players/teams export '{strBannedExport}' found in {PathTeamsPackage.relative_to(ROOT)}")

			if re.search(rf"\bmodule\.exports\s*=\s*\{{[\s\S]*?\b{re.escape(strBannedExport)}\s*[:,][\s\S]*?\n\}};", strTeamsPackage):
				return Fail(f"game-specific players/teams export '{strBannedExport}' found in {PathTeamsPackage.relative_to(ROOT)}")

		for strForbiddenContract in [
			"internal/sdk",
			"typeof filesystemRuntime.exists",
			"typeof nativeRuntime.profileOf",
			"typeof nativeRuntime.nameOf",
			"typeof nativeRuntime.numberOf",
			"sourceRuntime().filesystem",
			"sourceRuntime().paths",
		]:
			if strForbiddenContract in strTeamsPackage:
				return Fail(f"players/teams must use strict native APIs in {PathTeamsPackage.relative_to(ROOT)}: {strForbiddenContract}")

	strNativeTeams = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strForbiddenContract in [
		'PathTeams / "generic.ini"',
		'Data.m_strProfile = "generic"',
		'TeamAddName(Data, "un", 0)',
		'strName == "un"',
		'strName == "spec"',
		'strName == "t"',
		'strName == "ct"',
	]:
		if strForbiddenContract in strNativeTeams:
			return Fail(f"native players/teams must not fall back to generic team aliases: {strForbiddenContract}")

	vecRuntimeRoots = [ROOT / "packaging" / "runtime"]
	for PathParent in [ROOT / "package", ROOT / "artifacts"]:
		if not PathParent.is_dir():
			continue

		vecRuntimeRoots.extend([
			PathChild
			for PathChild in PathParent.iterdir()
			if PathChild.is_dir() and (PathChild.name != "sdk-sweep")
		])

	for PathRuntimeRoot in vecRuntimeRoots:
		PathTeamsData = PathRuntimeRoot / "addons" / "sourcejs" / "data" / "sourcejs" / "teams"
		if not PathTeamsData.is_dir():
			return Fail(f"teams data directory missing in {PathRuntimeRoot.relative_to(ROOT)}")

		setActualProfiles = {PathProfile.stem for PathProfile in PathTeamsData.glob("*.ini")}
		setMissingProfiles = setExpectedProfileFiles - setActualProfiles
		if setMissingProfiles:
			return Fail(f"teams data profile files missing in {PathTeamsData.relative_to(ROOT)}: {sorted(setMissingProfiles)}")

	return 0

def CheckMessagesShowMenuChunking():
	PathMessageBase = ROOT / "packages" / "sourcejs" / "messages" / "index.js"
	strMessageBase = ReadText(PathMessageBase)

	for strRequiredContract in [
		'Object.defineProperty(ShowMenu, "ChunkSize", { value: 62, writable: true, enumerable: true, configurable: true });',
		"SplitShowMenuText(strMenuText, unMenuChunkSize)",
		"for (const strCharacter of strMenuText)",
		"CreateByteField(((unIndex + 1) < vecMenuChunks.length) ? 1 : 0)",
		"SendUserMessageToRecipients(TargetReferences, strPayloadMessageName, vecMessageFieldEntries, bReliableDelivery)",
	]:
		if strRequiredContract not in strMessageBase:
			return Fail(f"ShowMenu bitbuffer chunking contract missing '{strRequiredContract}' in {PathMessageBase.relative_to(ROOT)}")

	return 0

def CheckMessagesNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strBlockBoundary in [
		"void SendMessagesClientConsoleMessageCallback",
		"void GetMessagesBackendNameCallback",
		"v8::Local<v8::BigInt> MakeSteamUInt64",
		"void CreateMessagesDialogCallback",
	]:
		if strBlockBoundary not in strModuleBindings:
			return Fail(f"native messages callback block boundary missing: {strBlockBoundary}")

	strClientMessageBindings = strModuleBindings.split("void SendMessagesClientConsoleMessageCallback", 1)[1].split("void GetMessagesBackendNameCallback", 1)[0]
	strAllMessageBindings = strModuleBindings.split("void SendMessagesClientConsoleMessageCallback", 1)[1].split("v8::Local<v8::BigInt> MakeSteamUInt64", 1)[0]

	for strForbiddenContract in [
		"g_Application.GetEngineInterfaces().GetEngine()",
		"g_Application.GetEngineInterfaces().GetServerGameDLL()",
		"Args.GetReturnValue().Set(false);",
		"MessagesSayTextCallback(Args);",
	]:
		if strForbiddenContract in strClientMessageBindings:
			return Fail(f"native messages binding must throw instead of silently falling back: {strForbiddenContract}")

	for strRequiredContract in [
		"void GetMessagesBaseMessageConstantsCallback",
		"void GetMessagesDialogTypeCallback",
		"void GetMessagesDialogTypesCallback",
		'"Notify", HUD_PRINTNOTIFY',
		'"Start", SHAKE_START',
		'"Out", FFADE_OUT',
		'"SCREEN_FADE_FRACTION_BITS", v8::Integer::New(pIsolate, SCREENFADE_FRACBITS)',
		'SetFunction(pIsolate, LocalContext, LocalMessagesModule, "GetBaseMessageConstants", GetMessagesBaseMessageConstantsCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMessagesModule, "GetDialogType", GetMessagesDialogTypeCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMessagesModule, "GetDialogTypes", GetMessagesDialogTypesCallback, LocalRuntimeData)',
		"bool GetMessagesIntegerFromValue",
		"bool GetMessagesUnsignedIntegerFromValue",
		"bool GetMessagesFloatFromValue",
		"bool GetMessagesNumberFromValue",
		"bool GetMessagesColorComponentFromValue",
		"bool GetMessagesColorArrayComponent",
		"bool GetMessagesColorObjectComponent",
		"bool GetMessagesColorStringFromValue",
		"bool SetMessagesKeyValuesFromObject",
		"IServerGameDLL* RequireServerGameDLL",
		"IServerPluginHelpers* RequireServerPluginHelpers",
		"edict_t* RequireMessagePlayerEdict",
		'constexpr char kAPIName[] = "messages.SendClientConsoleMessage()";',
		'constexpr char kAPIName[] = "messages.SendClientCommand()";',
		"RequireEngineServer(pIsolate, kAPIName)",
		'constexpr char kEmptyCommandLineErrorMessage[] = "messages.SendClientCommand(PlayerOrIndex, strCommandLine) requires a non-empty strCommandLine.";',
		"ThrowError(pIsolate, kEmptyCommandLineErrorMessage)",
		'constexpr char kAPIName[] = "messages.GetUserMessageIndex()";',
		'constexpr char kAPIName[] = "messages.GetUserMessageName()";',
		'constexpr char kAPIName[] = "messages.GetUserMessageSize()";',
		"RequireServerGameDLL(pIsolate, kAPIName)",
		'constexpr char kSendUserMessageAPIName[] = "messages.SendUserMessage()";',
		"RequireEngineServer(pIsolate, kSendUserMessageAPIName)",
		'RequireUserMessageType(pIsolate, kSendUserMessageAPIName, strUserMessageName.c_str())',
		'constexpr char kSendSayTextMessageAPIName[] = "messages.SendSayTextMessage()";',
		'RequireUserMessageType(pIsolate, kSendSayTextMessageAPIName, kSayTextUserMessageName)',
		'constexpr char kSendSayText2MessageAPIName[] = "messages.SendSayText2Message()";',
		'RequireUserMessageType(pIsolate, kSendSayText2MessageAPIName, kSayText2UserMessageName)',
		"messages.SendUserMessage() is not implemented by the selected Source SDK.",
		"#endif // bitbuffer-only chat helpers",
		"strMessageName must not contain NUL.",
		"GetMessagesProtobufPrototype(nUserMessageType)",
		"std::unique_ptr<google::protobuf::Message> pProtobufMessage(pProtobufPrototype->New())",
		"WriteMessagesProtobufFields(pIsolate, LocalContext, pProtobufMessage.get(), LocalFieldDefinitions)",
		"pEngineServer->SendUserMessage(UserMessageRecipientFilter, nUserMessageType, *pProtobufMessage)",
		"messages.SendUserMessage() byte field expects an integer value.",
		"messages.SendUserMessage() short field expects an integer value.",
		"messages.SendUserMessage() int field expects an integer value.",
		"messages.SendUserMessage() uint field expects an unsigned integer value.",
		"messages.SendUserMessage() float field expects a finite numeric value.",
		"messages.SendUserMessage() bits field expects an integer bit count.",
		"messages.SendUserMessage() bits field expects bit count between 0 and 32.",
		"messages.SendUserMessage() bits field expects an unsigned integer value.",
		"messages.SendUserMessage() field has an unsupported type.",
		"messages.CreateDialog() Color expects an array or object.",
		"messages.CreateDialog() Color expects red, green, and blue integer components.",
		"messages.CreateDialog() Color expects integer components.",
		"messages.CreateDialog() Color components must be between 0 and 255.",
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native messages binding missing: {strRequiredContract}")

	PathMessageBase = ROOT / "packages" / "sourcejs" / "messages" / "index.js"
	strMessageBase = ReadText(PathMessageBase)

	for strRequiredContract in [
		'const g_MessagesRuntime = GetModule("messages")',
		"const g_BaseMessageConstants = (g_NativeGetBaseMessageConstants === null) ? null : g_NativeGetBaseMessageConstants();",
		"g_BaseMessageConstants.FadeFlags",
		"g_BaseMessageConstants.HUDDestination",
		"g_BaseMessageConstants.ShakeCommand",
		"SCREEN_FADE_FRACTION_BITS",
		"HUD_DESTINATION",
		"SHAKE_COMMAND",
		"FADE_FLAGS",
	]:
		if strRequiredContract not in strMessageBase:
			return Fail(f"{PathMessageBase.relative_to(ROOT)} must fetch message constants from the selected SDK: {strRequiredContract}")

	for strForbiddenContract in [
		"screenFadeFracBits = 9",
		"Notify: 1",
		"StartRumbleOnly: 4",
		"StayOut: 0x0008",
	]:
		if strForbiddenContract in strMessageBase:
			return Fail(f"{PathMessageBase.relative_to(ROOT)} must not hardcode Source SDK message constants: {strForbiddenContract}")

	PathMessageDialog = ROOT / "packages" / "sourcejs" / "messages" / "dialog.js"
	strMessageDialog = ReadText(PathMessageDialog)

	for strRequiredContract in [
		'const g_MessagesRuntime = GetModule("messages")',
		"const g_NativeDialogTypes = g_MessagesRuntime.GetDialogTypes()",
		"const g_DialogTypes = {",
		"Object.freeze(g_DialogTypes)",
		"DIALOG_TYPE: g_DialogTypes",
		"g_DialogTypes.ASK_CONNECT",
	]:
		if strRequiredContract not in strMessageDialog:
			return Fail(f"{PathMessageDialog.relative_to(ROOT)} must fetch dialog types from the selected SDK: {strRequiredContract}")

	for strForbiddenContract in [
		"Msg: 0",
		"Menu: 1",
		"AskConnect: 4",
	]:
		if strForbiddenContract in strMessageDialog:
			return Fail(f"{PathMessageDialog.relative_to(ROOT)} must not hardcode Source SDK dialog types: {strForbiddenContract}")

	for strForbiddenContract in [
		"NumberValue(LocalContext).FromMaybe(0)",
		"NumberValue(LocalContext).FromMaybe(0.0)",
		"Int32Value(LocalContext).FromMaybe(0)",
		"Uint32Value(LocalContext).FromMaybe(0)",
		"Int32Value(LocalContext).FromMaybe(255)",
		"FromMaybe(DIALOG_TEXT)",
		"FromMaybe(10)",
		"ToLocalChecked",
	]:
		if strForbiddenContract in strAllMessageBindings:
			return Fail(f"native messages binding must not coerce bad values to defaults: {strForbiddenContract}")

	strDialogBindings = strModuleBindings.split("void CreateMessagesDialogCallback", 1)[1].split("v8::Local<v8::BigInt> MakeSteamUInt64", 1)[0]
	for strForbiddenContract in [
		"g_Application.GetEngineInterfaces().GetHelpers()",
		"Args.GetReturnValue().Set(false);",
	]:
		if strForbiddenContract in strDialogBindings:
			return Fail(f"native dialog/menu binding must throw instead of silently falling back: {strForbiddenContract}")

	for strRequiredContract in [
		"RequireServerPluginHelpers(pIsolate, kCreateDialogAPIName)",
		"RequireServerPluginHelpers(pIsolate, kShowTextAPIName)",
		"RequireServerPluginHelpers(pIsolate, kHideTextAPIName)",
		"CaptureMessagesRecipientIdentity(pIsolate, LocalContext, LocalDialogPlayerValue, kCreateDialogAPIName, DialogRecipientIdentity)",
		"CaptureMessagesRecipientIdentity(pIsolate, LocalContext, LocalMenuPlayerValue, kShowTextAPIName, MenuRecipientIdentity)",
		"CaptureMessagesRecipientIdentity(pIsolate, LocalContext, LocalMenuPlayerValue, kHideTextAPIName, MenuRecipientIdentity)",
		"RequireMessagesRecipientEdict(pIsolate, DialogRecipientIdentity, kCreateDialogAPIName)",
		"RequireMessagesRecipientEdict(pIsolate, MenuRecipientIdentity, kShowTextAPIName)",
		"RequireMessagesRecipientEdict(pIsolate, MenuRecipientIdentity, kHideTextAPIName)",
		"ThrowError(pIsolate, kCreateDialogArgumentsErrorMessage)",
		"ThrowError(pIsolate, kShowTextArgumentsErrorMessage)",
		"ThrowError(pIsolate, kHideTextArgumentsErrorMessage)",
		'constexpr char kDialogTypeErrorMessage[] = "messages.CreateDialog(PlayerOrIndex, nDialogType, DialogFields, strDialogName?) expects nDialogType to be an integer.";',
		'constexpr char kDialogTypeRangeErrorMessage[] = "messages.CreateDialog(PlayerOrIndex, nDialogType, DialogFields, strDialogName?) received a dialog type not declared by the selected Source SDK branch.";',
		'constexpr char kMenuDisplayTimeErrorMessage[] = "menus.ShowText(PlayerOrIndex, strMenuTitle, strMenuMessage, nMenuDisplayTime?) expects nMenuDisplayTime to be an integer.";',
		'constexpr char kMenuDisplayTimeRangeErrorMessage[] = "menus.ShowText(PlayerOrIndex, strMenuTitle, strMenuMessage, nMenuDisplayTime?) expects nMenuDisplayTime to be non-negative.";',
		'SetFunction(pIsolate, LocalContext, LocalMenusModule, "HideText", HideMenusTextCallback, LocalRuntimeData)',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native dialog/menu binding missing: {strRequiredContract}")

	return 0

def CheckStringTablesNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nStringTablesBegin = strModuleBindings.find("void GetAllStringTablesCallback")
	nStringTablesEnd = strModuleBindings.find("// Engine game rules", nStringTablesBegin)
	if (nStringTablesBegin < 0) or (nStringTablesEnd < 0):
		return Fail("native stringtables callback block could not be located")

	strStringTablesBlock = strModuleBindings[nStringTablesBegin:nStringTablesEnd]
	for strForbiddenContract in [
		"if (!pContainer) {\n\t\t\tArgs.GetReturnValue().Set(LocalArray);",
		"if (!pContainer || Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate));",
		"if (!pContainer || Args.Length() < 2) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate));",
		"if (!pContainer || Args.Length() < 2) {\n\t\t\tArgs.GetReturnValue().Set(-1);",
		"if (!pPaths || Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(StringTablesMakeStringArray(pIsolate, LocalContext, vecAdded));",
	]:
		if strForbiddenContract in strStringTablesBlock:
			return Fail(f"native stringtables binding must throw for missing SDK/runtime prerequisites: {strForbiddenContract.splitlines()[0]}")

	for strRequiredContract in [
		"INetworkStringTableContainer* RequireNetworkStringTableContainer",
		"INetworkStringTable* RequireStringTablesDownloadablesTable",
		'constexpr char const* const kOperationName = "stringtables.GetAllStringTables()";',
		'constexpr char const* const kOperationName = "stringtables.FindStringTable(strStringTableName)";',
		'constexpr char const* const kOperationName = "stringtables.GetString(strStringTableName, nStringTableStringIndex)";',
		'constexpr char const* const kOperationName = "stringtables.GetRequiredString(strStringTableName, nStringTableStringIndex)";',
		'constexpr char const* const kOperationName = "stringtables.AddString(strStringTableName, strStringTableValue)";',
		"RequireNetworkStringTableContainer(pIsolate, kOperationName)",
		'"stringtables.FindStringTable(strStringTableName) requires a non-empty table name."',
		'"stringtables.GetString(strStringTableName, nStringTableStringIndex) requires a non-empty table name."',
		'"stringtables.GetRequiredString(strStringTableName, nStringTableStringIndex) requires a non-empty table name."',
		'"stringtables.GetRequiredString(strStringTableName, nStringTableStringIndex) expects a string table name and numeric string index."',
		"GetRequiredStringTableStringIndexFromValue",
		'"String table index is not available: "',
		'"String table value is not available: "',
		'"stringtables.AddString(strStringTableName, strStringTableValue) requires a non-empty table name."',
		'constexpr char const* const kOperationName = "stringtables.GetDownloadablesTable()";',
		'constexpr char const* const kOperationName = "stringtables.GetDownloadablesList()";',
		'constexpr char const* const kOperationName = "stringtables.GetDownloadableIndex(strDownloadableFilePath)";',
		'constexpr char const* const kOperationName = "stringtables.HasDownloadable(strDownloadableFilePath)";',
		'constexpr char const* const kOperationName = "stringtables.AddDownloadable(strDownloadableFilePath)";',
		'constexpr char const* const kOperationName = "stringtables.RestoreDownloadables()";',
		'constexpr char const* const kOperationName = "stringtables.AddDownloadableDirectory(strDownloadableDirectoryPath, bRecursiveTraversal?)";',
		"RequireStringTablesDownloadablesTable(pIsolate, kOperationName)",
		'"stringtables.GetDownloadableIndex(strDownloadableFilePath) expects a string path."',
		'"stringtables.GetDownloadableIndex(strDownloadableFilePath) requires a non-empty path."',
		'"stringtables.HasDownloadable(strDownloadableFilePath) expects a string path."',
		'"stringtables.HasDownloadable(strDownloadableFilePath) requires a non-empty path."',
		'"stringtables.AddDownloadable(strDownloadableFilePath) expects a string path."',
		'"stringtables.AddDownloadable(strDownloadableFilePath) requires a non-empty path."',
		'"stringtables.UntrackDownloadable(strDownloadableFilePath) expects a string path."',
		'"stringtables.UntrackDownloadable(strDownloadableFilePath) requires a non-empty path."',
		'"stringtables.UntrackDownloadableDirectory(strDownloadableDirectoryPath) requires a non-empty directory path."',
		"const bool bIsExactDownloadableDirectoryPath = strTrackedDownloadableFilePath == strDownloadableDirectoryPath;",
		"strTrackedDownloadableFilePath.compare(kDownloadableDirectoryPathStartOffset, unDownloadableDirectoryPathLength, strDownloadableDirectoryPath) == 0",
		"strTrackedDownloadableFilePath[unDownloadableDirectoryPathLength] == kGenericPathSeparatorCharacter",
		"const bool bMatchesDownloadableDirectory = bIsExactDownloadableDirectoryPath || bIsDownloadableDirectoryChildPath;",
		'"stringtables.AddDownloadableDirectory(strDownloadableDirectoryPath, bRecursiveTraversal?) requires runtime paths."',
		'"stringtables.AddDownloadableDirectory(strDownloadableDirectoryPath, bRecursiveTraversal?) requires a non-empty directory path."',
		'constexpr char const* const kStringTableAddressPropertyName = "Address";',
		'DefineValue("DOWNLOADABLES_TABLE_NAME", LocalDownloadablesTableNameString)',
		'DefineFunction("UntrackDownloadable", UntrackDownloadableCallback)',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native stringtables binding missing: {strRequiredContract}")

	return 0

def CheckPlayersVoiceNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nVoiceBegin = strModuleBindings.find("IVoiceServer* GetVoiceServerInterface")
	nVoiceEnd = strModuleBindings.find("bool InstallVoiceFunctions", nVoiceBegin)
	if (nVoiceBegin < 0) or (nVoiceEnd < 0):
		return Fail("native players/voice callback block could not be located")

	strVoiceBindings = strModuleBindings[nVoiceBegin:nVoiceEnd]
	PathPlayerVoice = ROOT / "packages" / "sourcejs" / "players" / "voice.js"
	strPlayerVoice = ReadText(PathPlayerVoice)

	for strRequiredContract in [
		'const g_PlayersRuntime = GetModule("players");',
		"const unMaximumClients = g_PlayersRuntime.GetMaximumClients();",
		"unPlayerIndex > unMaximumClients",
		"unReceiverIndex <= unMaximumClients",
	]:
		if strRequiredContract not in strPlayerVoice:
			return Fail(f"{PathPlayerVoice.relative_to(ROOT)} must call GetMaximumClients() directly: {strRequiredContract}")

	for strForbiddenContract in [
		'GetModule("players").GetMaximumClients()',
		"Number(players.maxClients())",
		"maxClients fallback",
	]:
		if strForbiddenContract in strPlayerVoice:
			return Fail(f"{PathPlayerVoice.relative_to(ROOT)} must not fallback players.maxClients(): {strForbiddenContract}")

	for strFunctionStart, strFunctionEnd in [
		("void GetVoiceClientListeningCallback", "void SetVoiceClientListeningCallback"),
		("void SetVoiceClientListeningCallback", "void SetVoiceClientProximityCallback"),
		("void SetVoiceClientProximityCallback", "bool InstallVoiceFunctions"),
	]:
		if (strFunctionStart not in strModuleBindings) or (strFunctionEnd not in strModuleBindings):
			return Fail(f"native players/voice callback block boundary missing: {strFunctionStart}")

		strVoiceCallbackBindings = strModuleBindings.split(strFunctionStart, 1)[1].split(strFunctionEnd, 1)[0]
		for strForbiddenContract in [
			"GetVoiceServerInterface()",
			"CallbackInformation.GetReturnValue().Set(false);",
			"is not available because IVoiceServer is unavailable",
		]:
			if strForbiddenContract in strVoiceCallbackBindings:
				return Fail(f"native players/voice callback must require IVoiceServer and throw through V8: {strForbiddenContract}")

	for strRequiredContract in [
		"IVoiceServer* RequireVoiceServer",
		"bool ValidateVoicePlayerIndices(v8::Isolate* const pIsolate",
		'RequirePlayersGlobals(pIsolate, "players/voice")',
		'" requires IVoiceServer."',
		'" is not available in this Source SDK build."',
		"RequireVoiceServer(pIsolate, kOperationName)",
		'constexpr char kArgumentsError[] = "players/voice.GetClientListening(nReceiverIndex, nSenderIndex) expects nReceiverIndex and nSenderIndex to be player indexes.";',
		'constexpr char kArgumentsError[] = "players/voice.SetClientListening(nReceiverIndex, nSenderIndex, bListen?) expects nReceiverIndex and nSenderIndex to be player indexes.";',
		'constexpr char kArgumentsError[] = "players/voice.SetClientProximity(nReceiverIndex, nSenderIndex, bUseProximity?) expects nReceiverIndex and nSenderIndex to be player indexes.";',
		"ValidateVoicePlayerIndices(pIsolate, nReceiverIndex, nSenderIndex, kInvalidIndexError)",
	]:
		if strRequiredContract not in strVoiceBindings:
			return Fail(f"strict native players/voice binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"static bool VoiceValidPlayerIndex(int const nIndex)",
		"return nIndex > 0;",
		"g_Application.GetEngineInterfaces().GetGlobals()",
	]:
		if strForbiddenContract in strVoiceBindings:
			return Fail(f"players/voice must require CGlobalVars without index fallbacks: {strForbiddenContract}")

	return 0

def CheckNetChannelNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nNetChannelBegin = strModuleBindings.find("bool RequireNetChannelPlayerIndexFromValue")
	nNetChannelEnd = strModuleBindings.find("bool NormalizeMemoryDataTypeName", nNetChannelBegin)
	if (nNetChannelBegin < 0) or (nNetChannelEnd < 0):
		return Fail("native netchannel callback block could not be located")

	strNetChannelBindings = strModuleBindings[nNetChannelBegin:nNetChannelEnd]
	PathNetChannel = ROOT / "packages" / "sourcejs" / "netchannel.js"
	strNetChannelPackage = ReadText(PathNetChannel)

	vecRegisteredNetChannelMethods = re.findall(r'(?:SetFunction|InstallSDKFunction)(?:<[^>]+>)?\(pIsolate, LocalContext, LocalNetChannelModule, "([^"]+)"', strModuleBindings)
	if not vecRegisteredNetChannelMethods:
		return Fail("native netchannel API has no registered functions")

	for strMethodName in vecRegisteredNetChannelMethods:
		if not strMethodName or not strMethodName[0].isupper():
			return Fail(f"native netchannel API retains a non-canonical public name: {strMethodName}")

	for strRequiredMethodName in [
		"GetFlowConstants",
		"GetInformation",
		"GetRequiredInformation",
		"GetRequiredInformationFromAddress",
		"GetPacketBytes",
		"GetStreamProgress",
		"GetMessageHandlerAddress",
		"SetDataRate",
	]:
		if strRequiredMethodName not in vecRegisteredNetChannelMethods:
			return Fail(f"native netchannel API is missing canonical registration: {strRequiredMethodName}")

	for strRequiredContract in [
		'const g_NetChannelRuntime = GetModule("netchannel")',
		"g_NetChannelRuntime.GetFlowConstants()",
		"g_NetChannelRuntime.GetRequiredInformationFromAddress",
		"g_NetChannelRuntime.GetPacketBytes",
		'if ((typeof unAddress !== "bigint") || (unAddress <= 0n))',
		"class NetChannelInfo",
		"class NetChannel extends NetChannelInfo",
	]:
		if strRequiredContract not in strNetChannelPackage:
			return Fail(f"canonical {PathNetChannel.relative_to(ROOT)} contract missing: {strRequiredContract}")

	for strRequiredContract in [
		'"Outgoing", v8::Integer::New(pIsolate, FLOW_OUTGOING)',
		'"Incoming", v8::Integer::New(pIsolate, FLOW_INCOMING)',
		'"InOut", v8::Integer::New(pIsolate, MAX_FLOWS)',
		'case NetChannelInformationPropertyRemoteAddress:',
		'char const* const pszNetChannelRemoteAddress = pNetChannelInformation->GetAddress()',
		'{ "RemoteAddress", NetChannelInformationPropertyRemoteAddress }',
		'case NetChannelInformationPropertyChannelAddress:',
		'{ "NetworkChannelAddress", NetChannelInformationPropertyChannelAddress }',
		'v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unNetChannelInformationAddress))',
		"INetChannelInfo* GetNetChannelInformationFromValue",
		"GetAddressSizedUnsignedIntegerFromValue(LocalNetChannelValue, unNetChannelAddress)",
		"INetChannelInfo* RequireNetChannelInformationFromFirstArgument",
		"INetChannel* GetNetChannelFromValue",
		"INetChannel* RequireNetChannelFromFirstArgument",
		"INetMessage* GetNetMessageFromValue",
		"INetMessage* RequireNetMessageFromFirstArgument",
		'" requires a valid INetChannelInfo address."',
		'" requires a valid INetChannel address."',
		'" requires a valid INetMessage address."',
		'"netchannel.GetChannelAddress(nPlayerIndex) expects a player index."',
		'"netchannel.SetDataRate(unChannelAddress, flDataRate) expects a finite data rate."',
		'"netchannel.SetMessageReliable(unNetMessageAddress, bReliableDelivery) expects a boolean reliable value."',
		"RequireNetChannelInformationFromFirstArgument(pIsolate, CallbackInformation, kGetNetChannelPacketBytesOperationName)",
		"RequireNetChannelInformationFromFirstArgument(pIsolate, CallbackInformation, kGetNetChannelStreamProgressOperationName)",
		'InstallSDKFunction<kSDKHasNetChannelTotalPackets<INetChannelInfo>>(pIsolate, LocalContext, LocalNetChannelModule, "GetTotalPackets", GetNetChannelTotalPacketsCallback, LocalRuntimeData)',
		'constexpr char kReceivedByteCountPropertyName[] = "ReceivedByteCount";',
		'constexpr char kTotalByteCountPropertyName[] = "TotalByteCount";',
		'INetChannel::SendFile does not accept replay demo files on the selected Source SDK branch.',
		'INetChannel::DenyFile does not accept replay demo files on the selected Source SDK branch.',
		'INetChannel::RequestFile does not accept replay demo files on the selected Source SDK branch.',
		'SetFunction(pIsolate, LocalContext, LocalNetChannelModule, "GetRequiredInformationFromAddress", GetRequiredNetChannelInformationFromAddressCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalNetChannelModule, "GetChannelAddress", GetNetChannelAddressCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalNetChannelModule, "GetMessageHandlerAddress", GetNetChannelMessageHandlerAddressCallback, LocalRuntimeData)',
	]:
		if (strRequiredContract not in strNetChannelBindings) and (strRequiredContract not in strModuleBindings):
			return Fail(f"strict native netchannel binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"NetChannelMakeAddressObject",
		"NetChannelNumberFieldCallback",
		"NetChannelStringFieldCallback",
		"NetChannelBooleanFieldCallback",
		'"getChannelAddress"',
		'"getMessageHandlerAddress"',
		'"channelAddress"',
		'"address", v8::Number::New',
		"BooleanValue(pIsolate) : false",
		"BooleanValue(pIsolate) : true",
	]:
		if strForbiddenContract in strNetChannelBindings:
			return Fail(f"native netchannel binding contains a removed compatibility path: {strForbiddenContract}")

	for strRequiredContract in [
		'const g_NetChannelRuntime = GetModule("netchannel");',
		"class NetChannel extends NetChannelInfo",
		"return g_NetChannelRuntime.GetRequiredInformationFromAddress(RequireAddress(unNetChannelAddress));",
		"return g_NetChannelRuntime.GetPacketBytes(this.Address, RequireFlow(nFlow), nFrameNumber, nPacketGroup);",
		"get NetChannel()",
		"const g_NetChannelExports = {",
		"module.exports = g_NetChannelExports;",
	]:
		if strRequiredContract not in strNetChannelPackage:
			return Fail(f"canonical {PathNetChannel.relative_to(ROOT)} contract missing: {strRequiredContract}")

	for strForbiddenContract in [
		"net_channel",
		"moduleName",
		"createDefaultExport",
		"new Proxy",
		"addressString",
		"getAvg",
		"toJSON",
	]:
		if strForbiddenContract in strNetChannelPackage:
			return Fail(f"canonical {PathNetChannel.relative_to(ROOT)} contains a removed compatibility path: {strForbiddenContract}")

	return 0

def CheckEntityPropertiesNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nEntityPropertiesBegin = strModuleBindings.find("// Entity properties")
	nEntityPropertiesEnd = strModuleBindings.find("bool PlayersGetSendPropertyAddress", nEntityPropertiesBegin)
	if (nEntityPropertiesBegin < 0) or (nEntityPropertiesEnd < 0):
		return Fail("native entities/props callback block could not be located")

	strEntityPropertiesBindings = strModuleBindings[nEntityPropertiesBegin:nEntityPropertiesEnd]
	for strRequiredContract in [
		'RequireServerGameDLL(pIsolate, "entities/props.GetServerClasses()")',
		'RequireServerGameDLL(pIsolate, "entities/props.FindServerClassByName()")',
		'RequireServerGameDLL(pIsolate, "entities/props.GetSendTable()")',
		'RequireServerGameDLL(pIsolate, "GetServerClassProperty(Reference, PropertySelector)")',
		'RequireServerGameDLL(pIsolate, "entities/props.GetServerClassProperties()")',
		'RequireServerGameDLL(pIsolate, "entities/props.FindServerClassPropertyOffset()")',
		'RequireEntityPropertiesArgumentCount(CallbackInformation, kRequiredArgumentCount, "entities/props.FindServerClassByName(strServerClassName) expects a class name.")',
		'ThrowError(pIsolate, "entities/props.GetSendTable(Value) expects a class, table or entity.")',
		'ThrowError(pIsolate, "entities/props.GetServerClassProperties(Value) expects a class, table or entity.")',
		'ThrowError(pIsolate, "entities/props.FindServerClassPropertyOffset(Reference, strPropertyName) expects a reference and property name.")',
		"ServerClass* FindEntityPropertiesServerClassByName(IServerGameDLL* const pServerGameDLL",
		"SendTable* FindEntityPropertiesSendTableByName(IServerGameDLL* const pServerGameDLL",
		"entities/props property offset expects an integer offset.",
		"entities/props char property expects an integer or string value.",
		"entities/props float property expects a finite numeric value.",
		"entities/props double property expects a finite numeric value.",
		"Entity property update cannot infer writable data-table storage.",
		'const bool bForceVectorXY = strPropertyType == "vectorxy";',
		"EntityPropertiesGetVectorProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, bForceVectorXY)",
		"EntityPropertiesSetVectorProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalSetValue, bForceVectorXY)",
		"bForceVectorXY || (bHasResolvedPropertyInformation && EntityPropertiesIsVectorXYPropertyType(ResolvedPropertyInformation.m_SendPropertyType))",
	]:
		if strRequiredContract not in strEntityPropertiesBindings:
			return Fail(f"strict native entities/props binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"IServerGameDLL* const pServerGameDLL = EntityPropsServerGameDLL();\n\t\tv8::Local<v8::Array> LocalArray = v8::Array::New(pIsolate);\n\t\tif (!pServerGameDLL) {",
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(Args.GetIsolate()));\n\t\t\treturn;\n\t\t}\n\n\t\tv8::Isolate* const pIsolate = Args.GetIsolate();\n\t\tServerClass* const pClass = EntityPropsFindServerClassByName",
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(Args.GetIsolate()));\n\t\t\treturn;\n\t\t}\n\n\t\tv8::Isolate* const pIsolate = Args.GetIsolate();\n\t\tv8::Local<v8::Context> LocalContext = pIsolate->GetCurrentContext();\n\t\tServerClass* pClass = nullptr;\n\t\tSendTable* pTable = nullptr;\n\t\tEntityPropsResolveServerClassAndTable",
		"v8::Local<v8::Array> LocalArray = v8::Array::New(pIsolate);\n\t\tif (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(LocalArray);\n\t\t\treturn;\n\t\t}",
		"if (Args.Length() < 2) {\n\t\t\tArgs.GetReturnValue().Set(-1);\n\t\t\treturn;\n\t\t}",
		'strType == "vector_xy"',
		'strType == "string_address"',
		'strType == "entity_handle"',
		'SetValue(pIsolate, LocalContext, LocalObject, "moduleName"',
	]:
		if strForbiddenContract in strEntityPropertiesBindings:
			return Fail(f"native entities/props binding must throw for missing SDK/runtime prerequisites: {strForbiddenContract.splitlines()[0]}")

	for strFunctionName, strFunctionStart, strFunctionEnd in [
		("GetEntityPropertiesPropertyAddressFromValues", "bool GetEntityPropertiesPropertyAddressFromValues", "void EntityPropertiesGetSignedProperty"),
		("EntityPropertiesGetNumberFromValue", "bool EntityPropertiesGetNumberFromValue", "bool EntityPropertiesGetUnsignedNumberFromValue"),
		("EntityPropertiesSetCharacterProperty", "void EntityPropertiesSetCharacterProperty", "void EntityPropertiesGetFloatProperty"),
		("EntityPropertiesSetFloatProperty", "void EntityPropertiesSetFloatProperty", "void EntityPropertiesGetDoubleProperty"),
		("EntityPropertiesSetDoubleProperty", "void EntityPropertiesSetDoubleProperty", "void EntityPropertiesGetStringArrayProperty"),
		("EntityPropertiesSetGenericProperty", "void EntityPropertiesSetGenericProperty", "void GetServerClassesCallback"),
	]:
		if (strFunctionStart not in strEntityPropertiesBindings) or (strFunctionEnd not in strEntityPropertiesBindings):
			return Fail(f"strict native entities/props conversion block missing: {strFunctionName}")

		strConversionBindings = strEntityPropertiesBindings.split(strFunctionStart, 1)[1].split(strFunctionEnd, 1)[0]
		for strForbiddenContract in [
			"NumberValue(LocalContext).FromMaybe(0)",
			"Int32Value(LocalContext).FromMaybe(0)",
			"ToLocalChecked()->NumberValue",
			"ToLocalChecked()->Int32Value",
		]:
			if strForbiddenContract in strConversionBindings:
				return Fail(f"{strFunctionName} must not coerce bad values to zero: {strForbiddenContract}")

	return 0

def CheckEntityFactoriesNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strEngineInterfaceImplementation = ReadText(ROOT / "src" / "sourcejs" / "EngineInterfaces.cpp")
	nEntityFactoriesBegin = strModuleBindings.find("// Entity factories")
	nEntityFactoriesEnd = strModuleBindings.find("// Entity datamaps", nEntityFactoriesBegin)
	if (nEntityFactoriesBegin < 0) or (nEntityFactoriesEnd < 0):
		return Fail("native entities/factories callback block could not be located")

	strEntityFactoryBindings = strModuleBindings[nEntityFactoriesBegin:nEntityFactoriesEnd]
	for strSourceContent, strSourceName in [
		(strModuleBindings, "ModuleBindings.cpp"),
		(strEngineInterfaceImplementation, "EngineInterfaces.cpp"),
	]:
		for strRequiredContract in [
			'#if __has_include("toolframework/itoolentity.h")',
			'#include "toolframework/itoolentity.h"',
		]:
			if strRequiredContract not in strSourceContent:
				return Fail(f"{strSourceName} must use the selected SDK IServerTools declaration: {strRequiredContract}")

	for strForbiddenContract in [
		"class IServerTools : public IBaseInterface",
		'#define VSERVERTOOLS_INTERFACE_VERSION "VSERVERTOOLS001"',
	]:
		if (strForbiddenContract in strModuleBindings) or (strForbiddenContract in strEngineInterfaceImplementation):
			return Fail(f"IServerTools must not be reimplemented or assigned a cross-branch interface version: {strForbiddenContract}")

	for strRequiredContract in [
		"IServerTools* RequireEntityFactoriesServerTools",
		"bool InstallEntityFactoriesDestroyEntityByHammerIDFunction",
		"if constexpr (kEntityFactoriesHasDestroyHammerID<TServerTools>)",
		"InstallEntityFactoriesDestroyEntityByHammerIDFunction<IServerTools>(pIsolate, LocalContext, LocalEntityFactoriesObject, LocalRuntimeData)",
		"RequireEntityFactoriesServerTools(pIsolate, kOperationName)",
		'"entities/factories.CreateEntityByClassName(strClassName, Options?)"',
		'"entities/factories.CreateAndSpawnEntityByClassName(strClassName, Options?)"',
		'"entities/factories.DispatchEntitySpawn(Entity)"',
		'"entities/factories.SetEntityKeyValue(Entity, strKeyName, Value)"',
		'"entities/factories.GetEntityKeyValue(Entity, strKeyName, nMaximumLength?)"',
		'"entities/factories.FindEntityByHammerID(nHammerID)"',
		'"entities/factories.DestroyEntityByHammerID(nHammerID)"',
		"entities/factories.CreateEntityByClassName(strClassName, Options?) expects a non-empty entity class name without NUL bytes.",
		"entities/factories.CreateAndSpawnEntityByClassName(strClassName, Options?) expects a non-empty entity class name without NUL bytes.",
		"entities/factories.DispatchEntitySpawn(Entity) expects an entity.",
		"entities/factories.SetEntityKeyValue(Entity, strKeyName, Value) expects an entity, non-empty string key and value.",
		"entities/factories.GetEntityKeyValue(Entity, strKeyName, nMaximumLength?) expects an entity and non-empty string key.",
		"entities/factories.FindEntityByHammerID(nHammerID) expects a non-negative integer Hammer ID.",
		"entities/factories.DestroyEntityByHammerID(nHammerID) expects a non-negative integer Hammer ID.",
	]:
		if strRequiredContract not in strEntityFactoryBindings:
			return Fail(f"strict native entities/factories binding missing: {strRequiredContract}")

	for strRequiredContract in [
		'#if __has_include("toolframework/itoolentity.h") && !defined(SOURCEJS_OLD_CONSOLE_API)',
		"#define SOURCEJS_HAS_SERVER_TOOLS 1",
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"native IServerTools capability guard missing: {strRequiredContract}")

	if "m_pServerTools = static_cast<IServerTools*>(LoadOptionalInterface(GameServerFactory, VSERVERTOOLS_INTERFACE_VERSION));" not in strEngineInterfaceImplementation:
		return Fail("EngineInterfaces must load the selected SDK IServerTools version")

	for strForbiddenContract in [
		"IServerTools* const pServerTools = EntityFactoriesServerTools();\n\t\tif (!pServerTools) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null",
		"if (!pServerTools || Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null",
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(false)",
		"if (!pServerTools || !pEntity) {\n\t\t\tArgs.GetReturnValue().Set(false)",
		"pServerTools && nHammerID >= 0",
	]:
		if strForbiddenContract in strEntityFactoryBindings:
			return Fail(f"native entities/factories binding must throw for missing SDK/runtime prerequisites: {strForbiddenContract.splitlines()[0]}")

	return 0

def CheckEntityDatamapsNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nEntityDatamapsBegin = strModuleBindings.find("// Entity datamaps")
	nEntityDatamapsEnd = strModuleBindings.find("// Entity properties", nEntityDatamapsBegin)
	if (nEntityDatamapsBegin < 0) or (nEntityDatamapsEnd < 0):
		return Fail("native entities/datamaps callback block could not be located")

	strEntityDatamapBindings = strModuleBindings[nEntityDatamapsBegin:nEntityDatamapsEnd]
	for strRequiredContract in [
		"bool EntityDatamapsRequireArgumentCount",
		"GetEntityDataMap(Value) expects Value to be an entity, class name, or datamap.",
		"GetEntityDataMapField(DataMap, nFieldIndex) expects DataMap and nFieldIndex.",
		"FindEntityDataMapField(DataMap, strFieldName) expects DataMap and strFieldName.",
		"FindEntityDataMapFieldOffset(DataMap, strFieldName) expects DataMap and strFieldName.",
		"GetEntityDataMapFields(DataMap, bRecursive?) expects DataMap.",
		"GetEntityInputFunction(Entity, Field) expects Entity and Field.",
		"GetEntityInputFunction(Entity, Field) failed to resolve an entity datamap input function.",
		"Entity.GetEntityDataMap() requires a valid entity.",
		"GetEntityDataMapPropertyInteger(Entity, Property) expects Entity and Property.",
		"SetEntityDataMapPropertyInteger(Entity, Property, nValue) expects Entity, Property, and nValue.",
		"Entity.GetEntityDataMapPropertyInteger(Property) expects Property.",
		"Entity.SetEntityDataMapPropertyInteger(Property, nValue) expects Property and nValue.",
		"EntityDatamapsRequireArgumentCount(CallbackInformation, kRequiredArgumentCount, kUsageErrorMessage)",
		"bool EntityDatamapsGetColorFromValue",
		"bool EntityDatamapsGetIntervalFromValue",
		"bool EntityDatamapsSetVariantValue",
		"bool EntityDatamapsGetVariantFieldTypeFromValue",
		"return pBaseEntity->GetDataDescMap();",
		"entities/datamaps property offset expects a non-negative integer offset.",
		"entities/datamaps char property expects an integer or string value.",
		"entities/datamaps float property expects a finite numeric value.",
		"entities/datamaps double property expects a finite numeric value.",
		"entities/datamaps color property expects integer color components.",
		"entities/datamaps color property expects color components between 0 and 255.",
		"entities/datamaps interval property expects numeric components.",
		"entities/datamaps variant expects a finite numeric float value.",
		"entities/datamaps variant expects an integer value.",
		"entities/datamaps variant expects a valid field type.",
		"CreateEntityDataMapInterval(flStart, flRange) expects flStart to be numeric.",
		"CreateEntityDataMapInterval(flStart, flRange) expects flRange to be numeric.",
		"bHasVariantValue = EntityDatamapsSetVariantValue(pIsolate, LocalContext, InputData.value, InputFieldType, CallbackInformation[kValueArgumentIndex])",
	]:
		if strRequiredContract not in strEntityDatamapBindings:
			return Fail(f"strict native entities/datamaps binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(Args.GetIsolate()))",
		"if (Args.Length() < 2) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate))",
		"if (Args.Length() < 2) {\n\t\t\tArgs.GetReturnValue().Set(-1)",
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(LocalArray)",
		"if (Args.Length() >= 2) {\n\t\t\tEntityDatamapsGet",
		"if (Args.Length() >= 3) {\n\t\t\tEntityDatamapsSet",
		"if (Args.Length() >= 1) {\n\t\t\tEntityDatamapsGet",
		"class EntityDatamapsEntityWrapper",
		"reinterpret_cast<EntityDatamapsEntityWrapper*>",
	]:
		if strForbiddenContract in strEntityDatamapBindings:
			return Fail(f"native entities/datamaps binding must throw for invalid usage instead of returning silently: {strForbiddenContract.splitlines()[0]}")

	for strFunctionName, strFunctionStart, strFunctionEnd in [
		("EntityDatamapsGetNumberFromValue", "bool EntityDatamapsGetNumberFromValue", "bool EntityDatamapsGetUnsignedNumberFromValue"),
		("EntityDatamapsGetPropertyAddressFromValues", "bool EntityDatamapsGetPropertyAddressFromValues", "void EntityDatamapsGetSignedProperty"),
		("EntityDatamapsSetCharProperty", "void EntityDatamapsSetCharProperty", "void EntityDatamapsGetFloatProperty"),
		("EntityDatamapsSetFloatProperty", "void EntityDatamapsSetFloatProperty", "void EntityDatamapsGetDoubleProperty"),
		("EntityDatamapsSetDoubleProperty", "void EntityDatamapsSetDoubleProperty", "void EntityDatamapsGetStringIDProperty"),
		("EntityDatamapsSetGenericProperty", "void EntityDatamapsSetGenericProperty", "v8::Local<v8::Object> EntityDatamapsMakeVariantObject"),
		("EntityDatamapsGetColorFromValue", "bool EntityDatamapsGetColorComponent", "bool EntityDatamapsGetVectorFromValue"),
		("EntityDatamapsGetIntervalFromValue", "bool EntityDatamapsGetIntervalComponent", "datamap_t* EntityDatamapsGetDatamapFromName"),
		("EntityDatamapsSetVariantValue", "bool EntityDatamapsSetVariantValue", "bool EntityDatamapsGetVariantFieldTypeFromValue"),
		("EntityDatamapsGetVariantFieldTypeFromValue", "bool EntityDatamapsGetVariantFieldTypeFromValue", "void CallEntityInputFunctionCallback"),
		("CreateEntityDataMapInterval", "void CreateEntityDataMapIntervalCallback", "void GetEntityInputFunctionCallback"),
	]:
		if (strFunctionStart not in strEntityDatamapBindings) or (strFunctionEnd not in strEntityDatamapBindings):
			return Fail(f"strict native entities/datamaps conversion block missing: {strFunctionName}")

		strConversionBindings = strEntityDatamapBindings.split(strFunctionStart, 1)[1].split(strFunctionEnd, 1)[0]
		for strForbiddenContract in [
			"NumberValue(LocalContext).FromMaybe(0)",
			"Int32Value(LocalContext).FromMaybe(0)",
			"ToLocalChecked()->NumberValue",
			"ToLocalChecked()->Int32Value",
		]:
			if strForbiddenContract in strConversionBindings:
				return Fail(f"{strFunctionName} must not coerce bad values to zero: {strForbiddenContract}")

	return 0

def CheckEffectsNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nEffectsBegin = strModuleBindings.find("// Effects")
	nEffectsEnd = strModuleBindings.find("void GetAllInterfaceNamesCallback", nEffectsBegin)
	if (nEffectsBegin < 0) or (nEffectsEnd < 0):
		return Fail("native effects callback block could not be located")

	strEffectsBindings = strModuleBindings[nEffectsBegin:nEffectsEnd]
	for strRequiredContract in [
		'"effects.ListTempEntities()"',
		'"effects.GetTempEntity(strTemporaryEntityName)"',
		'"effects.GetProperty(strTemporaryEntityName, strPropertyName)"',
		'"effects.CreateTempEntity(strTemporaryEntityName, PropertyValues?, Recipients?, flDelay?, bReliable?)"',
		"RequireServerGameDLL(pIsolate, kOperationName)",
		"RequireEngineServer(pIsolate, kOperationName)",
		"effects.GetTempEntity(strTemporaryEntityName) requires a temporary entity name string.",
		"effects.GetTempEntity(strTemporaryEntityName) requires a non-empty temporary entity name.",
		"effects.GetProperty(strTemporaryEntityName, strPropertyName) requires temporary entity and property name strings.",
		"effects.CreateTempEntity(strTemporaryEntityName, PropertyValues?, Recipients?, flDelay?, bReliable?) could not find the temporary entity template.",
		"effects.CreateTempEntity(strTemporaryEntityName, PropertyValues?, Recipients?, flDelay?, bReliable?) temporary entity template does not have a send table.",
		"effects.CreateTempEntity(strTemporaryEntityName, PropertyValues?, Recipients?, flDelay?, bReliable?) requires a non-empty temporary entity name.",
		"effects.CreateTempEntity(strTemporaryEntityName, PropertyValues?, Recipients?, flDelay?, bReliable?) delay must be finite.",
		"effects.CreateTempEntity(strTemporaryEntityName, PropertyValues?, Recipients?, flDelay?, bReliable?) reliability flag must be a boolean.",
		"GetFloatArgument(pIsolate, LocalContext, CallbackInformation[kDelayArgumentIndex], kDelayErrorMessage, flDelay)",
		"effects array integer property expects a finite numeric value.",
		"effects array float property expects a finite numeric value.",
		"effects integer property expects a finite numeric value.",
		"effects float property expects a finite numeric value.",
	]:
		if strRequiredContract not in strEffectsBindings:
			return Fail(f"strict native effects binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"IServerGameDLL* const pServerGameDLL = EntityPropsServerGameDLL();\n\t\tstd::uint32_t unWriteIndex = 0;\n\t\tif (!pServerGameDLL) {\n\t\t\tArgs.GetReturnValue().Set(LocalArray)",
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate))",
		"if (Args.Length() < 2) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate))",
		"IVEngineServer* const pEngine = g_Application.GetEngineInterfaces().GetEngine();",
		"if (!pEngine || !pClass || !pClass->m_pTable) {\n\t\t\tArgs.GetReturnValue().Set(false)",
		"Args[3]->NumberValue(LocalContext).FromMaybe(0)",
	]:
		if strForbiddenContract in strEffectsBindings:
			return Fail(f"native effects binding must throw for missing SDK/runtime prerequisites: {strForbiddenContract.splitlines()[0]}")

	for strFunctionName, strFunctionStart, strFunctionEnd in [
		("EffectsSetArrayValue", "bool EffectsSetArrayValue", "bool EffectsSetPropertyValue"),
		("EffectsSetPropertyValue", "bool EffectsSetPropertyValue", "bool ApplyEffectsPropertyValues"),
	]:
		if (strFunctionStart not in strEffectsBindings) or (strFunctionEnd not in strEffectsBindings):
			return Fail(f"strict native effects conversion block missing: {strFunctionName}")

		strConversionBindings = strEffectsBindings.split(strFunctionStart, 1)[1].split(strFunctionEnd, 1)[0]
		for strForbiddenContract in [
			"NumberValue(LocalContext).FromMaybe(0)",
			"Int32Value(LocalContext).FromMaybe(0)",
			"ToLocalChecked()->NumberValue",
			"ToLocalChecked()->Int32Value",
		]:
			if strForbiddenContract in strConversionBindings:
				return Fail(f"{strFunctionName} must not coerce bad values to zero: {strForbiddenContract}")

	for strPackagePath in ["effects.js", "effects/index.js"]:
		strPackageContent = ReadText(ROOT / "packages" / "sourcejs" / strPackagePath)
		for strForbiddenContract in [
			"Boolean(options.reliable)",
			"Boolean(recipients.reliable)",
		]:
			if strForbiddenContract in strPackageContent:
				return Fail(f"effects JS wrapper must pass reliable through to native validation in {strPackagePath}: {strForbiddenContract}")

	return 0

def CheckGameRulesNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nGameRulesBegin = strModuleBindings.find("// Engine game rules")
	nGameRulesEnd = strModuleBindings.find("bool GetStudioModelHandleFromValue", nGameRulesBegin)
	if (nGameRulesBegin < 0) or (nGameRulesEnd < 0):
		return Fail("native gamerules block could not be located")

	strGameRuleBindings = strModuleBindings[nGameRulesBegin:nGameRulesEnd]
	for strRequiredContract in [
		"bool GetGameRulesNumberFromValue",
		"bool GetGameRulesColorComponent",
		"bool GetGameRulesColorFromValue",
		"bool GetGameRulesObjectFloatComponent",
		"MaybeGameRulesNumberValue.IsNothing()",
		"std::isfinite(dblParsedGameRulesNumberValue)",
		"std::numeric_limits<T>::lowest()",
		"SetPropertyCharacter(strGameRulesPropertyName, GameRulesPropertyValue) expects a one-byte string or integer value.",
		"SetPropertyFloat(strGameRulesPropertyName, flGameRulesPropertyValue) expects a finite numeric value within the float range.",
		"SetPropertyDouble(strGameRulesPropertyName, dblGameRulesPropertyValue) expects a finite numeric value.",
		"SetPropertyColor(strGameRulesPropertyName, ColorValue) expects a color object.",
		"SetPropertyColor(strGameRulesPropertyName, ColorValue) expects integer color components.",
		"SetPropertyColor(strGameRulesPropertyName, ColorValue) expects color components between 0 and 255.",
		"SetPropertyInterval(strGameRulesPropertyName, IntervalValue) expects numeric components.",
		"SetPropertyQuaternion(strGameRulesPropertyName, QuaternionValue) expects numeric components.",
	]:
		if strRequiredContract not in strGameRuleBindings:
			return Fail(f"strict native gamerules binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"NumberValue(LocalContext).FromMaybe(0)",
		"Int32Value(LocalContext).FromMaybe(0)",
		"Uint32Value(LocalContext).FromMaybe(0)",
		"ToLocalChecked()->NumberValue",
		"ToLocalChecked()->Int32Value",
		"return Color(0, 0, 0, 0);",
		"*reinterpret_cast<float*>(pAddress) = static_cast<float>(Args[1]->NumberValue",
		"*reinterpret_cast<double*>(pAddress) = Args[1]->NumberValue",
	]:
		if strForbiddenContract in strGameRuleBindings:
			return Fail(f"native gamerules binding must not coerce bad values to zero: {strForbiddenContract}")

	return 0

def CheckNativeVectorValueConversions():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strFunctionStart, strNameHandle in [
		("int GetObjectIndex(", "LocalIndexName"),
		("bool GetObjectInteger(", "LocalName"),
		("bool GetObjectString(", "LocalName"),
		("bool OptionalFloatFromObject(", "LocalName"),
	]:
		if strFunctionStart not in strModuleBindings:
			return Fail(f"native property input helper missing: {strFunctionStart}")

		strPropertyBindings = strModuleBindings.split(strFunctionStart, 1)[1].split("\n\t\t}", 1)[0]
		for strRequiredContract in [
			"if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty())",
			f"if ({strNameHandle}.IsEmpty())",
			f"->Get(LocalContext, {strNameHandle})",
		]:
			if strRequiredContract not in strPropertyBindings:
				return Fail(f"native property helper input contract missing: {strFunctionStart} {strRequiredContract}")

	for strFunctionStart in ["bool GetFloatArgument(", "bool OptionalFloatFromArray(", "bool ConstantNameFromArguments(", "bool GetModuleConstantValueFromThis("]:
		if strFunctionStart not in strModuleBindings:
			return Fail(f"native value input helper missing: {strFunctionStart}")

	strFloatBindings = strModuleBindings.split("bool GetFloatArgument(", 1)[1].split("\n\t\t}", 1)[0]
	if "LocalValue.IsEmpty()" not in strFloatBindings:
		return Fail("native float conversion must validate an empty value before dereferencing it")

	strArrayBindings = strModuleBindings.split("bool OptionalFloatFromArray(", 1)[1].split("\n\t\t}", 1)[0]
	if "if (!pIsolate || LocalContext.IsEmpty() || LocalArray.IsEmpty())" not in strArrayBindings:
		return Fail("optional native array lookup must validate its required handles")

	strOptionalFloatBindings = strModuleBindings.split("bool OptionalFloatFromObject(", 1)[1].split("\n\t\t}", 1)[0]
	strNullishCommit = "if (IsValueNullish(LocalValue)) {\n\t\t\t\tbFoundOut = false;\n\t\t\t\treturn true;"
	if (strNullishCommit not in strOptionalFloatBindings) or (strOptionalFloatBindings.count("bFoundOut = false;") != 1):
		return Fail("optional native float lookup must preserve its output flag on a read/conversion failure")

	strNameBindings = strModuleBindings.split("bool ConstantNameFromArguments(", 1)[1].split("\n\t\t}", 1)[0]
	if ("strNameOut = std::move(strName);" not in strNameBindings) or ("strNameOut = ValueToString(" in strNameBindings):
		return Fail("native constant name parsing must commit its output only after validation")

	strConstantBindings = strModuleBindings.split("bool GetModuleConstantValueFromThis(", 1)[1].split("\n\t\t}", 1)[0]
	strFailedLookup = "if (!MaybeModuleConstantValue.ToLocal(&LocalModuleConstantValue)) {\n\t\t\t\treturn false;"
	if strFailedLookup not in strConstantBindings:
		return Fail("native constant lookup must preserve the original getter exception")

	if ("LocalValueOut = LocalModuleConstantValue;" not in strConstantBindings) or ("ToLocal(&LocalValueOut)" in strConstantBindings):
		return Fail("native constant lookup must commit its output only after validation")

	for strRequiredContract in [
		"bool GetFloatArgument",
		"bool OptionalFloatFromArray",
		"bool OptionalFloatFromObject",
		"bool VectorComponentFromObject",
		"bool GetVectorFromValue",
		"bool RequireVectorFromValue",
		"std::isfinite(dblNumber)",
		"expects a vector with finite numeric X, Y and Z components.",
		"entities/datamaps vector property expects numeric vector components.",
		"entities/props vector property expects numeric vector components.",
		"effects property expects numeric vector components.",
		"effects vector component property expects numeric vector components.",
		"engines/sound vector option expects numeric vector components.",
		"engines/sound Origins expects vector entries.",
		"engines/trace expects numeric vector components.",
		"engines/trace ray expects numeric vector components.",
		"SetPropertyVector(strGameRulesPropertyName, VectorValue) expects numeric vector components.",
		"bool GetEntityFactoryVectorFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalVectorValue, char const* const pszOperation, bool& bHasVectorOut, Vector& VectorOut)",
		"bool EntityDatamapsGetVectorFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, Vector& VectorValueOut)",
		"bool EntityPropertiesRequireVectorFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, Vector& VectorOut)",
		"bool EffectsSetVectorComponents(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, char* const pchSenderMemory, const std::size_t unSenderMemoryByteCount, ServerClass* const pServerClass, EntityPropertiesPropertyInformation const& PropertyInformation, v8::Local<v8::Value> const LocalPropertyValue, bool& bHandledOut)",
		"bool GetSoundVectorFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, bool& bHasVectorOut, Vector& VectorValueOut)",
		"bool CollectSoundOrigins(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue, CUtlVector<Vector>& vecOriginsOut)",
		"bool GetTraceRayVectorPropertyFromObject(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalSourceObject, char const* const pszPropertyName, bool& bHasVectorOut, Vector& VectorValueOut)",
		"bool GetGameRulesVectorFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalVectorValue, Vector& VectorValueOut)",
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native vector conversion contract missing: {strRequiredContract}")

	for strFunctionName, strFunctionStart, strFunctionEnd in [
		("GetEntityFactoryVectorFromValue", "bool GetEntityFactoryVectorFromValue", "CBaseEntity* GetEntityFactoryBaseEntityFromValue"),
		("EntityDatamapsGetVectorFromValue", "bool EntityDatamapsGetVectorFromValue", "void EntityDatamapsGetFloatComponentProperty"),
		("EntityPropertiesRequireVectorFromValue", "bool EntityPropertiesRequireVectorFromValue", "void EntityPropertiesGetBooleanProperty"),
		("EffectsRequireVectorFromValue", "bool EffectsRequireVectorFromValue", "bool EffectsSetPropertyValue"),
		("GetSoundVectorFromValue", "bool GetSoundVectorFromValue", "bool CollectSoundRecipients"),
		("RequireTraceVectorFromValue", "bool RequireTraceVectorFromValue", "int GetTraceEntityIndexFromHandle"),
		("GetGameRulesVectorFromValue", "bool GetGameRulesVectorFromValue", "float* GetGameRulesFloatPropertyAddress"),
	]:
		if (strFunctionStart not in strModuleBindings) or (strFunctionEnd not in strModuleBindings):
			return Fail(f"strict native vector conversion block missing: {strFunctionName}")

		strConversionBindings = strModuleBindings.split(strFunctionStart, 1)[1].split(strFunctionEnd, 1)[0]
		for strForbiddenContract in [
			"NumberValue(LocalContext).FromMaybe(0)",
			"Int32Value(LocalContext).FromMaybe(0)",
			"ToLocalChecked()->NumberValue",
		]:
			if strForbiddenContract in strConversionBindings:
				return Fail(f"{strFunctionName} must not coerce vector conversion failures to zero: {strForbiddenContract}")

	return 0

def CheckInterfacesFilesystemNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nInterfacesBegin = strModuleBindings.find("void GetAllInterfaceNamesCallback")
	nInterfacesEnd = strModuleBindings.find("// Pure modules", nInterfacesBegin)
	nFilesystemBegin = strModuleBindings.find("void DoesFileExistCallback")
	nFilesystemEnd = strModuleBindings.find("bool IsKeyValuesAddressCollected", nFilesystemBegin)
	if (nInterfacesBegin < 0) or (nInterfacesEnd < 0) or (nFilesystemBegin < 0) or (nFilesystemEnd < 0):
		return Fail("native interfaces/filesystem callback blocks could not be located")

	strInterfaceBindings = strModuleBindings[nInterfacesBegin:nInterfacesEnd]
	strFilesystemBindings = strModuleBindings[nFilesystemBegin:nFilesystemEnd]

	for strRequiredContract in [
		"LocalInterfaceNameValue.IsEmpty() || !LocalInterfaceNameValue->IsString()",
		'if (strInterfaceName.empty())',
		"interfaces.GetInterfaceRecord(strInterfaceName) expects a non-empty interface name string.",
		"GetInterfaceNames()",
		"GetInterface(strInterfaceName)",
		"CallbackInformation.GetReturnValue().Set(v8::Null(pIsolate));",
		'constexpr char kNamePropertyName[] = "Name";',
		'constexpr char kAvailablePropertyName[] = "Available";',
		'constexpr char kAddressPropertyName[] = "Address";',
		"SetRecordProperty(pIsolate, LocalContext, LocalInterfaceObject, kNamePropertyName, MakeString(pIsolate, strInterfaceName))",
		"SetRecordProperty(pIsolate, LocalContext, LocalInterfaceObject, kAvailablePropertyName, v8::Boolean::New(pIsolate, kInterfaceAvailable))",
		"SetRecordProperty(pIsolate, LocalContext, LocalInterfaceObject, kAddressPropertyName, v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unInterfaceAddress)))",
	]:
		if strRequiredContract not in strInterfaceBindings:
			return Fail(f"strict native interfaces binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate))",
		'SetValue(pIsolate, LocalContext, LocalInterfaceObject, "address"',
		'SetString(pIsolate, LocalContext, LocalInterfaceObject, "addressString"',
	]:
		if strForbiddenContract in strInterfaceBindings:
			return Fail(f"native interfaces binding must throw for invalid usage: {strForbiddenContract.splitlines()[0]}")

	for strRequiredContract in [
		"void GetSeekTypesCallback",
		'constexpr char kHeadPropertyName[] = "Head";',
		'constexpr char kCurrentPropertyName[] = "Current";',
		'constexpr char kTailPropertyName[] = "Tail";',
		"kHeadPropertyName, v8::Integer::New(pIsolate, FILESYSTEM_SEEK_HEAD)",
		"kCurrentPropertyName, v8::Integer::New(pIsolate, FILESYSTEM_SEEK_CURRENT)",
		"kTailPropertyName, v8::Integer::New(pIsolate, FILESYSTEM_SEEK_TAIL)",
		"filesystem.DoesFileExist(strFilePath) expects a path.",
		"filesystem.ReadTextFile(strFilePath) expects a path.",
		"filesystem.WriteTextFile(strFilePath, strText) expects a path and text.",
		"filesystem.EnsureDirectoryExists(strDirectoryPath) expects a path.",
		"filesystem.IsVPKFile(strFilePath) expects a path.",
		"filesystem.RemoveFile(strFilePath) expects a non-empty file path.",
		"ConvertFilesystemFileHandleToBigInt",
		"RequireFilesystemStringArgument",
		"GetFilesystemTruncationOpenMode",
		"nWrittenByteCount != nTargetSize",
		"RequireFilesystemInterface(pIsolate)",
	]:
		if strRequiredContract not in strFilesystemBindings:
			return Fail(f"strict native filesystem binding missing: {strRequiredContract}")

	for strFilesystemRegistration in [
		'SetFunction(pIsolate, LocalContext, LocalFilesystemModule, "GetSeekTypes", GetSeekTypesCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalFilesystemModule, "IsSourceFileSeekable", IsSourceFileSeekableCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalFilesystemModule, "GetSourceFileDescriptor", GetSourceFileDescriptorCallback, LocalRuntimeData)',
	]:
		if strFilesystemRegistration not in strModuleBindings:
			return Fail(f"strict native filesystem binding missing: {strFilesystemRegistration}")

	PathFilesystem = ROOT / "packages" / "sourcejs" / "filesystem.js"
	strFilesystemPackage = ReadText(PathFilesystem)

	if "const g_NativeSeekTypes = g_FilesystemRuntime.GetSeekTypes();" not in strFilesystemPackage:
		return Fail(f"{PathFilesystem.relative_to(ROOT)} must fetch FileSystemSeek_t from the native SDK binding")

	for strRequiredContract in [
		"CURRENT: g_NativeSeekTypes.Current",
		"HEAD: g_NativeSeekTypes.Head",
		"TAIL: g_NativeSeekTypes.Tail",
	]:
		if strRequiredContract not in strFilesystemPackage:
			return Fail(f"{PathFilesystem.relative_to(ROOT)} must retain native SDK seek values: {strRequiredContract}")

	for strForbiddenContract in ["Head: 0", "Current: 1", "Tail: 2"]:
		if strForbiddenContract in strFilesystemPackage:
			return Fail(f"{PathFilesystem.relative_to(ROOT)} must not hardcode FileSystemSeek_t: {strForbiddenContract}")

	for strForbiddenContract in [
		'SetFunction(pIsolate, LocalContext, LocalFilesystem, "seekable"',
		'SetFunction(pIsolate, LocalContext, LocalFilesystem, "fileno"',
		'v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(FileHandle)))',
	]:
		if strForbiddenContract in strModuleBindings:
			return Fail(f"obsolete native filesystem contract remains: {strForbiddenContract}")

	for strForbiddenContract in [
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(false)",
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate))",
		"if (Args.Length() < 2) {\n\t\t\tArgs.GetReturnValue().Set(false)",
		"pFileSystem && pFileSystem->FileExists",
		"g_Application.GetEngineInterfaces().GetFileSystem();\n\t\tstd::string const strFile = ValueToString(pIsolate, Args[0]);\n\t\tbool const bPhysicalFile",
	]:
		if strForbiddenContract in strFilesystemBindings:
			return Fail(f"native filesystem binding must throw for invalid usage or require IFileSystem: {strForbiddenContract.splitlines()[0]}")

	for strForbiddenContract in [
		"internal/filesystem.js",
		"internal/filesystem.cjs",
		"isVpkFile",
		"isAtty",
		"pathId",
	]:
		if strForbiddenContract in strFilesystemPackage:
			return Fail(f"{PathFilesystem.relative_to(ROOT)} must not retain obsolete filesystem aliases: {strForbiddenContract}")

	return 0

def CheckSharedUInt64NativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nUInt64ValueBegin = strModuleBindings.find("bool GetUInt64ValueFromValue")
	nUInt64ValueEnd = strModuleBindings.find("bool IsValueNullish", nUInt64ValueBegin)
	nUInt64WrapperBegin = strModuleBindings.find("bool RequireUInt64FromValue")
	nUInt64WrapperEnd = strModuleBindings.find("bool SetGameEventValueFromV8", nUInt64WrapperBegin)
	if (nUInt64ValueBegin < 0) or (nUInt64ValueEnd < 0) or (nUInt64WrapperBegin < 0) or (nUInt64WrapperEnd < 0):
		return Fail("shared native uint64 converter block could not be located")

	strUInt64ValueConversion = strModuleBindings[nUInt64ValueBegin:nUInt64ValueEnd]
	strUInt64WrapperConversion = strModuleBindings[nUInt64WrapperBegin:nUInt64WrapperEnd]
	strUInt64Conversions = strUInt64ValueConversion + strUInt64WrapperConversion

	for strRequiredContract in [
		"bool GetUInt64ValueFromValue(v8::Isolate* const pIsolate",
		"bool RequireUInt64FromValue(v8::Isolate* const pIsolate",
		"char const* const pszErrorMessage",
		"std::uint64_t& unValueOut",
		"LocalValue.As<v8::BigInt>()->Uint64Value(&bLossless)",
		"if (!bLossless)",
		"!LocalValue->IsBigInt()",
		"unValueOut = unValue;",
		"GetUInt64ValueFromValue(pIsolate, LocalContext, LocalValue, unValueOut)",
		"ThrowError(pIsolate, pszErrorMessage)",
	]:
		if strRequiredContract not in strUInt64Conversions:
			return Fail(f"shared native uint64 converter missing strict handling: {strRequiredContract}")

	for strForbiddenContract in [
		"static std::uint64_t UInt64FromValue",
		"return 0;",
		"IntegerValue(LocalContext).FromMaybe(0)",
		"std::strtoull(strValue.c_str(), nullptr, 0)",
		"IsNumber",
		"IsString",
		"IsObject",
		"NumberValue(",
		"strtoull",
		"kSourceJSMaxSafeInteger",
		"kMaximumSafeNumberInteger",
	]:
		if strForbiddenContract in strUInt64Conversions:
			return Fail(f"shared native uint64 converter must not silently coerce bad values: {strForbiddenContract}")

	return 0

def CheckEventsNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	strRuntimeHeader = ReadText(ROOT / "src" / "sourcejs" / "V8Runtime.h")
	strRuntimeImplementation = ReadText(ROOT / "src" / "sourcejs" / "V8Runtime.cpp")
	nEventsBegin = strModuleBindings.find("bool RequireEventStringFromValue")
	nEventsEnd = strModuleBindings.find("void GetPlayerCallback", nEventsBegin)
	nRuntimeEventsBegin = strRuntimeImplementation.find("bool V8Runtime::AddGameEventCallback")
	nRuntimeEventsEnd = strRuntimeImplementation.find("bool V8Runtime::RegisterCommand", nRuntimeEventsBegin)
	nContextCleanupBegin = strRuntimeImplementation.find("void V8Runtime::RemoveCallbacksForContext")
	nContextCleanupEnd = strRuntimeImplementation.find("bool V8Runtime::ReadFile", nContextCleanupBegin)
	if (nEventsBegin < 0) or (nEventsEnd < 0) or (nRuntimeEventsBegin < 0) or (nRuntimeEventsEnd < 0) or (nContextCleanupBegin < 0) or (nContextCleanupEnd < 0):
		return Fail("native events or runtime game-event callback blocks could not be located")

	strEventBindings = strModuleBindings[nEventsBegin:nEventsEnd]
	strRuntimeGameEvents = strRuntimeImplementation[nRuntimeEventsBegin:nRuntimeEventsEnd]
	strRuntimeContextCleanup = strRuntimeImplementation[nContextCleanupBegin:nContextCleanupEnd]

	for strRequiredContract in [
		"bool RequireEventStringFromValue",
		"bool RequireEventObjectFromValue",
		"bool SetGameEventValueFromV8",
		"bool SetGameEventPayloadFromObject",
		"IGameEventManager2* RequireGameEventManager",
		"IGameEvent* RequireGameEventAddress",
		"!GetAddressSizedUnsignedIntegerFromValue(LocalValue, unAddress) || (unAddress == 0)",
		"return reinterpret_cast<IGameEvent*>(unAddress);",
		"GetInt32Argument(pIsolate, LocalContext, LocalValue, kIntegerConversionError, nValue)",
		"GetNumberArgument(pIsolate, LocalContext, LocalValue, kNumberConversionError, dblValue)",
		"std::numeric_limits<float>::lowest()",
		"std::numeric_limits<float>::max()",
		"LocalValue->IsBigInt()",
		"pGameEvent->SetUint64(pszKey, unValue)",
		"pEvent->SetUint64(strKey.c_str(), unValue);",
		"does not support uint64 payload values on this SDK.",
		"payload values must be booleans, int32 values, finite floats, strings, or supported uint64 BigInts.",
		"events.FireEvent(strName, Payload?, bDoNotBroadcast?) could not enumerate payload properties.",
		"payload keys must be non-empty strings.",
		'constexpr char kOperationName[] = "events.FireEvent()";',
		"RequireGameEventManager(pIsolate, kOperationName)",
		"pEventManager->FreeEvent(pEvent);",
		"const bool bHasPayload = !LocalPayloadValue.IsEmpty() && !LocalPayloadValue->IsUndefined();",
		"RequireEventObjectFromValue(pIsolate, LocalPayloadValue, kPayloadTypeError, LocalPayloadObject)",
		'RequireGameEventManager(pIsolate, "memory/hooks/events.GetManagerAddress()")',
		'RequireGameEventManager(pIsolate, "memory/hooks/events.GetFireEventHookOptions()")',
		'"memory/hooks/events.FreeEvent(unEventAddress)"',
		'SetRecordProperty(pIsolate, LocalContext, LocalObject, "ObjectAddress", v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unManagerAddress)))',
		'SetRecordProperty(pIsolate, LocalContext, LocalObject, "Arguments", LocalArguments)',
		'"events/resource.LoadEventsFromFile(strPath)"',
		"events.FireEvent(strName, Payload?, bDoNotBroadcast?) expects strName to be non-empty.",
		"RequireEventStringFromValue(pIsolate, CallbackInformation[kEventNameArgumentIndex], kEventNameError, kAllowEmptyName, strName)",
		"(CallbackInformation.Length() > kBroadcastArgumentIndex) && !CallbackInformation[kBroadcastArgumentIndex]->IsUndefined()",
		"bDoNotBroadcast = CallbackInformation[kBroadcastArgumentIndex].As<v8::Boolean>()->Value();",
		"bool CopyEventObjectProperties",
		"bool AddEventPayloadDefaults",
		"bool MakeCustomEventPayload",
		"RequireEventObjectFromValue(pIsolate, LocalVariables, kVariablesArgumentError, LocalVariablesObject)",
		"RequireEventObjectFromValue(pIsolate, LocalOverrides, kOverridesArgumentError, LocalOverridesObject)",
		"events.CreateEventPayload(Variables?, Overrides?) expects Variables to be an object.",
		"events.CreateEventPayload(Variables?, Overrides?) expects Overrides to be an object.",
		"Custom event FireEvent(Overrides?, bDoNotBroadcast?) expects bDoNotBroadcast to be boolean.",
		"events.FireEvent(strName, Payload?, bDoNotBroadcast?) could not create the requested game event.",
		"RequireGameEventAddress(pIsolate, CallbackInformation[kEventAddressArgumentIndex], kOperationName)",
		'"memory/hooks/events.EventName(unEventAddress)"',
		'"memory/hooks/events.EventInfo(unEventAddress)"',
		'"memory/hooks/events.IsEmpty(unEventAddress, strName?)"',
		'"memory/hooks/events.GetBool(unEventAddress, strKeyName, bDefaultValue?)"',
		'"memory/hooks/events.GetInt(unEventAddress, strKeyName, nDefaultValue?)"',
		'"memory/hooks/events.GetUInt64(unEventAddress, strKeyName, unDefaultValue?)"',
		'"memory/hooks/events.GetFloat(unEventAddress, strKeyName, dblDefaultValue?)"',
		'"memory/hooks/events.GetString(unEventAddress, strKeyName, strDefaultValue?)"',
		'"memory/hooks/events.SetBool(unEventAddress, strKeyName, bValue)"',
		'"memory/hooks/events.SetInt(unEventAddress, strKeyName, nValue)"',
		'"memory/hooks/events.SetUInt64(unEventAddress, strKeyName, unValue)"',
		'"memory/hooks/events.SetFloat(unEventAddress, strKeyName, dblValue)"',
		'"memory/hooks/events.SetString(unEventAddress, strKeyName, strValue)"',
		"memory/hooks/events.SetBool(unEventAddress, strKeyName, bValue) expects a game event BigInt address, key, and value.",
		"memory/hooks/events.SetInt(unEventAddress, strKeyName, nValue) expects a game event BigInt address, key, and value.",
		"memory/hooks/events.SetUInt64(unEventAddress, strKeyName, unValue) expects a game event BigInt address, key, and value.",
		"memory/hooks/events.SetFloat(unEventAddress, strKeyName, dblValue) expects a game event BigInt address, key, and value.",
		"memory/hooks/events.SetString(unEventAddress, strKeyName, strValue) expects a game event BigInt address, key, and value.",
		"GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kDefaultValueArgumentIndex], kDefaultValueArgumentError, nDefaultValue)",
		"RequireUInt64FromValue(pIsolate, LocalContext, CallbackInformation[kDefaultValueArgumentIndex], kDefaultValueError, unDefaultValue)",
		"GetNumberArgument(pIsolate, LocalContext, CallbackInformation[kDefaultValueArgumentIndex], kDefaultValueArgumentError, dblDefaultValue)",
		"GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], kValueArgumentError, nValue)",
		"RequireUInt64FromValue(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], kValueArgumentError, unValue)",
		"GetNumberArgument(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], kValueArgumentError, dblValue)",
		"memory/hooks/events.GetUInt64(unEventAddress, strKeyName, unDefaultValue?) expects unDefaultValue to be an unsigned BigInt.",
		"memory/hooks/events.SetUInt64(unEventAddress, strKeyName, unValue) expects unValue to be an unsigned BigInt.",
		"RequireEventStringFromValue(pIsolate, CallbackInformation[kPathArgumentIndex], kPathError, kAllowEmptyPath, strPath)",
	]:
		if strRequiredContract not in strEventBindings:
			return Fail(f"strict native events binding missing: {strRequiredContract}")

	if strEventBindings.count("g_Application.GetEngineInterfaces().GetGameEventManager()") != 1:
		return Fail("native events binding must centralize IGameEventManager2 access in RequireGameEventManager")

	for strForbiddenContract in [
		"MakeEventAddressObject",
		'"addressString"',
		"bool const bDontBroadcast",
		"Args[1]->BooleanValue(pIsolate)",
		"if (!pEventManager || strName.empty())",
		"if (!pEventManager || !pEvent)",
		"SetGameEventValueFromV8(pIsolate, LocalContext, pEvent, strKey, LocalValue);\n\t\t}",
		"SetGameEventPayloadFromObject(pIsolate, LocalContext, pEvent, LocalPayload.As<v8::Object>());",
		"IGameEventManager2* const pEventManager = g_Application.GetEngineInterfaces().GetGameEventManager();\n\t\tif (!pEventManager) {\n\t\t\tArgs.GetReturnValue().Set(false)",
		"if (Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(false)",
		"if (strPath.empty()) {\n\t\t\tArgs.GetReturnValue().Set(false)",
		'MakeString(pIsolate, pEvent && pEvent->GetName() ? pEvent->GetName() : "")',
		'pEvent ? pEvent->IsReliable() : false',
		'pEvent ? pEvent->IsLocal() : false',
		"pEvent ? pEvent->IsEmpty(strKey.empty() ? nullptr : strKey.c_str()) : true",
		"pEvent ? pEvent->GetBool(strKey.empty() ? nullptr : strKey.c_str(), bDefaultValue) : bDefaultValue",
		"pEvent ? pEvent->GetInt(strKey.empty() ? nullptr : strKey.c_str(), nDefaultValue) : nDefaultValue",
		"pEvent ? static_cast<std::uint64_t>(pEvent->GetUint64",
		"pEvent ? pEvent->GetFloat(strKey.empty() ? nullptr : strKey.c_str(), flDefaultValue) : flDefaultValue",
		"pEvent ? pEvent->GetString(strKey.empty() ? nullptr : strKey.c_str(), strDefaultValue.c_str()) : strDefaultValue.c_str()",
		"if (!pEvent || Args.Length() < 3) {\n\t\t\tArgs.GetReturnValue().Set(false);",
	]:
		if strForbiddenContract in strEventBindings:
			return Fail(f"native events binding must throw for missing event manager or invalid usage: {strForbiddenContract.splitlines()[0]}")

	for strCallbackStart, strCallbackEnd, strContractLabel in [
		("bool SetGameEventValueFromV8", "bool SetGameEventPayloadFromObject", "events.FireEvent payload"),
		("void GetEventIntegerCallback", "void GetEventUInt64Callback", "memory/hooks/events.GetInt"),
		("void GetEventUInt64Callback", "void GetEventFloatCallback", "memory/hooks/events.GetUInt64"),
		("void GetEventFloatCallback", "void GetEventStringCallback", "memory/hooks/events.GetFloat"),
		("void SetEventIntegerCallback", "void SetEventUInt64Callback", "memory/hooks/events.SetInt"),
		("void SetEventUInt64Callback", "void SetEventFloatCallback", "memory/hooks/events.SetUInt64"),
		("void SetEventFloatCallback", "void SetEventStringCallback", "memory/hooks/events.SetFloat"),
	]:
		if (strCallbackStart not in strEventBindings) or (strCallbackEnd not in strEventBindings):
			return Fail(f"native {strContractLabel} callback block could not be located")

		strCallbackBindings = strEventBindings.split(strCallbackStart, 1)[1].split(strCallbackEnd, 1)[0]
		if "FromMaybe(0)" in strCallbackBindings:
			return Fail(f"native {strContractLabel} must reject invalid numeric conversions instead of using 0")

	for strRequiredContract in [
		"class V8Runtime : public IGameEventListener2",
		"bool AddGameEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction);",
		"bool RemoveGameEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction);",
		"void FireGameEvent(IGameEvent* const pEvent) override;",
		"int GetEventDebugID() noexcept override;",
		"std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapGameEventCallbacks;",
		"std::map<std::uint64_t, IGameEvent*> m_mapActiveGameEvents;",
	]:
		if strRequiredContract not in strRuntimeHeader:
			return Fail(f"V8 runtime game-event listener contract missing: {strRequiredContract}")

	for strRequiredContract in [
		"pGameEventManager->AddListener(this, strEventName.c_str(), true)",
		"pGameEventManager->RemoveListener(this);",
		"bool V8Runtime::RebuildGameEventListeners()",
		"void V8Runtime::FireGameEvent(IGameEvent* const pEvent)",
		"MakeGameEventView(LocalContext, pEvent, unEventToken)",
		"m_mapActiveGameEvents.emplace(unEventToken, pEvent)",
		"m_mapActiveGameEvents.erase(unEventToken);",
		'reinterpret_cast<std::uintptr_t>(pEvent)',
		"v8::BigInt::NewFromUnsigned(m_pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pEvent)))",
		'SetMethod("IsEventEmpty", IsGameEventEmptyCallback)',
		'SetMethod("GetEventBoolean", GetGameEventBooleanCallback)',
		'SetMethod("GetEventInteger", GetGameEventIntegerCallback)',
		'SetMethod("GetEventFloat", GetGameEventFloatCallback)',
		'SetMethod("GetEventString", GetGameEventStringCallback)',
		'SetMethod("SetEventBoolean", SetGameEventBooleanCallback)',
		'SetMethod("SetEventInteger", SetGameEventIntegerCallback)',
		'SetMethod("SetEventFloat", SetGameEventFloatCallback)',
		'SetMethod("SetEventString", SetGameEventStringCallback)',
		"auto InstallUInt64Methods = [&SetMethod]<typename EventType>() -> bool",
		'SetMethod("GetEventUInt64", GetGameEventUInt64Callback<EventType>)',
		'SetMethod("SetEventUInt64", SetGameEventUInt64Callback<EventType>)',
		"InstallUInt64Methods.template operator()<IGameEvent>()",
		"cannot access an event after its callback has returned.",
		"std::numeric_limits<float>::lowest()",
		"std::numeric_limits<float>::max()",
	]:
		if strRequiredContract not in strRuntimeGameEvents:
			return Fail(f"V8 runtime live game-event implementation missing: {strRequiredContract}")

	for strRequiredContract in [
		"m_mapGameEventCallbacks.begin()",
		"RemoveStoredFunctionsForContext(m_pIsolate, itGameEventCallbacks->second, LocalContext);",
		"bGameEventListenersChanged = true;",
		"RebuildGameEventListeners()",
	]:
		if strRequiredContract not in strRuntimeContextCleanup:
			return Fail(f"V8 runtime game-event context cleanup missing: {strRequiredContract}")

	for strRequiredContract in [
		'SetFunction(pIsolate, LocalContext, LocalEventsModule, "RegisterEventListener", RegisterGameEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalEventsModule, "UnregisterEventListener", UnregisterGameEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalEventManagerModule, "RegisterEventListener", RegisterGameEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalEventManagerModule, "UnregisterEventListener", UnregisterGameEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalEventListenerModule, "RegisterEventListener", RegisterGameEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalEventListenerModule, "UnregisterEventListener", UnregisterGameEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalListenersModule, "AddListener", AddRuntimeEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalListenersModule, "RemoveListener", RemoveRuntimeEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMemoryHookEventsModule, "AddListener", AddRuntimeEventListenerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMemoryHookEventsModule, "RemoveListener", RemoveRuntimeEventListenerCallback, LocalRuntimeData)',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"native events/listeners ownership contract missing: {strRequiredContract}")

	return 0

def CheckPlayerFactoryNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nFactoryBegin = strModuleBindings.find("void GetPlayerCallback")
	nFactoryEnd = strModuleBindings.find("void GetTeamNumberCallback", nFactoryBegin)
	nPrerequisitesBegin = strModuleBindings.find("IPlayerInfoManager* RequirePlayerInformationManager")
	nPrerequisitesEnd = strModuleBindings.find("IPlayerInfo* RequirePlayerInformationFromIndex", nPrerequisitesBegin)
	if (nFactoryBegin < 0) or (nFactoryEnd < 0) or (nPrerequisitesBegin < 0) or (nPrerequisitesEnd < 0):
		return Fail("native players factory or prerequisite blocks could not be located")

	strPlayerFactoryBindings = strModuleBindings[nFactoryBegin:nFactoryEnd]
	strPlayerPrerequisites = strModuleBindings[nPrerequisitesBegin:nPrerequisitesEnd]

	for strRequiredContract in [
		"CGlobalVars* RequirePlayersGlobals",
		'" requires IPlayerInfoManager."',
		'" requires CGlobalVars and IVEngineServer edicts."',
	]:
		if strRequiredContract not in strPlayerPrerequisites:
			return Fail(f"strict native players prerequisite missing: {strRequiredContract}")

	for strRequiredContract in [
		'RequirePlayerInformationManager(pIsolate, kOperationName)',
		'RequirePlayersGlobals(pIsolate, kOperationName)',
		'constexpr char kOperationName[] = "Player(nEntityIndex)";',
		'constexpr char kOperationName[] = "players iterator";',
		'Player(nEntityIndex) expects nEntityIndex to be a player index.',
	]:
		if strRequiredContract not in strPlayerFactoryBindings:
			return Fail(f"strict native players factory binding missing: {strRequiredContract}")

	for strCallbackStart, strCallbackEnd in [
		("void GetPlayerCallback", "v8::Local<v8::Array> MakePlayersArray"),
		("v8::Local<v8::Array> MakePlayersArray", "void GetAllPlayersCallback"),
	]:
		if (strCallbackStart not in strPlayerFactoryBindings) or (strCallbackEnd not in strPlayerFactoryBindings):
			return Fail("native players factory callback block could not be located")

		strCallbackBindings = strPlayerFactoryBindings.split(strCallbackStart, 1)[1].split(strCallbackEnd, 1)[0]
		if ("RequirePlayerInformationManager(pIsolate, kOperationName)" not in strCallbackBindings) or ("RequirePlayersGlobals(pIsolate, kOperationName)" not in strCallbackBindings):
			return Fail(f"native {strCallbackStart} must validate both SDK prerequisites")

	for strForbiddenContract in [
		"IPlayerInfoManager* const pPlayerInfoManager = g_Application.GetEngineInterfaces().GetPlayerInfoManager();\n\t\tif (!pPlayerInfoManager || Args.Length() < 1)",
		"IPlayerInfoManager* const pPlayerInfoManager = g_Application.GetEngineInterfaces().GetPlayerInfoManager();\n\t\tCGlobalVars* const pGlobals = g_Application.GetEngineInterfaces().GetGlobals();",
		"if (!pPlayerInfoManager || !pGlobals) {\n\t\t\treturn LocalArray;",
		"if (!pPlayerInfoManager || Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate))",
	]:
		if strForbiddenContract in strPlayerFactoryBindings:
			return Fail(f"native players factory/list binding must throw for missing SDK prerequisites: {strForbiddenContract.splitlines()[0]}")

	return 0

def CheckRecipientsNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strRequiredContract in [
		"bool RequirePlayerLookup",
		'RequirePlayerInformationManager(pIsolate, pszOperation)',
		'RequirePlayersGlobals(pIsolate, pszOperation)',
		"bool CollectPlayerEntityIndices(v8::Isolate* const pIsolate",
		"bool CollectRecipientEntityIndicesFromArray",
		"bool CollectRecipientEntityIndicesFromValue",
		'players/dictionary.Get(nEntityIndex) expects nEntityIndex to be a player index.',
		'players/dictionary.Has(nEntityIndex) expects nEntityIndex to be a player index.',
		'RequirePlayersGlobals(pIsolate, "players.GetMaximumClients()")',
		'CollectPlayerEntityIndices(pIsolate, vecRecipientEntityIndices, kAnyTeamIndex, PlayerFakeClientFilter::HUMAN, PlayerAliveFilter::ANY, "filters/recipients.GetHumanRecipients()")',
		'CollectPlayerEntityIndices(pIsolate, vecRecipientEntityIndices, kAnyTeamIndex, PlayerFakeClientFilter::ANY, PlayerAliveFilter::ANY, "filters/recipients.GetAllRecipients()")',
		'CollectPlayerEntityIndices(pIsolate, vecRecipientEntityIndices, kAnyTeamIndex, PlayerFakeClientFilter::BOT, PlayerAliveFilter::ANY, "filters/recipients.GetBotRecipients()")',
		'CollectPlayerEntityIndices(pIsolate, vecRecipientEntityIndices, kAnyTeamIndex, PlayerFakeClientFilter::HUMAN, PlayerAliveFilter::ALIVE, "filters/recipients.GetAliveRecipients()")',
		'CollectPlayerEntityIndices(pIsolate, vecRecipientEntityIndices, kAnyTeamIndex, PlayerFakeClientFilter::HUMAN, PlayerAliveFilter::DEAD, "filters/recipients.GetDeadRecipients()")',
		'const PlayerFakeClientFilter FakeClientFilter = bIncludeBots ? PlayerFakeClientFilter::ANY : PlayerFakeClientFilter::HUMAN;',
		'CollectPlayerEntityIndices(pIsolate, vecRecipientEntityIndices, nTeamIndex, FakeClientFilter, PlayerAliveFilter::ANY, kOperationName)',
		'CollectRecipientEntityIndicesFromValue(pIsolate, LocalContext, CallbackInformation[kRecipientValueArgumentIndex], vecRecipientEntityIndices, bIncludeBots, kOperationName)',
		'CollectRecipientEntityIndicesFromValue(pIsolate, LocalContext, CallbackInformation[kRecipientValuesArgumentIndex], vecRecipientEntityIndices, bIncludeBots, kOperationName)',
		'CollectRecipientEntityIndicesFromValue(pIsolate, LocalContext, CallbackInformation[kRecipientFilterArgumentIndex], vecRecipientEntityIndices, kIncludeBots, kOperationName)',
		'filters/recipients.GetRecipientsByTeam(TeamValue, bIncludeBots?) expects a team.',
		'filters/recipients.CreateRecipientFilterFromPlayer(RecipientValue, bIncludeBots?) expects a player value.',
		'filters/recipients.CreateRecipientFilterFromValues(RecipientValues, bIncludeBots?) expects recipient values.',
		'filters/recipients.ContainsRecipient(RecipientFilter, RecipientValue) expects a filter and recipient value.',
		'filters/recipients.ResolveRecipientPlayers(RecipientFilter) expects a recipient filter.',
		'SetFunction(pIsolate, LocalContext, LocalFiltersRecipientsModule, "CreateRecipientFilterFromPlayer", CreateRecipientFilterFromPlayerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalFiltersRecipientsModule, "CreateRecipientFilterFromValues", CreateRecipientFilterFromValuesCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalFiltersRecipientsModule, "ResolveRecipientPlayers", ResolveRecipientPlayersCallback, LocalRuntimeData)',
		'CollectRecipientEntityIndicesFromValue(pIsolate, LocalContext, CallbackInformation[kRecipientsArgumentIndex], vecRecipients, kIncludeBots, kOperationName)',
		'CollectPlayerEntityIndices(pIsolate, vecRecipients, kAnyTeamIndex, PlayerFakeClientFilter::ANY, PlayerAliveFilter::ANY, kOperationName)',
		"bool CollectSoundRecipients",
		'CollectSoundRecipients(pIsolate, LocalContext, LocalRecipientsValue, vecRecipientEntityIndexes, kAPIName)',
		'CollectRecipientEntityIndicesFromValue(pIsolate, LocalContext, LocalRecipientsArgumentValue, vecRecipientEntityIndices, true, kSendUserMessageAPIName)',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native recipient/player lookup binding missing: {strRequiredContract}")

	for strCallbackName, strOperation in [
		("EmitSoundCallback", "engines/sound.EmitSound()"),
		("SetSoundRoomTypeCallback", "engines/sound.SetSoundRoomType()"),
		("SetPlayerDSPCallback", "engines/sound.SetPlayerDSP()"),
	]:
		nCallbackBegin = strModuleBindings.find("void " + strCallbackName + "(")
		nCallbackEnd = strModuleBindings.find("\n\t\t}", nCallbackBegin)
		if (nCallbackBegin < 0) or (nCallbackEnd < 0):
			return Fail(f"native recipient sound callback could not be located: {strCallbackName}")

		strCallbackBindings = strModuleBindings[nCallbackBegin:nCallbackEnd]
		if (strOperation not in strCallbackBindings) or ("CollectSoundRecipients(pIsolate, LocalContext, LocalRecipientsValue, vecRecipientEntityIndexes, kAPIName)" not in strCallbackBindings):
			return Fail(f"native {strOperation} must validate recipients with its operation context")

	for strForbiddenContract in [
		"static void CollectPlayerIndexes(",
		"CollectPlayerIndexes(vec",
		"CollectRecipientIndexesFromValue(pIsolate, LocalContext, Args[1], vecRecipients, true);\n\t\tif (vecRecipients.empty())",
		"SoundCollectRecipients(pIsolate, LocalContext, LocalRecipients, vecRecipients);\n\t\tSourceJSSoundRecipientFilter",
		"SoundCollectRecipients(pIsolate, LocalContext, Args[0], vecRecipients);\n\t\tbool const bReliable",
		"SoundCollectRecipients(pIsolate, LocalContext, Args[0], vecRecipients);\n\t\tSourceJSSoundRecipientFilter",
		"CGlobalVars* const pGlobals = g_Application.GetEngineInterfaces().GetGlobals();\n\t\tArgs.GetReturnValue().Set(pGlobals ? pGlobals->maxClients : 0)",
	]:
		if strForbiddenContract in strModuleBindings:
			return Fail(f"native recipients/player lookup must throw for missing SDK prerequisites: {strForbiddenContract.splitlines()[0]}")

	return 0

def CheckPlayerHelpersNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nHelpersBegin = strModuleBindings.find("void GetPlayerIndexCallback")
	nHelpersEnd = strModuleBindings.find("void GetEntityCallback", nHelpersBegin)
	if (nHelpersBegin < 0) or (nHelpersEnd < 0):
		return Fail("native players helper block could not be located")

	strPlayerHelperBindings = strModuleBindings[nHelpersBegin:nHelpersEnd]
	for strRequiredContract in [
		"bool ExecuteClientCommandForPlayerIndex(v8::Isolate* const pIsolate",
		'std::string const strMessage = std::string(pszOperation) + " expects a non-empty command."',
		"CBaseEntity* GiveNamedItemEntity(v8::Isolate* const pIsolate",
		'RequirePlayerInformationFromIndex(pIsolate, nPlayerIndex, &pPlayerEdict, pszOperation)',
		'RequirePlayerInformationFromIndex(pIsolate, nPlayerIndex, nullptr, pszOperation)',
		'std::string const strMessage = std::string(pszOperation) + " requires a connected player."',
		'std::string const strMessage = std::string(pszOperation) + " expects a non-empty item name."',
		'std::string const strMessage = std::string(pszOperation) + " expects an integer subtype."',
		'std::string const strMessage = std::string(pszOperation) + " requires a live player entity."',
		"auto* const pPlayer = static_cast<CBasePlayer*>(pPlayerBaseEntity);",
		"return pPlayer->GiveNamedItem(strItem.c_str(), nSubtype, bRemoveIfNotCarried);",
		"return pPlayer->GiveNamedItem(strItem.c_str(), nSubtype);",
		"bool GetInt32Argument(v8::Isolate* const pIsolate",
		'ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, strCommand, bServerSide, kAPIName)',
		"GetPlayerGameDataSlot(Action.m_pszName, unSlot)",
		'ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, "say " + QuoteCommandArgument(strMessage), kServerSideCommand, kAPIName)',
		'ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, "say_team " + QuoteCommandArgument(strMessage), kServerSideCommand, kAPIName)',
		'"Player.ExecuteClientCommand()"',
		'"Player.Slay()"',
		'"Player.Say()"',
		'"Player.SayTeam()"',
		'RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kAPIName)',
		'Player.Kick() requires a connected player.',
		'RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperation)',
		'Player.Ban() requires a connected player.',
		'constexpr double kMaximumBanDuration = static_cast<double>(std::numeric_limits<std::int32_t>::max());',
		'LocalDurationValue->IsNumber()',
		'const double dblBanDuration = LocalDurationValue.As<v8::Number>()->Value();',
		'!std::isfinite(dblBanDuration) || (std::floor(dblBanDuration) != dblBanDuration)',
		'(dblBanDuration < 0) || (dblBanDuration > kMaximumBanDuration)',
		'nBanDuration = static_cast<int>(dblBanDuration);',
		'Player.Ban(nBanDuration?, bKickPlayer?, bWriteBanList?) expects a non-negative signed 32-bit duration.',
		"GetTeamNumberFromValue(GetRuntimeFromCallbackInformation(CallbackInformation), pIsolate, LocalContext, CallbackInformation[kTeamArgumentIndex], nTeamIndex, strError)",
		'Player.ChangeTeam(TeamReference) expects a non-negative team index.',
		'players/teams.ChangePlayerTeam(nEntityIndex, Team) expects Team to resolve to a non-negative team index.',
		'"commands.Send()"',
		'"commands.Say()"',
		'"commands.SayTeam()"',
		"int FindPlayerEntityIndex(v8::Isolate* const pIsolate, char const* const pszOperationName",
		'RequirePlayerInformationManager(pIsolate, pszOperationName)',
		'RequirePlayersGlobals(pIsolate, pszOperationName)',
		'players/helpers.GetIndexFromUserID(nUserID) expects an integer user ID.',
		'players.GetPlayerFromUserID(nUserID) expects an integer user ID.',
		'RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, &pEdict, kOperationName)',
		'players.SpawnPlayer(Player, bForce?) requires a connected player.',
		'players/helpers.GetIndexFromName(strName) expects a player name string.',
		'players/helpers.GetIndexFromNetworkID(strNetworkID) expects a network ID string.',
		'RequirePlayerInformationManager(pIsolate, kOperationName)',
		'RequirePlayersGlobals(pIsolate, kOperationName)',
		'"players/helpers.GetUserID(Player)"',
		'"players/helpers.GetName(Player)"',
		'"players/helpers.GetNetworkAddress(Player)"',
		'RequireEngineServer(pIsolate, kOperationName)',
		'RequireConnectedHumanPlayerInformation(pIsolate, pPlayerInformation, kOperationName)',
		'"players/helpers.GetNetworkID(Player)"',
		'"players/helpers.IsConnected(Player)"',
		'"players/helpers.GetClientCVarValue(Player, strCVarName)"',
		'players/helpers.GetClientCVarValue(Player, strCVarName) expects a non-empty CVar name.',
		'GetClientConVarValue(pEngineServer, nEntityIndex, strCVarName)',
		'"players/helpers.GetClientLanguage(Player)"',
		"void GetPlayerNameCallback",
		"void GetPlayerTeamCallback",
		"void GetPlayerUserIDCallback",
		"void GetPlayerNetworkIDCallback",
		"void GetPlayerOriginCallback",
		"void IsPlayerConnectedCallback",
		"void IsPlayerFakeClientCallback",
		"void IsPlayerDeadCallback",
		'RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)',
		'players.GetName(Player) expects a player.',
		'players.GetTeam(Player) expects a player.',
		'players.GetUserID(Player) expects a player.',
		'players.GetNetworkID(Player) expects a player.',
		'players.GetOrigin(Player) expects a player.',
		'players.IsConnected(Player) expects a player.',
		'players.IsFakeClient(Player) expects a player.',
		'players.IsDead(Player) expects a player.',
		'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetName", GetPlayerNameCallback',
		'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetTeam", GetPlayerTeamCallback',
		'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetUserID", GetPlayerUserIDCallback',
		'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetNetworkID", GetPlayerNetworkIDCallback',
		'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetOrigin", GetPlayerOriginCallback',
		'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "IsConnected", IsPlayerConnectedCallback',
		'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "IsFakeClient", IsPlayerFakeClientCallback',
		'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "IsDead", IsPlayerDeadCallback',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native players helper binding missing: {strRequiredContract}")

	for strCallbackName, strOperation, strRequiredGuard in [
		("PlayerExecuteClientCommandMethodCallback", "Player.ExecuteClientCommand()", "ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, strCommand, bServerSide, kAPIName)"),
		("PlayerSlayMethodCallback", "Player.Slay()", "CommitPlayerSuicide(nPlayerIndex)"),
		("PlayerSayMethodCallback", "Player.Say()", 'ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, "say " + QuoteCommandArgument(strMessage), kServerSideCommand, kAPIName)'),
		("PlayerSayTeamMethodCallback", "Player.SayTeam()", 'ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, "say_team " + QuoteCommandArgument(strMessage), kServerSideCommand, kAPIName)'),
		("PlayerKickMethodCallback", "Player.Kick()", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kAPIName)"),
		("PlayerBanMethodCallback", "Player.Ban()", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperation)"),
		("PlayerChangeTeamMethodCallback", "Player.ChangeTeam()", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kAPIName)"),
		("ChangePlayerTeamCallback", "players/teams.ChangePlayerTeam(nEntityIndex, Team)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperationName)"),
		("SendClientCommandCallback", "commands.Send()", "ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, strCommand, bServerSide, kAPIName)"),
		("SayCallback", "commands.Say()", 'ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, "say " + QuoteCommandArgument(strMessage), kServerSideCommand, kAPIName)'),
		("SayToTeamCallback", "commands.SayTeam()", 'ExecuteClientCommandForPlayerIndex(pIsolate, nPlayerIndex, "say_team " + QuoteCommandArgument(strMessage), kServerSideCommand, kAPIName)'),
		("SpawnPlayerCallback", "players.SpawnPlayer(Player, bForce?)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, &pEdict, kOperationName)"),
		("GetPlayerUserIDFromIndexCallback", "players/helpers.GetUserID(Player)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperationName)"),
		("GetPlayerNameFromIndexCallback", "players/helpers.GetName(Player)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperationName)"),
		("GetPlayerNetworkAddressFromIndexCallback", "players/helpers.GetNetworkAddress(Player)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperationName)"),
		("GetPlayerNetworkIDFromIndexCallback", "players/helpers.GetNetworkID(Player)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperationName)"),
		("IsPlayerConnectedByIndexCallback", "players/helpers.IsConnected(Player)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperationName)"),
		("GetPlayerClientCVarValueCallback", "players/helpers.GetClientCVarValue(Player, strCVarName)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperationName)"),
		("GetPlayerClientLanguageCallback", "players/helpers.GetClientLanguage(Player)", "RequirePlayerInformationFromIndex(pIsolate, nEntityIndex, nullptr, kOperationName)"),
		("GetPlayerNameCallback", "players.GetName()", "RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)"),
		("GetPlayerTeamCallback", "players.GetTeam()", "RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)"),
		("GetPlayerUserIDCallback", "players.GetUserID()", "RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)"),
		("GetPlayerNetworkIDCallback", "players.GetNetworkID()", "RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)"),
		("GetPlayerOriginCallback", "players.GetOrigin()", "RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)"),
		("IsPlayerConnectedCallback", "players.IsConnected()", "RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)"),
		("IsPlayerFakeClientCallback", "players.IsFakeClient()", "RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)"),
		("IsPlayerDeadCallback", "players.IsDead()", "RequirePlayerInformationArgument(CallbackInformation, kArgumentError, kAPIName)"),
	]:
		nCallbackBegin = strModuleBindings.find("void " + strCallbackName + "(")
		nCallbackEnd = strModuleBindings.find("\n\t\t}", nCallbackBegin)
		if (nCallbackBegin < 0) or (nCallbackEnd < 0):
			return Fail(f"native players helper callback could not be located: {strCallbackName}")

		strCallbackBindings = strModuleBindings[nCallbackBegin:nCallbackEnd]
		if (strOperation not in strCallbackBindings) or (strRequiredGuard not in strCallbackBindings):
			return Fail(f"native {strOperation} must validate its player or command before use")

	for strForbiddenContract in [
		"static bool ClientCommandIndex(int const nIndex",
		"ClientCommandIndex(nIndex,",
		"ClientCommandIndex(ThisObjectIndex(Args)",
		"GiveNamedItemEntity(nPlayerIndex, strItem",
		"if (nIndex <= 0 || !pPlayerInfo || !pEdict || pEdict->IsFree())",
		"players.helpers.indexFromUserId requires PlayerInfoManager and global vars.",
		"players.fromUserId requires PlayerInfoManager and global vars.",
		"players.helpers.indexFromName requires PlayerInfoManager and global vars.",
		"players.helpers.indexFromNetworkId requires PlayerInfoManager and global vars.",
		"g_Application.GetEngineInterfaces().GetPlayerInfoManager()",
		"g_Application.GetEngineInterfaces().GetPlayerInformationManager()",
		"g_Application.GetEngineInterfaces().GetGlobals()",
		"pPlayerInfo ? pPlayerInfo->GetUserID() : -1",
		"pPlayerInfo ? pPlayerInfo->GetName() : \"\"",
		"pInfo ? pInfo->GetAddress() : \"\"",
		"pPlayerInfo ? pPlayerInfo->GetNetworkIDString() : \"\"",
		"Args.GetReturnValue().Set(MakeString(pIsolate, \"\"))",
	]:
		if strForbiddenContract in strPlayerHelperBindings:
			return Fail(f"native players helpers must throw for missing SDK prerequisites: {strForbiddenContract}")

	for strCallbackStart, strCallbackEnd, vecForbiddenFields in [
		("void GetPlayerUserIDFromIndexCallback", "void GetPlayerNameFromIndexCallback", ['"userID"', '"UserID"']),
		("void GetPlayerNameFromIndexCallback", "void GetPlayerNetworkAddressFromIndexCallback", ['"name"', '"Name"']),
		("void GetPlayerNetworkAddressFromIndexCallback", "void GetPlayerNetworkIDFromIndexCallback", ['"networkAddress"', '"NetworkAddress"']),
		("void GetPlayerNetworkIDFromIndexCallback", "void IsPlayerConnectedByIndexCallback", ['"steamID"', '"uniqueID"', '"networkID"', '"SteamID"', '"UniqueID"', '"NetworkID"']),
	]:
		if (strCallbackStart not in strModuleBindings) or (strCallbackEnd not in strModuleBindings):
			return Fail("native player live-state callback block could not be located")

		strCallbackBindings = strModuleBindings.split(strCallbackStart, 1)[1].split(strCallbackEnd, 1)[0]
		for strForbiddenField in vecForbiddenFields:
			if strForbiddenField in strCallbackBindings:
				return Fail(f"{strCallbackStart} must read live IPlayerInfo state instead of JS field {strForbiddenField}")

	nClientCommandBegin = strModuleBindings.find("bool ExecuteClientCommandForPlayerIndex")
	nClientCommandEnd = strModuleBindings.find("std::string GetClientConVarValue", nClientCommandBegin)
	nGiveNamedItemBegin = strModuleBindings.find("CBaseEntity* GiveNamedItemEntity")
	nGiveNamedItemEnd = strModuleBindings.find("bool ReadEntityIndex(v8::FunctionCallbackInfo", nGiveNamedItemBegin)
	nItemArgumentsBegin = strModuleBindings.find("CBaseEntity* GiveNamedItemFromArguments(")
	nItemArgumentsEnd = strModuleBindings.find("void PlayerGiveNamedItemMethodCallback(", nItemArgumentsBegin)
	nSpawnBegin = strModuleBindings.find("void SpawnPlayerCallback")
	nSpawnEnd = strModuleBindings.find("void GetPlayerIndexFromNameCallback", nSpawnBegin)
	if (nClientCommandBegin < 0) or (nClientCommandEnd < 0) or (nGiveNamedItemBegin < 0) or (nGiveNamedItemEnd < 0) or (nItemArgumentsBegin < 0) or (nItemArgumentsEnd < 0) or (nSpawnBegin < 0) or (nSpawnEnd < 0):
		return Fail("native player command, item, or spawn helper blocks could not be located")

	strClientCommandBindings = strModuleBindings[nClientCommandBegin:nClientCommandEnd]
	for strForbiddenContract in [
		"PlayerInfoFromIndex(nIndex, &pEdict)",
		"if (!pPlayerInfo || !pPlayerInfo->IsConnected() || !pEdict || pEdict->IsFree())",
	]:
		if strForbiddenContract in strClientCommandBindings:
			return Fail(f"ExecuteClientCommandForPlayerIndex must throw through RequirePlayerInformationFromIndex: {strForbiddenContract}")

	strGiveNamedItemBindings = strModuleBindings[nGiveNamedItemBegin:nGiveNamedItemEnd]
	for strForbiddenContract in [
		"PlayerInfoFromIndex(nIndex, &pEdict)",
		"if (!pPlayerInfo || !pPlayerInfo->IsConnected() || !pEdict || pEdict->IsFree())",
		"if (!pPlayerEntity) {\n\t\t\treturn nullptr;",
		"if (!ppVTable || !*ppVTable || !(*ppVTable)[nVTableIndex]) {\n\t\t\treturn nullptr;",
		"GetGiveNamedItemVTableIndex",
		"fnGiveNamedItem",
		"(*ppVTable)[nVTableIndex]",
	]:
		if strForbiddenContract in strGiveNamedItemBindings:
			return Fail(f"GiveNamedItemEntity must throw through native V8 errors: {strForbiddenContract.splitlines()[0]}")

	strGiveNamedItemArgumentBindings = strModuleBindings[nItemArgumentsBegin:nItemArgumentsEnd]
	for strForbiddenContract in [
		"Args[nItemArgument + 1]->Int32Value(LocalContext).FromMaybe(0)",
		"Args.Length() > nItemArgument + 1 ? Args[nItemArgument + 1]->Int32Value(LocalContext).FromMaybe(0) : 0",
	]:
		if strForbiddenContract in strGiveNamedItemArgumentBindings:
			return Fail(f"GiveNamedItemFromArguments must reject invalid subtype instead of using 0: {strForbiddenContract}")

	strPlayerSpawnBindings = strModuleBindings[nSpawnBegin:nSpawnEnd]
	for strForbiddenContract in [
		"PlayerInfoFromIndex(nIndex, &pEdict)",
		"if (nIndex <= 0 || !pPlayerInfo || !pEdict || pEdict->IsFree())",
	]:
		if strForbiddenContract in strPlayerSpawnBindings:
			return Fail(f"players.SpawnPlayer() must throw through RequirePlayerInformationFromIndex: {strForbiddenContract}")

	for strCallbackStart, strCallbackEnd, strContractLabel in [
		("void PlayerBanMethodCallback", "void PlayerChangeTeamMethodCallback", "Player.Ban"),
		("void PlayerChangeTeamMethodCallback", "void SetPlayerNameCallback", "Player.ChangeTeam"),
		("void SetPlayerNameCallback", "void SendClientCommandCallback", "players.SetName"),
		("void SendClientCommandCallback", "void SayCallback", "commands.Send"),
		("void SayCallback", "void SayToTeamCallback", "commands.Say"),
		("void SayToTeamCallback", "v8::Local<v8::Object> MakeVectorObject", "commands.SayTeam"),
		("void ChangePlayerTeamCallback", "bool DoesPlayerMatchFilters", "players/teams.ChangePlayerTeam"),
	]:
		if (strCallbackStart not in strModuleBindings) or (strCallbackEnd not in strModuleBindings):
			return Fail(f"native {strContractLabel} callback block could not be located")

		strCallbackBindings = strModuleBindings.split(strCallbackStart, 1)[1].split(strCallbackEnd, 1)[0]
		if "FromMaybe(0)" in strCallbackBindings:
			return Fail(f"native {strContractLabel} must reject invalid integer arguments instead of converting them to 0")

	return 0

def CheckWeaponsNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nWeaponsBegin = strModuleBindings.find("void GetCurrentWeaponCallback")
	nWeaponsEnd = strModuleBindings.find("bool InstallWeaponPropertyAndAmmoFunctions", nWeaponsBegin)
	if (nWeaponsBegin < 0) or (nWeaponsEnd < 0):
		return Fail("native weapons callback block could not be located")

	strWeaponBindings = strModuleBindings[nWeaponsBegin:nWeaponsEnd]
	for strRequiredContract in [
		'ThrowError(pIsolate, "weapons.GetCurrentWeapon(PlayerReference) expects a player reference.")',
		"GetPlayerActiveWeaponCallback(CallbackInformation);",
		"bool CollectWeaponIndexes(v8::Isolate* const pIsolate",
		"RequirePlayersGlobals(pIsolate, pszOperationName)",
		"v8::Local<v8::Array> MakeWeaponNameArray(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, CGlobalVars* const pGlobalVariables",
		'CollectWeaponIndexes(pIsolate, vecWeaponIndexes, strWeaponClassNameFilter, "Weapons.GetAllWeapons()")',
		'CollectWeaponIndexes(pIsolate, vecWeaponIndexes, strWeaponClassName, "Weapons.GetWeaponsByClassName()")',
		'CollectWeaponIndexes(pIsolate, vecWeaponIndexes, strWeaponClassName, "Weapons.GetWeaponsByName()")',
		'RequirePlayersGlobals(pIsolate, "Weapons.GetNames()")',
		'RequirePlayersGlobals(pIsolate, "Weapons.GetClasses()")',
		'CollectWeaponIndexes(pIsolate, vecWeaponIndexes, strWeaponClassNameFilter, "Weapons.GetCount()")',
		'CollectWeaponIndexes(pIsolate, vecWeaponIndexes, strWeaponClassNameFilter, kGetAllWeaponsDictionaryOperationName)',
		'CollectWeaponIndexes(pIsolate, vecWeaponIndexes, strWeaponClassNameFilter, kGetWeaponsDictionaryKeysOperationName)',
		'CollectWeaponIndexes(pIsolate, vecWeaponIndexes, strWeaponClassNameFilter, kGetWeaponsDictionaryValuesOperationName)',
		'CollectWeaponIndexes(pIsolate, vecWeaponIndexes, strWeaponClassNameFilter, kGetWeaponsDictionaryEntriesOperationName)',
	]:
		if strRequiredContract not in strWeaponBindings:
			return Fail(f"strict native weapons binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"g_Application.GetEngineInterfaces().GetPlayerInfoManager()",
		"g_Application.GetEngineInterfaces().GetPlayerInformationManager()",
		"GetWeaponName()",
		"static void CollectWeaponIndexes(",
		"CollectWeaponIndexes(vecIndexes",
		"CGlobalVars* const pGlobals = g_Application.GetEngineInterfaces().GetGlobals();\n\t\tif (!pGlobals) {\n\t\t\treturn;",
		"MakeWeaponClassNameArray(pIsolate, LocalContext, true)",
		"MakeWeaponClassNameArray(pIsolate, LocalContext, false)",
		"if (!pPlayerInfoManager || Args.Length() < 1) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate))",
	]:
		if strForbiddenContract in strWeaponBindings:
			return Fail(f"native weapons binding must throw for missing SDK prerequisites: {strForbiddenContract.splitlines()[0]}")

	return 0

def CheckEntityLiveScanNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nPrerequisitesBegin = strModuleBindings.find("CGlobalVars* RequireEntityGlobals(")
	nPrerequisitesEnd = strModuleBindings.find("bool RemoveEntityByIndex", nPrerequisitesBegin)
	nScanBegin = strModuleBindings.find("v8::Local<v8::Array> MakeEntityArray(")
	nScanEnd = strModuleBindings.find("void GetEntityIndexCallback", nScanBegin)
	if (nPrerequisitesBegin < 0) or (nPrerequisitesEnd < 0) or (nScanBegin < 0) or (nScanEnd < 0):
		return Fail("native entity live-scan or prerequisite blocks could not be located")

	strEntityPrerequisites = strModuleBindings[nPrerequisitesBegin:nPrerequisitesEnd]
	strEntityScanBindings = strModuleBindings[nScanBegin:nScanEnd]
	if '" requires CGlobalVars and IVEngineServer edicts."' not in strEntityPrerequisites:
		return Fail("native entity live-scan prerequisites must report missing globals or edicts")

	for strRequiredContract in [
		"v8::Local<v8::Array> MakeEntityArray(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, CGlobalVars* const pGlobalVariables",
		'RequireEntityGlobals(pIsolate, "entities.GetAllEntities()")',
		'"entities.GetEntitiesByClassName(strClassName)"',
		'"entities.FindEntityByClassName(strClassName)"',
		"bool CollectEntityIndices(v8::Isolate* const pIsolate",
		'RequireEntityGlobals(pIsolate, pszOperationName)',
		"v8::Local<v8::Array> MakeEntityClassNameArray(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, CGlobalVars* const pGlobalVariables)",
		'"entities/classes.GetEntityClassNames()"',
		'"entities/classes.GetEntitiesByClassName(strClassName)"',
		'CollectEntityIndices(pIsolate, vecEntityIndices, kClassNameFilter, kOperationName)',
		'"entities/dictionary.GetAllEntities()"',
		'"entities/dictionary.GetEntityDictionaryKeys()"',
		'"entities/dictionary.GetEntityDictionaryValues()"',
		'"entities/dictionary.GetEntityDictionaryEntries()"',
	]:
		if strRequiredContract not in strEntityScanBindings:
			return Fail(f"strict native entities live-scan binding missing: {strRequiredContract}")

	if strEntityPrerequisites.count("g_Application.GetEngineInterfaces().GetGlobalVariables()") != 1:
		return Fail("native entity live-scan bindings must centralize CGlobalVars access in RequireEntityGlobals")

	if "g_Application.GetEngineInterfaces().GetGlobalVariables()" in strEntityScanBindings:
		return Fail("native entity live-scan callbacks must not bypass RequireEntityGlobals")

	for strCallbackName, strRequiredGuard in [
		("GetEntitiesByClassNameCallback", "RequireEntityGlobals(pIsolate, kOperationName)"),
		("FindEntityByClassNameCallback", "RequireEntityGlobals(pIsolate, kOperationName)"),
		("GetEntityClassNamesCallback", "RequireEntityGlobals(pIsolate, kOperationName)"),
		("GetEntityClassInstancesByNameCallback", "RequireEntityGlobals(pIsolate, kOperationName)"),
		("GetAllDictionaryEntitiesCallback", "CollectEntityIndices(pIsolate, vecEntityIndices, kClassNameFilter, kOperationName)"),
		("GetEntityDictionaryKeysCallback", "CollectEntityIndices(pIsolate, vecEntityIndices, kClassNameFilter, kOperationName)"),
		("GetEntityDictionaryValuesCallback", "CollectEntityIndices(pIsolate, vecEntityIndices, kClassNameFilter, kOperationName)"),
		("GetEntityDictionaryEntriesCallback", "CollectEntityIndices(pIsolate, vecEntityIndices, kClassNameFilter, kOperationName)"),
	]:
		nCallbackBegin = strEntityScanBindings.find("void " + strCallbackName + "(")
		nCallbackEnd = strEntityScanBindings.find("\n\t\t}", nCallbackBegin)
		if (nCallbackBegin < 0) or (nCallbackEnd < 0):
			return Fail(f"native entity live-scan callback could not be located: {strCallbackName}")

		if strRequiredGuard not in strEntityScanBindings[nCallbackBegin:nCallbackEnd]:
			return Fail(f"native {strCallbackName} must validate SDK prerequisites before scanning")

	for strForbiddenContract in [
		"static v8::Local<v8::Array> MakeEntitiesArray(v8::Isolate* const pIsolate, v8::Local<v8::Context> LocalContext, std::string const& strClassName)",
		"CollectEntityIndexes(vecIndexes",
		"static void CollectEntityIndexes(",
		"MakeEntityClassNameArray(pIsolate, LocalContext)",
		"Args.GetReturnValue().Set(MakeEntitiesArray(pIsolate, LocalContext, strClassName))",
		"Args.GetReturnValue().Set(MakeEntitiesArray(pIsolate, LocalContext, \"\"))",
		"if (!pGlobals) {\n\t\t\tArgs.GetReturnValue().Set(v8::Null(pIsolate));",
		"if (!pGlobals) {\n\t\t\treturn LocalArray;",
	]:
		if strForbiddenContract in strEntityScanBindings:
			return Fail(f"native entities live-scan binding must throw for missing SDK prerequisites: {strForbiddenContract.splitlines()[0]}")

	return 0

def CheckEntitySingleLookupNativeErrors():
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nRemoveHelperBegin = strModuleBindings.find("bool RemoveEntityByIndex")
	nRemoveHelperEnd = strModuleBindings.find("IPlayerInfoManager* RequirePlayerInformationManager", nRemoveHelperBegin)
	nFactoryBegin = strModuleBindings.find("void GetEntityCallback")
	nFactoryEnd = strModuleBindings.find("void GetEntityCountCallback", nFactoryBegin)
	nRemoveBegin = strModuleBindings.find("void RemoveEntityCallback")
	nRemoveEnd = strModuleBindings.find("#if !defined(ENGINE_BRANCH_DARKM)", nRemoveBegin)
	nTransmitBegin = strModuleBindings.find("bool GetEntityTransmitStateFromValue")
	nTransmitEnd = strModuleBindings.find("// Entity factories", nTransmitBegin)
	if (nRemoveHelperBegin < 0) or (nRemoveHelperEnd < 0) or (nFactoryBegin < 0) or (nFactoryEnd < 0) or (nRemoveBegin < 0) or (nRemoveEnd < 0) or (nTransmitBegin < 0) or (nTransmitEnd < 0):
		return Fail("native entity lookup, remove, or transmit blocks could not be located")

	strRemoveEntityBindings = strModuleBindings[nRemoveHelperBegin:nRemoveHelperEnd]
	strEntityFactoryBindings = strModuleBindings[nFactoryBegin:nFactoryEnd]
	strEntityRemoveBindings = strModuleBindings[nRemoveBegin:nRemoveEnd]
	strEntityTransmitBindings = strModuleBindings[nTransmitBegin:nTransmitEnd]

	for strRequiredContract in [
		"(v8::Isolate* const pIsolate, const int nEntityIndex, char const* const pszOperation)",
		"auto* const pEngineServer = RequireEngineServer(pIsolate, pszOperation);",
		"if (!RequireEntityGlobals(pIsolate, pszOperation)) {",
	]:
		if strRequiredContract not in strRemoveEntityBindings:
			return Fail(f"strict native entity remove helper missing: {strRequiredContract}")

	for strRequiredContract in [
		'Entity(nEntityIndex) expects an entity index.',
		'"Entity(nEntityIndex)"',
		'RequireEntityGlobals(pIsolate, kOperationName)',
		'entities.GetEntityClassName(EntityValue) expects an entity value.',
		'"entities.GetEntityClassName(EntityValue)"',
		'entities/dictionary.GetEntityFromDictionary(EntityValue) expects an entity index or an object with Index.',
		'"entities/dictionary.GetEntityFromDictionary(EntityValue)"',
		'entities/dictionary.HasEntityInDictionary(EntityValue) expects an entity index or an object with Index.',
		'"entities/dictionary.HasEntityInDictionary(EntityValue)"',
		'entities.RemoveEntity(Entity) expects an entity or index.',
		'RemoveEntityByIndex(pIsolate, nEntityIndex, kOperationName)',
		'"Entity.RemoveEntity()"',
		'Weapons.Remove(WeaponReference) expects a non-negative weapon index or indexed object.',
		'RequireEntityGlobals(pIsolate, kRemoveWeaponOperationName)',
		'RemoveEntityByIndex(pIsolate, nWeaponIndex, kRemoveWeaponOperationName)',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native entity single-lookup/remove binding missing: {strRequiredContract}")

	for strCallbackName, strRequiredGuard in [
		("GetEntityCallback", "RequireEntityGlobals(pIsolate, kOperationName)"),
		("GetEntityClassNameCallback", "RequireEntityGlobals(pIsolate, kOperationName)"),
		("GetEntityFromDictionaryCallback", "RequireEntityGlobals(pIsolate, kOperationName)"),
		("HasEntityInDictionaryCallback", "RequireEntityGlobals(pIsolate, kOperationName)"),
		("RemoveEntityCallback", "RemoveEntityByIndex(pIsolate, nEntityIndex, kOperationName)"),
		("EntityRemoveMethodCallback", "RemoveEntityByIndex(pIsolate, nEntityIndex, kOperationName)"),
	]:
		nCallbackBegin = strModuleBindings.find("void " + strCallbackName + "(")
		nCallbackEnd = strModuleBindings.find("\n\t\t}", nCallbackBegin)
		if (nCallbackBegin < 0) or (nCallbackEnd < 0):
			return Fail(f"native entity lookup/remove callback could not be located: {strCallbackName}")

		if strRequiredGuard not in strModuleBindings[nCallbackBegin:nCallbackEnd]:
			return Fail(f"native {strCallbackName} must validate SDK prerequisites before use")

	for strRequiredContract in [
		"CallbackInformation.Length() < kRequiredArgumentCount",
		"CallbackInformation[kEntityIndexArgumentIndex]->IsInt32()",
		"GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kEntityIndexArgumentIndex], kTypeError, nEntityIndex)",
	]:
		if strRequiredContract not in strEntityFactoryBindings:
			return Fail(f"native Entity lookup must require an explicit integer entity index: {strRequiredContract}")

	if "CallbackInformation.Length() < kRequiredArgumentCount" not in strEntityRemoveBindings:
		return Fail("native entities.RemoveEntity() must require an explicit entity argument")

	for strForbiddenContract in [
		"static bool RemoveEntityIndex(int const nIndex)",
		"g_Application.GetEngineInterfaces().GetEngine()",
	]:
		if strForbiddenContract in strRemoveEntityBindings:
			return Fail(f"native entity remove helper must throw for missing SDK prerequisites: {strForbiddenContract.splitlines()[0]}")

	for strForbiddenContract in [
		"Args.GetReturnValue().Set(RemoveEntityIndex(ThisObjectIndex(Args)))",
		"Args.GetReturnValue().Set(RemoveEntityIndex(nIndex))",
	]:
		if strForbiddenContract in strModuleBindings:
			return Fail(f"native entity single-lookup/remove binding must not silently fallback: {strForbiddenContract.splitlines()[0]}")

	if "int const nIndex = Args.Length() > 0 ? Args[0]->Int32Value(LocalContext).FromMaybe(0) : 0;" in strEntityFactoryBindings:
		return Fail("native Entity lookup must require an explicit entity index")

	if "Args.GetReturnValue().Set(false);\n\t\t\treturn;\n\t\t}\n\n\t\tint const nIndex = Args[0]->Int32Value" in strEntityRemoveBindings:
		return Fail("native entities.RemoveEntity() must throw when the entity index argument is missing")

	for strRequiredContract in [
		'entities/transmit.GetTransmitStateFlags(Entity) requires a valid entity or index.',
		'entities/transmit.SetTransmitStateFlags(Entity, nStateFlags) requires a valid entity or index and state flags.',
		'entities/transmit.SetTransmitState(Entity, nTransmitState) requires a valid entity or index and transmit state.',
		'"entities/transmit.SetTransmitState(Entity, nTransmitState) expects an integer transmit state."',
		'entities/transmit.SetTransmitState(Entity, nTransmitState) received an invalid transmit state.',
		'entities/transmit.ClearTransmitState(Entity) requires a valid entity or index.',
	]:
		if strRequiredContract not in strEntityTransmitBindings:
			return Fail(f"strict native entity transmit binding missing: {strRequiredContract}")

	for strForbiddenContract in [
		"Args.GetReturnValue().Set(pEdict ? static_cast<int>(pEdict->m_fStateFlags) : 0)",
		"Args.GetReturnValue().Set(false);\n\t\t\treturn;\n\t\t}\n\n\t\tpEdict->m_fStateFlags",
		"Args.GetReturnValue().Set(false);\n\t\t\treturn;\n\t\t}\n\n\t\tint const nState",
		"Args.GetReturnValue().Set(false);\n\t\t\treturn;\n\t\t}\n\n\t\tpEdict->ClearTransmitState()",
		"return FL_EDICT_FULLCHECK;",
		"FromMaybe(FL_EDICT_FULLCHECK)",
		"EntityTransmitStateFromString",
		"numeric or named transmit state",
	]:
		if strForbiddenContract in strEntityTransmitBindings:
			return Fail(f"native entity transmit must throw instead of silently falling back: {strForbiddenContract.splitlines()[0]}")

	return 0

def CheckCapabilityProbes():
	PathPackage = ROOT / "packages" / "sourcejs"
	vecModulePaths = [
		"effects",
		"engines/gamerules",
		"entities/datamaps",
		"entities/props",
	]
	for strModulePath in vecModulePaths:
		PathModule = PathPackage / f"{strModulePath}.js"
		strModuleContent = ReadText(PathModule)

		for strForbiddenProbe in ['"available"', '"isAvailable"', ".available", ".isAvailable", '"Available"', '"IsAvailable"', ".Available", ".IsAvailable"]:
			if strForbiddenProbe in strModuleContent:
				return Fail(f"{PathModule.relative_to(ROOT)} must omit capability probes and expose only selected-SDK APIs: {strForbiddenProbe}")

		for strDuplicateExtension in [".cjs", ".d.ts"]:
			PathDuplicate = PathPackage / f"{strModulePath}{strDuplicateExtension}"
			if PathDuplicate.exists():
				return Fail(f"obsolete package duplicate must not exist: {PathDuplicate.relative_to(ROOT)}")

	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strForbiddenContract in [
		"PhysicsUnavailableBooleanCallback",
		'pConVar ? pConVar->GetFloat() : 0',
		'SetBoolean(pIsolate, LocalContext, LocalPhysics, "available"',
	]:
		if strForbiddenContract in strModuleBindings:
			return Fail(f"physics native binding must not expose fallback availability/gravity: {strForbiddenContract}")

	for strRequiredContract in [
		'RequireCVarInterface(pIsolate)',
		'constexpr char const* const kMissingGravityConVarErrorMessage = "sv_gravity is not available.";',
		'RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kMissingGravityConVarErrorMessage);',
		"IPhysicsObject* RequirePhysicsObjectFromThis",
		"IPhysicsEnvironment* RequirePhysicsEnvironmentFromThis",
		'constexpr char const* const kInvalidPhysicsObjectErrorMessage = "PhysicsObject handle is invalid.";',
		'RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kInvalidPhysicsObjectErrorMessage);',
		'constexpr char const* const kInvalidPhysicsEnvironmentErrorMessage = "PhysicsEnvironment handle is invalid.";',
		'RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kInvalidPhysicsEnvironmentErrorMessage);',
		'constexpr char const* const kPhysicsObjectApplyForceCenterArgumentErrorMessage = "PhysicsObject.ApplyForceCenter(PhysicsForceVector) expects a vector.";',
		'RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsObjectApplyForceCenterArgumentErrorMessage);',
		'constexpr char const* const kPhysicsEnvironmentGravityArgumentErrorMessage = "PhysicsEnvironment.SetGravity(PhysicsEnvironmentGravityVector) expects an object with finite X, Y, and Z values in the native float range.";',
		'RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsEnvironmentGravityArgumentErrorMessage);',
		"bool GetPhysicsOperationFromCallback",
		"bool GetPhysicsBooleanFromValue",
		"bool GetPhysicsInt32FromValue",
		"bool GetPhysicsUInt32FromValue",
		"bool GetPhysicsUInt16FromValue",
		"bool GetPhysicsFloatFromValue",
		'PhysicsObject.IsAttachedToConstraint(bPhysicsConstraintExternalOnly?) expects a boolean value.',
		'PhysicsObject.EnableCollisions(bPhysicsObjectBooleanSetterEnabled?) expects a boolean value.',
		'PhysicsObject.SetAsleep(bPhysicsObjectBooleanSetterEnabled?) expects a boolean value.',
		'PhysicsObject.SetGameFlags(unPhysicsObjectGameFlags) expects an unsigned 16-bit integer.',
		'PhysicsObject.SetGameIndex(unPhysicsObjectGameIndex) expects an unsigned 16-bit integer.',
		'PhysicsObject.SetCallbackFlags(unPhysicsObjectCallbackFlags) expects an unsigned 16-bit integer.',
		'PhysicsObject.SetMass(flPhysicsObjectMass) expects a finite numeric value.',
		'PhysicsObject.SetMaterialIndex(nPhysicsObjectMaterialIndex) expects an integer value.',
		'PhysicsObject.SetContents(unPhysicsObjectContents) expects an unsigned 32-bit integer.',
		'PhysicsObject.SetSphereRadius(flPhysicsObjectSphereRadius) expects a finite numeric value.',
		'PhysicsEnvironment.SetAirDensity(flPhysicsEnvironmentAirDensity) expects a finite numeric value in the native float range.',
		'PhysicsObject.SetPosition(PhysicsObjectPositionVector, PhysicsObjectAngleValue?, bPhysicsObjectTeleport?) expects a position vector.',
		'PhysicsObject.SetPosition(PhysicsObjectPositionVector, PhysicsObjectAngleValue?, bPhysicsObjectTeleport?) expects an angle vector.',
		'PhysicsObject.SetPosition(PhysicsObjectPositionVector, PhysicsObjectAngleValue?, bPhysicsObjectTeleport?) expects a boolean teleport value.',
		'PhysicsObject.SetTrigger(bPhysicsObjectTriggerEnabled?) expects a boolean value.',
		'PhysicsObject.SetHinged(PhysicsObjectHingedAxisOrEnabledArgument?) expects an integer axis or boolean value.',
		'Cannot create a PhysicsObject from a null SDK address.',
		'Cannot create a PhysicsEnvironment from a null SDK address.',
		'PhysicsEnvironment.ActiveObjects() received a null physics object from the SDK.',
		'PhysicsEnvironment.GetActiveObjectByEntity(PhysicsEntityOrIndex) expects a non-negative entity index or entity object.',
		'physics.GetActiveEnvironmentByIndex(nActivePhysicsEnvironmentIndex?) expects a non-negative integer index.',
		'physics.GetActiveEnvironmentByIndex(nActivePhysicsEnvironmentIndex?, bActivePhysicsEnvironmentRequired?) expects a boolean required value.',
		'physics.GetActiveEnvironmentByIndex(nActivePhysicsEnvironmentIndex?, bActivePhysicsEnvironmentRequired?) could not resolve an active environment.',
		'physics.EnvironmentFromAddress(unPhysicsEnvironmentAddress, nPhysicsEnvironmentIndex?) expects a non-zero, aligned BigInt address.',
		'physics.EnvironmentFromAddress(unPhysicsEnvironmentAddress, nPhysicsEnvironmentIndex?) expects an integer index.',
		'physics.EnvironmentFromAddress(unPhysicsEnvironmentAddress, nPhysicsEnvironmentIndex?) requires the physics interface.',
		'physics.InterfaceFromAddress(unPhysicsInterfaceAddress) expects a non-zero, aligned BigInt address.',
		'physics.ObjectByEntity(Entity, nPhysicsObjectListIndex?) requires the physics interface.',
		'physics.ObjectByEntity(Entity, nPhysicsObjectListIndex?) expects a valid entity.',
		'physics.ObjectByEntity(Entity, nPhysicsObjectListIndex?) expects a non-negative integer list index.',
		'physics.ObjectFromAddress(unPhysicsObjectAddress) expects a non-zero, aligned BigInt address.',
		'physics.ObjectFromAddress(unPhysicsObjectAddress) requires the physics interface.',
		'physics.Object(PhysicsObjectValue) requires the physics interface.',
		'physics.Object(PhysicsObjectValue, bResolvedPhysicsObjectRequired?) expects a boolean required value.',
		'physics.Object(PhysicsObjectValue, bResolvedPhysicsObjectRequired?) could not resolve a physics object.',
		'physics.ObjectsByEntity(Entity) requires the physics interface.',
		'physics.ObjectsByEntity(Entity) expects a valid entity.',
		'{ "Object", ResolvePhysicsObjectCallback }',
		'{ "InterfaceFromAddress", CreatePhysicsInterfaceFromAddressCallback }',
		'{ "EnvironmentFromAddress", CreatePhysicsEnvironmentFromAddressCallback }',
		'{ "ObjectFromAddress", CreatePhysicsObjectFromAddressCallback }',
		'Unknown PhysicsObject vector transform operation.',
		'Cannot create a Physics interface wrapper from a null SDK address.',
		'constexpr char const* const kPhysicsInterfaceAddressPropertyName = "Address";',
		'InstallPhysicsValue(pIsolate, LocalContext, LocalPhysicsInterfaceObject, kPhysicsInterfaceAddressPropertyName, LocalPhysicsInterfaceAddressValue)',
		'constexpr char const* const kPhysicsInterfaceUnavailableErrorMessage = "physics.Interface requires the live VPhysics interface.";',
		'RethrowV8InstallationFailure(pIsolate, PhysicsFailure, kPhysicsInterfaceUnavailableErrorMessage);',
		'CallbackInformation.GetReturnValue().Set(LocalPhysicsInterfaceObject);',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict physics native binding missing: {strRequiredContract}")

	if strModuleBindings.count("auto* const pPhysicsObject = GetPhysicsObjectFromThis(CallbackInformation);") != 1:
		return Fail("physics object methods must use RequirePhysicsObjectFromThis(), not direct silent handle lookup")

	if strModuleBindings.count("auto* const pPhysicsEnvironment = GetPhysicsEnvironmentFromThis(CallbackInformation);") != 1:
		return Fail("physics environment methods must use RequirePhysicsEnvironmentFromThis(), not direct silent handle lookup")

	nNumberSetterBegin = strModuleBindings.find("void SetPhysicsObjectNumberCallback")
	nNumberSetterEnd = strModuleBindings.find("void GetPhysicsObjectGameDataCallback", nNumberSetterBegin)
	nAirDensityBegin = strModuleBindings.find("void SetPhysicsEnvironmentAirDensityCallback")
	nAirDensityEnd = strModuleBindings.find("void GetPhysicsEnvironmentActiveObjectCountCallback", nAirDensityBegin)
	nPositionBegin = strModuleBindings.find("void SetPhysicsObjectPositionCallback")
	nPositionEnd = strModuleBindings.find("void GetPhysicsObjectVelocityCallback", nPositionBegin)
	if (nNumberSetterBegin < 0) or (nNumberSetterEnd < 0) or (nAirDensityBegin < 0) or (nAirDensityEnd < 0) or (nPositionBegin < 0) or (nPositionEnd < 0):
		return Fail("native physics number, air-density, or position setter blocks could not be located")

	strPhysicsNumberSetterBindings = strModuleBindings[nNumberSetterBegin:nNumberSetterEnd]
	for strForbiddenContract in [
		"FromMaybe(0)",
		"NumberValue(LocalContext)",
		"Int32Value(LocalContext)",
		"Uint32Value(LocalContext)",
	]:
		if strForbiddenContract in strPhysicsNumberSetterBindings:
			return Fail(f"physics numeric setters must use strict native argument helpers: {strForbiddenContract}")

	strPhysicsAirDensityBindings = strModuleBindings[nAirDensityBegin:nAirDensityEnd]
	if ("FromMaybe(0)" in strPhysicsAirDensityBindings) or ("NumberValue(" in strPhysicsAirDensityBindings):
		return Fail("physics air density setter must use strict native finite-number validation")

	strPhysicsPositionSetterBindings = strModuleBindings[nPositionBegin:nPositionEnd]
	for strForbiddenContract in [
		"BooleanValue(pIsolate)",
		"\n\t\t\tPhysicsVectorArgument(",
		"\n\t\t\tPhysicsAngleArgument(",
	]:
		if strForbiddenContract in strPhysicsPositionSetterBindings:
			return Fail(f"physics position setter must validate native arguments before calling the SDK: {strForbiddenContract.strip()}")

	nVelocityBegin = strModuleBindings.find("bool ParsePhysicsVelocityArguments")
	nVelocityEnd = strModuleBindings.find("void SetPhysicsObjectVelocityCallback", nVelocityBegin)
	nObjectMethodsBegin = strModuleBindings.find("void GetPhysicsObjectBooleanStateCallback")
	nObjectMethodsEnd = strModuleBindings.find("bool InstallPhysicsObjectMethods", nObjectMethodsBegin)
	nObjectMakerBegin = strModuleBindings.find("v8::Local<v8::Object> MakePhysicsObject(", nObjectMethodsEnd)
	nObjectMakerEnd = strModuleBindings.find("IPhysicsObject* FindActivePhysicsObjectByEntityIndex", nObjectMakerBegin)
	nEnvironmentMakerBegin = strModuleBindings.find("v8::Local<v8::Object> MakePhysicsEnvironmentObject")
	nEnvironmentMakerEnd = strModuleBindings.find("void GetActivePhysicsEnvironmentByIndexCallback", nEnvironmentMakerBegin)
	nLookupBegin = nEnvironmentMakerEnd
	nLookupEnd = strModuleBindings.find("v8::Local<v8::Object> MakePhysicsInterfaceObject", nLookupBegin)
	nEnvironmentMethodsBegin = strModuleBindings.find("void GetPhysicsEnvironmentGravityCallback")
	nEnvironmentMethodsEnd = strModuleBindings.find("bool InstallPhysicsEnvironmentMethods", nEnvironmentMethodsBegin)
	if (nVelocityBegin < 0) or (nVelocityEnd < 0) or (nObjectMethodsBegin < 0) or (nObjectMethodsEnd < 0) or (nObjectMakerBegin < 0) or (nObjectMakerEnd < 0) or (nEnvironmentMakerBegin < 0) or (nEnvironmentMakerEnd < 0) or (nLookupEnd < 0) or (nEnvironmentMethodsBegin < 0) or (nEnvironmentMethodsEnd < 0):
		return Fail("native physics velocity, wrapper, lookup, or method blocks could not be located")

	strPhysicsVelocityParserBindings = strModuleBindings[nVelocityBegin:nVelocityEnd]
	for strRequiredContract in [
		"const bool bHasNamedPhysicsLinearVelocity",
		"const bool bHasNamedPhysicsAngularVelocity",
		"if (!GetPhysicsVectorFromValue",
		"if (!bHasLinearVelocity && !bHasAngularVelocity)",
		"return true;",
	]:
		if strRequiredContract not in strPhysicsVelocityParserBindings:
			return Fail(f"strict physics velocity parser missing: {strRequiredContract}")

	for strForbiddenContract in [
		"&& GetPhysicsVectorFromValue",
		"else if (GetPhysicsVectorFromValue",
		"if (CallbackInfo.Length() < 1) {\n\t\t\treturn true;",
	]:
		if strForbiddenContract in strPhysicsVelocityParserBindings:
			return Fail(f"physics velocity parser must not ignore invalid vectors: {strForbiddenContract}")

	strPhysicsObjectMakerBindings = strModuleBindings[nObjectMakerBegin:nObjectMakerEnd]
	for strForbiddenContract in [
		"pPhysicsObject ?",
		"if (pPhysicsObject)",
	]:
		if strForbiddenContract in strPhysicsObjectMakerBindings:
			return Fail(f"PhysicsObject wrappers must not fabricate fields for null SDK objects: {strForbiddenContract}")

	strPhysicsEnvironmentMakerBindings = strModuleBindings[nEnvironmentMakerBegin:nEnvironmentMakerEnd]
	for strForbiddenContract in [
		"pPhysicsEnvironment ?",
		"if (pPhysicsEnvironment)",
	]:
		if strForbiddenContract in strPhysicsEnvironmentMakerBindings:
			return Fail(f"PhysicsEnvironment wrappers must not fabricate fields for null SDK objects: {strForbiddenContract}")

	strPhysicsLookupBindings = strModuleBindings[nLookupBegin:nLookupEnd]
	for strForbiddenContract in [
		"FromMaybe(0)",
		"FromMaybe(-1)",
		"ToLocalChecked()",
		'{ "object",',
		"CallbackInfo.GetReturnValue().Set(v8::Array::New(pIsolate))",
		"CallbackInformation.GetReturnValue().Set(v8::Array::New(pIsolate))",
	]:
		if strForbiddenContract in strPhysicsLookupBindings:
			return Fail(f"physics lookup callbacks must use strict native arguments and errors: {strForbiddenContract}")

	strPhysicsObjectMethodBindings = strModuleBindings[nObjectMethodsBegin:nObjectMethodsEnd]
	for strForbiddenContract in [
		"GetPhysicsObjectFromThis(CallbackInfo)",
		"GetPhysicsObjectFromThis(CallbackInformation)",
		"CallbackInfo.GetReturnValue().Set(false)",
		"CallbackInfo.GetReturnValue().Set(0)",
		"CallbackInfo.GetReturnValue().Set(v8::Null",
		"CallbackInformation.GetReturnValue().Set(false)",
		"CallbackInformation.GetReturnValue().Set(0)",
		"CallbackInformation.GetReturnValue().Set(v8::Null",
		"? pPhysicsObject",
		"pPhysicsObject ?",
	]:
		if strForbiddenContract in strPhysicsObjectMethodBindings:
			return Fail(f"physics object methods must not use invalid-handle fallback: {strForbiddenContract}")

	strPhysicsEnvironmentMethodBindings = strModuleBindings[nEnvironmentMethodsBegin:nEnvironmentMethodsEnd]
	for strForbiddenContract in [
		"GetPhysicsEnvironmentFromThis(CallbackInfo)",
		"GetPhysicsEnvironmentFromThis(CallbackInformation)",
		"CallbackInfo.GetReturnValue().Set(false)",
		"CallbackInfo.GetReturnValue().Set(0)",
		"CallbackInfo.GetReturnValue().Set(v8::Array::New",
		"CallbackInformation.GetReturnValue().Set(false)",
		"CallbackInformation.GetReturnValue().Set(0)",
		"CallbackInformation.GetReturnValue().Set(v8::Array::New",
		"? pPhysicsEnvironment",
		"pPhysicsEnvironment ?",
	]:
		if strForbiddenContract in strPhysicsEnvironmentMethodBindings:
			return Fail(f"physics environment methods must not use invalid-handle fallback: {strForbiddenContract}")

	if "void EffectsUnsupportedCallback" in strModuleBindings:
		nUnsupportedBegin = strModuleBindings.find("void EffectsUnsupportedCallback")
		nUnsupportedEnd = strModuleBindings.find("#endif", nUnsupportedBegin)
		if nUnsupportedEnd < 0:
			return Fail("unsupported effects callback block could not be located")

		strUnsupportedEffectBindings = strModuleBindings[nUnsupportedBegin:nUnsupportedEnd]
		for strProbeName in ["available", "isAvailable", "Available", "IsAvailable"]:
			if f'"{strProbeName}", EffectsUnsupportedCallback' in strUnsupportedEffectBindings:
				return Fail(f"unsupported effects branch must not bind {strProbeName}() to a throwing callback")

		for MatchUnsupportedNames in re.finditer(r"(?:constexpr\s+)?char\s+const\*\s+const\s+[A-Za-z]\w*\[\]\s*=\s*\{([\s\S]*?)\};", strUnsupportedEffectBindings):
			for strProbeName in ["available", "isAvailable", "Available", "IsAvailable"]:
				if f'"{strProbeName}"' in MatchUnsupportedNames.group(1):
					return Fail(f"unsupported effects callback list must not include {strProbeName}()")

	return 0

def CheckPhysicsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_physics.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"physics smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"physics smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckMemoryMathLibrarySmoke():
	# The exhaustive documentation/failure matrices exceed 30 seconds on supported hosts.
	unTimeoutSeconds = 90

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_memory_mathlib.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"memory/mathlib smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"memory/mathlib smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckHooksSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_hooks.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"hooks smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"hooks smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckColorsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_colors.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"colors smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"colors smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckAutomaticDocumentationSmoke():
	unTimeoutSeconds = 30

	strPackagePath = "autodoc.js"
	strAutomaticDocumentationPackage = ReadText(ROOT / "packages" / "sourcejs" / strPackagePath)

	if ('const g_strModuleName = "autodoc";' not in strAutomaticDocumentationPackage) or ("GetModule(g_strModuleName)" not in strAutomaticDocumentationPackage):
		return Fail(f"{strPackagePath} must call the native autodoc module through an explicit module name")

	for strForbiddenContract in [
		"globalThis.sourcejs",
		"sourcejsRuntime",
		"Object.keys(",
		"?? {}",
	]:
		if strForbiddenContract in strAutomaticDocumentationPackage:
			return Fail(f"{strPackagePath} must not use autodoc runtime fallback: {strForbiddenContract}")

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_autodoc.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"autodoc smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"autodoc smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckAPIDocumentationAudit():
	unTimeoutSeconds = 30
	vecCommands = [
		[sys.executable, "-B", str(ROOT / "tools" / "test_audit_api_docs.py")],
		[sys.executable, str(ROOT / "tools" / "audit_api_docs.py"), "--links-only"],
		[sys.executable, str(ROOT / "tools" / "audit_api_docs.py"), "--strict"],
	]
	for vecCommand in vecCommands:
		try:
			ProcessResult = subprocess.run(vecCommand, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"API documentation audit failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"API documentation audit failed:\n{ProcessResult.stdout}")

	return 0

def CheckRuntimeFacadesSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_runtime_facades.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"runtime facades smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"runtime facades smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPluginCommandSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_plugins_command.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"plugins/command smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"plugins/command smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPluginInformationSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_plugins_info.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"plugins/info smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"plugins/info smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPluginInstanceSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_plugins_instance.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"plugins/instance smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"plugins/instance smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPluginManagerSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_plugins_manager.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"plugins/manager smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"plugins/manager smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPluginsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_plugins.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"plugins smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"plugins smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckCorePackageSmokeTests():
	unTimeoutSeconds = 30

	for strSmokeScript in (
		"smoke_core_dumps.js",
		"smoke_core_automatic_unload.js",
		"smoke_core_public_ip.js",
		"smoke_core_cache.js",
		"smoke_core_command.js",
		"smoke_core_command_auth.js",
		"smoke_core_command_plugin.js",
		"smoke_core_table.js",
		"smoke_core_update.js",
	):
		try:
			ProcessResult = subprocess.run(["node", str(ROOT / "tools" / strSmokeScript)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"{strSmokeScript} failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"{strSmokeScript} failed:\n{ProcessResult.stdout}")

	return 0

def CheckEffectsFieldsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_effects_fields.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"effects/fields smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"effects/fields smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEffectsBaseSmoke():
	unTimeoutSeconds = 30

	for strSmokeName in ("smoke_effects_base.js", "smoke_effects_geometry.js"):
		try:
			ProcessResult = subprocess.run(["node", str(ROOT / "tools" / strSmokeName)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"{strSmokeName} failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"{strSmokeName} failed:\n{ProcessResult.stdout}")

	return 0

def CheckEffectsConstantsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_effects_constants.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"effects constants smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"effects constants smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEngineGameRulesSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_engines_gamerules.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"engines/gamerules smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"engines/gamerules smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEnginePrecacheSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_engines_precache.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"engines/precache smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"engines/precache smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEngineServerSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_engines_server.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"engines/server smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"engines/server smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEngineRootSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_engines_root.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"engines root smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"engines root smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEngineSoundSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_engines_sound.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"engines/sound smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"engines/sound smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEngineTraceSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_engines_trace.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"engines/trace smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"engines/trace smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerTeamsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_players_teams.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"players/teams smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"players/teams smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEntityConstantsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_entities_constants.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"entities/constants smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"entities/constants smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEntityDataSmoke():
	unTimeoutSeconds = 30

	for strScript in ("smoke_entities_data.js", "smoke_send_property_hooks.js"):
		try:
			ProcessResult = subprocess.run(["node", str(ROOT / "tools" / strScript)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"{strScript} failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"{strScript} failed:\n{ProcessResult.stdout}")

	return 0

def CheckEntityCollisionsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_entities_collisions.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"entities/collisions smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"entities/collisions smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEntityCSGOEngineSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_entities_csgo_engine.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"entities/engines/csgo smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"entities/engines/csgo smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerCoreSmokeTests():
	unTimeoutSeconds = 30

	vecSmokeChecks = [
		("players", "smoke_players.js"),
		("players", "smoke_players_base.js"),
		("players/baseclient", "smoke_players_base_client.js"),
		("players/bots", "smoke_players_bots.js"),
		("players/dictionary", "smoke_players_dictionary.js"),
		("players/dropweapon", "smoke_players_drop_weapon.js"),
		("players/entity", "smoke_players_entity.js"),
		("players/language", "smoke_players_language.js"),
	]
	for strModulePath, strSmokeScript in vecSmokeChecks:
		try:
			ProcessResult = subprocess.run(["node", str(ROOT / "tools" / strSmokeScript)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"{strModulePath} smoke failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"{strModulePath} smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerHelpersSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_players_helpers.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"players/helpers smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"players/helpers smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerCounterStrikeEngineSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_players_engines_cstrike.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"players/engines/orangebox/cstrike smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"players/engines/orangebox/cstrike smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerEnginesSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_players_engines.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"players/engines smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"players/engines smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerVoiceSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_players_voice.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"players/voice smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"players/voice smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerConstantsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_players_constants.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"players/constants smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"players/constants smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckStudioSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_studio.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"studio smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"studio smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckAnimationSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_animation_contracts.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"animation smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"animation smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckStudioCacheSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_studio_cache.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"studio/cache smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"studio/cache smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckStudioConstantsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_studio_constants.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"studio/constants smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"studio/constants smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckConsoleVariableSmoke():
	unTimeoutSeconds = 30

	for strSmokeName in ("smoke_cvars_convar.js", "smoke_cvars_public.js"):
		try:
			ProcessResult = subprocess.run(["node", str(ROOT / "tools" / strSmokeName)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"{strSmokeName} failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"{strSmokeName} failed:\n{ProcessResult.stdout}")

	return 0

def CheckConsoleVariablesStrictSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_cvars_strict.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"cvars strict smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"cvars strict smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckKeyValuesSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_keyvalues.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"keyvalues smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"keyvalues smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckSteamSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_steam.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"steam smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"steam smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPathsSmoke():
	unTimeoutSeconds = 30

	PathPackage = ROOT / "packages" / "sourcejs"
	PathPathsPackage = PathPackage / "paths.js"
	strPathsPackage = ReadText(PathPathsPackage)
	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")

	if 'module.exports = GetModule("paths");' not in strPathsPackage:
		return Fail(f"{PathPathsPackage.relative_to(ROOT)} must export the exact editable native paths module")

	strContractBindings = re.sub(r"^\t+", "", strModuleBindings, flags=re.MULTILINE)
	for strRequiredContract in [
		'if (!InstallPathConstant("ADDON_ROOT", PathGameRoot / "addons")) {\n\t\t\t\treturn false;\n\t\t\t}',
		'if (!InstallPathConstant("BASE_ROOT", PathAddonRoot)) {\n\t\t\t\treturn false;\n\t\t\t}',
	]:
		if re.sub(r"^\t+", "", strRequiredContract, flags=re.MULTILINE) not in strContractBindings:
			return Fail(f"native paths topology missing: {strRequiredContract}")

	for PathObsolete in [PathPackage / "paths.cjs", PathPackage / "internal" / "paths.js", PathPackage / "internal" / "paths.cjs"]:
		if PathObsolete.exists():
			return Fail(f"obsolete paths duplicate remains: {PathObsolete.relative_to(ROOT)}")

	for strForbiddenContract in ["DEFAULT_GAME_ROOT", "Object.freeze", "buildPaths", "sourcejsRuntime", "joinPath(", "normalizeSlashes", "globalThis.sourcejs", "??"]:
		if strForbiddenContract in strPathsPackage:
			return Fail(f"{PathPathsPackage.relative_to(ROOT)} must not fabricate runtime paths in JS: {strForbiddenContract}")

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_paths.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"paths smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"paths smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckFilesystemSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_filesystem.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"filesystem smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"filesystem smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckFilesystemStrictSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_filesystem_strict.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"filesystem strict smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"filesystem strict smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPublicSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_public.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"public smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"public smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckInterfacesSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_interfaces.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"interfaces smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"interfaces smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckLoggersSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_loggers.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"loggers smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"loggers smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckStringTablesSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_stringtables.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"stringtables smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"stringtables smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckStringTableDownloadsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_stringtables_downloads.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"stringtables/downloads smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"stringtables/downloads smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckRecipientFiltersSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_filters_recipients.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"filters/recipients smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"filters/recipients smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckFilterRootSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_filters_root.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"filters root smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"filters root smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckGlobalsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_globals.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"globals smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"globals smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckFilterIteratorSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_filters_iterator.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"filters/iterator smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"filters/iterator smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEntityFiltersSmoke():
	unTimeoutSeconds = 30

	PathEntityFilters = ROOT / "packages" / "sourcejs" / "filters" / "entities.js"
	strEntityFilterPackage = ReadText(PathEntityFilters)

	for strRequiredContract in [
		"class BaseEntityIterator extends IteratorObject",
		"class EntityIterator extends BaseEntityIterator",
		"class EntityTraceFilter",
	]:
		if strRequiredContract not in strEntityFilterPackage:
			return Fail(f"{PathEntityFilters.relative_to(ROOT)} is missing canonical entity filter behavior: {strRequiredContract}")

	for strForbiddenContract in [
		"Entity: entities.Entity",
		"byIndex: entities.byIndex",
		"count: entities.count",
		"moduleName:",
		"remove: entities.remove",
		"return entities.byClassName(",
	]:
		if strForbiddenContract in strEntityFilterPackage:
			return Fail(f"{PathEntityFilters.relative_to(ROOT)} must not duplicate the entities module API: {strForbiddenContract}")

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_filters_entities.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"filters/entities smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"filters/entities smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerFiltersSmoke():
	unTimeoutSeconds = 30

	PathPlayerFilters = ROOT / "packages" / "sourcejs" / "filters" / "players.js"
	strPlayerFilterPackage = ReadText(PathPlayerFilters)

	for strRequiredContract in [
		'const g_NativePlayerFilters = GetModule("filters/players");',
		'const g_NativePlayers = GetModule("players");',
		"class PlayerIterator extends IteratorObject",
		"Object.assign(g_NativePlayerFilters, {",
		"module.exports = g_NativePlayerFilters;",
	]:
		if strRequiredContract not in strPlayerFilterPackage:
			return Fail(f"{PathPlayerFilters.relative_to(ROOT)} is missing direct native player-filter behavior: {strRequiredContract}")

	for strForbiddenContract in [
		"Player: players.Player",
		"class PlayerIter ",
		"function connected(",
		"function getDefaultFilters(",
		"function all(",
		"function humans(",
		"function bots(",
		"function byTeam(",
		"moduleName",
		'PlayerIterator.registerFilter("un"',
		'PlayerIterator.registerFilter("spec"',
		'PlayerIterator.registerFilter("t"',
		'PlayerIterator.registerFilter("ct"',
	]:
		if strForbiddenContract in strPlayerFilterPackage:
			return Fail(f"{PathPlayerFilters.relative_to(ROOT)} must not duplicate native operations or hardcode SDK-specific team filters: {strForbiddenContract}")

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_filters_players.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"filters/players smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"filters/players smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckWeaponFiltersSmoke():
	unTimeoutSeconds = 30

	PathWeaponFilters = ROOT / "packages" / "sourcejs" / "filters" / "weapons.js"
	strWeaponFilterPackage = ReadText(PathWeaponFilters)

	for strRequiredContract in [
		'const g_NativeWeaponFilters = GetModule("filters/weapons");',
		'const g_NativeWeapons = GetModule("weapons");',
		"const vecNativeWeaponClassNames = g_NativeWeapons.Classes();",
		"class WeaponIterator extends IteratorObject",
		"class WeaponClassIterator extends IteratorObject",
		"Object.assign(g_NativeWeaponFilters, {",
		"module.exports = g_NativeWeaponFilters;",
	]:
		if strRequiredContract not in strWeaponFilterPackage:
			return Fail(f"{PathWeaponFilters.relative_to(ROOT)} is missing direct native weapon-filter behavior: {strRequiredContract}")

	for strForbiddenContract in [
		"typeof nativeWeapons.classes",
		"nativeWeapons.classes === \"function\"",
		"nativeWeapons.classes() : []",
		"try {\n\trefreshTagFilters();",
		"} catch {\n}",
		"} catch (error) {\n}",
		"function Weapon(",
		"function byIndex(",
		"function classes(",
		"function valid(",
		"class WeaponIter ",
		"class WeaponClassIter ",
		"moduleName",
	]:
		if strForbiddenContract in strWeaponFilterPackage:
			return Fail(f"{PathWeaponFilters.relative_to(ROOT)} must not hide native failures or duplicate the weapons API: {strForbiddenContract}")

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_filters_weapons.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"filters/weapons smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"filters/weapons smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckWeaponSmokeTests():
	unTimeoutSeconds = 30

	vecSmokeChecks = [
		("weapons", "smoke_weapons.js"),
		("weapons", "smoke_weapons_base.js"),
		("weapons/constants", "smoke_weapons_constants.js"),
		("weapons/data", "smoke_weapons_data.js"),
		("weapons/dictionary", "smoke_weapons_dictionary.js"),
		("weapons/engines", "smoke_weapons_engines.js"),
		("weapons/engines/csgo", "smoke_weapons_engines_csgo.js"),
		("weapons/entity", "smoke_weapons_entity.js"),
		("weapons/instance", "smoke_weapons_instance.js"),
		("weapons/manager", "smoke_weapons_manager.js"),
		("weapons/restrictions", "smoke_weapons_restrictions.js"),
		("weapons/scripts", "smoke_weapons_scripts.js"),
	]
	for strModulePath, strSmokeScript in vecSmokeChecks:
		try:
			ProcessResult = subprocess.run(["node", str(ROOT / "tools" / strSmokeScript)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"{strModulePath} smoke failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"{strModulePath} smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEventsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_events.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"events smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"events smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEventListenerSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_events_listener.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"events/listener smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"events/listener smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEventResourceSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_events_resource.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"events/resource smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"events/resource smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEventVariableSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_events_variable.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"events/variable smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"events/variable smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckExtensionsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_extensions.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"extensions smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"extensions smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckEventManagerSmoke():
	unTimeoutSeconds = 30

	PathEventManager = ROOT / "packages" / "sourcejs" / "events" / "manager.js"
	strEventManagerPackage = ReadText(PathEventManager)

	if "EXCEPTION_HOOKS.PrintException(EventError, { Source: g_strModuleName })" not in strEventManagerPackage:
		return Fail(f"{PathEventManager.relative_to(ROOT)} must route callback exceptions through memory/hooks/exceptions")

	for strForbiddenContract in [
		"exceptHooks",
		"getSourceJS",
		"sourcejsRuntime",
		"sourcejsRuntime.loggers",
		"loggers || {}",
		"Event callback exception",
	]:
		if strForbiddenContract in strEventManagerPackage:
			return Fail(f"{PathEventManager.relative_to(ROOT)} must not use event callback exception fallback: {strForbiddenContract}")

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_events_manager.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"events/manager smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"events/manager smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckCustomEventsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_events_custom.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"events/custom smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"events/custom smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckCustomEventStrictCreation():
	PathCustomEvents = ROOT / "packages" / "sourcejs" / "events" / "custom.js"
	strCustomEventPackage = ReadText(PathCustomEvents)

	for strRequired in [
		'const g_NativeCustomEvents = GetModule("events/custom");',
		"CreateCustomEvent",
		"CreateEventPayload",
		"CreateEventResourceText",
		"FireEvent",
	]:
		if strRequired not in strCustomEventPackage:
			return Fail(f"{PathCustomEvents.relative_to(ROOT)} is missing canonical custom-event API: {strRequired}")

	return 0

def CheckConsoleVariablesNativeStrictGetters():
	PathModuleBindings = ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp"
	strModuleBindings = ReadText(PathModuleBindings)
	strConsoleVariableBlockStart = "ICvar* RequireCVarInterface"
	strConsoleVariableBlockEnd = "bool ParseSteamUnsigned"
	nConsoleVariableBlockBegin = strModuleBindings.find(strConsoleVariableBlockStart)
	nConsoleVariableBlockEnd = strModuleBindings.find(strConsoleVariableBlockEnd, nConsoleVariableBlockBegin)
	if (nConsoleVariableBlockBegin < 0) or (nConsoleVariableBlockEnd < 0):
		return Fail(f"{PathModuleBindings.relative_to(ROOT)} is missing the native cvars binding boundaries")

	strConsoleVariableBindingBlock = strModuleBindings[nConsoleVariableBlockBegin:nConsoleVariableBlockEnd]
	for strForbiddenContract in [
		"if (!pCvar || Args.Length() < 1)",
		"Args.GetReturnValue().Set(false);\n\t\t\treturn;\n\t\t}\n\n\t\tstd::string const strName = ValueToString(Args.GetIsolate(), Args[0]);",
		"Args.GetReturnValue().Set(v8::Null(Args.GetIsolate()));\n\t\t\treturn;\n\t\t}\n\n\t\tstd::string const strName = ValueToString(Args.GetIsolate(), Args[0]);",
		"Args.GetReturnValue().Set(LocalArray);\n\t\t\treturn;\n\t\t}\n\n\t\tstd::uint32_t unIndex = 0;",
		"return pCvar ? pCvar->FindVar(\"sv_tags\") : nullptr;",
		"pConVar ? pConVar->GetString() : \"\"",
		"Args.GetReturnValue().Set(pConVar ? pConVar->GetInt() : 0)",
		"Args.GetReturnValue().Set(pConVar ? pConVar->GetFloat() : 0)",
		"Args.GetReturnValue().Set(pConVar ? pConVar->GetBool() : false)",
		"FindConCommandBaseByName",
	]:
		if strForbiddenContract in strConsoleVariableBindingBlock:
			return Fail(f"cvars typed getter must not return fallback value: {strForbiddenContract}")

	for strConsoleVariableCallbackName, strRequiredLookup in [
		("SetConVarCallback", "CVarsRequireConVarFromArguments(CallbackInformation, kArgumentError)"),
		("RevertConVarToDefaultCallback", "CVarsRequireConVarFromArguments(CallbackInformation, kArgumentError)"),
		("SetConVarFlagsCallback", "CVarsRequireConCommandBaseFromArguments(CallbackInformation, kArgumentError)"),
		("AddConVarFlagsCallback", "CVarsRequireConCommandBaseFromArguments(CallbackInformation, kArgumentError)"),
		("RemoveConVarFlagsCallback", "CVarsRequireConCommandBaseFromArguments(CallbackInformation, kArgumentError)"),
		("SetConVarPublicCallback", "RequireCVarInterface(pIsolate)"),
		("GetConVarIntegerCallback", "CVarsRequireConVarFromArguments(CallbackInformation, kArgumentError)"),
		("GetConVarFloatCallback", "CVarsRequireConVarFromArguments(CallbackInformation, kArgumentError)"),
		("GetConVarBooleanCallback", "CVarsRequireConVarFromArguments(CallbackInformation, kArgumentError)"),
	]:
		MatchConsoleVariableCallback = re.search(rf"void {strConsoleVariableCallbackName}\([\s\S]*?\n\t\t\}}", strConsoleVariableBindingBlock)
		if not MatchConsoleVariableCallback:
			return Fail(f"strict cvars mutation callback missing: {strConsoleVariableCallbackName}")

		if strRequiredLookup not in MatchConsoleVariableCallback.group(0):
			return Fail(f"{strConsoleVariableCallbackName} must validate its native ConVar or command interface before use")

		if ("Args.GetReturnValue().Set(false)" in MatchConsoleVariableCallback.group(0)) or ("CallbackInformation.GetReturnValue().Set(false)" in MatchConsoleVariableCallback.group(0)):
			return Fail(f"{strConsoleVariableCallbackName} must throw through native required lookup instead of returning false")

	for strTagCallbackName, strTagArgumentIndex in [
		("SetServerTagsStringCallback", "kValueArgumentIndex"),
		("HasServerTagCallback", "kTagArgumentIndex"),
		("AddServerTagCallback", "kTagArgumentIndex"),
		("RemoveServerTagCallback", "kTagArgumentIndex"),
	]:
		MatchTagCallback = re.search(rf"void {strTagCallbackName}\([\s\S]*?\n\t\t\}}", strConsoleVariableBindingBlock)
		if not MatchTagCallback:
			return Fail(f"strict cvars/tags callback missing: {strTagCallbackName}")

		if f"!CallbackInformation[{strTagArgumentIndex}]->IsString()" not in MatchTagCallback.group(0):
			return Fail(f"{strTagCallbackName} must reject non-string tag values")

	for strRequiredContract in [
		"ICvar* RequireCVarInterface",
		"ConVar* CVarsRequireConVarFromArguments",
		"ConCommandBase* CVarsRequireConCommandBaseFromArguments",
		"void RequireConVarCallback",
		'"cvar interface is not available."',
		'ThrowError(pIsolate, kInterfaceError);',
		'"cvars.FindConVar(strConVarName) expects a ConVar name."',
		'"cvars.RequireConVar(strConVarName) expects a ConVar name."',
		'"cvars.DoesConVarExist(strConVarName) expects a ConVar name."',
		'"cvars.GetConVar(strConVarName) expects a ConVar name."',
		'"cvars/tags requires sv_tags."',
		'ThrowError(pIsolate, kMissingConVarError);',
		'"cvars/tags.SetServerTagsString(strValue) expects a tag string."',
		'"cvars/tags.HasServerTag(strTag) expects a tag."',
		'"cvars/tags.AddServerTag(strTag) expects a tag."',
		'"cvars/tags.RemoveServerTag(strTag) expects a tag."',
		"ThrowError(pIsolate, pszUsage)",
		'"cvars.GetConVarInteger(strConVarName) expects a ConVar name."',
		'"cvars.GetConVarFloat(strConVarName) expects a ConVar name."',
		'"cvars.GetConVarBoolean(strConVarName) expects a ConVar name."',
		'std::string const strMessage = "ConVar not found: " + strConVarName',
		'std::string const strMessage = "ConCommandBase not found: " + strCommandBaseName',
		"CallbackInformation.GetReturnValue().Set(pConVar->GetInt())",
		"CallbackInformation.GetReturnValue().Set(pConVar->GetFloat())",
		"CallbackInformation.GetReturnValue().Set(pConVar->GetBool())",
		'CVarsRequireConVarFromArguments(CallbackInformation, kArgumentError)',
		'"cvars.SetConVar(strConVarName, Value) expects a ConVar name and value."',
		'"cvars.RevertConVarToDefault(strConVarName) expects a ConVar name."',
		'CVarsRequireConCommandBaseFromArguments(CallbackInformation, kArgumentError)',
		'"cvars.SetConVarFlags(strCommandBaseName, nFlags) expects a ConVar or command name."',
		'"cvars.AddConVarFlags(strCommandBaseName, nFlags) expects a ConVar or command name."',
		'"cvars.RemoveConVarFlags(strCommandBaseName, nFlags) expects a ConVar or command name."',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], kIntegerValueError, nValue)',
		'GetFloatArgument(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], kNumericValueError, flValue)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kFlagsArgumentIndex], kIntegerFlagsError, nFlags)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kFlagsArgumentIndex], kFlagsArgumentError, nFlags)',
		'GetFloatArgument(pIsolate, LocalContext, CallbackInformation[kMinimumValueArgumentIndex], kMinimumValueArgumentError, flMinimumValue)',
		'GetFloatArgument(pIsolate, LocalContext, CallbackInformation[kMaximumValueArgumentIndex], kMaximumValueArgumentError, flMaximumValue)',
		'SetFunction(pIsolate, LocalContext, LocalCVarsModule, "RequireConVar", RequireConVarCallback, LocalRuntimeData)',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict cvars native getter missing: {strRequiredContract}")

	for strConsoleVariableCallbackStart, strNextConsoleVariableCallback, strConsoleVariableCallbackLabel, vecRequiredConversions in [
		("void SetConVarCallback", "void RevertConVarToDefaultCallback", "cvars.SetConVar", ["GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], kIntegerValueError, nValue)", "GetFloatArgument(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], kNumericValueError, flValue)"]),
		("void SetConVarFlagsCallback", "void AddConVarFlagsCallback", "cvars.SetConVarFlags", ["GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kFlagsArgumentIndex], kIntegerFlagsError, nFlags)"]),
		("void AddConVarFlagsCallback", "void RemoveConVarFlagsCallback", "cvars.AddConVarFlags", ["GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kFlagsArgumentIndex], kIntegerFlagsError, nFlags)"]),
		("void RemoveConVarFlagsCallback", "struct CreatedConVarStorage", "cvars.RemoveConVarFlags", ["GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kFlagsArgumentIndex], kIntegerFlagsError, nFlags)"]),
		("void CreateConVarCallback", "void SetConVarPublicCallback", "cvars.CreateConVar", ["GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kFlagsArgumentIndex], kFlagsArgumentError, nFlags)", "GetFloatArgument(pIsolate, LocalContext, CallbackInformation[kMinimumValueArgumentIndex], kMinimumValueArgumentError, flMinimumValue)", "GetFloatArgument(pIsolate, LocalContext, CallbackInformation[kMaximumValueArgumentIndex], kMaximumValueArgumentError, flMaximumValue)"]),
	]:
		if (strConsoleVariableCallbackStart not in strConsoleVariableBindingBlock) or (strNextConsoleVariableCallback not in strConsoleVariableBindingBlock):
			return Fail(f"native {strConsoleVariableCallbackLabel} callback boundaries are missing")

		strConsoleVariableCallbackBlock = strConsoleVariableBindingBlock.split(strConsoleVariableCallbackStart, 1)[1].split(strNextConsoleVariableCallback, 1)[0]
		if "FromMaybe(0)" in strConsoleVariableCallbackBlock:
			return Fail(f"native {strConsoleVariableCallbackLabel} must reject invalid numeric conversions instead of using 0")

		for strRequiredConversion in vecRequiredConversions:
			if strRequiredConversion not in strConsoleVariableCallbackBlock:
				return Fail(f"native {strConsoleVariableCallbackLabel} must use strict argument conversion: {strRequiredConversion}")

	PathConsoleVariablePackage = ROOT / "packages" / "sourcejs" / "cvars" / "convar.js"
	strConsoleVariablePackage = ReadText(PathConsoleVariablePackage)
	if 'module.exports = GetModule("cvars/convar");' not in strConsoleVariablePackage:
		return Fail(f"{PathConsoleVariablePackage.relative_to(ROOT)} must expose the exact native cvars/convar object")

	PathConsoleVariablesPackage = ROOT / "packages" / "sourcejs" / "cvars.js"
	strConsoleVariablesPackage = ReadText(PathConsoleVariablesPackage)
	if 'module.exports = GetModule("cvars");' not in strConsoleVariablesPackage:
		return Fail(f"{PathConsoleVariablesPackage.relative_to(ROOT)} must expose the exact native cvars object")

	PathPublicConsoleVariablesPackage = ROOT / "packages" / "sourcejs" / "cvars" / "public.js"
	strPublicConsoleVariablesPackage = ReadText(PathPublicConsoleVariablesPackage)
	for strRequiredContract in [
		'const g_CVarsRuntime = GetModule("cvars");',
		'const g_PublicCVarsRuntime = GetModule("cvars/public");',
		"const ExistingConVar = g_PublicCVarsRuntime.FindConVar(strNormalizedName);",
		"const ConVar = g_CVarsRuntime.CreateConVar(strNormalizedName, Value, Description, Options.Flags ?? 0, Options.MinimumValue ?? null, Options.MaximumValue ?? null);",
		"if (!g_CVarsRuntime.SetConVar(strNormalizedName, Value)) {\n\t\tthrow new Error(`Failed to set public ConVar value: ${strNormalizedName}`);\n\t}",
		"if (!g_PublicCVarsRuntime.SetConVarPublic(strNormalizedName, true)) {\n\t\tthrow new Error(`Failed to make ConVar public: ${strNormalizedName}`);\n\t}",
		"g_mapPublicConVarRegistrations.set(strNormalizedName, Registration);",
		"module.exports = g_PublicCVarsRuntime;",
	]:
		if strRequiredContract not in strPublicConsoleVariablesPackage:
			return Fail(f"{PathPublicConsoleVariablesPackage.relative_to(ROOT)} must preserve direct native cvar ownership: {strRequiredContract}")

	for strForbiddenContract in [
		"Boolean(enabled)",
		"Number(conVarOptions.flags ?? 0)",
		"Number(conVarOptions.minValue)",
		"Number(conVarOptions.maxValue)",
		"moduleName",
		"export default",
	]:
		if strForbiddenContract in strPublicConsoleVariablesPackage:
			return Fail(f"{PathPublicConsoleVariablesPackage.relative_to(ROOT)} must not coerce native cvar arguments or expose aliases: {strForbiddenContract}")

	for PathObsoletePackage in [
		ROOT / "packages" / "sourcejs" / "cvars" / "convar.cjs",
		ROOT / "packages" / "sourcejs" / "internal" / "cvars.cjs",
		ROOT / "packages" / "sourcejs" / "cvars" / "public.cjs",
	]:
		if PathObsoletePackage.exists():
			return Fail(f"obsolete duplicate package must be removed: {PathObsoletePackage.relative_to(ROOT)}")

	return 0

def CheckTranslationRootSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_translations_root.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"translations root smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"translations root smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckTranslationManagerSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_translations_manager.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"translations/manager smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"translations/manager smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckTranslationStringsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_translations_strings.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"translations/strings smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"translations/strings smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckTranslationsSmoke():
	unTimeoutSeconds = 30

	PathTranslationsPackage = ROOT / "packages" / "sourcejs" / "translations.js"
	PathTranslationManagerPackage = ROOT / "packages" / "sourcejs" / "translations" / "manager.js"
	PathTranslationStringsPackage = ROOT / "packages" / "sourcejs" / "translations" / "strings.js"
	PathModuleBindings = ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp"
	strTranslationsPackage = ReadText(PathTranslationsPackage)
	strTranslationManagerPackage = ReadText(PathTranslationManagerPackage)
	strTranslationStringsPackage = ReadText(PathTranslationStringsPackage)
	strModuleBindings = ReadText(PathModuleBindings)

	if 'module.exports = GetModule("translations");' not in strTranslationsPackage:
		return Fail(f"{PathTranslationsPackage.relative_to(ROOT)} must expose the exact native CommonJS object")

	for PathObsoletePackage in [
		ROOT / "packages" / "sourcejs" / "translations.cjs",
		ROOT / "packages" / "sourcejs" / "translations.d.ts",
		ROOT / "packages" / "sourcejs" / "translations" / "manager.cjs",
		ROOT / "packages" / "sourcejs" / "translations" / "manager.d.ts",
		ROOT / "packages" / "sourcejs" / "translations" / "strings.cjs",
		ROOT / "packages" / "sourcejs" / "translations" / "strings.d.ts",
	]:
		if PathObsoletePackage.exists():
			return Fail(f"obsolete translations duplicate remains: {PathObsoletePackage.relative_to(ROOT)}")

	for strRequiredContract in [
		"const g_LanguageManager = new LanguageManager();",
		"return GetLanguages().Languages;",
		"SetDefaultLanguage(strLanguage);",
	]:
		if strRequiredContract not in strTranslationManagerPackage:
			return Fail(f"{PathTranslationManagerPackage.relative_to(ROOT)} is missing live direct behavior: {strRequiredContract}")

	for strRequiredContract in [
		"GetPhrase(this.File, this.Key)",
		"GetText(this.File, this.Key, strLanguage",
		"HasPhrase(this.File, this.Key, strLanguage)",
		"LoadFile(this.File)",
		"GetPhraseKeys(this.File)",
	]:
		if strRequiredContract not in strTranslationStringsPackage:
			return Fail(f"{PathTranslationStringsPackage.relative_to(ROOT)} is missing live native delegation: {strRequiredContract}")

	for strForbiddenContract in [
		"createDefaultExport",
		"moduleName",
		"languageManager",
		"loadRaw",
		"toJSON()",
		"new Proxy",
	]:
		if strForbiddenContract in (strTranslationsPackage + strTranslationManagerPackage + strTranslationStringsPackage):
			return Fail(f"translations packages contain obsolete compatibility behavior: {strForbiddenContract}")

	strTranslationBlockStart = "void GetLanguagesCallback"
	strTranslationBlockEnd = "enum class StringTableProperty"
	if (strTranslationBlockStart not in strModuleBindings) or (strTranslationBlockEnd not in strModuleBindings):
		return Fail(f"{PathModuleBindings.relative_to(ROOT)} is missing the native translations binding boundaries")

	strTranslationBindingBlock = strModuleBindings.split(strTranslationBlockStart, 1)[1].split(strTranslationBlockEnd, 1)[0]
	for strRequiredContract in [
		'"translations.GetLanguage(strLanguageAlias) expects a string name."',
		'"translations.SetDefaultLanguage(strLanguageAlias) could not resolve the language."',
		'"translations.LoadFile(strTranslationFilePath) expects a non-empty file path."',
		'"translations.GetText(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias?, ReplacementTokens?) could not find the translation key."',
		'"translations.GetText(strTranslationFilePath, strPhraseKey, strRequestedLanguageAlias?, ReplacementTokens?) could not select a translation language."',
		'"translations.FormatText(strMessageTemplate, ReplacementValues?) expects values to be an object."',
	]:
		if strRequiredContract not in strTranslationBindingBlock:
			return Fail(f"native translations binding is missing strict validation: {strRequiredContract}")

	if 'Args.GetReturnValue().Set(MakeString(pIsolate, ""));' in strTranslationBindingBlock:
		return Fail("native translations binding must not return empty-string fallback results")

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_translations.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"translations smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"translations smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckSettingsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_settings.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"settings smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"settings smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckSettingsMenuSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_settings_menu.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"settings/menu smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"settings/menu smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckSettingsTypesSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_settings_types.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"settings/types smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"settings/types smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerSettingsSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_settings_player.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"settings/player smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"settings/player smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckSettingsStorageSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_settings_storage.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"settings/storage smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"settings/storage smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckConfigurationConsoleVariableSmoke():
	unTimeoutSeconds = 30

	for strSmokeScript in ("smoke_config_cvar.js", "smoke_config_help_lines.js"):
		try:
			ProcessResult = subprocess.run(["node", str(ROOT / "tools" / strSmokeScript)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"{strSmokeScript} failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"{strSmokeScript} failed:\n{ProcessResult.stdout}")

	return 0

def CheckConfigurationSettingsRuntimeSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_config_settings_runtime.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"config/settings runtime smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"config/settings runtime smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckPlayerCommandAuthorizationSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_commands_auth_player.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"commands/auth/player smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"commands/auth/player smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckCommandRuntimeSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_commands_runtime.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"commands runtime smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"commands runtime smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckCommandNativeErrors():
	PathModuleBindings = ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp"
	strModuleBindings = ReadText(PathModuleBindings)

	for strRequiredContract in [
		"bool RunServerCommand(v8::Isolate* const pIsolate",
		"bool SubmitServerCommand(v8::Isolate* const pIsolate",
		'ThrowError(pIsolate, "server command execution expects a non-empty command.")',
		'std::string const strErrorMessage = std::string(pszOperation) + " expects a non-empty command.";',
		'ThrowError(pIsolate, strErrorMessage.c_str());',
		'"server command queue expects a non-empty command."',
		'"server command insert expects a non-empty command."',
		'RunServerCommand(pIsolate, strCommand, "server command execution")',
		'SubmitServerCommand(pIsolate, strCommand, false, "QueueServerCommand")',
		'SubmitServerCommand(pIsolate, strCommand, true, "InsertServerCommand")',
		'constexpr char kAPIName[] = "Player.Kick()";',
		'constexpr char kOperation[] = "Player.Ban()";',
		'RunServerCommand(pIsolate, strCommand, kAPIName)',
		'RunServerCommand(pIsolate, strBanCommand, kOperation)',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native command binding missing: {strRequiredContract}")

	for strHelperStart, strHelperEnd in [
		("bool RunServerCommand", "bool SubmitServerCommand"),
		("bool SubmitServerCommand", "CGlobalVars* RequireEntityGlobals"),
	]:
		nHelperBegin = strModuleBindings.find(strHelperStart)
		nHelperEnd = strModuleBindings.find(strHelperEnd, nHelperBegin)
		if (nHelperBegin < 0) or (nHelperEnd < 0):
			return Fail(f"native server command helper block could not be located: {strHelperStart}")

		strHelperBindings = strModuleBindings[nHelperBegin:nHelperEnd]
		if ("strCommand.empty()" not in strHelperBindings) or ("RequireEngineServer(pIsolate, pszOperation)" not in strHelperBindings):
			return Fail(f"{strHelperStart} must validate its command and engine interface before use")

	for strForbiddenContract in [
		"static bool RunServerCommand(std::string const& strCommand)",
		"static bool QueueServerCommand(std::string const& strCommand, bool const bInsert)",
		"Args.GetReturnValue().Set(RunServerCommand(strCommand))",
		"Args.GetReturnValue().Set(QueueServerCommand(strCommand, false))",
		"Args.GetReturnValue().Set(QueueServerCommand(strCommand, true))",
		'RunServerCommand(pIsolate, strCommand, "Player.kick()")',
		'RunServerCommand(pIsolate, strCommand, "Player.ban()")',
	]:
		if strForbiddenContract in strModuleBindings:
			return Fail(f"native command helpers must throw through V8 bindings: {strForbiddenContract}")

	return 0

def CheckAuthenticationManagerSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_auth_manager.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"auth/manager smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"auth/manager smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckAuthenticationStoreSmoke():
	unTimeoutSeconds = 30

	for strScriptName in ["smoke_auth_store.js", "smoke_auth_sql_blocking.js"]:
		try:
			ProcessResult = subprocess.run(["node", str(ROOT / "tools" / strScriptName)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
		except (OSError, subprocess.TimeoutExpired) as RunError:
			return Fail(f"{strScriptName} failed to run: {RunError}")

		if ProcessResult.returncode != 0:
			return Fail(f"{strScriptName} failed:\n{ProcessResult.stdout}")

	return 0

def CheckBitBuffersSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_bitbuffers.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"bitbuffers smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"bitbuffers smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckBitBuffersNativeStrictArguments():
	PathModuleBindings = ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp"
	strModuleBindings = ReadText(PathModuleBindings)
	strBitBufferBlockStart = "void PackUInt32Callback"
	strBitBufferBlockEnd = "bool InstallSoundConstants"
	nBitBufferBlockBegin = strModuleBindings.find(strBitBufferBlockStart)
	nBitBufferBlockEnd = strModuleBindings.find(strBitBufferBlockEnd, nBitBufferBlockBegin)
	if (nBitBufferBlockBegin < 0) or (nBitBufferBlockEnd < 0):
		return Fail(f"{PathModuleBindings.relative_to(ROOT)} is missing the native bitbuffer binding boundaries")

	strBitBufferBindingBlock = strModuleBindings[nBitBufferBlockBegin:nBitBufferBlockEnd]

	for strRequiredContract in [
		"bool GetUInt32Argument(v8::Isolate* const pIsolate",
		"bool GetInt64Argument(v8::Isolate* const pIsolate",
		"bool GetInt32Argument(v8::Isolate* const pIsolate",
		"bool GetFloatArgument(v8::Isolate* const pIsolate",
		'GetInt32Argument(pIsolate, LocalContext, LocalDataByteCountOrBytesValue, kByteCountTypeError, nByteCount)',
		'GetInt32Argument(pIsolate, LocalContext, LocalDataBitCountValue, kDataBitCountTypeError, BitBufferWriterState.m_nDataBitCount)',
		'GetInt32Argument(pIsolate, LocalContext, LocalBitCountValue, kBitCountTypeError, BitBufferState.m_nDataBitCount)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kByteCountArgumentIndex], kByteCountTypeError, nRequestedByteCount)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kBitIndexArgumentIndex], kBitIndexTypeError, nCurrentBitIndex)',
		'GetInt32Argument(pIsolate, LocalContext, LocalBitCountValue, kBitCountTypeError, nRequestedBitCount)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kBitIndexArgumentIndex], kBitIndexTypeError, nBitIndex)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kBitDeltaArgumentIndex], kBitDeltaTypeError, nBitDelta)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kValueArgumentIndex], kIntegerTypeError, nValue)',
		'GetInt64Argument(pIsolate, LocalContext, CallbackInformation[kInt64ValueArgumentIndex], kInt64ValueTypeError, nInt64Value)',
		'void WriteBitBufferFloatCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation)',
		'BitBufferWriter.WriteFloat(flValue);',
		'GetUInt32Argument(pIsolate, LocalContext, CallbackInformation[kUInt32ValueArgumentIndex], kUInt32ValueTypeError, unValue)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kBitCountArgumentIndex], kBitCountTypeError, nBitCount)',
		'GetInt32Argument(pIsolate, LocalContext, CallbackInformation[kIntegerValueArgumentIndex], kIntegerValueTypeError, nIntegerValue)',
		'GetFloatArgument(pIsolate, LocalContext, CallbackInformation[kNumericValueArgumentIndex], kNumericValueTypeError, flValue)',
		"bool RequireBitBufferVectorFromValue(v8::Isolate* const pIsolate",
		'RequireBitBufferVectorFromValue(pIsolate, LocalContext, CallbackInformation[kVectorArgumentIndex]',
		'RequireBitBufferVectorFromValue(pIsolate, LocalContext, CallbackInformation[kAnglesArgumentIndex]',
	]:
		if strRequiredContract not in strModuleBindings:
			return Fail(f"strict native bitbuffers argument handling missing: {strRequiredContract}")

	for strBitBufferCallbackStart, strNextBitBufferCallback, strBitBufferCallbackLabel in [
		("void CreateBitBufferWriterCallback", "void CreateBitBufferReaderCallback", "BitBufferWrite"),
		("void SetBitBufferDataBitCountCallback", "void SetBitBufferDataByteCountCallback", "bitbuffers.SetDataBitCount"),
		("void SetBitBufferDataByteCountCallback", "void SetBitBufferCurrentBitIndexCallback", "bitbuffers.SetDataByteCount"),
		("void SetBitBufferCurrentBitIndexCallback", "#define SOURCEJS_DEFINE_BITBUFFER_STATE_GETTER_CALLBACK", "bitbuffers.SetCurrentBit"),
		("void CheckBitBufferForOverflowCallback", "void SeekBitBufferToBitCallback", "bitbuffers.CheckForOverflow"),
		("void SeekBitBufferToBitCallback", "void SeekBitBufferRelativeCallback", "bitbuffers.SeekToBit"),
		("void SeekBitBufferRelativeCallback", "void ConvertBitBufferToBytesCallback", "bitbuffers.SeekRelative"),
		("void WriteBitBufferLongLongCallback", "void WriteBitBufferFloatCallback", "bitbuffers.WriteLongLong"),
		("void WriteBitBufferUBitVarCallback", "void WriteBitBufferSignedValue", "bitbuffers.WriteUBitVar"),
		("void WriteBitBufferOneBitAtCallback", "void WriteBitBufferUBitLongCallback", "bitbuffers.WriteOneBitAt"),
		("void WriteBitBufferUBitLongCallback", "void WriteBitBufferWordCallback", "bitbuffers.WriteUBitLong"),
		("void WriteBitBufferSBitLongCallback", "void WriteBitBufferCharCallback", "bitbuffers.WriteSBitLong"),
		("void WriteBitBufferVarInt32Callback", "void WriteBitBufferUBitVarCallback", "bitbuffers.WriteVarInt32"),
		("void WriteBitBufferBitsFromBufferCallback", "void WriteBitBufferBitFloatCallback", "bitbuffers.WriteBitsFromBuffer"),
		("void WriteBitBufferBitAngleCallback", "void WriteBitBufferCoordinateValue", "bitbuffers.WriteBitAngle"),
		("void WriteBitBufferBitCoordinateCallback", "void WritePackedBitBufferMultiplayerCoordinate", "bitbuffers.WriteBitCoord"),
		("void WriteBitBufferBitCoordinateMPCallback", "void WriteBitBufferBitVector3CoordinateCallback", "bitbuffers.WriteBitCoordMP"),
		("bool RequireBitBufferVectorFromValue", "void CreateBitBufferWriterCallback", "bitbuffers vector conversion"),
		("void WriteBitBufferBitVector3CoordinateCallback", "void WriteBitBufferBitNormalCallback", "bitbuffers.WriteBitVec3Coord"),
		("void WriteBitBufferBitNormalCallback", "void WriteBitBufferBitVector3NormalCallback", "bitbuffers.WriteBitNormal"),
		("void WriteBitBufferBitVector3NormalCallback", "void WriteBitBufferBitAnglesCallback", "bitbuffers.WriteBitVec3Normal"),
		("void WriteBitBufferBitAnglesCallback", "#define SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK", "bitbuffers.WriteBitAngles"),
		("void ReadBitBufferUBitLongCallback", "void PeekBitBufferUBitLongCallback", "bitbuffers.ReadUBitLong"),
		("void PeekBitBufferUBitLongCallback", "void ReadBitBufferSBitLongCallback", "bitbuffers.PeekUBitLong"),
		("void ReadBitBufferSBitLongCallback", "void ReadBitBufferLongLongCallback", "bitbuffers.ReadSBitLong"),
		("void ReadBitBufferBitAngleCallback", "void ReadBitBufferBitCoordinateMPCallback", "bitbuffers.ReadBitAngle"),
	]:
		nCallbackBegin = strBitBufferBindingBlock.find(strBitBufferCallbackStart)
		nCallbackEnd = strBitBufferBindingBlock.find(strNextBitBufferCallback, nCallbackBegin)
		if (nCallbackBegin < 0) or (nCallbackEnd < 0):
			return Fail(f"native {strBitBufferCallbackLabel} callback boundaries are missing")

		strBitBufferCallbackBlock = strBitBufferBindingBlock[nCallbackBegin:nCallbackEnd]
		if "FromMaybe(0)" in strBitBufferCallbackBlock:
			return Fail(f"native {strBitBufferCallbackLabel} must reject invalid numeric conversions instead of using 0")

	return 0

def CheckNetChannelSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_netchannel.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"netchannel smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"netchannel smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckMessagesSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_messages.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"messages smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"messages smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckMenusSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_menus.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"menus smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"menus smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckServerAdministrationSmoke():
	unTimeoutSeconds = 30
	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_server_administration.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8", timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"server administration smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"server administration smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckTickListenersSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_listeners_tick.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"listeners/tick smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"listeners/tick smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckListenersStrictSmoke():
	unTimeoutSeconds = 30

	try:
		ProcessResult = subprocess.run(["node", str(ROOT / "tools" / "smoke_listeners_strict.js")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=unTimeoutSeconds, check=False)
	except (OSError, subprocess.TimeoutExpired) as RunError:
		return Fail(f"listeners strict smoke failed to run: {RunError}")

	if ProcessResult.returncode != 0:
		return Fail(f"listeners strict smoke failed:\n{ProcessResult.stdout}")

	return 0

def CheckListenersStrictRuntime():
	PathPackageRoot = ROOT / "packages" / "sourcejs"
	for strObsoletePath in ["internal/listeners.js", "internal/listeners.cjs"]:
		if (PathPackageRoot / strObsoletePath).exists():
			return Fail(f"obsolete listeners facade still exists: {strObsoletePath}")

	strListeners = ReadText(PathPackageRoot / "listeners.js")
	for strRequiredContract in [
		'const g_ListenersRuntime = GetModule("listeners");',
		"return g_ListenersRuntime.AddListener(EnsureEventName(strEventName), EnsureCallback(Callback));",
		"return g_ListenersRuntime.RemoveListener(EnsureEventName(strEventName), EnsureCallback(Callback));",
		"return g_ListenersRuntime.Emit(EnsureEventName(strEventName), SerializePayload(Payload));",
		"return g_ListenersRuntime.GetListenerCount(EnsureEventName(strEventName));",
		"EncodeArguments(vecCallbackArguments)",
		"return vecCallbackArguments;",
		'new ListenerManager("NetworkIDValidated")',
		'new ListenerManager("QueryCVarValueFinished")',
		'new ListenerManager("ServerActivate")',
		'new ListenerManager("ServerOutput")',
		'new ListenerManager("Tick")',
	]:
		if strRequiredContract not in strListeners:
			return Fail(f"listeners.js is missing strict runtime contract: {strRequiredContract}")

	for strForbiddenContract in [
		"moduleName",
		"internal/listeners",
		"decodedPayload.args",
		"{ args: callbackArguments }",
		'new ListenerManager("server_output")',
		"RuntimeOn(EnsureEventName(strEventName)",
		"RuntimeOff(EnsureEventName(strEventName)",
		"RuntimeEmit(EnsureEventName(strEventName)",
		"function RuntimeRegisterListener(",
		"function RuntimeUnregisterListener(",
		"function RuntimeEmitListenerEvent(",
		"function RuntimeGetListenerCount(",
		"this.m_setCallbacks",
		"this.m_RuntimeCallback",
		'"autoBridge"',
		"ButtonStatus.Pressed",
		"ButtonStatus.Released",
	]:
		if strForbiddenContract in strListeners:
			return Fail(f"listeners.js still contains an obsolete runtime contract: {strForbiddenContract}")

	strPayloadBuilder = ReadText(ROOT / "src" / "sourcejs" / "ListenerPayload.cpp")
	if 'm_OutputStream << "{\\"Arguments\\":[";' not in strPayloadBuilder:
		return Fail("ListenerPayloadBuilder does not emit the canonical arguments array")

	if 'm_OutputStream << "{\\"args\\":[";' in strPayloadBuilder:
		return Fail("ListenerPayloadBuilder still emits the obsolete args key")

	strModuleBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strRequiredBinding in [
		'if (!SetFunction(pIsolate, LocalContext, LocalListenersModule, "AddListener", AddRuntimeEventListenerCallback, LocalRuntimeData)) {',
		'if (!SetFunction(pIsolate, LocalContext, LocalListenersModule, "RemoveListener", RemoveRuntimeEventListenerCallback, LocalRuntimeData)) {',
		'if (!SetFunction(pIsolate, LocalContext, LocalListenersModule, "Emit", EmitRuntimeEventCallback, LocalRuntimeData)) {',
		'if (!SetFunction(pIsolate, LocalContext, LocalListenersModule, "GetListenerCount", GetRuntimeEventListenerCountCallback, LocalRuntimeData)) {',
		"const std::size_t unListenerCount = pRuntime->GetEventCallbackCount(strEventName);",
		"CallbackInformation.GetReturnValue().Set(v8::Number::New(pIsolate, static_cast<double>(pRuntime->GetEventCallbackCount(strEventName))));",
	]:
		if strRequiredBinding not in strModuleBindings:
			return Fail(f"native listeners binding is missing: {strRequiredBinding}")

	strApplication = ReadText(ROOT / "src" / "sourcejs" / "Application.cpp")
	vecApplicationEvents = [
		"ClientActive",
		"ClientConnect",
		"ClientDisconnect",
		"ClientFullyConnect",
		"ClientPutInServer",
		"ClientSettingsChanged",
		"EdictAllocated",
		"EdictFreed",
		"LevelEnd",
		"LevelInitialize",
		"LevelShutdown",
		"NetworkIDValidated",
		"QueryCVarValueFinished",
		"ServerActivate",
		"ServerOutput",
		"Tick",
	]
	for strEventName in vecApplicationEvents:
		if f'"{strEventName}"' not in strApplication:
			return Fail(f"Application.cpp does not emit listener event: {strEventName}")

	strPluginManager = ReadText(ROOT / "src" / "sourcejs" / "PluginManager.cpp")
	for strEventName in ["PluginLoading", "PluginLoaded", "PluginUnloading", "PluginUnloaded"]:
		if f'EmitEvent("{strEventName}"' not in strPluginManager:
			return Fail(f"PluginManager.cpp does not emit lifecycle event: {strEventName}")

	for strMethodStart, strMethodEnd, strEventBefore, strOperation, strEventAfter in [
		("bool PluginManager::Load(", "bool PluginManager::Unload(", 'EmitEvent("PluginLoading"', "ExecutePluginFile(", 'EmitEvent("PluginLoaded"'),
		("bool PluginManager::Unload(", "bool PluginManager::Reload(", 'EmitEvent("PluginUnloading"', "UnloadPlugin(", 'EmitEvent("PluginUnloaded"'),
	]:
		nMethodBegin = strPluginManager.find(strMethodStart)
		nMethodEnd = strPluginManager.find(strMethodEnd, nMethodBegin)
		if (nMethodBegin < 0) or (nMethodEnd < 0):
			return Fail(f"plugin lifecycle method block could not be located: {strMethodStart}")

		strLifecycleBindings = strPluginManager[nMethodBegin:nMethodEnd]
		nBeforePosition = strLifecycleBindings.find(strEventBefore)
		nOperationPosition = strLifecycleBindings.find(strOperation)
		nAfterPosition = strLifecycleBindings.find(strEventAfter)
		if (nBeforePosition < 0) or (nOperationPosition < 0) or (nAfterPosition < 0):
			return Fail(f"plugin lifecycle method must emit both events around {strOperation}")

		if (nBeforePosition >= nOperationPosition) or (nOperationPosition >= nAfterPosition):
			return Fail(f"plugin lifecycle events must surround {strOperation} in execution order")

	strPlugin = ReadText(ROOT / "src" / "sourcejs" / "SourceJSPlugin.cpp")
	for strRequiredDelegation in [
		"ClientPutInServer(GetEntityIndex(pEntity), pszPlayerName)",
		"NetworkIDValidated(pszUserName, pszNetworkID)",
		"QueryCVarValueFinished(nQueryCookie, GetEntityIndex(pPlayerEntity), static_cast<int>(Status), pszCVarName, pszCVarValue)",
	]:
		if strRequiredDelegation not in strPlugin:
			return Fail(f"VSP listener callback loses native values: {strRequiredDelegation}")

	strRuntime = ReadText(ROOT / "src" / "sourcejs" / "V8Runtime.cpp")
	strCombinedNative = "\n".join([strApplication, strPluginManager, strRuntime])
	for strOldEventName in [
		"client_active",
		"client_connect",
		"client_disconnect",
		"level_init",
		"level_shutdown",
		"network_id_validated",
		"plugin_loaded",
		"query_cvar_value_finished",
		"server_activate",
		"server_output",
	]:
		if f'"{strOldEventName}"' in strCombinedNative:
			return Fail(f"native listeners still contain old event key: {strOldEventName}")

	return 0

def CheckCoreInternalHelpersDirectNativeCalls():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strRequired in [
		'#include "tier1/checksum_md5.h"',
		"GetCoreChecksumCallback",
		"MD5Init(&MD5Context)",
		"MD5Update(&MD5Context,",
		"MD5Final(arrDigestBytes, &MD5Context)",
		'SetFunction(pIsolate, LocalContext, LocalCoreModule, "GetChecksum", GetCoreChecksumCallback, LocalRuntimeData)',
	]:
		if strRequired not in strBindings:
			return Fail(f"native core checksum binding missing: {strRequired}")

	strCore = ReadText(ROOT / "packages" / "sourcejs" / "core.js")
	if "return g_CoreRuntime.GetChecksum(strChecksumText);" not in strCore:
		return Fail("core.js must delegate MD5 to the native Source SDK tier1 binding")

	for strForbidden in [
		"function md5(",
		"function utf8Bytes(",
		"Math.sin(index + 1)",
		"function leftRotate(",
	]:
		if strForbidden in strCore:
			return Fail(f"core.js must not implement MD5 in JavaScript: {strForbidden}")

	PathPackageRoot = ROOT / "packages" / "sourcejs"
	vecPaths = []

	for PathObsolete in [PathPackageRoot / "internal" / "auth.js", PathPackageRoot / "internal" / "auth.cjs"]:
		if PathObsolete.exists():
			return Fail(f"obsolete auth runtime facade must not exist: {PathObsolete.relative_to(ROOT)}")

	for PathPackageFile in sorted(PathPackageRoot.rglob("*.js")):
		vecPaths.append(PathPackageFile.relative_to(PathPackageRoot).as_posix())

	for strPath in sorted(set(vecPaths)):
		PathFile = ROOT / "packages" / "sourcejs" / strPath
		if not PathFile.is_file():
			continue

		strContent = ReadText(PathFile)
		for strForbidden in [
			"callModuleApi",
			"runtimeInvoke",
			"unavailableApi",
		]:
			if strForbidden in strContent:
				return Fail(f"{strPath} must use direct native module calls, found {strForbidden}")

		if strPath == "memory.js":
			for strForbidden in [
				"memoryManagerRuntime().symbol(binaryName, text) || memoryManagerRuntime().scan(binaryName, text)",
				"memoryManagerRuntime().findSymbol(binaryName, text) || memoryManagerRuntime().findSignature(binaryName, text)",
				'text.includes("\\\\x")',
				"return helperAddress(identifier);",
				"return helperAddress(BigInt(text));",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must resolve binary identifiers through native memory/manager.ResolveBinaryIdentifier(): {strForbidden}")

			if "return g_MemoryManagerRuntime.ResolveBinaryIdentifier(strBinaryName, BinaryIdentifier);" not in strContent:
				return Fail(f"{strPath} is missing direct native memory/manager.ResolveBinaryIdentifier() call")

		if strPath == "memory/manager.js":
			for strForbidden in [
				"function looksLikePattern",
				"function looksLikeAddress",
				"return symbol(binaryName, String(identifier)) || scan(binaryName, String(identifier));",
				"function findSignature(",
				"function findSymbol(",
				"return memoryManagerRuntime.select(identifier);",
				"return scan(binaryName, identifier);",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must resolve identifiers through native symbol or signature lookup: {strForbidden}")

			for strRequired in [
				"const g_NativeGetBinarySymbol = g_MemoryManagerRuntime.GetBinarySymbol;",
				"const g_NativeScanBinary = g_MemoryManagerRuntime.ScanBinary;",
				"return g_NativeGetBinarySymbol(strBinaryName, strSymbolName);",
				"return g_NativeScanBinary(strBinaryName, strBytePattern);",
				"function ResolveBinaryIdentifier(strBinaryName, Identifier)",
				'if (typeof Identifier === "bigint")',
				'if (typeof Identifier === "number")',
				'Binary addresses must be bigint values.',
				'return GetBinarySymbol(strBinaryName, Identifier.slice(1));',
				'return ScanBinary(strBinaryName, Identifier);',
				'const vecIdentifierKeys = ["Address", "Identifier", "Symbol", "Pattern"].filter',
				'if (vecIdentifierKeys.length !== 1)',
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing strict native-backed identifier resolution: {strRequired}")

			for strRequired in [
				"ResolveMemoryManagerIdentifier",
				"ResolveBinaryIdentifierCallback",
				'DefineFunction("ResolveBinaryIdentifier", ResolveBinaryIdentifierCallback)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native memory/manager.ResolveBinaryIdentifier binding: {strRequired}")

		if strPath == "auth/backends/flatfile.js":
			for strForbidden in [
				"...flatfile",
				"export const load = flatfile.load",
				"load: flatfile.load",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must not eagerly enumerate or bind auth backend runtime APIs: {strForbidden}")

			for strRequired in [
				'const g_AuthorizationRuntime = GetModule("auth");',
				"class FlatFileBackend extends Backend",
				"AuthorizationState = g_AuthorizationRuntime.Reload();",
				"this.SynchronizeManager(AuthorizationState);",
				"bSaveResult = g_AuthorizationRuntime.Save();",
				"Callback(null, bSaveResult);",
				"FLAT_FILE_BACKEND: g_FlatFileBackend,",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing its direct flat-file backend contract: {strRequired}")

		if strPath == "auth/backends/sql.js":
			for strForbidden in [
				'backendRuntime(moduleName)',
				'permissions.sql',
				'return sql.',
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must use the mandatory native SOCI database backend: {strForbidden}")

			for strRequired in [
				'const { Begin, Close, Commit, Connect, Execute, IsConnected, Query, Reconnect, Rollback } = require("soci");',
				'const g_SQLRuntime = GetModule("auth/backends/sql");',
				"function RequireRequestParameters(Options, Callback, strOperationName)",
				'RequireRequestParameters(Options, Callback, "SQLBackend.Open");',
				'RequireRequestParameters(Options, Callback, "SQLBackend.CreateSchema");',
				'RequireRequestParameters(Options, Callback, "SQLBackend.Load");',
				'RequireRequestParameters(Options, Callback, "SQLBackend.Save");',
				'RequireRequestParameters(Options, Callback, "SQLBackend.Unload");',
				"Request(...vecArguments, Options, RequestCallback);",
				"RunOpenRequest(OpenRequest, Connect, [this.m_strConnectionString], Options, CompleteConnection);",
				"Execute(hConnection, strStatement, {}, Options, StatementCallback);",
				"Query(hConnection,",
				"const CompleteBegin = (BeginError) =>",
				"const CompleteCommit = (CommitError) =>",
				"const CompleteRollback = (RollbackError) =>",
				"Begin(hConnection, Options, CompleteBegin);",
				"Commit(hConnection, Options, CompleteCommit);",
				"Rollback(hConnection, Options, CompleteRollback);",
				"RunOpenRequest(OpenRequest, IsConnected, [this.m_hConnection], Options,",
				"RunOpenRequest(OpenRequest, Reconnect, [this.m_hConnection], Options,",
				"Close(this.m_hConnection, Options, (CloseError) =>",
				'class SQLBackend extends Backend',
				'new SQLBackend()',
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing its direct native SOCI backend contract: {strRequired}")

		if strPath == "auth/manager.js":
			for strRequired in [
				"new FlatFileBackend({ Manager })",
				"new SQLBackend({ Manager })",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} must register concrete auth backends: {strRequired}")

		if strPath == "settings/storage.js":
			for strForbidden in [
				"readJson",
				"writeJson",
				"JSON.parse",
				"JSON.stringify",
				"runtime.readText",
				"runtime.writeText",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must persist settings through mandatory native SOCI: {strForbidden}")

			for strRequired in [
				'const g_SOCIRuntime = GetModule("soci");',
				"RequireSettingsRequestOptions(Options)",
				"RequireSettingsCallback(Callback)",
				"g_SOCIRuntime.Connect(strSettingsConnectionString, Options, CompleteConnect);",
				"g_SOCIRuntime.Connect(strSettingsConnectionString, strSettingsBackend, Options, CompleteConnect);",
				"g_SOCIRuntime.Execute(hSOCIHandle, strSQL, Parameters, Options, CompleteRequest)",
				"g_SOCIRuntime.Query(hSOCIHandle, strSQL, Parameters, Options, CompleteRequest)",
				'RunSettingsSOCIRequest((CompleteBegin) => g_SOCIRuntime.Begin(hSOCIHandle, Options, CompleteBegin), (bBegan) => RequireSuccessfulSOCIResult(bBegan, "soci.Begin()"),',
				'RunSettingsSOCIRequest((CompleteCommit) => g_SOCIRuntime.Commit(hSOCIHandle, Options, CompleteCommit), (bCommitted) => RequireSuccessfulSOCIResult(bCommitted, "soci.Commit()"),',
				'RunSettingsSOCIRequest((CompleteRollback) => g_SOCIRuntime.Rollback(hSOCIHandle, Options, CompleteRollback), (bRolledBack) => RequireSuccessfulSOCIResult(bRolledBack, "soci.Rollback()"),',
				'RunSettingsSOCIRequest((CompleteCheck) => g_SOCIRuntime.IsConnected(hSOCIHandle, Options, CompleteCheck), (bConnected) => RequireSOCIBooleanResult(bConnected, "soci.IsConnected()"),',
				'RunSettingsSOCIRequest((CompleteReconnect) => g_SOCIRuntime.Reconnect(hSOCIHandle, Options, CompleteReconnect), (bReconnected) => RequireSuccessfulSOCIResult(bReconnected, "soci.Reconnect()"),',
				'RunSettingsSOCIRequest((CompleteClose) => g_SOCIRuntime.Close(hSOCIHandle, Options, CompleteClose), (bClosed) => RequireSuccessfulSOCIResult(bClosed, "soci.Close()"),',
				'const g_strPlayerTable = "sourcejs_settings_players";',
				'const g_strValueTable = "sourcejs_settings_values";',
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing its direct native SOCI settings contract: {strRequired}")

		if (strPath == "messages/implementation.js") and ("not implemented" in strContent):
			return Fail(f"{strPath} must not expose unfinished user-message implementation errors")

		if strPath == "messages/implementation.js":
			for strForbidden in [
				'getModule("menus")',
				"menuRuntime.showText",
				"typeof messageRuntime.createDialog",
				"typeof runtime.createDialog",
				"function normalizeTarget",
				"targets.map((target) => normalizeTarget(target))",
				"return target > 0 ? [target] : [];",
				"for (const index of normalizeRecipients(targets))",
				"return Number(buffer.getFieldCount(name)) || 0;",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must send dialogs through native messages.CreateDialog without JS transport fallback: {strForbidden}")

			for strRequired in [
				'return NormalizeMessageInteger(CallBufferMethod(Buffer, "GetFieldCount", strFieldName));',
				"const RecipientFilter = g_RecipientFiltersRuntime.CreateRecipientFilterFromValues(TargetReferences, true);",
				"return RecipientFilter.GetRecipientIndexes();",
				"function RequireMessageRecipients(TargetReferences, strOperationName)",
				"RequireMessageRecipients(TargetReferences, \"SendClientConsoleMessageToRecipients(TargetReferences, strMessageText)\")",
				"RequireMessageRecipients(TargetReferences, \"SendClientCommandToRecipients(TargetReferences, strCommandLine)\")",
				"RequireMessageRecipients(TargetReferences, \"SendSayTextMessageToRecipients(TargetReferences, strMessageText, unSenderIndex, bSendToChat)\")",
				"RequireMessageRecipients(TargetReferences, \"SendSayText2MessageToRecipients(TargetReferences, strMessageText, unSenderIndex, bSendToChat)\")",
				"RequireMessageRecipients(TargetReferences, \"SendDialogMessageDataToRecipients(TargetReferences)\")",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} must resolve message recipients through native filters/recipients and reject empty sends: {strRequired}")

		if strPath == "messages/index.js":
			for strForbidden in [
				"fallback(",
				"globalThis.sourcejs",
				"sourceRuntime",
				"playersHelpers",
				"playersLanguage",
				"playerInfoOf",
				"runtime[\"players/language\"]",
				"runtime.players",
				"typeof language.getClientLanguage",
				"typeof players.isFakeClient",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must use strict native player/language lookup for translated messages: {strForbidden}")

			for strRequired in [
				"g_PlayerLanguageRuntime.GetClientLanguage(unPlayerIndex)",
				"g_PlayersRuntime.IsFakeClient(unPlayerIndex)",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing strict translated recipient runtime call: {strRequired}")

		if strPath == "entities/index.js":
			for strForbidden in [
				'typeof entity.model === "string"',
				'return entity.model;',
				'datamaps.getPropertyString(entity, "m_ModelName")',
				"} catch {\n\t\treturn \"\";",
				'if (entity && typeof entity.CallInput === "function")',
				"const input = getInput(entity, name);",
				"return input.call(value);",
				"createDelay(entity, delay, () => input.call(value))",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must use strict native entities runtime calls: {strForbidden.splitlines()[0]}")

			if "return g_EntitiesRuntime.GetModel(EntityReference);" not in strContent:
				return Fail(f"{strPath} is missing direct native entities.GetModel() runtime call")

			if "return g_EntitiesRuntime.CallInput(EntityReference, strInputName, InputValue, flInputDelay);" not in strContent:
				return Fail(f"{strPath} is missing direct native entities.CallInput() runtime call")

			for strRequired in [
				'#if __has_include("game/server/cbase.h")',
				'#include "game/server/cbase.h"',
				"#define SOURCEJS_HAS_BASE_ENTITY 1",
				"constexpr int kDefaultOutputID = 0;",
				"return pBaseEntity->AcceptInput(strInputName.c_str(), pBaseEntity, pBaseEntity, InputValue, kDefaultOutputID);",
				"requires CBaseEntity::AcceptInput() in the selected Source SDK branch.",
				"GetEntityModelCallback",
				'SetFunction(pIsolate, LocalContext, LocalEntitiesModule, "GetModel", GetEntityModelCallback, LocalRuntimeData)',
				'SetFunction(pIsolate, LocalContext, LocalEntityModule, "GetModel", GetEntityModelCallback, LocalRuntimeData)',
				"CallEntityInputCallback",
				'std::string const strInputDelayMessage = std::string(pszOperation) + " expects a finite delay."',
				'SetFunction(pIsolate, LocalContext, LocalEntitiesModule, "CallInput", CallEntityInputCallback, LocalRuntimeData)',
				'SetFunction(pIsolate, LocalContext, LocalEntityModule, "CallInput", CallEntityInputCallback, LocalRuntimeData)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native entities binding: {strRequired}")

			for strForbidden in [
				"static int GetAcceptInputVTableIndex()",
				"typedef bool (__thiscall *fnAcceptInput)",
				"struct inputdata_t {",
			]:
				if strForbidden in strBindings:
					return Fail(f"entities.CallInput must use the selected SDK CBaseEntity method directly: {strForbidden}")

			nCallInputBegin = strBindings.find("void CallEntityInputByIndex")
			nCallInputEnd = strBindings.find("void EntityCallInputMethodCallback", nCallInputBegin)
			if (nCallInputBegin < 0) or (nCallInputEnd < 0):
				return Fail("native entities.CallInput helper block could not be located")

			strCallInputBlock = strBindings[nCallInputBegin:nCallInputEnd]
			if "GetFloatArgument(pIsolate, LocalContext, CallbackInformation[nDelayArgumentIndex], strInputDelayMessage.c_str(), flInputDelay)" not in strCallInputBlock:
				return Fail("native entities.CallInput delay must use strict native float validation")

			for strForbidden in [
				"Args[nDelayArg]->NumberValue(LocalContext).FromMaybe(0)",
				"static_cast<float>(Args[nDelayArg]->NumberValue(LocalContext).FromMaybe(0))",
			]:
				if strForbidden in strCallInputBlock:
					return Fail(f"native entities.CallInput delay must reject invalid values instead of using 0: {strForbidden}")

		if strPath == "stringtables.js":
			for strForbidden in [
				"moduleName",
				"numberField",
				"stringField",
				"tableInfo",
				"tableList",
				"value.id ?? INVALID_STRING_TABLE",
				"value.maxStrings ?? 0",
				"value.name ?? \"\"",
				"value.numStrings ?? 0",
				"if (name.length === 0) {\n\t\treturn null;",
				"if (name.length === 0) {\n\t\treturn INVALID_STRING_INDEX;",
				"if (normalized.length === 0) {\n\t\treturn INVALID_STRING_INDEX;",
				"String table native field is not available",
				"String table native field is empty",
				"String table native field must be numeric",
				"Number.isFinite(result)",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must not fake missing native string-table info fields: {strForbidden}")

			for strRequired in [
				'const g_StringTablesRuntime = GetModule("stringtables");',
				"return g_StringTablesRuntime.GetAllStringTables();",
				"return g_StringTablesRuntime.FindStringTable(strTableName);",
				"return g_StringTablesRuntime.GetDownloadablesTable();",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing direct live native stringtables access: {strRequired}")

			for strRequired in [
				"GetRequiredStringCallback",
				"GetStringTablesTableProperty",
				'InstallStringTablesTableProperty(pIsolate, LocalContext, LocalStringTableObject, kStringTableAddressPropertyName, StringTableProperty::Address)',
				'SetFunction(pIsolate, LocalContext, LocalStringTablesModule, "GetRequiredString", GetRequiredStringCallback, LocalRuntimeData)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native stringtables field binding: {strRequired}")

			for strForbidden in [
				"StringTablesNumberFieldCallback",
				"StringTablesStringFieldCallback",
				'"address", StringTableProperty',
				'"downloadablesTableName"',
				'SetFunction(pIsolate, LocalContext, LocalStringTables, "numberField"',
				'SetFunction(pIsolate, LocalContext, LocalStringTables, "stringField"',
			]:
				if strForbidden in strBindings:
					return Fail(f"ModuleBindings.cpp retains obsolete stringtables binding: {strForbidden}")

		if strPath == "auth/manager.js":
			for strForbidden in [
				"typeof runtime.load",
				"typeof runtime.sync",
				"typeof runtime.save",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must call native auth backend lifecycle methods directly: {strForbidden}")

		if strPath == "weapons/constants.js":
			for strForbidden in [
				"typeof globals.info",
				"typeof filesystem.exists",
				'return "generic";',
				"The shipped base constants are still usable without globals.",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must use strict globals/filesystem APIs: {strForbidden}")

		if strPath == "cvars/flags.js":
			for strForbidden in [
				"is not a finite number",
				"is not an object",
				"Number.isFinite(value)",
				"return runtime()[property];",
				"const value = runtime()[name];",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must fetch constants through native cvars/flags accessors: {strForbidden}")

			if 'module.exports = GetModule("cvars/flags");' not in strContent:
				return Fail(f"{strPath} must expose the exact native cvars/flags object")

			for strRequired in [
				"InstallCVarFlagConstants",
				"GetConVarFlagConstantCallback",
				"InstallCVarFlagConstants(pIsolate, LocalContext, LocalCVarFlagsModule)",
				'SetFunction(pIsolate, LocalContext, LocalCVarFlagsModule, "GetConVarFlagConstant", GetConVarFlagConstantCallback, LocalRuntimeData)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native cvars/flags binding: {strRequired}")

		if strPath == "internal/commands.js":
			for strForbidden in [
				"is not a finite number",
				"is not an object",
				"Number.isFinite(value)",
				"getModule(moduleName)[propertyName]",
				"return commandRuntime()[property];",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must fetch command constants through native commands accessors: {strForbidden}")

			for strRequired in [
				"BLOCK: g_CommandsRuntime.BLOCK,",
				"CommandReturn: g_CommandsRuntime.CommandReturn,",
				"MAX_COMMAND_LENGTH: g_CommandsRuntime.MAX_COMMAND_LENGTH,",
				"RegisterCommand: g_CommandsRuntime.RegisterCommand,",
				"UnregisterCommand: g_CommandsRuntime.UnregisterCommand,",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing direct native commands member: {strRequired}")

			for strRequired in [
				"GetCommandReturnNumberCallback",
				"GetCommandReturnObjectCallback",
				'SetRecordFunction(pIsolate, LocalContext, LocalTargetModule, "GetCommandReturnNumber", GetCommandReturnNumberCallback, LocalUndefinedValue)',
				'SetRecordFunction(pIsolate, LocalContext, LocalTargetModule, "GetCommandReturnObject", GetCommandReturnObjectCallback, LocalUndefinedValue)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native commands binding: {strRequired}")

		if strPath == "cvars.js":
			for strForbidden in [
				"is not a finite number",
				"Number.isFinite(value)",
				"getModule(moduleName)[propertyName]",
				"return getModule(moduleName)[property];",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must fetch cvar constants through native cvars accessors: {strForbidden}")

			if 'module.exports = GetModule("cvars");' not in strContent:
				return Fail(f"{strPath} must expose the exact native cvars object")

			for strRequired in [
				"GetConVarNumericConstantCallback",
				"GetPublicConVarConstantCallback",
				'SetFunction(pIsolate, LocalContext, LocalCVarsModule, "GetConVarNumericConstant", GetConVarNumericConstantCallback, LocalRuntimeData)',
				'SetFunction(pIsolate, LocalContext, LocalPublicCVarsModule, "GetPublicConVarConstant", GetPublicConVarConstantCallback, LocalRuntimeData)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native cvars binding: {strRequired}")

		if strPath == "entities/constants.js":
			for strForbidden in [
				"constantMap",
				"moduleName",
				"Object.freeze",
				"runtime.number",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must expose the exact native entities/constants object: {strForbidden}")

			if 'module.exports = GetModule("entities/constants");' not in strContent:
				return Fail(f"{strPath} is missing its direct native entities/constants export")

			for strRequired in [
				"InstallEntityConstants",
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "DamageTypes", LocalNativeConstants, kEntityDamageTypeConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "EntityStates", LocalNativeConstants, kEntityStateConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "EntityEffects", LocalNativeConstants, kEntityEffectConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "DissolveType", LocalNativeConstants, kEntityDissolveTypeConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "TakeDamage", LocalNativeConstants, kEntityTakeDamageConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "EntityFlags", LocalNativeConstants, kEntityFlagConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "MoveType", LocalNativeConstants, kEntityMoveTypeConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "MoveCollide", LocalNativeConstants, kEntityMoveCollideConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "SolidType", LocalNativeConstants, kEntitySolidTypeConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "SolidFlags", LocalNativeConstants, kEntitySolidFlagConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "RenderMode", LocalNativeConstants, kEntityRenderModeConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "RenderEffects", LocalNativeConstants, kEntityRenderEffectConstants)',
				'InstallEntityConstantGroup(pIsolate, LocalContext, LocalEntityConstants, "CollisionGroup", LocalNativeConstants, kEntityCollisionGroupConstants)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native entities/constants binding: {strRequired}")

		if strPath == "weapons/constants.js":
			for strForbidden in [
				"SourceJS ${moduleName}.${name} is not available",
				"Number.isFinite(value)",
				"return runtime()[name];",
				"export const ItemFlags",
				"export const WeaponState",
				"export const WeaponProficiency",
				"export const MuzzleFlashStyle",
				"export const WeaponID",
				"export const WeaponSlot",
				"export const WeaponType",
				"export const WeaponSound",
				"const ItemFlags =",
				"const WeaponState =",
				"const WeaponProficiency =",
				"const MuzzleFlashStyle =",
				"const WeaponID =",
				"const WeaponSlot =",
				"const WeaponType =",
				"const WeaponSound =",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must fetch constants through native weapons/constants accessors: {strForbidden}")

			if 'module.exports = GetModule("weapons/constants");' not in strContent:
				return Fail(f"{strPath} must expose the exact native weapons/constants object")

			for strRequired in [
				"InstallWeaponConstants",
				"InstallWeaponConstants(pIsolate, LocalContext, LocalWeaponsConstantsModule)",
				'SetRecordProperty(pIsolate, LocalContext, LocalWeaponConstantsModule, "INVALID_WEAPON_INDEX", v8::Integer::New(pIsolate, kInvalidWeaponIndex))',
				'SetRecordProperty(pIsolate, LocalContext, LocalWeaponConstantsModule, "CLASS_PREFIX", MakeString(pIsolate, kWeaponClassPrefix))',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native weapons/constants binding: {strRequired}")

		if strPath == "players/constants.js":
			for strForbidden in [
				"Proxy",
				"moduleName",
				"numberConstant",
				"objectConstant",
				"objectNumberConstant",
				"HideHudFlags",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must expose only the exact native players/constants object: {strForbidden}")

			if 'module.exports = GetModule("players/constants");' not in strContent:
				return Fail(f"{strPath} must expose the exact native players/constants object")

			for strRequired in [
				"InstallPlayerConstants",
				"InstallPlayerButtonConstants",
				"InstallPlayerLifeStateConstants",
				'SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "FixAngle", LocalFixAngleConstants)',
				'SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "HideHUDFlags", LocalHideHUDFlags)',
				'SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "HitGroup", LocalHitGroupConstants)',
				'SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "LifeState", LocalPlayerLifeStateConstants)',
				'SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "ObserverMode", LocalObserverModeConstants)',
				'SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "PlayerAnimation", LocalPlayerAnimationConstants)',
				'SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "PlayerButtons", LocalPlayerButtonConstants)',
				'SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "PlayerStates", LocalPlayerStateFlags)',
				'InstallPlayerButtonConstant("IN_ATTACK", "Attack", IN_ATTACK)',
				'InstallPlayerLifeStateConstant("LIFE_ALIVE", "Alive", LIFE_ALIVE)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native players/constants binding: {strRequired}")

			for strForbidden in [
				"PlayerConstantsNumberCallback",
				"PlayerConstantsObjectCallback",
				"PlayerConstantsObjectNumberCallback",
				'SetValue(pIsolate, LocalContext, LocalObject, "buttons",',
				'SetValue(pIsolate, LocalContext, LocalObject, "lifeState",',
			]:
				if strForbidden in strBindings:
					return Fail(f"ModuleBindings.cpp retains obsolete players/constants API: {strForbidden}")

		if strPath == "engines/trace.js":
			for strForbidden in [
				"is not a finite number",
				"is not an object",
				"Number.isFinite(value)",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must fetch constants through native engines/trace accessors: {strForbidden}")

			if 'module.exports = GetModule("engines/trace");' not in strContent:
				return Fail(f"{strPath} must expose the exact native engines/trace object")

			for strRequired in [
				"InstallTraceConstants",
				"InstallTraceConstants(pIsolate, LocalContext, LocalEngineTraceModule)",
				'SetFunction(pIsolate, LocalContext, LocalEngineTraceModule, "TraceRay", TraceRayCallback, LocalRuntimeData)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native engines/trace binding: {strRequired}")

		if strPath == "studio/constants.js":
			if 'module.exports = GetModule("studio/constants");' not in strContent:
				return Fail("studio/constants.js must expose the exact native CommonJS object")

			for strRequired in [
				"InstallStudioConstants",
				'InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioInvalidAttachmentIndexPropertyName, v8::Integer::New(pIsolate, kStudioInvalidAttachmentIndex))',
				'InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioInvalidBoneIndexPropertyName, v8::Integer::New(pIsolate, kStudioInvalidBoneIndex))',
				'InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioModelTypeObjectPropertyName, LocalStudioModelTypeObject)',
				'InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioFlagsObjectPropertyName, LocalStudioFlagsObject)',
				'InstallStudioValue(pIsolate, LocalContext, LocalStudioModelTypeObject, kStudioModelTypeStudioPropertyName, v8::Integer::New(pIsolate, static_cast<int>(mod_studio)))',
				'InstallStudioValue(pIsolate, LocalContext, LocalStudioFlagsObject, kStudioFlagsRenderPropertyName, v8::Number::New(pIsolate, static_cast<double>(STUDIO_RENDER)))',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing direct studio/constants binding: {strRequired}")

			for strForbidden in [
				"StudioConstantsNumberCallback",
				"StudioConstantsObjectCallback",
				'SetFunction(pIsolate, LocalContext, LocalObject, "number"',
				'SetFunction(pIsolate, LocalContext, LocalObject, "object"',
			]:
				if strForbidden in strBindings:
					return Fail(f"ModuleBindings.cpp studio/constants must not expose generic lookups: {strForbidden}")

		if strPath == "studio/cache.js":
			if 'module.exports = GetModule("studio/cache");' not in strContent:
				return Fail("studio/cache.js must expose the exact native CommonJS object")

			for strRequired in [
				"bool GetStudioModelHandleFromValue",
				"bool GetStudioIndexArgument",
				"bool GetStudioCollectionOperationFromCallback",
				"studiohdr_t* GetStudioHeaderFromObject",
				"mstudiohitboxset_t* GetStudioHitboxSetFromValue",
				"mstudioseqdesc_t* GetStudioSequenceFromValue",
				"v8::Local<v8::Object> MakeStudioModelCacheDataTypeObject",
				"IMDLCache* RequireStudioModelCache",
				"bool RequireStudioModelHandle",
				"GetStudioModelHeaderAddressCallback",
				"void RequireStudioModelHeaderCallback",
				'"studio/cache.FindModel(strModelPath) expects a model path."',
				'"studio/cache.AddReference(hModelHandle) expects a model handle."',
				'"studio/cache.GetModelHeader(hModelHandle) expects a model handle."',
				'"studio/cache.RequireModelHeader(hModelHandle) expects a model handle."',
				'InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioCacheInvalidModelHandlePropertyName, LocalInvalidModelHandleValue)',
				'InstallStudioValue(pIsolate, LocalContext, LocalTargetObject, kStudioCacheModelCacheDataTypePropertyName, LocalStudioModelCacheDataTypeObject)',
				'InstallStudioFunction(pIsolate, LocalContext, LocalTargetObject, kStudioCacheGetModelHeaderAddressFunctionName, GetStudioModelHeaderAddressCallback, LocalRuntimeData)',
				'InstallStudioFunction(pIsolate, LocalContext, LocalTargetObject, kStudioCacheRequireModelHeaderFunctionName, RequireStudioModelHeaderCallback, LocalRuntimeData)',
				'InstallStudioAddress(pIsolate, LocalContext, LocalHitboxObject, pStudioHitbox)',
				'InstallStudioValue(pIsolate, LocalContext, LocalHitboxObject, kHitboxMinimumsPropertyName, LocalHitboxMinimumsObject)',
				'InstallStudioValue(pIsolate, LocalContext, LocalHitboxObject, kHitboxMaximumsPropertyName, LocalHitboxMaximumsObject)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing strict live studio/cache binding: {strRequired}")

			nStudioBegin = strBindings.find("bool GetStudioAddressFromValue")
			nStudioEnd = strBindings.find("void GetPhysicsGravityCallback", nStudioBegin)
			if (nStudioBegin < 0) or (nStudioEnd < 0):
				return Fail("native studio binding block could not be located")

			strStudioBlock = strBindings[nStudioBegin:nStudioEnd]
			for strForbidden in [
				'"address"',
				"StudioInstallAddress",
				"StudioMakeAddressValue",
				'"moduleName"',
				"StudioConstantsNumberCallback",
				"StudioConstantsObjectCallback",
				"findMdl",
				"getModelHeaderInfo",
				"getRequiredModelHeaderInfo",
				"StudioMakeAddressObject",
				"ValueIsNullish",
			]:
				if strForbidden in strStudioBlock:
					return Fail(f"ModuleBindings.cpp studio binding contains obsolete compatibility behavior: {strForbidden}")

			if re.search(r"\b(?:AddressCallback|AddressFromValue)\s*\(", strStudioBlock):
				return Fail("native studio binding must not expose obsolete generic address helpers")

			strEntityBase = ReadText(ROOT / "packages" / "sourcejs" / "entities" / "index.js")
			for strRequired in [
				'const g_StudioCacheRuntime = require("studio/cache");',
				"g_StudioCacheRuntime.FindModelHandle(strModelPath)",
				"g_StudioCacheRuntime.RequireModelHeader(hModelHandle)",
				'DefineEntityMethod(EntityObject, "GetEntityModelHeader"',
				'DefineEntityMethod(EntityObject, "GetEntityHitbox"',
			]:
				if strRequired not in strEntityBase:
					return Fail(f"entity/player studio decoration is missing: {strRequired}")

		if strPath == "effects.js":
			for strForbidden in [
				"DONT_BLEED: -1",
				"RED: 0",
				"GLASS: 0",
				"return runtime()[name];",
				"return runtime()[property];",
				"const BloodColor = effectsRuntime.BloodColor;",
				"const ShatterSurface = effectsRuntime.ShatterSurface;",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must fetch effect constants through native effects accessors: {strForbidden}")

			for strRequired in [
				'const g_EffectsRuntime = GetModule("effects");',
				"const g_EffectsAPI = {",
				"module.exports = g_EffectsAPI;",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing the live native effects export contract: {strRequired}")

			for strRequired in [
				"MakeEffectsBloodColorObject",
				"MakeEffectsShatterSurfaceObject",
				"InstallEffectsConstants",
				"InstallEffectsConstants(pIsolate, LocalContext, LocalEffectsModule)",
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native effects binding: {strRequired}")

		if strPath == "weapons/instance.js":
			for strForbidden in [
				"catch (error)",
				"return numericOrNull(value);",
				"cvarExists",
				"exists as cvarExists",
				"exists: cvarExists",
				"Weapon maxAmmo cvar is not available",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must not hide missing cvar-backed ammunition values: {strForbidden}")

			for strPropertyName in ["MaximumAmmo", "SecondaryMaximumAmmo"]:
				strAccessorPattern = r"^\tget " + re.escape(strPropertyName) + r"\(\) \{\n(?P<Body>.*?)^\t\}"
				AccessorMatch = re.search(strAccessorPattern, strContent, re.MULTILINE | re.DOTALL)
				if AccessorMatch is None:
					return Fail(f"{strPath} is missing the {strPropertyName} accessor")

				strAccessorBody = AccessorMatch.group("Body")
				for strRequired in [
					f"const {strPropertyName} = this.ValueRecord.{strPropertyName};",
					f'if (typeof {strPropertyName} === "string") {{',
					f"return GetConVarInteger({strPropertyName});",
					f"return {strPropertyName};",
				]:
					if strRequired not in strAccessorBody:
						return Fail(f"{strPath} must capture ammo metadata and resolve strings through strict native cvars.GetConVarInteger(): {strRequired}")

				if (strAccessorBody.count(f"this.ValueRecord.{strPropertyName}") != 1) or re.search(r"\b(?:try|catch)\b", strAccessorBody):
					return Fail(f"{strPath} must read {strPropertyName} once and propagate native ConVar failures")

		if strPath == "weapons/index.js":
			for strForbidden in [
				"function tryReadInt(entity, property)",
				"function isMissingPrimaryReserveAmmoError",
				"function tryReadPrimaryReserveAmmo",
				"missing|not found|not available|unknown|invalid",
				"m_iPrimaryReserveAmmoCount\") &&",
				"} catch {\n\t\treturn -1;",
				"entities/props",
				"return getPropertyInt(entity, property);",
				"return decorateEntity(getPropertyEntity(weaponValue(weapon), ownerProperty));",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must not hide native reserve ammo read failures: {strForbidden.splitlines()[0]}")

			for strRequired in [
				"return DecorateEntity(g_WeaponsRuntime.GetPropertyEntity(GetWeaponIndex(WeaponValue), g_strOwnerProperty));",
				"g_WeaponsRuntime.GetPropertyInteger(GetWeaponIndex(WeaponValue), g_strClipProperty)",
				"return g_WeaponsRuntime.SetPropertyInteger(GetWeaponIndex(WeaponValue), g_strClipProperty, nPrimaryClip);",
				"return g_WeaponsRuntime.GetAmmo(GetWeaponIndex(WeaponValue));",
				"return g_WeaponsRuntime.SetAmmo(GetWeaponIndex(WeaponValue), nAmmo);",
				"return g_WeaponsRuntime.GetPropertyInteger(WeaponOwner.Index, GetAmmoProperty(GetSecondaryAmmoType(WeaponValue)));",
				"return g_WeaponsRuntime.SetPropertyInteger(WeaponOwner.Index, GetAmmoProperty(GetSecondaryAmmoType(WeaponValue)), nSecondaryAmmo);",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing direct native weapons property runtime call: {strRequired}")

			for strRequired in [
				"InstallWeaponPropertyAndAmmoFunctions",
				'SetRecordFunction(pIsolate, LocalContext, LocalWeaponsObject, "GetProperty", GetEntityPropertyCallback, LocalRuntimeData)',
				'SetRecordFunction(pIsolate, LocalContext, LocalWeaponsObject, "SetProperty", SetEntityPropertyCallback, LocalRuntimeData)',
				'SetRecordFunction(pIsolate, LocalContext, LocalWeaponsObject, "GetPropertyInteger", GetEntityPropertyIntegerCallback, LocalRuntimeData)',
				'SetRecordFunction(pIsolate, LocalContext, LocalWeaponsObject, "SetPropertyInteger", SetEntityPropertyIntegerCallback, LocalRuntimeData)',
				'SetRecordFunction(pIsolate, LocalContext, LocalWeaponsObject, "GetPropertyEntity", GetEntityPropertyEntityCallback, LocalRuntimeData)',
				'SetRecordFunction(pIsolate, LocalContext, LocalWeaponsObject, "GetAmmo", GetWeaponAmmoCountCallback, LocalRuntimeData)',
				'SetRecordFunction(pIsolate, LocalContext, LocalWeaponsObject, "SetAmmo", SetWeaponAmmoCountCallback, LocalRuntimeData)',
				"GetWeaponAmmoCountCallback",
				"SetWeaponAmmoCountCallback",
				"InstallWeaponPropertyAndAmmoFunctions(pIsolate, LocalContext, LocalWeaponsModule, LocalRuntimeData)",
				"InstallWeaponPropertyAndAmmoFunctions(pIsolate, LocalContext, LocalWeaponsEntityModule, LocalRuntimeData)",
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native weapons binding: {strRequired}")

		if strPath == "players/engines.js":
			for strForbidden in [
				"Proxy",
				"moduleName",
				"available",
				"Number(",
				"Player",
				"engines/bms",
				"engines/csgo",
				"engines/l4d2",
				"engines/orangebox",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must expose only the exact native players/engines object: {strForbidden}")

			if 'module.exports = GetModule("players/engines");' not in strContent:
				return Fail(f"{strPath} must expose the exact native players/engines object")

			for strRequired in [
				"InstallPlayerEngineFunctions",
				"return pPlayer->GiveNamedItem(strItem.c_str(), nSubtype);",
				'InstallModule(pIsolate, LocalContext, LocalSourceJS, "players/engines", LocalPlayerEnginesModule)',
				'" expects a boolean bRemoveIfNotCarried option."',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing direct players/engines SDK binding: {strRequired}")

			if "PlayerGiveNamedItemAvailable" in strBindings:
				return Fail("players/engines must omit unavailable SDK bindings instead of exposing availability fallbacks")

		if strPath == "players/dropweapon.js":
			for strForbidden in [
				"Proxy",
				"moduleName",
				"Boolean(",
				"drop_weapon",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must expose only the exact native DropWeapon object: {strForbidden}")

			if 'module.exports = GetModule("players/dropweapon");' not in strContent:
				return Fail(f"{strPath} must expose the exact native players/dropweapon object")

			for strRequired in [
				"PlayersIsCombatWeapon",
				'std::strcmp(pszDatamapClassName, kCombatWeaponClassName)',
				'DropWeapon(Player, Weapon, Target?, Velocity?) requires an entity derived from CBaseCombatWeapon.',
				"DropPlayerWeaponCallback",
				"pBasePlayer->Weapon_Drop(pCombatWeapon, pTargetVector, pVelocityVector);",
				'DropWeapon(Player, Weapon, Target?, Velocity?)',
				'v8::Local<v8::Object> const LocalDropWeaponModule = MakeModule(pIsolate);',
				'SetFunction(pIsolate, LocalContext, LocalDropWeaponModule, "DropWeapon", DropPlayerWeaponCallback',
				'InstallModule(pIsolate, LocalContext, LocalSourceJS, "players/dropweapon", LocalDropWeaponModule)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native players/dropweapon binding: {strRequired}")

			nDropWeaponBegin = strBindings.find("bool PlayersIsCombatWeapon")
			nDropWeaponEnd = strBindings.find("#if defined(ENGINE_CSS)", nDropWeaponBegin)
			if (nDropWeaponBegin < 0) or (nDropWeaponEnd < 0):
				return Fail("native player weapon-drop binding block could not be located")

			strPlayersDropWeaponBindings = strBindings[nDropWeaponBegin:nDropWeaponEnd]
			for strForbidden in [
				"PlayersDropWeaponAvailable",
				"PlayersDropWeaponDescriptorInteger",
				"PlayersDropWeaponDescriptorOffset",
				"fnDropWeapon",
				"pfnDropWeapon",
				"(*ppVTable)[nVTableIndex]",
				"players/drop_weapon",
			]:
				if strForbidden in strPlayersDropWeaponBindings:
					return Fail(f"players/dropweapon must call the selected SDK declaration directly: {strForbidden}")

		if strPath == "players/index.js":
			for strForbidden in [
				"for (const player of runtime.all())",
				"player.userid === expected",
				"entities/factories",
				"spawnEntity",
				"m_hActiveWeapon",
				"weaponManager.current",
				"ownedWeaponEntities",
				"weaponManager.all()",
				"indexes === null",
				"indexedPropertyPath",
				"sawSupportedProperty",
				"entitiesByClassName",
				"entityProps.getPropertyInt(player, ammoPropertyPath",
				"entityProps.setPropertyInt(player, ammoPropertyPath",
				"entities/datamaps",
				"entities/props",
				"entityDatamaps.",
				"entityProps.",
				"function unavailablePlayerPropertyError",
				"function readFirst(",
				"function writeFirst(",
				"function boolProperty(value, names)",
				"function requireBoolProperty",
				"None of the player boolean properties",
				"boolProperty(player, [\"hltv\", \"isHltv\", \"isHLTV\"])",
				"boolProperty(player, [\"inVehicle\", \"inAVehicle\"])",
				"boolProperty(player, [\"observer\", \"isObserver\"])",
				"player && player.connected",
				"player && player.fakeClient",
				"player && player.dead",
				"player && player.name",
				"player && player.team",
				"player && player.origin",
				"player && typeof player.userid",
				"player.steamId ?? player.networkId",
				"player.playerClass",
				"entity && entity.origin",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must resolve FromUserID through the native players runtime: {strForbidden}")

			if "return entityHelpers.indexFromIntHandle(handle);\n\t} catch {\n\t\treturn -1;" in strContent:
				return Fail(f"{strPath} must not hide native observer target handle lookup errors")

			if "return DecoratePlayer(g_PlayersRuntime.GetPlayerFromUserID(nUserID));" not in strContent:
				return Fail(f"{strPath} is missing direct native GetPlayerFromUserID runtime call")

			if "return g_PlayersRuntime.SpawnPlayer(PlayerReference, bForceRespawn);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.SpawnPlayer runtime call")

			if "return g_PlayersRuntime.GetActiveWeapon(PlayerReference);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.GetActiveWeapon runtime call")

			if "return g_PlayersRuntime.SetActiveWeapon(PlayerReference, WeaponReference);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.SetActiveWeapon runtime call")

			if "return g_PlayersRuntime.IsHLTV(PlayerReference);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.IsHLTV runtime call")

			if "return g_PlayersRuntime.IsInVehicle(PlayerReference);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.IsInVehicle runtime call")

			if "return g_PlayersRuntime.IsObserver(PlayerReference);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.IsObserver runtime call")

			for strRequired in [
				"return g_PlayersRuntime.GetNetworkID(PlayerReference);",
				"return g_PlayersRuntime.IsConnected(PlayerReference);",
				"return g_PlayersRuntime.IsFakeClient(PlayerReference);",
				"return g_PlayersRuntime.IsDead(PlayerReference);",
				"return g_PlayersRuntime.GetName(PlayerReference);",
				"return g_PlayersRuntime.SetName(PlayerReference, strPlayerName);",
				"return g_PlayersRuntime.GetTeam(PlayerReference);",
				"return ReadIntegerProperty(PlayerReference, g_strPlayerClassProperty);",
				"return WriteIntegerProperty(PlayerReference, g_strPlayerClassProperty, nPlayerClass);",
				"PlayerEventPayload.userid = g_PlayersRuntime.GetUserID(PlayerReference);",
				"return ResolveVector(g_PlayersRuntime.GetOrigin(PlayerReference));",
				"const TargetOrigin = ReadVectorProperty(EntityReference, g_strOriginProperty);",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing direct live player runtime call: {strRequired}")

			if "const ObserverTarget = ReadEntityProperty(PlayerReference, g_strObserverTargetProperty);" not in strContent:
				return Fail(f"{strPath} must read the observer target through the native entity property binding")

			if "return g_PlayersRuntime.GetWeaponIndices(PlayerReference, WEAPON_MANAGER.MyWeaponsProperty);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.GetWeaponIndices runtime call")

			if "return g_PlayersRuntime.GetProjectileIndices(PlayerReference, strProjectileName);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.GetProjectileIndices runtime call")

			if "return g_PlayersRuntime.GetProjectileAmmo(PlayerReference, GetProjectileAmmoPropertyPath(strProjectileName));" not in strContent:
				return Fail(f"{strPath} is missing direct native players.GetProjectileAmmo runtime call")

			if "return g_PlayersRuntime.SetProjectileAmmo(PlayerReference, GetProjectileAmmoPropertyPath(strProjectileName), nAmmoValue);" not in strContent:
				return Fail(f"{strPath} is missing direct native players.SetProjectileAmmo runtime call")

			for strRequired in [
				"return g_PlayersRuntime.GetIntegerProperty(EntityReference, strPropertyPath);",
				"return g_PlayersRuntime.SetIntegerProperty(EntityReference, strPropertyPath, nIntegerValue);",
				"return ResolveVector(g_PlayersRuntime.GetVectorProperty(EntityReference, strPropertyPath));",
				"return g_PlayersRuntime.SetVectorProperty(EntityReference, strPropertyPath, ResolveVector(VectorLike));",
				"return g_PlayersRuntime.GetEntityProperty(EntityReference, strPropertyPath);",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing direct native players property runtime call: {strRequired}")

			for strForbidden in [
				"return Number(runtime.getIntProperty(entity, propertyName)) || 0;",
				"return runtime.setIntProperty(entity, propertyName, Number(value) || 0);",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must not coerce native player property calls through JS fallback: {strForbidden}")

			for strRequired in [
				"GetPlayerFromUserIDCallback",
				"SpawnPlayerCallback",
				"GetPlayerActiveWeaponCallback",
				"SetPlayerActiveWeaponCallback",
				"GetPlayerWeaponIndicesCallback",
				"GetPlayerProjectileIndicesCallback",
				"GetPlayerProjectileAmmoCallback",
				"SetPlayerProjectileAmmoCallback",
				"GetPlayerIntegerPropertyCallback",
				"SetPlayerIntegerPropertyCallback",
				'"SetProjectileAmmo(Player, strPropertyPath, nValue) expects an integer value."',
				'"SetIntegerProperty(Player, vecPropertyNames, nValue) expects an integer value."',
				"GetPlayerVectorPropertyCallback",
				"SetPlayerVectorPropertyCallback",
				"GetPlayerEntityPropertyCallback",
				"GetPlayerNameCallback",
				"GetPlayerTeamCallback",
				"GetPlayerUserIDCallback",
				"GetPlayerNetworkIDCallback",
				"GetPlayerOriginCallback",
				"IsPlayerConnectedCallback",
				"IsPlayerFakeClientCallback",
				"IsPlayerDeadCallback",
				"IsPlayerHLTVCallback",
				"IsPlayerInVehicleCallback",
				"IsPlayerObserverCallback",
				"SetPlayerNameCallback",
				"PlayerSetNameMethodCallback",
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetPlayerFromUserID", GetPlayerFromUserIDCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "SpawnPlayer", SpawnPlayerCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetActiveWeapon", GetPlayerActiveWeaponCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "SetActiveWeapon", SetPlayerActiveWeaponCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetWeaponIndices", GetPlayerWeaponIndicesCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetProjectileIndices", GetPlayerProjectileIndicesCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetProjectileAmmo", GetPlayerProjectileAmmoCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "SetProjectileAmmo", SetPlayerProjectileAmmoCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetIntegerProperty", GetPlayerIntegerPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "SetIntegerProperty", SetPlayerIntegerPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetVectorProperty", GetPlayerVectorPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "SetVectorProperty", SetPlayerVectorPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "GetEntityProperty", GetPlayerEntityPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "IsHLTV", IsPlayerHLTVCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "IsInVehicle", IsPlayerInVehicleCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "IsObserver", IsPlayerObserverCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayersModule, "SetName", SetPlayerNameCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "GetPlayerFromUserID", GetPlayerFromUserIDCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "SpawnPlayer", SpawnPlayerCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "GetActiveWeapon", GetPlayerActiveWeaponCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "SetActiveWeapon", SetPlayerActiveWeaponCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "GetWeaponIndices", GetPlayerWeaponIndicesCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "GetProjectileIndices", GetPlayerProjectileIndicesCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "GetProjectileAmmo", GetPlayerProjectileAmmoCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "SetProjectileAmmo", SetPlayerProjectileAmmoCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "GetIntegerProperty", GetPlayerIntegerPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "SetIntegerProperty", SetPlayerIntegerPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "GetVectorProperty", GetPlayerVectorPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "SetVectorProperty", SetPlayerVectorPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "GetEntityProperty", GetPlayerEntityPropertyCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "IsHLTV", IsPlayerHLTVCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "IsInVehicle", IsPlayerInVehicleCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "IsObserver", IsPlayerObserverCallback',
				'SetFunction(pIsolate, LocalContext, LocalPlayerEntityModule, "SetName", SetPlayerNameCallback',
				'SetRecordFunction(pIsolate, LocalContext, LocalPlayerObject, "SetName", PlayerSetNameMethodCallback',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native players binding: {strRequired}")

			for strCallbackName, strNextCallbackName in [
				("SetPlayerProjectileAmmoCallback", "GetPlayerIntegerPropertyCallback"),
				("SetPlayerIntegerPropertyCallback", "GetPlayerVectorPropertyCallback"),
				("SetPlayerVectorPropertyCallback", "GetPlayerEntityPropertyCallback"),
			]:
				nPlayerCallbackBegin = strBindings.find(f"void {strCallbackName}(")
				nPlayerCallbackEnd = strBindings.find(f"void {strNextCallbackName}(", nPlayerCallbackBegin + 1)
				if (nPlayerCallbackBegin < 0) or (nPlayerCallbackEnd < 0):
					return Fail(f"ModuleBindings.cpp is missing ordered player callback boundaries: {strCallbackName}/{strNextCallbackName}")

				strCallbackBlock = strBindings[nPlayerCallbackBegin:nPlayerCallbackEnd]
				if "FromMaybe(0)" in strCallbackBlock:
					return Fail(f"{strCallbackName} must not coerce invalid numeric values to zero")

			for strForbidden in [
				"PlayersNumberFromObject",
				"PlayersNumberFromArray",
			]:
				if strForbidden in strBindings:
					return Fail(f"native players vector binding must not use soft numeric fallback helper: {strForbidden}")

			for strRequired in [
				'bool RequireVectorFromValue(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalVectorValue, char const* const pszErrorMessage, Vector& VectorOut)',
				'const bool bVectorConverted = RequireVectorFromValue(pIsolate, LocalContext, LocalVectorValue, kVectorValueErrorMessage, PropertyVector);',
				'DropWeapon(Player, Weapon, Target?, Velocity?) requires target and velocity vectors with numeric components.',
				'"SetVectorProperty(Player, vecPropertyNames, Vector) expects numeric vector components."',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing strict native players vector binding: {strRequired}")

		if strPath == "players/engines/orangebox/cstrike.js":
			for strForbidden in ["Proxy", "moduleName", "available", "decoratePlayer", "Player", "Number("]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must expose only the exact native CSS object: {strForbidden}")

			if 'module.exports = GetModule("players/engines/orangebox/cstrike");' not in strContent:
				return Fail(f"{strPath} must expose the exact native CSS object")

			for strRequired in [
				'v8::Local<v8::Object> const LocalCounterStrikePlayerEngineModule = MakeModule(pIsolate);',
				'SetFunction(pIsolate, LocalContext, LocalCounterStrikePlayerEngineModule, "GetPlayer", GetCounterStrikePlayerCallback',
				'SetFunction(pIsolate, LocalContext, LocalCounterStrikePlayerEngineModule, "HasC4", DoesCounterStrikePlayerHaveC4Callback',
				'SetFunction(pIsolate, LocalContext, LocalCounterStrikePlayerEngineModule, "Spawn", SpawnCounterStrikePlayerCallback',
				'InstallModule(pIsolate, LocalContext, LocalSourceJS, "players/engines/orangebox/cstrike", LocalCounterStrikePlayerEngineModule)',
				'RequirePlayerInformationFromIndex(pIsolate, nPlayerEntityIndex, nullptr, kOperationName)',
				'constexpr char kForceArgumentErrorMessage[] = "Player.Spawn(bForce?) expects a boolean force option.";',
				'ThrowError(pIsolate, kForceArgumentErrorMessage);',
				'constexpr char kUsageErrorMessage[] = "GetPlayer(Player) expects a player.";',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing strict native CSS binding: {strRequired}")

			for strForbidden in [
				"PlayersCStrikeAvailable",
				"PlayersCStrikeEnsureAvailable",
				'SetBoolean(pIsolate, LocalContext, LocalCounterStrikePlayerEngineModule, "available"',
				'SetFunction(pIsolate, LocalContext, LocalCounterStrikePlayerEngineModule, "Player"',
			]:
				if strForbidden in strBindings:
					return Fail(f"CSS engine binding retains an availability fallback or obsolete Player alias: {strForbidden}")

		if strPath in [
			"players/engines/bms.js",
			"players/engines/csgo.js",
			"players/engines/l4d2.js",
			"players/engines/orangebox.js",
		]:
			strModuleName = strPath.removesuffix(".js")
			strModuleObjectName = {
				"players/engines/bms": "LocalBMSPlayerEngineModule",
				"players/engines/csgo": "LocalCSGOPlayerEngineModule",
				"players/engines/l4d2": "LocalL4D2PlayerEngineModule",
				"players/engines/orangebox": "LocalOrangeBoxPlayerEngineModule",
			}[strModuleName]

			for strForbidden in ["Proxy", "moduleName", "available", "Player", "Number(", "_memory"]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must expose only its exact native SDK object: {strForbidden}")

			if f'module.exports = GetModule("{strModuleName}");' not in strContent:
				return Fail(f"{strPath} must expose exact native module {strModuleName}")

			for strRequired in [
				f'v8::Local<v8::Object> const {strModuleObjectName} = MakeModule(pIsolate);',
				f'InstallModule(pIsolate, LocalContext, LocalSourceJS, "{strModuleName}"',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing direct selected-SDK module {strModuleName}: {strRequired}")

			if (strPath == "players/engines/csgo.js") and ("return pPlayer->GiveNamedItem(strItem.c_str(), nSubtype, bRemoveIfNotCarried);" not in strBindings):
				return Fail("CSGO GiveNamedItem must call the exact three-argument SDK declaration")

		if strPath in ["core.js", "core/version.js"]:
			for strForbidden in [
				"coreRuntime()",
				"globalThis.sourcejs?.paths || {}",
				"Object.keys(globalThis.sourcejs",
				"function pathName(",
				"function runtimeInfo(",
				"function runtimeInfo() {\n\ttry",
				"infoData.branch",
				"infoData.engine",
				'import * as listeners from "./listeners.js"',
				"process.platform",
				'require("listeners")',
				"typeof current.version",
				"typeof current.info",
				"typeof current.isUnversioned",
				"typeof versionRuntime",
				"core/version.version is not available",
				"core/version.info is not available",
				"VERSION is not available",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must call native core/version APIs directly: {strForbidden}")

			if strPath == "core.js":
				for strRequired in [
					"const NativeInformation = g_CoreRuntime.GetInfo();",
					"Architecture: NativeInformation.Architecture",
					"GameName: NativeInformation.GameName",
					"Platform: NativeInformation.Platform",
					"SourceEngine: NativeInformation.SourceEngine",
					"SourceEngineBranch: NativeInformation.SourceEngineBranch",
					"g_CoreRuntime.GetModules()",
					"g_CoreRuntime.GetPublicPackages()",
				]:
					if strRequired not in strContent:
						return Fail(f"{strPath} must read core identity fields directly from native core.GetInfo(): {strRequired}")

		if strPath == "core/dumps.js":
			for strForbidden in [
				'["list", "all", "listServerClasses"]',
				"entities/classes.list is not available",
				"globalThis.sourcejs",
				"Object.entries(globalThis",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must call native entities/classes reflection directly: {strForbidden}")

			if "CoreRuntime.GetModules()" not in strContent:
				return Fail(f"{strPath} must read runtime module names from native core.GetModules()")

		if strPath == "menus/queue.js":
			for strForbidden in [
				"typeof runtime.hideText",
				"runtime.showText(playerIndex, \"\", \"\", 0)",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must hide menus through native menus.HideText without JS fallback: {strForbidden}")

			if "g_MenusRuntime.HideText(ResolvePlayerIndex(PlayerReference))" not in strContent:
				return Fail(f"{strPath} must call native menus.HideText directly")

		if strPath == "entities/classes.js":
			for strForbidden in [
				"entities/props",
				"from \"./props.js\"",
				"require(\"entities/props\")",
				"listServerClasses as listPropServerClasses",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must read class reflection data from native entities/classes, not entities/props: {strForbidden}")

			for strRequired in [
				'const g_EntityClassesRuntime = GetModule("entities/classes");',
				"g_EntityClassesRuntime.GetServerClasses",
				"g_EntityClassesRuntime.FindServerClass",
				"g_EntityClassesRuntime.GetSendTable",
				"g_EntityClassesRuntime.GetServerClassProperty",
				"g_EntityClassesRuntime.GetServerClassProperties",
				"g_EntityClassesRuntime.FindServerClassPropertyOffset",
				"module.exports = g_EntityClassesRuntime;",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing live native entities/classes ownership: {strRequired}")

			for strRequired in [
				"InstallEntityClassReflectionFunctions",
				'SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, "GetServerClasses", GetServerClassesCallback',
				'SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, "FindServerClass", FindServerClassByNameCallback',
				'SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, "GetSendTable", GetSendTableCallback',
				'SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, "GetServerClassProperty", GetServerClassPropertyCallback',
				'SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, "GetServerClassProperties", GetServerClassPropertiesCallback',
				"InstallEntityClassReflectionFunctions(pIsolate, LocalContext, LocalEntityClassesModule, LocalRuntimeData)",
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native entities/classes reflection binding: {strRequired}")

		if strPath == "core/command/docs.js":
			for strForbidden in [
				"globalThis.sourcejs",
				"Object.keys(sourcejs",
				"sourcejs[name]",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must generate module docs from native core.GetModules(): {strForbidden}")

			if "CoreRuntime.GetModules()" not in strContent:
				return Fail(f"{strPath} must read runtime module names from native core.GetModules()")

		if (strPath == "engines/precache.js") and ("typeof globalVars.info" in strContent):
			return Fail(f"{strPath} must read map load state through GetGlobalVariables().MapName")

		if strPath == "engines/precache.js":
			for strForbidden in [
				"info.mapName ??",
				"info.map ??",
				"globalVars.info()",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must read the native globals MapName contract directly: {strForbidden}")

			if "const strMapName = GetGlobalVariables().MapName;" not in strContent:
				return Fail(f"{strPath} must read map load state from GetGlobalVariables().MapName")

		if strPath == "engines/server.js":
			for strForbidden in ["moduleName", "Proxy", "engineServer", "serverGameDll", "globalVars"]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must expose only the exact native module: {strForbidden}")

			if 'module.exports = GetModule("engines/server");' not in strContent:
				return Fail(f"{strPath} must load engines/server through a literal native key")

		if strPath in ["memory.js", "memory/hooks/events.js"]:
			for strForbidden in [
				"typeof hookHandle.remove",
				"typeof this.hook[removeName]",
				"typeof this.hook.remove",
				"? this.hook[removeName](callback) : false",
				"? hookHandle.remove() : true",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} hook handles must expose strict native remove APIs: {strForbidden}")

		if strPath == "players/index.js":
			for strForbidden in [
				"sourcejs.players",
				'sourcejs["players"]',
				'sourcejs["players/helpers"]',
				"function readFirst(entity, names, readers, fallback",
				"function readIntFirst(entity, names, fallback",
				"function readVectorFirst(entity, names, fallback",
				"function boolProperty(value, names, fallback",
				"return fallback;",
				"readIntFirst(player, VEHICLE_PROPS, -1)",
				"readIntFirst(player, OBSERVER_MODE_PROPS, 0)",
				"readIntFirst(player, PLAYER_CLASS_PROPS, 0)",
				"readIntFirst(player, OBSERVER_TARGET_PROPS, -1)",
				"readIntFirst(player, TAKE_DAMAGE_PROPS, TAKE_DAMAGE.YES)",
				"boolProperty(player, [\"hltv\", \"isHltv\", \"isHLTV\"], false)",
				"boolProperty(player, [\"inVehicle\", \"inAVehicle\"], false)",
				"boolProperty(player, [\"observer\", \"isObserver\"], false)",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} player property aliases must throw when no SDK property is available: {strForbidden}")

		if strPath == "players/helpers.js":
			for strForbidden in [
				"SteamID",
				"new SteamID",
				"networkIdCandidates",
				"findPlayer",
				"numericId",
				"playerNetworkId",
				"players.all()",
				"function playerList",
				"function players",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must use native players/helpers lookup bindings directly: {strForbidden}")

			if 'module.exports = GetModule("players/helpers");' not in strContent:
				return Fail(f"{strPath} must expose the exact native players/helpers object")

			for strRequired in [
				'SetFunction(pIsolate, LocalContext, LocalPlayerHelpersModule, "GetPlayerIndex", GetPlayerIndexCallback, LocalRuntimeData)',
				'SetFunction(pIsolate, LocalContext, LocalPlayerHelpersModule, "GetIndexFromUserID", GetPlayerIndexFromUserIDCallback, LocalRuntimeData)',
				'SetFunction(pIsolate, LocalContext, LocalPlayerHelpersModule, "GetIndexFromName", GetPlayerIndexFromNameCallback, LocalRuntimeData)',
				'SetFunction(pIsolate, LocalContext, LocalPlayerHelpersModule, "GetIndexFromNetworkID", GetPlayerIndexFromNetworkIDCallback, LocalRuntimeData)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing strict native players/helpers registration: {strRequired}")

		if strPath == "filesystem.js":
			for strForbidden in [
				"isTTY() {\n\t\tthis.checkClosed();\n\t\treturn false;",
				"isSeekable() {\n\t\tthis.checkClosed();\n\t\treturn true;",
				"throw new Error(\"SourceFile does not use a file descriptor.\");",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} SourceFile methods must delegate to native filesystem: {strForbidden.splitlines()[0]}")

		if strPath == "entities/collisions.js":
			for strForbidden in [
				"NONE: 0,",
				"PLAYER: 5,",
				"VPHYSICS: 6,",
				"NOT_SOLID: 4,",
				"entities/props",
				"getPropertyInt",
				"getPropertyVector",
				"setPropertyInt",
				"setPropertyVector",
				"COLLISION_GROUP_PROPS",
				"SOLID_TYPE_PROPS",
				"SOLID_FLAGS_PROPS",
				"MINS_PROPS",
				"MAXS_PROPS",
				"function readFirst",
				"function writeFirst",
				"function readFirst(entity, names, reader, fallback)",
				"return fallback;",
				"return false;\n}",
				"CollisionGroup.NONE)",
				"SolidType.NONE)",
				"Object.freeze",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} collision aliases must throw when no SDK property is available: {strForbidden}")

			for strRequired in [
				'const g_CollisionsRuntime = GetModule("entities/collisions");',
				"const g_CollisionGroup = DecorateConstantGroup(g_CollisionsRuntime.GetCollisionGroupConstants());",
				"const g_SolidFlags = DecorateConstantGroup(g_CollisionsRuntime.GetSolidFlagConstants());",
				"const g_SolidType = DecorateConstantGroup(g_CollisionsRuntime.GetSolidTypeConstants());",
				"return g_NativeGetCollisionGroup(this.Entity);",
				"g_NativeSetCollisionGroup(this.Entity, nCollisionGroup);",
				"return g_NativeGetSolidType(this.Entity);",
				"g_NativeSetSolidType(this.Entity, unSolidType);",
				"return g_NativeGetSolidFlags(this.Entity);",
				"g_NativeSetSolidFlags(this.Entity, unSolidFlags);",
				"const unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);",
				"return g_NativeSetSolidFlags(EntityReference, nUpdatedSolidFlags);",
				"const MaximumBounds = GetEntityCollisionMaximums(EntityReference);",
				"const MinimumBounds = GetEntityCollisionMinimums(EntityReference);",
				"const vecMinimumBounds = [MinimumBounds.X, MinimumBounds.Y, MinimumBounds.Z];",
				"const vecMaximumBounds = [MaximumBounds.X, MaximumBounds.Y, MaximumBounds.Z];",
				"const bMinimumResult = g_NativeSetMinimums(EntityReference, MinimumBounds);",
				"const bMaximumResult = g_NativeSetMaximums(EntityReference, MaximumBounds);",
				"module.exports = g_CollisionsRuntime;",
			]:
				if strRequired not in strContent:
					return Fail(f"{strPath} is missing strict native collision call: {strRequired}")

			def HasValidatedCollisionFlagReads(strModuleSource):
				strModuleSource = strModuleSource.replace("\r\n", "\n")
				if "const g_unMaximumNativeSolidFlags = 0xFFFF;" not in strModuleSource:
					return False

				if strModuleSource.count("function GetRequiredEntitySolidFlags(") != 1:
					return False

				HelperMatch = re.search(r"(?ms)^function GetRequiredEntitySolidFlags\(EntityReference\) \{\n(.*?)^\}", strModuleSource)
				strExpectedHelperBody = (
					"\tconst unSolidFlags = g_NativeGetSolidFlags(EntityReference);\n"
					"\tif (!Number.isInteger(unSolidFlags) || (unSolidFlags < 0) || (unSolidFlags > g_unMaximumNativeSolidFlags)) {\n"
					'\t\tthrow new TypeError("The native solid-flags getter must return an unsigned 16-bit integer.");\n'
					"\t}\n\n"
					"\treturn unSolidFlags;\n"
				)
				if (HelperMatch is None) or (HelperMatch.group(1) != strExpectedHelperBody):
					return False

				strRequiredRead = "\tconst nRequiredSolidFlags = RequireSolidFlags(nSolidFlags);\n\tconst unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);\n"
				for strFunctionName, strExpression in [
					("AddEntitySolidFlags", "const nUpdatedSolidFlags = unCurrentSolidFlags | nRequiredSolidFlags;"),
					("RemoveEntitySolidFlags", "const nUpdatedSolidFlags = unCurrentSolidFlags & ~nRequiredSolidFlags;"),
					("HasEntitySolidFlags", "return (unCurrentSolidFlags & nRequiredSolidFlags) === nRequiredSolidFlags;"),
				]:
					FunctionMatch = re.search(rf"(?ms)^function {strFunctionName}\(EntityReference, nSolidFlags\) \{{\n(.*?)^\}}", strModuleSource)
					if FunctionMatch is None:
						return False

					strFunctionBody = FunctionMatch.group(1)
					if (not strFunctionBody.startswith(strRequiredRead)) or (strExpression not in strFunctionBody) or (strFunctionBody.count("GetRequiredEntitySolidFlags(") != 1) or ("g_NativeGetSolidFlags(" in strFunctionBody):
						return False

					if (strFunctionName != "HasEntitySolidFlags") and ("return g_NativeSetSolidFlags(EntityReference, nUpdatedSolidFlags);" not in strFunctionBody):
						return False

				return True

			if not HasValidatedCollisionFlagReads(strContent):
				return Fail(f"{strPath} must validate one native unsigned-16 flag read after mask validation and before bitwise work or writes")

			# Each mutation must be real and rejected, including a caller-local bypass that global token checks miss.
			for strUnsafeSource in [
				strContent.replace("const g_unMaximumNativeSolidFlags = 0xFFFF;", "const g_unMaximumNativeSolidFlags = 0xFFFFFFFF;", 1),
				strContent.replace("GetRequiredEntitySolidFlags(EntityReference);", "g_NativeGetSolidFlags(EntityReference);", 1),
				strContent.replace("if (!Number.isInteger(unSolidFlags) || (unSolidFlags < 0) || (unSolidFlags > g_unMaximumNativeSolidFlags)) {", "if (false) {", 1),
				strContent.replace('throw new TypeError("The native solid-flags getter must return an unsigned 16-bit integer.");', "", 1),
				strContent.replace("const unSolidFlags = g_NativeGetSolidFlags(EntityReference);", "const unSolidFlags = g_NativeGetSolidFlags(EntityReference) ?? 0;", 1),
				strContent.replace("return unSolidFlags;", "return unSolidFlags || 0;", 1),
				strContent.replace("\tconst nRequiredSolidFlags = RequireSolidFlags(nSolidFlags);\n\tconst unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);", "\tconst unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);\n\tconst nRequiredSolidFlags = RequireSolidFlags(nSolidFlags);", 1),
				strContent.replace("\tconst unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);", "\tconst unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);\n\tg_NativeGetSolidFlags(EntityReference);", 1),
			]:
				if (strUnsafeSource == strContent) or HasValidatedCollisionFlagReads(strUnsafeSource):
					return Fail("collision flag-read verifier failed its negative source regression")

			for strRequired in [
				'"GetCollisionGroupConstants", GetEntityCollisionConstantsCallback',
				'"GetSolidTypeConstants", GetEntityCollisionConstantsCallback',
				'"GetSolidFlagConstants", GetEntityCollisionConstantsCallback',
				'"GetCollisionGroup", GetEntityCollisionGroupCallback',
				'"SetCollisionGroup", SetEntityCollisionGroupCallback',
				'"GetSolidType", GetEntitySolidTypeCallback',
				'"SetSolidType", SetEntitySolidTypeCallback',
				'"GetSolidFlags", GetEntitySolidFlagsCallback',
				'"SetSolidFlags", SetEntitySolidFlagsCallback',
				'"GetMinimumBounds", GetEntityMinimumBoundsCallback',
				'"SetMinimumBounds", SetEntityMinimumBoundsCallback',
				'"GetMaximumBounds", GetEntityMaximumBoundsCallback',
				'"SetMaximumBounds", SetEntityMaximumBoundsCallback',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native entities/collisions binding: {strRequired}")

		if strPath == "weapons/engines/csgo.js":
			for strForbidden in [
				"CSGOWeapon",
				"byIndex",
				"catch",
				"return 0;",
				"return false;",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must not fake missing CSGO weapon SDK properties: {strForbidden}")

			if 'module.exports = GetModule("weapons/engines/csgo");' not in strContent:
				return Fail(f"{strPath} must export the native CSGO weapon module directly")

		if strPath == "entities/engines/csgo/csgo.js":
			for strForbidden in [
				"catch",
				"return 0;",
				"return false;",
				"getItemDefinitionIndex(entity) || 0",
				"entities/props",
				"getPropertyInt",
				"setPropertyInt",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must use native item-definition-index access without fake defaults: {strForbidden}")

			if 'module.exports = GetModule("entities/engines/csgo/csgo");' not in strContent:
				return Fail(f"{strPath} must export the native CSGO entity module directly")

			for strRequired in [
				'SetFunction(pIsolate, LocalContext, LocalCSGOEntityEngineModule, "GetEntityItemDefinitionIndex", GetCSGOEntityItemDefinitionIndexCallback',
				'SetFunction(pIsolate, LocalContext, LocalCSGOEntityEngineModule, "SetEntityItemDefinitionIndex", SetCSGOEntityItemDefinitionIndexCallback',
				'InstallModule(pIsolate, LocalContext, LocalSourceJS, "entities/engines/csgo/csgo", LocalCSGOEntityEngineModule)',
			]:
				if strRequired not in strBindings:
					return Fail(f"ModuleBindings.cpp is missing native entities/engines/csgo binding: {strRequired}")

		if strPath == "effects/index.js":
			for strForbidden in [
				"function stringTableValue",
				"String table index is not available",
				"String table value is not available",
				"function stringTableValue(tableName, index, fallback)",
				"return fallback;",
				'"models/error.mdl"',
				"return getString(tableName, numeric) || fallback;",
				"getString(tableName, numeric) || fallback",
			]:
				if strForbidden in strContent:
					return Fail(f"{strPath} must not fake valid stringtable lookups with fallback values: {strForbidden}")

			if ('GetRequiredString("modelprecache"' not in strContent) or ('GetRequiredString("decalprecache"' not in strContent):
				return Fail(f"{strPath} must delegate required Model/Decal stringtable lookup to native GetRequiredString()")

		if strPath in ["entities/data.js", "effects/fields.js"]:
			if "} catch {\n\t\tindexCache = freeze({ branches: {}, groups: {} });\n\t}" in strContent:
				return Fail(f"{strPath} must not hide malformed index.json files behind an empty data index")

		if strPath == "players/helpers.js":
			strForbidden = "const steamId = new SteamID(raw);\n\t\tcandidates.add(steamId.toSteamId2().toLowerCase());"
			if strForbidden in strContent:
				return Fail(f"{strPath} must not hide native SteamID conversion failures inside invalid-input parsing: {strForbidden}")

	PathConsoleVariableTags = ROOT / "packages" / "sourcejs" / "cvars" / "tags.js"
	if "optionalModule" in ReadText(PathConsoleVariableTags):
		return Fail("cvars/tags.js must call the native cvars/tags module directly")

	PathInternalRuntime = ROOT / "packages" / "sourcejs" / "internal" / "runtime.js"
	if "optionalModule" in ReadText(PathInternalRuntime):
		return Fail("internal/runtime.js must not expose optional runtime module fallbacks")

	strCoreUpdate = ReadText(ROOT / "packages" / "sourcejs" / "core" / "update.js")
	for strRequired in [
		"function FetchJSON(strRequestURL, Options, Callback)",
		'if (typeof Callback !== "function")',
		'if (Object.hasOwn(Options, "Blocking"))',
		"HTTPRequestOptions.Blocking = Options.Blocking;",
		"g_CPRRuntime.Get(HTTPRequestOptions, (RequestError, HTTPResponse) => {",
		"Callback(RequestError);",
	]:
		if strRequired not in strCoreUpdate:
			return Fail(f"core/update.js must fetch release metadata through callback-based native cpr with explicit options: {strRequired}")

	for strForbidden in [
		"fetchWithTimeout",
		"typeof fetch",
		"AbortController",
		"function buildValue",
		"buildValue(",
		"SourceJS ${moduleName}.${name} is not available",
		"getModule(moduleName)[name]",
	]:
		if strForbidden in strCoreUpdate:
			return Fail(f"core/update.js must not use JavaScript fetch fallback: {strForbidden}")

	for strRequired in [
		"const NativeBuild = g_UpdateRuntime.GetCurrentBuild();",
		"!NativeBuild || (typeof NativeBuild !== \"object\") || Array.isArray(NativeBuild)",
		'Architecture: RequireNonEmptyString(NativeBuild.Architecture, "Current build architecture")',
		'GitCommit: RequireNonEmptyString(NativeBuild.GitCommit, "Current build Git commit")',
		'Platform: RequireNonEmptyString(NativeBuild.Platform, "Current build platform")',
		'SDKBranch: RequireNonEmptyString(NativeBuild.SDKBranch, "Current build SDK branch")',
		'Version: RequireNonEmptyString(NativeBuild.Version, "Current build version")',
	]:
		if strRequired not in strCoreUpdate:
			return Fail(f"core/update.js must validate native core/update.GetCurrentBuild() metadata: {strRequired}")

	for strRequired in [
		"GetCurrentBuildCallback",
		'SetFunction(pIsolate, LocalContext, LocalCoreUpdateModule, "GetCurrentBuild", GetCurrentBuildCallback, LocalRuntimeData)',
	]:
		if strRequired not in strBindings:
			return Fail(f"native core/update binding missing: {strRequired}")

	strCore = ReadText(ROOT / "packages" / "sourcejs" / "core.js")
	if "g_CPRRuntime.Get({" not in strCore:
		return Fail("core.js must use the mandatory native cpr module for GetPublicIPAddress()")

	for strForbidden in [
		"typeof fetch",
		"await fetch",
		"requires fetch",
	]:
		if strForbidden in strCore:
			return Fail(f"core.js must not use JavaScript fetch fallback: {strForbidden}")

	return 0

def CheckPlayerDirectNativeMethods():
	for strPath in ["players/index.js"]:
		strContent = ReadText(ROOT / "packages" / "sourcejs" / strPath)
		for strForbidden in [
			"SourceJS API is not available for this SDK",
			"const MOVE_TYPE = Object.freeze",
			"const TAKE_DAMAGE = Object.freeze",
			"const PLAYER_STATE = Object.freeze",
			"const ENTITY_EFFECT = Object.freeze",
			"function callPlayer(",
			"quoteCommandArgument",
			"baseClient.setName",
			"player.SetName",
			"typeof runtime.setName",
			"clientCommand(player, `name ",
			"return clientCommand(player, \"kill\", true);",
			"return clientCommand(player, `say ",
			"return clientCommand(player, `say_team ",
		]:
			if strForbidden in strContent:
				return Fail(f"{strPath} still contains player native-method fallback: {strForbidden}")

	strPlayerPackage = ReadText(ROOT / "packages" / "sourcejs" / "players" / "index.js")
	for strRequired in [
		'const g_EntityConstantsRuntime = require("entities/constants");',
		"g_EntityConstantsRuntime.MoveType.NoClip",
		"g_EntityConstantsRuntime.MoveType.Fly",
		"g_EntityConstantsRuntime.MoveType.None",
		"g_EntityConstantsRuntime.MoveType.Walk",
		"g_EntityConstantsRuntime.TakeDamage.No",
		"g_EntityConstantsRuntime.TakeDamage.Yes",
		"g_EntityConstantsRuntime.FL_FROZEN",
		"g_EntityConstantsRuntime.EntityEffects.DimLight",
		"return ResolvePlayerObject(PlayerReference).ExecuteClientCommand(strCommandText, RequireBoolean(bServerSide, \"bServerSide\"));",
		"return ResolvePlayerObject(PlayerReference).Slay();",
		"return ResolvePlayerObject(PlayerReference).Say(strChatMessage);",
		"return ResolvePlayerObject(PlayerReference).SayTeam(strChatMessage);",
		"return ResolvePlayerObject(PlayerReference).Kick(strKickMessage);",
		"return ResolvePlayerObject(PlayerReference).Ban(unBanDuration, bKickPlayer, bWriteBan);",
		"return ResolvePlayerObject(PlayerReference).ChangeTeam(g_TeamsRuntime.GetTeamNumber(TeamReference));",
		"return g_PlayersRuntime.SetName(PlayerReference, strPlayerName);",
		"const ViewAngles = EyeDelta.ConvertVectorToQAngle();",
		"RequireNativePlayer(NativePlayer);",
	]:
		if strRequired not in strPlayerPackage:
			return Fail(f"players/index.js is missing direct native player method call: {strRequired}")

	for strForbidden in [
		"Math.atan2(",
		"Math.sqrt(delta.x",
	]:
		if strForbidden in strPlayerPackage:
			return Fail(f"players/index.js must use native mathlib VectorAngles for view-coordinate conversion: {strForbidden}")

	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nPlayerObjectStart = strBindings.find("v8::Local<v8::Object> MakePlayerObject(")
	nPlayerObjectEnd = strBindings.find("IPlayerInfo* RequirePlayerInformationArgument(", nPlayerObjectStart + 1)
	if (nPlayerObjectStart < 0) or (nPlayerObjectEnd <= nPlayerObjectStart):
		return Fail("ModuleBindings.cpp is missing the native MakePlayerObject source range")

	strPlayerObject = strBindings[nPlayerObjectStart:nPlayerObjectEnd]

	for strRequired in [
		"enum class PlayerLiveProperty",
		"PlayerGetLivePropertyCallback",
		"PlayerSetLiveProperty",
		"bool InstallPlayerLiveProperty(",
		"LocalObject->SetNativeDataProperty(LocalContext, LocalPropertyName, PlayerGetLivePropertyCallback, PlayerSetLiveProperty, v8::Int32::New(pIsolate, nEncodedProperty))",
		"v8::Local<v8::Object> const LocalPlayerObject = MakeEntityObject(pIsolate, LocalContext, nEntityIndex);",
		"constexpr PlayerLivePropertyBinding kPlayerLivePropertyBindings[] = {",
		'{ "Name", PlayerLiveProperty::Name },',
		'{ "Team", PlayerLiveProperty::Team },',
		'{ "Health", PlayerLiveProperty::Health },',
		'{ "Dead", PlayerLiveProperty::Dead },',
		'{ "Origin", PlayerLiveProperty::Origin },',
		"for (auto const& PropertyBinding : kPlayerLivePropertyBindings) {",
		"InstallPlayerLiveProperty(pIsolate, LocalContext, LocalPlayerObject, nEntityIndex, PropertyBinding.m_pszPropertyName, PropertyBinding.m_LiveProperty)",
		"pPlayerInformation->ChangeTeam(nTeamIndex);",
		"pPlayerEntity->SetHealth(nHealth);",
		"pPlayerEntity->SetMaxHealth(nHealth);",
		'" expects an item name and optional integer subtype."',
	]:
		if strRequired not in strBindings:
			return Fail(f"ModuleBindings.cpp is missing live Player property ownership: {strRequired}")

	for strForbidden in [
		'SetString(pIsolate, LocalContext, LocalObject, "name",',
		'SetInteger(pIsolate, LocalContext, LocalObject, "team",',
		'SetInteger(pIsolate, LocalContext, LocalObject, "health",',
		'SetBoolean(pIsolate, LocalContext, LocalObject, "dead",',
		'SetValue(pIsolate, LocalContext, LocalObject, "origin",',
		'SetString(pIsolate, LocalContext, LocalPlayerObject, "Name",',
		'SetInteger(pIsolate, LocalContext, LocalPlayerObject, "Team",',
		'SetInteger(pIsolate, LocalContext, LocalPlayerObject, "Health",',
		'SetBoolean(pIsolate, LocalContext, LocalPlayerObject, "Dead",',
		'SetValue(pIsolate, LocalContext, LocalPlayerObject, "Origin",',
	]:
		if strForbidden in strPlayerObject:
			return Fail(f"ModuleBindings.cpp still installs a Player snapshot property: {strForbidden}")

	return 0

def CheckPlayerConsumersUseLiveState():
	strPlayerFilters = ReadText(ROOT / "packages" / "sourcejs" / "filters" / "players.js")
	for strRequired in [
		"g_NativePlayers.IsConnected(PlayerRecord)",
		"g_NativePlayers.IsFakeClient(PlayerRecord)",
		"g_NativePlayers.GetTeam(PlayerRecord)",
		"g_NativePlayers.GetUserID(PlayerCandidate)",
		"g_NativePlayers.IsDead(PlayerRecord)",
	]:
		if strRequired not in strPlayerFilters:
			return Fail(f"filters/players.js is missing live player-state call: {strRequired}")

	for strForbidden in [
		"player.connected",
		"player.free",
		"player.fakeClient",
		"player.team",
		"player.dead",
		"candidate.userid",
	]:
		if strForbidden in strPlayerFilters:
			return Fail(f"filters/players.js still reads stale player snapshot state: {strForbidden}")

	strMessagesIndex = ReadText(ROOT / "packages" / "sourcejs" / "messages" / "index.js")
	if "g_PlayersRuntime.IsFakeClient(unPlayerIndex)" not in strMessagesIndex:
		return Fail("messages.js must query fake-client state through the native players module")

	for strForbidden in [
		'getModule("players").byIndex(index)',
		"player.fakeClient",
	]:
		if strForbidden in strMessagesIndex:
			return Fail(f"messages.js still reads stale player snapshot state: {strForbidden}")

	return 0

def CheckNoFallbackSmokeContractNames():
	vecFallbackSmokeFiles = sorted((ROOT / "tools").glob("smoke_*fallback*.js"))
	if vecFallbackSmokeFiles:
		return Fail("fallback smoke files must be renamed to strict/runtime/store contracts: " + ", ".join(PathFile.name for PathFile in vecFallbackSmokeFiles))

	strVerifierSource = ReadText(ROOT / "tools" / "verify_project.py")
	vecLegacyContracts = [
		"cvars",
		"filesystem",
		"config_settings",
		"commands",
		"auth",
	]
	for strModuleName in vecLegacyContracts:
		strForbidden = f"smoke_{strModuleName}_fallback.js"
		if strForbidden in strVerifierSource:
			return Fail(f"verifier still references fallback smoke contract: {strForbidden}")

		strForbidden = f"check_{strModuleName}_fallback_smoke"
		if strForbidden in strVerifierSource:
			return Fail(f"verifier still references fallback smoke contract: {strForbidden}")

	return 0

def CheckNoModulePresenceFallbacks():
	for PathFile in sorted((ROOT / "packages" / "sourcejs").rglob("*")):
		if PathFile.suffix != ".js":
			continue

		strContent = ReadText(PathFile)
		for strForbidden in [
			"hasModule(",
			"function hasModule",
		]:
			if strForbidden in strContent:
				return Fail(f"{PathFile.relative_to(ROOT)} must not probe optional native modules with {strForbidden}")

	return 0

def CheckMathLibraryMatrixValueMethods():
	PathMathLibrary = ROOT / "packages" / "sourcejs" / "mathlib.js"
	strContent = ReadText(PathMathLibrary)

	for strDuplicateExtension in [".cjs", ".d.ts"]:
		if PathMathLibrary.with_suffix(strDuplicateExtension).exists():
			return Fail(f"obsolete mathlib duplicate remains: packages/sourcejs/mathlib{strDuplicateExtension}")

	for strClassName in ["Vector", "QAngle", "Quaternion", "RadianEuler", "Plane", "Matrix3x4", "VMatrix"]:
		if f"class {strClassName}" not in strContent:
			return Fail(f"mathlib class {strClassName} missing in {PathMathLibrary.relative_to(ROOT)}")

	for strRequired in [
		"class MatrixBase",
		"IsMathStructureValid()",
		"IsMatrixEqual(MatrixLike) {",
		"class Matrix3x4 extends MatrixBase",
		"class VMatrix extends MatrixBase",
		"[Symbol.iterator]()",
		"GetMatrixComponentOffset(unRowIndex, unColumnIndex) {",
		"RegisterObjectType(strObjectTypeName, ObjectTypeConstructor, {",
		"Size: ObjectTypeConstructor.TYPE_SIZE",
	]:
		if strRequired not in strContent:
			return Fail(f"mathlib live matrix/object contract missing: {strRequired}")

	return 0

def CheckMemoryMathLibraryAddressReadsAreStrict():
	strHelpers = ReadText(ROOT / "packages" / "sourcejs" / "memory" / "helpers.js")
	for strRequired in [
		'return g_HelpersRuntime.Read(unAddress, "int", nAddressOffset);',
		'return g_HelpersRuntime.Read(unAddress, "uint", nAddressOffset);',
		'return g_HelpersRuntime.Read(unAddress, "float", nAddressOffset);',
		'return g_HelpersRuntime.Read(unAddress, "double", nAddressOffset);',
	]:
		if strRequired not in strHelpers:
			return Fail(f"memory/helpers.js must return native memory reads directly: {strRequired}")

	for strForbidden in [
		'Number(read(value, "int", offset) || 0)',
		'Number(read(value, "uint", offset) || 0)',
		'Number(read(value, "float", offset) || 0)',
		'Number(read(value, "double", offset) || 0)',
	]:
		if strForbidden in strHelpers:
			return Fail(f"memory/helpers.js must not coerce native memory read failures to zero: {strForbidden}")

	strMathLibrary = ReadText(ROOT / "packages" / "sourcejs" / "mathlib.js")
	for strRequired in [
		'get Type() {',
		'get SignBits() {',
	]:
		if strRequired not in strMathLibrary:
			return Fail(f"mathlib Plane address reads must return native values directly: {strRequired}")

	for strForbidden in [
		'Number(objMemoryHelpers.Read(this.address, "uchar", 16) || 0)',
		'Number(objMemoryHelpers.Read(this.address, "uchar", 17) || 0)',
		'Number(objMemoryHelpers.Read(pAddress, "uchar", PLANE_TYPE_OFFSET) || 0)',
		'Number(objMemoryHelpers.Read(pAddress, "uchar", PLANE_SIGN_BITS_OFFSET) || 0)',
	]:
		if strForbidden in strMathLibrary:
			return Fail(f"mathlib must not coerce Plane address reads to zero: {strForbidden}")

	strMemory = ReadText(ROOT / "packages" / "sourcejs" / "memory.js")
	for strRequired in [
		"return Read(super.Address, g_DataType.Char, nAddressOffset);",
		"return Read(super.Address, g_DataType.UChar, nAddressOffset);",
		"return Read(super.Address, g_DataType.Short, nAddressOffset);",
		"return Read(super.Address, g_DataType.UShort, nAddressOffset);",
		"return Read(super.Address, g_DataType.Int, nAddressOffset);",
		"return Read(super.Address, g_DataType.UInt, nAddressOffset);",
		"return Read(super.Address, g_DataType.Float, nAddressOffset);",
		"return Read(super.Address, g_DataType.Double, nAddressOffset);",
	]:
		if strRequired not in strMemory:
			return Fail(f"memory.js Address getters must return native reads directly: {strRequired}")

	for strForbidden in [
		"Number(read(this, DataType.char, offset) || 0)",
		"Number(read(this, DataType.uchar, offset) || 0)",
		"Number(read(this, DataType.short, offset) || 0)",
		"Number(read(this, DataType.ushort, offset) || 0)",
		"Number(read(this, DataType.int, offset) || 0)",
		"Number(read(this, DataType.uint, offset) || 0)",
		"Number(read(this, DataType.float, offset) || 0)",
		"Number(read(this, DataType.double, offset) || 0)",
		"Number(read(this.m_unAddress, DataType.Char, addressOffset) || 0)",
		"Number(read(this.m_unAddress, DataType.UChar, addressOffset) || 0)",
		"Number(read(this.m_unAddress, DataType.Short, addressOffset) || 0)",
		"Number(read(this.m_unAddress, DataType.UShort, addressOffset) || 0)",
		"Number(read(this.m_unAddress, DataType.Int, addressOffset) || 0)",
		"Number(read(this.m_unAddress, DataType.UInt, addressOffset) || 0)",
		"Number(read(this.m_unAddress, DataType.Float, addressOffset) || 0)",
		"Number(read(this.m_unAddress, DataType.Double, addressOffset) || 0)",
	]:
		if strForbidden in strMemory:
			return Fail(f"memory.js Address getters must not coerce native memory read failures to zero: {strForbidden}")

	return 0

def CheckColorsAddressReadsAreStrict():
	strColors = ReadText(ROOT / "packages" / "sourcejs" / "colors.js")
	strRequired = 'return Read(this.m_unAddress, "uchar", BigInt(unIndex));'
	if strRequired not in strColors:
		return Fail("colors.js must return address-backed native color component reads directly")

	for strForbidden in [
		'Number(Read(this.m_unAddress, "uchar", index) || 0)',
	]:
		if strForbidden in strColors:
			return Fail("colors.js must not coerce address-backed native color reads to zero")

	return 0

def CheckMathLibraryNativeVectorOperations():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	nStart = strBindings.find("bool GetFiniteFloatFromValue")
	nEnd = strBindings.find("IFileSystem* RequireFilesystemInterface", nStart + 1)
	if (nStart < 0) or (nEnd <= nStart):
		return Fail("native mathlib block not found")

	strMathLibraryBindings = strBindings[nStart:nEnd]
	vecRegisteredMathLibraryNames = re.findall(r'(?:SetFunction|InstallSDKFunction)(?:<[^>]+>)?\(pIsolate, LocalContext, LocalMathLibraryModule, "([^"]+)"', strBindings)
	if not vecRegisteredMathLibraryNames:
		return Fail("native mathlib API has no registered functions")

	if any((not strName) or (not strName[0].isupper()) for strName in vecRegisteredMathLibraryNames):
		return Fail("native mathlib API retains a non-canonical public name")

	for strRequiredName in ["CreateVector", "GetVectorLengthSquared", "NormalizeVector", "MultiplyAddVectors", "GetAngleFromVector", "CreateMatrix3x4FromAxes", "GetVMatrixPosition"]:
		if strRequiredName not in vecRegisteredMathLibraryNames:
			return Fail(f"native mathlib API is missing canonical registration: {strRequiredName}")

	if "FromMaybe(0)" in strMathLibraryBindings:
		return Fail("native mathlib must not coerce failed numeric conversions to zero")

	for strRequired in [
		"GetFiniteFloatFromValue",
		"std::isfinite(dblNumberValue)",
		"mathlib.CreateVector(flX?, flY?, flZ?) expects numeric components.",
		"mathlib.MultiplyAddVectors(FirstVector, SecondVector, flScalar?) expects a finite numeric scalar.",
		"mathlib.GetAngleFromVector(VectorValue, PseudoUp?) expects pseudo-up to be vector-like.",
		"GetVectorLengthSquaredCallback",
		"GetVectorLength2DSquaredCallback",
		"GetVectorLength2DCallback",
		"NormalizeVectorCallback",
		"ComputeVectorDotProductCallback",
		"ComputeVectorCrossProductCallback",
		"ComputeVectorDistanceCallback",
		"ComputeVectorDistanceSquaredCallback",
		"IsVectorWithinBoxCallback",
		"MultiplyAddVectorsCallback",
		"GetDirectionVectorsFromAngleCallback",
		"GetAngleFromVectorCallback",
		"GetPerpendicularVectorsFromVectorCallback",
		"CreateRandomVectorCallback",
		"IsVectorZeroCallback",
		"NegateVectorCallback",
		"ApplyVectorBinaryOperationCallback",
		"CompareVectorLengthCallback",
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetVectorLengthSquared", GetVectorLengthSquaredCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetVectorLength2DSquared", GetVectorLength2DSquaredCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "NormalizeVector", NormalizeVectorCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "ComputeVectorDotProduct", ComputeVectorDotProductCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "ComputeVectorCrossProduct", ComputeVectorCrossProductCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetDirectionVectorsFromAngle", GetDirectionVectorsFromAngleCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetAngleFromVector", GetAngleFromVectorCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetPerpendicularVectorsFromVector", GetPerpendicularVectorsFromVectorCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "CreateRandomVector", CreateRandomVectorCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "AddVectors", ApplyVectorBinaryOperationCallback, LocalAddOperationData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "IsVectorLengthGreaterThan", CompareVectorLengthCallback, LocalGreaterThanComparisonData)',
		'SetInteger(pIsolate, LocalContext, LocalMathLibraryModule, "FLOAT_SIZE", static_cast<int>(sizeof(float)))',
		'SetInteger(pIsolate, LocalContext, LocalMathLibraryModule, "VECTOR_SIZE", static_cast<int>(sizeof(Vector)))',
		'SetInteger(pIsolate, LocalContext, LocalMathLibraryModule, "QANGLE_SIZE", static_cast<int>(sizeof(QAngle)))',
		'SetInteger(pIsolate, LocalContext, LocalMathLibraryModule, "QUATERNION_SIZE", static_cast<int>(sizeof(Quaternion)))',
		'SetInteger(pIsolate, LocalContext, LocalMathLibraryModule, "RADIAN_EULER_SIZE", static_cast<int>(sizeof(RadianEuler)))',
		'SetInteger(pIsolate, LocalContext, LocalMathLibraryModule, "PLANE_SIZE", static_cast<int>(sizeof(cplane_t)))',
		'SetInteger(pIsolate, LocalContext, LocalMathLibraryModule, "MATRIX3X4_SIZE", static_cast<int>(sizeof(matrix3x4_t)))',
		'SetInteger(pIsolate, LocalContext, LocalMathLibraryModule, "VMATRIX_SIZE", static_cast<int>(sizeof(VMatrix)))',
		"VectorValue.LengthSqr()",
		"VectorValue.Length2D()",
		"VectorNormalizeFast(VectorValue)",
		"VectorValue.WithinAABox(MinimumCorner, MaximumCorner)",
		"AngleVectors(AngleValue, &Forward, &Right, &Up)",
		"VectorAngles(VectorValue, PseudoUp, ResultAngle)",
		"VectorAngles(VectorValue, ResultAngle)",
		"VectorVectors(Forward, Right, Up)",
		"RandomValue.Random(flMinimum, flMaximum)",
		"VectorValue.IsZero(flTolerance)",
		"VectorValue.Negate()",
		"VectorValue.IsLengthGreaterThan(flLength)",
		"VectorValue.IsLengthLessThan(flLength)",
	]:
		if strRequired not in strBindings:
			return Fail(f"native mathlib vector operation missing: {strRequired}")

	for strForbidden in [
		"SOURCEJS_RAD2DEG",
		"SOURCEJS_DEG2RAD",
		"MathVectorLength(",
		"MathNormalizeVector",
		"std::sin(",
		"std::cos(",
		"std::atan2(",
		"std::asin(",
	]:
		if strForbidden in strMathLibraryBindings:
			return Fail(f"native mathlib must call Source SDK mathlib instead of manual formula: {strForbidden}")

	strMathLibrary = ReadText(ROOT / "packages" / "sourcejs" / "mathlib.js")
	for strRequired in [
		'const g_MathlibRuntime = GetRawModule("mathlib");',
		"GetRandomVector(flMinimumComponent = 0, flMaximumComponent = 1)",
		"IsVectorZero(VectorValue, flTolerance = 0.01)",
		'const g_unFloatSize = GetNativeTypeSize("FLOAT_SIZE");',
		'typeof dblNumberValue !== "number") || !Number.isFinite(dblNumberValue)',
		'typeof unAddress !== "bigint") || (unAddress < 0n)',
		"g_MathlibRuntime.GetVectorLengthSquared(this)",
		"g_MathlibRuntime.GetVectorLength2DSquared(this)",
		"g_MathlibRuntime.ComputeVectorDistanceSquared(this, OtherVector)",
		"g_MathlibRuntime.MultiplyAddVectors(FirstVector, SecondVector, flNormalizedScalar)",
		"g_MathlibRuntime.AddVectors(this, Operand)",
		"g_MathlibRuntime.SubtractVectors(this, Operand)",
		"g_MathlibRuntime.MultiplyVectors(this, Operand)",
		"g_MathlibRuntime.DivideVectors(this, Operand)",
		'if (typeof g_MathlibRuntime.IsVectorWithinBox === "function")',
	]:
		if strRequired not in strMathLibrary:
			return Fail(f"mathlib direct native vector contract missing: {strRequired}")

	for strForbidden in [
		"const FLOAT_SIZE = 4;",
		"const VECTOR_SIZE = 12;",
		"const QANGLE_SIZE = 12;",
		"const QUATERNION_SIZE = 16;",
		"const RADIAN_EULER_SIZE = 12;",
		"const PLANE_SIZE = 20;",
		"const MATRIX3X4_SIZE = 48;",
		"const VMATRIX_SIZE = 64;",
		"return this.x * this.x + this.y * this.y + this.z * this.z;",
		"return this.x * this.x + this.y * this.y;",
		"const horizontal = Math.sqrt(this.x * this.x + this.y * this.y);",
		"const forward = this.normalized();",
		"const pitch = radians(this.x);",
		"function numberOr",
		"Number(value)",
		"addressString",
		'"address" in value',
		"Math.random()",
		"sub(other)",
		"mul(other)",
		"div(other)",
	]:
		if strForbidden in strMathLibrary:
			return Fail(f"mathlib must not keep fallback, address-wrapper or abbreviated vector API: {strForbidden}")

	return 0

def CheckMathLibraryNativeQuaternionOperations():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strRequired in [
		"GetQuaternionComponentsFromValue",
		"MakeQuaternionObject",
		"ConvertRadianEulerToQuaternionCallback",
		"ConvertQuaternionToRadianEulerCallback",
		"ConvertRadianEulerToQAngleCallback",
		"ConvertQAngleToRadianEulerCallback",
		"AngleQuaternion(RadianEuler(RadianEulerComponents.x, RadianEulerComponents.y, RadianEulerComponents.z), QuaternionResult)",
		"QuaternionAngles(InputQuaternion, ResultRadianEuler)",
		"AngleQuaternion(InputRadianEuler, IntermediateQuaternion)",
		"AngleQuaternion(InputAngle, IntermediateQuaternion)",
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "ConvertRadianEulerToQuaternion", ConvertRadianEulerToQuaternionCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "ConvertQuaternionToRadianEuler", ConvertQuaternionToRadianEulerCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "ConvertRadianEulerToQAngle", ConvertRadianEulerToQAngleCallback, LocalRuntimeData)',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "ConvertQAngleToRadianEuler", ConvertQAngleToRadianEulerCallback, LocalRuntimeData)',
	]:
		if strRequired not in strBindings:
			return Fail(f"native mathlib quaternion/radian operation missing: {strRequired}")

	strMathLibrary = ReadText(ROOT / "packages" / "sourcejs" / "mathlib.js")
	for strRequired in [
		"g_MathlibRuntime.ConvertRadianEulerToQuaternion(RadianEulerValue)",
		"g_MathlibRuntime.ConvertQuaternionToRadianEuler(QuaternionValue)",
		"g_MathlibRuntime.ConvertQAngleToRadianEuler(QAngleValue)",
		"g_MathlibRuntime.ConvertRadianEulerToQAngle(RadianEulerValue)",
	]:
		if strRequired not in strMathLibrary:
			return Fail(f"mathlib must delegate quaternion/radian operation to native mathlib: {strRequired}")

	for strForbidden in [
		"const roll = value.z * 0.5;",
		"const sinr = 2 * (quaternion.w * quaternion.x + quaternion.y * quaternion.z);",
		"Math.sin(",
		"Math.cos(",
	]:
		if strForbidden in strMathLibrary:
			return Fail(f"mathlib must not implement quaternion/radian formulas in JavaScript: {strForbidden}")

	return 0

def CheckMathLibraryNativeMatrixOperations():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	for strRequired in [
		"GetMatrixValuesFromValue",
		"GetMatrix3x4FromValue",
		"GetVMatrixFromValue",
		"MakeMatrixArray",
		"CreateMatrix3x4FromAxesCallback",
		"GetMatrix3x4PositionCallback",
		"GetMatrix3x4AnglesCallback",
		"InvalidateMatrix3x4Callback",
		"CreateIdentityVMatrixCallback",
		"CreateVMatrixFromMatrix3x4Callback",
		"CreateMatrix3x4FromVMatrixCallback",
		"GetVMatrixPositionCallback",
		"GetVMatrixAnglesCallback",
		"ResultMatrix.Init(XAxis, YAxis, ZAxis, Position)",
		"MatrixPosition(MatrixValue, Position)",
		"MatrixAngles(MatrixValue, Angles)",
		"MatrixValue.Invalidate()",
		"IdentityMatrix.Identity()",
		"VMatrix ConvertedMatrix = SourceMatrix",
		"SourceMatrix.Set3x4(ConvertedMatrix)",
		"MatrixValue.GetTranslation(Position)",
		"MatrixAngles(MatrixValue.As3x4(), Angles)",
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "CreateMatrix3x4FromAxes", CreateMatrix3x4FromAxesCallback',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetMatrix3x4Position", GetMatrix3x4PositionCallback',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetMatrix3x4Angles", GetMatrix3x4AnglesCallback',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "InvalidateMatrix3x4", InvalidateMatrix3x4Callback',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "CreateIdentityVMatrix", CreateIdentityVMatrixCallback',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "CreateVMatrixFromMatrix3x4", CreateVMatrixFromMatrix3x4Callback',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "CreateMatrix3x4FromVMatrix", CreateMatrix3x4FromVMatrixCallback',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetVMatrixPosition", GetVMatrixPositionCallback',
		'SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "GetVMatrixAngles", GetVMatrixAnglesCallback',
		'#if !defined(SOURCEJS_OLD_CONSOLE_API)\n\t\tif (!SetFunction(pIsolate, LocalContext, LocalMathLibraryModule, "InvalidateMatrix3x4"',
	]:
		if strRequired not in strBindings:
			return Fail(f"native Source SDK matrix operation missing: {strRequired}")

	strMathLibrary = ReadText(ROOT / "packages" / "sourcejs" / "mathlib.js")
	for strRequired in [
		"g_MathlibRuntime.CreateMatrix3x4FromAxes(XAxis, YAxis, ZAxis, Position)",
		"g_MathlibRuntime.GetMatrix3x4Position(this.ConvertMatrixToArray())",
		"g_MathlibRuntime.GetMatrix3x4Angles(this.ConvertMatrixToArray())",
		"g_MathlibRuntime.InvalidateMatrix3x4(this.ConvertMatrixToArray())",
		"g_MathlibRuntime.CreateIdentityVMatrix()",
		"g_MathlibRuntime.CreateVMatrixFromMatrix3x4(Matrix3x4Value.ConvertMatrixToArray())",
		"g_MathlibRuntime.CreateMatrix3x4FromVMatrix(this.ConvertMatrixToArray())",
		"g_MathlibRuntime.GetVMatrixPosition(this.ConvertMatrixToArray())",
		"g_MathlibRuntime.GetVMatrixAngles(this.ConvertMatrixToArray())",
		'if (typeof g_MathlibRuntime.InvalidateMatrix3x4 === "function")',
		'if (typeof g_MathlibRuntime.CreateIdentityVMatrix === "function")',
	]:
		if strRequired not in strMathLibrary:
			return Fail(f"mathlib must delegate matrix operation to Source SDK binding: {strRequired}")

	for strForbidden in [
		"const sy = Math.sqrt(this.get(0, 0)",
		"degrees(Math.atan2",
		"this.set(3, 0, 0).set(3, 1, 0).set(3, 2, 0).set(3, 3, 1)",
		"return new Vector(this.get(0, 3), this.get(1, 3), this.get(2, 3));",
	]:
		if strForbidden in strMathLibrary:
			return Fail(f"mathlib still implements Source SDK matrix operation in JavaScript: {strForbidden}")

	return 0

def CheckCanonicalNativeSurface():
	strBindings = ReadText(ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp")
	vecRegisteredNames = []
	vecNonCanonicalNames = []
	setRedisContractNames = {
		"close",
		"command",
		"connect",
		"dbsize",
		"decr",
		"del",
		"exists",
		"expire",
		"get",
		"hdel",
		"hexists",
		"hget",
		"hgetall",
		"hlen",
		"hset",
		"incr",
		"incrby",
		"keys",
		"lpop",
		"lpush",
		"lrange",
		"mget",
		"mset",
		"persist",
		"ping",
		"publish",
		"rpop",
		"rpush",
		"sadd",
		"set",
		"smembers",
		"srem",
		"ttl",
		"type",
	}

	for strLine in strBindings.splitlines():
		MatchRegistration = re.search(r'\b(?:(?:Set(?:Record)?Function|InstallSDKFunction)(?:<[^>]+>)?\((?P<Arguments>[^;]*?),\s*|DefineFunction\(\s*)"(?P<Name>[^"]*)"', strLine)
		if MatchRegistration is not None:
			strRegisteredName = MatchRegistration.group("Name")
			strRegistrationArguments = MatchRegistration.group("Arguments") or ""
			bCanonicalName = bool(strRegisteredName) and strRegisteredName[0].isupper()
			bRedisContract = (strRegisteredName in setRedisContractNames) and (re.search(r"\bLocalRedisModule\s*$", strRegistrationArguments) is not None)
			# CommonJS requires this exact global binding; no other lowercase registration is exempt.
			bCommonJSContract = strLine.strip() == 'if (!SetFunction(pIsolate, LocalContext, LocalContext->Global(), "require", RequireCallback, LocalRuntimeData)) {'
			vecRegisteredNames.append(strRegisteredName)
			if not bCanonicalName and not bRedisContract and not bCommonJSContract:
				vecNonCanonicalNames.append(strRegisteredName)

	if not vecRegisteredNames:
		return Fail("ModuleBindings.cpp contains no native function registrations")

	if vecNonCanonicalNames:
		return Fail(f"native public registrations must use PascalCase names, except the external CommonJS global require and documented lowercase Redis methods: {sorted(set(vecNonCanonicalNames))[:8]}")

	for strRequiredName in [
		"CreateWrite",
		"CreateRead",
		"GetBaseMessageConstants",
		"GetMaximumClients",
		"GetMaximumEntities",
		"GetGlobalVariables",
		"GetServerTime",
		"GetServerTick",
		"GetMapName",
		"Create",
		"ResolveBinaryIdentifier",
	]:
		if strRequiredName not in vecRegisteredNames:
			return Fail(f"canonical native registration is missing: {strRequiredName}")

	return 0

def Main():
	vecArguments = sys.argv[1:]
	if vecArguments:
		bHelpRequested = (len(vecArguments) == 1) and (vecArguments[0] in ("-h", "--help"))

		try:
			strScriptPath = os.path.relpath(Path(__file__).resolve(), Path.cwd())
		except (OSError, ValueError):
			strScriptPath = str(Path(__file__).resolve())

		OutputStream = sys.stdout if bHelpRequested else sys.stderr

		if not bHelpRequested:
			print("[ERROR] Project verification does not accept these arguments.", file=OutputStream)

		print(f'Usage: python "{strScriptPath}" [-h | --help]', file=OutputStream)
		print("Without options, verify configured project contracts and package smoke tests.", file=OutputStream)
		return 0 if bHelpRequested else 2

	vecChecks = [
		CheckNoNativeBridge,
		CheckNoDirectExportAliases,
		CheckPublicExportsAreCanonical,
		CheckNoGameSpecificPublicExports,
		CheckCPPStyleFloor,
		CheckNativeNumericConversionsAreStrict,
		CheckPackageManifest,
		CheckPackageModules,
		CheckInstalledPackageCopiesAreFresh,
		CheckCPPModules,
		CheckNativeModuleSurfaceUniqueness,
		CheckRequireAliasContract,
		CheckExamplesDoNotUseAliasDispatch,
		CheckCMakeSources,
		CheckCMakeRequiredLibraries,
		CheckExternalLibraryNativeContract,
		CheckExternalLibrariesExampleSmoke,
		CheckMemoryHookPayloadContract,
		CheckUnusedNativeFunctionsRemoved,
		CheckMemoryHelpersNativeErrors,
		CheckMemoryManagerNativeErrors,
		CheckMemoryManagerSourceModGameData,
		CheckMemoryHooksNativeErrors,
		CheckBitBuffersNativeAPI,
		CheckBitBuffersNativeStrictArguments,
		CheckKeyValuesNativeAPI,
		CheckKeyValuesNativeErrors,
		CheckSteamNativeAPI,
		CheckEngineFacadesDoNotFabricateUnavailableAPI,
		CheckWorkflows,
		CheckSDKSweepContract,
		CheckPluginLifecycleIsolationContract,
		CheckClientConsoleCommandContract,
		CheckPluginBusContract,
		CheckTeamSupportedBranches,
		CheckMessagesShowMenuChunking,
		CheckMessagesNativeErrors,
		CheckStringTablesNativeErrors,
		CheckPlayersVoiceNativeErrors,
		CheckNetChannelNativeErrors,
		CheckEntityPropertiesNativeErrors,
		CheckEntityFactoriesNativeErrors,
		CheckEntityDatamapsNativeErrors,
		CheckEffectsNativeErrors,
		CheckGameRulesNativeErrors,
		CheckNativeVectorValueConversions,
		CheckInterfacesFilesystemNativeErrors,
		CheckSharedUInt64NativeErrors,
		CheckEventsNativeErrors,
		CheckPlayerFactoryNativeErrors,
		CheckRecipientsNativeErrors,
		CheckPlayerHelpersNativeErrors,
		CheckWeaponsNativeErrors,
		CheckEntityLiveScanNativeErrors,
		CheckEntitySingleLookupNativeErrors,
		CheckCapabilityProbes,
		CheckMathLibraryMatrixValueMethods,
		CheckMemoryMathLibraryAddressReadsAreStrict,
		CheckColorsAddressReadsAreStrict,
		CheckMathLibraryNativeVectorOperations,
		CheckMathLibraryNativeQuaternionOperations,
		CheckMathLibraryNativeMatrixOperations,
		CheckCanonicalNativeSurface,
		CheckPhysicsSmoke,
		CheckMemoryMathLibrarySmoke,
		CheckHooksSmoke,
		CheckColorsSmoke,
		CheckAutomaticDocumentationSmoke,
		CheckAPIDocumentationAudit,
		CheckPluginCommandSmoke,
		CheckPluginInformationSmoke,
		CheckPluginInstanceSmoke,
		CheckPluginManagerSmoke,
		CheckPluginsSmoke,
		CheckRuntimeFacadesSmoke,
		CheckCorePackageSmokeTests,
		CheckEffectsBaseSmoke,
		CheckEffectsConstantsSmoke,
		CheckEffectsFieldsSmoke,
		CheckEngineGameRulesSmoke,
		CheckEnginePrecacheSmoke,
		CheckEngineServerSmoke,
		CheckEngineRootSmoke,
		CheckEngineSoundSmoke,
		CheckEngineTraceSmoke,
		CheckPlayerTeamsSmoke,
		CheckEntityConstantsSmoke,
		CheckEntityDataSmoke,
		CheckEntityCollisionsSmoke,
		CheckEntityCSGOEngineSmoke,
		CheckPlayerCoreSmokeTests,
		CheckPlayerHelpersSmoke,
		CheckPlayerEnginesSmoke,
		CheckPlayerCounterStrikeEngineSmoke,
		CheckPlayerVoiceSmoke,
		CheckPlayerConstantsSmoke,
		CheckStudioSmoke,
		CheckAnimationSmoke,
		CheckStudioCacheSmoke,
		CheckStudioConstantsSmoke,
		CheckConsoleVariableSmoke,
		CheckConsoleVariablesStrictSmoke,
		CheckConsoleVariablesNativeStrictGetters,
		CheckKeyValuesSmoke,
		CheckSteamSmoke,
		CheckPathsSmoke,
		CheckFilesystemSmoke,
		CheckFilesystemStrictSmoke,
		CheckPublicSmoke,
		CheckInterfacesSmoke,
		CheckLoggersSmoke,
		CheckStringTablesSmoke,
		CheckStringTableDownloadsSmoke,
		CheckFilterRootSmoke,
		CheckGlobalsSmoke,
		CheckFilterIteratorSmoke,
		CheckEntityFiltersSmoke,
		CheckPlayerFiltersSmoke,
		CheckWeaponFiltersSmoke,
		CheckRecipientFiltersSmoke,
		CheckWeaponSmokeTests,
		CheckEventsSmoke,
		CheckEventListenerSmoke,
		CheckEventResourceSmoke,
		CheckEventVariableSmoke,
		CheckExtensionsSmoke,
		CheckEventManagerSmoke,
		CheckCustomEventsSmoke,
		CheckCustomEventStrictCreation,
		CheckTranslationRootSmoke,
		CheckTranslationManagerSmoke,
		CheckTranslationStringsSmoke,
		CheckTranslationsSmoke,
		CheckSettingsSmoke,
		CheckSettingsMenuSmoke,
		CheckSettingsTypesSmoke,
		CheckPlayerSettingsSmoke,
		CheckSettingsStorageSmoke,
		CheckConfigurationConsoleVariableSmoke,
		CheckConfigurationSettingsRuntimeSmoke,
		CheckPlayerCommandAuthorizationSmoke,
		CheckCommandRuntimeSmoke,
		CheckCommandNativeErrors,
		CheckAuthenticationManagerSmoke,
		CheckAuthenticationStoreSmoke,
		CheckBitBuffersSmoke,
		CheckNetChannelSmoke,
		CheckMessagesSmoke,
		CheckMenusSmoke,
		CheckServerAdministrationSmoke,
		CheckTickListenersSmoke,
		CheckListenersStrictSmoke,
		CheckListenersStrictRuntime,
		CheckNoModulePresenceFallbacks,
		CheckCoreInternalHelpersDirectNativeCalls,
		CheckPlayerDirectNativeMethods,
		CheckPlayerConsumersUseLiveState,
		CheckNoFallbackSmokeContractNames,
	]
	for Check in vecChecks:
		nResult = Check()
		if nResult != 0:
			return nResult

	print("[verify] project contracts passed")

	return 0

if __name__ == "__main__":
	sys.exit(Main())
