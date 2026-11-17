#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_OriginalModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalSourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_OriginalCacheDescriptors = Object.getOwnPropertyDescriptors(require.cache);
let g_CleanupMenuState = null;

function RestoreProperty(Target, strName, Descriptor) {
	if (Descriptor === undefined) {
		delete Target[strName];
		return;
	}

	Object.defineProperty(Target, strName, Descriptor);
}

try {
	const g_strRootPath = g_Path.resolve(__dirname, "..");
	const g_strPackageRootPath = g_Path.join(g_strRootPath, "packages", "sourcejs");
	const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
	const g_ModulePaths = {
		commands: g_Path.join(g_strPackageRootPath, "commands.js"),
		"commands/client": g_Path.join(g_strPackageRootPath, "commands", "client.js"),
		globals: g_Path.join(g_strPackageRootPath, "globals.js"),
		messages: g_Path.join(g_strPackageRootPath, "messages.js"),
		menus: g_Path.join(g_strPackageRootPath, "menus.js"),
		"menus/esc": g_Path.join(g_strPackageRootPath, "menus", "esc.js"),
		"menus/index": g_Path.join(g_strPackageRootPath, "menus", "index.js"),
		"menus/queue": g_Path.join(g_strPackageRootPath, "menus", "queue.js"),
		"menus/radio": g_Path.join(g_strPackageRootPath, "menus", "radio.js"),
	};
	const g_vecShownTextMenus = [];
	const g_vecHiddenTextMenus = [];
	const g_vecShownRadioMenus = [];
	const g_vecShownESCMenus = [];
	const g_mapClientCommands = new Map();
	const g_unExampleTimeoutMilliseconds = 1000;
	const g_strJavaScriptFenceMarker = "```js";

	// The native endpoints below are transport doubles, not SDK/server execution.
	for (const strModulePath of [...Object.values(g_ModulePaths), g_strRuntimePath]) {
		delete require.cache[strModulePath];
	}

	Object.defineProperty(globalThis, "sourcejs", {
		configurable: true,
		writable: true,
		value: {
			globals: {
				MapLoadType: { BACKGROUND: 3, LOAD_GAME: 1, NEW_GAME: 0, TRANSITION: 2 },

				GetGlobalVariables() {
					return { SDKBranch: "l4d2" };
				},
			},
			menus: {
				HideText(nPlayerIndex) {
					g_vecHiddenTextMenus.push(nPlayerIndex);

					return true;
				},

				ShowText(nPlayerIndex, strMenuTitle, strMenuMessage, nMenuDisplayTime) {
					g_vecShownTextMenus.push({ Title: strMenuTitle, Message: strMenuMessage, DisplayTime: nMenuDisplayTime, PlayerIndex: nPlayerIndex });

					return true;
				},
			},
			messages: {
				CreateDialog(unPlayerIndex, unDialogType, DialogFields, strDialogName) {
					g_vecShownESCMenus.push({ DialogFields: structuredClone(DialogFields), Name: strDialogName, DialogType: unDialogType, PlayerIndex: unPlayerIndex });

					return true;
				},

				GetDialogTypes() {
					return { AskConnect: 4, Entry: 3, Menu: 1, Message: 0, Text: 2 };
				},
			},
		},
	});

	function InstallDependency(strRelativePath, ModuleExports) {
		const strModulePath = g_Path.join(g_strPackageRootPath, strRelativePath);
		delete require.cache[strModulePath];
		require.cache[strModulePath] = {
			exports: ModuleExports,
			filename: strModulePath,
			id: strModulePath,
			loaded: true,
		};
	}

	function LoadMenuModules() {
		const OriginalModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
		const OriginalModuleLoad = g_Module._load;
		const Load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			if (Object.hasOwn(g_ModulePaths, strRequestName)) {
				return require(g_ModulePaths[strRequestName]);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		try {
			Object.defineProperty(g_Module, "_load", { configurable: true, enumerable: OriginalModuleLoadDescriptor.enumerable, writable: true, value: Load });
			require(g_Path.join(g_strPackageRootPath, "menus.js"));

			return {
				MenuObjects: require(g_Path.join(g_strPackageRootPath, "menus", "index.js")),
				MenuQueue: require(g_Path.join(g_strPackageRootPath, "menus", "queue.js")),
				Radio: require(g_Path.join(g_strPackageRootPath, "menus", "radio.js")),
				ESC: require(g_Path.join(g_strPackageRootPath, "menus", "esc.js")),
			};
		} finally {
			RestoreProperty(g_Module, "_load", OriginalModuleLoadDescriptor);
		}
	}

	function RunDocumentationOperation(Operation, vecArguments, strScenarioLabel) {
		// Bound synchronous JavaScript, including callbacks; this is not an IO sandbox.
		const Script = new g_VM.Script("Operation(...Arguments)", { filename: strScenarioLabel });

		return Script.runInNewContext({ Operation: Operation, Arguments: vecArguments }, { timeout: g_unExampleTimeoutMilliseconds });
	}

	function CreateExampleRunner(strExampleSource, strScenarioLabel) {
		const RunExample = g_VM.compileFunction("\"use strict\";\n" + strExampleSource, ["require", "exports"], { filename: strScenarioLabel });

		return (RequireExampleModule, ExampleExports = {}) => RunDocumentationOperation(RunExample, [RequireExampleModule, ExampleExports], strScenarioLabel);
	}

	InstallDependency("commands.js", { BLOCK: 1, CONTINUE: 0, HANDLED: 1, CommandReturn: { Block: 1, Continue: 0, Handled: 1 } });
	InstallDependency("commands/client.js", {
		RegisterCommand(strCommandName, CommandCallback) {
			g_mapClientCommands.set(strCommandName, CommandCallback);

			return true;
		},

		UnregisterCommand(strCommandName, CommandCallback) {
			return (g_mapClientCommands.get(strCommandName) === CommandCallback) && g_mapClientCommands.delete(strCommandName);
		},
	});
	InstallDependency("globals.js", globalThis.sourcejs.globals);
	InstallDependency("messages.js", {
		ShowMenu: class ShowMenu {
			constructor(strMenuString, unValidSlots, unDisplayTime) {
				this.m_MessageFields = { DisplayTime: unDisplayTime, MenuString: strMenuString, ValidSlots: unValidSlots };
			}

			SendUserMessage(TargetReferences) {
				const vecRecipientIndexes = Array.isArray(TargetReferences) ? TargetReferences : [TargetReferences];
				g_vecShownRadioMenus.push({ ...this.m_MessageFields, RecipientIndexes: [...vecRecipientIndexes] });

				return true;
			}
		},
	});

	const g_MenuModules = LoadMenuModules();
	const g_MenuObjects = g_MenuModules.MenuObjects;
	const g_MenuQueue = g_MenuModules.MenuQueue;
	const g_Radio = g_MenuModules.Radio;
	const g_ESC = g_MenuModules.ESC;

	g_CleanupMenuState = () => {
		const vecCleanupErrors = [];
		for (const Queue of g_MenuQueue.ListPlayerMenuQueues()) {
			try {
				Queue.ClearMenuQueue();
			} catch (CaughtError) {
				vecCleanupErrors.push(CaughtError);
			}
		}

		g_mapClientCommands.clear();

		if (vecCleanupErrors.length !== 0) {
			throw new AggregateError(vecCleanupErrors, "smoke_menus queue cleanup failed");
		}
	};

	const g_vecExpectedMenuObjectExports = [
		"BaseMenu",
		"MenuRenderData",
		"MenuText",
		"PagedMenu",
		"PagedMenuOption",
		"SimpleMenu",
		"SimpleMenuOption",
	];
	g_Assert.deepEqual(Object.keys(g_MenuObjects).sort(), g_vecExpectedMenuObjectExports.sort());

	const g_vecExpectedMenuQueueExports = [
		"ClearMenuQueue",
		"CloseActivePlayerMenu",
		"GetPlayerMenuQueue",
		"ListPlayerMenuQueues",
		"MenuQueue",
		"RegisterMenuSelectCommand",
	];
	g_Assert.deepEqual(Object.keys(g_MenuQueue).sort(), g_vecExpectedMenuQueueExports.sort());
	g_Assert.equal(typeof g_Radio.SendRadioMenu, "function");
	g_Assert.equal(typeof g_ESC.SendESCMenu, "function");
	g_Assert.equal(typeof g_ESC.SimpleESCMenu, "function");
	g_Assert.equal(typeof g_ESC.PagedESCOption, "function");

	const g_BaseMenu = new g_MenuObjects.BaseMenu({ Description: "Choose for {Player}", Title: "Action" });
	g_BaseMenu.AppendMenuItem(new g_MenuObjects.SimpleMenuOption(1, "Continue", "continue"));
	g_BaseMenu.AppendMenuItem(new g_MenuObjects.MenuText("Context: {Context}"));

	const g_RenderData = g_BaseMenu.GetMenuRenderData(1, 0, { Context: "current", Player: "Ren" });
	g_Assert.ok(g_RenderData instanceof g_MenuObjects.MenuRenderData);
	g_Assert.equal(g_RenderData.MenuTitle, "Action");
	g_Assert.equal(g_RenderData.MenuMessage, "Choose for Ren\n\n1. Continue\nContext: current");
	g_Assert.equal(g_BaseMenu.Length, 2);
	g_Assert.equal(g_BaseMenu.GetMenuOptions().length, 1);

	const g_Queue = g_MenuQueue.GetPlayerMenuQueue(1);
	g_Assert.equal(g_Queue, new g_MenuQueue.MenuQueue({ Index: 1 }));
	g_Assert.equal(g_BaseMenu.SendMenu(1), true);
	g_Assert.equal(g_Queue.ActiveMenu, g_BaseMenu);
	g_Assert.equal(g_Queue.SelectMenuOption(1), true);
	g_Assert.equal(g_Queue.ActiveMenu, null);
	g_MenuQueue.ClearMenuQueue(1);

	const g_PagedMenu = new g_MenuObjects.PagedMenu({ Title: "Pages", ItemsPerPage: 1 });
	g_PagedMenu.AppendMenuItem(new g_MenuObjects.PagedMenuOption("One", "one"));
	g_PagedMenu.AppendMenuItem(new g_MenuObjects.PagedMenuOption("Two", "two"));

	const g_PagedRenderData = g_PagedMenu.GetMenuRenderData(1, 1);
	g_Assert.equal(g_PagedRenderData.PageIndex, 1);
	g_Assert.equal(g_PagedMenu.LastPageIndex, 1);

	const vecInteractions = [];

	function RecordInteraction(unPlayerIndex, strInteraction, SelectedItem, Menu) {
		g_Assert.equal(this, Menu);
		vecInteractions.push([unPlayerIndex, strInteraction, SelectedItem?.Value ?? null]);
	}

	for (const [MenuType, OptionType] of [[g_Radio.PagedRadioMenu, g_Radio.PagedRadioOption], [g_ESC.PagedESCMenu, g_ESC.PagedESCOption]]) {
		const ParentMenu = new MenuType({ Title: "Parent" });
		const Menu = new MenuType({ Title: "Feedback", ItemsPerPage: 2, ParentMenu, InteractionCallback: RecordInteraction });
		Menu.AppendMenuItem(new OptionType("One", "one"));
		Menu.AppendMenuItem(new OptionType("Disabled", "disabled", { Selectable: false }));
		Menu.AppendMenuItem(new OptionType("Two", "two"));

		const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
		const unBeforeInteractions = vecInteractions.length;
		g_Assert.equal(Menu.SendMenu(1), true);
		g_Assert.equal(Queue.SelectMenuOption(2), false);
		g_Assert.equal(Queue.SelectMenuOption(Menu.NextChoiceIndex), true);
		g_Assert.equal(Queue.SelectMenuOption(Menu.BackChoiceIndex), true);
		g_Assert.equal(Queue.SelectMenuOption(Menu.BackChoiceIndex), true);
		g_Assert.equal(Queue.ActiveMenu, ParentMenu);

		g_Assert.equal(Queue.SendMenu(Menu), true);
		g_Assert.equal(Queue.SelectMenuOption(Menu.CloseChoiceIndex), true);

		g_Assert.equal(Menu.SendMenu(1), true);
		g_Assert.equal(Queue.SelectMenuOption(1), true);

		g_Assert.equal(Menu.SendMenu(1), true);
		g_Assert.equal(Menu.CloseMenu(1), true);

		g_Assert.deepEqual(vecInteractions.slice(unBeforeInteractions), [[1, "Next", null], [1, "Back", null], [1, "ExitBack", null], [1, "Exit", null], [1, "Select", "one"]]);
	}

	g_MenuQueue.ClearMenuQueue(1);

	const g_RadioMenu = new g_Radio.SimpleRadioMenu({ Title: "Vote" });
	g_RadioMenu.AppendMenuItem(new g_Radio.SimpleRadioOption(1, "Yes", "yes"));
	g_Assert.equal(g_RadioMenu.SendMenuToPlayer(2), true);
	g_Assert.equal(g_vecShownRadioMenus.at(-1).RecipientIndexes[0], 2);
	g_RadioMenu.CloseMenuForPlayer(2);

	const VoteMenu = new g_Radio.SimpleRadioMenu({ Title: "Vote without a VGUI fallback", CloseText: "Skip vote" });
	VoteMenu.UseTextDialogFallback = false;
	VoteMenu.AppendMenuItem(new g_Radio.SimpleRadioOption(1, "Yes", "yes"));

	const unHiddenTextBeforeVote = g_vecHiddenTextMenus.length;
	g_Assert.equal(VoteMenu.SendMenu(2), true);
	g_Assert.match(g_vecShownRadioMenus.at(-1).MenuString, /\. Skip vote$/);
	g_Assert.equal(g_MenuQueue.GetPlayerMenuQueue(2).SelectMenuOption(1), true);
	g_Assert.equal(g_vecHiddenTextMenus.length, unHiddenTextBeforeVote, "A radio vote must close without a VGUI text dialog.");

	g_Assert.equal(VoteMenu.SendMenu(2), true);
	g_Assert.equal(VoteMenu.CloseMenu(2), true);
	g_Assert.equal(g_vecHiddenTextMenus.length, unHiddenTextBeforeVote, "Closing the vote must not send a VGUI text dialog.");

	const ESCMenu = new g_ESC.SimpleESCMenu({ Title: "ESC", Description: "Choose", CloseText: "Skip vote", TitleColor: { Alpha: 0xFF, Blue: 0x50, Green: 0xDC, Red: 0x50 } });
	ESCMenu.AppendMenuItem(new g_ESC.SimpleESCOption(1, "Yes", "yes"));
	g_Assert.equal(ESCMenu.SendMenuToPlayer(3), true);
	g_Assert.equal(g_vecShownESCMenus.at(-1).DialogType, 1);
	g_Assert.deepEqual(g_vecShownESCMenus.at(-1).DialogFields.Color, ESCMenu.ValueTitleColor, "ESC color must use the exact native Color field");
	g_Assert.deepEqual(g_vecShownESCMenus.at(-1).DialogFields[1], { Msg: "1. Yes", Command: "menuselect 1" });
	g_Assert.deepEqual(g_vecShownESCMenus.at(-1).DialogFields[0], { Msg: "0. Skip vote", Command: "menuselect 0" });
	g_Assert.equal(g_vecShownESCMenus.at(-1).DialogFields.Title, "ESC");
	g_Assert.equal(g_vecShownESCMenus.at(-1).DialogFields.Msg, "Choose");
	g_Assert.equal(g_vecShownESCMenus.at(-1).DialogFields.Time, ESCMenu.Timeout);
	g_Assert.equal(g_vecShownESCMenus.at(-1).DialogFields.Level > 0, true);

	ESCMenu.CloseMenuForPlayer(3);
	g_Assert.deepEqual(Object.keys(g_vecShownESCMenus.at(-1).DialogFields).sort(), ["Level", "Msg", "Time", "Title"]);
	g_Assert.equal(g_vecShownESCMenus.at(-1).DialogFields.Msg, "");

	const PagedBallot = new g_ESC.PagedESCMenu({ Fill: false, ItemsPerPage: 1, BackText: "Previous page", NextText: "Next page", CloseText: "Skip vote" });
	PagedBallot.AppendMenuItem(new g_ESC.PagedESCOption("One", 1));
	PagedBallot.AppendMenuItem(new g_ESC.PagedESCOption("Two", 2));

	g_Assert.equal(PagedBallot.SendMenuToPlayer(3, 0), true);
	const FirstPage = g_vecShownESCMenus.at(-1).DialogFields;
	g_Assert.equal(Object.hasOwn(FirstPage, PagedBallot.BackChoiceIndex), false);
	g_Assert.match(FirstPage[PagedBallot.NextChoiceIndex].Msg, /\. Next page$/);

	g_Assert.equal(PagedBallot.SendMenuToPlayer(3, 1), true);
	const SecondPage = g_vecShownESCMenus.at(-1).DialogFields;
	g_Assert.match(SecondPage[PagedBallot.BackChoiceIndex].Msg, /\. Previous page$/);
	g_Assert.equal(Object.hasOwn(SecondPage, PagedBallot.NextChoiceIndex), false);

	PagedBallot.CloseMenuForPlayer(3);

	function CheckESCRendererResultDiagnostic() {
		const unPlayerIndex = 3;
		const strMenuTitle = "Invalid renderer";
		const RendererMenu = new g_ESC.SimpleESCMenu({ Title: strMenuTitle });
		RendererMenu.AppendMenuItem(new g_MenuObjects.MenuText("Context"));
		RendererMenu.BuildMenuRenderData = () => ({ MenuTitle: strMenuTitle, PageIndex: 0 });
		RendererMenu.RenderMenuItem = () => 42;
		const unDialogCountBefore = g_vecShownESCMenus.length;

		try {
			g_Assert.throws(() => RendererMenu.SendMenuToPlayer(unPlayerIndex), { name: "TypeError", message: "ESC menu RenderMenuItem must return a string." });
			g_Assert.equal(g_vecShownESCMenus.length, unDialogCountBefore, "Invalid ESC renderer results fail before native dialog dispatch");
		} finally {
			RendererMenu.CloseMenuForPlayer(unPlayerIndex);
		}
	}

	function CheckPolymorphicMenuText() {
		const RenderText = (unPlayerIndex, TokenFields) => `${unPlayerIndex}:${TokenFields.Label}`;
		const vecMenuItems = [
			new g_MenuObjects.MenuText(RenderText),
			new g_MenuObjects.SimpleMenuOption(1, RenderText),
			new g_MenuObjects.PagedMenuOption(RenderText),
			new g_ESC.SimpleESCOption(1, RenderText),
			new g_ESC.PagedESCOption(RenderText),
			new g_ESC.ListESCOption(RenderText),
			new g_Radio.SimpleRadioOption(1, RenderText),
			new g_Radio.PagedRadioOption(RenderText),
			new g_Radio.ListRadioOption(RenderText),
		];
		for (const MenuItem of vecMenuItems) {
			g_Assert.equal(MenuItem.Text, RenderText, "menu constructors retain non-string text values");
			g_Assert.equal(MenuItem.GetMenuText(3, { Label: "ready" }), "3:ready");
		}

		const MenuInstance = new g_MenuObjects.PagedMenu({ Title: RenderText, Description: RenderText, BackText: RenderText, NextText: RenderText, CloseText: RenderText });
		for (const strPropertyName of ["ValueTitle", "ValueDescription", "ValueBackText", "ValueNextText", "ValueCloseText"]) {
			g_Assert.equal(MenuInstance[strPropertyName], RenderText, "menu text options retain their original values");
		}

		const RenderData = MenuInstance.BuildMenuRenderData(3, 0, { Label: "ready" });
		g_Assert.equal(RenderData.MenuTitle, "3:ready");
		g_Assert.equal(RenderData.MenuMessage, "3:ready\n");

		const RadioMenu = new g_Radio.PagedRadioMenu({ Title: RenderText, TopSeparator: RenderText, BottomSeparator: RenderText, ShowPages: false, Fill: false });
		g_Assert.equal(RadioMenu.ValueTitle, RenderText);
		g_Assert.equal(RadioMenu.ValueTopSeparator, RenderText);
		g_Assert.equal(RadioMenu.ValueBottomSeparator, RenderText);
		g_Assert.equal(RadioMenu.BuildMenuRenderData(3, 0, { Label: "ready" }).MenuTitle, "3:ready");
		g_Assert.equal(typeof Object.getOwnPropertyDescriptor(g_MenuObjects.BaseMenu.prototype, "Length").get, "function");
		g_Assert.equal(Object.hasOwn(g_MenuObjects.SimpleMenu.prototype, "Length"), false, "Length belongs to the base prototype");
		g_Assert.equal(typeof Object.getOwnPropertyDescriptor(g_MenuObjects.PagedMenu.prototype, "LastPageIndex").get, "function");
	}

	function CheckCloseCallbackReplacement(CreateMenu = (Options) => new g_MenuObjects.BaseMenu(Options), bUsesRadio = false) {
		const vecScenarios = [
			{ Name: "CloseActiveMenu", Invoke: (Queue) => g_Assert.equal(Queue.CloseActiveMenu(), true), PendingCount: 1 },
			{ Name: "RemoveMenu", Invoke: (Queue, Menu) => g_Assert.equal(Queue.RemoveMenu(Menu), true), PendingCount: 1 },
			{ Name: "SelectMenuOption", Invoke: (Queue) => g_Assert.equal(Queue.SelectMenuOption(1), true), PendingCount: 1 },
			{ Name: "ClearMenuQueue", Invoke: (Queue) => g_Assert.equal(Queue.ClearMenuQueue(), undefined), PendingCount: 0 },
		];
		for (const Scenario of vecScenarios) {
			for (const bReopensSameMenu of [false, true]) {
				const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
				Queue.ClearMenuQueue();

				let ReplacementMenu = null;
				let unCloseCallbackCount = 0;
				const PendingMenu = CreateMenu({ Title: "Pending" });
				const ClosingMenu = CreateMenu({
					Title: "Closing",

					CloseCallback(unPlayerIndex, MenuObject) {
						unCloseCallbackCount += 1;
						g_Assert.equal(unPlayerIndex, 1);
						g_Assert.equal(this, MenuObject);
						g_Assert.equal(MenuObject.PlayerMenuPages.has(unPlayerIndex), false);
						g_Assert.equal(MenuObject.PlayerTokenRecords.has(unPlayerIndex), false);
						g_Assert.equal(Queue.SendMenu(ReplacementMenu), true);
					},
				});
				ReplacementMenu = bReopensSameMenu ? ClosingMenu : CreateMenu({ Title: "Replacement" });
				ClosingMenu.AppendMenuItem(new g_MenuObjects.SimpleMenuOption(1, "Continue"));

				try {
					g_Assert.equal(Queue.SendMenu(ClosingMenu), true);
					g_Assert.equal(Queue.AppendMenu(PendingMenu), true);

					const unHiddenMenuCount = g_vecHiddenTextMenus.length;
					const strScenarioName = `${Scenario.Name} (same menu: ${bReopensSameMenu})`;
					Scenario.Invoke(Queue, ClosingMenu);
					g_Assert.equal(Queue.ActiveMenu === ReplacementMenu, true, `${strScenarioName} preserves the close callback's replacement`);
					g_Assert.equal(g_vecHiddenTextMenus.length, unHiddenMenuCount, `${strScenarioName} does not hide the replacement`);
					g_Assert.equal(unCloseCallbackCount, 1, `${strScenarioName} invokes the close callback once`);
					g_Assert.equal(Queue.PendingMenuEntries.length, Scenario.PendingCount);
					g_Assert.equal(Queue.Length, Scenario.PendingCount + 1);

					if (bUsesRadio) {
						g_Assert.equal(g_vecShownRadioMenus.at(-1).ValidSlots > 0, true, `${strScenarioName} leaves the replacement radio menu visible`);
					}
				} finally {
					ClosingMenu.CloseCallback = null;
					Queue.ClearMenuQueue();
				}
			}
		}
	}

	function CheckRadioCloseValidation() {
		const Menu = new g_Radio.SimpleRadioMenu({ Title: "Close validation" });

		try {
			g_Assert.equal(Menu.SendMenuToPlayer(1), true);

			Menu.CloseCallback = 1;

			const unRadioMessageCount = g_vecShownRadioMenus.length;
			g_Assert.throws(() => Menu.CloseMenuForPlayer(1), TypeError);
			g_Assert.equal(g_vecShownRadioMenus.length, unRadioMessageCount);
			g_Assert.equal(Menu.PlayerMenuPages.has(1), true);
			g_Assert.equal(Menu.PlayerTokenRecords.has(1), true);
		} finally {
			Menu.CloseCallback = null;
			Menu.CloseMenuForPlayer(1);
		}
	}

	CheckESCRendererResultDiagnostic();
	CheckPolymorphicMenuText();
	CheckCloseCallbackReplacement();
	CheckCloseCallbackReplacement((Options) => new g_Radio.SimpleRadioMenu(Options), true);
	CheckCloseCallbackReplacement((Options) => new g_Radio.PagedRadioMenu(Options), true);
	CheckCloseCallbackReplacement((Options) => new g_Radio.ListRadioMenu(Options), true);
	CheckRadioCloseValidation();

	function CheckESCSetupDocumentationCleanup(strDocumentation) {
		const ESC = require(g_ModulePaths["menus/esc"]);
		const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const vecValues = [
			new Error("Controlled ESC lifecycle failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled aggregate value"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecPrimaryFailures = [
			{ Mode: "NONE" },
			...vecValues.flatMap(Value => [
				{ Mode: "BEFORE", Value },
				{ Mode: "AFTER", Value },
			]),
			{ Mode: "FALSE" },
		];
		const vecCleanupFailures = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "WRONG" },
		];
		const vecSpecifications = [
			{ Index: 2, ConstructorName: "SimpleESCMenu" },
			{ Index: 3, ConstructorName: "PagedESCMenu" },
			{ Index: 4, ConstructorName: "ListESCMenu" },
			{ Index: 5, ConstructorName: "SimpleESCMenu" },
			{ Index: 6, ConstructorName: "PagedESCMenu" },
			{ Index: 7, ConstructorName: "ListESCMenu" },
			{ Index: 8, ConstructorName: "SimpleESCMenu", Direct: true },
			{ Index: 9, ConstructorName: "PagedESCMenu", Direct: true },
			{ Index: 10, ConstructorName: "PagedESCMenu", Selection: true },
		];
		let unCaseCount = 0;
		for (const Specification of vecSpecifications) {
			const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[Specification.Index], ["require", "exports", "Error"]);
			const vecCases = [];
			for (const Cleanup of vecCleanupFailures) {
				for (const Primary of [...vecPrimaryFailures, ...((Specification.Direct || Specification.Selection) ? [] : [{ Mode: "ALREADY_CLOSED" }])]) {
					vecCases.push({ Primary, Cleanup });
				}

				if (Specification.Selection) {
					for (const unTarget of [1, 2]) {
						for (const Value of vecValues) {
							for (const strMode of ["SELECT_BEFORE", "SELECT_AFTER"]) {
								vecCases.push({ Primary: { Mode: strMode, Target: unTarget, Value }, Cleanup });
							}
						}

						vecCases.push({ Primary: { Mode: "SELECT_FALSE", Target: unTarget }, Cleanup });
					}

					for (const Value of vecValues) {
						for (const strMode of ["CALLBACK_BEFORE", "CALLBACK_AFTER"]) {
							vecCases.push({ Primary: { Mode: strMode, Value }, Cleanup });
						}
					}
				}
			}

			if (!Specification.Direct) {
				for (const Value of vecValues) {
					vecCases.push({ Primary: { Mode: "BEFORE", Value: vecValues[0] }, Cleanup: { Mode: "NONE" }, DirectFailure: { Value } });
				}
			}

			for (const Scenario of vecCases) {
				g_MenuQueue.ClearMenuQueue(1);

				const vecFailures = [];
				const ExampleExports = {};
				const Constructor = ESC[Specification.ConstructorName];
				let CapturedMenu = null;
				let unSendCalls = 0;
				let unQueueCloseCalls = 0;
				let unDirectCloseCalls = 0;
				let unSelectionCalls = 0;
				let unCallbackCalls = 0;

				const ThrowFailure = Value => {
					vecFailures.push(Value);
					throw Value;
				};

				class ControlledMenu extends Constructor {
					constructor(...vecArguments) {
						super(...vecArguments);

						CapturedMenu = this;

						if (Specification.Selection) {
							const Callback = this.SelectCallback;
							g_Assert.equal(typeof Callback, "function");
							this.SelectCallback = (...vecCallbackArguments) => {
								unCallbackCalls++;

								if (Scenario.Primary.Mode === "CALLBACK_BEFORE") {
									ThrowFailure(Scenario.Primary.Value);
								}

								const Result = Callback.apply(this, vecCallbackArguments);

								if (Scenario.Primary.Mode === "CALLBACK_AFTER") {
									ThrowFailure(Scenario.Primary.Value);
								}

								return Result;
							};
						}
					}

					SendMenu(...vecArguments) {
						unSendCalls++;

						if (Scenario.Primary.Mode === "BEFORE") {
							this.PlayerTokenRecords.set(1, {});
							ThrowFailure(Scenario.Primary.Value);
						}

						const bSent = super.SendMenu(...vecArguments);

						if (Scenario.Primary.Mode === "AFTER") {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === "FALSE") ? false : bSent;
					}

					SendMenuToPlayer(...vecArguments) {
						if (!Specification.Direct) {
							return super.SendMenuToPlayer(...vecArguments);
						}

						unSendCalls++;

						if (Scenario.Primary.Mode === "BEFORE") {
							this.PlayerMenuPages.set(1, 0);
							this.PlayerTokenRecords.set(1, {});
							ThrowFailure(Scenario.Primary.Value);
						}

						const bSent = super.SendMenuToPlayer(...vecArguments);

						if (Scenario.Primary.Mode === "AFTER") {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === "FALSE") ? false : bSent;
					}

					SelectMenuOption(...vecArguments) {
						unSelectionCalls++;

						if ((unSelectionCalls === Scenario.Primary.Target) && (Scenario.Primary.Mode === "SELECT_BEFORE")) {
							ThrowFailure(Scenario.Primary.Value);
						}

						const bSelected = super.SelectMenuOption(...vecArguments);

						if ((unSelectionCalls === Scenario.Primary.Target) && (Scenario.Primary.Mode === "SELECT_AFTER")) {
							ThrowFailure(Scenario.Primary.Value);
						}

						return ((unSelectionCalls === Scenario.Primary.Target) && (Scenario.Primary.Mode === "SELECT_FALSE")) ? false : bSelected;
					}

					CloseMenu(...vecArguments) {
						unQueueCloseCalls++;

						const bRemoved = super.CloseMenu(...vecArguments);

						if (Scenario.Cleanup.Mode === "THROW") {
							ThrowFailure(Scenario.Cleanup.Value);
						}

						return (Scenario.Cleanup.Mode === "WRONG") ? undefined : bRemoved;
					}

					CloseMenuForPlayer(...vecArguments) {
						unDirectCloseCalls++;

						const Result = super.CloseMenuForPlayer(...vecArguments);

						if (Scenario.DirectFailure) {
							ThrowFailure(Scenario.DirectFailure.Value);
						}

						if (Specification.Direct && (Scenario.Cleanup.Mode === "THROW")) {
							ThrowFailure(Scenario.Cleanup.Value);
						}

						return (Specification.Direct && (Scenario.Cleanup.Mode === "WRONG")) ? true : Result;
					}
				}

				const RecordedError = new Proxy(Error, {
					construct(Target, vecArguments) {
						const Failure = Reflect.construct(Target, vecArguments);
						vecFailures.push(Failure);

						return Failure;
					},
				});

				const RequireExampleModule = strName => {
					g_Assert.equal(strName, "menus/esc");

					return { ...ESC, [Specification.ConstructorName]: ControlledMenu };
				};

				let bThrown = false;
				let CaughtValue = undefined;

				try {
					try {
						RunDocumentationOperation(() => {
							RunExample(RequireExampleModule, ExampleExports, RecordedError);

							if (!Specification.Direct) {
								if (Scenario.Primary.Mode === "ALREADY_CLOSED") {
									g_Assert.equal(Queue.RemoveMenu(CapturedMenu), true);
								}

								g_Assert.equal(ExampleExports.Unload(), true);
								g_Assert.equal(ExampleExports.Unload(), true);
							}
						}, [], "ESC setup documentation");
					} catch (CaughtError) {
						bThrown = true;
						CaughtValue = CaughtError;
					}

					const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
					g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, "ESC examples must not export the obsolete lowercase lifecycle");

					if (!Specification.Direct) {
						g_Assert.equal(typeof ExampleExports.Unload, "function", "ESC examples must publish canonical cleanup");
					}

					g_Assert.equal(vecActualFailures.length, vecFailures.length, "ESC documentation retains every primary/cleanup failure: " + (CaughtValue?.stack ?? String(CaughtValue)));

					for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
						g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "ESC documentation preserves failure identity and order");
					}

					const bSetupFailure = !["NONE", "ALREADY_CLOSED"].includes(Scenario.Primary.Mode);
					g_Assert.equal(bThrown, bSetupFailure || (Scenario.Cleanup.Mode !== "NONE") || !!Scenario.DirectFailure);
					g_Assert(CapturedMenu);
					g_Assert.equal(unSendCalls, 1);

					let unExpectedQueueCloseCalls = Specification.Direct ? 0 : 1;
					if (!Specification.Direct && !bSetupFailure && (Scenario.Cleanup.Mode === "NONE")) {
						unExpectedQueueCloseCalls = Specification.Selection ? 3 : 2;
					}

					g_Assert.equal(unQueueCloseCalls, unExpectedQueueCloseCalls);
					g_Assert.equal(unDirectCloseCalls, 1, "ESC player-state cleanup is attempted once");
					g_Assert.equal(Queue.HasMenu(CapturedMenu), false, "example removes queue ownership before fixture cleanup");
					g_Assert.equal(CapturedMenu.PlayerMenuPages.size, 0);
					g_Assert.equal(CapturedMenu.PlayerTokenRecords.size, 0);

					if (Specification.Selection) {
						const bFailedSend = ["BEFORE", "AFTER", "FALSE"].includes(Scenario.Primary.Mode);
						let unExpectedSelections = 0;
						if (!bFailedSend) {
							unExpectedSelections = Scenario.Primary.Target ?? 2;
						}

						g_Assert.equal(unSelectionCalls, unExpectedSelections);
						g_Assert.equal(unCallbackCalls, (!bFailedSend && (unExpectedSelections === 2) && (Scenario.Primary.Mode !== "SELECT_BEFORE")) ? 1 : 0);
					}

					unCaseCount++;
				} finally {
					g_MenuQueue.ClearMenuQueue(1);
				}
			}
		}

		g_Assert.equal(unCaseCount, 1402);

		return unCaseCount;
	}

	function CheckESCCommandDocumentation(strExample) {
		const Commands = require(g_ModulePaths["commands/client"]);
		const ESC = require(g_ModulePaths["menus/esc"]);
		const vecValues = [
			new Error("Controlled help-command failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled aggregate value"),
		];
		const vecCases = [
			{ Stage: "UNLOAD", Mode: "NONE" },
			...vecValues.map(Value => ({ Stage: "UNLOAD", Mode: "THROW", Value })),
			{ Stage: "UNLOAD", Mode: "FALSE" },
			{ Stage: "UNLOAD", Mode: "WRONG" },
			...vecValues.map(Value => ({ Stage: "REGISTER", Mode: "THROW", Value })),
			{ Stage: "REGISTER", Mode: "FALSE" },
			{ Stage: "REGISTER", Mode: "WRONG" },
			...vecValues.map(Value => ({ Stage: "CALLBACK", Mode: "THROW", Value })),
			{ Stage: "CALLBACK", Mode: "FALSE" },
		];
		const RunExample = g_VM.compileFunction('"use strict";\n' + strExample, ["require", "exports", "Error"]);
		let unCaseCount = 0;
		for (const Scenario of vecCases) {
			const bHadPreviousCommand = g_mapClientCommands.has("sjs_help");
			const PreviousCallback = g_mapClientCommands.get("sjs_help");
			g_mapClientCommands.delete("sjs_help");

			const vecFailures = [];
			const ExampleExports = {};
			let CapturedCallback = null;
			let bInjectReleaseFailure = true;
			let unReleaseCalls = 0;

			const ThrowFailure = Value => {
				vecFailures.push(Value);
				throw Value;
			};

			const ClientRuntime = {
				...Commands,

				RegisterCommand(strName, Callback) {
					CapturedCallback = Callback;

					if (Scenario.Stage === "REGISTER") {
						if (Scenario.Mode === "THROW") {
							ThrowFailure(Scenario.Value);
						}

						return (Scenario.Mode === "FALSE") ? false : {};
					}

					return Commands.RegisterCommand(strName, Callback);
				},

				UnregisterCommand(strName, Callback) {
					unReleaseCalls++;

					if ((Scenario.Stage === "UNLOAD") && bInjectReleaseFailure && (Scenario.Mode !== "NONE")) {
						if (Scenario.Mode === "THROW") {
							ThrowFailure(Scenario.Value);
						}

						return (Scenario.Mode === "FALSE") ? false : {};
					}

					return Commands.UnregisterCommand(strName, Callback);
				},
			};

			const ESCRuntime = {
				...ESC,

				SendESCMenu(...vecArguments) {
					if (Scenario.Stage === "CALLBACK") {
						if (Scenario.Mode === "THROW") {
							ThrowFailure(Scenario.Value);
						}

						return false;
					}

					return ESC.SendESCMenu(...vecArguments);
				},
			};

			const RecordedError = new Proxy(Error, {
				construct(Target, vecArguments) {
					const Failure = Reflect.construct(Target, vecArguments);
					vecFailures.push(Failure);

					return Failure;
				},
			});

			const RequireExampleModule = strName => {
				if (strName === "commands/client") {
					return ClientRuntime;
				}

				return (strName === "menus/esc") ? ESCRuntime : require(g_ModulePaths[strName]);
			};

			const CheckOperation = (Operation, bExpectedFailure) => {
				const unFailureOffset = vecFailures.length;
				let bThrown = false;
				let CaughtValue = undefined;

				try {
					RunDocumentationOperation(Operation, [], "ESC help-command documentation");
				} catch (CaughtError) {
					bThrown = true;
					CaughtValue = CaughtError;
				}

				g_Assert.equal(bThrown, bExpectedFailure, "ESC command diagnostic: " + (CaughtValue?.stack ?? String(CaughtValue)));
				g_Assert.equal(vecFailures.length - unFailureOffset, bExpectedFailure ? 1 : 0);

				if (bThrown) {
					g_Assert.strictEqual(CaughtValue, vecFailures[unFailureOffset], "help-command documentation preserves failure identity");
				}
			};

			try {
				CheckOperation(() => RunExample(RequireExampleModule, ExampleExports, RecordedError), Scenario.Stage === "REGISTER");
				g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, "ESC command must not export the obsolete lowercase lifecycle");
				g_Assert.equal(typeof ExampleExports.Unload, "function", "ESC command must publish canonical cleanup");

				if (Scenario.Stage !== "REGISTER") {
					g_Assert.strictEqual(g_mapClientCommands.get("sjs_help"), CapturedCallback);
					CheckOperation(() => g_Assert.equal(CapturedCallback({ Index: 1 }), 1), Scenario.Stage === "CALLBACK");
					g_Assert.strictEqual(g_mapClientCommands.get("sjs_help"), CapturedCallback, "callback failure does not silently release its command");

					const bReleaseFailure = (Scenario.Stage === "UNLOAD") && (Scenario.Mode !== "NONE");
					CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), bReleaseFailure);

					if (bReleaseFailure) {
						g_Assert.strictEqual(g_mapClientCommands.get("sjs_help"), CapturedCallback, "failed release retains ownership for an explicit retry");
						bInjectReleaseFailure = false;
						CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), false);
					}
				}

				CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), false);
				CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), false);
				g_Assert.equal(g_mapClientCommands.has("sjs_help"), false);

				let unExpectedReleases = 1;
				if (Scenario.Stage === "REGISTER") {
					unExpectedReleases = 0;

				} else if ((Scenario.Stage === "UNLOAD") && (Scenario.Mode !== "NONE")) {
					unExpectedReleases = 2;
				}

				g_Assert.equal(unReleaseCalls, unExpectedReleases);
				unCaseCount++;
			} finally {
				g_mapClientCommands.delete("sjs_help");

				if (bHadPreviousCommand) {
					g_mapClientCommands.set("sjs_help", PreviousCallback);
				}
			}
		}

		g_Assert.equal(unCaseCount, 24);

		return unCaseCount;
	}

	function CheckESCErrorDocumentation(strExample) {
		const unOperationCount = 7;
		const ESC = require(g_ModulePaths["menus/esc"]);
		const ForeignTypeError = g_VM.runInNewContext('new TypeError("Controlled foreign-realm error");');
		const vecValues = [
			undefined,
			null,
			0,
			"",
			{},
			new Error("Controlled unexpected error type"),
			ForeignTypeError,
		];
		const vecCases = [{ Mode: "NONE" }];
		for (let unTarget = 0; unTarget < unOperationCount; unTarget++) {
			for (const Value of vecValues) {
				vecCases.push({ Mode: "THROW", Target: unTarget, Value });
			}

			vecCases.push({ Mode: "MISSING", Target: unTarget });
		}

		const RunExample = g_VM.compileFunction('"use strict";\n' + strExample, ["require", "Error"]);
		let unCaseCount = 0;
		for (const Scenario of vecCases) {
			const vecFailures = [];
			let unOperationCalls = 0;

			const RunControlledOperation = Operation => {
				const unIndex = unOperationCalls++;
				if (unIndex === Scenario.Target) {
					if (Scenario.Mode === "THROW") {
						vecFailures.push(Scenario.Value);
						throw Scenario.Value;
					}

					return {};
				}

				return Operation();
			};

			const Runtime = { ...ESC };
			for (const strName of ["ListESCOption", "SimpleESCMenu", "PagedESCMenu", "SimpleESCOption"]) {
				Runtime[strName] = new Proxy(ESC[strName], {
					construct(Target, vecArguments, NewTarget) {
						return RunControlledOperation(() => Reflect.construct(Target, vecArguments, NewTarget));
					},
				});
			}

			Runtime.SendESCMenu = (...vecArguments) => RunControlledOperation(() => ESC.SendESCMenu(...vecArguments));

			const RecordedError = new Proxy(Error, {
				construct(Target, vecArguments) {
					const Failure = Reflect.construct(Target, vecArguments);
					vecFailures.push(Failure);

					return Failure;
				},
			});

			const RequireExampleModule = strName => {
				g_Assert.equal(strName, "menus/esc");

				return Runtime;
			};

			let bThrown = false;
			let CaughtValue = undefined;

			try {
				RunDocumentationOperation(() => RunExample(RequireExampleModule, RecordedError), [], "ESC error documentation");
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			g_Assert.equal(bThrown, Scenario.Mode !== "NONE", "ESC invalid-call diagnostic: " + (CaughtValue?.stack ?? String(CaughtValue)));
			g_Assert.equal(vecFailures.length, bThrown ? 1 : 0);

			if (bThrown) {
				g_Assert.strictEqual(CaughtValue, vecFailures[0], "ESC error documentation preserves unexpected thrown values");
			}

			g_Assert.equal(unOperationCalls, (Scenario.Mode === "NONE") ? unOperationCount : (Scenario.Target + 1));
			unCaseCount++;
		}

		g_Assert.equal(unCaseCount, 57);

		return unCaseCount;
	}

	function CheckMenuOptionSnapshotDocumentation(strDocumentation) {
		const Menus = require(g_ModulePaths.menus);
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const vecValues = [
			new Error("Controlled option snapshot failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled aggregate value"),
		];
		const vecSpecifications = [
			{ Index: 1, ConstructorName: "BaseMenu" },
			{ Index: 3, ConstructorName: "PagedMenu", Paged: true },
		];
		let unCaseCount = 0;
		for (const Specification of vecSpecifications) {
			const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[Specification.Index], ["require", "Error"]);
			const vecCases = [
				...["NONE", "ALIAS", "CLONE", "ITEMS", "MUTATION"].map(strMode => ({ Mode: strMode })),
				...vecValues.map(Value => ({ Mode: "THROW", Value })),
				...(Specification.Paged ? [{ Mode: "WRONG_PAGE" }, { Mode: "WRONG_CHOICE" }] : []),
			];
			for (const Scenario of vecCases) {
				const vecFailures = [];
				const unTextSendsBefore = g_vecShownTextMenus.length;
				const unESCSendsBefore = g_vecShownESCMenus.length;
				const Constructor = Menus[Specification.ConstructorName];
				let CapturedMenu = null;
				let vecCachedOptions = null;
				let unRenderCalls = 0;
				let unOptionCalls = 0;

				class ControlledMenu extends Constructor {
					constructor(...vecArguments) {
						super(...vecArguments);

						CapturedMenu = this;
					}

					GetMenuRenderData(...vecArguments) {
						unRenderCalls++;

						const Data = super.GetMenuRenderData(...vecArguments);

						if (Scenario.Mode === "WRONG_PAGE") {
							this.PlayerMenuPages.set(1, 0);
						}

						if (Scenario.Mode === "WRONG_CHOICE") {
							this.Items[2].ChoiceIndex = 0;
						}

						return Data;
					}

					GetMenuOptions(...vecArguments) {
						unOptionCalls++;

						const vecOptions = super.GetMenuOptions(...vecArguments);

						if (Scenario.Mode === "THROW") {
							vecFailures.push(Scenario.Value);
							throw Scenario.Value;
						}

						if (Scenario.Mode === "ALIAS") {
							if (vecCachedOptions === null) {
								vecCachedOptions = vecOptions;
							}

							return vecCachedOptions;
						}

						if (Scenario.Mode === "CLONE") {
							return vecOptions.map(Option => ({ ...Option }));
						}

						if (Scenario.Mode === "ITEMS") {
							return this.Items;
						}

						if (Scenario.Mode === "MUTATION") {
							const Menu = this;

							return new Proxy(vecOptions, {
								set(vecTarget, PropertyKey, Value, vecReceiver) {
									if (PropertyKey === "length") {
										Menu.Items.length = Value;
									}

									return Reflect.set(vecTarget, PropertyKey, Value, vecReceiver);
								},
							});
						}

						return vecOptions;
					}
				}

				const RecordedError = new Proxy(Error, {
					construct(Target, vecArguments) {
						const Failure = Reflect.construct(Target, vecArguments);
						vecFailures.push(Failure);

						return Failure;
					},
				});

				const RequireExampleModule = strName => {
					g_Assert.equal(strName, "menus");

					return { ...Menus, [Specification.ConstructorName]: ControlledMenu };
				};

				let bThrown = false;
				let CaughtValue = undefined;

				try {
					RunDocumentationOperation(() => RunExample(RequireExampleModule, RecordedError), [], "Menu option snapshot documentation");
				} catch (CaughtError) {
					bThrown = true;
					CaughtValue = CaughtError;
				}

				g_Assert.equal(bThrown, Scenario.Mode !== "NONE", "Menu snapshot diagnostic: " + (CaughtValue?.stack ?? String(CaughtValue)));
				g_Assert.equal(vecFailures.length, bThrown ? 1 : 0);

				if (bThrown) {
					g_Assert.strictEqual(CaughtValue, vecFailures[0], "snapshot examples preserve unexpected failures");
				}

				const unExpectedOptionCalls = (Scenario.Mode === "THROW") ? 1 : 2;
				g_Assert.equal(unOptionCalls, (Scenario.Mode === "NONE") ? 3 : unExpectedOptionCalls);
				g_Assert.equal(unRenderCalls, 1);
				g_Assert(CapturedMenu);
				g_Assert.equal(CapturedMenu.PlayerTokenRecords.size, 0, "rendering does not store send tokens");
				g_Assert.equal(g_MenuQueue.GetPlayerMenuQueue(1).HasMenu(CapturedMenu), false, "rendering does not acquire queue ownership");
				g_Assert.equal(g_vecShownTextMenus.length, unTextSendsBefore);
				g_Assert.equal(g_vecShownESCMenus.length, unESCSendsBefore);
				unCaseCount++;
			}
		}

		g_Assert.equal(unCaseCount, 24);

		return unCaseCount;
	}

	function CheckMenuQueueRemoveFailureContract() {
		const Menus = require(g_ModulePaths.menus);
		const Runtime = globalThis.sourcejs.menus;
		const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
		const HideText = Runtime.HideText;
		const HideDescriptor = Object.getOwnPropertyDescriptor(Runtime, "HideText");
		const NextDescriptor = Object.getOwnPropertyDescriptor(Queue, "SendNextMenu");
		const SendNextMenu = Queue.SendNextMenu;
		const vecValues = [
			new Error("Controlled queue close failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled aggregate value"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecCloseModes = [
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "NONE" },
		];
		const vecNextModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
		];
		const vecHideModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
		];
		const vecCases = [];
		for (const Close of vecCloseModes) {
			for (const Next of vecNextModes) {
				for (const Hide of vecHideModes) {
					vecCases.push({ State: "EMPTY", Close, Next, Hide });
				}

				vecCases.push({ State: "NEXT", Close, Next, Hide: { Mode: "NONE" } });
			}

			vecCases.push({ State: "REENTRANT", Close, Next: { Mode: "NONE" }, Hide: { Mode: "NONE" } });
		}

		let unCaseCount = 0;
		for (const Scenario of vecCases) {
			g_MenuQueue.ClearMenuQueue(1);

			const vecFailures = [];
			let unNextCalls = 0;
			let unHideCalls = 0;

			const ThrowFailure = Value => {
				vecFailures.push(Value);
				throw Value;
			};

			const ReplacementMenu = new Menus.SimpleMenu({ Items: [{ ChoiceIndex: 1, Text: "Replacement" }], Title: "Replacement" });
			const ParentMenu = new Menus.SimpleMenu({
				Items: [{ ChoiceIndex: 1, Text: "Parent" }],

				CloseCallback(unPlayerIndex) {
					g_Assert.equal(unPlayerIndex, 1);

					if (Scenario.State === "REENTRANT") {
						g_Assert.equal(Queue.SendMenu(ReplacementMenu), true);
					}

					if (Scenario.Close.Mode === "THROW") {
						ThrowFailure(Scenario.Close.Value);
					}
				},

				Title: "Parent",
			});

			try {
				g_Assert.equal(ParentMenu.SendMenu(1), true);

				if (Scenario.State === "NEXT") {
					g_Assert.equal(ReplacementMenu.SendMenu(1), true);
				}

				const unShowsBeforeRemove = g_vecShownTextMenus.length;
				const unHidesBeforeRemove = g_vecHiddenTextMenus.length;
				Object.defineProperty(Queue, "SendNextMenu", {
					configurable: true,
					writable: true,

					value: function SendControlledNextMenu(...vecArguments) {
						unNextCalls++;

						if (Scenario.Next.Mode === "THROW") {
							ThrowFailure(Scenario.Next.Value);
						}

						return SendNextMenu.apply(this, vecArguments);
					},
				});
				Object.defineProperty(Runtime, "HideText", {
					...HideDescriptor,

					value: function HideControlledMenu(...vecArguments) {
						unHideCalls++;

						const bHidden = HideText.apply(this, vecArguments);

						if (Scenario.Hide.Mode === "THROW") {
							ThrowFailure(Scenario.Hide.Value);
						}

						return (Scenario.Hide.Mode === "FALSE") ? false : bHidden;
					},
				});

				let bThrown = false;
				let CaughtValue = undefined;
				let Result = undefined;

				try {
					Result = RunDocumentationOperation(() => Queue.RemoveMenu(ParentMenu), [], "MenuQueue.RemoveMenu failure contract");
				} catch (CaughtError) {
					bThrown = true;
					CaughtValue = CaughtError;
				}

				const bReplacementActive = (Scenario.State === "REENTRANT") || ((Scenario.State === "NEXT") && (Scenario.Next.Mode === "NONE"));
				const unExpectedNextCalls = (Scenario.State === "REENTRANT") ? 0 : 1;
				const unExpectedHideCalls = bReplacementActive ? 0 : 1;
				g_Assert.equal(unNextCalls, unExpectedNextCalls, "RemoveMenu must attempt the transition after a CloseCallback failure: " + (CaughtValue?.stack ?? String(CaughtValue)));
				g_Assert.equal(unHideCalls, unExpectedHideCalls, "RemoveMenu must hide orphaned text without hiding a replacement owner");
				g_Assert.equal(g_vecHiddenTextMenus.length, unHidesBeforeRemove + unExpectedHideCalls);
				g_Assert.equal(g_vecShownTextMenus.length, unShowsBeforeRemove + (bReplacementActive ? 1 : 0));
				g_Assert.equal(Queue.HasMenu(ParentMenu), false);
				g_Assert.strictEqual(Queue.ActiveMenu, bReplacementActive ? ReplacementMenu : null);
				g_Assert.equal(ParentMenu.PlayerMenuPages.size, 0);
				g_Assert.equal(ParentMenu.PlayerTokenRecords.size, 0);

				const bExpectedFailure = (Scenario.Close.Mode === "THROW") || ((unExpectedNextCalls !== 0) && (Scenario.Next.Mode === "THROW")) || ((unExpectedHideCalls !== 0) && (Scenario.Hide.Mode === "THROW"));
				g_Assert.equal(bThrown, bExpectedFailure);

				if (!bThrown) {
					g_Assert.equal(Result, true, "native hide false does not change the successful queue-removal result");
				}

				const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
				g_Assert.equal(vecActualFailures.length, vecFailures.length, "RemoveMenu retains every close/transition/hide failure");

				for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
					g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "RemoveMenu preserves failure identity and order");
				}

				unCaseCount++;
			} finally {
				RestoreProperty(Runtime, "HideText", HideDescriptor);
				RestoreProperty(Queue, "SendNextMenu", NextDescriptor);
				ParentMenu.CloseCallback = null;
				g_MenuQueue.ClearMenuQueue(1);
			}
		}

		g_Assert.equal(unCaseCount, 448);

		return unCaseCount;
	}

	function CheckMenuLifecycleDocumentation(strDocumentation) {
		const Menus = require(g_ModulePaths.menus);
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const vecValues = [
			new Error("Controlled menu documentation failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled aggregate value"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecPrimaryModes = [
			{ Mode: "NONE" },
			...vecValues.flatMap(Value => [
				{ Mode: "BEFORE", Value },
				{ Mode: "AFTER", Value },
			]),
			{ Mode: "FALSE" },
		];
		const vecCloseModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "WRONG" },
		];
		const vecHideModes = [
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
			{ Mode: "WRONG" },
		];
		const vecSpecifications = [
			{ Index: 11, ConstructorName: "SimpleMenu" },
			{ Index: 12, ConstructorName: "BaseMenu", Raw: true },
			{ Index: 16, ConstructorName: "SimpleMenu" },
			{ Index: 18, ConstructorName: "SimpleMenu", Refresh: true },
			{ Index: 19, ConstructorName: "BaseMenu", Raw: true, Build: true },
			{ Index: 27, ConstructorName: "BaseMenu", Raw: true },
			{ Index: 31, ConstructorName: "PagedMenu", Raw: true },
			{ Index: 33, ConstructorName: "PagedMenu", Navigation: true },
		];
		let unCaseCount = 0;
		for (const Specification of vecSpecifications) {
			const vecPrimary = [...vecPrimaryModes];
			if (Specification.Refresh) {
				vecPrimary.push(...vecValues.flatMap(Value => [
					{ Mode: "REFRESH_BEFORE", Value },
					{ Mode: "REFRESH_AFTER", Value },
				]), { Mode: "REFRESH_FALSE" });
			}

			if (Specification.Build) {
				vecPrimary.push(...vecValues.flatMap(Value => [
					{ Mode: "BUILD_BEFORE", Value },
					{ Mode: "BUILD_AFTER", Value },
				]));
			}

			if (Specification.Navigation) {
				for (const strPhase of ["NAVIGATION", "SELECTION"]) {
					vecPrimary.push(...vecValues.flatMap(Value => [
						{ Mode: strPhase + "_BEFORE", Value },
						{ Mode: strPhase + "_AFTER", Value },
					]), { Mode: strPhase + "_FALSE" });
				}
			}

			const vecCases = [];
			for (const Primary of vecPrimary) {
				for (const Close of vecCloseModes) {
					vecCases.push({ Primary, Close, Hide: { Mode: "NONE" } });
				}

				if (Specification.Raw) {
					for (const Hide of vecHideModes) {
						vecCases.push({ Primary, Close: { Mode: "NONE" }, Hide });
					}
				}
			}

			if (Specification.Raw) {
				for (const CloseValue of vecValues) {
					for (const HideValue of vecValues) {
						vecCases.push({ Primary: { Mode: "BEFORE", Value: undefined }, Close: { Mode: "THROW", Value: CloseValue }, Hide: { Mode: "THROW", Value: HideValue } });
					}
				}
			}

			const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[Specification.Index], ["require", "Error"]);
			for (const Scenario of vecCases) {
				g_MenuQueue.ClearMenuQueue(1);

				const vecFailures = [];
				const Constructor = Menus[Specification.ConstructorName];
				let CapturedMenu = null;
				let unSendCalls = 0;
				let unQueueCloseCalls = 0;
				let unStateCloseCalls = 0;
				let unHideCalls = 0;
				let unRefreshCalls = 0;
				let unBuildCalls = 0;
				let unSelectCalls = 0;

				const ThrowFailure = Value => {
					vecFailures.push(Value);
					throw Value;
				};

				class ControlledMenu extends Constructor {
					constructor(...vecArguments) {
						super(...vecArguments);

						CapturedMenu = this;
					}

					SendMenu(...vecArguments) {
						unSendCalls++;

						if (Scenario.Primary.Mode === "BEFORE") {
							this.PlayerTokenRecords.set(1, {});
							ThrowFailure(Scenario.Primary.Value);
						}

						const bSent = super.SendMenu(...vecArguments);

						if (Scenario.Primary.Mode === "AFTER") {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === "FALSE") ? false : bSent;
					}

					SendMenuToPlayer(...vecArguments) {
						if (!Specification.Raw) {
							return super.SendMenuToPlayer(...vecArguments);
						}

						unSendCalls++;

						if (Scenario.Primary.Mode === "BEFORE") {
							this.PlayerMenuPages.set(1, 0);
							this.PlayerTokenRecords.set(1, {});
							ThrowFailure(Scenario.Primary.Value);
						}

						const bSent = super.SendMenuToPlayer(...vecArguments);

						if (Scenario.Primary.Mode === "AFTER") {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === "FALSE") ? false : bSent;
					}

					CloseMenu(...vecArguments) {
						unQueueCloseCalls++;

						const bRemoved = super.CloseMenu(...vecArguments);

						if (Scenario.Close.Mode === "THROW") {
							ThrowFailure(Scenario.Close.Value);
						}

						return (Scenario.Close.Mode === "WRONG") ? undefined : bRemoved;
					}

					CloseMenuForPlayer(...vecArguments) {
						unStateCloseCalls++;

						const Result = super.CloseMenuForPlayer(...vecArguments);

						if (Specification.Raw && (Scenario.Close.Mode === "THROW")) {
							ThrowFailure(Scenario.Close.Value);
						}

						return (Specification.Raw && (Scenario.Close.Mode === "WRONG")) ? true : Result;
					}

					RefreshMenu(...vecArguments) {
						unRefreshCalls++;

						if (Scenario.Primary.Mode === "REFRESH_BEFORE") {
							ThrowFailure(Scenario.Primary.Value);
						}

						const bRefreshed = super.RefreshMenu(...vecArguments);

						if (Scenario.Primary.Mode === "REFRESH_AFTER") {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === "REFRESH_FALSE") ? false : bRefreshed;
					}

					SelectMenuOption(...vecArguments) {
						unSelectCalls++;

						const strPhase = (vecArguments[1] === this.NextChoiceIndex) ? "NAVIGATION" : "SELECTION";
						if (Scenario.Primary.Mode === (strPhase + "_BEFORE")) {
							ThrowFailure(Scenario.Primary.Value);
						}

						const bSelectionHandled = super.SelectMenuOption(...vecArguments);

						if (Scenario.Primary.Mode === (strPhase + "_AFTER")) {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === (strPhase + "_FALSE")) ? false : bSelectionHandled;
					}

					RegisterMenuBuildCallback(Callback) {
						const ControlledBuild = function InvokeControlledBuild(...vecArguments) {
							unBuildCalls++;

							if (Scenario.Primary.Mode === "BUILD_BEFORE") {
								ThrowFailure(Scenario.Primary.Value);
							}

							const Result = Callback.apply(this, vecArguments);

							if (Scenario.Primary.Mode === "BUILD_AFTER") {
								ThrowFailure(Scenario.Primary.Value);
							}

							return Result;
						};

						return super.RegisterMenuBuildCallback(ControlledBuild);
					}
				}

				const RecordedError = new Proxy(Error, {
					construct(Target, vecArguments) {
						const Failure = Reflect.construct(Target, vecArguments);
						vecFailures.push(Failure);

						return Failure;
					},
				});

				const RequireExampleModule = strName => {
					if (Specification.Navigation && (strName === "menus/queue")) {
						return g_MenuQueue;
					}

					g_Assert.equal(strName, "menus");

					return {
						...Menus,
						[Specification.ConstructorName]: ControlledMenu,

						HideText(...vecArguments) {
							unHideCalls++;

							const bHidden = Menus.HideText(...vecArguments);

							if (Scenario.Hide.Mode === "THROW") {
								ThrowFailure(Scenario.Hide.Value);
							}

							if (Scenario.Hide.Mode === "FALSE") {
								return false;
							}

							return (Scenario.Hide.Mode === "WRONG") ? {} : bHidden;
						},
					};
				};

				let bThrown = false;
				let CaughtValue = undefined;

				try {
					try {
						RunDocumentationOperation(() => RunExample(RequireExampleModule, RecordedError), [], "Menu lifecycle documentation");
					} catch (CaughtError) {
						bThrown = true;
						CaughtValue = CaughtError;
					}

					const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
					g_Assert.equal(vecActualFailures.length, vecFailures.length, "menu lifecycle documentation retains every failure: " + (CaughtValue?.stack ?? String(CaughtValue)));

					for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
						g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "menu lifecycle documentation preserves failure identity and order");
					}

					g_Assert.equal(bThrown, (Scenario.Primary.Mode !== "NONE") || (Scenario.Close.Mode !== "NONE") || (Scenario.Hide.Mode !== "NONE"));
					g_Assert(CapturedMenu);
					g_Assert.equal(unSendCalls, 1);
					g_Assert.equal(unQueueCloseCalls, Specification.Raw ? 0 : 1, "queued close is attempted once, including after an explicit close failure");
					g_Assert.equal(unStateCloseCalls, 1, "player-state close is not silently retried");
					g_Assert.equal(unHideCalls, Specification.Raw ? 1 : 0, "direct hide remains independent of state cleanup");
					g_Assert.equal(g_MenuQueue.GetPlayerMenuQueue(1).HasMenu(CapturedMenu), false);
					g_Assert.equal(CapturedMenu.PlayerMenuPages.size, 0);
					g_Assert.equal(CapturedMenu.PlayerTokenRecords.size, 0);

					const bFailedSend = ["BEFORE", "AFTER", "FALSE"].includes(Scenario.Primary.Mode);
					g_Assert.equal(unRefreshCalls, (Specification.Refresh && !bFailedSend) ? 1 : 0);
					g_Assert.equal(unBuildCalls, (Specification.Build && (Scenario.Primary.Mode !== "BEFORE")) ? 1 : 0);
					const unExpectedSelectCalls = (!Specification.Navigation || bFailedSend) ? 0 : (Scenario.Primary.Mode.startsWith("NAVIGATION_") ? 1 : 2);
					g_Assert.equal(unSelectCalls, unExpectedSelectCalls);
					unCaseCount++;
				} finally {
					g_MenuQueue.ClearMenuQueue(1);
				}
			}
		}

		g_Assert.equal(unCaseCount, 1992);

		return unCaseCount;
	}

	function CheckMultiTargetMenuDocumentation(strDocumentation) {
		const Menus = require(g_ModulePaths.menus);
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[26], ["require", "Error"]);
		const vecValues = [
			new Error("Controlled multi-target menu failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque aggregate"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecPrimaryModes = [{ Mode: "NONE" }];
		for (const unPlayerIndex of [1, 2]) {
			vecPrimaryModes.push(...vecValues.flatMap(Value => [
				{ Mode: "BEFORE", PlayerIndex: unPlayerIndex, Value },
				{ Mode: "AFTER", PlayerIndex: unPlayerIndex, Value },
			]), { Mode: "FALSE", PlayerIndex: unPlayerIndex });
		}

		const vecCloseModes = [
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "WRONG" },
			{ Mode: "FALSE" },
		];
		const vecCases = [];
		for (const Primary of vecPrimaryModes) {
			vecCases.push({ Primary });

			for (const unPlayerIndex of [1, 2]) {
				for (const Close of vecCloseModes) {
					vecCases.push({ Primary, Closures: { [unPlayerIndex]: Close } });
				}
			}
		}

		for (const FirstValue of vecValues) {
			for (const SecondValue of vecValues) {
				vecCases.push({
					Primary: { Mode: "BEFORE", PlayerIndex: 1, Value: undefined },
					Closures: {
						1: { Mode: "THROW", Value: FirstValue },
						2: { Mode: "THROW", Value: SecondValue },
					},
				});
			}
		}

		for (const unPlayerIndex of [1, 2]) {
			vecCases.push({ Primary: { Mode: "NONE" }, BlockedPlayerIndex: unPlayerIndex });
			vecCases.push({ Primary: { Mode: "NONE" }, ReplacementPlayerIndex: unPlayerIndex });
		}

		let unCaseCount = 0;
		for (const Scenario of vecCases) {
			g_MenuQueue.ClearMenuQueue(1);
			g_MenuQueue.ClearMenuQueue(2);

			const vecFailures = [];
			const vecCloseCalls = [];
			const mapStateCloseCounts = new Map();
			let CapturedMenu = null;
			let OtherMenu = null;

			const ThrowFailure = Value => {
				vecFailures.push(Value);
				throw Value;
			};

			class ControlledMenu extends Menus.SimpleMenu {
				constructor(...vecArguments) {
					super(...vecArguments);

					CapturedMenu = this;

					if (Scenario.ReplacementPlayerIndex !== undefined) {
						this.RegisterMenuCloseCallback(unPlayerIndex => {
							if (unPlayerIndex === Scenario.ReplacementPlayerIndex) {
								OtherMenu = new Menus.SimpleMenu({ Title: "Reentrant replacement" });
								g_Assert.equal(OtherMenu.SendMenu(unPlayerIndex), true);
							}
						});
					}
				}

				SendMenuToPlayer(unPlayerIndex, ...vecArguments) {
					if ((Scenario.Primary.PlayerIndex === unPlayerIndex) && (Scenario.Primary.Mode === "BEFORE")) {
						this.PlayerMenuPages.set(unPlayerIndex, 0);
						ThrowFailure(Scenario.Primary.Value);
					}

					const bSent = super.SendMenuToPlayer(unPlayerIndex, ...vecArguments);

					if ((Scenario.Primary.PlayerIndex === unPlayerIndex) && (Scenario.Primary.Mode === "AFTER")) {
						ThrowFailure(Scenario.Primary.Value);
					}

					return ((Scenario.Primary.PlayerIndex === unPlayerIndex) && (Scenario.Primary.Mode === "FALSE")) ? false : bSent;
				}

				CloseMenu(unPlayerIndex) {
					vecCloseCalls.push(unPlayerIndex);

					const bRemoved = super.CloseMenu(unPlayerIndex);
					const Close = Scenario.Closures?.[unPlayerIndex];
					if (Close?.Mode === "THROW") {
						ThrowFailure(Close.Value);
					}

					if (Close?.Mode === "WRONG") {
						return undefined;
					}

					return (Close?.Mode === "FALSE") ? false : bRemoved;
				}

				CloseMenuForPlayer(unPlayerIndex) {
					mapStateCloseCounts.set(unPlayerIndex, (mapStateCloseCounts.get(unPlayerIndex) ?? 0) + 1);

					return super.CloseMenuForPlayer(unPlayerIndex);
				}
			}

			const RecordedError = new Proxy(Error, {
				construct(Target, vecArguments) {
					const Failure = Reflect.construct(Target, vecArguments);
					vecFailures.push(Failure);

					return Failure;
				},
			});

			const RequireExampleModule = strName => {
				if (strName === "menus/queue") {
					return g_MenuQueue;
				}

				g_Assert.equal(strName, "menus");

				return { ...Menus, SimpleMenu: ControlledMenu };
			};

			let bThrown = false;
			let CaughtValue = undefined;

			try {
				if (Scenario.BlockedPlayerIndex !== undefined) {
					OtherMenu = new Menus.SimpleMenu({ Title: "Existing owner" });
					g_Assert.equal(OtherMenu.SendMenu(Scenario.BlockedPlayerIndex), true);
				}

				const unHiddenBefore = g_vecHiddenTextMenus.length;
				try {
					RunDocumentationOperation(() => RunExample(RequireExampleModule, RecordedError), [], "Multi-target menu documentation");
				} catch (CaughtError) {
					bThrown = true;
					CaughtValue = CaughtError;
				}

				const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
				g_Assert.equal(vecActualFailures.length, vecFailures.length, "multi-target documentation retains all failure values: " + (CaughtValue?.stack ?? String(CaughtValue)));

				for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
					g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "multi-target documentation preserves failure identity and order");
				}

				const bExpectedFailure = (Scenario.Primary.Mode !== "NONE") || (Scenario.Closures !== undefined) || (Scenario.BlockedPlayerIndex !== undefined);
				g_Assert.equal(bThrown, bExpectedFailure);
				g_Assert.deepEqual(vecCloseCalls, [1, 2], "every requested player is cleaned up independently");
				g_Assert(CapturedMenu);

				for (const unPlayerIndex of [1, 2]) {
					g_Assert.equal(g_MenuQueue.GetPlayerMenuQueue(unPlayerIndex).HasMenu(CapturedMenu), false, "both active and pending ownership are removed");
					g_Assert((mapStateCloseCounts.get(unPlayerIndex) ?? 0) <= 1, "no duplicate close callback or silent retry");
				}

				g_Assert.equal(CapturedMenu.PlayerMenuPages.size, 0);
				g_Assert.equal(CapturedMenu.PlayerTokenRecords.size, 0);

				if (OtherMenu !== null) {
					const unOtherPlayerIndex = Scenario.BlockedPlayerIndex ?? Scenario.ReplacementPlayerIndex;
					g_Assert.strictEqual(g_MenuQueue.GetPlayerMenuQueue(unOtherPlayerIndex).ActiveMenu, OtherMenu);
					g_Assert.equal(g_vecHiddenTextMenus.slice(unHiddenBefore).includes(unOtherPlayerIndex), false, "cleanup does not hide a different active owner");
				}

				unCaseCount++;
			} finally {
				g_MenuQueue.ClearMenuQueue(1);
				g_MenuQueue.ClearMenuQueue(2);
			}
		}

		g_Assert.equal(unCaseCount, 499);

		return unCaseCount;
	}

	function CheckMenuQueueClearFailureContract() {
		const Menus = require(g_ModulePaths.menus);
		const Runtime = globalThis.sourcejs.menus;
		const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
		const HideText = Runtime.HideText;
		const HideDescriptor = Object.getOwnPropertyDescriptor(Runtime, "HideText");
		const vecValues = [
			new Error("Controlled clear callback failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque clear failure"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecCloseModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
		];
		const vecHideModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
			{ Mode: "WRONG" },
		];
		const vecCases = vecHideModes.map(Hide => ({ State: "IDLE", Close: { Mode: "NONE" }, Hide }));
		for (const strState of ["ACTIVE", "REENTRANT"]) {
			for (const Close of vecCloseModes) {
				for (const Hide of vecHideModes) {
					vecCases.push({ State: strState, Close, Hide });
				}
			}
		}

		let unCaseCount = 0;
		for (const Scenario of vecCases) {
			g_MenuQueue.ClearMenuQueue(1);

			const vecFailures = [];
			const ReplacementMenu = new Menus.SimpleMenu({ Title: "New active owner" });
			const NewPendingMenu = new Menus.SimpleMenu({ Title: "New pending owner" });
			const OldPendingMenu = new Menus.SimpleMenu({ Title: "Old pending entry" });
			let unCloseCalls = 0;
			let unHideCalls = 0;

			const ThrowFailure = Value => {
				vecFailures.push(Value);
				throw Value;
			};

			const ParentMenu = new Menus.SimpleMenu({
				CloseCallback(unPlayerIndex) {
					unCloseCalls++;
					g_Assert.equal(unPlayerIndex, 1);

					if (Scenario.State === "REENTRANT") {
						g_Assert.equal(Queue.AppendMenu(ReplacementMenu), true);
						g_Assert.equal(Queue.AppendMenu(NewPendingMenu), true);
					}

					if (Scenario.Close.Mode === "THROW") {
						ThrowFailure(Scenario.Close.Value);
					}
				},

				Title: "Released owner",
			});

			try {
				if (Scenario.State !== "IDLE") {
					g_Assert.equal(Queue.AppendMenu(ParentMenu), true);
					g_Assert.equal(Queue.AppendMenu(OldPendingMenu), true);
				}

				Object.defineProperty(Runtime, "HideText", {
					...HideDescriptor,

					value: function HideControlledQueue(...vecArguments) {
						unHideCalls++;

						const bHidden = HideText.apply(this, vecArguments);

						if (Scenario.Hide.Mode === "THROW") {
							ThrowFailure(Scenario.Hide.Value);
						}

						if (Scenario.Hide.Mode === "WRONG") {
							return undefined;
						}

						return (Scenario.Hide.Mode === "FALSE") ? false : bHidden;
					},
				});

				let bThrown = false;
				let CaughtValue = undefined;

				try {
					const Result = RunDocumentationOperation(() => Queue.ClearMenuQueue(), [], "MenuQueue.ClearMenuQueue failure contract");
					g_Assert.equal(Result, undefined, "clear preserves its void result, including native hide false");
				} catch (CaughtError) {
					bThrown = true;
					CaughtValue = CaughtError;
				}

				const bReplacementActive = Scenario.State === "REENTRANT";
				const unExpectedHideCalls = (Scenario.State === "ACTIVE") ? 1 : 0;
				g_Assert.equal(unHideCalls, unExpectedHideCalls, "ClearMenuQueue must attempt hiding after a CloseCallback failure without hiding a new owner: " + (CaughtValue?.stack ?? String(CaughtValue)));
				g_Assert.equal(unCloseCalls, (Scenario.State === "IDLE") ? 0 : 1);
				g_Assert.equal(Queue.HasMenu(ParentMenu), false);
				g_Assert.equal(Queue.HasMenu(OldPendingMenu), false);
				g_Assert.strictEqual(Queue.ActiveMenu, bReplacementActive ? ReplacementMenu : null);
				g_Assert.equal(Queue.Length, bReplacementActive ? 2 : 0);
				g_Assert.equal(ParentMenu.PlayerMenuPages.size, 0);
				g_Assert.equal(ParentMenu.PlayerTokenRecords.size, 0);

				if (bReplacementActive) {
					g_Assert.strictEqual(Queue.PendingMenuEntries[0].Menu, NewPendingMenu);
					g_Assert.strictEqual(Queue.ActivePlayerTokenRecord, ReplacementMenu.PlayerTokenRecords.get(1));

				} else {
					g_Assert.equal(Queue.ActivePageIndex, 0);
					g_Assert.equal(Object.keys(Queue.ActivePlayerTokenRecord).length, 0);
				}

				const bInvalidHide = (unExpectedHideCalls !== 0) && (Scenario.Hide.Mode === "WRONG");
				const bExpectedFailure = (Scenario.Close.Mode === "THROW") || ((unExpectedHideCalls !== 0) && (Scenario.Hide.Mode === "THROW")) || bInvalidHide;
				g_Assert.equal(bThrown, bExpectedFailure, "ClearMenuQueue failure contract: " + (CaughtValue?.stack ?? String(CaughtValue)));

				const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
				if (bInvalidHide) {
					const InvalidHideError = vecActualFailures.pop();
					g_Assert(InvalidHideError instanceof TypeError);
					g_Assert.match(InvalidHideError.message, /menus HideText result/);
				}

				g_Assert.equal(vecActualFailures.length, vecFailures.length, "clear retains every callback/hide error");

				for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
					g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "clear preserves failure identity and order");
				}

				if ((vecFailures.length === 1) && !bInvalidHide) {
					g_Assert.strictEqual(CaughtValue, vecFailures[0], "a sole failure is rethrown unchanged");
				}

				unCaseCount++;
			} finally {
				RestoreProperty(Runtime, "HideText", HideDescriptor);
				ParentMenu.CloseCallback = null;
				g_MenuQueue.ClearMenuQueue(1);
			}
		}

		g_Assert.equal(unCaseCount, 135);

		return unCaseCount;
	}

	function CheckQueueSetupDocumentation(strDocumentation) {
		const Menus = require(g_ModulePaths.menus);
		const Runtime = globalThis.sourcejs.menus;
		const ShowText = Runtime.ShowText;
		const HideText = Runtime.HideText;
		const ShowDescriptor = Object.getOwnPropertyDescriptor(Runtime, "ShowText");
		const HideDescriptor = Object.getOwnPropertyDescriptor(Runtime, "HideText");
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const vecValues = [
			new Error("Controlled queue setup failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque queue error"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecPrimaryModes = [
			{ Mode: "NONE" },
			...vecValues.flatMap(Value => [
				{ Mode: "BEFORE", Value },
				{ Mode: "AFTER", Value },
			]),
			{ Mode: "FALSE" },
		];
		const vecClearModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
			{ Mode: "WRONG" },
		];
		const vecSpecifications = [
			{ Index: 2, ShowIndex: 1 },
			{ Index: 3, ShowIndex: 1 },
			{ Index: 4, ShowIndex: 1 },
			{ Index: 4, ShowIndex: 2 },
			{ Index: 5, ShowIndex: 1 },
			{ Index: 5, ShowIndex: 2 },
			{ Index: 5, ShowIndex: 3 },
			{ Index: 6, ShowIndex: 1 },
			{ Index: 7, ShowIndex: 1 },
			{ Index: 8, ShowIndex: 1 },
			{ Index: 8, ShowIndex: 2, AllowFalseSuccess: true },
			{ Index: 9, ShowIndex: 1 },
			{ Index: 9, ShowIndex: 2, AllowFalseSuccess: true },
		];
		let unCaseCount = 0;
		for (const Specification of vecSpecifications) {
			const vecCases = [];
			for (const Primary of vecPrimaryModes) {
				for (const Clear of vecClearModes) {
					vecCases.push({ Primary, Clear });
				}
			}

			for (const CloseValue of vecValues) {
				for (const HideValue of vecValues) {
					vecCases.push({ Primary: { Mode: "BEFORE", Value: undefined }, Clear: { Mode: "NONE" }, Close: { Value: CloseValue }, Hide: { Value: HideValue } });
				}
			}

			const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[Specification.Index], ["require", "exports", "Error"]);
			for (const Scenario of vecCases) {
				g_MenuQueue.ClearMenuQueue(1);

				const vecFailures = [];
				const vecMenus = [];
				const vecHiddenActiveOwners = [];
				const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
				const ClearMenuQueue = Queue.ClearMenuQueue;
				const ClearDescriptor = Object.getOwnPropertyDescriptor(Queue, "ClearMenuQueue");
				let bCleanupInProgress = false;

				const ExampleExports = new Proxy({}, {
					set(Target, strName, Value) {
						if (strName === "Unload") {
							g_Assert.equal(typeof Value, "function");
							Target[strName] = function InvokeControlledUnload(...vecArguments) {
								const bPreviousCleanupInProgress = bCleanupInProgress;
								bCleanupInProgress = true;

								try {
									return Reflect.apply(Value, this, vecArguments);
								} finally {
									bCleanupInProgress = bPreviousCleanupInProgress;
								}
							};
							return true;
						}

						return Reflect.set(Target, strName, Value);
					},
				});

				let unShowCalls = 0;
				let unHideCalls = 0;
				let unClearCalls = 0;

				const ThrowFailure = Value => {
					vecFailures.push(Value);
					throw Value;
				};

				class CapturedMenu extends Menus.SimpleMenu {
					constructor(...vecArguments) {
						super(...vecArguments);

						vecMenus.push(this);

						if (Scenario.Close !== undefined) {
							this.RegisterMenuCloseCallback(() => {
								if (bCleanupInProgress) {
									ThrowFailure(Scenario.Close.Value);
								}
							});
						}
					}
				}

				const RecordedError = new Proxy(Error, {
					construct(Target, vecArguments) {
						const Failure = Reflect.construct(Target, vecArguments);
						vecFailures.push(Failure);

						return Failure;
					},
				});

				const RequireExampleModule = strName => {
					if (strName === "menus") {
						return { ...Menus, SimpleMenu: CapturedMenu };
					}

					g_Assert.equal(strName, "menus/queue");

					return {
						...g_MenuQueue,

						ClearMenuQueue(...vecArguments) {
							const Result = g_MenuQueue.ClearMenuQueue(...vecArguments);

							// The public void wrapper discards method results; inject its result independently.
							if (bCleanupInProgress && (Scenario.Clear.Mode === "FALSE")) {
								return false;
							}

							return (bCleanupInProgress && (Scenario.Clear.Mode === "WRONG")) ? {} : Result;
						},
					};
				};

				let bThrown = false;
				let CaughtValue = undefined;

				try {
					Object.defineProperty(Queue, "ClearMenuQueue", {
						configurable: true,
						writable: true,

						value: function ClearControlledQueue(...vecArguments) {
							unClearCalls++;

							const Result = ClearMenuQueue.apply(this, vecArguments);

							if (bCleanupInProgress && (Scenario.Clear.Mode === "THROW")) {
								ThrowFailure(Scenario.Clear.Value);
							}

							if (bCleanupInProgress && (Scenario.Clear.Mode === "FALSE")) {
								return false;
							}

							return (bCleanupInProgress && (Scenario.Clear.Mode === "WRONG")) ? {} : Result;
						},
					});
					Object.defineProperty(Runtime, "ShowText", {
						...ShowDescriptor,

						value: function ShowControlledQueue(...vecArguments) {
							unShowCalls++;

							if ((unShowCalls === Specification.ShowIndex) && (Scenario.Primary.Mode === "BEFORE")) {
								ThrowFailure(Scenario.Primary.Value);
							}

							const bShown = ShowText.apply(this, vecArguments);

							if ((unShowCalls === Specification.ShowIndex) && (Scenario.Primary.Mode === "AFTER")) {
								ThrowFailure(Scenario.Primary.Value);
							}

							return ((unShowCalls === Specification.ShowIndex) && (Scenario.Primary.Mode === "FALSE")) ? false : bShown;
						},
					});
					Object.defineProperty(Runtime, "HideText", {
						...HideDescriptor,

						value: function HideControlledQueue(...vecArguments) {
							unHideCalls++;

							if (Queue.ActiveMenu !== null) {
								vecHiddenActiveOwners.push(Queue.ActiveMenu);
							}

							const bHidden = HideText.apply(this, vecArguments);

							if (bCleanupInProgress && (Scenario.Hide !== undefined)) {
								ThrowFailure(Scenario.Hide.Value);
							}

							return bHidden;
						},
					});

					try {
						RunDocumentationOperation(() => {
							RunExample(RequireExampleModule, ExampleExports, RecordedError);
							g_Assert.equal(ExampleExports.Unload(), true);
						}, [], "Queue setup documentation");
					} catch (CaughtError) {
						bThrown = true;
						CaughtValue = CaughtError;
					}

					const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
					g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, "Queue examples must not export the obsolete lowercase lifecycle");
					g_Assert.equal(typeof ExampleExports.Unload, "function", "Queue examples must publish canonical cleanup");
					g_Assert.equal(vecActualFailures.length, vecFailures.length, "queue setup documentation retains every setup/cleanup failure: " + (CaughtValue?.stack ?? String(CaughtValue)));

					for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
						g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "queue setup documentation preserves error identity and order");
					}

					const bFalseCloseSucceeded = (Specification.AllowFalseSuccess === true) && (Scenario.Primary.Mode === "FALSE");
					const bExpectedFailure = ((Scenario.Primary.Mode !== "NONE") && !bFalseCloseSucceeded) || (Scenario.Clear.Mode !== "NONE");
					g_Assert.equal(bThrown, bExpectedFailure, `Queue example ${Specification.Index}, show ${Specification.ShowIndex}, primary ${Scenario.Primary.Mode}, clear ${Scenario.Clear.Mode}: ${CaughtValue?.stack ?? String(CaughtValue)}`);
					g_Assert.equal(unClearCalls, 1, "setup cleanup is not silently retried");
					g_Assert.equal(unHideCalls, 1);
					g_Assert.equal(vecHiddenActiveOwners.length, 0, "setup cleanup never hides an active owner");
					g_Assert(unShowCalls >= Specification.ShowIndex, "requested setup stage reached");
					g_Assert.equal(g_MenuQueue.GetPlayerMenuQueue(1).Length, 0, "queue empty before harness cleanup");

					for (const Menu of vecMenus) {
						g_Assert.equal(Menu.PlayerMenuPages.size, 0);
						g_Assert.equal(Menu.PlayerTokenRecords.size, 0);
					}

					unCaseCount++;
				} finally {
					RestoreProperty(Runtime, "ShowText", ShowDescriptor);
					RestoreProperty(Runtime, "HideText", HideDescriptor);
					RestoreProperty(Queue, "ClearMenuQueue", ClearDescriptor);

					for (const Menu of vecMenus) {
						Menu.CloseCallback = null;
					}

					g_MenuQueue.ClearMenuQueue(1);
				}
			}
		}

		g_Assert.equal(unCaseCount, 2106);

		return unCaseCount;
	}

	function CheckMenuQueueCloseFailureContract() {
		const Menus = require(g_ModulePaths.menus);
		const Runtime = globalThis.sourcejs.menus;
		const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
		const HideText = Runtime.HideText;
		const SendNextMenu = Queue.SendNextMenu;
		const HideDescriptor = Object.getOwnPropertyDescriptor(Runtime, "HideText");
		const NextDescriptor = Object.getOwnPropertyDescriptor(Queue, "SendNextMenu");
		const vecValues = [
			new Error("Controlled active-menu close failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque close error"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecCloseModes = [
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "NONE" },
		];
		const vecNextModes = [
			{ Mode: "NONE" },
			...vecValues.flatMap(Value => [
				{ Mode: "THROW", Value },
				{ Mode: "AFTER", Value },
			]),
			{ Mode: "FALSE" },
		];
		const vecHideModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
		];
		const vecCases = [];
		for (const Close of vecCloseModes) {
			for (const Next of vecNextModes) {
				for (const Hide of vecHideModes) {
					vecCases.push({ State: "EMPTY", Close, Next, Hide });
				}

				vecCases.push({ State: "NEXT", Close, Next, Hide: { Mode: "NONE" } });
			}

			vecCases.push({ State: "REENTRANT", Close, Next: { Mode: "NONE" }, Hide: { Mode: "NONE" } });
			vecCases.push({ State: "REOPEN", Close, Next: { Mode: "NONE" }, Hide: { Mode: "NONE" } });
		}

		let unCaseCount = 0;
		for (const strOperation of ["CloseActiveMenu", "SelectMenuOption"]) {
			for (const Scenario of vecCases) {
				g_MenuQueue.ClearMenuQueue(1);

				const vecFailures = [];
				const ReplacementMenu = new Menus.SimpleMenu({ Title: "Replacement owner" });
				let unNextCalls = 0;
				let unHideCalls = 0;

				const ThrowFailure = Value => {
					vecFailures.push(Value);
					throw Value;
				};

				const ParentMenu = new Menus.SimpleMenu({
					Items: [{ ChoiceIndex: 1, Text: "Ready", Value: true }],

					CloseCallback(unPlayerIndex) {
						g_Assert.equal(unPlayerIndex, 1);

						if ((Scenario.State === "REENTRANT") || (Scenario.State === "REOPEN")) {
							g_Assert.equal(Queue.SendMenu((Scenario.State === "REOPEN") ? ParentMenu : ReplacementMenu), true);
						}

						if (Scenario.Close.Mode === "THROW") {
							ThrowFailure(Scenario.Close.Value);
						}
					},

					Title: "Original owner",
				});

				try {
					g_Assert.equal(Queue.AppendMenu(ParentMenu), true);

					if (Scenario.State === "NEXT") {
						g_Assert.equal(Queue.AppendMenu(ReplacementMenu), true);
					}

					const unShowsBefore = g_vecShownTextMenus.length;
					const unHidesBefore = g_vecHiddenTextMenus.length;
					Object.defineProperty(Queue, "SendNextMenu", {
						configurable: true,
						writable: true,

						value: function SendControlledNextMenu(...vecArguments) {
							unNextCalls++;

							if (Scenario.Next.Mode === "THROW") {
								ThrowFailure(Scenario.Next.Value);
							}

							const bSent = SendNextMenu.apply(this, vecArguments);

							if (Scenario.Next.Mode === "AFTER") {
								ThrowFailure(Scenario.Next.Value);
							}

							return (Scenario.Next.Mode === "FALSE") ? false : bSent;
						},
					});
					Object.defineProperty(Runtime, "HideText", {
						...HideDescriptor,

						value: function HideControlledOwner(...vecArguments) {
							unHideCalls++;

							const bHidden = HideText.apply(this, vecArguments);

							if (Scenario.Hide.Mode === "THROW") {
								ThrowFailure(Scenario.Hide.Value);
							}

							return (Scenario.Hide.Mode === "FALSE") ? false : bHidden;
						},
					});

					let bThrown = false;
					let CaughtValue = undefined;
					let bClosed = false;

					try {
						bClosed = RunDocumentationOperation(() => (strOperation === "CloseActiveMenu") ? Queue.CloseActiveMenu() : Queue.SelectMenuOption(1), [], "Active-menu close failure contract");
					} catch (CaughtError) {
						bThrown = true;
						CaughtValue = CaughtError;
					}

					const bReopened = Scenario.State === "REOPEN";
					const bCallbackOpenedMenu = (Scenario.State === "REENTRANT") || bReopened;
					const bReplacementActive = bCallbackOpenedMenu || ((Scenario.State === "NEXT") && (Scenario.Next.Mode !== "THROW"));
					const unExpectedNextCalls = bCallbackOpenedMenu ? 0 : 1;
					const unExpectedHideCalls = bReplacementActive ? 0 : 1;
					g_Assert.equal(unNextCalls, unExpectedNextCalls, strOperation + " must attempt transition after a close-callback failure: " + (CaughtValue?.stack ?? String(CaughtValue)));
					g_Assert.equal(unHideCalls, unExpectedHideCalls, "close must not hide any new active owner after a failed or throwing transition");
					g_Assert.equal(g_vecShownTextMenus.length, unShowsBefore + (bReplacementActive ? 1 : 0));
					g_Assert.equal(g_vecHiddenTextMenus.length, unHidesBefore + unExpectedHideCalls);
					g_Assert.equal(Queue.HasMenu(ParentMenu), bReopened);

					const ExpectedOwner = bReopened ? ParentMenu : (bReplacementActive ? ReplacementMenu : null);
					g_Assert.strictEqual(Queue.ActiveMenu, ExpectedOwner);
					g_Assert.equal(ParentMenu.PlayerMenuPages.size, bReopened ? 1 : 0);
					g_Assert.equal(ParentMenu.PlayerTokenRecords.size, bReopened ? 1 : 0);

					const bNextFailure = (unExpectedNextCalls !== 0) && ["THROW", "AFTER"].includes(Scenario.Next.Mode);
					const bExpectedFailure = (Scenario.Close.Mode === "THROW") || bNextFailure || ((unExpectedHideCalls !== 0) && (Scenario.Hide.Mode === "THROW"));
					g_Assert.equal(bThrown, bExpectedFailure, "active-menu failure status: " + (CaughtValue?.stack ?? String(CaughtValue)));

					if (!bThrown) {
						g_Assert.equal(bClosed, true, "close/selection result does not certify next-send or hide success");
					}

					const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
					g_Assert.equal(vecActualFailures.length, vecFailures.length, "close retains every phase failure");

					for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
						g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "close preserves error identity and order");
					}

					unCaseCount++;
				} finally {
					RestoreProperty(Runtime, "HideText", HideDescriptor);
					RestoreProperty(Queue, "SendNextMenu", NextDescriptor);
					ParentMenu.CloseCallback = null;
					g_MenuQueue.ClearMenuQueue(1);
				}
			}
		}

		g_Assert.equal(unCaseCount, 1792);

		return unCaseCount;
	}

	function CheckQueueErrorDocumentation(strDocumentation) {
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[11] + "\nreturn g_MinimalMenu;", ["require"]);
		const unShowsBefore = g_vecShownTextMenus.length;
		const unHidesBefore = g_vecHiddenTextMenus.length;
		RunDocumentationOperation(() => {
			const MinimalMenu = RunExample(strName => {
				g_Assert.equal(strName, "menus/queue");

				return g_MenuQueue;
			});
			g_Assert.equal(MinimalMenu.CloseMenuForPlayer(), undefined, "the structural menu fixture preserves the void close contract");
			g_Assert.equal(MinimalMenu.SelectMenuOption(), true);
			g_Assert.equal(MinimalMenu.SendMenuToPlayer(), true);
			g_Assert.equal(MinimalMenu.ShouldCloseMenuAfterSelection(), true);
		}, [], "Queue error documentation");
		g_Assert.equal(g_vecShownTextMenus.length, unShowsBefore, "invalid-call examples do not reach native display");
		g_Assert.equal(g_vecHiddenTextMenus.length, unHidesBefore, "invalid-call examples do not need native cleanup");

		return true;
	}

	function CheckRadioCloseFailureContract() {
		const { ShowMenu } = require(g_Path.join(g_strPackageRootPath, "messages.js"));
		const SendDescriptor = Object.getOwnPropertyDescriptor(ShowMenu.prototype, "SendUserMessage");
		const SendUserMessage = ShowMenu.prototype.SendUserMessage;
		const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
		const vecValues = [
			new Error("Controlled radio close failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque radio failure"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecHideModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
			{ Mode: "WRONG" },
		];
		const vecCallbackModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
		];
		const vecCases = [];
		for (const strProfile of ["EMPTY", "RAW", "QUEUED"]) {
			for (const Hide of vecHideModes) {
				for (const Callback of vecCallbackModes) {
					for (const strReplacement of ["NONE", "OTHER", "SELF"]) {
						vecCases.push({ Profile: strProfile, Hide, Callback, Replacement: strReplacement });
					}
				}

				vecCases.push({ Profile: strProfile, Hide, Callback: { Mode: "ABSENT" }, Replacement: "NONE" });
			}
		}

		let unCaseCount = 0;
		for (const strMenuName of ["SimpleRadioMenu", "PagedRadioMenu", "ListRadioMenu"]) {
			for (const strSDKBranch of ["sdk2013", "csgo"]) {
				for (const Scenario of vecCases) {
					Queue.ClearMenuQueue();

					const MenuConstructor = g_Radio[strMenuName];
					const ReplacementMenu = new MenuConstructor({ SDKBranch: strSDKBranch, Title: "Replacement" });
					const vecEvents = [];
					const vecFailures = [];
					let ParentMenu = null;

					const ThrowFailure = Value => {
						vecFailures.push(Value);
						throw Value;
					};

					const CloseCallback = (Scenario.Callback.Mode === "ABSENT") ? null : function CloseControlledRadio(unPlayerIndex, Menu) {
						vecEvents.push("CALLBACK");
						g_Assert.strictEqual(this, ParentMenu);
						g_Assert.strictEqual(Menu, ParentMenu);
						g_Assert.equal(unPlayerIndex, 1);

						if (Scenario.Replacement !== "NONE") {
							const NewMenu = (Scenario.Replacement === "SELF") ? ParentMenu : ReplacementMenu;
							const bShown = (Scenario.Profile === "QUEUED") ? NewMenu.SendMenu(1) : NewMenu.SendMenuToPlayer(1);
							g_Assert.equal(bShown, true);
						}

						if (Scenario.Callback.Mode === "THROW") {
							ThrowFailure(Scenario.Callback.Value);
						}
					};

					ParentMenu = new MenuConstructor({ CloseCallback, SDKBranch: strSDKBranch, Title: "Released" });

					try {
						if (Scenario.Profile !== "EMPTY") {
							const bShown = (Scenario.Profile === "QUEUED") ? ParentMenu.SendMenu(1) : ParentMenu.SendMenuToPlayer(1);
							g_Assert.equal(bShown, true);
						}

						const unMessagesBefore = g_vecShownRadioMenus.length;
						Object.defineProperty(ShowMenu.prototype, "SendUserMessage", {
							...SendDescriptor,

							value: function SendControlledRadio(...vecArguments) {
								const bHide = this.m_MessageFields.ValidSlots === 0;
								vecEvents.push(bHide ? "HIDE" : "SHOW");
								const bSent = SendUserMessage.apply(this, vecArguments);

								if (bHide && (Scenario.Hide.Mode === "THROW")) {
									ThrowFailure(Scenario.Hide.Value);
								}

								if (bHide && (Scenario.Hide.Mode === "WRONG")) {
									return undefined;
								}

								return (bHide && (Scenario.Hide.Mode === "FALSE")) ? false : bSent;
							},
						});

						let bThrown = false;
						let CaughtValue = undefined;
						let Result = undefined;

						try {
							Result = RunDocumentationOperation(() => (Scenario.Profile === "QUEUED") ? ParentMenu.CloseMenu(1) : ParentMenu.CloseMenuForPlayer(1), [], "Radio close failure contract");
						} catch (CaughtError) {
							bThrown = true;
							CaughtValue = CaughtError;
						}

						const bDisplayed = Scenario.Profile !== "EMPTY";
						const bCallback = Scenario.Callback.Mode !== "ABSENT";
						const bReplacement = bCallback && (Scenario.Replacement !== "NONE");
						const bSelfReopened = bReplacement && (Scenario.Replacement === "SELF");
						const vecExpectedEvents = [];
						if (bDisplayed) {
							vecExpectedEvents.push("HIDE");
						}

						if (bCallback) {
							vecExpectedEvents.push("CALLBACK");
						}

						if (bReplacement) {
							vecExpectedEvents.push("SHOW");
						}

						g_Assert.deepEqual(vecEvents, vecExpectedEvents, "radio close must attempt callback after hide failure and never hide its replacement: " + (CaughtValue?.stack ?? String(CaughtValue)));
						g_Assert.equal(g_vecShownRadioMenus.length, unMessagesBefore + (bDisplayed ? 1 : 0) + (bReplacement ? 1 : 0));
						g_Assert.equal(ParentMenu.PlayerMenuPages.size, bSelfReopened ? 1 : 0);
						g_Assert.equal(ParentMenu.PlayerTokenRecords.size, bSelfReopened ? 1 : 0);

						const ExpectedOwner = (Scenario.Profile !== "QUEUED") ? null : (bSelfReopened ? ParentMenu : (bReplacement ? ReplacementMenu : null));
						g_Assert.strictEqual(Queue.ActiveMenu, ExpectedOwner);

						const bInvalidHide = bDisplayed && (Scenario.Hide.Mode === "WRONG");
						const bExpectedFailure = (bDisplayed && (Scenario.Hide.Mode === "THROW")) || bInvalidHide || (Scenario.Callback.Mode === "THROW");
						g_Assert.equal(bThrown, bExpectedFailure, "radio close failure status: " + (CaughtValue?.stack ?? String(CaughtValue)));

						if (!bThrown) {
							g_Assert.equal(Result, (Scenario.Profile === "QUEUED") ? true : undefined, "native hide false does not change the close contract");
						}

						const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
						if (bInvalidHide) {
							const InvalidHideError = vecActualFailures.shift();
							g_Assert(InvalidHideError instanceof TypeError);
							g_Assert.match(InvalidHideError.message, /ShowMenu.SendUserMessage result/);
						}

						g_Assert.equal(vecActualFailures.length, vecFailures.length, "radio close retains all hide/callback failures");

						for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
							g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "radio close preserves failure identity and order");
						}

						if ((vecFailures.length === 1) && !bInvalidHide) {
							g_Assert.strictEqual(CaughtValue, vecFailures[0], "a sole radio close failure is rethrown unchanged");
						}

						unCaseCount++;
					} finally {
						RestoreProperty(ShowMenu.prototype, "SendUserMessage", SendDescriptor);
						ParentMenu.RegisterMenuCloseCallback(null);
						Queue.ClearMenuQueue();

						for (const Menu of [ParentMenu, ReplacementMenu]) {
							if (Menu.PlayerMenuPages.has(1) || Menu.PlayerTokenRecords.has(1)) {
								g_Assert.equal(Menu.CloseMenuForPlayer(1), undefined);
							}
						}
					}
				}
			}
		}

		g_Assert.equal(unCaseCount, 3564);

		return unCaseCount;
	}

	function CheckRadioSetupDocumentation(strDocumentation) {
		const Globals = require(g_ModulePaths.globals);
		const { ShowMenu } = require(g_Path.join(g_strPackageRootPath, "messages.js"));
		const SendDescriptor = Object.getOwnPropertyDescriptor(ShowMenu.prototype, "SendUserMessage");
		const SendUserMessage = ShowMenu.prototype.SendUserMessage;
		const Queue = g_MenuQueue.GetPlayerMenuQueue(1);

		const LoadProfile = strSDKBranch => {
			const GlobalDescriptor = Object.getOwnPropertyDescriptor(Globals, "GetGlobalVariables");
			const CacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_ModulePaths["menus/radio"]);

			try {
				Object.defineProperty(Globals, "GetGlobalVariables", { ...GlobalDescriptor, value: () => ({ SDKBranch: strSDKBranch }) });
				delete require.cache[g_ModulePaths["menus/radio"]];

				return LoadMenuModules().Radio;
			} finally {
				RestoreProperty(Globals, "GetGlobalVariables", GlobalDescriptor);
				RestoreProperty(require.cache, g_ModulePaths["menus/radio"], CacheDescriptor);
			}
		};

		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const vecValues = [
			new Error("Controlled radio setup failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque setup failure"),
		];
		const setInjectedValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecPrimaryModes = [
			{ Mode: "NONE" },
			...vecValues.flatMap(Value => [
				{ Mode: "BEFORE", Value },
				{ Mode: "AFTER", Value },
				{ Mode: "API_BEFORE", Value },
			]),
			{ Mode: "FALSE" },
		];
		const vecCloseModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "WRONG" },
			{ Mode: "FALSE" },
		];
		const vecHideModes = [
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
			{ Mode: "WRONG" },
		];
		const vecCases = [];
		for (const Primary of vecPrimaryModes) {
			for (const Close of vecCloseModes) {
				vecCases.push({ Primary, Close, Hide: { Mode: "NONE" }, Callback: { Mode: "NONE" } });
			}

			for (const Hide of vecHideModes) {
				vecCases.push({ Primary, Close: { Mode: "NONE" }, Hide, Callback: { Mode: "NONE" } });
			}

			for (const Value of vecValues) {
				vecCases.push({ Primary, Close: { Mode: "NONE" }, Hide: { Mode: "NONE" }, Callback: { Mode: "THROW", Value } });
			}
		}

		for (const HideValue of vecValues) {
			for (const CallbackValue of vecValues) {
				vecCases.push({ Primary: { Mode: "BEFORE", Value: undefined }, Close: { Mode: "NONE" }, Hide: { Mode: "THROW", Value: HideValue }, Callback: { Mode: "THROW", Value: CallbackValue } });
			}
		}

		for (const strExtra of ["ALREADY_CLOSED", "FOREIGN", "OTHER", "SELF"]) {
			vecCases.push({ Primary: { Mode: "NONE" }, Close: { Mode: "NONE" }, Hide: { Mode: "NONE" }, Callback: { Mode: "NONE" }, Extra: strExtra });
		}

		let unCaseCount = 0;
		for (const strSDKBranch of ["sdk2013", "csgo"]) {
			const Radio = LoadProfile(strSDKBranch);
			for (const Specification of [
				{ Index: 3, Name: "SimpleRadioMenu" },
				{ Index: 4, Name: "PagedRadioMenu" },
				{ Index: 5, Name: "ListRadioMenu" },
			]) {
				const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[Specification.Index], ["require", "exports", "Error"]);
				for (const Scenario of vecCases) {
					Queue.ClearMenuQueue();

					const vecFailures = [];
					const ExampleExports = {};
					const MenuConstructor = Radio[Specification.Name];
					const OtherMenu = new MenuConstructor({ Title: "Independent owner" });
					let CapturedMenu = null;
					let unQueueCloses = 0;
					let unHideCalls = 0;
					let unCallbackCalls = 0;

					const ThrowFailure = Value => {
						vecFailures.push(Value);
						throw Value;
					};

					class ControlledMenu extends MenuConstructor {
						constructor(...vecArguments) {
							super(...vecArguments);

							CapturedMenu = this;
							this.RegisterMenuCloseCallback(() => {
								unCallbackCalls++;

								if ((Scenario.Extra === "OTHER") || (Scenario.Extra === "SELF")) {
									const Menu = (Scenario.Extra === "SELF") ? this : OtherMenu;
									g_Assert.equal(Menu.SendMenu(1), true);
								}

								if (Scenario.Callback.Mode === "THROW") {
									ThrowFailure(Scenario.Callback.Value);
								}
							});
						}

						SendMenu(...vecArguments) {
							if (Scenario.Primary.Mode === "API_BEFORE") {
								this.PlayerTokenRecords.set(1, {});
								ThrowFailure(Scenario.Primary.Value);
							}

							return super.SendMenu(...vecArguments);
						}

						CloseMenu(...vecArguments) {
							unQueueCloses++;

							const bClosed = super.CloseMenu(...vecArguments);

							if (Scenario.Close.Mode === "THROW") {
								ThrowFailure(Scenario.Close.Value);
							}

							if (Scenario.Close.Mode === "WRONG") {
								return undefined;
							}

							return (Scenario.Close.Mode === "FALSE") ? false : bClosed;
						}
					}

					const RecordedError = new Proxy(Error, {
						construct(Target, vecArguments) {
							const Failure = Reflect.construct(Target, vecArguments);
							vecFailures.push(Failure);

							return Failure;
						},
					});

					const RequireExample = strName => {
						if (strName === "menus/radio") {
							return { ...Radio, [Specification.Name]: ControlledMenu };
						}

						g_Assert.equal(strName, "menus/queue");

						return g_MenuQueue;
					};

					let bThrown = false;
					let CaughtValue = undefined;

					try {
						if (Scenario.Extra === "FOREIGN") {
							g_Assert.equal(OtherMenu.SendMenu(1), true);
						}

						Object.defineProperty(ShowMenu.prototype, "SendUserMessage", {
							...SendDescriptor,

							value: function SendControlledRadio(...vecArguments) {
								const bHide = this.m_MessageFields.ValidSlots === 0;
								if (bHide) {
									unHideCalls++;

								} else if (Scenario.Primary.Mode === "BEFORE") {
									ThrowFailure(Scenario.Primary.Value);
								}

								const bSent = SendUserMessage.apply(this, vecArguments);

								if (bHide && (Scenario.Hide.Mode === "THROW")) {
									ThrowFailure(Scenario.Hide.Value);
								}

								if (bHide && (Scenario.Hide.Mode === "WRONG")) {
									return undefined;
								}

								if (!bHide && (Scenario.Primary.Mode === "AFTER")) {
									ThrowFailure(Scenario.Primary.Value);
								}

								return ((bHide && (Scenario.Hide.Mode === "FALSE")) || (!bHide && (Scenario.Primary.Mode === "FALSE"))) ? false : bSent;
							},
						});

						try {
							RunDocumentationOperation(() => {
								RunExample(RequireExample, ExampleExports, RecordedError);

								if (Scenario.Extra === "ALREADY_CLOSED") {
									g_Assert.equal(CapturedMenu.CloseMenu(1), true);
									unQueueCloses = 0;
									unHideCalls = 0;
									unCallbackCalls = 0;
								}

								g_Assert.equal(ExampleExports.Unload(), true);
							}, [], "Radio setup documentation");
						} catch (CaughtError) {
							bThrown = true;
							CaughtValue = CaughtError;
						}

						g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, "Radio setup documentation must not export the obsolete lowercase lifecycle.");
						g_Assert.equal(typeof ExampleExports.Unload, "function", "Radio setup documentation must publish canonical cleanup.");

						const bNoRememberedPage = (Scenario.Primary.Mode === "API_BEFORE") || (Scenario.Extra === "FOREIGN") || (Scenario.Extra === "ALREADY_CLOSED");
						const bInvalidHide = !bNoRememberedPage && (Scenario.Hide.Mode === "WRONG");
						const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
						if (bInvalidHide) {
							const InvalidHideError = vecActualFailures.pop();
							g_Assert(InvalidHideError instanceof TypeError);
							g_Assert.match(InvalidHideError.message, /ShowMenu.SendUserMessage result/);
						}

						g_Assert.equal(vecActualFailures.length, vecFailures.length, "radio setup retains every failure: " + (CaughtValue?.stack ?? String(CaughtValue)));

						for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
							g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "radio setup preserves failure identity and order");
						}

						if ((vecFailures.length === 1) && !bInvalidHide) {
							g_Assert.strictEqual(CaughtValue, vecFailures[0], "a sole radio setup/cleanup failure is rethrown unchanged");
						}

						const bExpectedFailure = (Scenario.Primary.Mode !== "NONE") || (Scenario.Close.Mode !== "NONE") || ((Scenario.Hide.Mode === "THROW") && !bNoRememberedPage) || bInvalidHide || (Scenario.Callback.Mode === "THROW") || ["FOREIGN", "SELF"].includes(Scenario.Extra);
						g_Assert.equal(bThrown, bExpectedFailure, "radio setup failure status: " + (CaughtValue?.stack ?? String(CaughtValue)));
						g_Assert.equal(unQueueCloses, 1, "radio unload does not silently retry queued close");
						g_Assert.equal(unHideCalls, bNoRememberedPage ? 0 : 1);
						g_Assert.equal(unCallbackCalls, (Scenario.Extra === "ALREADY_CLOSED") ? 0 : 1, "radio unload does not duplicate a close callback");

						const bSelfReopened = Scenario.Extra === "SELF";
						g_Assert.equal(Queue.HasMenu(CapturedMenu), bSelfReopened);
						g_Assert.equal(CapturedMenu.PlayerMenuPages.size, bSelfReopened ? 1 : 0);
						g_Assert.equal(CapturedMenu.PlayerTokenRecords.size, bSelfReopened ? 1 : 0);

						const ExpectedOwner = bSelfReopened ? CapturedMenu : (["FOREIGN", "OTHER"].includes(Scenario.Extra) ? OtherMenu : null);
						g_Assert.strictEqual(Queue.ActiveMenu, ExpectedOwner);

						if (ExpectedOwner !== null) {
							g_Assert(g_vecShownRadioMenus.at(-1).ValidSlots > 0, "cleanup leaves the independent or reopened owner visible");
						}

						unCaseCount++;
					} finally {
						RestoreProperty(ShowMenu.prototype, "SendUserMessage", SendDescriptor);

						if (CapturedMenu !== null) {
							CapturedMenu.RegisterMenuCloseCallback(null);
						}

						Queue.ClearMenuQueue();

						for (const Menu of [CapturedMenu, OtherMenu]) {
							if ((Menu !== null) && (Menu.PlayerMenuPages.has(1) || Menu.PlayerTokenRecords.has(1))) {
								g_Assert.equal(Menu.CloseMenuForPlayer(1), undefined);
							}
						}
					}
				}
			}
		}

		g_Assert.equal(unCaseCount, 3000);

		return unCaseCount;
	}

	function CheckRadioDirectAndNavigationDocumentation(strDocumentation) {
		const Radio = require(g_ModulePaths["menus/radio"]);
		const { ShowMenu } = require(g_Path.join(g_strPackageRootPath, "messages.js"));
		const SendDescriptor = Object.getOwnPropertyDescriptor(ShowMenu.prototype, "SendUserMessage");
		const SendUserMessage = ShowMenu.prototype.SendUserMessage;
		const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const vecValues = [
			new Error("Controlled direct radio failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque radio failure"),
		];
		const setValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		let unCaseCount = 0;
		for (const Specification of [
			{ Index: 9, Name: "SimpleRadioMenu" },
			{ Index: 10, Name: "PagedRadioMenu" },
			{ Index: 11, Name: "PagedRadioMenu", Navigation: true },
		]) {
			const vecPrimaryModes = [
				{ Mode: "NONE" },
				...vecValues.flatMap(Value => [
					{ Mode: "BEFORE", Value },
					{ Mode: "AFTER", Value },
				]),
				{ Mode: "FALSE" },
			];
			if (Specification.Navigation) {
				for (const strPhase of ["NAVIGATION", "SELECTION"]) {
					vecPrimaryModes.push(...vecValues.flatMap(Value => [
						{ Mode: strPhase + "_BEFORE", Value },
						{ Mode: strPhase + "_AFTER", Value },
					]), { Mode: strPhase + "_FALSE" });
				}
			}

			const vecCases = [];
			for (const Primary of vecPrimaryModes) {
				for (const Close of [
					{ Mode: "NONE" },
					...vecValues.map(Value => ({ Mode: "THROW", Value })),
					{ Mode: "WRONG" },
					{ Mode: "FALSE" },
				]) {
					vecCases.push({ Primary, Close, Hide: { Mode: "NONE" }, Callback: { Mode: "NONE" } });
				}

				for (const Hide of [
					...vecValues.map(Value => ({ Mode: "THROW", Value })),
					{ Mode: "FALSE" },
					{ Mode: "WRONG" },
				]) {
					vecCases.push({ Primary, Close: { Mode: "NONE" }, Hide, Callback: { Mode: "NONE" } });
				}

				for (const Value of vecValues) {
					vecCases.push({ Primary, Close: { Mode: "NONE" }, Hide: { Mode: "NONE" }, Callback: { Mode: "THROW", Value } });
				}
			}

			for (const HideValue of vecValues) {
				for (const CallbackValue of vecValues) {
					vecCases.push({ Primary: { Mode: "BEFORE", Value: undefined }, Close: { Mode: "NONE" }, Hide: { Mode: "THROW", Value: HideValue }, Callback: { Mode: "THROW", Value: CallbackValue } });
				}
			}

			const Constructor = Radio[Specification.Name];
			const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[Specification.Index], ["require", "Error"]);
			for (const Scenario of vecCases) {
				Queue.ClearMenuQueue();

				const vecFailures = [];
				let CapturedMenu = null;
				let unQueueCloses = 0;
				let unStateCloses = 0;
				let unHideCalls = 0;
				let unCallbackCalls = 0;

				const ThrowFailure = Value => {
					vecFailures.push(Value);
					throw Value;
				};

				class ControlledMenu extends Constructor {
					constructor(...vecArguments) {
						super(...vecArguments);

						CapturedMenu = this;
						this.RegisterMenuCloseCallback(() => {
							unCallbackCalls++;

							if (Scenario.Callback.Mode === "THROW") {
								ThrowFailure(Scenario.Callback.Value);
							}
						});
					}

					SendMenuToPlayer(...vecArguments) {
						if (Scenario.Primary.Mode === "BEFORE") {
							this.PlayerMenuPages.set(1, 0);
							this.PlayerTokenRecords.set(1, {});
							ThrowFailure(Scenario.Primary.Value);
						}

						const bSent = super.SendMenuToPlayer(...vecArguments);

						if (Scenario.Primary.Mode === "AFTER") {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === "FALSE") ? false : bSent;
					}

					SelectMenuOption(...vecArguments) {
						const strPhase = (vecArguments[1] === this.RadioProfile.ButtonNext) ? "NAVIGATION" : "SELECTION";
						if (Scenario.Primary.Mode === (strPhase + "_BEFORE")) {
							ThrowFailure(Scenario.Primary.Value);
						}

						const bSelected = super.SelectMenuOption(...vecArguments);

						if (Scenario.Primary.Mode === (strPhase + "_AFTER")) {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === (strPhase + "_FALSE")) ? false : bSelected;
					}

					CloseMenu(...vecArguments) {
						unQueueCloses++;

						const bClosed = super.CloseMenu(...vecArguments);

						if (Scenario.Close.Mode === "THROW") {
							ThrowFailure(Scenario.Close.Value);
						}

						return (Scenario.Close.Mode === "WRONG") ? undefined : ((Scenario.Close.Mode === "FALSE") ? false : bClosed);
					}

					CloseMenuForPlayer(...vecArguments) {
						unStateCloses++;

						const Result = super.CloseMenuForPlayer(...vecArguments);

						if (!Specification.Navigation && (Scenario.Close.Mode === "THROW")) {
							ThrowFailure(Scenario.Close.Value);
						}

						return (!Specification.Navigation && (Scenario.Close.Mode !== "NONE")) ? false : Result;
					}
				}

				const RecordedError = new Proxy(Error, {
					construct(Target, vecArguments) {
						const Failure = Reflect.construct(Target, vecArguments);
						vecFailures.push(Failure);

						return Failure;
					},
				});

				const RequireExample = strName => {
					if (strName === "menus/queue") {
						return g_MenuQueue;
					}

					g_Assert.equal(strName, "menus/radio");

					return { ...Radio, [Specification.Name]: ControlledMenu };
				};

				try {
					Object.defineProperty(ShowMenu.prototype, "SendUserMessage", {
						...SendDescriptor,

						value: function SendControlledDirect(...vecArguments) {
							const bHide = this.m_MessageFields.ValidSlots === 0;
							const bSent = SendUserMessage.apply(this, vecArguments);

							if (bHide) {
								unHideCalls++;

								if (Scenario.Hide.Mode === "THROW") {
									ThrowFailure(Scenario.Hide.Value);
								}

								if (Scenario.Hide.Mode === "WRONG") {
									return undefined;
								}
							}

							return (bHide && (Scenario.Hide.Mode === "FALSE")) ? false : bSent;
						},
					});

					let bThrown = false;
					let CaughtValue = undefined;

					try {
						RunDocumentationOperation(() => RunExample(RequireExample, RecordedError), [], "Direct/navigation radio documentation");
					} catch (CaughtError) {
						bThrown = true;
						CaughtValue = CaughtError;
					}

					const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
					const bInvalidHide = Scenario.Hide.Mode === "WRONG";
					if (bInvalidHide) {
						const InvalidHideError = vecActualFailures.pop();
						g_Assert(InvalidHideError instanceof TypeError);
						g_Assert.match(InvalidHideError.message, /ShowMenu.SendUserMessage result/);
					}

					g_Assert.equal(vecActualFailures.length, vecFailures.length, "direct/navigation radio retains every error: " + (CaughtValue?.stack ?? String(CaughtValue)));

					for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
						g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], "direct/navigation radio preserves error identity/order");
					}

					g_Assert.equal(bThrown, (vecFailures.length > 0) || bInvalidHide);

					if ((vecFailures.length === 1) && !bInvalidHide) {
						g_Assert.strictEqual(CaughtValue, vecFailures[0]);
					}

					g_Assert.equal(unQueueCloses, Specification.Navigation ? 1 : 0);
					g_Assert.equal(unStateCloses, 1, "direct/navigation close is never silently retried");
					g_Assert.equal(unHideCalls, 1);
					g_Assert.equal(unCallbackCalls, 1);
					g_Assert.equal(Queue.HasMenu(CapturedMenu), false);
					g_Assert.equal(CapturedMenu.PlayerMenuPages.size, 0);
					g_Assert.equal(CapturedMenu.PlayerTokenRecords.size, 0);
					unCaseCount++;
				} finally {
					RestoreProperty(ShowMenu.prototype, "SendUserMessage", SendDescriptor);

					if (CapturedMenu !== null) {
						CapturedMenu.RegisterMenuCloseCallback(null);
					}

					Queue.ClearMenuQueue();
				}
			}
		}

		g_Assert.equal(unCaseCount, 1672);

		return unCaseCount;
	}

	function CheckRadioCommandDocumentation(strDocumentation) {
		const Commands = require(g_ModulePaths["commands/client"]);
		const Radio = require(g_ModulePaths["menus/radio"]);
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[12], ["require", "exports", "Error"]);
		const vecValues = [
			new Error("Controlled ready-vote failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque ready-vote failure"),
		];
		const setValues = new Set(vecValues);
		const CollectFailureLeaves = Value => (!setValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
		const vecReleaseModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
			{ Mode: "WRONG" },
		];
		const vecClearModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "WRONG" },
		];
		const vecCases = [];
		for (const Release of vecReleaseModes) {
			for (const First of vecClearModes) {
				for (const Second of vecClearModes) {
					vecCases.push({ Phase: "UNLOAD", Release, First, Second });
				}
			}
		}

		for (const Register of vecReleaseModes.slice(1)) {
			vecCases.push({ Phase: "REGISTER", Register });
		}

		for (const Primary of [
			...vecValues.flatMap(Value => [
				{ Mode: "BEFORE", Value },
				{ Mode: "AFTER", Value },
			]),
			{ Mode: "FALSE" },
		]) {
			for (const First of vecClearModes) {
				vecCases.push({ Phase: "SEND", Primary, First });
			}
		}

		let unCaseCount = 0;
		for (const Scenario of vecCases) {
			const bHadCommand = g_mapClientCommands.has("sjs_ready_vote");
			const PreviousCallback = g_mapClientCommands.get("sjs_ready_vote");
			g_mapClientCommands.delete("sjs_ready_vote");
			g_MenuQueue.ClearMenuQueue(1);
			g_MenuQueue.ClearMenuQueue(2);

			const vecFailures = [];
			const vecClearCalls = [];
			const ExampleExports = {};
			let CapturedCallback = null;
			let bInjectFailures = true;
			let unReleaseCalls = 0;

			const ThrowFailure = Value => {
				vecFailures.push(Value);
				throw Value;
			};

			const RecordedError = new Proxy(Error, {
				construct(Target, vecArguments) {
					const Failure = Reflect.construct(Target, vecArguments);
					vecFailures.push(Failure);

					return Failure;
				},
			});

			const ClientRuntime = {
				...Commands,

				RegisterCommand(strName, Callback) {
					CapturedCallback = Callback;

					if (Scenario.Phase === "REGISTER") {
						if (Scenario.Register.Mode === "THROW") {
							ThrowFailure(Scenario.Register.Value);
						}

						return (Scenario.Register.Mode === "FALSE") ? false : {};
					}

					return Commands.RegisterCommand(strName, Callback);
				},

				UnregisterCommand(strName, Callback) {
					unReleaseCalls++;

					if (bInjectFailures && (Scenario.Release?.Mode !== "NONE")) {
						if (Scenario.Release?.Mode === "THROW") {
							ThrowFailure(Scenario.Release.Value);
						}

						if (Scenario.Release !== undefined) {
							return (Scenario.Release.Mode === "FALSE") ? false : {};
						}
					}

					return Commands.UnregisterCommand(strName, Callback);
				},
			};

			const QueueRuntime = {
				...g_MenuQueue,

				ClearMenuQueue(unPlayerIndex) {
					vecClearCalls.push(unPlayerIndex);

					const Result = g_MenuQueue.ClearMenuQueue(unPlayerIndex);
					const Mode = (unPlayerIndex === 1) ? Scenario.First : Scenario.Second;
					if (bInjectFailures && (Mode?.Mode === "THROW")) {
						ThrowFailure(Mode.Value);
					}

					return (bInjectFailures && (Mode?.Mode === "WRONG")) ? false : Result;
				},
			};

			const RadioRuntime = {
				...Radio,

				SendRadioMenu(...vecArguments) {
					if (Scenario.Primary?.Mode === "BEFORE") {
						ThrowFailure(Scenario.Primary.Value);
					}

					const bSent = Radio.SendRadioMenu(...vecArguments);

					if (Scenario.Primary?.Mode === "AFTER") {
						ThrowFailure(Scenario.Primary.Value);
					}

					return (Scenario.Primary?.Mode === "FALSE") ? false : bSent;
				},
			};

			const RequireExample = strName => {
				if (strName === "commands/client") {
					return ClientRuntime;
				}

				if (strName === "menus/queue") {
					return QueueRuntime;
				}

				return (strName === "menus/radio") ? RadioRuntime : require(g_ModulePaths[strName]);
			};

			const CheckOperation = (Operation, bExpectedFailure) => {
				const unOffset = vecFailures.length;
				let bThrown = false;
				let CaughtValue = undefined;

				try {
					RunDocumentationOperation(Operation, [], "Radio command documentation");
				} catch (CaughtError) {
					bThrown = true;
					CaughtValue = CaughtError;
				}

				g_Assert.equal(bThrown, bExpectedFailure, "ready-vote failure status: " + (CaughtValue?.stack ?? String(CaughtValue)));

				const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
				const vecExpectedFailures = vecFailures.slice(unOffset);
				g_Assert.equal(vecActualFailures.length, vecExpectedFailures.length, "ready-vote retains every failure");

				for (let unIndex = 0; unIndex < vecExpectedFailures.length; unIndex++) {
					g_Assert.strictEqual(vecActualFailures[unIndex], vecExpectedFailures[unIndex], "ready-vote preserves error identity/order");
				}

				if (vecExpectedFailures.length === 1) {
					g_Assert.strictEqual(CaughtValue, vecExpectedFailures[0]);
				}
			};

			try {
				CheckOperation(() => RunExample(RequireExample, ExampleExports, RecordedError), Scenario.Phase === "REGISTER");
				g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, "Radio command documentation must not export the obsolete lowercase lifecycle.");
				g_Assert.equal(typeof ExampleExports.Unload, "function", "Radio command documentation must retain canonical cleanup.");

				if (Scenario.Phase === "UNLOAD") {
					for (const unPlayerIndex of [1, 2]) {
						CheckOperation(() => g_Assert.equal(CapturedCallback({ Index: unPlayerIndex }), 1), false);

						const Menu = g_MenuQueue.GetPlayerMenuQueue(unPlayerIndex).ActiveMenu;
						g_Assert.equal(Menu.SelectMenuOption(unPlayerIndex, 1), true);
						g_Assert.equal(ExampleExports.GetPlayerSelection(unPlayerIndex), true);
					}

					CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), [Scenario.Release, Scenario.First, Scenario.Second].some(Mode => Mode.Mode !== "NONE"));
					g_Assert.deepEqual(vecClearCalls, [1, 2], "unload attempts both targets after earlier failure");
					g_Assert.equal(g_mapClientCommands.has("sjs_ready_vote"), Scenario.Release.Mode !== "NONE");
					g_Assert.equal(unReleaseCalls, 1);

					for (const unPlayerIndex of [1, 2]) {
						const Mode = (unPlayerIndex === 1) ? Scenario.First : Scenario.Second;
						g_Assert.equal(ExampleExports.GetPlayerSelection(unPlayerIndex), (Mode.Mode === "NONE") ? undefined : true);
					}

				} else if (Scenario.Phase === "SEND") {
					CheckOperation(() => CapturedCallback({ Index: 1 }), true);
					g_Assert.deepEqual(vecClearCalls, [1]);
					g_Assert.strictEqual(g_mapClientCommands.get("sjs_ready_vote"), CapturedCallback);
				}

				const vecExpectedRetries = (Scenario.Phase === "UNLOAD") ? [1, 2].filter(unIndex => ((unIndex === 1) ? Scenario.First : Scenario.Second).Mode !== "NONE") : (((Scenario.Phase === "SEND") && (Scenario.First.Mode !== "NONE")) ? [1] : []);
				const unClearOffset = vecClearCalls.length;
				bInjectFailures = false;

				CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), false);
				g_Assert.deepEqual(vecClearCalls.slice(unClearOffset), vecExpectedRetries, "only failed target releases are retried");

				const unFinalReleaseCalls = unReleaseCalls;
				const unFinalClearCalls = vecClearCalls.length;
				CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), false);
				g_Assert.equal(unReleaseCalls, unFinalReleaseCalls, "successful command release is idempotent");
				g_Assert.equal(vecClearCalls.length, unFinalClearCalls);
				g_Assert.equal(g_mapClientCommands.has("sjs_ready_vote"), false);
				g_Assert.equal(unReleaseCalls, (Scenario.Phase === "REGISTER") ? 0 : (((Scenario.Phase === "UNLOAD") && (Scenario.Release.Mode !== "NONE")) ? 2 : 1));

				for (const unPlayerIndex of [1, 2]) {
					g_Assert.equal(g_MenuQueue.GetPlayerMenuQueue(unPlayerIndex).ActiveMenu, null);
					g_Assert.equal(ExampleExports.GetPlayerSelection(unPlayerIndex), undefined);
				}

				unCaseCount++;
			} finally {
				g_MenuQueue.ClearMenuQueue(1);
				g_MenuQueue.ClearMenuQueue(2);
				g_mapClientCommands.delete("sjs_ready_vote");

				if (bHadCommand) {
					g_mapClientCommands.set("sjs_ready_vote", PreviousCallback);
				}
			}
		}

		g_Assert.equal(unCaseCount, 688);

		return unCaseCount;
	}

	function CheckDirectMenuDocumentationCleanup(strDocumentation) {
		const Menus = require(g_ModulePaths.menus);
		const ShowTextDescriptor = Object.getOwnPropertyDescriptor(Menus, "ShowText");
		const HideTextDescriptor = Object.getOwnPropertyDescriptor(Menus, "HideText");
		const HideText = Menus.HideText;
		const strNormalizedDocumentation = strDocumentation.replace(/\r/g, "");
		const vecCases = [
			{ Heading: "BaseMenu.CloseMenuForPlayer", ConstructorName: "BaseMenu", SendError: "BaseMenu.SendMenuToPlayer() could not show the menu." },
			{ Heading: "BaseMenu.RegisterMenuBuildCallback", ConstructorName: "BaseMenu", SendError: "BaseMenu.SendMenuToPlayer() could not invoke the build callback." },
			{ Heading: "BaseMenu.SendMenuToPlayer", ConstructorName: "BaseMenu", SendError: "BaseMenu.SendMenuToPlayer() could not show the menu." },
			{ Heading: "PagedMenu.GetPlayerTokenRecord", ConstructorName: "PagedMenu", SendError: "PagedMenu.SendMenuToPlayer() could not show the tokenized menu." },
		];
		for (const TestCase of vecCases) {
			const strSectionStart = "### `" + TestCase.Heading + "`\n";
			const vecSections = strNormalizedDocumentation.split(strSectionStart);
			g_Assert.equal(vecSections.length, 2, TestCase.Heading + " must have one documented section");

			const vecExampleMatch = vecSections[1].match(/^\n*\x60\x60\x60js\n([\s\S]*?)\x60\x60\x60/);
			g_Assert.ok(vecExampleMatch, TestCase.Heading + " must have a copyable example");

			for (const strFailureMode of ["FALSE", "THROW", "CLOSETHROW"]) {
				const Constructor = Menus[TestCase.ConstructorName];
				const strScenarioLabel = TestCase.Heading + ":" + strFailureMode;
				let CapturedMenu = null;
				let unShowCount = 0;
				let unHideCount = 0;
				let CaughtError = null;

				class CapturedMenuType extends Constructor {
					constructor(Options = {}) {
						super(Options);

						CapturedMenu = this;

						if (strFailureMode === "CLOSETHROW") {
							this.CloseCallback = () => {
								throw new Error("Injected close failure");
							};
						}
					}
				}

				const RequireExampleModule = (strModuleName) => {
					g_Assert.equal(strModuleName, "menus", strScenarioLabel);

					return { ...Menus, [TestCase.ConstructorName]: CapturedMenuType };
				};

				try {
					Menus.ShowText = () => {
						unShowCount += 1;

						if (strFailureMode === "THROW") {
							throw new Error("Injected transport failure");
						}

						return strFailureMode !== "FALSE";
					};

					Menus.HideText = (unPlayerIndex) => {
						unHideCount += 1;

						return HideText(unPlayerIndex);
					};

					const RunExample = CreateExampleRunner(vecExampleMatch[1], strScenarioLabel);
					RunExample(RequireExampleModule);
				} catch (CaughtExampleError) {
					CaughtError = CaughtExampleError;
				} finally {
					RestoreProperty(Menus, "ShowText", ShowTextDescriptor);
					RestoreProperty(Menus, "HideText", HideTextDescriptor);
				}

				g_Assert.ok(CapturedMenu, strScenarioLabel + ": constructed menu");
				g_Assert.equal(unShowCount, 1, strScenarioLabel + ": native transport reached once");
				g_Assert.equal(unHideCount, 1, strScenarioLabel + ": hide attempted despite send/close failure");
				g_Assert.equal(CapturedMenu.PlayerMenuPages.size, 0, strScenarioLabel + ": page state released");
				g_Assert.equal(CapturedMenu.PlayerTokenRecords.size, 0, strScenarioLabel + ": token state released");
				g_Assert.ok(CaughtError instanceof Error, strScenarioLabel + ": failure propagated");

				const strExpectedError = (strFailureMode === "FALSE") ? TestCase.SendError : ((strFailureMode === "THROW") ? "Injected transport failure" : "Injected close failure");
				g_Assert.equal(CaughtError.message, strExpectedError, strScenarioLabel + ": original failure preserved");
			}
		}
	}

	function CheckQueueDocumentationTransportCleanup(strDocumentation) {
		const Menus = require(g_ModulePaths.menus);
		const Queue = require(g_ModulePaths["menus/queue"]);
		const { HideText, ShowText, SimpleMenu } = Menus;
		const ShowTextDescriptor = Object.getOwnPropertyDescriptor(Menus, "ShowText");
		const HideTextDescriptor = Object.getOwnPropertyDescriptor(Menus, "HideText");
		const strNormalizedDocumentation = strDocumentation.replace(/\r/g, "");
		const vecCases = [
			{ Name: "AppendPrepend", Heading: "### `MenuQueue.AppendMenu` and `MenuQueue.PrependMenu`", ShowIndex: 1, ErrorMessage: "MenuQueue could not prepare the append/prepend example." },
			{ Name: "AppendPrependMany", Heading: "### `MenuQueue.AppendMenus` and `MenuQueue.PrependMenus`", ShowIndex: 1, ErrorMessage: "MenuQueue could not append and prepend the menus." },
			{ Name: "ReplaceInitial", Heading: "### `MenuQueue.ReplaceMenu`", ShowIndex: 1, ErrorMessage: "MenuQueue could not prepare the replace example." },
			{ Name: "ReplaceRefresh", Heading: "### `MenuQueue.ReplaceMenu`", ShowIndex: 2, ErrorMessage: "MenuQueue.ReplaceMenu() did not refresh the active entry with a new player token record." },
			{ Name: "ImmediateInitial", Heading: "### `MenuQueue.SendMenu`, `MenuQueue.RefreshActiveMenu`, and `MenuQueue.SendNextMenu`", ShowIndex: 1, ErrorMessage: "MenuQueue.SendMenu() did not activate the menu with its player token record." },
			{ Name: "ImmediateRefresh", Heading: "### `MenuQueue.SendMenu`, `MenuQueue.RefreshActiveMenu`, and `MenuQueue.SendNextMenu`", ShowIndex: 2, ErrorMessage: "MenuQueue.RefreshActiveMenu() did not reuse the live player token record." },
			{ Name: "ImmediateNext", Heading: "### `MenuQueue.SendMenu`, `MenuQueue.RefreshActiveMenu`, and `MenuQueue.SendNextMenu`", ShowIndex: 3, ErrorMessage: "MenuQueue.SendNextMenu() could not activate the pending menu." },
			{ Name: "SelectionInitial", Heading: "### `MenuQueue.SelectMenuOption`", ShowIndex: 1, ErrorMessage: "MenuQueue.SelectMenuOption() could not dispatch the active choice." },
			{ Name: "MembershipInitial", Heading: "### `MenuQueue.HasMenu` and `MenuQueue.RemoveMenu`", ShowIndex: 1, ErrorMessage: "MenuQueue could not prepare the membership example." },
			{ Name: "ClosingInitial", Heading: "### `MenuQueue.CloseActiveMenu` and `MenuQueue.ClearMenuQueue`", ShowIndex: 1, ErrorMessage: "MenuQueue could not prepare the close example." },
			{ Name: "ClosingAdvance", Heading: "### `MenuQueue.CloseActiveMenu` and `MenuQueue.ClearMenuQueue`", ShowIndex: 2, AllowFalseSuccess: true },
			{ Name: "FreeClosingInitial", Heading: "### `CloseActivePlayerMenu` and `ClearMenuQueue`", ShowIndex: 1, ErrorMessage: "MenuQueue.AppendMenus() could not prepare the free-function example." },
			{ Name: "FreeClosingAdvance", Heading: "### `CloseActivePlayerMenu` and `ClearMenuQueue`", ShowIndex: 2, AllowFalseSuccess: true },
			{ Name: "FalseHideClose", Heading: "### `MenuQueue.CloseActiveMenu` and `MenuQueue.ClearMenuQueue`", ShowIndex: 2, HideFails: true },
			{ Name: "FalseHideFreeClose", Heading: "### `CloseActivePlayerMenu` and `ClearMenuQueue`", ShowIndex: 2, HideFails: true },
		];
		let unScenarioCount = 0;
		for (const TestCase of vecCases) {
			const vecSections = strNormalizedDocumentation.split(TestCase.Heading + "\n");
			g_Assert.equal(vecSections.length, 2, TestCase.Name + ": one documented section");

			const strSection = vecSections[1].split(/\n#{2,3} /)[0];
			const vecExampleMatch = strSection.match(/\x60\x60\x60js\n([\s\S]*?)\x60\x60\x60/);
			g_Assert.ok(vecExampleMatch, TestCase.Name + ": copyable example");

			const vecFailureModes = TestCase.HideFails ? ["SUCCESS"] : ["FALSE", "THROW"];
			for (const strFailureMode of vecFailureModes) {
				Queue.ClearMenuQueue(1);

				const vecCapturedMenus = [];
				const strScenarioLabel = TestCase.Name + ":" + strFailureMode;
				const vecHiddenActiveMenus = [];
				let unShowCount = 0;
				let unHideCount = 0;
				let CaughtError = null;

				class CapturedSimpleMenu extends SimpleMenu {
					constructor(Options = {}) {
						super(Options);

						vecCapturedMenus.push(this);
					}
				}

				const RequireExampleModule = (strModuleName) => {
					if (strModuleName === "menus") {
						return { ...Menus, SimpleMenu: CapturedSimpleMenu };
					}

					g_Assert.equal(strModuleName, "menus/queue", strScenarioLabel);

					return Queue;
				};

				try {
					Menus.ShowText = (...vecArguments) => {
						unShowCount += 1;

						if ((strFailureMode !== "SUCCESS") && (unShowCount === TestCase.ShowIndex)) {
							if (strFailureMode === "THROW") {
								throw new Error("Injected queue transport failure");
							}

							return false;
						}

						return Reflect.apply(ShowText, Menus, vecArguments);
					};

					Menus.HideText = (unPlayerIndex) => {
						unHideCount += 1;

						const ActiveMenu = Queue.GetPlayerMenuQueue(unPlayerIndex).ActiveMenu;
						if (ActiveMenu !== null) {
							vecHiddenActiveMenus.push(ActiveMenu);
						}

						return TestCase.HideFails ? false : HideText(unPlayerIndex);
					};

					const RunExample = CreateExampleRunner(vecExampleMatch[1], strScenarioLabel);
					RunExample(RequireExampleModule, {});
				} catch (CaughtExampleError) {
					CaughtError = CaughtExampleError;
				} finally {
					RestoreProperty(Menus, "ShowText", ShowTextDescriptor);
					RestoreProperty(Menus, "HideText", HideTextDescriptor);
				}

				const PlayerQueue = Queue.GetPlayerMenuQueue(1);
				const bFalseCloseSucceeded = (TestCase.AllowFalseSuccess === true) && (strFailureMode === "FALSE");
				const bCompletedWithoutError = bFalseCloseSucceeded || (strFailureMode === "SUCCESS");
				g_Assert.equal(unShowCount, TestCase.ShowIndex, strScenarioLabel + ": requested transport stage reached");
				g_Assert.equal(unHideCount, 1, strScenarioLabel + ": native hide attempted only during ownerless cleanup");
				g_Assert.equal(vecHiddenActiveMenus.length, 0, strScenarioLabel + ": a failed next send must not cause hiding of an active owner");
				g_Assert.equal(PlayerQueue.Length, 0, strScenarioLabel + ": queue empty before harness cleanup");
				g_Assert.equal(PlayerQueue.ActiveMenu, null, strScenarioLabel + ": active menu released");
				g_Assert.equal(PlayerQueue.ActivePageIndex, 0, strScenarioLabel + ": active page reset");
				g_Assert.equal(Object.keys(PlayerQueue.ActivePlayerTokenRecord).length, 0, strScenarioLabel + ": active tokens released");

				for (const Menu of vecCapturedMenus) {
					g_Assert.equal(Menu.PlayerMenuPages.size, 0, strScenarioLabel + ": page state released");
					g_Assert.equal(Menu.PlayerTokenRecords.size, 0, strScenarioLabel + ": token state released");
				}

				if (bCompletedWithoutError) {
					g_Assert.equal(CaughtError, null, strScenarioLabel + ": next-send/hide false does not change the close result");

				} else {
					g_Assert.ok(CaughtError instanceof Error, strScenarioLabel + ": setup failure propagated");

					const strExpectedError = (strFailureMode === "THROW") ? "Injected queue transport failure" : TestCase.ErrorMessage;
					g_Assert.equal(CaughtError.message, strExpectedError, strScenarioLabel + ": original failure preserved");
				}

				unScenarioCount += 1;
			}
		}

		g_Assert.equal(unScenarioCount, 28, "all documented queue transport scenarios executed");
	}

	const g_strMenuDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "docs", "api", "menus-objects.md"), "utf8");
	const g_setDocumentedObjects = new Set([...g_strMenuDocumentation.matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)].map(([, strName]) => strName));
	for (const strConstructorName of Object.keys(g_MenuObjects)) {
		g_Assert.ok(g_setDocumentedObjects.has(strConstructorName), `Missing menu documentation row for ${strConstructorName}`);
	}

	g_Assert.equal(g_strMenuDocumentation.includes("getText"), false);
	g_Assert.equal(g_strMenuDocumentation.includes("MenuData"), false);
	g_Assert.equal(g_strMenuDocumentation.includes("PagedOption"), false);
	g_Assert.equal(/ShowTextMenu|HideTextMenu|SetPlayerMenuPage/.test(g_strMenuDocumentation), false, "object-menu docs use current exports");
	g_Assert.equal([...g_strMenuDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].length, 39, "every reviewed object-menu example is present");

	function CheckRadioDocumentationTransportCleanup(strDocumentation) {
		const { ShowMenu } = require(g_Path.join(g_strPackageRootPath, "messages.js"));
		const OriginalSendDescriptor = Object.getOwnPropertyDescriptor(ShowMenu.prototype, "SendUserMessage");
		const OriginalSend = ShowMenu.prototype.SendUserMessage;
		const vecCases = [
			{ Heading: "### `SimpleRadioMenu`", MenuName: "SimpleRadioMenu", Name: "simple-setup", ShowIndex: 1, ErrorMessage: "SimpleRadioMenu could not activate its ShowMenu message." },
			{ Heading: "### `PagedRadioMenu`", MenuName: "PagedRadioMenu", Name: "paged-setup", ShowIndex: 1, ErrorMessage: "PagedRadioMenu could not activate its two-page ShowMenu message." },
			{ Heading: "### `ListRadioMenu`", MenuName: "ListRadioMenu", Name: "list-setup", ShowIndex: 1, ErrorMessage: "ListRadioMenu could not activate its status message." },
			{ Heading: "### `SimpleRadioMenu.SendMenuToPlayer`", MenuName: "SimpleRadioMenu", Name: "simple-direct", ShowIndex: 1, ErrorMessage: "SimpleRadioMenu.SendMenuToPlayer() could not send ShowMenu." },
			{ Heading: "### `PagedRadioMenu.SendMenuToPlayer`", MenuName: "PagedRadioMenu", Name: "paged-direct", ShowIndex: 1, ErrorMessage: "PagedRadioMenu.SendMenuToPlayer() could not send ShowMenu." },
			{ Heading: "## Selection", MenuName: "PagedRadioMenu", Name: "navigation-initial", ShowIndex: 1, ErrorMessage: "PagedRadioMenu could not activate the navigation example." },
			{ Heading: "## Selection", MenuName: "PagedRadioMenu", Name: "navigation-next", ShowIndex: 2, ErrorMessage: "PagedRadioMenu.SelectMenuOption() did not advance to the second page." },
			{ Heading: "## `SendRadioMenu`", Name: "ready-vote-command", ShowIndex: 1, Command: true, ErrorMessage: "SendRadioMenu() could not queue the ready vote." },
		];
		let unScenarioCount = 0;
		for (const TestCase of vecCases) {
			const nHeadingStart = strDocumentation.indexOf(TestCase.Heading);
			g_Assert.ok(nHeadingStart >= 0, TestCase.Name + " heading present");

			const nFenceStart = strDocumentation.indexOf(g_strJavaScriptFenceMarker, nHeadingStart + TestCase.Heading.length);
			const nNextHeading = strDocumentation.indexOf("\n##", nHeadingStart + TestCase.Heading.length);
			g_Assert.ok((nFenceStart >= 0) && ((nNextHeading < 0) || (nFenceStart < nNextHeading)), TestCase.Name + " own example present");

			const nFenceEnd = strDocumentation.indexOf("\n```", nFenceStart);
			g_Assert.ok((nFenceEnd > nFenceStart) && ((nNextHeading < 0) || (nFenceEnd < nNextHeading)), TestCase.Name + " own example is closed");

			const strExampleSource = strDocumentation.slice(nFenceStart + g_strJavaScriptFenceMarker.length, nFenceEnd);
			const strScenarioLabel = "radio-cleanup-" + TestCase.Name;
			const RunExample = CreateExampleRunner(strExampleSource, strScenarioLabel);
			const bDirect = TestCase.Name.endsWith("-direct");
			const vecModes = bDirect ? ["FALSE", "THROW", "CLOSETHROW", "CLOSEFALSE"] : ["FALSE", "THROW"];
			for (const strMode of vecModes) {
				const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
				Queue.ClearMenuQueue();

				const vecOwnedMenus = [];
				const ExampleExports = {};
				const bCloseFault = (strMode === "CLOSETHROW") || (strMode === "CLOSEFALSE");
				const strInjectedError = bCloseFault ? "injected radio hide failure" : "injected radio send failure";
				const strExpectedError = ((strMode === "THROW") || (strMode === "CLOSETHROW")) ? strInjectedError : TestCase.ErrorMessage;
				let unShowCount = 0;
				let unHideCount = 0;
				let bFaultArmed = TestCase.Command !== true;
				let bInjected = false;

				const Send = function Send(TargetReferences) {
					const Menu = Queue.ActiveMenu;
					if ((Menu !== null) && !vecOwnedMenus.includes(Menu)) {
						vecOwnedMenus.push(Menu);
					}

					if (!bFaultArmed) {
						return Reflect.apply(OriginalSend, this, [TargetReferences]);
					}

					if (this.m_MessageFields.ValidSlots === 0) {
						unHideCount += 1;

						if (bCloseFault) {
							bInjected = true;

							if (strMode === "CLOSETHROW") {
								throw new Error(strInjectedError);
							}

							return false;
						}

					} else {
						unShowCount += 1;

						if (!bCloseFault && (unShowCount === TestCase.ShowIndex)) {
							bInjected = true;

							if (strMode === "THROW") {
								throw new Error(strInjectedError);
							}

							return false;
						}
					}

					return Reflect.apply(OriginalSend, this, [TargetReferences]);
				};

				const RequireExample = (strModuleName) => {
					if ((strModuleName === "menus/radio") && TestCase.MenuName) {
						const MenuType = g_Radio[TestCase.MenuName];

						return {
							...g_Radio,
							[TestCase.MenuName]: class CapturedRadioMenu extends MenuType {
								constructor(Options) {
									super(Options);

									vecOwnedMenus.push(this);
								}
							},
						};
					}

					g_Assert.ok(Object.hasOwn(g_ModulePaths, strModuleName), "radio example uses a documented dependency");

					return require(g_ModulePaths[strModuleName]);
				};

				try {
					ShowMenu.prototype.SendUserMessage = Send;

					let RunOperation = () => RunExample(RequireExample, ExampleExports);

					if (TestCase.Command === true) {
						RunOperation();
						g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, "Radio transport documentation must not export the obsolete lowercase lifecycle.");
						g_Assert.equal(typeof ExampleExports.Unload, "function", "Radio transport documentation must publish canonical cleanup.");

						const ReadyVoteCommand = g_mapClientCommands.get("sjs_ready_vote");
						g_Assert.equal(typeof ReadyVoteCommand, "function");
						g_Assert.equal(RunDocumentationOperation(ReadyVoteCommand, [{ Index: 1 }], strScenarioLabel), 1);
						g_Assert.equal(RunDocumentationOperation(() => Queue.SelectMenuOption(1), [], strScenarioLabel), true);
						g_Assert.equal(RunDocumentationOperation(() => ExampleExports.GetPlayerSelection(1), [], strScenarioLabel), true, "seed a prior selection to test failure cleanup");
						vecOwnedMenus.length = 0;
						bFaultArmed = true;
						RunOperation = () => RunDocumentationOperation(ReadyVoteCommand, [{ Index: 1 }], strScenarioLabel);
					}

					if (strMode === "CLOSEFALSE") {
						g_Assert.doesNotThrow(RunOperation, "current direct close ignores boolean false");

					} else {
						g_Assert.throws(RunOperation, (CaughtError) => CaughtError.message === strExpectedError, TestCase.Name + "/" + strMode);
					}

					g_Assert.ok(bInjected, "specified radio transport fault reached");
					g_Assert.equal(vecOwnedMenus.length, 1, "one affected menu captured");
					g_Assert.equal(unHideCount, 1, "example attempts one radio hide before harness cleanup");
					g_Assert.equal(Queue.ActiveMenu, null, "example clears active queue before harness cleanup");
					g_Assert.equal(Queue.PendingMenuEntries.length, 0, "example clears pending queue before harness cleanup");
					g_Assert.equal(Queue.ActivePageIndex, 0);
					g_Assert.deepEqual(Queue.ActivePlayerTokenRecord, {});

					for (const Menu of vecOwnedMenus) {
						g_Assert.equal(Menu.PlayerMenuPages.size, 0, "example clears per-menu page state");
						g_Assert.equal(Menu.PlayerTokenRecords.size, 0, "example clears per-menu token state");
					}

					if (TestCase.Command === true) {
						g_Assert.equal(RunDocumentationOperation(() => ExampleExports.GetPlayerSelection(1), [], strScenarioLabel), undefined, "failed vote removes prior local selection");
						g_Assert.equal(RunDocumentationOperation(() => ExampleExports.Unload(), [], strScenarioLabel), true);
						g_Assert.ok(!g_mapClientCommands.has("sjs_ready_vote"), "failed vote can still unload its registered command");
					}

					unScenarioCount += 1;
				} finally {
					RestoreProperty(ShowMenu.prototype, "SendUserMessage", OriginalSendDescriptor);

					try {
						Queue.ClearMenuQueue();
					} finally {
						g_mapClientCommands.delete("sjs_ready_vote");
					}
				}
			}
		}

		g_Assert.equal(unScenarioCount, 20, "all 16 send FALSE/THROW plus 2 hide THROW and 2 hide FALSE scenarios");
	}

	const g_strQueueDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "docs", "api", "menus-queue.md"), "utf8");
	g_Assert.equal([...g_strQueueDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].length, 12, "expected queue example inventory is present");

	function CheckNativeTextTransportDocumentation(strDocumentation) {
		const Menus = require(g_ModulePaths.menus);
		const vecCases = [
			{ Heading: "## `HideText()`", CommandName: "sjs_close_text", ExportName: "HideText", Arguments: [1], ErrorMessage: "HideText failed PlayerIndex=1." },
			{ Heading: "## `ShowText()`", CommandName: "sjs_rules", ExportName: "ShowText", Arguments: [1, "Server rules", "Stay with the team. Do not block saferoom doors.", 12], ErrorMessage: "ShowText failed PlayerIndex=1." },
		];
		let unScenarioCount = 0;
		for (const TestCase of vecCases) {
			const nHeadingStart = strDocumentation.indexOf(TestCase.Heading);
			g_Assert.ok(nHeadingStart >= 0, TestCase.ExportName + " heading present");

			const nFenceStart = strDocumentation.indexOf(g_strJavaScriptFenceMarker, nHeadingStart + TestCase.Heading.length);
			const nNextHeading = strDocumentation.indexOf("\n##", nHeadingStart + TestCase.Heading.length);
			g_Assert.ok((nFenceStart >= 0) && ((nNextHeading < 0) || (nFenceStart < nNextHeading)), TestCase.ExportName + " own example present");

			const nFenceEnd = strDocumentation.indexOf("\n```", nFenceStart);
			g_Assert.ok((nFenceEnd > nFenceStart) && ((nNextHeading < 0) || (nFenceEnd < nNextHeading)), TestCase.ExportName + " own example is closed");

			const strExampleSource = strDocumentation.slice(nFenceStart + g_strJavaScriptFenceMarker.length, nFenceEnd);
			const strScenarioLabel = "native-text-" + TestCase.ExportName;
			const RunExample = CreateExampleRunner(strExampleSource, strScenarioLabel);
			const OriginalOperationDescriptor = Object.getOwnPropertyDescriptor(Menus, TestCase.ExportName);
			const OriginalOperation = Menus[TestCase.ExportName];
			for (const strMode of ["SUCCESS", "FALSE", "THROW", "UNDEFINED", "OBJECT"]) {
				const Queue = g_MenuQueue.GetPlayerMenuQueue(1);
				Queue.ClearMenuQueue();

				const RetainedMenu = new g_MenuObjects.SimpleMenu({ Title: "Retained queue ownership" });
				const TokenRecord = { Preserved: true };

				const vecNativeArguments = [];
				const ExampleExports = {};
				const InjectedError = new Error("injected native text transport failure");
				const vecCommandsBeforeExample = [...g_mapClientCommands.keys()];

				const RequireExample = (strModuleName) => {
					g_Assert.ok(Object.hasOwn(g_ModulePaths, strModuleName), "native-text example uses a documented dependency");

					return require(g_ModulePaths[strModuleName]);
				};

				try {
					g_Assert.equal(RetainedMenu.SendMenu(1, 0, TokenRecord), true);

					Menus[TestCase.ExportName] = function Dispatch(...vecArguments) {
						vecNativeArguments.push(vecArguments);

						if (strMode === "THROW") {
							throw InjectedError;
						}

						if (strMode === "FALSE") {
							return false;
						}

						if (strMode === "UNDEFINED") {
							return undefined;
						}

						if (strMode === "OBJECT") {
							return {};
						}

						return Reflect.apply(OriginalOperation, this, vecArguments);
					};

					RunExample(RequireExample, ExampleExports);
					g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, "Native text documentation must not export the obsolete lowercase lifecycle.");
					g_Assert.equal(typeof ExampleExports.Unload, "function", "Native text documentation must publish canonical cleanup.");

					const CommandCallback = g_mapClientCommands.get(TestCase.CommandName);
					g_Assert.equal(typeof CommandCallback, "function");
					const RunCommand = () => RunDocumentationOperation(CommandCallback, [{ Index: 1 }], strScenarioLabel);

					if (strMode === "SUCCESS") {
						g_Assert.equal(RunCommand(), 1, "documented command returns HANDLED");

					} else {
						g_Assert.throws(RunCommand, (CaughtError) => (strMode === "THROW") ? CaughtError === InjectedError : CaughtError.message === TestCase.ErrorMessage, TestCase.ExportName + "/" + strMode);
					}

					g_Assert.deepEqual(vecNativeArguments, [TestCase.Arguments], "exact native arguments, order, text and lifetime");
					g_Assert.equal(Queue.ActiveMenu, RetainedMenu, "native operation does not clear JavaScript queue ownership");
					g_Assert.equal(Queue.ActivePageIndex, 0);
					g_Assert.equal(Queue.ActivePlayerTokenRecord, TokenRecord);
					g_Assert.equal(Queue.PendingMenuEntries.length, 0);
					g_Assert.equal(RetainedMenu.PlayerTokenRecords.get(1), TokenRecord);
					g_Assert.equal(RunDocumentationOperation(() => ExampleExports.Unload(), [], strScenarioLabel), true);
					g_Assert.deepEqual([...g_mapClientCommands.keys()], vecCommandsBeforeExample, "example unload unregisters its command");
					unScenarioCount += 1;
				} finally {
					RestoreProperty(Menus, TestCase.ExportName, OriginalOperationDescriptor);
					g_mapClientCommands.delete(TestCase.CommandName);
					Queue.ClearMenuQueue();
				}
			}
		}

		g_Assert.equal(unScenarioCount, 10, "both native-text command examples exercise SUCCESS/FALSE/THROW/UNDEFINED/OBJECT");
	}

	function CheckNativeTextCommandLifecycleDocumentation(strDocumentation) {
		const Commands = require(g_ModulePaths["commands/client"]);
		const vecExamples = [...strDocumentation.replace(/\r/g, "").matchAll(/^\x60\x60\x60js\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
		const vecValues = [
			new Error("Controlled native-text command failure"),
			undefined,
			null,
			0,
			"",
			new AggregateError([undefined, 0], "Controlled opaque native-text failure"),
		];
		const vecModes = [
			{ Mode: "NONE" },
			...vecValues.map(Value => ({ Mode: "THROW", Value })),
			{ Mode: "FALSE" },
			{ Mode: "WRONG" },
		];
		let unCaseCount = 0;
		for (const Specification of [
			{ Index: 1, Name: "sjs_close_text" },
			{ Index: 2, Name: "sjs_rules" },
		]) {
			const RunExample = g_VM.compileFunction('"use strict";\n' + vecExamples[Specification.Index], ["require", "exports", "Error"]);
			const vecCases = [
				...vecModes.map(Mode => ({ ...Mode, Phase: "RELEASE" })),
				...vecModes.slice(1).map(Mode => ({ ...Mode, Phase: "REGISTER" })),
			];
			for (const Scenario of vecCases) {
				const bHadCommand = g_mapClientCommands.has(Specification.Name);
				const PreviousCallback = g_mapClientCommands.get(Specification.Name);
				g_mapClientCommands.delete(Specification.Name);

				const vecFailures = [];
				const ExampleExports = {};
				let CapturedCallback = null;
				let bInjectReleaseFailure = true;
				let unReleaseCalls = 0;

				const ThrowFailure = Value => {
					vecFailures.push(Value);
					throw Value;
				};

				const RecordedError = new Proxy(Error, {
					construct(Target, vecArguments) {
						const Failure = Reflect.construct(Target, vecArguments);
						vecFailures.push(Failure);

						return Failure;
					},
				});

				const ClientRuntime = {
					...Commands,

					RegisterCommand(strName, Callback) {
						CapturedCallback = Callback;

						if (Scenario.Phase === "REGISTER") {
							if (Scenario.Mode === "THROW") {
								ThrowFailure(Scenario.Value);
							}

							return (Scenario.Mode === "FALSE") ? false : {};
						}

						return Commands.RegisterCommand(strName, Callback);
					},

					UnregisterCommand(strName, Callback) {
						unReleaseCalls++;

						if (bInjectReleaseFailure && (Scenario.Mode !== "NONE")) {
							if (Scenario.Mode === "THROW") {
								ThrowFailure(Scenario.Value);
							}

							return (Scenario.Mode === "FALSE") ? false : {};
						}

						return Commands.UnregisterCommand(strName, Callback);
					},
				};

				const RequireExample = strName => (strName === "commands/client") ? ClientRuntime : require(g_ModulePaths[strName]);

				const CheckOperation = (Operation, bExpectedFailure) => {
					const unOffset = vecFailures.length;
					let bThrown = false;
					let CaughtValue = undefined;

					try {
						RunDocumentationOperation(Operation, [], "Native text command lifecycle documentation");
					} catch (CaughtError) {
						bThrown = true;
						CaughtValue = CaughtError;
					}

					g_Assert.equal(bThrown, bExpectedFailure, "native-text lifecycle status: " + (CaughtValue?.stack ?? String(CaughtValue)));
					g_Assert.equal(vecFailures.length - unOffset, bExpectedFailure ? 1 : 0);

					if (bThrown) {
						g_Assert.strictEqual(CaughtValue, vecFailures[unOffset], "native-text lifecycle retains exact opaque failure");
					}
				};

				try {
					CheckOperation(() => RunExample(RequireExample, ExampleExports, RecordedError), Scenario.Phase === "REGISTER");
					g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, "Native text lifecycle must not retain the obsolete lowercase export.");
					g_Assert.equal(typeof ExampleExports.Unload, "function", "Native text lifecycle must retain canonical cleanup.");

					if (Scenario.Phase === "RELEASE") {
						g_Assert.strictEqual(g_mapClientCommands.get(Specification.Name), CapturedCallback);
						CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), Scenario.Mode !== "NONE");
						g_Assert.equal(g_mapClientCommands.has(Specification.Name), Scenario.Mode !== "NONE");
					}

					bInjectReleaseFailure = false;

					CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), false);

					const unExpectedReleaseCalls = (Scenario.Phase === "REGISTER") ? 0 : ((Scenario.Mode === "NONE") ? 1 : 2);
					g_Assert.equal(unReleaseCalls, unExpectedReleaseCalls);
					CheckOperation(() => g_Assert.equal(ExampleExports.Unload(), true), false);
					g_Assert.equal(unReleaseCalls, unExpectedReleaseCalls, "successful or never-acquired registrations are not released again");
					g_Assert.equal(g_mapClientCommands.has(Specification.Name), false);
					unCaseCount++;
				} finally {
					g_mapClientCommands.delete(Specification.Name);

					if (bHadCommand) {
						g_mapClientCommands.set(Specification.Name, PreviousCallback);
					}
				}
			}
		}

		g_Assert.equal(unCaseCount, 34);

		return unCaseCount;
	}

	const g_strRadioDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "docs", "api", "menus-radio.md"), "utf8");
	g_Assert.equal([...g_strRadioDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].length, 14, "expected radio example inventory is present");

	const g_strNativeTextDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "docs", "api", "menus.md"), "utf8");
	g_Assert.equal([...g_strNativeTextDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].length, 3, "every reviewed native-text example is present");

	const g_vecExampleDocumentNames = [
		"menus.md",
		"menus-radio.md",
		"menus-esc.md",
		"menus-objects.md",
		"menus-queue.md",
	];
	for (const strDocumentName of g_vecExampleDocumentNames) {
		const strDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "docs", "api", strDocumentName), "utf8");
		const vecExampleMatches = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)];
		g_Assert.ok(vecExampleMatches.length > 0, `${strDocumentName} must contain executable examples`);

		for (let unExampleIndex = 0; unExampleIndex < vecExampleMatches.length; unExampleIndex += 1) {
			const ExampleExports = {};
			const strExampleLabel = `${strDocumentName}:example-${unExampleIndex + 1}`;
			const strExampleSource = vecExampleMatches[unExampleIndex][1];
			const RunExample = CreateExampleRunner(strExampleSource, strExampleLabel);
			const mapCommandsBeforeExample = new Map(g_mapClientCommands);

			const RequireExampleModule = (strModuleName) => {
				if (!Object.hasOwn(g_ModulePaths, strModuleName)) {
					throw new Error(`${strExampleLabel}: unexpected module ${strModuleName}`);
				}

				return require(g_ModulePaths[strModuleName]);
			};

			try {
				RunExample(RequireExampleModule, ExampleExports);

				const ReadyVoteCommand = g_mapClientCommands.get("sjs_ready_vote");
				if (ReadyVoteCommand) {
					g_Assert.equal(RunDocumentationOperation(ReadyVoteCommand, [{ Index: 1 }], strExampleLabel), 1, strExampleLabel);
					g_Assert.equal(RunDocumentationOperation(() => g_MenuQueue.GetPlayerMenuQueue(1).SelectMenuOption(1), [], strExampleLabel), true, strExampleLabel);
					g_Assert.equal(RunDocumentationOperation(() => ExampleExports.GetPlayerSelection(1), [], strExampleLabel), true, strExampleLabel);
				}

				if ((strDocumentName === "menus-esc.md") && strExampleSource.includes("function ShowHelpCallback(")) {
					const ShowHelpCommand = g_mapClientCommands.get("sjs_help");
					g_Assert.equal(typeof ShowHelpCommand, "function", strExampleLabel);

					const unESCDialogCountBeforeHelp = g_vecShownESCMenus.length;
					g_Assert.equal(RunDocumentationOperation(ShowHelpCommand, [{ Index: 1 }], strExampleLabel), 1, strExampleLabel);
					g_Assert.equal(g_vecShownESCMenus.length, unESCDialogCountBeforeHelp + 1, strExampleLabel);
					g_Assert.equal(g_vecShownESCMenus.at(-1).PlayerIndex, 1, strExampleLabel);
					g_Assert.equal(g_vecShownESCMenus.at(-1).DialogFields.Title, "Session help", strExampleLabel);
					g_Assert.equal(g_vecShownESCMenus.at(-1).DialogFields.Msg, "Use the configured ready command when prepared.", strExampleLabel);
					g_Assert.equal(g_vecShownESCMenus.at(-1).DialogFields.Time, 12, strExampleLabel);
				}

				g_Assert.equal(Object.hasOwn(ExampleExports, "unload"), false, strExampleLabel + ": must not export the obsolete lowercase lifecycle");
				g_Assert.equal(!strExampleSource.includes("exports.Unload =") || (typeof ExampleExports.Unload === "function"), true, strExampleLabel + ": must publish canonical cleanup");

				if (typeof ExampleExports.Unload === "function") {
					g_Assert.equal(RunDocumentationOperation(() => ExampleExports.Unload(), [], strExampleLabel), true, strExampleLabel);
				}
			} finally {
				try {
					g_MenuQueue.ClearMenuQueue(1);
				} finally {
					g_mapClientCommands.clear();
					for (const [strCommandName, Callback] of mapCommandsBeforeExample) {
						g_mapClientCommands.set(strCommandName, Callback);
					}
				}
			}
		}
	}

	CheckDirectMenuDocumentationCleanup(g_strMenuDocumentation);
	g_Assert.equal(CheckQueueSetupDocumentation(g_strQueueDocumentation), 2106);
	g_Assert.equal(CheckQueueErrorDocumentation(g_strQueueDocumentation), true);
	CheckQueueDocumentationTransportCleanup(g_strQueueDocumentation);
	CheckRadioDocumentationTransportCleanup(g_strRadioDocumentation);
	g_Assert.equal(CheckRadioSetupDocumentation(g_strRadioDocumentation), 3000);
	g_Assert.equal(CheckRadioDirectAndNavigationDocumentation(g_strRadioDocumentation), 1672);
	g_Assert.equal(CheckRadioCommandDocumentation(g_strRadioDocumentation), 688);
	CheckNativeTextTransportDocumentation(g_strNativeTextDocumentation);
	g_Assert.equal(CheckNativeTextCommandLifecycleDocumentation(g_strNativeTextDocumentation), 34);

	const g_strESCDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "docs", "api", "menus-esc.md"), "utf8");
	g_Assert.equal(CheckESCSetupDocumentationCleanup(g_strESCDocumentation), 1402);

	const g_vecESCJavaScriptExamples = [...g_strESCDocumentation.matchAll(/^\x60\x60\x60js\r?\n([\s\S]*?)^\x60\x60\x60/gm)].map(vecMatch => vecMatch[1]);
	g_Assert.equal(CheckESCCommandDocumentation(g_vecESCJavaScriptExamples[11]), 24);
	g_Assert.equal(CheckESCErrorDocumentation(g_vecESCJavaScriptExamples[12]), 57);
	g_Assert.equal(CheckMenuOptionSnapshotDocumentation(g_strMenuDocumentation), 24);
	g_Assert.equal(CheckMenuQueueRemoveFailureContract(), 448);
	g_Assert.equal(CheckMenuLifecycleDocumentation(g_strMenuDocumentation), 1992);
	g_Assert.equal(CheckMultiTargetMenuDocumentation(g_strMenuDocumentation), 499);
	g_Assert.equal(CheckMenuQueueClearFailureContract(), 135);
	g_Assert.equal(CheckMenuQueueCloseFailureContract(), 1792);
	g_Assert.equal(CheckRadioCloseFailureContract(), 3564);

	g_Assert.equal(g_vecShownTextMenus.length > 0, true);
	g_Assert.equal(g_vecHiddenTextMenus.length > 0, true);
	g_Assert.deepEqual([...g_mapClientCommands.keys()], ["menuselect"], "example commands must be unregistered");
} finally {
	try {
		if (g_CleanupMenuState) {
			g_CleanupMenuState();
		}
	} finally {
		try {
			RestoreProperty(g_Module, "_load", g_OriginalModuleLoadDescriptor);
		} finally {
			try {
				RestoreProperty(globalThis, "sourcejs", g_OriginalSourceJSDescriptor);
			} finally {
				for (const strModulePath of Reflect.ownKeys(require.cache)) {
					if (!Object.hasOwn(g_OriginalCacheDescriptors, strModulePath)) {
						delete require.cache[strModulePath];
					}
				}

				Object.defineProperties(require.cache, g_OriginalCacheDescriptors);
			}
		}
	}
}

console.log("[  OK  ] smoke_menus");
