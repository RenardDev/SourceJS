"use strict";

const { CreateEntityDataMapVariantFromAddress } = require("entities/datamaps");
const { Entity } = require("entities/entity");
const g_EntityHelpersRuntime = require("entities/helpers");
const g_FilesystemRuntime = require("filesystem");
const g_GlobalsRuntime = require("globals");
const g_HooksRuntime = require("memory/hooks");
const g_MemoryHelpersRuntime = require("memory/helpers");
const g_MemoryManagerRuntime = require("memory/manager");
const g_PathsRuntime = require("paths");

const g_unEntityOutputIndexFormatVersion = 1;
const g_strEntityOutputIndexFileName = "index.json";
const g_unWindowsX86RawArgumentCount = 9;
// Preserve external INI profile keys until conversion to public PascalCase records.
const g_vecEntityOutputArgumentTypeFields = Object.freeze(["argumentsLinux", "argumentsWindows", "argumentsWindowsX64"]);
const g_mapOutputDataCache = new Map();

let g_OutputIndexCache = null;
let g_ActiveFireOutputHook = null;

function JoinSlashPath(...vecPathParts) {
	const vecNormalizedPathParts = [];
	for (const PathPart of vecPathParts) {
		if ((PathPart === null) || (PathPart === undefined)) {
			continue;
		}

		const strPathPartText = String(PathPart);
		if (strPathPartText.length === 0) {
			continue;
		}

		vecNormalizedPathParts.push(strPathPartText.replace(/\\/g, "/"));
	}

	const strJoinedPath = vecNormalizedPathParts.join("/");
	const strNormalizedPath = strJoinedPath.replace(/\/+/g, "/");
	if (/^\/\/[^/]/.test(strJoinedPath)) {
		return `/${strNormalizedPath}`;
	}

	return strNormalizedPath;
}

function RequireSDKBranch(strSDKBranch) {
	if (typeof strSDKBranch !== "string") {
		throw new TypeError("Entity output SDK branch must be a non-empty string.");
	}

	const strNormalizedSDKBranch = strSDKBranch.trim().toLowerCase();
	if (strNormalizedSDKBranch.length === 0) {
		throw new TypeError("Entity output SDK branch must be a non-empty string.");
	}

	return strNormalizedSDKBranch;
}

function GetActiveSDKBranch() {
	return RequireSDKBranch(g_GlobalsRuntime.GetGlobalVariables().SDKBranch);
}

function NormalizeOutputDataName(strOutputDataName) {
	if (typeof strOutputDataName !== "string") {
		throw new TypeError("Entity output data name must be a string.");
	}

	const NormalizeNamePart = (strMatchedText) => strMatchedText[1].toUpperCase();
	const strNormalizedOutputDataName = strOutputDataName.trim().replace(/_([a-z0-9])/g, NormalizeNamePart);
	if (strNormalizedOutputDataName.length === 0) {
		throw new TypeError("Entity output data name must be non-empty.");
	}

	return strNormalizedOutputDataName;
}

function NormalizeOutputDataPublicName(strOutputDataName) {
	return NormalizeOutputDataName(strOutputDataName).replace(/^[a-z]/, (strNamePart) => strNamePart.toUpperCase());
}

function StripINIComment(strINILine) {
	if (typeof strINILine !== "string") {
		throw new TypeError("Entity output INI line must be a string.");
	}

	let bIsQuoted = false;
	let bIsEscaped = false;
	let strStrippedLine = "";

	for (const chCharacter of strINILine) {
		if ((chCharacter === "\"") && !bIsEscaped) {
			bIsQuoted = !bIsQuoted;
		}

		if (!bIsQuoted && (chCharacter === "#")) {
			break;
		}

		strStrippedLine += chCharacter;
		// Escaped quotes must not turn a literal # into an INI comment.
		bIsEscaped = bIsQuoted && (chCharacter === "\\") && !bIsEscaped;
	}

	return strStrippedLine.trim();
}

