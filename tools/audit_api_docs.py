#!/usr/bin/env python3

"""Find missing SourceJS API reference entries, examples and local table links."""

import argparse
from dataclasses import dataclass, field
from functools import lru_cache
import json
from pathlib import Path
import re
import sys
import unicodedata


ROOT = Path(__file__).resolve().parents[1]
API_DIRECTORY = ROOT / "docs" / "api"
PACKAGE_DIRECTORY = ROOT / "packages" / "sourcejs"
BINDINGS = ROOT / "src" / "sourcejs" / "modules" / "ModuleBindings.cpp"
IDENTIFIER = r"[A-Za-z_$][\w$]*"
SYMBOL = rf"{IDENTIFIER}(?:\.{IDENTIFIER})*"
TABLE_CELL = re.compile(r"^(\|[ \t]+)(?:\[`([^`]+)`\]\(#([^)]*)\)|`([^`]+)`)(?=[ \t]+\|)")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})\s*([^\s]*)")
HEADING = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
MODULE_TITLE = re.compile(r'`require\("([^"]+)"\)`')
JS_TOKEN = re.compile(r"//[^\n]*|/\*[\s\S]*?\*/|\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[{}()[\],]")
NATIVE_MODULE = re.compile(r"\b(v8::Local<v8::Object>(?:\s+const)?|(?:const\s+)?auto(?:\s+const)?)\s+(\w+)\s*=\s*MakeModule\(pIsolate\)")
NATIVE_CALL = re.compile(r'\b((?:Set|Install)\w+)(?:<[^\n(]+>)?\(\s*[^,\n]+,\s*[^,\n]+,\s*(\w+)(?:\s*,\s*(?:"([\w]+)"|(\w+)))?')
NATIVE_INSTALLER = re.compile(r'(?m)^(\t+)bool (Install\w+)\([^\n]*?v8::Local<v8::Object>\s+const\s+(\w+)[^\n]*\{[ \t]*$')
NATIVE_NAME = re.compile(r'\bconstexpr [^=;\n]+\b(\w+)(?:\[\])?\s*=\s*"([\w]+)"\s*;')
NATIVE_SETTERS = {"SetFunction", "SetValue", "SetString", "SetBoolean", "SetInteger", "SetNumber", "SetRecordProperty", "SetEntityFactoryFunction", "InstallSDKFunction", "InstallStudioValue", "InstallStudioFunction", "InstallGameRulesFunction"}
TABLE_CODE = re.compile(r"`([^`]+)`")
MODULE_IMPORT = re.compile(r"""\brequire\(["']([^"']+)["']\)""")
DESTRUCTURED_IMPORT = re.compile(r'\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\([^\n]+?\)\s*;?')


def GetSymbol(strLabel):
	Match = re.fullmatch(rf"(?:new )?({SYMBOL})(?:\(.*\))?", strLabel.strip())
	return Match.group(1) if Match else None


def GetHeadingAnchor(strHeading):
	return "".join(strCharacter for strCharacter in strHeading.lower().replace(" ", "-") if strCharacter in "-_" or unicodedata.category(strCharacter)[0] in "LMN")


@dataclass
class Section:
	unLine: int
	unLevel: int
	strTitle: str
	strAnchor: str
	vecText: list = field(default_factory=list)
	vecExamples: list = field(default_factory=list)


@dataclass
class Page:
	PathFile: Path
	vecLines: list
	vecSections: list = field(default_factory=list)
	vecRows: list = field(default_factory=list)
	mapTableSections: dict = field(default_factory=dict)


