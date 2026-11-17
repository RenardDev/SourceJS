"use strict";

const g_Assert = require("node:assert/strict");
const { CVarConfigEntry, CVarConfigListManager, NormalizeDescription } = require("../packages/sourcejs/config/cvar");

const g_unHelpItemCount = 200_000;
const g_ConfigurationManager = { CommentPrefix: "//" };

function CreateHelpItems(strValuePrefix) {
	const vecHelpItems = [];
	for (let unHelpItemIndex = 0; unHelpItemIndex < g_unHelpItemCount; ++unHelpItemIndex) {
		vecHelpItems.push(`${strValuePrefix} ${unHelpItemIndex}`);
	}

	return vecHelpItems;
}

function AssertRenderedHelp(vecHelpLines, unFirstItemIndex) {
	g_Assert.equal(vecHelpLines[unFirstItemIndex - 1], "// Available values");

	for (let unHelpItemIndex = 0; unHelpItemIndex < g_unHelpItemCount; ++unHelpItemIndex) {
		g_Assert.equal(vecHelpLines[unFirstItemIndex + unHelpItemIndex], `//   * Value ${unHelpItemIndex}`);
	}

	g_Assert.equal(vecHelpLines[unFirstItemIndex + g_unHelpItemCount], "// After list");
}

function VerifyDescriptionNormalization() {
	let unCases = 0;
	for (const ValueDescription of [null, undefined, "", []]) {
		g_Assert.deepEqual(NormalizeDescription(ValueDescription), []);
		unCases += 1;
	}

	g_Assert.deepEqual(NormalizeDescription("First\r\nSecond\nThird"), ["First", "Second", "Third"]);
	unCases += 1;

	class DescriptionArray extends Array {
		static get [Symbol.species]() {
			throw new Error("Description normalization must not consult array species.");
		}
	}

	const vecDescription = new DescriptionArray(" First ", "");
	vecDescription.map = () => [42];
	vecDescription[Symbol.iterator] = () => {
		throw new Error("Description normalization must not consult a custom iterator.");
	};
	const vecNormalized = NormalizeDescription(vecDescription);
	g_Assert.deepEqual(vecNormalized, [" First ", ""]);
	g_Assert.equal(Object.getPrototypeOf(vecNormalized), Array.prototype);
	vecDescription[0] = "Changed";
	g_Assert.equal(vecNormalized[0], " First ");
	unCases += 1;

	const vecInheritedDescription = new Array(1);
	Object.setPrototypeOf(vecInheritedDescription, Object.assign(Object.create(Array.prototype), { 0: "inherited" }));
	for (const vecInvalid of [new Array(1), ["First", , "Last"], vecInheritedDescription, [null], [undefined], [42], [{}], [{ GetTranslation: () => 42 }]]) {
		g_Assert.throws(() => NormalizeDescription(vecInvalid), TypeError);
		unCases += 1;
	}

	const vecCalls = [];
	const FirstTranslation = {
		GetTranslation() {
			g_Assert.equal(this, FirstTranslation);
			vecCalls.push("First");

			return "Translated\nline";
		},
		GetString() {
			throw new Error("GetTranslation must take precedence.");
		},
	};
	const SecondTranslation = {
		GetString() {
			g_Assert.equal(this, SecondTranslation);
			vecCalls.push("Second");

			return "Fallback";
		},
	};
	g_Assert.deepEqual(NormalizeDescription([FirstTranslation, SecondTranslation]), ["Translated\nline", "Fallback"]);
	g_Assert.deepEqual(vecCalls, ["First", "Second"]);
	unCases += 1;

	let unLengthReads = 0;
	let unSlotReads = 0;
	const vecChangingDescription = new Proxy(["First"], {
		get(Target, Property, Receiver) {
			if (Property === "length") {
				unLengthReads += 1;
				return (unLengthReads === 1) ? 1 : 0;
			}

			if (Property === "0") {
				unSlotReads += 1;
				return (unSlotReads === 1) ? "First" : 42;
			}

			return Reflect.get(Target, Property, Receiver);
		},
	});
	g_Assert.deepEqual(NormalizeDescription(vecChangingDescription), ["First"]);
	g_Assert.equal(unLengthReads, 1);
	g_Assert.equal(unSlotReads, 1);
	unCases += 1;

	for (const InvalidLength of [-1, 0.5, NaN, Infinity, "1", undefined]) {
		const vecInvalidLength = new Proxy(["First"], {
			get(Target, Property, Receiver) {
				return (Property === "length") ? InvalidLength : Reflect.get(Target, Property, Receiver);
			},
		});
		g_Assert.throws(() => NormalizeDescription(vecInvalidLength), TypeError);
		unCases += 1;
	}

	for (const FailureValue of [undefined, null, false, 0, "failure", new Error("Description access failed.")]) {
		for (const strProperty of ["length", "0"]) {
			const vecThrowingDescription = new Proxy(["First"], {
				get(Target, Property, Receiver) {
					if (Property === strProperty) {
						throw FailureValue;
					}

					return Reflect.get(Target, Property, Receiver);
				},
			});
			let bThrew = false;
			try {
				NormalizeDescription(vecThrowingDescription);
			} catch (CaughtFailure) {
				bThrew = true;
				g_Assert.equal(CaughtFailure, FailureValue);
			}

			g_Assert.equal(bThrew, true);
			unCases += 1;
		}
	}

	const Entry = new CVarConfigEntry("description_failure", false);
	Entry.AddHelpText("Before");
	g_Assert.throws(() => Entry.AddHelpText(["Not appended", 42]), TypeError);
	g_Assert.deepEqual(Entry.HelpEntries, ["Before"]);
	unCases += 1;

	console.log(`[smoke_config_help_lines] Description normalization ${unCases} profiles passed`);
}

