"use strict";

const { GetModule } = require("internal/runtime");
const { EVENT_MANAGER } = require("events/manager");
const { GAME_ROOT } = require("paths");

const g_StringTablesRuntime = GetModule("stringtables");
const g_strDownloadablesTableName = g_StringTablesRuntime.DOWNLOADABLES_TABLE_NAME;
const g_nInvalidStringIndex = -1;
const g_nInvalidStringTable = -1;
const g_NativeTable = Symbol("nativeTable");
const g_setDownloadableSets = new Set();
let g_bRestoreListenerRegistered = false;

function GetStringTableName(StringTableValue) {
	if ((typeof StringTableValue === "string") && (StringTableValue.length > 0)) {
		return StringTableValue;
	}

	if (StringTableValue instanceof StringTable) {
		return StringTableValue.Name;
	}

	if (StringTableValue && (typeof StringTableValue === "object")) {
		const NameValue = StringTableValue.Name;
		if (typeof NameValue === "string") {
			return NameValue;
		}
	}

	throw new TypeError("TableValue must be a string-table object or table name.");
}

function NormalizeSlashPath(strPath) {
	if (typeof strPath !== "string") {
		throw new TypeError("strPath must be a string.");
	}

	return strPath.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function NormalizeDownloadPath(strPath) {
	let strNormalizedPath = NormalizeSlashPath(strPath);
	const strRootPath = NormalizeSlashPath(GAME_ROOT).replace(/\/$/, "");
	if ((strRootPath.length > 0) && strNormalizedPath.toLowerCase().startsWith(`${strRootPath.toLowerCase()}/`)) {
		strNormalizedPath = strNormalizedPath.slice(strRootPath.length + 1);
	}

	while (strNormalizedPath.startsWith("./")) {
		strNormalizedPath = strNormalizedPath.slice(2);
	}

	while (strNormalizedPath.startsWith("/")) {
		strNormalizedPath = strNormalizedPath.slice(1);
	}

	return strNormalizedPath;
}

function HasDownloadInOtherSet(setOwnerSet, strPath) {
	for (const setDownloadableSet of g_setDownloadableSets) {
		if ((setDownloadableSet !== setOwnerSet) && Set.prototype.has.call(setDownloadableSet, strPath)) {
			return true;
		}
	}

	return false;
}

function GetAll() {
	return g_StringTablesRuntime.GetAllStringTables();
}

function Find(strTableName) {
	return g_StringTablesRuntime.FindStringTable(strTableName);
}

function GetString(TableValue, nStringIndex) {
	const strTableName = GetStringTableName(TableValue);

	return g_StringTablesRuntime.GetString(strTableName, nStringIndex);
}

function GetRequiredString(TableValue, unStringIndex) {
	const strTableName = GetStringTableName(TableValue);

	return g_StringTablesRuntime.GetRequiredString(strTableName, unStringIndex);
}

function AddString(TableValue, strStringValue) {
	const strTableName = GetStringTableName(TableValue);

	return g_StringTablesRuntime.AddString(strTableName, strStringValue);
}

function GetStringUserData(TableValue, nStringIndex) {
	const strTableName = GetStringTableName(TableValue);

	return g_StringTablesRuntime.GetStringUserData(strTableName, nStringIndex);
}

function SetStringUserData(TableValue, nStringIndex, arrBytes) {
	const strTableName = GetStringTableName(TableValue);

	return g_StringTablesRuntime.SetStringUserData(strTableName, nStringIndex, arrBytes);
}

function GetDownloadablesTable() {
	return g_StringTablesRuntime.GetDownloadablesTable();
}

function GetDownloadablesList() {
	return g_StringTablesRuntime.GetDownloadablesList();
}

function GetTrackedDownloadables() {
	return g_StringTablesRuntime.GetTrackedDownloadables();
}

function GetDownloadableIndex(strPath) {
	return g_StringTablesRuntime.GetDownloadableIndex(NormalizeDownloadPath(strPath));
}

function HasDownloadable(strPath) {
	return g_StringTablesRuntime.HasDownloadable(NormalizeDownloadPath(strPath));
}

function AddDownloadable(strPath) {
	const strNormalizedPath = NormalizeDownloadPath(strPath);

	EnsureDownloadablesRestoreListener();

	return g_StringTablesRuntime.AddDownloadable(strNormalizedPath);
}

function AddRequiredDownloadable(strPath) {
	const nStringIndex = AddDownloadable(strPath);
	if (!Number.isSafeInteger(nStringIndex) || (nStringIndex < 0)) {
		throw new Error(`Unable to add downloadable path: ${strPath}`);
	}

	return nStringIndex;
}

function AddDownloadableDirectory(strPath, bRecursive = true) {
	if (typeof bRecursive !== "boolean") {
		throw new TypeError("bRecursive must be a boolean.");
	}

	EnsureDownloadablesRestoreListener();

	return g_StringTablesRuntime.AddDownloadableDirectory(NormalizeDownloadPath(strPath), bRecursive);
}

function UntrackDownloadable(strPath) {
	const strNormalizedPath = NormalizeDownloadPath(strPath);

	return g_StringTablesRuntime.UntrackDownloadable(strNormalizedPath);
}

function UntrackDownloadableDirectory(strPath) {
	return g_StringTablesRuntime.UntrackDownloadableDirectory(NormalizeDownloadPath(strPath));
}

function RestoreDownloadables() {
	return g_StringTablesRuntime.RestoreDownloadables();
}

function RestoreDownloadableSets() {
	let unRestoredCount = RestoreDownloadables();

	for (const setDownloadableSet of g_setDownloadableSets) {
		const unDownloadableCountBefore = GetDownloadablesList().length;

		setDownloadableSet.Restore();
		unRestoredCount += Math.max(0, GetDownloadablesList().length - unDownloadableCountBefore);
	}

	return unRestoredCount;
}

function EnsureDownloadablesRestoreListener() {
	if (g_bRestoreListenerRegistered) {
		return true;
	}

	// server_spawn is an engine-owned game event, not a project event identifier.
	EVENT_MANAGER.RegisterEventListener("server_spawn", RestoreDownloadableSets);
	g_bRestoreListenerRegistered = true;

	return true;
}

class StringTable {
	constructor(StringTableValue) {
		let NativeStringTable = StringTableValue;

		if (StringTableValue instanceof StringTable) {
			NativeStringTable = StringTableValue[g_NativeTable];
		} else if (typeof StringTableValue === "string") {
			NativeStringTable = Find(StringTableValue);
		}

		const AddressValue = (NativeStringTable && (typeof NativeStringTable === "object")) ? NativeStringTable.Address : undefined;
		if ((typeof AddressValue !== "bigint") || (AddressValue <= 0n)) {
			throw new TypeError("StringTableValue must identify an existing string table.");
		}

		this[g_NativeTable] = NativeStringTable;
	}

	Get(nStringIndex) {
		return GetString(this.Name, nStringIndex);
	}

	Add(strStringValue) {
		return AddString(this.Name, strStringValue);
	}

	GetStringUserData(nStringIndex) {
		return GetStringUserData(this.Name, nStringIndex);
	}

	SetStringUserData(nStringIndex, arrBytes) {
		return SetStringUserData(this.Name, nStringIndex, arrBytes);
	}

	IndexOf(strStringValue) {
		if (typeof strStringValue !== "string") {
			throw new TypeError("strStringValue must be a string.");
		}

		for (let unStringIndex = 0; unStringIndex < this.Length; unStringIndex += 1) {
			if (this.Get(unStringIndex) === strStringValue) {
				return unStringIndex;
			}
		}

		return g_nInvalidStringIndex;
	}

	Has(strStringValue) {
		return this.IndexOf(strStringValue) !== g_nInvalidStringIndex;
	}

	*GetKeys() {
		for (let unStringIndex = 0; unStringIndex < this.Length; unStringIndex += 1) {
			yield unStringIndex;
		}
	}

	*GetValues() {
		for (const unStringIndex of this.GetKeys()) {
			const strStringValue = this.Get(unStringIndex);
			if (strStringValue !== null) {
				yield strStringValue;
			}
		}
	}

	*GetEntries() {
		for (const unStringIndex of this.GetKeys()) {
			yield [unStringIndex, this.Get(unStringIndex)];
		}
	}

	[Symbol.iterator]() {
		return this.GetValues();
	}

	get Address() {
		return this[g_NativeTable].Address;
	}

	get Name() {
		return this[g_NativeTable].Name;
	}

	get ID() {
		return this[g_NativeTable].ID;
	}

	get StringCount() {
		return this[g_NativeTable].StringCount;
	}

	get MaximumStringCount() {
		return this[g_NativeTable].MaximumStringCount;
	}

	get Length() {
		return this.StringCount;
	}

	get Valid() {
		return (this.Address !== 0n) && (this.ID !== g_nInvalidStringTable);
	}
}

class StringTableContainer {
	// Established collection APIs allocate snapshots or live table wrappers.
	GetAll() {
		const vecStringTables = GetAll();
		const vecStringTableObjects = [];
		for (const StringTableValue of vecStringTables) {
			vecStringTableObjects.push(new StringTable(StringTableValue));
		}

		return vecStringTableObjects;
	}

	GetNames() {
		const vecStringTables = GetAll();
		const vecStringTableNames = [];
		for (const StringTableValue of vecStringTables) {
			vecStringTableNames.push(StringTableValue.Name);
		}

		return vecStringTableNames;
	}

	Find(strTableName) {
		const StringTableValue = Find(strTableName);
		if (StringTableValue === null) {
			return null;
		}

		return new StringTable(StringTableValue);
	}

	FindByID(nTableID) {
		if (!Number.isSafeInteger(nTableID)) {
			throw new TypeError("nTableID must be a safe integer.");
		}

		const vecStringTables = GetAll();
		for (const StringTableValue of vecStringTables) {
			if (StringTableValue.ID === nTableID) {
				return new StringTable(StringTableValue);
			}
		}

		return null;
	}

	Has(strTableName) {
		return this.Find(strTableName) !== null;
	}

	GetString(TableValue, nStringIndex) {
		return GetString(TableValue, nStringIndex);
	}

	GetRequiredString(TableValue, unStringIndex) {
		return GetRequiredString(TableValue, unStringIndex);
	}

	AddString(TableValue, strStringValue) {
		return AddString(TableValue, strStringValue);
	}

	GetStringUserData(TableValue, nStringIndex) {
		return GetStringUserData(TableValue, nStringIndex);
	}

	SetStringUserData(TableValue, nStringIndex, arrBytes) {
		return SetStringUserData(TableValue, nStringIndex, arrBytes);
	}

	[Symbol.iterator]() {
		return this.GetAll()[Symbol.iterator]();
	}

	get Length() {
		return GetAll().length;
	}

	get GetDownloadables() {
		return this.Find(g_strDownloadablesTableName);
	}
}

class Downloadables extends Set {
	constructor(vecValues = []) {
		if (!Array.isArray(vecValues)) {
			throw new TypeError("vecValues must be an array.");
		}

		const vecNormalizedValues = [];
		for (const strValue of vecValues) {
			const strNormalizedValue = NormalizeDownloadPath(strValue);
			if (strNormalizedValue.length === 0) {
				throw new TypeError("downloadable paths must not be empty.");
			}

			vecNormalizedValues.push(strNormalizedValue);
		}

		super();

		this.#m_bDisposed = false;

		try {
			for (const strValue of vecNormalizedValues) {
				this.Add(strValue);
			}
		} catch (CaughtError) {
			try {
				this.clear();
			} catch (CleanupError) {
				// Retain partial ownership so other sets cannot untrack its paths before recovery.
				g_setDownloadableSets.add(this);
				const Failure = new AggregateError([CaughtError, CleanupError], "Downloadables construction and cleanup failed.");
				Failure.UnreleasedDownloadables = this;
				throw Failure;
			}

			throw CaughtError;
		}

		g_setDownloadableSets.add(this);
	}

	Add(strPath) {
		this.#RequireActive();

		const strNormalizedPath = NormalizeDownloadPath(strPath);
		if (strNormalizedPath.length === 0) {
			throw new TypeError("downloadable path must not be empty.");
		}

		if (super.has(strNormalizedPath)) {
			return this;
		}

		AddRequiredDownloadable(strNormalizedPath);
		super.add(strNormalizedPath);

		return this;
	}

	delete(strPath) {
		const strNormalizedPath = NormalizeDownloadPath(strPath);
		if (!super.has(strNormalizedPath)) {
			return false;
		}

		if (!HasDownloadInOtherSet(this, strNormalizedPath)) {
			UntrackDownloadable(strNormalizedPath);
		}

		return super.delete(strNormalizedPath);
	}

	has(strPath) {
		return super.has(NormalizeDownloadPath(strPath));
	}

	AddDirectory(strPath, bRecursive = true) {
		this.#RequireActive();

		let unAddedCount = 0;
		for (const strValue of AddDownloadableDirectory(strPath, bRecursive)) {
			const strNormalizedValue = NormalizeDownloadPath(strValue);
			if ((strNormalizedValue.length > 0) && !super.has(strNormalizedValue)) {
				super.add(strNormalizedValue);
				unAddedCount += 1;
			}
		}

		return unAddedCount;
	}

	RemoveDirectory(strPath) {
		const strDirectory = NormalizeDownloadPath(strPath);
		if (strDirectory.length === 0) {
			throw new TypeError("downloadable directory must not be empty.");
		}

		let unRemovedCount = 0;
		for (const strValue of this) {
			if ((strValue === strDirectory) || strValue.startsWith(`${strDirectory}/`)) {
				unRemovedCount += this.delete(strValue) ? 1 : 0;
			}
		}

		return unRemovedCount;
	}

	clear() {
		for (const strValue of this) {
			this.delete(strValue);
		}
	}

	Dispose() {
		this.clear();

		const bOwnerUnregistered = g_setDownloadableSets.delete(this);
		this.#m_bDisposed = true;

		return bOwnerUnregistered;
	}

	Restore() {
		this.#RequireActive();

		for (const strValue of this) {
			AddRequiredDownloadable(strValue);
		}

		return this;
	}

	#RequireActive() {
		if (this.#m_bDisposed) {
			throw new Error("Downloadables owner has been disposed.");
		}
	}

	#m_bDisposed;
}

const g_StringTables = new StringTableContainer();
const g_setDownloadables = new Downloadables();

module.exports = {
	DOWNLOADABLES: g_setDownloadables,
	DOWNLOADABLES_TABLE_NAME: g_strDownloadablesTableName,
	Downloadables,
	INVALID_STRING_INDEX: g_nInvalidStringIndex,
	INVALID_STRING_TABLE: g_nInvalidStringTable,
	STRING_TABLES: g_StringTables,
	StringTable,
	StringTableContainer,
	AddDownloadable,
	AddDownloadableDirectory,
	AddString,
	Find,
	GetAll,
	GetDownloadableIndex,
	GetDownloadablesList,
	GetDownloadablesTable,
	GetRequiredString,
	GetString,
	GetStringUserData,
	GetTrackedDownloadables,
	HasDownloadable,
	RestoreDownloadables,
	SetStringUserData,
	UntrackDownloadable,
	UntrackDownloadableDirectory,
};
