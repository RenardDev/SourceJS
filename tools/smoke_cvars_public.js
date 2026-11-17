"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_mapConVars = new Map();
const g_vecWrites = [];
const g_vecCreations = [];
let g_bRestoreValueSucceeds = true;
let g_RestoreError = null;

const g_CVars = {
	CreateConVar(strName, strValue, strDescription, nFlags, flMinimum, flMaximum) {
		g_vecCreations.push({ Name: strName, Value: strValue, Description: strDescription, Flags: nFlags, Minimum: flMinimum, Maximum: flMaximum });

		if (!g_mapConVars.has(strName)) {
			g_mapConVars.set(strName, { Name: strName, Value: strValue, Exists: true, IsCommand: false, Public: false });
		}

		return g_mapConVars.get(strName);
	},
	SetConVar(strName, strValue) {
		if (g_RestoreError) {
			throw g_RestoreError;
		}

		if (!g_bRestoreValueSucceeds) {
			return false;
		}

		g_vecWrites.push({ Name: strName, Value: strValue });
		g_mapConVars.get(strName).Value = strValue;

		return true;
	},
	GetConCommandBaseRecords() {
		return Array.from(g_mapConVars.values());
	},
};

const g_PublicCVars = {
	FindConVar(strName) {
		return g_mapConVars.get(strName) ?? { Name: strName, Exists: false };
	},
	IsConVarPublic(strName) {
		return g_mapConVars.get(strName)?.Public ?? false;
	},
	SetConVarPublic(strName, bPublic) {
		g_vecWrites.push({ Name: strName, Public: bPublic });
		g_mapConVars.get(strName).Public = bPublic;

		return true;
	},
};

function RequireDependency(strModuleName) {
	g_Assert.equal(strModuleName, "internal/runtime");

	return {
		GetModule(strNativeName) {
			if (strNativeName === "cvars") {
				return g_CVars;
			}

			g_Assert.equal(strNativeName, "cvars/public");

			return g_PublicCVars;
		},
	};
}

const g_strSourcePath = process.argv[2] ?? g_Path.join(__dirname, "../packages/sourcejs/cvars/public.js");
const g_Module = { exports: {} };
g_VM.runInNewContext(g_FileSystem.readFileSync(g_strSourcePath, "utf8"), { module: g_Module, require: RequireDependency }, { filename: g_strSourcePath });
g_Assert.equal(g_Module.exports, g_PublicCVars);