function ParseINIValue(strINIValue) {
	if (typeof strINIValue !== "string") {
		throw new TypeError("Entity output INI value must be a string.");
	}

	const strNormalizedINIValue = strINIValue.trim();
	if ((strNormalizedINIValue.length >= 2) && strNormalizedINIValue.startsWith("\"") && strNormalizedINIValue.endsWith("\"")) {
		return strNormalizedINIValue.slice(1, -1).replace(/\\\"/g, "\"").replace(/\\\\/g, "\\");
	}

	if (strNormalizedINIValue === "True") {
		return true;
	}

	if (strNormalizedINIValue === "False") {
		return false;
	}

	return strNormalizedINIValue;
}

function NormalizeOutputArgumentTypes(ArgumentTypesValue) {
	if (!Array.isArray(ArgumentTypesValue) && (typeof ArgumentTypesValue !== "string")) {
		throw new TypeError("Entity output argument types must be a string or array.");
	}

	const vecArgumentTypeNames = Array.isArray(ArgumentTypesValue) ? ArgumentTypesValue : ArgumentTypesValue.split(",");
	const vecNormalizedArgumentTypes = [];
	for (const strArgumentTypeName of vecArgumentTypeNames) {
		if (typeof strArgumentTypeName !== "string") {
			throw new TypeError("Entity output argument type names must be strings.");
		}

		vecNormalizedArgumentTypes.push(g_MemoryHelpersRuntime.Type.NormalizeDataType(strArgumentTypeName.trim().toLowerCase()));
	}

	return vecNormalizedArgumentTypes;
}

function NormalizeEntityOutputData(EntityOutputData) {
	if (!EntityOutputData || Array.isArray(EntityOutputData) || (typeof EntityOutputData !== "object")) {
		throw new TypeError("Entity output data must be an object.");
	}

	if (!Object.hasOwn(EntityOutputData, "binary")) {
		throw new TypeError("Entity output data must define a non-empty binary.");
	}

	if (!Object.hasOwn(EntityOutputData, "functions")) {
		throw new TypeError("Entity output data must define a functions object.");
	}

	if (!Object.hasOwn(EntityOutputData, "serverCheck")) {
		throw new TypeError("Entity output data must define a boolean serverCheck value.");
	}

	const strBinaryName = EntityOutputData.binary;
	const FunctionDescriptors = EntityOutputData.functions;
	const bServerCheck = EntityOutputData.serverCheck;
	if ((typeof strBinaryName !== "string") || (strBinaryName.trim().length === 0)) {
		throw new TypeError("Entity output data must define a non-empty binary.");
	}

	if (!FunctionDescriptors || Array.isArray(FunctionDescriptors) || (typeof FunctionDescriptors !== "object")) {
		throw new TypeError("Entity output data must define a functions object.");
	}

	if (typeof bServerCheck !== "boolean") {
		throw new TypeError("Entity output data must define a boolean serverCheck value.");
	}

	const NormalizedFunctionDescriptors = Object.create(null);
	for (const strFunctionName in FunctionDescriptors) {
		if (!Object.hasOwn(FunctionDescriptors, strFunctionName)) {
			continue;
		}

		const FunctionDescriptor = FunctionDescriptors[strFunctionName];
		if (!FunctionDescriptor || Array.isArray(FunctionDescriptor) || (typeof FunctionDescriptor !== "object")) {
			throw new TypeError(`Entity output function descriptor must be an object: ${strFunctionName}`);
		}

		const strNormalizedFunctionName = NormalizeOutputDataPublicName(strFunctionName);
		const NormalizedFunctionDescriptor = Object.create(null);
		for (const [strDescriptorName, DescriptorValue] of Object.entries(FunctionDescriptor)) {
			const strDescriptorPropertyName = NormalizeOutputDataPublicName(strDescriptorName);
			NormalizedFunctionDescriptor[strDescriptorPropertyName] = DescriptorValue;
		}

		NormalizedFunctionDescriptors[strNormalizedFunctionName] = NormalizedFunctionDescriptor;
	}

	return { Binary: strBinaryName.trim(), Functions: NormalizedFunctionDescriptors, ServerCheckEnabled: bServerCheck };
}

