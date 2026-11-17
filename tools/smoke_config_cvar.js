#!/usr/bin/env node

"use strict";

const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strCommandsPath = g_Path.join(g_strPackageRoot, "commands.js");
const g_strConfigurationPath = g_Path.join(g_strPackageRoot, "config.js");
const g_strCVarsPath = g_Path.join(g_strPackageRoot, "cvars.js");
const g_setPackageModuleNames = new Set(["internal/runtime", "config/command", "config/cvar", "config/manager", "config/section", "commands", "cvars"]);
const g_mapOriginalPackageModules = new Map(Object.entries(require.cache).filter(([strModulePath]) => strModulePath.startsWith(`${g_strPackageRoot}${g_Path.sep}`)));
for (const strModulePath of g_mapOriginalPackageModules.keys()) {
	delete require.cache[strModulePath];
}

const g_mapVirtualFiles = new Map();
const g_vecExecutedCommands = [];
const g_vecCVarWrites = [];
let g_bWriteAccepted = true;
let g_bNativeExecutionSucceeded = true;

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertThrows(Callback, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert(CaughtError instanceof Error, strErrorMessage);
}

function InstallDependency(strFilePath, ModuleExports) {
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

function RequirePath(strFilePath) {
	if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
		throw new TypeError("Config path must be a non-empty string.");
	}

	return strFilePath;
}

const g_NativeConfiguration = {
	EnsureDirectoryExists(strDirectoryPath) {
		RequirePath(strDirectoryPath);

		return true;
	},
	DoesFileExist(strFilePath) {
		return g_mapVirtualFiles.has(RequirePath(strFilePath));
	},
	ReadTextFile(strFilePath) {
		return g_mapVirtualFiles.get(RequirePath(strFilePath)) ?? "";
	},
	Root: "cfg/sourcejs",
	WriteTextFile(strFilePath, strText) {
		RequirePath(strFilePath);

		if (typeof strText !== "string") {
			throw new TypeError("Config text must be a string.");
		}

		if (!g_bWriteAccepted) {
			return false;
		}

		g_mapVirtualFiles.set(strFilePath, strText);

		return true;
	},
};

InstallDependency(g_strCommandsPath, {
	ExecuteCommand(strCommandLine) {
		g_vecExecutedCommands.push(strCommandLine);

		return g_bNativeExecutionSucceeded;
	},
});

InstallDependency(g_strCVarsPath, {
	SetConVar(strName, strValue) {
		g_vecCVarWrites.push([strName, strValue]);

		return g_bNativeExecutionSucceeded;
	},
});

const g_bHadSourceJS = Object.hasOwn(globalThis, "sourcejs");
const g_OriginalSourceJS = globalThis.sourcejs;
const g_OriginalModuleLoad = g_Module._load;
globalThis.sourcejs = { config: g_NativeConfiguration };
g_Module._load = function LoadPackageModule(strRequest) {
	if (g_setPackageModuleNames.has(strRequest)) {
		const vecArguments = Array.from(arguments);
		vecArguments[0] = g_Path.join(g_strPackageRoot, `${strRequest}.js`);
		return Reflect.apply(g_OriginalModuleLoad, this, vecArguments);
	}

	return Reflect.apply(g_OriginalModuleLoad, this, arguments);
};

