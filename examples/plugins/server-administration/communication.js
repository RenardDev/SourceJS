"use strict";

const { BLOCK, CONTINUE } = require("commands");
const { SendCommand } = require("commands/client");
const { Tokenizer } = require("core");
const { LogInfo, LogWarning } = require("core/logger");
const { CreateConVar } = require("cvars");
const { EmitSound, IsSoundPrecached, PrecacheSound, SOUND_FROM_LOCAL_PLAYER } = require("engines/sound");
const { DoesFileExist } = require("filesystem");
const { GetAllPlayers } = require("filters/players");
const { TickDelay } = require("listeners/tick");
const { SimpleESCMenu } = require("menus/esc");
const { GetPlayerMenuQueue } = require("menus/queue");
const { SimpleRadioMenu } = require("menus/radio");
const { GetUserMessageIndex, HUDMessage, HUDTextMessage, HintText, SayText, SayText2, SendUserMessageValue } = require("messages");
const { DialogNotification } = require("messages/dialog");
const { GetUserIDFromIndex } = require("players/helpers");
const { MuteManager } = require("players/voice");
const { CommandFailure, CommandUsage, GetFailureMessage, LocalizedLabel, Phrase, RenderPhrase, Translate } = require("./translations");
const { DefineCommand, HasPermission, ReadChatText, Reply, RequireCurrentPlayer, RequireTargets } = require("./administration");
const { AllowsAdminSounds } = require("./client-preferences");
const { PlayMenuSound } = require("./menu-sounds");

const g_mapGaggedPlayers = new Map();
const g_mapMutedPlayers = new Map();
const g_mapAnnouncementPanels = new Map();
const g_MuteManager = new MuteManager();
const g_unAnnouncementSeconds = 10;
const g_ActivityFlags = Object.freeze({ Public: 0x01, PublicNames: 0x02, Administrators: 0x04, AdministratorNames: 0x08, AlwaysShowNames: 0x10 });
const g_HUDAnnouncementColor = Object.freeze({ Red: 0, Green: 255, Blue: 127, Alpha: 255 });
const g_mapNotificationColors = new Map([
	["white", [255, 255, 255]],
	["red", [255, 0, 0]],
	["green", [0, 255, 0]],
	["blue", [0, 0, 255]],
	["yellow", [255, 255, 0]],
	["purple", [255, 0, 255]],
	["cyan", [0, 255, 255]],
	["orange", [255, 128, 0]],
	["pink", [255, 0, 128]],
	["olive", [128, 255, 0]],
	["lime", [0, 255, 128]],
	["violet", [128, 0, 255]],
	["lightblue", [0, 128, 255]],
]);
let g_AdminChatMode = null;
let g_ShowActivity = null;

function GetHumanIndexes() {
	return GetAllPlayers().filter((Target) => Target.Connected && !Target.FakeClient).map((Target) => Target.Index);
}

function SendMessage(vecRecipients, Message) {
	if ((vecRecipients.length > 0) && !SendUserMessageValue(vecRecipients, Message)) {
		throw CommandFailure("MessageUnavailable", "The selected game could not display this message.");
	}
}

function CreateChatMessage(strMessage) {
	const ChatMessage = (GetUserMessageIndex("SayText") >= 0) ? SayText : SayText2;

	return new ChatMessage(strMessage, { Chat: true });
}