function ParseEntityOutputINIConfiguration(strEntityOutputINIText) {
	if (typeof strEntityOutputINIText !== "string") {
		throw new TypeError("Entity output INI data must be a string.");
	}

	const RootConfiguration = Object.create(null);
	let CurrentSection = RootConfiguration;
	let CurrentNestedSection = null;
	for (const strRawINILine of strEntityOutputINIText.split(/\r?\n/)) {
		const strINILine = StripINIComment(strRawINILine);
		if (strINILine.length === 0) {
			continue;
		}

		const vecNestedSectionMatch = strINILine.match(/^\[\[([^\]]+)]]$/);
		if (vecNestedSectionMatch) {
			if (CurrentSection === RootConfiguration) {
				throw new SyntaxError(`Nested entity output section "${vecNestedSectionMatch[1]}" has no parent section.`);
			}

			const strNestedSectionName = NormalizeOutputDataName(vecNestedSectionMatch[1]);
			if (Object.hasOwn(CurrentSection, strNestedSectionName)) {
				throw new SyntaxError(`Duplicate nested entity output section: ${strNestedSectionName}`);
			}

			CurrentNestedSection = Object.create(null);
			CurrentSection[strNestedSectionName] = CurrentNestedSection;
			continue;
		}

		const vecSectionMatch = strINILine.match(/^\[([^\]]+)]$/);
		if (vecSectionMatch) {
			const strSectionName = NormalizeOutputDataName(vecSectionMatch[1]);
			if (Object.hasOwn(RootConfiguration, strSectionName)) {
				throw new SyntaxError(`Duplicate entity output section: ${strSectionName}`);
			}

			CurrentNestedSection = null;
			CurrentSection = Object.create(null);
			RootConfiguration[strSectionName] = CurrentSection;
			continue;
		}

		const nAssignmentSeparatorIndex = strINILine.indexOf("=");
		if (nAssignmentSeparatorIndex < 1) {
			throw new SyntaxError(`Invalid entity output INI line: ${strINILine}`);
		}

		const strConfigurationKey = NormalizeOutputDataName(strINILine.slice(0, nAssignmentSeparatorIndex));
		const TargetSection = (CurrentNestedSection === null) ? CurrentSection : CurrentNestedSection;
		if (Object.hasOwn(TargetSection, strConfigurationKey)) {
			throw new SyntaxError(`Duplicate entity output key: ${strConfigurationKey}`);
		}

		TargetSection[strConfigurationKey] = ParseINIValue(strINILine.slice(nAssignmentSeparatorIndex + 1));
	}

	return RootConfiguration;
}

function NormalizeEntityOutputConfiguration(EntityOutputConfiguration) {
	if (!EntityOutputConfiguration || Array.isArray(EntityOutputConfiguration) || (typeof EntityOutputConfiguration !== "object")) {
		throw new TypeError("Entity output configuration must be an object.");
	}

	if (!Object.hasOwn(EntityOutputConfiguration, "function")) {
		throw new TypeError("Entity output configuration must define a function section.");
	}

	const ConfiguredFunctionDescriptors = EntityOutputConfiguration.function;
	const NormalizedFunctionDescriptors = Object.create(null);
	if (!ConfiguredFunctionDescriptors || Array.isArray(ConfiguredFunctionDescriptors) || (typeof ConfiguredFunctionDescriptors !== "object")) {
		throw new TypeError("Entity output configuration must define a function section.");
	}

	for (const strFunctionName in ConfiguredFunctionDescriptors) {
		if (!Object.hasOwn(ConfiguredFunctionDescriptors, strFunctionName)) {
			continue;
		}

		const FunctionDescriptor = ConfiguredFunctionDescriptors[strFunctionName];
		if (!FunctionDescriptor || Array.isArray(FunctionDescriptor) || (typeof FunctionDescriptor !== "object")) {
			throw new TypeError(`Entity output function descriptor must be an object: ${strFunctionName}`);
		}

		const NormalizedFunctionDescriptor = { ...FunctionDescriptor };
		for (const strArgumentTypeField of g_vecEntityOutputArgumentTypeFields) {
			if (Object.hasOwn(NormalizedFunctionDescriptor, strArgumentTypeField)) {
				NormalizedFunctionDescriptor[strArgumentTypeField] = NormalizeOutputArgumentTypes(NormalizedFunctionDescriptor[strArgumentTypeField]);
			}
		}

		NormalizedFunctionDescriptors[strFunctionName] = NormalizedFunctionDescriptor;
	}

	let strBinaryName = "";
	let bConfiguredServerCheck = true;

	if (Object.hasOwn(EntityOutputConfiguration, "binary")) {
		strBinaryName = EntityOutputConfiguration.binary;
	}

	if (Object.hasOwn(EntityOutputConfiguration, "serverCheck")) {
		bConfiguredServerCheck = EntityOutputConfiguration.serverCheck;
	}

	return NormalizeEntityOutputData({ binary: strBinaryName, functions: NormalizedFunctionDescriptors, serverCheck: bConfiguredServerCheck });
}

