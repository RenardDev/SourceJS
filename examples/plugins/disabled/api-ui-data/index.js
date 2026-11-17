"use strict";

const { FlatFileBackend } = require("auth/backends/flatfile");
const { SQLBackend } = require("auth/backends/sql");
const { Backend } = require("auth");
const { AUTH_MANAGER, AuthManager } = require("auth/manager");
const { PlayerPermissions } = require("auth/permissions");
const { GetTemporaryEntityTemplate, GetTemporaryEntityTemplates, TemporaryEntity } = require("effects");
const { RegisterPluginUnloadingListener } = require("listeners");
const { LogInfo, LogWarning } = require("loggers");
const { GetUserMessageImplementation, IMPLEMENTED_USER_MESSAGES, SendClientConsoleMessageToRecipients, UserMessageData } = require("messages/implementation");
const {
	GetBaseMessageConstants,
	HintText,
	HUDTextMessage,
	KeyHintText,
	SayText,
	SayText2,
	ShowMenu,
	UserMessage,
	VGUIMenu,
} = require("messages");
const { ColorizeMessageText, GREEN, MessageColor, StripMessageColorCodes } = require("messages/colors");
const { GREEN: g_strSayText2Green, StripSayText2ColorCodes, WHITE } = require("messages/colors/saytext2");
const { DialogNotification, DialogText } = require("messages/dialog");
const { CreateCommandConfigEntry } = require("config/command");
const { CreateCVarConfigEntry, ResolveConfigText } = require("config/cvar");
const { ConfigManager, GetUnusedConfigEntries, ParseConfigText } = require("config/manager");
const { CreateConfigSection } = require("config/section");
const { RegisterCommand: g_RegisterClientCommand, UnregisterCommand: g_UnregisterClientCommand } = require("commands/client");
const { PagedMenu, PagedMenuOption } = require("menus/index");
const { PagedESCMenu, PagedESCOption } = require("menus/esc");
const { ListPlayerMenuQueues } = require("menus/queue");
const { PagedRadioMenu, PagedRadioOption } = require("menus/radio");
const { ShowText } = require("menus");
const { GetServerGravityConVarValue, PhysicsEnvironment, PhysicsObject, PhysicsInterface } = require("physics");
const { Player } = require("players/entity");
const { DoesFileExist, Root } = require("settings");
const { BuildSettingsMenu } = require("settings/menu");
const { PlayerSettings, GetPlayerSettings } = require("settings/player");
const { CreateStorage } = require("settings/storage");
const { ChoiceSetting, IntegerSetting, GetSetting, ListSettings, RegisterSetting, UnregisterSetting } = require("settings/types");
const { RegisterCommand: g_RegisterSourceCommand, UnregisterCommand: g_UnregisterSourceCommand } = require("source");
const {
	INVALID_STRING_INDEX,
	STRING_TABLES,
	AddDownloadable,
	AddDownloadableDirectory,
	GetAll,
	UntrackDownloadableDirectory,
} = require("stringtables");
const { GetTrackedDownloadables } = require("stringtables/downloads");
const { FindModel, GetModelHeader, Release } = require("studio/cache");
const { INVALID_MODEL_HANDLE, StudioFlags } = require("studio/constants");
const { FormatText, GetFallbackLanguage, GetLanguages } = require("translations");
const { LanguageManager } = require("translations/manager");
const { LangStrings } = require("translations/strings");

const g_strPluginName = "api-ui-data";
const g_strCommandName = "sjs_api_ui";
const g_unPreviewEntryLimit = 12;
const g_unTemporaryTemplatePreviewLimit = 8;
const g_setPendingResources = new Set();
let g_bSourceCommandRegistered = false;
let g_bClientCommandRegistered = false;
let g_PluginUnloadingRegistration = null;
let g_unPendingExampleCount = 0;
let g_bUnloading = false;

function TrackResource(Release, bReady = true) {
	const Resource = { Release, Ready: bReady, Releasing: false };
	g_setPendingResources.add(Resource);

	return Resource;
}

function ReleaseResource(Resource) {
	if (!g_setPendingResources.has(Resource) || !Resource.Ready || Resource.Releasing) {
		return;
	}

	Resource.Releasing = true;
	try {
		Resource.Release();
		g_setPendingResources.delete(Resource);
	} finally {
		Resource.Releasing = false;
	}
}

function RunCleanupActions(strLabel, vecActions) {
	const vecErrors = [];
	for (const Action of vecActions) {
		try {
			Action();
		} catch (CleanupError) {
			vecErrors.push(CleanupError);
		}
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, `${strLabel} cleanup failed.`);
	}
}

function ReleaseResources(strLabel, vecResources) {
	RunCleanupActions(strLabel, [...vecResources].reverse().map((Resource) => () => ReleaseResource(Resource)));
}

function UseCleanup(strLabel, Use, Cleanup) {
	let bOperationFailed = false;
	let OperationError = undefined;
	try {
		return Use();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			Cleanup();
		} catch (CleanupError) {
			if (bOperationFailed) {
				throw new AggregateError([OperationError, CleanupError], `${strLabel} operation and cleanup failed.`);
			}

			throw CleanupError;
		}
	}
}

function UseResources(strLabel, vecResources, Use) {
	return UseCleanup(strLabel, Use, () => ReleaseResources(strLabel, vecResources));
}

function CombineRequestErrors(strLabel, ...vecErrors) {
	const vecFailures = vecErrors.filter((RequestError) => RequestError !== null);
	if (vecFailures.length === 0) {
		return null;
	}

	if (vecFailures.length === 1) {
		return vecFailures[0];
	}

	return new AggregateError(vecFailures, `${strLabel} operation and cleanup failed.`);
}

function ReleaseBlocking(StartRelease) {
	let bCompleted = false;
	let RequestError = null;
	let Result = undefined;
	StartRelease({ Blocking: true }, (CloseError, bClosed) => {
		bCompleted = true;
		RequestError = CloseError;
		Result = bClosed;
	});

	if (!bCompleted) {
		throw new Error("Blocking cleanup did not deliver its required callback.");
	}

	if (RequestError !== null) {
		throw RequestError;
	}

	if (typeof Result !== "boolean") {
		throw new TypeError("Resource cleanup returned an invalid status.");
	}
}

function GetCommandArguments(InputCommand) {
	return InputCommand.Arguments.slice(1);
}

