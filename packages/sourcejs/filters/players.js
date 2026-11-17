"use strict";

const { IteratorObject } = require("filters/iterator");
const { GetModule } = require("internal/runtime");
const g_TeamsAPI = require("players/teams");

const g_nMaximumUserID = 2_147_483_647;

const g_NativePlayerFilters = GetModule("filters/players");
const g_NativePlayers = GetModule("players");

// Capture native implementations before publishing the snapshot-producing API on the same module.
const g_GetNativeAllPlayers = g_NativePlayerFilters.GetAllPlayers;
const g_GetNativeBotPlayers = g_NativePlayerFilters.GetBotPlayers;
const g_GetNativeHumanPlayers = g_NativePlayerFilters.GetHumanPlayers;
const g_GetNativePlayersByTeam = g_NativePlayerFilters.GetPlayersByTeam;

function CreateTeamFilter(TeamValue) {
	const nTeamNumber = g_TeamsAPI.GetTeamNumber(TeamValue);

	function IsPlayerInTeam(Player) {
		return Player.TeamNumber === nTeamNumber;
	}

	return IsPlayerInTeam;
}

function CreateVectorSnapshot(VectorValue) {
	return { X: VectorValue.X, Y: VectorValue.Y, Z: VectorValue.Z };
}

function CreatePlayerSnapshot(PlayerRecord) {
	const bFree = PlayerRecord.Free === true;
	const nDeaths = PlayerRecord.Deaths;
	const nFrags = PlayerRecord.Frags;
	const nHealth = PlayerRecord.Health;
	const nMaximumHealth = PlayerRecord.MaximumHealth;
	const strLanguage = PlayerRecord.Language;
	const strModelName = PlayerRecord.Model;
	const strName = PlayerRecord.Name;
	const strNetworkID = PlayerRecord.NetworkID;
	const strRemoteAddress = PlayerRecord.RemoteAddress;
	const strWeaponName = PlayerRecord.Weapon;
	const unIndex = PlayerRecord.Index;
	const Origin = PlayerRecord.Origin;

	return {
		BanPlayer: PlayerRecord.Ban?.bind(PlayerRecord),
		ChangePlayerTeam: PlayerRecord.ChangeTeam?.bind(PlayerRecord),
		ExecuteClientCommand: PlayerRecord.ExecuteClientCommand?.bind(PlayerRecord),
		GivePlayerNamedItem: PlayerRecord.GiveNamedItem?.bind(PlayerRecord),
		KickPlayer: PlayerRecord.Kick?.bind(PlayerRecord),
		SayPlayerMessage: PlayerRecord.Say?.bind(PlayerRecord),
		SayPlayerTeamMessage: PlayerRecord.SayTeam?.bind(PlayerRecord),
		SetPlayerName: PlayerRecord.SetName?.bind(PlayerRecord),
		SlayPlayer: PlayerRecord.Slay?.bind(PlayerRecord),
		Connected: g_NativePlayers.IsConnected(PlayerRecord),
		Dead: g_NativePlayers.IsDead(PlayerRecord),
		FakeClient: g_NativePlayers.IsFakeClient(PlayerRecord),
		Free: bFree,
		Deaths: nDeaths,
		Frags: nFrags,
		Health: nHealth,
		MaximumHealth: nMaximumHealth,
		TeamNumber: g_NativePlayers.GetTeam(PlayerRecord),
		UserID: g_NativePlayers.GetUserID(PlayerRecord),
		Language: strLanguage,
		ModelName: strModelName,
		Name: strName,
		NetworkID: strNetworkID,
		RemoteAddress: strRemoteAddress,
		WeaponName: strWeaponName,
		Index: unIndex,
		Origin: CreateVectorSnapshot(Origin),
	};
}

function TokenizePlayerFilterExpression(strFilterExpression) {
	if (typeof strFilterExpression !== "string") {
		throw new TypeError("Player filter expression must be a string.");
	}

	const strExpressionText = strFilterExpression.trim();
	if (strExpressionText.length === 0) {
		throw new SyntaxError("Player filter expression must not be empty.");
	}

	const PlayerFilterTokenPattern = /\s*(\d+|[A-Za-z_][A-Za-z0-9_]*|\+|-|\(|\))/y;
	const vecPlayerFilterTokens = [];
	let unCharacterIndex = 0;

	while (unCharacterIndex < strExpressionText.length) {
		PlayerFilterTokenPattern.lastIndex = unCharacterIndex;
		const vecPlayerFilterTokenMatch = PlayerFilterTokenPattern.exec(strExpressionText);
		if (!vecPlayerFilterTokenMatch) {
			throw new SyntaxError(`Invalid filter expression near '${strExpressionText.slice(unCharacterIndex)}'.`);
		}

		vecPlayerFilterTokens.push(vecPlayerFilterTokenMatch[1]);
		unCharacterIndex = PlayerFilterTokenPattern.lastIndex;
	}

	return vecPlayerFilterTokens;
}