VerifyDescriptionNormalization();

const g_Entry = new CVarConfigEntry("sourcejs_help_lines", "default", "Description");
const g_HelpList = g_Entry.CreateHelpList("Available values", { Indent: 0 });
g_HelpList.ExtendListItems(CreateHelpItems("Value"));
g_Entry.HelpEntries.unshift("Before list");
g_Entry.AddHelpText("After list");

g_Assert.ok(g_HelpList instanceof CVarConfigListManager);
g_Assert.equal(g_HelpList.Items.length, g_unHelpItemCount);

const g_vecHelpLines = g_Entry.GetHelpLines(g_ConfigurationManager);
g_Assert.equal(g_vecHelpLines.length, g_unHelpItemCount + 3);
g_Assert.equal(g_vecHelpLines[0], "// Before list");
AssertRenderedHelp(g_vecHelpLines, 2);

const g_vecRenderedLines = g_Entry.RenderConfigEntry(g_ConfigurationManager);
g_Assert.equal(g_vecRenderedLines.length, g_unHelpItemCount + 6);
g_Assert.deepEqual(g_vecRenderedLines.slice(0, 3), ["// Description", "// Default: default", "// Before list"]);
AssertRenderedHelp(g_vecRenderedLines, 4);
g_Assert.equal(g_vecRenderedLines[g_vecRenderedLines.length - 1], 'sourcejs_help_lines "default"');

const g_PlainHelpEntry = new CVarConfigEntry("sourcejs_plain_help_lines", false, "", { ShowDefault: false });
g_PlainHelpEntry.AddHelpText(CreateHelpItems("Plain"));

const g_vecPlainRenderedLines = g_PlainHelpEntry.RenderConfigEntry(g_ConfigurationManager, new Map([["sourcejs_plain_help_lines", "previous value"]]));
g_Assert.equal(g_vecPlainRenderedLines.length, g_unHelpItemCount + 1);

for (let unHelpItemIndex = 0; unHelpItemIndex < g_unHelpItemCount; ++unHelpItemIndex) {
	g_Assert.equal(g_vecPlainRenderedLines[unHelpItemIndex], `// Plain ${unHelpItemIndex}`);
}

g_Assert.equal(g_vecPlainRenderedLines[g_vecPlainRenderedLines.length - 1], 'sourcejs_plain_help_lines "previous value"');

console.log("[smoke_config_help_lines] ok");
