"use strict";

const g_FilesystemRuntime = require("filesystem");

const g_vecPluginInformationOptionNames = Object.freeze([
	"Author",
	"Description",
	"DisplayInListing",
	"Entry",
	"Extra",
	"Name",
	"Permissions",
	"PublicConVar",
	"URL",
	"VerboseName",
	"Version",
]);

function IsPlainObject(Value) {
	if ((Value === null) || (typeof Value !== "object")) {
		return false;
	}

	const Prototype = Object.getPrototypeOf(Value);

	return (Prototype === Object.prototype) || (Prototype === null);
}

function GetPluginManifestPath(strPluginDirectory) {
	if ((typeof strPluginDirectory !== "string") || (strPluginDirectory.length === 0)) {
		throw new TypeError("Plugin directory must be a non-empty string.");
	}

	return `${strPluginDirectory.replace(/[\\/]+$/, "")}/plugin.json`;
}

function FormatPluginTitleName(strPluginName) {
	if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
		throw new TypeError("Plugin name must be a non-empty string.");
	}

	const UppercaseMatchedCharacter = (strMatchedCharacter) => strMatchedCharacter.toUpperCase();

	return strPluginName.replace(/[_-]+/g, " ").replace(/\b\w/g, UppercaseMatchedCharacter);
}

function NormalizeOptionalPluginName(strPluginName) {
	if ((strPluginName === undefined) || (strPluginName === null)) {
		return null;
	}

	if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
		throw new TypeError("Plugin name must be a non-empty string or null.");
	}

	return strPluginName;
}

function NormalizeOptionalPluginText(strPluginText, strPluginFieldName) {
	if ((strPluginText === undefined) || (strPluginText === null)) {
		return null;
	}

	if (typeof strPluginText !== "string") {
		throw new TypeError(`Plugin ${strPluginFieldName} must be a string or null.`);
	}

	return strPluginText;
}

function NormalizePluginPermissionList(vecPluginPermissions) {
	if (vecPluginPermissions === undefined) {
		return [];
	}

	if (!Array.isArray(vecPluginPermissions)) {
		throw new TypeError("Plugin permissions must be an array.");
	}

	for (const vecPluginPermission of vecPluginPermissions) {
		if (!Array.isArray(vecPluginPermission)) {
			throw new TypeError("Each plugin permission must be a [name, description] string pair.");
		}

		const unPluginPermissionLength = vecPluginPermission.length;
		if (unPluginPermissionLength !== 2) {
			throw new TypeError("Each plugin permission must be a [name, description] string pair.");
		}

		const strPluginPermissionName = vecPluginPermission[0];
		const strPluginPermissionDescription = vecPluginPermission[1];
		if ((typeof strPluginPermissionName !== "string") || (typeof strPluginPermissionDescription !== "string")) {
			throw new TypeError("Each plugin permission must be a [name, description] string pair.");
		}
	}

	return vecPluginPermissions;
}

function NormalizePluginDisplayFields(vecPluginDisplayFields) {
	if (vecPluginDisplayFields === undefined) {
		return [];
	}

	if (!Array.isArray(vecPluginDisplayFields)) {
		throw new TypeError("Plugin DisplayInListing must be an array of strings.");
	}

	for (const strPluginDisplayField of vecPluginDisplayFields) {
		if (typeof strPluginDisplayField !== "string") {
			throw new TypeError("Plugin DisplayInListing must be an array of strings.");
		}
	}

	return vecPluginDisplayFields;
}

function NormalizePluginPublicConVar(PluginPublicConVar) {
	if (PluginPublicConVar === undefined) {
		return true;
	}

	if (typeof PluginPublicConVar === "boolean") {
		return PluginPublicConVar;
	}

	if (IsPlainObject(PluginPublicConVar)) {
		return PluginPublicConVar;
	}

	throw new TypeError("Plugin PublicConVar must be a boolean or object.");
}

function NormalizePluginExtraMetadata(ExtraMetadata) {
	if (ExtraMetadata === undefined) {
		return {};
	}

	if (!IsPlainObject(ExtraMetadata)) {
		throw new TypeError("Plugin Extra metadata must be an object.");
	}

	return ExtraMetadata;
}

function DoesPluginManifestExist(strPluginManifestPath) {
	const DoesFileExist = g_FilesystemRuntime.DoesFileExist;
	if (typeof DoesFileExist !== "function") {
		throw new TypeError("filesystem.DoesFileExist must be a function.");
	}

	const bPluginManifestExists = Reflect.apply(DoesFileExist, g_FilesystemRuntime, [strPluginManifestPath]);
	if (typeof bPluginManifestExists !== "boolean") {
		throw new TypeError("filesystem.DoesFileExist() must return a boolean.");
	}

	return bPluginManifestExists;
}