function VerifyRegistrationMutationFailures() {
	const strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8");
	const vecFailureOutcomes = [
		{ Throws: false, Value: false },
		{ Throws: true, Value: new Error("Controlled registration mutation failure") },
		{ Throws: true, Value: null },
		{ Throws: true, Value: undefined },
		{ Throws: true, Value: 0 },
		{ Throws: true, Value: false },
		{ Throws: true, Value: "" },
	];
	let unScenarioCount = 0;
	for (const bOriginallyExisted of [false, true]) {
		for (const strFailingStage of ["Value", "Public"]) {
			for (const FailureOutcome of vecFailureOutcomes) {
				const vecOperations = [];
				let bFailureActive = true;
				let ConVar = bOriginallyExisted ? { Name: "controlled", Value: "original", Exists: true, Public: false } : null;
				const CVarsRuntime = {
					CreateConVar(strName, strValue) {
						vecOperations.push("Create");
						ConVar ??= { Name: strName, Value: strValue, Exists: true, Public: false };

						return ConVar;
					},
					SetConVar(strName, strValue) {
						g_Assert.equal(strName, "controlled");
						vecOperations.push("Value");

						if (bFailureActive && (strFailingStage === "Value")) {
							if (FailureOutcome.Throws) {
								throw FailureOutcome.Value;
							}

							return false;
						}

						ConVar.Value = strValue;

						return true;
					},
				};
				const PublicRuntime = {
					FindConVar() {
						return ConVar ?? { Exists: false };
					},
					IsConVarPublic() {
						return ConVar.Public;
					},
					SetConVarPublic(strName, bPublic) {
						g_Assert.equal(strName, "controlled");
						vecOperations.push("Public");

						if (bFailureActive && (strFailingStage === "Public")) {
							if (FailureOutcome.Throws) {
								throw FailureOutcome.Value;
								}

							return false;
						}

						ConVar.Public = bPublic;

						return true;
					},
				};
				const Module = { exports: {} };
				const RequireRuntime = (strModuleName) => {
					g_Assert.equal(strModuleName, "internal/runtime");

					return {
						GetModule(strNativeName) {
							if (strNativeName === "cvars") {
								return CVarsRuntime;
							}

							g_Assert.equal(strNativeName, "cvars/public");

							return PublicRuntime;
						},
					};
				};
				g_VM.runInNewContext(strSource, { module: Module, require: RequireRuntime }, { filename: g_strSourcePath });

				let bThrew = false;
				let CaughtError;

				try {
					Module.exports.RegisterPublicConVar(" controlled ", "requested");
				} catch (ErrorValue) {
					bThrew = true;
					CaughtError = ErrorValue;
				}

				g_Assert.equal(bThrew, true, `Registration must reject a failed ${strFailingStage} mutation.`);

				if (FailureOutcome.Throws) {
					g_Assert.equal(CaughtError, FailureOutcome.Value);

				} else {
					const strExpectedMessage = (strFailingStage === "Value") ? "Failed to set public ConVar value: controlled" : "Failed to make ConVar public: controlled";
					g_Assert.equal(CaughtError.name, "Error");
					g_Assert.equal(CaughtError.message, strExpectedMessage);
				}

				const vecExpectedOperations = (strFailingStage === "Value") ? ["Create", "Value"] : ["Create", "Value", "Public"];
				g_Assert.deepEqual(vecOperations, vecExpectedOperations);
				g_Assert.equal(Module.exports.GetPublicConVarRegistration("controlled"), null);
				g_Assert.equal(Array.from(Module.exports.GetPublicConVarRegistrationRecords()).length, 0);
				g_Assert.equal(ConVar.Public, false);
				g_Assert.equal(ConVar.Value, ((strFailingStage === "Value") && bOriginallyExisted) ? "original" : "requested");

				bFailureActive = false;
				vecOperations.length = 0;

				const Registration = Module.exports.RegisterPublicConVar("controlled", "retry");
				g_Assert.equal(Module.exports.GetPublicConVarRegistration("controlled"), Registration);
				g_Assert.equal(ConVar.Value, "retry");
				g_Assert.equal(ConVar.Public, true);
				g_Assert.deepEqual(vecOperations, ["Create", "Value", "Public"]);
				g_Assert.equal(Registration.UnregisterPublicConVar(false), true);
				unScenarioCount += 1;
			}
		}
	}

	g_Assert.equal(unScenarioCount, 28);
	console.log("Public ConVar mutation failures 28 profiles passed.");
}

VerifyRegistrationMutationFailures();

function VerifyRegistrationIdentity() {
	const strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8");
	let unScenarioCount = 0;
	for (const strRequestedName of ["RequestedName", "canonical"]) {
		for (const bRestoreConVar of [false, true]) {
			const vecOperations = [];
			const ConVar = { Name: "canonical", Value: "original", Exists: true, Public: false };
			const Description = {
				toString() {
					throw new Error("The package must not coerce a description before native creation.");
				},
			};
			const CVarsRuntime = {
				CreateConVar(strName, Value, DescriptionValue) {
					g_Assert.equal(strName, strRequestedName);
					g_Assert.equal(Value, 7);
					g_Assert.equal(DescriptionValue, Description);
					vecOperations.push("Create");

					return ConVar;
				},
				SetConVar(strName, Value) {
					vecOperations.push({ Name: strName, Value });
					// Only the known small integer and saved string are modeled here.
					ConVar.Value = String(Value);

					return true;
				},
			};
			const PublicRuntime = {
				FindConVar(strName) {
					g_Assert.equal(strName, strRequestedName);
					vecOperations.push("Find");

					return ConVar;
				},
				IsConVarPublic(strName) {
					g_Assert.equal(strName, strRequestedName);
					vecOperations.push("IsPublic");

					return ConVar.Public;
				},
				SetConVarPublic(strName, bPublic) {
					vecOperations.push({ Name: strName, Public: bPublic });
					ConVar.Public = bPublic;

					return true;
				},
			};
			const RequireRuntime = (strModuleName) => {
				g_Assert.equal(strModuleName, "internal/runtime");

				return {
					GetModule(strNativeName) {
						if (strNativeName === "cvars") {
							return CVarsRuntime;
						}

						g_Assert.equal(strNativeName, "cvars/public");

						return PublicRuntime;
					},
				};
			};
			const Module = { exports: {} };
			g_VM.runInNewContext(strSource, { module: Module, require: RequireRuntime }, { filename: g_strSourcePath });

			const Registration = Module.exports.RegisterPublicConVar(` ${strRequestedName} `, 7, Description);
			g_Assert.equal(Registration.Name, "canonical");
			g_Assert.equal(Registration.ConVar, ConVar);
			vecOperations.length = 0;
			g_Assert.equal(Module.exports.GetPublicConVarRegistration(strRequestedName), Registration);
			g_Assert.equal(Module.exports.GetPublicConVarRegistration(strRequestedName.toUpperCase()), null);
			g_Assert.equal(vecOperations.length, 0, "Registry lookup must not call the native runtime.");
			g_Assert.equal(Module.exports.UnregisterPublicConVar(strRequestedName, bRestoreConVar), true);
			g_Assert.equal(Module.exports.GetPublicConVarRegistration(strRequestedName), null);
			g_Assert.equal(Array.from(Module.exports.GetPublicConVarRegistrationRecords()).length, 0);
			g_Assert.deepEqual(vecOperations, bRestoreConVar ? [{ Name: "canonical", Value: "original" }, { Name: "canonical", Public: false }] : []);
			g_Assert.equal(ConVar.Value, bRestoreConVar ? "original" : "7");
			g_Assert.equal(ConVar.Public, !bRestoreConVar);

			const Replacement = Module.exports.RegisterPublicConVar(strRequestedName, 7, Description);
			const Unmanaged = new Module.exports.PublicConVarRegistration(ConVar, true, "original", false);
			vecOperations.length = 0;
			g_Assert.equal(Registration.UnregisterPublicConVar(false), false);
			g_Assert.equal(Unmanaged.UnregisterPublicConVar(false), false);
			g_Assert.equal(Module.exports.GetPublicConVarRegistration(strRequestedName), Replacement);
			g_Assert.equal(vecOperations.length, 0, "Restore-disabled stale/unmanaged cleanup must not mutate native state.");
			g_Assert.equal(Replacement.UnregisterPublicConVar(false), true);
			unScenarioCount += 1;
		}
	}

	g_Assert.equal(unScenarioCount, 4);
	console.log("Public ConVar identity cleanup 4 profiles passed; controlled native names, not an engine alias probe.");
}

