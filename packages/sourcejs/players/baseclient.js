"use strict";

const { MakeObject } = require("memory");
const { ClearGameDataCache, GetGameDataPaths, HasGameData, LoadGameData } = require("memory/gamedata");
const { CustomType, Manager } = require("memory/manager");

const g_strBaseClientGameDataFileName = "CBaseClient.ini";
const g_strBaseClientGameDataKind = "client";
const g_strBaseClientTypeName = "BaseClient";

let g_BaseClientType = null;
let g_strBaseClientSDKBranch = null;

function LoadBaseClientGameData(strSDKBranch = undefined) {
	return LoadGameData(g_strBaseClientGameDataKind, g_strBaseClientGameDataFileName, strSDKBranch);
}

function GetBaseClientGameDataPaths(strSDKBranch = undefined) {
	return GetGameDataPaths(g_strBaseClientGameDataKind, g_strBaseClientGameDataFileName, strSDKBranch);
}

function HasBaseClientGameData(strSDKBranch = undefined) {
	return HasGameData(g_strBaseClientGameDataKind, g_strBaseClientGameDataFileName, strSDKBranch);
}

function CreateBaseClientType(strSDKBranch = undefined, BaseType = CustomType) {
	if (!HasBaseClientGameData(strSDKBranch)) {
		const strSDKBranchDescription = (strSDKBranch === undefined) ? "the selected SDK branch" : `SDK branch ${strSDKBranch}`;
		throw new ReferenceError(`CBaseClient GameData is not available for ${strSDKBranchDescription}.`);
	}

	const CreatedBaseClientType = Manager.CreateTypeFromObject(g_strBaseClientTypeName, LoadBaseClientGameData(strSDKBranch), BaseType);
	g_BaseClientType = CreatedBaseClientType;
	g_strBaseClientSDKBranch = strSDKBranch;

	return g_BaseClientType;
}

function GetBaseClientType(strSDKBranch = undefined) {
	if ((g_BaseClientType === null) || (g_strBaseClientSDKBranch !== strSDKBranch)) {
		return CreateBaseClientType(strSDKBranch);
	}

	return g_BaseClientType;
}

function CreateBaseClientFromAddress(unBaseClientAddress, strSDKBranch = undefined) {
	return MakeObject(GetBaseClientType(strSDKBranch), unBaseClientAddress);
}

function ClearBaseClientCache() {
	g_BaseClientType = null;
	g_strBaseClientSDKBranch = null;
	ClearGameDataCache();

	return true;
}

const g_BaseClientAPI = {
	ClearBaseClientCache,
	CreateBaseClientType,
	CreateBaseClientFromAddress,
	GetBaseClientGameDataPaths,
	GetBaseClientType,
	HasBaseClientGameData,
	LoadBaseClientGameData,
};

module.exports = g_BaseClientAPI;