function ReadPluginManifestText(strPluginManifestPath) {
	const ReadTextFile = g_FilesystemRuntime.ReadTextFile;
	if (typeof ReadTextFile !== "function") {
		throw new TypeError("filesystem.ReadTextFile must be a function.");
	}

	const strPluginManifestText = Reflect.apply(ReadTextFile, g_FilesystemRuntime, [strPluginManifestPath]);
	if (typeof strPluginManifestText !== "string") {
		throw new TypeError("filesystem.ReadTextFile() must return a string.");
	}

	return strPluginManifestText;
}

function ReadExistingPluginManifest(strPluginManifestPath) {
	const strPluginManifestText = ReadPluginManifestText(strPluginManifestPath);
	if (strPluginManifestText.length === 0) {
		throw new Error(`Plugin manifest is empty: ${strPluginManifestPath}.`);
	}

	const PluginManifest = JSON.parse(strPluginManifestText);
	if (!IsPlainObject(PluginManifest)) {
		throw new TypeError(`Plugin manifest must contain an object: ${strPluginManifestPath}.`);
	}

	return PluginManifest;
}

function ReadPluginManifest(strPluginDirectory) {
	const strPluginManifestPath = GetPluginManifestPath(strPluginDirectory);
	if (!DoesPluginManifestExist(strPluginManifestPath)) {
		throw new Error(`Plugin manifest does not exist: ${strPluginManifestPath}.`);
	}

	return ReadExistingPluginManifest(strPluginManifestPath);
}

function IsPluginInformationOptionName(strPluginOptionName) {
	return g_vecPluginInformationOptionNames.includes(strPluginOptionName);
}

function ReadPluginInformationOption(PluginOptions, strPluginOptionName) {
	if (!Object.hasOwn(PluginOptions, strPluginOptionName)) {
		return undefined;
	}

	return PluginOptions[strPluginOptionName];
}

function DefinePluginExtraMetadata(ExtraMetadata, strPluginMetadataName, PluginMetadataValue) {
	Object.defineProperty(ExtraMetadata, strPluginMetadataName, { configurable: true, enumerable: true, value: PluginMetadataValue, writable: true });
}

function MergePluginExtraMetadata(ExtraMetadata, AdditionalPluginMetadata) {
	const vecPluginMetadataChanges = [];
	let bPluginExtraMetadataNeedsExtension = false;
	for (const strPluginMetadataName in AdditionalPluginMetadata) {
		const PreviousPluginMetadataDescriptor = Object.getOwnPropertyDescriptor(ExtraMetadata, strPluginMetadataName);
		if ((PreviousPluginMetadataDescriptor !== undefined) && !PreviousPluginMetadataDescriptor.configurable) {
			throw new TypeError(`Plugin Extra metadata property is not configurable: ${strPluginMetadataName}.`);
		}

		if (PreviousPluginMetadataDescriptor === undefined) {
			bPluginExtraMetadataNeedsExtension = true;
		}

		vecPluginMetadataChanges.push({ Name: strPluginMetadataName, PreviousDescriptor: PreviousPluginMetadataDescriptor, Value: AdditionalPluginMetadata[strPluginMetadataName] });
	}

	if (bPluginExtraMetadataNeedsExtension && !Object.isExtensible(ExtraMetadata)) {
		throw new TypeError("Plugin Extra metadata must be extensible for additional fields.");
	}

	let unAttemptedPluginMetadataChangeCount = 0;
	try {
		for (const PluginMetadataChange of vecPluginMetadataChanges) {
			unAttemptedPluginMetadataChangeCount += 1;
			DefinePluginExtraMetadata(ExtraMetadata, PluginMetadataChange.Name, PluginMetadataChange.Value);
		}
	} catch (PluginMetadataError) {
		const vecPluginMetadataRollbackErrors = [];
		for (let nPluginMetadataChangeIndex = unAttemptedPluginMetadataChangeCount - 1; nPluginMetadataChangeIndex >= 0; nPluginMetadataChangeIndex -= 1) {
			const PluginMetadataChange = vecPluginMetadataChanges[nPluginMetadataChangeIndex];
			try {
				if (PluginMetadataChange.PreviousDescriptor === undefined) {
					const bPluginMetadataDeleted = Reflect.deleteProperty(ExtraMetadata, PluginMetadataChange.Name);
					if (!bPluginMetadataDeleted) {
						throw new Error(`Failed to remove plugin Extra metadata: ${PluginMetadataChange.Name}.`);
					}
				} else {
					Object.defineProperty(ExtraMetadata, PluginMetadataChange.Name, PluginMetadataChange.PreviousDescriptor);
				}
			} catch (PluginMetadataRollbackError) {
				vecPluginMetadataRollbackErrors.push(PluginMetadataRollbackError);
			}
		}

		if (vecPluginMetadataRollbackErrors.length === 0) {
			throw PluginMetadataError;
		}

		const vecPluginMetadataFailures = [PluginMetadataError];
		for (const PluginMetadataRollbackError of vecPluginMetadataRollbackErrors) {
			vecPluginMetadataFailures.push(PluginMetadataRollbackError);
		}

		throw new AggregateError(vecPluginMetadataFailures, "Failed to assign plugin Extra metadata and restore prior values.");
	}
}