function ResolvePlayerIndex(Player) {
	const unPlayerIndex = Player?.Index;
	if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex < 0)) {
		throw new TypeError("Player filter values must expose a non-negative safe integer Index property.");
	}

	return unPlayerIndex;
}

function UnionPlayerSets(setLeftPlayers, setRightPlayers) {
	const mapPlayersByIndex = new Map();
	for (const LeftPlayer of setLeftPlayers) {
		mapPlayersByIndex.set(ResolvePlayerIndex(LeftPlayer), LeftPlayer);
	}

	for (const RightPlayer of setRightPlayers) {
		mapPlayersByIndex.set(ResolvePlayerIndex(RightPlayer), RightPlayer);
	}

	return new Set(mapPlayersByIndex.values());
}

function SubtractPlayerSets(setLeftPlayers, setRightPlayers) {
	const setRightPlayerIndexes = new Set();
	const mapPlayersByIndex = new Map();
	for (const RightPlayer of setRightPlayers) {
		setRightPlayerIndexes.add(ResolvePlayerIndex(RightPlayer));
	}

	for (const LeftPlayer of setLeftPlayers) {
		const unPlayerIndex = ResolvePlayerIndex(LeftPlayer);
		if (!setRightPlayerIndexes.has(unPlayerIndex)) {
			mapPlayersByIndex.set(unPlayerIndex, LeftPlayer);
		}
	}

	return new Set(mapPlayersByIndex.values());
}

function RequirePlayerFromUserID(unUserID) {
	if (!Number.isSafeInteger(unUserID) || (unUserID < 0)) {
		throw new TypeError("Player filter user IDs must be non-negative safe integers.");
	}

	const MatchPlayerByUserID = (PlayerCandidate) => g_NativePlayers.GetUserID(PlayerCandidate) === unUserID;
	const Player = g_GetNativeAllPlayers.call(g_NativePlayerFilters).find(MatchPlayerByUserID);
	if (Player === undefined) {
		throw new RangeError(`Unable to find player for user ID ${unUserID}.`);
	}

	return CreatePlayerSnapshot(Player);
}

function ParsePlayerFilterTokens(vecFilterTokens, AvailableFilters) {
	let unTokenIndex = 0;

	function PeekToken() {
		return vecFilterTokens[unTokenIndex] ?? null;
	}

	function ConsumeToken(strExpectedToken = null) {
		const strCurrentToken = vecFilterTokens[unTokenIndex] ?? null;
		if ((strExpectedToken !== null) && (strCurrentToken !== strExpectedToken)) {
			throw new SyntaxError(`Expected '${strExpectedToken}', got '${strCurrentToken ?? "<end>"}'.`);
		}

		unTokenIndex += 1;

		return strCurrentToken;
	}

	function ParsePrimary() {
		const strCurrentToken = PeekToken();
		if ((strCurrentToken === null) || (strCurrentToken === undefined)) {
			throw new SyntaxError("Unexpected end of filter expression.");
		}

		if (strCurrentToken === "(") {
			ConsumeToken("(");
			const setGroupedPlayers = ParseExpression();
			ConsumeToken(")");
			return setGroupedPlayers;
		}

		ConsumeToken();

		if (/^\d+$/.test(strCurrentToken)) {
			const unUserID = Number(strCurrentToken);
			if (!Number.isSafeInteger(unUserID) || (unUserID > g_nMaximumUserID)) {
				throw new RangeError(`Player user ID is outside the supported range: ${strCurrentToken}`);
			}

			return new Set([RequirePlayerFromUserID(unUserID)]);
		}

		const strFilterName = strCurrentToken;
		if ((typeof strFilterName !== "string") || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(strFilterName)) {
			throw new SyntaxError(`Player filter expression contains an invalid primary token: ${strFilterName}`);
		}

		if (!Object.hasOwn(AvailableFilters, strFilterName)) {
			throw new ReferenceError(`Unknown player filter: ${strFilterName}; tokens=${JSON.stringify(vecFilterTokens)}`);
		}

		return AvailableFilters[strFilterName];
	}

	function ParseExpression() {
		let setResolvedPlayers = ParsePrimary();
		while ((PeekToken() === "+") || (PeekToken() === "-")) {
			const strSetOperator = ConsumeToken();
			const setRightPlayers = ParsePrimary();

			if (strSetOperator === "+") {
				setResolvedPlayers = UnionPlayerSets(setResolvedPlayers, setRightPlayers);

			} else {
				setResolvedPlayers = SubtractPlayerSets(setResolvedPlayers, setRightPlayers);
			}
		}

		return setResolvedPlayers;
	}

	const setResolvedPlayers = ParseExpression();
	if (unTokenIndex < vecFilterTokens.length) {
		throw new SyntaxError(`Unexpected token '${vecFilterTokens[unTokenIndex]}'.`);
	}

	return setResolvedPlayers;
}