def ReadPage(PathFile):
	Document = Page(PathFile, PathFile.read_bytes().decode("utf-8").splitlines(keepends=True))
	CurrentSection = None
	setAnchors = set()
	strFence = ""
	bJavaScript = False
	vecExample = []
	for unIndex, strLine in enumerate(Document.vecLines):
		strText = strLine.rstrip("\r\n")
		if unIndex == 0:
			strText = strText.removeprefix("\ufeff")

		MatchFence = FENCE.match(strText)
		if strFence:
			if MatchFence and MatchFence[1].startswith(strFence) and not MatchFence[2]:
				if bJavaScript and CurrentSection:
					CurrentSection.vecExamples.append("".join(vecExample))

				strFence = ""
				vecExample = []
			elif bJavaScript:
				vecExample.append(strLine)

			continue

		if MatchFence:
			strFence = MatchFence[1]
			bJavaScript = MatchFence[2].lower() in {"js", "javascript"}
			continue

		MatchHeading = HEADING.fullmatch(strText)
		if MatchHeading:
			strTitle = MatchHeading[2]
			strBaseAnchor = GetHeadingAnchor(strTitle)
			strAnchor = strBaseAnchor
			unSuffix = 1
			while strAnchor in setAnchors:
				strAnchor = f"{strBaseAnchor}-{unSuffix}"
				unSuffix += 1

			setAnchors.add(strAnchor)
			CurrentSection = Section(unIndex, len(MatchHeading[1]), strTitle, strAnchor)
			Document.vecSections.append(CurrentSection)
			continue

		if CurrentSection:
			CurrentSection.vecText.append(strText)

		if strText.startswith("|"):
			Document.mapTableSections[unIndex] = CurrentSection

		MatchCell = TABLE_CELL.match(strText)
		if MatchCell:
			Document.vecRows.append((unIndex, CurrentSection, MatchCell))

	return Document


def GetSectionSymbol(CurrentSection):
	if CurrentSection.unLevel <= 1:
		return None

	return GetSymbol(CurrentSection.strTitle.strip("`"))


@lru_cache(maxsize=2048)
def GetExampleBody(strCode):
	# An import by itself is not a demonstration. Preserve use sites after destructuring.
	strBody = DESTRUCTURED_IMPORT.sub("", strCode)

	def RemoveNonCode(Match):
		strToken = Match[0]
		if strToken.startswith("`"):
			vecExpressions = re.findall(r"(?<!\\)\$\{([^{}]+)\}", strToken)
			return " " + " ".join(GetExampleBody(strExpression) for strExpression in vecExpressions) + " "

		return " " if len(strToken) > 1 else strToken

	return JS_TOKEN.sub(RemoveNonCode, strBody)


def ExampleUsesSymbol(strCode, strSymbol):
	strBody = GetExampleBody(strCode)
	vecNames = strSymbol.split(".")
	if not re.search(rf"(?<![\w$]){re.escape(vecNames[0])}(?![\w$])", strBody):
		PatternAlias = re.compile(rf"(?<![\w$]){re.escape(vecNames[0])}\s*:\s*({IDENTIFIER})\b")
		for MatchImport in DESTRUCTURED_IMPORT.finditer(strCode):
			MatchAlias = PatternAlias.search(MatchImport[1])
			if MatchAlias and re.search(rf"(?<![\w$]){re.escape(MatchAlias[1])}(?![\w$])", strBody):
				vecNames[0] = MatchAlias[1]
				break

	return all(re.search(rf"(?<![\w$]){re.escape(strName)}(?![\w$])", strBody) for strName in vecNames)


def UpdatePageLinks(Document, bWrite):
	mapSections = {}
	for CurrentSection in Document.vecSections:
		strSymbol = GetSectionSymbol(CurrentSection)
		if strSymbol:
			mapSections.setdefault(strSymbol, []).append(CurrentSection)

	unUpdated = 0
	for unIndex, CurrentSection, MatchCell in Document.vecRows:
		if MatchCell[2] is not None:
			continue

		strLabel = MatchCell[4]
		strSymbol = GetSymbol(strLabel)
		if not strSymbol:
			continue

		strOwner = GetSectionSymbol(CurrentSection) if CurrentSection else None
		# A method table under a class heading must not link to a module function of the same name.
		if strOwner and CurrentSection.strTitle.startswith("`") and "." not in strSymbol:
			strSymbol = f"{strOwner}.{strSymbol}"

		vecTargets = [Target for Target in mapSections.get(strSymbol, []) if Target is not CurrentSection]
		if len(vecTargets) > 1:
			vecTargets = [Target for Target in vecTargets if any(ExampleUsesSymbol(strCode, strSymbol) for strCode in Target.vecExamples)]

		if len(vecTargets) != 1 or not vecTargets[0].strAnchor:
			continue

		Document.vecLines[unIndex] = f"{MatchCell[1]}[`{strLabel}`](#{vecTargets[0].strAnchor})" + Document.vecLines[unIndex][MatchCell.end():]
		unUpdated += 1

	if bWrite and unUpdated:
		Document.PathFile.write_bytes("".join(Document.vecLines).encode("utf-8"))

	return unUpdated


