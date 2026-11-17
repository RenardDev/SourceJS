#!/usr/bin/env node

"use strict";

const g_Path = require("node:path");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strCVarsPath = g_Path.join(g_strPackageRoot, "cvars.js");
const g_strConVarPath = g_Path.join(g_strPackageRoot, "cvars", "convar.js");
const g_unDecimalRadix = 10;

const g_mapRecords = new Map();
let g_unNextAddress = 0x7000n;

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

function AssertThrowsMessage(Callback, strExpectedMessage, strErrorMessage) {
	try {
		Callback();
	} catch (ErrorValue) {
		AssertEqual(ErrorValue.message, strExpectedMessage, strErrorMessage);
		return;
	}

	throw new Error(`${strErrorMessage}: expected ${strExpectedMessage}`);
}

function RequireName(strName) {
	if ((typeof strName !== "string") || (strName.length === 0)) {
		throw new TypeError("ConVar name must be a non-empty string.");
	}

	return strName;
}

function RequireRecord(strName) {
	const strSelectedName = RequireName(strName);
	const Record = g_mapRecords.get(strSelectedName);
	if (!Record) {
		throw new Error(`ConVar not found: ${strSelectedName}`);
	}

	return Record;
}

function GetConVarRecord(strName) {
	const Record = g_mapRecords.get(RequireName(strName));
	if (!Record) {
		return { Exists: false };
	}

	return {
		Exists: true,
		MaximumValue: Record.MaximumValue,
		MinimumValue: Record.MinimumValue,
		IntValue: Number.parseInt(Record.Value, g_unDecimalRadix),
		Address: Record.Address,
		DefaultValue: Record.DefaultValue,
		Help: Record.Help,
		Name: strName,
		Value: Record.Value,
		Flags: Record.Flags,
	};
}

const g_CVars = {
	AddConVarFlags(strName, nFlags) {
		if (!Number.isInteger(nFlags)) {
			throw new TypeError("ConVar flags must be integers.");
		}

		RequireRecord(strName).Flags |= nFlags;

		return true;
	},
	CreateConVar(strName, strValue = "0", strDescription = "", nFlags = 0, flMinimumValue = null, flMaximumValue = null) {
		RequireName(strName);

		if ((typeof strValue !== "string") || (typeof strDescription !== "string") || !Number.isInteger(nFlags)) {
			throw new TypeError("ConVar creation values are invalid.");
		}

		if (!g_mapRecords.has(strName)) {
			g_mapRecords.set(strName, { DefaultValue: strValue, Flags: nFlags, Help: strDescription, MaximumValue: flMaximumValue, MinimumValue: flMinimumValue, Address: g_unNextAddress++, Value: strValue });
		}

		return GetConVarRecord(strName);
	},
	FindConVar(strName) {
		return GetConVarRecord(strName);
	},
	GetConVar(strName) {
		return g_mapRecords.get(RequireName(strName))?.Value ?? null;
	},
	GetConVarBoolean(strName) {
		const strValue = RequireRecord(strName).Value;

		return (strValue !== "0") && (strValue !== "false");
	},
	GetConVarFloat(strName) {
		return Number(RequireRecord(strName).Value);
	},
	GetConVarInteger(strName) {
		return Number.parseInt(RequireRecord(strName).Value, g_unDecimalRadix);
	},
	RemoveConVarFlags(strName, nFlags) {
		if (!Number.isInteger(nFlags)) {
			throw new TypeError("ConVar flags must be integers.");
		}

		RequireRecord(strName).Flags &= ~nFlags;

		return true;
	},
	RequireConVar(strName) {
		RequireRecord(strName);

		return GetConVarRecord(strName);
	},
	RevertConVarToDefault(strName) {
		const Record = RequireRecord(strName);
		Record.Value = Record.DefaultValue;

		return true;
	},
	SetConVar(strName, strValue) {
		if (typeof strValue !== "string") {
			throw new TypeError("ConVar values must be strings.");
		}

		RequireRecord(strName).Value = strValue;

		return true;
	},
	SetConVarFlags(strName, nFlags) {
		if (!Number.isInteger(nFlags)) {
			throw new TypeError("ConVar flags must be integers.");
		}

		RequireRecord(strName).Flags = nFlags;

		return true;
	},
};

const g_ConVar = {
	CreateConVar: g_CVars.CreateConVar,
	FindConVar: g_CVars.FindConVar,
	RequireConVar: g_CVars.RequireConVar,
};

globalThis.sourcejs = {
	cvars: g_CVars,
	"cvars/convar": g_ConVar,
};

try {
	const CVarsModule = require(g_strCVarsPath);
	const ConVarModule = require(g_strConVarPath);

	AssertEqual(CVarsModule, g_CVars, "cvars exact native identity");
	AssertEqual(ConVarModule, g_ConVar, "cvars/convar exact native identity");

	const CreatedConVar = ConVarModule.CreateConVar("sourcejs_smoke", "12", "smoke cvar", 0x04, 1, 32);
	AssertEqual(CreatedConVar.Address, 0x7000n, "exact BigInt ConVar address");
	AssertEqual(CVarsModule.GetConVar("sourcejs_smoke"), "12", "GetConVar");
	AssertEqual(CVarsModule.GetConVarInteger("sourcejs_smoke"), 12, "GetConVarInteger");
	AssertEqual(CVarsModule.GetConVarFloat("sourcejs_smoke"), 12, "GetConVarFloat");
	AssertEqual(CVarsModule.GetConVarBoolean("sourcejs_smoke"), true, "GetConVarBoolean");
	AssertEqual(ConVarModule.FindConVar("sourcejs_smoke").Exists, true, "FindConVar");
	AssertEqual(ConVarModule.RequireConVar("sourcejs_smoke").Name, "sourcejs_smoke", "RequireConVar");
	Assert(CVarsModule.AddConVarFlags("sourcejs_smoke", 0x08), "AddConVarFlags");
	AssertEqual(CVarsModule.FindConVar("sourcejs_smoke").Flags, 0x0C, "added flags");
	Assert(CVarsModule.RemoveConVarFlags("sourcejs_smoke", 0x04), "RemoveConVarFlags");
	AssertEqual(CVarsModule.FindConVar("sourcejs_smoke").Flags, 0x08, "removed flags");
	Assert(CVarsModule.SetConVar("sourcejs_smoke", "31.5"), "SetConVar");
	AssertEqual(CVarsModule.GetConVarFloat("sourcejs_smoke"), 31.5, "updated float");
	Assert(CVarsModule.RevertConVarToDefault("sourcejs_smoke"), "RevertConVarToDefault");
	AssertEqual(CVarsModule.GetConVar("sourcejs_smoke"), "12", "reverted value");
	AssertThrowsMessage(() => CVarsModule.SetConVar("sourcejs_smoke", 7), "ConVar values must be strings.", "scalar set rejection");

	g_mapRecords.delete("sourcejs_smoke");
	AssertThrowsMessage(() => ConVarModule.RequireConVar("sourcejs_smoke"), "ConVar not found: sourcejs_smoke", "missing RequireConVar");
	AssertEqual(Object.hasOwn(ConVarModule, "ConVar"), false, "cvars/convar should not reconstruct a ConVar class");

	console.log("[smoke_cvars_convar] ok");
} finally {
	delete globalThis.sourcejs;
}
