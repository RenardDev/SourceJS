"use strict";

const { GetModule } = require("internal/runtime");

const g_CVarsRuntime = GetModule("cvars");
const g_PublicCVarsRuntime = GetModule("cvars/public");
const g_mapPublicConVarRegistrations = new Map();

function NormalizeConVarName(strConVarName) {
	if (typeof strConVarName !== "string") {
		throw new TypeError("Public ConVar name must be a non-empty string.");
	}

	const strNormalizedName = strConVarName.trim();
	if ((strNormalizedName.length === 0) || strNormalizedName.includes("\0")) {
		throw new TypeError("Public ConVar name must be a non-empty string without NUL bytes.");
	}

	return strNormalizedName;
}

class PublicConVarRegistration {
	constructor(ConVar, bOriginallyExisted, strOriginalValue, bOriginallyPublic) {
		this.m_ConVar = ConVar;
		this.m_strName = ConVar.Name;
		this.m_bOriginallyExisted = bOriginallyExisted;
		this.m_strOriginalValue = strOriginalValue;
		this.m_bOriginallyPublic = bOriginallyPublic;
	}

	RestoreOriginalConVarState() {
		if (this.m_bOriginallyExisted && !g_CVarsRuntime.SetConVar(this.m_strName, this.m_strOriginalValue)) {
			return false;
		}

		const bOriginalPublic = this.m_bOriginallyExisted && this.m_bOriginallyPublic;

		return g_PublicCVarsRuntime.SetConVarPublic(this.m_strName, bOriginalPublic);
	}

	UnregisterPublicConVar(bRestoreConVar = true) {
		if (typeof bRestoreConVar !== "boolean") {
			throw new TypeError("Public ConVar restore flag must be a boolean.");
		}

		if (bRestoreConVar && !this.RestoreOriginalConVarState()) {
			return false;
		}

		// The native name need not match the registry key; remove only this instance.
		for (const [strRegisteredName, Registration] of g_mapPublicConVarRegistrations) {
			if (Registration === this) {
				return g_mapPublicConVarRegistrations.delete(strRegisteredName);
			}
		}

		return false;
	}

	get ConVar() {
		return this.m_ConVar;
	}

	get Name() {
		return this.m_strName;
	}

	get OriginallyExisted() {
		return this.m_bOriginallyExisted;
	}

	get OriginalValue() {
		return this.m_strOriginalValue;
	}

	get OriginallyPublic() {
		return this.m_bOriginallyPublic;
	}
}

function RegisterPublicConVar(strConVarName, Value = "0", Description = "", Options = {}) {
	const strNormalizedName = NormalizeConVarName(strConVarName);

	if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Public ConVar options must be an object.");
	}

	if (g_mapPublicConVarRegistrations.has(strNormalizedName)) {
		throw new Error(`Public ConVar is already registered: ${strNormalizedName}`);
	}

	const ExistingConVar = g_PublicCVarsRuntime.FindConVar(strNormalizedName);
	const bOriginallyExisted = ExistingConVar.Exists;
	const strOriginalValue = bOriginallyExisted ? ExistingConVar.Value : null;
	const bOriginallyPublic = bOriginallyExisted && g_PublicCVarsRuntime.IsConVarPublic(strNormalizedName);
	const ConVar = g_CVarsRuntime.CreateConVar(strNormalizedName, Value, Description, Options.Flags ?? 0, Options.MinimumValue ?? null, Options.MaximumValue ?? null);

	if (!g_CVarsRuntime.SetConVar(strNormalizedName, Value)) {
		throw new Error(`Failed to set public ConVar value: ${strNormalizedName}`);
	}

	if (!g_PublicCVarsRuntime.SetConVarPublic(strNormalizedName, true)) {
		throw new Error(`Failed to make ConVar public: ${strNormalizedName}`);
	}

	const Registration = new PublicConVarRegistration(ConVar, bOriginallyExisted, strOriginalValue, bOriginallyPublic);
	g_mapPublicConVarRegistrations.set(strNormalizedName, Registration);

	return Registration;
}

function UnregisterPublicConVar(strConVarName, bRestoreConVar = true) {
	const strNormalizedName = NormalizeConVarName(strConVarName);
	const Registration = g_mapPublicConVarRegistrations.get(strNormalizedName);
	if (!Registration) {
		return false;
	}

	return Registration.UnregisterPublicConVar(bRestoreConVar);
}

function GetPublicConVarRegistration(strConVarName) {
	return g_mapPublicConVarRegistrations.get(NormalizeConVarName(strConVarName)) ?? null;
}

function GetPublicConVars() {
	const IsPublicConVarEntry = (ConVarEntry) => !ConVarEntry.IsCommand && ConVarEntry.Exists && g_PublicCVarsRuntime.IsConVarPublic(ConVarEntry.Name);

	return g_CVarsRuntime.GetConCommandBaseRecords().filter(IsPublicConVarEntry);
}

function GetPublicConVarRegistrationRecords() {
	return g_mapPublicConVarRegistrations.values();
}

Object.assign(g_PublicCVarsRuntime, {
	GetPublicConVarRegistration,
	GetPublicConVarRegistrationRecords,
	GetPublicConVars,
	PublicConVarRegistration,
	RegisterPublicConVar,
	UnregisterPublicConVar,
});

module.exports = g_PublicCVarsRuntime;