function GetEntityOutputIndexFilePath() {
	return JoinSlashPath(g_PathsRuntime.SOURCE_DATA_ROOT, "entityoutputs", g_strEntityOutputIndexFileName);
}

function LoadEntityOutputIndex() {
	if (g_OutputIndexCache !== null) {
		return g_OutputIndexCache;
	}

	const strEntityOutputIndexFilePath = GetEntityOutputIndexFilePath();
	if (!g_FilesystemRuntime.DoesFileExist(strEntityOutputIndexFilePath)) {
		throw new Error(`Entity output index does not exist: ${strEntityOutputIndexFilePath}`);
	}

	const strEntityOutputIndexText = g_FilesystemRuntime.ReadTextFile(strEntityOutputIndexFilePath);
	if (typeof strEntityOutputIndexText !== "string") {
		throw new TypeError(`${strEntityOutputIndexFilePath} must contain text.`);
	}

	const EntityOutputIndex = JSON.parse(strEntityOutputIndexText.replace(/^\uFEFF/, ""));
	if (!EntityOutputIndex || Array.isArray(EntityOutputIndex) || (typeof EntityOutputIndex !== "object")) {
		throw new TypeError(`${strEntityOutputIndexFilePath} must contain an object.`);
	}

	if (!Object.hasOwn(EntityOutputIndex, "Format") || (EntityOutputIndex.Format !== g_unEntityOutputIndexFormatVersion)) {
		throw new TypeError(`${strEntityOutputIndexFilePath} must use entity output format ${g_unEntityOutputIndexFormatVersion}.`);
	}

	if (!Object.hasOwn(EntityOutputIndex, "Profiles")) {
		throw new TypeError(`${strEntityOutputIndexFilePath} must contain a profiles object.`);
	}

	if (!Object.hasOwn(EntityOutputIndex, "Entries")) {
		throw new TypeError(`${strEntityOutputIndexFilePath} must contain an entries object.`);
	}

	const EntityOutputProfiles = EntityOutputIndex.Profiles;
	const EntityOutputEntries = EntityOutputIndex.Entries;
	if (!EntityOutputProfiles || Array.isArray(EntityOutputProfiles) || (typeof EntityOutputProfiles !== "object")) {
		throw new TypeError(`${strEntityOutputIndexFilePath} must contain a profiles object.`);
	}

	if (!EntityOutputEntries || Array.isArray(EntityOutputEntries) || (typeof EntityOutputEntries !== "object")) {
		throw new TypeError(`${strEntityOutputIndexFilePath} must contain an entries object.`);
	}

	for (const strSDKBranch in EntityOutputProfiles) {
		if (!Object.hasOwn(EntityOutputProfiles, strSDKBranch)) {
			continue;
		}

		const strOutputProfile = EntityOutputProfiles[strSDKBranch];
		if ((typeof strOutputProfile !== "string") || (strOutputProfile.length === 0) || !Object.hasOwn(EntityOutputEntries, strOutputProfile)) {
			throw new TypeError(`${strEntityOutputIndexFilePath} maps SDK branch ${strSDKBranch} to an unknown profile.`);
		}
	}

	g_OutputIndexCache = EntityOutputIndex;

	return g_OutputIndexCache;
}

