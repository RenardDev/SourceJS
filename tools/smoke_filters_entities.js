#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strPackageRootPath = g_Path.resolve(__dirname, "..", "packages", "sourcejs");
const g_strEntitiesPath = g_Path.join(g_strPackageRootPath, "entities", "index.js");
const g_strIteratorPath = g_Path.join(g_strPackageRootPath, "filters", "iterator.js");
const g_strFiltersPath = g_Path.join(g_strPackageRootPath, "filters", "entities.js");
const g_strDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "filters-entities.md");
const g_OriginalModuleLoad = g_Module._load;
const g_vecCachePaths = [g_strEntitiesPath, g_strIteratorPath, g_strFiltersPath];
const g_mapOriginalCacheEntries = new Map(g_vecCachePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));

const g_vecTraceCalls = [];
const g_setCompletedContracts = new Set();
let g_unExecutedDocumentationBlockCount = 0;
const g_RejectDocumentationConsole = () => {
	throw new Error("Entity filter documentation must use the typed logger.");
};
const g_ConsoleDouble = new Proxy({}, { get: g_RejectDocumentationConsole });

function CreateEntityFixture(unIndex, strClassName, bValid, bFree, nHealth = 100, nMaximumHealth = 100, nNetworkSerialNumber = 1) {
	return {
		ClassName: strClassName,
		Free: bFree,
		Index: unIndex,
		NetworkSerialNumber: nNetworkSerialNumber,
		Valid: bValid,
		CallEntityInputFunction(strName) {
			this.LastInput = strName;

			return true;
		},
		// Exact SDK property names are not project-owned JavaScript fields.
		GetEntityPropertyInt(strName) {
			if (strName === "m_iHealth") {
				return nHealth;
			}

			if (strName === "m_iMaxHealth") {
				return nMaximumHealth;
			}

			throw new ReferenceError(`Unknown property: ${strName}`);
		},
	};
}

const g_vecEntities = [
	CreateEntityFixture(0, "worldspawn", true, false),
	CreateEntityFixture(1, "prop_physics", true, false, 50, 100),
	CreateEntityFixture(2, "weapon_rifle", true, false, 100, 100),
	CreateEntityFixture(3, "npc_common", false, false, 30, 100),
	CreateEntityFixture(4, "prop_door_rotating", true, true, 100, 100),
	CreateEntityFixture(8, "prop_physics_override", true, false, 100, 100),
];

const g_NativeEntities = {
	Entity(unIndex) {
		if (!Number.isSafeInteger(unIndex)) {
			throw new TypeError("Entity index must be an integer.");
		}

		const CurrentEntity = g_vecEntities.find((Entry) => Entry.Index === unIndex);
		if (!CurrentEntity) {
			throw new RangeError(`Unknown entity index ${unIndex}.`);
		}

		return CurrentEntity;
	},
	GetAllEntities() {
		return g_vecEntities.slice();
	},
};

// Trace Handle is an encoded signed 32-bit SDK value, not a native address.
const g_TraceAPI = {
	ContentMasks: { Shot: 0x4600400B },
	TraceType: { Everything: 0 },
	TraceRay(Ray, unContentsMask, Filter) {
		g_Assert.equal(Filter.ShouldHitEntity({ Index: -1, Handle: -1, Exists: false }, unContentsMask), true, "Unindexed trace candidates must not be passed to the strict entity-index filter.");
		g_Assert.equal(Filter.ShouldHitEntity({ Index: 1, Handle: 1, Exists: true }, unContentsMask), false, "The adapter must still ignore configured indexes.");
		g_Assert.equal(Filter.ShouldHitEntity({ Index: 7, Handle: 7, Exists: true }, unContentsMask), true, "The adapter must accept other indexed candidates.");
		g_vecTraceCalls.push({ Ray, ContentsMask: unContentsMask, Filter });

		return { Hit: true, EntityIndex: Filter.ShouldHitEntity({ Index: 8, Handle: 8, Exists: true }, unContentsMask) ? 8 : -1 };
	},
};

function InstallDependency(strModulePath, ExportedValue) {
	require.cache[strModulePath] = { exports: ExportedValue, filename: strModulePath, id: strModulePath, loaded: true };
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
}