function VerifyCommandArgumentSerialization(Configuration) {
	let unCases = 0;
	class ArgumentArray extends Array {
		static get [Symbol.species]() {
			throw new Error("Command serialization must not consult array species.");
		}
	}

	const vecCustomArguments = new ArgumentArray("value with spaces");
	vecCustomArguments.map = () => ["unquoted"];
	vecCustomArguments[Symbol.iterator] = () => {
		throw new Error("Command serialization must not consult a custom iterator.");
	};
	const CustomEntry = Configuration.CreateCommandConfigEntry("echo", "", { Arguments: vecCustomArguments });
	AssertEqual(CustomEntry.ArgumentLine, '"value with spaces"', "custom map cannot bypass quoting");
	AssertEqual(CustomEntry.Arguments, vecCustomArguments, "argument storage remains live");
	vecCustomArguments[0] = 'a"b';
	AssertEqual(CustomEntry.ArgumentLine, Configuration.QuoteConfigValue('a"b'), "live argument changes are quoted on each read");
	unCases += 1;

	const vecInheritedArguments = new Array(1);
	Object.setPrototypeOf(vecInheritedArguments, Object.assign(Object.create(Array.prototype), { 0: "inherited" }));
	for (const vecArguments of [new Array(1), ["first", , "last"], vecInheritedArguments, [NaN], [Infinity], [1n], [{}], [[]]]) {
		const Entry = Configuration.CreateCommandConfigEntry("echo", "", { Arguments: vecArguments });
		AssertThrows(() => Entry.ArgumentLine, "serialization rejects sparse or invalid arguments");
		AssertEqual(Entry.RenderConfigEntry({ CommentPrefix: "//" }, new Map([["echo", "saved arguments"]]))[0], "echo saved arguments", "previous arguments bypass live validation");
		unCases += 1;
	}

	for (const vecArguments of [[], [""], [null, undefined, true, false, 0, -3, 1.5, "quoted"]]) {
		const Entry = Configuration.CreateCommandConfigEntry("echo", "", { Arguments: vecArguments });
		AssertEqual(Entry.ArgumentLine, vecArguments.map(Configuration.QuoteConfigValue).join(" "), "supported value quoting is unchanged");
		unCases += 1;
	}

	for (const InvalidLength of [-1, 0.5, NaN, Infinity, "1", undefined]) {
		const vecArguments = new Proxy(["value"], {
			get(Target, Property, Receiver) {
				return (Property === "length") ? InvalidLength : Reflect.get(Target, Property, Receiver);
			},
		});
		const Entry = Configuration.CreateCommandConfigEntry("echo", "", { Arguments: vecArguments });
		AssertThrows(() => Entry.ArgumentLine, "serialization rejects invalid array lengths");
		unCases += 1;
	}

	let unLengthReads = 0;
	let unSlotReads = 0;
	const vecChangingArguments = new Proxy(["value"], {
		get(Target, Property, Receiver) {
			if (Property === "length") {
				unLengthReads += 1;
				return (unLengthReads === 1) ? 1 : 0;
			}

			if (Property === "0") {
				unSlotReads += 1;
				return (unSlotReads === 1) ? "value" : 42;
			}

			return Reflect.get(Target, Property, Receiver);
		},
	});
	const ChangingEntry = Configuration.CreateCommandConfigEntry("echo", "", { Arguments: vecChangingArguments });
	AssertEqual(ChangingEntry.ArgumentLine, '"value"', "serialization uses the first argument value");
	AssertEqual(unLengthReads, 1, "length is read once per serialization");
	AssertEqual(unSlotReads, 1, "each slot is read once per serialization");
	AssertEqual(ChangingEntry.ArgumentLine, "", "the next serialization sees the updated length");
	unCases += 1;

	for (const FailureValue of [undefined, null, false, 0, "failure", new Error("Argument read failed.")]) {
		for (const strProperty of ["length", "0"]) {
			const vecArguments = new Proxy(["value"], {
				get(Target, Property, Receiver) {
					if (Property === strProperty) {
						throw FailureValue;
					}

					return Reflect.get(Target, Property, Receiver);
				},
			});
			const Entry = Configuration.CreateCommandConfigEntry("echo", "", { Arguments: vecArguments });
			let bThrew = false;
			try {
				Reflect.get(Entry, "ArgumentLine");
			} catch (CaughtFailure) {
				bThrew = true;
				AssertEqual(CaughtFailure, FailureValue, "serialization preserves exact access failures");
			}

			Assert(bThrew, "argument getter failure propagates");
			unCases += 1;
		}
	}

	console.log(`[smoke_config_cvar] Command arguments ${unCases} profiles passed`);
}