function ConvertJSONValue(...vecArguments) {
	const Value = vecArguments[1];

	return (typeof Value === "bigint") ? `${Value}n` : Value;
}

function SummarizeValue(Value) {
	if (Value === undefined) {
		return "undefined";
	}

	if (Value === null) {
		return "null";
	}

	if (typeof Value === "object") {
		try {
			return JSON.stringify(Value, ConvertJSONValue);
		} catch {
			return "[unserializable value]";
		}
	}

	return String(Value);
}

function LogResult(strLabel, Callback) {
	if (g_bUnloading) {
		return undefined;
	}

	const Value = Callback();
	LogInfo("%s", `${strLabel}: ${SummarizeValue(Value)}`);

	return Value;
}

function InvokeRequest(Operation, Callback) {
	let bCompleted = false;
	const Complete = (RequestError, Value) => {
		if (bCompleted) {
			return;
		}

		bCompleted = true;
		Callback(RequestError, Value);
	};

	try {
		Operation(Complete);
	} catch (RequestError) {
		if (bCompleted) {
			throw RequestError;
		}

		// Null denotes callback success, so retain a thrown null as the cause of a real failure.
		Complete((RequestError === null) ? new Error("The request operation threw null.", { cause: RequestError }) : RequestError, null);
	}
}

function RunRequestSequence(vecOperations, Callback) {
	let unOperationIndex = 0;
	const CompleteStep = (RequestError) => {
		if (RequestError !== null) {
			Callback(RequestError);
			return;
		}

		if (g_bUnloading) {
			Callback(new Error("The UI/data example is unloading."));
			return;
		}

		if (unOperationIndex === vecOperations.length) {
			Callback(null);
			return;
		}

		const Operation = vecOperations[unOperationIndex];
		unOperationIndex += 1;
		InvokeRequest(Operation, CompleteStep);
	};
	CompleteStep(null);
}

function LogRequestResult(strLabel, RequestError, Value) {
	if (g_bUnloading) {
		return;
	}

	if (RequestError !== null) {
		LogWarning("%s", `${strLabel}: request failed; details are omitted to protect sensitive data.`);
		return;
	}

	LogInfo("%s", `${strLabel}: ${SummarizeValue(Value)}`);
}

function CompleteExampleRequest(strLabel, RequestError, Value) {
	try {
		LogRequestResult(strLabel, RequestError, Value);
	} finally {
		g_unPendingExampleCount -= 1;
	}
}

function RunStorageExample(strLabel, strStorageName, Operation) {
	if (g_bUnloading) {
		return;
	}

	const Options = { Blocking: false };
	let Storage = null;
	let Resource = null;
	g_unPendingExampleCount += 1;
	InvokeRequest((Callback) => {
		// Each workflow owns its own SQLite session, never a namespace in the shared persistent database.
		Storage = CreateStorage(strStorageName, { Backend: "sqlite3", ConnectionString: "dbname=:memory:" });
		Resource = TrackResource(() => ReleaseBlocking((ReleaseOptions, ReleaseCallback) => Storage.Close(ReleaseOptions, ReleaseCallback)), false);
		Operation(Storage, Options, Callback);
	}, (RequestError, Value) => {
		if (Storage === null) {
			CompleteExampleRequest(strLabel, RequestError, Value);
			return;
		}

		// Cleanup is part of the callback chain; never close storage with its requests still pending.
		InvokeRequest((Callback) => Storage.ClearSettings(Options, Callback), (ClearError) => {
			InvokeRequest((Callback) => Storage.Close(Options, Callback), (CloseError) => {
				Resource.Ready = true;
				if (CloseError === null) {
					g_setPendingResources.delete(Resource);
				}

				CompleteExampleRequest(strLabel, CombineRequestErrors(strLabel, RequestError, ClearError, CloseError), Value);
			});
		});
	});
}

