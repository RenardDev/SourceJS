"use strict";

const g_Assert = require("node:assert/strict");
const { ASCIITable, Alignment, Column, Item, MODULE_NAME } = require("../packages/sourcejs/core/table.js");

const g_unExpectedDefaultColumnPadding = 2;

g_Assert.equal(MODULE_NAME, "core/table");
// These alignment strings are part of the established public table API.
g_Assert.deepEqual(Alignment, { CENTER: "center", LEFT: "left", RIGHT: "right" });
g_Assert.equal(Object.isFrozen(Alignment), true);
g_Assert.equal(Item.length, 1);
g_Assert.equal(Column.length, 1);
g_Assert.equal(ASCIITable.length, 0);

const g_vecConversions = [];
const g_ValueSource = {
	toString() {
		g_vecConversions.push("Value");

		return "7";
	},
};
const g_AlignmentSource = {
	toString() {
		g_vecConversions.push("Alignment");

		return "RIGHT";
	},
};
const g_CoercedItem = new Item(g_ValueSource, g_AlignmentSource);
g_Assert.deepEqual(g_vecConversions, ["Value", "Alignment"]);
g_Assert.equal(g_CoercedItem.Value, "7");
g_Assert.equal(g_CoercedItem.Alignment, Alignment.RIGHT);
g_Assert.equal(g_CoercedItem.Length, 1);
g_Assert.equal(g_CoercedItem.FormatItem(3, 1, 1), "   7 ");
g_Assert.equal(new Item("x", "CeNtEr").FormatItem(6, 0, 0), "  x   ");
g_Assert.equal(new Item("x").FormatItem(3, 0, 0), "x  ");
g_Assert.throws(() => new Item("wide", Alignment.CENTER).FormatItem(1, 0, 0), RangeError);
g_Assert.throws(() => new Item("x", "diagonal"), TypeError);

const g_vecDefaultColumn = new Column(false);
g_Assert.equal(g_vecDefaultColumn.Name.Value, "false");
g_Assert.equal(g_vecDefaultColumn.Name.Alignment, Alignment.CENTER);
g_Assert.equal(g_vecDefaultColumn.LeftPadding, g_unExpectedDefaultColumnPadding);
g_Assert.equal(g_vecDefaultColumn.RightPadding, g_unExpectedDefaultColumnPadding);
g_Assert.equal(g_vecDefaultColumn.GetMaximumContentWidth(), 5);
g_Assert.deepEqual(g_vecDefaultColumn.FormatColumn(), { Header: "  false  ", Rows: [] });
g_vecDefaultColumn.push(new Item("longer"));
g_Assert.equal(g_vecDefaultColumn.GetMaximumContentWidth(), 6);
g_Assert.equal(Object.getPrototypeOf(g_vecDefaultColumn.map((ItemValue) => ItemValue.Value)), Array.prototype);

const g_vecNameColumn = new Column("Name", Alignment.LEFT, 0, 0);
const g_vecScoreColumn = new Column("Score", Alignment.RIGHT, 0, 0);
const g_Table = new ASCIITable(g_vecNameColumn, g_vecScoreColumn);
const g_ScoreItem = new Item(7n, Alignment.RIGHT);
g_Assert.equal(g_Table.AddTableRow("Ren", g_ScoreItem), g_Table);
g_Assert.equal(g_Table.Length, 2);
g_Assert.equal(g_Table.GetTableColumn(0), g_vecNameColumn);
g_Assert.equal(g_Table.Columns[1], g_vecScoreColumn);
g_Assert.deepEqual(Array.from(g_Table), [g_vecNameColumn, g_vecScoreColumn]);
g_Assert.equal(g_vecScoreColumn[0], g_ScoreItem);
g_Assert.equal(g_Table.FormatTable(), "Name|Score\n==========\nRen |    7");
g_Assert.equal(g_Table.FormatTable("+", ":"), "Name:Score\n++++++++++\nRen :    7");
g_Assert.throws(() => new ASCIITable(), RangeError);
g_Assert.throws(() => g_Table.AddTableRow("Missing score"), RangeError);
g_Assert.throws(() => g_Table.FormatTable("=="), TypeError);
g_Assert.throws(() => g_Table.FormatTable("=", ""), TypeError);
g_Assert.throws(() => g_Table.FormatTable("=", "\uD83D\uDE80"), TypeError);
g_Assert.equal(new ASCIITable(42).GetTableColumn(0).Name.Value, "42");

const g_RowError = new Error("Controlled row failure");
const g_FailingValue = {
	toString() {
		throw g_RowError;
	},
};
g_Assert.throws(() => g_Table.AddTableRow("Another", g_FailingValue), (ErrorValue) => ErrorValue === g_RowError);
g_Assert.equal(g_vecNameColumn.length, 1);
g_Assert.equal(g_vecScoreColumn.length, 1);

const g_vecRejectingColumn = new Column("Rejected");
g_vecRejectingColumn.push = function RejectRowAppend() {
	throw g_RowError;
};

const g_vecRollbackColumn = new Column("Restored");
const g_RollbackTable = new ASCIITable(g_vecRollbackColumn, g_vecRejectingColumn);
g_Assert.throws(() => g_RollbackTable.AddTableRow(1, 2), (ErrorValue) => ErrorValue === g_RowError);
g_Assert.equal(g_vecRollbackColumn.length, 0);
g_Assert.equal(g_vecRejectingColumn.length, 0);

for (const TestCase of [
	{ Prototype: Item.prototype, Name: "FormatItem" },
	{ Prototype: Column.prototype, Name: "FormatColumn" },
	{ Prototype: ASCIITable.prototype, Name: "AddTableRow" },
]) {
	const Descriptor = Object.getOwnPropertyDescriptor(TestCase.Prototype, TestCase.Name);
	g_Assert.equal(Descriptor.enumerable, false);
	g_Assert.equal(Descriptor.configurable, true);
	g_Assert.equal(Descriptor.writable, true);
}

const g_SpeciesDescriptor = Object.getOwnPropertyDescriptor(Column, Symbol.species);
g_Assert.equal(g_SpeciesDescriptor.enumerable, false);
g_Assert.equal(g_SpeciesDescriptor.configurable, true);
g_Assert.equal(Column[Symbol.species], Array);

console.log("Core table smoke checks passed (actual pure JavaScript module; no native doubles or IO).");
