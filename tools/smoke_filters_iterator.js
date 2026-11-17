#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strPackagePath = g_Path.resolve(__dirname, "..", "packages", "sourcejs", "filters", "iterator.js");
const g_strDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "filters-iterator.md");
const g_strExamplePath = g_Path.resolve(__dirname, "..", "examples", "plugins", "disabled", "api-world-objects", "index.js");
const g_OriginalCacheEntry = require.cache[g_strPackagePath];
const g_RejectDocumentationConsole = () => {
	throw new Error("Iterator documentation must use the typed logger.");
};
const g_ConsoleDouble = new Proxy({}, { get: g_RejectDocumentationConsole });

try {
	delete require.cache[g_strPackagePath];

	const { FromItems, IteratorFilter, IteratorObject } = require(g_strPackagePath);

	function* GenerateValues() {
		yield 1;
		yield 2;
	}

	class NumberIterator extends IteratorObject {
		static Iterator() {
			return [1, 2, 3, 4];
		}
	}

	class ScalarIterator extends IteratorObject {
		static Iterator() {
			return 42;
		}
	}

	const g_vecRegistryItems = [1];
	let g_unRegistryScanCount = 0;

	class RegistryIterator extends IteratorObject {
		static Iterator() {
			g_unRegistryScanCount++;

			return g_vecRegistryItems;
		}
	}

	class PermissiveIteratorFilter extends IteratorFilter {
		Resolve() {
			return [];
		}
	}

	// Deliberately omits registry validation to test the documentation's failure guard.
	class PermissiveIteratorObject {
	}

	function ReadExampleCallback(strExampleSource, strLabel) {
		const strMarker = `LogResult("${strLabel}", () => {`;
		const nMarkerOffset = strExampleSource.indexOf(strMarker);
		if (nMarkerOffset < 0) {
			throw new Error(`Missing example callback: ${strLabel}`);
		}

		const unBodyOffset = nMarkerOffset + strMarker.length;
		const nEndOffset = strExampleSource.indexOf("\n\t});", unBodyOffset);
		if (nEndOffset < 0) {
			throw new Error(`Missing example callback terminator: ${strLabel}`);
		}

		return strExampleSource.slice(unBodyOffset, nEndOffset);
	}

	function ExtractJavaScriptBlocks(strMarkdown) {
		return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	}

	function CreateDocumentationRequire(IteratorAPI, FiltersAPI = null, LogInfo = () => undefined) {
		return strModuleName => {
			if (strModuleName === "filters/iterator") {
				return IteratorAPI;
			}

			if ((strModuleName === "filters") && (FiltersAPI !== null)) {
				return FiltersAPI;
			}

			if (strModuleName === "loggers") {
				return { LogInfo };
			}

			throw new Error(`Unexpected documentation module: ${strModuleName}`);
		};
	}

	function VerifyDocumentationRequireContracts() {
		const IteratorAPI = {};
		const FiltersAPI = { GetAllPlayers: () => [] };
		const vecLogCalls = [];
		const LogInfo = (...vecArguments) => vecLogCalls.push(vecArguments);
		const DocumentationRequire = CreateDocumentationRequire(IteratorAPI, FiltersAPI, LogInfo);
		g_Assert.strictEqual(DocumentationRequire("filters/iterator"), IteratorAPI);
		g_Assert.strictEqual(DocumentationRequire("filters"), FiltersAPI);
		g_Assert.strictEqual(DocumentationRequire("loggers").LogInfo, LogInfo);
		DocumentationRequire("loggers").LogInfo("IteratorProbe Count=%d", 2);
		g_Assert.deepEqual(vecLogCalls, [["IteratorProbe Count=%d", 2]]);
		g_Assert.throws(() => DocumentationRequire("UnknownModule"), /Unexpected documentation module/);
		g_Assert.throws(() => g_ConsoleDouble.log, /typed logger/);
	}

	function RunIteratorErrorBlock(strErrorBlock, IteratorAPI) {
		const vecErrorMessages = [];
		const LogInfo = (strFormat, strMessage) => {
			g_Assert.equal(strFormat, "IteratorValidation Error=%s");
			g_Assert.equal(typeof strMessage, "string");
			vecErrorMessages.push(strMessage);
		};
		const RunBlock = new Function("require", "console", strErrorBlock);
		RunBlock(CreateDocumentationRequire(IteratorAPI, null, LogInfo), g_ConsoleDouble);

		return vecErrorMessages;
	}

	function VerifyRegistryOwnershipAndValidationOrder() {
		const Record = { Value: 1 };
		const vecSourceRecords = [Record];

		class ParentIterator extends IteratorObject {
			static Iterator() {
				return vecSourceRecords;
			}
		}

		class ChildIterator extends ParentIterator {
		}

		ParentIterator.RegisterFilter("Parent", () => true);
		try {
			g_Assert.equal(Object.hasOwn(ChildIterator, "Filters"), false);
			g_Assert.strictEqual(ChildIterator.Filters, ParentIterator.Filters);
			g_Assert.equal(ChildIterator.HasFilter("Parent"), false, "The first child registry use must create an empty own Map, not reuse or copy the parent Map.");
			g_Assert.notStrictEqual(ChildIterator.Filters, ParentIterator.Filters);
			g_Assert.deepEqual(ChildIterator.GetFilterNames(), []);
			g_Assert.equal(ParentIterator.HasFilter("Parent"), true);
			g_Assert.deepEqual(Object.getOwnPropertyDescriptor(ChildIterator, "Filters"), { configurable: false, enumerable: true, value: ChildIterator.Filters, writable: false });

			const Iterator = new ParentIterator();
			g_Assert.strictEqual(Iterator.Iterate(), vecSourceRecords, "Raw Iterate must preserve the borrowed source identity.");
			g_Assert.strictEqual(ParentIterator.Iterator(), vecSourceRecords);
			const vecResolvedRecords = Iterator.Resolve();
			g_Assert.notStrictEqual(vecResolvedRecords, vecSourceRecords);
			g_Assert.strictEqual(vecResolvedRecords[0], Record);
			vecResolvedRecords.push({ Value: 2 });
			g_Assert.equal(vecSourceRecords.length, 1);
			vecResolvedRecords[0].Value = 3;
			g_Assert.equal(Record.Value, 3);

			let unCallbackCallCount = 0;
			ParentIterator.RegisterFilter("Reject", () => {
				++unCallbackCallCount;

				return false;
			});

			const RejectingIterator = new ParentIterator("Reject");
			RejectingIterator.ExcludedFilterNames = null;
			g_Assert.throws(() => RejectingIterator.IsValid(Record), TypeError, "Both name-group arrays must validate before a short-circuiting callback.");
			g_Assert.equal(unCallbackCallCount, 0);
		} finally {
			for (const strFilterName of ["Parent", "Reject"]) {
				if (ParentIterator.HasFilter(strFilterName)) {
					g_Assert.equal(ParentIterator.UnregisterFilter(strFilterName), true);
				}
			}
		}

		for (const strMethodName of ["Filter", "Map", "ForEach"]) {
			let unSourceCallCount = 0;
			const Filter = FromItems(() => {
				++unSourceCallCount;

				return [1];
			});
			g_Assert.throws(() => Filter[strMethodName](null), TypeError);
			g_Assert.equal(unSourceCallCount, 0, `${strMethodName} must validate its callback before source resolution.`);
		}

		const DefaultFilter = new IteratorFilter(undefined, undefined);
		g_Assert.deepEqual(DefaultFilter.IteratorItems, []);
		g_Assert.equal(DefaultFilter.IteratorPredicate, null);
	}

	function VerifyNamedFilterCleanup(strExampleSource) {
		const unBotClientCleanupMask = 0x01;
		const unConnectedClientCleanupMask = 0x02;
		const unCleanupFailureMaskLimit = 0x04;
		const unExpectedCleanupScenarioCount = 80;
		const RunExample = new Function("require", "console", strExampleSource);
		const vecPrimaryCases = [
			{ Throws: false },
			{ Throws: true, Value: new Error("Controlled iterator operation failure.") },
			{ Throws: true, Value: null },
			{ Throws: true, Value: undefined },
			{ Throws: true, Value: 0 },
		];
		const vecCleanupFaults = [
			{ Mode: "FALSE" },
			{ Mode: "THROWS", CreateValue: strName => new Error(`Controlled ${strName} cleanup failure.`) },
			{ Mode: "THROWS", CreateValue: () => null },
			{ Mode: "THROWS", CreateValue: () => undefined },
			{ Mode: "THROWS", CreateValue: () => 0 },
		];
		let unScenarioCount = 0;
		for (const PrimaryCase of vecPrimaryCases) {
			for (let unFailureMask = 0; unFailureMask < unCleanupFailureMaskLimit; ++unFailureMask) {
				const vecFaults = (unFailureMask === 0) ? [{ Mode: "SUCCESS" }] : vecCleanupFaults;
				for (const Fault of vecFaults) {
					const vecCleanupCalls = [];
					const vecExpectedFailures = [];
					let RegistryOwner = null;
					let CapturedFailure = null;
					if (PrimaryCase.Throws) {
						vecExpectedFailures.push({ Exact: true, Value: PrimaryCase.Value });
					}

					class ControlledIteratorObject extends IteratorObject {
						static DefaultFilters() {
							RegistryOwner = this;

							if (PrimaryCase.Throws) {
								throw PrimaryCase.Value;
							}

							return super.DefaultFilters();
						}

						static UnregisterFilter(strFilterName) {
							const bResult = super.UnregisterFilter(strFilterName);
							vecCleanupCalls.push(strFilterName);

							const unFilterMask = (strFilterName === "BotClient") ? unBotClientCleanupMask : unConnectedClientCleanupMask;
							if ((unFailureMask & unFilterMask) === 0) {
								return bResult;
							}

							if (Fault.Mode === "FALSE") {
								vecExpectedFailures.push({ Exact: false, Name: strFilterName });
								return false;
							}

							const CleanupFailure = Fault.CreateValue(strFilterName);
							vecExpectedFailures.push({ Exact: true, Value: CleanupFailure });
							throw CleanupFailure;
						}
					}

					try {
						RunExample(CreateDocumentationRequire({ IteratorObject: ControlledIteratorObject }), g_ConsoleDouble);
					} catch (Failure) {
						CapturedFailure = { Value: Failure };
					}

					g_Assert.notEqual(RegistryOwner, null);
					g_Assert.deepEqual(vecCleanupCalls, ["BotClient", "ConnectedClient"], "Every cleanup must run in reverse registration order, even after thrown primitives.");
					g_Assert.equal(RegistryOwner.Filters.size, 0, "Faults occur after real JS Map deletion; this does not prove successful deletion when deletion itself fails.");

					if (vecExpectedFailures.length === 0) {
						g_Assert.equal(CapturedFailure, null);
					} else {
						g_Assert.notEqual(CapturedFailure, null);

						if (vecExpectedFailures.length > 1) {
							g_Assert(CapturedFailure.Value instanceof AggregateError);
						}

						const vecReportedFailures = (vecExpectedFailures.length === 1) ? [CapturedFailure.Value] : CapturedFailure.Value.errors;
						g_Assert.equal(vecReportedFailures.length, vecExpectedFailures.length);

						for (const [unFailureIndex, ExpectedFailure] of vecExpectedFailures.entries()) {
							if (ExpectedFailure.Exact) {
								g_Assert.strictEqual(vecReportedFailures[unFailureIndex], ExpectedFailure.Value);
							} else {
								g_Assert(vecReportedFailures[unFailureIndex] instanceof Error);
								g_Assert(vecReportedFailures[unFailureIndex].message.includes(ExpectedFailure.Name));
							}
						}
					}

					++unScenarioCount;
				}
			}
		}

		g_Assert.equal(unScenarioCount, unExpectedCleanupScenarioCount);
	}

	NumberIterator.RegisterFilter("Even", (nValue) => (nValue % 2) === 0);
	NumberIterator.RegisterFilter("Large", (nValue) => nValue > 2);

	g_Assert.deepEqual(Object.keys(require(g_strPackagePath)).sort(), ["FromItems", "IteratorFilter", "IteratorObject"]);
	g_Assert.deepEqual(new NumberIterator("Even").ToArray(), [2, 4]);
	g_Assert.deepEqual(new NumberIterator(["Even", "Large"]).ToArray(), [4]);
	g_Assert.deepEqual(new NumberIterator(new Set(["Even"])).ToArray(), [2, 4]);
	g_Assert.deepEqual(new NumberIterator(null, "Large").ToArray(), [1, 2]);
	g_Assert.deepEqual(new NumberIterator(null, new Set(["Large"])).ToArray(), [1, 2]);
	g_Assert.throws(() => new NumberIterator("Missing"), /filter does not exist/);
	g_Assert.throws(() => new NumberIterator(null, "Missing"), /filter does not exist/);
	g_Assert.throws(() => new NumberIterator(""), /non-empty strings/);
	g_Assert.throws(() => new NumberIterator(["Even", 2]), /non-empty strings/);

	const g_DefaultFilters = NumberIterator.DefaultFilters();
	g_Assert.equal(g_DefaultFilters.Even instanceof Set, true);
	g_Assert.deepEqual(Array.from(g_DefaultFilters.Large), [3, 4]);
	g_Assert.equal(NumberIterator.HasFilter("Even"), true);
	g_Assert.throws(() => NumberIterator.HasFilter(""), /non-empty/);
	g_Assert.throws(() => NumberIterator.RegisterFilter("Even", () => true), /already exists/);
	g_Assert.throws(() => NumberIterator.RegisterFilter("", () => true), /non-empty/);
	g_Assert.throws(() => NumberIterator.RegisterFilter("Bad", null), /expects a function/);
	g_Assert.equal(NumberIterator.UnregisterFilter("Large"), true);
	g_Assert.equal(NumberIterator.HasFilter("Large"), false);
	g_Assert.throws(() => NumberIterator.UnregisterFilter("Large"), /does not exist/);
	g_Assert.throws(() => NumberIterator.UnregisterFilter(""), /non-empty/);
	g_Assert.deepEqual(FromItems({ A: 1, B: 2 }, (nValue) => nValue > 1).ToArray(), [2]);
	g_Assert.deepEqual(FromItems(new Set([1, 2])).ToArray(), [1, 2]);
	g_Assert.deepEqual(FromItems(Object.assign(Object.create(null), { A: 1, B: 2 })).ToArray(), [1, 2]);
	g_Assert.deepEqual(FromItems(null).ToArray(), []);
	g_Assert.deepEqual(FromItems(undefined).ToArray(), []);
	g_Assert.throws(() => new IteratorObject().ToArray(), /must implement static Iterator/);
	g_Assert.throws(() => new ScalarIterator().ToArray(), /must return an iterable/);
	g_Assert.throws(() => new IteratorFilter([], true), /function or null/);
	g_Assert.throws(() => new IteratorFilter(42).ToArray(), /iterable, object/);
	g_Assert.throws(() => new IteratorFilter([]).Filter(null), /expects a function/);
	g_Assert.throws(() => new IteratorFilter([]).Map(null), /expects a function/);
	g_Assert.throws(() => new IteratorFilter([]).ForEach(null), /expects a function/);

	const g_vecLiveValues = [1, 2];
	const g_LiveFilter = FromItems(() => g_vecLiveValues, (nValue) => nValue > 1);
	g_Assert.equal(g_LiveFilter.IteratorItems instanceof Function, true);
	g_Assert.equal(typeof g_LiveFilter.IteratorPredicate, "function");
	g_Assert.deepEqual(g_LiveFilter.Resolve(), [2]);
	g_Assert.deepEqual(g_LiveFilter.Values(), [2]);
	g_Assert.deepEqual(g_LiveFilter.ToArray(), [2]);
	g_Assert.equal(g_LiveFilter.Count(), 1);
	g_Assert.equal(g_LiveFilter.First(), 2);
	g_Assert.deepEqual(g_LiveFilter.Map((nValue) => nValue * 2), [4]);
	g_Assert.strictEqual(g_LiveFilter.ForEach(() => undefined), g_LiveFilter);
	g_Assert.deepEqual([...g_LiveFilter], [2]);

	g_vecLiveValues.push(3);

	g_Assert.deepEqual(g_LiveFilter.Filter((nValue) => nValue === 3).ToArray(), [3]);

	for (const FirstValue of [null, undefined, 0, false, "", 0n]) {
		g_Assert.strictEqual(FromItems([FirstValue, 42]).First(), FirstValue ?? null);
	}

	g_Assert.strictEqual(FromItems([]).First(), null);
	g_Assert.strictEqual(FromItems(new Array(1)).First(), null);

	const g_SingleUseFilter = FromItems(GenerateValues());
	g_Assert.deepEqual(g_SingleUseFilter.ToArray(), [1, 2]);
	g_Assert.deepEqual(g_SingleUseFilter.ToArray(), []);

	const g_FreshIterableFilter = FromItems(() => GenerateValues());
	g_Assert.deepEqual(g_FreshIterableFilter.ToArray(), [1, 2]);
	g_Assert.deepEqual(g_FreshIterableFilter.ToArray(), [1, 2]);
	g_Assert.deepEqual(FromItems("AB").ToArray(), ["A", "B"]);
	g_Assert.throws(() => FromItems(() => () => []).ToArray(), TypeError);
	g_Assert.throws(() => FromItems(Promise.resolve([])).ToArray(), TypeError);
	g_Assert.throws(() => FromItems(() => Promise.resolve([])).ToArray(), TypeError);

	let g_unSourceCallCount = 0;
	const g_SourceFilter = FromItems(function ResolveItems() {
		g_Assert.strictEqual(this, g_SourceFilter);
		g_Assert.equal(arguments.length, 0);
		g_unSourceCallCount++;

		return [1, 2];
	});
	g_Assert.deepEqual(g_SourceFilter.ToArray(), [1, 2]);
	g_Assert.equal(g_unSourceCallCount, 1);

	g_SourceFilter.IteratorPredicate = "InvalidPredicate";
	g_Assert.throws(() => g_SourceFilter.ToArray(), TypeError);
	g_Assert.equal(g_unSourceCallCount, 1, "predicate validation must precede source invocation");

	g_SourceFilter.IteratorPredicate = null;
	const g_vecVisitedIndexes = [];
	g_SourceFilter.ForEach(function InspectArrayCallback(nValue, unIndex, vecItems) {
		g_Assert.strictEqual(this, undefined);
		g_Assert.deepEqual(vecItems, [1, 2]);
		g_Assert.equal(nValue, vecItems[unIndex]);
		g_vecVisitedIndexes.push(unIndex);
	});
	g_Assert.deepEqual(g_vecVisitedIndexes, [0, 1]);
	g_Assert.equal(g_unSourceCallCount, 2);

	const g_ItemRecord = { Value: 1 };
	const g_vecSourceRecords = [g_ItemRecord];
	const g_vecResolvedRecords = FromItems(g_vecSourceRecords).ToArray();
	g_vecResolvedRecords.push({ Value: 3 });
	g_Assert.equal(g_vecSourceRecords.length, 1);

	g_vecResolvedRecords[0].Value = 2;
	g_Assert.equal(g_ItemRecord.Value, 2, "resolution must preserve contained object identity");

	const g_ParentFilter = FromItems([1, 2]);
	const g_DerivedFilter = g_ParentFilter.Filter((nValue) => nValue > 1);
	g_Assert.deepEqual(g_DerivedFilter.ToArray(), [2]);

	g_ParentFilter.IteratorItems = [3, 4];
	g_ParentFilter.IteratorPredicate = (nValue) => nValue < 4;
	g_Assert.deepEqual(g_DerivedFilter.ToArray(), [3]);

	const g_PredicatePromise = Promise.resolve(false);
	g_Assert.deepEqual(FromItems([1, 2], () => g_PredicatePromise).ToArray(), [1, 2]);
	g_Assert.deepEqual(FromItems([1]).Map(() => g_PredicatePromise), [g_PredicatePromise]);

	const g_OverriddenIterator = new NumberIterator("Even");
	g_OverriddenIterator.IteratorItems = [1, 3];
	g_OverriddenIterator.IteratorPredicate = (nValue) => nValue > 1;
	g_Assert.deepEqual(g_OverriddenIterator.ToArray(), [3], "replacing IteratorItems must bypass the named-filter scan");

	g_OverriddenIterator.RequiredFilterNames = null;
	g_Assert.throws(() => g_OverriddenIterator.IsValid(1), TypeError);

	RegistryIterator.RegisterFilter("Accept", () => true);
	RegistryIterator.RegisterFilter("Reject", () => false);
	RegistryIterator.RegisterFilter("Removed", () => true);

	const g_unExpectedRegistryScanCount = 3;
	const g_RegistryDefaults = RegistryIterator.DefaultFilters();
	g_Assert.strictEqual(Object.getPrototypeOf(g_RegistryDefaults), null);
	g_Assert.equal(g_unRegistryScanCount, g_unExpectedRegistryScanCount, "DefaultFilters must resolve separately for each registered name");
	g_Assert.deepEqual([...g_RegistryDefaults.Accept], [1]);
	g_Assert.deepEqual([...g_RegistryDefaults.Reject], []);

	const g_RequiredRegistryIterator = new RegistryIterator(["Reject", "Removed"]);
	const g_ExcludedRegistryIterator = new RegistryIterator(null, ["Accept", "Removed"]);
	RegistryIterator.UnregisterFilter("Removed");
	g_Assert.deepEqual(g_RequiredRegistryIterator.ToArray(), []);
	g_Assert.deepEqual(g_ExcludedRegistryIterator.ToArray(), []);

	g_RequiredRegistryIterator.RequiredFilterNames = ["Removed"];
	g_ExcludedRegistryIterator.ExcludedFilterNames = ["Removed"];
	g_Assert.throws(() => g_RequiredRegistryIterator.ToArray(), ReferenceError);
	g_Assert.throws(() => g_ExcludedRegistryIterator.ToArray(), ReferenceError);

	g_vecRegistryItems.length = 0;
	g_Assert.deepEqual(g_RequiredRegistryIterator.ToArray(), []);
	g_Assert.deepEqual(g_ExcludedRegistryIterator.ToArray(), []);

	RegistryIterator.UnregisterFilter("Accept");
	RegistryIterator.UnregisterFilter("Reject");

	const g_strExampleSource = g_FileSystem.readFileSync(g_strExamplePath, "utf8").replace(/\r\n/g, "\n");

	const g_vecExampleEntities = [
		{ ClassName: "worldspawn", Index: 0, Valid: true },
		{ ClassName: "weapon_rifle", Index: 1, Valid: true },
		{ ClassName: "prop_physics", Index: 2, Valid: false },
	];
	const g_RunIteratorExample = new Function("g_GetAllEntities", "IteratorFilter", "IteratorObject", "FromItems", "GetEntityIndexes", ReadExampleCallback(g_strExampleSource, "filters/iterator live entity view"));
	const g_IteratorExampleResult = g_RunIteratorExample(() => g_vecExampleEntities, IteratorFilter, IteratorObject, FromItems, (vecEntities) => vecEntities.map((Entity) => Entity.Index));
	g_Assert.deepEqual(g_IteratorExampleResult.NonWeaponEntities, [0]);
	g_Assert.deepEqual(g_IteratorExampleResult.DefaultFilterIndexes, { Valid: [0, 1], Weapon: [1] });
	g_Assert.deepEqual(g_IteratorExampleResult.ValidEntities.Resolved, [0, 1]);
	g_Assert.deepEqual(g_IteratorExampleResult.ValidEntities.Array, [0, 1]);
	g_Assert.deepEqual(g_IteratorExampleResult.ValidEntities.Values, [0, 1]);
	g_Assert.deepEqual(g_IteratorExampleResult.ValidEntities.Visited, [0, 1]);
	g_Assert.deepEqual(g_IteratorExampleResult.WeaponEntities, [1]);
	g_Assert.equal(g_IteratorExampleResult.ForEachReturnedSource, true);
	g_Assert.equal(g_IteratorExampleResult.RemovedValidFilter, true);
	g_Assert.equal(g_IteratorExampleResult.RemovedWeaponFilter, true);

	const g_EmptyIteratorExampleResult = g_RunIteratorExample(() => [], IteratorFilter, IteratorObject, FromItems, (vecEntities) => vecEntities.map((Entity) => Entity.Index));
	g_Assert.equal(g_EmptyIteratorExampleResult.ValidEntities.Count, 0);
	g_Assert.equal(g_EmptyIteratorExampleResult.ValidEntities.FirstIndex, null);
	g_Assert.deepEqual(g_EmptyIteratorExampleResult.WeaponEntities, []);

	const g_unExpectedDocumentationBlockCount = 7;
	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	let g_unExecutedDocumentationBlockCount = 0;
	const g_vecPlayerRecords = [
		{ FakeClient: false, Name: "Ren", Index: 1 },
		{ FakeClient: true, Name: "Hunter", Index: 2 },
	];

	g_Assert.equal(g_vecBlocks.length, g_unExpectedDocumentationBlockCount, "filters/iterator documentation must contain seven executable JavaScript blocks");
	VerifyDocumentationRequireContracts();
	VerifyRegistryOwnershipAndValidationOrder();
	const g_unNamedFilterCleanupBlockIndex = 5;
	VerifyNamedFilterCleanup(g_vecBlocks[g_unNamedFilterCleanupBlockIndex]);

	const g_DocumentationRequire = CreateDocumentationRequire(require(g_strPackagePath), { GetAllPlayers: () => g_vecPlayerRecords });

	for (const strBlock of g_vecBlocks) {
		const RunBlock = new Function("require", "console", strBlock);
		RunBlock(g_DocumentationRequire, g_ConsoleDouble);
		++g_unExecutedDocumentationBlockCount;
	}

	g_Assert.equal(g_unExecutedDocumentationBlockCount, g_vecBlocks.length, "Every iterator documentation block must execute.");

	const g_unErrorBlockIndex = g_vecBlocks.length - 1;
	const g_unExpectedValidationErrorCount = 2;
	g_Assert.equal(RunIteratorErrorBlock(g_vecBlocks[g_unErrorBlockIndex], { IteratorFilter, IteratorObject }).length, g_unExpectedValidationErrorCount);
	g_Assert.throws(() => RunIteratorErrorBlock(g_vecBlocks[g_unErrorBlockIndex], { IteratorFilter: PermissiveIteratorFilter, IteratorObject }), /scalar source was accepted/);
	g_Assert.throws(() => RunIteratorErrorBlock(g_vecBlocks[g_unErrorBlockIndex], { IteratorFilter, IteratorObject: PermissiveIteratorObject }), /unknown required filter was accepted/);

	for (const strExportName of ["FromItems", "IteratorFilter", "IteratorObject"]) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation must cover ${strExportName}`);
	}

	for (const strMemberName of [
		"IteratorItems",
		"IteratorPredicate",
		"RequiredFilterNames",
		"ExcludedFilterNames",
		"Resolve",
		"Values",
		"ToArray",
		"Count",
		"First",
		"Filter",
		"Map",
		"ForEach",
		"Iterator",
		"RegisterFilter",
		"UnregisterFilter",
		"HasFilter",
		"GetFilterNames",
		"DefaultFilters",
		"GetIteratorFilterCallback",
		"IsValid",
		"Filters",
	]) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `documentation must cover ${strMemberName}`);
	}

	for (const strForbiddenTerm of [
		"Generated by",
		"generate_api_docs",
		"console.log(instance)",
		"console.log(result)",
		"FromItems(1",
	]) {
		g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `documentation must not contain ${strForbiddenTerm}`);
	}

	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable iterator documentation must use typed logging.");

	console.log("[  OK  ] filters/iterator pure JavaScript contracts and documentation passed; native SDK execution not exercised");
} finally {
	delete require.cache[g_strPackagePath];

	if (g_OriginalCacheEntry !== undefined) {
		require.cache[g_strPackagePath] = g_OriginalCacheEntry;
	}
}