VerifyRegistrationIdentity();

const g_ExistingConVar = { Name: "hostname", Value: "original", Public: false, Exists: true, IsCommand: false };
g_mapConVars.set(g_ExistingConVar.Name, g_ExistingConVar);

const g_ExistingRegistration = g_PublicCVars.RegisterPublicConVar(" hostname ", "temporary", "Description", { Flags: 0x08, MinimumValue: 0, MaximumValue: 100 });
g_Assert.ok(g_ExistingRegistration instanceof g_PublicCVars.PublicConVarRegistration);
g_Assert.equal(g_ExistingRegistration.ConVar, g_ExistingConVar);
g_Assert.equal(g_ExistingRegistration.Name, "hostname");
g_Assert.equal(g_ExistingRegistration.OriginallyExisted, true);
g_Assert.equal(g_ExistingRegistration.OriginalValue, "original");
g_Assert.equal(g_ExistingRegistration.OriginallyPublic, false);
g_Assert.equal(g_ExistingConVar.Value, "temporary");
g_Assert.equal(g_ExistingConVar.Public, true);
g_Assert.deepEqual(g_vecCreations.at(-1), { Name: "hostname", Value: "temporary", Description: "Description", Flags: 0x08, Minimum: 0, Maximum: 100 });
g_Assert.equal(g_PublicCVars.GetPublicConVarRegistration(" hostname "), g_ExistingRegistration);
g_Assert.throws(() => g_PublicCVars.RegisterPublicConVar("hostname"), /already registered/);

g_bRestoreValueSucceeds = false;
g_Assert.equal(g_ExistingRegistration.UnregisterPublicConVar(), false);
g_Assert.equal(g_PublicCVars.GetPublicConVarRegistration("hostname"), g_ExistingRegistration);
g_Assert.equal(g_ExistingConVar.Public, true);
g_bRestoreValueSucceeds = true;
g_RestoreError = new Error("Controlled native restoration failure");
g_Assert.throws(() => g_ExistingRegistration.UnregisterPublicConVar(), (ErrorValue) => ErrorValue === g_RestoreError);
g_Assert.equal(g_PublicCVars.GetPublicConVarRegistration("hostname"), g_ExistingRegistration);
g_RestoreError = null;
g_Assert.equal(g_ExistingRegistration.UnregisterPublicConVar(), true);
g_Assert.equal(g_ExistingConVar.Value, "original");
g_Assert.equal(g_ExistingConVar.Public, false);
g_Assert.equal(g_PublicCVars.GetPublicConVarRegistration("hostname"), null);

