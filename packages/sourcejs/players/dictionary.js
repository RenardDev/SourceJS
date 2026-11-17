"use strict";

const { EntityDictionary } = require("entities/dictionary");
const { GetModule } = require("internal/runtime");
const { Player } = require("players");

const g_PlayersDictionaryRuntime = GetModule("players/dictionary");
const g_PlayersHelpersRuntime = GetModule("players/helpers");

class PlayerDictionary extends EntityDictionary {
	constructor(Factory = Player, ...vecFactoryArguments) {
		super(Factory, ...vecFactoryArguments);
	}

	FromUserID(unUserID) {
		return this.get(g_PlayersHelpersRuntime.GetIndexFromUserID(unUserID));
	}
}

const g_mapPlayerDictionary = new PlayerDictionary();

g_PlayersDictionaryRuntime.PLAYER_DICTIONARY = g_mapPlayerDictionary;
g_PlayersDictionaryRuntime.PlayerDictionary = PlayerDictionary;

module.exports = g_PlayersDictionaryRuntime;