function CreateDocumentationRequire(Filters, LogInfo = () => undefined) {
	return function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "filters/entities") {
			return Filters;
		}

		if (strModuleName === "engines/trace") {
			return g_TraceAPI;
		}

		if (strModuleName === "entities/entity") {
			return { Entity: g_NativeEntities.Entity };
		}

		if (strModuleName === "loggers") {
			// Calls are controlled here; native formatting and log sinks are not exercised.
			return { LogInfo };
		}

		throw new Error(`Unexpected documentation module: ${strModuleName}`);
	};
}

function VerifyDocumentationRequireContracts() {
	const Filters = {};
	const vecLogs = [];
	const CaptureLog = (...vecArguments) => {
		vecLogs.push(vecArguments);
	};
	const DocumentationRequire = CreateDocumentationRequire(Filters, CaptureLog);
	g_Assert.equal(DocumentationRequire("filters/entities"), Filters);
	g_Assert.equal(DocumentationRequire("engines/trace"), g_TraceAPI);
	g_Assert.equal(DocumentationRequire("entities/entity").Entity, g_NativeEntities.Entity);
	DocumentationRequire("loggers").LogInfo("Entity documentation %s", "probe");
	g_Assert.deepEqual(vecLogs, [["Entity documentation %s", "probe"]]);
	g_Assert.throws(() => DocumentationRequire("Unknown"), /Unexpected documentation module/);
	g_Assert.throws(() => g_ConsoleDouble.log("Unexpected console output"), /must use the typed logger/);
	g_setCompletedContracts.add("DOCUMENTATION_REQUIRE");
}

function VerifyFilterEvaluationOrder(Filters) {
	for (const IteratorClass of [Filters.BaseEntityIterator, Filters.EntityIterator]) {
		const strRequiredFilterName = "DocumentationRequiredOrder";
		const strExcludedFilterName = "DocumentationExcludedOrder";
		const vecOriginalFilters = [...IteratorClass.Filters];
		const vecCalls = [];
		let bRequiredResult = true;
		let bExcludedResult = false;
		const RequiredCallback = () => {
			vecCalls.push("REQUIRED");

			return bRequiredResult;
		};
		const ExcludedCallback = () => {
			vecCalls.push("EXCLUDED");

			return bExcludedResult;
		};
		const Candidate = {
			Valid: true,
			Free: false,
			get ClassName() {
				vecCalls.push("CLASS");

				return "weapon_rifle";
			},
		};
		g_Assert.equal(IteratorClass.HasFilter(strRequiredFilterName), false);
		g_Assert.equal(IteratorClass.HasFilter(strExcludedFilterName), false);

		try {
			IteratorClass.RegisterFilter(strRequiredFilterName, RequiredCallback);
			IteratorClass.RegisterFilter(strExcludedFilterName, ExcludedCallback);

			const Iterator = new IteratorClass("prop_physics", true, strRequiredFilterName, strExcludedFilterName);
			g_Assert.equal(Iterator.IsValid(Candidate), false);
			g_Assert.deepEqual(vecCalls, ["REQUIRED", "EXCLUDED", "CLASS"]);
			g_Assert.equal(IteratorClass.UnregisterFilter(strRequiredFilterName), true);
			vecCalls.length = 0;
			g_Assert.throws(() => Iterator.IsValid(Candidate), ReferenceError, "A later class mismatch must not hide a missing required filter.");
			g_Assert.deepEqual(vecCalls, []);
			Iterator.IteratorItems = [];
			g_Assert.deepEqual(Iterator.Resolve(), [], "An empty replacement source does not visit any named filter.");

			if (IteratorClass === Filters.EntityIterator) {
				g_Assert.doesNotThrow(() => g_Assert.equal(Iterator.IsValid({ Valid: false, Free: false }), false));
			} else {
				g_Assert.throws(() => Iterator.IsValid({ Valid: false, Free: false }), ReferenceError);
			}

			IteratorClass.RegisterFilter(strRequiredFilterName, RequiredCallback);
			g_Assert.equal(IteratorClass.UnregisterFilter(strExcludedFilterName), true);
			bRequiredResult = false;
			vecCalls.length = 0;
			g_Assert.equal(Iterator.IsValid(Candidate), false, "A false required result must skip the missing excluded filter.");
			g_Assert.deepEqual(vecCalls, ["REQUIRED"]);
			Iterator.RequiredFilterNames.push("DocumentationMissingOrder");
			g_Assert.equal(Iterator.IsValid(Candidate), false);
			bRequiredResult = true;
			g_Assert.throws(() => Iterator.IsValid(Candidate), ReferenceError);
			Iterator.RequiredFilterNames.pop();
			IteratorClass.RegisterFilter(strExcludedFilterName, ExcludedCallback);
			bExcludedResult = true;
			Iterator.ClassNames = null;
			vecCalls.length = 0;
			g_Assert.equal(Iterator.IsValid(Candidate), false, "Excluded results precede even class-selector validation.");
			g_Assert.deepEqual(vecCalls, ["REQUIRED", "EXCLUDED"]);
			bExcludedResult = false;
			vecCalls.length = 0;
			g_Assert.throws(() => Iterator.IsValid(Candidate), TypeError);
			g_Assert.deepEqual(vecCalls, ["REQUIRED", "EXCLUDED"]);
			Iterator.ClassNames = ["prop_physics", 0];
			g_Assert.doesNotThrow(() => g_Assert.equal(Iterator.MatchesClassName({ ClassName: "prop_physics" }), true), "Matching stops before a later malformed selector.");
			g_Assert.throws(() => Iterator.MatchesClassName({ ClassName: "weapon_rifle" }), TypeError);
		} finally {
			for (const strFilterName of [strRequiredFilterName, strExcludedFilterName]) {
				if (IteratorClass.HasFilter(strFilterName)) {
					g_Assert.equal(IteratorClass.UnregisterFilter(strFilterName), true);
				}
			}
		}

		g_Assert.deepEqual([...IteratorClass.Filters], vecOriginalFilters);
	}

	g_setCompletedContracts.add("EVALUATION_ORDER");
}