def FindBrokenTableLinks(Document):
	setAnchors = {CurrentSection.strAnchor for CurrentSection in Document.vecSections}
	strPath = Document.PathFile.relative_to(ROOT).as_posix()
	return [
		f"{strPath}:{unIndex + 1}: #{MatchCell[3]}"
		for unIndex, _, MatchCell in Document.vecRows
		if MatchCell[2] is not None and MatchCell[3] not in setAnchors
	]


def ReadObjectEntries(strText, unStart):
	"""Return the outer entries of a literal object; tolerant of nested literals."""
	vecEntries = []
	vecClosers = ["}"]
	unEntryStart = unStart + 1
	mapClosers = {"{": "}", "(": ")", "[": "]"}
	for Match in JS_TOKEN.finditer(strText, unEntryStart):
		strToken = Match[0]
		if strToken in mapClosers:
			vecClosers.append(mapClosers[strToken])
		elif strToken == vecClosers[-1]:
			vecClosers.pop()
			if not vecClosers:
				vecEntries.append(strText[unEntryStart:Match.start()])
				return vecEntries
		elif strToken == "," and len(vecClosers) == 1:
			vecEntries.append(strText[unEntryStart:Match.start()])
			unEntryStart = Match.end()

	return None


def CollectObjectKeys(strText, unStart, setNames, vecUnresolved):
	vecEntries = ReadObjectEntries(strText, unStart)
	if vecEntries is None:
		vecUnresolved.append("unclosed export object")
		return

	for strEntry in vecEntries:
		strEntry = re.sub(r"^(?:\s|//[^\n]*\n|/\*[\s\S]*?\*/)*", "", strEntry)
		if not strEntry.strip():
			continue

		Match = re.match(rf"(?:get |set |async )?(?:({IDENTIFIER})|['\"]({IDENTIFIER})['\"])\s*(?:[:(]|$)", strEntry)
		if Match:
			setNames.add(Match[1] or Match[2])
		else:
			vecUnresolved.append("computed or spread export")


def CollectNativeMembers(strBody, strReceiver, mapInstallers, setActive):
	mapNames = {}
	for strConstant, strName in NATIVE_NAME.findall(strBody):
		mapNames.setdefault(strConstant, set()).add(strName)

	setNames = set()
	for MatchCall in NATIVE_CALL.finditer(strBody):
		strFunction, strTarget, strLiteral, strConstant = MatchCall.groups()
		if strTarget != strReceiver:
			continue

		if strFunction in NATIVE_SETTERS:
			if strLiteral:
				setNames.add(strLiteral)
			else:
				setNames.update(mapNames.get(strConstant, set()))
		elif strFunction in mapInstallers and strFunction not in setActive:
			for strParameter, strInstaller in mapInstallers[strFunction]:
				setNames.update(CollectNativeMembers(strInstaller, strParameter, mapInstallers, setActive | {strFunction}))

	# A local installer can close over the receiver rather than accepting it explicitly.
	PatternLambda = re.compile(r'\b(?:auto(?: const)?|const auto) (\w+) = \[([^\]\n]*)\]\(char const\* const \w+,')
	setWriters = {strReceiver}
	for MatchLambda in PatternLambda.finditer(strBody):
		setCaptures = set(re.findall(r"\b\w+\b", MatchLambda[2]))
		if setWriters.isdisjoint(setCaptures):
			continue

		setWriters.add(MatchLambda[1])
		setNames.update(re.findall(rf'\b{MatchLambda[1]}\("([\w]+)"\s*,', strBody[MatchLambda.end():]))

	return setNames


