#!/usr/bin/env python3

import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest

from audit_api_docs import Audit, CollectNativeMembers, CollectObjectKeys, ExampleUsesSymbol, ReadInventory, ReadPage, ROOT, UpdatePageLinks


class APIDocumentationAuditTest(unittest.TestCase):
	def test_table_links_handle_duplicate_headings_and_leave_fences_alone(self):
		strText = (
			"# Fixture\r\n\r\n"
			"## Exports\r\n\r\n"
			"| `ObjectType` | Class | A documented object. |\r\n"
			"| `Observe` | Function | Ambiguous heading. |\r\n\r\n"
			"## Class members\r\n\r\n"
			"### `ObjectType`\r\n\r\n"
			"| `Read()` | Method | Own method. |\r\n\r\n"
			"## Examples\r\n\r\n"
			"### `ObjectType`\r\n\r\n"
			"```js\r\nconst Value = new ObjectType();\r\n```\r\n\r\n"
			"### `ObjectType.Read`\r\n\r\n"
			"```text\r\n| `ObjectType` | Not a table. |\r\n```\r\n\r\n"
			"### `Observe`\r\n\r\nFirst use.\r\n\r\n"
			"### `Observe`\r\n\r\nSecond use.\r\n"
		)
		with TemporaryDirectory() as strDirectory:
			PathFixture = Path(strDirectory) / "Fixture.md"
			PathFixture.write_bytes(strText.encode("utf-8"))
			self.assertEqual(UpdatePageLinks(ReadPage(PathFixture), True), 2)
			strUpdated = PathFixture.read_bytes().decode("utf-8")
			self.assertIn("[`ObjectType`](#objecttype-1)", strUpdated)
			self.assertIn("[`Read()`](#objecttyperead)", strUpdated)
			self.assertIn("| `ObjectType` | Not a table. |\r\n", strUpdated)
			self.assertIn("| `Observe` | Function |", strUpdated)
			self.assertEqual(strUpdated.count("\r\n"), strText.count("\r\n"))
			self.assertEqual(UpdatePageLinks(ReadPage(PathFixture), True), 0)

	def test_reports_missing_page_description_and_example_separately(self):
		strText = (
			"# Fixture\n\n## Exports\n\n"
			"| Export | Kind | Description |\n| --- | --- | --- |\n"
			"| `Present` | Function | Described and used. |\n"
			"| `MissingExample` | Function | Described only. |\n\n"
			"```js\n"
			'const { Present, MissingExample } = require("fixture");\n'
			'// MissingExample();\n'
			'const strText = "MissingExample";\n'
			"Present();\n"
			"MissingDescription();\n"
			"```\n\n### `CodeOnly`\n\n```js\nCodeOnly();\n```\n"
		)
		with TemporaryDirectory() as strDirectory:
			PathFixture = Path(strDirectory) / "Fixture.md"
			PathFixture.write_text(strText, encoding="utf-8")
			Report = Audit({"fixture": {"Present", "MissingExample", "MissingDescription", "CodeOnly"}, "missing": {"Value"}}, {"fixture": [ReadPage(PathFixture)]}, None)
			self.assertEqual(Report["MissingPages"], ["missing"])
			self.assertEqual(Report["MissingDescriptions"], ["fixture::CodeOnly", "fixture::MissingDescription"])
			self.assertEqual(Report["MissingExamples"], ["fixture::MissingExample"])

	def test_source_object_and_example_matching(self):
		setNames = set()
		vecUnresolved = []
		CollectObjectKeys('{ Simple, Nested: { Value: "a, b" }, get Value() { return null; }, ...Dynamic }', 0, setNames, vecUnresolved)
		self.assertEqual(setNames, {"Simple", "Nested", "Value"})
		self.assertEqual(vecUnresolved, ["computed or spread export"])
		self.assertFalse(ExampleUsesSymbol("Other.Read();", "ObjectType.Read"))
		self.assertTrue(ExampleUsesSymbol("const Value = new ObjectType(); Value.Read();", "ObjectType.Read"))
		self.assertFalse(ExampleUsesSymbol('const strText = `Present`;', "Present"))
		self.assertTrue(ExampleUsesSymbol('const strText = `Name=${Present()}`;', "Present"))
		self.assertTrue(ExampleUsesSymbol('const { Present: g_Present } = require("fixture"); g_Present();', "Present"))

	def test_native_installers_keep_receiver_and_branch_specific_names(self):
		strInstaller = """
constexpr char kExportName[] = "LegacyRead";
constexpr char kExportName[] = "Read";
InstallSDKFunction<kSupported>(pIsolate, LocalContext, Target, kExportName, Callback);
SetFunction(pIsolate, LocalContext, Nested, "NotAModuleExport", Callback);
auto const DefineValue = [Target](char const* const pszName, Value Input) -> bool {};
auto const DefineFunction = [&DefineValue](char const* const pszName, Function Callback) -> bool {};
DefineFunction("Write", Callback);
"""
		mapInstallers = {"InstallFixtureFunctions": [("Target", strInstaller)]}
		self.assertEqual(
			CollectNativeMembers("InstallFixtureFunctions(pIsolate, LocalContext, Module);", "Module", mapInstallers, set()),
			{"LegacyRead", "Read", "Write"},
		)

	def test_runtime_capture_lists_descriptors_without_calling_getters(self):
		strTest = r"""
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { deepStrictEqual, strictEqual } = require("node:assert/strict");

class Demo {
	static Open() {}
	Read() {}
}

let unGetterCalls = 0;
let Inventory = null;
const Fixture = { Demo, Read() {} };
Object.defineProperty(Fixture, "Getter", { get() { ++unGetterCalls; } });
const Modules = {
	core: { GetCoreModules: () => ["native"], GetPublicPackages: () => ["fixture", "unavailable"], GetGlobalInfo: () => ({ SDKBranch: "fixture" }) },
	filesystem: { WriteTextFile(strPath, strText) { Inventory = JSON.parse(strText); return strPath.endsWith("/api-documentation/Inventory.json"); } },
	loggers: { LogInfo() {} },
	paths: { PLUGIN_DATA_ROOT: "/fixture" },
	fixture: Fixture,
	native: { Write() {} },
};

runInNewContext(readFileSync("tools/collect_api_inventory.js", "utf8"), {
	require(strModule) {
		if (!Object.hasOwn(Modules, strModule)) {
			throw new Error("module unavailable");
		}

		return Modules[strModule];
	},
});
strictEqual(unGetterCalls, 0);
deepStrictEqual(Inventory.Modules.fixture, ["Demo", "Demo.Open", "Demo.Read", "Getter", "Read"]);
deepStrictEqual(Inventory.Modules.native, ["Write"]);
strictEqual(Inventory.Errors.unavailable, "module unavailable");
process.stdout.write(JSON.stringify(Inventory));
"""
		Process = subprocess.run(["node", "-e", strTest], cwd=ROOT, capture_output=True, check=True, text=True, timeout=10)
		with TemporaryDirectory() as strDirectory:
			PathInventory = Path(strDirectory) / "Inventory.json"
			PathInventory.write_text(Process.stdout, encoding="utf-8")
			mapInventory, vecErrors = ReadInventory(PathInventory)
			self.assertEqual(mapInventory["native"], {"Write"})
			self.assertEqual(vecErrors, ["unavailable: module unavailable"])
			self.assertEqual(json.loads(Process.stdout)["Runtime"], {"SDKBranch": "fixture"})


if __name__ == "__main__":
	unittest.main()