const g_NewRegistration = g_PublicCVars.RegisterPublicConVar("new_variable");
g_Assert.equal(g_NewRegistration.OriginallyExisted, false);
g_Assert.equal(g_NewRegistration.OriginalValue, null);
g_Assert.equal(g_NewRegistration.ConVar.Value, "0");
g_Assert.deepEqual(g_vecCreations.at(-1), { Name: "new_variable", Value: "0", Description: "", Flags: 0, Minimum: null, Maximum: null });
g_NewRegistration.ConVar.Value = "keep-new-value";
g_Assert.equal(g_NewRegistration.UnregisterPublicConVar(), true);
g_Assert.equal(g_NewRegistration.ConVar.Value, "keep-new-value");
g_Assert.equal(g_NewRegistration.ConVar.Public, false);

g_ExistingConVar.Public = true;
const g_PublicRegistration = g_PublicCVars.RegisterPublicConVar("hostname", "published");
g_Assert.equal(g_PublicRegistration.OriginallyPublic, true);
g_Assert.equal(g_PublicRegistration.RestoreOriginalConVarState(), true);
g_Assert.equal(g_ExistingConVar.Public, true);
g_Assert.equal(g_PublicCVars.GetPublicConVarRegistration("hostname"), g_PublicRegistration);
const g_unWriteCount = g_vecWrites.length;
g_Assert.equal(g_PublicCVars.UnregisterPublicConVar("hostname", false), true);
g_Assert.equal(g_vecWrites.length, g_unWriteCount);
g_Assert.equal(g_PublicCVars.UnregisterPublicConVar("hostname"), false);

const g_LastRegistration = g_PublicCVars.RegisterPublicConVar("last_variable", "7");
const g_itRegistration = g_PublicCVars.GetPublicConVarRegistrationRecords();
g_Assert.deepEqual(Array.from(g_itRegistration), [g_LastRegistration]);
g_mapConVars.set("hidden", { Name: "hidden", Exists: true, IsCommand: false, Public: false });
g_mapConVars.set("command", { Name: "command", Exists: true, IsCommand: true, Public: true });
g_mapConVars.set("missing", { Name: "missing", Exists: false, IsCommand: false, Public: true });
g_Assert.deepEqual(Array.from(g_PublicCVars.GetPublicConVars(), (ConVar) => ConVar.Name), ["hostname", "last_variable"]);

for (const strName of ["ConVar", "Name", "OriginallyExisted", "OriginalValue", "OriginallyPublic"]) {
	const Descriptor = Object.getOwnPropertyDescriptor(g_PublicCVars.PublicConVarRegistration.prototype, strName);
	g_Assert.equal(typeof Descriptor.get, "function");
	g_Assert.equal(Descriptor.set, undefined);
	g_Assert.equal(Descriptor.enumerable, false);
	g_Assert.equal(Descriptor.configurable, true);
}

const g_unWritesBeforeInvalidNames = g_vecWrites.length;
const g_unCreationsBeforeInvalidNames = g_vecCreations.length;
const g_unNativeConVarsBeforeInvalidNames = g_mapConVars.size;
const g_unRegistrationsBeforeInvalidNames = Array.from(g_PublicCVars.GetPublicConVarRegistrationRecords()).length;

for (const NameValue of [null, 0, "", "  ", "\0", "hostname\0suffix", " new_variable\0suffix "]) {
	g_Assert.throws(() => g_PublicCVars.RegisterPublicConVar(NameValue), { name: "TypeError" });
	g_Assert.throws(() => g_PublicCVars.GetPublicConVarRegistration(NameValue), { name: "TypeError" });
	g_Assert.throws(() => g_PublicCVars.UnregisterPublicConVar(NameValue), { name: "TypeError" });
}

g_Assert.equal(g_vecWrites.length, g_unWritesBeforeInvalidNames);
g_Assert.equal(g_vecCreations.length, g_unCreationsBeforeInvalidNames);
g_Assert.equal(g_mapConVars.size, g_unNativeConVarsBeforeInvalidNames);
g_Assert.equal(Array.from(g_PublicCVars.GetPublicConVarRegistrationRecords()).length, g_unRegistrationsBeforeInvalidNames);

for (const Options of [null, [], true]) {
	g_Assert.throws(() => g_PublicCVars.RegisterPublicConVar("invalid_options", "0", "", Options), { name: "TypeError" });
}

g_Assert.throws(() => g_LastRegistration.UnregisterPublicConVar("yes"), { name: "TypeError" });
g_Assert.equal(g_PublicCVars.UnregisterPublicConVar("last_variable"), true);
g_Assert.equal(Array.from(g_PublicCVars.GetPublicConVarRegistrationRecords()).length, 0);

console.log("Public ConVar smoke checks passed (actual JS registration helper; native ConVar doubles, no engine IO).");