def CollectNativeExports():
	strSource = BINDINGS.read_text(encoding="utf-8")
	mapInstallers = {}
	for MatchInstaller in NATIVE_INSTALLER.finditer(strSource):
		PatternEnd = re.compile(rf"(?m)^{MatchInstaller[1]}\}}[ \t]*(?:$| catch\b)")
		MatchEnd = PatternEnd.search(strSource, MatchInstaller.end())
		if MatchEnd:
			mapInstallers.setdefault(MatchInstaller[2], []).append((MatchInstaller[3], strSource[MatchInstaller.end():MatchEnd.start()]))

	mapExports = {}
	vecUnresolved = []
	for MatchDeclaration in NATIVE_MODULE.finditer(strSource):
		strReceiver = MatchDeclaration[2]
		MatchInstall = re.compile(rf'\bInstallModule\([^;\n]*?"([^"]+)"\s*,\s*{re.escape(strReceiver)}\)').search(strSource, MatchDeclaration.end())
		if not MatchInstall:
			vecUnresolved.append(f"native receiver {strReceiver}: installation not found")
			continue

		setNames = mapExports.setdefault(MatchInstall[1], set())
		setNames.update(CollectNativeMembers(strSource[MatchDeclaration.end():MatchInstall.start()], strReceiver, mapInstallers, set()))

	return mapExports, vecUnresolved


def CollectPackageExports(strModule, mapNative, setActive, vecUnresolved):
	if strModule in setActive:
		return set()

	PathFile = PACKAGE_DIRECTORY / f"{strModule}.js"
	if not PathFile.is_file():
		PathFile = PACKAGE_DIRECTORY / strModule / "index.js"

	if not PathFile.is_file():
		return set()

	strText = PathFile.read_text(encoding="utf-8")
	setNames = set()
	vecProblems = []
	setActive = setActive | {strModule}
	MatchExport = re.search(r"(?m)^module\.exports\s*=\s*(?:Object\.freeze\(\s*)?", strText)
	if not MatchExport:
		vecProblems.append("nonstandard export assignment")
	elif strText[MatchExport.end():].startswith("{"):
		CollectObjectKeys(strText, MatchExport.end(), setNames, vecProblems)
	else:
		MatchReceiver = re.match(IDENTIFIER, strText[MatchExport.end():])
		if MatchReceiver:
			strReceiver = MatchReceiver[0]
			strEscaped = re.escape(strReceiver)
			vecObjects = list(re.finditer(rf"\b(?:const\s+{strEscaped}\s*=\s*(?:Object\.freeze\(\s*)?|Object\.(?:assign|defineProperties)\(\s*{strEscaped}\s*,\s*)\{{", strText))
			for MatchObject in vecObjects:
				CollectObjectKeys(strText, MatchObject.end() - 1, setNames, vecProblems)

			setNames.update(re.findall(rf"(?m)^\s*{strEscaped}\.({IDENTIFIER})\s*=(?!=)", strText))
			for MatchForward in re.finditer(rf'\bObject\.assign\(\s*{strEscaped}\s*,\s*({IDENTIFIER})\s*\)', strText):
				MatchImport = re.search(rf'\bconst\s+{re.escape(MatchForward[1])}\s*=\s*require\("([^"]+)"\)', strText)
				if MatchImport:
					strForward = MatchImport[1]
					setNames.update(CollectPackageExports(strForward, mapNative, setActive, vecUnresolved))
				else:
					vecProblems.append("dynamic facade merge")

			MatchNative = re.search(rf'\bconst\s+{strEscaped}\s*=\s*Get(?:Raw)?Module\("([^"]+)"\)', strText)
			MatchDirectNative = re.match(r'Get(?:Raw)?Module\("([^"]+)"\)', strText[MatchExport.end():])
			if MatchNative or MatchDirectNative:
				setNames.update(mapNative.get((MatchNative or MatchDirectNative)[1], set()))

			setNames.difference_update(re.findall(rf"\bdelete\s+{strEscaped}\.({IDENTIFIER})", strText))
			PatternDeletionLoop = re.compile(rf"for \(const (\w+) of \[([^\]]*)\]\) \{{\s*delete {strEscaped}\[\1\];\s*\}}")
			for MatchDeletion in PatternDeletionLoop.finditer(strText):
				setNames.difference_update(re.findall(r'"(\w+)"', MatchDeletion[2]))

	if not setNames and not mapNative.get(strModule):
		vecProblems.append("no literal named exports inferred")

	vecUnresolved.extend(f"{strModule}: {strProblem}" for strProblem in sorted(set(vecProblems)))
	return setNames