function GetAllPlayers() {
	return g_GetNativeAllPlayers.call(g_NativePlayerFilters).map(CreatePlayerSnapshot);
}

function GetBotPlayers() {
	return g_GetNativeBotPlayers.call(g_NativePlayerFilters).map(CreatePlayerSnapshot);
}

function GetHumanPlayers() {
	return g_GetNativeHumanPlayers.call(g_NativePlayerFilters).map(CreatePlayerSnapshot);
}

function IsConnectedPlayer(Player) {
	return Player.Connected;
}

function GetConnectedPlayers() {
	return GetAllPlayers().filter(IsConnectedPlayer);
}

function GetPlayersByTeam(TeamValue = null) {
	return g_GetNativePlayersByTeam.call(g_NativePlayerFilters, TeamValue).map(CreatePlayerSnapshot);
}

class PlayerIterator extends IteratorObject {
	static Iterator() {
		return GetAllPlayers();
	}
}

function GetDefaultPlayerFilters() {
	return PlayerIterator.DefaultFilters();
}

function RequireAvailableFilters(AvailableFilters) {
	if ((AvailableFilters === null) || (AvailableFilters === undefined)) {
		return GetDefaultPlayerFilters();
	}

	if ((typeof AvailableFilters !== "object") || Array.isArray(AvailableFilters)) {
		throw new TypeError("Available player filters must be an object of iterable player collections.");
	}

	const AvailableFiltersPrototype = Object.getPrototypeOf(AvailableFilters);
	if ((AvailableFiltersPrototype !== null) && (AvailableFiltersPrototype !== Object.prototype)) {
		throw new TypeError("Available player filters must be a plain or null-prototype object.");
	}

	const ValidatedAvailableFilters = Object.create(null);
	for (const strFilterName of Object.keys(AvailableFilters)) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(strFilterName)) {
			throw new TypeError(`Invalid player filter name: ${strFilterName}`);
		}

		const PlayerCollection = AvailableFilters[strFilterName];
		const bPlayerCollectionIsMissing = (PlayerCollection === null) || (PlayerCollection === undefined);
		const bPlayerCollectionIsString = typeof PlayerCollection === "string";
		const PlayerIteratorMethod = bPlayerCollectionIsMissing ? null : PlayerCollection[Symbol.iterator];

		if (bPlayerCollectionIsMissing || bPlayerCollectionIsString || (typeof PlayerIteratorMethod !== "function")) {
			throw new TypeError(`Player filter '${strFilterName}' must be an iterable collection.`);
		}

		const itPlayer = PlayerIteratorMethod.call(PlayerCollection);
		const PlayerIterable = {
			[Symbol.iterator]() {
				return itPlayer;
			},
		};
		const mapFilterPlayersByIndex = new Map();
		for (const Player of PlayerIterable) {
			mapFilterPlayersByIndex.set(ResolvePlayerIndex(Player), Player);
		}

		ValidatedAvailableFilters[strFilterName] = new Set(mapFilterPlayersByIndex.values());
	}

	return ValidatedAvailableFilters;
}

function ParseFilter(strFilterExpression, AvailableFilters = null) {
	return ParsePlayerFilterTokens(TokenizePlayerFilterExpression(strFilterExpression), RequireAvailableFilters(AvailableFilters));
}

function IsPlayerAlwaysValid() {
	return true;
}

function IsBotPlayer(Player) {
	return Player.FakeClient;
}

function IsHumanPlayer(Player) {
	return !Player.FakeClient;
}

function IsAlivePlayer(Player) {
	return !Player.Dead;
}

function IsDeadPlayer(Player) {
	return Player.Dead;
}

PlayerIterator.RegisterFilter("All", IsPlayerAlwaysValid);
PlayerIterator.RegisterFilter("Bot", IsBotPlayer);
PlayerIterator.RegisterFilter("Human", IsHumanPlayer);
PlayerIterator.RegisterFilter("Alive", IsAlivePlayer);
PlayerIterator.RegisterFilter("Dead", IsDeadPlayer);
PlayerIterator.RegisterFilter("Connected", IsConnectedPlayer);

for (const vecTeamEntry of Object.entries(g_TeamsAPI.GetTeamNames())) {
	const strTeamName = vecTeamEntry[0];
	const nTeamNumber = vecTeamEntry[1];
	PlayerIterator.RegisterFilter(strTeamName, CreateTeamFilter(nTeamNumber));
}

Object.assign(g_NativePlayerFilters, {
	PlayerIterator,
	GetAllPlayers,
	GetBotPlayers,
	GetConnectedPlayers,
	GetDefaultPlayerFilters,
	GetHumanPlayers,
	GetPlayersByTeam,
	ParsePlayerFilterExpression: ParseFilter,
});

module.exports = g_NativePlayerFilters;