function VerifyConfigurationTextNormalization(Configuration) {
	let unCases = 0;

	class TextArray extends Array {
		static get [Symbol.species]() {
			throw new Error("Configuration text must not consult array species.");
		}
	}

	const vecText = new TextArray(" First ", "Second");
	vecText.map = () => [42];
	vecText[Symbol.iterator] = () => {
		throw new Error("Configuration text must not consult a custom iterator.");
	};
	const TextEntry = new Configuration.ConfigTextEntry(vecText);
	const Manager = new Configuration.ConfigManager("normalization-test");
	AssertEqual(TextEntry.Lines.join("|"), " First |Second", "text entry validates each source line");
	AssertEqual(Object.getPrototypeOf(TextEntry.Lines), Array.prototype, "text entry stores a plain snapshot");
	AssertEqual(Manager.SetHeaderLines(vecText), Manager, "header setter remains chainable");
	AssertEqual(Manager.HeaderLines.join("|"), " First |Second", "header setter validates each source line");
	vecText[0] = "Changed";
	AssertEqual(TextEntry.Lines[0], " First ", "text entry does not retain its source array");
	AssertEqual(Manager.HeaderLines[0], " First ", "header does not retain its source array");
	const vecRenderedLines = TextEntry.RenderConfigEntry();
	vecRenderedLines[0] = "Changed copy";
	AssertEqual(TextEntry.Lines[0], " First ", "rendered text remains a fresh copy");
	unCases += 1;

	for (const Text of [null, undefined, "", [], "First\r\nSecond"]) {
		const vecExpectedLines = Configuration.NormalizeDescription(Text);
		AssertEqual(new Configuration.ConfigTextEntry(Text).Lines.join("|"), vecExpectedLines.join("|"), "text entry preserves scalar/default normalization");
		Manager.SetHeaderLines(Text);
		AssertEqual(Manager.HeaderLines.join("|"), vecExpectedLines.join("|"), "header preserves scalar/default normalization");
		unCases += 1;
	}

	const vecInheritedText = new Array(1);
	Object.setPrototypeOf(vecInheritedText, Object.assign(Object.create(Array.prototype), { 0: "inherited" }));
	for (const vecInvalid of [new Array(1), ["First", , "Last"], vecInheritedText, [null], [undefined], [42], [{}], [{ GetTranslation: () => 42 }]]) {
		Manager.SetHeaderLines("Before");
		const vecPreviousHeader = Manager.HeaderLines;
		AssertThrows(() => new Configuration.ConfigTextEntry(vecInvalid), "text entry rejects invalid line arrays");
		AssertThrows(() => Manager.SetHeaderLines(vecInvalid), "header rejects invalid line arrays");
		AssertEqual(Manager.HeaderLines, vecPreviousHeader, "failed header normalization does not commit");
		unCases += 1;
	}

	for (const FailureValue of [undefined, null, false, 0, "failure", new Error("Text access failed.")]) {
		for (const strProperty of ["length", "0"]) {
			const vecThrowingText = new Proxy(["First"], {
				get(Target, Property, Receiver) {
					if (Property === strProperty) {
						throw FailureValue;
					}

					return Reflect.get(Target, Property, Receiver);
				},
			});
			for (const Normalize of [(Text) => new Configuration.ConfigTextEntry(Text), (Text) => Manager.SetHeaderLines(Text)]) {
				Manager.SetHeaderLines("Before");
				const vecPreviousHeader = Manager.HeaderLines;
				let bThrew = false;
				try {
					Normalize(vecThrowingText);
				} catch (CaughtFailure) {
					bThrew = true;
					AssertEqual(CaughtFailure, FailureValue, "configuration text preserves exact access failures");
				}

				Assert(bThrew, "text access failure propagates");
				AssertEqual(Manager.HeaderLines, vecPreviousHeader, "access failure does not replace the header");
				unCases += 1;
			}
		}
	}

	console.log(`[smoke_config_cvar] Configuration text ${unCases} profiles passed`);
}

