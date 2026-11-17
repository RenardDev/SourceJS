#!/usr/bin/env node

"use strict";

const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strDumpsPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "core", "dumps.js");
const g_unDerivedDataMapAddress = 0x1000n;
const g_unBaseDataMapAddress = 0x2000n;

const g_mapWrittenFiles = new Map();
const g_vecEnsuredDirectories = [];
const g_vecCVarRecords = [];
const g_vecDataMapSelectors = [];

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertIncludes(strText, strExpectedText, strErrorMessage) {
	if ((typeof strText !== "string") || !strText.includes(strExpectedText)) {
		throw new Error(`${strErrorMessage}: missing ${JSON.stringify(strExpectedText)}`);
	}
}

function AssertThrows(Callback, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert(CaughtError instanceof Error, strErrorMessage);
}

const g_CVars = {
	AddConVarRecord(strName, strValue = "0", strHelp = "", unFlags = 0) {
		if ((typeof strName !== "string") || (typeof strValue !== "string") || (typeof strHelp !== "string") || !Number.isInteger(unFlags)) {
			throw new TypeError("CVar records require strict values.");
		}

		const Record = { Exists: true, IsCommand: false, DefaultValue: strValue, Help: strHelp, Name: strName, Type: "cvar", Value: strValue, Flags: unFlags };
		g_vecCVarRecords.push(Record);

		return Record;
	},
	GetConCommandBaseRecords() {
		return g_vecCVarRecords;
	},
};

const g_vecModuleNames = ["core", "core/dumps", "weapons"];
const g_Core = {
	GetModules() {
		return g_vecModuleNames;
	},
};

globalThis.sourcejs = {
	core: g_Core,
	"core/dumps": {
		EnsureDirectoryExists(strDirectoryPath) {
			g_vecEnsuredDirectories.push(strDirectoryPath);

			return true;
		},
		Root: "C:/game/logs/sourcejs",
		WriteTextFile(strFilePath, strText) {
			g_mapWrittenFiles.set(strFilePath, strText);

			return true;
		},
	},
	cvars: g_CVars,
	entities: {
		GetAllEntities() {
			return [{ ClassName: "prop_physics", Index: 11, Valid: true }];
		},
	},
	"entities/classes": {
		GetEntityClassNames() {
			return ["CBaseEntity"];
		},
	},
	"entities/datamaps": {
		GetEntityDataMap(DataMapSelector) {
			g_vecDataMapSelectors.push(DataMapSelector);

			if (DataMapSelector === "CBaseEntity") {
				return { Address: g_unDerivedDataMapAddress, BaseAddress: g_unBaseDataMapAddress, ClassName: "CBaseEntity" };
			}

			if (DataMapSelector === g_unBaseDataMapAddress) {
				return { Address: g_unBaseDataMapAddress, BaseAddress: 0n, ClassName: "Base" };
			}

			throw new TypeError("Unexpected datamap selector in the dump fixture.");
		},
		GetEntityDataMapFields(DataMap, bRecursive) {
			AssertEqual(DataMap.Address, g_unDerivedDataMapAddress, "datamap field source address");
			AssertEqual(DataMap.BaseAddress, g_unBaseDataMapAddress, "datamap field base address");
			AssertEqual(bRecursive, true, "datamap fields include base fields");

			return [{ Name: "m_iHealth", Type: "int" }];
		},
	},
	"entities/props": {
		GetServerClassProperties() {
			return [{ Name: "m_vecOrigin", Type: "vector" }];
		},
		GetServerClasses() {
			return [{ Name: "CBaseEntity", Table: { Name: "DT_BaseEntity" } }];
		},
	},
	stringtables: {
		GetAllStringTables() {
			return [{ Count: 2, Name: "downloadables" }];
		},
	},
	weapons: {
		GetAllWeapons() {
			return [{ ClassName: "weapon_smg", Index: 22 }];
		},
		GetClasses() {
			return ["weapon_smg"];
		},
		GetNames() {
			return ["smg"];
		},
	},
};