function InspectUIAndData() {
	const { FADE_FLAGS, HUD_DESTINATION, SHAKE_COMMAND } = GetBaseMessageConstants();

	LogResult("messages/colors composition", () => {
		const ColorValue = new MessageColor(GREEN);
		const strColored = ColorizeMessageText("SourceJS", ColorValue);

		return { Applied: ColorValue.ColorizeMessageText("Ready"), CodePoint: ColorValue.ColorCode.charCodeAt(0), Colored: strColored, Plain: StripMessageColorCodes(strColored) };
	});

	LogResult("messages/colors/saytext2.StripSayText2ColorCodes", () => StripSayText2ColorCodes(`${g_strSayText2Green}SourceJS${WHITE}`));

	LogResult("messages enum sample", () => ({ Center: HUD_DESTINATION.CENTER, FadeIn: FADE_FLAGS.IN, ShakeStart: SHAKE_COMMAND.START }));

	LogResult("messages VGUIMenu", () => {
		const Message = new VGUIMenu("info", { Title: "SourceJS" }, true);

		return { Fields: Message.MessageFields, MessageName: Message.GetUserMessageName() };
	});

	LogResult("messages TranslateUserMessageFields", () => new HUDTextMessage("Hello {Name}", { Destination: HUD_DESTINATION.CENTER, Parameter1: "{Name}" }).TranslateUserMessageFields("en", { Name: "SourceJS" }));

	LogResult("messages/implementation UserMessageData", () => {
		const Data = new UserMessageData({ Message: "Hello" });
		Data.Message = "Hello SourceJS";

		return { Changed: Data.HasUserMessageChanged(), Message: Data.Message };
	});

	LogResult("messages/implementation registry", () => ({
		Known: Array.from(IMPLEMENTED_USER_MESSAGES.keys()).filter((strKey) => typeof strKey === "string"),
		Fade: GetUserMessageImplementation("Fade").name,
		SayText2: GetUserMessageImplementation("SayText2").name,
		TextMsg: GetUserMessageImplementation("TextMsg").name,
	}));

	LogResult("menus paged selection", () => {
		const Menu = new PagedMenu({ ValueTitle: "SourceJS {Name}", ValueDescription: "Menu example for {Name}", ItemsPerPage: 1, QueueEnabled: false });
		let SelectedItem = null;
		Menu.AppendMenuItem(new PagedMenuOption("First {Name}", "first"));
		Menu.AppendMenuItem(new PagedMenuOption("Second {Name}", "second"));
		Menu.RegisterMenuSelectCallback((unPlayerIndex, Value, Item) => {
			SelectedItem = { PlayerIndex: unPlayerIndex, Value, Text: Item.GetMenuText(unPlayerIndex, { Name: "SourceJS" }) };
		});

		const FirstPage = Menu.GetMenuRenderData(1, 0, { Name: "SourceJS" });
		const SecondPage = Menu.GetMenuRenderData(1, 1, { Name: "SourceJS" });
		Menu.SelectMenuOption(1, 1, 1);
		const unPlayerPage = Menu.GetPlayerMenuPage(1);

		Menu.CloseMenuForPlayer(1);

		return {
			FirstPage,
			LastPageIndex: Menu.LastPageIndex,
			PlayerPage: unPlayerPage,
			ReleasedPage: Menu.GetPlayerMenuPage(1),
			SecondPage,
			Selected: SelectedItem,
		};
	});

	LogResult("menus/queue live state", () => {
		const vecQueueStates = [];
		for (const MenuQueue of ListPlayerMenuQueues()) {
			vecQueueStates.push({ ActiveMenu: (MenuQueue.ActiveMenu === null) ? null : MenuQueue.ActiveMenu.constructor.name, PlayerIndex: MenuQueue.PlayerIndex, Length: MenuQueue.Length, Pending: MenuQueue.PendingMenuEntries.length });
		}

		return vecQueueStates;
	});

	LogResult("menus/radio paged selection", () => {
		const RadioMenu = new PagedRadioMenu({
			ValueDescription: "Mode: {Mode}",
			Fill: false,
			ItemsPerPage: 1,
			QueueEnabled: false,
			ValueTitle: "Radio",
		});
		let SelectedItem = null;
		RadioMenu.AppendMenuItem(new PagedRadioOption("First", "first"));
		RadioMenu.AppendMenuItem(new PagedRadioOption("Second", "second"));
		RadioMenu.RegisterMenuSelectCallback((unPlayerIndex, Value) => {
			SelectedItem = { PlayerIndex: unPlayerIndex, Value };
		});

		const Data = RadioMenu.GetMenuRenderData(1, 1, { Mode: "live" });

		RadioMenu.SelectMenuOption(1, 1, 1);

		return {
			Message: Data.MenuMessage,
			PageIndex: Data.PageIndex,
			PageCount: Data.PageCount,
			Profile: RadioMenu.RadioProfile,
			Selected: SelectedItem,
			ValidSlotBits: Data.ValidSlotBits,
		};
	});

	LogResult("menus/esc paged selection", () => {
		const ESCMenu = new PagedESCMenu({
			ValueDescription: "Mode: {Mode}",
			Fill: false,
			ItemsPerPage: 1,
			QueueEnabled: false,
			ValueTitle: "ESC",
		});
		let SelectedItem = null;
		ESCMenu.AppendMenuItem(new PagedESCOption("First", "first"));
		ESCMenu.AppendMenuItem(new PagedESCOption("Second", "second"));
		ESCMenu.RegisterMenuSelectCallback((unPlayerIndex, Value) => {
			SelectedItem = { PlayerIndex: unPlayerIndex, Value };
		});

		const Data = ESCMenu.GetMenuRenderData(1, 1, { Mode: "live" });

		ESCMenu.SelectMenuOption(1, 1, 1);

		return { Message: Data.MenuMessage, PageIndex: Data.PageIndex, PageCount: Data.PageCount, Selected: SelectedItem };
	});

	LogResult("settings root", () => ({ Exists: DoesFileExist(Root), Root }));

	LogResult("settings/player registry tree", () => {
		const strTreeName = "SourceJS API UI Data";
		const ExistingTree = Array.from(GetPlayerSettings()).find((Tree) => Tree.Name === strTreeName);
		if (ExistingTree !== undefined) {
			throw new Error("The player-settings example name is already registered.");
		}

		const Tree = new PlayerSettings(strTreeName, "sjs_api", "SourceJS API UI Data");
		const vecResources = [TrackResource(() => {
			if (!Tree.Unregister() && Array.from(GetPlayerSettings()).includes(Tree)) {
				throw new Error("Unable to unregister the owned player-settings tree.");
			}
		})];
		vecResources.push(TrackResource(() => Tree.Menu.CloseMenuForPlayer(1)));

		return UseResources("player-settings example", vecResources, () => {
			const VolumeSetting = Tree.AddIntegerSetting("Volume", 5, { Maximum: 10, Minimum: 0, Text: "Volume" });
			const GameplaySection = Tree.AddSection("Gameplay", { Text: "Gameplay" });
			const EnabledSetting = GameplaySection.AddBooleanSetting("Enabled", true, { Text: "Enabled" });
			const MenuData = Tree.Menu.GetMenuRenderData(1);

			return {
				EnabledConVar: EnabledSetting.ConVar,
				Listed: Array.from(GetPlayerSettings()).includes(Tree),
				Menu: MenuData.MenuMessage,
				Path: GameplaySection.Path,
				Size: Tree.Size,
				VolumeConVar: VolumeSetting.ConVar,
			};
		});
	});

	RunStorageExample("settings/menu rendered value", "api_ui_data_menu_example", (Storage, Options, Callback) => {
		const strPlayerUniqueID = "SOURCEJS_API_UI_DATA";
		const VolumeSetting = new IntegerSetting("Example Volume", 5, { Maximum: 10, Minimum: 0, Prefix: "sjs_", Storage });
		const vecResources = [];
		let Menu = null;
		let SelectedItem = null;

		RunRequestSequence([
			(Next) => VolumeSetting.Set(strPlayerUniqueID, 7, Options, Next),
			(Next) => {
				Menu = BuildSettingsMenu(strPlayerUniqueID, {
					ItemsPerPage: 1,
					SelectCallback: (unPlayerIndex, Value) => {
						SelectedItem = { PlayerIndex: unPlayerIndex, Setting: Value.Name };
					},
					Settings: [VolumeSetting],
					Title: "SourceJS Settings",
				});
				vecResources.push(TrackResource(() => Menu.CloseMenuForPlayer(1), false));
				Menu.RefreshValues(Options, Next);
			},
		], (RequestError) => InvokeRequest((Complete) => {
			for (const Resource of vecResources) {
				Resource.Ready = true;
			}

			const Result = UseResources("settings value menu", vecResources, () => {
				if (RequestError !== null) {
					throw RequestError;
				}

				const MenuData = Menu.GetMenuRenderData(1);
				Menu.SelectMenuOption(1, 1);

				return { Message: MenuData.MenuMessage, Selected: SelectedItem, Title: MenuData.MenuTitle };
			});

			Complete(null, Result);
		}, Callback));
	});

	RunStorageExample("settings/storage player view", "api_ui_data_storage_example", (Storage, Options, Callback) => {
		const Values = Storage.GetSettingsForPlayer("SOURCEJS_API_UI_DATA");
		const Result = {};
		let bDeleted = false;

		RunRequestSequence([
			(Next) => Values.SetSetting("sjs_api_volume", 7, Options, Next),
			(Next) => Values.HasSetting("sjs_api_volume", Options, (RequestError, bHasValue) => {
				if (RequestError !== null) {
					Next(RequestError);
					return;
				}

				InvokeRequest((Complete) => {
					Result.Has = bHasValue;
					Result.Keys = Values.Keys();
					Result.Size = Values.Size;
					Complete(null);
				}, Next);
			}),
			(Next) => Values.GetSetting("sjs_api_volume", null, Options, (RequestError, Value) => {
				Result.Value = Value;
				Next(RequestError);
			}),
			(Next) => Storage.Save(Options, (RequestError, bSaved) => {
				Result.Saved = bSaved;
				Next(RequestError);
			}),
			(Next) => Values.DeleteSetting("sjs_api_volume", Options, (RequestError, bResult) => {
				bDeleted = bResult;
				Next(RequestError);
			}),
			(Next) => Values.HasSetting("sjs_api_volume", Options, (RequestError, bHasValue) => {
				Result.Deleted = bDeleted && !bHasValue;
				Next(RequestError);
			}),
		], (RequestError) => Callback(RequestError, Result));
	});

	RunStorageExample("settings/types registered values", "api_ui_data_types_example", (Storage, Options, Callback) => {
		const strPlayerUniqueID = "SOURCEJS_API_UI_DATA";
		const VolumeSetting = new IntegerSetting("Example Volume", 5, { Maximum: 10, Minimum: 0, Prefix: "sjs_", Storage });
		const ThemeSetting = new ChoiceSetting("Example Theme", "dark", { Choices: ["dark", "light"], Prefix: "sjs_", Storage });
		const vecResources = [];
		let strThemeValue = null;
		let unVolumeValue = 0;

		RunRequestSequence([
			(Next) => {
				vecResources.push(TrackResource(() => {
					if ((GetSetting(VolumeSetting.Name) === VolumeSetting) && !UnregisterSetting(VolumeSetting.Name)) {
						throw new Error("Unable to unregister the owned volume setting.");
					}
				}));
				RegisterSetting(VolumeSetting);
				vecResources.push(TrackResource(() => {
					if ((GetSetting(ThemeSetting.Name) === ThemeSetting) && !UnregisterSetting(ThemeSetting.Name)) {
						throw new Error("Unable to unregister the owned theme setting.");
					}
				}));
				RegisterSetting(ThemeSetting);
				Next(null);
			},
			(Next) => VolumeSetting.Set(strPlayerUniqueID, 7, Options, Next),
			(Next) => ThemeSetting.Set(strPlayerUniqueID, "light", Options, Next),
			(Next) => ThemeSetting.Get(strPlayerUniqueID, Options, (RequestError, strValue) => {
				strThemeValue = strValue;
				Next(RequestError);
			}),
			(Next) => VolumeSetting.Get(strPlayerUniqueID, Options, (RequestError, unValue) => {
				unVolumeValue = unValue;
				Next(RequestError);
			}),
		], (RequestError) => InvokeRequest((Complete) => {
			const Result = UseResources("settings registry", vecResources, () => {
				if (RequestError !== null) {
					throw RequestError;
				}

				return {
					Choice: strThemeValue,
					ChoiceOptions: ThemeSetting.Choices,
					ConVar: VolumeSetting.ConVar,
					Registered: (GetSetting(VolumeSetting.Name) === VolumeSetting) && ListSettings().includes(ThemeSetting),
					Valid: VolumeSetting.IsValid(10) && !VolumeSetting.IsValid(11),
					Value: unVolumeValue,
				};
			});

			Complete(null, Result);
		}, Callback));
	});

	LogResult("config.cvar help blocks", () => {
		const ConfigurationManagerInstance = new ConfigManager("sourcejs/api-ui-data", { CVarPrefix: "sjs_api_" });
		ConfigurationManagerInstance.SetHeaderLines(["SourceJS API example", "Values are read without writing this preview."]);
		ConfigurationManagerInstance.AddConfigSection("User interface");
		const CVar = ConfigurationManagerInstance.AddCVarConfigEntry("volume", 5, "Example volume", { ValueMinimum: 0, ValueMaximum: 10 });
		CVar.AddHelpText(["This block adds help text for the example console variable."]);
		CVar.CreateHelpList("Values").ExtendListItems(["0 muted", "10 loud"]);
		ConfigurationManagerInstance.AddCommandConfigEntry("sjs_api_reload", "Reload the example", { Arguments: ["now"] });

		const ParsedConfiguration = ParseConfigText('sjs_api_volume "8"\nlegacy_setting "keep"');
		const vecUnusedConfigurationEntries = GetUnusedConfigEntries(ParsedConfiguration.Entries, new Set(["sjs_api_volume"]));
		const StandaloneCVar = CreateCVarConfigEntry("sjs_api_mode", "default", "Example mode");
		const StandaloneCommand = CreateCommandConfigEntry("sjs_api_refresh", "Refresh UI", { Arguments: ["1"] });
		const StandaloneSection = CreateConfigSection("SourceJS", { Width: 24 });

		return {
			Command: StandaloneCommand.RenderConfigEntry(ConfigurationManagerInstance).join(" | "),
			CVar: StandaloneCVar.RenderConfigEntry(ConfigurationManagerInstance).join(" | "),
			Preview: ConfigurationManagerInstance.RenderConfig().split("\n").slice(0, g_unPreviewEntryLimit).join(" | "),
			Resolved: ResolveConfigText("translated"),
			Section: StandaloneSection.RenderConfigEntry(ConfigurationManagerInstance).join(" | "),
			Unused: vecUnusedConfigurationEntries.map((Entry) => Entry.Name),
		};
	});

	LogResult("translations languages", () => GetLanguages());

	LogResult("translations format", () => FormatText("Hello {Name}", { Name: "SourceJS" }));

	LogResult("translations/manager LanguageManager", () => {
		const LanguageManagerInstance = new LanguageManager();

		return { Aliases: LanguageManagerInstance.Aliases, DefaultLanguage: LanguageManagerInstance.DefaultLanguage, FallbackLanguage: LanguageManagerInstance.FallbackLanguage, HasEnglish: LanguageManagerInstance.Has("en") };
	});

	LogResult("translations/strings collection classes", () => {
		const FileStrings = new LangStrings("_core/translations_strings");
		const strFirstKey = FileStrings.Keys()[0];
		if (strFirstKey === undefined) {
			throw new Error("The core translation file does not contain phrases.");
		}

		const Phrase = FileStrings.Get(strFirstKey);
		if (Phrase === null) {
			throw new Error(`Unable to resolve core translation phrase: ${strFirstKey}`);
		}

		return {
			DefaultLanguage: FileStrings.DefaultLanguage,
			FallbackLanguage: GetFallbackLanguage(),
			FirstKey: strFirstKey,
			Languages: Phrase.Keys(),
			Phrase: Phrase.GetString(undefined, { filename: "api-ui-data.ini" }),
			Size: FileStrings.Size,
			Tokenized: Phrase.Tokenized({ filename: "api-ui-data.ini" }).GetString(),
		};
	});

	LogResult("auth runtime state", () => ({ Parents: Array.from(AUTH_MANAGER.Parents.keys()), Players: Array.from(AUTH_MANAGER.Players.keys()) }));

	if (g_bUnloading) {
		return;
	}

	{
		const Options = { Blocking: false };
		const AuthenticationManagerInstance = new AuthManager();
		const FlatFileBackendInstance = new FlatFileBackend();
		const SQLBackendInstance = new SQLBackend({ BackendName: "sqlite3", ConnectionString: "dbname=:memory:", Manager: AuthenticationManagerInstance });
		// Constructors establish JavaScript state only; attach cleanup before the first asynchronous load.
		const ManagerResource = TrackResource(() => ReleaseBlocking((ReleaseOptions, ReleaseCallback) => AuthenticationManagerInstance.Unload(ReleaseOptions, ReleaseCallback)), false);
		const FlatFileResource = TrackResource(() => ReleaseBlocking((ReleaseOptions, ReleaseCallback) => FlatFileBackendInstance.Unload(ReleaseOptions, ReleaseCallback)), false);
		const SQLResource = TrackResource(() => ReleaseBlocking((ReleaseOptions, ReleaseCallback) => SQLBackendInstance.Unload(ReleaseOptions, ReleaseCallback)), false);
		let vecBackends = [];
		const Result = {};
		let mapPlayerPermissions = null;
		const CompleteExample = (RequestError) => {
			InvokeRequest((Callback) => AuthenticationManagerInstance.Unload(Options, Callback), (UnloadError) => {
				ManagerResource.Ready = true;
				if (UnloadError === null) {
					g_setPendingResources.delete(ManagerResource);
				}

				// A failed load may own a connection without becoming the active manager backend.
				InvokeRequest((Callback) => SQLBackendInstance.Unload(Options, Callback), (SQLUnloadError) => {
					SQLResource.Ready = true;
					if (SQLUnloadError === null) {
						g_setPendingResources.delete(SQLResource);
					}

					InvokeRequest((Callback) => FlatFileBackendInstance.Unload(Options, Callback), (FlatFileUnloadError) => {
						FlatFileResource.Ready = true;
						if (FlatFileUnloadError === null) {
							g_setPendingResources.delete(FlatFileResource);
						}

						CompleteExampleRequest("auth/manager permissions", CombineRequestErrors("authentication example", RequestError, UnloadError, SQLUnloadError, FlatFileUnloadError), Result);
					});
				});
			});
		};

		g_unPendingExampleCount += 1;
		RunRequestSequence([
			(Next) => {
				vecBackends = AuthenticationManagerInstance.FindAndAddAvailableBackends([FlatFileBackendInstance, SQLBackendInstance]).map((BackendInstance) => BackendInstance.Name);
				Next(null);
			},
			(Next) => AuthenticationManagerInstance.SetActiveBackend(SQLBackendInstance.Name, Options, Next),
			(Next) => {
				const mapAdministratorPermissions = AuthenticationManagerInstance.GetParentPermissions("admins");
				mapAdministratorPermissions.Add("sourcejs.example.*", Options, Next);
			},
			(Next) => {
				mapPlayerPermissions = AuthenticationManagerInstance.GetPlayerPermissionsFromSteamID("STEAM_1:1:4");
				if (mapPlayerPermissions === null) {
					throw new Error("Unable to create permissions for the example SteamID.");
				}

				mapPlayerPermissions.AddParent("admins", Options, Next);
			},
			(Next) => mapPlayerPermissions.Add("sourcejs.example.self", Options, Next),
			(Next) => {
				Object.assign(Result, {
					Authorized: mapPlayerPermissions.HasPermission("sourcejs.example.reload"),
					Backends: vecBackends,
					BaseBackend: FlatFileBackendInstance instanceof Backend,
					Direct: mapPlayerPermissions.HasDirectPermission("sourcejs.example.self"),
					Flattened: mapPlayerPermissions.Flatten().sort(),
					PermissionType: mapPlayerPermissions instanceof PlayerPermissions,
					Player: {
						Name: mapPlayerPermissions.Name,
						Parents: Array.from(mapPlayerPermissions.Parents, (mapParent) => mapParent.Name),
						Permissions: Array.from(mapPlayerPermissions.keys()),
						SteamID64: mapPlayerPermissions.SteamID64,
					},
					Server: AuthenticationManagerInstance.TargetsThisServer(null),
				});
				Next(null);
			},
			(Next) => SQLBackendInstance.GetParent("admins", Options, (RequestError, ParentRecord) => {
				Result.SQLParent = ParentRecord;
				Next(RequestError);
			}),
			(Next) => SQLBackendInstance.GetPlayer(mapPlayerPermissions.SteamID64, Options, (RequestError, PlayerRecord) => {
				Result.SQLPlayer = PlayerRecord;
				Next(RequestError);
			}),
		], CompleteExample);
	}

	LogResult("stringtables GetAll", () => GetAll());

	LogResult("stringtables StringTable", () => {
		const Table = STRING_TABLES.Find("downloadables");
		if (Table === null) {
			throw new Error("The downloadables string table is not available.");
		}

		const strFirstValue = Table.Get(0);

		return {
			First: strFirstValue,
			ID: Table.ID,
			Index: (strFirstValue === null) ? INVALID_STRING_INDEX : Table.IndexOf(strFirstValue),
			Valid: Table.Valid,
			MaximumSize: Table.MaximumStringCount,
			Name: Table.Name,
			Address: Table.Address,
			Size: Table.Length,
		};
	});

	LogResult("stringtables/downloads tracked", () => GetTrackedDownloadables());

	LogResult("effects/templates live templates", () => GetTemporaryEntityTemplates().slice(0, g_unTemporaryTemplatePreviewLimit).map((Template) => ({ ClassName: Template.ClassName, FieldCount: Template.GetTemporaryEntityFieldNames().length, Name: Template.Name, Size: Template.Size })));

	LogResult("effects TemporaryEntity typed fields", () => {
		const Template = GetTemporaryEntityTemplate("BeamEntPoint");
		const TemporaryEntityInstance = new TemporaryEntity("BeamEntPoint", {
			Color: [0xFF, 0x50, 0x28, 0xDC],
			EndPoint: [64, 64, 32],
			HaloIndex: 0,
			ModelIndex: 0,
			StartPoint: [0, 0, 0],
		});
		TemporaryEntityInstance.SetTemporaryEntityPropertyFloat("LifeTime", 1.5);

		const ColorDescriptor = Template.ResolveTemporaryEntityField("Color");
		if (ColorDescriptor === null) {
			throw new Error("BeamEntPoint does not define the typed color field for this SDK branch.");
		}

		return {
			Color: TemporaryEntityInstance.GetTemporaryEntityProperty("Color").ConvertColorToArray(),
			ColorFields: ColorDescriptor.ValueFields,
			ValueType: ColorDescriptor.ValueType,
			Fields: Template.GetTemporaryEntityFieldNames().slice(0, g_unPreviewEntryLimit),
			LifeTime: TemporaryEntityInstance.GetTemporaryEntityPropertyFloat("LifeTime"),
			StartPoint: TemporaryEntityInstance.GetTemporaryEntityPropertyVector("StartPoint").ConvertMathStructureToArray(),
			Values: TemporaryEntityInstance.Values,
		};
	});

	LogResult("physics live environment", () => {
		const flAirDensityAdjustment = 0.001;
		const flGravityAdjustment = 1;
		const PhysicsInterfaceInstance = new PhysicsInterface();
		const Environment = new PhysicsEnvironment();
		const LiveGravity = Environment.GetGravity();
		const GravityBefore = { X: LiveGravity.X, Y: LiveGravity.Y, Z: LiveGravity.Z };
		const flAirDensityBefore = Environment.GetAirDensity();
		const GravityTest = { ...GravityBefore, Z: GravityBefore.Z - flGravityAdjustment };
		const flAirDensityTest = flAirDensityBefore + flAirDensityAdjustment;

		return UseCleanup("physics example", () => {
			if (!Environment.SetGravity(GravityTest)) {
				throw new Error("Unable to set example gravity.");
			}

			if (!Environment.SetAirDensity(flAirDensityTest)) {
				throw new Error("Unable to set example air density.");
			}

			const vecActiveObjects = Environment.ActiveObjects();
			const FirstObject = vecActiveObjects[0] ?? null;
			let ObjectValue = null;
			if (FirstObject !== null) {
				const ObjectFromAddress = PhysicsObject.CreatePhysicsObjectFromAddress(FirstObject.Address);
				const Position = FirstObject.GetPosition();
				const Velocity = FirstObject.GetVelocity();
				ObjectValue = {
					CollisionEnabled: FirstObject.IsCollisionEnabled(),
					GravityEnabled: FirstObject.IsGravityEnabled(),
					Mass: FirstObject.GetMass(),
					Name: FirstObject.GetName(),
					Address: FirstObject.Address,
					Position: {
						Angles: { X: Position.Angles.X, Y: Position.Angles.Y, Z: Position.Angles.Z },
						Origin: { X: Position.Position.X, Y: Position.Position.Y, Z: Position.Position.Z },
					},
					SameAddress: ObjectFromAddress.Address === FirstObject.Address,
					Velocity: {
						Angular: { X: Velocity.AngularVelocity.X, Y: Velocity.AngularVelocity.Y, Z: Velocity.AngularVelocity.Z },
						Linear: { X: Velocity.LinearVelocity.X, Y: Velocity.LinearVelocity.Y, Z: Velocity.LinearVelocity.Z },
					},
				};
			}

			return {
				ActiveObjectCount: Environment.GetActiveObjectCount(),
				ActiveObjects: vecActiveObjects.length,
				After: {
					AirDensity: Environment.GetAirDensity(),
					Gravity: { X: LiveGravity.X, Y: LiveGravity.Y, Z: LiveGravity.Z },
				},
				Before: { AirDensity: flAirDensityBefore, Gravity: GravityBefore },
				EnvironmentAddress: Environment.Address,
				InterfaceAddress: PhysicsInterfaceInstance.Address,
				Object: ObjectValue,
				AddressRoundTrip: {
					Environment: PhysicsEnvironment.CreatePhysicsEnvironmentFromAddress(Environment.Address).Address === Environment.Address,
					PhysicsInterface: PhysicsInterface.CreatePhysicsInterfaceFromAddress(PhysicsInterfaceInstance.Address).Address === PhysicsInterfaceInstance.Address,
				},
				ServerGravity: GetServerGravityConVarValue(),
				Simulation: {
					InProgress: Environment.IsInSimulation(),
					NextFrameTime: Environment.GetNextFrameTime(),
					Time: Environment.GetSimulationTime(),
					TimeStep: Environment.GetSimulationTimestep(),
				},
			};
		}, () => {
			// Restore only within this call: these views borrow the current map's native environment.
			RunCleanupActions("physics restoration", [
				() => {
					if (!Environment.SetAirDensity(flAirDensityBefore)) {
						throw new Error("Unable to restore air density.");
					}
				},
				() => {
					if (!Environment.SetGravity(GravityBefore)) {
						throw new Error("Unable to restore gravity.");
					}
				},
			]);
		});
	});

	LogResult("studio/cache live hitbox", () => {
		const flHitboxAdjustment = 0.125;
		const ModelTable = STRING_TABLES.Find("modelprecache");
		if (ModelTable === null) {
			throw new Error("The modelprecache string table is not available.");
		}

		const vecReferences = [];
		let Model = null;
		let Header = null;
		let HitboxSet = null;
		let Hitbox = null;

		return UseResources("studio cache example", vecReferences, () => {
			for (const strModelPath of ModelTable.GetValues()) {
				if (!strModelPath.toLowerCase().endsWith(".mdl")) {
					continue;
				}

				const CandidateModel = FindModel(strModelPath);
				const hCandidateModel = CandidateModel.Handle;
				if (hCandidateModel === INVALID_MODEL_HANDLE) {
					continue;
				}

				let bReleaseAttempted = false;
				const Reference = TrackResource(() => {
					if (bReleaseAttempted) {
						return;
					}

					bReleaseAttempted = true;

					if (Model === CandidateModel) {
						Model = null;
						Header = null;
						HitboxSet = null;
						Hitbox = null;
					}

					try {
						// The native count/result is SDK-specific. A throwing call has an unknown outcome and must not be retried.
						Release(hCandidateModel);
					} catch (CleanupError) {
						const Failure = new AggregateError([CleanupError], "Model release outcome is unknown.");
						Failure.ModelHandle = hCandidateModel;
						Failure.UnconfirmedReleaseCount = 1;
						throw Failure;
					}
				});
				vecReferences.push(Reference);

				if (!CandidateModel.IsValid()) {
					ReleaseResource(Reference);
					continue;
				}

				const CandidateHeader = GetModelHeader(hCandidateModel);
				const CandidateHitboxSet = (CandidateHeader === null) ? null : CandidateHeader.GetHitboxSet(0);
				const CandidateHitbox = (CandidateHitboxSet === null) ? null : CandidateHitboxSet.GetHitbox(0);
				if ((CandidateHeader !== null) && (CandidateHitboxSet !== null) && (CandidateHitbox !== null)) {
					Model = CandidateModel;
					Header = CandidateHeader;
					HitboxSet = CandidateHitboxSet;
					Hitbox = CandidateHitbox;
					break;
				}

				ReleaseResource(Reference);
			}

			if ((Model === null) || (Header === null) || (HitboxSet === null) || (Hitbox === null)) {
				throw new Error("No precached studio model with a hitbox was found.");
			}

			let MinimumsBefore = null;
			let MaximumsBefore = null;

			return UseCleanup("studio hitbox example", () => {
				MinimumsBefore = { X: Hitbox.Mins.X, Y: Hitbox.Mins.Y, Z: Hitbox.Mins.Z };
				MaximumsBefore = { X: Hitbox.Maxs.X, Y: Hitbox.Maxs.Y, Z: Hitbox.Maxs.Z };
				Hitbox.Mins.X = MinimumsBefore.X - flHitboxAdjustment;
				Hitbox.Maxs.X = MaximumsBefore.X + flHitboxAdjustment;

				const HeaderHitbox = Header.GetHitbox(0, 0);
				if (HeaderHitbox === null) {
					throw new Error("The selected hitbox cannot be resolved through the model header.");
				}

				return {
					After: {
						Maximums: { X: Hitbox.Maxs.X, Y: Hitbox.Maxs.Y, Z: Hitbox.Maxs.Z },
						Minimums: { X: Hitbox.Mins.X, Y: Hitbox.Mins.Y, Z: Hitbox.Mins.Z },
					},
					Before: { Maximums: MaximumsBefore, Minimums: MinimumsBefore },
					Handle: Model.Handle,
					Header: { HitboxSetCount: Header.HitboxSetCount, Name: Header.Name, Address: Header.Address },
					Hitbox: { Bone: Hitbox.Bone, Group: Hitbox.Group, Name: Hitbox.Name, Address: Hitbox.Address },
					HitboxSet: { HitboxCount: HitboxSet.HitboxCount, Name: HitboxSet.Name, Address: HitboxSet.Address },
					InvalidModelHandle: INVALID_MODEL_HANDLE,
					Model: { Name: Model.GetName(), Valid: Model.IsValid() },
					RenderFlag: StudioFlags.Render,
					SameAddress: HeaderHitbox.Address === Hitbox.Address,
				};
			}, () => {
				// Attempt both restorations before releasing the reference; never retain borrowed views for unload.
				RunCleanupActions("hitbox restoration", [
					() => {
						if (MinimumsBefore !== null) {
							Hitbox.Mins.X = MinimumsBefore.X;
						}
					},
					() => {
						if (MaximumsBefore !== null) {
							Hitbox.Maxs.X = MaximumsBefore.X;
						}
					},
				]);
			});
		});
	});
}