def GetPublicPackageNames():
	setModules = set()
	for PathFile in PACKAGE_DIRECTORY.rglob("*.js"):
		PathRelative = PathFile.relative_to(PACKAGE_DIRECTORY).with_suffix("")
		vecParts = PathRelative.parts
		if vecParts[0] == "internal" or any(strPart.startswith("_") for strPart in vecParts) or vecParts[-1] in {"impl", "implementation"} or PathRelative.as_posix() == "players/language/cache":
			continue

		if vecParts[-1] == "index":
			if len(vecParts) > 1:
				setModules.add(PathRelative.parent.as_posix())
		else:
			setModules.add(PathRelative.as_posix())

	return setModules


def CollectPages():
	mapPages = {}
	mapByFile = {}
	for PathFile in sorted((ROOT / "docs").rglob("*.md")):
		Document = ReadPage(PathFile)
		mapByFile[PathFile.resolve()] = Document
		MatchTitle = MODULE_TITLE.fullmatch(Document.vecSections[0].strTitle) if Document.vecSections and Document.vecSections[0].unLevel == 1 else None
		if MatchTitle:
			mapPages.setdefault(MatchTitle[1], []).append(Document)

	PathIndex = API_DIRECTORY / "README.md"
	for strLine in mapByFile[PathIndex.resolve()].vecLines:
		Match = re.match(r"^\| `([^`]+)` \| (.+)", strLine)
		if not Match:
			continue

		for strPath in re.findall(r"\[[^]]+\]\(([^)#]+\.md)(?:#[^)]*)?\)", Match[2]):
			Document = mapByFile.get((API_DIRECTORY / strPath).resolve())
			if Document:
				vecPages = mapPages.setdefault(Match[1], [])
				if Document not in vecPages:
					vecPages.append(Document)

	return mapPages, list(mapByFile.values())