function VerifyIndependentScanDiagnostic(strExampleSource, Filters) {
	const unExpectedScanCount = 2;
	const OriginalGetAllEntities = g_NativeEntities.GetAllEntities;
	const vecWorlds = [[g_vecEntities[0]], g_vecEntities.filter(Entity => Entity.Valid && !Entity.Free)];
	const vecReports = [];
	const CaptureReport = (...vecArguments) => {
		vecReports.push(vecArguments);
	};
	const DocumentationRequire = CreateDocumentationRequire(Filters, CaptureReport);
	const RunExample = new Function("require", "console", strExampleSource);
	let unScanCount = 0;
	g_NativeEntities.GetAllEntities = () => vecWorlds[unScanCount++].slice();
	try {
		RunExample(DocumentationRequire, g_ConsoleDouble);
	} finally {
		g_NativeEntities.GetAllEntities = OriginalGetAllEntities;
	}

	g_Assert.equal(unScanCount, unExpectedScanCount);
	g_Assert.deepEqual(vecReports, [["EntityValidityScans AllEntityCountAtFirstScan=%d ValidEntityCountAtSecondScan=%d", 1, 4]], "Independent scans must be logged separately, not subtracted into an invalid-entity count.");
	g_setCompletedContracts.add("SCAN_DIAGNOSTIC");
}