function ShowToPlayer(strPlayerIndex) {
	const unMaximumPlayerIndex = 2147483647;
	const unShowMenuValidSlotBits = 0x3FF;
	const unPlayerIndex = Number(strPlayerIndex);
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex < 1) || (unPlayerIndex > unMaximumPlayerIndex)) {
		LogWarning(`Use "${g_strCommandName} show <unPlayerIndex>".`);
		return false;
	}

	const PlayerInstance = Player(unPlayerIndex);
	if ((PlayerInstance === null) || !PlayerInstance.IsConnected() || PlayerInstance.IsFakeClient()) {
		LogWarning(`Player ${unPlayerIndex} is not a connected human client.`);
		return false;
	}

	const { HUD_DESTINATION } = GetBaseMessageConstants();

	const bChatResult = LogResult("messages.SayText.SendUserMessage", () => new SayText("SayText chat example.", { Chat: true, SenderIndex: unPlayerIndex }).SendUserMessage(unPlayerIndex));
	const bColoredResult = LogResult("messages.SayText2.SendUserMessage", () => new SayText2(ColorizeMessageText("Colored SayText2 chat example."), { Chat: true, SenderIndex: unPlayerIndex }).SendUserMessage(unPlayerIndex));
	const bHintResult = LogResult("messages.HintText.SendUserMessage", () => new HintText("HintText user message example.").SendUserMessage(unPlayerIndex));
	const bTextMessageResult = LogResult("messages.HUDTextMessage.SendUserMessage", () => new HUDTextMessage("TextMsg center example.", { Destination: HUD_DESTINATION.CENTER }).SendUserMessage(unPlayerIndex));
	const bKeyHintResult = LogResult("messages.KeyHintText.SendUserMessage", () => new KeyHintText(["SourceJS", "KeyHintText example"]).SendUserMessage(unPlayerIndex));
	const bShowMenuResult = LogResult("messages.ShowMenu.SendUserMessage", () => new ShowMenu("SourceJS\n\n1. User message example\n0. Close", unShowMenuValidSlotBits, 10).SendUserMessage(unPlayerIndex));
	const bDialogTextResult = LogResult("messages/dialog DialogText.SendMessage", () => new DialogText("SourceJS API", "DialogText example", { Time: 10 }).SendMessage(unPlayerIndex));
	const bDialogNotificationResult = LogResult("messages/dialog DialogNotification.SendMessage", () => new DialogNotification("SourceJS dialog notification example", { Time: 5 }).SendMessage(unPlayerIndex));

	const bDirectUserMessageResult = LogResult("messages.UserMessage.SendUserMessage", () => new UserMessage("HintText", [{ Type: "string", Value: "Direct UserMessage HintText." }]).SendUserMessage(unPlayerIndex));

	const bConsoleResult = LogResult("messages.SendClientConsoleMessageToRecipients", () => SendClientConsoleMessageToRecipients([unPlayerIndex], "messages.SendClientConsoleMessageToRecipients console example.\n"));
	const bDialogResult = LogResult("menus.ShowText", () => ShowText(unPlayerIndex, "SourceJS API", "menus.ShowText dialog example", 10));
	const Results = {
		Chat: bChatResult,
		Colored: bColoredResult,
		Console: bConsoleResult,
		Dialog: bDialogResult,
		DialogNotification: bDialogNotificationResult,
		DialogText: bDialogTextResult,
		Hint: bHintResult,
		KeyHint: bKeyHintResult,
		ShowMenu: bShowMenuResult,
		TextMessage: bTextMessageResult,
		UserMessage: bDirectUserMessageResult,
	};
	LogInfo("%s", `show ${unPlayerIndex}: ${SummarizeValue(Results)}`);

	return Results;
}

