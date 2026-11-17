"use strict";

const { PagedESCMenu, PagedESCOption } = require("menus/esc");
const { GetPlayerMenuQueue } = require("menus/queue");
const { PagedRadioMenu, PagedRadioOption } = require("menus/radio");
const { GetUserMessageIndex } = require("messages");
const { GetUserIDFromIndex } = require("players/helpers");
const { HasPermission, Reply } = require("./administration");
const { PlayMenuSound } = require("./menu-sounds");
const { CommandFailure, GetFailureMessage, Phrase, Translate } = require("./translations");

const MAXIMUM_VOTE_CHOICES = 5;
const g_unMapMenuTimeoutSeconds = 30;
const g_mapSessions = new Map();

function CloseMapMenu(unClientIndex) {
	const Session = g_mapSessions.get(unClientIndex);
	g_mapSessions.delete(unClientIndex);
	Session?.Menu?.CloseMenu(unClientIndex);
}

function CloseMapMenus() {
	const vecFailures = [];

	for (const unClientIndex of g_mapSessions.keys()) {
		try {
			CloseMapMenu(unClientIndex);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Could not close the administration map menus.");
	}
}

function CanUseMapMenu(unClientIndex, unUserID, Entry, GoBack) {
	if ((unUserID <= 0) || (GetUserIDFromIndex(unClientIndex) !== unUserID) || !HasPermission(unClientIndex, "map") || !HasPermission(unClientIndex, Entry.Permission)) {
		return false;
	}

	return (GoBack === null) ? Entry.Name === "map" : HasPermission(unClientIndex, "admin");
}

function ShowMapMenuPage(Session, bConfirm) {
	const { Entry, Index: unClientIndex, UserID: unUserID, ReadMaps, GoBack, SelectedMaps: vecSelectedMaps } = Session;
	const bVote = Entry.Name === "votemap";
	const vecMaps = ReadMaps();
	const vecOptions = [];

	if (bConfirm) {
		vecOptions.push({ Text: Translate(unClientIndex, "MapVote", "Start the vote"), Value: { Confirm: true } });
		vecOptions.push({ Text: Translate(unClientIndex, "Back", "Back to map choices"), Value: { Edit: true } });
	} else {
		if (bVote && (vecSelectedMaps.length > 0)) {
			vecOptions.push({ Text: Translate(unClientIndex, "ReviewVote", "Review vote ({Count})", { Count: vecSelectedMaps.length }), Value: { Review: true } });
		}

		if (!bVote || (vecSelectedMaps.length < MAXIMUM_VOTE_CHOICES)) {
			for (const strMap of vecMaps) {
				if (!vecSelectedMaps.includes(strMap)) {
					vecOptions.push({ Text: strMap, Value: { Map: strMap } });
				}
			}
		}
	}

	if (GoBack) {
		vecOptions.push({ Text: Translate(unClientIndex, "Back", "Back to actions"), Value: { Back: true } });
	}

	const strSelectedMaps = vecSelectedMaps.join(", ");
	const strTitle = bConfirm
		? Translate(unClientIndex, "ConfirmVote", "Confirm vote: {Maps}", { Maps: strSelectedMaps })
		: (bVote ? `${Translate(unClientIndex, "ChooseMap", "Select maps")} (${vecSelectedMaps.length}/${MAXIMUM_VOTE_CHOICES})` : Translate(unClientIndex, "ChooseMap", "Select a map"));
	const Options = {
		InteractionCallback(unReceiverIndex, strInteraction, Item) {
			if (unReceiverIndex === unClientIndex) {
				PlayMenuSound(unReceiverIndex, ((strInteraction === "Select") && (Item?.Value?.Back || Item?.Value?.Edit)) ? "ExitBack" : strInteraction);
			}
		},
		Title: strTitle,
		Description: Translate(unClientIndex, "SelectOption", bConfirm ? "Review your choices before starting the ballot." : (bVote ? "Add maps, then review the ballot." : "Choose a map from the server rotation.")),
		BackText: Translate(unClientIndex, "Previous", "Previous page"),
		NextText: Translate(unClientIndex, "Next", "Next page"),
		CloseText: Translate(unClientIndex, "Close", "Close map menu"),
		Fill: false,
		Timeout: g_unMapMenuTimeoutSeconds,
		SelectCallback(unReceiverIndex, Choice) {
			if ((unReceiverIndex !== unClientIndex) || (g_mapSessions.get(unClientIndex) !== Session)) {
				return;
			}

			g_mapSessions.delete(unClientIndex);

			if (!CanUseMapMenu(unClientIndex, unUserID, Entry, GoBack)) {
				return;
			}

			try {
				if (Choice.Back) {
					GoBack?.();
					return;
				}

				const vecCurrentMaps = ReadMaps();
				if (Choice.Review || Choice.Edit || (bVote && Choice.Map)) {
					if (Choice.Map && !vecCurrentMaps.includes(Choice.Map)) {
						throw CommandFailure("InvalidMap", "A selected map is no longer available in the map cycle.");
					}

					if (Choice.Map && !vecSelectedMaps.includes(Choice.Map) && (vecSelectedMaps.length < MAXIMUM_VOTE_CHOICES)) {
						vecSelectedMaps.push(Choice.Map);
					}

					const bReview = Choice.Review || (!Choice.Edit && (vecSelectedMaps.length === MAXIMUM_VOTE_CHOICES));
					ShowMapMenuPage({ ...Session, Menu: null }, bReview);
					return;
				}

				const vecArguments = Choice.Confirm ? vecSelectedMaps : [Choice.Map];
				if ((vecArguments.length === 0) || !vecArguments.every((strMap) => vecCurrentMaps.includes(strMap))) {
					throw CommandFailure("InvalidMap", "A selected map is no longer available in the map cycle.");
				}

				const Result = Entry.Execute(unClientIndex, vecArguments);
				if (Result) {
					Reply(unClientIndex, Result);
				}
			} catch (Failure) {
				Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "The map action failed.")));
			}
		},
		CloseCallback() {
			if (g_mapSessions.get(unClientIndex) === Session) {
				g_mapSessions.delete(unClientIndex);
			}
		},
	};

	const bRadio = GetUserMessageIndex("ShowMenu") >= 0;
	const Menu = bRadio ? new PagedRadioMenu(Options) : new PagedESCMenu(Options);
	const Option = bRadio ? PagedRadioOption : PagedESCOption;
	Menu.UseTextDialogFallback = false;

	for (const { Text: strText, Value } of vecOptions) {
		Menu.AppendMenuItem(new Option(strText, Value));
	}

	Session.Menu = Menu;
	g_mapSessions.set(unClientIndex, Session);

	try {
		if (!GetPlayerMenuQueue(unClientIndex).SendMenu(Menu)) {
			throw CommandFailure("MenuUnavailable", "This game could not display the map menu. Use the console command instead.");
		}
	} catch (Failure) {
		CloseMapMenu(unClientIndex);
		throw Failure;
	}
}

function ShowMapMenu(unClientIndex, unUserID, Entry, ReadMaps, GoBack = null) {
	if (!CanUseMapMenu(unClientIndex, unUserID, Entry, GoBack)) {
		return;
	}

	CloseMapMenu(unClientIndex);

	if (ReadMaps().length === 0) {
		throw CommandFailure("NoMaps", "The map cycle has no available maps.");
	}

	ShowMapMenuPage({ Entry, Index: unClientIndex, UserID: unUserID, ReadMaps, GoBack, SelectedMaps: [], Menu: null }, false);
}

module.exports = { MAXIMUM_VOTE_CHOICES, CloseMapMenu, CloseMapMenus, ShowMapMenu };
