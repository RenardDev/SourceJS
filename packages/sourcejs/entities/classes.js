"use strict";

const { GetModule } = require("internal/runtime");

const g_EntityClassesRuntime = GetModule("entities/classes");

function NormalizeClassPattern(strClassPattern) {
	if (strClassPattern === undefined) {
		return "";
	}

	if (typeof strClassPattern !== "string") {
		throw new TypeError("Server class pattern must be a string.");
	}

	return strClassPattern.toLowerCase();
}

function MatchesClassPattern(strClassName, strClassPattern, bExactMatch = false) {
	const strNormalizedClassPattern = NormalizeClassPattern(strClassPattern);
	if (typeof strClassName !== "string") {
		throw new TypeError("Server class name must be a string.");
	}

	if (typeof bExactMatch !== "boolean") {
		throw new TypeError("Server class exact-match mode must be a boolean.");
	}

	if (!strNormalizedClassPattern) {
		return true;
	}

	const strNormalizedClassName = strClassName.toLowerCase();

	return bExactMatch ? strNormalizedClassName === strNormalizedClassPattern : strNormalizedClassName.includes(strNormalizedClassPattern);
}

function GetServerClassNamesByTable() {
	const mapServerClassNamesByTable = new Map();
	for (const ServerClass of g_EntityClassesRuntime.GetServerClasses()) {
		const strServerClassName = ServerClass?.Name;
		const strSendTableName = ServerClass?.Table?.Name;
		if ((typeof strServerClassName !== "string") || (typeof strSendTableName !== "string")) {
			throw new TypeError("Native server class records must contain string class and send-table names.");
		}

		mapServerClassNamesByTable.set(strSendTableName, strServerClassName);
	}

	return mapServerClassNamesByTable;
}

function CollectBaseServerClassNames(SendTable, mapServerClassNamesByTable, vecBaseServerClassNames, setVisitedSendTableNames) {
	if (!SendTable || setVisitedSendTableNames.has(SendTable.Name)) {
		return;
	}

	setVisitedSendTableNames.add(SendTable.Name);

	for (const SendProperty of SendTable.Properties) {
		if ((SendProperty.Name !== "baseclass") || !SendProperty.DataTable) {
			continue;
		}

		const strBaseServerClassName = mapServerClassNamesByTable.get(SendProperty.DataTable.Name);
		if (strBaseServerClassName && !vecBaseServerClassNames.includes(strBaseServerClassName)) {
			vecBaseServerClassNames.push(strBaseServerClassName);
		}

		const BaseSendTable = g_EntityClassesRuntime.GetSendTable(SendProperty.DataTable);
		if (!BaseSendTable) {
			throw new Error(`Unable to resolve baseclass send table: ${SendProperty.DataTable.Name}`);
		}

		CollectBaseServerClassNames(BaseSendTable, mapServerClassNamesByTable, vecBaseServerClassNames, setVisitedSendTableNames);
	}
}

function GetServerClassBaseClassNames(ServerClassReference) {
	const SendTable = g_EntityClassesRuntime.GetSendTable(ServerClassReference);
	const vecBaseServerClassNames = [];
	if (!SendTable) {
		return vecBaseServerClassNames;
	}

	CollectBaseServerClassNames(SendTable, GetServerClassNamesByTable(), vecBaseServerClassNames, new Set());

	return vecBaseServerClassNames;
}

class ServerClassGenerator {
	constructor(strClassPattern = "", GeneratorOptions = {}) {
		if ((GeneratorOptions === null) || (typeof GeneratorOptions !== "object") || Array.isArray(GeneratorOptions)) {
			throw new TypeError("Server class generator options must be an object.");
		}

		const bProvidedExactMatch = GeneratorOptions.Exact;
		const bExactMatch = (bProvidedExactMatch === undefined) ? false : bProvidedExactMatch;

		NormalizeClassPattern(strClassPattern);

		if (typeof bExactMatch !== "boolean") {
			throw new TypeError("Server class exact-match mode must be a boolean.");
		}

		this.Pattern = strClassPattern;
		this.Exact = bExactMatch;
	}

	*[Symbol.iterator]() {
		for (const ServerClass of g_EntityClassesRuntime.GetServerClasses()) {
			if (MatchesClassPattern(ServerClass.Name, this.Pattern, this.Exact)) {
				yield ServerClass;
			}
		}
	}
}

class ServerClassCollection {
	GetServerClasses() {
		return g_EntityClassesRuntime.GetServerClasses();
	}

	FindServerClass(strServerClassName) {
		return g_EntityClassesRuntime.FindServerClass(strServerClassName);
	}

	HasServerClass(strServerClassName) {
		const ServerClass = this.FindServerClass(strServerClassName);

		return (ServerClass !== null) && (ServerClass !== undefined);
	}

	FindServerClassBySendTableName(strSendTableName) {
		if ((typeof strSendTableName !== "string") || (strSendTableName.length === 0)) {
			throw new TypeError("Send-table name must be a non-empty string.");
		}

		for (const ServerClass of this.GetServerClasses()) {
			if (ServerClass.Table.Name === strSendTableName) {
				return ServerClass;
			}
		}

		return null;
	}

	GetServerClassProperty(strServerClassName, PropertyNameOrIndex) {
		const ServerClass = this.FindServerClass(strServerClassName);

		return ServerClass ? g_EntityClassesRuntime.GetServerClassProperty(ServerClass, PropertyNameOrIndex) : null;
	}

	GetServerClassProperties(strServerClassName) {
		const ServerClass = this.FindServerClass(strServerClassName);

		return ServerClass ? g_EntityClassesRuntime.GetServerClassProperties(ServerClass) : [];
	}

	FindServerClassPropertyOffset(strServerClassName, strPropertyName) {
		const ServerClass = this.FindServerClass(strServerClassName);

		return ServerClass ? g_EntityClassesRuntime.FindServerClassPropertyOffset(ServerClass, strPropertyName) : -1;
	}

	GetServerClassBaseClassNames(strServerClassName) {
		const ServerClass = this.FindServerClass(strServerClassName);

		return ServerClass ? GetServerClassBaseClassNames(ServerClass) : [];
	}

	GetServerClassSendTable(strServerClassName) {
		const ServerClass = this.FindServerClass(strServerClassName);

		return ServerClass ? g_EntityClassesRuntime.GetSendTable(ServerClass) : null;
	}

	GetSendTable(strServerClassName) {
		const ServerClass = this.FindServerClass(strServerClassName);

		return ServerClass ? g_EntityClassesRuntime.GetSendTable(ServerClass) : null;
	}

	[Symbol.iterator]() {
		return this.GetServerClasses()[Symbol.iterator]();
	}
}

const g_ServerClasses = new ServerClassCollection();

if (typeof g_EntityClassesRuntime.GetServerClasses === "function") {
	Object.assign(g_EntityClassesRuntime, {
		GetServerClassBaseClassNames,
		SERVER_CLASSES: g_ServerClasses,
		ServerClassCollection,
		ServerClassGenerator,
	});
}

module.exports = g_EntityClassesRuntime;