function SendLocalizedMessage(vecRecipientIndexes, Render, CreateMessage, Send = SendMessage) {
	const mapRecipientsByMessage = new Map();

	for (const unIndex of vecRecipientIndexes) {
		const strMessage = Render(unIndex);
		if (!mapRecipientsByMessage.has(strMessage)) {
			mapRecipientsByMessage.set(strMessage, []);
		}

		mapRecipientsByMessage.get(strMessage).push(unIndex);
	}

	const vecFailures = [];

	for (const [strMessage, vecRecipients] of mapRecipientsByMessage) {
		try {
			Send(vecRecipients, CreateMessage(strMessage));
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw vecFailures[0];
	}
}

function Broadcast(Message, unExcludedIndex = 0) {
	SendLocalizedMessage(GetHumanIndexes().filter((unIndex) => unIndex !== unExcludedIndex), (unIndex) => RenderPhrase(unIndex, Message), (strMessage) => CreateChatMessage(`[SourceJS] ${strMessage}`));
}

function RequireMessage(vecArguments) {
	const strMessage = vecArguments.join(" ").trim();
	if (!strMessage || /[\x00-\x1F\x7F]/.test(strMessage)) {
		throw CommandFailure("SingleLineRequired", "A single-line message is required.");
	}

	return strMessage;
}

function FilterGaggedChat(Invocation) {
	const unClientIndex = Invocation.Index;
	const unGaggedUserID = g_mapGaggedPlayers.get(unClientIndex);
	if ((unGaggedUserID !== undefined) && (GetUserIDFromIndex(unClientIndex) === unGaggedUserID)) {
		return BLOCK;
	}

	return CONTINUE;
}

function HandleCommunicationDisconnect(unClientIndex) {
	g_mapGaggedPlayers.delete(unClientIndex);
	g_mapMutedPlayers.delete(unClientIndex);
}

function ReapplyCommunicationMutes(unClientIndex = null) {
	if (g_mapMutedPlayers.size === 0) {
		return;
	}

	const vecPlayers = GetAllPlayers().filter((Player) => Player.Connected && !Player.FakeClient);
	const vecReceivers = (unClientIndex === null) ? vecPlayers : vecPlayers.filter((Player) => Player.Index === unClientIndex);

	for (const Target of vecPlayers) {
		if (g_mapMutedPlayers.get(Target.Index) !== Target.UserID) {
			continue;
		}

		for (const Receiver of vecReceivers) {
			if ((Receiver.Index === Target.Index) || (GetUserIDFromIndex(Target.Index) !== Target.UserID) || (GetUserIDFromIndex(Receiver.Index) !== Receiver.UserID)) {
				continue;
			}

			try {
				if (!g_MuteManager.MutePlayer(Target.Index, [Receiver.Index])) {
					throw new Error("Voice backend rejected the mute.");
				}
			} catch (Failure) {
				LogWarning(`Could not reapply voice mute for #${Target.UserID} and listener #${Receiver.UserID}: ${Failure?.message ?? "unknown error"}`);
			}
		}
	}
}

function ResetCommunication() {
	g_mapGaggedPlayers.clear();
	g_mapMutedPlayers.clear();
	g_MuteManager.Unload();
}

function CloseAnnouncementPanel(Menu) {
	const Delay = g_mapAnnouncementPanels.get(Menu);
	g_mapAnnouncementPanels.delete(Menu);
	Delay?.DisposeTickDelay();
	Menu.CloseMenu();
}

function ClearAnnouncementPanels() {
	const vecFailures = [];

	for (const Menu of g_mapAnnouncementPanels.keys()) {
		try {
			CloseAnnouncementPanel(Menu);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Could not close all announcement panels.");
	}
}

function GetCommunicationState(Player) {
	return { Gagged: g_mapGaggedPlayers.get(Player.Index) === Player.UserID, Muted: g_mapMutedPlayers.get(Player.Index) === Player.UserID };
}

function CreateCommunicationCommand(strName, bUpdateChat, bUpdateVoice, bSuppress) {
	return function UpdateCommunication(unClientIndex, vecArguments) {
		if (vecArguments.length !== 1) {
			throw CommandUsage(`sjs_${strName} <target>.`);
		}

		const vecTargets = RequireTargets(unClientIndex, vecArguments[0], true, true, (Player) => Player.Connected && !Player.FakeClient);
		const vecReceivers = bUpdateVoice ? GetHumanIndexes() : [];
		let unChanged = 0;

		for (const Target of vecTargets) {
			RequireCurrentPlayer(Target);
			const State = GetCommunicationState(Target);
			const bChangeVoice = bUpdateVoice && (State.Muted !== bSuppress);
			const bChangeChat = bUpdateChat && (State.Gagged !== bSuppress);
			if (bChangeVoice) {
				if (bSuppress) {
					if (!g_MuteManager.MutePlayer(Target.Index, vecReceivers.filter((unReceiverIndex) => unReceiverIndex !== Target.Index))) {
						throw CommandFailure("CommandFailed", `Could not mute ${Target.Name}.`);
					}

					g_mapMutedPlayers.set(Target.Index, Target.UserID);
				} else {
					if (!g_MuteManager.UnmutePlayer(Target.Index)) {
						throw CommandFailure("CommandFailed", `Could not unmute ${Target.Name}.`);
					}

					g_mapMutedPlayers.delete(Target.Index);
				}
			}

			if (bChangeChat) {
				if (bSuppress) {
					g_mapGaggedPlayers.set(Target.Index, Target.UserID);
				} else {
					g_mapGaggedPlayers.delete(Target.Index);
				}
			}

			if (bChangeVoice || bChangeChat) {
				++unChanged;
				LogInfo(`Communication: Action=${strName} ClientIndex=${unClientIndex} TargetUserID=${Target.UserID}`);
			}
		}

		return Phrase("ActionCount", "Updated communication for {Count} of {Total} player(s).", { Count: unChanged, Total: vecTargets.length });
	};
}

function GetMessageAuthor(unClientIndex) {
	if (unClientIndex === 0) {
		return LocalizedLabel("Console", "Console");
	}

	return GetAllPlayers().find((Player) => Player.Index === unClientIndex)?.Name ?? LocalizedLabel("Admin", "Admin");
}

function GetAnnouncementRecipients(unClientIndex, Author = GetMessageAuthor(unClientIndex), bAdminActivity = false) {
	const vecRecipients = GetHumanIndexes();
	const unFlags = Number(g_ShowActivity.Value);
	const unPublicNameFlags = g_ActivityFlags.Public | g_ActivityFlags.PublicNames;
	const unAdminNameFlags = g_ActivityFlags.Administrators | g_ActivityFlags.AdministratorNames;
	const vecNamed = [];
	const vecAnonymous = [];

	for (const unRecipientIndex of vecRecipients) {
		const bNameOverride = ((unFlags & g_ActivityFlags.AlwaysShowNames) !== 0) && HasPermission(unRecipientIndex, "activity.seenames");
		const bAdministrator = HasPermission(unRecipientIndex, "admin") || HasPermission(unRecipientIndex, "chat");
		const unAudienceFlag = bAdministrator ? g_ActivityFlags.Administrators : g_ActivityFlags.Public;
		if (bAdminActivity && ((unRecipientIndex === unClientIndex) || (!bNameOverride && ((unFlags & unAudienceFlag) === 0)))) {
			continue;
		}

		const bAlwaysReveal = (unClientIndex === 0) || (unRecipientIndex === unClientIndex) || bNameOverride;
		const unNameFlags = bAdministrator ? unAdminNameFlags : unPublicNameFlags;
		const bRevealName = bAlwaysReveal || ((unFlags & unNameFlags) === unNameFlags);
		const vecGroup = bRevealName ? vecNamed : vecAnonymous;
		vecGroup.push(unRecipientIndex);
	}

	return [[Author, vecNamed], [LocalizedLabel("Admin", "Admin"), vecAnonymous]].filter(([, vecGroup]) => vecGroup.length > 0);
}

function ReportAdminActivity(unClientIndex, Author, Message) {
	try {
		for (const [VisibleAuthor, vecRecipients] of GetAnnouncementRecipients(unClientIndex, Author, true)) {
			try {
				SendLocalizedMessage(vecRecipients, (unIndex) => `[SourceJS] ${RenderPhrase(unIndex, VisibleAuthor)}: ${RenderPhrase(unIndex, Message)}`, CreateChatMessage);
			} catch (Failure) {
				LogWarning(`Could not deliver administrator activity: ${Failure?.message ?? "unknown error"}`);
			}
		}
	} catch (Failure) {
		LogWarning(`Could not announce administrator activity: ${Failure?.message ?? "unknown error"}`);
	}
}

function SendPrivateMessage(unClientIndex, vecArguments) {
	const [Target] = RequireTargets(unClientIndex, vecArguments[0], false, false);
	const CurrentPlayer = RequireCurrentPlayer(Target);
	if (CurrentPlayer.FakeClient) {
		throw CommandFailure("HumanTargetRequired", "Private messages require a connected human player.");
	}

	const strMessage = RequireMessage(vecArguments.slice(1));
	const Author = GetMessageAuthor(unClientIndex);
	const Render = (unIndex) => `[${Translate(unIndex, "PrivateTo", "Private to {Player}", { Player: Target.Name })}] ${RenderPhrase(unIndex, Author)}: ${strMessage}`;
	const vecRecipients = ((unClientIndex === 0) || (unClientIndex === Target.Index)) ? [Target.Index] : [Target.Index, unClientIndex];
	SendLocalizedMessage(vecRecipients, Render, CreateChatMessage);

	return (unClientIndex === 0) ? Render : undefined;
}

function SendAdminChat(unClientIndex, vecArguments) {
	const strMessage = RequireMessage(vecArguments);
	const bFromAdmin = HasPermission(unClientIndex, "chat");
	const vecRecipients = GetHumanIndexes().filter((unIndex) => (unIndex === unClientIndex) || HasPermission(unIndex, "chat"));
	const Author = GetMessageAuthor(unClientIndex);
	SendLocalizedMessage(vecRecipients, (unIndex) => `[${Translate(unIndex, bFromAdmin ? "Admins" : "ToAdmins", bFromAdmin ? "Admins" : "To admins")}] ${RenderPhrase(unIndex, Author)}: ${strMessage}`, CreateChatMessage);
}

function SendPublicChat(unClientIndex, vecArguments) {
	const strMessage = RequireMessage(vecArguments);
	for (const [Author, vecRecipients] of GetAnnouncementRecipients(unClientIndex)) {
		SendLocalizedMessage(vecRecipients, (unIndex) => `[SourceJS] ${RenderPhrase(unIndex, Author)}: ${strMessage}`, CreateChatMessage);
	}
}

function SendCenterAnnouncement(unClientIndex, vecArguments) {
	const strMessage = RequireMessage(vecArguments);
	for (const [Author, vecRecipients] of GetAnnouncementRecipients(unClientIndex)) {
		SendLocalizedMessage(vecRecipients, (unIndex) => `${RenderPhrase(unIndex, Author)}: ${strMessage}`, (strText) => new HUDTextMessage(strText));
	}
}

function FilterAdminChatShortcut(Invocation) {
	const strText = ReadChatText(Invocation);
	if (!strText.startsWith("@")) {
		return CONTINUE;
	}

	const unClientIndex = Invocation.Index;
	const bCanUseAdminChat = HasPermission(unClientIndex, "chat");

	try {
		if (Invocation.TeamOnly) {
			if (!bCanUseAdminChat && (Number(g_AdminChatMode.Value) === 0)) {
				throw CommandFailure("AdminChatDisabled", "Player messages to administrators are disabled.");
			}

			SendAdminChat(unClientIndex, [strText.slice(1)]);
			return BLOCK;
		}

		const bCenter = strText.startsWith("@@@");
		const bPrivate = !bCenter && strText.startsWith("@@");
		if (!bCanUseAdminChat) {
			if (!bPrivate) {
				return CONTINUE;
			}

			throw CommandFailure("RequiresPermission", "Private messages require {Permission}.", { Permission: "sourcejs.chat" });
		}

		if (bPrivate) {
			SendPrivateMessage(unClientIndex, [...new Tokenizer(strText.slice(2))]);

		} else if (bCenter) {
			SendCenterAnnouncement(unClientIndex, [strText.slice(3)]);

		} else {
			SendPublicChat(unClientIndex, [strText.slice(1)]);
		}
	} catch (Failure) {
		Reply(unClientIndex, GetFailureMessage(Failure, Phrase("MessageUnavailable", "The chat message could not be sent.")), true);
	}

	return BLOCK;
}

function SendHUDAnnouncement(unClientIndex, vecArguments) {
	const strMessage = RequireMessage(vecArguments);
	if ((typeof HUDMessage !== "function") || (GetUserMessageIndex("HudMsg") < 0)) {
		throw CommandFailure("MessageUnavailable", "The selected game does not expose HudMsg.");
	}

	for (const [Author, vecRecipients] of GetAnnouncementRecipients(unClientIndex)) {
		SendLocalizedMessage(vecRecipients, (unIndex) => `${RenderPhrase(unIndex, Author)}: ${strMessage}`, (strText) => new HUDMessage(strText, { X: -1, Y: 0.25, HoldTime: 3, PrimaryColor: g_HUDAnnouncementColor, Effect: 1 }));
	}
}

function SendHintAnnouncement(unClientIndex, vecArguments) {
	const strMessage = RequireMessage(vecArguments);
	if (GetUserMessageIndex("HintText") < 0) {
		throw CommandFailure("MessageUnavailable", "The selected game does not expose HintText.");
	}

	for (const [Author, vecRecipients] of GetAnnouncementRecipients(unClientIndex)) {
		SendLocalizedMessage(vecRecipients, (unIndex) => `${RenderPhrase(unIndex, Author)}: ${strMessage}`, (strText) => new HintText(strText));
	}
}

function SendTopLeftAnnouncement(unClientIndex, vecArguments) {
	const vecColor = g_mapNotificationColors.get(vecArguments[0]?.toLowerCase());
	const strMessage = RequireMessage(vecColor ? vecArguments.slice(1) : vecArguments);
	const [unRed, unGreen, unBlue] = vecColor ?? g_mapNotificationColors.get("white");
	const Color = { Red: unRed, Green: unGreen, Blue: unBlue, Alpha: 255 };

	for (const [Author, vecRecipients] of GetAnnouncementRecipients(unClientIndex)) {
		SendLocalizedMessage(vecRecipients, (unIndex) => `${RenderPhrase(unIndex, Author)}: ${strMessage}`, (strText) => new DialogNotification(strText, { Color, Time: g_unAnnouncementSeconds }), (vecTargetIndexes, Message) => {
			if (!Message.SendMessage(vecTargetIndexes)) {
				throw CommandFailure("MessageUnavailable", "The selected game could not display the top-left notification.");
			}
		});
	}
}

function SendAnnouncementPanel(Author, strMessage, vecRecipients) {
	const Options = { Title: (unIndex) => `${RenderPhrase(unIndex, Author)}:`, Description: strMessage, Timeout: g_unAnnouncementSeconds, CloseText: (unClientIndex) => Translate(unClientIndex, "Close", "Dismiss"), Fill: false, InteractionCallback: PlayMenuSound };
	const Menu = (GetUserMessageIndex("ShowMenu") >= 0) ? new SimpleRadioMenu(Options) : new SimpleESCMenu(Options);
	Menu.UseTextDialogFallback = false;
	let unDeliveredCount = 0;

	try {
		for (const unRecipientIndex of vecRecipients) {
			try {
				if (GetPlayerMenuQueue(unRecipientIndex).SendMenu(Menu)) {
					++unDeliveredCount;
					continue;
				}
			} catch {
				// One client failing to open a panel must not stop delivery to the others.
			}

			try {
				Menu.CloseMenu(unRecipientIndex);
			} catch {
				LogWarning(`Could not clean up an undelivered announcement panel for client ${unRecipientIndex}.`);
			}
		}

		if (unDeliveredCount === 0) {
			throw CommandFailure("MessageUnavailable", "The selected game could not display the announcement panel.");
		}

		const Delay = new TickDelay(g_unAnnouncementSeconds, () => CloseAnnouncementPanel(Menu), [], true);
		g_mapAnnouncementPanels.set(Menu, Delay);
	} catch (Failure) {
		try {
			CloseAnnouncementPanel(Menu);
		} catch (CleanupFailure) {
			throw new AggregateError([Failure, CleanupFailure], "Announcement panel delivery and cleanup failed.");
		}

		throw Failure;
	}

	return unDeliveredCount;
}

function SendPanelAnnouncement(unClientIndex, vecArguments) {
	const strMessage = RequireMessage(vecArguments).replaceAll("\\n", "\n");
	const vecRecipients = GetHumanIndexes();
	if (vecRecipients.length === 0) {
		return Phrase("NoEligiblePlayers", "No connected human players to receive the announcement panel.");
	}

	const unDeliveredCount = SendAnnouncementPanel(GetMessageAuthor(unClientIndex), strMessage, vecRecipients);

	return (unDeliveredCount < vecRecipients.length) ? Phrase("ActionCount", "Opened the announcement panel for {Count} of {Total} player(s).", { Count: unDeliveredCount, Total: vecRecipients.length }) : undefined;
}

function PlayAdminSound(unClientIndex, vecArguments) {
	const unMaximumSoundEventLength = 255;

	if (vecArguments.length !== 2) {
		throw CommandUsage("sjs_play <target> <sound file or event>.");
	}

	const [strTarget, strPath] = vecArguments;
	const strSample = strPath.replaceAll("\\", "/").replace(/^sound\//i, "");
	const bFile = /^(?:[a-z0-9_-]+(?: [a-z0-9_-]+)*\/)*[a-z0-9_-]+(?: [a-z0-9_-]+)*\.(wav|mp3)$/i.test(strSample);
	const bSoundEvent = !/\.(wav|mp3)$/i.test(strPath) && /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i.test(strPath) && (strPath.length <= unMaximumSoundEventLength);
	if (!bFile && !bSoundEvent) {
		throw CommandFailure("InvalidInput", "Specify a relative .wav or .mp3 path within the sound directory, or a sound event name.");
	}

	if (bFile && !DoesFileExist(`sound/${strSample}`)) {
		throw CommandFailure("SoundNotFound", "The server could not find that sound file.");
	}

	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Target) => Target.Connected && !Target.FakeClient);
	const vecRecipientTargets = vecTargets.filter((Target) => AllowsAdminSounds(Target.NetworkID));
	if (vecRecipientTargets.length === 0) {
		throw CommandFailure("NoSoundRecipients", "No human recipients have admin sounds enabled.");
	}

	const nUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Author = GetMessageAuthor(unClientIndex);

	if (bFile && !IsSoundPrecached(strSample) && !PrecacheSound(strSample, false, true)) {
		throw CommandFailure("SoundRejected", "The engine did not accept the sound.");
	}

	let unSubmittedCount = 0;

	for (const Target of vecRecipientTargets) {
		if (((unClientIndex !== 0) && (GetUserIDFromIndex(unClientIndex) !== nUserID)) || !HasPermission(unClientIndex, "admin")) {
			break;
		}

		try {
			const Player = RequireCurrentPlayer(Target);
			if (Player.FakeClient || !AllowsAdminSounds(Player.NetworkID) || ((Player.Index !== unClientIndex) && HasPermission(Player.Index, "immunity") && !HasPermission(unClientIndex, "targetimmune"))) {
				continue;
			}

			const bSubmitted = bFile
				? EmitSound({ Entity: SOUND_FROM_LOCAL_PLAYER, Sample: strSample, Recipients: [Player.Index], Reliable: true })
				: SendCommand(Player.Index, `playgamesound "${strPath}"`, false);
			if (bSubmitted) {
				++unSubmittedCount;
			}
		} catch (Failure) {
			LogWarning(`Could not submit admin sound for #${Target.UserID}: ${Failure?.message ?? "unknown error"}`);
		}
	}

	if (unSubmittedCount === 0) {
		throw CommandFailure("SoundRejected", "The engine did not accept the sound.");
	}

	LogInfo(`PlayAdminSound: UserID=${nUserID} Sample=${strSample} Recipients=${unSubmittedCount}`);
	const strRecipientCount = `${unSubmittedCount} ${(unSubmittedCount === 1) ? "player" : "players"}`;
	ReportAdminActivity(unClientIndex, Author, (unIndex) => {
		const strFallback = `Submitted a sound to ${strRecipientCount}.`;
		const strLocalized = Translate(unIndex, "SoundSubmitted", "Sound submitted to {Count} player(s).", { Count: unSubmittedCount });

		return (strLocalized === `Sound submitted to ${unSubmittedCount} player(s).`) ? strFallback : strLocalized;
	});

	return (unSubmittedCount === vecRecipientTargets.length) ? Phrase("SoundSubmitted", "Sound submitted to {Count} player(s).", { Count: unSubmittedCount }) : Phrase("ActionCount", "Sound submitted to {Count} of {Total} eligible player(s).", { Count: unSubmittedCount, Total: vecRecipientTargets.length });
}

function RegisterCommunicationCommands() {
	g_AdminChatMode = CreateConVar("sjs_chat_mode", "1", "Allow players to contact administrators with @ in team chat.", 0, 0, 1);
	g_ShowActivity = CreateConVar("sjs_show_activity", "13", "Name visibility flags for administrator announcements.", 0, 0, 0x1F);

	DefineCommand("gag", "chat", "<target>", CreateCommunicationCommand("gag", true, false, true));
	DefineCommand("ungag", "chat", "<target>", CreateCommunicationCommand("ungag", true, false, false));
	DefineCommand("mute", "chat", "<target>", CreateCommunicationCommand("mute", false, true, true));
	DefineCommand("unmute", "chat", "<target>", CreateCommunicationCommand("unmute", false, true, false));
	DefineCommand("silence", "chat", "<target>", CreateCommunicationCommand("silence", true, true, true));
	DefineCommand("unsilence", "chat", "<target>", CreateCommunicationCommand("unsilence", true, true, false));
	DefineCommand("say", "chat", "<message>", SendPublicChat);
	DefineCommand("chat", "chat", "<message>", SendAdminChat);
	DefineCommand("csay", "chat", "<message>", SendCenterAnnouncement);
	DefineCommand("dsay", "chat", "<message>", SendHUDAnnouncement);
	DefineCommand("hsay", "chat", "<message>", SendHintAnnouncement);
	DefineCommand("msay", "chat", "<message>", SendPanelAnnouncement);
	DefineCommand("tsay", "chat", "[color] <message>", SendTopLeftAnnouncement);
	DefineCommand("psay", "chat", "<target> <message>", SendPrivateMessage);
	DefineCommand("play", "admin", "<target> <sound file or event>", PlayAdminSound);
}

module.exports = {
	SendLocalizedMessage,
	Broadcast,
	FilterGaggedChat,
	HandleCommunicationDisconnect,
	ReapplyCommunicationMutes,
	ResetCommunication,
	ClearAnnouncementPanels,
	GetCommunicationState,
	GetMessageAuthor,
	ReportAdminActivity,
	FilterAdminChatShortcut,
	RegisterCommunicationCommands,
};