function ReadPluginRecordProperty(PluginRecord, strPluginRecordPropertyName) {
	if (!Object.hasOwn(PluginRecord, strPluginRecordPropertyName)) {
		throw new TypeError(`PluginRecord.${strPluginRecordPropertyName} is required.`);
	}

	return PluginRecord[strPluginRecordPropertyName];
}

function RequirePluginRecordText(strPluginRecordPropertyValue, strPluginRecordPropertyName) {
	if ((typeof strPluginRecordPropertyValue !== "string") || (strPluginRecordPropertyValue.length === 0)) {
		throw new TypeError(`PluginRecord.${strPluginRecordPropertyName} must be a non-empty string.`);
	}

	return strPluginRecordPropertyValue;
}

function RequirePluginRecordBoolean(bPluginRecordPropertyValue, strPluginRecordPropertyName) {
	if (typeof bPluginRecordPropertyValue !== "boolean") {
		throw new TypeError(`PluginRecord.${strPluginRecordPropertyName} must be a boolean.`);
	}

	return bPluginRecordPropertyValue;
}

function RequirePluginRecordIndex(nPluginRecordIndex) {
	if (!Number.isSafeInteger(nPluginRecordIndex)) {
		throw new TypeError("PluginRecord.Index must be a safe integer.");
	}

	return nPluginRecordIndex;
}

function DefinePluginRecordBackedProperty(PluginInformation, strPluginInformationPropertyName, PluginRecord, strPluginRecordPropertyName, PluginRecordValueValidator) {
	Object.defineProperty(PluginInformation, strPluginInformationPropertyName, {
		configurable: true,
		enumerable: true,
		get() {
			const PluginRecordPropertyValue = ReadPluginRecordProperty(PluginRecord, strPluginRecordPropertyName);

			return PluginRecordValueValidator(PluginRecordPropertyValue, strPluginRecordPropertyName);
		},
		set(PluginRecordPropertyValue) {
			PluginRecordValueValidator(PluginRecordPropertyValue, strPluginRecordPropertyName);
			PluginRecord[strPluginRecordPropertyName] = PluginRecordPropertyValue;
		},
	});
}

function DefinePluginRecordBackedProperties(PluginInformation, PluginRecord) {
	DefinePluginRecordBackedProperty(PluginInformation, "Name", PluginRecord, "Name", RequirePluginRecordText);
	DefinePluginRecordBackedProperty(PluginInformation, "Directory", PluginRecord, "Directory", RequirePluginRecordText);
	DefinePluginRecordBackedProperty(PluginInformation, "FilePath", PluginRecord, "Entry", RequirePluginRecordText);
	DefinePluginRecordBackedProperty(PluginInformation, "Enabled", PluginRecord, "Enabled", RequirePluginRecordBoolean);
	DefinePluginRecordBackedProperty(PluginInformation, "Loaded", PluginRecord, "Loaded", RequirePluginRecordBoolean);
	DefinePluginRecordBackedProperty(PluginInformation, "Index", PluginRecord, "Index", RequirePluginRecordIndex);
}

class PluginInfo {
	constructor(strPluginName, PluginOptions = {}) {
		if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
			throw new TypeError("Plugin name must be a non-empty string.");
		}

		if (!IsPlainObject(PluginOptions)) {
			throw new TypeError("Plugin options must be an object.");
		}

		const strPluginVerboseName = NormalizeOptionalPluginText(ReadPluginInformationOption(PluginOptions, "VerboseName"), "VerboseName");
		const strPluginAuthor = NormalizeOptionalPluginText(ReadPluginInformationOption(PluginOptions, "Author"), "Author");
		const strPluginDescription = NormalizeOptionalPluginText(ReadPluginInformationOption(PluginOptions, "Description"), "Description");
		const strPluginVersion = NormalizeOptionalPluginText(ReadPluginInformationOption(PluginOptions, "Version"), "Version");
		const strPluginURL = NormalizeOptionalPluginText(ReadPluginInformationOption(PluginOptions, "URL"), "URL");
		const vecPluginPermissions = NormalizePluginPermissionList(ReadPluginInformationOption(PluginOptions, "Permissions"));
		const PluginPublicConVar = NormalizePluginPublicConVar(ReadPluginInformationOption(PluginOptions, "PublicConVar"));
		const vecPluginDisplayFields = NormalizePluginDisplayFields(ReadPluginInformationOption(PluginOptions, "DisplayInListing"));
		const PluginEntryOption = ReadPluginInformationOption(PluginOptions, "Entry");
		const strPluginEntry = (PluginEntryOption === undefined) ? "index.js" : PluginEntryOption;
		if ((typeof strPluginEntry !== "string") || (strPluginEntry.length === 0)) {
			throw new TypeError("Plugin Entry must be a non-empty string.");
		}