function VerifyTemporaryFilterCleanup(strExampleSource, Filters, DocumentationRequire) {
	const unExpectedScenarioCount = 15;
	const OriginalMap = Filters.EntityIterator.prototype.Map;
	const OriginalUnregisterFilter = Filters.EntityIterator.UnregisterFilter;
	const OriginalMapDescriptor = Object.getOwnPropertyDescriptor(Filters.EntityIterator.prototype, "Map");
	const OriginalUnregisterDescriptor = Object.getOwnPropertyDescriptor(Filters.EntityIterator, "UnregisterFilter");
	const RunExample = new Function("require", "console", strExampleSource);
	const vecPrimaryCases = [
		{ Throws: false },
		{ Throws: true, Value: new Error("Controlled entity filtering failure.") },
		{ Throws: true, Value: null },
		{ Throws: true, Value: undefined },
		{ Throws: true, Value: 0 },
	];
	let unScenarioCount = 0;
	for (const PrimaryCase of vecPrimaryCases) {
		for (const strMode of ["SUCCESS", "FALSE", "THROWS"]) {
			g_Assert.equal(Filters.EntityIterator.HasFilter("PhysicsProp"), false);

			const CleanupFailure = new Error("Controlled entity-filter cleanup failure.");
			let unUnregisterCallCount = 0;
			let CapturedFailure = null;
			Filters.EntityIterator.prototype.Map = function MapControlledEntities(...vecArguments) {
				const vecValues = Reflect.apply(OriginalMap, this, vecArguments);
				if (PrimaryCase.Throws) {
					throw PrimaryCase.Value;
				}

				return vecValues;
			};
			Filters.EntityIterator.UnregisterFilter = function UnregisterControlledFilter(...vecArguments) {
				const bResult = Reflect.apply(OriginalUnregisterFilter, this, vecArguments);
				++unUnregisterCallCount;

				if (strMode === "THROWS") {
					throw CleanupFailure;
				}

				return (strMode === "FALSE") ? false : bResult;
			};

			try {
				RunExample(DocumentationRequire, g_ConsoleDouble);
			} catch (Failure) {
				CapturedFailure = { Value: Failure };
			} finally {
				if (OriginalMapDescriptor === undefined) {
					delete Filters.EntityIterator.prototype.Map;
				} else {
					Object.defineProperty(Filters.EntityIterator.prototype, "Map", OriginalMapDescriptor);
				}

				if (OriginalUnregisterDescriptor === undefined) {
					delete Filters.EntityIterator.UnregisterFilter;
				} else {
					Object.defineProperty(Filters.EntityIterator, "UnregisterFilter", OriginalUnregisterDescriptor);
				}

				if (Filters.EntityIterator.HasFilter("PhysicsProp")) {
					g_Assert.equal(OriginalUnregisterFilter.call(Filters.EntityIterator, "PhysicsProp"), true);
				}
			}

			g_Assert.equal(unUnregisterCallCount, 1, "Every operation outcome must attempt unregistration once.");
			g_Assert.deepEqual(Object.getOwnPropertyDescriptor(Filters.EntityIterator.prototype, "Map"), OriginalMapDescriptor);
			g_Assert.deepEqual(Object.getOwnPropertyDescriptor(Filters.EntityIterator, "UnregisterFilter"), OriginalUnregisterDescriptor);

			if (!PrimaryCase.Throws && (strMode === "SUCCESS")) {
				g_Assert.equal(CapturedFailure, null);
			} else {
				g_Assert.notEqual(CapturedFailure, null);
				let ReportedCleanupFailure = CapturedFailure.Value;

				if (PrimaryCase.Throws) {
					if (strMode === "SUCCESS") {
						g_Assert.strictEqual(CapturedFailure.Value, PrimaryCase.Value);
					} else {
						g_Assert(CapturedFailure.Value instanceof AggregateError);
						g_Assert.equal(CapturedFailure.Value.errors.length, 2);
						g_Assert.strictEqual(CapturedFailure.Value.errors[0], PrimaryCase.Value);
						ReportedCleanupFailure = CapturedFailure.Value.errors[1];
					}
				}

				if (strMode === "THROWS") {
					g_Assert.strictEqual(ReportedCleanupFailure, CleanupFailure);

				} else if (strMode === "FALSE") {
					g_Assert(ReportedCleanupFailure instanceof Error);
					g_Assert.match(ReportedCleanupFailure.message, /filter cleanup failed/);
				}
			}

			++unScenarioCount;
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);
	g_setCompletedContracts.add("FILTER_CLEANUP");
}

function VerifyMutableEntityFilterState(Filters) {
	const vecClassNameInput = ["prop_physics"];
	const MutableIterator = new Filters.BaseEntityIterator(vecClassNameInput);
	vecClassNameInput.push("weapon_rifle");
	g_Assert.deepEqual(MutableIterator.ClassNames, ["prop_physics"]);

	const OtherClassEntity = g_vecEntities[2];
	MutableIterator.IteratorItems = [OtherClassEntity];
	g_Assert.deepEqual(MutableIterator.Resolve(), [OtherClassEntity], "Replacing the source must not be documented as preserving the original class-filter pipeline.");
	MutableIterator.IteratorPredicate = (EntityValue) => EntityValue.ClassName === "prop_physics";
	g_Assert.deepEqual(MutableIterator.Resolve(), []);

	MutableIterator.ClassNames = null;
	g_Assert.throws(() => MutableIterator.MatchesClassName(OtherClassEntity), TypeError);
	MutableIterator.ClassNames = [];
	MutableIterator.ExactMatch = 1;
	g_Assert.throws(() => MutableIterator.MatchesClassName(OtherClassEntity), TypeError);

	const vecIgnoredIndexes = [1];
	const MutableTraceFilter = new Filters.EntityTraceFilter(vecIgnoredIndexes, 0);
	vecIgnoredIndexes.push(8);
	g_Assert.equal(MutableTraceFilter.ShouldHitEntity(8), true);
	MutableTraceFilter.IgnoredEntityIndexes.add(8);
	g_Assert.equal(MutableTraceFilter.ShouldHitEntity(8), false);
	MutableTraceFilter.IgnoredEntityIndexes = [];
	g_Assert.throws(() => MutableTraceFilter.ShouldHitEntity(8), TypeError);
	MutableTraceFilter.TraceType = 1.5;
	g_Assert.throws(() => MutableTraceFilter.GetTraceType(), TypeError);

	const strFilterName = "DocumentationTruthyFilter";
	g_Assert.equal(Filters.BaseEntityIterator.HasFilter(strFilterName), false);
	try {
		Filters.BaseEntityIterator.RegisterFilter(strFilterName, () => "keep");
		const RequiredFilterIterator = new Filters.BaseEntityIterator(null, true, strFilterName);
		g_Assert.equal(RequiredFilterIterator.IsValid(g_vecEntities[1]), true, "Registered results use truthiness, not strict Boolean identity.");
		Filters.BaseEntityIterator.UnregisterFilter(strFilterName);
		g_Assert.throws(() => RequiredFilterIterator.Resolve(), ReferenceError);
	} finally {
		if (Filters.BaseEntityIterator.HasFilter(strFilterName)) {
			Filters.BaseEntityIterator.UnregisterFilter(strFilterName);
		}
	}

	g_Assert.throws(() => {
		Filters.BaseEntityIterator.Filters = new Map();
	}, TypeError);

	g_setCompletedContracts.add("MUTABLE");
}

function VerifyEntityScanSnapshots(Filters) {
	const OriginalGetAllEntities = g_NativeEntities.GetAllEntities;
	const vecRegisteredNames = Filters.BaseEntityIterator.GetFilterNames();
	let unScanCount = 0;
	g_NativeEntities.GetAllEntities = () => {
		++unScanCount;

		return OriginalGetAllEntities();
	};

	try {
		const DefaultFilterValues = Filters.BaseEntityIterator.DefaultFilters();
		g_Assert.equal(Object.getPrototypeOf(DefaultFilterValues), null);
		g_Assert.equal(unScanCount, vecRegisteredNames.length, "DefaultFilters must be documented as a separate scan for each registered filter.");
	} finally {
		g_NativeEntities.GetAllEntities = OriginalGetAllEntities;
	}

	g_setCompletedContracts.add("SCANS");
}

function VerifyWakeIdentityRevalidation(strExampleSource, DocumentationRequire) {
	const OriginalEntityResolver = g_NativeEntities.Entity;
	const RunExample = new Function("require", "console", strExampleSource);
	const vecChangedEntityCases = [
		{ NetworkSerialNumber: 2 },
		{ ClassName: "weapon_rifle" },
		{ Valid: false },
		{ Free: true },
		null,
	];

	try {
		for (const ChangedFields of vecChangedEntityCases) {
			let unInputCallCount = 0;
			g_NativeEntities.Entity = (unIndex) => {
				if (ChangedFields === null) {
					return null;
				}

				return {
					...OriginalEntityResolver(unIndex),
					...ChangedFields,
					CallEntityInputFunction() {
						++unInputCallCount;

						return true;
					},
				};
			};
			RunExample(DocumentationRequire, g_ConsoleDouble);
			g_Assert.equal(unInputCallCount, 0, "Wake must reject a changed generation, class, validity, free state, or missing entity.");
		}

		g_NativeEntities.Entity = (unIndex) => ({ ...OriginalEntityResolver(unIndex), CallEntityInputFunction: undefined });
		g_Assert.throws(() => RunExample(DocumentationRequire, g_ConsoleDouble), /selected SDK/);
	} finally {
		g_NativeEntities.Entity = OriginalEntityResolver;
	}

	g_setCompletedContracts.add("WAKE");
}

function VerifyWorldEntityFilters(Filters) {
	const strExamplePath = g_Path.resolve(__dirname, "..", "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecMatch = strExample.match(/\tLogResult\("filters\/entities current state",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecMatch, "world entity filter callback must remain available");

	const RunExample = new Function("GetAllEntities", "GetValidEntities", "EntityIterator", "EntityTraceFilter", "BaseEntityIterator", "TraceType", "GetEntityIndexes", "LogResult", vecMatch[0]);
	const OriginalGetAllEntities = g_NativeEntities.GetAllEntities;

	try {
		for (const vecEntities of [[], g_vecEntities]) {
			g_NativeEntities.GetAllEntities = () => vecEntities.slice();

			let Result = undefined;
			RunExample(Filters.GetAllEntities, Filters.GetValidEntities, Filters.EntityIterator, Filters.EntityTraceFilter, Filters.BaseEntityIterator, g_TraceAPI.TraceType, (vecValues) => vecValues.map((EntityInstance) => EntityInstance.Index), (strLabel, Callback) => {
				g_Assert.equal(strLabel, "filters/entities current state");
				Result = Callback();
			});
			g_Assert.deepEqual(Result.All, vecEntities.map((EntityInstance) => EntityInstance.Index));
			g_Assert.deepEqual(Result.Valid, vecEntities.filter((EntityInstance) => EntityInstance.Valid && !EntityInstance.Free).map((EntityInstance) => EntityInstance.Index));
			g_Assert.deepEqual(Result.Worldspawn, (vecEntities.length === 0) ? [] : [0]);
			g_Assert.deepEqual(Result.TraceFilter.Ignored, Result.Worldspawn);
			g_Assert.equal(Result.TraceFilter.ShouldHitFirstUnignored, (vecEntities.length === 0) ? null : true);
			g_Assert.equal(Result.TraceFilter.TraceType, g_TraceAPI.TraceType.Everything);
		}
	} finally {
		g_NativeEntities.GetAllEntities = OriginalGetAllEntities;
	}

	g_setCompletedContracts.add("WORLD");
}

try {
	for (const strModulePath of g_vecCachePaths) {
		delete require.cache[strModulePath];
	}

	InstallDependency(g_strEntitiesPath, g_NativeEntities);

	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "entities") {
			return g_NativeEntities;
		}

		if (strRequestName === "filters/iterator") {
			return require(g_strIteratorPath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	const g_Filters = require(g_strFiltersPath);
	g_Module._load = g_OriginalModuleLoad;

	const g_DocumentationRequire = CreateDocumentationRequire(g_Filters);
	VerifyDocumentationRequireContracts();

	g_Assert.deepEqual(Object.keys(g_Filters).sort(), [
		"BaseEntityIterator",
		"EntityIterator",
		"EntityTraceFilter",
		"GetAllEntities",
		"GetValidEntities",
	]);
	g_Assert.deepEqual(new g_Filters.BaseEntityIterator().ToArray().map((Entry) => Entry.Index), [0, 1, 2, 3, 4, 8]);
	g_Assert.deepEqual(new g_Filters.EntityIterator().ToArray().map((Entry) => Entry.Index), [0, 1, 2, 8]);
	g_Assert.deepEqual(new g_Filters.BaseEntityIterator("weapon_rifle").ToArray().map((Entry) => Entry.Index), [2]);
	g_Assert.deepEqual(new g_Filters.BaseEntityIterator("prop", false).ToArray().map((Entry) => Entry.Index), [1, 4, 8]);
	g_Assert.deepEqual(new g_Filters.EntityIterator("prop", false).ToArray().map((Entry) => Entry.Index), [1, 8]);
	g_Assert.deepEqual(new g_Filters.BaseEntityIterator(new Set(["weapon_rifle"])).ToArray().map((Entry) => Entry.Index), [2]);
	g_Assert.deepEqual(new g_Filters.BaseEntityIterator(null, true, new Set(["Valid"])).ToArray().map((Entry) => Entry.Index), [0, 1, 2, 8]);
	g_Assert.deepEqual(new g_Filters.BaseEntityIterator(null, true, null, "Valid").ToArray().map((Entry) => Entry.Index), [3, 4]);
	g_Assert.deepEqual(g_Filters.GetAllEntities().map((Entry) => Entry.Index), [0, 1, 2, 3, 4, 8]);
	g_Assert.deepEqual(g_Filters.GetValidEntities().map((Entry) => Entry.Index), [0, 1, 2, 8]);
	g_Assert.deepEqual([...g_Filters.BaseEntityIterator.DefaultFilters().Valid].map((Entry) => Entry.Index), [0, 1, 2, 8]);
	g_Assert.deepEqual([...g_Filters.EntityIterator.DefaultFilters().All].map((Entry) => Entry.Index), [0, 1, 2, 8]);
	g_Assert.deepEqual(Object.keys(g_Filters.BaseEntityIterator.DefaultFilters()).sort(), ["All", "Valid"]);
	g_Assert.equal(g_Filters.BaseEntityIterator.HasFilter("all"), false);
	g_Assert.equal(g_Filters.EntityIterator.HasFilter("valid"), false);
	g_Assert.throws(() => new g_Filters.BaseEntityIterator("", true), /non-empty strings/);
	g_Assert.throws(() => new g_Filters.BaseEntityIterator(["prop_physics", 7], true), /non-empty strings/);
	g_Assert.throws(() => new g_Filters.BaseEntityIterator(null, 1), /bExactMatch must be a boolean/);

	const g_ClassIterator = new g_Filters.BaseEntityIterator();
	g_Assert.equal(Object.hasOwn(g_ClassIterator, "m_vecClassNames"), false);
	g_Assert.equal(Object.hasOwn(g_ClassIterator, "m_bExactMatch"), false);
	g_ClassIterator.ClassNames = ["prop"];
	g_ClassIterator.ExactMatch = false;
	g_Assert.deepEqual(g_ClassIterator.ToArray().map((Entry) => Entry.Index), [1, 4, 8]);

	const g_OriginalGetAllEntities = g_NativeEntities.GetAllEntities;
	// Deliberate legacy native/public fields are negative fixtures.
	const g_LegacyEntity = { m_unIndex: 7, m_strClassName: "prop_physics", m_bValid: true, m_bFree: false };

	try {
		g_NativeEntities.GetAllEntities = () => [g_LegacyEntity];
		g_Assert.deepEqual(g_Filters.GetValidEntities(), []);
		g_Assert.deepEqual(new g_Filters.EntityIterator().ToArray(), []);
		g_Assert.throws(() => new g_Filters.BaseEntityIterator("prop_physics").ToArray(), /string ClassName/);
	} finally {
		g_NativeEntities.GetAllEntities = g_OriginalGetAllEntities;
	}

	const g_TraceFilter = new g_Filters.EntityTraceFilter([1, { Index: 2 }], 0);
	g_Assert.deepEqual([...g_TraceFilter.IgnoredEntityIndexes], [1, 2]);
	g_Assert.equal(Object.hasOwn(g_TraceFilter, "m_setIgnoredEntityIndexes"), false);
	g_Assert.equal(Object.hasOwn(g_TraceFilter, "m_nTraceType"), false);
	g_Assert.equal(g_TraceFilter.ShouldHitEntity({ Index: 1 }), false);
	g_Assert.equal(g_TraceFilter.ShouldHitEntity({ Index: 3 }), true);
	g_Assert.equal(g_TraceFilter.GetTraceType(), 0);
	g_Assert.throws(() => new g_Filters.EntityTraceFilter([{ m_unIndex: 2 }], 0), /non-negative safe integer Index/);
	g_Assert.throws(() => g_TraceFilter.ShouldHitEntity({ m_unIndex: 1 }), /non-negative safe integer Index/);
	g_TraceFilter.IgnoredEntityIndexes = new Set([8]);
	g_TraceFilter.TraceType = 1;
	g_Assert.equal(g_TraceFilter.ShouldHitEntity({ Index: 8 }), false);
	g_Assert.equal(g_TraceFilter.GetTraceType(), 1);
	g_TraceFilter.TraceType = 0;

	g_Assert.equal(Object.hasOwn(g_Filters, "BaseEntityIter"), false);
	g_Assert.equal(Object.hasOwn(g_Filters, "EntityIter"), false);
	g_Assert.equal(Object.hasOwn(g_Filters, "moduleName"), false);
	g_Assert.equal(Object.hasOwn(g_Filters, "default"), false);

	const g_unExpectedDocumentationBlockCount = 9;
	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	g_Assert.equal(g_vecBlocks.length, g_unExpectedDocumentationBlockCount, "filters/entities documentation must contain nine executable JavaScript blocks");

	VerifyFilterEvaluationOrder(g_Filters);
	const g_unIndependentScanBlockIndex = 1;
	const g_unTemporaryFilterBlockIndex = 4;
	VerifyIndependentScanDiagnostic(g_vecBlocks[g_unIndependentScanBlockIndex], g_Filters);
	VerifyTemporaryFilterCleanup(g_vecBlocks[g_unTemporaryFilterBlockIndex], g_Filters, g_DocumentationRequire);
	VerifyMutableEntityFilterState(g_Filters);
	VerifyEntityScanSnapshots(g_Filters);
	const g_unWakeIdentityBlockIndex = 8;
	VerifyWakeIdentityRevalidation(g_vecBlocks[g_unWakeIdentityBlockIndex], g_DocumentationRequire);

	for (const strBlock of g_vecBlocks) {
		const RunBlock = new Function("require", "console", strBlock);
		RunBlock(g_DocumentationRequire, g_ConsoleDouble);
		++g_unExecutedDocumentationBlockCount;
	}

	g_Assert.equal(g_unExecutedDocumentationBlockCount, g_vecBlocks.length, "Every entity-filter documentation block must execute.");

	g_Assert.equal(g_Filters.EntityIterator.HasFilter("PhysicsProp"), false, "documentation must unregister its temporary filter");
	const g_unExpectedTraceCallCount = 1;
	g_Assert.equal(g_vecTraceCalls.length, g_unExpectedTraceCallCount, "documentation must execute one engine trace");
	g_Assert.equal(g_vecTraceCalls[0].Filter.GetTraceType(), g_TraceAPI.TraceType.Everything);
	g_Assert.equal(g_vecEntities[1].LastInput, "Wake", "documentation must re-resolve and wake the current physics prop");

	for (const strExportName of Object.keys(g_Filters)) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation must cover ${strExportName}`);
	}

	for (const strMemberName of [
		"RegisterFilter",
		"UnregisterFilter",
		"HasFilter",
		"GetFilterNames",
		"DefaultFilters",
		"Iterate",
		"GetIteratorFilterCallback",
		"IsValid",
		"Resolve",
		"Values",
		"ToArray",
		"Count",
		"First",
		"Filter",
		"Map",
		"ForEach",
		"MatchesClassName",
		"ShouldHitEntity",
		"GetTraceType",
	]) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `documentation must cover ${strMemberName}`);
	}

	for (const strForbiddenTerm of [
		"Generated by",
		"generate_api_docs",
		"console.log(instance)",
		"console.log(result)",
		"`BaseEntityIter`",
		"`EntityIter`",
	]) {
		g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `documentation must not contain ${strForbiddenTerm}`);
	}

	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable entity-filter documentation must use typed logging.");

	VerifyWorldEntityFilters(g_Filters);

	g_Assert.deepEqual([...g_setCompletedContracts].sort(), [
		"EVALUATION_ORDER",
		"SCAN_DIAGNOSTIC",
		"FILTER_CLEANUP",
		"MUTABLE",
		"SCANS",
		"WAKE",
		"WORLD",
		"DOCUMENTATION_REQUIRE",
	].sort(), "All entity-filter contract helpers must execute.");

	console.log("[  OK  ] filters/entities contracts and documentation passed with entity/trace doubles; native SDK execution not exercised");
} finally {
	g_Module._load = g_OriginalModuleLoad;

	for (const [strModulePath, CacheEntry] of g_mapOriginalCacheEntries) {
		delete require.cache[strModulePath];

		if (CacheEntry !== undefined) {
			require.cache[strModulePath] = CacheEntry;
		}
	}
}