function HandleDownload(vecCommandArguments) {
	if (!["add", "add-directory", "remove-directory"].includes(vecCommandArguments[1]) || (vecCommandArguments[vecCommandArguments.length - 1] !== "confirm")) {
		LogWarning(`Use "${g_strCommandName} download add <path> confirm".`);
		LogWarning(`Or "${g_strCommandName} download add-directory <path> confirm".`);
		LogWarning(`Or "${g_strCommandName} download remove-directory <path> confirm".`);
		return false;
	}

	const strPath = vecCommandArguments.slice(2, -1).join(" ");
	if (strPath.length === 0) {
		LogWarning("Download path must not be empty.");
		return false;
	}

	if (vecCommandArguments[1] === "add") {
		return LogResult("stringtables.AddDownloadable", () => AddDownloadable(strPath));
	}

	if (vecCommandArguments[1] === "add-directory") {
		return LogResult("stringtables.AddDownloadableDirectory", () => AddDownloadableDirectory(strPath));
	}

	return LogResult("stringtables.UntrackDownloadableDirectory", () => UntrackDownloadableDirectory(strPath));
}

function RunUIExample(Command) {
	if (g_bUnloading) {
		return false;
	}

	const vecCommandArguments = GetCommandArguments(Command);
	if (vecCommandArguments[0] === "show") {
		if (vecCommandArguments.length !== 2) {
			LogWarning(`Use "${g_strCommandName} show <unPlayerIndex>".`);
			return false;
		}

		return ShowToPlayer(vecCommandArguments[1]);
	}

	if (vecCommandArguments[0] === "download") {
		return HandleDownload(vecCommandArguments);
	}

	if (vecCommandArguments[0] === "inspect") {
		if (vecCommandArguments.length !== 1) {
			LogWarning(`Use "${g_strCommandName} inspect".`);
			return false;
		}

		// The demo reuses temporary setting registration names across inspections.
		if (g_unPendingExampleCount !== 0) {
			LogWarning("The previous UI/data inspection is still running.");
			return false;
		}

		InspectUIAndData();
		return true;
	}

	LogInfo(`Use "${g_strCommandName} show <unPlayerIndex>" to send messages and menus.`);
	LogInfo(`Use "${g_strCommandName} inspect" after a map has loaded for map-dependent APIs.`);

	return false;
}

