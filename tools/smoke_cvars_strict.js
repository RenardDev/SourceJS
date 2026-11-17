#!/usr/bin/env node

"use strict";

const g_Path = require("node:path");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strCVarsPath = g_Path.join(g_strPackageRoot, "cvars.js");
const g_strConVarPath = g_Path.join(g_strPackageRoot, "cvars", "convar.js");
const g_strFlagsPath = g_Path.join(g_strPackageRoot, "cvars", "flags.js");
const g_strPublicPath = g_Path.join(g_strPackageRoot, "cvars", "public.js");
const g_strTagsPath = g_Path.join(g_strPackageRoot, "cvars", "tags.js");

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

function AssertThrows(Callback, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert(CaughtError instanceof Error, strErrorMessage);
}

const g_nNotifyFlagMask = 0x0100;

const g_CVars = {
	CVAR_DLL_IDENTIFIER: 42,
};
const g_ConVar = {};
const g_Flags = {
	ARCHIVE: 1 << 7,
	CHEAT: 1 << 14,
	NONE: 0,
	NOTIFY: g_nNotifyFlagMask,
};
const g_PublicCVars = {
	NOTIFY: g_nNotifyFlagMask,
};
const g_Tags = {};

globalThis.sourcejs = {
	cvars: g_CVars,
	"cvars/convar": g_ConVar,
	"cvars/flags": g_Flags,
	"cvars/public": g_PublicCVars,
	"cvars/tags": g_Tags,
};

try {
	const CVarsModule = require(g_strCVarsPath);
	const ConVarModule = require(g_strConVarPath);
	const FlagsModule = require(g_strFlagsPath);
	const PublicModule = require(g_strPublicPath);
	const TagsModule = require(g_strTagsPath);

	AssertEqual(CVarsModule, g_CVars, "cvars exact native identity");
	AssertEqual(ConVarModule, g_ConVar, "cvars/convar exact native identity");
	AssertEqual(FlagsModule, g_Flags, "cvars/flags exact native identity");
	AssertEqual(PublicModule, g_PublicCVars, "cvars/public exact native identity");
	AssertEqual(TagsModule, g_Tags, "cvars/tags exact native identity");
	AssertEqual(CVarsModule.CVAR_DLL_IDENTIFIER, 42, "CVAR_DLL_IDENTIFIER");
	AssertEqual(FlagsModule.NONE, 0, "flags NONE");
	AssertEqual(FlagsModule.NOTIFY, 1 << 8, "flags NOTIFY");
	AssertEqual(FlagsModule.CHEAT, 1 << 14, "flags CHEAT");
	AssertEqual(PublicModule.NOTIFY, 1 << 8, "public NOTIFY");
	AssertThrows(() => CVarsModule.DoesConVarExist("sourcejs_strict"), "unavailable cvars.DoesConVarExist should throw through V8 object semantics");
	AssertThrows(() => ConVarModule.CreateConVar("sourcejs_range", "12"), "unavailable cvars/convar.CreateConVar should throw");
	AssertThrows(() => PublicModule.IsConVarPublic("sourcejs_range"), "unavailable public cvar API should throw");
	AssertThrows(() => TagsModule.SetServerTagsString("one,two"), "unavailable tags API should throw");
	AssertEqual(Object.hasOwn(ConVarModule, "ConVar"), false, "cvars/convar should not expose a fallback class");
	AssertEqual(Object.hasOwn(FlagsModule, "Archive"), false, "flags should not expose legacy enum aliases");

	console.log("[smoke_cvars_strict] ok");
} finally {
	delete globalThis.sourcejs;
}