function GetOutputProfileForSDKBranch(strSDKBranch) {
	const strNormalizedSDKBranch = RequireSDKBranch(strSDKBranch);
	const EntityOutputProfiles = LoadEntityOutputIndex().Profiles;
	if (!Object.hasOwn(EntityOutputProfiles, strNormalizedSDKBranch)) {
		throw new RangeError(`Entity outputs do not support SDK branch: ${strNormalizedSDKBranch}`);
	}

	const strOutputProfile = EntityOutputProfiles[strNormalizedSDKBranch];
	if ((typeof strOutputProfile !== "string") || (strOutputProfile.length === 0)) {
		throw new RangeError(`Entity outputs do not support SDK branch: ${strNormalizedSDKBranch}`);
	}

	return strOutputProfile;
}

function GetRuntimePlatform() {
	const strRuntimePlatform = g_MemoryManagerRuntime.PLATFORM;
	if ((strRuntimePlatform !== "windows") && (strRuntimePlatform !== "linux")) {
		throw new Error(`Unsupported SourceJS platform: ${strRuntimePlatform}`);
	}

	return strRuntimePlatform;
}

function GetPlatformKey() {
	return (GetRuntimePlatform() === "windows") ? "Windows" : "Linux";
}

function GetRuntimeArchitecture() {
	const strRuntimeArchitecture = g_MemoryManagerRuntime.ARCHITECTURE;
	if ((strRuntimeArchitecture !== "x86") && (strRuntimeArchitecture !== "x64")) {
		throw new Error(`Unsupported SourceJS architecture: ${strRuntimeArchitecture}`);
	}

	return strRuntimeArchitecture;
}

function GetDefaultCallingConvention() {
	GetRuntimeArchitecture();
	const strRuntimePlatform = GetRuntimePlatform();

	// Native hooks select the platform's x64 ABI; the option spelling stays canonical.
	return (strRuntimePlatform === "windows") ? "thiscall" : "cdecl";
}

function ResolveEntityFromAddress(unEntityAddress) {
	if (g_MemoryHelpersRuntime.IsNull(unEntityAddress)) {
		return null;
	}

	const nEntityIndex = g_EntityHelpersRuntime.GetEntityIndexFromEntityAddress(unEntityAddress);

	return (nEntityIndex >= 0) ? Entity(nEntityIndex) : null;
}

function RequireAddress(unAddressValue, strArgumentName) {
	if ((typeof unAddressValue !== "bigint") || (unAddressValue < 0n)) {
		throw new TypeError(`${strArgumentName} must be a non-negative BigInt address.`);
	}

	return unAddressValue;
}

function ParseEntityOutputINI(strEntityOutputINIText) {
	return NormalizeEntityOutputConfiguration(ParseEntityOutputINIConfiguration(strEntityOutputINIText));
}

function GetEntityOutputDataFilePathForProfile(strOutputProfile) {
	const EntityOutputEntries = LoadEntityOutputIndex().Entries;
	if (!Object.hasOwn(EntityOutputEntries, strOutputProfile)) {
		throw new Error(`Entity output profile has no data file: ${strOutputProfile}`);
	}

	const strEntityOutputDataFileName = EntityOutputEntries[strOutputProfile];
	if ((typeof strEntityOutputDataFileName !== "string") || (strEntityOutputDataFileName.length === 0)) {
		throw new Error(`Entity output profile has no data file: ${strOutputProfile}`);
	}

	return JoinSlashPath(g_PathsRuntime.SOURCE_DATA_ROOT, "entityoutputs", strEntityOutputDataFileName);
}

function GetEntityOutputDataFilePath(strSDKBranch = GetActiveSDKBranch()) {
	const strOutputProfile = GetOutputProfileForSDKBranch(strSDKBranch);

	return GetEntityOutputDataFilePathForProfile(strOutputProfile);
}

function GetSupportedEntityOutputSDKBranches() {
	return Object.keys(LoadEntityOutputIndex().Profiles);
}

function HasEntityOutputData(strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedSDKBranch = RequireSDKBranch(strSDKBranch);
	const EntityOutputProfiles = LoadEntityOutputIndex().Profiles;
	if (!Object.hasOwn(EntityOutputProfiles, strNormalizedSDKBranch)) {
		return false;
	}

	const strOutputProfile = GetOutputProfileForSDKBranch(strNormalizedSDKBranch);

	return g_FilesystemRuntime.DoesFileExist(GetEntityOutputDataFilePathForProfile(strOutputProfile));
}