function RunClientUIExample(Command) {
	RunUIExample(Command);

	return false;
}

function Cleanup() {
	g_bUnloading = true;

	const vecCleanupErrors = [];
	try {
		ReleaseResources("UI example resources", [...g_setPendingResources]);
	} catch (CleanupError) {
		vecCleanupErrors.push(CleanupError);
	}

	try {
		if (g_bSourceCommandRegistered) {
			if (!g_UnregisterSourceCommand(g_strCommandName, RunUIExample)) {
				throw new Error(`Unable to unregister the ${g_strCommandName} command.`);
			}

			g_bSourceCommandRegistered = false;
		}
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	try {
		if (g_bClientCommandRegistered) {
			if (!g_UnregisterClientCommand(g_strCommandName, RunClientUIExample)) {
				throw new Error(`Unable to unregister the client ${g_strCommandName} command.`);
			}

			g_bClientCommandRegistered = false;
		}
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	try {
		if (g_PluginUnloadingRegistration) {
			if (!g_PluginUnloadingRegistration.DisposeListener()) {
				throw new Error("Unable to dispose the UI example plugin-unloading listener.");
			}

			g_PluginUnloadingRegistration = null;
		}
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	if (vecCleanupErrors.length > 0) {
		throw new AggregateError(vecCleanupErrors, "UI example cleanup failed.");
	}

	return true;
}

function HandlePluginUnloading(strUnloadingPluginName) {
	if (strUnloadingPluginName === g_strPluginName) {
		Cleanup();
	}
}

exports.Unload = Cleanup;

try {
	if (!g_RegisterSourceCommand(g_strCommandName, RunUIExample)) {
		throw new Error(`Unable to register the ${g_strCommandName} command.`);
	}

	g_bSourceCommandRegistered = true;

	if (!g_RegisterClientCommand(g_strCommandName, RunClientUIExample)) {
		throw new Error(`Unable to register the client ${g_strCommandName} command.`);
	}

	g_bClientCommandRegistered = true;
	g_PluginUnloadingRegistration = RegisterPluginUnloadingListener(HandlePluginUnloading);
	if (!g_PluginUnloadingRegistration) {
		throw new Error("Unable to register the plugin-unloading listener.");
	}

	LogInfo(`UI/data example loaded; run "${g_strCommandName}".`);
} catch (ErrorValue) {
	try {
		Cleanup();
	} catch (CleanupError) {
		throw new AggregateError([ErrorValue, CleanupError], "UI example registration and rollback failed.");
	}

	throw ErrorValue;
}