function VerifyRuntimeDumpProvenanceAndBigInt(Dumps) {
	const NativeEntities = globalThis.sourcejs.entities;
	const OriginalGetAllEntities = NativeEntities.GetAllEntities;
	const unMaximumAddress = (1n << 64n) - 1n;
	const nMinimumValue = -(1n << 63n);
	try {
		NativeEntities.GetAllEntities = () => [{ ClassName: "exact_values", Address: unMaximumAddress, Metadata: { Address: unMaximumAddress, Minimum: nMinimumValue, Nested: [0n, unMaximumAddress] } }];
		const strPath = Dumps.DumpEntities("nested-native-values");
		const strText = g_mapWrittenFiles.get(strPath);
		AssertIncludes(strText, `Address=${unMaximumAddress}`, "top-level address remains exact");
		const Metadata = JSON.parse(strText.split("Metadata=")[1].trim());
		AssertEqual(BigInt(Metadata.Address), unMaximumAddress, "nested uint64 address remains exact");
		AssertEqual(BigInt(Metadata.Minimum), nMinimumValue, "nested int64 value remains exact");
		AssertEqual(BigInt(Metadata.Nested[0]), 0n, "nested zero remains exact");
		AssertEqual(BigInt(Metadata.Nested[1]), unMaximumAddress, "array uint64 value remains exact");
	} finally {
		NativeEntities.GetAllEntities = OriginalGetAllEntities;
	}

	let unCases = 1;
	const strHeader = "# Generated by core/dumps; regenerate this runtime snapshot instead of editing it.\n";
	for (const strName of ["DumpClassInfo", "DumpConVars", "DumpDataMaps", "DumpEntities", "DumpServerClasses", "DumpStringTables", "DumpWeaponScripts"]) {
		const strPath = Dumps[strName]("generated/" + strName);
		Assert(g_mapWrittenFiles.get(strPath).startsWith(strHeader), "each runtime dump marks its generated ownership");
		unCases += 1;
	}

	const strCustomPath = Dumps.WriteDump("custom-unmarked", "user report");
	AssertEqual(g_mapWrittenFiles.get(strCustomPath), "user report", "generic WriteDump does not decorate caller content");
	unCases += 1;
	console.log(`[smoke_core_dumps] Runtime dump metadata/BigInt ${unCases} profiles passed`);
}

function VerifyModuleDocumentationSnapshot() {
	const strSourcePath = g_Path.join(g_strProjectRoot, "packages/sourcejs/core/command/docs.js");
	const vecModuleNames = ["zeta", "empty", "core"];
	const vecWrites = [];
	const vecLogs = [];
	const mapCommands = new Map();
	const Failure = { Stage: "Injected" };
	let strFailureStage = "NONE";
	const MaybeFail = (strStage) => {
		if (strFailureStage === strStage) {
			throw Failure;
		}
	};
	const ZetaModule = Object.assign(Object.create({ Inherited: true }), { Zed: true, Alpha: false });
	Object.defineProperty(ZetaModule, "Hidden", { value: true });
	const CoreRuntime = {
		GetModules() {
			MaybeFail("LIST");

			return vecModuleNames;
		},
	};
	const mapModules = new Map([
		["core", CoreRuntime],
		["empty", {}],
		["zeta", ZetaModule],
	]);
	const Dependencies = {
		"core/command": {
			CORE_COMMAND: {
				RegisterCommand(vecPath, Callback) {
					mapCommands.set(vecPath.join(" "), Callback);
				},
				LogCommandMessage(strMessage) {
					MaybeFail("LOG");
					vecLogs.push(strMessage);
				},
			},
		},
		"core/dumps": {
			WriteDump(strName, strText) {
				MaybeFail("WRITE");

				if ((typeof strName !== "string") || (strName.length === 0)) {
					throw new TypeError("Dump file name must be non-empty.");
				}

				vecWrites.push({ Name: strName, Text: strText });

				return `dumps/${strName}.txt`;
			},
		},
		"internal/runtime": {
			GetModule(strName) {
				MaybeFail("LOOKUP");
				Assert(mapModules.has(strName), "documentation resolves registered modules only");

				return mapModules.get(strName);
			},
		},
	};
	const Module = { exports: {} };
	const RequireDependency = (strName) => {
		Assert(Object.hasOwn(Dependencies, strName), "unexpected documentation dependency");

		return Dependencies[strName];
	};
	g_VM.runInNewContext(g_FileSystem.readFileSync(strSourcePath, "utf8"), { module: Module, require: RequireDependency }, { filename: strSourcePath });
	const Documentation = Module.exports;
	AssertEqual(Documentation.MODULE_NAME, "core/command/docs", "documentation module identity");
	AssertEqual(mapCommands.size, 1, "one documentation command registration");
	AssertEqual(Documentation.GenerateModuleDocumentation("diagnostics/modules"), "dumps/diagnostics/modules.txt", "documentation output path");
	const strExpectedMarker = "<!-- Generated by core/command/docs.GenerateModuleDocumentation; regenerate this runtime-module export snapshot instead of editing it. -->";
	const strExpectedBody = "# SourceJS Runtime Modules\n\n## core\n\nGetModules\n\n## empty\n\n\n\n## zeta\n\nAlpha, Zed\n";
	AssertEqual(vecWrites[0].Text, `${strExpectedMarker}\n${strExpectedBody}`, "generated marker precedes the unchanged sorted snapshot body");
	AssertEqual(vecModuleNames.join(","), "zeta,empty,core", "module sorting does not mutate its input");
	AssertEqual(vecLogs[0], "Documentation written to dumps/diagnostics/modules.txt", "documentation path log");
	let unCases = 1;
	AssertEqual(Documentation.GenerateModuleDocumentation(), "dumps/sourcejs-runtime-modules.txt", "default documentation name");
	unCases += 1;
	for (const vecArguments of [[], [""], ["custom/path"]]) {
		const strPath = mapCommands.get("docs generate")({ CommandArguments: vecArguments });
		AssertEqual(strPath, `dumps/${vecArguments[0] || "sourcejs-runtime-modules"}.txt`, "documentation command filename selection");
		unCases += 1;
	}

	AssertThrows(() => Documentation.GenerateModuleDocumentation(""), "direct empty filename reaches dump validation");
	unCases += 1;
	for (const strStage of ["LIST", "LOOKUP", "WRITE", "LOG"]) {
		strFailureStage = strStage;
		let bThrew = false;
		try {
			Documentation.GenerateModuleDocumentation("failure");
		} catch (CaughtFailure) {
			bThrew = true;
			AssertEqual(CaughtFailure, Failure, "documentation propagates the exact stage failure");
		}

		Assert(bThrew, "documentation stage failure propagates");
		unCases += 1;
	}

	console.log(`[smoke_core_dumps] Module documentation ${unCases} profiles passed`);
}