function LoadEntityOutputData(strSDKBranch = GetActiveSDKBranch()) {
	const strOutputProfile = GetOutputProfileForSDKBranch(strSDKBranch);
	if (g_mapOutputDataCache.has(strOutputProfile)) {
		return g_mapOutputDataCache.get(strOutputProfile);
	}

	const strEntityOutputDataFilePath = GetEntityOutputDataFilePathForProfile(strOutputProfile);
	if (!g_FilesystemRuntime.DoesFileExist(strEntityOutputDataFilePath)) {
		throw new Error(`Entity output data file does not exist: ${strEntityOutputDataFilePath}`);
	}

	const strEntityOutputINIText = g_FilesystemRuntime.ReadTextFile(strEntityOutputDataFilePath);
	const EntityOutputData = ParseEntityOutputINI(strEntityOutputINIText);
	g_mapOutputDataCache.set(strOutputProfile, EntityOutputData);

	return EntityOutputData;
}

function ClearEntityOutputDataCache() {
	g_mapOutputDataCache.clear();
	g_OutputIndexCache = null;

	return true;
}

function GetEntityFireOutputData(strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedSDKBranch = RequireSDKBranch(strSDKBranch);
	const FireOutputDescriptor = LoadEntityOutputData(strNormalizedSDKBranch).Functions.FireOutput;
	if (!FireOutputDescriptor) {
		throw new Error(`Entity output profile has no FireOutput descriptor: ${strNormalizedSDKBranch}`);
	}

	return FireOutputDescriptor;
}

function GetEntityFireOutputIdentifier(strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedSDKBranch = RequireSDKBranch(strSDKBranch);
	const strPlatformKey = GetPlatformKey();
	const strSelectedFireOutputIdentifier = GetEntityFireOutputData(strNormalizedSDKBranch)[`Identifier${strPlatformKey}`];
	if ((typeof strSelectedFireOutputIdentifier !== "string") || (strSelectedFireOutputIdentifier.length === 0)) {
		throw new Error(`Entity output profile has no ${strPlatformKey} identifier: ${strNormalizedSDKBranch}`);
	}

	return strSelectedFireOutputIdentifier;
}

function GetEntityFireOutputArguments(strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedSDKBranch = RequireSDKBranch(strSDKBranch);
	const strPlatformKey = GetPlatformKey();
	const strRuntimeArchitecture = GetRuntimeArchitecture();
	const strArgumentPlatformKey = ((strPlatformKey === "Windows") && (strRuntimeArchitecture === "x64")) ? "WindowsX64" : strPlatformKey;
	const vecArgumentTypes = GetEntityFireOutputData(strNormalizedSDKBranch)[`Arguments${strArgumentPlatformKey}`];
	if (!Array.isArray(vecArgumentTypes)) {
		throw new Error(`Entity output profile has no ${strArgumentPlatformKey} arguments: ${strNormalizedSDKBranch}`);
	}

	return [g_MemoryHelpersRuntime.Type.Address, ...vecArgumentTypes];
}

function GetEntityFireOutputAddress(strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedSDKBranch = RequireSDKBranch(strSDKBranch);
	const EntityOutputData = LoadEntityOutputData(strNormalizedSDKBranch);
	const strSelectedFireOutputIdentifier = GetEntityFireOutputIdentifier(strNormalizedSDKBranch);
	const unResolvedFireOutputAddress = g_MemoryManagerRuntime.ResolveBinaryIdentifier(EntityOutputData.Binary, strSelectedFireOutputIdentifier);
	if (g_MemoryHelpersRuntime.IsNull(unResolvedFireOutputAddress)) {
		throw new ReferenceError(`Unable to resolve FireOutput for SDK branch: ${strNormalizedSDKBranch}`);
	}

	return unResolvedFireOutputAddress;
}

