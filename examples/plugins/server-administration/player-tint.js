"use strict";

const { GetEntityDataMapPropertyColor, SetEntityDataMapPropertyColor } = require("entities/datamaps");
const { GetUserIDFromIndex } = require("players/helpers");
const { RequireCurrentPlayer } = require("./administration");

const g_strRenderColorProperty = "m_clrRender";
const g_mapTintStates = new Map();

function ColorsMatch(First, Second) {
	return (First?.Red === Second.Red) && (First.Green === Second.Green) && (First.Blue === Second.Blue) && (First.Alpha === Second.Alpha);
}

function ApplyPlayerTint(Player, Owner, Tint) {
	const unPlayerIndex = Player.Index;
	let State = g_mapTintStates.get(unPlayerIndex);
	const Color = GetEntityDataMapPropertyColor(Player, g_strRenderColorProperty);
	if (!Color) {
		return false;
	}

	if (State?.UserID !== Player.UserID) {
		const OriginalColor = { Red: Color.Red, Green: Color.Green, Blue: Color.Blue, Alpha: Color.Alpha };
		State = { UserID: Player.UserID, OriginalColor, AppliedColor: OriginalColor, Layers: new Map(), Superseded: false };
		g_mapTintStates.set(unPlayerIndex, State);
	}

	State.Layers.set(Owner, Tint);

	if (State.Superseded || !ColorsMatch(Color, State.AppliedColor)) {
		State.Superseded = true;
		return true;
	}

	const VisibleTint = [...State.Layers.values()].at(-1);
	if (ColorsMatch(Color, VisibleTint)) {
		return true;
	}

	if (!SetEntityDataMapPropertyColor(Player, g_strRenderColorProperty, VisibleTint)) {
		return false;
	}

	State.AppliedColor = VisibleTint;

	return true;
}

function ReleasePlayerTint(unPlayerIndex, unUserID, Owner, bRestorePlayer = true) {
	const State = g_mapTintStates.get(unPlayerIndex);
	if (!State || (State.UserID !== unUserID) || !State.Layers.delete(Owner)) {
		return true;
	}

	if (!bRestorePlayer || (GetUserIDFromIndex(unPlayerIndex) !== unUserID)) {
		g_mapTintStates.delete(unPlayerIndex);
		return true;
	}

	if (State.Layers.size === 0) {
		g_mapTintStates.delete(unPlayerIndex);
	}

	if (State.Superseded) {
		return true;
	}

	const Player = RequireCurrentPlayer({ Index: unPlayerIndex, UserID: unUserID });
	const Color = GetEntityDataMapPropertyColor(Player, g_strRenderColorProperty);
	if (!ColorsMatch(Color, State.AppliedColor)) {
		State.Superseded = true;
		return true;
	}

	const NextColor = [...State.Layers.values()].at(-1) ?? State.OriginalColor;
	if (!ColorsMatch(Color, NextColor) && !SetEntityDataMapPropertyColor(Player, g_strRenderColorProperty, NextColor)) {
		return false;
	}

	State.AppliedColor = NextColor;

	return true;
}

module.exports = { ApplyPlayerTint, ReleasePlayerTint };