try {
	const Dumps = require(g_strDumpsPath);

	g_CVars.AddConVarRecord("sjs_dump_test", "42", "Dump test cvar", 7);
	AssertEqual(Dumps.ResolveDumpPath("manual"), "C:/game/logs/sourcejs/manual.txt", "relative dump path");
	AssertEqual(Dumps.WriteDump("manual", "hello"), "C:/game/logs/sourcejs/manual.txt", "WriteDump path");
	Assert(g_vecEnsuredDirectories.includes("C:/game/logs/sourcejs"), "WriteDump output directory");
	AssertEqual(g_mapWrittenFiles.get("C:/game/logs/sourcejs/manual.txt"), "hello", "WriteDump text");
	AssertEqual(Dumps.WriteDump("numeric", 42n), "C:/game/logs/sourcejs/numeric.txt", "WriteDump generic-value path");
	AssertEqual(g_mapWrittenFiles.get("C:/game/logs/sourcejs/numeric.txt"), "42", "WriteDump converts a bigint value to text");

	const strConVarsPath = Dumps.DumpConVars();
	const strServerClassesPath = Dumps.DumpServerClasses();
	const strDataMapsPath = Dumps.DumpDataMaps();
	const strStringTablesPath = Dumps.DumpStringTables();
	const strWeaponsPath = Dumps.DumpWeaponScripts();
	const strEntitiesPath = Dumps.DumpEntities();
	const strClassInformationPath = Dumps.DumpClassInfo();

	AssertIncludes(g_mapWrittenFiles.get(strConVarsPath), "sjs_dump_test - VAR - flags 7", "DumpConVars record");
	AssertIncludes(g_mapWrittenFiles.get(strConVarsPath), "Dump test cvar", "DumpConVars help");
	AssertIncludes(g_mapWrittenFiles.get(strServerClassesPath), "CBaseEntity -> DT_BaseEntity", "DumpServerClasses class");
	AssertIncludes(g_mapWrittenFiles.get(strServerClassesPath), "m_vecOrigin", "DumpServerClasses prop");
	AssertIncludes(g_mapWrittenFiles.get(strServerClassesPath), "vector", "DumpServerClasses canonical type name");
	AssertIncludes(g_mapWrittenFiles.get(strDataMapsPath), "CBaseEntity -> Base", "DumpDataMaps class");
	AssertIncludes(g_mapWrittenFiles.get(strDataMapsPath), "m_iHealth", "DumpDataMaps field");
	AssertEqual(g_vecDataMapSelectors.length, 2, "derived and base datamap lookups");
	AssertEqual(g_vecDataMapSelectors[0], "CBaseEntity", "derived datamap class selector");
	AssertEqual(g_vecDataMapSelectors[1], g_unBaseDataMapAddress, "base datamap lookup uses an exact BigInt address");
	AssertIncludes(g_mapWrittenFiles.get(strStringTablesPath), "downloadables", "DumpStringTables table");
	AssertIncludes(g_mapWrittenFiles.get(strWeaponsPath), "weapon_smg", "DumpWeaponScripts class");
	AssertIncludes(g_mapWrittenFiles.get(strWeaponsPath), "smg", "DumpWeaponScripts name");
	AssertIncludes(g_mapWrittenFiles.get(strEntitiesPath), "prop_physics", "DumpEntities entity");
	AssertIncludes(g_mapWrittenFiles.get(strClassInformationPath), "core/dumps", "DumpClassInfo module");
	AssertEqual(Object.hasOwn(Dumps, "moduleName"), false, "core/dumps should not expose moduleName");

	VerifyRuntimeDumpProvenanceAndBigInt(Dumps);
	g_vecModuleNames.splice(0, g_vecModuleNames.length, "missing/module");
	AssertThrows(() => Dumps.DumpClassInfo("missing"), "DumpClassInfo should reject an unavailable native module");

	VerifyModuleDocumentationSnapshot();
	console.log("[smoke_core_dumps] ok");
} finally {
	delete globalThis.sourcejs;
}