function GetEntityFireOutputHookOptions(strSDKBranch = GetActiveSDKBranch(), HookOverrides = {}) {
	if (!HookOverrides || Array.isArray(HookOverrides) || (typeof HookOverrides !== "object")) {
		throw new TypeError("Entity output hook overrides must be an object.");
	}

	return {
		Address: GetEntityFireOutputAddress(strSDKBranch),
		Arguments: GetEntityFireOutputArguments(strSDKBranch),
		Convention: GetDefaultCallingConvention(),
		ReturnType: "void",
		...HookOverrides,
	};
}

function NormalizeEntityFireOutputArguments(vecFireOutputArgumentValues, unStackAddress = undefined) {
	const unNormalizedArgumentCount = 5;
	const unWindowsActivatorArgumentIndex = 6;
	const unWindowsCallerArgumentIndex = 7;
	const unWindowsDelayArgumentIndex = 8;
	const unWindowsX86ReturnAddressByteCount = 4n;
	const unWindowsX86MaximumAddress = 0xFFFFFFFFn;

	if (!Array.isArray(vecFireOutputArgumentValues)) {
		throw new TypeError("Entity output hook arguments must be an array.");
	}

	const strRuntimePlatform = GetRuntimePlatform();
	const strRuntimeArchitecture = GetRuntimeArchitecture();
	const unArgumentValueCount = vecFireOutputArgumentValues.length;
	if ((strRuntimePlatform === "windows") && (strRuntimeArchitecture === "x86")) {
		if (unArgumentValueCount === g_unWindowsX86RawArgumentCount) {
			RequireAddress(unStackAddress, "StackAddress");

			if ((unStackAddress === 0n) || (unStackAddress > (unWindowsX86MaximumAddress - unWindowsX86ReturnAddressByteCount))) {
				throw new RangeError("Entity output StackAddress must identify an x86 entry stack with room for the return address.");
			}

			return [
				vecFireOutputArgumentValues[0],
				unStackAddress + unWindowsX86ReturnAddressByteCount,
				vecFireOutputArgumentValues[unWindowsActivatorArgumentIndex],
				vecFireOutputArgumentValues[unWindowsCallerArgumentIndex],
				vecFireOutputArgumentValues[unWindowsDelayArgumentIndex],
			];
		}

		if (unArgumentValueCount === unNormalizedArgumentCount) {
			return [...vecFireOutputArgumentValues];
		}

		throw new RangeError(`Entity output Windows x86 hook arguments must contain ${g_unWindowsX86RawArgumentCount} raw values or ${unNormalizedArgumentCount} normalized values.`);
	}

	if (unArgumentValueCount !== unNormalizedArgumentCount) {
		throw new RangeError(`Entity output hook arguments must contain ${unNormalizedArgumentCount} values.`);
	}

	return [...vecFireOutputArgumentValues];
}

function GetEntityFireOutputContext(HookPayload) {
	if (!HookPayload || (typeof HookPayload !== "object")) {
		throw new TypeError("Entity output hook payload must contain an Arguments array.");
	}

	const vecHookArguments = HookPayload.Arguments;
	if (!Array.isArray(vecHookArguments)) {
		throw new TypeError("Entity output hook payload must contain an Arguments array.");
	}

	const bHasInlineVariant = (GetRuntimePlatform() === "windows") && (GetRuntimeArchitecture() === "x86") && (vecHookArguments.length === g_unWindowsX86RawArgumentCount);
	const unStackAddress = bHasInlineVariant ? HookPayload.StackAddress : undefined;
	const vecFireOutputArgumentValues = NormalizeEntityFireOutputArguments(vecHookArguments, unStackAddress);
	const unOutputAddress = RequireAddress(vecFireOutputArgumentValues[0], "OutputAddress");
	const unValueAddress = RequireAddress(vecFireOutputArgumentValues[1], "ValueAddress");
	const unActivatorAddress = RequireAddress(vecFireOutputArgumentValues[2], "ActivatorAddress");
	const unCallerAddress = RequireAddress(vecFireOutputArgumentValues[3], "CallerAddress");
	const flOutputDelay = vecFireOutputArgumentValues[4];
	if ((typeof flOutputDelay !== "number") || !Number.isFinite(flOutputDelay)) {
		throw new TypeError("Entity output delay must be a finite number.");
	}

	const CallerEntity = ResolveEntityFromAddress(unCallerAddress);
	const ActivatorEntity = ResolveEntityFromAddress(unActivatorAddress);
	const strOutputName = (CallerEntity === null) ? null : g_EntityHelpersRuntime.FindEntityOutputNameByAddress(CallerEntity, unOutputAddress);
	const OutputValue = (unValueAddress === 0n) ? null : CreateEntityDataMapVariantFromAddress(unValueAddress);

	return {
		Arguments: vecFireOutputArgumentValues,
		OutputAddress: unOutputAddress,
		ValueAddress: unValueAddress,
		ActivatorAddress: unActivatorAddress,
		CallerAddress: unCallerAddress,
		Delay: flOutputDelay,
		OutputName: strOutputName,
		Value: OutputValue,
		Activator: ActivatorEntity,
		Caller: CallerEntity,
	};
}