try {
	const Configuration = require(g_strConfigurationPath);
	VerifyCommandArgumentSerialization(Configuration);
	VerifyConfigurationTextNormalization(Configuration);
	AssertEqual(Configuration, g_NativeConfiguration, "config should expose the exact native object");
	AssertEqual(Object.hasOwn(Configuration, "ModuleName"), false, "config should not expose ModuleName");

	const Entry = new Configuration.CVarConfigEntry("sjs_enabled", true, "Enable SourceJS", { Flags: "0", ValueMaximum: 1, ValueMinimum: 0 });
	Entry.AddHelpText(["Additional help line"]);
	Entry.AddHelpText(["Translated help line"]);

	const Choices = Entry.CreateHelpList("Values");
	Choices.AppendListItem("0 disables the feature").AppendListItem("1 enables the feature");

	const strRenderedEntry = Entry.RenderConfigEntry({ CommentPrefix: "//" }).join("\n");
	Assert(strRenderedEntry.includes("// Additional help line"), "CVarConfigEntry text help");
	Assert(strRenderedEntry.includes("// Translated help line"), "CVarConfigEntry translated help");
	Assert(strRenderedEntry.includes("// Values"), "CVarConfigEntry list heading");
	AssertEqual(Array.from(Choices).length, 2, "ListManager iteration");
	AssertEqual(typeof Entry.toJSON, "undefined", "CVarConfigEntry should not expose snapshots");
	AssertThrows(() => Entry.AddHelpText(7), "CVarConfigEntry should reject scalar text coercion");

	const Section = Configuration.CreateConfigSection("Section", { Width: 8, Separator: "=" });
	const CommandEntry = Configuration.CreateCommandConfigEntry("echo", "Description", { Arguments: ["hello world"] });
	const vecRenderOperations = [
		(ConfigurationContext) => Section.RenderConfigEntry(ConfigurationContext),
		(ConfigurationContext) => Entry.RenderConfigEntry(ConfigurationContext),
		(ConfigurationContext) => Entry.GetHelpLines(ConfigurationContext),
		(ConfigurationContext) => Choices.RenderList(ConfigurationContext),
		(ConfigurationContext) => CommandEntry.RenderConfigEntry(ConfigurationContext),
	];
	// Reject legacy and incorrectly cased keys rather than accepting aliases.
	for (const InvalidContext of [[], true, 1, {}, { m_strCommentPrefix: "#" }, { commentPrefix: "#" }, { Commentprefix: "#" }, { CommentPrefix: 1 }]) {
		for (const Render of vecRenderOperations) {
			AssertThrows(() => Render(InvalidContext), "render contexts must use the validated PascalCase CommentPrefix");
		}
	}

	AssertEqual(Section.RenderConfigEntry(undefined)[0], "// ========", "section's omitted manager keeps default prefix");
	AssertEqual(Section.RenderConfigEntry(null)[0], "// ========", "section's null manager keeps default prefix");

	for (const Render of vecRenderOperations.slice(1)) {
		AssertThrows(() => Render(undefined), "typed/list/command renderers require a manager");
		AssertThrows(() => Render(null), "typed/list/command renderers reject null manager");
	}

	AssertEqual(Section.RenderConfigEntry({ CommentPrefix: "#" })[0], "# ========", "section's explicit prefix");
	AssertEqual(CommandEntry.RenderConfigEntry({ CommentPrefix: "#" })[1], 'echo "hello world"', "command arguments remain quoted");

	const Translation = {
		Text: "Translated",
		GetString() {
			return this.Text;
		},
	};
	AssertEqual(Configuration.CreateConfigSection(Translation).Name, "Translated", "translation receiver is preserved");

	const PriorityTranslation = {
		GetTranslation() {
			return "Primary";
		},
		GetString() {
			throw new Error("Wrong translation priority");
		},
	};
	AssertEqual(Configuration.ResolveConfigText(PriorityTranslation), "Primary", "translation method priority");
	AssertThrows(() => Configuration.ResolveConfigText({ GetString: () => 1 }), "translation output must be a string");

	const Manager = new Configuration.ConfigManager("sourcejs/test", { CVarPrefix: "sjs_", Indentation: 3, MaxLineLength: 79 });
	Manager.SetHeaderLines(["Translated Header"]);
	Manager.AddConfigTextEntry(["Translated raw text"]);
	Manager.AddConfigSection("Translated Section");
	g_mapVirtualFiles.set(Manager.FilePath, [
		"sjs_volume \"8\"",
		"legacy_setting \"keep\"",
		"legacy_command one two",
	].join("\n"));

	const Volume = Manager.AddCVarConfigEntry("volume", 5, "Volume");
	Volume.AddHelpText(["Use a value from 0 to 10"]);
	Volume.CreateHelpList("Examples").ExtendListItems(["0 muted", "10 loud"]);
	Manager.AddCommandConfigEntry("sjs_reload", "Reload SourceJS", { Arguments: ["now"] });

	const strRenderedConfiguration = Manager.RenderConfig();
	Assert(strRenderedConfiguration.includes("sjs_volume"), "ConfigManager cvar prefix");
	Assert(strRenderedConfiguration.includes("// Translated Header"), "ConfigManager translated header");
	Assert(strRenderedConfiguration.includes("Translated raw text"), "ConfigManager translated text");
	Assert(strRenderedConfiguration.includes("Translated Section"), "ConfigManager translated section");
	Assert(strRenderedConfiguration.includes('sjs_volume "8"'), "ConfigManager previous value");
	Assert(strRenderedConfiguration.includes("// legacy_command one two"), "ConfigManager unused command preservation");
	Assert(strRenderedConfiguration.includes('// legacy_setting "keep"'), "ConfigManager unused value preservation");

	const ParsedConfiguration = Configuration.ParseConfigText(g_mapVirtualFiles.get(Manager.FilePath));
	const vecUnusedEntries = Configuration.GetUnusedConfigEntries(ParsedConfiguration.Entries, new Set(["sjs_volume"]));
	AssertEqual(vecUnusedEntries.map((UnusedEntry) => UnusedEntry.Name).join(","), "legacy_command,legacy_setting", "unused config entries");
	Assert(Configuration.CreateCVarConfigEntry("sjs_mode", "default") instanceof Configuration.CVarConfigEntry, "top-level cvar factory");
	Assert(Configuration.CreateCommandConfigEntry("sjs_reload") instanceof Configuration.CommandConfigEntry, "top-level command factory");
	Assert(Configuration.CreateConfigSection("SourceJS") instanceof Configuration.ConfigSectionManager, "top-level section factory");
	AssertEqual(Configuration.QuoteConfigValue('a"b'), '"a\\"b"', "quoted config value");
	AssertEqual(Configuration.ResolveConfigText("translated"), "translated", "translated config text");
	AssertThrows(() => new Configuration.ConfigManager("sourcejs/legacy", "sjs_"), "ConfigManager should reject positional options");

	const vecExecutionResults = Manager.ExecuteConfig();
	AssertEqual(vecExecutionResults.length, 2, "ConfigManager execution result count");
	AssertEqual(g_vecCVarWrites[0][0], "sjs_volume", "ConfigManager cvar execution");
	AssertEqual(g_vecExecutedCommands[0], 'sjs_reload "now"', "ConfigManager command execution");
	Assert(vecExecutionResults.every((Result) => Result.Success === true), "native calls return boolean success");

	g_bNativeExecutionSucceeded = false;
	Assert(Manager.ExecuteConfig().every((Result) => Result.Success === false), "native failure results remain boolean false");
	g_bNativeExecutionSucceeded = true;

	const strPreviousFileText = g_mapVirtualFiles.get(Manager.FilePath);
	g_bWriteAccepted = false;
	AssertThrows(() => Manager.WriteConfig(), "native write failure must propagate");
	AssertEqual(g_mapVirtualFiles.get(Manager.FilePath), strPreviousFileText, "rejected write preserves the previous file");
	g_bWriteAccepted = true;
	AssertEqual(Manager.WriteConfig(), Manager.FilePath, "successful write returns its path");

	for (const Record of [Entry, Choices, Section, CommandEntry, Manager]) {
		Assert(Object.keys(Record).every((strFieldName) => /^[A-Z][A-Za-z0-9]*$/.test(strFieldName)), "project-owned public configuration fields use PascalCase without member prefixes");
	}

	console.log("[  OK  ] smoke_config_cvar");
} finally {
	g_Module._load = g_OriginalModuleLoad;

	for (const strModulePath of Object.keys(require.cache)) {
		if (strModulePath.startsWith(`${g_strPackageRoot}${g_Path.sep}`) && !g_mapOriginalPackageModules.has(strModulePath)) {
			delete require.cache[strModulePath];
		}
	}

	for (const [strModulePath, PackageModule] of g_mapOriginalPackageModules) {
		require.cache[strModulePath] = PackageModule;
	}

	if (g_bHadSourceJS) {
		globalThis.sourcejs = g_OriginalSourceJS;
	} else {
		delete globalThis.sourcejs;
	}
}