def CollectReference(Document):
	setDocumented = set()
	vecExamples = []
	vecParents = []
	for CurrentSection in Document.vecSections:
		while vecParents and vecParents[-1].unLevel >= CurrentSection.unLevel:
			vecParents.pop()

		vecParents.append(CurrentSection)
		if any(strLine.strip() for strLine in CurrentSection.vecText):
			for Parent in vecParents:
				strParentSymbol = GetSectionSymbol(Parent)
				if strParentSymbol:
					setDocumented.add(strParentSymbol)

		for strLine in CurrentSection.vecText:
			Match = re.match(r"^\s*(?:[-*] |\d+\. |Call )?`([^`]+)`[:. \t]+\S", strLine)
			if Match and GetSymbol(Match[1]):
				setDocumented.add(GetSymbol(Match[1]))

			if strLine.startswith("Example:"):
				vecExamples.extend(MatchCode[1] for MatchCode in TABLE_CODE.finditer(strLine) if re.search(r"[=.(]", MatchCode[1]))

		vecExamples.extend(CurrentSection.vecExamples)

	vecHeaders = []
	for unIndex, strLine in enumerate(Document.vecLines):
		if unIndex not in Document.mapTableSections:
			vecHeaders = []
			continue

		vecCells = [strCell.strip() for strCell in re.split(r"(?<!\\)\|", strLine.strip())[1:-1]]
		if not vecHeaders:
			vecHeaders = [strCell.lower() for strCell in vecCells]
			continue

		CurrentSection = Document.mapTableSections[unIndex]
		if not CurrentSection or len(vecCells) != len(vecHeaders) or len(vecCells) < 2:
			continue

		if not any(strCell for strCell in vecCells[1:]) or re.fullmatch(r":?-+:?", vecCells[0]):
			continue

		strOwner = GetSectionSymbol(CurrentSection) if CurrentSection.strTitle.startswith("`") else None
		for unColumn, strCell in enumerate(vecCells):
			strHeader = vecHeaders[unColumn]
			if unColumn == 0 or strHeader in {"alias", "aliases", "compatibility alias", "flat sdk constant", "manager exports", "other export(s)", "setter", "setter contract", "short export", "short name", "whole-value setter"}:
				for MatchCode in TABLE_CODE.finditer(strCell):
					strSymbol = GetSymbol(MatchCode[1])
					if strSymbol:
						setDocumented.add(f"{strOwner}.{strSymbol}" if strOwner and "." not in strSymbol else strSymbol)
			elif strHeader in {"concrete use", "example", "examples"}:
				vecExamples.extend(MatchCode[1] for MatchCode in TABLE_CODE.finditer(strCell))

	return setDocumented, vecExamples


def ReadInventory(PathInventory):
	Inventory = json.loads(PathInventory.read_text(encoding="utf-8-sig"))
	if not isinstance(Inventory, dict) or Inventory.get("Version") != 1 or not isinstance(Inventory.get("Modules"), dict):
		raise ValueError("expected an API inventory with Version=1 and Modules")

	mapModules = {}
	for strModule, vecMembers in Inventory["Modules"].items():
		if not isinstance(vecMembers, list) or not all(isinstance(strName, str) and strName for strName in vecMembers):
			raise ValueError(f"invalid inventory member list: {strModule}")

		mapModules[strModule] = set(vecMembers)

	vecErrors = Inventory.get("Errors", {})
	if not isinstance(vecErrors, dict):
		raise ValueError("expected Errors to be an object")

	return mapModules, [f"{strModule}: {strError}" for strModule, strError in sorted(vecErrors.items())]


def Audit(mapInventory, mapPages, strSelectedModule):
	mapImportedExamples = {}
	mapReference = {}
	for vecPages in mapPages.values():
		for Document in vecPages:
			if Document.PathFile in mapReference:
				continue

			setNames, vecExamples = CollectReference(Document)
			mapReference[Document.PathFile] = setNames, vecExamples
			for strExample in vecExamples:
				for strImport in set(MODULE_IMPORT.findall(strExample)):
					mapImportedExamples.setdefault(strImport, []).append(strExample)

	vecMissingPages = []
	vecMissingDescriptions = []
	vecMissingExamples = []
	unMemberCount = 0
	for strModule, setNames in sorted(mapInventory.items()):
		if strSelectedModule and strSelectedModule != strModule:
			continue

		unMemberCount += len(setNames)
		vecPages = mapPages.get(strModule, [])
		if not vecPages:
			vecMissingPages.append(strModule)
			continue

		setDocumented = set()
		vecExamples = list(mapImportedExamples.get(strModule, []))
		for Document in vecPages:
			setPageSymbols, vecPageExamples = mapReference[Document.PathFile]
			setDocumented.update(setPageSymbols)
			vecExamples.extend(vecPageExamples)

		for strName in sorted(setNames):
			strMember = f"{strModule}::{strName}"
			if strName not in setDocumented:
				vecMissingDescriptions.append(strMember)

			if not any(ExampleUsesSymbol(strCode, strName) for strCode in vecExamples):
				vecMissingExamples.append(strMember)

	return {
		"MemberCount": unMemberCount,
		"MissingPages": vecMissingPages,
		"MissingDescriptions": vecMissingDescriptions,
		"MissingExamples": vecMissingExamples,
	}