function RegisterFireOutputHookCallback(FireOutputHook, HookCallback) {
	if (HookCallback === undefined) {
		return true;
	}

	if (!FireOutputHook.Pre(HookCallback)) {
		throw new Error("Unable to register entity output pre-hook callback.");
	}

	return true;
}

function CreateEntityFireOutputHook(HookCallback, strSDKBranch = undefined, bRollbackNewHookOnFailure = false) {
	if ((HookCallback !== undefined) && (typeof HookCallback !== "function")) {
		throw new TypeError("Entity output hook callback must be a function.");
	}

	if (typeof bRollbackNewHookOnFailure !== "boolean") {
		throw new TypeError("Entity output hook bRollbackNewHookOnFailure must be a boolean.");
	}

	if (g_ActiveFireOutputHook) {
		RegisterFireOutputHookCallback(g_ActiveFireOutputHook, HookCallback);
		return g_ActiveFireOutputHook;
	}

	const strSelectedSDKBranch = (strSDKBranch === undefined) ? GetActiveSDKBranch() : strSDKBranch;
	const strNormalizedSDKBranch = RequireSDKBranch(strSelectedSDKBranch);
	const FireOutputHook = g_HooksRuntime.CreateFunctionHook(GetEntityFireOutputHookOptions(strNormalizedSDKBranch));
	if (!FireOutputHook) {
		throw new Error(`Unable to create FireOutput hook for SDK branch: ${strNormalizedSDKBranch}`);
	}

	g_ActiveFireOutputHook = FireOutputHook;
	const bRecordCreated = bRollbackNewHookOnFailure ? FireOutputHook.Created : false;
	if (typeof bRecordCreated !== "boolean") {
		throw new TypeError("Entity output hook rollback requires native Created metadata.");
	}

	try {
		RegisterFireOutputHookCallback(FireOutputHook, HookCallback);
	} catch (RegistrationError) {
		if (bRecordCreated) {
			try {
				if (!FireOutputHook.Remove()) {
					throw new Error("Unable to remove newly created entity output hook after registration failure.");
				}

				g_ActiveFireOutputHook = null;
			} catch (CleanupError) {
				throw new AggregateError([RegistrationError, CleanupError], "Entity output hook registration and cleanup failed.");
			}
		}

		throw RegistrationError;
	}

	return g_ActiveFireOutputHook;
}

function RemoveEntityFireOutputHook() {
	if (!g_ActiveFireOutputHook) {
		return false;
	}

	const FireOutputHook = g_ActiveFireOutputHook;
	const bHookRemoved = FireOutputHook.Remove();
	if (bHookRemoved) {
		g_ActiveFireOutputHook = null;
	}

	return bHookRemoved;
}

module.exports = {
	ClearEntityOutputDataCache,
	CreateEntityFireOutputHook,
	GetEntityOutputDataFilePath,
	GetEntityFireOutputArguments,
	GetEntityFireOutputContext,
	GetEntityFireOutputData,
	GetEntityFireOutputHookOptions,
	GetEntityFireOutputIdentifier,
	GetEntityFireOutputAddress,
	GetSupportedEntityOutputSDKBranches,
	HasEntityOutputData,
	LoadEntityOutputData,
	NormalizeEntityFireOutputArguments,
	ParseEntityOutputINI,
	RemoveEntityFireOutputHook,
};