		const ExtraMetadata = NormalizePluginExtraMetadata(ReadPluginInformationOption(PluginOptions, "Extra"));
		const AdditionalPluginMetadata = Object.create(null);
		for (const strPluginOptionName in PluginOptions) {
			if (!Object.hasOwn(PluginOptions, strPluginOptionName) || IsPluginInformationOptionName(strPluginOptionName)) {
				continue;
			}

			DefinePluginExtraMetadata(AdditionalPluginMetadata, strPluginOptionName, PluginOptions[strPluginOptionName]);
		}

		MergePluginExtraMetadata(ExtraMetadata, AdditionalPluginMetadata);

		this.Name = strPluginName;
		this.VerboseNameValue = strPluginVerboseName;
		this.Author = strPluginAuthor;
		this.Description = strPluginDescription;
		this.VersionValue = strPluginVersion;
		this.URL = strPluginURL;
		this.Permissions = vecPluginPermissions;
		this.PublicConVar = PluginPublicConVar;
		this.DisplayInListing = vecPluginDisplayFields;
		this.Entry = strPluginEntry;
		this.Extra = ExtraMetadata;
	}

	static FromManifest(strPluginName, strPluginDirectory) {
		const strNormalizedPluginName = NormalizeOptionalPluginName(strPluginName);
		const PluginManifest = ReadPluginManifest(strPluginDirectory);
		const PluginOptions = Object.assign(Object.create(null), PluginManifest);
		const strResolvedPluginName = (strNormalizedPluginName === null) ? PluginOptions.Name : strNormalizedPluginName;

		return new PluginInfo(strResolvedPluginName, PluginOptions);
	}

	static FromRecord(PluginRecord) {
		if (!IsPlainObject(PluginRecord)) {
			throw new TypeError("PluginRecord must be a plugin record object.");
		}

		const strPluginName = RequirePluginRecordText(ReadPluginRecordProperty(PluginRecord, "Name"), "Name");
		const strPluginDirectory = RequirePluginRecordText(ReadPluginRecordProperty(PluginRecord, "Directory"), "Directory");
		RequirePluginRecordText(ReadPluginRecordProperty(PluginRecord, "Entry"), "Entry");
		RequirePluginRecordBoolean(ReadPluginRecordProperty(PluginRecord, "Enabled"), "Enabled");
		RequirePluginRecordBoolean(ReadPluginRecordProperty(PluginRecord, "Loaded"), "Loaded");
		RequirePluginRecordIndex(ReadPluginRecordProperty(PluginRecord, "Index"));

		const strPluginManifestPath = GetPluginManifestPath(strPluginDirectory);
		let PluginInformation = null;

		if (DoesPluginManifestExist(strPluginManifestPath)) {
			const PluginManifest = ReadExistingPluginManifest(strPluginManifestPath);
			const PluginOptions = Object.assign(Object.create(null), PluginManifest);
			PluginInformation = new PluginInfo(strPluginName, PluginOptions);
		} else {
			PluginInformation = new PluginInfo(strPluginName);
		}

		DefinePluginRecordBackedProperties(PluginInformation, PluginRecord);

		return PluginInformation;
	}

	get VerboseName() {
		const strPluginVerboseName = this.VerboseNameValue;

		return (strPluginVerboseName === null) ? FormatPluginTitleName(this.Name) : strPluginVerboseName;
	}

	set VerboseName(strPluginVerboseName) {
		if ((strPluginVerboseName !== null) && (typeof strPluginVerboseName !== "string")) {
			throw new TypeError("VerboseName must be a string or null.");
		}

		this.VerboseNameValue = strPluginVerboseName;
	}

	get Version() {
		const strPluginVersion = this.VersionValue;

		return (strPluginVersion === null) ? "unversioned" : strPluginVersion;
	}

	set Version(strPluginVersion) {
		if ((strPluginVersion !== null) && (typeof strPluginVersion !== "string")) {
			throw new TypeError("Version must be a string or null.");
		}

		this.VersionValue = strPluginVersion;
	}
}

module.exports = { PluginInfo, ReadPluginManifest };