def Main():
	Parser = argparse.ArgumentParser(description=__doc__)
	Parser.add_argument("--inventory", type=Path, action="append", default=[], help="runtime snapshot JSON; repeat to union multiple SDKs")
	Parser.add_argument("--module", help="limit the coverage report to this module")
	Parser.add_argument("--json", action="store_true", help="emit a machine-readable report")
	Parser.add_argument("--strict", action="store_true", help="exit 1 if the report finds gaps or incomplete inventory")
	LinkMode = Parser.add_mutually_exclusive_group()
	LinkMode.add_argument("--links-only", action="store_true", help="preview the number of unambiguous links to add")
	LinkMode.add_argument("--write-links", action="store_true", help="add unambiguous same-page table links; do not audit")
	LinkMode.add_argument("--emit-collector", action="store_true", help="print a standalone SourceJS plugin entry file for runtime capture")
	Options = Parser.parse_args()

	try:
		mapPages, vecPages = CollectPages()
		if Options.emit_collector:
			PathCollector = ROOT / "tools" / "collect_api_inventory.js"
			strCollector = PathCollector.read_text(encoding="utf-8")
			setModules = GetPublicPackageNames() | set(mapPages)
			strModuleArray = "[\n" + "".join(f"\t{json.dumps(strModule)},\n" for strModule in sorted(setModules)) + "]"
			print(strCollector.replace("/* Additional module paths */ []", strModuleArray).rstrip())
			return 0

		if Options.links_only or Options.write_links:
			unCount = sum(UpdatePageLinks(Document, Options.write_links) for Document in vecPages)
			print(f"{'Added' if Options.write_links else 'Available'} table links: {unCount}")
			vecBroken = [strLink for Document in vecPages for strLink in FindBrokenTableLinks(Document)]
			for strLink in vecBroken:
				print(f"Broken local table link: {strLink}", file=sys.stderr)

			return int(bool(vecBroken))

		if Options.inventory:
			mapInventory = {}
			vecUnresolved = []
			for PathInventory in Options.inventory:
				mapSnapshot, vecProblems = ReadInventory(PathInventory)
				vecUnresolved.extend(vecProblems)
				for strModule, setNames in mapSnapshot.items():
					mapInventory.setdefault(strModule, set()).update(setNames)
		else:
			mapNative, vecUnresolved = CollectNativeExports()
			mapInventory = {}
			for strModule in sorted(GetPublicPackageNames() | set(mapPages) | set(mapNative)):
				setNames = CollectPackageExports(strModule, mapNative, set(), vecUnresolved)
				if setNames or strModule in mapNative:
					mapInventory[strModule] = setNames or mapNative[strModule]

		if Options.module and Options.module not in mapInventory:
			raise ValueError(f"module not found in inventory: {Options.module}")

		Report = Audit(mapInventory, mapPages, Options.module)
		Report["Inventory"] = "runtime" if Options.inventory else "source literals (union of SDK branches)"
		Report["IncompleteInventory"] = sorted({strProblem for strProblem in vecUnresolved if not Options.module or strProblem.startswith(f"{Options.module}:")})
		if Options.json:
			print(json.dumps(Report, indent=2))
		else:
			print(f"{Report['Inventory']}: {Report['MemberCount']} API entries checked")
			for strKey in ("MissingPages", "MissingDescriptions", "MissingExamples", "IncompleteInventory"):
				print(f"{strKey} ({len(Report[strKey])}):")
				for strProblem in Report[strKey]:
					print(f"  {strProblem}")

		return int(Options.strict and any(Report[strKey] for strKey in ("MissingPages", "MissingDescriptions", "MissingExamples", "IncompleteInventory")))
	except (OSError, UnicodeError, ValueError) as Error:
		print(f"API documentation audit: {Error}", file=sys.stderr)
		return 2


if __name__ == "__main__":
	sys.exit(Main())
